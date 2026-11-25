# Phase 1b - Functional Group Taxonomy

This is the **primary axis** of the guide. Every one of the **8,100** distinct first-party type
nodes from [`00-inventory.md`](00-inventory.md) is assigned to **exactly one** functional group -
its primary *home*: the capability or cross-cutting concern it most exists to serve. A type used
across many groups (e.g. `Result<T>`, the entity base) lives in the one foundational group that
owns it and is cross-linked from everywhere else.

**Two axes work together.** The *top level* (these groups, and the order of `group-NN-*.md`
chapters) is **functional**. The *ordering inside* each group is by **dependency Level** (the
longest-path layering computed in [`00-dependency-manifest.md`](00-dependency-manifest.md)): within
a chapter you meet a type only after the first-party types it depends on. Membership tables below
are therefore sorted **ascending by Level**, then by name.

**Group ordering** runs roughly topologically over groups: foundational, widely-depended-on
concerns first (Result -> domain blocks -> querying -> events -> CQRS -> ...), then the ASP.NET/UI/
Aspire edges, then the `MMCA.ADC` business modules that build on all of it, and finally the test
infrastructure. Because `MMCA.ADC` consumes the `MMCA.Common` packages, Common-owned groups precede
the ADC capabilities. Where a type must reference a first-party type whose home group appears
*later*, that forward reference is allowed (functional cohesion can outrank strict progressive
disclosure) and is cross-linked in the chapter.

## Design notes (boundary decisions worth stating up front)

- **Cycles are kept whole.** The 13 dependency cycles (SCCs) from the manifest are never split
  across groups. Notably the `ApplicationDbContext` <-> `AuditSaveChangesInterceptor` <->
  `DomainEventSaveChangesInterceptor` <-> `DataSourceModelCacheKeyFactory` cycle lives wholly in
  **G07 Persistence**, even though the domain-event interceptor conceptually belongs to events
  (G04) - it is cross-linked. The DDD aggregate nav-cycles (Event/Session/Speaker/Category) live in
  **G17 Conference Domain**.
- **Soft-delete / audit / privacy is taught, not isolated.** Rather than a thin group that would
  fragment the entity bases and the DbContext cycle, the data-lifecycle concern is taught where its
  machinery lives: the markers + audit fields + `PiiAttribute` + `IAnonymizable` in **G02**, the
  audit interceptor + soft-delete query filter + anonymization in **G07**, and GDPR export/erasure
  use cases in **G23 Identity**. (`[Rubric S8, S30]`)
- **ADC is grouped by bounded context (vertical slice), not by layer.** Each ADC module spans
  Domain->Application->Infrastructure->API->UI; the large Conference module is split into five
  chapters (G17-G21) by layer for size, smaller modules (Engagement, Identity) are one chapter each.
  ADC implementations of Common patterns (a specific navigation populator, validator, mapper) stay
  in their module group and cross-link back to the Common pattern group.
- **The Common UI framework is kept cohesive (G15).** Auth/navigation/notification *UI* services
  under `MMCA.Common.UI.*` stay together as reusable UI building blocks and cross-link to the
  capability groups (G08/G10/G11), rather than being scattered.
- **Notifications is one capability (G10)** spanning Common Domain/Application/Infrastructure/API/
  Shared plus the thin `MMCA.ADC.Notification` module host.
- **Tests (G25).** All `*.Tests` / `*.IntegrationTests` / `*.E2E.Tests` projects, the reusable
  `MMCA.Common.Testing[.E2E|.UI]` bases, and the component `Gallery` harness form one group. Per the
  TESTS note, individual `[Fact]`s are **not** sectioned; the chapter walks the reusable bases/
  fixtures/builders and the architecture-fitness tests, and rolls the rest up by project. The full
  per-class list remains in [`00-inventory.md`](00-inventory.md). This is a logged exception.

## The groups (ordered)

| # | Group (chapter) | Types | Levels | Charter |
|---|-----------------|-------|--------|---------|
| G01 | **Result & Error Handling**<br/>group-01-result-error-handling.md | 21 | L0-L3 | The Result/Error railway that every operation returns instead of throwing; pagination result shapes. |
| G02 | **Domain Building Blocks (Entities, Value Objects, Aggregates)**<br/>group-02-domain-building-blocks.md | 39 | L0-L5 | The DDD primitives: entity/aggregate base classes, audit fields, value objects + invariants, domain markers, attributes, identifier aliases. |
| G03 | **Querying: Specifications, Filtering & the Entity Query Service**<br/>group-03-querying-specifications.md | 45 | L0-L8 | Composable read-side: the Specification pattern, dynamic filtering/sorting/paging, and the generic entity query pipeline. |
| G04 | **Domain & Integration Events + Outbox Dual-Dispatch**<br/>group-04-events-outbox.md | 91 | L0-L16 | Event contracts, the domain-event dispatcher, the transactional outbox/inbox, and the in-process + broker message buses. |
| G05 | **CQRS: Commands, Queries & the Decorator Pipeline**<br/>group-05-cqrs-pipeline.md | 64 | L0-L11 | The command/query handler abstraction and the cross-cutting decorator pipeline (logging, transaction, caching, feature-gate, idempotency) wrapping it. |
| G06 | **Validation**<br/>group-06-validation.md | 26 | L0-L9 | The FluentValidation-based validation contracts and failure mapping that gate commands before they execute. |
| G07 | **Persistence & EF Core**<br/>group-07-persistence-ef-core.md | 202 | L0-L14 | The single SQLServerDbContext over the abstract ApplicationDbContext, interceptors, repositories, specifications evaluation, data-source routing (database-per-service), conventions, value generators, encryption, factories and design-time. |
| G08 | **Authentication & Authorization**<br/>group-08-auth.md | 267 | L0-L10 | JWT/JWKS dual-fetch token validation, current-user/claims, password hashing, cookie sessions, and policy/authorization plumbing. |
| G09 | **Caching**<br/>group-09-caching.md | 12 | L0-L5 | The cache abstraction and its decorator-driven, invalidation-aware integration into the query pipeline. |
| G10 | **Notifications (Push + In-App Inbox + Email)**<br/>group-10-notifications.md | 58 | L0-L10 | The notification subsystem: push (SignalR), the in-app inbox, email sending, recipient providers, and the thin ADC Notification module host. |
| G11 | **Navigation Metadata & Populators (EF-decoupled eager loading)**<br/>group-11-navigation-populators.md | 12 | L0-L9 | INavigationMetadata/INavigationPopulator and the loader that hydrate cross-container/cross-source relationships without EF Include coupling ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)). |
| G12 | **API Hosting, Middleware, Idempotency & DTO/Contract Mapping**<br/>group-12-api-hosting-mapping.md | 151 | L0-L13 | The ASP.NET Core edge: controller bases, middleware, startup, model binders, JSON converters, feature management, idempotency, correlation, and manual DTO/request mapping. |
| G13 | **gRPC & Inter-Service Contracts**<br/>group-13-grpc-contracts.md | 17 | L0-L4 | Typed gRPC clients/servers, interceptors, Result-over-the-wire, and the ServiceContract marker for synchronous inter-service calls ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)). |
| G14 | **Module System, Composition & Configuration**<br/>group-14-module-system-composition.md | 138 | L0-L14 | IModule discovery + Kahn-ordered ModuleLoader, the DI composition roots, assembly markers, data-source/database attributes, and options/settings binding. |
| G15 | **Common UI Framework (MudBlazor components, theme, base pages)**<br/>group-15-common-ui-framework.md | 309 | L0-L10 | Reusable Blazor building blocks: the data-grid list page base, theme, common pages/services, and UI extensions shared by every consumer app. |
| G16 | **Aspire Orchestration & Service Defaults**<br/>group-16-aspire-orchestration.md | 89 | L0-L5 | The Aspire AppHost wiring, ServiceDefaults, warmup, telemetry and security helpers that compose and run the distributed app locally and in Azure. |
| G17 | **ADC Conference - Domain Model & Module Contracts**<br/>group-17-conference-domain.md | 121 | L0-L9 | The Conference bounded context: Event/Session/Speaker/Category/Question aggregates, their domain events and invariants, plus the Shared identifiers/DTOs/integration-event contracts. |
| G18 | **ADC Conference - Application & Use Cases**<br/>group-18-conference-application.md | 373 | L0-L12 | Conference CQRS handlers, validators, DTOs, specifications, the Sessionize import, and the session-selection decision-support analytics. |
| G19 | **ADC Conference - Infrastructure & Persistence**<br/>group-19-conference-infrastructure.md | 29 | L0-L11 | The Conference module DbContext registration, EF entity configurations, database seeding, and infrastructure services. |
| G20 | **ADC Conference - API, gRPC Contracts & Service Host**<br/>group-20-conference-api-grpc.md | 72 | L0-L12 | Conference REST controllers, the .Contracts gRPC surface, the extractable service host, and the gRPC adapter. |
| G21 | **ADC Conference - UI**<br/>group-21-conference-ui.md | 170 | L0-L11 | The Conference Blazor pages (events, sessions, speakers, categories, questions, rooms, feedback, public, session-selection) and their UI services. |
| G22 | **ADC Engagement Module (Session Bookmarks)**<br/>group-22-engagement-module.md | 341 | L0-L13 | The Engagement bounded context end-to-end: bookmark aggregate, use cases, persistence, API/contracts/service, and feedback UI. |
| G26 | **ADC Engagement Live Layer (Real-Time Polls & Session Q&A)**<br/>group-23-engagement-live-layer.md | 88 | L0-L11 | Real-time audience interaction in the Engagement bounded context: event-wide live polls with voting and moderated per-session Q&A with upvoting, over the SignalR hub-channel transport ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)) and the cross-service gRPC live-channel adapter. |
| G23 | **ADC Identity Module (Users, Profiles, GDPR Export/Erasure)**<br/>group-24-identity-module.md | 150 | L0-L14 | The Identity bounded context end-to-end: the User aggregate, change-password/delete/export use cases, persistence, API/contracts/service, and profile/user UI. |
| G24 | **ADC Application Host, UI Shell & Cross-Module Composition**<br/>group-25-adc-host-composition.md | 17 | L0-L13 | The ADC host: the Blazor Web/WASM/WinUI shells, host pages/services, security, and the cross-module application composition. |
| G27 | **Device Capability Abstraction Layer (Native Contracts, MAUI, Browser & Fallback Adapters)**<br/>group-26-device-capability-layer.md | 112 | L0-L4 | Per-capability interface contracts (biometric, geocoding/geolocation, speech, push registration, media/clipboard/screenshot, haptics, share, external auth/links, local cache/notifications, connectivity/battery/accessibility, deep links) plus their MAUI-native, browser-JS-interop, and inert fallback implementations, selected per host at DI composition time ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)/043/044/045). |
| G28 | **Common AI Integration**<br/>group-27-common-ai-integration.md | 46 | L0-L6 | The AI provider settings, bounded/metered chat client wrapper, and prompt contract types used to integrate LLM calls into Common-based apps. |
| G29 | **Common Cloud Provider Adapters (AWS, Azure, GCP)**<br/>group-28-common-cloud-provider-adapters.md | 119 | L0-L8 | Vendor-specific cloud adapters in MMCA.Common.Aws, .Azure and .Gcp (messaging transports, native push, file storage, secrets, database IAM auth, data protection, telemetry) that implement the provider-neutral Common abstractions. |
| G25 | **Testing & Quality Infrastructure**<br/>group-29-testing-infrastructure.md | 4921 | L0-L19 | All test projects + the reusable Testing/Testing.E2E/Testing.UI bases, architecture-fitness tests, and the component Gallery harness; individual [Fact]s are rolled up by project (logged exception). |

**Reconciliation:** 3179 production types across 28 groups + 4921 test/testing types in G25 = **8100** (matches the inventory's distinct-node count). No type appears twice; none dropped.

---

## Group membership

### G01 - Result & Error Handling

> `group-01-result-error-handling.md` | 21 types | The Result/Error railway that every operation returns instead of throwing; pagination result shapes.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `CollectionResult<T>` | record | MMCA.Common.Shared.Abstractions |
| 0 | `CsvRow` | class | MMCA.Common.Shared.Serialization |
| 0 | `DomainException` | class | MMCA.Common.Shared.Exceptions |
| 0 | `EntityChange<TEntityDTO, TIdentifierType>` | record | MMCA.Common.Shared.Abstractions |
| 0 | `ErrorType` | enum | MMCA.Common.Shared.Abstractions |
| 0 | `KeysetCursor` | class | MMCA.Common.Shared.Abstractions |
| 0 | `KeysetPageRequest` | record | MMCA.Common.Shared.Abstractions |
| 0 | `PaginationMetadata` | record | MMCA.Common.Shared.Abstractions |
| 0 | `PropertyReader` | delegate | MMCA.Common.Shared.Serialization |
| 1 | `CsvTable` | class | MMCA.Common.Shared.Serialization |
| 1 | `DomainInvariantViolationException` | class | MMCA.Common.Shared.Exceptions |
| 1 | `Error` | record | MMCA.Common.Shared.Abstractions |
| 1 | `KeysetCollectionResult<T>` | record | MMCA.Common.Shared.Abstractions |
| 1 | `PagedCollectionResult<T>` | record | MMCA.Common.Shared.Abstractions |
| 1 | `Parser` | class | MMCA.Common.Shared.Serialization |
| 2 | `ErrorTypeSeverity` | class | MMCA.Common.Shared.Abstractions |
| 2 | `Result` | class | MMCA.Common.Shared.Abstractions |
| 2 | `ResultConverter` | class | MMCA.Common.Shared.Serialization |
| 2 | `ResultJsonConverterFactory` | class | MMCA.Common.Shared.Serialization |
| 3 | `CsvReader` | class | MMCA.Common.Shared.Serialization |
| 3 | `ResultExtensions` | class | MMCA.Common.Shared.Abstractions |

### G02 - Domain Building Blocks (Entities, Value Objects, Aggregates)

> `group-02-domain-building-blocks.md` | 39 types | The DDD primitives: entity/aggregate base classes, audit fields, value objects + invariants, domain markers, attributes, identifier aliases.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `DomainEntityState` | enum | MMCA.Common.Domain.Enums |
| 0 | `DomainHelper` | class | MMCA.Common.Shared.Extensions |
| 0 | `EventNameAttribute` | class | MMCA.Common.Domain.Attributes |
| 0 | `IAuditableEntity` | interface | MMCA.Common.Domain.Interfaces |
| 0 | `IAuditedEntity` | interface | MMCA.Common.Domain.Interfaces |
| 0 | `IBaseEntity<TIdentifierType>` | interface | MMCA.Common.Domain.Interfaces |
| 0 | `IdValueGeneratedAttribute` | class | MMCA.Common.Domain.Attributes |
| 0 | `IHasOrderingKey` | interface | MMCA.Common.Domain.Interfaces |
| 0 | `IRowVersioned` | interface | MMCA.Common.Domain.Interfaces |
| 0 | `ITenantEntity` | interface | MMCA.Common.Domain.Interfaces |
| 0 | `PiiAttribute` | class | MMCA.Common.Domain.Attributes |
| 0 | `RedactableProperty` | class | MMCA.Common.Domain.Privacy |
| 0 | `SensitiveAttribute` | class | MMCA.Common.Domain.Attributes |
| 0 | `UsPostalRegion` | record | MMCA.Common.Shared.ValueObjects.Contact |
| 0 | `ValueObject` | record | MMCA.Common.Shared.ValueObjects |
| 1 | `BaseEntity<TIdentifierType>` | class | MMCA.Common.Domain.Entities |
| 1 | `EntityTypeExtensions` | class | MMCA.Common.Domain.Extensions |
| 1 | `IAggregateRoot` | interface | MMCA.Common.Domain.Interfaces |
| 1 | `PiiRedactor` | class | MMCA.Common.Domain.Privacy |
| 1 | `UsPostalRegions` | class | MMCA.Common.Shared.ValueObjects.Contact |
| 3 | `Address` | record | MMCA.Common.Shared.ValueObjects.Contact |
| 3 | `AddressInvariants` | class | MMCA.Common.Shared.ValueObjects.Contact |
| 3 | `AuditableBaseEntity<TIdentifierType>` | class | MMCA.Common.Domain.Entities |
| 3 | `Currency` | record | MMCA.Common.Shared.ValueObjects.Financial |
| 3 | `CurrencyJsonConverter` | class | MMCA.Common.Shared.ValueObjects.Financial |
| 3 | `DateRange` | record | MMCA.Common.Shared.ValueObjects.Time |
| 3 | `DateTimeRange` | record | MMCA.Common.Shared.ValueObjects.Time |
| 3 | `EmailInvariants` | class | MMCA.Common.Shared.ValueObjects.Contact |
| 3 | `Enumeration<TEnumeration>` | class | MMCA.Common.Shared.ValueObjects |
| 3 | `EnumerationConverter<TEnumeration>` | class | MMCA.Common.Shared.ValueObjects |
| 3 | `EnumerationJsonConverterFactory` | class | MMCA.Common.Shared.ValueObjects |
| 3 | `IAnonymizable` | interface | MMCA.Common.Domain.Interfaces |
| 3 | `IReactivatable` | interface | MMCA.Common.Domain.Interfaces |
| 3 | `PhoneNumberInvariants` | class | MMCA.Common.Shared.ValueObjects.Contact |
| 4 | `AuditableAggregateRootEntity<TIdentifierType>` | class | MMCA.Common.Domain.Entities |
| 4 | `Email` | record | MMCA.Common.Shared.ValueObjects.Contact |
| 4 | `Money` | record | MMCA.Common.Shared.ValueObjects.Financial |
| 4 | `PhoneNumber` | record | MMCA.Common.Shared.ValueObjects.Contact |
| 5 | `CommonInvariants` | class | MMCA.Common.Domain.Invariants |

### G03 - Querying: Specifications, Filtering & the Entity Query Service

> `group-03-querying-specifications.md` | 45 types | Composable read-side: the Specification pattern, dynamic filtering/sorting/paging, and the generic entity query pipeline.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AmbientScope` | class | MMCA.Common.Application.Services.Query |
| 0 | `BestEffortLog` | class | MMCA.Common.Application.Services |
| 0 | `BestEffortMetrics` | class | MMCA.Common.Application.Services |
| 0 | `DynamicQueryConfig` | class | MMCA.Common.Application.Services.Filtering |
| 0 | `FilterValueParser` | class | MMCA.Common.Application.Services.Filtering |
| 0 | `IFilterStrategy` | interface | MMCA.Common.Application.Services.Filtering |
| 0 | `Needle` | record | MMCA.Common.Application.Services.Filtering.ValueObjects |
| 0 | `OrderExpression` | record | MMCA.Common.Domain.Specifications |
| 0 | `PagingMath` | class | MMCA.Common.Application.Services.Query |
| 0 | `ParameterReplacer` | class | MMCA.Common.Domain.Specifications |
| 0 | `PropertyAccessor` | record struct | MMCA.Common.Application.Services |
| 0 | `QueryFieldContract` | class | MMCA.Common.Application.Services.Query |
| 1 | `BestEffort` | class | MMCA.Common.Application.Services |
| 1 | `BoolFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 1 | `DateTimeFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 1 | `DecimalFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 1 | `EntityQueryParameters<TEntity>` | record | MMCA.Common.Application.Services.Query |
| 1 | `GuidFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 1 | `IntFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 1 | `ISpecification<TEntity, TIdentifierType>` | interface | MMCA.Common.Domain.Interfaces |
| 1 | `LongFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 1 | `QueryTagScope` | class | MMCA.Common.Application.Services.Query |
| 1 | `StringFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 2 | `Specification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 3 | `EventUpcasterRegistry` | class | MMCA.Common.Application.Services |
| 3 | `InlineSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 3 | `QueryFieldService` | class | MMCA.Common.Application.Services |
| 3 | `QuerySpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 3 | `StronglyTypedIdFilterStrategy<TSelf, TValue>` | class | MMCA.Common.Application.Services.Filtering |
| 4 | `IEntityQueryPipeline` | interface | MMCA.Common.Application.Services.Query |
| 4 | `INavigationMetadataProvider` | interface | MMCA.Common.Application.Services.Query |
| 4 | `OwnedByUserSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 4 | `SpecificationComposer` | class | MMCA.Common.Domain.Specifications |
| 5 | `AndSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 5 | `EmailFilterStrategy` | class | MMCA.Common.Application.Services.Filtering.ValueObjects |
| 5 | `IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Mapping |
| 5 | `NavigationMetadataProvider` | class | MMCA.Common.Application.Services.Query |
| 5 | `NotSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 5 | `OrSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 6 | `ChangeFeedSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Application.Services.Query |
| 6 | `QueryFilterService` | class | MMCA.Common.Application.Services.Filtering |
| 6 | `SpecificationExtensions` | class | MMCA.Common.Domain.Specifications |
| 7 | `EntityQueryPipeline` | class | MMCA.Common.Application.Services.Query |
| 8 | `CrossSourceSpecification` | class | MMCA.Common.Application.Specifications |
| 8 | `EntityQueryService<TEntity, TEntityDTO, TIdentifierType>` | class | MMCA.Common.Application.Services |

### G04 - Domain & Integration Events + Outbox Dual-Dispatch

> `group-04-events-outbox.md` | 91 types | Event contracts, the domain-event dispatcher, the transactional outbox/inbox, and the in-process + broker message buses.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `CreateWebhookSubscriptionRequest` | record | MMCA.Common.Shared.Webhooks |
| 0 | `IDomainEvent` | interface | MMCA.Common.Domain.Interfaces |
| 0 | `IInboxStore` | interface | MMCA.Common.Infrastructure.Persistence.Inbox |
| 0 | `InboxDisabledWarningService` | class | MMCA.Common.Infrastructure.Persistence.Inbox |
| 0 | `InboxMessage` | class | MMCA.Common.Infrastructure.Persistence.Inbox |
| 0 | `IOutboxSignal` | interface | MMCA.Common.Infrastructure.Persistence.Outbox.Processing |
| 0 | `IWebhookDnsResolver` | interface | MMCA.Common.Infrastructure.Webhooks |
| 0 | `OutboxCycleResult` | record struct | MMCA.Common.Infrastructure.Persistence.Outbox.Processing |
| 0 | `OutboxDisabledNoticeService` | class | MMCA.Common.Infrastructure.Persistence.Outbox.Administration |
| 0 | `OutboxOrigin` | record struct | MMCA.Common.Infrastructure.Persistence.Outbox |
| 0 | `ProcessTimeout` | record | MMCA.Common.Domain.ProcessManagers |
| 0 | `ProcessTimeoutHandling` | enum | MMCA.Common.Application.ProcessManagers |
| 0 | `ProcessTimeoutOutcome` | enum | MMCA.Common.Domain.ProcessManagers |
| 0 | `UpdateWebhookSubscriptionRequest` | record | MMCA.Common.Shared.Webhooks |
| 0 | `WebhookDeliveryId` | class | MMCA.Common.Application.Webhooks.Delivery |
| 0 | `WebhookDeliveryRequest` | record | MMCA.Common.Application.Webhooks.Delivery |
| 0 | `WebhookEnvelope` | class | MMCA.Common.Application.Webhooks.Delivery |
| 0 | `WebhookErrorCodes` | class | MMCA.Common.Application.Webhooks |
| 0 | `WebhookEventRegistration` | record | MMCA.Common.Application.Webhooks |
| 0 | `WebhookSendStatus` | enum | MMCA.Common.Application.Webhooks.Delivery |
| 0 | `WebhookSettings` | class | MMCA.Common.Application.Webhooks |
| 0 | `WebhookSubscriptionResponse` | record | MMCA.Common.Shared.Webhooks |
| 0 | `WebhookTargetRefusedException` | class | MMCA.Common.Infrastructure.Webhooks |
| 1 | `BaseDomainEvent` | record | MMCA.Common.Domain.DomainEvents |
| 1 | `EventNameResolver` | class | MMCA.Common.Infrastructure.Persistence.Outbox.Processing |
| 1 | `IDomainEventDispatcher` | interface | MMCA.Common.Application.Interfaces.Events |
| 1 | `IDomainEventHandler<in TDomainEvent>` | interface | MMCA.Common.Application.Interfaces.Events |
| 1 | `IIntegrationEvent` | interface | MMCA.Common.Domain.Interfaces |
| 1 | `NoOpInboxStore` | class | MMCA.Common.Infrastructure.Persistence.Inbox |
| 1 | `OutboxMetrics` | class | MMCA.Common.Infrastructure.Persistence.Outbox.Processing |
| 1 | `OutboxSignal` | class | MMCA.Common.Infrastructure.Persistence.Outbox.Processing |
| 1 | `SystemWebhookDnsResolver` | class | MMCA.Common.Infrastructure.Webhooks |
| 1 | `WebhookConnectCallback` | class | MMCA.Common.Infrastructure.Webhooks |
| 1 | `WebhookEventCatalog` | class | MMCA.Common.Application.Webhooks |
| 1 | `WebhookInsecureTargets` | class | MMCA.Common.Infrastructure.Webhooks |
| 1 | `WebhookSendOutcome` | record | MMCA.Common.Application.Webhooks.Delivery |
| 1 | `WebhookSubscriptionSecretResponse` | record | MMCA.Common.Shared.Webhooks |
| 2 | `BaseIntegrationEvent` | record | MMCA.Common.Domain.DomainEvents |
| 2 | `EntityChangedEvent<TIdentifierType>` | record | MMCA.Common.Domain.DomainEvents |
| 2 | `IEventBus` | interface | MMCA.Common.Application.Interfaces.Events |
| 2 | `IIntegrationEventHandler<in TIntegrationEvent>` | interface | MMCA.Common.Application.Interfaces.Events |
| 2 | `IMessageBus` | interface | MMCA.Common.Application.Messaging |
| 2 | `InsecureWebhookTargetsNoticeService` | class | MMCA.Common.Infrastructure.Webhooks |
| 2 | `IWebhookSender` | interface | MMCA.Common.Application.Webhooks.Delivery |
| 2 | `OutboxMessage` | class | MMCA.Common.Infrastructure.Persistence.Outbox |
| 2 | `OutboxSettings` | class | MMCA.Common.Infrastructure.Persistence.Outbox.Administration |
| 2 | `ProcessStepFailedException` | class | MMCA.Common.Application.ProcessManagers |
| 2 | `ProcessTimeoutDecision` | record | MMCA.Common.Domain.ProcessManagers |
| 2 | `ProcessTimeoutReport<TProcessId>` | record | MMCA.Common.Application.ProcessManagers |
| 2 | `SafeDomainEventHandler<TDomainEvent>` | class | MMCA.Common.Application.DomainEvents |
| 3 | `ClaimedBatch` | class | MMCA.Common.Infrastructure.Persistence.Outbox.Processing |
| 3 | `DomainEventDispatcher` | class | MMCA.Common.Application.Services |
| 3 | `InProcessMessageBus` | class | MMCA.Common.Infrastructure.Messaging |
| 3 | `IWebhookSecretProtector` | interface | MMCA.Common.Application.Webhooks.Subscriptions |
| 3 | `IWebhookSubscriptionService` | interface | MMCA.Common.Application.Webhooks.Subscriptions |
| 3 | `IWebhookTargetValidator` | interface | MMCA.Common.Application.Webhooks.Subscriptions |
| 3 | `OutputCacheEvictionRequested` | record | MMCA.Common.Domain.IntegrationEvents |
| 3 | `ScopedIntegrationEventHandlerBase<TIntegrationEvent>` | class | MMCA.Common.Application.DomainEvents |
| 3 | `WebhookSignature` | class | MMCA.Common.Application.Webhooks.Delivery |
| 4 | `DataProtectionWebhookSecretProtector` | class | MMCA.Common.Infrastructure.Webhooks |
| 4 | `DeliverWebhookInternalCommand` | record | MMCA.Common.Application.Webhooks.Delivery |
| 4 | `DnsWebhookTargetValidator` | class | MMCA.Common.Infrastructure.Webhooks |
| 4 | `HttpWebhookSender` | class | MMCA.Common.Infrastructure.Webhooks |
| 4 | `IntegrationEventConsumerExtensions` | class | MMCA.Common.Infrastructure.Messaging.Consumers |
| 4 | `IProcessTimeoutCommand<TProcessId>` | interface | MMCA.Common.Application.ProcessManagers |
| 4 | `WebhookSubscription` | class | MMCA.Common.Domain.Webhooks |
| 5 | `IProcessTimeoutScheduler` | interface | MMCA.Common.Application.ProcessManagers |
| 5 | `IWebhookSubscriptionStore` | interface | MMCA.Common.Application.Webhooks.Subscriptions |
| 5 | `ProcessManagerAggregateRoot<TIdentifierType>` | class | MMCA.Common.Domain.ProcessManagers |
| 5 | `WebhookSubscriptionModelBuilderExtensions` | class | MMCA.Common.Infrastructure.Persistence.Webhooks |
| 6 | `DeliverWebhookInternalCommandHandler` | class | MMCA.Common.Application.Webhooks.Delivery |
| 6 | `ProcessTimeoutScheduler` | class | MMCA.Common.Application.ProcessManagers |
| 6 | `WebhookRegistrationValidator` | class | MMCA.Common.Application.Webhooks |
| 6 | `WebhookSubscriptionsControllerBase` | class | MMCA.Common.API.Controllers.Webhooks |
| 6 | `WebhookSubscriptionService` | class | MMCA.Common.Application.Webhooks.Subscriptions |
| 7 | `IntegrationEventConsumer<TEvent>` | class | MMCA.Common.Infrastructure.Messaging.Consumers |
| 8 | `OutboxFinalizer` | class | MMCA.Common.Infrastructure.Persistence.Outbox.Processing |
| 8 | `ProcessTimeoutHandlerBase<TCommand, TProcess, TProcessId>` | class | MMCA.Common.Application.ProcessManagers |
| 8 | `WebhookFanOutHandler<TEvent>` | class | MMCA.Common.Application.Webhooks.Delivery |
| 9 | `BrokerMessageBus` | class | MMCA.Common.Infrastructure.Messaging |
| 10 | `BrokerEventBus` | class | MMCA.Common.Infrastructure.Messaging |
| 10 | `EfInboxStore` | class | MMCA.Common.Infrastructure.Persistence.Inbox |
| 10 | `EFWebhookSubscriptionStore` | class | MMCA.Common.Infrastructure.Persistence.Webhooks |
| 10 | `InProcessEventBus` | class | MMCA.Common.Infrastructure.Messaging |
| 11 | `ProcessStepContext` | class | MMCA.Common.Application.ProcessManagers |
| 12 | `ProcessDomainEventHandlerBase<TDomainEvent, TProcess, TProcessId>` | class | MMCA.Common.Application.ProcessManagers |
| 13 | `OutboxAdministration` | class | MMCA.Common.Infrastructure.Persistence.Outbox.Administration |
| 13 | `OutboxCleanupService` | class | MMCA.Common.Infrastructure.Persistence.Outbox.Administration |
| 13 | `OutboxProcessor` | class | MMCA.Common.Infrastructure.Persistence.Outbox.Processing |
| 15 | `WebhookDeliveryLane` | class | MMCA.Common.Infrastructure.Webhooks |
| 16 | `WebhookServiceCollectionExtensions` | class | MMCA.Common.Infrastructure.Webhooks |

### G05 - CQRS: Commands, Queries & the Decorator Pipeline

> `group-05-cqrs-pipeline.md` | 64 types | The command/query handler abstraction and the cross-cutting decorator pipeline (logging, transaction, caching, feature-gate, idempotency) wrapping it.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `CqrsContractMismatchKind` | enum | MMCA.Common.Application.UseCases |
| 0 | `CqrsMetrics` | class | MMCA.Common.Application.UseCases.Decorators |
| 0 | `CrossServiceCacheKeys` | class | MMCA.Common.Application.Interfaces |
| 0 | `EntityCachePrefix` | class | MMCA.Common.Application.UseCases.Markers |
| 0 | `ICommand<TResult>` | interface | MMCA.Common.Application.UseCases.Contracts |
| 0 | `ICommandHandler<in TCommand, TResult>` | interface | MMCA.Common.Application.UseCases.Contracts |
| 0 | `ICommandWithRequest<out TRequest>` | interface | MMCA.Common.Application.UseCases.Contracts |
| 0 | `ICreateRequest` | interface | MMCA.Common.Application.Interfaces.Mapping |
| 0 | `IDistributedLock` | interface | MMCA.Common.Application.Interfaces |
| 0 | `IFeatureGated` | interface | MMCA.Common.Application.UseCases.Markers |
| 0 | `IHasTimeout` | interface | MMCA.Common.Application.UseCases.Markers |
| 0 | `IQuery<TResult>` | interface | MMCA.Common.Application.UseCases.Contracts |
| 0 | `IQueryCacheable` | interface | MMCA.Common.Application.UseCases.Markers |
| 0 | `IQueryHandler<in TQuery, TResult>` | interface | MMCA.Common.Application.UseCases.Contracts |
| 0 | `IRequiresMfa` | interface | MMCA.Common.Application.UseCases.Markers |
| 0 | `IRequiresPermission` | interface | MMCA.Common.Application.UseCases.Markers |
| 0 | `IScheduledJob` | interface | MMCA.Common.Application.Interfaces |
| 0 | `ISharedQueryCache` | interface | MMCA.Common.Application.UseCases.Markers |
| 0 | `ITenantContext` | interface | MMCA.Common.Application.Interfaces |
| 0 | `ITransactional` | interface | MMCA.Common.Application.UseCases.Markers |
| 0 | `MutationContext` | class | MMCA.Common.Application.UseCases.Crud |
| 1 | `CqrsContractMismatch` | record | MMCA.Common.Application.UseCases |
| 1 | `IAuditTrailReader` | interface | MMCA.Common.Application.Interfaces |
| 1 | `ICacheInvalidating` | interface | MMCA.Common.Application.UseCases.Markers |
| 1 | `ProfilingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 1 | `ProfilingQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 1 | `TenantCacheKey` | class | MMCA.Common.Application.UseCases.Decorators |
| 1 | `UserCacheKey` | class | MMCA.Common.Application.UseCases.Decorators |
| 2 | `CqrsContractInspector` | class | MMCA.Common.Application.UseCases |
| 2 | `DeleteEntityCommand<TEntity, TIdentifierType>` | record | MMCA.Common.Application.UseCases.Crud |
| 2 | `IEventUpcaster` | interface | MMCA.Common.Application.Interfaces.Events |
| 2 | `IEventUpcasterRegistry` | interface | MMCA.Common.Application.Interfaces.Events |
| 3 | `CacheKeyLocks` | class | MMCA.Common.Application.Interfaces |
| 3 | `LoggingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 3 | `LoggingQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 3 | `QueryCacheKeyLocks` | class | MMCA.Common.Application.UseCases.Decorators |
| 3 | `ResultFailureFactory` | class | MMCA.Common.Application.UseCases.Decorators |
| 4 | `FeatureGateCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 4 | `FeatureGateQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 4 | `IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Mapping |
| 4 | `IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Mapping |
| 4 | `TimeoutCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 4 | `TimeoutQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 4 | `ValidatingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 4 | `ValidatingQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 5 | `CachingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 5 | `CachingQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 5 | `UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>` | record | MMCA.Common.Application.UseCases.Crud |
| 6 | `IEntityUpdateCommandApplier<TEntity, TUpdateRequest, TIdentifierType, in TCommand>` | interface | MMCA.Common.Application.UseCases.Crud |
| 8 | `AddChildEntityHandlerBase<TCommand, TParent, TIdentifierType, TChild, TChildDTO>` | class | MMCA.Common.Application.UseCases.Crud |
| 8 | `CreateEntityHandlerBase<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>` | class | MMCA.Common.Application.UseCases.Crud |
| 8 | `DeleteEntityHandler<TEntity, TIdentifierType>` | class | MMCA.Common.Application.UseCases.Crud |
| 8 | `MutateEntityHandlerCore<TCommand, TEntity, TIdentifierType>` | class | MMCA.Common.Application.UseCases.Crud |
| 8 | `TransactionalCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 9 | `AuthorizationGate` | class | MMCA.Common.Application.UseCases.Decorators |
| 9 | `CreateEntityHandler<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>` | class | MMCA.Common.Application.UseCases.Crud |
| 9 | `MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>` | class | MMCA.Common.Application.UseCases.Crud |
| 9 | `ViewAsCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 10 | `AuthorizationCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 10 | `AuthorizationQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 10 | `RemoveChildEntityHandlerBase<TCommand, TParent, TIdentifierType>` | class | MMCA.Common.Application.UseCases.Crud |
| 10 | `UpdateEntityCommandHandler<TCommand, TEntity, TEntityDTO, TIdentifierType, TUpdateRequest>` | class | MMCA.Common.Application.UseCases.Crud |
| 10 | `UpdateEntityHandler<TEntity, TEntityDTO, TIdentifierType, TUpdateRequest>` | class | MMCA.Common.Application.UseCases.Crud |
| 11 | `MutateEntityPayloadHandlerBase<TCommand, TEntity, TIdentifierType, TResultPayload>` | class | MMCA.Common.Application.UseCases.Crud |

### G06 - Validation

> `group-06-validation.md` | 26 types | The FluentValidation-based validation contracts and failure mapping that gate commands before they execute.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `EmailRules<T>` | class | MMCA.Common.Application.Validation |
| 0 | `NonNegativeIntRules<T>` | class | MMCA.Common.Application.Validation |
| 0 | `OptionalErrorCodeExtensions` | class | MMCA.Common.Application.Validation |
| 0 | `OptionalPositiveIdRules<T, TId>` | class | MMCA.Common.Application.Validation |
| 0 | `OptionalStringRules<T>` | class | MMCA.Common.Application.Validation |
| 0 | `PasswordRules<T>` | class | MMCA.Common.Application.Validation |
| 0 | `PositiveDecimalRules<T>` | class | MMCA.Common.Application.Validation |
| 0 | `PositiveIntRules<T>` | class | MMCA.Common.Application.Validation |
| 0 | `RequiredIdRules<T, TId>` | class | MMCA.Common.Application.Validation |
| 0 | `RequiredStringRules<T>` | class | MMCA.Common.Application.Validation |
| 0 | `UsCityRules<T>` | class | MMCA.Common.Application.Validation |
| 1 | `CommandRequestValidator<TCommand, TRequest>` | class | MMCA.Common.Application.Validation |
| 1 | `StrongPasswordRules<T>` | class | MMCA.Common.Application.Validation |
| 2 | `UsStateRules<T>` | class | MMCA.Common.Application.Validation |
| 2 | `UsZipCodeRules<T>` | class | MMCA.Common.Application.Validation |
| 2 | `ValidationFailureExtensions` | class | MMCA.Common.Application.Extensions |
| 4 | `AddressLine1Rules<T>` | class | MMCA.Common.Application.Validation |
| 4 | `AddressLine2Rules<T>` | class | MMCA.Common.Application.Validation |
| 4 | `CityRules<T>` | class | MMCA.Common.Application.Validation |
| 4 | `CountryRules<T>` | class | MMCA.Common.Application.Validation |
| 4 | `StateRules<T>` | class | MMCA.Common.Application.Validation |
| 4 | `ZipCodeRules<T>` | class | MMCA.Common.Application.Validation |
| 5 | `AddressValidator` | class | MMCA.Common.Application.Validation |
| 6 | `AbsoluteUrlRules<T>` | class | MMCA.Common.Application.Validation |
| 6 | `UsAddressValidator` | class | MMCA.Common.Application.Validation |
| 9 | `CurrentUserServiceExtensions` | class | MMCA.Common.Application.Extensions |

### G07 - Persistence & EF Core

> `group-07-persistence-ef-core.md` | 202 types | The single SQLServerDbContext over the abstract ApplicationDbContext, interceptors, repositories, specifications evaluation, data-source routing (database-per-service), conventions, value generators, encryption, factories and design-time.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AuditTrailEntry` | class | MMCA.Common.Infrastructure.Persistence.AuditTrail |
| 0 | `BlobNames` | class | MMCA.Common.Application.Interfaces.Infrastructure.Storage |
| 0 | `CaptureContext` | record struct | MMCA.Common.Infrastructure.Persistence.AuditTrail |
| 0 | `ColumnWidth` | class | MMCA.Common.Infrastructure.Persistence.Conversions |
| 0 | `ConnectionStringSettings` | class | MMCA.Common.Infrastructure.Persistence.DataSources |
| 0 | `CosmosIntIdValueGenerator` | class | MMCA.Common.Infrastructure.Persistence.ValueGenerators |
| 0 | `CrossTenantWriteException` | class | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 0 | `DataSource` | enum | MMCA.Common.Application.Interfaces.Infrastructure.Persistence |
| 0 | `DataSourceEntrySettings` | class | MMCA.Common.Infrastructure.Persistence.DataSources |
| 0 | `DefaultSeed` | record | MMCA.Common.Infrastructure.Persistence.DataSources |
| 0 | `DetectChangesScope` | struct | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 0 | `DocumentFormats` | enum | MMCA.Common.Application.Interfaces.Infrastructure.Storage |
| 0 | `EncryptedStringConverter` | class | MMCA.Common.Infrastructure.Persistence.Encryption |
| 0 | `EntityConfigurationOptions` | class | MMCA.Common.Infrastructure.Persistence |
| 0 | `ExplicitKeyInsertGroup` | record | MMCA.Common.Infrastructure.Persistence.DataSources.Engines |
| 0 | `ExplicitKeyInsertRoundOrder` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 0 | `FileUploadOptions` | record | MMCA.Common.Application.Interfaces.Infrastructure.Storage |
| 0 | `GroupedCount<TKey>` | record | MMCA.Common.Infrastructure.Persistence.Repositories |
| 0 | `GroupedSum<TKey>` | record | MMCA.Common.Infrastructure.Persistence.Repositories |
| 0 | `IChannelJoinAuthorizer` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Notifications |
| 0 | `IConcurrencyConflictDetector` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Persistence |
| 0 | `IDbSeeder` | interface | MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding |
| 0 | `IEntityConfigurationAssemblyProvider` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Persistence |
| 0 | `IInternalCommandSignal` | interface | MMCA.Common.Infrastructure.Persistence.InternalCommands.Processing |
| 0 | `ImageContentSniffer` | class | MMCA.Common.Application.Interfaces.Infrastructure.Storage |
| 0 | `INpgsqlDataSourceConfigurator` | interface | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 0 | `InternalCommandCycleResult` | record struct | MMCA.Common.Infrastructure.Persistence.InternalCommands.Processing |
| 0 | `InternalCommandLanes` | class | MMCA.Common.Infrastructure.Persistence.InternalCommands.Processing |
| 0 | `InternalCommandOrigin` | record struct | MMCA.Common.Infrastructure.Persistence.InternalCommands |
| 0 | `InternalCommandsDisabledNoticeService` | class | MMCA.Common.Infrastructure.Persistence.InternalCommands.Administration |
| 0 | `IQueryableExecutor` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Persistence |
| 0 | `IRawSqlQueryExecutor` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Persistence |
| 0 | `IUniqueConstraintViolationDetector` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Persistence |
| 0 | `IUpdatePropertySetter<TEntity>` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Persistence |
| 0 | `LaneBatchOutcome` | record struct | MMCA.Common.Infrastructure.Persistence.InternalCommands.Processing |
| 0 | `LocalLease` | record struct | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 0 | `LookupRow<TId, TName>` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 0 | `MigrationPolicy` | enum | MMCA.Common.Infrastructure.Persistence.DataSources.Engines |
| 0 | `ModelBuilderExtensions` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 0 | `NativePushDeliveryUnit` | enum | MMCA.Common.Application.Interfaces.Infrastructure.Notifications |
| 0 | `NativePushPlatformCounts` | record struct | MMCA.Common.Application.Interfaces.Infrastructure.Notifications |
| 0 | `OutboxDeadLetter` | record | MMCA.Common.Application.Interfaces.Infrastructure.Persistence |
| 0 | `PermissionGrantModelGate` | class | MMCA.Common.Infrastructure.Persistence.Auth |
| 0 | `PersistenceSettings` | class | MMCA.Common.Infrastructure.Persistence |
| 0 | `ProfilingHelper` | class | MMCA.Common.Infrastructure.Persistence |
| 0 | `ReceiverCooldowns` | class | MMCA.Common.Infrastructure.Persistence.InternalCommands.Processing |
| 0 | `RowVersionStrategy` | enum | MMCA.Common.Infrastructure.Persistence.DataSources.Engines |
| 0 | `SeedAccount` | record | MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding |
| 0 | `SignInChainRow` | class | MMCA.Common.Infrastructure.Persistence.Auth |
| 0 | `StronglyTypedIdValueComparer<TSelf>` | class | MMCA.Common.Infrastructure.Persistence.Conversions |
| 0 | `TenantDataSourceOverrideSettings` | class | MMCA.Common.Infrastructure.Persistence.Tenancy |
| 0 | `TenantResolutionStrategy` | enum | MMCA.Common.Infrastructure.Persistence.Tenancy |
| 0 | `TransactionCommitAmbiguousException` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 0 | `UtcDateTimeConverter` | class | MMCA.Common.Infrastructure.Persistence.Conversions |
| 0 | `ValueHolder<T>` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 0 | `WakeUpSignal` | class | MMCA.Common.Infrastructure.Persistence.Polling |
| 1 | `AuditTrailSettings` | class | MMCA.Common.Infrastructure.Persistence.AuditTrail |
| 1 | `BatchedDelete` | class | MMCA.Common.Infrastructure.Persistence.Retention |
| 1 | `DataSourceEngineCapabilities` | record | MMCA.Common.Infrastructure.Persistence.DataSources.Engines |
| 1 | `DataSourceKey` | record struct | MMCA.Common.Application.Interfaces.Infrastructure.Persistence |
| 1 | `DataSourcesSettings` | class | MMCA.Common.Infrastructure.Persistence.DataSources |
| 1 | `DefaultEntityConfigurationAssemblyProvider` | class | MMCA.Common.Infrastructure.Persistence |
| 1 | `DesignTimeDbContextOptions` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Design |
| 1 | `DocumentContentSniffer` | class | MMCA.Common.Application.Interfaces.Infrastructure.Storage |
| 1 | `EfCoreConcurrencyConflictDetector` | class | MMCA.Common.Infrastructure.Persistence |
| 1 | `EFQueryableExecutor` | class | MMCA.Common.Infrastructure.Persistence |
| 1 | `EnrolledCommandWake` | class | MMCA.Common.Infrastructure.Persistence.InternalCommands |
| 1 | `ExplicitAssemblyProvider` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Design |
| 1 | `IExplicitKeyInsertDialect` | interface | MMCA.Common.Infrastructure.Persistence.DataSources.Engines |
| 1 | `InternalCommandMetrics` | class | MMCA.Common.Infrastructure.Persistence.InternalCommands.Processing |
| 1 | `InternalCommandNameResolver` | class | MMCA.Common.Infrastructure.Persistence.InternalCommands.Processing |
| 1 | `InternalCommandSignal` | class | MMCA.Common.Infrastructure.Persistence.InternalCommands.Processing |
| 1 | `NamespaceConventions` | class | MMCA.Common.Infrastructure.Persistence |
| 1 | `NativePushOutcome` | record | MMCA.Common.Application.Interfaces.Infrastructure.Notifications |
| 1 | `NpgsqlDataSources` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 1 | `PendingEntityKey` | record | MMCA.Common.Infrastructure.Persistence.AuditTrail |
| 1 | `PermissionGrantRefreshService` | class | MMCA.Common.Infrastructure.Persistence.Auth |
| 1 | `SensitiveDataLoggingGate` | class | MMCA.Common.Infrastructure.Persistence |
| 1 | `SqlServerUniqueConstraintViolationDetector` | class | MMCA.Common.Infrastructure.Persistence |
| 1 | `TenantEntrySettings` | class | MMCA.Common.Infrastructure.Persistence.Tenancy |
| 1 | `UpdatePropertySetterBuilder<TEntity>` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 2 | `AggregateCapture` | record | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 2 | `ConnectionStringSettingsValidator` | class | MMCA.Common.Infrastructure.Persistence.DataSources |
| 2 | `IDataSourceService` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Persistence |
| 2 | `IEntityDataSourceRegistry` | interface | MMCA.Common.Infrastructure.Persistence.DataSources |
| 2 | `INativePushSender` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Notifications |
| 2 | `InternalCommandsSettings` | class | MMCA.Common.Infrastructure.Persistence.InternalCommands.Administration |
| 2 | `NullDomainEventDispatcher` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Design |
| 2 | `OwnedDependents` | class | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 2 | `QueryTags` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 2 | `Snapshot` | record | MMCA.Common.Infrastructure.Persistence.DataSources |
| 2 | `TenancySettings` | class | MMCA.Common.Infrastructure.Persistence.Tenancy |
| 2 | `TenantDataSourceTarget` | record struct | MMCA.Common.Infrastructure.Persistence.DataSources |
| 3 | `CapturedState` | record | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 3 | `IFileStorageService` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Storage |
| 3 | `IOutboxAdministration` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Persistence |
| 3 | `IPushDeviceRegistrar` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Notifications |
| 3 | `NullableStronglyTypedIdValueConverter<TSelf, TValue>` | class | MMCA.Common.Infrastructure.Persistence.Conversions |
| 3 | `PollingLoop` | class | MMCA.Common.Infrastructure.Persistence.Polling |
| 3 | `StronglyTypedIdValueConverter<TSelf, TValue>` | class | MMCA.Common.Infrastructure.Persistence.Conversions |
| 4 | `EnumerationNameValueConverter<TEnumeration>` | class | MMCA.Common.Infrastructure.Persistence.Conversions |
| 4 | `EnumerationValueConverter<TEnumeration>` | class | MMCA.Common.Infrastructure.Persistence.Conversions |
| 4 | `IEntityQuerier<TEntity, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Persistence |
| 4 | `IEntityReader<TEntity, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Persistence |
| 4 | `IEntityTypeConfigurationBase<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 4 | `InternalCommandDispatcher` | class | MMCA.Common.Infrastructure.Persistence.InternalCommands.Processing |
| 4 | `InternalCommandLane` | record | MMCA.Common.Infrastructure.Persistence.InternalCommands.Processing |
| 4 | `InternalCommandMessage` | class | MMCA.Common.Infrastructure.Persistence.InternalCommands |
| 4 | `NullableEnumerationValueConverter<TEnumeration>` | class | MMCA.Common.Infrastructure.Persistence.Conversions |
| 4 | `PasskeyCredentialModelBuilderExtensions` | class | MMCA.Common.Infrastructure.Persistence.Auth |
| 4 | `PermissionGrantModelBuilderExtensions` | class | MMCA.Common.Infrastructure.Persistence.Auth |
| 4 | `SpecificationEvaluator` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 4 | `ViewAsGrantModelBuilderExtensions` | class | MMCA.Common.Infrastructure.Persistence.Auth |
| 5 | `EmailValueConverter` | class | MMCA.Common.Infrastructure.Persistence.Conversions |
| 5 | `EntityTypeBuilderExtensions` | class | MMCA.Common.Infrastructure.Persistence.Configuration |
| 5 | `EntityTypeConfigurationBase<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 5 | `IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 5 | `IEntityTypeConfigurationPostgreSQL<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 5 | `IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 5 | `IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 5 | `IReadRepository<TEntity, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Persistence |
| 5 | `IWriteRepository<TEntity, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Persistence |
| 5 | `KeysetQueryBuilder` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 5 | `LaneRow` | class | MMCA.Common.Infrastructure.Persistence.InternalCommands.Processing |
| 5 | `MachineClientModelBuilderExtensions` | class | MMCA.Common.Infrastructure.Persistence.MachineClients |
| 5 | `NullableEmailValueConverter` | class | MMCA.Common.Infrastructure.Persistence.Conversions |
| 5 | `NullablePhoneNumberValueConverter` | class | MMCA.Common.Infrastructure.Persistence.Conversions |
| 5 | `PermissionGrantCache` | class | MMCA.Common.Infrastructure.Persistence.Auth |
| 5 | `PhoneNumberValueConverter` | class | MMCA.Common.Infrastructure.Persistence.Conversions |
| 5 | `RefreshSessionModelBuilderExtensions` | class | MMCA.Common.Infrastructure.Persistence.Auth |
| 6 | `EFReadRepositoryDecorator<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 6 | `IRepository<TEntity, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Persistence |
| 6 | `LaneBatchState` | class | MMCA.Common.Infrastructure.Persistence.InternalCommands.Processing |
| 6 | `ReadRepositoryExtensions` | class | MMCA.Common.Application.Extensions |
| 7 | `EFRepositoryDecorator<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 7 | `IRepositoryFactory` | interface | MMCA.Common.Infrastructure.Persistence.Repositories.Factory |
| 7 | `IUnitOfWork` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Persistence |
| 7 | `StronglyTypedIdModelConfiguration` | class | MMCA.Common.Infrastructure.Persistence.Conventions |
| 8 | `ApplicationDbContext` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 8 | `AuditSaveChangesInterceptor` | class | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 8 | `AuditTrailSaveChangesInterceptor` | class | MMCA.Common.Infrastructure.Persistence.AuditTrail |
| 8 | `CosmosDataSourceEngine` | class | MMCA.Common.Infrastructure.Persistence.DataSources.Engines |
| 8 | `CosmosDbContext` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 8 | `CrossDataSourceDegradeConvention` | class | MMCA.Common.Infrastructure.Persistence.Conventions |
| 8 | `DataSourceEngines` | class | MMCA.Common.Infrastructure.Persistence.DataSources.Engines |
| 8 | `DataSourceModelCacheKeyFactory` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 8 | `DbSeeder` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding |
| 8 | `DeferredDispatch` | record | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 8 | `DomainEventSaveChangesInterceptor` | class | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 8 | `IDataSourceEngine` | interface | MMCA.Common.Infrastructure.Persistence.DataSources.Engines |
| 8 | `PhysicalDataSource` | record | MMCA.Common.Infrastructure.Persistence.DataSources |
| 8 | `PostgreSQLDataSourceEngine` | class | MMCA.Common.Infrastructure.Persistence.DataSources.Engines |
| 8 | `PostgreSQLDbContext` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 8 | `RestrictDeleteByDefaultConvention` | class | MMCA.Common.Infrastructure.Persistence.Conventions |
| 8 | `SoftDeleteFilterSql` | class | MMCA.Common.Infrastructure.Persistence |
| 8 | `SoftDeleteUniqueIndexConvention` | class | MMCA.Common.Infrastructure.Persistence.Conventions |
| 8 | `SqliteDataSourceEngine` | class | MMCA.Common.Infrastructure.Persistence.DataSources.Engines |
| 8 | `SqliteDbContext` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 8 | `SQLServerDataSourceEngine` | class | MMCA.Common.Infrastructure.Persistence.DataSources.Engines |
| 8 | `SQLServerDbContext` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 8 | `TenantSaveChangesInterceptor` | class | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 9 | `DataSourceService` | class | MMCA.Common.Infrastructure.Persistence.DataSources |
| 9 | `EFReadRepository<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 9 | `EntityTypeConfiguration<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 9 | `IDataSourceResolver` | interface | MMCA.Common.Infrastructure.Persistence.DataSources |
| 9 | `IDbContextFactory` | interface | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 9 | `IndexBuilderExtensions` | class | MMCA.Common.Infrastructure.Persistence.Configuration |
| 9 | `InternalCommandOriginCapture` | class | MMCA.Common.Infrastructure.Persistence.InternalCommands |
| 9 | `IPhysicalDbContextFactory` | interface | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 9 | `LaneBatch` | record | MMCA.Common.Infrastructure.Persistence.InternalCommands.Processing |
| 10 | `AuditTrailReader` | class | MMCA.Common.Infrastructure.Persistence.AuditTrail |
| 10 | `DataSourceResolver` | class | MMCA.Common.Infrastructure.Persistence.DataSources |
| 10 | `EFMachineClientStore` | class | MMCA.Common.Infrastructure.Persistence.MachineClients |
| 10 | `EFPasskeyCredentialStore` | class | MMCA.Common.Infrastructure.Persistence.Auth |
| 10 | `EFPermissionGrantStore` | class | MMCA.Common.Infrastructure.Persistence.Auth |
| 10 | `EFRawSqlQueryExecutor` | class | MMCA.Common.Infrastructure.Persistence |
| 10 | `EFRefreshSessionStore` | class | MMCA.Common.Infrastructure.Persistence.Auth |
| 10 | `EFRepository<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 10 | `EFViewAsGrantStore` | class | MMCA.Common.Infrastructure.Persistence.Auth |
| 10 | `EntityDataSourceRegistry` | class | MMCA.Common.Infrastructure.Persistence.DataSources |
| 10 | `EntityTypeConfigurationCosmos<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 10 | `EntityTypeConfigurationPostgreSQL<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 10 | `EntityTypeConfigurationSqlite<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 10 | `EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 10 | `InternalCommandScheduler` | class | MMCA.Common.Infrastructure.Persistence.InternalCommands |
| 10 | `PhysicalDbContextFactory` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 10 | `RefreshSessionCleanupService` | class | MMCA.Common.Infrastructure.Persistence.Auth |
| 10 | `TenancySettingsValidator` | class | MMCA.Common.Infrastructure.Persistence.Tenancy |
| 10 | `UnitOfWork` | class | MMCA.Common.Infrastructure.Persistence |
| 11 | `DbContextFactory` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 11 | `DesignTimeDbContextHelper` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Design |
| 11 | `IdentityModuleDbSeederBase<TUser>` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding |
| 11 | `PushNotificationConfiguration` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration.Notifications |
| 11 | `RepositoryFactory` | class | MMCA.Common.Infrastructure.Persistence.Repositories.Factory |
| 11 | `TenantDataSourceTargets` | class | MMCA.Common.Infrastructure.Persistence.DataSources |
| 11 | `UserNotificationConfiguration` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration.Notifications |
| 12 | `FrameworkTableTargets` | class | MMCA.Common.Infrastructure.Persistence.DataSources |
| 13 | `AuditTrailCleanupJob` | class | MMCA.Common.Infrastructure.Persistence.AuditTrail |
| 13 | `InternalCommandAdministration` | class | MMCA.Common.Infrastructure.Persistence.InternalCommands.Administration |
| 13 | `InternalCommandCleanupService` | class | MMCA.Common.Infrastructure.Persistence.InternalCommands.Administration |
| 13 | `InternalCommandProcessor` | class | MMCA.Common.Infrastructure.Persistence.InternalCommands.Processing |
| 14 | `InternalCommandLaneProcessor` | class | MMCA.Common.Infrastructure.Persistence.InternalCommands.Processing |

### G08 - Authentication & Authorization

> `group-08-auth.md` | 267 types | JWT/JWKS dual-fetch token validation, current-user/claims, password hashing, cookie sessions, and policy/authorization plumbing.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AcceptLegalTermsRequest` | record struct | MMCA.Common.Shared.Legal |
| 0 | `AdministrationPermissions` | class | MMCA.Common.Shared.Auth.Permissions |
| 0 | `AllowMissingOwnerAttribute` | class | MMCA.Common.API.Authorization |
| 0 | `AuditHistoryEntryDTO` | record | MMCA.Common.Shared.Auditing |
| 0 | `AuthClaimTypes` | class | MMCA.Common.Shared.Auth |
| 0 | `AuthenticationResponse` | record struct | MMCA.Common.Shared.Auth.Responses |
| 0 | `AuthErrorCodes` | class | MMCA.Common.Shared.Auth |
| 0 | `Base32` | class | MMCA.Common.Infrastructure.Auth.TwoFactor |
| 0 | `BrowserOrigin` | record struct | MMCA.Common.API.SessionCookies |
| 0 | `ChangePasswordRequest` | record struct | MMCA.Common.Shared.Auth.Requests |
| 0 | `ChangePreferencesRequest` | record | MMCA.Common.Shared.Auth.Requests |
| 0 | `ConcurrencyETag` | class | MMCA.Common.Shared.Http |
| 0 | `ConfirmEmailRequest` | record struct | MMCA.Common.Shared.Auth.Requests |
| 0 | `CreateMachineClientRequest` | record | MMCA.Common.Shared.Auth.MachineClients |
| 0 | `DeviceMetadata` | record | MMCA.Common.Shared.Auth |
| 0 | `EmailConfirmationEntry` | record | MMCA.Common.Infrastructure.Auth |
| 0 | `EmailConfirmationSettings` | class | MMCA.Common.Application.Auth.EmailConfirmation |
| 0 | `FallbackAuthorizationOptions` | class | MMCA.Common.API.Authorization.Fallback |
| 0 | `FallbackAuthorizationRequirement` | class | MMCA.Common.API.Authorization.Fallback |
| 0 | `ForgotPasswordRequest` | record struct | MMCA.Common.Shared.Auth.Requests |
| 0 | `IAuthUser` | interface | MMCA.Common.Domain.Auth |
| 0 | `IcsEvent` | record | MMCA.Common.Shared.Calendars |
| 0 | `IdempotencyHeaders` | class | MMCA.Common.Shared.Http |
| 0 | `IJwksProvider` | interface | MMCA.Common.Infrastructure.Auth |
| 0 | `ImportConventions` | class | MMCA.Common.Shared.Imports |
| 0 | `IPasswordHasher` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Auth |
| 0 | `IPermissionCatalog` | interface | MMCA.Common.Shared.Auth.Permissions |
| 0 | `IPermissionGrantCache` | interface | MMCA.Common.Application.Auth.Permissions |
| 0 | `IPermissionGrantCacheInvalidator` | interface | MMCA.Common.Application.Auth.Permissions |
| 0 | `IPermissionRegistry` | interface | MMCA.Common.Shared.Auth.Permissions |
| 0 | `ISessionCookieStore` | interface | MMCA.Common.API.SessionCookies |
| 0 | `ISoftDeletedUserMarkerWriter` | interface | MMCA.Common.Application.Auth.SoftDeletedUsers |
| 0 | `ISoftDeletedUserValidator` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Auth |
| 0 | `IssuedSession` | record | MMCA.Common.Application.Auth.Sessions |
| 0 | `ITokenService` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Auth |
| 0 | `ITwoFactorUserState` | interface | MMCA.Common.Domain.Auth |
| 0 | `JwksKeyMaterial` | class | MMCA.Common.Infrastructure.Auth |
| 0 | `JwtSigningAlgorithm` | enum | MMCA.Common.Infrastructure.Auth |
| 0 | `LegalAcceptanceDTO` | record | MMCA.Common.Shared.Legal |
| 0 | `LegalAcceptanceErrorCodes` | class | MMCA.Common.Shared.Legal |
| 0 | `LegalAcceptanceOptions` | class | MMCA.Common.Application.Auth.Legal |
| 0 | `LegalAcceptanceRoutes` | class | MMCA.Common.Shared.Legal |
| 0 | `LoginProtectionSettings` | class | MMCA.Common.Infrastructure.Auth |
| 0 | `LoginRequest` | record struct | MMCA.Common.Shared.Auth.Requests |
| 0 | `MachineClientResponse` | record | MMCA.Common.Shared.Auth.MachineClients |
| 0 | `MachineClientSecret` | class | MMCA.Common.Domain.Auth.MachineClients |
| 0 | `MachineClientSettings` | class | MMCA.Common.Application.Auth.MachineClients |
| 0 | `MachineTokenErrorResponse` | record | MMCA.Common.Shared.Auth.MachineClients |
| 0 | `MachineTokenResponse` | record | MMCA.Common.Shared.Auth.MachineClients |
| 0 | `MessageHeaders` | class | MMCA.Common.Shared.Messaging |
| 0 | `ModuleNameConventions` | class | MMCA.Common.Shared.Conventions |
| 0 | `MultiFactorAuthorizationSettings` | class | MMCA.Common.API.Authorization.MultiFactor |
| 0 | `OAuthCodeExchangeRequest` | record struct | MMCA.Common.Shared.Auth.Requests |
| 0 | `OidcDiscoveryResponse` | record | MMCA.Common.Shared.Auth.ExternalProviders |
| 0 | `OwnerOrAdminFilterOptions` | class | MMCA.Common.API.Authorization |
| 0 | `PasskeyAttestation` | record | MMCA.Common.Application.Auth.Passkeys |
| 0 | `PasskeyChallenge` | record | MMCA.Common.Application.Auth.Passkeys |
| 0 | `PasskeyOptionsResponse` | record | MMCA.Common.Shared.Auth.Passkeys |
| 0 | `PasskeyRegisterRequest` | record | MMCA.Common.Shared.Auth.Passkeys |
| 0 | `PasskeyRenameRequest` | record | MMCA.Common.Shared.Auth.Passkeys |
| 0 | `PasskeyResponse` | record | MMCA.Common.Shared.Auth.Passkeys |
| 0 | `PasskeySettings` | class | MMCA.Common.Application.Auth.Passkeys |
| 0 | `PasskeySignInRequest` | record | MMCA.Common.Shared.Auth.Passkeys |
| 0 | `PasskeyStepUp` | class | MMCA.Common.Application.Auth.Passkeys |
| 0 | `PasskeyStoredKey` | record | MMCA.Common.Application.Auth.Passkeys |
| 0 | `PasswordComplexity` | class | MMCA.Common.Shared.Auth |
| 0 | `PasswordResetEntry` | record | MMCA.Common.Infrastructure.Auth |
| 0 | `PasswordResetSettings` | class | MMCA.Common.Application.Auth |
| 0 | `PermissionCatalogResponse` | record | MMCA.Common.Shared.Auth.Responses |
| 0 | `PermissionGrantSettings` | class | MMCA.Common.Application.Auth.Permissions |
| 0 | `PermissionPolicy` | class | MMCA.Common.API.Authorization |
| 0 | `PermissionRequirement` | class | MMCA.Common.API.Authorization |
| 0 | `QueryFilterKeys` | class | MMCA.Common.Shared.Http |
| 0 | `RecoveryCodeSet` | record | MMCA.Common.Application.Auth.TwoFactor |
| 0 | `RedeemSignInLinkRequest` | record struct | MMCA.Common.Shared.Auth.Requests |
| 0 | `RefreshSessionSettings` | class | MMCA.Common.Application.Auth |
| 0 | `RefreshTokenRequest` | record struct | MMCA.Common.Shared.Auth.Requests |
| 0 | `RegistrationPendingResponse` | record | MMCA.Common.Shared.Auth.Responses |
| 0 | `ResetPasswordRequest` | record struct | MMCA.Common.Shared.Auth.Requests |
| 0 | `RolePermissionsResponse` | record | MMCA.Common.Shared.Auth.Responses |
| 0 | `SendEmailConfirmationRequest` | record struct | MMCA.Common.Shared.Auth.Requests |
| 0 | `SendSignInLinkRequest` | record struct | MMCA.Common.Shared.Auth.Requests |
| 0 | `ServiceAccount` | record | MMCA.Common.Application.Auth.MachineClients |
| 0 | `SessionClaimsToken` | class | MMCA.Common.API.SessionCookies |
| 0 | `SessionCookieRequest` | record | MMCA.Common.API.SessionCookies |
| 0 | `SessionCookieSettings` | class | MMCA.Common.API.SessionCookies |
| 0 | `SessionRefreshStatus` | enum | MMCA.Common.API.SessionCookies |
| 0 | `SessionTokenResponse` | record | MMCA.Common.API.SessionCookies |
| 0 | `SessionTokenResult` | record struct | MMCA.Common.API.SessionCookies |
| 0 | `SetRolePermissionsRequest` | record | MMCA.Common.Shared.Auth.Requests |
| 0 | `SetUserRolesRequest` | record | MMCA.Common.Shared.Auth.Requests |
| 0 | `SignInEndReasons` | class | MMCA.Common.Shared.Auth.Responses |
| 0 | `SignInHistoryEntryKind` | enum | MMCA.Common.Shared.Auth.Responses |
| 0 | `SignInLinkProfile` | record | MMCA.Common.Application.Auth.SignInLinks |
| 0 | `SignInLinkPurpose` | enum | MMCA.Common.Application.Auth.SignInLinks |
| 0 | `StartViewAsRequest` | record | MMCA.Common.Shared.Auth.Requests |
| 0 | `StronglyTypedIdValueParserDelegate<TValue>` | delegate | MMCA.Common.Shared.Identifiers |
| 0 | `Totp` | class | MMCA.Common.Infrastructure.Auth.TwoFactor |
| 0 | `TwoFactorCodeRequest` | record struct | MMCA.Common.Shared.Auth.Requests |
| 0 | `TwoFactorOutcome` | enum | MMCA.Common.Application.Auth.TwoFactor |
| 0 | `TwoFactorRecoveryCodesResponse` | record | MMCA.Common.Shared.Auth.Responses |
| 0 | `TwoFactorSettings` | class | MMCA.Common.Application.Auth.TwoFactor |
| 0 | `TwoFactorSetupResponse` | record struct | MMCA.Common.Shared.Auth.Responses |
| 0 | `TwoFactorStatusResponse` | record struct | MMCA.Common.Shared.Auth.Responses |
| 0 | `UserDataExportSectionDTO` | record | MMCA.Common.Shared.Privacy |
| 0 | `UserPreferencesResponse` | record | MMCA.Common.Shared.Auth.Responses |
| 0 | `ViewAsGrantResponse` | record | MMCA.Common.Shared.Auth.Responses |
| 0 | `ViewAsGrantStatus` | enum | MMCA.Common.Shared.Auth.Responses |
| 0 | `ViewAsOverlayCookie` | class | MMCA.Common.API.SessionCookies |
| 0 | `ViewAsReadOnlyEndpointAttribute` | class | MMCA.Common.Shared.Auth |
| 0 | `ViewAsSettings` | class | MMCA.Common.Application.Auth.ViewAs |
| 0 | `ViewAsSubject` | record | MMCA.Common.Application.Auth.ViewAs |
| 1 | `ClaimsPrincipalExtensions` | class | MMCA.Common.Shared.Auth |
| 1 | `ConfirmEmailRequestValidator` | class | MMCA.Common.Application.Auth.Validation |
| 1 | `FallbackAuthorizationHandler` | class | MMCA.Common.API.Authorization.Fallback |
| 1 | `ForgotPasswordRequestValidator` | class | MMCA.Common.Application.Auth.Validation |
| 1 | `HasPermissionAttribute` | class | MMCA.Common.API.Authorization |
| 1 | `IcsCalendarBuilder` | class | MMCA.Common.Shared.Calendars |
| 1 | `ITwoFactorService` | interface | MMCA.Common.Application.Auth.TwoFactor |
| 1 | `IUserAdminDTO` | interface | MMCA.Common.Shared.Auth.Administration |
| 1 | `IViewAsSubjectResolver` | interface | MMCA.Common.Application.Auth.ViewAs |
| 1 | `JwksAdditionalKey` | class | MMCA.Common.Infrastructure.Auth |
| 1 | `JwtSettings` | class | MMCA.Common.Infrastructure.Auth |
| 1 | `LayeredPermissionRegistry` | class | MMCA.Common.Application.Auth.Permissions |
| 1 | `LoginRequestValidator` | class | MMCA.Common.Application.Auth.Validation |
| 1 | `MachineClientSecretResponse` | record | MMCA.Common.Shared.Auth.MachineClients |
| 1 | `MultiFactorRoleWithholding` | class | MMCA.Common.API.Authorization.MultiFactor |
| 1 | `PasskeySettingsValidator` | class | MMCA.Common.Passkeys |
| 1 | `PasswordCredential` | class | MMCA.Common.Domain.Auth.Credentials |
| 1 | `PasswordHasher` | class | MMCA.Common.Infrastructure.Auth |
| 1 | `PermissionAuthorizationHandler` | class | MMCA.Common.API.Authorization |
| 1 | `PermissionPolicyProvider` | class | MMCA.Common.API.Authorization |
| 1 | `PermissionRegistry` | class | MMCA.Common.Shared.Auth.Permissions |
| 1 | `PrivacyFeatures` | class | MMCA.Common.Shared.Privacy |
| 1 | `RedeemSignInLinkRequestValidator` | class | MMCA.Common.Application.Auth.Validation |
| 1 | `RefreshSessionSummaryResponse` | record | MMCA.Common.Shared.Auth.Responses |
| 1 | `RefreshTokenRequestValidator` | class | MMCA.Common.Application.Auth.Validation |
| 1 | `RegistrationOutcome` | class | MMCA.Common.Shared.Auth.Responses |
| 1 | `Releaser` | record struct | MMCA.Common.Shared.Concurrency |
| 1 | `SendEmailConfirmationRequestValidator` | class | MMCA.Common.Application.Auth.Validation |
| 1 | `SendSignInLinkRequestValidator` | class | MMCA.Common.Application.Auth.Validation |
| 1 | `SessionRefreshOutcome` | class | MMCA.Common.API.SessionCookies |
| 1 | `SessionStampingTokenService` | class | MMCA.Common.Application.Auth.Sessions |
| 1 | `SignInLinkEntry` | record | MMCA.Common.Infrastructure.Auth.SignInLinks |
| 1 | `SignInLinkGrant` | record | MMCA.Common.Application.Auth.SignInLinks |
| 1 | `SignInLinkSettings` | class | MMCA.Common.Application.Auth.SignInLinks |
| 1 | `SignInSummaryResponse` | record | MMCA.Common.Shared.Auth.Responses |
| 1 | `StronglyTypedIdValueParser<TValue>` | class | MMCA.Common.Shared.Identifiers |
| 1 | `TwoFactorCodeRequestValidator` | class | MMCA.Common.Application.Auth.Validation |
| 1 | `UnconfiguredPermissionRegistry` | class | MMCA.Common.Application.Auth |
| 1 | `UserDataExportDTO` | record | MMCA.Common.Shared.Privacy |
| 1 | `ViewAsGrantListRequest` | record | MMCA.Common.Shared.Auth.Requests |
| 1 | `ViewAsGrantSummaryResponse` | record | MMCA.Common.Shared.Auth.Responses |
| 2 | `EmailConfirmationErrors` | class | MMCA.Common.Application.Auth.EmailConfirmation |
| 2 | `ICookieSessionRefresher` | interface | MMCA.Common.API.SessionCookies |
| 2 | `ImportRowErrorDTO` | record | MMCA.Common.Shared.Imports |
| 2 | `IStronglyTypedId<TSelf, TValue>` | interface | MMCA.Common.Shared.Identifiers |
| 2 | `JwksSettings` | class | MMCA.Common.Infrastructure.Auth |
| 2 | `KeyedSemaphoreStripe` | class | MMCA.Common.Shared.Concurrency |
| 2 | `LegalAcceptanceErrors` | class | MMCA.Common.Application.Auth.Legal |
| 2 | `MachineClientErrors` | class | MMCA.Common.Application.Auth.MachineClients |
| 2 | `MultiFactorBearerWithholding` | class | MMCA.Common.API.Authorization.MultiFactor |
| 2 | `MultiFactorRoleAuthorizationHandler` | class | MMCA.Common.API.Authorization.MultiFactor |
| 2 | `PasskeyErrors` | class | MMCA.Common.Application.Auth.Passkeys |
| 2 | `PermissionRegistryBuilder` | class | MMCA.Common.Shared.Auth.Permissions |
| 2 | `ResetPasswordRequestValidator` | class | MMCA.Common.Application.Auth.Validation |
| 2 | `SignInLinkErrors` | class | MMCA.Common.Application.Auth.SignInLinks |
| 2 | `StronglyTypedId` | class | MMCA.Common.Shared.Identifiers |
| 2 | `TotpTwoFactorService` | class | MMCA.Common.Infrastructure.Auth.TwoFactor |
| 2 | `TwoFactorErrors` | class | MMCA.Common.Application.Auth.TwoFactor |
| 3 | `AuthSignInMetrics` | class | MMCA.Common.Application.Auth |
| 3 | `CookieSessionRefreshMiddleware` | class | MMCA.Common.API.SessionCookies |
| 3 | `IAuthSessionIssuer` | interface | MMCA.Common.Application.Auth.Sessions |
| 3 | `IEmailConfirmableUser` | interface | MMCA.Common.Domain.Auth |
| 3 | `IEmailConfirmationTokenService` | interface | MMCA.Common.Application.Auth.EmailConfirmation |
| 3 | `ILegalAcceptanceService` | interface | MMCA.Common.Application.Auth.Legal |
| 3 | `ILegalAcceptingUser` | interface | MMCA.Common.Domain.Auth |
| 3 | `ILoginProtectionService` | interface | MMCA.Common.Application.Auth |
| 3 | `IMachineClientService` | interface | MMCA.Common.Application.Auth.MachineClients |
| 3 | `ImportReportDTO` | record | MMCA.Common.Shared.Imports |
| 3 | `IPasskeyCeremony` | interface | MMCA.Common.Application.Auth.Passkeys |
| 3 | `IPasskeyService` | interface | MMCA.Common.Application.Auth.Passkeys |
| 3 | `IPasswordChangeableUser` | interface | MMCA.Common.Domain.Auth |
| 3 | `IPasswordClearableUser` | interface | MMCA.Common.Domain.Auth.Credentials |
| 3 | `IPasswordRehashableUser` | interface | MMCA.Common.Domain.Auth |
| 3 | `IPasswordResetTokenService` | interface | MMCA.Common.Application.Auth |
| 3 | `IRoleAdministrationService` | interface | MMCA.Common.Application.Auth.Administration |
| 3 | `IServiceAccountProvisioner` | interface | MMCA.Common.Application.Auth.MachineClients |
| 3 | `ISignInLinkTokenService` | interface | MMCA.Common.Application.Auth.SignInLinks |
| 3 | `ITwoFactorAuthenticator` | interface | MMCA.Common.Application.Auth.TwoFactor |
| 3 | `ITwoFactorSecretProtector` | interface | MMCA.Common.Application.Auth.TwoFactor |
| 3 | `ITwoFactorStore` | interface | MMCA.Common.Application.Auth.TwoFactor |
| 3 | `IUserAdministrationService<TUserDto>` | interface | MMCA.Common.Application.Auth.Administration |
| 3 | `IUserPreferences` | interface | MMCA.Common.Domain.Auth |
| 3 | `IUserSessionsAdministrationService` | interface | MMCA.Common.Application.Auth.Administration |
| 3 | `IViewAsService` | interface | MMCA.Common.Application.Auth.ViewAs |
| 3 | `LegalAcceptancePolicy` | class | MMCA.Common.Application.Auth.Legal |
| 3 | `PasskeyCredential` | class | MMCA.Common.Domain.Auth |
| 3 | `PermissionGrant` | class | MMCA.Common.Domain.Auth |
| 3 | `ProblemDetailsResultReader` | class | MMCA.Common.Shared.Http |
| 3 | `RoleValue` | class | MMCA.Common.Shared.Auth |
| 3 | `RsaJwksProvider` | class | MMCA.Common.Infrastructure.Auth |
| 3 | `SessionCookieEndpoints` | class | MMCA.Common.API.SessionCookies |
| 3 | `SessionCookieJar` | class | MMCA.Common.API.SessionCookies |
| 3 | `StronglyTypedIdConverter<TSelf, TValue>` | class | MMCA.Common.Shared.Identifiers |
| 3 | `StronglyTypedIdMappings<TSelf, TValue>` | class | MMCA.Common.Shared.Identifiers |
| 3 | `StronglyTypedIdTypeConverter<TSelf, TValue>` | class | MMCA.Common.Shared.Identifiers |
| 3 | `TokenService` | class | MMCA.Common.Infrastructure.Auth |
| 3 | `ViewAsGrant` | class | MMCA.Common.Domain.Auth |
| 4 | `CookieSessionRefreshMiddlewareExtensions` | class | MMCA.Common.API.SessionCookies |
| 4 | `CookieTokenReader` | class | MMCA.Common.API.SessionCookies |
| 4 | `DataProtectionTwoFactorSecretProtector` | class | MMCA.Common.Infrastructure.Auth.TwoFactor |
| 4 | `IErasableUser` | interface | MMCA.Common.Domain.Auth |
| 4 | `IPasskeyCredentialStore` | interface | MMCA.Common.Application.Auth.Passkeys |
| 4 | `IPermissionGrantStore` | interface | MMCA.Common.Application.Auth.Permissions |
| 4 | `IViewAsGrantStore` | interface | MMCA.Common.Application.Auth.ViewAs |
| 4 | `MachineClient` | class | MMCA.Common.Domain.Auth.MachineClients |
| 4 | `MachineClientSettingsValidator` | class | MMCA.Common.Infrastructure.Auth.MachineClients |
| 4 | `MultiFactorRefusalResultHandler` | class | MMCA.Common.API.Authorization.MultiFactor |
| 4 | `RefreshSession` | class | MMCA.Common.Domain.Auth |
| 4 | `RefuseMachineClientsAttribute` | class | MMCA.Common.API.Authorization |
| 4 | `RegisterRequest` | record struct | MMCA.Common.Shared.Auth.Requests |
| 4 | `SessionCookieStore` | class | MMCA.Common.API.SessionCookies |
| 4 | `SetRolePermissionsRequestValidator` | class | MMCA.Common.Application.Auth.Validation |
| 4 | `SetUserRolesRequestValidator` | class | MMCA.Common.Application.Auth.Validation |
| 4 | `StronglyTypedIdJsonConverterFactory` | class | MMCA.Common.Shared.Identifiers |
| 4 | `ViewAsGrantLogQuery` | class | MMCA.Common.Application.Auth.ViewAs |
| 5 | `AuthenticationServiceLog` | class | MMCA.Common.Application.Auth |
| 5 | `AuthenticationValidators` | class | MMCA.Common.Application.Auth |
| 5 | `CookieSessionRefresher` | class | MMCA.Common.API.SessionCookies |
| 5 | `EmailIdentity` | class | MMCA.Common.Infrastructure.Auth |
| 5 | `IAuthenticationService` | interface | MMCA.Common.Application.Auth |
| 5 | `IMachineClientStore` | interface | MMCA.Common.Application.Auth.MachineClients |
| 5 | `PasskeyChallenges` | class | MMCA.Common.Application.Auth.Passkeys |
| 5 | `RefreshSessionDevice` | class | MMCA.Common.Application.Auth.Sessions |
| 5 | `RefreshSessionSignIn` | record | MMCA.Common.Application.Auth |
| 5 | `ResultHandlerWrapper` | class | MMCA.Common.API.Authorization |
| 5 | `SessionCookieAuthenticationHandler` | class | MMCA.Common.API.SessionCookies |
| 5 | `SoftDeletedUserCache` | class | MMCA.Common.Application.Auth |
| 5 | `StoredPermissionRoleAdministrationService` | class | MMCA.Common.Infrastructure.Auth.Administration |
| 5 | `StronglyTypedIdTypeConverters` | class | MMCA.Common.Shared.Identifiers |
| 5 | `TwoFactorAuthenticator` | class | MMCA.Common.Infrastructure.Auth.TwoFactor |
| 6 | `AuthorizationExtensions` | class | MMCA.Common.API.Authorization |
| 6 | `EmailConfirmationTokenService` | class | MMCA.Common.Infrastructure.Auth |
| 6 | `IRefreshSessionStore` | interface | MMCA.Common.Application.Auth |
| 6 | `LoginProtectionService` | class | MMCA.Common.Infrastructure.Auth |
| 6 | `MachineClientService` | class | MMCA.Common.Application.Auth.MachineClients |
| 6 | `PasskeyService` | class | MMCA.Common.Application.Auth.Passkeys |
| 6 | `PasswordResetTokenService` | class | MMCA.Common.Infrastructure.Auth |
| 6 | `SessionCookieAuthenticationExtensions` | class | MMCA.Common.API.SessionCookies |
| 6 | `SignInLinkTokenService` | class | MMCA.Common.Infrastructure.Auth.SignInLinks |
| 6 | `SoftDeletedUserMarkerWriter` | class | MMCA.Common.Application.Auth.SoftDeletedUsers |
| 6 | `StronglyTypedIdRegistry` | class | MMCA.Common.Shared.Identifiers |
| 7 | `RefreshSessionRevocation` | class | MMCA.Common.Application.Auth |
| 7 | `SignInHistory` | class | MMCA.Common.Application.Auth.Sessions |
| 8 | `AuthenticationServiceBase<TUser>` | class | MMCA.Common.Application.Auth |
| 8 | `AuthSessionIssuer` | class | MMCA.Common.Application.Auth.Sessions |
| 8 | `ClaimBasedUserIdProvider` | class | MMCA.Common.Infrastructure.Context |
| 8 | `Fido2PasskeyCeremony` | class | MMCA.Common.Passkeys |
| 8 | `ICurrentUserService` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Auth |
| 8 | `UserAdministrationServiceBase<TUser, TUserDto>` | class | MMCA.Common.Application.Auth.Administration |
| 8 | `UserSessionsAdministrationService` | class | MMCA.Common.Application.Auth.Administration |
| 9 | `CurrentUserService` | class | MMCA.Common.Infrastructure.Context |
| 9 | `OwnershipHelper` | class | MMCA.Common.API.Authorization |
| 9 | `PasskeysServiceCollectionExtensions` | class | MMCA.Common.Passkeys |
| 9 | `ViewAsService` | class | MMCA.Common.Application.Auth.ViewAs |
| 10 | `OwnerOrAdminFilter` | class | MMCA.Common.API.Authorization |

### G09 - Caching

> `group-09-caching.md` | 12 types | The cache abstraction and its decorator-driven, invalidation-aware integration into the query pipeline.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `CacheKeyPrefixOptions` | class | MMCA.Common.Infrastructure.Caching |
| 0 | `CacheOptions` | class | MMCA.Common.Infrastructure.Caching |
| 0 | `CachePrefixContract` | class | MMCA.Common.Infrastructure.Caching |
| 0 | `IRedisConfigurationOptionsConfigurator` | interface | MMCA.Common.Infrastructure.Caching |
| 0 | `RememberedToken` | record struct | MMCA.Common.Infrastructure.Caching |
| 1 | `CacheKeyNamespace` | class | MMCA.Common.Infrastructure.Caching |
| 1 | `CacheSettings` | class | MMCA.Common.Infrastructure.Caching |
| 1 | `RedisConfigurationOptionsPostConfigure` | class | MMCA.Common.Infrastructure.Caching |
| 2 | `CachePrefixGenerations` | class | MMCA.Common.Infrastructure.Caching |
| 4 | `ICacheService` | interface | MMCA.Common.Application.Interfaces |
| 5 | `HybridCacheService` | class | MMCA.Common.Infrastructure.Caching |
| 5 | `MemoryCacheService` | class | MMCA.Common.Infrastructure.Caching |

### G10 - Notifications (Push + In-App Inbox + Email)

> `group-10-notifications.md` | 58 types | The notification subsystem: push (SignalR), the in-app inbox, email sending, recipient providers, and the thin ADC Notification module host.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `DeviceInstallationRequest` | record | MMCA.Common.Shared.Notifications.PushNotifications |
| 0 | `GetMyNotificationsQuery` | record | MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetInbox |
| 0 | `GetNotificationHistoryQuery` | record | MMCA.Common.Application.Notifications.PushNotifications.UseCases.GetHistory |
| 0 | `GetUnreadNotificationCountQuery` | record | MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetUnreadCount |
| 0 | `IEmailSender` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Mail |
| 0 | `ILiveChannelPublisher` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Notifications |
| 0 | `INotificationRecipientProvider` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Notifications |
| 0 | `IPushNotificationSender` | interface | MMCA.Common.Application.Interfaces.Infrastructure.Notifications |
| 0 | `MarkAllNotificationsReadCommand` | record | MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkAllRead |
| 0 | `MarkNotificationReadCommand` | record | MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkRead |
| 0 | `NotificationPermissions` | class | MMCA.Common.Shared.Notifications |
| 0 | `NotificationScopeKey` | class | MMCA.Common.Shared.Notifications |
| 0 | `PushNotificationStatus` | enum | MMCA.Common.Domain.Notifications.PushNotifications |
| 0 | `SendPushNotificationRequest` | record | MMCA.Common.Shared.Notifications.PushNotifications |
| 0 | `UserNotificationDTO` | record | MMCA.Common.Shared.Notifications.UserNotifications |
| 0 | `UserNotificationExportItemDTO` | record | MMCA.ADC.Notification.Shared.UserNotifications |
| 1 | `AttendeeNotificationRecipientProvider` | class | MMCA.ADC.Notification.Application |
| 1 | `IUserNotificationExportService` | interface | MMCA.ADC.Notification.Shared.UserNotifications |
| 1 | `LiveChannelGrpcService` | class | MMCA.ADC.Notification.Service.Grpc |
| 1 | `LiveChannelPublisherGrpcAdapter` | class | MMCA.ADC.Notification.Contracts |
| 1 | `NotificationFeatures` | class | MMCA.Common.Shared.Notifications |
| 1 | `NullLiveChannelPublisher` | class | MMCA.Common.Infrastructure.Notifications.Live |
| 1 | `NullNotificationRecipientProvider` | class | MMCA.Common.Application.Interfaces.Infrastructure.Notifications |
| 1 | `NullPushNotificationSender` | class | MMCA.Common.Infrastructure.Notifications.Push |
| 1 | `PushNotificationDTO` | record | MMCA.Common.Shared.Notifications.PushNotifications |
| 1 | `SendPushNotificationCommand` | record | MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send |
| 2 | `DisabledUserNotificationExportService` | class | MMCA.ADC.Notification.Shared.UserNotifications |
| 2 | `NotificationHub` | class | MMCA.Common.Infrastructure.Notifications |
| 2 | `PushNotificationCreated` | record | MMCA.Common.Domain.Notifications.PushNotifications.DomainEvents |
| 2 | `SmtpEmailSender` | class | MMCA.Common.Infrastructure.Mail |
| 3 | `NotificationModule` | class | MMCA.ADC.Notification.API |
| 3 | `NotificationPermissionGrants` | class | MMCA.ADC.Notification.Shared.Authorization |
| 3 | `SignalRLiveChannelPublisher` | class | MMCA.Common.Infrastructure.Notifications.Live |
| 3 | `SignalRPushNotificationSender` | class | MMCA.Common.Infrastructure.Notifications.Push |
| 4 | `DependencyInjection` | class | MMCA.ADC.Notification.API |
| 4 | `LiveChannelJoinAuthorizer` | class | MMCA.ADC.Notification.Service.Live |
| 5 | `UserNotification` | class | MMCA.Common.Domain.Notifications.UserNotifications |
| 6 | `PushNotificationInvariants` | class | MMCA.Common.Domain.Notifications.PushNotifications.Invariants |
| 7 | `PushNotification` | class | MMCA.Common.Domain.Notifications.PushNotifications |
| 8 | `GetMyNotificationsHandler` | class | MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetInbox |
| 8 | `GetUnreadNotificationCountHandler` | class | MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetUnreadCount |
| 8 | `MarkAllNotificationsReadHandler` | class | MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkAllRead |
| 8 | `MarkNotificationReadHandler` | class | MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkRead |
| 8 | `PushNotificationDTOMapper` | class | MMCA.Common.Application.Notifications.PushNotifications.DTOs |
| 8 | `PushNotificationDTOProjector` | class | MMCA.Common.Application.Notifications.PushNotifications.DTOs |
| 8 | `SendPushNotificationRequestValidator` | class | MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send |
| 8 | `UserNotificationExportService` | class | MMCA.ADC.Notification.Application |
| 9 | `DependencyInjection` | class | MMCA.ADC.Notification.Application |
| 9 | `DevicesController` | class | MMCA.Common.API.Controllers.Notifications |
| 9 | `GetNotificationHistoryHandler` | class | MMCA.Common.Application.Notifications.PushNotifications.UseCases.GetHistory |
| 9 | `InboxController` | class | MMCA.Common.API.Controllers.Notifications |
| 9 | `NotificationsController` | class | MMCA.Common.API.Controllers.Notifications |
| 9 | `SendPushNotificationHandler` | class | MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send |
| 9 | `UserNotificationExportGrpcService` | class | MMCA.ADC.Notification.Service.Grpc |
| 9 | `UserNotificationExportServiceGrpcAdapter` | class | MMCA.ADC.Notification.Contracts |
| 10 | `DependencyInjection` | class | MMCA.ADC.Notification.Contracts |
| 10 | `DependencyInjection` | class | MMCA.Common.API.Notifications |
| 10 | `DependencyInjection` | class | MMCA.Common.Application.Notifications |

### G11 - Navigation Metadata & Populators (EF-decoupled eager loading)

> `group-11-navigation-populators.md` | 12 types | INavigationMetadata/INavigationPopulator and the loader that hydrate cross-container/cross-source relationships without EF Include coupling ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)).

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `NavigationAttribute` | class | MMCA.Common.Domain.Attributes |
| 0 | `NavigationType` | enum | MMCA.Common.Application.Interfaces.Navigation |
| 1 | `NavigationPropertyInfo` | record | MMCA.Common.Application.Interfaces.Navigation |
| 2 | `INavigationMetadata` | interface | MMCA.Common.Application.Interfaces.Navigation |
| 3 | `NavigationMetadata` | class | MMCA.Common.Application.Interfaces.Navigation |
| 4 | `INavigationPopulator<in TEntity>` | interface | MMCA.Common.Application.Interfaces.Navigation |
| 5 | `NullNavigationPopulator<TEntity>` | class | MMCA.Common.Application.Services |
| 6 | `NavigationLoader` | class | MMCA.Common.Application.Services |
| 8 | `INavigationDescriptor<in TEntity>` | interface | MMCA.Common.Application.Services.Navigation |
| 9 | `ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>` | class | MMCA.Common.Application.Services.Navigation |
| 9 | `DeclarativeNavigationPopulator<TEntity>` | class | MMCA.Common.Application.Services.Navigation |
| 9 | `FKNavigationDescriptor<TEntity, TChild, TChildId>` | class | MMCA.Common.Application.Services.Navigation |

### G12 - API Hosting, Middleware, Idempotency & DTO/Contract Mapping

> `group-12-api-hosting-mapping.md` | 151 types | The ASP.NET Core edge: controller bases, middleware, startup, model binders, JSON converters, feature management, idempotency, correlation, and manual DTO/request mapping.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `ApiParameterDescriptorBackfillProvider` | class | MMCA.Common.API.OpenApi |
| 0 | `ApiVersionReportingResultFilter` | class | MMCA.Common.API.Caching |
| 0 | `AppAssociationOptions` | class | MMCA.Common.API.Startup.Endpoints |
| 0 | `AppleUserNameClaims` | class | MMCA.Common.API.Authentication |
| 0 | `AssemblyReference` | class | MMCA.Common.API |
| 0 | `ClassReference` | class | MMCA.Common.API |
| 0 | `CommonForwardedHeaders` | class | MMCA.Common.API.Startup |
| 0 | `ConcurrencyConflictMetrics` | class | MMCA.Common.API.Concurrency |
| 0 | `DisabledFeatureHandler` | class | MMCA.Common.API.FeatureManagement |
| 0 | `ErrorResources` | class | MMCA.Common.API.Resources |
| 0 | `ErrorResourceSource` | class | MMCA.Common.API.Localization |
| 0 | `EvictOutputCacheAttribute` | class | MMCA.Common.API.Caching |
| 0 | `FeatureFlagAssembly` | record | MMCA.Common.Infrastructure.FeatureFlags |
| 0 | `FeatureFlagLifetime` | enum | MMCA.Common.Shared.FeatureFlags |
| 0 | `FeatureFlagOverrideMode` | enum | MMCA.Common.Shared.FeatureFlags |
| 0 | `FeatureFlagOverrideModelGate` | class | MMCA.Common.Infrastructure.Persistence.FeatureFlags |
| 0 | `FeatureFlagOverrideSettings` | class | MMCA.Common.Application.FeatureFlags |
| 0 | `FeatureFlagValueKind` | enum | MMCA.Common.Shared.FeatureFlags |
| 0 | `IBaseDTO<TIdentifierType>` | interface | MMCA.Common.Shared.DTOs |
| 0 | `IConcurrencyAware` | interface | MMCA.Common.Shared.DTOs |
| 0 | `ICorrelationContext` | interface | MMCA.Common.Application.Interfaces |
| 0 | `IdempotencyMetrics` | class | MMCA.Common.API.Idempotency |
| 0 | `IdempotencyRecord` | record | MMCA.Common.API.Idempotency |
| 0 | `IdempotencySettings` | class | MMCA.Common.API.Idempotency |
| 0 | `IErrorLocalizer` | interface | MMCA.Common.API.Localization |
| 0 | `JwtAudience` | class | MMCA.Common.API.Startup.Auth |
| 0 | `JwtAuthorityExtensions` | class | MMCA.Common.API.Startup.Auth |
| 0 | `JwtForwardingDelegatingHandler` | class | MMCA.Common.Infrastructure.Http |
| 0 | `MiddlewarePipelineStep` | record | MMCA.Common.API.Startup.Pipeline |
| 0 | `MiddlewarePipelineStepNames` | class | MMCA.Common.API.Startup.Pipeline |
| 0 | `NonIdempotentAttribute` | class | MMCA.Common.API.Idempotency |
| 0 | `OidcClaimNormalizer` | class | MMCA.Common.API.Authentication |
| 0 | `OidcProviderSettings` | record | MMCA.Common.API.Authentication |
| 0 | `OpenApiEndpointExtensions` | class | MMCA.Common.API.Startup.Endpoints |
| 0 | `OperationCanceledExceptionHandler` | class | MMCA.Common.API.Middleware |
| 0 | `OptInActionAttribute` | class | MMCA.Common.API.Pagination |
| 0 | `OutboundAddressPolicy` | class | MMCA.Common.Infrastructure.Http |
| 0 | `OutputCacheMetrics` | class | MMCA.Common.API.Caching |
| 0 | `OversizeFormResourceFilter` | class | MMCA.Common.API.Uploads |
| 0 | `QueryFilterModelBinder` | class | MMCA.Common.API.ModelBinders |
| 0 | `RateLimitAlgorithm` | enum | MMCA.Common.API.RateLimiting |
| 0 | `RedisRateLimitLease` | class | MMCA.Common.API.RateLimiting |
| 0 | `RejectedLease` | class | MMCA.Common.RateLimiting |
| 0 | `ServiceHostAuthentication` | enum | MMCA.Common.ServiceHost |
| 0 | `ServiceHostOpenApi` | class | MMCA.Common.ServiceHost |
| 0 | `ServiceInfoResponse` | record | MMCA.Common.API.Controllers |
| 0 | `ServiceInfoV2Response` | record | MMCA.Common.API.Controllers |
| 0 | `SupportedCultures` | class | MMCA.Common.Shared.Globalization |
| 0 | `SupportsChangeFeedAttribute` | class | MMCA.Common.API.Pagination |
| 0 | `SupportsCursorPagingAttribute` | class | MMCA.Common.API.Pagination |
| 0 | `UploadedFileContent` | record | MMCA.Common.API.Uploads |
| 0 | `ValidationExceptionHandler` | class | MMCA.Common.API.Middleware |
| 0 | `ViewAsEndEndpointAttribute` | class | MMCA.Common.API.Middleware |
| 1 | `AppAssociationEndpointExtensions` | class | MMCA.Common.API.Startup.Endpoints |
| 1 | `BaseLookup<TIdentifierType>` | record | MMCA.Common.Shared.DTOs |
| 1 | `CommonForwardedHeadersExtensions` | class | MMCA.Common.API.Startup |
| 1 | `CorrelationIdMiddleware` | class | MMCA.Common.API.Middleware |
| 1 | `DbUpdateExceptionHandler` | class | MMCA.Common.API.Middleware |
| 1 | `DomainExceptionHandler` | class | MMCA.Common.API.Middleware |
| 1 | `ErrorLocalizer` | class | MMCA.Common.API.Localization |
| 1 | `FeatureFlagAttribute` | class | MMCA.Common.Shared.FeatureFlags |
| 1 | `FeatureFlagDescriptor` | record | MMCA.Common.Shared.FeatureFlags |
| 1 | `FeatureFlagOverrideResponse` | record | MMCA.Common.Shared.FeatureFlags |
| 1 | `GlobalExceptionHandler` | class | MMCA.Common.API.Middleware |
| 1 | `JwksEndpointExtensions` | class | MMCA.Common.API.Startup.Endpoints |
| 1 | `MiniProfilerExtensions` | class | MMCA.Common.API.Startup |
| 1 | `OidcProviderRegistry` | class | MMCA.Common.API.Authentication |
| 1 | `PaginationHeaderExtensions` | class | MMCA.Common.API.Pagination |
| 1 | `RateLimitingSettings` | class | MMCA.Common.API.RateLimiting |
| 1 | `RedisFixedWindowRateLimiter` | class | MMCA.Common.API.RateLimiting |
| 1 | `RemainingWindowFixedWindowRateLimiter` | class | MMCA.Common.RateLimiting |
| 1 | `ServiceInfoControllerBase` | class | MMCA.Common.API.Controllers |
| 1 | `SetFeatureFlagOverrideRequest` | record | MMCA.Common.Shared.FeatureFlags |
| 2 | `CsvUpload` | record | MMCA.Common.API.Uploads |
| 2 | `ExternalAuthExtensions` | class | MMCA.Common.API.Authentication |
| 2 | `FeatureFlagDefinitions` | class | MMCA.Common.Infrastructure.FeatureFlags |
| 2 | `FeatureFlagRegistry` | class | MMCA.Common.Shared.FeatureFlags |
| 2 | `FeatureFlagStatusResponse` | record | MMCA.Common.Shared.FeatureFlags |
| 2 | `IEntityControllerBase<TEntityDTO, TIdentifierType>` | interface | MMCA.Common.API.Controllers |
| 2 | `IFeatureFlagOverrideSnapshot` | interface | MMCA.Common.Application.FeatureFlags |
| 2 | `ModuleControllerFeatureProvider` | class | MMCA.Common.API |
| 2 | `OidcDiscoveryEndpointExtensions` | class | MMCA.Common.API.Startup.Endpoints |
| 2 | `PublicEndpointOutputCachePolicy` | class | MMCA.Common.API.Caching |
| 2 | `RateLimitPartitions` | class | MMCA.Common.API.RateLimiting |
| 3 | `ErrorHttpMapping` | class | MMCA.Common.API.Middleware |
| 3 | `FeatureFlagCatalog` | class | MMCA.Common.Infrastructure.FeatureFlags |
| 3 | `IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>` | interface | MMCA.Common.API.Controllers |
| 3 | `IFeatureFlagAdministrationService` | interface | MMCA.Common.Application.FeatureFlags |
| 3 | `IFeatureFlagOverrideStore` | interface | MMCA.Common.Application.FeatureFlags |
| 3 | `ModuleHostContext` | class | MMCA.Common.API.Startup |
| 3 | `OutputCacheOptionsExtensions` | class | MMCA.Common.API.Caching |
| 3 | `SignalRExtensions` | class | MMCA.Common.API.Startup |
| 3 | `StoredOverrideFeatureDefinitionProvider` | class | MMCA.Common.Infrastructure.FeatureFlags |
| 3 | `StronglyTypedIdSchemaTransformer` | class | MMCA.Common.API.OpenApi |
| 3 | `TenantResolutionMiddleware` | class | MMCA.Common.API.Middleware |
| 4 | `FeatureFlagAdministrationService` | class | MMCA.Common.Infrastructure.FeatureFlags |
| 4 | `FeatureFlagOverride` | class | MMCA.Common.Domain.FeatureFlags |
| 4 | `FormFileUploadExtensions` | class | MMCA.Common.API.Uploads |
| 4 | `IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Mapping |
| 4 | `IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Mapping |
| 4 | `MmcaServiceHost` | class | MMCA.Common.ServiceHost |
| 4 | `MmcaServiceHostOptions` | class | MMCA.Common.ServiceHost |
| 4 | `ModuleHostExtensions` | class | MMCA.Common.API.Startup |
| 4 | `OutputCacheEvictionHandler` | class | MMCA.Common.API.Caching |
| 4 | `StronglyTypedIdParameterTransformer` | class | MMCA.Common.API.OpenApi |
| 4 | `SupportsIfMatchAttribute` | class | MMCA.Common.API.Concurrency |
| 4 | `UnhandledResultFailureFilter` | class | MMCA.Common.API.Middleware |
| 5 | `ApiControllerBase` | class | MMCA.Common.API.Controllers |
| 5 | `CsvWriter` | class | MMCA.Common.API.Export |
| 5 | `FeatureFlagOverrideModelBuilderExtensions` | class | MMCA.Common.Infrastructure.Persistence.FeatureFlags |
| 5 | `FeatureFlagOverrideSnapshot` | class | MMCA.Common.Infrastructure.FeatureFlags |
| 5 | `IdempotencyFilter` | class | MMCA.Common.API.Idempotency |
| 5 | `InsecureJwtMetadataWarningStartupFilter` | class | MMCA.Common.API.Startup.Auth |
| 5 | `OutputCacheEvictionExtensions` | class | MMCA.Common.API.Caching |
| 5 | `ServiceHostBuilderExtensions` | class | MMCA.Common.ServiceHost |
| 5 | `ViewAsEndedMarker` | class | MMCA.Common.API.Middleware |
| 5 | `WebApplicationBuilderExtensions` | class | MMCA.Common.API.Startup |
| 6 | `AuditHistoryControllerBase` | class | MMCA.Common.API.Controllers.Administration |
| 6 | `CorrelationContext` | class | MMCA.Common.Infrastructure.Context |
| 6 | `EmailConfirmationControllerBase<TSendCommand, TConfirmCommand>` | class | MMCA.Common.API.Controllers |
| 6 | `EntityCsvExporter<TEntityDTO>` | class | MMCA.Common.API.Export |
| 6 | `FeatureFlagsControllerBase` | class | MMCA.Common.API.Controllers.Administration |
| 6 | `IdempotentAttribute` | class | MMCA.Common.API.Idempotency |
| 6 | `MachineClientsControllerBase` | class | MMCA.Common.API.Controllers.MachineClients |
| 6 | `MachineTokenControllerBase` | class | MMCA.Common.API.Controllers.MachineClients |
| 6 | `OAuthControllerBase` | class | MMCA.Common.API.Controllers |
| 6 | `SignInLinkControllerBase<TSendCommand, TRedeemCommand>` | class | MMCA.Common.API.Controllers.SignInLinks |
| 6 | `ViewAsGrantsAdminControllerBase` | class | MMCA.Common.API.Controllers.Administration |
| 6 | `ViewAsGuardMiddleware` | class | MMCA.Common.API.Middleware |
| 7 | `EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>` | class | MMCA.Common.API.Controllers |
| 8 | `AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>` | class | MMCA.Common.API.Controllers |
| 8 | `CurrentUserTargetingContextAccessor` | class | MMCA.Common.API.FeatureManagement |
| 8 | `PasskeysControllerBase` | class | MMCA.Common.API.Controllers.Passkeys |
| 8 | `PublicCachedReadsAttribute` | class | MMCA.Common.API.Caching |
| 8 | `TwoFactorControllerBase<TBeginCommand, TConfirmCommand, TDisableCommand, TRegenerateCommand>` | class | MMCA.Common.API.Controllers.TwoFactor |
| 8 | `UsersAdminControllerBase<TUserDto>` | class | MMCA.Common.API.Controllers.Administration |
| 9 | `CrudEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest, TUpdateRequest>` | class | MMCA.Common.API.Controllers |
| 9 | `SoftDeletedUserMiddleware` | class | MMCA.Common.API.Middleware |
| 10 | `DataExportControllerBase<TQuery>` | class | MMCA.Common.API.Controllers.Privacy |
| 10 | `EFFeatureFlagOverrideStore` | class | MMCA.Common.Infrastructure.Persistence.FeatureFlags |
| 10 | `LegalAcceptanceControllerBase` | class | MMCA.Common.API.Controllers.Legal |
| 10 | `MiddlewarePipelineBuilder` | class | MMCA.Common.API.Startup.Pipeline |
| 10 | `RolesAdminControllerBase` | class | MMCA.Common.API.Controllers.Administration |
| 10 | `WebApplicationExtensions` | class | MMCA.Common.API.Startup |
| 11 | `DependencyInjection` | class | MMCA.Common.API |
| 11 | `ServiceHostProfiling` | class | MMCA.Common.ServiceHost |
| 12 | `AuthControllerBase` | class | MMCA.Common.API.Controllers |
| 12 | `DatabaseInitializationExtensions` | class | MMCA.Common.API.Startup |
| 12 | `PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>` | class | MMCA.Common.API.Controllers |
| 12 | `ServiceHostApplicationExtensions` | class | MMCA.Common.ServiceHost |
| 13 | `UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>` | class | MMCA.Common.API.Controllers |

### G13 - gRPC & Inter-Service Contracts

> `group-13-grpc-contracts.md` | 17 types | Typed gRPC clients/servers, interceptors, Result-over-the-wire, and the ServiceContract marker for synchronous inter-service calls ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)).

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `CachedToken` | record | MMCA.Common.Grpc.Authentication |
| 0 | `DefaultSchemeGuard` | class | MMCA.Common.Grpc.Authentication |
| 0 | `GrpcWireFormat` | class | MMCA.Common.Grpc |
| 0 | `IServiceTokenProvider` | interface | MMCA.Common.Grpc.Authentication |
| 0 | `JwtForwardingClientInterceptor` | class | MMCA.Common.Grpc.Interceptors |
| 0 | `ServiceContractAttribute` | class | MMCA.Common.Shared.Abstractions |
| 0 | `ServiceTokenDefaults` | class | MMCA.Common.Grpc.Authentication |
| 0 | `ServiceTokenSettings` | class | MMCA.Common.Grpc.Authentication |
| 1 | `ServiceCallerClaimsPrincipalExtensions` | class | MMCA.Common.Grpc.Authentication |
| 1 | `ServiceTokenClientInterceptor` | class | MMCA.Common.Grpc.Interceptors |
| 1 | `ServiceTokenProvider` | class | MMCA.Common.Grpc.Authentication |
| 2 | `ResultFailureException` | class | MMCA.Common.Grpc.Exceptions |
| 2 | `ServiceTokenHttpClientBuilderExtensions` | class | MMCA.Common.Grpc.Authentication |
| 2 | `ServiceTokenServiceCollectionExtensions` | class | MMCA.Common.Grpc.Authentication |
| 3 | `GrpcResultExceptionInterceptor` | class | MMCA.Common.Grpc.Interceptors |
| 3 | `ResultGrpcExtensions` | class | MMCA.Common.Grpc |
| 4 | `DependencyInjection` | class | MMCA.Common.Grpc |

### G14 - Module System, Composition & Configuration

> `group-14-module-system-composition.md` | 138 types | IModule discovery + Kahn-ordered ModuleLoader, the DI composition roots, assembly markers, data-source/database attributes, and options/settings binding.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `ApplicationNamespace` | class | MMCA.Common.Infrastructure.Configuration |
| 0 | `ApplicationSettings` | class | MMCA.Common.Application.Settings |
| 0 | `AssemblyReference` | class | MMCA.Common.Application |
| 0 | `AssemblyReference` | class | MMCA.Common.Infrastructure |
| 0 | `BrokerConsumerKind` | enum | MMCA.Common.Infrastructure.Messaging.Broker |
| 0 | `BrokerDisposition` | record | MMCA.Common.Infrastructure.Messaging.Broker |
| 0 | `BrokerHeaders` | class | MMCA.Common.Infrastructure.Messaging.Broker |
| 0 | `BrokerMetrics` | class | MMCA.Common.Infrastructure.Messaging |
| 0 | `BrokerWire` | class | MMCA.Common.Infrastructure.Messaging |
| 0 | `ClassReference` | class | MMCA.Common.Infrastructure |
| 0 | `ClassReference` | class | MMCA.Common.Application |
| 0 | `CloudAdapterTripwireOptions` | class | MMCA.Common.Infrastructure.Configuration |
| 0 | `Completed` | record | MMCA.Common.Infrastructure.Messaging.Broker |
| 0 | `DecoratorPipelineSeal` | class | MMCA.Common.Application |
| 0 | `ExceptionChain` | class | MMCA.Common.Infrastructure.Diagnostics |
| 0 | `IModuleSeeder` | interface | MMCA.Common.Application.Modules |
| 0 | `InProcessLockHandle` | class | MMCA.Common.Infrastructure.Concurrency |
| 0 | `InternalCommandDeadLetter` | record | MMCA.Common.Application.InternalCommands |
| 0 | `InternalCommandNameAttribute` | class | MMCA.Common.Application.InternalCommands |
| 0 | `IRabbitMqOperations` | interface | MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq |
| 0 | `IUserScopedRequest` | interface | MMCA.Common.Application.Users |
| 0 | `JobClaim` | record | MMCA.Common.Infrastructure.Scheduling |
| 0 | `MessageBusProviders` | class | MMCA.Common.Infrastructure.Messaging.Transports |
| 0 | `MmcaApplicationPipelineBuilder` | class | MMCA.Common.Application |
| 0 | `ModuleSettings` | class | MMCA.Common.Application.Settings |
| 0 | `NativePushPayloads` | class | MMCA.Common.Infrastructure.Notifications.Push |
| 0 | `OutgoingBrokerMessage` | record | MMCA.Common.Infrastructure.Messaging.Broker |
| 0 | `PeriodicBackgroundService` | class | MMCA.Common.Infrastructure.Hosting.Background |
| 0 | `PostgreSqlClaimedMessage` | record | MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql |
| 0 | `PostgreSqlTransportSettings` | class | MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql |
| 0 | `QueryCachePipelineSettings` | class | MMCA.Common.Application.Settings |
| 0 | `RabbitMqConnectionSource` | class | MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq |
| 0 | `RabbitMqHeaders` | class | MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq |
| 0 | `RedisLockHandle` | class | MMCA.Common.Infrastructure.Concurrency |
| 0 | `ScheduledJobEntry` | class | MMCA.Common.Infrastructure.Scheduling |
| 0 | `ScheduledJobOverrideSettings` | class | MMCA.Common.Infrastructure.Scheduling |
| 0 | `SchedulerMetrics` | class | MMCA.Common.Infrastructure.Scheduling |
| 0 | `Scope` | class | MMCA.Common.Application.InternalCommands |
| 0 | `SmtpSettings` | class | MMCA.Common.Infrastructure.Mail |
| 0 | `TwoFactorAttemptKey` | class | MMCA.Common.Application.Users.UseCases.TwoFactor |
| 0 | `UseDatabaseAttribute` | class | MMCA.Common.Infrastructure |
| 0 | `UserDataExportSectionDefaults` | class | MMCA.Common.Application.Users.UseCases.ExportUserData |
| 1 | `BrokerSubscription` | record | MMCA.Common.Infrastructure.Messaging.Broker |
| 1 | `ChannelJoinAuthorizerMissingWarningService` | class | MMCA.Common.Infrastructure.Notifications |
| 1 | `DeadLetter` | record | MMCA.Common.Infrastructure.Messaging.Broker |
| 1 | `GetUserPreferencesQuery` | record | MMCA.Common.Application.Users.UseCases.GetPreferences |
| 1 | `IBrokerPublisher` | interface | MMCA.Common.Infrastructure.Messaging.Broker |
| 1 | `IModule` | interface | MMCA.Common.Application.Modules |
| 1 | `IncomingBrokerMessage` | record | MMCA.Common.Infrastructure.Messaging.Broker |
| 1 | `InProcessDistributedLock` | class | MMCA.Common.Infrastructure.Concurrency |
| 1 | `InternalCommandExecution` | class | MMCA.Common.Application.InternalCommands |
| 1 | `IPostgreSqlMessageStore` | interface | MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql |
| 1 | `IRedeemSignInLinkCommand` | interface | MMCA.Common.Application.Users.UseCases.SignInLinks |
| 1 | `IUserOwnedRequest` | interface | MMCA.Common.Application.Users |
| 1 | `IUserScopedCommand<out TRequest>` | interface | MMCA.Common.Application.Users |
| 1 | `MessageBusSettings` | class | MMCA.Common.Infrastructure.Messaging |
| 1 | `ModulesSettings` | class | MMCA.Common.Application.Settings |
| 1 | `PushNotificationSettings` | class | MMCA.Common.Infrastructure.Notifications.Push |
| 1 | `RabbitMqChannelOperations` | class | MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq |
| 1 | `Redeliver` | record | MMCA.Common.Infrastructure.Messaging.Broker |
| 1 | `SchedulerSettings` | class | MMCA.Common.Infrastructure.Scheduling |
| 1 | `SmtpTransportSecurity` | class | MMCA.Common.Infrastructure.Mail |
| 1 | `UseDataSourceAttribute` | class | MMCA.Common.Infrastructure |
| 1 | `UserDataExportSectionResult` | record | MMCA.Common.Application.Users.UseCases.ExportUserData |
| 2 | `BrokerNaming` | class | MMCA.Common.Infrastructure.Messaging.Broker |
| 2 | `BrokerTransportPolicies` | class | MMCA.Common.Infrastructure.Messaging.Transports |
| 2 | `IBrokerConsumerBuilder` | interface | MMCA.Common.Infrastructure.Messaging.Broker |
| 2 | `IBrokerMessageConsumer` | interface | MMCA.Common.Infrastructure.Messaging.Consumers |
| 2 | `IBrokerReceivePipeline` | interface | MMCA.Common.Infrastructure.Messaging.Broker |
| 2 | `IUserDataExportSection` | interface | MMCA.Common.Application.Users.UseCases.ExportUserData |
| 2 | `ModuleLoader` | class | MMCA.Common.Application.Modules |
| 2 | `PostgreSqlDispositionApplier` | class | MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql |
| 2 | `PostgreSqlPublisher` | class | MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql |
| 2 | `PostgreSqlSchemaMigrator` | class | MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql |
| 2 | `RedisDistributedLock` | class | MMCA.Common.Infrastructure.Concurrency |
| 2 | `UserOwnershipRule` | class | MMCA.Common.Application.Users |
| 3 | `BrokerTopology` | class | MMCA.Common.Infrastructure.Messaging.Broker |
| 3 | `EventUpcasterStartupValidator` | class | MMCA.Common.Infrastructure.Messaging.Consumers |
| 3 | `IInternalCommand` | interface | MMCA.Common.Application.InternalCommands |
| 3 | `IInternalCommandAdministration` | interface | MMCA.Common.Application.InternalCommands |
| 3 | `NullNativePushSender` | class | MMCA.Common.Infrastructure.Notifications.Push |
| 3 | `PostgreSqlReceiverOptions` | record | MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql |
| 3 | `PostgreSqlTransportSql` | class | MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql |
| 3 | `RabbitMqNames` | class | MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq |
| 3 | `UpcastDispatch` | class | MMCA.Common.Infrastructure.Messaging.Consumers |
| 4 | `BeginTwoFactorEnrollmentHandlerBase<TCommand>` | class | MMCA.Common.Application.Users.UseCases.TwoFactor |
| 4 | `BrokerTransportContext` | class | MMCA.Common.Infrastructure.Messaging.Transports |
| 4 | `CloudAdapterTripwire` | class | MMCA.Common.Infrastructure.Configuration |
| 4 | `ConfirmTwoFactorEnrollmentHandlerBase<TCommand>` | class | MMCA.Common.Application.Users.UseCases.TwoFactor |
| 4 | `DeleteUserPushInstallationsInternalCommand` | record | MMCA.Common.Application.Users.UseCases.DeleteUser |
| 4 | `DisableTwoFactorHandlerBase<TCommand>` | class | MMCA.Common.Application.Users.UseCases.TwoFactor |
| 4 | `IDeleteBlobInternalCommand` | interface | MMCA.Common.Application.InternalCommands |
| 4 | `IInternalCommandScheduler` | interface | MMCA.Common.Application.InternalCommands |
| 4 | `NullFileStorageService` | class | MMCA.Common.Infrastructure.Storage |
| 4 | `NullPushDeviceRegistrar` | class | MMCA.Common.Infrastructure.Notifications.Push |
| 4 | `PostgreSqlMessageStore` | class | MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql |
| 4 | `PostgreSqlReceiver` | class | MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql |
| 4 | `RabbitMqProvisioner` | class | MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq |
| 4 | `RegenerateRecoveryCodesHandlerBase<TCommand>` | class | MMCA.Common.Application.Users.UseCases.TwoFactor |
| 4 | `UserEmailResources` | class | MMCA.Common.Application.Users.Emails |
| 5 | `AmbientOrigin` | class | MMCA.Common.Infrastructure.Context |
| 5 | `DeleteBlobInternalCommandHandlerBase<TCommand>` | class | MMCA.Common.Application.InternalCommands |
| 5 | `DeleteUserPushInstallationsInternalCommandHandler` | class | MMCA.Common.Application.Users.UseCases.DeleteUser |
| 5 | `IBrokerTransport` | interface | MMCA.Common.Infrastructure.Messaging.Transports |
| 5 | `OriginSnapshot` | record | MMCA.Common.Infrastructure.Context |
| 5 | `RabbitMqDispositionApplier` | class | MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq |
| 5 | `RabbitMqPublisher` | class | MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq |
| 5 | `RestoreHandle` | class | MMCA.Common.Infrastructure.Context |
| 5 | `ScopedUserOverride` | class | MMCA.Common.Infrastructure.Context |
| 5 | `UserSessionExportDTO` | record | MMCA.Common.Application.Users.UseCases.ExportUserData |
| 6 | `ChangePreferencesCommandValidatorBase<TCommand>` | class | MMCA.Common.Application.Users.UseCases.ChangePreferences |
| 6 | `ConsumerOriginRestore` | class | MMCA.Common.Infrastructure.Messaging.Consumers |
| 6 | `PostgreSqlBrokerTransport` | class | MMCA.Common.Infrastructure.Messaging.Transports.PostgreSql |
| 6 | `RabbitMqReceiver` | class | MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq |
| 6 | `TenantContext` | class | MMCA.Common.Infrastructure.Context |
| 7 | `RabbitMqBrokerTransport` | class | MMCA.Common.Infrastructure.Messaging.Transports.RabbitMq |
| 7 | `RefreshSessionUserDataExportSection` | class | MMCA.Common.Application.Users.UseCases.ExportUserData |
| 8 | `ChangePasswordHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application.Users.UseCases.ChangePassword |
| 8 | `ChangePreferencesHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application.Users.UseCases.ChangePreferences |
| 8 | `ConfirmEmailHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application.Users.UseCases.EmailConfirmation |
| 8 | `DeleteUserHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application.Users.UseCases.DeleteUser |
| 8 | `ExportUserDataHandlerBase<TUser, TQuery>` | class | MMCA.Common.Application.Users.UseCases.ExportUserData |
| 8 | `ForgotPasswordHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application.Users.UseCases.ForgotPassword |
| 8 | `GetUserPreferencesHandlerBase<TUser>` | class | MMCA.Common.Application.Users.UseCases.GetPreferences |
| 8 | `RedeemSignInLinkHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application.Users.UseCases.SignInLinks |
| 8 | `ResetPasswordHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application.Users.UseCases.ResetPassword |
| 8 | `SendEmailConfirmationHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application.Users.UseCases.EmailConfirmation |
| 8 | `SendSignInLinkHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application.Users.UseCases.SignInLinks |
| 8 | `SoftDeletedUserValidator<TUser>` | class | MMCA.Common.Application.Users |
| 8 | `UpcastingIntegrationEventConsumer<TEvent>` | class | MMCA.Common.Infrastructure.Messaging.Consumers |
| 9 | `BrokerConsumerBuilder` | class | MMCA.Common.Infrastructure.Messaging.Consumers |
| 9 | `CreateMigrationProofTable` | class | MMCA.Common.Infrastructure.Tests.MigrationsFixture |
| 9 | `ImpersonatingCurrentUserService` | class | MMCA.Common.Infrastructure.Context |
| 10 | `BrokerReceivePipeline` | class | MMCA.Common.Infrastructure.Messaging.Consumers |
| 10 | `ScheduledJobRunner` | class | MMCA.Common.Infrastructure.Scheduling |
| 11 | `DependencyInjection` | class | MMCA.Common.Application |
| 11 | `StartupConfigurationSummaryService` | class | MMCA.Common.Infrastructure.Configuration |
| 14 | `DependencyInjection` | class | MMCA.Common.Infrastructure |

### G15 - Common UI Framework (MudBlazor components, theme, base pages)

> `group-15-common-ui-framework.md` | 309 types | Reusable Blazor building blocks: the data-grid list page base, theme, common pages/services, and UI extensions shared by every consumer app.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AbsoluteUrlAttribute` | class | MMCA.Common.UI.Validation |
| 0 | `ApiEndpointUrl` | class | MMCA.Common.UI.Web.Security |
| 0 | `ApiFileDownloadButton` | class | MMCA.Common.UI.Components.Forms |
| 0 | `AppUserAgent` | class | MMCA.Common.UI.Services.Auth.Devices |
| 0 | `AuthEmailPrefill` | class | MMCA.Common.UI.Services.Navigation |
| 0 | `AuthenticatedNoStoreExtensions` | class | MMCA.Common.UI.Web.Hosting |
| 0 | `BackfillGate` | class | MMCA.Common.UI.Services.Auth.Devices |
| 0 | `BackNavigationResult` | record | MMCA.Common.UI.Services.Navigation |
| 0 | `BlazorCircuitLimitSettings` | class | MMCA.Common.UI.Web.Hardening |
| 0 | `BlazorCspSettings` | class | MMCA.Common.UI.Web.Security |
| 0 | `BrandColors` | class | MMCA.Common.UI.Theme |
| 0 | `BreakpointConstants` | class | MMCA.Common.UI.Common |
| 0 | `BrowserOriginHandler` | class | MMCA.Common.UI.Web.Services |
| 0 | `BuiltInStrings` | class | MMCA.Common.UI.Globalization |
| 0 | `CachedPage` | record | MMCA.Common.UI.Pages.Common |
| 0 | `CancellablePageBase` | class | MMCA.Common.UI.Pages.Common |
| 0 | `ChannelReferenceCounter` | class | MMCA.Common.UI.Services.Notifications |
| 0 | `ColumnFilterState` | record | MMCA.Common.UI.Services |
| 0 | `ComponentLifetimeExtensions` | class | MMCA.Common.UI.Common |
| 0 | `ConfirmationState` | enum | MMCA.Common.UI.Pages.Auth |
| 0 | `CreateSubmitOptions` | record | MMCA.Common.UI.Pages.Common |
| 0 | `CultureDelegatingHandler` | class | MMCA.Common.UI.Services.Culture |
| 0 | `DetailLoadState` | enum | MMCA.Common.UI.Components.PageState |
| 0 | `E2eRenderMode` | class | MMCA.Common.UI.Web.Hosting |
| 0 | `EmailedLinkReader` | class | MMCA.Common.UI.Pages.Auth.Links |
| 0 | `ErrorMessages` | class | MMCA.Common.UI.Pages.Common |
| 0 | `FeatureFlagAdminResources` | class | MMCA.Common.UI.Pages.Administration |
| 0 | `FeatureFlagAdminUIOptions` | class | MMCA.Common.UI.Services.Administration |
| 0 | `FilePickerButton` | class | MMCA.Common.UI.Components.Forms |
| 0 | `FocusOnInAppNavigate` | class | MMCA.Common.UI.Layout |
| 0 | `HandoffBody` | record | MMCA.Common.UI.Web.SameOriginProxy |
| 0 | `IApiSettings` | interface | MMCA.Common.UI.Common.Settings |
| 0 | `IAppDialogService` | interface | MMCA.Common.UI.Common.Interfaces |
| 0 | `ICultureApplier` | interface | MMCA.Common.UI.Services.Culture |
| 0 | `IDeviceMetadataReporter` | interface | MMCA.Common.UI.Services.Auth.Devices |
| 0 | `IForbiddenReExecutionDetector` | interface | MMCA.Common.UI.Services.Navigation |
| 0 | `IHomePageContent` | interface | MMCA.Common.UI.Common.Interfaces |
| 0 | `IInitialThemeModeSource` | interface | MMCA.Common.UI.Theme |
| 0 | `IModelValidator` | interface | MMCA.Common.UI.Validation |
| 0 | `InAppDiagnosticsOptions` | class | MMCA.Common.UI.Services.Diagnostics |
| 0 | `InAppLogEntry` | record | MMCA.Common.UI.Services.Diagnostics |
| 0 | `INotificationScopeProvider` | interface | MMCA.Common.UI.Services.Notifications |
| 0 | `IPublicLinkBuilder` | interface | MMCA.Common.UI.Services.Navigation |
| 0 | `ISecureTokenStore` | interface | MMCA.Common.UI.Services.Auth.Tokens |
| 0 | `ISessionCookieSync` | interface | MMCA.Common.UI.Services.Auth |
| 0 | `ITokenRefresher` | interface | MMCA.Common.UI.Services.Auth.Tokens |
| 0 | `ITokenStorageService` | interface | MMCA.Common.UI.Services.Auth.Tokens |
| 0 | `IUserPreferenceWriter` | interface | MMCA.Common.UI.Services.Preferences |
| 0 | `JwtTokenInfo` | class | MMCA.Common.UI.Services.Auth.Tokens |
| 0 | `LatestLoadGuard` | class | MMCA.Common.UI.Common |
| 0 | `LayoutSettings` | class | MMCA.Common.UI.Common.Settings |
| 0 | `LazyJsModule` | class | MMCA.Common.UI.Services |
| 0 | `LegalSettings` | class | MMCA.Common.UI.Common.Settings |
| 0 | `LinkState` | enum | MMCA.Common.UI.Pages.Auth.SignInLinks |
| 0 | `LoginRefusal` | enum | MMCA.Common.UI.Services.Auth.TwoFactor |
| 0 | `MachineClientAdminResources` | class | MMCA.Common.UI.Pages.Administration |
| 0 | `MudTranslations` | class | MMCA.Common.UI.Resources |
| 0 | `NavGroup` | record | MMCA.Common.UI.Common |
| 0 | `NavSection` | enum | MMCA.Common.UI.Common |
| 0 | `NotificationBellOptions` | class | MMCA.Common.UI.Common.Settings |
| 0 | `NotificationPageNotFoundStatus` | class | MMCA.Common.UI.Notifications |
| 0 | `NotificationPageRequirement` | class | MMCA.Common.UI.Notifications |
| 0 | `NotificationState` | class | MMCA.Common.UI.Services.Notifications |
| 0 | `OfflineWriteOptions` | record | MMCA.Common.UI.Services.Offline |
| 0 | `OfflineWriteOutcome` | enum | MMCA.Common.UI.Services.Offline |
| 0 | `OfflineWriteQueueOptions` | class | MMCA.Common.UI.Services.Offline |
| 0 | `OidcProviderOption` | record | MMCA.Common.UI.Services.Auth.OAuth |
| 0 | `OptionalEmailAttribute` | class | MMCA.Common.UI.Validation |
| 0 | `PagePermissionPolicy` | class | MMCA.Common.UI.Authorization |
| 0 | `PagePermissionRequirement` | record | MMCA.Common.UI.Authorization |
| 0 | `PendingAttempt` | record | MMCA.Common.UI.Services.Auth.OAuth |
| 0 | `PermissionGroup` | record | MMCA.Common.UI.Pages.Administration |
| 0 | `PersistedGridState` | record | MMCA.Common.UI.Pages.Common |
| 0 | `PersistedTally` | class | MMCA.Common.UI.Common |
| 0 | `PhoneDeliveryLine` | record | MMCA.Common.UI.Pages.Notifications |
| 0 | `ProxyResponseMode` | enum | MMCA.Common.UI.Web.SameOriginProxy |
| 0 | `PseudoLocalizer` | class | MMCA.Common.UI.Globalization |
| 0 | `QrErrorCorrectionLevel` | enum | MMCA.Common.UI.Components.Sharing |
| 0 | `QueryStringCodec` | class | MMCA.Common.UI.Services |
| 0 | `RatingStars` | class | MMCA.Common.UI.Components.Ratings |
| 0 | `RazorComponentsEndpointExtensions` | class | MMCA.Common.UI.Web.Hosting |
| 0 | `RegistrationSettings` | class | MMCA.Common.UI.Common.Settings |
| 0 | `ReturnUrlProtector` | class | MMCA.Common.UI.Services.Navigation |
| 0 | `RoleAdminEditResources` | class | MMCA.Common.UI.Pages.Administration |
| 0 | `RoleAdminListResources` | class | MMCA.Common.UI.Pages.Administration |
| 0 | `RoutePaths` | class | MMCA.Common.UI.Common |
| 0 | `SameOriginApiProxyMarker` | class | MMCA.Common.UI.Web.SameOriginProxy |
| 0 | `SameOriginApiProxySettings` | class | MMCA.Common.UI.Web.SameOriginProxy |
| 0 | `SameOriginProxyHeaders` | class | MMCA.Common.UI.Services.Auth |
| 0 | `SameOriginProxyInvoker` | class | MMCA.Common.UI.Web.SameOriginProxy |
| 0 | `ServiceWorkerEndpointExtensions` | class | MMCA.Common.UI.Web.Pwa |
| 0 | `SharedResource` | class | MMCA.Common.UI.Resources |
| 0 | `SignInSettings` | class | MMCA.Common.UI.Common.Settings |
| 0 | `StaleToastSweeper` | class | MMCA.Common.UI.Components.Notifications |
| 0 | `StringLocalizerPluralExtensions` | class | MMCA.Common.UI.Globalization |
| 0 | `SupportAccessLogResources` | class | MMCA.Common.UI.Pages.Administration |
| 0 | `ThemeInterop` | class | MMCA.Common.UI.Theme |
| 0 | `ToastSeverity` | enum | MMCA.Common.UI.Common.Interfaces |
| 0 | `TokenAcquisition` | class | MMCA.Common.UI.Services.Auth.Tokens |
| 0 | `TokenPair` | record | MMCA.Common.UI.Web.SameOriginProxy |
| 0 | `TrustedCallerHandler` | class | MMCA.Common.UI.Web.Security |
| 0 | `TwoFactorPageRequirement` | class | MMCA.Common.UI.TwoFactor |
| 0 | `TwoFactorPageState` | enum | MMCA.Common.UI.Pages.Auth.TwoFactor |
| 0 | `UIModuleConfiguration` | class | MMCA.Common.UI.Common.Settings |
| 0 | `UiRateLimitingSettings` | class | MMCA.Common.UI.Web.Hardening |
| 0 | `UISharedAssemblyReference` | class | MMCA.Common.UI |
| 0 | `UnboundedReconnectPolicy` | class | MMCA.Common.UI.Services.Notifications |
| 0 | `UserAdminListResources` | class | MMCA.Common.UI.Pages.Administration |
| 0 | `UserPreferences` | record | MMCA.Common.UI.Services.Preferences |
| 0 | `UserPreferencesRequest` | record | MMCA.Common.UI.Services.Preferences |
| 0 | `ViewAsOverlayTreatment` | record struct | MMCA.Common.UI.Web.SameOriginProxy |
| 1 | `ApiSettings` | class | MMCA.Common.UI.Common.Settings |
| 1 | `AppLockInertBackground` | class | MMCA.Common.UI.Components.Capabilities |
| 1 | `AuthFieldMessages` | class | MMCA.Common.UI.Resources |
| 1 | `BlazorCspSettingsValidator` | class | MMCA.Common.UI.Web.Security |
| 1 | `BoundedCircuitHandler` | class | MMCA.Common.UI.Web.Hardening |
| 1 | `ClientConfigUiSections` | class | MMCA.Common.UI.Web.ClientConfig |
| 1 | `ColorModeStamp` | class | MMCA.Common.UI.Theme |
| 1 | `DataAnnotationsModelValidator` | class | MMCA.Common.UI.Validation |
| 1 | `DeviceMetadataReporting` | class | MMCA.Common.UI.Services.Auth.Devices |
| 1 | `EndpointCultureApplier` | class | MMCA.Common.UI.Services.Culture |
| 1 | `HasPagePermissionAttribute` | class | MMCA.Common.UI.Authorization |
| 1 | `HttpContextForbiddenReExecutionDetector` | class | MMCA.Common.UI.Web.Services |
| 1 | `InAppDiagnosticsOptionsValidator` | class | MMCA.Common.UI.Services.Diagnostics |
| 1 | `InfiniteScrollObserver<TOwner>` | class | MMCA.Common.UI.Components.Lists |
| 1 | `InvariantMudLocalizationInterceptor` | class | MMCA.Common.UI.Globalization |
| 1 | `IOAuthUISettings` | interface | MMCA.Common.UI.Services.Auth.OAuth |
| 1 | `IOidcDiscoveryUIService` | interface | MMCA.Common.UI.Services.Auth.OAuth |
| 1 | `IPendingToastService` | interface | MMCA.Common.UI.Common.Interfaces |
| 1 | `ISessionAwareTokenRefresher` | interface | MMCA.Common.UI.Services.Auth.Tokens |
| 1 | `ISessionAwareTokenStorage` | interface | MMCA.Common.UI.Services.Auth.Tokens |
| 1 | `IToastService` | interface | MMCA.Common.UI.Common.Interfaces |
| 1 | `IUserPreferenceReader` | interface | MMCA.Common.UI.Services.Preferences |
| 1 | `JsFetchSessionCookieSync` | class | MMCA.Common.UI.Services.Auth |
| 1 | `ListPageState` | record | MMCA.Common.UI.Services |
| 1 | `MauiBackNavigationBridge` | class | MMCA.Common.UI.Services.Navigation |
| 1 | `MmcaBlazorWebHostOptions` | class | MMCA.Common.UI.Web.Hosting |
| 1 | `MmcaCultureBootstrap` | class | MMCA.Common.UI.Services.Culture |
| 1 | `MudAppDialogService` | class | MMCA.Common.UI.Services |
| 1 | `NavigationHistoryService` | class | MMCA.Common.UI.Services.Navigation |
| 1 | `NavigationPublicLinkBuilder` | class | MMCA.Common.UI.Services.Navigation |
| 1 | `NavItem` | record | MMCA.Common.UI.Common |
| 1 | `NoForbiddenReExecutionDetector` | class | MMCA.Common.UI.Services.Navigation |
| 1 | `NotificationSendModel` | class | MMCA.Common.UI.Pages.Notifications |
| 1 | `NullDeviceMetadataReporter` | class | MMCA.Common.UI.Services.Auth.Devices |
| 1 | `NullNotificationScopeProvider` | class | MMCA.Common.UI.Services.Notifications |
| 1 | `OAuthFlowStateStore` | class | MMCA.Common.UI.Services.Auth.OAuth |
| 1 | `OfflineFirstPageSnapshot<TItem>` | class | MMCA.Common.UI.Pages.Common |
| 1 | `PagePermissionAuthorizationHandler` | class | MMCA.Common.UI.Authorization |
| 1 | `PasswordComplexityAttribute` | class | MMCA.Common.UI.Pages.Auth |
| 1 | `PendingToast` | record | MMCA.Common.UI.Services |
| 1 | `PendingWrite` | record | MMCA.Common.UI.Services.Offline |
| 1 | `PrerenderStateBudget` | class | MMCA.Common.UI.Common |
| 1 | `PseudoStringLocalizer` | class | MMCA.Common.UI.Globalization |
| 1 | `RatingInput` | class | MMCA.Common.UI.Components.Ratings |
| 1 | `ResxMudLocalizer` | class | MMCA.Common.UI.Globalization |
| 1 | `SameOriginApiProxySettingsValidator` | class | MMCA.Common.UI.Web.SameOriginProxy |
| 1 | `SameOriginProxyRequestHandler` | class | MMCA.Common.UI.Services.Auth |
| 1 | `SessionHandoffProtector` | class | MMCA.Common.UI.Web.SameOriginProxy |
| 1 | `Subscription` | class | MMCA.Common.UI.Services.Auth.TwoFactor |
| 1 | `ThemeService` | class | MMCA.Common.UI.Theme |
| 1 | `TokenHydrationWarmup` | class | MMCA.Common.UI.Services.Auth.Tokens |
| 1 | `UserAgentSummary` | class | MMCA.Common.UI.Services.Auth.Devices |
| 1 | `ViewAsBanner` | class | MMCA.Common.UI.Components.Auth |
| 1 | `ViewAsButton` | class | MMCA.Common.UI.Components.Auth |
| 1 | `ViewerTimeZone` | class | MMCA.Common.UI.Services.Culture |
| 2 | `ApiSettingsValidator` | class | MMCA.Common.UI.Common.Settings |
| 2 | `AuthenticatedServiceBase` | class | MMCA.Common.UI.Services.Api |
| 2 | `BiometricGate` | class | MMCA.Common.UI.Components.Capabilities |
| 2 | `BlazorCircuitLimitExtensions` | class | MMCA.Common.UI.Web.Hardening |
| 2 | `BlazorCspPolicyProvider` | class | MMCA.Common.UI.Web.Security |
| 2 | `ClientConfigBuilder` | class | MMCA.Common.UI.Web.ClientConfig |
| 2 | `ClientConfigEndpointExtensions` | class | MMCA.Common.UI.Web.ClientConfig |
| 2 | `ConfigurationOAuthUISettings` | class | MMCA.Common.UI.Services.Auth.OAuth |
| 2 | `DefaultOAuthUISettings` | class | MMCA.Common.UI.Services.Auth.OAuth |
| 2 | `ForgotPasswordModel` | class | MMCA.Common.UI.Pages.Auth |
| 2 | `HandoffSessionCookieSync` | class | MMCA.Common.UI.Web.SameOriginProxy |
| 2 | `HandoffTokenRefresher` | class | MMCA.Common.UI.Web.SameOriginProxy |
| 2 | `InfiniteScrollSentinel` | class | MMCA.Common.UI.Components.Lists |
| 2 | `IUIModule` | interface | MMCA.Common.UI.Common.Interfaces |
| 2 | `ListPageQueryStateService` | class | MMCA.Common.UI.Services |
| 2 | `ListPageStateService` | class | MMCA.Common.UI.Services |
| 2 | `LocalizedDataAnnotationsValidator` | class | MMCA.Common.UI.Validation |
| 2 | `LoginModel` | class | MMCA.Common.UI.Pages.Auth |
| 2 | `MmcaClientConfigBootstrap` | class | MMCA.Common.UI.Common.Settings |
| 2 | `MMCATheme` | class | MMCA.Common.UI.Theme |
| 2 | `ModelValidation` | class | MMCA.Common.UI.Validation |
| 2 | `MudToastService` | class | MMCA.Common.UI.Services |
| 2 | `MultiFactorRequiredSignal` | class | MMCA.Common.UI.Services.Auth.TwoFactor |
| 2 | `NavUnit` | record | MMCA.Common.UI.Layout |
| 2 | `OidcDiscoveryUIService` | class | MMCA.Common.UI.Services.Auth.OAuth |
| 2 | `PendingToastService` | class | MMCA.Common.UI.Services |
| 2 | `PseudoStringLocalizerFactory` | class | MMCA.Common.UI.Globalization |
| 2 | `RecoveryCodesPanel` | class | MMCA.Common.UI.Pages.Auth.TwoFactor |
| 2 | `RegisterModel` | class | MMCA.Common.UI.Pages.Auth |
| 2 | `ResetPassword` | class | MMCA.Common.UI.Pages.Auth |
| 2 | `ResetPasswordModel` | class | MMCA.Common.UI.Pages.Auth |
| 2 | `SameOriginProxyTokenRefresher` | class | MMCA.Common.UI.Services.Auth.Tokens |
| 2 | `SecureStoreTokenStorageService` | class | MMCA.Common.UI.Services.Auth.Tokens |
| 2 | `SignInHistoryTable` | class | MMCA.Common.UI.Components.Auth |
| 2 | `TokenOwner` | record | MMCA.Common.UI.Services.Auth |
| 2 | `UiRateLimitingExtensions` | class | MMCA.Common.UI.Web.Hardening |
| 2 | `UserSessionsTable` | class | MMCA.Common.UI.Components.Auth |
| 2 | `WasmTokenStorageService` | class | MMCA.Common.UI.Services.Auth.Tokens |
| 3 | `AuditHistoryPanel` | class | MMCA.Common.UI.Components.Auditing |
| 3 | `AuthDelegatingHandler` | class | MMCA.Common.UI.Services.Auth |
| 3 | `CreatePageBase` | class | MMCA.Common.UI.Pages.Common |
| 3 | `DetailPageBase` | class | MMCA.Common.UI.Pages.Common |
| 3 | `FieldRefusal` | record struct | MMCA.Common.UI.Components.Auth |
| 3 | `FlagRow` | record | MMCA.Common.UI.Pages.Administration |
| 3 | `HttpResultExecutor` | class | MMCA.Common.UI.Services.Api |
| 3 | `IAuditHistoryUIService` | interface | MMCA.Common.UI.Services.Auditing |
| 3 | `IdempotentReadRetry` | class | MMCA.Common.UI.Services.Api |
| 3 | `IEmailConfirmationUIService` | interface | MMCA.Common.UI.Services.Auth |
| 3 | `IEntityService<TEntityDTO, TIdentifierType>` | interface | MMCA.Common.UI.Common.Interfaces |
| 3 | `IFeatureFlagAdminUIService` | interface | MMCA.Common.UI.Services.Administration |
| 3 | `ILegalAcceptanceUIService` | interface | MMCA.Common.UI.Services.Legal |
| 3 | `IMachineClientAdminUIService` | interface | MMCA.Common.UI.Services.Administration |
| 3 | `InAppLogBuffer` | class | MMCA.Common.UI.Services.Diagnostics |
| 3 | `INotificationInboxUIService` | interface | MMCA.Common.UI.Services.Notifications |
| 3 | `IOfflineWriteHandler` | interface | MMCA.Common.UI.Services.Offline |
| 3 | `IPasskeyUIService` | interface | MMCA.Common.UI.Services.Auth |
| 3 | `IPushNotificationUIService` | interface | MMCA.Common.UI.Services.Notifications |
| 3 | `IRoleAdminUIService` | interface | MMCA.Common.UI.Services.Administration |
| 3 | `ISignInLinkUIService` | interface | MMCA.Common.UI.Services.Auth |
| 3 | `ITwoFactorUIService` | interface | MMCA.Common.UI.Services.Auth.TwoFactor |
| 3 | `IUserAdminActionsUIService` | interface | MMCA.Common.UI.Services.Administration |
| 3 | `IViewAsGrantsUIService` | interface | MMCA.Common.UI.Services.Administration |
| 3 | `JwtAuthenticationStateProvider` | class | MMCA.Common.UI.Services.Auth |
| 3 | `ListPageActions` | class | MMCA.Common.UI.Pages.Common |
| 3 | `LoginRefusals` | class | MMCA.Common.UI.Services.Auth.TwoFactor |
| 3 | `MmcaBlazorWebPipelineOptions` | class | MMCA.Common.UI.Web.Hosting |
| 3 | `MobileInfiniteScrollList<TItem>` | class | MMCA.Common.UI.Components.Lists |
| 3 | `MultiFactorRequiredListener` | class | MMCA.Common.UI.Components.Auth |
| 3 | `OfflineWriteSettledEventArgs` | class | MMCA.Common.UI.Services.Offline |
| 3 | `PagedReadAll` | class | MMCA.Common.UI.Services.Api |
| 3 | `PagePermissionPolicyConfigurator` | class | MMCA.Common.UI.Authorization |
| 3 | `TwoFactorUIModule` | class | MMCA.Common.UI.TwoFactor |
| 4 | `ApiUserPreferenceReader` | class | MMCA.Common.UI.Services.Preferences |
| 4 | `ApiUserPreferenceWriter` | class | MMCA.Common.UI.Services.Preferences |
| 4 | `AuditHistoryService` | class | MMCA.Common.UI.Services.Auditing |
| 4 | `ChangePasswordCard` | class | MMCA.Common.UI.Components.Auth |
| 4 | `ChannelSubscription` | class | MMCA.Common.UI.Services.Notifications |
| 4 | `ChildEntityServiceBase` | class | MMCA.Common.UI.Services.Api |
| 4 | `ConfirmEmail` | class | MMCA.Common.UI.Pages.Auth |
| 4 | `ConnectionRestoredSubscription` | class | MMCA.Common.UI.Services.Notifications |
| 4 | `DataGridListPageBase<TDto>` | class | MMCA.Common.UI.Pages.Common |
| 4 | `DirectApiTokenRefresher` | class | MMCA.Common.UI.Services.Auth.Tokens |
| 4 | `EmailConfirmationUIService` | class | MMCA.Common.UI.Services.Auth |
| 4 | `EntityServiceBase<TEntityDTO, TIdentifierType>` | class | MMCA.Common.UI.Services.Api |
| 4 | `FeatureFlagAdmin` | class | MMCA.Common.UI.Pages.Administration |
| 4 | `FeatureFlagAdminService` | class | MMCA.Common.UI.Services.Administration |
| 4 | `InAppLogger` | class | MMCA.Common.UI.Services.Diagnostics |
| 4 | `InAppLoggerProvider` | class | MMCA.Common.UI.Services.Diagnostics |
| 4 | `IOfflineWriteQueue` | interface | MMCA.Common.UI.Services.Offline |
| 4 | `IUserAdminUIService<TUserDto>` | interface | MMCA.Common.UI.Services.Administration |
| 4 | `LegalAcceptanceUIService` | class | MMCA.Common.UI.Services.Legal |
| 4 | `ListPageShell<TItem>` | class | MMCA.Common.UI.Components.Lists |
| 4 | `Login` | class | MMCA.Common.UI.Pages.Auth |
| 4 | `MachineClientAdmin` | class | MMCA.Common.UI.Pages.Administration |
| 4 | `MachineClientAdminService` | class | MMCA.Common.UI.Services.Administration |
| 4 | `NotificationHubService` | class | MMCA.Common.UI.Services.Notifications |
| 4 | `NotificationInbox` | class | MMCA.Common.UI.Pages.Notifications |
| 4 | `NotificationInboxService` | class | MMCA.Common.UI.Services.Notifications |
| 4 | `PasskeySignInButton` | class | MMCA.Common.UI.Components.Auth |
| 4 | `PasskeysPanel` | class | MMCA.Common.UI.Components.Auth |
| 4 | `Register` | class | MMCA.Common.UI.Pages.Auth |
| 4 | `ResultUiExtensions` | class | MMCA.Common.UI.Common |
| 4 | `RoleAdminEdit` | class | MMCA.Common.UI.Pages.Administration |
| 4 | `RoleAdminList` | class | MMCA.Common.UI.Pages.Administration |
| 4 | `RoleAdminService` | class | MMCA.Common.UI.Services.Administration |
| 4 | `SameOriginProxyTransformer` | class | MMCA.Common.UI.Web.SameOriginProxy |
| 4 | `SignInLink` | class | MMCA.Common.UI.Pages.Auth.SignInLinks |
| 4 | `SupportAccessLog` | class | MMCA.Common.UI.Pages.Administration |
| 4 | `TwoFactorEnrollmentPanel` | class | MMCA.Common.UI.Pages.Auth.TwoFactor |
| 4 | `TwoFactorUIService` | class | MMCA.Common.UI.Services.Auth.TwoFactor |
| 4 | `UserAdminList<TUser>` | class | MMCA.Common.UI.Pages.Administration |
| 4 | `ViewAsGrantsService` | class | MMCA.Common.UI.Services.Administration |
| 5 | `DependencyInjection` | class | MMCA.Common.UI.Services.Diagnostics |
| 5 | `DependencyInjection` | class | MMCA.Common.UI.TwoFactor |
| 5 | `EmailConfirmationResendPrompt` | class | MMCA.Common.UI.Components.Auth |
| 5 | `IAuthUIService` | interface | MMCA.Common.UI.Services.Auth |
| 5 | `MoneyExtensions` | class | MMCA.Common.UI.Extensions |
| 5 | `NotificationRoutePaths` | class | MMCA.Common.UI.Common |
| 5 | `OfflineWriteQueue` | class | MMCA.Common.UI.Services.Offline |
| 5 | `PushNotificationService` | class | MMCA.Common.UI.Services.Notifications |
| 5 | `SameOriginApiProxyEndpoint` | class | MMCA.Common.UI.Web.SameOriginProxy |
| 5 | `ServerTokenStorageService` | class | MMCA.Common.UI.Web.Services |
| 5 | `UserAdminService<TUserDto>` | class | MMCA.Common.UI.Services.Administration |
| 6 | `AuthUIService` | class | MMCA.Common.UI.Services.Auth |
| 6 | `BlazorWebHostExtensions` | class | MMCA.Common.UI.Web.Hosting |
| 6 | `DependencyInjection` | class | MMCA.Common.UI.Web |
| 6 | `NotificationBell` | class | MMCA.Common.UI.Components.Notifications |
| 6 | `NotificationList` | class | MMCA.Common.UI.Pages.Notifications |
| 6 | `NotificationSend` | class | MMCA.Common.UI.Pages.Notifications |
| 6 | `SameOriginApiProxyServiceExtensions` | class | MMCA.Common.UI.Web.SameOriginProxy |
| 6 | `SessionHandoffEndpoints` | class | MMCA.Common.UI.Web.SameOriginProxy |
| 6 | `Sessions` | class | MMCA.Common.UI.Pages.Auth |
| 6 | `TermsAcceptanceGate` | class | MMCA.Common.UI.Components.Legal |
| 6 | `TwoFactorAccount` | class | MMCA.Common.UI.Pages.Auth.TwoFactor |
| 7 | `NotificationUIModule` | class | MMCA.Common.UI.Notifications |
| 7 | `SameOriginApiProxyEndpointExtensions` | class | MMCA.Common.UI.Web.SameOriginProxy |
| 7 | `TwoFactorPageGate` | class | MMCA.Common.UI.TwoFactor |
| 8 | `DependencyInjection` | class | MMCA.Common.UI.Notifications |
| 8 | `NavMenu` | class | MMCA.Common.UI.Layout |
| 8 | `NotificationPageGate` | class | MMCA.Common.UI.Notifications |
| 8 | `TwoFactorPageAuthorizationHandler` | class | MMCA.Common.UI.TwoFactor |
| 9 | `NotificationPageAuthorizationHandler` | class | MMCA.Common.UI.Notifications |
| 10 | `DependencyInjection` | class | MMCA.Common.UI |

### G16 - Aspire Orchestration & Service Defaults

> `group-16-aspire-orchestration.md` | 89 types | The Aspire AppHost wiring, ServiceDefaults, warmup, telemetry and security helpers that compose and run the distributed app locally and in Azure.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `BrokerResilienceDefaults` | class | MMCA.Common.Shared.Resilience |
| 0 | `BrokerSelection` | class | MMCA.Common.Aspire.Hosting |
| 0 | `CspNonce` | class | MMCA.Common.Aspire.Security |
| 0 | `CspPolicy` | record | MMCA.Common.Aspire.Security |
| 0 | `DownstreamProbeVersion` | enum | MMCA.Common.Aspire.Gateway |
| 0 | `Entry` | class | MMCA.Common.Aspire.Health |
| 0 | `ForwardedHeadersExtensions` | class | MMCA.Common.Gateway |
| 0 | `GatewayActiveHealthCheckDefaults` | class | MMCA.Common.Gateway |
| 0 | `GatewayBypassHeaderTransformProvider` | class | MMCA.Common.Gateway.Transforms |
| 0 | `GatewayClusterRequestProfile` | class | MMCA.Common.Gateway |
| 0 | `GatewayCorrelationMiddleware` | class | MMCA.Common.Aspire.Gateway |
| 0 | `GatewayCorsExtensions` | class | MMCA.Common.Aspire |
| 0 | `GatewayDownstreamRegistry` | class | MMCA.Common.Aspire.Gateway |
| 0 | `GatewayHeaderEncoding` | class | MMCA.Common.Gateway |
| 0 | `GatewayPassiveHealthCheckDefaults` | class | MMCA.Common.Gateway |
| 0 | `GatewayRetryAfter` | class | MMCA.Common.Gateway.RateLimiting |
| 0 | `GatewayRetrySettings` | class | MMCA.Common.Gateway |
| 0 | `GatewayRoutePolicyPartition` | enum | MMCA.Common.Gateway |
| 0 | `GatewayTraceHeaderSettings` | class | MMCA.Common.Gateway |
| 0 | `H2cHealthCheckRegistry` | class | MMCA.Common.Aspire.Hosting |
| 0 | `HealthCheckTags` | class | MMCA.Common.Aspire |
| 0 | `HealthEndpointPaths` | class | MMCA.Common.Aspire |
| 0 | `HealthReportCacheOptions` | class | MMCA.Common.Aspire.Health |
| 0 | `HostIntegrationMarker` | class | MMCA.Common.Aspire.Integrations |
| 0 | `HostIntegrationNames` | class | MMCA.Common.Aspire.Integrations |
| 0 | `HostIntegrationTripwireOptions` | class | MMCA.Common.Aspire.Integrations |
| 0 | `HttpResilienceDefaults` | class | MMCA.Common.Shared.Resilience |
| 0 | `IdentityLinkExtensions` | class | MMCA.Common.Aspire.Hosting |
| 0 | `IWarmupTask` | interface | MMCA.Common.Aspire.Warmup |
| 0 | `KestrelListenerSpec` | record | MMCA.Common.Aspire.Kestrel |
| 0 | `LeadingSlashPathPrefixesAttribute` | class | MMCA.Common.Aspire.Security |
| 0 | `MailDevDefaults` | class | MMCA.Common.MailDev |
| 0 | `OutboxPollFilterProcessor` | class | MMCA.Common.Aspire.Telemetry |
| 0 | `PostgreSqlHealthCheck` | class | MMCA.Common.Aspire.Health |
| 0 | `RabbitMqHealthConnection` | class | MMCA.Common.Aspire.Health |
| 0 | `RedisConfigurationOptionsPipeline` | class | MMCA.Common.Aspire.Caching |
| 0 | `SecurityHeadersSettings` | class | MMCA.Common.Aspire.Security |
| 0 | `SerilogHostExtensions` | class | MMCA.Common.Aspire.Logging |
| 0 | `ServiceBusEmulatorResource` | class | MMCA.Common.Aspire.Hosting |
| 0 | `ServiceEndpointProfile` | enum | MMCA.Common.Aspire.Hosting |
| 0 | `SqliteHealthCheck` | class | MMCA.Common.Aspire.Health |
| 0 | `SqlServerHealthCheck` | class | MMCA.Common.Aspire.Health |
| 0 | `TrustedCallerMode` | enum | MMCA.Common.Aspire.Gateway |
| 0 | `WarmupReadinessGate` | class | MMCA.Common.Aspire.Warmup |
| 1 | `CachedHealthReportProvider` | class | MMCA.Common.Aspire.Health |
| 1 | `DownstreamServiceHealthCheck` | class | MMCA.Common.Aspire.Gateway |
| 1 | `Extensions` | class | MMCA.Common.Aspire.Hosting |
| 1 | `GatewayConnectRetryHandler` | class | MMCA.Common.Gateway.Forwarding |
| 1 | `GatewayCorrelationExtensions` | class | MMCA.Common.Aspire.Gateway |
| 1 | `GatewayDownstreamHealthCheckOptions` | class | MMCA.Common.Aspire.Gateway |
| 1 | `GatewayHealthCheckDefaults` | class | MMCA.Common.Gateway |
| 1 | `GatewayRateLimitingSettings` | class | MMCA.Common.Aspire.Gateway |
| 1 | `GatewayRoutePolicySettings` | class | MMCA.Common.Gateway |
| 1 | `H2cEndpointHealthCheck` | class | MMCA.Common.Aspire.Hosting |
| 1 | `H2cHealthCheckExtensions` | class | MMCA.Common.Aspire.Hosting |
| 1 | `HostIntegrationTripwire` | class | MMCA.Common.Aspire.Integrations |
| 1 | `ICspPolicyProvider` | interface | MMCA.Common.Aspire.Security |
| 1 | `KestrelEndpointExtensions` | class | MMCA.Common.Aspire.Kestrel |
| 1 | `OpenIdConnectMetadataWarmupTask` | class | MMCA.Common.Aspire.Warmup |
| 1 | `ProbeTelemetryFilter` | class | MMCA.Common.Aspire.Telemetry |
| 1 | `RabbitMqHealthCheck` | class | MMCA.Common.Aspire.Health |
| 1 | `RedisCachingExtensions` | class | MMCA.Common.Aspire.Caching |
| 1 | `RedisPingHealthCheck` | class | MMCA.Common.Aspire.Health |
| 1 | `RetryAfterHeader` | class | MMCA.Common.Shared.Resilience |
| 1 | `SelfHttpWarmupTaskBase` | class | MMCA.Common.Aspire.Warmup |
| 1 | `ServiceTokenExtensions` | class | MMCA.Common.Aspire.Hosting |
| 1 | `WarmupHostedService` | class | MMCA.Common.Aspire.Warmup |
| 1 | `WarmupReadinessHealthCheck` | class | MMCA.Common.Aspire.Warmup |
| 2 | `GatewayRateLimitingExtensions` | class | MMCA.Common.Aspire.Gateway |
| 2 | `GatewaySettings` | class | MMCA.Common.Gateway |
| 2 | `GatewayUiExtensions` | class | MMCA.Common.Aspire.Hosting |
| 2 | `ProbeTelemetryFilterProcessor` | class | MMCA.Common.Aspire.Telemetry |
| 2 | `SecurityHeadersMiddleware` | class | MMCA.Common.Aspire.Security |
| 2 | `ServiceInfrastructureExtensions` | class | MMCA.Common.Aspire.Hosting |
| 2 | `StaticCspPolicyProvider` | class | MMCA.Common.Aspire.Security |
| 3 | `AdcOutageAppHostFixture` | class | MMCA.ADC.AppHost.OutageTests |
| 3 | `Extensions` | class | MMCA.Common.Aspire |
| 3 | `GatewayClusterProfileConfigFilter` | class | MMCA.Common.Gateway.Configuration |
| 3 | `GatewayHealthCheckDefaultsConfigFilter` | class | MMCA.Common.Gateway.Configuration |
| 3 | `GatewayRetryForwarderHttpClientFactory` | class | MMCA.Common.Gateway.Forwarding |
| 3 | `GatewayRoutePolicyExtensions` | class | MMCA.Common.Gateway.RateLimiting |
| 3 | `GatewaySettingsValidator` | class | MMCA.Common.Gateway |
| 3 | `GatewayTraceHeaderTransformProvider` | class | MMCA.Common.Gateway.Transforms |
| 3 | `SecurityHeadersExtensions` | class | MMCA.Common.Aspire.Security |
| 4 | `AdcOutageCollection` | class | MMCA.ADC.AppHost.OutageTests |
| 4 | `GatewayReverseProxyExtensions` | class | MMCA.Common.Gateway |
| 4 | `MmcaReplicas` | class | MMCA.Common.Aspire.Hosting |
| 5 | `AdcDependencyOutageTests` | class | MMCA.ADC.AppHost.OutageTests |
| 5 | `GatewayHealthCheckExtensions` | class | MMCA.Common.Aspire.Gateway |

### G17 - ADC Conference - Domain Model & Module Contracts

> `group-17-conference-domain.md` | 121 types | The Conference bounded context: Event/Session/Speaker/Category/Question aggregates, their domain events and invariants, plus the Shared identifiers/DTOs/integration-event contracts.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AssemblyReference` | class | MMCA.ADC.Conference.Domain |
| 0 | `CategoryItemDistribution` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 0 | `ClassReference` | class | MMCA.ADC.Conference.Domain |
| 0 | `ConferenceCacheTags` | class | MMCA.ADC.Conference.Shared.Caching |
| 0 | `ConferencePermissions` | class | MMCA.ADC.Conference.Shared.Authorization |
| 0 | `EventErrorCodes` | class | MMCA.ADC.Conference.Shared.Events |
| 0 | `EventLiveInfo` | record | MMCA.ADC.Conference.Shared.Events.Live |
| 0 | `LinkUserRequest` | record | MMCA.ADC.Conference.Shared.Speakers |
| 0 | `NowNextSessionDTO` | record | MMCA.ADC.Conference.Shared.Sessions |
| 0 | `PartnerType` | enum | MMCA.ADC.Conference.Shared.Partners |
| 0 | `QuestionModerationDefault` | enum | MMCA.ADC.Conference.Shared.Events.Live |
| 0 | `RatingQuestionSummary` | record | MMCA.ADC.Conference.Shared.Speakers |
| 0 | `RefreshFromSessionizeResultDTO` | record | MMCA.ADC.Conference.Shared.Events |
| 0 | `RoomCheckInCodeDTO` | record | MMCA.ADC.Conference.Shared.Rooms |
| 0 | `RoomCheckInSettings` | class | MMCA.ADC.Conference.Shared.Rooms |
| 0 | `RoomSessionInfo` | record | MMCA.ADC.Conference.Shared.Rooms |
| 0 | `ScoreEventSessionsResultDTO` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 0 | `SessionAiScoreDTO` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 0 | `SessionAssetKind` | enum | MMCA.ADC.Conference.Shared.SessionAssets |
| 0 | `SessionAssetLimits` | class | MMCA.ADC.Conference.Shared.SessionAssets |
| 0 | `SessionizeCodeFormat` | class | MMCA.ADC.Conference.Shared.Events |
| 0 | `SessionStatuses` | class | MMCA.ADC.Conference.Shared.Sessions |
| 0 | `SimilarSessionPair` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 0 | `SpeakerLocalitySummary` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 0 | `SpeakerSessionSummary` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 0 | `SponsorLiveInfo` | record | MMCA.ADC.Conference.Shared.Events.Live |
| 0 | `SponsorTier` | enum | MMCA.ADC.Conference.Shared.Sponsors |
| 0 | `TextQuestionResponses` | record | MMCA.ADC.Conference.Shared.Speakers |
| 0 | `UserConferenceEventAnswerExportDTO` | record | MMCA.ADC.Conference.Shared.Exports |
| 0 | `UserConferenceSessionAnswerExportDTO` | record | MMCA.ADC.Conference.Shared.Exports |
| 1 | `ActivityDTO` | record | MMCA.ADC.Conference.Shared.Activities |
| 1 | `CategoryGroupDistribution` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 1 | `CategoryItemDTO` | record | MMCA.ADC.Conference.Shared.Categories |
| 1 | `ConferenceFeatures` | class | MMCA.ADC.Conference.Shared |
| 1 | `ConferenceReadAudience` | class | MMCA.ADC.Conference.Shared.Authorization |
| 1 | `ContentSimilarityDTO` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 1 | `EventQuestionAnswerDTO` | record | MMCA.ADC.Conference.Shared.Events |
| 1 | `EventSpeakerDTO` | record | MMCA.ADC.Conference.Shared.Events |
| 1 | `MultiSessionSpeaker` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 1 | `NowNextDTO` | record | MMCA.ADC.Conference.Shared.Sessions |
| 1 | `PartnerDTO` | record | MMCA.ADC.Conference.Shared.Partners |
| 1 | `QuestionDTO` | record | MMCA.ADC.Conference.Shared.Questions |
| 1 | `RoomDTO` | record | MMCA.ADC.Conference.Shared.Rooms |
| 1 | `SessionAssetDTO` | record | MMCA.ADC.Conference.Shared.SessionAssets |
| 1 | `SessionCategoryItemDTO` | record | MMCA.ADC.Conference.Shared.Sessions |
| 1 | `SessionFeedbackDTO` | record | MMCA.ADC.Conference.Shared.Speakers |
| 1 | `SessionLiveInfo` | record | MMCA.ADC.Conference.Shared.Events.Live |
| 1 | `SessionQuestionAnswerDTO` | record | MMCA.ADC.Conference.Shared.Sessions |
| 1 | `SessionSpeakerDTO` | record | MMCA.ADC.Conference.Shared.Sessions |
| 1 | `SpeakerCategoryItemDTO` | record | MMCA.ADC.Conference.Shared.Speakers |
| 1 | `SpeakerQuestionAnswerDTO` | record | MMCA.ADC.Conference.Shared.Speakers |
| 1 | `SponsorDTO` | record | MMCA.ADC.Conference.Shared.Sponsors |
| 1 | `UserConferenceExportDTO` | record | MMCA.ADC.Conference.Shared.Exports |
| 2 | `CategoryDistributionDTO` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 2 | `CategoryItemChanged` | record | MMCA.ADC.Conference.Domain.Categories.DomainEvents |
| 2 | `ConferenceCategoryDTO` | record | MMCA.ADC.Conference.Shared.Categories |
| 2 | `EventDTO` | record | MMCA.ADC.Conference.Shared.Events |
| 2 | `EventQuestionAnswerChanged` | record | MMCA.ADC.Conference.Domain.Events.DomainEvents |
| 2 | `EventSpeakerChanged` | record | MMCA.ADC.Conference.Domain.Events.DomainEvents |
| 2 | `IUserConferenceExportService` | interface | MMCA.ADC.Conference.Shared.Exports |
| 2 | `RoomChanged` | record | MMCA.ADC.Conference.Domain.Events.DomainEvents |
| 2 | `SessionCategoryItemChanged` | record | MMCA.ADC.Conference.Domain.Sessions.DomainEvents |
| 2 | `SessionDTO` | record | MMCA.ADC.Conference.Shared.Sessions |
| 2 | `SessionQuestionAnswerChanged` | record | MMCA.ADC.Conference.Domain.Sessions.DomainEvents |
| 2 | `SessionSpeakerChanged` | record | MMCA.ADC.Conference.Domain.Sessions.DomainEvents |
| 2 | `SpeakerCategoryItemChanged` | record | MMCA.ADC.Conference.Domain.Speakers.DomainEvents |
| 2 | `SpeakerDTO` | record | MMCA.ADC.Conference.Shared.Speakers |
| 2 | `SpeakerQuestionAnswerChanged` | record | MMCA.ADC.Conference.Domain.Speakers.DomainEvents |
| 2 | `SpeakerSessionOverlapDTO` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 3 | `ActivityChanged` | record | MMCA.ADC.Conference.Domain.Activities.DomainEvents |
| 3 | `CategoryChanged` | record | MMCA.ADC.Conference.Domain.Categories.DomainEvents |
| 3 | `ConferencePermissionGrants` | class | MMCA.ADC.Conference.Shared.Authorization |
| 3 | `DisabledUserConferenceExportService` | class | MMCA.ADC.Conference.Shared.Exports |
| 3 | `EventChanged` | record | MMCA.ADC.Conference.Domain.Events.DomainEvents |
| 3 | `EventFeedbackSubmitted` | record | MMCA.ADC.Conference.Shared.Events.IntegrationEvents |
| 3 | `IEventLiveValidationService` | interface | MMCA.ADC.Conference.Shared.Events.Live |
| 3 | `ISessionBookmarkValidationService` | interface | MMCA.ADC.Conference.Shared.Sessions |
| 3 | `PartnerChanged` | record | MMCA.ADC.Conference.Domain.Partners.DomainEvents |
| 3 | `QuestionChanged` | record | MMCA.ADC.Conference.Domain.Questions.DomainEvents |
| 3 | `SessionAssetChanged` | record | MMCA.ADC.Conference.Domain.SessionAssets.DomainEvents |
| 3 | `SessionCalendarExport` | class | MMCA.ADC.Conference.Shared.Sessions |
| 3 | `SessionChanged` | record | MMCA.ADC.Conference.Domain.Sessions.DomainEvents |
| 3 | `SessionFeedbackSubmitted` | record | MMCA.ADC.Conference.Shared.Sessions.IntegrationEvents |
| 3 | `SessionSelectionDashboardDTO` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 3 | `SpeakerChanged` | record | MMCA.ADC.Conference.Domain.Speakers.DomainEvents |
| 3 | `SpeakerLinkedToUser` | record | MMCA.ADC.Conference.Shared.Speakers.IntegrationEvents |
| 3 | `SpeakerUnlinkedFromUser` | record | MMCA.ADC.Conference.Shared.Speakers.IntegrationEvents |
| 3 | `SponsorChanged` | record | MMCA.ADC.Conference.Domain.Sponsors.DomainEvents |
| 4 | `DisabledEventLiveValidationService` | class | MMCA.ADC.Conference.Shared.Events.Live |
| 4 | `DisabledSessionBookmarkValidationService` | class | MMCA.ADC.Conference.Shared.Sessions |
| 5 | `SessionAiScore` | class | MMCA.ADC.Conference.Domain.Sessions |
| 6 | `ActivityInvariants` | class | MMCA.ADC.Conference.Domain.Activities |
| 6 | `Category` | class | MMCA.ADC.Conference.Domain.Categories |
| 6 | `CategoryInvariants` | class | MMCA.ADC.Conference.Domain.Categories |
| 6 | `CategoryItem` | class | MMCA.ADC.Conference.Domain.Categories |
| 6 | `EventInvariants` | class | MMCA.ADC.Conference.Domain.Events |
| 6 | `PartnerInvariants` | class | MMCA.ADC.Conference.Domain.Partners |
| 6 | `QuestionInvariants` | class | MMCA.ADC.Conference.Domain.Questions |
| 6 | `SessionAssetInvariants` | class | MMCA.ADC.Conference.Domain.SessionAssets |
| 6 | `SessionInvariants` | class | MMCA.ADC.Conference.Domain.Sessions |
| 6 | `SpeakerInvariants` | class | MMCA.ADC.Conference.Domain.Speakers |
| 6 | `SponsorInvariants` | class | MMCA.ADC.Conference.Domain.Sponsors |
| 7 | `Event` | class | MMCA.ADC.Conference.Domain.Events |
| 7 | `EventQuestionAnswer` | class | MMCA.ADC.Conference.Domain.Events |
| 7 | `EventSpeaker` | class | MMCA.ADC.Conference.Domain.Events |
| 7 | `Question` | class | MMCA.ADC.Conference.Domain.Questions |
| 7 | `Room` | class | MMCA.ADC.Conference.Domain.Events |
| 7 | `SessionAsset` | class | MMCA.ADC.Conference.Domain.SessionAssets |
| 7 | `Speaker` | class | MMCA.ADC.Conference.Domain.Speakers |
| 7 | `SpeakerCategoryItem` | class | MMCA.ADC.Conference.Domain.Speakers |
| 7 | `SpeakerQuestionAnswer` | class | MMCA.ADC.Conference.Domain.Speakers |
| 8 | `Activity` | class | MMCA.ADC.Conference.Domain.Activities |
| 8 | `CurrentEventSelector` | class | MMCA.ADC.Conference.Shared.Events |
| 8 | `Partner` | class | MMCA.ADC.Conference.Domain.Partners |
| 8 | `Session` | class | MMCA.ADC.Conference.Domain.Sessions |
| 8 | `SessionCategoryItem` | class | MMCA.ADC.Conference.Domain.Sessions |
| 8 | `SessionQuestionAnswer` | class | MMCA.ADC.Conference.Domain.Sessions |
| 8 | `SessionSpeaker` | class | MMCA.ADC.Conference.Domain.Sessions |
| 8 | `Sponsor` | class | MMCA.ADC.Conference.Domain.Sponsors |
| 9 | `CurrentEventDefaults` | class | MMCA.ADC.Conference.Shared.Events |
| 9 | `EventCascadeDeletionDomainService` | class | MMCA.ADC.Conference.Domain.Events |

### G18 - ADC Conference - Application & Use Cases

> `group-18-conference-application.md` | 373 types | Conference CQRS handlers, validators, DTOs, specifications, the Sessionize import, and the session-selection decision-support analytics.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `ActivityTimeRangeRules<T>` | class | MMCA.ADC.Conference.Application.Activities.Validation |
| 0 | `AssemblyReference` | class | MMCA.ADC.Conference.Application |
| 0 | `BatchEventQuestionAnswerItem` | record | MMCA.ADC.Conference.Application.Events.UseCases.BatchAddEventQuestionAnswers |
| 0 | `BatchSessionQuestionAnswerItem` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.BatchAddSessionQuestionAnswers |
| 0 | `ClassReference` | class | MMCA.ADC.Conference.Application |
| 0 | `ConferenceCategoryUpdateRequest` | record | MMCA.ADC.Conference.Application.Categories.UseCases.Update |
| 0 | `EventDateRangeRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 0 | `ExportEventCalendarQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar |
| 0 | `ExportSessionCalendarQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar |
| 0 | `GetCategoryDistributionQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution |
| 0 | `GetContentSimilarityQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity |
| 0 | `GetNowNextQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.NowNext |
| 0 | `GetPublicActivityFilterQuery` | record | MMCA.ADC.Conference.Application.Activities.UseCases.GetPublicActivityFilter |
| 0 | `GetPublicEventSpeakerFilterQuery` | record | MMCA.ADC.Conference.Application.Events.UseCases.GetPublicEventSpeakerFilter |
| 0 | `GetPublicPartnerFilterQuery` | record | MMCA.ADC.Conference.Application.Partners.UseCases.GetPublicPartnerFilter |
| 0 | `GetPublicRoomFilterQuery` | record | MMCA.ADC.Conference.Application.Events.UseCases.GetPublicRoomFilter |
| 0 | `GetPublicSessionCategoryItemFilterQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionCategoryItemFilter |
| 0 | `GetPublicSessionFilterQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionFilter |
| 0 | `GetPublicSessionSpeakerFilterQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionSpeakerFilter |
| 0 | `GetPublicSpeakerCategoryItemFilterQuery` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.GetPublicSpeakerCategoryItemFilter |
| 0 | `GetPublicSpeakerFilterQuery` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.GetPublicSpeakerFilter |
| 0 | `GetPublicSponsorFilterQuery` | record | MMCA.ADC.Conference.Application.Sponsors.UseCases.GetPublicSponsorFilter |
| 0 | `GetRoomCheckInCodeQuery` | record | MMCA.ADC.Conference.Application.Events.UseCases.GetRoomCheckInCode |
| 0 | `GetSessionAssetsQuery` | record | MMCA.ADC.Conference.Application.SessionAssets.UseCases.GetBySession |
| 0 | `GetSessionBookmarkCountQuery` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCount |
| 0 | `GetSessionBookmarkCountsQuery` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCounts |
| 0 | `GetSessionFeedbackQuery` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionFeedback |
| 0 | `GetSessionsBySpeakerFilterQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.GetSessionsBySpeakerFilter |
| 0 | `GetSessionSelectionDashboardQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard |
| 0 | `GetSpeakersByEventFilterQuery` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSpeakersByEventFilter |
| 0 | `GetSpeakerSessionOverlapQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSpeakerSessionOverlap |
| 0 | `IActivityFieldsRequest` | interface | MMCA.ADC.Conference.Application.Activities.Validation |
| 0 | `IEventFieldsRequest` | interface | MMCA.ADC.Conference.Application.Events.Validation |
| 0 | `ISessionAssetFieldsRequest` | interface | MMCA.ADC.Conference.Application.SessionAssets.Validation |
| 0 | `ISessionFieldsRequest` | interface | MMCA.ADC.Conference.Application.Sessions.Validation |
| 0 | `ISessionScoresCacheEvictor` | interface | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 0 | `ISpeakerFieldsRequest` | interface | MMCA.ADC.Conference.Application.Speakers.Validation |
| 0 | `LocalityLookupEntry` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport |
| 0 | `QuestionUpdateRequest` | record | MMCA.ADC.Conference.Application.Questions.UseCases.Update |
| 0 | `RoomCapacityRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 0 | `RotateRoomCheckInCodeCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.RotateRoomCheckInCode |
| 0 | `SessionizeCategoryItem` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 0 | `SessionizeLink` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 0 | `SessionizeQuestion` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 0 | `SessionizeQuestionAnswer` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 0 | `SessionizeRoom` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 0 | `SessionizeSessionIdConverter` | class | MMCA.ADC.Conference.Application.Events.Sessionize |
| 0 | `SessionizeSyncResult` | record | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 0 | `SessionScoringResult` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 0 | `SessionSimilarityCalculator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity |
| 0 | `SpeakerInfo` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 0 | `StatusBucket` | enum | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard |
| 0 | `StatusBucket` | enum | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution |
| 1 | `ActivityEventIdRules<T>` | class | MMCA.ADC.Conference.Application.Activities.Validation |
| 1 | `ActivitySortOrderRules<T>` | class | MMCA.ADC.Conference.Application.Activities.Validation |
| 1 | `ActivityUpdateRequest` | record | MMCA.ADC.Conference.Application.Activities.UseCases.Update |
| 1 | `CategoryItemSortRules<T>` | class | MMCA.ADC.Conference.Application.Categories.Validation |
| 1 | `DeleteSessionAssetCommand` | record | MMCA.ADC.Conference.Application.SessionAssets.UseCases.Delete |
| 1 | `EventSessionizeCodeRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 1 | `EventUpdateRequest` | record | MMCA.ADC.Conference.Application.Events.UseCases.Update |
| 1 | `IPartnerFieldsRequest` | interface | MMCA.ADC.Conference.Application.Partners.Validation |
| 1 | `ISponsorFieldsRequest` | interface | MMCA.ADC.Conference.Application.Sponsors.Validation |
| 1 | `PartnerEventIdRules<T>` | class | MMCA.ADC.Conference.Application.Partners.Validation |
| 1 | `PartnerSortRules<T>` | class | MMCA.ADC.Conference.Application.Partners.Validation |
| 1 | `RoomSortRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 1 | `RotateRoomCheckInCodeCommandValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.RotateRoomCheckInCode |
| 1 | `SessionAssetLinkRequest` | record | MMCA.ADC.Conference.Application.SessionAssets.UseCases.AddLink |
| 1 | `SessionAssetSessionIdRules<T>` | class | MMCA.ADC.Conference.Application.SessionAssets.Validation |
| 1 | `SessionAssetSortOrderRules<T>` | class | MMCA.ADC.Conference.Application.SessionAssets.Validation |
| 1 | `SessionAssetUpdateRequest` | record | MMCA.ADC.Conference.Application.SessionAssets.UseCases.Update |
| 1 | `SessionEventIdRules<T>` | class | MMCA.ADC.Conference.Application.Sessions.Validation |
| 1 | `SessionizeCategory` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 1 | `SessionizeSession` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 1 | `SessionizeSpeaker` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 1 | `SessionScoringInput` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 1 | `SessionUpdateRequest` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.Update |
| 1 | `SpeakerUpdateRequest` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.Update |
| 1 | `SponsorEventIdRules<T>` | class | MMCA.ADC.Conference.Application.Sponsors.Validation |
| 1 | `SponsorSortRules<T>` | class | MMCA.ADC.Conference.Application.Sponsors.Validation |
| 1 | `SponsorTierRules<T>` | class | MMCA.ADC.Conference.Application.Sponsors.Validation |
| 1 | `UploadSessionAssetCommand` | record | MMCA.ADC.Conference.Application.SessionAssets.UseCases.UploadFile |
| 2 | `AddSessionAssetLinkCommand` | record | MMCA.ADC.Conference.Application.SessionAssets.UseCases.AddLink |
| 2 | `DeleteSessionAssetCommandValidator` | class | MMCA.ADC.Conference.Application.SessionAssets.UseCases.Delete |
| 2 | `IAiScoringService` | interface | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 2 | `PartnerUpdateRequest` | record | MMCA.ADC.Conference.Application.Partners.UseCases.Update |
| 2 | `SponsorUpdateRequest` | record | MMCA.ADC.Conference.Application.Sponsors.UseCases.Update |
| 2 | `UpdateSessionAssetCommand` | record | MMCA.ADC.Conference.Application.SessionAssets.UseCases.Update |
| 3 | `ISessionAssetAccessService` | interface | MMCA.ADC.Conference.Application.SessionAssets |
| 3 | `ISessionScoringRunner` | interface | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 3 | `SessionizeSyncWarnings` | class | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 3 | `UpdateEventResult` | record | MMCA.ADC.Conference.Application.Events.UseCases.Update |
| 3 | `UpdateSessionResult` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.Update |
| 4 | `ScoreEventSessionsInternalCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 4 | `SpeakerDeletedHandler` | class | MMCA.ADC.Conference.Application.Speakers.DomainEventHandlers |
| 5 | `DeleteSessionAssetBlobInternalCommand` | record | MMCA.ADC.Conference.Application.SessionAssets.UseCases.DeleteSessionAssetBlob |
| 5 | `ScoreEventSessionsInternalCommandHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 6 | `DeleteSessionAssetBlobInternalCommandHandler` | class | MMCA.ADC.Conference.Application.SessionAssets.UseCases.DeleteSessionAssetBlob |
| 6 | `DeleteSessionAssetBlobInternalCommandValidator` | class | MMCA.ADC.Conference.Application.SessionAssets.UseCases.DeleteSessionAssetBlob |
| 7 | `ActivityDescriptionRules<T>` | class | MMCA.ADC.Conference.Application.Activities.Validation |
| 7 | `ActivityNameRules<T>` | class | MMCA.ADC.Conference.Application.Activities.Validation |
| 7 | `ActivityVenueAddressRules<T>` | class | MMCA.ADC.Conference.Application.Activities.Validation |
| 7 | `ActivityVenueNameRules<T>` | class | MMCA.ADC.Conference.Application.Activities.Validation |
| 7 | `ActivityVenueUrlRules<T>` | class | MMCA.ADC.Conference.Application.Activities.Validation |
| 7 | `AddCategoryItemCommand` | record | MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem |
| 7 | `CategoryItemDTOMapper` | class | MMCA.ADC.Conference.Application.Categories.DTOs |
| 7 | `CategoryItemNameRules<T>` | class | MMCA.ADC.Conference.Application.Categories.Validation |
| 7 | `ConferenceCategoryCreateRequest` | record | MMCA.ADC.Conference.Application.Categories.UseCases.Create |
| 7 | `ConferenceCategoryTitleRules<T>` | class | MMCA.ADC.Conference.Application.Categories.Validation |
| 7 | `ConferenceCategoryUpdateApplier` | class | MMCA.ADC.Conference.Application.Categories.UseCases.Update |
| 7 | `EventDescriptionRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `EventNameRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `EventOrganizerContactEmailRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `EventSponsorshipPacketUrlRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `EventTicketingUrlRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `EventTimeZoneRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `EventVenueAddressRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `EventVenueMapUrlRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `EventWiFiInfoRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `PartnerDescriptionRules<T>` | class | MMCA.ADC.Conference.Application.Partners.Validation |
| 7 | `PartnerNameRules<T>` | class | MMCA.ADC.Conference.Application.Partners.Validation |
| 7 | `PartnerOptionalUrlRules<T>` | class | MMCA.ADC.Conference.Application.Partners.Validation |
| 7 | `QuestionTextRules<T>` | class | MMCA.ADC.Conference.Application.Questions.Validation |
| 7 | `RemoveCategoryItemCommand` | record | MMCA.ADC.Conference.Application.Categories.UseCases.RemoveCategoryItem |
| 7 | `RoomAccessibilityInfoRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `RoomFloorRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `RoomLocationRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `RoomNameRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `SessionAccessibilityInfoRules<T>` | class | MMCA.ADC.Conference.Application.Sessions.Validation |
| 7 | `SessionAssetFileNameRules<T>` | class | MMCA.ADC.Conference.Application.SessionAssets.Validation |
| 7 | `SessionAssetTitleRules<T>` | class | MMCA.ADC.Conference.Application.SessionAssets.Validation |
| 7 | `SessionAssetUrlRules<T>` | class | MMCA.ADC.Conference.Application.SessionAssets.Validation |
| 7 | `SessionDescriptionRules<T>` | class | MMCA.ADC.Conference.Application.Sessions.Validation |
| 7 | `SessionizeResponse` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 7 | `SessionLiveUrlRules<T>` | class | MMCA.ADC.Conference.Application.Sessions.Validation |
| 7 | `SessionRecordingUrlRules<T>` | class | MMCA.ADC.Conference.Application.Sessions.Validation |
| 7 | `SessionResourceLinksRules<T>` | class | MMCA.ADC.Conference.Application.Sessions.Validation |
| 7 | `SessionStatusRules<T>` | class | MMCA.ADC.Conference.Application.Sessions.Validation |
| 7 | `SessionTitleRules<T>` | class | MMCA.ADC.Conference.Application.Sessions.Validation |
| 7 | `SpeakerEmailRules<T>` | class | MMCA.ADC.Conference.Application.Speakers.Validation |
| 7 | `SpeakerFirstNameRules<T>` | class | MMCA.ADC.Conference.Application.Speakers.Validation |
| 7 | `SpeakerGitHubUrlRules<T>` | class | MMCA.ADC.Conference.Application.Speakers.Validation |
| 7 | `SpeakerLastNameRules<T>` | class | MMCA.ADC.Conference.Application.Speakers.Validation |
| 7 | `SpeakerLinkedInUrlRules<T>` | class | MMCA.ADC.Conference.Application.Speakers.Validation |
| 7 | `SpeakerProfilePictureHttpsRules<T>` | class | MMCA.ADC.Conference.Application.Speakers.Validation |
| 7 | `SpeakerProfilePictureRules<T>` | class | MMCA.ADC.Conference.Application.Speakers.Validation |
| 7 | `SpeakerWebsiteUrlRules<T>` | class | MMCA.ADC.Conference.Application.Speakers.Validation |
| 7 | `SponsorBoothNumberRules<T>` | class | MMCA.ADC.Conference.Application.Sponsors.Validation |
| 7 | `SponsorDescriptionRules<T>` | class | MMCA.ADC.Conference.Application.Sponsors.Validation |
| 7 | `SponsorLinkedInUrlRules<T>` | class | MMCA.ADC.Conference.Application.Sponsors.Validation |
| 7 | `SponsorLogoUrlRules<T>` | class | MMCA.ADC.Conference.Application.Sponsors.Validation |
| 7 | `SponsorNameRules<T>` | class | MMCA.ADC.Conference.Application.Sponsors.Validation |
| 7 | `SponsorTwitterHandleRules<T>` | class | MMCA.ADC.Conference.Application.Sponsors.Validation |
| 7 | `SponsorWebsiteUrlRules<T>` | class | MMCA.ADC.Conference.Application.Sponsors.Validation |
| 7 | `UpdateCategoryItemCommand` | record | MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem |
| 8 | `ActivityFieldRules<T>` | class | MMCA.ADC.Conference.Application.Activities.Validation |
| 8 | `AddCategoryItemCommandValidator` | class | MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem |
| 8 | `AddEventQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer |
| 8 | `AddEventSpeakerCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker |
| 8 | `AddRoomCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.AddRoom |
| 8 | `AddSpeakerCategoryItemCommand` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem |
| 8 | `BatchAddEventQuestionAnswersCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.BatchAddEventQuestionAnswers |
| 8 | `ConferenceCategoryCreateRequestMapper` | class | MMCA.ADC.Conference.Application.Categories.UseCases.Create |
| 8 | `ConferenceCategoryCreateRequestValidator` | class | MMCA.ADC.Conference.Application.Categories.UseCases.Create |
| 8 | `ConferenceCategoryDTOMapper` | class | MMCA.ADC.Conference.Application.Categories.DTOs |
| 8 | `ConferenceCategoryUpdateRequestValidator` | class | MMCA.ADC.Conference.Application.Categories.UseCases.Update |
| 8 | `DeleteSessionAssetHandler` | class | MMCA.ADC.Conference.Application.SessionAssets.UseCases.Delete |
| 8 | `EventCreateRequest` | record | MMCA.ADC.Conference.Application.Events.UseCases.Create |
| 8 | `EventFieldRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 8 | `EventQuestionAnswerDTOMapper` | class | MMCA.ADC.Conference.Application.Events.DTOs |
| 8 | `EventQuestionAnswerRules` | class | MMCA.ADC.Conference.Application.Events |
| 8 | `EventSpeakerDTOMapper` | class | MMCA.ADC.Conference.Application.Events.DTOs |
| 8 | `GetRoomCheckInCodeHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.GetRoomCheckInCode |
| 8 | `ISessionizeService` | interface | MMCA.ADC.Conference.Application.Events.Sessionize |
| 8 | `LinkUserToSpeakerCommand` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.LinkUser |
| 8 | `PartnerFieldRules<T>` | class | MMCA.ADC.Conference.Application.Partners.Validation |
| 8 | `PublishedEventSpecification` | class | MMCA.ADC.Conference.Application.Events.Specifications |
| 8 | `PublishEventCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.Publish |
| 8 | `QuestionCreateRequest` | record | MMCA.ADC.Conference.Application.Questions.UseCases.Create |
| 8 | `QuestionDTOMapper` | class | MMCA.ADC.Conference.Application.Questions.DTOs |
| 8 | `QuestionUpdateRequestValidator` | class | MMCA.ADC.Conference.Application.Questions.UseCases.Update |
| 8 | `RefreshFromSessionizeCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 8 | `RemoveEventQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventQuestionAnswer |
| 8 | `RemoveEventSpeakerCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventSpeaker |
| 8 | `RemoveRoomCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.RemoveRoom |
| 8 | `RemoveSpeakerCategoryItemCommand` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.RemoveSpeakerCategoryItem |
| 8 | `RoomDTOMapper` | class | MMCA.ADC.Conference.Application.Events.DTOs |
| 8 | `SessionAssetDTOMapper` | class | MMCA.ADC.Conference.Application.SessionAssets.DTOs |
| 8 | `SessionAssetFieldRules<T>` | class | MMCA.ADC.Conference.Application.SessionAssets.Validation |
| 8 | `SessionFieldRules<T>` | class | MMCA.ADC.Conference.Application.Sessions.Validation |
| 8 | `SessionizeSyncContext` | record | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 8 | `SpeakerCategoryItemDTOMapper` | class | MMCA.ADC.Conference.Application.Speakers.DTOs |
| 8 | `SpeakerCreateRequest` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.Create |
| 8 | `SpeakerFieldRules<T>` | class | MMCA.ADC.Conference.Application.Speakers.Validation |
| 8 | `SpeakerLocalityHelper` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport |
| 8 | `SpeakerQuestionAnswerDTOMapper` | class | MMCA.ADC.Conference.Application.Speakers.DTOs |
| 8 | `SponsorFieldRules<T>` | class | MMCA.ADC.Conference.Application.Sponsors.Validation |
| 8 | `UnlinkUserFromSpeakerCommand` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.UnlinkUser |
| 8 | `UnpublishEventCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.Unpublish |
| 8 | `UpdateCategoryItemCommandValidator` | class | MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem |
| 8 | `UpdateEventCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.Update |
| 8 | `UpdateEventQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.UpdateEventQuestionAnswer |
| 8 | `UpdateQuestionCommand` | record | MMCA.ADC.Conference.Application.Questions.UseCases.Update |
| 8 | `UpdateRoomCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom |
| 8 | `UpdateSpeakerCommand` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.Update |
| 8 | `UserDeletedSpeakerErasureHandler` | class | MMCA.ADC.Conference.Application.Users.IntegrationEventHandlers |
| 8 | `UserRegisteredHandler` | class | MMCA.ADC.Conference.Application.Users.IntegrationEventHandlers |
| 9 | `ActivityCreateRequest` | record | MMCA.ADC.Conference.Application.Activities.UseCases.Create |
| 9 | `ActivityDTOMapper` | class | MMCA.ADC.Conference.Application.Activities.DTOs |
| 9 | `ActivityUpdateApplier` | class | MMCA.ADC.Conference.Application.Activities.UseCases.Update |
| 9 | `ActivityUpdateRequestValidator` | class | MMCA.ADC.Conference.Application.Activities.UseCases.Update |
| 9 | `AddCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem |
| 9 | `AddEventQuestionAnswerCommandValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer |
| 9 | `AddEventQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer |
| 9 | `AddEventSpeakerCommandValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker |
| 9 | `AddRoomCommandValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.AddRoom |
| 9 | `AddSessionAssetLinkHandler` | class | MMCA.ADC.Conference.Application.SessionAssets.UseCases.AddLink |
| 9 | `AddSessionCategoryItemCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem |
| 9 | `AddSessionQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer |
| 9 | `AddSessionSpeakerCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker |
| 9 | `AddSpeakerCategoryItemCommandValidator` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem |
| 9 | `BatchAddEventQuestionAnswersCommandValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.BatchAddEventQuestionAnswers |
| 9 | `BatchAddEventQuestionAnswersHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.BatchAddEventQuestionAnswers |
| 9 | `BatchAddSessionQuestionAnswersCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.BatchAddSessionQuestionAnswers |
| 9 | `CalendarExportMapper` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar |
| 9 | `ConferenceCategoryEntityQueryService` | class | MMCA.ADC.Conference.Application.Categories |
| 9 | `CreateConferenceCategoryHandler` | class | MMCA.ADC.Conference.Application.Categories.UseCases.Create |
| 9 | `DeleteConferenceCategoryHandler` | class | MMCA.ADC.Conference.Application.Categories.UseCases.Delete |
| 9 | `EventCreateRequestMapper` | class | MMCA.ADC.Conference.Application.Events.UseCases.Create |
| 9 | `EventCreateRequestValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.Create |
| 9 | `EventDTOMapper` | class | MMCA.ADC.Conference.Application.Events.DTOs |
| 9 | `EventUpdateRequestValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.Update |
| 9 | `GetCategoryDistributionHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution |
| 9 | `GetContentSimilarityHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity |
| 9 | `GetSessionAssetsHandler` | class | MMCA.ADC.Conference.Application.SessionAssets.UseCases.GetBySession |
| 9 | `GetSessionBookmarkCountHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCount |
| 9 | `GetSessionBookmarkCountsHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCounts |
| 9 | `GetSessionFeedbackHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionFeedback |
| 9 | `GetSessionsBySpeakerFilterHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.GetSessionsBySpeakerFilter |
| 9 | `GetSessionSelectionDashboardHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard |
| 9 | `GetSpeakersByEventFilterHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSpeakersByEventFilter |
| 9 | `GetSpeakerSessionOverlapHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSpeakerSessionOverlap |
| 9 | `ISessionizeSyncStrategy` | interface | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 9 | `PartnerCreateRequest` | record | MMCA.ADC.Conference.Application.Partners.UseCases.Create |
| 9 | `PartnerDTOMapper` | class | MMCA.ADC.Conference.Application.Partners.DTOs |
| 9 | `PartnerUpdateApplier` | class | MMCA.ADC.Conference.Application.Partners.UseCases.Update |
| 9 | `PartnerUpdateRequestValidator` | class | MMCA.ADC.Conference.Application.Partners.UseCases.Update |
| 9 | `PublicSessionStatusSpecification` | class | MMCA.ADC.Conference.Application.Sessions.Specifications |
| 9 | `QuestionCreateRequestMapper` | class | MMCA.ADC.Conference.Application.Questions.UseCases.Create |
| 9 | `QuestionCreateRequestValidator` | class | MMCA.ADC.Conference.Application.Questions.UseCases.Create |
| 9 | `RemoveSessionCategoryItemCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionCategoryItem |
| 9 | `RemoveSessionQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionQuestionAnswer |
| 9 | `RemoveSessionSpeakerCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionSpeaker |
| 9 | `RoomEntityQueryService` | class | MMCA.ADC.Conference.Application.Events |
| 9 | `SessionAssetAccessService` | class | MMCA.ADC.Conference.Application.SessionAssets |
| 9 | `SessionAssetLinkRequestValidator` | class | MMCA.ADC.Conference.Application.SessionAssets.UseCases.AddLink |
| 9 | `SessionAssetUpdateRequestValidator` | class | MMCA.ADC.Conference.Application.SessionAssets.UseCases.Update |
| 9 | `SessionBookmarkValidationService` | class | MMCA.ADC.Conference.Application.Sessions |
| 9 | `SessionCategoryItemDTOMapper` | class | MMCA.ADC.Conference.Application.Sessions.DTOs |
| 9 | `SessionCreateRequest` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.Create |
| 9 | `SessionQuestionAnswerDTOMapper` | class | MMCA.ADC.Conference.Application.Sessions.DTOs |
| 9 | `SessionQuestionAnswerRules` | class | MMCA.ADC.Conference.Application.Sessions |
| 9 | `SessionRoomScheduling` | class | MMCA.ADC.Conference.Application.Sessions.Validation |
| 9 | `SessionScoringRunner` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 9 | `SessionSpeakerDTOMapper` | class | MMCA.ADC.Conference.Application.Sessions.DTOs |
| 9 | `SessionUpdateRequestValidator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.Update |
| 9 | `SpeakerCreateRequestMapper` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.Create |
| 9 | `SpeakerCreateRequestValidator` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.Create |
| 9 | `SpeakerDTOMapper` | class | MMCA.ADC.Conference.Application.Speakers.DTOs |
| 9 | `SpeakerUpdateApplier` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.Update |
| 9 | `SpeakerUpdateRequestValidator` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.Update |
| 9 | `SponsorCreateRequest` | record | MMCA.ADC.Conference.Application.Sponsors.UseCases.Create |
| 9 | `SponsorDTOMapper` | class | MMCA.ADC.Conference.Application.Sponsors.DTOs |
| 9 | `SponsorUpdateApplier` | class | MMCA.ADC.Conference.Application.Sponsors.UseCases.Update |
| 9 | `SponsorUpdateRequestValidator` | class | MMCA.ADC.Conference.Application.Sponsors.UseCases.Update |
| 9 | `UpdateEventQuestionAnswerCommandValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.UpdateEventQuestionAnswer |
| 9 | `UpdateRoomCommandValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom |
| 9 | `UpdateSessionCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.Update |
| 9 | `UpdateSessionQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.UpdateSessionQuestionAnswer |
| 9 | `UploadSessionAssetCommandValidator` | class | MMCA.ADC.Conference.Application.SessionAssets.UseCases.UploadFile |
| 9 | `UploadSessionAssetHandler` | class | MMCA.ADC.Conference.Application.SessionAssets.UseCases.UploadFile |
| 9 | `UserConferenceExportService` | class | MMCA.ADC.Conference.Application.Exports |
| 9 | `UserDeletedFeedbackHandler` | class | MMCA.ADC.Conference.Application.Users.IntegrationEventHandlers |
| 10 | `ActivityCreateRequestMapper` | class | MMCA.ADC.Conference.Application.Activities.UseCases.Create |
| 10 | `ActivityCreateRequestValidator` | class | MMCA.ADC.Conference.Application.Activities.UseCases.Create |
| 10 | `ActivityNavigationPopulator` | class | MMCA.ADC.Conference.Application.Activities |
| 10 | `AddSessionCategoryItemCommandValidator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem |
| 10 | `AddSessionQuestionAnswerCommandValidator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer |
| 10 | `AddSessionQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer |
| 10 | `AddSessionSpeakerCommandValidator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker |
| 10 | `BatchAddSessionQuestionAnswersCommandValidator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.BatchAddSessionQuestionAnswers |
| 10 | `BatchAddSessionQuestionAnswersHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.BatchAddSessionQuestionAnswers |
| 10 | `CategoryItemNavigationPopulator` | class | MMCA.ADC.Conference.Application.Categories |
| 10 | `CategorySyncStrategy` | class | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 10 | `ConferenceCategoryNavigationPopulator` | class | MMCA.ADC.Conference.Application.Categories |
| 10 | `CreateActivityHandler` | class | MMCA.ADC.Conference.Application.Activities.UseCases.Create |
| 10 | `CreateEventHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.Create |
| 10 | `CreatePartnerHandler` | class | MMCA.ADC.Conference.Application.Partners.UseCases.Create |
| 10 | `CreateSpeakerHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.Create |
| 10 | `CreateSponsorHandler` | class | MMCA.ADC.Conference.Application.Sponsors.UseCases.Create |
| 10 | `DeleteEventHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.Delete |
| 10 | `EventLiveValidationService` | class | MMCA.ADC.Conference.Application.Events |
| 10 | `EventNavigationPopulator` | class | MMCA.ADC.Conference.Application.Events |
| 10 | `EventQuestionAnswerNavigationPopulator` | class | MMCA.ADC.Conference.Application.Events |
| 10 | `EventSpeakerNavigationPopulator` | class | MMCA.ADC.Conference.Application.Events |
| 10 | `ExportEventCalendarHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar |
| 10 | `ExportSessionCalendarHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar |
| 10 | `GetNowNextHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.NowNext |
| 10 | `GetPublicSessionFilterHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionFilter |
| 10 | `PartnerCreateRequestMapper` | class | MMCA.ADC.Conference.Application.Partners.UseCases.Create |
| 10 | `PartnerCreateRequestValidator` | class | MMCA.ADC.Conference.Application.Partners.UseCases.Create |
| 10 | `PartnerNavigationPopulator` | class | MMCA.ADC.Conference.Application.Partners |
| 10 | `PublicConferenceVisibility` | class | MMCA.ADC.Conference.Application.Common |
| 10 | `PublishEventHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.Publish |
| 10 | `QuestionSyncStrategy` | class | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 10 | `RemoveEventQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventQuestionAnswer |
| 10 | `RemoveSessionQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionQuestionAnswer |
| 10 | `RoomNavigationPopulator` | class | MMCA.ADC.Conference.Application.Events |
| 10 | `RoomSyncStrategy` | class | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 10 | `SessionCategoryItemNavigationPopulator` | class | MMCA.ADC.Conference.Application.Sessions |
| 10 | `SessionCreateRequestMapper` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.Create |
| 10 | `SessionCreateRequestValidator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.Create |
| 10 | `SessionDTOMapper` | class | MMCA.ADC.Conference.Application.Sessions.DTOs |
| 10 | `SessionNavigationPopulator` | class | MMCA.ADC.Conference.Application.Sessions |
| 10 | `SessionQuestionAnswerNavigationPopulator` | class | MMCA.ADC.Conference.Application.Sessions |
| 10 | `SessionSpeakerNavigationPopulator` | class | MMCA.ADC.Conference.Application.Sessions |
| 10 | `SessionSyncStrategy` | class | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 10 | `SpeakerCategoryItemNavigationPopulator` | class | MMCA.ADC.Conference.Application.Speakers |
| 10 | `SpeakerEntityQueryService` | class | MMCA.ADC.Conference.Application.Speakers |
| 10 | `SpeakerNavigationPopulator` | class | MMCA.ADC.Conference.Application.Speakers |
| 10 | `SpeakerSyncStrategy` | class | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 10 | `SponsorCreateRequestMapper` | class | MMCA.ADC.Conference.Application.Sponsors.UseCases.Create |
| 10 | `SponsorCreateRequestValidator` | class | MMCA.ADC.Conference.Application.Sponsors.UseCases.Create |
| 10 | `SponsorNavigationPopulator` | class | MMCA.ADC.Conference.Application.Sponsors |
| 10 | `UnlinkUserFromSpeakerHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.UnlinkUser |
| 10 | `UnpublishEventHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.Unpublish |
| 10 | `UpdateCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem |
| 10 | `UpdateRoomHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom |
| 10 | `UpdateSessionAssetHandler` | class | MMCA.ADC.Conference.Application.SessionAssets.UseCases.Update |
| 10 | `UpdateSessionQuestionAnswerCommandValidator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.UpdateSessionQuestionAnswer |
| 11 | `AddEventSpeakerHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker |
| 11 | `AddSessionCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem |
| 11 | `AddSessionSpeakerHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker |
| 11 | `AddSpeakerCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem |
| 11 | `CreateQuestionHandler` | class | MMCA.ADC.Conference.Application.Questions.UseCases.Create |
| 11 | `CreateSessionHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.Create |
| 11 | `DeleteSessionHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.Delete |
| 11 | `GetPublicActivityFilterHandler` | class | MMCA.ADC.Conference.Application.Activities.UseCases.GetPublicActivityFilter |
| 11 | `GetPublicEventSpeakerFilterHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.GetPublicEventSpeakerFilter |
| 11 | `GetPublicPartnerFilterHandler` | class | MMCA.ADC.Conference.Application.Partners.UseCases.GetPublicPartnerFilter |
| 11 | `GetPublicRoomFilterHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.GetPublicRoomFilter |
| 11 | `GetPublicSessionCategoryItemFilterHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionCategoryItemFilter |
| 11 | `GetPublicSessionSpeakerFilterHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionSpeakerFilter |
| 11 | `GetPublicSpeakerCategoryItemFilterHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.GetPublicSpeakerCategoryItemFilter |
| 11 | `GetPublicSpeakerFilterHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.GetPublicSpeakerFilter |
| 11 | `GetPublicSponsorFilterHandler` | class | MMCA.ADC.Conference.Application.Sponsors.UseCases.GetPublicSponsorFilter |
| 11 | `LinkUserToSpeakerHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.LinkUser |
| 11 | `RefreshFromSessionizeHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 11 | `RemoveCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Categories.UseCases.RemoveCategoryItem |
| 11 | `RemoveEventSpeakerHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventSpeaker |
| 11 | `RemoveRoomHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.RemoveRoom |
| 11 | `RemoveSessionCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionCategoryItem |
| 11 | `RemoveSessionSpeakerHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionSpeaker |
| 11 | `RemoveSpeakerCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.RemoveSpeakerCategoryItem |
| 11 | `SessionEntityQueryService` | class | MMCA.ADC.Conference.Application.Sessions |
| 11 | `UpdateEventQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.UpdateEventQuestionAnswer |
| 11 | `UpdateQuestionHandler` | class | MMCA.ADC.Conference.Application.Questions.UseCases.Update |
| 11 | `UpdateSessionQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.UpdateSessionQuestionAnswer |
| 11 | `UpdateSpeakerHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.Update |
| 12 | `AddRoomHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.AddRoom |
| 12 | `DependencyInjection` | class | MMCA.ADC.Conference.Application |
| 12 | `RotateRoomCheckInCodeHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.RotateRoomCheckInCode |
| 12 | `UpdateEventHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.Update |
| 12 | `UpdateSessionHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.Update |

### G19 - ADC Conference - Infrastructure & Persistence

> `group-19-conference-infrastructure.md` | 29 types | The Conference module DbContext registration, EF entity configurations, database seeding, and infrastructure services.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AiScoreResponse` | record | MMCA.ADC.Conference.Infrastructure.Sessions.Scoring |
| 0 | `AssemblyReference` | class | MMCA.ADC.Conference.Infrastructure |
| 0 | `ClassReference` | class | MMCA.ADC.Conference.Infrastructure |
| 0 | `SessionizeSettings` | class | MMCA.ADC.Conference.Infrastructure.Events.Sessionize |
| 1 | `OutputCacheSessionScoresCacheEvictor` | class | MMCA.ADC.Conference.Infrastructure.Sessions.Scoring |
| 3 | `SessionScoringService` | class | MMCA.ADC.Conference.Infrastructure.Sessions.Scoring |
| 4 | `SessionScoreResponseGuardrail` | class | MMCA.ADC.Conference.Infrastructure.Sessions.Scoring |
| 9 | `ConferenceModuleDbSeeder` | class | MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts.Seeding |
| 9 | `SessionizeService` | class | MMCA.ADC.Conference.Infrastructure.Events.Sessionize |
| 10 | `DependencyInjection` | class | MMCA.ADC.Conference.Infrastructure |
| 11 | `ActivityConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Activities |
| 11 | `CategoryItemConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Categories |
| 11 | `ConferenceCategoryConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Categories |
| 11 | `EventConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Events |
| 11 | `EventQuestionAnswerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Events |
| 11 | `EventSpeakerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Events |
| 11 | `PartnerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Partners |
| 11 | `QuestionConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Questions |
| 11 | `RoomConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Events |
| 11 | `SessionAiScoreConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Sessions |
| 11 | `SessionAssetConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.SessionAssets |
| 11 | `SessionCategoryItemConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Sessions |
| 11 | `SessionConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Sessions |
| 11 | `SessionQuestionAnswerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Sessions |
| 11 | `SessionSpeakerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Sessions |
| 11 | `SpeakerCategoryItemConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Speakers |
| 11 | `SpeakerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Speakers |
| 11 | `SpeakerQuestionAnswerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Speakers |
| 11 | `SponsorConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Sponsors |

### G20 - ADC Conference - API, gRPC Contracts & Service Host

> `group-20-conference-api-grpc.md` | 72 types | Conference REST controllers, the .Contracts gRPC surface, the extractable service host, and the gRPC adapter.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AddCategoryItemRequest` | record | MMCA.ADC.Conference.API.Controllers.Categories |
| 0 | `AddEventQuestionAnswerRequest` | record | MMCA.ADC.Conference.API.Controllers.Events |
| 0 | `AddEventSpeakerRequest` | record | MMCA.ADC.Conference.API.Controllers.Events |
| 0 | `AddRoomRequest` | record | MMCA.ADC.Conference.API.Controllers.Events |
| 0 | `AddSessionCategoryItemRequest` | record | MMCA.ADC.Conference.API.Controllers.Sessions |
| 0 | `AddSessionQuestionAnswerRequest` | record | MMCA.ADC.Conference.API.Controllers.Sessions |
| 0 | `AddSessionSpeakerRequest` | record | MMCA.ADC.Conference.API.Controllers.Sessions |
| 0 | `AddSpeakerCategoryItemRequest` | record | MMCA.ADC.Conference.API.Controllers.Speakers |
| 0 | `AssemblyReference` | class | MMCA.ADC.Conference.API |
| 0 | `BatchEventQuestionAnswerItemRequest` | record | MMCA.ADC.Conference.API.Controllers.Events |
| 0 | `BatchSessionQuestionAnswerItemRequest` | record | MMCA.ADC.Conference.API.Controllers.Sessions |
| 0 | `ClassReference` | class | MMCA.ADC.Conference.API |
| 0 | `ConferenceErrorResources` | class | MMCA.ADC.Conference.API.Resources |
| 0 | `McpEventSummary` | record | MMCA.ADC.Conference.API.Mcp |
| 0 | `UpdateCategoryItemRequest` | record | MMCA.ADC.Conference.API.Controllers.Categories |
| 0 | `UpdateEventQuestionAnswerRequest` | record | MMCA.ADC.Conference.API.Controllers.Events |
| 0 | `UpdateRoomRequest` | record | MMCA.ADC.Conference.API.Controllers.Events |
| 0 | `UpdateSessionQuestionAnswerRequest` | record | MMCA.ADC.Conference.API.Controllers.Sessions |
| 1 | `BatchAddEventQuestionAnswersRequest` | record | MMCA.ADC.Conference.API.Controllers.Events |
| 1 | `BatchAddSessionQuestionAnswersRequest` | record | MMCA.ADC.Conference.API.Controllers.Sessions |
| 1 | `McpUntrustedText` | record | MMCA.ADC.Conference.API.Mcp |
| 2 | `McpNowNextSession` | record | MMCA.ADC.Conference.API.Mcp |
| 2 | `McpSessionSummary` | record | MMCA.ADC.Conference.API.Mcp |
| 2 | `McpSpeakerSummary` | record | MMCA.ADC.Conference.API.Mcp |
| 2 | `SelfHttpOutputCacheWarmupTask` | class | MMCA.ADC.Conference.Service |
| 2 | `ServiceInfoController` | class | MMCA.ADC.Conference.API.Controllers |
| 3 | `EventScope` | record | MMCA.ADC.Conference.API.Mcp |
| 3 | `Lookups` | record | MMCA.ADC.Conference.API.Mcp |
| 3 | `McpNowNext` | record | MMCA.ADC.Conference.API.Mcp |
| 3 | `McpSessionDetail` | record | MMCA.ADC.Conference.API.Mcp |
| 3 | `McpSpeakerDetail` | record | MMCA.ADC.Conference.API.Mcp |
| 4 | `ConferenceBrokerConsumers` | class | MMCA.ADC.Conference.Service |
| 4 | `PublicReadScope` | class | MMCA.ADC.Conference.API.Authorization |
| 5 | `ConferenceModule` | class | MMCA.ADC.Conference.API |
| 6 | `RoomCheckInCodesController` | class | MMCA.ADC.Conference.API.Controllers.Events |
| 6 | `SessionCalendarController` | class | MMCA.ADC.Conference.API.Controllers.Sessions |
| 7 | `AdminFeatureFlagsController` | class | MMCA.ADC.Conference.API.Controllers.FeatureFlags |
| 8 | `CategoryItemsController` | class | MMCA.ADC.Conference.API.Controllers.Categories |
| 8 | `SessionSelectionController` | class | MMCA.ADC.Conference.API.Controllers.Sessions |
| 9 | `AuditHistoryController` | class | MMCA.ADC.Conference.API.Controllers.AuditHistory |
| 9 | `ConferenceCategoriesController` | class | MMCA.ADC.Conference.API.Controllers.Categories |
| 9 | `CurrentUserServiceExtensions` | class | MMCA.ADC.Conference.API.Authorization |
| 9 | `EventLifecycleController` | class | MMCA.ADC.Conference.API.Controllers.Events |
| 9 | `EventsController` | class | MMCA.ADC.Conference.API.Controllers.Events |
| 9 | `EventSpeakersController` | class | MMCA.ADC.Conference.API.Controllers.Events |
| 9 | `QuestionsController` | class | MMCA.ADC.Conference.API.Controllers.Questions |
| 9 | `RoomsController` | class | MMCA.ADC.Conference.API.Controllers.Events |
| 9 | `SessionAssetsController` | class | MMCA.ADC.Conference.API.Controllers.SessionAssets |
| 9 | `SpeakerCategoryItemsController` | class | MMCA.ADC.Conference.API.Controllers.Speakers |
| 9 | `SpeakerLinksController` | class | MMCA.ADC.Conference.API.Controllers.Speakers |
| 9 | `SpeakerSessionsController` | class | MMCA.ADC.Conference.API.Controllers.Speakers |
| 10 | `ActivitiesController` | class | MMCA.ADC.Conference.API.Controllers.Activities |
| 10 | `ConferenceMcpReader` | class | MMCA.ADC.Conference.API.Mcp |
| 10 | `ConferenceModuleSeeder` | class | MMCA.ADC.Conference.API |
| 10 | `EventQuestionAnswersController` | class | MMCA.ADC.Conference.API.Controllers.Events |
| 10 | `PartnersController` | class | MMCA.ADC.Conference.API.Controllers.Partners |
| 10 | `SessionBookmarksGrpcService` | class | MMCA.ADC.Conference.Service.Grpc |
| 10 | `SessionBookmarkValidationServiceGrpcAdapter` | class | MMCA.ADC.Conference.Contracts |
| 10 | `SessionCategoryItemsController` | class | MMCA.ADC.Conference.API.Controllers.Sessions |
| 10 | `SessionQuestionAnswersController` | class | MMCA.ADC.Conference.API.Controllers.Sessions |
| 10 | `SessionsController` | class | MMCA.ADC.Conference.API.Controllers.Sessions |
| 10 | `SessionSpeakersController` | class | MMCA.ADC.Conference.API.Controllers.Sessions |
| 10 | `SpeakersController` | class | MMCA.ADC.Conference.API.Controllers.Speakers |
| 10 | `SponsorsController` | class | MMCA.ADC.Conference.API.Controllers.Sponsors |
| 10 | `UserConferenceExportGrpcService` | class | MMCA.ADC.Conference.Service.Grpc |
| 10 | `UserConferenceExportServiceGrpcAdapter` | class | MMCA.ADC.Conference.Contracts |
| 11 | `ConferenceMcpTools` | class | MMCA.ADC.Conference.API.Mcp |
| 11 | `DependencyInjection` | class | MMCA.ADC.Conference.API |
| 11 | `EventLiveValidationGrpcService` | class | MMCA.ADC.Conference.Service.Grpc |
| 11 | `EventLiveValidationServiceGrpcAdapter` | class | MMCA.ADC.Conference.Contracts |
| 12 | `ConferenceGrpcEndpoints` | class | MMCA.ADC.Conference.Service |
| 12 | `DependencyInjection` | class | MMCA.ADC.Conference.Contracts |

### G21 - ADC Conference - UI

> `group-21-conference-ui.md` | 170 types | The Conference Blazor pages (events, sessions, speakers, categories, questions, rooms, feedback, public, session-selection) and their UI services.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `CategoryItemInfo` | record | MMCA.ADC.Conference.UI.Services.Categories |
| 0 | `ChildEntityDeletePath` | class | MMCA.ADC.Conference.UI.Services.Common |
| 0 | `ConferenceRoutePaths` | class | MMCA.ADC.Conference.UI |
| 0 | `ConferenceTrackInfo` | record | MMCA.ADC.Conference.UI.Pages.Home |
| 0 | `EventInfo` | record | MMCA.ADC.Conference.UI.Services.Events |
| 0 | `EventPhase` | enum | MMCA.ADC.Conference.UI.Pages.Home |
| 0 | `IanaTimeZoneAttribute` | class | MMCA.ADC.Conference.UI.Pages.Events |
| 0 | `KeynoteSpeakerInfo` | record | MMCA.ADC.Conference.UI.Pages.Home |
| 0 | `NewestLoadTracker<T>` | class | MMCA.ADC.Conference.UI.Pages.Public.Sessions |
| 0 | `PreConferenceWorkshopInfo` | record | MMCA.ADC.Conference.UI.Pages.Home |
| 0 | `PublicSessionEventScope` | class | MMCA.ADC.Conference.UI.Pages.Public.Sessions |
| 0 | `PublicSessionListFilterState` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 0 | `ScorePollSignal` | enum | MMCA.ADC.Conference.UI.Pages.Sessions.Selection |
| 0 | `SessionAssetComposer` | class | MMCA.ADC.Conference.UI.Pages.SessionAssets |
| 0 | `SessionAssetLinkRequest` | record | MMCA.ADC.Conference.UI.Services.SessionAssets |
| 0 | `SessionAssetUpdateRequest` | record | MMCA.ADC.Conference.UI.Services.SessionAssets |
| 0 | `SessionSchedulePageRequest` | record | MMCA.ADC.Conference.UI.Services.Public |
| 0 | `SpeakerInfo` | record | MMCA.ADC.Conference.UI.Services.Speakers |
| 0 | `VenueMapLinks` | class | MMCA.ADC.Conference.UI.Pages.Public.Events |
| 1 | `ADCHomeContent` | class | MMCA.ADC.Conference.UI.Pages.Home |
| 1 | `ScorePollTracker` | class | MMCA.ADC.Conference.UI.Pages.Sessions.Selection |
| 1 | `SessionizeCodeAttribute` | class | MMCA.ADC.Conference.UI.Pages.Events |
| 1 | `SessionSelectionDisplay` | class | MMCA.ADC.Conference.UI.Pages.Sessions.Selection |
| 1 | `SpeakerDetailLookups` | record | MMCA.ADC.Conference.UI.Services.Speakers |
| 2 | `ActivityFormModel` | class | MMCA.ADC.Conference.UI.Pages.Activities |
| 2 | `ConferenceCategoryItemEditModel` | class | MMCA.ADC.Conference.UI.Pages.Categories |
| 2 | `PartnerFormModel` | class | MMCA.ADC.Conference.UI.Pages.Partners |
| 2 | `PublicAiAssistant` | class | MMCA.ADC.Conference.UI.Pages.Public.AiAssistant |
| 2 | `PublicReadAudience` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 2 | `QuestionFormModel` | class | MMCA.ADC.Conference.UI.Pages.Questions |
| 2 | `RoomFormModel` | class | MMCA.ADC.Conference.UI.Pages.Rooms |
| 2 | `SessionAssetDisplay` | class | MMCA.ADC.Conference.UI.Pages.SessionAssets |
| 2 | `SponsorFormModel` | class | MMCA.ADC.Conference.UI.Pages.Sponsors |
| 3 | `ActivityCreateModel` | class | MMCA.ADC.Conference.UI.Pages.Activities |
| 3 | `ActivityEditModel` | class | MMCA.ADC.Conference.UI.Pages.Activities |
| 3 | `CommittedWriteReload` | class | MMCA.ADC.Conference.UI.Pages.Common |
| 3 | `ConferenceCategoryFormModel` | class | MMCA.ADC.Conference.UI.Pages.Categories |
| 3 | `ConferenceUIModule` | class | MMCA.ADC.Conference.UI |
| 3 | `EventFormModel` | class | MMCA.ADC.Conference.UI.Pages.Events |
| 3 | `ICategoryItemLookupService` | interface | MMCA.ADC.Conference.UI.Services.Categories |
| 3 | `IEventLookupService` | interface | MMCA.ADC.Conference.UI.Services.Events |
| 3 | `IEventSpeakerUIService` | interface | MMCA.ADC.Conference.UI.Services.Common |
| 3 | `IOrganizerEventFeedbackUIService` | interface | MMCA.ADC.Conference.UI.Services.Feedback |
| 3 | `IOrganizerSessionFeedbackUIService` | interface | MMCA.ADC.Conference.UI.Services.Feedback |
| 3 | `IPublicSessionScheduleService` | interface | MMCA.ADC.Conference.UI.Services.Public |
| 3 | `ISessionAssetUIService` | interface | MMCA.ADC.Conference.UI.Services.SessionAssets |
| 3 | `ISessionCategoryItemUIService` | interface | MMCA.ADC.Conference.UI.Services.Common |
| 3 | `ISessionSpeakerUIService` | interface | MMCA.ADC.Conference.UI.Services.Common |
| 3 | `ISpeakerCategoryItemUIService` | interface | MMCA.ADC.Conference.UI.Services.Common |
| 3 | `ISpeakerDashboardUIService` | interface | MMCA.ADC.Conference.UI.Services.Speakers |
| 3 | `ISpeakerDetailLookupService` | interface | MMCA.ADC.Conference.UI.Services.Speakers |
| 3 | `ISpeakerLookupService` | interface | MMCA.ADC.Conference.UI.Services.Speakers |
| 3 | `PartnerCreateModel` | class | MMCA.ADC.Conference.UI.Pages.Partners |
| 3 | `PartnerEditModel` | class | MMCA.ADC.Conference.UI.Pages.Partners |
| 3 | `PublicScheduleRoomOptions` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 3 | `PublicSessionListFilterBar` | class | MMCA.ADC.Conference.UI.Pages.Public.Sessions |
| 3 | `QuestionCreateModel` | class | MMCA.ADC.Conference.UI.Pages.Questions |
| 3 | `QuestionEditModel` | class | MMCA.ADC.Conference.UI.Pages.Questions |
| 3 | `RoomCreateModel` | class | MMCA.ADC.Conference.UI.Pages.Rooms |
| 3 | `RoomEditModel` | class | MMCA.ADC.Conference.UI.Pages.Rooms |
| 3 | `SessionFormModel` | class | MMCA.ADC.Conference.UI.Pages.Sessions |
| 3 | `SessionizeRefreshOutcome` | record | MMCA.ADC.Conference.UI.Services.Events |
| 3 | `SpeakerFormModel` | class | MMCA.ADC.Conference.UI.Pages.Speakers |
| 3 | `SponsorCreateModel` | class | MMCA.ADC.Conference.UI.Pages.Sponsors |
| 3 | `SponsorEditModel` | class | MMCA.ADC.Conference.UI.Pages.Sponsors |
| 4 | `CategoryItemLookupService` | class | MMCA.ADC.Conference.UI.Services.Categories |
| 4 | `ConferenceCategoryCreateModel` | class | MMCA.ADC.Conference.UI.Pages.Categories |
| 4 | `ConferenceCategoryEditModel` | class | MMCA.ADC.Conference.UI.Pages.Categories |
| 4 | `EventCreateModel` | class | MMCA.ADC.Conference.UI.Pages.Events |
| 4 | `EventEditModel` | class | MMCA.ADC.Conference.UI.Pages.Events |
| 4 | `EventLookupService` | class | MMCA.ADC.Conference.UI.Services.Events |
| 4 | `IActivityUIService` | interface | MMCA.ADC.Conference.UI.Services.Activities |
| 4 | `ICategoryItemUIService` | interface | MMCA.ADC.Conference.UI.Services.Categories |
| 4 | `IConferenceCategoryUIService` | interface | MMCA.ADC.Conference.UI.Services.Categories |
| 4 | `IEventUIService` | interface | MMCA.ADC.Conference.UI.Services.Events |
| 4 | `IPartnerUIService` | interface | MMCA.ADC.Conference.UI.Services.Partners |
| 4 | `IQuestionUIService` | interface | MMCA.ADC.Conference.UI.Services.Questions |
| 4 | `IRoomUIService` | interface | MMCA.ADC.Conference.UI.Services.Rooms |
| 4 | `ISessionSelectionUIService` | interface | MMCA.ADC.Conference.UI.Services.Sessions.Selection |
| 4 | `ISessionUIService` | interface | MMCA.ADC.Conference.UI.Services.Sessions |
| 4 | `ISpeakerUIService` | interface | MMCA.ADC.Conference.UI.Services.Speakers |
| 4 | `ISponsorUIService` | interface | MMCA.ADC.Conference.UI.Services.Sponsors |
| 4 | `OrganizerEventFeedbackService` | class | MMCA.ADC.Conference.UI.Services.Feedback |
| 4 | `OrganizerSessionFeedbackService` | class | MMCA.ADC.Conference.UI.Services.Feedback |
| 4 | `PrerenderLookupBudget` | class | MMCA.ADC.Conference.UI.Pages.Common |
| 4 | `PublicSessionBookmarkState` | class | MMCA.ADC.Conference.UI.Pages.Public.Sessions |
| 4 | `PublicSessionListView` | class | MMCA.ADC.Conference.UI.Pages.Public.Sessions |
| 4 | `ScorePollHost` | record | MMCA.ADC.Conference.UI.Pages.Sessions.Selection |
| 4 | `SessionAssetService` | class | MMCA.ADC.Conference.UI.Services.SessionAssets |
| 4 | `SessionBookmarkButton` | class | MMCA.ADC.Conference.UI.Pages.Public.Sessions |
| 4 | `SessionCreateModel` | class | MMCA.ADC.Conference.UI.Pages.Sessions |
| 4 | `SessionEditModel` | class | MMCA.ADC.Conference.UI.Pages.Sessions |
| 4 | `SessionSelectionAiScores` | class | MMCA.ADC.Conference.UI.Pages.Sessions.Selection |
| 4 | `SessionSelectionFilterOptions` | record | MMCA.ADC.Conference.UI.Pages.Sessions.Selection |
| 4 | `SpeakerDashboardService` | class | MMCA.ADC.Conference.UI.Services.Speakers |
| 4 | `SpeakerLookupService` | class | MMCA.ADC.Conference.UI.Services.Speakers |
| 4 | `SpeakerUserSearch` | class | MMCA.ADC.Conference.UI.Pages.Speakers |
| 5 | `ActivityService` | class | MMCA.ADC.Conference.UI.Services.Activities |
| 5 | `CategoryItemService` | class | MMCA.ADC.Conference.UI.Services.Categories |
| 5 | `ConferenceCategoryCreate` | class | MMCA.ADC.Conference.UI.Pages.Categories |
| 5 | `ConferenceCategoryDetail` | class | MMCA.ADC.Conference.UI.Pages.Categories |
| 5 | `ConferenceCategoryList` | class | MMCA.ADC.Conference.UI.Pages.Categories |
| 5 | `ConferenceCategoryService` | class | MMCA.ADC.Conference.UI.Services.Categories |
| 5 | `EventService` | class | MMCA.ADC.Conference.UI.Services.Events |
| 5 | `EventSpeakerService` | class | MMCA.ADC.Conference.UI.Services.Common |
| 5 | `FeedbackQuestionLoader` | class | MMCA.ADC.Conference.UI.Pages.Feedback |
| 5 | `PartnerService` | class | MMCA.ADC.Conference.UI.Services.Partners |
| 5 | `PublicSessionScheduleService` | class | MMCA.ADC.Conference.UI.Services.Public |
| 5 | `QuestionService` | class | MMCA.ADC.Conference.UI.Services.Questions |
| 5 | `RoomService` | class | MMCA.ADC.Conference.UI.Services.Rooms |
| 5 | `ScorePollSession` | class | MMCA.ADC.Conference.UI.Pages.Sessions.Selection |
| 5 | `SessionAssetsDownloadList` | class | MMCA.ADC.Conference.UI.Pages.SessionAssets |
| 5 | `SessionAssetsPanel` | class | MMCA.ADC.Conference.UI.Pages.SessionAssets |
| 5 | `SessionCategoryItemService` | class | MMCA.ADC.Conference.UI.Services.Common |
| 5 | `SessionLookups` | class | MMCA.ADC.Conference.UI.Pages.Sessions |
| 5 | `SessionSelectionFilters` | class | MMCA.ADC.Conference.UI.Pages.Sessions.Selection |
| 5 | `SessionSelectionService` | class | MMCA.ADC.Conference.UI.Services.Sessions.Selection |
| 5 | `SessionService` | class | MMCA.ADC.Conference.UI.Services.Sessions |
| 5 | `SessionSpeakerService` | class | MMCA.ADC.Conference.UI.Services.Common |
| 5 | `SpeakerCategoryItemService` | class | MMCA.ADC.Conference.UI.Services.Common |
| 5 | `SpeakerCreateModel` | class | MMCA.ADC.Conference.UI.Pages.Speakers |
| 5 | `SpeakerDetailLookupService` | class | MMCA.ADC.Conference.UI.Services.Speakers |
| 5 | `SpeakerEditModel` | class | MMCA.ADC.Conference.UI.Pages.Speakers |
| 5 | `SpeakerService` | class | MMCA.ADC.Conference.UI.Services.Speakers |
| 5 | `SponsorService` | class | MMCA.ADC.Conference.UI.Services.Sponsors |
| 6 | `ActivityDetail` | class | MMCA.ADC.Conference.UI.Pages.Activities |
| 6 | `ConferenceCategoryItemsPanel` | class | MMCA.ADC.Conference.UI.Pages.Categories |
| 6 | `DependencyInjection` | class | MMCA.ADC.Conference.UI |
| 6 | `EventCreate` | class | MMCA.ADC.Conference.UI.Pages.Events |
| 6 | `EventList` | class | MMCA.ADC.Conference.UI.Pages.Events |
| 6 | `OrganizerEventFeedback` | class | MMCA.ADC.Conference.UI.Pages.Feedback |
| 6 | `OrganizerSessionFeedback` | class | MMCA.ADC.Conference.UI.Pages.Feedback |
| 6 | `QuestionCreate` | class | MMCA.ADC.Conference.UI.Pages.Questions |
| 6 | `QuestionList` | class | MMCA.ADC.Conference.UI.Pages.Questions |
| 6 | `RoomCreate` | class | MMCA.ADC.Conference.UI.Pages.Rooms |
| 6 | `SessionCreate` | class | MMCA.ADC.Conference.UI.Pages.Sessions |
| 6 | `SessionDetail` | class | MMCA.ADC.Conference.UI.Pages.Sessions |
| 6 | `SpeakerCategoryItemsPanel` | class | MMCA.ADC.Conference.UI.Pages.Speakers |
| 6 | `SpeakerCreate` | class | MMCA.ADC.Conference.UI.Pages.Speakers |
| 6 | `SpeakerDetail` | class | MMCA.ADC.Conference.UI.Pages.Speakers |
| 6 | `SpeakerQr` | class | MMCA.ADC.Conference.UI.Pages.Speakers |
| 7 | `SessionSelectionSpeakerOverlap` | class | MMCA.ADC.Conference.UI.Pages.Sessions.Selection |
| 8 | `EventDetail` | class | MMCA.ADC.Conference.UI.Pages.Events |
| 8 | `PublicEventDetail` | class | MMCA.ADC.Conference.UI.Pages.Public.Events |
| 8 | `QuestionDetail` | class | MMCA.ADC.Conference.UI.Pages.Questions |
| 8 | `RoomDetail` | class | MMCA.ADC.Conference.UI.Pages.Rooms |
| 9 | `ActivityCreate` | class | MMCA.ADC.Conference.UI.Pages.Activities |
| 9 | `ADCHome` | class | MMCA.ADC.Conference.UI.Pages.Home |
| 9 | `EventFilteredListPageBase<TDto>` | class | MMCA.ADC.Conference.UI.Pages.Common |
| 9 | `PartnerCreate` | class | MMCA.ADC.Conference.UI.Pages.Partners |
| 9 | `PartnerDetail` | class | MMCA.ADC.Conference.UI.Pages.Partners |
| 9 | `PublicActivityList` | class | MMCA.ADC.Conference.UI.Pages.Public.Activities |
| 9 | `PublicEventList` | class | MMCA.ADC.Conference.UI.Pages.Public.Events |
| 9 | `PublicSessionDetail` | class | MMCA.ADC.Conference.UI.Pages.Public.Sessions |
| 9 | `PublicSponsorList` | class | MMCA.ADC.Conference.UI.Pages.Public.Sponsors |
| 9 | `SessionSelectionDashboard` | class | MMCA.ADC.Conference.UI.Pages.Sessions.Selection |
| 9 | `SpeakerDashboard` | class | MMCA.ADC.Conference.UI.Pages.Speakers |
| 9 | `SponsorCreate` | class | MMCA.ADC.Conference.UI.Pages.Sponsors |
| 9 | `SponsorDetail` | class | MMCA.ADC.Conference.UI.Pages.Sponsors |
| 10 | `ActivityList` | class | MMCA.ADC.Conference.UI.Pages.Activities |
| 10 | `PartnerList` | class | MMCA.ADC.Conference.UI.Pages.Partners |
| 10 | `PublicSessionEventCatalog` | class | MMCA.ADC.Conference.UI.Pages.Public.Sessions |
| 10 | `PublicSpeakerDetail` | class | MMCA.ADC.Conference.UI.Pages.Public.Speakers |
| 10 | `PublicSpeakerList` | class | MMCA.ADC.Conference.UI.Pages.Public.Speakers |
| 10 | `RoomList` | class | MMCA.ADC.Conference.UI.Pages.Rooms |
| 10 | `SessionList` | class | MMCA.ADC.Conference.UI.Pages.Sessions |
| 10 | `SessionStatusDisplay` | class | MMCA.ADC.Conference.UI.Pages.Sessions |
| 10 | `SpeakerList` | class | MMCA.ADC.Conference.UI.Pages.Speakers |
| 10 | `SponsorList` | class | MMCA.ADC.Conference.UI.Pages.Sponsors |
| 11 | `PublicSessionList` | class | MMCA.ADC.Conference.UI.Pages.Public.Sessions |

### G22 - ADC Engagement Module (Session Bookmarks)

> `group-22-engagement-module.md` | 341 types | The Engagement bounded context end-to-end: bookmark aggregate, use cases, persistence, API/contracts/service, and feedback UI.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AdoptionCell` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetTicketInsights |
| 0 | `AdoptionDayDTO` | record | MMCA.ADC.Engagement.Shared.Tickets.Insights.Roster |
| 0 | `AssemblyReference` | class | MMCA.ADC.Engagement.API |
| 0 | `AssemblyReference` | class | MMCA.ADC.Engagement.Infrastructure |
| 0 | `AssemblyReference` | class | MMCA.ADC.Engagement.Domain |
| 0 | `AssemblyReference` | class | MMCA.ADC.Engagement.Application |
| 0 | `AttendeeRow` | record | MMCA.ADC.Engagement.UI.Services.Lookups |
| 0 | `AttendeeSearchField` | enum | MMCA.ADC.Engagement.UI.Services.Lookups |
| 0 | `BadgePayload` | class | MMCA.ADC.Engagement.Shared.CheckIns.Badges |
| 0 | `BookmarkCacheEvictionSignal` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.Services |
| 0 | `BookmarkDeletePayload` | record | MMCA.ADC.Engagement.UI.Services.Bookmarks |
| 0 | `BookmarkOfflineWrites` | class | MMCA.ADC.Engagement.UI.Services.Bookmarks |
| 0 | `BookmarkWriteOutcome` | record | MMCA.ADC.Engagement.Shared.UserSessionBookmarks |
| 0 | `CheckInErrorCodes` | class | MMCA.ADC.Engagement.Shared.CheckIns |
| 0 | `CheckInResultDTO` | record | MMCA.ADC.Engagement.Shared.CheckIns |
| 0 | `CheckInScope` | enum | MMCA.ADC.Engagement.Shared.CheckIns |
| 0 | `CheckInSettings` | class | MMCA.ADC.Engagement.Shared.CheckIns |
| 0 | `CheckInState` | enum | MMCA.ADC.Engagement.UI.Pages.CheckIns.Rooms |
| 0 | `ClaimTicketRequest` | record | MMCA.ADC.Engagement.Shared.Tickets |
| 0 | `ClassReference` | class | MMCA.ADC.Engagement.Domain |
| 0 | `ClassReference` | class | MMCA.ADC.Engagement.Infrastructure |
| 0 | `ClassReference` | class | MMCA.ADC.Engagement.API |
| 0 | `ClassReference` | class | MMCA.ADC.Engagement.Application |
| 0 | `CreateBookmarkRequest` | record | MMCA.ADC.Engagement.Shared.UserSessionBookmarks |
| 0 | `CsvBuilder` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetTicketInsights |
| 0 | `EngagementErrorResources` | class | MMCA.ADC.Engagement.API.Resources |
| 0 | `EngagementPermissions` | class | MMCA.ADC.Engagement.Shared.Authorization |
| 0 | `EngagementRoutePaths` | class | MMCA.ADC.Engagement.UI |
| 0 | `EventCheckInRow` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetTicketInsights |
| 0 | `FollowUpQueueDTO` | record | MMCA.ADC.Engagement.Shared.Tickets.Insights.Roster |
| 0 | `GetAttendanceStatsQuery` | record | MMCA.ADC.Engagement.Application.CheckIns.UseCases.GetAttendanceStats |
| 0 | `GetBookmarkedSessionIdsQuery` | record | MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetBookmarkedSessionIds |
| 0 | `GetEngagementInsightsQuery` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetTicketInsights |
| 0 | `GetLeaderboardQuery` | record | MMCA.ADC.Engagement.Application.Points.UseCases.GetLeaderboard |
| 0 | `GetMyBadgeQuery` | record | MMCA.ADC.Engagement.Application.CheckIns.UseCases.GetMyBadge |
| 0 | `GetMyPointsQuery` | record | MMCA.ADC.Engagement.Application.Points.UseCases.GetMyPoints |
| 0 | `GetMyTicketsQuery` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetMyTickets |
| 0 | `GetOrCreateMyBadgeCommand` | record | MMCA.ADC.Engagement.Application.CheckIns.UseCases.GetOrCreateMyBadge |
| 0 | `GetPointsOverviewQuery` | record | MMCA.ADC.Engagement.Application.Points.UseCases.GetPointsOverview |
| 0 | `GetRosterInsightsQuery` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetTicketInsights |
| 0 | `GetTicketRosterImportQuery` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetRosterImport |
| 0 | `GetTicketRosterSummaryQuery` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetRosterSummary |
| 0 | `GetUserBookmarksQuery` | record | MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetUserBookmarks |
| 0 | `Holders` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetTicketInsights |
| 0 | `IBookmarkCountService` | interface | MMCA.ADC.Engagement.Shared.UserSessionBookmarks |
| 0 | `ImportTicketRosterCommand` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.ImportTicketRoster |
| 0 | `InsightCount` | record | MMCA.ADC.Engagement.Shared.Tickets.Insights |
| 0 | `InsightLoadState<T>` | class | MMCA.ADC.Engagement.UI.Pages.Tickets.Insights |
| 0 | `InsightRateDisplay` | enum | MMCA.ADC.Engagement.UI.Pages.Tickets.Insights |
| 0 | `InsightTimeBasis` | enum | MMCA.ADC.Engagement.Shared.Tickets.Insights |
| 0 | `LeaderboardEntryDTO` | record | MMCA.ADC.Engagement.Shared.Points |
| 0 | `LiveChannelPublishWorkItem` | record | MMCA.ADC.Engagement.Application.Live |
| 0 | `LiveEventContext` | record | MMCA.ADC.Engagement.UI.Services.SessionLive |
| 0 | `LiveWindowStartTimer` | class | MMCA.ADC.Engagement.UI.Services.SessionLive |
| 0 | `MyBadgeDTO` | record | MMCA.ADC.Engagement.Shared.CheckIns.Badges |
| 0 | `NameComparer` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetTicketInsights |
| 0 | `NowNextSessionInfo` | record | MMCA.ADC.Engagement.UI.Services.HappeningNow |
| 0 | `OptInRow` | record | MMCA.ADC.Engagement.Application.Points.UseCases.GetLeaderboard |
| 0 | `OrderSizeCountDTO` | record | MMCA.ADC.Engagement.Shared.Tickets.Insights.Roster |
| 0 | `OrderTally` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetTicketInsights |
| 0 | `PendingTicket` | class | MMCA.ADC.Engagement.Application.Tickets.Services |
| 0 | `PendingTicketInvitationDTO` | record | MMCA.ADC.Engagement.Shared.Tickets.Invitations |
| 0 | `PersonalWebmailDomains` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetTicketInsights |
| 0 | `PointsActivityType` | enum | MMCA.ADC.Engagement.Shared.Points |
| 0 | `RecordedCheckIn` | record struct | MMCA.ADC.Engagement.Application.CheckIns.Services |
| 0 | `RoomCheckInRequest` | record | MMCA.ADC.Engagement.Shared.CheckIns.Rooms |
| 0 | `RoomCheckInResultDTO` | record | MMCA.ADC.Engagement.Shared.CheckIns.Rooms |
| 0 | `RosterHealthDTO` | record | MMCA.ADC.Engagement.Shared.Tickets.Insights.Roster |
| 0 | `ScanOutcomeKind` | enum | MMCA.ADC.Engagement.UI.Pages.CheckIns |
| 0 | `SearchFilter` | record | MMCA.ADC.Engagement.UI.Services.Lookups |
| 0 | `SelfCheckInOutcome<TResult>` | record | MMCA.ADC.Engagement.UI.Services.CheckIns |
| 0 | `SendTicketInvitesRequest` | record | MMCA.ADC.Engagement.Shared.Tickets |
| 0 | `SessionAttendanceDTO` | record | MMCA.ADC.Engagement.Shared.CheckIns.Attendance |
| 0 | `SessionAttendanceRow` | record | MMCA.ADC.Engagement.UI.Pages.CheckIns |
| 0 | `SessionInfo` | record | MMCA.ADC.Engagement.UI.Services.Lookups |
| 0 | `SessionReminder` | record | MMCA.ADC.Engagement.UI.Services.HappeningNow |
| 0 | `SessionScopeSource` | enum | MMCA.ADC.Engagement.Shared.Tickets.Insights.Usage |
| 0 | `SetLeaderboardParticipationRequest` | record | MMCA.ADC.Engagement.Shared.Points |
| 0 | `SponsorVisitRequest` | record | MMCA.ADC.Engagement.Shared.CheckIns.SponsorVisits |
| 0 | `SponsorVisitResultDTO` | record | MMCA.ADC.Engagement.Shared.CheckIns.SponsorVisits |
| 0 | `TicketAccountLinkResultDTO` | record | MMCA.ADC.Engagement.Shared.Tickets |
| 0 | `TicketInsightsReport` | enum | MMCA.ADC.Engagement.Shared.Tickets.Insights |
| 0 | `TicketInvitesResultDTO` | record | MMCA.ADC.Engagement.Shared.Tickets |
| 0 | `TicketLinkMethod` | enum | MMCA.ADC.Engagement.Shared.Tickets |
| 0 | `TicketRosterCounts` | class | MMCA.ADC.Engagement.Application.Tickets.Services |
| 0 | `TicketRosterEntry` | record | MMCA.ADC.Engagement.Domain.Tickets |
| 0 | `TicketRosterImportErrorCodes` | class | MMCA.ADC.Engagement.Shared.Tickets.Imports |
| 0 | `TicketRosterImportResultDTO` | record | MMCA.ADC.Engagement.Shared.Tickets |
| 0 | `TicketRosterImportStatus` | enum | MMCA.ADC.Engagement.Shared.Tickets.Imports |
| 0 | `TicketRosterLimits` | class | MMCA.ADC.Engagement.Shared.Tickets |
| 0 | `TicketRosterSummaryDTO` | record | MMCA.ADC.Engagement.Shared.Tickets |
| 0 | `TicketSettings` | class | MMCA.ADC.Engagement.Shared.Tickets |
| 0 | `TicketStatus` | enum | MMCA.ADC.Engagement.Shared.Tickets |
| 0 | `TicketTypeFunnelDTO` | record | MMCA.ADC.Engagement.Shared.Tickets.Insights.Roster |
| 0 | `UserEngagementBookmarkExportDTO` | record | MMCA.ADC.Engagement.Shared.Exports |
| 0 | `UserEngagementPollVoteExportDTO` | record | MMCA.ADC.Engagement.Shared.Exports |
| 0 | `UserEngagementQuestionUpvoteExportDTO` | record | MMCA.ADC.Engagement.Shared.Exports |
| 0 | `UserEngagementSubmittedQuestionExportDTO` | record | MMCA.ADC.Engagement.Shared.Exports |
| 0 | `UserSessionBookmarkErrorCodes` | class | MMCA.ADC.Engagement.Shared.UserSessionBookmarks |
| 0 | `VisitState` | enum | MMCA.ADC.Engagement.UI.Pages.CheckIns.Sponsors |
| 1 | `Activity` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetTicketInsights |
| 1 | `AdoptionTrendDTO` | record | MMCA.ADC.Engagement.Shared.Tickets.Insights.Roster |
| 1 | `AttendanceStatsDTO` | record | MMCA.ADC.Engagement.Shared.CheckIns.Attendance |
| 1 | `CheckInAttendeeRequest` | record | MMCA.ADC.Engagement.Shared.CheckIns |
| 1 | `CheckInDTO` | record | MMCA.ADC.Engagement.Shared.CheckIns |
| 1 | `CreateBookmarkRequestValidator` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.Create |
| 1 | `DeleteTicketRosterCommand` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.DeleteRoster |
| 1 | `DisabledBookmarkCountService` | class | MMCA.ADC.Engagement.Shared.UserSessionBookmarks |
| 1 | `EmailDomainCountDTO` | record | MMCA.ADC.Engagement.Shared.Tickets.Insights.Roster |
| 1 | `EngagementFeatures` | class | MMCA.ADC.Engagement.Shared |
| 1 | `FunnelCell` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetTicketInsights |
| 1 | `GroupOrdersDTO` | record | MMCA.ADC.Engagement.Shared.Tickets.Insights.Roster |
| 1 | `ILiveChannelPublishQueue` | interface | MMCA.ADC.Engagement.Application.Live |
| 1 | `ImportTicketRosterCommandValidator` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.ImportTicketRoster |
| 1 | `InsightChartData` | class | MMCA.ADC.Engagement.UI.Pages.Tickets.Insights |
| 1 | `InsightCountValue` | class | MMCA.ADC.Engagement.UI.Pages.Tickets.Insights |
| 1 | `InsightReportSection` | class | MMCA.ADC.Engagement.UI.Pages.Tickets.Insights |
| 1 | `IPendingTicketInvitationService` | interface | MMCA.ADC.Engagement.Shared.Tickets.Invitations |
| 1 | `LinkExistingAccountsCommand` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.LinkExistingAccounts |
| 1 | `LiveEventLookup` | record | MMCA.ADC.Engagement.UI.Services.SessionLive |
| 1 | `ManualCheckInRequest` | record | MMCA.ADC.Engagement.Shared.CheckIns |
| 1 | `MyTicketDTO` | record | MMCA.ADC.Engagement.Shared.Tickets |
| 1 | `NowNextSnapshot` | record | MMCA.ADC.Engagement.UI.Services.HappeningNow |
| 1 | `OverviewRow` | record | MMCA.ADC.Engagement.Application.Points.UseCases.GetPointsOverview |
| 1 | `PointsActivityTotalDTO` | record | MMCA.ADC.Engagement.Shared.Points |
| 1 | `PointsEntryDTO` | record | MMCA.ADC.Engagement.Shared.Points |
| 1 | `PointsSubjectKeys` | class | MMCA.ADC.Engagement.Shared.Points |
| 1 | `RoomCheckInRequestValidator` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.RecordRoomCheckIn |
| 1 | `RosterOrders` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetTicketInsights |
| 1 | `ScanOutcome` | record | MMCA.ADC.Engagement.UI.Pages.CheckIns |
| 1 | `SearchBody` | record | MMCA.ADC.Engagement.UI.Services.Lookups |
| 1 | `SendTicketInvitesRequestValidator` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.SendTicketInvites |
| 1 | `SessionLiveUIService` | class | MMCA.ADC.Engagement.UI.Services.SessionLive |
| 1 | `SessionReminderPlanner` | class | MMCA.ADC.Engagement.UI.Services.HappeningNow |
| 1 | `SponsorVisitRequestValidator` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.RecordSponsorVisit |
| 1 | `StartTicketRosterImportCommand` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.StartRosterImport |
| 1 | `TicketRoster` | record | MMCA.ADC.Engagement.Application.Tickets.Services |
| 1 | `TicketRosterImportRunDTO` | record | MMCA.ADC.Engagement.Shared.Tickets.Imports |
| 1 | `TicketTypeCountDTO` | record | MMCA.ADC.Engagement.Shared.Tickets.Insights |
| 1 | `TicketTypeEngagementDTO` | record | MMCA.ADC.Engagement.Shared.Tickets.Insights.Usage |
| 1 | `UserEngagementCheckInExportDTO` | record | MMCA.ADC.Engagement.Shared.Exports |
| 1 | `UserEngagementPointsEntryExportDTO` | record | MMCA.ADC.Engagement.Shared.Exports |
| 1 | `UserEngagementTicketExportDTO` | record | MMCA.ADC.Engagement.Shared.Exports |
| 1 | `UserSessionBookmarkDTO` | record | MMCA.ADC.Engagement.Shared.UserSessionBookmarks |
| 2 | `ArrivalBucketDTO` | record | MMCA.ADC.Engagement.Shared.Tickets.Insights.Usage |
| 2 | `CheckInAttendeeRequestValidator` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.CheckInAttendee |
| 2 | `DeleteTicketRosterCommandValidator` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.DeleteRoster |
| 2 | `DisabledPendingTicketInvitationService` | class | MMCA.ADC.Engagement.Shared.Tickets.Invitations |
| 2 | `EmailDomainMixDTO` | record | MMCA.ADC.Engagement.Shared.Tickets.Insights.Roster |
| 2 | `FeedbackAnswerModel` | class | MMCA.ADC.Engagement.UI.Pages.Feedback |
| 2 | `ILiveEventUIService` | interface | MMCA.ADC.Engagement.UI.Services.SessionLive |
| 2 | `LeaderboardOptInChanged` | record | MMCA.ADC.Engagement.Domain.Points.DomainEvents |
| 2 | `LinkExistingAccountsCommandValidator` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.LinkExistingAccounts |
| 2 | `LiveBroadcastPatch` | class | MMCA.ADC.Engagement.UI.Services.SessionLive |
| 2 | `LiveChannelPublishQueue` | class | MMCA.ADC.Engagement.Application.Live |
| 2 | `ManualCheckInRequestValidator` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.ManualCheckIn |
| 2 | `MyPointsDTO` | record | MMCA.ADC.Engagement.Shared.Points |
| 2 | `PointsEntryChanged` | record | MMCA.ADC.Engagement.Domain.Points.DomainEvents |
| 2 | `PointsOverviewDTO` | record | MMCA.ADC.Engagement.Shared.Points |
| 2 | `SelfHttpWarmupTask` | class | MMCA.ADC.Engagement.Service |
| 2 | `SponsorReachDTO` | record | MMCA.ADC.Engagement.Shared.Tickets.Insights.Usage |
| 2 | `StartTicketRosterImportCommandValidator` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.StartRosterImport |
| 2 | `TicketedVsPresentDTO` | record | MMCA.ADC.Engagement.Shared.Tickets.Insights.Usage |
| 2 | `TicketInvitationGrpcService` | class | MMCA.ADC.Engagement.Service.Grpc |
| 2 | `TicketRosterStaging` | class | MMCA.ADC.Engagement.Application.Tickets.Services |
| 2 | `UserEngagementExportDTO` | record | MMCA.ADC.Engagement.Shared.Exports |
| 2 | `UserSessionBookmarkChanged` | record | MMCA.ADC.Engagement.Domain.UserSessionBookmarks.DomainEvents |
| 3 | `AttendeeCheckedIn` | record | MMCA.ADC.Engagement.Shared.CheckIns.IntegrationEvents |
| 3 | `CurrentEventNotificationScopeProvider` | class | MMCA.ADC.Engagement.UI.Services.Notifications |
| 3 | `EngagementInsightsDTO` | record | MMCA.ADC.Engagement.Shared.Tickets.Insights.Usage |
| 3 | `EngagementPermissionGrants` | class | MMCA.ADC.Engagement.Shared.Authorization |
| 3 | `FeedbackAnswers<TAnswerId>` | class | MMCA.ADC.Engagement.UI.Pages.Feedback |
| 3 | `ICheckInUIService` | interface | MMCA.ADC.Engagement.UI.Services.CheckIns |
| 3 | `IEventFeedbackUIService` | interface | MMCA.ADC.Engagement.UI.Services.Feedback |
| 3 | `ILivePollUIService` | interface | MMCA.ADC.Engagement.UI.Services.SessionLive |
| 3 | `INowNextService` | interface | MMCA.ADC.Engagement.UI.Services.HappeningNow |
| 3 | `IPointsAwarder` | interface | MMCA.ADC.Engagement.Application.Points.Services |
| 3 | `IPointsUIService` | interface | MMCA.ADC.Engagement.UI.Services.Points |
| 3 | `IQuestionLookupService` | interface | MMCA.ADC.Engagement.UI.Services.Feedback |
| 3 | `ISessionBookmarkUIService` | interface | MMCA.ADC.Engagement.Shared.UserSessionBookmarks |
| 3 | `ISessionFeedbackUIService` | interface | MMCA.ADC.Engagement.UI.Services.Feedback |
| 3 | `ISessionLookupService` | interface | MMCA.ADC.Engagement.UI.Services.Lookups |
| 3 | `ISessionQuestionUIService` | interface | MMCA.ADC.Engagement.UI.Services.SessionLive |
| 3 | `ITicketRosterParser` | interface | MMCA.ADC.Engagement.Application.Tickets.Services |
| 3 | `IUserEngagementExportService` | interface | MMCA.ADC.Engagement.Shared.Exports |
| 3 | `LiveChannelPublishProcessor` | class | MMCA.ADC.Engagement.Infrastructure.Live |
| 3 | `OrganizerEventPicker` | class | MMCA.ADC.Engagement.UI.Pages.CheckIns |
| 3 | `RosterInsightsDTO` | record | MMCA.ADC.Engagement.Shared.Tickets.Insights.Roster |
| 3 | `UserSessionBookmarkCacheEvictionHandler` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.DomainEventHandlers |
| 4 | `BookmarkApiClient` | class | MMCA.ADC.Engagement.UI.Services.Bookmarks |
| 4 | `BookmarkCacheEvictionProcessor` | class | MMCA.ADC.Engagement.Infrastructure.Caching |
| 4 | `CheckInService` | class | MMCA.ADC.Engagement.UI.Services.CheckIns |
| 4 | `DependencyInjection` | class | MMCA.ADC.Engagement.API |
| 4 | `DisabledUserEngagementExportService` | class | MMCA.ADC.Engagement.Shared.Exports |
| 4 | `EngagementBrokerConsumers` | class | MMCA.ADC.Engagement.Service |
| 4 | `EngagementInsightsReports` | class | MMCA.ADC.Engagement.UI.Pages.Tickets.Insights |
| 4 | `EventClock` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetTicketInsights |
| 4 | `EventFeedback` | class | MMCA.ADC.Engagement.UI.Pages.Feedback |
| 4 | `EventFeedbackService` | class | MMCA.ADC.Engagement.UI.Services.Feedback |
| 4 | `EventFeedbackSubmittedPointsHandler` | class | MMCA.ADC.Engagement.Application.Points.IntegrationEventHandlers |
| 4 | `ExpireTicketRosterImportInternalCommand` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.ExpireRosterImport |
| 4 | `ITicketUIService` | interface | MMCA.ADC.Engagement.UI.Services.Tickets |
| 4 | `LivePollUIService` | class | MMCA.ADC.Engagement.UI.Services.SessionLive |
| 4 | `NowNextService` | class | MMCA.ADC.Engagement.UI.Services.HappeningNow |
| 4 | `PointsService` | class | MMCA.ADC.Engagement.UI.Services.Points |
| 4 | `ProcessTicketRosterImportInternalCommand` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.ProcessRosterImport |
| 4 | `QuestionLookupService` | class | MMCA.ADC.Engagement.UI.Services.Lookups |
| 4 | `RosterInsightsReports` | class | MMCA.ADC.Engagement.UI.Pages.Tickets.Insights |
| 4 | `SessionFeedbackService` | class | MMCA.ADC.Engagement.UI.Services.Feedback |
| 4 | `SessionFeedbackSubmittedPointsHandler` | class | MMCA.ADC.Engagement.Application.Points.IntegrationEventHandlers |
| 4 | `SessionLookupService` | class | MMCA.ADC.Engagement.UI.Services.Lookups |
| 4 | `SessionQuestionSubmittedPointsHandler` | class | MMCA.ADC.Engagement.Application.Points.DomainEventHandlers |
| 4 | `SessionQuestionUIService` | class | MMCA.ADC.Engagement.UI.Services.SessionLive |
| 4 | `TicketInsightsCsv` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetTicketInsights |
| 4 | `TicketRosterImportReport` | record | MMCA.ADC.Engagement.Application.Tickets.UseCases.ImportTicketRoster |
| 5 | `AttendeeSummary` | record | MMCA.ADC.Engagement.UI.Services.Lookups |
| 5 | `EngagementModule` | class | MMCA.ADC.Engagement.API |
| 5 | `LiveChannelSubscription` | class | MMCA.ADC.Engagement.UI.Services.SessionLive |
| 5 | `MyBadge` | class | MMCA.ADC.Engagement.UI.Pages.CheckIns |
| 5 | `MyPoints` | class | MMCA.ADC.Engagement.UI.Pages.Points |
| 5 | `OrganizerPointsOverview` | class | MMCA.ADC.Engagement.UI.Pages.Points |
| 5 | `RoomCheckIn` | class | MMCA.ADC.Engagement.UI.Pages.CheckIns.Rooms |
| 5 | `SponsorVisit` | class | MMCA.ADC.Engagement.UI.Pages.CheckIns.Sponsors |
| 5 | `TicketImportRun` | class | MMCA.ADC.Engagement.Domain.Tickets |
| 5 | `TicketInvitationServiceGrpcAdapter` | class | MMCA.ADC.Engagement.Contracts |
| 5 | `TicketService` | class | MMCA.ADC.Engagement.UI.Services.Tickets |
| 6 | `AttendeeBadgeInvariants` | class | MMCA.ADC.Engagement.Domain.Badges |
| 6 | `CheckInInvariants` | class | MMCA.ADC.Engagement.Domain.CheckIns |
| 6 | `ErasedUser` | class | MMCA.ADC.Engagement.Domain.ErasedUsers |
| 6 | `IAttendeeLookupService` | interface | MMCA.ADC.Engagement.UI.Services.Lookups |
| 6 | `LeaderboardOptIn` | class | MMCA.ADC.Engagement.Domain.Points |
| 6 | `LeaderboardOptInInvariants` | class | MMCA.ADC.Engagement.Domain.Points |
| 6 | `PointsController` | class | MMCA.ADC.Engagement.API.Controllers |
| 6 | `PointsEntryInvariants` | class | MMCA.ADC.Engagement.Domain.Points |
| 6 | `SessionFeedback` | class | MMCA.ADC.Engagement.UI.Pages.Feedback |
| 6 | `Ticket` | class | MMCA.ADC.Engagement.Domain.Tickets |
| 6 | `TicketImportRunMapping` | class | MMCA.ADC.Engagement.Application.Tickets.DTOs |
| 6 | `TicketInvariants` | class | MMCA.ADC.Engagement.Domain.Tickets |
| 6 | `TicketRosterImportController` | class | MMCA.ADC.Engagement.API.Controllers |
| 6 | `TicketRosterUpload` | class | MMCA.ADC.Engagement.UI.Pages.Tickets |
| 6 | `TicketsController` | class | MMCA.ADC.Engagement.API.Controllers |
| 6 | `UserSessionBookmarkInvariants` | class | MMCA.ADC.Engagement.Domain.UserSessionBookmarks |
| 7 | `AdminFeatureFlagsController` | class | MMCA.ADC.Engagement.API.Controllers |
| 7 | `AttendeeBadge` | class | MMCA.ADC.Engagement.Domain.Badges |
| 7 | `AttendeeLookupService` | class | MMCA.ADC.Engagement.UI.Services.Lookups |
| 7 | `AttendeeSearchPanel` | class | MMCA.ADC.Engagement.UI.Pages.CheckIns |
| 7 | `ClaimTicketRequestValidator` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.ClaimTicket |
| 7 | `Columns` | class | MMCA.ADC.Engagement.Infrastructure.Tickets.TicketLeap |
| 7 | `MyTicketProjection` | class | MMCA.ADC.Engagement.Application.Tickets.DTOs |
| 7 | `NewestRosterTicketSpecification` | class | MMCA.ADC.Engagement.Application.Tickets.Specifications |
| 7 | `PointsEntry` | class | MMCA.ADC.Engagement.Domain.Points |
| 7 | `PointsSettings` | class | MMCA.ADC.Engagement.Shared.Points |
| 7 | `TicketLeapRosterParser` | class | MMCA.ADC.Engagement.Infrastructure.Tickets.TicketLeap |
| 7 | `TicketRosterApplier` | class | MMCA.ADC.Engagement.Application.Tickets.Services |
| 7 | `UserSessionBookmark` | class | MMCA.ADC.Engagement.Domain.UserSessionBookmarks |
| 8 | `BookmarkCountService` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.Services |
| 8 | `BookmarkManagementDomainService` | class | MMCA.ADC.Engagement.Domain.UserSessionBookmarks |
| 8 | `CheckInsController` | class | MMCA.ADC.Engagement.API.Controllers |
| 8 | `DependencyInjection` | class | MMCA.ADC.Engagement.Infrastructure |
| 8 | `ErasedUserGuard` | class | MMCA.ADC.Engagement.Application.ErasedUsers |
| 8 | `ExpireTicketRosterImportHandler` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.ExpireRosterImport |
| 8 | `GetBookmarkedSessionIdsHandler` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetBookmarkedSessionIds |
| 8 | `GetLeaderboardHandler` | class | MMCA.ADC.Engagement.Application.Points.UseCases.GetLeaderboard |
| 8 | `GetPointsOverviewHandler` | class | MMCA.ADC.Engagement.Application.Points.UseCases.GetPointsOverview |
| 8 | `GetRosterInsightsHandler` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetTicketInsights |
| 8 | `GetTicketRosterImportHandler` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetRosterImport |
| 8 | `GetTicketRosterSummaryHandler` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetRosterSummary |
| 8 | `ImportTicketRosterHandler` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.ImportTicketRoster |
| 8 | `PendingTicketInvitationService` | class | MMCA.ADC.Engagement.Application.Tickets.Services |
| 8 | `SessionReminderCoordinator` | class | MMCA.ADC.Engagement.UI.Services.HappeningNow |
| 8 | `TicketImportRunGuard` | class | MMCA.ADC.Engagement.Application.Tickets.Services |
| 8 | `UserDeletedBadgeHandler` | class | MMCA.ADC.Engagement.Application.CheckIns.IntegrationEventHandlers |
| 8 | `UserDeletedBookmarksHandler` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.IntegrationEventHandlers |
| 8 | `UserDeletedPointsHandler` | class | MMCA.ADC.Engagement.Application.Points.IntegrationEventHandlers |
| 8 | `UserDeletedTicketHandler` | class | MMCA.ADC.Engagement.Application.Tickets.IntegrationEventHandlers |
| 8 | `UserSessionBookmarkDTOMapper` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.DTOs |
| 9 | `BookmarkCountServiceGrpcAdapter` | class | MMCA.ADC.Engagement.Contracts |
| 9 | `BookmarkCountsGrpcService` | class | MMCA.ADC.Engagement.Service.Grpc |
| 9 | `BookmarkCreateReplayHandler` | class | MMCA.ADC.Engagement.UI.Services.Bookmarks |
| 9 | `BookmarkDeleteReplayHandler` | class | MMCA.ADC.Engagement.UI.Services.Bookmarks |
| 9 | `CheckInScopeNames` | class | MMCA.ADC.Engagement.Shared.CheckIns |
| 9 | `ClaimTicketHandler` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.ClaimTicket |
| 9 | `CreateBookmarkHandler` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.Create |
| 9 | `DeleteTicketRosterHandler` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.DeleteRoster |
| 9 | `GetMyBadgeHandler` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.GetMyBadge |
| 9 | `GetMyPointsHandler` | class | MMCA.ADC.Engagement.Application.Points.UseCases.GetMyPoints |
| 9 | `GetMyTicketsHandler` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetMyTickets |
| 9 | `GetOrCreateMyBadgeHandler` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.GetOrCreateMyBadge |
| 9 | `GetUserBookmarksHandler` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetUserBookmarks |
| 9 | `LiveEventService` | class | MMCA.ADC.Engagement.UI.Services.SessionLive |
| 9 | `LivePollVotingController` | class | MMCA.ADC.Engagement.API.Controllers |
| 9 | `SendTicketInvitesHandler` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.SendTicketInvites |
| 9 | `SessionBookmarkUIService` | class | MMCA.ADC.Engagement.UI.Services.Bookmarks |
| 9 | `SetLeaderboardParticipationHandler` | class | MMCA.ADC.Engagement.Application.Points.UseCases.SetLeaderboardParticipation |
| 9 | `StartTicketRosterImportHandler` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.StartRosterImport |
| 9 | `TicketLinker` | class | MMCA.ADC.Engagement.Application.Tickets.Services |
| 10 | `CheckIn` | class | MMCA.ADC.Engagement.Domain.CheckIns |
| 10 | `CheckInScan` | class | MMCA.ADC.Engagement.UI.Pages.CheckIns |
| 10 | `ExistingAccountLinker` | class | MMCA.ADC.Engagement.Application.Tickets.Services |
| 10 | `LiveEventListener` | class | MMCA.ADC.Engagement.UI.Components |
| 10 | `MyTicketsPanel` | class | MMCA.ADC.Engagement.UI.Pages.Tickets |
| 10 | `OrganizerAttendance` | class | MMCA.ADC.Engagement.UI.Pages.CheckIns |
| 10 | `PointsAwarder` | class | MMCA.ADC.Engagement.Application.Points.Services |
| 10 | `TicketInsights` | class | MMCA.ADC.Engagement.UI.Pages.Tickets |
| 10 | `TicketRoster` | class | MMCA.ADC.Engagement.UI.Pages.Tickets |
| 10 | `UserEmailVerifiedTicketLinkHandler` | class | MMCA.ADC.Engagement.Application.Tickets.IntegrationEventHandlers |
| 10 | `UserRegisteredTicketLinkHandler` | class | MMCA.ADC.Engagement.Application.Tickets.IntegrationEventHandlers |
| 11 | `AttendeeBadgeConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration.CheckIns |
| 11 | `AuditHistoryController` | class | MMCA.ADC.Engagement.API.Controllers |
| 11 | `BookmarksController` | class | MMCA.ADC.Engagement.API.Controllers |
| 11 | `CheckInConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration.CheckIns |
| 11 | `CheckInDTOMapper` | class | MMCA.ADC.Engagement.Application.CheckIns.DTOs |
| 11 | `CheckInProcessor` | class | MMCA.ADC.Engagement.Application.CheckIns.Services |
| 11 | `EngagementUIModule` | class | MMCA.ADC.Engagement.UI |
| 11 | `ErasedUserConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration.ErasedUsers |
| 11 | `GetAttendanceStatsHandler` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.GetAttendanceStats |
| 11 | `GetEngagementInsightsHandler` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.GetTicketInsights |
| 11 | `LeaderboardOptInConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration.Points |
| 11 | `LinkExistingAccountsHandler` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.LinkExistingAccounts |
| 11 | `LivePollConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration.LivePolls |
| 11 | `LivePollOptionConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration.LivePolls |
| 11 | `LivePollVoteConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration.LivePolls |
| 11 | `PointsEntryConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration.Points |
| 11 | `ProcessTicketRosterImportHandler` | class | MMCA.ADC.Engagement.Application.Tickets.UseCases.ProcessRosterImport |
| 11 | `SessionQuestionConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration.SessionQuestions |
| 11 | `SessionQuestionUpvoteConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration.SessionQuestions |
| 11 | `SessionTimeSlotPoints` | class | MMCA.ADC.Engagement.Application.CheckIns.Services |
| 11 | `TicketConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration.Tickets |
| 11 | `TicketImportRunConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration.Tickets |
| 11 | `UserEngagementExportService` | class | MMCA.ADC.Engagement.Application.Exports |
| 11 | `UserSessionBookmarkConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration.UserSessionBookmarks |
| 12 | `AttendeeCheckedInPointsHandler` | class | MMCA.ADC.Engagement.Application.Points.IntegrationEventHandlers |
| 12 | `CheckInAttendeeHandler` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.CheckInAttendee |
| 12 | `DependencyInjection` | class | MMCA.ADC.Engagement.Application |
| 12 | `DependencyInjection` | class | MMCA.ADC.Engagement.UI |
| 12 | `ManualCheckInHandler` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.ManualCheckIn |
| 12 | `RecordRoomCheckInHandler` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.RecordRoomCheckIn |
| 12 | `RecordSponsorVisitHandler` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.RecordSponsorVisit |
| 12 | `UserEngagementExportGrpcService` | class | MMCA.ADC.Engagement.Service.Grpc |
| 12 | `UserEngagementExportServiceGrpcAdapter` | class | MMCA.ADC.Engagement.Contracts |
| 13 | `DependencyInjection` | class | MMCA.ADC.Engagement.Contracts |

### G26 - ADC Engagement Live Layer (Real-Time Polls & Session Q&A)

> `group-23-engagement-live-layer.md` | 88 types | Real-time audience interaction in the Engagement bounded context: event-wide live polls with voting and moderated per-session Q&A with upvoting, over the SignalR hub-channel transport ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)) and the cross-service gRPC live-channel adapter.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `CastVoteCommand` | record | MMCA.ADC.Engagement.Application.LivePolls.UseCases.CastVote |
| 0 | `CastVoteRequest` | record | MMCA.ADC.Engagement.Shared.LivePolls |
| 0 | `CloseLivePollCommand` | record | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Close |
| 0 | `CreateLivePollRequest` | record | MMCA.ADC.Engagement.Shared.LivePolls |
| 0 | `DeleteLivePollCommand` | record | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Delete |
| 0 | `GetEventPollsQuery` | record | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetEventPolls |
| 0 | `GetModerationQueueQuery` | record | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetModerationQueue |
| 0 | `GetOpenPollsQuery` | record | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetOpenPolls |
| 0 | `GetPollResultsQuery` | record | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetPollResults |
| 0 | `GetSessionManagePollsQuery` | record | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetSessionManagePolls |
| 0 | `GetSessionQuestionsQuery` | record | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetSessionQuestions |
| 0 | `ISessionLiveUIService` | interface | MMCA.ADC.Engagement.Shared.SessionQuestions |
| 0 | `LivePollClosedPayload` | record | MMCA.ADC.Engagement.Shared.LivePolls |
| 0 | `LivePollOpenedPayload` | record | MMCA.ADC.Engagement.Shared.LivePolls |
| 0 | `LivePollOptionDTO` | record | MMCA.ADC.Engagement.Shared.LivePolls |
| 0 | `LivePollOptionResultDTO` | record | MMCA.ADC.Engagement.Shared.LivePolls |
| 0 | `LivePollStatus` | enum | MMCA.ADC.Engagement.Shared.LivePolls |
| 0 | `ModerationAction` | enum | MMCA.ADC.Engagement.Shared.SessionQuestions |
| 0 | `OpenLivePollCommand` | record | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Open |
| 0 | `OptionState` | class | MMCA.ADC.Engagement.UI.Pages.HappeningNow |
| 0 | `OptionState` | class | MMCA.ADC.Engagement.UI.Pages.SessionLive |
| 0 | `QuestionStatus` | enum | MMCA.ADC.Engagement.Shared.SessionQuestions |
| 0 | `SessionQuestionAnsweredPayload` | record | MMCA.ADC.Engagement.Shared.SessionQuestions |
| 0 | `SessionQuestionApprovedPayload` | record | MMCA.ADC.Engagement.Shared.SessionQuestions |
| 0 | `SessionQuestionChannel` | class | MMCA.ADC.Engagement.Shared.SessionQuestions |
| 0 | `SessionQuestionDismissedPayload` | record | MMCA.ADC.Engagement.Shared.SessionQuestions |
| 0 | `SessionQuestionPendingCountChangedPayload` | record | MMCA.ADC.Engagement.Shared.SessionQuestions |
| 0 | `SessionQuestionUpvoteChangedPayload` | record | MMCA.ADC.Engagement.Shared.SessionQuestions |
| 0 | `SubmitQuestionCommand` | record | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Submit |
| 0 | `SubmitQuestionRequest` | record | MMCA.ADC.Engagement.Shared.SessionQuestions |
| 0 | `ToggleUpvoteCommand` | record | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote |
| 1 | `CastVoteCommandValidator` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.CastVote |
| 1 | `CreateLivePollCommand` | record | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create |
| 1 | `LivePollChannel` | class | MMCA.ADC.Engagement.Shared.LivePolls |
| 1 | `LivePollDTO` | record | MMCA.ADC.Engagement.Shared.LivePolls |
| 1 | `LivePollResultsDTO` | record | MMCA.ADC.Engagement.Shared.LivePolls |
| 1 | `ModerateQuestionCommand` | record | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Moderate |
| 1 | `SessionQuestionDTO` | record | MMCA.ADC.Engagement.Shared.SessionQuestions |
| 1 | `ToggleUpvoteCommandValidator` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote |
| 2 | `LivePollChanged` | record | MMCA.ADC.Engagement.Domain.LivePolls.DomainEvents |
| 2 | `LivePollVoteChanged` | record | MMCA.ADC.Engagement.Domain.LivePolls.DomainEvents |
| 2 | `SessionQuestionChanged` | record | MMCA.ADC.Engagement.Domain.SessionQuestions.DomainEvents |
| 2 | `SessionQuestionUpvoteChanged` | record | MMCA.ADC.Engagement.Domain.SessionQuestions.DomainEvents |
| 3 | `LivePollAuthorization` | class | MMCA.ADC.Engagement.Application.LivePolls.Services |
| 4 | `SessionLivePollPanel` | class | MMCA.ADC.Engagement.UI.Pages.SessionLive |
| 6 | `LivePollInvariants` | class | MMCA.ADC.Engagement.Domain.LivePolls |
| 6 | `LivePollVoteInvariants` | class | MMCA.ADC.Engagement.Domain.LivePolls |
| 6 | `PresenterView` | class | MMCA.ADC.Engagement.UI.Pages.SessionLive |
| 6 | `SessionLive` | class | MMCA.ADC.Engagement.UI.Pages.SessionLive |
| 6 | `SessionLiveQuestionPanel` | class | MMCA.ADC.Engagement.UI.Pages.SessionLive |
| 6 | `SessionQuestionInvariants` | class | MMCA.ADC.Engagement.Domain.SessionQuestions |
| 6 | `SessionQuestionUpvoteInvariants` | class | MMCA.ADC.Engagement.Domain.SessionQuestions |
| 7 | `CreateLivePollRequestValidator` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create |
| 7 | `LivePollVote` | class | MMCA.ADC.Engagement.Domain.LivePolls |
| 7 | `SessionQuestion` | class | MMCA.ADC.Engagement.Domain.SessionQuestions |
| 7 | `SessionQuestionUpvote` | class | MMCA.ADC.Engagement.Domain.SessionQuestions |
| 7 | `SubmitQuestionCommandValidator` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Submit |
| 8 | `CreateLivePollCommandValidator` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create |
| 8 | `LivePoll` | class | MMCA.ADC.Engagement.Domain.LivePolls |
| 8 | `LivePollOption` | class | MMCA.ADC.Engagement.Domain.LivePolls |
| 8 | `PollManagementPanel` | class | MMCA.ADC.Engagement.UI.Pages.HappeningNow |
| 8 | `SessionLiveModerationPanel` | class | MMCA.ADC.Engagement.UI.Pages.SessionLive |
| 8 | `SessionQuestionUpvoteChangedHandler` | class | MMCA.ADC.Engagement.Application.SessionQuestions.DomainEventHandlers |
| 8 | `SessionQuestionViewBuilder` | class | MMCA.ADC.Engagement.Application.SessionQuestions.Services |
| 8 | `UserDeletedSessionQuestionsHandler` | class | MMCA.ADC.Engagement.Application.SessionQuestions.IntegrationEventHandlers |
| 8 | `UserDeletedVotesHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.IntegrationEventHandlers |
| 9 | `GetModerationQueueHandler` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetModerationQueue |
| 9 | `GetSessionQuestionsHandler` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetSessionQuestions |
| 9 | `LivePollDTOMapper` | class | MMCA.ADC.Engagement.Application.LivePolls.DTOs |
| 9 | `LivePollResultsBuilder` | class | MMCA.ADC.Engagement.Application.LivePolls.Services |
| 9 | `LivePollsController` | class | MMCA.ADC.Engagement.API.Controllers |
| 9 | `SessionQuestionsController` | class | MMCA.ADC.Engagement.API.Controllers |
| 9 | `SubmitQuestionHandler` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Submit |
| 9 | `ToggleUpvoteHandler` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote |
| 10 | `CastVoteHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.CastVote |
| 10 | `CloseLivePollHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Close |
| 10 | `CreateLivePollHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create |
| 10 | `DeleteLivePollHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Delete |
| 10 | `GetEventPollsHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetEventPolls |
| 10 | `GetOpenPollsHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetOpenPolls |
| 10 | `GetPollResultsHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetPollResults |
| 10 | `GetSessionManagePollsHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetSessionManagePolls |
| 10 | `HappeningNow` | class | MMCA.ADC.Engagement.UI.Pages.HappeningNow |
| 10 | `LivePollNavigationPopulator` | class | MMCA.ADC.Engagement.Application.LivePolls.Services |
| 10 | `LivePollOptionNavigationPopulator` | class | MMCA.ADC.Engagement.Application.LivePolls.Services |
| 10 | `LivePollVoteChangedHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.DomainEventHandlers |
| 10 | `OpenLivePollHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Open |
| 11 | `ModerateQuestionHandler` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Moderate |

### G23 - ADC Identity Module (Users, Profiles, GDPR Export/Erasure)

> `group-24-identity-module.md` | 150 types | The Identity bounded context end-to-end: the User aggregate, change-password/delete/export use cases, persistence, API/contracts/service, and profile/user UI.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AssemblyReference` | class | MMCA.ADC.Identity.Infrastructure |
| 0 | `AssemblyReference` | class | MMCA.ADC.Identity.Domain |
| 0 | `AssemblyReference` | class | MMCA.ADC.Identity.API |
| 0 | `AssemblyReference` | class | MMCA.ADC.Identity.Application |
| 0 | `ClaimNames` | class | MMCA.ADC.Identity.Shared.Authorization |
| 0 | `ClassReference` | class | MMCA.ADC.Identity.Infrastructure |
| 0 | `ClassReference` | class | MMCA.ADC.Identity.Domain |
| 0 | `ClassReference` | class | MMCA.ADC.Identity.Application |
| 0 | `ClassReference` | class | MMCA.ADC.Identity.API |
| 0 | `GetUserAvatarQuery` | record | MMCA.ADC.Identity.Application.Users.UseCases.GetUserAvatar |
| 0 | `IAttendeeQueryService` | interface | MMCA.ADC.Identity.Shared.Users |
| 0 | `IdentityErrorResources` | class | MMCA.ADC.Identity.API.Resources |
| 0 | `IdentityRoutePaths` | class | MMCA.ADC.Identity.UI |
| 0 | `IExternalLoginEmailVerifier` | interface | MMCA.ADC.Identity.Application.Users |
| 0 | `InviteEmailSettings` | class | MMCA.ADC.Identity.Application.Users.UseCases.SendSignInLink |
| 0 | `RemoveUserAvatarCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.RemoveUserAvatar |
| 0 | `RoleEdit` | class | MMCA.ADC.Identity.UI.Pages.Roles |
| 0 | `RoleList` | class | MMCA.ADC.Identity.UI.Pages.Roles |
| 0 | `RoleNames` | class | MMCA.ADC.Identity.Shared.Authorization |
| 0 | `ServiceAccounts` | class | MMCA.ADC.Identity.Domain.Users |
| 0 | `SyntheticAccounts` | class | MMCA.ADC.Identity.Domain.Users |
| 0 | `UserAvatarDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 0 | `UserDataExportBookmarkDTO` | record | MMCA.ADC.Identity.Shared.Users.DataExport |
| 0 | `UserDataExportCheckInDTO` | record | MMCA.ADC.Identity.Shared.Users.DataExport |
| 0 | `UserDataExportFeedbackAnswerDTO` | record | MMCA.ADC.Identity.Shared.Users.DataExport |
| 0 | `UserDataExportNotificationDTO` | record | MMCA.ADC.Identity.Shared.Users.DataExport |
| 0 | `UserDataExportPointsEntryDTO` | record | MMCA.ADC.Identity.Shared.Users.DataExport |
| 0 | `UserDataExportPollVoteDTO` | record | MMCA.ADC.Identity.Shared.Users.DataExport |
| 0 | `UserDataExportQuestionUpvoteDTO` | record | MMCA.ADC.Identity.Shared.Users.DataExport |
| 0 | `UserDataExportSubjectDTO` | record | MMCA.ADC.Identity.Shared.Users.DataExport |
| 0 | `UserDataExportSubmittedQuestionDTO` | record | MMCA.ADC.Identity.Shared.Users.DataExport |
| 0 | `UserDataExportTicketDTO` | record | MMCA.ADC.Identity.Shared.Users.DataExport.Tickets |
| 0 | `UserSearchFilter` | record | MMCA.ADC.Identity.API.Controllers |
| 0 | `VerifiedUserDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 1 | `ConfirmEmailCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.ConfirmEmail |
| 1 | `DisabledAttendeeQueryService` | class | MMCA.ADC.Identity.Shared.Users |
| 1 | `ForgotPasswordCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.ForgotPassword |
| 1 | `IdentityPermissions` | class | MMCA.ADC.Identity.Shared.Authorization |
| 1 | `IVerifiedUserLookupService` | interface | MMCA.ADC.Identity.Shared.Users |
| 1 | `SendSignInLinkCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.SendSignInLink |
| 1 | `SetUserAvatarCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.SetUserAvatar |
| 1 | `UserAdminDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 1 | `UserDataExportConferenceSectionDTO` | record | MMCA.ADC.Identity.Shared.Users.DataExport |
| 1 | `UserDataExportEngagementSectionDTO` | record | MMCA.ADC.Identity.Shared.Users.DataExport |
| 1 | `UserDataExportNotificationSectionDTO` | record | MMCA.ADC.Identity.Shared.Users.DataExport |
| 1 | `UserDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 1 | `UserSearchRequest` | record | MMCA.ADC.Identity.API.Controllers |
| 2 | `ChangePasswordRequestValidator` | class | MMCA.ADC.Identity.Application.Users.Validation |
| 2 | `DisabledVerifiedUserLookupService` | class | MMCA.ADC.Identity.Shared.Users |
| 2 | `ExportUserDataQuery` | record | MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData |
| 2 | `RedeemSignInLinkCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.RedeemSignInLink |
| 2 | `SelfHttpWarmupTask` | class | MMCA.ADC.Identity.Service |
| 2 | `SetUserAvatarCommandValidator` | class | MMCA.ADC.Identity.Application.Users.UseCases.SetUserAvatar |
| 2 | `UserListDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 2 | `UserPasswordChanged` | record | MMCA.ADC.Identity.Domain.Users.DomainEvents |
| 3 | `ConferenceUserDataExportSection` | class | MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData |
| 3 | `HttpContextExternalLoginEmailVerifier` | class | MMCA.ADC.Identity.API.Authentication |
| 3 | `IdentityModule` | class | MMCA.ADC.Identity.API |
| 3 | `IdentityPermissionGrants` | class | MMCA.ADC.Identity.Shared.Authorization |
| 3 | `IImageProcessor` | interface | MMCA.ADC.Identity.Application.Users |
| 3 | `IUserUIService` | interface | MMCA.ADC.Identity.UI.Services |
| 3 | `NotificationUserDataExportSection` | class | MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData |
| 3 | `TicketHolderInvited` | record | MMCA.ADC.Identity.Shared.Users.IntegrationEvents |
| 3 | `UserDeleted` | record | MMCA.ADC.Identity.Shared.Users.IntegrationEvents |
| 3 | `UserEmailVerified` | record | MMCA.ADC.Identity.Shared.Users.IntegrationEvents |
| 3 | `UserRegistered` | record | MMCA.ADC.Identity.Shared.Users.IntegrationEvents |
| 4 | `DependencyInjection` | class | MMCA.ADC.Identity.API |
| 4 | `EmailConfirmationReminder` | class | MMCA.ADC.Identity.UI.Components |
| 4 | `EngagementUserDataExportSection` | class | MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData |
| 4 | `IdentityBrokerConsumers` | class | MMCA.ADC.Identity.Service |
| 4 | `SendEmailConfirmationCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.SendEmailConfirmation |
| 4 | `SendSignInLinkInternalCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.SendSignInLink |
| 4 | `SkiaSharpImageProcessor` | class | MMCA.ADC.Identity.Infrastructure.Services.Users |
| 4 | `TokenPermissionGrants` | class | MMCA.ADC.Identity.Service.Authorization |
| 4 | `UserRole` | class | MMCA.ADC.Identity.Domain.Users |
| 4 | `UserService` | class | MMCA.ADC.Identity.UI.Services |
| 5 | `DeleteAvatarBlobInternalCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.DeleteAvatarBlob |
| 5 | `DependencyInjection` | class | MMCA.ADC.Identity.Infrastructure |
| 5 | `InviteEmail` | class | MMCA.ADC.Identity.Application.Users.UseCases.SendSignInLink |
| 5 | `LegalAndDataCard` | class | MMCA.ADC.Identity.UI.Pages.Users.Profile |
| 5 | `TicketHolderInvitedHandler` | class | MMCA.ADC.Identity.Application.Users.IntegrationEventHandlers |
| 5 | `UserList` | class | MMCA.ADC.Identity.UI.Pages.Users |
| 5 | `UserListService` | class | MMCA.ADC.Identity.UI.Services |
| 6 | `DeleteAvatarBlobInternalCommandHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.DeleteAvatarBlob |
| 6 | `DeleteAvatarBlobInternalCommandValidator` | class | MMCA.ADC.Identity.Application.Users.UseCases.DeleteAvatarBlob |
| 6 | `Profile` | class | MMCA.ADC.Identity.UI.Pages.Users.Profile |
| 6 | `SendSignInLinkInternalCommandHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.SendSignInLink |
| 6 | `UserClaimsController` | class | MMCA.ADC.Identity.API.Controllers |
| 6 | `UserDetail` | class | MMCA.ADC.Identity.UI.Pages.Users.UserDetail |
| 6 | `UserInvariants` | class | MMCA.ADC.Identity.Domain.Users |
| 7 | `AdminMachineClientsController` | class | MMCA.ADC.Identity.API.Controllers.MachineClients |
| 7 | `AdminViewAsGrantsController` | class | MMCA.ADC.Identity.API.Controllers |
| 7 | `EmailConfirmationController` | class | MMCA.ADC.Identity.API.Controllers |
| 7 | `IdentityUIModule` | class | MMCA.ADC.Identity.UI |
| 7 | `MachineTokenController` | class | MMCA.ADC.Identity.API.Controllers.MachineClients |
| 7 | `OAuthController` | class | MMCA.ADC.Identity.API.Controllers |
| 7 | `RegisterRequestValidator` | class | MMCA.ADC.Identity.Application.Users.Validation |
| 7 | `SendSignInLinkInternalCommandValidator` | class | MMCA.ADC.Identity.Application.Users.UseCases.SendSignInLink |
| 7 | `SignInLinkController` | class | MMCA.ADC.Identity.API.Controllers |
| 7 | `User` | class | MMCA.ADC.Identity.Domain.Users |
| 8 | `AttendeeQueryService` | class | MMCA.ADC.Identity.Application.Users |
| 8 | `AuditHistoryController` | class | MMCA.ADC.Identity.API.Controllers.AuditHistory |
| 8 | `ChangePasswordCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.ChangePassword |
| 8 | `ChangePreferencesCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences |
| 8 | `DeleteUserCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.DeleteUser |
| 8 | `DependencyInjection` | class | MMCA.ADC.Identity.UI |
| 8 | `GetUserAvatarHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.GetUserAvatar |
| 8 | `LegalAcceptanceService` | class | MMCA.ADC.Identity.Application.Users |
| 8 | `ResetPasswordCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.ResetPassword |
| 8 | `ServiceAccountProvisioner` | class | MMCA.ADC.Identity.Application.Users.Administration |
| 8 | `SpeakerLinkedToUserHandler` | class | MMCA.ADC.Identity.Application.Speakers.IntegrationEventHandlers |
| 8 | `SpeakerUnlinkedFromUserHandler` | class | MMCA.ADC.Identity.Application.Speakers.IntegrationEventHandlers |
| 8 | `UserDTOMapper` | class | MMCA.ADC.Identity.Application.Users.DTOs |
| 8 | `UserListDTOMapper` | class | MMCA.ADC.Identity.Application.Users.DTOs |
| 8 | `VerifiedUserLookupService` | class | MMCA.ADC.Identity.Application.Users |
| 8 | `ViewAsSubjectResolver` | class | MMCA.ADC.Identity.Application.Users.Administration |
| 9 | `AttendeeQueryServiceGrpcAdapter` | class | MMCA.ADC.Identity.Contracts |
| 9 | `AttendeesGrpcService` | class | MMCA.ADC.Identity.Service.Grpc |
| 9 | `ChangePasswordHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.ChangePassword |
| 9 | `ChangePreferencesCommandValidator` | class | MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences |
| 9 | `ChangePreferencesHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences |
| 9 | `ConfirmEmailHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.ConfirmEmail |
| 9 | `DeleteUserHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.DeleteUser |
| 9 | `ExportUserDataHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData |
| 9 | `GetUserPreferencesHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.GetPreferences |
| 9 | `PasskeysController` | class | MMCA.ADC.Identity.API.Controllers.Passkeys |
| 9 | `ResetPasswordHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.ResetPassword |
| 9 | `UserAdministrationService` | class | MMCA.ADC.Identity.Application.Users.Administration |
| 9 | `UserListEntityQueryService` | class | MMCA.ADC.Identity.Application.Users |
| 9 | `UsersAdminController` | class | MMCA.ADC.Identity.API.Controllers |
| 9 | `UsersController` | class | MMCA.ADC.Identity.API.Controllers |
| 9 | `VerifiedUserLookupGrpcService` | class | MMCA.ADC.Identity.Service.Grpc |
| 9 | `VerifiedUserLookupServiceGrpcAdapter` | class | MMCA.ADC.Identity.Contracts |
| 10 | `DependencyInjection` | class | MMCA.ADC.Identity.Contracts |
| 11 | `AdminRolesController` | class | MMCA.ADC.Identity.API.Controllers |
| 11 | `AuthenticationService` | class | MMCA.ADC.Identity.Application.Users |
| 11 | `ForgotPasswordHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.ForgotPassword |
| 11 | `LegalAcceptanceController` | class | MMCA.ADC.Identity.API.Controllers |
| 11 | `RedeemSignInLinkHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.RedeemSignInLink |
| 11 | `SendEmailConfirmationHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.SendEmailConfirmation |
| 11 | `SendSignInLinkHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.SendSignInLink |
| 11 | `UserConfiguration` | class | MMCA.ADC.Identity.Infrastructure.Persistence.EntityConfiguration |
| 11 | `UsersDataExportController` | class | MMCA.ADC.Identity.API.Controllers |
| 12 | `DependencyInjection` | class | MMCA.ADC.Identity.Application |
| 12 | `IdentityModuleDbSeeder` | class | MMCA.ADC.Identity.Infrastructure.Persistence.DbContexts.Seeding |
| 12 | `SetUserAvatarHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.SetUserAvatar |
| 13 | `IdentityModuleSeeder` | class | MMCA.ADC.Identity.API |
| 13 | `PasswordResetController` | class | MMCA.ADC.Identity.API.Controllers |
| 13 | `RemoveUserAvatarHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.RemoveUserAvatar |
| 14 | `AuthController` | class | MMCA.ADC.Identity.API.Controllers |

### G24 - ADC Application Host, UI Shell & Cross-Module Composition

> `group-25-adc-host-composition.md` | 17 types | The ADC host: the Blazor Web/WASM/WinUI shells, host pages/services, security, and the cross-module application composition.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `MainActivity` | class | MMCA.ADC.UI |
| 0 | `NowNextSession` | record | MMCA.ADC.UI |
| 0 | `WebAuthenticatorCallbackActivity` | class | MMCA.ADC.UI |
| 1 | `ADCHomePageContent` | class | MMCA.ADC.UI.Web.Client.Pages |
| 1 | `NowNextSnapshot` | record | MMCA.ADC.UI |
| 2 | `NowNextWidgetProvider` | class | MMCA.ADC.UI |
| 3 | `DeviceUIModule` | class | MMCA.ADC.UI |
| 3 | `MainPage` | class | MMCA.ADC.UI |
| 4 | `App` | class | MMCA.ADC.UI |
| 6 | `AppActionRouteMap` | class | MMCA.ADC.UI.Services |
| 7 | `AppActionsInitializer` | class | MMCA.ADC.UI.Services |
| 10 | `ADCHomePageContent` | class | MMCA.ADC.UI.Pages |
| 11 | `MauiProgram` | class | MMCA.ADC.UI |
| 12 | `App` | class | MMCA.ADC.UI.WinUI |
| 12 | `AppDelegate` | class | MMCA.ADC.UI |
| 12 | `MainApplication` | class | MMCA.ADC.UI |
| 13 | `Program` | class | MMCA.ADC.UI |

### G27 - Device Capability Abstraction Layer (Native Contracts, MAUI, Browser & Fallback Adapters)

> `group-26-device-capability-layer.md` | 112 types | Per-capability interface contracts (biometric, geocoding/geolocation, speech, push registration, media/clipboard/screenshot, haptics, share, external auth/links, local cache/notifications, connectivity/battery/accessibility, deep links) plus their MAUI-native, browser-JS-interop, and inert fallback implementations, selected per host at DI composition time ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)/043/044/045).

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AppResumedEventArgs` | class | MMCA.Common.UI.Services.Capabilities.DeviceStatus |
| 0 | `AutofillCallback` | class | MMCA.Common.UI.Services.Capabilities.Auth |
| 0 | `BarcodeScanPage` | class | MMCA.Common.UI.Maui.Capabilities.Media |
| 0 | `DevicePreferenceKeys` | class | MMCA.Common.UI.Services.Capabilities.DeviceStorage |
| 0 | `ExternalSignInResult` | class | MMCA.Common.UI.Services.Capabilities.Auth |
| 0 | `GeoPoint` | record | MMCA.Common.UI.Services.Capabilities.Geo |
| 0 | `IAccessibilityAnnouncer` | interface | MMCA.Common.UI.Services.Capabilities.Accessibility |
| 0 | `IBarcodeScannerService` | interface | MMCA.Common.UI.Services.Capabilities.Media |
| 0 | `IBatteryStatusService` | interface | MMCA.Common.UI.Services.Capabilities.DeviceStatus |
| 0 | `IBiometricAuthenticator` | interface | MMCA.Common.UI.Services.Capabilities.Auth |
| 0 | `IClipboardService` | interface | MMCA.Common.UI.Services.Capabilities.Interop |
| 0 | `IConnectivityStatusService` | interface | MMCA.Common.UI.Services.Capabilities.DeviceStatus |
| 0 | `IDevicePreferences` | interface | MMCA.Common.UI.Services.Capabilities.DeviceStorage |
| 0 | `IExternalLinkService` | interface | MMCA.Common.UI.Services.Capabilities.Interop |
| 0 | `IFormFactor` | interface | MMCA.Common.UI.Services |
| 0 | `IHapticFeedbackService` | interface | MMCA.Common.UI.Services.Capabilities.DeviceStatus |
| 0 | `ILocalCacheStore` | interface | MMCA.Common.UI.Services.Capabilities.DeviceStorage |
| 0 | `IMapNavigationService` | interface | MMCA.Common.UI.Services.Capabilities.Geo |
| 0 | `IPasskeyCapability` | interface | MMCA.Common.UI.Services.Capabilities.Auth |
| 0 | `IPushRegistrationService` | interface | MMCA.Common.UI.Services.Capabilities.Notifications |
| 0 | `IScreenshotService` | interface | MMCA.Common.UI.Services.Capabilities.Interop |
| 0 | `IShareService` | interface | MMCA.Common.UI.Services.Capabilities.Interop |
| 0 | `ISpeechToTextService` | interface | MMCA.Common.UI.Services.Capabilities.Media |
| 0 | `ITextToSpeechService` | interface | MMCA.Common.UI.Services.Capabilities.Media |
| 0 | `LocalNotificationRequest` | record | MMCA.Common.UI.Services.Capabilities.Notifications |
| 0 | `MauiErrorHandlingInitializer` | class | MMCA.Common.UI.Maui |
| 0 | `MauiThemeStore` | class | MMCA.Common.UI.Maui.Theme |
| 0 | `PickedMedia` | class | MMCA.Common.UI.Services.Capabilities.Media |
| 0 | `PushDeviceToken` | record | MMCA.Common.UI.Services.Capabilities.Notifications |
| 1 | `AlwaysOnlineConnectivityStatusService` | class | MMCA.Common.UI.Services.Capabilities.DeviceStatus |
| 1 | `BrowserMapNavigationService` | class | MMCA.Common.UI.Services.Capabilities.Geo |
| 1 | `BrowserPasskeyCapability` | class | MMCA.Common.UI.Services.Capabilities.Auth |
| 1 | `CapabilitiesJsModule` | class | MMCA.Common.UI.Services.Capabilities |
| 1 | `DeepLinkRouteEventArgs` | class | MMCA.Common.UI.Services.Capabilities.Navigation |
| 1 | `IAppLifecycleNotifier` | interface | MMCA.Common.UI.Services.Capabilities.DeviceStatus |
| 1 | `IExternalAuthBroker` | interface | MMCA.Common.UI.Services.Capabilities.Auth |
| 1 | `IGeocodingService` | interface | MMCA.Common.UI.Services.Capabilities.Geo |
| 1 | `IGeolocationService` | interface | MMCA.Common.UI.Services.Capabilities.Geo |
| 1 | `ILocalNotificationService` | interface | MMCA.Common.UI.Services.Capabilities.Notifications |
| 1 | `IMediaPickerService` | interface | MMCA.Common.UI.Services.Capabilities.Media |
| 1 | `InMemoryDevicePreferences` | class | MMCA.Common.UI.Services.Capabilities.DeviceStorage |
| 1 | `IPushDeviceTokenProvider` | interface | MMCA.Common.UI.Services.Capabilities.Notifications |
| 1 | `MauiAccessibilityAnnouncer` | class | MMCA.Common.UI.Maui.Capabilities.Accessibility |
| 1 | `MauiAppUserAgentHandler` | class | MMCA.Common.UI.Maui.Services |
| 1 | `MauiBarcodeScannerService` | class | MMCA.Common.UI.Maui.Capabilities.Media |
| 1 | `MauiBatteryStatusService` | class | MMCA.Common.UI.Maui.Capabilities.DeviceStatus |
| 1 | `MauiBiometricAuthenticator` | class | MMCA.Common.UI.Maui.Capabilities.Auth |
| 1 | `MauiClipboardService` | class | MMCA.Common.UI.Maui.Capabilities.Interop |
| 1 | `MauiConnectivityStatusService` | class | MMCA.Common.UI.Maui.Capabilities.DeviceStatus |
| 1 | `MauiCultureStore` | class | MMCA.Common.UI.Maui.Globalization |
| 1 | `MauiDeviceMetadataReporter` | class | MMCA.Common.UI.Maui.Services |
| 1 | `MauiDevicePreferences` | class | MMCA.Common.UI.Maui.Capabilities.DeviceStorage |
| 1 | `MauiExternalLinkService` | class | MMCA.Common.UI.Maui.Capabilities.Interop |
| 1 | `MauiFormFactor` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiHapticFeedbackService` | class | MMCA.Common.UI.Maui.Capabilities.DeviceStatus |
| 1 | `MauiInitialThemeModeSource` | class | MMCA.Common.UI.Maui.Theme |
| 1 | `MauiLocalCacheStore` | class | MMCA.Common.UI.Maui.Capabilities.DeviceStorage |
| 1 | `MauiMapNavigationService` | class | MMCA.Common.UI.Maui.Capabilities.Geo |
| 1 | `MauiPublicLinkBuilder` | class | MMCA.Common.UI.Maui.Services |
| 1 | `MauiScreenshotService` | class | MMCA.Common.UI.Maui.Capabilities.Interop |
| 1 | `MauiSecureTokenStore` | class | MMCA.Common.UI.Maui.Services |
| 1 | `MauiShareService` | class | MMCA.Common.UI.Maui.Capabilities.Interop |
| 1 | `MauiSpeechToTextService` | class | MMCA.Common.UI.Maui.Capabilities.Media |
| 1 | `MauiTextToSpeechService` | class | MMCA.Common.UI.Maui.Capabilities.Media |
| 1 | `NullAccessibilityAnnouncer` | class | MMCA.Common.UI.Services.Capabilities.Accessibility |
| 1 | `NullBarcodeScannerService` | class | MMCA.Common.UI.Services.Capabilities.Media |
| 1 | `NullBatteryStatusService` | class | MMCA.Common.UI.Services.Capabilities.DeviceStatus |
| 1 | `NullBiometricAuthenticator` | class | MMCA.Common.UI.Services.Capabilities.Auth |
| 1 | `NullClipboardService` | class | MMCA.Common.UI.Services.Capabilities.Interop |
| 1 | `NullExternalLinkService` | class | MMCA.Common.UI.Services.Capabilities.Interop |
| 1 | `NullHapticFeedbackService` | class | MMCA.Common.UI.Services.Capabilities.DeviceStatus |
| 1 | `NullLocalCacheStore` | class | MMCA.Common.UI.Services.Capabilities.DeviceStorage |
| 1 | `NullMapNavigationService` | class | MMCA.Common.UI.Services.Capabilities.Geo |
| 1 | `NullPushRegistrationService` | class | MMCA.Common.UI.Services.Capabilities.Notifications |
| 1 | `NullScreenshotService` | class | MMCA.Common.UI.Services.Capabilities.Interop |
| 1 | `NullShareService` | class | MMCA.Common.UI.Services.Capabilities.Interop |
| 1 | `NullSpeechToTextService` | class | MMCA.Common.UI.Services.Capabilities.Media |
| 1 | `NullTextToSpeechService` | class | MMCA.Common.UI.Services.Capabilities.Media |
| 1 | `UnavailablePasskeyCapability` | class | MMCA.Common.UI.Services.Capabilities.Auth |
| 1 | `WasmFormFactor` | class | MMCA.Common.UI.Services |
| 1 | `WebFormFactor` | class | MMCA.Common.UI.Web.Services |
| 2 | `AppLifecycleNotifier` | class | MMCA.Common.UI.Services.Capabilities.DeviceStatus |
| 2 | `BrowserAccessibilityAnnouncer` | class | MMCA.Common.UI.Services.Capabilities.Accessibility |
| 2 | `BrowserClipboardService` | class | MMCA.Common.UI.Services.Capabilities.Interop |
| 2 | `BrowserConnectivityStatusService` | class | MMCA.Common.UI.Services.Capabilities.DeviceStatus |
| 2 | `BrowserDevicePreferences` | class | MMCA.Common.UI.Services.Capabilities.DeviceStorage |
| 2 | `BrowserExternalLinkService` | class | MMCA.Common.UI.Services.Capabilities.Interop |
| 2 | `BrowserLocalCacheStore` | class | MMCA.Common.UI.Services.Capabilities.DeviceStorage |
| 2 | `BrowserShareService` | class | MMCA.Common.UI.Services.Capabilities.Interop |
| 2 | `IDeepLinkDispatcher` | interface | MMCA.Common.UI.Services.Capabilities.Navigation |
| 2 | `MainPageBase` | class | MMCA.Common.UI.Maui |
| 2 | `MauiCapabilitiesJsModuleRegistration` | class | MMCA.Common.UI.Maui.Capabilities.Interop |
| 2 | `MauiCultureApplier` | class | MMCA.Common.UI.Maui.Globalization |
| 2 | `MauiCultureInitializer` | class | MMCA.Common.UI.Maui.Globalization |
| 2 | `MauiExternalAuthBroker` | class | MMCA.Common.UI.Maui.Capabilities.Auth |
| 2 | `MauiGeocodingService` | class | MMCA.Common.UI.Maui.Capabilities.Geo |
| 2 | `MauiGeolocationService` | class | MMCA.Common.UI.Maui.Capabilities.Geo |
| 2 | `MauiLocalNotificationService` | class | MMCA.Common.UI.Maui.Capabilities.Notifications |
| 2 | `MauiMediaPickerService` | class | MMCA.Common.UI.Maui.Capabilities.Media |
| 2 | `MauiPushRegistrationService` | class | MMCA.Common.UI.Maui.Capabilities.Notifications |
| 2 | `NullGeocodingService` | class | MMCA.Common.UI.Services.Capabilities.Geo |
| 2 | `NullGeolocationService` | class | MMCA.Common.UI.Services.Capabilities.Geo |
| 2 | `NullLocalNotificationService` | class | MMCA.Common.UI.Services.Capabilities.Notifications |
| 2 | `NullMediaPickerService` | class | MMCA.Common.UI.Services.Capabilities.Media |
| 2 | `NullPushDeviceTokenProvider` | class | MMCA.Common.UI.Services.Capabilities.Notifications |
| 2 | `UnavailableExternalAuthBroker` | class | MMCA.Common.UI.Services.Capabilities.Auth |
| 2 | `WindowLifecycleExtensions` | class | MMCA.Common.UI.Maui |
| 3 | `DeepLinkDispatcher` | class | MMCA.Common.UI.Services.Capabilities.Navigation |
| 3 | `DependencyInjection` | class | MMCA.Common.UI.Maui |
| 3 | `DeviceCapabilitiesInitializer` | class | MMCA.Common.UI.Maui |
| 4 | `DependencyInjection` | class | MMCA.Common.UI.Services.Capabilities |
| 4 | `HostingDependencyInjection` | class | MMCA.Common.UI.Maui |

### G28 - Common AI Integration

> `group-27-common-ai-integration.md` | 46 types | The AI provider settings, bounded/metered chat client wrapper, and prompt contract types used to integrate LLM calls into Common-based apps.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AiSettings` | class | MMCA.Common.AI |
| 0 | `AiUsageMeter` | class | MMCA.Common.AI.Observability |
| 0 | `ChatToolPolicy` | class | MMCA.Common.AI.Guardrails |
| 0 | `CommonMcpOptions` | class | MMCA.Common.Mcp |
| 0 | `ContentMetadata` | class | MMCA.Common.AI.Guardrails |
| 0 | `ContentPolicyInjectionMode` | enum | MMCA.Common.AI.Guardrails |
| 0 | `GoldenReplayCase` | record | MMCA.Common.AI.Testing |
| 0 | `GuardrailVerdict` | record struct | MMCA.Common.AI.Chat |
| 0 | `IAiTokenEstimator` | interface | MMCA.Common.AI.Chat |
| 0 | `IChatRequestRedactor` | interface | MMCA.Common.AI.Guardrails |
| 0 | `IPromptInjectionGuardrail` | interface | MMCA.Common.AI.Guardrails |
| 0 | `McpEnabledMarker` | class | MMCA.Common.Mcp |
| 0 | `McpHiddenText` | class | MMCA.Common.Mcp |
| 0 | `McpToolPermissionAttribute` | class | MMCA.Common.Mcp |
| 0 | `McpToolPublicAttribute` | class | MMCA.Common.Mcp |
| 0 | `McpToolSettings` | class | MMCA.Common.Mcp |
| 0 | `PromptContract` | record | MMCA.Common.AI |
| 0 | `RecordedResponses` | class | MMCA.Common.AI.Testing |
| 0 | `ReplayChatClient` | class | MMCA.Common.AI.Testing |
| 0 | `ToolAuthorization` | enum | MMCA.Common.AI.Guardrails |
| 0 | `ToolCall` | record struct | MMCA.Common.Mcp |
| 1 | `ChatGuardrailException` | class | MMCA.Common.AI.Chat |
| 1 | `GoldenReplayTestsBase` | class | MMCA.Common.AI.Testing |
| 1 | `IAiProviderFactory` | interface | MMCA.Common.AI.Providers |
| 1 | `IChatGuardrail` | interface | MMCA.Common.AI.Chat |
| 1 | `IChatToolPolicy` | interface | MMCA.Common.AI.Guardrails |
| 1 | `McpSettings` | class | MMCA.Common.Mcp |
| 1 | `McpToolRateLimiter` | class | MMCA.Common.Mcp |
| 1 | `PromptContractPinTestsBase` | class | MMCA.Common.AI.Testing |
| 1 | `PromptTaggingChatClient` | class | MMCA.Common.AI.Chat |
| 1 | `ToolDescriptionInspector` | class | MMCA.Common.Mcp |
| 1 | `UsageRecordingChatClient` | class | MMCA.Common.AI.Chat |
| 2 | `AiProviderValidator` | class | MMCA.Common.AI.Providers |
| 2 | `AnthropicAiProviderFactory` | class | MMCA.Common.AI.Anthropic |
| 2 | `BoundedChatClient` | class | MMCA.Common.AI.Chat |
| 2 | `ContentPolicyGuardrail` | class | MMCA.Common.AI.Guardrails |
| 2 | `ContentPolicySettings` | class | MMCA.Common.AI.Guardrails |
| 2 | `GuardrailChatClient` | class | MMCA.Common.AI.Chat |
| 2 | `McpToolGovernance` | class | MMCA.Common.Mcp |
| 2 | `OpenAiProviderFactory` | class | MMCA.Common.AI.OpenAI |
| 3 | `AiServiceCollectionExtensions` | class | MMCA.Common.AI |
| 3 | `AnthropicAiServiceCollectionExtensions` | class | MMCA.Common.AI.Anthropic |
| 3 | `OpenAiServiceCollectionExtensions` | class | MMCA.Common.AI.OpenAI |
| 3 | `PiiRedactionGuardrail` | class | MMCA.Common.AI.Guardrails |
| 4 | `GuardrailServiceCollectionExtensions` | class | MMCA.Common.AI.Guardrails |
| 6 | `McpHostingExtensions` | class | MMCA.Common.Mcp |

### G29 - Common Cloud Provider Adapters (AWS, Azure, GCP)

> `group-28-common-cloud-provider-adapters.md` | 119 types | Vendor-specific cloud adapters in MMCA.Common.Aws, .Azure and .Gcp (messaging transports, native push, file storage, secrets, database IAM auth, data protection, telemetry) that implement the provider-neutral Common abstractions.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AmazonSqsTransportSettings` | class | MMCA.Common.Aws.Messaging |
| 0 | `AwsClientEndpoint` | class | MMCA.Common.Aws |
| 0 | `AwsSecretsManagerConfigurationProvider` | class | MMCA.Common.Aws.Secrets |
| 0 | `AwsStaticCredentials` | class | MMCA.Common.Aws |
| 0 | `AwsTelemetrySettings` | class | MMCA.Common.Aws.Telemetry |
| 0 | `AzureBlobFileStorageSettings` | class | MMCA.Common.Azure.Storage |
| 0 | `AzureKeyRingAtRestNoticeService` | class | MMCA.Common.Azure |
| 0 | `AzureNotificationHubSettings` | class | MMCA.Common.Azure.Notifications |
| 0 | `AzurePostgreSqlEntraAuthenticationSettings` | class | MMCA.Common.Azure.PostgreSql |
| 0 | `AzureRedisEntraAuthenticationSettings` | class | MMCA.Common.Azure.Redis |
| 0 | `AzureServiceBusEndpoint` | class | MMCA.Common.Azure.Messaging |
| 0 | `AzureServiceBusTransportSettings` | class | MMCA.Common.Azure.Messaging |
| 0 | `AzureTokenCredentials` | class | MMCA.Common.Azure |
| 0 | `CloudSqlIamAuthenticationSettings` | class | MMCA.Common.Gcp.CloudSql |
| 0 | `CredentialFailure` | enum | MMCA.Common.Aws.Telemetry |
| 0 | `FcmInstallation` | record | MMCA.Common.Gcp.Notifications |
| 0 | `FcmNativePushSettings` | class | MMCA.Common.Gcp.Notifications |
| 0 | `FcmSendOutcome` | record | MMCA.Common.Gcp.Notifications |
| 0 | `FirstFailure` | class | MMCA.Common.Gcp.Notifications |
| 0 | `GcpKeyRingAtRestNoticeService` | class | MMCA.Common.Gcp.DataProtection |
| 0 | `GcpKmsXmlDecryptor` | class | MMCA.Common.Gcp.DataProtection |
| 0 | `GcpKmsXmlEncryptor` | class | MMCA.Common.Gcp.DataProtection |
| 0 | `GcsFileStorageSettings` | class | MMCA.Common.Gcp.Storage |
| 0 | `GcsObjectLocation` | record | MMCA.Common.Gcp.DataProtection |
| 0 | `GoogleSecretManagerConfigurationProvider` | class | MMCA.Common.Gcp.Secrets |
| 0 | `IAmazonSqsSettlement` | interface | MMCA.Common.Aws.Messaging |
| 0 | `IAwsTelemetryCredentialSource` | interface | MMCA.Common.Aws.Telemetry |
| 0 | `IAzureServiceBusSettlement` | interface | MMCA.Common.Azure.Messaging |
| 0 | `IGoogleCloudTelemetryTokenSource` | interface | MMCA.Common.Gcp.Telemetry |
| 0 | `NativePushUserTags` | class | MMCA.Common.Azure.Notifications |
| 0 | `NotificationHubConnection` | class | MMCA.Common.Azure.Notifications |
| 0 | `NotificationHubException` | class | MMCA.Common.Azure.Notifications |
| 0 | `NotificationHubInstallationState` | record | MMCA.Common.Azure.Notifications |
| 0 | `NotificationHubNotification` | record | MMCA.Common.Azure.Notifications |
| 0 | `NotificationHubPlatform` | enum | MMCA.Common.Azure.Notifications |
| 0 | `NotificationHubRegistrationPage` | record | MMCA.Common.Azure.Notifications |
| 0 | `RdsIamAuthenticationSettings` | class | MMCA.Common.Aws.Rds |
| 0 | `S3FileStorageSettings` | class | MMCA.Common.Aws.Storage |
| 0 | `S3ObjectLocation` | record | MMCA.Common.Aws.DataProtection |
| 0 | `ServiceBusEmulatorSupport` | class | MMCA.Common.Azure.Messaging |
| 0 | `SnsInstallation` | record | MMCA.Common.Aws.Notifications |
| 1 | `AmazonSqsConnection` | class | MMCA.Common.Aws.Messaging |
| 1 | `ApplicationDefaultTelemetryTokenSource` | class | MMCA.Common.Gcp.Telemetry |
| 1 | `AwsDataProtectionExtensions` | class | MMCA.Common.Aws |
| 1 | `AwsSecretsManagerConfigurationSource` | class | MMCA.Common.Aws.Secrets |
| 1 | `AwsTelemetryCredentialWarmup` | class | MMCA.Common.Aws.Telemetry |
| 1 | `AzureDataProtectionExtensions` | class | MMCA.Common.Azure |
| 1 | `AzureKeyVaultConfigurationExtensions` | class | MMCA.Common.Azure |
| 1 | `AzureMonitorExporterExtensions` | class | MMCA.Common.Azure |
| 1 | `AzurePostgreSqlAccessTokenSource` | class | MMCA.Common.Azure.PostgreSql |
| 1 | `AzureRedisEntraAuthenticationConfigurator` | class | MMCA.Common.Azure.Redis |
| 1 | `AzureServiceBusConnection` | class | MMCA.Common.Azure.Messaging |
| 1 | `CloudSqlAccessTokenSource` | class | MMCA.Common.Gcp.CloudSql |
| 1 | `DefaultChainAwsTelemetryCredentialSource` | class | MMCA.Common.Aws.Telemetry |
| 1 | `GcsObjectUrl` | class | MMCA.Common.Gcp.Storage |
| 1 | `GcsStorageClientFactory` | class | MMCA.Common.Gcp.Storage |
| 1 | `GcsXmlRepository` | class | MMCA.Common.Gcp.DataProtection |
| 1 | `GoogleCloudDataProtectionExtensions` | class | MMCA.Common.Gcp |
| 1 | `GoogleCloudTelemetryAccessToken` | class | MMCA.Common.Gcp.Telemetry |
| 1 | `GoogleSecretManagerConfigurationSource` | class | MMCA.Common.Gcp.Secrets |
| 1 | `IFcmInstallationRegistry` | interface | MMCA.Common.Gcp.Notifications |
| 1 | `IFcmMessagingClient` | interface | MMCA.Common.Gcp.Notifications |
| 1 | `NotificationHubInstallation` | record | MMCA.Common.Azure.Notifications |
| 1 | `NotificationHubRetryPolicy` | class | MMCA.Common.Azure.Notifications |
| 1 | `ProcessorSettlement` | class | MMCA.Common.Azure.Messaging |
| 1 | `S3ObjectUrl` | class | MMCA.Common.Aws.Storage |
| 1 | `S3StorageClientFactory` | class | MMCA.Common.Aws.Storage |
| 1 | `S3XmlRepository` | class | MMCA.Common.Aws.DataProtection |
| 1 | `SnsNativePushSettings` | class | MMCA.Common.Aws.Notifications |
| 1 | `SnsPushMessage` | class | MMCA.Common.Aws.Notifications |
| 1 | `StaticAwsTelemetryCredentialSource` | class | MMCA.Common.Aws.Telemetry |
| 2 | `AwsDataProtectionBuilderExtensions` | class | MMCA.Common.Aws.DataProtection |
| 2 | `AwsSecretsManagerConfigurationExtensions` | class | MMCA.Common.Aws |
| 2 | `AwsSigV4ExportHandler` | class | MMCA.Common.Aws.Telemetry |
| 2 | `AwsTelemetryExporterExtensions` | class | MMCA.Common.Aws |
| 2 | `AzurePostgreSqlEntraAuthenticationConfigurator` | class | MMCA.Common.Azure.PostgreSql |
| 2 | `AzureServiceBusMessageMapping` | class | MMCA.Common.Azure.Messaging |
| 2 | `CloudSqlIamAuthenticationConfigurator` | class | MMCA.Common.Gcp.CloudSql |
| 2 | `EndpointTally` | class | MMCA.Common.Aws.Notifications |
| 2 | `FirebaseMessagingClient` | class | MMCA.Common.Gcp.Notifications |
| 2 | `FirestoreInstallationRegistry` | class | MMCA.Common.Gcp.Notifications |
| 2 | `GcpDataProtectionBuilderExtensions` | class | MMCA.Common.Gcp.DataProtection |
| 2 | `GoogleCloudTelemetryAuthHandler` | class | MMCA.Common.Gcp.Telemetry |
| 2 | `GoogleSecretManagerConfigurationExtensions` | class | MMCA.Common.Gcp |
| 2 | `INotificationHubRestClient` | interface | MMCA.Common.Azure.Notifications |
| 2 | `NotificationHubWireFormat` | class | MMCA.Common.Azure.Notifications |
| 2 | `RdsIamAuthenticationConfigurator` | class | MMCA.Common.Aws.Rds |
| 2 | `SnsInstallationRegistry` | class | MMCA.Common.Aws.Notifications |
| 2 | `SnsPushClientFactory` | class | MMCA.Common.Aws.Notifications |
| 3 | `AmazonSqsEntityNames` | class | MMCA.Common.Aws.Messaging |
| 3 | `AzureNotificationHubNativePushSender` | class | MMCA.Common.Azure.Notifications |
| 3 | `AzureServiceBusDeliveryHandler` | class | MMCA.Common.Azure.Messaging |
| 3 | `AzureServiceBusEntityNames` | class | MMCA.Common.Azure.Messaging |
| 3 | `FcmPushClientFactory` | class | MMCA.Common.Gcp.Notifications |
| 3 | `GoogleCloudTelemetryExporterExtensions` | class | MMCA.Common.Gcp |
| 3 | `NotificationHubRestClient` | class | MMCA.Common.Azure.Notifications |
| 3 | `SnsNativePushSender` | class | MMCA.Common.Aws.Notifications |
| 4 | `AzureBlobFileStorageService` | class | MMCA.Common.Azure.Storage |
| 4 | `AzureNotificationHubDeviceRegistrar` | class | MMCA.Common.Azure.Notifications |
| 4 | `AzureServiceBusTopologyProvisioner` | class | MMCA.Common.Azure.Messaging |
| 4 | `FcmPushDeviceRegistrar` | class | MMCA.Common.Gcp.Notifications |
| 4 | `GcsFileStorageService` | class | MMCA.Common.Gcp.Storage |
| 4 | `S3FileStorageService` | class | MMCA.Common.Aws.Storage |
| 4 | `SnsPushDeviceRegistrar` | class | MMCA.Common.Aws.Notifications |
| 5 | `AzureServiceBusPublisher` | class | MMCA.Common.Azure.Messaging |
| 5 | `AzureServiceBusReceiver` | class | MMCA.Common.Azure.Messaging |
| 6 | `AmazonSqsDeliveryHandler` | class | MMCA.Common.Aws.Messaging |
| 6 | `AmazonSqsMessageMapping` | class | MMCA.Common.Aws.Messaging |
| 6 | `AmazonSqsPublisher` | class | MMCA.Common.Aws.Messaging |
| 6 | `AmazonSqsReceiver` | class | MMCA.Common.Aws.Messaging |
| 6 | `AmazonSqsTopologyProvisioner` | class | MMCA.Common.Aws.Messaging |
| 6 | `AmazonSqsTransport` | class | MMCA.Common.Aws.Messaging |
| 6 | `AzureServiceBusTransport` | class | MMCA.Common.Azure.Messaging |
| 6 | `FcmPushMessage` | class | MMCA.Common.Gcp.Notifications |
| 6 | `QueueSettlement` | class | MMCA.Common.Aws.Messaging |
| 7 | `AwsServiceCollectionExtensions` | class | MMCA.Common.Aws |
| 7 | `AzureServiceCollectionExtensions` | class | MMCA.Common.Azure |
| 7 | `FcmNativePushSender` | class | MMCA.Common.Gcp.Notifications |
| 8 | `GcpServiceCollectionExtensions` | class | MMCA.Common.Gcp |

### G25 - Testing & Quality Infrastructure

> `group-29-testing-infrastructure.md` | 4921 types | All test projects + the reusable Testing/Testing.E2E/Testing.UI bases, architecture-fitness tests, and the component Gallery harness; individual [Fact]s are rolled up by project (logged exception).

Rolled up by project (individual `[Fact]`s not sectioned - logged exception). Reusable test
infrastructure assemblies (sectioned in full in the chapter) are marked **(infra)**.

| Test project (assembly) | Types | Levels | Kind |
|--------------------------|-------|--------|------|
| `MMCA.ADC.Architecture.Tests` **(infra)** | 86 | L0-L13 |  |
| `MMCA.ADC.Conference.API.Tests`  | 39 | L0-L12 |  |
| `MMCA.ADC.Conference.Application.Tests`  | 209 | L0-L13 |  |
| `MMCA.ADC.Conference.Domain.Tests`  | 38 | L6-L10 |  |
| `MMCA.ADC.Conference.Infrastructure.Tests`  | 16 | L0-L12 |  |
| `MMCA.ADC.Conference.IntegrationTests`  | 64 | L0-L19 |  |
| `MMCA.ADC.Conference.Scoring.Evaluation.Tests`  | 10 | L0-L4 |  |
| `MMCA.ADC.Conference.Shared.Tests`  | 9 | L0-L10 |  |
| `MMCA.ADC.Conference.UI.Tests`  | 153 | L0-L12 |  |
| `MMCA.ADC.CrossService.IntegrationTests`  | 13 | L1-L18 |  |
| `MMCA.ADC.E2E.Tests`  | 126 | L0-L8 |  |
| `MMCA.ADC.Engagement.API.Tests`  | 15 | L1-L12 |  |
| `MMCA.ADC.Engagement.Application.Tests`  | 92 | L1-L13 |  |
| `MMCA.ADC.Engagement.Domain.Tests`  | 14 | L6-L11 |  |
| `MMCA.ADC.Engagement.Infrastructure.Tests`  | 11 | L1-L13 |  |
| `MMCA.ADC.Engagement.IntegrationTests`  | 34 | L0-L18 |  |
| `MMCA.ADC.Engagement.Shared.Tests`  | 8 | L1-L10 |  |
| `MMCA.ADC.Engagement.UI.Tests`  | 76 | L0-L11 |  |
| `MMCA.ADC.Gateway.Tests`  | 11 | L0-L15 |  |
| `MMCA.ADC.Identity.API.Tests`  | 19 | L1-L15 |  |
| `MMCA.ADC.Identity.Application.Tests`  | 45 | L0-L14 |  |
| `MMCA.ADC.Identity.Domain.Tests`  | 11 | L1-L9 |  |
| `MMCA.ADC.Identity.Infrastructure.Tests`  | 12 | L0-L13 |  |
| `MMCA.ADC.Identity.IntegrationTests`  | 57 | L0-L19 |  |
| `MMCA.ADC.Identity.Shared.Tests`  | 3 | L2-L4 |  |
| `MMCA.ADC.Identity.UI.Tests`  | 26 | L0-L8 |  |
| `MMCA.ADC.Notification.API.Tests`  | 1 | L4-L4 |  |
| `MMCA.ADC.Notification.Application.Tests`  | 4 | L2-L12 |  |
| `MMCA.ADC.Notification.IntegrationTests`  | 14 | L0-L18 |  |
| `MMCA.ADC.ServiceBusEmulator.IntegrationTests`  | 3 | L5-L7 |  |
| `MMCA.ADC.Services.Tests`  | 32 | L0-L13 |  |
| `MMCA.ADC.UI.Web.Tests`  | 11 | L14-L15 |  |
| `MMCA.Common.AI.Tests`  | 41 | L0-L4 |  |
| `MMCA.Common.API.Tests`  | 382 | L0-L15 |  |
| `MMCA.Common.Application.Tests`  | 535 | L0-L14 |  |
| `MMCA.Common.Architecture.Tests` **(infra)** | 524 | L0-L13 |  |
| `MMCA.Common.Aspire.Hosting.Tests`  | 16 | L0-L7 |  |
| `MMCA.Common.Aspire.Tests`  | 63 | L0-L6 |  |
| `MMCA.Common.Aws.LocalStack.Tests`  | 18 | L0-L10 |  |
| `MMCA.Common.Aws.Tests`  | 39 | L0-L8 |  |
| `MMCA.Common.Azure.ServiceBusEmulator.Tests`  | 9 | L3-L7 |  |
| `MMCA.Common.Azure.Startup.Tests`  | 8 | L0-L2 |  |
| `MMCA.Common.Azure.Tests`  | 34 | L0-L8 |  |
| `MMCA.Common.Benchmarks`  | 6 | L0-L7 |  |
| `MMCA.Common.Domain.Tests`  | 73 | L0-L8 |  |
| `MMCA.Common.Gateway.Tests`  | 20 | L0-L4 |  |
| `MMCA.Common.Gcp.Emulator.Tests`  | 7 | L0-L4 |  |
| `MMCA.Common.Gcp.Tests`  | 31 | L0-L8 |  |
| `MMCA.Common.Grpc.Tests`  | 29 | L0-L4 |  |
| `MMCA.Common.Infrastructure.PostgreSQL.Tests`  | 21 | L0-L16 |  |
| `MMCA.Common.Infrastructure.RabbitMq.Tests`  | 2 | L0-L8 |  |
| `MMCA.Common.Infrastructure.Redis.Tests`  | 4 | L0-L6 |  |
| `MMCA.Common.Infrastructure.SQLServer.Tests`  | 16 | L0-L16 |  |
| `MMCA.Common.Infrastructure.Tests`  | 760 | L0-L18 |  |
| `MMCA.Common.LoadTests`  | 14 | L0-L14 |  |
| `MMCA.Common.Mcp.Tests`  | 9 | L0-L8 |  |
| `MMCA.Common.Passkeys.Tests`  | 12 | L0-L12 |  |
| `MMCA.Common.ServiceHost.Tests`  | 9 | L0-L8 |  |
| `MMCA.Common.Shared.Tests`  | 73 | L0-L7 |  |
| `MMCA.Common.Testing` **(infra)** | 44 | L0-L11 |  |
| `MMCA.Common.Testing.Architecture` **(infra)** | 113 | L0-L8 |  |
| `MMCA.Common.Testing.Aspire`  | 16 | L0-L4 |  |
| `MMCA.Common.Testing.Aspire.AppHostTests`  | 6 | L3-L5 |  |
| `MMCA.Common.Testing.Aspire.AppHostTests.SampleService`  | 2 | L3-L10 |  |
| `MMCA.Common.Testing.Aspire.Tests`  | 15 | L1-L6 |  |
| `MMCA.Common.Testing.Azure`  | 2 | L3-L4 |  |
| `MMCA.Common.Testing.Azure.Tests`  | 6 | L3-L8 |  |
| `MMCA.Common.Testing.E2E` **(infra)** | 41 | L0-L4 |  |
| `MMCA.Common.Testing.E2E.Tests`  | 12 | L0-L5 |  |
| `MMCA.Common.Testing.Tests`  | 59 | L0-L12 |  |
| `MMCA.Common.Testing.UI` **(infra)** | 31 | L0-L5 |  |
| `MMCA.Common.Tests.Shared` **(infra)** | 22 | L0-L9 |  |
| `MMCA.Common.UI.E2E.Tests`  | 42 | L0-L13 |  |
| `MMCA.Common.UI.Gallery` **(infra)** | 15 | L0-L9 |  |
| `MMCA.Common.UI.Tests`  | 421 | L0-L9 |  |
| `MMCA.Common.UI.Web.Tests`  | 57 | L0-L7 |  |

