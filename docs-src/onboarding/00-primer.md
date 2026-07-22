# Primer, the concepts, stack, and conventions you need first

This chapter teaches the cross-cutting things **once**, so the per-type chapters can stay focused.
Read it before the group chapters (start with [`group-01`](group-01-result-error-handling.md)).
Everything here is either an architectural style the codebase commits to,
an external dependency (BCL/NuGet, "external Level 0"), a build/language convention, or the
architecture-evaluation lens the guide tags against. Later sections cross-reference back here.

---

## 1. The big picture

Two codebases are in scope:

- **`MMCA.Common`**: a **framework**, published as **fifteen NuGet packages** to GitHub Packages
  (four core: `.Shared`, `.Domain`, `.Application`, `.Infrastructure`; five presentation: `.API`,
  `.Grpc`, `.UI`, `.UI.Maui`, `.UI.Web`; two Aspire: `.Aspire`, `.Aspire.Hosting`; four testing: `.Testing`, `.Testing.E2E`,
  `.Testing.UI`, `.Testing.Architecture`). It is *not* a runnable app; it ships the base classes and
  infrastructure for building modular monoliths with DDD + Clean Architecture + CQRS, plus the seams
  to extract a module into its own microservice later. The fifteen packages release **in lockstep**
  (one version tags all fifteen).
- **`MMCA.ADC`**: the **Atlanta Developers Conference** application, a consumer of those packages.
  It has modules (Conference, Engagement, Identity, Notification), a Blazor UI, a YARP gateway, and
  Azure infrastructure.

`MMCA.ADC` depends on `MMCA.Common`; `MMCA.Common` depends on neither. That is why the Common
framework groups come first in this guide and the ADC business-module groups build on them, and
within every group, the per-type sections run in ascending dependency **Level**.

### The layered dependency flow (Clean Architecture)

`MMCA.Common`'s own layering, enforced top-to-bottom (`MMCA.Common/CLAUDE.md`, "Architecture"):

```
API / Grpc        (presentation / transport)
     ↓
Infrastructure    (EF Core, caching, JWT, JWKS, outbox, message bus, SignalR)
     ↓
Application       (CQRS handlers, decorators, module system, IMessageBus)
     ↓
Domain            (entities, aggregates, domain events, specifications)
     ↓
Shared            (Result pattern, errors, DTOs, value objects)
```

Each layer references only layers **below** it, the **dependency rule** of Clean Architecture: source
dependencies point inward, toward the domain, and the domain depends on nothing framework-specific.
Two deliberate exceptions: **`UI`** and **`Grpc`** depend on **`Shared` only**, `UI` for Blazor
WebAssembly compatibility, `Grpc` because it is pure transport that must not couple to business
layers.

`MMCA.ADC` repeats the same layering *per module*: each of Conference/Engagement/Identity has
`.Shared`, `.Domain`, `.Application`, `.Infrastructure`, `.API`, and `.UI` projects following the
same inward rule.

---

## 2. Architectural styles this codebase commits to

These are the recurring ideas. Each is taught fully at its first concrete appearance in a group
chapter; here is the orientation so the vocabulary is familiar.

- **Domain-Driven Design (DDD).** The model mirrors the business. **Aggregates** (a root entity plus
  the children it owns) enforce invariants inside their boundary; references *between* aggregates are
  by ID, not object graph. **Value objects** (Money, Address, Email) model concepts with no identity
  and are immutable. **Domain events** announce meaningful state changes. **Factory methods return
  `Result<T>`** so an invalid entity cannot be constructed. First concrete code:
  [`group-02`](group-02-domain-building-blocks.md) (`ValueObject`, `IBaseEntity<T>`) and
  [`group-04`](group-04-events-outbox.md) (`IDomainEvent`).

- **Clean Architecture.** See §1. The domain layer is free of EF/ASP.NET/serialization attributes;
  the application layer defines **ports** (interfaces) that infrastructure implements as **adapters**.

- **CQRS (Command/Query Responsibility Segregation).** Writes (**commands**, which mutate and return
  a `Result`) are separated from reads (**queries**, side-effect-free). Both flow through a
  **dispatcher** with a **decorator pipeline**: `Logging → Caching → Transactional → handler`.
  Cross-cutting concerns live in the pipeline, not in each handler. First concrete code: the
  `ICommandHandler`/`IQueryHandler` contracts and their decorators in
  [`group-05`](group-05-cqrs-pipeline.md).

- **Vertical Slice Architecture.** Within a module, a feature is a cohesive slice (command/query +
  handler + validator + DTO + mapper together), not scattered across horizontal `Services/`,
  `Repositories/`, `Validators/` folders. Adding a feature means adding a slice.

- **Modular Monolith → extractable services.** Modules implement a common `IModule` contract and are
  discovered and registered in **dependency (topological) order** by a module loader. Each module can
  later run as its own service host behind a **YARP gateway** without a rewrite, because application
  code talks to abstractions (`IMessageBus`, typed gRPC clients) and the transport choice lives at the
  edges. (ADRs 007 "gRPC extraction", 008 "service-extraction topology".)

- **Write-once UI, render everywhere (Blazor + .NET MAUI Hybrid).** A UI page is authored **once** as
  a Razor component in a per-module **Razor Class Library** (`MMCA.ADC.{Module}.UI`, e.g.
  `Conference.UI`'s `EventList.razor`/`EventDetail.razor`). Both the **web** host
  (`MMCA.ADC.UI.Web` / `.Web.Client`, Blazor Server + WebAssembly) and the **.NET MAUI** host
  (`MMCA.ADC.UI`) `ProjectReference` the *same* UI libraries, so one page renders across **Web,
  Android, iOS, macOS, and Windows** with no per-platform reimplementation, MAUI hosts the shared
  components in a `BlazorWebView` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MainPage.xaml:9`, wired by
  `AddMauiBlazorWebView()` in `MauiProgram.cs:51`). The only platform-specific code is tiny entry
  points (`App`/`AppDelegate`/`MainApplication`, `MauiProgram`). First concrete code: the MAUI
  bootstraps and host shells in [`group-25`](group-25-adc-host-composition.md); the supported
  device/browser matrix is in `MMCA.ADC/CLAUDE.md`.

- **Event-driven integration + the Outbox pattern.** When an aggregate changes, its domain events are
  serialized into an `OutboxMessage` row **in the same transaction** as the data, then a background
  processor delivers them at-least-once. This avoids the "save then publish and hope" dual-write bug.
  (ADR-003 "outbox dual-dispatch".)

- **Database-per-service.** Each module/service owns its own SQL database and its own outbox table;
  there is one concrete `SQLServerDbContext` class but **one instance per database**. Cross-source
  relationships auto-degrade (the FK is dropped, navigation flows through batch loaders), and the
  outbox is the cross-source consistency mechanism. (ADR-006.)

- **Engine-agnostic entities, the storage provider is a one-token choice (ADR-018).** A
  domain entity carries *no* persistence-engine choice; it is a plain class. What decides whether it
  is stored in **SQL Server, Cosmos DB, or SQLite** is a single `[UseDataSource(<engine>)]` attribute on
  its `Infrastructure/Persistence/EntityConfiguration/{Entity}Configuration` class, carried for you by
  one of three thin **engine shim** base classes (`EntityTypeConfigurationSQLServer<TEntity, TId>`,
  `…Cosmos<…>`, `…Sqlite<…>`). All three derive from a single engine-aware
  `EntityTypeConfiguration<TEntity, TId>` base (which reads the attribute and applies the matching
  table/container/schema/key conventions) over `EntityTypeConfigurationBase<TEntity, TId>`,
  [`group-07`](group-07-persistence-ef-core.md). So **swapping just that base (or attribute) re-points the
  same entity to a different engine** with no configuration-body edits and zero change to the domain,
  application layer, or entity, the engine is resolved up front by the `EntityDataSourceRegistry`, the
  right `DbContext` is built per data source, cross-source relationships auto-degrade, and a cross-source
  filter goes through `CrossSourceSpecification` (so even a "published-event" predicate stays
  translatable). First concrete code: the configuration hierarchy in
  [`group-07`](group-07-persistence-ef-core.md); this is the per-entity half of database-per-service
  (ADR-006) plus the polyglot story (ADR-018).
  *Adoption note (verified by source):* this is a real, **tested** capability with a **staged first
  adoption**. Today **all current production entity configs use the `…SQLServer` base** (ADC runs SQL
  Server only, 4 SQL databases), but the ADR-018 work shipped the full polyglot machinery (unified base,
  cross-source spec + fitness rule, Cosmos-index skip, SQLite `EnsureCreated`, Cosmos/SQLite Aspire
  helpers, portability tests) and ADC Conference's `Session`→Cosmos / `Room`→SQLite move is the
  staged-but-not-yet-deployed first use. Treat Cosmos/SQLite as supported, exercised seams, see the
  coverage audit's seam inventory.

- **The Result pattern.** Expected error paths use a `Result`/`Result<T>` return value carrying
  `Error`s, **not** exceptions. This is the single most pervasive idiom in the codebase, taught in
  full in [`group-01`](group-01-result-error-handling.md) (`ErrorType`, `Error`, `Result`).

- **Soft-delete + audit fields.** Entities are never hard-deleted; an `IsDeleted` flag plus EF global
  query filters exclude them. `CreatedOn/By` and `LastModifiedOn/By` are stamped centrally in
  `SaveChangesAsync`. For genuine erasure (GDPR/CCPA) there is a separate anonymize path. (ADR-005.)

- **Strongly-typed identifier aliases.** Each entity's ID type is a solution-wide
  `global using XIdentifierType = int;` (or `= System.Guid;`) alias, linked into every project via
  `Directory.Build.props`. Code says `EventIdentifierType`, not bare `int`, so the ID type can change
  in one place. (The identifier-alias mechanism is covered with the entity contracts in
  [`group-02`](group-02-domain-building-blocks.md).)

### The decision records (ADRs) this guide tags

The *why* behind these patterns lives in **fifty accepted ADRs** (001-050; the Website repo's
`docs-src/adr/README.md` owns the count and range), version-controlled in
`Website/docs-src/adr/` and published at <https://ivanball.github.io/docs/adr/> (its `README.md` is the
canonical index with one-line summaries). Group chapters tag the relevant one inline (e.g. "ADR-003");
the full set, for orientation:

| ADR | Decision (one line) | First/most relevant chapter |
|-----|---------------------|------------------------------|
| 001 | Manual DTO mapping (Mapperly), not reflection-based AutoMapper | [g12](group-12-api-hosting-mapping.md) |
| 002 | `INavigationPopulator<T>` for cross-container/cross-source eager loading | [g11](group-11-navigation-populators.md) |
| 003 | Outbox + in-process dispatch + background processor (at-least-once) | [g04](group-04-events-outbox.md) |
| 004 | JWKS discovery + fallback for cross-service token validation | [g08](group-08-auth.md) |
| 005 | Soft-delete for lifecycle; `IAnonymizable` + outbox purge for GDPR/CCPA erasure | [g02](group-02-domain-building-blocks.md)/[g24](group-24-identity-module.md) |
| 006 | Database-per-service: each owns its DB + outbox; one `SQLServerDbContext` class, one instance per DB | [g07](group-07-persistence-ef-core.md) |
| 007 | `*.Contracts` + typed gRPC clients + `Result`-over-the-wire for synchronous inter-service calls | [g13](group-13-grpc-contracts.md) |
| 008 | One service host per module behind a YARP gateway; transport at the edge keeps extraction reversible | [g16](group-16-aspire-orchestration.md)/[g25](group-25-adc-host-composition.md) |
| 009 | Standard resilience handler on every outbound client; declared RTO/RPO + drilled restore | [g13](group-13-grpc-contracts.md)/[devops-runbooks](devops-runbooks.md) |
| 010 | Every integration event carries a `SchemaVersion`; breaking changes use a new type + upcaster | [g04](group-04-events-outbox.md) |
| 011 | ~~en-US-only i18n is a deliberate non-goal~~ **superseded by ADR-027** (multi-locale en-US + es) | [g15](group-15-common-ui-framework.md) |
| 012 | gRPC host transport: `Http2`-only h2c + gateway-routed JWKS (ADC) vs `Http1AndHttp2` + ALPN (Store) | [g16](group-16-aspire-orchestration.md)/[g20](group-20-conference-api-grpc.md) |
| 013 | Expected failures are `Result`/`ErrorType` values; only the edge maps to HTTP/gRPC | [g01](group-01-result-error-handling.md) |
| 014 | CQRS decorator chain: FeatureGate → Logging → Caching → Validating → Transactional → Handler | [g05](group-05-cqrs-pipeline.md) |
| 015 | Architecture fitness functions: compile-time layer guard + shared NetArchTest rule library | [g27](group-27-testing-infrastructure.md) |
| 016 | Lockstep versioning of all fifteen packages; MassTransit pinned to v8 (build-gated) | [devops-cicd](devops-cicd.md) |
| 017 | `[Idempotent]` action filter dedups client retries via an `Idempotency-Key` header (24h replay) | [g12](group-12-api-hosting-mapping.md) |
| 018 | Polyglot persistence: three engines (SQL Server / Cosmos / SQLite) behind one entity model, engine via `[UseDataSource]` | [g07](group-07-persistence-ef-core.md)/[g03](group-03-querying-specifications.md) |
| 019 | Layered rate limiting: an always-on global limiter caps only authenticated callers; anonymous/infra traffic is exempted, with output cache + login-protection for the other layers | [g08](group-08-auth.md)/[g12](group-12-api-hosting-mapping.md) |
| 020 | Permission-based authorization: `[HasPermission(...)]` over an `IPermissionRegistry`, opt-in atop RBAC | [g08](group-08-auth.md) |
| 021 | Consumer-side inbox idempotency: `EfInboxStore` dedups broker redeliveries by `MessageId` | [g04](group-04-events-outbox.md) |
| 022 | Browser session-cookie auth: HttpOnly cookies + a non-validating SSR scheme so `[Authorize]` passes on prerender | [g08](group-08-auth.md) |
| 023 | Security-response headers + pluggable CSP (`ICspPolicyProvider`); the baseline CSP omits `script-src`/`style-src` so it cannot break Blazor | [g16](group-16-aspire-orchestration.md)/[g25](group-25-adc-host-composition.md) |
| 024 | Two-channel notifications: a durable `UserNotification` inbox **and** a transient SignalR push, behind `IPushNotificationSender` | [g10](group-10-notifications.md) |
| 025 | Startup warm-up + readiness gating: `WarmupHostedService` + a `ready`-tagged `WarmupReadinessGate` hold `/health/ready` until warm | [g16](group-16-aspire-orchestration.md) |
| 026 | Two-tier caching: a swappable `ICacheService` substrate (Memory/Redis) + an HTTP output-cache edge tier | [g09](group-09-caching.md) |
| 027 | Multi-locale i18n (supersedes 011): en-US + es via `.resx`/`IStringLocalizer`; backend errors localized at the edge by `Error.Code` | [g12](group-12-api-hosting-mapping.md)/[g15](group-15-common-ui-framework.md) |
| 028 | Day/Dark theme: `ThemeService` binds `MudThemeProvider`'s `IsDarkMode`, persisting cookie/localStorage/`PreferredTheme` | [g15](group-15-common-ui-framework.md) |
| 029 | Auth brute-force protection: `ILoginProtectionService` throttles the anonymous surface (email-keyed lockout + per-IP registration cap) | [g08](group-08-auth.md) |
| 030 | Startup sole-migrator: each service self-applies its EF migrations at boot (`DatabaseInitStrategy=Migrate`), no `sqlcmd` backstop | [g07](group-07-persistence-ef-core.md)/[g12](group-12-api-hosting-mapping.md) |
| 031 | Feature-flag management: `[FeatureGate]` (404) + the `IFeatureGated` decorator for one config-driven flag name | [g12](group-12-api-hosting-mapping.md)/[g05](group-05-cqrs-pipeline.md) |
| 032 | Password hashing: PBKDF2-HMAC-SHA512 (600k iters) with by-salt-length migration of legacy records | [g08](group-08-auth.md) |
| 033 | Resource-ownership authorization: `OwnerOrAdminFilter`/`OwnershipHelper` row-scope a single resource beside RBAC | [g08](group-08-auth.md) |
| 034 | Generic entity controllers + dynamic query contract (`EntityControllerBase`; `fields`/filter/sort/paging) | [g12](group-12-api-hosting-mapping.md)/[g03](group-03-querying-specifications.md) |
| 035 | Optimistic concurrency: a `RowVersion` token round-trips through `IConcurrencyAware` DTOs; a stale write maps to HTTP 409 | [g07](group-07-persistence-ef-core.md)/[g12](group-12-api-hosting-mapping.md) |
| 036 | External OAuth login (Google/GitHub): `OAuthControllerBase` swaps a single-use 2-minute code for the local JWT pair (tokens never ride the redirect URL) | [g08](group-08-auth.md)/[g12](group-12-api-hosting-mapping.md) |
| 037 | Field-level encryption at rest: `EncryptedStringConverter` (AES-256-GCM), shipped + tested but **unadopted** (no entity config wires it yet) | [g07](group-07-persistence-ef-core.md) |
| 038 | Supply-chain provenance: SBOM release gate + committed lock files + transitive vuln audit + `packageSourceMapping` | [devops-cicd](devops-cicd.md) |
| 039 | Live channel push: hub `JoinChannel`/`LeaveChannel` groups + `ILiveChannelPublisher` publish ephemeral events over the one notification WebSocket | [g10](group-10-notifications.md)/[g15](group-15-common-ui-framework.md)/[g23](group-23-engagement-live-layer.md) |
| 040 | Authenticated output caching for public reads: `PublicEndpointOutputCachePolicy` stops a Bearer header from bypassing the output cache on `[AllowAnonymous]`, user-independent GETs | [g12](group-12-api-hosting-mapping.md) |
| 041 | Observability strategy: shared OTel baseline + CQRS RED histograms + outbox dead-letter counter + correlation middleware, with head-sampling and poll-span-filter cost knobs | [g16](group-16-aspire-orchestration.md)/[devops-aspire](devops-aspire.md) |
| 042 | Device capability abstraction (MAUI Blazor Hybrid): per-capability contracts + TryAdd null/browser fallbacks + MAUI-native overrides, `IDeepLinkDispatcher`; `MMCA.Common.UI.Maui` is the fifteenth package | [g26](group-26-device-capability-layer.md) |
| 043 | Mobile deep links + app association + native OAuth callback: allow-listed custom-scheme redirect of the single-use code; `assetlinks.json`/AASA served by the UI.Web host | [g12](group-12-api-hosting-mapping.md)/[g26](group-26-device-capability-layer.md) |
| 044 | Native push delivery (third channel, amends 024): `INativePushSender`/`IPushDeviceRegistrar` (Azure Notification Hubs, Null defaults) reach backgrounded/killed apps; non-fatal after the inbox+SignalR legs | [g10](group-10-notifications.md)/[g07](group-07-persistence-ef-core.md) |
| 045 | Managed file storage + avatars: `IFileStorageService` (Azure Blob/Null) + `IImageProcessor` (crop, strip metadata, re-encode); 2 MB in, 256x256 JPEG out, `[Pii]` URL nulled on anonymize | [g07](group-07-persistence-ef-core.md)/[g24](group-24-identity-module.md) |
| 046 | HTTP API versioning: one `AddCommonApiVersioning` (header `api-version`, default 1.0); `ServiceInfoControllerBase` v1.0-deprecated + v2.0 exemplar, fitness-asserted per repo | [g12](group-12-api-hosting-mapping.md)/[g20](group-20-conference-api-grpc.md) |
| 047 | Soft-deleted-user session revocation: `SoftDeletedUserMiddleware` 401s an authenticated caller whose `User.IsDeleted`, via a 30s-cached `ISoftDeletedUserValidator`, bounding the stateless-JWT revocation window | [g12](group-12-api-hosting-mapping.md) |
| 048 | Primitive identifier type aliases: entity IDs are primitives behind per-module `global using {Entity}IdentifierType`, chosen over strongly-typed ID structs (readability + zero EF/serializer friction) | [g02](group-02-domain-building-blocks.md)/[g14](group-14-module-system-composition.md) |
| 049 | Library-scoped `ConfigureAwait(false)` policy: packaged non-UI framework code is build-gated (CA2007 warning for `Source/**` in Common's `.editorconfig` delta, UI packages excluded); protects the MAUI head and any non-ASP.NET consumer from context-capture deadlocks | [devops-cicd](devops-cicd.md) |
| 050 | JWT + single rotating refresh token: a short-lived stateless access token plus one server-stored opaque refresh token per user that rotates on every use (mismatch/expiry revokes + 401); the sliding expiry re-stamps on rotation, and single-token-per-user signs other devices out | [g08](group-08-auth.md) |

ADRs 011–050 were authored after this guide's first build; their patterns were already documented here,
and the chapters now cross-reference the ADR numbers. Recent framework additions include the
**device capability abstraction layer** (ADR-042/043/044/045: per-capability contracts with MAUI-native,
browser, and inert-fallback adapters, mobile deep links, native OS push, managed file storage + user
avatars), taught in the new [g26](group-26-device-capability-layer.md) chapter and cross-referenced in
g07/g10/g12/g24; the newest records are the library-scoped `ConfigureAwait(false)` build policy (ADR-049)
and the rotating-refresh-token auth workflow (ADR-050). The canonical index for the full set is the
Website repo's `docs-src/adr/README.md` (published at <https://ivanball.github.io/docs/adr/>), which owns
the count and range.

---

## 3. The external stack (BCL / NuGet, "external Level 0")
<a id="3-the-external-stack-bcl--nuget--external-level-0"></a>

These are *not* first-party and get no per-type sections. Versions are from
`MMCA.Common/Directory.Packages.props` and `MMCA.ADC/Directory.Packages.props` (Central Package
Management, see §4). What each is and why it's here:

**Web / API**
- **ASP.NET Core 10** (minimal hosting, MVC controllers), the API surface.
- **Asp.Versioning.Mvc 10**: API versioning for controllers.
- **Microsoft.AspNetCore.Authentication.JwtBearer 10**: validates JWT bearer tokens.
- **Yarp.ReverseProxy 2.3.0** (ADC), the **gateway** that fronts the extracted module services; with
  `Microsoft.Extensions.ServiceDiscovery.Yarp` it routes to services by name.

**Application / mapping / validation**
- **FluentValidation 12**: request/command validators, run by a pipeline decorator.
- **Riok.Mapperly 4.3.1**: a *source-generated*, compile-time object mapper (no runtime reflection).
  Note ADR-001 chose manual DTO mapping over reflection-based AutoMapper; Mapperly is the
  compile-time, allocation-free way to keep mapping explicit and fast.
- **Scrutor 7**: assembly scanning and **decorator registration** (`TryDecorate`) for DI; this is how
  the CQRS decorator pipeline is wired.
- **Microsoft.FeatureManagement 4.5**: feature flags (e.g. `Notification.PushNotifications`).
- **System.Linq.Dynamic.Core**: dynamic `OrderBy`/filtering for query endpoints.

**Persistence**
- **EF Core 10** with providers **SqlServer**, **Cosmos**, and **Sqlite**: the ORM. Sqlite is used
  for fast integration tests; Cosmos is a supported document source. EF concepts you must know:
  `DbContext` (unit of work + change tracker), entity configurations (`IEntityTypeConfiguration<T>`),
  migrations (versioned schema deltas), global query filters (the soft-delete mechanism), and
  interceptors (`SaveChanges` hooks for audit + domain-event capture).
- **StackExchange.Redis** / SignalR Redis backplane, distributed cache and SignalR scale-out.

**Messaging**
- **MassTransit 8.5.5** (RabbitMQ + Azure Service Bus transports), the broker abstraction behind
  `IMessageBus`'s broker implementation. **Pinned to v8 by policy**: v9 requires a commercial license
  and crashes broker-enabled hosts at startup; a build-time test fails if the major reaches 9
  (`Directory.Packages.props:39-48`, and see §4).

**Transport (service extraction)**
- **Grpc.AspNetCore / Grpc.Net.ClientFactory / Grpc.Tools / Google.Protobuf**: gRPC server + client
  + `.proto` compilation, for synchronous inter-service calls between extracted modules (ADR-007).

**UI**
- **MudBlazor 9.5.0**: the Blazor **component library** and design system (grids, dialogs, forms,
  theme). Used by both `MMCA.Common.UI` and the ADC UIs.
- **Microsoft.AspNetCore.Components.***: Blazor (Server + WebAssembly) runtime and authorization.
- **Polly 8** (via `Microsoft.Extensions.Http.Resilience`), retry/timeout/circuit-breaker resilience
  on outbound HTTP/gRPC clients.

**Hosting / observability (.NET Aspire)**
- **Aspire.Hosting 13.4.2** (+ RabbitMQ, Azure CosmosDB integrations), local **orchestration**: the
  AppHost spins up every service, database, broker, and a dashboard with one command.
- **OpenTelemetry** (Api/Exporter/Instrumentation) + **Azure.Monitor.OpenTelemetry.AspNetCore**,
  structured logs, distributed traces, and metrics, exported to Azure Application Insights.
- **Microsoft.Extensions.ServiceDiscovery**: resolves service names to endpoints (local and cloud).
- **AspNetCore.HealthChecks.***: Redis/RabbitMQ health probes.

**Auth / crypto**
- **System.IdentityModel.Tokens.Jwt 8**: JWT creation/validation; JWKS key publishing for
  cross-service token validation (ADR-004 "authentication dual-fetch").

**Versioning / build**
- **MinVer 7**: derives the package version from the git tag (`vX.Y.Z`), so releases are tag-driven.

**Analyzers (all at *error* severity, see §4)**
- **Meziantou.Analyzer**, **SonarAnalyzer.CSharp**, **StyleCop.Analyzers**, **Roslynator.Analyzers**,
  **Microsoft.VisualStudio.Threading.Analyzers**.

**Testing**
- **xunit.v3 3.2**: the test framework (xUnit **v3**, not v2).
- **Microsoft Testing Platform (MTP)**: the test *runner* (`global.json` sets
  `"runner": "Microsoft.Testing.Platform"`), **not** VSTest. This changes how you run a single test
  (see §6).
- **bUnit 2**: Blazor component testing (the v2 line is the one compatible with xUnit v3 / MTP).
- **Microsoft.Playwright 1.60** + **Deque.AxeCore.Playwright**: browser E2E and **axe-core**
  accessibility (WCAG 2.1 AA) scanning.
- **NetArchTest.eNhancedEdition**: **architecture fitness tests** (assert layer/purity rules against
  compiled assemblies).
- **Moq 4** (mocking), **AwesomeAssertions 9** (fluent assertions, a FluentAssertions-compatible
  fork), **coverlet** (coverage).

---

## 4. C#, build, and code-style conventions

- **.NET 10.0**, **`LangVersion: preview`**: required because the codebase uses **C# extension
  types** (`extension(T)` syntax, see below).
- **Central Package Management (CPM).** All NuGet versions live in each repo's
  `Directory.Packages.props` (`ManagePackageVersionsCentrally = true`); individual `.csproj` files
  reference packages by name only. To change a version, edit the props file. `[Rubric §15, §32]`
- **NuGet lock files + pinned, audited sources.** `MMCA.Common` commits lock files and pins
  `packageSourceMapping` to nuget.org, so it builds/tests with no GitHub token. CI runs
  `dotnet list package --vulnerable` and fails on any vulnerable package. The **MassTransit v8 pin**
  is enforced by a build-time test (`DependencyVersionTests`), a blanket "update all packages" that
  reintroduces v9 will fail the build by design. `[Rubric §32, Dependency & Supply-Chain]`
- **`TreatWarningsAsErrors` globally**, and **five analyzers at *error* severity.** The code must be
  warning-free to compile. `[Rubric §15, Best Practices & Code Quality]`
- **`.editorconfig` enforces style at error severity** (`MMCA.Common/.editorconfig`): file-scoped
  namespaces (`csharp_style_namespace_declarations = file_scoped:error`, line 94), braces always
  required, `var` only when the type is apparent (lines 97–99), expression-bodied members preferred
  (lines 102–109), all accessibility modifiers required, no `this.` qualification, `readonly` where
  possible, private fields `_camelCase`, constants `PascalCase`, interfaces begin with `I` (error,
  line 204). Test files relax method-naming and complexity rules via a `[Tests/**/*.cs]` section.

### C# `extension(T)` types, read this once
<a id="c-extensiont-types--read-this-once"></a>

C# 14 (preview) **extension members** let a static class add members to a type via an `extension`
block:

```csharp
public static class DomainHelper
{
    extension(string? id)                 // receiver: the "this" value
    {
        public TIdentifier Parse<TIdentifier>() { ... }   // usable as someString.Parse<int>()
    }
}
```

The codebase uses this heavily for **DI registration**, every `DependencyInjection.cs` adds methods
like `AddApplication()` directly onto `IServiceCollection` through an `extension(IServiceCollection)`
block. You'll first meet the syntax in [`group-02`](group-02-domain-building-blocks.md)
(`DomainHelper`, `EntityTypeExtensions`). (A practical note for the leveling: references written *inside* an extension block belong
to the enclosing static class, that's how this guide attributes their dependencies.)

### Architecture enforcement is doubled (fitness functions) `[Rubric §34, §3]`
<a id="architecture-enforcement-is-doubled-fitness-functions"></a>

The layer rules are not just convention, they are enforced **twice**:

1. **Compile-time**, `Source/Build/MMCA.Common.LayerEnforcement.targets`, imported for every
   `MMCA.Common.*` project, inspects `ProjectReference`s before build and **fails** with a descriptive
   error if a layer references a forbidden upstream layer.
2. **Runtime (test)**, `Tests/Architecture/MMCA.Common.Architecture.Tests` (NetArchTest) asserts the
   same rules against compiled assemblies: layer flow, **domain purity**, and **microservice
   extraction** rules (e.g. *Application/Domain/Shared must never reference MassTransit directly*,
   depend on `IMessageBus` instead). The rule bodies themselves now live once in the shipped
   **`MMCA.Common.Testing.Architecture`** package (the 13th package): a reusable rule library +
   abstract `*TestsBase` classes that each repo's arch-test project subclasses, supplying only a
   repo-specific `IArchitectureMap`, so both `MMCA.Common` and `MMCA.ADC` enforce one rule set.

When you move a type between packages, expect *both* gates to react. This is the codebase's
"executable governance", covered fully in the architecture-tests chapter.

---

## 5. The solution / test layout

- **`*.slnx`**: the human solution (XML format). `*.slnf`, a **solution filter** used in CI to build
  a subset fast (`MMCA.Store.CI.slnf`, `MMCA.ADC.CI.slnf`).
- **Microsoft Testing Platform**, not VSTest. To run one test class/method you target the test
  project and pass an MTP filter after `--`:
  ```bash
  dotnet test --project Tests/<path>/<Name>.Tests.csproj -- -method "*Pattern*"
  #                                                          -- -class  "*FooTests*"
  ```
  Every test project must contain ≥1 test or MTP exits 8 (CI uses `--minimum-expected-tests 1`).
- Some UI test projects (`MMCA.Common.UI.Gallery`, `MMCA.Common.UI.E2E.Tests`) are **deliberately
  excluded** from the `.slnx` so the unit-test run stays fast; they run in a dedicated CI job and are
  built by csproj path.

---

## 6. The 34-category architecture-evaluation lens

This codebase is also scored against a **34-category rubric** (`Architecture/ArchitectureEvaluationCriteria.md`).
This guide **weaves the rubric in** so you learn the system *and* the lens it's judged by at the same
time. Each type section tags the categories it genuinely touches as **`[Rubric §N, Name]`**, with a
one-line "what §N assesses" and "how this code embodies (or under-uses) it". The first occurrence of a
category teaches it; later ones cross-reference back. **The guide explains categories; it does not
score them**, the filled scorecards live in `Architecture/ArchitectureEvaluation-MMCA.Common.md`,
`Architecture/ArchitectureEvaluation-MMCA.ADC.md`, and the repo's `ArchitectureScorecard.md`.

### Two axes (so a tag can say "mature but mediocre" or vice-versa)

- **Maturity (0–4)**: *process*: how consistently/automatically the pattern is governed
  (ad-hoc → enforced by CI).
- **Implementation (0–10)**: *substance*: how good the implementation is right now, against the
  category's criteria and red flags.

### The categories, in three parts (quick index, full criteria in the rubric file)

**Part A, Application / Backend (§1–17):** §1 SOLID · §2 Design Patterns · §3 Clean Architecture ·
§4 Domain-Driven Design · §5 Vertical Slice · §6 CQRS & Event-Driven · §7 Microservices Readiness ·
§8 Data Architecture · §9 API & Contract Design · §10 Cross-Cutting Concerns · §11 Security ·
§12 Performance & Scalability · §13 Observability & Operability · §14 Testability & Test Strategy ·
§15 Best Practices & Code Quality · §16 Maintainability & Evolvability · §17 DevOps & Deployment.

**Part B, Front-End / UI (§18–28):** §18 UI Architecture & Component Design · §19 State Management &
Data Flow · §20 Design System, Theming & Consistency · §21 Accessibility (a11y) · §22 Responsive &
Cross-Browser/Device · §23 Front-End Performance & Rendering · §24 Forms, Validation & UX Safety ·
§25 Navigation, Routing & Information Architecture · §26 Front-End Security · §27 Internationalization
& Localization · §28 Front-End Testing & Quality.

**Part C, Operational, Governance & Cross-Cutting (§29–34):** §29 Resilience, Reliability & Business
Continuity · §30 Compliance, Privacy & Data Governance · §31 Cost Efficiency / FinOps · §32 Dependency
& Supply-Chain · §33 Developer Experience & Inner Loop · §34 Architecture Governance & Documentation.

Some categories live most naturally in the DevOps/test chapters (§13–14, §17, §28, §29–34) and are
explained there. The coverage audit will include a matrix proving every one of the 34 is explained at
least once against real code or a real artifact.

**A note on §27, Internationalization & Localization.** `[Rubric §27, Internationalization &
Localization]` assesses externalized strings and culture-aware formatting. The original single-locale
stance (ADR-011) has been **superseded by ADR-027**: the framework now ships **two locales, en-US
(default) and Spanish (es)**. UI strings resolve through `IStringLocalizer<T>` over co-located `.resx`
files (the marker [`SharedResource`](group-15-common-ui-framework.md#sharedresource) anchors the shared
set), and **backend `Result` errors are localized server-side at the edge** keyed by the existing
`Error.Code` by [`ErrorLocalizer`](group-12-api-hosting-mapping.md#errorlocalizer) over per-module
[`ErrorResources`](group-12-api-hosting-mapping.md#errorresources) (English `Message` is the fallback;
`Code`/`Type` stay machine markers). One **culture cookie is the source of truth** across SSR / Blazor
Server / WASM, forwarded to services as `Accept-Language` by
[`CultureDelegatingHandler`](group-15-common-ui-framework.md#culturedelegatinghandler) and persisted to
`User.PreferredCulture`; the supported set is the allowlist
[`SupportedCultures`](group-12-api-hosting-mapping.md#supportedcultures). Where culture *would* introduce
bugs the code is still deliberately **culture-invariant**: identifier parsing uses
`CultureInfo.InvariantCulture` ([`DomainHelper`](group-02-domain-building-blocks.md#domainhelper),
`MMCA.Common/Source/Core/MMCA.Common.Shared/Extensions/DomainHelper.cs:43-47`). Culture-aware date/number
formatting is currently guarded only by an advisory analyzer suggestion (`MA0076`); a fitness-rule gate is
noted as follow-up in ADR-027.

**A note on §20, theming (day/dark).** Beyond the design tokens, **ADR-028** adds a day/dark mode:
[`ThemeService`](group-15-common-ui-framework.md#themeservice) binds `MudThemeProvider`'s
`@bind-IsDarkMode` to the already-defined `MMCATheme.PaletteDark`, persists the choice to cookie +
localStorage + `User.PreferredTheme`, and defaults to the OS `prefers-color-scheme`, reusing ADR-027's
cookie/profile persistence. Honest gap: the no-flash SSR bootstrap is **not yet wired for theme**, so a
first-paint flash is possible (stated, not yet remediated).

---

You're ready for [`group-01`, Result & Error Handling](group-01-result-error-handling.md).