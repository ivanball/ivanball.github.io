# Delete AutoMapper: explicit, compile-time DTO mapping that you can actually test

> Series: MMCA.Common · Article #23 (deep-dive) · Pillar P2 · Group G12 · Rubric §9,§15 · ADR-001 · Status: grounded in `Website/docs-src/onboarding/group-12-api-hosting-mapping.md`, ADR-001, `Interfaces/Mapping/IEntityDTOMapper.cs`, `DependencyInjection.ModuleScanning.cs`. No em dashes.

**Subtitle:** Reflection-based mappers feel like they save you work until the day a renamed property silently maps to null in production. Here is the alternative: named mapper classes, generated at compile time, where a renamed property is a build error and a bad request is a Result failure, not an exception.

---

Almost every .NET service has the same boring chore. A domain entity comes out of the database, and a Data Transfer Object has to go over the wire. They are *almost* the same shape, so reaching for AutoMapper feels obvious: register a profile, call `Map<ProductDto>(product)`, and the property-name convention wires it up for you. Zero boilerplate. What is not to like?

Here is what is not to like. Six months later somebody renames `Product.Title` to `Product.Name`, the DTO still has `Title`, and the convention quietly stops mapping it. No compiler error. No test failure unless you happened to assert that exact field. The API just starts returning `title: null`, and you find out from a support ticket. The mapping that "saved you work" was invisible coupling held together by string-matched property names, and it broke in the one place a type system normally protects you: a rename.

That failure mode is the reason MMCA.Common rejects reflection-based AutoMapper. The decision is **ADR-001**: mapping is explicit, lives in named mapper classes, and is checked by the compiler, not discovered at runtime. (The decision is a policy; its one mechanical guard is narrower: the architecture fitness rules list AutoMapper among the frameworks a Domain or Shared layer must never reference.) This article walks through how that works, why the two mapper roles are split, and why "write the mapper yourself" is cheaper than it sounds once a source generator writes the body for you.

## The case against convention-based mapping

Be precise about what goes wrong with a reflection mapper, because "I prefer explicit code" is not an argument. Here are four concrete failure modes, all things a type system is supposed to catch:

- **Silent mis-maps.** Property-name conventions map what matches and ignore what does not. A rename, a typo, or a deliberately different DTO field name produces a `null` or a default, not an error. The map degrades silently.
- **Runtime profile errors.** When the convention cannot figure something out, you find out at the first request that exercises that path, in production, as a 500. Configuration that "compiles" but is wrong is the worst kind of configuration.
- **Invisible coupling.** The fact that `Product.Name` feeds `ProductDto.Name` exists nowhere you can read it. It is an emergent property of two class shapes and a runtime engine. Rename either side and the coupling breaks without telling you.
- **Hard to test and debug.** A stack trace from a failed convention map points into the mapping framework's expression-tree machinery, not at a line of your code. Conditional mapping (redact this field for this role) fits awkwardly into a declarative profile, so it tends to leak back out into handlers anyway.

None of these are exotic. They are the ordinary tax of trading compile-time checking for runtime convenience. ADR-001 argues the same conclusion from the positive side: its rationale is five reasons to choose explicit mapping over a reflection convention, namely compile-time safety, testability, conditional logic, debuggability, and performance. The first of them names the exact failure above: a property rename breaks the build rather than silently mapping `null`.

## Two roles, two interfaces

The first design move is to notice that "mapping" is actually two different jobs that deserve two different contracts. Reading data out and accepting data in are not symmetric, and the framework refuses to pretend they are.

**Outbound: `IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`** is the read side. It maps a domain entity to the DTO that crosses the wire. It lives in `MMCA.Common.Application` (`Interfaces/Mapping/IEntityDTOMapper.cs`) and is triple-generic, constrained so the entity is an `AuditableBaseEntity<TIdentifierType>`, the DTO implements `IBaseDTO<TIdentifierType>`, and the identifier type is `notnull`. Those constraints force the entity and its DTO to agree on the identifier type at compile time, so you cannot accidentally pair a `Guid`-keyed entity with an `int`-keyed DTO.

It has exactly one required member, `MapToDTO(entity)`. The batch version, `MapToDTOs(collection)`, is a C# **default interface method** that just projects each item through `MapToDTO` with a collection expression. The default exists so that no mapper has to write the loop, and the honest reality is that none of them lean on it: all 35 concrete DTO mappers in MMCA.ADC and MMCA.Store (22 and 13) re-declare that identical one-line projection instead of inheriting it, which ADR-001 records outright in its own trade-offs, and the two DTO mappers in the MMCA.Helpdesk reference app do the same. The contract still guarantees the batch shape is there for free; the part you actually have to think about is the single-item map.

**Inbound: `IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`** is the write side, and this is where the design earns its keep. It maps an incoming create request to a domain entity, but its signature is the interesting part:

```csharp
Task<Result<TEntity>> CreateEntityAsync(
    TCreateRequest request,
    CancellationToken cancellationToken = default);
```

It returns `Task<Result<TEntity>>`, not `TEntity`. That is deliberate, and it is the whole point of separating the request mapper from the DTO mapper. The two interfaces are declared in the same file (which also declares `IEntityUpdateApplier<,,>`, the update-path twin that applies a request to an already-loaded aggregate and sits outside this article's create-and-read scope) but they are not mirror images of each other, because going *in* is fundamentally riskier than going *out*.

## Why the request mapper returns a Result

When you read an entity out, mapping cannot really fail. The data already passed validation when it was written; you are just reshaping a valid object. So the read mapper returns the DTO directly.

When you accept a request in, mapping *is* validation. The request might be malformed. It might violate a domain invariant. It might need a database round-trip to check, for example, that the name is unique before the entity can be created at all. A convention mapper has no good answer here. It either throws (turning an expected, ordinary "that name is taken" into an exception you have to catch somewhere) or it maps anyway and pushes the problem downstream.

The request mapper's answer is to make the failure a *value*. Its job is to call the entity's `Create(...)` factory method, which itself returns a `Result<TEntity>`, and propagate that Result. A malformed request becomes a `Result.Failure`, never a thrown exception. A uniqueness check can run as an `await` before the factory is even called, and a conflict comes back as a failure value too. The `Task` in the signature exists precisely so that database-touching validation can happen inside the mapper, before the entity exists, and report its verdict as a Result.

This is the same Result-pattern discipline the rest of the framework runs on, applied at the exact boundary where untrusted input first becomes a domain object. The edge maps that Result to a `400` or `409` later; the mapper's job is just to produce the value, not to know about HTTP. A request mapper that returned a bare `TEntity` would have nowhere to put "this request was bad" except an exception, and exceptions are the thing the Result pattern exists to avoid for expected failures.

## Mapperly: explicit and fast, because a generator writes the body

The AutoMapper crowd will raise one objection immediately: if you write every mapper by hand, you are back to typing `dto.Name = entity.Name;` forty times per entity, and that is its own kind of bug farm.

True, if you actually hand-type the assignments. MMCA.Common does not. It uses **Riok.Mapperly** (version 4.3.1), a *source-generated*, compile-time object mapper. You declare a partial mapper method; Mapperly generates the straight-line assignment code at build time. No runtime reflection, no expression-tree compilation, no per-call construction of a mapping plan. The generated code is the same boring `dto.Name = entity.Name;` you would have written, except the compiler wrote it and the build fails when a DTO member has nothing to map from.

This is the move that dissolves the usual "explicit versus convenient" dichotomy. Mapperly gives you both:

- It is **explicit**, because the mapper is a named class you can open, read, and set a breakpoint in. The mapping exists as code, not as an emergent property of two type shapes.
- It is **compile-time checked** where the rename bites: a DTO member with no matching source member is a Mapperly generator warning, and `TreatWarningsAsErrors` turns it into a build error, surfaced in the implementing class, not a runtime surprise. The opposite direction is deliberately quiet: an entity member that no DTO member consumes (Mapperly's RMG020) is suppressed in the Application projects, so a DTO can expose a subset of its entity without noise.
- It is **fast**, because there is no reflection or expression compilation at mapping time, just the generated assignments.

So the framework's mapper interfaces define the *contract* (entity to DTO, request to Result-of-entity), and Mapperly fills in the *body* for the common straight-shape cases. When a mapper needs genuine business logic (the canonical ADR-001 example is a speaker mapper that redacts PII for non-organizer roles), you just write that logic in the same class. Conditional mapping that is awkward in a declarative profile is ordinary C# here.

## Auto-discovery: you write the mapper, you do not wire it

The last piece is registration, and the framework keeps it convention-driven without making it reflection-at-runtime. Mappers are plain classes that implement one of the two interfaces. When a module is scanned at startup via `ScanModuleApplicationServices<TAssemblyMarker>()`, Scrutor finds every DTO mapper and request mapper in that module's Application assembly and registers each one **scoped**, alongside the module's handlers, validators, and event handlers. Five mapping-related scans sit side by side in that method, in this order: DTO mappers, then an opt-in scan for `IEntityDTOProjector<,,>` (an entity that has a projector gets server-side projection on its list reads, one that has none keeps materialize-then-map), then request mappers, then the two update-applier contracts that do the same job on the update path. All five register the class as itself and by its interfaces, with a scoped lifetime.

The distinction from AutoMapper is worth stating plainly: this scanning happens once, at composition time, to populate the DI container. It is not a per-request reflection engine deciding how to map fields. The mapping logic itself is compiled code. Discovery is a startup convenience; the map is static.

So the developer experience is: create a class, implement `MapToDTO` (and `CreateEntityAsync` for the create side), let Mapperly generate the assignments, and the module scan registers it. You never touch a profile registry. Be clear about the edge of the guarantee, though: the compiler checks the body of a mapper you wrote, not the existence of one. The scan registers whatever mapper classes it finds, so adding the class for a new entity is still your job.

## A concrete pair

Putting it together, a module holds both directions. The pair below is trimmed from the Store Catalog module's real `Product` mappers (the delegating sub-mappers, the two `[MapProperty]` attributes that flatten the owned rating summary, and a shallow-category helper are elided): entity to DTO on the read side, request to `Result<TEntity>` on the write side, with a Mapperly `[Mapper]` partial supplying the straight-shape body.

```csharp
// Read side: entity -> response DTO. Cannot fail; returns the DTO directly.
[Mapper]
public sealed partial class ProductDTOMapper
    : IEntityDTOMapper<Product, ProductDTO, ProductIdentifierType>
{
    // Mapperly generates this body at build time.
    public partial ProductDTO MapToDTO(Product entity);

    // Re-declared, not inherited, exactly as every concrete mapper does.
    public IReadOnlyCollection<ProductDTO> MapToDTOs(
        IReadOnlyCollection<Product> entityCollection)
    {
        ArgumentNullException.ThrowIfNull(entityCollection);
        return [.. entityCollection.Select(MapToDTO)];
    }
}

// Write side: request -> entity, via the factory, as a Result.
public sealed class ProductCreateRequestMapper
    : IEntityRequestMapper<Product, ProductCreateRequest, ProductIdentifierType>
{
    public Task<Result<Product>> CreateEntityAsync(
        ProductCreateRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        // Product.Create is the factory, and it returns Result<Product>.
        // A mapper that needs a uniqueness check awaits it here and returns
        // Result.Failure, not an exception.
        return Task.FromResult(Product.Create(
            request.Id,
            request.Name,
            request.Description,
            request.Brand,
            request.CategoryId));
    }
}
```

Two classes, two directions, both explicit, both compiler-checked. The read mapper returns a DTO because reading valid data cannot fail. The request mapper returns a `Result<Product>` because accepting input can fail, and a failure is a value the edge will turn into the right status code. (For how these slot into a full module, see the build-your-first-module walkthrough later in the series; this article zooms in on the mapping boundary.)

## Trade-offs, honestly

This is not a free win, and pretending otherwise would be exactly the kind of hand-waving the framework is built to avoid.

- **It is more boilerplate than AutoMapper's zero-config start.** AutoMapper's pitch is real: for a brand-new project with simple shapes, `AddAutoMapper(...)` and a convention is genuinely less typing on day one. ADR-001 accepts this cost explicitly: there are dozens of mapper classes across the consuming apps. The bet is that day-one typing is the cheap part and year-two silent breakage is the expensive part.
- **There is a Mapperly learning curve.** A source-generated mapper is not free of its own concepts. You have to understand its `[Mapper]` partial conventions, its diagnostics, and when to drop to hand-written code for a non-trivial map. It is less to learn than AutoMapper's full profile and projection surface, but it is not nothing.
- **You have to write the mapper, every time.** Adding an entity means adding a mapper class. There is no convention that "just works" for a new type. That is the philosophy stated as a constraint: explicit over implicit, with no escape hatch back into runtime magic.
- **The upside does not show up in a demo.** Explicit, testable, compile-time-checked, reflection-free mapping does not make the first commit faster. It makes the rename safe, the stack trace readable, the conditional map ordinary, and the unit test trivial (a mapper is a plain class with no framework around it). Those payoffs land in month six, not minute one.

The honest summary: you trade a small, constant, up-front cost for the removal of a class of silent runtime bugs. If your mapping is trivial and stable forever, AutoMapper is fine. If it will be renamed, conditionally shaped, and load-bearing for years, the explicit mapper pays for itself.

## Apply this even without MMCA

You do not need this framework to adopt the pattern. The ideas port to any stack:

1. **Split read mapping from write mapping.** They are not symmetric. Reading reshapes valid data; writing validates untrusted input. Give them different contracts.
2. **Make the write mapper return a result type, not throw.** A malformed request is an expected outcome, not an exceptional one. Return a `Result`/`Either`/discriminated union so a bad request is a value the edge maps to a status code.
3. **Use a source generator, not a reflection engine.** Mapperly (or an equivalent compile-time mapper) gives you explicit, readable, fast mapping with the boilerplate generated. You get the safety of hand-written code without typing the assignments.
4. **Let the compiler catch missing maps.** The single most valuable property is that a renamed field breaks the build, not production. Anything that defers that check to runtime is the thing to avoid.
5. **Scan to register, but keep the map static.** Auto-discovery at startup is a convenience. Per-request reflection to decide the map is the failure mode. Those are different things; keep the first, drop the second.

The takeaway: **convention-based mapping trades a compile-time guarantee for a runtime convenience on the one operation you do everywhere. Put mapping in named classes, let a source generator write the bodies, return a Result from the write side, and the rename that used to ship a null in production becomes a red build instead.**

---

**What we covered:** why reflection-based AutoMapper fails silently on renames and pushes validation into exceptions, how ADR-001 splits mapping into two explicit roles (`IEntityDTOMapper` for entity-to-DTO reads and `IEntityRequestMapper` for request-to-entity writes), why the request mapper returns `Result<TEntity>` so a malformed request is a value and not an exception, how Riok.Mapperly source-generates the boilerplate at compile time so the mapping stays explicit and fast, and how convention scanning auto-registers each mapper scoped without a runtime mapping engine.

**Next in the series:** permission-based authorization, the capability layer over roles that turns the
role you did not foresee into a one-line grant instead of an attribute sweep.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the API-and-mapping chapter of the onboarding guide, or `dotnet add package MMCA.Common.Application` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`

*Tags: .NET, C Sharp, Software Architecture, API Design, AutoMapper*

*Notes: re-verified 2026-10-02 against source at MMCA.Common v1.221.0 (`MMCA.Common/FACTS.md:14`). Contracts: `IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>` at `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Mapping/IEntityDTOMapper.cs:14-17` (constraints `AuditableBaseEntity<TIdentifierType>` / `IBaseDTO<TIdentifierType>` / `notnull`), `MapToDTO` at `:22`, default `MapToDTOs` at `:27-32` (null-guard `:29`, collection-expression projection `:31`); `IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>` at `:42-45` (`TCreateRequest : ICreateRequest`), `CreateEntityAsync` returning `Task<Result<TEntity>>` at `:54`, XML doc naming async uniqueness checks at `:37`; `IEntityUpdateApplier<,,>` at `:79-92`, `ApplyAsync` returning `Task<Result>` at `:91` (named once, out of scope). Registration: the scan lives in the partial file `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.ModuleScanning.cs` (this run re-anchors it from `DependencyInjection.cs:169-258`, which no longer holds it): generic `ScanModuleApplicationServices<TAssemblyMarker>() where TAssemblyMarker : class` at `:28-30`, assembly overload at `:46`; domain and integration event handlers singleton at `:52-56` and `:59-63`; DTO mappers `AssignableTo(typeof(IEntityDTOMapper<,,>))` `.AsSelfWithInterfaces().WithScopedLifetime()` at `:65-69` (predicate `:67`, lifetime `:69`); opt-in `IEntityDTOProjector<,,>` at `:74-78` (comment `:71-73`); request mappers at `:80-84`; `IEntityUpdateApplier<,,>` at `:90-94` (comment `:86-89`); `IEntityUpdateCommandApplier<,,,>` at `:99-103` (comment `:96-98`); command and query handlers scoped at `:105-109` and `:111-115`; `AddValidatorsFromAssembly(moduleAssembly)` at `:117`. That is the five mapping-related scans the registration section counts. Riok.Mapperly 4.3.1 at `MMCA.Common/Directory.Packages.props:31`, `MMCA.ADC/Directory.Packages.props:38` (Polly.Core 8.8.0 at `:37` under its lockstep comment at `:36`), `MMCA.Store/Directory.Packages.props:61`. Mapperly's primer description at `Website/docs-src/onboarding/00-primer.md:390` (Scrutor 7 bullet `:393`). ADR-001 (`Website/docs-src/adr/001-manual-dto-mapping.md`): status and recounts `:4`, decision `:12`, five rationale bullets `:15-19` (rename-breaks-the-build `:15`, SpeakerDTOMapper PII redaction `:17`, performance "No reflection or expression compilation at mapping time" `:19`), trade-offs "35 DTO mappers across Store + ADC: 22 in ADC, 13 in Store" plus the re-declared projection `:22`. Helpdesk's two DTO mappers re-declare the projection too: `MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Application/Tickets/DTOs/TicketDTOMapper.cs:31` and `TicketCommentDTOMapper.cs:17`; the 35 stays the ADR's Store + ADC count and the body now names the repos instead of "the two consuming apps". UNVERIFIABLE resolutions this run: (1) "bans reflection-based AutoMapper outright" narrowed to "rejects" plus the real guard: `AutoMapper` is one entry in `ForbiddenDomainDependencies` at `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Layering/ArchitectureRules.Purity.cs:9-21` (`:14`), applied only by `DomainIsFrameworkFree` (`:23`) and `SharedIsFrameworkFree` (`:38`); Mapster is not listed and no Application or API rule exists. (2) The sentence crediting ADR-001 with a "verdict ... that trade is backwards" removed (the ADR has no such text) and replaced by the ADR's own rename bullet at `:15`. (3) "an unmapped property or a type mismatch is a build error" narrowed: RMG020 (source member unmapped) is in `NoWarn` for Application projects at `MMCA.Store/Directory.Build.props:66-67` (comment `:60-65`), `MMCA.ADC/Directory.Build.props:63` (comment `:56`) and globally at `MMCA.Common/Directory.Build.props:30`; the rename case (target member with no source) still fails the build under `TreatWarningsAsErrors` at `MMCA.Store/Directory.Build.props:10`, `MMCA.ADC/Directory.Build.props:10`, `MMCA.Common/Directory.Build.props:7`. Mapperly's own diagnostic id for the target-side case and its default severity are not in any repo file and are not cited; "type mismatch" dropped as not determinable from source. (4) "if it did not, the build would have failed" replaced by the narrower statement that the compiler checks a mapper's body, not its existence, grounded in the scan registering whatever classes it finds (`DependencyInjection.ModuleScanning.cs:65-84`); no `ValidateOnBuild` exists in `MMCA.Common/Source` (Grep, 2026-10-02), and the article makes no claim about where a missing mapper surfaces. (5) "allocation-free" removed in both places (Mapperly bullet and trade-offs) since ADR-001 `:19` claims only no reflection or expression compilation and the batch method allocates a collection at `IEntityDTOMapper.cs:31`; "per-call allocation of a mapping plan" reworded to "construction". (6) "the two consuming apps" resolved as above. Concrete pair re-anchored: `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Products/DTOs/ProductDTOMapper.cs` `[Mapper]` `:15`, class `:16`, `[UseMapper]` sub-mapper fields `:21` and `:24`, two `[MapProperty]` `:35` and `:38`, `public partial ProductDTO MapToDTO(Product entity);` `:41`, re-declared `MapToDTOs` `:44`, `[UserMapping]` helper `:50`; `.../Products/UseCases/Create/ProductCreateRequestMapper.cs` class `:11`, non-async `CreateEntityAsync` `:15`, `Task.FromResult(Product.Create(` `:19`. Not re-read this run (carried as CONFIRMED by the 2026-10-02 audit): `Product.Create` returning `Result<Product>` (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Domain/Products/Product.cs:97`), the `ProductIdentifierType` int alias (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/MMCA.Store.Catalog.GlobalUsings.IdentifierType.cs:4`), the SpeakerDTOMapper redaction (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerDTOMapper.cs:49`) and the 409 conflict mapping (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:25`). The four AutoMapper failure modes remain the article's own framing; ADR-001 does not enumerate them.*

- Full series index: https://ivanball.github.io/writing.html
