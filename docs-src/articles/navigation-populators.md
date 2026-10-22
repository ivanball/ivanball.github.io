# EF Core Include chains are a trap: navigation populators decouple eager loading

> Series: MMCA.Common · Article #12 · Pillar P2/P3 · Group G11 · Rubric §8 · ADR-002 ·
> Status: grounded in `Website/docs-src/adr/002-navigation-populators.md` (revised 2026-10-06), `Website/docs-src/onboarding/group-11-navigation-populators.md`,
> and `MMCA.Common/CLAUDE.md` (cross-source degrade convention). No em dashes.

**Subtitle:** `Include(x).Include(y).ThenInclude(z)` couples your read model to one physical database.
Here is the eager-loading boundary that batch-loads related data and survives service extraction.

---

You write a query handler, you need the related rows, and EF Core hands you the obvious tool:

```csharp
var events = await _db.Events
    .Include(e => e.Rooms)
    .Include(e => e.EventSpeakers).ThenInclude(es => es.Speaker)
    .Include(e => e.EventQuestionAnswers)
    .ToListAsync();
```

It compiles. It works on your laptop against one SQL Server. And it has quietly made three decisions
you did not mean to make.

First, you asked the database to JOIN every one of those relationships into a single result set. For a
parent with several child collections, that is a cartesian product: rows multiply, the wire payload
balloons, and a list query that should return a page of events drags back a cross-product of rooms,
speakers, and answers. Second, you coupled the read model directly to the EF model. The shape of the
query now depends on the navigation properties EF knows about, so the day the physical storage changes,
the query changes with it. Third, and this is the one that bites later, you assumed every navigation
can be satisfied by a JOIN. The moment two related entities live in different physical data sources,
that assumption is false and `Include` simply cannot produce a JOIN.

## Why it matters

The cartesian explosion is the famous failure, and EF Core has a fix for it (`AsSplitQuery`), but
split query is a band-aid on the deeper problem: `Include` is a JOIN, and a JOIN only exists inside one
database.

A modular monolith that intends to extract modules into services later (the whole thesis of this
framework) is built database-per-service from day one (ADR-006). Two entities that are related in the
domain model can sit in different SQL databases, or one can live in a Cosmos container that has no
JOINs at all. The relationship is real. The physical storage cannot satisfy it in one query. An
`Include` chain that assumed otherwise does not degrade gracefully here. It breaks.

There is also a quieter coupling cost even when everything lives in one database. Every `Include` chain
is application code reaching down to name EF navigation properties. The read pipeline now knows the
persistence topology. When you split a module out, you have to hunt down and rewrite every one of those
chains. That is exactly the rewrite the framework exists to avoid.

## The MMCA answer: classify, then batch-load through a populator

MMCA.Common splits the question into three responsibilities that live in three different layers, and
no EF knowledge leaks upward.

The Domain layer declares only *what relationships an entity has*. A navigation property is tagged with
a plain `[Navigation]` attribute (`NavigationAttribute`) carrying one `IsCollection` flag (child
collection versus FK reference). The domain entity stays persistence-ignorant: zero EF dependency.

The Application layer decides *which navigations EF can actually load*. `NavigationMetadataProvider`
reflects over the entity's `[Navigation]`-tagged properties and, for each, asks the Infrastructure
boundary `IDataSourceService.HaveIncludeSupport` (passing the two entities' full type names) whether both
ends resolve to the same physical source on a relational engine. The result is a split:
`SupportedIncludes` (EF can JOIN these: one source, relational engine) and `UnsupportedIncludes` (these
need manual loading: the ends are split, either entity has no registered source, or the engine is Cosmos
DB, which has no JOINs even inside one container). Crucially, the Application
layer never references `Microsoft.EntityFrameworkCore` to make that call. The only component that knows
the physical topology is the data-source service at the Infrastructure edge.

The Application layer does the actual *batch loading*, through the populator (`INavigationPopulator<T>`
and `NavigationLoader` both live in `MMCA.Common.Application`; the EF execution they call is injected
from Infrastructure, so the populator itself never touches `Microsoft.EntityFrameworkCore`). Each entity with
cross-source navigations implements `INavigationPopulator<TEntity>`. An entity read through the generic
`EntityQueryService` that has none gets `NullNavigationPopulator<TEntity>`, a textbook Null Object whose
`PopulateAsync` is one `Task.CompletedTask`, so the pipeline always has something to call and never
branches on null.

```csharp
// The query pipeline runs a two-path strategy (EntityQueryPipeline):
//
// Path 1 - SupportedIncludes exist:
//   each becomes an EF .Include(); if any is a child collection, switch to AsSplitQuery()
//   (a single-query collection-Include + pagination truncates child rows - real bug, fixed here)
//
// Path 2 - UnsupportedIncludes exist:
//   sort + paginate the BASE query server-side (load only the requested page),
//   materialize it, THEN invoke the navigation populator on that one page.
//
// The populator never runs as an N+1: it pays the manual-load cost on one page of
// parents, not the whole table.
```

The batch loading itself is the part that kills N+1. `NavigationLoader` collects the distinct keys
across all parents on the page, builds a `WHERE childFK IN (...)` predicate as an expression tree at
runtime (so it translates to one SQL statement), runs it once through a read repository, groups the
results into a lookup, and assigns each parent its slice. That is one query per cross-source
navigation for the whole batch, then O(1) assignment per parent. The compiled grouping selectors are
cached, so repeated calls skip `Expression.Compile()`.

Writing that classify-and-load boilerplate by hand means repeating the same checks in every populator: is
this navigation requested, is it unsupported, which loader applies. The declarative layer removes it. A navigation is described once as an
`INavigationDescriptor<TEntity>` (a `ChildNavigationDescriptor` for collections, an
`FKNavigationDescriptor` for references), and `DeclarativeNavigationPopulator<TEntity>` drives a list of
them. A real consumer in ADC's Conference module, `EventNavigationPopulator`, is just a subclass
constructed with three `ChildNavigationDescriptor`s for `Rooms`, `EventSpeakers`, and
`EventQuestionAnswers`. No imperative loading code at all. Adding a new cross-source navigation is "add
one descriptor," not "write a new class."

## The boundary that survives extraction

Here is why this is not over-engineering. When you split a module out and a relationship's two ends move
to different physical sources, the EF model's `CrossDataSourceDegradeConvention` drops the FK constraint
and the navigations from the model (the scalar FK columns and a compensating index survive; the foreign
entity type is removed). Independently, `NavigationMetadataProvider` reads the same entity-to-source
registry and starts reporting that navigation as `Unsupported`, so the query pipeline routes it to the
populator path. The populator loads it once it carries a descriptor for that navigation: a declarative
populator only loads the unsupported navigations it declares, and an entity still on
`NullNavigationPopulator` returns the navigation unloaded, so extraction means adding that one
descriptor, not rewriting the query.

The application code that issued the query never changes. The read handler still asks for events with
their rooms and speakers. Before extraction, EF JOINs them. After extraction, the populator batch-loads
them across the source boundary. Cross-source consistency is the outbox's job; cross-source eager
loading is the populator's job. Neither is a JOIN, and neither requires you to rewrite the query.

This is the same line that runs through the whole framework: the transport choice (one database or two)
lives at the edge, and your business logic does not know which it got.

## Trade-offs, honestly

ADR-002 names the rough edges rather than hiding them.

- **Extra abstraction for the single-database case.** For a pure single-SQL-Server host where `Include`
  always works, the populator is a layer you do not strictly need. It is mitigated by being free at
  runtime there: the populator is only invoked when the metadata actually reports an unsupported
  include, and otherwise the `NullNavigationPopulator` no-ops. You pay in concepts, not in cycles.
- **Every entity read through the generic query service needs a populator, even a no-op one.** Such
  entities that need no manual loading still require `NullNavigationPopulator<TEntity>` (or an empty
  declarative one) so the pipeline has something to call. That is a registration line per entity;
  entities queried only through a repository can skip it.
- **The classification is runtime reflection (cached).** The supported/unsupported split is computed by
  reflecting over properties, then cached per `(entity type, navigation kind)`. The first query for a
  shape pays the reflection cost once.
- **It is eager loading, not a general ORM.** This is a deliberate, narrow boundary for cross-source eager
  loading on a paged read. It is not trying to replace EF for the co-located case, and it does not give
  you cross-source JOINs (those do not exist); it gives you batch loads.

## Apply this even without MMCA

The pattern ports to any stack that might outgrow one database:

1. **Stop assuming a relationship is a JOIN.** Treat "can these two be loaded together in one query?"
   as a runtime capability question, not a static fact baked into your read code.
2. **Batch-load, never N+1.** When you cannot JOIN, collect the parent keys and issue one
   `WHERE fk IN (...)` per relationship, then assign in memory. One query per relationship for the whole
   page beats one query per parent.
3. **Keep the topology knowledge at one edge.** The component that knows which entity lives where should
   be the only one that knows. Everything above it asks "what should be loaded," not "where does it
   live."
4. **Make the extension point declarative.** Describe each loadable relationship once as data (name, key selectors,
   assign callback) and drive a list of them, so adding a relationship is a one-liner, not a new class.

The rule of thumb: an `Include` chain is a promise that two things share a database. If you might ever
break that promise, do not encode it in your query code.

---

**What we covered:** why `Include` chains couple your read model to one physical database and break
across data sources, how MMCA.Common classifies navigations as supported or unsupported and routes the
unsupported ones through `INavigationPopulator` batch loading, and why that same boundary lets a
cross-source relationship degrade automatically when a module is extracted, with no query rewrite.

**Next in the series:** optimistic concurrency, where a database-managed RowVersion round-trips from the
row into the DTO and back through the client so two concurrent edits surface as a 409 instead of a silent
lost update.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-002 behind this
pattern, or `dotnet add package MMCA.Common.API` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- ADR-002 (navigation populators): `Website/docs-src/adr/002-navigation-populators.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, Entity Framework Core, Microservices*

*Notes: verified type/behavior names: `NavigationAttribute`/`[Navigation]`, `IsCollection`,
`NavigationMetadataProvider`, `IDataSourceService.HaveIncludeSupport`, `SupportedIncludes`/
`UnsupportedIncludes`, `EntityQueryPipeline` (Path 1 `AsSplitQuery`, Path 2 populator delegate),
`NavigationLoader` (`WHERE FK IN (...)` expression-tree batch load), `INavigationPopulator<TEntity>`,
`NullNavigationPopulator<TEntity>`, `DeclarativeNavigationPopulator<TEntity>`,
`ChildNavigationDescriptor`/`FKNavigationDescriptor`, `CrossDataSourceDegradeConvention`,
`EventNavigationPopulator` (ADC Conference). Trade-offs drawn from ADR-002 and
`group-11-navigation-populators.md`, stated as trade-offs, not hidden.
Re-verified 2026-10-22 against MMCA.Common v1.250.0 (`MMCA.Common/FACTS.md:14`); paths under
`Source/` are relative to `MMCA.Common/`.
**2026-10-22 run (v1.250.0):** four body corrections. (1) The "30 to 40 lines per entity" figure is
gone, matching ADR-002's 2026-10-06 revision that drops it as overstated
(`Website/docs-src/adr/002-navigation-populators.md:32`). (2) `HaveIncludeSupport` takes entity full
names, not types (`NavigationMetadataProvider.cs:96`, string overload `IDataSourceService.cs:70`), and
is supported only for the same `DataSourceKey` on a relational engine, false when either entity is
unregistered (`DataSourceService.cs:31-32,35-38`); co-located Cosmos navigations are unsupported
(ADR-002:6,9). (3) The populator requirement is scoped to entities read through `EntityQueryService`
(ctor `EntityQueryService.cs:37`, null guard `:94`); ADC registers none for PointsEntry,
LeaderboardOptIn, CheckIn and AttendeeBadge (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/DependencyInjection.cs:81-83`).
(4) "picks it up automatically" became a precise account: the degrade convention and the metadata
provider each read the registry, the pipeline routes unsupported includes to the populator
(`EntityQueryPipeline.cs:53-54`), and a declarative populator loads only declared unsupported
properties (`DeclarativeNavigationPopulator.cs:30-37`) while the Null Object loads nothing
(`NullNavigationPopulator.cs:19`).
Anchors confirmed this run: `NavigationAttribute.cs:10` (`IsCollection` `:16`),
`NavigationMetadataProvider.cs:20` (cache keyed by `(Type, NavigationType)` `:28`),
`EntityQueryPipeline.cs:132-142` (Path 1, `AsSplitQuery` on a child collection `:141-142`),
`:176-201` (Path 2 sort, page, materialize, then populate), `NavigationLoader.cs:21` (expression-tree
`Contains` predicate `:71-75,144-148`, `GroupBy` `:89,162`, compiled-selector cache `:27,178-180`),
`INavigationPopulator.cs:9`, `NullNavigationPopulator.cs:11`, `DeclarativeNavigationPopulator.cs:14`,
`ChildNavigationDescriptor.cs:15`, `FKNavigationDescriptor.cs:14`,
`CrossDataSourceDegradeConvention.cs:10-34`, ADC `EventNavigationPopulator.cs:11-31`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/`).*

- Full series index: https://ivanball.github.io/writing.html
