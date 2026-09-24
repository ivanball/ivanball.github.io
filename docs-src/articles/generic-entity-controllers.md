# Generic entity controllers and the dynamic query contract (ADR-034)

> Series: MMCA.Common · Article #28 (deep-dive) · Pillar P2 · Group G12 · Rubric §9 ·
> ADR-034 · Status: grounded in `Website/docs-src/adr/034-generic-entity-query-layer.md`,
> `EntityControllerBase.cs`, `AggregateRootEntityControllerBase.cs`,
> `QueryFilterModelBinder.cs`, `EntityQueryService.cs`, `EntityQueryPipeline.cs`,
> `QueryFilterService.cs`, `QueryFieldService.cs`, `ApplicationSettings.cs`. No em dashes.

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
- **Sort.** `sortColumn` and `sortDirection` feed `QueryFieldService.ApplySorting`, an `OrderBy("<col> ascending|descending")` over the entity property the DTO name maps to.
- **Pagination and the `X-Pagination` header.** The paged route clamps the requested page size with `Math.Min(pageSize, MaxPageSize)`, where `MaxPageSize` reads `IApplicationSettings.MaxPageSize` and falls back to 500. The pagination metadata (total count, page size, current page) is serialized into the `X-Pagination` response header as JSON, so the body stays just the items.
- **A streamed CSV export.** `[HttpGet("export")]` reuses the same filter, sort, and `fields` contract and writes rows to the response body a page at a time, so the file never lands in memory. It stops at `MaxExportRows` (`IApplicationSettings.MaxExportRows`, falling back to 100,000), announces that ceiling up front in an `X-Export-Row-Limit` header, and ends a truncated file with a trailing marker row: headers are frozen the moment the first body byte is flushed, so the marker is the only signal still writable once the export is under way. It takes no `includeChildren`, since a child collection has no faithful representation in a flat CSV cell.
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

**What we covered:** why hand writing a list/paged/by-id CRUD controller plus ad-hoc filter/sort/paging parsing per entity is the bulk of a monolith's boilerplate and drifts in shape, and how MMCA.Common answers with two base classes (`EntityControllerBase` for the five reads, `AggregateRootEntityControllerBase` for idempotent create and delete) over a shared `EntityQueryService` and `EntityQueryPipeline`, plus a bounded OData-lite query contract: sparse `fields` projection, `QueryFilterModelBinder` plus per-type `IFilterStrategy` filtering with up-front validation, sort, an `X-Pagination` header with a `MaxPageSize` clamp, a streamed CSV export bounded by `MaxExportRows`, a `MaxUnboundedResultLimit` ceiling, and a two-path include strategy, composing with manual DTO mapping (ADR-001), navigation populators (ADR-002), the Result edge (ADR-013), and idempotency (ADR-017).

**Next in the series:** resource-ownership authorization, the row-level axis that decides not just what a caller may do but which rows they may touch.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-034 behind this pattern, or `dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-034 (generic entity query layer): `Website/docs-src/adr/034-generic-entity-query-layer.md` in the docs site.

*Tags: .NET, C Sharp, Web API, Software Architecture, Programming*

*Notes: 2026-07-27 coverage addition: the section "The line where the user's value stops being code"
was added to close a recorded gap (dynamic-LINQ query parameterization had no home anywhere in the
series). Grounded in `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/DynamicQueryConfig.cs`:
the shared `ParsingConfig` static `Parameterized` with `UseParameterizedNamesInDynamicQuery = true`
(`:21-24`), and its class doc (`:9-15`), which is the source of the `ConstantExpression` /
EF-inlines-constants / `WHERE [Name] = 'Widget'` / plan-cache-entry-per-value explanation and names
`QueryParameterizationTests` as the guard. The two quoted strategy lines are verbatim from
`Services/Filtering/StringFilterStrategy.cs:23,25`; the property-vs-value asymmetry is visible in the
same switch (`:23-30`), and `ValidateFilters` rejecting an unknown property is already cited below.
2026-08-14 correction: the read surface is FIVE GET routes, not four. A `[HttpGet("export")]` CSV action sits between the paged and lookup routes, which was both a substance fix (the summary, the concrete-controller comment, the query-contract list, the `virtual` trade-off bullet, and the coverage paragraph all said four) and the reason every `EntityControllerBase.cs` anchor moved by roughly twenty-five to two hundred lines in that pass. ADR-034 records the route (`Website/docs-src/adr/034-generic-entity-query-layer.md:44`). `EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>` class (`Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:36`) + `[ApiController]`/`[Route("[controller]")]`/`[ApiVersion("1.0")]` (`EntityControllerBase.cs:33-35`); the five GET routes `[HttpGet]` list (`EntityControllerBase.cs:106`, action `GetAllAsync` `EntityControllerBase.cs:109`), `[HttpGet("paged")]` (`EntityControllerBase.cs:153`, action `EntityControllerBase.cs:157`), `[HttpGet("export")]` (`EntityControllerBase.cs:247`, action `ExportAsync` `EntityControllerBase.cs:251`), `[HttpGet("lookup")]` returning `CollectionResult<BaseLookup<TIdentifierType>>` (`EntityControllerBase.cs:371,374`), `[HttpGet("{id}")]` (`EntityControllerBase.cs:410,415`); `fields` query param (`EntityControllerBase.cs:110,162,255,419`); `[ModelBinder(typeof(QueryFilterModelBinder))] Dictionary<string,(string Operator,string Value)> filters` (`EntityControllerBase.cs:165,256`); `sortColumn`/`sortDirection` (`EntityControllerBase.cs:160-161`); `Math.Min(pageSize, MaxPageSize)` clamp (`EntityControllerBase.cs:168`); `MaxPageSize` reads `IApplicationSettings.MaxPageSize` and falls back to 500 (`EntityControllerBase.cs:58-63`, default at `Source/Core/MMCA.Common.Application/Settings/ApplicationSettings.cs:17`); `X-Pagination` header serialized (`EntityControllerBase.cs:187`); `HandleFailure(result.Errors)` (`EntityControllerBase.cs:128`, the logging override at `EntityControllerBase.cs:505`); the five reads are `virtual` (`EntityControllerBase.cs:109,157,251,374,415`). The export bullet: page-at-a-time streaming into `Response.Body` (`EntityControllerBase.cs:277`) with a flush per page (`EntityControllerBase.cs:323,352`); `MaxExportRows` resolved per request from `IApplicationSettings.MaxExportRows` with a zero-or-less value treated as unconfigured (`EntityControllerBase.cs:78-84`), falling back to `DefaultMaxExportRows = 100_000` (`EntityControllerBase.cs:526`, settings default at `ApplicationSettings.cs:33`); the `X-Export-Row-Limit` header name (`EntityControllerBase.cs:535`) written up front by `BeginExportResponse` (call site `EntityControllerBase.cs:314`, definition `EntityControllerBase.cs:708`); the trailing truncation marker row and the frozen-headers rationale (`EntityControllerBase.cs:347-349`, marker text `EntityControllerBase.cs:837-838`, rationale in the action's remarks `EntityControllerBase.cs:213-218`); no `includeChildren` on this route, passed as `includeChildren: false` with the flat-CSV rationale (`EntityControllerBase.cs:284`, remarks `EntityControllerBase.cs:223`). `AggregateRootEntityControllerBase<...,TCreateRequest>` class (`Source/Presentation/MMCA.Common.API/Controllers/AggregateRootEntityControllerBase.cs:28`); `[HttpPost][Idempotent]` create (`AggregateRootEntityControllerBase.cs:59-60`) returning `201 CreatedAtRoute` with route name `Get{TEntity.Name}ById` (`AggregateRootEntityControllerBase.cs:73-74`); `[HttpDelete("{id}")]` returning `204 NoContent` via `DeleteEntityCommand` (`AggregateRootEntityControllerBase.cs:85,94,98`); both writes `virtual` (`AggregateRootEntityControllerBase.cs:64,90`). `QueryFilterModelBinder` sealed class parsing `filters[Property].operator`/`.value` keys, incomplete pairs dropped (`Source/Presentation/MMCA.Common.API/ModelBinders/QueryFilterModelBinder.cs:24`, case-insensitive dictionary `:42` and key loop `:46`, incomplete entries removed `:73-79`). `EntityQueryService` validates parameters up front in a `Result.Combine` block (`Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:297-301`) then maps via injected `IEntityDTOMapper` (`dtoMapper` ctor param `EntityQueryService.cs:36`, `DTOMapper` property `EntityQueryService.cs:91`, `MapToDTOs` call `EntityQueryService.cs:360`, `MapToDTO` call `EntityQueryService.cs:510`), `DTOToEntityPropertyMap` boundary property (`EntityQueryService.cs:101`), `ValidateFilters` invoked (`EntityQueryService.cs:301`), `INavigationPopulator` (`navigationPopulator` ctor param `EntityQueryService.cs:37`, `NavigationPopulator` property `EntityQueryService.cs:94`, passed to the pipeline as `NavigationPopulator.PopulateAsync` at `EntityQueryService.cs:356` and `EntityQueryService.cs:587`). `EntityQueryPipeline` sealed (`Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:13`); `MaxUnboundedResultLimit = 1000` (`EntityQueryPipeline.cs:23`) applied as `query.Take(MaxUnboundedResultLimit)` at three unpaginated call sites: the projection-pushdown path `ExecuteProjectedAsync` (`EntityQueryPipeline.cs:60`, cap at `EntityQueryPipeline.cs:99`), PATH 2 (`EntityQueryPipeline.cs:195`), and PATH 1 (`EntityQueryPipeline.cs:250`); PATH 1 EF `.Include()` (`EntityQueryPipeline.cs:135`) plus `AsSplitQuery` for child collections (`EntityQueryPipeline.cs:142`, block `EntityQueryPipeline.cs:129-142`), PATH 2 dispatch (`EntityQueryPipeline.cs:50`) and its manual-`INavigationPopulator` body (`EntityQueryPipeline.cs:158-195`). `QueryFilterService.ApplyFilters` (`Source/Core/MMCA.Common.Application/Services/Filtering/QueryFilterService.cs:78`, field-contract overload `QueryFilterService.cs:99`), strategy registry string/bool/int/long/DateTime/decimal/Guid + nullables (`QueryFilterService.cs:35-47`), `RegisterStrategy` (`QueryFilterService.cs:62`), `ValidateFilters` (`QueryFilterService.cs:150`, field-contract overload `QueryFilterService.cs:166`). `IFilterStrategy.Apply` + `SupportedOperators` (`Source/Core/MMCA.Common.Application/Services/Filtering/IFilterStrategy.cs:6,17,24`). `QueryFieldService.ApplyFieldSelection` (`Source/Core/MMCA.Common.Application/Services/QueryFieldService.cs:278`) uses a `ProjectionCache` keyed by (entity type, normalized field set) (`QueryFieldService.cs:329`), checked via a lock-free `TryGetValue` on the hit path (`QueryFieldService.cs:290`) and populated via `GetOrAdd` on a miss (`QueryFieldService.cs:300-302`), capped at `MaxCacheEntries = 512` per type because the field set is client-supplied (`QueryFieldService.cs:39`); past the cap the request skips server-side projection while the response body is still trimmed to the requested fields (`QueryFieldService.cs:297-299`, design note `QueryFieldService.cs:323-326`). On a miss it builds a `MemberInit` over writable properties in `BuildProjection` (`QueryFieldService.cs:331`; `CanWrite` filter `QueryFieldService.cs:336`; `Expression.MemberInit` construction `QueryFieldService.cs:351`), `ApplySorting` (`QueryFieldService.cs:155`, field-contract overload `QueryFieldService.cs:183`) building `"<col> ascending|descending"` (`QueryFieldService.cs:261`) and applying it (`QueryFieldService.cs:196`). ADR-034 itself: `Website/docs-src/adr/034-generic-entity-query-layer.md` (Accepted 2026-06-30, Amended 2026-07-23: the filter strategy registry also covers `long`/`long?` via `LongFilterStrategy`; Amended 2026-07-25: the keyed by-id fast path is named `TryGetFastPathIncludes` in code, `034-generic-entity-query-layer.md:4-6`), extended by ADR-099 (2026-08-29, v1.170.0) with a generic update verb, an `AddEntityCrud` registration and a `CrudEntityControllerBase` (`034-generic-entity-query-layer.md:7-10`), which adds a third base alongside, rather than altering, the two this article describes. 2026-09-19 anchor pass (MMCA.Common v1.205.0): every citation above was re-read against current source and corrected. `EntityControllerBase.cs` anchors moved by roughly 5 to 42 lines and `EntityQueryService.cs` anchors by 1 to 52 lines since the 2026-08-19 pass, ordinary source growth rather than a single rebase event; `ApplicationSettings.MaxExportRows` moved from `:29` to `:33` and the ADR's export-route citation from `:32-37` to `:44`. Route order, defaults, ceilings, and mechanisms are unchanged, so this pass is anchors only. The concrete `ProductsController` block and the hand-written cold-open controller are illustrative of the documented shape, not copied from a specific source file; every type, route, default, and behavior they reference is grounded above.*

- Full series index: https://ivanball.github.io/writing.html
