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
`EFReadRepository`, `SessionsController`, and `IEntityQueryService` anchors).

## Context
Every read an application handler performs has to come from somewhere, and the shape of that contract
decides whether the module can still be lifted into its own service later (ADR-007, ADR-008). The
framework already keeps persistence out of Application by reference: the interfaces live in
`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs` and the EF
implementation in
`Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:15-17`, so no
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
  (`IRepository.cs:14`) carries single-entity lookups: `GetByIdAsync` (`IRepository.cs:19`, `:24`),
  `GetByIdsAsync` (`:37`), and the two `ExistsAsync` overloads (`:45`, `:51`).
  `IEntityQuerier<TEntity, TIdentifierType>` (`:64`) carries collection work: `GetAllAsync` (`:69`),
  `GetProjectedAsync` (`:80`), `GetAllForLookupAsync` (`:87`), and `CountAsync` (`:94`, `:97`).
  `IReadRepository` composes exactly those two (`:110-111`), and `IRepository` composes read plus
  write (`:238`). The interface documentation directs new handlers at the focused sub-interfaces and
  leaves existing code on the composite (`:105-106`).
- **The raw queryables live on the composite only.** `Table`, `TableNoTracking`,
  `TableNoTrackingSingleQuery`, and `TableNoTrackingSplitQuery` are declared on `IReadRepository`
  (`IRepository.cs:116`, `:119`, `:122`, `:125`) and implemented as EF `DbSet` expressions
  (`EFReadRepository.cs:250`, `:253`, `:256`, `:259`). They are deliberately absent from
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
- **Specifications compose.** `AndSpecification` (`Specification.cs:62`), `OrSpecification` (`:88`),
  and `NotSpecification` (`:114`) build a new lambda over a fresh parameter with `Expression.Invoke`
  so the result stays an expression tree EF can translate (`:74-78`, `:100-104`, `:125-128`);
  `InlineSpecification` (`:45`) wraps a predicate that was assembled dynamically and has no
  hand-written class. Composition is used in production: ADC's paged session read ANDs the
  public-session specification with the speaker-scoped one rather than substituting, because dropping
  the public filter would leak non-accepted sessions to non-privileged callers
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionsController.cs:96`,
  `:118`, rationale at `:91-93`).
- **The specification enters the same query pipeline, not a parallel one.** `IEntityQueryService`
  takes an optional `Specification<TEntity, TIdentifierType>` on every read
  (`Source/Core/MMCA.Common.Application/Interfaces/IEntityQueryService.cs:40`, `:63`, `:110`,
  `:131`), and `EntityQueryService` passes its `Criteria` into the query parameters
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
(`Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:100`). `IEntityReader` and
`IEntityQuerier` have no reference of any kind outside their own declaration file across all four
repositories: not a type, not a parameter, and not a doc comment (`IRepository.cs:14`, `:64`). The
only other occurrences of either name in the workspace describe the contract rather than depend on
it: two comments in MMCA.Helpdesk's template staging script
(`MMCA.Helpdesk/build/templates/stage.ps1:250`, `:958`) noting that `IEntityReader.GetByIdAsync`
declares `includes` as a required parameter, which is why the generated conditional passes an empty
list instead of omitting the argument. So the ISP split is today the declared target that new
handlers are pointed at (`IRepository.cs:105-106`), not the dependency shape any handler currently
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
supply `TIdentifierType`).
