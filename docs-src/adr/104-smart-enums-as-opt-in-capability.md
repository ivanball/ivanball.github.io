# ADR-104: Plain Enums by Default, Enumeration<T> as the Opt-In Smart-Enum Base

## Status
Accepted (2026-08-31).

## Context
A bounded set of named values shows up everywhere in this workspace: the state that triggered a
domain event, an error category, a rate-limiting algorithm, a message-bus provider, a JWT signing
algorithm. The framework answers that need with an ordinary CLR enum. `DomainEntityState`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Enums/DomainEntityState.cs:7-13`) is the canonical
example, and it is the discriminator ADR-083 chose for the whole CRUD lifecycle taxonomy.

A CLR enum stops being enough at one specific point: when a member needs to carry behavior or data.
A `switch` over an enum that appears in three places is the usual symptom, because the value has no
home to hang a policy, a rate or a display rule on. The classic answer is the smart enumeration: a
sealed class whose members are `public static readonly` fields, so each member is a real object.

The framework ships that base. `Enumeration<TEnumeration>`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Enumeration.cs:71-72`) is complete rather
than sketched: reflection-based member discovery, `Result`-returning lookups, type-guarded equality,
a System.Text.Json converter factory, `DataContract` attribution for the XML formatter, and a pair
of EF Core value converters in Infrastructure. Thirty-three test methods across three files pin its
contract. It also sits in the `MMCA.Common.Shared.ValueObjects` namespace but deliberately does not
derive from `ValueObject`, because the `ValueObjectsAreImmutableSealedInShared` fitness rule requires
every `ValueObject` derivative to be a sealed record, which forbids the static-member idiom the type
exists for (`Enumeration.cs:26-29`).

**Adoption is zero.** A search of all four repos plus the samples finds no production type deriving
from `Enumeration<T>`: the only derivations anywhere are five private fixtures inside the three test
files. The bounded sets the framework and its consumers actually declare are plain C# enums. The
string-keyed sibling `RoleValue` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/RoleValue.cs:25`),
which takes the same not-a-`ValueObject` trade-off for a closed string set, does have a production
derivation in ADC (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserRole.cs:17`),
so the idiom is not foreign here; the integer-keyed base is simply not the shape any set has needed
yet.

That leaves two readings of the same code, and this record picks one. Either the choice between a
plain enum and a smart enumeration is a decision worth writing down, with a stated rule for when
each applies, or `Enumeration<T>` is dead public surface frozen by the ADR-015 public-API gate. This
record takes the first reading and states the posture explicitly, the same "shipped in the
framework, tested, latent until the first adoption" honesty ADR-037 records for the field-level
encryption converter.

## Decision
**A plain C# enum is the default for a bounded set. `Enumeration<T>` is the opt-in base for a set
whose members need behavior or data, and nothing in the framework pushes a consumer toward it.**

1. **Plain enums stay the default, including on the framework's own hot paths.** `DomainEntityState`
   is a four-member CLR enum (`DomainEntityState.cs:7-13`) and is the discriminator ADR-083's
   `EntityChangedEvent<TId>` carries across the wire. Nothing in this record proposes converting it
   or any other existing enum.

2. **The smart-enum base is a real closed type per enumeration.**
   `Enumeration<TEnumeration> where TEnumeration : Enumeration<TEnumeration>`
   (`Enumeration.cs:71-72`) is self-referencing, so `All`, `FromValue` and `FromName` are per-type
   lookups with no type argument at the call site. A member carries a canonical `Name`
   (`:95`) and a stable integer `Value` (`:99`), set through the protected constructor (`:87`).

3. **Members are discovered by reflection, once, then frozen.** `DiscoverMembers` reads the
   `public static readonly` fields declared **directly** on the closed type
   (`BindingFlags.Public | Static | DeclaredOnly`, `:165-174`, filter at `:167-169`), ordered by
   `Value` (`:172`). Three `Lazy<>` caches back it: the member list (`:74`), a
   `FrozenDictionary<int, TEnumeration>` by value (`:76-77`) and a case-insensitive
   `FrozenDictionary<string, TEnumeration>` by name (`:79-82`). Two members sharing a value or a
   name therefore fail when the lookup is first built rather than silently shadowing each other
   (documented at `:31-34`).

4. **Lookups return `Result`, not exceptions, matching ADR-013.** `FromValue` fails with code
   `Enumeration.UnknownValue` (`:115-125`, code at `:121`) and `FromName` with
   `Enumeration.UnknownName` (`:136-146`, code at `:142`); `FromName` treats a null name as a lookup
   miss rather than throwing (`:138`).

5. **Equality is type-guarded and deliberately not `IEquatable<T>`.** `Equals` compares the concrete
   type and the value (`:152-155`), `GetHashCode` combines both (`:158`), so two enumerations that
   happen to share an integer are never equal. The base declines `IEquatable<T>` because an unsealed
   implementation breaks the equality contract for subclasses (S4035), leaving a sealed derived type
   free to add its own (`:37-41`). `ToString` returns the name (`:149`).

6. **JSON is the member name, through a converter factory.** `EnumerationJsonConverterFactory`
   (`:195`) converts only the self-referencing closed type, by walking the base chain and comparing
   the generic argument with the type itself (`:198-199`, `:213-222`). Its nested converter writes
   `value.Name` (`:241-242`) and reads a string back through `FromName`, throwing `JsonException`
   for a non-string token and for an unknown name (`:227-238`). `HandleNull` stays at its default,
   so a JSON null short-circuits before the converter runs (`:189-193`).

7. **The factory is registered once for the whole API surface.** System.Text.Json resolves
   `[JsonConverter]` off the type being converted without walking base types, so the attribute on
   the base (`:66`) covers only a member typed as the base. `AddAPI` adds the factory to
   `JsonSerializerOptions.Converters`
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:58`, rationale at
   `:55-57`), beside the `CurrencyJsonConverter` precedent (`:53`), so a concrete enumeration
   serializes by name across every host that calls `AddAPI` with no per-type attribute.

8. **XML rides the DataContract attributes already on the type.** The base is `[DataContract]`
   (`Enumeration.cs:65`) with `[DataMember(Order = 1)] Name` (`:94`) and
   `[DataMember(Order = 2)] Value` (`:98`), and `AddAPI` registers
   `AddXmlDataContractSerializerFormatters()` (`DependencyInjection.cs:60`).

9. **Persistence is a plain `int` column, through a shipped value-converter pair.**
   `EnumerationValueConverter<TEnumeration>` is a `ValueConverter<TEnumeration, int>` writing
   `member.Value` and reading through `FromValue`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/EnumerationValueConverter.cs:33-45`),
   and `NullableEnumerationValueConverter<TEnumeration>` passes null through both legs so an absent
   member stays NULL instead of collapsing onto the member valued zero (`:62-74`). Mapping through
   `HasConversion` rather than `OwnsOne` keeps the backing column a plain `int`, so replacing a CLR
   enum property with a smart enumeration is not a schema change (`:9-11`). Column facets stay at
   the call site by design (`:19-21`). The read leg trusts the column: a value no member declares
   materializes a null reference for that row, which only a write made outside EF can produce
   (`:23-30`).

10. **The contract is pinned by tests, not by adoption.** `EnumerationTests`
    (`MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/ValueObjects/EnumerationTests.cs:1-144`, 15
    test methods) covers both lookups, casing, null, per-type `All` scoping and cross-enumeration
    equality and hashing; `EnumerationSerializationTests`
    (`.../ValueObjects/EnumerationSerializationTests.cs:1-139`, 11 methods) covers both routes to the
    converter and pins the documented limitation that an unattributed enumeration under unconfigured
    options falls back to the default object shape (`:68-75`); `EnumerationValueConverterTests`
    (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Conversions/EnumerationValueConverterTests.cs:1-100`,
    7 methods) covers both converters including the null pass-through (`:70-78`).

11. **The rule for choosing.** Use a plain C# enum when the members are names for states or options
    and every decision about them is made by the code that reads them: it is the cheaper type, it
    needs no converter registration, and it is what ADR-083's discriminator, `ErrorType`,
    `RateLimitAlgorithm`, `MessageBusProvider` and `JwtSigningAlgorithm` all are today. Reach for
    `Enumeration<T>` when a member must carry data or behavior (a rate, a policy, a display rule, a
    per-member override), when the same `switch` over the set is about to appear in a third place,
    or when the set needs `Result`-shaped parsing at a boundary. Declare the concrete type sealed
    with private constructors and `public static readonly` members, and map it with the shipped
    value converter.

12. **The surface is frozen public API.** Every member of the base and the factory is in
    `MMCA.Common.Shared`'s shipped baseline
    (`MMCA.Common/Source/Core/MMCA.Common.Shared/PublicAPI.Shipped.txt:381-386`, `:504-508`,
    `:633-635`), and both converters are in Infrastructure's
    (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/PublicAPI.Shipped.txt:109-110`, `:113-114`).
    Under
    ADR-015's RS0016/RS0017 gate, removing or reshaping any of it is a reviewable text diff and a
    breaking change to the package surface, which is precisely why leaving an unadopted capability
    in place is a decision rather than an oversight.

13. **Adoption is zero and this record says so.** No production type in MMCA.Common, MMCA.Store,
    MMCA.ADC, MMCA.Helpdesk or the MMCA.ECommerce sample derives from `Enumeration<T>`. The only
    types that reference it at all are the base file itself, the EF converters, the `AddAPI`
    registration and the three test files; the only derivations are the five private fixtures in
    those tests (`EnumerationTests.cs:122`, `:134`, `EnumerationSerializationTests.cs:111`, `:122`,
    `EnumerationValueConverterTests.cs:89`).

## Rationale
- **The default should be the cheap type.** A CLR enum costs nothing at a call boundary, needs no
  serializer or EF registration, and is what a .NET reader expects for a set of names. Making the
  smart enumeration the default would tax every bounded set in the workspace for a capability almost
  none of them use.
- **The expensive case still needs an answer.** The reason a smart enumeration exists is that a
  plain enum forces behavior away from the value it belongs to. Having the base ready means the
  first set that needs per-member behavior does not arrive with a hand-rolled variant, its own JSON
  shape and its own `HasConversion` lambda pair.
- **Wire and schema compatibility is what makes the switch reversible.** JSON is the member name and
  the column is a plain `int`, so a set that starts as a CLR enum serialized by name and stored by
  value can become a smart enumeration without a contract change or a migration
  (`EnumerationValueConverter.cs:9-11`).
- **A converter factory beats per-type attributes.** Registering the factory once in `AddAPI` means
  a consumer's concrete enumeration is correct by default across every endpoint, instead of being
  correct only where someone remembered the attribute (`DependencyInjection.cs:55-58`).
- **`Result` lookups match the rest of the framework.** `FromValue`/`FromName` returning
  `Result<TEnumeration>` (`Enumeration.cs:115`, `:136`) keeps parsing a value rather than an
  exception, which is ADR-013's posture and what every `Create` factory on a value object already
  does (ADR-068).
- **Recording an unadopted capability is cheaper than discovering it twice.** ADR-037 made the same
  call for the encryption converter, and the payoff was concrete: the posture being explicit is what
  made it safe to replace that converter's format. The same applies here, and the alternative
  (deleting the type) costs a public-API break under ADR-015 for a capability that is complete and
  tested.

## Trade-offs
- **A capability nobody uses is a capability nobody has stress-tested.** The contract is pinned by
  33 test methods against private fixtures, not by a production set with real members, real
  migrations and a real wire history. Its ergonomics are asserted rather than demonstrated, exactly
  as ADR-101 says of the metapackage.
- **Two answers to one question.** A reader now has to choose between a plain enum and
  `Enumeration<T>`, and the rule in Decision point 11 is prose, not a fitness function. Nothing
  fails a build when a set that would benefit from behavior stays a `switch`, and nothing fails when
  a trivial set is declared as a smart enumeration.
- **Public API surface with no consumer.** Eighteen shipped declarations across two packages
  (`Shared/PublicAPI.Shipped.txt:381-386`, `:504-508`, `:633-635`;
  `Infrastructure/PublicAPI.Shipped.txt:109-110`, `:113-114`) are frozen under ADR-015 and can only
  be removed as a breaking change.
- **The JSON attribute does not inherit.** A concrete enumeration serialized outside `AddAPI`'s
  options (a hand-built `JsonSerializerOptions`, a `System.Text.Json` call in a test or a tool)
  falls back to the default object shape unless it repeats `[JsonConverter]` or registers the
  factory. That is a documented, tested limitation
  (`Enumeration.cs:185-188`, `EnumerationSerializationTests.cs:68-75`), not a defect, but it is a
  trap for the first adopter.
- **The EF read leg trusts the column.** A row carrying a value no member declares materializes a
  null reference rather than failing loudly (`EnumerationValueConverter.cs:23-30`, `:42`). The write
  leg cannot produce such a row, so this is reachable only through a manual script, a data fix, or a
  member deleted from the enumeration after rows were written.
- **Member discovery is reflection over declared fields.** Members declared on an intermediate base
  are invisible by design (`DeclaredOnly`, `Enumeration.cs:167`), and a duplicate value or name is
  caught when the lookup is first built rather than at compile time, so a declaration bug surfaces
  at first use instead of in the editor.
- **The type sits in `ValueObjects` without being one.** It lives in the
  `MMCA.Common.Shared.ValueObjects` namespace (`Enumeration.cs:11`) but is out of scope for
  `ValueObjectsAreImmutableSealedInShared`, which only inspects types deriving from `ValueObject`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Immutability.cs:56-74`,
  base-type filter at `:61`). The reason is documented on the type (`Enumeration.cs:26-29`), and
  `RoleValue` takes the same trade-off, but a reader scanning the namespace sees a type the value
  object rules do not cover.

## Related
[ADR-037](037-field-level-encryption-at-rest.md) (the precedent for recording a shipped, tested and
unadopted framework capability as a decision rather than leaving it to read as unfinished adoption),
[ADR-068](068-value-objects-as-validated-primitives.md) (the seven sealed `record` value objects over
the `ValueObject` base, whose fitness rule is exactly what `Enumeration<T>` declines to sit under,
and whose `Result`-returning `Create` factories are the parsing shape `FromValue`/`FromName` follow),
[ADR-083](083-crud-lifecycle-event-taxonomy.md) (the plain-enum discriminator: `DomainEntityState` is
the default choice this record keeps, and it rides integration events as a frozen wire field),
[ADR-015](015-architecture-fitness-functions.md) (the RS0016/RS0017 public-API baseline that freezes
this surface and makes leaving it in place a decision with a stated cost),
[ADR-013](013-result-pattern.md) (the `Result` posture the lookups follow instead of throwing),
[ADR-018](018-polyglot-persistence.md) (the other shipped-but-latent record ADR-037 cites for the
same posture).
