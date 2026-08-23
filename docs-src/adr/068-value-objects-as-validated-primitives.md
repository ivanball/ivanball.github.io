# ADR-068: Value Objects as Validated Domain Primitives

## Status
Accepted (2026-08-07).

## Context
A domain model has two kinds of small type: the **identity** of a thing, and a **value** the thing
carries. ADR-048 recorded the identity half: identifiers stay primitives named through a global-using
alias, and the strongly-typed wrapper struct was considered and rejected because an identifier crosses
EF keys, JSON payloads, OpenAPI schemas, proto messages and URLs constantly, where a wrapper buys
converters at every hop and no invariant in return.

The value half was never recorded, even though the framework ships a full set of them in
`Source/Core/MMCA.Common.Shared/ValueObjects/` and both production apps consume them. Left as bare
primitives, an email is a `string` that every caller re-validates, a price is a `decimal` whose
currency lives in a second column that nothing keeps in step, and a range is two dates with the
ordering rule restated per aggregate. These are exactly the cases a wrapper earns its cost: the type
exists to make the invariant unforgeable, not to rename a primitive.

So the workspace makes the **opposite** call for values that it makes for identifiers, and the
asymmetry is the decision worth recording.

## Decision
Model a domain value that carries an invariant as an **immutable record value object with a
`Result`-returning factory**; keep identifiers primitive (ADR-048).

- **One abstract record base, and structural equality is the whole of it.** `ValueObject` is a
  memberless `public abstract record` (`Source/Core/MMCA.Common.Shared/ValueObjects/ValueObject.cs:8`):
  no `GetEqualityComponents()` override, no hand-written `Equals`/`GetHashCode`, because the record
  compiler generates equality over the declared properties. Seven sealed types derive from it:
  `Address` (`Address.cs:16`), `Currency` (`Currency.cs:14`), `DateRange` (`DateRange.cs:9`),
  `DateTimeRange` (`DateTimeRange.cs:10`), `Email` (`Email.cs:16`), `Money` (`Money.cs:21`) and
  `PhoneNumber` (`PhoneNumber.cs:16`).
- **The constructor is private; the factory returns `Result<T>`.** `Email.Create` (`Email.cs:30`),
  `PhoneNumber.Create` (`PhoneNumber.cs:30`), `Address.Create` (`Address.cs:69`), `Money.Create`
  (`Money.cs:67`), `DateRange.Create` (`DateRange.cs:30`) and `DateTimeRange.Create`
  (`DateTimeRange.cs:31`) are the only public way to build one; `Currency` is a closed set resolved by
  `Currency.FromCode` (`Currency.cs:41`). This is ADR-013 applied below the aggregate: an invalid value
  is a failed `Result`, never an exception and never a constructed-but-wrong instance.
- **That factory shape is fitness-enforced, not conventional.** `ArchitectureRules.DomainFactoriesReturnResult`
  (`Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Entities.cs:53-79`) walks every
  concrete class in the Domain and Shared layers and fails the build when a public static `Create`
  exists with no overload returning `Result<TSelf>`, generalizing the aggregate-root rule to value
  objects (ADR-015).
- **Shared constraints live in a static `*Invariants` class beside the type.**
  `EmailInvariants.EnsureEmailIsValid` (`EmailInvariants.cs:23`),
  `PhoneNumberInvariants.EnsurePhoneNumberIsValid` (`PhoneNumberInvariants.cs:26`) and
  `AddressInvariants.EnsureAddressLine1IsValid` (`AddressInvariants.cs:50`, composed through
  `Result.Combine` at `Address.cs:77-78`) hold the checks, and the same classes own the length
  constants that EF configurations and FluentValidation validators reuse instead of restating:
  `EmailInvariants.MaxLength` (`EmailInvariants.cs:14`), the phone `MinLength`/`MaxLength` pair
  (`PhoneNumberInvariants.cs:14,17`), and the six address field lengths
  (`AddressInvariants.cs:12-27`). The split is applied **where the constraint is shared**, not
  universally: `Money`, `Currency`, `DateRange` and `DateTimeRange` keep their checks inline in the
  factory (`Money.cs:71-72`, `Currency.cs:43-49`, `DateRange.cs:31-35`, `DateTimeRange.cs:32-36`).
- **Two EF mapping shapes, chosen by whether adoption is a schema change.** A multi-field value maps as
  an **owned type**: the shipped `OwnsMoney` helper
  (`Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeBuilderExtensions.cs:51`)
  flattens `Money` into a decimal amount column plus a three-character non-unicode ISO 4217 code column
  (`:64-75`) and sets the navigation's requiredness from one parameter (`:78`). A single-string value
  maps through `HasConversion` instead, so the backing column stays a plain string column and adopting
  the value object on a property that used to be a `string` is not a migration: `EmailValueConverter`
  and `NullableEmailValueConverter`
  (`Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/EmailValueConverter.cs:33,60`),
  `PhoneNumberValueConverter` and `NullablePhoneNumberValueConverter`
  (`PhoneNumberValueConverter.cs:33,61`). Column facets stay at the call site.
- **`Currency.None` is a sentinel, and materialization never yields null.** The sentinel is
  `internal static readonly Currency None = new(string.Empty)` (`Currency.cs:23`); `Money.Zero()`
  carries it (`Money.cs:142`), `Money.Create` rejects it so an external caller must always name a real
  currency (`Money.cs:71-72`), and addition treats it as the identity element so a zero seed can
  accumulate into any currency (`Money.cs:131-137`). Because the write leg can therefore persist an
  empty code, `OwnsMoney`'s read leg falls back to the sentinel rather than a null-forgiving `.Value!`
  (`EntityTypeBuilderExtensions.cs:19,71`, contract documented at `:30-38`), and the fallback is
  regression-covered (`Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Configuration/OwnsMoneyTests.cs:106`).
- **Every serialization boundary is declared explicitly.** `Money`, `Email`, `PhoneNumber` and
  `Address` are `[DataContract]` with ordered `[DataMember]` members (`Money.cs:20,30,34`,
  `Email.cs:15,19`, `PhoneNumber.cs:15,19`, `Address.cs:15,19-40`) and each carries a private
  `[JsonConstructor]` round-trip constructor (`Money.cs:51`, `Email.cs:22`, `PhoneNumber.cs:22`,
  `Address.cs:42`) so a materializer rebuilds the value without reopening the factory; `AddAPI`
  registers both the JSON converter and the XML `DataContractSerializer` formatters
  (`Source/Presentation/MMCA.Common.API/DependencyInjection.cs:53,60`). `Currency` instead serializes
  as its bare code through a converter attached to the type itself (`Currency.cs:13,73`) with a
  matching API-layer converter (`Source/Presentation/MMCA.Common.API/JsonConverters/CurrencyJsonConverter.cs:12`),
  so non-MVC paths (cache, outbox, integration events, typed clients) fail the same way model binding
  does. `DateRange` and `DateTimeRange` carry no serialization annotations.
- **gRPC is mapped by hand, not inferred.** `Money` crosses a service boundary as a purpose-built
  `MoneyV1` message with a **string** amount (proto has no decimal) and a currency code
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Contracts/Protos/product_variants.proto:70,73`),
  translated by `MoneyFromWire`
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Contracts/ProductVariantServiceGrpcAdapter.cs:126`)
  and `MoneyToWire` (`:157`).
  `MoneyFromWire` honors the empty-code sentinel only when the amount is also zero and returns null
  for a malformed entry rather than failing the whole batch (`:135-140`).
- **Adoption is real but partial.** Store maps `ProductVariant.Price`
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/ProductVariant.cs:21`) with
  `OwnsMoney` (`.../Catalog.Infrastructure/Persistence/EntityConfiguration/ProductVariantConfiguration.cs:31`),
  and `Order.Total` (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/Order.cs:37`) is
  seeded with `Money.Zero()` (`:77`) and accumulated through `Money.Add` (`:109`), mapped
  `required: false` (`OrderConfiguration.cs:26`) alongside `OrderLine.UnitPrice`
  (`OrderLineConfiguration.cs:28`). Store Identity maps `Customer.Email` through `EmailValueConverter`
  and `Customer.Address` through a hand-rolled `OwnsOne` block (`CustomerConfiguration.cs:36,43`), and
  `User.Email` the same way (`UserConfiguration.cs:24`). ADC types `User.Email` as `Email`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:38`, validated through
  `Email.Create` at `:171` and passed to the constructor at `:185`) with
  the same converter (`.../Identity.Infrastructure/.../UserConfiguration.cs:21`) and a speaker's
  optional email through `NullableEmailValueConverter`
  (`.../Conference.Infrastructure/.../SpeakerConfiguration.cs:43`). `Money` and `Email` are the two
  that got adopted: no code under `MMCA.Store/Source` or `MMCA.ADC/Source` uses `PhoneNumber`,
  `DateRange` or `DateTimeRange`, and MMCA.Helpdesk adopts none of them at all.

## Rationale
- **The invariant belongs to the type, not to every caller.** A `string` email can be validated in one
  handler and not the next; an `Email` cannot exist unvalidated, because the only entrance is a factory
  that returns a failure instead (`Email.cs:30-41`). That is the same invariant-over-discipline posture
  the framework takes elsewhere (ADR-015), applied one level below the aggregate.
- **Amount and currency are one value, so they are one type.** Two loose columns can drift; `Money`
  makes a currency mismatch a `Result` failure at the point of arithmetic (`Money.cs:107-118`) rather
  than a silently wrong total.
- **Records give equality for free.** Value semantics ("two addresses with the same fields are the same
  address") is exactly what a positional-free `record` already generates, so the base type can be empty
  and no per-type equality code has to be reviewed for a missed field.
- **The asymmetry with ADR-048 is the point.** An identifier's only rule is uniqueness, and it crosses
  a serialization, schema or key boundary at nearly every hop, so wrapping it is pure friction. A
  domain value's rule is the reason the type exists, and it crosses those same boundaries rarely and
  through mappings worth writing once. Same mechanism, opposite verdict, because the cost/benefit
  genuinely inverts.
- **A sentinel beats null for an absent currency.** `Currency.None` keeps `Money.Zero()` usable as an
  accumulator seed and keeps every read path non-nullable; a null currency inside a materialized
  `Money` is a `NullReferenceException` waiting for the first read, which is precisely the failure
  `OwnsMoney`'s fallback exists to prevent (`EntityTypeBuilderExtensions.cs:30-38`).
- **Ship the mapping, do not repeat it.** `OwnsMoney` and the four converters put the round-trip
  contract in one reviewed place, so a new entity configuration is one call rather than a copied lambda
  pair that may or may not carry the sentinel fallback.

## Trade-offs
- **The pattern is not uniformly applied.** Only three of the seven types have a companion `*Invariants`
  class; the rest inline their checks. Only `Money` has a shipped owned-type helper, so every `Address`
  mapping is a hand-copied `OwnsOne` block of six properties
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/EntityConfiguration/CustomerConfiguration.cs:43-75`).
  Only four of the seven carry serialization annotations.
- **Three of the seven have no consumer.** `PhoneNumber`, `DateRange` and `DateTimeRange` ship with
  invariants, tests and converters but no production usage, so their round-trip behavior is exercised
  only by the framework's own tests.
- **Nothing gates that a domain value uses a value object.** The `Create`-returns-`Result` rule is
  fitness-enforced, but no rule says a new email field must be `Email` rather than `string`. MMCA.Helpdesk
  is the visible consequence: the reference app models everything on primitives.
- **Read legs trust the column.** The non-nullable converters materialize through `.Value!`
  (`EmailValueConverter.cs:41`), which is sound for anything EF wrote and unsound for a value inserted
  by a manual script or data fix; the contract is documented rather than defended
  (`EmailValueConverter.cs:24-31`).
- **The currency set is closed in code.** `Currency.All` is `USD` and `EUR` (`Currency.cs:54-58`), so
  supporting a third currency is a framework change and a release, not configuration.
- **`Money` keeps a throwing operator.** `operator +` throws `InvalidOperationException` on a currency
  mismatch (`Money.cs:84-90`), which is the one place the value objects step outside the ADR-013
  posture; `Money.Add` is the `Result`-returning path callers are steered to (`Money.cs:107`).
- **gRPC costs a hand-written mapping per value.** There is no automatic proto projection, so every
  value object that has to cross a service boundary needs its own wire message and translation pair,
  the same class of friction ADR-048 declined to pay for identifiers.

## Related
ADR-048 (the deliberate opposite call for identifiers: primitives behind aliases, wrapper structs
rejected, because identifiers cross process boundaries constantly and carry no invariant), ADR-013
(the `Result` pattern these factories implement below the aggregate level), ADR-015 (the fitness
function that enforces the `Create`-returns-`Result` shape on value objects too).
