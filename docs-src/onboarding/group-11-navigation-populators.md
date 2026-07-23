# 11. Navigation Metadata & Populators (EF-decoupled eager loading)

EF Core gives you `.Include()` for eager loading, and for a single SQL Server database that is the
right tool. But this codebase is a **database-per-service** modular monolith (ADR-006): two related
entities can live in **different physical data sources**, different SQL databases, or a Cosmos
container that has no JOINs at all, and across that boundary EF's `Include` simply cannot produce a
JOIN. The relationship is real in the domain model, but the physical storage cannot satisfy it in one
query. This chapter is the framework's answer to that gap: a small, self-contained subsystem that
decides *which* navigations EF can load and *which* must be hand-loaded, then batch-loads the latter
without ever leaking EF or the physical split into the Application or Domain layers. It is the
machinery behind **ADR-002 (navigation populators)**, and it sits directly underneath the query
pipeline taught in [Group 03](group-03-querying-specifications.md).

The whole feature turns on one piece of metadata you author in the **Domain** layer and one piece the
framework computes at runtime. In the domain, a navigation property is tagged with
[`NavigationAttribute`](group-11-navigation-populators.md#navigationattribute), a plain
`[AttributeUsage(Property)]` marker carrying a single `IsCollection` flag that says "this is a
one-to-many child collection" versus "this is a many-to-one FK reference". That attribute lives in
`MMCA.Common.Domain` deliberately: the domain entity declares *what relationships it has* with **zero
EF dependency** (`[Rubric §3, Clean Architecture]`, the inward dependency rule; the domain stays
persistence-ignorant). At runtime the framework needs a richer, classified view of those navigations,
which it carries in three Application-layer types: the
[`NavigationType`](group-11-navigation-populators.md#navigationtype) enum (`ForeignKey` vs
`ChildCollection`), the [`NavigationPropertyInfo`](group-11-navigation-populators.md#navigationpropertyinfo)
record (one navigation's name, kind, declaring type, and unwrapped target type), and the
[`INavigationMetadata`](group-11-navigation-populators.md#inavigationmetadata) contract whose two lists
are the heart of the design: **`SupportedIncludes`** (navigations EF *can* JOIN, because both ends share
a data source) and **`UnsupportedIncludes`** (navigations that need manual loading, because the ends are
split). Its mutable builder implementation is
[`NavigationMetadata`](group-11-navigation-populators.md#navigationmetadata).

That split is computed by the **`NavigationMetadataProvider`** (covered in
[Group 03](group-03-querying-specifications.md#navigationmetadataprovider), behind the
[`INavigationMetadataProvider`](group-03-querying-specifications.md#inavigationmetadataprovider) port).
Given an entity type and the caller's `includeFKs`/`includeChildren` choice, it reflects over the
entity's public properties, finds the `[Navigation]`-tagged ones whose collection flag matches the
requested kind, unwraps any collection generic to get the real target type, and then asks the
infrastructure-side `IDataSourceService.HaveIncludeSupport(declaring, target)` whether the two entities
actually live in the same place. If they do, the navigation goes in `SupportedIncludes`; if not, into
`UnsupportedIncludes`. Results are cached per `(entity type, NavigationType)` so the reflection runs once
per shape. The crucial architectural point is *where the EF knowledge lives*: the Application layer
classifies "what should be included" without referencing `Microsoft.EntityFrameworkCore` at all, the
only component that knows the physical topology is the data-source service at the Infrastructure
boundary (`[Rubric §3]`, `[Rubric §8, Data Architecture]`).

Once the metadata exists, the [`EntityQueryPipeline`](group-03-querying-specifications.md#entityquerypipeline)
(Group 03) executes it via a **two-path strategy**, and reading its real code
(`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:25`) is the
clearest way to see how the metadata earns its keep. **Path 1 (server-side includes):** if there are
`SupportedIncludes`, each becomes an EF `Include` call (line 41-42), and, importantly, if any of them
is a child *collection*, the pipeline switches to `AsSplitQuery` (line 48-49). That split-query line is
not cosmetic: paginating a single-query collection-Include makes EF apply `Skip`/`Take` to the
JOIN-expanded row set, which truncates child rows and returns empty collections on list reads while
by-id reads still work, the exact bug behind the "session list omits SessionSpeakers" symptom, fixed
here per R24/§8. After includes, criteria and dynamic filters are applied *before* materialization so
the database does the filtering, then sorting → pagination → field projection all run on the
`IQueryable` and one `ToListAsync` returns the page. **Path 2 (manual navigation loading):** the moment
`UnsupportedIncludes.Count != 0`, the pipeline cannot trust a JOIN, so it sorts and paginates the base
query server-side (loading only the requested page), materializes it, and *then* invokes a
**navigation-populator delegate** on that materialized page (line 106) to fill in the cross-source
relationships, paying the manual-load cost on one page of parents, not the whole table, and never as
an N+1.

That delegate is the extension point to the second half of the chapter. Its signature,
`(IReadOnlyCollection<TEntity>, NavigationMetadata, bool includeFKs, bool includeChildren,
CancellationToken)`, is exactly the contract of
[`INavigationPopulator<in TEntity>`](group-11-navigation-populators.md#inavigationpopulatorin-tentity),
the per-entity port a module implements to load its own cross-source navigations. The `in` variance
makes it contravariant on the entity type; the boolean pair mirrors the metadata provider's so a
populator only loads what the caller asked for. Entities with **no** cross-source navigations don't need
a real implementation: the framework supplies
[`NullNavigationPopulator<TEntity>`](group-11-navigation-populators.md#nullnavigationpopulatortentity),
a textbook Null Object whose `PopulateAsync` is a single `Task.CompletedTask`, so the pipeline always
has *some* populator to call and never branches on null (`[Rubric §2, Design Patterns]`).

The actual batch loading is done by [`NavigationLoader`](group-11-navigation-populators.md#navigationloader),
a static helper that exists to kill the N+1 problem. It exposes two methods,
`LoadFKPropertyAsync` (many-to-one: parent holds a nullable FK to a child, e.g. `Product.Category`) and
`LoadChildrenPropertyAsync` (one-to-many: children hold the parent's FK, e.g. `Order → OrderLines`).
Both follow the same shape: collect the distinct keys across *all* parents, **build a
`WHERE childFK IN (...)` predicate as an expression tree at runtime** (so it translates to one SQL
statement), run it once through an [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype),
group the results into a lookup dictionary, and assign each parent its slice via a callback, `O(1)`
per parent after one query for the whole batch (`[Rubric §12, Performance & Scalability]`). The
compiled grouping selectors are cached in a `ConcurrentDictionary` keyed by source type plus member
path, so repeated calls for the same selector skip `Expression.Compile()`. Reading
`NavigationLoader.cs:71-99` shows the expression-tree construction in full.

Writing a populator by hand for every entity would mean repeating that "is this navigation requested?
is it unsupported? which loader?" boilerplate ~30-40 lines per entity, which is what the **declarative
layer** removes. A navigation is described once as an
[`INavigationDescriptor<in TEntity>`](group-11-navigation-populators.md#inavigationdescriptorin-tentity),
a tiny strategy object carrying a `PropertyName`, a `RequiresChildren` flag, and a single
`LoadAsync(entities, IUnitOfWork, ct)` method. There are two concrete descriptors, structurally twins:
[`ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>`](group-11-navigation-populators.md#childnavigationdescriptortentity-tparentid-tchild-tchildid)
for collections (`RequiresChildren => true`, delegates to `LoadChildrenPropertyAsync`) and
[`FKNavigationDescriptor<TEntity, TChild, TChildId>`](group-11-navigation-populators.md#fknavigationdescriptortentity-tchild-tchildid)
for references (`RequiresChildren => false`, `TChildId : struct` for the nullable FK, delegates to
`LoadFKPropertyAsync`). Each descriptor's `required init` properties, the key selectors, the
child-FK *expression* (kept as an `Expression` precisely so `NavigationLoader` can turn it into the
`WHERE … IN` predicate), and the assign callback, mean an incomplete descriptor cannot even be
constructed (`[Rubric §1, SOLID]`, `[Rubric §15, Best Practices]`). The generic
[`DeclarativeNavigationPopulator<TEntity>`](group-11-navigation-populators.md#declarativenavigationpopulatortentity)
then drives a *list* of those descriptors: it early-exits when there are no parents or no
unsupported includes, builds an ordinal hash set of the unsupported property names, and for each
descriptor loads it only when (a) the requested kind matches `RequiresChildren` and (b) the property is
actually in the unsupported set. Adding a new cross-source navigation becomes "add one descriptor",
not "write a new class" (`[Rubric §16, Maintainability]`).

End to end, then, the runtime flow for a list query is: a module query handler asks the
[`EntityQueryService`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype)
to run; the service calls `NavigationMetadataProvider.BuildIncludes` to get the supported/unsupported
split; it hands that split plus its module's `INavigationPopulator<TEntity>` (as the delegate) to
`EntityQueryPipeline.ExecuteAsync`; the pipeline JOINs the supported ones and, if any are unsupported,
materializes the page and calls the populator; the populator (almost always a
`DeclarativeNavigationPopulator` built from descriptors in the module's `DependencyInjection.cs`)
iterates its descriptors and calls `NavigationLoader` once per cross-source navigation. The concrete
consumers live in ADC's Conference module, for example `EventNavigationPopulator`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/EventNavigationPopulator.cs:11`)
is *just* a subclass of `DeclarativeNavigationPopulator<Event>` constructed with three
`ChildNavigationDescriptor`s for `Rooms`, `EventSpeakers`, and `EventQuestionAnswers`, no imperative
loading code at all. Those module-level populators ([`EventNavigationPopulator`](group-18-conference-application.md#eventnavigationpopulator)
and its `Session`/`Speaker`/`ConferenceCategory` siblings) are taught in
[Group 18](group-18-conference-application.md).

Two architectural threads are worth holding onto as you read the per-type sections. First, this
subsystem is *why* the database-per-service split is feasible without rewriting query code
(`[Rubric §7, Microservices Readiness]`): when a relationship's ends move to different sources, the
EF model's `CrossDataSourceDegradeConvention` drops the FK and navigations, the metadata provider
starts reporting that navigation as unsupported, and the populator path picks it up automatically, the
application code that issued the query never changes. Second, the design is a clean illustration of
keeping policy out of the domain: the *what* (a `[Navigation]` marker) lives in Domain, the *whether*
(supported vs unsupported) is computed in Application from an Infrastructure capability check, and the
*how* (batch SQL) is a static helper, three responsibilities, three layers, no EF leakage upward
(`[Rubric §3, Clean Architecture]`, ADR-002). The trade-off ADR-002 itself names is honest: for a
pure single-SQL-database host where `Include` always works, this is an extra abstraction layer, but it
costs nothing at runtime there, because the populator is only invoked when the metadata actually reports
an unsupported include, and otherwise the `NullNavigationPopulator` no-ops.

### NavigationAttribute
> MMCA.Common.Domain · `MMCA.Common.Domain.Attributes` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Attributes/NavigationAttribute.cs:10` · Level 0 · class (sealed attribute)

- **What it is**: marks a domain entity property as a **navigation** (a relationship to another
  entity), with a flag for collection vs. single reference.
- **Depends on**: `System.Attribute` (BCL) only.
- **Concept introduced, navigation metadata decoupled from EF.** `[Rubric §2, Design Patterns]`
  (assesses whether patterns are idiomatic and solve a real problem) and `[Rubric §3, Clean
  Architecture]` (assesses that dependencies point inward and the domain/application core stays
  framework-free). ADR-002 ("navigation populators") is the relevant decision: the application layer
  needs to know an entity's navigations (to build EF `Include` paths and field projections) **without**
  referencing Infrastructure/EF. Declaring navigations with this *domain-level* attribute lets
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider)
  discover them from the *domain* model, keeping the dependency arrow pointing inward (the doc comment,
  `NavigationAttribute.cs:3-8`, says exactly this, discovery is decoupled from EF Core's own metadata).
- **Walkthrough**: `[AttributeUsage(AttributeTargets.Property, Inherited = false, AllowMultiple =
  false)]` (line 9); one property `bool IsCollection { get; init; }` (line 16) distinguishing
  one-to-many (a child collection) from many-to-one / FK (a single reference). `Inherited = false`
  means a derived entity must redeclare its own navigations rather than silently inheriting a base
  type's, discovery is explicit, not accidental.
- **Why it's built this way**: using a domain attribute rather than reading EF's own metadata means the
  application layer can resolve includes without an EF reference, the whole point of ADR-002 and a
  concrete §3 win. The single `IsCollection` boolean is the same FK-vs-collection axis that
  [`NavigationType`](#navigationtype) classifies one level up.
- **Where it's used**: read by
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider)
  (Application, higher level) to drive eager-loading and projection; the cross-source navigation
  populators in this group rely on the metadata it produces.

### NavigationType
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/INavigationMetadata.cs:6` · Level 0 · enum

- **What it is**: a two-value enum (`ForeignKey`, `ChildCollection`) classifying navigation properties
  on domain entities: a `ForeignKey` navigation is a single-reference many-to-one (e.g.
  `Product.Category`); a `ChildCollection` is a one-to-many (e.g. `Order.OrderLines`). Used by
  [`NavigationPropertyInfo`](#navigationpropertyinfo) and [`INavigationMetadata`](#inavigationmetadata)
  to direct the query pipeline's include strategy.
- **Depends on**: BCL only. Lives in the same file (`INavigationMetadata.cs`) as
  [`NavigationPropertyInfo`](#navigationpropertyinfo) and [`INavigationMetadata`](#inavigationmetadata).
- **Concept introduced**: `[Rubric §8, Data Architecture]` (assesses deliberate persistence and
  query strategy): the include strategy differs by navigation type. FK navigations are always safe to
  include eagerly; child collections can cause a Cartesian explosion if multiple collections are
  `Include`d simultaneously. The query pipeline consults this enum (via the records that carry it) to
  decide whether to use EF `.Include()` or a separate batch-load query.
- **Walkthrough**: `ForeignKey` (line 9): reference navigation. `ChildCollection` (line 12): collection
  navigation. Values are not given explicit integers; switch/branch coverage is by name, not ordinal.
- **Where it's used**,
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider)
  stamps each [`NavigationPropertyInfo`](#navigationpropertyinfo) it builds with this enum; downstream
  the query pipeline uses it to pick the include strategy at query time.

### NavigationPropertyInfo
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/INavigationMetadata.cs:23` · Level 1 · record class (sealed)

- **What it is**: metadata about a single navigation property: its CLR name, type (FK reference vs.
  child collection), declaring entity type, and target entity type.
- **Depends on**: [`NavigationType`](#navigationtype) (Level 0, same file `INavigationMetadata.cs:6`);
  `System.Type` (BCL).
- **Concept**: `[Rubric §2, Design Patterns]` (ADR-002, navigation populators). The query pipeline
  needs to decide *per-navigation* whether to use EF `Include` (same data source) or a batch populator
  (cross-source). `NavigationPropertyInfo` carries the information needed to make that decision; it is
  the unit of metadata that [`INavigationMetadata`](#inavigationmetadata) (same file, line 34) sorts
  into `SupportedIncludes` (same source) and `UnsupportedIncludes` (cross-source). These records are
  built by
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) by
  reading [`NavigationAttribute`](#navigationattribute) off entity properties.
- **Walkthrough**: a positional `sealed record class` with four members (lines 23-28):
  `PropertyName` (the CLR property name on the declaring entity), `Type`
  ([`NavigationType`](#navigationtype)), `DeclaringEntityType`, and `TargetEntityType` (the related
  type, "unwrapped from collection generics" per the doc comment, i.e. for `ICollection<Room>` the
  target is `Room`, not the collection). Record equality means two infos describing the same navigation
  compare equal.
- **Where it's used**: aggregated into an [`INavigationMetadata`](#inavigationmetadata) per entity type
  and consumed by the query service to drive eager-loading and batch-populator selection.

### INavigationMetadata
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/INavigationMetadata.cs:34` · Level 2 · interface

- **What it is**: categorizes an entity's navigation properties into two read-only buckets: those that
  support EF Core `.Include()` (`SupportedIncludes`) and those requiring manual batch loading
  (`UnsupportedIncludes`). Both expose `IReadOnlyList<NavigationPropertyInfo>`.
- **Depends on**: [`NavigationPropertyInfo`](#navigationpropertyinfo) /
  [`NavigationType`](#navigationtype) (same file, Levels 1/0).
- **Concept reinforced, the per-entity view of ADR-002 (navigation populators).** `[Rubric §2,
  Design Patterns]` and `[Rubric §8, Data Architecture]` (cross-source navigations cannot be EF-
  included and must be loaded separately). This is the read-only interface that
  [`NavigationMetadata`](#navigationmetadata) (Level 3) implements; the split between
  `SupportedIncludes` and `UnsupportedIncludes` is the decision that routes a query down the EF-`Include`
  path or the manual-populator path. `[Rubric §7, Microservices Readiness]` is in play too: a
  navigation lands in `UnsupportedIncludes` precisely when its two ends live in different physical data
  sources (ADR-006), so this bucketing is what lets an extracted module keep its object graph hydrated
  without cross-database foreign keys.
- **Walkthrough**: two members (lines 37, 40): `SupportedIncludes` (EF `.Include()`, same source) and
  `UnsupportedIncludes` (manual batch loading, cross source). Both are `IReadOnlyList<…>`, the
  interface is purely a *view*; mutation is reserved for the concrete builder.
- **Where it's used**: consumed by [`NavigationMetadata`](#navigationmetadata) (its implementation),
  by [`DeclarativeNavigationPopulator<TEntity>`](#declarativenavigationpopulatortentity) (which reads
  `UnsupportedIncludes` to decide what to load), and by the query pipeline in
  [group 03](group-03-querying-specifications.md) to build include paths per entity query.

### NavigationMetadata
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/NavigationMetadata.cs:9` · Level 3 · class (sealed)

- **What it is**: the concrete mutable builder for [`INavigationMetadata`](#inavigationmetadata):
  maintains two `List<NavigationPropertyInfo>`, "supported" (EF Core `Include`) and "unsupported"
  (cross-data-source, handled by [`INavigationPopulator<in TEntity>`](#inavigationpopulatorin-tentity)).
- **Depends on**: [`INavigationMetadata`](#inavigationmetadata) (Level 2, the interface it implements),
  [`NavigationPropertyInfo`](#navigationpropertyinfo) (Level 1).
- **Concept reinforced, separating EF-includable from manually-loaded navigations (ADR-002).**
  `[Rubric §8, Data Architecture]` (navigations that cross data-source boundaries cannot be EF-included
  and must be loaded separately). The classic *builder with a read-only public view* shape: the two
  backing lists are private, the two `IReadOnlyList<…>` properties expose them, and all four mutators are
  `internal`.
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider)
  (Application) reads `[Navigation]` attributes from the entity type and sorts navigations into the two
  lists at startup; the query pipeline then uses `SupportedIncludes` for `.Include()` and
  `UnsupportedIncludes` for [`INavigationPopulator`](#inavigationpopulatorin-tentity) batch loading.
- **Walkthrough**: two private list fields initialized to `[]` (lines 11-12); the two read-only
  properties (lines 15, 18) return them as `IReadOnlyList<…>`; four `internal` mutators,
  `AddSupported`, `AddUnsupported`, `AddSupportedRange`, `AddUnsupportedRange` (lines 22-34). `internal`
  visibility means only `NavigationMetadataProvider` (same assembly) can populate the object; every
  external consumer sees only the read-only [`INavigationMetadata`](#inavigationmetadata) face. Note the
  query-side passes the *concrete* `NavigationMetadata` (not the interface) into
  [`INavigationPopulator.PopulateAsync`](#inavigationpopulatorin-tentity), populators read
  `UnsupportedIncludes` off it.
- **Where it's used**: built by
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) at
  startup; consumed by the query pipeline and passed into every
  [`INavigationPopulator`](#inavigationpopulatorin-tentity)'s `PopulateAsync`.

### INavigationPopulator<in TEntity>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/INavigationPopulator.cs:9` · Level 4 · interface

- **What it is**: the manual-loading contract for navigations that EF `Include` cannot handle (e.g.
  cross-database / cross-container relationships). Modules implement this to load navigations *after*
  the primary entities have been materialized.
- **Depends on**: [`NavigationMetadata`](#navigationmetadata) (Level 3, passed into `PopulateAsync`).
- **Concept reinforced, the consumer side of ADR-002.** A module's `INavigationPopulator<TEntity>`
  implementation knows how to batch-load related data from a different data source and attach it to the
  already-materialized entities. `[Rubric §2, Design Patterns]` (the ADR-002 navigation-populator
  pattern, a Strategy injected per entity type). `[Rubric §7, Microservices Readiness]` (cross-service
  loading without cross-DB foreign keys: when a module is extracted and its related entity lives in
  another service's database, this is how the navigation still gets filled). The `in TEntity`
  **contravariance** lets a populator typed for a base entity satisfy a request for a derived one.
- **Walkthrough**: one method, `PopulateAsync(IReadOnlyCollection<TEntity> entities,
  NavigationMetadata navigationMetadata, bool includeFKs, bool includeChildren, CancellationToken)`
  (lines 20-25). The `includeFKs`/`includeChildren` boolean pair mirrors the query's include request so
  the populator only loads what was actually asked for; the `IReadOnlyCollection<TEntity>` argument is
  the whole materialized page at once, which is what enables *batch* loading (one query for all parents)
  rather than N+1.
- **Why it's built this way**: see ADR-002. Defining the port in `Application` (not `Infrastructure`)
  keeps the query pipeline that calls it free of EF; the actual SQL is reached through repository
  abstractions inside the implementations ([`NavigationLoader`](#navigationloader) and the descriptor
  classes below).
- **Where it's used**: registered per entity type in DI; the default is
  [`NullNavigationPopulator<TEntity>`](#nullnavigationpopulatortentity) and the generic real
  implementation is [`DeclarativeNavigationPopulator<TEntity>`](#declarativenavigationpopulatortentity).
  Called by the query pipeline (`EntityQueryPipeline` in
  [group 03](group-03-querying-specifications.md#entityquerypipeline)) after EF materializes the page.

### NullNavigationPopulator<TEntity>
> MMCA.Common.Application · `MMCA.Common.Application.Services` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/NullNavigationPopulator.cs:11` · Level 5 · class (sealed, generic)

- **What it is**: a no-op implementation of [`INavigationPopulator<in TEntity>`](#inavigationpopulatorin-tentity)
  used when an entity has no cross-source navigations (nothing requires manual loading).
- **Depends on**: [`INavigationPopulator<in TEntity>`](#inavigationpopulatorin-tentity) (Level 4),
  [`NavigationMetadata`](#navigationmetadata) (Level 3, in the signature it satisfies).
- **Concept introduced, the Null Object pattern.** `[Rubric §2, Design Patterns]` (assesses idiomatic
  pattern use). Callers that request a populator for an entity with only same-source navigations receive
  this no-op instead of having to do a `null` check or a conditional branch throughout the query
  pipeline. The pipeline always calls `PopulateAsync` and never has to know whether it got the real
  populator or this stub, branchless polymorphism.
- **Walkthrough**: one method whose entire body is `=> Task.CompletedTask;` (lines 14-19). It accepts
  the full `INavigationPopulator` signature and ignores every argument. `sealed` because there is
  nothing to extend.
- **Why it's built this way**: registering this as the *default* `INavigationPopulator<TEntity>` (per
  the doc comment, line 8) means a module that needs no cross-source loading registers nothing extra,
  yet the pipeline's call site stays uniform.
- **Where it's used**: registered as the default `INavigationPopulator<TEntity>` in DI for entities
  that don't need cross-source loading; superseded by
  [`DeclarativeNavigationPopulator<TEntity>`](#declarativenavigationpopulatortentity) for entities that
  do.

### NavigationLoader
> MMCA.Common.Application · `MMCA.Common.Application.Services` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/NavigationLoader.cs:21` · Level 6 · class (static)

- **What it is**: a static utility for **batch-loading** navigation properties across a collection of
  parent entities using a single `WHERE FK IN (...)` query, avoiding the N+1 query pattern.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (Level 3, the generic constraint on the child type); `IReadRepository<TChildEntity,
  TChildIdentifierType>` (the read port it queries through, in
  [group 07](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype)); BCL
  `System.Linq.Expressions` and `System.Collections.Concurrent`.
- **Concept introduced, expression-tree-based batch loading as N+1 prevention.** `[Rubric §12,
  Performance & Scalability]` (assesses query efficiency and N+1 avoidance). When a navigation populator
  needs to load 200 sessions' rooms, the naïve approach is 200 individual `GetByIdAsync` calls (N+1).
  `NavigationLoader` instead: (1) collects all distinct FK values from the parent collection; (2) builds
  a `child => parentIds.Contains(child.ForeignKey)` expression tree at runtime; (3) executes a single
  `GetAllAsync(where: lambda, asTracking: false)` call (read-only, no change tracking); (4) groups the
  results into a lookup keyed by FK and assigns the right slice back to each parent. A
  `ConcurrentDictionary` caches the compiled FK-selector delegate so the expression-compilation cost is
  paid only once per distinct expression.
- **Walkthrough**
  - `CompiledExpressionCache` (line 27): the static `ConcurrentDictionary<string, Delegate>` of compiled
    selectors, shared process-wide.
  - **`LoadFKPropertyAsync`** (line 44): for FK navigations where the parent references one child (e.g.
    `Product.CategoryId → Category`). Collects distinct non-null FK values (lines 54-59); short-circuits
    to assigning empty lists when there are none (lines 61-69); builds the `Contains` call against the
    distinct-id list (lines 72-78); runs the single query (lines 80-84); groups by the compiled selector
    (lines 87-90) and assigns by each parent's FK (lines 92-99). Constraint
    `TChildIdentifierType : struct` (line 52) is needed because the parent FK is nullable
    (`TChildIdentifierType?`) and the `HasValue`/`Value` calls require a value type.
  - **`LoadChildrenPropertyAsync`** (line 118): for collection navigations where children reference the
    parent (e.g. `Order → OrderLines`). Same shape, but keyed on the parent's (non-null) primary key,
    constraint `TParentIdentifierType : notnull` (line 125) rather than `struct`, since a PK is never
    nullable.
  - **`GetOrCompileExpression`** (line 175) / **`GetMemberPath`** (line 188): the cache key is
    `"{SourceType.FullName}:{memberPath}"`, where `GetMemberPath` walks the `MemberExpression` chain so
    the key is *parameter-name independent*, `x => x.CategoryId` and `c => c.CategoryId` produce the
    same key (the doc comment on line 184 calls this out).
- **Why it's built this way**: building the predicate as an expression tree (rather than a compiled
  delegate) lets EF translate it to SQL `IN (...)` server-side; the delegate cache avoids re-compiling
  the *grouping* selector on every call. This is ADR-002's batch-loading engine.
- **Where it's used**: called by the descriptor classes in this group
  ([`ChildNavigationDescriptor`](#childnavigationdescriptortentity-tparentid-tchild-tchildid) and
  [`FKNavigationDescriptor`](#fknavigationdescriptortentity-tchild-tchildid)), which is how
  [`DeclarativeNavigationPopulator<TEntity>`](#declarativenavigationpopulatortentity) and hand-written
  populators reach it.

### INavigationDescriptor<in TEntity>
> MMCA.Common.Application · `MMCA.Common.Application.Services.Navigation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Navigation/INavigationDescriptor.cs:10` · Level 8 · interface

- **What it is**: a contract describing a single navigation property that needs *manual* batch loading,
  consumed by [`DeclarativeNavigationPopulator<TEntity>`](#declarativenavigationpopulatortentity) to
  remove per-entity boilerplate.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (passed into
  `LoadAsync` so the descriptor can resolve a read repository).
- **Concept reinforced, declarative cross-source navigation (ADR-002).** Three members (lines 13-27):
  `PropertyName` (must match the EF property name so it can be matched against
  `NavigationMetadata.UnsupportedIncludes`), `RequiresChildren` (whether `includeChildren`, `true`, or
  `includeFKs`, `false`, triggers it), and `LoadAsync(entities, unitOfWork, ct)` which **batch-loads**
  the navigation for *all* parents in one query. `[Rubric §2, Design Patterns]` (Strategy, one
  descriptor per navigation) and `[Rubric §12, Performance]` (batch load avoids the N+1 problem). This
  is the application-layer piece that the query service invokes (via
  [`INavigationPopulator.PopulateAsync`](#inavigationpopulatorin-tentity)) for navigations EF can't
  `Include` because the two ends live in different physical databases (ADR-006). The `in TEntity`
  contravariance matches the populator's.
- **Why it's built this way**: declaring each cross-source navigation as a small descriptor lets one
  generic populator serve every entity, and keeps the descriptor out of Infrastructure: it depends only
  on [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), an Application abstraction, and
  reaches SQL through [`NavigationLoader`](#navigationloader) + the read repository.
- **Where it's used**: implemented by the per-relationship descriptors below
  ([`ChildNavigationDescriptor`](#childnavigationdescriptortentity-tparentid-tchild-tchildid) and
  [`FKNavigationDescriptor`](#fknavigationdescriptortentity-tchild-tchildid)); aggregated by
  [`DeclarativeNavigationPopulator<TEntity>`](#declarativenavigationpopulatortentity).

> The next two types, `ChildNavigationDescriptor` and `FKNavigationDescriptor`, are a
> **structurally identical sibling family**: both are sealed
> [`INavigationDescriptor<in TEntity>`](#inavigationdescriptorin-tentity) data objects whose `LoadAsync`
> delegates to [`NavigationLoader`](#navigationloader). The first teaches the shared shape; the second
> cross-references it and only calls out what differs. They each get their own `###` heading so external
> cross-links resolve.

### ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>
> MMCA.Common.Application · `MMCA.Common.Application.Services.Navigation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Navigation/ChildNavigationDescriptor.cs:15` · Level 9 · class (sealed)

- **What it is**: the one-to-many [`INavigationDescriptor<in TEntity>`](#inavigationdescriptorin-tentity):
  loads a child *collection* (e.g. `Event.Rooms`) by matching children whose FK equals the parent's
  primary key. Used with [`DeclarativeNavigationPopulator<TEntity>`](#declarativenavigationpopulatortentity)
  to load navigations EF cannot resolve via `Include` (cross-source, per ADR-002). It captures selectors
  plus an assign callback; `LoadAsync` delegates to [`NavigationLoader`](#navigationloader).
- **Depends on**: [`INavigationDescriptor<in TEntity>`](#inavigationdescriptorin-tentity) (Level 8, the
  interface it implements); [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (Level 3, the generic constraint on `TChild`); [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork)
  (Level 7, source of the read repository); [`NavigationLoader`](#navigationloader) (Level 6, the
  batch-loading helper). BCL: `System.Linq.Expressions`.
- **Concept introduced, descriptor types as strategy + data objects.** `[Rubric §2, Design Patterns]`
  (Strategy: a descriptor both *describes* a relationship and *executes* its load). Each descriptor is a
  data object (all configuration via `required init` properties set at construction) plus one
  `Task LoadAsync(...)` method, a minimal Strategy that composes with
  [`DeclarativeNavigationPopulator`](#declarativenavigationpopulatortentity) by iteration. The
  `required` keyword on `PropertyName`, `ParentKeySelector`, `ChildForeignKeySelector`, and
  `AssignAction` means an incomplete descriptor cannot be constructed. `[Rubric §4, DDD]`
  (relationships described in the Application layer without EF coupling, the
  [`[Navigation]`](#navigationattribute) attribute marks the property in the domain model; the
  descriptor loads it in the Application layer).
- **Walkthrough**: four `required init` properties (lines 22-34): `PropertyName` (matched against
  [`NavigationMetadata.UnsupportedIncludes`](#navigationmetadata)), `ParentKeySelector`
  (`Func<TEntity, TParentId>`), `ChildForeignKeySelector` (`Expression<Func<TChild, TParentId>>`, an
  *expression* so [`NavigationLoader`](#navigationloader) can translate it into an EF `Where` predicate),
  and `AssignAction` (`Action<TEntity, List<TChild>>` that writes the loaded list back to each parent).
  `RequiresChildren => true` (line 25) tells the populator this is a collection navigation, loaded only
  when `includeChildren` is true. `LoadAsync` (lines 37-47) delegates to
  `NavigationLoader.LoadChildrenPropertyAsync`, pulling the read repository from
  `unitOfWork.GetReadRepository<TChild, TChildId>()`. Constraints: `TParentId : notnull`,
  `TChild : AuditableBaseEntity<TChildId>`, `TChildId : notnull` (lines 17-19).
- **Why it's built this way**: ADR-002 motivates the pattern: cross-source includes cannot go through
  EF `Include`, but the Application layer must not know about EF or the physical split. The descriptor is
  the extension point, constructed in Application code (a module's `DependencyInjection.cs`, typed against domain
  entity types) and delegating the actual batch query to [`NavigationLoader`](#navigationloader), which
  uses the read repository.
- **Where it's used**: constructed in per-module navigation-populator DI registrations (e.g. an Event
  module's populator declaration that loads its child collection of Rooms). Consumed by
  [`DeclarativeNavigationPopulator<TEntity>`](#declarativenavigationpopulatortentity).

### FKNavigationDescriptor<TEntity, TChild, TChildId>
> MMCA.Common.Application · `MMCA.Common.Application.Services.Navigation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Navigation/FKNavigationDescriptor.cs:14` · Level 9 · class (sealed)

- **What it is**: the many-to-one sibling of
  [`ChildNavigationDescriptor`](#childnavigationdescriptortentity-tparentid-tchild-tchildid): loads a
  single FK *reference* (e.g. `Product.Category`) by matching the parent's nullable FK value to the
  child's primary key. Same Strategy + data-object shape as its sibling, see that section for the shared
  treatment; only the differences are listed below.
- **Depends on**: identical to
  [`ChildNavigationDescriptor`](#childnavigationdescriptortentity-tparentid-tchild-tchildid):
  [`INavigationDescriptor<in TEntity>`](#inavigationdescriptorin-tentity),
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype),
  [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`NavigationLoader`](#navigationloader), `System.Linq.Expressions`.
- **Walkthrough, what differs**: the constraint is `TChildId : struct` (line 17) rather than `notnull`,
  because a nullable FK requires a value type; `ParentKeySelector` returns `TChildId?` (nullable, line
  26); `RequiresChildren => false` (line 23) so the populator loads it when `includeFKs` (not
  `includeChildren`) is true; and `LoadAsync` (lines 35-46) delegates to
  `NavigationLoader.LoadFKPropertyAsync` (the FK overload) instead of the children overload. The
  `PropertyName`/`ChildForeignKeySelector`/`AssignAction` members and the
  `unitOfWork.GetReadRepository<TChild, TChildId>()` call are identical to the sibling.
- **Where it's used**: constructed in per-module navigation-populator DI registrations for cross-source
  FK references; consumed by
  [`DeclarativeNavigationPopulator<TEntity>`](#declarativenavigationpopulatortentity).

### DeclarativeNavigationPopulator<TEntity>
> MMCA.Common.Application · `MMCA.Common.Application.Services.Navigation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Navigation/DeclarativeNavigationPopulator.cs:14` · Level 9 · class

- **What it is**: a generic [`INavigationPopulator<in TEntity>`](#inavigationpopulatorin-tentity) that
  eliminates per-entity boilerplate: it accepts a list of
  [`INavigationDescriptor<in TEntity>`](#inavigationdescriptorin-tentity) at construction and iterates
  them in `PopulateAsync`, calling each descriptor's `LoadAsync` only when the metadata marks that
  navigation as unsupported (i.e. cross-source) *and* the caller requested the right kind (FK vs.
  children).
- **Depends on**: [`INavigationDescriptor<in TEntity>`](#inavigationdescriptorin-tentity) (Level 8);
  [`INavigationPopulator<in TEntity>`](#inavigationpopulatorin-tentity) (Level 4);
  [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (Level 7);
  [`NavigationMetadata`](#navigationmetadata) (Level 3).
- **Concept introduced, declarative populator as a Composite/Interpreter.** `[Rubric §2, Design
  Patterns]` (a list of descriptors is *interpreted* by iterating them). Before this type existed, each
  entity that needed cross-source loading required a hand-written
  [`INavigationPopulator`](#inavigationpopulatorin-tentity) implementation with repetitive conditional
  logic. `DeclarativeNavigationPopulator` replaces that boilerplate with one generic loop over
  descriptors, the "what to load" is declared in DI registration code, the "how" lives in each
  descriptor, and the "when" lives in this class. `[Rubric §16, Maintainability & Evolvability]`
  (adding a new cross-source navigation means adding one descriptor to a DI registration, not writing a
  whole new class).
- **Walkthrough**
  - Primary constructor (line 14, `DeclarativeNavigationPopulator.cs`): parameters `unitOfWork` and
    `descriptors` (`IReadOnlyList<INavigationDescriptor<TEntity>>`).
  - `PopulateAsync` (line 20): early-exits if `entities.Count == 0` or
    `navigationMetadata.UnsupportedIncludes.Count == 0` (line 27), no work when there is nothing
    cross-source to load. Builds a `HashSet<string>` of the unsupported include property names with a
    case-sensitive `StringComparer.Ordinal` (lines 30-33). Then for each descriptor (lines 34-41):
    `shouldLoad` is `descriptor.RequiresChildren ? includeChildren : includeFKs`; if `shouldLoad` and the
    descriptor's `PropertyName` is in the unsupported set, it awaits
    `descriptor.LoadAsync(entities, unitOfWork, ct)`. The `.ConfigureAwait(false)` (line 39) avoids
    capturing the synchronization context on each iteration.
- **Why it's built this way**: the early-exit guard is a real performance optimization: if every
  navigation is EF-resolvable (no unsupported includes) the populator does literally no work. The hash
  set makes the per-descriptor property-name check O(1) even with many descriptors. Unlike its siblings
  this class is **not** `sealed`, it is intended to be subclassed or used directly per entity type.
- **Where it's used**: registered as `INavigationPopulator<TEntity>` for entities with cross-source
  relationships (e.g. `Event` → its cross-source `Rooms` collection), superseding
  [`NullNavigationPopulator<TEntity>`](#nullnavigationpopulatortentity). Injected into the query service
  ([`EntityQueryService`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype))
  at the composition root and invoked by the query pipeline after EF materializes the page.


---
[⬅ Notifications (Push + In-App Inbox + Email)](group-10-notifications.md)  •  [Index](00-index.md)  •  [API Hosting, Middleware, Idempotency & DTO/Contract Mapping ➡](group-12-api-hosting-mapping.md)
