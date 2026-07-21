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
   audit/soft-delete/concurrency, then domain-event collection and aggregate operations.
2. **The value-object family**, the [`ValueObject`](#valueobject) base and the concrete, immutable
   concepts built on it: [`Address`](#address), [`Money`](#money), [`Currency`](#currency),
   [`Email`](#email), [`PhoneNumber`](#phonenumber), [`DateRange`](#daterange), and
   [`DateTimeRange`](#datetimerange), each guarded by a matching invariants helper
   ([`AddressInvariants`](#addressinvariants), [`EmailInvariants`](#emailinvariants),
   [`PhoneNumberInvariants`](#phonenumberinvariants)) plus the shared [`CommonInvariants`](#commoninvariants)
   toolbox, and the [`CurrencyJsonConverter`](#currencyjsonconverter) that puts `Currency` on the wire.
3. **The governance markers and helpers**, the attributes and small utilities that drive
   metadata-based behavior across the stack: [`PiiAttribute`](#piiattribute) (erasure and log masking)
   with its redaction half [`PiiRedactor`](#piiredactor) and that helper's cached
   [`RedactableProperty`](#redactableproperty) descriptor,
   [`IdValueGeneratedAttribute`](#idvaluegeneratedattribute) + [`EntityTypeExtensions`](#entitytypeextensions)
   (database-generated IDs), [`IAnonymizable`](#ianonymizable) (GDPR/CCPA erasure), the
   [`DomainEntityState`](#domainentitystate) enum (state-change classification for domain events), and
   [`DomainHelper`](#domainhelper) (culture-invariant identifier parsing).

All of these live in the two innermost layers, `MMCA.Common.Shared` (value objects, invariants,
`DomainHelper`) and `MMCA.Common.Domain` (entities, interfaces, attributes, enums, privacy helpers), so
the whole group sits below Application and Infrastructure in the dependency flow (see
[primer §1](00-primer.md#1-the-big-picture)). Nothing here references EF Core, ASP.NET, or a message
broker; persistence and dispatch are *described* by these types and *implemented* by higher groups.
That separation is the [Rubric §3, Clean Architecture] and [Rubric §4, Domain-Driven Design] story
in miniature: the model is framework-free, and the framework adapts to it.

## The entity chain, one capability per rung

Read the chain bottom-up. [`BaseEntity<TIdentifierType>`](#baseentitytidentifiertype)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/BaseEntity.cs:14`) is almost nothing: a single
`required init` identifier of the per-entity alias type, constrained `where TIdentifierType : notnull`
(`BaseEntity.cs:15-17`), and it implements
[`IBaseEntity<TIdentifierType>`](#ibaseentitytidentifiertype)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IBaseEntity.cs:7`), which declares `Id` with an
`init` accessor so the contract itself forbids reassignment (`IBaseEntity.cs:11`). See
[identifier aliases](00-primer.md#2-architectural-styles-this-codebase-commits-to) for where the alias
types come from. `required init` is the load-bearing choice: a factory method sets `Id` once at
construction and it is immutable thereafter, while EF Core still materializes the entity through the
parameterless constructor.

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
freezing `CreatedOn/By` as unmodified on updates. The class declares both
[`IAuditableEntity`](#iauditableentity) and [`IRowVersioned`](#irowversioned)
(`AuditableBaseEntity.cs:13`); the latter exists so a repository can accept *any* tracked child entity
for a concurrency check without a second generic parameter for the child's identifier type
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IRowVersioned.cs:11`, rationale in ADR-035).
This rung is where [Rubric §8, Data Architecture] (soft-delete, audit, concurrency) meets [Rubric §10,
Cross-Cutting]: three concerns that would otherwise be copy-pasted into every entity are inherited once
and enforced centrally (ADR-005 for soft-delete versus erasure).

[`AuditableAggregateRootEntity<TIdentifierType>`](#auditableaggregaterootentitytidentifiertype)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableAggregateRootEntity.cs:13`) is the top
rung and the one that earns the DDD name "aggregate root". It implements
[`IAggregateRoot`](#iaggregateroot), so it owns a private domain-event list with `AddDomainEvent`,
`ClearDomainEvents`, and a read-only `DomainEvents` view (`AuditableAggregateRootEntity.cs:16-34`), and
it adds the two helpers that let a root police its own consistency boundary: `SetItems<TChildEntity>`
(replace a child collection, routed through an overridable `ValidateSetItems` hook so a root can veto,
say, removing a shipped order line, `AuditableAggregateRootEntity.cs:44-74`) and
`GetChildOrNotFound<TChild, TChildId>` (find an *active*, non-soft-deleted child by id or return an
[`Error.NotFound`](group-01-result-error-handling.md#error) failure,
`AuditableAggregateRootEntity.cs:87-104`). Only aggregate roots raise domain events, and that is how
the persistence layer knows where to look. This rung is the clearest [Rubric §4, Domain-Driven Design]
and [Rubric §6, CQRS & Event-Driven] expression in the codebase: invariants are enforced *inside* the
boundary, and state changes are announced as events rather than leaked as side effects.

## How a domain event leaves an aggregate

The runtime flow ties this group to the events/outbox group. A command handler loads an aggregate,
calls a business method, and that method calls `AddDomainEvent(...)`; the event sits in the aggregate's
private list, doing nothing yet. On save, EF Core interceptors take over.
[`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
captures every tracked [`IAggregateRoot`](#iaggregateroot) via
`context.ChangeTracker.Entries<IAggregateRoot>()`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:145`),
serializes the pending [`IDomainEvent`](group-04-events-outbox.md#idomainevent)s into
[`OutboxMessage`](group-04-events-outbox.md#outboxmessage) rows **in the same transaction** as the data,
then dispatches the local events in process and calls `ClearDomainEvents()` on each captured aggregate
so nothing is delivered twice (`DomainEventSaveChangesInterceptor.cs:229-257`). Inside a transactional
command the dispatch is deferred until after commit and re-queued through a `DeferredDispatch` record
(`DomainEventSaveChangesInterceptor.cs:212-213`), so a handler never acts on state that could still roll
back. The [`DomainEntityState`](#domainentitystate) enum (`Unchanged`/`Added`/`Updated`/`Deleted`, with
explicit numeric values at
`MMCA.Common/Source/Core/MMCA.Common.Domain/Enums/DomainEntityState.cs:9-12`) is the small vocabulary an
event uses to say *what kind* of change happened. The aggregate base is the producer end of the
at-least-once outbox pipeline (ADR-003); the consumer end lives in
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
simply cannot be constructed. The validation logic itself is factored out into static *invariants*
classes, [`AddressInvariants`](#addressinvariants)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/AddressInvariants.cs:9`),
[`EmailInvariants`](#emailinvariants)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/EmailInvariants.cs:11`), and
[`PhoneNumberInvariants`](#phonenumberinvariants)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/PhoneNumberInvariants.cs:11`), which also
publish the length constants that EF entity configurations and FluentValidation validators reuse
(`Email` at 256 characters, `EmailInvariants.cs:14`; `PhoneNumber` between 7 and 20,
`PhoneNumberInvariants.cs:14-17`; the six address field limits at `AddressInvariants.cs:12-27`), so the
field-length rules have **one source of truth**. [`CommonInvariants`](#commoninvariants)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Invariants/CommonInvariants.cs:10`) is the reusable lower
layer that module-specific invariants delegate to: `EnsureStringIsNotEmpty`, `EnsureStringMaxLength`,
`EnsureIdIsNotDefault<TId>`, and `EnsureBytesAreNotEmpty` (`CommonInvariants.cs:21-70`). Each returns a
`Result`, and the calling invariants class folds them together with `Result.Combine` so one call reports
every broken rule at once (`AddressInvariants.cs:40`). This whole family is the [Rubric
§4, Domain-Driven Design] and [Rubric §1, SOLID] (the factory enforces invariants; invariants are a
single-responsibility unit) story.

The concrete value objects split into a few patterns worth knowing up front:

- **Owned-type composites**: [`Address`](#address)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Address.cs:16`) and [`Money`](#money)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Money.cs:18`) are stored by EF as `OwnsOne`
  nested columns; both carry `[DataContract]` with ordered `[DataMember(Order = n)]` properties to pin
  the serialization shape (`Address.cs:15-40`, `Money.cs:17-32`). `Address` requires only
  `AddressLine1` and leaves the other five fields optional for international formats. `Money` is the
  richest: it pairs a `decimal Amount` with a [`Currency`](#currency), defines `+` and `*` operators
  *and* a `Result`-returning `Add` (`Money.cs:68-102`), and treats `Currency.None` as an additive
  identity so `Money.Zero()` works as an accumulator seed regardless of the eventual currency
  (`Money.cs:115-126`). Note the asymmetry worth remembering: the `+` operator *throws*
  `InvalidOperationException` on a currency mismatch (`Money.cs:73`) while `Add` returns a
  `CurrencyMismatch` failure, so prefer `Add` in domain code.
- **Closed enumeration**: [`Currency`](#currency)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Currency.cs:14`) is a record with a private
  constructor and a fixed `All` set of exactly `Usd` and `Eur` (`Currency.cs:54-58`), plus an
  `internal` `None` sentinel that is deliberately *not* in `All` and never reaches API consumers
  (`Currency.cs:23`). `FromCode` is the only public way to get one and matches case-insensitively
  (`Currency.cs:41-51`), and [`CurrencyJsonConverter`](#currencyjsonconverter) (`Currency.cs:65`)
  serializes it as its bare ISO-4217 code on the wire, throwing a `JsonException` on an unknown code
  when reading (`Currency.cs:68-83`).
- **Converted scalars**: [`Email`](#email)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Email.cs:13`) and
  [`PhoneNumber`](#phonenumber)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/PhoneNumber.cs:13`) are stored via EF
  `HasConversion` (not `OwnsOne`), so the column stays a flat `nvarchar`. Both normalize on creation
  (`Email` trims then lowercases with `ToLowerInvariant`, `Email.cs:29-36`; `PhoneNumber` trims,
  `PhoneNumber.cs:33`) and expose an implicit `string` conversion plus a `ToString` override for
  ergonomics (`Email.cs:42-45`, `PhoneNumber.cs:38-41`).
- **Interval pairs**: [`DateRange`](#daterange)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/DateRange.cs:9`, `DateOnly` based) and
  [`DateTimeRange`](#datetimerange)
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/DateTimeRange.cs:10`, full precision) are
  near-identical: a validated start/end pair with `Overlaps`, `Contains`, `Deconstruct`, and a
  length/duration accessor (`LengthInDays` at `DateRange.cs:38`, `Duration` at `DateTimeRange.cs:39`);
  `Create` rejects `end < start` (`DateRange.cs:30-35`). Read the boundary rules carefully: `Contains`
  is inclusive on both ends while `Overlaps` compares half-open (`DateRange.cs:46-56`).

## Governance markers, metadata that other layers act on

The last family is tiny attributes and helpers that carry *intent* the rest of the stack reads
reflectively. [`PiiAttribute`](#piiattribute)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Attributes/PiiAttribute.cs:19`) tags a property as
data-subject PII, and it is a property-only, non-inherited, single-use attribute (`PiiAttribute.cs:18`).
Two governance mechanisms rely on the marker. First, an architecture fitness test asserts that any
entity declaring a `[Pii]` property also implements [`IAnonymizable`](#ianonymizable), so every piece of
personal data has an erasure path (`PiiConventionTests`, driven by the shared `PiiConventionTestsBase`,
at `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiConventionTests.cs:13`; the scan is
structurally vacuous inside the framework itself because no data-subject type lives in
`MMCA.Common.Domain`, and its own doc comment says so). Second, [`PiiRedactor`](#piiredactor)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Privacy/PiiRedactor.cs:24`) is the redaction half: it
reflects over an object's public readable properties and replaces every `[Pii]` value wholesale with the
`"[REDACTED]"` token (`PiiRedactor.cs:27`, `PiiRedactor.cs:42-57`), offering `Redact` (a property map),
`RedactToString` (a single-line rendering, `PiiRedactor.cs:65`), and `HasPii` (a type probe,
`PiiRedactor.cs:98`). Its per-type reflection metadata is cached in a `ConcurrentDictionary` of
[`RedactableProperty`](#redactableproperty) descriptors (`PiiRedactor.cs:31`, `PiiRedactor.cs:112-121`),
and a property getter that throws is caught and rendered as `"[unreadable]"` so a logging call site can
never be broken by redaction (`PiiRedactor.cs:129-140`). Important scope note: `PiiRedactor` is an
**opt-in helper you call**, not an automatic logging pipeline. Outside its own unit and fitness tests
there is no production call site in `MMCA.Common` or `MMCA.ADC` today; the framework's stated posture is
to log scalar identifiers rather than whole entities, and to route an entity through the redactor when
one must be logged (`PiiRedactor.cs:10-16`).

[`IAnonymizable`](#ianonymizable)
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAnonymizable.cs:22`) defines the erasure
contract itself: an idempotent `Anonymize()` returning
[`Result`](group-01-result-error-handling.md#result) (`IAnonymizable.cs:30`) that an application-layer
handler invokes to overwrite personal fields in place while keeping the row for referential integrity
and audit history. Together these are the [Rubric §11, Security] and [Rubric §30,
Compliance/Privacy/Data Governance] story, and they are why soft-delete and erasure are *different*
mechanisms (ADR-005, cited at `IAnonymizable.cs:19`): soft-delete hides a row but keeps its data,
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
coupling to a concrete id type; it handles `string`, `Guid`, `int`, `long`, `ulong`, `bool`, and enums,
falls back to the type default on unparseable input, and throws `FormatException` for an unsupported
identifier type (`DomainHelper.cs:21-63`). Its `CultureInfo.InvariantCulture` parsing is also the
codebase's headline [Rubric §27, Internationalization] decision (deliberate culture-invariance where
culture would otherwise introduce bugs; see
[primer §6](00-primer.md#6-the-34-category-architecture-evaluation-lens)).

## Where this group sits

Everything above is consumed by the layers that follow: every module entity (for example the
[Conference domain](group-17-conference-domain.md), Engagement, and Identity modules) derives from one
of the three entity base classes; the persistence group ([Group 07](group-07-persistence-ef-core.md))
maps value objects, stamps the audit fields these types declare, and applies the global soft-delete
query filter keyed off [`IAuditableEntity`](#iauditableentity); the events/outbox group
([Group 04](group-04-events-outbox.md)) drains the domain events aggregates raise; and the CQRS handlers
throughout the application return the [`Result`](group-01-result-error-handling.md#result) values these
factories produce. Read this group as the *grammar* of the domain: the rest of the guide is the
sentences written in it.

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
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/EntityChangedEvent.cs:8-12`).
- **Where it's used**: it is the `State` member of
  [`EntityChangedEvent<TIdentifierType>`](group-04-events-outbox.md#entitychangedeventtidentifiertype)
  (`EntityChangedEvent.cs:25`), so every derived per-entity change event carries it; aggregates pass
  `DomainEntityState.Added` from factories, `Updated` from mutators and `Deleted` from `Delete()` (for
  example `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Categories/Category.cs:72,95,116`),
  and handlers short-circuit on it (for example
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/DomainEventHandlers/SessionCreatedHandler.cs:17`).

### DomainHelper
> MMCA.Common.Shared · `MMCA.Common.Shared.Extensions` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Extensions/DomainHelper.cs:8` · Level 0 · class (static)

- **What it is**: a static class that adds a generic `Parse<TIdentifier>()` **extension member** to
  `string?`, converting a route-parameter string into a strongly-typed identifier.
- **Depends on**: BCL only (`System.Globalization`).
- **Concept introduced, C# `extension(T)` members.** `[Rubric §15, Best Practices & Code Quality]`
  (assesses idiomatic, modern-language use). This is the first concrete sighting of the C# preview
  feature described in
  [primer §4](00-primer.md#c-extensiont-types-read-this-once). The block
  `extension(string? id) { … }` (`DomainHelper.cs:13`) means any nullable string can call
  `someId.Parse<int>()`. The receiver `id` is the "this" value.
- **Walkthrough**
  - `Parse<TIdentifier>()` (`DomainHelper.cs:21`): special-cases `string` (returns the value or
    empty, lines 25-26), short-circuits null/whitespace to `default` (lines 28-29), then delegates to
    `ParseNonEmpty` (line 31).
  - `ParseNonEmpty<TIdentifier>` (line 37) and `ParseOtherTypes<TIdentifier>` (line 52): a chain of
    `typeof(TIdentifier) == typeof(Guid|int|long|ulong|bool)` plus `type.IsEnum` checks (lines 40-61)
    using culture-invariant `TryParse`; an unsupported type throws `FormatException` (line 63). Each
    failed `TryParse` falls back to the type's zero/empty value rather than throwing. Splitting into
    two private methods keeps each within the analyzers' cyclomatic-complexity budget.
  - Note the `#pragma warning disable IDE0051` (lines 36-38) around `ParseNonEmpty` with a comment
    (line 35) explaining it is a false positive: the analyzer cannot see that the method is called from
    inside the `extension` block. A justified, scoped suppression.
- **Why it's built this way**: controllers receive ids as `string` route values; this converts them
  to the entity's id alias type **without** the controller coupling to a specific id type, generic
  over `TIdentifier`. Culture-invariant parsing avoids locale-dependent bugs and is one of the few
  places §27 (i18n) bites, see [primer §6](00-primer.md#6-the-34-category-architecture-evaluation-lens).
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
  accountability) and ties to ADR-005 (soft-delete vs. erasure).
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
  soft-delete query filter (G07). Its `IsDeleted` flag is the counterpart that
  [`IAnonymizable`](#ianonymizable) deliberately does *not* satisfy on its own (see ADR-005, and the
  explicit statement of that gap in `IAnonymizable.cs:11-13`).

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
- **Why it's built this way**: generic id type so each entity binds its strong-id alias; the contract
  is intentionally tiny so the concrete base classes
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
- **Where it's used**: read by [`EntityTypeExtensions`](#entitytypeextensions) (Level 1) and by entity
  factory methods deciding whether to set `Id`.

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
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:166-169`).
  The interesting design point is *why the token needs its own interface at all*: the repository's
  aggregate-typed overload `SetOriginalRowVersion(TEntity, byte[]?)` (`IRepository.cs:173`) can only
  reach the aggregate **root**, because `TEntity` is the root type. A child entity edit (a
  `ProductVariant` under a `Product`) would otherwise need a second generic parameter for the child's
  own identifier type. `IRowVersioned` erases that identifier type: the child overload
  (`IRepository.cs:185`) accepts any `IRowVersioned`, so child-level edits get the same stale-token
  protection as the root. The doc comment states this rationale and cites ADR-035
  (`IRowVersioned.cs:3-10`).
- **Walkthrough**: one getter, `byte[] RowVersion` (`IRowVersioned.cs:15`), wrapped in a scoped
  `#pragma warning disable CA1819` (lines 14-16) with the justification that `byte[]` is EF Core's
  native rowversion shape and mirrors `AuditableBaseEntity.RowVersion`. The interface is getter-only:
  the domain never assigns the token, the database does.
- **Why it's built this way**: an identifier-type-free contract is the smallest change that lets one
  repository method serve both roots and children; the alternative (a second generic parameter, or a
  non-generic `object` overload) would either leak type parameters through the whole repository surface
  or lose type safety. ADR-035 records the decision.
- **Where it's used**: implemented by
  [`AuditableBaseEntity<TIdentifierType>`](#auditablebaseentitytidentifiertype)
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:13`), whose
  `RowVersion` property is a private-set `byte[]` defaulting to `[]` (`AuditableBaseEntity.cs:39`), so
  every auditable entity (aggregate roots **and** their children) satisfies it. Consumed by
  [`IRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype)
  (`IRepository.cs:185`) and implemented in
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:84-93`,
  which casts the child to `object`, walks to `_context.Entry(...).Property(nameof(AuditableBaseEntity<>.RowVersion))`
  and assigns `OriginalValue`; the decorator forwards it
  (`.../EFRepositoryDecorator.cs:45`).
- **Caveats / not-in-source**: both `SetOriginalRowVersion` overloads are a **no-op** when the supplied
  token is null or empty (`EFRepository.cs:75-76,87-88`), which the doc comment attributes to legacy
  clients and first writes (`IRepository.cs:181`); a client that omits the token therefore silently
  loses the conflict check rather than being rejected.

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
  separate anonymize path, the exact §30 red flag this avoids; ADR-005); and (2) [`PiiRedactor`](#piiredactor),
  the **redaction half** of the contract (`PiiAttribute.cs:10-12`), masks `[Pii]`-marked members with
  the literal `[REDACTED]` so an entity carrying personal data can be written to a structured log or
  telemetry attribute without the data subject's PII leaking in clear text. Both halves exist in
  source: mechanism (1) is `[Rubric §34, Architecture Governance & Documentation]`, a rule enforced by
  an executable fitness function rather than prose; mechanism (2) ([`PiiRedactor`](#piiredactor)) is a
  real, unit-tested helper. The redactor is **not auto-wired into a logging/destructuring policy**
  (verified by search: only the attribute's own doc comment, the redactor definition, and three test
  files reference it, no Serilog sink or production call site routes entities through it). So the
  `[Rubric §13]` "PII out of logs" control is *available and tested* but *opt-in per call site*, not an
  automatic, enforced pipeline stage.
- **Walkthrough**: `[AttributeUsage(AttributeTargets.Property, Inherited = false, AllowMultiple =
  false)]` (line 18); empty body (`sealed class PiiAttribute : Attribute;`, line 19). The doc comment
  (lines 14-16) adds important *judgement*: apply only to genuine data-subject PII (an account holder's
  email/name), **not** to public content that merely contains a name (for example a public conference
  speaker profile, whose erasure obligation flows through the linked user account), a nuance that
  prevents over-tagging.
- **Why it's built this way**: marking PII declaratively at the property lets both the erasure fitness
  test and [`PiiRedactor`](#piiredactor) find it automatically by reflection; the alternative
  (a hand-maintained list of which fields are personal) drifts out of sync with the model.
- **Where it's used**: applied to four properties of the Identity `User` aggregate: `Email`,
  `FirstName`, `LastName` and `AvatarUrl`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:21,25,29,94`); `User`
  implements [`IAnonymizable`](#ianonymizable) (`User.cs:18`). The detection lives **once** in the
  shared `MMCA.Common.Testing.Architecture` package: the `EntitiesWithPiiImplementAnonymizable` rule
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
  is structurally vacuous today, the framework Domain ships no data-subject type) and
  `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/PiiConventionTests.cs:3`. The framework
  closes that vacuity gap with a non-vacuous companion, `PiiErasureContractFitnessTests`
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiErasureContractFitnessTests.cs:19`),
  which forces a representative `[Pii]`-carrying sample through both halves end to end (recognized and
  masked by [`PiiRedactor`](#piiredactor), then erased idempotently via [`IAnonymizable`](#ianonymizable)).
  The **redaction** half reads `[Pii]` reflectively via
  `IsDefined(typeof(PiiAttribute), inherit: false)`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Privacy/PiiRedactor.cs:119`).

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
  itself as that transactional boundary. The doc comment (`IAggregateRoot.cs:4-7`) states the
  contract explicitly: aggregates are the only entities that can raise domain events and they define
  the transactional consistency boundary; the infrastructure layer (`ApplicationDbContext`) uses this
  interface to discover pending events across all tracked aggregates during `SaveChangesAsync`, the
  hook that feeds the [outbox pattern](group-04-events-outbox.md#outboxmessage) (ADR-003).
- **Walkthrough**: three members (`IAggregateRoot.cs:12-19`):
  `IReadOnlyCollection<IDomainEvent> DomainEvents { get; }`, the pending event queue (read-only
  from outside); `void AddDomainEvent(IDomainEvent)`, called by the aggregate's own methods to
  record that something happened; `void ClearDomainEvents()`, called by infrastructure after the
  events have been dispatched. `[Rubric §8, Data Architecture]` (SaveChanges flow):
  the sequence is aggregate mutates state → calls `AddDomainEvent` → EF saves data + serializes
  events to the outbox in the same DB transaction → `ClearDomainEvents()` → dispatcher dispatches
  in-process copies (for immediate reactions that do not need the outbox).
- **Why it's built this way**: keeping the event queue behind a read-only collection plus
  explicit add/clear methods means only the aggregate's own behavior can raise events and only
  infrastructure can clear them after a successful save, preserving the at-least-once outbox
  contract (ADR-003).
- **Where it's used**: implemented by
  [`AuditableAggregateRootEntity<TIdentifierType>`](#auditableaggregaterootentitytidentifiertype),
  which adds the backing list and the `AddDomainEvent`/`ClearDomainEvents` implementations;
  every aggregate in both apps inherits from that. Discovered by the
  [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor)
  during persistence.

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
  storage-side erasure: together they are the two halves of the §30/ADR-005 story (`[Pii]` says *what*
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
  data through one named gate makes the redaction policy auditable in one place (ADR-005).
- **Where it's used**: unit-verified by `PiiRedactorTests`
  (`MMCA.Common/Tests/Core/MMCA.Common.Domain.Tests/Privacy/PiiRedactorTests.cs`, G25) and exercised
  end to end (composed with [`IAnonymizable`](#ianonymizable)) by `PiiErasureContractFitnessTests`
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiErasureContractFitnessTests.cs:19`).
  No production logging call site routes entities through it, so it is a *ready, tested* control
  rather than an automatic one (see the caveat on [`PiiAttribute`](#piiattribute)).
- **Caveats / not-in-source**: redaction is **shallow** (one level), as the remarks state
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
  request (`IAnonymizable.cs:11-13`). `IAnonymizable` provides the erasure path: an application-layer
  erasure handler loads the aggregate, calls `Anonymize()`, and saves, overwriting PII fields with
  non-identifying placeholders **in place** rather than hard-deleting (lines 13-15). The row stays (FKs
  and audit trail intact); the person's data is gone. This is the second half of the
  [`PiiAttribute`](#piiattribute) story (ADR-005): `[Pii]` marks *what* is PII; `IAnonymizable` defines
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
  application handler, and the `[Pii] ⇒ IAnonymizable` fitness rule guarantees no PII-holding entity
  silently lacks an erasure path (ADR-005).
- **Where it's used**: implemented by `User` in the ADC Identity module (which holds the `[Pii]` fields
  `Email`/`FirstName`/`LastName`/`AvatarUrl`,
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:18,21,25,29,94`); called by
  the application-layer erasure handler, enforced by `PiiConventionTests` (G25), and exercised together
  with [`PiiRedactor`](#piiredactor) by `PiiErasureContractFitnessTests`
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PiiErasureContractFitnessTests.cs:19`).

### ValueObject
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/ValueObject.cs:8` · Level 0 · record

- **What it is**: the abstract base for all value objects, declared as a single line:
  `public abstract record ValueObject;` (`ValueObject.cs:8`).
- **Depends on**: nothing first-party.
- **Concept introduced, the Value Object.** `[Rubric §4, Domain-Driven Design]` (assesses whether
  the model mirrors the business, aggregates, value objects, ubiquitous language, immutability). A
  **value object** models a concept with **no identity**: two `Money(10, USD)` instances are equal
  because their *values* are equal, not because they're the same row. By inheriting from `record`,
  every value object gets compiler-generated **structural equality** (`Equals`/`GetHashCode` over all
  declared properties) and immutability for free, the design rationale is stated in the doc comment
  (`ValueObject.cs:3-7`). This is the cheapest possible base: it adds a *type* (so code can say
  "this is a value object" and architecture tests can assert rules about them) without adding members.
- **Walkthrough**: there are no members. The whole contract is "be a record, be abstract, be named
  `ValueObject`". The work happens in derived types.
- **Why it's built this way**: using C#'s `record` for value-object semantics avoids hand-writing
  equality (a classic DDD chore and bug source). The base type exists so the *family* is nameable and
  enforceable, not for shared behavior.
- **Where it's used**: base of [`Address`](#address), [`Money`](#money), [`Email`](#email),
  [`Currency`](#currency), [`DateRange`](#daterange), [`DateTimeRange`](#datetimerange),
  [`PhoneNumber`](#phonenumber), each adds a factory method returning
  [`Result<T>`](group-01-result-error-handling.md#result) so an invalid value object can't be
  constructed.
- **Caveats / not-in-source**: equality is purely structural; if a future value object holds a
  mutable collection, record equality would compare references, not contents. None of the current
  value objects do.

### BaseEntity<TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Entities` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/BaseEntity.cs:14` · Level 1 · class (abstract)

- **What it is**: the concrete base class for every domain entity: implements
  [`IBaseEntity<TIdentifierType>`](#ibaseentitytidentifiertype) with a `required init Id`.
- **Depends on**: [`IBaseEntity<TIdentifierType>`](#ibaseentitytidentifiertype) (Level 0).
- **Concept introduced, entity base class + EF Core materialisation pattern.** `[Rubric §4, DDD]`
  (entities with clear identity). The doc comment (`BaseEntity.cs:5-13`) explains the two-path
  design: application code calls a static factory method (which sets `Id` explicitly), while EF
  Core materialises existing rows through the parameterless constructor and then sets `Id` via the
  `init` accessor. Because `init` is only callable during object initialization, `Id` is immutable
  after construction regardless of which path is used. `[Rubric §8, Data Architecture]` (deliberate
  key-generation strategy): whether the id is DB-generated or app-assigned is declared on the
  entity with [`IdValueGeneratedAttribute`](#idvaluegeneratedattribute) and read by
  [`EntityTypeExtensions.IsIdValueGenerated`](#entitytypeextensions), `BaseEntity` itself is
  neutral on this.
- **Walkthrough**: a single line: `public required TIdentifierType Id { get; init; }`
  (`BaseEntity.cs:17`). Everything else is inherited or added in subclasses.
- **Why it's built this way**: `required` means a factory method cannot accidentally skip setting
  `Id`; the `where TIdentifierType : notnull` constraint (`BaseEntity.cs:15`) prevents nullable id
  types. The class is `abstract` so it cannot be instantiated directly. `TIdentifierType` is bound
  per-entity to a strongly-typed alias (`OrderIdentifierType = int`, named in the doc comment), see
  the identifier-alias convention in the [primer](00-primer.md#2-architectural-styles-this-codebase-commits-to).
- **Where it's used**: base of [`AuditableBaseEntity<TIdentifierType>`](#auditablebaseentitytidentifiertype)
  → [`AuditableAggregateRootEntity<TIdentifierType>`](#auditableaggregaterootentitytidentifiertype);
  every entity in both apps ultimately inherits from this.

### EntityTypeExtensions
> MMCA.Common.Domain · `MMCA.Common.Domain.Extensions` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Extensions/EntityTypeExtensions.cs:9` · Level 1 · class (static, extension block)

- **What it is**: adds a single computed property `IsIdValueGenerated` to `System.Type`, reading
  the presence of [`IdValueGeneratedAttribute`](#idvaluegeneratedattribute) via reflection.
- **Depends on**: [`IdValueGeneratedAttribute`](#idvaluegeneratedattribute) (Level 0).
- **Concept, C# `extension(T)` syntax** (taught in the [primer](00-primer.md#c-extensiont-types--read-this-once)).
  The `extension(Type entityType)` block at `EntityTypeExtensions.cs:11` means any `Type` instance can
  call `.IsIdValueGenerated` without inheriting from or being wrapped by anything:
  `typeof(MyEntity).IsIdValueGenerated`. The implementation (`EntityTypeExtensions.cs:19`):
  `entityType.GetCustomAttribute<IdValueGeneratedAttribute>() is not null`, a single reflection
  call, cached by factory methods in practice. `[Rubric §8, Data Architecture]` (deliberate
  key-generation strategy declared at the entity level, not scattered in configuration).
- **Where it's used**: entity factory methods call `typeof(TEntity).IsIdValueGenerated` to decide
  whether to assign `default` for `Id` (letting the DB generate it) or an explicit value; EF
  entity configurations also use it.

### Address
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Address.cs:16` · Level 3 · record (sealed)

- **What it is**: an immutable value object for a postal address. `AddressLine1` is required;
  the remaining five fields (`AddressLine2`, `City`, `State`, `ZipCode`, `Country`) are optional
  to accommodate international formats.
- **Depends on**: [`AddressInvariants`](#addressinvariants) (mutual, see the cycle note below),
  [`Result`](group-01-result-error-handling.md#result), [`ValueObject`](#valueobject).
- **Concept introduced, the value-object factory method returning `Result<T>`.** `[Rubric §4,
  Domain-Driven Design]` (assesses value objects with enforced invariants) and `[Rubric §15,
  Best Practices & Code Quality]` (assesses "unconstructable invalid state"). The key pattern:
  the constructor is `private` (`Address.cs:43`), preventing ad-hoc instantiation. The only public
  entry point is a `static Result<Address> Create(…)` factory method (`Address.cs:69-89`). If the
  invariants pass, `Create` returns `Result.Success(new Address(…))`; if they fail, it returns a
  `Result.Failure`. This makes an *invalid `Address` unconstructable*, you cannot bypass validation
  with `new Address(…)` from outside the class. The `[JsonConstructor]` on the private ctor
  (`Address.cs:42`) is the one exception: `System.Text.Json` is permitted to round-trip the object
  from serialized form (where the fields are already validated). `[DataContract]`/`[DataMember(Order = …)]`
  tags (`Address.cs:15-40`) pin the wire shape and serialization order, making the contract stable.
- **Documented cycle, `Address` ↔ `AddressInvariants`.** Both types are Level 3 in the same SCC
  (strongly connected component). `Address.Create` calls `AddressInvariants.EnsureAddressLine1IsValid`,
  while `AddressInvariants.EnsureAddressIsValid` accepts an `Address?` parameter. This is deliberate:
  the invariant helper is the canonical place for constraints (max-length constants, error codes)
  while the value object owns construction. Because both reference the other, the leveling algorithm
  assigns them the same level rather than an impossible ordering. `[Rubric §2, Design Patterns]`
  (mutual delegation is fine here; neither owns the other's core identity).
- **Walkthrough**
  - `Create` (`Address.cs:69`): calls `Result.Combine(AddressInvariants.EnsureAddressLine1IsValid(…))`
    (`Address.cs:77-78`); on failure re-wraps the errors as `Result.Failure<Address>`. Only
    `AddressLine1` is validated at the value-object level; the other fields are length-checked by the
    FluentValidation rules in higher tiers.
  - `ToString()` (`Address.cs:93`): joins the non-empty parts with `, ` via LINQ, producing a
    human-readable address string.
- **Why it's built this way**: EF stores `Address` as an *owned type* via `OwnsOne` (noted in the
  doc comment, `Address.cs:13`). Owned types have value semantics at the persistence level, they
  share the parent entity's row. The private constructor prevents accidental `new Address()` from EF
  materializers; the `[JsonConstructor]` provides a sanctioned JSON path.
- **Where it's used**: applied to entity properties carrying a postal address; `Create` is called
  from domain aggregate factories. `AddressInvariants` constants drive EF column max-lengths and the
  [`AddressLine1Rules<T>`](group-06-validation.md#addressline1rulest) family of FluentValidation rules
  (consumed in turn by [`AddressValidator`](group-06-validation.md#addressvalidator)). Carried by
  [`RegisterRequest`](group-08-auth.md#registerrequest).

### AddressInvariants
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/AddressInvariants.cs:9` · Level 3 · class (static)

- **What it is**: a static helper that holds the address field **max-length constants** (shared by
  EF configurations and FluentValidation validators) and two invariant-check methods that return
  [`Result`](group-01-result-error-handling.md#result).
- **Depends on**: [`Address`](#address) (mutual cycle, same SCC),
  [`Error`](group-01-result-error-handling.md#error), [`Result`](group-01-result-error-handling.md#result).
- **Concept introduced, the shared-constants invariant class.** `[Rubric §16, Maintainability
  & Evolvability]` (a single place to change a constraint). `AddressLine1MaxLength = 200`
  (`AddressInvariants.cs:12`) is a `static readonly int` that EF entity configurations,
  FluentValidation rules, and this invariant all read from. Change it in one place and every layer
  picks it up. This is the pattern repeated for every value type: the invariant class is the *single
  source of truth* for both the constraint value and the error shape. Six max-length constants are
  declared (`AddressInvariants.cs:12-27`), one per address field.
- **Walkthrough**
  - `EnsureAddressLine1IsValid(string addressLine1, string source)` (`AddressInvariants.cs:50`):
    checks `string.IsNullOrWhiteSpace`; on failure returns `Error.Invariant("Address.Line1.Empty", …)`
    with the caller's method name as `source` for stack-free tracing.
  - `EnsureAddressIsValid(Address? address, string source)` (`AddressInvariants.cs:35`): allows
    `null` (address is optional on many entities) and otherwise delegates to
    `EnsureAddressLine1IsValid`.
- **Why it's built this way**: separating the constants from the value object means EF
  configurations can reference `AddressInvariants.AddressLine1MaxLength` without referencing
  `Address` itself, keeping Infrastructure's dependency on Shared lightweight.
- **Where it's used**: called inside `Address.Create`; max-length constants referenced by EF
  `EntityTypeConfiguration` classes (Infrastructure) and the
  [`AddressLine1Rules<T>`](group-06-validation.md#addressline1rulest) family (Application).

### AuditableBaseEntity<TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Entities` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:13` · Level 3 · class (abstract)

- **What it is**: the second level of the entity hierarchy: extends
  [`BaseEntity<TIdentifierType>`](#baseentitytidentifiertype) with **soft-delete**, **audit
  tracking**, and **optimistic concurrency**. Every domain entity in both apps inherits (transitively)
  from this class.
- **Depends on**: [`BaseEntity<TIdentifierType>`](#baseentitytidentifiertype),
  [`Error`](group-01-result-error-handling.md#error), [`IAuditableEntity`](#iauditableentity),
  [`Result`](group-01-result-error-handling.md#result).
- **Concept introduced, private setters on audit properties stamped via EF reflection.**
  `[Rubric §8, Data Architecture]` (assesses audit fields stamped centrally, not per-handler) and
  `[Rubric §3, Clean Architecture]` (the domain never sets its own audit fields, infrastructure
  does). `CreatedOn`, `CreatedBy`, `LastModifiedOn`, `LastModifiedBy` (`AuditableBaseEntity.cs:25-31`)
  all have `private set`, the domain *reads* them but does not write them. The doc comment
  (`AuditableBaseEntity.cs:8-10`) explains the mechanism: EF Core's `SaveChangesAsync` override
  accesses these via `entry.Property(…).CurrentValue` reflection, bypassing setter visibility. The
  `#pragma warning disable S1144, CA1819` (`AuditableBaseEntity.cs:24`) suppresses "private setter
  unused" and "return array from property" analyzer warnings that would otherwise fire, scoped and
  justified inline. `[Rubric §10, Cross-Cutting Concerns]` (centralized stamping eliminates
  per-handler boilerplate).
- **Walkthrough**
  - `IsDeleted` (`AuditableBaseEntity.cs:20`): `virtual bool`, `private set`, soft-delete flag.
    `virtual` so EF lazy-load proxies and test subclasses can override.
  - `RowVersion` (`AuditableBaseEntity.cs:39`): `byte[]`, `private set`, initialized to `[]`. EF maps
    this as a `[Timestamp]`/SQL Server `rowversion` column. Its presence in `UPDATE`/`DELETE` WHERE
    clauses is what makes optimistic concurrency automatic, if another writer changed the row between
    read and save, EF throws `DbUpdateConcurrencyException`.
  - `Delete()` (`AuditableBaseEntity.cs:47`): `virtual Result`, checks `IsDeleted` first (idempotency
    guard), returning `Error.AlreadyDeleted` if so; otherwise sets it to `true` and returns
    `Result.Success()`. Returning `Result` instead of `void` lets callers propagate the "already
    deleted" failure through the standard error flow.
  - `Undelete()` (`AuditableBaseEntity.cs:67`): `protected` (only callable by derived classes that
    deliberately support reactivation, BR-135 in the ADC spec). Mirrors `Delete()`'s pattern: guard
    (`Error.Invariant("Entity.NotDeleted", …)`) → mutate → return `Result`.
- **Why it's built this way**: three concerns (identity, audit, concurrency) are layered as separate
  base classes so each can be tested and evolved independently.
  [`AuditableAggregateRootEntity<TIdentifierType>`](#auditableaggregaterootentitytidentifiertype)
  (Level 4) adds domain-event collection on top.
- **Where it's used**: every entity in Conference, Engagement, Identity, Notification inherits from
  [`AuditableAggregateRootEntity<TIdentifierType>`](#auditableaggregaterootentitytidentifiertype),
  which inherits from this. Used directly by child entities (non-aggregate-root entities that need
  audit but don't raise events).

### Currency
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Currency.cs:14` · Level 3 · record (sealed)

- **What it is**: an ISO 4217 currency value object using a **closed set** pattern: only
  `Currency.Usd` and `Currency.Eur` are public instances; the constructor is private. `None` is an
  internal sentinel for [`Money.Zero()`](#money).
- **Depends on**: [`CurrencyJsonConverter`](#currencyjsonconverter) (mutual cycle),
  [`Error`](group-01-result-error-handling.md#error), [`Result`](group-01-result-error-handling.md#result),
  [`ValueObject`](#valueobject).
- **Documented cycle, `Currency` ↔ `CurrencyJsonConverter`.** Both are defined in the same file
  (`Currency.cs:14` and `:65`). `Currency` carries `[JsonConverter(typeof(CurrencyJsonConverter))]`
  (`Currency.cs:13`), while `CurrencyJsonConverter.Read` calls `Currency.FromCode`. Because of the
  mutual reference both are assigned Level 3.
- **Concept introduced, the closed-set (type-safe enum) pattern for value objects.** `[Rubric §4,
  DDD]` (eliminates primitive obsession for currency codes). Rather than passing a raw `string "USD"`
  around, all code uses `Currency.Usd`, a statically typed singleton. New currencies are added by
  adding a field to `All` (`Currency.cs:54`). `FromCode` validates at the boundary; once inside the
  domain you always hold a known-valid `Currency`.
- **Walkthrough**
  - `EmptyCurrency` / `InvalidCurrency` (`Currency.cs:17,20`): pre-constructed `Error` singletons for
    the two failure paths, so `FromCode` doesn't allocate a new error on each bad call.
  - `None` (`Currency.cs:23`): an `internal` empty-code sentinel used only by `Money` as an additive
    identity, never exposed to API consumers.
  - `FromCode(string code)` (`Currency.cs:41`): empty-guard, then a case-insensitive linear scan over
    `All`; on success returns the *singleton* (no allocation, `Currency.Usd` is the same object every
    time).
  - `All` (`Currency.cs:54`): `IReadOnlyCollection<Currency>`, the extension point for adding
    currencies.
- **Why it's built this way**: pre-constructing the singleton instances avoids per-call allocation
  and makes equality comparison trivial (reference equality). The closed set enforces that unknown
  codes can never appear as `Currency` values inside the domain.
- **Where it's used**: [`Money`](#money) holds a `Currency`; `CurrencyJsonConverter` serializes it
  for API responses; the API-layer
  [`CurrencyJsonConverter`](group-12-api-hosting-mapping.md#currencyjsonconverter) (Level 4) registers
  the converter globally.

### CurrencyJsonConverter
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Currency.cs:65` · Level 3 · class (sealed)

- **What it is**: a `JsonConverter<Currency>` that serializes [`Currency`](#currency) as its ISO code
  string and deserializes via `Currency.FromCode`.
- **Depends on**: [`Currency`](#currency) (mutual cycle, see above).
- **Concept reinforced, converter-per-value-object.** `[Rubric §9, API & Contract Design]`
  (assesses consistent, stable serialization). Registering the converter on the record type itself
  (via the `[JsonConverter]` attribute on `Currency`) means it applies automatically wherever
  `Currency` appears in a response, no per-controller configuration needed.
- **Walkthrough**
  - `Read` (`Currency.cs:68`): reads the code string (returns `null` if the JSON token is null),
    calls `Currency.FromCode`; on failure throws `JsonException` (the correct boundary behavior,
    invalid JSON input is a deserialization error, not a domain `Result.Failure`).
  - `Write` (`Currency.cs:82`): `writer.WriteStringValue(value.Code)`, the wire shape is just the
    three-letter string.
- **Where it's used**: registered automatically via the `[JsonConverter]` attribute on `Currency`;
  the [`CurrencyJsonConverter`](group-12-api-hosting-mapping.md#currencyjsonconverter) wrapper in
  `MMCA.Common.API` (Level 4) registers the same converter with `JsonOptions` globally.
- **Caveats / not-in-source**: the converter has no version sentinel; if the closed code set
  changes, deserializing an old code from a stored document (e.g. a stale cache) will throw
  `JsonException`.

### DateRange
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/DateRange.cs:9` · Level 3 · record (sealed)

- **What it is**: an immutable value object for a date-only range (`DateOnly Start`, `DateOnly End`),
  inclusive on both ends, with the invariant that `End ≥ Start`.
- **Depends on**: [`Error`](group-01-result-error-handling.md#error),
  [`Result`](group-01-result-error-handling.md#result), [`ValueObject`](#valueobject).
- **Concept reinforced, lightweight single-invariant factory.** `[Rubric §4, DDD]` (temporal
  ranges are domain concepts, not raw pairs of `DateTime`). Compare `DateRange` to [`Address`](#address):
  `Address.Create` delegates to `AddressInvariants`; `DateRange.Create` (`DateRange.cs:30`) enforces
  the single `end < start` rule inline, no separate invariant class is needed when there is only one
  constraint.
- **Walkthrough**
  - `Create(DateOnly start, DateOnly end)` (`DateRange.cs:30`): a one-liner conditional expression.
    Failure uses `Error.Validation` (not `Error.Invariant`) because the caller passes raw
    user-supplied dates, this is a *validation* problem, not a corrupted-state invariant.
  - `LengthInDays` (`DateRange.cs:38`): `End.DayNumber - Start.DayNumber`, `DayNumber` avoids
    `TimeSpan` arithmetic on `DateOnly`.
  - `Overlaps(DateRange other)` (`DateRange.cs:46`): half-open interval logic (`Start < other.End &&
    End > other.Start`), null-guarded, the standard range-overlap formula, documented in the method
    comment.
  - `Contains(DateOnly instant)` (`DateRange.cs:55`): inclusive check.
  - `Deconstruct` (`DateRange.cs:61`): lets callers use `var (start, end) = dateRange`.
- **Why it's built this way**: `DateOnly` (not `DateTime`) signals that the concept is purely
  date-level; using a value object instead of a bare pair prevents accidentally swapping `start` and
  `end` at call sites.
- **Where it's used**: event date ranges in the ADC Conference module (validated through
  FluentValidation `EventDateRangeRules`).

### DateTimeRange
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/DateTimeRange.cs:10` · Level 3 · record (sealed)

- **What it is**: the `DateTime`-precision sibling of [`DateRange`](#daterange); carries
  `DateTime Start` and `DateTime End`.
- **Depends on**: [`Error`](group-01-result-error-handling.md#error),
  [`Result`](group-01-result-error-handling.md#result), [`ValueObject`](#valueobject).
- **Concept**: the same factory/invariant pattern as [`DateRange`](#daterange). The difference is
  `Duration` (`DateTimeRange.cs:39`) returns a `TimeSpan` instead of an integer day count. The
  structural shape is otherwise identical; this section cross-references rather than repeating.
- **Walkthrough**: `Create(DateTime start, DateTime end)` (`DateTimeRange.cs:31`) uses the same
  conditional-expression pattern (`Error.Validation` on `end < start`); `Overlaps`/`Contains`/
  `Deconstruct` (`DateTimeRange.cs:46/55/61`) mirror `DateRange` exactly.
- **Where it's used**: session time slots and room scheduling windows in the Conference module.

### EmailInvariants
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/EmailInvariants.cs:10` · Level 3 · class (static, partial)

- **What it is**: invariant checks for email addresses: not-empty, max-length (256), and format via
  a `[GeneratedRegex]` method.
- **Depends on**: [`Error`](group-01-result-error-handling.md#error),
  [`Result`](group-01-result-error-handling.md#result).
- **Concept introduced, `[GeneratedRegex]` for performance.** `[Rubric §12, Performance &
  Scalability]` (assesses avoiding allocations and per-call regex compilation). The `partial`
  class/property pair (`EmailInvariants.cs:10,54-55`) lets the C# source generator bake a pre-compiled
  `Regex` instance at compile time, with a hard `matchTimeoutMilliseconds: 1000` to prevent
  catastrophic backtracking. No `new Regex(…)` at runtime. The pattern (`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
  is "practical" rather than full RFC-5322, the doc comment (`EmailInvariants.cs:17`) is honest about
  this.
- **Walkthrough**: `EnsureEmailIsValid(string email, string source)` (`EmailInvariants.cs:22`):
  three sequential guards, empty, length, format, each returning a distinct `Error.Invariant` whose
  code encodes the failure sub-type (`"Email.Empty"`, `"Email.TooLong"`, `"Email.InvalidFormat"`).
  Using `Error.Invariant` (not `Error.Validation`) signals these are domain-level data-integrity
  requirements, not user-input validations.
- **Why it's built this way**: the same `MaxLength = 256` constant (`EmailInvariants.cs:13`) is
  referenced by EF `HasMaxLength` calls, keeping the schema and the invariant in sync.
- **Where it's used**: called from [`Email.Create`](#email) (Level 4) and the FluentValidation email
  rule helpers (Application).

### PhoneNumberInvariants
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/PhoneNumberInvariants.cs:10` · Level 3 · class (static, partial)

- **What it is**: invariant checks for phone numbers: not-empty, length range (7–20 chars), and
  format via `[GeneratedRegex]` (`^[\d\s\-\(\)\+]+$`).
- **Depends on**: [`Error`](group-01-result-error-handling.md#error),
  [`Result`](group-01-result-error-handling.md#result).
- **Concept**: the same `[GeneratedRegex]` pattern as [`EmailInvariants`](#emailinvariants); the
  guard sequence checks empty → length → format (`PhoneNumberInvariants.cs:25` onwards), and it
  validates against the *trimmed* string (`PhoneNumberInvariants.cs:36`). `MinLength = 7` and
  `MaxLength = 20` (`PhoneNumberInvariants.cs:13,16`) are the shared constants used by EF and
  FluentValidation.
- **Where it's used**: called from [`PhoneNumber.Create`](#phonenumber) (Level 4).

### AuditableAggregateRootEntity<TIdentifierType>
> MMCA.Common.Domain · `MMCA.Common.Domain.Entities` · `MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableAggregateRootEntity.cs:13` · Level 4 · class (abstract)

- **What it is**: the base class for **aggregate roots**: entities that own a consistency boundary,
  collect domain events, and control child-collection mutation. Extends
  [`AuditableBaseEntity<TIdentifierType>`](#auditablebaseentitytidentifiertype) with a private
  `_domainEvents` list, `SetItems<TChildEntity>`, and `GetChildOrNotFound`.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](#auditablebaseentitytidentifiertype)
  (Level 3); [`Error`](group-01-result-error-handling.md#error) (Level 1);
  [`IAggregateRoot`](#iaggregateroot) (Level 1); [`IAuditableEntity`](#iauditableentity) (Level 0);
  [`IDomainEvent`](group-04-events-outbox.md#idomainevent) (Level 0);
  [`Result`](group-01-result-error-handling.md#result) (Level 2).
- **Concept introduced, the aggregate root pattern.** `[Rubric §4, Domain-Driven Design]` (assesses
  aggregates as consistency boundaries that own child entities and raise domain events). An
  **aggregate root** is the sole entry point to a cluster of related entities: only the root exposes
  mutation methods; outsiders cannot reach children directly. In DDD terms the root *protects the
  invariants of the whole cluster*. This class embodies three aggregate responsibilities:
  1. **Domain event collection** (`AddDomainEvent` / `ClearDomainEvents`,
     `AuditableAggregateRootEntity.cs:24,34`), the aggregate records side-effects as `IDomainEvent`
     objects; they are dispatched by the infrastructure after a successful `SaveChangesAsync`, not
     during the domain operation itself. This is the "domain events transact with the aggregate"
     design from ADR-003.
  2. **Child collection mutation** (`SetItems<TChildEntity>`, `AuditableAggregateRootEntity.cs:44`),
     replaces an entire child list atomically, calling the `ValidateSetItems` hook (line 69, virtual,
     no-op by default) so subclasses can enforce business rules *before* the mutation occurs (e.g.,
     preventing removal of fulfilled order lines).
  3. **Child lookup** (`GetChildOrNotFound<TChild, TChildId>`, `AuditableAggregateRootEntity.cs:87`),
     searches the in-memory collection for an active (non-soft-deleted) child by id, returning
     `Result<TChild>` rather than throwing.
  `[Rubric §6, CQRS & Event-Driven]` (domain events raised at the aggregate level, dispatched after
  successful persistence).
- **Walkthrough**
  - `private readonly List<IDomainEvent> _domainEvents` (`AuditableAggregateRootEntity.cs:16`): the
    in-memory accumulator. `IReadOnlyCollection<IDomainEvent> DomainEvents` (line 18) exposes it
    read-only so infrastructure can drain it but handlers cannot add events through the property.
  - `AddDomainEvent(IDomainEvent domainEvent)` (`AuditableAggregateRootEntity.cs:24`): null-guards and
    appends. Called by entity factory and mutation methods inside the aggregate.
  - `ClearDomainEvents()` (`AuditableAggregateRootEntity.cs:34`): called by `ApplicationDbContext`
    after dispatching, prevents re-dispatch if a second save occurs.
  - `SetItems<TChildEntity>(List<TChildEntity> collection, IEnumerable<TChildEntity> items)`
    (`AuditableAggregateRootEntity.cs:44`): materializes `items` once (avoiding double enumeration via
    `items as IList<…> ?? [.. items]`), calls `ValidateSetItems`, then `Clear()` + `AddRange()`. The
    EF-tracked list reference (`collection`) is *never replaced*, only mutated, EF change tracking
    requires the original list reference to detect adds/removes.
  - `ValidateSetItems<TChildEntity>` (`AuditableAggregateRootEntity.cs:69`): protected virtual, empty
    by default; override in aggregates that have rules about child-collection shape.
  - `GetChildOrNotFound<TChild, TChildId>` (`AuditableAggregateRootEntity.cs:87`): `FirstOrDefault`
    against the in-memory collection checking `Id.Equals(childId) && !c.IsDeleted`; returns
    `Error.NotFound` (with source and target set) when missing.
- **Why it's built this way**: ADR-003 (outbox + in-process dispatch) requires domain events to
  "ride along" with the entity in memory and be captured during `SaveChangesAsync`; the collection
  lives on the root because it is the consistency boundary. `SetItems` + `ValidateSetItems` gives a
  single protected-hook mutation path, avoiding scattered collection-manipulation logic in handlers.
- **Where it's used**: base class for every domain aggregate root in both ADC and Store (the ADC
  `Event`, `Session`, `Speaker`, `ConferenceCategory`, `User`, `UserSessionBookmark`, and
  notification entities all extend it).

### Email
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Email.cs:13` · Level 4 · record (sealed)

- **What it is**: a validated, normalized value object for email addresses. Construction always goes
  through `Create`, which rejects invalid formats and normalizes to lowercase; the private constructor
  is JSON-only.
- **Depends on**: [`ValueObject`](#valueobject) (Level 0); [`EmailInvariants`](#emailinvariants)
  (Level 3); [`Result<T>`](group-01-result-error-handling.md#result) (Level 2).
- **Concept introduced, value-object factory + implicit conversion.** `[Rubric §4, Domain-Driven
  Design]` (assesses rich value objects with invariant-protected construction). The pattern combines
  three ideas: (1) the private `[JsonConstructor]`-tagged constructor (`Email.cs:19-20`) prevents
  accidental construction outside JSON deserialization; (2) the static `Create` factory validates and
  normalizes, returning `Result<Email>` rather than throwing; (3) `public static implicit operator
  string(Email email)` (`Email.cs:42`) lets the value object drop in where a plain string is expected
  without an explicit cast, a backward-compatibility bridge. The `#pragma warning disable CA1308`
  around `ToLowerInvariant` (`Email.cs:35-37`) is justified inline ("Email addresses are
  conventionally lowercase per RFC 5321"), a scoped, explained suppression. `[Rubric §15, Best
  Practices & Code Quality]` (justified suppressions, no blanket disables).
- **Walkthrough**
  - `Value` (`Email.cs:17`): `string`, getter-only, the normalized address; `[DataMember(Order = 1)]`
    controls the wire-format order.
  - `Create(string value)` (`Email.cs:27`): trims whitespace (null-safe via `value?.Trim() ??
    string.Empty`), calls `EmailInvariants.EnsureEmailIsValid`, then converts to lowercase-invariant
    on success.
  - `implicit operator string` (`Email.cs:42`): enables `string s = email;` without a cast.
  - `ToString()` (`Email.cs:45`): delegates to `Value`. The EF doc comment (`Email.cs:8-10`) notes
    `HasConversion` (not `OwnsOne`), so the column stays a flat `nvarchar`, no nested owned-type
    table.
- **Why it's built this way**: normalizing at construction time lets the entire system compare and
  store emails case-insensitively without per-use `.ToLower()` calls.
- **Where it's used**: domain entities that carry an email field;
  [`RegisterRequest`](group-08-auth.md#registerrequest) includes a raw `string Email` that gets
  converted to an `Email` value object inside the domain factory. `[Rubric §9, API & Contract
  Design]` (normalized shapes crossing layers).

### Money
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Money.cs:18` · Level 4 · record (sealed)

- **What it is**: a value object pairing a `decimal Amount` with a [`Currency`](#currency), with
  arithmetic operators, a safe `Add` method, and `Currency.None` as a zero-accumulator sentinel.
- **Depends on**: [`ValueObject`](#valueobject) (Level 0); [`Currency`](#currency) (Level 3);
  [`Error`](group-01-result-error-handling.md#error) (Level 1);
  [`Result<T>`](group-01-result-error-handling.md#result) (Level 2).
- **Concept introduced, domain-level arithmetic on value objects.** `[Rubric §4, DDD]` (rich value
  objects encapsulate behavior, not just data). `Money` is concept-rich:
  - Two static `Error` fields (`NoCurrency`, `CurrencyMismatch`, `Money.cs:21,24`) are class-level
    constants. This is the "error as a named constant" sub-pattern: callers can compare
    `result.Errors[0] == Money.CurrencyMismatch` without string matching.
  - `operator +` (`Money.cs:68`) delegates to `Add` and *throws* `InvalidOperationException` on
    mismatch, the unsafe operator path. The doc comment (`Money.cs:61-64`) explicitly warns: "Prefer
    `Add` for Result-based error handling." This is a deliberate usability trade-off: operator syntax
    for trusted arithmetic (order-line totalling within a known currency), the Result path for
    untrusted cross-currency input.
  - `Currency.None` acts as the additive identity: `AddUnchecked` (`Money.cs:115`) preserves the other
    side's currency when one side is `None`, enabling `Zero()` as an `Enumerable.Aggregate` seed
    without knowing the target currency in advance.
  - `internal static Money CreateUnsafe` (`Money.cs:137`) is exposed to test assemblies via
    `InternalsVisibleTo`, a test-only back-door without a public loophole.
  - `[DataContract]`/`[DataMember]` and `[JsonConstructor]` (`Money.cs:17,27,31,37`) give the same
    controlled construction + serialization as `Email`.
- **Walkthrough**
  - `Create(decimal amount, Currency currency)` (`Money.cs:51`): null-guards the currency reference
    and rejects `Currency.None` (external callers must specify a real currency).
  - `operator +` (`Money.cs:68`) and `operator *` (`Money.cs:80`): conventional arithmetic
    (multiplication is by `int` quantity).
  - `Add(Money first, Money second)` (`Money.cs:91`): Result-safe addition; returns
    `CurrencyMismatch` (with source/target set) only when both sides have a real, differing currency,
    otherwise delegates to `AddUnchecked`.
  - `Zero()` / `Zero(Currency)` (`Money.cs:126,131`): static factories for accumulator seeds.
  - `IsZero()` (`Money.cs:141`) and `IsNegative` (`Money.cs:35`): convenience predicates.
- **Why it's built this way**: encapsulating arithmetic on the value object eliminates scattered
  `Amount + Amount` calls that ignore currency; the two-path design (`operator +` vs `Add`) matches
  the two callers: trusted internal sums and API-boundary input validation.
- **Where it's used**: configured as an EF `OwnsOne` in entity configurations (Store modules); the
  `Zero()` accumulator seed is used in order-total calculations; the UI formats it via
  [`MoneyExtensions`](group-15-common-ui-framework.md#moneyextensions).

### PhoneNumber
> MMCA.Common.Shared · `MMCA.Common.Shared.ValueObjects` · `MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/PhoneNumber.cs:13` · Level 4 · record (sealed)

- **What it is**: a validated, trimmed value object for phone numbers; structurally parallel to
  [`Email`](#email).
- **Depends on**: [`ValueObject`](#valueobject) (Level 0);
  [`PhoneNumberInvariants`](#phonenumberinvariants) (Level 3);
  [`Result<T>`](group-01-result-error-handling.md#result) (Level 2).
- **Concept**: the same factory + implicit-conversion pattern as [`Email`](#email). `PhoneNumber.cs:13`
  is `sealed record PhoneNumber : ValueObject`. No lowercasing (phone numbers have no case), but
  trimming applies, the validation runs on the raw string and the stored `Value` is `value.Trim()`
  (`PhoneNumber.cs:33`). The EF doc comment (`PhoneNumber.cs:8-10`) notes `HasConversion` keeps the
  column a plain `nvarchar`.
- **Walkthrough**: `Value` (getter-only, `[DataMember(Order = 1)]`), `Create(string value)`
  (`PhoneNumber.cs:27`) calling `PhoneNumberInvariants.EnsurePhoneNumberIsValid`, the implicit
  `operator string` (`PhoneNumber.cs:38`), and `ToString` (`PhoneNumber.cs:41`).
- **Where it's used**: entities with phone fields (the Identity-module `User` aggregate in Store).

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
