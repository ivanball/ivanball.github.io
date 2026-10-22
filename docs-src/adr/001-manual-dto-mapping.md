# ADR-001: Manual DTO Mapping over AutoMapper

## Status
Accepted. _Mechanism clarified 2026-06-26: the per-entity mappers are Riok.Mapperly source-generated (compile-time), not hand-written line by line. The decision to avoid runtime convention/reflection mapping (AutoMapper, Mapster) is unchanged._ _Mapper count refreshed 2026-08-23: 31 DTO mappers across Store + ADC._ _Revised 2026-09-11 (recount): 33 DTO mappers across Store + ADC (20 in ADC, 13 in Store)._ _Revised 2026-09-19 (recount): 35 DTO mappers across Store + ADC (22 in ADC, 13 in Store); ADC added `PartnerDTOMapper` and `SessionAssetDTOMapper`._ _Revised 2026-10-21: recount to 36 DTO mappers across Store + ADC (23 in ADC, 13 in Store); ADC added the hand-written `UserListDTOMapper`, the one mapper that is not Mapperly-generated._

## Context
Domain entities must be mapped to DTOs for API responses. The two common approaches are:
1. Manual mapping classes (`IEntityDTOMapper<TEntity, TDTO, TId>`)
2. Convention-based reflection mapping (AutoMapper, Mapster)

## Decision
Use explicit, per-entity DTO mappers registered via Scrutor assembly scanning, rather than a runtime convention/reflection mapper. All but one are Riok.Mapperly `[Mapper] partial class`es whose mapping body is source-generated at compile time. The `IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>` interface in MMCA.Common supplies the invariant `MapToDTOs` batch method as a **default interface method** (it just projects each item through `MapToDTO`); most concrete mappers declare the `partial MapToDTO` that Mapperly generates (in practice every mapper also re-declares the one-line `MapToDTOs` projection, and a few add `[UserMapping]`/`[UseMapper]` helpers). Two Mapperly mappers instead hand-write their public `MapToDTO` to wrap a private generated `MapToDTOGenerated`: `SpeakerDTOMapper`, so its PII-redaction rule can run, and `EventDTOMapper`, to convert `LastSessionizeRefreshBy` to a string, which Mapperly cannot express. One mapper is fully hand-written: ADC's `UserListDTOMapper` is a plain `sealed class` implementing `IEntityDTOMapper<User, UserListDTO, UserIdentifierType>` with no `[Mapper]` attribute, projecting the roster row field by field. A parallel `IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>` maps incoming create requests to entities via the entity factory, returning `Result<T>`.

## Rationale
- **Compile-time safety**: Mapping errors surface at build time, not runtime. Property renames break the build rather than silently mapping `null`.
- **Testability**: Each mapper is a small class (a Mapperly partial class with generated mapping code, or in the one hand-written case a plain class) whose `MapToDTO` is plain, steppable code with no runtime mapping framework, easily unit-tested in isolation.
- **Conditional logic**: Some mappers have business rules (e.g., `SpeakerDTOMapper` redacts PII for non-organizer roles). Convention-based tools make conditional mapping awkward.
- **Debuggability**: Stack traces point to a specific line in a specific mapper, not into a framework's pipeline.
- **Performance**: No reflection or expression compilation at mapping time.

## Trade-offs
- More files (36 DTO mappers across Store + ADC: 23 in ADC, of which 22 are Mapperly and 1 hand-written, and 13 in Store, all Mapperly, plus the parallel `IEntityRequestMapper` classes). The interface's default `MapToDTOs` implementation is available to remove the batch-mapping boilerplate, though in practice each concrete mapper re-declares the identical one-line projection rather than relying on the default.
- Adding a new entity requires creating a mapper class. This is consistent with the project's explicit-over-implicit philosophy.

## Revision (2026-10-21)
Re-verified against current source. The decision (explicit per-entity mappers, no runtime convention or reflection mapper) is unchanged; the mapper count moved and one mapper is not Mapperly-generated.

1. ADC now has 23 `*DTOMapper` classes, up from 22. The new one, `UserListDTOMapper` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/DTOs/UserListDTOMapper.cs:14`), is a hand-written `sealed class` implementing `IEntityDTOMapper<User, UserListDTO, UserIdentifierType>` with no `[Mapper]` attribute; its `MapToDTO` (`:17`) projects the roster row field by field and its `MapToDTOs` (`:34`) re-declares the one-line projection. The other 22 ADC mappers carry `[Mapper]` (one class per file; `EventDTOMapper`'s second match is a `[MapperIgnoreTarget]` at `EventDTOMapper.cs:51`, not a second class).
2. Store is unchanged at 13 `*DTOMapper` classes, all carrying `[Mapper]`. Total: 36 DTO mappers (23 ADC, 13 Store). The Decision, Rationale and Trade-offs now name the hand-written exception, and the Decision names both Mapperly mappers that wrap a private generated `MapToDTOGenerated` behind a hand-written public `MapToDTO`: `SpeakerDTOMapper` (`SpeakerDTOMapper.cs:43`, wrapping `:59`) and `EventDTOMapper` (`EventDTOMapper.cs:31`, wrapping `:52`). No Store mapper uses that shape.
3. Anchors re-verified against current source: the hand-written class declaration at `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/DTOs/UserListDTOMapper.cs:14`, and the `[Mapper]` attribute lines of the two wrapper mappers at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Events/DTOs/EventDTOMapper.cs:14` and `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerDTOMapper.cs:16` (their class declarations follow at `:15` and `:17`).
