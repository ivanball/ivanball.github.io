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
Revised 2026-09-11 (recount): Store Catalog's alias file now declares six aliases, the Reviews aggregate
having added `ProductReviewIdentifierType` and `VerifiedPurchaseIdentifierType`, which took the workspace
total to 46 aliases across 10 files; three Decision citations were re-anchored after expanded doc comments
moved them. See the Revision (2026-09-11) at the end.
Revised 2026-09-19 (recount): Conference's alias file now declares nineteen aliases,
`SessionAiScoreIdentifierType` and `SessionAssetIdentifierType` having been added, so the workspace total is
**48 aliases across 10 files** and there are now **two** `Guid`-backed aliases rather than one. The Context
and the Decision's last bullet were also corrected: concrete wrapper-struct identifiers now exist in
Common's test tree, so what is zero is adoption in the four `Source` trees, not existence. See the Revision
(2026-09-19) at the end.
Revised 2026-10-01 (the Trade-offs entry on identifier swapping now names both `Guid`-backed aliases, and
the Conference and ADC/Store `Directory.Build.props` citations were re-anchored; see the Revision
(2026-10-01) at the end).
Revised 2026-10-06: the Status block now lists the 2026-10-01 revision, and the Common
`Directory.Build.props` and `AuthenticationServiceBase` citations were re-anchored; see the Revision
(2026-10-06) at the end.
Revised 2026-10-21: Engagement's alias file now declares eleven aliases, `UserSessionBookmarkIdentifierType`
having been added, so the workspace total is 49 aliases across 10 files, 47 of them `int`; the three
`Directory.Build.props` alias-block citations were re-anchored. See the Revision (2026-10-21) at the end.
Revised 2026-10-26: anchors refreshed after the three `Directory.Build.props` alias link blocks, the
`AuthenticationServiceBase<TUser>` constraint and the ADC `User` declarations moved without their
content changing. See the Revision (2026-10-26) at the end.
**Revisited by [ADR-085](085-identifier-type-aliases-revisited.md) (2026-08-18)**: the wrapper-struct
alternative this record deferred was re-evaluated, priced, and deferred again, now against named
revisit triggers instead of open-endedly. The decision below is unchanged; see the Revision
(2026-08-18) at the end.
**Revisited again by
[ADR-115](115-strongly-typed-identifiers-opt-in.md) (2026-09-09)**: the wrapper struct becomes a
shipped opt-in framework capability, while the aliases below stay the default, nothing migrates and
adoption is zero by design. The decision here is unchanged.
Revised 2026-11-23: MMCA.Helpdesk adopts one wrapper-struct identifier, `TicketCommentId`, which takes
no alias, so the Context, the Decision and its last bullet now name that exception; the census is 50
aliases across 10 files, 48 of them `int`, Engagement having grown to thirteen and Helpdesk Tickets
declaring one after its child-id alias was removed; this supersedes the "adoption is zero" wording in
the 2026-09-19 sentence and the ADR-115 note above, and the Decision now names the three Common
framework entities typed by a bare primitive; anchors re-pointed. See the Revision (2026-11-23) at the
end.

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
recorded trade-off. The wrapper-struct alternative was considered and left unadopted as the default:
**no entity in the Common, ADC or Store `Source` trees is identified by a wrapper struct**, and Helpdesk
identifies exactly one, `TicketComment : AuditableBaseEntity<TicketCommentId>`
(`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Domain/Tickets/TicketComment.cs:17`). The
type itself ships as opt-in machinery under [ADR-115](115-strongly-typed-identifiers-opt-in.md) in Common
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/IStronglyTypedId.cs:60`), and the concrete
wrapper structs that pin its contract live in Common's test tree
(`MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Identifiers/TestIdentifiers.cs:10`). This ADR records the
primitive-alias decision and its cost so the deferral is deliberate and legible.

## Decision
Model every module identifier as a **primitive named through a global-using alias**, declared per
module, not as a wrapper struct. The one sanctioned exception is an identifier a module opts into a
wrapper struct under [ADR-115](115-strongly-typed-identifiers-opt-in.md): it gets no alias, because the
alias file is linked into every project and may only name a type every project can see, so code names
the wrapper type directly
(`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Shared/MMCA.Helpdesk.Tickets.GlobalUsings.IdentifierType.cs:3-7`).
Separately, three framework entities in Common are typed by a bare primitive with no alias at all:
`MachineClient : AuditableBaseEntity<Guid>`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/MachineClients/MachineClient.cs:21`),
`WebhookSubscription : AuditableBaseEntity<Guid>`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Webhooks/WebhookSubscription.cs:38`) and
`FeatureFlagOverride : AuditableBaseEntity<string>`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/FeatureFlags/FeatureFlagOverride.cs:24`).

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
  `Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:82`), with each consuming
  app supplying the concrete `User` entity that satisfies it.
  Consumers follow the same pattern: ADC Identity
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/MMCA.ADC.Identity.GlobalUsings.IdentifierType.cs:2`),
  ADC Conference with nineteen aliases
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:8-26`),
  and Store Catalog with six
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/MMCA.Store.Catalog.GlobalUsings.IdentifierType.cs:3-8`).
- **The alias is the type; there is no wrapping struct.** The right-hand side is a bare primitive.
  Most resolve to `int`; the two deviations are both in Conference, and the file header comment records a
  distinct reason for each. `SpeakerIdentifierType = System.Guid` is a `Guid` because Sessionize assigns
  speakers GUIDs while its other imported entities carry integer IDs
  (`MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:1-4`), and `SessionAssetIdentifierType = System.Guid`
  is a server-minted GUID because the id is a path segment of the public blob name and so has to be
  unguessable rather than sequential (same file, lines 5-6).
- **Aliases are linked solution-wide via `Directory.Build.props`.** Each `GlobalUsings.*.cs` file is
  pulled into every project with a `<Compile Include ... Link=... />` block, so the alias is visible
  everywhere without a project reference: Common
  (`MMCA.Common/Directory.Build.props:190-200`), ADC
  (`MMCA.ADC/Directory.Build.props:327-341`), Store (`MMCA.Store/Directory.Build.props:298-309`). Adding a
  solution-wide alias is a new `GlobalUsings.*.cs` plus a matching `<Compile Include>` line, nothing more.
- **The alias flows unchanged through every layer.** Tracing the ADC `User` aggregate: the domain
  entity is `User : AuditableAggregateRootEntity<UserIdentifierType>`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:38`); the cross-context
  reference to a speaker is typed `SpeakerIdentifierType? LinkedSpeakerId` (same file, line 82); the EF
  configuration is `EntityTypeConfigurationSQLServer<User, UserIdentifierType>`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:13`);
  the repository handle is `GetRepository<User, UserIdentifierType>()`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:43`);
  the API contract is `UserDTO : IBaseDTO<UserIdentifierType>` with a `UserIdentifierType Id`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/UserDTO.cs:8,11`); and the
  integration event carries `UserIdentifierType UserId`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/IntegrationEvents/UserRegistered.cs:39`).
  No converter, serializer shim, or OpenAPI schema mapping appears at any hop: `int` and `Guid` are the
  values on the wire and in the store.
- **The wrapper-struct alternative stays opt-in, not the default.** The framework ships the opt-in
  machinery ([ADR-115](115-strongly-typed-identifiers-opt-in.md),
  `MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/IStronglyTypedId.cs:60`), pinned by test
  fixtures (`MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Identifiers/TestIdentifiers.cs:10`).
  Adoption is zero in the Common, ADC and Store `Source` trees and one identifier in Helpdesk:
  `TicketCommentId(int Value) : IStronglyTypedId<TicketCommentId, int>`
  (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Shared/Tickets/TicketCommentId.cs:19`),
  which Helpdesk's architecture tests pin as the module's only wrapper
  (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:237-252`).
  Every other identifier in the workspace is a primitive: behind an alias in every module, and bare
  in the three Common framework entities named above.

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
  passing a `SessionIdentifierType` where a `UserIdentifierType` is expected. The two `Guid`-backed
  aliases, `SessionAssetIdentifierType` and `SpeakerIdentifierType`
  (`MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:18,24`), are guarded against the `int` aliases
  only incidentally, because their underlying type differs, not by design, and nothing stops one being
  passed for the other. This is the exact safety a wrapper struct would buy and that this decision forgoes.
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
ADR-001 (the per-entity DTO mappers are parameterized by this identifier type, `IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`), ADR-034 (the generic entity controllers and query contract ride on the same identifier type parameter), ADR-006 (aliases are declared per module in the module's own `.Shared` project, matching database-per-service ownership), ADR-015 (the contrast: this convention is not fitness-enforced, unlike the invariants that gate the build), [ADR-085](085-identifier-type-aliases-revisited.md) (the 2026-08-18 revisit of the wrapper-struct deferral recorded in the Trade-offs below: same decision, now with a price and named triggers), [ADR-115](115-strongly-typed-identifiers-opt-in.md) (the opt-in wrapper-struct capability, whose one adopter takes no alias), ADR-068 (the deliberate opposite case, where domain values do get wrapper types).

## Revision (2026-08-18)
No decision, no behavior and no citation in this record changed. What changed is the standing of the
deferral it records.

The last Trade-offs entry above ("Revisiting the trade would be a broad change") described the
wrapper-struct migration as expensive without ever measuring it, and the Decision's last bullet left
the alternative "deliberately deferred, not planned" with no condition that would re-open it.
[ADR-085](085-identifier-type-aliases-revisited.md) closes both gaps: it counts the aliases (the current
census is the Revision (2026-09-11) below), counts the migration surface in occurrences of the alias token
across the `.cs`/`.razor` files of the four `Source` trees, tests excluded and `TIdentifierType` generic
parameters not counted (ADR-085 carries that figure),
names the concrete failure the deferral leaves open with a live example (ADC's `CheckIn` constructor,
which takes two different `UserIdentifierType` arguments that can be transposed silently), and records
three triggers that would re-open the question: a production defect traced to an identifier
transposition, a greenfield fifth consumer, or a materially growing cross-module identifier reference
graph.

Read the two records together as one position: this record is the decision and its evidence, ADR-085
is its price and its expiry condition.

## Revision (2026-08-23)
No decision and no rationale changed. Two counts did, both because Conference gained an alias. The
workspace census below is superseded by the Revision (2026-09-11), and Conference's seventeen aliases are
superseded by the Revision (2026-09-19): Conference now declares nineteen.

Conference's alias file declares **seventeen** aliases, `ActivityIdentifierType = int` having been
added at the head of the list
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:5-21`),
which also moved `SpeakerIdentifierType = System.Guid` down to line 19 (same file). The Decision
section above is re-anchored to both.

Recounting the alias files across the four repositories gives **44 aliases across 10 files**: Common
Domain 1 (`MMCA.Common/Source/Core/MMCA.Common.Domain/GlobalUsings.IdentifierType.cs:1`) and Common
Shared 2 (`MMCA.Common/Source/Core/MMCA.Common.Shared/GlobalUsings.NotificationIdentifierType.cs:1-2`);
ADC Notification 2
(`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Shared/MMCA.ADC.Notification.GlobalUsings.IdentifierType.cs:1-2`),
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

## Revision (2026-09-11)
No decision and no rationale changed. The workspace alias count did, because Store Catalog gained the
Reviews aggregate's two identifiers. The census in this revision is itself superseded by the Revision
(2026-09-19) below, which is the current one; Catalog's six aliases stand.

Catalog's alias file declares **six** aliases, `ProductReviewIdentifierType = int` and
`VerifiedPurchaseIdentifierType = int` joining the original four
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/MMCA.Store.Catalog.GlobalUsings.IdentifierType.cs:3-8`).
The Decision section above is re-anchored to that range.

Recounting every `GlobalUsings.*IdentifierType.cs` file in the four repositories, one
`global using X = <primitive>;` line counting as one alias, gives **46 aliases across 10 files**: Common
Domain 1 (`MMCA.Common/Source/Core/MMCA.Common.Domain/GlobalUsings.IdentifierType.cs:1`) and Common
Shared 2 (`MMCA.Common/Source/Core/MMCA.Common.Shared/GlobalUsings.NotificationIdentifierType.cs:1-2`);
ADC Notification 2
(`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Shared/MMCA.ADC.Notification.GlobalUsings.IdentifierType.cs:1-2`),
Identity 1
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/MMCA.ADC.Identity.GlobalUsings.IdentifierType.cs:2`),
Engagement 10
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/MMCA.ADC.Engagement.GlobalUsings.IdentifierType.cs:4-13`)
and Conference 17
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:5-21`);
Store Catalog 6, Identity 2
(`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Shared/MMCA.Store.Identity.GlobalUsings.IdentifierType.cs:3-4`)
and Sales 3
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Shared/MMCA.Store.Sales.GlobalUsings.IdentifierType.cs:5-7`);
and Helpdesk Tickets 2
(`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Shared/MMCA.Helpdesk.Tickets.GlobalUsings.IdentifierType.cs:6,8`).
45 of the 46 resolve to `int`; `SpeakerIdentifierType = System.Guid` remains the single `Guid`. ADR-085
carries the same pair.

Three Decision citations moved without their text changing, each pushed down by an expanded XML doc
comment: the `AuthenticationServiceBase<TUser>` constraint is at
`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:85`, ADC's
`SpeakerIdentifierType? LinkedSpeakerId` at `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:78`,
and the `UserIdentifierType UserId` record parameter at
`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/Users/IntegrationEvents/UserRegistered.cs:37`.

## Revision (2026-09-19)
No decision and no rationale changed. Three facts stated above did, two of them counts and one of them a
claim about what exists.

Conference's alias file declares **nineteen** aliases, `SessionAiScoreIdentifierType = int` and
`SessionAssetIdentifierType = System.Guid` having been added
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:7-25`).
`SessionAssetIdentifierType` is the second `Guid`-backed alias in the workspace, for a reason of its own
rather than Sessionize's: the id is a path segment of the public blob name, so it has to be unguessable
rather than sequential (same file, lines 4-5). The Decision section above is re-anchored to both.

Recounting every `GlobalUsings.*IdentifierType.cs` file in the four repositories, one
`global using X = <primitive>;` line counting as one alias, gives **48 aliases across 10 files**: Common
Domain 1 (`MMCA.Common/Source/Core/MMCA.Common.Domain/GlobalUsings.IdentifierType.cs:1`) and Common
Shared 2 (`MMCA.Common/Source/Core/MMCA.Common.Shared/GlobalUsings.NotificationIdentifierType.cs:1-2`);
ADC Notification 2
(`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Shared/MMCA.ADC.Notification.GlobalUsings.IdentifierType.cs:1-2`),
Identity 1
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/MMCA.ADC.Identity.GlobalUsings.IdentifierType.cs:2`),
Engagement 10
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/MMCA.ADC.Engagement.GlobalUsings.IdentifierType.cs:4-13`)
and Conference 19; Store Catalog 6
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/MMCA.Store.Catalog.GlobalUsings.IdentifierType.cs:3-8`),
Identity 2
(`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Shared/MMCA.Store.Identity.GlobalUsings.IdentifierType.cs:3-4`)
and Sales 3
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Shared/MMCA.Store.Sales.GlobalUsings.IdentifierType.cs:5-7`);
and Helpdesk Tickets 2
(`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Shared/MMCA.Helpdesk.Tickets.GlobalUsings.IdentifierType.cs:6,8`).
**46 of the 48 resolve to `int`**, and the two `Guid` aliases are both in Conference:
`SessionAssetIdentifierType` (file line 17) and `SpeakerIdentifierType` (file line 23). The counts in the
Revisions (2026-08-23) and (2026-09-11) above are superseded by these, and ADR-085 carries the same pair.

The Context and the Decision's last bullet claimed that no wrapper-struct identifier type existed anywhere
in the workspace. That is no longer true, and both passages now say what is: the framework ships the
opt-in wrapper-struct machinery
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Identifiers/IStronglyTypedId.cs:60`) under
[ADR-115](115-strongly-typed-identifiers-opt-in.md), and concrete wrapper structs exist as the test
fixtures that pin its contract, five in Common's Shared tests
(`MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Identifiers/TestIdentifiers.cs:10,17,24,31,38`) plus the
architecture-rule fixtures
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/StronglyTypedIdFixtures/StronglyTypedIdFixtures.cs:17`).
What is zero is adoption: no entity in any of the four `Source` trees is identified by a wrapper struct,
and no `Source` type in ADC, Store or Helpdesk references `IStronglyTypedId` at all. The decision this
record makes is unchanged by that.

## Revision (2026-10-01)
No decision and no rationale changed. One Trade-offs statement and three Decision citations did.

The Trade-offs entry on identifier swapping still treated `SpeakerIdentifierType` as the only
`Guid`-backed alias. Conference declares two, `SessionAssetIdentifierType` and `SpeakerIdentifierType`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:17,23`),
so the incidental guard holds only against the `int` aliases and the two `Guid` aliases can be
transposed silently; the entry now says so.

The Decision's Conference citation is re-anchored to the alias lines
(`MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:7-25`, the nineteen aliases below a six-line header
comment), which the Revision (2026-09-19) reported but had not applied. The `Directory.Build.props` alias
link blocks moved without their content changing: ADC is at `MMCA.ADC/Directory.Build.props:125-139` and
Store at `MMCA.Store/Directory.Build.props:129-140`.

## Revision (2026-10-06)
No decision and no rationale changed.

- The Status block omitted the Revision (2026-10-01); it is now listed there.
- The Common `Directory.Build.props` alias link blocks moved without their content changing and are at
  `MMCA.Common/Directory.Build.props:131-141`, the Common counterpart the Revision (2026-10-01) left
  stale when it re-anchored ADC and Store.
- The `AuthenticationServiceBase<TUser>` constraint is unchanged and now sits at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:72`; the Decision
  is re-anchored (the `:85` recorded in the Revision (2026-09-11) stays as recorded on that date).
- Every other anchor in the Context and Decision sections was re-verified against current source and
  holds.

## Revision (2026-10-21)
Re-verified against current source. No decision and no rationale changed, and both `Guid`-backed aliases
are where the Revision (2026-09-19) put them. One count moved because Engagement gained an alias, and the
`Directory.Build.props` alias link blocks moved without their content changing.

1. Engagement's alias file declares **eleven** aliases, `UserSessionBookmarkIdentifierType = int` having
   been added at the end of the list
   (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/MMCA.ADC.Engagement.GlobalUsings.IdentifierType.cs:4-14`).
2. Recounting every `GlobalUsings.*IdentifierType.cs` file in the four repositories, one
   `global using X = <primitive>;` line counting as one alias, gives **49 aliases across 10 files**: Common
   Domain 1 (`MMCA.Common/Source/Core/MMCA.Common.Domain/GlobalUsings.IdentifierType.cs:1`) and Common
   Shared 2 (`MMCA.Common/Source/Core/MMCA.Common.Shared/GlobalUsings.NotificationIdentifierType.cs:1-2`);
   ADC Notification 2
   (`MMCA.ADC/Source/Modules/Notification/MMCA.ADC.Notification.Shared/MMCA.ADC.Notification.GlobalUsings.IdentifierType.cs:1-2`),
   Identity 1
   (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Shared/MMCA.ADC.Identity.GlobalUsings.IdentifierType.cs:2`),
   Engagement 11 and Conference 19
   (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:7-25`);
   Store Catalog 6
   (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/MMCA.Store.Catalog.GlobalUsings.IdentifierType.cs:3-8`),
   Identity 2
   (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Shared/MMCA.Store.Identity.GlobalUsings.IdentifierType.cs:3-4`)
   and Sales 3
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Shared/MMCA.Store.Sales.GlobalUsings.IdentifierType.cs:5-7`);
   and Helpdesk Tickets 2
   (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Shared/MMCA.Helpdesk.Tickets.GlobalUsings.IdentifierType.cs:6,8`).
   **47 of the 49 resolve to `int`**; the two `Guid` aliases are unchanged, `SessionAssetIdentifierType`
   and `SpeakerIdentifierType` (Conference file lines 17 and 23). The census in the Revision (2026-09-19)
   above is superseded by this one.
3. Anchors re-verified against current source: the Decision's `Directory.Build.props` alias link blocks
   are at `MMCA.Common/Directory.Build.props:153-163` (the Common.Domain `UserIdentifierType` block at
   153-157 and the Common.Shared notification block at 159-163), `MMCA.ADC/Directory.Build.props:138-152`
   (four `<Compile Include>` entries: Identity, Conference, Engagement, Notification) and
   `MMCA.Store/Directory.Build.props:138-149` (three: Catalog, Sales, Identity). The `:131-141` recorded
   in the Revision (2026-10-06) stays as recorded on that date.

## Revision (2026-10-26)
Re-verified against current source. No decision, no rationale and no count changed: the alias census in
the Revision (2026-10-21) stands, and the four ADC and three Store `<Compile Include>` entries are in the
order that revision recorded. Five Decision citations moved without their text changing.

1. Anchors re-verified against current source: the `Directory.Build.props` alias link blocks are at
   `MMCA.Common/Directory.Build.props:136-146` (the Common.Domain `UserIdentifierType` block at 136-140
   and the Common.Shared notification block at 142-146), `MMCA.ADC/Directory.Build.props:122-136`
   (Identity, Conference, Engagement, Notification) and `MMCA.Store/Directory.Build.props:124-135`
   (Catalog, Sales, Identity); the `AuthenticationServiceBase<TUser>` constraint is at
   `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:75`; ADC's
   `User : AuditableAggregateRootEntity<UserIdentifierType>` is at
   `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:35` and its
   `SpeakerIdentifierType? LinkedSpeakerId` at line 79 of the same file. The ranges recorded in the
   Revision (2026-10-21) and the `:72` recorded in the Revision (2026-10-06) stay as recorded on those
   dates.

## Revision (2026-11-23)
Re-verified against current source. The decision and its rationale are unchanged: no identifier in
the Common, ADC or Store `Source` trees is a wrapper struct, and both `Guid`-backed aliases are still
the only two. What moved is the adoption claim, because Helpdesk now identifies one entity by a
wrapper struct, plus the alias census (Engagement up two, Helpdesk Tickets down one), a correction
about unaliased framework identifiers, and a set of anchors.

1. Helpdesk adopts one wrapper-struct identifier. `TicketComment : AuditableBaseEntity<TicketCommentId>`
   (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Domain/Tickets/TicketComment.cs:17`)
   over `TicketCommentId(int Value) : IStronglyTypedId<TicketCommentId, int>`
   (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Shared/Tickets/TicketCommentId.cs:19`),
   pinned as the module's only wrapper by
   `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:237-252`.
   No `Source` type in ADC or Store references `IStronglyTypedId`. The Context and the Decision's last
   bullet now say adoption is zero in Common, ADC and Store and one identifier in Helpdesk, rather than
   zero in all four trees.
2. The Decision now names the sanctioned exception to "every identifier is an alias": a wrapper-struct
   identifier gets no alias and code names the wrapper type directly, because the alias file is linked
   into every project and may only name a type every project can see
   (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Shared/MMCA.Helpdesk.Tickets.GlobalUsings.IdentifierType.cs:3-7`).
   The Decision also stops claiming that every identifier sits behind an alias: three Common framework
   entities are typed by a bare primitive, `MachineClient` and `WebhookSubscription` by `Guid` and
   `FeatureFlagOverride` by `string`
   (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/MachineClients/MachineClient.cs:21`,
   `MMCA.Common/Source/Core/MMCA.Common.Domain/Webhooks/WebhookSubscription.cs:38`,
   `MMCA.Common/Source/Core/MMCA.Common.Domain/FeatureFlags/FeatureFlagOverride.cs:24`). No ADC or
   Store entity is typed by a bare primitive.
3. Recounting every `GlobalUsings.*IdentifierType.cs` file under the four `Source` trees, one
   `global using X = <primitive>;` line counting as one alias, gives **50 aliases across 10 files**:
   Common Domain 1 and Shared 2; ADC Notification 2, Identity 1, Engagement 13
   (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/MMCA.ADC.Engagement.GlobalUsings.IdentifierType.cs:4-16`)
   and Conference 19; Store Catalog 6, Identity 2 and Sales 3; and Helpdesk Tickets 1, `TicketIdentifierType`
   (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Shared/MMCA.Helpdesk.Tickets.GlobalUsings.IdentifierType.cs:8`).
   **48 of the 50 resolve to `int`**. Against the Revision (2026-10-21) census of 49, Engagement gained
   two and Helpdesk Tickets lost its child-id alias (formerly line 6) when `TicketCommentId` replaced
   it, so 49 + 2 - 1 = 50. The census in the Revision (2026-10-21) above is superseded by this
   one. The gitignored template-staging copies under `MMCA.Helpdesk/artifacts/` are not counted.
4. The Related list now names [ADR-115](115-strongly-typed-identifiers-opt-in.md) alongside ADR-085.
5. Anchors re-verified against current source: the `AuthenticationServiceBase<TUser>` constraint is at
   `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:82`; the
   `Directory.Build.props` alias link blocks are at `MMCA.Common/Directory.Build.props:190-200` (the
   Common.Domain `UserIdentifierType` block at 190-194 and the Common.Shared notification block at
   196-200), `MMCA.ADC/Directory.Build.props:327-341` (Identity, Conference, Engagement, Notification)
   and `MMCA.Store/Directory.Build.props:298-309` (Catalog, Sales, Identity); Conference's nineteen
   aliases are at `MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:8-26` below a seven-line header
   comment, with `SessionAssetIdentifierType` at line 18, `SpeakerIdentifierType` at line 24 and the
   `SessionAsset` reason on lines 5-6; ADC's `User : AuditableAggregateRootEntity<UserIdentifierType>`
   is at `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:38` and its
   `SpeakerIdentifierType? LinkedSpeakerId` at line 82; `GetRepository<User, UserIdentifierType>()` is
   at `IdentityModuleDbSeeder.cs:43`; and the `UserIdentifierType UserId` parameter is at
   `UserRegistered.cs:39`. The anchors recorded in earlier revisions stay as recorded on their dates.
