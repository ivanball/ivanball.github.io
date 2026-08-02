# Getting Started: Build a New App on MMCA.Common

This is the step-by-step guide for standing up a **brand-new application** on the MMCA.Common
framework. MMCA.Common is a .NET 10 framework for DDD, Clean Architecture, and CQRS, shipped as a set
of lockstep-versioned NuGet packages (the authoritative list and count live in
[FACTS.md](https://github.com/ivanball/MMCA.Common/blob/main/FACTS.md)). Its core promise: **build a
modular monolith now, and extract a module into its own microservice later, without a rewrite.**

This guide builds **monolith-first** (the fastest path to a running app), then shows the **extraction**
of one module into its own service behind a gateway, so the "extract later" promise is concrete rather
than theoretical.

A runnable reference app lives at [MMCA.Helpdesk](https://github.com/ivanball/MMCA.Helpdesk) (a
support-ticket app). It is build- and test-verified through the monolith phases below: one **Tickets**
module exercised across all five layers, a REST API host, and a Blazor Server + MudBlazor UI host, all
orchestrated by Aspire, with three test projects (domain, application, architecture fitness) that run
with no database. To stay minimal it ships **without an Identity module** and runs **issuer-less** (see
Phase 2), and the **extraction** (Phase 8) is documented rather than pre-built (the plumbing is in
place). Wherever a step says "pattern source", that points at real, working code you can copy from
MMCA.Helpdesk, MMCA.ADC, or MMCA.Store.

> **Reading the framework itself:** for the *why* behind each pattern, read the relevant
> [ADR](../adr/README.md). For a type-by-type tour of the framework internals, see the
> [onboarding guide](../onboarding/00-index.md). This guide is the consumer-facing "how do I start" path.

---

## Scaffold it, then read the rest of this

Do not type phases 1 through 6 by hand. They add up to 12 projects and roughly 5,300 lines before a
line of your own business logic, and several of those lines are load-bearing in ways nothing tells
you about until much later. Scaffold the whole thing:

```bash
dotnet new install MMCA.Templates
dotnet new mmca-app -n Contoso.Support --module Orders --aggregate Order
cd Contoso.Support
dotnet build Contoso.Support.slnx      # warning-free under all five analyzers
dotnet test  --solution Contoso.Support.slnx   # passing, including the fitness rules, no database
```

Then read the phases below to understand **what you were handed and why**, which is what makes the
scaffold safe to change. Phase 7 (upgrading) and phase 8 (extracting a service) are not scaffolded:
those you do yourself.

The pack also has `mmca-module` for a new module across all five layers, and `mmca-command` /
`mmca-query` for a single vertical slice. Every parameter, plus the two one-time fixups a rename
makes unavoidable, is in the [templates guide](common-TEMPLATES.md); the reasoning is
[ADR-065](../adr/065-scaffolding-templates.md).

The template content **is** MMCA.Helpdesk, staged at pack time rather than copied, so what you
generate is the reference app whose CI keeps it green, under your own names.

Everything below still applies verbatim if you would rather build it up by hand, or are adding the
framework to a solution that already exists.

---

## What you will build

A modular monolith with one business module and two hosts:

- **Tickets** (your business module): a `Ticket` aggregate with `TicketComment` children, opened
  through a `Result`-returning factory, mutated through guarded methods that raise domain events, and
  exposed end-to-end through a REST controller. This is the module you later extract into its own
  service.
- A **Web API host** (the monolith) and a **Blazor Server + MudBlazor UI host** that calls the API
  server-side through Aspire service discovery.

The seed runs **issuer-less**: with no Identity module it registers a bare auth scheme and the
controller is `[AllowAnonymous]`, so you get a running app immediately. **Identity** is the standard
auth module you add when you want real RS256/JWKS authentication (and which becomes the **JWKS issuer**
when you extract Tickets): that path is shown in Phase 2 and Phase 8.

By the end you will have a green-building solution, applied EF migrations, a running Aspire stack
(`sql` + `web` + `ui`), and passing architecture-fitness tests, plus a documented path to add Identity
and pull Tickets out into a microservice.

---

## Phase 0: Prerequisites and decisions

**Install:**

- **.NET 10 SDK** (the framework targets `net10.0` with `LangVersion: preview` for C# extension types).
- **SQL Server** reachable locally (LocalDB, a container, or the one Aspire starts for you).
- **Docker Desktop** (Aspire provisions SQL Server as a container for the monolith; Redis and RabbitMQ
  join in the extraction phase).
- **EF Core tools:** `dotnet tool install --global dotnet-ef`.

**Decide how to consume MMCA.Common (two modes, switchable in one file):**

1. **NuGet (nuget.org)** is the production path for any standalone app. The `MMCA.Common.*` packages
   are published to nuget.org, so `dotnet add package MMCA.Common.API` (or any other package in the
   set) restores with no token, no credentials, and no extra feed. GitHub Packages is kept as a
   mirror of the same releases rather than the primary path: its NuGet registry requires a personal
   access token with `read:packages` even for public packages, so reach for it only if you already
   restore from it. See [ADR-053](../adr/053-dual-registry-package-publishing.md).
2. **Local source (`UseLocalMMCA`)** references `../MMCA.Common/Source/` directly via `local.props`.
   Use this when your app sits in the same workspace as MMCA.Common and you want to co-develop the
   framework and the app together. It needs no token (MMCA.Common itself restores only from nuget.org).

> When using local source mode, after editing MMCA.Common source you must **rebuild MMCA.Common in
> Debug** before your app, or the IDE binds the stale last-built Debug reference assembly and reports
> phantom `CS0103` errors against new members. Build MMCA.Common with `-c Debug`, then build your app.

**Pick the framework version.** Every package moves together. Use the latest released tag
(see [FACTS.md](https://github.com/ivanball/MMCA.Common/blob/main/FACTS.md) for the current version; the `1.135.0` in the samples below was
current when this guide was last refreshed). Choose one version and use it for every `MMCA.Common.*` entry (Phase 1). See
[ADR-016](../adr/016-lockstep-versioning-masstransit-pin.md): there is no phased rollout and no version
skew across the set. The rule is enforced, not just advisory: the shared
`FrameworkVersionConsistencyTestsBase` fitness rule (Phase 6) fails the build when the `MMCA.Common.*`
pins in `Directory.Packages.props` disagree, so a half-finished sweep cannot ship.

---

## Phase 1: Create the solution and the build plumbing

> **Scaffolded.** `dotnet new mmca-app` writes every file in this phase. Read it to know what each
> one does; you do not need to type any of it.

The plumbing files are the load-bearing, easy-to-get-wrong part: about 1,170 lines across eight
files, including an 823-line `.editorconfig` and 114 package pins. If you are doing it by hand, copy
them from `MMCA.Helpdesk` (already a trimmed single-module scaffold) or from `MMCA.ADC`. Lay out the
repo like this:

```
MMCA.Helpdesk/
  MMCA.Helpdesk.slnx
  Directory.Build.props
  Directory.Build.targets         (local-source swap: PackageReference -> ProjectReference when UseLocalMMCA)
  Directory.Packages.props
  global.json
  nuget.config
  local.props.template            (copy to local.props for local-source mode; gitignore it in a real app)
  .editorconfig                   (copy MMCA.ADC's verbatim; it drives the 5 analyzers)
  .gitignore
  Source/
    Modules/                      (one folder per business module: Tickets)
    Hosts/                        (runnable entry points)
      MMCA.Helpdesk.Web           (the monolith REST API host)
      UI/MMCA.Helpdesk.UI.Web     (the Blazor Server + MudBlazor front end)
    Hosting/                      (Aspire AppHost + per-DB migrations projects)
    Services/                     (added later, in the extraction phase)
  Tests/
    Modules/  Architecture/       (the reference app ships three projects here; Integration/E2E are optional adds)
```

### `Directory.Packages.props` (Central Package Management)

Versions live here, not in individual `.csproj` files. List **every** `MMCA.Common.*` package you
consume at one version (the count is owned by [FACTS.md](https://github.com/ivanball/MMCA.Common/blob/main/FACTS.md)), and keep **MassTransit pinned
to v8** (v9 needs a commercial license, enforced by a build gate in MMCA.Common, see
[ADR-016](../adr/016-lockstep-versioning-masstransit-pin.md)):

```xml
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <!-- MMCA Common packages: all at one version, bumped in lockstep -->
    <PackageVersion Include="MMCA.Common.Shared" Version="1.135.0" />
    <PackageVersion Include="MMCA.Common.Domain" Version="1.135.0" />
    <PackageVersion Include="MMCA.Common.Application" Version="1.135.0" />
    <PackageVersion Include="MMCA.Common.Infrastructure" Version="1.135.0" />
    <PackageVersion Include="MMCA.Common.API" Version="1.135.0" />
    <PackageVersion Include="MMCA.Common.Grpc" Version="1.135.0" />
    <PackageVersion Include="MMCA.Common.UI" Version="1.135.0" />
    <PackageVersion Include="MMCA.Common.UI.Web" Version="1.135.0" />
    <!-- MAUI heads only: the one MAUI-TFM package (ADR-042); web-only apps skip it -->
    <PackageVersion Include="MMCA.Common.UI.Maui" Version="1.135.0" />
    <PackageVersion Include="MMCA.Common.Aspire" Version="1.135.0" />
    <PackageVersion Include="MMCA.Common.Aspire.Hosting" Version="1.135.0" />
    <PackageVersion Include="MMCA.Common.Testing" Version="1.135.0" />
    <PackageVersion Include="MMCA.Common.Testing.E2E" Version="1.135.0" />
    <PackageVersion Include="MMCA.Common.Testing.UI" Version="1.135.0" />
    <PackageVersion Include="MMCA.Common.Testing.Architecture" Version="1.135.0" />
    <!-- Third-party versions: copy the relevant rows from MMCA.ADC/Directory.Packages.props -->
    <!-- (EF Core, FluentValidation, Riok.Mapperly, Scrutor, xunit.v3, Aspire.*, Yarp, the 5 analyzers, etc.) -->
  </ItemGroup>
</Project>
```

Then in each `.csproj` you reference a package with **no version**:
`<PackageReference Include="MMCA.Common.Domain" />`.

### `Directory.Build.props`

This sets the language/build mode, wires the five analyzers at error severity, links the per-module
identifier-alias files into every project, and declares the `.Contracts` gRPC convention. Copy
`MMCA.Helpdesk/Directory.Build.props` and adapt the module-alias `<Compile Include ... Link>` block to
your modules. The critical pieces:

```xml
<Project>
  <!-- Optional: local.props sets UseLocalMMCA; the actual PackageReference -> ProjectReference swap
       lives in a companion Directory.Build.targets (copy MMCA.Helpdesk's verbatim). -->
  <Import Project="local.props" Condition="Exists('local.props')" />

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <LangVersion>preview</LangVersion>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <AnalysisLevel>latest</AnalysisLevel>
    <AnalysisMode>All</AnalysisMode>
    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
    <GenerateDocumentationFile>true</GenerateDocumentationFile>
    <NoWarn>$(NoWarn);CS1591;RMG020;EXTEXP0001</NoWarn>
  </PropertyGroup>

  <!-- The five analyzers, all at error severity (Meziantou, VS.Threading, Roslynator, Sonar, StyleCop) -->
  <ItemGroup Condition="'$(MSBuildProjectExtension)' != '.dcproj'">
    <PackageReference Include="Meziantou.Analyzer"> ... </PackageReference>
    <PackageReference Include="Microsoft.VisualStudio.Threading.Analyzers"> ... </PackageReference>
    <PackageReference Include="Roslynator.Analyzers"> ... </PackageReference>
    <PackageReference Include="SonarAnalyzer.CSharp"> ... </PackageReference>
    <PackageReference Include="StyleCop.Analyzers"> ... </PackageReference>
  </ItemGroup>

  <!-- Identifier-type aliases linked into all projects (one block per module Shared project) -->
  <ItemGroup Condition="'$(MSBuildProjectExtension)' != '.dcproj'">
    <Compile Include="$(MSBuildThisFileDirectory)Source\Modules\Tickets\MMCA.Helpdesk.Tickets.Shared\MMCA.Helpdesk.Tickets.GlobalUsings.IdentifierType.cs"
             Link="GlobalUsings\MMCA.Helpdesk.Tickets.GlobalUsings.IdentifierType.cs"
             Condition="'$(MSBuildProjectName)' != 'MMCA.Helpdesk.Tickets.Shared'" />
    <!-- ...one more block per additional module's *.Shared alias file -->
  </ItemGroup>

  <!-- .Contracts convention: any *.Contracts project auto-compiles Protos/**/*.proto (server + client) -->
  <ItemGroup Condition="$(MSBuildProjectName.EndsWith('.Contracts'))">
    <PackageReference Include="Grpc.Tools"> ... </PackageReference>
    <PackageReference Include="Google.Protobuf" />
    <PackageReference Include="Grpc.Net.ClientFactory" />
    <Protobuf Include="Protos\**\*.proto" GrpcServices="Both" />
  </ItemGroup>
</Project>
```

> **Why the identifier-alias linking matters.** Each module declares `global using
> {Entity}IdentifierType = int;` (or `Guid`) in one file in its `*.Shared` project. The
> `<Compile Include ... Link>` block makes that alias visible in **every** project solution-wide.
> Always use the alias (`TicketIdentifierType`), never the raw `int`. See the Entity Identifier
> Convention in `MMCA.Common/CLAUDE.md`.

### `global.json`, `nuget.config`, `local.props.template`

```jsonc
// global.json: all three apps run on Microsoft Testing Platform (xUnit v3), not VSTest
{ "test": { "runner": "Microsoft.Testing.Platform" } }
```

```xml
<!-- nuget.config (NuGet mode): everything, MMCA.* included, comes from nuget.org. No credentials.
     The single `*` mapping is also supply-chain hygiene: it stops a package from another feed being
     substituted for one you expect. This is MMCA.Common's own nuget.config shape. -->
<configuration>
  <packageSources>
    <clear />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
  </packageSources>
  <packageSourceMapping>
    <packageSource key="nuget.org"><package pattern="*" /></packageSource>
  </packageSourceMapping>
</configuration>
```

You only need the GitHub Packages mirror in two cases: you are pinning a version released before
nuget.org publishing began (there was no backfill, so those versions exist on GitHub Packages only),
or your organization already restores `MMCA.*` from that feed. In that case add the feed *beside*
nuget.org, source-map `MMCA.*` to it, and supply a token. Note the `auditSources` block: GitHub
Packages serves no NuGet vulnerability data, so an unrestricted audit reports NU1900 against it.

```xml
<!-- Optional: MMCA.* from the GitHub Packages mirror. Needs a token with read:packages. -->
<configuration>
  <packageSources>
    <add key="github-mmca" value="https://nuget.pkg.github.com/ivanball/index.json" />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
  </packageSources>
  <auditSources>            <!-- GitHub Packages serves no vuln data; restrict audit to nuget.org -->
    <clear />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
  </auditSources>
  <packageSourceMapping>
    <packageSource key="github-mmca"><package pattern="MMCA.*" /></packageSource>
    <packageSource key="nuget.org"><package pattern="*" /></packageSource>
  </packageSourceMapping>
  <packageSourceCredentials>
    <github-mmca>
      <add key="Username" value="<your-user>" />
      <add key="ClearTextPassword" value="%GITHUB_TOKEN%" />
    </github-mmca>
  </packageSourceCredentials>
</configuration>
```

```xml
<!-- local.props.template: copy to local.props (gitignored) to build against MMCA.Common source.
     Directory.Build.targets reads UseLocalMMCA and swaps each MMCA.Common.* PackageReference for a
     ProjectReference under LocalMMCAPath. The MMCA.Helpdesk scaffold ships local.props ACTIVE (so it
     builds straight against framework source); delete it to consume the published packages from
     nuget.org instead. -->
<Project>
  <PropertyGroup>
    <UseLocalMMCA>true</UseLocalMMCA>
    <LocalMMCAPath>$(MSBuildThisFileDirectory)..\MMCA.Common\Source\</LocalMMCAPath>
  </PropertyGroup>
</Project>
```

**Checkpoint:** `dotnet build MMCA.Helpdesk.slnx` succeeds on an empty solution (no projects yet, but
the plumbing parses).

---

## Phase 2: Scaffold the module project set

> **Scaffolded.** `dotnet new mmca-app` creates this project set for your first module, and
> `dotnet new mmca-module` adds another one later (it prints the five wire-ups it cannot perform:
> the solution entries, the host and architecture-test project references, the identifier-alias
> link, the map lines, and `AddErrorResources`). See the [templates guide](common-TEMPLATES.md).

Each business module is a set of layered projects under `Source/Modules/<Module>/`. Pattern source:
`MMCA.Helpdesk/Source/Modules/Tickets/` (or the richer `MMCA.ADC/Source/Modules/Conference/`). For
**Tickets**:

| Project | References | Holds |
|---|---|---|
| `MMCA.Helpdesk.Tickets.Shared` | `MMCA.Common.Shared`, `MMCA.Common.Domain` | DTOs, request records, **identifier aliases**, the status enum, integration events |
| `MMCA.Helpdesk.Tickets.Domain` | `MMCA.Common.Domain` | aggregate, child entities, invariants, domain events |
| `MMCA.Helpdesk.Tickets.Application` | `MMCA.Common.Application`, Riok.Mapperly, the Shared + Domain projects | use cases (command/query + handler), validators, mappers, event handlers, module DI |
| `MMCA.Helpdesk.Tickets.Infrastructure` | `MMCA.Common.Infrastructure`, the Application project | EF entity configurations, the abstract module DbContext, infra DI |
| `MMCA.Helpdesk.Tickets.API` | `MMCA.Common.API`, the Application + Infrastructure projects | REST controller, the `IModule`, the module-composition DI |

The layering is enforced twice by the framework (compile-time MSBuild guard + the NetArchTest rules in
Phase 6), so a forbidden reference fails the build. See
[ADR-015](../adr/015-architecture-fitness-functions.md).

**Identity is optional and omitted from the reference app.** The Helpdesk seed runs issuer-less (a bare
auth scheme + an `[AllowAnonymous]` controller), which is the fastest path to a running app. Add an
Identity module when you want real RS256/JWKS authentication or are about to extract a service (Phase
8): the fastest start is to copy MMCA.Store's or MMCA.ADC's Identity module and rename the namespaces
(Store's Identity is local-credential + RS256 only, the simpler base), then set
`Authentication:JwtBearer:Authority` and flip the controller back to `[Authorize]`. Identity is
intentionally generic across apps.

---

## Phase 3: The vertical slice end-to-end (the heart of it)

> **Scaffolded.** The generated module already contains this slice and six more, worked end to end.
> `dotnet new mmca-command` and `dotnet new mmca-query` add another one. This phase is the one to
> actually read: it is the path every feature you add will follow.

Implement Tickets create and read. This traces the same path for every feature you will ever add (the
reference app then repeats it for update, delete, status change, and comment add/edit/remove). Pattern
source for each step is the Helpdesk `Ticket` aggregate.

### 3a. Domain: aggregate, invariants, events

Entities inherit the framework hierarchy: `BaseEntity<TId>` to `AuditableBaseEntity<TId>` (adds
soft-delete `IsDeleted` + audit fields) to `AuditableAggregateRootEntity<TId>` (adds the domain-events
collection and child-collection helpers). **Aggregates use factory methods that return `Result<T>`,
never public constructors.** See [ADR-013](../adr/013-result-pattern.md).

The reference app uses **database-generated** integer ids (the `[IdValueGenerated]` attribute + the
`TicketIdentifierType = int` alias). That has one important consequence: the factory does **not** raise
an "Added" domain event, because the id is still `0` at that point: creation is signalled *after the
commit* by an integration event (see 3c). Mutations raise a single `TicketChanged` domain event
(`EntityChangedEvent`-derived) carrying the lifecycle state.

```csharp
// Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Domain/Tickets/Ticket.cs
[IdValueGenerated]
public sealed class Ticket : AuditableAggregateRootEntity<TicketIdentifierType>
{
    public string Title { get; private set; }
    public string Description { get; private set; }
    public TicketStatus Status { get; private set; }
    public int RequesterUserId { get; private set; }   // resolved from Identity once you add it

    private readonly List<TicketComment> _comments = [];

    [Navigation(IsCollection = true)]
    public IReadOnlyCollection<TicketComment> Comments => _comments.AsReadOnly();

    private Ticket(string title, string description, int requesterUserId)   // EF + factory materializer
    {
        Title = title;
        Description = description;
        RequesterUserId = requesterUserId;
        Status = TicketStatus.Open;
    }

    public static Result<Ticket> Create(TicketIdentifierType? id, string title, string description, int requesterUserId)
    {
        var validation = Result.Combine(
            TicketInvariants.EnsureTitleIsValid(title, nameof(Create)),
            TicketInvariants.EnsureDescriptionIsValid(description, nameof(Create)));
        if (validation.IsFailure) { return Result.Failure<Ticket>(validation.Errors); }

        // When the id is DB-generated, leave it default; the supplied id is only used for engines that
        // do not generate keys. No "Added" domain event here (the id is still 0).
        var ticket = new Ticket(title, description, requesterUserId)
        {
            Id = typeof(Ticket).IsIdValueGenerated ? default : id!.Value,
        };
        return Result.Success(ticket);
    }

    public Result ChangeStatus(TicketStatus newStatus)
    {
        if (Status == newStatus) { return Result.Success(); }
        Status = newStatus;
        AddDomainEvent(new TicketChanged(DomainEntityState.Updated, Id));   // dispatched after SaveChanges
        return Result.Success();
    }

    public override Result Delete()                       // soft-delete + cascade to comments
    {
        var result = base.Delete();
        if (result.IsFailure) { return result; }
        foreach (var comment in _comments.Where(c => !c.IsDeleted)) { comment.Delete(); }
        AddDomainEvent(new TicketChanged(DomainEntityState.Deleted, Id));
        return result;
    }

    // AddComment / EditComment / RemoveComment / UpdateDetails follow the same shape: guard with an
    // invariant, mutate, AddDomainEvent(new TicketChanged(DomainEntityState.Updated, Id)).
}
```

Invariants are static methods returning `Result` (each takes a `source` for error provenance),
combined with `Result.Combine(...)`. Use `Error.Invariant(...)` for broken business rules:

```csharp
public static class TicketInvariants
{
    public const int TitleMaxLength = 200;

    public static Result EnsureTitleIsValid(string title, string source) =>
        string.IsNullOrWhiteSpace(title) || title.Length > TitleMaxLength
            ? Result.Failure(Error.Invariant(
                code: "Ticket.Title.Invalid",
                message: $"Title is required and must be at most {TitleMaxLength} characters.",
                source: source,
                target: nameof(title)))
            : Result.Success();
}
```

`TicketComment` inherits `AuditableBaseEntity<TicketCommentIdentifierType>` and is `[IdValueGenerated]`
too, with its own `Create(...)` factory. Manage children **through the aggregate root**: `Ticket`
exposes `AddComment` / `EditComment` / `RemoveComment` that validate, mutate `_comments`, and raise
`TicketChanged`: never mutate the collection or a comment from outside the aggregate.

### 3b. Shared: DTO, request, integration event, aliases

```csharp
// MMCA.Helpdesk.Tickets.GlobalUsings.IdentifierType.cs  (linked solution-wide via Directory.Build.props)
global using TicketIdentifierType = int;
global using TicketCommentIdentifierType = int;
```

The read model implements `IBaseDTO<TId>` (the framework read-side contract) and carries its children.
It also implements **`IConcurrencyAware`**, exposing the `RowVersion` the client echoes back on an
update so a conflicting concurrent edit surfaces as 409 instead of silently last-write-winning (see
[ADR-035](../adr/035-optimistic-concurrency.md)):

```csharp
public record class TicketDTO : IBaseDTO<TicketIdentifierType>, IConcurrencyAware
{
    public required TicketIdentifierType Id { get; init; }
    public byte[]? RowVersion { get; init; }               // ADR-035: echoed back on update
    public required string Title { get; init; }
    public required string Description { get; init; }
    public required TicketStatus Status { get; init; }     // the enum itself; serialized by name
    public required int RequesterUserId { get; init; }
    public IReadOnlyCollection<TicketCommentDTO> Comments { get; init; } = [];
}

// Integration events derive BaseIntegrationEvent, which supplies SchemaVersion (default 1,
// fitness-enforced): a breaking change uses a NEW event type + upcaster, never a reshape. See ADR-010.
public sealed record class TicketOpenedIntegrationEvent(TicketIdentifierType TicketId, int RequesterUserId)
    : BaseIntegrationEvent;
```

Plain request bodies (e.g. `TicketUpdateRequest`, `AddCommentRequest`) live in Shared too. Name the
update body with the **`*UpdateRequest`** suffix and have it implement `IConcurrencyAware`: that exact
pairing is what the `ConcurrencyConventionTestsBase` fitness rule looks for (Phase 6), so an update
request that skips the token fails the build rather than quietly losing a concurrent edit.

```csharp
public sealed record class TicketUpdateRequest : IConcurrencyAware
{
    public byte[]? RowVersion { get; init; }               // the token the client last read
    public required string Title { get; init; }
    public required string Description { get; init; }
}
```

The **create request doubles as the command** and is co-located with its use case in Application (next
section); it implements `ICacheInvalidating` so a successful create evicts cached ticket reads:

```csharp
// Source/Modules/Tickets/.../Application/Tickets/UseCases/Create/TicketCreateRequest.cs
public record class TicketCreateRequest : ICreateRequest, ICacheInvalidating
{
    public string CachePrefix => TicketCacheKeys.Prefix;
    public required string Title { get; init; }
    public required string Description { get; init; }
    public required int RequesterUserId { get; init; }
}
```

`TicketCacheKeys` is the one place the module names cache entries, and the reason it exists is worth
reading in ["Caching is a pair"](#caching-is-a-pair-and-you-wire-both-halves) below.

### 3c. Application: use case, validator, mapper, DI

A command handler implements `ICommandHandler<TCommand, TResult>` and stays thin: the decorator
pipeline supplies logging, caching, validation, and the transaction around it. The request is turned
into the aggregate by an `IEntityRequestMapper` (which calls the domain factory), and a FluentValidation
validator + the Mapperly `*RequestMapper`/`*DTOMapper` are all auto-discovered by convention scanning.
Because the id is DB-generated, the handler publishes the **integration event after the commit**, when
the real id exists:

```csharp
public sealed class CreateTicketHandler(
    IUnitOfWork unitOfWork,
    IEntityRequestMapper<Ticket, TicketCreateRequest, TicketIdentifierType> requestMapper,
    IEventBus eventBus,
    TicketDTOMapper dtoMapper) : ICommandHandler<TicketCreateRequest, Result<TicketDTO>>
{
    public async Task<Result<TicketDTO>> HandleAsync(TicketCreateRequest command, CancellationToken cancellationToken = default)
    {
        var result = await requestMapper.CreateEntityAsync(command, cancellationToken);   // runs Ticket.Create
        if (result.IsFailure) { return Result.Failure<TicketDTO>(result.Errors); }

        var entity = result.Value!;
        var repository = unitOfWork.GetRepository<Ticket, TicketIdentifierType>();
        await repository.AddAsync(entity, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);   // stamps audit, captures domain events to outbox, dispatches

        // After commit: the DB-generated entity.Id is now populated. PublishAsync writes to the outbox
        // and dispatches in-process now, over the broker once Tickets is extracted (no handler change).
        await eventBus.PublishAsync(
            new TicketOpenedIntegrationEvent(entity.Id, entity.RequesterUserId), cancellationToken);

        return Result.Success(dtoMapper.MapToDTO(entity));
    }
}
```

Module DI uses C# extension types (the framework's registration idiom). You make a few explicit
registrations (the entity query service that powers read endpoints, and a navigation populator), then
let `ScanModuleApplicationServices` find your handlers, validators, mappers, and event handlers by
convention:

```csharp
public static class DependencyInjection
{
    extension(IServiceCollection services)
    {
        public IServiceCollection AddModuleTicketsApplication(ApplicationSettings applicationSettings)
        {
            // A Null populator suffices when eager loading goes through repository includes; swap for a
            // custom INavigationPopulator<Ticket> to batch-load comments instead.
            services.TryAddScoped<INavigationPopulator<Ticket>, NullNavigationPopulator<Ticket>>();
            services.TryAddScoped<IEntityQueryService<Ticket, TicketDTO, TicketIdentifierType>,
                EntityQueryService<Ticket, TicketDTO, TicketIdentifierType>>();

            services.ScanModuleApplicationServices<ClassReference>();   // ClassReference = an anchor type in this assembly
            return services;
        }
    }
}
```

That scan is also what picks up the **consuming** side of both event paths, and the reference app ships
one of each so the distinction is visible in running code rather than only in prose:

- `Tickets/DomainEventHandlers/TicketChangedAuditHandler` implements `IDomainEventHandler<TicketChanged>`.
  Intra-module, dispatched in-process by `DomainEventDispatcher` after `SaveChangesAsync` (deferred
  until after the commit when a transaction is open, so a handler never acts on state that rolls back).
- `Tickets/IntegrationEventHandlers/TicketOpenedHandler` implements
  `IIntegrationEventHandler<TicketOpenedIntegrationEvent>`. Cross-module, delivered through the outbox:
  in-process today, over the broker once Tickets is extracted, with no change to this handler.

Neither is registered by hand. Put a handler in the module's Application assembly and the convention
scan finds it.

### 3d. Infrastructure: EF configuration, the abstract module context, no concrete per-module context

There is exactly **one concrete** context at runtime, the framework's sealed `SQLServerDbContext` (one
instance per database). Each module declares an **abstract** `ModuleApplicationDbContext :
ApplicationDbContext` that *only* lists the module's `DbSet`s: it documents the module's entity set
and never gets instantiated. **Never write a concrete per-module or per-app DbContext class** (see
[ADR-006](../adr/006-database-per-service.md) and the "Don't split SQLServerDbContext" rule):

```csharp
public abstract class ModuleApplicationDbContext(
    DbContextOptions options, IServiceProvider serviceProvider,
    IEntityConfigurationAssemblyProvider assemblyProvider, PhysicalDataSource physicalDataSource)
    : ApplicationDbContext(options, serviceProvider, assemblyProvider, physicalDataSource)
{
    internal DbSet<Ticket> Tickets { get; set; }
    internal DbSet<TicketComment> TicketComments { get; set; }
}
```

You supply EF configurations that inherit `EntityTypeConfigurationSQLServer<TEntity, TId>` (the base
wires `Id`, `IsDeleted` + soft-delete query filter, audit fields, and the concurrency token):

```csharp
internal sealed class TicketConfiguration : EntityTypeConfigurationSQLServer<Ticket, TicketIdentifierType>
{
    public override void Configure(EntityTypeBuilder<Ticket> builder)
    {
        base.Configure(builder);   // Id, IsDeleted + filter, audit fields, concurrency token
        builder.Property(t => t.Title).HasMaxLength(TicketInvariants.TitleMaxLength).IsRequired();
        builder.Property(t => t.Status).HasConversion<string>().HasMaxLength(32).IsRequired();
        builder.HasMany(t => t.Comments).WithOne(c => c.Ticket).HasForeignKey(c => c.TicketId).IsRequired();
    }
}
```

Configurations are **auto-discovered by assembly-name convention** (the module's Infrastructure
assembly is registered for the design-time factory and the host), so the module's
`Infrastructure/DependencyInjection.cs` is a near no-op: `AddModuleTicketsInfrastructure()` just
returns `services`. You obtain a repository through
`IUnitOfWork.GetRepository<Ticket, TicketIdentifierType>()`; you never hand-write a context or a
repository class. The three module layers are composed in the **API layer's** DI
(`AddTicketsModule` calls Application + Infrastructure + API), which the module's `IModule.Register`
invokes (see Phase 5).

### 3e. API: controller and error mapping

Read endpoints (get-all / paged) come for free from `EntityControllerBase<TEntity, TDTO, TId>`, which
you parameterize with the entity query service; write endpoints inject handlers directly. On failure,
`HandleFailure(result.Errors)` maps the transport-agnostic `ErrorType` to the right HTTP status as RFC
9457 ProblemDetails (Validation/Invariant to 400, NotFound to 404, Conflict to 409, Unauthorized to
401, Forbidden to 403). See [ADR-013](../adr/013-result-pattern.md). The controller is
**`[AllowAnonymous]`** because the seed ships issuer-less; flip it to `[Authorize]` once you add Identity.

```csharp
[ApiController]
[Route("[controller]")]
[ApiVersion("1.0")]
[AllowAnonymous]   // issuer-less seed; switch to [Authorize] after adding Identity (Phase 8)
public sealed class TicketsController(
    IEntityQueryService<Ticket, TicketDTO, TicketIdentifierType> queryService,
    ICommandHandler<TicketCreateRequest, Result<TicketDTO>> createHandler,
    ILogger<TicketsController> logger)
    : EntityControllerBase<Ticket, TicketDTO, TicketIdentifierType>(queryService, logger)
{
    [HttpPost]
    public async Task<ActionResult<TicketDTO>> CreateAsync(TicketCreateRequest request, CancellationToken cancellationToken)
    {
        var result = await createHandler.HandleAsync(request, cancellationToken);
        if (result.IsFailure) { return HandleFailure(result.Errors); }

        // Build the Location URI directly: CreatedAtAction against the versioned base GetById route
        // throws "No route matches the supplied values".
        var dto = result.Value!;
        return Created(new Uri($"Tickets/{dto.Id}", UriKind.Relative), dto);
    }
}
```

The reference app's controller goes further: `GET {id}/details`, `PUT {id}`, `PUT {id}/status`,
`DELETE {id}`, and `POST|PUT|DELETE {id}/comments[/{commentId}]`, each one the same three lines: call
the handler, `HandleFailure` on failure, else return the success shape. `PUT {id}` also closes the
ADR-035 loop by forwarding the request's `RowVersion` onto the command
(`new UpdateTicketCommand(id, request.Title, request.Description) { RowVersion = request.RowVersion }`),
which is what turns a stale write into a 409 instead of an overwrite.

### What the pipeline does for you

Once `AddApplicationDecorators()` runs (Phase 5), every handler is wrapped by the Scrutor decorator
chain (outermost first). See [ADR-014](../adr/014-cqrs-decorator-pipeline.md):

```
Commands: FeatureGate -> Logging -> Caching -> Validating -> Transactional -> your handler
Queries:  FeatureGate -> Logging -> Caching -> your handler
```

The order is load-bearing: validation runs before the transaction opens; cache invalidation happens
after a successful commit (outside the transaction); a business `Result.Failure` commits the
transaction but skips cache invalidation; an exception rolls the transaction back.

#### Caching is a pair, and you wire both halves

The Caching decorator is two extension points that only do something **together**, and the framework
cannot check that you wired both:

- a query implements **`IQueryCacheable`** (`CacheKey` + `CacheDuration`) and is served from cache,
- a command implements **`ICacheInvalidating`** (`CachePrefix`) and, on success, evicts every entry
  whose key starts with that prefix.

Implement only the command half and you get a write path that faithfully invalidates an empty cache:
no error, no warning, no benefit. That is the easiest thing in the whole pipeline to get half-done,
so the reference app wires both. Start from the key, because the decorator matches the two sides by
**string prefix** and nothing at compile time is watching:

```csharp
// Source/Modules/Tickets/.../Application/Tickets/TicketCacheKeys.cs
public static class TicketCacheKeys
{
    // Derived from the aggregate type name so two modules cannot collide on a shared cache.
    public static string Prefix { get; } = $"{typeof(Ticket).FullName}:";

    // Every input that changes the result belongs in the key. This read has only an id.
    public static string ById(TicketIdentifierType id) =>
        string.Create(CultureInfo.InvariantCulture, $"{Prefix}ById:{id}");
}
```

The read side opts in by implementing `IQueryCacheable`. The duration is a **staleness budget**, not
a performance knob: a write through the pipeline evicts the entry immediately, so it only bounds the
window for changes that bypass the pipeline (a migration, a manual edit, another writer on the same
database):

```csharp
// Source/Modules/Tickets/.../Application/Tickets/UseCases/GetById/GetTicketByIdQuery.cs
public sealed record GetTicketByIdQuery(TicketIdentifierType Id) : IQueryCacheable
{
    public string CacheKey => TicketCacheKeys.ById(Id);
    public TimeSpan CacheDuration => TimeSpan.FromMinutes(5);
}
```

The write side returns the prefix its write dirties. Every ticket command does, from the same
constant, which is the point: a hand-typed literal in one of seven commands is one rename away from
a read that is never evicted, and the symptom appears later as a stale ticket rather than as a
failure at the write.

```csharp
// Source/Modules/Tickets/.../Application/Tickets/UseCases/AddComment/AddCommentCommand.cs
public sealed record AddCommentCommand(TicketIdentifierType TicketId, string Body, int AuthorUserId)
    : ICacheInvalidating
{
    public string CachePrefix => TicketCacheKeys.Prefix;
}
```

Two properties of the decorator are worth knowing before you rely on it:

- **Invalidation runs only on success.** A `Result.Failure` persisted nothing, so evicting valid
  entries would be pure loss. Assert this, because it is invisible in normal use.
- **Invalidation runs outside the transaction**, after the commit. It cannot roll back with the
  write, which is the correct trade: a spurious eviction costs one cache miss, whereas invalidating
  inside the transaction would leave the cache holding pre-write state if the commit then failed.

Both halves are testable without a database. Wire the two real decorators around stub handlers and a
dictionary-backed `ICacheService`, and the assertions say nothing about whether the substrate is
in-memory or Redis (source:
`Tests/Modules/Tickets/MMCA.Helpdesk.Tickets.Application.Tests/Caching/TicketCacheInvalidationTests.cs`):

```csharp
var cache = new DictionaryCache();                       // a plain Dictionary behind ICacheService
var handler = new CountingQueryHandler(TicketResult());  // counts how often the real read is reached
var read = new CachingQueryDecorator<GetTicketByIdQuery, Result<TicketDTO>>(handler, cache);
var write = new CachingCommandDecorator<ChangeTicketStatusCommand, Result<TicketDTO>>(
    new StubCommandHandler(TicketResult(TicketStatus.Closed)), cache);

await read.HandleAsync(new GetTicketByIdQuery(TicketId));     // miss: runs the handler, caches
await read.HandleAsync(new GetTicketByIdQuery(TicketId));     // hit: handler not reached
handler.Invocations.Should().Be(1);

await write.HandleAsync(new ChangeTicketStatusCommand(TicketId, TicketStatus.Closed));

await read.HandleAsync(new GetTicketByIdQuery(TicketId));     // miss again: the write evicted it
handler.Invocations.Should().Be(2);
```

Add the negative case (a command returning `Result.Failure` must leave the entry in place) and one
guard that the read key still starts with the prefix every command returns. That last test is the
one that survives a rename.

---

## Phase 4: DbContext model and migrations

> **Partly scaffolded.** The migrations project and its design-time factory are generated. Running
> `dotnet ef migrations add InitialCreate` is still yours, and for a module added later the
> generated migrations project ships deliberately empty so the first migration describes YOUR
> entities.

Create **one migrations project per (future) service database**, even while you are a monolith. This
costs nothing now and means extraction (Phase 8) needs zero migration rework. Pattern source:
`MMCA.Helpdesk/Source/Hosting/MMCA.Helpdesk.Migrations.SqlServer.Tickets/`.

```
Source/Hosting/MMCA.Helpdesk.Migrations.SqlServer.Tickets/
  MMCA.Helpdesk.Migrations.SqlServer.Tickets.csproj   (refs EF Design + SqlServer + the Tickets.Infrastructure project)
  DesignTimeSQLServerDbContextFactory.cs
  Migrations/   (generated)
```

The design-time factory uses the framework helper so `dotnet ef` can build a per-source context:

```csharp
public sealed class DesignTimeSQLServerDbContextFactory : IDesignTimeDbContextFactory<SQLServerDbContext>
{
    public SQLServerDbContext CreateDbContext(string[] args) =>
        DesignTimeDbContextHelper.CreateSqlServer(args, options =>
        {
            options.DataSourceName = "Tickets";
            // A placeholder top-level string keeps the helper happy; migrations add/script never connect.
            options.ConnectionStrings = new ConnectionStringSettings { SQLServerConnectionString = "Server=design-time-unused;" };
            options.DataSources["Tickets"] = new DataSourceEntrySettings
            {
                SQLServerConnectionString = Environment.GetEnvironmentVariable("HELPDESK_TICKETS_SQL")
                    ?? "Server=localhost;Database=Helpdesk_Tickets;Trusted_Connection=True;TrustServerCertificate=True;MultipleActiveResultSets=True",
                SQLServerMigrationsAssembly = typeof(DesignTimeSQLServerDbContextFactory).Assembly.GetName().Name!,
            };
            options.AddConfigurationAssembly(typeof(MMCA.Helpdesk.Tickets.Infrastructure.AssemblyReference).Assembly);
        });
}
```

Add the first migration (run per migrations project, always `--context SQLServerDbContext`):

```bash
dotnet ef migrations add InitialCreate \
  --project Source/Hosting/MMCA.Helpdesk.Migrations.SqlServer.Tickets \
  --startup-project Source/Hosting/MMCA.Helpdesk.Migrations.SqlServer.Tickets \
  --context SQLServerDbContext
```

At runtime the host applies migrations via the framework's `InitializeDatabaseAsync(...)` driven by
`ApplicationSettings.DatabaseInitStrategy`: `Migrate` (production, the host is the sole migrator),
`EnsureCreated` (quick local), or `None` (throws if migrations are pending, a safety check).

> **Monolith collapse:** with no `DataSources` section in config, every entity collapses onto one
> physical database (one context, FK constraints intact) and behaves exactly like a classic
> single-DB monolith. The same configurations and migrations later route to separate databases when
> you add `DataSources` entries in the extraction phase. This collapse is what makes "monolith now,
> services later" free. See [ADR-006](../adr/006-database-per-service.md).

---

## Phase 5: Compose the monolith host and run it

> **Scaffolded.** Both hosts, the AppHost, and the `.resx` pairs are generated. Read this phase
> before you touch any of them: the DI sequence, `WaitFor(sql)` rather than the database resource,
> and the AppHost `launchSettings.json` all fail quietly rather than loudly.

### The Web host

Create `Source/Hosts/MMCA.Helpdesk.Web` (the REST API host). Its `Program.cs` follows the **fixed DI
sequence**, and the load-bearing rule is that `AddApplicationDecorators()` comes **last**: decorators
wrap handlers that already exist, and the module handlers are registered by `ModuleLoader` (each
`IModule.Register` composes its Application+Infrastructure+API layers):

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults();        // from MMCA.Common.Aspire: OpenTelemetry, health checks, resilience

var services = builder.Services;
services.AddOptions<ApplicationSettings>().Bind(builder.Configuration.GetSection(ApplicationSettings.SectionName))
    .ValidateDataAnnotations().ValidateOnStart();
var applicationSettings = builder.Configuration.GetSection(ApplicationSettings.SectionName).Get<ApplicationSettings>()!;

// Health checks. SQL is REQUIRED: a host that cannot resolve its own connection string should fail
// fast rather than report healthy and take traffic it cannot serve. Redis/RabbitMQ checks are tagged
// optional upstream, so they report on /health without gating readiness.
builder.AddInfrastructureHealthChecks(requireSqlServer: true);

// Cross-cutting edge.
services.AddCommonCors(builder.Configuration);
services.AddCommonApiVersioning();
services.AddCommonRateLimiting();
services.AddOutputCache(options => options.AddBasePolicy(policy => policy.NoCache()));
services.AddCommonResponseCompression();

// Auth. Issuer-less by default: with no Authentication:JwtBearer:Authority configured, register a bare
// scheme so the pipeline is satisfied and [AllowAnonymous] endpoints work. Set the authority (after you
// add Identity) to validate RS256 tokens against its JWKS instead.
var jwtAuthority = builder.Configuration["Authentication:JwtBearer:Authority"];
if (!string.IsNullOrWhiteSpace(jwtAuthority))
{
    services.AddForwardedJwtBearer(authority: jwtAuthority, audience: builder.Configuration["Jwt:Audience"] ?? "helpdesk");
}
else
{
    services.AddAuthentication();
    services.AddAuthorization();
}

services.AddCommonExceptionHandlers();

services.AddApplication();                       // core services, event dispatcher
services.AddInfrastructure(builder.Configuration); // repos, UoW, context, caching, outbox
var modulesSettings = builder.Configuration.GetSection(ModulesSettings.SectionName).Get<ModulesSettings>() ?? [];
services.AddAPI(modulesSettings);                // controllers, idempotency, exception handlers

// Contribute the module's error-code translations to the edge localizer (ADR-027), so domain
// Error.Code values come back as localized ProblemDetails messages. One call per module.
services.AddErrorResources<TicketsErrorResources>();

using var loggerFactory = LoggerFactory.Create(logging => logging.AddConsole());
var moduleLoader = new ModuleLoader { Logger = loggerFactory.CreateLogger<ModuleLoader>() };
moduleLoader.DiscoverAndRegister(services, builder.Configuration, applicationSettings, modulesSettings, builder.Environment.EnvironmentName);
services.AddSingleton(moduleLoader);

services.AddBrokerMessaging(builder.Configuration);  // InProcessMessageBus until a broker is configured
services.AddApplicationDecorators();             // MUST be last

services.AddModuleHealthChecks(moduleLoader);    // per-module readiness, after the modules are known

var app = builder.Build();
await app.Services.InitializeDatabaseAsync(applicationSettings, moduleLoader);   // applies migrations / seeds
app.MapDefaultEndpoints();             // /health, /alive
// exception -> correlation -> request localization -> forwarded headers -> HTTPS -> compression ->
// routing -> CORS -> authentication -> rate limiting -> soft-deleted-user filter -> authorization ->
// output cache -> JWKS/OIDC endpoints -> controllers. Rate limiting sits AFTER authentication on
// purpose (ADR-019): the partition keys off the authenticated principal.
app.UseCommonMiddlewarePipeline();
await app.RunAsync();
```

Modules are discovered by `ModuleLoader` and registered in topological dependency order (Kahn's
algorithm) from their `IModule` implementations. `TicketsModule` is a leaf (no dependencies); its
`Register(...)` calls `AddTicketsModule`, which wires the Application (handler/validator/mapper scan),
Infrastructure, and API layers. Disabled peers get stub registrations so cross-module interfaces still
resolve. See [ADR-008](../adr/008-service-extraction-topology.md). Monolith config: no `DataSources`
section (one DB) and no `MessageBus:Provider`, so the framework selects the `InProcessMessageBus`.

### The Blazor UI host

`Source/Hosts/UI/MMCA.Helpdesk.UI.Web` is a **Blazor Server + MudBlazor** front end. It holds no domain
logic and no DbContext: it calls the API through a typed `HelpdeskApiClient` registered with
`AddHttpClient<HelpdeskApiClient>(...)`, whose base address (`https+http://web`, from config) is
resolved by the service-discovery handler that `AddServiceDefaults()` installs. Because Blazor Server
runs the calls **server-side**, there is no browser CORS and no token to forward. On a failed response
the client calls `ServiceExceptionHelper.ThrowIfDomainExceptionAsync` to surface the RFC 9457
ProblemDetails message (e.g. "Comments cannot be added to a closed ticket.") before the generic
`EnsureSuccessStatusCode` fallback: the same pattern `MMCA.Common.UI`'s `EntityServiceBase` uses, so
pages show a meaningful error. `Program.cs` is the standard Razor-components host plus
`AddServiceDefaults()` / `MapDefaultEndpoints()`.

Two wiring details in the layout are easy to miss because nothing fails loudly without them:

- **`<MmcaThemeProviders />` owns the Mud providers.** Drop that one framework component at the top of
  `MainLayout.razor` instead of hand-placing `MudThemeProvider`/`MudPopoverProvider`/`MudDialogProvider`/
  `MudSnackbarProvider`: it also carries the dark/light lifecycle from
  [ADR-028](../adr/028-dark-theme-mode.md), so `<ThemeToggle />` has something to toggle.
- **`<CultureSwitcher />` needs an `ICultureApplier`.** The switcher delegates the actual switch to that
  service, which `AddUIShared()` normally registers. A UI host that does not call `AddUIShared` (this
  seed does not: it has no `ApiSettings`-backed client pipeline) must register the Blazor Web default
  itself, `services.AddScoped<ICultureApplier, EndpointCultureApplier>()`, or the menu silently no-ops.

### Internationalization (ADR-027): every visible string follows the selected language

The framework ships multi-locale i18n (`en-US` + `es`) end to end; adopting it in a new app is five
mechanical steps, and MMCA.Helpdesk is the worked example for each:

1. **Externalize page strings to co-located `.resx` pairs.** Inject
   `IStringLocalizer<YourPage> L` and render `@L["Key"]`; put `YourPage.resx` + `YourPage.es.resx`
   next to the page (see `MMCA.Helpdesk.UI.Web/Components/Pages/Tickets.resx` and its `es` sibling).
   Snackbar/confirmation text uses whole-sentence keys (`Snackbar.Created` = "Ticket created
   successfully."); never compose sentences from fragments (the obsoleted
   `ErrorMessages.Success(entity, action)` shows why: Spanish gender agreement breaks). Always add
   the `en` and `es` values in the same commit, or the completeness gate below fails the build.
2. **Wire request localization + the culture switcher.** API-layer hosts get it for free from
   `UseCommonMiddlewarePipeline()` (which calls `UseCommonRequestLocalization()`) plus
   `MapCultureEndpoint()`; a UI host that deliberately does not reference `MMCA.Common.API` inlines
   the same lines against `SupportedCultures` (see `MMCA.Helpdesk.UI.Web/Program.cs`, which documents
   the inline variant). When you inline them, the `UseRequestLocalization` allowlist and the
   `/culture/set` endpoint must admit the pseudo-locale under the **same** `IsDevelopment()` condition
   the switcher uses to offer it, or picking it silently does nothing. Drop the shared
   `<CultureSwitcher />` (and `<ThemeToggle />`) into the layout; a WASM client also calls
   `MmcaCultureBootstrap.SetBrowserCultureAsync` before `RunAsync()`.
3. **Localize backend error text by `Error.Code`.** Register
   `services.AddErrorResources<YourModuleErrorResources>()` in the host and keep a
   `YourModuleErrorResources.{resx,es.resx}` pair keyed by the module's `Error.Code` values; the
   HTTP edge then returns localized ProblemDetails messages while domain code stays culture-agnostic.
4. **Subclass the two i18n fitness gates** in your architecture-test project (Phase 6):
   `LocalizationResourceTestsBase` (every base `.resx` must have a complete, non-empty `es` sibling)
   and `LocalizedTextConventionTestsBase` (no hard-coded snackbar/title/`<PageTitle>`/breadcrumb/
   `NavItem` literals; mark deliberate literals such as brand names with an `i18n: allow` comment).
5. **Verify visually with the pseudo-locale.** In Development, pick `qps-Ploc` in the culture
   switcher: every properly externalized string renders with a `[!!` sentinel and ~40% padding, so a
   hard-coded literal or a clipped layout is immediately visible without translating anything.

MudBlazor's own component chrome (pager, pickers, filter menus) localizes automatically through the
framework's `ResxMudLocalizer`; nav menu items localize by giving each `NavItem` a `TitleResource`
(its `Title`/`Group` then act as resource keys resolved at render time).

### The Aspire AppHost

`Source/Hosting/MMCA.Helpdesk.AppHost` orchestrates the local stack. For the monolith it is small:

```csharp
using MMCA.Common.Aspire.Hosting;

var builder = DistributedApplication.CreateBuilder(args);
var sql = builder.AddSqlServer("sql").WithLifetime(ContainerLifetime.Persistent);
var db = sql.AddDatabase("helpdesk", "Helpdesk");

var web = builder.AddProject<Projects.MMCA_Helpdesk_Web>("web")
    .WithSQLServerDataSource(db, "Tickets")   // injects ConnectionStrings__SQLServerConnectionString (collapses to one DB)
    .WaitFor(sql)                    // wait on the SQL server, NOT the database (see warning below)
    .WithExternalHttpEndpoints();

// The Blazor UI calls the API server-side; WithReference("web") gives its typed HttpClient the endpoint
// to resolve via service discovery, and WaitFor(web) gates the UI until the API is healthy.
builder.AddProject<Projects.MMCA_Helpdesk_UI_Web>("ui")
    .WithReference(web)
    .WaitFor(web)
    .WithExternalHttpEndpoints();

await builder.Build().RunAsync();
```

> **`WaitFor` the SQL server, not the database resource.** The host creates the database via EF
> `Migrate` at startup, so `WaitFor(db)` deadlocks: the `db` resource is never "healthy" until the
> database exists, but the only thing that creates it is the host that is waiting on it. The app
> resource sits at "Waiting" forever. Wait on the `sql` server resource (healthy once the container
> accepts connections) and let EF create the database. This mirrors MMCA.ADC/Store, which `WaitFor`
> the broker and peer services but never the database resource.

The AppHost also needs a `Properties/launchSettings.json` (the AppHost template always ships one).
Without it, the Aspire **dashboard endpoints are never configured**, so on F5 the dashboard never
opens, no browser launches, and the AppHost appears to hang at control-plane init. Copy ADC's and give
it its own ports:

```jsonc
// Source/Hosting/MMCA.Helpdesk.AppHost/Properties/launchSettings.json
{
  "profiles": {
    "https": {
      "commandName": "Project",
      "launchBrowser": true,
      "applicationUrl": "https://localhost:17300;http://localhost:15300",
      "environmentVariables": {
        "ASPNETCORE_ENVIRONMENT": "Development",
        "DOTNET_ENVIRONMENT": "Development",
        "DOTNET_DASHBOARD_OTLP_ENDPOINT_URL": "https://localhost:21300",
        "DOTNET_RESOURCE_SERVICE_ENDPOINT_URL": "https://localhost:22300"
      }
    }
  }
}
```

Run it:

```bash
dotnet run --project Source/Hosting/MMCA.Helpdesk.AppHost
```

> **Run it interactively, from a real terminal.** The Aspire AppHost stalls at control-plane init if
> launched from a headless or background shell (no dashboard appears). Use an interactive terminal for
> any manual verification.

The dashboard lists three resources: `sql`, `web` (the API), and `ui` (the Blazor front end). Open the
**`ui`** endpoint to browse and open tickets in the browser. To exercise the API directly, hit `POST
/Tickets` then `GET /Tickets` against the `web` endpoint (the API root `/` has no page and returns 404
by design). Confirm 201 then 200, that audit fields are stamped, that soft-deleted rows are filtered
out, and that an outbox row was written for the `TicketOpenedIntegrationEvent`.

---

## Phase 6: Tests and the architecture-fitness map

> **Scaffolded, with one deliberate gap.** All three test projects and the map are generated. The
> `IntegrationEventContractTests` subclass is NOT: its frozen literal lists members alphabetically,
> so an inherited one stops being correct the moment the aggregate is renamed, and a wire contract
> inherited from someone else's sample module guarantees nothing anyway. Freeze your own, once. The
> generated README and the [templates guide](common-TEMPLATES.md) carry the class and the command
> that prints the value.

### Test projects

The reference app ships three test projects, all of which run anywhere with **no database** and finish
in about a second:

- `Tests/Modules/Tickets/...Domain.Tests`: xUnit v3 + AwesomeAssertions. Test factory methods,
  invariants, state transitions, and domain events (including the assertion that `Create` raises **no**
  domain event, since the id is DB-generated; don't "fix" it).
- `Tests/Modules/Tickets/...Application.Tests`: handler and decorator behavior against test doubles.
  In the reference app this is where the caching pair is proved end to end
  (`Caching/TicketCacheInvalidationTests.cs`, shown in Phase 3); add mocked-`IUnitOfWork` handler tests
  here as the module grows.
- `Tests/Architecture/...Architecture.Tests`: the fitness functions (below).

Optional addition as the app grows:

- `Tests/Integration/...IntegrationTests`: boot the host with `WebApplicationFactory` and use
  `IntegrationTestBase<TFixture>` plus `JwtTokenGenerator` (both from `MMCA.Common.Testing`). These
  need a reachable SQL Server, so run them in an environment that has one (Aspire, a container, or CI
  with a SQL service); they cannot run where no SQL is reachable.

### The architecture-fitness map (mandatory)

The framework enforces layering and module isolation by running the **same** NetArchTest rule library
(shipped in `MMCA.Common.Testing.Architecture`) against a per-repo map. You implement one
`IArchitectureMap` by subclassing `ArchitectureMapBase`: declare a `RepoToken` and list every layer
assembly. See [ADR-015](../adr/015-architecture-fitness-functions.md). Pattern source: the
`*.Architecture.Tests` project in MMCA.Helpdesk (shown below), ADC, or Store.

```csharp
internal sealed class HelpdeskArchitectureMap : ArchitectureMapBase
{
    public override string RepoToken => "MMCA.Helpdesk";

    protected override IEnumerable<LayerRef> DefineLayers() =>
    [
        // Framework (MMCA.Common): one anchor type per layer assembly
        Framework(Layer.Shared, typeof(MMCA.Common.Shared.Abstractions.Result).Assembly),
        Framework(Layer.Domain, typeof(MMCA.Common.Domain.Entities.BaseEntity<>).Assembly),
        Framework(Layer.Application, typeof(MMCA.Common.Application.Services.EntityQueryService<,,>).Assembly),
        Framework(Layer.Infrastructure, typeof(MMCA.Common.Infrastructure.Persistence.DbContexts.ApplicationDbContext).Assembly),
        Framework(Layer.Api, typeof(MMCA.Common.API.Controllers.ApiControllerBase).Assembly),

        // Tickets module
        Module("Tickets", Layer.Domain, typeof(MMCA.Helpdesk.Tickets.Domain.Tickets.Ticket).Assembly),
        Module("Tickets", Layer.Application, typeof(MMCA.Helpdesk.Tickets.Application.ClassReference).Assembly),
        Module("Tickets", Layer.Infrastructure, typeof(MMCA.Helpdesk.Tickets.Infrastructure.AssemblyReference).Assembly),
        Module("Tickets", Layer.Shared, typeof(MMCA.Helpdesk.Tickets.Shared.Tickets.TicketDTO).Assembly),
        Module("Tickets", Layer.Api, typeof(MMCA.Helpdesk.Tickets.API.Controllers.TicketsController).Assembly),
        // ...add the same five lines per additional module (e.g. Identity).
    ];
}
```

Each test class is then a tiny sealed subclass of a framework `*TestsBase` that supplies your map:

```csharp
public sealed class LayerDependencyTests : LayerDependencyTestsBase
{
    protected override IArchitectureMap Map { get; } = new HelpdeskArchitectureMap();
}
```

The package ships far more bases than the four structural ones (the authoritative base and method
counts live in [FACTS.md](https://github.com/ivanball/MMCA.Common/blob/main/FACTS.md)), and the
reference app subclasses nineteen. That is the realistic target for a new app, not a stretch goal:
each base is a few lines. Start with the structural group and add the rest as the corresponding
feature appears:

| Group | Bases | What it catches |
|---|---|---|
| Structure (start here) | `LayerDependencyTestsBase`, `DomainPurityTestsBase`, `ModuleIsolationTestsBase`, `SharedLayerTestsBase` | the layer dependency flow, a Domain that reaches for infrastructure, cross-module internal references |
| Extraction | `MicroserviceExtractionTestsBase`, `IntegrationEventContractTestsBase`, `EventConventionTestsBase` | MassTransit/gRPC leaking out of the edges; an integration event reshaped instead of versioned |
| Conventions | `NamingConventionTestsBase`, `HandlerConventionTestsBase`, `ControllerConventionTestsBase`, `EntityConventionTestsBase`, `ImmutabilityTestsBase`, `SliceCohesionTestsBase`, `SpecificationConventionTestsBase` | factory-name, handler, controller, and entity drift away from the framework shape |
| Policy gates | `ConcurrencyConventionTestsBase` (ADR-035), `FrameworkVersionConsistencyTestsBase` (ADR-016), `PiiConventionTestsBase` (ADR-005) | an `*UpdateRequest` with no `RowVersion`, a half-finished version sweep, unmarked personal data |
| i18n (ADR-027) | `LocalizationResourceTestsBase`, `LocalizedTextConventionTestsBase` | a base `.resx` with no complete `es` sibling; a hard-coded user-visible literal |

Two things to know before you copy the list wholesale:

- **`IntegrationEventContractTestsBase` freezes your wire contract.** You override `ExpectedContract`
  with the literal shape of every integration event (`"...TicketOpenedIntegrationEvent { RequesterUserId:Int32, TicketId:Int32 }"`).
  Editing that list is the deliberate act of evolving the contract, so a silent reshape fails the build.
- **Some bases fail deliberately when they find nothing**, which is an anti-vacuity guard rather than a
  bug. `ConstructorDependencyCountTestsBase` scans Application `*Service` classes and fails when there
  are none, so the reference app leaves it unsubclassed until its first Application service exists.
  Others (`DataResidencyTestsBase`, `BrandColorTokenTestsBase`, `FormsConventionTestsBase`) stay
  unsubclassed for scope reasons. Record *why* you skipped one next to the ones you kept: an
  unsubclassed rule is invisible otherwise.

> **Register every layer assembly in the map.** If you add a module or a layer and forget to add its
> `Module(...)` / `Framework(...)` line here, the layering and isolation rules silently stop covering it.

**Checkpoint:** `dotnet build MMCA.Helpdesk.slnx` is warning-free (the five analyzers at error
severity), and all three test projects pass (`dotnet test --solution MMCA.Helpdesk.slnx`, no database
needed). To run one class or method, target the project and pass a Microsoft Testing Platform filter
after `--` (these solutions run on MTP, not VSTest, so a bare `--filter` silently matches nothing):

```bash
dotnet test --project Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/MMCA.Helpdesk.Architecture.Tests.csproj \
  -- --filter-class "*ModuleIsolationTests*"
```

---

## Phase 7: Upgrading the framework version

> **Not scaffolded.** `dotnet new mmca-app --framework-version` picks the version you START on;
> moving to a later one is this phase.

When a new MMCA.Common release ships, upgrade in **one pass**: bump **every** `MMCA.Common.*` entry in
`Directory.Packages.props` to the new version together. There is no phased rollout and no per-package
skew, and `FrameworkVersionConsistencyTestsBase` fails the build if you miss an entry. Keep MassTransit
at v8. See [ADR-016](../adr/016-lockstep-versioning-masstransit-pin.md) and the
[versioning policy](common-VERSIONING.md).

If your app commits `packages.lock.json` files (the reference app deliberately does not), the pin bump
is only half the upgrade: regenerate the locks with `dotnet restore <your.slnx> --force-evaluate` and
commit them alongside the pins, with `local.props` set aside so the restore runs in package mode.

For local framework co-development, flip `UseLocalMMCA` in `local.props`, and remember to rebuild
MMCA.Common in Debug before your app after editing framework source.

---

## Phase 8: Extract a module into its own service (the payoff)

> **Not scaffolded.** The generated solution carries the plumbing (the `.Contracts` proto
> convention and the `.Service` OpenAPI block in `Directory.Build.props`), but the extraction itself
> is a decision, not a rename.

This phase is the documented next step beyond the reference app (which is build- and test-verified as
the monolith through Phase 6); the scaffold already carries the plumbing: the `.Contracts` proto
convention and the `.Service` OpenAPI block in `Directory.Build.props`. Now make the "extract later,
without a rewrite" promise concrete. We pull **Tickets** out of the monolith into its own service
behind a gateway. The Tickets Domain, Application, Shared, Infrastructure, and API code is
**unchanged**: only host wiring and transport are added. This works because the application talks to
abstractions (`IUnitOfWork`, `IMessageBus`, gRPC service interfaces) and the framework keeps transport
at the edges. See [ADR-008](../adr/008-service-extraction-topology.md). This is also where you add the
**Identity** module, since an extracted service needs a real JWKS issuer to validate tokens against.

### 8a. A service host per module

Create `Source/Services/MMCA.Helpdesk.Tickets.Service` (and one for Identity). Each boots exactly one
module (`Modules:Tickets:Enabled=true`). Its `Program.cs` is the same DI sequence as the monolith host,
plus: **Http2-only Kestrel** on cleartext (h2c) for gRPC, `AddGrpcServiceDefaults()`, broker messaging,
and JWKS-validated auth. See [ADR-012](../adr/012-grpc-host-transport.md) (Profile A). Pattern source:
`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs`.

```csharp
builder.WebHost.ConfigureKestrel(k => k.ConfigureEndpointDefaults(o => o.Protocols = HttpProtocols.Http2));
// ...same AddApplication/AddInfrastructure/AddAPI/ModuleLoader sequence...
services.AddGrpcServiceDefaults();
services.AddBrokerMessaging(builder.Configuration, x => x.RegisterIntegrationEventConsumer<SomeEvent>());
```

### 8b. A `.Contracts` project for synchronous calls

If Tickets needs a synchronous answer from Identity (for example, the requester's display name),
define it in `Source/Services/MMCA.Helpdesk.Identity.Contracts` as a `.proto`. The `.Contracts`
convention (from `Directory.Build.props`) auto-compiles it into server + client stubs. The consumer
registers a typed client with `AddTypedGrpcClient<TClient>(serviceName)` (from `MMCA.Common.Grpc`),
which resolves `http://identity` via Aspire service discovery over h2c, forwards the caller's JWT, and
wraps calls in the standard Polly pipeline. Failures cross the wire as `Result` via
`GrpcResultExceptionInterceptor`. See [ADR-007](../adr/007-grpc-extraction.md).

### 8c. A YARP gateway

`Source/Hosts/MMCA.Helpdesk.Gateway` is a pure reverse proxy (no DbContext, no controllers). It maps
URL prefixes to backend services. The route map here is the source of truth for which service owns
which endpoint:

```csharp
app.MapForwarder("/Tickets/{**catch-all}", "http://tickets", http2Config);
app.MapForwarder("/Auth/{**catch-all}", "http://identity", http2Config);
app.MapForwarder("/.well-known/{**catch-all}", "http://identity", http2Config);   // JWKS, routed through the gateway
```

Set `ForwardHttp2 = true` (and `RequestVersionExact`) on the gRPC/JWKS routes so the proxy speaks
HTTP/2 to the Http2-only services. See [ADR-012](../adr/012-grpc-host-transport.md).

### 8d. The AppHost grows up

Now wire the distributed topology with the `MMCA.Common.Aspire.Hosting` extensions:

```csharp
var sql = builder.AddSqlServer("sql").WithLifetime(ContainerLifetime.Persistent);
var identityDb = sql.AddDatabase("helpdesk-identity", "Helpdesk_Identity");
var ticketsDb  = sql.AddDatabase("helpdesk-tickets",  "Helpdesk_Tickets");
var redis  = builder.AddRedis("redis").WithLifetime(ContainerLifetime.Persistent);
var broker = builder.AddMessageBroker().WithLifetime(ContainerLifetime.Persistent);   // RabbitMQ

var identity = builder.AddProject<Projects.MMCA_Helpdesk_Identity_Service>("identity")
    .WithSQLServerDataSource(identityDb, "Identity").WithReference(redis).WithBroker(broker).WithExternalHttpEndpoints();

var tickets = builder.AddProject<Projects.MMCA_Helpdesk_Tickets_Service>("tickets")
    .WithSQLServerDataSource(ticketsDb, "Tickets").WithReference(redis).WithBroker(broker)
    .WithReference(identity).WaitFor(identity).WithExternalHttpEndpoints();

var gateway = builder.AddProject<Projects.MMCA_Helpdesk_Gateway>("gateway")
    .WithReference(identity).WithReference(tickets).WithExternalHttpEndpoints()
    .WithEndpoint("https", e => e.Port = 6001);

tickets.WithJwksDiscovery(identity, gateway);   // two-arg gateway form: tickets validates Identity's JWKS through the gateway
```

> Use the **two-argument** `WithJwksDiscovery(identity, gateway)` form. The single-argument form points
> the backchannel directly at the Http2-only Identity HTTPS endpoint and fails the local ALPN
> negotiation; routing JWKS through the gateway (which terminates TLS) is what works.

What changed for the application code: nothing. `WithSQLServerDataSource` now gives each service its own database
(`Helpdesk_Identity`, `Helpdesk_Tickets`, each with its own `OutboxMessages` table, so services never
race for each other's outbox rows, see [ADR-006](../adr/006-database-per-service.md)). The
`TicketOpenedIntegrationEvent` you wrote in Phase 3 now flows monolith-to-broker over MassTransit
instead of in-process, selected purely by configuration. Cross-service references become scalar columns
plus eventual consistency through the outbox, never cross-database foreign keys.

---

## Verification checklist

0. **Scaffolded:** `dotnet new mmca-app -n <YourApp>` produced a solution that builds and tests
   green before you changed anything. If it did not, that is a template bug, not yours.
1. **Build green:** `dotnet build MMCA.Helpdesk.slnx` with no warnings (TreatWarningsAsErrors + five
   analyzers). This is the primary automatable gate.
2. **Unit + architecture tests pass:** `dotnet test --solution MMCA.Helpdesk.slnx` (all three
   projects, no DB needed). The `IArchitectureMap` rules must be green. A scaffolded solution runs
   one test fewer than the reference app until you freeze your own integration-event contract
   (Phase 6).
3. **Migrations:** `dotnet ef migrations add InitialCreate ...` succeeds for each migrations project
   (generates the `Ticket`, `TicketComment`, and per-DB `OutboxMessages` tables).
4. **Run (interactive):** `dotnet run --project ...AppHost`; the dashboard shows `sql`, `web`, and `ui`
   healthy. Open `ui` to use the app, or hit `POST /Tickets` then `GET /Tickets` on `web`; confirm
   201/200, stamped audit fields, soft-delete filtering, and an outbox row for the
   `TicketOpenedIntegrationEvent`. (Issuer-less, so no token is needed.)
5. **Extraction smoke:** after Phase 8, the dashboard shows Identity + Tickets + Gateway healthy; a
   request through the gateway to Tickets succeeds and JWKS-validates; the integration event is
   delivered over the broker.

---

## Where to look next

- **[Templates](common-TEMPLATES.md)**: every parameter of `mmca-app`, `mmca-module`,
  `mmca-command`, and `mmca-query`, plus the two one-time fixups a rename makes unavoidable.
  [ADR-065](../adr/065-scaffolding-templates.md) explains why the pack is derived from the reference
  app rather than maintained beside it.
- **[MMCA.Helpdesk](https://github.com/ivanball/MMCA.Helpdesk)**: the minimal, build- and test-verified
  monolith this guide is the companion to: every step above maps to real code there. Read its
  `README.md` and `CLAUDE.md` for the Helpdesk-specific picture (issuer-less auth, the two event paths,
  the abstract module DbContext).
- **The ADRs** ([index](../adr/README.md)): the *why* behind every pattern you just used.
- **`MMCA.Common/CLAUDE.md`**: the framework's layer rules, DI sequence, and extension points in depth.
- **The [onboarding guide](../onboarding/00-index.md)**: a type-by-type tour of the framework internals.
- **MMCA.ADC and MMCA.Store**: two complete, production apps to copy patterns from. ADC is the richer
  template (four modules, OAuth social login, SignalR notifications); Store is the simpler one.
