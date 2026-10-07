# ADR-095: Uniqueness Under Soft Delete (Filtered Unique Indexes)

## Status
Accepted (2026-08-23). Revised 2026-08-26 (the convention **appends** its clause to a hand-authored
filter instead of skipping the index). Revised 2026-10-01 (PostgreSQL coverage and per-engine
quoting). Revised 2026-10-06: the per-engine predicate now comes from each engine's
`IDataSourceEngine.BuildSoftDeleteFilter`, and the Cosmos no-op is a relational-capability check.

## Context
ADR-005 makes deletion **soft**: an `IAuditableEntity` sets `IsDeleted = true`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAuditableEntity.cs:11`) and a named global
query filter hides the row from every query
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:453-467`,
the filter name at `:474`). The application therefore behaves as though the row is gone.

The database does not. A unique index still counts the hidden row, so the deleted record keeps
occupying its unique slot forever: delete a speaker and the email unique index still refuses to
create a new speaker with that email, with an error the user cannot act on because the conflicting
row is invisible to them. That contradiction is stated as the reason for the convention in its own
remarks (`.../Persistence/Conventions/SoftDeleteUniqueIndexConvention.cs:11-17`).

The obvious fix, a hand-written `HasFilter("[IsDeleted] = 0")` on each index, is the kind of rule
that gets forgotten: it lives in a different file from the `IsDeleted` flag, it is engine-specific
SQL typed as a string literal, and nothing fails when it is missing until a user tries to re-create a
record months later. ADR-005 decides soft-delete versus erasure and never addresses what soft-delete
does to uniqueness; this ADR is that missing half.

## Decision
Make the filter a **convention**: every unique index on a soft-deletable entity excludes deleted
rows, automatically, in every context of every consumer.

- **A model-finalizing convention, registered once in the base context.**
  `SoftDeleteUniqueIndexConvention` (`.../Conventions/SoftDeleteUniqueIndexConvention.cs:34`) is added
  by `ApplicationDbContext.ConfigureConventions`
  (`.../DbContexts/ApplicationDbContext.cs:392`, rationale at `:389-391`). Because ADR-006 keeps one
  context class per engine over that base, a single registration reaches every module, every database
  and every consumer repo. Nothing opts in per entity.
- **Scope: unique, non-owned, soft-deletable.** The convention walks entity types assignable to
  `IAuditableEntity` and not owned (`:46-47`, the same predicate the query filter uses at
  `ApplicationDbContext.cs:456`), then applies the filter to every index that is unique
  (`:49-50`, `:61-64`).
- **A hand-authored filter is kept and extended, not replaced and not skipped.** An index that
  already declares a predicate keeps it and gains the soft-delete clause appended with `AND` (`:80`),
  in the same order `HasSoftDeleteFilter(additionalFilter:)` produces
  (`.../Persistence/Configuration/IndexBuilderExtensions.cs:62-65`), so the two paths yield
  byte-identical SQL for the same pair of predicates (`SoftDeleteUniqueIndexConvention.cs:78-79`).
  Skipping such an index, as the convention originally did, left precisely the partial-unique indexes
  a model bothered to hand-author as the only ones a soft-deleted row could keep blocking (`:19-26`):
  the framework's own push-notification dedup index, filtered on `[DedupKey] IS NOT NULL`, was exactly
  that case
  (`.../Persistence/Configuration/EntityTypeConfiguration/Notifications/PushNotificationConfiguration.cs:69-73`).
  The append is **idempotent**: a filter that already constrains the soft-delete column is recognized
  and left alone (`SoftDeleteUniqueIndexConvention.cs:73-76`), so a second model build cannot produce
  `... AND [IsDeleted] = 0 AND [IsDeleted] = 0`. Recognition (`SoftDeleteFilterSql.ContainsPredicate`)
  compares a normalized form with whitespace and all three identifier quoting styles stripped
  (`.../Persistence/SoftDeleteFilterSql.cs:52-59`, normalizer at `:77-78`), because a hand-written
  `HasFilter("[IsDeleted] = 0")` literal and the builder's output do not agree on quoting (`:44-51`);
  the boolean `= false` spelling counts as the same clause as `= 0` (`:57-58`).
- **There is therefore no opt-out.** Declaring a filter no longer excludes an index from the
  convention (the early `continue` on an existing filter is gone,
  `SoftDeleteUniqueIndexConvention.cs:61-81`), so a unique index that genuinely must enforce
  uniqueness across deleted rows too cannot express that on a soft-deletable entity. Nothing in the
  workspace wants it, and the alternative (leaving hand-filtered indexes silently un-narrowed) is the
  bug this revision fixes.
- **One predicate builder serves both paths.** `SoftDeleteFilterSql.Build`
  (`.../Persistence/SoftDeleteFilterSql.cs:34-35`) is called by the convention
  (`SoftDeleteUniqueIndexConvention.cs:57`) and by the public opt-in `HasSoftDeleteFilter`
  (`.../Persistence/Configuration/IndexBuilderExtensions.cs:52-66`), so the automatic and the manual
  path cannot disagree about identifier quoting or about which column carries the flag
  (`SoftDeleteFilterSql.cs:9-16`). The column name is read from the model, falling back to the
  property name (`:72-74`), and `Build` hands it to the engine's `IDataSourceEngine.BuildSoftDeleteFilter`,
  which owns the per-engine predicate: `[IsDeleted] = 0` for SQL Server
  (`.../Persistence/DataSources/Engines/SQLServerDataSourceEngine.cs:117`), `"IsDeleted" = 0` for
  SQLite (`SqliteDataSourceEngine.cs:115`), and `"IsDeleted" = false` for PostgreSQL
  (`PostgreSQLDataSourceEngine.cs:116`), whose flag is a real boolean column that refuses an integer
  comparison.
- **SQL Server, PostgreSQL and SQLite are covered; Cosmos is a no-op.** The convention returns
  immediately for any engine whose capabilities are not relational
  (`SoftDeleteUniqueIndexConvention.cs:43-44`), which is Cosmos, and the Cosmos engine's builder
  returns `null` (`CosmosDataSourceEngine.cs:117`), which the callers read as "leave the index
  untouched".
- **Non-unique indexes opt in by hand.** `HasSoftDeleteFilter` is the extension point for an index the
  convention deliberately skips (a non-unique one), and a unique index that wants to declare the
  combined predicate at its own declaration site uses the same call: the two are joined as
  `{additionalFilter} AND {filter}` (`:62-65`). The framework's own push-notification dedup index does
  exactly that (`PushNotificationConfiguration.cs:69-73`, quoting `DedupKey` per engine through
  `SoftDeleteFilterSql.QuoteColumn`, `SoftDeleteFilterSql.cs:69-70`), and since the convention started appending,
  that call is belt and braces rather than the only thing narrowing the index: it produces the same
  SQL in the same order, and the convention recognizes it and stops
  (`SoftDeleteUniqueIndexConvention.cs:73-76`). Store's SKU index
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Infrastructure/Persistence/EntityConfiguration/ProductVariantConfiguration.cs:104-109`)
  is the same shape.

The two paths differ in one respect worth knowing: the convention runs at model finalizing, after
module configurations have declared their indexes, while `HasSoftDeleteFilter` reads the column name
at the moment it is called, so a `HasColumnName` on the soft-delete property has to come first
(`IndexBuilderExtensions.cs:31-35`).

## Rationale
- **The database should agree with what the application shows.** The query filter already says a
  soft-deleted row does not exist; a unique index that disagrees is the one place the illusion leaks,
  and it leaks as an unexplainable error rather than as a visible row.
- **A convention beats per-configuration discipline.** Every unique index on a soft-deletable entity
  wants this predicate, so making it the default is strictly better than asking each configuration
  author to remember engine-specific filter SQL.
- **A shared builder is what makes the opt-in path trustworthy.** Because the manual call routes
  through the same `Build`, a hand-filtered index gets the same column name and the same quoting the
  convention would have produced, instead of a SQL-Server-shaped literal that silently breaks on
  SQLite.
- **Extending a hand-authored filter, rather than replacing or skipping it, is the only option that
  is correct twice.** Overwriting would drop the `[DedupKey] IS NOT NULL` clause the push-notification
  index depends on (`PushNotificationConfiguration.cs:55-68`); skipping leaves that index enforcing
  uniqueness against soft-deleted rows, which is the exact defect the convention exists to remove, and
  it does so only for the indexes someone thought hard enough about to filter
  (`SoftDeleteUniqueIndexConvention.cs:22-24`). Appending is the composition that keeps both
  predicates, and idempotent recognition is what makes appending safe to run on a model that already
  says it (`:24-26`).
- **The behavior is pinned by tests, in both directions.**
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Conventions/SoftDeleteUniqueIndexConventionTests.cs`
  asserts the filter is applied (`:31`), that a soft-deleted row no longer blocks re-inserting the
  same value (`:41`), that a **live** duplicate is still rejected (`:65`), that a hand-authored filter
  gets the soft-delete clause appended (`:78`), that a soft-deleted row no longer blocks a
  **pre-filtered** unique value (`:91`), and that an existing soft-delete clause is neither appended
  twice (`:108`) nor missed through different quoting and spacing (`:120`). The opt-in path is pinned
  for both engines and for Cosmos in
  `.../Persistence/Configuration/IndexBuilderExtensionsTests.cs:23-60`, and the combined predicate in
  `.../Persistence/Configuration/PushNotificationConfigurationTests.cs:27-30`.

## Trade-offs
- **It moves schema in consumers, invisibly from the entity configuration.** Adopting the convention
  is a database-contract change: nothing in an entity configuration changed, but the next scaffolded
  migration drops and recreates unique indexes. The v1.120.0 adoption did exactly that in ADC, for
  `IX_User_Email`
  (`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20260720031638_CommonV1120OutboxLeaseAndSoftDeleteIndexFilters.cs:14-43`)
  and for `IX_CategoryItem_CategoryId_Name`
  (`.../MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260720031645_CommonV1120OutboxLeaseAndSoftDeleteIndexFilters.cs:14-43`),
  each needing an `EXPAND-CONTRACT-OVERRIDE` marker to pass the ADR-057 gate. The churn is uneven:
  Store's and Helpdesk's migrations of the same sweep carry only the outbox columns
  (`MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer.Catalog/Migrations/20260720031626_CommonV1120OutboxLeaseAndSoftDeleteIndexFilters.cs:12-27`,
  `MMCA.Helpdesk/Source/Hosting/MMCA.Helpdesk.Migrations.SqlServer.Tickets/Migrations/20260720031655_CommonV1120OutboxLeaseAndSoftDeleteIndexFilters.cs:12-27`),
  because Store's configurations already opted in by hand and Helpdesk's single module declares no
  unique index on a soft-deletable entity. So "the framework changed your schema" is true for some
  consumers and not others, and only the generated migration says which.
- **It moves that schema a second time, for the indexes it previously skipped.** Because the
  convention now appends to a hand-authored filter (`SoftDeleteUniqueIndexConvention.cs:80`), every
  pre-filtered unique index on a soft-deletable entity has a new predicate, so the next migration a
  consumer scaffolds drops and recreates it once, with the same ADR-057 override the first adoption
  needed. The one-off applies to precisely the indexes that were left un-narrowed before, which is
  also the population that was still refusing to re-create a soft-deleted record. After that migration
  the shape is stable: the recognition check makes a later model build a no-op rather than a further
  append (`:73-76`, pinned at `.../Conventions/SoftDeleteUniqueIndexConventionTests.cs:108`).
- **Duplicates among deleted rows become legal, permanently.** Any number of soft-deleted rows may
  now share the same "unique" value. Two consequences follow: a report that reads with
  `ignoreQueryFilters: true` can see duplicates that the model's index name promises are impossible,
  and any restore path a consumer writes (flipping `IsDeleted` back to `false`) has to handle a
  collision with the live row that took the slot, because the database will reject it at that moment
  rather than at delete time.
- **Engine coverage is partial by construction.** The guarantee exists only where the provider
  supports a filtered or partial index. On Cosmos both paths return without touching the index
  (`SoftDeleteUniqueIndexConvention.cs:43-44`, `CosmosDataSourceEngine.cs:117`), so a Cosmos-backed
  source (ADR-018) does not get this behavior at all, and a model shared across engines gets a
  different uniqueness contract per engine.
- **The filter is not visible where the index is declared.** Reading
  `builder.HasIndex(x => x.Email).IsUnique()` does not reveal that the shipped index is filtered; the
  predicate first appears in a generated migration or a model snapshot. That is the cost of moving
  the rule out of the configuration files, and the reason the tests above assert on
  `index.GetFilter()` rather than on behavior alone.

## Revision (2026-10-01)
No decision or rationale changed. Engine coverage now includes PostgreSQL: `SoftDeleteFilterSql.Build`
emits `"IsDeleted" = false` there, because the flag is a real boolean column, alongside
`[IsDeleted] = 0` for SQL Server and `"IsDeleted" = 0` for SQLite
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/SoftDeleteFilterSql.cs:34-50`), the
convention's remarks name all three engines (`SoftDeleteUniqueIndexConvention.cs:28-29`), and
recognition treats the boolean and integer spellings as one clause (`SoftDeleteFilterSql.cs:73-74`).
The push-notification dedup index quotes `DedupKey` per engine through `SoftDeleteFilterSql.QuoteColumn`
(`.../Notifications/PushNotificationConfiguration.cs:69-73`, `SoftDeleteFilterSql.cs:85-86`). The
Decision bullets on quoting and engine coverage are corrected accordingly, and stale citations are
refreshed in place: `ApplicationDbContext.cs` (`:393`, `:390-392`, `:454-468`, `:457`, `:475`),
`SoftDeleteFilterSql.cs` (`:27-51`, `:68-75`, `:93-94`, `:60-67`, `:88-90`),
`IndexBuilderExtensions.cs` (`:52-66`, `:62-65`), `PushNotificationConfiguration.cs` (`:69-73`,
`:55-68`), Store's `ProductVariantConfiguration.cs` (`:103-108`), and ADR-057's ADC marker citation
(`057-expand-contract-schema-evolution-gate.md:90`).

## Revision (2026-10-06)
No decision or rationale changed.
- `SoftDeleteFilterSql.Build` is now a one-line delegation to the engine's
  `IDataSourceEngine.BuildSoftDeleteFilter` (`SoftDeleteFilterSql.cs:34-35`); the per-engine
  predicates live in `SQLServerDataSourceEngine.cs:117`, `SqliteDataSourceEngine.cs:115`,
  `PostgreSQLDataSourceEngine.cs:116` and `CosmosDataSourceEngine.cs:117` (which returns `null`). The
  predicate values are unchanged; the Decision bullet on the shared builder now says where they live.
- The convention's Cosmos no-op is a capability check (`!DataSourceEngines.For(engine).Capabilities.IsRelational`,
  `SoftDeleteUniqueIndexConvention.cs:43-44`), not a `DataSource.CosmosDB` comparison; the Decision and
  Trade-offs bullets say so. Recognition is `SoftDeleteFilterSql.ContainsPredicate` (`:52-59`).
- The 2026-10-01 revision's in-place citations had moved again (`ApplicationDbContext.cs`,
  `SoftDeleteUniqueIndexConvention.cs`, `SoftDeleteFilterSql.cs`, Store's `ProductVariantConfiguration.cs`
  now `:104-109`); that section stays as recorded. The PostgreSQL predicate it cites at
  `SoftDeleteFilterSql.cs:34-50` is now `PostgreSQLDataSourceEngine.cs:116`, and the remarks naming all
  three engines are at `SoftDeleteUniqueIndexConvention.cs:29-30`.
- All live-section anchors were re-verified against current source.

## Related
ADR-005 (decides soft-delete over erasure and owns the query filter that hides the row, but says
nothing about uniqueness: this ADR closes that gap), ADR-057 (the expand/contract CI gate, which
classifies the drop-and-recreate this convention produces as a legitimate override and cites the ADC
Identity migration as its live marker at `057-expand-contract-schema-evolution-gate.md:90`),
ADR-006 (one context class per engine over the shared `ApplicationDbContext`, which is why a single
convention registration reaches every module and every database).
