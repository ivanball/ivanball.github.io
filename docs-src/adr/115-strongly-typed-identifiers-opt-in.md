# ADR-115: Strongly Typed Identifiers as an Opt-In Capability, Aliases Still the Default

## Status
Accepted (2026-09-09).
**Revisits [ADR-048](048-primitive-identifier-type-aliases.md) and
[ADR-085](085-identifier-type-aliases-revisited.md)** by adding the capability those records deferred,
without migrating anything. ADR-048's decision (every entity identity is a primitive named through a
per-module `global using {Entity}IdentifierType = ...` alias) stays in force, and ADR-085's priced
deferral of a workspace-wide migration stays in force. What changes is that the wrapper struct is now
a first-class thing the framework supports, rather than a shape a team would have to hand-roll at six
boundaries.

## Context
ADR-048 chose primitive identifier aliases over wrapper structs. ADR-085 re-opened that choice on
2026-08-18, priced the migration in numbers (44 aliases, 43 of them `int`, 3,192 occurrences across
1,001 files), deferred again, and replaced the open-ended "not now" with three named revisit triggers:
a production defect traced to an identifier transposition, a greenfield fifth consumer, or a
cross-module identifier count that keeps climbing.

**None of the three has fired, and this record is not claiming otherwise.** The trigger here is a
different one: the 2026-09-09 framework gap analysis of what a .NET application framework is expected
to ship. The strongly typed identifier is named in four separate "modern .NET building blocks" lists
and is present in five of the surveyed repositories, two of them through Vogen with an ADR of their
own. It is the only tactical-DDD building block MMCA.Common still lacks. That is a statement about
the framework's surface, not about the four repositories' identifier model, and the two are answered
separately: the framework ships the capability, and the aliases stay the default.

This is exactly the posture [ADR-104](104-smart-enums-as-opt-in-capability.md) records for
smart enumerations. A plain CLR enum is the default there; `Enumeration<T>` is complete, tested,
wired into JSON and EF Core, and adopted by nothing. That record's own argument applies verbatim
here: the default should be the cheap type, the expensive case still needs an answer, and a
capability that is ready is what stops the first team that needs it from arriving with a hand-rolled
variant, its own JSON shape and its own `HasConversion` lambda pair.

The framework's generic parameter already admits a wrapper. `BaseEntity<TIdentifierType>` constrains
its identifier only to `notnull`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/BaseEntity.cs:34-37`), and
`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>` and `IBaseDTO<TIdentifierType>` do the
same (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:45`,
`MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/IBaseDTO.cs:9-10`). A `readonly record struct`
satisfies `notnull`, so nothing in the entity, DTO or controller hierarchy had to change and no
shipped signature moved. What was missing was everything around the type: JSON, EF Core mapping,
MVC route and query binding, filtering, OpenAPI and object mapping.

## Decision
**The framework ships strongly typed identifiers as an opt-in capability. The primitive aliases
remain the default identifier model, no existing entity, consumer or test migrates, and nothing in
the framework pushes a consumer toward a wrapper.**

1. **The declaration is two lines, and the second one is a factory.**
   `IStronglyTypedId<TSelf, TValue>`
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/IStronglyTypedId.cs:60`) is
   self-referencing (`TSelf : struct, IStronglyTypedId<TSelf, TValue>`, `:61-62`) and declares
   exactly two members: a `TValue Value` getter (`:65`) and `static abstract TSelf From(TValue)`
   (`:72`). A wrapper is therefore:
   ```csharp
   public readonly record struct OrderId(int Value) : IStronglyTypedId<OrderId, int>
   {
       public static OrderId From(int value) => new(value);
   }
   ```
   The positional record struct supplies `Value`, structural equality, `GetHashCode`, `ToString` and
   `Deconstruct`; the interface supplies the rest.

2. **`IParsable<TSelf>` comes for free, as an explicit default implementation.** The interface
   derives from `IParsable<TSelf>` (`:60`) and implements both legs by forwarding to the shared
   helper (`:82-83`, `:94-98`). The one visible consequence is that those implementations are
   EXPLICIT, because that is the only form a default implementation of an inherited static abstract
   member can take: `OrderId.Parse("42", null)` does not compile against the wrapper, and a caller
   parses through `StronglyTypedId.Parse<OrderId, int>(text, provider)` or from any generic context
   constrained to `IParsable<T>`. This is documented on the interface (`:29-40`) and is not a defect;
   every framework boundary reaches the implementation through the interface.

3. **Four primitives are supported end to end, and the parse path is built once per primitive.**
   `StronglyTypedId.TryParse<TSelf, TValue>`
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedId.cs:63`) defaults a null
   provider to `CultureInfo.InvariantCulture` (`:68`), because a route segment is never
   culture-formatted. `StronglyTypedIdValueParser<TValue>` (`:173`) builds the parser once per closed
   primitive in a static initializer (`:180`): `string` takes an identity path, since it is the one
   supported primitive that does not implement `IParsable<string>` (`:188-191`), and everything else
   binds a closed `IParsable<T>.TryParse` (`:193-200`). `int`, `long`, `Guid` and `string` are
   covered; any other `IParsable` primitive parses too.

4. **JSON is the bare primitive, through a factory registered once.**
   `StronglyTypedIdJsonConverterFactory`
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedIdJsonConverterFactory.cs:22`)
   converts only a type that implements the contract for itself, and its nested converter serializes
   `value.Value` and reads the primitive back through `From`. Dictionary keys are covered too, so
   `Dictionary<OrderId, T>` serializes exactly like `Dictionary<int, T>` (`:53-70`). `AddAPI` adds
   the factory to `JsonSerializerOptions.Converters` beside `EnumerationJsonConverterFactory`
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:65`, rationale at
   `:60-64`), for the same reason ADR-104 gives: an attribute would have to be repeated on every
   wrapper a consumer declares.

5. **MVC route and query binding goes through a `TypeConverter`, not through `IParsable`.** That is
   the empirical finding this record exists to write down: minimal APIs bind through
   `IParsable<T>`, but an MVC `[FromRoute]` or `[FromQuery]` scalar binds through
   `TypeDescriptor.GetConverter`, so `GET /orders/42` does not bind without one.
   `StronglyTypedIdTypeConverter<TSelf, TValue>`
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedIdTypeConverter.cs:21`)
   converts to and from both text and the primitive, and delegates its text leg to the same
   `IParsable` implementation, so both routes parse identically.
   `StronglyTypedIdTypeConverters.Register` / `.RegisterAll` (`:89`, `:108`) register it through
   `TypeDescriptor.AddAttributes`, so no `[TypeConverter]` attribute is needed on a consumer's
   wrapper.

6. **One call is the whole opt-in.**
   `services.AddStronglyTypedIds(typeof(OrderId).Assembly)`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:770`) scans the named
   assemblies for wrappers, registers the `TypeConverter` for each, and registers a
   `StronglyTypedIdRegistry` singleton
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedIdRegistry.cs:22`). A host
   that never calls it keeps the aliases and sees no behavioural change anywhere.

7. **EF Core maps a wrapper as a PRE-CONVENTION type mapping, registered once on the base
   context.** `ApplicationDbContext.ConfigureConventions` resolves the registry with `GetService` and
   applies it
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:333-335`);
   `StronglyTypedIdModelConfiguration.Apply`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/StronglyTypedIdModelConfiguration.cs:29`)
   declares `configurationBuilder.Properties(identifierType).HaveConversion(converterType, comparerType)`
   for each. Because it is the ONE base context every engine context inherits, SQL Server,
   PostgreSQL, SQLite and Cosmos all get the mapping with no engine branch, and it reaches every
   property of that type: keys, cross-module scalar references and owned-type members alike.
   Pre-convention rather than a model-finalizing convention is load-bearing: a converter attached at
   finalization arrives after the provider's value-generation conventions have inspected the
   property, and a wrapped `int` key would silently lose its store-generated strategy
   (`StronglyTypedIdModelConfiguration.cs:13-19`).

8. **The column stays the primitive, so adoption is not a migration.**
   `StronglyTypedIdValueConverter<TSelf, TValue>`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/StronglyTypedIdValueConverter.cs:28`)
   writes `Value` and reads through `From`; both legs go through a static helper rather than an
   inline lambda body, because a static abstract interface member cannot be invoked inside an
   expression tree (`:22-23`, `:40-42`). `NullableStronglyTypedIdValueConverter<TSelf, TValue>`
   (`:56`) is the explicit optional-property form, and `StronglyTypedIdValueComparer<TSelf>` (`:80`)
   gives snapshot and equality semantics through `EqualityComparer<T>.Default`, which resolves to the
   record struct's compiler-generated `IEquatable<T>` rather than boxing.

9. **Filtering, sorting and lookup keep speaking primitives.**
   `StronglyTypedIdFilterStrategy<TSelf, TValue>`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/StronglyTypedIdFilterStrategy.cs:24`)
   parses the primitive the client sends, wraps it, and compares wrapper to wrapper so EF's converter
   turns both sides into the same column. It supports the equality family only (EQUALS, NOT EQUALS,
   IN, IS EMPTY, IS NOT EMPTY, `:28-31`): a record struct declares `==` and `!=` and nothing else, so
   there is no `>` to build a range predicate from, and an ordering operator on a wrapped column is
   refused by `ValidateFilters` as a 400 rather than silently widening the result set.
   `QueryFilterService.ResolveStrategy` builds and memoizes the strategy on first use
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Filtering/QueryFilterService.cs:396-407`),
   so a consumer never calls `RegisterStrategy` per identifier. Sorting is untouched: an `ORDER BY`
   over a converted column is the primitive's ordering
   ([ADR-034](034-generic-entity-query-layer.md) sort keys).

10. **OpenAPI documents a wrapper as its primitive, in two places.**
    `StronglyTypedIdSchemaTransformer`
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/OpenApi/StronglyTypedIdSchemaTransformer.cs:24`)
    rewrites the DTO schema, which the default generator would otherwise emit as an object with a
    `value` member. `StronglyTypedIdParameterTransformer` (`:74`) does the same for route and query
    parameters, which a schema transformer never sees: MVC's API explorer describes a
    `TypeConverter`-bound parameter as a plain string. Both are registered by `AddCommonOpenApi`
    across every versioned document
    (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:504-505`).

11. **Mapperly needs nothing in the normal case and one attribute in the other.** A DTO implements
    `IBaseDTO<TIdentifierType>` over the SAME identifier type its entity uses, so a wrapper maps to
    itself as a plain assignment. For a contract that deliberately keeps primitives on the wire,
    `StronglyTypedIdMappings<TSelf, TValue>`
    (`MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedIdMappings.cs:31`) supplies
    the four conversions (`:38`, `:43`, `:48`, `:53`) as plain public static methods, reached with
    `[UseStaticMapper(typeof(StronglyTypedIdMappings<OrderId, int>))]`. They carry no Mapperly
    attribute, so the Shared layer takes no dependency on `Riok.Mapperly.Abstractions`.

12. **A fitness rule holds the shape, and passes vacuously today.**
    `StronglyTypedIdsAreReadonlyRecordStructs`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Domain/ArchitectureRules.StronglyTypedIds.cs:34`)
    flags a wrapper that is not a struct, is not `readonly`, is not a record, or declares instance
    state beyond the wrapped value. It is exposed by `StronglyTypedIdTestsBase`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Domain/StronglyTypedIdTestsBase.cs:9`)
    and subclassed in MMCA.Common's own architecture tests, where it is satisfied by having nothing
    to check. It exists to hold the FIRST wrapper any repo declares to the shape the converters,
    comparer and route binding are written against. The rule is deliberately separate from
    `ValueObjectsAreImmutableSealedInShared`: an identifier is not a `ValueObject` derivative, it has
    no validation to fail and no `Result`-returning `Create` factory, which is the same reasoning
    ADR-104 records for `Enumeration<T>` sitting outside that rule.

13. **Adoption is zero and this record says so.** No production type in MMCA.Common, MMCA.Store,
    MMCA.ADC, MMCA.Helpdesk or the MMCA.ECommerce sample implements `IStronglyTypedId<,>`. The only
    implementations anywhere are the fixtures in six of the framework's own test files. The 44
    aliases ADR-085 counted are untouched, and no consumer needs a version-bump behaviour change:
    without a call to `AddStronglyTypedIds`, every framework site that reads the registry treats its
    absence as "no wrappers in use".

14. **The contract is pinned by 77 executed tests, not by adoption.** Shared: 33 executed cases
    across `StronglyTypedIdTests.cs`, `StronglyTypedIdSerializationTests.cs` and
    `StronglyTypedIdTypeConverterTests.cs` (equality, the compile-time separation of two
    same-primitive identifiers, parsing, JSON round trips including null, nesting, collections and
    dictionary keys, and the `TypeDescriptor` registration). Infrastructure: 21 in
    `StronglyTypedIdPersistenceTests.cs` (9 facts plus four theories over the three relational
    engines), including per-engine model assertions for SQLite, SQL Server and PostgreSQL, a SQLite
    round trip that inserts through a real database and reads a generated wrapped `int` key back, a
    raw-column read proving the stored value is the primitive, and filter and sort translated to SQL.
    Application: 13 across the filter strategy and a Mapperly test mapper that maps both ways in both
    DTO shapes. API: 5 over a started in-memory host running the real `AddAPI` + `AddCommonOpenApi`
    pipeline (route binding, query binding, the 400 for an unparseable segment, a JSON body, and the
    OpenAPI document). Architecture: 5, being 4 fixture-driven checks that the rule flags a
    non-record, a mutable record struct and a wrapper carrying extra state and says nothing about the
    two compliant shapes, plus the vacuous run of the shared base over the framework's own
    assemblies.

## Rationale
- **The gap was the plumbing, not the type.** A `readonly record struct` wrapping an `int` is four
  lines any team can write. What stops teams is the six boundaries around it: EF mapping and value
  generation, JSON, MVC binding, OpenAPI, filtering and object mapping. Shipping those once is the
  whole value, and it is the part a hand-rolled variant gets subtly wrong.
- **Recording an unadopted capability is cheaper than discovering it twice.** ADR-104 made this call
  for smart enumerations and [ADR-037](037-field-level-encryption-at-rest.md) for the encryption
  converter. The alternative, leaving the code in place with no record, reads as unfinished adoption
  to the next reader.
- **The aliases are still right for the four repos.** ADR-085's arithmetic did not change: 3,192
  occurrences across 1,001 files, no incident traced to a transposition, and a partial migration
  worse than either endpoint. Nothing here proposes moving any of it.
- **A greenfield consumer now has a first-class path.** ADR-085's second trigger says a new
  application on the framework pays none of the migration cost and is the right place to build
  wrappers first. That path now exists as one DI call rather than as a research project, which is
  what would have made the trigger expensive to act on.
- **Pre-convention beats a finalizing convention, and the difference is invisible until it bites.**
  A converter attached at model finalization leaves a wrapped `int` key with no store-generated
  strategy, which surfaces as rows inserted with a zero key rather than as an error. Declaring the
  mapping before EF picks the strategy is what makes a wrapped key behave exactly like the primitive
  did, and the per-engine tests assert it explicitly.
- **The wire and the schema are unchanged, which is what makes the switch reversible.** JSON is the
  bare primitive and the column is the primitive, so a property can become a wrapper and go back
  without a contract change or a migration, exactly as ADR-104 argues for the smart-enum column.

### Alternatives considered
- **Vogen (or another source generator).** Two of the surveyed repositories use it, and it would have
  removed the `From` line from the declaration and generated the converters. Declined for two
  reasons. First, dependency placement: a generator package would sit in `MMCA.Common.Shared` and
  therefore in the transitive graph of every consumer's Domain layer, which is the layer this
  workspace keeps most deliberately dependency-free. Second, the ergonomic gap is one line: a
  `readonly record struct` plus a `static abstract` factory on the interface gives the same call-site
  experience, and the framework still has to own the EF, JSON, MVC, OpenAPI and Mapperly wiring,
  because those are decisions about THIS framework's boundaries rather than about the wrapper type.
  Choosing a generator would have added a dependency and kept all of the work.
- **A model-finalizing EF convention instead of a pre-convention type mapping.** It would have
  discovered wrappers from the model with no registry and no `AddStronglyTypedIds` call, which is
  more convenient. Declined because it runs after the provider's value-generation conventions and
  silently costs a wrapped `int` key its store-generated strategy.
- **Making a wrapper a `ValueObject` derivative.** Declined for the reason ADR-104 gives for
  `Enumeration<T>`: the value-object fitness rule requires a sealed record with a `Result`-returning
  `Create` factory, and an identifier has nothing to validate. A wrapper gets its own rule instead.
- **Migrating the aliases.** Out of scope by construction. ADR-085 priced it and deferred it, and
  none of its three triggers has fired.

## Trade-offs
- **Two identifier styles can now coexist in one codebase, and nothing prevents that.** A repo can
  wrap some identifiers and leave others primitive, and the reader cannot tell from the absence of a
  compiler error whether a call site is protected. ADR-085 named that as the reason the migration is
  all-or-nothing; this record does not fix it, it only makes the wrapped half possible. The rule in
  Decision point 13 (adopt nothing) is prose, not a fitness function.
- **The ADR-085 transposition risk is only closed for adopters.** `CheckIn`'s five consecutive
  identifier parameters
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/CheckIns/CheckIn.cs:57-64`) are
  still five `int`s. Shipping the capability does not retire the risk; it makes retiring it a choice
  someone can now make cheaply for one aggregate at a time.
- **A capability nobody uses is a capability nobody has stress-tested.** 77 tests against fixtures
  are not a production module with real migrations, a real wire history and a real query surface.
  The same honesty ADR-104 applies to `Enumeration<T>` applies here.
- **The `IParsable` implementations are explicit, so `OrderId.Parse(...)` does not compile.** That is
  the price of the two-line declaration: a default implementation of an inherited static abstract
  member has no non-explicit form. A wrapper that wants the pair publicly adds two forwarding lines.
- **Ordering filters are unsupported on a wrapped column.** A record struct has no `>`, so GREATER
  THAN and BETWEEN are refused with a 400 where the same column as a primitive accepted them. That
  is a deliberate narrowing, and it is a behaviour difference a client would notice if a column
  changed type.
- **Public API surface with no consumer.** The 55 declarations these types add across Shared,
  Infrastructure, API and Testing.Architecture are now in the unshipped baselines and become frozen
  at the next release under [ADR-015](015-architecture-fitness-functions.md)'s RS0016/RS0017 gate.
  Removing any of it later is a breaking change to the package surface.
- **EF discovery needs the type list up front.** The mapping has to be declared pre-convention, and
  at `ConfigureConventions` time no entity type exists yet, so the framework cannot discover wrappers
  from the model. `AddStronglyTypedIds` therefore takes assemblies: a host that declares a wrapper in
  an assembly it forgets to name gets EF's "the database provider does not support this type" at
  model build, which is loud but not self-explanatory.
- **`TypeDescriptor` registration is process-global.** `StronglyTypedIdTypeConverters.Register` calls
  `TypeDescriptor.AddAttributes`, which is not scoped to a host. In a process running two hosts (an
  in-memory test server pair) the registration is shared. It is idempotent, so the practical effect
  is nil, but it is not per-container state.

## Related
[ADR-048](048-primitive-identifier-type-aliases.md) (the primitive alias decision this record leaves
in force),
[ADR-085](085-identifier-type-aliases-revisited.md) (the priced deferral and its three revisit
triggers, none of which is the trigger here),
[ADR-104](104-smart-enums-as-opt-in-capability.md) (the posture this record copies exactly:
the framework ships the capability, the default does not move, and adoption is zero by design),
[ADR-006](006-database-per-service.md) (the cross-module scalar reference that concentrates the
transposition risk a wrapper closes),
[ADR-013](013-result-pattern.md) (the `Result` posture the parse helpers deliberately do NOT follow,
because `IParsable<T>` is a framework contract that throws),
[ADR-015](015-architecture-fitness-functions.md) (the public-API baseline that will freeze this
surface, and the fitness-function library the new rule joins),
[ADR-034](034-generic-entity-query-layer.md) (the sort, filter and lookup key contract a wrapped
column has to keep speaking),
[ADR-113](113-postgresql-as-a-first-class-engine.md) (the fourth engine the one base-context
registration reaches without an engine branch).
