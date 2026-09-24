# Optimistic concurrency you cannot opt out of: RowVersion from the database to a required If-Match

> Series: MMCA.Common · Article #13 (deep-dive) · Pillar P2/P3 · Group G07 · Rubric §8 · ADR-035 ·
> Status: grounded in `Website/docs-src/adr/035-optimistic-concurrency.md`, `MMCA.Common.Shared/DTOs/IConcurrencyAware.cs`,
> `MMCA.Common.Domain/Entities/AuditableBaseEntity.cs`, `MMCA.Common.Application/.../Persistence/IRepository.cs`,
> `MMCA.Common.Infrastructure/.../EFRepository.cs`, `MMCA.Common.Application/.../MutateEntityHandlerBase.cs`,
> `ApplicationDbContext.cs` (`ConfigureConcurrencyTokens`), `MMCA.Common.API/Middleware/DbUpdateExceptionHandler.cs`,
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
fails inside the UPDATE statement itself. There is exactly one transport for it, and no way past it: a
conditional write that states no precondition never reaches the action.

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
token against. Under a conditional write the handler base marks the root as modified, so the save always
emits a root UPDATE carrying the caller's token.

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
// TouchConcurrencyToken(entity) so the save always emits a root UPDATE.
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

`ConfigureConcurrencyTokens` wires this for every non-owned `IAuditableEntity` in the model, uniformly.
On SQL Server the property is configured with `IsRowVersion` (server-generated). On other relational
providers it falls back to `IsConcurrencyToken` over the same `byte[]`, application-managed. One
configuration, every table, no per-entity boilerplate.

## From exception to a status at the edge

`DbUpdateConcurrencyException` is a `DbUpdateException`, and the framework already has one handler for
that whole family. `DbUpdateExceptionHandler` translates any `DbUpdateException` into an RFC 9457
`409 Conflict` ProblemDetails, logs the full exception, and returns a deliberately generic detail message
("A data conflict occurred. Please retry or contact support.") so the database schema never leaks to the
client. This is the same edge that already returns 409 for unique-constraint and foreign-key violations,
so a concurrency conflict inherits its translation, logging, and schema-safe message with no new
middleware. On a guarded action the conflict never reaches the client as a 409: the filter rewrites the
outcome to 412 after the action, keeping the problem-details body exactly as it was built. Either way the
caller gets a status it can act on: reload, show the fresh values, let the human decide.

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

Then the status changes. After the action, `RewriteConflictToPreconditionFailed` turns the conflict
outcome, both a `DbUpdateConcurrencyException` and an already-built 409 result, into
`412 Precondition Failed`. It does so unconditionally, because every request that reached the action
stated a precondition. RFC 9110 reserves 412 for a precondition the client stated in a conditional request
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
inherits the precondition without anyone remembering it. Beyond that it is applied by hand, on 40 actions
across 18 controllers today: 24 across seven controllers in Store (five in Sales' `OrdersController`,
five in `ProductsController`, four in `ProductVariantsController`, three each in `CustomersController`
and `ReviewsController`, two each in `CategoriesController` and `InventoryItemsController`) and 16 across
eleven in ADC (three in Conference's `EventsController`, three in Engagement's `SessionQuestionsController`,
two in its `LivePollsController`, and one each in eight more Conference controllers). Nothing here decides
conditional GET. The tag exists to be stated back on the next write, and there is no `If-None-Match`
handling and no 304 path.

## The invariant: one source for the precondition

A convention that lives only in a code-review checklist rots. So the one-transport rule is enforced
mechanically. `ArchitectureRules.UpdateRequestsAreNotConcurrencyAware` scans each module's Application
assemblies for every type whose simple name ends in `UpdateRequest` and flags any that *does* implement
`IConcurrencyAware`, because a token in the body would give the same check a second, competing source.
`ConcurrencyConventionTestsBase` exposes it as a single `[Fact]`,
`UpdateRequests_ShouldNotImplement_IConcurrencyAware`, and both consumers subclass it: ADC and Store each
supply their own `IArchitectureMap`. A module with no mutable aggregate is legitimately vacuous. This is
invariant-over-discipline (ADR-015), and it is the type-level half of the rule; the 428 is the caller-level
half, so neither a request model nor a client can quietly reintroduce last-write-wins.

Both apps have adopted the pattern end to end. In ADC, `UpdateSessionHandler` overrides `RowVersion` to
report the token that arrived on `UpdateSessionCommand`, `SessionDTO` implements `IConcurrencyAware`, and
`SessionUpdateRequest` implements only its field contract. In Store, the same shape runs across all three
modules: Catalog and Identity edits are appliers over the shared handler base (changing a customer's
email, changing a product's brand), and the Sales order transitions (`PayOrderHandler`,
`DeliverOrderHandler`, `CancelOrderHandler`, `ShipOrderHandler`, `UpdateShipmentHandler`) each report the
command's token the same way. Both apps run one database per service (ADR-006), so each per-service
database is created with the `RowVersion` column on every table by its own module's `InitialCreate`
migration, and the token is present from the first row.

## Trade-offs, honestly

- **The precondition is mandatory, and that is a real constraint.** A caller that has not read the
  resource cannot write it. There is no null token, no wildcard escape, no legacy-client path: a write
  with no `If-Match` is a 428 and stops there. Scripts and generic REST tools have to do a GET first, and
  a client that drops the header sees an immediate error instead of a silent overwrite. That is the
  trade the framework makes, deliberately.
- **The 409 is coarse, and the 412 inherits it.** All `DbUpdateException`s map to one 409 with a generic
  message, so from the status and body alone a client cannot tell a concurrency conflict from a
  unique-constraint or foreign-key violation. That is deliberate (no schema leak), but it means retry logic
  treats the three the same. The rewrite keys on the conflict *outcome*, not its cause, so on a guarded
  action all three come back as 412, and one of them then wears a status naming a precondition the client
  did not actually violate.
- **It does not merge.** Optimistic concurrency detects the collision and refuses the stale write. It does
  not reconcile the two edits for you. What to do on a 412 (reload and retry, or surface a diff to the
  human) is the caller's decision, not the framework's.
- **Cross-engine asymmetry.** SQL Server gets a server-generated `rowversion`; SQLite and other relational
  providers get an application-managed `IsConcurrencyToken` over the same `byte[]`. Cosmos has its own
  ETag mechanism that is not routed through this property.
- **A child-level precondition costs a second field.** `If-Match` names exactly one version, and that slot
  belongs to the aggregate root, so a write that needs to condition on a child row states that second
  precondition in the body: Store's `ProductVariantChangePriceRequest` carries a required
  `VariantRowVersion` (and no product token at all), which the child-typed `SetOriginalRowVersion` overload
  stamps on the tracked variant. A conflicting edit to the *same* variant then fails the precondition even
  when the product row was untouched. Two preconditions on one write is the price of keeping the aggregate
  boundary intact.
- **Every conditional write touches the root.** `TouchConcurrencyToken` marks the aggregate root modified
  so the precondition is actually evaluated, which means a conditional write always emits a root UPDATE and
  always advances the root's token, even when only a child row changed. Correctness over a spared
  statement: the cost is that every other editor holding that aggregate's tag now has a stale one.
- **Adoption is a per-database migration.** A new database, or a table added later, must carry the
  `RowVersion` column for the token to exist there.

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
MMCA.Common gives every auditable entity a database-managed `RowVersion`, renders it on the read as a weak
`ETag` through `IConcurrencyAware`, requires it back in `If-Match` so a write with no precondition is a
`428 Precondition Required`, plants it as EF's original value via `SetOriginalRowVersion` (and touches the
root so the comparison always runs) to detect the conflict atomically inside the UPDATE, rewrites that
conflict to `412 Precondition Failed` at the edge, and keeps the token out of every request body with a
build-wide fitness function.

**Next in the series:** self-ordering modules, discovered and Kahn-sorted so a dependency is always
registered before the modules that need it.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read ADR-035 for the decision record, or
`dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: https://github.com/ivanball/MMCA.Common
- 📚 Full series index: https://ivanball.github.io/writing.html
- 📄 ADR-035 (optimistic concurrency) in the docs site.

*Tags: .NET, C Sharp, Software Architecture, Entity Framework, Concurrency*

*Notes: verified type/behavior names with path:line at MMCA.Common v1.205.0 (`FACTS.md:14`).
`IConcurrencyAware` at `Source/Core/MMCA.Common.Shared/DTOs/IConcurrencyAware.cs:15` declares a
non-nullable `byte[] RowVersion { get; init; }` at `:19`; the remarks at `:10-13` state that the token is
never optional and that "Update requests carry no token: the precondition travels in the header alone".
`RowVersion` private-setter property on the audit base at
`Source/Core/MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:53` (the base implements `IRowVersioned`
at `:13`). `IWriteRepository` lives at
`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRepository.cs`: the root
overload `void SetOriginalRowVersion(TEntity entity, byte[] rowVersion)` at `:406`, the child overload
`SetOriginalRowVersion(Domain.Interfaces.IRowVersioned childEntity, byte[] rowVersion)` at `:417` (doc
`:408-416`), and `TouchConcurrencyToken(TEntity entity)` as a default no-op at `:440` (doc `:419-439`,
SEC-Common-77). EF implementations at
`Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs`: root `:75-83`
(`OriginalValue` write `:80-82`), child `:86-94`, `TouchConcurrencyToken` `:97`; both overloads reject a
null token with `ArgumentNullException.ThrowIfNull` (`:78`, `:89`), so no value means skip the check
(ADR-035 `:113-114`). The shared write pipeline stamps the token at
`Source/Core/MMCA.Common.Application/UseCases/Crud/MutateEntityHandlerBase.cs:292-296` (from the handler's
`RowVersion(command)` override) and calls `TouchConcurrencyToken` at `:313-314` when the write was
conditional (comment `:307-312`).
`ConfigureConcurrencyTokens` (every non-owned `IAuditableEntity`; SQL Server `IsRowVersion` `:595`, else
`IsConcurrencyToken` `:599`) at
`Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:582`, called from
`OnModelCreating` at `:415`.
`DbUpdateExceptionHandler` maps any `DbUpdateException` to `409 Conflict` with a generic detail plus a
full log at `Source/Presentation/MMCA.Common.API/Middleware/DbUpdateExceptionHandler.cs:28-51`
(status set `:33`).
HTTP transport: `ConcurrencyETag` at `Source/Core/MMCA.Common.Shared/Http/ConcurrencyETag.cs:24` formats
the weak tag `W/"<base64>"` at `:40-45` (`If-Match` header name `:27`, `ETag` `:30`, wildcard `:33`); the
class sits in the Shared package so the UI can format the header too (`CHANGELOG.md:1636`). The read side
emits it from `Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs`: `SetConcurrencyETag`
called at `:436`, emitter at `:471`. The write side is
`Source/Presentation/MMCA.Common.API/Concurrency/SupportsIfMatchAttribute.cs`: sealed
`Attribute, IAsyncActionFilter` at `:49`, `TokenItemKey` (`"MMCA.Common.API.Concurrency.IfMatchToken"`)
at `:57`, `RequiredToken(HttpContext)` at `:68-76`, the decode into `HttpContext.Items` at `:122`, no
precondition (blank or `*`) short-circuited to `428 Precondition Required` at `:109-114` (result `:162-171`),
a malformed tag to `400` at `:116-120` (result `:174-180`), and the unconditional
`RewriteConflictToPreconditionFailed` at `:92` and `:130-159` ("every request reaching the action stated a
precondition", `:127`). No bound argument is written to and no request model may carry a token (`:51-56`).
The generic conditional `PUT` is `CrudEntityControllerBase.UpdateAsync`: `[SupportsIfMatch]` at
`Source/Presentation/MMCA.Common.API/Controllers/CrudEntityControllerBase.cs:90`, `RequiredToken` read at
`:103`, with 409/412/428 `ProducesResponseType` at `:94-96`.
Explicit `[SupportsIfMatch]` adoption is 40 actions across 18 controllers: 24 across seven in
`MMCA.Store/Source` (`MMCA.Store.Sales.API/Controllers/OrdersController.cs` 5, e.g. `:298`, `:330`, `:363`,
`:409`, `:478`; `ProductsController` 5; `ProductVariantsController` 4; `CustomersController` 3;
`ReviewsController` 3; `CategoriesController` 2; `InventoryItemsController` 2) and 16 across eleven in
`MMCA.ADC/Source` (`Conference.API/Controllers/Events/EventsController.cs` 3;
`Engagement.API/Controllers/SessionQuestionsController.cs` 3; `.../LivePollsController.cs` 2; and one each
in `Sponsors`, `Speakers`, `Sessions`, `SessionAssets`, `Questions`, `Partners`, `Categories` and
`Activities` Conference controllers).
Fitness rule `UpdateRequestsAreNotConcurrencyAware` at
`Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Governance/ArchitectureRules.Governance.cs:24-35`
(the `must not implement` violation message `:30-34`); single `[Fact]` base
`ConcurrencyConventionTestsBase.UpdateRequests_ShouldNotImplement_IConcurrencyAware` at
`.../Bases/Domain/ConcurrencyConventionTestsBase.cs:14`; both consumers subclass it.
ADC adoption: `UpdateSessionHandler.cs:35` overrides `RowVersion(command) => command.RowVersion`;
`UpdateSessionCommand.cs:16` declares `byte[] RowVersion` on the command (doc `:11-15`: "read from the
request's `If-Match` header ... It is required"); `SessionDTO.cs:15` implements `IConcurrencyAware` with
`byte[] RowVersion { get; init; } = []` at `:42`; `SessionUpdateRequest.cs:6` implements only
`ISessionFieldsRequest`. Store adoption: Sales transitions override the same template method
(`PayOrderHandler.cs:33`, `DeliverOrderHandler.cs:38`, `CancelOrderHandler.cs:46`, `ShipOrderHandler.cs:31`,
`UpdateShipmentHandler.cs:23`); Catalog and Identity edits are appliers over the shared base
(`CustomerChangeEmailApplier.cs`, `ProductChangeBrandApplier.cs`);
`ProductVariantChangePriceRequest.cs:15` implements nothing and carries a single
`public required byte[] VariantRowVersion { get; init; }` at `:24`, documented at `:7-13` as the second,
child-level precondition the single-valued header has no room for, stamped by
`ChangeVariantPriceHandler.cs:47` through the child overload (guarded by `trackedVariant is not null`
`:43`).
Current shape is database-per-service (ADR-006): each per-service database is born with the `RowVersion`
column on every table via its own module's `InitialCreate` (e.g.
`MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer.Catalog/Migrations/20260621192800_InitialCreate.cs`);
`MMCA.ADC/Source/Hosting` and `MMCA.Store/Source/Hosting` hold only the per-module migration projects.
Rubric §8 = "Data Architecture" (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:260`); Group G07
persistence covers both `SetOriginalRowVersion` overloads under its `IWriteRepository` section
(`Website/docs-src/onboarding/group-07-persistence-ef-core.md`). Design in
`Website/docs-src/adr/035-optimistic-concurrency.md` (Accepted 2026-07-02, revised 2026-09-07, status
`:3-7`): the required header and the three status codes at `:79-86`, the two overloads and the
no-skip-value rule at `:108-114`, the fitness function at `:115-118`, and the 2026-09-07 revision
(`TouchConcurrencyToken`, SEC-Common-77) at `:201-215`. The header-only transport landed in Common
v1.173.0, which deleted the body transport (`CHANGELOG.md:1630-1638`). The C# code block is illustrative of
the documented shape (composed from the real `SessionDTO`, `SessionUpdateRequest`, `UpdateSessionCommand`,
`UpdateSessionHandler` and `CrudEntityControllerBase`), and the HTTP block is an illustrative exchange over
the real `[HttpPut("{id}/pay")]` + `[SupportsIfMatch]` action (`OrdersController.cs:298`); neither is a
verbatim copy of one file.*
