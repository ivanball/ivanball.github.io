# 3. Querying: Specifications, Filtering & the Entity Query Service

**What this group covers.** Every read in MMCA.Common and ADC ("list the published events", "get session 42", "the speakers in Atlanta, page 3, sorted by name, with only the `name` and `bio` fields") flows through one reusable read engine. This chapter is the read side of CQRS (the command/query split is introduced in [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)): side-effect-free queries that turn query-string knobs into `WHERE`, `ORDER BY`, `OFFSET`, and `SELECT` clauses the database executes, then shape the rows down to the fields the caller asked for. There is no per-entity repository method and no hand-rolled `IQueryable` plumbing in each controller: add an entity and it inherits filtering, sorting, paging, sparse-fieldset projection, and eager loading of navigations. The trade-offs behind that generic read surface (dynamic filtering, sparse fieldsets, per-type filter strategies, the pagination header, the unbounded-result ceiling, and the two-path include strategy) are recorded in [ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html); the repository-plus-specification contract underneath it, including the richer `QuerySpecification` shape and the projection pushdown described below, is [ADR-055](https://ivanball.github.io/docs/adr/055-repository-and-specification-contract.html). Both compose with manual DTO mapping ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)), navigation populators ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)), and the Result pattern at the edge ([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html)).

Three sub-systems cooperate here, and it pays to hold them apart from the start:

1. **The Specification pattern** (Domain layer): the type-safe, programmer-authored predicate. A compiled `Expression<Func<TEntity, bool>>` that usually carries an authorization or business scope the caller must not be able to override ("only published events", "only the answers I submitted").
2. **Dynamic filtering, sorting, and field selection** (Application layer): the string-driven, user-authored shaping behind `?filter=...&sort=...&fields=...`. Untrusted input that must be validated against the entity's real properties before it reaches the database.
3. **The query pipeline and the entity query service** (Application layer): the orchestrator that composes both, decides how to load navigations given the data source's JOIN capabilities, runs the query, and packages the result with pagination metadata.

The split matters: specifications are trusted and live with the domain, dynamic filters are untrusted and are validated, capped, and reflection-cached at the application boundary.

## The Specification pattern, the trusted predicate

[`ISpecification<TEntity, TIdentifierType>`](#ispecificationtentity-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/ISpecification.cs:12`) exposes two faces of one rule: a `Criteria` expression tree that EF Core translates to SQL, so the filter runs in the database rather than in memory after a full-table load (`ISpecification.cs:17`), and `IsSatisfiedBy(entity)` for in-memory evaluation (`ISpecification.cs:22`). The abstract base [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:15`) leaves `Criteria` abstract (`Specification.cs:23`), compiles it lazily on first use, and caches the delegate in a private field (`Specification.cs:27`, `Specification.cs:32`), so repeated in-memory checks do not recompile the tree.

The three combinators, [`AndSpecification<TEntity, TIdentifierType>`](#andspecificationtentity-tidentifiertype) (`Specification.cs:81`), [`OrSpecification<TEntity, TIdentifierType>`](#orspecificationtentity-tidentifiertype) (`Specification.cs:105`), and [`NotSpecification<TEntity, TIdentifierType>`](#notspecificationtentity-tidentifiertype) (`Specification.cs:128`), each delegate to the internal [`SpecificationComposer`](#specificationcomposer) (`Specification.cs:146`) and cache the composed expression in a per-instance `_criteria` field rather than rebuilding it on every `Criteria` read (`Specification.cs:88-93`, `Specification.cs:112-117`, `Specification.cs:134-135`), because the pipeline reads `Criteria` at least once per request. `Combine` (`Specification.cs:155`) takes the left lambda's own parameter (`Specification.cs:167`), rebinds the right-hand body onto it, and joins the two with `Expression.AndAlso` or `Expression.OrElse` before closing the lambda (`Specification.cs:169-173`); `Negate` (`Specification.cs:181`) wraps the body in `Expression.Not` while keeping the inner lambda's parameter (`Specification.cs:189-191`). The rebinding is done by [`ParameterReplacer`](#parameterreplacer) (`MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/ParameterReplacer.cs:24`), an `ExpressionVisitor` whose static `Replace` short-circuits when the two parameters are already the same instance (`ParameterReplacer.cs:34`, `ParameterReplacer.cs:40`) and whose `VisitParameter` swaps the rest (`ParameterReplacer.cs:44`). Composing by substitution rather than `Expression.Invoke` is a deliberate portability decision: an `InvocationExpression` survives into the query tree and several providers (Cosmos among them) refuse to translate one, so an ANDed specification failed on exactly the engines the framework is meant to be portable across (`Specification.cs:66-69`, `ParameterReplacer.cs:12-16`). The visitor is `internal` and reaches the Application layer through `InternalsVisibleTo` so the cross-source builder shares one copy rather than carrying its own (`ParameterReplacer.cs:19-23`). [`SpecificationExtensions`](#specificationextensions) (`MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/SpecificationExtensions.cs:30`) puts a fluent face on those three, as `extension<TEntity, TIdentifierType>` members (`SpecificationExtensions.cs:32`) exposing `And` (`SpecificationExtensions.cs:48`), `Or` (`SpecificationExtensions.cs:68`), and `Not` (`SpecificationExtensions.cs:85`), so a composed predicate reads left to right instead of inside out.

Concrete specifications are how a controller scopes a query to allowed data without trusting the request to do it. ADC has two, both one-liners: [`PublishedEventSpecification`](group-18-conference-application.md#publishedeventspecification) is `e => e.IsPublished` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Specifications/PublishedEventSpecification.cs:11`, criteria at `PublishedEventSpecification.cs:14`), and [`PublicSessionStatusSpecification`](group-18-conference-application.md#publicsessionstatusspecification) allows the public session-status list (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/Specifications/PublicSessionStatusSpecification.cs:20`), exposing its predicate as a `public static readonly` expression (`PublicSessionStatusSpecification.cs:23`) so the cross-source filter and the visible-session id resolver share one definition rather than each re-deriving BR-49 (`Criteria` simply returns it at `PublicSessionStatusSpecification.cs:27`). The framework also ships one ready-made scope: [`OwnedByUserSpecification<TEntity, TIdentifierType>`](#ownedbyuserspecificationtentity-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/OwnedByUserSpecification.cs:20`) filters on the audit field `CreatedBy` as the ownership marker (`OwnedByUserSpecification.cs:29-30`), and its constraint is deliberately the concrete [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) rather than an `IAuditableEntity` interface, because a member access declared on an interface is not guaranteed to map to the entity's audit column and the criteria must stay EF-translatable (`OwnedByUserSpecification.cs:12-16`). ADC's question-answer controllers are its callers, and they show the intended shape: an organizer gets `null` (no scoping at all), everyone else gets the specification bound to their own user id (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:67-68`, and the same pair at `SessionQuestionAnswersController.cs:67-68`). This is [Rubric §4, Domain-Driven Design] (the rule is a first-class, reusable domain object) and [Rubric §2, Design Patterns] (a textbook Specification), with a [Rubric §11, Security] overtone: an authorization predicate is server-supplied criteria the client cannot tamper with.

Two members round the family out for polyglot persistence ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). [`InlineSpecification<TEntity, TIdentifierType>`](#inlinespecificationtentity-tidentifiertype) (`Specification.cs:45`) wraps an already-composed `Criteria` expression as a first-class specification (`Specification.cs:51-52`), for predicates built at runtime where no hand-written class exists. The static [`CrossSourceSpecification`](#crosssourcespecification) (`MMCA.Common/Source/Core/MMCA.Common.Application/Specifications/CrossSourceSpecification.cs:22`) builds the cross-source filter: when a dependent entity references a principal that lives in a different physical data source (database-per-service, [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), a navigating predicate like `s => s.Event.IsPublished` cannot be translated, so `BuildAsync` (`CrossSourceSpecification.cs:39`) first projects the matching principal keys from the principal's own source through the read repository's `GetProjectedAsync` (`CrossSourceSpecification.cs:55-56`), materializes them once (`CrossSourceSpecification.cs:60`), and returns an `InlineSpecification` (`CrossSourceSpecification.cs:62`) whose body is an `Enumerable.Contains(keys, dependent.ForeignKey)` call that translates to `IN` or `ARRAY_CONTAINS` (`CrossSourceSpecification.cs:74-79`). An optional local predicate on the dependent's own columns is rebound onto the foreign-key selector's parameter by the shared `ParameterReplacer` (`CrossSourceSpecification.cs:86`) and ANDed in (`CrossSourceSpecification.cs:87`), again without `Expression.Invoke` so the combined predicate stays translatable on every provider (`CrossSourceSpecification.cs:83-85`). The doc comment is explicit about the limit: the keys are materialized and embedded in the predicate, so the shape fits bounded principal sets (`CrossSourceSpecification.cs:17-20`). ADC uses it in production on both of its Session reads, each passing `PublicSessionStatusSpecification.StatusCriteria` as the local predicate: [`GetPublicSessionFilterHandler`](group-18-conference-application.md#getpublicsessionfilterhandler) returns the specification as a query result (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterHandler.cs:29-36`), and [`PublicConferenceVisibility`](group-18-conference-application.md#publicconferencevisibility) uses the same criteria to resolve the visible session ids so a session hidden from the session list cannot stay reachable through a speaker or junction read (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Common/PublicConferenceVisibility.cs:63-69`). The convention this exists to serve is guarded by an opt-in fitness rule, `ArchitectureRules.SpecificationsDoNotNavigateToOtherEntities` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:24`), which analyzes only the parameterless specifications it can instantiate (`ArchitectureRules.Specifications.cs:38-41`) and is exposed to repos as the single-fact base [`SpecificationConventionTestsBase`](group-27-testing-infrastructure.md#specificationconventiontestsbase) (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/SpecificationConventionTestsBase.cs:10`, the fact at `SpecificationConventionTestsBase.cs:15-17`), which is [Rubric §14, Testability] applied to an architectural rule.

## QuerySpecification, a whole read in one object

A plain specification is only a predicate, which leaves includes, ordering, paging, and tracking to be threaded through every layer as loose arguments. [`QuerySpecification<TEntity, TIdentifierType>`](#queryspecificationtentity-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/QuerySpecification.cs:38`) carries them instead. State is exposed read-only (`OrderBy` at `QuerySpecification.cs:54`, `IncludePaths` at `QuerySpecification.cs:60`, `Skip` and `Take` at `QuerySpecification.cs:63` and `QuerySpecification.cs:66`, `AsTracking` at `QuerySpecification.cs:72`, `IgnoreQueryFilters` at `QuerySpecification.cs:82`) and assembled through protected builder methods a derived specification calls from its constructor: `AddOrderBy` (`QuerySpecification.cs:90`), `AddInclude` (`QuerySpecification.cs:102`, which ignores blanks and duplicates), `ApplyPaging` (`QuerySpecification.cs:117`, both values floored at zero at `QuerySpecification.cs:119-120`), `WithTracking` (`QuerySpecification.cs:127`), and `WithSoftDeleted` (`QuerySpecification.cs:133`). Two design notes are worth carrying forward. The base chain stays `QuerySpecification` over `Specification` on purpose, because the fitness rule above keys on that base-type prefix and on a property literally named `Criteria` (`QuerySpecification.cs:29-34`). And `WithSoftDeleted` drops the named `SoftDelete` global query filter and only that one, so a specification asking for deleted rows can never reach another tenant's data (`QuerySpecification.cs:74-81`). Each ordering key is an [`OrderExpression`](#orderexpression) (`QuerySpecification.cs:150`), a record of an untyped `LambdaExpression` plus a descending flag, declared top-level rather than nested inside the generic class because a nested type is a different type per closed generic, which would stop the repository evaluator from handling an ordering list generically (`QuerySpecification.cs:140-144`).

That object is consumed on the persistence side, not by the pipeline in this chapter. The repository's `ListAsync(specification)` (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:151`) takes any `ISpecification`, and [`SpecificationEvaluator`](group-07-persistence-ef-core.md#specificationevaluator) (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/SpecificationEvaluator.cs:20`) applies the `Criteria` always (`SpecificationEvaluator.cs:46`) and the rest only when the instance is a `QuerySpecification` (`SpecificationEvaluator.cs:48-58`). Tracking and soft-delete scope are deliberately not applied there: those choose the base queryable, which only the repository can do, in [`EFReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#efreadrepositorytentity-tidentifiertype)'s `BaseQueryFor` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:312-321`), with the concrete reads at `EFReadRepository.cs:324` and `EFReadRepository.cs:337`. Aggregate reads (count, exists) pass `applyShape: false` so counting does not join in includes or count "page 3 of the matches" (`SpecificationEvaluator.cs:29-34`). Includes go through one shared helper that also opts the query into split-query mode whenever any include targets a collection navigation (`SpecificationEvaluator.cs:77`, the decision at `SpecificationEvaluator.cs:93`), so the string-include path and the specification path cannot drift apart (`SpecificationEvaluator.cs:69-72`).

## Dynamic filtering, one Strategy per CLR type

User filters arrive as a `Dictionary<string, (string Operator, string Value)>`, property name to operator key plus raw string value, parsed from the query string by [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder) at the API edge, which caps a single request at `MaxFilters = 50` distinct properties (`MMCA.Common/Source/Presentation/MMCA.Common.API/ModelBinders/QueryFilterModelBinder.cs:34`, enforced at `QueryFilterModelBinder.cs:61`, where surplus entries are dropped rather than rejected). Turning `("Name", "CONTAINS", "blazor")` into a `.Where()` clause depends entirely on the property's CLR type, so instead of one large `switch` each type gets an [`IFilterStrategy`](#ifilterstrategy) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/IFilterStrategy.cs:6`) declaring an `Apply` method (`IFilterStrategy.cs:17`), the operator set it supports (`IFilterStrategy.cs:24`, where the default `SupportedOperators` is `null`, meaning operator validation is skipped for custom strategies), and a `CanParseValue` predicate that defaults to `true` (`IFilterStrategy.cs:44`). That last member exists because `Apply` fails open: a strategy that cannot parse a value silently returns the query unfiltered, so `?filter=id:equals:abc` returned the whole result set instead of no matches (`IFilterStrategy.cs:32-38`). Validating the value up front turns that into a 400, and the default of `true` keeps a custom strategy behaving exactly as before until it opts in.

The seven built-ins each override `SupportedOperators` with a `FrozenSet`: [`StringFilterStrategy`](#stringfilterstrategy) (`StringFilterStrategy.cs:12`, operators at `StringFilterStrategy.cs:14-18`: `CONTAINS`, `NOT CONTAINS`, `EQUALS`, `NOT EQUALS`, `STARTS WITH`, `ENDS WITH`, `IS EMPTY`, `IS NOT EMPTY`, `IN`), the numeric trio [`IntFilterStrategy`](#intfilterstrategy) (`IntFilterStrategy.cs:15`), [`LongFilterStrategy`](#longfilterstrategy) (`LongFilterStrategy.cs:14`), and [`DecimalFilterStrategy`](#decimalfilterstrategy) (`DecimalFilterStrategy.cs:14`), which share one operator set (equality, the four comparisons, `IN`, an inclusive `BETWEEN` range, and the two presence checks, at `IntFilterStrategy.cs:17-22` and its two siblings, all parsing invariant-culture), [`DateTimeFilterStrategy`](#datetimefilterstrategy) (`DateTimeFilterStrategy.cs:13`: `IS`, `IS NOT`, `IS AFTER`, `IS ON OR AFTER`, `IS BEFORE`, `IS ON OR BEFORE`, the two presence checks, `IN`, and `BETWEEN` at `DateTimeFilterStrategy.cs:17-22`, parsed with `CultureInfo.InvariantCulture` at `DateTimeFilterStrategy.cs:15`), [`BoolFilterStrategy`](#boolfilterstrategy) (`BoolFilterStrategy.cs:12`: `IS` plus the two presence checks, `BoolFilterStrategy.cs:14-17`), and [`GuidFilterStrategy`](#guidfilterstrategy) (`GuidFilterStrategy.cs:13`: `EQUALS`, `NOT EQUALS`, `IN`, and the two presence checks at `GuidFilterStrategy.cs:15-18`; GUIDs have no ordering, so no comparisons). Every value-typed strategy implements `CanParseValue` by delegating to one shared rule (`IntFilterStrategy.cs:25`, `LongFilterStrategy.cs:24`, `DecimalFilterStrategy.cs:24`, `DateTimeFilterStrategy.cs:25`, `BoolFilterStrategy.cs:20`, `GuidFilterStrategy.cs:21`); `StringFilterStrategy` declares none, because any string parses. That shared rule lives in the internal [`FilterValueParser`](#filtervalueparser) (`FilterValueParser.cs:8`): `CanParse` (`FilterValueParser.cs:53`) says presence checks ignore the value, `IN` needs at least one parseable item, `BETWEEN` needs exactly two bounds, and every other operator needs the single scalar to parse (`FilterValueParser.cs:58-64`). `BETWEEN` gets its own stricter check (`FilterValueParser.cs:76`) that keeps empty and unparseable segments in play, because dropping them let `"5,abc,10"` and `"5,,10"` validate as a two-bound range and the strategies then applied a pair the caller never asked for (`FilterValueParser.cs:70-75`). The same class decodes the lists at apply time: `ParseList<T>` skips unparseable entries rather than failing the request (`FilterValueParser.cs:17`, the `if (parse(part) is { } parsed)` guard at `FilterValueParser.cs:26`), and `ParseStringList` splits on comma, trimming and dropping empty entries (`FilterValueParser.cs:34`).

Every clause is built through **System.Linq.Dynamic.Core** string predicates with parameter placeholders (`@0`), never string-concatenated values, and every call site passes the one shared [`DynamicQueryConfig.Parameterized`](#dynamicqueryconfig) parsing config (`DynamicQueryConfig.cs:18`, the instance at `DynamicQueryConfig.cs:21-24`). That flag is not cosmetic: Dynamic LINQ defaults `UseParameterizedNamesInDynamicQuery` to `false`, which turns each `@0` into a `ConstantExpression` that EF inlines, so one filter value produces one distinct SQL string, one SQL Server plan-cache entry per value, and an EF compiled-query cache miss on every request (`DynamicQueryConfig.cs:8-16`). With the flag on the value is reached through a member access and EF parameterizes it, and `QueryParameterizationTests` (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/QueryParameterizationTests.cs:26`) is the regression guard, the only test in the suite that inspects the emitted SQL. This is [Rubric §12, Performance & Scalability] hiding inside a one-property config object.

The static [`QueryFilterService`](#queryfilterservice) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/QueryFilterService.cs:19`) is the registry and dispatcher. It seeds a `ConcurrentDictionary<Type, IFilterStrategy>` with the built-ins, registering both the value type and its `Nullable<>` form (`QueryFilterService.cs:29-45`), keeps a dedicated string instance for string properties and for dotted paths whose leaf type cannot be resolved (`QueryFilterService.cs:52`, fallback at `QueryFilterService.cs:280-283`), and exposes `RegisterStrategy` so a module can add a custom type without touching framework code (`QueryFilterService.cs:60`, the open/closed principle made literal, [Rubric §1, SOLID]). Reflection is memoized per (entity type, property name) but **hits only** (`QueryFilterService.cs:27`, `LookupProperty` at `QueryFilterService.cs:235`): the probed names come from the client's query string, so caching misses would let any caller grow a never-evicted static dictionary simply by filtering on names that do not exist, while the request still gets a clean 400 (`QueryFilterService.cs:214-221`). One shared resolver, `ResolvePropertyInfo` (`QueryFilterService.cs:223`), backs both phases so they cannot disagree about what resolves; when they did, a plain rename entry passed validation and was then silently dropped, returning an unfiltered 200 (`QueryFilterService.cs:208-213`). A dotted path like `"Category.Name"` is walked segment by segment to its leaf type by `ResolveFilterValueType` (`QueryFilterService.cs:259`), so the leaf's own strategy validates the operator instead of every nested path defaulting to the string strategy (`QueryFilterService.cs:153-157`).

The two phases and their ordering are the security story. `ValidateFilters` (`QueryFilterService.cs:111`) runs before the query and returns a [`Result`](group-01-result-error-handling.md#result) carrying every [`Error`](group-01-result-error-handling.md#error) it found: `Filter.Property.NotFound` (`QueryFilterService.cs:143-147`), `Filter.Type.NotSupported` (`QueryFilterService.cs:163-167`), `Filter.Operator.NotSupported` (`QueryFilterService.cs:295-299`), and `Filter.Value.Invalid` (`QueryFilterService.cs:196-200`), the last suppressed when the operator itself was already rejected so one mistake does not produce two errors (`QueryFilterService.cs:191-192`). A bad filter is therefore a validation failure, not a SQL exception and not a silently widened result set. `ApplyFilters` (`QueryFilterService.cs:76`) then builds the actual `.Where()` chain, resolving the DTO name through the property map first (`QueryFilterService.cs:84-86`) and skipping any property it cannot resolve (`QueryFilterService.cs:90-91`). Strategy dispatch plus allow-listing untrusted input against real entity metadata is [Rubric §2, Design Patterns] and [Rubric §11, Security] together.

## Sorting, sparse fieldsets, and paging arithmetic

[`QueryFieldService`](#queryfieldservice) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/QueryFieldService.cs:16`) owns the rest of read shaping. `ApplySorting` (`QueryFieldService.cs:155`) resolves a DTO sort name through the server-authored map, and otherwise accepts the column **only** when it names a real public property of the entity (`QueryFieldService.cs:190-202`), falling back to the optional default sort when it does not (`QueryFieldService.cs:172-178`). That guard is deliberate and documented in the summary (`QueryFieldService.cs:120-127`): a client-supplied string can never reach Dynamic LINQ to order by nested paths or expressions the DTO does not expose. Map entries, being server-authored, may be expressions: ADC sorts speakers by `FullName` through an entry that concatenates first and last name (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/SpeakerEntityQueryService.cs:28-31`, wired in by overriding the map at `SpeakerEntityQueryService.cs:34`). The method also takes an optional `tieBreakProperty` appended as a final ascending key (`QueryFieldService.cs:161`, applied by `BuildOrdering` at `QueryFieldService.cs:209`, and used alone when no valid sort column was given at `QueryFieldService.cs:180-182`). It exists because `Skip`/`Take` over a non-total `ORDER BY` is undefined: rows sharing a sort value can come back in a different order per statement, so the same row appears on two consecutive pages while another appears on neither, from data that never changed (`QueryFieldService.cs:139-153`). The append is repeated-key aware, skipped when the caller already sorted by that very column (`QueryFieldService.cs:214-217`).

`ApplyFieldSelection` (`QueryFieldService.cs:229`) builds a `MemberInit` `Select` expression so a `fields=name,bio` request pulls only those columns from the database ([Rubric §12, Performance & Scalability]), restricted to writable properties because the projection needs setters (`QueryFieldService.cs:282-291`, the `CanWrite` filter at `QueryFieldService.cs:287`). The compiled lambda is cached per (entity type, normalized field set) (`QueryFieldService.cs:237`, cache at `QueryFieldService.cs:280`), and a `null` is cached on purpose to record "this field set projects nothing writable" so the miss is not recomputed per request (`QueryFieldService.cs:269-271`). `ShapeData` and `ShapeCollectionData` (`QueryFieldService.cs:75`, `QueryFieldService.cs:96`) produce the wire shape: an `ExpandoObject` (or a list of them) holding only the requested fields under camelCase keys. To make that cheap on large result sets the service caches a per-type array of [`PropertyAccessor`](#propertyaccessor) (`QueryFieldService.cs:42`), a private `readonly record struct` bundling each property's name, its precomputed camelCase key, and a compiled `Func<object, object?>` getter built with `Expression.Lambda(...).Compile()` rather than `PropertyInfo.GetValue` (`QueryFieldService.cs:46`, built at `QueryFieldService.cs:48-65`); the field-filtered subset is cached again per field set (`QueryFieldService.cs:465`, `QueryFieldService.cs:471`), under an order- and case-insensitive key so `name,id` and `Id, Name` share one entry (`QueryFieldService.cs:502-503`).

Both field-set caches are bounded, and the reason is the same one that shapes the filter cache. Their key is half client-supplied, so an entity with N properties admits up to 2^N distinct subsets and a caller could grow either dictionary by permuting the list (`QueryFieldService.cs:18-38`). The cap is a `const int MaxCacheEntries = 512` per cache (`QueryFieldService.cs:39`), with deliberately no LRU: past the cap `ApplyFieldSelection` skips server-side projection rather than admitting another key (`QueryFieldService.cs:248-249`, and the response is unchanged because shaping still trims the payload), and `GetShapedAccessors` filters per request instead (`QueryFieldService.cs:489-490`), which is a scan over an already-compiled accessor array rather than an expression rebuild. Validation mirrors the filter side: `Validate<TEntity>` rejects unknown field names and (when shaping) read-only properties (`QueryFieldService.cs:317` and the map-aware overload at `QueryFieldService.cs:352`, shared body at `QueryFieldService.cs:362`), and `ValidateSortDirection` accepts only `asc` or `desc` (`QueryFieldService.cs:415`). Paging arithmetic is small enough to look trivial and is not, which is why it has its own type: [`PagingMath.Clamp`](#pagingmath) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/PagingMath.cs:32`) clamps the page size into `[1, maxPageSize]` and the page number to at least 1 (`PagingMath.cs:37-38`), computes the offset in 64-bit (`PagingMath.cs:40`), and returns `(0, 0)` for a page beyond the reachable offset range, materializing the empty page that page genuinely holds (`PagingMath.cs:42`). A 32-bit `(pageNumber - 1) * pageSize` overflows and wraps negative near `int.MaxValue`, and SQL Server rejects a negative `OFFSET` outright, so the request surfaced as a 500 instead of an empty page (`PagingMath.cs:8-12`). Every paginating caller routes through here rather than open-coding the multiply, because the arithmetic previously lived only inside the pipeline and the handlers that paginate their own queryable each re-derived it in 32-bit (`PagingMath.cs:14-17`).

## The pipeline: two entity paths plus projection pushdown

[`IEntityQueryPipeline`](#ientityquerypipeline) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/IEntityQueryPipeline.cs:10`) is the execution contract, implemented by the sealed [`EntityQueryPipeline`](#entityquerypipeline) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:13`), which talks to the database through the [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) abstraction rather than referencing EF Core from the Application layer ([Rubric §3, Clean Architecture]). Its inputs are bundled into [`EntityQueryParameters<TEntity>`](#entityqueryparameterstentity) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryParameters.cs:11`), an immutable record carrying the specification `Criteria`, the dynamic `Filters`, sort column and direction, `Fields`, page number and size, the two include flags, and the DTO-to-entity property map (defaulting to an empty `FrozenDictionary`, `EntityQueryParameters.cs:44`).

`ExecuteAsync` (`EntityQueryPipeline.cs:39`) runs a shared front half, `ApplyIncludesCriteriaAndFilters` (`EntityQueryPipeline.cs:119`): add every supported navigation as an `.Include()` (`EntityQueryPipeline.cs:133-134`), force `AsSplitQuery()` when a child collection is among them (`EntityQueryPipeline.cs:140-141`), then apply the specification criteria and the dynamic filters **before** materializing anything (`EntityQueryPipeline.cs:147-151`) so the data source does as much of the work as possible. The comment above the split-query switch records the hard-won reason, annotated `R24/§8`: paginating a single-query collection include truncates child rows because EF applies `Skip`/`Take` to the JOIN-expanded set, so list reads returned empty child collections while by-id reads worked (`EntityQueryPipeline.cs:136-139`). It then branches on whether any requested navigation is unsupported (`EntityQueryPipeline.cs:53`). **Path 1, server-side includes** (`EntityQueryPipeline.cs:216`): sort (`EntityQueryPipeline.cs:227`), count before paging (`EntityQueryPipeline.cs:240`), `Skip`/`Take` (`EntityQueryPipeline.cs:241`), field-selection `Select` (`EntityQueryPipeline.cs:251`), materialize (`EntityQueryPipeline.cs:252`). **Path 2, manual navigation** (`EntityQueryPipeline.cs:161`), taken when a requested navigation crosses a physical data source and cannot be joined: sort and page at the database first (`EntityQueryPipeline.cs:175`, `EntityQueryPipeline.cs:187`), materialize the page (`EntityQueryPipeline.cs:196`), then invoke the `navigationPopulator` callback to batch-load those navigations in a second query (`EntityQueryPipeline.cs:199`), the [`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity) extension point of [ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html), and apply field selection in memory afterwards (`EntityQueryPipeline.cs:208`). Both paths pass the entity key as the sort tie-break, and **only** when the read is paginated (`EntityQueryPipeline.cs:36`, passed at `EntityQueryPipeline.cs:180` and `EntityQueryPipeline.cs:232`): an unpaginated read materializes one capped set in one statement, so it cannot suffer the split-across-pages incoherence, and adding an `ORDER BY` there would charge every unsorted list read for a sort nobody asked for (`EntityQueryPipeline.cs:30-35`).

`ExecuteProjectedAsync` (`EntityQueryPipeline.cs:60`) is the third path: for a read whose result type has a registered [`IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>`](group-05-cqrs-pipeline.md#ientitydtoprojectortentity-tentitydto-tidentifiertype), criteria, filters, sorting, and paging all run over entity rows (`EntityQueryPipeline.cs:73-94`) and the projection is applied **last** (`EntityQueryPipeline.cs:105`), so the provider pages exactly the rows it means to and selects only that page's columns. Nothing is materialized as an entity and no mapper runs. It handles server-side navigations only: there is no populator hook, because a projection cannot be post-processed row by row, so a query with cross-source includes must use `ExecuteAsync` instead, and navigation includes are not applied here at all because the projection itself decides what the provider joins and selects (`IEntityQueryPipeline.cs:43-48`, restated at `EntityQueryPipeline.cs:101-104`).

All three paths share one [Rubric §12, Performance & Scalability] safety ceiling: an unpaginated query is capped at `MaxUnboundedResultLimit`, a public `const int` of 1000 (`EntityQueryPipeline.cs:23`, applied at `EntityQueryPipeline.cs:98`, `EntityQueryPipeline.cs:193`, and `EntityQueryPipeline.cs:247`), and a paginated call has its page size clamped to that same ceiling inside `ApplyPaging`, which delegates the offset arithmetic to `PagingMath.Clamp` (`EntityQueryPipeline.cs:271-280`). A direct service caller who forgets or oversizes paging therefore can never trigger an unbounded full-table load. The reported total for an unpaginated read is not simply the materialized count: `CountUnpaginatedAsync` (`EntityQueryPipeline.cs:288`) returns the materialized count only while it stays under the ceiling and issues a real `COUNT` otherwise (`EntityQueryPipeline.cs:292-294`), because at the cap the materialized number is the cap itself and reporting it told callers the set was exactly 1000 rows (`EntityQueryPipeline.cs:283-287`). Which navigations are eligible, and which path each takes, is decided by [`NavigationMetadataProvider`](#navigationmetadataprovider) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/NavigationMetadataProvider.cs:20`) behind [`INavigationMetadataProvider`](#inavigationmetadataprovider) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/INavigationMetadataProvider.cs:9`). `BuildIncludes` asks separately for FK references and child collections (`NavigationMetadataProvider.cs:31`), and the classifier reflects over the entity's public properties looking for [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute) (`NavigationMetadataProvider.cs:74`), unwraps `ICollection<T>` / `IReadOnlyCollection<T>` to find the target entity (`NavigationMetadataProvider.cs:106`), and asks [`IDataSourceService`](group-07-persistence-ef-core.md#idatasourceservice) whether the two ends share a JOIN-capable source, sorting each [`NavigationPropertyInfo`](group-11-navigation-populators.md#navigationpropertyinfo) into the supported or unsupported bucket of [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata) (`NavigationMetadataProvider.cs:96-99`). Results are cached per (entity type, [`NavigationType`](group-11-navigation-populators.md#navigationtype)) in an **instance-level** dictionary, not a static one, precisely so that a process hosting more than one data-source configuration (integration tests, for example) cannot share classifications across hosts (`NavigationMetadataProvider.cs:28`, rationale at `NavigationMetadataProvider.cs:22-27`).

## The query service, the public face

[`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#ientityqueryservicetentity-tentitydto-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityQueryService.cs:19`) and its concrete [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#entityqueryservicetentity-tentitydto-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:31`) are what controllers and handlers inject. The service is constructed from [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), the metadata provider, the pipeline, an [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)), and an `INavigationPopulator<TEntity>` (`EntityQueryService.cs:31-36`), and it resolves its [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype) from the unit of work through a `virtual` property (`EntityQueryService.cs:87`). A second, six-argument constructor adds the optional `IEntityDTOProjector` (`EntityQueryService.cs:69-77`): it is a second constructor rather than an optional parameter because the Microsoft DI container has no notion of an optional dependency, so with two overloads it picks the longer one when a projector is registered and the shorter one when it is not (`EntityQueryService.cs:51-61`).

`GetAllAsync` (`EntityQueryService.cs:248`, with a six-parameter convenience overload at `EntityQueryService.cs:227`) is the four-step orchestration. **(1) Validate** every parameter up front with `Result.Combine` over the fields, sort-column, sort-direction, and filter validators, so a bad `fields` fails before any database hit (`EntityQueryService.cs:262-267`), re-stamping each error with the operation and entity name (`EntityQueryService.cs:270-276`). **(2) Build the query**: ask the metadata provider which includes are supported (`EntityQueryService.cs:282`), pack everything into `EntityQueryParameters` (`EntityQueryService.cs:284-296`), and pick `Repository.Table` or `TableNoTracking` from the `asTracking` flag (`EntityQueryService.cs:298`). **(3) Execute** on one of two branches, chosen by `CanProject` (`EntityQueryService.cs:489-492`): a registered projector, no tracking request, and no cross-source includes routes to `ExecuteProjectedAsync` and the mapper is never involved (`EntityQueryService.cs:303-313`); otherwise `ExecuteAsync` runs and `DTOMapper.MapToDTOs` converts the materialized entities (`EntityQueryService.cs:316-324`). Field shaping deliberately does not disqualify projection, because shaping runs after materialization over whatever object the pipeline produced (`EntityQueryService.cs:484-487`). **(4) Shape and wrap**: shape **only when a field subset was requested**, otherwise return the typed DTOs as-is to avoid a per-row `ExpandoObject` allocation and boxing (`EntityQueryService.cs:334-336`); both forms serialize to the same camelCase JSON, which is why the return type is `PagedCollectionResult<object>` rather than a typed collection ([`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), and the contract note at `IEntityQueryService.cs:12-14`). The [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata) comes from `BuildPaginationMetadata` (`EntityQueryService.cs:332`, method at `EntityQueryService.cs:555`), whose job is to describe what the pipeline actually did rather than what the caller asked for: an unpaginated call reports the true total with the page size floored to the rows actually returnable, `Math.Min(total, MaxUnboundedResultLimit)`, on page 1 (`EntityQueryService.cs:569-572`), and a paginated call reports `Math.Clamp(pageSize, 1, MaxUnboundedResultLimit)` on `Math.Max(pageNumber, 1)` (`EntityQueryService.cs:579-582`), mirroring exactly the floor and ceiling `PagingMath` applied. The clamp is recomputed here rather than read back from `PagingMath`, because that helper's `(0, 0)` sentinel for an unreachable page would otherwise advertise `PageSize = 0` for a perfectly valid page size (`EntityQueryService.cs:548-553`).

The by-id path has a fast lane worth knowing. `GetEntityByIdAsync` (`EntityQueryService.cs:376`) validates the fields, then tries `TryGetByIdFastPathAsync` (`EntityQueryService.cs:119`), which issues a single keyed `TOP 1 WHERE Id = @id` through the repository's include overload (`EntityQueryService.cs:135`). `TryGetFastPathIncludes` (`EntityQueryService.cs:161`) decides eligibility: a field projection, a specification, or a non-default `idField` disqualifies the request (`EntityQueryService.cs:171-176`), and so do unsupported (cross-source) navigations, since only the pipeline's populator can batch-load those (`EntityQueryService.cs:184-187`, rationale at `EntityQueryService.cs:155-159`). Requested includes do **not** disqualify it: the repository's include overload applies the same `Include` calls and auto-applies `AsSplitQuery` for a child collection (`EFReadRepository.cs:185-198`, delegating the split decision to `SpecificationEvaluator.cs:93`), and disqualifying on includes left the fast path unreachable for every entity that declares a navigation, because the REST by-id action defaults `includeFKs` to true (`EntityQueryService.cs:147-153`). The string id is converted with a `TypeConverter` cached per identifier type (`EntityQueryService.cs:198`, cache at `EntityQueryService.cs:107`), and the read runs on the filtered `TableNoTracking` (`EFReadRepository.cs:194`), so soft-delete query filters still apply, unlike `FindAsync` (`EntityQueryService.cs:113-117`, and the same trap documented at `EFReadRepository.cs:176-180`). Anything else falls through to the pipeline with a synthetic `Id EQUALS <value>` filter and returns `Error.NotFound` when the page comes back empty. `GetByIdAsync` (`EntityQueryService.cs:437`) layers DTO mapping and the same shape-only-if-fields rule on top; `GetAllForLookupAsync` (`EntityQueryService.cs:348`) returns lightweight [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype) id/name pairs for dropdowns; `ExistsAsync` (`EntityQueryService.cs:467`) delegates straight to the repository. The class is built for extension over modification ([Rubric §1, SOLID]): `Repository` (`EntityQueryService.cs:87`), `DTOToEntityPropertyMap` (`EntityQueryService.cs:100`), and every query method are `virtual`, so a module subclass such as [`SpeakerEntityQueryService`](group-18-conference-application.md#speakerentityqueryservice) (`SpeakerEntityQueryService.cs:15`) overrides one behavior (`SpeakerEntityQueryService.cs:34`) without reimplementing the engine.

## End to end, one list request

The request reaches a read controller, [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype) (Group 12), which resolves `MaxPageSize` per request from [`IApplicationSettings`](group-14-module-system-composition.md#iapplicationsettings), falling back to 500 when unset (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:57-62`), clamps the requested page size to it (`EntityControllerBase.cs:155`), binds `?filter=` through `QueryFilterModelBinder` (`EntityControllerBase.cs:152`), and may supply a server-authored specification for authorization scope. It calls `IEntityQueryService.GetAllAsync`. The service validates fields, sort, and filters (an early failure short-circuits to an error result), classifies the requested includes, and packages an `EntityQueryParameters`. `EntityQueryPipeline` then takes the projection path when a projector is registered and the read qualifies, or one of the two entity paths otherwise, applying the specification criteria plus the dynamic filters as translated, parameterized `WHERE` clauses, sorting with the key tie-break when paginating, counting, paging through `PagingMath`, projecting the requested columns, materializing, and batch-loading any cross-source navigations. The service maps to DTOs (or skips mapping entirely on the projected path), shapes only if a field subset was asked for, and returns a `Result<PagedCollectionResult<object>>` that the controller unwraps into the HTTP body plus an `X-Pagination` header carrying the serialized metadata (`EntityControllerBase.cs:172`). One pipeline, every entity, validated input, server-side execution, and a clean extension point for navigations that cross a service boundary ([Rubric §6, CQRS & Event-Driven] on the read side, [Rubric §9, API & Contract Design] for the uniform query contract).

## Also filed here: best-effort dispatch and the upcaster registry

Four types in this group are not part of the read path at all; they are co-located in `MMCA.Common.Application/Services` and are grouped by that folder. [`BestEffort`](#besteffort) (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/BestEffort.cs:25`) runs a side effect that must never fail its caller (cache eviction after a committed command, a fire-and-forget notification, an eviction broadcast onto the bus): `ExecuteAsync` awaits the action and turns any non-cancellation failure into exactly one Warning plus one metric increment instead of an exception that would roll back or 500 an operation whose real work already succeeded (`BestEffort.cs:45`, the swallow at `BestEffort.cs:65-71`). Cancellation is explicitly **not** swallowed: when the caller's own token is the reason the action stopped, the `OperationCanceledException` is rethrown so a host shutdown unwinds promptly (`BestEffort.cs:59-64`, rationale at `BestEffort.cs:11-17`). The two companions carry the telemetry: [`BestEffortLog`](#besteffortlog) (`BestEffort.cs:79`) is the source-generated Warning message, kept separate so the public helper need not be `partial` (`BestEffort.cs:81-84`), and [`BestEffortMetrics`](#besteffortmetrics) (`BestEffort.cs:99`) owns the `MMCA.Common.BestEffort` meter and its `besteffort.dispatch.failed` counter, tagged by a low-cardinality `operation` name (`BestEffort.cs:102-115`). It is its own meter rather than a counter folded into the CQRS metrics so an operator can drop or keep it independently of the RED metrics (`BestEffort.cs:92-97`). Callers span both apps: Store's output-cache eviction (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/OutputCacheEvictionExtensions.cs:36`) and ADC's live broadcasts and cache-eviction handlers (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/UserSessionBookmarks/DomainEventHandlers/UserSessionBookmarkCacheEvictionHandler.cs:68`, `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Live/LiveChannelPublishProcessor.cs:45`). This is [Rubric §13, Observability & Operability] (a quietly broken side effect becomes a metric, not a line in a log nobody reads) and [Rubric §29, Resilience & Business Continuity] (a non-essential failure degrades instead of propagating).

The fourth co-located type is `EventUpcasterRegistry` (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EventUpcasterRegistry.cs:30`), the default `IEventUpcasterRegistry`, which belongs to the integration-event story rather than to querying. It indexes every registered `IEventUpcaster` by its source contract and rejects a duplicate source, a self-mapping upcaster, or a chain cycle at construction time, throwing an `InvalidOperationException` that names the offenders (`EventUpcasterRegistry.cs:50-79`); it precomputes each chain's terminal type once, because the graph is static after DI is built (`EventUpcasterRegistry.cs:133`); and it preserves the event envelope across every hop by stamping `MessageId` and `DateOccurred` from the pre-hop instance onto the upcasted one through cached `PropertyInfo` handles (`EventUpcasterRegistry.cs:36`, `EventUpcasterRegistry.cs:169`), so consumer-side inbox deduplication stays keyed on the id the producer published.

### BestEffortLog
> MMCA.Common.Application · `MMCA.Common.Application.Services` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/BestEffort.cs:79` · Level 0 · class (internal, static, partial)

- **What it is**: the source-generated logging companion of [`BestEffort`](#besteffort). One
  `[LoggerMessage]` method that emits the single Warning a swallowed side-effect failure produces.
- **Depends on**: nothing first-party. `Microsoft.Extensions.Logging` (`ILogger`, the
  `[LoggerMessage]` source generator).
- **Concept introduced, source-generated logging.** `[Rubric §13, Observability & Operability]`
  assesses whether diagnostic output is structured and cheap enough to leave on in production.
  `ILogger.LogWarning("... {Operation} ...", operation, ex)` boxes its arguments and parses the
  message template on every call; the `[LoggerMessage]` attribute instead makes the compiler emit a
  strongly-typed, allocation-free `DispatchFailed` method with the template pre-parsed and the event
  wired up once. The type has to be `partial` for the generator to add the body, which is exactly why
  it is a separate companion class: the doc comment (`BestEffort.cs:76-77`) records that the reason is
  to keep the public [`BestEffort`](#besteffort) helper from having to be `partial` itself.
- **Walkthrough**: one member.
  `[LoggerMessage(Level = LogLevel.Warning, Message = "Best-effort operation '{Operation}' failed and
  was swallowed; the caller's outcome is unaffected")]` over
  `internal static partial void DispatchFailed(ILogger logger, string operation, Exception exception)`
  (`BestEffort.cs:81-84`). The `Operation` placeholder becomes a structured log property, so an
  operator can group failures by side effect without parsing the message string, and the `Exception`
  parameter is passed to the logger as the exception rather than concatenated into the text.
- **Why it's built this way**: Warning, not Error, is the deliberate level. The caller's real work has
  already succeeded (that is the whole premise of a best-effort dispatch), so an Error would page
  someone for an outcome that is by definition not a failure of the operation.
- **Where it's used**: called from the catch-all arm of
  [`BestEffort.ExecuteAsync`](#besteffort) (`BestEffort.cs:70`) and nowhere else.

---

### BestEffortMetrics
> MMCA.Common.Application · `MMCA.Common.Application.Services` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/BestEffort.cs:99` · Level 0 · class (internal, static)

- **What it is**: the OpenTelemetry instrument behind [`BestEffort`](#besteffort): a meter, one
  counter, and the one-line helper that increments it with the operation name as a tag.
- **Depends on**: nothing first-party. `System.Diagnostics.Metrics` (`Meter`, `Counter<long>`).
- **Concept introduced, a metric as the durable signal for a swallowed failure.** `[Rubric §13,
  Observability & Operability]` assesses whether a system's failure modes are visible in telemetry
  rather than only in logs. A swallowed exception is the classic invisible failure: nothing 500s,
  nothing retries, and the log line scrolls past. Counting each swallow on a counter turns "the cache
  eviction quietly stopped working three weeks ago" into a chart with a step change in it. The class
  doc (`BestEffort.cs:92-97`) explains why it is a meter of its own rather than a counter folded into
  the CQRS meter: best-effort dispatch is not part of the CQRS pipeline (handlers, hosted services and
  consumers all call it), so a separate meter lets an operator drop or keep it independently of the
  RED metrics.
- **Walkthrough**
  - `internal const string MeterName = "MMCA.Common.BestEffort"` (`BestEffort.cs:102`) and
    `private static readonly Meter Meter = new(MeterName)` (`BestEffort.cs:104`): one process-wide
    meter, created once.
  - `internal static readonly Counter<long> DispatchFailed` (`BestEffort.cs:107-110`), the instrument
    `besteffort.dispatch.failed` with unit `{operation}` and a description naming exactly what it
    counts.
  - `internal static void RecordFailure(string operation) => DispatchFailed.Add(1, new
    KeyValuePair<string, object?>("operation", operation))` (`BestEffort.cs:114-115`): one increment,
    one tag. The tag is why the [`BestEffort`](#besteffort) doc insists the operation name be a
    low-cardinality constant: a tag value per request would multiply the time series.
- **Why it's built this way**: a host exports the counter by registering the meter name, and the
  Aspire service defaults do that already (`AddMeter("MMCA.Common.BestEffort")` at
  `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:170`). Note the meter name is
  duplicated there as a string literal rather than referenced, because the Aspire package has no
  reference to Application; the class doc (`BestEffort.cs:90-91`) records that duplication as
  deliberate.
- **Where it's used**: only from [`BestEffort.ExecuteAsync`](#besteffort)'s catch arm
  (`BestEffort.cs:69`). The tagging behavior is pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Services/BestEffortTests.cs:62`, which asserts
  the counter records the failure with its `operation` tag.

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
    `FilterAccessorsByFields` (`:447-453`, the `StringComparer.OrdinalIgnoreCase` match at `:452`).
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
  (`ConcurrentDictionary<(Type EntityType, string Fields), PropertyAccessor[]>`, `:465`), which holds
  the pre-filtered subset for a given `fields=` request. Both are read by `GetShapedAccessors`
  (`:471-496`), which returns the full array when no field list was given (`:476-477`) and, once
  `ShapedAccessorCache` has reached the `MaxCacheEntries` cap of 512 (`:39`), filters per request
  rather than admitting another client-shaped key (`:489-490`).

---

### BestEffort
> MMCA.Common.Application · `MMCA.Common.Application.Services` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/BestEffort.cs:25` · Level 1 · class (public, static)

- **What it is**: the framework's one sanctioned way to run a side effect that must never fail its
  caller: a cache eviction after a committed command, a fire-and-forget notification, an eviction
  broadcast onto the bus. It awaits the action and converts any non-cancellation failure into exactly
  one Warning log plus one metric increment.
- **Depends on**: [`BestEffortLog`](#besteffortlog) (the Warning),
  [`BestEffortMetrics`](#besteffortmetrics) (the counter); `Microsoft.Extensions.Logging` (`ILogger`).
- **Concept introduced, the deliberate swallow, and why it needs a single home.** `[Rubric §29,
  Resilience & Business Continuity]` assesses whether a failure in a non-essential path can take down
  an essential one: the real work (the command, the transaction, the HTTP response) has already
  succeeded by the time these side effects run, so letting one throw would roll back, retry, or 500 an
  operation that was correct. `[Rubric §15, Best Practices & Code Quality]` is the other half: a bare
  `catch (Exception) { }` is a code smell precisely because it is usually silent, and the analyzers
  flag it (CA1031, S2221). Routing every swallow through one helper makes the swallow explicit,
  logged, and counted, which is what turns it from a smell into a policy. The inline comment at
  `BestEffort.cs:67-68` says exactly that: the broad catch is the contract, not an oversight.
  `[Rubric §13, Observability & Operability]` covers the output side, one Warning plus one counter
  increment per failure.
- **Walkthrough**: one method,
  `ExecuteAsync(string operation, ILogger logger, Func<CancellationToken, Task> action,
  CancellationToken cancellationToken = default)` (`BestEffort.cs:45-49`):
  - Guards first: `ArgumentException.ThrowIfNullOrWhiteSpace(operation)` and two
    `ArgumentNullException.ThrowIfNull` calls (`BestEffort.cs:51-53`). A programming error in the call
    itself still throws; only the *action's* failures are swallowed.
  - `await action(cancellationToken).ConfigureAwait(false)` (`BestEffort.cs:57`), the action is
    genuinely awaited, so this is not a fire-and-forget `Task` the runtime might lose.
  - `catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }`
    (`BestEffort.cs:59-64`), the one exception that is **not** swallowed. The filter is the load-bearing
    detail: it rethrows only when the *caller's own* token is the reason, so a host shutdown or an
    abandoned request unwinds promptly, while an action that cancels itself for an unrelated reason
    falls through to the swallow arm (pinned by
    `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Services/BestEffortTests.cs:99` and `:118`,
    one test per side of that distinction).
  - `catch (Exception ex)` (`BestEffort.cs:65-71`), the terminal arm:
    [`BestEffortMetrics.RecordFailure(operation)`](#besteffortmetrics) then
    [`BestEffortLog.DispatchFailed(logger, operation, ex)`](#besteffortlog). Nothing is rethrown.
- **Why it's built this way**: the class doc (`BestEffort.cs:11-17`) states the caller's obligation
  that follows from the cancellation rule: a side effect that must outlive the request should be
  passed `CancellationToken.None`, not the request token. Store's output-cache eviction does exactly
  that, with the reason in a comment: the write has committed, so a client that disconnected
  mid-response must not abandon the cache cleanup
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/OutputCacheEvictionExtensions.cs:34-40`).
  Keeping `operation` a low-cardinality constant is the other obligation, because it becomes a metric
  tag (`BestEffort.cs:20-22`).
- **Where it's used**: ADC Engagement's real-time and cache-eviction paths, all of which broadcast or
  evict after the aggregate has already been saved:
  `UserSessionBookmarkCacheEvictionHandler.cs:68`,
  `SubmitQuestionHandler.cs:131`, `ModerateQuestionHandler.cs:136`,
  `SessionQuestionUpvoteChangedHandler.cs:52`, `LivePollVoteChangedHandler.cs:51` (all under
  `MMCA.ADC/Source/Modules/Engagement/`), and the SignalR publish processor
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Live/LiveChannelPublishProcessor.cs:45`;
  plus Store's output-cache eviction helper (`OutputCacheEvictionExtensions.cs:36`). Its own behavior
  is pinned by `BestEffortTests.cs:13`.
- **Caveats / not-in-source**: nothing here retries. A swallowed side effect is gone, not queued, so
  anything that must eventually happen belongs in the outbox (ADR-003) rather than here.

---

### EventUpcasterRegistry
> MMCA.Common.Application · `MMCA.Common.Application.Services` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/EventUpcasterRegistry.cs:30` · Level 3 · class (public, sealed)

- **What it is**: the default
  [`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry). It indexes every
  registered [`IEventUpcaster`](group-05-cqrs-pipeline.md#ieventupcaster) by the contract it consumes,
  precomputes where each upcast chain ends, and walks an incoming integration event forward to that
  terminal contract while keeping the envelope the producer stamped.
- **Depends on**: [`IEventUpcasterRegistry`](group-05-cqrs-pipeline.md#ieventupcasterregistry) (the
  interface it implements), [`IEventUpcaster`](group-05-cqrs-pipeline.md#ieventupcaster),
  [`IIntegrationEvent`](group-04-events-outbox.md#iintegrationevent),
  [`IDomainEvent`](group-04-events-outbox.md#idomainevent) (only for the `nameof` of the two envelope
  properties); `System.Collections.Concurrent` (`ConcurrentDictionary`), `System.Reflection`
  (`PropertyInfo`) from the BCL.
- **Concept introduced, upcasting a retired event contract.** `[Rubric §6, CQRS & Event-Driven]`
  assesses how well the event model handles change over time, and `[Rubric §7, Microservices
  Readiness]` assesses whether producers and consumers can deploy independently. Both meet here. Once
  an integration event has been published, its shape is a contract: a producer that has moved to
  `FooV2` cannot assume every consumer redeployed at the same moment, and a queue can still hold `Foo`
  messages written before the change. Upcasting resolves that without a flag day. An author registers
  a small mapper that converts `Foo` into `FooV2`
  (`services.AddEventUpcaster<Foo, FooV2, FooUpcaster>()`,
  `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:283-290`), and this registry
  converts on the way in so that exactly one handler shape exists in the codebase, the newest one.
  Registrations compose: V1 to V2 plus V2 to V3 delivers a V1 message to the V3 handler
  (`DependencyInjection.cs:271`).
  `[Rubric §15, Best Practices & Code Quality]` covers the failure model: a bad registration graph is
  a programming error, so it throws at construction naming the offenders instead of returning a
  [`Result`](group-01-result-error-handling.md#result); the class remarks (`:14-20`) call that the
  permission-registry precedent, and note that because the graph is static once DI is built, terminal
  types are resolved once here rather than per message.
- **Walkthrough**
  - **State.** `EnvelopeProperties`
    (`static ConcurrentDictionary<Type, (PropertyInfo? MessageId, PropertyInfo? DateOccurred)>`,
    `:36`) caches the two writable envelope handles per upcast target type, so a chain pays the
    reflection lookup once per contract for the life of the process. `_bySourceType`
    (`Dictionary<Type, IEventUpcaster>`, `:38`) is the index the walk follows, and `_terminalTypes`
    (`Dictionary<Type, Type>`, `:39`) is the precomputed answer to "where does this chain end".
  - **Constructor** (`:50-82`). After `ArgumentNullException.ThrowIfNull(upcasters)` (`:52`) it makes
    one pass over the registrations, collecting *all* offenders instead of failing on the first: an
    upcaster whose `SourceType == TargetType` is rejected as mapping a type onto itself (`:59-63`), a
    second upcaster claiming an already-claimed source is rejected as a duplicate naming both
    contenders (`:65-69`), and anything else is indexed (`:71`). If the offender list is non-empty it
    throws one `InvalidOperationException` joining every message and restating the rule, "exactly one
    upcaster may claim a source contract, and it must produce a different one" (`:74-79`). Only then
    is `BuildTerminalTypes` run (`:81`), so cycle detection sees an already-validated graph.
  - `BuildTerminalTypes` (`:133-161`) walks each source forward, carrying a `visited` set (`:139`) and
    a `chain` list for the error message (`:140`). Each hop advances by the upcaster's `TargetType`
    (`:145`); a type that fails to enter `visited` means the ladder came back on itself, and the throw
    renders the whole chain as `A -> B -> C -> A` (`:148-154`). The doc (`:125-129`) explains why a
    repeat is unambiguously a cycle rather than a diamond: the constructor already rejected duplicate
    sources, so the graph is functional (one outgoing edge per node). The final type reached is stored
    as that source's terminal (`:157`).
  - `HasUpcasterFor(Type)` (`:85-90`) is a plain containment check on `_bySourceType`, and
    `ResolveTerminalType(Type)` (`:93-98`) is a dictionary read that **falls back to the type itself**
    (`:97`), so an unregistered contract is its own terminal. That identity behavior is what lets the
    rest of the framework depend on the registry unconditionally.
  - `UpcastToTerminal(IIntegrationEvent)` (`:101-123`) is the hot path. It walks while a source has an
    upcaster (`:110`), rejects a `null` return with an `InvalidOperationException` naming the offending
    upcaster (`:112-114`), stamps the envelope (`:116`), and then advances `currentType` by the
    upcaster's **declared** `TargetType`, not the runtime type of what was returned (`:119`). The
    comment (`:108-109`) says why that matters: the constructor's acyclicity check was computed over
    declared types, so following declared types is what bounds this loop. With no registration at all,
    the loop never runs and the input instance is returned unchanged (`:122`).
  - `PreserveEnvelope` (`:169-179`) is the correctness detail. It pulls the cached `MessageId` and
    `DateOccurred` handles for the produced type (`:171-175`, keyed on `target.GetType()`), then copies
    both values from the pre-hop instance onto the new one (`:177-178`). `Writable` (`:181-182`) is the
    filter that caches a handle only when `CanWrite` is true, so a target that does not expose the
    property simply gets nothing written rather than throwing. Both properties are `init`-only on
    `BaseDomainEvent`
    (`MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/BaseDomainEvent.cs:28` and `:35`), which
    reflection can still set.
  - `Describe` (`:184`, `:186`) renders a type or an upcaster instance as its `FullName`, which is what
    makes every one of the exception messages above name real types.
- **Why it's built this way**: [ADR-090](https://ivanball.github.io/docs/adr/090-event-upcaster-registration.html)
  records the registration model. Envelope preservation is deliberately the registry's job rather than
  the upcaster author's (remarks, `:21-28`): an upcaster maps payload fields only, and consumer-side
  inbox deduplication is keyed on the `MessageId` the producer published
  ([ADR-021](https://ivanball.github.io/docs/adr/021-consumer-inbox-idempotency.html)), so leaving the
  copy to each author would make dedup depend on every author remembering. Making it automatic also
  makes it idempotent: an author who does copy the envelope just gets the same values written twice,
  which the test at
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Services/EventUpcasterRegistryTests.cs:170`
  pins.
- **Where it's used**: registered unconditionally as a singleton by `AddApplication`
  (`services.TryAddSingleton<IEventUpcasterRegistry, EventUpcasterRegistry>()`,
  `DependencyInjection.cs:40`), and populated by each `AddEventUpcaster<TSource, TTarget, TUpcaster>()`
  call, which appends the upcaster through `TryAddEnumerable`
  (`DependencyInjection.cs:283-290`, the descriptor at `:288`). Both delivery paths consume it: the
  in-process branch of [`DomainEventDispatcher`](group-04-events-outbox.md#domaineventdispatcher)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/DomainEventDispatcher.cs:62`, resolved
  through a `Lazy<IEventUpcasterRegistry?>` at `:32-33` so a host without one still works) and the
  broker-side
  [`UpcastingIntegrationEventConsumer<TEvent>`](group-07-persistence-ef-core.md#upcastingintegrationeventconsumertevent)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/UpcastingIntegrationEventConsumer.cs:65`
  and `:72`).
  [`EventUpcasterStartupValidator`](group-07-persistence-ef-core.md#eventupcasterstartupvalidator)
  exists purely to force construction at host start
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/EventUpcasterStartupValidator.cs:27`
  calls `ResolveTerminalType` for that side effect), so a broken graph fails the host rather than the
  first message. Behavior is pinned by
  [`EventUpcasterRegistryTests`](group-27-testing-infrastructure.md#eventupcasterregistrytests)
  (identity at `:88` and `:187`, chain walking at `:116` and `:130`, envelope preservation at `:153`,
  and one test per constructor rejection at `:199`, `:211`, `:223`).
- **Caveats / not-in-source**: the walk trusts declared types. An upcaster that returns an instance
  whose runtime type is not its declared `TargetType` still advances the walk by the declared type, and
  the envelope stamp is looked up by the runtime type, so the two can disagree; nothing in this class
  verifies the returned instance's type. Envelope stamping is also silently a no-op for a target that
  exposes no writable `MessageId`/`DateOccurred` (`Writable`, `:181-182`).

---

### QueryFieldService
> MMCA.Common.Application · `MMCA.Common.Application.Services` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/QueryFieldService.cs:16` · Level 3 · class (sealed, all members static)

- **What it is**: the read-side utility that owns four jobs: **field validation**, **data shaping**
  (sparse-fieldset projection onto `ExpandoObject`), **dynamic sorting** (including the pagination
  tie-break), and **server-side field selection** (building an EF `Select` expression). It caches
  reflected metadata, compiled getters, and compiled projections per type so that work is paid once
  per process, not once per request.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result),
  [`Error`](group-01-result-error-handling.md#error),
  [`PropertyAccessor`](#propertyaccessor) (its own nested struct),
  [`DynamicQueryConfig`](#dynamicqueryconfig); `System.Linq.Dynamic.Core`, `System.Dynamic`
  (`ExpandoObject`), `System.Reflection`, `System.Text.Json`, `System.Collections.Concurrent`.
- **Concept introduced, sparse fieldsets and a four-cache metadata layer.** `[Rubric §9, API &
  Contract Design]` (assesses whether clients can ask for exactly the data they need): a
  `?fields=id,name` request narrows both the SQL `SELECT` and the JSON payload. `[Rubric §12,
  Performance & Scalability]`: four static `ConcurrentDictionary` caches back everything.
  - `PropertiesCache` (`Type -> PropertyInfo[]`, `:41`) for the validation and projection paths.
  - `AccessorCache` (`Type -> PropertyAccessor[]`, `:42`) for the shaping path, built by
    `GetAccessors<TEntity>` (`:48-65`), which compiles one
    `Expression.Lambda<Func<object, object?>>` per property (`:56-60`) and pre-computes the camelCase
    name (`:61`).
  - `ProjectionCache` (`(Type, string Fields) -> LambdaExpression?`, `:280`) so the `MemberInit`
    tree is built once per (entity, field set) instead of per request. Its remarks (`:262-279`)
    explain that a `null` value is cached **deliberately**: it records "this field set projects
    nothing writable", so the miss is not recomputed on every subsequent request.
  - `ShapedAccessorCache` (`(Type, string Fields) -> PropertyAccessor[]`, `:465`) so a repeated
    `fields=` request reuses the filtered accessor array instead of re-filtering per call.

  The keys of the last two are normalized by `NormalizeFieldsKey` (`:502-503`), which uppercases and
  sorts the field names so `"name,id"` and `"Id, Name"` share one entry rather than multiplying the
  cache by however many spellings callers happen to send. The hot-path `GetOrAdd` calls pass `static`
  lambdas and thread state through the overload's extra argument (`:49`, `:51`, `:251-254`,
  `:492-495`), so no closure is allocated per call.
- **Concept introduced, the client-keyed cache cap.** `[Rubric §11, Security]` (assesses whether a
  caller can grow process-lifetime state at will) and `[Rubric §12]` both apply to
  `private const int MaxCacheEntries = 512` (`:39`). The two field-set caches are keyed partly by the
  raw `fields=` string, and an entity with N properties has up to 2^N distinct subsets, so unlike the
  type-keyed caches the key space is **not** bounded by the number of entity types (the remarks spell
  this out at `:22-38`). There is deliberately no LRU: past the cap each cache simply stops admitting
  entries and the request takes the uncached path (projection is skipped, accessors are filtered per
  request), which is correct and only slightly slower, rather than paying eviction bookkeeping on
  every lookup.
- **Walkthrough** (members in teaching order)
  - `ShapeData<TEntity>(entity, fields)` (`:75-87`) and
    `ShapeCollectionData<TEntity>(entities, fields)` (`:96-117`): resolve accessors through
    `GetShapedAccessors` (`:77`, `:100`), then fill an `ExpandoObject` keyed by `CamelCaseName`
    (`:83`, `:110`). An empty field list means all properties (`GetShapedAccessors`, `:476-477`).
  - `ApplySorting<TEntity>` (`:155-183`): resolves the sort column through `ResolveSortExpression`
    (`:163`), then emits
    `query.OrderBy(Filtering.DynamicQueryConfig.Parameterized, BuildOrdering(...))` (`:167-169`). When
    no valid sort column survives it falls back to the optional `defaultSort` lambda (`:172-178`) and,
    failing that, to the tie-break key alone (`:180-182`).
  - `ResolveSortExpression<TEntity>` (`:190-202`) is the security-relevant half: a server-authored map
    entry wins outright (`:197`), and a name with no map entry is accepted **only** when reflection
    finds a real public property of the entity, matched with `BindingFlags.IgnoreCase` (`:199-201`).
    Anything else returns `null` and never reaches Dynamic LINQ.
  - `BuildOrdering` (`:209-218`) turns the resolved expression plus `"asc"`/`"desc"` into the Dynamic
    LINQ clause (`:211-212`) and appends `", {tieBreakProperty} ascending"` unless the caller already
    sorted by that very column (`:214-217`), because repeating a key in an `ORDER BY` is redundant and
    some providers reject it outright.
  - `ApplyFieldSelection<TEntity>` (`:229-260`): returns the query untouched for an empty field list
    (`:233-234`), otherwise pulls the compiled projection out of `ProjectionCache` on the lock-free
    `TryGetValue` hit path (`:241`), skips projection entirely once the cache is at its cap (`:248-249`),
    and applies the lambda as `query.Select(...)` (`:257-259`). `BuildProjection<TEntity>` (`:282-304`)
    is the builder: it keeps only **writable** properties that match the field set (`p.CanWrite`,
    `:287`), since EF cannot translate a `MemberInit` that assigns a read-only member, returns `null`
    when nothing survives (`:290-291`), and otherwise builds `new TEntity { Prop = e.Prop, ... }`
    (`:293-303`) so the projection is pushed into the SQL `SELECT`.
  - `Validate<TEntity>(fields, allowWriteableFields)` (`:317-318`) and the map-aware overload
    `Validate<TEntity>(fields, dtoToEntityPropertyMap, allowWriteableFields)` (`:352-356`), both thin
    wrappers over the shared `ValidateFields` (`:362-408`). A field with a **map entry is accepted
    unconditionally** and never reflected over (`:378-379`): the remarks (`:326-346`) record why, map
    values are server-authored and are deliberately not plain property names (they may be
    `"Category.Name"` or a Dynamic LINQ expression), so reflecting over them would reject exactly the
    DTO names the map exists to enable. A name with no map entry still must exist on the entity
    (`:381-393`) and, when `allowWriteableFields` is false, must not be read-only (`:395-402`). All
    offenders accumulate into one aggregate [`Result`](group-01-result-error-handling.md#result)
    (`:405-407`).
  - `ValidateSortDirection` (`:415-434`): accepts only `"asc"`, `"desc"`, or null/empty, and returns
    an `Error.Validation("Error.InvalidSortDirection", ...)` failure otherwise (`:426-433`).
  - Private helpers: `ParseFields` (`:436-440`) splits the comma list into a case-insensitive
    `HashSet`; `GetProperties<TEntity>` (`:442-445`) reads through `PropertiesCache`;
    `FilterAccessorsByFields` (`:447-453`) narrows an accessor array; `GetShapedAccessors`
    (`:471-496`) is the cached front door to it.
- **Why it's built this way**: the sort path carries the security argument. The doc comment on
  `ApplySorting` (`:119-127`) names the three risks the property check closes: inferring hidden-column
  data through a nested path, forcing an unindexed sort, and turning a Dynamic LINQ parse error into a
  500. Server-authored map entries may be navigation paths or expressions, client-supplied strings may
  not. `[Rubric §11, Security]` and `[Rubric §12, Performance & Scalability]`.
  The `tieBreakProperty` parameter (`:161`) exists for a different failure: the remarks (`:139-153`)
  explain that `Skip`/`Take` over a non-total `ORDER BY` is undefined, so the same row can appear on
  two consecutive pages while another appears on neither, from data that never changed. The pipeline
  passes the entity key, which is server-supplied and therefore does not widen what a caller can order
  by.
- **Where it's used**: `Validate` and `ValidateSortDirection` are called by
  [`EntityQueryService`](#entityqueryservicetentity-tentitydto-tidentifiertype) before the database is
  touched (`EntityQueryService.cs:262-266`, `:354`, `:386`); `ShapeCollectionData` and `ShapeData` are
  called after mapping (`EntityQueryService.cs:336`, `:463`); `ApplySorting` and `ApplyFieldSelection`
  are called inside [`EntityQueryPipeline`](#entityquerypipeline)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:81`, `:175`,
  `:208`, `:227`, `:251`).
- **Caveats / not-in-source**: the class is `sealed` but every member is `static`, so it is never
  instantiated or injected; treat it as a static utility despite the shape.

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
  optionally [`IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>`](group-05-cqrs-pipeline.md#ientitydtoprojectortentity-tentitydto-tidentifiertype)
  through the second constructor; plus
  [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype),
  [`ISpecification<TEntity, TIdentifierType>`](#ispecificationtentity-tidentifiertype),
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
  list path, the wide `GetAllAsync` overload (`:248-345`), is four steps:
  1. **Validate before touching the database** (`:262-267`): `Result.Combine` of
     [`QueryFieldService.Validate`](#queryfieldservice) for `fields`
     (`allowWriteableFields: false`, so read-only fields are rejected) and for `sortColumn`
     (map-aware overload, `allowWriteableFields: true`, since a computed column may still be
     sortable), `ValidateSortDirection`, and
     [`QueryFilterService.ValidateFilters`](#queryfilterservice). On failure every
     [`Error`](group-01-result-error-handling.md#error) is re-stamped with
     `Source = nameof(GetAllAsync)` and `Target = typeof(TEntity).Name` via a `with` expression
     (`:270-276`), so the caller sees which operation and which entity produced each problem.
  2. **Classify navigations and pack the parameters**: ask
     [`NavigationMetadataProvider.BuildIncludes`](#navigationmetadataprovider) which navigations EF can
     `Include` (`:282`), pack everything (including `specification?.Criteria`, `:286`) into an
     [`EntityQueryParameters<TEntity>`](#entityqueryparameterstentity) (`:284-296`), and pick
     `Repository.Table` when tracking is requested or `TableNoTracking` otherwise (`:298`).
  3. **Execute on one of two paths** (`:303-325`). When `CanProject` says yes, the read goes through
     [`IEntityQueryPipeline.ExecuteProjectedAsync`](#ientityquerypipeline) with the projector's
     `ProjectTo` (`:307-312`), so the provider selects the DTO's columns directly and nothing is ever
     materialized as an entity. Otherwise the entity path runs
     [`ExecuteAsync`](#ientityquerypipeline) with `NavigationPopulator.PopulateAsync` as the callback
     (`:316-321`) so cross-source navigations EF cannot join are batch-loaded after materialization
     ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)), then maps with
     [`IEntityDTOMapper`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype)
     (`:324`).
  4. **Shape only when asked, then wrap** (`:332-344`): the DTOs are cast to `object` as-is unless a
     `fields` subset was requested, in which case
     [`QueryFieldService.ShapeCollectionData`](#queryfieldservice) produces `ExpandoObject`s
     (`:334-336`). The comment (`:327-331`) explains the rule: typed DTOs already serialize to the
     same camelCase JSON, so paying the per-row `ExpandoObject` allocation and boxing only makes
     sense when it actually removes fields, and because shaping reflects over the runtime object it
     behaves identically on a mapped DTO and a projected one. The result is a
     `PagedCollectionResult<object>` (`:338-342`) with
     [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata) from
     `BuildPaginationMetadata`.
- **Concept introduced, projection pushdown as an optional dependency.** `CanProject`
  (`:489-492`) gates the projected path on three conditions: a projector was registered, the caller
  did not ask for tracking, and there are no unsupported (cross-source) includes. The remarks
  (`:476-488`) give the reasons: a projection produces DTOs, which the change tracker has nothing to
  do with, and the navigation populator needs materialized rows a projection never produces. Field
  shaping deliberately does **not** disqualify. The projector arrives through a *second* constructor
  (`:69-77`) rather than an optional parameter, and the remarks (`:51-62`) state why:
  `Microsoft.Extensions.DependencyInjection` has no notion of an optional dependency, so a single
  constructor naming an unregistered service fails to resolve regardless of a default value. With two
  constructors whose parameter sets are strict supersets, the container picks the longer one when an
  [`IEntityDTOProjector`](group-05-cqrs-pipeline.md#ientitydtoprojectortentity-tentitydto-tidentifiertype)
  is registered and the shorter one when it is not, and existing subclasses chaining to the
  five-argument constructor keep compiling. `[Rubric §12, Performance & Scalability]` (two costs
  skipped: selecting every entity column, and mapping each materialized row) and `[Rubric §1, SOLID]`
  (the feature is additive, nothing existing changes).
- **Walkthrough, the other read paths**
  - **The by-id fast path** (`TryGetByIdFastPathAsync`, `:119-139`). For a plain primary-key lookup it
    issues a single keyed read through `Repository.GetByIdAsync(typedId, includes, asTracking, ...)`
    (`:135`) and skips the dynamic-filter pipeline entirely. The doc comment (`:109-118`) states why
    this exists: the pipeline would parse a string predicate and emit a `TOP 1000` plus a client-side
    `FirstOrDefault`, and it notes that the repository overload runs on the filtered
    `TableNoTracking`, so soft-delete query filters still apply (unlike EF's `FindAsync`, which
    bypasses them). A miss returns `Error.NotFound` stamped with `WithSource`/`WithTarget`
    (`:136-138`).
  - **What qualifies for it** (`TryGetFastPathIncludes`, `:161-191`). Field projection, a
    specification, or a non-default `idField` disqualify (`:171-176`). Requested **includes do not**:
    the remarks (`:145-159`) record that disqualifying on includes left the fast path unreachable for
    every entity declaring a navigation, because the REST by-id action defaults `includeFKs` to true,
    so those reads fell back to the pipeline. The repository's include overload applies the same
    `Include` calls and auto-applies `AsSplitQuery` for child collections, so the two agree.
    **Unsupported** includes still disqualify (`:184-187`), because those are cross-source navigations
    only the pipeline's
    [`INavigationPopulator`](group-11-navigation-populators.md#inavigationpopulatorin-tentity) can
    batch-load. Otherwise the supported navigation names are handed back (`:189`).
  - `TryConvertId` (`:198-224`) converts the string id via a `TypeConverter` cached per identifier
    type in `IdConverterCache` (`:107`), catching only `FormatException`, `NotSupportedException`, and
    `ArgumentException` (`:218`) and returning `false` so a malformed id falls back to the pipeline
    rather than failing. The whole fast path is a targeted `[Rubric §12, Performance & Scalability]`
    optimization on the single hottest read shape in the system.
  - `GetEntityByIdAsync` (`:376-434`): validates `fields` (`:386`), tries the fast path (`:402-406`),
    and otherwise reuses the list pipeline through a synthetic `Id EQUALS` filter built with an
    `OrdinalIgnoreCase` comparer (`:408-411`) and `BuildQueryAsync` (`:413-422`), returning
    `Error.NotFound.WithSource(nameof(GetByIdAsync)).WithTarget(...)` when nothing came back
    (`:427-431`).
  - `GetByIdAsync` (`:437-464`): stringifies the typed id (throwing `InvalidOperationException` if
    `ToString()` returns null, `:446`), delegates to `GetEntityByIdAsync`, maps the single entity
    (`:458`), and applies the same shape-only-when-asked rule as the list path (`:461-463`).
  - `GetAllForLookupAsync` (`:348-373`): validates one `nameProperty` with
    `allowWriteableFields: true` (`:354`), then delegates to the repository's lookup query, forwarding
    the optional `where` predicate and the tracking flag (`:368-372`), and returns
    [`BaseLookup<TIdentifierType>`](group-12-api-hosting-mapping.md#baselookuptidentifiertype)
    id/name pairs for dropdowns.
  - `ExistsAsync` (`:467-471`): a thin non-virtual pass-through to
    `Repository.ExistsAsync(where, ignoreQueryFilters, ...)`.
  - `BuildQueryAsync` (`:497-536`) is the shared assembler behind the by-id path: same base-query
    choice (`:510-512`), same `BuildIncludes` call (`:514`), same parameter object (`:516-528`), then
    [`IEntityQueryPipeline.ExecuteAsync`](#ientityquerypipeline) (`:530-535`).
  - **Extensibility points**: `Repository` (`:87`) and `DTOToEntityPropertyMap` (`:100`) are
    `virtual`, as are all the read methods, and the class is deliberately **not** `sealed`, so a
    module subclass can override one behavior (a scoped repository, a
    `"CategoryName" -> "Category.Name"` mapping) without reimplementing the pipeline. `UnitOfWork` is
    `protected` (`:43`) and `DTOProjector` is `protected` (`:84`) for subclasses that need them.
- **Why it's built this way**: centralizing read mechanics means every entity gets identical
  filter/sort/page/projection semantics for free, and validate-before-database turns a bad `fields`
  or operator into a validation failure rather than a SQL or expression-parser error. The
  [`INavigationPopulator`](group-11-navigation-populators.md#inavigationpopulatorin-tentity) callback
  is the database-per-service extension point
  ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html) and
  [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)): EF cannot join across
  physical sources, so those navigations are filled by a second batch query against the page that was
  actually returned. [ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html)
  records the generic read layer's trade-offs.
- **Where it's used**: injected as the query service of the read controllers
  ([`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#entitycontrollerbasetentity-tentitydto-tidentifiertype))
  in both apps, and subclassed per module wherever a default must change.
- **Caveats / not-in-source**: this class does not clamp the page size it *applies* (the clamp lives
  in [`EntityQueryPipeline`](#entityquerypipeline)'s `ApplyPaging`), but it does clamp the page size
  it *reports*: `BuildPaginationMetadata` (`:555-583`) recomputes the clamp rather than reading it
  back from [`PagingMath`](#pagingmath), because that helper returns a `(0, 0)` sentinel for an
  unreachable offset and reporting that take would advertise `PageSize = 0` for a perfectly valid
  request (remarks, `:548-553`). It floors the total at zero (`:560`), reports the row count actually
  returned as the page size for an unpaginated read (`:569-572`), and clamps a paginated request into
  `[1, MaxUnboundedResultLimit]` (`:579-582`, ceiling of 1000 at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:23`). Error
  stamping in the by-id path always uses `Source = nameof(GetByIdAsync)` (`:392`, `:429`) even when
  `GetEntityByIdAsync` is called directly, a cosmetic label, not a behavior difference.

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
  which inspects the emitted SQL through `ToQueryString()` (`QueryParameterizationTests.cs:37`)
  because nothing else in the suite looks at SQL shape.
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
  strategies (for example `IntFilterStrategy.cs:31`, `StringFilterStrategy.cs:23`,
  `DateTimeFilterStrategy.cs:32`) and to every ordering call in
  [`QueryFieldService.ApplySorting`](#queryfieldservice)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/QueryFieldService.cs:168`, `:177`,
  `:182`, which qualify it as `Filtering.DynamicQueryConfig.Parameterized` because that class sits in
  the parent namespace).
- **Caveats / not-in-source**: `internal`, so a consumer writing a custom
  [`IFilterStrategy`](#ifilterstrategy) outside this assembly cannot pass this config and gets the
  Dynamic LINQ default (constant inlining) unless it builds its own `ParsingConfig`.

---

### FilterValueParser
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/FilterValueParser.cs:8` · Level 0 · class (internal, static)

- **What it is**: a small internal helper that splits the comma-separated value list carried by the
  `IN` filter operator into a typed list, skipping any entry that fails to parse, plus the shared
  up-front check that decides whether a raw value is usable at all for a given operator.
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
    the split with the same options, returning `[]` for empty input (`:36-37`).
  - `CanParse<T>(string op, string value, Func<string, T?> parse)` (`:53-65`): the shared
    value-usability check every value-type strategy delegates its `CanParseValue` to. It encodes the
    shape all six value strategies share, verbatim from the switch at `:58-64`: presence checks
    (`IS EMPTY`, `IS NOT EMPTY`) ignore the value and always return `true`; `IN` needs at least one
    parseable item (`ParseList(...).Count > 0`, `:61`); `BETWEEN` delegates to `HasExactlyTwoBounds`
    (`:62`); every other operator needs the single scalar to parse (`parse(value) is not null`,
    `:63`). It null-guards the delegate (`:56`).
  - `HasExactlyTwoBounds<T>(string value, Func<string, T?> parse)` (`:76-85`) is the strict half, and
    its remarks (`:70-75`) explain why it exists as a separate private method rather than reusing
    `ParseList`: it deliberately does **not** pass `RemoveEmptyEntries`, so it sees the raw segment
    count (`:82`) and requires exactly two segments that both parse (`:84`). Going through
    `ParseList` dropped unparseable and empty segments first, which let `"5,abc,10"` and `"5,,10"`
    validate as a two-bound range, and the strategies then applied the surviving pair as bounds the
    caller never asked for.
- **Why it's built this way**: the `Func<string, T?>` shape lets each caller pass its own `TryParse`
  in a `static` lambda or a `static` method group, so no closure is allocated (see
  [`IntFilterStrategy`](#intfilterstrategy)`.ParseInt`, `IntFilterStrategy.cs:69-70`). Returning a
  `List<T>` rather than an array matters downstream: LINQ Dynamic binds it as the receiver of a
  `Contains` call. Putting `CanParse` here rather than in each strategy is what keeps the *validation*
  rule and the *application* rule from drifting apart, which is exactly the class of bug
  [`QueryFilterService`](#queryfilterservice) documents at `QueryFilterService.cs:176-179`.
- **Where it's used**: every value strategy that supports `IN` or `BETWEEN` routes through
  `ParseList`: [`DateTimeFilterStrategy`](#datetimefilterstrategy) (`DateTimeFilterStrategy.cs:59`,
  `:66`), [`DecimalFilterStrategy`](#decimalfilterstrategy) (`DecimalFilterStrategy.cs:55`, `:62`),
  [`GuidFilterStrategy`](#guidfilterstrategy) (`GuidFilterStrategy.cs:38`),
  [`IntFilterStrategy`](#intfilterstrategy) (`IntFilterStrategy.cs:56`, `:63`), and
  [`LongFilterStrategy`](#longfilterstrategy) (`LongFilterStrategy.cs:55`, `:62`);
  [`StringFilterStrategy`](#stringfilterstrategy) (`StringFilterStrategy.cs:45`) calls
  `ParseStringList`. `CanParse` backs the `CanParseValue` override on all six value strategies
  (`BoolFilterStrategy.cs:21`, `DateTimeFilterStrategy.cs:26`, `DecimalFilterStrategy.cs:25`,
  `GuidFilterStrategy.cs:22`, `IntFilterStrategy.cs:26`, `LongFilterStrategy.cs:25`).
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
> | `IntFilterStrategy` | `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/IntFilterStrategy.cs:15` | `EQUALS`, `NOT EQUALS`, `GREATER THAN`, `LESS THAN`, `GREATER THAN OR EQUAL`, `LESS THAN OR EQUAL`, `IN`, `BETWEEN`, `IS EMPTY`, `IS NOT EMPTY` |
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
  get **two separate instances**, not one shared instance. Behavior is pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Services/Filtering/BoolFilterStrategyTests.cs`.
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
  `@0.Contains({property})` (`:60`); `ApplyBetween` (`:63-70`) requires exactly two bounds (`:67`)
  and emits `{property} >= @0 && {property} <= @1` (`:68`). `ParseDateTime` (`:72-73`) is the shared
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
> MMCA.Common.Application · `MMCA.Common.Application.Services.Filtering` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/IntFilterStrategy.cs:15` · Level 1 · class (internal, sealed)

- **What it is**: the [`IFilterStrategy`](#ifilterstrategy) for `int` and `int?`, one of the four
  widest surfaces: equality, the four ordering comparisons, `IN`, an inclusive `BETWEEN`, and the two
  null checks.
- **Depends on**: [`IFilterStrategy`](#ifilterstrategy), [`FilterValueParser`](#filtervalueparser),
  [`DynamicQueryConfig`](#dynamicqueryconfig); `System.Globalization`, `System.Collections.Frozen`,
  `System.Linq.Dynamic.Core`.
- **Walkthrough**: `SupportedOperators` (`:17-22`) holds the ten operators. `CanParseValue` (`:25-26`)
  delegates to [`FilterValueParser.CanParse`](#filtervalueparser) with `ParseInt`. `Apply<T>`
  (`:28-41`) handles the six single-value comparison arms through the private `TryParse` helper
  inside a `when` guard (`:31-36`) and the two value-free null checks (`:37-38`), then falls to
  `ApplyInOrRange` (`:40`, `:46-52`). `ApplyIn` (`:54-58`) parses through
  [`FilterValueParser.ParseList`](#filtervalueparser) with the `ParseInt` method group (`:56`);
  `ApplyBetween` (`:60-67`) requires exactly two bounds (`bounds.Count == 2`, `:64`) and emits
  `{property} >= @0 && {property} <= @1` (`:65`). Both parse helpers pass
  `NumberStyles.Integer` and `CultureInfo.InvariantCulture` explicitly (`:43-44`, `:69-70`), matching
  the decimal, long and date strategies so the filter DSL means the same thing under every request
  culture (the class doc says so at `:10-13`).
- **Why it's built this way**: `int` is the default identifier alias across most modules, so this
  strategy carries the by-id and by-parent-id filtering for the majority of entities, which is why it
  gets the full comparison/`IN`/`BETWEEN` surface.
- **Where it's used**: registered against `typeof(int)` and `typeof(int?)` in
  [`QueryFilterService`](#queryfilterservice) (`QueryFilterService.cs:35-36`); reached indirectly by
  [`EntityQueryService`](#entityqueryservicetentity-tentitydto-tidentifiertype)'s synthetic
  `Id EQUALS` filter (`EntityQueryService.cs:408-411`) whenever the identifier alias is `int` and the
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
  (`EntityQueryService.cs:266`); `ApplyFilters` is called inside
  [`EntityQueryPipeline`](#entityquerypipeline) on both of its paths, before materialization
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:77` for the
  projected path and `:151` for the entity path). The filter map itself is produced at the API edge by
  [`QueryFilterModelBinder`](group-12-api-hosting-mapping.md#queryfiltermodelbinder). Its own behavior
  is pinned by four test classes under
  `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Services/Filtering/` (`QueryFilterServiceTests`,
  `QueryFilterServiceValidateTests`, `QueryFilterServicePropertyCacheTests`, plus the per-strategy
  suites).
- **Caveats / not-in-source**: this is a **static class**, not a DI-resolved service, so
  `RegisterStrategy` mutates process-global state and is only safe at startup. Nullable variants are
  registered as separate instances rather than a shared one (`:32-44`), which costs a few extra
  objects but keeps the table declaration flat.

### EntityQueryParameters<TEntity>
> MMCA.Common.Application · `MMCA.Common.Application.Services.Query` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryParameters.cs:11` · Level 0 · record (sealed)

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
  parameters can be passed down the pipeline without any stage mutating them, and the same object can
  feed either of the pipeline's two execution methods.
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
    1-based pagination; **both** must be present for the pipeline to treat the query as paginated
    (`EntityQueryPipeline.cs:79`, `:170`, `:223`), which is also what decides whether the key
    tie-break is appended to the sort.
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
  no-remapping case allocation-light (the generic read layer's rationale is
  [ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html)).
- **Where it's used**: constructed by the concrete
  [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#entityqueryservicetentity-tentitydto-tidentifiertype)
  from the controller's query arguments, twice: once on the list path
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:284-296`) and once
  in the shared `BuildQueryAsync` used by the by-id path (`EntityQueryService.cs:516-528`). It is then
  handed to [`EntityQueryPipeline`](#entityquerypipeline) as the third argument of `ExecuteAsync`
  (`EntityQueryService.cs:319`) or the second of `ExecuteProjectedAsync` (`EntityQueryService.cs:310`).

---

### PagingMath
> MMCA.Common.Application · `MMCA.Common.Application.Services.Query` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/PagingMath.cs:20` · Level 0 · class (public, static)

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
  [`EntityQueryPipeline`](#entityquerypipeline), so handlers paginating their own queryable each
  re-derived it in 32-bit and kept the overflow. The rule the doc states: callers route through here
  rather than open-coding the multiply.
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
  invariant unavoidable; the framework pipeline and every hand-written paginating handler now call the
  same six lines, so the overflow cannot be reintroduced in one of them.
- **Where it's used**: [`EntityQueryPipeline`](#entityquerypipeline)'s private `ApplyPaging`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:275-278`,
  passing `MaxUnboundedResultLimit` as the ceiling); the two framework notification read handlers that
  paginate their own joined queryable,
  [`GetMyNotificationsHandler`](group-10-notifications.md#getmynotificationshandler)
  (`.../Notifications/UserNotifications/UseCases/GetInbox/GetMyNotificationsHandler.cs:32`, ceiling 500
  at `:21`) and [`GetNotificationHistoryHandler`](group-10-notifications.md#getnotificationhistoryhandler)
  (`.../Notifications/PushNotifications/UseCases/GetHistory/GetNotificationHistoryHandler.cs:30`,
  ceiling 500 at `:21`); and three ADC handlers that page their own queries under BR-11's 500-row cap
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/GetUsers/GetUsersHandler.cs:28`,
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/UserSessionBookmarks/UseCases/GetUserBookmarks/GetUserBookmarksHandler.cs:31`,
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/Points/UseCases/GetMyPoints/GetMyPointsHandler.cs:51`).
  Covered directly by `MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Services/Query/PagingMathTests.cs:12`,
  including the far-page case (`PagingMathTests.cs:68`) and the largest non-overflowing page
  (`PagingMathTests.cs:77`), which is the `[Rubric §14, Testability]` payoff of extracting the
  arithmetic into a pure function.

---

### IEntityQueryPipeline
> MMCA.Common.Application · `MMCA.Common.Application.Services.Query` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/IEntityQueryPipeline.cs:10` · Level 4 · interface

- **What it is**: the contract for the multi-step read pipeline. It has **two** execution methods: the
  entity path, which applies includes, criteria, filters, sorting, pagination and field projection and
  returns materialized entities plus the total row count, and the projected path, which runs the same
  filtering/sorting/paging over entity rows but lets the provider return a projected shape directly.
- **Depends on**: [`EntityQueryParameters<TEntity>`](#entityqueryparameterstentity) (the input bundle),
  [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata) (supported vs unsupported
  includes), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TEntity` constraint); `System.Linq` (`IQueryable`).
- **Concept introduced, the read pipeline behind one abstraction.** `[Rubric §5, Vertical Slice]`
  assesses whether a capability lives behind one focused abstraction rather than smeared across
  callers; every read endpoint's list logic funnels through this interface. Both methods return
  `Task<(IReadOnlyCollection<T> Items, int TotalCount)>` (`IEntityQueryPipeline.cs:23`, `:58`), so the
  page and the count needed to build pagination metadata come back in one call.
- **Walkthrough**
  - `ExecuteAsync<TEntity, TIdentifierType>` (`IEntityQueryPipeline.cs:23-30`), constrained
    `where TEntity : AuditableBaseEntity<TIdentifierType>` and `where TIdentifierType : notnull`
    (`:29-30`), takes the starting `IQueryable<TEntity>` (`:24`), the
    [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata) classification
    (`:25`), the [`EntityQueryParameters<TEntity>`](#entityqueryparameterstentity) (`:26`), and a
    `Func<IReadOnlyCollection<TEntity>, NavigationMetadata, bool, bool, CancellationToken, Task>
    navigationPopulator` callback (`:27`) the pipeline invokes to manually load *unsupported*
    navigations (the two `bool`s are `includeFKs`/`includeChildren`). Passing the populator as a
    delegate keeps the pipeline in the Application layer while the actual populator lives in
    Infrastructure ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html), G11).
  - `ExecuteProjectedAsync<TEntity, TResult, TIdentifierType>` (`IEntityQueryPipeline.cs:58-64`) takes
    the same base query and parameters plus a `Func<IQueryable<TEntity>, IQueryable<TResult>> project`
    (`:61`) that rewrites the entity queryable into the projected one. Its remarks (`:37-49`) are the
    contract that matters: this path exists for reads whose result type has a registered
    `IEntityDTOProjector`, it skips two costs of the entity path (selecting every entity column, and
    mapping each materialized row), and it handles **server-side navigations only**. There is no
    populator hook, because a projection cannot be post-processed row by row, so a query with
    cross-source includes must use `ExecuteAsync` instead; navigation includes are not applied here
    either, since the projection itself decides what the provider joins and selects.
- **Why it's built this way**: abstracting the pipeline behind an interface lets the query service
  depend on the behavior, not the concrete steps, and lets the navigation-population strategy be
  injected as a delegate rather than a hard dependency (Clean Architecture, `[Rubric §3]`). Two methods
  rather than one flag keeps the two contracts honest: the projected one cannot even be handed a
  populator, so the unsupported combination is unrepresentable.
- **Where it's used**: implemented by [`EntityQueryPipeline`](#entityquerypipeline); injected into and
  called by the concrete
  [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#entityqueryservicetentity-tentitydto-tidentifiertype)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:34`, with the two
  call sites at `:307-312` and `:316-321`).

---

### INavigationMetadataProvider
> MMCA.Common.Application · `MMCA.Common.Application.Services.Query` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/INavigationMetadataProvider.cs:9` · Level 4 · interface

- **What it is**: the contract that inspects an entity type and classifies each of its navigation
  properties as **supported** (loadable via EF Core `.Include()`) or **unsupported** (needs manual
  loading), based on whether the two entities share a JOIN-capable data source.
- **Depends on**: [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata) (the
  return type); no other first-party dependency in the interface.
- **Concept introduced, include-capability classification.** `[Rubric §8, Data Architecture]` assesses
  whether the persistence strategy adapts to the physical store; in a database-per-service
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) or polyglot
  ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)) setup, two related
  entities may live in *different* stores, so an `.Include()` that generates a SQL JOIN cannot span
  them. This provider is where that "can EF JOIN these two?" decision is made, up front, before the
  pipeline runs.
- **Walkthrough**: one method, `NavigationMetadata BuildIncludes<TEntity>(bool includeFKs, bool
  includeChildren)` (`INavigationMetadataProvider.cs:19`), building the classification for the requested
  navigation kinds (FK references and/or child collections) on `TEntity`. There is no `CancellationToken`
  and no `Task`: the work is pure reflection plus a configuration lookup, so it is synchronous.
- **Where it's used**: implemented by [`NavigationMetadataProvider`](#navigationmetadataprovider);
  called by the concrete
  [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#entityqueryservicetentity-tentitydto-tidentifiertype)
  three times, once per read shape: the list path (`EntityQueryService.cs:282`), the shared
  `BuildQueryAsync` (`:514`), and the by-id fast-path qualifier `TryGetFastPathIncludes` (`:183`),
  which uses it to decide whether a keyed read can serve the requested includes.

---

### EntityQueryPipeline
> MMCA.Common.Application · `MMCA.Common.Application.Services.Query` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:13` · Level 5 · class (sealed)

- **What it is**: the concrete read pipeline. The entity path runs a **two-path include strategy**:
  PATH 1 uses EF Core `.Include()` when the data source can JOIN (server-side), PATH 2 materializes
  first and loads unsupported navigations manually. A third, projected path skips entity
  materialization altogether. Every path applies criteria, filters, sorting and pagination, with a hard
  row ceiling that keeps each read bounded.
- **Depends on**: [`IEntityQueryPipeline`](#ientityquerypipeline) (the contract),
  [`IQueryableExecutor`](group-07-persistence-ef-core.md#iqueryableexecutor) (the injected abstraction
  over EF's async `Include`/`Count`/`ToList`/`AsSplitQuery`, keeping this Application-layer class free of
  a direct EF reference), [`EntityQueryParameters<TEntity>`](#entityqueryparameterstentity),
  [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata) with its
  [`NavigationType`](group-11-navigation-populators.md#navigationtype) enum, the filtering and field
  helpers [`QueryFilterService`](#queryfilterservice) / [`QueryFieldService`](#queryfieldservice), the
  shared [`PagingMath`](#pagingmath), and
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TEntity` constraint).
- **Concept introduced, the unbounded-result ceiling.** `[Rubric §12, Performance & Scalability]`
  assesses whether every read is bounded. The ceiling is codified as
  `public const int MaxUnboundedResultLimit = 1000;` (`EntityQueryPipeline.cs:23`): a defense-in-depth
  cap so that even an Application-layer caller that bypasses the API's page-size clamp cannot trigger
  an unbounded full-table load (the doc comment at `:15-22` spells out that layering).
- **Concept introduced, the pagination tie-break.** `private const string PaginationTieBreakProperty =
  "Id"` (`EntityQueryPipeline.cs:36`) is appended as a final ascending sort key on every **paginated**
  read (`:86`, `:180`, `:232`). Its doc comment (`:25-35`) gives both halves of the reasoning: the key
  qualifies because every entity has it, it is unique, and it is server-supplied rather than client
  input; and only paginated reads get it, because an unpaginated read materializes one capped set in
  one statement and so cannot suffer the split-across-pages incoherence, while adding an `ORDER BY`
  there would charge every unsorted list read for a sort nobody asked for. `[Rubric §8, Data
  Architecture]` and `[Rubric §12]`: `Skip`/`Take` over a non-total order is undefined, and the
  tie-break is what makes it total.
- **Walkthrough**: constructed with an `IQueryableExecutor` (`:13`).
  - `ExecuteAsync` (`:39-57`) is now a thin dispatcher: it runs the shared front half
    (`ApplyIncludesCriteriaAndFilters`, `:48`), then routes to
    `ExecuteWithManualNavigationAsync` when there is at least one unsupported include (`:53-54`) and to
    `ExecuteWithServerSideIncludesAsync` otherwise (`:56`).
  - `ApplyIncludesCriteriaAndFilters` (`:119-154`) is that front half. **PATH 1 includes**
    (`:131-142`): for each supported include, call `queryableExecutor.Include(...)` (`:134`); if any
    supported include is a `ChildCollection`, switch to `AsSplitQuery` (`:140-141`). The inline comment
    (`:136-139`) documents *why*: paginating a single-query collection-`Include` truncates child rows
    because EF applies `Skip`/`Take` to the JOIN-expanded set, so list reads come back with empty
    collections while by-id reads (no `Skip`) work; a split query loads each collection in its own
    statement (the R24/§8 fix). Then **server-side filtering before materialization** (`:144-151`):
    apply `parameters.Criteria` via `Where` (`:147-148`), then the dynamic filters via
    `QueryFilterService.ApplyFilters` (`:150-151`), so the store does as much filtering as possible.
  - `ExecuteWithManualNavigationAsync` (`:161-210`): sort at the DB level with the tie-break when
    paginated (`:175-180`), keep a handle on the unpaged query (`:182`), then if paginated take the
    total count **before** paging and call `ApplyPaging` (`:184-188`); if not paginated, cap with
    `.Take(MaxUnboundedResultLimit)` (`:193`). Materialize (`:196`), run the `navigationPopulator` on
    the paged subset only when it is non-empty (`:197-200`), settle the unpaginated total via
    `CountUnpaginatedAsync` (`:202-205`), and finally apply field selection in memory over the
    materialized page (`:207-209`).
  - `ExecuteWithServerSideIncludesAsync` (`:216-260`): the same sort / count-before-paging / cap shape
    (`:227-248`) but applies `QueryFieldService.ApplyFieldSelection` on the `IQueryable` directly
    (`:251`) so the projection reaches the database as a `MemberInit`.
  - `ExecuteProjectedAsync` (`:60-113`) is the projection-pushdown path. It null-guards its arguments
    (`:68-69`), applies criteria (`:73-74`) and filters (`:76-77`), sorts with the same tie-break rule
    (`:81-86`), counts before paging when paginated (`:93-94`) or caps at the ceiling when not
    (`:98`), and only then calls `project(query)` (`:105`). The comment above that line (`:101-104`)
    states the ordering rule and its consequence: projecting **last** means filtering, sorting and
    paging all run over entity rows, so the provider pages exactly the rows it means to and selects
    only that page's columns, and navigation includes are deliberately not applied because the
    projection decides which columns and joins the provider emits.
  - `ApplyPaging` (`:271-281`), the shared paging step: it delegates the offset arithmetic to
    [`PagingMath.Clamp`](#pagingmath) with `MaxUnboundedResultLimit` as the ceiling (`:275-278`) and
    returns `query.Skip(skip).Take(take)` (`:280`). The page size is therefore clamped to the ceiling
    here as well as at the API boundary, defense in depth (doc comment, `:262-270`).
  - `CountUnpaginatedAsync` (`:288-294`) fixes a subtle reporting bug: for an unpaginated read the
    materialized count is only the truth while it stays *under* the ceiling; at the ceiling it is the
    cap itself, so the method issues a real `CountAsync` against the unpaged query instead of
    reporting exactly 1000 rows (`:292-294`).
- **Why it's built this way**: pushing filters and projection to the store, forcing split-query for
  paginated child collections, capping every path, making every paginated order total, and reporting
  an honest total keeps reads correct and bounded regardless of engine; injecting `IQueryableExecutor`
  keeps EF out of the Application layer (Clean Architecture), and routing the offset math through
  [`PagingMath`](#pagingmath) keeps the overflow guard shared with the hand-written paginating
  handlers. [ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html) records
  the generic read layer's trade-offs.
- **Where it's used**: the sole implementation behind
  [`IEntityQueryPipeline`](#ientityquerypipeline); driven by the concrete
  [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#entityqueryservicetentity-tentitydto-tidentifiertype),
  which also reads `MaxUnboundedResultLimit` directly when it builds the response's pagination
  metadata (`EntityQueryService.cs:571`, `:581`).

---

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
- **Walkthrough**: constructed with an `IDataSourceService` (`:20`):
  - `private readonly ConcurrentDictionary<(Type EntityType, NavigationType NavType), NavigationMetadata>
    _cache` (`:28`), the per-host memoization store.
  - `BuildIncludes<TEntity>(bool includeFKs, bool includeChildren)` (`:31-50`), builds a fresh
    `NavigationMetadata`, adding the FK-reference classifications when `includeFKs` (`:35-40`) and the
    child-collection ones when `includeChildren` (`:42-47`). Note the returned object is new per call
    even though the per-kind classifications are cached.
  - `GetNavigationProperties` (`:52-53`), the cache lookup: `_cache.GetOrAdd(...)` computes
    `BuildNavigationMetadata` on a miss.
  - `BuildNavigationMetadata` (`:60-70`), reflects over the entity's public instance properties
    (`:64`) and classifies each.
  - `ClassifyNavigationProperty` (`:72-100`), reads the
    [`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute) and skips properties
    without one (`:74-76`), matches the attribute's `IsCollection` flag to the requested
    `NavigationType` (`:78-80`), unwraps the collection element type (`:86`), then calls
    `dataSourceService.HaveIncludeSupport(declaringEntityType.FullName, targetEntityType.FullName)`
    (`:96`, note it compares full type *names*, not `Type` handles) to sort the navigation into the
    supported or unsupported bucket (`:97-99`).
  - `UnwrapCollectionType` (`:106-116`), pulls the element type out of `ICollection<T>` /
    `IReadOnlyCollection<T>` so the compatibility check sees the actual target entity.
- **Why it's built this way**: classifying by reflection keeps navigation configuration declarative (an
  attribute on the property) rather than hand-registered, and caching per host makes the reflection cost
  a one-time hit while staying correct across differently-configured hosts
  ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html) for the populator half
  of this story; the class doc at `:13-17` names
  [`NavigationLoader`](group-11-navigation-populators.md#navigationloader) as what handles the
  unsupported bucket).
- **Where it's used**: injected into the concrete
  [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#entityqueryservicetentity-tentitydto-tidentifiertype)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:33`), which calls
  `BuildIncludes` and passes the resulting
  [`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata) into
  [`EntityQueryPipeline.ExecuteAsync`](#entityquerypipeline), and also consults it to decide whether the
  by-id fast path can serve the requested includes (`EntityQueryService.cs:183`).

### OrderExpression
> MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/QuerySpecification.cs:150` · Level 0 · record (sealed)

- **What it is**: one ordering key of a [`QuerySpecification<TEntity, TIdentifierType>`](#queryspecificationtentity-tidentifiertype):
  a key selector plus a direction flag.
- **Depends on**: nothing first-party. `System.Linq.Expressions` (`LambdaExpression`).
- **Concept introduced, why the key selector is untyped.** The declaration is
  `public sealed record OrderExpression(LambdaExpression KeySelector, bool Descending)`
  (`QuerySpecification.cs:150`). It holds a bare `LambdaExpression`, not an
  `Expression<Func<TEntity, TKey>>`, because a specification may order by a `string` key then an `int`
  key then a `DateTime` key, and those are three different closed generic types that cannot share one
  `List<T>`. Erasing the key type is what lets the ordering list be homogeneous; the repository-side
  evaluator binds each selector back to its concrete key type by reflection when it builds the
  `OrderBy`/`ThenBy` chain
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/SpecificationEvaluator.cs:130-140`).
  `[Rubric §15, Best Practices & Code Quality]` (assesses whether a design choice that costs type
  safety is deliberate and documented): the doc comment on the parameter (`:145-148`) states exactly
  this trade.
- **Walkthrough**: two positional members, both from the record declaration.
  - `KeySelector` (`:145-148`), the lambda, added by the protected builder
    `QuerySpecification.AddOrderBy` (`QuerySpecification.cs:94`).
  - `Descending` (`:149`), whether this key sorts descending. The evaluator turns the first entry into
    `OrderBy`/`OrderByDescending` and every later one into `ThenBy`/`ThenByDescending`
    (`SpecificationEvaluator.cs:113-118`).
  The remarks (`:140-144`) explain why it is a **top-level** type rather than a member nested inside
  the generic specification: a nested type of a generic class is a different type per closed generic,
  which would stop the evaluator from handling an ordering list generically.
- **Where it's used**: held in `QuerySpecification`'s private `_orderBy` list and exposed as
  `IReadOnlyList<OrderExpression> OrderBy` (`QuerySpecification.cs:43`, `:54`); consumed by
  [`SpecificationEvaluator`](group-07-persistence-ef-core.md#specificationevaluator)`.ApplyOrdering`
  (`SpecificationEvaluator.cs:105-119`).

---

### ParameterReplacer
> MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/ParameterReplacer.cs:24` · Level 0 · class (internal, sealed)

- **What it is**: an `ExpressionVisitor` that rebinds every occurrence of one `ParameterExpression`
  onto another, so two independently authored lambdas can be merged into a single lambda body. It is
  the composition primitive the whole specification family is built on.
- **Depends on**: nothing first-party. `System.Linq.Expressions` (`ExpressionVisitor`,
  `ParameterExpression`).
- **Concept introduced, expression-tree rebinding via a visitor.** `[Rubric §8, Data Architecture]`
  assesses whether query predicates reach the database rather than filtering in memory after a full
  load. Two independently built lambdas each own their own `ParameterExpression` (their `x =>`
  variable), and a `ParameterExpression` is compared by **reference**, so you cannot merge two bodies
  just by giving the parameters the same name: you must physically visit one body and swap its
  parameter node for the other's. The class doc (`ParameterReplacer.cs:8-16`) states why substitution
  is chosen over the obvious alternative, `Expression.Invoke(spec.Criteria, parameter)`: an
  `InvocationExpression` survives into the query tree, and several LINQ providers (Cosmos among them)
  refuse to translate one, so an ANDed specification failed on exactly the engines the framework is
  meant to be portable across. Substitution produces a tree indistinguishable from a hand-written
  predicate, so it translates everywhere.
- **Walkthrough**: a primary-constructor sealed class taking `(ParameterExpression from,
  ParameterExpression to)` (`:24`) with one static entry point and one override.
  - `public static Expression Replace(Expression body, ParameterExpression from, ParameterExpression
    to)` (`:34-41`): null-guards all three arguments (`:36-38`), then short-circuits when `from` and
    `to` are already the same instance (`ReferenceEquals`, `:40`) so a no-op rebind allocates no
    visitor at all, and otherwise walks the body with a fresh visitor.
  - `protected override Expression VisitParameter(ParameterExpression node) => node == from ? to :
    base.VisitParameter(node)` (`:44-45`), the entire rewrite: when the visitor reaches the `from`
    parameter it returns `to`; every other node is left to the base visitor.
- **Why it's built this way**: it is `internal` by design (the remarks say so at `:18-23`) because it
  is an implementation detail of specification composition, not part of the framework's public
  surface. `MMCA.Common.Application` sees it through `InternalsVisibleTo`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/MMCA.Common.Domain.csproj:11`), which is what lets the
  Application-layer cross-source builder share this one visitor instead of carrying a private copy of
  it. That sharing is itself the fix for a real duplication: the same six lines used to exist twice.
- **Where it's used**: [`SpecificationComposer.Combine`](#specificationcomposer)
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:171`), which is the
  path every [`AndSpecification`](#andspecificationtentity-tidentifiertype) and
  [`OrSpecification`](#orspecificationtentity-tidentifiertype) takes; and
  [`CrossSourceSpecification.BuildCriteria`](#crosssourcespecification)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Specifications/CrossSourceSpecification.cs:86`),
  which rebinds an optional local predicate onto the foreign-key selector's parameter before ANDing
  the two bodies.

---

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
  codebase, you write `new OwnedByUserSpecification<...>(userId)` once and reuse it. The doc comment
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
  taken directly as the parameter type of the combinators
  ([`AndSpecification`](#andspecificationtentity-tidentifiertype),
  [`OrSpecification`](#orspecificationtentity-tidentifiertype),
  [`NotSpecification`](#notspecificationtentity-tidentifiertype)), of the fluent
  [`SpecificationExtensions`](#specificationextensions), and of the optional `specification` argument
  on every scoped read method of
  [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#ientityqueryservicetentity-tentitydto-tidentifiertype)
  (for example `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityQueryService.cs:40`),
  and of the repository's specification-driven reads
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:324`).

---

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
  database, and the domain stays free of any EF reference (the expression tree is plain BCL). The
  per-instance compile cache pays off for a specification instance that is reused, which the
  combinators below now match: they cache their composed `Criteria` per instance too.
- **Where it's used**: base class for
  [`InlineSpecification`](#inlinespecificationtentity-tidentifiertype), the composites
  [`AndSpecification`](#andspecificationtentity-tidentifiertype) /
  [`OrSpecification`](#orspecificationtentity-tidentifiertype) /
  [`NotSpecification`](#notspecificationtentity-tidentifiertype), the read-shape base
  [`QuerySpecification`](#queryspecificationtentity-tidentifiertype), the ownership filter
  [`OwnedByUserSpecification`](#ownedbyuserspecificationtentity-tidentifiertype), and every
  module-specific access-control specification. Behavior is pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Domain.Tests/Specifications/SpecificationTests.cs:30`.

---

### SpecificationComposer
> MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:146` · Level 2 · class (internal, static)

- **What it is**: the shared body of the boolean composers. Two generic methods that merge two
  criteria lambdas into one, or negate a single one, without ever emitting an
  `InvocationExpression`.
- **Depends on**: [`ISpecification<TEntity, TIdentifierType>`](#ispecificationtentity-tidentifiertype)
  (its arguments), [`ParameterReplacer`](#parameterreplacer) (the rebind),
  [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype)
  (the `TEntity` constraint); `System.Linq.Expressions` (BCL).
- **Concept introduced, one composition algorithm instead of three copies.** `[Rubric §16,
  Maintainability]` assesses whether a rule with a subtle correctness argument is written once. And,
  Or and Not differ by exactly one expression node, so before this type existed each combinator
  carried its own copy of the parameter-rebinding logic and each copy was a place the
  `Expression.Invoke` mistake could come back. Collapsing them into `Combine` (parameterized by the
  binary-operator factory) and `Negate` leaves one implementation to reason about and one to test.
- **Walkthrough**
  - `Combine<TEntity, TIdentifierType>(spec1, spec2, Func<Expression, Expression, BinaryExpression>
    combine)` (`Specification.cs:155-174`): null-guards both specifications (`:162-163`), takes the
    **left** lambda's parameter as the one both sides will share (`:167`), rebinds the right body onto
    it with [`ParameterReplacer.Replace`](#parameterreplacer) (`:171`), applies the caller's operator
    factory to the two bodies (`:169-171`), and re-wraps the result as
    `Expression.Lambda<Func<TEntity, bool>>(body, parameter)` (`:173`). The operator factory is how one
    method serves both `Expression.AndAlso` and `Expression.OrElse`.
  - `Negate<TEntity, TIdentifierType>(spec)` (`Specification.cs:181-192`): null-guards (`:186`), then
    wraps the inner body in `Expression.Not` while **keeping the inner lambda's own parameter**
    (`:189-191`). There is nothing to rebind with one operand, so no visitor runs at all.
- **Why it's built this way**: `internal` and `static`, because it is a composition mechanism rather
  than a domain concept; the three public combinators are the vocabulary a caller sees. Every returned
  tree contains only nodes a LINQ provider can translate, which is the property the whole family
  depends on.
- **Where it's used**: from the cached `Criteria` getters of
  [`AndSpecification`](#andspecificationtentity-tidentifiertype) (`Specification.cs:92-93`),
  [`OrSpecification`](#orspecificationtentity-tidentifiertype) (`:116-117`) and
  [`NotSpecification`](#notspecificationtentity-tidentifiertype) (`:138`). The no-`Invoke` guarantee is
  pinned directly by
  `MMCA.Common/Tests/Core/MMCA.Common.Domain.Tests/Specifications/SpecificationCompositionTests.cs:43`,
  `:55`, `:65` and `:73` (one per combinator plus a nested composition), and the single-parameter
  property by `:86`.

---

### AndSpecification<TEntity, TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:81` · Level 3 · class (sealed)

- **What it is**: a **composite combinator** that ANDs two specifications into a new one whose `Criteria`
  is satisfied only when both children are. Its siblings
  [`OrSpecification`](#orspecificationtentity-tidentifiertype) and
  [`NotSpecification`](#notspecificationtentity-tidentifiertype) share the identical shape and differ
  only in the composer call they make, so this section teaches the mechanism once and those two
  cross-reference it.
- **Depends on**: [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype)
  (base class), [`ISpecification<TEntity, TIdentifierType>`](#ispecificationtentity-tidentifiertype)
  (the two constructor parameters, `Specification.cs:82-83`),
  [`SpecificationComposer`](#specificationcomposer) (the merge),
  [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype)
  (the `TEntity` constraint); `System.Linq.Expressions` (BCL).
- **Concept introduced, composing by parameter substitution rather than invocation.** `[Rubric §8,
  Data Architecture]` assesses whether query predicates reach the database rather than filtering
  in-memory after a full load, and `[Rubric §7, Microservices Readiness]` covers the engine-portability
  half. The remarks (`Specification.cs:58-76`) state the whole argument: the two criteria are merged by
  **parameter substitution** (see [`ParameterReplacer`](#parameterreplacer)), the right-hand body is
  rebound onto the left-hand lambda's parameter, and the two bodies are joined with
  `Expression.AndAlso`, giving a tree indistinguishable from a hand-written predicate. It deliberately
  does **not** use `Expression.Invoke`: an `InvocationExpression` survives into the query tree, and
  while EF Core's relational providers can usually unwrap it, others (Cosmos in particular) throw at
  translation time, so an ANDed specification failed on exactly the engines the framework is meant to
  be portable across.
- **Walkthrough**: a sealed primary-constructor subclass taking two `ISpecification`s
  (`Specification.cs:81-83`), with two members:
  - `private Expression<Func<TEntity, bool>>? _criteria` (`:88`), the per-instance cache.
  - `public override Expression<Func<TEntity, bool>> Criteria => _criteria ??=
    SpecificationComposer.Combine<TEntity, TIdentifierType>(spec1, spec2, Expression.AndAlso)`
    (`:91-93`). The `??=` is the second half of the remarks (`:71-75`): the previous implementation
    rebuilt the whole tree on **every** `Criteria` read, and the query pipeline reads it at least once
    per request, so the composed expression is now built once per instance. Each instance still owns
    its own cache, so two separately constructed composites never share a tree
    (`SpecificationCompositionTests.cs:130`).
- **Why it's built this way**: combinators let query callers compose access rules
  (`new AndSpecification(ownerSpec, activeSpec)`) without the query service knowing the predicate
  internals, and composing at the *expression-tree* level (not by combining compiled `Func`s) preserves
  database translation throughout the composition. Keeping it `sealed` signals it is a leaf
  implementation, not meant for further subclassing.
- **Where it's used**: it is the one combinator with production call sites. ADC's
  [`SessionsController`](group-20-conference-api-grpc.md#sessionscontroller) ANDs the public-session
  filter with the speaker-scoped filter when a `SpeakerId` filter is present
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionsController.cs:118`)
  and [`SpeakersController`](group-20-conference-api-grpc.md#speakerscontroller) does the same for its
  own public/filtered pair (`.../Controllers/SpeakersController.cs:174`), each passing the composite as
  the `specification` argument to the query service; ADC's
  [`PublicConferenceVisibility`](group-18-conference-application.md#publicconferencevisibility) ANDs the
  shared status allow-list with an id-list `InlineSpecification` when resolving eligible session ids
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Common/PublicConferenceVisibility.cs:141-143`).
  Combinator behavior is pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Domain.Tests/Specifications/SpecificationTests.cs:49` and by the
  composition suite (`SpecificationCompositionTests.cs:102` for the build-once property, `:147` for the
  semantics, `:199` for the null-argument guard).

---

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
  ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)'s polyglot model is what
  makes that composition necessary).
- **Where it's used**: returned by
  [`CrossSourceSpecification.BuildAsync`](#crosssourcespecification) to wrap the
  `localPredicate AND principalKeys.Contains(fk)` expression it assembles
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Specifications/CrossSourceSpecification.cs:62-63`);
  and, across ADC Conference, by every filter handler that resolves ids first (over gRPC or from a
  sibling source) and then wraps the resulting `ids.Contains(x.Id)` predicate, for example
  [`GetSessionsBySpeakerFilterHandler`](group-18-conference-application.md#getsessionsbyspeakerfilterhandler)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/GetSessionsBySpeakerFilter/GetSessionsBySpeakerFilterHandler.cs:43`),
  [`GetSpeakersByEventFilterHandler`](group-18-conference-application.md#getspeakersbyeventfilterhandler)
  (`.../Speakers/UseCases/GetSpeakersByEventFilter/GetSpeakersByEventFilterHandler.cs:53`), and
  [`GetPublicSpeakerFilterHandler`](group-18-conference-application.md#getpublicspeakerfilterhandler)
  (`.../Speakers/UseCases/GetPublicSpeakerFilter/GetPublicSpeakerFilterHandler.cs:31`).

---

### NotSpecification<TEntity, TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:128` · Level 3 · class (sealed)

- **What it is**: the negating composite combinator: it wraps a single specification and satisfies its
  `Criteria` when the child does *not*. Same shape as
  [`AndSpecification`](#andspecificationtentity-tidentifiertype) (read that section for the
  substitution-over-invocation argument); it just takes one child instead of two.
- **Depends on**: same as `AndSpecification`, but its constructor takes a single
  [`ISpecification<TEntity, TIdentifierType>`](#ispecificationtentity-tidentifiertype)
  (`Specification.cs:129`).
- **Walkthrough**: a `_criteria` cache field (`:134`) plus the getter
  `Criteria => _criteria ??= SpecificationComposer.Negate<TEntity, TIdentifierType>(spec)` (`:137-138`).
  [`Negate`](#specificationcomposer) wraps the inner body in `Expression.Not` and reuses the inner
  lambda's own parameter, so no rebinding is needed and no `Expression.Invoke` appears (doc comment,
  `:120-123`). `sealed`.
- **Where it's used**: "exclude this set" predicates, composed with the other combinators and passed as
  the `specification` argument to the query service. No production call site in the workspace today; it
  is exercised by `MMCA.Common/Tests/Core/MMCA.Common.Domain.Tests/Specifications/SpecificationTests.cs:99`
  and `:110`, nested inside a composition at `SpecificationTests.cs:122`, checked for invocation-freedom
  at `SpecificationCompositionTests.cs:65`, and wrapping the ownership filter at
  `OwnedByUserSpecificationTests.cs:72`.

---

### OrSpecification<TEntity, TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:105` · Level 3 · class (sealed)

- **What it is**: the disjunctive composite combinator: it ORs two specifications so its `Criteria` is
  satisfied when either child is. Structurally identical to
  [`AndSpecification`](#andspecificationtentity-tidentifiertype) (read that section for the mechanism);
  it differs by one argument.
- **Depends on**: identical to `AndSpecification` (`Specification.cs:105-108`).
- **Walkthrough**: the `_criteria` cache field (`:112`) and the getter
  `Criteria => _criteria ??= SpecificationComposer.Combine<TEntity, TIdentifierType>(spec1, spec2,
  Expression.OrElse)` (`:115-117`), the And getter with `Expression.OrElse` (a short-circuiting logical
  OR) in place of `Expression.AndAlso`. `sealed`.
- **Where it's used**: "admin or owner" access patterns where either condition grants access, composed
  with the other combinators and passed as the `specification` argument to the query service. No
  production call site in the workspace today; it is exercised by
  `MMCA.Common/Tests/Core/MMCA.Common.Domain.Tests/Specifications/SpecificationTests.cs:74`, by the
  invocation-freedom and build-once cases in `SpecificationCompositionTests.cs:55` and `:112`, and by
  the allocation benchmark that composes And over Or
  (`MMCA.Common/Tests/Performance/MMCA.Common.Benchmarks/SpecificationBenchmarks.cs:48-50`).

---

### QuerySpecification<TEntity, TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/QuerySpecification.cs:38` · Level 3 · class (abstract)

- **What it is**: a [`Specification`](#specificationtentity-tidentifiertype) that carries the rest of a
  read's shape alongside its predicate: eager-load paths, ordering, paging, tracking, and whether
  soft-deleted rows are in scope. A repository can then serve a whole query from one object
  (`ListAsync(spec)`) instead of the caller threading five loose arguments through every layer.
- **Depends on**: [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype)
  (base class, `QuerySpecification.cs:39`), [`OrderExpression`](#orderexpression) (the ordering list),
  [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype)
  (the `TEntity` constraint); `System.Linq.Expressions` (BCL).
- **Concept introduced, the specification as the whole read, not just the predicate.** `[Rubric §4,
  DDD]` and `[Rubric §5, Vertical Slice]` both apply: a named class such as
  `RecentOpenTicketsSpecification` now encodes the filter, the includes, the ordering and the page in
  one domain object that the application layer passes around as a value, instead of a handler
  assembling five arguments at every call site. The class doc carries the canonical example
  (`QuerySpecification.cs:15-28`). `[Rubric §11, Security]` covers the soft-delete opt-in: bringing
  deleted rows into scope drops the named `SoftDelete` filter and **only** that one, so the tenant
  filter stays in force and a specification asking for deleted rows can never reach another tenant's
  data (`:74-82`, enforced repository-side at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:312-321`).
- **Walkthrough**: state is exposed read-only and assembled through protected builders a derived
  specification calls from its constructor.
  - Backing fields `_orderBy` and `_includePaths` (`:43-44`) with the read-only projections
    `IReadOnlyList<OrderExpression> OrderBy` (`:54`) and `IReadOnlyList<string> IncludePaths` (`:60`),
    so a caller can read the shape but not mutate it (pinned by `QuerySpecificationTests.cs:128`).
  - `int? Skip` / `int? Take` (`:63`, `:66`), null when the specification does not page.
  - `bool AsTracking` (`:72`), defaulting to `false`: the doc states the rule, a specification-driven
    read is a read.
  - `bool IgnoreQueryFilters` (`:82`), defaulting to `false`, the soft-delete opt-in described above.
  - `protected void AddOrderBy<TKey>(Expression<Func<TEntity, TKey>> keySelector, bool descending =
    false)` (`:90-95`): null-guards the selector and appends an [`OrderExpression`](#orderexpression)
    (`:94`). Call order is application order.
  - `protected void AddInclude(string path)` (`:102-109`): ignores blank paths (`:104-105`) and refuses
    to add the same path twice, compared with `StringComparer.Ordinal` (`:107-108`).
  - `protected void ApplyPaging(int skip, int take)` (`:117-121`): both values are floored at zero
    (`:119-120`), so a negative offset or size degrades to "from the start" / "no rows" instead of
    throwing inside the provider.
  - `protected void WithTracking()` (`:127`) and `protected void WithSoftDeleted()` (`:133`), the two
    opt-ins, each one line.
- **Why it's built this way**: the base chain is deliberately `QuerySpecification -> Specification`
  (`:29-34`), because the `SpecificationsDoNotNavigateToOtherEntities` fitness rule keys on that
  base-type prefix and on a property literally named `Criteria`, so a query specification is analyzed by
  exactly the same rule as a plain one. That keeps the richer shape from becoming an escape hatch around
  the cross-source convention (`[Rubric §34, Architecture Governance & Documentation]`: the convention
  is machine-checked, not just written down).
- **Where it's used**: read by
  [`SpecificationEvaluator`](group-07-persistence-ef-core.md#specificationevaluator), which pattern-matches
  a plain `ISpecification` against this type (`SpecificationEvaluator.cs:48`) and, when it matches,
  applies the includes (`:51`), the ordering chain (`:52`) and the `Skip`/`Take` window (`:54-58`);
  aggregate reads pass `applyShape: false` so a count never joins in includes or pages (`:29-34`). The
  tracking and soft-delete flags are consumed one level up, in `EFReadRepository.BaseQueryFor`
  (`EFReadRepository.cs:312-321`), which chooses `Table` vs `TableNoTracking` and drops the named
  soft-delete filter. Behavior is pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Domain.Tests/Specifications/QuerySpecificationTests.cs:14`,
  including the defaults (`:55`) and the fact that it still composes like any other specification
  (`:68`, `:138`).

---

### OwnedByUserSpecification<TEntity, TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/OwnedByUserSpecification.cs:20` · Level 4 · class (sealed)

- **What it is**: the framework's one reusable ownership filter. It restricts a query to the rows a
  single user created, using the `CreatedBy` audit field as the ownership marker, so a "my own records"
  read (an attendee seeing only the answers they submitted) is one specification instance rather than a
  hand-written `Where` per controller.
- **Depends on**: [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype)
  (base class, `OwnedByUserSpecification.cs:21`),
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TEntity` constraint, `OwnedByUserSpecification.cs:22`, which is what supplies `CreatedBy`),
  and the solution-wide `UserIdentifierType` alias (`int`, declared at
  `MMCA.Common/Source/Core/MMCA.Common.Domain/GlobalUsings.IdentifierType.cs:1` and linked into every
  project, see the primer's identifier-alias convention); `System.Linq.Expressions` (BCL).
- **Concept introduced, row-level authorization as a query predicate.** `[Rubric §11, Security]`
  assesses whether authorization is enforced where the data is fetched rather than after the fact:
  because this is a `Criteria` expression, the ownership test becomes part of the SQL `WHERE` clause, so
  rows the caller may not see are never materialized and cannot leak through a projection, a count, or a
  paging total. `[Rubric §12, Performance & Scalability]` is the same fact read the other way: filtering
  at the store means the page size bounds the owner's rows, not the whole table. The complementary half
  of the pattern lives at the call site: a caller holding a bypass role simply does not build the
  specification and passes `null` instead (the class doc spells that out,
  `OwnedByUserSpecification.cs:6-11`).
- **Walkthrough**: a sealed primary-constructor subclass, `OwnedByUserSpecification<TEntity,
  TIdentifierType>(UserIdentifierType userId)` (`OwnedByUserSpecification.cs:20`):
  - `public UserIdentifierType UserId { get; } = userId;` (`OwnedByUserSpecification.cs:26`), the owning
    user's id kept as a readable property rather than a captured constructor parameter, so a caller (or
    a test) can assert what the specification is scoped to.
  - `public override Expression<Func<TEntity, bool>> Criteria => e => e.CreatedBy == UserId;`
    (`OwnedByUserSpecification.cs:29-30`), the whole rule: one equality node over the audit column. It is
    an expression-bodied property, so a fresh tree is built per `get`, and `IsSatisfiedBy` comes free
    from the base class's lazy-compiled path.
  - The generic constraint is deliberate. `where TEntity : AuditableBaseEntity<TIdentifierType>`
    (`OwnedByUserSpecification.cs:22`) pins the constraint to the concrete base class rather than the
    `IAuditableEntity` interface: the remarks (`OwnedByUserSpecification.cs:12-16`) explain that a member
    access declared on an interface is not guaranteed to map to the entity's audit column, and the
    criteria has to stay EF-translatable. `CreatedBy` itself is declared `virtual` with a private setter
    on the base (`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:27`) and is
    stamped by the infrastructure layer, never by the caller.
- **Why it's built this way**: ownership is already recorded by the framework's audit-field convention
  (see the primer's soft-delete + audit section), so the cheapest correct ownership filter is a
  predicate over that existing column: no extra `OwnerId` property per entity, no per-module duplicate
  of the same `Where`. Keeping it in `MMCA.Common.Domain` next to the base and the combinators means it
  composes with them ([`NotSpecification`](#notspecificationtentity-tidentifiertype) inverts it,
  [`AndSpecification`](#andspecificationtentity-tidentifiertype) narrows it further) with no extra
  machinery.
- **Where it's used**: ADC Conference's two question-answer controllers, which apply it for every
  non-organizer caller (BR-9: organizers see all, attendees see only their own):
  [`SessionQuestionAnswersController`](group-20-conference-api-grpc.md#sessionquestionanswerscontroller)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:67-68`,
  passed as the `specification` argument on its list, paged and by-id reads at
  `SessionQuestionAnswersController.cs:81`, `:109` and `:145`) and
  [`EventQuestionAnswersController`](group-20-conference-api-grpc.md#eventquestionanswerscontroller)
  (`.../Controllers/EventQuestionAnswersController.cs:67-68`). Both read the caller's id from
  [`ICurrentUserService`](group-08-auth.md#icurrentuserservice). Behavior is pinned by
  `MMCA.Common/Tests/Core/MMCA.Common.Domain.Tests/Specifications/OwnedByUserSpecificationTests.cs:8`,
  which asserts not only the in-memory outcome but the *shape* of the expression (an `Equal` binary node
  whose left side is a `MemberExpression` for `CreatedBy` over the lambda parameter,
  `OwnedByUserSpecificationTests.cs:55-68`), which is exactly what keeps it translatable.

---

### SpecificationExtensions
> MMCA.Common.Domain · `MMCA.Common.Domain.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/SpecificationExtensions.cs:30` · Level 4 · class (public, static)

- **What it is**: the fluent face of the three combinators. `And`, `Or` and `Not` as extension members
  on any [`ISpecification<TEntity, TIdentifierType>`](#ispecificationtentity-tidentifiertype), so a
  composed predicate reads left to right instead of inside out.
- **Depends on**: [`ISpecification<TEntity, TIdentifierType>`](#ispecificationtentity-tidentifiertype)
  (the receiver), [`AndSpecification`](#andspecificationtentity-tidentifiertype) /
  [`OrSpecification`](#orspecificationtentity-tidentifiertype) /
  [`NotSpecification`](#notspecificationtentity-tidentifiertype) (the return types),
  [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype)
  (the `TEntity` constraint).
- **Concept introduced, the C# `extension(T)` block.** The whole class body is a single
  `extension<TEntity, TIdentifierType>(ISpecification<TEntity, TIdentifierType> specification)` block
  (`SpecificationExtensions.cs:32-34`) carrying its own generic constraints, with the three members
  declared inside it as ordinary instance-looking methods. This is the C# 14 extension-member syntax
  the workspace uses throughout (see the primer's `extension(T)` note): the receiver is named once on
  the block rather than repeated as a `this` parameter on every method, and the constraints are stated
  once. `[Rubric §15, Best Practices & Code Quality]` (assesses idiomatic use of current language
  features) and `[Rubric §16, Maintainability]`.
- **Walkthrough**: three members, each a thin factory that null-guards both the receiver and the
  argument before constructing the corresponding combinator.
  - `And(ISpecification<TEntity, TIdentifierType> other)` returning
    `AndSpecification<TEntity, TIdentifierType>` (`:48-54`).
  - `Or(ISpecification<TEntity, TIdentifierType> other)` returning
    `OrSpecification<TEntity, TIdentifierType>` (`:68-74`).
  - `Not()` returning `NotSpecification<TEntity, TIdentifierType>` (`:85-90`).
  Note the return types are the **concrete** combinators, not `ISpecification`, so a fluent chain keeps
  composing without a cast.
- **Why it's built this way**: the class doc (`:5-28`) contrasts the two spellings directly, nested
  constructors versus the fluent chain, and closes with the performance note that follows from the
  combinators' per-instance caching: hold on to the composed specification (a field, a local) rather
  than rebuilding it per request if the composition itself is on a hot path.
- **Where it's used**: no production call site in the workspace today; every current composition uses
  the constructors directly (see [`AndSpecification`](#andspecificationtentity-tidentifiertype)). The
  fluent surface is exercised by
  `MMCA.Common/Tests/Core/MMCA.Common.Domain.Tests/Specifications/SpecificationCompositionTests.cs:220`,
  `:230`, `:239`, the left-to-right chain at `:248`, and the null guards at `:258`.

---

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
  (the `DTOMapper` property), [`ISpecification<TEntity, TIdentifierType>`](#ispecificationtentity-tidentifiertype)
  (the optional scoping argument), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt),
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
    children (`includeFKs`/`includeChildren`), optionally scope by an
    [`ISpecification`](#ispecificationtentity-tidentifiertype), optionally project `fields`, optionally
    track; returns `Task<Result<PagedCollectionResult<object>>>`.
  - `GetAllAsync(...)` (`IEntityQueryService.cs:60-71`), the **full** overload: adds `filters`
    (`Dictionary<string, (string Operator, string Value)>`, a dynamic filter map), `sortColumn`,
    `sortDirection` ("asc"/"desc"), `pageNumber`, `pageSize`. Callers pick the minimal overload for
    their use case.
  - `GetAllForLookupAsync(string nameProperty, ...)` (`IEntityQueryService.cs:87-91`), returns
    lightweight `IReadOnlyCollection<BaseLookup<TIdentifierType>>` id/name pairs for dropdowns, with an
    optional `where` expression. There is deliberately no ordering parameter: results are always ordered
    by the projected display name, and the remarks (`IEntityQueryService.cs:81-86`) record that an
    `orderBy` parameter existed through v1.138.0 but was never honored (the repository contract has no
    ordering hook), so it was removed rather than widened. A dead parameter that silently does nothing is
    worse than no parameter, `[Rubric §9, API & Contract Design]`.
  - `GetEntityByIdAsync(string idValue, ...)` (`IEntityQueryService.cs:105-113`), returns the raw
    `Result<TEntity>` (the entity itself) for command handlers that need to mutate it; takes the id as a
    string plus an optional `idField` (defaulting to `"Id"`) so non-`Id` lookups are possible.
  - `GetByIdAsync(TIdentifierType id, ...)` (`IEntityQueryService.cs:127-134`), returns a projected
    `Result<object>` (typed DTO, or shaped object when a field subset was requested) for read-only detail
    responses.
  - `ExistsAsync(Expression<Func<TEntity, bool>> where, bool ignoreQueryFilters = false, ...)`
    (`IEntityQueryService.cs:143-146`), a cheap existence check. Note it returns a bare `Task<bool>`, not
    a `Result`: absence is an answer, not a failure. `ignoreQueryFilters` bypasses the global query
    filters (soft-delete), which is how a uniqueness check can still see a soft-deleted row.
  Note that all four scoped reads take the **interface** `ISpecification<TEntity, TIdentifierType>`,
  not the abstract base class, so any implementation (including a hand-rolled one that does not derive
  from [`Specification`](#specificationtentity-tidentifiertype)) can scope a read.
- **Why it's built this way**: a single generic read contract over every entity lets the generic
  controller base (G12) expose uniform list/detail/lookup/exists endpoints without per-entity query
  code, while the `object` return plus `fields` shaping keeps the wire payload caller-controlled without
  paying a shaping cost when no projection is asked for. Splitting `GetEntityByIdAsync` (raw entity) from
  `GetByIdAsync` (shaped DTO) cleanly separates the command-side need (an aggregate to mutate) from the
  query-side need (a projected response).
  [ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html) records the
  trade-offs of the generic read layer.
- **Where it's used**: implemented by
  [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](#entityqueryservicetentity-tentitydto-tidentifiertype),
  which delegates navigation classification to
  [`INavigationMetadataProvider`](#inavigationmetadataprovider) and the heavy lifting to
  [`IEntityQueryPipeline`](#ientityquerypipeline); consumed by every read endpoint through the generic
  controller base (G12), for example ADC's
  [`SessionsController`](group-20-conference-api-grpc.md#sessionscontroller).

---

### CrossSourceSpecification
> MMCA.Common.Application · `MMCA.Common.Application.Specifications` · `MMCA.Common/Source/Core/MMCA.Common.Application/Specifications/CrossSourceSpecification.cs:22` · Level 8 · class (public, static)

- **What it is**: a static helper that builds a specification filtering a *dependent* entity by a
  condition on a **cross-source principal** it references by foreign key. Its single public method,
  `BuildAsync`, resolves the matching principal keys first (a scalar projection query against the
  principal's own data source) and returns an
  [`InlineSpecification`](#inlinespecificationtentity-tidentifiertype) whose criteria is the
  engine-portable `localPredicate AND principalKeys.Contains(dependent.ForeignKey)`.
- **Depends on**: [`InlineSpecification<TEntity, TIdentifierType>`](#inlinespecificationtentity-tidentifiertype)
  and [`Specification<TEntity, TIdentifierType>`](#specificationtentity-tidentifiertype) (the return
  type), [`ParameterReplacer`](#parameterreplacer) (the shared rebind visitor, reached through
  `InternalsVisibleTo`), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) with
  `GetReadRepository<,>` / `GetProjectedAsync` (G07) to query the principal source,
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (the `TPrincipal` constraint) and
  [`IBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#ibaseentitytidentifiertype)
  (the `TDependent` constraint); `System.Linq.Expressions` (BCL).
- **Concept introduced, cross-source filtering under polyglot persistence `[Rubric §8, Data
  Architecture]`.** In a database-per-service
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) or polyglot
  ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)) setup an entity and a
  related entity can live in *different physical data sources* (e.g. a Cosmos-stored `Session`
  referencing a SQL-Server `Event`). A query cannot join across physical sources, so a predicate that
  *navigates*, `s => s.Event.IsPublished`, is not translatable; on Cosmos the cross-source navigation is
  even degraded out of the model entirely by
  [`CrossDataSourceDegradeConvention`](group-07-persistence-ef-core.md#crossdatasourcedegradeconvention).
  The engine-portable alternative is **resolve-then-filter-by-FK**: read the principal keys that satisfy
  the condition from the principal's own source, then filter the dependent by `foreignKey IN (those
  keys)`, which every provider translates (SQL `IN`, Cosmos `ARRAY_CONTAINS`). The convention is enforced
  by the opt-in fitness rule
  [`ArchitectureRules`](group-27-testing-infrastructure.md#architecturerules)`.SpecificationsDoNotNavigateToOtherEntities`
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
    `TPrincipal : AuditableBaseEntity<TPrincipalId>` (`:47`), and the three reference arguments are
    null-guarded up front (`:50-52`).
  - Resolves keys: `unitOfWork.GetReadRepository<TPrincipal, TPrincipalId>()` (`:54`) then
    `GetProjectedAsync(p => p.Id, principalPredicate, asTracking: false, cancellationToken)` (`:55-57`),
    materialized once into a list (`:60`) so the predicate embeds a stable collection EF can translate.
  - `BuildCriteria` (`:66-91`) reuses the FK selector's own parameter (`:71`) and builds
    `Enumerable.Contains(keys, fk)` via `Expression.Call` (`:74-79`); if a `localPredicate` is supplied
    it is rebound onto that same parameter via [`ParameterReplacer`](#parameterreplacer) (`:86`) and
    ANDed with `Expression.AndAlso` (`:87`), deliberately **not** `Expression.Invoke`, so the combined
    predicate stays translatable on every provider. The comment there (`:83-85`) also records that the
    visitor is the one the Domain composers use, shared rather than duplicated here. The finished body
    is wrapped as a lambda over that parameter (`:90`).
- **Why it's built this way**: it makes a module's storage engine a movable choice
  ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)): a
  session-by-published-event filter written this way keeps working whether `Session` is in SQL Server,
  SQLite, or Cosmos, with no query rewrite. Returning an `InlineSpecification` means the result drops
  straight into the existing [`IEntityQueryService`](#ientityqueryservicetentity-tentitydto-tidentifiertype)
  and read-repository `specification` argument.
- **Where it's used**: two ADC Conference call sites, both resolving published `Event` ids and filtering
  `Session.EventId IN (...)` ANDed with the shared status allow-list
  [`PublicSessionStatusSpecification`](group-18-conference-application.md#publicsessionstatusspecification)`.StatusCriteria`
  (BR-49: status unset or `Accepted`; the event scoping is BR-108):
  [`GetPublicSessionFilterHandler`](group-18-conference-application.md#getpublicsessionfilterhandler)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterHandler.cs:29`),
  which supplies the specification for the public session reads, and
  [`PublicConferenceVisibility`](group-18-conference-application.md#publicconferencevisibility)`.GetVisibleSessionIdsAsync`
  (`.../Common/PublicConferenceVisibility.cs:62`), which uses the identical criteria to resolve the
  visible session ids so a session hidden from the session list cannot stay reachable through a speaker
  or junction read.
- **Caveats / not-in-source**: the matching keys are materialized and embedded in the predicate, so this
  fits **small/bounded** principal sets (the common "published events", "active tenants" shape); an
  unbounded principal set would inline a very large `IN` list. The class doc
  (`CrossSourceSpecification.cs:17-20`) states this explicitly. It is also a point-in-time snapshot: the
  keys are read before the dependent query runs, so a principal that changes state in between is not
  reflected until the specification is rebuilt.


---
[⬅ Domain Building Blocks (Entities, Value Objects, Aggregates)](group-02-domain-building-blocks.md)  •  [Index](00-index.md)  •  [Domain & Integration Events + Outbox Dual-Dispatch ➡](group-04-events-outbox.md)
