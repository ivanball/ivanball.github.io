# 18. ADC Conference - Application & Use Cases

**What this chapter covers.** This is the *application layer* of the Conference module, the largest
single application assembly in the codebase (the group holds over 200 types). It sits between the
REST/gRPC edge ([G20, Conference API & gRPC](group-20-conference-api-grpc.md)) and the domain
aggregates ([G17, Conference Domain](group-17-conference-domain.md)), and it is where the conference's
*use cases* actually live: create an event, publish it, add a room or a speaker, import the whole
agenda from Sessionize.com, and run the AI-assisted analytics that help organizers decide which
session proposals to accept. Everything here is **engine-agnostic and framework-light**: it depends on
the abstractions introduced by `MMCA.Common.Application` (handlers, mappers, validators, query
services, navigation populators) and on the Conference domain, but never on EF Core, ASP.NET, or a
broker SDK directly. Read the primer's tour of
[CQRS and Vertical Slice](00-primer.md#2-architectural-styles-this-codebase-commits-to) first; this
chapter shows those styles at full scale in one module.

## The vertical-slice anatomy of a use case

Open any feature folder under `Sessions/UseCases/`, `Events/UseCases/`, `Speakers/UseCases/`,
`Categories/UseCases/`, or `Questions/UseCases/` and you will find the same **cohesive slice**: a
command or query record, its handler, its FluentValidation validator, and (for creates) a request
record plus a request mapper, all co-located. Adding a feature means adding a folder, not threading an
edit through horizontal `Services/`, `Validators/`, and `Repositories/` directories. This is the
[Vertical Slice](00-primer.md#2-architectural-styles-this-codebase-commits-to) discipline made
physical. `[Rubric §5, Vertical Slice]` (assesses whether a feature is one navigable unit rather than
scattered horizontally), and the folder layout is the evidence.

A **command** mutates and returns a [`Result`](group-01-result-error-handling.md#result); a **query**
is side-effect-free and returns a `Result<TDTO>`. Both implement the Common contracts
[`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
and [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult),
so every handler in this assembly flows through the same **decorator pipeline** (Logging, Caching,
Transactional, then the handler) without knowing it exists. Commands that change cached read data
implement [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); commands that must be
atomic implement [`ITransactional`](group-05-cqrs-pipeline.md#itransactional). The controller injects
the handler interface and calls `HandleAsync`; the concrete type is invisible to it. `[Rubric §6,
CQRS & Event-Driven]` (assesses a clean command/query split through well-defined handler boundaries):
this module is the canonical demonstration, dozens of single-responsibility handlers, each one slice
wide, all dispatched uniformly.

The CRUD-shaped handlers (`CreateEventHandler`, `CreateSessionHandler`, `CreateSpeakerHandler`,
`CreateQuestionHandler`, `CreateConferenceCategoryHandler`, and the matching
`Update*`/`Delete*`/`Add*`/`Remove*` families) share one shape: they delegate object construction to an
[`IEntityRequestMapper`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype)
(which runs the validator and the domain `Create(...)` factory, returning `Result<TEntity>`), then
persist through [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and map the saved entity
back to a DTO with an
[`IEntityDTOMapper`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype).
The handler owns *orchestration only* (load, validate, persist, map, log) while the business rule
("an event's end date cannot precede its start date") lives in the domain factory and the invariant
classes. The richer handlers (`UpdateSessionHandler`, `UpdateEventHandler`) add optimistic-concurrency
stamping (`SetOriginalRowVersion`), immutable-field guards that return
[`Error`](group-01-result-error-handling.md#error)`.UnprocessableEntity`, and cross-aggregate reads
(fetching the parent `Event` read-only to check a room-vs-event constraint), concerns that genuinely
need orchestration context and are deliberately kept out of the entity.

## Manual mapping, validation rule fragments, and authorization specifications

Three sibling families recur across every aggregate. **DTO mappers** (`SessionDTOMapper`,
`EventDTOMapper`, `SpeakerDTOMapper`, `RoomDTOMapper`, `CategoryItemDTOMapper`, and the
question-answer / category-item link mappers) implement the Common mapper contract and assign each
field *by hand*, the deliberate choice of ADR-001 (manual/Mapperly mapping over reflection-based
AutoMapper) so a renamed property is a compile error, not a silent null. `[Rubric §9, API & Contract
Design]` (assesses explicit, traceable contracts): the mapping is code you can read and test, not
convention magic.

**Validation** is composed, not inherited. Small generic rule fragments (`EventDateRangeRules<T>`,
`EventNameRules<T>`, `RoomCapacityRules<T>`, `SessionTitleRules<T>`, `SpeakerFirstNameRules<T>`,
`CategoryItemNameRules<T>`, and a dozen siblings) each encapsulate one validated concern as an
`AbstractValidator<T>` taking a property selector, and the per-use-case validators
(`EventUpdateRequestValidator`, `SessionCreateRequestValidator`, and the rest) pull them together with
FluentValidation's `Include(...)`. The pattern mirrors the framework's rule-fragment families in
[G06, Validation](group-06-validation.md#addressline1rulest); `EventDateRangeRules<T>` is the richest,
compiling the `StartDate` selector into a delegate and reading it inside a cross-property `Must` on
`EndDate`. `[Rubric §24, Forms, Validation & UX Safety]` and `[Rubric §1, SOLID]` (fragments compose
without an inheritance chain; a new constraint is a new fragment, touching no existing validator).

**Authorization specifications** (`PublishedEventSpecification`, `OwnEventQuestionAnswerSpecification`,
`OwnSessionQuestionAnswerSpecification`) are
[`ISpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#ispecificationtentity-tidentifiertype)
implementations passed into the query services to *scope* what a caller may read (an anonymous visitor
sees only published events; a speaker sees only their own answers). This keeps the authorization
predicate a reusable, testable expression rather than an `if` buried in a controller. `[Rubric §11,
Security]` (assesses authorization that is data-scoped, not just endpoint-gated). The public-session
visibility rule is produced by the [`GetPublicSessionFilterHandler`](#getpublicsessionfilterhandler)
use case via the framework's
[`CrossSourceSpecification`](group-03-querying-specifications.md#crosssourcespecification) helper
(`MMCA.ADC.Conference.Application/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterHandler.cs:26`),
because `Session` may live in a different data source from `Event` (ADR-018): the helper resolves the
published `Event` ids from SQL Server and returns a translatable `Session.EventId IN (...)` filter,
ANDed with a status check, so the published-event check is no longer a navigation join.

## Query services, navigation populators, and the composition root

Read paths do not get bespoke handlers for the common cases; they go through the framework's generic
[`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
which supplies filtering, sorting, paging, and field projection. The one local specialization is
`SpeakerEntityQueryService`, a thin subclass that adds a property map so API consumers can sort/filter
on the computed `FullName` while the pipeline translates it to `(FirstName + " " + LastName)` in SQL.
Eager-loading of child graphs is delegated to per-aggregate
[`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity)
implementations (`EventNavigationPopulator`, `SessionNavigationPopulator`, `SpeakerNavigationPopulator`,
`ConferenceCategoryNavigationPopulator`), which encapsulate which navigations to include and how to
batch-load cross-source relationships (ADR-002); child entities use the framework's
[`NullNavigationPopulator<TEntity>`](group-11-navigation-populators.md#nullnavigationpopulatortentity)
because they are never the root of a full graph load.

All of this is wired by `DependencyInjection`, the module's **composition root**
(`MMCA.ADC.Conference.Application/DependencyInjection.cs:34`). It explicitly binds the closed generics
Scrutor cannot infer (each aggregate's query service, navigation populator, and delete handler,
`DependencyInjection.cs:46-90`) and then calls `ScanModuleApplicationServices<ClassReference>()`
(`DependencyInjection.cs:100`) to discover the "many small things" (every handler, mapper, validator,
and event handler) by convention. `AssemblyReference` and `ClassReference` are the marker types that
anchor that scan. `[Rubric §7, Microservices Readiness]` (assesses clean, explicit module boundaries):
every internal concrete type is reachable only through an interface registered here, which is exactly
what lets the Conference module boot as its own service host. `[Rubric §33, Developer Experience]`: one
file is the single place a new aggregate gets registered.

## Event-driven reactions: domain and integration handlers

The application layer is also where the module *reacts* to events. **Domain event handlers**
(`SessionCreatedHandler`, `SpeakerDeletedHandler`, `RoomChangedHandler`) implement
[`IDomainEventHandler<in TDomainEvent>`](group-04-events-outbox.md#idomaineventhandlerin-tdomainevent)
and run in-process after the aggregate's `SaveChangesAsync`, handling intra-module side effects (for
example cascading cleanup when a speaker is removed). The integration event handler
`UserRegisteredHandler` implements
[`IIntegrationEventHandler<in TIntegrationEvent>`](group-04-events-outbox.md#iintegrationeventhandlerin-tintegrationevent)
and is the cross-module boundary: when Identity publishes `UserRegistered` over the broker, Conference
auto-links a speaker to that user (BR-207), trying an email match first and then a unique-name fallback
for Sessionize-imported speakers whose `Email` is `null` (the public Sessionize feed omits PII),
linking only when exactly one unlinked candidate matches, and publishing `SpeakerLinkedToUser` back to
Identity on a hit
(`MMCA.ADC.Conference.Application/Users/IntegrationEventHandlers/UserRegisteredHandler.cs:59-107`). The
handler is deliberately best-effort: it runs in its own DI scope because the handler is a singleton
(`UserRegisteredHandler.cs:53`), and any non-cancellation failure is swallowed so the already-committed
registration never rolls back (`UserRegisteredHandler.cs:109-114`). The reciprocal direction (Conference
telling Identity about speaker links) flows through the
[`IMessageBus`](group-04-events-outbox.md#imessagebus) abstraction and the outbox (ADR-003), so the
application code never references MassTransit. `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §7,
Microservices Readiness]`: the module collaborates through events and interfaces, never direct
cross-module type references. `SessionBookmarkValidationService` and `EventLiveValidationService` are
the in-process implementations of the Engagement-facing contracts
([`ISessionBookmarkValidationService`](group-17-conference-domain.md#isessionbookmarkvalidationservice)
and [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice)), which
Engagement calls via gRPC when the modules run as separate services (ADR-007): the former gates session
bookmarking (BR-49/BR-91), the latter computes an event or session live window in UTC (plus the assigned
speakers and the question-moderation default) for the conference-day live layer
(`MMCA.ADC.Conference.Application/Events/EventLiveValidationService.cs:18`).

## The Sessionize import: Strategy-pattern orchestration

The single most involved use case is **importing a conference agenda from Sessionize.com**. Sessionize
returns one JSON payload covering five interdependent entity families (categories, rooms, questions,
speakers, and sessions, where sessions reference rooms and speakers and speakers reference categories).
The HTTP shape is captured by a set of deserialization records (`SessionizeResponse`, `SessionizeSession`,
`SessionizeSpeaker`, `SessionizeRoom`, `SessionizeCategory`, `SessionizeCategoryItem`,
`SessionizeQuestion`, `SessionizeQuestionAnswer`, `SessionizeLink`) confined entirely to this layer, an
**anti-corruption boundary** so a Sessionize API change never touches a domain entity.

The import is fetched through the [`ISessionizeService`](#isessionizeservice) port (implemented by the
HTTP client in [G19, Conference Infrastructure](group-19-conference-infrastructure.md#sessionizeservice))
and orchestrated by `RefreshFromSessionizeHandler`
(`MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeHandler.cs:16`).
That handler does *orchestration only*: load the `Event` with its rooms and speakers eagerly, enforce
BR-6 (a Sessionize code must be configured, `:54`) and the BR-63 five-minute throttle (`:64`), call the
external API inside a `try/catch(HttpRequestException)` that converts a network failure into an `Error`
(`:80`), then run five [`ISessionizeSyncStrategy`](#isessionizesyncstrategy) implementations in
dependency order (`CategorySyncStrategy`, `RoomSyncStrategy`, `QuestionSyncStrategy`,
`SpeakerSyncStrategy`, `SessionSyncStrategy`, `:25-32`), each carrying its work via a shared
`SessionizeSyncContext` and returning a `SessionizeSyncResult` count. Each strategy bulk-loads its entity
family in one call (no N+1), upserts via the domain's `Create`/`Update` methods, skips soft-deleted rows
(BR-136), and accumulates warnings instead of aborting on one bad record. A final
`RequestIdentityInsert()` (`:132`) lets SQL Server accept Sessionize's own integer IDs before one batched
`SaveChangesAsync`. `[Rubric §2, Design Patterns]` (Strategy solving a real Open/Closed problem: a new
entity family is a new strategy, not an edit to the orchestrator), `[Rubric §12, Performance &
Scalability]` (bulk loads plus a single save round-trip), and `[Rubric §17, DevOps & Deployment]` (the
throttle and graceful per-entity degradation make a re-import safe to run repeatedly).

## Decision support: AI scoring and content analytics

The last cluster is **session-selection decision support**, analytics that help organizers triage
proposals. `GetSessionSelectionDashboardHandler` is a *composite* query: it loads sessions, speakers,
and categories once, then computes category distribution, speaker-session overlap, content similarity,
and speaker locality, returning one dashboard DTO (the underlying queries,
`GetCategoryDistributionQuery`, `GetContentSimilarityQuery`, `GetSpeakerSessionOverlapQuery`, are also
dispatchable individually). Content similarity is computed by the pure-static
[`SessionSimilarityCalculator`](#sessionsimilaritycalculator), a weighted sum of two Jaccard indices,
category-item overlap at 60% (`SessionSimilarityCalculator.cs:11`) and span-tokenized keyword overlap at
40% (`:12`, with a `FrozenSet` stop-word filter and a three-character minimum token length), above a
tunable threshold whose default is 0.3
(`MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetContentSimilarity/GetContentSimilarityQuery.cs:6`),
flagging proposals that would compete for the same audience. `SpeakerLocalityHelper` resolves whether a
speaker is local via a category item (locality is tracked as a `CategoryItem`, not a `Speaker` field),
and the two private per-handler `StatusBucket` enums map
[SessionStatuses](group-17-conference-domain.md#sessionstatuses) into display groupings.

The flagship is **AI scoring**. `ScoreEventSessionsCommand` (handled by `ScoreEventSessionsHandler`) fans
every eligible, not-yet-scored session out to [`IAiScoringService`](#iaiscoringservice), a port
implemented in infrastructure by
[`AnthropicScoringService`](group-19-conference-infrastructure.md#anthropicscoringservice), which calls
the Anthropic Messages API. The contract is deliberately **never-throw**: `ScoreSessionAsync` returns a
`SessionScoringResult` with a `Success` flag and seven `1.0`-`10.0` sub-scores (overall, topic relevance,
description quality, novelty, actionable takeaways, depth/insight quality, credibility/experience) in
*all* cases (`IAiScoringService.cs:9,40-71`), so one bad session never aborts the scoring loop. The input
shapes are `SessionScoringInput` and `SpeakerInfo` (`IAiScoringService.cs:23-37`); the result is mapped
to a `Conference.Shared` DTO for persistence. Keeping the *port* here and the HTTP/LLM *adapter* in
infrastructure is textbook `[Rubric §3, Clean Architecture]` (the application layer depends on an
interface, never the SDK) and `[Rubric §7, Microservices Readiness]` (the AI provider is swappable behind
one interface).

Taken together, this assembly is the codebase's most complete picture of how a use case is built here: a
slice per feature, generic framework machinery for the repetitive 80% (query, validate, map, persist,
populate), and bespoke handlers reserved for the genuinely complex 20% (the Sessionize import and the
decision-support analytics), each isolated behind a port or a strategy so it can evolve, be tested, and
ultimately be extracted without disturbing the rest.

### AssemblyReference
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/AssemblyReference.cs:5` · Level 0 · class (static)

- **What it is**: a tiny static class exposing the Conference Application assembly and its short name as two `static readonly` fields, so scanners and registrars have a strongly-typed handle on this assembly.
- **Depends on**: `System.Reflection` (BCL) only.
- **Concept, the assembly-anchor type.** `[Rubric §5, Vertical Slice]` assesses whether a module is a self-contained, discoverable unit; a per-assembly anchor type is how the framework's reflection-based wiring finds "everything in the Conference Application layer" without hard-coding a namespace string. The two fields (`AssemblyReference.cs:7-8`) are `Assembly = typeof(AssemblyReference).Assembly` and `AssemblyName = Assembly.GetName().Name ?? string.Empty`, both computed once at type-load. There is a sibling anchor in every layer (see the identically-named types in the Conference API and Domain groups), so a caller can name the exact assembly it means.
- **Walkthrough**: two fields only, no methods. `Assembly` resolves the containing assembly via `typeof(this).Assembly`; `AssemblyName` reads `Assembly.GetName().Name`, defaulting to `string.Empty` when the runtime reports a null simple name.
- **Why it's built this way**: taking `typeof(AssemblyReference).Assembly` is refactor-safe (renaming the assembly or moving the file changes nothing), which is why the framework prefers an anchor type over a hard-coded `Assembly.Load("...")`.
- **Where it's used**: assembly-scoped tooling and OpenAPI/validator discovery that needs the Conference Application assembly by reference. The scan performed inside [`DependencyInjection`](#dependencyinjection) instead anchors on [`ClassReference`](#classreference) (a `typeof`-friendly type argument).

### CategoryItemSortRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/Validation/ConferenceCategoryValidationRules.cs:39` · Level 0 · class (sealed)

- **What it is**: a reusable FluentValidation rule fragment that enforces a non-negative sort order (`>= 0`) on any request field selected as an `int`.
- **Depends on**: `FluentValidation` (`AbstractValidator<T>`, NuGet), `System.Linq.Expressions` (BCL).
- **Concept introduced, the generic reusable validator rule.** `[Rubric §1, SOLID]` (single-responsibility, do-not-repeat) and `[Rubric §16, Maintainability & Evolvability]` (one place to change a constraint) both apply. Rather than re-declare the same "sort must be non-negative" check inside every create/update validator, the rule is written once as a generic `AbstractValidator<T>` that takes an `Expression<Func<T, int>>` selector (`ConferenceCategoryValidationRules.cs:42`) pointing at whichever property carries the sort value. A concrete command validator then composes this fragment against its own request shape. This is the FluentValidation "child rules / include" composition idiom applied generically.
- **Walkthrough**: a constructor `CategoryItemSortRules(Expression<Func<T, int>> selector)` (`ConferenceCategoryValidationRules.cs:42`) whose body is a single `RuleFor(selector).GreaterThanOrEqualTo(0)` with message "Sort order must be greater than or equal to 0" and error code `CategoryItem.Sort.Negative` (`ConferenceCategoryValidationRules.cs:43-44`). Stable error codes (not just messages) let clients and tests key off the failure without string-matching prose.
- **Why it's built this way**: generic over `T` so the same fragment serves the add-item and update-item request types; `sealed` because it is a leaf composition unit with no intended subclassing.
- **Where it's used**: composed by the Category use-case validators (add/update category-item commands) in this module. Sibling fragments in the same file are [`CategoryItemNameRules<T>`](#categoryitemnamerulest) and [`ConferenceCategoryTitleRules<T>`](#conferencecategorytitlerulest).

### ClassReference
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/AssemblyReference.cs:11` · Level 0 · class

- **What it is**: an empty marker class used purely as a `typeof` anchor for assembly scanning; it declares no members.
- **Depends on**: nothing first-party.
- **Concept, the scan-anchor marker.** `[Rubric §2, Design Patterns]` (assesses idiomatic registration wiring). Scrutor-style scanning APIs are commonly generic over an anchor type: `ScanModuleApplicationServices<ClassReference>()` tells the scanner "start from the assembly that contains `ClassReference`", i.e. this Application layer. The class body is empty (`AssemblyReference.cs:11`); its only job is to be a compile-time-checked stand-in for the assembly.
- **Walkthrough**: `public class ClassReference { }`, no fields, no methods.
- **Why it's built this way**: a dedicated marker keeps the scan call site refactor-safe and avoids anchoring the scan on a real domain type that might later move to another assembly.
- **Where it's used**: passed as the type argument to `ScanModuleApplicationServices<ClassReference>()` in [`DependencyInjection`](#dependencyinjection) (`DependencyInjection.cs:100`).

### SessionizeCategoryItem
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:60` · Level 0 · record (sealed)

- **What it is**: the leaf DTO for one category value from the Sessionize "View All" API (for example "Beginner" under the "Level" category, or ".NET" under "Track"): an `Id`, a `Name`, and a `Sort` order.
- **Depends on**: `System.Text.Json.Serialization` (`[JsonPropertyName]`, BCL) only.
- **Concept introduced, the external-API contract DTO.** `[Rubric §9, API & Contract Design]` (assesses explicit boundary contracts) and `[Rubric §32, Dependency & Supply-Chain]` (assesses controlling the shape of data crossing a third-party boundary). The whole `Sessionize*` family models the JSON wire format of an external system the conference is imported from. Each type is a `sealed record` with `init`-only properties defaulted to a non-null empty value (`Name { get; init; } = string.Empty`, `SessionizeModels.cs:66`), and every property carries a `[JsonPropertyName("...")]` mapping the C# name to the exact Sessionize field (`SessionizeModels.cs:62-69`). Modeling the external contract as its own dedicated, immutable type (rather than binding straight onto domain entities) is the anti-corruption discipline: the messy outside shape is captured here, then translated into the domain by the sync strategies. The rest of the `Sessionize*` records in this file share this exact shape; their sections cross-reference back here.
- **Walkthrough**: three `init` properties, `Id` (`int`, line 63), `Name` (`string`, empty default, line 66), `Sort` (`int`, line 69), each JSON-mapped. No behavior; it is a pure data-transfer record.
- **Why it's built this way**: `record` gives structural equality and immutability for free (see the [`ValueObject`](group-02-domain-building-blocks.md#valueobject) discussion of records); `init` plus non-null defaults means System.Text.Json can populate it while callers cannot mutate it afterward and never see a null string.
- **Where it's used**: nested inside [`SessionizeCategory`](#sessionizecategory)'s `Items`; consumed by the category sync path of the Sessionize import ([`CategorySyncStrategy`](#categorysyncstrategy)).

### SessionizeLink
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:126` · Level 0 · record (sealed)

- **What it is**: the DTO for one speaker social link from Sessionize: a `Title`, a `Url`, and a `LinkType` (for example "Twitter", "LinkedIn").
- **Depends on**: `System.Text.Json.Serialization` (BCL); `System.Diagnostics.CodeAnalysis` (a scoped analyzer suppression).
- **Concept**: an external-API contract DTO, the pattern taught on [`SessionizeCategoryItem`](#sessionizecategoryitem). `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: three `init` string properties, all empty-defaulted and JSON-mapped (`SessionizeModels.cs:128-136`). `Url` carries `[SuppressMessage("Design", "CA1056:URI-like properties should not be strings", ...)]` (`SessionizeModels.cs:131`) with the justification "Deserialized from Sessionize JSON": the analyzer wants a `Uri`, but the field must round-trip whatever string Sessionize sends, so the suppression is scoped and justified inline.
- **Why it's built this way**: keeping `Url` a `string` avoids `Uri` parsing failing the deserialization when Sessionize sends a non-canonical value; validation/parsing, if needed, happens after import, not at the wire boundary.
- **Where it's used**: nested inside [`SessionizeSpeaker`](#sessionizespeaker)'s `Links`.

### SessionizeQuestion
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:25` · Level 0 · record (sealed)

- **What it is**: the DTO for one custom-question definition from Sessionize: `Id`, `Question` text, `QuestionType`, and a `Sort` order.
- **Depends on**: `System.Text.Json.Serialization` (BCL) only.
- **Concept**: an external-API contract DTO ([`SessionizeCategoryItem`](#sessionizecategoryitem)). `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: four `init` properties, `Id` (`int`, line 28), `Question` (`string`, empty default, line 31), `QuestionType` (`string`, empty default, line 34), `Sort` (`int`, line 37), each JSON-mapped.
- **Where it's used**: nested inside [`SessionizeResponse`](#sessionizeresponse)'s `Questions`; imported by the question sync path of the Sessionize refresh ([`RefreshFromSessionizeCommand`](#refreshfromsessionizecommand)).

### SessionizeQuestionAnswer
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:195` · Level 0 · record (sealed)

- **What it is**: the DTO for one answer to a Sessionize custom question: a `QuestionId` and its `AnswerValue`.
- **Depends on**: `System.Text.Json.Serialization` (BCL) only.
- **Concept**: an external-API contract DTO ([`SessionizeCategoryItem`](#sessionizecategoryitem)). `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: two `init` properties, `QuestionId` (`int`, line 198) and `AnswerValue` (`string`, empty default, line 201), each JSON-mapped.
- **Where it's used**: nested inside both [`SessionizeSpeaker`](#sessionizespeaker)'s and [`SessionizeSession`](#sessionizesession)'s `QuestionAnswers` collections.

### SessionizeRoom
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:73` · Level 0 · record (sealed)

- **What it is**: the DTO for one room from Sessionize: `Id`, `Name`, `Sort`.
- **Depends on**: `System.Text.Json.Serialization` (BCL) only.
- **Concept**: an external-API contract DTO ([`SessionizeCategoryItem`](#sessionizecategoryitem)). `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: three `init` properties, `Id` (`int`, line 75), `Name` (`string`, empty default, line 78), `Sort` (`int`, line 81), each JSON-mapped; structurally identical to [`SessionizeCategoryItem`](#sessionizecategoryitem).
- **Where it's used**: nested inside [`SessionizeResponse`](#sessionizeresponse)'s `Rooms`; imported by the room sync path of the Sessionize refresh.

### SessionizeCategory
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:41` · Level 1 · record (sealed)

- **What it is**: the DTO for one Sessionize category (for example "Level" or "Track"), owning a nested list of its [`SessionizeCategoryItem`](#sessionizecategoryitem) values.
- **Depends on**: [`SessionizeCategoryItem`](#sessionizecategoryitem) (its `Items` collection); `System.Text.Json.Serialization` (BCL).
- **Concept**: an external-API contract DTO ([`SessionizeCategoryItem`](#sessionizecategoryitem)); this is the first `Sessionize*` type that nests another, which is why it sits one level up. `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: five `init` properties (`SessionizeModels.cs:43-56`), `Id` (`int`), `Title` (`string`, empty default), `Sort` (`int`), a nullable `Type` (`string?`, line 53, so an absent JSON field stays null), and `Items` (`IReadOnlyList<SessionizeCategoryItem>` defaulted to `[]`, line 56). Defaulting the list to an empty collection literal means a category with no items deserializes to an empty list rather than null.
- **Where it's used**: nested inside [`SessionizeResponse`](#sessionizeresponse)'s `Categories`; its items drive category-item import.

### SessionizeSession
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:140` · Level 1 · record (sealed)

- **What it is**: the richest Sessionize DTO, one conference session with its schedule, room, speakers, category assignments, question answers, and live/recording metadata.
- **Depends on**: [`SessionizeQuestionAnswer`](#sessionizequestionanswer) (its `QuestionAnswers` list); `System.Text.Json.Serialization` (BCL); `System.Diagnostics.CodeAnalysis` (scoped suppressions).
- **Concept**: an external-API contract DTO ([`SessionizeCategoryItem`](#sessionizecategoryitem)), here at full width. `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: many `init` properties (`SessionizeModels.cs:142-191`). Three carry extra handling worth knowing:
  - `Id` (`int`) is annotated `[JsonNumberHandling(JsonNumberHandling.AllowReadingFromString)]` (`SessionizeModels.cs:143`): Sessionize sometimes serializes the session id as a JSON string rather than a number, and this permits reading it either way.
  - `StartsAt`/`EndsAt` are `DateTime?` (lines 152-156), so an unscheduled session round-trips with nulls instead of failing.
  - `Speakers` is `IReadOnlyList<Guid>` and `CategoryItems` is `IReadOnlyList<int>` (lines 164-168): the session references speakers and category items by their Sessionize ids, not by nesting the full objects, so cross-references are resolved during import.
  - `LiveUrl` and `RecordingUrl` are nullable strings with the same `CA1056` URI-suppression as [`SessionizeLink`](#sessionizelink)'s `Url` (lines 176-182).
- **Why it's built this way**: the id-reference lists (rather than nested objects) mirror how Sessionize normalizes its own payload; the import strategies join `Speakers`/`CategoryItems` ids back to the already-imported entities.
- **Where it's used**: nested inside [`SessionizeResponse`](#sessionizeresponse)'s `Sessions`; imported by the session sync path of [`RefreshFromSessionizeCommand`](#refreshfromsessionizecommand).

### SessionizeSpeaker
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:86` · Level 1 · record (sealed)

- **What it is**: the DTO for one speaker from Sessionize, with profile fields, social [`SessionizeLink`](#sessionizelink)s, question answers, and id references to the speaker's sessions and category items.
- **Depends on**: [`SessionizeLink`](#sessionizelink) (`Links`), [`SessionizeQuestionAnswer`](#sessionizequestionanswer) (`QuestionAnswers`); `System.Text.Json.Serialization` (BCL).
- **Concept**: an external-API contract DTO ([`SessionizeCategoryItem`](#sessionizecategoryitem)). `[Rubric §9, API & Contract Design]`.
- **Walkthrough**: many `init` properties (`SessionizeModels.cs:88-122`). `Id` is a `Guid` (line 89) (unlike the `int` ids of most other Sessionize entities, matching the Conference domain's `SpeakerIdentifierType = Guid`). Optional profile fields (`Bio`, `TagLine`, `ProfilePicture`, `FullName`) are nullable strings; `IsTopSpeaker` is a `bool`; `Links` (line 110), `Sessions` (`IReadOnlyList<int>`, line 113), `CategoryItems` (`IReadOnlyList<int>`, line 119), and `QuestionAnswers` (line 122) are all empty-defaulted collections.
- **Why it's built this way**: the `Guid` speaker id lines up with the Conference domain's speaker identifier alias, so the import can map a Sessionize speaker to a domain [`Speaker`](group-17-conference-domain.md#speaker) without a type conversion.
- **Where it's used**: nested inside [`SessionizeResponse`](#sessionizeresponse)'s `Speakers`; imported by the speaker sync path of the Sessionize refresh.

### SessionizeResponse
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:6` · Level 2 · record (sealed)

- **What it is**: the top-level envelope for the Sessionize "View All" API response, holding the five parallel collections (`Categories`, `Rooms`, `Speakers`, `Sessions`, `Questions`) that make up an entire conference import payload.
- **Depends on**: [`SessionizeCategory`](#sessionizecategory), [`SessionizeRoom`](#sessionizeroom), [`SessionizeSpeaker`](#sessionizespeaker), [`SessionizeSession`](#sessionizesession), [`SessionizeQuestion`](#sessionizequestion); `System.Text.Json.Serialization` (BCL).
- **Concept**: the root of the external-API contract DTO tree ([`SessionizeCategoryItem`](#sessionizecategoryitem) taught the shape). `[Rubric §9, API & Contract Design]`. This is the object [`ISessionizeService`](#isessionizeservice)'s `GetAllAsync` returns and the single input every Sessionize sync strategy reads from.
- **Walkthrough**: five `init` `IReadOnlyList<...>` properties, each empty-defaulted and JSON-mapped to the lowercased Sessionize field (`SessionizeModels.cs:8-21`). "View All" is Sessionize's denormalized endpoint: it returns every entity type in one document, which is why this envelope has one collection per entity kind rather than a paged, per-type shape.
- **Why it's built this way**: one immutable envelope makes the import atomic to reason about, the strategies receive the whole snapshot and reconcile the domain against it, and empty-list defaults mean a payload missing a section is still a valid, non-null response.
- **Where it's used**: returned (nullable) by [`ISessionizeService`](#isessionizeservice); consumed by the refresh command and its sync strategies ([`RefreshFromSessionizeCommand`](#refreshfromsessionizecommand), [`SessionizeSyncContext`](#sessionizesynccontext)).

### ISessionizeService
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Sessionize/ISessionizeService.cs:6` · Level 3 · interface

- **What it is**: the one-method contract for fetching a whole conference from the Sessionize "View All" API, returning a [`SessionizeResponse`](#sessionizeresponse) (or `null` when the response is empty).
- **Depends on**: [`SessionizeResponse`](#sessionizeresponse) (its return type).
- **Concept introduced, the outbound-port interface (dependency inversion at the external boundary).** `[Rubric §3, Clean Architecture]` (assesses whether the Application layer depends on abstractions it owns, with concrete adapters living outward) and `[Rubric §7, Microservices Readiness]` (assesses isolating third-party calls behind a swappable boundary). The Application layer declares *what* it needs from Sessionize (this interface) while the HTTP client that actually calls the API lives in the Infrastructure layer and implements it. That inversion keeps the import use cases testable (a fake `ISessionizeService` feeds a canned response) and keeps the `HttpClient`/retry concerns out of the Application layer.
- **Walkthrough**: a single method `Task<SessionizeResponse?> GetAllAsync(string sessionizeCode, CancellationToken cancellationToken = default)` (`ISessionizeService.cs:12`). The `sessionizeCode` is the per-event Sessionize code (the doc comment gives the example `"kqf8l42a"`, `ISessionizeService.cs:9`); the nullable return signals an empty/absent response rather than throwing; and the trailing `CancellationToken` follows the codebase convention that every async boundary is cancelable.
- **Why it's built this way**: a narrow, single-purpose port is the smallest surface the import needs, which makes both the real HTTP adapter and its test double trivial to write.
- **Where it's used**: injected by the Sessionize refresh use case and its strategies; the concrete HTTP implementation is registered from the Conference Infrastructure layer (Group 19).

### CategoryItemNameRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/Validation/ConferenceCategoryValidationRules.cs:26` · Level 6 · class (sealed)

- **What it is**: a reusable FluentValidation rule fragment enforcing that a category-item name is non-empty and within the max length defined by the domain.
- **Depends on**: `FluentValidation` (`AbstractValidator<T>`), [`CategoryInvariants`](group-17-conference-domain.md#categoryinvariants) (the shared `CategoryItemNameMaxLength` constant), `System.Linq.Expressions` (BCL).
- **Concept**: the generic reusable validator rule, taught on [`CategoryItemSortRules<T>`](#categoryitemsortrulest). `[Rubric §1, SOLID]` and `[Rubric §16, Maintainability & Evolvability]`.
- **Walkthrough**: constructor `CategoryItemNameRules(Expression<Func<T, string>> selector)` (`ConferenceCategoryValidationRules.cs:29`) whose body is one chained `RuleFor(selector)`: `.NotEmpty()` with error code `CategoryItem.Name.Required`, then `.MaximumLength(CategoryInvariants.CategoryItemNameMaxLength)` with error code `CategoryItem.Name.MaxLength` (`ConferenceCategoryValidationRules.cs:30-32`). The max-length bound is read from [`CategoryInvariants`](group-17-conference-domain.md#categoryinvariants), the single source of truth that the domain, the EF configuration, and this validator all share, so the length rule cannot drift between layers.
- **Why it's built this way**: pulling the constant from the domain invariants (rather than a literal here) is exactly the "one place to change a constraint" discipline; generic over `T` so it composes into whichever request carries the name.
- **Where it's used**: composed by the add/update category-item command validators. Siblings: [`CategoryItemSortRules<T>`](#categoryitemsortrulest), [`ConferenceCategoryTitleRules<T>`](#conferencecategorytitlerulest).

### ConferenceCategoryTitleRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/Validation/ConferenceCategoryValidationRules.cs:12` · Level 6 · class (sealed)

- **What it is**: a reusable FluentValidation rule fragment enforcing that a conference-category title is non-empty and within the domain-defined max length.
- **Depends on**: `FluentValidation` (`AbstractValidator<T>`), [`CategoryInvariants`](group-17-conference-domain.md#categoryinvariants) (the `TitleMaxLength` constant), `System.Linq.Expressions` (BCL).
- **Concept**: the generic reusable validator rule, taught on [`CategoryItemSortRules<T>`](#categoryitemsortrulest). `[Rubric §1, SOLID]` and `[Rubric §16, Maintainability & Evolvability]`.
- **Walkthrough**: constructor `ConferenceCategoryTitleRules(Expression<Func<T, string>> selector)` (`ConferenceCategoryValidationRules.cs:15`) with one chained `RuleFor(selector)`: `.NotEmpty()` (error code `Category.Title.Required`) then `.MaximumLength(CategoryInvariants.TitleMaxLength)` (error code `Category.Title.MaxLength`) (`ConferenceCategoryValidationRules.cs:16-18`). Structurally identical to [`CategoryItemNameRules<T>`](#categoryitemnamerulest), differing only in the target property and its constant/error codes.
- **Where it's used**: composed by the create/update conference-category command validators.

### DependencyInjection
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/DependencyInjection.cs:34` · Level 11 · class (static, extension block)

- **What it is**: the Conference module's application-layer composition root: a static class exposing the `AddModuleConferenceApplication(ApplicationSettings)` extension method that registers every application service for the module into the DI container.
- **Depends on**: [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings), the Conference domain aggregates ([`Event`](group-17-conference-domain.md#event), [`Session`](group-17-conference-domain.md#session), [`Speaker`](group-17-conference-domain.md#speaker), [`Category`/`CategoryItem`](group-17-conference-domain.md#categoryitem) and their children), the framework generics [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype) and [`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity), the cross-module ports [`ISessionBookmarkValidationService`](group-17-conference-domain.md#isessionbookmarkvalidationservice) and [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice), and [`ClassReference`](#classreference); `Microsoft.Extensions.DependencyInjection` (NuGet), Scrutor (assembly scanning).
- **Concept introduced, the module composition root via `extension(IServiceCollection)`.** `[Rubric §5, Vertical Slice]` (assesses whether each module wires its own slice) and `[Rubric §2, Design Patterns]` (assesses idiomatic registration). The registration method is written as a C# `extension(IServiceCollection services)` block (`DependencyInjection.cs:36`) so callers invoke `services.AddModuleConferenceApplication(...)` (the same `extension(T)` member pattern taught in [primer](00-primer.md#c-extensiont-types--read-this-once) and used across the codebase for DI). It mixes two registration styles the class comment (`DependencyInjection.cs:29-33`) names: explicit `TryAdd*` registrations for the generic per-entity services, and convention-based Scrutor scanning for the many hand-written handlers, mappers, and validators.
- **Walkthrough** (registration order in the method body):
  - `applicationSettings` is accepted but currently only stored via `_ = applicationSettings` with a "reserved for future use" note (`DependencyInjection.cs:40`), so the parameter is part of the module contract even though this module does not yet branch on it.
  - Domain service: `IEventCascadeDeletionDomainService` is registered as a singleton (`DependencyInjection.cs:43`).
  - Aggregate roots with custom navigation populators (`Event`, `Session`, `Speaker`, `Category`) each get three registrations, `INavigationPopulator<T>`, `IEntityQueryService<T, TDTO, TId>`, and a `DeleteEntityCommand` handler (`DependencyInjection.cs:46-60`). `Event` uses a bespoke `DeleteEventHandler` while `Session`/`Speaker`/`Category` use the generic `DeleteEntityHandler<,>`; the cascade-delete rule for events is why `Event` is special-cased.
  - Aggregate roots with no child navigations (`Question`) get the same trio but with a `NullNavigationPopulator<Question>` (`DependencyInjection.cs:63-65`).
  - Child entities (`Room`, `CategoryItem`, `EventSpeaker`, `EventQuestionAnswer`, `SessionSpeaker`, `SessionCategoryItem`, `SessionQuestionAnswer`, `SpeakerCategoryItem`) each get a `NullNavigationPopulator` plus the base `EntityQueryService` (`DependencyInjection.cs:68-90`), no delete handler, because children are removed through their aggregate root.
  - Cross-module ports: [`ISessionBookmarkValidationService`](group-17-conference-domain.md#isessionbookmarkvalidationservice) → `SessionBookmarkValidationService` and [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice) → `EventLiveValidationService` (`DependencyInjection.cs:93-96`), the in-process interfaces the Engagement service later reaches over gRPC.
  - Finally `services.ScanModuleApplicationServices<ClassReference>()` (`DependencyInjection.cs:100`) sweeps this assembly for domain-event handlers, DTO/request mappers, command/query handlers, and validators, then the method returns `services` for fluent chaining.
- **Why it's built this way**: `TryAdd*` (rather than `Add`) lets a host override any single registration without a duplicate-registration conflict; splitting explicit generics from convention scanning keeps the file short while still registering dozens of hand-written handlers. Registering the cross-module validation services here (in-process) is what lets the same code run either co-located or split behind gRPC without change (ADR-007/008).
- **Where it's used**: called by the Conference module registration (`IModule.Register`) during host startup; the module is discovered and ordered by the `ModuleLoader` (Group 14).
- **Caveats / not-in-source**: the `applicationSettings` parameter is currently unused beyond the discard; the comment flags it as reserved for profiler decorators, which are not wired here today.

### SessionizeSyncResult

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/ISessionizeSyncStrategy.cs:21` · Level 0 · record

- **What it is**: the small immutable value returned by every Sessionize sync strategy: a pair of counters reporting how many entities that strategy touched. It is co-located in the same file as [`ISessionizeSyncStrategy`](#isessionizesyncstrategy) because it is that interface's return type.
- **Depends on**: nothing first-party; it is a plain `sealed record` with two `int` `init` properties.
- **Walkthrough**: two members: `PrimarySynced` (`ISessionizeSyncStrategy.cs:24`), the count of the strategy's main entity (categories, rooms, questions, speakers, or sessions), and `SecondarySynced` (`ISessionizeSyncStrategy.cs:27`), an optional count of a nested child entity synced in the same pass (today only [`CategorySyncStrategy`](#categorysyncstrategy) uses it, to report category items synced alongside categories). Both default to `0`, so a strategy that has no secondary entity simply leaves it unset.
- **Why it's built this way**: returning a record rather than a bare `int` leaves room to grow the result (more counters, per-entity warnings) without breaking the five implementors. The two-field shape is deliberately generic so one type serves all five strategies.
- **Where it's used**: produced by each `SyncAsync` implementation and accumulated into a `List<SessionizeSyncResult>` by [`RefreshFromSessionizeHandler`](#refreshfromsessionizehandler), which reads the counters positionally to build its result DTO.

---

### RefreshFromSessionizeCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeCommand.cs:18` · Level 6 · record

- **What it is**: the CQRS command that requests a full refresh of one event's data (categories, rooms, questions, speakers, sessions) from the external Sessionize API. It carries a single field: the `EventId` to refresh (`RefreshFromSessionizeCommand.cs:18`).
- **Depends on**: [`Event`](group-17-conference-domain.md#event) (only for the `typeof(Event).FullName` cache-prefix expression), [`ConferenceFeatures`](group-17-conference-domain.md#conferencefeatures) (the feature-flag constant), and three marker interfaces from `MMCA.Common.Application`: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), [`ITransactional`](group-05-cqrs-pipeline.md#itransactional), and [`IFeatureGated`](group-05-cqrs-pipeline.md#ifeaturegated).
- **Concept introduced: marker interfaces that opt a command into pipeline behavior.** The command itself has no logic; it is a request record whose *interfaces* tell the decorator pipeline how to treat it (the pipeline is taught in [Group 05](group-05-cqrs-pipeline.md)). Implementing three markers stacks three cross-cutting behaviors declaratively:
  - [`IFeatureGated`](group-05-cqrs-pipeline.md#ifeaturegated) exposes `FeatureName => ConferenceFeatures.SessionizeIntegration` (`RefreshFromSessionizeCommand.cs:24`); the FeatureGate decorator short-circuits the command to a no-op when that flag is off, a runtime circuit breaker for the whole Sessionize integration. [Rubric §10, Cross-Cutting Concerns] assesses whether concerns like feature flags are handled centrally rather than scattered; here the flag check is inherited from the pipeline, not coded in the handler.
  - [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) exposes `CachePrefix => $"{typeof(Event).FullName}:"` (`RefreshFromSessionizeCommand.cs:21`); on success the Caching decorator evicts every cache entry under the `Event` prefix, so freshly imported data is not masked by a stale read cache.
  - [`ITransactional`](group-05-cqrs-pipeline.md#itransactional) makes the Transactional decorator wrap the handler in one database transaction, so the five per-entity syncs commit atomically or roll back together. [Rubric §6, CQRS & Event-Driven] assesses whether mutations flow through well-defined command boundaries; this command is the boundary and its markers are how it configures the pipeline around itself.
- **Walkthrough**: a one-parameter positional record (`RefreshFromSessionizeCommand.cs:18`) plus two expression-bodied `get` properties satisfying the marker contracts (`CachePrefix` at line 21, `FeatureName` at line 24). No constructor body, no validation: an event id is the only input the use case needs.
- **Why it's built this way**: keeping the behavior in interfaces, not in the command body, is what lets one small record participate in feature-gating, cache invalidation, and transactions without repeating that plumbing per use case (ADR-014 for the decorator ordering).
- **Where it's used**: handled by [`RefreshFromSessionizeHandler`](#refreshfromsessionizehandler); dispatched by the Conference REST controller that exposes the refresh endpoint.

---

### SessionizeSyncContext

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/SessionizeSyncContext.cs:11` · Level 8 · record

- **What it is**: the mutable "parameter object" passed to every sync strategy for one import run. It bundles the four things a strategy needs (the parsed API payload, the target event, the unit of work, and a shared warnings list) plus one running counter the strategies write back into.
- **Depends on**: [`SessionizeResponse`](#sessionizeresponse) (the parsed API payload, same group), [`Event`](group-17-conference-domain.md#event) (the aggregate being refreshed), and [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (repository access for strategies that load their own entities).
- **Concept introduced: a shared context object for a multi-step pipeline.** Rather than pass four or five arguments into every strategy method, the orchestrator builds one context and threads it through. Two of its members are deliberately *mutable* so the strategies can report side information back to the orchestrator without changing the `SyncAsync` return contract:
  - `Warnings` (`SessionizeSyncContext.cs:16`) is a `required List<string>` any strategy can append non-fatal problems to (a session outside the event date range, a question in the reserved id range); the handler folds these into the result DTO.
  - `SkippedSoftDeleted` (`SessionizeSyncContext.cs:19`) is a plain `int { get; set; }` that every strategy increments when it encounters a soft-deleted local row matching an incoming Sessionize id, implementing BR-136 (soft-deleted entities are never resurrected by an import).
- **Walkthrough**: four `required init` members set once at construction: `Response` (`:13`), `Event` (`:14`), `UnitOfWork` (`:15`), `Warnings` (`:16`); then the single mutable counter `SkippedSoftDeleted` (`:19`). The `required` keyword forces the handler to supply all four when it news up the context, so a strategy can never see a half-built context.
- **Why it's built this way**: a single context keeps the strategy signature stable ([`ISessionizeSyncStrategy.SyncAsync`](#isessionizesyncstrategy) takes exactly `(context, cancellationToken)`), and the two mutable fields give strategies a back-channel for warnings and skip counts without a more complex return type.
- **Where it's used**: created once per command in [`RefreshFromSessionizeHandler`](#refreshfromsessionizehandler) and passed to each of the five strategies in turn.

---

### ISessionizeSyncStrategy

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/ISessionizeSyncStrategy.cs:7` · Level 9 · interface

- **What it is**: the Strategy interface for synchronizing one entity family from a parsed Sessionize response into the domain. Each implementation owns exactly one entity type (categories, rooms, questions, speakers, or sessions).
- **Depends on**: [`SessionizeSyncContext`](#sessionizesynccontext) (the input for one run) and [`SessionizeSyncResult`](#sessionizesyncresult) (the return, co-located in the same file at line 21).
- **Concept introduced: the Strategy pattern for pluggable, ordered sync steps.** [Rubric §2, Design Patterns] assesses whether a pattern solves a real structural problem. Sessionize returns one payload covering five interdependent entity types; splitting the sync into one strategy per type keeps each `SyncAsync` small and single-purpose, and lets a new entity type be added as a new strategy without touching the ones that exist ([Rubric §1, SOLID], open for extension). [Rubric §16, Maintainability] applies too: a change to how rooms sync cannot break speaker sync because the code paths are physically separate.
- **Walkthrough**: one method: `Task<SessionizeSyncResult> SyncAsync(SessionizeSyncContext context, CancellationToken cancellationToken)` (`ISessionizeSyncStrategy.cs:15`). The strategy reads what it needs from the context, upserts its entity family, and returns a [`SessionizeSyncResult`](#sessionizesyncresult) with the counts it produced.
- **Why it's built this way**: a record result (not a bare `int`) leaves room to add metadata without breaking implementors, and a single context parameter keeps every strategy's signature identical so the orchestrator can loop over them uniformly.
- **Where it's used**: implemented by the five Level-10 strategy classes below; the implementations are held in a static array inside [`RefreshFromSessionizeHandler`](#refreshfromsessionizehandler) and executed in dependency order.
- **Caveats / not-in-source**: the strategies are **not** injected via DI. The handler instantiates them directly in a `static readonly ISessionizeSyncStrategy[]` field (`RefreshFromSessionizeHandler.cs:25`), which is possible because they are stateless (all per-run state lives in [`SessionizeSyncContext`](#sessionizesynccontext)).

---

### CategorySyncStrategy

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/CategorySyncStrategy.cs:11` · Level 10 · class (internal sealed)

- **What it is**: the sync strategy for categories and their nested category items. This is the fullest of the five strategies, so it also serves as the reference for the shared four-phase shape the others reuse.
- **Depends on**: [`ISessionizeSyncStrategy`](#isessionizesyncstrategy) (the interface it implements), [`SessionizeSyncContext`](#sessionizesynccontext), [`SessionizeSyncResult`](#sessionizesyncresult), [`Category`](group-17-conference-domain.md#category) (the aggregate it upserts through), and [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (reached via the context).
- **Concept introduced: the shared four-phase upsert every strategy follows:**
  1. **Bulk pre-load.** Rather than N `GetByIdAsync` calls, the strategy opens its repository via `context.UnitOfWork.GetRepository<Category, ...>()` (`CategorySyncStrategy.cs:15`) and calls `GetByIdsAsync` once with the full set of Sessionize ids (`:21`). It passes `includes: [nameof(Category.CategoryItems)]` to eager-load children, `asTracking: true` so updates are tracked, and `ignoreQueryFilters: true` so soft-deleted rows are visible for the BR-136 skip check. Results become a dictionary keyed by id (`:27`). This is a deliberate [Rubric §12, Performance & Scalability] choice: a full re-import of hundreds of entities would suffer badly from N+1 queries.
  2. **Iterate and discriminate.** For each incoming entity (`:31`): if it matches a local row that `IsDeleted`, increment `context.SkippedSoftDeleted` and `continue` (`:35`, BR-136); if it matches an active row, call the aggregate's `Update(...)` (`:41`); if there is no match, call the aggregate's `Create(...)` factory (`:97`), which returns [`Result<T>`](group-01-result-error-handling.md#result), and skip on failure.
  3. **Sync children.** `SyncCategoryItems` (`:61`) walks each incoming category's items, applying the same match/skip/update/add logic via `existing.UpdateCategoryItem` / `existing.AddCategoryItem` (`:78`, `:82`), and returns the count.
  4. **Batch-add new entities.** New aggregates are collected in a local `List<Category>` and flushed with `categoryRepo.AddRangeAsync(newCategories, ...)` in one call (`:55`), then a [`SessionizeSyncResult`](#sessionizesyncresult) carrying both counters is returned (`:58`).

  [Rubric §4, Domain-Driven Design] applies throughout: every mutation goes through a `Category` factory or aggregate method, so the domain enforces its own invariants and the strategy never sets fields directly.
- **Walkthrough**: `SyncAsync` (`:13`) runs the four phases above; the private helpers `SyncCategoryItems` (`:61`) and `CreateNewCategory` (`:91`) keep each phase small. `CategorySyncStrategy` is the only strategy that reports a secondary count: `SecondarySynced` carries the category-items total (`:58`).
- **Where it's used**: first entry in the handler's `SyncStrategies` array (`RefreshFromSessionizeHandler.cs:27`); it runs first because speakers and sessions reference category items.

---

### QuestionSyncStrategy

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/QuestionSyncStrategy.cs:11` · Level 10 · class (internal sealed)

- **What it is**: the sync strategy for questions. It follows the same four-phase shape as [`CategorySyncStrategy`](#categorysyncstrategy) (bulk pre-load at `QuestionSyncStrategy.cs:44`, discriminate at `:53`, batch-add at `:100`) but adds three question-specific concerns.
- **Depends on**: [`ISessionizeSyncStrategy`](#isessionizesyncstrategy), [`SessionizeSyncContext`](#sessionizesynccontext), [`SessionizeSyncResult`](#sessionizesyncresult), [`Question`](group-17-conference-domain.md#question) (upserted via `Create`/`Update`), and [`QuestionInvariants`](group-17-conference-domain.md#questioninvariants) (the reserved-id constants).
- **Concept introduced: cross-source invariants enforced at the application layer.** Two of this strategy's rules cannot live inside the `Question` entity because they compare *external* Sessionize data against *internal* rules:
  - **Reserved-id guard** (`:29`): incoming ids inside `[QuestionInvariants.ManualIdRangeStart, QuestionInvariants.ManualIdRangeEnd]` are reserved for manually created questions; a Sessionize question landing there would shadow a user-created one, so it is dropped with a warning (`:34`) rather than a hard error, and the import continues. [Rubric §11, Security] and [Rubric §16, Maintainability] both touch this: a bad external row cannot corrupt user-owned data, and the rule lives in one place.
  - **Entity-type detection** (`:19`): the strategy pre-computes which question ids are answered by speakers versus sessions, then tags each question `"Session"` or `"Speaker"` (defaulting to `"Session"` when a question has no answers yet, `:66`).
  - **Type mapping** (`MapSessionizeQuestionType`, `:109`): Sessionize's open type strings (`Short_Text`, `Long_Text`, `Url`, `YesNo`, and so on) collapse to the three domain-valid values `"Rating"`, `"Email"`, and a catch-all `"Text"`. This helper is `internal static` so it is unit-testable without constructing the strategy.
- **Walkthrough**: `SyncAsync` (`:13`) filters the reserved range first (`:29`), then bulk-loads the surviving ids (`:44`) and upserts through `Question.Update` (`:79`) or `Question.Create` (`:83`, tagged `questionSource: "Sessionize"`). A create failure adds a warning and skips (`:90`) rather than aborting.
- **Where it's used**: third entry in the handler's `SyncStrategies` array (`RefreshFromSessionizeHandler.cs:29`).

---

### RoomSyncStrategy

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RoomSyncStrategy.cs:8` · Level 10 · class (internal sealed)

- **What it is**: the simplest strategy: it syncs rooms, which are children of the [`Event`](group-17-conference-domain.md#event) aggregate rather than a top-level entity.
- **Depends on**: [`ISessionizeSyncStrategy`](#isessionizesyncstrategy), [`SessionizeSyncContext`](#sessionizesynccontext), [`SessionizeSyncResult`](#sessionizesyncresult); it reaches rooms only through `context.Event`.
- **Walkthrough**: because rooms are already loaded on `context.Event.Rooms` (the handler pre-fetched the event with its `Rooms` navigation), this strategy skips the bulk-load phase entirely and has no async I/O: it returns `Task.FromResult(...)` (`RoomSyncStrategy.cs:35`). It iterates `context.Event.Rooms` (`:16`), applying the same match/skip/update/add logic through the `Event` aggregate methods `context.Event.UpdateRoom` (`:25`) and `context.Event.AddRoom` (`:29`), with the BR-136 soft-delete skip at `:19`.
- **Why it's built this way**: delegating to `Event.UpdateRoom` / `Event.AddRoom` keeps room invariants inside the aggregate ([Rubric §4, Domain-Driven Design]); the synchronous `Task.FromResult` avoids an unnecessary state machine for a method with no awaits.
- **Where it's used**: second entry in the handler's `SyncStrategies` array (`RefreshFromSessionizeHandler.cs:28`); runs after categories and before sessions, which reference rooms.

---

### SessionSyncStrategy

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/SessionSyncStrategy.cs:12` · Level 10 · class (internal sealed)

- **What it is**: the richest child-syncing strategy: it upserts sessions and, for each, reconciles three child collections (session speakers, session category items, session question answers).
- **Depends on**: [`ISessionizeSyncStrategy`](#isessionizesyncstrategy), [`SessionizeSyncContext`](#sessionizesynccontext), [`SessionizeSyncResult`](#sessionizesyncresult), and [`Session`](group-17-conference-domain.md#session) (upserted via `Create`/`Update` and its `Add*` child methods).
- **Concept introduced: validate-then-upsert with non-fatal warnings.** Before touching a session, `ValidateSessionTimes` (`SessionSyncStrategy.cs:51`) records warnings (never errors) for times outside the event date range (BR-86, `:54` and `:59`) and for zero or negative duration (BR-122, `:65`); the data is still stored as-is. The strategy bulk-loads existing sessions with all three child navigations included (`:21`), then `ResolveOrCreateSession` (`:71`) applies the standard match/skip (BR-136 at `:79`) / `Update` (`:85`) / `Create` (`:95`) logic.
- **Walkthrough**: after resolving each session, `SyncSessionChildren` (`:111`) reconciles the three child sets in one pass: it adds any speaker not already linked (`AddSessionSpeaker`, `:117`), any category item not already present (`AddSessionCategoryItem`, `:124`), and delegates answers to `SyncSessionQuestionAnswers` (`:131`), which updates an existing non-deleted answer or adds a new one. Every child comparison uses an identity match plus an `!IsDeleted` guard so soft-deleted children are not re-added. New sessions are batch-added via `AddRangeAsync` (`:45`).
- **Why it's built this way**: treating out-of-range times as warnings rather than rejections keeps the import resilient to imperfect Sessionize data ([Rubric §17, DevOps & Deployment], graceful degradation), while all mutation still flows through `Session` aggregate methods.
- **Where it's used**: final entry in the handler's `SyncStrategies` array (`RefreshFromSessionizeHandler.cs:31`); it runs last because sessions reference rooms, speakers, categories, and questions synced by the earlier strategies.

---

### SpeakerSyncStrategy

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/SpeakerSyncStrategy.cs:12` · Level 10 · class (internal sealed)

- **What it is**: the sync strategy for speakers. It follows the standard four-phase shape ([`CategorySyncStrategy`](#categorysyncstrategy)) and adds social-link extraction plus event-to-speaker linking.
- **Depends on**: [`ISessionizeSyncStrategy`](#isessionizesyncstrategy), [`SessionizeSyncContext`](#sessionizesynccontext), [`SessionizeSyncResult`](#sessionizesyncresult), [`Speaker`](group-17-conference-domain.md#speaker) (upserted via `Create`/`Update` and its `Add*` child methods), and [`Event`](group-17-conference-domain.md#event) (for the `EventSpeaker` link).
- **Concept introduced: parsing untyped external links into typed fields.** `ExtractSocialLinks` (`SpeakerSyncStrategy.cs:124`) iterates the speaker's Sessionize `Links` and maps each by `LinkType`: `"Twitter"` routes through `ExtractTwitterHandle`, `"LinkedIn"` and `"Blog"`/`"Company_Website"` fill their url fields, and a url containing `"github"` is treated as the GitHub link (`:151`). `ExtractTwitterHandle` (`:158`) strips the common `twitter.com` / `x.com` url prefixes to yield a bare handle and is `internal static` so it is directly unit-testable.
- **Walkthrough**: for each speaker, `CreateOrUpdateSpeaker` (`:59`) applies match/skip (BR-136 at `:71`) / `Update` (`:77`) / `Create` (`:84`) logic; because `Speaker.Create` does not accept social links, a freshly created speaker is immediately re-`Update`d to set them (`:90`). After upsert, the strategy creates an `EventSpeaker` link if one does not already exist (`context.Event.AddEventSpeaker`, `:44`), then syncs the speaker's category items (`:98`) and question answers (`:107`) with the usual identity-plus-`!IsDeleted` guards. New speakers are batch-added via `AddRangeAsync` (`:53`).
- **Where it's used**: fourth entry in the handler's `SyncStrategies` array (`RefreshFromSessionizeHandler.cs:30`); runs after categories and questions (which speakers reference) and before sessions (which reference speakers).

---

### RefreshFromSessionizeHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeHandler.cs:16` · Level 11 · class (sealed partial, command handler)

- **What it is**: the command handler for [`RefreshFromSessionizeCommand`](#refreshfromsessionizecommand): it loads the event, validates preconditions, calls the Sessionize API, runs the five per-entity strategies in dependency order, and returns a result DTO of per-entity sync counts. It is the orchestration seat of the whole import.
- **Depends on**: first-party: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), [`ISessionizeService`](#isessionizeservice) (the HTTP client abstraction), [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error), [`SessionizeResponse`](#sessionizeresponse), [`SessionizeSyncContext`](#sessionizesynccontext), [`SessionizeSyncResult`](#sessionizesyncresult), [`ISessionizeSyncStrategy`](#isessionizesyncstrategy) and its five implementations ([`CategorySyncStrategy`](#categorysyncstrategy), [`RoomSyncStrategy`](#roomsyncstrategy), [`QuestionSyncStrategy`](#questionsyncstrategy), [`SpeakerSyncStrategy`](#speakersyncstrategy), [`SessionSyncStrategy`](#sessionsyncstrategy)), [`Event`](group-17-conference-domain.md#event), [`RefreshFromSessionizeResultDTO`](group-17-conference-domain.md#refreshfromsessionizeresultdto), and the [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) contract it satisfies. Notable externals: `TimeProvider` (BCL, injected for testable clock reads) and `Microsoft.Extensions.Logging` (`ILogger<T>` plus the `[LoggerMessage]` source generator).
- **Concept introduced: the orchestrator that owns sequencing but not sync logic.** [Rubric §2, Design Patterns] and [Rubric §6, CQRS & Event-Driven] both apply. The handler holds a `static readonly ISessionizeSyncStrategy[] SyncStrategies` (`RefreshFromSessionizeHandler.cs:25`) with the five strategies in explicit dependency order (categories, rooms, questions, speakers, sessions). Making the array `static` avoids re-allocating it per request; the strategies are safe to share because they are stateless. The handler knows *the order* entities must be synced but nothing about *how* any entity is synced, the clean expression of the Strategy pattern.
- **Walkthrough**: the primary constructor (`:16`) takes five dependencies: `IUnitOfWork`, `ISessionizeService`, `ICurrentUserService`, `TimeProvider`, and `ILogger<RefreshFromSessionizeHandler>`; the `sealed partial` modifier pairs with the `[LoggerMessage]` generator at `:150`. `HandleAsync` (`:35`) runs six phases:
  1. **Event load** (`:40`): fetches the [`Event`](group-17-conference-domain.md#event) with `Rooms` and `EventSpeakers` navigations, `asTracking: true`; returns `Error.NotFound` when absent (`:49`).
  2. **BR-6 precondition** (`:54`): a missing `SessionizeCode` returns `Error.Invariant` with code `"Event.Sessionize.NoCode"`.
  3. **BR-63 throttle** (`:64`): if `LastSessionizeRefreshOn` is within five minutes of `timeProvider.GetUtcNow().UtcDateTime` (`:65`), returns `Error.Invariant` code `"Event.Sessionize.Throttled"` without calling the API. [Rubric §17, DevOps & Deployment] assesses runtime protections; this throttle keeps the handler within Sessionize's rate limits.
  4. **External API call** (`:75`): `sessionizeService.GetAllAsync` runs inside a `try/catch (HttpRequestException)` (`:80`); a network failure becomes `Error.Failure` code `"Event.Sessionize.Unavailable"`, so the Result pattern absorbs the exception into a structured error.
  5. **Empty-response short-circuit** (`:90`): a `null` response is valid (no data yet); the refresh timestamp is stamped, changes saved, and a zero-count DTO returned without running any strategy.
  6. **Strategy execution** (`:108`): a fresh [`SessionizeSyncContext`](#sessionizesynccontext) is built, then each strategy is `await`ed in sequence (`:117`, not in parallel, because later entities reference earlier ones) with results accumulated in a `List<SessionizeSyncResult>`. A non-zero `SkippedSoftDeleted` is folded into `Warnings` (`:122`), the refresh timestamp is stamped (`:128`), `unitOfWork.RequestIdentityInsert()` is called (`:132`), and `SaveChangesAsync` commits the whole batch (`:133`). The DTO is assembled by reading each result's counters positionally (`:139`).
- **Why it's built this way**: keeping only load/check/call/fan-out/commit here (no per-entity merge logic) keeps the method readable despite spanning five entity types, and returning [`Result`](group-01-result-error-handling.md#result) on every failure path lets the decorator pipeline and controller handle errors uniformly via `Match` rather than exceptions. `RequestIdentityInsert()` (`:132`) is a deliberate infrastructure signal: Sessionize preserves its own integer ids, but SQL Server `IDENTITY` columns reject explicit values, so the unit of work must wrap the save in `SET IDENTITY_INSERT ON/OFF` per table. The `[LoggerMessage]` source generator (`:150`) emits an allocation-free structured log for the success path.
- **Where it's used**: discovered by Scrutor and wrapped by the decorator pipeline (FeatureGate, Logging, Caching, Transactional given the command's markers, see [Group 05](group-05-cqrs-pipeline.md)); invoked by the Conference REST controller's refresh-from-Sessionize endpoint.
- **Caveats / not-in-source**: the result-DTO assembly reads `results[0]` through `results[4]` positionally (`:139`), so it silently depends on `SyncStrategies` staying in the declared order; reordering the array without updating the indices would swap the reported counts. An enum-keyed result map would be safer but adds complexity the current five-strategy size does not justify.

### EventDateRangeRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:55` · Level 0 · class (sealed, generic)

- **What it is** - a reusable FluentValidation rule fragment that enforces event date-range integrity: a start date is required, an end date is required, and the end date must fall on or after the start date.
- **Depends on** - `FluentValidation.AbstractValidator<T>` (NuGet); `System.Linq.Expressions.Expression<>` (BCL). No first-party dependencies.
- **Concept introduced - the reusable field-rule fragment.** This is the first place in this chapter's per-type sections where the Conference module's validation-composition pattern appears, so it is worth teaching from first principles. Each `*Rules<T>` class is a tiny `AbstractValidator<T>` (or a `RequiredStringRules<T>` subclass) that validates exactly one concern (one field, or one cross-field relationship). The generic parameter `T` is the owning command or request type, and the constructor takes a property-selector `Expression<Func<T, TProp>>`. Because the rule is parameterized on `T` and the selector, the same fragment can be composed into a create-command validator *and* an update-command validator via FluentValidation's `Include(...)`, with zero copy-paste. `[Rubric §1 - SOLID]` assesses single-responsibility and open/closed adherence: each fragment owns one rule and new constraints are added by composing another fragment, never by editing an existing one. `[Rubric §24 - Forms/Validation/UX Safety]` assesses whether validation is centralized and message-consistent: the fragment carries the user-facing message and a stable `WithErrorCode` string that the client can key off.
- **Walkthrough** - the constructor (`EventValidationRules.cs:58`) takes two selectors, `startDateSelector` and `endDateSelector`. It registers a `NotEmpty` rule on each (`:62`, `:65`) with distinct error codes (`Event.StartDate.Required`, `Event.EndDate.Required`). The cross-field check is the notable mechanism: it compiles the start-date selector into a delegate once (`var startDateFunc = startDateSelector.Compile();`, `:68`), then adds a `Must((instance, endDate) => endDate >= startDateFunc(instance))` rule on the end date (`:69-71`). The two-argument `Must` overload hands the validator both the whole instance and the end-date value, so the compiled start getter reads the sibling property off the *same* object under validation.
- **Why it's built this way** - compiling the selector once at construction (rather than invoking the expression tree per validation) keeps the cross-property comparison allocation-light on the hot validation path. Splitting each concern into its own fragment means an `UpdateEventCommand` validator can pull in exactly the rules it needs without inheriting a monolithic validator.
- **Where it's used** - composed via `Include(...)` into the event create and update command validators in the Conference Application layer.

### GetCategoryDistributionQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetCategoryDistribution/GetCategoryDistributionQuery.cs:5` · Level 0 · record (sealed)

- **What it is** - the CQRS query contract that asks for the distribution of an event's sessions across its category items. A single-line record carrying just the event to analyze.
- **Depends on** - `EventIdentifierType` (the Conference module identifier alias). No other first-party types.
- **Concept introduced** - this is a plain read-side CQRS request; the query/handler split is taught by [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult), so it is cross-referenced rather than re-taught here. `[Rubric §6 - CQRS & Event-Driven]` assesses whether reads and writes travel separate paths with explicit contracts: this record is a read intent with no side effects, handled by [GetCategoryDistributionHandler](#getcategorydistributionhandler).
- **Walkthrough** - one positional parameter, `EventId` of type `EventIdentifierType` (`:5`). No body.
- **Why it's built this way** - keeping the query as a standalone record means it can be dispatched on its own (an organizer opening the category-distribution view) or composed into the larger session-selection dashboard without over-fetching the other analytics dimensions.
- **Where it's used** - dispatched by the Conference decision-support REST endpoints and resolved by [GetCategoryDistributionHandler](#getcategorydistributionhandler).

### GetContentSimilarityQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetContentSimilarity/GetContentSimilarityQuery.cs:6` · Level 0 · record (sealed)

- **What it is** - the query contract that asks for pairs of similar-content sessions within an event, so organizers can spot proposals that overlap and might compete for the same audience.
- **Depends on** - `EventIdentifierType` (module identifier alias). No other first-party types.
- **Concept introduced** - same read-side CQRS shape as [GetCategoryDistributionQuery](#getcategorydistributionquery); cross-reference [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) for the pattern. `[Rubric §6 - CQRS & Event-Driven]` - a read intent with a tunable parameter, handled by [GetContentSimilarityHandler](#getcontentsimilarityhandler).
- **Walkthrough** - two positional parameters (`:6`): `EventId` (`EventIdentifierType`) and `MinimumSimilarity` (`double`) which defaults to `0.3`. The default is the only parameter default in the group; it is the floor score a session pair must clear to appear in the result.
- **Why it's built this way** - exposing the threshold as a defaulted parameter lets callers loosen or tighten the similarity floor per request while the common case (organizer opens the view) works with no argument. Caveat: the `0.3` default lives in this contract, while the scoring weights that produce the score live in [SessionSimilarityCalculator](#sessionsimilaritycalculator); the two must be read together to reason about what actually surfaces.
- **Where it's used** - dispatched by the Conference decision-support endpoints and resolved by [GetContentSimilarityHandler](#getcontentsimilarityhandler).

### RoomCapacityRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:37` · Level 0 · class (sealed, generic)

- **What it is** - a reusable rule fragment enforcing that a room's capacity, when supplied, is strictly positive. Capacity is optional (`int?`), so the rule only fires when a value is present.
- **Depends on** - `FluentValidation.AbstractValidator<T>`; `System.Linq.Expressions.Expression<>`. No first-party types.
- **Concept introduced** - same reusable field-rule pattern taught in [EventDateRangeRules<T>](#eventdaterangerulest). The notable wrinkle is the conditional: `.When(x => selector.Compile()(x) is not null)` (`:43`) guards the `GreaterThan(0)` rule (`:42`) so a null capacity is silently accepted rather than reported as invalid. `[Rubric §24 - Forms/Validation/UX Safety]` - an optional numeric field should not raise a validation error simply for being absent.
- **Walkthrough** - the constructor takes an `Expression<Func<T, int?>>` selector (`:40`), chains `GreaterThan(0)` with error code `Room.Capacity.NotPositive`, and applies the null-guard `When` clause.
- **Why it's built this way** - separating the presence check (`When`) from the value check keeps the "optional but bounded" semantics in one place; a room without a known capacity is valid, a room claiming a non-positive capacity is not.
- **Where it's used** - composed into the room create and update command validators.

### RoomSortRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:25` · Level 0 · class (sealed, generic)

- **What it is** - a reusable rule fragment enforcing that a room's sort-order value is non-negative.
- **Depends on** - `FluentValidation.AbstractValidator<T>`; `System.Linq.Expressions.Expression<>`. No first-party types.
- **Concept introduced** - same pattern as [EventDateRangeRules<T>](#eventdaterangerulest). The simplest variant in the family: one `GreaterThanOrEqualTo(0)` rule.
- **Walkthrough** - the constructor takes an `Expression<Func<T, int>>` selector (`:28`) and registers `GreaterThanOrEqualTo(0)` with error code `Room.Sort.Negative` (`:29-30`). No conditionals, no cross-field logic.
- **Why it's built this way** - sort order drives deterministic UI ordering of rooms; a negative value has no meaning, so the fragment rejects it at the boundary before it reaches the domain.
- **Where it's used** - composed into the room create and update command validators alongside [RoomCapacityRules<T>](#roomcapacityrulest).

### SessionSimilarityCalculator
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetContentSimilarity/SessionSimilarityCalculator.cs:9` · Level 0 · class (static, internal)

- **What it is** - a pure static calculator that scores how similar two sessions are, combining category-item overlap (weighted 0.6) with keyword overlap drawn from titles and descriptions (weighted 0.4). It is the engine behind the content-similarity analysis.
- **Depends on** - `System.Collections.Frozen.FrozenSet<string>` (BCL); `CategoryItemIdentifierType` (module identifier alias) as a set element type. No other first-party types.
- **Concept introduced - weighted Jaccard similarity with span-based tokenization.** The Jaccard index is the size of a set intersection over the size of its union, a value in `[0.0, 1.0]`. Here two independent Jaccard scores are blended: category-item overlap and keyword overlap. Two sessions with identical category tags but no shared keywords score `0.6`; identical keywords but no shared tags score `0.4`. `[Rubric §12 - Performance & Scalability]` assesses allocation and lookup discipline on compute paths: the stop-word set is a `FrozenSet<string>` for O(1) membership after a one-time build (`:14-34`), and `TokenizeText` scans a `ReadOnlySpan<char>` without allocating a string per character (`:41-71`).
- **Walkthrough** - members in teaching order:
  - Weight constants `CategoryWeight = 0.6` and `KeywordWeight = 0.4` (`:11-12`).
  - `StopWords` (`:14-34`), a `FrozenSet<string>` of English function words plus conference-generic terms (`"SESSION"`, `"TALK"`, `"WORKSHOP"`, `"DEEP"`, `"DIVE"`) that would otherwise inflate false matches; built with `StringComparer.Ordinal`.
  - `TokenizeText(string? text)` (`:41`), returns an empty set for null/whitespace, then walks the span tracking word-start indices, and via `AddTokenIfNotStopWord` (`:123`) uppercases each run of length `>= 3` (the `>= 3` filter is at `:62`) and drops stop words. Uppercasing uses `ToUpperInvariant` (the CA1308 note in the doc comment at `:37`).
  - `CalculateJaccardIndex<T>(HashSet<T>, HashSet<T>)` (`:80`), returns `0.0` when both sets are empty (`:82-83`), otherwise iterates the smaller set against the larger for the intersection count (`:85-88`) and divides by `setA.Count + setB.Count - intersectionCount`.
  - `CalculateSimilarity(...)` (`:97`), the public composite: `CategoryWeight * Jaccard(categoryItems) + KeywordWeight * Jaccard(keywords)` (`:103-105`).
  - `GetIntersection<T>(...)` (`:115`), returns the shared elements as a `List<T>`, used to populate the shared-tags and shared-keywords fields of each result pair.
- **Why it's built this way** - a single Jaccard on category items alone would flag unrelated sessions that happen to share a broad track; adding the keyword signal raises the bar, and weighting categories higher reflects that curated tags are a stronger signal than free-text overlap. The static, side-effect-free shape makes it trivially unit-testable in isolation.
- **Where it's used** - [GetContentSimilarityHandler](#getcontentsimilarityhandler) calls `TokenizeText`, `CalculateSimilarity`, and `GetIntersection` across every session pair.

### StatusBucket
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetCategoryDistribution/GetCategoryDistributionHandler.cs:94` · Level 0 · enum (private)

- **What it is** - a private enum, nested inside [GetCategoryDistributionHandler](#getcategorydistributionhandler), that maps a session's raw status string onto one of three counting buckets used to tally the category distribution.
- **Depends on** - used together with `SessionStatuses` string constants ([SessionStatuses](group-17-conference-domain.md#sessionstatuses)) via the handler's `ClassifyStatus` switch.
- **Concept introduced** - an internal aggregation vocabulary. The enum is an implementation detail of one handler and is never exposed to callers, who receive DTO counts. `[Rubric §16 - Maintainability]` assesses local reasoning: keeping the bucket type private to its handler means the bucketing can evolve without coupling other decision-support handlers.
- **Walkthrough** - three members: `Accepted`, `AcceptQueue`, `Pending` (`:94-99`). Note there is no `Declined` member: declined sessions are excluded upstream by `IsDeclined` (`:114`) before bucketing, so the enum only spans the statuses that count toward a category's totals.
- **Why it's built this way** - declined proposals do not contribute to the distribution an organizer is weighing, so filtering them out before the enum stage keeps the three live buckets clean. Keeping the enum private to the handler avoids a false shared dependency with the sibling dashboard handler that keeps its own copy.
- **Where it's used** - inside [GetCategoryDistributionHandler](#getcategorydistributionhandler) only (`CountSessionsPerCategoryItem` and `ClassifyStatus`).

### EventNameRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:13` · Level 5 · class (sealed, generic)

- **What it is** - a reusable rule fragment for the event name: non-empty and bounded by `EventInvariants.NameMaxLength` (500 characters).
- **Depends on** - [RequiredStringRules<T>](group-06-validation.md#requiredstringrulest) (its base class), [EventInvariants](group-17-conference-domain.md#eventinvariants).
- **Concept introduced** - same reusable field-rule pattern as [EventDateRangeRules<T>](#eventdaterangerulest), but this fragment inherits `RequiredStringRules<T>` rather than `AbstractValidator<T>` directly, delegating the `NotEmpty` + `MaximumLength` wiring to the shared base. `[Rubric §4 - DDD]` assesses ubiquitous language in code: the class is named `EventNameRules`, naming the domain field rather than a generic "NameValidator".
- **Walkthrough** - one constructor, one base call: `base(selector, "Event Name", EventInvariants.NameMaxLength)` (`:16-17`). No body logic; all behavior lives in the parent.
- **Why it's built this way** - the length constant `EventInvariants.NameMaxLength` (`EventInvariants.cs:13`) is the same value the EF configuration uses for the column's `HasMaxLength`, so the database constraint and the validation message share one source of truth and cannot drift.
- **Where it's used** - composed into the event create and update command validators.

### EventTimeZoneRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:25` · Level 5 · class (sealed, generic)

- **What it is** - a rule fragment for an event's time zone: non-empty, bounded by `EventInvariants.TimeZoneMaxLength` (100 characters), and a semantic check that the value is a recognizable IANA time-zone identifier (BR-87).
- **Depends on** - [EventInvariants](group-17-conference-domain.md#eventinvariants); `System.TimeZoneInfo` (BCL). Inherits `AbstractValidator<T>` directly.
- **Concept introduced** - same fragment shape as [EventNameRules<T>](#eventnamerulest), but it needs a custom predicate beyond string length, so it extends `AbstractValidator<T>` and adds a `Must(BeAValidIanaTimeZone)` rule (`:32`). `[Rubric §24 - Forms/Validation/UX Safety]` - validating that the string actually resolves to a runtime time zone stops an invalid identifier from reaching scheduling logic.
- **Walkthrough** - the constructor chains `NotEmpty` (`:30`), `MaximumLength` (`:31`), and `Must(BeAValidIanaTimeZone)` (`:32`), each with its own error code. `BeAValidIanaTimeZone` (`:34-48`) returns `true` for whitespace (`:37`) because `NotEmpty` already covers that branch, then calls `TimeZoneInfo.FindSystemTimeZoneById` inside a `try` and returns `false` only on `TimeZoneNotFoundException`.
- **Why it's built this way** - returning `true` for the empty case avoids emitting two error messages for the same missing field. Delegating the identifier check to `TimeZoneInfo` reuses the platform's canonical time-zone database instead of hand-maintaining a list.
- **Caveats / not-in-source** - `FindSystemTimeZoneById` resolves against the host OS time-zone database; whether a given identifier is recognized can differ across operating systems. That runtime dependency is not something the rule itself can guarantee.
- **Where it's used** - composed into the event create and update command validators.

### RoomAccessibilityInfoRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:77` · Level 5 · class (sealed, generic)

- **What it is** - a rule fragment bounding a room's optional accessibility-info text to `EventInvariants.RoomAccessibilityInfoMaxLength` (500 characters).
- **Depends on** - [EventInvariants](group-17-conference-domain.md#eventinvariants). Inherits `AbstractValidator<T>`.
- **Concept introduced** - same fragment pattern as [EventNameRules<T>](#eventnamerulest). The field is nullable (`string?`), so the fragment applies `MaximumLength` only (`:82`), with no `NotEmpty`; a null value is silently accepted.
- **Walkthrough** - one constructor, one `MaximumLength(EventInvariants.RoomAccessibilityInfoMaxLength)` rule with error code `Room.AccessibilityInfo.MaxLength` (`:80-82`).
- **Why it's built this way** - the length constant is shared with the EF column configuration, keeping the DB constraint and the UI message aligned.
- **Where it's used** - composed into the room create and update command validators.

### RoomFloorRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:51` · Level 5 · class (sealed, generic)

- **What it is** - a rule fragment bounding a room's optional floor label to `EventInvariants.RoomFloorMaxLength` (100 characters).
- **Depends on** - [EventInvariants](group-17-conference-domain.md#eventinvariants). Inherits `AbstractValidator<T>`.
- **Concept introduced** - identical shape to [RoomAccessibilityInfoRules<T>](#roomaccessibilityinforulest): nullable `string?` field, `MaximumLength` only, no `NotEmpty`.
- **Walkthrough** - one `MaximumLength(EventInvariants.RoomFloorMaxLength)` rule with error code `Room.Floor.MaxLength` (`:55-56`).
- **Where it's used** - composed into the room create and update command validators.

### RoomLocationRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:64` · Level 5 · class (sealed, generic)

- **What it is** - a rule fragment bounding a room's optional location text to `EventInvariants.RoomLocationMaxLength` (255 characters).
- **Depends on** - [EventInvariants](group-17-conference-domain.md#eventinvariants). Inherits `AbstractValidator<T>`.
- **Concept introduced** - identical shape to [RoomFloorRules<T>](#roomfloorrulest): nullable field, `MaximumLength` only.
- **Walkthrough** - one `MaximumLength(EventInvariants.RoomLocationMaxLength)` rule with error code `Room.Location.MaxLength` (`:67-69`).
- **Where it's used** - composed into the room create and update command validators.

### RoomNameRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:12` · Level 5 · class (sealed, generic)

- **What it is** - a rule fragment for a room's name: non-empty and bounded by `EventInvariants.RoomNameMaxLength` (255 characters). Unlike the other room fragments, the name is required.
- **Depends on** - [EventInvariants](group-17-conference-domain.md#eventinvariants). Inherits `AbstractValidator<T>`.
- **Concept introduced** - same fragment pattern as [EventNameRules<T>](#eventnamerulest), but implemented directly on `AbstractValidator<T>` (not `RequiredStringRules<T>`), chaining `NotEmpty` then `MaximumLength`.
- **Walkthrough** - the constructor chains `NotEmpty` (error code `Room.Name.Required`) and `MaximumLength(EventInvariants.RoomNameMaxLength)` (error code `Room.Name.MaxLength`) on the selector (`:16-18`).
- **Why it's built this way** - the required name distinguishes this fragment from the nullable room fields; keeping it a separate fragment lets a validator compose exactly the required-vs-optional mix each command needs.
- **Where it's used** - composed into the room create and update command validators.

### GetCategoryDistributionHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetCategoryDistribution/GetCategoryDistributionHandler.cs:14` · Level 8 · class (sealed)

- **What it is** - the query handler that computes, per category item, how many of an event's sessions were submitted, accepted, in the accept-queue, and pending. It powers the organizer's category-distribution view.
- **Depends on** - [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) (implemented), [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (injected), [Session](group-17-conference-domain.md#session) and [Category](group-17-conference-domain.md#category) (repository entities), [SessionStatuses](group-17-conference-domain.md#sessionstatuses), and the output DTOs [CategoryDistributionDTO](group-17-conference-domain.md#categorydistributiondto), [CategoryGroupDistribution](group-17-conference-domain.md#categorygroupdistribution), and [CategoryItemDistribution](group-17-conference-domain.md#categoryitemdistribution). Uses the nested [StatusBucket](#statusbucket) enum.
- **Concept introduced** - an in-memory analytics read handler. It loads two aggregates untracked, then does all bucketing and grouping in memory rather than pushing aggregation into SQL. `[Rubric §6 - CQRS & Event-Driven]` assesses the read path: this is a pure query, returning a `Result<CategoryDistributionDTO>` and mutating nothing. `[Rubric §12 - Performance & Scalability]` assesses read efficiency: both repository loads pass `asTracking: false` (`:27`, `:32`) so EF skips change-tracking overhead for a read-only projection.
- **Walkthrough** - `HandleAsync` (`:17`) resolves a `Session` repository and a `Category` repository from the unit of work (`:21-22`). It loads sessions for the event, including `SessionCategoryItems`, filtered to `EventId == query.EventId && !s.IsServiceSession` (`:24-28`), and loads all categories with their `CategoryItems` (`:30-33`). `CountSessionsPerCategoryItem` (`:41`) flattens each non-declined session into `(CategoryItemId, StatusBucket)` pairs (excluding soft-deleted category-item links via `!sci.IsDeleted`, `:47`), then tallies a running `(Total, Accepted, AcceptQueue, Pending)` tuple per category item (`:50-61`). `ClassifyStatus` (`:101`) treats a null status or `SessionStatuses.Accepted` as `Accepted`, `SessionStatuses.AcceptQueue` as `AcceptQueue`, and everything else as `Pending`, all via `OrdinalIgnoreCase` comparison; `IsDeclined` (`:114`) removes declined sessions up front. `BuildCategoryGroups` (`:66`) keeps only non-deleted categories that have at least one counted item, orders categories and items by their `Sort`, and projects each into `CategoryItemDistribution` rows (`:82-90`). The handler wraps the assembled list in `Result.Success(new CategoryDistributionDTO { ... })` (`:38`).
- **Why it's built this way** - aggregating in memory keeps the logic engine-agnostic (the same handler runs against any `IUnitOfWork`-backed store) and expresses the domain rules (service sessions excluded, declined excluded, soft-deletes excluded) in one readable pass rather than in a SQL statement. The trade-off is that it materializes the event's sessions and categories in full; that is acceptable for a single event's proposal set.
- **Where it's used** - dispatched via [GetCategoryDistributionQuery](#getcategorydistributionquery) from the Conference decision-support endpoints, and composed into the session-selection dashboard.

### GetContentSimilarityHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetContentSimilarity/GetContentSimilarityHandler.cs:14` · Level 8 · class (sealed)

- **What it is** - the query handler that finds pairs of similar-content sessions in an event, scoring every candidate pair and returning the strongest matches above a threshold.
- **Depends on** - [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult), [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork), [Session](group-17-conference-domain.md#session) and [Category](group-17-conference-domain.md#category), [SessionStatuses](group-17-conference-domain.md#sessionstatuses), [SessionSimilarityCalculator](#sessionsimilaritycalculator), and the DTOs [ContentSimilarityDTO](group-17-conference-domain.md#contentsimilaritydto) and [SimilarSessionPair](group-17-conference-domain.md#similarsessionpair).
- **Concept introduced** - a pairwise (O(n^2)) analytics handler with a hard result cap. `[Rubric §12 - Performance & Scalability]` assesses cost control on a quadratic path: the private `const int MaxPairs = 50` (`:17`) caps the returned list, and both repository loads use `asTracking: false` (`:32`, `:38`). The scoring math itself is delegated to the pure [SessionSimilarityCalculator](#sessionsimilaritycalculator), keeping the handler focused on orchestration.
- **Walkthrough** - `HandleAsync` (`:19`) loads all non-service, non-declined sessions with their category items (`:27-33`) and all categories with items (`:36-39`), then builds a `CategoryItemIdentifierType -> name` lookup (`:41-48`). For each session it pre-computes a `HashSet` of non-deleted category-item ids and a keyword set via `SessionSimilarityCalculator.TokenizeText(s.Title + " " + s.Description)` (`:51-59`). It then double-loops over the session list (`:64-79`), calling `SessionSimilarityCalculator.CalculateSimilarity` per pair and keeping only pairs scoring at or above `query.MinimumSimilarity` (`:74`). Pairs are sorted by score descending (`:82`) and truncated to `MaxPairs` (`:83-86`). Finally each kept pair is projected into a `SimilarSessionPair` (`:89-111`): the score is rounded to three digits with `MidpointRounding.ToEven` (`:105`), shared category items are resolved to names via `GetIntersection` (`:94`, `:106-108`), and shared keywords are taken (up to 10) from the keyword intersection (`:95`, `:109`). The result is wrapped in `Result.Success(new ContentSimilarityDTO { Pairs = result })` (`:113`).
- **Why it's built this way** - pre-computing each session's keyword and category sets once, before the pairwise loop, avoids re-tokenizing inside the O(n^2) comparison. The `MaxPairs` cap and the score threshold together bound both compute and payload size, so a large proposal set cannot produce an unbounded response.
- **Where it's used** - dispatched via [GetContentSimilarityQuery](#getcontentsimilarityquery) from the Conference decision-support endpoints, and composed into the session-selection dashboard.

### ExportEventCalendarQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` · `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportEventCalendarQuery.cs:5` · Level 0 · record

- **What it is**: the read request that asks for a published event's whole schedule rendered as an RFC 5545 (`.ics`) calendar document. A one-field `sealed record` carrying the `EventId` to export (`ExportEventCalendarQuery.cs:5`).
- **Depends on**: the `EventIdentifierType` alias (see [identifier aliases](00-primer.md#2-architectural-styles-this-codebase-commits-to)). No externals beyond the BCL.
- **Concept introduced: the request record as a CQRS message.** This is the first type in this unit, so the shape is worth stating once: every decision-support and calendar use case in this unit is a positional `sealed record` that names exactly the inputs its handler needs and nothing else. It is dispatched through the [CQRS decorator pipeline](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) (Logging then Caching then handler for queries) and matched to its handler by the generic argument. [Rubric §6, CQRS and Event-Driven] assesses whether reads and writes are modeled as explicit messages: here the intent (export one event's calendar) is a named type, not a method-parameter bag.
- **Walkthrough**: a single `EventId` positional parameter (`:5`); the compiler-generated equality and `init` immutability come for free from `record`.
- **Why it's built this way**: ADR-042 Wave 5 (cited in the doc comment, `:3`) adds calendar export as a public-read affordance; keeping the query minimal lets the handler own all the publish/exportability rules.
- **Where it's used**: handled by [ExportEventCalendarHandler](#exporteventcalendarhandler); reached from the Conference REST calendar endpoint (Group 19).

### ExportSessionCalendarQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` · `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportSessionCalendarQuery.cs:5` · Level 0 · record

- **What it is**: the single-session variant of the calendar export: it asks for one public session rendered as an `.ics` document, for the "add to calendar" affordance. A one-field `sealed record` carrying the `SessionId` (`ExportSessionCalendarQuery.cs:5`).
- **Depends on**: the `SessionIdentifierType` alias. No externals beyond the BCL.
- **Concept introduced**: none new; this is the sibling of [ExportEventCalendarQuery](#exporteventcalendarquery), differing only in that it identifies a single session rather than a whole event. [Rubric §6, CQRS and Event-Driven].
- **Walkthrough**: a single `SessionId` positional parameter (`:5`).
- **Why it's built this way**: same ADR-042 Wave 5 lineage (`:3`); a separate query keeps the one-session public rules distinct from the whole-event export.
- **Where it's used**: handled by [ExportSessionCalendarHandler](#exportsessioncalendarhandler).

### GetSessionSelectionDashboardQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSessionSelectionDashboard/GetSessionSelectionDashboardQuery.cs:5` · Level 0 · record

- **What it is**: the read request for the composite session-selection dashboard: given one `EventId`, produce category distribution, speaker overlap, speaker locality, and AI scores in a single result. A one-field `sealed record` (`GetSessionSelectionDashboardQuery.cs:5`).
- **Depends on**: the `EventIdentifierType` alias. No externals.
- **Concept introduced**: none new; same request-record shape as [ExportEventCalendarQuery](#exporteventcalendarquery). What makes it interesting is the handler, which fans one query out into four analytics computed off a single data load. [Rubric §6, CQRS and Event-Driven].
- **Walkthrough**: a single `EventId` positional parameter (`:5`).
- **Why it's built this way**: a composite query (one round trip, one message) is the decision-support answer to running four separate analytics queries: see [GetSessionSelectionDashboardHandler](#getsessionselectiondashboardhandler).
- **Where it's used**: handled by [GetSessionSelectionDashboardHandler](#getsessionselectiondashboardhandler); returns a [SessionSelectionDashboardDTO](group-17-conference-domain.md#sessionselectiondashboarddto).

### GetSpeakerSessionOverlapQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSpeakerSessionOverlap` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSpeakerSessionOverlap/GetSpeakerSessionOverlapQuery.cs:5` · Level 0 · record

- **What it is**: the read request that asks, for one event, which speakers submitted more than one session (and, in practice, every speaker with their submitted sessions so the UI can surface multi-session speakers first). A one-field `sealed record` carrying the `EventId` (`GetSpeakerSessionOverlapQuery.cs:5`).
- **Depends on**: the `EventIdentifierType` alias. No externals.
- **Concept introduced**: none new; same request-record shape as [ExportEventCalendarQuery](#exporteventcalendarquery). [Rubric §6, CQRS and Event-Driven].
- **Walkthrough**: a single `EventId` positional parameter (`:5`).
- **Why it's built this way**: the speaker-overlap analysis is one focused slice of the dashboard, exposed on its own query so the UI can request just that view.
- **Where it's used**: handled by [GetSpeakerSessionOverlapHandler](#getspeakersessionoverlaphandler); returns a [SpeakerSessionOverlapDTO](group-17-conference-domain.md#speakersessionoverlapdto).

### ScoreEventSessionsCommand
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsCommand.cs:5` · Level 0 · record

- **What it is**: the write request that triggers AI scoring for every session in an event. A one-field `sealed record` carrying the `EventId` whose sessions to score (`ScoreEventSessionsCommand.cs:5`).
- **Depends on**: the `EventIdentifierType` alias. No externals.
- **Concept introduced**: this is the one **command** among the sibling request records in this unit. It is structurally identical to the query records (a single-field `sealed record`), but it dispatches through the command side of the pipeline ([ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)), which adds the Validating and Transactional decorators the query side does not carry. [Rubric §6, CQRS and Event-Driven] is precisely the split modeled here: a read (dashboard/overlap) and a write (score) that happen to share a shape are still separate message types on separate pipelines.
- **Walkthrough**: a single `EventId` positional parameter (`:5`).
- **Why it's built this way**: scoring mutates persistence (it deletes and rewrites [SessionAiScore](group-17-conference-domain.md#sessionaiscore) rows), so it is a command, not a query; keeping it a distinct message makes that read/write asymmetry explicit.
- **Where it's used**: handled by [ScoreEventSessionsHandler](#scoreeventsessionshandler); returns a [ScoreEventSessionsResultDTO](group-17-conference-domain.md#scoreeventsessionsresultdto).

### SessionScoringResult
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/IAiScoringService.cs:40` · Level 0 · record

- **What it is**: the internal result of scoring one session via [IAiScoringService](#iaiscoringservice). It carries seven numeric sub-scores (each documented `1.0-10.0` decimal), a free-text `Reasoning`, the `SessionId`, and a `Success` flag. It never throws: a failed AI call returns this record with `Success = false` (`IAiScoringService.cs:40-71`).
- **Depends on**: the `SessionIdentifierType` alias (on `SessionId`, `:43`). No first-party types; every property is `required init`.
- **Concept introduced: never-throw service results.** Rather than propagate exceptions from the AI call, `ScoreSessionAsync` returns this record in every case and the handler branches on `Success`. This is the Result philosophy (see [Result](group-01-result-error-handling.md#result)) applied to an unreliable network dependency: the scoring loop cannot be aborted by one bad session. [Rubric §29, Resilience and Business Continuity] assesses how failure of a dependency is contained; here it is demoted to a per-item flag rather than an exception that unwinds the whole batch.
- **Walkthrough**: `required init` members (`:43-70`): `SessionId`, `OverallScore`, `TopicRelevanceScore`, `DescriptionQualityScore`, `NoveltyScore`, `ActionableTakeawaysScore`, `DepthOrInsightQualityScore`, `CredibilityExperienceScore`, `Reasoning`, `Success`. `required` on all of them means a scorer implementation cannot forget to populate one.
- **Why it's built this way**: separating this Application-layer result from the external [SessionAiScoreDTO](group-17-conference-domain.md#sessionaiscoredto) lets the scoring contract evolve (add or drop a sub-score) without immediately breaking the API surface.
- **Where it's used**: returned by `IAiScoringService.ScoreSessionAsync` and consumed by [ScoreEventSessionsHandler](#scoreeventsessionshandler), which maps a successful one into a [SessionAiScore](group-17-conference-domain.md#sessionaiscore) domain row.

### SpeakerInfo
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/IAiScoringService.cs:23` · Level 0 · record

- **What it is**: the minimal speaker payload the AI scorer needs: `FullName`, optional `TagLine`, optional `Bio`. A positional `sealed record` (`IAiScoringService.cs:23-26`).
- **Depends on**: nothing first-party; three `string`/`string?` fields.
- **Concept introduced: least-privilege data passing.** The record deliberately carries only what the model reads (name, tagline, bio) and no ids, contact fields, or other PII. [Rubric §11, Security] and [Rubric §30, Compliance/Privacy] both assess how much data crosses a boundary to a third party: shipping a purpose-built projection to the AI vendor rather than a whole [Speaker](group-17-conference-domain.md#speaker) limits what leaves the trust boundary.
- **Walkthrough**: three positional parameters (`:23-26`); the doc comments note the source-side max lengths (`TagLine` 500, `Bio` 4000) that the domain enforces upstream.
- **Why it's built this way**: a narrow record keeps the scoring prompt small and avoids leaking speaker identity to the external model.
- **Where it's used**: nested inside [SessionScoringInput](#sessionscoringinput); populated by [ScoreEventSessionsHandler](#scoreeventsessionshandler) from each [Speaker](group-17-conference-domain.md#speaker)'s `FullName`/`TagLine`/`Bio`.

### StatusBucket
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSessionSelectionDashboard/GetSessionSelectionDashboardHandler.cs:308` · Level 0 · enum

- **What it is**: a private three-member enum (`Accepted`, `AcceptQueue`, `Pending`) that classifies a session's status string into the buckets the category-distribution aggregation counts (`GetSessionSelectionDashboardHandler.cs:308-313`).
- **Depends on**: conceptually on [SessionStatuses](group-17-conference-domain.md#sessionstatuses), the string constants the classifier compares against.
- **Concept introduced: a handler-private classification vocabulary.** The enum is declared `private` inside the handler and never leaves it; callers receive aggregated counts on the DTO, never bucket values. Modeling the three-way status collapse as a named enum keeps the counting code readable versus repeating `string.Equals(..., Accepted)` comparisons inline. [Rubric §16, Maintainability].
- **Walkthrough**: `ClassifyStatus(Session)` (`:315-326`) maps a null-or-`Accepted` status to `StatusBucket.Accepted`, `AcceptQueue` to `StatusBucket.AcceptQueue`, and everything else to `StatusBucket.Pending`; the enum is then consumed by `CountCategoryItems` (`:127-150`) to tally each category item.
- **Why it's built this way**: keeping the bucket private to this handler means its bucketing can diverge from any other dashboard's without coupling the two use cases (a sibling copy historically lived in the retired `GetCategoryDistribution` handler).
- **Where it's used**: inside [GetSessionSelectionDashboardHandler](#getsessionselectiondashboardhandler) only.

### SessionScoringInput
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/IAiScoringService.cs:33` · Level 1 · record

- **What it is**: the full input for scoring one session: `SessionId`, `Title`, optional `Description`, and the list of [SpeakerInfo](#speakerinfo) records for the session's speakers. A positional `sealed record` (`IAiScoringService.cs:33-37`).
- **Depends on**: [SpeakerInfo](#speakerinfo) (Level 0, same file `:23`), via `IReadOnlyList<SpeakerInfo>`; the `SessionIdentifierType` alias. Referencing a Level-0 first-party type is what puts this record at Level 1.
- **Concept introduced**: none new; it is the request DTO for [IAiScoringService](#iaiscoringservice), assembling exactly what the model prompt needs (title, description, speaker bios) and nothing more, extending the least-privilege discipline [SpeakerInfo](#speakerinfo) sets. [Rubric §6, CQRS and Event-Driven].
- **Walkthrough**: four positional parameters (`:33-37`); `Speakers` may be empty (documented at `:32`), so a speaker-less session still scores.
- **Why it's built this way**: a purpose-built input record keeps the port contract stable and testable with a fake scorer.
- **Where it's used**: constructed by [ScoreEventSessionsHandler](#scoreeventsessionshandler) per session and passed to `IAiScoringService.ScoreSessionAsync`.

### IAiScoringService
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/IAiScoringService.cs:6` · Level 2 · interface

- **What it is**: the application-layer **port** for scoring a single conference session with an AI model. Its contract guarantees it never throws: failure is reported through the returned [SessionScoringResult](#sessionscoringresult)'s `Success` flag (`IAiScoringService.cs:6-17`).
- **Depends on**: [SessionScoringInput](#sessionscoringinput) (Level 1, `:33`) as the argument and [SessionScoringResult](#sessionscoringresult) (Level 0, `:40`) as the return; BCL `Task`/`CancellationToken` otherwise.
- **Concept introduced: a port/adapter boundary for an external AI capability.** The Application layer declares the interface; the Anthropic HTTP and JSON details live in an Infrastructure adapter (`AnthropicScoringService`), so the vendor SDK never reaches Application. [Rubric §3, Clean Architecture] assesses whether outward dependencies are inverted behind an abstraction, which this does exactly, and [Rubric §1, SOLID] (the Dependency Inversion Principle) is the same story: the handler depends on this port, not a concrete API client. The "never throws" clause (documented at `:9`) also ties to [Rubric §29, Resilience and Business Continuity].
- **Walkthrough**: `ScoreSessionAsync(SessionScoringInput, CancellationToken)` (`:11-13`) returns the per-session result; `ModelId` (`:16`) exposes which model produced the score, so persisted rows can record the model used for auditability.
- **Why it's built this way**: defining the port in Application lets the scoring use case be unit-tested with a fake scorer and lets the AI vendor be swapped without touching [ScoreEventSessionsHandler](#scoreeventsessionshandler).
- **Where it's used**: injected into [ScoreEventSessionsHandler](#scoreeventsessionshandler); implemented by the Infrastructure `AnthropicScoringService` adapter (Group 20).

### CalendarExportMapper
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` · `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/CalendarExportMapper.cs:13` · Level 7 · class

- **What it is**: an `internal static` helper that decides whether a session can appear in a public calendar and maps an exportable one to an [IcsEvent](group-08-auth.md#icsevent), converting the event-zone wall-clock times to UTC with explicit DST discipline (`CalendarExportMapper.cs:13`).
- **Depends on**: [Session](group-17-conference-domain.md#session) and [Event](group-17-conference-domain.md#event) (Conference domain), [IcsEvent](group-08-auth.md#icsevent) (the calendar builder's entry type in `MMCA.Common.Shared.Calendars`), and BCL `TimeZoneInfo`/`DateTimeOffset`.
- **Concept introduced: wall-clock to UTC conversion at the layer boundary.** The calendar builder is UTC-only by contract, but sessions store times as wall-clock local to the event's IANA time zone. `ToUtc` (`:41-50`) resolves that gap the same way the reminder planner does: it specifies the kind as `Unspecified`, and if `TimeZoneInfo.IsInvalidTime` reports the instant falls in a spring-forward gap (`:44`), it shifts ahead one hour before computing the offset. The deterministic DST handling is a correctness safeguard [Rubric §16, Maintainability].
- **Walkthrough**:
  - `ProductId` (`:16`): the RFC 5545 `PRODID` constant `-//MMCA//AtlDevCon//EN` stamped on every ADC calendar.
  - `IsExportable(Session)` (`:19-22`): true only when the session has both `StartsAt` and `EndsAt`, is not a service session, and is not `Declined`/`Cancelled` (case-insensitive): the single source of truth for public exportability, reused by both handlers.
  - `ToIcsEvent(Session, Event, TimeZoneInfo, string?)` (`:25-38`): builds a stable UID (`session-{Id}@atldevcon`), joins the room name and venue address into a location string, and converts start/end via `ToUtc`.
  - `ToUtc(DateTime, TimeZoneInfo)` (`:41-50`): the DST-aware conversion described above.
- **Why it's built this way**: centralizing the exportability rule and the time conversion in one internal helper keeps the two calendar handlers thin and guarantees they agree on what "public" and "UTC" mean (ADR-042 Wave 5).
- **Where it's used**: by [ExportEventCalendarHandler](#exporteventcalendarhandler) and [ExportSessionCalendarHandler](#exportsessioncalendarhandler); the resulting `IcsEvent` list is handed to [IcsCalendarBuilder](group-08-auth.md#icscalendarbuilder).

### ExportEventCalendarHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` · `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportEventCalendarHandler.cs:15` · Level 8 · class

- **What it is**: the query handler that produces a whole-schedule `.ics` string for a published event: every exportable session becomes one VEVENT with its room in the location. Unpublished or unknown events return NotFound (`ExportEventCalendarHandler.cs:15`).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (for the [Event](group-17-conference-domain.md#event) and [Session](group-17-conference-domain.md#session) repositories), [CalendarExportMapper](#calendarexportmapper), [IcsCalendarBuilder](group-08-auth.md#icscalendarbuilder), and the [Result](group-01-result-error-handling.md#result)/[Error](group-01-result-error-handling.md#error) types. Implements [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) of [ExportEventCalendarQuery](#exporteventcalendarquery) to `Result<string>`.
- **Concept introduced: public-read handlers leak nothing.** The handler treats "unpublished" and "not found" identically: if the event is missing or `!IsPublished` it returns `Error.NotFound` (`:28-32`), so a caller cannot distinguish an unpublished event from a nonexistent one. [Rubric §11, Security] assesses exactly this kind of existence-hiding on public endpoints.
- **Walkthrough**:
  1. Load the event with its `Rooms` child collection eagerly included (`:25-27`); rooms are children of the Event aggregate and have no repository of their own (note at `:24`).
  2. Guard: null or unpublished then NotFound (`:28-32`).
  3. Load all non-deleted sessions for the event via a filtered `GetAllAsync` (`:34-36`) and build a room-id to name dictionary (`:37`).
  4. Resolve the event's IANA zone via `TimeZoneInfo.FindSystemTimeZoneById(@event.TimeZone)` (`:39`).
  5. Filter to `CalendarExportMapper.IsExportable`, order by `StartsAt`, and map each to an `IcsEvent`, resolving each session's room name from the dictionary (`:40-48`).
  6. Hand the entries to `IcsCalendarBuilder.Build` with the `ProductId` and current UTC timestamp, and return the string as `Result.Success` (`:50-51`).
- **Why it's built this way**: ADR-042 Wave 5: rendering the schedule server-side keeps the RFC 5545 formatting in one shared builder and lets the read endpoint be output-cached like the other Conference public reads.
- **Where it's used**: invoked from the Conference calendar REST endpoint (Group 19); the `string` payload is served as an `.ics` download.

### ExportSessionCalendarHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` · `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportSessionCalendarHandler.cs:16` · Level 8 · class

- **What it is**: the single-session sibling of [ExportEventCalendarHandler](#exporteventcalendarhandler): it produces a one-VEVENT `.ics` document for the public add-to-calendar affordance, enforcing the same public-read rules (`ExportSessionCalendarHandler.cs:16`).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork), [CalendarExportMapper](#calendarexportmapper), [IcsCalendarBuilder](group-08-auth.md#icscalendarbuilder), [Result](group-01-result-error-handling.md#result)/[Error](group-01-result-error-handling.md#error). Implements [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) of [ExportSessionCalendarQuery](#exportsessioncalendarquery) to `Result<string>`.
- **Concept introduced**: none new; it applies the same existence-hiding discipline [ExportEventCalendarHandler](#exporteventcalendarhandler) introduces, just with two guards instead of one. [Rubric §11, Security].
- **Walkthrough**:
  1. Load the session by id; if null or not `CalendarExportMapper.IsExportable`, return NotFound targeting `Session` (`:25-31`).
  2. Load the owning event with `Rooms` included; if null or unpublished, return NotFound targeting `Event` (`:34-41`): a session on an unpublished event stays hidden.
  3. Resolve the session's room name from the event's rooms (`:43-45`) and the IANA time zone (`:47`).
  4. Build a one-entry calendar via `IcsCalendarBuilder.Build` and return `Result.Success` (`:48-53`).
- **Why it's built this way**: a dedicated one-session path (rather than filtering the whole-event export) keeps the add-to-calendar button cheap and the leak-prevention guards explicit (ADR-042 Wave 5).
- **Where it's used**: the Conference session detail page's add-to-calendar affordance (Group 19/21).

### GetSessionSelectionDashboardHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSessionSelectionDashboard/GetSessionSelectionDashboardHandler.cs:16` · Level 8 · class

- **What it is**: the composite decision-support handler: it loads an event's sessions, categories, speakers, and AI scores once, then computes summary counts, category distribution, speaker overlap, speaker locality, and the AI-score table into a single [SessionSelectionDashboardDTO](group-17-conference-domain.md#sessionselectiondashboarddto) (`GetSessionSelectionDashboardHandler.cs:16`).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) and the [Event](group-17-conference-domain.md#event)/[Session](group-17-conference-domain.md#session)/[Speaker](group-17-conference-domain.md#speaker)/[Category](group-17-conference-domain.md#category)/[SessionAiScore](group-17-conference-domain.md#sessionaiscore) repositories; `SpeakerLocalityHelper` and [SessionStatuses](group-17-conference-domain.md#sessionstatuses); the dashboard DTO family ([CategoryDistributionDTO](group-17-conference-domain.md#categorydistributiondto), [CategoryGroupDistribution](group-17-conference-domain.md#categorygroupdistribution), [CategoryItemDistribution](group-17-conference-domain.md#categoryitemdistribution), [SpeakerSessionOverlapDTO](group-17-conference-domain.md#speakersessionoverlapdto), [MultiSessionSpeaker](group-17-conference-domain.md#multisessionspeaker), [SpeakerSessionSummary](group-17-conference-domain.md#speakersessionsummary), [SpeakerLocalitySummary](group-17-conference-domain.md#speakerlocalitysummary), [SessionAiScoreDTO](group-17-conference-domain.md#sessionaiscoredto)). Implements [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) of [GetSessionSelectionDashboardQuery](#getsessionselectiondashboardquery) to `Result<SessionSelectionDashboardDTO>`.
- **Concept introduced: load-once, compute-many for read performance.** The handler deliberately issues a small fixed set of reads (event validation, then sessions, categories, speakers by id, AI scores) and derives all four analytics in memory from those materialized collections, rather than running a separate query per panel. The comment at `:33` calls out that the loads are sequential for EF single-context safety (a `DbContext` is not concurrency-safe). [Rubric §12, Performance and Scalability] assesses read-path efficiency: one bounded batch of no-tracking reads (`asTracking: false`, e.g. `:37`, `:42`, `:55`) beats N per-panel round trips.
- **Walkthrough**:
  1. Resolve the four repositories, then validate the event exists, else NotFound (`:23-31`).
  2. Load non-service sessions with `SessionSpeakers`/`SessionCategoryItems` included, all categories with `CategoryItems`, and the distinct speakers via `GetByIdsAsync` with `SpeakerCategoryItems` (`:34-57`).
  3. Build category-item name and locality lookups (`SpeakerLocalityHelper.FindLocalityCategory`/`BuildLocalityLookup`, `:60-70`).
  4. Compute summary counts (total, accepted, accept-queue, declined, and pending as the remainder) using [SessionStatuses](group-17-conference-domain.md#sessionstatuses) comparisons (`:73-80`).
  5. Compute `categoryDistribution` (`ComputeCategoryDistribution`, `:118-178`, which classifies each session via the private [StatusBucket](#statusbucket) enum), `speakerOverlap` (`ComputeSpeakerOverlap`, `:180-247`), and `speakerLocality` (`ComputeSpeakerLocality`, `:249-306`).
  6. Load the `SessionAiScore` rows for these sessions and map them to `SessionAiScoreDTO`s, splitting out the "Level" category and each session's speaker localities (`BuildAiScoreDtos`, `:331-354`).
  7. Assemble and return the composite DTO (`:102-115`).
- **Why it's built this way**: a single composite endpoint backs an organizer dashboard that shows all four analytics at once; computing them from one shared load avoids re-reading the same sessions four times.
- **Where it's used**: the Conference session-selection dashboard page (Group 21); the same overlap computation is also exposed standalone by [GetSpeakerSessionOverlapHandler](#getspeakersessionoverlaphandler).
- **Caveats / not-in-source**: the private [StatusBucket](#statusbucket) enum and the private compute methods are implementation details of this handler and are not exposed to callers.

### GetSpeakerSessionOverlapHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSpeakerSessionOverlap` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSpeakerSessionOverlap/GetSpeakerSessionOverlapHandler.cs:18` · Level 8 · class

- **What it is**: the standalone speaker-overlap handler: it returns every speaker who submitted at least one session for an event, with their sessions, sorted so multi-session speakers surface first (session count descending, then accepted-session presence, then name) (`GetSpeakerSessionOverlapHandler.cs:18`).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) and the [Session](group-17-conference-domain.md#session)/[Speaker](group-17-conference-domain.md#speaker)/[Category](group-17-conference-domain.md#category) repositories; `SpeakerLocalityHelper`, [SessionStatuses](group-17-conference-domain.md#sessionstatuses), [SpeakerSessionOverlapDTO](group-17-conference-domain.md#speakersessionoverlapdto)/[MultiSessionSpeaker](group-17-conference-domain.md#multisessionspeaker)/[SpeakerSessionSummary](group-17-conference-domain.md#speakersessionsummary). Implements [IQueryHandler<in TQuery, TResult>](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) of [GetSpeakerSessionOverlapQuery](#getspeakersessionoverlapquery) to `Result<SpeakerSessionOverlapDTO>`.
- **Concept introduced**: none new; it reuses the same load-once-compute pattern and the same [MultiSessionSpeaker](group-17-conference-domain.md#multisessionspeaker) projection that the dashboard's `ComputeSpeakerOverlap` builds, exposed as its own focused query. [Rubric §6, CQRS and Event-Driven] and [Rubric §12, Performance and Scalability].
- **Walkthrough**:
  1. Load non-service sessions with `SessionSpeakers`/`SessionCategoryItems` included (`:29-33`).
  2. Group sessions by speaker id (`GroupSessionsBySpeaker`, `:61-82`), skipping soft-deleted join rows; short-circuit to an empty result when no speakers (`:38-39`).
  3. Load those speakers by id (with `SpeakerCategoryItems`) and all categories, then build the locality lookup and category-item name lookup (`:41-54`).
  4. Build the [MultiSessionSpeaker](group-17-conference-domain.md#multisessionspeaker) list (`BuildMultiSessionSpeakers`, `:99-140`), stamping each speaker's locality tier via `SpeakerLocalityHelper.GetLocalityTier` and whether any session is accepted, then sort by session count, accepted presence, and name (`:127-137`).
- **Why it's built this way**: organizers sometimes want just the overlap view without paying for the whole composite dashboard, so it is its own use case reusing the shared helper and DTOs.
- **Where it's used**: the Conference speaker-overlap page (Group 21); returns the same DTO shape the dashboard embeds.

### ScoreEventSessionsHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` · `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsHandler.cs:15` · Level 8 · class

- **What it is**: the command handler that scores every session in an event via [IAiScoringService](#iaiscoringservice), persisting each score immediately so the UI can show real-time progress (`ScoreEventSessionsHandler.cs:15`). A `sealed partial class` (partial for the source-generated log methods).
- **Depends on**: [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) and the [Session](group-17-conference-domain.md#session)/[SessionAiScore](group-17-conference-domain.md#sessionaiscore)/[Speaker](group-17-conference-domain.md#speaker) repositories; [IAiScoringService](#iaiscoringservice); `ILogger<ScoreEventSessionsHandler>`; [SpeakerInfo](#speakerinfo)/[SessionScoringInput](#sessionscoringinput)/[SessionScoringResult](#sessionscoringresult); [ScoreEventSessionsResultDTO](group-17-conference-domain.md#scoreeventsessionsresultdto). Implements [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) of [ScoreEventSessionsCommand](#scoreeventsessionscommand) to `Result<ScoreEventSessionsResultDTO>`.
- **Concept introduced: per-item save with contained failure, plus source-generated logging.** Two patterns meet here. First, resilience: the loop scores one session at a time and saves it individually (`:99-111`); a scorer failure, a domain-factory failure, or a save exception increments `failed` and `continue`s rather than aborting the batch (`:79-97`), and only an all-failed run returns `Error.Failure` (`:116-122`). This is the never-throw contract of [SessionScoringResult](#sessionscoringresult) carried up into batch orchestration. [Rubric §29, Resilience and Business Continuity]. Second, observability: every log call is a `[LoggerMessage]` `static partial` method (`:127-143`), the compiler-generated high-performance logging pattern that avoids boxing and template re-parsing. [Rubric §13, Observability and Operability].
- **Walkthrough**:
  1. Load non-service sessions (with `SessionSpeakers`) for the event; short-circuit to a zero-count success when none (`:27-34`).
  2. `ExecuteDeleteAsync` all existing scores for these sessions so the dashboard resets to zero and progress is visible from scratch (`:37-45`).
  3. Batch-load the distinct speakers and build a lookup (`:48-59`).
  4. For each session: project its non-deleted speakers into [SpeakerInfo](#speakerinfo), build a [SessionScoringInput](#sessionscoringinput), call `aiScoringService.ScoreSessionAsync` (`:66-77`); on a failed result or a failed `SessionAiScore.Create`, count it as failed and continue (`:79-97`); otherwise `AddAsync` and `SaveChangesAsync` per session, catching non-cancellation exceptions as a per-session failure (`:99-111`).
  5. Log completion and return the count DTO, or `Error.Failure` (`AiScoring.AllFailed`) when nothing scored and something failed (`:114-124`).
- **Why it's built this way**: saving per session gives the organizer live progress and means a mid-run failure keeps the scores already computed; the all-failed guard surfaces a misconfiguration (a missing Anthropic API key) as a single actionable error rather than a silent empty result.
- **Where it's used**: invoked from the Conference AI-scoring endpoint (Group 19); the resulting scores feed [GetSessionSelectionDashboardHandler](#getsessionselectiondashboardhandler)'s AI-score panel.
- **Caveats / not-in-source**: the actual AI call and model are supplied by the Infrastructure `AnthropicScoringService` adapter (Group 20); this handler only orchestrates the port.

### GetNowNextQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.NowNext` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextQuery.cs:11` · Level 0 · record

- **What it is**: the read request for the conference "happening now / up next" snapshot. A single optional field, `EventId`, selects the target event; passing `null` tells the handler to auto-select the current-or-next published event (`GetNowNextQuery.cs:11`).
- **Depends on**: the `EventIdentifierType` alias (Conference's `EventId` type, from the module's Shared project); no first-party types beyond that alias.
- **Concept introduced, the CQRS query record.** `[Rubric §6, CQRS & Event-Driven]` (assesses a real read/write split where reads are distinct request objects routed to their own handlers). A **query** is an immutable request-for-data object with no behavior: it names the read and carries its parameters, and nothing else. Here the whole type is one line, `public sealed record GetNowNextQuery(EventIdentifierType? EventId);`. It is dispatched through the shared handler pipeline to its [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult), [`GetNowNextHandler`](#getnownexthandler), which returns the answer as a [`Result<T>`](group-01-result-error-handling.md#result). `[Rubric §5, Vertical Slice]`: query, handler, and DTO for this one feature live together under a single `UseCases/NowNext` folder rather than being spread across layer-wide "Queries" and "Handlers" buckets.
- **Walkthrough**: a positional `record` with one nullable member, `EventId` (`GetNowNextQuery.cs:11`). The `null` sentinel is load-bearing: the doc comment (`GetNowNextQuery.cs:3-10`) records that the home-screen widget has no event id of its own, so it passes `null` and the handler features the live-or-next event.
- **Why it's built this way**: a `record` gives value equality and immutability for free, so a query can be safely cached or logged by key in the decorator pipeline; making the event optional lets one query serve both the event-scoped page and the global home widget without a second type.
- **Where it's used**: consumed by [`GetNowNextHandler`](#getnownexthandler); constructed by the now-next REST controller / home-surface endpoint in the Conference API layer.

### GetPublicSessionFilterQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionFilter` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterQuery.cs:9` · Level 0 · record

- **What it is**: a parameterless **marker query** that asks for the specification describing "publicly visible sessions" (non-declined, non-cancelled sessions whose parent event is published, BR-132 / BR-49).
- **Depends on**: nothing first-party; it is an empty positional-less record.
- **Concept, the marker query.** `[Rubric §6, CQRS & Event-Driven]`. Not every query carries parameters. This one is `public sealed record GetPublicSessionFilterQuery;` (`GetPublicSessionFilterQuery.cs:9`): it exists purely to select a handler through the pipeline. What comes back is not data but a reusable [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype) other read paths compose into their own queries, so the "what counts as a public session" rule lives in exactly one place.
- **Concept, cross-store filtering.** `[Rubric §8, Data Architecture]` (assesses how a rule that spans two physical stores is expressed without an illegal cross-database join). The doc comment (`GetPublicSessionFilterQuery.cs:3-8`) states the hard constraint: [`Session`](group-17-conference-domain.md#session) lives in Cosmos DB while [`Event`](group-17-conference-domain.md#event) lives in SQL Server, so the "parent event is published" check cannot be a navigation join. The handler resolves it with the framework cross-source helper instead (see [`GetPublicSessionFilterHandler`](#getpublicsessionfilterhandler)).
- **Walkthrough**: no members. The type is the request; all behavior is in [`GetPublicSessionFilterHandler`](#getpublicsessionfilterhandler).
- **Why it's built this way**: a marker record keeps the read strongly named and pipeline-routable even though it takes no arguments, and returning a specification (rather than materialized rows) lets both a paged public list and other reads share one definition of visibility.
- **Where it's used**: consumed by [`GetPublicSessionFilterHandler`](#getpublicsessionfilterhandler); the returned specification is applied by the public session-listing read endpoints.

### GetSessionBookmarkCountQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCount` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionBookmarkCount/GetSessionBookmarkCountQuery.cs:12` · Level 0 · record

- **What it is**: a speaker-facing query asking "how many attendees bookmarked my session" (BR-210). It carries the requesting `SpeakerId` and the target `SessionId` (`GetSessionBookmarkCountQuery.cs:12`).
- **Depends on**: the `SpeakerIdentifierType` and `SessionIdentifierType` aliases; no other first-party types (this is a request record like [`GetNowNextQuery`](#getnownextquery)).
- **Concept, ownership carried on the query.** `[Rubric §11, Security]` (assesses that authorization data travels with the request rather than being assumed). The query deliberately carries `SpeakerId` so the handler can verify the caller actually presents the session before revealing a count, the check happens in [`GetSessionBookmarkCountHandler`](#getsessionbookmarkcounthandler), not in the query itself. This is the same two-parameter shape as [`GetSessionFeedbackQuery`](#getsessionfeedbackquery).
- **Walkthrough**: a positional `record` with two members, `SpeakerId` then `SessionId` (`GetSessionBookmarkCountQuery.cs:12`). The doc comment (`GetSessionBookmarkCountQuery.cs:9-11`) documents each.
- **Why it's built this way**: passing the speaker identity as part of the read (rather than reaching into ambient context inside the handler) keeps the handler pure and unit-testable and makes the authorization dependency explicit.
- **Where it's used**: consumed by [`GetSessionBookmarkCountHandler`](#getsessionbookmarkcounthandler); constructed by the speaker-dashboard endpoint in the Conference API layer.

### GetSessionFeedbackQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionFeedback` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionFeedback/GetSessionFeedbackQuery.cs:14` · Level 0 · record

- **What it is**: a speaker-facing query asking for the aggregated feedback (rating summaries plus text responses) of one of the speaker's own sessions (BR-210). Same `SpeakerId` + `SessionId` shape as [`GetSessionBookmarkCountQuery`](#getsessionbookmarkcountquery) (`GetSessionFeedbackQuery.cs:14`).
- **Depends on**: the `SpeakerIdentifierType` and `SessionIdentifierType` aliases only.
- **Concept**: structurally identical to [`GetSessionBookmarkCountQuery`](#getsessionbookmarkcountquery), a two-field ownership-carrying query record; see that section for the `[Rubric §11, Security]` rationale. The difference is entirely in the return type: its handler produces a [`SessionFeedbackDTO`](group-17-conference-domain.md#sessionfeedbackdto) rather than an `int`.
- **Walkthrough**: positional `record` with `SpeakerId` then `SessionId` (`GetSessionFeedbackQuery.cs:14`); doc comment at `GetSessionFeedbackQuery.cs:11-13`.
- **Why it's built this way**: mirrors the bookmark-count query so both speaker self-service reads share one shape and one authorization convention.
- **Where it's used**: consumed by [`GetSessionFeedbackHandler`](#getsessionfeedbackhandler); constructed by the speaker-dashboard feedback endpoint.

### GetSpeakersByEventFilterQuery
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSpeakersByEventFilter` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/GetSpeakersByEventFilter/GetSpeakersByEventFilterQuery.cs:12` · Level 0 · record

- **What it is**: a query that returns a specification selecting the [`Speaker`](group-17-conference-domain.md#speaker)s belonging to a given event. Its one field is the `EventId` whose speakers should match (`GetSpeakersByEventFilterQuery.cs:12`).
- **Depends on**: the `EventIdentifierType` alias only.
- **Concept, two link paths unioned into a specification.** `[Rubric §4, DDD]` (assesses that aggregates reference each other by identity across a boundary, not by direct object navigation). The doc comment (`GetSpeakersByEventFilterQuery.cs:3-11`) explains the modeling: a speaker belongs to an event either **directly** (an [`EventSpeaker`](group-17-conference-domain.md#eventspeaker) join written by the Sessionize sync) or **transitively** via any session of that event (a [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker) join written by organizer session management). Because [`Speaker`](group-17-conference-domain.md#speaker) has no `EventId` column, the handler resolves both paths as id-list projections and unions them, keeping the resulting criteria engine-portable. Same return-a-specification idiom as [`GetPublicSessionFilterQuery`](#getpublicsessionfilterquery).
- **Walkthrough**: positional `record` with one member, `EventId` (`GetSpeakersByEventFilterQuery.cs:12`).
- **Why it's built this way**: expressing "speakers of an event" as an id-list specification (rather than a join) means the [`Speaker`](group-17-conference-domain.md#speaker) aggregate keeps a by-id boundary to the Event/Session aggregates and the filter translates on any storage engine.
- **Where it's used**: consumed by [`GetSpeakersByEventFilterHandler`](#getspeakersbyeventfilterhandler); the returned specification scopes speaker read/list endpoints to one event.

### SessionEventIdRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:24` · Level 0 · class (sealed, generic)

- **What it is**: a reusable FluentValidation rule that asserts a session request carries a non-empty event id (`SessionValidationRules.cs:24-30`).
- **Depends on**: `FluentValidation.AbstractValidator<T>` (NuGet); the `EventIdentifierType` alias.
- **Concept introduced, the composable rule fragment.** `[Rubric §24, Forms/Validation/UX Safety]` (assesses whether validation is factored into reusable, single-purpose units rather than duplicated per request). Unlike the string-field rules that inherit [`RequiredStringRules<T>`](group-06-validation.md#requiredstringrulest), this one derives straight from `AbstractValidator<T>` because it validates an identifier (not a string with a max length). It is generic over `T`, the request type carrying the property, and takes an `Expression<Func<T, EventIdentifierType>>` selector (`SessionValidationRules.cs:27`) so any create-or-update session request can `Include` it against whichever property holds the event id.
- **Walkthrough**: a primary-constructor validator. The constructor body is an expression-bodied `RuleFor(selector).NotEmpty()` with a custom message and error code `"Session.EventId.Required"` (`SessionValidationRules.cs:27-29`). The explicit `WithErrorCode` keeps the failure machine-classifiable when it flows back through the [`Result`](group-01-result-error-handling.md#result) pipeline.
- **Why it's built this way**: a single-rule generic validator can be shared by every session request via FluentValidation's `Include`, so the "an event is mandatory" rule is authored once and never copy-pasted between the create and update validators.
- **Where it's used**: `Include`d by the session create/update request validators in this module; sits beside its sibling [`SessionTitleRules<T>`](#sessiontitlerulest) in the same file.

### ConferenceCategoryUpdateRequest
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/UseCases/Update/ConferenceCategoryUpdateRequest.cs:6` · Level 1 · record

- **What it is**: the request DTO carrying the editable fields of a conference category update: `Title`, `Sort`, optional `Type`, plus the concurrency `RowVersion` token (`ConferenceCategoryUpdateRequest.cs:6-20`).
- **Depends on**: [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware) (the interface exposing `RowVersion`, `ConferenceCategoryUpdateRequest.cs:6`).
- **Concept introduced, the optimistic-concurrency request contract.** `[Rubric §8, Data Architecture]` (assesses lost-update protection). By implementing [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware), the request round-trips the client's last-seen EF `RowVersion` (`ConferenceCategoryUpdateRequest.cs:10`) back to the server, which stamps it as the original value so a concurrent edit surfaces as a 409 rather than a silent last-write-wins (the stamping happens in [`UpdateConferenceCategoryHandler`](#updateconferencecategoryhandler)). The `[SuppressMessage(... CA1819 ...)]` on `RowVersion` (`ConferenceCategoryUpdateRequest.cs:9`) is a scoped, justified analyzer suppression: the property must expose the raw `byte[]` token EF uses, which normally trips the "properties should not return arrays" rule. `[Rubric §9, API & Contract Design]`: `Title` is `required` while `Type` is nullable, so the wire contract states plainly which fields must be present.
- **Walkthrough**: `RowVersion` (`byte[]?`, line 10); `required string Title` (line 13); `int Sort` (line 16); `string? Type` (line 19). All members are `init`-only, so the DTO is immutable once bound from the request body.
- **Why it's built this way**: `required` + `init` produce an immutable, must-be-fully-populated payload; carrying the concurrency token on the DTO keeps optimistic-concurrency an end-to-end contract rather than a server-only guess.
- **Where it's used**: wrapped by [`UpdateConferenceCategoryCommand`](#updateconferencecategorycommand); validated by [`ConferenceCategoryUpdateRequestValidator`](#conferencecategoryupdaterequestvalidator).

### SessionTitleRules<T>
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:13` · Level 5 · class (sealed, generic)

- **What it is**: a reusable FluentValidation rule for a session title, enforcing non-empty plus the max-length constant defined on the domain invariants class (`SessionValidationRules.cs:13-18`).
- **Depends on**: [`RequiredStringRules<T>`](group-06-validation.md#requiredstringrulest) (its base), [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants) (for `TitleMaxLength`).
- **Concept, single-source-of-truth field length.** `[Rubric §24, Forms/Validation/UX Safety]` and `[Rubric §16, Maintainability]`. This is the string-field counterpart to [`SessionEventIdRules<T>`](#sessioneventidrulest): rather than deriving from `AbstractValidator<T>` directly, it inherits [`RequiredStringRules<T>`](group-06-validation.md#requiredstringrulest), passing the label `"Session Title"` and `SessionInvariants.TitleMaxLength` (`SessionValidationRules.cs:17`). The max length is read from the domain [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants) rather than a literal, so the same constant governs the EF column, the value-object guard, and this validator.
- **Walkthrough**: a one-line primary-constructor class whose constructor forwards `(selector, "Session Title", SessionInvariants.TitleMaxLength)` to the base (`SessionValidationRules.cs:16-17`). All the `NotEmpty`/`MaximumLength` mechanics live in the base rule.
- **Why it's built this way**: subclassing the shared string-rule keeps every "required, length-bounded text field" validated identically across the codebase, and pulling the length from invariants prevents the validator and the persistence layer from drifting apart.
- **Where it's used**: `Include`d by the session create/update request validators; shares the file with [`SessionEventIdRules<T>`](#sessioneventidrulest).

### UpdateConferenceCategoryCommand
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/UseCases/Update/UpdateConferenceCategoryCommand.cs:14` · Level 6 · record

- **What it is**: the write request to update an existing conference category. It pairs the target `Id` with the [`ConferenceCategoryUpdateRequest`](#conferencecategoryupdaterequest) payload and declares that a successful run must invalidate the category cache (`UpdateConferenceCategoryCommand.cs:14-18`).
- **Depends on**: [`ConferenceCategoryUpdateRequest`](#conferencecategoryupdaterequest), `ICommandWithRequest<out TRequest>` (from `MMCA.Common.Application`, [group 05](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)), `ICacheInvalidating` ([group 05](group-05-cqrs-pipeline.md#icacheinvalidating)), and [`Category`](group-17-conference-domain.md#category) (used to compute the cache prefix).
- **Concept introduced, the cache-invalidating command.** `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §12, Performance & Scalability]` (assesses that writes actively evict the read cache they would otherwise stale). Implementing [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) opts the command into the Caching decorator: after the write succeeds, the pipeline evicts entries under `CachePrefix`. Here that prefix is computed from the domain type, `$"{typeof(Category).FullName}:"` (`UpdateConferenceCategoryCommand.cs:17`), so it stays correct if the category read cache keys are namespaced by type name. Implementing `ICommandWithRequest<ConferenceCategoryUpdateRequest>` marks it as a command whose validation targets the wrapped request DTO, letting the Validating decorator find and run [`ConferenceCategoryUpdateRequestValidator`](#conferencecategoryupdaterequestvalidator).
- **Walkthrough**: a positional `record` with `Id` and `Request` members (`UpdateConferenceCategoryCommand.cs:14`), plus a computed `CachePrefix` expression-bodied property (`UpdateConferenceCategoryCommand.cs:17`). No behavior beyond declaring these contracts; the work is in [`UpdateConferenceCategoryHandler`](#updateconferencecategoryhandler).
- **Why it's built this way**: separating the id from the payload keeps the route parameter and the body distinct, and declaring cache invalidation on the command (rather than hand-coding an eviction call in the handler) keeps the cross-cutting concern in one decorator (see the pipeline order in [group 05](group-05-cqrs-pipeline.md)).
- **Where it's used**: handled by [`UpdateConferenceCategoryHandler`](#updateconferencecategoryhandler); constructed by the category update controller action.

### ConferenceCategoryUpdateRequestValidator
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/UseCases/Update/ConferenceCategoryUpdateRequestValidator.cs:7` · Level 7 · class (sealed)

- **What it is**: the FluentValidation validator for [`ConferenceCategoryUpdateRequest`](#conferencecategoryupdaterequest), assembled by composing a reusable category field rule (`ConferenceCategoryUpdateRequestValidator.cs:7-11`).
- **Depends on**: `FluentValidation.AbstractValidator<T>` (NuGet), [`ConferenceCategoryUpdateRequest`](#conferencecategoryupdaterequest), [`ConferenceCategoryTitleRules<T>`](group-18-conference-application.md#conferencecategorytitlerulest).
- **Concept, validator by composition.** `[Rubric §24, Forms/Validation/UX Safety]`. Rather than restating field rules inline, the validator's constructor is a single `Include(new ConferenceCategoryTitleRules<ConferenceCategoryUpdateRequest>(p => p.Title))` (`ConferenceCategoryUpdateRequestValidator.cs:10`). The reusable title rule (shared with the category *create* validator) carries the length constant, so create and update validate the title identically. Discovered and registered by Scrutor assembly scanning and run by the Validating decorator before the transaction opens.
- **Walkthrough**: an expression-bodied primary constructor calling `Include(...)` once (`ConferenceCategoryUpdateRequestValidator.cs:9-10`). Only `Title` is validated at this layer; `Sort` and `Type` have no request-level constraints, and `RowVersion` is a concurrency token rather than user input.
- **Why it's built this way**: `Include`-composition keeps each field's rule in one class reused across every request that carries the field, the maintainability payoff §24 rewards.
- **Where it's used**: resolved by the Validating decorator when an [`UpdateConferenceCategoryCommand`](#updateconferencecategorycommand) runs.

### GetNowNextHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.NowNext` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextHandler.cs:20` · Level 8 · class (sealed)

- **What it is**: the query handler that builds the now-next snapshot: the sessions running at the query instant plus the next-starting batch, for one published [`Event`](group-17-conference-domain.md#event) (`GetNowNextHandler.cs:20`).
- **Depends on**: [`GetNowNextQuery`](#getnownextquery), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), `TimeProvider` (BCL), [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector), `CalendarExportMapper` ([group 18](group-18-conference-application.md#calendarexportmapper)), [`Event`](group-17-conference-domain.md#event) / [`Session`](group-17-conference-domain.md#session), and the [`NowNextDTO`](group-17-conference-domain.md#nownextdto) / [`NowNextSessionDTO`](group-17-conference-domain.md#nownextsessiondto) result shapes.
- **Concept introduced, the injectable clock.** `[Rubric §14, Testability]` (assesses that time-dependent logic is driven by an abstraction, not `DateTime.UtcNow`). The handler takes `TimeProvider` via its primary constructor (`GetNowNextHandler.cs:21`) and reads `timeProvider.GetUtcNow()` (`GetNowNextHandler.cs:29`), so "now" is deterministic under test. `[Rubric §12, Performance & Scalability]`: the "now" and "next" partitions are computed in memory over one session load rather than issuing multiple round-trips.
- **Concept, decision-support analytics over the domain.** `[Rubric §6, CQRS & Event-Driven]`. This is a read-side projection that reshapes aggregate state into a live-schedule view the domain itself never stores.
- **Walkthrough**
  - Event selection (`GetNowNextHandler.cs:31, 90-113`): `SelectEventAsync` either loads the explicit `EventId` (with its `Rooms`) or, when the query's id is `null`, loads all published events and delegates to [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector)`.SelectCurrentOrNext` to feature the live-or-next one. A missing or unpublished event returns `Error.NotFound` (`GetNowNextHandler.cs:32-36`).
  - Session load + eligibility (`GetNowNextHandler.cs:38-56`): loads the event's sessions, then filters with `CalendarExportMapper.IsExportable` so the snapshot reuses the calendar rules (scheduled, non-service, not declined/cancelled) rather than re-implementing them.
  - Time-zone conversion (`GetNowNextHandler.cs:43-51`): resolves the event's zone with a `try/catch` on `TimeZoneNotFoundException` that falls back to `TimeZoneInfo.Utc`, so an unknown zone degrades gracefully instead of throwing.
  - "Now" and "Next" partitioning (`GetNowNextHandler.cs:58-72`): "now" is every row straddling `utcNow`; "next" is the batch sharing the earliest future start (so parallel tracks surface together), ordered by room name with `StringComparer.OrdinalIgnoreCase`.
  - Live flag (`GetNowNextHandler.cs:74-77`): asks [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector)`.GetLiveWindowUtc` whether the event's whole window contains `utcNow`, then returns `Result.Success(new NowNextDTO(...))`.
- **Why it's built this way**: delegating event selection and the live window to [`CurrentEventSelector`](group-17-conference-domain.md#currenteventselector), and eligibility to `CalendarExportMapper`, means the now-next surface and the calendar export stay consistent by construction (one rule set, cited in the doc comment as ADR-042 Wave 8, `GetNowNextHandler.cs:12-19`).
- **Where it's used**: invoked by the now-next / home-widget endpoint in the Conference API layer.
- **Caveats / not-in-source**: the `ADR-042 Wave 8` attribution is from the source doc comment; this walkthrough describes only what the method body does.

### GetSessionBookmarkCountHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCount` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionBookmarkCount/GetSessionBookmarkCountHandler.cs:14` · Level 8 · class (sealed)

- **What it is**: the handler for [`GetSessionBookmarkCountQuery`](#getsessionbookmarkcountquery). It verifies the calling speaker is assigned to the session, then reads the bookmark count from the Engagement module (`GetSessionBookmarkCountHandler.cs:14`).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IBookmarkCountService`](group-22-engagement-module.md#ibookmarkcountservice) (the cross-module port), [`Session`](group-17-conference-domain.md#session).
- **Concept introduced, cross-module read over a port.** `[Rubric §7, Microservices Readiness]` (assesses that a module reaches another bounded context through an interface, not a direct type reference). Bookmark counts live in the Engagement bounded context, so this Conference handler depends on the [`IBookmarkCountService`](group-22-engagement-module.md#ibookmarkcountservice) abstraction (`GetSessionBookmarkCountHandler.cs:16`) and calls `GetBookmarkCountForSessionAsync` (`GetSessionBookmarkCountHandler.cs:43`). In the extracted topology that port is satisfied by a gRPC client (or a disabled-module stub); the handler is unaware which. `[Rubric §11, Security]`: before revealing any count, it enforces ownership.
- **Walkthrough**
  - Load with membership (`GetSessionBookmarkCountHandler.cs:23-30`): loads the [`Session`](group-17-conference-domain.md#session) including `SessionSpeakers`, `asTracking: false` (a read), and returns `Error.NotFound` if absent.
  - Ownership check (`GetSessionBookmarkCountHandler.cs:32-40`): if no non-deleted `SessionSpeaker` matches the query's `SpeakerId`, returns `Error.Forbidden` with code `"Speaker.NotAssigned"`, so a speaker cannot read another speaker's numbers.
  - Cross-module read (`GetSessionBookmarkCountHandler.cs:42-45`): calls [`IBookmarkCountService`](group-22-engagement-module.md#ibookmarkcountservice) and wraps the `int` in `Result.Success`.
- **Why it's built this way**: keeping bookmark counting behind an interface preserves the Engagement/Conference boundary and lets the same handler run in-process (monolith) or over gRPC (extracted) with no code change; the ownership gate keeps §11 honest.
- **Where it's used**: invoked by the speaker-dashboard bookmark-count endpoint.

### GetSessionFeedbackHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionFeedback` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionFeedback/GetSessionFeedbackHandler.cs:15` · Level 8 · class (sealed)

- **What it is**: the handler for [`GetSessionFeedbackQuery`](#getsessionfeedbackquery). After the same ownership check as the bookmark-count handler, it aggregates rating answers and collects free-text responses into a [`SessionFeedbackDTO`](group-17-conference-domain.md#sessionfeedbackdto) (`GetSessionFeedbackHandler.cs:15`).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`Session`](group-17-conference-domain.md#session), [`Question`](group-17-conference-domain.md#question), and the [`SessionFeedbackDTO`](group-17-conference-domain.md#sessionfeedbackdto) / [`RatingQuestionSummary`](group-17-conference-domain.md#ratingquestionsummary) / [`TextQuestionResponses`](group-17-conference-domain.md#textquestionresponses) shapes.
- **Concept, in-application aggregation.** `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §12, Performance & Scalability]`. Unlike the bookmark handler, feedback aggregation runs entirely inside this module: it groups answers per question and computes an average for rating questions. `[Rubric §27, i18n]`: rating strings are parsed with `int.TryParse(..., CultureInfo.InvariantCulture, ...)` (`GetSessionFeedbackHandler.cs:76`), the deliberate culture-invariance the guide flags wherever locale could introduce a bug.
- **Walkthrough**
  - Load + ownership (`GetSessionFeedbackHandler.cs:23-40`): loads the [`Session`](group-17-conference-domain.md#session) with `SessionSpeakers` and `SessionQuestionAnswers`; `Error.NotFound` if missing, `Error.Forbidden` (`"Speaker.NotAssigned"`) if the caller is not an assigned speaker, the identical gate as [`GetSessionBookmarkCountHandler`](#getsessionbookmarkcounthandler).
  - Empty short-circuit (`GetSessionFeedbackHandler.cs:43-53`): returns an empty [`SessionFeedbackDTO`](group-17-conference-domain.md#sessionfeedbackdto) when there are no answers (soft-deleted answers already excluded by the EF global query filter, noted at `GetSessionFeedbackHandler.cs:42`).
  - Question lookup (`GetSessionFeedbackHandler.cs:55-63`): loads only the [`Question`](group-17-conference-domain.md#question)s referenced by answers (an id-set `Contains` filter), avoiding a full-table read.
  - Aggregation (`GetSessionFeedbackHandler.cs:65-101`): for each `QuestionId` group, `"Rating"` questions parse their answer values (invariant culture), keep the parseable ones, and produce a [`RatingQuestionSummary`](group-17-conference-domain.md#ratingquestionsummary) with `AverageRating` + `ResponseCount`; all other question types collect their raw answers into a [`TextQuestionResponses`](group-17-conference-domain.md#textquestionresponses).
- **Why it's built this way**: aggregating in-application (rather than in SQL) keeps the rating/text split expressive and lets the same code run against SQL Server or Cosmos-backed answers; the invariant-culture parse guards against locale-dependent number parsing.
- **Where it's used**: invoked by the speaker-dashboard feedback endpoint.

### GetSpeakersByEventFilterHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSpeakersByEventFilter` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/GetSpeakersByEventFilter/GetSpeakersByEventFilterHandler.cs:19` · Level 8 · class (sealed)

- **What it is**: the handler for [`GetSpeakersByEventFilterQuery`](#getspeakersbyeventfilterquery). It resolves the speaker ids linked to an event by two paths, unions them, and returns a `Speaker.Id IN (...)` [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype) (`GetSpeakersByEventFilterHandler.cs:19`).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`EventSpeaker`](group-17-conference-domain.md#eventspeaker), [`Session`](group-17-conference-domain.md#session), [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker), [`Speaker`](group-17-conference-domain.md#speaker), and [`InlineSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#inlinespecificationtentity-tidentifiertype).
- **Concept, id-list projection instead of a navigation join.** `[Rubric §4, DDD]` and `[Rubric §8, Data Architecture]`. Because [`Speaker`](group-17-conference-domain.md#speaker) has no `EventId`, the handler builds the filter from projected id lists: it reads speaker ids directly linked via [`EventSpeaker`](group-17-conference-domain.md#eventspeaker), then session ids of the event, then the speaker ids on those sessions via [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker), and unions the two sets. Each read uses `GetReadRepository<...>().GetProjectedAsync(...)` (`GetSpeakersByEventFilterHandler.cs:28-47`), pulling only the id column. The result is wrapped in an [`InlineSpecification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#inlinespecificationtentity-tidentifiertype) whose criteria is `s => speakerIds.Contains(s.Id)` (`GetSpeakersByEventFilterHandler.cs:50-53`).
- **Walkthrough**
  - Direct links (`GetSpeakersByEventFilterHandler.cs:28-31`): projects `SpeakerId` from [`EventSpeaker`](group-17-conference-domain.md#eventspeaker) rows where `EventId == query.EventId`.
  - Session ids (`GetSpeakersByEventFilterHandler.cs:33-36`): projects the ids of the event's sessions.
  - Transitive links (`GetSpeakersByEventFilterHandler.cs:38-48`): only when there are sessions, materializes the id list once (so the predicate embeds a stable collection EF translates to `IN`), then projects `SpeakerId` from [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker) rows whose `SessionId` is in that list.
  - Union + specification (`GetSpeakersByEventFilterHandler.cs:50-53`): `Concat().Distinct()` of the two id sets, wrapped in the inline specification.
- **Why it's built this way**: the note on the query (see [`GetSpeakersByEventFilterQuery`](#getspeakersbyeventfilterquery)) applies here: id-list projections keep the [`Speaker`](group-17-conference-domain.md#speaker) aggregate referencing Event/Session only by id and keep the emitted criteria engine-portable. Note the doc comment's mention of the cross-source helper is a *precedent* it mirrors; this handler builds the union by hand, it does not call the framework helper directly.
- **Where it's used**: the returned specification scopes speaker list/read endpoints to one event.

### UpdateConferenceCategoryHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/UseCases/Update/UpdateConferenceCategoryHandler.cs:15` · Level 8 · class (sealed, partial)

- **What it is**: the command handler that applies an [`UpdateConferenceCategoryCommand`](#updateconferencecategorycommand): it loads the [`Category`](group-17-conference-domain.md#category), stamps the concurrency token, delegates to the domain `Update` method, saves, and returns the updated DTO (`UpdateConferenceCategoryHandler.cs:15`).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`Category`](group-17-conference-domain.md#category), [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto) + its mapper ([`ConferenceCategoryDTOMapper`](group-18-conference-application.md#conferencecategorydtomapper)), `ILogger<T>` (BCL), [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult).
- **Concept introduced, the write-side command handler.** `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §4, DDD]` (assesses that mutations go through the aggregate, not raw property assignment). The handler is a thin orchestrator: it never mutates the entity directly, it calls `entity.Update(...)` (`UpdateConferenceCategoryHandler.cs:34-37`) and lets the aggregate enforce its own invariants and return a [`Result`](group-01-result-error-handling.md#result). `[Rubric §8, Data Architecture]`: optimistic concurrency is wired by `repository.SetOriginalRowVersion(entity, command.Request.RowVersion)` (`UpdateConferenceCategoryHandler.cs:32`), so a stale token surfaces as a `DbUpdateConcurrencyException` → 409 rather than a silent overwrite (the inline comment at `UpdateConferenceCategoryHandler.cs:30-31` states this).
- **Concept, source-generated logging.** `[Rubric §13, Observability & Operability]`. The class is `partial` and declares a `[LoggerMessage]` method `LogConferenceCategoryUpdated` (`UpdateConferenceCategoryHandler.cs:49-50`), the compile-time high-performance logging pattern, invoked after a successful save (`UpdateConferenceCategoryHandler.cs:44`).
- **Walkthrough**
  - Load or 404 (`UpdateConferenceCategoryHandler.cs:25-28`): gets the repository, `GetByIdAsync`, returns `Error.NotFound.WithSource(...).WithTarget(nameof(Category))` when absent.
  - Concurrency stamp (`UpdateConferenceCategoryHandler.cs:32`): applies the client's `RowVersion` as the original value.
  - Domain update (`UpdateConferenceCategoryHandler.cs:34-40`): calls `entity.Update(Title, Sort, Type)`; on failure returns the domain errors unchanged.
  - Persist + map (`UpdateConferenceCategoryHandler.cs:42-46`): `SaveChangesAsync` (which also dispatches any domain events and flushes the outbox), logs, and returns `Result.Success(dtoMapper.MapToDTO(entity))`.
- **Why it's built this way**: the handler owns orchestration and cross-cutting wiring (concurrency, logging, mapping) while the aggregate owns the rules, the split §4/§6 reward; cache invalidation is handled declaratively by the command's [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) contract, not here.
- **Where it's used**: invoked by the category update controller action, wrapped by the decorator pipeline (FeatureGate → Logging → Caching → Validating → Transactional → this handler).

### GetPublicSessionFilterHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionFilter` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterHandler.cs:17` · Level 9 · class (sealed)

- **What it is**: the handler for [`GetPublicSessionFilterQuery`](#getpublicsessionfilterquery). It returns a [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype) selecting public sessions: non-declined, non-cancelled sessions whose parent event is published (BR-132 / BR-49) (`GetPublicSessionFilterHandler.cs:17`).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`CrossSourceSpecification`](group-03-querying-specifications.md#crosssourcespecification), [`Event`](group-17-conference-domain.md#event), [`Session`](group-17-conference-domain.md#session), [`SessionStatuses`](group-17-conference-domain.md#sessionstatuses).
- **Concept, the cross-source specification helper.** `[Rubric §8, Data Architecture]` and `[Rubric §7, Microservices Readiness]`. Unlike [`GetSpeakersByEventFilterHandler`](#getspeakersbyeventfilterhandler) (which unions id lists by hand), this handler delegates the two-store problem to the framework's [`CrossSourceSpecification`](group-03-querying-specifications.md#crosssourcespecification)`.BuildAsync` (`GetPublicSessionFilterHandler.cs:26-33`). It reads the published [`Event`](group-17-conference-domain.md#event) ids from SQL Server (`principalPredicate: e => e.IsPublished`) and produces a `Session.EventId IN (...)` filter, ANDed with a local status check, translatable against the Cosmos-stored [`Session`](group-17-conference-domain.md#session).
- **Walkthrough**
  - `BuildAsync` call (`GetPublicSessionFilterHandler.cs:26-33`): generic over `<Session, SessionIdentifierType, Event, EventIdentifierType>`, with `principalPredicate` = published events, `dependentForeignKey` = `s => s.EventId`, and `localPredicate` = `s => s.Status != SessionStatuses.Declined && s.Status != "Cancelled"`.
  - Return (`GetPublicSessionFilterHandler.cs:35`): wraps the built specification in `Result.Success`.
- **Why it's built this way**: routing the SQL-to-Cosmos filter through one reusable helper means the "no cross-database join" rule is solved in the framework once, and the local status predicate keeps the visibility rule readable at the call site.
- **Where it's used**: the returned specification is applied by the public session-listing read endpoints (the paged public sessions surface).
- **Caveats / not-in-source**: `"Cancelled"` is a bare string literal at `GetPublicSessionFilterHandler.cs:31` while `Declined` uses the [`SessionStatuses`](group-17-conference-domain.md#sessionstatuses) constant; both are checked, but only one is symbolic.

### EventUpdateRequest, QuestionUpdateRequest, SessionUpdateRequest

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.{Events,Questions,Sessions}.UseCases.Update` · Level 1 · records

- **What it is**: the inbound payload DTOs the API controllers bind for an update (edit) operation on the three write-heavy Conference aggregates. Each is a plain `record class` of `required`/`init` properties describing the new field values a client wants to persist.
- **Depends on**: [IConcurrencyAware](group-12-api-hosting-mapping.md#iconcurrencyaware) (Level 0, the optimistic-concurrency contract); `EventIdentifierType`/`RoomIdentifierType` aliases (SessionUpdateRequest only); `DateOnly`/`DateTime` (BCL); [QuestionModerationDefault](group-17-conference-domain.md#questionmoderationdefault) enum (EventUpdateRequest only).

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `EventUpdateRequest` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Update/EventUpdateRequest.cs:7` | Event fields (`Name`, `StartDate`, `EndDate`, `TimeZone`, venue/WiFi/Sessionize strings) plus the BR-233 `QuestionModerationDefault` enum (line 42). |
| `QuestionUpdateRequest` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/UseCases/Update/QuestionUpdateRequest.cs:6` | Question fields: `QuestionText`, `QuestionEntity`, `QuestionType`, `Sort`, `IsRequired`. Smallest of the three. |
| `SessionUpdateRequest` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Update/SessionUpdateRequest.cs:6` | Largest surface: `Title`, timing (`StartsAt`/`EndsAt`), status flags, live/recording URLs, `AccessibilityInfo`, and an `init` `EventId` carried only so the handler can reject a move (BR-140). |

- **Concept introduced: the `IConcurrencyAware` request carrying an EF rowversion token.** This is the first place in the Conference application layer where a request DTO participates in optimistic concurrency. Each record implements [IConcurrencyAware](group-12-api-hosting-mapping.md#iconcurrencyaware) by exposing a nullable `byte[]? RowVersion { get; init; }` (EventUpdateRequest.cs:11, QuestionUpdateRequest.cs:10, SessionUpdateRequest.cs:10). The client echoes back the rowversion it last read; the handler stamps it as the entity's original token so a concurrent edit fails loudly instead of silently overwriting. The `CA1819` suppression on each `RowVersion` documents that returning the raw `byte[]` is deliberate: it is the EF concurrency token round-tripping, not a mutable-array smell. `[Rubric §9, API & Contract Design]` (assesses whether request contracts are explicit and version-safe): these records are immutable `init`-only shapes with `required` on the fields the domain cannot default, so a malformed request is rejected at model binding rather than deep in the handler.
- **Walkthrough**: every property is `get; init;` (immutable after construction). `required` marks the fields the aggregate has no sensible default for (for example `EventUpdateRequest.Name`/`StartDate`/`EndDate`/`TimeZone`, `SessionUpdateRequest.EventId`/`Title`). The remaining nullable properties model genuinely optional data. `SessionUpdateRequest.EventId` (SessionUpdateRequest.cs:13) is documented as immutable after creation (BR-140): it is present in the request only so the handler can compare it against the stored value and reject a cross-event move.
- **Why it's built this way**: records give value equality and a compact immutable contract for free, and keeping the update payload separate from the create payload lets the two evolve independently (an update can enforce concurrency; a create cannot). The URL properties are typed as `string?` with `CA1056` suppressed because they are stored verbatim as they arrive from the Sessionize import rather than parsed to `Uri`.
- **Where it's used**: bound by the Conference REST controllers, wrapped into [UpdateEventCommand](#updateeventcommand) / [UpdateQuestionCommand](#updatequestioncommand) / [UpdateSessionCommand](#updatesessioncommand), validated by their matching validators (below), and finally handed field-by-field to the domain `Update(...)` method inside each handler.

---

### UpdateEventResult, UpdateSessionResult

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.{Events,Sessions}.UseCases.Update` · Level 3 · records

- **What it is**: small result wrappers that pair the updated DTO with a single advisory `bool` warning flag. They exist so a handler can report a soft business-rule concern to the caller without failing the operation.
- **Depends on**: [EventDTO](group-17-conference-domain.md#eventdto) / [SessionDTO](group-17-conference-domain.md#sessiondto) (the payload each wraps).

| Type | File:Line | Warning it carries |
|------|-----------|--------------------|
| `UpdateEventResult` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Update/UpdateEventCommand.cs:24` | `HasTimeZoneWarning`: the event timezone was changed while sessions already exist (BR-131). |
| `UpdateSessionResult` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Update/UpdateSessionCommand.cs:24` | `HasDateRangeWarning`: the session times fall outside the parent event's date range (BR-86). |

- **Concept introduced: the warning-carrying result versus a hard failure.** Most Conference commands return `Result<TDTO>` directly (see [UpdateQuestionHandler](#updatequestionhandler)). These two return `Result<UpdateEventResult>` / `Result<UpdateSessionResult>` instead, so the [Result](group-01-result-error-handling.md#result) still models success/failure while the wrapped record adds a non-fatal flag. `[Rubric §9, API & Contract Design]`: separating a hard error (a failed `Result`) from a soft advisory (a `bool` on a success payload) lets the UI, for example, show a confirmation prompt ("this event has sessions; changing the timezone may misplace them") without blocking the save.
- **Walkthrough**: each is a positional `sealed record` with two members: the DTO and the flag (UpdateEventCommand.cs:24, UpdateSessionCommand.cs:24). No behavior; they are pure carriers.
- **Why it's built this way**: a dedicated result type is cheaper and clearer than overloading the DTO with transient UI concerns or inventing an out-parameter. It also leaves room to add more advisory flags later without changing the handler signature.
- **Where it's used**: constructed by [UpdateEventHandler](#updateeventhandler) (UpdateEventHandler.cs:68) and [UpdateSessionHandler](#updatesessionhandler) (UpdateSessionHandler.cs:98), unwrapped by the Events/Sessions controllers.

---

### EventUpdateRequestValidator, QuestionUpdateRequestValidator, SessionUpdateRequestValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.{Events,Questions,Sessions}.UseCases.Update` · Level 6 · classes

- **What it is**: FluentValidation validators for the three update requests. Each composes reusable field-rule sets rather than restating the rules inline, so create and update paths share one definition of "a valid name/title/timezone".
- **Depends on**: `AbstractValidator<T>` (FluentValidation, NuGet); the shared rule sets [EventNameRules<T>](#eventnamerulest), [EventTimeZoneRules<T>](#eventtimezonerulest), [EventDateRangeRules<T>](#eventdaterangerulest), [QuestionTextRules<T>](#questiontextrulest), [SessionTitleRules<T>](#sessiontitlerulest).

| Type | File:Line | Rules composed |
|------|-----------|----------------|
| `EventUpdateRequestValidator` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Update/EventUpdateRequestValidator.cs:7` | `Include`s name, timezone, and date-range rule sets, plus an inline `IsInEnum()` guard on `QuestionModerationDefault` (lines 11-18). |
| `QuestionUpdateRequestValidator` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/UseCases/Update/QuestionUpdateRequestValidator.cs:7` | Single `Include(new QuestionTextRules<...>)` (line 10). |
| `SessionUpdateRequestValidator` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Update/SessionUpdateRequestValidator.cs:7` | Single `Include(new SessionTitleRules<...>)` (line 10). |

- **Concept introduced: rule composition via FluentValidation `Include`.** The FluentValidation pattern itself is introduced with the rule-set types elsewhere in this chapter; the point here is composition. `Include(ruleSet)` folds a whole rule set (parameterized on the request type via a property selector, for example `p => p.Name`) into the validator, so the update validator reuses the exact rules the create validator uses. `EventUpdateRequestValidator` additionally shows the mixed style: three `Include`d sets plus one bespoke `RuleFor(x => x.QuestionModerationDefault).IsInEnum()` with an explicit `WithErrorCode` (EventUpdateRequestValidator.cs:15-18) to reject an out-of-range enum. `[Rubric §1, SOLID]`: the shared rule sets keep validation DRY (a name-length change is made once); `[Rubric §15, Best Practices & Code Quality]`: stable machine-readable error codes make failures diagnosable.
- **Walkthrough**: each validator is a `sealed class : AbstractValidator<TRequest>` whose constructor wires the rules; the two single-rule validators use an expression-bodied constructor (QuestionUpdateRequestValidator.cs:9-10, SessionUpdateRequestValidator.cs:9-10). They are auto-discovered by Scrutor assembly scanning and run by the CQRS `ValidatingCommandDecorator` before the transaction opens (see [group-05](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest)).
- **Why it's built this way**: separate validators per request keep each vertical slice self-contained, while the `Include`d rule sets prevent create/update drift. Validating in a decorator (not the handler) means every command passes through the same gate without per-handler boilerplate.
- **Where it's used**: invoked by the validating decorator ahead of [UpdateEventHandler](#updateeventhandler), [UpdateQuestionHandler](#updatequestionhandler), and [UpdateSessionHandler](#updatesessionhandler).

---

### UpdateEventCommand, UpdateQuestionCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.{Events,Questions}.UseCases.Update` · Level 6 · records

- **What it is**: the CQRS command messages for the event and question update slices. Each is a positional `sealed record` pairing the target `Id` with the update `Request` DTO, and each opts into cache invalidation.
- **Depends on**: [ICommandWithRequest<out TRequest>](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest) (Level 0); [ICacheInvalidating](group-05-cqrs-pipeline.md#icacheinvalidating) (Level 0); its `{Entity}IdentifierType` alias; the matching request record ([EventUpdateRequest](#eventupdaterequest-questionupdaterequest-sessionupdaterequest) / [QuestionUpdateRequest](#eventupdaterequest-questionupdaterequest-sessionupdaterequest)); the domain `Event`/`Question` entity (referenced only inside `CachePrefix`).

| Type | File:Line | Cache prefix |
|------|-----------|--------------|
| `UpdateEventCommand` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Update/UpdateEventCommand.cs:15` | `$"{typeof(Event).FullName}:"` (line 18). |
| `UpdateQuestionCommand` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/UseCases/Update/UpdateQuestionCommand.cs:16` | `$"{typeof(Question).FullName}:"` (line 19). |

- **Concept introduced: `ICacheInvalidating` on a write command.** These are the first update commands in this chapter to declare a `CachePrefix`. Implementing [ICacheInvalidating](group-05-cqrs-pipeline.md#icacheinvalidating) tells the `CachingCommandDecorator` (see [group-05](group-05-cqrs-pipeline.md#icacheinvalidating)) to evict cached read results whose keys start with the returned prefix once the command succeeds, so a stale event/question is not served after an edit. Deriving the prefix from `typeof(Event).FullName` ties the invalidation key to the entity type without a hand-typed magic string. `[Rubric §6, CQRS & Event-Driven]`: the command is a thin intent message carrying no logic, keeping the write side declarative; `[Rubric §12, Performance & Scalability]`: read caching stays correct because every mutation self-declares what it invalidates.
- **Walkthrough**: the record header carries the two positional members (`Id`, `Request`) and the two marker interfaces; the body is a single expression-bodied `CachePrefix` property. No other members.
- **Why it's built this way**: pairing an id with a request DTO is the standard `ICommandWithRequest<TRequest>` shape used across the modules, so these commands plug into the same handler pipeline with zero special-casing.
- **Where it's used**: created by the Events/Questions controllers and dispatched to [UpdateEventHandler](#updateeventhandler) / [UpdateQuestionHandler](#updatequestionhandler) through the decorator pipeline.

---

### UpdateSessionCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Update/UpdateSessionCommand.cs:15` · Level 7 · record

- **What it is**: the CQRS command for the session update slice, structurally identical to [UpdateEventCommand](#updateeventcommand-updatequestioncommand): a positional `sealed record(SessionIdentifierType Id, SessionUpdateRequest Request)` implementing [ICommandWithRequest<out TRequest>](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest) and [ICacheInvalidating](group-05-cqrs-pipeline.md#icacheinvalidating).
- **Depends on**: the same set as the command family above, over [SessionUpdateRequest](#eventupdaterequest-questionupdaterequest-sessionupdaterequest) and the `Session` domain entity. It sits one level higher than the other two commands only because its request DTO transitively pulls in more Session-side types.
- **Concept introduced**: none new: see the `ICacheInvalidating` discussion under [UpdateEventCommand](#updateeventcommand-updatequestioncommand). `CachePrefix` returns `$"{typeof(Session).FullName}:"` (UpdateSessionCommand.cs:18).
- **Walkthrough**: identical shape to the command family: two positional members plus the expression-bodied `CachePrefix`. Note that `UpdateSessionResult` is declared in the same file (line 24) but is documented above with the other result records.
- **Where it's used**: dispatched from the Sessions controller to [UpdateSessionHandler](#updatesessionhandler).

---

### UpdateEventHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Update/UpdateEventHandler.cs:17` · Level 8 · class (sealed partial)

- **What it is**: the command handler that applies an [UpdateEventCommand](#updateeventcommand-updatequestioncommand): it loads the event, stamps the concurrency token, detects a timezone change that affects existing sessions (BR-131), delegates the field mutation to the domain entity, saves, and returns the DTO wrapped in an [UpdateEventResult](#updateeventresult-updatesessionresult).
- **Depends on**: [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) (Level 0); [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork) (Level 7); [EventDTOMapper](#eventdtomapper); `ILogger<T>` (BCL); [Error](group-01-result-error-handling.md#error) / [Result](group-01-result-error-handling.md#result); the `Event` and `Session` domain entities ([group-17](group-17-conference-domain.md#event)).
- **Concept introduced: optimistic concurrency stamping in a handler.** This is the first update handler in the chapter, so it teaches the core update flow. After loading the entity (`GetByIdAsync`, line 28) and short-circuiting to `Error.NotFound` when it is missing (lines 29-30), the handler calls `repository.SetOriginalRowVersion(entity, command.Request.RowVersion)` (line 34). This stamps the client's last-seen EF rowversion as the entity's original token, so a concurrent write surfaces as a `DbUpdateConcurrencyException` (mapped to HTTP 409) instead of a silent last-write-wins overwrite. `[Rubric §8, Data Architecture]`: correctness under concurrent edits is enforced at the persistence boundary; `[Rubric §13, Observability & Operability]`: the source-generated `[LoggerMessage]` `LogEventUpdated` (lines 71-72) records each successful update without allocating on the hot path.
- **Walkthrough**
  - `GetRepository<Event, EventIdentifierType>()` then `GetByIdAsync` (lines 27-28); missing entity returns `Error.NotFound.WithSource(...).WithTarget(...)` (line 30).
  - Concurrency stamp at line 34.
  - **BR-131 detection** (lines 37-47): compares stored `entity.TimeZone` against the request via `StringComparison.Ordinal`; only if it changed does it query a `Session` repository with `ExistsAsync(s => s.EventId == command.Id, ...)`. The resulting `hasTimeZoneWarning` bool is advisory, never a failure.
  - **Domain delegation** (lines 49-59): `entity.Update(Name, Description, StartDate, EndDate, TimeZone, SessionizeCode, VenueAddress, VenueMapUrl, WiFiInfo, QuestionModerationDefault)` returns a [Result](group-01-result-error-handling.md#result); a failure is propagated with `Result.Failure<UpdateEventResult>(result.Errors)` (lines 61-62). The entity, not the handler, owns its own invariants.
  - **Persist and return** (lines 64-68): `await unitOfWork.SaveChangesAsync(...)`, log, then `Result.Success(new UpdateEventResult(dtoMapper.MapToDTO(entity), hasTimeZoneWarning))`.
- **Why it's built this way**: the handler orchestrates persistence and cross-aggregate lookups (does the event have sessions?) that the domain entity cannot see, while the entity keeps sole responsibility for validating and mutating its own state. This is the clean-architecture split between application orchestration and domain logic.
- **Where it's used**: auto-registered by Scrutor and resolved by the Events controller through the command decorator pipeline (FeatureGate then Logging then Caching then Validating then Transactional then handler).

---

### UpdateQuestionHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Questions.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/UseCases/Update/UpdateQuestionHandler.cs:18` · Level 8 · class (sealed partial)

- **What it is**: the handler for [UpdateQuestionCommand](#updateeventcommand-updatequestioncommand). It follows the same load / stamp / delegate / save flow as [UpdateEventHandler](#updateeventhandler), but adds a BR-137 immutability guard: `QuestionType` and `QuestionEntity` cannot change once answers exist. Unlike the event and session handlers it returns `Result<QuestionDTO>` directly (no warning wrapper).
- **Depends on**: [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork); [QuestionDTOMapper](#questiondtomapper); [Error](group-01-result-error-handling.md#error) / [Result](group-01-result-error-handling.md#result); the `Question`, `EventQuestionAnswer`, and `SessionQuestionAnswer` domain entities ([group-17](group-17-conference-domain.md#question)).
- **Concept introduced: a cross-aggregate immutability guard using read repositories.** When either `QuestionType` or `QuestionEntity` differs from the stored value (lines 38-39), the handler must prove no answers exist before allowing the change. It uses `GetReadRepository<...>()` (lines 41, 48), the read-only counterpart to `GetRepository`, and probes both answer aggregates with `ExistsAsync(a => a.QuestionId.Equals(entity.Id), ...)`, checking `EventQuestionAnswer` first and only falling through to `SessionQuestionAnswer` if none were found (a short-circuit that avoids the second query in the common case). If any answer exists it returns `Error.Validation(code: "Question.ImmutableAfterAnswers", ...)` (lines 56-60). `[Rubric §4, DDD]`: a rule that spans aggregates (a question and the answers referencing it) is enforced in the application handler because no single aggregate can see both; `[Rubric §8, Data Architecture]`: read repositories express query-only intent, keeping the change-tracker uncluttered.
- **Walkthrough**
  - Load and null-guard (lines 28-31); concurrency stamp (line 35).
  - **BR-137 guard** (lines 37-62): the two-repository existence probe described above.
  - **Domain delegation** (lines 64-69): `entity.Update(QuestionText, QuestionEntity, QuestionType, Sort, IsRequired)`; failure propagated at lines 71-72.
  - **Persist and return** (lines 74-78): save, `LogQuestionUpdated` (lines 81-82), then `Result.Success(dtoMapper.MapToDTO(entity))`, the bare DTO, since a question update has no advisory warning to report.
- **Why it's built this way**: enforcing the immutability rule in the handler (rather than the entity) is deliberate: the `Question` aggregate has no reference to its answers, so the check needs the unit of work to reach the two answer aggregates. Splitting the probe across `EventQuestionAnswer` and `SessionQuestionAnswer` reflects that a question can target either entity type.
- **Where it's used**: auto-registered by Scrutor and dispatched from the Questions controller through the command decorator pipeline.

---

### UpdateSessionHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/Update/UpdateSessionHandler.cs:17` · Level 9 · class (sealed partial)

- **What it is**: the most guarded of the three update handlers, for [UpdateSessionCommand](#updatesessioncommand). On top of the standard load / stamp / delegate / save flow it enforces an immutable-parent rule (BR-140), a cross-event room-membership rule (BR-130), and an advisory date-range check (BR-86), returning the DTO wrapped in an [UpdateSessionResult](#updateeventresult-updatesessionresult).
- **Depends on**: [ICommandHandler<in TCommand, TResult>](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork); [SessionDTOMapper](#sessiondtomapper); [Error](group-01-result-error-handling.md#error) / [Result](group-01-result-error-handling.md#result); the `Session` and `Event` domain entities ([group-17](group-17-conference-domain.md#session)).
- **Concept introduced: layering multiple rule types in one handler.** This handler shows the full toolbox: a hard immutable-field guard, a cross-aggregate lookup for validation, and a soft warning, all in one flow.
  - **Immutable-field guard (BR-140)**: if `command.Request.EventId != entity.EventId` (line 37) the handler returns `Error.UnprocessableEntity(code: "Session.EventId.Immutable", ...)` (lines 39-43): a session cannot be moved between events. `UnprocessableEntity` maps to HTTP 422, distinguishing a semantically invalid request from a plain validation error.
  - **Cross-aggregate read with explicit includes (BR-130)**: the parent event is loaded read-only via `eventRepo.GetByIdAsync(entity.EventId, includes: [nameof(Event.Rooms)], asTracking: false, ...)` (lines 48-52). When the request names a `RoomId`, the handler verifies it belongs to that event and is not soft-deleted (`parentEvent.Rooms.FirstOrDefault(r => r.Id == ... && !r.IsDeleted)`, lines 57-68), returning `Error.Validation("Session.RoomId.CrossEvent", ...)` otherwise.
  - **Advisory warning (BR-86)**: after the domain update succeeds, the private static `IsOutsideEventDateRange` (lines 105-114) compares the session's `StartsAt`/`EndsAt` (converted via `DateOnly.FromDateTime`) against the event's `StartDate`/`EndDate`; the resulting bool rides back on `UpdateSessionResult` without failing the request.
  - `[Rubric §4, DDD]`: cross-aggregate invariants (room membership, immutable parent) live in the application handler where both aggregates are visible; `[Rubric §9, API & Contract Design]`: distinct error codes and HTTP statuses (422 for the immutable move, 400 for the cross-event room) give the client precise, actionable failures.
- **Walkthrough**: load and null-guard (lines 27-30); concurrency stamp (line 34); BR-140 guard (lines 37-44); parent-event read with null-guard (lines 47-54); BR-130 room validation (lines 57-68); `entity.Update(...)` with all fourteen fields (lines 70-84) and failure propagation (lines 86-87); BR-86 warning computed (lines 90-92); `SaveChangesAsync`, `LogSessionUpdated` (lines 94-102), and `Result.Success(new UpdateSessionResult(dtoMapper.MapToDTO(entity), hasDateRangeWarning))` (line 98).
- **Why it's built this way**: the update handler is intentionally heavier than a create handler because business rules require context from adjacent aggregates (the parent event and its rooms). Keeping those checks in the handler leaves the `Session` entity concerned only with its own state transition (`entity.Update(...)`), preserving the clean-architecture split.
- **Where it's used**: auto-registered by Scrutor and consumed by the Sessions controller through the command decorator pipeline.

### SpeakerUpdateRequest

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Update/SpeakerUpdateRequest.cs:6` · Level 1 · record

- **What it is** - the request DTO the API binds a speaker-edit form into before it becomes an `UpdateSpeakerCommand`. A plain `record class` of immutable `init` properties describing every editable speaker field plus the optimistic-concurrency token.
- **Depends on** - [`IConcurrencyAware`](group-12-api-hosting-mapping.md#iconcurrencyaware) (the one-property contract that surfaces the `RowVersion` token), `UserIdentifierType` (the Identity module alias for the optional linked-user id), plus BCL analyzer-suppression attributes.
- **Concept introduced - the request/command split.** A *request* is the wire-shaped payload a controller model-binds and a validator checks; a *command* is the internal CQRS message a handler runs. Keeping them separate means the transport contract (`SpeakerUpdateRequest`) can carry presentation concerns like `RowVersion` and nullable optionals, while [`UpdateSpeakerCommand`](#updatespeakercommand) stays a thin envelope pairing the target `Id` with this request. `[Rubric §9 - API & Contract Design]` (this DTO *is* the public edit contract: explicit, immutable, documented per-field). `[Rubric §8 - Data Architecture]` (the `RowVersion` byte array round-trips the EF rowversion token so a stale edit is caught rather than silently overwriting).
- **Walkthrough** - `RowVersion` (`SpeakerUpdateRequest.cs:10`) is the nullable `byte[]?` optimistic-concurrency token the client echoes back from its last read; the `[SuppressMessage]` on `CA1819` documents that the array is deliberate because it mirrors the EF token. `FirstName` / `LastName` (`:13`, `:16`) are `required string`, so the model binder cannot construct the request without them, which is why the validator only needs to police length, not presence. `Email`, `Bio`, `TagLine`, `ProfilePicture`, `TwitterHandle` (`:19`-`:34`) are nullable optionals. The three URL fields `LinkedInUrl` / `GitHubUrl` / `WebsiteUrl` (`:38`, `:42`, `:46`) each carry a `CA1056` suppression noting they stay `string` because the Sessionize import stores them as raw strings. `IsTopSpeaker` (`:31`) is the featured-speaker flag, and `LinkedUserId` (`:49`) optionally ties the speaker to an Identity `User`.
- **Why it's built this way** - `required init` gives an immutable, fully-constructed payload with no partially-populated intermediate state; the per-field XML docs double as OpenAPI descriptions. Manual DTO shaping over reflection-magic mapping follows ADR-001.
- **Where it's used** - validated by [`SpeakerUpdateRequestValidator`](#speakerupdaterequestvalidator), wrapped by [`UpdateSpeakerCommand`](#updatespeakercommand), and unpacked field-by-field by [`UpdateSpeakerHandler`](#updatespeakerhandler).

### RoomChangedHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.DomainEventHandlers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/DomainEventHandlers/RoomChangedHandler.cs:11` · Level 3 · class

- **What it is** - an `IDomainEventHandler<RoomChanged>` that reacts to a room being added, updated, or deleted by writing a single structured log line. The lightest possible domain-event handler: no state check, no side effect beyond observability.
- **Depends on** - [`IDomainEventHandler<in TDomainEvent>`](group-04-events-outbox.md#idomaineventhandlerin-tdomainevent), [`RoomChanged`](group-17-conference-domain.md#roomchanged), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), and `ILogger<T>` (BCL).
- **Concept introduced - the in-process domain-event handler.** When an aggregate calls `AddDomainEvent(...)`, the event sits in the aggregate's list until `SaveChangesAsync` commits and the `DomainEventDispatcher` (see [Group 04](group-04-events-outbox.md#domaineventdispatcher)) fans it out to every registered `IDomainEventHandler<T>` inside the same transaction. The aggregate never knows who listens; Scrutor discovers handlers by scanning the Application assembly. `[Rubric §6 - CQRS & Event-Driven]` (state changes are announced as events and consumed by decoupled handlers rather than leaked as inline side effects). `[Rubric §13 - Observability]` (the handler exists purely to emit a compile-time-generated, allocation-light log record).
- **Walkthrough** - the primary constructor (`RoomChangedHandler.cs:11`) injects only `ILogger<RoomChangedHandler>`. `HandleAsync` (`:15`) forwards the event's `State`, `EventId`, `RoomId`, and `RoomName` to the source-generated `LogRoomChanged` and returns `Task.CompletedTask` (`:18`) since there is no async work. `LogRoomChanged` (`:21`) is a `[LoggerMessage]` `static partial void` whose template embeds `{State}` so one log line covers add/update/delete.
- **Why it's built this way** - a `sealed partial class` plus `[LoggerMessage]` gives a strongly-typed, zero-boxing log path; keeping the handler side-effect-free means it can never fail the surrounding transaction.
- **Where it's used** - auto-registered by Scrutor's Application-assembly scan; fired by the `DomainEventDispatcher` whenever an `Event` aggregate raises `RoomChanged`.

### SessionCreatedHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.DomainEventHandlers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/DomainEventHandlers/SessionCreatedHandler.cs:11` · Level 4 · class

- **What it is** - an `IDomainEventHandler<SessionChanged>` that logs session *creation* only. It shows the common pattern where one event type carries a `State` and a handler routes on it.
- **Depends on** - [`IDomainEventHandler<in TDomainEvent>`](group-04-events-outbox.md#idomaineventhandlerin-tdomainevent), [`SessionChanged`](group-17-conference-domain.md#sessionchanged), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), and `ILogger<T>` (BCL).
- **Concept reinforced - state-routed event handling.** `SessionChanged` is a single event raised for adds, updates, and deletes; a handler that only cares about one transition guards on `State` and returns early otherwise. This keeps the event vocabulary small (one event per aggregate) while still letting handlers specialize. `[Rubric §6 - CQRS & Event-Driven]` and `[Rubric §13 - Observability]` as with [`RoomChangedHandler`](#roomchangedhandler).
- **Walkthrough** - `HandleAsync` (`SessionCreatedHandler.cs:15`) first checks `domainEvent.State != DomainEntityState.Added` and bails with `Task.CompletedTask` (`:17`-`:18`) for updates and deletes. Only for an `Added` transition does it call `LogSessionCreated` with `SessionId`, `Title`, `EventId` (`:20`). `LogSessionCreated` (`:24`) is the `[LoggerMessage]` generated method.
- **Why it's built this way** - routing on `State` inside one handler avoids proliferating near-identical handler types while keeping each concern's logic isolated to its branch.
- **Where it's used** - discovered as a singleton by the Scrutor scan; invoked by the `DomainEventDispatcher` on every `SessionChanged`, acting only when the session was just created.

### SpeakerDeletedHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.DomainEventHandlers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/DomainEventHandlers/SpeakerDeletedHandler.cs:20` · Level 4 · class

- **What it is** - the one handler in this unit that does real work: on a speaker soft-delete it logs the deletion **and** publishes a `SpeakerUnlinkedFromUser` integration event so the Identity module can clear the previously linked user's `LinkedSpeakerId` (BR-70). This is a domain event translating into a cross-service integration event.
- **Depends on** - [`IDomainEventHandler<in TDomainEvent>`](group-04-events-outbox.md#idomaineventhandlerin-tdomainevent), [`SpeakerChanged`](group-17-conference-domain.md#speakerchanged), [`SpeakerUnlinkedFromUser`](group-17-conference-domain.md#speakerunlinkedfromuser), [`IIntegrationEventPublisher`](group-04-events-outbox.md#iintegrationeventpublisher), [`DomainEntityState`](group-02-domain-building-blocks.md#domainentitystate), plus `IServiceScopeFactory` and `ILogger<T>` (BCL).
- **Concept introduced - bridging a domain event to an integration event across a service boundary.** A domain event is in-process and lives inside one aggregate's transaction; an integration event is the durable, broker-carried message other services consume. This handler is the bridge: the Conference-side `Speaker.Delete()` already cleared its own `LinkedUserId`, and the handler tells Identity to do the symmetric cleanup asynchronously. `[Rubric §7 - Microservices Readiness]` (replaces a former direct in-process call into `IUserSpeakerLinkService.ClearLinkedSpeakerAsync` with an eventually-consistent broker message; the class doc, `SpeakerDeletedHandler.cs:14`-`18`, records that transition). `[Rubric §6 - CQRS & Event-Driven]` and `[Rubric §29 - Resilience]` (publication rides the outbox, so a broker hiccup does not lose the unlink; ADR-003).
- **Walkthrough** - the primary constructor (`:20`) injects `IServiceScopeFactory` and `ILogger`. `HandleAsync` (`:25`) null-guards the event, then returns early unless `State == DomainEntityState.Deleted` (`:29`-`:30`). It logs via `LogSpeakerDeleted` (`:32`, generated at `:48`). The load-bearing detail is the scope handling: domain-event handlers are registered as **singletons**, but `IIntegrationEventPublisher` is scoped, so the handler opens `scopeFactory.CreateAsyncScope()` (`:40`) and resolves the publisher from that scope before calling `PublishAsync` with a new `SpeakerUnlinkedFromUser(PreviousLinkedUserId, SpeakerId)` (`:42`-`:44`). The whole publish path is guarded by `if (domainEvent.PreviousLinkedUserId.HasValue)` (`:38`), so a speaker who was never linked raises nothing.
- **Why it's built this way** - the singleton-handler / scoped-dependency mismatch is a standard DI hazard; `CreateAsyncScope` is the correct fix rather than capturing a scoped service in a singleton. Routing the cleanup through the broker keeps Conference from taking a hard dependency on Identity's write path.
- **Where it's used** - Scrutor registers it as a singleton; the `DomainEventDispatcher` fires it whenever a `Speaker` is soft-deleted.

### QuestionTextRules<T>

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Questions.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/Validation/QuestionValidationRules.cs:12` · Level 5 · class

- **What it is** - a reusable, generic FluentValidation rule that enforces "question text present, and not longer than the domain max length" against any request type exposing a text property.
- **Depends on** - [`QuestionInvariants`](group-17-conference-domain.md#questioninvariants) (for `QuestionTextMaxLength`), FluentValidation's `AbstractValidator<T>`, and `System.Linq.Expressions`.
- **Concept introduced - the reusable field-rule.** Rather than repeat `NotEmpty().MaximumLength(...)` in every create and update validator, a field rule is a small `AbstractValidator<T>` subtype parameterized by a property selector, then pulled into a concrete validator via `Include(...)`. The length constant comes from the aggregate's invariants class, so the column constraint, the domain guard, and this UI-facing message all read from one source of truth. `[Rubric §24 - Forms/Validation/UX Safety]` (a single field-length rule keeps API validation and the on-screen error consistent). `[Rubric §1 - SOLID]` (one rule, one responsibility, reused by composition). Unlike its sibling speaker rules, this one derives from `AbstractValidator<T>` directly rather than from [`RequiredStringRules<T>`](group-06-validation.md#requiredstringrulest) because it also stamps explicit `WithErrorCode` values.
- **Walkthrough** - the constructor (`QuestionValidationRules.cs:15`) takes an `Expression<Func<T, string>> selector` and calls `RuleFor(selector)` chaining `.NotEmpty()` with error code `Question.QuestionText.Required` and `.MaximumLength(QuestionInvariants.QuestionTextMaxLength)` with code `Question.QuestionText.MaxLength` (`:17`-`:18`). The interpolated message reuses the same constant so the number in the text can never drift from the enforced limit.
- **Where it's used** - `Include`d by the question create/update command validators.

### SpeakerFirstNameRules<T>

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/Validation/SpeakerValidationRules.cs:11` · Level 5 · class

- **What it is** - a reusable FluentValidation rule for a speaker's first-name field, built by subclassing the shared [`RequiredStringRules<T>`](group-06-validation.md#requiredstringrulest) base with the speaker-specific label and max length.
- **Depends on** - [`RequiredStringRules<T>`](group-06-validation.md#requiredstringrulest), [`SpeakerInvariants`](group-17-conference-domain.md#speakerinvariants) (for `FirstNameMaxLength`), and `System.Linq.Expressions`.
- **Concept reinforced - field rules via a shared base.** Where [`QuestionTextRules<T>`](#questiontextrulest) inlines its rule, the speaker name rules lean on the common `RequiredStringRules<T>` base, which already encodes the required-plus-max-length pattern; the subclass just supplies the selector, a human label, and the length constant. `[Rubric §24 - Forms/Validation/UX Safety]` and `[Rubric §1 - SOLID]` as with the question rule.
- **Walkthrough** - the constructor (`SpeakerValidationRules.cs:14`) forwards `selector`, the label `"First Name"`, and `SpeakerInvariants.FirstNameMaxLength` to `base(...)` (`:15`). No other logic; the base owns the rule chain.
- **Where it's used** - `Include`d by [`SpeakerUpdateRequestValidator`](#speakerupdaterequestvalidator) and the speaker-create validator.

### SpeakerLastNameRules<T>

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.Validation` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/Validation/SpeakerValidationRules.cs:22` · Level 5 · class

- **What it is** - the last-name twin of [`SpeakerFirstNameRules<T>`](#speakerfirstnamerulest): the identical shape wired to the last-name field.
- **Depends on** - [`RequiredStringRules<T>`](group-06-validation.md#requiredstringrulest), [`SpeakerInvariants`](group-17-conference-domain.md#speakerinvariants) (for `LastNameMaxLength`).
- **Walkthrough** - the constructor (`SpeakerValidationRules.cs:25`) passes the label `"Last Name"` and `SpeakerInvariants.LastNameMaxLength` to `base(...)` (`:26`). See [`SpeakerFirstNameRules<T>`](#speakerfirstnamerulest) for the pattern.
- **Where it's used** - `Include`d by [`SpeakerUpdateRequestValidator`](#speakerupdaterequestvalidator) and the speaker-create validator.

### AddCategoryItemCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/UseCases/AddCategoryItem/AddCategoryItemCommand.cs:19` · Level 6 · record

- **What it is** - the CQRS command to add a new `CategoryItem` (a selectable option like a track or level) to an existing conference `Category`, invalidating the category cache on success.
- **Depends on** - [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), [`Category`](group-17-conference-domain.md#category) (only to derive its cache-prefix key), and the module aliases `ConferenceCategoryIdentifierType` and `CategoryItemIdentifierType`.
- **Concept introduced - the cache-invalidating command.** A mutation implements [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) to declare a `CachePrefix`; the `CachingCommandDecorator` in the CQRS pipeline (see [Group 05](group-05-cqrs-pipeline.md#icacheinvalidating)) reads that prefix after the handler succeeds and evicts matching entries so stale reads do not survive a write. `[Rubric §6 - CQRS & Event-Driven]` (the write side declares its read-side invalidation contract). `[Rubric §12 - Performance & Scalability]` (output-cached category reads stay fresh without a blanket flush).
- **Walkthrough** - the positional record (`AddCategoryItemCommand.cs:19`) carries `CategoryId`, a nullable `CategoryItemId` (documented at `:16` as the Sessionize-assigned id, or `null` to let the database generate identity), `Name`, and an `int Sort`. `CachePrefix` (`:26`) is computed as `$"{typeof(Category).FullName}:"`, keying invalidation to the whole Category namespace.
- **Why it's built this way** - the nullable `CategoryItemId` lets one command serve both the Sessionize import (which supplies external ids) and manual creation (which lets the DB assign one); a positional record keeps the message immutable and terse.
- **Where it's used** - validated by [`AddCategoryItemCommandValidator`](#addcategoryitemcommandvalidator) and executed by [`AddCategoryItemHandler`](#addcategoryitemhandler).

### CategoryItemDTOMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.DTOs` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/DTOs/CategoryItemDTOMapper.cs:12` · Level 6 · class

- **What it is** - the source-generated mapper that turns a `CategoryItem` domain entity into a `CategoryItemDTO` for API responses.
- **Depends on** - [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype), [`CategoryItem`](group-17-conference-domain.md#categoryitem), [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto), and Mapperly (`Riok.Mapperly.Abstractions`).
- **Concept introduced - the Mapperly-backed DTO mapper (ADR-001).** ADC maps entities to DTOs explicitly rather than by reflection convention. The `[Mapper]` attribute on a `partial class` lets Mapperly generate the field-by-field `MapToDTO` body at compile time, so mapping stays fast and traceable while the developer only declares the signature. `[Rubric §9 - API & Contract Design]` (explicit, compile-checked mapping contracts, no silent field drift from an AutoMapper convention). ADR-001 documents the choice of manual/generated mapping over AutoMapper.
- **Walkthrough** - `[Mapper]` (`CategoryItemDTOMapper.cs:11`) marks the class; `MapToDTO` (`:16`) is the `partial` method Mapperly fills in. `MapToDTOs` (`:19`) is hand-written: it null-guards the collection and projects each entity through `MapToDTO` with a collection expression (`:22`).
- **Where it's used** - injected into [`ConferenceCategoryDTOMapper`](#conferencecategorydtomapper) as a child mapper and into [`AddCategoryItemHandler`](#addcategoryitemhandler) to shape the created item; also used by the read-side `IEntityQueryService` for category-item queries.

### SpeakerUpdateRequestValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Update/SpeakerUpdateRequestValidator.cs:7` · Level 6 · class

- **What it is** - the FluentValidation validator for [`SpeakerUpdateRequest`](#speakerupdaterequest), assembled entirely by composing the reusable speaker field rules.
- **Depends on** - [`SpeakerFirstNameRules<T>`](#speakerfirstnamerulest), [`SpeakerLastNameRules<T>`](#speakerlastnamerulest), [`SpeakerUpdateRequest`](#speakerupdaterequest), and FluentValidation's `AbstractValidator<T>`.
- **Concept reinforced - validators as rule compositions.** A concrete validator's job is to say *which* fields it has and to pull in the shared rule for each via `Include(...)`, so the actual constraints live once in the field rules. The `ValidatingCommandDecorator` runs this validator before the transaction opens (see the CQRS pipeline in [Group 05](group-05-cqrs-pipeline.md#icacheinvalidating)). `[Rubric §24 - Forms/Validation/UX Safety]` (request validation happens before any state change).
- **Walkthrough** - the constructor (`SpeakerUpdateRequestValidator.cs:9`) calls `Include(new SpeakerFirstNameRules<SpeakerUpdateRequest>(p => p.FirstName))` and the matching last-name include (`:11`-`:12`). No inline rules; every constraint is inherited from the composed field rules.
- **Where it's used** - resolved by the validating decorator when an [`UpdateSpeakerCommand`](#updatespeakercommand) carries this request.

### UpdateSpeakerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Update/UpdateSpeakerCommand.cs:14` · Level 6 · record

- **What it is** - the CQRS command that pairs a target speaker `Id` with its [`SpeakerUpdateRequest`](#speakerupdaterequest) payload, invalidating the speaker cache on success.
- **Depends on** - [`ICommandWithRequest<out TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest), [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), [`SpeakerUpdateRequest`](#speakerupdaterequest), [`Speaker`](group-17-conference-domain.md#speaker) (for the cache prefix), and `SpeakerIdentifierType`.
- **Concept introduced - the request-carrying command.** Implementing [`ICommandWithRequest<TRequest>`](group-05-cqrs-pipeline.md#icommandwithrequestout-trequest) advertises that this command wraps a validated request DTO, which is how the validating decorator knows to run [`SpeakerUpdateRequestValidator`](#speakerupdaterequestvalidator) against `Request` rather than the command itself. It also implements [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), same as [`AddCategoryItemCommand`](#addcategoryitemcommand). `[Rubric §6 - CQRS & Event-Driven]`.
- **Walkthrough** - the positional record (`UpdateSpeakerCommand.cs:14`) carries `SpeakerIdentifierType Id` and `SpeakerUpdateRequest Request`; `CachePrefix` (`:17`) is `$"{typeof(Speaker).FullName}:"`, so a successful update evicts cached speaker reads.
- **Where it's used** - dispatched by the speaker update controller endpoint and executed by [`UpdateSpeakerHandler`](#updatespeakerhandler).

### AddCategoryItemCommandValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/UseCases/AddCategoryItem/AddCategoryItemCommandValidator.cs:7` · Level 7 · class

- **What it is** - the FluentValidation validator for [`AddCategoryItemCommand`](#addcategoryitemcommand), composed from the reusable category-item field rules.
- **Depends on** - [`CategoryItemNameRules<T>`](#categoryitemnamerulest), [`CategoryItemSortRules<T>`](#categoryitemsortrulest), [`AddCategoryItemCommand`](#addcategoryitemcommand), and `AbstractValidator<T>`.
- **Concept reinforced - validator by composition.** Same shape as [`SpeakerUpdateRequestValidator`](#speakerupdaterequestvalidator): `Include` one field rule per validated property. Here it validates the command directly (the command *is* the request), rather than a nested request DTO. `[Rubric §24 - Forms/Validation/UX Safety]`.
- **Walkthrough** - the constructor (`AddCategoryItemCommandValidator.cs:9`) includes `CategoryItemNameRules<AddCategoryItemCommand>(p => p.Name)` (`:11`) and `CategoryItemSortRules<AddCategoryItemCommand>(p => p.Sort)` (`:12`).
- **Where it's used** - run by the validating decorator ahead of [`AddCategoryItemHandler`](#addcategoryitemhandler).

### ConferenceCategoryDTOMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.DTOs` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/DTOs/ConferenceCategoryDTOMapper.cs:13` · Level 7 · class

- **What it is** - the mapper that turns a [`Category`](group-17-conference-domain.md#category) aggregate into a [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto), delegating child-item mapping to [`CategoryItemDTOMapper`](#categoryitemdtomapper).
- **Depends on** - [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype), [`Category`](group-17-conference-domain.md#category), [`ConferenceCategoryDTO`](group-17-conference-domain.md#conferencecategorydto), [`CategoryItemDTOMapper`](#categoryitemdtomapper), and Mapperly.
- **Concept reinforced - nested Mapperly mappers.** A parent aggregate that owns a child collection composes the child's mapper rather than duplicating its mapping. Mapperly's `[UseMapper]` on an injected mapper field tells the generator to route the nested `CategoryItem` collection through the already-defined [`CategoryItemDTOMapper`](#categoryitemdtomapper). This is why this mapper sits one level above [`CategoryItemDTOMapper`](#categoryitemdtomapper) in the dependency graph. `[Rubric §9 - API & Contract Design]` and `[Rubric §1 - SOLID]` (reuse the child mapper instead of re-implementing it).
- **Walkthrough** - the primary constructor (`ConferenceCategoryDTOMapper.cs:13`) injects a `CategoryItemDTOMapper`, stored in the `[UseMapper]` field `_categoryItemDTOMapper` (`:17`-`:18`) that Mapperly wires into the generated `MapToDTO` (`:21`). `MapToDTOs` (`:24`) is the same hand-written null-guarded projection as its sibling mapper.
- **Where it's used** - resolved for conference-category query and read endpoints; registered via the Scrutor scan.

### AddCategoryItemHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/UseCases/AddCategoryItem/AddCategoryItemHandler.cs:15` · Level 8 · class

- **What it is** - the command handler for [`AddCategoryItemCommand`](#addcategoryitemcommand): it loads the parent category aggregate, delegates the actual add to the aggregate, persists, and returns the new item as a DTO.
- **Depends on** - [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`CategoryItemDTOMapper`](#categoryitemdtomapper), [`Category`](group-17-conference-domain.md#category), [`CategoryItemDTO`](group-17-conference-domain.md#categoryitemdto), [`Result`](group-01-result-error-handling.md#result), [`Error`](group-01-result-error-handling.md#error), and `ILogger<T>`.
- **Concept introduced - the load / delegate / save / map handler shape.** The canonical write handler does four things: fetch the aggregate through the [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) repository, call a *domain method* that enforces invariants and raises events, `SaveChangesAsync` (which commits, stamps audit, and dispatches domain events through the outbox), and map the result to a DTO. Business rules live in the aggregate, never in the handler. `[Rubric §4 - DDD]` (the handler orchestrates; `Category.AddCategoryItem` owns the invariant). `[Rubric §6 - CQRS & Event-Driven]` and `[Rubric §3 - Clean Architecture]` (the handler depends only on abstractions).
- **Walkthrough** - `HandleAsync` (`AddCategoryItemHandler.cs:21`) resolves the `Category` repository via `unitOfWork.GetRepository<Category, ConferenceCategoryIdentifierType>()` (`:25`) and loads by id (`:26`). A missing aggregate returns `Result.Failure<CategoryItemDTO>(Error.NotFound...)` tagged with source and target (`:27`-`:28`). Otherwise it delegates to `category.AddCategoryItem(command.CategoryItemId, command.Name, command.Sort)` (`:30`); if that domain call fails, its errors are propagated verbatim (`:31`-`:32`). On success it awaits `SaveChangesAsync` (`:34`), logs via the generated `LogCategoryItemAdded` (`:36`, defined `:41`), and returns `Result.Success(dtoMapper.MapToDTO(result.Value!))` (`:38`).
- **Why it's built this way** - pushing the add logic into `Category.AddCategoryItem` keeps the consistency boundary inside the aggregate; the handler stays a thin orchestrator returning [`Result<T>`](group-01-result-error-handling.md#result) so failures flow as values (mapped to HTTP status by the API layer) rather than exceptions.
- **Where it's used** - invoked by the category controller's add-item endpoint through the CQRS decorator pipeline (feature-gate, logging, caching, validating, transactional wrappers).

### UpdateSpeakerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.Update` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Update/UpdateSpeakerHandler.cs:15` · Level 8 · class

- **What it is** - the command handler for [`UpdateSpeakerCommand`](#updatespeakercommand): it loads the speaker, applies the client's optimistic-concurrency token, delegates the field changes to the domain `Update` method, persists, and returns the updated DTO.
- **Depends on** - [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`SpeakerDTOMapper`](group-18-conference-application.md#speakerdtomapper), [`Speaker`](group-17-conference-domain.md#speaker), [`SpeakerDTO`](group-17-conference-domain.md#speakerdto), [`Result`](group-01-result-error-handling.md#result), [`Error`](group-01-result-error-handling.md#error), and `ILogger<T>`.
- **Concept reinforced - the load/delegate/save/map handler with optimistic concurrency.** Same four-step shape as [`AddCategoryItemHandler`](#addcategoryitemhandler), with one extra step that makes it worth studying: before applying changes it stamps the repository with the request's last-seen `RowVersion` so a concurrent edit surfaces as a 409 rather than a silent last-write-wins. `[Rubric §8 - Data Architecture]` (optimistic concurrency via the rowversion token) and `[Rubric §4 - DDD]` (the entity's own `Update` enforces the invariants).
- **Walkthrough** - `HandleAsync` (`UpdateSpeakerHandler.cs:21`) gets the `Speaker` repository (`:25`) and loads by `command.Id` (`:26`); a null entity returns `Error.NotFound` (`:27`-`:28`). It then calls `repository.SetOriginalRowVersion(entity, command.Request.RowVersion)` (`:32`), the comment (`:30`-`:31`) explaining that this makes a stale edit throw `DbUpdateConcurrencyException`, which the pipeline maps to 409. It delegates every editable field to `entity.Update(...)` (`:34`-`:46`), propagates failure errors (`:48`-`:49`), awaits `SaveChangesAsync` (`:51`), logs via `LogSpeakerUpdated` (`:53`, defined `:58`), and returns `Result.Success(dtoMapper.MapToDTO(entity))` (`:55`).
- **Why it's built this way** - routing all mutation through `Speaker.Update` keeps validation and event-raising inside the aggregate; injecting the client's token before the write is what turns EF's concurrency check into a user-visible 409 instead of data loss.
- **Where it's used** - invoked by the speaker update controller endpoint through the CQRS decorator pipeline (its request is validated by [`SpeakerUpdateRequestValidator`](#speakerupdaterequestvalidator) before the transaction opens).

### ConferenceCategoryCreateRequest

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.Create` · `MMCA.ADC.Conference.Application/Categories/UseCases/Create/ConferenceCategoryCreateRequest.cs:10` · Level 6 · record

- **What it is**: the request DTO a client posts to create a conference [`Category`](group-17-conference-domain.md#category). It carries the four inbound fields (`Id`, `Title`, `Sort`, `Type`) and doubles as the command that flows through the CQRS pipeline; there is no separate command wrapper for create in this module.
- **Depends on**: [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) and [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) (both `MMCA.Common.Application`), and the [`Category`](group-17-conference-domain.md#category) entity only for its `FullName` in the cache prefix (`ConferenceCategoryCreateRequest.cs:1,13`). `ConferenceCategoryIdentifierType` is the module identifier alias (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Concept introduced**: **the request-is-the-command idiom.** Rather than a `CreateXCommand` record wrapping a `CreateXRequest`, the create path lets one `record class` be both the wire contract and the handler input. Implementing [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) (a marker) lets the generic entity request-mapper pipeline recognize it, and [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) opts it into the [`CachingCommandDecorator`](group-05-cqrs-pipeline.md#icacheinvalidating) so a successful create evicts the read cache. `[Rubric §6, CQRS & Event-Driven]` assesses whether writes are modeled as explicit intents flowing through a uniform pipeline: this record is the command, and the marker interfaces are how cross-cutting behavior attaches to it declaratively.
- **Walkthrough**: `CachePrefix` (`:13`) returns `"{typeof(Category).FullName}:"`, the key namespace the caching decorator wipes on success. `Id` (`:16`) is `init`-only and optional (auto-generated when unset). `Title` (`:19`) is `required string`, the one field the validator guards. `Sort` (`:22`) is an `int` display order defaulting to zero. `Type` (`:25`) is an optional discriminator string ("session", "speaker").
- **Why it's built this way**: `required`/`init` gives an immutable request whose one mandatory field cannot be omitted at the compiler level, matching the codebase-wide immutability convention. Cache invalidation keyed off the entity's `FullName` keeps producer (this request) and consumer (the query cache) agreed on one prefix string.
- **Where it's used**: consumed by [`ConferenceCategoryCreateRequestValidator`](#conferencecategorycreaterequestvalidator), translated by [`ConferenceCategoryCreateRequestMapper`](#conferencecategorycreaterequestmapper), and handled by [`CreateConferenceCategoryHandler`](#createconferencecategoryhandler).

### EventQuestionAnswerDTOMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.DTOs` · `MMCA.ADC.Conference.Application/Events/DTOs/EventQuestionAnswerDTOMapper.cs:12` · Level 6 · class

- **What it is**: the Mapperly-generated mapper that turns an [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer) domain entity into its wire-facing [`EventQuestionAnswerDTO`](group-17-conference-domain.md#eventquestionanswerdto).
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) (the mapper contract), [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer), [`EventQuestionAnswerDTO`](group-17-conference-domain.md#eventquestionanswerdto), and the Mapperly source generator (`Riok.Mapperly.Abstractions`, `EventQuestionAnswerDTOMapper.cs:4`).
- **Concept introduced**: **source-generated DTO mapping (ADR-001).** The class is `partial` and carries `[Mapper]` (`:11-12`); Mapperly generates the body of the `partial EventQuestionAnswerDTO MapToDTO(...)` (`:16`) at compile time by name-matching properties, so there is no runtime reflection and no hand-written field copy. This is the manual-mapping-versus-Mapperly split described in ADR-001: property-name-parallel entity/DTO pairs get generated mappers; only mismatches need hand-written code (see [`EventDTOMapper`](#eventdtomapper) for such a case). `[Rubric §9, API & Contract Design]` assesses whether the domain model is shielded from the wire contract: this mapper keeps the entity and DTO as two separate shapes rather than serializing entities directly.
- **Walkthrough**: the generated `MapToDTO` (`:16`) does the single-entity conversion. `MapToDTOs` (`:19`) is hand-written: it null-guards the collection (`:21`) then projects each element through `MapToDTO` into a materialized array (`:22`). The mapper is registered by assembly scanning (Scrutor), so it is resolved by DI, not `new`-ed.
- **Where it's used**: injected into the Conference read pipeline and into [`EventDTOMapper`](#eventdtomapper), which composes it as a child mapper.

### EventSpeakerDTOMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.DTOs` · `MMCA.ADC.Conference.Application/Events/DTOs/EventSpeakerDTOMapper.cs:12` · Level 6 · class

- **What it is**: the Mapperly mapper from [`EventSpeaker`](group-17-conference-domain.md#eventspeaker) to [`EventSpeakerDTO`](group-17-conference-domain.md#eventspeakerdto).
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype), the two mapped types, and the Mapperly generator (`EventSpeakerDTOMapper.cs:4,11`).
- **Concept introduced**: none new. Structurally identical to [`EventQuestionAnswerDTOMapper`](#eventquestionanswerdtomapper): `[Mapper]` + `partial MapToDTO` (`:11-16`) generated, `MapToDTOs` (`:19`) the same null-guarded projection. See that section for the source-generated mapping concept (ADR-001).
- **Where it's used**: composed by [`EventDTOMapper`](#eventdtomapper) and resolved via Scrutor.

### OwnEventQuestionAnswerSpecification

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Specifications` · `MMCA.ADC.Conference.Application/Events/Specifications/OwnEventQuestionAnswerSpecification.cs:11` · Level 6 · class

- **What it is**: an authorization specification that narrows an [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer) query to rows the current user authored (BR-8). Attendees see only their own answers; organizers bypass it by passing no specification.
- **Depends on**: [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype) (the base, `MMCA.Common.Domain.Specifications`), [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer), and `System.Linq.Expressions` (`OwnEventQuestionAnswerSpecification.cs:1-3`). `UserIdentifierType` is the Identity module's alias, taken as a primary-constructor parameter (`:11`).
- **Concept introduced**: **authorization-as-a-specification.** Instead of an ad-hoc `WHERE` in a controller or handler, the ownership rule is a reusable object: `Criteria` (`:15-16`) is the `Expression<Func<EventQuestionAnswer, bool>>` `a => a.CreatedBy == userId`, so the same predicate translates to SQL when composed into a query and evaluates in memory via `IsSatisfiedBy` (inherited from the base). The `CreatedBy` audit field (stamped centrally, see [primer](00-primer.md#2-architectural-styles-this-codebase-commits-to)) is the ownership key. `[Rubric §11, Security]` assesses whether authorization is enforced as first-class, testable policy: this encodes an ownership rule as a composable specification rather than scattered conditionals.
- **Why it's built this way**: passing the specification (or `null` for organizers) into the query service lets one read endpoint serve both roles without branching handler code; the predicate is unit-testable in isolation (see `OwnEventQuestionAnswerSpecificationTests`).
- **Where it's used**: supplied by the Conference read path / query service for event-question-answer listings scoped to the caller.
- **Caveats / not-in-source**: the earlier edition described this as scoping to answers "belonging to events owned by the current user"; the current `Criteria` scopes strictly by `CreatedBy == userId` (the answer's author), not by event ownership.

### PublishedEventSpecification

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.Specifications` · `MMCA.ADC.Conference.Application/Events/Specifications/PublishedEventSpecification.cs:11` · Level 6 · class

- **What it is**: a specification that restricts an [`Event`](group-17-conference-domain.md#event) query to published events only (BR-108), applied on the public read paths for non-organizer callers.
- **Depends on**: [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype), [`Event`](group-17-conference-domain.md#event), and `System.Linq.Expressions` (`PublishedEventSpecification.cs:1-3`).
- **Concept introduced**: none new; see [`OwnEventQuestionAnswerSpecification`](#owneventquestionanswerspecification) for the specification-as-authorization concept. This is the simplest possible instance: a parameterless class whose `Criteria` (`:14`) is `e => e.IsPublished`. `[Rubric §11, Security]` again: draft/unpublished events are hidden from anonymous and attendee reads by policy object rather than by controller guard.
- **Why it's built this way**: because publication state is a boolean flag on the aggregate, the predicate is a single property access that EF translates directly to `WHERE IsPublished = 1`, keeping the visibility rule in one named, testable place shared across every anonymous read.
- **Where it's used**: applied by the Conference event read endpoints for non-organizer users (organizers pass no specification and see drafts).

### RemoveCategoryItemCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.RemoveCategoryItem` · `MMCA.ADC.Conference.Application/Categories/UseCases/RemoveCategoryItem/RemoveCategoryItemCommand.cs:15` · Level 6 · record

- **What it is**: the command to remove one item from a conference [`Category`](group-17-conference-domain.md#category) aggregate, identified by the owning `CategoryId` and the target `CategoryItemId`.
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) and the [`Category`](group-17-conference-domain.md#category) type for the cache prefix (`RemoveCategoryItemCommand.cs:2,20`). `ConferenceCategoryIdentifierType` / `CategoryItemIdentifierType` are the module aliases.
- **Concept introduced**: none new; this is the child-removal shape of the CQRS command pattern (parent id + child id + cache invalidation). The positional `record` (`:15-17`) carries the two ids, and `CachePrefix` (`:20`) evicts the category read cache on success, exactly as [`ConferenceCategoryCreateRequest`](#conferencecategorycreaterequest) does. `[Rubric §6, CQRS & Event-Driven]`: the mutation is an explicit intent, and child mutations route through the aggregate root rather than deleting a child row directly.
- **Walkthrough**: `CategoryId` and `CategoryItemId` (`:16-17`) are the two positional parameters; `CachePrefix` (`:20`) returns the `Category` full-name prefix. There is nothing else: the record is pure intent, the behavior lives in its handler.
- **Where it's used**: handled by [`RemoveCategoryItemHandler`](#removecategoryitemhandler), which tolerates a default (unset) `CategoryId`.

### RoomDTOMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.DTOs` · `MMCA.ADC.Conference.Application/Events/DTOs/RoomDTOMapper.cs:12` · Level 6 · class

- **What it is**: the Mapperly mapper from [`Room`](group-17-conference-domain.md#room) to [`RoomDTO`](group-17-conference-domain.md#roomdto).
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype), the two mapped types, and the Mapperly generator (`RoomDTOMapper.cs:4,11`).
- **Concept introduced**: none new. Identical shape to [`EventQuestionAnswerDTOMapper`](#eventquestionanswerdtomapper): generated `partial MapToDTO` (`:16`) plus the hand-written null-guarded `MapToDTOs` (`:19`). See that section for the ADR-001 source-generated mapping concept.
- **Where it's used**: composed by [`EventDTOMapper`](#eventdtomapper) as a child mapper and resolved via Scrutor.

### UpdateCategoryItemCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem` · `MMCA.ADC.Conference.Application/Categories/UseCases/UpdateCategoryItem/UpdateCategoryItemCommand.cs:17` · Level 6 · record

- **What it is**: the command to update one item inside a [`Category`](group-17-conference-domain.md#category) aggregate: the two ids that locate it plus the new `Name` and `Sort`.
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) and the [`Category`](group-17-conference-domain.md#category) type for the cache prefix (`UpdateCategoryItemCommand.cs:2,24`).
- **Concept introduced**: none new; it is the update sibling of [`RemoveCategoryItemCommand`](#removecategoryitemcommand), adding the mutated fields. The positional `record` (`:17-21`) carries `CategoryId`, `CategoryItemId`, `Name`, `Sort`; `CachePrefix` (`:24`) evicts the category cache. The two content fields (`Name`, `Sort`) are what its validator guards.
- **Walkthrough**: `CategoryId` / `CategoryItemId` (`:18-19`) locate the child; `Name` (`:20`) and `Sort` (`:21`) are the new values; `CachePrefix` (`:24`) returns the `Category` prefix.
- **Where it's used**: validated by [`UpdateCategoryItemCommandValidator`](#updatecategoryitemcommandvalidator) and handled by [`UpdateCategoryItemHandler`](#updatecategoryitemhandler).

### ConferenceCategoryCreateRequestMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.Create` · `MMCA.ADC.Conference.Application/Categories/UseCases/Create/ConferenceCategoryCreateRequestMapper.cs:11` · Level 7 · class

- **What it is**: the request-to-entity mapper that turns a validated [`ConferenceCategoryCreateRequest`](#conferencecategorycreaterequest) into a [`Category`](group-17-conference-domain.md#category) by calling the domain factory.
- **Depends on**: [`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) (the contract), [`ConferenceCategoryCreateRequest`](#conferencecategorycreaterequest), [`Category`](group-17-conference-domain.md#category), and [`Result<T>`](group-01-result-error-handling.md#result) (`ConferenceCategoryCreateRequestMapper.cs:1-3`).
- **Concept introduced**: **the request mapper as the factory gateway.** Unlike a DTO mapper (pure property copy), a request mapper is allowed to fail: `CreateEntityAsync` (`:15`) returns `Task<Result<Category>>` because it delegates to `Category.Create(...)` (`:19-23`), the domain factory that enforces invariants and returns a failure [`Result`](group-01-result-error-handling.md#result) on invalid input. This keeps entity construction (and its invariants) inside the domain while the application layer only wires the fields across. `[Rubric §4, Domain-Driven Design]`: invalid entities cannot be constructed because the only path in is the `Result`-returning factory; the mapper never `new`s a `Category`.
- **Walkthrough**: `CreateEntityAsync` (`:15`) null-guards the request (`:17`) then returns `Task.FromResult(Category.Create(request.Id, request.Title, request.Sort, request.Type))` (`:19-23`), passing the four request fields positionally to the factory. It is synchronous work wrapped in `Task.FromResult` because no I/O is involved.
- **Why it's built this way**: the generic create pipeline ([`CreateConferenceCategoryHandler`](#createconferencecategoryhandler)) is entity-agnostic; per-entity construction lives behind this small mapper so the handler can stay reusable across aggregates.
- **Where it's used**: injected into [`CreateConferenceCategoryHandler`](#createconferencecategoryhandler) as the `IEntityRequestMapper` for `Category`.

### ConferenceCategoryCreateRequestValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.Create` · `MMCA.ADC.Conference.Application/Categories/UseCases/Create/ConferenceCategoryCreateRequestValidator.cs:7` · Level 7 · class

- **What it is**: the FluentValidation validator for [`ConferenceCategoryCreateRequest`](#conferencecategorycreaterequest), enforced by the pipeline before the create handler runs.
- **Depends on**: `AbstractValidator<T>` (FluentValidation), [`ConferenceCategoryCreateRequest`](#conferencecategorycreaterequest), and the shared [`ConferenceCategoryTitleRules<T>`](#conferencecategorytitlerulest) rule set (`ConferenceCategoryCreateRequestValidator.cs:1-2`).
- **Concept introduced**: **rule-set composition via `Include`.** Rather than re-declaring the title rules inline, the constructor (`:9-10`) calls `Include(new ConferenceCategoryTitleRules<ConferenceCategoryCreateRequest>(p => p.Title))`, folding a reusable rule object (parameterized by a property selector) into this validator. The same rule set is reused by the update-category validator, so the `Title` constraints (length, non-empty) live in exactly one place. `[Rubric §24, Forms/Validation/UX Safety]` (and `[Rubric §1, SOLID]`): validation is DRY and single-responsibility, one rule set, many validators. The [`ValidatingCommandDecorator`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) runs this before the transaction opens.
- **Walkthrough**: the whole body is the expression-bodied constructor (`:9-10`): a single `Include` of the title rule set bound to `p => p.Title`. Nothing else is validated at the request level (the `Id`/`Sort`/`Type` fields carry no create-time constraints).
- **Where it's used**: discovered by Scrutor and invoked by the validating decorator ahead of [`CreateConferenceCategoryHandler`](#createconferencecategoryhandler).

### EventDTOMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.DTOs` · `MMCA.ADC.Conference.Application/Events/DTOs/EventDTOMapper.cs:14` · Level 7 · class

- **What it is**: the Mapperly mapper from the [`Event`](group-17-conference-domain.md#event) aggregate to its [`EventDTO`](group-17-conference-domain.md#eventdto), including its child collections (rooms, speakers, question answers).
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype), the Mapperly generator, and three injected child mappers: [`RoomDTOMapper`](#roomdtomapper), [`EventSpeakerDTOMapper`](#eventspeakerdtomapper), [`EventQuestionAnswerDTOMapper`](#eventquestionanswerdtomapper) (`EventDTOMapper.cs:14-17`).
- **Concept introduced**: **composed mappers and the hand-written escape hatch.** This is the non-trivial Mapperly case the simpler mappers cross-reference. Two things go beyond name-matching. First, the three child mappers are marked `[UseMapper]` (`:20-27`), so Mapperly reuses them for the nested collections instead of regenerating that logic (mapper composition). Second, one field cannot be expressed in Mapperly: the domain's `LastSessionizeRefreshBy` is a `UserIdentifierType?` while the DTO wants a `string?`. So the public `MapToDTO` (`:30`) calls the generated `MapToDTOGenerated` (`:51`, which is told to ignore that field via `[MapperIgnoreTarget]` at `:50`) and then patches it with a `with` expression that culture-invariantly stringifies the id (`:36-40`). `[Rubric §9, API & Contract Design]`: the aggregate's wire shape is assembled from composable per-child mappers, with a documented hand-written seam only where the type conversion is not generatable.
- **Walkthrough**: the three `[UseMapper]` fields (`:20-27`) hold the child mappers from the primary constructor. `MapToDTO` (`:30`) null-guards (`:32`), runs `MapToDTOGenerated` (`:33`), then returns `dto with { LastSessionizeRefreshBy = ... ToString(InvariantCulture) }` (`:36-40`). `MapToDTOs` (`:44`) is the standard null-guarded projection. `MapToDTOGenerated` (`:51`) is the private Mapperly-generated core with the ignore attribute on the un-mappable field (`:50`).
- **Why it's built this way**: the `CultureInfo.InvariantCulture` on the `ToString` (`:39`) keeps the id string stable across server locales; composing child mappers avoids duplicating room/speaker/answer mapping already defined once.
- **Where it's used**: the primary DTO mapper for Conference `Event` reads, resolved and its children auto-injected by Scrutor/DI.

### UpdateCategoryItemCommandValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem` · `MMCA.ADC.Conference.Application/Categories/UseCases/UpdateCategoryItem/UpdateCategoryItemCommandValidator.cs:7` · Level 7 · class

- **What it is**: the FluentValidation validator for [`UpdateCategoryItemCommand`](#updatecategoryitemcommand), checking the new `Name` and `Sort` before the update handler runs.
- **Depends on**: `AbstractValidator<T>` (FluentValidation), [`UpdateCategoryItemCommand`](#updatecategoryitemcommand), and two shared rule sets, [`CategoryItemNameRules<T>`](#categoryitemnamerulest) and [`CategoryItemSortRules<T>`](#categoryitemsortrulest) (`UpdateCategoryItemCommandValidator.cs:1-2`).
- **Concept introduced**: none new; same `Include`-composition idiom as [`ConferenceCategoryCreateRequestValidator`](#conferencecategorycreaterequestvalidator), but folding **two** rule sets. The constructor (`:9-13`) `Include`s `CategoryItemNameRules` bound to `p => p.Name` (`:11`) and `CategoryItemSortRules` bound to `p => p.Sort` (`:12`). `[Rubric §24, Forms/Validation/UX Safety]`: the item's field rules are shared with any other command that edits the same fields, so constraints stay single-sourced.
- **Walkthrough**: two `Include` calls in the constructor body (`:11-12`), one per validated field; nothing validates the two id fields (they are resolved and existence-checked by the handler, which returns `NotFound` when the category or item is missing).
- **Where it's used**: invoked by the validating decorator ahead of [`UpdateCategoryItemHandler`](#updatecategoryitemhandler).

### CreateConferenceCategoryHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.Create` · `MMCA.ADC.Conference.Application/Categories/UseCases/Create/CreateConferenceCategoryHandler.cs:16` · Level 8 · class

- **What it is**: the command handler that creates a conference [`Category`](group-17-conference-domain.md#category): map the request to an entity, persist it, log, and return the mapped DTO.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) (the contract), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), the [`IEntityRequestMapper`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) for `Category` (satisfied by [`ConferenceCategoryCreateRequestMapper`](#conferencecategorycreaterequestmapper)), [`ConferenceCategoryDTOMapper`](group-18-conference-application.md#conferencecategorydtomapper), and `ILogger<T>` (`CreateConferenceCategoryHandler.cs:16-20`).
- **Concept introduced**: **the write-handler shape and high-performance logging.** The handler is a `sealed partial` class using a primary constructor for DI (`:16-20`) and implements `ICommandHandler<ConferenceCategoryCreateRequest, Result<ConferenceCategoryDTO>>`. It is deliberately thin because the cross-cutting concerns (validation, caching, transaction, logging) are added by the decorator pipeline around it (see [primer](00-primer.md#2-architectural-styles-this-codebase-commits-to) and [Group 05](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)); the handler only orchestrates the happy path. `[Rubric §6, CQRS & Event-Driven]` (one intent, one handler) and `[Rubric §13, Observability & Operability]`: the `[LoggerMessage]` source-generated log (`:42-43`) is the compile-time, allocation-free logging pattern, no boxing, no runtime format parsing.
- **Walkthrough**: `HandleAsync` (`:23`) first calls the request mapper (`:27`) and short-circuits with `Result.Failure` if the domain factory rejected the input (`:28-29`), propagating the errors. On success it takes the entity (`:31`), gets the typed repository from the unit of work (`:32`), `AddAsync`es it (`:34`), and `SaveChangesAsync`es (`:35`), the single save that persists the row (and would flush any domain events via the outbox). It then emits the source-generated `LogConferenceCategoryCreated` (`:37`) and returns `Result.Success` wrapping the DTO from `dtoMapper.MapToDTO(entity)` (`:39`). The `[LoggerMessage]` partial (`:42-43`) declares the structured template.
- **Why it's built this way**: the handler never opens a transaction or invalidates cache itself; those are the [`TransactionalCommandDecorator`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) and [`CachingCommandDecorator`](group-05-cqrs-pipeline.md#icacheinvalidating)'s jobs, driven by the marker interfaces the request implements. This keeps the handler focused and the cross-cutting behavior uniform across every command (ADR-014 pipeline).
- **Where it's used**: invoked by the Categories REST controller (via the decorated command dispatch) on `POST` of a new category.

### RemoveCategoryItemHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.RemoveCategoryItem` · `MMCA.ADC.Conference.Application/Categories/UseCases/RemoveCategoryItem/RemoveCategoryItemHandler.cs:13` · Level 8 · class

- **What it is**: the handler for [`RemoveCategoryItemCommand`](#removecategoryitemcommand): load the owning [`Category`](group-17-conference-domain.md#category) aggregate with its items and delegate the removal to the aggregate root.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error), and `ILogger<T>` (`RemoveCategoryItemHandler.cs:1-5,13-15`).
- **Concept introduced**: **routing child mutation through the aggregate root, plus a defensive id resolution.** The handler never deletes a child row directly; it loads the `Category` (eager-including `CategoryItems`, tracked) and calls `entity.RemoveCategoryItem(...)` (`:49`) so the aggregate enforces its own consistency (this is the DDD boundary rule from [Group 02](group-02-domain-building-blocks.md)). The load path is dual: because the DELETE endpoint takes the category id as an *optional* query parameter and the UI's generic delete sends only the item id (arriving as the default `0`), a `CategoryId == default` (`:28`) triggers a reverse lookup, find the owning category by `CategoryItems.Any(ci => ci.Id == command.CategoryItemId)` (`:30-35`); otherwise it loads by id directly (`:39-43`). `[Rubric §4, Domain-Driven Design]` (mutations go through the root) and `[Rubric §9, API & Contract Design]` (a contract quirk handled explicitly, not silently mis-deleting).
- **Walkthrough**: `HandleAsync` (`:18`) gets the repository (`:22`), branches on the unset-`CategoryId` case (`:28`) to either the reverse `GetAllAsync` (`:30`) taking the first match (`:35`) or the direct `GetByIdAsync` (`:39`), both eager-loading `CategoryItems` and tracking. A `null` entity returns `Error.NotFound` sourced/targeted for diagnostics (`:46-47`). On a successful `RemoveCategoryItem` (`:49-50`) it `SaveChangesAsync`es (`:52`) and logs (`:54`); the domain `Result` is returned as-is (`:57`) so an invariant failure from the aggregate surfaces unchanged.
- **Why it's built this way**: the reverse lookup exists because of a real client contract gap (the category-item DELETE case where an unbound query id defaulted to `0`); resolving the parent from the child keeps the generic UI delete working without leaking existence. Loading with tracking is required so EF sees the child removal.
- **Where it's used**: invoked by the Categories controller on item-delete; returns 404 when neither branch finds an owner.

### UpdateCategoryItemHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem` · `MMCA.ADC.Conference.Application/Categories/UseCases/UpdateCategoryItem/UpdateCategoryItemHandler.cs:13` · Level 8 · class

- **What it is**: the handler for [`UpdateCategoryItemCommand`](#updatecategoryitemcommand): load the [`Category`](group-17-conference-domain.md#category) aggregate with its items and delegate the edit to the root.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error), and `ILogger<T>` (`UpdateCategoryItemHandler.cs:1-5,13-15`).
- **Concept introduced**: none new; it is the simpler sibling of [`RemoveCategoryItemHandler`](#removecategoryitemhandler) without the reverse-lookup branch (update always carries a real `CategoryId`). It reinforces the same DDD pattern: mutate the child only through `entity.UpdateCategoryItem(...)` (`:31`) on the aggregate root, never by touching the child entity directly.
- **Walkthrough**: `HandleAsync` (`:18`) gets the repository (`:22`), loads the category by id with `CategoryItems` eager-included and tracked (`:23-27`), and returns `Error.NotFound` when absent (`:28-29`). It calls `entity.UpdateCategoryItem(command.CategoryItemId, command.Name, command.Sort)` (`:31`); on success (`:32`) it `SaveChangesAsync`es (`:34`) and emits the source-generated log (`:36`); the domain `Result` is returned unchanged (`:39`) so an aggregate invariant failure propagates. The `[LoggerMessage]` partial is declared at `:42-43`.
- **Why it's built this way**: same rationale as the create/remove handlers: thin orchestration, cross-cutting concerns (validation, cache invalidation, transaction) applied by the decorator pipeline via the command's marker interfaces, aggregate enforces consistency internally.
- **Where it's used**: invoked by the Categories controller on item update (`PUT`/`PATCH`).

### AddEventQuestionAnswerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/AddEventQuestionAnswer/AddEventQuestionAnswerCommand.cs:17` · Level 6 · record

- **What it is** the write-side message that asks the system to record an answer to a conference-`Event` question (for example a per-attendee dietary or accessibility answer). It is a `sealed record` carrying four positional fields: the target `EventId`, an optional explicit `EventQuestionAnswerId`, the `QuestionId` being answered, and the raw `AnswerValue` string (`AddEventQuestionAnswerCommand.cs:17`).
- **Depends on** the identifier aliases `EventIdentifierType`, `EventQuestionAnswerIdentifierType`, and `QuestionIdentifierType` (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)); the framework marker [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); and the domain [`Event`](group-17-conference-domain.md#event) aggregate, referenced only to compute a cache prefix.
- **Concept introduced** this is the first cache-invalidating command in the unit, so the idiom is worth teaching once. A command is just an immutable request record; it carries data, never behavior. By also implementing [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) and exposing `CachePrefix => $"{typeof(Event).FullName}:"` (`AddEventQuestionAnswerCommand.cs:24`), the record tells the [caching decorator](group-05-cqrs-pipeline.md#icacheinvalidating) in the pipeline to evict every cached read whose key starts with the `Event` type name after the handler succeeds. The command does not touch the cache itself; the cross-cutting decorator reads this property and does the eviction, so the write and the cache concern stay separated. [Rubric §6, CQRS & Event-Driven] assesses whether writes and reads are modeled as distinct, explicit messages: here the mutation is a named record routed to a single handler. [Rubric §10, Cross-Cutting] assesses whether concerns like caching are centralized rather than sprinkled into business code: `CachePrefix` is a one-line declaration that hands the whole eviction concern to the pipeline.
- **Walkthrough** the four constructor parameters (`AddEventQuestionAnswerCommand.cs:18-21`) are the entire payload. `EventQuestionAnswerId` is nullable because the caller usually lets the database or the aggregate assign it (BR-107 upsert, handled downstream). `CachePrefix` (`:24`) is the only member with logic, and it is a pure expression.
- **Why it's built this way** modeling each mutation as its own record keeps the vertical slice self-describing (ADR-014 defines the decorator ordering that consumes `ICacheInvalidating`). Records give value equality and `with`-based copies for free, which matters for test assertions and for the caching key.
- **Where it's used** dispatched by the Conference API controller into [`AddEventQuestionAnswerHandler`](#addeventquestionanswerhandler); validated first by [`AddEventQuestionAnswerCommandValidator`](#addeventquestionanswercommandvalidator).

### AddEventSpeakerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/AddEventSpeaker/AddEventSpeakerCommand.cs:15` · Level 6 · record

- **What it is** the request to associate an existing `Speaker` with an existing `Event`. A `sealed record` with three fields: `EventId`, an optional `EventSpeakerId`, and the `SpeakerId` to attach (`AddEventSpeakerCommand.cs:15`).
- **Depends on** the aliases `EventIdentifierType`, `EventSpeakerIdentifierType`, `SpeakerIdentifierType`; [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); and [`Event`](group-17-conference-domain.md#event) for the cache prefix.
- **Concept introduced** none new. It is the same cache-invalidating command shape introduced by [`AddEventQuestionAnswerCommand`](#addeventquestionanswercommand): `CachePrefix => $"{typeof(Event).FullName}:"` (`AddEventSpeakerCommand.cs:21`) so a successful add evicts the event read cache. [Rubric §6, CQRS & Event-Driven] applies for the same reason.
- **Walkthrough** three positional parameters (`:16-18`); `EventSpeakerId` is nullable so the caller can omit it and let the aggregate assign the association id.
- **Where it's used** handled by [`AddEventSpeakerHandler`](#addeventspeakerhandler), guarded by [`AddEventSpeakerCommandValidator`](#addeventspeakercommandvalidator).

### AddRoomCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.AddRoom` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/AddRoom/AddRoomCommand.cs:20` · Level 6 · record

- **What it is** the request to add a physical room to an event. It is the richest command record in the unit: `EventId`, an optional `RoomId`, a required `Name` and `Sort` order, and four optional descriptive fields, `Capacity`, `Floor`, `Location`, and `AccessibilityInfo` (`AddRoomCommand.cs:20-28`).
- **Depends on** `EventIdentifierType`, `RoomIdentifierType`; [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); and [`Event`](group-17-conference-domain.md#event).
- **Concept introduced** none new; it reuses the cache-invalidating command shape ([`AddEventQuestionAnswerCommand`](#addeventquestionanswercommand)), with `CachePrefix` at `AddRoomCommand.cs:31`. Worth noting: the `AccessibilityInfo` field is a first-class part of the room contract, which is the data-layer half of the [Rubric §21, Accessibility] story (the UI can surface per-room accessibility notes because the command and aggregate carry them).
- **Walkthrough** eight positional parameters (`:21-28`). `RoomId` is nullable because room ids are app-assigned in a reserved range; when omitted, [`AddRoomHandler`](#addroomhandler) allocates the next id itself (see that section).
- **Where it's used** handled by [`AddRoomHandler`](#addroomhandler); validated by [`AddRoomCommandValidator`](#addroomcommandvalidator), which composes reusable room field rules.

### EventCreateRequest

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Create/EventCreateRequest.cs:10` · Level 6 · record

- **What it is** the create-side request DTO for a brand-new conference event. Unlike the positional `Add*` commands, it is a `record class` with named `init` properties: a `required` `Name`, `StartDate`, `EndDate`, and `TimeZone`, plus optional `Description`, `SessionizeCode`, `VenueAddress`, `VenueMapUrl`, and `WiFiInfo`, and an auto-assignable `Id` (`EventCreateRequest.cs:10-45`).
- **Depends on** `EventIdentifierType`; [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) and [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); and [`Event`](group-17-conference-domain.md#event) for the cache prefix. The BCL `DateOnly` types the start/end dates.
- **Concept introduced** the create-request pattern. Where `Add*`/`Publish` are commands routed directly to a handler, a create flows through a generic request-mapper pipeline: implementing [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) (`EventCreateRequest.cs:10`) lets the shared mapper machinery turn the request into a domain entity via an [`IEntityRequestMapper`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype). It also implements [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) with the same `Event` prefix (`:13`), so a create evicts the event read cache exactly like the add/publish commands. The `required`/`init` combination (`:19`, `:25`, `:28`, `:31`) is the immutability idiom taught in the [primer](00-primer.md#2-architectural-styles-this-codebase-commits-to): callers must supply the mandatory fields, and no field can mutate after construction. [Rubric §9, API and Contract Design] assesses whether request contracts are explicit and validated at the boundary: this record is the typed public shape a client POSTs, distinct from the internal [`Event`](group-17-conference-domain.md#event) aggregate.
- **Walkthrough** `CachePrefix` (`:13`) is the only computed member. `Id` (`:16`) is a plain `init` with no `required`, so it defaults and the database or factory fills it. Note the `VenueMapUrl` `SuppressMessage` (`:40`): the analyzer wants a `Uri`, but the field is stored as the raw string Sessionize returns, and the suppression documents that decision inline.
- **Why it's built this way** separating the wire contract from the domain entity keeps the aggregate free of serialization and optional-field concerns; the mapper is the single translation point (ADR-001 for manual DTO mapping).
- **Where it's used** validated by [`EventCreateRequestValidator`](#eventcreaterequestvalidator), translated by [`EventCreateRequestMapper`](#eventcreaterequestmapper), and handled by [`CreateEventHandler`](#createeventhandler).

### PublishEventCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Publish` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Publish/PublishEventCommand.cs:11` · Level 6 · record

- **What it is** a minimal state-transition command: publish the event with the given `Id`, making it visible to attendees. A `sealed record` with a single `Id` field (`PublishEventCommand.cs:11`).
- **Depends on** `EventIdentifierType`; [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); [`Event`](group-17-conference-domain.md#event).
- **Concept introduced** none new; it is the smallest instance of the cache-invalidating command shape ([`AddEventQuestionAnswerCommand`](#addeventquestionanswercommand)), with `CachePrefix` at `PublishEventCommand.cs:14`. It is a pure state-transition intent: no payload beyond the target id, because the new state and its invariants live inside the [`Event`](group-17-conference-domain.md#event) aggregate. [Rubric §4, Domain-Driven Design] assesses whether state changes are expressed as intent against an aggregate rather than as raw field writes: publishing is a named domain operation, not a `Status = 1` update.
- **Where it's used** handled by [`PublishEventHandler`](#publisheventhandler), which delegates to `Event.Publish()`.

### AddEventQuestionAnswerCommandValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/AddEventQuestionAnswer/AddEventQuestionAnswerCommandValidator.cs:8` · Level 7 · class

- **What it is** the FluentValidation validator that screens an [`AddEventQuestionAnswerCommand`](#addeventquestionanswercommand) before it reaches the handler. It enforces one rule: `AnswerValue` must not be empty (`AddEventQuestionAnswerCommandValidator.cs:10-14`).
- **Depends on** FluentValidation's `AbstractValidator<T>` (NuGet) and the command it validates.
- **Concept introduced** input validation as a pipeline stage. Validators are auto-registered by Scrutor assembly scanning and invoked by the `ValidatingCommandDecorator` before the transaction opens (see the [CQRS pipeline](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) and ADR-014), so a malformed command is rejected with a 400 without ever loading an aggregate. The rule attaches both a human message and a stable `WithErrorCode("EventQuestionAnswer.AnswerValue.Required")` (`:14`), so clients can branch on a code rather than parse prose. [Rubric §24, Forms/Validation/UX Safety] assesses whether inputs are validated with actionable, stable errors at the boundary: the error code is the machine-readable contract that lets the UI show the right field message.
- **Walkthrough** a single expression-bodied constructor (`:10`) registers the `AnswerValue` rule. Deeper business rules (question must target `Event`, answer must match the question type) are enforced later in the handler, not here, because they need database lookups.
- **Where it's used** consumed by the validating decorator ahead of [`AddEventQuestionAnswerHandler`](#addeventquestionanswerhandler).

### AddEventSpeakerCommandValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/AddEventSpeaker/AddEventSpeakerCommandValidator.cs:8` · Level 7 · class

- **What it is** the validator for [`AddEventSpeakerCommand`](#addeventspeakercommand). It enforces that `SpeakerId` is not the default value (`AddEventSpeakerCommandValidator.cs:10-13`).
- **Depends on** `AbstractValidator<T>` (FluentValidation); the command; the `SpeakerIdentifierType` alias.
- **Concept introduced** none new; same boundary-validation role as [`AddEventQuestionAnswerCommandValidator`](#addeventquestionanswercommandvalidator). The one rule uses `NotEqual(default(SpeakerIdentifierType))` (`:12`) rather than `NotEmpty`, which is the correct guard for a value-type id whose zero/empty value is meaningless. [Rubric §24, Forms/Validation/UX Safety] applies.
- **Where it's used** ahead of [`AddEventSpeakerHandler`](#addeventspeakerhandler).

### AddRoomCommandValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.AddRoom` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/AddRoom/AddRoomCommandValidator.cs:7` · Level 7 · class

- **What it is** the validator for [`AddRoomCommand`](#addroomcommand). Rather than inlining rules, it composes six reusable rule sets, one per room field (`AddRoomCommandValidator.cs:11-16`).
- **Depends on** `AbstractValidator<T>` (FluentValidation) and the shared rule types `RoomNameRules<T>`, `RoomSortRules<T>`, `RoomCapacityRules<T>`, `RoomFloorRules<T>`, `RoomLocationRules<T>`, and `RoomAccessibilityInfoRules<T>` (all in this group, for example [`RoomNameRules<T>`](#roomnamerulest) and [`RoomSortRules<T>`](#roomsortrulest)).
- **Concept introduced** rule composition via `Include`. Each `Include(new RoomNameRules<AddRoomCommand>(p => p.Name))` (`:11`) folds a generic, property-selector-parameterized rule set into this validator. The same `RoomNameRules<T>` is reused by the room update validator, so the room field constraints have one source of truth and cannot drift between create and update. [Rubric §1, SOLID] assesses single-responsibility and reuse: each rule set is one small, testable unit; the validator only wires them to properties. [Rubric §16, Maintainability] assesses whether shared logic is factored rather than duplicated: the composition means a length change in `RoomNameRules` propagates everywhere at once.
- **Walkthrough** the constructor (`:9-17`) is six `Include` calls, one per grouped rule set, each passing a lambda that points the generic rule at the matching command property.
- **Where it's used** ahead of [`AddRoomHandler`](#addroomhandler).

### EventCreateRequestMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Create/EventCreateRequestMapper.cs:11` · Level 7 · class

- **What it is** the translator from an [`EventCreateRequest`](#eventcreaterequest) into an [`Event`](group-17-conference-domain.md#event) domain entity. It implements [`IEntityRequestMapper<Event, EventCreateRequest, EventIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) (`EventCreateRequestMapper.cs:11-12`).
- **Depends on** the [`IEntityRequestMapper`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) contract, [`Event`](group-17-conference-domain.md#event) and its `Create` factory, and [`Result<T>`](group-01-result-error-handling.md#result).
- **Concept introduced** the request-mapper as the one place a request DTO becomes a validated aggregate. `CreateEntityAsync` (`:15`) guards against a null request (`:17`) and then calls the [`Event.Create`](group-17-conference-domain.md#event) factory with each request field in order (`:19-29`), returning the factory's `Task<Result<Event>>` unchanged. Because the factory returns [`Result<Event>`](group-01-result-error-handling.md#result), every domain invariant (date range, time-zone validity, name length) is enforced inside the aggregate, and this mapper never constructs an invalid `Event`. [Rubric §4, Domain-Driven Design] assesses whether entity construction is funneled through invariant-guarding factories: the mapper delegates rather than newing up an `Event`. [Rubric §3, Clean Architecture] assesses direction of dependency: the application-layer mapper depends inward on the domain factory, never the reverse.
- **Walkthrough** the class is a single method that wraps a synchronous factory call in `Task.FromResult` (`:19`), since `Event.Create` does no I/O. Mapping is manual and positional (ADR-001), so a field reorder in the factory is a compile break here, not a silent misalignment.
- **Where it's used** injected into [`CreateEventHandler`](#createeventhandler) as the `IEntityRequestMapper` dependency.

### EventCreateRequestValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Create/EventCreateRequestValidator.cs:7` · Level 7 · class

- **What it is** the validator for [`EventCreateRequest`](#eventcreaterequest), composed from three reusable event rule sets (`EventCreateRequestValidator.cs:11-13`).
- **Depends on** `AbstractValidator<T>` (FluentValidation) and the shared rule types [`EventNameRules<T>`](#eventnamerulest), [`EventTimeZoneRules<T>`](#eventtimezonerulest), and [`EventDateRangeRules<T>`](#eventdaterangerulest).
- **Concept introduced** none new; it is the composition idiom from [`AddRoomCommandValidator`](#addroomcommandvalidator) applied to the create request. `EventDateRangeRules` (`:13`) is passed two selectors, `StartDate` and `EndDate`, so a cross-field rule (end not before start) is itself reusable and testable in isolation. [Rubric §24, Forms/Validation/UX Safety] and [Rubric §16, Maintainability] apply for the same single-source-of-truth reason as the room validator.
- **Walkthrough** the constructor (`:9-14`) is three `Include` calls binding the generic rule sets to the request's `Name`, `TimeZone`, and date pair.
- **Where it's used** invoked by the validating decorator ahead of [`CreateEventHandler`](#createeventhandler).

### AddEventQuestionAnswerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/AddEventQuestionAnswer/AddEventQuestionAnswerHandler.cs:17` · Level 8 · class

- **What it is** the command handler that records a question answer against an event. It is the most business-rule-dense handler in the unit, implementing several conference business rules (BR-108, BR-128, BR-124, BR-107) around a load-validate-mutate-save flow (`AddEventQuestionAnswerHandler.cs:17-56`).
- **Depends on** [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (repositories + save), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) (the acting user), the `EventQuestionAnswerDTOMapper`, an `ILogger`, and the [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) contract; the domain [`Event`](group-17-conference-domain.md#event), [`Question`](group-17-conference-domain.md#question), [`EventInvariants`](group-17-conference-domain.md#eventinvariants), and `QuestionInvariants`; and [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept introduced** the full anatomy of a command handler, and the point where business rules that need I/O live. `HandleAsync` (`:24`) loads the [`Event`](group-17-conference-domain.md#event) aggregate through [`IUnitOfWork.GetRepository`](group-07-persistence-ef-core.md#iunitofwork), eagerly including `EventQuestionAnswers` and requesting change tracking (`:28-33`) because it intends to mutate. A missing event short-circuits to an [`Error.NotFound`](group-01-result-error-handling.md#error) (`:35`). It then layers rule checks that a boundary validator could not do because they require data: BR-108 asserts the event is published via [`EventInvariants.EnsureEventIsPublished`](group-17-conference-domain.md#eventinvariants) (`:38`); BR-128 and BR-124 run in `ValidateQuestionAsync` (`:58`), which loads the [`Question`](group-17-conference-domain.md#question), rejects it if it does not target `"Event"` (`:65`), and delegates the answer-shape check to `QuestionInvariants.EnsureAnswerValueMatchesQuestionType` (`:75`). BR-107 is an upsert: it looks for an existing non-deleted answer keyed by `(QuestionId, CreatedBy)` for the current user (`:48-50`) and routes to update or create accordingly. [Rubric §6, CQRS & Event-Driven] assesses the single-handler-per-command shape. [Rubric §4, Domain-Driven Design] assesses whether invariants live in the domain: the handler orchestrates but delegates each rule to an invariants helper or an aggregate method. [Rubric §11, Security] assesses whether the acting identity is authoritative: the upsert key uses `currentUserService.UserId` (`:48`), not a client-supplied owner, so a user can only overwrite their own answer.
- **Walkthrough** after the guards, `UpdateExistingAnswerAsync` (`:79`) calls `entity.UpdateEventQuestionAnswer` and saves; `CreateNewAnswerAsync` (`:94`) calls `entity.AddEventQuestionAnswer` and saves. Both persist through [`unitOfWork.SaveChangesAsync`](group-07-persistence-ef-core.md#iunitofwork) (`:89`, `:106`), which is where audit stamping, domain-event dispatch, and the outbox all fire, then map the child to a DTO. Logging uses a source-generated `LoggerMessage` partial (`:111-112`), which is allocation-free and the reason the class is `partial`.
- **Why it's built this way** rules that need the database (published state, question targeting, answer typing, ownership) cannot run in the stateless [validator](#addeventquestionanswercommandvalidator), so they sit in the handler as explicit [`Result`](group-01-result-error-handling.md#result) checks that fail fast before any mutation. [Rubric §13, Observability] is served by the structured `LoggerMessage`.
- **Where it's used** dispatched from the Conference questions/answers REST controller through the decorator pipeline.

### AddEventSpeakerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/AddEventSpeaker/AddEventSpeakerHandler.cs:15` · Level 8 · class

- **What it is** the handler that attaches a speaker to an event. It is the canonical thin load-delegate-save handler (`AddEventSpeakerHandler.cs:15-41`).
- **Depends on** [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), the `EventSpeakerDTOMapper`, an `ILogger`, [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); the [`Event`](group-17-conference-domain.md#event) aggregate and its `AddEventSpeaker` method; [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept introduced** none new; this is the minimal form of the pattern [`AddEventQuestionAnswerHandler`](#addeventquestionanswerhandler) shows in full. `HandleAsync` (`:21`) loads the [`Event`](group-17-conference-domain.md#event) by id (`:26`), returns [`Error.NotFound`](group-01-result-error-handling.md#error) if absent (`:28`), delegates to `entity.AddEventSpeaker` (`:30`), and only saves and maps on success (`:33-40`). All the association invariants live inside the aggregate method, so the handler stays a thin orchestrator. [Rubric §5, Vertical Slice] assesses whether a feature is a self-contained slice: command, validator, and handler sit in one folder and read top to bottom.
- **Walkthrough** note the aggregate method returns a [`Result`](group-01-result-error-handling.md#result); the handler checks `IsFailure` (`:33`) before persisting, so a rejected association never reaches the database. `SaveChangesAsync` (`:36`) triggers the shared persistence machinery; a `LoggerMessage` partial records the add (`:43-44`).
- **Where it's used** dispatched from the Conference event-speakers REST controller.

### AddRoomHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.AddRoom` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/AddRoom/AddRoomHandler.cs:15` · Level 8 · class

- **What it is** the handler that adds a room to an event. It follows the load-delegate-save shape but adds one piece of real logic the others lack: server-side id allocation in a reserved range (`AddRoomHandler.cs:15-69`).
- **Depends on** [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (both `GetRepository` and `GetReadRepository`), the `RoomDTOMapper`, an `ILogger`, [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); the [`Event`](group-17-conference-domain.md#event) and [`Room`](group-17-conference-domain.md#room) entities plus [`EventInvariants`](group-17-conference-domain.md#eventinvariants) for the id-range constants; [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept introduced** app-assigned identity coexisting with an external system's ids. Room primary keys are the Sessionize ids, so an organizer-created room must not collide with a future import. When the caller supplies no `RoomId` (`:33-34`), the handler queries a read repository for existing rooms whose id falls in the manual reserved range `[EventInvariants.RoomManualIdRangeStart, EventInvariants.RoomManualIdRangeEnd]`, `ignoreQueryFilters: true` so soft-deleted rooms still count (`:36-41`), takes `Max + 1` (or the range start when empty) (`:43-45`), and fails with an [`Error.Failure`](group-01-result-error-handling.md#error) if the range is exhausted (`:47-48`). An explicit id is respected unchanged. [Rubric §8, Data Architecture] assesses identity and key strategy: this handler documents and enforces a two-zone id space so app-created and imported rooms never clash. [Rubric §7, Microservices Readiness] is touched because the allocation reads globally across events within the Conference database, a decision that stays valid only because rooms live in one owning service.
- **Walkthrough** after allocation, the flow rejoins the standard shape: delegate to `entity.AddRoom` with all eight fields (`:53-60`), check `IsFailure` (`:61`), [`SaveChangesAsync`](group-07-persistence-ef-core.md#iunitofwork) (`:64`), log via the `LoggerMessage` partial (`:71-72`), and return the mapped [`RoomDTO`](group-17-conference-domain.md#roomdto).
- **Caveats** the id allocation reads-then-writes without an explicit lock; concurrent organizer creates could in principle contend for the same next id. Not determinable from source: whether a database unique constraint or retry makes that safe in practice is defined in the EF configuration and outside this file.
- **Where it's used** dispatched from the Conference rooms REST controller.

### CreateEventHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Create/CreateEventHandler.cs:16` · Level 8 · class

- **What it is** the handler that creates a new event from an [`EventCreateRequest`](#eventcreaterequest). Unlike the add/publish handlers it does not load an existing aggregate; it constructs a fresh one through the request mapper (`CreateEventHandler.cs:16-40`).
- **Depends on** [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); the [`IEntityRequestMapper<Event, EventCreateRequest, EventIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) (satisfied by [`EventCreateRequestMapper`](#eventcreaterequestmapper)); the `EventDTOMapper`; an `ILogger`; [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); and [`Result`](group-01-result-error-handling.md#result).
- **Concept introduced** the create flow: map, then add, then save. `HandleAsync` (`:23`) calls `requestMapper.CreateEntityAsync` (`:27`), which returns a [`Result<Event>`](group-01-result-error-handling.md#result); on failure it propagates the errors (`:28-29`) without touching the database. On success it takes the validated entity (`:31`), adds it through the [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) repository (`:34`), and [`SaveChangesAsync`](group-07-persistence-ef-core.md#iunitofwork) (`:35`), which stamps audit fields and dispatches any creation domain events via the outbox. It then logs and returns the mapped [`EventDTO`](group-17-conference-domain.md#eventdto). [Rubric §3, Clean Architecture] assesses layering: the handler depends on the mapper only through the [`IEntityRequestMapper`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) abstraction, so the concrete mapper is a swappable, testable dependency. [Rubric §6, CQRS & Event-Driven] applies: `EventCreateRequest` doubles as the command type this handler is registered against.
- **Walkthrough** the class is short because the invariant enforcement lives in [`Event.Create`](group-17-conference-domain.md#event) reached through the mapper; the handler only orchestrates persistence and DTO projection. The `LoggerMessage` partial (`:42-43`) records the created id and name.
- **Where it's used** dispatched from the Conference events REST controller create endpoint.

### PublishEventHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Publish` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Publish/PublishEventHandler.cs:13` · Level 8 · class

- **What it is** the handler for [`PublishEventCommand`](#publisheventcommand): load the event, ask it to publish, save if it agreed. Its return type is a bare [`Result`](group-01-result-error-handling.md#result) (no DTO), because publishing is a state transition with no payload to return (`PublishEventHandler.cs:13-35`).
- **Depends on** [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), an `ILogger`, [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); the [`Event`](group-17-conference-domain.md#event) aggregate and its `Publish` method; [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept introduced** none new; it is the thinnest state-transition handler. `HandleAsync` (`:18`) loads the event by id (`:23`), returns [`Error.NotFound`](group-01-result-error-handling.md#error) if absent (`:25`), calls `entity.Publish()` (`:27`), and only when that result `IsSuccess` does it save and log (`:28-32`). Crucially it returns the domain method's [`Result`](group-01-result-error-handling.md#result) directly (`:34`), so if the aggregate rejects the transition (for example already published), that failure flows straight back to the caller and nothing persists. [Rubric §4, Domain-Driven Design] assesses whether the aggregate owns its lifecycle: the publish rules live in `Event.Publish()`, and the handler merely gates persistence on the aggregate's verdict.
- **Walkthrough** the save is inside the `IsSuccess` branch (`:28-31`), not unconditional, which is the small but important difference from a create/add handler: a no-op or rejected publish must not open a transaction. The `LoggerMessage` partial (`:37-38`) records the published id.
- **Where it's used** dispatched from the Conference events REST controller publish endpoint.

### QuestionDTOMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Questions.DTOs` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/DTOs/QuestionDTOMapper.cs:12` · Level 6 · class

- **What it is** the read-side translator that turns a [`Question`](group-17-conference-domain.md#question) domain entity into the flat [`QuestionDTO`](group-17-conference-domain.md#questiondto) that leaves the service over the wire. It is a `sealed partial` class implementing [`IEntityDTOMapper<Question, QuestionDTO, QuestionIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) (`QuestionDTOMapper.cs:12-13`).
- **Depends on** the [`IEntityDTOMapper`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) contract, the [`Question`](group-17-conference-domain.md#question) entity and [`QuestionDTO`](group-17-conference-domain.md#questiondto), the `QuestionIdentifierType` alias (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)), and the `Riok.Mapperly.Abstractions` source generator (NuGet).
- **Concept introduced** compile-time mapping via Mapperly. The class carries a `[Mapper]` attribute (`:11`) and declares `public partial QuestionDTO MapToDTO(Question entity)` (`:16`) with no body; Mapperly's source generator writes the property-by-property copy at build time into the other half of the `partial` class. This is the generated variant of the manual DTO-mapping decision (ADR-001): there is still no reflection at runtime and the mapping is explicit and inspectable, but the boilerplate is machine-written rather than hand-typed. Because the generated method is checked at compile time, a property added to [`Question`](group-17-conference-domain.md#question) but missing from [`QuestionDTO`](group-17-conference-domain.md#questiondto) (or vice versa) surfaces as a build diagnostic rather than a silent data loss. [Rubric §9, API and Contract Design] assesses whether the outward contract is a deliberate shape distinct from the internal model: the DTO is the public projection, and this mapper is the single translation point. [Rubric §15, Best Practices and Code Quality] applies because the generator removes error-prone hand-mapping while keeping the mapping visible.
- **Walkthrough** two members. `MapToDTO` (`:16`) is the generator-backed single-entity map. `MapToDTOs` (`:19-23`) is hand-written: it null-guards the incoming collection with `ArgumentNullException.ThrowIfNull` (`:21`) and projects each element through `MapToDTO` into a new list via a collection expression (`:22`), so the batch path reuses the generated per-item logic.
- **Why it's built this way** a Mapperly mapper keeps mapping declarative and analyzer-clean while satisfying the no-runtime-reflection rule the codebase holds for hot read paths (ADR-001).
- **Where it's used** injected into the Conference question read handlers and the [`IEntityQueryService`](group-07-persistence-ef-core.md#iunitofwork) projection path that serves the questions REST endpoints.

### RemoveEventQuestionAnswerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventQuestionAnswer` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RemoveEventQuestionAnswer/RemoveEventQuestionAnswerCommand.cs:13` · Level 6 · record

- **What it is** the write-side message asking the system to remove one answer from a conference `Event`'s question set. A `sealed record` with two positional fields: the owning `EventId` and the `EventQuestionAnswerId` to remove (`RemoveEventQuestionAnswerCommand.cs:13-15`).
- **Depends on** the `EventIdentifierType` and `EventQuestionAnswerIdentifierType` aliases; the framework marker [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); and the [`Event`](group-17-conference-domain.md#event) aggregate, referenced only to compute the cache prefix.
- **Concept introduced** none new. This is the cache-invalidating command shape taught by [`AddEventQuestionAnswerCommand`](#addeventquestionanswercommand): an immutable request record that also implements [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) and exposes `CachePrefix => $"{typeof(Event).FullName}:"` (`:18`), so a successful remove tells the caching decorator to evict every cached read keyed under the `Event` type. [Rubric §6, CQRS and Event-Driven] applies because the mutation is a named, single-purpose message; [Rubric §10, Cross-Cutting] applies because the eviction concern is a one-line declaration handed to the pipeline.
- **Walkthrough** two positional parameters (`:14-15`) are the whole payload; `CachePrefix` (`:18`) is the only member with logic and is a pure expression.
- **Where it's used** handled by [`RemoveEventQuestionAnswerHandler`](#removeeventquestionanswerhandler); dispatched from the Conference questions/answers REST controller through the decorator pipeline.

### RemoveEventSpeakerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventSpeaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RemoveEventSpeaker/RemoveEventSpeakerCommand.cs:12` · Level 6 · record

- **What it is** the request to detach a speaker association from an event. A `sealed record` with two fields: the `EventId` and the `EventSpeakerId` of the association to remove (`RemoveEventSpeakerCommand.cs:12-14`).
- **Depends on** the `EventIdentifierType` and `EventSpeakerIdentifierType` aliases; [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); and [`Event`](group-17-conference-domain.md#event) for the cache prefix.
- **Concept introduced** none new; the same cache-invalidating command shape as [`RemoveEventQuestionAnswerCommand`](#removeeventquestionanswercommand), with `CachePrefix => $"{typeof(Event).FullName}:"` (`:17`). [Rubric §6, CQRS and Event-Driven] applies for the same reason.
- **Walkthrough** two positional parameters (`:13-14`); `CachePrefix` (`:17`) is the only computed member.
- **Where it's used** handled by [`RemoveEventSpeakerHandler`](#removeeventspeakerhandler).

### RemoveRoomCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RemoveRoom` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RemoveRoom/RemoveRoomCommand.cs:12` · Level 6 · record

- **What it is** the request to remove a room from an event. A `sealed record` with two fields: the owning `EventId` and the `RoomId` to remove (`RemoveRoomCommand.cs:12-14`).
- **Depends on** the `EventIdentifierType` and `RoomIdentifierType` aliases; [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); and [`Event`](group-17-conference-domain.md#event).
- **Concept introduced** none new; identical in shape to [`RemoveEventSpeakerCommand`](#removeeventspeakercommand), with `CachePrefix => $"{typeof(Event).FullName}:"` (`:17`). [Rubric §6, CQRS and Event-Driven] applies.
- **Walkthrough** two positional parameters (`:13-14`); `CachePrefix` (`:17`) is the only computed member.
- **Where it's used** handled by [`RemoveRoomHandler`](#removeroomhandler).

### UnpublishEventCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Unpublish` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Unpublish/UnpublishEventCommand.cs:11` · Level 6 · record

- **What it is** the state-transition command that hides an event from attendees again, the inverse of publish. A `sealed record` carrying a single `Id` field (`UnpublishEventCommand.cs:11`).
- **Depends on** the `EventIdentifierType` alias; [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); and [`Event`](group-17-conference-domain.md#event).
- **Concept introduced** none new; it is the smallest cache-invalidating command, the mirror of [`PublishEventCommand`](#publisheventcommand). It carries no payload beyond the target id because the new state and its guard rules live inside the [`Event`](group-17-conference-domain.md#event) aggregate; `CachePrefix => $"{typeof(Event).FullName}:"` (`:14`) evicts the event read cache on success. [Rubric §4, Domain-Driven Design] assesses whether a lifecycle change is expressed as intent against an aggregate rather than a raw status write: unpublishing is a named domain operation, not a `Status = 0` update.
- **Where it's used** handled by [`UnpublishEventHandler`](#unpublisheventhandler), which delegates to `Event.Unpublish()`.

### UpdateEventQuestionAnswerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.UpdateEventQuestionAnswer` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/UpdateEventQuestionAnswer/UpdateEventQuestionAnswerCommand.cs:14` · Level 6 · record

- **What it is** the request to change the text of an existing answer within an event's question set. A `sealed record` with three fields: the `EventId`, the `EventQuestionAnswerId` to update, and the new `AnswerValue` string (`UpdateEventQuestionAnswerCommand.cs:14-17`).
- **Depends on** the `EventIdentifierType` and `EventQuestionAnswerIdentifierType` aliases; [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); and [`Event`](group-17-conference-domain.md#event).
- **Concept introduced** none new; the cache-invalidating command shape from [`RemoveEventQuestionAnswerCommand`](#removeeventquestionanswercommand), differing only in the extra `AnswerValue` payload it carries into the handler. `CachePrefix => $"{typeof(Event).FullName}:"` (`:20`). [Rubric §6, CQRS and Event-Driven] applies.
- **Walkthrough** three positional parameters (`:15-17`); `CachePrefix` (`:20`) is the only computed member. Note this command has no dedicated validator in the unit, so the ownership and value rules are enforced inside [`UpdateEventQuestionAnswerHandler`](#updateeventquestionanswerhandler) where the aggregate is loaded.
- **Where it's used** handled by [`UpdateEventQuestionAnswerHandler`](#updateeventquestionanswerhandler).

### UpdateRoomCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/UpdateRoom/UpdateRoomCommand.cs:18` · Level 6 · record

- **What it is** the request to change an existing room's details within an event. It mirrors [`AddRoomCommand`](#addroomcommand) field-for-field: `EventId`, the target `RoomId`, a required `Name` and `Sort`, and four optional descriptive fields `Capacity`, `Floor`, `Location`, and `AccessibilityInfo` (`UpdateRoomCommand.cs:18-26`).
- **Depends on** the `EventIdentifierType` and `RoomIdentifierType` aliases; [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); and [`Event`](group-17-conference-domain.md#event).
- **Concept introduced** none new; the cache-invalidating command shape ([`RemoveEventQuestionAnswerCommand`](#removeeventquestionanswercommand)), here with the full room field payload. `CachePrefix => $"{typeof(Event).FullName}:"` (`:29`). Because it carries the same `AccessibilityInfo` field as the add command, the update path preserves the [Rubric §21, Accessibility] data contract: per-room accessibility notes survive edits, not just creation.
- **Walkthrough** eight positional parameters (`:19-26`); `CachePrefix` (`:29`) is the only computed member. Unlike the answer update, this command has a dedicated validator, [`UpdateRoomCommandValidator`](#updateroomcommandvalidator), because its field constraints are static and do not need the database.
- **Where it's used** validated by [`UpdateRoomCommandValidator`](#updateroomcommandvalidator) and handled by [`UpdateRoomHandler`](#updateroomhandler).

### UpdateRoomCommandValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/UpdateRoom/UpdateRoomCommandValidator.cs:7` · Level 7 · class

- **What it is** the FluentValidation validator that screens an [`UpdateRoomCommand`](#updateroomcommand) before it reaches the handler. Rather than inlining rules, it composes six reusable rule sets, one per room field (`UpdateRoomCommandValidator.cs:11-16`).
- **Depends on** FluentValidation's `AbstractValidator<T>` (NuGet) and the shared rule types [`RoomNameRules<T>`](#roomnamerulest), [`RoomSortRules<T>`](#roomsortrulest), [`RoomCapacityRules<T>`](#roomcapacityrulest), [`RoomFloorRules<T>`](#roomfloorrulest), [`RoomLocationRules<T>`](#roomlocationrulest), and [`RoomAccessibilityInfoRules<T>`](#roomaccessibilityinforulest).
- **Concept introduced** none new; it is the `Include`-based rule composition first shown by [`AddRoomCommandValidator`](#addroomcommandvalidator). Each `Include(new RoomNameRules<UpdateRoomCommand>(p => p.Name))` (`:11`) folds a generic, selector-parameterized rule set into this validator and points it at the matching command property. The load-bearing payoff is single-source-of-truth: this validator reuses the exact same rule sets as the add validator, so the room field constraints cannot drift between create and update. [Rubric §1, SOLID] assesses reuse and single responsibility: each rule set is one small testable unit, and the validator only wires them. [Rubric §16, Maintainability] applies because a length or bound change in `RoomNameRules` propagates to both create and update at once.
- **Walkthrough** the constructor (`:9-17`) is six `Include` calls, one per grouped rule set, each passing a lambda selecting the corresponding property (`Name`, `Sort`, `Capacity`, `Floor`, `Location`, `AccessibilityInfo`).
- **Where it's used** invoked by the `ValidatingCommandDecorator` (see the [CQRS pipeline](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) and ADR-014) ahead of [`UpdateRoomHandler`](#updateroomhandler).

### RemoveEventQuestionAnswerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventQuestionAnswer` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RemoveEventQuestionAnswer/RemoveEventQuestionAnswerHandler.cs:14` · Level 8 · class

- **What it is** the command handler that removes an answer from an event, enforcing an ownership rule: an Attendee may delete only their own answers, an Organizer may delete any (BR-52/BR-53). It follows a load-authorize-delegate-save flow (`RemoveEventQuestionAnswerHandler.cs:14-56`).
- **Depends on** [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (repository + save), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) (the acting user), an `ILogger`, and the [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) contract; the [`Event`](group-17-conference-domain.md#event) aggregate and its [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer) children; [`RoleNames`](group-08-auth.md#rolenames); and [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept introduced** authorization that needs data, and therefore lives in the handler rather than the stateless validator. `HandleAsync` (`:20`) loads the [`Event`](group-17-conference-domain.md#event) through [`IUnitOfWork.GetRepository`](group-07-persistence-ef-core.md#iunitofwork), eagerly including `EventQuestionAnswers` and requesting change tracking because it intends to mutate (`:24-29`); a missing event short-circuits to [`Error.NotFound`](group-01-result-error-handling.md#error) (`:31`). It then finds the target answer by id among the non-deleted children (`:34`) and applies BR-52/BR-53: if the caller is not in the [`Organizer`](group-08-auth.md#rolenames) role and the answer's `CreatedBy` differs from the current user's id, it returns [`Error.Forbidden`](group-01-result-error-handling.md#error) with a stable code `"EventQuestionAnswer.NotOwner"` (`:35-42`). [Rubric §11, Security] assesses whether the acting identity, not a client-supplied owner, drives the decision: the check compares `answer.CreatedBy` against `currentUserService.UserId` (`:35`), so a user cannot delete another user's answer. [Rubric §4, Domain-Driven Design] applies because the actual removal is delegated to the aggregate.
- **Walkthrough** after the ownership gate, the handler calls `entity.RemoveEventQuestionAnswer(command.EventQuestionAnswerId)` (`:44`), which returns a [`Result`](group-01-result-error-handling.md#result). Only when that `IsSuccess` does it persist through [`unitOfWork.SaveChangesAsync`](group-07-persistence-ef-core.md#iunitofwork) (`:47`), the point where soft-delete, audit stamping, domain-event dispatch, and the outbox all fire, then log via a source-generated `LoggerMessage` partial (`:54-55`). The handler returns the domain method's `Result` directly (`:51`), so an aggregate-level rejection flows back untouched.
- **Why it's built this way** the ownership rule cannot run in a boundary [validator](#updateroomcommandvalidator) because it needs the persisted `CreatedBy` value, so it sits in the handler as an explicit `Result` check that fails before any mutation. [Rubric §13, Observability] is served by the structured log.
- **Where it's used** dispatched from the Conference questions/answers REST controller through the decorator pipeline.

### RemoveEventSpeakerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventSpeaker` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RemoveEventSpeaker/RemoveEventSpeakerHandler.cs:13` · Level 8 · class

- **What it is** the handler that detaches a speaker association from an event. It is the canonical thin load-delegate-save handler (`RemoveEventSpeakerHandler.cs:13-43`).
- **Depends on** [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), an `ILogger`, [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); the [`Event`](group-17-conference-domain.md#event) aggregate and its `RemoveEventSpeaker` method; [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept introduced** none new; the minimal form of the pattern. `HandleAsync` (`:18`) loads the [`Event`](group-17-conference-domain.md#event) with its `EventSpeakers` eagerly included and tracked (`:23-27`), returns [`Error.NotFound`](group-01-result-error-handling.md#error) if absent (`:29`), delegates to `entity.RemoveEventSpeaker(command.EventSpeakerId)` (`:31`), and only saves and logs when the result `IsSuccess` (`:32-36`). All association-removal invariants live inside the aggregate method, so the handler stays a thin orchestrator. [Rubric §5, Vertical Slice] assesses whether a feature is a self-contained slice: command, handler, and folder read top to bottom.
- **Walkthrough** the save is inside the `IsSuccess` branch (`:32-36`), so a rejected removal never opens a transaction; the `LoggerMessage` partial (`:41-42`) records the removed association and event.
- **Where it's used** dispatched from the Conference event-speakers REST controller.

### RemoveRoomHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.RemoveRoom` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/RemoveRoom/RemoveRoomHandler.cs:13` · Level 8 · class

- **What it is** the handler that removes a room from an event. Structurally identical to [`RemoveEventSpeakerHandler`](#removeeventspeakerhandler), differing only in which child collection it loads and which aggregate method it calls (`RemoveRoomHandler.cs:13-43`).
- **Depends on** [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), an `ILogger`, [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); the [`Event`](group-17-conference-domain.md#event) aggregate and its `RemoveRoom` method; [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept introduced** none new; the thin load-delegate-save shape. `HandleAsync` (`:18`) loads the [`Event`](group-17-conference-domain.md#event) with `Rooms` included and tracked (`:23-27`), returns [`Error.NotFound`](group-01-result-error-handling.md#error) if absent (`:29`), delegates to `entity.RemoveRoom(command.RoomId)` (`:31`), and saves and logs only on success (`:32-36`). [Rubric §4, Domain-Driven Design] applies: the room-removal rules live in the aggregate method, and the handler only gates persistence on its verdict.
- **Walkthrough** the `LoggerMessage` partial (`:41-42`) records the removed room and event; the conditional save (`:32-36`) keeps a rejected removal out of a transaction.
- **Where it's used** dispatched from the Conference rooms REST controller.

### UnpublishEventHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Unpublish` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Unpublish/UnpublishEventHandler.cs:13` · Level 8 · class

- **What it is** the handler for [`UnpublishEventCommand`](#unpublisheventcommand): load the event, ask it to unpublish, save if it agreed. Its return type is a bare [`Result`](group-01-result-error-handling.md#result) with no DTO, because a state transition has no payload to return (`UnpublishEventHandler.cs:13-39`).
- **Depends on** [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), an `ILogger`, [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); the [`Event`](group-17-conference-domain.md#event) aggregate and its `Unpublish` method; [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept introduced** none new; it is the thinnest state-transition handler, the mirror of [`PublishEventHandler`](#publisheventhandler). `HandleAsync` (`:18`) loads the event by id with no includes (`:23`), returns [`Error.NotFound`](group-01-result-error-handling.md#error) if absent (`:25`), calls `entity.Unpublish()` (`:27`), and only when that result `IsSuccess` does it save and log (`:28-32`). It returns the domain method's [`Result`](group-01-result-error-handling.md#result) directly (`:34`), so if the aggregate rejects the transition (for example the event is not currently published), that failure flows straight back and nothing persists. [Rubric §4, Domain-Driven Design] assesses whether the aggregate owns its lifecycle: the unpublish rules live in `Event.Unpublish()`, and the handler merely gates persistence on the aggregate's verdict.
- **Walkthrough** the save is inside the `IsSuccess` branch (`:28-31`), not unconditional, the same discipline as the publish handler: a rejected or no-op unpublish must not open a transaction. The `LoggerMessage` partial (`:37-38`) records the unpublished id.
- **Where it's used** dispatched from the Conference events REST controller unpublish endpoint.

### UpdateEventQuestionAnswerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.UpdateEventQuestionAnswer` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/UpdateEventQuestionAnswer/UpdateEventQuestionAnswerHandler.cs:14` · Level 8 · class

- **What it is** the handler that edits an existing answer's value, enforcing the same ownership rule as the remove path: an Attendee may update only their own answers, an Organizer may update any (BR-52/BR-53) (`UpdateEventQuestionAnswerHandler.cs:14-58`).
- **Depends on** [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), an `ILogger`, [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); the [`Event`](group-17-conference-domain.md#event) aggregate and its [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer) children; [`RoleNames`](group-08-auth.md#rolenames); [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept introduced** none new; it is the update twin of [`RemoveEventQuestionAnswerHandler`](#removeeventquestionanswerhandler). `HandleAsync` (`:20`) loads the [`Event`](group-17-conference-domain.md#event) with `EventQuestionAnswers` included and tracked (`:25-29`), returns [`Error.NotFound`](group-01-result-error-handling.md#error) if absent (`:31`), then applies the identical BR-52/BR-53 ownership gate (`:34-42`): a non-[`Organizer`](group-08-auth.md#rolenames) whose `UserId` does not match the answer's `CreatedBy` gets [`Error.Forbidden`](group-01-result-error-handling.md#error) with code `"EventQuestionAnswer.NotOwner"`. [Rubric §11, Security] applies for the same reason as the remove handler: the acting identity, not a client claim, decides.
- **Walkthrough** on passing the gate, the handler delegates to `entity.UpdateEventQuestionAnswer(command.EventQuestionAnswerId, command.AnswerValue)` (`:44-46`), so the value-shape invariants remain inside the aggregate; it then saves through [`SaveChangesAsync`](group-07-persistence-ef-core.md#iunitofwork) (`:49`) and logs via the `LoggerMessage` partial (`:56-57`) only when the result `IsSuccess`. The `Result` from the aggregate is returned directly (`:53`).
- **Why it's built this way** the ownership check needs the persisted `CreatedBy`, so it lives here rather than in a stateless validator (which is why this command has none in the unit); the value rules stay in the aggregate.
- **Where it's used** dispatched from the Conference questions/answers REST controller.

### UpdateRoomHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/UpdateRoom/UpdateRoomHandler.cs:13` · Level 8 · class

- **What it is** the handler that applies edits to an existing room. A thin load-delegate-save handler, distinguished only by the full field list it forwards to the aggregate (`UpdateRoomHandler.cs:13-51`).
- **Depends on** [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), an `ILogger`, [`ICommandHandler`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); the [`Event`](group-17-conference-domain.md#event) aggregate and its `UpdateRoom` method; [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept introduced** none new; the load-delegate-save shape from [`RemoveRoomHandler`](#removeroomhandler), with a wider delegation call. `HandleAsync` (`:18`) loads the [`Event`](group-17-conference-domain.md#event) with `Rooms` included and tracked (`:23-27`), returns [`Error.NotFound`](group-01-result-error-handling.md#error) if absent (`:29`), and delegates all seven room fields to `entity.UpdateRoom(...)` (`:31-38`), so the room field invariants are enforced inside the aggregate rather than duplicated here. Field-format screening already happened at the boundary in [`UpdateRoomCommandValidator`](#updateroomcommandvalidator), so the handler carries no inline field checks. [Rubric §5, Vertical Slice] applies: the room-update slice is self-contained across command, validator, and handler.
- **Walkthrough** the handler saves and logs only when the aggregate result `IsSuccess` (`:39-43`); the `LoggerMessage` partial (`:48-49`) records the updated room and event, and the aggregate's [`Result`](group-01-result-error-handling.md#result) is returned directly (`:45`).
- **Where it's used** dispatched from the Conference rooms REST controller.

### AddSpeakerCategoryItemCommand
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/AddSpeakerCategoryItem/AddSpeakerCategoryItemCommand.cs:18` · Level 6 · record (sealed)

- **What it is**: the write command that associates an existing [`Speaker`](group-17-conference-domain.md#speaker) with a new [`SpeakerCategoryItem`](group-17-conference-domain.md#speakercategoryitem) join entity (e.g. a "traveling from" or topic tag). A three-field record: the parent `SpeakerId`, an optional explicit `SpeakerCategoryItemId` for the new join row, and the [`CategoryItem`](group-17-conference-domain.md#categoryitem) id being attached.
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) (the marker it implements); the `SpeakerIdentifierType`/`SpeakerCategoryItemIdentifierType`/`CategoryItemIdentifierType` aliases (see [identifier aliases](00-primer.md#2-architectural-styles-this-codebase-commits-to)); [`Speaker`](group-17-conference-domain.md#speaker) (only for its `typeof(...).FullName` in the cache prefix).
- **Concept introduced, the cache-invalidating command.** `[Rubric §10, Cross-Cutting Concerns]` (assesses whether concerns like caching live in one place instead of being smeared through handlers). A command opts into cache eviction merely by implementing [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) and exposing a `CachePrefix`; the [`CachingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#cachingcommanddecoratortcommand-tresult) in the [CQRS decorator pipeline](00-primer.md#2-architectural-styles-this-codebase-commits-to) sees the marker and clears the matching cache region after the handler succeeds, so the handler itself contains no cache code. Here `CachePrefix` is `$"{typeof(Speaker).FullName}:"` (`AddSpeakerCategoryItemCommand.cs:24`), so writing a speaker's categories evicts the cached speaker reads. `[Rubric §12, Performance & Scalability]` is the flip side: read endpoints are output-cached, and this is the write-side invalidation that keeps them coherent.
- **Walkthrough**: the positional record params (`AddSpeakerCategoryItemCommand.cs:18-21`): `SpeakerId` identifies the aggregate to mutate; `SpeakerCategoryItemId` is **nullable** so the caller can either supply an explicit join-row id or pass `null` for database-generated identity (documented at line 16); `CategoryItemId` is the category item to attach. The only member body is the computed `CachePrefix` (line 24).
- **Why it's built this way**: modeling the operation as an immutable record command (not a method argument bag) is what lets the dispatcher route it through the decorator pipeline and lets the validator/handler be discovered by name. The nullable id mirrors the domain's `Speaker.AddSpeakerCategoryItem` overload that accepts an optional id.
- **Where it's used**: handled by [`AddSpeakerCategoryItemHandler`](#addspeakercategoryitemhandler); validated by [`AddSpeakerCategoryItemCommandValidator`](#addspeakercategoryitemcommandvalidator); dispatched from the Speakers REST controller in the Conference service.

### QuestionCreateRequest
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Questions.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/UseCases/Create/QuestionCreateRequest.cs:10` · Level 6 · record (class)

- **What it is**: the inbound create payload for a conference [`Question`](group-17-conference-domain.md#question) (a custom field shown on the conference UI, e.g. a dietary-restriction prompt). It doubles as the **command** the handler receives, there is no separate command type for this slice.
- **Depends on**: [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) and [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) (both implemented); the `QuestionIdentifierType` alias; [`Question`](group-17-conference-domain.md#question) (for the cache-prefix `typeof`).
- **Concept introduced, the request-as-command, and `ICreateRequest`.** `[Rubric §5, Vertical Slice]` (assesses whether a feature is a self-contained slice rather than scattered across horizontal layers). This slice folds the wire DTO, the command, and the cache marker into one record: implementing [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) lets the generic request-mapper pipeline ([`QuestionCreateRequestMapper`](#questioncreaterequestmapper)) recognize it, and implementing [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) wires cache eviction exactly as [`AddSpeakerCategoryItemCommand`](#addspeakercategoryitemcommand) does. `[Rubric §9, API & Contract Design]`: the contract is explicit `required`/`init` properties (immutable after construction).
- **Walkthrough**: `CachePrefix` is `$"{typeof(Question).FullName}:"` (`QuestionCreateRequest.cs:13`). `Id` is `get; init;` but its doc comment (line 15) warns it is **auto-generated by the handler and caller-provided values are ignored**, the real allocation happens in [`CreateQuestionHandler`](#createquestionhandler). `QuestionText` is `required` (line 19); `QuestionEntity` and `QuestionType` are nullable strings (lines 22, 25); `Sort` (int, line 28) and `IsRequired` (bool, line 31) carry display/validation metadata.
- **Why it's built this way**: collapsing request+command into one record keeps the slice small; the `Id`-is-ignored convention exists because question ids share a reserved manual range distinct from the Sessionize-assigned space (see the handler).
- **Where it's used**: mapped to a domain entity by [`QuestionCreateRequestMapper`](#questioncreaterequestmapper), validated by [`QuestionCreateRequestValidator`](#questioncreaterequestvalidator), handled by [`CreateQuestionHandler`](#createquestionhandler).

### SpeakerCategoryItemDTOMapper
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.DTOs` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerCategoryItemDTOMapper.cs:12` · Level 6 · class (sealed partial)

- **What it is**: a Mapperly-generated entity-to-DTO mapper that projects a [`SpeakerCategoryItem`](group-17-conference-domain.md#speakercategoryitem) domain entity into a [`SpeakerCategoryItemDTO`](group-17-conference-domain.md#speakercategoryitemdto).
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype) (the interface it implements); the **Riok.Mapperly** source generator via the `[Mapper]` attribute (external, see [Mapperly in the primer](00-primer.md#3-the-external-stack-bcl--nuget--external-level-0)); the `SpeakerCategoryItemIdentifierType` alias.
- **Concept introduced, compile-time, explicit DTO mapping.** `[Rubric §1, SOLID]` and `[Rubric §15, Best Practices & Code Quality]`. ADR-001 (`ADRs/001-manual-dto-mapping.md`) chose explicit mapping over reflection-based AutoMapper; Mapperly realizes that decision, the mapping is generated as ordinary, debuggable, allocation-free code from the `partial` signature, so there is no runtime reflection and a property-name mismatch is a compile error rather than a silent null. The `[Mapper]` attribute (line 11) and the `partial` method are the entire contract; the generator pairs source and target properties by name.
- **Walkthrough**: `MapToDTO(SpeakerCategoryItem entity)` is the generated scalar map declared `partial` (line 16), the generator emits its body. The hand-written `MapToDTOs` (lines 19-23) null-guards with `ArgumentNullException.ThrowIfNull(entityCollection)` then projects with `[.. entityCollection.Select(MapToDTO)]`, a collection-expression spread that materializes a `List` exposed as `IReadOnlyCollection<SpeakerCategoryItemDTO>`.
- **Why it's built this way**: keeping the mapper trivial and generator-backed means the only hand-written mapping logic lives where a rule genuinely differs (compare [`SpeakerDTOMapper`](#speakerdtomapper), which adds PII redaction). This mapper has no such rule, so it stays a one-liner.
- **Where it's used**: injected into Conference query services and command handlers, including as a constructor dependency of [`AddSpeakerCategoryItemHandler`](#addspeakercategoryitemhandler) and as a `[UseMapper]` child of [`SpeakerDTOMapper`](#speakerdtomapper); auto-registered by Scrutor assembly scanning. Its near-identical sibling is [`SpeakerQuestionAnswerDTOMapper`](#speakerquestionanswerdtomapper).

### SpeakerCreateRequest
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Create/SpeakerCreateRequest.cs:10` · Level 6 · record (class)

- **What it is**: the create-request DTO for a new conference [`Speaker`](group-17-conference-domain.md#speaker). It doubles as the **command** (the create handler implements `ICommandHandler<SpeakerCreateRequest, …>`), carrying every speaker field: names, optional contact/social URLs, the Sessionize-assigned id, and an optional linked user.
- **Depends on**: [`Speaker`](group-17-conference-domain.md#speaker) (`SpeakerIdentifierType`/`UserIdentifierType` aliases + `CachePrefix`), [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) (the generic create-request marker), and [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating).
- **Concept reinforced, request DTO == command, processed by the generic request-mapper pipeline.** `[Rubric §9, API & Contract Design]` (DTOs decoupled from domain entities). By implementing [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) it plugs into the framework's generic create flow: a matching [`IEntityRequestMapper`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) ([`SpeakerCreateRequestMapper`](#speakercreaterequestmapper)) turns it into a domain entity, and a [`SpeakerCreateRequestValidator`](#speakercreaterequestvalidator) validates it before the handler runs. The id is settable (`Id { get; init; }`) because speakers are imported from Sessionize with a server-assigned GUID rather than database-generated.
- **Walkthrough**: `record class` (line 10); `CachePrefix` (line 13); `Id` is `get; init;` (line 16, the GUID from Sessionize); `FirstName`/`LastName`/`FullName` are `required string` (lines 19-25); the rest are nullable (`Email`, `Bio`, `TagLine`, `ProfilePicture`, `IsTopSpeaker`, `TwitterHandle`, the social/website URLs, `LinkedUserId`), see lines 28-58. The three URL strings carry an inline `[SuppressMessage("Design","CA1056")]` (lines 46/50/54), the analyzer wants `Uri`-typed properties, but they are stored as strings exactly as Sessionize returns them, and each suppression is *justified inline* (`[Rubric §15, Best Practices]`: suppressions are explained, not blanket-disabled).
- **Why it's built this way**: `required` on the three name fields makes a nameless speaker uncompilable at the call site (compile-time enforcement), while `init` keeps the whole DTO immutable after construction. Using the same record as both wire DTO and command avoids a redundant command type for a straight create.
- **Where it's used**: produced by `SpeakersController` (and the Sessionize import); validated by [`SpeakerCreateRequestValidator`](#speakercreaterequestvalidator), mapped by [`SpeakerCreateRequestMapper`](#speakercreaterequestmapper), handled by [`CreateSpeakerHandler`](#createspeakerhandler).

### SpeakerLocalityHelper
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/SpeakerLocalityHelper.cs:10` · Level 6 · class (internal static)

- **What it is**: a stateless helper that resolves a speaker's **locality tier** (Atlanta/Suburbs, Georgia, Surrounding State, North America, Not North America) from the category system, and classifies whether a speaker counts as "local". It backs the session-selection decision-support analytics, locality is one input organizers weigh when curating the schedule.
- **Depends on**: [`Speaker`](group-17-conference-domain.md#speaker), [`Category`](group-17-conference-domain.md#category), and [`CategoryItem`](group-17-conference-domain.md#categoryitem) (domain entities, read-only); the `CategoryItemIdentifierType` alias.
- **Concept introduced, locality-via-category, not via a Speaker field.** There is **no** `Speaker.Location` column; a speaker's origin is modeled as a [`SpeakerCategoryItem`](group-17-conference-domain.md#speakercategoryitem) pointing into the "Where are you traveling from" category (Sessionize category **121854**). This helper encapsulates that indirection so callers never hard-code the lookup. `[Rubric §4, Domain-Driven Design]` (assesses whether the model mirrors the business's own vocabulary): the conference's own Sessionize categorization *is* the source of truth for locality, so the code reads it rather than inventing a parallel field.
- **Walkthrough**: four static methods:
  - `GetLocalityTier(speaker, localityCategoryItems)` (`SpeakerLocalityHelper.cs:19-33`) iterates the speaker's `SpeakerCategoryItems`, **skipping soft-deleted** rows (`sci.IsDeleted`, line 25, honoring [soft-delete](00-primer.md#2-architectural-styles-this-codebase-commits-to) in-memory since these are already-loaded children), and returns the first tier name whose `CategoryItemId` is present in the supplied lookup, else `null`.
  - `IsLocalSpeaker(localityTier)` (lines 41-49) is a case-insensitive substring test, a tier counts as local if it contains "Atlanta", "Georgia", or "Surrounding".
  - `FindLocalityCategory(categories)` (lines 57-74) locates the locality [`Category`](group-17-conference-domain.md#category) by title substring `"traveling"` (case-insensitive, line 66), with a hard-coded **fallback to id `121854`** (line 69) if no title matches, a defensive belt-and-suspenders against the category being renamed.
  - `BuildLocalityLookup(localityCategory)` (lines 81-89) projects the category's non-deleted `CategoryItems` into an `IReadOnlyDictionary<CategoryItemIdentifierType, string>` of id-to-name, returning an empty dictionary when the category is `null`.
- **Why it's built this way**: pulling the lookup table out once (`BuildLocalityLookup`) and passing it into the per-speaker `GetLocalityTier` keeps the analytics loop O(speakers) rather than re-scanning categories per speaker; the title-match-with-id-fallback hedges against the two ways the category could be identified.
- **Where it's used**: consumed by the session-selection decision-support analytics (the `DecisionSupport` use-case folder) when assembling speaker-locality summaries for organizers.
- **Caveats / not-in-source**: the magic number `121854` is duplicated here as a literal; the comments name the tiers, but the exact tier strings come from the live category data, not from source.

### SpeakerQuestionAnswerDTOMapper
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.DTOs` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerQuestionAnswerDTOMapper.cs:12` · Level 6 · class (sealed partial)

- **What it is**: the Mapperly entity-to-DTO mapper that projects a [`SpeakerQuestionAnswer`](group-17-conference-domain.md#speakerquestionanswer) into a [`SpeakerQuestionAnswerDTO`](group-17-conference-domain.md#speakerquestionanswerdto). Structurally identical to [`SpeakerCategoryItemDTOMapper`](#speakercategoryitemdtomapper).
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype); the Riok.Mapperly generator (`[Mapper]`, line 11); the `SpeakerQuestionAnswerIdentifierType` alias.
- **Concept reinforced**: compile-time explicit mapping (ADR-001), taught in full on [`SpeakerCategoryItemDTOMapper`](#speakercategoryitemdtomapper); nothing differs here.
- **Walkthrough**: `partial SpeakerQuestionAnswerDTO MapToDTO(...)` (line 16, generator-filled) plus the hand-written `MapToDTOs` (lines 19-23) that null-guards and spreads `[.. entityCollection.Select(MapToDTO)]` into an `IReadOnlyCollection<SpeakerQuestionAnswerDTO>`.
- **Where it's used**: injected into Conference query services and as a `[UseMapper]` child of [`SpeakerDTOMapper`](#speakerdtomapper); auto-registered by Scrutor.

### AddSpeakerCategoryItemCommandValidator
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/AddSpeakerCategoryItem/AddSpeakerCategoryItemCommandValidator.cs:8` · Level 7 · class (sealed)

- **What it is**: the FluentValidation validator for [`AddSpeakerCategoryItemCommand`](#addspeakercategoryitemcommand): a single rule asserting `CategoryItemId` is not the default value.
- **Depends on**: `FluentValidation.AbstractValidator<T>` (external, see [primer](00-primer.md#3-the-external-stack-bcl--nuget--external-level-0)); the command it validates; the `CategoryItemIdentifierType` alias.
- **Concept introduced, pipeline-run validation.** `[Rubric §24, Forms, Validation & UX Safety]` and `[Rubric §10, Cross-Cutting Concerns]`. Validators are not called by hand inside handlers; they are discovered by Scrutor and executed by a validation step in the command pipeline **before** the handler runs, so a malformed command never reaches domain code. `[Rubric §1, SOLID]`: validation is a separate, single-responsibility class per command.
- **Walkthrough**: the ctor is an expression body (`AddSpeakerCategoryItemCommandValidator.cs:10-13`): `RuleFor(x => x.CategoryItemId).NotEqual(default(CategoryItemIdentifierType)).WithMessage("Category item ID is required.")`. The `SpeakerId` and optional `SpeakerCategoryItemId` are not validated here, the handler resolves the speaker (and 404s if missing), and a null join-id is intentional.
- **Why it's built this way**: only the genuinely required field is guarded; everything else is either resolved at the data layer or legitimately optional, so the validator stays minimal.
- **Where it's used**: run by the command pipeline ahead of [`AddSpeakerCategoryItemHandler`](#addspeakercategoryitemhandler).

### QuestionCreateRequestMapper
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Questions.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/UseCases/Create/QuestionCreateRequestMapper.cs:11` · Level 7 · class (sealed)

- **What it is**: the request-to-entity mapper for question creation: it turns a [`QuestionCreateRequest`](#questioncreaterequest) into a [`Question`](group-17-conference-domain.md#question) by delegating to the domain factory method, returning a [`Result<T>`](group-01-result-error-handling.md#result) so invalid input never produces a half-built entity.
- **Depends on**: [`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype), [`Question`](group-17-conference-domain.md#question), [`Result`](group-01-result-error-handling.md#result)/`Result<T>`.
- **Concept reinforced, the request mapper as the boundary between wire DTO and domain factory.** `[Rubric §4, DDD]` (entity construction goes through the factory, which enforces invariants and returns a `Result`). Unlike a DTO *mapper* (entity-to-DTO, mechanical), a *request* mapper goes the other way and may **fail**: hence its return type is `Task<Result<Question>>`, not `Question`. It is the only place that knows how request fields line up with the `Question.Create` parameters.
- **Walkthrough**: `CreateEntityAsync(QuestionCreateRequest request, CancellationToken)` (line 15): `ArgumentNullException.ThrowIfNull(request)` (line 17) then `Task.FromResult(Question.Create(request.Id, request.QuestionText, request.QuestionEntity!, request.QuestionType!, request.Sort, request.IsRequired, questionSource: "User"))` (lines 19-26). Note two details: the nullable `QuestionEntity`/`QuestionType` are forwarded with the null-forgiving `!` (they are validated/optional upstream), and `questionSource` is pinned to the literal `"User"` here, distinguishing hand-created questions from Sessionize-imported ones. The call is synchronous (the factory does no I/O) but wrapped in `Task.FromResult` to satisfy the async port signature.
- **Why it's built this way**: keeping the request-to-`Result<Question>` translation in a dedicated mapper lets [`CreateQuestionHandler`](#createquestionhandler) stay pure orchestration and makes the field mapping unit-testable in isolation.
- **Where it's used**: injected into [`CreateQuestionHandler`](#createquestionhandler) as `IEntityRequestMapper<Question, QuestionCreateRequest, QuestionIdentifierType>`.

### QuestionCreateRequestValidator
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Questions.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/UseCases/Create/QuestionCreateRequestValidator.cs:7` · Level 7 · class (sealed)

- **What it is**: the FluentValidation validator for [`QuestionCreateRequest`](#questioncreaterequest), assembled by *composing* a reusable question-text rule-set rather than restating the rule inline.
- **Depends on**: FluentValidation's `AbstractValidator<T>`; the reusable rule includable `QuestionTextRules<T>` (a first-party rule-set in `MMCA.ADC.Conference.Application.Questions.Validation`, not documented as its own onboarding type).
- **Concept reinforced, shared, composable validation rules.** `[Rubric §24, Forms, Validation & UX Safety]` (assesses that validation is present, runs before business logic, and is not copy-pasted per request). The validation decorator runs this *before* the create handler, so [`CreateQuestionHandler`](#createquestionhandler) can assume a well-formed text field. Using `Include(...)` of a shared `AbstractValidator` subclass means the question-text rule is authored once and reused by every request that has that field (create + update question), so a tightened rule propagates everywhere automatically.
- **Walkthrough**: the constructor is an expression body (lines 9-10): `Include(new QuestionTextRules<QuestionCreateRequest>(p => p.QuestionText))`. The rule-set is generic over the request type and takes a property selector, so the same rule body binds to whichever request property holds the text.
- **Why it's built this way**: separating *well-formedness* (here, declaratively) from *allowed-ness* (handler/domain invariants) keeps each concern in one layer, and the `Include` composition keeps the text rule DRY across the question create/update requests.
- **Where it's used**: auto-discovered by Scrutor, invoked by the command/validation pipeline ahead of [`CreateQuestionHandler`](#createquestionhandler).

### SpeakerCreateRequestMapper
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Create/SpeakerCreateRequestMapper.cs:11` · Level 7 · class (sealed)

- **What it is**: the request-to-entity mapper for speaker creation: it turns a [`SpeakerCreateRequest`](#speakercreaterequest) into a [`Speaker`](group-17-conference-domain.md#speaker) by delegating to the domain factory method, returning a [`Result<T>`](group-01-result-error-handling.md#result) so invalid input never produces a half-built entity.
- **Depends on**: [`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype), [`Speaker`](group-17-conference-domain.md#speaker), [`Result`](group-01-result-error-handling.md#result)/`Result<T>`.
- **Concept reinforced**: the request-mapper boundary between wire DTO and domain factory, taught in full on [`QuestionCreateRequestMapper`](#questioncreaterequestmapper). `[Rubric §4, DDD]`: construction runs through `Speaker.Create`, which enforces invariants and returns a `Result`.
- **Walkthrough**: `CreateEntityAsync(SpeakerCreateRequest request, CancellationToken)` (line 15): `ArgumentNullException.ThrowIfNull(request)` then `Task.FromResult(Speaker.Create(request.Id, request.FirstName, request.LastName, request.Email, request.Bio, request.TagLine, request.ProfilePicture, request.IsTopSpeaker))` (lines 19-27). Note it forwards only a subset of the request's fields, the social/website URLs and `LinkedUserId` are not factory parameters and are not set here.
- **Why it's built this way**: keeping the request-to-`Result<Speaker>` translation in a dedicated mapper lets [`CreateSpeakerHandler`](#createspeakerhandler) stay pure orchestration (map, save, return DTO) and makes the field mapping unit-testable in isolation.
- **Where it's used**: injected into [`CreateSpeakerHandler`](#createspeakerhandler) as `IEntityRequestMapper<Speaker, SpeakerCreateRequest, SpeakerIdentifierType>`.

### SpeakerCreateRequestValidator
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Create/SpeakerCreateRequestValidator.cs:7` · Level 7 · class (sealed)

- **What it is**: the FluentValidation validator for [`SpeakerCreateRequest`](#speakercreaterequest), assembled by *composing* two reusable speaker field rule-sets rather than restating the rules inline.
- **Depends on**: FluentValidation's `AbstractValidator<T>`, and the reusable rule includables `SpeakerFirstNameRules<T>` / `SpeakerLastNameRules<T>` (first-party rule-sets in `MMCA.ADC.Conference.Application.Speakers.Validation`, not documented as their own onboarding types).
- **Concept reinforced, shared, composable validation rules.** `[Rubric §24, Forms, Validation & UX Safety]` (assesses that validation is present, runs before business logic, and is not copy-pasted per request). The validation decorator runs this *before* the create handler, so [`CreateSpeakerHandler`](#createspeakerhandler) can assume a well-formed name. Using `Include(...)` of a shared `AbstractValidator` subclass means the first/last-name rules are authored once and reused by every request that has those fields (the create + update speaker requests), so a tightened rule propagates everywhere automatically.
- **Walkthrough**: the constructor (lines 9-13) calls `Include(new SpeakerFirstNameRules<SpeakerCreateRequest>(p => p.FirstName))` and the matching last-name include. The rule-sets are generic over the request type and take a property selector, so the same rule body binds to whichever request property holds the name.
- **Why it's built this way**: separating *well-formedness* (here, declaratively) from *allowed-ness* (handler/domain invariants) keeps each concern in one layer, and the `Include` composition keeps the name rules DRY across the speaker create/update requests.
- **Where it's used**: auto-discovered by Scrutor, invoked by the command/validation pipeline ahead of [`CreateSpeakerHandler`](#createspeakerhandler); covered by [`SpeakerCreateRequestValidatorTests`](group-27-testing-infrastructure.md#speakercreaterequestvalidatortests).

### SpeakerDTOMapper
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.DTOs` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerDTOMapper.cs:17` · Level 7 · class (sealed partial)

- **What it is**: the entity-to-DTO mapper for [`Speaker`](group-17-conference-domain.md#speaker), the one Mapperly mapper in this slice that is **not** a plain one-liner: it wraps the generated map with a **PII redaction** step (BR-66, speaker email is only exposed to Organizers) and delegates child-collection mapping to two sub-mappers.
- **Depends on**: [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype); [`SpeakerCategoryItemDTOMapper`](#speakercategoryitemdtomapper) and [`SpeakerQuestionAnswerDTOMapper`](#speakerquestionanswerdtomapper) (constructor-injected as `[UseMapper]` children); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) + [`RoleNames`](group-08-auth.md#rolenames) (for the role check); the [`Email`](group-02-domain-building-blocks.md#email) value object (redacted output); the Riok.Mapperly generator (`[Mapper]`, line 16).
- **Concept introduced, mapping-time authorization (PII redaction in the projection).** `[Rubric §11, Security]` (assesses whether sensitive data is protected at the boundary) and `[Rubric §5, Vertical Slice]`. Rather than filter email in every controller, the redaction is centralized in the one place that builds the DTO: after the generated map runs, the mapper asks [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) whether the caller is an Organizer and, if not, returns the DTO with `Email` nulled. This is the manual-mapping escape hatch ADR-001 preserves precisely for rules a source generator cannot express. `[Rubric §30, Compliance/Privacy]`: email is treated as PII and withheld from non-privileged reads.
- **Walkthrough**:
  - The primary constructor (lines 17-21) takes the two child mappers and `ICurrentUserService`; the two children are stored in `[UseMapper]` fields (lines 23-27) so the generator wires them into the generated map for the `SpeakerCategoryItems` / `SpeakerQuestionAnswers` collections.
  - `MapToDTO(Speaker entity)` (lines 30-37): null-guards, calls the private generated `MapToDTOGenerated(entity)` (line 33, declared `partial` at line 46), then applies BR-66, `currentUserService.IsInRole(RoleNames.Organizer) ? dto : dto with { Email = null }` (line 36). The `with`-expression produces a redacted copy without mutating the original.
  - `MapToDTOs` (lines 40-44) applies `MapToDTO` per element, so the redaction runs on every item in a list projection too.
  - A private `NullableEmailToString(Email? email) => email?.Value` (line 49) is a Mapperly conversion helper turning the [`Email`](group-02-domain-building-blocks.md#email) value object into the DTO's `string?`.
- **Why it's built this way**: doing the role check once, at projection time, guarantees no read path can accidentally leak the email, the alternative (filtering in each controller) is exactly the smeared cross-cutting concern the mapper centralizes. Delegating child mapping to the dedicated sub-mappers keeps each mapper single-responsibility.
- **Where it's used**: injected into [`CreateSpeakerHandler`](#createspeakerhandler) and the Speaker query services; auto-registered by Scrutor.

### AddSpeakerCategoryItemHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/AddSpeakerCategoryItem/AddSpeakerCategoryItemHandler.cs:15` · Level 8 · class (sealed partial)

- **What it is**: the command handler for [`AddSpeakerCategoryItemCommand`](#addspeakercategoryitemcommand): a textbook **load-aggregate / call-domain-method / save** child-add handler that returns the new join row as a DTO.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`SpeakerCategoryItemDTOMapper`](#speakercategoryitemdtomapper); `ILogger<T>` (with a source-generated `[LoggerMessage]`); [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error); [`Speaker`](group-17-conference-domain.md#speaker).
- **Concept introduced, the child-add mutation handler.** `[Rubric §6, CQRS & Event-Driven]` (assesses command/query separation and thin, single-purpose handlers). The handler does five things and nothing more: fetch the aggregate, 404 if absent, delegate the actual mutation to the *domain* (`speaker.AddSpeakerCategoryItem`), persist via the unit of work, and return the mapped result. All cross-cutting work (logging, caching, transaction) is added by the [decorator pipeline](00-primer.md#2-architectural-styles-this-codebase-commits-to), not here.
- **Walkthrough**: `HandleAsync` (`AddSpeakerCategoryItemHandler.cs:21-39`):
  1. `unitOfWork.GetRepository<Speaker, SpeakerIdentifierType>()` then `GetByIdAsync` (lines 25-26).
  2. If `null`, `Result.Failure<...>(Error.NotFound.WithSource(...).WithTarget(nameof(Speaker)))` (lines 27-28), the [`Error`](group-01-result-error-handling.md#error) carries source/target metadata for the Problem-Details response.
  3. `speaker.AddSpeakerCategoryItem(command.SpeakerCategoryItemId, command.CategoryItemId)` (line 30), the **domain** decides whether the add is legal and returns a `Result<SpeakerCategoryItem>`; on failure the handler propagates `result.Errors` (lines 31-32).
  4. `SaveChangesAsync` (line 34) persists (and stamps audit fields / dispatches domain events centrally).
  5. `LogCategoryItemAdded(...)` via the `[LoggerMessage]` source-generated logger (lines 36, 41-42), then return the mapped `SpeakerCategoryItemDTO` off `result.Value!` (line 38).
- **Why it's built this way**: keeping the mutation in `Speaker.AddSpeakerCategoryItem` (not the handler) preserves the aggregate's invariants; the handler is pure orchestration, which is exactly why it can be so short and why the decorator pipeline can wrap it uniformly. Cache eviction is automatic because the command implements [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating).
- **Where it's used**: dispatched by the Speakers REST controller in the Conference service when an organizer tags a speaker; tested by [`AddSpeakerCategoryItemHandlerTests`](group-27-testing-infrastructure.md#addspeakercategoryitemhandlertests).

### CreateQuestionHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Questions.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Questions/UseCases/Create/CreateQuestionHandler.cs:16` · Level 8 · class (sealed partial)

- **What it is**: the command handler that creates a [`Question`](group-17-conference-domain.md#question). Unlike the plain create handlers, it **allocates the id itself** by scanning a reserved manual id range, so caller-supplied ids are ignored.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IEntityRequestMapper<Question, QuestionCreateRequest, QuestionIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) (resolved to [`QuestionCreateRequestMapper`](#questioncreaterequestmapper)), the `QuestionDTOMapper` ([its section](#questiondtomapper)), `ILogger`, [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult), [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error), and [`QuestionInvariants`](group-17-conference-domain.md#questioninvariants) (the reserved manual-id range constants).
- **Concept introduced, application-assigned id allocation in a reserved range.** `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §8, Data Architecture]`. Because question ids are shared with an external Sessionize id space, hand-created questions must be assigned ids from a **reserved manual range** so they can never collide with imported ones. That allocation is a data-consistency policy, and it lives in the handler (not the domain factory) because it needs a repository query. `[Rubric §13, Observability]`: the outcome is logged via a source-generated `[LoggerMessage]`.
- **Walkthrough**: `HandleAsync(QuestionCreateRequest command, CancellationToken)` (line 23):
  1. Get the typed repository (line 27), then query all existing manual-range questions with `GetAllAsync(..., where: q => q.Id >= QuestionInvariants.ManualIdRangeStart && q.Id <= QuestionInvariants.ManualIdRangeEnd, ignoreQueryFilters: true, ...)` (lines 31-35), `ignoreQueryFilters: true` includes soft-deleted rows so an id is never reused.
  2. Compute `nextId` as `max(id) + 1` or `ManualIdRangeStart` when the range is empty (lines 37-39); if `nextId > ManualIdRangeEnd`, fail with `Error.Failure(..., "Manual question ID range exhausted.")` (lines 41-42).
  3. Override the id on the immutable command via a `with` expression, `command = command with { Id = nextId }` (line 45), so caller-provided values cannot control it.
  4. `requestMapper.CreateEntityAsync(command, ...)` builds the entity (line 47); short-circuit on failure (lines 48-49).
  5. `repository.AddAsync(entity, ...)` then `unitOfWork.SaveChangesAsync(...)` (lines 53-54), both `.ConfigureAwait(false)`.
  6. `LogQuestionCreated(...)` (line 56, source-generated at lines 61-62), then `Result.Success(dtoMapper.MapToDTO(entity))` returns the created question as a DTO (line 58).
- **Why it's built this way**: putting id allocation in the handler (where a repository is available) keeps the domain factory pure, and reading soft-deleted rows via `ignoreQueryFilters` guarantees ids are monotonic and never recycled, which matters when the same key space is shared with an external system.
- **Where it's used**: registered as the handler for [`QuestionCreateRequest`](#questioncreaterequest); invoked by the Questions REST controller through the command pipeline; tested by [`CreateQuestionHandlerTests`](group-27-testing-infrastructure.md#createquestionhandlertests).

### CreateSpeakerHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.Create` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/Create/CreateSpeakerHandler.cs:16` · Level 8 · class (sealed partial)

- **What it is**: the command handler that creates a [`Speaker`](group-17-conference-domain.md#speaker): map-via-request-mapper, persist, return the mapped DTO.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IEntityRequestMapper<Speaker, SpeakerCreateRequest, SpeakerIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype) (resolved to [`SpeakerCreateRequestMapper`](#speakercreaterequestmapper)), [`SpeakerDTOMapper`](#speakerdtomapper), `ILogger`, and [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult).
- **Concept reinforced, the thin orchestration handler (map, save, project).** `[Rubric §5, Vertical Slice]` (the create feature, request, validator, request-mapper, handler, lives together in one `Create/` folder) and `[Rubric §6, CQRS]`. The handler does no business logic itself; invariants live in the domain factory the mapper calls, validation in the pipeline ahead of it. Contrast [`CreateQuestionHandler`](#createquestionhandler), which adds an id-allocation step, this one has no such policy and stays minimal.
- **Walkthrough**: `HandleAsync(SpeakerCreateRequest command, CancellationToken)` (line 23): (1) `requestMapper.CreateEntityAsync(command, ...)` (line 27), if `IsFailure`, short-circuit with `Result.Failure<SpeakerDTO>(result.Errors)` (lines 28-29); (2) take `result.Value!`, get the typed repository `unitOfWork.GetRepository<Speaker, SpeakerIdentifierType>()` (line 32); (3) `repository.AddAsync(entity, ...)` then `unitOfWork.SaveChangesAsync(...)` (lines 34-35, both `.ConfigureAwait(false)`); (4) `LogSpeakerCreated(...)` (line 37) via a `[LoggerMessage]` source-generated logger (lines 42-43, high-performance structured logging, `[Rubric §13, Observability]`); (5) `Result.Success(dtoMapper.MapToDTO(entity))` returns the created speaker as a DTO (with BR-66 email redaction applied by [`SpeakerDTOMapper`](#speakerdtomapper)). `[Rubric §1, SOLID]`: the request type appears in the generic signature, so the dispatcher resolves this handler by message type alone.
- **Why it's built this way**: splitting construction (mapper/factory), validation (pipeline), persistence (unit of work) and projection (DTO mapper) into collaborators keeps the handler readable and each piece unit-testable; see [`CreateSpeakerHandlerTests`](group-27-testing-infrastructure.md#createspeakerhandlertests).
- **Where it's used**: registered as the handler for [`SpeakerCreateRequest`](#speakercreaterequest); invoked by `SpeakersController`'s create action (through the command pipeline).

### LinkUserToSpeakerCommand, UnlinkUserFromSpeakerCommand
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.LinkUser` / `.UnlinkUser` · Level 6 · record

The two command records that drive the *Conference* side of the bidirectional User to Speaker link (BR-208, BR-209). Both are transactional cache-invalidating commands; they differ only in payload (link carries both ids, unlink carries just the speaker).

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `LinkUserToSpeakerCommand` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/LinkUser/LinkUserToSpeakerCommand.cs:18` | `(SpeakerId, UserId)`: names both ends of the link |
| `UnlinkUserFromSpeakerCommand` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/UnlinkUser/UnlinkUserFromSpeakerCommand.cs:17` | `(SpeakerId)` only: the handler reads the current `LinkedUserId` before clearing it |

- **What they are**: `sealed record` commands that associate (or dissociate) a [`Speaker`](group-17-conference-domain.md#speaker) with an Identity [`User`](group-24-identity-module.md#user). A link happens when a conference speaker also holds an account, so the two records point at each other across module boundaries.
- **Depends on**: the `SpeakerIdentifierType` and `UserIdentifierType` id aliases (see [primer](00-primer.md#2-architectural-styles-this-codebase-commits-to)); [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) and [`ITransactional`](group-05-cqrs-pipeline.md#itransactional) from `MMCA.Common.Application`; `Speaker` (used only for `typeof(Speaker).FullName` in the cache prefix, `LinkUserToSpeakerCommand.cs:21`).
- **Concept introduced (marker interfaces steer the decorator pipeline)**: a command carries no behavior of its own; it declares its cross-cutting needs by *implementing marker interfaces* that the CQRS decorators inspect. `ITransactional` tells the [`TransactionalCommandDecorator`](group-05-cqrs-pipeline.md#itransactional) to open a DB transaction around the handler; [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) tells the caching decorator to evict entries under `CachePrefix` on success. Here `CachePrefix => $"{typeof(Speaker).FullName}:"` (`LinkUserToSpeakerCommand.cs:20-21`) so any successful link or unlink flushes the cached speaker reads. `[Rubric §6, CQRS & Event-Driven]` assesses whether writes are modeled as explicit intent objects: these records are pure intent with the pipeline supplying the mechanics. `[Rubric §10, Cross-Cutting]` assesses how transactions and caching are applied uniformly rather than hand-wired per handler, which is exactly what the marker interfaces achieve.
- **Walkthrough**: each is a one-line positional `record` (`LinkUserToSpeakerCommand.cs:18`, `UnlinkUserFromSpeakerCommand.cs:17`) plus the single `CachePrefix` expression-bodied property. Link declares both `ITransactional` and `ICacheInvalidating`; unlink declares the same pair.
- **Why it's built this way**: `ITransactional` is load-bearing because linking coordinates a write to `Speaker.LinkedUserId` *and* an integration-event publish that eventually mutates `User.LinkedSpeakerId` in a separate database (ADR-006). Wrapping the local write and the outbox capture in one transaction keeps the local commit and the event atomic (ADR-003 outbox); the cross-database consistency is then eventual, carried by the event rather than a foreign key.
- **Where it's used**: dispatched by `SpeakersController`'s link/unlink actions; handled by [`LinkUserToSpeakerHandler`](#linkusertospeakerhandler) and [`UnlinkUserFromSpeakerHandler`](#unlinkuserfromspeakerhandler).

### RemoveSpeakerCategoryItemCommand
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.RemoveSpeakerCategoryItem` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/RemoveSpeakerCategoryItem/RemoveSpeakerCategoryItemCommand.cs:15` · Level 6 · record

- **What it is**: the command to detach a category-item association from a [`Speaker`](group-17-conference-domain.md#speaker) aggregate (for example a speaker's topic or locality tag).
- **Depends on**: `SpeakerIdentifierType` and `SpeakerCategoryItemIdentifierType` aliases; [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); `Speaker` for the cache prefix.
- **Concept reinforced (child-mutation command on an aggregate root)**: unlike the link commands this one is *not* `ITransactional`, because the whole operation is a single-aggregate write (remove one child from one `Speaker`), which the unit of work commits in one `SaveChangesAsync` regardless. It carries the same speaker cache prefix (`RemoveSpeakerCategoryItemCommand.cs:19-20`) so removing a tag flushes cached speaker reads. `[Rubric §4, Domain-Driven Design]` assesses whether child collections are mutated *through* the aggregate root rather than as independent rows: the command names both the parent `SpeakerId` and the child `SpeakerCategoryItemId`, forcing the handler to load the root first.
- **Walkthrough**: a two-field positional `record` (`SpeakerId`, `SpeakerCategoryItemId`) at `RemoveSpeakerCategoryItemCommand.cs:15-17` plus the `CachePrefix` property.
- **Why it's built this way**: keeping the parent id in the command is what lets [`RemoveSpeakerCategoryItemHandler`](#removespeakercategoryitemhandler) fetch the aggregate with its children tracked and delegate deletion to a domain method, preserving the consistency boundary.
- **Where it's used**: dispatched by `SpeakersController`; handled by [`RemoveSpeakerCategoryItemHandler`](#removespeakercategoryitemhandler).

### AddSessionCategoryItemCommand
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionCategoryItem/AddSessionCategoryItemCommand.cs:15` · Level 7 · record

- **What it is**: the command to add a category-item association (a topic, format, or level tag) to an existing [`Session`](group-17-conference-domain.md#session).
- **Depends on**: `SessionIdentifierType`, the nullable `SessionCategoryItemIdentifierType?`, and `CategoryItemIdentifierType` aliases; [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); [`Session`](group-17-conference-domain.md#session) for the cache prefix; [`CategoryItem`](group-17-conference-domain.md#categoryitem) is the referenced tag.
- **Concept reinforced (optional caller-supplied id vs database-generated identity)**: `SessionCategoryItemId` is *nullable* (`AddSessionCategoryItemCommand.cs:17`). A non-null value is an explicit id for the join row; `null` means "let the database generate the identity," a contract the doc comment records inline (`AddSessionCategoryItemCommand.cs:13`). That mirrors the framework's `IdValueGenerated` handling (see [Group 02](group-02-domain-building-blocks.md#idvaluegeneratedattribute)) and lets the Sessionize importer replay deterministic ids while the interactive UI leaves id assignment to SQL Server. `CachePrefix => $"{typeof(Session).FullName}:"` (`AddSessionCategoryItemCommand.cs:20-21`) evicts cached session reads on success. `[Rubric §8, Data Architecture]` assesses id-generation strategy; the optional id is where that choice surfaces at the command boundary.
- **Walkthrough**: a three-field positional `record` (`AddSessionCategoryItemCommand.cs:15-18`) plus `CachePrefix`. Not transactional (single-aggregate write).
- **Why it's built this way**: threading the optional id through the command (rather than forcing one policy) keeps a single write path usable by both the import and the UI.
- **Where it's used**: validated by [`AddSessionCategoryItemCommandValidator`](#addsessioncategoryitemcommandvalidator), handled by [`AddSessionCategoryItemHandler`](#addsessioncategoryitemhandler).

### OwnSessionQuestionAnswerSpecification
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.Specifications` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/Specifications/OwnSessionQuestionAnswerSpecification.cs:11` · Level 7 · class

- **What it is**: an authorization specification that scopes a [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer) query to answers the current user created (BR-9). Attendees see only their own answers; organizers bypass it by passing `null`.
- **Depends on**: [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype) from `MMCA.Common.Domain`; the `SessionQuestionAnswer` entity and `SessionQuestionAnswerIdentifierType` alias; the `UserIdentifierType` alias; `System.Linq.Expressions`.
- **Concept reinforced (authorization as a first-class query constraint)**: rather than fetch every answer and filter in the controller, the criteria is expressed as an `Expression<Func<...>>` that EF Core translates to a SQL `WHERE`, so the database never returns rows the caller may not see. The specification pattern itself is taught in [Group 03](group-03-querying-specifications.md#specificationtentity-tidentifiertype); this is a concrete authorization use of it. It is a primary-constructor class closing over `userId` (`OwnSessionQuestionAnswerSpecification.cs:11`). `[Rubric §11, Security]` assesses whether authorization is enforced at the data-access boundary rather than bolted on afterward; the criteria constrains the query itself. `[Rubric §14, Testability]` assesses pure, unit-testable predicates; `Criteria` is a side-effect-free expression.
- **Walkthrough**: overrides `Criteria` (`OwnSessionQuestionAnswerSpecification.cs:15-16`) as `a => a.CreatedBy == userId`, comparing the audit `CreatedBy` field (stamped centrally, see [Group 02](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)) against the captured user id.
- **Why it's built this way**: closing over `userId` in the constructor makes the specification a self-contained, injectable predicate; passing `null` for organizers keeps the same query path with no branching in the handler.
- **Where it's used**: passed to the entity query service by the session question-answer read endpoints; sibling of `OwnEventQuestionAnswerSpecification` and `PublishedEventSpecification` in the same module.

### SessionCategoryItemDTOMapper, SessionQuestionAnswerDTOMapper, SessionSpeakerDTOMapper
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.DTOs` · Level 7 · class (Mapperly)

Three structurally identical Mapperly mappers, one per child collection of the `Session` aggregate. Each turns a domain child entity into its wire DTO.

| Type | File:Line | Maps |
|------|-----------|------|
| `SessionCategoryItemDTOMapper` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/DTOs/SessionCategoryItemDTOMapper.cs:12` | [`SessionCategoryItem`](group-17-conference-domain.md#sessioncategoryitem) to [`SessionCategoryItemDTO`](group-17-conference-domain.md#sessioncategoryitemdto) |
| `SessionQuestionAnswerDTOMapper` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/DTOs/SessionQuestionAnswerDTOMapper.cs:12` | [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer) to [`SessionQuestionAnswerDTO`](group-17-conference-domain.md#sessionquestionanswerdto) |
| `SessionSpeakerDTOMapper` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/DTOs/SessionSpeakerDTOMapper.cs:12` | [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker) to [`SessionSpeakerDTO`](group-17-conference-domain.md#sessionspeakerdto) |

- **What they are**: `sealed partial` Mapperly mappers implementing [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype), each converting one `Session` child entity to its outward-facing DTO.
- **Depends on**: the `[Mapper]` attribute and Mapperly source generator (`Riok.Mapperly.Abstractions`); the corresponding domain entity and DTO from `MMCA.ADC.Conference.Domain.Sessions` / `.Shared.Sessions`; `IEntityDTOMapper` from `MMCA.Common.Application`.
- **Concept reinforced (compile-time mapping over reflection, ADR-001)**: `[Mapper]` on a `partial` class makes Mapperly generate the field-by-field copy at build time, so there is no runtime reflection cost and a missing or renamed member is a compile error, not a silent null. The single-entity `MapToDTO` is declared `partial` (for example `SessionSpeakerDTOMapper.cs:16`) and filled in by the generator; the collection overload `MapToDTOs` is hand-written and simply projects with `entityCollection.Select(MapToDTO)` after a null guard (`SessionSpeakerDTOMapper.cs:19-23`). `[Rubric §9, API & Contract Design]` assesses keeping domain types off the wire behind explicit DTOs; these mappers are the boundary that does it. `[Rubric §15, Best Practices]` and `[Rubric §12, Performance]` both favor generated mapping over reflective mappers.
- **Walkthrough**: each class declares `partial <DTO> MapToDTO(<Entity> entity)` (generator-implemented) and a concrete `MapToDTOs` that calls `ArgumentNullException.ThrowIfNull` then collection-expression-projects the results (identical across all three, lines 16-23 in each file).
- **Why it's built this way**: one tiny mapper per child keeps each conversion independently discoverable and lets the parent [`SessionDTOMapper`](#sessiondtomapper) compose them by injection rather than duplicating child-mapping logic.
- **Where they're used**: injected into [`SessionDTOMapper`](#sessiondtomapper) as `[UseMapper]` collaborators, and directly into child-mutation handlers such as [`AddSessionCategoryItemHandler`](#addsessioncategoryitemhandler).

### AddSessionCategoryItemCommandValidator
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionCategoryItem/AddSessionCategoryItemCommandValidator.cs:8` · Level 8 · class (FluentValidation)

- **What it is**: a single-rule FluentValidation validator for [`AddSessionCategoryItemCommand`](#addsessioncategoryitemcommand), rejecting a default (unset) category-item id before the handler runs.
- **Depends on**: FluentValidation's `AbstractValidator<TCommand>`; the `CategoryItemIdentifierType` alias.
- **Concept reinforced (shape validation at the command boundary)**: the validation decorator (see [Group 05](group-05-cqrs-pipeline.md#itransactional)) runs before the transaction opens, so a malformed request never reaches domain logic or a DB round-trip. `[Rubric §24, Forms, Validation & UX Safety]` assesses whether input is validated up front and separated from business rules; this checks only that the request is *well-formed* (`CategoryItemId != default`), while eligibility rules that need the loaded aggregate stay in the handler and domain.
- **Walkthrough**: the constructor is an expression body (`AddSessionCategoryItemCommandValidator.cs:10-13`) with one `RuleFor(x => x.CategoryItemId).NotEqual(default(CategoryItemIdentifierType)).WithMessage("Category item ID is required.")`.
- **Why it's built this way**: keeping the trivial guard declarative and auto-discovered (Scrutor scans for `AbstractValidator<>`) means a new command is wired into the pipeline just by adding a validator class.
- **Where it's used**: invoked by the validating command decorator ahead of [`AddSessionCategoryItemHandler`](#addsessioncategoryitemhandler); sibling of `AddSessionQuestionAnswerCommandValidator` and `AddSessionSpeakerCommandValidator`.

### AddSessionCategoryItemHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionCategoryItem/AddSessionCategoryItemHandler.cs:16` · Level 8 · class (sealed partial)

- **What it is**: the handler that adds a `SessionCategoryItem` child to a [`Session`](group-17-conference-domain.md#session), persists it, and returns the mapped DTO.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`SessionCategoryItemDTOMapper`](#sessioncategoryitemdtomapper-sessionquestionanswerdtomapper-sessionspeakerdtomapper); `ILogger`; [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) returning [`Result`](group-01-result-error-handling.md#result) of `SessionCategoryItemDTO`.
- **Concept reinforced (the load-aggregate, call-domain-method, save mutation shape)**: this is the canonical child-add handler. It resolves the typed repository via `unitOfWork.GetRepository<Session, SessionIdentifierType>()` (`AddSessionCategoryItemHandler.cs:26`), loads the aggregate, and if missing returns `Error.NotFound` tagged with source and target (`AddSessionCategoryItemHandler.cs:28-29`, see [Group 01](group-01-result-error-handling.md#error)). It then delegates the *actual mutation* to the domain method `session.AddSessionCategoryItem(...)` (`AddSessionCategoryItemHandler.cs:31`), so the invariant lives on the aggregate, not the handler. `[Rubric §4, DDD]` assesses whether state changes go through the root; here the handler never touches child state directly. `[Rubric §6, CQRS]` assesses the command-handler split. `[Rubric §13, Observability]` is served by the source-generated `LoggerMessage` (`AddSessionCategoryItemHandler.cs:42-43`), a zero-allocation structured log.
- **Walkthrough**: get repository (line 26), `GetByIdAsync` (line 27), not-found guard (28-29), call `session.AddSessionCategoryItem(command.SessionCategoryItemId, command.CategoryItemId)` and propagate failure (31-33), `SaveChangesAsync` with `ConfigureAwait(false)` (35), structured log (37), return `Result.Success(dtoMapper.MapToDTO(result.Value!))` (39). The `[LoggerMessage]` partial method is generated (42-43).
- **Why it's built this way**: the handler is pure orchestration (fetch, delegate, save, map), which keeps the domain expressive and the handler unit-testable, and `SaveChangesAsync` is what triggers audit stamping and outbox capture (see [Group 04](group-04-events-outbox.md)).
- **Where it's used**: registered as the `ICommandHandler` for `AddSessionCategoryItemCommand`; invoked through the decorator pipeline from the Conference session controllers.

### LinkUserToSpeakerHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.LinkUser` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/LinkUser/LinkUserToSpeakerHandler.cs:17` · Level 8 · class (sealed partial)

- **What it is**: the handler that links a [`Speaker`](group-17-conference-domain.md#speaker) to a [`User`](group-24-identity-module.md#user), enforces the "one user, one speaker" rule (BR-208), and publishes an integration event so the Identity module sets `User.LinkedSpeakerId` (BR-209).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`IIntegrationEventPublisher`](group-04-events-outbox.md#iintegrationeventpublisher); `Speaker`; the [`SpeakerLinkedToUser`](group-17-conference-domain.md#speakerlinkedtouser) integration-event record; `ILogger`; `ICommandHandler` returning [`Result`](group-01-result-error-handling.md#result).
- **Concept introduced (cross-context coordination via integration events, no cross-module domain reference)**: Conference and Identity own *separate databases* (ADR-006), so there is no foreign key between `Speaker` and `User`. This handler mutates only its own side (`speaker.LinkUser(userId)`, `LinkUserToSpeakerHandler.cs:46`) and announces the change with `integrationEventPublisher.PublishAsync(new SpeakerLinkedToUser(...))` (`LinkUserToSpeakerHandler.cs:55-57`), which the outbox captures in the same transaction (the command is `ITransactional`). Identity's own handler then updates `User.LinkedSpeakerId` asynchronously. The inline comment (`LinkUserToSpeakerHandler.cs:53-54`) records that this *replaces* a former direct `IUserSpeakerLinkService` call. `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §7, Microservices Readiness]` are the headline story: routing consistency through an event is what lets the two modules run as independently extractable services (ADR-007/008) with no compile-time coupling.
- **Walkthrough**: load speaker and not-found guard (lines 27-30); the BR-208 check queries for any *other* speaker already holding this `LinkedUserId` and returns `Error.Invariant("Speaker.UserAlreadyLinked", ...)` if found (33-44); call `speaker.LinkUser(command.UserId)` (46); on success `SaveChangesAsync` (49), structured log (51), then publish the integration event (55-57); return the domain `result` (60).
- **Why it's built this way**: the BR-208 uniqueness check lives in the handler because it spans *all* speakers (a query), not one aggregate's invariant; the event publish (rather than a direct cross-module write) is the extraction-readiness choice.
- **Where it's used**: registered for `LinkUserToSpeakerCommand`; called by `SpeakersController`'s link action. The consumer end is Identity's `SpeakerLinkedToUserHandler`.

### RemoveSpeakerCategoryItemHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.RemoveSpeakerCategoryItem` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/RemoveSpeakerCategoryItem/RemoveSpeakerCategoryItemHandler.cs:13` · Level 8 · class (sealed partial)

- **What it is**: the handler that removes a category-item association from a [`Speaker`](group-17-conference-domain.md#speaker) by loading the aggregate with its children and delegating to a domain method.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); `Speaker`; `ILogger`; `ICommandHandler` returning [`Result`](group-01-result-error-handling.md#result).
- **Concept reinforced (eager-load the child collection so the root can police removal)**: unlike the plain `GetByIdAsync`, this handler loads the speaker with `includes: [nameof(Speaker.SpeakerCategoryItems)]` and `asTracking: true` (`RemoveSpeakerCategoryItemHandler.cs:23-27`), because you cannot remove a child the aggregate has not materialized. It then calls `entity.RemoveSpeakerCategoryItem(command.SpeakerCategoryItemId)` (line 31), letting the root decide the child exists and enforce any invariant. `[Rubric §4, DDD]` assesses mutation through the aggregate boundary; the explicit `includes` plus tracked load is what makes that boundary honest for a delete.
- **Walkthrough**: get repository (line 22), tracked `GetByIdAsync` with the children included (23-27), not-found guard (28-29), delegate removal (31), on success `SaveChangesAsync` (34) and structured log (36); return `result` (39). The `[LoggerMessage]` partial is at lines 42-43.
- **Why it's built this way**: soft-delete of a child (see [Group 02](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)) requires the parent to own the operation; loading tracked children keeps EF change-tracking and the aggregate's view in sync.
- **Where it's used**: registered for `RemoveSpeakerCategoryItemCommand`; called by `SpeakersController`.

### SessionDTOMapper
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.DTOs` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/DTOs/SessionDTOMapper.cs:14` · Level 8 · class (Mapperly)

- **What it is**: the top-level Mapperly mapper that turns a [`Session`](group-17-conference-domain.md#session) aggregate (with its speaker, question-answer, and category-item children) into a [`SessionDTO`](group-17-conference-domain.md#sessiondto).
- **Depends on**: `[Mapper]` / Mapperly; [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](group-12-api-hosting-mapping.md#ientitydtomappertentity-tentitydto-tidentifiertype); the three child mappers [`SessionSpeakerDTOMapper`, `SessionQuestionAnswerDTOMapper`, `SessionCategoryItemDTOMapper`](#sessioncategoryitemdtomapper-sessionquestionanswerdtomapper-sessionspeakerdtomapper).
- **Concept reinforced (composing generated mappers with `[UseMapper]`)**: rather than flatten child mapping into one mega-mapper, this class *injects* the three child mappers through its primary constructor and marks each backing field `[UseMapper]` (`SessionDTOMapper.cs:20-27`). Mapperly then calls those collaborators for the child collections while generating the top-level `partial SessionDTO MapToDTO(Session entity)` (line 30). This is the ADR-001 manual-mapping-via-generator choice at its most compositional. `[Rubric §9, API & Contract Design]` assesses a clean domain-to-contract boundary; `[Rubric §1, SOLID]` shows single-responsibility mappers composed rather than one doing everything.
- **Walkthrough**: primary constructor takes the three child mappers (14-17); each is stored in a `[UseMapper]`-tagged `readonly` field (20-27); `MapToDTO` is the generated `partial` (30); `MapToDTOs` is the hand-written null-guarded collection projection (33-37). Because it takes constructor dependencies it is DI-registered (unlike the parameterless child mappers Scrutor also registers).
- **Why it's built this way**: injecting the child mappers keeps each conversion testable and reusable (the child mappers also serve the child-mutation handlers directly) and avoids duplicating child-mapping code in the aggregate mapper.
- **Where it's used**: injected into `Session` read handlers and the entity query service to project query results into DTOs served by the Conference session controllers.

### UnlinkUserFromSpeakerHandler
> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers.UseCases.UnlinkUser` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/UseCases/UnlinkUser/UnlinkUserFromSpeakerHandler.cs:16` · Level 8 · class (sealed partial)

- **What it is**: the mirror of [`LinkUserToSpeakerHandler`](#linkusertospeakerhandler); it clears `Speaker.LinkedUserId` and publishes an event so Identity clears `User.LinkedSpeakerId` (BR-209).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`IIntegrationEventPublisher`](group-04-events-outbox.md#iintegrationeventpublisher); [`Speaker`](group-17-conference-domain.md#speaker); the [`SpeakerUnlinkedFromUser`](group-17-conference-domain.md#speakerunlinkedfromuser) integration-event record; `ILogger`; `ICommandHandler` returning [`Result`](group-01-result-error-handling.md#result).
- **Concept reinforced (capture cross-context state before you destroy it)**: because the unlink command carries only the speaker id, the handler reads `speaker.LinkedUserId` *before* calling `speaker.UnlinkUser()` (`UnlinkUserFromSpeakerHandler.cs:31-32`), so the event it publishes can still name the user that was unlinked. It publishes `SpeakerUnlinkedFromUser(previousUserId.Value, command.SpeakerId)` only when a link actually existed (`UnlinkUserFromSpeakerHandler.cs:41-46`). Same `[Rubric §6, CQRS & Event-Driven]` and `[Rubric §7, Microservices Readiness]` story as the link handler: eventual cross-database consistency carried by an outbox event (ADR-003, ADR-006), no cross-module domain reference (ADR-007/008).
- **Walkthrough**: load speaker and not-found guard (27-29); capture `previousUserId = speaker.LinkedUserId` (31); `speaker.UnlinkUser()` (32); on success `SaveChangesAsync` (35), log (37), and, if `previousUserId.HasValue`, publish the event (41-46); return `result` (49).
- **Why it's built this way**: capturing the prior user id up front is the only way an unlink event can identify its subject once the field is cleared; guarding the publish on `HasValue` avoids emitting a meaningless event when the speaker was not linked.
- **Where it's used**: registered for `UnlinkUserFromSpeakerCommand`; called by `SpeakersController`'s unlink action. The consumer is Identity's `SpeakerUnlinkedFromUserHandler`.

### AddSessionQuestionAnswerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer` · `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionQuestionAnswer/AddSessionQuestionAnswerCommand.cs:18` · Level 7 · record

- **What it is**: the command that adds (or upserts) a question answer on an existing session. It carries the target session, an optional explicit answer id, the question being answered, and the answer text.
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) (marker); [`Session`](group-17-conference-domain.md#session) (for the cache prefix); the identifier aliases `SessionIdentifierType`, `SessionQuestionAnswerIdentifierType`, `QuestionIdentifierType`; BCL `string`.
- **Concept introduced, the cache-invalidating command shape.** `[Rubric §6, CQRS & Event-Driven]` assesses whether writes and reads are modeled as distinct, single-purpose messages; this record is a pure write intent with no behavior beyond declaring its cache tag. `[Rubric §12, Performance & Scalability]` assesses caching discipline: implementing [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) with `CachePrefix => $"{typeof(Session).FullName}:"` (`AddSessionQuestionAnswerCommand.cs:25`) is what lets the caching decorator in the pipeline evict every cached read keyed under the `Session` type once the write succeeds. The whole `Session` child-command family in this unit shares this exact one-line prefix.
- **Walkthrough**: a `sealed record` with a four-parameter positional constructor (`AddSessionQuestionAnswerCommand.cs:18-22`): `SessionId`, a nullable `SessionQuestionAnswerId` (null means database-generated identity, `:20`), `QuestionId`, and `AnswerValue`. The single read-only member is `CachePrefix` (`:25`).
- **Why it's built this way**: records give value equality and immutability for free, and keeping the cache tag on the message (rather than in the handler) means the pipeline decorator, not the handler, owns eviction (see the decorator pipeline in [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Where it's used**: dispatched by the `SessionQuestionAnswersController` (see [Group 20](group-20-conference-api-grpc.md#sessionquestionanswerscontroller)); validated by [`AddSessionQuestionAnswerCommandValidator`](#addsessionquestionanswercommandvalidator); handled by [`AddSessionQuestionAnswerHandler`](#addsessionquestionanswerhandler).

### AddSessionSpeakerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker` · `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionSpeaker/AddSessionSpeakerCommand.cs:15` · Level 7 · record

- **What it is**: the command that associates a speaker with an existing session by creating a `SessionSpeaker` join row.
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); [`Session`](group-17-conference-domain.md#session) (cache prefix); the aliases `SessionIdentifierType`, `SessionSpeakerIdentifierType`, `SpeakerIdentifierType`.
- **Concept reinforced, cache-invalidating command.** Same shape as [`AddSessionQuestionAnswerCommand`](#addsessionquestionanswercommand): a write message tagged with the shared `Session` cache prefix. `[Rubric §6, CQRS & Event-Driven]`.
- **Walkthrough**: `sealed record` with three parameters (`AddSessionSpeakerCommand.cs:15-18`): `SessionId`, a nullable `SessionSpeakerId` (null means DB-generated identity), and `SpeakerId`. `CachePrefix` at `:21`.
- **Where it's used**: dispatched by `SessionSpeakersController` ([Group 20](group-20-conference-api-grpc.md#sessionspeakerscontroller)); validated by [`AddSessionSpeakerCommandValidator`](#addsessionspeakercommandvalidator); handled by [`AddSessionSpeakerHandler`](#addsessionspeakerhandler).

### RemoveSessionCategoryItemCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionCategoryItem` · `MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionCategoryItem/RemoveSessionCategoryItemCommand.cs:12` · Level 7 · record

- **What it is**: the command that removes a category-item association (a `SessionCategoryItem` join row) from a session.
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); [`Session`](group-17-conference-domain.md#session); aliases `SessionIdentifierType`, `SessionCategoryItemIdentifierType`.
- **Concept reinforced, the remove-command sub-family.** The three remove commands in this unit are structurally identical: a `sealed record` carrying the owning `SessionId` plus the (non-nullable) id of the join entity to remove, tagged with the shared `Session` cache prefix. Unlike the add commands there is no nullable identity parameter, because a removal always targets an existing row. `[Rubric §6, CQRS & Event-Driven]`.
- **Walkthrough**: two parameters (`RemoveSessionCategoryItemCommand.cs:12-14`): `SessionId`, `SessionCategoryItemId`. `CachePrefix` at `:17`.
- **Where it's used**: dispatched by `SessionCategoryItemsController` ([Group 20](group-20-conference-api-grpc.md#sessioncategoryitemscontroller)); handled by [`RemoveSessionCategoryItemHandler`](#removesessioncategoryitemhandler). Note there is no dedicated remove validator: the id is a required positional parameter and the deeper checks live in the handler and domain.

### RemoveSessionQuestionAnswerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionQuestionAnswer` · `MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionQuestionAnswer/RemoveSessionQuestionAnswerCommand.cs:13` · Level 7 · record

- **What it is**: the command that removes a question answer from a session.
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); [`Session`](group-17-conference-domain.md#session); aliases `SessionIdentifierType`, `SessionQuestionAnswerIdentifierType`.
- **Concept reinforced, remove-command sub-family.** Identical shape to [`RemoveSessionCategoryItemCommand`](#removesessioncategoryitemcommand). The ownership/authorization decision (attendees may delete only their own answers) is not on the message; it lives in [`RemoveSessionQuestionAnswerHandler`](#removesessionquestionanswerhandler).
- **Walkthrough**: two parameters (`RemoveSessionQuestionAnswerCommand.cs:13-15`): `SessionId`, `SessionQuestionAnswerId`. `CachePrefix` at `:18`.
- **Where it's used**: dispatched by `SessionQuestionAnswersController` ([Group 20](group-20-conference-api-grpc.md#sessionquestionanswerscontroller)); handled by [`RemoveSessionQuestionAnswerHandler`](#removesessionquestionanswerhandler).

### RemoveSessionSpeakerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionSpeaker` · `MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionSpeaker/RemoveSessionSpeakerCommand.cs:12` · Level 7 · record

- **What it is**: the command that removes a speaker association (a `SessionSpeaker` join row) from a session.
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); [`Session`](group-17-conference-domain.md#session); aliases `SessionIdentifierType`, `SessionSpeakerIdentifierType`.
- **Concept reinforced, remove-command sub-family.** Identical shape to the two remove commands above. `[Rubric §6, CQRS & Event-Driven]`.
- **Walkthrough**: two parameters (`RemoveSessionSpeakerCommand.cs:12-14`): `SessionId`, `SessionSpeakerId`. `CachePrefix` at `:17`. The `SessionId` is intentionally allowed to arrive as the default value: [`RemoveSessionSpeakerHandler`](#removesessionspeakerhandler) resolves the owning session from the join id alone in that case.
- **Where it's used**: dispatched by `SessionSpeakersController` ([Group 20](group-20-conference-api-grpc.md#sessionspeakerscontroller)); handled by [`RemoveSessionSpeakerHandler`](#removesessionspeakerhandler).

### SessionCreateRequest

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.Create` · `MMCA.ADC.Conference.Application/Sessions/UseCases/Create/SessionCreateRequest.cs:10` · Level 7 · record

- **What it is**: the create-request DTO for a conference session. Unlike the child-add commands, it doubles as the create command itself: it implements [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) so the generic request-mapper pipeline can process it, and [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) so a successful create evicts the session cache.
- **Depends on**: [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest), [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating); [`Session`](group-17-conference-domain.md#session) (cache prefix); aliases `SessionIdentifierType`, `EventIdentifierType`, `RoomIdentifierType`.
- **Concept introduced, the request-as-command DTO and `required`/`init` immutability.** `[Rubric §9, API & Contract Design]` assesses whether the write contract is explicit about which fields a caller must supply; here `Title` (`SessionCreateRequest.cs:19`) and `EventId` (`:63`) are `required`, every other field is optional `init`-only. This is the same immutable-contract idiom the framework uses across create requests: the object is fully assembled at construction and never mutated afterward (the handler produces a copy via `with` when it needs to assign an id).
- **Walkthrough**: a `record class` with 16 properties. `Id` is an `init` `SessionIdentifierType` (`:16`) that defaults to `0` when the caller omits it. Notable are the two URL fields `LiveUrl` (`:47`) and `RecordingUrl` (`:51`), each carrying a targeted `[SuppressMessage("Design", "CA1056:URI-like properties should not be strings")]` with the justification "Stored as string for Sessionize compatibility" inline: Sessionize exports these as opaque strings that need not pass `Uri` validation, so the analyzer rule is suppressed only on those two members. `[Rubric §15, Best Practices & Code Quality]` (justified, narrowly-scoped suppressions rather than a blanket disable).
- **Why it's built this way**: modeling the create request as the command means one DTO flows from the controller through validation, the request mapper, and into the domain factory with no intermediate translation object.
- **Where it's used**: posted to the session create endpoint on `SessionsController` ([Group 20](group-20-conference-api-grpc.md#sessionscontroller)); validated by [`SessionCreateRequestValidator`](#sessioncreaterequestvalidator); mapped to a domain entity by [`SessionCreateRequestMapper`](#sessioncreaterequestmapper); handled by [`CreateSessionHandler`](#createsessionhandler).

### AddSessionQuestionAnswerCommandValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer` · `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionQuestionAnswer/AddSessionQuestionAnswerCommandValidator.cs:8` · Level 8 · class

- **What it is**: a single-rule FluentValidation validator that guards [`AddSessionQuestionAnswerCommand`](#addsessionquestionanswercommand) before the handler runs.
- **Depends on**: FluentValidation's `AbstractValidator<TCommand>` (NuGet).
- **Concept introduced, input validation at the command boundary (the pipeline's first business stage).** `[Rubric §24, Forms, Validation & UX Safety]` assesses whether input is validated before business logic executes. This validator is a `sealed class` with one `RuleFor` (`AddSessionQuestionAnswerCommandValidator.cs:10-13`): `RuleFor(x => x.AnswerValue).NotEmpty().WithMessage("Answer value is required.")`. It is auto-discovered by Scrutor and invoked by the validating decorator in the CQRS pipeline before the matching handler, so the handler can assume a well-formed command. Cheap shape checks live here; the deeper rules (question exists, question targets sessions, answer type matches, session eligibility) need the loaded aggregate and live in the handler and domain instead.
- **Why it's built this way**: separating "is the request well-formed?" (declarative validator) from "is the operation allowed?" (handler and domain invariants) keeps each concern in one place, and the convention scanning means a new command is wired in simply by adding a validator class.
- **Where it's used**: run by the validating command decorator ahead of [`AddSessionQuestionAnswerHandler`](#addsessionquestionanswerhandler).

### AddSessionQuestionAnswerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer` · `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionQuestionAnswer/AddSessionQuestionAnswerHandler.cs:19` · Level 8 · class

- **What it is**: the richest handler in this unit. It adds a question answer to a session, but first enforces a chain of business rules and then performs an upsert (update the caller's existing answer, or create a new one).
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice); [`Result`](group-01-result-error-handling.md#result) and [`Error`](group-01-result-error-handling.md#error); the domain types [`Session`](group-17-conference-domain.md#session), [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer), [`Question`](group-17-conference-domain.md#question), [`Event`](group-17-conference-domain.md#event), and the invariants [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants), [`EventInvariants`](group-17-conference-domain.md#eventinvariants), [`QuestionInvariants`](group-17-conference-domain.md#questioninvariants); the [`SessionQuestionAnswerDTOMapper`](#sessionquestionanswerdtomapper); `Microsoft.Extensions.Logging`.
- **Concept introduced, the guarded, multi-aggregate handler and source-generated logging.** `[Rubric §4, DDD]` assesses whether business rules are enforced through domain invariants rather than scattered ad hoc, and this handler routes each rule through a named invariant helper. `[Rubric §13, Observability & Operability]` assesses structured logging: the `sealed partial class` (`AddSessionQuestionAnswerHandler.cs:19`) plus `[LoggerMessage]` (`:133-134`) emit a zero-allocation, compile-checked log helper, the pattern used by every handler here.
- **Walkthrough**
  - `HandleAsync` (`:26`) loads the session with its `SessionQuestionAnswers` navigation tracked (`:31-35`); a missing session returns `Error.NotFound` (`:37`).
  - `ValidateSessionEligibilityAsync` (`:60`) enforces three rules in order: BR-91 (service sessions cannot receive feedback, via `SessionInvariants.EnsureNotServiceSession`, `:65`), BR-49 (only accepted/null-status sessions are eligible, via `SessionInvariants.EnsureStatusIsEligible`, `:70`), and BR-108 (the parent event must be published: it loads the [`Event`](group-17-conference-domain.md#event) through a second repository and calls `EventInvariants.EnsureEventIsPublished`, `:75-80`).
  - `ValidateQuestionAsync` (`:83`) enforces BR-128 (the question must exist and its `QuestionEntity` must equal `"Session"`, `:89-97`) and BR-124 (the answer value must match the question type, via `QuestionInvariants.EnsureAnswerValueMatchesQuestionType`, `:100-101`).
  - The upsert (BR-107, `:49-57`): it looks for an existing non-deleted answer by the same `(CreatedBy, QuestionId)` for the current user (`:51-52`). If found, `UpdateExistingAnswerAsync` (`:104`) delegates to `session.UpdateSessionQuestionAnswer(...)`; otherwise `CreateNewAnswerAsync` (`:119`) delegates to `session.AddSessionQuestionAnswer(...)`. Either way it saves through the unit of work, logs, and returns the DTO.
- **Why it's built this way**: the handler orchestrates but never re-implements a rule: every check is a call into a domain invariant or an aggregate method, so the enforcement is testable in isolation and reused across handlers. Loading the parent `Event` inside the handler (rather than crossing an aggregate boundary in the domain) keeps `Session` and `Event` as separate aggregates.
- **Where it's used**: registered by the Conference application DI scan; invoked by the CQRS pipeline for `SessionQuestionAnswersController` posts ([Group 20](group-20-conference-api-grpc.md#sessionquestionanswerscontroller)).

### AddSessionSpeakerCommandValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker` · `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionSpeaker/AddSessionSpeakerCommandValidator.cs:8` · Level 8 · class

- **What it is**: a single-rule FluentValidation validator for [`AddSessionSpeakerCommand`](#addsessionspeakercommand).
- **Depends on**: FluentValidation's `AbstractValidator<TCommand>`.
- **Concept reinforced, command-boundary validation.** Same shape as [`AddSessionQuestionAnswerCommandValidator`](#addsessionquestionanswercommandvalidator). Its one rule (`AddSessionSpeakerCommandValidator.cs:10-13`) is `RuleFor(x => x.SpeakerId).NotEqual(default(SpeakerIdentifierType)).WithMessage("Speaker ID is required.")`, a guard that the speaker id is present. `[Rubric §24, Forms, Validation & UX Safety]`.
- **Where it's used**: run by the validating decorator ahead of [`AddSessionSpeakerHandler`](#addsessionspeakerhandler).

### AddSessionSpeakerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker` · `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionSpeaker/AddSessionSpeakerHandler.cs:16` · Level 8 · class

- **What it is**: the handler that adds a speaker association to a session. It is the clean "load aggregate, call domain method, save" template, without the extra business guards that [`AddSessionQuestionAnswerHandler`](#addsessionquestionanswerhandler) carries.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error); [`Session`](group-17-conference-domain.md#session), [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker); [`SessionSpeakerDTOMapper`](#sessionspeakerdtomapper); `Microsoft.Extensions.Logging`.
- **Concept introduced, the load-aggregate then delegate mutation template.** `[Rubric §5, Vertical Slice]` assesses whether each write is a thin, self-contained slice; this handler is the canonical one. `HandleAsync` (`AddSessionSpeakerHandler.cs:22`) gets the repository, loads the session with its `SessionSpeakers` navigation tracked (`:27`), returns `Error.NotFound` when absent (`:29`), delegates to `session.AddSessionSpeaker(command.SessionSpeakerId, command.SpeakerId)` (`:31`), and on success saves through the unit of work with `ConfigureAwait(false)` (`:35`), logs via the generated `[LoggerMessage]` helper (`:37`, `:42-43`), and returns the mapped [`SessionSpeakerDTO`](group-17-conference-domain.md#sessionspeakerdto). The aggregate, not the handler, owns the invariant of whether the speaker may be added.
- **Why it's built this way**: pushing the domain decision into `Session.AddSessionSpeaker` keeps the handler as pure orchestration, so the same shape recurs across the module and the interesting rules stay unit-testable on the aggregate.
- **Where it's used**: invoked by the CQRS pipeline for `SessionSpeakersController` posts ([Group 20](group-20-conference-api-grpc.md#sessionspeakerscontroller)).

### RemoveSessionCategoryItemHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionCategoryItem` · `MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionCategoryItem/RemoveSessionCategoryItemHandler.cs:13` · Level 8 · class

- **What it is**: the handler that removes a category-item association from a session. The simplest of the three remove handlers.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error); [`Session`](group-17-conference-domain.md#session), [`SessionCategoryItem`](group-17-conference-domain.md#sessioncategoryitem); `Microsoft.Extensions.Logging`.
- **Concept reinforced, the load then delegate mutation template, returning bare `Result`.** Unlike the add handlers, the remove handlers return a non-generic [`Result`](group-01-result-error-handling.md#result) (no DTO). `HandleAsync` (`RemoveSessionCategoryItemHandler.cs:18`) loads the session with its `SessionCategoryItems` tracked (`:23-27`), returns `Error.NotFound` when absent (`:29`), delegates to `entity.RemoveSessionCategoryItem(command.SessionCategoryItemId)` (`:31`), and only on `IsSuccess` saves and logs (`:32-36`). `[Rubric §5, Vertical Slice]`.
- **Why it's built this way**: the save is conditional on the domain method succeeding, so a rejected removal (for example, a child that does not exist on the aggregate) never opens a needless write.
- **Where it's used**: invoked for `SessionCategoryItemsController` deletes ([Group 20](group-20-conference-api-grpc.md#sessioncategoryitemscontroller)).

### RemoveSessionQuestionAnswerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionQuestionAnswer` · `MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionQuestionAnswer/RemoveSessionQuestionAnswerHandler.cs:14` · Level 8 · class

- **What it is**: the handler that removes a question answer from a session, with an ownership check layered on top of the standard remove template.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) and [`RoleNames`](group-08-auth.md#rolenames); [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error); [`Session`](group-17-conference-domain.md#session), [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer); `Microsoft.Extensions.Logging`.
- **Concept introduced, inline resource-ownership authorization (BR-52/BR-53).** `[Rubric §11, Security]` assesses whether authorization is enforced per operation, not just at the route. After loading the session with its `SessionQuestionAnswers` tracked (`RemoveSessionQuestionAnswerHandler.cs:25-29`), the handler finds the target answer (`:34`) and, if the caller is not in the [`RoleNames.Organizer`](group-08-auth.md#rolenames) role and did not create it (`answer.CreatedBy != currentUserService.UserId!.Value`), returns `Error.Forbidden` with code `"SessionQuestionAnswer.NotOwner"` (`:35-42`). Organizers may delete any answer; attendees only their own. Only then does it delegate to `entity.RemoveSessionQuestionAnswer(...)` (`:44`) and conditionally save and log.
- **Why it's built this way**: the ownership rule depends on the current user identity, which is an application concern, so it sits in the handler rather than the aggregate; returning `Forbidden` (403) keeps the semantics distinct from a plain not-found.
- **Where it's used**: invoked for `SessionQuestionAnswersController` deletes ([Group 20](group-20-conference-api-grpc.md#sessionquestionanswerscontroller)).

### RemoveSessionSpeakerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionSpeaker` · `MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionSpeaker/RemoveSessionSpeakerHandler.cs:13` · Level 8 · class

- **What it is**: the handler that removes a speaker association from a session, with an id-resolution twist to accommodate the generic delete UI.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error); [`Session`](group-17-conference-domain.md#session), [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker); `Microsoft.Extensions.Logging`.
- **Concept introduced, resolving the owning aggregate from a child id.** `[Rubric §9, API & Contract Design]` assesses tolerance for how callers actually shape requests. The DELETE endpoint takes the session id as an optional query parameter, but the UI's generic delete sends only the join-entity id, so `SessionId` can arrive as the default. When `command.SessionId == default` (`RemoveSessionSpeakerHandler.cs:28`), the handler queries for the session whose `SessionSpeakers` contains the given join id (`GetAllAsync` with a `where` predicate, `:30-35`); otherwise it loads by id directly (`:39-43`). Both paths converge: `Error.NotFound` when unresolved (`:47`), delegate to `entity.RemoveSessionSpeaker(...)` (`:49`), then conditionally save and log.
- **Why it's built this way**: accepting a bare child id avoids forcing the client to know the parent, while still loading the tracked aggregate so the removal runs through the domain method rather than a raw delete. This mirrors a category-item delete bug the codebase previously fixed, where a child id was mis-bound.
- **Where it's used**: invoked for `SessionSpeakersController` deletes ([Group 20](group-20-conference-api-grpc.md#sessionspeakerscontroller)).

### SessionCreateRequestMapper

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.Create` · `MMCA.ADC.Conference.Application/Sessions/UseCases/Create/SessionCreateRequestMapper.cs:11` · Level 8 · class

- **What it is**: the bridge that turns a [`SessionCreateRequest`](#sessioncreaterequest) into a [`Session`](group-17-conference-domain.md#session) domain entity by delegating to the domain factory.
- **Depends on**: [`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype); [`Session`](group-17-conference-domain.md#session); [`Result`](group-01-result-error-handling.md#result); BCL `ArgumentNullException`, `Task`.
- **Concept introduced, the request mapper as the only caller of the domain factory.** `[Rubric §4, DDD]` assesses whether entities are constructed only through validated factories. This `sealed class` implements `IEntityRequestMapper<Session, SessionCreateRequest, SessionIdentifierType>` and its `CreateEntityAsync` (`SessionCreateRequestMapper.cs:15`) does exactly one thing: guard against a null request (`:17`) then return `Session.Create(...)` with the request fields mapped positionally into the factory (`:19-33`). It returns the factory's `Result<Session>` directly, so any invariant failure surfaces as a failed result rather than an exception.
- **Why it's built this way**: keeping the request-to-entity translation in a dedicated mapper means the handler ([`CreateSessionHandler`](#createsessionhandler)) never touches `Session.Create` directly, so the create pipeline (validate, map, persist) stays uniform across every entity in the framework. This is manual mapping rather than a generated mapper (ADR-001).
- **Where it's used**: injected into [`CreateSessionHandler`](#createsessionhandler) as the `IEntityRequestMapper<Session, SessionCreateRequest, SessionIdentifierType>` dependency.

### SessionCreateRequestValidator

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.Create` · `MMCA.ADC.Conference.Application/Sessions/UseCases/Create/SessionCreateRequestValidator.cs:7` · Level 8 · class

- **What it is**: the FluentValidation validator for [`SessionCreateRequest`](#sessioncreaterequest). Unlike the single-rule add-command validators, it composes reusable rule sets rather than declaring rules inline.
- **Depends on**: FluentValidation's `AbstractValidator<T>` and its `Include`; the reusable rule includes [`SessionTitleRules<T>`](#sessiontitlerulest) and [`SessionEventIdRules<T>`](#sessioneventidrulest).
- **Concept introduced, shared validation rule sets via `Include`.** `[Rubric §24, Forms, Validation & UX Safety]` assesses validation coverage and reuse. Rather than re-writing the title and event-id rules on every session request type, the validator composes them: its constructor (`SessionCreateRequestValidator.cs:9-13`) calls `Include(new SessionTitleRules<SessionCreateRequest>(p => p.Title))` and `Include(new SessionEventIdRules<SessionCreateRequest>(p => p.EventId))`, projecting each request property into a generic rule set. The same rule sets are reused by the session update request validator, so a change to how a session title is validated lands in one place.
- **Why it's built this way**: factoring the field rules into parameterized rule sets keeps a single source of truth for each field's constraints across create and update, mirroring how the domain invariants centralize the same limits.
- **Where it's used**: run by the validating command decorator ahead of [`CreateSessionHandler`](#createsessionhandler).

### CreateSessionHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.Create` · `MMCA.ADC.Conference.Application/Sessions/UseCases/Create/CreateSessionHandler.cs:16` · Level 9 · class

- **What it is**: the command handler for session creation. It assigns an id when the caller omits one, delegates entity construction to the request mapper, persists the new session, and returns the mapped DTO. Because [`SessionCreateRequest`](#sessioncreaterequest) is itself the command, this handler implements `ICommandHandler<SessionCreateRequest, Result<SessionDTO>>`.
- **Depends on**: [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork); [`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](group-12-api-hosting-mapping.md#ientityrequestmappertentity-tcreaterequest-tidentifiertype); [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error); [`Session`](group-17-conference-domain.md#session) and [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants); [`SessionDTO`](group-17-conference-domain.md#sessiondto) and [`SessionDTOMapper`](#sessiondtomapper); `Microsoft.Extensions.Logging`.
- **Concept introduced, application-assigned ids within a reserved manual range.** `[Rubric §8, Data Architecture]` assesses id allocation and collision avoidance. Session ids are app-assigned (the integer primary key is the Sessionize id), so when the caller supplies no id (`command.Id == default`, `CreateSessionHandler.cs:32`) the handler must mint one that cannot collide with a Sessionize-assigned id. It loads existing sessions in the reserved manual range (`SessionInvariants.ManualIdRangeStart` .. `ManualIdRangeEnd`, with `ignoreQueryFilters: true` so soft-deleted rows still count, `:34-38`), takes `Max + 1` or the range start when none exist (`:40-42`), fails with `Error.Failure` if the range is exhausted (`:44-45`), and rewrites the command via `command = command with { Id = nextId }` (`:47`). An explicit id is respected untouched.
- **Walkthrough**
  - Primary constructor (`:16-20`): [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), the `IEntityRequestMapper<Session, SessionCreateRequest, SessionIdentifierType>`, a [`SessionDTOMapper`](#sessiondtomapper), and `ILogger<CreateSessionHandler>`.
  - `HandleAsync` (`:23`): resolve the id (above), then `requestMapper.CreateEntityAsync(command, ct)` produces the `Result<Session>` from the domain factory (`:50`); early-return on failure (`:51-52`).
  - Persist: `repository.AddAsync(entity, ct)` then `unitOfWork.SaveChangesAsync(ct)`, both with `ConfigureAwait(false)` (`:56-57`).
  - Log via the generated `[LoggerMessage]` partial (`:59`, `:64-65`) and return `Result.Success(dtoMapper.MapToDTO(entity))` (`:61`).
  - Validation is not called here: it runs earlier in the pipeline via the validating decorator and [`SessionCreateRequestValidator`](#sessioncreaterequestvalidator), so by the time `HandleAsync` executes the request is already well-formed.
- **Why it's built this way**: delegating construction to the mapper keeps the handler ignorant of `Session.Create`'s signature; its only jobs are id allocation, persistence, and DTO projection. `[Rubric §5, Vertical Slice]`: the file is one self-contained slice of the create flow and crosses no aggregate boundary.
- **Where it's used**: registered by the Conference application DI scan; injected into `SessionsController` ([Group 20](group-20-conference-api-grpc.md#sessionscontroller)).
- **Caveats / not-in-source**: the concrete values of `SessionInvariants.ManualIdRangeStart` / `ManualIdRangeEnd` are defined on `SessionInvariants` in the domain layer, not in this file; see [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants).

### UpdateSessionQuestionAnswerCommand

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.UpdateSessionQuestionAnswer` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/UpdateSessionQuestionAnswer/UpdateSessionQuestionAnswerCommand.cs:15` · Level 7 · record

- **What it is**: the immutable command that carries the intent "change the text of one existing answer on a session's questions." A three-value payload: the owning session, the answer to change, and the new answer text (`UpdateSessionQuestionAnswerCommand.cs:15-18`).
- **Depends on**: [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) (the marker it implements), the `SessionIdentifierType` and `SessionQuestionAnswerIdentifierType` module aliases, and the [`Session`](group-17-conference-domain.md#session) domain type (referenced only to derive a cache key, not a runtime dependency).
- **Concept introduced: a command as a cache-invalidation trigger.** [Rubric §6, CQRS & Event-Driven] assesses whether writes and reads are cleanly separated and whether write-side effects (like cache eviction) are declared rather than hand-wired. This command declares nothing about *how* it runs; it just states its shape and, by implementing [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating), tells the caching decorator which cache region to purge on success. The `CachePrefix` property (`UpdateSessionQuestionAnswerCommand.cs:21`) computes `"{typeof(Session).FullName}:"`, so the whole `Session` cache namespace is evicted whenever an answer is edited. [Rubric §12, Performance & Scalability]: read endpoints are output-cached, so a mutation must actively evict, otherwise stale answer text would survive the cache TTL.
- **Walkthrough**: a `sealed record` with a positional constructor (`SessionId`, `SessionQuestionAnswerId`, `AnswerValue`) and a single computed `CachePrefix` expression member (`.cs:21`). No behavior, no validation here; validation lives in a sibling FluentValidation validator and the ownership check lives in the handler.
- **Why it's built this way**: records give structural equality and immutability for free (see [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)); the command is a pure data contract routed through the [decorator pipeline](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult). Making cache invalidation a *marker interface* rather than handler code keeps the eviction policy declarative and testable.
- **Where it's used**: dispatched by the `SessionsController` update-answer endpoint; handled by [`UpdateSessionQuestionAnswerHandler`](#updatesessionquestionanswerhandler).

### DeleteEventHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events.UseCases.Delete` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/UseCases/Delete/DeleteEventHandler.cs:16` · Level 8 · class (sealed partial)

- **What it is**: a *custom* delete handler that overrides the framework's generic delete for [`Event`](group-17-conference-domain.md#event), because deleting an event must cascade soft-delete to its [`Session`](group-17-conference-domain.md#session) aggregates, which the generic handler cannot reach.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IEventCascadeDeletionDomainService`](group-17-conference-domain.md#ieventcascadedeletiondomainservice) (Domain), [`Event`](group-17-conference-domain.md#event), [`Session`](group-17-conference-domain.md#session), [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype), [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error), and `ILogger`.
- **Concept introduced: a cross-aggregate cascade orchestrated in the application layer via a domain service.** [Rubric §4, DDD] assesses whether invariants and consistency boundaries live inside the domain. An `Event.Delete()` already cascades to its *owned* children (rooms, event speakers, event answers, BR-72) because those are inside the aggregate, but [`Session`](group-17-conference-domain.md#session) is a *separate* aggregate, so BR-127's session cascade cannot live inside `Event.Delete()`. The handler therefore loads both aggregate graphs and hands the *decision* to a domain service. [Rubric §6, CQRS & Event-Driven]: a single write path, one `SaveChanges`, one transaction.
- **Walkthrough**: resolves the event repository and loads the event with its owned children (`DeleteEventHandler.cs:26-31`); returns [`Error.NotFound`](group-01-result-error-handling.md#error) if missing (`.cs:32-33`). It then loads all live sessions for that event, including their own children, filtered by `EventId` and `!IsDeleted` (`.cs:36-41`). Both graphs go to `eventCascadeDeletionDomainService.CascadeDelete(entity, sessions)` (`.cs:44`), which soft-deletes the sessions then the event; on success it saves once and logs via the source-generated `LogEventDeleted` (`.cs:47-48`, `.cs:54-55`).
- **Why it's built this way**: the *what cascades* is domain logic (hence the domain service), while the *loading of two aggregates* is an application/repository concern (hence the handler). It registers under the same `ICommandHandler<DeleteEntityCommand<Event, EventIdentifierType>, Result>` key the base controller's delete slot expects, transparently replacing the generic handler. Atomicity (one `SaveChangesAsync`) keeps the cascade all-or-nothing.
- **Where it's used**: invoked by the `EventsController` delete endpoint; discovered and registered via Scrutor, overriding the generic delete handler for `Event`.

### EventLiveValidationService

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/EventLiveValidationService.cs:18` · Level 8 · class (sealed)

- **What it is**: the Conference-side implementation of [`IEventLiveValidationService`](group-17-conference-domain.md#ieventlivevalidationservice), the read-model the Engagement live layer calls (in-process, or over gRPC when the modules run as separate services) to learn an event's published flag and its live window in UTC, and to resolve a session's live eligibility, assigned speakers, plenum flag, and moderation default.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`Event`](group-17-conference-domain.md#event), [`Session`](group-17-conference-domain.md#session), [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants), the [`EventLiveInfo`](group-17-conference-domain.md#eventliveinfo)/[`SessionLiveInfo`](group-17-conference-domain.md#sessionliveinfo) result records, [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error), and the BCL `TimeZoneInfo`.
- **Concept introduced: a cross-module query service with time-zone-correct window math.** [Rubric §7, Microservices Readiness] assesses whether one module can answer another's questions through a narrow interface rather than a shared database; Engagement never touches Conference's tables, it calls this service. The live window is computed the same way the home-page countdown decides the "Live" phase: start is `StartDate` at local midnight, end (exclusive) is `EndDate + 1 day` at local midnight, both converted from the event's IANA time zone to UTC (`EventLiveValidationService.cs:99-114`). [Rubric §29, Resilience]: `ComputeLiveWindowUtc` catches `TimeZoneNotFoundException` and falls back to treating the stored local times as UTC for legacy rows rather than failing the call (`.cs:109-114`), even though `EventInvariants` guards writes.
- **Walkthrough**
  - `GetEventLiveInfoAsync` (`.cs:21-41`) loads the event read-only, returns [`Error.NotFound`](group-01-result-error-handling.md#error) if missing, computes the window, and wraps `(IsPublished, startUtc, endUtc)` in an [`EventLiveInfo`](group-17-conference-domain.md#eventliveinfo).
  - `GetSessionLiveInfoAsync` (`.cs:44-97`) loads the session with its speakers, then applies the bookmark-eligibility rules through [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants): `EnsureNotServiceSession` (BR-91) and `EnsureStatusIsEligible` (BR-49) (`.cs:63-69`). It then loads the owning event for the window, collects the non-deleted `SpeakerId`s (`.cs:86-87`), and returns a [`SessionLiveInfo`](group-17-conference-domain.md#sessionliveinfo) carrying the event id, published flag, window, speaker ids, plenum flag, and the event's `QuestionModerationDefault` (BR-233/BR-236) (`.cs:89-96`).
- **Why it's built this way**: the live layer needs a small, purpose-built projection, not the full `Event`/`Session` aggregates, and it must not reach across the module boundary into Conference's data. Encapsulating the window math here keeps one source of truth for "when is this event live," reused by both query methods and (by intent) the UI countdown.
- **Where it's used**: consumed by the Engagement module's live-layer handlers; served over gRPC by the Conference service's contracts adapter when the two modules run as separate hosts.

### SessionBookmarkValidationService

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/SessionBookmarkValidationService.cs:12` · Level 8 · class (sealed)

- **What it is**: the Conference-side implementation of [`ISessionBookmarkValidationService`](group-17-conference-domain.md#isessionbookmarkvalidationservice), which the Engagement bookmark flow calls to confirm a session is *eligible* to be bookmarked (and to list a session-id set for an event).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`Session`](group-17-conference-domain.md#session), [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants), [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error).
- **Concept reinforced: narrow cross-module validation service.** This is the sibling of [`EventLiveValidationService`](#eventlivevalidationservice): a small interface Conference implements so Engagement can enforce a Conference rule without touching Conference data (see [Rubric §7, Microservices Readiness] above). The rules it enforces are exactly the two bookmark invariants: no service sessions (BR-91) and only Accepted/null-status sessions (BR-49), delegated to [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants) so the rule text lives in one place (`SessionBookmarkValidationService.cs:32-38`). [Rubric §4, DDD]: the eligibility rule is a domain invariant, not scattered `if` logic.
- **Walkthrough**
  - `ValidateSessionForBookmarkAsync` (`.cs:15-39`) loads the session read-only, returns [`Error.NotFound`](group-01-result-error-handling.md#error) if missing, then returns the [`Result`](group-01-result-error-handling.md#result) of the service-session check (BR-91) and, if that passes, the status check (BR-49).
  - `GetSessionIdsByEventAsync` (`.cs:42-54`) loads all sessions for an event (read-only) and projects their ids, used by Engagement to scope a user's bookmarks to one event.
- **Why it's built this way**: the bookmark write lives in Engagement, but "can this session be bookmarked" is a Conference decision. Publishing it as an interface keeps the boundary honest and lets the same call satisfy both the in-process and gRPC topologies.
- **Where it's used**: consumed by the Engagement bookmark create handler; served over gRPC by the Conference contracts adapter across process boundaries.

### UpdateSessionQuestionAnswerHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Sessions.UseCases.UpdateSessionQuestionAnswer` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/UpdateSessionQuestionAnswer/UpdateSessionQuestionAnswerHandler.cs:14` · Level 8 · class (sealed partial)

- **What it is**: the command handler that applies an [`UpdateSessionQuestionAnswerCommand`](#updatesessionquestionanswercommand): it enforces answer ownership, then mutates the answer text through the [`Session`](group-17-conference-domain.md#session) aggregate.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), [`RoleNames`](group-08-auth.md#rolenames), [`Session`](group-17-conference-domain.md#session) / [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer), [`Result`](group-01-result-error-handling.md#result)/[`Error`](group-01-result-error-handling.md#error), and `ILogger`.
- **Concept introduced: application-layer authorization inside a handler (owner-or-role).** [Rubric §11, Security] assesses whether authorization is enforced at the right layer with the right data. Field-level "you can only edit your own answer" cannot be expressed by a route policy alone, it needs the loaded row's `CreatedBy`. The handler loads the session with its answers, finds the target answer, and if the caller is *not* an [`RoleNames.Organizer`](group-08-auth.md#rolenames) and is not the answer's creator, returns [`Error.Forbidden`](group-01-result-error-handling.md#error) with code `SessionQuestionAnswer.NotOwner` (BR-52/BR-53) (`UpdateSessionQuestionAnswerHandler.cs:33-42`). [Rubric §4, DDD]: the actual text change is delegated to the aggregate's `UpdateSessionQuestionAnswer` method (`.cs:44`), keeping the invariant inside the model.
- **Walkthrough**: resolves the `Session` repository and loads the aggregate *with* its answers, tracked (`.cs:24-29`); `Error.NotFound` if absent (`.cs:30-31`). It finds the non-deleted answer by id (`.cs:34`), runs the owner-or-Organizer check (`.cs:35-42`), then calls `entity.UpdateSessionQuestionAnswer(...)` (`.cs:44`); on success it saves once and logs via the source-generated `LogSessionQuestionAnswerUpdated` (`.cs:45-48`).
- **Why it's built this way**: ownership authorization needs the persisted `CreatedBy`, so it belongs in the handler after the load, not in a route filter. Routing the mutation through the aggregate keeps validation (empty text, existence of the answer) centralized. The command's [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) marker means the caching decorator evicts the `Session` cache after this handler returns success.
- **Where it's used**: registered as `ICommandHandler<UpdateSessionQuestionAnswerCommand, Result>`; invoked by the `SessionsController` update-answer endpoint through the [decorator pipeline](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult).

### UserRegisteredHandler

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Users.IntegrationEventHandlers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Users/IntegrationEventHandlers/UserRegisteredHandler.cs:39` · Level 8 · class (sealed partial)

- **What it is**: the Conference-side subscriber to Identity's [`UserRegistered`](group-24-identity-module.md#userregistered) integration event; it auto-links a newly-registered user to a matching [`Speaker`](group-17-conference-domain.md#speaker) (BR-207).
- **Depends on**: `IServiceScopeFactory` (per-event DI scope), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`IIntegrationEventPublisher`](group-04-events-outbox.md#iintegrationeventpublisher), [`IIntegrationEventHandler<in TIntegrationEvent>`](group-04-events-outbox.md#iintegrationeventhandlerin-tintegrationevent), [`Speaker`](group-17-conference-domain.md#speaker), the [`Email`](group-02-domain-building-blocks.md#email) value object, [`SpeakerLinkedToUser`](group-17-conference-domain.md#speakerlinkedtouser), and `ILogger`.
- **Concept introduced: the integration-event *consumer*, scoped DI for a singleton handler, and idempotent eventual consistency.** [Rubric §6, CQRS & Event-Driven] assesses reliable, idempotent consumers that carry enough context. It implements [`IIntegrationEventHandler<UserRegistered>`](group-04-events-outbox.md#iintegrationeventhandlerin-tintegrationevent) (a singleton by framework convention), so it cannot hold a scoped [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) directly; it opens `scopeFactory.CreateAsyncScope()` per event (`UserRegisteredHandler.cs:53`) and resolves scoped services inside. [Rubric §29, Resilience]: the whole body is wrapped in a best-effort `try/catch` (`.cs:109-114`) so a failure never propagates back through the broker, because the user-registration transaction has already committed; at-least-once delivery means it may re-run, and the "already linked to this user" early-return (`.cs:82-88`) makes re-delivery idempotent.
- **Walkthrough**: two match strategies, tried in order (`.cs:59-65`): `TryMatchByEmailAsync` (`.cs:117-139`) builds an [`Email`](group-02-domain-building-blocks.md#email) value object (which normalizes to lowercase, so `HasConversion` equality is effectively case-insensitive) and looks up a speaker by email; then `TryMatchByNameAsync` (`.cs:141-177`) is a unique-name fallback for Sessionize-imported speakers whose `Email` is always null (the public Sessionize endpoint omits PII), matching case-insensitively on `FirstName + LastName` and linking only when exactly ONE unlinked candidate exists (`.cs:170-173`), so an ambiguous name collision is skipped. On a hit it guards against a speaker already linked to a different user (`.cs:74-78`), publishes [`SpeakerLinkedToUser`](group-17-conference-domain.md#speakerlinkedtouser) and returns if already linked to this user (`.cs:82-88`), otherwise calls `speaker.LinkUser(...)` (`.cs:90`), saves, and publishes the back-link event so Identity can set `User.LinkedSpeakerId` (`.cs:100-105`).
- **Why it's built this way**: ADR-003 (outbox + at-least-once) demands idempotent, crash-tolerant consumers; the scope-per-event pattern is the standard way a singleton event handler uses scoped EF state. The name fallback exists specifically because the public Sessionize endpoint omits PII, so email matching cannot cover imported speakers. The link is eventually consistent: a brand-new user's first token lacks the `speaker_id` claim; it appears on the next refresh after this handler completes.
- **Where it's used**: registered as a broker consumer in the Conference service host; fed by Identity's registration flow through the outbox and broker.

### SpeakerEntityQueryService

> MMCA.ADC.Conference.Application · `MMCA.ADC.Conference.Application.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/SpeakerEntityQueryService.cs:15` · Level 9 · class (sealed)

- **What it is**: a thin concrete subclass of [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype) specialized for [`Speaker`](group-17-conference-domain.md#speaker); its one addition is a property map so API consumers can sort or filter on the computed `FullName` DTO field.
- **Depends on**: [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype) (the base), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), [`INavigationMetadataProvider`](group-03-querying-specifications.md#inavigationmetadataprovider), [`IEntityQueryPipeline`](group-03-querying-specifications.md#ientityquerypipeline), [`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity), the `SpeakerDTOMapper`, and the [`SpeakerDTO`](group-17-conference-domain.md#speakerdto) shape.
- **Concept introduced: the `DTOToEntityPropertyMap` override for computed/compound sort fields.** [Rubric §12, Performance & Scalability] assesses whether sort/filter translate to server-side SQL rather than in-memory work. The base exposes a `protected virtual` `DTOToEntityPropertyMap`; this subclass overrides it (`SpeakerEntityQueryService.cs:34`) with a static dictionary mapping `SpeakerDTO.FullName` to the EF-queryable expression `(FirstName + " " + LastName)` (`.cs:28-31`), which the query pipeline renders into the correct `ORDER BY` / `WHERE` fragment. Without the mapping, sorting by `FullName` would fail because no entity property with that name exists. [Rubric §9, API & Contract Design]: stable DTO field names are decoupled from internal entity structure.
- **Walkthrough**: passes all five collaborators to the base constructor (`.cs:15-22`); declares a `private static readonly IReadOnlyDictionary<string, string> PropertyMap` evaluated once at class load (`.cs:28-31`); overrides `DTOToEntityPropertyMap => PropertyMap` (`.cs:34`). No other members.
- **Why it's built this way**: keeping the map `static readonly` computes it once per app domain, not per request. Making this a thin concrete subclass (rather than registering the base directly) is the DI hook: the container binds `IEntityQueryService<Speaker, SpeakerDTO, SpeakerIdentifierType>` to this type, giving the query stack the non-default map.
- **Where it's used**: registered as `IEntityQueryService<Speaker, SpeakerDTO, SpeakerIdentifierType>` in the Conference Application DI; injected into the `SpeakersController` read endpoints.

### ConferenceCategoryNavigationPopulator, EventNavigationPopulator, SessionNavigationPopulator, SpeakerNavigationPopulator

> MMCA.ADC.Conference.Application · Level 10 · class (sealed)

| Type | File:Line | Children loaded |
|------|-----------|-----------------|
| `ConferenceCategoryNavigationPopulator` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/ConferenceCategoryNavigationPopulator.cs:11` | `CategoryItems` (one collection) |
| `EventNavigationPopulator` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/EventNavigationPopulator.cs:11` | `Rooms`, `EventSpeakers`, `EventQuestionAnswers` (three collections) |
| `SessionNavigationPopulator` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/SessionNavigationPopulator.cs:12` | `SessionSpeakers`, `SessionQuestionAnswers`, `SessionCategoryItems` (three collections) |
| `SpeakerNavigationPopulator` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/SpeakerNavigationPopulator.cs:11` | `SpeakerCategoryItems`, `SpeakerQuestionAnswers` (two collections) |

- **What they are**: the four entity-specific navigation populators for the Conference aggregates ([`Category`](group-17-conference-domain.md#category), [`Event`](group-17-conference-domain.md#event), [`Session`](group-17-conference-domain.md#session), [`Speaker`](group-17-conference-domain.md#speaker)). Each takes an [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) via its primary constructor and passes it, alongside a typed array of [`ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>`](group-11-navigation-populators.md#childnavigationdescriptortentity-tparentid-tchild-tchildid), to the [`DeclarativeNavigationPopulator<TEntity>`](group-11-navigation-populators.md#declarativenavigationpopulatortentity) base.
- **Concept reinforced: declarative navigation descriptors (ADR-002).** The mechanism (bulk-fetch children by foreign key, group by parent, assign back through the aggregate) is introduced in [`DeclarativeNavigationPopulator<TEntity>`](group-11-navigation-populators.md#declarativenavigationpopulatortentity) and [`ChildNavigationDescriptor`](group-11-navigation-populators.md#childnavigationdescriptortentity-tparentid-tchild-tchildid). The job here is purely *configuration*: name the aggregate this populator manages and list its child navigations. [Rubric §2, Design Patterns]: this is Template Method, except the "subclass" supplies data through a constructor-argument list rather than overriding virtual methods. [Rubric §3, Clean Architecture]: the application layer takes no EF namespace dependency; the descriptors drive repository queries, not EF `Include`.
- **Walkthrough**: each constructor has the same shape; taking `SessionNavigationPopulator` (three children, `SessionNavigationPopulator.cs:12-37`) as the richest example, every [`ChildNavigationDescriptor`](group-11-navigation-populators.md#childnavigationdescriptortentity-tparentid-tchild-tchildid) initializer supplies four members:
  - `PropertyName`, the property-name string (`nameof(Session.SessionSpeakers)`, etc.) the base uses to build navigation metadata and mark the property populated.
  - `ParentKeySelector`, `e => e.Id`, the parent aggregate's key, used to group fetched child rows by parent.
  - `ChildForeignKeySelector`, `child => child.SessionId` (or `CategoryId`, `SpeakerId`, `EventId`), the child's foreign-key column matching children to parents.
  - `AssignAction`, `(e, items) => e.SetSessionSpeakers(items)` and siblings, handing the loaded children back through the aggregate's own setter, so the domain model (not infrastructure) owns the assignment.

  `ConferenceCategoryNavigationPopulator` declares one descriptor (`ConferenceCategoryNavigationPopulator.cs:11-24`), `EventNavigationPopulator` three (`EventNavigationPopulator.cs:11-38`), `SessionNavigationPopulator` three (`SessionNavigationPopulator.cs:12-39`), and `SpeakerNavigationPopulator` two (`SpeakerNavigationPopulator.cs:11-31`).
- **Why they're built this way**: ADR-002 mandates that the application layer control eager-loading without an EF dependency. The base provides the generic machinery; these four classes are the entity-specific bindings. One file per aggregate keeps each populator small and locatable by convention (colocated with the aggregate's use-cases folder).
- **Where they're used**: registered as `INavigationPopulator<Speaker>`/`<Event>`/`<Session>`/`<Category>` in the Conference Application DI; injected into the matching entity query services (for example [`SpeakerEntityQueryService`](#speakerentityqueryservice)) and any handler that reads an aggregate with children.


---
[⬅ ADC Conference - Domain Model & Module Contracts](group-17-conference-domain.md)  •  [Index](00-index.md)  •  [ADC Conference - Infrastructure & Persistence ➡](group-19-conference-infrastructure.md)
