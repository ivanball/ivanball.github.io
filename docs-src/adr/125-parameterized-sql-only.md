# ADR-125: Parameterized SQL Only, Enforced by a Fitness Gate

## Status
Accepted (2026-09-19). Revised 2026-10-01: citations refreshed and MMCA.Helpdesk counted as the fourth subclassing repo. Revised 2026-10-06: the relational limit is now a conditional registration that fails at container validation, not a `NotSupportedException` on the first statement. Revised 2026-10-07: the Cosmos-default failure is an unresolved-service error raised at startup only where the container is validated on build (Development under the default builder) and otherwise on first resolution, and the CHANGELOG anchors are refreshed after the v1.233.0 release. Revised 2026-10-21: the source comments now state the same Development-build versus first-resolution timing the ADR does, the `SET IDENTITY_INSERT` exemption is described as the SQL Server explicit-key insert dialect with a best-effort toggle-off on the failure path, and anchors are refreshed after v1.250.0. Revised 2026-10-26: anchors refreshed after v1.261.0. Revised 2026-10-28: anchors refreshed after v1.265.1.

## Context
The supported way to read data is the repository plus specification contract
([ADR-055](055-repository-and-specification-contract.md)), and LINQ answers almost everything. It does
not answer a window function, a recursive CTE or a vendor-specific operator, so a framework that
refuses hand-written SQL outright pushes those reads into whatever each module improvises. The
question is not whether raw SQL exists, it is what shape the one supported door has.

EF Core offers the dangerous and the safe form of every raw call as overloads that differ by one
word: `FromSqlRaw` beside `FromSql`, `SqlQueryRaw` beside `SqlQuery`, `ExecuteSqlRaw` and
`ExecuteSqlRawAsync` beside `ExecuteSql` and `ExecuteSqlInterpolated`. The `*Raw` half takes a plain
`string`, so a statement built by concatenating a caller-supplied value into a `WHERE` clause compiles
and runs, which makes injection a code-review question rather than a build failure, and every distinct
value produces its own statement text, so the server cannot reuse a plan. The interpolated half takes
a `FormattableString` and turns every hole into a command parameter. Worse, handing a
`FormattableString` to a raw overload compiles too and silently loses the parameters, which is exactly
the mistake a reviewer skims past
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Cqrs/RawSqlConventionTestsBase.cs:12-19`).
Two call sites that look identical, opposite safety, and the difference is three letters.

The framework also runs on four engines ([ADR-018](018-polyglot-persistence.md)), and one of them has
no SQL command surface at all, so "raw SQL" cannot be offered as a capability every host has. Before
v1.192.0 the landing shape for a raw scalar read was four keyless `ValReturn<T>` entities mapped to no
table and queried by nobody (`MMCA.Common/CHANGELOG.md:2096-2102`); the pair of additions this record
covers shipped in v1.192.0 (`MMCA.Common/CHANGELOG.md:1981`, the interface at `:2051-2060` and the
fitness base at `:2061-2064`).

## Decision
Give raw SQL exactly one door whose signature makes the unsafe call uncompilable, and ban the four raw
EF members in module code with a fitness test rather than a guideline.

- **The contract accepts `FormattableString` and nothing else.** `IRawSqlQueryExecutor`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRawSqlQueryExecutor.cs:25`)
  has two entry points, `QueryAsync<T>` (`:32`) and `QuerySingleOrDefaultAsync<T>` (`:40`), both typed
  `FormattableString`. A concatenated statement is a `string` and does not bind to either method, so
  injection on this path is a compile error rather than a review item, and the statement text stays
  stable across calls so the server keeps its plan (`:9-15`). `T` is a scalar or an unmapped DTO whose
  properties match the selected columns by name (`:28`, `:35`). The interface lives in Application, so
  a module reaches hand-written SQL without referencing EF Core.
- **The relational limit is explicit and named, not implied.** `EFRawSqlQueryExecutor`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/EFRawSqlQueryExecutor.cs:29`)
  resolves the host's default physical source (`:51`), and it is registered only when that default
  source is on a relational engine
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:435`, registration at
  `:437`). A Cosmos-default host has no registration, so a service that injects the interface there
  fails with an unresolved-service error rather than on its first statement. The interface
  (`IRawSqlQueryExecutor.cs:17-23`), the executor (`EFRawSqlQueryExecutor.cs:19-25`) and the
  registration method (`DependencyInjection.cs:416-422`) all document the missing registration and
  its timing: at container build in Development, where the default host validates the container, and
  on first resolution elsewhere (`IRawSqlQueryExecutor.cs:21-22`, `EFRawSqlQueryExecutor.cs:23-24`,
  `DependencyInjection.cs:420-421`). No host in the four repos sets `ValidateOnBuild` itself, and the
  hosts that register the executor build through `WebApplication.CreateBuilder` (for example
  `MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:12`), so the container is validated at
  startup only where the default builder turns validation on (the Development environment), and
  elsewhere the error appears the first time a dependent service is resolved.
- **The statement joins the caller's unit of work.** The executor takes its context from the scoped
  `IDbContextFactory` and calls EF's `Database.SqlQuery<T>` on it (`EFRawSqlQueryExecutor.cs:52`), so
  the read shares the caller's connection and any transaction an `ITransactional` command opened. It is
  registered scoped, by the call that follows the singleton `IQueryableExecutor` and deliberately not a
  singleton itself (`DependencyInjection.cs:116`, the sibling at `:111` and the reason at `:113-115`;
  the scoped registration itself at `:437`), and is `internal sealed` (`EFRawSqlQueryExecutor.cs:29`),
  so the abstraction is the only public surface.
- **The ban is a test, not a paragraph.** `ModuleCode_UsesParameterizedSqlOnly`
  (`RawSqlConventionTestsBase.cs:66`) scans the `.cs` files of every mapped module and fails on member
  access to `FromSqlRaw`, `SqlQueryRaw`, `ExecuteSqlRaw` or `ExecuteSqlRawAsync` (`:115`), skipping
  whole-line comment lines (`:105`). The failure message names the four members, says why they are
  unsafe, and names the replacements (`:90-94`), so the test output is the instruction.
- **A vacuous scan is a failure, not a pass.** If the map declares no modules or the project folders
  moved, the run finds no directories and the test fails with an explanation and a pointer to the
  override (`:68-72`), so the gate cannot quietly stop checking anything.
- **Scope is every project a module owns, not just its Application layer.** The default scan walks the
  repo's `Source/` tree for each project name the map attributes to a business module (`:48-63`),
  because a raw statement is as dangerous in a module's Infrastructure as in its Application.
- **`AllowedFiles` is an adoption ratchet, and today it holds one entry across four repos.** The base
  declares it empty (`:39`) and skips a file whose name is listed (`:81`). MMCA.Common lists exactly
  one file, `DbContextFactory.cs`, with the reason inline
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Cqrs/RawSqlConventionTests.cs:25-32`):
  the `SET IDENTITY_INSERT` statement has no parameterized form, because a T-SQL identifier cannot be a
  command parameter, and the schema and table names are read off EF model metadata rather than caller
  input
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:424-426`,
  the OFF statement built at `:428` and run at `:443`, or best-effort through `TryToggleOffAsync` at
  `:439` when the save fails, both built from the identity group's schema and table). The statement
  comes from the engine's explicit-key insert dialect (selected at `DbContextFactory.cs:296` and passed
  to the call site at `:389`), and SQL Server
  is the one engine that implements it
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/Engines/SQLServerDataSourceEngine.cs:162-163`).
  That call site also carries the matching Sonar `S2077` suppression with the same reasoning
  (`DbContextFactory.cs:423`, restored at `:445`), so the exemption is stated twice and names its
  justification in both places. MMCA.ADC declares no override, so it inherits the empty list
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Cqrs/RawSqlConventionTests.cs:14-16`, with
  the reason written in its class documentation at `:10-12`), and MMCA.Store declares the empty list
  explicitly
  (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Cqrs/RawSqlConventionTests.cs:18`).
  MMCA.Helpdesk leaves the list un-overridden on purpose, so the scaffold hands an adopter an empty list
  rather than an inherited exemption
  (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:186-190`).
  The three application repos therefore start at zero: the rule blocks every new raw call site rather than
  ratcheting down from an inherited set.
- **All four repos subclass the same body.** MMCA.Common declares no business modules, so its subclass
  redirects the scan onto the framework's own Application and Infrastructure projects
  (`RawSqlConventionTests.cs:17-22`), on the grounds that the one place shipping a raw-SQL surface is
  the one place that must not leave a concatenated statement lying around as the example. MMCA.ADC
  keeps the base scan and appends the thin Notification module, which is not a mapped module
  (`RawSqlConventionTests.cs:24-33`). MMCA.Store takes the base scan unchanged
  (`RawSqlConventionTests.cs:12`, `:15`), and so does MMCA.Helpdesk
  (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:191-194`).

## Rationale
- **A signature outranks a guideline.** Both halves of this decision aim at the same thing from
  different directions: the contract removes the unsafe call from the type system, and the fitness test
  removes the unsafe call from the code that never touches the contract. Either alone leaves a door
  open (the interface does not stop a module calling EF directly; the test does not give a module
  anywhere good to go), which is why both shipped in one release.
- **Executable beats documented.** This is the enforcement style
  [ADR-015](015-architecture-fitness-functions.md) sets and
  [ADR-109](109-feature-by-folder-convention.md) applies to folder layout: a convention that exists
  only in prose gets followed until somebody is in a hurry, while a failing test whose message names
  the fix needs nobody to remember anything.
- **Plan stability is the second prize and it is not small.** The parameterized form keeps one
  statement text across every value, so the server reuses its cached plan instead of compiling one per
  distinct literal.
- **An empty ratchet is worth stating.** The `AllowedFiles` list exists so a repo with existing raw
  call sites can adopt the rule the day it lands instead of after a cleanup. Three of the four repos
  needed nothing, and the fourth needed one file for a statement T-SQL cannot parameterize at all, so
  the exemption surface is a known, justified constant rather than a growing list.
- **Relational-only is a stated limit rather than an assumption.** Under
  [ADR-018](018-polyglot-persistence.md) a host can default to Cosmos DB, which speaks its own query
  language. Withholding the registration on such a host turns the limit into a dependency-resolution
  failure (at startup where the container is validated, otherwise when the first dependent service
  is resolved), which is earlier and more legible than a provider-level error on the first
  statement; the real options stay the same (express the read with LINQ, or move the entity to a
  relational source).

## Trade-offs
- **`FormattableString` blocks the accident, not the intent.** `FormattableStringFactory.Create` builds
  a `FormattableString` out of an already-concatenated string with no interpolation holes, and the
  executor accepts it like any other. The contract makes the careless path uncompilable and leaves a
  deliberate one open, so this is a large reduction in exposure, not a proof of safety.
- **Interpolating an identifier fails at the server.** Every hole becomes a parameter, so a table or
  column name interpolated into the statement produces an error at execution time rather than working.
  That is the correct outcome and it is still a runtime failure, which is precisely why
  `SET IDENTITY_INSERT` needed an exemption instead of a rewrite.
- **The fitness test is a textual scan with the limits of one.** The package carries no IL or Roslyn
  dependency, and reflection cannot see member usage inside method bodies, so the rule reads source
  text (`RawSqlConventionTestsBase.cs:21-28`). A match inside a string literal or a trailing comment is
  a false positive that has to be parked in `AllowedFiles`, and the regex names exactly four EF members
  (`:115`), so concatenated SQL reaching the database some other way (raw ADO.NET, a micro-ORM, a
  stored procedure body) is not matched at all.
- **`AllowedFiles` matches on file name, not path** (`:81`). Exempting `DbContextFactory.cs` exempts
  every file with that name inside the scanned directories, which is a wider hole than the entry reads.
- **The default scan covers module code only** (`:48-63`). Host and service projects, migrations
  projects and test projects are outside it unless a subclass adds them, which is what MMCA.Common's
  subclass does for the framework projects and MMCA.ADC's does for its Notification module.
- **One source, the default one.** The executor resolves the host's default physical source
  (`EFRawSqlQueryExecutor.cs:51`), so a statement that must run against a named non-default source has
  no route through this interface today.
- **The Cosmos refusal is discovered at run time, not at compile time.** The missing registration is
  documented (`IRawSqlQueryExecutor.cs:18-22`), but it surfaces as a resolution failure: at host
  startup only where the container is validated on build (the Development environment under the
  default builder), otherwise on the first resolution of a dependent service. Nothing at compile
  time tells a module author that the host it will be deployed into defaults to a non-relational engine.

## Revision (2026-10-01)
No decision or rationale changed. Citations refreshed: the CHANGELOG anchors (`MMCA.Common/CHANGELOG.md:1038`,
`:1108-1117`, `:1118-1121`, `:1153-1159`), the executor registration (`DependencyInjection.cs:110`, sibling
`:105`, reason `:107-109`) and the `SET IDENTITY_INSERT` call site (`DbContextFactory.cs:410-425`,
metadata at `:470-471`). The repo count moves from three to four: MMCA.Helpdesk also subclasses
`RawSqlConventionTestsBase` and leaves `AllowedFiles` empty
(`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:186-194`), so the
ratchet still holds one entry across all four repos.

## Revision (2026-10-06)
- The relational limit changed shape in v1.218.0 (`MMCA.Common/CHANGELOG.md:286`): the executor no
  longer throws `NotSupportedException` naming Cosmos DB. It is registered only when the default
  source is relational (`DependencyInjection.cs:409-411`), so a Cosmos-default host that injects
  `IRawSqlQueryExecutor` fails at container validation. The Decision, Rationale and Trade-offs bullets
  now say so. The v1.192.0 entry (`CHANGELOG.md:1449-1458`) still records the original exception, as a
  dated entry should.
- The registration is now the `AddRawSqlQueryExecutor` call after the singleton `IQueryableExecutor`
  (`DependencyInjection.cs:116`, sibling `:111`, reason `:113-115`), not a direct scoped registration;
  the executor is `internal sealed`.
- The `SET IDENTITY_INSERT` statements take their schema and table from the identity group
  (`DbContextFactory.cs:422`, `:432`); the EF metadata origin is stated in the `S2077` suppression
  comment (`:420`).
- All live-section anchors were re-verified against current source (executor, interface,
  `DependencyInjection.cs`, `DbContextFactory.cs`, CHANGELOG); the 2026-10-01 anchors above are left as
  recorded on that date.

## Revision (2026-10-07)
Re-verified against current source. The decision, the executor, the interface, the fitness base, the
one-entry `AllowedFiles` ratchet and every consumer subclass are unchanged. Three things moved: the
timing of the Cosmos-default failure was stated more strongly than the hosts support, the `T`-shape
anchor on `QueryAsync<T>` was one line early, and every CHANGELOG anchor shifted by 25 lines when the
v1.232.1 and v1.233.0 entries (`MMCA.Common/CHANGELOG.md:7-31`) landed above v1.192.0.

1. The Cosmos-default failure is an unresolved-service error whose timing depends on the host. No host
   in the four repos sets `ValidateOnBuild` (no match in any of their source trees); the hosts that
   register the executor build through `WebApplication.CreateBuilder` (for example
   `MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:12`), whose default validates the container
   on build only in the Development environment. Elsewhere the error surfaces the first time a
   dependent service is resolved. The Decision, Rationale and Trade-offs bullets now say so; the
   registration itself is unchanged (`DependencyInjection.cs:409-411`). The source comments still say
   "fails when the container is validated" (`IRawSqlQueryExecutor.cs:21`,
   `EFRawSqlQueryExecutor.cs:22-23`, `DependencyInjection.cs:394-395`), which is the narrower wording
   this revision corrects; they are left for a source change.
2. The `QueryAsync<T>` row-shape `typeparam` is at `IRawSqlQueryExecutor.cs:27`, not `:26` (the
   method `summary`).
3. Anchors re-verified against current source: the v1.192.0 header (`MMCA.Common/CHANGELOG.md:1404`),
   the `IRawSqlQueryExecutor` entry (`:1474-1483`, still ending on the original
   `NotSupportedException` sentence at `:1483`), the `RawSqlConventionTestsBase` entry
   (`:1484-1487`) and the `ValReturn<T>` removal (`:1519-1525`). The v1.218.0 conditional registration
   bullet cited by the 2026-10-06 revision is now `:311`; that revision, and the 2026-10-06 sentence in
   Status, are left as recorded on their date.

## Revision (2026-10-21)
Re-verified against current source. The decision, the `FormattableString`-only contract, the
conditional relational registration, the fitness base, the one-entry `AllowedFiles` ratchet and every
consumer subclass are unchanged. Two things moved in substance: the source comments caught up with
the timing this ADR already states, and the `SET IDENTITY_INSERT` failure path now turns the toggle
off best-effort through `TryToggleOffAsync` (`MMCA.Common/CHANGELOG.md:98`, v1.247.0), with the
success-path OFF moved out of the `finally` block to `DbContextFactory.cs:443`. The engine dialect
that builds the statements predates this ADR's v1.233.0 baseline (it arrived in v1.218.0), so this
revision only records its anchors. Anchors that moved with the releases since v1.233.0 are refreshed
below; the rest (for example the `RawSqlConventionTestsBase.cs` anchors, the consumer subclass
anchors and `DependencyInjection.cs:111`, `:113-115`, `:116`) still hold as cited.

1. The interface, the executor and the registration method now word the Cosmos-default failure as
   at container build in Development, where the default host validates the container, and on first
   resolution elsewhere (`IRawSqlQueryExecutor.cs:21-22`; the executor and the registration method
   use a semicolon in place of ", and", `EFRawSqlQueryExecutor.cs:23-24`,
   `DependencyInjection.cs:401-402`), so the Decision bullet no longer calls the source wording
   narrower than the hosts' behavior. The 2026-10-07 revision's note on the stale wording is left as
   recorded on its date.
2. The `SET IDENTITY_INSERT` statements are built by the engine's explicit-key insert dialect
   (selected at `DbContextFactory.cs:296`, passed in at `:389`, used at `:425` and `:428`), and SQL
   Server is the one engine that implements it
   (`SQLServerDataSourceEngine.cs:162-163`). The OFF statement runs at `DbContextFactory.cs:443` after a
   successful save, and through the best-effort `TryToggleOffAsync` (`:439`, defined at `:463`) when
   the save fails. The exemption reasoning is unchanged.
3. Anchors re-verified against current source: `IRawSqlQueryExecutor.cs` interface `:25`,
   `QueryAsync<T>` `:32`, `QuerySingleOrDefaultAsync<T>` `:40`, row-shape `typeparam`s `:28` and
   `:35`, relational-limit paragraph `:17-23`; `EFRawSqlQueryExecutor.cs` class `:29`, default-source
   resolution `:51`, `Database.SqlQuery<T>` `:52`, relational-limit paragraph `:19-25`;
   `DependencyInjection.cs` `AddRawSqlQueryExecutor` docs `:397-403`, relational check `:416`,
   scoped registration `:418` (call site `:116`, sibling `:111`, reason `:113-115` unchanged);
   `DbContextFactory.cs` ON statement `:424-426`, `S2077` suppression `:423` restored at `:445`;
   `MMCA.Common/CHANGELOG.md` v1.192.0 header `:1723`, `IRawSqlQueryExecutor` entry `:1793-1802`
   (still ending on the original `NotSupportedException` sentence at `:1802`),
   `RawSqlConventionTestsBase` entry `:1803-1806`, `ValReturn<T>` removal `:1838-1844`; the v1.218.0
   conditional registration bullet is now `:630` (header `:623`). The earlier revisions and Status
   sentences keep their anchors as recorded on their dates.

## Revision (2026-10-26)
Re-verified against current source. The decision, the `FormattableString`-only contract, the
conditional relational registration and its timing, the fitness base, the one-entry `AllowedFiles`
ratchet and every consumer subclass are unchanged. Only anchors moved: `DependencyInjection.cs` grew
above `AddRawSqlQueryExecutor`, so the old `:397-403` range now points into unrelated documentation,
and every CHANGELOG anchor shifted as the releases through v1.261.0 landed above v1.192.0.

1. Anchors re-verified against current source: `DependencyInjection.cs` `AddRawSqlQueryExecutor`
   summary `:416-422` (timing wording `:420-421`, method `:426`), relational check `:435`, scoped
   registration `:437` (call site `:116`, sibling `:111`, reason `:113-115` unchanged);
   `MMCA.Common/CHANGELOG.md` v1.192.0 header `:1938`, `IRawSqlQueryExecutor` entry `:2008-2017`
   (still ending on the original `NotSupportedException` sentence at `:2017`),
   `RawSqlConventionTestsBase` entry `:2018-2021`, `ValReturn<T>` removal `:2053-2059`; the v1.218.0
   conditional registration bullet is now `:845` (header `:838`); the v1.247.0 failure-path toggle-off
   entry is `:313` (header `:260`, item M229), which describes the guarded `IDENTITY_INSERT` toggle-off
   without naming `TryToggleOffAsync`. The `DbContextFactory.cs` anchors (`:296`, `:389`, `:423`,
   `:439`, `:445`) still hold as cited. The earlier revisions and Status sentences keep their anchors
   as recorded on their dates.

## Revision (2026-10-28)
Re-verified against current source. The decision, the `FormattableString`-only contract, the
conditional relational registration and its timing, the fitness base, the one-entry `AllowedFiles`
ratchet and every consumer subclass are unchanged. Only CHANGELOG anchors moved, by 43 lines, as the
releases through v1.265.1 (`MMCA.Common/CHANGELOG.md:7`) landed above v1.192.0; the entry text still
matches what this record describes.

1. Anchors re-verified against current source: `MMCA.Common/CHANGELOG.md` v1.192.0 header `:1981`,
   `IRawSqlQueryExecutor` entry `:2051-2060` (still ending on the original `NotSupportedException`
   sentence at `:2060`), `RawSqlConventionTestsBase` entry `:2061-2064`, `ValReturn<T>` removal
   `:2096-2102` (its `IRawSqlQueryExecutor` mention at `:2099`); the v1.218.0 conditional registration
   bullet is now `:888` (header `:881`); the v1.247.0 failure-path toggle-off entry is `:356` (header
   `:303`, item M229). `DependencyInjection.cs` (`:111`, `:116`, `:426`, `:435`, `:437`),
   `EFRawSqlQueryExecutor.cs` (`:29`, `:52`) and `DbContextFactory.cs` (`:296`, `:389`, `:423`,
   `:439`, `:445`, `:463`) still hold as cited. The earlier revisions and Status sentences keep their
   anchors as recorded on their dates.

## Related
[ADR-055](055-repository-and-specification-contract.md) (the repository plus specification path this
escape hatch sits beside, and the reason the hatch stays narrow),
[ADR-015](015-architecture-fitness-functions.md) (the fitness-function style this rule is written in,
including the shared `*TestsBase` package all four repos subclass),
[ADR-018](018-polyglot-persistence.md) (the four-engine model that makes "relational only" a real
constraint rather than a formality),
[ADR-109](109-feature-by-folder-convention.md) (the same move applied to folder layout: a convention
becomes a test rather than a paragraph), ADR-006 (one context class per engine and one instance per
database, which is what the executor resolves its context through). Framework version and package
figures live in `MMCA.Common/FACTS.md`.
