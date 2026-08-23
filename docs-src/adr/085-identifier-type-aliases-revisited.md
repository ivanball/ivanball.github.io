# ADR-085: Identifier Type Aliases Revisited (Wrapper Structs Deferred Again, With Triggers)

## Status
Accepted (2026-08-18). Revised 2026-08-23 (the alias count and the migration-surface census were
recounted, the census gained a stated methodology, and the `CheckIn` and generic-parameter citations
were corrected; see the Revision (2026-08-23) at the end).
**Revisits [ADR-048](048-primitive-identifier-type-aliases.md)**, which stays
Accepted and unchanged in substance: the aliases remain the identifier model. What changes is the
shape of the deferral. ADR-048 left the wrapper-struct alternative "considered and left unbuilt" with
no condition attached; this record measures what the deferral actually costs today, states the
migration price in numbers, and replaces an open-ended "not now" with named triggers that would
re-open it.

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

Three facts frame the decision, all counted in the four repositories' `Source` trees on 2026-08-23:

- **44 aliases live in 10 files across the four repos.** MMCA.Common declares 3 (`UserIdentifierType`
  in `Source/Core/MMCA.Common.Domain/GlobalUsings.IdentifierType.cs:1` plus the two push-notification
  aliases in `Source/Core/MMCA.Common.Shared/GlobalUsings.NotificationIdentifierType.cs:1-2`);
  MMCA.ADC declares 30 across Conference (17, alias file `:5-21`), Engagement (10, `:4-13`),
  Identity (1, `:2`) and Notification (2, `:1-2`); MMCA.Store declares 9 across Catalog (4), Sales (3)
  and Identity (2); MMCA.Helpdesk declares 2 in Tickets.
- **43 of the 44 resolve to `int`.** The single exception is ADC's
  `SpeakerIdentifierType = System.Guid`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:19`),
  which Sessionize forces. So for every practical purpose the whole workspace has **one** identifier
  CLR type, and the compiler sees 43 synonyms for it.
- **No wrapper-struct identifier type and no generator package exists anywhere.** A content sweep of
  the four `Source` trees for `Vogen` and `StronglyTypedId` returns nothing: not a package reference,
  not a project file entry, not a using. ADR-048's "considered and left unbuilt" is still literally
  true.

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
An **alias token** here is any `*IdentifierType` token other than the framework's own generic
parameter `TIdentifierType`, counted in the `.cs` and `.razor` files of the four `Source` trees on
2026-08-23, with tests, `bin` and `obj` excluded. On that rule the aliases appear **3,192 times across
1,001 files**: 187 occurrences in 80 files in MMCA.Common, 2,077 in 613 files in MMCA.ADC, 873 in 277
files in MMCA.Store, and 55 in 31 files in MMCA.Helpdesk. Excluding `TIdentifierType` is what makes
the framework figure honest: 538 of MMCA.Common's 725 `IdentifierType` hits are that generic
parameter, which a wrapper migration re-satisfies with a new type argument rather than rewrites call
site by call site. Every one of the 3,192 is a signature, a property, a generic argument, or a DTO
field that a wrapper migration would have to either change or prove it can leave alone. Because
MMCA.Common is a published package family released in lockstep
([ADR-016](016-lockstep-versioning-masstransit-pin.md)), the framework share of that count
is a breaking public-API change that all three consumers must absorb in a single sweep, and the
identifier type is a generic parameter on `BaseEntity<TIdentifierType>`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/BaseEntity.cs:14`), `IBaseDTO<TIdentifierType>`
(`MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/IBaseDTO.cs:9`) and
`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityDTOMapper.cs:14`)
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
  evidence available, and it does not support a 1,001-file change.
- **A partial migration is worse than either endpoint.** Wrapping some identifiers and not others
  produces a codebase where the absence of a compiler error means nothing, because the reader cannot
  tell whether a given call site is protected or merely un-migrated. The change is therefore
  all-or-nothing across four repositories, which is precisely what makes it expensive.
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
- **The exposure is unmitigated, not reduced.** This record buys no safety whatsoever. Every
  transposition ADR-048 could not catch is still uncatchable today, and the `CheckIn` constructor
  above is still a live example of a two-argument swap that compiles.
- **No detection either.** Nothing gates, lints, or tests for a suspicious identifier assignment.
  There is no analyzer, no fitness rule ([ADR-015](015-architecture-fitness-functions.md)), and no
  naming convention that a reviewer could mechanically check. Trigger 1 therefore depends on a
  production defect being *traced* to a transposition, and a wrong-user check-in is exactly the kind
  of defect that gets written off as a scanning mistake instead.
- **The migration price rises with the codebase.** The 3,192 occurrences counted here are a snapshot
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
type, and therefore in the migration's blast radius).

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
