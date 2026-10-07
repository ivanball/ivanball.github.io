# ADR-068: Value Objects as Validated Domain Primitives

## Status
Accepted (2026-08-07). Revised 2026-08-31 (`Money`'s non-validating construction paths named, `Currency`'s
converter counted among the serialization annotations, `Address` added to the adopted set, and the Store/ADC
anchors refreshed). Revised 2026-09-03: `Event.OrganizerContactEmail` became `Email?`, the third ADC
adoption site, so ADC's Domain now holds no primitive email property and matches Store on that count;
the record also notes why the validator, the length invariant and the column shape were all left
alone, following the Speaker precedent.
Revised 2026-09-25 (the shipped `OwnsAddress` helper named beside `OwnsMoney`: Store's `Customer.Address`
maps through it; the Store, ADC and `EntityTypeBuilderExtensions` anchors refreshed). As of
2026-10-01 Store follows that call with a second `OwnsOne` block that overrides the helper's unicode
facet, and the `with`-expression path around the `Money` sugar is named (see Revision below).
Revised 2026-10-06: a serialized `Money.Zero()` now JSON round-trips, because both currency converters read the empty code back as the sentinel and `Money`'s JSON read refuses that sentinel beside a non-zero amount, so the 2026-10-01 round-trip flag is resolved; anchors refreshed.

## Context
A domain model has two kinds of small type: the **identity** of a thing, and a **value** the thing
carries. ADR-048 recorded the identity half: identifiers stay primitives named through a global-using
alias, and the strongly-typed wrapper struct was considered and rejected because an identifier crosses
EF keys, JSON payloads, OpenAPI schemas, proto messages and URLs constantly, where a wrapper buys
converters at every hop and no invariant in return. ADR-115 later added the wrapper struct as an
opt-in framework capability (its JSON converter factory is registered in `AddAPI` at
`Source/Presentation/MMCA.Common.API/DependencyInjection.cs:65`) while keeping the aliases the
default, so ADR-048's verdict still governs identifiers unless a team opts in.

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
  `Address` (`Address.cs:16`), `Currency` (`Currency.cs:16`), `DateRange` (`DateRange.cs:9`),
  `DateTimeRange` (`DateTimeRange.cs:10`), `Email` (`Email.cs:16`), `Money` (`Money.cs:22`) and
  `PhoneNumber` (`PhoneNumber.cs:16`).
- **The constructor is private; the factory returns `Result<T>`.** `Email.Create` (`Email.cs:30`),
  `PhoneNumber.Create` (`PhoneNumber.cs:30`), `Address.Create` (`Address.cs:69`), `Money.Create`
  (`Money.cs:85`), `DateRange.Create` (`DateRange.cs:30`) and `DateTimeRange.Create`
  (`DateTimeRange.cs:31`) are the **validating entrance**, and for `Email`, `PhoneNumber`, `Address`,
  `DateRange` and `DateTimeRange` they are also the only public entrance at all; `Currency` is a closed
  set resolved by `Currency.FromCode` (`Currency.cs:43`). This is ADR-013 applied below the aggregate: an
  invalid value is a failed `Result`, never an exception and never a constructed-but-wrong instance.
  `Money` is the exception, deliberately: it also exposes construction sugar that composes
  already-valid parts and so skips `Create` entirely, `Money.Zero()` (`Money.cs:160`), `Money.Zero(Currency)`
  (`:165`), `operator *` (`:114-115`) and `Multiply` (`:142`). The fitness rule below governs the `Create` name
  only and says so in its own contract (`ArchitectureRules.Entities.cs:49-51`), so nothing stops a value
  object from shipping such a path. The sugar itself takes no raw string, and the `None` sentinel is
  `internal` (`Currency.cs:25`), but that does not make `Currency` sealed against unchecked values:
  `Currency.Code` (`Currency.cs:36`) and `Money.Amount`/`Money.Currency` (`Money.cs:32,36`) are public
  `init` accessors, shipped in the public API with the record clone method
  (`Source/Core/MMCA.Common.Shared/PublicAPI.Shipped.txt:575,581,583,768,774`), so an external
  `with` expression (`Currency.Usd with { Code = "XYZ" }`, `Money.Zero() with { Amount = 5m }`)
  produces a currency `FromCode` never checked or a non-zero `None`-currency `Money` without going
  through `Create`. The JSON guard described under serialization below does not close this path,
  because it runs only when a payload is deserialized.
- **That factory shape is fitness-enforced, not conventional.** `ArchitectureRules.DomainFactoriesReturnResult`
  (`Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Domain/ArchitectureRules.Entities.cs:53-79`) walks every
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
  factory (`Money.cs:89-90`, `Currency.cs:45-50`, `DateRange.cs:31-35`, `DateTimeRange.cs:32-36`).
- **Two EF mapping shapes, chosen by whether adoption is a schema change.** A multi-field value maps as
  an **owned type**: the shipped `OwnsMoney` helper
  (`Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeBuilderExtensions.cs:63`)
  flattens `Money` into a `decimal(18,2)` amount column (precision pinned at `:78`) plus a
  three-character non-unicode ISO 4217 code column (`:76-88`) and sets the navigation's requiredness
  from one parameter (`:91`). Its sibling
  `OwnsAddress` (`:131`, shipped in v1.192.0, `MMCA.Common/CHANGELOG.md:1439`) flattens `Address` into
  six non-unicode columns whose lengths come from `AddressInvariants` and of which only `AddressLine1`
  is required (`:142-171`), names them from an optional prefix (`AddressLine1`, `AddressCity`, and so on
  by default, `:133`, joined at `:191-194`) and defaults the navigation to optional (`:134`, applied at
  `:174`). A single-string value
  maps through `HasConversion` instead, so the backing column stays a plain string column and adopting
  the value object on a property that used to be a `string` is not a migration: `EmailValueConverter`
  and `NullableEmailValueConverter`
  (`Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/EmailValueConverter.cs:33,60`),
  `PhoneNumberValueConverter` and `NullablePhoneNumberValueConverter`
  (`PhoneNumberValueConverter.cs:33,61`). Column facets stay at the call site.
- **`Currency.None` is a sentinel, and materialization never yields null.** The sentinel is
  `internal static readonly Currency None = new(string.Empty)` (`Currency.cs:25`); `Money.Zero()`
  carries it (`Money.cs:160`), `Money.Create` rejects it so an external caller must always name a real
  currency (`Money.cs:89-90`), and addition treats it as the identity element so a zero seed can
  accumulate into any currency (`Money.cs:149-156`). Because the write leg can therefore persist an
  empty code, `OwnsMoney`'s read leg falls back to the sentinel rather than a null-forgiving `.Value!`
  (`EntityTypeBuilderExtensions.cs:26,84`, contract documented at `:38-45`), and the fallback is
  regression-covered (`Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Configuration/OwnsMoneyTests.cs:120`).
- **Every serialization boundary is declared explicitly.** `Money`, `Email`, `PhoneNumber` and
  `Address` are `[DataContract]` with ordered `[DataMember]` members (`Money.cs:21,31,35`,
  `Email.cs:15,19`, `PhoneNumber.cs:15,19`, `Address.cs:15,19-40`) and each carries a private
  `[JsonConstructor]` round-trip constructor (`Money.cs:52`, `Email.cs:22`, `PhoneNumber.cs:22`,
  `Address.cs:42`) so a materializer rebuilds the value without reopening the factory; `AddAPI`
  registers both the JSON converter and the XML `DataContractSerializer` formatters
  (`Source/Presentation/MMCA.Common.API/DependencyInjection.cs:54,67`). `Currency` instead serializes
  as its bare code through a converter attached to the type itself (`Currency.cs:15,75`) with a
  matching API-layer converter (`Source/Presentation/MMCA.Common.API/JsonConverters/CurrencyJsonConverter.cs:14`),
  so non-MVC paths (cache, outbox, integration events, typed clients) fail the same way model binding
  does. Both converters read an empty code back as the `None` sentinel (`Currency.cs:88-89`,
  `CurrencyJsonConverter.cs:26-27`), so a serialized `Money.Zero()` round-trips. Because the
  `[JsonConstructor]` bypasses `Create`, `Money` implements `IJsonOnDeserialized` (`Money.cs:22,70-76`)
  and throws `JsonException` when a non-zero amount arrives with the sentinel (shipped in v1.232.0,
  `MMCA.Common/CHANGELOG.md:30`). `DateRange` and `DateTimeRange` carry no serialization annotations.
- **gRPC is mapped by hand, not inferred.** `Money` crosses a service boundary as a purpose-built
  `MoneyV1` message with a **string** amount (proto has no decimal) and a currency code
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Contracts/Protos/product_variants.proto:115,117,120`),
  translated by `MoneyFromWire`
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Contracts/ProductVariantServiceGrpcAdapter.cs:190`)
  and `MoneyToWire` (`:221`).
  `MoneyFromWire` honors the empty-code sentinel only when the amount is also zero (`:199-204`) and
  returns null for a malformed entry, which the calling loop skips rather than failing the whole batch
  (`:121-125`).
- **Adoption is real but partial.** Store maps `ProductVariant.Price`
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/ProductVariant.cs:30`) with
  `OwnsMoney` (`.../Catalog.Infrastructure/Persistence/EntityConfiguration/ProductVariantConfiguration.cs:40`),
  and `Order.Total` (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/Order.cs:58`) is
  seeded with `Money.Zero()` in the private constructor (`:171`) and accumulated through `Money.Add`
  (`:220`, assigned back at `:224`), mapped `required: false` (`OrderConfiguration.cs:39`) alongside
  `OrderLine.UnitPrice` (`OrderLineConfiguration.cs:28`) and `OrderLine.ListPrice`
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/OrderLine.cs:42`, mapped at
  `OrderLineConfiguration.cs:33`). Store Identity types `Customer.Address` as the
  framework `Address`
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Customers/Customer.cs:40`) and maps
  `Customer.Email` through `EmailValueConverter` (`CustomerConfiguration.cs:34`) with `Customer.Address`
  through the shipped `OwnsAddress` helper under its default prefix (`CustomerConfiguration.cs:42`),
  followed by a second `OwnsOne` block on the same navigation that marks all six columns `IsUnicode()`
  and so overrides the helper's non-unicode facet while keeping its names, lengths and requiredness
  (`:47-55`), and
  `User.Email` the same way as `Customer.Email` (`UserConfiguration.cs:25`).
  ADC types `User.Email` as `Email`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:52`, validated through
  `Email.Create` at `:224` and passed to the constructor at `:238`, with the same pair repeated on the
  social-login path `CreateExternal` at `:272,283`) with
  the same converter (`.../Identity.Infrastructure/.../UserConfiguration.cs:21`) and two optional
  Conference emails through `NullableEmailValueConverter`: a speaker's
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Speakers/Speaker.cs:31`, mapped at
  `.../Conference.Infrastructure/Persistence/EntityConfiguration/Speakers/SpeakerConfiguration.cs:43`)
  and an event's organizer contact
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/Event.cs:59`, validated
  through `Email.Create` on both the create and update paths (`:186-194`, `:264-272`) and assigned at
  `:144,292`, mapped at
  `.../Conference.Infrastructure/Persistence/EntityConfiguration/Events/EventConfiguration.cs:60-62`).
  With that third site ADC's Domain carries no primitive email property left, matching Store. Two
  details are worth recording because they look like leftovers and are not: the column is unchanged
  (`nvarchar(255)`, still nullable) so the conversion needed no migration, and
  `EventOrganizerContactEmailRules`
  (`.../Conference.Application/Events/Validation/EventValidationRules.cs:115`, included at `:242`) plus
  `EventInvariants.OrganizerContactEmailMaxLength`
  (`.../Conference.Domain/Events/EventInvariants.cs:38`) were both kept, exactly as the Speaker
  precedent kept its own: the request-side validator still guards the wire string before it reaches
  `Email.Create`, and the length invariant still drives the column width. The DTO maps back out
  through `EventDTOMapper.NullableEmailToString`
  (`.../Conference.Application/Events/DTOs/EventDTOMapper.cs:55`), the twin of the speaker mapper's
  (`.../Speakers/DTOs/SpeakerDTOMapper.cs:62`). `Money`, `Email` and `Address` are the
  three that got adopted, with `Currency` riding along inside `Money`: no code under `MMCA.Store/Source`
  or `MMCA.ADC/Source` uses `PhoneNumber`, `DateRange` or `DateTimeRange`, and MMCA.Helpdesk adopts none
  of them at all.
  **Documented exception (ADC, user decision 2026-10-06).** ADC's `Event.VenueAddress` and
  `Activity.VenueAddress`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/Event.cs:45`,
  `Activities/Activity.cs:45`) stay one free-text string on purpose: a display line that carries the
  venue name, with no invariant beyond its length
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Events/EventConfiguration.cs:45-46`),
  so the structured `Address` would impose a shape the data does not have. ADC's Start/End pairs stay
  primitive too (`Events/Event.cs:33-36`, `Activities/Activity.cs:33-36`, `Sessions/Session.cs:31-34`):
  their only rule is order, enforced by `CommonInvariants.EnsureEndIsNotBeforeStart`
  (`Events/EventInvariants.cs:135`, `Activities/ActivityInvariants.cs:80`), and `DateRange` has no EF
  converter to map them with.

## Rationale
- **The invariant belongs to the type, not to every caller.** A `string` email can be validated in one
  handler and not the next; an `Email` cannot exist unvalidated, because the only entrance is a factory
  that returns a failure instead (`Email.cs:30-41`). That is the same invariant-over-discipline posture
  the framework takes elsewhere (ADR-015), applied one level below the aggregate.
- **Amount and currency are one value, so they are one type.** Two loose columns can drift; `Money`
  makes a currency mismatch a `Result` failure at the point of arithmetic (`Money.cs:125-133`) rather
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
  `OwnsMoney`'s fallback exists to prevent (`EntityTypeBuilderExtensions.cs:38-45`).
- **Ship the mapping, do not repeat it.** `OwnsMoney`, `OwnsAddress` and the four converters put the
  round-trip contract in one reviewed place, so a new entity configuration is one call rather than a
  copied lambda pair that may or may not carry the sentinel fallback, or a copied six-property block
  whose lengths may or may not match `AddressInvariants`. The helpers extend `EntityTypeBuilder` only,
  so a value nested inside another owned type still needs the block by hand: Store's
  `VariantDiscount.SpecialPrice` repeats the `Money` mapping with its own sentinel fallback
  (`.../Catalog.Infrastructure/Persistence/EntityConfiguration/ProductVariantConfiguration.cs:24,61-76`,
  reason stated at `:57-60`).

## Trade-offs
- **The pattern is not uniformly applied.** Only three of the seven types have a companion `*Invariants`
  class; the rest inline their checks. Only two of the four multi-field values have a shipped
  owned-type helper (`OwnsMoney`, `OwnsAddress`); the single-string ones map through converters, and
  `DateRange` and `DateTimeRange` have neither. Five of the seven carry a serialization attribute, and not the same one: four are
  `[DataContract]`/`[DataMember]` (`Money`, `Email`, `PhoneNumber`, `Address`) while `Currency` carries
  `[JsonConverter(typeof(CurrencyJsonConverter))]` (`Currency.cs:15`); only `DateRange` and
  `DateTimeRange` are annotation-free.
- **Three of the seven have no consumer.** `PhoneNumber` ships with invariants, tests and converters,
  and `DateRange` and `DateTimeRange` with tests only (no `*Invariants` class, no converter), but none
  of the three has production usage, so their behavior is exercised only by the framework's own tests.
  Candidates exist: ADC's Start/End pairs could be `DateRange` or `DateTimeRange`, and stay primitive
  by the documented exception at the end of "Adoption is real but partial".
- **Nothing gates that a domain value uses a value object.** The `Create`-returns-`Result` rule is
  fitness-enforced, but no rule says a new email field must be `Email` rather than `string`. MMCA.Helpdesk
  is the visible consequence: the reference app models everything on primitives.
- **Read legs trust the column.** The non-nullable converters materialize through `.Value!`
  (`EmailValueConverter.cs:41`), which is sound for anything EF wrote and unsound for a value inserted
  by a manual script or data fix; the contract is documented rather than defended
  (`EmailValueConverter.cs:24-31`).
- **The currency set is closed in code.** `Currency.All` is `USD` and `EUR` (`Currency.cs:56-60`), so
  supporting a third currency is a framework change and a release, not configuration.
- **`Money` keeps a throwing operator.** `operator +` throws `InvalidOperationException` on a currency
  mismatch (`Money.cs:102-108`), which is the one place the value objects step outside the ADR-013
  posture; `Money.Add` is the `Result`-returning path callers are steered to (`Money.cs:125`).
- **gRPC costs a hand-written mapping per value.** There is no automatic proto projection, so every
  value object that has to cross a service boundary needs its own wire message and translation pair,
  the same class of friction ADR-048 declined to pay for identifiers.

## Revision (2026-10-01)
No decision changed; four statements were corrected and anchors refreshed. (1) The `Money` sugar
paragraph claimed an external caller cannot assemble a `Money` whose currency was never checked.
`Currency.Code` (`Currency.cs:34`) and `Money.Amount`/`Money.Currency` (`Money.cs:31,35`) are public
`init` accessors in the shipped API (`PublicAPI.Shipped.txt:550,556,558,732,738`), so a `with`
expression bypasses `FromCode` and `Create`; the Decision now says so. (2) Store's `Customer.Address`
maps through `OwnsAddress` (`CustomerConfiguration.cs:42`) and then a second `OwnsOne` block
(`:47-55`) sets all six columns `IsUnicode()`, so the Status no longer says no consumer hand-writes an
`Address` block. (3) `OwnsMoney` extends `EntityTypeBuilder` only, so Store hand-maps the nested
`VariantDiscount.SpecialPrice` (`ProductVariantConfiguration.cs:56-75`); the Rationale records it. (4)
`DateRange` and `DateTimeRange` have no `*Invariants` class and no converter, so the Trade-offs no
longer say they ship with both, and "the two multi-field values" became two of four. Context and
Related now cite ADR-115 (wrapper structs opt-in, aliases default; `DependencyInjection.cs:65`). Not
yet recorded above and flagged here: a `Money.Zero()` serializes its currency as `""`
(`Currency.cs:92`) and `CurrencyJsonConverter.Read` throws on it because `FromCode` rejects an empty
code (`Currency.cs:43-44,83-85`), so a `None`-currency `Money` does not JSON round-trip. Anchors
refreshed: `CHANGELOG.md:1098`, `DependencyInjection.cs:54,67`, `CustomerConfiguration.cs:33`,
`EventValidationRules.cs:59,182`, `product_variants.proto:115,117,120` and adapter `:190,221,199-204,121-125`.

## Revision (2026-10-06)
No decision changed. (1) The 2026-10-01 round-trip flag no longer holds: both currency converters
read the empty code back as the sentinel (`Currency.cs:88-89`, `CurrencyJsonConverter.cs:26-27`), and
`Money`'s JSON read throws `JsonException` for a non-zero amount carrying it (`Money.cs:70-76`,
v1.232.0, `CHANGELOG.md:30`); the serialization bullet now says so, and the Decision notes that this
guard does not cover the `with`-expression path. (2) `OwnsMoney` pins the amount to `decimal(18,2)`
(`EntityTypeBuilderExtensions.cs:78`); the EF mapping bullet records it. (3) The ADC documented
exception paragraph sat under the Rationale heading while the Trade-offs pointed to "Adoption is real
but partial"; it now closes that Decision bullet. (4) The ADC social-login path is named
(`CreateExternal`, `User.cs:264`). Anchors were re-verified against current source across Common,
Store and ADC, including the `Currency.cs`, `Money.cs`, `PublicAPI.Shipped.txt`,
`EntityTypeBuilderExtensions.cs`, `OwnsMoneyTests.cs:120` and `CHANGELOG.md:1439` anchors.

## Related
ADR-048 (the deliberate opposite call for identifiers: primitives behind aliases, wrapper structs
rejected, because identifiers cross process boundaries constantly and carry no invariant), ADR-115
(the wrapper struct shipped as an opt-in capability, with aliases still the default), ADR-013
(the `Result` pattern these factories implement below the aggregate level), ADR-015 (the fitness
function that enforces the `Create`-returns-`Result` shape on value objects too).
