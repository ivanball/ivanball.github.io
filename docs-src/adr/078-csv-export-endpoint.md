# ADR-078: CSV Export as a Dedicated Endpoint, Not Content Negotiation

## Status
Accepted (2026-08-13). The implementation lands in the MMCA.Common "enterprise capability wave" release.
Unlike the wave's other features this one is NOT opt-in: every controller deriving from
`EntityControllerBase` gains the endpoint automatically, under that controller's own authorization
posture, so consumers re-baseline their OpenAPI contract snapshots in the sweep.

## Context
The request is "export what you filtered". The generic entity surface of
[ADR-034](034-generic-entity-query-layer.md) already accepts a full query vocabulary on the paged route
(`Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:139`): sparse fieldsets through
`fields`, dynamic per-type filtering bound by `QueryFilterModelBinder` (`EntityControllerBase.cs:151`),
`sortColumn` / `sortDirection`, and pagination reported in `X-Pagination`. A user who has narrowed a grid
to the rows they care about wants those exact rows as a file. The framework produced no file at all: the
four generic reads (`EntityControllerBase.cs:100`, `:139`, `:347`, `:377`) return JSON and nothing else.

The obvious implementation is content negotiation: keep the same URL, have the client send
`Accept: text/csv`, and register an `OutputFormatter`. Exploration of the real source found two behaviors
that make that the wrong shape here.

- **The output cache does not vary by `Accept`.** `PublicEndpointOutputCachePolicy`
  ([ADR-040](040-authenticated-output-caching-for-public-reads.md)) sets
  `context.CacheVaryByRules.QueryKeys = "*"`
  (`Source/Presentation/MMCA.Common.API/Caching/PublicEndpointOutputCachePolicy.cs:81`) and varies by
  nothing else. On any endpoint carrying that policy, a CSV request and a JSON request to the same URL
  with the same query string are the same cache entry, so a CSV request can be served a stored JSON body
  with a `Content-Type` that no longer matches what the formatter would have produced.
- **A negotiation failure is silent.** `AddAPI` sets `options.ReturnHttpNotAcceptable = false`
  (`Source/Presentation/MMCA.Common.API/DependencyInjection.cs:48`), so a request for a media type no
  formatter can produce does not get 406: it falls back to the default formatter. A caller asking for CSV
  against a controller where the formatter did not apply receives JSON with a 200 and no signal that it
  asked for something else.

Neither global setting is free to change: flipping `ReturnHttpNotAcceptable` changes the failure mode of
every endpoint in every consumer in one release, and adding `Accept` to the cache variance multiplies
cache entries on the read-scaling path for a format almost nobody requests. A second question had no
answer either: how many rows an export returns. The query pipeline caps any
unpaginated read at `EntityQueryPipeline.MaxUnboundedResultLimit = 1000`
(`Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:23`, applied by `Take(...)` at
`:102` and `:148`), and there is no `IAsyncEnumerable` path through it. A naive "read it all, write CSV"
export therefore returns 1000 rows and says nothing about the rest.

## Decision

### A dedicated route, not a media type
`EntityControllerBase` gains a virtual `[HttpGet("export")] ExportAsync(...)` action
(`Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs`). It accepts the same query
surface as the paged route: `sortColumn`, `sortDirection`, `fields`, `includeFKs`, and `filters` bound by
`[ModelBinder(typeof(QueryFilterModelBinder))]`, so a grid that produced a `paged` URL produces an
`export` URL by changing one path segment. It returns a streamed `text/csv` response with a
`Content-Disposition` attachment filename of `{controller}-{yyyyMMdd-HHmmss}.csv`.

A distinct path avoids both findings without touching either global setting: the route is not the cached
route, and a client cannot ask for CSV and silently receive JSON, because asking for CSV means calling a
different URL.

### The page loop is how the row cap is answered
`ExportAsync` does not issue one unpaged query. It loops server-side over the existing paged
`IEntityQueryService.GetAllAsync`
(`Source/Core/MMCA.Common.Application/Interfaces/IEntityQueryService.cs:60`) at a page size of
`ApplicationSettings.MaxPageSize`
(`Source/Core/MMCA.Common.Application/Settings/ApplicationSettings.cs:17`, default 500), writing each
page's rows into the response as they materialize, until a page comes back short or the export cap is
reached. Every page is a bounded, already-supported read, so `MaxUnboundedResultLimit` is never the thing
that decides how large an export is.

Adding an `IAsyncEnumerable` path through `EntityQueryPipeline` is the better long-term answer: one
query, one open reader, no repeated `Skip`. It is deliberately deferred out of this wave. It changes the
shared read path that every entity in every consumer uses, and this record buys the capability without
touching it.

### The row ceiling is a setting, and hitting it is visible
`ApplicationSettings` gains `MaxExportRows`, default 100,000. At the ceiling the export stops, emits a
final CSV comment row recording that the file is partial, and sets an `X-Export-Truncated: true` response
header. Truncation is a normal outcome with a signal, not an error: the response has already begun
streaming by the time the cap is reached, so a status code is no longer available to carry it.

### The CSV writer is in-house
`CsvWriter` (internal static, `Source/Presentation/MMCA.Common.API/Export/`) implements RFC 4180: quote a
field when it contains the separator, a quote, or a line break; escape an embedded quote by doubling it;
terminate rows with CRLF; optionally lead with a UTF-8 BOM, controlled by a setting because the BOM is
what makes Excel open a UTF-8 file correctly and what makes some parsers see a junk first column.

No CsvHelper dependency is taken. The framework's export input is already a rectangle of stringified
shaped values, the escaping rules are a page of code, and a published framework that takes a dependency
imposes it on every consumer of every package pin
([ADR-038](038-supply-chain-provenance.md), [ADR-016](016-lockstep-versioning-masstransit-pin.md)).

### Column names come from the same place the JSON property names do
The header row is the key set produced by `QueryFieldService.ShapeCollectionData`
(`Source/Core/MMCA.Common.Application/Services/QueryFieldService.cs:96`), which writes each shaped value
under its camelCase name via `JsonNamingPolicy.CamelCase` (`QueryFieldService.cs:43`, `:110`). The CSV
columns for a given `fields=` request are therefore exactly the JSON property names for the same request,
with no second naming convention to keep in step.

### `IEntityControllerBase` is deliberately not touched
The endpoint is a base-class method only. Adding a member to the public
`IEntityControllerBase` interface
(`Source/Presentation/MMCA.Common.API/Controllers/IEntityControllerBase.cs:14`) is breaking for any
consumer that implements it explicitly rather than inheriting the base, and a default interface member
would hide that break behind a runtime surprise instead of removing it. This is the same reasoning
[ADR-073](073-multi-tenancy-model.md) applies to the new `IPhysicalDbContextFactory.Create` overload.

### The streamed response passes the failure filter untouched
`UnhandledResultFailureFilter` acts only when the action result is an `ObjectResult` carrying a failed
`Result` (`Source/Presentation/MMCA.Common.API/Middleware/UnhandledResultFailureFilter.cs:27`). A streamed
file result is neither, so it flows through the filter pipeline unmodified and the
[ADR-013](013-result-pattern.md) contract stays intact for the JSON routes without a special case for
this one. A failure detected before streaming begins still returns through `HandleFailure`.

### Adoption is automatic, and the sweep work is contract snapshots
ADC, Store, and Helpdesk inherit `/export` on every `EntityControllerBase` derivative the moment they take
the pin. No registration call exists to make. The visible work in each consumer sweep PR is re-baselining
the OpenAPI contract snapshots asserted by `OpenApiContractTestsBase`
([ADR-058](058-runtime-conformance-suites-as-a-package.md)), which will otherwise fail on the added path.

## Rationale
- **A route is an unambiguous request; an `Accept` header is a preference.** Given a cache policy that
  ignores `Accept` and a pipeline configured to never return 406, a client that negotiates has no way to
  know what it got. A separate path makes the request explicit and the response deterministic, and it does
  it without editing two settings that every consumer's every endpoint depends on.
- **The cheapest correct fix beats the most idiomatic one here.** `OutputFormatter` is the textbook answer
  and would have been right if the two findings had gone the other way. The cost of making them go the
  other way (a 406 behavior change plus a cache-entry multiplier on the read-scaling path) is paid by
  every consumer for a feature used by few.
- **Page-looping reuses a read that is already correct.** Filtering, validation, sorting, projection,
  include handling, and DTO mapping stay exactly as the paged route runs them, so an export cannot
  disagree with the grid it was launched from, and no new code touches the query pipeline in this wave.
- **A hard ceiling with a signal beats an unbounded stream.** 100,000 rows is a number an operator can
  reason about; an unbounded export is a way to hold a connection and a database read open for as long as
  the data allows. The truncation header names the boundary rather than hiding it.
- **A framework declines dependencies its consumers cannot decline.** Every pin MMCA.Common takes is one
  its packages carry into three applications under lockstep versioning (ADR-016), and RFC 4180 quoting is
  small, stable, and fully testable in-repo.
- **One naming source keeps two formats honest.** Deriving the header row from the same shaper the JSON
  response uses makes the CSV columns a projection of an existing contract instead of a second one.

## Trade-offs
- **Every derivative gains a bulk read whether its owner wanted one or not.** The only gate is the
  controller's existing authorization posture. A resource that was safe to page 20 rows at a time is now
  exportable 100,000 rows at a time by the same caller, and no controller opted in to that. Overriding
  `ExportAsync` to return 404 or 403 is the only opt-out, which is opt-out, not opt-in.
- **Ownership scoping does not carry over, and that is a live leak on scoped controllers.** The inherited
  endpoint queries with no specification, so a controller whose list endpoints row-scope by owner (the
  ADR-033 ownership axis) still answers `/export` unscoped: during the v1.150.0 sweep this would have let a
  Store customer token export every customer's orders. The v1 mitigation is gating: consumers with
  owner-scoped reads override `ExportAsync` behind a privileged-role posture (Store and ADC did, with a
  test pinning each gate). The follow-up shipped in v1.151.0 as `GetExportSpecification()`, a
  protected virtual hook whose result the export applies to every page it streams (default null keeps
  the v1.150.0 behavior byte for byte), so owners can export exactly the rows their list endpoints
  show; Store adopted it in the same sweep (its admin gates relaxed back to ownership scoping), while
  ADC keeps its Forbid gates because its read predicates are method bodies rather than
  specifications. v1.151.0 also hardened the formatter: binary and collection properties produce no
  column instead of rendering type names, and a `fields=` request naming one fails validation up
  front.
- **N queries, not one stream.** An export at the default settings is up to 200 round trips
  (`MaxExportRows` 100,000 over `MaxPageSize` 500), each with its own `Skip`/`Take`, and it holds a
  response open for their combined duration. There is no export-specific timeout budget in v1; the limits
  are the row cap and whatever the host and client already enforce.
- **Truncation is signalled where spreadsheets do not look.** A response header and a trailing comment row
  are both invisible to a user who double-clicks the downloaded file. A partial export can therefore be
  read as a complete one.
- **No `Accept: text/csv` support at all.** A client that negotiates instead of routing gets JSON. That is
  the behavior this record chose, and it is still surprising to anyone who expects a modern API to answer
  a media type request.
- **The framework now owns a CSV implementation.** Embedded quotes, embedded newlines, a leading
  separator, and encoding all become framework correctness obligations covered by framework tests. The
  spreadsheet formula-injection question (a cell whose value begins with `=`, `+`, `-`, or `@`) is one the
  in-house writer must answer explicitly at implementation, and this record does not pre-decide the answer:
  neutralizing changes the exported value, and not neutralizing ships a known spreadsheet risk.
- **CSV flattens, and the query surface does not.** A shaped field that is nested or collection-valued has
  no natural cell. Whatever the writer renders for such a field is a framework convention, not a standard,
  and it will not round-trip back into the JSON shape it came from.
- **The endpoint is not output-cached, by construction.** Every export is a live read against the database,
  which is correct for an operator extract and means an export cannot be absorbed by the cache tier the
  way the read routes are ([ADR-019](019-rate-limiting.md) rate limiting is the only load control on it).
- **Adding an endpoint to a shared base moves every consumer's OpenAPI document in one release.** Under
  lockstep versioning (ADR-016) there is no phased rollout: all three consumers re-baseline their contract
  snapshots (ADR-058) in the same sweep.

## Related
[ADR-034](034-generic-entity-query-layer.md) (the generic entity surface and query contract this extends,
and the `MaxUnboundedResultLimit` ceiling that forced the page loop),
[ADR-040](040-authenticated-output-caching-for-public-reads.md) (the output-cache policy whose
`Accept`-blind query-string variance is one of the two forcing findings),
[ADR-013](013-result-pattern.md) (the `Result` contract at the edge and the unhandled-failure filter the
streamed result passes through untouched),
[ADR-058](058-runtime-conformance-suites-as-a-package.md) (the shipped OpenAPI contract snapshots every
consumer re-baselines for the added path),
[ADR-016](016-lockstep-versioning-masstransit-pin.md) and [ADR-038](038-supply-chain-provenance.md) (why a
published framework declines a CSV dependency, and why a public interface gains no member),
[ADR-019](019-rate-limiting.md) (the per-principal limiter that is the only load control standing in front
of a bulk read), [ADR-076](076-data-subject-export.md) (the other export in this wave, and the boundary
between a data-subject package assembled for one person and an operator's filtered extract of a table).
