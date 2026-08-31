# ADR-048: Primitive Identifier Type Aliases over Strongly-Typed ID Structs

## Status
Accepted (2026-07-15). Revised 2026-07-21 (corrected the empty-placeholder-folder inventory and the
`Directory.Build.props` and ADC `User` source citations). Revised 2026-07-28 (refreshed the Common
`Directory.Build.props` alias-block line range and corrected the framing of what Common's
`UserIdentifierType` alias types). Revised 2026-07-29 (dropped the `StronglyTypedIds` placeholder-folder
evidence and deleted the folders themselves: being empty, they were untracked by git and absent from
every fresh clone, so the deferral now rests on the verifiable absence of any wrapper-struct type).
Revised 2026-08-14 (Conference's alias file now declares sixteen aliases, `SponsorIdentifierType` having
been added, and the ADC `User` source citations were re-anchored after an expanded doc comment).
Revised 2026-08-23 (Conference's alias file now declares seventeen aliases, `ActivityIdentifierType`
having been added, and the workspace alias count was recounted; see the Revision (2026-08-23) at the end).
**Revisited by [ADR-085](085-identifier-type-aliases-revisited.md) (2026-08-18)**: the wrapper-struct
alternative this record deferred was re-evaluated, priced, and deferred again, now against named
revisit triggers instead of open-endedly. The decision below is unchanged; see the Revision
(2026-08-18) at the end.

## Context
Every entity needs an identity type. The framework's base entity is generic over that type:
`BaseEntity<TIdentifierType>` constrains it to `notnull` and exposes a single `required init Id`
(`Source/Core/MMCA.Common.Domain/Entities/BaseEntity.cs:34-37`), over the equally generic
`IBaseEntity<TIdentifierType>` (`Source/Core/MMCA.Common.Domain/Interfaces/IBaseEntity.cs:7-11`). That
generic parameter accepts either of the two common identity styles:

1. A **primitive** (`int`, `Guid`) named through a per-entity alias (`UserIdentifierType = int`).
2. A **strongly-typed wrapper struct** (`readonly record struct UserId(int Value)`) as tactical DDD
   prescribes, to make identifiers non-interchangeable at compile time.

The codebase chose the first, but until now that choice lived only as a CLAUDE.md convention with no
recorded trade-off. The wrapper-struct alternative was considered and left unbuilt: **no wrapper-struct
identifier type exists anywhere in the workspace**, in any repo or layer. This ADR records the
primitive-alias decision and its cost so the deferral is deliberate and legible.

## Decision
Model every identifier as a **primitive named through a global-using alias**, declared per module,
not as a wrapper struct.

- **Identity is a primitive behind an alias.** Each module declares
  `global using {Entity}IdentifierType = <primitive>;` in its `.Shared` project. Common declares
  `UserIdentifierType = int` for itself
  (`Source/Core/MMCA.Common.Domain/GlobalUsings.IdentifierType.cs:1`), with the push-notification
  aliases alongside it (`Source/Core/MMCA.Common.Shared/GlobalUsings.NotificationIdentifierType.cs:1-2`).
  Common owns no `User` aggregate of its own: that alias types the audit fields every auditable
  entity inherits, `CreatedBy` and `LastModifiedBy` on `AuditableBaseEntity`
  (`Source/Core/MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:27,31`), and constrains the user
  type parameter of `AuthenticationServiceBase<TUser>`
  (`where TUser : AuditableAggregateRootEntity<UserIdentifierType>, IAuthUser`,
  `Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:56`), with each consuming
  app supplying the concrete `User` entity that satisfies it.
  Consumers follow the same pattern: ADC Identity
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/MMCA.ADC.Identity.GlobalUsings.IdentifierType.cs:2`),
  ADC Conference with seventeen aliases
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:5-21`),
  and Store Catalog
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/MMCA.Store.Catalog.GlobalUsings.IdentifierType.cs:3-6`).
- **The alias is the type; there is no wrapping struct.** The right-hand side is a bare primitive.
  Most resolve to `int`; the one deviation in Conference is
  `SpeakerIdentifierType = System.Guid` (line 19), because Sessionize assigns speakers GUIDs while its
  other imported entities carry integer IDs (the file header comment records this,
  `MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:1-4`).
- **Aliases are linked solution-wide via `Directory.Build.props`.** Each `GlobalUsings.*.cs` file is
  pulled into every project with a `<Compile Include ... Link=... />` block, so the alias is visible
  everywhere without a project reference: Common
  (`MMCA.Common/Directory.Build.props:128-138`), ADC
  (`MMCA.ADC/Directory.Build.props:89-102`), Store (`MMCA.Store/Directory.Build.props:90-101`). Adding a
  solution-wide alias is a new `GlobalUsings.*.cs` plus a matching `<Compile Include>` line, nothing more.
- **The alias flows unchanged through every layer.** Tracing the ADC `User` aggregate: the domain
  entity is `User : AuditableAggregateRootEntity<UserIdentifierType>`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:34`); the cross-context
  reference to a speaker is typed `SpeakerIdentifierType? LinkedSpeakerId` (same file, line 65); the EF
  configuration is `EntityTypeConfigurationSQLServer<User, UserIdentifierType>`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:13`);
  the repository handle is `GetRepository<User, UserIdentifierType>()`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:43`);
  the API contract is `UserDTO : IBaseDTO<UserIdentifierType>` with a `UserIdentifierType Id`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDTO.cs:8,11`); and the
  integration event carries `UserIdentifierType UserId`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/IntegrationEvents/UserRegistered.cs:26`).
  No converter, serializer shim, or OpenAPI schema mapping appears at any hop: `int` and `Guid` are the
  values on the wire and in the store.
- **The wrapper-struct alternative is deliberately deferred, not planned.** No wrapper-struct
  identifier type exists in any repo. That is the current reality: a considered option left unbuilt,
  not scheduled work.

## Rationale
- **Readable signatures at zero runtime cost.** `GetRepository<User, UserIdentifierType>()` reads as
  intent while the CLR sees a plain `int`. There is no allocation, boxing, or wrapper indirection per
  identifier.
- **No persistence or transport friction.** `int` and `Guid` are natively understood by EF Core, the
  SQL provider, `System.Text.Json`, and the OpenAPI schema generator, so an identifier needs no value
  converter, no `JsonConverter`, and no schema customization anywhere in the trace above. A wrapper
  struct would demand one (or several) at every one of those boundaries.
- **The generic base infrastructure already carries the type parameter.** Because `BaseEntity<TId>`,
  `IBaseEntity<TId>`, the repository handle, `IBaseDTO<TId>`, the per-entity `IEntityDTOMapper<...,TId>`
  (ADR-001), and the generic entity query surface (ADR-034) are all parameterized by the identifier
  type, the alias slots in with no extra plumbing.
- **Per-module declaration mirrors the ownership boundary.** Each module declaring its own aliases in
  its `.Shared` project keeps identity definitions with the module that owns them, consistent with
  database-per-service ownership (ADR-006).

## Trade-offs
- **No compile-time protection against swapping same-typed identifiers.** An alias is a type synonym,
  not a distinct type. Because most aliases resolve to `int`, the compiler will not stop code from
  passing a `SessionIdentifierType` where a `UserIdentifierType` is expected. The `Guid`-backed
  `SpeakerIdentifierType` is guarded only incidentally, because its underlying type differs, not by
  design. This is the exact safety a wrapper struct would buy and that this decision forgoes.
- **The alias is documentation-strength, erased at compile time.** Reflection, tooling, serialized
  payloads, and the OpenAPI document all see `int`/`Guid`; the alias name never survives the build.
- **Convention, not a build-gated invariant.** Unlike many framework rules that are enforced by
  fitness functions (ADR-015), nothing gates that a new entity uses an alias rather than a bare `int`,
  or that the alias is declared in the right `.Shared` project. It rests on author discipline and
  review.
- **Revisiting the trade would be a broad change.** Adopting wrapper structs later would touch every
  generic call site plus add converters and JSON/OpenAPI handling, which is precisely the friction
  being avoided. Each module's `.Shared` project is where the wrappers would live if that cost were
  ever judged worth paying.

## Related
ADR-001 (the per-entity DTO mappers are parameterized by this identifier type, `IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`), ADR-034 (the generic entity controllers and query contract ride on the same identifier type parameter), ADR-006 (aliases are declared per module in the module's own `.Shared` project, matching database-per-service ownership), ADR-015 (the contrast: this convention is not fitness-enforced, unlike the invariants that gate the build), [ADR-085](085-identifier-type-aliases-revisited.md) (the 2026-08-18 revisit of the wrapper-struct deferral recorded in the Trade-offs below: same decision, now with a price and named triggers), ADR-068 (the deliberate opposite case, where domain values do get wrapper types).

## Revision (2026-08-18)
No decision, no behavior and no citation in this record changed. What changed is the standing of the
deferral it records.

The last Trade-offs entry above ("Revisiting the trade would be a broad change") described the
wrapper-struct migration as expensive without ever measuring it, and the Decision's last bullet left
the alternative "deliberately deferred, not planned" with no condition that would re-open it.
[ADR-085](085-identifier-type-aliases-revisited.md) closes both gaps: it counts the aliases (44 across
10 files in the four repositories, 43 of them resolving to `int`), counts the migration surface
(3,192 occurrences of the alias token across 1,001 `.cs`/`.razor` files in the four `Source` trees,
tests excluded, `TIdentifierType` generic parameters not counted),
names the concrete failure the deferral leaves open with a live example (ADC's `CheckIn` constructor,
which takes two different `UserIdentifierType` arguments that can be transposed silently), and records
three triggers that would re-open the question: a production defect traced to an identifier
transposition, a greenfield fifth consumer, or a materially growing cross-module identifier reference
graph.

Read the two records together as one position: this record is the decision and its evidence, ADR-085
is its price and its expiry condition.

## Revision (2026-08-23)
No decision and no rationale changed. Two counts did, both because Conference gained an alias.

Conference's alias file declares **seventeen** aliases, `ActivityIdentifierType = int` having been
added at the head of the list
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:5-21`),
which also moved `SpeakerIdentifierType = System.Guid` down to line 19 (same file). The Decision
section above is re-anchored to both.

Recounting the alias files across the four repositories gives **44 aliases across 10 files**: Common
Domain 1 (`MMCA.Common/Source/Core/MMCA.Common.Domain/GlobalUsings.IdentifierType.cs:1`) and Common
Shared 2 (`MMCA.Common/Source/Core/MMCA.Common.Shared/GlobalUsings.NotificationIdentifierType.cs:1-2`);
ADC Notification 2
(`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.GlobalUsings.IdentifierType.cs:1-2`),
Identity 1
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/MMCA.ADC.Identity.GlobalUsings.IdentifierType.cs:2`),
Engagement 10
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/MMCA.ADC.Engagement.GlobalUsings.IdentifierType.cs:4-13`)
and Conference 17; Store Catalog 4
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/MMCA.Store.Catalog.GlobalUsings.IdentifierType.cs:3-6`),
Identity 2
(`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Shared/MMCA.Store.Identity.GlobalUsings.IdentifierType.cs:3-4`)
and Sales 3
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Shared/MMCA.Store.Sales.GlobalUsings.IdentifierType.cs:5-7`);
and Helpdesk Tickets 2
(`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Shared/MMCA.Helpdesk.Tickets.GlobalUsings.IdentifierType.cs:6,8`).
43 of the 44 resolve to `int`; `SpeakerIdentifierType` remains the single `Guid`. The count in the
Revision (2026-08-18) above is refreshed to those numbers, and ADR-085 carries the same pair.
