# Delete AutoMapper: explicit, compile-time DTO mapping that you can actually test

> Series: MMCA.Common · Article #23 (deep-dive) · Pillar P2 · Group G12 · Rubric §9,§15 · ADR-001 · Status: grounded in `Website/docs-src/onboarding/group-12-api-hosting-mapping.md`, ADR-001. No em dashes.

**Subtitle:** Reflection-based mappers feel like they save you work until the day a renamed property silently maps to null in production. Here is the alternative: named mapper classes, generated at compile time, where a missing map is a build error and a bad request is a Result failure, not an exception.

---

Almost every .NET service has the same boring chore. A domain entity comes out of the database, and a Data Transfer Object has to go over the wire. They are *almost* the same shape, so reaching for AutoMapper feels obvious: register a profile, call `Map<ProductDto>(product)`, and the property-name convention wires it up for you. Zero boilerplate. What is not to like?

Here is what is not to like. Six months later somebody renames `Product.Title` to `Product.Name`, the DTO still has `Title`, and the convention quietly stops mapping it. No compiler error. No test failure unless you happened to assert that exact field. The API just starts returning `title: null`, and you find out from a support ticket. The mapping that "saved you work" was invisible coupling held together by string-matched property names, and it broke in the one place a type system normally protects you: a rename.

That failure mode is the reason MMCA.Common bans reflection-based AutoMapper outright. The decision is **ADR-001**: mapping is explicit, lives in named mapper classes, and is checked by the compiler, not discovered at runtime. This article walks through how that works, why the two mapper roles are split, and why "write the mapper yourself" is cheaper than it sounds once a source generator writes the body for you.

## The case against convention-based mapping

Be precise about what goes wrong with a reflection mapper, because "I prefer explicit code" is not an argument. Here are four concrete failure modes, all things a type system is supposed to catch:

- **Silent mis-maps.** Property-name conventions map what matches and ignore what does not. A rename, a typo, or a deliberately different DTO field name produces a `null` or a default, not an error. The map degrades silently.
- **Runtime profile errors.** When the convention cannot figure something out, you find out at the first request that exercises that path, in production, as a 500. Configuration that "compiles" but is wrong is the worst kind of configuration.
- **Invisible coupling.** The fact that `Product.Name` feeds `ProductDto.Name` exists nowhere you can read it. It is an emergent property of two class shapes and a runtime engine. Rename either side and the coupling breaks without telling you.
- **Hard to test and debug.** A stack trace from a failed convention map points into the mapping framework's expression-tree machinery, not at a line of your code. Conditional mapping (redact this field for this role) fits awkwardly into a declarative profile, so it tends to leak back out into handlers anyway.

None of these are exotic. They are the ordinary tax of trading compile-time checking for runtime convenience. ADR-001 argues the same conclusion from the positive side: its rationale is five reasons to choose explicit mapping over a reflection convention, namely compile-time safety, testability, conditional logic, debuggability, and performance. Its verdict is that for the one operation you do on *every single read and write path*, that trade is backwards.

## Two roles, two interfaces

The first design move is to notice that "mapping" is actually two different jobs that deserve two different contracts. Reading data out and accepting data in are not symmetric, and the framework refuses to pretend they are.

**Outbound: `IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`** is the read side. It maps a domain entity to the DTO that crosses the wire. It lives in `MMCA.Common.Application` (`Interfaces/Mapping/IEntityDTOMapper.cs`) and is triple-generic, constrained so the entity is an `AuditableBaseEntity<TIdentifierType>`, the DTO implements `IBaseDTO<TIdentifierType>`, and the identifier type is `notnull`. Those constraints force the entity and its DTO to agree on the identifier type at compile time, so you cannot accidentally pair a `Guid`-keyed entity with an `int`-keyed DTO.

It has exactly one required member, `MapToDTO(entity)`. The batch version, `MapToDTOs(collection)`, is a C# **default interface method** that just projects each item through `MapToDTO` with a collection expression. The default exists so that no mapper has to write the loop, and the honest reality is that none of them lean on it: all 35 concrete DTO mappers across the two consuming apps re-declare that identical one-line projection instead of inheriting it, which ADR-001 records outright in its own trade-offs. The contract still guarantees the batch shape is there for free; the part you actually have to think about is the single-item map.

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

True, if you actually hand-type the assignments. MMCA.Common does not. It uses **Riok.Mapperly** (version 4.3.1), a *source-generated*, compile-time object mapper. You declare a partial mapper method; Mapperly generates the straight-line assignment code at build time. No runtime reflection, no expression-tree compilation, no per-call allocation of a mapping plan. The generated code is the same boring `dto.Name = entity.Name;` you would have written, except the compiler wrote it and will refuse to compile if the shapes do not line up.

This is the move that dissolves the usual "explicit versus convenient" dichotomy. Mapperly gives you both:

- It is **explicit**, because the mapper is a named class you can open, read, and set a breakpoint in. The mapping exists as code, not as an emergent property of two type shapes.
- It is **compile-time checked**, because an unmapped property or a type mismatch is a build error or a generator diagnostic, surfaced in the implementing class, not a runtime surprise.
- It is **fast and allocation-free**, because there is no reflection at mapping time, just the generated assignments.

So the framework's mapper interfaces define the *contract* (entity to DTO, request to Result-of-entity), and Mapperly fills in the *body* for the common straight-shape cases. When a mapper needs genuine business logic (the canonical ADR-001 example is a speaker mapper that redacts PII for non-organizer roles), you just write that logic in the same class. Conditional mapping that is awkward in a declarative profile is ordinary C# here.

## Auto-discovery: you write the mapper, you do not wire it

The last piece is registration, and the framework keeps it convention-driven without making it reflection-at-runtime. Mappers are plain classes that implement one of the two interfaces. When a module is scanned at startup via `ScanModuleApplicationServices<TAssemblyMarker>()`, Scrutor finds every DTO mapper and request mapper in that module's Application assembly and registers each one **scoped**, alongside the module's handlers, validators, and event handlers. Five mapping-related scans sit side by side in that method, in this order: DTO mappers, then an opt-in scan for `IEntityDTOProjector<,,>` (an entity that has a projector gets server-side projection on its list reads, one that has none keeps materialize-then-map), then request mappers, then the two update-applier contracts that do the same job on the update path. All five register the class as itself and by its interfaces, with a scoped lifetime.

The distinction from AutoMapper is worth stating plainly: this scanning happens once, at composition time, to populate the DI container. It is not a per-request reflection engine deciding how to map fields. The mapping logic itself is compiled code. Discovery is a startup convenience; the map is static.

So the developer experience is: create a class, implement `MapToDTO` (and `CreateEntityAsync` for the create side), let Mapperly generate the assignments, and the module scan registers it. You never touch a profile registry, and you never wonder at runtime whether a map exists, because if it did not, the build would have failed.

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
- **The upside does not show up in a demo.** Explicit, testable, compile-time-checked, allocation-free mapping does not make the first commit faster. It makes the rename safe, the stack trace readable, the conditional map ordinary, and the unit test trivial (a mapper is a plain class with no framework around it). Those payoffs land in month six, not minute one.

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

*Notes: re-verified this run against source at MMCA.Common v1.205.0 (`MMCA.Common/FACTS.md:14`). `IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>` is declared at `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Mapping/IEntityDTOMapper.cs:14-17` with constraints `AuditableBaseEntity<TIdentifierType>` / `IBaseDTO<TIdentifierType>` / `notnull`; the file sits under `Interfaces/Mapping/` and the article's path reference is corrected to match. Its single required member is `MapToDTO(TEntity entity)` at `IEntityDTOMapper.cs:22`, and `MapToDTOs(IReadOnlyCollection<TEntity>)` is a default interface method returning the collection expression `[.. entityCollection.Select(MapToDTO)]` at `IEntityDTOMapper.cs:27-32` (null-guard at `:29`, projection at `:31`). That default is supplied but not relied on: every concrete mapper re-declares the identical one-line projection (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Products/DTOs/ProductDTOMapper.cs:44-48` is representative), which ADR-001 states in its trade-offs at `Website/docs-src/adr/001-manual-dto-mapping.md:22` ("in practice each concrete mapper re-declares the identical one-line projection rather than relying on the default"). `IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>` is in the same file at `:42-45` (constrained `TCreateRequest : ICreateRequest`), and `CreateEntityAsync(TCreateRequest, CancellationToken)` returns `Task<Result<TEntity>>` at `IEntityDTOMapper.cs:54` (its XML doc names async validation such as uniqueness checks at `:37`). The same file also declares a third contract, `IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType>` at `:79-92`, whose `ApplyAsync(TEntity, TUpdateRequest, CancellationToken)` returns `Task<Result>` at `:91`; it is the write-side twin that applies a request onto an already-loaded aggregate, and because this article's scope is create-and-read mapping it is named once and not covered. Registration re-verified in `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs`: the scan method is `ScanModuleApplicationServices<TAssemblyMarker>() where TAssemblyMarker : class` at `:169-171`, delegating to the assembly-typed overload `ScanModuleApplicationServices(Assembly moduleAssembly)` at `:187`. DTO mappers are scanned `AssignableTo(typeof(IEntityDTOMapper<,,>))` with `.AsSelfWithInterfaces().WithScopedLifetime()` at `:206-210` (predicate `:208`, lifetime `:210`), an opt-in `IEntityDTOProjector<,,>` scan sits between the two mapper scans at `:215-219` (comment `:212-214`), request mappers are scanned at `:221-225`, and two further scans follow them: `IEntityUpdateApplier<,,>` at `:231-235` (comment `:227-230`) and `IEntityUpdateCommandApplier<,,,>` at `:240-244` (comment `:237-239`). That is why the article's registration section counts five mapping-related scans rather than three. For contrast, domain and integration event handlers register as singletons (`:197`, `:204`), command and query handlers scoped (`:248`, `:254`), and validators via `services.AddValidatorsFromAssembly(moduleAssembly)` (`:258`, the assembly-typed overload). Riok.Mapperly 4.3.1 re-verified at `MMCA.Common/Directory.Packages.props:35`; the ADC consumer pin is at `MMCA.ADC/Directory.Packages.props:37` (the Polly.Core 8.8.0 lockstep entry is the immediately preceding line `:36`, under its comment at `:35`), and the Store pin is `MMCA.Store/Directory.Packages.props:58`. Mapperly's "source-generated, compile-time object mapper (no runtime reflection)" description is at `Website/docs-src/onboarding/00-primer.md:375` (the unrelated Scrutor 7 bullet is at `:378`). ADR-001's Rationale is FIVE positive bullets for choosing explicit Mapperly mapping over runtime reflection (`Website/docs-src/adr/001-manual-dto-mapping.md:15-19`: compile-time safety, testability, conditional logic, debuggability, performance); it does NOT enumerate "four failure modes," so the article's four AutoMapper failure modes stay flagged as the article's own framing, with the section close citing ADR-001's real five-bullet rationale. ADR-001 chose per-entity Riok.Mapperly `[Mapper] partial class` mappers over AutoMapper/Mapster runtime reflection (`001-manual-dto-mapping.md:4,9,12`), names the `SpeakerDTOMapper` PII-redaction example (`:12,:17`), and records the count in its trade-offs as "35 DTO mappers across Store + ADC: 22 in ADC, 13 in Store" (`:22`), recounted 2026-09-19 per its status line (`:4`, which also carries the 2026-06-26 mechanism clarification and the 2026-08-23 and 2026-09-11 recounts); the article's batch-mapping paragraph quotes that 35, and its "dozens of mapper classes across the consuming apps" wording covers the 35 plus the parallel `IEntityRequestMapper` classes. The "concrete pair" code block is aligned to the real Store Catalog classes: `[Mapper] public sealed partial class ProductDTOMapper : IEntityDTOMapper<Product, ProductDTO, ProductIdentifierType>` (`ProductDTOMapper.cs:15-19`) with `public partial ProductDTO MapToDTO(Product entity);` at `:41` and its re-declared `MapToDTOs` at `:44-48`, plus `public sealed class ProductCreateRequestMapper : IEntityRequestMapper<Product, ProductCreateRequest, ProductIdentifierType>` whose `CreateEntityAsync` is deliberately NOT `async`, returning `Task.FromResult(Product.Create(...))` (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Products/UseCases/Create/ProductCreateRequestMapper.cs:11-12,15,17,19-25`). Honest gap: that block is still a trimmed rendering, not a verbatim copy. The real `ProductDTOMapper` also takes `ProductVariantDTOMapper` and `ProductImageDTOMapper` constructor dependencies held in `[UseMapper]` fields (`ProductDTOMapper.cs:16-25`), two `[MapProperty]` attributes flattening `Product.RatingSummary.AverageRating` and `.ReviewCount` onto the DTO's scalar fields (`:35-40`), and a `[UserMapping]` shallow-category helper (`:50-60`), all elided in the article and all three now named in its elision list; `ProductIdentifierType` is the Store Catalog alias for `int` (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/MMCA.Store.Catalog.GlobalUsings.IdentifierType.cs:4`).*

- Full series index: https://ivanball.github.io/writing.html
