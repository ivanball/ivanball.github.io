# ADR-128: Time as an Input (No Ambient Clock Reads in Domain and Application)

## Status
Accepted (2026-10-01). Revised 2026-10-06: async-lambda clock reads are attributed to, and exempted with, their source member.

## Context
Expiry windows, payment deadlines, discount windows, overdue checks and cutoffs are business rules,
and every one of them branches on "now". When the rule reads `DateTime.UtcNow` itself, a test cannot
choose which side of the branch it lands on: the branch is either untested or tested by sleeping
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Domain/ArchitectureRules.ClockReads.cs:30-36`).
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
  type full name (`:120-127`).
- **Scope is the map's Domain and Application layers.** `DomainAndApplicationDoNotReadTheClock`
  (`ArchitectureRules.ClockReads.cs:56`) collects the assemblies the repo's `IArchitectureMap`
  registers under `Layer.Domain` and `Layer.Application` (`:65-70`). Infrastructure, API and UI code
  is outside the rule.
- **The scan reads IL, not source.** Each assembly is opened with Mono.Cecil (`:78`) and every method
  body of every type is searched (`:80`, `:104`), which includes lambdas and async or iterator state
  machines whether the compiler emits them as nested types or as methods on the declaring type. A read
  in a lambda or in an async or iterator method is attributed back to the member the developer wrote,
  recovered from the generated name past every leading angle bracket, walking up generated nested
  types before falling back to the method name (`:129-171`), so the report reads
  `Type.Member reads DateTime.UtcNow` (`:114`). The name is cut at the first `>` after the leading
  brackets (`:158-170`), so the doubly bracketed state machine of an async lambda or async local
  function is attributed to the member that wrote it.
- **A vacuous scan is a failure.** A map that yields no Domain or Application assembly fails with that
  explanation rather than passing (`:72-73`).
- **The failure message is the instruction.** It names the fix (inject `TimeProvider`, pass the instant
  into the domain method) and the escape hatch (allowlist the type or `Type.Member`) (`:85-88`).
- **The framework exemption is exactly one type, built into the rule.** The constant
  `DomainEventOccurrenceStamp` is the type full name `MMCA.Common.Domain.DomainEvents.BaseDomainEvent`
  (`ArchitectureRules.ClockReads.cs:14`), prepended to every caller's allowlist (`:63`), so no map has
  to repeat it. Because the exemption is keyed on the owning type (`:98-102`), it covers the
  `DateOccurred` initializer compiled into `BaseDomainEvent` and nothing declared on a derived event.
- **The allowlist is an adoption ratchet.** Entries are a type full name, a namespace prefix, or one
  member written `Namespace.Type.Member` (`:45-48`); a member entry is matched by ordinal equality on
  `{owner}.{member}` (`:107`) and exempts that member's lambda, async-method and async-lambda bodies
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
- **MMCA.Store adopts it with one reviewed exemption.** Its subclass
  (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Domain/ClockReadTests.cs:9`) supplies
  `StoreArchitectureMap` (`:11`) and allowlists the single member
  `MMCA.Store.Sales.Domain.Orders.Order.RepublishFulfillment` (`:18-21`), documented as backfill-only:
  its one caller, the one-shot `OrderFulfilledBackfillService`, supplies no clock, and the member is
  removed with the backfill services (`:13-17`).
- **MMCA.Helpdesk does not adopt it.** Helpdesk has an architecture test project
  (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/`), but no type in the repo
  subclasses `ClockReadTestsBase` or calls the rule, so its Domain and Application code is not checked.

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
  (`ClockReadTestsBase.cs:10-12`). Store's single entry is the result of that pass.

## Trade-offs
- **The rule bans five getters, not the idea of a clock.** A read through any other path (a static
  `TimeProvider.System.GetUtcNow()`, `Environment.TickCount`, `Stopwatch`) is not matched
  (`ArchitectureRules.ClockReads.cs:20-27`), so the rule stops the common accident rather than proving
  the code is clock-free.
- **Infrastructure, API and UI are not scanned** (`:65-66`). Audit stamping and other infrastructure
  timestamps are expected to use an injected `TimeProvider` (`BaseDomainEvent.cs:22-23`), but this rule
  does not check that.
- **`DateOccurred` stays non-deterministic in tests.** Because the stamp is taken at construction, a test
  asserting an exact occurrence instant has to set it through the `init` accessor
  (`BaseDomainEvent.cs:28`) rather than through a fake clock.
- **The scan only covers assemblies present on disk.** Assemblies whose location is empty or missing
  are dropped before the scan (`ArchitectureRules.ClockReads.cs:68`); the vacuous-scan check fires only
  when none remain (`:72-73`).
- **A type or namespace entry exempts more than one read.** A type entry exempts every member of that
  type and a namespace entry every type under it (`:45-48`, `:98-102`), which is wider than a member
  entry; Store uses the narrow form.
- **MMCA.Helpdesk is unguarded.** As the reference app and template source, it hands an adopter no
  clock-read test until it subclasses the base.

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

## Related
[ADR-015](015-architecture-fitness-functions.md) (the fitness-function style and the shared
`*TestsBase` package this rule is shipped in),
[ADR-125](125-parameterized-sql-only.md) (the precedent for a fitness-gated convention with its own
record and an allowlist used as an adoption ratchet). Framework version and package figures live in
`MMCA.Common/FACTS.md`.
