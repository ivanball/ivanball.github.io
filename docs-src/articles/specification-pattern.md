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
untouched. A composed specification is criteria-only, and the combinators enforce that. The framework
also ships `QuerySpecification`, a specification that carries query shape (includes, ordering, paging,
tracking, soft-delete scope) alongside its `Criteria`, so one object describes a whole read that the
spec-taking `ListAsync` honors in full. Hand a shaped one to `And`, `Or`, or `Not` and the combinator's
constructor throws `ArgumentException` instead of silently dropping the shape; an unshaped one composes
like any other, and predicates that belong with a shaped read are composed inside its own `Criteria`.
Composition is live in production
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

// The paged sessions read. publicSpecification is the public filter (null for a privileged caller):
// a specification built from StatusCriteria plus a published-event scope. The speaker scope (itself a
// specification, a Session.Id IN (...) filter over the SessionSpeaker join) is ANDed with it, never
// substituted for it.
return publicSpecification is null
    ? speakerResult.Value
    : publicSpecification.And(speakerResult.Value!);
```

The leaked-query bug from the opening cannot happen here. Both halves of the composed query are named
objects, not text someone retypes at every call site: the speaker scope arrives as a specification
built by a query handler, and the public visibility rule arrives the same way, built by another handler
from the same `StatusCriteria` plus a published-event scope. For every non-privileged caller the
controller always ANDs that rule in, because substituting one for the other would leak non-accepted
sessions to non-privileged callers (the composing method's own doc comment says exactly that); a
privileged caller (organizer or content editor) gets no public filter at all. The criteria are server-authored, so the client
cannot tamper with them, and each rule is reusable and testable in isolation. This is a textbook
Specification with security overtones: the authorization predicate is not something the request can
override.

Scoping a query to the caller's own rows is common enough that the framework ships it: `OwnedByUserSpecification<TEntity,
TIdentifierType>` filters on the `CreatedBy` audit field once, in the Domain layer, and is closed over
the entity type at the call site. Its generic constraint is deliberately the concrete
`AuditableBaseEntity<TIdentifierType>` rather than an interface, because a member access declared on an
interface is not guaranteed to map to the entity's audit column and the criteria has to stay
EF-translatable. ADC's question-answer controllers show the intended shape: an organizer gets `null`
(no scoping at all), and everyone else gets that specification bound to their own user id. The one
other way to get `null` is a non-organizer whose owner claim cannot be resolved, and that caller is
answered with a 403 by a fail-closed gate on the read endpoints, so `null` means "unscoped" only for
the role that is allowed to read everything.

### 2. Dynamic filtering (the untrusted input)

The other half of any list endpoint is user-driven shaping: the `?filter=...&sort=...&fields=...`
querystring. This is *untrusted* and is handled completely separately. Each CLR type gets an
`IFilterStrategy` (`StringFilterStrategy`, `IntFilterStrategy`, `DateTimeFilterStrategy`, and so on,
plus one built on first use for a strongly typed identifier column) that knows which operators it
supports, and a `QueryFilterService` registry dispatches by type. It runs in two phases:
`ValidateFilters` checks every key and operator *before* the query (so a bad filter is a 400, not a SQL
exception), and `ApplyFilters` builds the `.Where()` chain. Validation checks the response DTO's field
contract before the entity: a key the client wrote must name a field the DTO declares and must not be a
navigation path, a server-mapped path is capped in depth, the property must exist on the entity, and
the operator must be legal for its type. Untrusted input is allow-listed against the response contract
and real entity metadata, never concatenated blindly.

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

*Notes (re-verified against the current tree, 2026-10-08, MMCA.Common v1.233.0; ADC, Store and
Helpdesk read at current `main`):
**2026-10-08 corrections (MMCA.Common v1.233.0):** the composition paragraph gained the criteria-only
rule and `QuerySpecification`. Every combinator constructor runs `SpecificationComposer.RejectShaped`
(`Domain/Specifications/Specification.cs:165-179`, wired at `:88-89`, `:114-115`, `:138`), which
throws `ArgumentException` (`:173-175`) when the operand is a `QuerySpecification` whose `HasShape`
(`:181-189`: ordering, include paths, `Skip`, `Take`, `AsTracking`, `IgnoreQueryFilters`) is true; the
rule landed in commit `95adb84c` (v1.232.0) and is restated on the fluent class at
`SpecificationExtensions.cs:30-33`. `QuerySpecification<TEntity, TIdentifierType>` is
`Domain/Specifications/QuerySpecification.cs:43` (`AsTracking` `:77`, `IgnoreQueryFilters` `:87`);
`IEntityQuerier.ListAsync(specification)` documents that a `QuerySpecification` contributes its
includes, ordering, paging, tracking and soft-delete scope (`IRepository.cs:252-258`); Store's
`UsersAdministrationSpecification`
(`Identity.Application/Users/Administration/UsersAdministrationSpecification.cs:31`) is one, executed
by `UserAdministrationService.cs:68`. ADR-055 records the rule in its Revision (2026-10-06)
(`055-repository-and-specification-contract.md:612-622`). Anchors corrected in place below:
`Specification.cs` combinators and composer, `SpecificationExtensions.cs`, `SpeakersController.cs`,
both question-answer controllers, `UnitOfWork.cs`, the ADC narrow-interface count and
`ToggleUpvoteHandler.cs`, Store `CategoryAssignParentUpdateHandler.cs`, both `AGENTS.md` lines, and
the ADR-055 revision lines.
**2026-10-02 corrections:** the public visibility rule in the paged sessions read is not a
`PublicSessionStatusSpecification` instance. `SessionsController.GetReadSpecificationAsync`
(`MMCA.ADC/.../Conference.API/Controllers/Sessions/SessionsController.cs:75`) returns `null` for a
privileged caller (`:78-79`) and otherwise the specification from `GetPublicSessionFilterHandler`
(`:81-84`), which calls `CrossSourceSpecification.BuildAsync`
(`MMCA.ADC/.../Conference.Application/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterHandler.cs:29-34`)
with `principalPredicate: e => e.IsPublished` (`:32`) and `localPredicate:
PublicSessionStatusSpecification.StatusCriteria` (`:34`); `BuildAsync`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Specifications/CrossSourceSpecification.cs:39`)
returns an `InlineSpecification` (`:62`). The snippet comment and the prose after it were narrowed to
that. The question-answer paragraph gained the fail-closed gate: `GetExportSpecification`
(`MMCA.ADC/.../Conference.API/Controllers/Events/EventQuestionAnswersController.cs:109-114`) binds
`OwnedByUserSpecification` per caller with the `Organizer` bypass (`AllowUnscopedExport` `:121`), and
`RequireResolvableOwner` (`:137`, rationale `:123-135`) answers a non-Organizer with an unresolvable
owner claim with a 403; `SessionQuestionAnswersController.cs` has the same shape (`:109-114`, `:121`,
`:137`). The filtering paragraph
gained the response-contract check: `EntityQueryService.FieldContract` is
`QueryFieldContract.For<TEntityDTO>()` (`Application/Services/EntityQueryService.cs:123`) and is passed
to `QueryFilterService.ValidateFilters` in Step 1 (`:301`); that overload (`QueryFilterService.cs:175`)
validates against the contract before the entity (`:164-168`), and `IsAdmissibleKey` (`:209`, rules at
`:195-208`) refuses a client-authored navigation path or a field the contract does not declare and caps
server-mapped depth.
`ISpecification<TEntity, TIdentifierType>` exposes `Criteria`
(`Domain/Interfaces/ISpecification.cs:17`) and `IsSatisfiedBy` (`:22`); the abstract base's `Criteria`
is a get-only abstract property (`Domain/Specifications/Specification.cs:23`) and `IsSatisfiedBy`
lazy-compiles and caches the delegate in a private field (`:27`, `:32`).
**Composition mechanism:** `AndSpecification` (`Specification.cs:81`), `OrSpecification` (`:107`), and
`NotSpecification` (`:132`) use no `Expression.Invoke` at all. Each delegates to the internal
`SpecificationComposer` (`:151`), whose `Combine` (`:198`) takes the LEFT lambda's existing parameter
(`var parameter = left.Parameters[0];`, `:210`), rebinds the right-hand body onto it with
`ParameterReplacer.Replace` (`:214`), and joins the two bodies with `Expression.AndAlso`/`OrElse`
(`:212-216`); `Negate` (`:224`) wraps the inner body in `Expression.Not` and keeps that lambda's own
parameter (`:232-234`). The rebinder is the internal `ExpressionVisitor` `ParameterReplacer`
(`Domain/Specifications/ParameterReplacer.cs:24`, static `Replace` with a `ReferenceEquals`
short-circuit at `:34`/`:40`, `VisitParameter` at `:44`), shared with the Application layer through
`InternalsVisibleTo` (`:18-23`). The portability rationale is in the XML docs at
`Specification.cs:58-75`, the Cosmos sentence quoted in the body at `:66-69`, the per-instance caching
rationale at `:71-75`, and the lazy fields at `:90`/`:93-95`, `:116`/`:119-121`, `:139`/`:142-143`.
`ParameterReplacer.cs:12-15` states the same avoidance. **Fluent forms:** `SpecificationExtensions`
(`Domain/Specifications/SpecificationExtensions.cs:36`) declares an
`extension<TEntity, TIdentifierType>(ISpecification<...> specification)` block (`:38`) exposing `And`
(`:54`), `Or` (`:74`), and `Not` (`:91`). `Website/docs-src/onboarding/group-03-querying-specifications.md:17`
documents the same mechanism. `Website/docs-src/governance/common-ArchitectureScorecard.md` (Rubric 2)
cites Specification composition positively; its inline anchors are not relied on here.
**Composition call sites, five, in two applications, each feeding a database read:** (1)
`SessionsController.cs:135` evaluates `publicSpecification.And(speakerResult.Value!)` inside
`BuildPagedSessionSpecificationAsync` (`:113`, span `:113-135`), whose result is the `specification:`
argument (`:195`) of the paged `QueryService.GetAllAsync(` call at `:192`; the never-substitute
rationale is in that method's remarks at `:108-110`. (2)
`.../Conference.API/Controllers/Speakers/SpeakersController.cs:186` ANDs the public-speaker
specification with the event-scoped filter, feeding `GetAllAsync` at `:190` as its `specification:`
argument at `:193`. (3) `.../Conference.Application/Common/PublicConferenceVisibility.cs:149` ANDs
`PublicSessionStatusSpecification` with an `InlineSpecification` event scope, and the composed
specification feeds the spec-taking projecting `ListAsync` at `:154` (in `GetEligibleSessionIdsAsync`,
`:141`, backing `GetVisibleSpeakerIdsAsync` at `:104`). (4)
`MMCA.Store/.../Catalog.API/Controllers/ReviewsController.cs:106` passes
`new ReviewsByProductSpecification(productId).And(new PublishedReviewsSpecification())` as the
`specification:` argument of `publicQueryService.GetAllAsync` (`:105`). (5)
`MMCA.Store/.../Catalog.Application/Reviews/DomainEventHandlers/ProductReviewChangedHandler.cs:111`
passes the same pair to the projecting `ListAsync` (`:110`, projection `review => review.Rating` at
`:112`) inside `RecomputeAsync` (`:86`). The Store specifications are
`Catalog.Application/Reviews/Specifications/ReviewsByProductSpecification.cs:13` and
`.../PublishedReviewsSpecification.cs` (`Criteria` override at `:17`). Grep of `MMCA.ADC/Source`,
`MMCA.Store/Source`, and `MMCA.Helpdesk/Source` for `.And(`/`.Or(`/`.Not(` and
`new And|Or|NotSpecification` returns exactly those five `.And(` hits; `Or` and `Not` have no consumer
call site and MMCA.Helpdesk composes nothing. The specification-first `ListAsync` has six consumer call
sites: `PublicConferenceVisibility.cs:78` and `:154`, `ProductReviewChangedHandler.cs:110`,
`Reviews/UseCases/Submit/SubmitReviewHandler.cs:43`,
`Reviews/UseCases/Eligibility/GetReviewEligibilityHandler.cs:47`, and Store
`Identity.Application/Users/Administration/UserAdministrationService.cs:68`.
The snippet quotes `PublicSessionStatusSpecification`
(`MMCA.ADC/.../Conference.Application/Sessions/Specifications/PublicSessionStatusSpecification.cs:21`,
`StatusCriteria` `:24`, `Criteria` override `:28`); the speaker scope is the `Session.Id IN (...)`
`InlineSpecification` built by `GetSessionsBySpeakerFilterHandler`
(`.../Sessions/UseCases/GetSessionsBySpeakerFilter/GetSessionsBySpeakerFilterHandler.cs:42-43`).
`OwnedByUserSpecification<TEntity, TIdentifierType>`
(`Domain/Specifications/OwnedByUserSpecification.cs:20`), criteria `e => e.CreatedBy == UserId`
(`:29-30`), constrained to the concrete `AuditableBaseEntity<TIdentifierType>` (`:12-16`, `:22`).
**Pipeline and filtering:** `query.Where(parameters.Criteria)` at
`Application/Services/Query/EntityQueryPipeline.cs:74` and `:149`; `MaxUnboundedResultLimit` (1000) at
`:23`, applied via `Take` at `:99`/`:195`/`:250`. `QueryFilterService` registry
(`Application/Services/Filtering/QueryFilterService.cs:32-48`, entries `:35-47`) holds seven built-in
strategies (`String`/`Bool`/`Int`/`Long`/`DateTime`/`Decimal`/`Guid`); an eighth,
`StronglyTypedIdFilterStrategy` (`StronglyTypedIdFilterStrategy.cs:24`), is built on first use and
memoized by `ResolveStrategy` (`QueryFilterService.cs:406-417`, `TryCreate` at `:414`).
`EntityQueryService` overloads are `public virtual` (`EntityQueryService.cs:262`, `:283`); "Step 1:
Validate" `:296` (`Result.Combine` `:297`), "Step 2: Execute the query pipeline" `:316`, "Step 3: Shape
output to requested fields" `:363`, `BuildPaginationMetadata` `:608` (called `:368`, attached `:377`).
`IQueryableExecutor` (`Application/Interfaces/Infrastructure/Persistence/IQueryableExecutor.cs:7`,
`Include` `:14`, `AsSplitQuery` `:26`, `ToListAsync` `:34`, `CountAsync` `:41`); MMCA.Common.Application
has zero `using Microsoft.EntityFrameworkCore`.
**Read contract** (`Application/Interfaces/Infrastructure/Persistence/IRepository.cs`):
`IEntityReader` `:21` (`GetByIdAsync` `:26`/`:31`, `GetByIdsAsync` `:48`, `ExistsAsync` `:56`/`:62`);
`IEntityQuerier` `:80` (`GetAllAsync` `:85`, `GetProjectedAsync` `:105`, `FirstOrDefaultAsync(where)`
`:134`, `FirstOrDefaultAsync(specification)` `:150`, `CountByAsync` `:169`, `SumByAsync` `:186`,
`FindIncludingDeletedAsync` `:217`, `GetAllForLookupAsync` `:224`, `CountAsync` `:231`/`:234`,
`CountAsync(specification)` `:245`, `ListAsync(specification)` `:262`, `ListAsync<TResult>` `:281`,
`AnyAsync` `:293`, `GetPageByCursorAsync` `:318`); the two `FirstOrDefaultAsync` overloads carry RS0026
suppressions at `:133`/`:149`. `IReadRepository` `:332` composes both halves and alone declares
`Table`/`TableNoTracking`/`TableNoTrackingSingleQuery`/`TableNoTrackingSplitQuery` (`:338`, `:341`,
`:344`, `:347`). `IUnitOfWork` hands out only the composites (`IUnitOfWork.cs:19`, `:29`); the
container registers only the open generic `IRepository<,>`
(`Infrastructure/DependencyInjection.cs:128`); `UnitOfWork.GetReadRepository` (`Infrastructure/Persistence/UnitOfWork.cs:68`)
resolves and caches in `_repositories` (`:34`, `:73-80`).
**Build gate:** `RawQueryableConventionTestsBase.ApplicationLayer_DoesNotUseRawQueryableSurfaces`
(`Hosting/MMCA.Common.Testing.Architecture/Bases/Cqrs/RawQueryableConventionTestsBase.cs:61`), regex
`:103`, rationale `:5-12`/`:85`, textual-scan limits `:13-23`, `AllowedFiles` ratchet `:38`/`:24-27`.
Subclasses: MMCA.Store with an empty `AllowedFiles`
(`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Cqrs/RawQueryableConventionTests.cs:9`,
`:14`), MMCA.Common (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Cqrs/RawQueryableConventionTests.cs:13`,
`:25`, six files `:28-36`), MMCA.ADC
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Cqrs/RawQueryableConventionTests.cs:11`,
`:33`, nine files `:37-57`); MMCA.Helpdesk has no subclass.
**Editorial removal (carried forward):** the two adoption-status passages (the "honest part"
paragraphs in the contract section and the "Half the composition surface still has no consumer"
trade-off) were removed from the body at the author's direction, along with the recap clause that
echoed them. Do not re-add them on a future pass.
**Consumption of the narrow interfaces:** MMCA.ADC declares `IEntityReader`/`IEntityQuerier` 44 times
across 27 files (Grep count: 43 in 26 Application files plus one API controller local,
`Conference.API/Controllers/Sessions/SessionSelectionController.cs:142`), among them `PublicConferenceVisibility.cs:40`, `:75`,
`:126`, `:151`, `SessionAssetAccessService.cs:32`, `:65`, `:92`, `:125`,
`Conference.Application/Users/IntegrationEventHandlers/UserRegisteredHandler.cs:149`/`:186`,
`SessionRoomScheduling.cs:45`, `Engagement.Application/SessionQuestions/UseCases/ToggleUpvote/ToggleUpvoteHandler.cs:158`,
`LivePolls/UseCases/CastVote/CastVoteHandler.cs:123`/`:144`,
`Points/UseCases/SetLeaderboardParticipation/SetLeaderboardParticipationHandler.cs:145`, and
`CheckIns/Services/CheckInProcessor.cs:202`. MMCA.Store carries four:
`Identity.Application/Customers/CustomerService.cs:14` and `Identity.Application/Users/AuthenticationService.cs:49`
(both private readonly fields assigned from `GetReadRepository`),
`Identity.Application/Users/DomainEventHandlers/UserRegisteredHandler.cs:131` and
`Catalog.Application/Categories/UseCases/AssignParentCategory/CategoryAssignParentUpdateHandler.cs:120`
(helper parameters). MMCA.Helpdesk carries one,
`Tickets.Application/Tickets/UseCases/GetById/GetTicketByIdHandler.cs:24`, with its reason at `:22`.
Every holder is assigned from `GetReadRepository<...>()` by implicit reference conversion; nothing
constructor-injects a narrow interface. The read-only/compose convention lives in each consumer's
`AGENTS.md` (`MMCA.ADC/AGENTS.md:107`, `MMCA.Store/AGENTS.md:106`), which each `CLAUDE.md` imports
(`@AGENTS.md`, line 3).
**ADR-055 state:** `Website/docs-src/adr/055-repository-and-specification-contract.md` carries the
2026-08-18 revision (`:311`), the 2026-08-21 revision (`:474`), the 2026-08-31 revision (`:525`, "The
querier carries five more members" `:529`, "MMCA.Helpdesk narrows too" `:556`), a 2026-10-01
revision (`:580`) recording the then 40-site/23-file ADC count and the five composing call sites, and
a 2026-10-06 revision (`:612`) recording the criteria-only `RejectShaped` rule and the 44-site/27-file
ADC count; Status block `:34`. The Decision section cites Store `AuthenticationService.cs:49`
(`:209`), matching source; `:54` survives only inside the historical 2026-10-01 revision (`:588`).*

- Full series index: https://ivanball.github.io/writing.html
