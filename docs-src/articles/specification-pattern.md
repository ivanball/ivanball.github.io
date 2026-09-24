# Specifications over LINQ spaghetti: composable, reusable query intent

> Series: MMCA.Common · Article #6 · Pillar P2 · Group G03 · Rubric §2,§8 ·
> ADR-055 · Status: grounded in
> `Website/docs-src/adr/055-repository-and-specification-contract.md`,
> `Website/docs-src/onboarding/group-03-querying-specifications.md` and
> `Website/docs-src/governance/common-ArchitectureScorecard.md` (§2, Design Patterns). No em dashes.

**Subtitle:** A `.Where(s => s.SpeakerId == id && !s.IsDeleted && s.IsPublished)` copied into nine
controllers is nine places to forget the authorization clause. Here is the Specification pattern that
makes query intent a first-class, composable, testable object, and a generic pipeline that keeps the
Application layer from ever touching EF Core.

---

Find the bug:

```csharp
// SessionsController.GetMine
var sessions = _db.Sessions
    .Where(s => s.SpeakerId == currentUserId && !s.IsDeleted)
    .ToList();

// SessionsController.GetMinePublished  (added three months later, different dev)
var sessions = _db.Sessions
    .Where(s => s.IsPublished && !s.IsDeleted)   // forgot the SpeakerId scope
    .ToList();
```

The second query leaked. It returns every published session in the system, not just the current
speaker's, because the `SpeakerId` authorization clause lived as a loose lambda that someone had to
remember to copy. The predicate that *matters most* (the one that scopes data to the caller who is
allowed to see it) is the one most easily dropped, because it is just text in a `.Where()` that gets
re-typed at every call site.

This is LINQ spaghetti: query intent scattered across controllers as ad-hoc lambdas, with no name, no
reuse, and no way to test "does the own-sessions rule actually restrict to the owner" in isolation. The
Specification pattern fixes it by turning a predicate into an object.

## Why it matters

Query predicates are not throwaway plumbing. Some of them encode business rules ("a published event is
one whose status is Published and whose start date has not passed") and some encode authorization
("only the questions this attendee asked"). When those live as inline lambdas:

- **They cannot be named or reused.** "Published event" is a concept; `.Where(e => e.Status ==
  Published && e.StartsAt > now)` is a spell you recite from memory.
- **They cannot be composed reliably.** Combining two inline predicates with `&&` works until one of
  them has to be applied conditionally, at which point you get branching `IQueryable` plumbing in the
  controller.
- **They cannot be tested in isolation.** You can only test the controller action that uses them, so
  the rule and the HTTP plumbing are tangled in every test.
- **The security-critical ones get dropped,** exactly as above.

A specification gives the predicate a type and a name, makes it composable with `And`/`Or`/`Not`, and
lets the framework apply it server-side so the filter runs in the database, not in memory after a
full-table load.

## The MMCA answer: trusted specifications, untrusted filters, one pipeline

MMCA.Common splits the read side into three cooperating sub-systems, and the split is the point.

### 1. The Specification pattern (the trusted predicate)

`ISpecification<TEntity, TIdentifierType>` exposes two faces of the same rule:

- a `Criteria` expression tree (`Expression<Func<TEntity, bool>>`) that **EF Core translates to SQL**,
  so the filter runs in the database, and
- an `IsSatisfiedBy(entity)` predicate for **in-memory** evaluation.

The abstract base `Specification<TEntity, TIdentifierType>` lazy-compiles the expression once and caches
the delegate, so repeated in-memory checks do not recompile the tree. Three combinators,
`AndSpecification`, `OrSpecification`, and `NotSpecification`, compose specifications into a new one,
and they do it by **parameter substitution**: an `ExpressionVisitor` rebinds the right-hand operand's
parameter onto the left-hand lambda's own parameter, and the two bodies are joined with
`Expression.AndAlso` / `OrElse` / `Not`, so the result is again a single
`Expression<Func<TEntity, bool>>`, indistinguishable from a hand-written predicate. The obvious
alternative, `Expression.Invoke(spec.Criteria, parameter)`, is deliberately avoided, and the source
says so in as many words: an `InvocationExpression` survives into the query tree, and while EF Core's
relational providers can usually unwrap it, others (Cosmos in particular) throw at translation time, so
an ANDed specification failed on exactly the engines the framework is meant to be portable across.
Substitution translates everywhere. Each combinator also builds its composed expression once per
instance and caches it in a lazy field, because the query pipeline reads `Criteria` at least once per
request. That is how both the source XML docs and the onboarding chapter describe it. There is a fluent
face as well: `And`, `Or`, and `Not` ship as extension members on `ISpecification`, so
`spec.And(other).Not()` reads left to right instead of inside out while the abstract base stays
untouched. Composition is live in production
today, in five consumer read paths across two applications. Three are in ADC: the paged sessions read
ANDs the public-session filter with the speaker-scoped one rather than substituting, because dropping
the public filter for a speaker-scoped request would leak non-accepted sessions to non-privileged
callers; the paged speakers read ANDs the public-speaker filter with an event-scoped one for the same
reason; and a shared visibility helper ANDs the public-session status rule with an inline event-scope
predicate before projecting session ids. Two are in MMCA.Store, where the public product-reviews
endpoint and the domain-event handler that recomputes a product's rating both AND a by-product review
specification with a published-reviews one. Each composed `Criteria` reaches the database as a single
server-side `WHERE`. All five call the fluent `.And()`, and the hand-built
`new AndSpecification<...>(a, b)` form appears nowhere in the three consumer repositories. Five call
sites in two applications is still a narrow sample, though (MMCA.Helpdesk composes nothing), and `Or`
and `Not` ship without a caller.

```csharp
// A named, reusable, server-authored visibility rule (ADC, BR-49): a session is publicly
// visible when it is Accepted, or carries no status (organizer-created sessions never get one).
public sealed class PublicSessionStatusSpecification : Specification<Session, SessionIdentifierType>
{
    // Exposed on its own because other public read paths compose this predicate into larger expressions.
    public static readonly Expression<Func<Session, bool>> StatusCriteria =
        s => s.Status == null || s.Status == SessionStatuses.Accepted;

    // Criteria is an abstract get-only property on the base; override it with an expression body.
    public override Expression<Func<Session, bool>> Criteria => StatusCriteria;
}

// The paged sessions read: the speaker scope (itself a specification, a Session.Id IN (...) filter
// over the SessionSpeaker join) is ANDed with the public rule, never substituted for it.
return publicSpecification is null
    ? speakerResult.Value
    : publicSpecification.And(speakerResult.Value!);
```

The leaked-query bug from the opening cannot happen here. Both halves of the composed query are named
objects, not text someone retypes at every call site: the speaker scope arrives as a specification
built by a query handler, and the public visibility rule is a type the controller always ANDs in,
because substituting one for the other would leak non-accepted sessions to non-privileged callers (the
composing method's own doc comment says exactly that). The criteria are server-authored, so the client
cannot tamper with them, and each rule is reusable and testable in isolation. This is a textbook
Specification with security overtones: the authorization predicate is not something the request can
override.

Scoping a query to the caller's own rows is common enough that the framework ships it: `OwnedByUserSpecification<TEntity,
TIdentifierType>` filters on the `CreatedBy` audit field once, in the Domain layer, and is closed over
the entity type at the call site. Its generic constraint is deliberately the concrete
`AuditableBaseEntity<TIdentifierType>` rather than an interface, because a member access declared on an
interface is not guaranteed to map to the entity's audit column and the criteria has to stay
EF-translatable. ADC's question-answer controllers show the intended shape: an organizer gets `null`
(no scoping at all), and everyone else gets that specification bound to their own user id.

### 2. Dynamic filtering (the untrusted input)

The other half of any list endpoint is user-driven shaping: the `?filter=...&sort=...&fields=...`
querystring. This is *untrusted* and is handled completely separately. Each CLR type gets an
`IFilterStrategy` (`StringFilterStrategy`, `IntFilterStrategy`, `DateTimeFilterStrategy`, and so on)
that knows which operators it supports, and a `QueryFilterService` registry dispatches by type. It runs
in two phases: `ValidateFilters` checks that the property exists on the entity and the operator is
legal for its type *before* the query (so a bad filter is a 400, not a SQL exception), and
`ApplyFilters` builds the `.Where()` chain. Untrusted input is allow-listed against real entity
metadata, never concatenated blindly.

The separation is deliberate and worth stating plainly: **specifications are trusted and live with the
domain; dynamic filters are untrusted and are validated, capped, and reflection-cached at the
application boundary.** Conflating the two is how authorization clauses end up overridable by a query
string.

### 3. The pipeline and EntityQueryService (the orchestrator)

`IEntityQueryPipeline` (implemented by `EntityQueryPipeline`) executes against an `IQueryable<TEntity>`
and an immutable `EntityQueryParameters<TEntity>` bundle carrying the specification's `Criteria`, the
dynamic filters, sort, fields, paging, and include flags. The pipeline applies the criteria plus the
user filters as translated SQL `WHERE` clauses, sorts, counts before paging, applies `Skip`/`Take`,
projects the requested columns, and materializes. An unpaginated query is capped at
`MaxUnboundedResultLimit` (1000) so a caller who forgets paging can never trigger an unbounded
full-table load.

`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>` is the public face that controllers inject.
Its `GetAllAsync` is a three-step orchestration, and the source labels the steps: **validate** all
parameters up front via `Result.Combine` (a bad `fields` is a 400 before any DB hit), **execute** the
query pipeline (includes, criteria, filters, sort, pagination, field selection), and **shape** the
output to the requested fields before wrapping the result in `PaginationMetadata`. Add a new entity and
it inherits filtering, sorting, paging, sparse
fieldsets, and eager-loading for free. The methods are `virtual`, so a module subclass can override one
behavior without reimplementing the engine.

### The Application-purity payoff: IQueryableExecutor

Here is the subtle part that makes the whole pipeline architecturally honest. The Application layer
runs queries, but it must never reference EF Core directly (that is an Infrastructure concern, and the
inward-dependency rule forbids it). The pipeline therefore works against an `IQueryable<TEntity>`
abstraction, and the actual EF materialization (`ToListAsync`, `CountAsync`, and friends) sits behind an
`IQueryableExecutor` abstraction implemented in Infrastructure (the interface lives in
`MMCA.Common.Application`, exposing `Include` / `AsSplitQuery` / `ToListAsync` / `CountAsync`).
Application code asks the abstraction to run the query; Infrastructure supplies the EF Core
implementation. The result: the entire read engine lives in the Application layer with zero
`using Microsoft.EntityFrameworkCore`, and the layer-dependency fitness functions stay green. The
generic query pipeline is, in effect, EF Core used correctly from a layer that is not allowed to know
EF Core exists.

### The contract underneath: repository plus specification

A specification is only half of the data-access contract. The other half is what a handler is allowed to
ask the repository for, and the framework splits that read surface by responsibility rather than
shipping one fat interface. `IEntityReader<TEntity, TIdentifierType>` carries single-entity work
(`GetByIdAsync`, `GetByIdsAsync`, and the two `ExistsAsync` overloads).
`IEntityQuerier<TEntity, TIdentifierType>` carries collection work, and its shape is emphatically
specification-first: alongside the parameter-driven `GetAllAsync`, `GetProjectedAsync`,
`GetAllForLookupAsync`, and `CountAsync`, it declares reads that take an `ISpecification` outright
(`CountAsync(specification)`, `ListAsync(specification)`, a projecting
`ListAsync<TResult>(specification, select)`, `AnyAsync(specification)`, and
`FirstOrDefaultAsync(specification)`), a keyset-paged `GetPageByCursorAsync` whose optional
specification scopes the page, and expression-predicate aggregates that keep the arithmetic in the
database (`CountByAsync`, `SumByAsync`, and the soft-delete-aware `FindIncludingDeletedAsync`). The
premise of this whole article, that query intent belongs in an object, is what the read contract
itself assumes.
`IReadRepository` composes exactly those two, and it alone
exposes the raw queryables: `Table`, `TableNoTracking`, `TableNoTrackingSingleQuery`, and
`TableNoTrackingSplitQuery`. A handler that declares the narrow dependency cannot reach an `IQueryable`
at all, because the member is not on the interface it asked for.

Why ban the queryable from a use-case handler? Because a handler written against one is EF-coupled: its
query shape means something only to the provider that will translate it, so the same call cannot be
answered across a gRPC boundary, and the module quietly loses the monolith-to-microservice extraction
promise. `GetByIdAsync`, `GetProjectedAsync`, and `CountAsync` each map onto a request/response message;
a composed `IQueryable` does not. So the rule is not left to code review:
`ApplicationLayer_DoesNotUseRawQueryableSurfaces` is a fitness function that reads the `.cs` files of
each mapped module's Application project, flags `.Table` / `.TableNoTracking*` member access, and fails
the build on a hit. It is deliberately a textual line scan rather than IL analysis (the testing package
carries no Roslyn or IL dependency on purpose), and its limits are documented on the rule itself.
Existing violations go into an `AllowedFiles` list used as an adoption ratchet, so new code is clean
immediately while the list shrinks. The rule is opt-in per repository by subclassing the base:
MMCA.Common, MMCA.ADC, and MMCA.Store subclass it today (Store adopted with an empty `AllowedFiles`,
because its Application layer had zero raw-queryable uses at adoption), so only MMCA.Helpdesk's
Application code is not scanned yet.

## Trade-offs, honestly

The pattern earns its keep, but a few real, specific gaps are worth stating plainly rather than
glossing:

- **Two query vocabularies coexist.** Specifications (typed, programmer-authored) and dynamic filters
  (string, user-authored) are different mechanisms with different trust levels. That is the right
  design, but a newcomer has to learn which is which and resist the temptation to express an
  authorization rule as a dynamic filter.
- **The generic pipeline trades some control for reuse.** Free filtering/sorting/paging for every
  entity is a large win, but a query with genuinely bespoke shape may fit the pipeline awkwardly and is
  better written directly. The `virtual` override points exist for exactly this, but knowing when to
  override versus when to bypass is judgment.
- **The queryable ban is a textual scan, and it is opt-in.** It skips only whole-line `//` comments, so
  a match inside a string literal or a trailing comment is a false positive, and it cannot see through
  variable indirection or an alias that re-exposes a queryable. Three of the four repositories subclass
  the rule today; only MMCA.Helpdesk relies on review. The allowlisted files are real coupling, not
  paperwork: each one would need rework if its module moved behind a transport boundary.

None of these argue against the pattern. They argue for testing your composed specifications and for
keeping the trusted/untrusted boundary crisp.

## Apply this even without MMCA

The core ideas port to any stack and any ORM:

1. **Give predicates a type and a name.** A `PublishedEvent` specification object beats a copied
   `.Where()` lambda. Named intent is reusable, testable, and hard to forget.
2. **Keep authorization scopes server-authored.** The clause that restricts data to the caller should
   be an object the server supplies, never something the request can shape. Conflating "what the user
   filtered for" with "what the user is allowed to see" is a security bug waiting to happen.
3. **Validate untrusted query input against real metadata.** Allow-list filter properties and operators
   against the entity's actual type before they reach the database, so a bad filter is a 400, not a 500
   or an injection.
4. **Cap unpaginated reads.** A safety ceiling on result size turns "someone forgot `Take`" from an
   outage into a clamped response.
5. **Combine expression trees by substitution, not invocation.** `Expression.Invoke` is the tempting
   way to glue two lambdas together, and it leaves an `InvocationExpression` in the tree that some
   providers refuse to translate. Rebinding one lambda's parameter onto the other with an
   `ExpressionVisitor` yields a tree indistinguishable from hand-written code, so it translates
   everywhere. Then still write a test that asserts the combined query runs in the database rather
   than falling back to in-memory evaluation.
6. **Do not hand a queryable to a use-case handler.** Give it methods it can call (by id, projected,
   counted) and predicates it can pass, not an `IQueryable` it can compose. Method calls map onto
   messages; a composed query means something only to the provider that will translate it, which is the
   difference between a module you can move later and one you cannot.

The rule of thumb: **query intent that matters (business rules and authorization scopes) deserves to be
a named, composable, tested object, not a lambda you re-type at every call site.**

---

**What we covered:** why inline LINQ predicates scatter and leak, the Specification pattern with its
`Criteria` expression tree and its `And`/`Or`/`Not` combinators that compose by parameter substitution
rather than `Expression.Invoke`, the separation of trusted specifications
from untrusted dynamic filters, the generic `EntityQueryPipeline` / `EntityQueryService` that gives
every entity filtering/sorting/paging/sparse-fieldsets for free, the `IQueryableExecutor` abstraction
that keeps the Application layer free of EF Core, the ISP-split read contract (`IEntityReader` and
`IEntityQuerier` under `IReadRepository`) with a build gate that bans raw queryables from Application
code.

**Next in the series:** the CQRS decorator pipeline, where logging, caching, validation, and
transactions wrap every command and query without touching a handler.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the querying chapter, or
`dotnet add package MMCA.Common.API` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- Onboarding chapter: `Website/docs-src/onboarding/group-03-querying-specifications.md`.

*Tags: .NET, C Sharp, Software Architecture, Programming, Entity Framework*

*Notes (re-verified against the current tree, 2026-09-19, MMCA.Common v1.205.0):
`ISpecification<TEntity, TIdentifierType>` exposes `Criteria`
(`Domain/Interfaces/ISpecification.cs:17`) and `IsSatisfiedBy` (`:22`); the abstract base's `Criteria`
is a get-only abstract property (`Domain/Specifications/Specification.cs:23`) and `IsSatisfiedBy`
lazy-compiles and caches the delegate in a private field (`:27`, `:32`).
**Composition mechanism:** `AndSpecification` (`Specification.cs:81`), `OrSpecification` (`:105`), and
`NotSpecification` (`:128`) use no `Expression.Invoke` at all. Each delegates to the internal
`SpecificationComposer` (`:146`), whose `Combine` (`:155`) takes the LEFT lambda's existing parameter
(`var parameter = left.Parameters[0];`, `:167`), rebinds the right-hand body onto it with
`ParameterReplacer.Replace` (`:171`), and joins the two bodies with `Expression.AndAlso`/`OrElse`
(`:169-173`); `Negate` (`:181`) wraps the inner body in `Expression.Not` and keeps that lambda's own
parameter (`:189-191`). No fresh parameter is created and no `Expression.Invoke` appears anywhere in
the file. The rebinder is the internal `ExpressionVisitor` `ParameterReplacer`
(`Domain/Specifications/ParameterReplacer.cs:24`, static `Replace` with a `ReferenceEquals`
short-circuit at `:34`/`:40`, `VisitParameter` at `:44`), shared with the Application layer through
`InternalsVisibleTo` (`:18-23`). The portability rationale is in the XML docs at
`Specification.cs:58-75`: substitution produces a tree indistinguishable from a hand-written predicate
(`:60-63`), while an `InvocationExpression` "survives into the query tree, and while EF Core's
relational providers can usually unwrap it, others (Cosmos in particular) throw at translation time"
(`:66-69`); the per-instance caching rationale is at `:71-75` and the lazy fields themselves at
`:88`/`:91-93`, `:112`/`:115-117`, `:134`/`:137-138`. `ParameterReplacer.cs:12-15` states the same
avoidance. **Fluent forms:** `SpecificationExtensions`
(`Domain/Specifications/SpecificationExtensions.cs:30`) declares an
`extension<TEntity, TIdentifierType>(ISpecification<...> specification)` block (`:32`) exposing `And`
(`:48`), `Or` (`:68`), and `Not` (`:85`), each a thin factory over the corresponding combinator.
`Website/docs-src/onboarding/group-03-querying-specifications.md:17` documents the same substitution
mechanism and the same fluent members.
`Website/docs-src/governance/common-ArchitectureScorecard.md` (Rubric 2, Design Patterns) cites
Specification composition positively; its inline source anchors are not relied on here.
**Composition call sites, five of them, in two applications, each feeding a database read:**
(1) `MMCA.ADC/.../Conference.API/Controllers/Sessions/SessionsController.cs:129` evaluates
`publicSpecification.And(speakerResult.Value!)` inside `BuildPagedSessionSpecificationAsync` (`:107`),
and the result is the `specification:` argument (`:188`) of the paged `QueryService.GetAllAsync(` call
at `:185`; the never-substitute rationale (dropping the public filter for a speaker-scoped request
"would leak non-accepted sessions to non-privileged callers") is in that method's doc remarks at
`:103`. (2) `.../Conference.API/Controllers/Speakers/SpeakersController.cs:174` ANDs the BR-239
public-speaker specification with the event-scoped filter, feeding the `GetAllAsync` call at `:178` as
its `specification:` argument at `:181`. (3)
`.../Conference.Application/Common/PublicConferenceVisibility.cs:149` ANDs
`PublicSessionStatusSpecification` with an `InlineSpecification` event scope (`Specification.cs:45`),
and the composed specification itself (not its `Criteria`) feeds the spec-taking projecting
`ListAsync` at `:154` (that helper, `GetEligibleSessionIdsAsync` at `:141`, backs
`GetVisibleSpeakerIdsAsync` at `:104`). (4)
`MMCA.Store/.../Catalog.API/Controllers/ReviewsController.cs:113` passes
`new ReviewsByProductSpecification(productId).And(new PublishedReviewsSpecification())` as the
`specification:` argument of the public paged reviews read (`GetAllAsync` at `:112`). (5)
`MMCA.Store/.../Catalog.Application/Reviews/DomainEventHandlers/ProductReviewChangedHandler.cs:56`
passes the same composed pair to the spec-taking projecting `ListAsync` (`:55`, projection
`review => review.Rating` at `:57`) when recomputing a product's rating. The two Store specifications
are `Catalog.Application/Reviews/Specifications/ReviewsByProductSpecification.cs:13` and
`.../PublishedReviewsSpecification.cs` (`Criteria` override at `:17`).
Scans of `MMCA.ADC/Source`, `MMCA.Store/Source`, and `MMCA.Helpdesk/Source` for
`new AndSpecification`/`OrSpecification`/`NotSpecification` and for `.Or(`/`.Not(` return zero hits:
every live composition uses the fluent `.And()`, and `Or` and `Not` have no consumer call site.
MMCA.Helpdesk composes nothing. The specification-first `ListAsync` has three consumer call sites:
`PublicConferenceVisibility.cs:78` (in `GetVisibleSessionIdsAsync`, `:57`) and `:154` above, plus
`ProductReviewChangedHandler.cs:55`.
The framework-shipped ownership scope is `OwnedByUserSpecification<TEntity, TIdentifierType>`
(`Domain/Specifications/OwnedByUserSpecification.cs:20`), criteria `e => e.CreatedBy == UserId`
(`:29-30`), constrained to the concrete `AuditableBaseEntity<TIdentifierType>` for EF-translatability
(`:12-16`, `:22`); ADC binds it per caller in its event- and session-question-answer controllers
(organizer gets `null`, everyone else gets the scope).
The pipeline applies the composed criteria server-side as `query.Where(parameters.Criteria)`
(`Application/Services/Query/EntityQueryPipeline.cs:74` in `ExecuteProjectedAsync` and `:149` in
`ApplyIncludesCriteriaAndFilters`). Filtering: seven `IFilterStrategy` types
(`String`/`Bool`/`Int`/`Long`/`DateTime`/`Decimal`/`Guid`) in the `QueryFilterService` type registry
(`Application/Services/Filtering/QueryFilterService.cs:29-45`, entries at `:32-44`), two phases
`ValidateFilters`/`ApplyFilters`. Pipeline: `IEntityQueryPipeline`/`EntityQueryPipeline`,
`EntityQueryParameters<TEntity>`, `MaxUnboundedResultLimit` (1000) at `EntityQueryPipeline.cs:23`
applied via `Take` at `:99`/`:195`/`:250`;
`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>` overloads are `public virtual`
(`Application/Services/EntityQueryService.cs:262`, `:283`) and the source labels **three** steps, not
four: "Step 1: Validate" at `:296` (via `Result.Combine`, `:297`), "Step 2: Execute the query pipeline"
at `:316`, "Step 3: Shape output to requested fields" at `:363`, with `PaginationMetadata` built by
`BuildPaginationMetadata` (`:608`, called at `:368`) and attached at `:377`. `IQueryableExecutor` is
declared in `MMCA.Common.Application`
(`Application/Interfaces/Infrastructure/Persistence/IQueryableExecutor.cs:7`, `Include` `:14`,
`AsSplitQuery` `:26`, `ToListAsync` `:34`, `CountAsync` `:41`) with the EF implementation in
Infrastructure.
ADR-055 section verified against
`Website/docs-src/adr/055-repository-and-specification-contract.md` and source. The read contract sits
in `Application/Interfaces/Infrastructure/Persistence/IRepository.cs` (a `Persistence/` subfolder
holds the persistence-facing interfaces): `IEntityReader<TEntity, TIdentifierType>` at `:21`
(`GetByIdAsync` `:26`/`:31`, `GetByIdsAsync` `:48`, `ExistsAsync` `:56`/`:62`), `IEntityQuerier` at
`:80` carrying the four parameter-driven reads (`GetAllAsync` `:85`, `GetProjectedAsync` `:105`,
`GetAllForLookupAsync` `:222`, `CountAsync` `:229`/`:232`), five specification-first ones
(`CountAsync(specification)` `:243`, `ListAsync(specification)` `:260`,
`ListAsync<TResult>(specification, select)` `:279`, `AnyAsync(specification)` `:291`, and
`FirstOrDefaultAsync(specification)` `:148`), the keyset-paged `GetPageByCursorAsync` `:316` whose
optional `specification` scopes the page, and the expression-predicate members
`FirstOrDefaultAsync(where)` `:133`, `CountByAsync` `:167`, `SumByAsync` `:184`, and
`FindIncludingDeletedAsync` `:215`; `IReadRepository` composes both narrow halves at `:330-331` and
alone declares `Table`/`TableNoTracking`/`TableNoTrackingSingleQuery`/`TableNoTrackingSplitQuery`
(`:336`, `:339`, `:342`, `:345`). The build gate is
`RawQueryableConventionTestsBase.ApplicationLayer_DoesNotUseRawQueryableSurfaces`
(`Hosting/MMCA.Common.Testing.Architecture/Bases/Cqrs/RawQueryableConventionTestsBase.cs:61`),
scanning module Application projects for the `.Table`/`.TableNoTracking*` regex (`:103`), with the
extraction rationale at `:5-12`/`:85`, the textual-scan limits at `:13-23`, and the `AllowedFiles`
ratchet at `:38`/`:24-27`. Opt-in coverage is three of the four repos, each subclass sitting under a
`Cqrs/` folder in its architecture test project: MMCA.Store subclasses with an empty `AllowedFiles`
(`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Cqrs/RawQueryableConventionTests.cs:9`,
`:14`), alongside MMCA.Common
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Cqrs/RawQueryableConventionTests.cs:13`,
`AllowedFiles` at `:25` with six exempt files at `:28-36`) and MMCA.ADC
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Cqrs/RawQueryableConventionTests.cs:11`,
`AllowedFiles` at `:33` with nine exempt files at `:37-57`); only MMCA.Helpdesk has no subclass.
ADR-055 states the three-repo opt-in in its Decision and restates it as the partial-coverage
trade-off. The repository-resolution mechanics are in `Infrastructure/Persistence/UnitOfWork.cs`:
`GetReadRepository` (`:53`) resolves the entity's data source key, gets the matching `DbContext`, and
creates the repository (`:60-62`), caching it in the per-scope `_repositories` dictionary (`:23`,
`:57-64`) so the same entity reuses one instance.
**Editorial removal (carried forward):** the two adoption-status passages (the "honest part"
paragraphs in the contract section and the "Half the composition surface still has no consumer"
trade-off) were removed from the article body at the author's direction, along with the recap clause
that echoed them. The consumption facts stay in this ledger as verified source state; do not re-add
the passages on a future pass.
**Consumption of the narrow interfaces:** a four-repo `.cs` scan for `IEntityReader`/`IEntityQuerier`
finds dependents in all three consumer applications, every one of them a helper parameter or a local
that only reads. MMCA.ADC: twenty declarations across thirteen files, among them
`Conference.Application/Common/PublicConferenceVisibility.cs:40`, `:75`, `:126`, `:151`,
`Conference.Application/SessionAssets/SessionAssetAccessService.cs:32`, `:65`, `:92`, `:125`,
`Conference.Application/Users/IntegrationEventHandlers/UserRegisteredHandler.cs:149` and `:186`,
`Conference.Application/Sessions/Validation/SessionRoomScheduling.cs:45`,
`Engagement.Application/SessionQuestions/UseCases/ToggleUpvote/ToggleUpvoteHandler.cs:107`,
`Engagement.Application/LivePolls/UseCases/CastVote/CastVoteHandler.cs:107`,
`Engagement.Application/CheckIns/Services/CheckInProcessor.cs:202`, and
`Engagement.Application/Points/UseCases/SetLeaderboardParticipation/SetLeaderboardParticipationHandler.cs:120`.
MMCA.Store carries four on `main`:
`Identity.Application/Customers/CustomerService.cs:14`,
`Identity.Application/Users/AuthenticationService.cs:50`,
`Identity.Application/Users/DomainEventHandlers/UserRegisteredHandler.cs:96`, and
`Catalog.Application/Categories/UseCases/AssignParentCategory/CategoryAssignParentUpdateHandler.cs:98`;
`Catalog.Application/Products/ProductVariantService.cs` deliberately stays `IReadRepository`, because
it calls members of both narrow halves. MMCA.Helpdesk carries one,
`Tickets.Application/Tickets/UseCases/GetById/GetTicketByIdHandler.cs:24`, typed narrow with the
reason in the comment above it (`:22`). (Store's holders reached `main` through PR #93, the v1.159.0
sweep, not the earlier PR #92, which was closed unmerged.)
The wiring is unchanged and the article says so: `IUnitOfWork` still hands out only the composites
(`Application/Interfaces/Infrastructure/Persistence/IUnitOfWork.cs:19`, `:29`), the container still
registers only the open generic `IRepository<,>` (`Infrastructure/DependencyInjection.cs:107`), and
every narrowed holder is assigned from `GetReadRepository<...>()` by implicit reference conversion, so
nothing constructor-injects a narrow interface. Both ADC and Store also wrote the convention into
their own `CLAUDE.md`: read-only holders take `IEntityQuerier<,>`/`IEntityReader<,>` from
`IUnitOfWork.GetReadRepository<>()`, compose with `.And()`/`.Or()`/`.Not()` rather than the combinator
types, and pass a specification to the spec-taking members instead of unwrapping `.Criteria`.
**ADR-055 state:** it carries the 2026-08-18 revision (`:285`: composition drops `Expression.Invoke`,
the fluent members, the specification-first reads), the 2026-08-21 revision (`:448`: the first
production consumers and the deliberately unchanged registration surface), and a 2026-08-31 revision
(`:499`) whose "The querier carries five more members" section (`:503`) covers the aggregates and
`FirstOrDefaultAsync` overloads above and whose "MMCA.Helpdesk narrows too" section (`:530`) records
the third consumer. Its Status block notes at `:34` that the Store adoption, recorded as staged in the
2026-08-21 revision, merged to `main` on 2026-08-22. Article and ADR agree; both follow source.
The specification snippet quotes shipped code:
`PublicSessionStatusSpecification` is
`MMCA.ADC/.../Conference.Application/Sessions/Specifications/PublicSessionStatusSpecification.cs:20`
(`StatusCriteria` `:23`, `Criteria` override `:27`); the ANDed composition is
`SessionsController.BuildPagedSessionSpecificationAsync`
(`MMCA.ADC/.../Conference.API/Controllers/Sessions/SessionsController.cs:107-129`) in its fluent
`publicSpecification.And(speakerResult.Value!)` form at `:129`; the speaker scope is the
`Session.Id IN (...)` `InlineSpecification` built by `GetSessionsBySpeakerFilterHandler`
(`MMCA.ADC/.../Sessions/UseCases/GetSessionsBySpeakerFilter/GetSessionsBySpeakerFilterHandler.cs:42-43`).*

- Full series index: https://ivanball.github.io/writing.html
