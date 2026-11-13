# ADR-145: Opt-In Cursor Paging on List Endpoints (Beside Offset Paging)

## Status
Accepted (2026-11-12). Listed under `[Unreleased]` / Added in the MMCA.Common changelog
(`MMCA.Common/CHANGELOG.md:7`, `:24`). Off for every controller unless it carries
`[SupportsCursorPaging]`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Pagination/SupportsCursorPagingAttribute.cs:3-14`).

## Context
The generic list surface of [ADR-034](034-generic-entity-query-layer.md) pages by offset:
`GET {controller}/paged` takes a page number and size and reports the total in the `X-Pagination`
header (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:25`,
`:153-157`). Two forces made that insufficient on its own:

- **Offset paging degrades with depth.** Page 37 costs the database a scan of the 36 pages before it,
  where a keyset read costs one index seek regardless of depth, given an index that covers the sort
  column and `Id` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/KeysetPagination.cs:12-16`).
- **Offset pages shift under concurrent writes.** A row inserted ahead of the reader's position moves
  every later row by one, so "load more" over offsets can show a row twice or skip one. A seek reads
  "what comes after this row", which an insert elsewhere does not move. The reference adopter's ticket
  list states this as its reason for paging by cursor
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Components/Pages/Tickets.razor:92-94`).

A keyset read already existed below the controller. [ADR-055](055-repository-and-specification-contract.md)
records `IEntityQuerier.GetPageByCursorAsync` with `KeysetPageRequest`, `KeysetCollectionResult<T>`
and a versioned base64url cursor
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRepository.cs:318-319`;
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:630-687`).
No query-service method and no HTTP endpoint reached it, so a client could not use it.

## Decision
**Keyset paging is an opt-in action on `EntityControllerBase` and a method on the entity query service,
beside the offset-paged list, which stays as it is. An opt-in action is an endpoint only on a controller
that carries its marker; on every other controller it does not exist.**

1. **The action.** `GetCursorPageAsync` answers `GET {controller}/cursor` with the parameters
   `sortColumn`, `sortDirection`, `cursor` and `pageSize` (default 10, `[Range(1, int.MaxValue)]`), and
   returns `KeysetCollectionResult<TEntityDTO>` or Problem Details (400, 500)
   (`EntityControllerBase.cs:401-411`). It is `virtual`, like the other generic reads.
2. **Page size is clamped twice, never rejected above the floor.** The action takes
   `Math.Min(pageSize, MaxPageSize)` (`EntityControllerBase.cs:417`), where `MaxPageSize` is
   `ApplicationSettings.MaxPageSize` (default 500) clamped to the pipeline's unbounded-result ceiling
   (`EntityControllerBase.cs:58-64`;
   `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ApplicationSettings.cs:17`).
   `KeysetPageRequest` then clamps into `[1, 1000]` (`KeysetPagination.cs:26`, `:51`, `:62`).
3. **Direction.** `sortDirection` must be empty, `asc` or `desc` (case-insensitive); anything else is
   `Error.InvalidSortDirection`, answered before any read
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/QueryFieldService.cs:591-605`;
   `EntityControllerBase.cs:413-415`). Only `desc` sets `Descending` (`EntityControllerBase.cs:418`).
4. **One sort column, validated against the response contract.** `EntityQueryService.GetPageByCursorAsync`
   validates the name exactly as the list read does (`DTOToEntityPropertyMap`, `FieldContract` and the
   entity's properties) and fails before the repository runs; a name found in `DTOToEntityPropertyMap`
   is replaced by its entity value
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:528-559`). The
   repository resolves the name to a public instance property of the entity and answers
   `Error.InvalidEntityField` for anything else, a mapped navigation path included
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/KeysetQueryBuilder.cs:35-47`;
   `EFReadRepository.cs:637-646`). An empty `sortColumn` pages by `Id` alone.
5. **`Id` is the tie-break.** With a sort column the order is `(sortKey, Id)`, and the `Id` tie-break
   always ascends, which the seek predicate assumes; with no sort column the order is `Id` in the
   requested direction (`KeysetQueryBuilder.cs:50-51`, `:76-81`).
6. **The cursor is opaque and a malformed one is a 400.** A cursor is the base64url form of
   `v1|{hasSortValue}|{sortValue}|{id}` with each value segment base64url-encoded again, so a value
   containing the separator cannot forge one; it is neither signed nor encrypted and carries only values
   already in the rows the caller received (`KeysetPagination.cs:110-124`). Wrong version, bad base64,
   wrong segment count, or values that do not parse as the entity's key and sort types fail
   (`KeysetPagination.cs:169-190`; `EFReadRepository.cs:694-722`) as the validation error
   `Error.InvalidCursor`, never as a silent first page (`EFReadRepository.cs:652-662`).
7. **The next cursor comes from one probe row, not a count.** The read takes `PageSize + 1` rows; the
   extra row only proves a next page exists, and `NextCursor` is null on the last page
   (`EFReadRepository.cs:669-686`; `KeysetPagination.cs:93-107`).
8. **Read scope and tenant filter apply.** The action resolves `GetReadSpecificationAsync` once and
   passes it down (`EntityControllerBase.cs:420-425`), the hook the other generic reads use
   (`EntityControllerBase.cs:115`, `:170`). Only the specification's criteria apply
   (`applyShape: false`, `EFReadRepository.cs:648-650`). The context's global query filters stay in
   force: the tenant filter is a named query filter (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:618`,
   `:713`), and the one filter a specification can lift is the soft-delete filter
   (`EFReadRepository.cs:41`, `:573-582`).
9. **What the keyset read deliberately lacks.** Compared with `GET {controller}/paged` there is no total
   count, no `X-Pagination` header, no `fields` projection, no includes and no filter dictionary: the
   keyset read takes a specification only (`EntityControllerBase.cs:396-400`;
   `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Mapping/IEntityQueryService.cs:173`).
   The result type carries no total and no page number by design (`KeysetPagination.cs:78-85`).
10. **The service method is a defaulted interface member.** `IEntityQueryService.GetPageByCursorAsync`
    has a default body answering `Error.Unexpected` with `Query.CursorPagingNotSupported` (500), so an
    implementation that predates it keeps compiling; `EntityQueryService` overrides it and maps the rows
    with `DTOMapper` in repository order (`IEntityQueryService.cs:24-28`, `:160-182`;
    `EntityQueryService.cs:561-565`).
11. **The opt-in marker and the convention.** `[SupportsCursorPaging]` is a public, inherited class
    attribute, so declaring it on an abstract base opts in every derived controller
    (`SupportsCursorPagingAttribute.cs:9-14`). The action carries the internal
    `[OptInAction(typeof(SupportsCursorPagingAttribute))]` (`EntityControllerBase.cs:402`), an
    `IActionModelConvention` that removes the action from the controller's application model unless the
    controller carries the marker
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Pagination/OptInActionAttribute.cs:16-33`). A
    removed action has no route and no API description, so the API document of a controller without the
    marker is exactly what it was; the convention is read off the base action, so an override that does
    not opt in is removed as well (`OptInActionAttribute.cs:10-14`). The change feed (`GetChangesAsync`,
    ADR-144) uses the same convention with its own marker (`EntityControllerBase.cs:454-455`).
12. **Reflection-based authorization tests skip what is not an endpoint.** The convention removes the
    action from the application model, not from the type: `GetCursorPageAsync` is still a public method of
    every derived controller. A fitness test that enumerates controller methods by reflection and demands
    a permission or an anonymous declaration on each read action must skip an action whose opt-in marker
    the controller lacks, and keep checking it on a controller that opts in. `OptInActionAttribute` is
    `internal` (`OptInActionAttribute.cs:17`), so a consumer test recognizes it by reflection rather than
    by type reference.

## Rationale
- **Depth and stability without giving up the grid.** Keyset paging fixes both forces in Context for
  clients that scroll ("load more", infinite lists, sync), while offset paging keeps what it is good at:
  random page access and a total for a pager (`KeysetPagination.cs:12-16`).
- **One read path, one contract.** The action runs the repository read ADR-055 already records, through
  the same read-scope hook and the same response-contract validation of sort names as the list read
  ([ADR-034](034-generic-entity-query-layer.md)), so a cursor page cannot return a row or sort by a
  column the list endpoint hides.
- **Opt-in costs nothing for a controller that does not use it.** Removing the action from the
  application model, rather than answering 404 from a live action, keeps the route, the API document and
  the authorization surface of every other controller unchanged.
- **Honest failures.** A bad cursor or an unknown sort column is a 400 the client can act on, and a
  query service that cannot serve the read says so with a named code instead of returning a wrong page.

## Trade-offs
- **No random access and no total.** A cursor client cannot jump to page N or show "1-20 of 3,412"; that
  is the price of the seek (`KeysetPagination.cs:12-16`, `:78-81`).
- **One sort key.** The read orders by a single column plus `Id`; a multi-column user sort stays on the
  offset endpoint (`EFReadRepository.cs:667`; `KeysetQueryBuilder.cs:62-81`).
- **A thinner read than `paged`.** No projection, includes or filter dictionary: a client that needs a
  filtered or projected page uses `paged`, or the adopter narrows `GetReadSpecificationAsync`.
- **The sort column must be on the response contract.** An entity property the DTO does not expose
  cannot key a cursor page, even when it would be the natural order (Consequences, the Helpdesk case).
- **A cursor carries values in clear.** It is opaque by contract, not by cryptography; that is safe only
  because it holds values the caller already received (`KeysetPagination.cs:121-122`).
- **A cursor does not record its sort.** It holds the last row's sort value and `Id`, not the column or
  the direction. A cursor replayed with a different `sortColumn` or `sortDirection` is accepted whenever
  its values still parse for the new column, and the read then seeks from a position that means nothing
  in the new order
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:700-720`).
  A client keeps the sort fixed for the life of a cursor.
- **The seek is only as cheap as the index.** Nothing creates or requires an index on the sort column:
  the read orders by the sort column and then `Id` and takes one row more than the page
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/KeysetQueryBuilder.cs:76-81`).
  Sorting by `Id` rides the primary key; any other sort column needs its own index to keep the cost flat.
- **Two hiding mechanisms to know.** A method present on the type but absent from the routing table
  surprises reflection-based tests until they skip it (Decision, point 12).

## Alternatives rejected
- **Replace offset paging with cursor paging** (weighed 2026-11-11). It would break every server-paged
  grid, which needs page numbers and a total, and every client of `GET {controller}/paged`. Revisit if
  the offset endpoint loses its last grid consumer.
- **A cursor endpoint on every entity controller, always on** (weighed 2026-11-11). It adds public
  surface to every entity in every consumer, a new route in every committed API document, and a new row
  for every authorization fitness test to account for, on entities no client pages by cursor. Revisit if
  most controllers in the consuming applications come to opt in.
- **Exposing the cursor's internals as query parameters** (`afterId`, `afterValue`; weighed
  2026-11-11). It freezes the seek format into the public contract, so a format change would break
  clients, and it invites hand-built boundaries the server must defend. The versioned opaque cursor lets
  a later `v2` encoding coexist while `TryDecode` keeps rejecting what it does not understand
  (`KeysetPagination.cs:114-118`). Revisit only if an external consumer needs a stable, documented seek
  key and accepts the versioning burden.

## Consequences
- **Adopting it is one attribute.** Put `[SupportsCursorPaging]` on the entity controller (or on an
  abstract base to opt in a family). A custom query service that does not derive from
  `EntityQueryService` must also override `GetPageByCursorAsync`, or the endpoint answers 500
  (`SupportsCursorPagingAttribute.cs:9-12`).
- **The client call is the adopter's.** Common.UI ships no cursor client, so the adopter writes the GET.
- **Worked example: the Helpdesk ticket list.** `TicketsController` carries the marker
  (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.API/Controllers/TicketsController.cs:47-49`).
  `HelpdeskApiClient.GetTicketPageAsync` requests `Tickets/cursor?sortColumn=id&sortDirection=desc`
  with the page size and, after the first page, the previous `NextCursor`
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Services/HelpdeskApiClient.cs:30-45`). It sorts
  by `id` descending because ids are database-generated, so a higher id is a later ticket, and `id` is a
  column the ticket's response contract declares, which the endpoint requires of a sort column
  (`HelpdeskApiClient.cs:33-35`). The page loads 20 tickets at a time, appends each later page, and
  shows "Load more" only while the server returns a next cursor (`Tickets.razor:95-109`, `:135-160`).
- **Nothing changes for a controller that does not opt in**: no route, no API document change, no new
  authorization row. ADC and Store opt in nowhere today, so their committed documents are unchanged.
- **Watch:** a reflection-based authorization or anonymous-read fitness test added in any consumer must
  apply the skip in Decision, point 12, or it fails on the first controller without the marker.
