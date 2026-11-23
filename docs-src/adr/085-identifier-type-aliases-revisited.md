# ADR-085: Identifier Type Aliases Revisited (Wrapper Structs Deferred Again, With Triggers)

## Status
Accepted (2026-08-18). Revised 2026-08-23 (the alias count and the migration-surface census were
recounted, the census gained a stated methodology, and the `CheckIn` and generic-parameter citations
were corrected; see the Revision (2026-08-23) at the end). Revised 2026-09-11 (the alias count and the
migration-surface census were re-measured, and the Context bullet asserting that no wrapper-struct
identifier type exists anywhere was rewritten against the framework surface ADR-115 shipped; see the
Revision (2026-09-11) at the end). Revised 2026-09-19 (the alias count and the migration-surface
census were re-measured again, and the non-`int` alias bullet was rewritten: there are now two `Guid`
aliases, not one; see the Revision (2026-09-19) at the end). Revised 2026-10-01 (the
migration-surface census was re-measured and the wrapper-capability bullet was corrected on the
object-mapper file; see the Revision (2026-10-01) at the end). Revised 2026-10-06: the
migration-surface census was re-measured to 3,945 lines across 1,227 files (see the Revision
(2026-10-06) at the end). Revised 2026-10-21: the alias count rose to 49 (47 `int`) with ADC
Engagement's `ErasedUserIdentifierType`, and the migration-surface census was re-measured to 4,069
lines across 1,250 files (see the Revision (2026-10-21) at the end). Revised 2026-10-26: the
migration-surface census was re-measured to 4,085 lines across 1,256 files and the
`AddStronglyTypedIds` anchor was refreshed (see the Revision (2026-10-26) at the end). Revised
2026-11-23: MMCA.Helpdesk now declares one wrapper identifier (`TicketCommentId`) beside its alias,
so the capability is adopted in the reference app only, and acting on it takes the DI call plus a
design-time registration rather than the one DI call stated below; the alias count is 50 (48 `int`)
and the migration-surface census was re-measured to 4,693 lines across 1,433 files (see the Revision
(2026-11-23) at the end).
**Revisits [ADR-048](048-primitive-identifier-type-aliases.md)**, which stays
Accepted and unchanged in substance: the aliases remain the identifier model. What changes is the
shape of the deferral. ADR-048 left the wrapper-struct alternative "considered and left unbuilt" with
no condition attached; this record measures what the deferral actually costs today, states the
migration price in numbers, and replaces an open-ended "not now" with named triggers that would
re-open it.
**Revisited by
[ADR-115](115-strongly-typed-identifiers-opt-in.md) (2026-09-09)**: none of the three triggers has
fired and this deferral stands. What changed is that the wrapper struct is now a first-class
framework capability, so acting on the greenfield trigger costs one DI call rather than a research
project.

## Context
[ADR-048](048-primitive-identifier-type-aliases.md) decided that every entity identity is a primitive
named through a per-module `global using {Entity}IdentifierType = ...` alias, and recorded the cost in
one line of Trade-offs: no compile-time protection against swapping two same-typed identifiers. That
is an honest sentence, and it is also the entire treatment the risk has ever received. A deferral with
no revisit condition is indistinguishable from an oversight a year later, which is the gap this record
closes.

The Section A wave was the moment to ask, because it rewrote a large number of data-access signatures
at once (specification-first reads, keyset pagination, projection pushdown; see
[ADR-055](055-repository-and-specification-contract.md)). If a wrapper-struct migration were ever
going to ride along with unrelated churn, that was the wave to fold it into. It did not, and this
record says why.

Three facts frame the decision, all counted in the four repositories' `Source` trees on 2026-11-23:

- **50 aliases live in 10 files across the four repos.** MMCA.Common declares 3 (`UserIdentifierType`
  in `Source/Core/MMCA.Common.Domain/GlobalUsings.IdentifierType.cs:1` plus the two push-notification
  aliases in `Source/Core/MMCA.Common.Shared/GlobalUsings.NotificationIdentifierType.cs:1-2`);
  MMCA.ADC declares 35 across Conference (19, alias file `:8-26`), Engagement (13, `:4-16`),
  Identity (1, `:2`) and Notification (2, `:1-2`); MMCA.Store declares 11 across Catalog (6,
  `MMCA.Store.Catalog.GlobalUsings.IdentifierType.cs:3-8`), Sales (3, `:5-7`) and Identity (2, `:3-4`);
  MMCA.Helpdesk declares 1 in Tickets, `TicketIdentifierType = int`
  (`MMCA.Helpdesk.Tickets.GlobalUsings.IdentifierType.cs:8`), whose comment at `:6-7` states that a
  strongly typed identifier gets no alias.
- **48 of the 50 resolve to `int`.** Both exceptions are `System.Guid` and both sit in ADC's
  Conference module
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs`):
  `SpeakerIdentifierType` (`:24`), which Sessionize forces (`:4`), and `SessionAssetIdentifierType`
  (`:18`), whose identifier is a path segment of a public blob name and therefore has to be
  unguessable rather than sequential (`:5-6`). So for every practical purpose the whole workspace has
  **one** identifier CLR type, and the compiler sees 48 synonyms for it.
- **The wrapper struct exists as a framework capability and one reference-app identifier uses
  it.** The generator packages are still absent (a sweep of the four repositories for `Vogen` finds no package reference, no
  project file entry, no using), but the wrapper primitives themselves ship in MMCA.Common:
  the `IStronglyTypedId<TSelf, TValue>` contract (`Identifiers/IStronglyTypedId.cs:60`) and the
  `StronglyTypedId` helper class (`Identifiers/StronglyTypedId.cs:19`) plus a JSON converter factory,
  a `TypeConverter`, a registry and the object-mapper wrap/unwrap pair
  (`Identifiers/StronglyTypedIdMappings.cs:36`) live in
  `MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/` (six files); the EF value converter
  lives in Infrastructure
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/StronglyTypedIdValueConverter.cs:28`,
  nullable twin `:56`) and is applied from `ApplicationDbContext.ConfigureConventions`
  (`Persistence/DbContexts/ApplicationDbContext.cs:491`, opt-in block `:515-522`). At run time all of
  it is wired by one DI call, `AddStronglyTypedIds`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:425`); a host with
  design-time EF tooling also names the identifier assembly to its design-time factory
  (`options.AddStronglyTypedIdAssembly`, as in
  `MMCA.Helpdesk/Source/Hosting/MMCA.Helpdesk.Migrations.SqlServer.Tickets/DesignTimeSQLServerDbContextFactory.cs:52`).
  The shape is checked by a fitness rule, `StronglyTypedIdsAreReadonlyRecordStructs`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Domain/ArchitectureRules.StronglyTypedIds.cs:34`).
  That capability is [ADR-115](115-strongly-typed-identifiers-opt-in.md), and it is opt-in. Exactly
  one identifier in the four `Source` trees declares a wrapper type: MMCA.Helpdesk's
  `TicketCommentId`
  (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Shared/Tickets/TicketCommentId.cs:19`),
  which keys the child `TicketComment` (`TicketComment.cs:17`) while the parent's
  `TicketIdentifierType` stays the `int` alias (`TicketComment.cs:25`), so the reference app shows
  both styles; its host calls `AddStronglyTypedIds`
  (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:86`). MMCA.ADC and MMCA.Store declare no
  wrapper. The aliases therefore remain the identifier model of every production consumer, and this
  record's deferral is about the default, not about availability.

## Decision
**Keep the aliases.** The wrapper-struct alternative is evaluated in this record, priced, and
deferred again, this time against explicit triggers.

### The risk is real and it is concentrated at cross-module scalar references
Inside a module an identifier is usually passed straight from a route value into one repository call,
where a transposition has nowhere to hide. The exposure concentrates where a module holds an
identifier it does not own, which is exactly the shape database-per-service
([ADR-006](006-database-per-service.md)) produces: cross-module references are scalar columns, never
foreign keys, so the type system is the only check there is and the type system is `int`.

The clearest live instance is ADC's `CheckIn` aggregate
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/CheckIns/CheckIn.cs:57-64`), whose
constructor takes five identifiers, four of them consecutive: `UserIdentifierType userId` (`:58`) is
held apart from the run by the `CheckInScope scope` parameter (`:59`), and then `EventIdentifierType
eventId`, `SessionIdentifierType? sessionId`, `SponsorIdentifierType? sponsorId` and
`UserIdentifierType checkedInByUserId` follow one another (`:60-63`). The `Create` factory carries the
same five identifiers across a wider signature (`:89-96`) rather than mirroring the order: `sponsorId`
moves to last and optional (`:96`) so the scan and manual paths, which can never carry one, stay
unchanged. All five are `int` or `int?` at the CLR level, since the four aliases they draw on
(`UserIdentifierType`, `EventIdentifierType`, `SessionIdentifierType`, `SponsorIdentifierType`) are
every one of them `int`, and two of the five are the *same* alias holding two different users (the
attendee and the organizer who scanned the badge). Swapping those two arguments compiles
cleanly, passes every type check, and produces a check-in attributed to the wrong person. A wrapper
struct would have made that line a compiler error. This is the concrete cost, stated once with a real
example rather than as an abstraction.

### The evaluated alternative: source-generated wrapper structs
The alternative priced here is the standard one: a `readonly record struct UserId(int Value)` per
identifier, emitted by a source generator (the pattern the StronglyTypedId and Vogen generators
implement) so the boilerplate is not hand-written, plus an EF Core `ValueConverter` per type, a
`JsonConverter` per type, and an OpenAPI schema mapping per type. Modern generators emit all three, so
the objection is not that the wrappers are laborious to author. The objection is the blast radius of
switching.

That radius is measurable, and the measurement only means something with its counting rule stated.
An **alias token** here is any `<Name>IdentifierType` token (a non-empty prefix, so the bare
`IdentifierType` tuple element name in
`MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedIdRegistry.cs:73` does not count)
other than the framework's own generic parameter `TIdentifierType`, counted in the `.cs` and `.razor` files of the four `Source` trees on
2026-11-23, with tests, `bin` and `obj` excluded, one hit per source line that carries at least one
such token. On that rule the aliases appear on **4,693 lines across 1,433 files**: 510 in 167 files in
MMCA.Common, 2,726 in 815 files in MMCA.ADC, 1,407 in 423 files in MMCA.Store, and 50 in 28 files in
MMCA.Helpdesk. (Counting every token rather than every line raises the total and leaves the file
count unchanged.) Excluding `TIdentifierType` is what makes the framework figure honest: 798 of
MMCA.Common's 1,318 `IdentifierType` lines carry that generic parameter, which a wrapper
migration re-satisfies with a new type argument rather than rewrites call
site by call site. The rule excludes only that one name, so other framework generic parameters of
the `T...IdentifierType` shape still count: 20 of MMCA.Common's 510 lines are such parameters, all
in `MMCA.Common/Source/Core/MMCA.Common.Application/Services/NavigationLoader.cs`. Every one of the 4,693 is a signature, a property, a generic argument, or a DTO
field that a wrapper migration would have to either change or prove it can leave alone. Because
MMCA.Common is a published package family released in lockstep
([ADR-016](016-lockstep-versioning-masstransit-pin.md)), the framework share of that count
is a breaking public-API change that all three consumers must absorb in a single sweep, and the
identifier type is a generic parameter on `BaseEntity<TIdentifierType>`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/BaseEntity.cs:34`), `IBaseDTO<TIdentifierType>`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/IBaseDTO.cs:9`) and
`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Mapping/IEntityDTOMapper.cs:14`)
([ADR-001](001-manual-dto-mapping.md)), the repository handles
([ADR-055](055-repository-and-specification-contract.md)) and the generic entity query surface
([ADR-034](034-generic-entity-query-layer.md)), so the change is not confined to leaf code.

### The revisit triggers
The deferral holds until one of these is observed, at which point this record is re-opened rather than
re-argued from scratch:

1. **A production defect traced to an identifier transposition.** One is enough. The argument for
   keeping the aliases rests entirely on the claim that the risk has not materialized; a single
   confirmed instance retires that claim, and the incident itself supplies the evidence the migration
   business case needs.
2. **A greenfield fifth consumer.** A new application built on the framework pays none of the
   migration cost counted above, because it has no existing signatures. If one is started, it is the
   right place to build wrapper structs first and let the framework's generic parameters carry them,
   which would also produce the compatibility evidence the four existing repos would need.
3. **A cross-module identifier count that keeps climbing.** The exposure scales with cross-module
   scalar references, not with the alias count. If the reference graph grows materially past what
   `CheckIn` and its peers represent today, the arithmetic changes even without an incident.

Absent all three, this stays a recorded, priced deferral rather than an open question.

## Rationale
- **The cost is paid once and the benefit accrues per defect avoided, and the defect count is
  currently zero.** No production incident in any of the four repos has been traced to a swapped
  identifier. That is not proof of safety, and this record does not claim it is; it is the only
  evidence available, and it does not support a 1,433-file change.
- **A partial migration is worse than either endpoint.** Wrapping some identifiers and not others
  produces a codebase where the absence of a compiler error means nothing, because the reader cannot
  tell whether a given call site is protected or merely un-migrated. The change is therefore
  all-or-nothing across the production consumers, which is precisely what makes it expensive.
  MMCA.Helpdesk is the one deliberate exception: as the reference app and template source it wraps
  one child identifier (`TicketCommentId.cs:19`) beside an aliased parent so an adopter sees both
  styles side by side, which is a demonstration, not a migration of an existing default. Because
  Helpdesk is also the `dotnet new` template source, a scaffolded app with a child collection starts
  in that mixed state (`ArchitectureTests.cs:228-230`). The reader problem above is narrower there,
  since the split is fixed by role (the child key is wrapped, every aliased identifier is not) rather
  than by migration progress, but it is not absent: an aliased call site in such an app is still
  unprotected, and nothing at the call site says so.
- **The friction ADR-048 avoided is still real, not merely historical.** ADR-048's central claim was
  that `int` and `Guid` need no converter at any boundary: EF Core, the SQL provider,
  `System.Text.Json`, gRPC, and the OpenAPI generator all speak them natively. Nothing since has
  changed that; the generators reduce the boilerplate but they do not remove the boundary code, they
  generate it, and generated converters at six boundaries are still six places a subtle bug can live.
- **The wave that would have carried it declined it deliberately.** Section A rewrote the read
  contract and could have absorbed a wrapper migration into churn the consumers were already going to
  take. Recording that it was considered and rejected at that moment is more useful than recording
  the abstract preference again.
- **Naming the triggers is the actual deliverable.** The alias decision is unchanged; what this
  record adds is a condition under which it stops being the decision. That is the difference between
  a deferral and a blind spot.

## Trade-offs
- **The exposure is unmitigated, not reduced.** This record buys no safety whatsoever. In MMCA.ADC
  and MMCA.Store every transposition ADR-048 could not catch is still uncatchable today, and the
  `CheckIn` constructor above is still a live example of a two-argument swap that compiles. The one
  exception is MMCA.Helpdesk's wrapped child key: `TicketComment` is keyed by `TicketCommentId`
  (`TicketComment.cs:17`) while its `TicketId` is the `int` alias (`:25`), so swapping a comment id
  with an `int` identifier there is a compiler error; two aliased identifiers still swap silently.
- **No detection either.** Nothing gates, lints, or tests for a suspicious identifier assignment.
  There is no analyzer and no naming convention that a reviewer could mechanically check, and the one
  fitness rule ([ADR-015](015-architecture-fitness-functions.md)) in this area,
  `StronglyTypedIdsAreReadonlyRecordStructs`
  (`ArchitectureRules.StronglyTypedIds.cs:34`), constrains the shape of a wrapper type rather than any
  identifier assignment. In MMCA.ADC and MMCA.Store, which declare no wrapper, it matches nothing; in
  MMCA.Helpdesk its one subject is `TicketCommentId`, through the `StronglyTypedIdTestsBase` subclass
  (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:231`)
  whose base calls the rule (`StronglyTypedIdTestsBase.cs:16`). Trigger 1 therefore depends on a
  production defect being *traced* to a transposition, and a wrong-user check-in is exactly the kind
  of defect that gets written off as a scanning mistake instead.
- **The migration price rises with the codebase.** The 4,693 lines counted here are a snapshot
  and the number only grows. Deferring on cost grounds means the cost argument gets stronger every
  release, which is the classic shape of a decision that is never revisited on its merits.
- **Trigger 3 is not measured.** No count of cross-module scalar identifier references is maintained,
  so "keeps climbing" has no baseline to climb from. It is a qualitative trigger and is recorded as
  such.
- **Ordering conventions carry weight the type system should.** With three `int` parameters in a row
  in `Create` (`CheckIn.cs:92-94`) and four in the constructor (`:60-63`), the discipline that keeps
  `CheckIn.Create` correct is parameter naming and the seven parameter doc lines at
  `CheckIn.cs:81-87`. That is review-strength protection standing in for compile-time protection,
  which is the same class of dependency ADR-048 already recorded for the alias convention itself.

## Related
[ADR-048](048-primitive-identifier-type-aliases.md) (the decision this record revisits and upholds;
its Status now points here), [ADR-068](068-value-objects-as-validated-primitives.md) (the deliberate
opposite case: domain values carry invariants and therefore do get wrapper types, which is why
identifiers not getting them is a decision rather than an omission),
[ADR-006](006-database-per-service.md) (cross-module references are scalar columns, never foreign
keys, which is what concentrates the exposure), [ADR-016](016-lockstep-versioning-masstransit-pin.md)
(the lockstep release and one-pass consumer sweep any migration would have to run through),
[ADR-015](015-architecture-fitness-functions.md) (the enforcement machinery that covers neither the
alias convention nor identifier transposition),
[ADR-055](055-repository-and-specification-contract.md) and
[ADR-034](034-generic-entity-query-layer.md) (the generic surfaces parameterized by the identifier
type, and therefore in the migration's blast radius),
[ADR-115](115-strongly-typed-identifiers-opt-in.md) (the opt-in wrapper-struct capability that makes
acting on a trigger a DI call plus a design-time registration instead of a build).

## Revision (2026-08-23)
The decision, the priced alternative, the three triggers and the trade-offs are unchanged. What
changed is arithmetic and three citations.

**The alias count is 44 across 10 files, 43 of them `int`.** ADC's Conference module gained
`ActivityIdentifierType = int` at the head of its alias file
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:5-21`),
taking Conference to seventeen and ADC to thirty. `SpeakerIdentifierType = System.Guid` (`:19` in the
same file) is still the only non-`int` alias in any of the four repositories.
[ADR-048](048-primitive-identifier-type-aliases.md) carries the same pair.

**The migration-surface census is restated with its counting rule and re-measured.** The previous
figure (3,641 occurrences across 1,016 files) counted the framework's generic parameter
`TIdentifierType` as if it were an alias, which inflated MMCA.Common's share roughly fourfold: of the
725 `IdentifierType` hits in `MMCA.Common/Source`, 538 are the generic parameter and only 187 are
alias tokens. Counting alias tokens only, in `.cs` and `.razor` under the four `Source` trees with
tests, `bin` and `obj` excluded, gives **3,192 occurrences across 1,001 files** (Common 187/80,
ADC 2,077/613, Store 873/277, Helpdesk 55/31). The conclusion is unmoved: the blast radius is still
a four-repository, thousand-file change, and MMCA.Common's generic parameters are still in it, since
re-satisfying a type parameter with a wrapper struct is a breaking public-API change even where no
call site is edited.

**Three citations corrected.** ADC's `CheckIn` constructor takes five identifiers but not five in a
row: `CheckInScope scope` (`CheckIn.cs:59`) sits between `userId` (`:58`) and the consecutive run of
four (`:60-63`). The `Create` factory is not a mirror of the constructor: its signature spans
`:89-96` and moves `sponsorId` to last and optional (`:96`). And all five of those identifier
parameters are `int` or `int?` at the CLR level, not four of the five, which sharpens rather than
softens this record's point: nothing in the CLR distinguishes any one of them from the others.
Finally, the two framework generic surfaces are spelled `IBaseDTO<TIdentifierType>`
(`IBaseDTO.cs:9`) and `IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`
(`IEntityDTOMapper.cs:14`); this record previously named parameters (`TId`, `TDTO`) that do not
exist.

The Rationale's "no production incident traced to a swapped identifier" stands as written and stays
unverified by design: the four repositories keep no incident register, postmortem folder or issue
label that would record such a defect, which is exactly why the record already refuses to call it
proof of safety.

## Revision (2026-09-11)
The decision, the priced alternative, the three triggers and the trade-offs are unchanged. What
changed is arithmetic and one Context fact.

**The alias count is 46 across the same 10 files, 45 of them `int`.** MMCA.Store now declares 11
rather than 9: Catalog carries six (`Category`, `Product`, `ProductImage`, `ProductReview`,
`ProductVariant`, `VerifiedPurchase` at
`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/MMCA.Store.Catalog.GlobalUsings.IdentifierType.cs:3-8`)
alongside Sales (3) and Identity (2). Common (3), ADC (30) and Helpdesk (2) are unmoved, and
`SpeakerIdentifierType = System.Guid` is still the only non-`int` alias in any of the four
repositories.

**The migration-surface census is re-measured on the same rule**, with the rule sharpened to say what
a hit is: one per source line carrying at least one alias token. That gives **3,591 lines across
1,136 files** (Common 265/106, ADC 2,077/637, Store 1,185/362, Helpdesk 64/31), against 3,192 across
1,001 files in August. Counting individual tokens instead gives 3,794 over the same 1,136 files. The
framework split moves with it: `MMCA.Common/Source` carries 988 `IdentifierType` lines, 723 of them
the generic parameter `TIdentifierType`, leaving 265 alias-token lines. The conclusion is unmoved and
slightly stronger: the blast radius is still a four-repository, thousand-file change, and it grew by
roughly 13 percent in three weeks, which is the trade-off about the price rising with the codebase
happening in the record's own numbers.

**The "no wrapper-struct identifier type exists anywhere" bullet is now false and is rewritten.**
[ADR-115](115-strongly-typed-identifiers-opt-in.md) (2026-09-09) shipped the wrapper primitives as an
opt-in framework capability in
`MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/` (six files), with `AddStronglyTypedIds`
(`DependencyInjection.cs:775`) and the `StronglyTypedIdsAreReadonlyRecordStructs` fitness rule
(`ArchitectureRules.StronglyTypedIds.cs:34`). What is deferred here is therefore the **default**, not
the capability: no identifier in the four `Source` trees declares a wrapper type, no generator package
(`Vogen` included) is referenced anywhere, and none of the three triggers has fired. The fitness rule
constrains the shape of a wrapper if one is written and gates no identifier assignment, so the
"no detection" trade-off stands as written.

## Revision (2026-09-19)
The decision, the priced alternative, the three triggers and the trade-offs are unchanged. What
changed is arithmetic and the non-`int` bullet.

**The alias count is 48 across the same 10 files, 46 of them `int`.** ADC's Conference module gained
two aliases since 2026-09-11, taking Conference to nineteen and ADC to thirty-two; Common (3),
Store (11) and Helpdesk (2) are unmoved. One of the two, `SessionAssetIdentifierType = System.Guid`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:17`),
is the first non-`int` alias added since this record was written, so
`SpeakerIdentifierType = System.Guid` (`:23` in the same file) is no longer the only one. Both are
`Guid` for the same class of reason (an identifier minted outside the database), and neither weakens
the point the count is making: 46 of the 48 are still the same CLR type, so the type system still
distinguishes almost nothing.

**The migration-surface census is re-measured on the same rule** (one hit per source line carrying at
least one alias token, `.cs` and `.razor` under the four `Source` trees, tests, `bin` and `obj`
excluded, the generic parameter `TIdentifierType` not counted). That gives **3,767 lines across
1,192 files** (Common 288/117, ADC 2,227/682, Store 1,188/362, Helpdesk 64/31), against 3,591 across
1,136 files eight days earlier. Counting individual tokens instead gives 3,978 over the same 1,192
files. The framework split moves with it: `MMCA.Common/Source` carries 1,017 `IdentifierType` lines,
729 of them the generic parameter, leaving 288 alias-token lines. The trade-off about the price
rising with the codebase keeps documenting itself: the surface grew by roughly 5 percent in eight
days without anyone deciding to grow it.

## Revision (2026-10-01)
No decision, trigger, rationale or trade-off changed. The migration-surface census is re-measured on
the same rule: **3,869 lines across 1,209 files** (Common 296/117, ADC 2,282/694, Store 1,227/367,
Helpdesk 64/31), 4,099 tokens, and `MMCA.Common/Source` now carries 1,031 `IdentifierType` lines, 735
of them the generic parameter alone. The Context bullet on the wrapper capability is corrected in one
detail: the sixth file in `MMCA.Common.Shared/Identifiers/` is the object-mapper wrap/unwrap pair
(`StronglyTypedIdMappings.cs:5-7`), not an EF mapping; the EF value converter lives in Infrastructure
(`Persistence/Conversions/StronglyTypedIdValueConverter.cs:28`, nullable twin `:56`) and is applied
from `ApplicationDbContext.ConfigureConventions` (`ApplicationDbContext.cs:402-409`). The
`AddStronglyTypedIds` citation is re-anchored to `DependencyInjection.cs:366`.

## Revision (2026-10-06)
No decision, trigger, rationale or trade-off changed.

- **The migration-surface census is re-measured on the same rule**: **3,945 lines across 1,227
  files** (Common 319/124, ADC 2,318/702, Store 1,244/370, Helpdesk 64/31), 4,180 tokens, and
  `MMCA.Common/Source` now carries 1,078 `IdentifierType` lines, 759 of them the generic parameter
  alone. The Decision, Rationale and Trade-offs figures follow it. The count covers each repository's
  `Source` tree, so MMCA.Common's shipped `MMCA.Common.Testing*` packages are included as framework
  source, as in the earlier passes.
- **The alias count is unchanged**: 48 across the same 10 files, 46 of them `int`, the two `Guid`
  aliases still at `MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:17` and `:23`.
- **`AddStronglyTypedIds` now declares at `DependencyInjection.cs:376`**; the `:366` recorded on
  2026-10-01 falls inside its XML doc block. The Context bullet carries the current anchor.
- Line anchors in the live sections were re-verified against current source.

## Revision (2026-10-21)
Re-verified against current source. No decision, trigger, rationale or trade-off changed; the alias
count and the migration-surface census moved, and two Context anchors were re-pointed.

1. **The alias count is 49 across the same 10 files, 47 of them `int`.** ADC's Engagement module
   gained `ErasedUserIdentifierType = int`
   (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/MMCA.ADC.Engagement.GlobalUsings.IdentifierType.cs:6`),
   taking Engagement to eleven (`:4-14`) and ADC to thirty-three. Common (3), Store (11) and
   Helpdesk (2) are unmoved, and the two `Guid` aliases still sit at
   `MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:17` and `:23`. The new alias is the
   database-generated key of Engagement's own `ErasedUser` aggregate
   (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/ErasedUsers/ErasedUser.cs:18-19`),
   not a cross-module reference. The cross-module scalar it adds is `ErasedUser.UserId`, typed with
   the existing `UserIdentifierType` (`ErasedUser.cs:22`): one more reference of the kind trigger 3
   watches, but trigger 3 stays unmeasured and none of the three triggers is recorded as fired.
2. **The migration-surface census is re-measured on the same rule**: **4,069 lines across 1,250
   files** (Common 343/124, ADC 2,430/727, Store 1,232/368, Helpdesk 64/31), and `MMCA.Common/Source`
   now carries 1,115 `IdentifierType` lines, 762 of them the generic parameter alone (the other 10
   non-alias lines are the `IdentifierTypes` registry members, not identifier signatures). Store's
   share shrank slightly while ADC's grew. The token total was not re-measured in this pass, so the
   Decision states the line count only. The Decision, Rationale and Trade-offs figures follow it.
3. Anchors re-verified against current source: `AddStronglyTypedIds` now declares at
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:382` (the Context bullet
   carries it); the Engagement alias range is `:4-14`.

## Revision (2026-10-26)
Re-verified against current source. No decision, trigger, rationale or trade-off changed; the
migration-surface census moved and one Context anchor was re-pointed.

1. **The migration-surface census is re-measured on the same rule**: **4,085 lines across 1,256
   files** (Common 352/130, ADC 2,437/727, Store 1,232/368, Helpdesk 64/31), against 4,069 across
   1,250 on 2026-10-21. Store and Helpdesk are unmoved; Common and ADC grew. `MMCA.Common/Source` now
   carries 1,124 `IdentifierType` lines: 352 alias-token lines, 762 carrying the generic parameter
   `TIdentifierType` alone, 9 carrying the `IdentifierTypes` registry members and 1 holding the bare
   `IdentifierType` tuple element name
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedIdRegistry.cs:73`), which sums
   exactly.
   The token total was not re-measured. The Decision, Rationale and Trade-offs figures follow it.
2. **Adoption is re-checked; the triggers are not re-measured.** No `IStronglyTypedId<`
   implementation and no `Vogen` reference exists in the `Source` trees of MMCA.ADC, MMCA.Store or
   MMCA.Helpdesk, so the capability stays unadopted in the existing consumers. That is an adoption
   check, not a trigger check: trigger 1 stays unverified by design (see the Revision (2026-08-23)),
   trigger 2 (a greenfield fifth consumer) was not checked in this pass, and trigger 3 stays
   unmeasured. None of the three is recorded as fired.
3. Anchors re-verified against current source: `AddStronglyTypedIds` now declares at
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:401` (the Context bullet
   carries it).

## Revision (2026-11-23)
Re-verified against current source. The decision, the priced alternative, the three triggers and
the trade-offs are unchanged in substance; adoption moved (MMCA.Helpdesk wraps one identifier), the
alias count and the migration-surface census moved, and several Context anchors were re-pointed.

1. **The capability is adopted in the reference app.** MMCA.Helpdesk declares
   `public readonly record struct TicketCommentId(int Value) : IStronglyTypedId<TicketCommentId, int>`
   (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Shared/Tickets/TicketCommentId.cs:19`),
   which keys `TicketComment` (`TicketComment.cs:17`) while `TicketIdentifierType` stays the `int`
   alias (`TicketComment.cs:25`). The host calls `AddStronglyTypedIds`
   (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:86`) and the design-time factory names
   the identifier assembly (`DesignTimeSQLServerDbContextFactory.cs:52`), so acting on the capability
   takes the DI call plus that design-time registration. MMCA.ADC and MMCA.Store still have no
   `IStronglyTypedId<` implementation and no `Vogen` reference. The adoption check recorded on
   2026-10-26 was true when written. The Context bullet and the partial-migration Rationale bullet
   now say that Helpdesk shows both styles as a demonstration, not a migrated default, and that a
   scaffold with a child collection inherits that mixed state; the "unmitigated" trade-off is scoped
   to ADC and Store, since a comment-id swap in Helpdesk is a compiler error; and the Related entry
   for ADR-115 names the design-time registration beside the DI call.
2. **The alias count is 50 across the same 10 files, 48 of them `int`.** ADC's Engagement module
   gained `TicketIdentifierType` and `TicketImportRunIdentifierType`
   (`MMCA.ADC.Engagement.GlobalUsings.IdentifierType.cs:14-15`), taking Engagement to thirteen
   (`:4-16`) and ADC to thirty-five; MMCA.Helpdesk dropped to one alias
   (`MMCA.Helpdesk.Tickets.GlobalUsings.IdentifierType.cs:8`, with the no-alias rule for a wrapped
   identifier stated at `:6-7`). Common (3) and Store (11) are unmoved. The two `Guid` aliases are
   still both in ADC Conference, now at `MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:18`
   (`SessionAssetIdentifierType`) and `:24` (`SpeakerIdentifierType`).
3. **The migration-surface census is re-measured on the stated rule**: **4,693 lines across 1,433
   files** (Common 510/167, ADC 2,726/815, Store 1,407/423, Helpdesk 50/28), against 4,085 across
   1,256 on 2026-10-26, counted with the ripgrep-based Grep tool over `*.cs` and `*.razor` in each
   `Source` tree with the pattern `\b(?:[A-Za-z_][A-Za-z0-9_]+|[A-SU-Za-z_])IdentifierType\b`.
   That pattern excludes only `TIdentifierType`, so 20 of Common's 510 lines are other
   `T...IdentifierType` generic parameters (all in `NavigationLoader.cs`). Whether the 2026-10-26
   pass used the same pattern is not recorded, so how much of Common's rise from 352 to 510 is growth
   rather than a counting difference is not determinable from source.
   `MMCA.Common/Source` now carries 1,318 `IdentifierType` lines, 798 of them carrying the generic
   parameter `TIdentifierType` (any occurrence, not only that token). Helpdesk's share shrank with its
   lost alias. The token total was not re-measured. The Decision, Rationale and Trade-offs figures
   follow it.
4. **The fitness rule now has a subject.** `StronglyTypedIdsAreReadonlyRecordStructs`
   (`ArchitectureRules.StronglyTypedIds.cs:34`) still matches nothing in ADC and Store, but Helpdesk's
   `StronglyTypedIdTestsBase` subclass (`ArchitectureTests.cs:231`, base call at
   `StronglyTypedIdTestsBase.cs:16`) applies it to `TicketCommentId`. It still gates no identifier
   assignment, so the "no detection" trade-off stands.
5. **Triggers.** Trigger 2 has not fired by its wording: Helpdesk is one of the four existing
   repositories, not a greenfield fifth consumer. Trigger 1 stays unverified by design (see the
   Revision (2026-08-23)) and trigger 3 stays unmeasured. None of the three is recorded as fired.
6. Anchors re-verified against current source: `StronglyTypedIdMappings<TSelf, TValue>` at
   `MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/StronglyTypedIdMappings.cs:36` (the old
   `:5-7` was its doc block); `ApplicationDbContext.ConfigureConventions` at
   `Persistence/DbContexts/ApplicationDbContext.cs:491` with the opt-in block at `:515-522`;
   `AddStronglyTypedIds` at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:425`;
   the ADC Conference alias range `:8-26` with the rationale comments at `:4` and `:5-6`.
