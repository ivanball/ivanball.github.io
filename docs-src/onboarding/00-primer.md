# Primer, the concepts, stack, and conventions you need first

This chapter teaches the cross-cutting things **once**, so the per-type chapters can stay focused.
Read it before the group chapters (start with [`group-01`](group-01-result-error-handling.md)).
Everything here is either an architectural style the codebase commits to,
an external dependency (BCL/NuGet, "external Level 0"), a build/language convention, or the
architecture-evaluation lens the guide tags against. Later sections cross-reference back here.

---

## 1. The big picture

Two codebases are in scope:

- **`MMCA.Common`**: a **framework**, published as **fifteen NuGet packages** to nuget.org (the
  documented install path) and mirrored to GitHub Packages
  ([ADR-053](https://ivanball.github.io/docs/adr/053-dual-registry-package-publishing.html))
  (four core: `.Shared`, `.Domain`, `.Application`, `.Infrastructure`; five presentation: `.API`,
  `.Grpc`, `.UI`, `.UI.Maui`, `.UI.Web`; two Aspire: `.Aspire`, `.Aspire.Hosting`; four testing: `.Testing`, `.Testing.E2E`,
  `.Testing.UI`, `.Testing.Architecture`). It is *not* a runnable app; it ships the base classes and
  infrastructure for building modular monoliths with DDD + Clean Architecture + CQRS, plus the extension points
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
layers. The two host-support presentation packages sit above those: **`UI.Maui`** may reference
`UI` and `Shared` only, and **`UI.Web`** (the Blazor Web host bridge) references `UI`, `API`, and
`Aspire`, never `Domain`/`Application`/`Infrastructure` directly, which is why it disables transitive
project references and carries its own boundary check
(`MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets:90-123`).

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
  **decorator pipeline**: commands run
  `FeatureGate → Logging → Caching → Validating → Transactional → handler`, queries run
  `FeatureGate → Logging → Caching → handler` (no validation and no transaction on the read side).
  The order is set by the registrations in `AddApplicationDecorators`, which Scrutor's `TryDecorate`
  applies in **reverse**, so the last registered is the outermost
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:93-102`).
  Cross-cutting concerns live in the pipeline, not in each handler. First concrete code: the
  `ICommandHandler`/`IQueryHandler` contracts and their decorators in
  [`group-05`](group-05-cqrs-pipeline.md).

- **One shared HTTP middleware pipeline ([ADR-079](https://ivanball.github.io/docs/adr/079-shared-http-middleware-pipeline.html)).** The
  HTTP-side sibling of the decorator chain: every REST/gRPC service host builds its request pipeline
  from one `UseCommonMiddlewarePipeline` call, which fixes the middleware order once (exception
  handler through controllers) with the load-bearing adjacencies commented in code (authentication
  before the rate limiter and before tenant resolution, forwarded headers before both). Conditional
  middleware registers unconditionally and stays inert by config, so hosts differ by configuration,
  not by pipeline shape. Adopted by all seven ADC/Store service hosts, Helpdesk, and the template;
  the gateways and Blazor UI hosts sit deliberately outside it. First concrete code:
  [`group-12`](group-12-api-hosting-mapping.md).

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
  components in a `BlazorWebView` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MainPage.xaml:16`, wired by
  `AddMauiBlazorWebView()` in `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/MauiProgram.cs:64`). The only
  platform-specific code is tiny entry
  points (`App`/`AppDelegate`/`MainApplication`, `MauiProgram`). First concrete code: the MAUI
  bootstraps and host shells in [`group-25`](group-25-adc-host-composition.md); the supported
  device/browser matrix is in `MMCA.ADC/CLAUDE.md`.

- **Event-driven integration + the Outbox pattern.** When an aggregate changes, its domain events are
  serialized into an `OutboxMessage` row **in the same transaction** as the data, then a background
  processor delivers them at-least-once. This avoids the "save then publish and hope" dual-write bug.
  ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) "outbox dual-dispatch".)

- **Database-per-service.** Each module/service owns its own SQL database and its own outbox table;
  there is one concrete `SQLServerDbContext` class but **one instance per database**. Cross-source
  relationships auto-degrade (the FK is dropped, navigation flows through batch loaders), and the
  outbox is the cross-source consistency mechanism. ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html).)

- **Engine-agnostic entities, the storage provider is a one-token choice ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)).** A
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
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) plus the polyglot story ([ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)).
  *Adoption note (verified by source):* this is a real, **tested** capability that no entity routes
  to yet. Today **every entity configuration in ADC derives from the `…SQLServer` base** (ADC runs
  SQL Server only, four databases: `ADC_Identity`, `ADC_Conference`, `ADC_Engagement`,
  `ADC_Notification`, `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:32-35`), and the
  [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html) work shipped the full polyglot machinery (unified base,
  cross-source spec + fitness rule, Cosmos-index skip, SQLite `EnsureCreated`, Cosmos/SQLite Aspire
  helpers, portability tests). An end-to-end trial moving ADC Conference's `Session` to Cosmos and
  `Room` to SQLite was built and tested locally, then **deliberately reverted** to all-SQL-Server
  with every framework extension point kept. Treat Cosmos/SQLite as supported, exercised extension
  points, see the coverage audit's extension-point inventory.

- **The Result pattern.** Expected error paths use a `Result`/`Result<T>` return value carrying
  `Error`s, **not** exceptions. This is the single most pervasive idiom in the codebase, taught in
  full in [`group-01`](group-01-result-error-handling.md) (`ErrorType`, `Error`, `Result`).

- **Soft-delete + audit fields.** Entities are never hard-deleted; an `IsDeleted` flag plus EF global
  query filters exclude them. `CreatedOn/By` and `LastModifiedOn/By` are stamped centrally in
  `SaveChangesAsync`. For genuine erasure (GDPR/CCPA) there is a separate anonymize path. ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html).)
  Since [ADR-075](https://ivanball.github.io/docs/adr/075-audit-trail.html) the same idea extends to
  an opt-in field-level **audit trail**: a third `SaveChangesInterceptor`, registered last so it
  diffs freshly stamped values, writes per-property `AuditTrailEntries` in the same transaction as
  the data, with `[Pii]` values captured redacted (opt-in twice: `AddAuditTrail` plus an
  `IAuditedEntity` marker per entity; retention is an ADR-074 scheduled purge).

- **Multi-tenancy as a persistence-layer commitment ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)).**
  Tenancy is not per-handler filtering: a second **named** EF query filter, `"Tenant"`, composes by
  AND with the `"SoftDelete"` filter and embeds the executing tenant as a SQL parameter, so one
  cached model per source serves every tenant (a null tenant is the system context and sees all).
  `ITenantContext` resolves claim-then-header behind `TenantResolutionMiddleware`, a dedicated
  `SaveChangesInterceptor` stamps writes and refuses cross-tenant ones, the outbox drains per
  `(source, tenant)` pair, the caching decorators prefix keys with the tenant, and DB-per-tenant is
  a per-tenant connection-string override under the same `DataSourceKey`.
  *Adoption note (verified by source):* like the polyglot machinery above, this is a real, tested
  capability with one reference adopter: **MMCA.Helpdesk** runs it end to end, while **ADC and Store
  stay single-tenant** (the filter is inert without opt-in). First concrete code:
  [`group-07`](group-07-persistence-ef-core.md) (filters, interceptor) and
  [`group-12`](group-12-api-hosting-mapping.md) (resolution middleware).

- **Primitive identifier type aliases ([ADR-048](https://ivanball.github.io/docs/adr/048-primitive-identifier-type-aliases.html)).** Each entity's ID type is a per-module
  `global using XIdentifierType = int;` (or `= System.Guid;`) alias, linked into every project via
  `Directory.Build.props`. Code says `EventIdentifierType`, not bare `int`, so the ID type can change
  in one place: ADC's `SpeakerIdentifierType` is a `System.Guid` beside fourteen `int` siblings in
  the same file (`MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:18`, in
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/`).
  These are **aliases, not wrapper structs**: the alias is erased at compile time, so it buys
  readability and one-place change, not compile-time protection against passing the wrong same-typed
  ID. (The identifier-alias mechanism is covered with the entity contracts in
  [`group-02`](group-02-domain-building-blocks.md).)

### The decision records (ADRs) this guide tags

The *why* behind these patterns lives in the accepted ADRs (the Website repo's
`docs-src/adr/README.md` owns the count and range), version-controlled in
`Website/docs-src/adr/` and published at <https://ivanball.github.io/docs/adr/> (its `README.md` is the
canonical index with one-line summaries). Group chapters tag the relevant one inline (e.g. "[ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)");
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
| 011 | ~~en-US-only i18n is a deliberate non-goal~~ **superseded by [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)** (multi-locale en-US + es) | [g15](group-15-common-ui-framework.md) |
| 012 | gRPC host transport: both consumers now default to `Http2`-only h2c (Profile A); `Http1AndHttp2` survives on the WebSocket hosts only (ADC Notification, which adds a dedicated `Http2` gRPC endpoint beside it, and Store Sales) | [g16](group-16-aspire-orchestration.md)/[g20](group-20-conference-api-grpc.md) |
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
| 051 | Client-side auth token lifecycle across render modes: one `ITokenRefresher` with two head strategies (browser heads refresh through the same-origin proxy per ADR-022; MAUI refreshes directly and persists the rotated pair in OS SecureStorage) | [g15](group-15-common-ui-framework.md)/[g25](group-25-adc-host-composition.md) |
| 052 | Background job execution: work outliving a request runs as a bounded `Channel<T>` plus a `SingleReader` hosted drain, never an untracked `Task` from a controller, so the host can cancel and await it on shutdown; full mode encodes what the work is worth (`DropOldest` vs `Wait`) | [g23](group-23-engagement-live-layer.md) |
| 053 | Dual-registry package publishing: one tag pushes the same nupkgs to nuget.org (the documented install path) and GitHub Packages (mirror), authenticated keylessly through GitHub OIDC trusted publishing rather than a stored API key | [devops-cicd](devops-cicd.md) |
| 054 | Saga compensation + reconciliation backstop: each workflow step raises a domain event and its compensating action runs in its own handler and DI scope, committing after the originating transaction; idempotency is a persisted aggregate marker written by the same `SaveChanges` as the compensating writes | [g04](group-04-events-outbox.md) |
| 055 | Repository + Specification contract: the read side is ISP-split into `IEntityReader` (id lookups) and `IEntityQuerier` (collections, projections, counts), and a fitness rule fails the build on raw `IQueryable` surfaces in Application code | [g03](group-03-querying-specifications.md)/[g07](group-07-persistence-ef-core.md) |
| 056 | One render mode for the whole routable tree, chosen at the root on the shared `Routes` component: `InteractiveAuto` with prerendering left on, and the resulting SSR-to-interactive double fetch removed in `DataGridListPageBase` through `PersistentComponentState` rather than by weakening the mode | [g15](group-15-common-ui-framework.md) |
| 057 | Expand/contract schema evolution enforced in CI: adding columns, tables and indexes is safe in any release, while a migration added by a PR whose `Up()` drops one fails the merge check unless it carries an `EXPAND-CONTRACT-OVERRIDE` marker, because production rollback is revision-only and never un-migrates | [devops-cicd](devops-cicd.md)/[g07](group-07-persistence-ef-core.md) |
| 058 | Runtime conformance suites shipped in `MMCA.Common.Testing`: six abstract behavioral bases (problem details, OpenAPI, `/ServiceInfo` versioning, security headers, graceful shutdown, decorator order) that a host subclasses and that run against a really booted host, picking up where ADR-015's structural fitness tests stop | [g27](group-27-testing-infrastructure.md) |
| 059 | `IModule` is the one composition contract (five members, three defaulted): reflection discovery over the AppDomain, Kahn topological registration order, and a disabled module represented by null-object stub registrations rather than by absence | [g14](group-14-module-system-composition.md) |
| 060 | Performance-regression gate: a `performance-smoke` job runs the BenchmarkDotNet suite on every code PR and verifies it against a committed `perf-baseline.json` of absolute allocation ceilings plus benchmark-to-benchmark ratio floors; no absolute wall-clock threshold, since a shared runner cannot deliver one | [devops-cicd](devops-cicd.md) |
| 061 | Runtime secrets live in Azure Key Vault and reach each Container App as a `keyVaultUrl` reference resolved by one shared user-assigned managed identity, consumed only through `secretRef` (no inline values); SQL managed-identity auth is staged behind `useManagedIdentitySql`, still false by default | [devops-iac](devops-iac.md) |
| 062 | SLO alerting as code: `sloAlertSpecs` in each consumer's Bicep materializes KQL scheduled query rules (401/499 and hub traffic excluded) on one action group, and a framework test base pairs every alert with a severity-correct `OPERATIONS.md` triage section, failing the build in either direction | [devops-iac](devops-iac.md)/[g27](group-27-testing-infrastructure.md) |
| 063 | WCAG 2.1 AA as a shipped test contract: `AxeOptions.Wcag21Aa` pins the four WCAG tag sets and excludes axe's advisory rules, a violation throws instead of reporting, and the scan is a cross-browser required merge check in Common plus a chromium deploy gate in both apps | [g27](group-27-testing-infrastructure.md)/[devops-cicd](devops-cicd.md) |
| 064 | Deploy preconditions as proof of recency: `dr-freshness`, `load-freshness` and `cross-service-freshness` sit in `deploy.needs` and fail when the newest successful DR drill (8 days), k6 load run (35) or broker round-trip (5) is older than its window; no successful run at all fails too | [devops-cicd](devops-cicd.md) |
| 065 | Scaffolding templates derived from the reference app: the `dotnet new` pack `MMCA.Templates` (`mmca-app`/`mmca-module`/`mmca-command`/`mmca-query`) is staged at pack time from the MMCA.Helpdesk tree itself (no second copy to drift); generated apps ship `build/add-module.ps1`, which performs the seven wire-ups the template can only print, plus the first migration; a `template-smoke` CI job builds a generated app package-mode and sweeps for residual `Helpdesk`/`Ticket` tokens | [g14](group-14-module-system-composition.md)/[devops-cicd](devops-cicd.md) |
| 066 | Broker transport selection + dev/prod parity: one `IMessageBus` with three `MessageBusProvider` values (`InProcess` for tests and the monolith, RabbitMQ wired by the AppHost's `WithBroker` locally, Azure Service Bus injected by both apps' Bicep in production), identical exponential retry per transport, and a non-gating Service Bus emulator test tier proving the production binding | [g04](group-04-events-outbox.md)/[g16](group-16-aspire-orchestration.md) |
| 067 | Shared Blazor shell + `IUIModule` composition: the framework package ships the router, layout, nav menu and routable shell pages; each module contributes `NavItems`, an `Assembly` for `AdditionalAssemblies` route discovery, and app-bar/layout extension points, enumerated by `Routes.razor` at runtime (the UI-layer counterpart of ADR-059's `IModule`; Helpdesk keeps its own shell) | [g15](group-15-common-ui-framework.md)/[g25](group-25-adc-host-composition.md) |
| 068 | Value objects as validated domain primitives: seven sealed `record` types over an abstract `ValueObject` base, each a private constructor plus a `Result`-returning `Create` factory (fitness-enforced), mapped via `OwnsMoney` or value converters (no schema change); the deliberate opposite of ADR-048's identifier aliases (identifiers cross boundaries, domain values carry invariants) | [g02](group-02-domain-building-blocks.md) |
| 069 | Shared DataProtection key ring for scaled-out hosts: `AddCommonDataProtection` persists the key ring to one Azure blob under `DefaultAzureCredential` so cookies and antiforgery tokens minted by one replica decrypt on another; Key Vault at-rest encryption is a deliberately independent second gate, and absent config is a full no-op (adopted by ADC; Store still runs per-replica key rings) | [g16](group-16-aspire-orchestration.md)/[g08](group-08-auth.md) |
| 070 | Fail-fast configuration contract: every settings section binds through `AddOptions().Bind().ValidateDataAnnotations().ValidateOnStart()` so a misconfigured host refuses to boot instead of failing at first use; settings consumed above Infrastructure flow through read-only singleton facades (`IApplicationSettings`, `ISmtpSettings`, `IJwtSettings`) rather than `IOptions<T>` | [g12](group-12-api-hosting-mapping.md)/[g14](group-14-module-system-composition.md) |
| 071 | Barcode scanning + QR display, split by what each depends on: `QrCodeImage` is a plain shared component (QRCoder PNG as a data URI, no device needed), while camera reads go through `IBarcodeScannerService`, an ADR-042 capability (never throws, `null` = cancelled/denied/unsupported) with a TryAdd null fallback and a ZXing.Net.MAUI implementation, opt-in per head | [g26](group-26-device-capability-layer.md)/[g15](group-15-common-ui-framework.md) |
| 072 | QR badge check-in + points gamification (ADC): the badge QR carries an opaque server-verified `Guid` (revocable by one `Regenerate()`), one `CheckIn` aggregate with Event/Session/Sponsor scopes behind filtered unique indexes, and an append-only points ledger whose unique `(UserId, ActivityType, SubjectKey)` index is both the redelivery-idempotency guard and the anti-farming rule | [g22](group-22-engagement-module.md)/[g17](group-17-conference-domain.md) |
| 073 | Multi-tenancy (shared-schema + DB-per-tenant): a second named EF query filter `"Tenant"` composes by AND with `"SoftDelete"`; `ITenantContext` resolves claim-then-header behind `TenantResolutionMiddleware`, a dedicated interceptor stamps writes and refuses cross-tenant ones, and DB-per-tenant is a per-tenant connection-string override (Helpdesk is the reference adopter) | [g07](group-07-persistence-ef-core.md)/[g12](group-12-api-hosting-mapping.md) |
| 074 | Recurring job scheduler: durable multi-replica-safe cron built on the outbox claim-lease idiom (not Hangfire/Quartz); `IScheduledJob` resolved scoped per execution, a `ScheduledJobEntry` store on the Default source, Cronos parsing, smart-wait runner via `TimeProvider`; missed schedules run once then advance | [g04](group-04-events-outbox.md) |
| 075 | Audit trail: a third `SaveChangesInterceptor` (registered last, so it diffs freshly stamped values) writes per-property `AuditTrailEntries` in the **same transaction** as the data; opt-in twice (`AddAuditTrail` + `IAuditedEntity` per entity), `[Pii]` values captured redacted, retention via an ADR-074 scheduled purge | [g07](group-07-persistence-ef-core.md) |
| 076 | Data-subject export (DSAR) contract: `ExportUserDataHandlerBase` mirrors the delete handler's ownership gate, fans out to registered `IUserDataExportSection`s, and assembles a versioned JSON export; per-section failure degrades to `Available = false` rather than failing the request, because a DSAR is a legal deadline | [g24](group-24-identity-module.md)/[g12](group-12-api-hosting-mapping.md) |
| 077 | HybridCache substrate (amends 026): `AddCommonHybridCache` swaps `ICacheService` to L1 in-process + L2 distributed under a **disjoint `{prefix}hc:{key}` keyspace**, making the two-serialization-formats-in-one-keyspace failure impossible rather than unlikely; `IncrementAsync` bypasses L1 to keep counter semantics | [g09](group-09-caching.md) |
| 078 | CSV export as a dedicated `[HttpGet("export")]` endpoint on `EntityControllerBase`, not content negotiation (the output cache does not vary by `Accept`); page-loops the capped query pipeline and streams up to `MaxExportRows`, truncating with an `X-Export-Truncated` header; RFC 4180 writer in-house | [g12](group-12-api-hosting-mapping.md)/[g03](group-03-querying-specifications.md) |
| 079 | Shared HTTP middleware pipeline: `UseCommonMiddlewarePipeline` fixes one middleware order for every REST/gRPC host (exception handler through controllers), with the load-bearing adjacencies commented in code; conditional middleware registers unconditionally and stays inert by config (the ADR-014 decorator-order sibling, for the HTTP side) | [g12](group-12-api-hosting-mapping.md) |
| 080 | Rollout + automatic revision rollback: both consumer deploys end in a post-deploy smoke gate asserting expected status codes; on failure every container app walks back to its previous revision (`az containerapp revision copy`); rollback is revision-only by construction, schema is never reverted (ADR-030/057) | [devops-cicd](devops-cicd.md) |
| 081 | Cost baseline as a deploy gate: a read-only `cost-guard` workflow in `deploy.needs` asserts the production footprint still matches its baseline (replica caps + accepted SQL tiers), so an un-reverted manual surge blocks the next deploy; it never mutates anything | [devops-cicd](devops-cicd.md)/[devops-iac](devops-iac.md) |
| 082 | Two-tier cross-origin posture: service hosts get named allow-listed CORS policies from one `AddCommonCors` (origins from config, empty by default), selected inside the shared pipeline; the gateways get a default policy restricting only origins, because a reverse proxy must forward arbitrary client headers | [g12](group-12-api-hosting-mapping.md)/[g16](group-16-aspire-orchestration.md) |
| 083 | CRUD lifecycle event taxonomy: one `EntityChangedEvent<TId>` base (a `DomainEntityState` discriminator + the entity id) replaces per-entity Created/Updated/Deleted triples; business state-machine transitions deliberately keep their own event types, and the discriminator rides integration events as a frozen wire field | [g04](group-04-events-outbox.md)/[g02](group-02-domain-building-blocks.md) |
| 084 | Stripe webhook ingress contract (Store Sales): an anonymous raw-body POST verified by `Stripe-Signature` whose status code encodes ACCEPTED-vs-PROCESSED, not success/failure; 400 only when the event cannot be accepted at all, because rejections make Stripe retry and eventually disable the endpoint; post-acceptance failures log and return 200 with ADR-054's reconciliation as backstop | [g04](group-04-events-outbox.md)/[g12](group-12-api-hosting-mapping.md) |

The canonical index for the full set can be found at <https://ivanball.github.io/docs/adr/>.

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
  Note [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html) chose manual DTO mapping over reflection-based AutoMapper; Mapperly is the
  compile-time, allocation-free way to keep mapping explicit and fast.
- **Scrutor 7**: assembly scanning and **decorator registration** (`TryDecorate`) for DI; this is how
  the CQRS decorator pipeline is wired.
- **Microsoft.FeatureManagement 4.6**: feature flags (e.g. `Notification.PushNotifications`).
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
  (`MMCA.Common/Directory.Packages.props:49-56` carries the pin and the warning comment, and see §4).

**Transport (service extraction)**
- **Grpc.AspNetCore / Grpc.Net.ClientFactory / Grpc.Tools / Google.Protobuf**: gRPC server + client
  + `.proto` compilation, for synchronous inter-service calls between extracted modules ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)).

**UI**
- **MudBlazor 9.7.0**: the Blazor **component library** and design system (grids, dialogs, forms,
  theme). Used by both `MMCA.Common.UI` and the ADC UIs.
- **Microsoft.AspNetCore.Components.***: Blazor (Server + WebAssembly) runtime and authorization.
- **Polly 8** (via `Microsoft.Extensions.Http.Resilience`), retry/timeout/circuit-breaker resilience
  on outbound HTTP/gRPC clients.

**Hosting / observability (.NET Aspire)**
- **Aspire.Hosting 13.4.6** (+ RabbitMQ, Azure CosmosDB integrations), local **orchestration**: the
  AppHost spins up every service, database, broker, and a dashboard with one command.
- **OpenTelemetry** (Api/Exporter/Instrumentation) + **Azure.Monitor.OpenTelemetry.AspNetCore**,
  structured logs, distributed traces, and metrics, exported to Azure Application Insights.
- **Microsoft.Extensions.ServiceDiscovery**: resolves service names to endpoints (local and cloud).
- **AspNetCore.HealthChecks.***: Redis/RabbitMQ health probes.

**Auth / crypto**
- **System.IdentityModel.Tokens.Jwt 8**: JWT creation/validation; JWKS key publishing for
  cross-service token validation ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html) "authentication dual-fetch").

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
- **Microsoft.Playwright 1.61** + **Deque.AxeCore.Playwright 4.12**: browser E2E and **axe-core**
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
  namespaces (`csharp_style_namespace_declarations = file_scoped:error`, line 102), braces always
  required (`csharp_prefer_braces = true:error`, line 138), `var` only when the type is apparent
  (lines 105-107), expression-bodied members preferred (lines 110-117), all accessibility modifiers
  required (line 73), no `this.` qualification (lines 57-60), `readonly` where possible (line 94),
  interfaces begin with `I` (error, line 212). The naming rules below that (private fields
  `_camelCase`, constants `PascalCase`) are declared at `warning`, which `TreatWarningsAsErrors`
  promotes to a build break anyway. Test files relax method-naming and complexity rules via the
  `[Tests/**/*.cs]` section (line 737).

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
   `MMCA.Common.*` project under `Source/` (`MMCA.Common/Directory.Build.props:99-100`), inspects
   `ProjectReference`s before build and **fails** with a descriptive error if a layer references a
   forbidden upstream layer.
2. **Runtime (test)**, `Tests/Architecture/MMCA.Common.Architecture.Tests` (NetArchTest) asserts the
   same rules against compiled assemblies: layer flow, **domain purity**, and **microservice
   extraction** rules (e.g. *Application/Domain/Shared must never reference MassTransit directly*,
   depend on `IMessageBus` instead). The rule bodies themselves now live once in the shipped
   **`MMCA.Common.Testing.Architecture`** package (the 13th of the fifteen): a reusable rule library +
   abstract `*TestsBase` classes that each repo's arch-test project subclasses, supplying only a
   repo-specific `IArchitectureMap`, so `MMCA.Common` and `MMCA.ADC` (and, outside this guide's
   scope, MMCA.Store and MMCA.Helpdesk) all enforce one rule set
   ([ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html)).

When you move a type between packages, expect *both* gates to react. This is the codebase's
"executable governance", covered fully in the architecture-tests chapter.

---

## 5. The solution / test layout

- **`*.slnx`**: the human solution (XML format). `*.slnf`, a **solution filter** used in CI to build
  a subset fast (`MMCA.Store.CI.slnf`, `MMCA.ADC.CI.slnf`).
- **Microsoft Testing Platform**, not VSTest. To run one test class/method you target the test
  project and pass an MTP filter after `--`:
  ```bash
  dotnet test --project Tests/<path>/<Name>.Tests.csproj -- --filter-method "*Pattern*"
  #                                                      -- --filter-class  "*FooTests*"
  ```
  Always `--project <csproj>`, never a bare path, and get the flag right: a wrong filter flag exits
  5 having run zero tests instead of erroring out loudly. Every test project must contain at least
  one test or MTP exits 8, so CI passes `--minimum-expected-tests` on every run: `1` on the ADC legs
  (`MMCA.ADC/.github/workflows/deploy.yml:219`) and `2000` on MMCA.Common's full solution run, where
  the point is to fail a discovery regression that silently drops thousands of tests
  (`MMCA.Common/.github/workflows/ci.yml:144`).
- Some UI test projects (`MMCA.Common.UI.Gallery`, `MMCA.Common.UI.E2E.Tests`) are **deliberately
  excluded** from the `.slnx` so the unit-test run stays fast; they run in a dedicated CI job and are
  built by csproj path.

---

## 6. The 34-category architecture-evaluation lens

This codebase is also scored against a **34-category rubric**
(`Website/docs-src/governance/ArchitectureEvaluationCriteria.md`, published at
<https://ivanball.github.io/docs/governance/>).
This guide **weaves the rubric in** so you learn the system *and* the lens it's judged by at the same
time. Each type section tags the categories it genuinely touches as **`[Rubric §N, Name]`**, with a
one-line "what §N assesses" and "how this code embodies (or under-uses) it". The first occurrence of a
category teaches it; later ones cross-reference back. **The guide explains categories; it does not
score them**, the filled scorecards live beside the rubric as one repo-prefixed file per repo
(`Website/docs-src/governance/common-ArchitectureScorecard.md`, `adc-ArchitectureScorecard.md`,
`store-ArchitectureScorecard.md`), each paired with a `*-RemediationBacklog.md`.

### Two axes (so a tag can say "mature but mediocre" or vice-versa)

- **Maturity (0 to 4)**, *process*: how consistently/automatically the pattern is governed
  (ad-hoc → enforced by CI).
- **Implementation (0 to 10)**, *substance*: how good the implementation is right now, against the
  category's criteria and red flags.

### The categories, in three parts (quick index, full criteria in the rubric file)

**Part A, Application / Backend (§1 to §17):** §1 SOLID · §2 Design Patterns · §3 Clean Architecture ·
§4 Domain-Driven Design · §5 Vertical Slice · §6 CQRS & Event-Driven · §7 Microservices Readiness ·
§8 Data Architecture · §9 API & Contract Design · §10 Cross-Cutting Concerns · §11 Security ·
§12 Performance & Scalability · §13 Observability & Operability · §14 Testability & Test Strategy ·
§15 Best Practices & Code Quality · §16 Maintainability & Evolvability · §17 DevOps & Deployment.

**Part B, Front-End / UI (§18 to §28):** §18 UI Architecture & Component Design · §19 State Management &
Data Flow · §20 Design System, Theming & UI Consistency · §21 Accessibility (a11y) · §22 Responsive
Design & Cross-Browser/Device · §23 Front-End Performance & Rendering · §24 Forms, Validation & UX Safety ·
§25 Navigation, Routing & Information Architecture · §26 Front-End Security · §27 Internationalization
& Localization · §28 Front-End Testing & Quality.

**Part C, Operational, Governance & Cross-Cutting (§29 to §34):** §29 Resilience, Reliability & Business
Continuity · §30 Compliance, Privacy & Data Governance · §31 Cost Efficiency / FinOps · §32 Dependency
& Supply-Chain Management · §33 Developer Experience & Inner Loop · §34 Architecture Governance &
Documentation.

Some categories live most naturally in the DevOps/test chapters (§13 to §14, §17, §28, §29 to §34) and are
explained there. The coverage audit will include a matrix proving every one of the 34 is explained at
least once against real code or a real artifact.

---

You're ready for [`group-01`, Result & Error Handling](group-01-result-error-handling.md).