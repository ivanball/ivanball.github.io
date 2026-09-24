# Kill the anemic domain model: rich aggregates with factory methods that return Result

> Series: MMCA.Common · Article #5 · Pillar P2 · Group G02 · Rubric §4 · ADR-068 · ADR-115 ·
> Status: grounded in `MMCA.Common/CLAUDE.md` (the "Entity Model" section, which also covers the
> identifier aliases), `Website/docs-src/onboarding/group-02-domain-building-blocks.md`,
> `Website/docs-src/adr/068-value-objects-as-validated-primitives.md` and
> `Website/docs-src/adr/115-strongly-typed-identifiers-opt-in.md`. No em dashes.

**Subtitle:** Public setters plus logic-in-services is not a domain model, it is a database row with
extra steps. Here is the three-rung entity hierarchy in MMCA.Common that makes invalid state
unconstructable.

---

You have seen this class. You have probably written it. Maybe this week:

```csharp
public class Order
{
    public int Id { get; set; }
    public OrderStatus Status { get; set; }
    public decimal Total { get; set; }
    public List<OrderLine> Lines { get; set; } = new();
}

public class OrderService
{
    public void Ship(Order order)
    {
        if (order.Status != OrderStatus.Paid)
            throw new InvalidOperationException("Cannot ship an unpaid order");
        order.Status = OrderStatus.Shipped;
    }
}
```

The `Order` is a bag of public setters. It knows nothing and protects nothing. Anyone can set
`Status = Shipped` directly and skip the check. Anyone can set `Total` to a negative number. The rule
about not shipping an unpaid order lives in a *service*, off to the side, where it is one of many such
services that all reach into the order and mutate it from outside.

Martin Fowler named this the anemic domain model, and the name is precise: the objects have data but no
behavior. The behavior has been drained out into a procedural layer. You get all the ceremony of
object orientation (classes, properties, a "domain" folder) with none of its protection. The
invariants are not enforced by the type; they are enforced by everyone remembering to call the right
service in the right order.

## Why it matters

The cost is not theoretical. When the rules live outside the object:

- **Invalid state is representable.** You can construct an `Order` with a negative total and no lines,
  because the only thing standing between you and that object is a property setter. Bugs become
  "how did this row get into this state" tickets that nobody can reproduce.
- **The rules drift.** The shipping check lives in `OrderService.Ship`. Six months later someone adds
  `BulkOrderService.ShipAll` and forgets the check, because nothing tied the rule to the object.
- **You cannot trust the object you are holding.** Every method that receives an `Order` has to
  re-validate, because the type guarantees nothing.

A rich domain model inverts this. The object owns its rules. The only way to get an `Order` is through
a path that has already validated it, and the only way to change it is through a method that enforces
the invariant. If you are holding an `Order`, it is valid, by construction.

## The MMCA answer: a three-rung hierarchy, one capability per rung

MMCA.Common builds every entity on a three-class inheritance chain. Read it bottom-up; each rung adds
exactly one capability.

```
BaseEntity<TId>                    // identity
   -> AuditableBaseEntity<TId>     // + soft-delete, audit fields, optimistic concurrency
      -> AuditableAggregateRootEntity<TId>   // + domain events, child-collection helpers
```

**`BaseEntity<TId>`** is almost nothing: a single `required init TId Id` with a `where TId : notnull`
constraint. The `required init` is the load-bearing choice. A factory method sets `Id` once at
construction, and `init` makes it immutable thereafter, while EF Core still materializes existing rows
through the parameterless constructor and assigns `Id` via the same `init` accessor. One identity, set
once, never reassigned, on both the application path and the persistence path.

**`AuditableBaseEntity<TId>`** adds the cross-cutting facts every persisted row needs. Soft-delete
(`IsDeleted`, plus a `Delete()` / `Undelete()` pair that return `Result` and refuse to double-delete),
audit fields (`CreatedOn/By`, `LastModifiedOn/By`) with *private* setters, and a `RowVersion`
optimistic-concurrency token. The domain never writes the audit fields; they are stamped centrally
by the `AuditSaveChangesInterceptor` that EF Core runs inside `SaveChangesAsync`. Three concerns
that would otherwise be copy-pasted into every entity are inherited once and enforced in one place.

**`AuditableAggregateRootEntity<TId>`** is the top rung, the one that earns the DDD name "aggregate
root." It owns a private domain-event list (`AddDomainEvent` / `ClearDomainEvents` / a read-only
`DomainEvents` view, plus `RemoveDomainEvents`), and it adds six protected helpers that let a root
police its own consistency boundary: `SetItems` (replace a child collection, routed through an
overridable `ValidateSetItems` hook so a root can veto removing, say, a shipped order line),
`GetChildOrNotFound<TChild, TChildId>` (find an active child by id or return an `Error.NotFound`
failure), and the rest of the child lifecycle in `RemoveChildOrNotFound`, `RestoreChild` and
`DeleteChildren`. Only aggregate roots raise domain events, which is how the persistence layer knows
where to look.

### The factory method that returns Result

Here is the heart of it. The constructor is private. The only public way in is a static `Create` that
returns `Result<T>`:

```csharp
public sealed class Order : AuditableAggregateRootEntity<OrderIdentifierType>
{
    private readonly List<OrderLine> _lines = [];
    public OrderStatus Status { get; private set; }
    public Money Total { get; private set; }

    private Order() { }   // EF materialization only

    public static Result<Order> Create(CustomerIdentifierType customerId, Money total)
    {
        var validation = Result.Combine(
            CommonInvariants.EnsureIdIsNotDefault(
                customerId,
                "Order.CustomerId.Invalid",
                "An order needs a customer.",
                nameof(Create),
                nameof(customerId)),
            EnsureTotalIsNonNegative(total));

        if (validation.IsFailure)
        {
            return Result.Failure<Order>(validation.Errors);
        }

        return Result.Success(new Order { Id = default, Total = total, Status = OrderStatus.Pending });
    }

    public Result Ship()
    {
        if (Status != OrderStatus.Paid)
        {
            return Error.Invariant("Order.NotPaid", "Cannot ship an unpaid order");
        }

        Status = OrderStatus.Shipped;
        AddDomainEvent(new OrderShipped(Id));
        return Result.Success();
    }
}
```

Compare this to the anemic version. There are no public setters: `Status` and `Total` have
`private set`. There is no service holding the shipping rule; `Ship()` *is* the rule, and it lives on
the object. You cannot `new Order(...)` from outside, so an invalid order cannot exist. The
`Result.Combine` reports *every* broken invariant at once (covered in the Result railway article), and
`Ship()` raises an `OrderShipped` domain event as a first-class outcome rather than a side effect the
caller might forget. Invalid state is, quite literally, unconstructable.

### Value objects: the same trick, one level down

The aggregate is built from value objects that play by the same rules. `ValueObject` is the cheapest
possible base, `public abstract record ValueObject;`, so every value object inherits structural
equality and immutability from `record` for free. Two `Money(10, USD)` are equal because their values
match, not because they are the same row.

Each concrete value object (`Email`, `Money`, `Address`, `DateRange`) uses the same private-constructor
plus static `Create` returning `Result<T>` idiom, so an invalid `Email` simply cannot be constructed.
The validation lives in static *invariants* classes (`EmailInvariants`, `AddressInvariants`). Only
`AddressInvariants`'s `MaxLength` constants are actually reused elsewhere, and both reuse sites sit
inside MMCA.Common: `AddressValidationRules` reads them for FluentValidation, and the `OwnsAddress`
mapping extension reads the same six constants for `HasMaxLength` on the owned `Address` columns, so a
consuming app (Store's `CustomerConfiguration`) gets the field-length rule from one source of truth
through a single `builder.OwnsAddress(p => p.Address);` call. `EmailInvariants.MaxLength` does not get
the same treatment: each consumer declares its own, separate email length limit instead (Store's
`CustomerInvariants.EmailMaxLength` is 100, ADC's `UserInvariants.EmailMaxLength` is 100, and ADC's
`SpeakerInvariants.EmailMaxLength` aliases the 255 its own DTO declares), none derived from the 256
`EmailInvariants` itself declares.

### Identifier aliases: the war on primitive obsession

There is one more piece that is easy to miss but does heavy lifting against bugs. Look back at the
factory signature: `Create(CustomerIdentifierType customerId, Money total)`, not
`Create(int customerId, decimal total)`.

MMCA.Common defines per-entity identifier aliases, for example a solution-wide
`global using UserIdentifierType = int;` linked into every project via `Directory.Build.props`. The
underlying type is still `int`, but the name carries meaning. A method that takes a
`UserIdentifierType` and an `OrderIdentifierType` reads unambiguously at every call site, the way two
bare `int`s never do. The id is also strongly named at the entity level (`BaseEntity<TId>` is generic
over the alias), and `Money` instead of `decimal` means the currency travels with the amount. This is
primitive obsession addressed at the type level rather than in code review.

### The opt-in alternative: a wrapper struct the compiler enforces

The alias is the default, and it stays the default: every entity, DTO and consumer in this workspace
identifies itself through a primitive alias. An alias is a name for a primitive, though, so it buys
readability rather than enforcement. `UserIdentifierType` and `OrderIdentifierType` are both `int`, and
a call that transposes them compiles. For the case where you want that to be a compile error,
MMCA.Common ships the wrapper struct as an opt-in capability (ADR-115).

The contract is one interface with two members. `IStronglyTypedId<TSelf, TValue>` is self-referencing
(`where TSelf : struct, IStronglyTypedId<TSelf, TValue>`) and declares a `TValue Value` getter and a
`static abstract TSelf From(TValue value)` factory. It also derives from `IParsable<TSelf>` and
supplies both parse legs as default implementations, so a wrapper writes neither. Declaring one is two
lines:

```csharp
public readonly record struct OrderId(int Value) : IStronglyTypedId<OrderId, int>
{
    public static OrderId From(int value) => new(value);
}
```

The positional record struct supplies `Value`, structural equality and `ToString`; the interface
supplies the rest. Because `BaseEntity<TId>` constrains its identifier to `notnull` and a
`readonly record struct` satisfies that, an entity keyed by `OrderId` needs no change anywhere in the
hierarchy.

One registration call is the whole opt-in. `services.AddStronglyTypedIds(typeof(OrderId).Assembly)`
scans the named assemblies, registers a `StronglyTypedIdRegistry` singleton, and registers a
`StronglyTypedIdTypeConverter<TSelf, TValue>` for each wrapper it finds through
`StronglyTypedIdTypeConverters.Register`. The `TypeConverter` is the load-bearing piece for MVC: a
minimal API binds a route segment through `IParsable<T>`, but an MVC `[FromRoute]` scalar binds through
`TypeDescriptor.GetConverter`, so `GET /orders/42` does not bind without one. JSON goes through
`StronglyTypedIdJsonConverterFactory`, which writes the bare primitive and covers dictionary keys, so
the wire shape of `OrderId` is the wire shape of `int`.

Persistence decides whether adopting this is cheap, and it is. `ApplicationDbContext` asks the
container for the registry inside `ConfigureConventions` and, when it finds one, hands it to
`StronglyTypedIdModelConfiguration.Apply`, which declares a pre-convention type mapping per identifier
built from `StronglyTypedIdValueConverter<TSelf, TValue>` and `StronglyTypedIdValueComparer<TSelf>`
(`NullableStronglyTypedIdValueConverter<TSelf, TValue>` is the optional-property form). Two
consequences follow: the column stays the primitive, so wrapping an identifier is a code change rather
than a schema migration, and because the mapping lives on the one base context every engine context
inherits, every database engine gets it with no engine branch. A host that never calls
`AddStronglyTypedIds` resolves no registry, and the entire path is a no-op.

For a contract that deliberately keeps primitives on the wire, `StronglyTypedIdMappings<TSelf, TValue>`
exposes `ToValue` and `ToIdentifier` as plain static methods that a Mapperly-generated mapper discovers
by signature. The posture the framework takes is worth stating plainly: the aliases are the identifier
model for everything shipped here, nothing pushes a consumer toward a wrapper, and the capability
exists so that a team that does want transposition caught by the compiler gets JSON, EF Core, MVC
binding, filtering and OpenAPI answered in one place instead of hand-rolling a variant at six
boundaries.

### Soft-delete, not destruction

Entities are never hard-deleted. `Delete()` flips `IsDeleted` to `true` and an EF global query filter
hides the row; the data and its foreign-key relationships stay intact. `Delete()` returns `Result` and
guards against double-deletion (returning `Error.AlreadyDeleted`), so even "remove this" flows through
the same error railway as everything else.

## Trade-offs, honestly

Rich aggregates are the right default, but they are not free, and the scorecard's §4 review names the
gaps:

- **More boilerplate per entity.** A private constructor, a static factory, private setters, and
  invariant checks are more code than four public auto-properties. The protection is worth it, but the
  first entity feels heavier than the anemic version.
- **EF Core needs the parameterless constructor.** The materialization path is a real constraint: EF
  builds the object through `private Order()` and sets `Id` via `init`, which is why the constructor
  exists at all. You are designing around two construction paths, the factory and the ORM, and that
  costs a little ceremony.
- **Strategic DDD is downstream work, not framework work.** The tactical conventions are
  machine-enforced: an `AggregateConventionTests` fitness function, merge-gated, pins that every
  aggregate root exposes a static `Create` returning `Result<T>` and has no public constructors, so
  "private constructor plus a `Create` factory" is an executable check, not a convention held by
  review. What no base class can give you is the strategic half of DDD: bounded contexts and a
  ubiquitous language are realized in the apps that build modules on these classes, not in the
  framework itself, and the scorecard's §4 names that as the remaining gap.
- **Aggregate boundaries are a judgment call.** Deciding what belongs inside a root and what is its own
  aggregate is genuine modeling work that no base class makes for you.

## Apply this even without MMCA

You do not need this framework to drop the anemic model. The moves are portable:

1. **Make constructors private and add a static factory** that validates and returns a result type. If
   the only public way to build an object runs through validation, an invalid object cannot exist.
2. **Replace public setters with behavior methods.** `order.Ship()`, not `order.Status = Shipped`. The
   rule lives on the object that owns the data.
3. **Use strong identifier types,** even if they are thin wrappers over `int` or `Guid`. Transposed-id
   bugs are silent and expensive; the type system can catch them for free.
4. **Push validation into value objects.** An `Email` that cannot be constructed invalid means every
   method downstream can stop re-checking it.

The rule of thumb: **if you are holding the object, it should be valid, by construction, and the only
way to change it should be a method that keeps it valid.**

---

**What we covered:** why the anemic model drains protection out of your types, the
`BaseEntity` to `AuditableBaseEntity` to `AuditableAggregateRootEntity` hierarchy (identity, then
audit/soft-delete, then domain events), the private-constructor-plus-`Create`-returning-`Result` idiom
that makes invalidity unconstructable, value objects and identifier aliases against primitive
obsession (with the strongly typed identifier struct as the opt-in alternative), and domain events
raised on the aggregate root.

**Next in the series:** specifications over LINQ spaghetti, the composable, reusable query intent that
keeps read logic out of your controllers.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, skim the domain building-blocks chapter,
or `dotnet add package MMCA.Common.API` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- Onboarding chapter: `Website/docs-src/onboarding/group-02-domain-building-blocks.md`.

*Tags: .NET, C Sharp, Software Architecture, Programming, Domain-Driven Design*

*Notes: re-verified against the current tree this pass, MMCA.Common v1.205.0 (`MMCA.Common/FACTS.md:14`).
Type/behavior names: `BaseEntity<TId>` (`required init Id`, EF parameterless ctor),
`AuditableBaseEntity<TId>` (`IsDeleted`, `Delete()`/`Undelete()` returning `Result`, private-setter
audit fields, `RowVersion`), `ValueObject` (`public abstract record`),
`Email`/`Money`/`Address`/`DateRange` value objects with private ctor + static `Create` returning
`Result<T>`, `UserIdentifierType` alias via `Directory.Build.props`,
`Error.NotFound`/`Error.AlreadyDeleted`/`Error.Invariant`, soft-delete global query filters.
**Aggregate-root API, re-counted this pass:** `AuditableAggregateRootEntity<TId>` exposes public
`RemoveDomainEvents` (`Source/Core/MMCA.Common.Domain/Entities/AuditableAggregateRootEntity.cs:37`)
plus six protected helpers, not two: `SetItems` (`:60`), the overridable `ValidateSetItems` (`:85`),
`GetChildOrNotFound<TChild, TChildId>` (`:103`, two type parameters, not one),
`RemoveChildOrNotFound` (`:156`), `RestoreChild` (`:212`) and `DeleteChildren` (`:273`).
**Audit stamping:** the fields are stamped by the EF Core interceptor
`AuditSaveChangesInterceptor(TimeProvider)`
(`Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/AuditSaveChangesInterceptor.cs:22`,
`SavingChangesAsync` at `:25`, `StampAuditFields` at `:47` walking
`context.ChangeTracker.Entries<IAuditableEntity>()` at `:52`), which the save pipeline triggers.
`ApplicationDbContext` delegates the concern on purpose: its class doc assigns audit stamping to that
interceptor
(`Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:31-32`) and
`OnConfiguring` (`:285`) resolves it (`:292`) so stamping happens "via the EF interceptor pipeline
rather than inline in SaveChangesAsync" (`:289-291`). **Invariants reuse:** both reuse sites for
`AddressInvariants.{AddressLine1,AddressLine2,City,State,ZipCode,Country}MaxLength` are inside
MMCA.Common. `AddressValidationRules` reads them for FluentValidation
(`Source/Core/MMCA.Common.Application/Validation/AddressValidationRules.cs:37,47,57,67,77,87`), and the
`OwnsAddress` mapping extension reads them for EF `HasMaxLength` on the owned `Address` columns
(`Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeBuilderExtensions.cs:138,144,149,154,159,164`).
A consumer reaches all six through one call: Store's `CustomerConfiguration` is a 50-line file whose
only `Address` mapping is `builder.OwnsAddress(p => p.Address);`
(`MMCA.Store.Identity.Infrastructure/Persistence/EntityConfiguration/CustomerConfiguration.cs:44`), and
it names no `AddressInvariants` constant itself. `EmailInvariants.MaxLength` (256,
`Source/Core/MMCA.Common.Shared/ValueObjects/Contact/EmailInvariants.cs:14`) has no reuse site outside
its own file: Store's `CustomerInvariants.EmailMaxLength` is a separate constant set to 100
(`Customers/CustomerInvariants.cs:24`), ADC's `UserInvariants.EmailMaxLength` is 100
(`Users/UserInvariants.cs:18`), and ADC's `SpeakerInvariants.EmailMaxLength`
(`Speakers/SpeakerInvariants.cs:22`) is an alias of `SpeakerDTO.EmailMaxLength`, which is where the 255
is declared (`MMCA.ADC.Conference.Shared/Speakers/SpeakerDTO.cs:27`). The `Order` snippet is
illustrative of the documented entity shape, not copied verbatim from a single source file; its
`CommonInvariants.EnsureIdIsNotDefault` call was widened this pass to the shipped five-argument
signature `EnsureIdIsNotDefault<TId>(TId id, string code, string message, string source, string target)`
(`Source/Core/MMCA.Common.Domain/Invariants/CommonInvariants.cs:63-64`). The
Create-returning-`Result<T>` plus private-constructor plus aggregate-root conventions are
machine-enforced by the merge-gated `AggregateConventionTests`
(`Tests/Architecture/MMCA.Common.Architecture.Tests/Domain/AggregateConventionTests.cs:9`) driving
`AggregateConventionTestsBase`
(`Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Domain/AggregateConventionTestsBase.cs:10`:
`Domain_ShouldExpose_AggregateRoots` at `:15`, `AggregateRoots_ShouldHave_ResultReturningCreateFactory`
at `:18`, `AggregateRoots_ShouldHave_NoPublicConstructors` at `:21`, with a fourth
`DomainFactories_ShouldReturn_Result` fact at `:24`); both paths carry a `Domain/` folder level.
The honest residual §4 gap is strategic DDD (bounded contexts and ubiquitous language realized
downstream), per `Website/docs-src/governance/common-ArchitectureScorecard.md` §4, the Domain-Driven
Design row at `:84` (weight 3, Maturity 4 / Implementation 8, 12/24, crediting the
`AggregateConventionTests` fitness function by name). That row moves down as each re-score paragraph is
appended above the table. The thirty-sixth-wave full re-score (2026-09-19, at v1.205.0) moves no score:
the indices stand at Maturity 97.0% (318/328, `:120`) and Implementation 86.0% (705/820, `:121`).
**ADR mapping:** ADR-068 (value objects as validated domain primitives) names the memberless
`public abstract record ValueObject` base
(`Website/docs-src/adr/068-value-objects-as-validated-primitives.md:32-33`) and the private-constructor
plus `Result`-returning `Create` factory shape (`:39-45`), and records that the factory shape is
fitness-enforced for value objects too, by `ArchitectureRules.DomainFactoriesReturnResult` (`:54`).
**Strongly typed identifiers (new section this pass), every name read from source this run:**
`IStronglyTypedId<TSelf, TValue>` with its `TValue Value` getter and `static abstract TSelf From(TValue)`
(`Source/Core/MMCA.Common.Shared/Identifiers/IStronglyTypedId.cs:60-72`, the `IParsable<TSelf>` default
implementations just below), the `StronglyTypedId` static helper (`StronglyTypedId.cs:19`, `Parse`
`:40`, `TryParse` `:63`), `StronglyTypedIdJsonConverterFactory`
(`StronglyTypedIdJsonConverterFactory.cs:22`), `StronglyTypedIdTypeConverter<TSelf, TValue>`
(`StronglyTypedIdTypeConverter.cs:21`) with `StronglyTypedIdTypeConverters.Register` (`:89`) and
`.RegisterAll` (`:108`), `StronglyTypedIdRegistry` (`StronglyTypedIdRegistry.cs:22`),
`StronglyTypedIdMappings<TSelf, TValue>` with `ToValue`/`ToIdentifier`
(`StronglyTypedIdMappings.cs:31,38,43`), the opt-in call `AddStronglyTypedIds`
(`Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:786`, registry at `:790`, converter
registration at `:793`), `StronglyTypedIdModelConfiguration.Apply`
(`Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/StronglyTypedIdModelConfiguration.cs:21,29`),
and `StronglyTypedIdValueConverter<TSelf, TValue>` / `NullableStronglyTypedIdValueConverter<TSelf, TValue>` /
`StronglyTypedIdValueComparer<TSelf>`
(`Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/StronglyTypedIdValueConverter.cs:28,56,80`).
The registry resolve and the pre-convention apply happen in `ApplicationDbContext`
(`.../DbContexts/ApplicationDbContext.cs:396-403`, where the comment records that absent the service it
is a no-op and the aliases stay the identifier model). The posture (aliases default, wrapper opt-in,
nothing migrates) is ADR-115
(`Website/docs-src/adr/115-strongly-typed-identifiers-opt-in.md:54-56`), which revisits ADR-048 and
ADR-085 (`:7-13`) and records the MVC `TypeConverter` binding finding (`:103-113`).*

- Full series index: https://ivanball.github.io/writing.html
