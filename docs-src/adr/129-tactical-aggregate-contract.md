# ADR-129: The Tactical Aggregate Contract

## Status
Accepted (2026-10-01). Revised 2026-10-21: anchors refreshed after the ADC `Speaker` aggregate moved its child-access call sites. Revised 2026-10-26: anchors refreshed after the framework aggregate base and the Helpdesk `Ticket`, ADC `Speaker` and Store `Product` aggregates moved their child-access and `Result.Combine` lines. Revised 2026-11-23: MMCA.Common now runs the full entity suite over its own aggregates through a framework-as-module map, and the existence of a soft-delete cascade to an aggregate's children is recorded as fitness-gated, with a test subclassed in all four repos; anchors refreshed.

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
fitness-gated by `EntityConventionTestsBase`, and that a soft delete cascades to the children at all
is fitness-gated by `CascadeSoftDeleteConventionTestsBase` (an existence check, not a coverage
check); the child-access helpers themselves and the use
of `Result.Combine` are framework members and a convention every repo follows, not a test.

- **One hierarchy, three abstract levels.** `BaseEntity<TIdentifierType>`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/BaseEntity.cs:34`) carries identity;
  `AuditableBaseEntity<TIdentifierType>`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:13`) adds soft delete,
  the audit fields and the row version, all with private setters (`:20-55`): `IsDeleted` is set by
  the domain methods `Delete()` (public virtual, `:69-82`) and `Undelete()` (protected, `:91-106`),
  while the audit fields are stamped at save time by `AuditSaveChangesInterceptor` (`:22-23`); and
  `AuditableAggregateRootEntity<TIdentifierType>`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableAggregateRootEntity.cs:14`) adds the
  domain event list (`:17-51`) and the child-access members below. The fitness rules recognize an
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
  (`AuditableAggregateRootEntity.cs:106-123`). `SetItems<TChildEntity>` is the protected collection
  replacement: it copies the incoming items, calls the overridable `ValidateSetItems` hook (a no-op by
  default) and only then replaces the backing list (`:61-77`, hook at `:88-93`). Three more protected
  static helpers build on the lookup: `RemoveChildOrNotFound` (lookup then the child's `Delete()`,
  `:159`), `RestoreChild` (reactivates a soft-deleted child, `:213`) and `DeleteChildren` (soft-deletes
  every active child for a cascading `Delete()`, `:274`). All five are protected, so only the aggregate
  calls them directly; aggregates still expose `internal` `SetXxx` wrappers over `SetItems` for
  manual navigation loading (for example
  `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/Product.cs:420-421`, `:427-428`), which
  Application-layer navigation populators call
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Products/ProductNavigationPopulator.cs:28`).
  No fitness rule requires the use of any of these helpers. What is gated is that a cascading delete
  exists: `AggregatesCascadeSoftDeleteToChildren`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Domain/ArchitectureRules.CascadeSoftDelete.cs:100-143`)
  reads the IL of every concrete aggregate root that declares a child collection and fails it when it
  has no `Delete()` override, or when that override's own instructions contain neither a call to
  `DeleteChildren` nor a virtual call to any zero-argument `Delete` (`:148-186`), unless the type is
  on a reviewed exemption list. It runs as the one fact of `CascadeSoftDeleteConventionTestsBase`
  (`.../Bases/Domain/CascadeSoftDeleteConventionTestsBase.cs:18-31`), which all four repos subclass
  (for example
  `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Domain/CascadeSoftDeleteConventionTests.cs:12`).
  Two of those runs assert less than the sentence suggests. MMCA.Common runs the rule over
  `CommonArchitectureMap`, and the framework declares no child-bearing aggregate, so its run is a
  ratchet rather than an assertion
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Domain/CascadeSoftDeleteConventionTests.cs:8-11`,
  `:16`). The exemption lists are not empty: ADC exempts `Speaker`, the example aggregate below,
  because its junction rows deliberately outlive the soft-deleted root
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Domain/CascadeSoftDeleteConventionTests.cs:19-25`),
  and Store exempts `Category`, whose `Delete()` refuses while children are assigned
  (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Domain/CascadeSoftDeleteConventionTests.cs:19-24`).
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
  `TicketInvariants` through `Result.Combine` in `Create` and `UpdateDetails` (`:68`, `:117`), and
  finds a comment through `GetChildOrNotFound` (`:143`). `TicketInvariants` is the static class
  (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Domain/Tickets/TicketInvariants.cs:13`,
  `Result.Combine` at `:24`, `:30`, `:37`). The ADC and Store aggregates use the same members, for
  example `Speaker` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/Speaker.cs:441`,
  `:498`, `:517`) and `Product`
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/Product.cs:421`, `:468`, `:487`).
- **Adoption: all four repos subclass the full base.** The three application repos subclass it
  unchanged: MMCA.ADC
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Domain/EntityConventionTests.cs:3-6`),
  MMCA.Store
  (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Domain/EntityConventionTests.cs:3-6`)
  and MMCA.Helpdesk
  (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:89-92`)
  each supply only their architecture map.
- **MMCA.Common runs the full base over a framework-as-module map.**
  `EntityConventionTests` subclasses `EntityConventionTestsBase`
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Domain/EntityModel/EntityConventionTests.cs:12`)
  over `FrameworkModuleArchitectureMap`, which registers the framework's Shared, Domain and Application
  assemblies as one module named `Framework` and keeps Infrastructure a framework layer
  (`.../Domain/EntityModel/FrameworkModuleArchitectureMap.cs:16-29`). The sealed, setter and
  module-scoped constructor rules, which would be vacuous over the default `CommonArchitectureMap`
  (`FrameworkModuleArchitectureMap.cs:12-13`), therefore run over the aggregates the framework ships,
  the Notifications family (`:10-11`), alongside the layer-placement and DTO/request rules. Common also
  keeps the smaller `AggregateConventionTestsBase` over `CommonArchitectureMap`
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Domain/AggregateConventionTests.cs:9`),
  which adds a no-public-constructor rule scoped to the whole Domain layer rather than module domains
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Domain/AggregateConventionTestsBase.cs:14-24`,
  rule at `ArchitectureRules.Entities.cs:90-100`).

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
  the remove, restore and cascade-delete helpers (that some cascade exists is gated, the helper that
  performs it is not), the existence of an `*Invariants` class and the use of `Result.Combine` hold by copying, not by a test; an abstract module-domain class over an entity base also escapes the sealed rule. An
  aggregate that reaches into a child list directly or validates inline still builds.
- **Eager evaluation has a cost.** Every argument to `Result.Combine` runs before the call, so an
  invariant that depends on an earlier one passing must guard itself or run in a separate step.
- **The setter rule sees accessibility, not intent.** A public setter called only from inside the
  aggregate still fails (`ArchitectureRules.Entities.cs:139-141`), and a public mutable field is left
  to the analyzers rather than this rule (`:144-145`).
- **Layer placement covers two layers.** The rule scans Application and Infrastructure assemblies only
  (`ArchitectureRules.Entities.cs:182`); an entity declared in an API or UI assembly is not caught by
  it.
- **The cascade rule proves existence, not coverage.** An aggregate with two child collections that
  cascades only one still passes, so a unit test on the aggregate pins the second
  (`ArchitectureRules.CascadeSoftDelete.cs:88-90`); only direct calls in the override are read, so a
  loop moved into a private helper is reported even though it cascades (`:85-87`); any virtual call
  to a zero-argument `Delete` counts as a child delete (`:183-186`); and only collections declared on
  the aggregate itself are inspected (`:90-91`).
- **The `Create` check is by name.** A type with no `Create` method is outside the `Result<T>` rule
  entirely (`ArchitectureRules.Entities.cs:67-70`), so a factory under another name is unchecked.

## Revision (2026-10-06)
- No content changes: the contract described above still matches the code.
- Anchors re-verified against current source; the ADC `Speaker` examples now point at the
  `SetItems`, `RemoveChildOrNotFound` and `GetChildOrNotFound` call sites (`Speaker.cs:394`, `:454`,
  `:474`).

## Revision (2026-10-21)
Re-verified against current source. The contract is unchanged: ADC `Speaker` still uses the same
child-access members as Helpdesk `Ticket` and Store `Product`, and the Store `Product` anchors still
hold (`SetItems` at `Product.cs:407`, `RemoveChildOrNotFound` at `:455`, `GetChildOrNotFound` at
`:474`). Only the ADC `Speaker` anchors moved.

1. Anchors re-verified against current source: the ADC `Speaker` examples in the Decision now point
   at the real call sites, `SetItems` at
   `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/Speaker.cs:437`,
   `RemoveChildOrNotFound` at `:497` and `GetChildOrNotFound` at `:517` (the same members also
   appear at `:511` and `:423`). The earlier `:394`, `:454` and `:474` no longer land on these calls.

## Revision (2026-10-26)
Re-verified against current source. The contract is unchanged: the five protected child-access
members, the `SetItems`/`ValidateSetItems` pair and the `Result.Combine` usage in Helpdesk `Ticket`,
ADC `Speaker` and Store `Product` are as described. Only line anchors moved, in the framework base and
in all three example aggregates; the Store `Product` anchors the 2026-10-21 revision called stable had
also moved.

1. Anchors re-verified against current source:
   `MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableAggregateRootEntity.cs:212`
   (`RestoreChild`, was `:214`) and `:273` (`DeleteChildren`, was `:275`); `:105`, `:158`, `:60` and
   `:87` still hold. Store
   `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/Product.cs:405` (`SetItems`),
   `:451` (`RemoveChildOrNotFound`, also `:301`), `:470` (`GetChildOrNotFound`, also `:500`, `:534`,
   `:556`) and the `internal` wrappers at `:404-405` and `:411-412`. ADC
   `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/Speaker.cs:434`
   (`SetItems`, also `:504`), `:491` (`RemoveChildOrNotFound`, also `:421`) and `:510`
   (`GetChildOrNotFound`). Helpdesk
   `MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Domain/Tickets/Ticket.cs:117`
   (`Result.Combine` in `UpdateDetails`) and `:143` (`GetChildOrNotFound`); `Ticket.cs:26`, `:52`,
   `:66`, `:68` and `TicketInvariants.cs:16`, `:27`, `:33`, `:40` still hold.

## Revision (2026-11-23)
Re-verified against current source. The construction, encapsulation, placement and child-access
contract is unchanged. Two statements moved: MMCA.Common now runs the full entity suite over its own
aggregates, and the existence of a soft-delete cascade to an aggregate's children is fitness-gated,
with the test subclassed in all four repos. The framework base and the three example aggregates also moved their line anchors.

1. MMCA.Common subclasses `EntityConventionTestsBase`
   (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Domain/EntityModel/EntityConventionTests.cs:12`)
   over `FrameworkModuleArchitectureMap` (`FrameworkModuleArchitectureMap.cs:16-29`), so the sealed,
   setter, module-scoped constructor, layer-placement and DTO/request rules now cover the framework's
   Notifications aggregates. The Decision bullet that called those rules vacuous in Common and the
   trade-off "The framework's own model is gated more lightly" are replaced; the smaller
   `AggregateConventionTests` (`AggregateConventionTests.cs:9`) still runs alongside.
2. The cascade-delete part of the child-access contract is gated as an existence check:
   `AggregatesCascadeSoftDeleteToChildren`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Domain/ArchitectureRules.CascadeSoftDelete.cs:100-143`)
   fails a child-bearing aggregate root whose `Delete()` override contains neither a `DeleteChildren`
   call nor a virtual zero-argument `Delete` call, run by `CascadeSoftDeleteConventionTestsBase.cs:18-31`
   and subclassed in MMCA.ADC and MMCA.Store (`Domain/CascadeSoftDeleteConventionTests.cs:12`),
   MMCA.Helpdesk (`:16`) and MMCA.Common (`:14`, a ratchet: no framework aggregate has children).
   ADC exempts `Speaker` and Store exempts `Category`. The helpers themselves stay optional; the
   Decision lead, the child-access bullet, the first trade-off and a new cascade trade-off now say so.
3. Anchors re-verified against current source:
   `MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:20-55` (private setters,
   `RowVersion` at `:55`), `:69-82` (`Delete()`, public virtual) and `:91-106` (`Undelete()`,
   protected), `:22-23` (stamped by `AuditSaveChangesInterceptor`); `:13` still holds.
   `MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableAggregateRootEntity.cs:14` (class),
   `:17-51` (event list), `:61-77` (`SetItems`), `:88-93` (`ValidateSetItems`), `:106-123`
   (`GetChildOrNotFound`), `:159` (`RemoveChildOrNotFound`), `:213` (`RestoreChild`) and `:274`
   (`DeleteChildren`). Helpdesk
   `MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Domain/Tickets/TicketInvariants.cs:13`
   (class) with `Result.Combine` at `:24`, `:30`, `:37`; `Ticket.cs:26`, `:52`, `:66`, `:68`, `:117`
   and `:143` still hold. ADC
   `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/Speaker.cs:441`
   (`SetItems`, also `:511`), `:498` (`RemoveChildOrNotFound`, also `:428`), `:517`
   (`GetChildOrNotFound`) and `:408` (`RestoreChild`). Store
   `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/Product.cs:420-421` and
   `:427-428` (the `internal` `SetProductImages` and `SetProductVariants` wrappers, `SetItems` at
   `:421`, `:428`), `:468` (`RemoveChildOrNotFound`, also `:304`), `:487` (`GetChildOrNotFound`, also
   `:517`, `:551`, `:573`) and `:142-143` (`DeleteChildren` in `Delete()`).

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
