# ADR-095: Uniqueness Under Soft Delete (Filtered Unique Indexes)

## Status
Accepted (2026-08-23).

## Context
ADR-005 makes deletion **soft**: an `IAuditableEntity` sets `IsDeleted = true`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IAuditableEntity.cs:11`) and a named global
query filter hides the row from every query
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:336-350`,
the filter name at `:357`). The application therefore behaves as though the row is gone.

The database does not. A unique index still counts the hidden row, so the deleted record keeps
occupying its unique slot forever: delete a speaker and the email unique index still refuses to
create a new speaker with that email, with an error the user cannot act on because the conflicting
row is invisible to them. That contradiction is stated as the reason for the convention in its own
remarks (`.../Persistence/Conventions/SoftDeleteUniqueIndexConvention.cs:10-21`).

The obvious fix, a hand-written `HasFilter("[IsDeleted] = 0")` on each index, is the kind of rule
that gets forgotten: it lives in a different file from the `IsDeleted` flag, it is engine-specific
SQL typed as a string literal, and nothing fails when it is missing until a user tries to re-create a
record months later. ADR-005 decides soft-delete versus erasure and never addresses what soft-delete
does to uniqueness; this ADR is that missing half.

## Decision
Make the filter a **convention**: every unique index on a soft-deletable entity excludes deleted
rows, automatically, in every context of every consumer.

- **A model-finalizing convention, registered once in the base context.**
  `SoftDeleteUniqueIndexConvention` (`.../Conventions/SoftDeleteUniqueIndexConvention.cs:24`) is added
  by `ApplicationDbContext.ConfigureConventions`
  (`.../DbContexts/ApplicationDbContext.cs:296`, rationale at `:293-295`). Because ADR-006 keeps one
  context class per engine over that base, a single registration reaches every module, every database
  and every consumer repo. Nothing opts in per entity.
- **Scope: unique, unfiltered, non-owned, soft-deletable.** The convention walks entity types
  assignable to `IAuditableEntity` and not owned (`:36-37`, the same predicate the query filter uses
  at `ApplicationDbContext.cs:339`), then sets the filter on each index that is unique and declares
  none already (`:51-55`).
- **Hand-authored filters win.** An index that already carries a filter is left exactly as written
  (`:53`). There is no flag: a configuration that genuinely wants uniqueness across deleted rows too
  opts out by declaring its own filter.
- **One predicate builder serves both paths.** `SoftDeleteFilterSql.Build`
  (`.../Persistence/SoftDeleteFilterSql.cs:27-38`) is called by the convention (`:47`) and by the
  public opt-in `HasSoftDeleteFilter`
  (`.../Persistence/Configuration/IndexBuilderExtensions.cs:50-64`), so the automatic and the manual
  path cannot disagree about identifier quoting or about which column carries the flag
  (`SoftDeleteFilterSql.cs:8-14`). The column name is read from the model, falling back to the
  property name (`:32-33`), and the quoting is chosen per engine: brackets for SQL Server, double
  quotes otherwise (`:35-37`).
- **SQL Server and SQLite are covered; Cosmos is a no-op.** The convention returns immediately for
  `DataSource.CosmosDB` (`:33-34`) and the builder returns `null` for it (`SoftDeleteFilterSql.cs:29-30`),
  which the callers read as "leave the index untouched".
- **Non-unique indexes opt in by hand.** `HasSoftDeleteFilter` is the extension point for an index the
  convention deliberately skips (`IndexBuilderExtensions.cs:19-30`), and a unique index needing a
  second predicate opts in the same way: the two are joined as `{additionalFilter} AND {filter}`
  (`:60-63`). The framework's own push-notification dedup index does exactly that
  (`.../EntityTypeConfiguration/Notifications/PushNotificationConfiguration.cs:67-69`, reasoned at
  `:62-66`), as does Store's SKU index
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Infrastructure/Persistence/EntityConfiguration/ProductVariantConfiguration.cs:44-46`).

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
- **Respecting a hand-authored filter is not politeness, it is correctness.** Overwriting one would
  have dropped the `[DedupKey] IS NOT NULL` clause the push-notification index depends on, which is
  precisely why that configuration opts in explicitly.
- **The behavior is pinned by tests, in both directions.**
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Conventions/SoftDeleteUniqueIndexConventionTests.cs`
  asserts the filter is applied (`:30-37`), that a soft-deleted row no longer blocks re-inserting the
  same value (`:40-61`), that a **live** duplicate is still rejected (`:64-74`), and that a
  hand-authored filter survives (`:77-84`). The opt-in path is pinned for both engines and for Cosmos
  in `.../Persistence/Configuration/IndexBuilderExtensionsTests.cs:23-60`, and the combined predicate
  in `.../Persistence/Configuration/PushNotificationConfigurationTests.cs:27-30`.

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
- **Duplicates among deleted rows become legal, permanently.** Any number of soft-deleted rows may
  now share the same "unique" value. Two consequences follow: a report that reads with
  `ignoreQueryFilters: true` can see duplicates that the model's index name promises are impossible,
  and any restore path a consumer writes (flipping `IsDeleted` back to `false`) has to handle a
  collision with the live row that took the slot, because the database will reject it at that moment
  rather than at delete time.
- **Engine coverage is partial by construction.** The guarantee exists only where the provider
  supports a filtered or partial index. On Cosmos both paths return without touching the index
  (`SoftDeleteUniqueIndexConvention.cs:33-34`, `SoftDeleteFilterSql.cs:29-30`), so a Cosmos-backed
  source (ADR-018) does not get this behavior at all, and a model shared across engines gets a
  different uniqueness contract per engine.
- **The filter is not visible where the index is declared.** Reading
  `builder.HasIndex(x => x.Email).IsUnique()` does not reveal that the shipped index is filtered; the
  predicate first appears in a generated migration or a model snapshot. That is the cost of moving
  the rule out of the configuration files, and the reason the tests above assert on
  `index.GetFilter()` rather than on behavior alone.

## Related
ADR-005 (decides soft-delete over erasure and owns the query filter that hides the row, but says
nothing about uniqueness: this ADR closes that gap), ADR-057 (the expand/contract CI gate, which
classifies the drop-and-recreate this convention produces as a legitimate override and cites the ADC
Identity migration as its live marker at `057-expand-contract-schema-evolution-gate.md:70-77`),
ADR-006 (one context class per engine over the shared `ApplicationDbContext`, which is why a single
convention registration reaches every module and every database).
