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
Composition is live
today, in nine consumer read paths across two applications. Six are in ADC: the paged sessions read
ANDs the public-session filter with the speaker-scoped one rather than substituting, because dropping
the public filter for a speaker-scoped request would leak non-accepted sessions to non-privileged
callers; the paged speakers read ANDs the public-speaker filter with an event-scoped one for the same
reason; a shared visibility helper ANDs the public-session status rule with an inline event-scope
predicate before projecting session ids; the organizer user roster turns the grid's signed-in
filter into a specification (an id `Contains` over the accounts holding a live session), negates it
with `.Not()` for the not-signed-in case, and ANDs it with any specification the caller already
supplied; and the conference reader behind ADC's MCP tools composes on two paths, ANDing the same
public-session filter with an event scope when it lists an event's sessions, and chaining the
public-session, speaker-session and event filters with two `.And()` calls when it returns a speaker's
sessions. Three are in MMCA.Store. The public product-reviews endpoint and the domain-event
handler that recomputes a product's rating both AND a by-product review specification with a
published-reviews one, and the storefront product read is itself a `QuerySpecification` that folds
its optional search, category and on-sale filters into its own `Criteria` with `.And()`, so only the
filters a request asks for reach the predicate and the shaped specification is never an operand.
Each composed `Criteria` reaches the database as a single server-side `WHERE`.
That is thirteen composing operations on twelve lines, twelve fluent `.And()` calls and one fluent
`.Not()`, and the hand-built `new AndSpecification<...>(a, b)` form appears nowhere in the three
consumer repositories. Thirteen operations in two applications is a narrow sample, though
(MMCA.Helpdesk composes nothing), and `Or` ships without a caller.

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
// specification, a Session.Id IN (...) filter over the SessionSpeaker join) arrives as a Result; once
// unwrapped it is ANDed with the public filter, never substituted for it.
if (!speakerResult.TryGetValue(out var speakerSpecification))
    return publicSpecification;

return publicSpecification is null
    ? speakerSpecification
    : publicSpecification.And(speakerSpecification);
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
specification scopes the page, expression-predicate aggregates that keep the arithmetic in the
database (`CountByAsync` and `SumByAsync`), and the soft-delete-aware `FindIncludingDeletedAsync`,
which returns the matching rows split into active and soft-deleted halves so a create handler can
reactivate a soft-deleted row instead of inserting a duplicate. The
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
carries no Roslyn dependency, and this rule does not use the IL reader the package's call-graph rules
use), and its limits are documented on the rule itself. Existing violations go into an `AllowedFiles`
list used as an adoption ratchet, so new code is clean immediately while the list shrinks, and an entry
that no longer matches a raw-queryable use fails the rule as stale, so the ratchet can only tighten. The
rule is opt-in per repository by subclassing the base, and all four repositories subclass it:
MMCA.Common and MMCA.ADC with an allowlist, MMCA.Store with an empty `AllowedFiles` (its Application
layer had zero raw-queryable uses at adoption), and MMCA.Helpdesk with an empty one on purpose, because
an entry there would name the seed's own files and cover nothing in a module an adopter scaffolds.

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
  variable indirection or an alias that re-exposes a queryable. All four repositories subclass the rule,
  but a new repository is scanned only once it subclasses the base too. The allowlisted files are real
  coupling, not paperwork: each one would need rework if its module moved behind a transport boundary.

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

*Notes (re-verified 2026-11-25 against MMCA.Common v1.319.0; ADC, Store and Helpdesk read at current
`main`. Anchors marked "read this run" were opened in this pass; the 2026-11-25 audit confirmed the
other sixteen claims, and anchors it did not move are carried from the 2026-10-29 pass):
**2026-11-25 corrections (MMCA.Common v1.319.0):** (a) the composition paragraph moves from seven
read paths to nine and from ten call sites to thirteen operations on twelve lines (twelve `.And()`,
one `.Not()`). The two new ADC paths are in
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Mcp/ConferenceMcpReader.cs` (read this
run): `ListSessionsAsync` (`:102`) resolves the public-session filter from
`GetPublicSessionFilterQuery` (`:127-128`) and ANDs it with `InEvent(...)` at `:133`; the speaker
detail read resolves the public-session and by-speaker filters (`:272-274`) and chains
`publicSessions.And(speakerSessions).And(InEvent(...))` at `:280`; both feed `ReadSessionsAsync`
(`:426`), which passes the specification to `sessions.GetAllAsync` (`:430-438`, `specification:` at
`:433`). The audit reports `Mcp:Enabled` true in Conference.Service `appsettings.json:103-104`; this
pass did not read the production override, so the body says "live today", not "live in production".
(b) MMCA.Helpdesk subclasses the raw-queryable rule
(`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/Cqrs/RawQueryableConventionTests.cs:15`,
`Map` `:17`, `AllowedFiles` deliberately not overridden with the reason at `:9-12`, read this run), so
all four repositories run it; the contract paragraph and the trade-off bullet are restated. (c) The
textual-scan parenthetical follows the base's own words: the package "deliberately carries no Roslyn
dependency (this rule does not use the IL reader the call-graph rules use)"
(`RawQueryableConventionTestsBase.cs:15-16`); the earlier "no Roslyn or IL dependency" wording
overstated it. (d) The stale-entry clause comes from the `AllowedFiles` summary (`:37-39`) and the
stale check (`:97-100`, message `:100`). ADR-055 records (a) and (b) in its Revision (2026-11-23)
(`055-repository-and-specification-contract.md:802`, items `:807-812` and `:846-854`).
**Earlier passes (carried):** 2026-10-29 added the storefront `QuerySpecification` path and the
`FindIncludingDeletedAsync` wording; 2026-10-22 added the organizer roster `.And()`/`.Not()` path;
2026-10-08 added the criteria-only rule and `QuerySpecification`; 2026-10-02 narrowed the public
visibility rule to the `GetPublicSessionFilterHandler` result and added the fail-closed owner gate and
the response-contract filter check.
**Public filter path (2026-10-29 anchors, not re-read):** `SessionsController.GetReadSpecificationAsync`
(`MMCA.ADC/.../Conference.API/Controllers/Sessions/SessionsController.cs:80`, read this run) returns
`null` for a privileged caller and otherwise the specification from `GetPublicSessionFilterHandler`,
which calls `CrossSourceSpecification.BuildAsync`
(`MMCA.ADC/.../Conference.Application/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterHandler.cs:29-34`)
with `principalPredicate: e => e.IsPublished` (`:32`) and `localPredicate:
PublicSessionStatusSpecification.StatusCriteria` (`:34`); `BuildAsync`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Specifications/CrossSourceSpecification.cs:39`)
returns an `InlineSpecification` (`:62`). The question-answer controllers bind
`OwnedByUserSpecification` per caller with the `Organizer` bypass and pair it with
`RequireResolvableOwner`; ADR-055's Revision (2026-11-23) re-anchors `EventQuestionAnswersController.cs`
at override `:111-116`, `OwnershipHelper` `:112`, `OwnedByUserSpecification` `:115` (`:865-866`).
The filter contract: `EntityQueryService.FieldContract` is `QueryFieldContract.For<TEntityDTO>()`
(`Application/Services/EntityQueryService.cs:123`, read this run) and is passed to
`QueryFilterService.ValidateFilters` in Step 1 (`:304`); that overload (`QueryFilterService.cs:183`,
read this run) validates against the contract before the entity, and `IsAdmissibleKey` (`:217`)
refuses a client-authored navigation path or a field the contract does not declare and caps
server-mapped depth.
`ISpecification<TEntity, TIdentifierType>` exposes `Criteria`
(`Domain/Interfaces/ISpecification.cs:17`) and `IsSatisfiedBy` (`:22`); the abstract base's `Criteria`
is a get-only abstract property (`Domain/Specifications/Specification.cs:23`) and `IsSatisfiedBy`
lazy-compiles and caches the delegate in a private field (`:25-27`, `_compiled ??=` at `:32`, read this
run).
**Composition mechanism** (`Specification.cs`, read this run unless noted): `AndSpecification`
(`:80`), `OrSpecification` (`:106`), and `NotSpecification` (`:131`) use no `Expression.Invoke` at
all. Each constructor runs `SpecificationComposer.RejectShaped` (`:87-88`, `:113-114`, `:137`;
`RejectShaped` at `:164`) and delegates to the internal `SpecificationComposer` (`:150`): its
`Combine` (`:197`, per ADR-055 `:859-860`) takes the LEFT lambda's existing parameter
(`var parameter = left.Parameters[0];`, `:209`), rebinds the right-hand body onto it with
`ParameterReplacer.Replace` (`:213`), and joins the two bodies with `Expression.AndAlso`/`OrElse`;
`Negate` (`:223`, per ADR-055 `:860`) wraps the inner body in `Expression.Not` and keeps that lambda's
own parameter. The lazy composed criteria are assigned with `??=` at `:93`, `:119` and `:142`. The
Cosmos sentence quoted in the body is at `:68`. The rebinder is the internal `ExpressionVisitor`
`ParameterReplacer` (`Domain/Specifications/ParameterReplacer.cs:24`, 2026-10-29 anchor).
**Fluent forms:** `SpecificationExtensions` (`Domain/Specifications/SpecificationExtensions.cs:36`)
declares an `extension<TEntity, TIdentifierType>(ISpecification<...> specification)` block (`:38`)
exposing `And` (`:54`), `Or` (`:74`), and `Not` (`:91`) (2026-10-29 anchors).
`Website/docs-src/onboarding/group-03-querying-specifications.md:17` documents the same mechanism.
`Website/docs-src/governance/common-ArchitectureScorecard.md` (Rubric 2) cites Specification
composition positively; its inline anchors are not relied on here.
**Composition call sites, thirteen operations on twelve lines, each feeding a database read** (Grep of
`MMCA.ADC/Source`, `MMCA.Store/Source` and `MMCA.Helpdesk/Source` for `.And(`/`.Or(`/`.Not(` and
`new And|Or|NotSpecification`, run this pass: seven ADC lines, five Store lines, none in Helpdesk, no
`.Or(` and no hand-built combinator anywhere): (1) `SessionsController.cs:140` evaluates
`publicSpecification.And(speakerSpecification)` inside `BuildPagedSessionSpecificationAsync` (`:118`),
after the `TryGetValue` unwrap of the speaker scope (`:135`); its result is the `specification:`
argument (`:196`) of the paged `QueryService.GetAllAsync(` call at `:193`; the never-substitute
rationale opens that method's remarks at `:113`. (2)
`.../Conference.API/Controllers/Speakers/SpeakersController.cs:181` ANDs the public-speaker
specification with the event-scoped filter, feeding `GetAllAsync` at `:185` as its `specification:`
argument at `:188` (never-substitute remark at `:137`). (3)
`.../Conference.Application/Common/PublicConferenceVisibility.cs:148` ANDs
`PublicSessionStatusSpecification` with an `InlineSpecification` event scope, and the composed
specification feeds the spec-taking projecting `ListAsync` at `:153` (in `GetEligibleSessionIdsAsync`,
`:140`, backing `GetVisibleSpeakerIdsAsync` at `:103`). (4) and (5) `ConferenceMcpReader.cs:133` and
`:280` (two chained operations on the second line), above. (6)
`MMCA.ADC/.../Identity.Application/Users/UserListEntityQueryService.cs:111` ANDs the caller's
specification with the signed-in one, feeding `base.GetAllAsync`. (7) The same file calls
`holdsLiveSession.Not()` at `:172`. (8) `MMCA.Store/.../Catalog.API/Controllers/ReviewsController.cs:106`
passes `new ReviewsByProductSpecification(productId).And(new PublishedReviewsSpecification())` as the
`specification:` argument of `publicQueryService.GetAllAsync`. (9)
`MMCA.Store/.../Catalog.Application/Reviews/DomainEventHandlers/ProductReviewChangedHandler.cs:111`
passes the same pair to the projecting `ListAsync` inside `RecomputeAsync`. (10) to (12)
`MMCA.Store/.../Catalog.Application/Products/UseCases/Storefront/StorefrontProductsSpecification.cs:72`,
`:78` and `:84` fold the search, category and on-sale `InlineSpecification` filters into the
specification's own `Criteria`, which feeds `CountAsync` and `ListAsync` in
`GetStorefrontProductsHandler.cs`. All line numbers in this paragraph were read this run.
The snippet quotes `PublicSessionStatusSpecification`
(`MMCA.ADC/.../Conference.Application/Sessions/Specifications/PublicSessionStatusSpecification.cs:21`,
`StatusCriteria` `:24`, `Criteria` override `:28`, 2026-10-29 anchors) and the tail of
`BuildPagedSessionSpecificationAsync` (`SessionsController.cs:135-140`, read this run; the ternary is
`:138-140`, matching ADR-055 `:866-867`); the speaker scope is the `Session.Id IN (...)`
`InlineSpecification` built by `GetSessionsBySpeakerFilterHandler`
(`.../Sessions/UseCases/GetSessionsBySpeakerFilter/GetSessionsBySpeakerFilterHandler.cs:42-43`).
`OwnedByUserSpecification<TEntity, TIdentifierType>`
(`Domain/Specifications/OwnedByUserSpecification.cs:20`), criteria `e => e.CreatedBy == UserId`
(`:29-30`), constrained to the concrete `AuditableBaseEntity<TIdentifierType>` (`:12-16`, `:22`).
**Pipeline and filtering:** `query.Where(parameters.Criteria)` at
`Application/Services/Query/EntityQueryPipeline.cs:74` and `:149`; `MaxUnboundedResultLimit` (1000) at
`:23`, applied via `Take` at `:99`/`:195`/`:250` (2026-10-29 anchors, audit-confirmed).
`QueryFilterService` registry (`Application/Services/Filtering/QueryFilterService.cs:34-51`) holds
eight built-in strategies (`String`/`Bool`/`Int`/`Long`/`DateTime`/`Decimal`/`Guid`, nullable forms
included, plus the `Email` value object); a ninth, `StronglyTypedIdFilterStrategy`, is built on first
use and memoized by `ResolveStrategy` (`QueryFilterService.cs:413`, `TryCreate` at `:421`, read this
run). `EntityQueryService` overloads are `public virtual` (`EntityQueryService.cs:262`, `:283`); "Step
1: Validate" `:296` (`Result.Combine` `:300`), "Step 2: Execute the query pipeline" `:319`, "Step 3:
Shape output to requested fields" `:364`, `BuildPaginationMetadata` `:730` (called `:369`), all read
this run. `IQueryableExecutor`
(`Application/Interfaces/Infrastructure/Persistence/IQueryableExecutor.cs:7`, `Include` `:14`,
`AsSplitQuery` `:26`, `ToListAsync` `:34`, `CountAsync` `:41`); MMCA.Common.Application has zero
`using Microsoft.EntityFrameworkCore`.
**Read contract** (`Application/Interfaces/Infrastructure/Persistence/IRepository.cs`, 2026-10-29
anchors, audit-confirmed): `IEntityReader` `:21` (`GetByIdAsync` `:26`/`:31`, `GetByIdsAsync` `:48`,
`ExistsAsync` `:56`/`:62`); `IEntityQuerier` `:80` (`GetAllAsync` `:85`, `GetProjectedAsync` `:105`,
`FirstOrDefaultAsync(specification)` `:150`, `CountByAsync` `:169`, `SumByAsync` `:186`,
`FindIncludingDeletedAsync` `:217` (active and soft-deleted halves, BR-135 rationale `:199-202`),
`GetAllForLookupAsync` `:224`, `CountAsync` `:231`/`:234`, `CountAsync(specification)` `:245`,
`ListAsync(specification)` `:262`, `ListAsync<TResult>` `:281`, `AnyAsync` `:293`,
`GetPageByCursorAsync` `:318`). `IReadRepository` `:332` composes both halves and alone declares
`Table`/`TableNoTracking`/`TableNoTrackingSingleQuery`/`TableNoTrackingSplitQuery` (`:338`, `:341`,
`:344`, `:347`). `IUnitOfWork` hands out only the composites (`IUnitOfWork.cs:19`, `:29`); the
container registers only the open generic `IRepository<,>`.
**Build gate** (read this run):
`RawQueryableConventionTestsBase.ApplicationLayer_DoesNotUseRawQueryableSurfaces`
(`Hosting/MMCA.Common.Testing.Architecture/Bases/Cqrs/RawQueryableConventionTestsBase.cs:64`,
`[Fact]` `:63`), member-access regex `:121`, whole-line `//` skip `:111`, extraction rationale
`:5-12`/`:103`, textual-scan limits `:13-24`, `AllowedFiles` ratchet `:41`/`:26-28`, stale rule
`:37-39`/`:97-100`. Subclasses: MMCA.Helpdesk (`:15`, empty `AllowedFiles` by design, above), MMCA.ADC
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Cqrs/RawQueryableConventionTests.cs:11`,
`AllowedFiles` `:16`, six files `:20-30`, list closing `:31`), MMCA.Common (six files, per ADR-055
`:817-818`) and MMCA.Store (empty `AllowedFiles`; ADR-055 `:817-821` counts twelve allowlisted files
across the four, all in Common and ADC).
**Editorial removal (carried forward):** the two adoption-status passages (the "honest part"
paragraphs in the contract section and the "Half the composition surface still has no consumer"
trade-off) were removed from the body at the author's direction, along with the recap clause that
echoed them. Do not re-add them on a future pass.
**Consumption of the narrow interfaces:** per ADR-055 Revision (2026-11-23) item 5 (`:840-845`),
`IEntityReader<` / `IEntityQuerier<` appear seventy-six times across forty-two files under
`MMCA.ADC/Source` (forty-one Application files plus the API controller local at
`SessionSelectionController.cs:143`); the audit's own Grep returned the same 76 across 42. MMCA.Store
carries five holders and MMCA.Helpdesk one (`GetTicketByIdHandler.cs:24`), per ADR-055 `:869-872`.
Every holder is assigned from `GetReadRepository<...>()`; nothing constructor-injects a narrow
interface. The read-only/compose convention lives in each consumer's `AGENTS.md` (Store
`MMCA.Store/AGENTS.md:109`, read this run; ADC `MMCA.ADC/AGENTS.md:120`, the "Read-only data access
states what it needs" bullet, line number from the audit), which each `CLAUDE.md` imports
(`@AGENTS.md`, line 3).
**ADR-055 state** (`Website/docs-src/adr/055-repository-and-specification-contract.md`, headings read
this run): Status `:3`; Revisions (2026-08-18) `:374`, (2026-08-21) `:537`, (2026-08-31) `:588`,
(2026-10-01) `:643`, (2026-10-06) `:675`, (2026-10-21) `:709`, (2026-10-26) `:750`, (2026-10-28)
`:762`, and (2026-11-23) `:802`, which records all four repositories running the raw-queryable rule
(`:807-812`), the twelve-file allowlist total (`:817-821`), the 76-site/42-file ADC count
(`:840-845`), the twelve composing call lines (`:846-854`) and the re-verified anchors (`:855-874`).*

- Full series index: https://ivanball.github.io/writing.html
