# Generic entity controllers and the dynamic query contract (ADR-034)

> Series: MMCA.Common · Article #28 (deep-dive) · Pillar P2 · Group G12 · Rubric §9 ·
> ADR-034, ADR-125 · Status: grounded in `Website/docs-src/adr/034-generic-entity-query-layer.md`,
> `Website/docs-src/adr/125-parameterized-sql-only.md`,
> `EntityControllerBase.cs`, `AggregateRootEntityControllerBase.cs`, `EntityCsvExporter.cs`,
> `QueryFilterModelBinder.cs`, `EntityQueryService.cs`, `EntityQueryPipeline.cs`,
> `QueryFilterService.cs`, `QueryFieldService.cs`, `DynamicQueryConfig.cs`, `ApplicationSettings.cs`,
> `IRawSqlQueryExecutor.cs`, `RawSqlConventionTestsBase.cs`. No em dashes.

**Subtitle:** The write-once REST surface every entity inherits. How list, page, lookup, by-id, create, and delete come from two base classes, plus a bounded OData-lite query contract that is dynamic over the wire but never open SQL in the engine.

---

Here is a controller that looks fine until you have a second entity:

```csharp
[ApiController]
[Route("products")]
public sealed class ProductsController : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetAll(
        string? sort, string? dir, int page = 1, int size = 20,
        string? name = null, decimal? minPrice = null)   // ad-hoc filter params
    {
        var q = _db.Products.AsQueryable();
        if (name is not null) q = q.Where(p => p.Name.Contains(name));      // hand-rolled
        if (minPrice is not null) q = q.Where(p => p.Price >= minPrice);    // hand-rolled
        if (sort == "name")
            q = dir == "desc" ? q.OrderByDescending(p => p.Name) : q.OrderBy(p => p.Name);
        var items = await q.Skip((page - 1) * size).Take(size).ToListAsync();
        return Ok(items);   // no total count, no page-size cap, leaks the entity to the wire
    }
    // ... GetById, Create, Delete, each subtly different from CategoriesController
}
```

Now write `CategoriesController`, `OrdersController`, and twenty more. A different person writes each one in a different sprint. One paginates with `page`/`size`, the next with `pageNumber`/`pageSize`. One filters with `?name=`, another with `?nameContains=`. One returns a total count, most do not. One forgets the `Take` clamp entirely, so a query with no filter streams the whole table into memory. Each leaks its EF entity straight to JSON, so a column rename is a silent wire break. This is the single largest pile of boilerplate a modular monolith accumulates as it grows, and the pile drifts in shape with every commit.

A client cannot learn one query dialect and reuse it. It learns one per resource, defensively, and still gets surprised. And the day you want a uniform feature (a max page size, a filter operator, a sparse-fieldset projection) you are editing dozens of controllers by hand and missing some.

## Why it matters

Most entities need the same six things: list them, page through them, fetch a lightweight id/name list for a dropdown, get one by id, create one, delete one. That surface is so uniform that hand writing it per entity is pure repetition, and repetition without a single source of truth is how drift gets in. The shape that should be identical across a hundred entities ends up almost-identical, which is worse than identical because callers cannot rely on it.

There is also a safety dimension. A read endpoint with no upper bound on result size is one missing `Where` clause away from a full-table load that pins a database. A filter parameter assembled from raw client input is an injection and over-fetch surface. If those guards are the responsibility of each author, they are missing somewhere.

ADR-034 records the framework's opposite default: write the resource surface and the query contract once, on a base class, and let every entity inherit it. A concrete controller becomes a few lines that close the generic type parameters. The verbs, routes, filtering, sorting, pagination, field projection, include behavior, and the safety ceiling all come from the base. New entities cost almost nothing and cannot drift in shape.

## The MMCA answer: two base classes and an OData-lite contract

The read surface is `EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`. It is an `[ApiController]` with `[Route("[controller]")]` and `[ApiVersion("1.0")]`, and it exposes five GET routes that any entity inherits for free: `[HttpGet]` for the capped list, `[HttpGet("paged")]` for the filterable/sortable page, `[HttpGet("export")]` for a streamed CSV of the same filtered, sorted, projected rows, `[HttpGet("lookup")]` for an id/name dropdown collection (`CollectionResult<BaseLookup<TIdentifierType>>`), and `[HttpGet("{id}")]` for a single record.

The write surface is `AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`. It inherits all five reads and adds `[HttpPost]` create (returning `201 CreatedAtRoute`) and `[HttpDelete("{id}")]` (returning `204 NoContent`). The create action is decorated `[Idempotent]`, so a retried POST carrying the same `Idempotency-Key` header replays the original response instead of creating a duplicate (ADR-017).

A concrete controller is the whole thing:

```csharp
[Route("products")]
public sealed class ProductsController(
    IEntityQueryService<Product, ProductDTO, int> queryService,
    ICommandHandler<CreateProductRequest, Result<ProductDTO>> createHandler,
    ICommandHandler<DeleteEntityCommand<Product, int>, Result> deleteHandler,
    ILogger<EntityControllerBase<Product, ProductDTO, int>> logger)
    : AggregateRootEntityControllerBase<Product, ProductDTO, int, CreateProductRequest>(
        queryService, createHandler, deleteHandler, logger);

// That is the entire controller. GET, GET /paged, GET /export, GET /lookup,
// GET /{id}, POST, and DELETE /{id} are all inherited, with filter, sort, page,
// and field projection on the read routes and idempotent create on the write route.
```

What that inheritance buys is a uniform query contract on every list and detail route:

- **Sparse fieldsets.** A comma-separated `fields` query parameter drives a server-side projection. `QueryFieldService.ApplyFieldSelection` builds a `MemberInit` expression that selects only the requested writable properties, so only those columns leave the database, and the compiled expression is cached per entity type and field set so a repeated `fields=` request does not rebuild the tree. That cache is capped at 512 entries, since the field set is client-supplied; past the cap a request skips server-side projection instead of growing the cache further, though the response body is still trimmed to the requested fields. Read-only and computed properties are rejected at validation, since the projection needs setters.
- **Dynamic per-type filtering.** The paged route binds `Dictionary<string, (string Operator, string Value)> filters` through `[ModelBinder(typeof(QueryFilterModelBinder))]`. The binder parses `?filters[Name].operator=contains&filters[Name].value=shirt` style keys (case-insensitive, incomplete pairs silently dropped) into the dictionary. `QueryFilterService.ApplyFilters` then resolves one `IFilterStrategy` per property CLR type from a strategy registry (string, bool, int, long, DateTime, decimal, Guid and their nullables out of the box), and each strategy declares the operator set it `SupportedOperators`. This is the load-bearing constraint: filtering is dynamic over the wire but it is not free-form expression evaluation. Every property routes through a registered strategy, and `QueryFilterService.ValidateFilters` rejects an unknown property or an unsupported operator before the database is touched.
- **Sort.** `sortColumn` and `sortDirection` feed `QueryFieldService.ApplySorting`, an `OrderBy("<col> ascending|descending")` over the entity property the DTO name maps to. On a paginated query the pipeline appends `Id ascending` as a final tie-break key, so `Skip`/`Take` runs over a total order even when the requested sort column has duplicates.
- **Pagination and the `X-Pagination` header.** The paged route clamps the requested page size with `Math.Min(pageSize, MaxPageSize)`. `MaxPageSize` reads `ApplicationSettings.MaxPageSize` through `IOptions<ApplicationSettings>`, falls back to 500, and is itself clamped to the range 1 to `EntityQueryPipeline.MaxUnboundedResultLimit` (1000), so a configured value above 1000 has no effect and the pagination metadata never promises a page size the pipeline does not serve. The pagination metadata (total count, page size, current page) is serialized into the `X-Pagination` response header as JSON, so the body stays just the items.
- **A streamed CSV export.** `[HttpGet("export")]` reuses the same filter, sort, and `fields` contract and writes rows to the response body a page at a time, so the file never lands in memory. Row scoping is fail-closed: the export reads through the same `GetReadSpecificationAsync` hook as the list routes, and when that hook resolves to no specification the request is refused with a 403 (`Export.RowScopeRequired`) before anything is queried, unless the controller opts in through `AllowUnscopedExport`. It stops at `MaxExportRows` (`ApplicationSettings.MaxExportRows`, where an unset, zero, or negative value falls back to 100,000), announces that ceiling up front in an `X-Export-Row-Limit` header, and ends a truncated file with a trailing marker row: headers are frozen the moment the first body byte is flushed, so the marker is the only signal still writable once the export is under way. It takes no `includeChildren`, since a child collection has no faithful representation in a flat CSV cell.
- **A last-resort ceiling.** Independent of the API clamp, `EntityQueryPipeline.MaxUnboundedResultLimit = 1000` caps any unpaginated query with `query.Take(MaxUnboundedResultLimit)`. Even a direct service caller who omits pagination entirely cannot trigger an unbounded full-table load.
- **Two include paths.** `includeFKs` and `includeChildren` select navigation loading, and `EntityQueryPipeline` runs one of two strategies. PATH 1 handles source-supported includes via EF Core `.Include()` translated to SQL (forcing split-query when a child collection is included, so pagination does not truncate the JOIN-expanded rows). PATH 2 handles includes the source cannot JOIN by materializing the page first, then batch-loading related data via an `INavigationPopulator` (the cross-source loader of ADR-002).

Under all of this sits `EntityQueryService`, which validates the parameters up front, runs the pipeline, and projects the materialized entities to DTOs through an injected `IEntityDTOMapper` (the manual mapping of ADR-001). Every action returns a `Result`, and a failure flows through `HandleFailure(result.Errors)` into the same RFC 9457 Problem Details shape the rest of the API uses (ADR-013). The wire speaks DTO names; the engine speaks entity names; a per-service `DTOToEntityPropertyMap` translates between them for filtering and sorting.

## The line where the user's value stops being code

There is one more constraint under all of this, and it is the one that decides whether a
user-supplied filter DSL is a good idea or a liability. When a strategy builds its predicate, the
property name is interpolated into the expression string but **the user's value never is**:

```csharp
"CONTAINS" => query.Where(DynamicQueryConfig.Parameterized, $"{property}.Contains(@0)", value),
"EQUALS"   => query.Where(DynamicQueryConfig.Parameterized, $"{property} == @0", value),
```

The asymmetry is deliberate. `property` has already survived `ValidateFilters`, so it is a name from
a known allow-list rather than user text. `value` is arbitrary user input, and it is passed as the
`@0` argument, never concatenated into the predicate.

That alone is the injection story, but the `DynamicQueryConfig.Parameterized` part is the half most
teams miss. System.Linq.Dynamic.Core defaults `UseParameterizedNamesInDynamicQuery` to `false`, which
turns each `@0` argument into a `ConstantExpression`. EF inlines constants. So with the default
config, `filters["Name"] = ("EQUALS", "Widget")` emits:

```sql
WHERE [Name] = 'Widget'
```

A distinct SQL string per distinct filter value. Every search term a user types costs its own SQL
Server plan-cache entry and misses EF's compiled-query cache on the way in. The filter DSL you built
for convenience quietly becomes a plan-cache eviction engine, and the symptom is not a slow query,
it is the whole instance getting slower as the cache churns.

Flipping the flag on makes the value reachable through a member access instead, so EF parameterizes
it and one plan serves every value. The config is a single shared static, because building a
`ParsingConfig` per call would reintroduce the parse cost it exists to avoid, and
`QueryParameterizationTests` is the guard that keeps a new strategy from forgetting to pass it.

This is worth internalizing as a general shape: the same change bought both a closed injection
surface and a fixed plan-cache hit rate, because both problems have the same root cause, which is a
user's value ending up in the text of a query instead of beside it.

## The same rule for hand-written SQL

The filter DSL is not the only path from a caller's value to the database. Some reads need a window
function, a recursive CTE, or a vendor-specific operator that LINQ cannot express, and ADR-125 gives
those exactly one door: `IRawSqlQueryExecutor`. Its two methods, `QueryAsync<T>` and
`QuerySingleOrDefaultAsync<T>`, accept a `FormattableString` and nothing else. The provider turns
every interpolation hole into a command parameter, and a concatenated statement is a plain `string`
that does not compile against either method:

```csharp
// Compiles: customerId becomes a command parameter, and the statement text stays stable.
var count = await rawSql.QuerySingleOrDefaultAsync<int>(
    $"SELECT COUNT(*) FROM Orders WHERE CustomerId = {customerId}", cancellationToken);

// Does not compile: concatenation produces a string, not a FormattableString.
// await rawSql.QueryAsync<OrderRow>("SELECT * FROM Orders WHERE Name = '" + name + "'");
```

The signature closes the door it owns, but it cannot stop module code from calling EF Core directly,
where `FromSqlRaw`, `SqlQueryRaw`, `ExecuteSqlRaw`, and `ExecuteSqlRawAsync` take a plain string and
sit one word away from their parameterizing twins. So the ban is a fitness test rather than a
guideline: `RawSqlConventionTestsBase.ModuleCode_UsesParameterizedSqlOnly` scans the source of every
mapped module, fails on any of those four members, and names `FromSql`/`SqlQuery`/`ExecuteSql` or
`IRawSqlQueryExecutor` as the replacement in its failure message, so the test output is the
instruction. A scan that finds no module directories fails instead of passing vacuously. MMCA.Store
subclasses the base with its own architecture map and an explicitly empty `AllowedFiles` list, so
every new raw call site in the store is a build failure. The root cause is the one above: the value
belongs beside the query text, never inside it, and plan reuse comes with it.

The limits are worth stating. `FormattableStringFactory.Create` can still wrap an already-concatenated
string, so the contract blocks the careless path rather than proving safety. The test is a textual
scan of exactly four member names, so SQL reaching the database through raw ADO.NET or a micro-ORM is
outside it. And the executor is relational only: a host whose default source is Cosmos DB has no
registration, so injecting the interface there fails when the container is validated.

## Trade-offs, honestly

A generic, dynamically queryable contract coupled to the entity model is a real trade against narrow bespoke endpoints. ADR-034 names the costs rather than hiding them.

- **The wire contract tracks the entity model.** What is filterable, sortable, and projectable is the entity's property set, so a model change is an API change by default. The boundary that decouples them is the DTO plus `DTOToEntityPropertyMap`: a subclass overrides the map to point a DTO field name (`CategoryName`) at an entity path (`Category.Name`), and the wire name stops moving with the column.
- **Dynamic filtering is an injection and over-fetch surface, and it is bounded, not open.** Arbitrary client-supplied property/operator/value triples are an attack surface. The framework bounds it three ways: `ValidateFilters` rejects unknown properties and unsupported operators before any query runs, each type is filtered only by its registered `IFilterStrategy` rather than free-form expression evaluation, and `MaxUnboundedResultLimit` caps rows. This is per-type strategy filtering, deliberately narrower than full OData.
- **Generic endpoints are less self-documenting than bespoke ones.** One uniform shape per entity is consistent but conveys less domain intent than a named, purpose-built endpoint. The filter-key syntax and operator names are learned once across the API rather than read off each endpoint.
- **Opting out means overriding, not abandoning.** All five reads and both writes are `virtual`. A controller that needs bespoke behavior overrides the specific action and keeps the rest, but the default surface is opt-out, not opt-in: you inherit the whole contract whether or not you wanted every route.

## Apply this even without MMCA

The pattern ports to any stack where you expose more than a handful of CRUD resources:

1. **Put the CRUD shape on a generic base and close the type parameters per entity.** The verbs, routes, and response shapes belong in one place, inherited, not copied. A new entity should be a few lines, not a new file of near-duplicate actions.
2. **Parse filter, sort, and page once into a typed structure.** A single model binder that turns a structured query string into a `(property, operator, value)` dictionary beats per-action parameter lists that drift in name and semantics.
3. **Filter through a per-type strategy registry with validated operators.** Resolve a strategy by the property's CLR type and validate the operator up front. That is dynamic without being arbitrary, and it keeps free-form expression evaluation (the injection risk) out of the engine.
4. **Always cap an unpaginated read.** A last-resort `Take(N)` ceiling in the query pipeline, independent of any API page-size clamp, means a forgotten pagination clause degrades to a bounded result instead of a database-pinning full scan.
5. **Mediate the wire contract through a DTO and a name map.** Projecting entities straight to JSON couples your API to your schema. A DTO plus a DTO-to-entity property map lets a column rename stay an internal change instead of a breaking one.

---

**What we covered:** why hand writing a list/paged/by-id CRUD controller plus ad-hoc filter/sort/paging parsing per entity is the bulk of a monolith's boilerplate and drifts in shape, and how MMCA.Common answers with two base classes (`EntityControllerBase` for the five reads, `AggregateRootEntityControllerBase` for idempotent create and delete) over a shared `EntityQueryService` and `EntityQueryPipeline`, plus a bounded OData-lite query contract: sparse `fields` projection, `QueryFilterModelBinder` plus per-type `IFilterStrategy` filtering with up-front validation, sort, an `X-Pagination` header with a `MaxPageSize` clamp, a streamed CSV export bounded by `MaxExportRows`, a `MaxUnboundedResultLimit` ceiling, and a two-path include strategy, composing with manual DTO mapping (ADR-001), navigation populators (ADR-002), the Result edge (ADR-013), and idempotency (ADR-017), with hand-written SQL held to the same parameterize-the-value rule by the `FormattableString`-only `IRawSqlQueryExecutor` and a fitness test that bans EF's raw-string members (ADR-125).

**Next in the series:** resource-ownership authorization, the row-level axis that decides not just what a caller may do but which rows they may touch.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-034 behind this pattern, or `dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-034 (generic entity query layer): `Website/docs-src/adr/034-generic-entity-query-layer.md` in the docs site.

*Tags: .NET, C Sharp, Web API, Software Architecture, Programming*

*Notes: 2026-10-02 refresh (MMCA.Common v1.221.0). Every citation below was re-read against current source in this run; paths are under `MMCA.Common/` unless stated. Substance changes this pass: the pagination bullet (`MaxPageSize` is `Math.Clamp(settings?.MaxPageSize ?? 500, 1, EntityQueryPipeline.MaxUnboundedResultLimit)` read through `IOptions<ApplicationSettings>`, `Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:59-64`, rationale `:55-57`, so a configured value above 1000 has no effect; the prior text named `IApplicationSettings` and a bare 500 fallback); the export bullet (settings type corrected, fail-closed row scoping added); the Sort bullet (pagination tie-break added, closing the prior UNVERIFIABLE item); and the section "The same rule for hand-written SQL", a user-approved ADR-125 fold-in.
Controllers. `EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>` (`EntityControllerBase.cs:34`) with `[ApiController]`/`[Route("[controller]")]`/`[ApiVersion("1.0")]` (`:31-33`). The five GET routes: `[HttpGet]` (`:107`, action `GetAllAsync` `:110`, capped at `pageSize: MaxPageSize` `:124`), `[HttpGet("paged")]` (`:154`, action `:158`), `[HttpGet("export")]` (`:252`, action `ExportAsync` `:257`), `[HttpGet("lookup")]` returning `CollectionResult<BaseLookup<TIdentifierType>>` (`:317`, `:320`), `[HttpGet("{id}")]` (`:356`, action `:361`); all five `public virtual` (`:110,158,257,320,361`). `Math.Min(pageSize, MaxPageSize)` (`:169`); `X-Pagination` serialized (`:188`); `HandleFailure(result.Errors)` (`:129`, logging override `:451`); `MaxPageSize` default 500 at `Source/Core/MMCA.Common.Application/Settings/ApplicationSettings.cs:17`. Export: `[ModelBinder(typeof(QueryFilterModelBinder))]` filters (`:262`); fail-closed scoping via `GetReadSpecificationAsync` (`:270-274`, remarks `:231-238`), `ExportRowScopeRequiredErrorCode = "Export.RowScopeRequired"` (`:487`), `AllowUnscopedExport` default `false` (`:508`); `MaxExportRows` read through `IOptions<ApplicationSettings>` with zero-or-less treated as unconfigured (`:79-85`, remarks `:74-78`), `DefaultMaxExportRows = 100_000` (`:472`, settings default `ApplicationSettings.cs:33`); `ExportRowLimitHeaderName = "X-Export-Row-Limit"` (`:481`) appended by `BeginExportResponse` (`:619`, append `:625`, passed as the begin callback `:296`); export page size `Math.Max(1, MaxPageSize)` (`:277`); `includeChildren: false` (`:283`) with the flat-CSV rationale (`:223-224`); frozen-headers rationale (`:214-220`). Streaming lives in `EntityCsvExporter<TEntityDTO>` (`Source/Presentation/MMCA.Common.API/Export/EntityCsvExporter.cs:17`), handed `Response.Body` (`EntityControllerBase.cs:279-280`), begin callback invoked at `EntityCsvExporter.cs:160`, flushes at `:212` and `:220`, marker text `# export truncated at {rowsWritten} rows` at `:357`. `AggregateRootEntityControllerBase` (`Source/Presentation/MMCA.Common.API/Controllers/AggregateRootEntityControllerBase.cs:28`): `[HttpPost][Idempotent]` (`:59-60`), `CreateAsync` virtual (`:64`), `CreatedAtRoute` with `Get{TEntity.Name}ById` (`:73-74`); `[HttpDelete("{id}")]` (`:85`), `DeleteAsync` virtual (`:90`), `DeleteEntityCommand` (`:94`), `NoContent()` (`:98`). `QueryFilterModelBinder` sealed (`Source/Presentation/MMCA.Common.API/ModelBinders/QueryFilterModelBinder.cs:24`), case-insensitive dictionary (`:42`), key loop (`:46`), incomplete entries removed (`:74-79`).
Query layer. `EntityQueryService` (`Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs`): `dtoMapper` (`:36`), `navigationPopulator` (`:37`), `DTOMapper` (`:91`), `NavigationPopulator` (`:94`), `DTOToEntityPropertyMap` (`:101`), up-front `Result.Combine` validation including `ValidateFilters` (`:297-301`), `NavigationPopulator.PopulateAsync` passed to the pipeline (`:356`, `:587`), `MapToDTOs` (`:360`), `MapToDTO` (`:510`). `EntityQueryPipeline` sealed (`Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:13`); `MaxUnboundedResultLimit = 1000` (`:23`) applied as `query.Take` at `:99` (projection path `ExecuteProjectedAsync` `:60`), `:195` (PATH 2) and `:250` (PATH 1); PATH 2 dispatch (`:50`, doc `:158`); PATH 1 `.Include()` (`:135`) and `AsSplitQuery` (`:142`, block `:129-142`); `PaginationTieBreakProperty = "Id"` (`:36`) passed only when paginated (`:86`, `:181`, `:234`). `QueryFilterService` (`Services/Filtering/QueryFilterService.cs`): registry string/bool/int/long/DateTime/decimal/Guid plus nullables (`:35-47`), `RegisterStrategy` (`:62`), `ApplyFilters` (`:78`, field-contract overload `:99`), `ValidateFilters` (`:159`, overload `:175`). `IFilterStrategy` `Apply` and `SupportedOperators` (`Services/Filtering/IFilterStrategy.cs:6,17,24`). The two quoted strategy lines are verbatim from `Services/Filtering/StringFilterStrategy.cs:32` and `:34` (switch `:30`). `DynamicQueryConfig` (`Services/Filtering/DynamicQueryConfig.cs`): class doc carrying the `ConstantExpression` / EF-inlines-constants / `WHERE [Name] = 'Widget'` / plan-cache explanation and naming the guard (`:5-17`), single-instance rationale (`:20`), `Parameterized` with `UseParameterizedNamesInDynamicQuery = true` (`:21-24`); the guard exists at `Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Specifications/QueryParameterizationTests.cs:26`. `QueryFieldService` (`Services/QueryFieldService.cs`): `MaxCacheEntries = 512` (`:39`), `tieBreakProperty` doc (`:134-135`), `ApplySorting` (`:155`, overload `:184`), `BuildOrdering` (`:259`) building `"<col> ascending|descending"` (`:262`) and appending the tie-break (`:264-267`), `ApplyFieldSelection` (`:279`), lock-free `TryGetValue` hit path (`:291`), cap check that skips server-side projection (`:298`), `GetOrAdd` on a miss (`:301-303`), cap design note (`:324-327`), `ProjectionCache` (`:330`), `BuildProjection` (`:332`) with the `CanWrite` filter (`:337`) and `Expression.MemberInit` (`:352`).
ADR-125 fold-in. `Website/docs-src/adr/125-parameterized-sql-only.md` (Accepted 2026-09-19, citation revision 2026-10-01). `IRawSqlQueryExecutor` (`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRawSqlQueryExecutor.cs:24`): window function / CTE / vendor operator purpose (`:4-7`), parameterized-by-construction doc (`:9-15`), relational only with no registration on a Cosmos-default host and failure at container validation (`:18-21`), `QueryAsync<T>(FormattableString ...)` (`:31`), `QuerySingleOrDefaultAsync<T>(FormattableString ...)` (`:39`). `RawSqlConventionTestsBase` (`Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Cqrs/RawSqlConventionTestsBase.cs:31`): `AllowedFiles` default empty (`:39`), `ModuleCode_UsesParameterizedSqlOnly` (`:66`), vacuous-scan failure (`:72`), file-name allow-list check (`:81`), failure message naming the replacements (`:91-94`), four-member regex (`:115`). MMCA.Store subclass `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Cqrs/RawSqlConventionTests.cs:12`, its map (`:15`) and explicitly empty `AllowedFiles` (`:18`). The `FormattableStringFactory.Create` bypass and the textual-scan limits are from the ADR's Trade-offs (`125-parameterized-sql-only.md:122-135`). Observed drift, not acted on here: ADR-125 cites a `NotSupportedException` in `EFRawSqlQueryExecutor.cs:46-52`, but in v1.221.0 that file has none (it calls `Database.SqlQuery<T>` at `Source/Core/MMCA.Common.Infrastructure/Persistence/EFRawSqlQueryExecutor.cs:51`); the article states the relational limit from the interface doc instead.
ADR-034: `Website/docs-src/adr/034-generic-entity-query-layer.md` (Accepted 2026-06-30, amended 2026-07-23 and 2026-07-25, extended by ADR-099 with a `CrudEntityControllerBase` alongside the two bases this article describes, `:3-12`; export route `:44`). History: 2026-07-27 added the parameterization section; 2026-08-14 corrected four GET routes to five (the export route); 2026-09-19 anchors-only pass at v1.205.0. The cold-open controller, the `ProductsController` block and the raw-SQL snippet are illustrative of the documented shape, not copied from a source file; every type, route, default and behavior they reference is grounded above.*

- Full series index: https://ivanball.github.io/writing.html
