# ADR-125: Parameterized SQL Only, Enforced by a Fitness Gate

## Status
Accepted (2026-09-19).

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
table and queried by nobody (`MMCA.Common/CHANGELOG.md:645-651`); the pair of additions this record
covers shipped in v1.192.0 (`MMCA.Common/CHANGELOG.md:530`, the interface at `:600-609` and the
fitness base at `:610-613`).

## Decision
Give raw SQL exactly one door whose signature makes the unsafe call uncompilable, and ban the four raw
EF members in module code with a fitness test rather than a guideline.

- **The contract accepts `FormattableString` and nothing else.** `IRawSqlQueryExecutor`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRawSqlQueryExecutor.cs:23`)
  has two entry points, `QueryAsync<T>` (`:31`) and `QuerySingleOrDefaultAsync<T>` (`:40`), both typed
  `FormattableString`. A concatenated statement is a `string` and does not bind to either method, so
  injection on this path is a compile error rather than a review item, and the statement text stays
  stable across calls so the server keeps its plan (`:9-15`). `T` is a scalar or an unmapped DTO whose
  properties match the selected columns by name (`:26`, `:34`). The interface lives in Application, so
  a module reaches hand-written SQL without referencing EF Core.
- **The relational limit is explicit and named, not implied.** `EFRawSqlQueryExecutor`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/EFRawSqlQueryExecutor.cs:22`)
  resolves the host's default physical source (`:45`) and throws `NotSupportedException` naming Cosmos
  DB and the two alternatives when that source is not relational (`:46-52`), which is the same boundary
  the interface documents (`IRawSqlQueryExecutor.cs:18-20`, `:30`, `:39`).
- **The statement joins the caller's unit of work.** The executor takes its context from the scoped
  `IDbContextFactory` and calls EF's `Database.SqlQuery<T>` on it (`EFRawSqlQueryExecutor.cs:54`), so
  the read shares the caller's connection and any transaction an `ITransactional` command opened. It is
  registered scoped, one line below the singleton `IQueryableExecutor` and deliberately not a singleton
  itself
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:126`, the sibling at
  `:121` and the reason at `:123-125`), and is `internal`,
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
- **`AllowedFiles` is an adoption ratchet, and today it holds one entry across three repos.** The base
  declares it empty (`:39`) and skips a file whose name is listed (`:81`). MMCA.Common lists exactly
  one file, `DbContextFactory.cs`, with the reason inline
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Cqrs/RawSqlConventionTests.cs:25-32`):
  the `SET IDENTITY_INSERT` statement has no parameterized form, because a T-SQL identifier cannot be a
  command parameter, and the schema and table names are read off EF model metadata rather than caller
  input
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:343-344`,
  the OFF statement at `:353-354`). That call site also carries the matching Sonar `S2077` suppression
  with the same reasoning (`:342`, restored at `:357`), so the exemption is stated twice and names its
  justification in both places. MMCA.ADC declares no override, so it inherits the empty list
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Cqrs/RawSqlConventionTests.cs:14-16`, with
  the reason written in its class documentation at `:10-12`), and MMCA.Store declares the empty list
  explicitly
  (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Cqrs/RawSqlConventionTests.cs:18`).
  Both application repos therefore start at zero: the rule blocks every new raw call site rather than
  ratcheting down from an inherited set.
- **All three repos subclass the same body.** MMCA.Common declares no business modules, so its subclass
  redirects the scan onto the framework's own Application and Infrastructure projects
  (`RawSqlConventionTests.cs:17-22`), on the grounds that the one place shipping a raw-SQL surface is
  the one place that must not leave a concatenated statement lying around as the example. MMCA.ADC
  keeps the base scan and appends the thin Notification module, which is not a mapped module
  (`RawSqlConventionTests.cs:24-33`). MMCA.Store takes the base scan unchanged
  (`RawSqlConventionTests.cs:12`, `:15`).

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
  call sites can adopt the rule the day it lands instead of after a cleanup. Two of the three repos
  needed nothing, and the third needed one file for a statement T-SQL cannot parameterize at all, so
  the exemption surface is a known, justified constant rather than a growing list.
- **Relational-only is a stated limit rather than an assumption.** Under
  [ADR-018](018-polyglot-persistence.md) a host can default to Cosmos DB, which speaks its own query
  language. Naming the engine in the exception is more useful than a provider-level error, and it
  points at the two real options (express the read with LINQ, or move the entity to a relational
  source).

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
  (`EFRawSqlQueryExecutor.cs:45`), so a statement that must run against a named non-default source has
  no route through this interface today.
- **The Cosmos refusal is discovered at runtime** (`:46-52`). Nothing at compile time tells a module
  author that the host it will be deployed into defaults to a non-relational engine.

## Related
[ADR-055](055-repository-and-specification-contract.md) (the repository plus specification path this
escape hatch sits beside, and the reason the hatch stays narrow),
[ADR-015](015-architecture-fitness-functions.md) (the fitness-function style this rule is written in,
including the shared `*TestsBase` package all three repos subclass),
[ADR-018](018-polyglot-persistence.md) (the four-engine model that makes "relational only" a real
constraint rather than a formality),
[ADR-109](109-feature-by-folder-convention.md) (the same move applied to folder layout: a convention
becomes a test rather than a paragraph), ADR-006 (one context class per engine and one instance per
database, which is what the executor resolves its context through). Framework version and package
figures live in `MMCA.Common/FACTS.md`.
