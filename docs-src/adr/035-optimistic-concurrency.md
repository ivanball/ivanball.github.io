# ADR-035: Optimistic Concurrency via RowVersion Round-Trip

## Status
Accepted (2026-07-02).

## Context
Every mutable aggregate in the framework is edited through a load-modify-save handler: the update use
case fetches the tracked entity, applies the request, and calls `SaveChangesAsync`. With one shared
context per engine (ADR-006) and no concurrency token, two editors who both read the same row and
save in turn silently overwrite each other. The second write wins, the first editor's change
vanishes, and nothing surfaces the collision. That last-write-wins default is fine for a single-user
admin tool and wrong for a multi-actor system where an organizer and a speaker can both be editing
the same session.

This is a **different concern** from the two idempotency mechanisms the framework already records.
ADR-017 (request idempotency) dedups a client retrying the **same** request, and ADR-021 (consumer
inbox) dedups the broker redelivering the **same** integration event. Both answer "I saw this one
action more than once." Optimistic concurrency answers the opposite question: "two **distinct**
actions targeted the same row, which one is stale?" We wanted a first-class, framework-wide mechanism
that turns a conflicting concurrent edit into a status the caller can react to, rather than a silent
overwrite.

HTTP has described that exchange since long before this framework: a response `ETag` naming the
version the client holds, and an `If-Match` request header making the next write conditional on it.
A design that invents its own carrier for the same value leaves a generic REST tool, a mobile HTTP
stack, anything not generated from our DTOs, unable to participate in a check the protocol already
standardizes.

## Decision
Give every auditable entity a database-managed `RowVersion` concurrency token, round-trip it through
the client as an HTTP entity tag, and stamp the client's last-seen value as EF's original value so a
stale update fails inside the UPDATE statement.

- **A `RowVersion` token on the audit base.** `AuditableBaseEntity<TIdentifierType>` carries a
  `byte[] RowVersion` property with a private setter
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:53`), so every
  aggregate root and child entity inherits it, and the base implements `IRowVersioned` (`:13`,
  declared in `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IRowVersioned.cs`) so a child
  row can be reached without a second generic parameter. EF configures the property on **every**
  non-owned `IAuditableEntity` in `ConfigureConcurrencyTokens`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:501`,
  called from `OnModelCreating` at `:335`): SQL Server maps it to a server-generated `rowversion`
  (`IsRowVersion`, `:514`), other relational providers map it as a plain application-managed token
  (`IsConcurrencyToken`, `:518`). EF then includes the token in every UPDATE/DELETE `WHERE` clause
  and raises `DbUpdateConcurrencyException` when it matches no row.
- **A read carries the token; a write does not.** `IConcurrencyAware`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/IConcurrencyAware.cs:15`) declares a
  **non-nullable** `byte[] RowVersion` (`:19`) and is implemented by read DTOs, so a row served to a
  client can be rendered with its version. An update request implements nothing of the kind: the
  precondition travels in the header alone (`:9-14`).
- **The read emits a weak `ETag`.** `EntityControllerBase.GetByIdAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:415`) calls
  `SetConcurrencyETag(result.Value)` (`:436`), which renders the served row's token as
  `W/"<base64>"` (`:471`, written to the response at `:479`, formatted by `ConcurrencyETag.Format`,
  `MMCA.Common/Source/Core/MMCA.Common.Shared/Http/ConcurrencyETag.cs:40`). Weak is the honest
  strength: the tag identifies the row's version, not a byte-exact representation, and the same row
  legitimately serializes differently under a `fields=` projection. Those shaped responses are seen
  through rather than skipped: `ReadRowVersion` (`:488`) reads the typed property when the payload is
  the DTO and falls back to a dictionary lookup keyed by JSON name when it is a projection
  (`:493-496`). The property is resolved once per closed controller type (`:445`), and a DTO type
  with no token makes the method a no-op (`:473-474`). It is `protected` so a hand-written read
  action can emit the same header instead of re-implementing the format, which is where the two
  would drift and a precondition would quietly stop working.
- **`[SupportsIfMatch]` decodes the header, and nothing else carries the token.**
  `SupportsIfMatchAttribute`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Concurrency/SupportsIfMatchAttribute.cs:49`) is a
  sealed `Attribute` implementing `IAsyncActionFilter` directly, so unlike `[Idempotent]` (a
  `ServiceFilterAttribute` resolving from DI, ADR-017) it is self-contained and needs no registration
  by a host. Before the action runs it parses `If-Match` with `ConcurrencyETag.TryParse`
  (`ConcurrencyETag.cs:62`) and places the decoded bytes in `HttpContext.Items` under `TokenItemKey`
  (`:57`, written at `:122`). The action reads them back through
  `SupportsIfMatchAttribute.RequiredToken(HttpContext)` (`:68`) and passes the token to its command,
  as the generic PUT does
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/CrudEntityControllerBase.cs:90` for
  the attribute, `:103` for the read). No bound argument is written to, so no request model has to
  loosen its immutability to receive a token.
- **Three status codes, one problem-details shape.**
  - **A request that states no precondition is `428 Precondition Required`** and the action never
    runs (`SupportsIfMatchAttribute.cs:109-114`). A blank header and `*` are both no precondition:
    the wildcard names no particular version, so honouring it would be a last-write-wins write
    wearing a conditional request's clothes.
  - **A malformed tag is `400 Bad Request`** (`:116-120`): a precondition the server cannot read is a
    client error, and running the write would ignore a precondition the caller did state.
  - **A stale token is `412 Precondition Failed`**, produced after the action by
    `RewriteConflictToPreconditionFailed` (`:130`). A `DbUpdateConcurrencyException` is answered in
    the filter rather than left to the global handler (`:132-138`), and an already-produced 409
    result has its status and its `ProblemDetails.Status` rewritten in place with the body otherwise
    untouched (`:141-158`).

  All three are RFC 9457 problem details built by one helper (`:204`) through the registered
  `ProblemDetailsFactory`, so they carry the same `traceId`/`requestId` diagnostics as every other
  problem response on the surface, and each carries the standard `errors` extension with a stable
  code: `Concurrency.PreconditionRequired` (`:169`), `Concurrency.MalformedIfMatch` (`:181`),
  `Concurrency.PreconditionFailed` (`:192`).
- **`SetOriginalRowVersion` is the persistence extension point.**
  `IWriteRepository.SetOriginalRowVersion(TEntity, byte[])`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRepository.cs:406`)
  applies the caller's token as the tracked entity's **original** `RowVersion`; the `EFRepository`
  implementation writes it to `Entry(entity).Property(nameof(RowVersion)).OriginalValue`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:82`).
  The shared write workflow calls it right after loading the aggregate and before the mutation runs
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Crud/MutateEntityHandlerBase.cs:291-292`), so
  EF compares the client's token against the row's current value inside the UPDATE statement,
  atomically, with no read-then-check race.
- **Child entities are reached by the `IRowVersioned` overload.** The first overload is typed to the
  repository's aggregate root (`TEntity`), so a child edit (a `ProductVariant` under a `Product`)
  cannot receive a token through it. A second overload,
  `SetOriginalRowVersion(IRowVersioned childEntity, byte[] rowVersion)` (`IRepository.cs:417`,
  implemented at `EFRepository.cs:86`), accepts any tracked auditable entity instead, and an update
  handler that mutates children through the aggregate's repository stamps each child itself. Both
  overloads reject a null token (`EFRepository.cs:78`, `:89`): there is no value that means "skip
  the check".
- **A fitness function keeps the token out of the body.**
  `ArchitectureRules.UpdateRequestsAreNotConcurrencyAware`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Governance/ArchitectureRules.Governance.cs:24`)
  scans module Application assemblies for types whose simple name ends in `UpdateRequest` and flags
  any that **does** implement `IConcurrencyAware`, because a token in the body would give the same
  check a second, competing source. `ConcurrencyConventionTestsBase` exposes it as a single `[Fact]`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Domain/ConcurrencyConventionTestsBase.cs:14`),
  and **both** consumers subclass it
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Domain/ConcurrencyConventionTests.cs:3`,
  `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Domain/ConcurrencyConventionTests.cs:3`, each
  supplying its own `IArchitectureMap`). A module with no mutable aggregate is legitimately vacuous.
- **The UI speaks the same format.** `ConcurrencyETag` lives in `MMCA.Common.Shared.Http` rather than
  in the API package precisely so both ends of the exchange can use it: the API reads an `If-Match`
  value with it and the UI writes one. `EntityServiceBase.UpdateAsync`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/EntityServiceBase.cs:176`) passes
  `ConcurrencyTagOf(entity)` (`:197`) as the write's `If-Match` (`:184`), and the request client sets
  the header (`:394`), so a Blazor page conditions its writes with no per-page code.
- **Every table carries the column.** The token exists in the database or it does not exist at all:
  each database's migrations add the `RowVersion` column to every table, typed `rowversion` in SQL
  Server, alongside the audit columns of the same base
  (`MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer.Catalog/Migrations/20260621192800_InitialCreate.cs:34`,
  `MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260606053146_InitialCreate.cs`).

## Rationale
- **Database-managed token over a hand-maintained version field.** A SQL Server `rowversion`
  auto-increments on the server on every write; no domain code sets or reads it (the setter is
  private, populated by EF). The token stays invisible to the aggregate's behavior, so concurrency is
  a persistence concern, not a domain one.
- **Round-trip over a server-side reload.** Reloading and re-saving on the server hides the collision
  (both writes succeed against the freshest row). Forcing the client to echo the version it last read
  is what makes a competing edit a real conflict instead of a silent overwrite.
- **One extension point over a per-handler compare.** `SetOriginalRowVersion` plus EF's `WHERE`-clause
  check does the comparison in the database, atomically with the UPDATE. A hand-rolled "read the
  current token, compare, then save" would reintroduce the exact race it is meant to close.
- **The header is the one transport.** HTTP already defines `ETag` and `If-Match` for precisely this
  exchange, so a generic REST client participates without knowing a framework DTO, and the
  precondition stays out of the write contract. A token in the request body would be a second,
  competing source for the same check: two places to populate, a precedence rule to define, and a
  silent divergence whenever a caller fills one and not the other. One carrier means one answer.
- **Required rather than optional.** A conditional write whose precondition is missing is refused,
  not quietly downgraded to last-write-wins. A token the caller may omit makes the guarantee a
  property of the caller rather than of the endpoint: the type says the field is there, and whether
  the row is actually protected depends on whether someone remembered to fill it.
- **412 rather than 409.** RFC 9110 reserves 412 for a precondition the client stated in a
  conditional request header, which is exactly what `If-Match` is. 409 stays the answer for a
  conflict the client did not condition on, which `DbUpdateExceptionHandler` still produces for any
  other `DbUpdateException`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/DbUpdateExceptionHandler.cs:33`, with
  a generic detail message so the schema is not leaked and the full exception logged rather than
  returned). Answering 409 for a failed precondition would make `If-Match` a decorative alias for an
  ordinary state conflict.
- **Invariant over discipline (ADR-015).** The `*UpdateRequest` naming convention is checked
  mechanically in both consumers, so a newly added mutable request cannot reintroduce a body token by
  an author simply reaching for the interface. This is the same posture the framework prefers
  elsewhere.

## Trade-offs
- **The rewrite keys on the conflict outcome, not on its cause.** The filter turns any 409 produced
  under an `If-Match` request into a 412, including a unique-constraint or foreign-key violation that
  `DbUpdateExceptionHandler` funnels to the same 409. The response keeps its original problem details
  and error codes, so the cause is still readable in the body, but one class of conflict wears a
  status code naming a precondition the client did not actually violate. The alternative, a dedicated
  concurrency error code threaded through the `Result` channel, was not worth a parallel failure path.
- **The attribute cannot be configured.** Being its own filter with no DI means no host can adjust
  its behavior, and a future need for a service (a policy, a logger, a metric) forces either a
  rewrite to `ServiceFilterAttribute` or a static dependency.
- **An absent `ETag` carries no signal.** A DTO without a `RowVersion` property produces no header at
  all, so a client cannot distinguish "this resource has no concurrency control" from "this
  deployment does not emit one". The no-op is the correct behavior and it says nothing.
- **Nothing here decides conditional GET.** The `ETag` exists to be echoed back on the next write:
  there is no `If-None-Match` handling and no 304 path, and the read-side caching answer remains
  [ADR-040](040-authenticated-output-caching-for-public-reads.md)'s output cache. An `ETag` on a
  response does invite a client to try, and the attempt is simply ignored.
- **Opt-in per action.** `[SupportsIfMatch]` has to be applied, and no fitness rule requires it
  anywhere, so a conditional write exists exactly where someone annotated one. The inverse rule
  covers what an update request must **not** carry, not which actions are guarded.
- **Enforcement is bound to a naming convention.** The rule keys on the `UpdateRequest` suffix. A
  mutable request that does not follow that suffix is outside its scope.
- **Cross-engine asymmetry.** SQL Server gets a server-generated `rowversion`; SQLite and other
  relational providers get an application-managed `IsConcurrencyToken` over the same `byte[]` (EF
  sends the value on INSERT rather than expecting the database to generate it). Cosmos has its own
  ETag concurrency mechanism that is not routed through this property.
- **Adoption is a schema step per database.** Every table needs the `RowVersion` column for the token
  to exist there, so a new database, or a table introduced outside the migrations that carry it, has
  no version to condition on.

## Related
ADR-017 (HTTP request idempotency, which dedups retries of the **same** request, the mirror-image
concern to two **distinct** edits racing here, and whose declared-intent gate sits at this same
edge), ADR-021 (consumer-side inbox, which dedups broker redeliveries of the **same** event,
likewise distinct from concurrency), ADR-006 (the one-shared-context-per-engine model over which the
`RowVersion` token is configured uniformly), ADR-015 (the fitness-function-over-discipline
enforcement this reuses), ADR-005 (soft-delete and audit fields live on the same
`AuditableBaseEntity` base that carries `RowVersion`),
[ADR-034](034-generic-entity-query-layer.md) (the generic entity controller whose `GetByIdAsync`
emits the `ETag`, and whose `fields=` shaping the emitter has to see through),
[ADR-099](099-generic-write-side-entity-commands.md) (the generic PUT that carries
`[SupportsIfMatch]` and hands the decoded token to `UpdateEntityCommand`),
[ADR-013](013-result-pattern.md) (the ProblemDetails edge the 428, the 400 and the 412 all speak).
