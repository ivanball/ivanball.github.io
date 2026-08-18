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
were re-stated against that same revision).

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
  `GetProjectedAsync` (`:105`), `GetAllForLookupAsync` (`:113`), and `CountAsync` (`:120`, `:123`).
  `IReadRepository` composes exactly those two (`:221-222`), and `IRepository` composes read plus
  write (`:349`). The interface documentation directs new handlers at the focused sub-interfaces and
  leaves existing code on the composite (`:216-217`).
- **The raw queryables live on the composite only.** `Table`, `TableNoTracking`,
  `TableNoTrackingSingleQuery`, and `TableNoTrackingSplitQuery` are declared on `IReadRepository`
  (`IRepository.cs:227`, `:230`, `:233`, `:236`) and implemented as EF `DbSet` expressions
  (`EFReadRepository.cs:279`, `:282`, `:285`, `:288`). They are deliberately absent from
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
  `:18`). A business filter that takes no argument is smaller still, one overridden `Criteria`, as in
  ADC's `PublishedEventSpecification`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Specifications/PublishedEventSpecification.cs:11`,
  `:14`), the only class in that module's `Events/Specifications` directory. Row-scoping is not
  hand-written per entity at all: the generic `OwnedByUserSpecification<TEntity, TIdentifierType>`
  filters on the `CreatedBy` audit field once in the framework
  (`Source/Core/MMCA.Common.Domain/Specifications/OwnedByUserSpecification.cs:20`, `:29-30`) and is
  closed over the entity type at the call site, which is how ADC scopes an attendee to their own
  answers
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:66-67`).
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
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionsController.cs:96`,
  `:118`, rationale at `:91-93`).
- **The specification enters the same query pipeline, not a parallel one.** `IEntityQueryService`
  takes an optional `ISpecification<TEntity, TIdentifierType>` on every DTO or entity read: the two
  `GetAllAsync` overloads, `GetEntityByIdAsync`, and `GetByIdAsync`
  (`Source/Core/MMCA.Common.Application/Interfaces/IEntityQueryService.cs:40`, `:63`, `:110`,
  `:131`). The other two reads on the interface take a raw predicate rather than a specification,
  `GetAllForLookupAsync` (`:87-91`) and `ExistsAsync` (`:143-146`).
  `EntityQueryService` passes the specification's `Criteria` into the query parameters
  (`Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:427`) alongside the dynamic
  filters, sorting, and paging. Cross-source predicates are produced the same way:
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
query from `Table` / `TableNoTracking` at `EntityQueryService.cs:419-421`) plus five Notifications
handlers (`RawQueryableConventionTests.cs:26-36`), and MMCA.ADC exempts eight, the Engagement live
layer and bookmark aggregations, the Identity user-list projection, and the Notification GDPR export
(`MMCA.ADC/.../RawQueryableConventionTests.cs:34-52`).

The interface split is shipped, but nothing depends on the narrow interfaces yet. `IUnitOfWork` hands
out only the composites (`IRepository` at
`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IUnitOfWork.cs:19`, `IReadRepository`
at `:29`), and the container registers only the open generic `IRepository<,>`
(`Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:107`). `IEntityReader` and
`IEntityQuerier` have no reference in C# code outside their own declaration file across all four
repositories: not a type, not a parameter, and not a doc comment. The only C# occurrences of either
name in the workspace are inside that file, the two declarations (`IRepository.cs:21`, `:80`) and
`IReadRepository` naming them in its own doc comment and base list (`:214-215`, `:222`). The only
other occurrences in the workspace describe the contract rather than depend on it: two comments in
MMCA.Helpdesk's template staging script
(`MMCA.Helpdesk/build/templates/stage.ps1:250`, `:959`) noting that `IEntityReader.GetByIdAsync`
declares `includes` as a required parameter, which is why the generated conditional passes an empty
list instead of omitting the argument. So the ISP split is today the declared target that new
handlers are pointed at (`IRepository.cs:216-217`), not the dependency shape any handler currently
has.

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
  two-line construction (`SessionsController.cs:118`) instead of a second hand-written query path,
  which is what makes "never substitute the public filter" a cheap rule to follow.
- **A textual scan was chosen deliberately over IL analysis.** NetArchTest and reflection cannot see
  member usage inside method bodies, and the testing package carries no IL or Roslyn dependency on
  purpose, so the rule is an honest line scan with its limits written down
  (`RawQueryableConventionTestsBase.cs:13-23`).
- **The ratchet beats a big-bang cleanup.** Recording existing raw-queryable files in `AllowedFiles`
  makes new code clean immediately while the list shrinks over time (`:24-27`), the same adoption
  posture used elsewhere in the fitness suite (ADR-015).

## Trade-offs
- **The ISP split is guidance, not yet a wired dependency.** Because the only accessors return the
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
- **`Expression.Invoke` composition is a provider bet.** The And/Or/Not combinators embed each
  operand with `Expression.Invoke` (`Specification.cs:75-77`), which the SQL Server provider
  translates; the cross-source helper deliberately avoids it and rebinds parameters instead so the
  combined predicate stays translatable on every provider
  (`CrossSourceSpecification.cs:83-87`). Composed specifications are therefore not automatically
  portable to every engine.
- **A specification carries only a predicate.** `ISpecification` exposes `Criteria` and nothing else
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

### 3. The querier answers specification-first reads
`IEntityQuerier` (`IRepository.cs:80`) gains four members that take an `ISpecification` rather than a
raw predicate or a bag of query parameters: `CountAsync` (`:134`, ordering and paging deliberately
ignored), `ListAsync` (`:151`), a projecting `ListAsync<TResult>(specification, select, ...)`
(`:170`), and `AnyAsync` (`:182`), implemented on `EFReadRepository` and forwarded by
`EFReadRepositoryDecorator` (`:78`, `:92`, `:98`, `:105`). Alongside them, `IEntityQueryService`
widened from the abstract `Specification<TEntity, TIdentifierType>?` to the interface
`ISpecification<TEntity, TIdentifierType>?` on all four of the members that take one
(`IEntityQueryService.cs:40`, `:63`, `:110`, `:131`), which is what lets a `QuerySpecification`, a
composed one, or an `InlineSpecification` be passed to the same reads.

The narrow-interface observation in the Trade-offs is unchanged in kind and sharper in consequence:
`IUnitOfWork` still hands out only the composites, so these members arrive on an interface nothing
depends on by name. What changed is that `IEntityQuerier` is now the only place several of these
reads exist, so the ISP split has moved from documentation toward being the shape a handler would
actually want.

### 4. Projection can be pushed into SQL
An optional `IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityDTOProjector.cs:51`) exposes one
member, `IQueryable<TEntityDTO> ProjectTo(IQueryable<TEntity> source)` (`:62`), and is auto-registered
by the Application assembly scan (`.../Application/DependencyInjection.cs:160`). When one is
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
`GetPageByCursorAsync` is declared on `IEntityQuerier` alone (`IRepository.cs:207`, inherited by
`IReadRepository` at `:221`, implemented at `EFReadRepository.cs:369` and forwarded at
`EFReadRepositoryDecorator.cs:111`):

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
(`EFReadRepository.cs:395-401`) and an unknown sort column returns `Error.InvalidEntityField`
(`:378-384`), both `ErrorType.Validation` and both therefore mapping to a 400 through the ADR-013
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
  a second, richer implementation shape. Every one of them is public API on a lockstep-released
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
