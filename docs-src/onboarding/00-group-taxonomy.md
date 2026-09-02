# Phase 1b - Functional Group Taxonomy

This is the **primary axis** of the guide. Every one of the **4,205** distinct first-party type
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
| G01 | **Result & Error Handling**<br/>group-01-result-error-handling.md | 16 | L0-L3 | The Result/Error railway that every operation returns instead of throwing; pagination result shapes. |
| G02 | **Domain Building Blocks (Entities, Value Objects, Aggregates)**<br/>group-02-domain-building-blocks.md | 36 | L0-L5 | The DDD primitives: entity/aggregate base classes, audit fields, value objects + invariants, domain markers, attributes, identifier aliases. |
| G03 | **Querying: Specifications, Filtering & the Entity Query Service**<br/>group-03-querying-specifications.md | 38 | L0-L8 | Composable read-side: the Specification pattern, dynamic filtering/sorting/paging, and the generic entity query pipeline. |
| G04 | **Domain & Integration Events + Outbox Dual-Dispatch**<br/>group-04-events-outbox.md | 36 | L0-L13 | Event contracts, the domain-event dispatcher, the transactional outbox/inbox, and the in-process + broker message buses. |
| G05 | **CQRS: Commands, Queries & the Decorator Pipeline**<br/>group-05-cqrs-pipeline.md | 57 | L0-L14 | The command/query handler abstraction and the cross-cutting decorator pipeline (logging, transaction, caching, feature-gate, idempotency) wrapping it. |
| G06 | **Validation**<br/>group-06-validation.md | 22 | L0-L9 | The FluentValidation-based validation contracts and failure mapping that gate commands before they execute. |
| G07 | **Persistence & EF Core**<br/>group-07-persistence-ef-core.md | 124 | L0-L14 | The single SQLServerDbContext over the abstract ApplicationDbContext, interceptors, repositories, specifications evaluation, data-source routing (database-per-service), conventions, value generators, encryption, factories and design-time. |
| G08 | **Authentication & Authorization**<br/>group-08-auth.md | 87 | L0-L10 | JWT/JWKS dual-fetch token validation, current-user/claims, password hashing, cookie sessions, and policy/authorization plumbing. |
| G09 | **Caching**<br/>group-09-caching.md | 8 | L0-L4 | The cache abstraction and its decorator-driven, invalidation-aware integration into the query pipeline. |
| G10 | **Notifications (Push + In-App Inbox + Email)**<br/>group-10-notifications.md | 57 | L0-L10 | The notification subsystem: push (SignalR), the in-app inbox, email sending, recipient providers, and the thin ADC Notification module host. |
| G11 | **Navigation Metadata & Populators (EF-decoupled eager loading)**<br/>group-11-navigation-populators.md | 12 | L0-L9 | INavigationMetadata/INavigationPopulator and the loader that hydrate cross-container/cross-source relationships without EF Include coupling ([ADR-002](https://ivanball.github.io/docs/adr/002-navigation-populators.html)). |
| G12 | **API Hosting, Middleware, Idempotency & DTO/Contract Mapping**<br/>group-12-api-hosting-mapping.md | 81 | L0-L16 | The ASP.NET Core edge: controller bases, middleware, startup, model binders, JSON converters, feature management, idempotency, correlation, and manual DTO/request mapping. |
| G13 | **gRPC & Inter-Service Contracts**<br/>group-13-grpc-contracts.md | 6 | L0-L4 | Typed gRPC clients/servers, interceptors, Result-over-the-wire, and the ServiceContract marker for synchronous inter-service calls ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)). |
| G14 | **Module System, Composition & Configuration**<br/>group-14-module-system-composition.md | 72 | L0-L14 | IModule discovery + Kahn-ordered ModuleLoader, the DI composition roots, assembly markers, data-source/database attributes, and options/settings binding. |
| G15 | **Common UI Framework (MudBlazor components, theme, base pages)**<br/>group-15-common-ui-framework.md | 117 | L0-L8 | Reusable Blazor building blocks: the data-grid list page base, theme, common pages/services, and UI extensions shared by every consumer app. |
| G16 | **Aspire Orchestration & Service Defaults**<br/>group-16-aspire-orchestration.md | 57 | L0-L10 | The Aspire AppHost wiring, ServiceDefaults, warmup, telemetry and security helpers that compose and run the distributed app locally and in Azure. |
| G17 | **ADC Conference - Domain Model & Module Contracts**<br/>group-17-conference-domain.md | 99 | L0-L10 | The Conference bounded context: Event/Session/Speaker/Category/Question aggregates, their domain events and invariants, plus the Shared identifiers/DTOs/integration-event contracts. |
| G18 | **ADC Conference - Application & Use Cases**<br/>group-18-conference-application.md | 303 | L0-L15 | Conference CQRS handlers, validators, DTOs, specifications, the Sessionize import, and the session-selection decision-support analytics. |
| G19 | **ADC Conference - Infrastructure & Persistence**<br/>group-19-conference-infrastructure.md | 33 | L0-L12 | The Conference module DbContext registration, EF entity configurations, database seeding, and infrastructure services. |
| G20 | **ADC Conference - API, gRPC Contracts & Service Host**<br/>group-20-conference-api-grpc.md | 44 | L0-L12 | Conference REST controllers, the .Contracts gRPC surface, the extractable service host, and the gRPC adapter. |
| G21 | **ADC Conference - UI**<br/>group-21-conference-ui.md | 146 | L0-L10 | The Conference Blazor pages (events, sessions, speakers, categories, questions, rooms, feedback, public, session-selection) and their UI services. |
| G22 | **ADC Engagement Module (Session Bookmarks)**<br/>group-22-engagement-module.md | 179 | L0-L13 | The Engagement bounded context end-to-end: bookmark aggregate, use cases, persistence, API/contracts/service, and feedback UI. |
| G26 | **ADC Engagement Live Layer (Real-Time Polls & Session Q&A)**<br/>group-23-engagement-live-layer.md | 99 | L0-L14 | Real-time audience interaction in the Engagement bounded context: event-wide live polls with voting and moderated per-session Q&A with upvoting, over the SignalR hub-channel transport ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)) and the cross-service gRPC live-channel adapter. |
| G23 | **ADC Identity Module (Users, Profiles, GDPR Export/Erasure)**<br/>group-24-identity-module.md | 90 | L0-L17 | The Identity bounded context end-to-end: the User aggregate, change-password/delete/export use cases, persistence, API/contracts/service, and profile/user UI. |
| G24 | **ADC Application Host, UI Shell & Cross-Module Composition**<br/>group-25-adc-host-composition.md | 17 | L0-L13 | The ADC host: the Blazor Web/WASM/WinUI shells, host pages/services, security, and the cross-module application composition. |
| G27 | **Device Capability Abstraction Layer (Native Contracts, MAUI, Browser & Fallback Adapters)**<br/>group-26-device-capability-layer.md | 99 | L0-L4 | Per-capability interface contracts (biometric, geocoding/geolocation, speech, push registration, media/clipboard/screenshot, haptics, share, external auth/links, local cache/notifications, connectivity/battery/accessibility, deep links) plus their MAUI-native, browser-JS-interop, and inert fallback implementations, selected per host at DI composition time ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)/043/044/045). |
| G25 | **Testing & Quality Infrastructure**<br/>group-27-testing-infrastructure.md | 2270 | L0-L19 | All test projects + the reusable Testing/Testing.E2E/Testing.UI bases, architecture-fitness tests, and the component Gallery harness; individual [Fact]s are rolled up by project (logged exception). |

**Reconciliation:** 1935 production types across 26 groups + 2270 test/testing types in G25 = **4205** (matches the inventory's distinct-node count). No type appears twice; none dropped.

---

## Group membership

### G01 - Result & Error Handling

> `group-01-result-error-handling.md` | 16 types | The Result/Error railway that every operation returns instead of throwing; pagination result shapes.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `CollectionResult<T>` | record | MMCA.Common.Shared.Abstractions |
| 0 | `DomainException` | class | MMCA.Common.Shared.Exceptions |
| 0 | `ErrorType` | enum | MMCA.Common.Shared.Abstractions |
| 0 | `KeysetCursor` | class | MMCA.Common.Shared.Abstractions |
| 0 | `KeysetPageRequest` | record | MMCA.Common.Shared.Abstractions |
| 0 | `PaginationMetadata` | record | MMCA.Common.Shared.Abstractions |
| 0 | `PropertyReader` | delegate | MMCA.Common.Shared.Serialization |
| 1 | `DomainInvariantViolationException` | class | MMCA.Common.Shared.Exceptions |
| 1 | `Error` | record | MMCA.Common.Shared.Abstractions |
| 1 | `KeysetCollectionResult<T>` | record | MMCA.Common.Shared.Abstractions |
| 1 | `PagedCollectionResult<T>` | record | MMCA.Common.Shared.Abstractions |
| 2 | `ErrorTypeSeverity` | class | MMCA.Common.Shared.Abstractions |
| 2 | `Result` | class | MMCA.Common.Shared.Abstractions |
| 2 | `ResultConverter` | class | MMCA.Common.Shared.Serialization |
| 2 | `ResultJsonConverterFactory` | class | MMCA.Common.Shared.Serialization |
| 3 | `ResultExtensions` | class | MMCA.Common.Shared.Abstractions |

### G02 - Domain Building Blocks (Entities, Value Objects, Aggregates)

> `group-02-domain-building-blocks.md` | 36 types | The DDD primitives: entity/aggregate base classes, audit fields, value objects + invariants, domain markers, attributes, identifier aliases.

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
| 0 | `ValueObject` | record | MMCA.Common.Shared.ValueObjects |
| 1 | `BaseEntity<TIdentifierType>` | class | MMCA.Common.Domain.Entities |
| 1 | `EntityTypeExtensions` | class | MMCA.Common.Domain.Extensions |
| 1 | `IAggregateRoot` | interface | MMCA.Common.Domain.Interfaces |
| 1 | `PiiRedactor` | class | MMCA.Common.Domain.Privacy |
| 3 | `Address` | record | MMCA.Common.Shared.ValueObjects |
| 3 | `AddressInvariants` | class | MMCA.Common.Shared.ValueObjects |
| 3 | `AuditableBaseEntity<TIdentifierType>` | class | MMCA.Common.Domain.Entities |
| 3 | `Currency` | record | MMCA.Common.Shared.ValueObjects |
| 3 | `CurrencyJsonConverter` | class | MMCA.Common.Shared.ValueObjects |
| 3 | `DateRange` | record | MMCA.Common.Shared.ValueObjects |
| 3 | `DateTimeRange` | record | MMCA.Common.Shared.ValueObjects |
| 3 | `EmailInvariants` | class | MMCA.Common.Shared.ValueObjects |
| 3 | `Enumeration<TEnumeration>` | class | MMCA.Common.Shared.ValueObjects |
| 3 | `EnumerationConverter<TEnumeration>` | class | MMCA.Common.Shared.ValueObjects |
| 3 | `EnumerationJsonConverterFactory` | class | MMCA.Common.Shared.ValueObjects |
| 3 | `IAnonymizable` | interface | MMCA.Common.Domain.Interfaces |
| 3 | `IReactivatable` | interface | MMCA.Common.Domain.Interfaces |
| 3 | `PhoneNumberInvariants` | class | MMCA.Common.Shared.ValueObjects |
| 4 | `AuditableAggregateRootEntity<TIdentifierType>` | class | MMCA.Common.Domain.Entities |
| 4 | `Email` | record | MMCA.Common.Shared.ValueObjects |
| 4 | `Money` | record | MMCA.Common.Shared.ValueObjects |
| 4 | `PhoneNumber` | record | MMCA.Common.Shared.ValueObjects |
| 5 | `CommonInvariants` | class | MMCA.Common.Domain.Invariants |

### G03 - Querying: Specifications, Filtering & the Entity Query Service

> `group-03-querying-specifications.md` | 38 types | Composable read-side: the Specification pattern, dynamic filtering/sorting/paging, and the generic entity query pipeline.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `BestEffortLog` | class | MMCA.Common.Application.Services |
| 0 | `BestEffortMetrics` | class | MMCA.Common.Application.Services |
| 0 | `DynamicQueryConfig` | class | MMCA.Common.Application.Services.Filtering |
| 0 | `EntityQueryParameters<TEntity>` | record | MMCA.Common.Application.Services.Query |
| 0 | `FilterValueParser` | class | MMCA.Common.Application.Services.Filtering |
| 0 | `IFilterStrategy` | interface | MMCA.Common.Application.Services.Filtering |
| 0 | `OrderExpression` | record | MMCA.Common.Domain.Specifications |
| 0 | `PagingMath` | class | MMCA.Common.Application.Services.Query |
| 0 | `ParameterReplacer` | class | MMCA.Common.Domain.Specifications |
| 0 | `PropertyAccessor` | record struct | MMCA.Common.Application.Services |
| 1 | `BestEffort` | class | MMCA.Common.Application.Services |
| 1 | `BoolFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 1 | `DateTimeFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 1 | `DecimalFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 1 | `GuidFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 1 | `IntFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 1 | `ISpecification<TEntity, TIdentifierType>` | interface | MMCA.Common.Domain.Interfaces |
| 1 | `LongFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 1 | `StringFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 2 | `Specification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 2 | `SpecificationComposer` | class | MMCA.Common.Domain.Specifications |
| 3 | `AndSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 3 | `EventUpcasterRegistry` | class | MMCA.Common.Application.Services |
| 3 | `InlineSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 3 | `NotSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 3 | `OrSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 3 | `QueryFieldService` | class | MMCA.Common.Application.Services |
| 3 | `QueryFilterService` | class | MMCA.Common.Application.Services.Filtering |
| 3 | `QuerySpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 4 | `IEntityQueryPipeline` | interface | MMCA.Common.Application.Services.Query |
| 4 | `INavigationMetadataProvider` | interface | MMCA.Common.Application.Services.Query |
| 4 | `OwnedByUserSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 4 | `SpecificationExtensions` | class | MMCA.Common.Domain.Specifications |
| 5 | `EntityQueryPipeline` | class | MMCA.Common.Application.Services.Query |
| 5 | `IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces |
| 5 | `NavigationMetadataProvider` | class | MMCA.Common.Application.Services.Query |
| 8 | `CrossSourceSpecification` | class | MMCA.Common.Application.Specifications |
| 8 | `EntityQueryService<TEntity, TEntityDTO, TIdentifierType>` | class | MMCA.Common.Application.Services |

### G04 - Domain & Integration Events + Outbox Dual-Dispatch

> `group-04-events-outbox.md` | 36 types | Event contracts, the domain-event dispatcher, the transactional outbox/inbox, and the in-process + broker message buses.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `IDomainEvent` | interface | MMCA.Common.Domain.Interfaces |
| 0 | `IInboxStore` | interface | MMCA.Common.Infrastructure.Persistence.Inbox |
| 0 | `InboxDisabledWarningService` | class | MMCA.Common.Infrastructure.Persistence.Inbox |
| 0 | `InboxMessage` | class | MMCA.Common.Infrastructure.Persistence.Inbox |
| 0 | `IOutboxSignal` | interface | MMCA.Common.Infrastructure.Persistence.Outbox |
| 0 | `OutboxCycleResult` | record struct | MMCA.Common.Infrastructure.Persistence.Outbox |
| 0 | `OutboxDisabledNoticeService` | class | MMCA.Common.Infrastructure.Persistence.Outbox |
| 0 | `OutboxMetrics` | class | MMCA.Common.Infrastructure.Persistence.Outbox |
| 1 | `BaseDomainEvent` | record | MMCA.Common.Domain.DomainEvents |
| 1 | `EventNameResolver` | class | MMCA.Common.Infrastructure.Persistence.Outbox |
| 1 | `IDomainEventDispatcher` | interface | MMCA.Common.Application.Interfaces |
| 1 | `IDomainEventHandler<in TDomainEvent>` | interface | MMCA.Common.Application.Interfaces |
| 1 | `IIntegrationEvent` | interface | MMCA.Common.Domain.Interfaces |
| 1 | `NoOpInboxStore` | class | MMCA.Common.Infrastructure.Persistence.Inbox |
| 1 | `OutboxSignal` | class | MMCA.Common.Infrastructure.Persistence.Outbox |
| 2 | `BaseIntegrationEvent` | record | MMCA.Common.Domain.DomainEvents |
| 2 | `EntityChangedEvent<TIdentifierType>` | record | MMCA.Common.Domain.DomainEvents |
| 2 | `IEventBus` | interface | MMCA.Common.Application.Interfaces |
| 2 | `IIntegrationEventHandler<in TIntegrationEvent>` | interface | MMCA.Common.Application.Interfaces |
| 2 | `IMessageBus` | interface | MMCA.Common.Application.Messaging |
| 2 | `SafeDomainEventHandler<TDomainEvent>` | class | MMCA.Common.Application.DomainEvents |
| 3 | `BrokerMessageBus` | class | MMCA.Common.Infrastructure.Services |
| 3 | `DomainEventDispatcher` | class | MMCA.Common.Application.Services |
| 3 | `InProcessMessageBus` | class | MMCA.Common.Infrastructure.Services |
| 3 | `IntegrationEventConsumer<TEvent>` | class | MMCA.Common.Infrastructure.Services |
| 3 | `OutputCacheEvictionRequested` | record | MMCA.Common.Domain.IntegrationEvents |
| 3 | `ScopedIntegrationEventHandlerBase<TIntegrationEvent>` | class | MMCA.Common.Application.DomainEvents |
| 4 | `IntegrationEventConsumerExtensions` | class | MMCA.Common.Infrastructure.Services |
| 9 | `OutboxMessage` | class | MMCA.Common.Infrastructure.Persistence.Outbox |
| 11 | `OutboxFinalizer` | class | MMCA.Common.Infrastructure.Persistence.Outbox |
| 13 | `BrokerEventBus` | class | MMCA.Common.Infrastructure.Services |
| 13 | `EfInboxStore` | class | MMCA.Common.Infrastructure.Persistence.Inbox |
| 13 | `InProcessEventBus` | class | MMCA.Common.Infrastructure.Services |
| 13 | `OutboxAdministration` | class | MMCA.Common.Infrastructure.Persistence.Outbox |
| 13 | `OutboxCleanupService` | class | MMCA.Common.Infrastructure.Persistence.Outbox |
| 13 | `OutboxProcessor` | class | MMCA.Common.Infrastructure.Persistence.Outbox |

### G05 - CQRS: Commands, Queries & the Decorator Pipeline

> `group-05-cqrs-pipeline.md` | 57 types | The command/query handler abstraction and the cross-cutting decorator pipeline (logging, transaction, caching, feature-gate, idempotency) wrapping it.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `CqrsContractMismatchKind` | enum | MMCA.Common.Application.UseCases |
| 0 | `CqrsMetrics` | class | MMCA.Common.Application.UseCases.Decorators |
| 0 | `ICacheInvalidating` | interface | MMCA.Common.Application.UseCases |
| 0 | `ICommand<TResult>` | interface | MMCA.Common.Application.UseCases |
| 0 | `ICommandHandler<in TCommand, TResult>` | interface | MMCA.Common.Application.UseCases |
| 0 | `ICommandWithRequest<out TRequest>` | interface | MMCA.Common.Application.UseCases |
| 0 | `ICreateRequest` | interface | MMCA.Common.Application.Interfaces |
| 0 | `IDistributedLock` | interface | MMCA.Common.Application.Interfaces |
| 0 | `IFeatureGated` | interface | MMCA.Common.Application.UseCases |
| 0 | `IHasTimeout` | interface | MMCA.Common.Application.UseCases |
| 0 | `IQuery<TResult>` | interface | MMCA.Common.Application.UseCases |
| 0 | `IQueryCacheable` | interface | MMCA.Common.Application.UseCases |
| 0 | `IQueryHandler<in TQuery, TResult>` | interface | MMCA.Common.Application.UseCases |
| 0 | `IRequiresPermission` | interface | MMCA.Common.Application.UseCases |
| 0 | `IScheduledJob` | interface | MMCA.Common.Application.Interfaces |
| 0 | `ITenantContext` | interface | MMCA.Common.Application.Interfaces |
| 0 | `ITransactional` | interface | MMCA.Common.Application.UseCases |
| 0 | `MutationContext` | class | MMCA.Common.Application.UseCases |
| 1 | `CqrsContractMismatch` | record | MMCA.Common.Application.UseCases |
| 1 | `DeleteEntityCommand<TEntity, TIdentifierType>` | record | MMCA.Common.Application.UseCases |
| 1 | `IAuditTrailReader` | interface | MMCA.Common.Application.Interfaces |
| 1 | `ProfilingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 1 | `ProfilingQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 1 | `TenantCacheKey` | class | MMCA.Common.Application.UseCases.Decorators |
| 2 | `CacheKeyLocks` | class | MMCA.Common.Application.Interfaces |
| 2 | `CqrsContractInspector` | class | MMCA.Common.Application.UseCases |
| 2 | `IEventUpcaster` | interface | MMCA.Common.Application.Interfaces |
| 2 | `IEventUpcasterRegistry` | interface | MMCA.Common.Application.Interfaces |
| 2 | `QueryCacheKeyLocks` | class | MMCA.Common.Application.UseCases.Decorators |
| 3 | `LoggingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 3 | `LoggingQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 3 | `ResultFailureFactory` | class | MMCA.Common.Application.UseCases.Decorators |
| 4 | `CachingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 4 | `CachingQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 4 | `FeatureGateCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 4 | `FeatureGateQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 4 | `IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces |
| 4 | `IEntityUpdateApplier<TEntity, TUpdateRequest, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces |
| 4 | `TimeoutCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 4 | `TimeoutQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 4 | `ValidatingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 4 | `ValidatingQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 5 | `UpdateEntityCommand<TEntity, TUpdateRequest, TIdentifierType>` | record | MMCA.Common.Application.UseCases |
| 6 | `IEntityUpdateCommandApplier<TEntity, TUpdateRequest, TIdentifierType, in TCommand>` | interface | MMCA.Common.Application.UseCases |
| 8 | `AddChildEntityHandlerBase<TCommand, TParent, TIdentifierType, TChild, TChildDTO>` | class | MMCA.Common.Application.UseCases |
| 8 | `CreateEntityHandlerBase<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>` | class | MMCA.Common.Application.UseCases |
| 8 | `DeleteEntityHandler<TEntity, TIdentifierType>` | class | MMCA.Common.Application.UseCases |
| 8 | `MutateEntityHandlerCore<TCommand, TEntity, TIdentifierType>` | class | MMCA.Common.Application.UseCases |
| 8 | `TransactionalCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 9 | `AuthorizationCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 9 | `AuthorizationQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 9 | `CreateEntityHandler<TCreateRequest, TEntity, TIdentifierType, TEntityDTO>` | class | MMCA.Common.Application.UseCases |
| 9 | `MutateEntityHandlerBase<TCommand, TEntity, TIdentifierType>` | class | MMCA.Common.Application.UseCases |
| 10 | `RemoveChildEntityHandlerBase<TCommand, TParent, TIdentifierType>` | class | MMCA.Common.Application.UseCases |
| 10 | `UpdateEntityCommandHandler<TCommand, TEntity, TEntityDTO, TIdentifierType, TUpdateRequest>` | class | MMCA.Common.Application.UseCases |
| 10 | `UpdateEntityHandler<TEntity, TEntityDTO, TIdentifierType, TUpdateRequest>` | class | MMCA.Common.Application.UseCases |
| 14 | `MutateEntityPayloadHandlerBase<TCommand, TEntity, TIdentifierType, TResultPayload>` | class | MMCA.Common.Application.UseCases |

### G06 - Validation

> `group-06-validation.md` | 22 types | The FluentValidation-based validation contracts and failure mapping that gate commands before they execute.

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
| 0 | `StrongPasswordRules<T>` | class | MMCA.Common.Application.Validation |
| 1 | `CommandRequestValidator<TCommand, TRequest>` | class | MMCA.Common.Application.Validation |
| 2 | `ValidationFailureExtensions` | class | MMCA.Common.Application.Extensions |
| 4 | `AddressLine1Rules<T>` | class | MMCA.Common.Application.Validation |
| 4 | `AddressLine2Rules<T>` | class | MMCA.Common.Application.Validation |
| 4 | `CityRules<T>` | class | MMCA.Common.Application.Validation |
| 4 | `CountryRules<T>` | class | MMCA.Common.Application.Validation |
| 4 | `StateRules<T>` | class | MMCA.Common.Application.Validation |
| 4 | `ZipCodeRules<T>` | class | MMCA.Common.Application.Validation |
| 5 | `AddressValidator` | class | MMCA.Common.Application.Validation |
| 6 | `AbsoluteUrlRules<T>` | class | MMCA.Common.Application.Validation |
| 9 | `CurrentUserServiceExtensions` | class | MMCA.Common.Application.Extensions |

### G07 - Persistence & EF Core

> `group-07-persistence-ef-core.md` | 124 types | The single SQLServerDbContext over the abstract ApplicationDbContext, interceptors, repositories, specifications evaluation, data-source routing (database-per-service), conventions, value generators, encryption, factories and design-time.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AuditTrailEntry` | class | MMCA.Common.Infrastructure.Persistence.AuditTrail |
| 0 | `CaptureContext` | record struct | MMCA.Common.Infrastructure.Persistence.AuditTrail |
| 0 | `CosmosIntIdValueGenerator` | class | MMCA.Common.Infrastructure.Persistence.ValueGenerators |
| 0 | `CrossTenantWriteException` | class | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 0 | `DataSource` | enum | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `DefaultSeed` | record | MMCA.Common.Infrastructure.Persistence.DataSources |
| 0 | `DetectChangesScope` | struct | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 0 | `EncryptedStringConverter` | class | MMCA.Common.Infrastructure.Persistence.Encryption |
| 0 | `EntityConfigurationOptions` | class | MMCA.Common.Infrastructure.Persistence |
| 0 | `GroupedCount<TKey>` | record | MMCA.Common.Infrastructure.Persistence.Repositories |
| 0 | `GroupedSum<TKey>` | record | MMCA.Common.Infrastructure.Persistence.Repositories |
| 0 | `IDbSeeder` | interface | MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding |
| 0 | `IdentityInsertGroup` | record | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 0 | `IEntityConfigurationAssemblyProvider` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `ImageContentSniffer` | class | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `INativePushSender` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `IQueryableExecutor` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `IUniqueConstraintViolationDetector` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `IUpdatePropertySetter<TEntity>` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `ModelBuilderExtensions` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 0 | `NativePushPayloads` | class | MMCA.Common.Infrastructure.Services |
| 0 | `OutboxDeadLetter` | record | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `PeriodicBackgroundService` | class | MMCA.Common.Infrastructure.Services |
| 0 | `ProfilingHelper` | class | MMCA.Common.Infrastructure.Persistence |
| 0 | `SeedAccount` | record | MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding |
| 0 | `TransactionCommitAmbiguousException` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 0 | `ValReturn<T>` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 1 | `AzureNotificationHubNativePushSender` | class | MMCA.Common.Infrastructure.Services |
| 1 | `DataSourceKey` | record struct | MMCA.Common.Application.Interfaces.Infrastructure |
| 1 | `DbSeeder` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding |
| 1 | `DefaultEntityConfigurationAssemblyProvider` | class | MMCA.Common.Infrastructure.Persistence |
| 1 | `DesignTimeDbContextOptions` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Design |
| 1 | `EFQueryableExecutor` | class | MMCA.Common.Infrastructure.Persistence |
| 1 | `ExplicitAssemblyProvider` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Design |
| 1 | `NamespaceConventions` | class | MMCA.Common.Infrastructure.Persistence |
| 1 | `NullNativePushSender` | class | MMCA.Common.Infrastructure.Services |
| 1 | `PendingEntityKey` | record | MMCA.Common.Infrastructure.Persistence.AuditTrail |
| 1 | `SoftDeleteFilterSql` | class | MMCA.Common.Infrastructure.Persistence |
| 1 | `SqlServerUniqueConstraintViolationDetector` | class | MMCA.Common.Infrastructure.Persistence |
| 1 | `TenantContext` | class | MMCA.Common.Infrastructure.Services |
| 1 | `UpdatePropertySetterBuilder<TEntity>` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 2 | `AggregateCapture` | record | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 2 | `FaultIntegrationEventConsumer<TEvent>` | class | MMCA.Common.Infrastructure.Services |
| 2 | `IDataSourceService` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 2 | `IEntityDataSourceRegistry` | interface | MMCA.Common.Infrastructure.Persistence.DataSources |
| 2 | `IndexBuilderExtensions` | class | MMCA.Common.Infrastructure.Persistence.Configuration |
| 2 | `NullDomainEventDispatcher` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Design |
| 2 | `PhysicalDataSource` | record | MMCA.Common.Infrastructure.Persistence.DataSources |
| 2 | `Snapshot` | record | MMCA.Common.Infrastructure.Persistence.DataSources |
| 2 | `SoftDeleteUniqueIndexConvention` | class | MMCA.Common.Infrastructure.Persistence.Conventions |
| 2 | `TenantDataSourceTarget` | record struct | MMCA.Common.Infrastructure.Persistence.DataSources |
| 3 | `CrossDataSourceDegradeConvention` | class | MMCA.Common.Infrastructure.Persistence.Conventions |
| 3 | `DataSourceService` | class | MMCA.Common.Infrastructure.Services |
| 3 | `EventUpcasterStartupValidator` | class | MMCA.Common.Infrastructure.Services |
| 3 | `IDataSourceResolver` | interface | MMCA.Common.Infrastructure.Persistence.DataSources |
| 3 | `IFileStorageService` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 3 | `IImageProcessor` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 3 | `IOutboxAdministration` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 3 | `IPushDeviceRegistrar` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 3 | `UpcastingIntegrationEventConsumer<TEvent>` | class | MMCA.Common.Infrastructure.Services |
| 4 | `AzureBlobFileStorageService` | class | MMCA.Common.Infrastructure.Services |
| 4 | `AzureNotificationHubDeviceRegistrar` | class | MMCA.Common.Infrastructure.Services |
| 4 | `DataSourceResolver` | class | MMCA.Common.Infrastructure.Persistence.DataSources |
| 4 | `EnumerationValueConverter<TEnumeration>` | class | MMCA.Common.Infrastructure.Persistence.Conversions |
| 4 | `IEntityQuerier<TEntity, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 4 | `IEntityReader<TEntity, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 4 | `IEntityTypeConfigurationBase<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 4 | `ImageSharpImageProcessor` | class | MMCA.Common.Infrastructure.Services |
| 4 | `NullableEnumerationValueConverter<TEnumeration>` | class | MMCA.Common.Infrastructure.Persistence.Conversions |
| 4 | `NullFileStorageService` | class | MMCA.Common.Infrastructure.Services |
| 4 | `NullPushDeviceRegistrar` | class | MMCA.Common.Infrastructure.Services |
| 4 | `RefreshSessionModelBuilderExtensions` | class | MMCA.Common.Infrastructure.Persistence.Auth |
| 4 | `SpecificationEvaluator` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 5 | `EmailValueConverter` | class | MMCA.Common.Infrastructure.Persistence.Conversions |
| 5 | `EntityDataSourceRegistry` | class | MMCA.Common.Infrastructure.Persistence.DataSources |
| 5 | `EntityTypeBuilderExtensions` | class | MMCA.Common.Infrastructure.Persistence.Configuration |
| 5 | `EntityTypeConfigurationBase<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 5 | `IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 5 | `IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 5 | `IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 5 | `IReadRepository<TEntity, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 5 | `IWriteRepository<TEntity, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 5 | `KeysetQueryBuilder` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 5 | `NullableEmailValueConverter` | class | MMCA.Common.Infrastructure.Persistence.Conversions |
| 5 | `NullablePhoneNumberValueConverter` | class | MMCA.Common.Infrastructure.Persistence.Conversions |
| 5 | `PhoneNumberValueConverter` | class | MMCA.Common.Infrastructure.Persistence.Conversions |
| 5 | `TenantDataSourceTargets` | class | MMCA.Common.Infrastructure.Persistence.DataSources |
| 6 | `EFReadRepository<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 6 | `EFReadRepositoryDecorator<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 6 | `EntityTypeConfiguration<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 6 | `IRepository<TEntity, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 6 | `ReadRepositoryExtensions` | class | MMCA.Common.Application.Extensions |
| 7 | `EFRepositoryDecorator<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 7 | `EntityTypeConfigurationCosmos<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 7 | `EntityTypeConfigurationSqlite<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 7 | `EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 7 | `IRepositoryFactory` | interface | MMCA.Common.Infrastructure.Persistence.Repositories.Factory |
| 7 | `IUnitOfWork` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 8 | `PushNotificationConfiguration` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration.Notifications |
| 8 | `UserNotificationConfiguration` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration.Notifications |
| 9 | `EFRepository<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 10 | `CapturedState` | record | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 10 | `RepositoryFactory` | class | MMCA.Common.Infrastructure.Persistence.Repositories.Factory |
| 11 | `ApplicationDbContext` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 11 | `AuditSaveChangesInterceptor` | class | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 11 | `AuditTrailSaveChangesInterceptor` | class | MMCA.Common.Infrastructure.Persistence.AuditTrail |
| 11 | `DataSourceModelCacheKeyFactory` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 11 | `DeferredDispatch` | record | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 11 | `DomainEventSaveChangesInterceptor` | class | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 11 | `TenantSaveChangesInterceptor` | class | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 12 | `CosmosDbContext` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 12 | `IDbContextFactory` | interface | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 12 | `IPhysicalDbContextFactory` | interface | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 12 | `SqliteDbContext` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 12 | `SQLServerDbContext` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 13 | `AuditTrailCleanupJob` | class | MMCA.Common.Infrastructure.Persistence.AuditTrail |
| 13 | `AuditTrailReader` | class | MMCA.Common.Infrastructure.Persistence.AuditTrail |
| 13 | `DbContextFactory` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 13 | `DesignTimeDbContextHelper` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Design |
| 13 | `EFRefreshSessionStore` | class | MMCA.Common.Infrastructure.Persistence.Auth |
| 13 | `PhysicalDbContextFactory` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 13 | `RefreshSessionCleanupService` | class | MMCA.Common.Infrastructure.Persistence.Auth |
| 13 | `UnitOfWork` | class | MMCA.Common.Infrastructure.Persistence |
| 14 | `IdentityModuleDbSeederBase<TUser>` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding |

### G08 - Authentication & Authorization

> `group-08-auth.md` | 87 types | JWT/JWKS dual-fetch token validation, current-user/claims, password hashing, cookie sessions, and policy/authorization plumbing.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AllowMissingOwnerAttribute` | class | MMCA.Common.API.Authorization |
| 0 | `AuthClaimTypes` | class | MMCA.Common.Shared.Auth |
| 0 | `AuthenticationRequest` | record struct | MMCA.Common.Shared |
| 0 | `AuthenticationResponse` | record struct | MMCA.Common.Shared.Auth |
| 0 | `ChangePasswordRequest` | record struct | MMCA.Common.Shared.Auth |
| 0 | `ChangePreferencesRequest` | record | MMCA.Common.Shared.Auth |
| 0 | `ConcurrencyETag` | class | MMCA.Common.Shared.Http |
| 0 | `ForgotPasswordRequest` | record struct | MMCA.Common.Shared.Auth |
| 0 | `IAuthUser` | interface | MMCA.Common.Domain.Auth |
| 0 | `IcsEvent` | record | MMCA.Common.Shared.Calendars |
| 0 | `IdempotencyHeaders` | class | MMCA.Common.Shared.Http |
| 0 | `IJwksProvider` | interface | MMCA.Common.Infrastructure.Auth |
| 0 | `IPasswordHasher` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `IPermissionRegistry` | interface | MMCA.Common.Shared.Auth |
| 0 | `ISoftDeletedUserValidator` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `IssuedSession` | record | MMCA.Common.Application.Auth |
| 0 | `ITokenService` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `LoginProtectionSettings` | class | MMCA.Common.Infrastructure.Auth |
| 0 | `LoginRequest` | record struct | MMCA.Common.Shared.Auth |
| 0 | `ModuleNameConventions` | class | MMCA.Common.Shared.Conventions |
| 0 | `OAuthCodeExchangeRequest` | record struct | MMCA.Common.Shared.Auth |
| 0 | `OwnerOrAdminFilterOptions` | class | MMCA.Common.API.Authorization |
| 0 | `PasswordResetEntry` | record | MMCA.Common.Infrastructure.Auth |
| 0 | `PasswordResetSettings` | class | MMCA.Common.Application.Auth |
| 0 | `PermissionPolicy` | class | MMCA.Common.API.Authorization |
| 0 | `PermissionRequirement` | class | MMCA.Common.API.Authorization |
| 0 | `PrivacyFeatures` | class | MMCA.Common.Shared.Privacy |
| 0 | `RefreshSessionSettings` | class | MMCA.Common.Application.Auth |
| 0 | `RefreshSessionSummaryResponse` | record | MMCA.Common.Shared.Auth |
| 0 | `RefreshTokenRequest` | record struct | MMCA.Common.Shared.Auth |
| 0 | `Releaser` | record struct | MMCA.Common.Shared.Concurrency |
| 0 | `ResetPasswordRequest` | record struct | MMCA.Common.Shared.Auth |
| 0 | `RoleNames` | class | MMCA.Common.Shared.Auth |
| 0 | `SessionCookieRequest` | record | MMCA.Common.API.SessionCookies |
| 0 | `SessionTokenResponse` | record | MMCA.Common.API.SessionCookies |
| 0 | `SessionTokenResult` | record struct | MMCA.Common.API.SessionCookies |
| 0 | `UserDataExportSectionDTO` | record | MMCA.Common.Shared.Privacy |
| 0 | `UserPreferencesResponse` | record | MMCA.Common.Shared.Auth |
| 1 | `ClaimsPrincipalExtensions` | class | MMCA.Common.Shared.Auth |
| 1 | `ForgotPasswordRequestValidator` | class | MMCA.Common.Application.Auth.Validation |
| 1 | `HasPermissionAttribute` | class | MMCA.Common.API.Authorization |
| 1 | `ICookieSessionRefresher` | interface | MMCA.Common.API.SessionCookies |
| 1 | `IcsCalendarBuilder` | class | MMCA.Common.Shared.Calendars |
| 1 | `KeyedSemaphoreStripe` | class | MMCA.Common.Shared.Concurrency |
| 1 | `LoginRequestValidator` | class | MMCA.Common.Application.Auth.Validation |
| 1 | `PasswordHasher` | class | MMCA.Common.Infrastructure.Services |
| 1 | `PermissionAuthorizationHandler` | class | MMCA.Common.API.Authorization |
| 1 | `PermissionPolicyProvider` | class | MMCA.Common.API.Authorization |
| 1 | `PermissionRegistry` | class | MMCA.Common.Shared.Auth |
| 1 | `RefreshTokenRequestValidator` | class | MMCA.Common.Application.Auth.Validation |
| 1 | `ResetPasswordRequestValidator` | class | MMCA.Common.Application.Auth.Validation |
| 1 | `RsaJwksProvider` | class | MMCA.Common.Infrastructure.Auth |
| 1 | `SessionStampingTokenService` | class | MMCA.Common.Application.Auth |
| 1 | `UnconfiguredPermissionRegistry` | class | MMCA.Common.Application.Auth |
| 1 | `UserDataExportDTO` | record | MMCA.Common.Shared.Privacy |
| 2 | `CookieSessionRefreshMiddleware` | class | MMCA.Common.API.SessionCookies |
| 2 | `PermissionRegistryBuilder` | class | MMCA.Common.Shared.Auth |
| 2 | `SessionCookieEndpoints` | class | MMCA.Common.API.SessionCookies |
| 2 | `SessionCookieJar` | class | MMCA.Common.API.SessionCookies |
| 2 | `TokenService` | class | MMCA.Common.Infrastructure.Services |
| 3 | `AuthorizationExtensions` | class | MMCA.Common.API.Authorization |
| 3 | `CookieSessionRefreshMiddlewareExtensions` | class | MMCA.Common.API.SessionCookies |
| 3 | `CookieTokenReader` | class | MMCA.Common.API.SessionCookies |
| 3 | `ILoginProtectionService` | interface | MMCA.Common.Application.Auth |
| 3 | `IPasswordChangeableUser` | interface | MMCA.Common.Domain.Auth |
| 3 | `IPasswordResetTokenService` | interface | MMCA.Common.Application.Auth |
| 3 | `IUserPreferences` | interface | MMCA.Common.Domain.Auth |
| 3 | `ProblemDetailsResultReader` | class | MMCA.Common.Shared.Http |
| 3 | `RefreshSession` | class | MMCA.Common.Domain.Auth |
| 3 | `RoleValue` | class | MMCA.Common.Shared.Auth |
| 4 | `CookieSessionRefresher` | class | MMCA.Common.API.SessionCookies |
| 4 | `IErasableUser` | interface | MMCA.Common.Domain.Auth |
| 4 | `IRefreshSessionStore` | interface | MMCA.Common.Application.Auth |
| 4 | `RegisterRequest` | record struct | MMCA.Common.Shared.Auth |
| 4 | `SessionCookieAuthenticationHandler` | class | MMCA.Common.API.SessionCookies |
| 4 | `SoftDeletedUserCache` | class | MMCA.Common.Application.Auth |
| 5 | `AuthenticationValidators` | class | MMCA.Common.Application.Auth |
| 5 | `IAuthenticationService` | interface | MMCA.Common.Application.Auth |
| 5 | `LoginProtectionService` | class | MMCA.Common.Infrastructure.Auth |
| 5 | `PasswordResetTokenService` | class | MMCA.Common.Infrastructure.Auth |
| 5 | `SessionCookieAuthenticationExtensions` | class | MMCA.Common.API.SessionCookies |
| 8 | `AuthenticationServiceBase<TUser>` | class | MMCA.Common.Application.Auth |
| 8 | `ClaimBasedUserIdProvider` | class | MMCA.Common.Infrastructure.Services |
| 8 | `ICurrentUserService` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 9 | `CurrentUserService` | class | MMCA.Common.Infrastructure.Services |
| 9 | `OwnershipHelper` | class | MMCA.Common.API.Authorization |
| 10 | `OwnerOrAdminFilter` | class | MMCA.Common.API.Authorization |

### G09 - Caching

> `group-09-caching.md` | 8 types | The cache abstraction and its decorator-driven, invalidation-aware integration into the query pipeline.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `CacheKeyPrefixOptions` | class | MMCA.Common.Infrastructure.Caching |
| 0 | `CacheOptions` | class | MMCA.Common.Infrastructure.Caching |
| 0 | `RedisPrefixScanner` | class | MMCA.Common.Infrastructure.Caching |
| 1 | `CacheKeyNamespace` | class | MMCA.Common.Infrastructure.Caching |
| 3 | `ICacheService` | interface | MMCA.Common.Application.Interfaces |
| 4 | `DistributedCacheService` | class | MMCA.Common.Infrastructure.Caching |
| 4 | `HybridCacheService` | class | MMCA.Common.Infrastructure.Caching |
| 4 | `MemoryCacheService` | class | MMCA.Common.Infrastructure.Caching |

### G10 - Notifications (Push + In-App Inbox + Email)

> `group-10-notifications.md` | 57 types | The notification subsystem: push (SignalR), the in-app inbox, email sending, recipient providers, and the thin ADC Notification module host.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `DeviceInstallationRequest` | record | MMCA.Common.Shared.Notifications.PushNotifications |
| 0 | `GetMyNotificationsQuery` | record | MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetInbox |
| 0 | `GetNotificationHistoryQuery` | record | MMCA.Common.Application.Notifications.PushNotifications.UseCases.GetHistory |
| 0 | `GetUnreadNotificationCountQuery` | record | MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetUnreadCount |
| 0 | `IEmailSender` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `ILiveChannelPublisher` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `INotificationRecipientProvider` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `IPushNotificationSender` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `MarkAllNotificationsReadCommand` | record | MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkAllRead |
| 0 | `MarkNotificationReadCommand` | record | MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkRead |
| 0 | `NotificationFeatures` | class | MMCA.Common.Shared.Notifications |
| 0 | `NotificationPermissions` | class | MMCA.Common.Shared.Notifications |
| 0 | `NotificationScopeKey` | class | MMCA.Common.Shared.Notifications |
| 0 | `PushNotificationStatus` | enum | MMCA.Common.Domain.Notifications.PushNotifications |
| 0 | `SendPushNotificationRequest` | record | MMCA.Common.Shared.Notifications.PushNotifications |
| 0 | `UserNotificationDTO` | record | MMCA.Common.Shared.Notifications.UserNotifications |
| 0 | `UserNotificationExportItemDTO` | record | MMCA.ADC.Notification.Shared.UserNotifications |
| 1 | `AttendeeNotificationRecipientProvider` | class | MMCA.ADC.Notification.Application |
| 1 | `DependencyInjection` | class | MMCA.ADC.Notification.API |
| 1 | `IUserNotificationExportService` | interface | MMCA.ADC.Notification.Shared.UserNotifications |
| 1 | `LiveChannelGrpcService` | class | MMCA.ADC.Notification.Service.Grpc |
| 1 | `LiveChannelPublisherGrpcAdapter` | class | MMCA.ADC.Notification.Contracts |
| 1 | `NullLiveChannelPublisher` | class | MMCA.Common.Infrastructure.Services |
| 1 | `NullNotificationRecipientProvider` | class | MMCA.Common.Application.Interfaces.Infrastructure |
| 1 | `NullPushNotificationSender` | class | MMCA.Common.Infrastructure.Services |
| 1 | `PushNotificationDTO` | record | MMCA.Common.Shared.Notifications.PushNotifications |
| 1 | `SendPushNotificationCommand` | record | MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send |
| 1 | `SmtpEmailSender` | class | MMCA.Common.Infrastructure.Services |
| 2 | `DisabledUserNotificationExportService` | class | MMCA.ADC.Notification.Shared.UserNotifications |
| 2 | `NotificationHub` | class | MMCA.Common.Infrastructure.Hubs |
| 2 | `PushNotificationCreated` | record | MMCA.Common.Domain.Notifications.PushNotifications.DomainEvents |
| 3 | `NotificationModule` | class | MMCA.ADC.Notification.API |
| 3 | `SignalRLiveChannelPublisher` | class | MMCA.Common.Infrastructure.Services |
| 3 | `SignalRPushNotificationSender` | class | MMCA.Common.Infrastructure.Services |
| 5 | `UserNotification` | class | MMCA.Common.Domain.Notifications.UserNotifications |
| 6 | `PushNotificationInvariants` | class | MMCA.Common.Domain.Notifications.PushNotifications.Invariants |
| 7 | `PushNotification` | class | MMCA.Common.Domain.Notifications.PushNotifications |
| 8 | `GetMyNotificationsHandler` | class | MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetInbox |
| 8 | `GetUnreadNotificationCountHandler` | class | MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetUnreadCount |
| 8 | `MarkAllNotificationsReadHandler` | class | MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkAllRead |
| 8 | `MarkNotificationReadHandler` | class | MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkRead |
| 8 | `PushNotificationDTOMapper` | class | MMCA.Common.Application.Notifications.PushNotifications.DTOs |
| 8 | `PushNotificationDTOProjection` | class | MMCA.Common.Application.Notifications.PushNotifications.DTOs |
| 8 | `SendPushNotificationRequestValidator` | class | MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send |
| 8 | `UserNotificationExportService` | class | MMCA.ADC.Notification.Application |
| 9 | `DependencyInjection` | class | MMCA.ADC.Notification.Application |
| 9 | `DevicesController` | class | MMCA.Common.API.Controllers.Notifications |
| 9 | `GetNotificationHistoryHandler` | class | MMCA.Common.Application.Notifications.PushNotifications.UseCases.GetHistory |
| 9 | `InboxController` | class | MMCA.Common.API.Controllers.Notifications |
| 9 | `NotificationsController` | class | MMCA.Common.API.Controllers.Notifications |
| 9 | `PushNotificationDTOProjector` | class | MMCA.Common.Application.Notifications.PushNotifications.DTOs |
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
| 0 | `NavigationType` | enum | MMCA.Common.Application.Interfaces |
| 1 | `NavigationPropertyInfo` | record | MMCA.Common.Application.Interfaces |
| 2 | `INavigationMetadata` | interface | MMCA.Common.Application.Interfaces |
| 3 | `NavigationMetadata` | class | MMCA.Common.Application.Interfaces |
| 4 | `INavigationPopulator<in TEntity>` | interface | MMCA.Common.Application.Interfaces |
| 5 | `NullNavigationPopulator<TEntity>` | class | MMCA.Common.Application.Services |
| 6 | `NavigationLoader` | class | MMCA.Common.Application.Services |
| 8 | `INavigationDescriptor<in TEntity>` | interface | MMCA.Common.Application.Services.Navigation |
| 9 | `ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>` | class | MMCA.Common.Application.Services.Navigation |
| 9 | `DeclarativeNavigationPopulator<TEntity>` | class | MMCA.Common.Application.Services.Navigation |
| 9 | `FKNavigationDescriptor<TEntity, TChild, TChildId>` | class | MMCA.Common.Application.Services.Navigation |

### G12 - API Hosting, Middleware, Idempotency & DTO/Contract Mapping

> `group-12-api-hosting-mapping.md` | 81 types | The ASP.NET Core edge: controller bases, middleware, startup, model binders, JSON converters, feature management, idempotency, correlation, and manual DTO/request mapping.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `ApiParameterDescriptorBackfillProvider` | class | MMCA.Common.API.OpenApi |
| 0 | `AppAssociationOptions` | class | MMCA.Common.API.Startup |
| 0 | `AssemblyReference` | class | MMCA.Common.API |
| 0 | `ClassReference` | class | MMCA.Common.API |
| 0 | `CsvWriter` | class | MMCA.Common.API.Export |
| 0 | `DbUpdateExceptionHandler` | class | MMCA.Common.API.Middleware |
| 0 | `DisabledFeatureHandler` | class | MMCA.Common.API.FeatureManagement |
| 0 | `ErrorResources` | class | MMCA.Common.API.Resources |
| 0 | `ErrorResourceSource` | class | MMCA.Common.API.Localization |
| 0 | `ExternalAuthExtensions` | class | MMCA.Common.API.Authentication |
| 0 | `IBaseDTO<TIdentifierType>` | interface | MMCA.Common.Shared.DTOs |
| 0 | `IConcurrencyAware` | interface | MMCA.Common.Shared.DTOs |
| 0 | `ICorrelationContext` | interface | MMCA.Common.Application.Interfaces |
| 0 | `IdempotencyMetrics` | class | MMCA.Common.API.Idempotency |
| 0 | `IdempotencyRecord` | record | MMCA.Common.API.Idempotency |
| 0 | `IdempotencySettings` | class | MMCA.Common.API.Idempotency |
| 0 | `IErrorLocalizer` | interface | MMCA.Common.API.Localization |
| 0 | `JwtAuthorityExtensions` | class | MMCA.Common.API.Startup |
| 0 | `JwtForwardingDelegatingHandler` | class | MMCA.Common.Infrastructure.Http |
| 0 | `MiddlewarePipelineStep` | record | MMCA.Common.API.Startup |
| 0 | `MiddlewarePipelineStepNames` | class | MMCA.Common.API.Startup |
| 0 | `NonIdempotentAttribute` | class | MMCA.Common.API.Idempotency |
| 0 | `OpenApiEndpointExtensions` | class | MMCA.Common.API.Startup |
| 0 | `OperationCanceledExceptionHandler` | class | MMCA.Common.API.Middleware |
| 0 | `OutputCacheMetrics` | class | MMCA.Common.API.Caching |
| 0 | `PublicEndpointOutputCachePolicy` | class | MMCA.Common.API.Caching |
| 0 | `QueryFilterModelBinder` | class | MMCA.Common.API.ModelBinders |
| 0 | `RateLimitAlgorithm` | enum | MMCA.Common.API.RateLimiting |
| 0 | `RedisRateLimitLease` | class | MMCA.Common.API.RateLimiting |
| 0 | `ServiceInfoResponse` | record | MMCA.Common.API.Controllers |
| 0 | `ServiceInfoV2Response` | record | MMCA.Common.API.Controllers |
| 0 | `SupportedCultures` | class | MMCA.Common.Shared.Globalization |
| 0 | `ValidationExceptionHandler` | class | MMCA.Common.API.Middleware |
| 1 | `AppAssociationEndpointExtensions` | class | MMCA.Common.API.Startup |
| 1 | `BaseLookup<TIdentifierType>` | record | MMCA.Common.Shared.DTOs |
| 1 | `CorrelationContext` | class | MMCA.Common.Infrastructure.Services |
| 1 | `DomainExceptionHandler` | class | MMCA.Common.API.Middleware |
| 1 | `ErrorLocalizer` | class | MMCA.Common.API.Localization |
| 1 | `GlobalExceptionHandler` | class | MMCA.Common.API.Middleware |
| 1 | `JwksEndpointExtensions` | class | MMCA.Common.API.Startup |
| 1 | `MiniProfilerExtensions` | class | MMCA.Common.API.Startup |
| 1 | `OutputCacheOptionsExtensions` | class | MMCA.Common.API.Caching |
| 1 | `RateLimitingSettings` | class | MMCA.Common.API.RateLimiting |
| 1 | `RedisFixedWindowRateLimiter` | class | MMCA.Common.API.RateLimiting |
| 1 | `ServiceInfoControllerBase` | class | MMCA.Common.API.Controllers |
| 2 | `IEntityControllerBase<TEntityDTO, TIdentifierType>` | interface | MMCA.Common.API.Controllers |
| 2 | `InsecureJwtMetadataWarningStartupFilter` | class | MMCA.Common.API.Startup |
| 2 | `ModuleControllerFeatureProvider` | class | MMCA.Common.API |
| 2 | `OidcDiscoveryEndpointExtensions` | class | MMCA.Common.API.Startup |
| 2 | `WebApplicationBuilderExtensions` | class | MMCA.Common.API.Startup |
| 3 | `ErrorHttpMapping` | class | MMCA.Common.API.Middleware |
| 3 | `IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>` | interface | MMCA.Common.API.Controllers |
| 3 | `ModuleHostContext` | class | MMCA.Common.API.Startup |
| 3 | `SignalRExtensions` | class | MMCA.Common.API.Startup |
| 3 | `TenantResolutionMiddleware` | class | MMCA.Common.API.Middleware |
| 4 | `ApiControllerBase` | class | MMCA.Common.API.Controllers |
| 4 | `CurrencyJsonConverter` | class | MMCA.Common.API.JsonConverters |
| 4 | `IdempotencyFilter` | class | MMCA.Common.API.Idempotency |
| 4 | `IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces |
| 4 | `IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces |
| 4 | `ModuleHostExtensions` | class | MMCA.Common.API.Startup |
| 4 | `OutputCacheEvictionHandler` | class | MMCA.Common.API.Caching |
| 4 | `SupportsIfMatchAttribute` | class | MMCA.Common.API.Concurrency |
| 4 | `UnhandledResultFailureFilter` | class | MMCA.Common.API.Middleware |
| 5 | `IdempotentAttribute` | class | MMCA.Common.API.Idempotency |
| 5 | `OutputCacheEvictionExtensions` | class | MMCA.Common.API.Caching |
| 6 | `EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>` | class | MMCA.Common.API.Controllers |
| 6 | `OAuthControllerBase` | class | MMCA.Common.API.Controllers |
| 7 | `AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>` | class | MMCA.Common.API.Controllers |
| 8 | `CrudEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest, TUpdateRequest>` | class | MMCA.Common.API.Controllers |
| 8 | `CurrentUserTargetingContextAccessor` | class | MMCA.Common.API.FeatureManagement |
| 9 | `CorrelationIdMiddleware` | class | MMCA.Common.API.Middleware |
| 9 | `SoftDeletedUserMiddleware` | class | MMCA.Common.API.Middleware |
| 10 | `DataExportControllerBase<TQuery>` | class | MMCA.Common.API.Controllers.Privacy |
| 10 | `MiddlewarePipelineBuilder` | class | MMCA.Common.API.Startup |
| 10 | `WebApplicationExtensions` | class | MMCA.Common.API.Startup |
| 11 | `DependencyInjection` | class | MMCA.Common.API |
| 13 | `DatabaseInitializationExtensions` | class | MMCA.Common.API.Startup |
| 15 | `AuthControllerBase` | class | MMCA.Common.API.Controllers |
| 15 | `PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>` | class | MMCA.Common.API.Controllers |
| 16 | `UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>` | class | MMCA.Common.API.Controllers |

### G13 - gRPC & Inter-Service Contracts

> `group-13-grpc-contracts.md` | 6 types | Typed gRPC clients/servers, interceptors, Result-over-the-wire, and the ServiceContract marker for synchronous inter-service calls ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)).

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `JwtForwardingClientInterceptor` | class | MMCA.Common.Grpc.Interceptors |
| 0 | `ServiceContractAttribute` | class | MMCA.Common.Shared.Abstractions |
| 2 | `ResultFailureException` | class | MMCA.Common.Grpc.Exceptions |
| 3 | `GrpcResultExceptionInterceptor` | class | MMCA.Common.Grpc.Interceptors |
| 3 | `ResultGrpcExtensions` | class | MMCA.Common.Grpc |
| 4 | `DependencyInjection` | class | MMCA.Common.Grpc |

### G14 - Module System, Composition & Configuration

> `group-14-module-system-composition.md` | 72 types | IModule discovery + Kahn-ordered ModuleLoader, the DI composition roots, assembly markers, data-source/database attributes, and options/settings binding.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `ApplicationSettings` | class | MMCA.Common.Application.Settings |
| 0 | `AssemblyReference` | class | MMCA.Common.Application |
| 0 | `AssemblyReference` | class | MMCA.Common.Domain |
| 0 | `AssemblyReference` | class | MMCA.Common.Infrastructure |
| 0 | `AuditTrailEntryDTO` | record | MMCA.Common.Application.Auditing |
| 0 | `BrokerMetrics` | class | MMCA.Common.Infrastructure.Messaging |
| 0 | `ClassReference` | class | MMCA.Common.Application |
| 0 | `ClassReference` | class | MMCA.Common.Domain |
| 0 | `ClassReference` | class | MMCA.Common.Infrastructure |
| 0 | `ConnectionStringSettings` | class | MMCA.Common.Infrastructure.Settings |
| 0 | `DataSourceEntrySettings` | class | MMCA.Common.Infrastructure.Settings |
| 0 | `DecoratorPipelineSeal` | class | MMCA.Common.Application |
| 0 | `FileStorageSettings` | class | MMCA.Common.Infrastructure.Settings |
| 0 | `IModuleSeeder` | interface | MMCA.Common.Application.Modules |
| 0 | `InProcessLockHandle` | class | MMCA.Common.Infrastructure.Concurrency |
| 0 | `IUserScopedRequest` | interface | MMCA.Common.Application.Users |
| 0 | `JobClaim` | record | MMCA.Common.Infrastructure.Scheduling |
| 0 | `JwksSettings` | class | MMCA.Common.Infrastructure.Settings |
| 0 | `JwtSigningAlgorithm` | enum | MMCA.Common.Infrastructure.Settings |
| 0 | `MessageBusProvider` | enum | MMCA.Common.Infrastructure.Settings |
| 0 | `MmcaApplicationPipelineBuilder` | class | MMCA.Common.Application |
| 0 | `ModuleSettings` | class | MMCA.Common.Application.Settings |
| 0 | `NativePushSettings` | class | MMCA.Common.Infrastructure.Settings |
| 0 | `PersistenceSettings` | class | MMCA.Common.Infrastructure.Settings |
| 0 | `QueryCachePipelineSettings` | class | MMCA.Common.Application.Settings |
| 0 | `RedisLockHandle` | class | MMCA.Common.Infrastructure.Concurrency |
| 0 | `ScheduledJobEntry` | class | MMCA.Common.Infrastructure.Scheduling |
| 0 | `ScheduledJobOverrideSettings` | class | MMCA.Common.Infrastructure.Settings |
| 0 | `SchedulerMetrics` | class | MMCA.Common.Infrastructure.Scheduling |
| 0 | `ServiceBusEmulatorSupport` | class | MMCA.Common.Infrastructure.Messaging |
| 0 | `SmtpSettings` | class | MMCA.Common.Infrastructure.Settings |
| 0 | `TenantDataSourceOverrideSettings` | class | MMCA.Common.Infrastructure.Settings |
| 0 | `TenantResolutionStrategy` | enum | MMCA.Common.Infrastructure.Settings |
| 0 | `UseDatabaseAttribute` | class | MMCA.Common.Infrastructure |
| 0 | `UserDataExportSectionDefaults` | class | MMCA.Common.Application.Users.UseCases.ExportUserData |
| 0 | `UserUseCaseLog` | class | MMCA.Common.Application.Users |
| 1 | `AuditTrailSettings` | class | MMCA.Common.Infrastructure.Settings |
| 1 | `CacheSettings` | class | MMCA.Common.Infrastructure.Settings |
| 1 | `DataSourcesSettings` | class | MMCA.Common.Infrastructure.Settings |
| 1 | `GetUserPreferencesQuery` | record | MMCA.Common.Application.Users.UseCases.GetPreferences |
| 1 | `IModule` | interface | MMCA.Common.Application.Modules |
| 1 | `InProcessDistributedLock` | class | MMCA.Common.Infrastructure.Concurrency |
| 1 | `IUserOwnedRequest` | interface | MMCA.Common.Application.Users |
| 1 | `IUserScopedCommand<out TRequest>` | interface | MMCA.Common.Application.Users |
| 1 | `JwtSettings` | class | MMCA.Common.Infrastructure.Settings |
| 1 | `MessageBusSettings` | class | MMCA.Common.Infrastructure.Settings |
| 1 | `ModulesSettings` | class | MMCA.Common.Application.Settings |
| 1 | `PushNotificationSettings` | class | MMCA.Common.Infrastructure.Settings |
| 1 | `SchedulerSettings` | class | MMCA.Common.Infrastructure.Settings |
| 1 | `TenantEntrySettings` | class | MMCA.Common.Infrastructure.Settings |
| 1 | `UseDataSourceAttribute` | class | MMCA.Common.Infrastructure |
| 1 | `UserDataExportSectionResult` | record | MMCA.Common.Application.Users.UseCases.ExportUserData |
| 2 | `ConnectionStringSettingsValidator` | class | MMCA.Common.Infrastructure.Settings |
| 2 | `IUserDataExportSection` | interface | MMCA.Common.Application.Users.UseCases.ExportUserData |
| 2 | `ModuleLoader` | class | MMCA.Common.Application.Modules |
| 2 | `OutboxSettings` | class | MMCA.Common.Infrastructure.Settings |
| 2 | `RedisDistributedLock` | class | MMCA.Common.Infrastructure.Concurrency |
| 2 | `TenancySettings` | class | MMCA.Common.Infrastructure.Settings |
| 2 | `UserOwnershipRule` | class | MMCA.Common.Application.Users |
| 4 | `TenancySettingsValidator` | class | MMCA.Common.Infrastructure.Settings |
| 8 | `ChangePasswordHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application.Users.UseCases.ChangePassword |
| 8 | `ChangePreferencesHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application.Users.UseCases.ChangePreferences |
| 8 | `DeleteUserHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application.Users.UseCases.DeleteUser |
| 8 | `ExportUserDataHandlerBase<TUser, TQuery>` | class | MMCA.Common.Application.Users.UseCases.ExportUserData |
| 8 | `ForgotPasswordHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application.Users.UseCases.ForgotPassword |
| 8 | `GetUserPreferencesHandlerBase<TUser>` | class | MMCA.Common.Application.Users.UseCases.GetPreferences |
| 8 | `ResetPasswordHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application.Users.UseCases.ResetPassword |
| 8 | `SoftDeletedUserValidator<TUser>` | class | MMCA.Common.Application.Users |
| 11 | `DependencyInjection` | class | MMCA.Common.Application |
| 13 | `CreateMigrationProofTable` | class | MMCA.Common.Infrastructure.Tests.MigrationsFixture |
| 13 | `ScheduledJobRunner` | class | MMCA.Common.Infrastructure.Scheduling |
| 14 | `DependencyInjection` | class | MMCA.Common.Infrastructure |

### G15 - Common UI Framework (MudBlazor components, theme, base pages)

> `group-15-common-ui-framework.md` | 117 types | Reusable Blazor building blocks: the data-grid list page base, theme, common pages/services, and UI extensions shared by every consumer app.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AbsoluteUrlAttribute` | class | MMCA.Common.UI.Validation |
| 0 | `ApiFileDownloadButton` | class | MMCA.Common.UI.Components |
| 0 | `BackNavigationResult` | record | MMCA.Common.UI.Services.Navigation |
| 0 | `BrandColors` | class | MMCA.Common.UI.Theme |
| 0 | `BreakpointConstants` | class | MMCA.Common.UI.Common |
| 0 | `CachedPage` | record | MMCA.Common.UI.Pages.Common |
| 0 | `ChannelReferenceCounter` | class | MMCA.Common.UI.Services.Notifications |
| 0 | `CultureDelegatingHandler` | class | MMCA.Common.UI.Services |
| 0 | `ErrorMessages` | class | MMCA.Common.UI.Pages.Common |
| 0 | `ForgotPasswordModel` | class | MMCA.Common.UI.Pages.Auth |
| 0 | `IApiSettings` | interface | MMCA.Common.UI.Common.Settings |
| 0 | `IAppDialogService` | interface | MMCA.Common.UI.Common.Interfaces |
| 0 | `ICultureApplier` | interface | MMCA.Common.UI.Services |
| 0 | `IHomePageContent` | interface | MMCA.Common.UI.Common.Interfaces |
| 0 | `IModelValidator` | interface | MMCA.Common.UI.Validation |
| 0 | `InfiniteScrollSentinel` | class | MMCA.Common.UI.Components |
| 0 | `INotificationScopeProvider` | interface | MMCA.Common.UI.Services.Notifications |
| 0 | `IOAuthUISettings` | interface | MMCA.Common.UI.Services.Auth |
| 0 | `IPublicLinkBuilder` | interface | MMCA.Common.UI.Services |
| 0 | `ISecureTokenStore` | interface | MMCA.Common.UI.Services.Auth |
| 0 | `ISessionCookieSync` | interface | MMCA.Common.UI.Services.Auth |
| 0 | `ITokenRefresher` | interface | MMCA.Common.UI.Services.Auth |
| 0 | `ITokenStorageService` | interface | MMCA.Common.UI.Services.Auth |
| 0 | `IUiReadCache` | interface | MMCA.Common.UI.Services.Caching |
| 0 | `IUserPreferenceWriter` | interface | MMCA.Common.UI.Services |
| 0 | `JwtTokenInfo` | class | MMCA.Common.UI.Services.Auth |
| 0 | `LatestLoadGuard` | class | MMCA.Common.UI.Common |
| 0 | `LayoutSettings` | class | MMCA.Common.UI.Common.Settings |
| 0 | `LazyJsModule` | class | MMCA.Common.UI.Services |
| 0 | `ListPageState` | record | MMCA.Common.UI.Services |
| 0 | `LoginModel` | class | MMCA.Common.UI.Pages.Auth |
| 0 | `MudTranslations` | class | MMCA.Common.UI.Resources |
| 0 | `NavSection` | enum | MMCA.Common.UI.Common |
| 0 | `NotificationBellOptions` | class | MMCA.Common.UI.Common.Settings |
| 0 | `NotificationState` | class | MMCA.Common.UI.Services.Notifications |
| 0 | `PasswordComplexityAttribute` | class | MMCA.Common.UI.Pages.Auth |
| 0 | `PersistedGridState` | record | MMCA.Common.UI.Pages.Common |
| 0 | `PseudoLocalizer` | class | MMCA.Common.UI.Globalization |
| 0 | `QrErrorCorrectionLevel` | enum | MMCA.Common.UI.Components |
| 0 | `RegisterModel` | class | MMCA.Common.UI.Pages.Auth |
| 0 | `ResetPasswordModel` | class | MMCA.Common.UI.Pages.Auth |
| 0 | `ReturnUrlProtector` | class | MMCA.Common.UI.Services.Navigation |
| 0 | `RoutePaths` | class | MMCA.Common.UI.Common |
| 0 | `SharedResource` | class | MMCA.Common.UI.Resources |
| 0 | `ToastSeverity` | enum | MMCA.Common.UI.Common.Interfaces |
| 0 | `UIModuleConfiguration` | class | MMCA.Common.UI.Common.Settings |
| 0 | `UiReadCacheOptions` | class | MMCA.Common.UI.Common.Settings |
| 0 | `UISharedAssemblyReference` | class | MMCA.Common.UI |
| 0 | `UserAgentSummary` | class | MMCA.Common.UI.Services.Auth |
| 0 | `UserPreferences` | record | MMCA.Common.UI.Services |
| 0 | `UserPreferencesRequest` | record | MMCA.Common.UI.Services |
| 0 | `WebApplicationExtensions` | class | MMCA.Common.UI.Extensions |
| 1 | `ApiSettings` | class | MMCA.Common.UI.Common.Settings |
| 1 | `ApiUserPreferenceWriter` | class | MMCA.Common.UI.Services |
| 1 | `AuthDelegatingHandler` | class | MMCA.Common.UI.Services.Auth |
| 1 | `AuthenticatedServiceBase` | class | MMCA.Common.UI.Services |
| 1 | `ConfigurationOAuthUISettings` | class | MMCA.Common.UI.Services.Auth |
| 1 | `DataAnnotationsModelValidator` | class | MMCA.Common.UI.Validation |
| 1 | `DefaultOAuthUISettings` | class | MMCA.Common.UI.Services.Auth |
| 1 | `DirectApiTokenRefresher` | class | MMCA.Common.UI.Services.Auth |
| 1 | `EndpointCultureApplier` | class | MMCA.Common.UI.Services |
| 1 | `IToastService` | interface | MMCA.Common.UI.Common.Interfaces |
| 1 | `IUserPreferenceReader` | interface | MMCA.Common.UI.Services |
| 1 | `JsFetchSessionCookieSync` | class | MMCA.Common.UI.Services.Auth |
| 1 | `JwtAuthenticationStateProvider` | class | MMCA.Common.UI.Services.Auth |
| 1 | `ListPageQueryStateService` | class | MMCA.Common.UI.Services |
| 1 | `ListPageStateService` | class | MMCA.Common.UI.Services |
| 1 | `MauiBackNavigationBridge` | class | MMCA.Common.UI.Services.Navigation |
| 1 | `MmcaCultureBootstrap` | class | MMCA.Common.UI.Services |
| 1 | `MudAppDialogService` | class | MMCA.Common.UI.Services |
| 1 | `NavigationHistoryService` | class | MMCA.Common.UI.Services.Navigation |
| 1 | `NavigationPublicLinkBuilder` | class | MMCA.Common.UI.Services |
| 1 | `NavItem` | record | MMCA.Common.UI.Common |
| 1 | `NotificationSendModel` | class | MMCA.Common.UI.Pages.Notifications |
| 1 | `NullNotificationScopeProvider` | class | MMCA.Common.UI.Services.Notifications |
| 1 | `OfflineFirstPageSnapshot<TItem>` | class | MMCA.Common.UI.Pages.Common |
| 1 | `PseudoStringLocalizer` | class | MMCA.Common.UI.Globalization |
| 1 | `ResxMudLocalizer` | class | MMCA.Common.UI.Globalization |
| 1 | `SameOriginProxyTokenRefresher` | class | MMCA.Common.UI.Services.Auth |
| 1 | `ThemeService` | class | MMCA.Common.UI.Services |
| 1 | `UiReadCache` | class | MMCA.Common.UI.Services.Caching |
| 1 | `WasmTokenStorageService` | class | MMCA.Common.UI.Services.Auth |
| 2 | `ApiUserPreferenceReader` | class | MMCA.Common.UI.Services |
| 2 | `BlazorCspPolicyProvider` | class | MMCA.Common.UI.Web.Security |
| 2 | `ChannelSubscription` | class | MMCA.Common.UI.Services.Notifications |
| 2 | `IUIModule` | interface | MMCA.Common.UI.Common.Interfaces |
| 2 | `MMCATheme` | class | MMCA.Common.UI.Theme |
| 2 | `ModelValidation` | class | MMCA.Common.UI.Validation |
| 2 | `NotificationHubService` | class | MMCA.Common.UI.Services.Notifications |
| 2 | `PseudoStringLocalizerFactory` | class | MMCA.Common.UI.Globalization |
| 3 | `DataGridListPageBase<TDto>` | class | MMCA.Common.UI.Pages.Common |
| 3 | `HttpResultExecutor` | class | MMCA.Common.UI.Services |
| 3 | `IEntityService<TEntityDTO, TIdentifierType>` | interface | MMCA.Common.UI.Common.Interfaces |
| 3 | `INotificationInboxUIService` | interface | MMCA.Common.UI.Services.Notifications |
| 3 | `IPushNotificationUIService` | interface | MMCA.Common.UI.Services.Notifications |
| 3 | `MobileInfiniteScrollList<TItem>` | class | MMCA.Common.UI.Components |
| 3 | `ResultUiExtensions` | class | MMCA.Common.UI.Common |
| 4 | `ChildEntityServiceBase` | class | MMCA.Common.UI.Services |
| 4 | `EntityServiceBase<TEntityDTO, TIdentifierType>` | class | MMCA.Common.UI.Services |
| 4 | `ListPageActions` | class | MMCA.Common.UI.Pages.Common |
| 4 | `NotificationInbox` | class | MMCA.Common.UI.Pages.Notifications |
| 4 | `NotificationInboxService` | class | MMCA.Common.UI.Services.Notifications |
| 4 | `ServerTokenStorageService` | class | MMCA.Common.UI.Web.Services |
| 5 | `DependencyInjection` | class | MMCA.Common.UI.Web |
| 5 | `IAuthUIService` | interface | MMCA.Common.UI.Services.Auth |
| 5 | `MoneyExtensions` | class | MMCA.Common.UI.Extensions |
| 5 | `MudToastService` | class | MMCA.Common.UI.Services |
| 5 | `NotificationRoutePaths` | class | MMCA.Common.UI.Common |
| 5 | `PushNotificationService` | class | MMCA.Common.UI.Services.Notifications |
| 6 | `AuthUIService` | class | MMCA.Common.UI.Services.Auth |
| 6 | `NotificationBell` | class | MMCA.Common.UI.Components.Notifications |
| 6 | `NotificationList` | class | MMCA.Common.UI.Pages.Notifications |
| 6 | `NotificationSend` | class | MMCA.Common.UI.Pages.Notifications |
| 6 | `Sessions` | class | MMCA.Common.UI.Pages.Auth |
| 7 | `DependencyInjection` | class | MMCA.Common.UI |
| 7 | `NotificationUIModule` | class | MMCA.Common.UI.Notifications |
| 8 | `DependencyInjection` | class | MMCA.Common.UI.Notifications |

### G16 - Aspire Orchestration & Service Defaults

> `group-16-aspire-orchestration.md` | 57 types | The Aspire AppHost wiring, ServiceDefaults, warmup, telemetry and security helpers that compose and run the distributed app locally and in Azure.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AppHostCompositionSmokeTests` | class | MMCA.ADC.AppHost.SmokeTests |
| 0 | `BrokerResilienceDefaults` | class | MMCA.Common.Shared.Resilience |
| 0 | `BrokerSelection` | class | MMCA.ADC.AppHost |
| 0 | `CspNonce` | class | MMCA.Common.Aspire.Security |
| 0 | `CspPolicy` | record | MMCA.Common.Aspire.Security |
| 0 | `DataProtectionExtensions` | class | MMCA.Common.Aspire |
| 0 | `DownstreamProbeVersion` | enum | MMCA.Common.Aspire.Gateway |
| 0 | `ForwardedHeadersExtensions` | class | MMCA.Common.Gateway |
| 0 | `GatewayActiveHealthCheckDefaults` | class | MMCA.Common.Gateway |
| 0 | `GatewayClusterRequestProfile` | class | MMCA.Common.Gateway |
| 0 | `GatewayCorsExtensions` | class | MMCA.Common.Aspire |
| 0 | `GatewayDownstreamRegistry` | class | MMCA.Common.Aspire.Gateway |
| 0 | `GatewayPassiveHealthCheckDefaults` | class | MMCA.Common.Gateway |
| 0 | `GatewayRateLimitingSettings` | class | MMCA.Common.Aspire.Gateway |
| 0 | `GatewayRoutePolicyPartition` | enum | MMCA.Common.Gateway |
| 0 | `GatewayTraceHeaderSettings` | class | MMCA.Common.Gateway |
| 0 | `H2cHealthCheckRegistry` | class | MMCA.Common.Aspire.Hosting |
| 0 | `HealthCheckTags` | class | MMCA.Common.Aspire |
| 0 | `HttpResilienceDefaults` | class | MMCA.Common.Shared.Resilience |
| 0 | `IWarmupTask` | interface | MMCA.Common.Aspire.Warmup |
| 0 | `KestrelListenerSpec` | record | MMCA.Common.Aspire.Kestrel |
| 0 | `KeyVaultConfigurationExtensions` | class | MMCA.Common.Aspire |
| 0 | `RedisCachingExtensions` | class | MMCA.Common.Aspire.Caching |
| 0 | `RedisPingHealthCheck` | class | MMCA.Common.Aspire.Health |
| 0 | `SecurityHeadersSettings` | class | MMCA.Common.Aspire.Security |
| 0 | `SerilogHostExtensions` | class | MMCA.Common.Aspire.Logging |
| 0 | `ServiceBusEmulatorResource` | class | MMCA.Common.Aspire.Hosting |
| 0 | `WarmupReadinessGate` | class | MMCA.Common.Aspire.Warmup |
| 1 | `DownstreamServiceHealthCheck` | class | MMCA.Common.Aspire.Gateway |
| 1 | `Extensions` | class | MMCA.Common.Aspire.Hosting |
| 1 | `GatewayDownstreamHealthCheckOptions` | class | MMCA.Common.Aspire.Gateway |
| 1 | `GatewayHealthCheckDefaults` | class | MMCA.Common.Gateway |
| 1 | `GatewayRateLimitingExtensions` | class | MMCA.Common.Aspire.Gateway |
| 1 | `GatewayRoutePolicySettings` | class | MMCA.Common.Gateway |
| 1 | `GrpcResilienceDefaults` | class | MMCA.Common.Shared.Resilience |
| 1 | `H2cEndpointHealthCheck` | class | MMCA.Common.Aspire.Hosting |
| 1 | `H2cHealthCheckExtensions` | class | MMCA.Common.Aspire.Hosting |
| 1 | `ICspPolicyProvider` | interface | MMCA.Common.Aspire.Security |
| 1 | `KestrelEndpointExtensions` | class | MMCA.Common.Aspire.Kestrel |
| 1 | `OpenIdConnectMetadataWarmupTask` | class | MMCA.Common.Aspire.Warmup |
| 1 | `SelfHttpWarmupTaskBase` | class | MMCA.Common.Aspire.Warmup |
| 1 | `WarmupHostedService` | class | MMCA.Common.Aspire.Warmup |
| 1 | `WarmupReadinessHealthCheck` | class | MMCA.Common.Aspire.Warmup |
| 2 | `GatewayHealthCheckExtensions` | class | MMCA.Common.Aspire.Gateway |
| 2 | `GatewaySettings` | class | MMCA.Common.Gateway |
| 2 | `SecurityHeadersMiddleware` | class | MMCA.Common.Aspire.Security |
| 2 | `StaticCspPolicyProvider` | class | MMCA.Common.Aspire.Security |
| 3 | `GatewayClusterProfileConfigFilter` | class | MMCA.Common.Gateway.Configuration |
| 3 | `GatewayHealthCheckDefaultsConfigFilter` | class | MMCA.Common.Gateway.Configuration |
| 3 | `GatewayRoutePolicyExtensions` | class | MMCA.Common.Gateway.RateLimiting |
| 3 | `GatewayTraceHeaderTransformProvider` | class | MMCA.Common.Gateway.Transforms |
| 3 | `SecurityHeadersExtensions` | class | MMCA.Common.Aspire.Security |
| 4 | `GatewayReverseProxyExtensions` | class | MMCA.Common.Gateway |
| 9 | `GatewayCorrelationMiddleware` | class | MMCA.Common.Aspire.Gateway |
| 9 | `OutboxPollFilterProcessor` | class | MMCA.Common.Aspire.Telemetry |
| 10 | `Extensions` | class | MMCA.Common.Aspire |
| 10 | `GatewayCorrelationExtensions` | class | MMCA.Common.Aspire.Gateway |

### G17 - ADC Conference - Domain Model & Module Contracts

> `group-17-conference-domain.md` | 99 types | The Conference bounded context: Event/Session/Speaker/Category/Question aggregates, their domain events and invariants, plus the Shared identifiers/DTOs/integration-event contracts.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AssemblyReference` | class | MMCA.ADC.Conference.Domain |
| 0 | `CategoryItemDistribution` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 0 | `ClassReference` | class | MMCA.ADC.Conference.Domain |
| 0 | `ConferenceFeatures` | class | MMCA.ADC.Conference.Shared |
| 0 | `ConferencePermissions` | class | MMCA.ADC.Conference.Shared.Authorization |
| 0 | `EventLiveInfo` | record | MMCA.ADC.Conference.Shared.Events |
| 0 | `LinkUserRequest` | record | MMCA.ADC.Conference.Shared.Speakers |
| 0 | `NowNextSessionDTO` | record | MMCA.ADC.Conference.Shared.Sessions |
| 0 | `QuestionModerationDefault` | enum | MMCA.ADC.Conference.Shared.Events |
| 0 | `RatingQuestionSummary` | record | MMCA.ADC.Conference.Shared.Speakers |
| 0 | `RefreshFromSessionizeResultDTO` | record | MMCA.ADC.Conference.Shared.Events |
| 0 | `RoomSessionInfo` | record | MMCA.ADC.Conference.Shared.Events |
| 0 | `ScoreEventSessionsResultDTO` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 0 | `SessionAiScoreDTO` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 0 | `SessionStatuses` | class | MMCA.ADC.Conference.Domain.Sessions |
| 0 | `SimilarSessionPair` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 0 | `SpeakerLocalitySummary` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 0 | `SpeakerSessionSummary` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 0 | `SponsorLiveInfo` | record | MMCA.ADC.Conference.Shared.Events |
| 0 | `SponsorTier` | enum | MMCA.ADC.Conference.Shared.Sponsors |
| 0 | `TextQuestionResponses` | record | MMCA.ADC.Conference.Shared.Speakers |
| 1 | `ActivityDTO` | record | MMCA.ADC.Conference.Shared.Activities |
| 1 | `CategoryGroupDistribution` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 1 | `CategoryItemDTO` | record | MMCA.ADC.Conference.Shared.Categories |
| 1 | `ConferenceReadAudience` | class | MMCA.ADC.Conference.Shared.Authorization |
| 1 | `ContentSimilarityDTO` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 1 | `EventQuestionAnswerDTO` | record | MMCA.ADC.Conference.Shared.Events |
| 1 | `EventSpeakerDTO` | record | MMCA.ADC.Conference.Shared.Events |
| 1 | `MultiSessionSpeaker` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 1 | `NowNextDTO` | record | MMCA.ADC.Conference.Shared.Sessions |
| 1 | `QuestionDTO` | record | MMCA.ADC.Conference.Shared.Questions |
| 1 | `RoomDTO` | record | MMCA.ADC.Conference.Shared.Events |
| 1 | `SessionCategoryItemDTO` | record | MMCA.ADC.Conference.Shared.Sessions |
| 1 | `SessionFeedbackDTO` | record | MMCA.ADC.Conference.Shared.Speakers |
| 1 | `SessionLiveInfo` | record | MMCA.ADC.Conference.Shared.Events |
| 1 | `SessionQuestionAnswerDTO` | record | MMCA.ADC.Conference.Shared.Sessions |
| 1 | `SessionSpeakerDTO` | record | MMCA.ADC.Conference.Shared.Sessions |
| 1 | `SpeakerCategoryItemDTO` | record | MMCA.ADC.Conference.Shared.Speakers |
| 1 | `SpeakerQuestionAnswerDTO` | record | MMCA.ADC.Conference.Shared.Speakers |
| 1 | `SponsorDTO` | record | MMCA.ADC.Conference.Shared.Sponsors |
| 2 | `CategoryDistributionDTO` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 2 | `CategoryItemChanged` | record | MMCA.ADC.Conference.Domain.Categories.DomainEvents |
| 2 | `ConferenceCategoryDTO` | record | MMCA.ADC.Conference.Shared.Categories |
| 2 | `EventDTO` | record | MMCA.ADC.Conference.Shared.Events |
| 2 | `EventQuestionAnswerChanged` | record | MMCA.ADC.Conference.Domain.Events.DomainEvents |
| 2 | `EventSpeakerChanged` | record | MMCA.ADC.Conference.Domain.Events.DomainEvents |
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
| 3 | `EventChanged` | record | MMCA.ADC.Conference.Domain.Events.DomainEvents |
| 3 | `EventFeedbackSubmitted` | record | MMCA.ADC.Conference.Shared.Events.IntegrationEvents |
| 3 | `IEventLiveValidationService` | interface | MMCA.ADC.Conference.Shared.Events |
| 3 | `ISessionBookmarkValidationService` | interface | MMCA.ADC.Conference.Shared.Sessions |
| 3 | `QuestionChanged` | record | MMCA.ADC.Conference.Domain.Questions.DomainEvents |
| 3 | `SessionChanged` | record | MMCA.ADC.Conference.Domain.Sessions.DomainEvents |
| 3 | `SessionFeedbackSubmitted` | record | MMCA.ADC.Conference.Shared.Sessions.IntegrationEvents |
| 3 | `SessionSelectionDashboardDTO` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 3 | `SpeakerChanged` | record | MMCA.ADC.Conference.Domain.Speakers.DomainEvents |
| 3 | `SpeakerLinkedToUser` | record | MMCA.ADC.Conference.Shared.Speakers.IntegrationEvents |
| 3 | `SpeakerUnlinkedFromUser` | record | MMCA.ADC.Conference.Shared.Speakers.IntegrationEvents |
| 3 | `SponsorChanged` | record | MMCA.ADC.Conference.Domain.Sponsors.DomainEvents |
| 4 | `DisabledEventLiveValidationService` | class | MMCA.ADC.Conference.Shared.Events |
| 4 | `DisabledSessionBookmarkValidationService` | class | MMCA.ADC.Conference.Shared.Sessions |
| 5 | `SessionAiScore` | class | MMCA.ADC.Conference.Domain.Sessions |
| 6 | `ActivityInvariants` | class | MMCA.ADC.Conference.Domain.Activities |
| 6 | `Category` | class | MMCA.ADC.Conference.Domain.Categories |
| 6 | `CategoryInvariants` | class | MMCA.ADC.Conference.Domain.Categories |
| 6 | `CategoryItem` | class | MMCA.ADC.Conference.Domain.Categories |
| 6 | `EventInvariants` | class | MMCA.ADC.Conference.Domain.Events |
| 6 | `QuestionInvariants` | class | MMCA.ADC.Conference.Domain.Questions |
| 6 | `SessionInvariants` | class | MMCA.ADC.Conference.Domain.Sessions |
| 6 | `SpeakerInvariants` | class | MMCA.ADC.Conference.Domain.Speakers |
| 6 | `SponsorInvariants` | class | MMCA.ADC.Conference.Domain.Sponsors |
| 7 | `Event` | class | MMCA.ADC.Conference.Domain.Events |
| 7 | `EventQuestionAnswer` | class | MMCA.ADC.Conference.Domain.Events |
| 7 | `EventSpeaker` | class | MMCA.ADC.Conference.Domain.Events |
| 7 | `Question` | class | MMCA.ADC.Conference.Domain.Questions |
| 7 | `Room` | class | MMCA.ADC.Conference.Domain.Events |
| 7 | `Speaker` | class | MMCA.ADC.Conference.Domain.Speakers |
| 7 | `SpeakerCategoryItem` | class | MMCA.ADC.Conference.Domain.Speakers |
| 7 | `SpeakerQuestionAnswer` | class | MMCA.ADC.Conference.Domain.Speakers |
| 8 | `Activity` | class | MMCA.ADC.Conference.Domain.Activities |
| 8 | `CurrentEventSelector` | class | MMCA.ADC.Conference.Shared.Events |
| 8 | `Session` | class | MMCA.ADC.Conference.Domain.Sessions |
| 8 | `SessionCategoryItem` | class | MMCA.ADC.Conference.Domain.Sessions |
| 8 | `SessionQuestionAnswer` | class | MMCA.ADC.Conference.Domain.Sessions |
| 8 | `SessionSpeaker` | class | MMCA.ADC.Conference.Domain.Sessions |
| 8 | `Sponsor` | class | MMCA.ADC.Conference.Domain.Sponsors |
| 9 | `CurrentEventDefaults` | class | MMCA.ADC.Conference.Shared.Events |
| 9 | `IEventCascadeDeletionDomainService` | interface | MMCA.ADC.Conference.Domain.Services |
| 10 | `EventCascadeDeletionDomainService` | class | MMCA.ADC.Conference.Domain.Services |

### G18 - ADC Conference - Application & Use Cases

> `group-18-conference-application.md` | 303 types | Conference CQRS handlers, validators, DTOs, specifications, the Sessionize import, and the session-selection decision-support analytics.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `ActivityTimeRangeRules<T>` | class | MMCA.ADC.Conference.Application.Activities.Validation |
| 0 | `AssemblyReference` | class | MMCA.ADC.Conference.Application |
| 0 | `BatchSessionQuestionAnswerItem` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.BatchAddSessionQuestionAnswers |
| 0 | `ClassReference` | class | MMCA.ADC.Conference.Application |
| 0 | `ConferenceCategoryUpdateRequest` | record | MMCA.ADC.Conference.Application.Categories.UseCases.Update |
| 0 | `EventDateRangeRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 0 | `ExportEventCalendarQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar |
| 0 | `ExportSessionCalendarQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar |
| 0 | `GetCategoryDistributionQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution |
| 0 | `GetContentSimilarityQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity |
| 0 | `GetPublicActivityFilterQuery` | record | MMCA.ADC.Conference.Application.Activities.UseCases.GetPublicActivityFilter |
| 0 | `GetPublicEventSpeakerFilterQuery` | record | MMCA.ADC.Conference.Application.Events.UseCases.GetPublicEventSpeakerFilter |
| 0 | `GetPublicRoomFilterQuery` | record | MMCA.ADC.Conference.Application.Events.UseCases.GetPublicRoomFilter |
| 0 | `GetPublicSessionCategoryItemFilterQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionCategoryItemFilter |
| 0 | `GetPublicSessionFilterQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionFilter |
| 0 | `GetPublicSessionSpeakerFilterQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionSpeakerFilter |
| 0 | `GetPublicSpeakerCategoryItemFilterQuery` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.GetPublicSpeakerCategoryItemFilter |
| 0 | `GetPublicSpeakerFilterQuery` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.GetPublicSpeakerFilter |
| 0 | `GetPublicSponsorFilterQuery` | record | MMCA.ADC.Conference.Application.Sponsors.UseCases.GetPublicSponsorFilter |
| 0 | `GetSessionBookmarkCountQuery` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCount |
| 0 | `GetSessionBookmarkCountsQuery` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCounts |
| 0 | `GetSessionFeedbackQuery` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionFeedback |
| 0 | `GetSessionsBySpeakerFilterQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.GetSessionsBySpeakerFilter |
| 0 | `GetSessionSelectionDashboardQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard |
| 0 | `GetSpeakersByEventFilterQuery` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSpeakersByEventFilter |
| 0 | `GetSpeakerSessionOverlapQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSpeakerSessionOverlap |
| 0 | `IActivityFieldsRequest` | interface | MMCA.ADC.Conference.Application.Activities.Validation |
| 0 | `IEventFieldsRequest` | interface | MMCA.ADC.Conference.Application.Events.Validation |
| 0 | `ISessionFieldsRequest` | interface | MMCA.ADC.Conference.Application.Sessions.Validation |
| 0 | `ISpeakerFieldsRequest` | interface | MMCA.ADC.Conference.Application.Speakers.Validation |
| 0 | `ISponsorFieldsRequest` | interface | MMCA.ADC.Conference.Application.Sponsors.Validation |
| 0 | `LocalityLookupEntry` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport |
| 0 | `QuestionUpdateRequest` | record | MMCA.ADC.Conference.Application.Questions.UseCases.Update |
| 0 | `RoomCapacityRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 0 | `ScoreEventSessionsCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 0 | `SessionizeCategoryItem` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 0 | `SessionizeLink` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 0 | `SessionizeQuestion` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 0 | `SessionizeQuestionAnswer` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 0 | `SessionizeRoom` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 0 | `SessionizeSyncResult` | record | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 0 | `SessionScoringEnqueueResult` | enum | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 0 | `SessionScoringResult` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 0 | `SessionScoringWorkItem` | record struct | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 0 | `SessionSimilarityCalculator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity |
| 0 | `SpeakerInfo` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 0 | `StatusBucket` | enum | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard |
| 0 | `StatusBucket` | enum | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution |
| 1 | `ActivityEventIdRules<T>` | class | MMCA.ADC.Conference.Application.Activities.Validation |
| 1 | `ActivitySortOrderRules<T>` | class | MMCA.ADC.Conference.Application.Activities.Validation |
| 1 | `ActivityUpdateRequest` | record | MMCA.ADC.Conference.Application.Activities.UseCases.Update |
| 1 | `CategoryItemSortRules<T>` | class | MMCA.ADC.Conference.Application.Categories.Validation |
| 1 | `EventUpdateRequest` | record | MMCA.ADC.Conference.Application.Events.UseCases.Update |
| 1 | `ISessionScoringQueue` | interface | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 1 | `RoomSortRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 1 | `SessionEventIdRules<T>` | class | MMCA.ADC.Conference.Application.Sessions.Validation |
| 1 | `SessionizeCategory` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 1 | `SessionizeSession` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 1 | `SessionizeSpeaker` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 1 | `SessionScoringInput` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 1 | `SessionUpdateRequest` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.Update |
| 1 | `SpeakerUpdateRequest` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.Update |
| 1 | `SponsorEventIdRules<T>` | class | MMCA.ADC.Conference.Application.Sponsors.Validation |
| 1 | `SponsorSortRules<T>` | class | MMCA.ADC.Conference.Application.Sponsors.Validation |
| 1 | `SponsorUpdateRequest` | record | MMCA.ADC.Conference.Application.Sponsors.UseCases.Update |
| 2 | `IAiScoringService` | interface | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 2 | `SessionizeResponse` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 2 | `SessionScoringQueue` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 3 | `ISessionizeService` | interface | MMCA.ADC.Conference.Application.Events.Sessionize |
| 3 | `SessionizeSyncWarnings` | class | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 3 | `UpdateEventResult` | record | MMCA.ADC.Conference.Application.Events.UseCases.Update |
| 3 | `UpdateSessionResult` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.Update |
| 4 | `SpeakerDeletedHandler` | class | MMCA.ADC.Conference.Application.Speakers.DomainEventHandlers |
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
| 7 | `EventNameRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `EventOrganizerContactEmailRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `EventSponsorshipPacketUrlRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `EventTicketingUrlRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `EventTimeZoneRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `QuestionTextRules<T>` | class | MMCA.ADC.Conference.Application.Questions.Validation |
| 7 | `RemoveCategoryItemCommand` | record | MMCA.ADC.Conference.Application.Categories.UseCases.RemoveCategoryItem |
| 7 | `RoomAccessibilityInfoRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `RoomFloorRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `RoomLocationRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `RoomNameRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 7 | `SessionAccessibilityInfoRules<T>` | class | MMCA.ADC.Conference.Application.Sessions.Validation |
| 7 | `SessionDescriptionRules<T>` | class | MMCA.ADC.Conference.Application.Sessions.Validation |
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
| 8 | `ConferenceCategoryCreateRequestMapper` | class | MMCA.ADC.Conference.Application.Categories.UseCases.Create |
| 8 | `ConferenceCategoryCreateRequestValidator` | class | MMCA.ADC.Conference.Application.Categories.UseCases.Create |
| 8 | `ConferenceCategoryDTOMapper` | class | MMCA.ADC.Conference.Application.Categories.DTOs |
| 8 | `ConferenceCategoryUpdateRequestValidator` | class | MMCA.ADC.Conference.Application.Categories.UseCases.Update |
| 8 | `EventCreateRequest` | record | MMCA.ADC.Conference.Application.Events.UseCases.Create |
| 8 | `EventFieldRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 8 | `EventQuestionAnswerDTOMapper` | class | MMCA.ADC.Conference.Application.Events.DTOs |
| 8 | `EventSpeakerDTOMapper` | class | MMCA.ADC.Conference.Application.Events.DTOs |
| 8 | `LinkUserToSpeakerCommand` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.LinkUser |
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
| 8 | `UserRegisteredHandler` | class | MMCA.ADC.Conference.Application.Users.IntegrationEventHandlers |
| 9 | `ActivityCreateRequest` | record | MMCA.ADC.Conference.Application.Activities.UseCases.Create |
| 9 | `ActivityDTOMapper` | class | MMCA.ADC.Conference.Application.Activities.DTOs |
| 9 | `ActivityUpdateApplier` | class | MMCA.ADC.Conference.Application.Activities.UseCases.Update |
| 9 | `ActivityUpdateRequestValidator` | class | MMCA.ADC.Conference.Application.Activities.UseCases.Update |
| 9 | `AddCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem |
| 9 | `AddEventQuestionAnswerCommandValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer |
| 9 | `AddEventQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer |
| 9 | `AddEventSpeakerCommandValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker |
| 9 | `AddEventSpeakerHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker |
| 9 | `AddRoomCommandValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.AddRoom |
| 9 | `AddSessionCategoryItemCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem |
| 9 | `AddSessionQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer |
| 9 | `AddSessionSpeakerCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker |
| 9 | `AddSpeakerCategoryItemCommandValidator` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem |
| 9 | `AddSpeakerCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem |
| 9 | `BatchAddSessionQuestionAnswersCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.BatchAddSessionQuestionAnswers |
| 9 | `CalendarExportMapper` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar |
| 9 | `CreateConferenceCategoryHandler` | class | MMCA.ADC.Conference.Application.Categories.UseCases.Create |
| 9 | `DeleteConferenceCategoryHandler` | class | MMCA.ADC.Conference.Application.Categories.UseCases.Delete |
| 9 | `DeleteSessionHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.Delete |
| 9 | `EventCreateRequestMapper` | class | MMCA.ADC.Conference.Application.Events.UseCases.Create |
| 9 | `EventCreateRequestValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.Create |
| 9 | `EventDTOMapper` | class | MMCA.ADC.Conference.Application.Events.DTOs |
| 9 | `EventUpdateRequestValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.Update |
| 9 | `GetCategoryDistributionHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution |
| 9 | `GetContentSimilarityHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity |
| 9 | `GetNowNextQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.NowNext |
| 9 | `GetSessionBookmarkCountHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCount |
| 9 | `GetSessionBookmarkCountsHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCounts |
| 9 | `GetSessionFeedbackHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionFeedback |
| 9 | `GetSessionsBySpeakerFilterHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.GetSessionsBySpeakerFilter |
| 9 | `GetSessionSelectionDashboardHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard |
| 9 | `GetSpeakersByEventFilterHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSpeakersByEventFilter |
| 9 | `GetSpeakerSessionOverlapHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSpeakerSessionOverlap |
| 9 | `ISessionizeSyncStrategy` | interface | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 9 | `PublicSessionStatusSpecification` | class | MMCA.ADC.Conference.Application.Sessions.Specifications |
| 9 | `QuestionCreateRequestMapper` | class | MMCA.ADC.Conference.Application.Questions.UseCases.Create |
| 9 | `QuestionCreateRequestValidator` | class | MMCA.ADC.Conference.Application.Questions.UseCases.Create |
| 9 | `RemoveSessionCategoryItemCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionCategoryItem |
| 9 | `RemoveSessionQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionQuestionAnswer |
| 9 | `RemoveSessionSpeakerCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionSpeaker |
| 9 | `ScoreEventSessionsHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 9 | `SessionBookmarkValidationService` | class | MMCA.ADC.Conference.Application.Sessions |
| 9 | `SessionCategoryItemDTOMapper` | class | MMCA.ADC.Conference.Application.Sessions.DTOs |
| 9 | `SessionCreateRequest` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.Create |
| 9 | `SessionQuestionAnswerDTOMapper` | class | MMCA.ADC.Conference.Application.Sessions.DTOs |
| 9 | `SessionQuestionAnswerRules` | class | MMCA.ADC.Conference.Application.Sessions |
| 9 | `SessionRoomScheduling` | class | MMCA.ADC.Conference.Application.Sessions.Validation |
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
| 10 | `ActivityCreateRequestMapper` | class | MMCA.ADC.Conference.Application.Activities.UseCases.Create |
| 10 | `ActivityCreateRequestValidator` | class | MMCA.ADC.Conference.Application.Activities.UseCases.Create |
| 10 | `ActivityNavigationPopulator` | class | MMCA.ADC.Conference.Application.Activities |
| 10 | `AddSessionCategoryItemCommandValidator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem |
| 10 | `AddSessionCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem |
| 10 | `AddSessionQuestionAnswerCommandValidator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer |
| 10 | `AddSessionQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer |
| 10 | `AddSessionSpeakerCommandValidator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker |
| 10 | `AddSessionSpeakerHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker |
| 10 | `BatchAddSessionQuestionAnswersCommandValidator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.BatchAddSessionQuestionAnswers |
| 10 | `BatchAddSessionQuestionAnswersHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.BatchAddSessionQuestionAnswers |
| 10 | `CategoryItemNavigationPopulator` | class | MMCA.ADC.Conference.Application.Categories |
| 10 | `CategorySyncStrategy` | class | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 10 | `ConferenceCategoryNavigationPopulator` | class | MMCA.ADC.Conference.Application.Categories |
| 10 | `CreateActivityHandler` | class | MMCA.ADC.Conference.Application.Activities.UseCases.Create |
| 10 | `CreateEventHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.Create |
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
| 10 | `SpeakerQuestionAnswerNavigationPopulator` | class | MMCA.ADC.Conference.Application.Speakers |
| 10 | `SpeakerSyncStrategy` | class | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 10 | `SponsorCreateRequestMapper` | class | MMCA.ADC.Conference.Application.Sponsors.UseCases.Create |
| 10 | `SponsorCreateRequestValidator` | class | MMCA.ADC.Conference.Application.Sponsors.UseCases.Create |
| 10 | `SponsorNavigationPopulator` | class | MMCA.ADC.Conference.Application.Sponsors |
| 10 | `UnlinkUserFromSpeakerHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.UnlinkUser |
| 10 | `UnpublishEventHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.Unpublish |
| 10 | `UpdateCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem |
| 10 | `UpdateEventQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.UpdateEventQuestionAnswer |
| 10 | `UpdateRoomHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom |
| 10 | `UpdateSessionQuestionAnswerCommandValidator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.UpdateSessionQuestionAnswer |
| 10 | `UpdateSessionQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.UpdateSessionQuestionAnswer |
| 11 | `DependencyInjection` | class | MMCA.ADC.Conference.Application |
| 11 | `GetPublicActivityFilterHandler` | class | MMCA.ADC.Conference.Application.Activities.UseCases.GetPublicActivityFilter |
| 11 | `GetPublicEventSpeakerFilterHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.GetPublicEventSpeakerFilter |
| 11 | `GetPublicRoomFilterHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.GetPublicRoomFilter |
| 11 | `GetPublicSessionCategoryItemFilterHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionCategoryItemFilter |
| 11 | `GetPublicSessionSpeakerFilterHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionSpeakerFilter |
| 11 | `GetPublicSpeakerCategoryItemFilterHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.GetPublicSpeakerCategoryItemFilter |
| 11 | `GetPublicSpeakerFilterHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.GetPublicSpeakerFilter |
| 11 | `GetPublicSponsorFilterHandler` | class | MMCA.ADC.Conference.Application.Sponsors.UseCases.GetPublicSponsorFilter |
| 11 | `RemoveCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Categories.UseCases.RemoveCategoryItem |
| 11 | `RemoveEventSpeakerHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventSpeaker |
| 11 | `RemoveRoomHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.RemoveRoom |
| 11 | `RemoveSessionCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionCategoryItem |
| 11 | `RemoveSessionSpeakerHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionSpeaker |
| 11 | `RemoveSpeakerCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.RemoveSpeakerCategoryItem |
| 11 | `UpdateSpeakerHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.Update |
| 14 | `CreateQuestionHandler` | class | MMCA.ADC.Conference.Application.Questions.UseCases.Create |
| 14 | `CreateSessionHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.Create |
| 14 | `LinkUserToSpeakerHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.LinkUser |
| 14 | `RefreshFromSessionizeHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 14 | `UpdateQuestionHandler` | class | MMCA.ADC.Conference.Application.Questions.UseCases.Update |
| 15 | `AddRoomHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.AddRoom |
| 15 | `UpdateEventHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.Update |
| 15 | `UpdateSessionHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.Update |

### G19 - ADC Conference - Infrastructure & Persistence

> `group-19-conference-infrastructure.md` | 33 types | The Conference module DbContext registration, EF entity configurations, database seeding, and infrastructure services.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AiScoreResponse` | record | MMCA.ADC.Conference.Infrastructure.Services |
| 0 | `AnthropicContentBlock` | record | MMCA.ADC.Conference.Infrastructure.Services |
| 0 | `AnthropicMessage` | record | MMCA.ADC.Conference.Infrastructure.Services |
| 0 | `AssemblyReference` | class | MMCA.ADC.Conference.Infrastructure |
| 0 | `ClassReference` | class | MMCA.ADC.Conference.Infrastructure |
| 0 | `SessionScoreStamp` | record | MMCA.ADC.Conference.Infrastructure.Services |
| 0 | `SessionScoringCandidate` | record | MMCA.ADC.Conference.Infrastructure.Services |
| 1 | `AnthropicRequest` | record | MMCA.ADC.Conference.Infrastructure.Services |
| 1 | `AnthropicResponse` | record | MMCA.ADC.Conference.Infrastructure.Services |
| 3 | `AnthropicScoringService` | class | MMCA.ADC.Conference.Infrastructure.Services |
| 3 | `SessionScoringProcessor` | class | MMCA.ADC.Conference.Infrastructure.Services |
| 4 | `SessionizeService` | class | MMCA.ADC.Conference.Infrastructure.Services |
| 8 | `CategoryItemConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `ConferenceCategoryConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `EventConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `EventQuestionAnswerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `EventSpeakerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `QuestionConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `RoomConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `SessionAiScoreConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `SpeakerCategoryItemConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `SpeakerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `SpeakerQuestionAnswerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 9 | `ActivityConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 9 | `ConferenceModuleDbSeeder` | class | MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts.Seeding |
| 9 | `SessionCategoryItemConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 9 | `SessionConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 9 | `SessionQuestionAnswerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 9 | `SessionScoringSweepJob` | class | MMCA.ADC.Conference.Infrastructure.Services |
| 9 | `SessionSpeakerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 9 | `SponsorConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 10 | `DependencyInjection` | class | MMCA.ADC.Conference.Infrastructure |
| 12 | `ModuleApplicationDbContext` | class | MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts |

### G20 - ADC Conference - API, gRPC Contracts & Service Host

> `group-20-conference-api-grpc.md` | 44 types | Conference REST controllers, the .Contracts gRPC surface, the extractable service host, and the gRPC adapter.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AddCategoryItemRequest` | record | MMCA.ADC.Conference.API.Controllers |
| 0 | `AddEventQuestionAnswerRequest` | record | MMCA.ADC.Conference.API.Controllers |
| 0 | `AddEventSpeakerRequest` | record | MMCA.ADC.Conference.API.Controllers |
| 0 | `AddRoomRequest` | record | MMCA.ADC.Conference.API.Controllers |
| 0 | `AddSessionCategoryItemRequest` | record | MMCA.ADC.Conference.API.Controllers |
| 0 | `AddSessionQuestionAnswerRequest` | record | MMCA.ADC.Conference.API.Controllers |
| 0 | `AddSessionSpeakerRequest` | record | MMCA.ADC.Conference.API.Controllers |
| 0 | `AddSpeakerCategoryItemRequest` | record | MMCA.ADC.Conference.API.Controllers |
| 0 | `AssemblyReference` | class | MMCA.ADC.Conference.API |
| 0 | `BatchSessionQuestionAnswerItemRequest` | record | MMCA.ADC.Conference.API.Controllers |
| 0 | `ClassReference` | class | MMCA.ADC.Conference.API |
| 0 | `ConferenceErrorResources` | class | MMCA.ADC.Conference.API.Resources |
| 0 | `UpdateCategoryItemRequest` | record | MMCA.ADC.Conference.API.Controllers |
| 0 | `UpdateEventQuestionAnswerRequest` | record | MMCA.ADC.Conference.API.Controllers |
| 0 | `UpdateRoomRequest` | record | MMCA.ADC.Conference.API.Controllers |
| 0 | `UpdateSessionQuestionAnswerRequest` | record | MMCA.ADC.Conference.API.Controllers |
| 1 | `BatchAddSessionQuestionAnswersRequest` | record | MMCA.ADC.Conference.API.Controllers |
| 1 | `DependencyInjection` | class | MMCA.ADC.Conference.API |
| 2 | `SelfHttpOutputCacheWarmupTask` | class | MMCA.ADC.Conference.Service |
| 2 | `ServiceInfoController` | class | MMCA.ADC.Conference.API.Controllers |
| 5 | `ConferenceModule` | class | MMCA.ADC.Conference.API |
| 5 | `SessionSelectionController` | class | MMCA.ADC.Conference.API.Controllers |
| 8 | `CategoryItemsController` | class | MMCA.ADC.Conference.API.Controllers |
| 8 | `ConferenceCategoriesController` | class | MMCA.ADC.Conference.API.Controllers |
| 9 | `CurrentUserServiceExtensions` | class | MMCA.ADC.Conference.API.Authorization |
| 9 | `EventQuestionAnswersController` | class | MMCA.ADC.Conference.API.Controllers |
| 9 | `EventSpeakersController` | class | MMCA.ADC.Conference.API.Controllers |
| 9 | `QuestionsController` | class | MMCA.ADC.Conference.API.Controllers |
| 9 | `RoomsController` | class | MMCA.ADC.Conference.API.Controllers |
| 9 | `SpeakerCategoryItemsController` | class | MMCA.ADC.Conference.API.Controllers |
| 9 | `SpeakersController` | class | MMCA.ADC.Conference.API.Controllers |
| 10 | `ActivitiesController` | class | MMCA.ADC.Conference.API.Controllers |
| 10 | `ConferenceModuleSeeder` | class | MMCA.ADC.Conference.API |
| 10 | `EventsController` | class | MMCA.ADC.Conference.API.Controllers |
| 10 | `SessionBookmarksGrpcService` | class | MMCA.ADC.Conference.Service.Grpc |
| 10 | `SessionBookmarkValidationServiceGrpcAdapter` | class | MMCA.ADC.Conference.Contracts |
| 10 | `SessionCategoryItemsController` | class | MMCA.ADC.Conference.API.Controllers |
| 10 | `SessionQuestionAnswersController` | class | MMCA.ADC.Conference.API.Controllers |
| 10 | `SessionsController` | class | MMCA.ADC.Conference.API.Controllers |
| 10 | `SessionSpeakersController` | class | MMCA.ADC.Conference.API.Controllers |
| 10 | `SponsorsController` | class | MMCA.ADC.Conference.API.Controllers |
| 11 | `EventLiveValidationGrpcService` | class | MMCA.ADC.Conference.Service.Grpc |
| 11 | `EventLiveValidationServiceGrpcAdapter` | class | MMCA.ADC.Conference.Contracts |
| 12 | `DependencyInjection` | class | MMCA.ADC.Conference.Contracts |

### G21 - ADC Conference - UI

> `group-21-conference-ui.md` | 146 types | The Conference Blazor pages (events, sessions, speakers, categories, questions, rooms, feedback, public, session-selection) and their UI services.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `ADCEventInfo` | record | MMCA.ADC.Conference.UI.Pages.Home |
| 0 | `CategoryItemInfo` | record | MMCA.ADC.Conference.UI.Services |
| 0 | `ChildEntityDeletePath` | class | MMCA.ADC.Conference.UI.Services |
| 0 | `ConferenceRoutePaths` | class | MMCA.ADC.Conference.UI |
| 0 | `ConferenceTrackInfo` | record | MMCA.ADC.Conference.UI.Pages.Home |
| 0 | `DetailPageBase` | class | MMCA.ADC.Conference.UI.Pages.Common |
| 0 | `EventInfo` | record | MMCA.ADC.Conference.UI.Services |
| 0 | `EventPhase` | enum | MMCA.ADC.Conference.UI.Pages.Home |
| 0 | `KeynoteSpeakerInfo` | record | MMCA.ADC.Conference.UI.Pages.Home |
| 0 | `PreConferenceWorkshopInfo` | record | MMCA.ADC.Conference.UI.Pages.Home |
| 0 | `PublicSessionListFilterState` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 0 | `ScorePollSignal` | enum | MMCA.ADC.Conference.UI.Pages.SessionSelection |
| 0 | `SessionSchedulePageRequest` | record | MMCA.ADC.Conference.UI.Services |
| 0 | `SessionSelectionDisplay` | class | MMCA.ADC.Conference.UI.Pages.SessionSelection |
| 0 | `SpeakerInfo` | record | MMCA.ADC.Conference.UI.Services |
| 1 | `ADCCollectionResult` | record | MMCA.ADC.Conference.UI.Pages.Home |
| 1 | `ADCHomeContent` | class | MMCA.ADC.Conference.UI.Pages.Home |
| 1 | `ADCSponsorInfo` | record | MMCA.ADC.Conference.UI.Pages.Home |
| 1 | `ScorePollTracker` | class | MMCA.ADC.Conference.UI.Pages.SessionSelection |
| 1 | `SpeakerDetailLookups` | record | MMCA.ADC.Conference.UI.Services |
| 1 | `SpeakerQr` | class | MMCA.ADC.Conference.UI.Pages.Speaker |
| 2 | `ActivityFormModel` | class | MMCA.ADC.Conference.UI.Pages.Activity |
| 2 | `ADCSponsorCollectionResult` | record | MMCA.ADC.Conference.UI.Pages.Home |
| 2 | `ConferenceCategoryItemEditModel` | class | MMCA.ADC.Conference.UI.Pages.ConferenceCategory |
| 2 | `QuestionFormModel` | class | MMCA.ADC.Conference.UI.Pages.Question |
| 2 | `RoomFormModel` | class | MMCA.ADC.Conference.UI.Pages.Room |
| 2 | `SponsorFormModel` | class | MMCA.ADC.Conference.UI.Pages.Sponsor |
| 3 | `ActivityCreateModel` | class | MMCA.ADC.Conference.UI.Pages.Activity |
| 3 | `ActivityEditModel` | class | MMCA.ADC.Conference.UI.Pages.Activity |
| 3 | `ConferenceCategoryFormModel` | class | MMCA.ADC.Conference.UI.Pages.ConferenceCategory |
| 3 | `ConferenceUIModule` | class | MMCA.ADC.Conference.UI |
| 3 | `EventFormModel` | class | MMCA.ADC.Conference.UI.Pages.Event |
| 3 | `ICategoryItemLookupService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `IEventLookupService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `IEventSpeakerUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `IOrganizerEventFeedbackUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `IOrganizerSessionFeedbackUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `IPublicSessionScheduleService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `ISessionCategoryItemUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `ISessionSpeakerUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `ISpeakerCategoryItemUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `ISpeakerDashboardUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `ISpeakerDetailLookupService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `ISpeakerLookupService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `PublicScheduleRoomOptions` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 3 | `PublicSessionListFilterBar` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 3 | `QuestionCreateModel` | class | MMCA.ADC.Conference.UI.Pages.Question |
| 3 | `QuestionEditModel` | class | MMCA.ADC.Conference.UI.Pages.Question |
| 3 | `RoomCreateModel` | class | MMCA.ADC.Conference.UI.Pages.Room |
| 3 | `RoomEditModel` | class | MMCA.ADC.Conference.UI.Pages.Room |
| 3 | `SessionFormModel` | class | MMCA.ADC.Conference.UI.Pages.Session |
| 3 | `SessionizeRefreshOutcome` | record | MMCA.ADC.Conference.UI.Services |
| 3 | `SpeakerFormModel` | class | MMCA.ADC.Conference.UI.Pages.Speaker |
| 3 | `SponsorCreateModel` | class | MMCA.ADC.Conference.UI.Pages.Sponsor |
| 3 | `SponsorEditModel` | class | MMCA.ADC.Conference.UI.Pages.Sponsor |
| 4 | `CategoryItemLookupService` | class | MMCA.ADC.Conference.UI.Services |
| 4 | `ConferenceCategoryCreateModel` | class | MMCA.ADC.Conference.UI.Pages.ConferenceCategory |
| 4 | `ConferenceCategoryEditModel` | class | MMCA.ADC.Conference.UI.Pages.ConferenceCategory |
| 4 | `EventCreateModel` | class | MMCA.ADC.Conference.UI.Pages.Event |
| 4 | `EventEditModel` | class | MMCA.ADC.Conference.UI.Pages.Event |
| 4 | `EventLookupService` | class | MMCA.ADC.Conference.UI.Services |
| 4 | `IActivityUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 4 | `ICategoryItemUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 4 | `IConferenceCategoryUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 4 | `IEventUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 4 | `IQuestionUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 4 | `IRoomUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 4 | `ISessionSelectionUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 4 | `ISessionUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 4 | `ISpeakerUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 4 | `ISponsorUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 4 | `OrganizerEventFeedbackService` | class | MMCA.ADC.Conference.UI.Services |
| 4 | `OrganizerSessionFeedbackService` | class | MMCA.ADC.Conference.UI.Services |
| 4 | `ScorePollHost` | record | MMCA.ADC.Conference.UI.Pages.SessionSelection |
| 4 | `SessionCreateModel` | class | MMCA.ADC.Conference.UI.Pages.Session |
| 4 | `SessionEditModel` | class | MMCA.ADC.Conference.UI.Pages.Session |
| 4 | `SessionSelectionAiScores` | class | MMCA.ADC.Conference.UI.Pages.SessionSelection |
| 4 | `SessionSelectionFilterOptions` | record | MMCA.ADC.Conference.UI.Pages.SessionSelection |
| 4 | `SpeakerDashboardService` | class | MMCA.ADC.Conference.UI.Services |
| 4 | `SpeakerLookupService` | class | MMCA.ADC.Conference.UI.Services |
| 4 | `SpeakerUserSearch` | class | MMCA.ADC.Conference.UI.Pages.Speaker |
| 5 | `ActivityService` | class | MMCA.ADC.Conference.UI.Services |
| 5 | `CategoryItemService` | class | MMCA.ADC.Conference.UI.Services |
| 5 | `ConferenceCategoryCreate` | class | MMCA.ADC.Conference.UI.Pages.ConferenceCategory |
| 5 | `ConferenceCategoryDetail` | class | MMCA.ADC.Conference.UI.Pages.ConferenceCategory |
| 5 | `ConferenceCategoryList` | class | MMCA.ADC.Conference.UI.Pages.ConferenceCategory |
| 5 | `ConferenceCategoryService` | class | MMCA.ADC.Conference.UI.Services |
| 5 | `EventService` | class | MMCA.ADC.Conference.UI.Services |
| 5 | `EventSpeakerService` | class | MMCA.ADC.Conference.UI.Services |
| 5 | `FeedbackQuestionLoader` | class | MMCA.ADC.Conference.UI.Pages.Feedback |
| 5 | `PublicSessionListView` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 5 | `PublicSessionScheduleService` | class | MMCA.ADC.Conference.UI.Services |
| 5 | `QuestionService` | class | MMCA.ADC.Conference.UI.Services |
| 5 | `RoomService` | class | MMCA.ADC.Conference.UI.Services |
| 5 | `ScorePollSession` | class | MMCA.ADC.Conference.UI.Pages.SessionSelection |
| 5 | `SessionCategoryItemService` | class | MMCA.ADC.Conference.UI.Services |
| 5 | `SessionLookups` | class | MMCA.ADC.Conference.UI.Pages.Session |
| 5 | `SessionSelectionFilters` | class | MMCA.ADC.Conference.UI.Pages.SessionSelection |
| 5 | `SessionSelectionService` | class | MMCA.ADC.Conference.UI.Services |
| 5 | `SessionService` | class | MMCA.ADC.Conference.UI.Services |
| 5 | `SessionSpeakerService` | class | MMCA.ADC.Conference.UI.Services |
| 5 | `SpeakerCategoryItemService` | class | MMCA.ADC.Conference.UI.Services |
| 5 | `SpeakerCreateModel` | class | MMCA.ADC.Conference.UI.Pages.Speaker |
| 5 | `SpeakerDetailLookupService` | class | MMCA.ADC.Conference.UI.Services |
| 5 | `SpeakerEditModel` | class | MMCA.ADC.Conference.UI.Pages.Speaker |
| 5 | `SpeakerService` | class | MMCA.ADC.Conference.UI.Services |
| 5 | `SponsorService` | class | MMCA.ADC.Conference.UI.Services |
| 6 | `ConferenceCategoryItemsPanel` | class | MMCA.ADC.Conference.UI.Pages.ConferenceCategory |
| 6 | `DependencyInjection` | class | MMCA.ADC.Conference.UI |
| 6 | `EventCreate` | class | MMCA.ADC.Conference.UI.Pages.Event |
| 6 | `EventList` | class | MMCA.ADC.Conference.UI.Pages.Event |
| 6 | `OrganizerEventFeedback` | class | MMCA.ADC.Conference.UI.Pages.Feedback |
| 6 | `OrganizerSessionFeedback` | class | MMCA.ADC.Conference.UI.Pages.Feedback |
| 6 | `QuestionCreate` | class | MMCA.ADC.Conference.UI.Pages.Question |
| 6 | `QuestionList` | class | MMCA.ADC.Conference.UI.Pages.Question |
| 6 | `RoomCreate` | class | MMCA.ADC.Conference.UI.Pages.Room |
| 6 | `SessionCreate` | class | MMCA.ADC.Conference.UI.Pages.Session |
| 6 | `SpeakerCreate` | class | MMCA.ADC.Conference.UI.Pages.Speaker |
| 7 | `SessionSelectionSpeakerOverlap` | class | MMCA.ADC.Conference.UI.Pages.SessionSelection |
| 8 | `EventDetail` | class | MMCA.ADC.Conference.UI.Pages.Event |
| 8 | `PublicEventDetail` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 8 | `QuestionDetail` | class | MMCA.ADC.Conference.UI.Pages.Question |
| 8 | `RoomDetail` | class | MMCA.ADC.Conference.UI.Pages.Room |
| 8 | `SpeakerCategoryItemsPanel` | class | MMCA.ADC.Conference.UI.Pages.Speaker |
| 8 | `SpeakerDetail` | class | MMCA.ADC.Conference.UI.Pages.Speaker |
| 9 | `ActivityCreate` | class | MMCA.ADC.Conference.UI.Pages.Activity |
| 9 | `ActivityDetail` | class | MMCA.ADC.Conference.UI.Pages.Activity |
| 9 | `ADCHome` | class | MMCA.ADC.Conference.UI.Pages.Home |
| 9 | `EventFilteredListPageBase<TDto>` | class | MMCA.ADC.Conference.UI.Pages.Common |
| 9 | `PublicActivityList` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 9 | `PublicEventList` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 9 | `PublicSessionDetail` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 9 | `PublicSponsorList` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 9 | `SessionDetail` | class | MMCA.ADC.Conference.UI.Pages.Session |
| 9 | `SessionSelectionDashboard` | class | MMCA.ADC.Conference.UI.Pages.SessionSelection |
| 9 | `SpeakerDashboard` | class | MMCA.ADC.Conference.UI.Pages.Speaker |
| 9 | `SponsorCreate` | class | MMCA.ADC.Conference.UI.Pages.Sponsor |
| 9 | `SponsorDetail` | class | MMCA.ADC.Conference.UI.Pages.Sponsor |
| 10 | `ActivityList` | class | MMCA.ADC.Conference.UI.Pages.Activity |
| 10 | `PublicSessionList` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 10 | `PublicSpeakerDetail` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 10 | `PublicSpeakerList` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 10 | `RoomList` | class | MMCA.ADC.Conference.UI.Pages.Room |
| 10 | `SessionList` | class | MMCA.ADC.Conference.UI.Pages.Session |
| 10 | `SpeakerList` | class | MMCA.ADC.Conference.UI.Pages.Speaker |
| 10 | `SponsorList` | class | MMCA.ADC.Conference.UI.Pages.Sponsor |

### G22 - ADC Engagement Module (Session Bookmarks)

> `group-22-engagement-module.md` | 179 types | The Engagement bounded context end-to-end: bookmark aggregate, use cases, persistence, API/contracts/service, and feedback UI.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AssemblyReference` | class | MMCA.ADC.Engagement.Infrastructure |
| 0 | `AssemblyReference` | class | MMCA.ADC.Engagement.Domain |
| 0 | `AssemblyReference` | class | MMCA.ADC.Engagement.Application |
| 0 | `AssemblyReference` | class | MMCA.ADC.Engagement.API |
| 0 | `AttendeeRow` | record | MMCA.ADC.Engagement.UI.Services |
| 0 | `AttendeeSearchField` | enum | MMCA.ADC.Engagement.UI.Services |
| 0 | `BadgePayload` | class | MMCA.ADC.Engagement.Shared.CheckIns |
| 0 | `CheckInErrorCodes` | class | MMCA.ADC.Engagement.UI.Services |
| 0 | `CheckInResultDTO` | record | MMCA.ADC.Engagement.Shared.CheckIns |
| 0 | `CheckInScope` | enum | MMCA.ADC.Engagement.Shared.CheckIns |
| 0 | `CheckInSettings` | class | MMCA.ADC.Engagement.Shared.CheckIns |
| 0 | `CheckInState` | enum | MMCA.ADC.Engagement.UI.Pages.Rooms |
| 0 | `ClassReference` | class | MMCA.ADC.Engagement.Application |
| 0 | `ClassReference` | class | MMCA.ADC.Engagement.Domain |
| 0 | `ClassReference` | class | MMCA.ADC.Engagement.Infrastructure |
| 0 | `ClassReference` | class | MMCA.ADC.Engagement.API |
| 0 | `CreateBookmarkRequest` | record | MMCA.ADC.Engagement.Shared.UserSessionBookmarks |
| 0 | `EngagementErrorResources` | class | MMCA.ADC.Engagement.API.Resources |
| 0 | `EngagementFeatures` | class | MMCA.ADC.Engagement.Shared |
| 0 | `EngagementPermissions` | class | MMCA.ADC.Engagement.Shared.Authorization |
| 0 | `EngagementRoutePaths` | class | MMCA.ADC.Engagement.UI |
| 0 | `FeedbackAnswerModel` | class | MMCA.ADC.Engagement.UI.Pages.Feedback |
| 0 | `GetAttendanceStatsQuery` | record | MMCA.ADC.Engagement.Application.CheckIns.UseCases.GetAttendanceStats |
| 0 | `GetBookmarkedSessionIdsQuery` | record | MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetBookmarkedSessionIds |
| 0 | `GetLeaderboardQuery` | record | MMCA.ADC.Engagement.Application.Points.UseCases.GetLeaderboard |
| 0 | `GetMyPointsQuery` | record | MMCA.ADC.Engagement.Application.Points.UseCases.GetMyPoints |
| 0 | `GetOrCreateMyBadgeCommand` | record | MMCA.ADC.Engagement.Application.CheckIns.UseCases.GetOrCreateMyBadge |
| 0 | `GetPointsOverviewQuery` | record | MMCA.ADC.Engagement.Application.Points.UseCases.GetPointsOverview |
| 0 | `GetUserBookmarksQuery` | record | MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetUserBookmarks |
| 0 | `IBookmarkCountService` | interface | MMCA.ADC.Engagement.Shared.UserSessionBookmarks |
| 0 | `LeaderboardEntryDTO` | record | MMCA.ADC.Engagement.Shared.Points |
| 0 | `LiveChannelPublishWorkItem` | record | MMCA.ADC.Engagement.Application.Live |
| 0 | `MyBadgeDTO` | record | MMCA.ADC.Engagement.Shared.CheckIns |
| 0 | `NowNextSessionInfo` | record | MMCA.ADC.Engagement.UI.Services |
| 0 | `OptInRow` | record | MMCA.ADC.Engagement.Application.Points.UseCases.GetLeaderboard |
| 0 | `PointsActivityType` | enum | MMCA.ADC.Engagement.Shared.Points |
| 0 | `RecordedCheckIn` | record struct | MMCA.ADC.Engagement.Application.CheckIns.Services |
| 0 | `RoomCheckInRequest` | record | MMCA.ADC.Engagement.Shared.CheckIns |
| 0 | `RoomCheckInResultDTO` | record | MMCA.ADC.Engagement.Shared.CheckIns |
| 0 | `ScanOutcomeKind` | enum | MMCA.ADC.Engagement.UI.Pages.CheckIn |
| 0 | `SelfCheckInOutcome<TResult>` | record | MMCA.ADC.Engagement.UI.Services |
| 0 | `SessionAttendanceDTO` | record | MMCA.ADC.Engagement.Shared.CheckIns |
| 0 | `SessionAttendanceRow` | record | MMCA.ADC.Engagement.UI.Pages.CheckIn |
| 0 | `SessionReminder` | record | MMCA.ADC.Engagement.UI.Services |
| 0 | `SetLeaderboardParticipationRequest` | record | MMCA.ADC.Engagement.Shared.Points |
| 0 | `SponsorVisitRequest` | record | MMCA.ADC.Engagement.Shared.CheckIns |
| 0 | `SponsorVisitResultDTO` | record | MMCA.ADC.Engagement.Shared.CheckIns |
| 0 | `UserEngagementBookmarkExportDTO` | record | MMCA.ADC.Engagement.Shared.Exports |
| 0 | `UserEngagementSubmittedQuestionExportDTO` | record | MMCA.ADC.Engagement.Shared.Exports |
| 0 | `VisitState` | enum | MMCA.ADC.Engagement.UI.Pages.Sponsors |
| 1 | `AttendanceStatsDTO` | record | MMCA.ADC.Engagement.Shared.CheckIns |
| 1 | `CheckInAttendeeRequest` | record | MMCA.ADC.Engagement.Shared.CheckIns |
| 1 | `CheckInDTO` | record | MMCA.ADC.Engagement.Shared.CheckIns |
| 1 | `CreateBookmarkRequestValidator` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.Create |
| 1 | `DependencyInjection` | class | MMCA.ADC.Engagement.API |
| 1 | `DisabledBookmarkCountService` | class | MMCA.ADC.Engagement.Shared.UserSessionBookmarks |
| 1 | `ILiveChannelPublishQueue` | interface | MMCA.ADC.Engagement.Application.Live |
| 1 | `ManualCheckInRequest` | record | MMCA.ADC.Engagement.Shared.CheckIns |
| 1 | `NowNextSnapshot` | record | MMCA.ADC.Engagement.UI.Services |
| 1 | `OverviewRow` | record | MMCA.ADC.Engagement.Application.Points.UseCases.GetPointsOverview |
| 1 | `PointsActivityTotalDTO` | record | MMCA.ADC.Engagement.Shared.Points |
| 1 | `PointsEntryDTO` | record | MMCA.ADC.Engagement.Shared.Points |
| 1 | `PointsSubjectKeys` | class | MMCA.ADC.Engagement.Shared.Points |
| 1 | `RoomCheckInRequestValidator` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.RecordRoomCheckIn |
| 1 | `ScanOutcome` | record | MMCA.ADC.Engagement.UI.Pages.CheckIn |
| 1 | `SessionReminderPlanner` | class | MMCA.ADC.Engagement.UI.Services |
| 1 | `SponsorVisitRequestValidator` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.RecordSponsorVisit |
| 1 | `UserEngagementCheckInExportDTO` | record | MMCA.ADC.Engagement.Shared.Exports |
| 1 | `UserEngagementPointsEntryExportDTO` | record | MMCA.ADC.Engagement.Shared.Exports |
| 1 | `UserSessionBookmarkDTO` | record | MMCA.ADC.Engagement.Shared.UserSessionBookmarks |
| 2 | `CheckInAttendeeRequestValidator` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.CheckInAttendee |
| 2 | `CurrentEventNotificationScopeProvider` | class | MMCA.ADC.Engagement.UI.Services |
| 2 | `LeaderboardOptInChanged` | record | MMCA.ADC.Engagement.Domain.Points.DomainEvents |
| 2 | `LiveBroadcastPatch` | class | MMCA.ADC.Engagement.UI.Services |
| 2 | `LiveChannelPublishQueue` | class | MMCA.ADC.Engagement.Application.Live |
| 2 | `ManualCheckInRequestValidator` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.ManualCheckIn |
| 2 | `MyPointsDTO` | record | MMCA.ADC.Engagement.Shared.Points |
| 2 | `PointsEntryChanged` | record | MMCA.ADC.Engagement.Domain.Points.DomainEvents |
| 2 | `PointsOverviewDTO` | record | MMCA.ADC.Engagement.Shared.Points |
| 2 | `SelfHttpWarmupTask` | class | MMCA.ADC.Engagement.Service |
| 2 | `UserEngagementExportDTO` | record | MMCA.ADC.Engagement.Shared.Exports |
| 2 | `UserSessionBookmarkChanged` | record | MMCA.ADC.Engagement.Domain.UserSessionBookmarks.DomainEvents |
| 3 | `AttendeeCheckedIn` | record | MMCA.ADC.Engagement.Shared.CheckIns.IntegrationEvents |
| 3 | `IBookmarkUIService` | interface | MMCA.ADC.Engagement.UI.Services |
| 3 | `ICheckInUIService` | interface | MMCA.ADC.Engagement.UI.Services |
| 3 | `IEventFeedbackUIService` | interface | MMCA.ADC.Engagement.UI.Services |
| 3 | `INowNextService` | interface | MMCA.ADC.Engagement.UI.Services |
| 3 | `IPointsAwarder` | interface | MMCA.ADC.Engagement.Application.Points.Services |
| 3 | `IPointsUIService` | interface | MMCA.ADC.Engagement.UI.Services |
| 3 | `IQuestionLookupService` | interface | MMCA.ADC.Engagement.UI.Services |
| 3 | `ISessionBookmarkUIService` | interface | MMCA.ADC.Engagement.Shared.UserSessionBookmarks |
| 3 | `ISessionFeedbackUIService` | interface | MMCA.ADC.Engagement.UI.Services |
| 3 | `IUserEngagementExportService` | interface | MMCA.ADC.Engagement.Shared.Exports |
| 3 | `LiveChannelPublishProcessor` | class | MMCA.ADC.Engagement.Infrastructure.Live |
| 3 | `LiveChannelSubscription` | class | MMCA.ADC.Engagement.UI.Services |
| 4 | `BookmarkService` | class | MMCA.ADC.Engagement.UI.Services |
| 4 | `CheckInService` | class | MMCA.ADC.Engagement.UI.Services |
| 4 | `DependencyInjection` | class | MMCA.ADC.Engagement.Infrastructure |
| 4 | `DisabledUserEngagementExportService` | class | MMCA.ADC.Engagement.Shared.Exports |
| 4 | `EventFeedbackService` | class | MMCA.ADC.Engagement.UI.Services |
| 4 | `EventFeedbackSubmittedPointsHandler` | class | MMCA.ADC.Engagement.Application.Points.IntegrationEventHandlers |
| 4 | `NowNextService` | class | MMCA.ADC.Engagement.UI.Services |
| 4 | `PointsService` | class | MMCA.ADC.Engagement.UI.Services |
| 4 | `QuestionLookupService` | class | MMCA.ADC.Engagement.UI.Services |
| 4 | `SessionFeedbackService` | class | MMCA.ADC.Engagement.UI.Services |
| 4 | `SessionFeedbackSubmittedPointsHandler` | class | MMCA.ADC.Engagement.Application.Points.IntegrationEventHandlers |
| 4 | `SessionQuestionSubmittedPointsHandler` | class | MMCA.ADC.Engagement.Application.Points.DomainEventHandlers |
| 4 | `SessionReminderCoordinator` | class | MMCA.ADC.Engagement.UI.Services |
| 4 | `UserSessionBookmarkCacheEvictionHandler` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.DomainEventHandlers |
| 5 | `AttendeeSummary` | record | MMCA.ADC.Engagement.UI.Services |
| 5 | `CheckInsController` | class | MMCA.ADC.Engagement.API.Controllers |
| 5 | `EngagementModule` | class | MMCA.ADC.Engagement.API |
| 5 | `MyBadge` | class | MMCA.ADC.Engagement.UI.Pages.CheckIn |
| 5 | `MyPoints` | class | MMCA.ADC.Engagement.UI.Pages.Points |
| 5 | `OrganizerPointsOverview` | class | MMCA.ADC.Engagement.UI.Pages.Points |
| 5 | `PointsController` | class | MMCA.ADC.Engagement.API.Controllers |
| 5 | `RoomCheckIn` | class | MMCA.ADC.Engagement.UI.Pages.Rooms |
| 5 | `SessionBookmarkUIService` | class | MMCA.ADC.Engagement.UI.Services |
| 5 | `SponsorVisit` | class | MMCA.ADC.Engagement.UI.Pages.Sponsors |
| 6 | `AttendeeBadgeInvariants` | class | MMCA.ADC.Engagement.Domain.Badges |
| 6 | `CheckInInvariants` | class | MMCA.ADC.Engagement.Domain.CheckIns |
| 6 | `IAttendeeLookupService` | interface | MMCA.ADC.Engagement.UI.Services |
| 6 | `LeaderboardOptIn` | class | MMCA.ADC.Engagement.Domain.Points |
| 6 | `LeaderboardOptInInvariants` | class | MMCA.ADC.Engagement.Domain.Points |
| 6 | `PointsEntryInvariants` | class | MMCA.ADC.Engagement.Domain.Points |
| 6 | `SessionFeedback` | class | MMCA.ADC.Engagement.UI.Pages.Feedback |
| 6 | `UserSessionBookmarkInvariants` | class | MMCA.ADC.Engagement.Domain.UserSessionBookmarks |
| 7 | `AttendeeBadge` | class | MMCA.ADC.Engagement.Domain.Badges |
| 7 | `AttendeeLookupService` | class | MMCA.ADC.Engagement.UI.Services |
| 7 | `AttendeeSearchPanel` | class | MMCA.ADC.Engagement.UI.Pages.CheckIn |
| 7 | `PointsEntry` | class | MMCA.ADC.Engagement.Domain.Points |
| 7 | `UserSessionBookmark` | class | MMCA.ADC.Engagement.Domain.UserSessionBookmarks |
| 8 | `AttendeeBadgeConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration |
| 8 | `BookmarkCountService` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.Services |
| 8 | `EventFeedback` | class | MMCA.ADC.Engagement.UI.Pages.Feedback |
| 8 | `GetBookmarkedSessionIdsHandler` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetBookmarkedSessionIds |
| 8 | `GetPointsOverviewHandler` | class | MMCA.ADC.Engagement.Application.Points.UseCases.GetPointsOverview |
| 8 | `IBookmarkManagementDomainService` | interface | MMCA.ADC.Engagement.Domain.Services |
| 8 | `LeaderboardOptInConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration |
| 8 | `PointsEntryConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration |
| 8 | `SessionQuestionConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration |
| 8 | `SessionQuestionUpvoteConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration |
| 8 | `UserDeletedPointsHandler` | class | MMCA.ADC.Engagement.Application.Points.IntegrationEventHandlers |
| 8 | `UserSessionBookmarkConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration |
| 8 | `UserSessionBookmarkDTOMapper` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.DTOs |
| 9 | `BookmarkCountServiceGrpcAdapter` | class | MMCA.ADC.Engagement.Contracts |
| 9 | `BookmarkCountsGrpcService` | class | MMCA.ADC.Engagement.Service.Grpc |
| 9 | `BookmarkManagementDomainService` | class | MMCA.ADC.Engagement.Domain.Services |
| 9 | `CheckInScopeNames` | class | MMCA.ADC.Engagement.Shared.CheckIns |
| 9 | `CreateBookmarkHandler` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.Create |
| 9 | `GetMyPointsHandler` | class | MMCA.ADC.Engagement.Application.Points.UseCases.GetMyPoints |
| 9 | `GetOrCreateMyBadgeHandler` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.GetOrCreateMyBadge |
| 9 | `GetUserBookmarksHandler` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetUserBookmarks |
| 9 | `PointsSettings` | class | MMCA.ADC.Engagement.Shared.Points |
| 9 | `SetLeaderboardParticipationHandler` | class | MMCA.ADC.Engagement.Application.Points.UseCases.SetLeaderboardParticipation |
| 10 | `AttendeeCheckedInPointsHandler` | class | MMCA.ADC.Engagement.Application.Points.IntegrationEventHandlers |
| 10 | `CheckIn` | class | MMCA.ADC.Engagement.Domain.CheckIns |
| 10 | `CheckInScan` | class | MMCA.ADC.Engagement.UI.Pages.CheckIn |
| 10 | `GetLeaderboardHandler` | class | MMCA.ADC.Engagement.Application.Points.UseCases.GetLeaderboard |
| 10 | `LiveEventListener` | class | MMCA.ADC.Engagement.UI.Components |
| 10 | `OrganizerAttendance` | class | MMCA.ADC.Engagement.UI.Pages.CheckIn |
| 10 | `PointsAwarder` | class | MMCA.ADC.Engagement.Application.Points.Services |
| 11 | `BookmarksController` | class | MMCA.ADC.Engagement.API.Controllers |
| 11 | `CheckInConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration |
| 11 | `CheckInDTOMapper` | class | MMCA.ADC.Engagement.Application.CheckIns.DTOs |
| 11 | `CheckInProcessor` | class | MMCA.ADC.Engagement.Application.CheckIns.Services |
| 11 | `EngagementUIModule` | class | MMCA.ADC.Engagement.UI |
| 11 | `GetAttendanceStatsHandler` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.GetAttendanceStats |
| 11 | `UserEngagementExportService` | class | MMCA.ADC.Engagement.Application.Exports |
| 12 | `CheckInAttendeeHandler` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.CheckInAttendee |
| 12 | `DependencyInjection` | class | MMCA.ADC.Engagement.Application |
| 12 | `DependencyInjection` | class | MMCA.ADC.Engagement.UI |
| 12 | `ManualCheckInHandler` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.ManualCheckIn |
| 12 | `ModuleApplicationDbContext` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.DbContexts |
| 12 | `RecordRoomCheckInHandler` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.RecordRoomCheckIn |
| 12 | `RecordSponsorVisitHandler` | class | MMCA.ADC.Engagement.Application.CheckIns.UseCases.RecordSponsorVisit |
| 12 | `UserEngagementExportGrpcService` | class | MMCA.ADC.Engagement.Service.Grpc |
| 12 | `UserEngagementExportServiceGrpcAdapter` | class | MMCA.ADC.Engagement.Contracts |
| 13 | `DependencyInjection` | class | MMCA.ADC.Engagement.Contracts |

### G26 - ADC Engagement Live Layer (Real-Time Polls & Session Q&A)

> `group-23-engagement-live-layer.md` | 99 types | Real-time audience interaction in the Engagement bounded context: event-wide live polls with voting and moderated per-session Q&A with upvoting, over the SignalR hub-channel transport ([ADR-039](https://ivanball.github.io/docs/adr/039-live-channel-push.html)) and the cross-service gRPC live-channel adapter.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `CastVoteCommand` | record | MMCA.ADC.Engagement.Application.LivePolls.UseCases.CastVote |
| 0 | `CastVoteRequest` | record | MMCA.ADC.Engagement.Shared.LivePolls |
| 0 | `CloseLivePollCommand` | record | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Close |
| 0 | `CreateLivePollRequest` | record | MMCA.ADC.Engagement.Shared.LivePolls |
| 0 | `GetEventPollsQuery` | record | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetEventPolls |
| 0 | `GetModerationQueueQuery` | record | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetModerationQueue |
| 0 | `GetOpenPollsQuery` | record | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetOpenPolls |
| 0 | `GetPollResultsQuery` | record | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetPollResults |
| 0 | `GetSessionManagePollsQuery` | record | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetSessionManagePolls |
| 0 | `GetSessionQuestionsQuery` | record | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetSessionQuestions |
| 0 | `ISessionLiveUIService` | interface | MMCA.ADC.Engagement.Shared.SessionQuestions |
| 0 | `LiveEventContext` | record | MMCA.ADC.Engagement.UI.Services |
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
| 0 | `SessionInfo` | record | MMCA.ADC.Engagement.UI.Services |
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
| 1 | `ILiveEventUIService` | interface | MMCA.ADC.Engagement.UI.Services |
| 1 | `LivePollChannel` | class | MMCA.ADC.Engagement.Shared.LivePolls |
| 1 | `LivePollDTO` | record | MMCA.ADC.Engagement.Shared.LivePolls |
| 1 | `LivePollResultsDTO` | record | MMCA.ADC.Engagement.Shared.LivePolls |
| 1 | `ModerateQuestionCommand` | record | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Moderate |
| 1 | `SessionLiveUIService` | class | MMCA.ADC.Engagement.UI.Services |
| 1 | `SessionQuestionDTO` | record | MMCA.ADC.Engagement.Shared.SessionQuestions |
| 1 | `ToggleUpvoteCommandValidator` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote |
| 2 | `LivePollChanged` | record | MMCA.ADC.Engagement.Domain.LivePolls.DomainEvents |
| 2 | `LivePollVoteChanged` | record | MMCA.ADC.Engagement.Domain.LivePolls.DomainEvents |
| 2 | `SessionQuestionChanged` | record | MMCA.ADC.Engagement.Domain.SessionQuestions.DomainEvents |
| 2 | `SessionQuestionUpvoteChanged` | record | MMCA.ADC.Engagement.Domain.SessionQuestions.DomainEvents |
| 3 | `ILivePollUIService` | interface | MMCA.ADC.Engagement.UI.Services |
| 3 | `ISessionLookupService` | interface | MMCA.ADC.Engagement.UI.Services |
| 3 | `ISessionQuestionUIService` | interface | MMCA.ADC.Engagement.UI.Services |
| 3 | `LivePollAuthorization` | class | MMCA.ADC.Engagement.Application.LivePolls.Services |
| 4 | `LivePollUIService` | class | MMCA.ADC.Engagement.UI.Services |
| 4 | `SessionLivePollPanel` | class | MMCA.ADC.Engagement.UI.Pages.SessionLive |
| 4 | `SessionLookupService` | class | MMCA.ADC.Engagement.UI.Services |
| 4 | `SessionQuestionUIService` | class | MMCA.ADC.Engagement.UI.Services |
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
| 8 | `LivePollVoteConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration |
| 8 | `PollManagementPanel` | class | MMCA.ADC.Engagement.UI.Pages.HappeningNow |
| 8 | `SessionLiveModerationPanel` | class | MMCA.ADC.Engagement.UI.Pages.SessionLive |
| 8 | `SessionQuestionUpvoteChangedHandler` | class | MMCA.ADC.Engagement.Application.SessionQuestions.DomainEventHandlers |
| 8 | `SessionQuestionViewBuilder` | class | MMCA.ADC.Engagement.Application.SessionQuestions.Services |
| 8 | `ToggleUpvoteHandler` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote |
| 9 | `DeleteLivePollHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Delete |
| 9 | `GetModerationQueueHandler` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetModerationQueue |
| 9 | `GetSessionQuestionsHandler` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetSessionQuestions |
| 9 | `LiveEventService` | class | MMCA.ADC.Engagement.UI.Services |
| 9 | `LivePollConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration |
| 9 | `LivePollDTOMapper` | class | MMCA.ADC.Engagement.Application.LivePolls.DTOs |
| 9 | `LivePollOptionConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration |
| 9 | `LivePollResultsBuilder` | class | MMCA.ADC.Engagement.Application.LivePolls.Services |
| 9 | `LivePollsController` | class | MMCA.ADC.Engagement.API.Controllers |
| 9 | `SessionQuestionsController` | class | MMCA.ADC.Engagement.API.Controllers |
| 9 | `SubmitQuestionHandler` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Submit |
| 10 | `CastVoteHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.CastVote |
| 10 | `CloseLivePollHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Close |
| 10 | `CreateLivePollHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create |
| 10 | `GetEventPollsHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetEventPolls |
| 10 | `GetOpenPollsHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetOpenPolls |
| 10 | `GetPollResultsHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetPollResults |
| 10 | `GetSessionManagePollsHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetSessionManagePolls |
| 10 | `HappeningNow` | class | MMCA.ADC.Engagement.UI.Pages.HappeningNow |
| 10 | `LivePollNavigationPopulator` | class | MMCA.ADC.Engagement.Application.LivePolls.Services |
| 10 | `LivePollOptionNavigationPopulator` | class | MMCA.ADC.Engagement.Application.LivePolls.Services |
| 10 | `LivePollVoteChangedHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.DomainEventHandlers |
| 10 | `OpenLivePollHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Open |
| 14 | `ModerateQuestionHandler` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Moderate |

### G23 - ADC Identity Module (Users, Profiles, GDPR Export/Erasure)

> `group-24-identity-module.md` | 90 types | The Identity bounded context end-to-end: the User aggregate, change-password/delete/export use cases, persistence, API/contracts/service, and profile/user UI.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AssemblyReference` | class | MMCA.ADC.Identity.Domain |
| 0 | `AssemblyReference` | class | MMCA.ADC.Identity.API |
| 0 | `AssemblyReference` | class | MMCA.ADC.Identity.Infrastructure |
| 0 | `AssemblyReference` | class | MMCA.ADC.Identity.Application |
| 0 | `ClassReference` | class | MMCA.ADC.Identity.Infrastructure |
| 0 | `ClassReference` | class | MMCA.ADC.Identity.API |
| 0 | `ClassReference` | class | MMCA.ADC.Identity.Domain |
| 0 | `ClassReference` | class | MMCA.ADC.Identity.Application |
| 0 | `DependencyInjection` | class | MMCA.ADC.Identity.Infrastructure |
| 0 | `GetUserAvatarQuery` | record | MMCA.ADC.Identity.Application.Users.UseCases.GetUserAvatar |
| 0 | `GetUsersQuery` | record | MMCA.ADC.Identity.Application.Users.UseCases.GetUsers |
| 0 | `IAttendeeQueryService` | interface | MMCA.ADC.Identity.Shared.Users |
| 0 | `IdentityErrorResources` | class | MMCA.ADC.Identity.API.Resources |
| 0 | `IdentityPermissions` | class | MMCA.ADC.Identity.Shared.Authorization |
| 0 | `IdentityRoutePaths` | class | MMCA.ADC.Identity.UI |
| 0 | `IdentitySettings` | class | MMCA.ADC.Identity.Shared |
| 0 | `IExternalLoginEmailVerifier` | interface | MMCA.ADC.Identity.Application.Users |
| 0 | `RemoveUserAvatarCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.RemoveUserAvatar |
| 0 | `SetUserAvatarCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.SetUserAvatar |
| 0 | `UserAvatarDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 0 | `UserDataExportBookmarkDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 0 | `UserDataExportCheckInDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 0 | `UserDataExportNotificationDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 0 | `UserDataExportPointsEntryDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 0 | `UserDataExportSubjectDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 0 | `UserDataExportSubmittedQuestionDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 0 | `UserListDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 1 | `ChangePasswordRequestValidator` | class | MMCA.ADC.Identity.Application.Users.Validation |
| 1 | `DisabledAttendeeQueryService` | class | MMCA.ADC.Identity.Shared.Users |
| 1 | `ForgotPasswordCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.ForgotPassword |
| 1 | `HttpContextExternalLoginEmailVerifier` | class | MMCA.ADC.Identity.API.Authentication |
| 1 | `SetUserAvatarCommandValidator` | class | MMCA.ADC.Identity.Application.Users.UseCases.SetUserAvatar |
| 1 | `UserDataExportEngagementSectionDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 1 | `UserDataExportNotificationSectionDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 1 | `UserDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 2 | `DependencyInjection` | class | MMCA.ADC.Identity.API |
| 2 | `ExportUserDataQuery` | record | MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData |
| 2 | `IdentityModule` | class | MMCA.ADC.Identity.API |
| 2 | `SelfHttpWarmupTask` | class | MMCA.ADC.Identity.Service |
| 2 | `UserDeleted` | record | MMCA.ADC.Identity.Domain.Users.DomainEvents |
| 2 | `UserPasswordChanged` | record | MMCA.ADC.Identity.Domain.Users.DomainEvents |
| 3 | `IdentityUIModule` | class | MMCA.ADC.Identity.UI |
| 3 | `IUserUIService` | interface | MMCA.ADC.Identity.UI.Services |
| 3 | `NotificationUserDataExportSection` | class | MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData |
| 3 | `UserDeleted` | record | MMCA.ADC.Identity.Shared.Users.IntegrationEvents |
| 3 | `UserRegistered` | record | MMCA.ADC.Identity.Shared.Users.IntegrationEvents |
| 4 | `EngagementUserDataExportSection` | class | MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData |
| 4 | `UserRole` | class | MMCA.ADC.Identity.Domain.Users |
| 4 | `UserService` | class | MMCA.ADC.Identity.UI.Services |
| 5 | `DependencyInjection` | class | MMCA.ADC.Identity.UI |
| 5 | `UserClaimsController` | class | MMCA.ADC.Identity.API.Controllers |
| 5 | `UserList` | class | MMCA.ADC.Identity.UI.Pages.User |
| 6 | `Profile` | class | MMCA.ADC.Identity.UI.Pages.Profile |
| 6 | `UserInvariants` | class | MMCA.ADC.Identity.Domain.Users |
| 7 | `OAuthController` | class | MMCA.ADC.Identity.API.Controllers |
| 7 | `RegisterRequestValidator` | class | MMCA.ADC.Identity.Application.Users.Validation |
| 7 | `User` | class | MMCA.ADC.Identity.Domain.Users |
| 8 | `AttendeeQueryService` | class | MMCA.ADC.Identity.Application.Users |
| 8 | `ChangePasswordCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.ChangePassword |
| 8 | `ChangePreferencesCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences |
| 8 | `DeleteUserCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.DeleteUser |
| 8 | `GetUserAvatarHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.GetUserAvatar |
| 8 | `GetUsersHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.GetUsers |
| 8 | `ResetPasswordCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.ResetPassword |
| 8 | `SpeakerLinkedToUserHandler` | class | MMCA.ADC.Identity.Application.Speakers.IntegrationEventHandlers |
| 8 | `SpeakerUnlinkedFromUserHandler` | class | MMCA.ADC.Identity.Application.Speakers.IntegrationEventHandlers |
| 8 | `UserConfiguration` | class | MMCA.ADC.Identity.Infrastructure.Persistence.EntityConfiguration |
| 8 | `UserDTOMapper` | class | MMCA.ADC.Identity.Application.Users.DTOs |
| 9 | `AttendeeQueryServiceGrpcAdapter` | class | MMCA.ADC.Identity.Contracts |
| 9 | `AttendeesGrpcService` | class | MMCA.ADC.Identity.Service.Grpc |
| 9 | `ChangePasswordHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.ChangePassword |
| 9 | `ChangePreferencesCommandValidator` | class | MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences |
| 9 | `ChangePreferencesHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences |
| 9 | `DeleteUserHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.DeleteUser |
| 9 | `ExportUserDataHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData |
| 9 | `GetUserPreferencesHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.GetPreferences |
| 9 | `ResetPasswordHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.ResetPassword |
| 9 | `UsersController` | class | MMCA.ADC.Identity.API.Controllers |
| 10 | `DependencyInjection` | class | MMCA.ADC.Identity.Contracts |
| 11 | `UsersDataExportController` | class | MMCA.ADC.Identity.API.Controllers |
| 12 | `ModuleApplicationDbContext` | class | MMCA.ADC.Identity.Infrastructure.Persistence.DbContexts |
| 14 | `AuthenticationService` | class | MMCA.ADC.Identity.Application.Users |
| 14 | `ForgotPasswordHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.ForgotPassword |
| 15 | `DependencyInjection` | class | MMCA.ADC.Identity.Application |
| 15 | `IdentityModuleDbSeeder` | class | MMCA.ADC.Identity.Infrastructure.Persistence.DbContexts.Seeding |
| 15 | `SetUserAvatarHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.SetUserAvatar |
| 16 | `IdentityModuleSeeder` | class | MMCA.ADC.Identity.API |
| 16 | `PasswordResetController` | class | MMCA.ADC.Identity.API.Controllers |
| 16 | `RemoveUserAvatarHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.RemoveUserAvatar |
| 17 | `AuthController` | class | MMCA.ADC.Identity.API.Controllers |

### G24 - ADC Application Host, UI Shell & Cross-Module Composition

> `group-25-adc-host-composition.md` | 17 types | The ADC host: the Blazor Web/WASM/WinUI shells, host pages/services, security, and the cross-module application composition.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `NowNextSession` | record | MMCA.ADC.UI |
| 1 | `ADCHomePageContent` | class | MMCA.ADC.UI.Web.Client.Pages |
| 1 | `NowNextSnapshot` | record | MMCA.ADC.UI |
| 3 | `DeviceUIModule` | class | MMCA.ADC.UI |
| 3 | `MainPage` | class | MMCA.ADC.UI |
| 4 | `App` | class | MMCA.ADC.UI |
| 6 | `AppActionRouteMap` | class | MMCA.ADC.UI.Services |
| 7 | `AppActionsInitializer` | class | MMCA.ADC.UI.Services |
| 9 | `MainActivity` | class | MMCA.ADC.UI |
| 9 | `WebAuthenticatorCallbackActivity` | class | MMCA.ADC.UI |
| 10 | `ADCHomePageContent` | class | MMCA.ADC.UI.Pages |
| 10 | `NowNextWidgetProvider` | class | MMCA.ADC.UI |
| 11 | `MauiProgram` | class | MMCA.ADC.UI |
| 12 | `App` | class | MMCA.ADC.UI.WinUI |
| 12 | `AppDelegate` | class | MMCA.ADC.UI |
| 12 | `MainApplication` | class | MMCA.ADC.UI |
| 13 | `Program` | class | MMCA.ADC.UI |

### G27 - Device Capability Abstraction Layer (Native Contracts, MAUI, Browser & Fallback Adapters)

> `group-26-device-capability-layer.md` | 99 types | Per-capability interface contracts (biometric, geocoding/geolocation, speech, push registration, media/clipboard/screenshot, haptics, share, external auth/links, local cache/notifications, connectivity/battery/accessibility, deep links) plus their MAUI-native, browser-JS-interop, and inert fallback implementations, selected per host at DI composition time ([ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)/043/044/045).

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `BarcodeScanPage` | class | MMCA.Common.UI.Maui.Capabilities |
| 0 | `DevicePreferenceKeys` | class | MMCA.Common.UI.Services.Capabilities |
| 0 | `GeoPoint` | record | MMCA.Common.UI.Services.Capabilities |
| 0 | `IAccessibilityAnnouncer` | interface | MMCA.Common.UI.Services.Capabilities |
| 0 | `IBarcodeScannerService` | interface | MMCA.Common.UI.Services.Capabilities |
| 0 | `IBatteryStatusService` | interface | MMCA.Common.UI.Services.Capabilities |
| 0 | `IBiometricAuthenticator` | interface | MMCA.Common.UI.Services.Capabilities |
| 0 | `IClipboardService` | interface | MMCA.Common.UI.Services.Capabilities |
| 0 | `IConnectivityStatusService` | interface | MMCA.Common.UI.Services.Capabilities |
| 0 | `IDevicePreferences` | interface | MMCA.Common.UI.Services.Capabilities |
| 0 | `IExternalAuthBroker` | interface | MMCA.Common.UI.Services.Capabilities |
| 0 | `IExternalLinkService` | interface | MMCA.Common.UI.Services.Capabilities |
| 0 | `IFormFactor` | interface | MMCA.Common.UI.Services |
| 0 | `IHapticFeedbackService` | interface | MMCA.Common.UI.Services.Capabilities |
| 0 | `ILocalCacheStore` | interface | MMCA.Common.UI.Services.Capabilities |
| 0 | `IMapNavigationService` | interface | MMCA.Common.UI.Services.Capabilities |
| 0 | `IPushRegistrationService` | interface | MMCA.Common.UI.Services.Capabilities |
| 0 | `IScreenshotService` | interface | MMCA.Common.UI.Services.Capabilities |
| 0 | `IShareService` | interface | MMCA.Common.UI.Services.Capabilities |
| 0 | `ISpeechToTextService` | interface | MMCA.Common.UI.Services.Capabilities |
| 0 | `ITextToSpeechService` | interface | MMCA.Common.UI.Services.Capabilities |
| 0 | `LocalNotificationRequest` | record | MMCA.Common.UI.Services.Capabilities |
| 0 | `MauiErrorHandlingInitializer` | class | MMCA.Common.UI.Maui |
| 0 | `PickedMedia` | class | MMCA.Common.UI.Services.Capabilities |
| 0 | `PushDeviceToken` | record | MMCA.Common.UI.Services.Capabilities |
| 1 | `AlwaysOnlineConnectivityStatusService` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `BrowserMapNavigationService` | class | MMCA.Common.UI.Services.Capabilities.Browser |
| 1 | `CapabilitiesJsModule` | class | MMCA.Common.UI.Services.Capabilities.Browser |
| 1 | `DeepLinkRouteEventArgs` | class | MMCA.Common.UI.Services.Capabilities |
| 1 | `IGeocodingService` | interface | MMCA.Common.UI.Services.Capabilities |
| 1 | `IGeolocationService` | interface | MMCA.Common.UI.Services.Capabilities |
| 1 | `ILocalNotificationService` | interface | MMCA.Common.UI.Services.Capabilities |
| 1 | `IMediaPickerService` | interface | MMCA.Common.UI.Services.Capabilities |
| 1 | `InMemoryDevicePreferences` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `IPushDeviceTokenProvider` | interface | MMCA.Common.UI.Services.Capabilities |
| 1 | `MauiAccessibilityAnnouncer` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiBarcodeScannerService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiBatteryStatusService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiBiometricAuthenticator` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiClipboardService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiConnectivityStatusService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiCultureStore` | class | MMCA.Common.UI.Maui.Globalization |
| 1 | `MauiDevicePreferences` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiExternalLinkService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiFormFactor` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiHapticFeedbackService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiLocalCacheStore` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiMapNavigationService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiPublicLinkBuilder` | class | MMCA.Common.UI.Maui.Services |
| 1 | `MauiScreenshotService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiSecureTokenStore` | class | MMCA.Common.UI.Maui.Services |
| 1 | `MauiShareService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiSpeechToTextService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiTextToSpeechService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiTokenStorageService` | class | MMCA.Common.UI.Maui.Services |
| 1 | `NullAccessibilityAnnouncer` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `NullBarcodeScannerService` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `NullBatteryStatusService` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `NullBiometricAuthenticator` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `NullClipboardService` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `NullExternalLinkService` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `NullHapticFeedbackService` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `NullLocalCacheStore` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `NullMapNavigationService` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `NullPushRegistrationService` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `NullScreenshotService` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `NullShareService` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `NullSpeechToTextService` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `NullTextToSpeechService` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `UnavailableExternalAuthBroker` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `WasmFormFactor` | class | MMCA.Common.UI.Services |
| 1 | `WebFormFactor` | class | MMCA.Common.UI.Web.Services |
| 2 | `BrowserAccessibilityAnnouncer` | class | MMCA.Common.UI.Services.Capabilities.Browser |
| 2 | `BrowserClipboardService` | class | MMCA.Common.UI.Services.Capabilities.Browser |
| 2 | `BrowserConnectivityStatusService` | class | MMCA.Common.UI.Services.Capabilities.Browser |
| 2 | `BrowserDevicePreferences` | class | MMCA.Common.UI.Services.Capabilities.Browser |
| 2 | `BrowserExternalLinkService` | class | MMCA.Common.UI.Services.Capabilities.Browser |
| 2 | `BrowserLocalCacheStore` | class | MMCA.Common.UI.Services.Capabilities.Browser |
| 2 | `BrowserShareService` | class | MMCA.Common.UI.Services.Capabilities.Browser |
| 2 | `IDeepLinkDispatcher` | interface | MMCA.Common.UI.Services.Capabilities |
| 2 | `MainPageBase` | class | MMCA.Common.UI.Maui |
| 2 | `MauiCultureApplier` | class | MMCA.Common.UI.Maui.Globalization |
| 2 | `MauiCultureInitializer` | class | MMCA.Common.UI.Maui.Globalization |
| 2 | `MauiExternalAuthBroker` | class | MMCA.Common.UI.Maui.Capabilities |
| 2 | `MauiGeocodingService` | class | MMCA.Common.UI.Maui.Capabilities |
| 2 | `MauiGeolocationService` | class | MMCA.Common.UI.Maui.Capabilities |
| 2 | `MauiLocalNotificationService` | class | MMCA.Common.UI.Maui.Capabilities |
| 2 | `MauiMediaPickerService` | class | MMCA.Common.UI.Maui.Capabilities |
| 2 | `MauiPushRegistrationService` | class | MMCA.Common.UI.Maui.Capabilities |
| 2 | `NullGeocodingService` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 2 | `NullGeolocationService` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 2 | `NullLocalNotificationService` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 2 | `NullMediaPickerService` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 2 | `NullPushDeviceTokenProvider` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 3 | `DeepLinkDispatcher` | class | MMCA.Common.UI.Services.Capabilities |
| 3 | `DependencyInjection` | class | MMCA.Common.UI.Maui |
| 3 | `DeviceCapabilitiesInitializer` | class | MMCA.Common.UI.Maui |
| 4 | `DependencyInjection` | class | MMCA.Common.UI.Services.Capabilities |
| 4 | `HostingDependencyInjection` | class | MMCA.Common.UI.Maui |

### G25 - Testing & Quality Infrastructure

> `group-27-testing-infrastructure.md` | 2270 types | All test projects + the reusable Testing/Testing.E2E/Testing.UI bases, architecture-fitness tests, and the component Gallery harness; individual [Fact]s are rolled up by project (logged exception).

Rolled up by project (individual `[Fact]`s not sectioned - logged exception). Reusable test
infrastructure assemblies (sectioned in full in the chapter) are marked **(infra)**.

| Test project (assembly) | Types | Levels | Kind |
|--------------------------|-------|--------|------|
| `MMCA.ADC.Architecture.Tests` **(infra)** | 43 | L1-L13 |  |
| `MMCA.ADC.Conference.API.Tests`  | 20 | L1-L11 |  |
| `MMCA.ADC.Conference.Application.Tests`  | 165 | L0-L16 |  |
| `MMCA.ADC.Conference.Domain.Tests`  | 28 | L6-L11 |  |
| `MMCA.ADC.Conference.Infrastructure.Tests`  | 14 | L0-L11 |  |
| `MMCA.ADC.Conference.IntegrationTests`  | 37 | L1-L18 |  |
| `MMCA.ADC.Conference.Shared.Tests`  | 17 | L0-L10 |  |
| `MMCA.ADC.Conference.UI.Tests`  | 53 | L1-L11 |  |
| `MMCA.ADC.CrossService.IntegrationTests`  | 13 | L1-L18 |  |
| `MMCA.ADC.E2E.Tests`  | 84 | L0-L8 |  |
| `MMCA.ADC.Engagement.API.Tests`  | 10 | L1-L12 |  |
| `MMCA.ADC.Engagement.Application.Tests`  | 66 | L1-L15 |  |
| `MMCA.ADC.Engagement.Domain.Tests`  | 11 | L7-L11 |  |
| `MMCA.ADC.Engagement.Infrastructure.Tests`  | 4 | L1-L11 |  |
| `MMCA.ADC.Engagement.IntegrationTests`  | 22 | L0-L18 |  |
| `MMCA.ADC.Engagement.Shared.Tests`  | 7 | L1-L10 |  |
| `MMCA.ADC.Engagement.UI.Tests`  | 36 | L0-L11 |  |
| `MMCA.ADC.Gateway.Tests`  | 8 | L0-L15 |  |
| `MMCA.ADC.Identity.API.Tests`  | 8 | L1-L18 |  |
| `MMCA.ADC.Identity.Application.Tests`  | 30 | L2-L17 |  |
| `MMCA.ADC.Identity.Domain.Tests`  | 4 | L8-L8 |  |
| `MMCA.ADC.Identity.Infrastructure.Tests`  | 9 | L0-L16 |  |
| `MMCA.ADC.Identity.IntegrationTests`  | 34 | L0-L19 |  |
| `MMCA.ADC.Identity.Shared.Tests`  | 3 | L2-L5 |  |
| `MMCA.ADC.Identity.UI.Tests`  | 7 | L3-L8 |  |
| `MMCA.ADC.Notification.API.Tests`  | 1 | L4-L4 |  |
| `MMCA.ADC.Notification.Application.Tests`  | 5 | L1-L15 |  |
| `MMCA.ADC.Notification.IntegrationTests`  | 9 | L1-L18 |  |
| `MMCA.ADC.ServiceBusEmulator.IntegrationTests`  | 3 | L4-L6 |  |
| `MMCA.ADC.Services.Tests`  | 5 | L0-L13 |  |
| `MMCA.Common.API.Tests`  | 138 | L0-L18 |  |
| `MMCA.Common.Application.Tests`  | 343 | L0-L16 |  |
| `MMCA.Common.Architecture.Tests` **(infra)** | 158 | L0-L13 |  |
| `MMCA.Common.Aspire.Hosting.Tests`  | 4 | L0-L11 |  |
| `MMCA.Common.Aspire.Tests`  | 41 | L0-L12 |  |
| `MMCA.Common.Benchmarks`  | 6 | L0-L4 |  |
| `MMCA.Common.Domain.Tests`  | 62 | L0-L8 |  |
| `MMCA.Common.Gateway.Tests`  | 7 | L0-L4 |  |
| `MMCA.Common.Grpc.Tests`  | 16 | L0-L4 |  |
| `MMCA.Common.Infrastructure.Redis.Tests`  | 2 | L5-L5 |  |
| `MMCA.Common.Infrastructure.Tests`  | 380 | L0-L17 |  |
| `MMCA.Common.Shared.Tests`  | 44 | L0-L6 |  |
| `MMCA.Common.Testing` **(infra)** | 23 | L0-L14 |  |
| `MMCA.Common.Testing.Architecture` **(infra)** | 57 | L0-L5 |  |
| `MMCA.Common.Testing.E2E` **(infra)** | 30 | L0-L4 |  |
| `MMCA.Common.Testing.Tests`  | 27 | L0-L15 |  |
| `MMCA.Common.Testing.UI` **(infra)** | 16 | L0-L3 |  |
| `MMCA.Common.UI.E2E.Tests`  | 18 | L2-L13 |  |
| `MMCA.Common.UI.Gallery` **(infra)** | 11 | L0-L9 |  |
| `MMCA.Common.UI.Tests`  | 127 | L0-L8 |  |
| `MMCA.Common.UI.Web.Tests`  | 4 | L1-L5 |  |

