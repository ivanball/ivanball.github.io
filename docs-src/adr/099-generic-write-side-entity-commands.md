# ADR-099: Generic Write-Side Entity Commands (Create, Update, Delete Without a Handler per Aggregate)

## Status
Accepted (2026-08-29, framework v1.170.0). Extends
[ADR-034](034-generic-entity-query-layer.md), which gave every entity a generic read surface plus
create and delete, by completing the write half: a generic update command, its handler, a one-call DI
registration for all three verbs, and a controller base carrying the PUT. Additive throughout; no
existing controller, handler or registration changes.

## Context
ADR-034 records the read side of the generic resource layer and stops one verb short. Its
`AggregateRootEntityControllerBase` ships `[HttpPost]` create and `[HttpDelete("{id}")]`
(`Source/Presentation/MMCA.Common.API/Controllers/AggregateRootEntityControllerBase.cs:58`, `:84`),
and the framework already carried a generic delete command and handler. Update was the verb every
aggregate still hand-wrote.

That gap is small for an application with four aggregates and expensive for the shape this release
targets: a first module scaffolded from the template, where the aggregate is a title, a description,
a status and a child collection, and the update handler is the same twelve lines every time. The
shared load-mutate-save machinery already existed
(`Source/Core/MMCA.Common.Application/UseCases/MutateEntityHandlerBase.cs:34`, whose
`MutateCoreAsync` at `:135` loads the aggregate, stamps the caller's concurrency token at `:146`, runs
the mutation and saves at `:152`), so what was missing was not the workflow but a command and a
handler generic enough to close over any aggregate, plus somewhere for the module to say which
aggregate method a request maps to.

Two constraints shaped the answer.

**The mutation cannot move into the framework.** An update names fields, and a framework type that
names fields is a framework type per aggregate. Worse, writing properties directly would route around
the aggregate's guarded methods, which is where the invariants and the domain events live (ADR-083).

**The four-parameter controller base is a shipped public surface.** Adding an update-request type
parameter to `AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`
changes its generic arity, and every concrete controller in every consuming application stops
compiling on the next version bump: a source-breaking change to buy one action.

## Decision
Ship the generic write side as four additive pieces plus a registration helper.

1. **The aggregate keeps the mutation, behind one interface.**
   `IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType>`
   (`Source/Core/MMCA.Common.Application/Interfaces/IEntityDTOMapper.cs:79`) has a single member,
   `ApplyAsync(entity, request, cancellationToken)` returning `Task<Result>` (`:91`). The module
   implements it by calling the aggregate's own guarded methods. It answers with a bare `Result`
   rather than a new entity because the instance handed in is the tracked one: a successful apply has
   already mutated it in place, and a refusal must leave it untouched so nothing reaches the database
   (`:70-74`). It is the write-side sibling of the `IEntityDTOMapper` and `IEntityRequestMapper` a
   module already writes, and it is picked up by the same `ScanModuleApplicationServices` scan.

2. **One generic update command.**
   `UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>`
   (`Source/Core/MMCA.Common.Application/UseCases/UpdateEntityCommand.cs:32`) carries the id, the
   request and the caller's last-observed `RowVersion` (`:33-35`). `TEntity` is a type parameter the
   command never otherwise uses: it distinguishes update handlers for two aggregates that share an
   identifier type, and it supplies the default cache prefix.
   - It implements `ICommandWithRequest<TUpdateRequest>` (`:36`), so the framework's validator bridge
     registers a `CommandRequestValidator<TCommand, TRequest>`
     (`Source/Core/MMCA.Common.Application/Validation/CommandRequestValidator.cs:19`) for it
     automatically (`Source/Core/MMCA.Common.Application/DependencyInjection.cs:247-259`). A module
     writes `IValidator<TUpdateRequest>` and nothing else; the command is validated before the
     transaction opens, by the same Validating decorator every hand-written command goes through
     (ADR-014).
   - It implements `ICacheInvalidating` (`:36`) with a `CachePrefix` defaulting to
     `typeof(TEntity).FullName + ":"` (`:45`), the aggregate-prefix convention consumers already key
     cached reads under, because the generic controller constructs the command itself and cannot
     supply one. Setting it to an empty string opts out.

3. **One generic update handler, on the existing base.**
   `UpdateEntityHandler<TEntity, TEntityDTO, TIdentifierType, TUpdateRequest>`
   (`Source/Core/MMCA.Common.Application/UseCases/UpdateEntityHandler.cs:37`) derives from the
   DTO-returning `MutateEntityHandlerBase` (`MutateEntityHandlerBase.cs:192`) and overrides three
   members: the id (`UpdateEntityHandler.cs:57`), the row version (`:65`), and `MutateAsync`, which
   is a single delegation to the applier (`:73-81`). It is left unsealed so a module can subclass it
   to declare the `Includes` a particular aggregate's mutation needs, or to add a `[LoggerMessage]`
   partial, without giving up the shared workflow (`:15-21`). `HandlerName` reports the open handler
   name so a `NotFound` failure reads the same as the hand-written handler it replaces (`:54`).
   **It raises no events of its own** (`:22-26`): domain events belong to the aggregate's mutation
   methods, which the applier calls, and a handler that published anything would fire on the generic
   path and stay silent on a hand-written one (ADR-083).

4. **The create handler gets a concrete, hook-free form.**
   `CreateEntityHandler<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>`
   (`Source/Core/MMCA.Common.Application/UseCases/CreateEntityHandler.cs:28`) is
   `CreateEntityHandlerBase` with none of its hooks overridden, and it is `sealed` because the base,
   not this type, is the extension point (`:14-19`).

5. **One registration call per aggregate.**
   `AddEntityCrud<TEntity, TEntityDTO, TIdentifierType, TCreateRequest, TUpdateRequest>()`
   (`Source/Core/MMCA.Common.Application/DependencyInjection.cs:313`) registers the create, update
   and delete handlers closed over that aggregate's types (`:321-331`). Two properties are
   deliberate (`:293-301`):
   - **Closed, not open-generic**, because Scrutor's `TryDecorate` wraps concrete service types: an
     open `ICommandHandler<,>` registration would resolve completely undecorated and
     `VerifyDecoratorPipeline()` could not see it.
   - **`TryAdd`, not `Add`**, so an aggregate that outgrows one verb (a create needing a retry loop,
     a delete that must load its children first) registers its own handler for that verb before this
     call and keeps the generic pair for the other two.

   It calls `ThrowIfPipelineSealed` (`:319`), so registering after `AddApplicationDecorators()` fails
   loudly rather than leaving three handlers unwrapped (ADR-014).

6. **PUT ships on a new derived controller base, not on the shipped one.**
   `CrudEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest, TUpdateRequest>`
   (`Source/Presentation/MMCA.Common.API/Controllers/CrudEntityControllerBase.cs:54`) inherits
   `AggregateRootEntityControllerBase` and adds `[HttpPut("{id}")]` (`:88`). A controller offering
   only create and delete keeps inheriting the four-parameter base; one that also offers update
   inherits this and gains the action (`:23-28`). The action is `[Idempotent]` (`:89`, ADR-017) and
   `[SupportsIfMatch]` (`:90`, ADR-035), so both routes a concurrency token can travel are honoured:
   a body implementing `IConcurrencyAware` carries `RowVersion` straight into the command (`:102`),
   and the header fills it when the body left it empty, answering a failed precondition with 412
   rather than 409. On success the refreshed token is emitted as a weak `ETag` through the inherited
   `SetConcurrencyETag` (`:111`), so a client can condition its next write without re-reading.

## Rationale
- **The one thing that varies per aggregate is the one thing the module writes.** Load, concurrency
  stamping, `NotFound`, save, DTO projection, cache invalidation and validation are identical for
  every aggregate and now exist once; the field assignments are not, and they stay in the aggregate
  behind `IEntityUpdateApplier`. That is the same split ADR-034 made on the read side, where the
  module supplies `IEntityDTOMapper` and inherits everything else.
- **Invariants and events keep exactly one home.** The applier calls the aggregate's guarded methods,
  so a generic PUT raises the same `{Entity}Changed` event with the same state discriminator a
  hand-written handler would (ADR-083), and a refused invariant stops the write before the save
  (`MutateEntityHandlerBase.cs:148-151`).
- **A new base beats a wider one.** Adding a fifth type parameter to the shipped base would break
  every consumer's controllers at compile time in exchange for one action. Inheritance costs one word
  in a class declaration for the controllers that want the verb and nothing at all for those that do
  not.
- **The command is a command, not a shortcut.** Because it implements the two existing markers, it
  inherits the whole ADR-014 pipeline (feature gate, authorization, logging, caching, validation,
  timeout, transaction) rather than a parallel path with its own semantics. Nothing about a generic
  update is exempt from what a hand-written command gets.
- **`TryAdd` makes the helper partial-adoptable.** Reaching for one bespoke handler does not mean
  abandoning the other two, which is the failure mode of an all-or-nothing scaffold.

## Trade-offs
- **The update request is the write contract, so it tracks the aggregate.** Exactly the coupling
  ADR-034 records for the read side, on the other axis: what a caller may change is what the request
  exposes, and the applier is the only place that decides how far a request reaches into the
  aggregate.
- **The default cache prefix is a convention, not a check.** `typeof(TEntity).FullName + ":"` is
  correct only for a module keying its cached reads under the aggregate prefix. A module that keys
  reads differently and does not set `CachePrefix` invalidates nothing, and nothing fails: the same
  silent-staleness property the caching decorator has always had (ADR-026).
- **`AddEntityCrud` registers three handlers whether or not all three verbs are exposed.** An
  aggregate with no delete endpoint still gets a delete handler in the container. It is inert, and
  the alternative is three parameters that would be wrong more often than the extra registration is.
- **Two controller bases now exist for one resource shape.** A reader has to know which base carries
  which verbs, and the four-parameter one cannot be retired without the arity break this decision
  exists to avoid.
- **The applier can be written badly.** Nothing stops an implementation from assigning properties
  directly instead of calling the aggregate's guarded methods, which would skip the invariants and
  raise no events. No fitness rule checks it today; the interface makes the right thing easy, not the
  wrong thing impossible.
- **Nothing in the framework opts an existing consumer in.** ADC and Store keep their hand-written
  create, update and delete handlers; the generic write side is what a new aggregate can start from,
  not a migration anyone is asked to run.

## Related
[ADR-034](034-generic-entity-query-layer.md) (the read side plus create and delete this record
completes; its `AggregateRootEntityControllerBase` is what `CrudEntityControllerBase` derives from),
[ADR-083](083-crud-lifecycle-event-taxonomy.md) (the events the aggregate raises, which is why the
generic handler raises none),
[ADR-035](035-optimistic-concurrency.md) (the `RowVersion` round trip and the `If-Match` to 412
rewrite the PUT honours),
[ADR-017](017-request-idempotency.md) (the `[Idempotent]` filter on the PUT, matching the generic
create),
[ADR-014](014-cqrs-decorator-pipeline.md) (the decorator chain the command runs through, and the
sealed-pipeline guard `AddEntityCrud` respects),
[ADR-013](013-result-pattern.md) (the `Result` the applier answers with and the failure mapping at
the edge),
[ADR-026](026-caching-strategy.md) (the prefix-keyed invalidation the command's `CachePrefix` drives),
[ADR-001](001-manual-dto-mapping.md) (the `IEntityDTOMapper` the handler projects through).
