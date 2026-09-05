# 11. Navigation Metadata & Populators (EF-decoupled eager loading)

EF Core gives you `.Include()` for eager loading, and for a single SQL Server database that is the
right tool. But this codebase is a **database-per-service** modular monolith
([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)): two related entities
can live in **different physical data sources**, different SQL databases, or a Cosmos container that
has no JOINs at all, and across that boundary EF's `Include` cannot produce a JOIN. The relationship
is real in the domain model, but the physical storage cannot satisfy it in one query. This chapter is
the framework's answer to that gap: a small, self-contained subsystem that decides *which*
navigations EF can load and *which* must be hand-loaded, then batch-loads the latter without leaking
EF or the physical split into the Application or Domain layers. It is the machinery behind
**[ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html) (navigation
populators)**, and it sits directly underneath the query pipeline taught in
[Group 03](group-03-querying-specifications.md).

The whole feature turns on one piece of metadata you author in the **Domain** layer and one piece the
framework computes at runtime. In the domain, a navigation property is tagged with
[`NavigationAttribute`](#navigationattribute)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Attributes/NavigationAttribute.cs:10`), a sealed
`[AttributeUsage(AttributeTargets.Property, Inherited = false, AllowMultiple = false)]` marker
(`NavigationAttribute.cs:9`) carrying a single `IsCollection` init-only flag
(`NavigationAttribute.cs:16`) that says "this is a one-to-many child collection" versus "this is a
many-to-one FK reference". That attribute lives in `MMCA.Common.Domain` deliberately: the domain
entity declares *what relationships it has* with **zero EF dependency** (`[Rubric §3, Clean
Architecture]`, the inward dependency rule, so the domain stays persistence-ignorant). At runtime the
framework needs a richer, classified view of those navigations, which it carries in three
Application-layer types declared in one file: the [`NavigationType`](#navigationtype) enum
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Navigation/INavigationMetadata.cs:6`, values
`ForeignKey` and `ChildCollection`), the [`NavigationPropertyInfo`](#navigationpropertyinfo) record
(`INavigationMetadata.cs:23`, one navigation's property name, kind, declaring type, and unwrapped
target type), and the [`INavigationMetadata`](#inavigationmetadata) contract
(`INavigationMetadata.cs:34`) whose two read-only lists are the heart of the design:
**`SupportedIncludes`** (navigations EF *can* JOIN, because both ends share a data source,
`INavigationMetadata.cs:37`) and **`UnsupportedIncludes`** (navigations that need manual loading,
because the ends are split, `INavigationMetadata.cs:40`). Its mutable builder implementation is
[`NavigationMetadata`](#navigationmetadata)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Navigation/NavigationMetadata.cs:9`), which backs
each list with a `List<NavigationPropertyInfo>` and exposes only `internal` `AddSupported` /
`AddUnsupported` / `AddSupportedRange` / `AddUnsupportedRange` mutators
(`NavigationMetadata.cs:22-34`), so nothing outside the framework assembly can rewrite a
classification after the fact.

That split is computed by the `NavigationMetadataProvider` (covered in
[Group 03](group-03-querying-specifications.md#navigationmetadataprovider), behind the
[`INavigationMetadataProvider`](group-03-querying-specifications.md#inavigationmetadataprovider) port).
Given an entity type and the caller's `includeFKs`/`includeChildren` choice, its `BuildIncludes<TEntity>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/NavigationMetadataProvider.cs:31`)
reflects over the entity's public instance properties, keeps the `[Navigation]`-tagged ones whose
`IsCollection` flag matches the requested kind (`NavigationMetadataProvider.cs:74-80`), unwraps
`ICollection<T>` / `IReadOnlyCollection<T>` to get the real target type
(`NavigationMetadataProvider.cs:106-116`), and then asks the infrastructure-side
`IDataSourceService.HaveIncludeSupport(declaringType, targetType)` whether the two entities actually
live in the same place (`NavigationMetadataProvider.cs:96-99`). If they do, the navigation goes in
`SupportedIncludes`; if not, into `UnsupportedIncludes`. Results are cached in a
`ConcurrentDictionary` keyed by `(entity type, NavigationType)` so the reflection runs once per shape,
and that cache is deliberately **instance-level rather than static**
(`NavigationMetadataProvider.cs:22-28`): classification depends on the host's data-source
configuration, so a process hosting several service configurations (integration tests, for example)
must not share classification results across hosts. The crucial architectural point is *where the EF
knowledge lives*: the Application layer classifies "what should be included" without referencing
`Microsoft.EntityFrameworkCore` at all, and the only component that knows the physical topology is
[`IDataSourceService`](group-07-persistence-ef-core.md#idatasourceservice) at the Infrastructure
boundary (`[Rubric §3, Clean Architecture]`, `[Rubric §8, Data Architecture]`).

Once the metadata exists, the
[`EntityQueryPipeline`](group-03-querying-specifications.md#entityquerypipeline) (Group 03) executes it
via a **two-path strategy**, and reading its real code
(`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:13`) is the
clearest way to see how the metadata earns its keep. Both paths share a front half,
`ApplyIncludesCriteriaAndFilters` (`EntityQueryPipeline.cs:119`). **Path 1 (server-side includes):**
if there are `SupportedIncludes`, each becomes an EF `Include` call through the queryable executor
(`EntityQueryPipeline.cs:131-134`), and, importantly, if any of them is a child *collection*, the
pipeline switches to `AsSplitQuery` (`EntityQueryPipeline.cs:140-141`). That split-query line is not
cosmetic: paginating a single-query collection-`Include` makes EF apply `Skip`/`Take` to the
JOIN-expanded row set, which truncates child rows and returns empty collections on list reads while
by-id reads still work, and the comment above it records exactly that (`EntityQueryPipeline.cs:136-139`).
After includes, specification criteria and dynamic filters are applied *before* materialization so
the database does the filtering (`EntityQueryPipeline.cs:143-151`). **Path 2 (manual navigation
loading):** the moment `UnsupportedIncludes.Count != 0` the pipeline cannot trust a JOIN
(`EntityQueryPipeline.cs:53-54`), so `ExecuteWithManualNavigationAsync` (`EntityQueryPipeline.cs:161`)
sorts server-side with a key tie-break for paginated reads (`EntityQueryPipeline.cs:175-180`),
applies paging or, for an unpaginated read, caps the result set at the `MaxUnboundedResultLimit`
ceiling of 1000 rows (`EntityQueryPipeline.cs:23`, `EntityQueryPipeline.cs:184-194`), materializes
that bounded page, and *then* invokes a **navigation-populator delegate** on it
(`EntityQueryPipeline.cs:196-200`) to fill in the cross-source relationships. The manual-load cost is
paid on one page of parents, not the whole table, and never as an N+1.

That delegate is the extension point to the second half of the chapter. Its signature,
`Func<IReadOnlyCollection<TEntity>, NavigationMetadata, bool, bool, CancellationToken, Task>`
(`EntityQueryPipeline.cs:43`), is exactly the shape of
[`INavigationPopulator<in TEntity>`](#inavigationpopulatorin-tentity)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Navigation/INavigationPopulator.cs:9`), the
per-entity port a module implements to load its own cross-source navigations
(`INavigationPopulator.cs:20-25`). The `in` variance makes it contravariant on the entity type; the
boolean pair mirrors the metadata provider's so a populator only loads what the caller asked for.
Entities with **no** cross-source navigations do not need a real implementation: the framework
supplies [`NullNavigationPopulator<TEntity>`](#nullnavigationpopulatortentity)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Services/NullNavigationPopulator.cs:11`), a textbook
Null Object whose `PopulateAsync` is a single `Task.CompletedTask`
(`NullNavigationPopulator.cs:14-19`), so the pipeline always has *some* populator to call and never
branches on null (`[Rubric §2, Design Patterns]`). It is registered exactly that way for entities
with nothing to hand-load, for example
`services.TryAddScoped<INavigationPopulator<Question>, NullNavigationPopulator<Question>>()`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/DependencyInjection.cs:85`) and
the framework's own push-notification entity
(`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:39`).

The actual batch loading is done by [`NavigationLoader`](#navigationloader)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Services/NavigationLoader.cs:21`), a static helper
that exists to kill the N+1 problem. It exposes two methods: `LoadFKPropertyAsync`
(`NavigationLoader.cs:44`, many-to-one, the parent holds a nullable FK to a child, e.g.
`Product.Category`) and `LoadChildrenPropertyAsync` (`NavigationLoader.cs:118`, one-to-many, children
hold the parent's FK, e.g. `Order` to `OrderLines`). Both follow the same shape: collect the distinct
keys across *all* parents (`NavigationLoader.cs:54-59`, `NavigationLoader.cs:129-132`), short-circuit
by assigning every parent an empty list when there are no keys (`NavigationLoader.cs:61-69`), **build
a `WHERE childFK IN (...)` predicate as an expression tree at runtime** so it translates to one SQL
statement (`NavigationLoader.cs:71-78`), run it once through an
[`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype)
with `asTracking: false` (`NavigationLoader.cs:80-84`), group the results into a lookup dictionary
(`NavigationLoader.cs:87-90`), and assign each parent its slice via a callback, `O(1)` per parent
after one query for the whole batch (`NavigationLoader.cs:92-99`, `[Rubric §12, Performance &
Scalability]`). The compiled grouping selectors are cached in a static `ConcurrentDictionary`
(`NavigationLoader.cs:27`) keyed by source type plus a parameter-name-independent member path
(`NavigationLoader.cs:175-207`), so repeated calls for the same selector skip `Expression.Compile()`.

Writing a populator by hand for every entity would mean repeating the "is this navigation requested?
is it unsupported? which loader?" boilerplate per entity, which is what the **declarative layer**
removes. A navigation is described once as an
[`INavigationDescriptor<in TEntity>`](#inavigationdescriptorin-tentity)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Navigation/INavigationDescriptor.cs:10`), a
small strategy object carrying a `PropertyName` that must match the EF property name
(`INavigationDescriptor.cs:13`), a `RequiresChildren` flag (`INavigationDescriptor.cs:19`), and a
single `LoadAsync(entities, IUnitOfWork, cancellationToken)` method (`INavigationDescriptor.cs:24-27`).
There are two concrete descriptors, structurally twins:
[`ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>`](#childnavigationdescriptortentity-tparentid-tchild-tchildid)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Navigation/ChildNavigationDescriptor.cs:15`)
for collections (`RequiresChildren => true` at `ChildNavigationDescriptor.cs:25`, delegating to
`NavigationLoader.LoadChildrenPropertyAsync` at `ChildNavigationDescriptor.cs:37-47`) and
[`FKNavigationDescriptor<TEntity, TChild, TChildId>`](#fknavigationdescriptortentity-tchild-tchildid)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Navigation/FKNavigationDescriptor.cs:14`)
for references (`RequiresChildren => false` at `FKNavigationDescriptor.cs:23`, constrained
`where TChildId : struct` so the parent's FK can be nullable at `FKNavigationDescriptor.cs:17`,
delegating to `NavigationLoader.LoadFKPropertyAsync` at `FKNavigationDescriptor.cs:35-45`). Each
descriptor's `required init` properties, the key selector, the child-FK *expression* (kept as an
`Expression<Func<...>>` precisely so `NavigationLoader` can turn it into the `WHERE ... IN` predicate),
and the assign callback mean an incomplete descriptor cannot even be constructed
(`ChildNavigationDescriptor.cs:22-34`, `FKNavigationDescriptor.cs:20-32`, `[Rubric §1, SOLID]`,
`[Rubric §15, Best Practices & Code Quality]`). Both resolve their child repository from
[`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) at load time rather than injecting one
(`ChildNavigationDescriptor.cs:45`, `FKNavigationDescriptor.cs:43`).

The generic [`DeclarativeNavigationPopulator<TEntity>`](#declarativenavigationpopulatortentity)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Navigation/DeclarativeNavigationPopulator.cs:14`)
then drives a *list* of those descriptors: it takes an `IUnitOfWork` and an
`IReadOnlyList<INavigationDescriptor<TEntity>>` as primary-constructor parameters
(`DeclarativeNavigationPopulator.cs:14-17`), early-exits when there are no parents or no unsupported
includes (`DeclarativeNavigationPopulator.cs:27-28`), builds an ordinal `HashSet<string>` of the
unsupported property names (`DeclarativeNavigationPopulator.cs:30-32`), and for each descriptor loads
it only when the requested kind matches `RequiresChildren` **and** the property is actually in the
unsupported set (`DeclarativeNavigationPopulator.cs:34-41`). Adding a new cross-source navigation
becomes "add one descriptor", not "write a new class" (`[Rubric §15, Best Practices & Code Quality]`). It is the
only concrete class in this group left open for inheritance, because module populators subclass it.

End to end, the runtime flow for a list query is: a module query handler asks the
[`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype)
to run; the service calls `NavigationMetadataProvider.BuildIncludes<TEntity>` to get the
supported/unsupported split
(`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:283`); it hands that
split plus its module's injected `INavigationPopulator<TEntity>` (as the method-group delegate
`NavigationPopulator.PopulateAsync`) to `EntityQueryPipeline.ExecuteAsync`
(`EntityQueryService.cs:317-322`); the pipeline JOINs the supported navigations and, if any are
unsupported, materializes the page and calls the populator; the populator (almost always a
`DeclarativeNavigationPopulator` built from descriptors) iterates its descriptors and calls
`NavigationLoader` once per cross-source navigation. The same metadata also gates the service's keyed
by-id fast path: requested includes alone do not disqualify a keyed read, but a single unsupported
include does, because only the pipeline's populator can batch-load across physical sources
(`EntityQueryService.cs:184-188`). The concrete consumers live in ADC's Conference module. For example
[`EventNavigationPopulator`](group-18-conference-application.md#eventnavigationpopulator)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/EventNavigationPopulator.cs:11`)
is *just* a subclass of `DeclarativeNavigationPopulator<Event>` constructed with three
`ChildNavigationDescriptor`s for `Rooms`, `EventSpeakers`, and `EventQuestionAnswers`, with no
imperative loading code at all, and
[`SessionNavigationPopulator`](group-18-conference-application.md#sessionnavigationpopulator)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/SessionNavigationPopulator.cs:13`)
mixes two `FKNavigationDescriptor`s (`Event`, `Room`) with three `ChildNavigationDescriptor`s. Each is
registered per entity as a scoped service
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/DependencyInjection.cs:68`,
`DependencyInjection.cs:72`), and those module-level populators are taught in
[Group 18](group-18-conference-application.md).

Two architectural threads are worth holding onto as you read the per-type sections. First, this
subsystem is *why* the database-per-service split is feasible without rewriting query code
(`[Rubric §7, Microservices Readiness]`): when a relationship's ends move to different sources, the EF
model's [`CrossDataSourceDegradeConvention`](group-07-persistence-ef-core.md#crossdatasourcedegradeconvention)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/CrossDataSourceDegradeConvention.cs:33`)
drops the relationship and ignores the CLR navigation members, routing runtime navigation "through the
existing `INavigationPopulator` batch-loading machinery instead"
(`CrossDataSourceDegradeConvention.cs:15-17`), the metadata provider starts reporting that navigation
as unsupported, and the populator path picks it up automatically. The application code that issued the
query never changes, and when every entity resolves to the same physical source the convention is a
structural no-op (`CrossDataSourceDegradeConvention.cs:25-29`). Second, the design is a clean
illustration of keeping policy out of the domain: the *what* (a `[Navigation]` marker) lives in
Domain, the *whether* (supported versus unsupported) is computed in Application from an Infrastructure
capability check, and the *how* (batch SQL) is a static helper. Three responsibilities, three layers,
no EF leakage upward (`[Rubric §3, Clean Architecture]`,
[ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)). The trade-off ADR-002
itself names is honest: for a pure single-SQL-database host where `Include` always works, this is an
extra abstraction layer, but it costs nothing at runtime there, because the populator is only invoked
when the metadata actually reports an unsupported include, and otherwise the `NullNavigationPopulator`
no-ops.

### NavigationAttribute
> MMCA.Common.Domain · `MMCA.Common.Domain.Attributes` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Attributes/NavigationAttribute.cs:10` · Level 0 · class (sealed attribute)

- **What it is**: marks a domain entity property as a **navigation** (a relationship to another
  entity), with a single flag distinguishing a collection from a single reference.
- **Depends on**: `System.Attribute` (BCL) only. No first-party dependencies at all, which is the
  point.
- **Concept introduced, navigation metadata declared in the domain instead of read from EF.**
  `[Rubric §2, Design Patterns]` (assesses whether patterns are idiomatic and solve a real problem)
  and `[Rubric §3, Clean Architecture]` (assesses that dependencies point inward and the
  domain/application core stays framework-free).
  [ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html) is the governing
  decision: the Application layer needs to know an entity's navigations (to build EF `Include` paths
  and field projections) **without** referencing Infrastructure or EF Core. Declaring navigations with
  a *domain-level* attribute lets
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider)
  discover them by reflecting over the domain model, so the dependency arrow keeps pointing inward.
  The doc comment (`MMCA.Common/Source/Core/MMCA.Common.Domain/Attributes/NavigationAttribute.cs:3-8`)
  states exactly that: discovery is decoupled from EF Core's own metadata.
- **Walkthrough**
  - `[AttributeUsage(AttributeTargets.Property, Inherited = false, AllowMultiple = false)]` (line 9).
    `Inherited = false` means a derived entity must redeclare its own navigations rather than
    silently inheriting a base type's, so discovery is explicit rather than accidental.
    `AllowMultiple = false` means one navigation classification per property.
  - `public bool IsCollection { get; init; }` (line 16): `true` for a one-to-many child collection,
    `false` (the default) for a many-to-one FK reference. `init`-only, so the classification is fixed
    at the attribute-application site.
- **Why it's built this way**: reading EF's own model metadata would force the Application layer to
  reference `Microsoft.EntityFrameworkCore`. A plain domain attribute costs one reflection pass
  (cached) and buys a framework-free core, which is the concrete §3 win behind
  [ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html). The single
  `IsCollection` boolean is the same FK-versus-collection axis that
  [`NavigationType`](#navigationtype) names one level up.
- **Where it's used**: applied on domain entity properties (for example
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/Speaker.cs:66` and `:72`
  tag `SpeakerCategoryItems` and `SpeakerQuestionAnswers` with `[Navigation(IsCollection = true)]`,
  and `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sponsors/Sponsor.cs:48` tags the
  `Event` reference with a bare `[Navigation]`). Read by
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/NavigationMetadataProvider.cs:74`)
  to build the metadata every other type in this chapter consumes.

### NavigationType
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Navigation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Navigation/INavigationMetadata.cs:6` · Level 0 · enum

- **What it is**: a two-value enum classifying navigation properties. `ForeignKey` is a
  single-reference many-to-one (for example `Sponsor.Event`); `ChildCollection` is a one-to-many (for
  example `Speaker.SpeakerCategoryItems`).
- **Depends on**: BCL only. It shares the file `INavigationMetadata.cs` with
  [`NavigationPropertyInfo`](#navigationpropertyinfo) and
  [`INavigationMetadata`](#inavigationmetadata).
- **Concept**: `[Rubric §8, Data Architecture]` (assesses a deliberate persistence and query
  strategy). The two kinds are loaded by two different mechanisms, so the classification has to
  survive from the domain attribute all the way to the loader: FK navigations resolve by matching a
  parent's nullable FK to a child key, child collections resolve by matching children's FK to the
  parent key. Those are the two methods on [`NavigationLoader`](#navigationloader), and the two
  descriptor classes at the end of this chapter.
- **Walkthrough**: `ForeignKey` (line 9), `ChildCollection` (line 12). No explicit ordinals are
  assigned, so the values are the implicit `0` and `1` and every branch in the codebase switches on
  the names, not the numbers.
- **Where it's used**:
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider)
  derives it from `NavigationAttribute.IsCollection`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/NavigationMetadataProvider.cs:78`),
  stamps it onto each [`NavigationPropertyInfo`](#navigationpropertyinfo) it builds (line 90), and
  uses it as half of the provider's cache key (line 28) so the FK and child-collection views of one
  entity are computed and memoized separately.

### NavigationPropertyInfo
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Navigation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Navigation/INavigationMetadata.cs:23` · Level 1 · record class (sealed, positional)

- **What it is**: the metadata unit for a single navigation property: its CLR name, its kind, the
  entity type that declares it, and the entity type it targets.
- **Depends on**: [`NavigationType`](#navigationtype) (Level 0, same file, line 6) and `System.Type`
  (BCL).
- **Concept**: `[Rubric §2, Design Patterns]`
  ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)). The query pipeline
  decides *per navigation* whether EF can `Include` it (both ends in one data source) or whether a
  populator must batch-load it (the ends are split). `NavigationPropertyInfo` carries precisely the
  four facts that decision needs, and `DeclaringEntityType`/`TargetEntityType` are what get handed to
  the data-source capability check.
- **Walkthrough**: four positional members (lines 23-28). `PropertyName` is the CLR property name on
  the declaring entity, and it is the join key against a descriptor's `PropertyName` later on.
  `Type` is the [`NavigationType`](#navigationtype). `DeclaringEntityType` and `TargetEntityType` are
  `System.Type`, and the target is *unwrapped from collection generics*: for a property typed
  `IReadOnlyCollection<SpeakerCategoryItem>` the target is `SpeakerCategoryItem`, not the collection
  (the unwrapping happens in `NavigationMetadataProvider.UnwrapCollectionType`,
  `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/NavigationMetadataProvider.cs:106-116`,
  which handles `ICollection<T>` and `IReadOnlyCollection<T>`). Being a `record class` gives value
  equality for free, so two infos describing the same navigation compare equal.
- **Where it's used**: constructed by
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider)
  (line 90) and accumulated into the two lists of
  [`INavigationMetadata`](#inavigationmetadata) / [`NavigationMetadata`](#navigationmetadata).

### INavigationMetadata
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Navigation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Navigation/INavigationMetadata.cs:34` · Level 2 · interface

- **What it is**: the read-only view that splits an entity's navigations into two buckets, those EF
  Core can eager-load with `.Include()` and those that require manual batch loading.
- **Depends on**: [`NavigationPropertyInfo`](#navigationpropertyinfo) and, transitively,
  [`NavigationType`](#navigationtype) (same file, Levels 1 and 0).
- **Concept reinforced, the per-entity view of
  [ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html).** `[Rubric §2,
  Design Patterns]` and `[Rubric §8, Data Architecture]`: a navigation whose two ends live in
  different physical data sources cannot become a SQL JOIN, so it has to be a second query. This
  two-list split *is* that routing decision, computed once and then obeyed by the whole query path.
  `[Rubric §7, Microservices Readiness]` is equally in play: a navigation lands in
  `UnsupportedIncludes` exactly when database-per-service
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) has separated its
  ends, so this bucketing is what lets an extracted module keep its object graph hydrated without
  cross-database foreign keys.
- **Walkthrough**: two members, `SupportedIncludes` (line 37) and `UnsupportedIncludes` (line 40),
  both `IReadOnlyList<NavigationPropertyInfo>`. The interface is purely a view; it declares no
  mutators at all, which is what forces population to go through the concrete builder below.
- **Where it's used**: implemented by [`NavigationMetadata`](#navigationmetadata). Consumers read the
  two lists rather than the interface itself in most call sites, because the query path passes the
  concrete builder type around (see the caveat on the next section).

### NavigationMetadata
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Navigation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Navigation/NavigationMetadata.cs:9` · Level 3 · class (sealed)

- **What it is**: the concrete mutable builder behind [`INavigationMetadata`](#inavigationmetadata).
  It holds two `List<NavigationPropertyInfo>` (supported and unsupported) and exposes them read-only
  while keeping every mutator `internal`.
- **Depends on**: [`INavigationMetadata`](#inavigationmetadata) (Level 2, the interface it
  implements) and [`NavigationPropertyInfo`](#navigationpropertyinfo) (Level 1).
- **Concept reinforced, builder with a read-only public face.** `[Rubric §1, SOLID]` (the public
  surface is the minimum a caller needs) and `[Rubric §8, Data Architecture]`. The two backing lists
  are private and collection-initialized to `[]` (lines 11-12); the two `IReadOnlyList<...>`
  properties project them (lines 15, 18); the four add methods are `internal` (lines 22, 26, 30, 34).
  `internal` visibility is the enforcement mechanism: only code inside `MMCA.Common.Application` can
  fill an instance, which in practice means
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider) and
  nothing else. Every module-authored populator receives a fully built instance and can only read it.
- **Walkthrough**
  - `_supportedIncludes` / `_unsupportedIncludes` (lines 11-12): the two backing lists.
  - `SupportedIncludes` (line 15) / `UnsupportedIncludes` (line 18): the `IReadOnlyList<...>`
    projections satisfying the interface.
  - `AddSupported` (line 22) and `AddUnsupported` (line 26): single-item mutators, used by
    `NavigationMetadataProvider.ClassifyNavigationProperty`
    (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/NavigationMetadataProvider.cs:96-99`)
    right after the data-source capability check decides which bucket a navigation belongs in.
  - `AddSupportedRange` (line 30) and `AddUnsupportedRange` (line 34): the bulk mutators used by
    `BuildIncludes` (same file, lines 38-39 and 45-46) to merge the cached per-kind metadata into the
    per-request instance.
- **Why it's built this way**: the classification is expensive (reflection over every public property
  plus a data-source lookup) and stable per `(entity type, NavigationType)`, so the provider caches a
  built `NavigationMetadata` per key and copies ranges out of it into a fresh instance per request.
  A mutable builder with an immutable public face is what makes sharing the cached instance safe.
- **Where it's used**: built by
  [`NavigationMetadataProvider`](group-03-querying-specifications.md#navigationmetadataprovider),
  threaded through the [`EntityQueryPipeline`](group-03-querying-specifications.md#entityquerypipeline),
  and passed by value into every
  [`INavigationPopulator<in TEntity>`](#inavigationpopulatorin-tentity)'s `PopulateAsync`.
- **Caveats**: the populator contract takes the **concrete** `NavigationMetadata`, not
  [`INavigationMetadata`](#inavigationmetadata)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Navigation/INavigationPopulator.cs:22`). The
  interface therefore documents the shape but is not the type most consumers actually program
  against.

### INavigationPopulator<in TEntity>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces.Navigation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Navigation/INavigationPopulator.cs:9` · Level 4 · interface

- **What it is**: the manual-loading port for navigations EF `Include` cannot serve. An
  implementation receives a page of already-materialized entities and fills in their cross-source
  relationships.
- **Depends on**: [`NavigationMetadata`](#navigationmetadata) (Level 3, a parameter on the single
  method).
- **Concept reinforced, the consumer side of
  [ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html).** `[Rubric §2,
  Design Patterns]` (a Strategy resolved per entity type from DI) and `[Rubric §7, Microservices
  Readiness]` (when a module is extracted and the related entity lives in another service's database,
  this is how the navigation still gets filled, with no cross-database FK). The `in TEntity`
  **contravariance** annotation means a populator written against a base entity type satisfies a
  request for a derived one.
- **Walkthrough**: one method, `PopulateAsync` (lines 20-25), taking
  `IReadOnlyCollection<TEntity> entities`, a [`NavigationMetadata`](#navigationmetadata), the
  `includeFKs` / `includeChildren` pair, and a `CancellationToken`. Two design choices are load
  bearing. First, the parameter is the **whole page at once**, which is what makes batch loading
  possible: one query per navigation for all parents, instead of one per parent. Second, the two
  booleans mirror the caller's original include request, so a populator loads only what was asked for
  rather than everything it knows how to load.
- **Why it's built this way**: declaring the port in `Application` (not `Infrastructure`) keeps the
  query pipeline that invokes it free of EF; implementations reach storage through the repository
  abstractions, via [`NavigationLoader`](#navigationloader). See
  [ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html).
- **Where it's used**: injected into
  [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:37`, exposed as the
  `NavigationPopulator` property at line 93 with a null guard). The service does not call it directly:
  it passes the **method group** `NavigationPopulator.PopulateAsync` into the pipeline (lines 320 and
  534), which declares the parameter as a plain delegate
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:43`) and
  awaits it on the materialized page (line 199). Registered per closed entity type in module DI, for
  example `services.TryAddScoped<INavigationPopulator<Sponsor>, SponsorNavigationPopulator>()`-style
  registrations in each module's `DependencyInjection.cs`.

### NullNavigationPopulator<TEntity>
> MMCA.Common.Application · `MMCA.Common.Application.Services` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/NullNavigationPopulator.cs:11` · Level 5 · class (sealed, generic)

- **What it is**: the no-op [`INavigationPopulator<in TEntity>`](#inavigationpopulatorin-tentity),
  registered for entities whose navigations are all EF-resolvable so nothing needs manual loading.
- **Depends on**: [`INavigationPopulator<in TEntity>`](#inavigationpopulatorin-tentity) (Level 4) and
  [`NavigationMetadata`](#navigationmetadata) (Level 3, in the signature it satisfies).
- **Concept introduced, the Null Object pattern.** `[Rubric §2, Design Patterns]` (assesses idiomatic
  pattern use). Because
  [`EntityQueryService`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype)
  hard-requires a populator (it throws `ArgumentNullException` when the constructor argument is null,
  `MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:94`), every entity
  must have one registered. A null-object implementation lets the pipeline keep one uniform call site
  with no null checks and no conditional branch: branchless polymorphism.
- **Walkthrough**: a single expression-bodied method whose entire body is `=> Task.CompletedTask;`
  (lines 14-19). It accepts the full contract signature and ignores every argument. `sealed`, because
  there is nothing meaningful to extend.
- **Why it's built this way**: returning the already-completed `Task.CompletedTask` singleton (rather
  than `async` with no awaits) allocates nothing per call, so the no-op path costs essentially
  nothing on a hot query route (`[Rubric §12, Performance & Scalability]`).
- **Where it's used**: registered explicitly per closed entity type with `TryAddScoped` in module
  composition, for example
  `MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/DependencyInjection.cs:39` for
  `PushNotification`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/DependencyInjection.cs:47` for
  `Customer`, and
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/DependencyInjection.cs:54` for
  `InventoryItem`. Entities that do need cross-source loading register a
  [`DeclarativeNavigationPopulator<TEntity>`](#declarativenavigationpopulatortentity) subclass
  instead.
- **Caveats**: the doc comment (line 8) describes it as "registered as the default when a module does
  not provide a custom populator", but there is no open-generic fallback registration in the
  framework: each module registers this type explicitly for each entity that needs it. Forgetting the
  registration surfaces as a DI resolution failure, not as a silent no-op.

### NavigationLoader
> MMCA.Common.Application · `MMCA.Common.Application.Services` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/NavigationLoader.cs:21` · Level 6 · class (static)

- **What it is**: the batch-loading engine. Two static methods load a navigation for a whole
  collection of parents with a single `WHERE fk IN (...)` query each, and a cache keeps the compiled
  grouping delegates around.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (Level 3, the constraint on the child type),
  [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype)
  (Level 5, the read port it queries through). BCL: `System.Linq.Expressions` and
  `System.Collections.Concurrent`.
- **Concept introduced, runtime expression-tree composition as N+1 prevention.** `[Rubric §12,
  Performance & Scalability]` (assesses query efficiency and N+1 avoidance). Loading the category
  items for a page of 200 speakers one at a time is 200 round trips. `NavigationLoader` instead:
  (1) collects the distinct key values off the parent collection; (2) builds a
  `child => keys.Contains(child.Fk)` expression tree by hand, so EF can translate it to a single SQL
  `IN (...)`; (3) executes one repository call; (4) groups the results into a dictionary keyed by the
  FK and assigns each parent its slice. The expression tree is built rather than written as a lambda
  because the FK selector is supplied by the caller at runtime, so there is no compile-time lambda to
  write.
- **Walkthrough**
  - `CompiledExpressionCache` (line 27): a `static readonly ConcurrentDictionary<string, Delegate>`,
    process-wide, holding compiled selectors.
  - **`LoadFKPropertyAsync`** (line 44) handles the many-to-one direction (a parent holds a nullable
    FK to one child). Collects distinct non-null FK values (lines 54-59). If there are none it
    assigns every parent an empty list and returns without querying (lines 61-69). Builds the
    `Contains` call over the distinct id list (lines 72-78) and wraps it in an
    `Expression.Lambda<Func<TChildEntity, bool>>` (line 78). Runs one
    `GetAllAsync([], where: lambda, asTracking: false, ...)` (lines 80-84): the `[]` is the nested
    include list (none) and `asTracking: false` keeps the read out of the change tracker. Groups by
    the compiled selector (lines 87-90) and assigns per parent, empty list when the FK is null (lines
    92-99). Constraint `TChildIdentifierType : struct` (line 52) is what makes the nullable
    `TChildIdentifierType?` parent key legal.
  - **`LoadChildrenPropertyAsync`** (line 118) handles the one-to-many direction (children hold the
    FK back to the parent). Same four steps, keyed on the parent's own primary key, so there is no
    null filtering (lines 129-132) and the constraint is `TParentIdentifierType : notnull` (line 125)
    rather than `struct`.
  - **`GetOrCompileExpression`** (line 175) builds the cache key as
    `"{TSource.FullName}:{memberPath}"` and `GetOrAdd`s the compiled delegate.
  - **`GetMemberPath`** (line 188) walks the `MemberExpression` chain and joins the names with `.`,
    so the key is independent of the lambda's parameter name: `x => x.Category.Name` and
    `e => e.Category.Name` both key on `"Category.Name"` (the doc comment at lines 183-187 says so).
    A non-member body falls back to `expression.ToString()` (line 206).
- **Why it's built this way**: the predicate must stay an **expression** so EF translates it to
  server-side SQL, while the grouping selector must be a **compiled delegate** because it runs in
  memory over the materialized rows. Those are two different needs from the same
  `Expression<Func<TChild, TKey>>` argument, which is why the type both passes it to `Where` and
  compiles it. Caching the compiled form means the compilation cost is paid once per distinct
  selector for the life of the process. This is
  [ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)'s loading engine.
- **Where it's used**: called only through the two descriptor classes below
  ([`ChildNavigationDescriptor`](#childnavigationdescriptortentity-tparentid-tchild-tchildid) at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Navigation/ChildNavigationDescriptor.cs:41`
  and [`FKNavigationDescriptor`](#fknavigationdescriptortentity-tchild-tchildid) at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Navigation/FKNavigationDescriptor.cs:39`),
  which is how [`DeclarativeNavigationPopulator<TEntity>`](#declarativenavigationpopulatortentity)
  reaches it.
- **Caveats**: the `ToString()` fallback in `GetMemberPath` does include the parameter name, so two
  structurally identical non-member selectors written with different parameter names would occupy two
  cache entries. That is a duplicate entry, not a wrong result. The cache is unbounded, and its keys
  are derived from type names and member paths, both of which are finite per process.

### INavigationDescriptor<in TEntity>
> MMCA.Common.Application · `MMCA.Common.Application.Services.Navigation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Navigation/INavigationDescriptor.cs:10` · Level 8 · interface

- **What it is**: the declaration of one navigation that needs manual loading: what it is called,
  which include flag turns it on, and how to load it for a batch of parents.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (Level 7, passed into
  `LoadAsync` so the descriptor can resolve its own read repository rather than capturing one).
- **Concept introduced, the descriptor as a self-contained Strategy.** `[Rubric §2, Design Patterns]`
  (Strategy: one descriptor per navigation, interchangeable behind the interface) and `[Rubric §12,
  Performance]` (each `LoadAsync` is one batch query, not one per parent). The `in TEntity`
  contravariance mirrors [`INavigationPopulator<in TEntity>`](#inavigationpopulatorin-tentity)'s.
- **Walkthrough**
  - `PropertyName` (line 13): must match the EF/CLR property name, because
    [`DeclarativeNavigationPopulator<TEntity>`](#declarativenavigationpopulatortentity) matches it by
    string against [`NavigationMetadata.UnsupportedIncludes`](#navigationmetadata).
  - `RequiresChildren` (line 19): `true` means the caller's `includeChildren` gates this navigation,
    `false` means `includeFKs` does. One boolean instead of a
    [`NavigationType`](#navigationtype) value, because the populator only ever needs to pick between
    the two flags it was handed.
  - `LoadAsync(entities, unitOfWork, cancellationToken)` (lines 24-27): batch-loads the navigation for
    all parents. Taking `IUnitOfWork` as a parameter (rather than a constructor dependency) is what
    lets descriptors be plain `new`-ed object literals in a populator's base-constructor argument list.
- **Why it's built this way**: declaring each cross-source navigation as a small descriptor lets one
  generic populator serve every entity, and keeps the descriptor free of Infrastructure: it depends
  only on [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), an Application abstraction,
  and reaches storage through [`NavigationLoader`](#navigationloader) and the read repository
  ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)).
- **Where it's used**: implemented by
  [`ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>`](#childnavigationdescriptortentity-tparentid-tchild-tchildid)
  and [`FKNavigationDescriptor<TEntity, TChild, TChildId>`](#fknavigationdescriptortentity-tchild-tchildid);
  consumed as an `IReadOnlyList<INavigationDescriptor<TEntity>>` by
  [`DeclarativeNavigationPopulator<TEntity>`](#declarativenavigationpopulatortentity).

> The two concrete descriptors, `ChildNavigationDescriptor` and `FKNavigationDescriptor`, are a
> **structurally identical sibling pair**: both are sealed
> [`INavigationDescriptor<in TEntity>`](#inavigationdescriptorin-tentity) data objects with four
> `required init` members whose `LoadAsync` delegates to [`NavigationLoader`](#navigationloader). The
> `ChildNavigationDescriptor` section below teaches the shared shape in full;
> `FKNavigationDescriptor` (further down, after the populator that consumes them both) lists only
> what differs. They keep separate `###` headings so cross-links to each resolve.

### ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>
> MMCA.Common.Application · `MMCA.Common.Application.Services.Navigation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Navigation/ChildNavigationDescriptor.cs:15` · Level 9 · class (sealed)

- **What it is**: the one-to-many descriptor. It loads a child *collection* (for example
  `Speaker.SpeakerCategoryItems`) by fetching every child whose FK matches one of the parents'
  primary keys.
- **Depends on**: [`INavigationDescriptor<in TEntity>`](#inavigationdescriptorin-tentity) (Level 8,
  the interface it implements),
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (Level 3, the constraint on `TChild`),
  [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (Level 7, the source of the read
  repository), and [`NavigationLoader`](#navigationloader) (Level 6). BCL:
  `System.Linq.Expressions`.
- **Concept introduced, configuration objects made total by `required`.** `[Rubric §2, Design
  Patterns]` and `[Rubric §15, Best Practices & Code Quality]` (assesses whether the language's own
  guarantees are used instead of runtime checks). All four members are `required init`, so the
  compiler rejects a partially configured descriptor at the construction site; there is no validation
  code and no way to build an invalid one. `[Rubric §4, DDD]` also applies: the relationship is
  *declared* in the domain with [`NavigationAttribute`](#navigationattribute) and *loaded* in the
  Application layer here, with neither layer referencing EF.
- **Walkthrough**
  - `PropertyName` (line 22): `required`, matched by string against
    [`NavigationMetadata.UnsupportedIncludes`](#navigationmetadata).
  - `RequiresChildren => true` (line 25): a hardcoded expression-bodied property, so this descriptor
    is always gated on `includeChildren`.
  - `ParentKeySelector` (line 28): `Func<TEntity, TParentId>`, a plain delegate because it runs
    in memory over already-materialized parents.
  - `ChildForeignKeySelector` (line 31): `Expression<Func<TChild, TParentId>>`, an **expression**
    rather than a delegate because [`NavigationLoader`](#navigationloader) has to translate it into
    the EF `Where` predicate.
  - `AssignAction` (line 34): `Action<TEntity, List<TChild>>`, the write-back callback. Entities
    expose set-collection methods for this purpose, for example
    `AssignAction = (e, categoryItems) => e.SetSpeakerCategoryItems(categoryItems)` at
    `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/SpeakerNavigationPopulator.cs:20`.
  - `LoadAsync` (lines 37-47): a one-expression delegation to
    `NavigationLoader.LoadChildrenPropertyAsync`, resolving the child repository with
    `unitOfWork.GetReadRepository<TChild, TChildId>()` (line 45). Note the descriptor holds no
    repository of its own: it is a value that can be constructed in a field initializer and only
    touches storage when invoked.
  - Constraints (lines 17-19): `TParentId : notnull`, `TChild : AuditableBaseEntity<TChildId>`,
    `TChildId : notnull`.
- **Why it's built this way**: [ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)
  requires cross-source includes to bypass EF `Include` without the Application layer knowing about
  EF or the physical split. Making the descriptor a pure data object with a single delegating method
  is what lets a module declare its navigations as a collection literal in a constructor argument.
- **Where it's used**: constructed inline in per-entity populators, for example
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/SpeakerNavigationPopulator.cs:15`
  and `:22` (two child collections on `Speaker`), and
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/ConferenceCategoryNavigationPopulator.cs:15`.
  Consumed by [`DeclarativeNavigationPopulator<TEntity>`](#declarativenavigationpopulatortentity).

### DeclarativeNavigationPopulator<TEntity>
> MMCA.Common.Application · `MMCA.Common.Application.Services.Navigation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Navigation/DeclarativeNavigationPopulator.cs:14` · Level 9 · class

- **What it is**: the generic [`INavigationPopulator<in TEntity>`](#inavigationpopulatorin-tentity)
  that drives a list of [`INavigationDescriptor<in TEntity>`](#inavigationdescriptorin-tentity). It
  decides *when* each descriptor runs; the descriptors know *how*.
- **Depends on**: [`INavigationPopulator<in TEntity>`](#inavigationpopulatorin-tentity) (Level 4),
  [`INavigationDescriptor<in TEntity>`](#inavigationdescriptorin-tentity) (Level 8),
  [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (Level 7), and
  [`NavigationMetadata`](#navigationmetadata) (Level 3).
- **Concept introduced, declaration over implementation.** `[Rubric §2, Design Patterns]` (the
  descriptor list is a tiny declarative program that this class interprets by iteration) and
  `[Rubric §15, Best Practices & Code Quality]` (adding a cross-source navigation means adding one object literal
  to a collection expression, not writing a class). A module's populator is therefore a subclass with
  an empty body whose entire content is its base-constructor argument, as at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/SpeakerNavigationPopulator.cs:13-31`.
- **Walkthrough**
  - Primary constructor (lines 14-17): `IUnitOfWork unitOfWork` and
    `IReadOnlyList<INavigationDescriptor<TEntity>> descriptors`. Both are captured by the primary
    constructor and used only inside `PopulateAsync`.
  - `PopulateAsync` (line 20). The guard at line 27 returns immediately when `entities.Count == 0` or
    `navigationMetadata.UnsupportedIncludes.Count == 0`: if every navigation is EF-resolvable, this
    populator does no work at all, even for an entity that declares descriptors.
  - Lines 30-32 build a `HashSet<string>` of the unsupported include property names with
    `StringComparer.Ordinal`, making the per-descriptor membership test O(1) and case sensitive
    (ordinal, so `PropertyName` must match the CLR name exactly, which `nameof(...)` guarantees at
    every real call site).
  - Lines 34-41 iterate the descriptors in declaration order:
    `shouldLoad = descriptor.RequiresChildren ? includeChildren : includeFKs` (line 36), and the
    descriptor's `LoadAsync` is awaited only when `shouldLoad` **and** the descriptor's
    `PropertyName` is in the unsupported set (line 37). The two conditions are independent: the
    caller decides what it wants, the metadata decides what EF cannot do, and only the intersection
    is loaded.
  - `.ConfigureAwait(false)` on line 39 keeps the loop off the captured synchronization context.
- **Why it's built this way**: the descriptors are awaited **sequentially**, one query per navigation
  per page, which keeps a single `IUnitOfWork` (and therefore a single `DbContext`) safe to use, since
  EF Core forbids concurrent operations on one context. That is a correctness constraint, not an
  oversight: parallelizing here would require a repository per navigation.
  `[Rubric §12, Performance & Scalability]` still holds, because the cost is O(navigations) queries
  rather than O(parents).
- **Where it's used**: subclassed once per entity that has cross-source navigations, and the subclass
  registered as `INavigationPopulator<TEntity>` in module DI. ADC examples:
  [`SpeakerNavigationPopulator`](group-18-conference-application.md#speakernavigationpopulator)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/SpeakerNavigationPopulator.cs:13`),
  [`SponsorNavigationPopulator`](group-18-conference-application.md#sponsornavigationpopulator)
  (`.../Sponsors/SponsorNavigationPopulator.cs:14`), and
  [`CategoryItemNavigationPopulator`](group-18-conference-application.md#categoryitemnavigationpopulator)
  (`.../Categories/CategoryItemNavigationPopulator.cs:13`).
- **Caveats**: unlike the descriptors and
  [`NullNavigationPopulator<TEntity>`](#nullnavigationpopulatortentity), this class is deliberately
  **not** `sealed` (line 14), because subclassing is its intended usage pattern. It is also legal to
  subclass it with an empty descriptor list, which yields a populator that behaves like the null
  object; `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/OrderNavigationPopulator.cs:13`
  does exactly that with `[]`.

### FKNavigationDescriptor<TEntity, TChild, TChildId>
> MMCA.Common.Application · `MMCA.Common.Application.Services.Navigation` · `MMCA.Common/Source/Core/MMCA.Common.Application/Services/Navigation/FKNavigationDescriptor.cs:14` · Level 9 · class (sealed)

- **What it is**: the many-to-one sibling of
  [`ChildNavigationDescriptor`](#childnavigationdescriptortentity-tparentid-tchild-tchildid). It
  loads a single FK *reference* (for example `Sponsor.Event`) by matching each parent's nullable FK
  value against the child's key.
- **Depends on**: identical to its sibling:
  [`INavigationDescriptor<in TEntity>`](#inavigationdescriptorin-tentity),
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype),
  [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork),
  [`NavigationLoader`](#navigationloader), and `System.Linq.Expressions`.
- **Concept**: the same `required init` data-object Strategy taught in the
  [`ChildNavigationDescriptor`](#childnavigationdescriptortentity-tparentid-tchild-tchildid) section;
  only the differences are listed below.
- **Walkthrough, what differs**
  - Three type parameters instead of four (line 14): there is no `TParentId`, because the join runs
    on the child's own key type, which `TChildId` already names.
  - Constraint `TChildId : struct` (line 17) rather than `notnull`, because the parent's FK is
    nullable and `TChildId?` needs a value type.
  - `ParentKeySelector` is `Func<TEntity, TChildId?>` (line 26), nullable: a parent with no FK set
    simply receives an empty result.
  - `RequiresChildren => false` (line 23), so this descriptor is gated on `includeFKs`.
  - `LoadAsync` (lines 35-45) delegates to `NavigationLoader.LoadFKPropertyAsync` instead of the
    children overload; the `unitOfWork.GetReadRepository<TChild, TChildId>()` resolution (line 43) is
    identical.
  - `PropertyName` (line 20), `ChildForeignKeySelector` (line 29), and `AssignAction` (line 32) are
    declared exactly as on the sibling.
- **Where it's used**: constructed inline in per-entity populators for cross-source FK references, for
  example
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sponsors/SponsorNavigationPopulator.cs:16`
  (`Sponsor.Event`),
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/SpeakerCategoryItemNavigationPopulator.cs:15`,
  and
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Categories/CategoryItemNavigationPopulator.cs:15`.
  Consumed by [`DeclarativeNavigationPopulator<TEntity>`](#declarativenavigationpopulatortentity).
- **Caveats**: `AssignAction` is typed `Action<TEntity, List<TChild>>` (line 32), a **list**, even
  though this descriptor represents a single reference. That is because it shares
  [`NavigationLoader`](#navigationloader)'s assign signature with the collection case, so every real
  FK call site ends in `.FirstOrDefault()`, as at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sponsors/SponsorNavigationPopulator.cs:21`.
  Note also that the member named `ChildForeignKeySelector` is in practice the child's **primary
  key** selector on this path (`child => child.Id` at the same file, line 20): the FK lives on the
  parent side here, so the name describes the relationship, not the column being selected.


---
[⬅ Notifications (Push + In-App Inbox + Email)](group-10-notifications.md)  •  [Index](00-index.md)  •  [API Hosting, Middleware, Idempotency & DTO/Contract Mapping ➡](group-12-api-hosting-mapping.md)
