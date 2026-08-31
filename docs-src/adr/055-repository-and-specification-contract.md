# ADR-055: Repository plus Specification as the Data-Access Contract

## Status
Accepted (2026-07-25). Revised 2026-08-01 (qualified the "referenced nowhere" claim about
`IEntityReader` / `IEntityQuerier`: an ADC doc comment now names `IEntityQuerier`, though no code
depends on either as a type; refreshed the ADC `SessionsController` and MMCA.Common
`DependencyInjection` anchors, and the leak rationale, which now reads non-accepted sessions to
non-privileged callers rather than declined sessions). Revised 2026-08-07 (withdrew that
qualification: the ADC file it pointed at no longer exists, so neither interface has any reference
outside its own declaration file; replaced the ADC concrete-specification example, which named a
class that does not exist, with the specifications ADC actually ships; refreshed the
`EFReadRepository`, `SessionsController`, and `IEntityQueryService` anchors). Revised 2026-08-14
(re-anchored every `IRepository.cs`, `EFReadRepository.cs`, `DependencyInjection.cs`, and
`stage.ps1` citation after a named-query-filter remarks block shifted `IRepository.cs` down; narrowed
"every read" on `IEntityQueryService` to the four reads that actually take a specification, and
narrowed the "no reference" claim about `IEntityReader` / `IEntityQuerier` to C# code, since the
Helpdesk staging-script comments named in the same paragraph are references of a kind).
Revised 2026-08-18 (**substantive**: `QuerySpecification` gives a specification ordering, includes,
paging and tracking; composition drops `Expression.Invoke` for parameter substitution, retiring the
provider-bet trade-off; `IEntityQuerier` gains specification-first reads and keyset pagination; an
optional projector pushes DTO projection into SQL; and paginated reads become deterministically
ordered. Two Trade-offs entries below are superseded. See the Revision (2026-08-18) at the end;
the Decision section's composition bullet and its `IRepository.cs` / `EFReadRepository.cs` anchors
were re-stated against that same revision). Revised 2026-08-19 (marked the two superseded
Trade-offs entries in place, matching how ADR-014 marks its superseded order block, and refreshed
the second `stage.ps1` anchor, which moved to `:983`). Revised 2026-08-21 (**substantive in
consequence, not in decision**: the narrow interfaces and the composition surface gained their first
real consumers. MMCA.ADC shipped fluent `.And()` composition, specification-first `ListAsync` reads,
and twelve `IEntityReader` / `IEntityQuerier` declarations to production; MMCA.Store has the same
narrowing staged on an open pull request. The Decision's consumption paragraph is restated, the "ISP
split is guidance" Trade-offs entry is marked superseded in place, and two sentences of the
Revision (2026-08-18) carry pointer notes. See the Revision (2026-08-21) at the end).
Revised 2026-08-23 (**substantive in consequence, not in decision**: the MMCA.Store counterpart the
Revision (2026-08-21) recorded as staged on an open pull request merged to `main` on 2026-08-22, so
the narrow read interfaces now have shipped dependents in both consumer applications. The Decision's
consumption paragraph, the superseded "ISP split is guidance" Trade-offs note, and the Store
paragraph plus the adoption-sample caution in the Revision (2026-08-21) are restated to that
reality, with the Store holders anchored by file and line for the first time).
Revised 2026-08-31 (**substantive in consequence, not in decision**: `IEntityQuerier` carries five
further members this record described nowhere, two `FirstOrDefaultAsync` overloads, the grouped
`CountByAsync` and `SumByAsync`, and `FindIncludingDeletedAsync`, so the interface is wider again;
MMCA.Helpdesk now has a narrowed `IEntityReader` holder of its own, which retires the "Helpdesk
consumes none of this" caution and makes three of the four repositories narrowed dependents; ADC's
narrowing grew to fifteen declarations across eleven files; MMCA.Store's `AssignParentCategoryHandler`
is now `CategoryAssignParentUpdateHandler`. Every `IRepository.cs`, `EFReadRepository.cs`,
`EFReadRepositoryDecorator.cs`, `EntityQueryService.cs`, `DependencyInjection.cs` and consumer anchor
is re-verified, and the superseded `Expression.Invoke` entry drops its line number, which now points
at unrelated text. See the Revision (2026-08-31) at the end).

## Context
Every read an application handler performs has to come from somewhere, and the shape of that contract
decides whether the module can still be lifted into its own service later (ADR-007, ADR-008). The
framework already keeps persistence out of Application by reference: the interfaces live in
`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs` and the EF
implementation in
`Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:19-21`, so no
Application project references EF Core. That is not enough on its own. A repository that hands back
an `IQueryable` re-couples the caller through the back door: the query is composed inside the
handler, translated by whatever provider sits behind the `DbSet`, and there is no way to answer that
same call over a gRPC boundary. The generic query pipeline needs a queryable; a use-case handler does
not.

The other half of the problem is the predicate. Row-scoping (a customer sees only their own orders),
business filters (published events only), and authorization scopes are all "a boolean over an entity"
that must be reusable, unit-testable without a database, composable with other filters, and
translatable to SQL. Written inline as lambdas inside handlers they are none of those things.

Several accepted records already lean on this contract without ever deciding it: ADR-018 depends on
criteria that stay engine-portable, ADR-033 row-scopes collection queries with an ownership
specification, ADR-035 hangs its concurrency-token hook on the write half of the repository, and
ADR-048 supplies the `TIdentifierType` every one of these interfaces is generic over. This record
states the contract itself.

## Decision
Data access is **repository plus specification**: interface-segregated read interfaces for the
operations, expression-tree specifications for the predicates, and a build-failing fitness rule that
keeps the raw `IQueryable` surfaces out of Application code.

- **The read contract is split by responsibility.** `IEntityReader<TEntity, TIdentifierType>`
  (`IRepository.cs:21`) carries single-entity lookups: `GetByIdAsync` (`IRepository.cs:26`, `:31`),
  `GetByIdsAsync` (`:48`), and the two `ExistsAsync` overloads (`:56`, `:62`).
  `IEntityQuerier<TEntity, TIdentifierType>` (`:80`) carries collection work: `GetAllAsync` (`:85`),
  `GetProjectedAsync` (`:105`), `GetAllForLookupAsync` (`:222`), and `CountAsync` (`:229`, `:232`).
  It also carries the reads that keep a single row or an aggregate in the database rather than
  folding it in memory: `FirstOrDefaultAsync` over a predicate (`:133`) or over a specification,
  which honors the specification's ordering so "first" is deterministic (`:148`); the grouped
  `CountByAsync` (`:167`) and `SumByAsync` (`:184`), which are how an Application layer that
  references no EF Core asks for a `GROUP BY` instead of projecting every row out and grouping
  client-side; and `FindIncludingDeletedAsync` (`:215`), which returns the active and the
  soft-deleted matches as two collections from one read.
  `IReadRepository` composes exactly those two (`:330-331`), and `IRepository` composes read plus
  write (`:467`). The interface documentation directs new handlers at the focused sub-interfaces and
  leaves existing code on the composite (`:325-326`).
- **The raw queryables live on the composite only.** `Table`, `TableNoTracking`,
  `TableNoTrackingSingleQuery`, and `TableNoTrackingSplitQuery` are declared on `IReadRepository`
  (`IRepository.cs:336`, `:339`, `:342`, `:345`) and implemented as EF `DbSet` expressions
  (`EFReadRepository.cs:406`, `:409`, `:412`, `:415`). They are deliberately absent from
  `IEntityReader` and `IEntityQuerier`, so a handler that declares the narrow dependency cannot reach
  a queryable at all.
- **Application code must not touch those queryables, and a fitness rule fails the build.**
  `RawQueryableConventionTestsBase.ApplicationLayer_DoesNotUseRawQueryableSurfaces`
  (`Source/Hosting/MMCA.Common.Testing.Architecture/Bases/RawQueryableConventionTestsBase.cs:61`)
  scans the `.cs` files of each mapped module's Application project (`:45-58`, `:71-82`) for
  `.Table` / `.TableNoTracking*` member access (`:103`). The stated reason is the extraction promise:
  a raw-queryable handler is EF-coupled and its query shape cannot move behind a gRPC boundary
  (`:6-12`, `:85`).
- **Predicates are `Specification` expression trees.** `ISpecification<TEntity, TIdentifierType>`
  (`Source/Core/MMCA.Common.Domain/Interfaces/ISpecification.cs:12`) exposes a single `Criteria`
  expression for LINQ-to-DB translation (`:17`) plus `IsSatisfiedBy` for in-memory evaluation
  (`:22`); the abstract base caches the compiled delegate
  (`Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:15`, `:32`). A concrete
  specification is a constructor argument plus one expression, for example
  `OrdersByCustomerSpecification`
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/Specifications/OrdersByCustomerSpecification.cs:13`,
  `:17`). A business filter that takes no argument is smaller still, one overridden `Criteria`, as in
  ADC's `PublishedEventSpecification`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Specifications/PublishedEventSpecification.cs:11`,
  `:14`), the only class in that module's `Events/Specifications` directory. Row-scoping is not
  hand-written per entity at all: the generic `OwnedByUserSpecification<TEntity, TIdentifierType>`
  filters on the `CreatedBy` audit field once in the framework
  (`Source/Core/MMCA.Common.Domain/Specifications/OwnedByUserSpecification.cs:20`, `:29-30`) and is
  closed over the entity type at the call site, which is how ADC scopes an attendee to their own
  answers
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:75`).
- **Specifications compose.** `AndSpecification` (`Specification.cs:81`), `OrSpecification` (`:105`),
  and `NotSpecification` (`:128`) each expose a `Criteria` that delegates to the internal
  `SpecificationComposer` (`:146`). `Combine` (`:155`) rebinds the right operand's parameter onto the
  left's with an `ExpressionVisitor`, `ParameterReplacer.Replace` (`ParameterReplacer.cs:34`), and
  joins the two bodies with `AndAlso` or `OrElse` (`Specification.cs:169-173`); `Negate` (`:181`)
  wraps the inner body in `Expression.Not` and keeps the inner lambda's own parameter (`:189-191`).
  No `Expression.Invoke` is involved, so the composed result is a single expression tree any provider
  can translate, and each combinator caches it in a per-instance lazy field (`:91-93`, `:115-117`,
  `:137-138`). `InlineSpecification` (`:45`) wraps a predicate that was assembled dynamically and has
  no hand-written class. Composition is used in production: ADC's paged session read ANDs the
  public-session specification with the speaker-scoped one rather than substituting, because dropping
  the public filter would leak non-accepted sessions to non-privileged callers
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionsController.cs:110`,
  `:128`, rationale at `:100-104`). Since 2026-08-21 all three composing call sites write the fluent
  form, `publicSpecification.And(...)` (`SessionsController.cs:128`), and the hand-built
  `new AndSpecification<...>(a, b)` construction no longer appears in any consumer.
- **The specification enters the same query pipeline, not a parallel one.** `IEntityQueryService`
  takes an optional `ISpecification<TEntity, TIdentifierType>` on every DTO or entity read: the two
  `GetAllAsync` overloads, `GetEntityByIdAsync`, and `GetByIdAsync`
  (`Source/Core/MMCA.Common.Application/Interfaces/IEntityQueryService.cs:40`, `:63`, `:110`,
  `:131`). The other two reads on the interface take a raw predicate rather than a specification,
  `GetAllForLookupAsync` (`:87-91`) and `ExistsAsync` (`:143-146`).
  `EntityQueryService` passes the specification's `Criteria` into the query parameters
  (`Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:286` on the list path, `:518`
  in `BuildQueryAsync`) alongside the dynamic filters, sorting, and paging. Cross-source predicates are produced the same way:
  `CrossSourceSpecification.BuildAsync`
  (`Source/Core/MMCA.Common.Application/Specifications/CrossSourceSpecification.cs:39`) resolves the
  principal keys with `GetProjectedAsync` (`:55-56`) and returns an `InlineSpecification` of
  `FK IN (keys)` ANDed with the local predicate (`:62-63`, `:74-90`).

Enforcement of the queryable ban is **opt-in per repository, by subclassing the base**, and today
three repositories opt in. MMCA.Common scans its own framework Application project
(`Tests/Architecture/MMCA.Common.Architecture.Tests/RawQueryableConventionTests.cs:18-22`),
MMCA.ADC scans its mapped Identity/Conference/Engagement Application projects plus the thin
Notification module appended by hand
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/RawQueryableConventionTests.cs:21-30`),
and MMCA.Store scans its Catalog/Sales/Identity Application projects
(`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/RawQueryableConventionTests.cs`).
Store adopted on the 2026-07-28 drift wave with an **empty** `AllowedFiles`: its Application layer
had zero raw-queryable uses at adoption, so unlike the other two it starts with no exemptions to
ratchet down. MMCA.Helpdesk has no subclass, so its Application code is not scanned today. The
rule also ships with a documented exemption list, `AllowedFiles`
(`RawQueryableConventionTestsBase.cs:38`), used as an adoption ratchet (`:24-27`): MMCA.Common
exempts six files, the generic query pipeline itself (`EntityQueryService.cs`, which builds its base
query from `Table` / `TableNoTracking` at `EntityQueryService.cs:298` and `:510-512`) plus five Notifications
handlers (`RawQueryableConventionTests.cs:26-36`), and MMCA.ADC exempts eight, the Engagement live
layer and bookmark aggregations, the Identity user-list projection, and the Notification GDPR export
(`MMCA.ADC/.../RawQueryableConventionTests.cs:34-52`).

The interface split is shipped and, since 2026-08-21, consumed. MMCA.ADC declares the narrow
interfaces at fifteen read-only sites across eleven Application files: helper parameters narrowed to
`IEntityReader` where the helper only looks up or checks existence (for example
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/Validation/SessionRoomScheduling.cs:45`)
or to `IEntityQuerier` where it projects or counts (for example
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Users/IntegrationEventHandlers/UserRegisteredHandler.cs:130`),
and locals typed to the querier where a visibility helper reads through the unit of work
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Common/PublicConferenceVisibility.cs:40`,
`:75`, `:126`, `:151`). MMCA.Store ships the same narrowing at three read-only holders: a
by-id/existence service field
(`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Customers/CustomerService.cs:14`),
a handler parameter narrowed to `IEntityReader`
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Categories/UseCases/AssignParentCategory/CategoryAssignParentUpdateHandler.cs:98`),
and a querier parameter on the customer-provisioning handler
(`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/DomainEventHandlers/UserRegisteredHandler.cs:96`);
a fourth, `ProductVariantService`
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Products/ProductVariantService.cs:15`),
deliberately stays on `IReadRepository` because it calls members of both halves. MMCA.Helpdesk
narrows one site, the reference app's by-id query handler, whose local is typed to
`IEntityReader<Ticket, TicketIdentifierType>` and assigned from `GetReadRepository`
(`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Application/Tickets/UseCases/GetById/GetTicketByIdHandler.cs:24`,
with the reason written next to it at `:22-23`), so the seed teaches the narrowing rather than only
describing it in the comments its template staging script carries
(`MMCA.Helpdesk/build/templates/stage.ps1:517`, `:1262`).

What has not changed is the wiring, and that is deliberate. `IUnitOfWork` hands out only the
composites (`IRepository` at
`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IUnitOfWork.cs:19`, `IReadRepository`
at `:29`), and the container registers only the open generic `IRepository<,>`
(`Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:105`). Every narrowed holder is
assigned from `IUnitOfWork.GetReadRepository<,>()` (or `GetRepository<,>()` where the same handler
also writes) and narrows by an implicit reference conversion at the assignment, because
`IReadRepository` derives from both narrow interfaces (`IRepository.cs:330-331`). Nothing
constructor-injects `IEntityReader` or `IEntityQuerier`, and nothing should: the unit of work is
where an entity's physical data source resolves to the right context and where the repository
instance is cached for the scope, so a narrow interface resolved straight from the container would
bypass both. The ISP split is therefore the declared dependency shape at read-only call sites in all
three consumer applications, sitting on an unchanged registration surface
(`IRepository.cs:325-326`).

## Rationale
- **A narrow interface is the enforcement, not a style preference.** A handler that asks for
  `IEntityReader` cannot reach `TableNoTracking`, because the member is not on the interface. The
  fitness rule is the backstop for code that still takes the composite.
- **Method calls are transportable, queryables are not.** `GetByIdAsync`, `GetProjectedAsync`, and
  `CountAsync` each map onto a request/response message; a composed `IQueryable` only means anything
  to the provider that will translate it, which is precisely why the rule exists
  (`RawQueryableConventionTestsBase.cs:6-12`).
- **One expression tree serves both the database and the unit test.** `Criteria` is translated to SQL
  in a query and compiled in memory by `IsSatisfiedBy` (`Specification.cs:9-11`, `:32`), so an
  authorization predicate can be asserted in a domain test with no database at all.
- **Composability keeps filters additive.** ANDing an authorization scope onto a business filter is a
  two-line construction (`SessionsController.cs:128`) instead of a second hand-written query path,
  which is what makes "never substitute the public filter" a cheap rule to follow.
- **A textual scan was chosen deliberately over IL analysis.** NetArchTest and reflection cannot see
  member usage inside method bodies, and the testing package carries no IL or Roslyn dependency on
  purpose, so the rule is an honest line scan with its limits written down
  (`RawQueryableConventionTestsBase.cs:13-23`).
- **The ratchet beats a big-bang cleanup.** Recording existing raw-queryable files in `AllowedFiles`
  makes new code clean immediately while the list shrinks over time (`:24-27`), the same adoption
  posture used elsewhere in the fitness suite (ADR-015).

## Trade-offs
- **The ISP split is guidance, not yet a wired dependency.** *(Superseded by the Revision
  (2026-08-21) below: the split has real dependents shipped in both MMCA.ADC and MMCA.Store, obtained
  from the unchanged `IUnitOfWork` accessors by implicit conversion, so no change to how the
  repository is obtained was needed after all; kept as the record of the trade-off as originally
  accepted.)* Because the only accessors return the
  composites (`IUnitOfWork.cs:19`, `:29`), depending on `IEntityReader` today means changing how the
  repository is obtained. Until that happens, the split buys documentation and future optionality
  rather than a compiler-enforced narrowing.
- **The queryable ban is textual, so it is both over- and under-inclusive.** It skips only whole-line
  `//` comments, so a match inside a string literal or a trailing comment is a false positive, and it
  cannot see through variable indirection or an interface alias that re-exposes a queryable
  (`RawQueryableConventionTestsBase.cs:17-22`).
- **Coverage is partial by construction.** Three of the four repositories run the rule; MMCA.Helpdesk
  currently does not, so its Application layer relies on review alone.
- **The exemptions are real coupling, not paperwork.** The fourteen allowlisted files across
  MMCA.Common and MMCA.ADC are EF-coupled on purpose (aggregations and projections the focused
  surface cannot express); each is intra-module or framework-owned, but every one of them would need
  rework if its module moved behind a transport boundary.
- **`Expression.Invoke` composition is a provider bet.** *(Superseded by the Revision (2026-08-18)
  below: the combinators now rebind parameters via `ParameterReplacer` and `Expression.Invoke` no
  longer appears in `Specification.cs`; kept as the record of the trade-off as originally
  accepted, without a line anchor: the numbers it cited now point at unrelated text.)*
  The And/Or/Not combinators embed each
  operand with `Expression.Invoke` in `Specification.cs`, which the SQL Server provider
  translates; the cross-source helper deliberately avoids it and rebinds parameters instead so the
  combined predicate stays translatable on every provider
  (`CrossSourceSpecification.cs:83-87`). Composed specifications are therefore not automatically
  portable to every engine.
- **A specification carries only a predicate.** *(Superseded by the Revision (2026-08-18) below:
  `QuerySpecification` now also carries ordering, includes, paging and tracking; `ISpecification`
  itself is unchanged.)* `ISpecification` exposes `Criteria` and nothing else
  (`ISpecification.cs:17`), so includes, ordering, paging, and projection stay parameters of the
  repository and query-service methods. This is a smaller specification pattern than the variants
  that also own eager-load and sort state.

## Related
ADR-007 and ADR-008 (the extraction promise the queryable ban exists to protect), ADR-015 (the
fitness-function machinery that runs this rule and its per-repo maps), ADR-014 (the handlers that
consume this contract), ADR-018 (engine portability of a specification's criteria, and the
`SpecificationsDoNotNavigateToOtherEntities` guard on it), ADR-033 (the ownership specification that
row-scopes collection queries through this contract), ADR-034 (the HTTP query contract one layer
above: dynamic filters and paging arrive from the request, the specification is applied beneath
them), ADR-035 (the concurrency-token hooks on the write half of the repository), ADR-006 (the
per-service database each repository instance resolves to), ADR-048 (the identifier aliases that
supply `TIdentifierType`, and [ADR-085](085-identifier-type-aliases-revisited.md), whose migration
blast radius includes every generic surface named here), ADR-001 (the Mapperly mappers the optional
projector reuses as an expression rather than as a method call).

## Revision (2026-08-18)
Five changes, four of them widening the contract and one of them fixing a correctness defect. The
decision this record states is unchanged: data access is still repository plus specification, the raw
queryables still live on the composite only, and the fitness rule still fails the build on `.Table` in
Application code. What the specification can now carry, and what the querier can now be asked, both
grew.

### 1. A specification can carry more than a predicate
`QuerySpecification<TEntity, TIdentifierType>`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/QuerySpecification.cs:38`) extends
`Specification` with the query state the last Trade-offs entry above says a specification deliberately
does not hold: `OrderBy` as an ordered `IReadOnlyList<OrderExpression>` (`:54`), `IncludePaths`
(`:60`), `Skip` / `Take` (`:63`, `:66`), `AsTracking` (`:72`, defaulting false) and
`IgnoreQueryFilters` (`:82`, defaulting false and dropping only the named `SoftDelete` filter, not the
ADR-073 tenant filter). Subclasses populate it through protected builders rather than by assignment:
`AddOrderBy<TKey>(keySelector, descending = false)` (`:90`), `AddInclude(path)` (`:102`, ignoring
blanks and duplicates), `ApplyPaging(skip, take)` (`:117`, both floored at zero), `WithTracking()`
(`:127`) and `WithSoftDeleted()` (`:133`). `OrderExpression` is a top-level
`record (LambdaExpression KeySelector, bool Descending)` (`:150`).

**That entry is therefore superseded, not corrected**: the smaller predicate-only shape remains
available as `Specification`, and a caller who wants the richer one derives from `QuerySpecification`.
`ISpecification` itself is unchanged, which is what keeps the two shapes interchangeable everywhere a
predicate is all that is consumed.

### 2. Composition no longer bets on `Expression.Invoke`
The Trade-offs entry titled "`Expression.Invoke` composition is a provider bet" is **retired**. The
combinators now do what `CrossSourceSpecification` was already doing by hand: an
`ExpressionVisitor` rebinds one operand's parameter onto the other's.
`ParameterReplacer` (`.../Domain/Specifications/ParameterReplacer.cs:24`, static entry `Replace` at
`:34`, with a `ReferenceEquals` short-circuit) is driven by `SpecificationComposer`
(`Specification.cs:146`), whose `Combine` (`:155`) rebinds `right.Parameters[0]` onto
`left.Parameters[0]` and joins the bodies with `AndAlso` or `OrElse`, and whose `Negate` (`:181`)
wraps the inner body in `Expression.Not` keeping its own parameter. `Expression.Invoke` no longer
appears in the file, so a composed specification is now translatable on every provider rather than
only the ones that inline an invocation, and the divergence between the combinators and the
cross-source helper is closed.

The composed criteria is built **once per specification instance**, through a lazy field
(`_criteria ??= ...` in `AndSpecification` at `Specification.cs:88,91`, `OrSpecification` at
`:112,115`, `NotSpecification` at `:134,137`). It is not a shared or global cache: two separately
constructed `AndSpecification`s over the same operands each build their own tree.

Composition also gained a fluent form. `SpecificationExtensions`
(`.../Domain/Specifications/SpecificationExtensions.cs:30`) declares `And` (`:48`), `Or` (`:68`) and
`Not` (`:85`) as **extension members on `ISpecification<TEntity, TIdentifierType>`**, written with a
C# extension block (`extension<TEntity, TIdentifierType>(ISpecification<...> specification)` at
`:32`), not as instance methods on `Specification`. `spec.And(other).Not()` therefore reads as a
chain while the abstract base stays untouched, and the existing explicit
`new AndSpecification<...>(a, b)` construction the Decision above cites keeps working unchanged.
*(As of the Revision (2026-08-21) below, the three consumer call sites all use the fluent form; the
explicit construction remains supported but has no caller.)*

### 3. The querier answers specification-first reads
`IEntityQuerier` (`IRepository.cs:80`) gains four members that take an `ISpecification` rather than a
raw predicate or a bag of query parameters: `CountAsync` (`:243`, ordering and paging deliberately
ignored), `ListAsync` (`:260`), a projecting `ListAsync<TResult>(specification, select, ...)`
(`:279`), and `AnyAsync` (`:291`), implemented on `EFReadRepository` and forwarded by
`EFReadRepositoryDecorator` (`:118`, `:132`, `:138`, `:145`). Alongside them, `IEntityQueryService`
widened from the abstract `Specification<TEntity, TIdentifierType>?` to the interface
`ISpecification<TEntity, TIdentifierType>?` on all four of the members that take one
(`IEntityQueryService.cs:40`, `:63`, `:110`, `:131`), which is what lets a `QuerySpecification`, a
composed one, or an `InlineSpecification` be passed to the same reads.

The narrow-interface observation in the Trade-offs is unchanged in kind and sharper in consequence:
`IUnitOfWork` still hands out only the composites, so these members arrive on an interface nothing
depends on by name. What changed is that `IEntityQuerier` is now the only place several of these
reads exist, so the ISP split has moved from documentation toward being the shape a handler would
actually want. *(That prediction landed: the Revision (2026-08-21) below records the first
dependents by name, and the projecting `ListAsync` is among the members they call.)*

### 4. Projection can be pushed into SQL
An optional `IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityDTOProjector.cs:51`) exposes one
member, `IQueryable<TEntityDTO> ProjectTo(IQueryable<TEntity> source)` (`:62`), and is auto-registered
by the Application assembly scan (`.../Application/DependencyInjection.cs:209`). When one is
registered, the read takes a server-side path, `ExecuteProjectedAsync`
(`.../Application/Services/Query/IEntityQueryPipeline.cs:58`, implemented at
`EntityQueryPipeline.cs:60`), which applies the projection **last**, after criteria, dynamic filters,
sorting and paging (`:101-105`), so the database returns only the DTO's columns instead of whole
entities that are mapped in memory afterwards.

The guard has **three** conditions, not two (`EntityQueryService.cs:489`): a projector must be
registered, the read must not be tracking, and `NavigationMetadata.UnsupportedIncludes` must be empty,
that last set being the navigations requiring manual batch loading because they cross a data source
(`INavigationMetadata.cs:40`). Miss any one and the read falls back to materialize-then-map, which is
exactly today's behavior, so this is a pure opt-in optimization with no change in results. The call
site is `EntityQueryService.cs:303`, reached by both list overloads (`:227` delegates to `:248`). The
reference implementation is `PushNotificationDTOProjector`
(`.../Application/Notifications/PushNotifications/DTOs/PushNotificationDTOProjector.cs:35`, registered
at `.../Notifications/DependencyInjection.cs:51`), which wraps the existing Mapperly mapper's
projection form (`PushNotificationDTOProjection`, `:22`) rather than hand-writing a `Select`, so ADR-001's
generated mapper is reused as an expression tree instead of as a method call.

### 5. Keyset pagination, and deterministic ordering
`GetPageByCursorAsync` is declared on `IEntityQuerier` alone (`IRepository.cs:316`, inherited by
`IReadRepository` at `:330`, implemented at `EFReadRepository.cs:496` and forwarded at
`EFReadRepositoryDecorator.cs:151`):

```csharp
Task<Result<KeysetCollectionResult<TEntity>>> GetPageByCursorAsync(
    KeysetPageRequest request,
    ISpecification<TEntity, TIdentifierType>? specification = null,
    CancellationToken cancellationToken = default);
```

It is deliberately **not** on `IEntityQueryService`, so keyset paging is a repository-level capability
today and the ADR-034 HTTP query contract still offers offset paging only. `KeysetPageRequest` and
`KeysetCollectionResult<T>` live in
`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/KeysetPagination.cs` (`:20`, `:85`); the
request clamps `PageSize` into `[1, 1000]` in both the constructor and the init accessor (`:51`,
`:59-62`, ceiling at `:26`) and carries `SortColumn` / `Descending` / `Cursor` (`:67`, `:71`, `:75`),
and the result extends `CollectionResult<T>` with a single `NextCursor` (`:107`) and deliberately no
total count and no page number, which is the point of keyset paging.

The cursor is opaque but versioned: `KeysetCursor` (`:125`) encodes base64url over
`v1|{hasSortValue}|{sortValue}|{id}` with `Version` at `:127` and each of the two value segments
itself base64url-encoded (`Encode` at `:139-153`), so the explicit null flag is what distinguishes a
missing sort value from an empty one. `TryDecode` (`:169`) rejects bad base64, a wrong version, a
wrong segment count, or a flag that is not `0`/`1`, and **failures are `Result` values, never
exceptions**: an unusable cursor returns `Error.Validation("Error.InvalidCursor", ...)`
(`EFReadRepository.cs:522-527`) and an unknown sort column returns `Error.InvalidEntityField`
(`:505-511`), both `ErrorType.Validation` and both therefore mapping to a 400 through the ADR-013
edge. One escape remains: `KeysetQueryBuilder.Compare` throws `NotSupportedException` for a sort
column whose type has neither a relational operator nor `IComparable<T>`
(`.../Repositories/KeysetQueryBuilder.cs:246`), which is a programming error rather than bad input,
but it is an exception on a `Result`-returning path and is recorded as such.

**Paged reads are now deterministically ordered, which was a defect.** A page without a total ordering
can repeat or skip rows between pages, and nothing previously guaranteed one.
`EntityQueryPipeline` declares `PaginationTieBreakProperty = "Id"` (`:36`) and passes it on all three
execution paths, the projected one included (`:86`, `:180`, `:232`), but **only when the read is
paginated** (`PageNumber.HasValue && PageSize.HasValue`). `QueryFieldService.ApplySorting` (`:155`)
then appends `", Id ascending"` to a caller-supplied sort unless the caller already sorted by `Id`
(`BuildOrdering` at `:209`, `:214-217`), and falls back to `Id ascending` alone when there is no valid
sort column and no default sort (`:180-182`). An **unpaginated** read still gets no ordering at all,
deliberately (`EntityQueryPipeline.cs:29-35`): sorting a full result set the caller did not ask to
sort is a cost with no correctness benefit. The keyset builder enforces the same discipline
independently, ordering by `(sortKey, Id)` with the tie-break always ascending or by `Id` alone when
there is no sort key (`KeysetQueryBuilder.cs:59`, `:70`, `:74`).

### What this revision costs
- **The contract is materially wider.** `IEntityQuerier` gained five members and `ISpecification` has
  a second, richer implementation shape. *(As of the Revision (2026-08-31) below, five further
  members have landed on the same interface, so it carries ten more than the shape the Decision
  originally described.)* Every one of them is public API on a lockstep-released
  package family (ADR-016), so the surface consumers inherit is larger and the ISP split is
  correspondingly less narrow than the Rationale above describes.
- **`QuerySpecification` reintroduces the coupling the predicate-only shape avoided.** Ordering,
  includes and paging inside a specification means a specification now encodes query intent, not just
  a domain predicate, so the same object is less obviously reusable in a domain unit test through
  `IsSatisfiedBy`.
- **`IgnoreQueryFilters` is a sharp edge.** `WithSoftDeleted()` drops the named `SoftDelete` filter
  (`QuerySpecification.cs:82`), which is exactly the invariant ADR-005 relies on. It is scoped to that
  one named filter rather than being EF's blanket `IgnoreQueryFilters`, but it is still a specification
  able to turn off soft-delete for the reads that use it.
- **Projection pushdown succeeds or falls back silently.** Nothing tells a caller which path ran, so a
  projector that stops being registered, or a read that quietly acquires a cross-source include, loses
  the optimization with no signal beyond query latency.
- **Keyset paging stops at the repository.** With no `IEntityQueryService` or controller surface, the
  generic HTTP query contract cannot offer it, so a caller wanting stable deep paging today writes a
  bespoke endpoint, which is the shape ADR-034 exists to avoid.

## Revision (2026-08-21)
Nothing in the contract changed; its consumers did. This revision records the first real adoption of
the two surfaces this record had honestly flagged as unconsumed: the narrow read interfaces and the
composition members.

**MMCA.ADC shipped the adoption to production** (merged and deployed 2026-08-21). Three kinds of
change, none of them behavioral:

- **Fluent composition replaced hand-built combinators.** The workspace's three composing call sites
  now write `a.And(b)`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionsController.cs:128`,
  `.../SpeakersController.cs:173`, and
  `.../MMCA.ADC.Conference.Application/Common/PublicConferenceVisibility.cs:148-149`), so the
  `SpecificationExtensions` members from the Revision (2026-08-18) have production callers and
  `new AndSpecification<...>(a, b)` no longer appears in any consumer.
- **Two reads pass the specification instead of unwrapping it.** `PublicConferenceVisibility`
  previously handed `specification.Criteria` to `GetProjectedAsync`; both sites now call the
  projecting specification-first `ListAsync(specification, select, ...)`
  (`PublicConferenceVisibility.cs:78`, `:154`). For a plain specification the two are equivalent
  reads (untracked, soft-delete-filtered), which is what made the substitution safe.
- **Twelve read-only declarations across eight files narrowed** from `IRepository<,>` to
  `IEntityReader<,>` (by-id and existence helpers) or `IEntityQuerier<,>` (projection and count
  helpers, and the visibility helper's locals), each still assigned from the unit of work. Helpers
  that also write kept the composite, correctly. *(The count has since grown: the Revision
  (2026-08-31) below records fifteen declarations across eleven files.)*

**MMCA.Store ships the counterpart** *(merged to `main` on 2026-08-22, after this revision was
written; restated here as of 2026-08-23, and re-anchored 2026-08-31 after the category handler was
renamed)*: three read-only holders narrowed
(`CustomerService.cs:14`, `CategoryAssignParentUpdateHandler.cs:98`, `UserRegisteredHandler.cs:96`),
and `ProductVariantService` deliberately left on `IReadRepository`
(`ProductVariantService.cs:15`) because it calls `ExistsAsync` (a reader member, `:20`, `:26`) and
`GetProjectedAsync` (a querier member, `:38`, `:57`, `:71`) from the same field. That refusal is the
split working as designed: a holder that genuinely needs both halves says so by keeping the
composite. Both applications also state the convention in their CLAUDE.md files, so new read-only
code is pointed at the narrow interfaces by guidance as well as by example.

### What this revision does not claim
- **The registration surface is untouched, deliberately.** No DI registration was added for the
  narrow interfaces and none should be: a container-resolved `IEntityQuerier` would bypass the unit
  of work's data-source resolution and its per-scope repository cache
  (`Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:23`, `:53-66`). The implicit
  conversion from `GetReadRepository<,>()` is the supported acquisition path.
- **Half the composition surface still has no caller.** `Or` and `Not`, the specification-taking
  `CountAsync` and `AnyAsync`, and `GetPageByCursorAsync` have zero application callers in any of
  the four repositories: the only references are the interface declaration and the profiling
  decorator's forward. The "untested by usage" caution above still applies to the members nothing
  calls. *(Restated 2026-08-31: the adoption sample is no longer two applications. MMCA.Helpdesk
  narrows one holder of its own, so three of the four repositories have a narrowed dependent; the
  members listed here still have none.)*

## Revision (2026-08-31)
Again nothing in the decision changed. Two things did: the querier grew a second time, and the
reference application joined the two production apps as a consumer of the narrow read interfaces.

### The querier carries five more members
`IEntityQuerier` (`IRepository.cs:80`) now also declares, beyond the collection members the Decision
above names and the four specification-first reads from the Revision (2026-08-18):

- `FirstOrDefaultAsync(where, includes, asTracking, ignoreQueryFilters, ...)` (`:133`) and
  `FirstOrDefaultAsync(specification, ...)` (`:148`). The point of both is that the database returns
  one row: without them a caller reaches for `GetAllAsync` plus an in-memory `FirstOrDefault`, which
  materializes the whole matching set to keep one entity. The predicate overload applies no ordering,
  so "first" is whatever the provider returns first; the specification overload honors the
  specification's ordering, which is what makes the choice among several matches deterministic.
- `CountByAsync<TKey>(keySelector, where, ...)` (`:167`) and
  `SumByAsync<TKey>(keySelector, sumSelector, where, ...)` (`:184`), a `GROUP BY` and a
  `GROUP BY` with `SUM`, each returning one entry per key that has at least one row. These exist
  because the Application layer references no EF Core and therefore has no `IQueryable` to group: the
  alternative is projecting every matching row out of the database and folding it client-side, so
  these members are how only the aggregate crosses the wire.
- `FindIncludingDeletedAsync(...)` (`:215`), which returns the active and the soft-deleted matches as
  two separate collections from one read, rather than making a caller drop the `SoftDelete` filter and
  re-partition the result itself.

The widening cost recorded in "What this revision costs" above applies unchanged and doubled: these
are public API on a lockstep-released package family (ADR-016), the surface every consumer inherits
whether or not it calls them, and `IEntityQuerier` is correspondingly less narrow than the Rationale's
"a narrow interface is the enforcement" argument implies. What has not changed is the enforcement
itself: none of the five hands back an `IQueryable`, so a handler holding the narrow interface still
cannot reach a raw queryable.

### MMCA.Helpdesk narrows too
The reference application now declares a narrow holder of its own. `GetTicketByIdHandler` types its
local to `IEntityReader<Ticket, TicketIdentifierType>` and assigns it from
`unitOfWork.GetReadRepository<Ticket, TicketIdentifierType>()`
(`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Application/Tickets/UseCases/GetById/GetTicketByIdHandler.cs:24`),
with the reasoning written beside it (`:22-23`): the read repository rather than the write surface,
and the reader rather than the composite, because a by-id lookup is all the handler does. That is the
same acquisition path both production applications use, so the seed now demonstrates the narrowing
instead of only describing it, which matters more here than in either app: this tree is also the
`mmca-app` template source, so an adopter's scaffolded query handler starts narrowed.

Three of the four repositories therefore have a narrowed dependent. Coverage of the queryable fitness
rule is unrelated and unchanged: MMCA.Helpdesk still ships no
`RawQueryableConventionTests` subclass, so the Trade-offs entry above stands as written.

### The consumer anchors moved
MMCA.ADC's narrowing grew from twelve declarations across eight Application files to fifteen across
eleven, the new ones being Engagement's vote, upvote, badge, check-in and leaderboard paths plus
Conference's room and session update handlers; `SessionRoomScheduling.cs:45` and the four
`PublicConferenceVisibility` locals are where the Revision (2026-08-21) left them. MMCA.Store still
ships exactly three narrowed holders, but `AssignParentCategoryHandler` is now
`CategoryAssignParentUpdateHandler`, so the file this record cited no longer exists under that name.
Neither change touches the contract; both are recorded so the citations above resolve.
