# Optimistic concurrency with a required If-Match: RowVersion from the database to a 412

> Series: MMCA.Common · Article #13 (deep-dive) · Pillar P2/P3 · Group G07 · Rubric §8 · ADR-035 ·
> Status: grounded in `Website/docs-src/adr/035-optimistic-concurrency.md`, `MMCA.Common.Shared/DTOs/IConcurrencyAware.cs`,
> `MMCA.Common.Domain/Entities/AuditableBaseEntity.cs`, `MMCA.Common.Application/.../Persistence/IRepository.cs`,
> `MMCA.Common.Infrastructure/.../EFRepository.cs`, `MMCA.Common.Application/.../MutateEntityHandlerBase.cs`,
> `ApplicationDbContext.cs` (`ConfigureConcurrencyTokens`), `DataSources/Engines/RowVersionStrategy.cs` and the four
> engine capability declarations, `CosmosDbContext.cs`, `AuditSaveChangesInterceptor.cs`,
> `MMCA.Common.API/Middleware/DbUpdateExceptionHandler.cs`,
> `MMCA.Common.API/Concurrency/SupportsIfMatchAttribute.cs`, `MMCA.Common.Shared/Http/ConcurrencyETag.cs`,
> `MMCA.Common.Testing.Architecture/Rules/Governance/ArchitectureRules.Governance.cs`, and the ADC/Store adopters. No em dashes.

**Subtitle:** Two admins open the same session, both edit it, both hit Save. Without a precondition the
second write silently wins and the first admin's change is gone, with no error, no log, no trace. Here is
the concurrency token that travels from the database out as a weak `ETag`, back in a required `If-Match`
header, and into EF's WHERE clause, so a stale edit is a `412 Precondition Failed` and a write that states
no precondition at all is a `428 Precondition Required`, formalized in ADR-035.

---

An organizer opens a conference session to fix the room. A speaker opens the same session, at the same
time, to fix the abstract. Both read the row. The organizer saves first. Then the speaker saves, over the
top, and the room change vanishes. Nobody typed anything wrong. Nobody saw an error. The system did
exactly what a load-modify-save handler does by default: it loaded the freshest row, applied the request,
and wrote it back. Last write wins.

That default is fine for a single-user admin tool and quietly wrong for a multi-actor system. Every
mutable aggregate in the framework is edited through the same shape: the update handler fetches the
tracked entity, applies the request, and calls `SaveChangesAsync`. With one shared context per engine
(ADR-006) and no concurrency token, two editors who both read a row and save in turn overwrite each other
and nothing surfaces the collision.

## Why it matters, and why it is not idempotency

The lost update is a data-integrity bug that never announces itself. It does not throw. It does not log.
It leaves a perfectly valid-looking row. You find out when the organizer reopens the session a day later
and their room assignment is simply not there, and by then the winning write is indistinguishable from a
correct one.

It is worth being precise about what this is, because the framework already carries two things that sound
adjacent. Request idempotency (ADR-017) dedups a client that retries the *same* request. The consumer
inbox (ADR-021) dedups a broker that redelivers the *same* event. Both answer "I saw this one action more
than once." Optimistic concurrency answers the opposite question: "two *distinct* actions targeted the
same row, which one is stale?" Same neighborhood, different problem. Idempotency collapses duplicates into
one effect; concurrency control keeps two genuine edits from silently clobbering each other.

## The MMCA answer: a database token, handed out as an ETag, demanded back as a precondition

The mechanism is a concurrency token that the database manages, the read model exposes, the client states
back in the `If-Match` header, and the persistence layer plants as EF's *original* value so a stale update
fails inside the UPDATE statement itself. There is exactly one transport for it, and on a guarded action
no way past it: a conditional write that states no precondition never reaches the action.

It rests on four members.

`AuditableBaseEntity<TId>` carries a `byte[] RowVersion` property with a private setter, so every
aggregate root and every child entity inherits it and no domain code ever sets it. On SQL Server it maps
to a server-generated `rowversion` that auto-increments on every write; the value is populated by EF, and
the aggregate's behavior never sees it. Concurrency stays a persistence concern, not a domain one.

`IConcurrencyAware` is the read contract, a single non-nullable `byte[] RowVersion { get; init; }`. Read
DTOs implement it so the API can render the current token as the response `ETag`. Update requests do not
implement it: the precondition travels in the header alone, and the token is the header's whole content,
so it is never optional.

`IWriteRepository.SetOriginalRowVersion` is the persistence extension point. `MutateEntityHandlerBase`
calls it right after loading the entity and before applying the request, with the token the concrete
handler reports through its `RowVersion(command)` override. The EF implementation writes that token to
`Entry(entity).Property(nameof(RowVersion)).OriginalValue`, and it rejects null: there is no value that
means skip the check. A second overload takes any tracked `IRowVersioned` child, because the
aggregate-typed one can only reach the root.

`IWriteRepository.TouchConcurrencyToken` closes the hole that stamping alone leaves. Setting the original
value does not make the entry dirty, so an applier that changed only child rows would leave the root
`Unchanged`, EF would emit no root UPDATE, and there would be nothing for the database to compare the
token against. Under a conditional write the handler base marks the root as modified, so the save emits
a root UPDATE carrying the caller's token. The one exit before that point is the idempotent no-op: a
mutation that calls `MutationContext.SkipSave` finishes successfully with nothing written, so no UPDATE
runs and no precondition is evaluated on that path.

```csharp
// The read DTO exposes the token; the API renders it as the response ETag.
public record class SessionDTO : IBaseDTO<SessionIdentifierType>, IConcurrencyAware
{
    public byte[] RowVersion { get; init; } = [];   // the version the client last read
}

// The update request carries no token: the precondition travels in If-Match.
public record class SessionUpdateRequest : ISessionFieldsRequest
{
    public required string Title { get; init; }
}

// The action reads the decoded header token and puts it on the command.
var rowVersion = SupportsIfMatchAttribute.RequiredToken(HttpContext);
var result = await UpdateHandler.HandleAsync(
    new UpdateSessionCommand(id, request, rowVersion), cancellationToken);

// The handler reports the token; the shared base does the stamping.
protected override byte[]? RowVersion(UpdateSessionCommand command) => command.RowVersion;
// MutateEntityHandlerBase: SetOriginalRowVersion(entity, rowVersion), then
// TouchConcurrencyToken(entity) so a conditional save emits a root UPDATE.
// A stale token matches no row -> DbUpdateConcurrencyException -> 412 Precondition Failed.
```

That is the client contract: the read hands you an entity tag, and the edit is refused unless you state
that tag back.

## The detail that actually makes it a conflict

The interesting part is not "store a version number." It is *where* the comparison happens. A hand-rolled
"read the current token, compare it to the client's, then save if they match" reintroduces the exact race
it is meant to close: another writer can slip in between the compare and the save.

`SetOriginalRowVersion` sidesteps that entirely. Once the client's token is EF's original value for the
row, EF includes it in the UPDATE's `WHERE` clause. The comparison runs *in the database*, atomically,
as part of the write. If the row's current token no longer matches (someone else wrote since the client
read), the UPDATE affects zero rows and EF raises `DbUpdateConcurrencyException`. There is no window. The
check and the write are the same statement.

`ConfigureConcurrencyTokens` wires this for every non-owned `IAuditableEntity` in a relational context's
model, uniformly, and the engine decides how. Each data source engine declares a `RowVersionStrategy` in
its capabilities. SQL Server declares `StoreGenerated`, so the property is configured with `IsRowVersion`
(server-generated). PostgreSQL and SQLite declare `ClientStamped`: the property falls back to
`IsConcurrencyToken` over the same `byte[]`, and `AuditSaveChangesInterceptor` writes a fresh value on
every insert and every update, so the next stale writer's `WHERE` clause misses. Cosmos declares `None`,
and its context never calls `ConfigureConcurrencyTokens`. One configuration, every auditable table on a
relational engine, no per-entity boilerplate.

## From exception to a status at the edge

`DbUpdateConcurrencyException` is a `DbUpdateException`, and the framework already has one handler for
that whole family. `DbUpdateExceptionHandler` translates any `DbUpdateException` into an RFC 9457
`409 Conflict` ProblemDetails, logs the full exception, and returns a deliberately generic detail message
("A data conflict occurred. Please retry or contact support.") so the database schema never leaks to the
client. This is the same edge that returns 409 for unique-constraint and foreign-key violations, so on an
unguarded endpoint a concurrency conflict inherits its translation, logging, and schema-safe message with
no new middleware. On a guarded action the concurrency conflict never reaches that handler: the filter
catches the `DbUpdateConcurrencyException` itself and answers `412` with its own problem details (title
"Precondition failed", stable error code `Concurrency.PreconditionFailed`). A unique or foreign-key
`DbUpdateException` thrown on the same action is not caught there and still reaches the client as the
generic 409. Either way the caller gets a status it can act on: reload, show the fresh values, let the
human decide.

## The transport: a weak ETag out, a required If-Match back

The same `RowVersion`, the same `SetOriginalRowVersion` extension point, the same comparison inside the
UPDATE. The header is where the token lives on the wire, which means anything that speaks HTTP can
participate: a generic REST tool, a mobile stack, curl.

The read emits it. `EntityControllerBase` calls `SetConcurrencyETag` on the DTO it is about to return,
which writes a weak `ETag` (`W/"<base64 of the token>"`). Weak is the honest strength: the tag
identifies the row's version, not a byte-exact representation, and the same row serializes differently
under a `fields=` projection (the emitter reads the token out of the shaped dictionary in that case). A
DTO with no `RowVersion` property, or an empty token, gets no header at all.

The write consumes it. `[SupportsIfMatch]` is a sealed attribute that implements `IAsyncActionFilter`
directly, so unlike the DI-resolved `[Idempotent]` filter it needs no host registration. Before the action
runs it decodes `If-Match` and places the token in `HttpContext.Items` under `TokenItemKey`, where the
action reads it back with `SupportsIfMatchAttribute.RequiredToken`. No bound argument is written to, so no
request model has to loosen its immutability to receive a token. Three decisions matter: a request that
states **no precondition** is refused with `428 Precondition Required` and the action never runs (a blank
header and `*` both count, because the wildcard names no particular version), a **malformed** tag is a
`400` short-circuit because the server cannot tell what the caller meant, and only a decodable tag lets
the action run.

Then the status changes. After the action, `RewriteConflictToPreconditionFailed` turns two conflict
outcomes into `412 Precondition Failed`: a thrown `DbUpdateConcurrencyException` gets a fresh 412 problem
response, and a 409 result the action itself returned keeps its problem-details body and has only its
status relabeled. It does so unconditionally, because every request that reached the action stated a
precondition. RFC 9110 reserves 412 for a precondition the client stated in a conditional request
header, which is exactly what `If-Match` is; 409 stays the answer on the unconditional endpoints, for a
conflict the client never conditioned on.

```http
PUT /orders/42/pay
(no If-Match header)
428 Precondition Required

GET /orders/42
200 OK
ETag: W/"AAAAAAAAB9E="

PUT /orders/42/pay
If-Match: W/"AAAAAAAAB9E="
412 Precondition Failed
```

The generic `UpdateAsync` on `CrudEntityControllerBase` carries the attribute, so every CRUD `PUT`
inherits the precondition without anyone remembering it. Beyond that it is applied by hand, on 41 actions
across 23 controllers today: 25 across eleven controllers in Store (in Sales, two in `OrdersController`,
three in `OrderFulfillmentController` and two in `InventoryItemsController`; in Catalog, four each in
`ProductAttributesController` and `ProductVariantsController`, two each in `CategoriesController` and
`ReviewModerationController`, and one each in `ProductsController`, `ProductImagesController` and
`ReviewsController`; in Identity, three in `CustomersController`) and 16 across twelve in ADC (three in
Engagement's `SessionQuestionsController`, two in its `LivePollsController`, two in Conference's
`EventLifecycleController`, and one each in nine more Conference controllers). Nothing here decides
conditional GET. The tag exists to be stated back on the next write, and there is no `If-None-Match`
handling and no 304 path.

## The invariant: one source for the precondition

A convention that lives only in a code-review checklist rots. So the one-transport rule is enforced
mechanically. `ArchitectureRules.UpdateRequestsAreNotConcurrencyAware` scans each module's Application
assemblies for every type whose simple name ends in `UpdateRequest` and flags any that *does* implement
`IConcurrencyAware`, because a token in the body would give the same check a second, competing source.
`ConcurrencyConventionTestsBase` exposes it as a single `[Fact]`,
`UpdateRequests_ShouldNotImplement_IConcurrencyAware`, and all three consumers subclass it: ADC, Store
and Helpdesk each supply their own `IArchitectureMap`. A module with no mutable aggregate is legitimately
vacuous, and so is MMCA.Common's own subclass: the rule reads only module Application assemblies, and the
framework's map declares none. This is
invariant-over-discipline (ADR-015), and it is the type-level half of the rule; the 428 is the caller-level
half, so on a guarded action neither a request model nor a client can quietly reintroduce
last-write-wins. Which actions are guarded is a separate question that no rule answers: the attribute is
opt-in per action, and an unguarded write is still last-write-wins.

Both apps have adopted the pattern end to end. In ADC, `UpdateSessionHandler` overrides `RowVersion` to
report the token that arrived on `UpdateSessionCommand`, `SessionDTO` implements `IConcurrencyAware`, and
`SessionUpdateRequest` implements only its field contract. In Store, the same shape runs across all three
modules: Catalog and Identity edits are appliers over the shared handler base (changing a customer's
email, changing a product's brand), and the Sales order transitions (`PayOrderHandler`,
`DeliverOrderHandler`, `CancelOrderHandler`, `ShipOrderHandler`, `UpdateShipmentHandler`) each report the
command's token the same way. Two of them, `PayOrderHandler` and `CancelOrderHandler`, also compare the
token by hand (`OrderConcurrency.EnsureCurrent`) before they call the payment provider, because the
framework's check runs at the save, after the mutation, and a provider call cannot be taken back. That
compare is an early refusal, not the guard: the `WHERE`-clause check still runs on the save. A stale
token caught early is an `Error.Conflict` with code `Order.Concurrency.Stale`, which the filter relabels
to 412, so the `/orders/42/pay` exchange above answers 412 under that code rather than
`Concurrency.PreconditionFailed`. Both apps run one database per service (ADR-006), and every table mapped
from an auditable entity carries the `RowVersion` column from the migration that creates it: Store's
Catalog `InitialCreate` adds it to the aggregate tables (its inbox and outbox tables carry none), and the
later `AddProductReviews` migration adds it with the review tables.

## Trade-offs, honestly

- **On a guarded action the precondition is mandatory, and that is a real constraint.** A caller that
  has not read the resource cannot write it. There is no null token, no wildcard escape, no legacy-client
  path: a write with no `If-Match` is a 428 and stops there. Scripts and generic REST tools have to do a
  GET first, and a client that drops the header sees an immediate error instead of a silent overwrite.
  That is the trade the framework makes, deliberately.
- **Opt-in per action.** `[SupportsIfMatch]` has to be applied, and no fitness rule requires it anywhere,
  so a conditional write exists exactly where someone annotated one. The handler base's `RowVersion`
  override defaults to no token, and with no token it skips the stamp, so an endpoint nobody guarded is
  last-write-wins with no error. The fitness rule covers what an update request must not carry, not which
  actions are guarded.
- **The 409 is coarse, and only the guarded concurrency path escapes it.** Every `DbUpdateException`
  that reaches the global handler maps to one 409 with a generic message, so on an unguarded endpoint a
  client cannot tell a concurrency conflict from a unique-constraint or foreign-key violation. That is
  deliberate (no schema leak), but it means retry logic treats the three the same. On a guarded action the
  concurrency conflict is a 412 with its own error code, and a thrown unique or foreign-key violation
  stays a 409. The relabel of a returned 409 keys on the conflict *outcome*, not its cause, so an action
  whose own `Error.Conflict` result means a duplicate key reports it as a 412, error codes intact, under a
  status naming a precondition the client did not actually violate.
- **It does not merge.** Optimistic concurrency detects the collision and refuses the stale write. It does
  not reconcile the two edits for you. What to do on a 412 (reload and retry, or surface a diff to the
  human) is the caller's decision, not the framework's.
- **Cross-engine asymmetry.** SQL Server gets a server-generated `rowversion`; PostgreSQL and SQLite get
  an application-managed `IsConcurrencyToken` over the same `byte[]`, re-stamped by the audit interceptor
  on every insert and update. Cosmos gets no framework concurrency token at all: its engine declares
  `RowVersionStrategy.None` and its context skips `ConfigureConcurrencyTokens`, so `[SupportsIfMatch]`
  over a Cosmos-mapped entity stamps an original value on a property EF does not compare.
- **A child-level precondition costs a second field.** `If-Match` names exactly one version, and that slot
  belongs to the aggregate root, so a write that needs to condition on a child row states that second
  precondition in the body: Store's `ProductVariantChangePriceRequest` carries a required
  `VariantRowVersion` (and no product token at all), which the child-typed `SetOriginalRowVersion` overload
  stamps on the tracked variant. A conflicting edit to the *same* variant then fails the precondition even
  when the product row was untouched. Two preconditions on one write is the price of keeping the aggregate
  boundary intact.
- **Every conditional write that saves touches the root.** `TouchConcurrencyToken` marks the aggregate
  root modified so the precondition is actually evaluated, which means a conditional write emits a root
  UPDATE and advances the root's token, even when only a child row changed. (An idempotent no-op that calls
  `SkipSave` writes nothing, so it neither touches the root nor evaluates the token.) Correctness over a spared
  statement: the cost is that every other editor holding that aggregate's tag now has a stale one.
- **Adoption is a schema step per database.** Every auditable table needs the `RowVersion` column for the
  token to exist there, so a new database, or a table added later, has no version to condition on until
  its migration carries the column.

None of these are reasons to keep last-write-wins. They are the reasons to state the precondition
explicitly and to decide, per endpoint, what a conflict means to your user.

## Apply this even without MMCA

The pattern ports to any load-modify-save stack:

1. Put a **database-managed concurrency token** on your rows (SQL Server `rowversion`, a Postgres `xmin`,
   or an application-managed version column). Do not hand-maintain it in domain code.
2. **Hand it out on the read, demand it back on the write.** Expose the token as a weak `ETag` on the
   read and require the client to state it in `If-Match` on the update. Pick one transport and keep it:
   a second copy in the payload gives the same check a competing source, and nothing at runtime tells you
   which one was honored.
3. **Do the comparison in the write, not before it.** Set the client's token as the row's *expected*
   value so it lands in the UPDATE's `WHERE` clause. A read-then-compare-then-save reopens the race. Make
   sure the write actually happens: if only child rows changed, the parent row needs touching or the
   comparison never runs.
4. **Answer with a status the caller can act on:** `428 Precondition Required` when no precondition was
   stated, `400 Bad Request` when it cannot be decoded, `412 Precondition Failed` when it is stale. Then
   let the caller decide how to recover.
5. **Make the rule a build failure, not a review comment.** A naming-convention fitness test (here: no
   `*UpdateRequest` type carries the token) keeps a new mutable endpoint from growing a second source of
   the same precondition.

The takeaway: **a lost update is the write you never see fail. Give the row a database-managed token, hand
it out as an `ETag`, require it back as an `If-Match` precondition, and compare it inside the UPDATE, so a
stale save is a `412` the caller can handle and a save that states no precondition is a `428`, instead of
an overwrite nobody notices.**

---

**What we covered:** why a load-modify-save handler silently loses the first of two concurrent edits, how
MMCA.Common gives every auditable entity on a relational engine a `RowVersion` token whose mapping each
engine declares, renders it on the read as a weak `ETag` through `IConcurrencyAware`, requires it back in
`If-Match` on a guarded action so a write with no precondition is a `428 Precondition Required`, plants it
as EF's original value via `SetOriginalRowVersion` (and touches the root so the comparison always runs) to
detect the conflict atomically inside the UPDATE, answers that conflict with `412 Precondition Failed` at
the edge, and keeps the token out of every request body with a build-wide fitness function.

**Next in the series:** self-ordering modules, discovered and Kahn-sorted so a dependency is always
registered before the modules that need it.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read ADR-035 for the decision record, or
`dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: https://github.com/ivanball/MMCA.Common
- 📚 Full series index: https://ivanball.github.io/writing.html
- 📄 ADR-035 (optimistic concurrency) in the docs site.

*Tags: .NET, C Sharp, Software Architecture, Entity Framework, Concurrency*

*Notes: 2026-10-08 refresh, verified at MMCA.Common v1.233.0 (`MMCA.Common/FACTS.md:14`) against the
same-day audit (`Docs/Planning/Quality/medium-apply-2026-10-08/13-optimistic-concurrency-rowversion.json`).
Changed this run: the fitness rule has three consumers (ADC
`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Domain/ConcurrencyConventionTests.cs:3`, Store
`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Domain/ConcurrencyConventionTests.cs:3`,
Helpdesk `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:56`) and
MMCA.Common's own subclass (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Domain/ConcurrencyConventionTests.cs:13`)
is vacuous (ADR-035 `:128-137`, Revision 2026-10-07 `:299-307`); the "always emits a root UPDATE" wording is
qualified by the `SkipSave` no-op exit in `MutateEntityHandlerBase.cs:310-311`, which returns before
`TouchConcurrencyToken` (`:319-320`) and the save (no guarded action calls `SkipSave` today; the only
consumer call is ADC `RemoveUserAvatarHandler.cs:42`, unguarded); Store's `PayOrderHandler.cs:60` and
`CancelOrderHandler.cs:68` run the pre-provider compare
`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/OrderConcurrency.cs:34`
(`EnsureCurrent`, M219), whose stale result is `Error.Conflict` code `Order.Concurrency.Stale` (`:41-45`)
relabeled to 412 by the filter (remarks `:17-22`); EFRepository, MutateEntityHandlerBase,
ApplicationDbContext, AuditSaveChangesInterceptor, CHANGELOG and ADR-035 anchors corrected in place below.
Earlier entry: 2026-10-02 refresh at MMCA.Common v1.221.0. Anchors re-read in that run
are marked (re-read); the rest were CONFIRMED by the same-day audit
(`Reports/update-medium/2026-10-02/13-optimistic-concurrency-rowversion.json`).
`IConcurrencyAware` at `Source/Core/MMCA.Common.Shared/DTOs/IConcurrencyAware.cs:15` declares a
non-nullable `byte[] RowVersion { get; init; }` at `:19`; the remarks at `:10-13` state that the token is
never optional and that "Update requests carry no token: the precondition travels in the header alone".
`RowVersion` private-setter property on the audit base at
`Source/Core/MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:53` (the base implements `IRowVersioned`
at `:13`). `IWriteRepository` lives at
`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRepository.cs` (re-read): the
root overload `void SetOriginalRowVersion(TEntity entity, byte[] rowVersion)` at `:408`, the child overload
`SetOriginalRowVersion(Domain.Interfaces.IRowVersioned childEntity, byte[] rowVersion)` at `:419` (doc
`:410-418`), and `TouchConcurrencyToken(TEntity entity)` as a default no-op at `:442` (doc `:421-441`,
SEC-Common-77). EF implementations at
`Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs`: root `:76-84`
(`OriginalValue` write `:81-83`), child `:87-95`, `TouchConcurrencyToken` `:98` (re-read); both overloads
reject a null token with `ArgumentNullException.ThrowIfNull(rowVersion)` (`:79`, `:90`), so there is no value that
means skip the check. The shared write pipeline
`Source/Core/MMCA.Common.Application/UseCases/Crud/MutateEntityHandlerBase.cs` (re-read) declares
`protected virtual byte[]? RowVersion(TCommand command) => null` at `:91` (doc `:84`), stamps only when the
override reports a non-empty token (`:298`, `SetOriginalRowVersion` `:300`), returns early on the
idempotent no-op when `context.SaveSkipped` (`:310-311`), and otherwise calls `TouchConcurrencyToken` at
`:320` (inside `if (conditionalWrite)` at `:319`); the opt-in trade-off is ADR-035 `:209-211`.
Per-engine mapping (re-read): `ConfigureConcurrencyTokens` at
`Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:589` (doc
`:577-588`), keyed on `Engine.Capabilities.RowVersion == RowVersionStrategy.StoreGenerated` at `:592`,
`IsRowVersion` `:602`, else `IsConcurrencyToken` `:606`, called from `OnModelCreating` (`:417`) at `:421`.
`RowVersionStrategy` (`None`, `StoreGenerated`, `ClientStamped`) at
`.../Persistence/DataSources/Engines/RowVersionStrategy.cs:8-18`; declarations at
`SQLServerDataSourceEngine.cs:46` (`StoreGenerated`), `PostgreSQLDataSourceEngine.cs:44` and
`SqliteDataSourceEngine.cs:43` (`ClientStamped`), `CosmosDataSourceEngine.cs:46` (`None`).
`AuditSaveChangesInterceptor.cs` stamps `Guid.NewGuid().ToByteArray()` when `ClientStamped` (capability gate
`:67`, insert stamp `:88`, update stamp `:97`, `StampRowVersion` `:113-119` with the new value at `:117`). `CosmosDbContext.OnModelCreating` at `.../DbContexts/CosmosDbContext.cs:119-146`
calls neither `base.OnModelCreating` nor `ConfigureConcurrencyTokens` (comment `:139-143`).
`DbUpdateExceptionHandler` maps any `DbUpdateException` to `409 Conflict` with a generic detail plus a
full log at `Source/Presentation/MMCA.Common.API/Middleware/DbUpdateExceptionHandler.cs:28-51`
(status set `:33`).
HTTP transport: `ConcurrencyETag` at `Source/Core/MMCA.Common.Shared/Http/ConcurrencyETag.cs:24` formats
the weak tag `W/"<base64>"` at `:40-45` (`If-Match` header name `:27`, `ETag` `:30`, wildcard `:33`); the
class sits in the Shared package so the UI can format the header too (`CHANGELOG.md:2516`). The read side
emits it from `Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs` (re-read):
`SetConcurrencyETag` called at `:382`, emitter at `:417`, which finds a public `byte[]` property named
`RowVersion` by reflection (`:391-395`) and reads the shaped dictionary under `fields=` (`:440`). The write
side is `Source/Presentation/MMCA.Common.API/Concurrency/SupportsIfMatchAttribute.cs` (re-read): sealed
`Attribute, IAsyncActionFilter` at `:49`, `TokenItemKey` (`"MMCA.Common.API.Concurrency.IfMatchToken"`)
at `:57`, `RequiredToken(HttpContext)` at `:68-76`, the decode into `HttpContext.Items` at `:122`, no
precondition (blank or `*`) short-circuited to `428 Precondition Required` at `:109-114` (result `:162-171`),
a malformed tag to `400` at `:116-120` (result `:174-180`), and `RewriteConflictToPreconditionFailed` at
`:92` and `:130-159` ("every request reaching the action stated a precondition", `:127`): the exception
branch matches only `DbUpdateConcurrencyException` (`:132`) and answers with `PreconditionFailedResult`
(`:186-195`, code `Concurrency.PreconditionFailed`), while a returned 409 has only its status relabeled
(`:141-158`; outcome-keyed remark `:36-40`). No bound argument is written to and no request model may carry
a token (`:51-56`).
The generic conditional `PUT` is `CrudEntityControllerBase.UpdateAsync`: `[SupportsIfMatch]` at
`Source/Presentation/MMCA.Common.API/Controllers/CrudEntityControllerBase.cs:90`, `RequiredToken` read at
`:103`, with 409/412/428 `ProducesResponseType` at `:94-96`.
Explicit `[SupportsIfMatch]` adoption (re-read, Grep count over `*.cs`) is 41 actions across 23
controllers: 25 across eleven in `MMCA.Store/Source` (Sales `OrdersController.cs` 2 at `:297`, `:357`;
`OrderFulfillmentController.cs` 3 at `:55`, `:88`, `:134`; `InventoryItemsController` 2; Catalog
`ProductAttributesController` 4, `ProductVariantsController` 4, `CategoriesController` 2,
`ReviewModerationController` 2, `ProductsController` 1, `ProductImagesController` 1, `ReviewsController` 1;
Identity `CustomersController` 3) and 16 across twelve in `MMCA.ADC/Source`
(`Engagement.API/Controllers/SessionQuestionsController.cs` 3, `LivePollsController.cs` 2;
`Conference.API/Controllers/Events/EventLifecycleController.cs` 2; one each in the `Events`, `Sponsors`,
`Speakers`, `Sessions`, `SessionAssets`, `Questions`, `Partners`, `ConferenceCategories` and `Activities`
Conference controllers).
Fitness rule `UpdateRequestsAreNotConcurrencyAware` at
`Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Governance/ArchitectureRules.Governance.cs:24-35`
(the `must not implement` violation message `:30-34`); single `[Fact]` base
`ConcurrencyConventionTestsBase.UpdateRequests_ShouldNotImplement_IConcurrencyAware` at
`.../Bases/Domain/ConcurrencyConventionTestsBase.cs:14`; three consumers subclass it (ADC and Store
`Domain/ConcurrencyConventionTests.cs:3`, Helpdesk `ArchitectureTests.cs:56` over `TicketUpdateRequest`),
and MMCA.Commons own subclass (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Domain/ConcurrencyConventionTests.cs:13`)
is vacuous because the rule reads only module Application assemblies (ADR-035 `:128-137`).
ADC adoption: `UpdateSessionHandler.cs:35` overrides `RowVersion(command) => command.RowVersion`;
`UpdateSessionCommand.cs:16` declares `byte[] RowVersion` on the command (doc `:11-15`: "read from the
request's `If-Match` header ... It is required"); `SessionDTO.cs:15` implements `IConcurrencyAware`;
`SessionUpdateRequest.cs:6` implements only `ISessionFieldsRequest`. Store adoption (re-read): Sales
transitions override the same template method with `command.RowVersion` (`PayOrderHandler.cs:44`,
`DeliverOrderHandler.cs:39`, `CancelOrderHandler.cs:46`, `ShipOrderHandler.cs:32`,
`UpdateShipmentHandler.cs:24`); Catalog and Identity edits are appliers over the shared base
(`CustomerChangeEmailApplier.cs`, `ProductChangeBrandApplier.cs`);
`ProductVariantChangePriceRequest.cs:15` implements nothing and carries a single
`public required byte[] VariantRowVersion { get; init; }` at `:24`, documented at `:7-13` as the second,
child-level precondition the single-valued header has no room for, stamped by
`ChangeVariantPriceHandler.cs:47` through the child overload (guarded by `trackedVariant is not null`
`:43`).
Schema (re-read): in
`MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer.Catalog/Migrations/20260621192800_InitialCreate.cs`
the aggregate tables carry a `rowversion` column (`:34`, `:98`, `:128`, `:158`, `:184`) and
`InboxMessages` (`:48`) and `OutboxMessages` (`:63`) carry none; the review tables get theirs from
`20260906030347_AddProductReviews.cs` (`:52`, `:77`).
The HTTP block is an illustrative exchange over the real `[HttpPut("{id}/pay")]` (`OrdersController.cs:296`)
+ `[SupportsIfMatch]` (`:297`) action; `OrdersController` emits the ETag at `:182`.
Rubric §8 = "Data Architecture" (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:276`); Group G07
persistence covers both `SetOriginalRowVersion` overloads under its `IWriteRepository` section
(`Website/docs-src/onboarding/group-07-persistence-ef-core.md`). Design in
`Website/docs-src/adr/035-optimistic-concurrency.md` (Accepted 2026-07-02, revised 2026-09-07,
2026-10-01, 2026-10-06 and 2026-10-07, status `:3-10`): the fitness function at `:121-137`, the trade-offs at
`:188-229` (opt-in `:209-211`, cross-engine, Cosmos), the 2026-09-07 revision (`TouchConcurrencyToken`,
SEC-Common-77) at `:231-256`, the 2026-10-01 current-state corrections at `:258-272`, the 2026-10-06
revision (engine-declared `RowVersionStrategy`) at `:274-292` and the 2026-10-07 revision (three
consumers, vacuous Common run) at `:294-318`. The header-only transport landed in Common v1.173.0
(`CHANGELOG.md:2500`), which deleted the body transport (`:2510-2518`). The C# code block is
illustrative of the documented shape (composed from the real `SessionDTO`, `SessionUpdateRequest`,
`UpdateSessionCommand`, `UpdateSessionHandler` and `CrudEntityControllerBase`); neither block is a
verbatim copy of one file. Changed this run: adoption counts 40/18 (Store 24/7, ADC 16/11) to 41/23
(Store 25/11, ADC 16/12); the guarded-action conflict path (filter builds its own 412; thrown unique/FK
stays 409); Cosmos (no token, `RowVersionStrategy.None`, not an ETag mechanism); per-engine mapping via
`RowVersionStrategy`; `RowVersion` only on auditable tables; opt-in-per-action trade-off and the
narrowed invariant; all moved anchors.*
