# 2. Domain Building Blocks (Entities, Value Objects, Aggregates)

**What this group covers.** This is the DDD heart of the framework, the small, dependency-light
primitives every business model in `MMCA.Common` and `MMCA.ADC` is built from. There are three
families here, and they interlock:

1. **The entity hierarchy**, a three-rung inheritance chain ([`BaseEntity<TIdentifierType>`](#baseentitytidentifiertype) →
   [`AuditableBaseEntity<TIdentifierType>`](#auditablebaseentitytidentifiertype) →
   [`AuditableAggregateRootEntity<TIdentifierType>`](#auditableaggregaterootentitytidentifiertype)) plus the
   contracts that describe each rung ([`IBaseEntity<TIdentifierType>`](#ibaseentitytidentifiertype),
   [`IAuditableEntity`](#iauditableentity), [`IRowVersioned`](#irowversioned),
   [`IAggregateRoot`](#iaggregateroot)). Each rung adds exactly one capability: identity, then
   audit/soft-delete/concurrency, then domain-event collection and aggregate operations. Two **opt-in
   markers** sit beside the chain rather than in it: [`ITenantEntity`](#itenantentity) (this row belongs
   to one tenant) and [`IAuditedEntity`](#iauditedentity) (record this entity's change history).
2. **The value-object family**, the [`ValueObject`](#valueobject) base and the concrete, immutable
   concepts built on it: [`Address`](#address), [`Money`](#money), [`Currency`](#currency),
   [`Email`](#email), [`PhoneNumber`](#phonenumber), [`DateRange`](#daterange), and
   [`DateTimeRange`](#datetimerange), each guarded by a matching invariants helper
   ([`AddressInvariants`](#addressinvariants), [`EmailInvariants`](#emailinvariants),
   [`PhoneNumberInvariants`](#phonenumberinvariants)) plus the shared [`CommonInvariants`](#commoninvariants)
   toolbox, and the [`CurrencyJsonConverter`](#currencyjsonconverter) that puts `Currency` on the wire.
   The **smart-enumeration** trio ([`Enumeration<TEnumeration>`](#enumerationtenumeration) with its
   [`EnumerationJsonConverterFactory`](#enumerationjsonconverterfactory) and the factory's nested
   [`EnumerationConverter<TEnumeration>`](#enumerationconvertertenumeration)) is a deliberate cousin of
   this family rather than a member of it, for a reason spelled out below.
3. **The governance markers and helpers**, the attributes and small utilities that drive
   metadata-based behavior across the stack: [`PiiAttribute`](#piiattribute) (erasure, log masking, and
   audit-trail redaction) with its redaction half [`PiiRedactor`](#piiredactor) and that helper's cached
   [`RedactableProperty`](#redactableproperty) descriptor,
   [`IdValueGeneratedAttribute`](#idvaluegeneratedattribute) + [`EntityTypeExtensions`](#entitytypeextensions)
   (database-generated IDs), [`IAnonymizable`](#ianonymizable) (GDPR/CCPA erasure), the
   [`DomainEntityState`](#domainentitystate) enum (state-change classification for domain events), and
   [`DomainHelper`](#domainhelper) (culture-invariant identifier parsing).

All of these live in the two innermost layers, `MMCA.Common.Shared` (value objects, invariants,
enumerations, `DomainHelper`) and `MMCA.Common.Domain` (entities, interfaces, attributes, enums,
privacy helpers), so the whole group sits below Application and Infrastructure in the dependency flow
(see [primer §1](00-primer.md#1-the-big-picture)). Nothing here references EF Core, ASP.NET, or a
message broker; persistence and dispatch are *described* by these types and *implemented* by higher
groups. That separation is the [Rubric §3, Clean Architecture] and [Rubric §4, Domain-Driven Design]
story in miniature: the model is framework-free, and the framework adapts to it.

## The entity chain, one capability per rung

Read the chain bottom-up. [`BaseEntity<TIdentifierType>`](#baseentitytidentifiertype)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/BaseEntity.cs:14`) is almost nothing: a single
`required init` identifier of the per-entity alias type, constrained `where TIdentifierType : notnull`
(`BaseEntity.cs:14-17`), and it implements
[`IBaseEntity<TIdentifierType>`](#ibaseentitytidentifiertype)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IBaseEntity.cs:7`), which declares `Id` with an
`init` accessor so the contract itself forbids reassignment (`IBaseEntity.cs:11`). See
[identifier aliases](00-primer.md#2-architectural-styles-this-codebase-commits-to) for where the alias
types come from, and [ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)
for why they are `global using` aliases over primitives rather than strongly-typed ID structs.
`required init` is the load-bearing choice: a factory method sets `Id` once at construction and it is
immutable thereafter, while EF Core still materializes the entity through the parameterless
constructor.

[`AuditableBaseEntity<TIdentifierType>`](#auditablebaseentitytidentifiertype)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:13`) adds the
cross-cutting facts every persisted row needs: **soft-delete** (`IsDeleted` at
`AuditableBaseEntity.cs:20`, plus a `Delete()`/`Undelete()` pair at `AuditableBaseEntity.cs:47` and
`AuditableBaseEntity.cs:67` that return [`Result`](group-01-result-error-handling.md#result) and refuse
to double-delete or to undelete a live row), **audit fields** (`CreatedOn/By`, `LastModifiedOn/By` at
`AuditableBaseEntity.cs:25-31`) with *private* setters, and the `RowVersion` optimistic-concurrency
token (`AuditableBaseEntity.cs:39`). The domain never writes the audit fields: they are stamped
centrally by [`AuditSaveChangesInterceptor`](group-07-persistence-ef-core.md#auditsavechangesinterceptor),
which walks `ChangeTracker.Entries<IAuditableEntity>()` and assigns through
`entry.Property(...).CurrentValue`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/AuditSaveChangesInterceptor.cs:43-57`),
freezing `CreatedOn/By` as unmodified on updates (`AuditSaveChangesInterceptor.cs:54-55`). The class
declares both [`IAuditableEntity`](#iauditableentity) and [`IRowVersioned`](#irowversioned)
(`AuditableBaseEntity.cs:13`); the latter exists so a repository can accept *any* tracked child entity
for a concurrency check without a second generic parameter for the child's identifier type
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IRowVersioned.cs:11`, rationale spelled out in
the type's own doc comment at `IRowVersioned.cs:3-10` and in [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)).
This rung is where [Rubric §8, Data Architecture] (soft-delete, audit, concurrency) meets [Rubric §10,
Cross-Cutting]: three concerns that would otherwise be copy-pasted into every entity are inherited once
and enforced centrally ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) for soft-delete versus erasure).

[`AuditableAggregateRootEntity<TIdentifierType>`](#auditableaggregaterootentitytidentifiertype)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableAggregateRootEntity.cs:13`) is the top
rung and the one that earns the DDD name "aggregate root". It implements
[`IAggregateRoot`](#iaggregateroot), so it owns a private domain-event list with `AddDomainEvent`, a
read-only `DomainEvents` view, `ClearDomainEvents`, and the surgical `RemoveDomainEvents`
(`AuditableAggregateRootEntity.cs:16-50`), and it adds the two helpers that let a root police its own
consistency boundary: `SetItems<TChildEntity>` (replace a child collection, routed through an
overridable `ValidateSetItems` hook so a root can veto, say, removing a shipped order line,
`AuditableAggregateRootEntity.cs:60-90`) and `GetChildOrNotFound<TChild, TChildId>` (find an *active*,
non-soft-deleted child by id or return an [`Error.NotFound`](group-01-result-error-handling.md#error)
failure, `AuditableAggregateRootEntity.cs:103-120`). `RemoveDomainEvents` is worth pausing on: it takes
out exactly the events the persistence layer captured, matched by **reference** equality
(`AuditableAggregateRootEntity.cs:43`), because two structurally equal events raised separately are
still two distinct occurrences. Only aggregate roots raise domain events, and that is how the
persistence layer knows where to look. This rung is the clearest [Rubric §4, Domain-Driven Design] and
[Rubric §6, CQRS & Event-Driven] expression in the codebase: invariants are enforced *inside* the
boundary, and state changes are announced as events rather than leaked as side effects.

## Two opt-in markers beside the chain

Not every cross-cutting capability belongs on the inheritance chain, because not every entity should
pay for it. [`ITenantEntity`](#itenantentity)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/ITenantEntity.cs:33`) declares a single
read-only `string TenantId` (`ITenantEntity.cs:39`), and marking an entity with it buys two behaviors
at once. On reads, a **named** `Tenant` global query filter is applied alongside the existing
`SoftDelete` filter (`ApplyTenantFilters` and `entity.HasQueryFilter(TenantFilterName, filter)` at
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:394`
and `:441`, with the filter name constant at `ApplicationDbContext.cs:360`); named filters compose with
AND, so a tenant sees neither another tenant's rows nor soft-deleted ones. On writes,
[`TenantSaveChangesInterceptor`](group-07-persistence-ef-core.md#tenantsavechangesinterceptor) stamps
the value on insert and refuses a cross-tenant save, which is why the property is read-only on the
domain type: the value is not a caller's to choose (`ITenantEntity.cs:15-20`). The identifier is a
64-character `string` on purpose, because it arrives from a claim, a header, or configuration, all of
which are strings (`ITenantEntity.cs:21-25`). Adopting tenancy is three things together: marking
entities, calling `AddMultiTenancy(configuration)`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:424`), and setting
`Tenancy:Enabled` (`ITenantEntity.cs:26-31`); a host that never resolves a tenant behaves exactly as it
did before ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)).

[`IAuditedEntity`](#iauditedentity)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAuditedEntity.cs:34`) is a pure marker, no
members at all, and it opts an entity into a field-level change history: every insert, update and
delete recorded as immutable rows by
[`AuditTrailSaveChangesInterceptor`](group-07-persistence-ef-core.md#audittrailsavechangesinterceptor)
into [`AuditTrailEntry`](group-07-persistence-ef-core.md#audittrailentry) rows. The doc comment is the
best explanation of why it is a marker and not a default: a trail is one row per changed property per
save, so trailing everything multiplies write volume without anyone asking for it
(`IAuditedEntity.cs:8-14`). It composes with [`IAuditableEntity`](#iauditableentity) but does not
require it, because the two answer different questions: `IAuditableEntity` stamps the CURRENT state,
`IAuditedEntity` records the SEQUENCE that produced it, and when both are present the trail rows see the
freshly stamped values because the trail is captured after the stamping interceptor has run
(`IAuditedEntity.cs:15-21`). Like tenancy, recording is host-gated behind
`AddAuditTrail(configuration)` (`DependencyInjection.cs:375`) plus `AuditTrail:Enabled`, so marking an
entity in a host that never opted in is inert (`IAuditedEntity.cs:22-26`). Both markers are
[Rubric §8, Data Architecture] and [Rubric §30, Compliance/Privacy/Data Governance] concerns
([ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html)), and both are deliberately
zero-cost until switched on, which is the [Rubric §31, Cost/FinOps] half of the same decision.

## How a domain event leaves an aggregate

The runtime flow ties this group to the events/outbox group. A command handler loads an aggregate,
calls a business method, and that method calls `AddDomainEvent(...)`; the event sits in the aggregate's
private list, doing nothing yet. On save, EF Core interceptors take over.
[`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
captures every tracked [`IAggregateRoot`](#iaggregateroot) that has pending events via
`context.ChangeTracker.Entries<IAggregateRoot>()`, snapshotting each aggregate's event list at capture
time
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:198-202`),
serializes them into [`OutboxMessage`](group-04-events-outbox.md#outboxmessage) rows **in the same
transaction** as the data (`DomainEventSaveChangesInterceptor.cs:219-235`), then after a successful
save dispatches the local [`IDomainEvent`](group-04-events-outbox.md#idomainevent)s in process, marks
their outbox rows processed, and removes exactly the captured events from each aggregate
(`DomainEventSaveChangesInterceptor.cs:301-341`). That last step is why `IAggregateRoot` grew
`RemoveDomainEvents`: clearing wholesale would also discard anything a handler raised on the same
aggregate during in-process dispatch, and those events would never dispatch and never reach the outbox
(`DomainEventSaveChangesInterceptor.cs:331-341`). Integration events
(`IIntegrationEvent`) deliberately get rows but no in-process dispatch; the `OutboxProcessor` publishes
them (`DomainEventSaveChangesInterceptor.cs:215-217`). Inside a transactional command the whole flush is
deferred until after commit through a `DeferredDispatch` record
(`DomainEventSaveChangesInterceptor.cs:285-292`), so a handler never acts on state that could still roll
back. The [`DomainEntityState`](#domainentitystate) enum (`Unchanged`/`Added`/`Updated`/`Deleted`, with
explicit numeric values at
`MMCA.Common/Source/Core/MMCA.Common.Domain/Enums/DomainEntityState.cs:9-12`) is the small vocabulary an
event uses to say *what kind* of change happened. The aggregate base is the producer end of the
at-least-once outbox pipeline ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)); the consumer end lives in
[Group 04](group-04-events-outbox.md).

## Value objects, invalid instances cannot exist

The second family models concepts with **no identity**: two `Money(10, USD)` are equal because their
values match, not because they are the same row. [`ValueObject`](#valueobject) is the cheapest possible
base, `public abstract record ValueObject;`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/ValueObject.cs:8`), so every value object
inherits compiler-generated structural equality and immutability for free (the canonical Value Object
teaching is in [primer §2](00-primer.md#2-architectural-styles-this-codebase-commits-to)).

The shared shape across all of them is the **private-constructor + static `Create` factory returning
[`Result<T>`](group-01-result-error-handling.md#result)** idiom: you cannot `new` a value object, and
the only way in runs through validation, so an invalid `Email`, `Money`, `Address`, or `DateRange`
simply cannot be constructed ([ADR-068](https://ivanball.github.io/docs/adr/068-value-objects-as-validated-primitives.html)).
The validation logic itself is factored out into static *invariants* classes,
[`AddressInvariants`](#addressinvariants)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/AddressInvariants.cs:9`),
[`EmailInvariants`](#emailinvariants)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/EmailInvariants.cs:11`), and
[`PhoneNumberInvariants`](#phonenumberinvariants)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/PhoneNumberInvariants.cs:11`), which also
publish the length constants that EF entity configurations and FluentValidation validators reuse
(`Email` at 256 characters, `EmailInvariants.cs:14`; `PhoneNumber` between 7 and 20,
`PhoneNumberInvariants.cs:14-17`; the six address field limits at `AddressInvariants.cs:12-27`), so the
field-length rules have **one source of truth**. [`CommonInvariants`](#commoninvariants)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Invariants/CommonInvariants.cs:12`) is the reusable lower
layer that module-specific invariants delegate to, and it has grown well past the string/id basics:
`EnsureStringIsNotEmpty` (`:29`), `EnsureStringMaxLength` (`:46`), `EnsureIdIsNotDefault<TId>` (`:62`),
`EnsureBytesAreNotEmpty` (`:78`), `EnsureIntIsPositive` (`:93`), `EnsureMoneyIsNotNegative` (`:109`),
`EnsureCollectionIsNotEmpty<T>` (`:125`), plus the two preference checks
`EnsurePreferredCultureIsValid` (`:141`) and `EnsurePreferredThemeIsValid` (`:157`, matching `light` or
`dark` case-insensitively against the constants at `CommonInvariants.cs:15-18`). Each returns a
`Result`, and the calling invariants class folds them together with `Result.Combine` so one call reports
every broken rule at once (`AddressInvariants.cs:40`). This whole family is the [Rubric
§4, Domain-Driven Design] and [Rubric §1, SOLID] (the factory enforces invariants; invariants are a
single-responsibility unit) story.

The concrete value objects split into a few patterns worth knowing up front:

- **Owned-type composites**: [`Address`](#address)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Address.cs:16`) and [`Money`](#money)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Money.cs:21`) are stored by EF as `OwnsOne`
  nested columns; both carry `[DataContract]` with ordered `[DataMember(Order = n)]` properties to pin
  the serialization shape (`Address.cs:15-40`, `Money.cs:20-35`). `Address` requires only
  `AddressLine1` and leaves the other five fields optional for international formats. `Money` is the
  richest: it pairs a `decimal Amount` with a [`Currency`](#currency), defines `+` and `*` operators
  *and* a `Result`-returning `Add` (`Money.cs:84-118`), and treats `Currency.None` as an additive
  identity so `Money.Zero()` works as an accumulator seed regardless of the eventual currency
  (`Money.cs:131-142`). Note the asymmetry worth remembering: the `+` operator *throws*
  `InvalidOperationException` on a currency mismatch (`Money.cs:89`) while `Add` returns a
  `CurrencyMismatch` failure (`Money.cs:112`), so prefer `Add` in domain code. `Money` also asks to be
  mapped through the shipped `OwnsMoney` helper rather than a hand-rolled `OwnsOne` block, so the
  currency round-trip fallback is not re-typed per entity (`Money.cs:14-19`).
- **Closed enumeration**: [`Currency`](#currency)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Currency.cs:14`) is a record with a private
  constructor (`Currency.cs:31`) and a fixed `All` set of exactly `Usd` and `Eur` (`Currency.cs:54-58`),
  plus an `internal` `None` sentinel that is deliberately *not* in `All` and never reaches API consumers
  (`Currency.cs:23`). `FromCode` is the only public way to get one and matches case-insensitively
  (`Currency.cs:41-51`), and [`CurrencyJsonConverter`](#currencyjsonconverter) (`Currency.cs:73`)
  serializes it as its bare ISO-4217 code on the wire, throwing a `JsonException` on a non-string token
  or an unknown code when reading (`Currency.cs:76-88`).
- **Converted scalars**: [`Email`](#email)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Email.cs:16`) and
  [`PhoneNumber`](#phonenumber)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/PhoneNumber.cs:16`) are stored via EF
  `HasConversion` (not `OwnsOne`) through the shipped `EmailValueConverter` /
  `PhoneNumberValueConverter` pairs, so the column stays a flat `nvarchar` (`Email.cs:7-14`,
  `PhoneNumber.cs:7-14`). Both normalize on creation (`Email` trims then lowercases with
  `ToLowerInvariant`, `Email.cs:32-39`; `PhoneNumber` trims, `PhoneNumber.cs:36`) and expose an implicit
  `string` conversion plus a `ToString` override for ergonomics (`Email.cs:45-48`,
  `PhoneNumber.cs:41-44`).
- **Interval pairs**: [`DateRange`](#daterange)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/DateRange.cs:9`, `DateOnly` based) and
  [`DateTimeRange`](#datetimerange)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/DateTimeRange.cs:10`, full precision) are
  near-identical: a validated start/end pair with `Overlaps`, `Contains`, `Deconstruct`, and a
  length/duration accessor (`LengthInDays` at `DateRange.cs:38`, `Duration` at `DateTimeRange.cs:39`);
  `Create` rejects `end < start` (`DateRange.cs:30-35`, `DateTimeRange.cs:31-36`). Read the boundary
  rules carefully: `Contains` is inclusive on both ends while `Overlaps` compares half-open
  (`DateRange.cs:46-56`).

## Smart enumerations, a closed set that can carry behavior

[`Enumeration<TEnumeration>`](#enumerationtenumeration)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Enumeration.cs:71`) is the answer to a
recurring shape a CLR `enum` handles badly: a closed set of named members that need behavior hanging off
them (policies, rates, display rules) instead of a `switch` statement somewhere else
(`Enumeration.cs:13-18`). Members are declared as `public static readonly` fields on the derived type and
discovered by reflection over that type's own declared fields on first use, then frozen into a
`ReadOnlyCollection` plus two `FrozenDictionary` lookups keyed by value and by name
(`Enumeration.cs:74-82`, `Enumeration.cs:165-174`); `All`, `FromValue`, and `FromName` read from those
(`Enumeration.cs:105`, `:115-125`, `:136-146`). The two resolvers return
[`Result<TEnumeration>`](group-01-result-error-handling.md#result) with `Enumeration.UnknownValue` /
`Enumeration.UnknownName` codes rather than throwing, which is the same contract every value-object
factory in this group honors.

The interesting part is what it deliberately does *not* do. It does **not** derive from
[`ValueObject`](#valueobject), because the `ValueObjectsAreImmutableSealedInShared` fitness rule
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Immutability.cs:56`)
forces every `ValueObject` derivative to be a sealed record in the Shared layer, which would forbid the
static-member idiom this type exists for (`Enumeration.cs:24-29`). It also does not implement
`IEquatable<T>`, because an unsealed `IEquatable<T>` breaks the equality contract for subclasses (S4035);
equality is a type-guarded `Equals(object?)` override instead (`Enumeration.cs:36-42`,
`Enumeration.cs:152-158`). On the wire, [`EnumerationJsonConverterFactory`](#enumerationjsonconverterfactory)
(`Enumeration.cs:195`) walks the base chain to confirm a type is the self-referencing closed type and no
further derivative (`Enumeration.cs:213-222`), then builds the private nested
[`EnumerationConverter<TEnumeration>`](#enumerationconvertertenumeration) (`Enumeration.cs:224`), which
writes the member's `Name` and reads it back through `FromName`, throwing `JsonException` on a non-string
token or an unknown name (`Enumeration.cs:227-242`) exactly the way `CurrencyJsonConverter` does, so the
non-MVC paths (cache, outbox, integration events, typed `HttpClient` calls) fail the same way MVC model
binding does. Note the registration gotcha the doc comment calls out: System.Text.Json reads
`[JsonConverter]` off the type being converted without walking base types, so a concrete enumeration
either repeats the attribute or the host registers the factory once in `JsonSerializerOptions.Converters`
(`Enumeration.cs:43-49`). This is a [Rubric §9, API & Contract Design] and [Rubric §15, Best Practices &
Code Quality] decision: one serialization shape, chosen once, with the trade-off written down where the
next reader will find it.

## Governance markers, metadata that other layers act on

The last family is tiny attributes and helpers that carry *intent* the rest of the stack reads
reflectively. [`PiiAttribute`](#piiattribute)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Attributes/PiiAttribute.cs:19`) tags a property as
data-subject PII, and it is a property-only, non-inherited, single-use attribute (`PiiAttribute.cs:18`).
Three mechanisms rely on the marker today. First, an architecture fitness test asserts that any entity
declaring a `[Pii]` property also implements [`IAnonymizable`](#ianonymizable), so every piece of
personal data has an erasure path (`PiiConventionTests`, driven by the shared `PiiConventionTestsBase`,
at `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiConventionTests.cs:13` over the rule
body at
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Governance.cs:11`; the scan
is structurally vacuous inside the framework itself because no data-subject type lives in
`MMCA.Common.Domain`). Second, [`PiiRedactor`](#piiredactor)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Privacy/PiiRedactor.cs:24`) is the redaction half: it
reflects over an object's public readable properties and replaces every `[Pii]` value wholesale with the
`"[REDACTED]"` token (`PiiRedactor.cs:27`, `PiiRedactor.cs:42-57`), offering `Redact` (a property map),
`RedactToString` (a single-line rendering, `PiiRedactor.cs:65`), and `HasPii` (a type probe,
`PiiRedactor.cs:98`). Its per-type reflection metadata is cached in a `ConcurrentDictionary` of
[`RedactableProperty`](#redactableproperty) descriptors (`PiiRedactor.cs:31`, `PiiRedactor.cs:112-121`,
the descriptor itself at `PiiRedactor.cs:123`), and a property getter that throws is caught and rendered
as `"[unreadable]"` so a logging call site can never be broken by redaction (`PiiRedactor.cs:129-140`).
Third, and newest, the audit trail consumes both halves:
[`AuditTrailSaveChangesInterceptor`](group-07-persistence-ef-core.md#audittrailsavechangesinterceptor)
calls `PiiRedactor.HasPii` per entity type and writes `PiiRedactor.RedactedToken` on *both* sides of a
change for a `[Pii]` property
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:286`,
`:309-310`), so the trail never becomes a second, unerasable copy of a data subject's personal data.
Scope note worth keeping: redaction of *logs* is still an opt-in helper you call, not an automatic
logging pipeline; the framework's stated posture is to log scalar identifiers rather than whole
entities, and to route an entity through the redactor when one must be logged (`PiiRedactor.cs:10-16`).

[`IAnonymizable`](#ianonymizable)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAnonymizable.cs:22`) defines the erasure
contract itself: an idempotent `Anonymize()` returning
[`Result`](group-01-result-error-handling.md#result) (`IAnonymizable.cs:30`) that an application-layer
handler invokes to overwrite personal fields in place while keeping the row for referential integrity
and audit history. Fields that must remain retrievable are persisted through the AES-256-GCM
`EncryptedStringConverter` instead (`IAnonymizable.cs:16-20`). Together these are the [Rubric §11,
Security] and [Rubric §30, Compliance/Privacy/Data Governance] story, and they are why soft-delete and
erasure are *different* mechanisms ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html), cited at `IAnonymizable.cs:19`): soft-delete hides a row but keeps its data,
anonymize destroys the data but keeps the row.

[`IdValueGeneratedAttribute`](#idvaluegeneratedattribute)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Attributes/IdValueGeneratedAttribute.cs:9`) marks a class
whose id the database generates (SQL Server `IDENTITY`); factory methods consult it at runtime through
[`EntityTypeExtensions`](#entitytypeextensions)'s `IsIdValueGenerated`, a C# `extension(Type)` member
that is a one-line `GetCustomAttribute` probe
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Extensions/EntityTypeExtensions.cs:11-20`), to decide
whether to assign an explicit id or leave it `default` for the database to fill. Finally,
[`DomainHelper`](#domainhelper)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Extensions/DomainHelper.cs:8`) is the culture-invariant
`string?`-to-identifier parser controllers use to turn route parameters into strongly-typed ids without
coupling to a concrete id type. It offers two extension members on `string?`: `Parse<TIdentifier>()`
(`DomainHelper.cs:30-41`), which **coerces by design** so an unparsable route value degrades to a
not-found lookup, and `TryParse<TIdentifier>(out TIdentifier)` (`DomainHelper.cs:58-75`), which reports
success instead, for the `bool` and enum callers where malformed input is otherwise indistinguishable
from a legitimate default (`DomainHelper.cs:21-29`). Both handle `string`, `Guid`, `int`, `long`,
`ulong`, `bool`, and enums, and both throw `FormatException` for an unsupported identifier type
(`DomainHelper.cs:106`, `DomainHelper.cs:166`). The `CultureInfo.InvariantCulture` parsing throughout is
also the codebase's headline [Rubric §27, Internationalization] decision (deliberate culture-invariance
where culture would otherwise introduce bugs; see
[primer §6](00-primer.md#6-the-34-category-architecture-evaluation-lens)).

## Where this group sits

Everything above is consumed by the layers that follow: every module entity (for example the
[Conference domain](group-17-conference-domain.md), Engagement, and Identity modules) derives from one
of the three entity base classes; the persistence group ([Group 07](group-07-persistence-ef-core.md))
maps value objects, stamps the audit fields these types declare, applies the global soft-delete query
filter keyed off [`IAuditableEntity`](#iauditableentity) and the tenant filter keyed off
[`ITenantEntity`](#itenantentity), and writes the change history for [`IAuditedEntity`](#iauditedentity);
the events/outbox group ([Group 04](group-04-events-outbox.md)) drains the domain events aggregates
raise; and the CQRS handlers throughout the application return the
[`Result`](group-01-result-error-handling.md#result) values these factories produce. Read this group as
the *grammar* of the domain: the rest of the guide is the sentences written in it.

### DomainEntityState
> MMCA.Common.Domain · `MMCA.Common.Domain.Enums` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Enums/DomainEntityState.cs:7` · Level 0 · enum

- **What it is**: describes the state change that triggered a domain event: `Unchanged`, `Added`,
  `Updated`, `Deleted`.
- **Depends on**: nothing first-party.
- **Concept**: a small payload enum for domain events. `[Rubric §6, CQRS & Event-Driven]` assesses
  whether events carry enough context to be acted on; when an aggregate raises an event about itself or
  a child, this enum communicates *what kind* of change happened so handlers can filter and react
  appropriately.
- **Walkthrough**: four explicitly-numbered members (`DomainEntityState.cs:9-12`); `Unchanged = 0` so
  the default value is the no-op state.
- **Why it's built this way**: explicit numeric values make the enum stable across serialization (a
  reordering will not change the wire meaning), relevant since these values travel inside events. The
  enum also collapses what would otherwise be three near-identical event types per entity
  (`Added`/`Updated`/`Deleted`) into one, which is exactly the rationale recorded on
  [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype)
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/EntityChangedEvent.cs:6-8`, taxonomy
  recorded in [ADR-083](https://ivanball.github.io/docs/adr/083-crud-lifecycle-event-taxonomy.html)).
- **Where it's used**: it is the first positional member of
  [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype)
  (`EntityChangedEvent.cs:24-25`), so every derived per-entity change event carries it; the base's own
  usage note spells out the convention (`EntityChangedEvent.cs:10-13`): raise `Added` from factories,
  `Updated` from mutation methods, `Deleted` from `Delete()`. Aggregates follow it literally (for
  example `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/Category.cs:72,95,116`
  for the root and `Category.cs:150,182,203` for its child items), and handlers short-circuit on it
  (for example
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/DomainEventHandlers/SessionCreatedHandler.cs:17`).

### DomainHelper
> MMCA.Common.Shared · `MMCA.Common.Shared.Extensions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Extensions/DomainHelper.cs:8` · Level 0 · class (static)

- **What it is**: a static class that adds two generic **extension members** to `string?`,
  `Parse<TIdentifier>()` and `TryParse<TIdentifier>(out TIdentifier)`, converting a route-parameter
  string into a strongly-typed identifier.
- **Depends on**: BCL only (`System.Globalization`).
- **Concept introduced, C# `extension(T)` members.** `[Rubric §15, Best Practices & Code Quality]`
  (assesses idiomatic, modern-language use). This is the first concrete sighting of the C# preview
  feature described in
  [primer §4](00-primer.md#c-extensiont-types-read-this-once). The block
  `extension(string? id) { … }` (`DomainHelper.cs:13`) means any nullable string can call
  `someId.Parse<int>()`. The receiver `id` is the "this" value.
- **Walkthrough**
  - `Parse<TIdentifier>()` (`DomainHelper.cs:30`): special-cases `string` (returns the value or
    empty, lines 34-35), short-circuits null/whitespace to `default` (lines 37-38), then delegates to
    `ParseNonEmpty` (line 40).
  - `TryParse<TIdentifier>(out TIdentifier)` (`DomainHelper.cs:58`) is the reporting sibling: the
    `string` case returns `id is not null` (lines 62-66), null/whitespace returns `false` with the
    type default (lines 68-72), and anything else delegates to `TryParseNonEmpty` (line 74). The two
    exist because `Parse` **coerces by design** and the doc comment says so (lines 21-29): `"maybe"`
    and `"false"` both yield `false`, an unrecognized enum name yields the enum default, `"abc"`
    yields `0`. That is fine for a route id (an unparsable value degrades into a not-found lookup) and
    wrong when malformed input must be told apart from a legitimate default, which is exactly when a
    caller reaches for `TryParse`.
  - `ParseNonEmpty<TIdentifier>` (line 80) and `ParseOtherTypes<TIdentifier>` (line 95): a chain of
    `typeof(TIdentifier) == typeof(Guid|int|long|ulong|bool)` plus `type.IsEnum` checks (lines 83-104)
    using culture-invariant `TryParse`; an unsupported type throws `FormatException` (line 106). Each
    failed `TryParse` falls back to the type's zero/empty value rather than throwing.
    `TryParseNonEmpty` (line 111) and `TryParseOtherTypes` (line 138) mirror that chain over the same
    six shapes and return the parse verdict instead of swallowing it, with the same `FormatException`
    on an unsupported type (line 166). Splitting each path into two private methods keeps every method
    within the analyzers' cyclomatic-complexity budget.
  - Note the two scoped `#pragma warning disable IDE0051` blocks around `ParseNonEmpty` (lines 79-81)
    and `TryParseNonEmpty` (lines 110-112), each with a comment (lines 78 and 109) explaining it is a
    false positive: the analyzer cannot see that the method is called from inside the `extension`
    block. A justified, narrow suppression.
- **Why it's built this way**: controllers receive ids as `string` route values; this converts them
  to the entity's id alias type **without** the controller coupling to a specific id type, generic
  over `TIdentifier` (the alias policy itself is
  [ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)).
  Culture-invariant parsing avoids locale-dependent bugs and is one of the few places §27 (i18n)
  bites, see [primer §6](00-primer.md#6-the-34-category-architecture-evaluation-lens).
- **Where it's used**: controller base classes converting route parameters to typed ids (API layer,
  G12).
- **Caveats / not-in-source**: supported target types are exactly those enumerated; anything else
  throws at runtime (there is no compile-time constraint preventing an unsupported `TIdentifier`).

### IAuditableEntity
> MMCA.Common.Domain · `MMCA.Common.Domain.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAuditableEntity.cs:8` · Level 0 · interface

- **What it is**: the contract for entities that support **soft-delete** and **audit tracking**:
  `IsDeleted`, `CreatedOn/By`, `LastModifiedOn/By`.
- **Depends on**: nothing first-party (uses the `UserIdentifierType` alias).
- **Concept introduced, soft-delete + centralized audit.** `[Rubric §8, Data Architecture]`
  (assesses soft-delete + global query filters and audit fields stamped centrally, not per-handler).
  Entities are never hard-deleted; `IsDeleted` (`IAuditableEntity.cs:11`) flips to `true` and EF global
  query filters hide the row. The audit fields (`CreatedOn` line 14, `CreatedBy` line 17,
  `LastModifiedOn?` line 20, `LastModifiedBy?` line 23) are **read-only from the domain's view**, the
  doc comment (lines 4-7) states infrastructure populates them in `SaveChangesAsync` via EF's
  `ChangeTracker`. So the domain *declares* the audit contract; the *stamping* happens centrally in
  one interceptor ([`AuditSaveChangesInterceptor`](group-07-persistence-ef-core.md#auditsavechangesinterceptor)).
  This is also `[Rubric §30, Compliance, Privacy & Data Governance]` (an audit trail supports
  accountability) and ties to [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) (soft-delete vs. erasure).
- **Walkthrough**: five getter-only properties. `CreatedBy` is `UserIdentifierType`;
  `LastModifiedBy` is `UserIdentifierType?` (nullable, null until first modified, matching
  `LastModifiedOn?`). No setters at all: the domain can *read* audit state but only infrastructure
  writes it.
- **Why it's built this way**: making audit a contract (not a base-class detail) lets the EF
  interceptor recognize "any `IAuditableEntity`" and stamp it uniformly; centralizing it is exactly the
  cross-cutting discipline §8/§10 reward. The identifier alias keeps "who" strongly named.
- **Where it's used**: implemented by [`AuditableBaseEntity<TIdentifierType>`](#auditablebaseentitytidentifiertype)
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:13`, with private
  setters populated by EF, lines 20-31); recognized by the audit `SaveChanges` interceptor and the
  soft-delete query filter (G07). It answers "who touched this row last"; the *sequence* that produced
  the row is the separate, opt-in [`IAuditedEntity`](#iauditedentity) marker. Its `IsDeleted` flag is
  the counterpart that [`IAnonymizable`](#ianonymizable) deliberately does *not* satisfy on its own
  (see [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html), and the
  explicit statement of that gap in `IAnonymizable.cs:11-12`).

### IAuditedEntity
> MMCA.Common.Domain · `MMCA.Common.Domain.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAuditedEntity.cs:34` · Level 0 · interface (marker)

- **What it is**: an opt-in marker. An entity that carries it has every insert, update and delete
  recorded as an immutable field-level change history (who changed which field, from what to what,
  and when).
- **Depends on**: nothing first-party. The declaration is a bodyless interface,
  `public interface IAuditedEntity;` (`IAuditedEntity.cs:34`); all of the behavior lives in
  infrastructure that recognizes the marker.
- **Concept introduced, change history as a per-entity opt-in.** `[Rubric §30, Compliance, Privacy &
  Data Governance]` (assesses whether a system can answer "who changed this, and when" for the records
  where someone will actually ask) and `[Rubric §31, Cost/FinOps]` (assesses whether a capability's
  running cost is a decision rather than a default). The doc comment makes the trade-off explicit
  (`IAuditedEntity.cs:9-14`): a trail is **one row per changed property per save**, so trailing every
  entity multiplies write volume and storage without anyone asking for it. Marking entities one at a
  time makes that volume deliberate: trail the aggregates whose history will be demanded (an order, a
  permission grant, a ticket) and leave high-churn bookkeeping tables alone. This is also
  `[Rubric §8, Data Architecture]`, since the trail rows are written **in the same transaction** as the
  change they describe.
- **Walkthrough**: the type itself has no members; the four remarks paragraphs are the contract.
  - *Marker, not a global default* (`IAuditedEntity.cs:9-14`): the volume rationale above.
  - *Composes with [`IAuditableEntity`](#iauditableentity) but does not require it*
    (`IAuditedEntity.cs:16-21`): the two answer different questions. `IAuditableEntity` stamps the
    CURRENT state (who touched this row last); this marker records the SEQUENCE that produced it. An
    entity may carry either, both, or neither, and when both are present the trail rows see the freshly
    stamped values because capture runs after the stamping interceptor.
  - *Recording is host-gated* (`IAuditedEntity.cs:22-26`): nothing is written unless the host called
    `AddAuditTrail(configuration)` and set `AuditTrail:Enabled`. Marking an entity in a host that never
    opted in is inert: no table, no rows, no cost.
  - *Personal data is redacted at capture* (`IAuditedEntity.cs:27-32`): a property marked with
    [`PiiAttribute`](#piiattribute) records a redaction placeholder on both sides of the change, so the
    trail never becomes a second, unerasable copy of a data subject's personal data
    ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)).
- **Why it's built this way**: an empty interface is the cheapest thing a domain type can declare that
  infrastructure can key off, and it keeps the *policy* ("this aggregate's history matters") in the
  domain while the *mechanism* stays in EF Core. The decision is recorded in
  [ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html).
- **Where it's used**: the recognizer is
  [`AuditTrailSaveChangesInterceptor`](group-07-persistence-ef-core.md#audittrailsavechangesinterceptor),
  whose `ShouldAudit` predicate is `entry.Entity is IAuditedEntity` plus a framework-entity exclusion
  and a "being written" state check
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:225-228`);
  it writes [`AuditTrailEntry`](group-07-persistence-ef-core.md#audittrailentry) rows and is registered
  last, after the audit and domain-event interceptors, so it diffs final values
  (`AuditTrailSaveChangesInterceptor.cs:26-30`). The host gate is `AddAuditTrail`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:375`) plus
  [`AuditTrailSettings.Enabled`](group-14-module-system-composition.md#audittrailsettings)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/AuditTrailSettings.cs:26`, default
  `false`). Marked aggregates today: ADC's `User`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:34`, rationale at
  `User.cs:26-29`), `Event` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/Event.cs:23`),
  `Session` (`.../Sessions/Session.cs:22`), `Speaker` (`.../Speakers/Speaker.cs:22`), `CheckIn`
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/CheckIns/CheckIn.cs:28`),
  `PointsEntry` (`.../Points/PointsEntry.cs:31`), and Helpdesk's `Ticket`
  (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Domain/Tickets/Ticket.cs:26`). The
  opting-in hosts are the three ADC services
  (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:238`,
  `MMCA.ADC.Conference.Service/Program.cs:296`, `MMCA.ADC.Engagement.Service/Program.cs:210`) and the
  Helpdesk web host (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:71`).
- **Caveats / not-in-source**: retention is not automatic. `AuditTrailSettings.RetentionDays` defaults
  to 90 (`AuditTrailSettings.cs:38`), but the doc comment states the purge only happens if the host
  also runs the scheduler; without it the trail still records and the table grows until an operator
  prunes it (`AuditTrailSettings.cs:32-36`).

### IBaseEntity<TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IBaseEntity.cs:7` · Level 0 · interface

- **What it is**: the base contract for every domain entity: a single strongly-typed, immutable
  identifier.
- **Depends on**: nothing first-party.
- **Concept introduced, entity identity.** `[Rubric §4, DDD]` (assesses aggregates/entities with
  clear identity). An **entity** (unlike a [value object](#valueobject)) *has* identity, it is the same
  thing across changes because its `Id` is the same. This interface is the minimal expression of that:
  `TIdentifierType Id { get; init; }` with `where TIdentifierType : notnull` (`IBaseEntity.cs:7-11`).
- **Walkthrough**: one `init` property. `init` (set at construction, immutable after) encodes "an
  entity's identity is assigned once and never changes", the doc comment (`IBaseEntity.cs:10`) says
  exactly this.
- **Why it's built this way**: generic id type so each entity binds its strong-id alias
  ([ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)); the
  contract is intentionally tiny so the concrete base classes
  ([`BaseEntity<TIdentifierType>`](#baseentitytidentifiertype) →
  [`AuditableBaseEntity<TIdentifierType>`](#auditablebaseentitytidentifiertype) →
  [`AuditableAggregateRootEntity<TIdentifierType>`](#auditableaggregaterootentitytidentifiertype)) can
  layer behavior on top.
- **Where it's used**: implemented (indirectly) by every entity in both apps via the
  [`BaseEntity<TIdentifierType>`](#baseentitytidentifiertype) hierarchy; the parallel DTO contract is
  [`IBaseDTO<TIdentifierType>`](group-12-api-hosting-mapping.md#ibasedtotidentifiertype).

### IdValueGeneratedAttribute
> MMCA.Common.Domain · `MMCA.Common.Domain.Attributes` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Attributes/IdValueGeneratedAttribute.cs:9` · Level 0 · class (sealed attribute)

- **What it is**: marks an entity whose `Id` is **generated by the database** (for example SQL Server
  `IDENTITY`) rather than assigned by the application.
- **Depends on**: `System.Attribute` (BCL) only.
- **Concept introduced, attribute-driven behavior in the domain.** `[Rubric §8, Data Architecture]`
  (deliberate key-generation strategy). A factory method needs to know whether to assign an explicit
  `Id` or leave it `default` for the database to fill. Rather than hard-code that per entity, the
  decision is declared with this attribute and read reflectively at runtime
  ([`EntityTypeExtensions.IsIdValueGenerated`](#entitytypeextensions)). The doc comment
  (`IdValueGeneratedAttribute.cs:3-7`) describes exactly this. `[Rubric §3, Clean Architecture]`:
  this is a *domain-level* attribute (no EF reference), so the key-generation policy lives with the
  entity, not in infrastructure.
- **Walkthrough**: `[AttributeUsage(AttributeTargets.Class, Inherited = false, AllowMultiple = false)]`
  (line 8); the attribute body is empty (`sealed class IdValueGeneratedAttribute : Attribute;`, line
  9), it is a pure marker.
- **Why it's built this way**: `Inherited = false` means a subclass does not silently inherit
  database-generated semantics; the marker keeps key-generation policy *declarative* and co-located with
  the entity.
- **Where it's used**: read by [`EntityTypeExtensions`](#entitytypeextensions) (Level 1), whose
  `IsIdValueGenerated` extension property is a single `GetCustomAttribute<IdValueGeneratedAttribute>()
  is not null` check
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Extensions/EntityTypeExtensions.cs:19`), and consumed by
  the EF entity-configuration base to decide the key's value-generation strategy
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfiguration.cs:61`)
  as well as by entity factory methods deciding whether to set `Id` (for example ADC's `User`, marked
  `[IdValueGenerated]` at
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:32`).

### IRowVersioned
> MMCA.Common.Domain · `MMCA.Common.Domain.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IRowVersioned.cs:11` · Level 0 · interface

- **What it is**: a one-member contract for any entity that carries a database-managed
  optimistic-concurrency token, exposing `byte[] RowVersion` (`IRowVersioned.cs:15`).
- **Depends on**: nothing first-party; the property type is BCL `byte[]`, EF Core's native
  `rowversion` shape.
- **Concept introduced, optimistic concurrency as an entity-shape contract.** `[Rubric §8, Data
  Architecture]` (assesses concurrency control on writes) and `[Rubric §9, API & Contract Design]`
  (assesses how a stale-write conflict is surfaced to a client). Optimistic concurrency means the
  database does not lock a row while a user edits it; instead every row carries a version token, the
  client sends back the token it last read, and the `UPDATE` includes it in the `WHERE` clause. If
  someone else changed the row in between, zero rows match, EF Core raises
  `DbUpdateConcurrencyException`, and the API maps that to `409 Conflict`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:189-192`).
  The interesting design point is *why the token needs its own interface at all*: the repository's
  aggregate-typed overload `SetOriginalRowVersion(TEntity, byte[]?)` (`IRepository.cs:197`) can only
  reach the aggregate **root**, because `TEntity` is the root type. A child entity edit (a
  `ProductVariant` under a `Product`) would otherwise need a second generic parameter for the child's
  own identifier type. `IRowVersioned` erases that identifier type: the child overload
  (`IRepository.cs:209`) accepts any `IRowVersioned`, so child-level edits get the same stale-token
  protection as the root. The doc comment states this rationale and cites [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)
  (`IRowVersioned.cs:3-10`).
- **Walkthrough**: one getter, `byte[] RowVersion` (`IRowVersioned.cs:15`), wrapped in a scoped
  `#pragma warning disable CA1819` (lines 14-16) with the justification that `byte[]` is EF Core's
  native rowversion shape and mirrors `AuditableBaseEntity.RowVersion`. The interface is getter-only:
  the domain never assigns the token, the database does.
- **Why it's built this way**: an identifier-type-free contract is the smallest change that lets one
  repository method serve both roots and children; the alternative (a second generic parameter, or a
  non-generic `object` overload) would either leak type parameters through the whole repository surface
  or lose type safety. [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html) records the decision.
- **Where it's used**: implemented by
  [`AuditableBaseEntity<TIdentifierType>`](#auditablebaseentitytidentifiertype)
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:13`), whose
  `RowVersion` property is a private-set `byte[]` defaulting to `[]` (`AuditableBaseEntity.cs:39`), so
  every auditable entity (aggregate roots **and** their children) satisfies it. Consumed by
  [`IRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype)
  (`IRepository.cs:209`) and implemented in
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:87-96`,
  which casts the child to `object`, walks to `_context.Entry(...).Property(nameof(AuditableBaseEntity<>.RowVersion))`
  and assigns `OriginalValue`; the decorator forwards it
  (`.../EFRepositoryDecorator.cs:45-46`).
- **Caveats / not-in-source**: both `SetOriginalRowVersion` overloads are a **no-op** when the supplied
  token is null or empty (`EFRepository.cs:78-79,90-91`), which the doc comment attributes to legacy
  clients and first writes (`IRepository.cs:193,205`); a client that omits the token therefore silently
  loses the conflict check rather than being rejected.

### ITenantEntity
> MMCA.Common.Domain · `MMCA.Common.Domain.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/ITenantEntity.cs:33` · Level 0 · interface

- **What it is**: an opt-in marker plus one property. An entity that carries it belongs to exactly one
  tenant, and every read and write the framework performs on it is scoped to the tenant resolved for
  the current request.
- **Depends on**: nothing first-party; the single member is a `string` getter (`ITenantEntity.cs:39`).
- **Concept introduced, shared-schema multi-tenancy declared in the domain.** `[Rubric §11, Security]`
  (assesses whether one customer's data can be read or written by another) and `[Rubric §8, Data
  Architecture]` (assesses how isolation is expressed in the model rather than remembered by every
  query author). Shared-schema tenancy means all tenants live in the same tables and a discriminator
  column keeps them apart. The risk of that model is a forgotten `WHERE TenantId = ...`, so the
  framework never asks a caller to write one: marking the entity is the whole opt-in, and both sides
  are enforced by infrastructure. `[Rubric §30, Compliance, Privacy & Data Governance]` also applies,
  since tenant boundaries are usually a contractual data-segregation commitment.
- **Walkthrough**: one getter, `string TenantId { get; }` (`ITenantEntity.cs:35-39`). Three remarks
  paragraphs carry the contract.
  - *Reads* (`ITenantEntity.cs:8-14`): a named `Tenant` global query filter is applied to every
    non-owned entity carrying the interface, alongside the existing `SoftDelete` filter; named filters
    compose with AND, so a tenant never sees another tenant's rows and never sees soft-deleted ones.
    When no tenant is resolved (a background service, a seeder, an admin flow) the filter is inert and
    the query sees every tenant's rows: the system context is deliberately unrestricted.
  - *Writes* (`ITenantEntity.cs:15-20`): the interceptor stamps `TenantId` on insert and refuses a save
    that would write across the boundary, which is why the property is read-only on the domain type
    (the value is not a caller's to choose; EF writes it through the backing field).
  - *A `string` capped at 64 characters* (`ITenantEntity.cs:21-25`): the identifier arrives from a
    claim, a header, or configuration, all of which are strings, so a stronger domain type would only
    add a conversion at every boundary without adding a guarantee. The cap is enforced at the model
    (`TenantIdMaxLength = 64` and the `IsRequired().HasMaxLength(...).IsUnicode(false)` configuration in
    `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:366,411-414`).
  - *Marking is host-gated in practice* (`ITenantEntity.cs:26-31`): a host that never resolves a tenant
    behaves exactly as it did before. Adopting tenancy is marking entities, calling
    `AddMultiTenancy(configuration)`, and setting `Tenancy:Enabled`.
- **Why it's built this way**: putting the marker in Domain and the enforcement in Infrastructure keeps
  the model framework-free while making isolation impossible to forget, which is the
  [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html) decision. Splitting read
  enforcement (query filter) from write enforcement (interceptor) is deliberate: the interceptor's doc
  comment notes that a caller who bypasses the filter with EF's parameterless `IgnoreQueryFilters()`
  can read across tenants but still cannot write across them
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/TenantSaveChangesInterceptor.cs:29-34`).
- **Where it's used**: the read side is
  [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext)`.ApplyTenantFilters`
  (`ApplicationDbContext.cs:394-442`), which selects every non-owned `ITenantEntity` type
  (`ApplicationDbContext.cs:405-407`), indexes the discriminator on non-Cosmos engines
  (`ApplicationDbContext.cs:419-422`), and installs the named filter
  `CurrentTenantId == null || EF.Property<string>(e, "TenantId") == CurrentTenantId`
  (`ApplicationDbContext.cs:435-441`; the filter name constant is at `ApplicationDbContext.cs:360`).
  The write side is
  [`TenantSaveChangesInterceptor`](group-07-persistence-ef-core.md#tenantsavechangesinterceptor)
  (`TenantSaveChangesInterceptor.cs:36`), which reads the tenant once per save
  (`:68`), walks `ChangeTracker.Entries<ITenantEntity>()` skipping owned types (`:74-75`), and routes
  each entry by state (`:77-93`); an untenanted insert from an untenanted scope throws
  [`CrossTenantWriteException`](group-07-persistence-ef-core.md#crosstenantwriteexception) rather than
  writing a row nobody can read (`:101-114`). The host gate is `AddMultiTenancy`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:424`) plus
  [`TenancySettings`](group-14-module-system-composition.md#tenancysettings) (`Tenancy:Enabled` at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/TenancySettings.cs:67`, claim-then-header
  resolution order at `TenancySettings.cs:56-57`). The only entities marked in the workspace apps today
  are Helpdesk's `Ticket` and its child `TicketComment`
  (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Domain/Tickets/Ticket.cs:26,32` and
  `.../TicketComment.cs:16,22`), opted in at
  `MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:73`; ADC and Store carry no `ITenantEntity`
  today.
- **Caveats / not-in-source**: `Tenancy:Enabled` gates **resolution**, not isolation. The filter and the
  interceptor are always registered and are inert whenever no tenant is resolved
  (`TenancySettings.cs:37-39`), so an untenanted code path (a job, a seeder) reads every tenant's rows
  by design. That is the documented behavior, not an oversight, but it means "tenant safety" is a
  property of the request pipeline resolving a tenant, not of the entity marker alone.

### PiiAttribute
> MMCA.Common.Domain · `MMCA.Common.Domain.Attributes` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Attributes/PiiAttribute.cs:19` · Level 0 · class (sealed attribute)

- **What it is**: marks a property as **personally identifiable information** belonging to a data
  subject.
- **Depends on**: `System.Attribute` (BCL) only.
- **Concept introduced, privacy governance reconciled with soft-delete.** `[Rubric §30, Compliance,
  Privacy & Data Governance]` (assesses a PII inventory, retention/erasure, and, critically,
  reconciling soft-delete with right-to-erasure) and `[Rubric §13, Observability & Operability]`
  (keeping PII out of logs). This one tiny attribute powers **two** governance mechanisms, per its doc
  comment (`PiiAttribute.cs:5-13`): (1) an **architecture fitness test** asserts that any entity
  declaring a `[Pii]` property also implements [`IAnonymizable`](#ianonymizable), so every data
  subject's data has a real right-to-erasure path (soft-delete preserves rows, so erasure needs a
  separate anonymize path, the exact §30 red flag this avoids; [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)); and (2) [`PiiRedactor`](#piiredactor),
  the **redaction half** of the contract (`PiiAttribute.cs:10-12`), masks `[Pii]`-marked members with
  the literal `[REDACTED]` so an entity carrying personal data can be written to a structured log or
  telemetry attribute without the data subject's PII leaking in clear text. Mechanism (1) is
  `[Rubric §34, Architecture Governance & Documentation]`, a rule enforced by an executable fitness
  function rather than prose; mechanism (2) is a real, unit-tested helper. Note what is and is not
  automatic: no logging or destructuring policy routes entities through `PiiRedactor.Redact` in
  production (only tests call it), so the §13 "PII out of logs" control is *available and tested* but
  *opt-in per call site*. The marker does have a production reader beyond the fitness test, though: the
  audit-trail interceptor consults it on every captured change (see **Where it's used**).
- **Walkthrough**: `[AttributeUsage(AttributeTargets.Property, Inherited = false, AllowMultiple =
  false)]` (line 18); empty body (`sealed class PiiAttribute : Attribute;`, line 19). The doc comment
  (lines 14-16) adds important *judgement*: apply only to genuine data-subject PII (an account holder's
  email/name), **not** to public content that merely contains a name (for example a public conference
  speaker profile, whose erasure obligation flows through the linked user account), a nuance that
  prevents over-tagging.
- **Why it's built this way**: marking PII declaratively at the property lets the erasure fitness
  test, [`PiiRedactor`](#piiredactor) and the audit trail all find it automatically by reflection; the
  alternative (a hand-maintained list of which fields are personal) drifts out of sync with the model.
- **Where it's used**: applied to four properties of the ADC Identity
  [`User`](group-24-identity-module.md#user) aggregate: `Email`, `FirstName`, `LastName` and
  `AvatarUrl` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:37,41,45,110`);
  `User` reaches [`IAnonymizable`](#ianonymizable) through
  [`IErasableUser`](group-08-auth.md#ierasableuser), which extends it
  (`User.cs:33-34` and
  `MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IErasableUser.cs:30`). The erasure detection lives
  **once** in the shared `MMCA.Common.Testing.Architecture` package: the
  `EntitiesWithPiiImplementAnonymizable` rule
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Governance.cs:11`)
  scans every Domain-layer type for a `[Pii]` property via the `HasPiiProperty` helper (same file,
  lines 48-50), which matches by attribute type *name* (`a.GetType().Name == "PiiAttribute"`), not a
  typed `GetCustomAttribute<PiiAttribute>()`, because the rule library does not reference the Domain
  attribute type. The `IAnonymizable` side, by contrast, is matched on the **full** name
  `MMCA.Common.Domain.Interfaces.IAnonymizable` (`ArchitectureRules.Governance.cs:7,16`) so a
  same-named local interface cannot satisfy the rule. Each repo then supplies a thin sealed subclass of
  `PiiConventionTestsBase`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/PiiConventionTestsBase.cs:7`)
  that just passes its `IArchitectureMap`:
  `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiConventionTests.cs:13` (the *scan*
  is structurally vacuous today, the framework Domain ships no data-subject type),
  `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/PiiConventionTests.cs:3`, and
  `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/PiiConventionTests.cs:3`. The framework
  closes that vacuity gap with a non-vacuous companion, `PiiErasureContractFitnessTests`
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiErasureContractFitnessTests.cs:19`),
  which forces a representative `[Pii]`-carrying sample through both halves end to end (recognized and
  masked by [`PiiRedactor`](#piiredactor), then erased idempotently via [`IAnonymizable`](#ianonymizable)).
  Two reflective readers exist in shipped code: `PiiRedactor` itself
  (`IsDefined(typeof(PiiAttribute), inherit: false)`,
  `MMCA.Common/Source/Core/MMCA.Common.Domain/Privacy/PiiRedactor.cs:119`) and
  [`AuditTrailSaveChangesInterceptor`](group-07-persistence-ef-core.md#audittrailsavechangesinterceptor),
  which short-circuits per type with `PiiRedactor.HasPii`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:286`),
  caches the per-property verdict (`:502`), and writes `PiiRedactor.RedactedToken` into **both** the old
  and new value columns of a change row (`:309-310`).

### RedactableProperty
> MMCA.Common.Domain · `MMCA.Common.Domain.Privacy` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Privacy/PiiRedactor.cs:123` · Level 0 · class (private sealed, nested)

- **What it is**: [`PiiRedactor`](#piiredactor)'s private sealed nested cached-metadata helper, one
  entry per public readable property, capturing the name, whether the property is PII, and how to read
  its value. It exists only to back `PiiRedactor.Cache` (`PiiRedactor.cs:31`); it is not visible outside
  the redactor.
- **Depends on**: `System.Reflection.PropertyInfo` (BCL); constructed by [`PiiRedactor`](#piiredactor).
- **Walkthrough**: a primary-constructor class
  `RedactableProperty(string name, bool isPii, PropertyInfo info)` (`PiiRedactor.cs:123`) exposing
  `Name` (`PiiRedactor.cs:125`), the precomputed `IsPii` flag (`PiiRedactor.cs:127`), and
  `Read(object target)` (`PiiRedactor.cs:129`), which calls `info.GetValue(target)` and catches
  `TargetInvocationException` to return `UnreadableToken` rather than propagate, the inline comment
  noting that a throwing getter must never break a logging call site (`PiiRedactor.cs:131-139`).
- **Why it's built this way**: precomputing the `IsPii` flag and holding the `PropertyInfo` once per
  type (cached in `PiiRedactor.Cache`) means redaction never re-evaluates the `[Pii]` reflection check
  on the hot path, it just reads the cached flag and (for non-PII members) invokes the captured getter.
- **Where it's used**: produced and consumed entirely within [`PiiRedactor`](#piiredactor)
  (`GetProperties`, `PiiRedactor.cs:112-121`); it has no independent consumers.

### IAggregateRoot
> MMCA.Common.Domain · `MMCA.Common.Domain.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAggregateRoot.cs:9` · Level 1 · interface

- **What it is**: the contract that marks a type as a DDD aggregate root and gives it the ability
  to accumulate domain events for post-persistence dispatch.
- **Depends on**: [`IDomainEvent`](group-04-events-outbox.md#idomainevent) (Level 0).
- **Concept introduced, the Aggregate Root.** `[Rubric §4, DDD]` (aggregates as the sole
  external-change entry point; transactional consistency boundary). An **aggregate root** owns a
  cluster of related objects (the aggregate) and is the *only* entity in that cluster that
  the rest of the system interacts with directly. DDD's rule is: "save or delete as a unit, never
  reference internal entities from outside". By implementing `IAggregateRoot`, a class declares
  itself as that transactional boundary. The doc comment (`IAggregateRoot.cs:3-8`) states the
  contract explicitly: aggregates are the only entities that can raise domain events and they define
  the transactional consistency boundary; the infrastructure layer (`ApplicationDbContext`) uses this
  interface to discover pending events across all tracked aggregates during `SaveChangesAsync`, the
  hook that feeds the [outbox pattern](group-04-events-outbox.md#outboxmessage) ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)).
- **Walkthrough**: four members (`IAggregateRoot.cs:12-32`):
  `IReadOnlyCollection<IDomainEvent> DomainEvents { get; }`, the pending event queue (read-only
  from outside, line 12); `void AddDomainEvent(IDomainEvent)`, called by the aggregate's own methods to
  record that something happened (line 16); `void ClearDomainEvents()`, the wholesale reset (line 19);
  and `void RemoveDomainEvents(IEnumerable<IDomainEvent>)` (line 32), which removes **only** the events
  a caller captured. That last member exists to fix a real delivery hole, spelled out in its remarks
  (`IAggregateRoot.cs:25-31`): the persistence pipeline captures an aggregate's events before saving
  and clears them afterwards, so clearing wholesale would discard anything a handler raised on the same
  aggregate during in-process dispatch (those events arrive after the capture and would be wiped before
  any later capture could see them, so they would never dispatch and never reach the outbox).
  `[Rubric §8, Data Architecture]` (SaveChanges flow): the sequence is aggregate mutates state → calls
  `AddDomainEvent` → EF saves data + serializes events to the outbox in the same DB transaction →
  the captured events are removed → dispatcher dispatches in-process copies (for immediate reactions
  that do not need the outbox).
- **Why it's built this way**: keeping the event queue behind a read-only collection plus
  explicit add/remove/clear methods means only the aggregate's own behavior can raise events and only
  infrastructure can retire them after a successful save, preserving the at-least-once outbox
  contract ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)).
- **Where it's used**: implemented by
  [`AuditableAggregateRootEntity<TIdentifierType>`](#auditableaggregaterootentitytidentifiertype)
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableAggregateRootEntity.cs:13`), which
  backs it with a private `List<IDomainEvent>` (line 16), exposes it as `DomainEvents` (line 18), and
  implements `AddDomainEvent` (line 24), `ClearDomainEvents` (line 34) and `RemoveDomainEvents`
  (lines 37-49, matching by **reference** equality so two structurally equal events raised separately
  stay two distinct occurrences, lines 41-43); every aggregate in both apps inherits from that.
  Discovered by the
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
  during persistence, which retires exactly what it captured
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:337-341`,
  also on the dispatch-failure path, `:325-328`).

### PiiRedactor
> MMCA.Common.Domain · `MMCA.Common.Domain.Privacy` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Privacy/PiiRedactor.cs:24` · Level 1 · class (static)

- **What it is**: a static helper that produces a log- and telemetry-safe view of any object by
  masking every property marked with [`PiiAttribute`](#piiattribute), replacing each PII value with the
  literal `[REDACTED]`. It is the **redaction half** of the [`PiiAttribute`](#piiattribute) contract.
- **Depends on**: [`PiiAttribute`](#piiattribute) (the marker it reads, `PiiRedactor.cs:6,119`); BCL
  only (`System.Reflection`, `System.Collections.Concurrent`, `System.Collections.ObjectModel`,
  `System.Text`, `System.Globalization`).
- **Concept introduced, value-erasing PII redaction for logs/telemetry.** `[Rubric §13, Observability
  & Operability]` (assesses keeping personal data out of structured logs) and `[Rubric §30,
  Compliance, Privacy & Data Governance]` (assesses a real data-minimization control, not just an
  intent). This is the implementation that [`PiiAttribute`](#piiattribute)'s second mechanism refers to.
  The framework's logging convention is to record scalar identifiers, not whole entities; but when an
  aggregate that carries a data subject's personal data *must* be written to a structured log or a
  telemetry attribute, route it through `Redact`/`RedactToString` so the PII never leaves the process
  in clear text (the rationale is stated in the doc comment, `PiiRedactor.cs:10-17`). Masking is
  deliberately **value-erasing** rather than truncating or hashing (`PiiRedactor.cs:18-23`): even a
  value's length or hash can leak information about a data subject, so a `[Pii]` value is replaced
  wholesale with `RedactedToken`. This is the log-side counterpart to [`IAnonymizable`](#ianonymizable)'s
  storage-side erasure: together they are the two halves of the §30/[ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) story (`[Pii]` says *what*
  is personal; `PiiRedactor` keeps it out of *logs*; `IAnonymizable` erases it from *storage*).
- **Walkthrough**
  - `RedactedToken` (`PiiRedactor.cs:27`): the public `const string = "[REDACTED]"` substituted for
    every masked value, so callers and tests can assert against one constant. A private
    `UnreadableToken = "[unreadable]"` (`PiiRedactor.cs:29`) is the fallback for a throwing getter.
  - `Cache` (`PiiRedactor.cs:31`): a `ConcurrentDictionary<Type, IReadOnlyList<RedactableProperty>>`
    holding the reflected, per-type property metadata so a hot logging path does not re-run reflection
    on every call (this is what makes repeated redaction allocation-light).
  - `Redact(object?)` (`PiiRedactor.cs:42`): the primary entry point. `null` yields the shared empty
    map (`PiiRedactor.cs:33-34,44-47`); otherwise it walks the cached properties and builds an
    ordinal-comparer `property-name → value` dictionary where each PII property is replaced by
    `RedactedToken` and every other property passes through via `property.Read(value)`
    (`PiiRedactor.cs:49-56`).
  - `RedactToString(object?)` (`PiiRedactor.cs:65`): renders a single-line
    `TypeName { Prop = value, Pii = [REDACTED] }` string for a log-message argument; `null` yields the
    literal `"null"` (line 69), and non-PII scalars are formatted with `CultureInfo.InvariantCulture`
    (`PiiRedactor.cs:84-86`), keeping the rendering locale-stable (the same culture-invariance discipline
    as [`DomainHelper`](#domainhelper)).
  - `HasPii(Type)` (`PiiRedactor.cs:98`): throws on a null `type`, then returns whether the type
    declares any `[Pii]` property, i.e. whether redaction would mask anything (`PiiRedactor.cs:98-110`).
  - `GetProperties(Type)` (`PiiRedactor.cs:112`): the cache filler. `Cache.GetOrAdd` runs a `static`
    lambda that reflects public, instance, readable, non-indexer properties and builds a
    [`RedactableProperty`](#redactableproperty) for each, recording whether it carries the marker via
    `p.IsDefined(typeof(PiiAttribute), inherit: false)` (`PiiRedactor.cs:112-121`). The `inherit: false`
    mirrors [`PiiAttribute`](#piiattribute)'s `Inherited = false`.
- **Why it's built this way**: a `static` pure helper has no DI dependency, so it can be called from
  any layer, including a transport boundary, without wiring. Per-type caching keeps the logging path
  cheap; value-erasure (over truncation/hashing) is the conservative §30 choice; and routing personal
  data through one named gate makes the redaction policy auditable in one place ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)).
- **Where it's used**: two of its members have a production consumer.
  [`AuditTrailSaveChangesInterceptor`](group-07-persistence-ef-core.md#audittrailsavechangesinterceptor)
  calls `HasPii` once per changed entity type
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:286`)
  and writes `RedactedToken` into both the `OldValue` and `NewValue` columns of a `[Pii]` property's
  change row (`:309-310`), which is how the change history avoids becoming a second copy of personal
  data ([ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html)). It is unit-verified by
  `PiiRedactorTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Domain.Tests/Privacy/PiiRedactorTests.cs`, G25) and exercised
  end to end (composed with [`IAnonymizable`](#ianonymizable)) by `PiiErasureContractFitnessTests`
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiErasureContractFitnessTests.cs:19`).
- **Caveats / not-in-source**: `Redact` and `RedactToString` have **no production call site**; only
  tests invoke them (`PiiRedactorTests.cs:35,46,53,58,68` and `PiiErasureContractFitnessTests.cs:29,42,46,69`),
  so the log-side control is ready and tested but opt-in per call site rather than an automatic
  pipeline stage. Redaction is also **shallow** (one level), as the remarks state
  (`PiiRedactor.cs:19`): a non-PII property whose value is itself an object with nested `[Pii]` members
  is read and emitted as-is, not recursively masked. Only public instance properties are inspected
  (`PiiRedactor.cs:115`), so fields and non-public members are ignored. A property getter that throws
  `TargetInvocationException` yields `[unreadable]` instead of crashing the log call
  (`PiiRedactor.cs:135-139`).

### IAnonymizable
> MMCA.Common.Domain · `MMCA.Common.Domain.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAnonymizable.cs:22` · Level 3 · interface

- **What it is**: a single-method contract (`Result Anonymize()`) for aggregates that store
  personal data and must support GDPR/CCPA right-to-erasure.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result) (via
  `MMCA.Common.Shared.Abstractions`, `IAnonymizable.cs:1`).
- **Concept reinforced, reconciling soft-delete with erasure.** `[Rubric §30, Compliance,
  Privacy & Data Governance]` (assesses a real erasure path, not just soft-delete). The doc comment
  (lines 5-21) explains the tension: soft-delete ([`IAuditableEntity.IsDeleted`](#iauditableentity))
  hides a row from queries but retains its personal data, so it does not by itself satisfy an erasure
  request (`IAnonymizable.cs:11-12`). `IAnonymizable` provides the erasure path: an application-layer
  erasure handler loads the aggregate, calls `Anonymize()`, and saves, overwriting PII fields with
  non-identifying placeholders **in place** rather than hard-deleting (lines 12-15), so foreign keys
  and the audit trail survive. The row stays; the person's data is gone. This is the second half of the
  [`PiiAttribute`](#piiattribute) story ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)): `[Pii]` marks *what* is PII; `IAnonymizable` defines
  *how* it is erased. `[Rubric §34, Architecture Governance & Documentation]`: an architecture rule
  asserts that any Domain type with a `[Pii]` property implements `IAnonymizable`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Governance.cs:11-21`),
  enforcing the contract executably rather than by review.
- **Walkthrough**: `Anonymize()` (line 30): a `Result` return type (not `void`) because anonymization
  can fail, and the doc comment describes the failure case as "a failure describing why anonymization
  could not be applied" (line 29). The summary mandates **idempotency** (lines 25-27): calling
  `Anonymize()` on an already-anonymized entity must be a no-op returning success, important under
  at-least-once erasure-event delivery. The remarks (lines 16-20) add the storage guidance: fields that
  must remain retrievable after erasure are persisted through the AES-256-GCM
  [`EncryptedStringConverter`](group-07-persistence-ef-core.md#encryptedstringconverter);
  fields that need not survive are overwritten with placeholders inside `Anonymize()`.
- **Why it's built this way**: making erasure a one-method contract keeps the *policy* (which fields,
  what placeholders) inside the aggregate that owns the data, while the *trigger* lives in an
  application handler, and the `[Pii]` implies `IAnonymizable` fitness rule guarantees no PII-holding
  entity silently lacks an erasure path ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)).
- **Where it's used**: satisfied by the ADC Identity [`User`](group-24-identity-module.md#user)
  aggregate, which holds the four `[Pii]` fields `Email`/`FirstName`/`LastName`/`AvatarUrl`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:37,41,45,110`) and declares
  [`IErasableUser`](group-08-auth.md#ierasableuser) (`User.cs:33-34`), which extends `IAnonymizable`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IErasableUser.cs:30`); the placement of that
  interface on `User` itself is load-bearing, because `User.Delete` hides the base soft-delete with
  `new` (`User.cs:21-24`). Called by the application-layer erasure handler, enforced by
  `PiiConventionTests` (G25), and exercised together with [`PiiRedactor`](#piiredactor) by
  `PiiErasureContractFitnessTests`
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiErasureContractFitnessTests.cs:19`).

### ValueObject
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/ValueObject.cs:8` · Level 0 · record

- **What it is**: the abstract base for the value-object family, declared as a single line:
  `public abstract record ValueObject;` (`ValueObject.cs:8`).
- **Depends on**: nothing first-party. Not even a namespace import: the file is a namespace
  declaration, a doc comment, and the type.
- **Concept introduced, the Value Object.** `[Rubric §4, Domain-Driven Design]` (assesses whether the
  model mirrors the business: aggregates, value objects, ubiquitous language, immutability). A
  **value object** models a concept with **no identity**: two `Money(10, USD)` instances are equal
  because their *values* are equal, not because they are the same row. By inheriting from `record`,
  every value object gets compiler-generated **structural equality** (`Equals` / `GetHashCode` over
  all declared properties) plus non-destructive `with` mutation for free; the doc comment
  (`ValueObject.cs:3-7`) states exactly that rationale. This is the cheapest possible base: it adds a
  *type* (so code and fitness tests can say "this is a value object") without adding a single member.
- **Walkthrough**: there are no members. The whole contract is "be a record, be abstract, be named
  `ValueObject`". All the work happens in the derived types below.
- **Why it's built this way**: using C#'s `record` for value-object semantics avoids hand-writing
  equality, a classic DDD chore and bug source. The base type exists so the *family* is nameable and
  enforceable, not for shared behaviour. `[Rubric §34, Architecture Governance]` (assesses whether
  rules are executable rather than aspirational): the family is policed by the fitness rule
  `ArchitectureRules.ValueObjectsAreImmutableSealedInShared`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Immutability.cs:56`),
  driven from `ImmutabilityTestsBase.ValueObjects_ShouldBe_ImmutableSealedAndInShared`
  (`.../Bases/ImmutabilityTestsBase.cs:25`), which every repo subclasses. That rule is why every
  derivative below is a `sealed record` living in the Shared layer.
- **Where it's used**: base of [`Address`](#address), [`Currency`](#currency),
  [`DateRange`](#daterange), [`DateTimeRange`](#datetimerange), [`Email`](#email),
  [`Money`](#money), [`PhoneNumber`](#phonenumber). Each adds a static factory returning
  [`Result<T>`](group-01-result-error-handling.md#result) so an invalid value object cannot be
  constructed. Note the deliberate non-member: [`Enumeration<TEnumeration>`](#enumerationtenumeration)
  does **not** derive from `ValueObject` (`Enumeration.cs:24-29` explains why), because the
  sealed-record rule above would forbid the static-member idiom that type exists for.
- **Caveats / not-in-source**: equality is purely structural; if a future value object held a mutable
  collection, record equality would compare references, not contents. None of the current ones do.

### Address
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Address.cs:16` · Level 3 · record (sealed)

- **What it is**: an immutable value object for a postal address. `AddressLine1` is required; the
  remaining five fields (`AddressLine2`, `City`, `State`, `ZipCode`, `Country`) are nullable to
  accommodate international formats (`Address.cs:18-40`).
- **Depends on**: [`AddressInvariants`](#addressinvariants) (mutual, see the cycle note),
  [`Result`](group-01-result-error-handling.md#result), [`ValueObject`](#valueobject), plus
  `System.Runtime.Serialization` and `System.Text.Json.Serialization` from the BCL.
- **Concept introduced, the value-object factory method returning `Result<T>`.** `[Rubric §4,
  Domain-Driven Design]` (value objects with enforced invariants) and `[Rubric §15, Best Practices &
  Code Quality]` (unconstructable invalid state). The pattern: the constructor is `private`
  (`Address.cs:43`), so nothing outside the type can call `new Address(...)`. The only public entry
  point is `static Result<Address> Create(...)` (`Address.cs:69-89`). Pass the invariants and you get
  `Result.Success(new Address(...))`; fail and you get `Result.Failure<Address>(result.Errors)`. An
  *invalid `Address` is therefore unconstructable*. The `[JsonConstructor]` on the private constructor
  (`Address.cs:42`) is the one sanctioned exception: `System.Text.Json` may round-trip an object whose
  fields were already validated on the way in. `[DataContract]` (`Address.cs:15`) plus
  `[DataMember(Order = 1..6)]` on each property (`Address.cs:19,23,27,31,35,39`) pin the wire shape and
  field order for the XML formatter, so the contract stays stable across releases. `[Rubric §9, API &
  Contract Design]`.
- **Documented cycle, `Address` and `AddressInvariants`.** Both types sit at Level 3 in the same
  strongly connected component. `Address.Create` calls `AddressInvariants.EnsureAddressLine1IsValid`
  (`Address.cs:78`), while `AddressInvariants.EnsureAddressIsValid` takes an `Address?` parameter
  (`AddressInvariants.cs:35`). This is deliberate: the invariant helper is the canonical home for the
  constraints (max-length constants, error codes), the value object owns construction. Because each
  references the other, the levelling algorithm assigns them the same level rather than an impossible
  ordering. `[Rubric §2, Design Patterns]` (mutual delegation is acceptable here; neither type owns
  the other's core identity).
- **Walkthrough**
  - `Create(...)` (`Address.cs:69`): wraps the single check in `Result.Combine(...)`
    (`Address.cs:77-78`) so more invariants can be added without restructuring the method, then
    returns `Result.Failure<Address>(result.Errors)` on failure (`Address.cs:80`). Only
    `AddressLine1` is enforced at the value-object level; the optional fields are length-checked by
    the FluentValidation rules in the Application layer.
  - `ToString()` (`Address.cs:93-104`): joins the non-empty parts with `", "` via
    `string.Join` + `Where(part => !string.IsNullOrEmpty(part))`, producing a single human-readable
    line.
- **Why it's built this way**: EF Core stores `Address` as an **owned type** via `OwnsOne`, stated in
  the remarks (`Address.cs:12-14`) and done for real in
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/EntityConfiguration/CustomerConfiguration.cs:43`,
  which flattens the six properties into `AddressLine1`, `AddressLine2`, `AddressCity`,
  `AddressState`, `AddressZipCode`, `AddressCountry` columns on the `Customer` table rather than a
  child table. Owned types have value semantics at the persistence level, which is exactly the
  domain semantic.
- **Where it's used**: the Store Identity `Customer` aggregate owns one (configuration cited above,
  with every `HasMaxLength` reading an `AddressInvariants` constant, `CustomerConfiguration.cs:47-73`);
  [`RegisterRequest`](group-08-auth.md#registerrequest) carries an optional `Address? Address = null`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RegisterRequest.cs:18`); the
  [`AddressLine1Rules<T>`](group-06-validation.md#addressline1rulest) family and
  [`AddressValidator`](group-06-validation.md#addressvalidator) validate the request-side shape.

### AddressInvariants
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/AddressInvariants.cs:9` · Level 3 · class (static)

- **What it is**: a static helper holding the address field **max-length constants** (shared by EF
  configurations and FluentValidation validators) plus two invariant checks that return
  [`Result`](group-01-result-error-handling.md#result).
- **Depends on**: [`Address`](#address) (mutual cycle, same SCC),
  [`Error`](group-01-result-error-handling.md#error),
  [`Result`](group-01-result-error-handling.md#result).
- **Concept introduced, the shared-constants invariant class.** `[Rubric §16, Maintainability &
  Evolvability]` (assesses whether a constraint has exactly one place to change). Six
  `public static readonly int` constants are declared (`AddressInvariants.cs:12-27`):
  `AddressLine1MaxLength = 200`, `AddressLine2MaxLength = 200`, `CityMaxLength = 100`,
  `StateMaxLength = 100`, `ZipCodeMaxLength = 20`, `CountryMaxLength = 100`. EF entity
  configurations, FluentValidation rules, and these invariants all read the same fields, so changing
  a limit in one place propagates to schema and validation together. This is the shape repeated for
  every validated value type in this group: the invariant class is the single source of truth for
  both the constraint value and the error identity.
- **Walkthrough**
  - `EnsureAddressIsValid(Address? address, string source)` (`AddressInvariants.cs:35`): returns
    `Result.Success()` for a `null` address (an address is optional on many entities,
    `AddressInvariants.cs:37-38`), otherwise delegates to the line-1 check through `Result.Combine`.
  - `EnsureAddressLine1IsValid(string addressLine1, string source)` (`AddressInvariants.cs:50`): an
    expression-bodied conditional over `string.IsNullOrWhiteSpace`; on failure it returns
    `Error.Invariant(code: "Address.Line1.Empty", ...)` (`AddressInvariants.cs:52-56`) carrying the
    caller's method name as `source` and `nameof(addressLine1)` as `target`, which is how failures
    stay traceable without a stack trace.
- **Why it's built this way**: keeping the constants out of the value object lets an EF configuration
  reference `AddressInvariants.AddressLine1MaxLength` without depending on `Address` itself, keeping
  the Infrastructure-to-Shared coupling thin. `[Rubric §3, Clean Architecture]`.
- **Where it's used**: called from `Address.Create` (`Address.cs:78`); every max-length constant is
  read by `CustomerConfiguration` in Store Identity
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/EntityConfiguration/CustomerConfiguration.cs:47-73`)
  and by the [`AddressLine1Rules<T>`](group-06-validation.md#addressline1rulest) family in the
  Application layer.

### Currency
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Currency.cs:14` · Level 3 · record (sealed)

- **What it is**: an ISO 4217 currency value object built as a **closed set**: `Currency.Usd` and
  `Currency.Eur` are the only public instances (`Currency.cs:26,29`), the constructor is private
  (`Currency.cs:31`), and `None` is an `internal` sentinel used by [`Money`](#money)
  (`Currency.cs:23`).
- **Depends on**: [`CurrencyJsonConverter`](#currencyjsonconverter) (mutual cycle),
  [`Error`](group-01-result-error-handling.md#error),
  [`Result`](group-01-result-error-handling.md#result), [`ValueObject`](#valueobject).
- **Documented cycle, `Currency` and `CurrencyJsonConverter`.** Both live in the same file
  (`Currency.cs:14` and `Currency.cs:73`). `Currency` carries
  `[JsonConverter(typeof(CurrencyJsonConverter))]` (`Currency.cs:13`) while the converter's `Read`
  calls `Currency.FromCode` (`Currency.cs:83`). The mutual reference puts both at Level 3.
- **Concept introduced, the closed-set (type-safe enum) value object.** `[Rubric §4, DDD]`
  (eliminates primitive obsession: no raw `"USD"` strings travelling through the domain). Instead of
  a `string`, all code holds `Currency.Usd`, a statically typed singleton. Validation happens once, at
  the boundary, in `FromCode`; inside the domain you are guaranteed to hold a known currency. Adding
  a currency means adding a field and listing it in `All` (`Currency.cs:54-58`), which is the single
  extension point.
- **Walkthrough**
  - `EmptyCurrency` / `InvalidCurrency` (`Currency.cs:17,20`): pre-built `Error.Validation` singletons
    for the two failure paths, so `FromCode` allocates nothing on a bad call.
  - `None` (`Currency.cs:23`): `internal static readonly Currency None = new(string.Empty)`, the
    empty-code sentinel; the doc comment (`Currency.cs:10-11`) is explicit that it is never exposed to
    API consumers.
  - `Code` (`Currency.cs:34`): `string` with an `init` accessor, the ISO three-letter code.
  - `FromCode(string code)` (`Currency.cs:41`): empty-guard first (`Currency.cs:43-44`), then a
    case-insensitive `FirstOrDefault` scan over `All` (`Currency.cs:46`), returning the *singleton*
    on success, so `Currency.Usd` is reference-identical everywhere.
  - `All` (`Currency.cs:54`): `IReadOnlyCollection<Currency>` collection expression containing `Usd`
    and `Eur`.
- **Why it's built this way**: pre-constructed singletons remove per-call allocation and make
  comparison trivial; the closed set makes an unknown code representable only *outside* the domain.
  `[Rubric §12, Performance & Scalability]` for the allocation-free path.
- **Where it's used**: [`Money`](#money) holds a `Currency` (`Money.cs:35`);
  [`CurrencyJsonConverter`](#currencyjsonconverter) serializes it; the API layer registers its own
  [`CurrencyJsonConverter`](group-12-api-hosting-mapping.md#currencyjsonconverter) into MVC's
  `JsonSerializerOptions` in `AddAPI`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:53`).
- **Caveats / not-in-source**: `All` has exactly two entries today. A deployment needing a third
  currency changes framework source, not configuration.

### CurrencyJsonConverter
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Currency.cs:73` · Level 3 · class (sealed)

- **What it is**: a `JsonConverter<Currency>` that writes [`Currency`](#currency) as its ISO code
  string and reads it back through `Currency.FromCode`.
- **Depends on**: [`Currency`](#currency) (mutual cycle, see above) and `System.Text.Json`.
- **Concept introduced, the strict boundary converter.** `[Rubric §9, API & Contract Design]`
  (assesses consistent, stable serialization) and `[Rubric §11, Security]` (assesses input rejected at
  the edge rather than coerced). The class doc (`Currency.cs:61-72`) states the design goal in one
  sentence: a non-string token and an unknown code both throw, "matching the API-layer converter so
  non-MVC paths (cache, outbox, integration events, typed HttpClient calls) fail the same way MVC
  model binding does". That matters because a `Currency` crosses far more than the controller
  boundary: it is also serialized into outbox rows and cache entries.
- **Walkthrough**
  - `Read` (`Currency.cs:76`): rejects any token that is not a JSON string with
    `throw new JsonException("Currency must be a string.")` (`Currency.cs:78-79`), so `{"currency": 5}`
    fails loudly instead of coercing; then `Currency.FromCode(code)` (`Currency.cs:83`) and a second
    `JsonException` naming the offending code on failure (`Currency.cs:84-85`). Throwing (rather than
    returning a `Result`) is correct here: malformed JSON is a deserialization error, not a domain
    outcome.
  - `Write` (`Currency.cs:91-92`): `writer.WriteStringValue(value.Code)`. The wire shape is just the
    three-letter string.
  - Null handling: `HandleNull` is left at its default `false` (documented at `Currency.cs:68-71`), so
    System.Text.Json short-circuits a JSON `null` before this converter runs and a `Currency?` or
    `Money?` member still deserializes to `null` rather than throwing.
- **Where it's used**: applied automatically through the `[JsonConverter]` attribute on `Currency`
  (`Currency.cs:13`); the separate API-layer
  [`CurrencyJsonConverter`](group-12-api-hosting-mapping.md#currencyjsonconverter) is registered
  globally in `AddAPI`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:53`).
- **Caveats / not-in-source**: there is no version sentinel. If the closed code set ever shrinks,
  deserializing a previously stored code (a stale cache entry, an old outbox row) throws
  `JsonException`.

### DateRange
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/DateRange.cs:9` · Level 3 · record (sealed)

- **What it is**: an immutable value object for a date-only range (`DateOnly Start`, `DateOnly End`,
  `DateRange.cs:12,15`), inclusive on both ends, with the single invariant that `End` is not before
  `Start`.
- **Depends on**: [`Error`](group-01-result-error-handling.md#error),
  [`Result`](group-01-result-error-handling.md#result), [`ValueObject`](#valueobject), and BCL
  `DateOnly`.
- **Concept reinforced, the lightweight single-invariant factory.** `[Rubric §4, DDD]` (a temporal
  range is a domain concept, not a loose pair of dates). Compare with [`Address`](#address):
  `Address.Create` delegates to a separate invariant class because six constants and multiple error
  codes justify one; `DateRange.Create` (`DateRange.cs:30-35`) expresses its one rule inline as a
  conditional expression. Calibrating the ceremony to the number of rules is the convention here.
- **Walkthrough**
  - `Create(DateOnly start, DateOnly end)` (`DateRange.cs:30`): returns
    `Error.Validation("DateRange.Invalid", ...)` when `end < start`, otherwise
    `Result.Success(new DateRange(start, end))` through the private constructor (`DateRange.cs:17`).
    It uses `Error.Validation`, not `Error.Invariant`, because the inputs are raw caller-supplied
    dates: a validation problem, not corrupted internal state.
  - `LengthInDays` (`DateRange.cs:38`): `End.DayNumber - Start.DayNumber`, avoiding `TimeSpan`
    arithmetic on `DateOnly`.
  - `Overlaps(DateRange other)` (`DateRange.cs:46`): `ArgumentNullException.ThrowIfNull(other)` then
    the standard half-open formula `Start < other.End && End > other.Start` (`DateRange.cs:48-49`).
  - `Contains(DateOnly instant)` (`DateRange.cs:55`): inclusive on both ends,
    `instant >= Start && instant <= End`.
  - `Deconstruct` (`DateRange.cs:61`): enables `var (start, end) = dateRange`.
- **Why it's built this way**: `DateOnly` rather than `DateTime` signals that the concept carries no
  time-of-day and no time zone; wrapping the pair in a type makes swapping `start` and `end` at a call
  site impossible.
- **Where it's used**: no production entity in ADC or Store holds a `DateRange` today; it is a shipped
  framework primitive covered by `MMCA.Common.Shared.Tests/ValueObjects/DateRangeTests.cs`. The ADC
  Conference `Event` enforces the same rule over two loose `DateOnly` parameters instead, via
  `EventInvariants.EnsureDateRangeIsValid`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/EventInvariants.cs:113`,
  called from `Event.cs:173` and `Event.cs:234`), with the request-side counterpart
  `EventDateRangeRules<T>`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:91`).
  That is the honest state of the code: the primitive exists, the app has not adopted it.

### DateTimeRange
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/DateTimeRange.cs:10` · Level 3 · record (sealed)

- **What it is**: the `DateTime`-precision sibling of [`DateRange`](#daterange), carrying
  `DateTime Start` and `DateTime End` (`DateTimeRange.cs:13,16`).
- **Depends on**: [`Error`](group-01-result-error-handling.md#error),
  [`Result`](group-01-result-error-handling.md#result), [`ValueObject`](#valueobject).
- **Concept**: identical to [`DateRange`](#daterange); this section cross-references rather than
  repeating. The only behavioural difference is the derived member: `Duration` (`DateTimeRange.cs:39`)
  returns `End - Start` as a `TimeSpan`, where `DateRange` returns an integer day count.
- **Walkthrough**: `Create(DateTime start, DateTime end)` (`DateTimeRange.cs:31`) uses the same
  conditional-expression pattern with `Error.Validation("DateTimeRange.Invalid", ...)`;
  `Overlaps` (`DateTimeRange.cs:46`), `Contains` (`DateTimeRange.cs:55`) and `Deconstruct`
  (`DateTimeRange.cs:61`) mirror `DateRange` line for line.
- **Where it's used**: as with `DateRange`, no ADC or Store entity holds one today; coverage is
  `MMCA.Common.Shared.Tests/ValueObjects/DateTimeRangeTests.cs`.
- **Caveats / not-in-source**: `Start` and `End` are plain `DateTime`, so the type carries no time
  zone or `DateTimeKind` guarantee. Nothing in the source normalizes them to UTC; a caller mixing
  kinds would get arithmetic that compiles and lies.

### EmailInvariants
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/EmailInvariants.cs:11` · Level 3 · class (static, partial)

- **What it is**: the invariant checks for email addresses (not empty, at most 256 characters, and a
  practical format check) plus the shared `MaxLength` constant.
- **Depends on**: [`Error`](group-01-result-error-handling.md#error),
  [`Result`](group-01-result-error-handling.md#result), and
  `System.Text.RegularExpressions`.
- **Concept introduced, `[GeneratedRegex]` for compile-time regex.** `[Rubric §12, Performance &
  Scalability]` (assesses avoided allocations and avoided per-call work). The class is
  `static partial` (`EmailInvariants.cs:11`) so the source generator can implement the partial
  property `EmailRegex` declared at `EmailInvariants.cs:55-56`. The attribute
  `[GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", RegexOptions.None, matchTimeoutMilliseconds: 1000)]`
  bakes a compiled matcher at build time (no `new Regex(...)` at runtime) and the 1000 ms match
  timeout caps any catastrophic-backtracking exposure, which is the `[Rubric §11, Security]` angle on
  a user-supplied string. The pattern is deliberately practical rather than full RFC 5322; the doc
  comment (`EmailInvariants.cs:16-18`) says so plainly instead of overselling it.
- **Walkthrough**: `EnsureEmailIsValid(string email, string source)` (`EmailInvariants.cs:23`) runs
  three sequential guards, each returning a distinct error code so a caller can tell the failures
  apart: `"Email.Empty"` on `string.IsNullOrWhiteSpace` (`EmailInvariants.cs:25-32`),
  `"Email.TooLong"` past `MaxLength` with the limit interpolated through
  `string.Create(CultureInfo.InvariantCulture, ...)` so the message never picks up an ambient locale
  (`EmailInvariants.cs:34-41`), and `"Email.InvalidFormat"` on a regex miss
  (`EmailInvariants.cs:43-50`). All three use `Error.Invariant` rather than `Error.Validation`,
  marking them as domain-level data-integrity rules.
- **Why it's built this way**: `MaxLength = 256` (`EmailInvariants.cs:14`) is one `static readonly`
  field referenced by EF `HasMaxLength` calls and FluentValidation rules alike, the same
  single-source-of-truth idea as [`AddressInvariants`](#addressinvariants).
- **Where it's used**: called by [`Email.Create`](#email) (`Email.cs:34`) and by the email rule
  helpers in the Application validation layer.

### Enumeration<TEnumeration>
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Enumeration.cs:71` · Level 3 · class (abstract, generic)

- **What it is**: the abstract base for a **smart enumeration**: a closed set of named, integer-valued
  members declared on the derived type as `public static readonly` fields. Unlike a CLR `enum`, each
  member is a real object, so behaviour (policies, rates, display rules) can hang off it instead of
  living in a `switch` somewhere else (`Enumeration.cs:13-18`).
- **Depends on**: [`Error`](group-01-result-error-handling.md#error),
  [`Result`](group-01-result-error-handling.md#result), and
  [`EnumerationJsonConverterFactory`](#enumerationjsonconverterfactory) (mutual: the base carries
  `[JsonConverter(typeof(EnumerationJsonConverterFactory))]` at `Enumeration.cs:66` while the factory
  is constrained on `Enumeration<T>`). Externals: `System.Collections.Frozen`,
  `System.Collections.ObjectModel`, `System.Reflection`, `System.Text.Json`.
- **Concept introduced, the self-referencing generic (curiously recurring) constraint.** `[Rubric §4,
  DDD]` (a closed domain vocabulary that carries behaviour) and `[Rubric §1, SOLID]` (open for
  extension: adding a member is a field, not a new `case` in every switch). The declaration is
  `abstract class Enumeration<TEnumeration> where TEnumeration : Enumeration<TEnumeration>`
  (`Enumeration.cs:71-72`). The type parameter is the concrete type itself, which is what lets `All`,
  `FromValue` and `FromName` be **per-enumeration** and strongly typed: `Priority.FromValue(2)`
  returns `Result<Priority>` with no type argument written by hand, and each closed type gets its own
  static lookup tables (static fields on a generic type are per-constructed-type). The
  `CA1000` suppression (`Enumeration.cs:67-70`) exists for exactly this and states the reasoning: a
  non-generic sibling would return the base type and force a cast at every call site.
- **Concept introduced, lazy reflection frozen into a lookup.** `[Rubric §12, Performance &
  Scalability]`. Three `Lazy<T>` statics (`Enumeration.cs:74-82`) build the member set once per closed
  type on first touch: `MembersLazy` runs `DiscoverMembers`, `ByValueLazy` and `ByNameLazy` project it
  into `FrozenDictionary` instances (the name dictionary using `StringComparer.OrdinalIgnoreCase`).
  `FrozenDictionary` is the right structure for a build-once, read-forever table: construction is more
  expensive, lookups are faster than `Dictionary`. `ToFrozenDictionary` also throws `ArgumentException`
  on a duplicate key, which turns two members sharing a `Value` or a `Name` into a fail-fast at first
  use rather than a silent shadowing bug (`Enumeration.cs:30-35`).
- **Walkthrough**
  - `protected Enumeration(int value, string name)` (`Enumeration.cs:87`): the only constructor;
    derived types keep theirs private and expose members as static fields.
  - `Name` (`Enumeration.cs:95`) and `Value` (`Enumeration.cs:99`): getter-only, tagged
    `[DataMember(Order = 1)]` and `[DataMember(Order = 2)]` under the class-level `[DataContract]`
    (`Enumeration.cs:65`). The split is intentional and documented: `Value` is the **persisted**
    representation, `Name` is the **serialized/display** one.
  - `All` (`Enumeration.cs:105`): `IReadOnlyCollection<TEnumeration>`, ordered by `Value`, cached for
    the lifetime of the closed type.
  - `FromValue(int value)` (`Enumeration.cs:115`): `TryGetValue` on the frozen by-value map, else
    `Error.Invariant(code: "Enumeration.UnknownValue", ...)` naming the concrete type in the message
    (`Enumeration.cs:120-124`).
  - `FromName(string name)` (`Enumeration.cs:136`): the case-insensitive twin, null-coalescing the
    argument to `string.Empty` first (`Enumeration.cs:138`), else
    `Error.Invariant(code: "Enumeration.UnknownName", ...)`.
  - `ToString()` (`Enumeration.cs:149`): returns `Name`.
  - `Equals(object?)` (`Enumeration.cs:152-155`) and `GetHashCode()` (`Enumeration.cs:158`):
    type-guarded equality, `GetType() == other.GetType() && Value == other.Value`, hashed as
    `HashCode.Combine(GetType(), Value)`. The class deliberately does **not** implement
    `IEquatable<T>`: the remark at `Enumeration.cs:36-42` cites Sonar S4035 (an unsealed
    `IEquatable<T>` breaks the equality contract for subclasses) and leaves that to a sealed derived
    type. `[Rubric §15, Best Practices & Code Quality]`.
  - `DiscoverMembers()` (`Enumeration.cs:165-174`): reflects over
    `BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly`, keeps fields that are
    `IsInitOnly` (that is, `readonly`) and assignable to `TEnumeration`, reads their values, orders by
    `Value` and freezes to a `ReadOnlyCollection`. `DeclaredOnly` is the load-bearing flag: a derived
    hierarchy never inherits another type's members.
- **Why it's built this way**: the remarks (`Enumeration.cs:24-29`) explain the placement and the one
  surprising choice. It lives in `MMCA.Common.Shared` so it stays dependency-free and usable from
  Blazor WASM as well as Domain, and it deliberately does **not** derive from
  [`ValueObject`](#valueobject) because the `ValueObjectsAreImmutableSealedInShared` fitness rule
  forces every `ValueObject` derivative to be a *sealed record*, which would forbid the abstract
  static-member idiom this type exists for. `RoleValue`
  ([group-08](group-08-auth.md#rolevalue)) is named in-source as the shipped precedent for the same
  trade-off. `[Rubric §34, Architecture Governance]`: the exception is documented at the point of
  deviation rather than hidden.
- **Where it's used**: the framework ships the base plus its EF and JSON adapters;
  [`EnumerationValueConverter<TEnumeration>`](group-07-persistence-ef-core.md#enumerationvalueconvertertenumeration)
  and
  [`NullableEnumerationValueConverter<TEnumeration>`](group-07-persistence-ef-core.md#nullableenumerationvalueconvertertenumeration)
  map a member to its `int` `Value` and back through `FromValue`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/EnumerationValueConverter.cs:33,42,63`),
  and `AddAPI` registers the JSON factory
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:58`).
- **Caveats / not-in-source**: no concrete enumeration ships in ADC or Store today. The only derived
  types in the workspace are the fixtures in `MMCA.Common.Shared.Tests/ValueObjects/EnumerationTests.cs`
  and `EnumerationSerializationTests.cs`, plus
  `MMCA.Common.Infrastructure.Tests/Persistence/Conversions/EnumerationValueConverterTests.cs`. Treat
  the `Priority` sample in the doc comment (`Enumeration.cs:50-62`) as the usage template.

### EnumerationConverter<TEnumeration>
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Enumeration.cs:224` · Level 3 · class (private nested, sealed)

- **What it is**: the actual `JsonConverter<TEnumeration>` for one closed enumeration type. It is a
  **private nested class** inside
  [`EnumerationJsonConverterFactory`](#enumerationjsonconverterfactory) (`Enumeration.cs:224-243`),
  constrained the same way as the base: `where TEnumeration : Enumeration<TEnumeration>`
  (`Enumeration.cs:225`).
- **Depends on**: [`Enumeration<TEnumeration>`](#enumerationtenumeration) (it calls
  `Enumeration<TEnumeration>.FromName`) and `System.Text.Json`.
- **Concept, the generic worker behind a converter factory.** `[Rubric §2, Design Patterns]`
  (factory + strategy: the factory decides *whether* a type is convertible, the worker decides *how*).
  Being private is the point: nothing outside the factory can construct it directly, so the only way
  to obtain one is through `CreateConverter`, which guarantees the generic argument is a legal closed
  enumeration.
- **Walkthrough**
  - `Read` (`Enumeration.cs:227`): rejects a non-string token with
    `throw new JsonException($"{typeof(TEnumeration).Name} must be a string.")`
    (`Enumeration.cs:229-230`), reads the string (`Enumeration.cs:232`), resolves it through
    `Enumeration<TEnumeration>.FromName(name)` (`Enumeration.cs:234`) and throws a naming
    `JsonException` when that fails (`Enumeration.cs:235-236`). Identical failure behaviour to
    [`CurrencyJsonConverter`](#currencyjsonconverter), which is deliberate.
  - `Write` (`Enumeration.cs:241-242`): `writer.WriteStringValue(value.Name)`. The wire shape is the
    member name, never the integer, so a JSON payload stays readable and a renumbering is not a
    breaking API change (the integer is the *persistence* representation, handled by
    [`EnumerationValueConverter<TEnumeration>`](group-07-persistence-ef-core.md#enumerationvalueconvertertenumeration)).
- **Where it's used**: instantiated reflectively by
  `EnumerationJsonConverterFactory.CreateConverter` (`Enumeration.cs:202-204`). It has no other
  caller and no public surface.

### EnumerationJsonConverterFactory
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Enumeration.cs:195` · Level 3 · class (sealed)

- **What it is**: a `JsonConverterFactory` that hands System.Text.Json a
  [`EnumerationConverter<TEnumeration>`](#enumerationconvertertenumeration) for any concrete smart
  enumeration, so every member serializes as its `Name`.
- **Depends on**: [`Enumeration<TEnumeration>`](#enumerationtenumeration) (mutual: the base type
  carries `[JsonConverter(typeof(EnumerationJsonConverterFactory))]` at `Enumeration.cs:66`),
  [`EnumerationConverter<TEnumeration>`](#enumerationconvertertenumeration), and
  `System.Text.Json.Serialization`.
- **Concept introduced, why an *open generic* needs a factory.** `[Rubric §9, API & Contract
  Design]`. A `JsonConverter<T>` is closed over one `T`; there is no way to write one converter that
  serves `Priority`, `Severity` and every future enumeration. `JsonConverterFactory` is the
  System.Text.Json extension point for exactly that: `CanConvert` answers "is this type mine?" and
  `CreateConverter` builds the closed converter on demand. There is a second, subtler reason the
  factory has to exist at all, documented at `Enumeration.cs:43-49` and again at `Enumeration.cs:184-188`:
  System.Text.Json reads `[JsonConverter]` off the type it is converting **without walking base
  types**, so the attribute on `Enumeration<T>` does not reach `Priority`. A host therefore either
  repeats the attribute on each concrete type or registers this factory once. `AddAPI` takes the
  second route (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:58`, with the
  inline comment explaining the `inherit: false` behaviour).
- **Walkthrough**
  - `CanConvert(Type typeToConvert)` (`Enumeration.cs:198-199`):
    `GetEnumerationArgument(typeToConvert) == typeToConvert`. Read that carefully: it is true only
    when the type *is* the type argument of its own `Enumeration<T>` base, that is, only for the
    self-referencing closed type. A class deriving further from a concrete enumeration is left to the
    default converter rather than being silently serialized as its base (`Enumeration.cs:206-212`).
  - `CreateConverter(...)` (`Enumeration.cs:202-204`):
    `Activator.CreateInstance(typeof(EnumerationConverter<>).MakeGenericType(typeToConvert))` cast to
    `JsonConverter`. Reflection runs once per type; System.Text.Json caches the resulting converter.
  - `GetEnumerationArgument(Type?)` (`Enumeration.cs:213-222`): walks `type.BaseType` upward looking
    for a generic type whose definition is `typeof(Enumeration<>)`, returning its single generic
    argument, or `null` at the top of the chain.
- **Why it's built this way**: registering one factory in `JsonSerializerOptions.Converters` gives
  uniform name-based JSON for every enumeration across the whole API surface, including the non-MVC
  paths (cache entries, outbox payloads, integration events, typed `HttpClient` calls) that never see
  MVC model binding. The `HandleNull` default of `false` is left alone on purpose
  (`Enumeration.cs:189-193`) so nullable members still deserialize to `null`.
- **Where it's used**: registered in `AddAPI`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:58`), named in that
  method's doc comment alongside `CurrencyJsonConverter`
  (`.../DependencyInjection.cs:30-31`); also reachable via the `[JsonConverter]` attribute on
  [`Enumeration<TEnumeration>`](#enumerationtenumeration) (`Enumeration.cs:66`) for a member typed as
  the base itself.

### PhoneNumberInvariants
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/PhoneNumberInvariants.cs:11` · Level 3 · class (static, partial)

- **What it is**: the invariant checks for phone numbers: not empty, a length between 7 and 20
  characters, and a character-class format check via `[GeneratedRegex]`.
- **Depends on**: [`Error`](group-01-result-error-handling.md#error),
  [`Result`](group-01-result-error-handling.md#result).
- **Concept**: the same `[GeneratedRegex]` mechanism taught under
  [`EmailInvariants`](#emailinvariants). The generated partial property is
  `PhoneNumberRegex` with pattern `^[\d\s\-\(\)\+]+$` and the same
  `matchTimeoutMilliseconds: 1000` cap (`PhoneNumberInvariants.cs:60-61`), so it permits digits,
  whitespace, hyphens, parentheses and a plus sign and nothing else.
- **Walkthrough**: `EnsurePhoneNumberIsValid(string phoneNumber, string source)`
  (`PhoneNumberInvariants.cs:26`) guards in order: `"PhoneNumber.Empty"` on whitespace
  (`PhoneNumberInvariants.cs:28-35`), then it **trims once** into a local
  (`PhoneNumberInvariants.cs:37`) and runs both remaining checks against the trimmed value, so
  padding never counts toward the length and never fails the format check:
  `"PhoneNumber.InvalidLength"` outside `MinLength = 7` .. `MaxLength = 20`
  (`PhoneNumberInvariants.cs:14,17,39-46`) and `"PhoneNumber.InvalidFormat"` on a regex miss
  (`PhoneNumberInvariants.cs:48-55`). Like the email checks these are `Error.Invariant`, and the
  length message is built with `string.Create(CultureInfo.InvariantCulture, ...)`.
- **Where it's used**: called by [`PhoneNumber.Create`](#phonenumber)
  (`PhoneNumber.cs:32`); `MinLength` and `MaxLength` are the constants EF configurations and
  FluentValidation rules read.

### Email
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Email.cs:16` · Level 4 · record (sealed)

- **What it is**: a validated, normalized value object for an email address. Every construction path
  goes through `Create`, which rejects invalid formats and lowercases the result; the private
  constructor exists for JSON round-tripping only.
- **Depends on**: [`ValueObject`](#valueobject) (Level 0), [`EmailInvariants`](#emailinvariants)
  (Level 3), [`Result<T>`](group-01-result-error-handling.md#result) (Level 2).
- **Concept introduced, normalization at construction plus implicit conversion.** `[Rubric §4,
  Domain-Driven Design]` (rich value objects with invariant-protected construction). Three ideas
  combine here: (1) the `[JsonConstructor]`-tagged private constructor (`Email.cs:22-23`) keeps
  ad-hoc construction out while letting System.Text.Json rehydrate; (2) `Create` validates *and
  normalizes*, returning `Result<Email>` instead of throwing; (3)
  `public static implicit operator string(Email email)` (`Email.cs:45`) lets an `Email` drop into a
  `string` position without a cast, a pragmatic bridge for code that has not adopted the value object
  yet. The `#pragma warning disable CA1308` around `ToLowerInvariant` (`Email.cs:38-40`) is a scoped
  suppression with its justification on the same line ("Email addresses are conventionally lowercase
  per RFC 5321"). `[Rubric §15, Best Practices & Code Quality]` (suppressions are narrow and
  explained, never blanket).
- **Walkthrough**
  - `Value` (`Email.cs:20`): getter-only `string`, the normalized address, tagged
    `[DataMember(Order = 1)]` under the class-level `[DataContract]` (`Email.cs:15`).
  - `Create(string value)` (`Email.cs:30`): trims null-safely with `value?.Trim() ?? string.Empty`
    (`Email.cs:32`), calls `EmailInvariants.EnsureEmailIsValid(trimmed, nameof(Create))`
    (`Email.cs:34`), propagates `result.Errors` on failure (`Email.cs:36`), and only then lowercases
    (`Email.cs:39`). Order matters: validation runs on the trimmed input, normalization on the
    validated value.
  - `implicit operator string` (`Email.cs:45`) and `ToString()` (`Email.cs:48`): both return `Value`.
- **Why it's built this way**: normalizing once at construction means the rest of the system can
  compare, index and store emails case-insensitively without a `.ToLower()` at every use. The remarks
  (`Email.cs:7-14`) also pin the persistence shape: EF maps this with `HasConversion`, **not**
  `OwnsOne`, so the column stays a flat `nvarchar`, and the framework ships the converter pair rather
  than asking each configuration to hand-roll the lambdas:
  [`EmailValueConverter`](group-07-persistence-ef-core.md#emailvalueconverter)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/EmailValueConverter.cs:33`)
  and
  [`NullableEmailValueConverter`](group-07-persistence-ef-core.md#nullableemailvalueconverter)
  (`.../EmailValueConverter.cs:60`) for an optional `Email?`.
- **Where it's used**: the Store Identity `Customer` aggregate holds `public Email Email`
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Customers/Customer.cs:36`) and
  builds it through `Email.Create` in both `Create` (`Customer.cs:77`) and `ChangeEmail`
  (`Customer.cs:153`); its EF configuration applies `.HasConversion(new EmailValueConverter())`
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/EntityConfiguration/CustomerConfiguration.cs:36`).
  Note the layering: `RegisterRequest` still carries a raw `string Email`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RegisterRequest.cs`), and the conversion into the
  value object happens inside the domain factory. `[Rubric §9, API & Contract Design]`.

### Money
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Money.cs:21` · Level 4 · record (sealed)

- **What it is**: a value object pairing a `decimal Amount` with a [`Currency`](#currency)
  (`Money.cs:31,35`), carrying arithmetic operators, a `Result`-safe `Add`, and `Currency.None` as a
  zero-accumulator sentinel.
- **Depends on**: [`ValueObject`](#valueobject) (Level 0), [`Currency`](#currency) (Level 3),
  [`Error`](group-01-result-error-handling.md#error) (Level 1),
  [`Result<T>`](group-01-result-error-handling.md#result) (Level 2).
- **Concept introduced, behaviour on the value object (and a deliberate two-path API).** `[Rubric §4,
  DDD]` (a rich value object encapsulates behaviour, not just data). `Money` is the most
  concept-dense type in this group:
  - **Errors as named constants.** `NoCurrency` and `CurrencyMismatch` (`Money.cs:24,27`) are
    `public static readonly Error` fields, so a caller can compare against the constant instead of
    string-matching a message.
  - **Two addition paths.** `operator +` (`Money.cs:84`) delegates to `Add` and *throws*
    `InvalidOperationException` carrying `result.Errors[0].Message` when the currencies clash
    (`Money.cs:86-89`); the doc comment above it (`Money.cs:77-80`) tells you to "prefer `Add` for
    Result-based error handling". This is an intentional usability trade-off: operator syntax for
    trusted arithmetic inside one currency, the `Result` path for anything derived from untrusted
    input.
  - **`Currency.None` as an additive identity.** `AddUnchecked` (`Money.cs:131-138`) returns the other
    operand untouched when either side has no currency, which is what makes `Zero()` usable as an
    `Aggregate` seed before the target currency is known.
  - **Fail-fast round-trip constructor.** The `[JsonConstructor]` private constructor
    (`Money.cs:51-58`) calls `ArgumentNullException.ThrowIfNull(currency)`, and its doc comment
    (`Money.cs:40-47`) explains the contract: "no currency" is `Currency.None`, never `null`, so a
    materializer that yields `null` is a broken contract and is surfaced here rather than as a
    NullReferenceException three layers away. `[Rubric §15, Best Practices & Code Quality]`.
  - **A narrow test back-door.** `internal static Money CreateUnsafe(decimal, Currency)`
    (`Money.cs:153`) is exposed to test assemblies through `InternalsVisibleTo`, giving tests a way to
    build otherwise-illegal values without opening a public hole.
- **Walkthrough**
  - `Amount` (`Money.cs:31`) and `Currency` (`Money.cs:35`): `init`-only, `[DataMember(Order = 1)]`
    and `[DataMember(Order = 2)]` under `[DataContract]` (`Money.cs:20`). `IsNegative`
    (`Money.cs:38`) is a computed predicate; negative amounts are explicitly allowed (refunds,
    adjustments).
  - `Create(decimal amount, Currency currency)` (`Money.cs:67`): null-guards the reference, then
    rejects `Currency.None` with `NoCurrency` (`Money.cs:71-72`), because external callers must name a
    real currency.
  - `operator +` (`Money.cs:84`) and `operator *` (`Money.cs:96`, by an `int` quantity), with
    `Multiply(Money, int)` (`Money.cs:124`) as the named alias the operator-averse analyzers expect.
  - `Add(Money first, Money second)` (`Money.cs:107`): returns `CurrencyMismatch` enriched with
    `.WithSource(nameof(Add))` and `.WithTarget($"{first.Currency.Code} + {second.Currency.Code}")`
    (`Money.cs:112-114`) **only** when both sides carry a real and differing currency; otherwise it
    delegates to `AddUnchecked`.
  - `Zero()` (`Money.cs:142`) returns `new(0, Currency.None)`; `Zero(Currency)` (`Money.cs:147`) fixes
    the currency. `IsZero()` (`Money.cs:157`) is `this == Zero(Currency)`, which works precisely
    because record equality is structural.
- **Why it's built this way**: putting arithmetic on the type removes scattered `a.Amount + b.Amount`
  expressions that quietly ignore currency. Persistence follows the same "ship the helper" rule as
  `Email`: the remarks (`Money.cs:14-19`) direct configurations at
  `EntityTypeBuilderExtensions.OwnsMoney`
  ([group-07](group-07-persistence-ef-core.md#entitytypebuilderextensions),
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeBuilderExtensions.cs:51`),
  which produces the amount column plus ISO-code column mapping together with the currency round-trip
  fallback every hand-rolled `OwnsOne` block would otherwise have to repeat.
- **Where it's used**: the Store Sales `Order` aggregate holds `public Money Total`
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/Order.cs:37`), seeds it with
  `Money.Zero()` (`Order.cs:77`), takes `Money UnitPrice` on its line-item tuple (`Order.cs:92`) and
  accumulates with `Money.Add(order.Total, unitPrice * quantity)` (`Order.cs:109`), the exact
  combination of the `None` identity, the `*` operator and the `Result`-safe `Add` described above.
  The Catalog module carries prices the same way, and the UI formats values through
  [`MoneyExtensions`](group-15-common-ui-framework.md#moneyextensions).

### PhoneNumber
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/PhoneNumber.cs:16` · Level 4 · record (sealed)

- **What it is**: a validated, trimmed value object for a phone number, structurally parallel to
  [`Email`](#email).
- **Depends on**: [`ValueObject`](#valueobject) (Level 0),
  [`PhoneNumberInvariants`](#phonenumberinvariants) (Level 3),
  [`Result<T>`](group-01-result-error-handling.md#result) (Level 2).
- **Concept**: the same private-constructor + static-factory + implicit-conversion shape taught under
  [`Email`](#email); this section cross-references rather than repeating it. One difference worth
  noting: there is no case normalization (a phone number has no case), and `Create` validates the
  **raw** string then stores `value.Trim()` (`PhoneNumber.cs:32,36`), whereas `Email.Create` trims
  first and validates the trimmed value. `PhoneNumberInvariants.EnsurePhoneNumberIsValid` trims
  internally before its length and format checks (`PhoneNumberInvariants.cs:37`), so the two orderings
  agree in practice.
- **Walkthrough**: `Value` (`PhoneNumber.cs:20`, getter-only, `[DataMember(Order = 1)]` under
  `[DataContract]` at `PhoneNumber.cs:15`); the `[JsonConstructor]` private constructor
  (`PhoneNumber.cs:22-23`); `Create(string value)` (`PhoneNumber.cs:30`) delegating to
  `PhoneNumberInvariants.EnsurePhoneNumberIsValid` and returning `Result.Failure<PhoneNumber>` with
  the propagated errors (`PhoneNumber.cs:34`); the implicit `operator string`
  (`PhoneNumber.cs:41`) and `ToString()` (`PhoneNumber.cs:44`).
- **Why it's built this way**: as with `Email`, the remarks (`PhoneNumber.cs:7-14`) specify
  `HasConversion` rather than `OwnsOne` so the column stays `nvarchar`, and point at the shipped
  [`PhoneNumberValueConverter`](group-07-persistence-ef-core.md#phonenumbervalueconverter)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/PhoneNumberValueConverter.cs:33`)
  and its `NullablePhoneNumberValueConverter` sibling (`.../PhoneNumberValueConverter.cs:61`).
- **Where it's used**: no ADC or Store entity holds a `PhoneNumber` today; the type and its EF
  converters ship for adopters, and behaviour is pinned by
  `MMCA.Common.Shared.Tests/ValueObjects/PhoneNumberTests.cs`.

### CommonInvariants

> MMCA.Common.Domain · `MMCA.Common.Domain.Invariants` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Invariants/CommonInvariants.cs:10` · Level 3 · class (static)

- **What it is**: a shared library of four reusable domain invariant methods: `EnsureStringIsNotEmpty`,
  `EnsureStringMaxLength`, `EnsureIdIsNotDefault<TId>`, and `EnsureBytesAreNotEmpty`. All return
  [`Result`](group-01-result-error-handling.md#result), so an invariant check either passes
  (`Result.Success()`) or yields a typed invariant failure rather than throwing.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result),
  [`Error`](group-01-result-error-handling.md#error) (via the `Error.Invariant(...)` factory).
  No external dependencies, `string.IsNullOrWhiteSpace` and `IEquatable<T>` are BCL.
- **Concept introduced, centralized invariant helpers vs. per-entity duplication.**
  `[Rubric §16, Maintainability]`, §16 assesses whether repeated rules have a single source of
  truth; here every "string must be non-empty"/"id must not be default" check resolves to one
  canonical implementation instead of being re-coded per entity. `[Rubric §4, DDD]`, §4 assesses
  whether the domain layer expresses business invariants in ubiquitous language; these helpers
  standardize the *shape* of invariant errors (code/message/source/target) that module invariant
  classes speak. Without `CommonInvariants`, every module's invariant class would independently
  reimplement `string.IsNullOrWhiteSpace` checks with slightly different error codes and messages.
  `CommonInvariants` provides the canonical implementations; module-specific invariant classes
  delegate to these. `[Rubric §1, SOLID]`, DRY is an SRP corollary: one place owns each kind of
  check, so a fix (e.g. tightening the max-length comparison) lands once.
- **Walkthrough** (all members are `static`, expression-bodied, and take the diagnostic quartet
  `code, message, source, target` so the helper itself stays domain-neutral):
  - `EnsureStringIsNotEmpty(string value, string code, string message, string source, string target)`
    (line 21): fails with `Error.Invariant(...)` when `string.IsNullOrWhiteSpace(value)`, else
    `Result.Success()` (lines 23–25).
  - `EnsureStringMaxLength(string? value, int maxLength, …)` (line 38): accepts a nullable string and
    fails *only* when `value is not null && value.Length > maxLength` (line 40), so `null`/empty pass.
    Callers that also require non-empty compose this with `EnsureStringIsNotEmpty`.
  - `EnsureIdIsNotDefault<TId>(TId id, …)` (line 54): constrained `where TId : struct, IEquatable<TId>`
    and fails when `id.Equals(default)` (line 57), detects the "id was never set" case (default
    `int` = 0, default `Guid` = `Guid.Empty`).
  - `EnsureBytesAreNotEmpty(byte[] value, …)` (line 70): fails when `value is null || value.Length == 0`
    (line 72), validates that a required `byte[]` (e.g. a `RowVersion`/concurrency token) has content.
- **Why it's built this way**: placing these in `MMCA.Common.Domain` (not `MMCA.Common.Shared`)
  keeps them below the Application layer in the dependency stack while still being reachable by every
  module's domain invariant class; and returning [`Result`](group-01-result-error-handling.md#result)
  rather than throwing is the codebase-wide flow-control convention (see the Result pattern in the
  [primer](00-primer.md)). The `Error.Invariant` factory tags each failure with
  [`ErrorType`](group-01-result-error-handling.md#errortype)`.Invariant`, which the API layer later
  maps to an HTTP status.
- **Where it's used**: delegated to by the value-object invariant classes in this group
  ([`AddressInvariants`](#addressinvariants), [`EmailInvariants`](#emailinvariants),
  [`PhoneNumberInvariants`](#phonenumberinvariants), all Level 3) and by the module entity invariant
  classes: [`EventInvariants`](group-17-conference-domain.md#eventinvariants),
  [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants),
  [`SpeakerInvariants`](group-17-conference-domain.md#speakerinvariants) (Level 4, Conference),
  [`UserSessionBookmarkInvariants`](group-22-engagement-module.md#usersessionbookmarkinvariants)
  (Level 4, Engagement), and [`UserInvariants`](group-24-identity-module.md#userinvariants)
  (Level 4, Identity). Exercised by
  [`CommonInvariantsTests`](group-27-testing-infrastructure.md#commoninvariantstests).


---
[⬅ Result & Error Handling](group-01-result-error-handling.md)  •  [Index](00-index.md)  •  [Querying: Specifications, Filtering & the Entity Query Service ➡](group-03-querying-specifications.md)
