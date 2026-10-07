# ADR-002: NavigationPopulators for Cross-Container Loading

## Status
Accepted

Revised 2026-10-06: four engines including PostgreSQL; Include support is classified by source identity on relational engines, with every Cosmos DB navigation unsupported.

## Context
The application supports multiple database backends (SQL Server, PostgreSQL, SQLite, Cosmos DB: the `DataSource` enum at `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IDataSourceService.cs:9-22`). EF Core's `.Include()` works on a relational engine (SQL Server, PostgreSQL, SQLite) when both ends live in the same physical database, and never on Cosmos DB, which is non-relational (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/Engines/CosmosDataSourceEngine.cs:44`). Navigation properties are tagged with `[Navigation]` (the attribute's `IsCollection` flag distinguishes a child collection from an FK reference). Whether a given navigation can actually be loaded via `Include` is *not* a static attribute value: it is classified at runtime by `NavigationMetadataProvider`, which asks `IDataSourceService.HaveIncludeSupport(declaringEntityType.FullName, targetEntityType.FullName)` with the two entity full names (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/Query/NavigationMetadataProvider.cs:96`, against the string overload at `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IDataSourceService.cs:70`, which also returns false when either entity has no registered `DataSourceKey`: `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceService.cs:35-38`). Include is used only when both ends resolve to the same `DataSourceKey` and that engine is relational (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceService.cs:31-32`); any other navigation (every Cosmos DB navigation, same container or not, and any cross-database navigation under database-per-service) is classified **unsupported** and routed to manual population instead.

## Decision
Each entity that has unsupported navigations gets a `INavigationPopulator<TEntity>` implementation. A `DeclarativeNavigationPopulator<TEntity>` base class (added in MMCA.Common) allows populators to be defined as a list of `INavigationDescriptor<TEntity>` declarations rather than imperative if-check boilerplate.

Two descriptor types exist:
- `ChildNavigationDescriptor`: for child collection navigations (e.g., `Event.Rooms`)
- `FKNavigationDescriptor`: for FK reference navigations (e.g., `Product.Category`)

Both delegate to `NavigationLoader`, which batch-loads related entities in a single `WHERE FK IN (...)` query to avoid N+1 problems.

## Rationale
- **Multi-DB support**: The query pipeline automatically falls back from Include to NavigationPopulator when the data source reports navigations as unsupported.
- **Batch efficiency**: All related entities for all parents are loaded in one query per navigation, not per-parent.
- **Declarative**: The `DeclarativeNavigationPopulator` replaces the repeated per-navigation if-checks each populator used to carry. Each populator is now just a list of descriptors.

## Trade-offs
- Extra abstraction layer for SQL Server (where Include works fine). Mitigated: the populator is only called when the query pipeline's metadata says navigations are unsupported.
- Entities that need no manual loading still require a no-op populator (or use `NullNavigationPopulator`).

## Revision (2026-10-06)
- Context: the engine list now names all four `DataSource` values, adding PostgreSQL (`IDataSourceService.cs:9-22`).
- Context: Include support is stated as the code computes it, same `DataSourceKey` on a relational engine (`DataSourceService.cs:31-32`). Every Cosmos DB navigation is unsupported, not only cross-container ones (`CosmosDataSourceEngine.cs:44`), and the "certain SQLite configurations" case is dropped: SQLite is relational like SQL Server and PostgreSQL (`SqliteDataSourceEngine.cs:41`, `SQLServerDataSourceEngine.cs:44`, `PostgreSQLDataSourceEngine.cs:42`).
- Rationale: the "~30-40 lines per entity" figure is dropped as overstated; the Store adoption commit saved fewer lines per populator than that.
- Anchors and type names (`NavigationMetadataProvider`, `DeclarativeNavigationPopulator`, `ChildNavigationDescriptor`, `FKNavigationDescriptor`, `NavigationLoader`, `NullNavigationPopulator`) were re-verified against current MMCA.Common source.
