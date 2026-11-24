# ADR-128: Time as an Input (No Ambient Clock Reads in Domain and Application)

## Status
Accepted (2026-10-01). Revised 2026-10-06: async-lambda clock reads are attributed to, and exempted with, their source member. Revised 2026-10-07: anchors refreshed after the v1.233.0 release. Revised 2026-11-23: all four repos now adopt the rule and none overrides `AllowedClockReaders` (Store's backfill member entry went with the deleted member and Helpdesk subclasses the base). Amended 2026-11-24: the scan reads IL through the testing package's own `System.Reflection.Metadata` reader instead of Mono.Cecil (MMCA.Common 1.318.0); the rule, its scope and its verdicts are unchanged. See Amendment (2026-11-24) at the end.

## Context
Expiry windows, payment deadlines, discount windows, overdue checks and cutoffs are business rules,
and every one of them branches on "now". When the rule reads `DateTime.UtcNow` itself, a test cannot
choose which side of the branch it lands on: the branch is either untested or tested by sleeping
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Domain/ArchitectureRules.ClockReads.cs:29-37`).
.NET already ships the input that removes the problem, `TimeProvider`, which a handler can take by
injection and a test can replace with a fake clock.

The convention existed before it was enforced, and a convention that lives only in prose is followed
until someone is in a hurry. It also has one place where reading the clock is the correct model:
a domain event's occurrence instant is, by definition, the moment the aggregate raises it, so
`BaseDomainEvent.DateOccurred` defaults to `DateTime.UtcNow` at construction
(`MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/BaseDomainEvent.cs:28`, with the reasoning in
the type's remarks at `:18-25`). Any enforcement has to accept that one stamp without turning into a
list every consumer has to repeat.

The rule shipped as a fitness base in MMCA.Common v1.210.0, v1.213.0 extended it to `DateTime.Today`,
and v1.232.0 attributed a read inside an async lambda or async local function to the member that
wrote it (L142); each change is recorded under its version in `MMCA.Common/CHANGELOG.md`. [ADR-015](015-architecture-fitness-functions.md) sets the fitness-function style it is
written in but does not list this rule, so this record states it.

## Decision
Domain and Application code takes time as an input and never reads the ambient clock. A handler
injects `TimeProvider` and passes the instant into the domain method; an aggregate method receives the
instant as a parameter. The rule is an IL-scanning fitness test, shipped once in
`MMCA.Common.Testing.Architecture` and subclassed by each adopting repo.

- **Five getters are banned.** `DateTime.UtcNow`, `DateTime.Now`, `DateTime.Today`,
  `DateTimeOffset.UtcNow` and `DateTimeOffset.Now`, matched as (declaring type, getter) pairs
  (`ArchitectureRules.ClockReads.cs:20-27`) by ordinal comparison of the callee name and declaring
  type full name (`:123-130`).
- **Scope is the map's Domain and Application layers.** `DomainAndApplicationDoNotReadTheClock`
  (`ArchitectureRules.ClockReads.cs:59`) collects the assemblies the repo's `IArchitectureMap`
  registers under `Layer.Domain` and `Layer.Application` (`:68-73`). Infrastructure, API and UI code
  is outside the rule.
- **The scan reads IL, not source.** Each assembly is opened with Mono.Cecil (`:81`) and every method
  body of every type is searched (`:83`, `:107`), which includes lambdas and async or iterator state
  machines whether the compiler emits them as nested types or as methods on the declaring type. A read
  in a lambda or in an async or iterator method is attributed back to the member the developer wrote,
  recovered from the generated name past every leading angle bracket, walking up generated nested
  types before falling back to the method name (`:132-174`), so the report reads
  `Type.Member reads DateTime.UtcNow` (`:117`). The name is cut at the first `>` after the leading
  brackets (`:159-173`), so the doubly bracketed state machine of an async lambda or async local
  function is attributed to the member that wrote it.
- **A vacuous scan is a failure.** A map that yields no Domain or Application assembly fails with that
  explanation rather than passing (`:75-76`).
- **The failure message is the instruction.** It names the fix (inject `TimeProvider`, pass the instant
  into the domain method) and the escape hatch (allowlist the type or `Type.Member`) (`:86-91`).
- **The framework exemption is exactly one type, built into the rule.** The constant
  `DomainEventOccurrenceStamp` is the type full name `MMCA.Common.Domain.DomainEvents.BaseDomainEvent`
  (`ArchitectureRules.ClockReads.cs:14`), prepended to every caller's allowlist (`:66`), so no map has
  to repeat it. Because the exemption is keyed on the owning type (`:101-105`), it covers the
  `DateOccurred` initializer compiled into `BaseDomainEvent` and nothing declared on a derived event.
- **The allowlist is an adoption ratchet.** Entries are a type full name, a namespace prefix, or one
  member written `Namespace.Type.Member` (`:48-51`); a member entry is matched by ordinal equality on
  `{owner}.{member}` (`:110`) and exempts that member's lambda, async-method and async-lambda bodies
  with it. The base
  exposes it as `AllowedClockReaders`, empty by default
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Domain/ClockReadTestsBase.cs:24`),
  and its documentation asks for a comment saying why each entry is right (`:10-12`).
- **The base is one fact over one map.** `ClockReadTestsBase` (`ClockReadTestsBase.cs:15`) declares an
  abstract `Map` (`:17`) and one `[Fact]`, `DomainAndApplication_ShouldNotReadTheAmbientClock`, that
  calls the rule (`:26-28`).
- **MMCA.Common adopts it over its own code and self-tests the rule.** Its subclass
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Domain/ClockReadTests.cs:14`) maps the
  framework through `CommonArchitectureMap` (`:20`) with no allowlist, and runs the rule against
  compiled fixtures through a map whose Domain layer is the test assembly (`:97-106`): direct reads of
  both clock types are flagged (`:22-29`), `DateTime.Today` is flagged (`:31-35`), lambda and async
  reads are attributed to their source member (`:37-48`), a read inside an async lambda is attributed
  to its source member and exempted by that member's entry (`:53-62`), an injected `TimeProvider` is
  not flagged (`:64-68`), a member entry exempts only that member (`:70-77`), and a namespace entry
  exempts every type under it (`:79-81`).
- **MMCA.ADC adopts it with no exemptions.** Its subclass
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Domain/ClockReadTests.cs:8`) supplies
  `AdcArchitectureMap` (`:10`) and does not override `AllowedClockReaders`.
- **MMCA.Store adopts it with no exemptions.** Its subclass
  (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Domain/ClockReadTests.cs:9`) supplies
  `StoreArchitectureMap` (`:11`) and does not override `AllowedClockReaders`.
- **MMCA.Helpdesk adopts it with no exemptions.** Its subclass
  (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/Domain/ClockReadTests.cs:14`)
  supplies `HelpdeskArchitectureMap` (`:16`) and deliberately does not override `AllowedClockReaders`:
  an entry names a full type or member, so one written in the template source would name the seed's
  own types and cover nothing in a module an adopter scaffolds (`:9-12`).

## Rationale
- **A test can only drive what it can supply.** Passing the instant in makes every time-dependent
  branch a plain input, so an expiry, a cutoff or an overdue state is one argument away in a unit test
  instead of a `Task.Delay` or an untested path (`ArchitectureRules.ClockReads.cs:33-35`).
- **Executable beats documented.** This is the enforcement style
  [ADR-015](015-architecture-fitness-functions.md) sets and
  [ADR-125](125-parameterized-sql-only.md) applies to raw SQL: a failing test whose message names the
  fix needs nobody to remember the convention.
- **IL is the only layer that sees the whole shape.** A reflection-only rule cannot see calls inside
  method bodies, and a text scan would miss a read hidden behind a `using static` or flag one inside a
  comment. Mono.Cecil reads what the compiler actually emitted, including lambda and state-machine
  bodies, at the cost of a dependency NetArchTest already carries (`:40-43`).
- **The one framework exemption belongs to the framework.** `DateOccurred` is a deliberate modelling
  choice (`BaseDomainEvent.cs:18-25`), and every repo whose map registers the framework Domain assembly
  would otherwise need the same entry (`ArchitectureRules.ClockReads.cs:7-13`). Building it into the
  rule keeps every consumer allowlist to its own decisions.
- **An allowlist lets a repo adopt the day the rule ships.** A repo with existing reads subclasses, runs
  once, and either threads the instant through or parks the reported member with a reason
  (`ClockReadTestsBase.cs:10-12`). No adopting repo carries an entry today: MMCA.Common, MMCA.ADC and
  MMCA.Helpdesk never needed one, and MMCA.Store's only entry went when the member it named was
  deleted (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Domain/ClockReadTests.cs:9-12`).

## Trade-offs
- **The rule bans five getters, not the idea of a clock.** A read through any other path (a static
  `TimeProvider.System.GetUtcNow()`, `Environment.TickCount`, `Stopwatch`) is not matched
  (`ArchitectureRules.ClockReads.cs:20-27`), so the rule stops the common accident rather than proving
  the code is clock-free.
- **Infrastructure, API and UI are not scanned** (`:68-69`). Audit stamping and other infrastructure
  timestamps are expected to use an injected `TimeProvider` (`BaseDomainEvent.cs:22-23`), but this rule
  does not check that.
- **`DateOccurred` stays non-deterministic in tests.** Because the stamp is taken at construction, a test
  asserting an exact occurrence instant has to set it through the `init` accessor
  (`BaseDomainEvent.cs:28`) rather than through a fake clock.
- **The scan only covers assemblies present on disk.** Assemblies whose location is empty or missing
  are dropped before the scan (`ArchitectureRules.ClockReads.cs:71`); the vacuous-scan check fires only
  when none remain (`:75-76`).
- **A type or namespace entry exempts more than one read.** A type entry exempts every member of that
  type and a namespace entry every type under it (`:48-51`, `:101-105`), which is wider than a member
  entry; prefer the member form when an entry is genuinely needed.

## Revision (2026-10-06)
- Since MMCA.Common v1.232.0 (L142) a read inside an async lambda or async local function is
  attributed to the member that wrote it: the name is read past every leading angle bracket and
  generated nested types are walked up (`ArchitectureRules.ClockReads.cs:134-171`), so a member
  allowlist entry now exempts it. The two statements that such a name keeps a leading `<` are
  retracted.
- MMCA.Common's self-tests gained the async-lambda attribution-and-exemption case
  (`ClockReadTests.cs:53-62`); the Decision bullet lists it.
- CHANGELOG citations now name versions only, since the file grows at the top every release.
- Every remaining `path:line` anchor was re-verified against current source.

## Revision (2026-10-07)
Re-verified against current source. The decision, the five banned getters, the scope, the
attribution, the single framework exemption and the adoption picture (Common and ADC with no
exemptions, Store with one member entry, Helpdesk not adopting) are unchanged. Only line anchors into
`ArchitectureRules.ClockReads.cs` moved, by about three lines below the getter table, so the 2026-10-06
statement that every anchor was re-verified no longer held for that file.

1. Anchors re-verified against current source:
   `ArchitectureRules.ClockReads.cs:29-37` (Context summary), `:59` (rule method), `:68-73`
   (Domain and Application assembly collection), `:68-69` (Infrastructure, API and UI out of scope),
   `:71` (file-exists filter), `:75-76` (vacuous-scan check), `:81` (`ReadModule`), `:83` (type scan),
   `:107` (method-body loop), `:86-91` (failure message), `:66` (allowlist prepend), `:101-105` (owner
   exemption), `:48-51` (allowlist entry forms), `:110` (member match), `:117` (report format),
   `:123-130` (getter match), `:132-174` (source-member attribution), `:159-173` (name cut). Unchanged
   and confirmed: `ArchitectureRules.ClockReads.cs:7-13`, `:14`, `:20-27`, `:33-35`, `:40-43`;
   `BaseDomainEvent.cs:18-25`, `:28`; `ClockReadTestsBase.cs:10-12`, `:15`, `:17`, `:24`, `:26-28`;
   the Common, ADC and Store `ClockReadTests.cs` anchors. The anchors inside the 2026-10-06 revision
   stay as written.

## Revision (2026-11-23)
Re-verified against current source. The decision, the five banned getters, the scope, the IL scan,
the attribution, the single framework exemption and the base are unchanged. The adoption picture
moved: all four repos now subclass the base, and none overrides `AllowedClockReaders`.

1. MMCA.Store carries no exemption. Its subclass is the map alone
   (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Domain/ClockReadTests.cs:9-12`), and
   neither `Order.RepublishFulfillment` nor `OrderFulfilledBackfillService` exists in the Store source
   any more, so the member entry and its backfill-only note are gone. The Decision bullet, the
   Rationale's "Store's single entry" sentence and the Trade-offs' "Store uses the narrow form" clause
   are rewritten to match.
2. MMCA.Helpdesk adopts the rule
   (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/Domain/ClockReadTests.cs:14`,
   map at `:16`) with `AllowedClockReaders` deliberately not overridden (`:9-12`). The Decision bullet
   saying Helpdesk does not adopt it is replaced, and the "MMCA.Helpdesk is unguarded" trade-off is
   removed.
3. Anchors re-verified against current source:
   `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Domain/ClockReadTests.cs:14`, `:20`;
   `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Domain/ClockReadTests.cs:8`, `:10`;
   `ClockReadTestsBase.cs:24`, `:26-28`; the Store and Helpdesk anchors above. The anchors inside the
   2026-10-06 and 2026-10-07 revisions stay as written.

## Amendment (2026-11-24): the IL reader is the package's own
**Decision.** The rule still reads IL, not source, and its scope, exemptions and attribution are
unchanged. The reader changes: `MMCA.Common.Testing.Architecture` no longer carries NetArchTest or its
Mono.Cecil, so each Domain and Application assembly is opened with the package's own
`MetadataModule` over `System.Reflection.Metadata`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Domain/ArchitectureRules.ClockReads.cs:81`;
`.../Metadata/MetadataModule.cs:25`) and every method body is walked through its IL reader
(`ArchitectureRules.ClockReads.cs:124`; `.../Metadata/IlReader.cs:52`). "Opened with Mono.Cecil" in the
Decision and "at the cost of a dependency NetArchTest already carries" in the Rationale are superseded:
the IL view now costs no package at all ([ADR-015](015-architecture-fitness-functions.md),
Amendment (2026-11-24)).

## Related
[ADR-015](015-architecture-fitness-functions.md) (the fitness-function style and the shared
`*TestsBase` package this rule is shipped in),
[ADR-125](125-parameterized-sql-only.md) (the precedent for a fitness-gated convention with its own
record and an allowlist used as an adoption ratchet). Framework version and package figures live in
`MMCA.Common/FACTS.md`.
