# ADR-099: Generic Write-Side Entity Commands (Create, Update, Delete Without a Handler per Aggregate)

## Status
Accepted (2026-08-29, framework v1.170.0). Extends
[ADR-034](034-generic-entity-query-layer.md), which gave every entity a generic read surface plus
create and delete, by completing the write half: a generic update command, its handler, a one-call DI
registration for all three verbs, and a controller base carrying the PUT. Additive throughout; no
existing controller, handler or registration changes. Revised 2026-08-30 (framework v1.172.0): five
surface extensions complete the record by closing the shapes that still forced a hand-written handler
(a mutation context carrying side data plus an idempotent-no-op short circuit, a payload-returning
mutate base, attempt-scope parity on the mutate path, an extensible `DeleteEntityHandler`, and a
verb-discriminated command with a command-aware applier). Still additive: every existing subclass,
command and applier compiles and behaves exactly as before. See the Revision at the end. Revised
2026-08-31: both consumer applications run on the extended surface from their own `main`, so the
closing note records adoption in production rather than a branch.

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
(`Source/Core/MMCA.Common.Application/UseCases/MutateEntityHandlerBase.cs:51`, whose
`MutateCoreAsync` at `:270` loads the aggregate, stamps the caller's concurrency token at `:290`, runs
the mutation and saves at `:302`), so what was missing was not the workflow but a command and a
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
   (`Source/Core/MMCA.Common.Application/UseCases/UpdateEntityCommand.cs:46`) carries the id, the
   request and the caller's last-observed `RowVersion` (`:47-49`). That token is a non-nullable
   `byte[]` taken from the request's `If-Match` header rather than from the body (`:42-45`, ADR-035):
   an update request carries no token of its own, and a conditional write that states no precondition
   never reaches the handler. `TEntity` is a type parameter the command never otherwise uses: it
   distinguishes update handlers for two aggregates that share an identifier type, and it supplies
   the default cache prefix.
   - It implements `ICommandWithRequest<TUpdateRequest>` (`:50`), so the framework's validator bridge
     registers a `CommandRequestValidator<TCommand, TRequest>`
     (`Source/Core/MMCA.Common.Application/Validation/CommandRequestValidator.cs:19`) for it
     automatically (`Source/Core/MMCA.Common.Application/DependencyInjection.cs:252-268`). A module
     writes `IValidator<TUpdateRequest>` and nothing else; the command is validated before the
     transaction opens, by the same Validating decorator every hand-written command goes through
     (ADR-014).
   - It implements `ICacheInvalidating` (`:50`) with a `CachePrefix` defaulting to
     `typeof(TEntity).FullName + ":"` (`:63`), the aggregate-prefix convention consumers already key
     cached reads under, because the generic controller constructs the command itself and cannot
     supply one. Setting it to an empty string opts out.

3. **One generic update handler, on the existing base.**
   `UpdateEntityHandler<TEntity, TEntityDTO, TIdentifierType, TUpdateRequest>`
   (`Source/Core/MMCA.Common.Application/UseCases/UpdateEntityHandler.cs:48`) derives from the
   DTO-returning `MutateEntityHandlerBase` (`MutateEntityHandlerBase.cs:342`) and overrides three
   members: the id (`UpdateEntityHandler.cs:68`), the row version (`:76`), and `MutateAsync`, which
   is a single delegation to the applier (`:84-92`). It is left unsealed so a module can subclass it
   to declare the `Includes` a particular aggregate's mutation needs, or to add a `[LoggerMessage]`
   partial, without giving up the shared workflow (`:15-21`). `HandlerName` reports the open handler
   name so a `NotFound` failure reads the same as the hand-written handler it replaces (`:65`).
   **It raises no events of its own** (`:33-37`): domain events belong to the aggregate's mutation
   methods, which the applier calls, and a handler that published anything would fire on the generic
   path and stay silent on a hand-written one (ADR-083).

4. **The create handler gets a concrete, hook-free form.**
   `CreateEntityHandler<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>`
   (`Source/Core/MMCA.Common.Application/UseCases/CreateEntityHandler.cs:28`) is
   `CreateEntityHandlerBase` with none of its hooks overridden, and it is `sealed` because the base,
   not this type, is the extension point (`:14-19`).

5. **One registration call per aggregate.**
   `AddEntityCrud<TEntity, TEntityDTO, TIdentifierType, TCreateRequest, TUpdateRequest>()`
   (`Source/Core/MMCA.Common.Application/DependencyInjection.cs:318`) registers the create, update
   and delete handlers closed over that aggregate's types (`:326-336`). Two properties are
   deliberate (`:298-306`):
   - **Closed, not open-generic**, because Scrutor's `TryDecorate` wraps concrete service types: an
     open `ICommandHandler<,>` registration would resolve completely undecorated and
     `VerifyDecoratorPipeline()` could not see it.
   - **`TryAdd`, not `Add`**, so an aggregate that outgrows one verb (a create needing a retry loop,
     a delete that must load its children first) registers its own handler for that verb before this
     call and keeps the generic pair for the other two.

   It calls `ThrowIfPipelineSealed` (`:324`), so registering after `AddApplicationDecorators()` fails
   loudly rather than leaving three handlers unwrapped (ADR-014).

6. **PUT ships on a new derived controller base, not on the shipped one.**
   `CrudEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest, TUpdateRequest>`
   (`Source/Presentation/MMCA.Common.API/Controllers/CrudEntityControllerBase.cs:53`) inherits
   `AggregateRootEntityControllerBase` and adds `[HttpPut("{id}")]` (`:87`). A controller offering
   only create and delete keeps inheriting the four-parameter base; one that also offers update
   inherits this and gains the action (`:23-28`). The action is `[Idempotent]` (`:88`, ADR-017) and
   `[SupportsIfMatch]` (`:89`, ADR-035), so the PUT is conditional: the filter decodes the caller's
   `If-Match` header, refuses a request that states no precondition with 428, and the action reads
   the decoded token with `SupportsIfMatchAttribute.RequiredToken(HttpContext)` and hands it to the
   command (`:102`). A failed precondition is answered with 412 rather than 409. The request body
   carries no token. On success the refreshed token is emitted as a weak `ETag` through the inherited
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
  (`MutateEntityHandlerBase.cs:293-295`).
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
- **Nothing in the framework opts a consumer in: every registration is a line the module writes.**
  Adoption is per aggregate and partial. ADC's Conference module registers it for `Category`,
  `Activity` and `Sponsor`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/DependencyInjection.cs:139-141`),
  Store's Catalog for `Product` (one call per field-scoped update request) and `Category`
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/DependencyInjection.cs:68-72`,
  `:79`),
  and Store's Identity for `Customer`
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/DependencyInjection.cs:65-67`),
  each call placed after the convention scan so `TryAdd` leaves the hand-written handlers those
  modules keep (the create verbs, and Catalog's `DeleteCategoryHandler`) exactly where they were. An
  aggregate whose lifecycle is guarded rather than plain CRUD keeps its own handlers, and no
  migration is asked of anyone.

## Related
[ADR-034](034-generic-entity-query-layer.md) (the read side plus create and delete this record
completes; its `AggregateRootEntityControllerBase` is what `CrudEntityControllerBase` derives from),
[ADR-083](083-crud-lifecycle-event-taxonomy.md) (the events the aggregate raises, which is why the
generic handler raises none),
[ADR-035](035-optimistic-concurrency.md) (the `RowVersion` token, the required `If-Match`
precondition and the 412 the PUT honours),
[ADR-017](017-request-idempotency.md) (the `[Idempotent]` filter on the PUT, matching the generic
create),
[ADR-014](014-cqrs-decorator-pipeline.md) (the decorator chain the command runs through, and the
sealed-pipeline guard `AddEntityCrud` respects),
[ADR-013](013-result-pattern.md) (the `Result` the applier answers with and the failure mapping at
the edge),
[ADR-026](026-caching-strategy.md) (the prefix-keyed invalidation the command's `CachePrefix` drives),
[ADR-001](001-manual-dto-mapping.md) (the `IEntityDTOMapper` the handler projects through).

## Revision (2026-08-30): the five surfaces that complete the write side

The decision above shipped the generic update and left the bases where it found them. Reading real
write handlers against those bases surfaced five shapes that still forced a hand-written copy of the
load-mutate-save workflow, and in every case the reason was a missing extension point rather than a
case the generic path was wrong for: a value derived before the mutation, an idempotent no-op, a
fresh-scope retry, a delete that has to load its children or refuse, and a command that carries more
than its request. All five are additive.

**1. A mutation context on every write handler.** `MutationContext`
(`Source/Core/MMCA.Common.Application/UseCases/MutationContext.cs:31`) is a per-command side channel:
a typed bag (`Set` at `:56`, `TryGet` at `:69`, `GetOrDefault` at `:93`, `Contains` at `:99`) plus
`SkipSave()` (`:49`) and the `SaveSkipped` flag it sets (`:39`).
`MutateEntityHandlerCore` creates one per run (`MutateEntityHandlerBase.cs:96`) and threads it through
`LoadAsync` (`:170`), `MutateAsync` (`:134`), `LogMutated` (`:198`) and `OnMutatedAsync` (`:225`), each
of them a new overload that forwards to the context-free one by default, so a handler that needs
neither keeps overriding what it always overrode and never sees the context. It exists because the
workflow answers with the mutated aggregate, so a value the mutation computed on the way (the
pre-mutation state, the blob the write is about to orphan) had nowhere to go except handler instance
state, which a scoped handler must not carry between calls (`MutationContext.cs:12-17`).
`SkipSave()` is read in the workflow itself (`MutateEntityHandlerBase.cs:299-300`): the command
returns the loaded aggregate as a success, with no save, no `LogMutated` and no `OnMutatedAsync`,
because an already-satisfied request (remove an avatar that is not there) is a success and must not
log a mutation that did not happen. The one behavioral note for anyone writing a new handler is that
`MutateAsync(entity, command, token)` is now `virtual` rather than `abstract`: a handler overrides
exactly one of the two overloads, and overriding neither throws at the call site naming the type
(`:117-119`).

**2. A payload-returning mutate base.**
`MutateEntityPayloadHandlerBase<TCommand, TEntity, TIdentifierType, TResultPayload>` (`:387`) is the
third mutate flavor beside the bare-`Result` one (`:319`) and the refreshed-DTO one (`:342`), for a
command whose response is a purpose-built envelope rather than the aggregate's DTO. `TResultPayload`
is unconstrained, and the subclass builds the answer in `BuildResult(entity, command, context)`
(`:418`), called only on success (`:403-405`), reading both the mutated aggregate and whatever the
mutation wrote into the context. That pair is the point: a pre-mutation value reaches the response
without handler instance state. It is a sibling type rather than a fourth type parameter on the DTO
flavor because generic types overload by arity alone and a four-parameter `MutateEntityHandlerBase`
already exists (`:378-381`).

**3. Attempt-scope parity on the mutate path.** `MutateCoreAsync(attemptUnitOfWork, command, token)`
(`:253`) and its context-taking overload (`:269`) take the unit of work as a parameter, exactly as the
create workflow's `CreateCoreAsync` already did
(`Source/Core/MMCA.Common.Application/UseCases/CreateEntityHandlerBase.cs:76`). A handler whose write
can lose a unique-key race overrides `HandleAsync`, wraps the workflow in a retry loop and runs each
attempt against a fresh DI scope's unit of work, instead of reimplementing load-stamp-mutate-save
around the base. The parameter is load-bearing rather than cosmetic: the ambient context still tracks
the failed attempt, so a retry on the injected unit of work would never persist (`:245-249`).

**4. `DeleteEntityHandler` is opened.** `HandleAsync` is `virtual`
(`Source/Core/MMCA.Common.Application/UseCases/DeleteEntityHandler.cs:66`) and the workflow is split
into `Includes` (`:57`), `AsTracking` (`:63`), `LoadAsync` (`:100`), the `Result`-returning pre-delete
hook `OnDeletingAsync` (`:125`), `LogDeleted` (`:137`), `HandlerName` (`:49`) and a protected
`UnitOfWork` (`:42`). The two things a real delete outgrows are both structural: the child collections
the aggregate's own `Delete()` cascade has to see, because an unloaded collection leaves its rows live
under a soft-deleted parent (`:54-56`), and an invariant that spans more than the aggregate, which
`OnDeletingAsync` refuses before `Delete()` is called and before anything is saved (`:75-77`). With no
`Includes` the load is the same bare by-id query the handler always issued (`:110-112`), so an
existing consumer sees no change. Events stay the aggregate's, as before (`:23-25`).

**5. A verb-discriminated command and a command-aware applier.** Two related shapes, both about a
command that the three-parameter form cannot express.

- *Two verbs over one request DTO.* The generic path keys the handler and its applier on (entity,
  request, identifier), so an aggregate with two mutations that take the same request shape (an
  inventory item increased or decreased by one `Quantity` payload) cannot close the command twice.
  `UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType, TApplier>`
  (`Source/Core/MMCA.Common.Application/UseCases/UpdateEntityCommand.cs:102`) derives from the
  three-parameter command (`:106`) and adds the applier type as a phantom discriminator (`:116`,
  rationale at `:73-80`). `UpdateEntityHandler<TEntity, TEntityDTO, TIdentifierType, TUpdateRequest,
  TApplier>` (`UpdateEntityHandler.cs:115`) injects that applier by its concrete type (`:117`), which
  the module scan registers alongside its interfaces, and reports a `HandlerName` naming the verb so
  two verbs produce distinguishable `NotFound` failures (`:133`). Registration is one
  `AddEntityUpdateVerb<...>()` per verb (`DependencyInjection.cs:376`), `TryAdd` like `AddEntityCrud`
  (`:384-388`) and bridging the verb's command to `IValidator<TUpdateRequest>` (`:390-392`). The
  wire shape does not move: same route, same request DTO.
- *A command carrying state beside the request.* `UpdateEntityCommand<TEntity, TUpdateRequest,
  TIdentifierType>` is no longer sealed (`UpdateEntityCommand.cs:46`, rationale at `:26-35`), so a
  module derives a positional record that adds a route-derived child id, a server-decided flag or a
  second concurrency token while inheriting `Id`, `Request`, `RowVersion`, the `ICommandWithRequest`
  validator bridge and the `CachePrefix` default (`:63`). Those belong on the command rather than
  smuggled into the request DTO, where a caller could set them, so the applier has to see the command:
  `IEntityUpdateCommandApplier<TEntity, TUpdateRequest, TIdentifierType, TCommand>`
  (`IEntityUpdateCommandApplier.cs:38`) takes the whole command and the mutation context (`:56-60`)
  and still answers with a bare `Result` for the same reason the request-only applier does (`:29-32`).
  `UpdateEntityCommandHandler<TCommand, ...>` (`UpdateEntityHandler.cs:185`) runs it on the shared
  workflow, delegating through the context-aware `MutateAsync` (`:218-223`), and
  `AddEntityUpdate<TCommand, ...>()` registers the pair (`DependencyInjection.cs:427`).
- Both helpers call `ThrowIfPipelineSealed` (`:382`, `:433`) like `AddEntityCrud`, and both call the
  new `AddCommandRequestValidator<TCommand, TRequest>()` (`:460`): the explicit form of the bridge the
  module scan applies by reflection, for a command the scan cannot see because it is a closed generic
  constructed at registration time. It is `TryAdd` (`:463`), so an explicit `IValidator<TCommand>`
  still wins, and registering it with no `IValidator<TRequest>` present is harmless.
- Post-load, pre-mutate work needs no new hook. A subclass that has to stamp `SetOriginalRowVersion`
  on a tracked child row (ADR-035's second token, which the base's root-stamping `RowVersion` hook
  cannot reach) overrides `MutateAsync`, does its work against
  `UnitOfWork.GetRepository<TEntity, TIdentifierType>()` and awaits `base.MutateAsync(...)`, which is
  now documented on the handler itself (`UpdateEntityHandler.cs:22-32`).

The behavior is pinned in
`Tests/Core/MMCA.Common.Application.Tests/UseCases/WriteSideExtensionsTests.cs`, whose classes map one
to one onto the five: `MutationContextTests` (`:14`), `MutationContextHandlerTests` (`:73`),
`MutateAttemptScopeTests` (`:183`), `DeleteEntityHandlerExtensionTests` (`:237`),
`VerbDiscriminatedUpdateTests` (`:331`), `DerivedUpdateCommandTests` (`:412`) and
`WriteSideRegistrationTests` (`:493`).

### Where the generic path stops

The extensions widen the shape the framework serves; they do not make the generic path the answer for
every write. It covers a write whose shape is: load one aggregate, run its guarded methods, save.
Four kinds of handler stay hand-written by design, and the boundary is where a write stops being that
shape rather than where a handler happens to be long.

- **Domain-verb state machines.** An order that pays, cancels and delivers
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/Pay/PayOrderHandler.cs:13`)
  is a transition set, not a field assignment: what a verb is allowed to do depends on the state the
  aggregate is in, and expressing that as a request DTO the caller fills in would put the state
  machine on the wire.
- **Sagas and payment flows.** A handler that talks to a payment provider between the load and the
  save
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/ProcessPaymentWebhook/ProcessPaymentWebhookHandler.cs:21`)
  runs work that is not a mutation, with its own compensation and its own idempotency, inside a
  workflow whose entire contract is load-mutate-save.
- **The auth verticals.** Password change, reset, external login and session revocation
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordHandler.cs:17`)
  mint tokens, hash credentials and send mail. Their side effects, not their aggregate writes, are the
  reason they exist.
- **Multi-aggregate orchestration.** The generic workflow loads exactly one aggregate by id. A write
  that has to touch two roots is outside it by construction, and pretending otherwise would hide a
  transaction boundary inside a base class.

Nothing in the framework opts a consumer in, which is unchanged from the original decision: adoption
stays per aggregate, per verb, and partial, and `TryAdd` keeps a hand-written handler in place. Both
consumer applications run on these surfaces. MMCA.ADC serves its speaker update through a
command-aware applier
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Update/SpeakerUpdateApplier.cs:13-14`)
registered with `AddEntityUpdate`
(`.../MMCA.ADC.Conference.Application/DependencyInjection.cs:163`); its session, event and room
writes sit on the payload base
(`.../Sessions/UseCases/Update/UpdateSessionHandler.cs:23`,
`.../Events/UseCases/Update/UpdateEventHandler.cs:22`,
`.../Events/UseCases/AddRoom/AddRoomHandler.cs:28`), as does the avatar write
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarHandler.cs:27`),
and the avatar removal takes the mutation context on the bare-`Result` base
(`.../Users/UseCases/RemoveUserAvatar/RemoveUserAvatarHandler.cs:19`, `:31`). MMCA.Store registers
the verb discriminator for the two inventory verbs that share one request DTO
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/DependencyInjection.cs:78-79`). Those
writes run the generic path in production; the four kinds listed above are what stays outside it.

### What these cost

- **The context is a string-keyed, untyped bag.** A key typo reads as absent and a type mismatch reads
  as absent (`MutationContext.cs:73`), so a writer and a reader that disagree fail quietly rather than
  at compile time. It is also deliberately not thread-safe (`:26-29`).
- **`MutateAsync` moved from `abstract` to `virtual`**, which trades a compile error for a runtime
  throw when a new handler overrides neither overload (`MutateEntityHandlerBase.cs:117-119`).
- **`SkipSave` returns success on a command that wrote nothing.** A caller reading a 2xx as proof a
  write happened is now wrong, and the response is deliberately indistinguishable from one that did
  write.
- **Three mutate bases now exist** where there were two, and choosing between them is a reader's
  problem before it is a writer's.
- **The verb discriminator is a phantom type parameter.** It buys two commands over one request DTO at
  the price of a type name that carries an applier name into log lines and failure sources
  (`UpdateEntityHandler.cs:133`).
- **A `virtual HandleAsync` on `DeleteEntityHandler` allows a subclass to replace the workflow
  entirely**, not just extend it, and `Includes` is a string collection resolved at query time, so a
  renamed navigation property fails on a request rather than in a build.
