# ADR-129: The Tactical Aggregate Contract

## Status
Accepted (2026-10-01).

## Context
Every entity in the four repos is written the same way: a sealed class over a framework base, a
private constructor, a static `Create(...)` returning `Result<T>`, private setters, named mutation
methods, child lookups through the root and invariants held in a static class. Agents and people copy
that shape from the nearest entity, which is why it is consistent today, but the contract itself is
recorded only in fragments. [ADR-013](013-result-pattern.md) makes factories return `Result<T>`,
[ADR-068](068-value-objects-as-validated-primitives.md) puts value-object invariants in a static
`*Invariants` class, and [ADR-126](126-event-sourcing-not-adopted.md) says an aggregate is a
current-state row. None of them states the whole entity contract, and none says which parts a build
enforces and which parts only exist because the next entity copied the last one.

A pattern that forty files copy needs one place that says what the pattern is, where its boundary
sits, and which half a fitness test holds. This record is that place, in the same way
[ADR-125](125-parameterized-sql-only.md) is for raw SQL.

## Decision
Entities follow one tactical contract. The construction, encapsulation and placement parts are
fitness-gated by `EntityConventionTestsBase`; the child-access part and the use of `Result.Combine` are framework members and a convention
every repo follows, not a test.

- **One hierarchy, three abstract levels.** `BaseEntity<TIdentifierType>`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/BaseEntity.cs:34`) carries identity;
  `AuditableBaseEntity<TIdentifierType>`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:13`) adds soft delete,
  the audit fields and the row version, all with private setters (`:20-53`): `IsDeleted` is set by
  the domain methods `Delete()` and `Undelete()` (`:67-80`, `:89-104`), while the audit fields are
  stamped at save time; and
  `AuditableAggregateRootEntity<TIdentifierType>`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableAggregateRootEntity.cs:13`) adds the
  domain event list (`:16-50`) and the child-access members below. The fitness rules recognize an
  aggregate root by a base type whose name starts with `AuditableAggregateRootEntity`, and an entity
  by any of the three bases
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/RuleHelpers.cs:109-119`).
- **The gate is one shared base with eight facts.** `EntityConventionTestsBase`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Domain/EntityConventionTestsBase.cs:10`)
  declares the facts at `:14-36`; each body lives once in
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Domain/ArchitectureRules.Entities.cs`.
- **The suite refuses to pass vacuously.** The Domain layer must expose at least one aggregate root
  (`ArchitectureRules.Entities.cs:8-16`), so a broken filter fails instead of checking nothing.
- **Construction is factory-only.** Every aggregate root needs a public static `Create` with at least
  one overload returning `Result<TSelf>` (`ArchitectureRules.Entities.cs:19-41`), and no public
  instance constructor (`:167-177`). The `Result<T>` rule also reaches every concrete type in Domain
  and Shared that exposes a `Create` (`:53-80`); a type with no `Create` is unaffected, and other
  construction sugar such as `Money.Zero()` is out of scope because only the `Create` name is governed
  (`:49-51`).
- **Entities are sealed.** Any concrete module-domain type inheriting one of the three bases must be
  sealed (`ArchitectureRules.Entities.cs:103-112`); the rule checks concrete classes only (`:105-107`), so an abstract module-domain class over an entity base is not caught.
- **Entities live in Domain.** No concrete type inheriting an entity base may sit in an Application or
  Infrastructure layer assembly (`ArchitectureRules.Entities.cs:180-191`).
- **No public setters; mutation goes through named domain methods.** Every public instance property
  of a module-domain entity must have no setter, an `init`-only setter, or a non-public one
  (`ArchitectureRules.Entities.cs:149-164`, compliance stated at `:129-136`). Navigation properties are
  included rather than exempted, so a collection is replaced through a `SetXxx` method (`:133-136`).
  An `init` setter is detected by its `IsExternalInit` modreq and counts as compliant
  (`RuleHelpers.cs:129-143`). Fields are not inspected (`ArchitectureRules.Entities.cs:144-145`).
- **DTOs and requests stay out of the model.** A type ending in `DTO` or `Request`, or implementing
  `IBaseDTO`, fails in Domain; a DTO fails in Infrastructure, while a `*Request` is allowed there as an
  outbound HTTP payload (`ArchitectureRules.Entities.cs:193-217`).
- **Child access goes through the root.** `GetChildOrNotFound<TChild, TChildId>` is a protected static
  member of the aggregate base that returns the active child by id or a `NotFound` failure carrying
  the caller as source and the child type as target, skipping soft-deleted children
  (`AuditableAggregateRootEntity.cs:105-122`). `SetItems<TChildEntity>` is the protected collection
  replacement: it copies the incoming items, calls the overridable `ValidateSetItems` hook (a no-op by
  default) and only then replaces the backing list (`:60-76`, hook at `:87-92`). Three more protected
  static helpers build on the lookup: `RemoveChildOrNotFound` (lookup then the child's `Delete()`,
  `:158`), `RestoreChild` (reactivates a soft-deleted child, `:214`) and `DeleteChildren` (soft-deletes
  every active child for a cascading `Delete()`, `:275`). All five are protected, so only the aggregate
  calls them directly; aggregates still expose `internal` `SetXxx` wrappers over `SetItems` for
  manual navigation loading (for example
  `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/Product.cs:413-414`), which
  Application-layer navigation populators call
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Products/ProductNavigationPopulator.cs:28`).
  No fitness rule requires the use of any of these helpers.
- **Invariants are static classes composed with `Result.Combine`.** `Result.Combine(params
  ReadOnlySpan<Result>)` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/Result.cs:124`)
  throws on an empty argument list (`:126-129`) and otherwise returns success or one failure holding
  every error from every failed input (`:131-144`). Its arguments are evaluated before the call, so
  every invariant runs and every violation is reported; it does not short-circuit. That an `*Invariants` class is static is fitness-gated
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Governance/ArchitectureRules.Naming.cs:78-88`,
  run as `InvariantClasses_ShouldBe_Static` at `.../Bases/Governance/NamingConventionTestsBase.cs:31`, subclassed by
  MMCA.ADC, MMCA.Store and MMCA.Helpdesk); that one exists and that it uses `Result.Combine` is convention.
- **The reference shape is Helpdesk's `Ticket`.** It is sealed over the aggregate base
  (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Domain/Tickets/Ticket.cs:26`), has a
  private constructor (`:52`) and `Create` returning `Result<Ticket>` (`:66`), composes
  `TicketInvariants` through `Result.Combine` in `Create` and `UpdateDetails` (`:68`, `:118`), and
  finds a comment through `GetChildOrNotFound` (`:144`). `TicketInvariants` is the static class
  (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Domain/Tickets/TicketInvariants.cs:16`,
  `Result.Combine` at `:27`, `:33`, `:40`). The ADC and Store aggregates use the same members, for
  example `Speaker` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/Speaker.cs:392`,
  `:452`, `:472`) and `Product`
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/Product.cs:407`, `:455`, `:474`).
- **Adoption: the three application repos subclass the full base unchanged.** MMCA.ADC
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Domain/EntityConventionTests.cs:3-6`),
  MMCA.Store
  (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Domain/EntityConventionTests.cs:3-6`)
  and MMCA.Helpdesk
  (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:89-92`)
  each supply only their architecture map.
- **MMCA.Common does not subclass `EntityConventionTestsBase`.** It has no business modules, and the
  sealed, setter and module-scoped constructor rules scope to module domains, so those three would be
  vacuous there (`ArchitectureRules.Entities.cs:141-144`, `:86`). The layer-placement and DTO/request
  rules do not scope to module domains (`ArchitectureRules.Entities.cs:180-217`), but Common does not
  call them either. It subclasses the smaller
  `AggregateConventionTestsBase` instead
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Domain/AggregateConventionTests.cs:9`),
  which runs the vacuity, `Create` factory and Domain-wide `Result<T>` facts plus a no-public-constructor
  rule scoped to the whole Domain layer rather than module domains
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Domain/AggregateConventionTestsBase.cs:14-24`,
  rule at `ArchitectureRules.Entities.cs:90-100`). The framework's own types are therefore not checked
  for sealing, setters, layer placement or DTO/request placement by this suite.

## Rationale
- **One contract, one record.** The pieces were each correct in their own ADR, but an agent writing a
  new entity needs the whole shape at once, and a reviewer needs to know which deviations a build
  catches. Naming the gated and ungated halves separately is the point of the record.
- **The factory is where invariants run.** A `Create` returning `Result<T>` lets construction fail
  as a value ([ADR-013](013-result-pattern.md)), and the no-public-constructor rule removes the path
  around it.
- **A public setter makes every invariant optional.** The factory can only guarantee the state it
  builds; a public setter lets any caller reach a state no invariant saw, and putting mutation behind
  a named method is also what keeps the state change and its domain event together
  (`ArchitectureRules.Entities.cs:120-126`).
- **Sealing keeps the boundary closed.** Inheriting a concrete aggregate would let a subclass bypass
  the factory and the named methods; only the abstract framework bases are meant to be extended.
- **Combine reports everything.** Because `Result.Combine` aggregates every failed input, a caller
  sees all broken invariants in one response rather than fixing them one round trip at a time.
- **Executable beats documented.** The gated parts follow the fitness-function style of
  [ADR-015](015-architecture-fitness-functions.md): the failure message names the fix, so nobody has
  to remember the rule.

## Trade-offs
- **Part of the contract is not enforced.** Child access through `GetChildOrNotFound`, `SetItems` and
  the remove, restore and cascade-delete helpers, the existence of an `*Invariants` class and the use of `Result.Combine` hold by copying, not by a test; an abstract module-domain class over an entity base also escapes the sealed rule. An
  aggregate that reaches into a child list directly or validates inline still builds.
- **Eager evaluation has a cost.** Every argument to `Result.Combine` runs before the call, so an
  invariant that depends on an earlier one passing must guard itself or run in a separate step.
- **The setter rule sees accessibility, not intent.** A public setter called only from inside the
  aggregate still fails (`ArchitectureRules.Entities.cs:139-141`), and a public mutable field is left
  to the analyzers rather than this rule (`:144-145`).
- **Layer placement covers two layers.** The rule scans Application and Infrastructure assemblies only
  (`ArchitectureRules.Entities.cs:182`); an entity declared in an API or UI assembly is not caught by
  it.
- **The `Create` check is by name.** A type with no `Create` method is outside the `Result<T>` rule
  entirely (`ArchitectureRules.Entities.cs:67-70`), so a factory under another name is unchecked.
- **The framework's own model is gated more lightly.** MMCA.Common runs the smaller base, so sealing,
  setter, layer-placement and DTO/request rules do not apply to its own concrete Domain types.

## Related
[ADR-013](013-result-pattern.md) (the `Result<T>` factories this contract requires),
[ADR-068](068-value-objects-as-validated-primitives.md) (value-object factories and the static
`*Invariants` class this contract reuses for entities),
[ADR-126](126-event-sourcing-not-adopted.md) (an aggregate is a current-state row that raises domain
events, which is the row this contract shapes),
[ADR-015](015-architecture-fitness-functions.md) (the fitness-function style and the shared
`*TestsBase` package all four repos subclass),
[ADR-125](125-parameterized-sql-only.md) (the precedent for a fitness-gated convention getting its own
record). Framework version and package figures live in `MMCA.Common/FACTS.md`.
