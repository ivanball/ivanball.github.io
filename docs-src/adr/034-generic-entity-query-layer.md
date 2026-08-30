# ADR-034: Generic Entity Controllers with a Dynamic Query Contract

## Status
Accepted (2026-06-30). Amended (2026-07-23): the filter strategy registry now also
covers `long`/`long?` via `LongFilterStrategy`. Amended (2026-07-25): the keyed
by-id fast path is named `TryGetFastPathIncludes` in code; citations rebased.
**Extended by [ADR-099](099-generic-write-side-entity-commands.md)** (2026-08-29, v1.170.0): the write
half this record left at create and delete gains a generic update, through an
`IEntityUpdateApplier` the module implements, an `UpdateEntityCommand` / `UpdateEntityHandler` pair,
an `AddEntityCrud` registration for all three verbs, and a `CrudEntityControllerBase` carrying the
PUT. The PUT ships on a **new derived base** rather than on `AggregateRootEntityControllerBase`, whose
generic arity is deliberately unchanged; everything below is untouched.

## Context
Every module exposes many entities, and most of them need the same read and write
surface: list, page, look up for a dropdown, fetch by id, create, delete. Hand
writing a controller, a query service, and a filter/sort/paginate implementation
per entity is repetitive, drifts in shape from one entity to the next, and is the
bulk of the boilerplate a modular monolith accumulates as it grows.

The framework chose the opposite default: a generic resource layer plus an
OData-lite dynamic query contract that every entity inherits for free, rather than
bespoke per-entity endpoints. A concrete controller is a few lines that close the
generic type parameters; the verbs, routes, filtering, sorting, pagination, field
projection, and include behavior come from the base. The mechanics are documented
in the onboarding chapters; the trade-off this represents (a generic, dynamically
queryable contract coupled to the entity model versus narrow bespoke endpoints) was
never recorded as a decision.

## Decision
Give every entity a generic REST resource surface and a bounded dynamic query
contract, supplied by two controller bases over a shared query pipeline.

1. **Generic read controller.** `EntityControllerBase<TEntity, TEntityDTO,
   TIdentifierType>`
   (`Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:35`,
   `[ApiController]` / `[Route("[controller]")]` / `[ApiVersion("1.0")]` at
   `EntityControllerBase.cs:32-34`) exposes four core GET routes for any entity
   (plus a `[HttpGet("export")]` CSV action inserted between the paged and lookup
   routes): `[HttpGet]` list (`EntityControllerBase.cs:101`), `[HttpGet("paged")]`
   (`EntityControllerBase.cs:140`), `[HttpGet("lookup")]` for id/name dropdown
   entries (`EntityControllerBase.cs:348`), and `[HttpGet("{id}")]`
   (`EntityControllerBase.cs:378`).

2. **Generic write controller.** `AggregateRootEntityControllerBase<TEntity,
   TEntityDTO, TIdentifierType, TCreateRequest>`
   (`Source/Presentation/MMCA.Common.API/Controllers/AggregateRootEntityControllerBase.cs:27`)
   inherits all of the above and adds `[HttpPost]` create
   (`AggregateRootEntityControllerBase.cs:58`, returning 201 `CreatedAtRoute` at
   `:72`) and `[HttpDelete("{id}")]`
   (`AggregateRootEntityControllerBase.cs:84`). The create action is decorated with
   `[Idempotent]` (`AggregateRootEntityControllerBase.cs:59`) so a retried POST does
   not create a duplicate (ADR-017).

3. **Sparse fieldsets via `fields`.** A comma-separated `fields` query parameter
   (`EntityControllerBase.cs:105`, `:149`, `:387`) drives a server-side projection:
   `QueryFieldService.ApplyFieldSelection`
   (`Source/Core/MMCA.Common.Application/Services/QueryFieldService.cs:229`) builds a
   `MemberInit` expression that selects only the requested writable properties so
   only those columns leave the database.

4. **Dynamic per-type filtering.** The paged route binds
   `Dictionary<string, (string Operator, string Value)> filters` through
   `[ModelBinder(typeof(QueryFilterModelBinder))]` (`EntityControllerBase.cs:152`),
   which parses `filters[Property].operator` / `filters[Property].value` query keys
   (`Source/Presentation/MMCA.Common.API/ModelBinders/QueryFilterModelBinder.cs:24`).
   `QueryFilterService.ApplyFilters`
   (`Source/Core/MMCA.Common.Application/Services/Filtering/QueryFilterService.cs:76`)
   resolves a `IFilterStrategy`
   (`Source/Core/MMCA.Common.Application/Services/Filtering/IFilterStrategy.cs:6`)
   per property CLR type from a strategy registry (string, bool, int, long, DateTime,
   decimal, Guid and their nullables, `QueryFilterService.cs:29-45`), each strategy
   declaring its `SupportedOperators` (`IFilterStrategy.cs:24`). Extra types register
   via `QueryFilterService.RegisterStrategy` (`QueryFilterService.cs:60`).

5. **Sort.** `sortColumn` / `sortDirection` (`EntityControllerBase.cs:147-148`)
   feed `QueryFieldService.ApplySorting` (`QueryFieldService.cs:155`), an
   `OrderBy("<col> ascending|descending")` over the entity property the DTO name
   maps to.

6. **Pagination and the `X-Pagination` header.** The paged route clamps the
   requested page size with `Math.Min(pageSize, MaxPageSize)`
   (`EntityControllerBase.cs:155`), where `MaxPageSize` reads
   `IApplicationSettings.MaxPageSize` and falls back to 500
   (`EntityControllerBase.cs:57`, default at
   `Source/Core/MMCA.Common.Application/Settings/ApplicationSettings.cs:17`). The
   pagination metadata is serialized into the `X-Pagination` response header
   (`EntityControllerBase.cs:172`).

7. **A last-resort safety ceiling.** Independent of the API page-size clamp,
   `EntityQueryPipeline.MaxUnboundedResultLimit = 1000`
   (`Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:23`)
   caps any unpaginated query with `query.Take(MaxUnboundedResultLimit)`, at three
   call sites (`EntityQueryPipeline.cs:98`, `:193`, `:247`), so even a direct service
   caller that omits pagination cannot trigger an unbounded full-table load.

8. **Two include paths.** `includeFKs` / `includeChildren`
   (`EntityControllerBase.cs:106-107` for the list overload, `:145-146` for the
   paged overload) select navigation loading. `EntityQueryPipeline`
   (`EntityQueryPipeline.cs:13`) runs PATH 1 for source-supported includes via EF
   Core `.Include()` translated to SQL (`EntityQueryPipeline.cs:128-134`) and PATH 2
   for unsupported includes via manual `INavigationPopulator` batch loading after
   materialization (`EntityQueryPipeline.cs:50`), the populator strategy of ADR-002.

## Rationale
- **Write the resource surface once, inherit it everywhere.** The verbs, routes,
  filter contract, pagination, and header are defined once on the two bases; a
  concrete controller closes the type parameters and gets a uniform, predictable
  contract. New entities cost almost nothing and cannot drift in shape.
- **Bounded dynamic querying, not open SQL.** Filtering is dynamic over the wire but
  not unbounded in the engine: each property is filtered only by a registered
  `IFilterStrategy` whose `SupportedOperators` are validated before the database is
  touched (`QueryFilterService.ValidateFilters`, `QueryFilterService.cs:111`,
  invoked at `Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:266`),
  and `MaxUnboundedResultLimit` (`EntityQueryPipeline.cs:23`) plus the `MaxPageSize`
  clamp (`EntityControllerBase.cs:155`) bound the result size.
- **Composes with manual DTO mapping (ADR-001).** Entities are projected to DTOs by
  an injected `IEntityDTOMapper` (`EntityQueryService.cs:35`, property at `:90`) via
  `DTOMapper.MapToDTOs` (`EntityQueryService.cs:324`); a `DTOToEntityPropertyMap`
  (`EntityQueryService.cs:100`) translates DTO field names to entity property paths
  for filter and sort, so the wire contract speaks DTO names while the engine speaks
  entity names.
- **Composes with populators (ADR-002).** The unsupported-include path delegates to
  `INavigationPopulator` (`EntityQueryService.cs:36`), the same cross-source batch
  loader that bridges relationships EF cannot JOIN.

## Trade-offs
- **The wire contract tracks the entity model.** Filterable, sortable, and
  projectable surface is the entity's property set. A model change is an API change
  unless mediated by the DTO and `DTOToEntityPropertyMap` (`EntityQueryService.cs:100`),
  which is the boundary that decouples the two when needed.
- **Dynamic filtering is an injection and over-fetch surface.** Arbitrary
  client-supplied property/operator/value triples are an attack surface; it is
  bounded by validating properties and operators up front
  (`QueryFilterService.ValidateFilters`, `QueryFilterService.cs:111`), routing each
  type through its registered `IFilterStrategy` rather than free-form expression
  evaluation, and capping rows with `MaxUnboundedResultLimit`
  (`EntityQueryPipeline.cs:23`). Sparse fieldsets reject non-writable properties at
  projection (`QueryFieldService.cs:287`).
- **Generic endpoints are less self-documenting than bespoke ones.** One generic
  shape per entity is consistent but conveys less domain intent than a named,
  purpose-built endpoint; the query contract (filter key syntax, operators) must be
  learned once rather than read off each endpoint.
- **Opting out means overriding the base.** All four reads and the two writes are
  `virtual` (`EntityControllerBase.cs:104`, `AggregateRootEntityControllerBase.cs:63`),
  so a controller that needs bespoke behavior overrides the specific action rather
  than abandoning the base, but the default surface is opt-out, not opt-in.

## Related
ADR-001 (manual DTO mapping: the generic controllers project through
`IEntityDTOMapper`), ADR-002 (navigation populators: the unsupported-include path),
ADR-013 (Result pattern at the edge: every action returns through
`HandleFailure(result.Errors)`, `EntityControllerBase.cs:121`), ADR-017 (idempotency:
the generic create is `[Idempotent]`, `AggregateRootEntityControllerBase.cs:59`),
ADR-019 (rate limiting: these GET routes are the authenticated read surface the
always-on global limiter caps per principal).

## Revision (2026-07-24)
Filter and pagination corrections from a code review. The contract shape is unchanged; these close
cases where the engine widened a result set instead of narrowing it, or reported a total it did not
have.

1. **An unparseable filter value is a 400, not an unfiltered read.** Every strategy silently returned
   the query unchanged when it could not parse a value, and validation never looked at values at all,
   so `?filter=id:equals:abc` returned the whole (capped) result set rather than no matches. That is
   the wrong direction for a fail-safe default on an endpoint whose filter may be the only scoping.
   `IFilterStrategy.CanParseValue` (a default interface member returning `true`, so custom strategies
   are unaffected until they opt in) is implemented by the six value-type strategies and checked in
   `ValidateFilters`, which now emits `Filter.Value.Invalid`. Presence operators still ignore the
   value, `IN` needs at least one parseable item, and `BETWEEN` needs exactly two bounds.
2. **A mapped filter is applied, not silently dropped.** `ApplyFilters` and `ValidateFilters`
   disagreed on how to resolve a `DTOToEntityPropertyMap` entry: validation fell back to the mapped
   entity name while application retried the DTO name. A plain rename entry therefore passed
   validation and was then skipped, returning an unfiltered result set with a 200. Both now share one
   resolver, so anything validation accepts is what gets applied.
3. **Pagination edges.** The Skip offset was computed with checked 32-bit arithmetic, so a page
   number near `int.MaxValue` overflowed into a 500 instead of the empty page it describes; it is now
   64-bit and range-checked. An unpaginated read reported the `MaxUnboundedResultLimit` safety cap as
   `TotalItemCount`, telling callers the set was exactly that size; it now issues a count query only
   when the materialized rows actually reach the cap. `PaginationMetadata.PageSize` reports the size
   the pipeline applied rather than the one requested.
4. **The keyed by-id fast path is reachable again.** The fast-path predicate treated `includeFKs` as
   disqualifying while `GetByIdAsync` defaults it to `true`, so every REST by-id read fell through to
   the dynamic-filter pipeline (a parsed string predicate, `TOP 1000`, and a client-side
   `FirstOrDefault`) where a keyed `TOP 1 WHERE Id = @id` would do. The flags now disqualify only when
   the entity actually has navigations to include.

## Revision (2026-07-25)
Citation maintenance from an ADR audit. No decision or behavior changed; the source anchors above were
rebased to their current declaration and call-site lines.

1. **The fast-path predicate is named `TryGetFastPathIncludes`.** Revision item 4 above referred to it
   as `IsPrimaryKeyOnlyLookup`, a symbol that no longer exists in the framework source. The current
   method (`Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:161`, called from the
   by-id fast path at `EntityQueryService.cs:129`) both decides whether the request is a plain key
   lookup and returns the navigations it must eager-load. The described behavior is unchanged:
   requested include flags no longer disqualify on their own, and only unsupported (cross-source)
   includes send the read back to the pipeline (`EntityQueryService.cs:184-187`).
