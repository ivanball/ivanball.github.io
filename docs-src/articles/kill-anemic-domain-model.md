# Kill the anemic domain model: rich aggregates with factory methods that return Result

> Series: MMCA.Common · Article #5 · Pillar P2 · Group G02 · Rubric §4 · ADR-068 · ADR-115 · ADR-129 ·
> Status: grounded in `MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/` (the three entity
> rungs), `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/` and `.../Identifiers/`,
> `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Domain/EntityConventionTestsBase.cs`
> and `.../Rules/Domain/ArchitectureRules.Entities.cs`,
> `Website/docs-src/onboarding/group-02-domain-building-blocks.md`,
> `Website/docs-src/adr/068-value-objects-as-validated-primitives.md`,
> `Website/docs-src/adr/115-strongly-typed-identifiers-opt-in.md` and
> `Website/docs-src/adr/129-tactical-aggregate-contract.md`. No em dashes.

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
audit fields (`CreatedOn/By`, `LastModifiedOn/By`, `DeletedOn/By`) with *private* setters, and a `RowVersion`
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
`AddressInvariants`'s `MaxLength` fields are actually reused elsewhere, and both reuse sites sit
inside MMCA.Common: `AddressValidationRules` reads them for FluentValidation, and the `OwnsAddress`
mapping extension reads the same six fields for `HasMaxLength` on the owned `Address` columns, so a
consuming app (Store's `CustomerConfiguration`) gets the field-length rule from one source of truth
through a single `builder.OwnsAddress(p => p.Address);` call (a second `OwnsOne` there overrides only
the unicode facet, never a length). `EmailInvariants.MaxLength` does not get
the same treatment: each consumer declares its own, separate email length limit instead (Store's
`CustomerInvariants.EmailMaxLength` is 100, ADC's `UserInvariants.EmailMaxLength` is 100, and ADC's
`SpeakerInvariants.EmailMaxLength` aliases the 255 its own DTO declares), none derived from the 256
`EmailInvariants` itself declares.

### Identifier aliases: the war on primitive obsession

There is one more piece that is easy to miss but does heavy lifting against bugs. Look back at the
factory signature: `Create(CustomerIdentifierType customerId, Money total)`, not
`Create(int customerId, decimal total)`.

MMCA.Common defines per-entity identifier aliases, for example
`global using UserIdentifierType = int;`, declared once in `MMCA.Common.Domain` and linked into every
other `MMCA.Common.*` project via `Directory.Build.props`. The
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

### One contract, and which half the build holds

Everything above is one tactical contract, recorded as ADR-129, and that record is explicit about a
split: part of the contract is a fitness test, and part is a convention that holds because each new
entity copies the nearest one.

The test half is `EntityConventionTestsBase`, a shared base in `MMCA.Common.Testing.Architecture` with
eight facts. **Construction:** the Domain layer must expose at least one aggregate root (so a broken
filter fails instead of checking nothing), every root needs a public static `Create` returning
`Result<TSelf>` and no public instance constructor, and any concrete Domain or Shared type that
exposes a `Create` must return `Result<T>` from it. **Encapsulation:** every concrete module-domain
entity is sealed, and none of its public instance properties has a public setter (`init` and
non-public setters pass; navigation properties are included, so a child collection is replaced
through a `SetXxx` method). **Placement:** no entity sits in an Application or Infrastructure
assembly, no DTO or request type sits in Domain, and no DTO sits in Infrastructure. MMCA.ADC,
MMCA.Store and MMCA.Helpdesk each subclass the base unchanged and supply only their architecture map.
MMCA.Common runs the smaller `AggregateConventionTestsBase` instead: it has no business modules, so
the module-scoped rules would check nothing there.

The convention half is the rest. `GetChildOrNotFound`, `SetItems` and the remove, restore and
cascade-delete helpers are protected members of `AuditableAggregateRootEntity`, and no fitness rule
requires an aggregate to use them. `Result.Combine` is a framework member too: its arguments are
evaluated before the call, so every invariant runs and the one failure it returns carries every error.
Whether an aggregate composes its invariants that way is convention; the single gated piece is a
naming rule, separate from the entity base, that a class named `*Invariants` must be static.
Helpdesk's `Ticket` is the reference shape: sealed over the aggregate base, a private constructor,
`Create` returning `Result<Ticket>`, `TicketInvariants` composed through `Result.Combine`, and a
comment found through `GetChildOrNotFound`. The practical reading: an aggregate that reaches into its
child list directly, or validates inline, still builds. Review and the nearest example hold that half.

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
  framework itself, and the scorecard's §4 names that as one of its two open criteria (the other is
  the tenant identifier, a plain string by deliberate decision rather than a strong type).
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
obsession (with the strongly typed identifier struct as the opt-in alternative), domain events
raised on the aggregate root, and which half of the entity contract the fitness tests enforce.

**Next in the series:** specifications over LINQ spaghetti, the composable, reusable query intent that
keeps read logic out of your controllers.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, skim the domain building-blocks chapter,
or `dotnet add package MMCA.Common.API` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- Onboarding chapter: `Website/docs-src/onboarding/group-02-domain-building-blocks.md`.

*Tags: .NET, C Sharp, Software Architecture, Programming, Domain-Driven Design*

*Notes: re-verified 2026-10-08 against MMCA.Common v1.233.0 (`MMCA.Common/FACTS.md:14`); paths
under `Source/` are relative to `MMCA.Common/`.
**2026-10-08 run (v1.233.0):** body prose unchanged (every claim still holds); anchors re-based in
place: `OwnsAddress` `HasMaxLength` reads (`EntityTypeBuilderExtensions.cs:144,150,155,160,165,170`, were
`:138-164`), `AddStronglyTypedIds` (`DependencyInjection.cs:377`, registry `:381`, converter registration
`:384`), the `ConfigureConventions` strongly typed identifier block (comment `:402-406`, `GetService` `:407`,
`Apply` `:409`), the `Directory.Build.props` alias link block (`:153-157`, was `:131-135`), the
interceptor lines (`AuditSaveChangesInterceptor.cs:38`, `:41`, `:63`, `:69`;
`DomainEventSaveChangesInterceptor.cs:242`), ADR-068 (`:40-41`, `:47-53`, `:67`) and ADR-115 (`:57-59`,
`:10-11`, `:108-118`). Re-checked and unchanged: `AggregateConventionTestsBase` and
`EntityConventionTestsBase` fact lines, the `ArchitectureRules.Entities.cs` rule start lines, the
ADR-129 anchors, `ApplicationDbContext.cs:31-33,290,294-297`, and the scorecard row `:68` with indices
`:9`/`:10`.
**2026-10-02 run's changes:** header `Status` re-grounded on source folders (the `MMCA.Common/CLAUDE.md`
"Entity Model" section it cited does not exist; that file holds only a `# CLAUDE.md` heading);
`DeletedOn/By` added to the audit-field list; the identifier-alias sentence narrowed to where the alias
is actually linked; Store `CustomerConfiguration` sentence widened for its unicode-only `OwnsOne`; the
section 4 residual reworded to the scorecard row's two open criteria; anchors re-based throughout.
**Entity rungs:** `BaseEntity<TIdentifierType>` with `where TIdentifierType : notnull` and
`public required TIdentifierType Id { get; init; }`
(`Source/Core/MMCA.Common.Domain/Entities/BaseEntity.cs:34-37`).
`AuditableBaseEntity<TIdentifierType>` (`AuditableBaseEntity.cs:13`): `IsDeleted` (`:20`),
`CreatedOn`/`CreatedBy` (`:25`, `:27`), `LastModifiedOn`/`LastModifiedBy` (`:29`, `:31`),
`DeletedOn`/`DeletedBy` (`:39`, `:45`), all `private set`; `RowVersion` (`:53`); `public virtual
Result Delete()` (`:67`) returning `Error.AlreadyDeleted` when already deleted (`:72`;
`Source/Core/MMCA.Common.Shared/Abstractions/Error.cs:26`); `protected Result Undelete()` (`:89`)
refusing a not-deleted entity with `Entity.NotDeleted` (`:95`). Soft-delete is a global named query
filter (`SoftDelete`) per the `ApplicationDbContext` class doc
(`Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:33`).
**Aggregate-root API:** `AuditableAggregateRootEntity<TIdentifierType>` (`AuditableAggregateRootEntity.cs:13`)
holds a private `_domainEvents` list (`:16`), a read-only `DomainEvents` view (`:18`),
`AddDomainEvent` (`:24`), `ClearDomainEvents` (`:34`), public `RemoveDomainEvents` (`:37`), and six
protected helpers: `SetItems` (`:60`), the overridable `ValidateSetItems` (`:87`),
`GetChildOrNotFound<TChild, TChildId>` (`:105`, returning `Result.Failure` over `Error.NotFound` at
`:115-118`; `Error.NotFound` is `Error.cs:23`), `RemoveChildOrNotFound` (`:158`), `RestoreChild`
(`:214`) and `DeleteChildren` (`:275`). Only roots carry events: the domain-event interceptor walks
`ChangeTracker.Entries<IAggregateRoot>()`
(`Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:242`).
**Audit stamping:** `AuditSaveChangesInterceptor(TimeProvider)`
(`Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/AuditSaveChangesInterceptor.cs:38`,
`SavingChangesAsync` at `:41`, `StampAuditFields` at `:63` walking
`context.ChangeTracker.Entries<IAuditableEntity>()` at `:69`). `ApplicationDbContext` delegates the
concern on purpose: its class doc assigns audit stamping to that interceptor (`ApplicationDbContext.cs:31-32`)
and `OnConfiguring` (`:290`) resolves it (`:297`) so stamping happens "via the EF interceptor pipeline
rather than inline in SaveChangesAsync" (`:294-296`).
**Snippet API shape:** the `Order` snippet is illustrative of the documented entity shape, not copied
from one source file. Its calls match shipped signatures: `Result.Combine(params ReadOnlySpan<Result>)`
(`Source/Core/MMCA.Common.Shared/Abstractions/Result.cs:124`), `Result.Failure<T>(IEnumerable<Error>)`
(`:74`), the implicit `Error` to `Result` conversion (`:43`), `Error.Invariant(code, message, ...)`
(`Error.cs:46`), and the five-argument
`EnsureIdIsNotDefault<TId>(TId id, string code, string message, string source, string target)`
(`Source/Core/MMCA.Common.Domain/Invariants/CommonInvariants.cs:63-64`).
**Value objects:** `public abstract record ValueObject;`
(`Source/Core/MMCA.Common.Shared/ValueObjects/ValueObject.cs:8`); private ctor plus
`Result<T>`-returning `Create` on `Money` (`Financial/Money.cs:52`, `:67`), `Email`
(`Contact/Email.cs:23`, `:30`), `Address` (`Contact/Address.cs:43`, `:69`) and `DateRange`
(`Time/DateRange.cs:17`, `:30`).
**Invariants reuse:** both reuse sites for
`AddressInvariants.{AddressLine1,AddressLine2,City,State,ZipCode,Country}MaxLength` are inside
MMCA.Common: `AddressValidationRules` reads them for FluentValidation
(`Source/Core/MMCA.Common.Application/Validation/AddressValidationRules.cs:37,47,57,67,77,87`), and the
`OwnsAddress` mapping extension reads them for EF `HasMaxLength` on the owned `Address` columns
(`Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeBuilderExtensions.cs:144,150,155,160,165,170`).
Store's `CustomerConfiguration` (61 lines) maps `Address` through `builder.OwnsAddress(p => p.Address);`
(`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/EntityConfiguration/CustomerConfiguration.cs:42`)
and then re-enters the same owned navigation with `builder.OwnsOne(p => p.Address, ...)` (`:47`) that sets
only `IsUnicode()` on the six columns; it names no `AddressInvariants` field itself.
`EmailInvariants.MaxLength` (256, `Source/Core/MMCA.Common.Shared/ValueObjects/Contact/EmailInvariants.cs:14`)
has no executable reference outside its own file: the only other mentions are a doc-comment usage
example (`Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/EmailValueConverter.cs:16`)
and a comment in an ADC test (`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Domain.Tests/Users/UserInvariantsAndRoleTests.cs:288`);
`Email.Create` calls `EmailInvariants.EnsureEmailIsValid` (`Email.cs:34`), not `MaxLength`. Store's
`CustomerInvariants.EmailMaxLength` is a separate constant set to 100
(`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Customers/CustomerInvariants.cs:24`),
ADC's `UserInvariants.EmailMaxLength` is 100
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserInvariants.cs:18`), and ADC's
`SpeakerInvariants.EmailMaxLength`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/SpeakerInvariants.cs:22`) is
an alias of `SpeakerDTO.EmailMaxLength`, which declares the 255
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Speakers/SpeakerDTO.cs:27`).
**Identifier alias:** `global using UserIdentifierType = int;`
(`Source/Core/MMCA.Common.Domain/GlobalUsings.IdentifierType.cs:1`), linked into every `MMCA.Common*`
project other than `MMCA.Common.Domain` by `MMCA.Common/Directory.Build.props:153-157`.
**Fitness enforcement:** the merge-gated `AggregateConventionTests`
(`Tests/Architecture/MMCA.Common.Architecture.Tests/Domain/AggregateConventionTests.cs:9`) drives
`AggregateConventionTestsBase`
(`Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Domain/AggregateConventionTestsBase.cs:10`:
`Domain_ShouldExpose_AggregateRoots` at `:15`, `AggregateRoots_ShouldHave_ResultReturningCreateFactory`
at `:18`, `AggregateRoots_ShouldHave_NoPublicConstructors` at `:21`, `DomainFactories_ShouldReturn_Result`
at `:24`).
**Scorecard:** `Website/docs-src/governance/common-ArchitectureScorecard.md` section 4, the Domain-Driven Design
row at `:68` (weight 3, Maturity 4 / Implementation 8, 12/24, crediting `AggregateConventionTests` by
name), held at 8 by two open criteria: strategic DDD realized downstream, and the tenant identifier kept
a plain string by deliberate decision. Current indices: Maturity 96.6% (317/328, `:9`) and
Implementation 86.0% (705/820, `:10`). The article states no index value in its body.
**ADR mapping:** ADR-068 names the memberless `public abstract record ValueObject` base
(`Website/docs-src/adr/068-value-objects-as-validated-primitives.md:40-41`), the private-constructor plus
`Result`-returning `Create` factory shape (`:47-53`), and records that the shape is fitness-enforced by
`ArchitectureRules.DomainFactoriesReturnResult` (`:67`).
**Strongly typed identifiers:** `IStronglyTypedId<TSelf, TValue> : IParsable<TSelf>` with its
`TValue Value` getter and `static abstract TSelf From(TValue)`
(`Source/Core/MMCA.Common.Shared/Identifiers/IStronglyTypedId.cs:60`, `:65`, `:72`, the `IParsable<TSelf>`
default implementations just below), the `StronglyTypedId` static helper (`StronglyTypedId.cs:19`,
`Parse` `:40`, `TryParse` `:63`), `StronglyTypedIdJsonConverterFactory`
(`StronglyTypedIdJsonConverterFactory.cs:22`), `StronglyTypedIdTypeConverter<TSelf, TValue>`
(`StronglyTypedIdTypeConverter.cs:21`) with `StronglyTypedIdTypeConverters.Register` (`:89`) and
`.RegisterAll` (`:119`), `StronglyTypedIdRegistry` (`StronglyTypedIdRegistry.cs:22`),
`StronglyTypedIdMappings<TSelf, TValue>` with `ToValue`/`ToIdentifier`
(`StronglyTypedIdMappings.cs:31,38,43`), the opt-in call `AddStronglyTypedIds`
(`Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:377`, registry at `:381`, converter
registration at `:384`), `StronglyTypedIdModelConfiguration.Apply`
(`Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/StronglyTypedIdModelConfiguration.cs:21,29`),
and `StronglyTypedIdValueConverter<TSelf, TValue>` / `NullableStronglyTypedIdValueConverter<TSelf, TValue>` /
`StronglyTypedIdValueComparer<TSelf>`
(`Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/StronglyTypedIdValueConverter.cs:28,56,80`).
The registry resolve and the pre-convention apply happen in `ApplicationDbContext.ConfigureConventions`
(`ApplicationDbContext.cs:378`; comment `:402-406`, `GetService<StronglyTypedIdRegistry>` `:407`, `Apply`
`:409`), where the comment records that absent the service it is a no-op and the aliases stay the
identifier model. The posture (aliases default, wrapper opt-in, nothing migrates) is ADR-115
(`Website/docs-src/adr/115-strongly-typed-identifiers-opt-in.md:57-59`), which revisits ADR-048 and
ADR-085 (`:10-11`) and records the MVC `TypeConverter` binding finding (`:108-118`).
**2026-10-02 ADR-129 fold-in** (section "One contract, and which half the build holds", header ADR
cell and `Status` line, one closing clause in "What we covered"): the gated/convention split is
ADR-129's Decision (`Website/docs-src/adr/129-tactical-aggregate-contract.md:22-24`) and its first
trade-off (`:137-139`). `EntityConventionTestsBase`
(`Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Domain/EntityConventionTestsBase.cs:10`)
declares eight facts (`:15`, `:18`, `:21`, `:24`, `:27`, `:30`, `:33`, `:36`) whose bodies are in
`Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Domain/ArchitectureRules.Entities.cs`: at least
one aggregate root (`:8-16`), a static `Create` returning `Result<TSelf>` on every root (`:19-41`), every
Domain/Shared `Create` returning `Result<T>` with no-`Create` types skipped (`:53-80`, skip `:67-70`),
module-domain entities sealed (`:103-112`), no public setter with `init`/non-public passing and
navigations included (`:149-164`, compliance `:129-136`), no public constructor on module-domain roots
(`:167-177`), no entity in Application or Infrastructure (`:180-191`, layers `:182`), and DTO/request
placement (`:199-217`; DTO in Infrastructure `:209-213`). Adopters: MMCA.ADC
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Domain/EntityConventionTests.cs:3`),
MMCA.Store (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Domain/EntityConventionTests.cs:3`)
and MMCA.Helpdesk
(`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:89`). Common
subclasses `AggregateConventionTestsBase` (`AggregateConventionTests.cs:9`), whose constructor fact
calls the whole-Domain rule (`AggregateConventionTestsBase.cs:21`; `ArchitectureRules.Entities.cs:90-100`);
the module-scoped rules are vacuous in a module-less repo (`ArchitectureRules.Entities.cs:141-144`).
Child-access members are the protected helpers already anchored above (`AuditableAggregateRootEntity.cs:60`,
`:105`, `:158`, `:214`, `:275`); ADR-129 records that no fitness rule requires them
(`129-tactical-aggregate-contract.md:78`).
`Result.Combine` (`Result.cs:124`) collects every failed input's errors into one failure (`:131-144`).
The static-`*Invariants` rule is `ArchitectureRules.InvariantClassesAreStatic`
(`Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Governance/ArchitectureRules.Naming.cs:78-79`),
run as `InvariantClasses_ShouldBe_Static` (`Bases/Governance/NamingConventionTestsBase.cs:31`).
Reference shape: Helpdesk `Ticket`
(`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Domain/Tickets/Ticket.cs:26` sealed over
the aggregate base, private constructor `:52`, `Create` returning `Result<Ticket>` `:66`,
`Result.Combine` over `TicketInvariants` `:68` and `:118`, `GetChildOrNotFound` `:144`).*

- Full series index: https://ivanball.github.io/writing.html
