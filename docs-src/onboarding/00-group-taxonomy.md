# Phase 1b - Functional Group Taxonomy

This is the **primary axis** of the guide. Every one of the **2,497** distinct first-party type
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
| G01 | **Result & Error Handling**<br/>group-01-result-error-handling.md | 11 | L0-L2 | The Result/Error railway that every operation returns instead of throwing; pagination result shapes. |
| G02 | **Domain Building Blocks (Entities, Value Objects, Aggregates)**<br/>group-02-domain-building-blocks.md | 27 | L0-L4 | The DDD primitives: entity/aggregate base classes, audit fields, value objects + invariants, domain markers, attributes, identifier aliases. |
| G03 | **Querying: Specifications, Filtering & the Entity Query Service**<br/>group-03-querying-specifications.md | 25 | L0-L8 | Composable read-side: the Specification pattern, dynamic filtering/sorting/paging, and the generic entity query pipeline. |
| G04 | **Domain & Integration Events + Outbox Dual-Dispatch**<br/>group-04-events-outbox.md | 31 | L0-L8 | Event contracts, the domain-event dispatcher, the transactional outbox/inbox, and the in-process + broker message buses. |
| G05 | **CQRS: Commands, Queries & the Decorator Pipeline**<br/>group-05-cqrs-pipeline.md | 23 | L0-L8 | The command/query handler abstraction and the cross-cutting decorator pipeline (logging, transaction, caching, feature-gate, idempotency) wrapping it. |
| G06 | **Validation**<br/>group-06-validation.md | 17 | L0-L5 | The FluentValidation-based validation contracts and failure mapping that gate commands before they execute. |
| G07 | **Persistence & EF Core**<br/>group-07-persistence-ef-core.md | 83 | L0-L8 | The single SQLServerDbContext over the abstract ApplicationDbContext, interceptors, repositories, specifications evaluation, data-source routing (database-per-service), conventions, value generators, encryption, factories and design-time. |
| G08 | **Authentication & Authorization**<br/>group-08-auth.md | 56 | L0-L8 | JWT/JWKS dual-fetch token validation, current-user/claims, password hashing, cookie sessions, and policy/authorization plumbing. |
| G09 | **Caching**<br/>group-09-caching.md | 4 | L0-L1 | The cache abstraction and its decorator-driven, invalidation-aware integration into the query pipeline. |
| G10 | **Notifications (Push + In-App Inbox + Email)**<br/>group-10-notifications.md | 53 | L0-L10 | The notification subsystem: push (SignalR), the in-app inbox, email sending, recipient providers, and the thin ADC Notification module host. |
| G11 | **Navigation Metadata & Populators (EF-decoupled eager loading)**<br/>group-11-navigation-populators.md | 12 | L0-L9 | INavigationMetadata/INavigationPopulator and the loader that hydrate cross-container/cross-source relationships without EF Include coupling (ADR-002). |
| G12 | **API Hosting, Middleware, Idempotency & DTO/Contract Mapping**<br/>group-12-api-hosting-mapping.md | 56 | L0-L10 | The ASP.NET Core edge: controller bases, middleware, startup, model binders, JSON converters, feature management, idempotency, correlation, and manual DTO/request mapping. |
| G13 | **gRPC & Inter-Service Contracts**<br/>group-13-grpc-contracts.md | 6 | L0-L4 | Typed gRPC clients/servers, interceptors, Result-over-the-wire, and the ServiceContract marker for synchronous inter-service calls (ADR-007). |
| G14 | **Module System, Composition & Configuration**<br/>group-14-module-system-composition.md | 34 | L0-L9 | IModule discovery + Kahn-ordered ModuleLoader, the DI composition roots, assembly markers, data-source/database attributes, and options/settings binding. |
| G15 | **Common UI Framework (MudBlazor components, theme, base pages)**<br/>group-15-common-ui-framework.md | 82 | L0-L7 | Reusable Blazor building blocks: the data-grid list page base, theme, common pages/services, and UI extensions shared by every consumer app. |
| G16 | **Aspire Orchestration & Service Defaults**<br/>group-16-aspire-orchestration.md | 16 | L0-L3 | The Aspire AppHost wiring, ServiceDefaults, warmup, telemetry and security helpers that compose and run the distributed app locally and in Azure. |
| G17 | **ADC Conference - Domain Model & Module Contracts**<br/>group-17-conference-domain.md | 85 | L0-L8 | The Conference bounded context: Event/Session/Speaker/Category/Question aggregates, their domain events and invariants, plus the Shared identifiers/DTOs/integration-event contracts. |
| G18 | **ADC Conference - Application & Use Cases**<br/>group-18-conference-application.md | 202 | L0-L11 | Conference CQRS handlers, validators, DTOs, specifications, the Sessionize import, and the session-selection decision-support analytics. |
| G19 | **ADC Conference - Infrastructure & Persistence**<br/>group-19-conference-infrastructure.md | 27 | L0-L8 | The Conference module DbContext registration, EF entity configurations, database seeding, and infrastructure services. |
| G20 | **ADC Conference - API, gRPC Contracts & Service Host**<br/>group-20-conference-api-grpc.md | 40 | L0-L10 | Conference REST controllers, the .Contracts gRPC surface, the extractable service host, and the gRPC adapter. |
| G21 | **ADC Conference - UI**<br/>group-21-conference-ui.md | 79 | L0-L8 | The Conference Blazor pages (events, sessions, speakers, categories, questions, rooms, feedback, public, session-selection) and their UI services. |
| G22 | **ADC Engagement Module (Session Bookmarks)**<br/>group-22-engagement-module.md | 67 | L0-L11 | The Engagement bounded context end-to-end: bookmark aggregate, use cases, persistence, API/contracts/service, and feedback UI. |
| G26 | **ADC Engagement Live Layer (Real-Time Polls & Session Q&A)**<br/>group-23-engagement-live-layer.md | 92 | L0-L10 | Real-time audience interaction in the Engagement bounded context: event-wide live polls with voting and moderated per-session Q&A with upvoting, over the SignalR hub-channel transport (ADR-039) and the cross-service gRPC live-channel adapter. |
| G23 | **ADC Identity Module (Users, Profiles, GDPR Export/Erasure)**<br/>group-24-identity-module.md | 78 | L0-L11 | The Identity bounded context end-to-end: the User aggregate, change-password/delete/export use cases, persistence, API/contracts/service, and profile/user UI. |
| G24 | **ADC Application Host, UI Shell & Cross-Module Composition**<br/>group-25-adc-host-composition.md | 34 | L0-L11 | The ADC host: the Blazor Web/WASM/WinUI shells, host pages/services, security, and the cross-module application composition. |
| G27 | **Device Capability Abstraction Layer (Native Contracts, MAUI, Browser & Fallback Adapters)**<br/>group-26-device-capability-layer.md | 87 | L0-L4 | Per-capability interface contracts (biometric, geocoding/geolocation, speech, push registration, media/clipboard/screenshot, haptics, share, external auth/links, local cache/notifications, connectivity/battery/accessibility, deep links) plus their MAUI-native, browser-JS-interop, and inert fallback implementations, selected per host at DI composition time (ADR-042/043/044/045). |
| G25 | **Testing & Quality Infrastructure**<br/>group-27-testing-infrastructure.md | 1170 | L0-L17 | All test projects + the reusable Testing/Testing.E2E/Testing.UI bases, architecture-fitness tests, and the component Gallery harness; individual [Fact]s are rolled up by project (logged exception). |

**Reconciliation:** 1327 production types across 26 groups + 1170 test/testing types in G25 = **2497** (matches the inventory's distinct-node count). No type appears twice; none dropped.

---

## Group membership

### G01 - Result & Error Handling

> `group-01-result-error-handling.md` | 11 types | The Result/Error railway that every operation returns instead of throwing; pagination result shapes.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `CollectionResult<T>` | record | MMCA.Common.Shared.Abstractions |
| 0 | `DomainException` | class | MMCA.Common.Shared.Exceptions |
| 0 | `ErrorType` | enum | MMCA.Common.Shared.Abstractions |
| 0 | `PaginationMetadata` | record | MMCA.Common.Shared.Abstractions |
| 0 | `PropertyReader` | delegate | MMCA.Common.Shared.Serialization |
| 1 | `DomainInvariantViolationException` | class | MMCA.Common.Shared.Exceptions |
| 1 | `Error` | record | MMCA.Common.Shared.Abstractions |
| 1 | `PagedCollectionResult<T>` | record | MMCA.Common.Shared.Abstractions |
| 2 | `Result` | class | MMCA.Common.Shared.Abstractions |
| 2 | `ResultConverter` | class | MMCA.Common.Shared.Serialization |
| 2 | `ResultJsonConverterFactory` | class | MMCA.Common.Shared.Serialization |

### G02 - Domain Building Blocks (Entities, Value Objects, Aggregates)

> `group-02-domain-building-blocks.md` | 27 types | The DDD primitives: entity/aggregate base classes, audit fields, value objects + invariants, domain markers, attributes, identifier aliases.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `DomainEntityState` | enum | MMCA.Common.Domain.Enums |
| 0 | `DomainHelper` | class | MMCA.Common.Shared.Extensions |
| 0 | `IAuditableEntity` | interface | MMCA.Common.Domain.Interfaces |
| 0 | `IBaseEntity<TIdentifierType>` | interface | MMCA.Common.Domain.Interfaces |
| 0 | `IdValueGeneratedAttribute` | class | MMCA.Common.Domain.Attributes |
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
| 3 | `CommonInvariants` | class | MMCA.Common.Domain.Invariants |
| 3 | `Currency` | record | MMCA.Common.Shared.ValueObjects |
| 3 | `CurrencyJsonConverter` | class | MMCA.Common.Shared.ValueObjects |
| 3 | `DateRange` | record | MMCA.Common.Shared.ValueObjects |
| 3 | `DateTimeRange` | record | MMCA.Common.Shared.ValueObjects |
| 3 | `EmailInvariants` | class | MMCA.Common.Shared.ValueObjects |
| 3 | `IAnonymizable` | interface | MMCA.Common.Domain.Interfaces |
| 3 | `PhoneNumberInvariants` | class | MMCA.Common.Shared.ValueObjects |
| 4 | `AuditableAggregateRootEntity<TIdentifierType>` | class | MMCA.Common.Domain.Entities |
| 4 | `Email` | record | MMCA.Common.Shared.ValueObjects |
| 4 | `Money` | record | MMCA.Common.Shared.ValueObjects |
| 4 | `PhoneNumber` | record | MMCA.Common.Shared.ValueObjects |

### G03 - Querying: Specifications, Filtering & the Entity Query Service

> `group-03-querying-specifications.md` | 25 types | Composable read-side: the Specification pattern, dynamic filtering/sorting/paging, and the generic entity query pipeline.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `EntityQueryParameters<TEntity>` | record | MMCA.Common.Application.Services.Query |
| 0 | `IFilterStrategy` | interface | MMCA.Common.Application.Services.Filtering |
| 0 | `ParameterReplacer` | class | MMCA.Common.Application.Specifications |
| 0 | `PropertyAccessor` | record struct | MMCA.Common.Application.Services |
| 1 | `BoolFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 1 | `DateTimeFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 1 | `DecimalFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 1 | `GuidFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 1 | `IntFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 1 | `ISpecification<TEntity, TIdentifierType>` | interface | MMCA.Common.Domain.Interfaces |
| 1 | `StringFilterStrategy` | class | MMCA.Common.Application.Services.Filtering |
| 2 | `Specification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 3 | `AndSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 3 | `InlineSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 3 | `NotSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 3 | `OrSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain.Specifications |
| 3 | `QueryFieldService` | class | MMCA.Common.Application.Services |
| 3 | `QueryFilterService` | class | MMCA.Common.Application.Services.Filtering |
| 4 | `IEntityQueryPipeline` | interface | MMCA.Common.Application.Services.Query |
| 4 | `INavigationMetadataProvider` | interface | MMCA.Common.Application.Services.Query |
| 5 | `EntityQueryPipeline` | class | MMCA.Common.Application.Services.Query |
| 5 | `IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces |
| 5 | `NavigationMetadataProvider` | class | MMCA.Common.Application.Services.Query |
| 8 | `CrossSourceSpecification` | class | MMCA.Common.Application.Specifications |
| 8 | `EntityQueryService<TEntity, TEntityDTO, TIdentifierType>` | class | MMCA.Common.Application.Services |

### G04 - Domain & Integration Events + Outbox Dual-Dispatch

> `group-04-events-outbox.md` | 31 types | Event contracts, the domain-event dispatcher, the transactional outbox/inbox, and the in-process + broker message buses.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `IDomainEvent` | interface | MMCA.Common.Domain.Interfaces |
| 0 | `IInboxStore` | interface | MMCA.Common.Infrastructure.Persistence.Inbox |
| 0 | `InboxMessage` | class | MMCA.Common.Infrastructure.Persistence.Inbox |
| 0 | `IOutboxSignal` | interface | MMCA.Common.Infrastructure.Persistence.Outbox |
| 0 | `OutboxCycleResult` | record struct | MMCA.Common.Infrastructure.Persistence.Outbox |
| 1 | `BaseDomainEvent` | record | MMCA.Common.Domain.DomainEvents |
| 1 | `IDomainEventDispatcher` | interface | MMCA.Common.Application.Interfaces |
| 1 | `IDomainEventHandler<in TDomainEvent>` | interface | MMCA.Common.Application.Interfaces |
| 1 | `IIntegrationEvent` | interface | MMCA.Common.Domain.Interfaces |
| 1 | `NoOpInboxStore` | class | MMCA.Common.Infrastructure.Persistence.Inbox |
| 1 | `OutboxMessage` | class | MMCA.Common.Infrastructure.Persistence.Outbox |
| 1 | `OutboxSignal` | class | MMCA.Common.Infrastructure.Persistence.Outbox |
| 2 | `BaseIntegrationEvent` | record | MMCA.Common.Domain.DomainEvents |
| 2 | `EntityChangedEvent<TIdentifierType>` | record | MMCA.Common.Domain.DomainEvents |
| 2 | `IEventBus` | interface | MMCA.Common.Application.Interfaces |
| 2 | `IIntegrationEventHandler<in TIntegrationEvent>` | interface | MMCA.Common.Application.Interfaces |
| 2 | `IIntegrationEventPublisher` | interface | MMCA.Common.Application.Interfaces |
| 2 | `IMessageBus` | interface | MMCA.Common.Application.Messaging |
| 2 | `SafeDomainEventHandler<TDomainEvent>` | class | MMCA.Common.Application.DomainEvents |
| 3 | `BrokerMessageBus` | class | MMCA.Common.Infrastructure.Services |
| 3 | `DomainEventDispatcher` | class | MMCA.Common.Application.Services |
| 3 | `InProcessMessageBus` | class | MMCA.Common.Infrastructure.Services |
| 3 | `IntegrationEventConsumer<TEvent>` | class | MMCA.Common.Infrastructure.Services |
| 3 | `IntegrationEventPublisher` | class | MMCA.Common.Infrastructure.Services |
| 4 | `IntegrationEventConsumerExtensions` | class | MMCA.Common.Infrastructure.Services |
| 6 | `OutboxFinalizer` | class | MMCA.Common.Infrastructure.Persistence.Outbox |
| 8 | `BrokerEventBus` | class | MMCA.Common.Infrastructure.Services |
| 8 | `EfInboxStore` | class | MMCA.Common.Infrastructure.Persistence.Inbox |
| 8 | `InProcessEventBus` | class | MMCA.Common.Infrastructure.Services |
| 8 | `OutboxCleanupService` | class | MMCA.Common.Infrastructure.Persistence.Outbox |
| 8 | `OutboxProcessor` | class | MMCA.Common.Infrastructure.Persistence.Outbox |

### G05 - CQRS: Commands, Queries & the Decorator Pipeline

> `group-05-cqrs-pipeline.md` | 23 types | The command/query handler abstraction and the cross-cutting decorator pipeline (logging, transaction, caching, feature-gate, idempotency) wrapping it.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `CqrsMetrics` | class | MMCA.Common.Application.UseCases.Decorators |
| 0 | `DeleteEntityCommand<TEntity, TIdentifierType>` | record | MMCA.Common.Application.UseCases |
| 0 | `ICacheInvalidating` | interface | MMCA.Common.Application.UseCases |
| 0 | `ICommandHandler<in TCommand, TResult>` | interface | MMCA.Common.Application.UseCases |
| 0 | `ICommandWithRequest<out TRequest>` | interface | MMCA.Common.Application.UseCases |
| 0 | `ICreateRequest` | interface | MMCA.Common.Application.Interfaces |
| 0 | `IFeatureGated` | interface | MMCA.Common.Application.UseCases |
| 0 | `IQueryCacheable` | interface | MMCA.Common.Application.UseCases |
| 0 | `IQueryHandler<in TQuery, TResult>` | interface | MMCA.Common.Application.UseCases |
| 0 | `ITransactional` | interface | MMCA.Common.Application.UseCases |
| 0 | `QueryCacheKeyLocks` | class | MMCA.Common.Application.UseCases.Decorators |
| 1 | `ProfilingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 1 | `ProfilingQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 3 | `CachingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 3 | `CachingQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 3 | `LoggingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 3 | `LoggingQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 3 | `ResultFailureFactory` | class | MMCA.Common.Application.UseCases.Decorators |
| 4 | `FeatureGateCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 4 | `FeatureGateQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 4 | `ValidatingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |
| 8 | `DeleteEntityHandler<TEntity, TIdentifierType>` | class | MMCA.Common.Application.UseCases |
| 8 | `TransactionalCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application.UseCases.Decorators |

### G06 - Validation

> `group-06-validation.md` | 17 types | The FluentValidation-based validation contracts and failure mapping that gate commands before they execute.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `EmailRules<T>` | class | MMCA.Common.Application.Validation |
| 0 | `NonNegativeIntRules<T>` | class | MMCA.Common.Application.Validation |
| 0 | `OptionalStringRules<T>` | class | MMCA.Common.Application.Validation |
| 0 | `PasswordRules<T>` | class | MMCA.Common.Application.Validation |
| 0 | `PositiveDecimalRules<T>` | class | MMCA.Common.Application.Validation |
| 0 | `PositiveIntRules<T>` | class | MMCA.Common.Application.Validation |
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

### G07 - Persistence & EF Core

> `group-07-persistence-ef-core.md` | 83 types | The single SQLServerDbContext over the abstract ApplicationDbContext, interceptors, repositories, specifications evaluation, data-source routing (database-per-service), conventions, value generators, encryption, factories and design-time.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `CosmosIntIdValueGenerator` | class | MMCA.Common.Infrastructure.Persistence.ValueGenerators |
| 0 | `DataSource` | enum | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `EncryptedStringConverter` | class | MMCA.Common.Infrastructure.Persistence.Encryption |
| 0 | `EntityConfigurationOptions` | class | MMCA.Common.Infrastructure.Persistence |
| 0 | `IDbSeeder` | interface | MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding |
| 0 | `IdentityInsertGroup` | record | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 0 | `IEntityConfigurationAssemblyProvider` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `ImageContentSniffer` | class | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `INativePushSender` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `IQueryableExecutor` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `ModelBuilderExtensions` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 0 | `NamespaceConventions` | class | MMCA.Common.Infrastructure.Persistence |
| 0 | `NativePushPayloads` | class | MMCA.Common.Infrastructure.Services |
| 0 | `ProfilingHelper` | class | MMCA.Common.Infrastructure.Persistence |
| 0 | `ValReturn<T>` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 1 | `AzureNotificationHubNativePushSender` | class | MMCA.Common.Infrastructure.Services |
| 1 | `DataSourceKey` | record struct | MMCA.Common.Application.Interfaces.Infrastructure |
| 1 | `DbSeeder` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding |
| 1 | `DefaultEntityConfigurationAssemblyProvider` | class | MMCA.Common.Infrastructure.Persistence |
| 1 | `EFQueryableExecutor` | class | MMCA.Common.Infrastructure.Persistence |
| 1 | `ExplicitAssemblyProvider` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Design |
| 1 | `NullNativePushSender` | class | MMCA.Common.Infrastructure.Services |
| 2 | `CapturedState` | record | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 2 | `DesignTimeDbContextOptions` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Design |
| 2 | `IDataSourceService` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 2 | `IEntityDataSourceRegistry` | interface | MMCA.Common.Infrastructure.Persistence.DataSources |
| 2 | `NullDomainEventDispatcher` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Design |
| 2 | `PhysicalDataSource` | record | MMCA.Common.Infrastructure.Persistence.DataSources |
| 2 | `Snapshot` | record | MMCA.Common.Infrastructure.Persistence.DataSources |
| 3 | `CrossDataSourceDegradeConvention` | class | MMCA.Common.Infrastructure.Persistence.Conventions |
| 3 | `DataSourceService` | class | MMCA.Common.Infrastructure.Services |
| 3 | `IDataSourceResolver` | interface | MMCA.Common.Infrastructure.Persistence.DataSources |
| 3 | `IFileStorageService` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 3 | `IImageProcessor` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 3 | `IPushDeviceRegistrar` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 4 | `AzureBlobFileStorageService` | class | MMCA.Common.Infrastructure.Services |
| 4 | `AzureNotificationHubDeviceRegistrar` | class | MMCA.Common.Infrastructure.Services |
| 4 | `DataSourceResolver` | class | MMCA.Common.Infrastructure.Persistence.DataSources |
| 4 | `IEntityQuerier<TEntity, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 4 | `IEntityReader<TEntity, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 4 | `IEntityTypeConfigurationBase<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 4 | `ImageSharpImageProcessor` | class | MMCA.Common.Infrastructure.Services |
| 4 | `IWriteRepository<TEntity, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 4 | `NullFileStorageService` | class | MMCA.Common.Infrastructure.Services |
| 4 | `NullPushDeviceRegistrar` | class | MMCA.Common.Infrastructure.Services |
| 5 | `EntityDataSourceRegistry` | class | MMCA.Common.Infrastructure.Persistence.DataSources |
| 5 | `EntityTypeConfigurationBase<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 5 | `IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 5 | `IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 5 | `IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 5 | `IReadRepository<TEntity, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 6 | `ApplicationDbContext` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 6 | `AuditSaveChangesInterceptor` | class | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 6 | `DataSourceModelCacheKeyFactory` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 6 | `DomainEventSaveChangesInterceptor` | class | MMCA.Common.Infrastructure.Persistence.Interceptors |
| 6 | `EFReadRepository<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 6 | `EFReadRepositoryDecorator<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 6 | `EntityTypeConfiguration<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 6 | `IRepository<TEntity, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 6 | `ReadRepositoryExtensions` | class | MMCA.Common.Application.Extensions |
| 7 | `CosmosDbContext` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 7 | `EFRepository<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 7 | `EFRepositoryDecorator<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Repositories |
| 7 | `EntityTypeConfigurationCosmos<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 7 | `EntityTypeConfigurationSqlite<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 7 | `EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration |
| 7 | `IDbContextFactory` | interface | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 7 | `IPhysicalDbContextFactory` | interface | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 7 | `IRepositoryFactory` | interface | MMCA.Common.Infrastructure.Persistence.Repositories.Factory |
| 7 | `IUnitOfWork` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 7 | `SqliteDbContext` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 7 | `SQLServerDbContext` | class | MMCA.Common.Infrastructure.Persistence.DbContexts |
| 8 | `ApplicationDbContextEFFactory` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 8 | `DbContextFactory` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 8 | `DefaultCosmosDbContextFactory` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 8 | `DefaultSqliteDbContextFactory` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 8 | `DefaultSqlServerDbContextFactory` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 8 | `DesignTimeDbContextHelper` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Design |
| 8 | `PhysicalDbContextFactory` | class | MMCA.Common.Infrastructure.Persistence.DbContexts.Factory |
| 8 | `PushNotificationConfiguration` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration.Notifications |
| 8 | `RepositoryFactory` | class | MMCA.Common.Infrastructure.Persistence.Repositories.Factory |
| 8 | `UnitOfWork` | class | MMCA.Common.Infrastructure.Persistence |
| 8 | `UserNotificationConfiguration` | class | MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration.Notifications |

### G08 - Authentication & Authorization

> `group-08-auth.md` | 56 types | JWT/JWKS dual-fetch token validation, current-user/claims, password hashing, cookie sessions, and policy/authorization plumbing.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AuthClaimTypes` | class | MMCA.Common.Shared.Auth |
| 0 | `AuthenticationRequest` | record struct | MMCA.Common.Shared |
| 0 | `AuthenticationResponse` | record struct | MMCA.Common.Shared.Auth |
| 0 | `AuthorizationPolicies` | class | MMCA.Common.API.Authorization |
| 0 | `ChangePasswordRequest` | record struct | MMCA.Common.Shared.Auth |
| 0 | `ClaimBasedUserIdProvider` | class | MMCA.Common.Infrastructure.Services |
| 0 | `IAuthUser` | interface | MMCA.Common.Domain.Auth |
| 0 | `IcsEvent` | record | MMCA.Common.Shared.Calendars |
| 0 | `ICurrentUserService` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `IJwksProvider` | interface | MMCA.Common.Infrastructure.Auth |
| 0 | `IPasswordHasher` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `IPermissionRegistry` | interface | MMCA.Common.Shared.Auth |
| 0 | `ISoftDeletedUserValidator` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `ITokenService` | interface | MMCA.Common.Application.Interfaces.Infrastructure |
| 0 | `LoginProtectionSettings` | class | MMCA.Common.Infrastructure.Auth |
| 0 | `LoginRequest` | record struct | MMCA.Common.Shared.Auth |
| 0 | `OAuthCodeExchangeRequest` | record struct | MMCA.Common.Shared.Auth |
| 0 | `OwnerOrAdminFilterOptions` | class | MMCA.Common.API.Authorization |
| 0 | `PermissionPolicy` | class | MMCA.Common.API.Authorization |
| 0 | `PermissionRequirement` | class | MMCA.Common.API.Authorization |
| 0 | `RefreshTokenRequest` | record struct | MMCA.Common.Shared.Auth |
| 0 | `RoleNames` | class | MMCA.Common.Shared.Auth |
| 0 | `SessionCookieRequest` | record | MMCA.Common.API.SessionCookies |
| 0 | `SessionTokenResponse` | record | MMCA.Common.API.SessionCookies |
| 0 | `SessionTokenResult` | record struct | MMCA.Common.API.SessionCookies |
| 1 | `HasPermissionAttribute` | class | MMCA.Common.API.Authorization |
| 1 | `ICookieSessionRefresher` | interface | MMCA.Common.API.SessionCookies |
| 1 | `IcsCalendarBuilder` | class | MMCA.Common.Shared.Calendars |
| 1 | `LoginRequestValidator` | class | MMCA.Common.Application.Auth.Validation |
| 1 | `OwnershipHelper` | class | MMCA.Common.API.Authorization |
| 1 | `PasswordHasher` | class | MMCA.Common.Infrastructure.Services |
| 1 | `PermissionAuthorizationHandler` | class | MMCA.Common.API.Authorization |
| 1 | `PermissionPolicyProvider` | class | MMCA.Common.API.Authorization |
| 1 | `PermissionRegistry` | class | MMCA.Common.Shared.Auth |
| 1 | `RefreshTokenRequestValidator` | class | MMCA.Common.Application.Auth.Validation |
| 1 | `RsaJwksProvider` | class | MMCA.Common.Infrastructure.Auth |
| 2 | `CookieSessionRefreshMiddleware` | class | MMCA.Common.API.SessionCookies |
| 2 | `OwnerOrAdminFilter` | class | MMCA.Common.API.Authorization |
| 2 | `PermissionRegistryBuilder` | class | MMCA.Common.Shared.Auth |
| 2 | `SessionCookieEndpoints` | class | MMCA.Common.API.SessionCookies |
| 2 | `SessionCookieJar` | class | MMCA.Common.API.SessionCookies |
| 2 | `TokenService` | class | MMCA.Common.Infrastructure.Services |
| 3 | `AuthorizationExtensions` | class | MMCA.Common.API.Authorization |
| 3 | `CookieSessionRefreshMiddlewareExtensions` | class | MMCA.Common.API.SessionCookies |
| 3 | `CookieTokenReader` | class | MMCA.Common.API.SessionCookies |
| 3 | `ILoginProtectionService` | interface | MMCA.Common.Application.Auth |
| 3 | `RoleValue` | class | MMCA.Common.Shared.Auth |
| 4 | `CookieSessionRefresher` | class | MMCA.Common.API.SessionCookies |
| 4 | `LoginProtectionService` | class | MMCA.Common.Infrastructure.Auth |
| 4 | `RegisterRequest` | record struct | MMCA.Common.Shared.Auth |
| 4 | `SessionCookieAuthenticationHandler` | class | MMCA.Common.API.SessionCookies |
| 5 | `AuthenticationValidators` | class | MMCA.Common.Application.Auth |
| 5 | `IAuthenticationService` | interface | MMCA.Common.Application.Auth |
| 5 | `SessionCookieAuthenticationExtensions` | class | MMCA.Common.API.SessionCookies |
| 7 | `CurrentUserService` | class | MMCA.Common.Infrastructure.Services |
| 8 | `AuthenticationServiceBase<TUser>` | class | MMCA.Common.Application.Auth |

### G09 - Caching

> `group-09-caching.md` | 4 types | The cache abstraction and its decorator-driven, invalidation-aware integration into the query pipeline.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `CacheOptions` | class | MMCA.Common.Infrastructure.Caching |
| 0 | `ICacheService` | interface | MMCA.Common.Application.Interfaces |
| 1 | `DistributedCacheService` | class | MMCA.Common.Infrastructure.Caching |
| 1 | `MemoryCacheService` | class | MMCA.Common.Infrastructure.Caching |

### G10 - Notifications (Push + In-App Inbox + Email)

> `group-10-notifications.md` | 53 types | The notification subsystem: push (SignalR), the in-app inbox, email sending, recipient providers, and the thin ADC Notification module host.

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
| 0 | `PushNotificationStatus` | enum | MMCA.Common.Domain.Notifications.PushNotifications |
| 0 | `SendPushNotificationRequest` | record | MMCA.Common.Shared.Notifications.PushNotifications |
| 0 | `UserNotificationDTO` | record | MMCA.Common.Shared.Notifications.UserNotifications |
| 0 | `UserNotificationExportItemDTO` | record | MMCA.ADC.Notification.Shared.UserNotifications |
| 1 | `AttendeeNotificationRecipientProvider` | class | MMCA.ADC.Notification.Application |
| 1 | `IUserNotificationExportService` | interface | MMCA.ADC.Notification.Shared.UserNotifications |
| 1 | `LiveChannelGrpcService` | class | MMCA.ADC.Notification.Service.Grpc |
| 1 | `LiveChannelPublisherGrpcAdapter` | class | MMCA.ADC.Notification.Contracts |
| 1 | `NullLiveChannelPublisher` | class | MMCA.Common.Infrastructure.Services |
| 1 | `NullNotificationRecipientProvider` | class | MMCA.Common.Application.Interfaces.Infrastructure |
| 1 | `NullPushNotificationSender` | class | MMCA.Common.Infrastructure.Services |
| 1 | `PushNotificationDTO` | record | MMCA.Common.Shared.Notifications.PushNotifications |
| 1 | `SendPushNotificationCommand` | record | MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send |
| 1 | `SmtpEmailSender` | class | MMCA.Common.Infrastructure.Services |
| 2 | `DependencyInjection` | class | MMCA.ADC.Notification.API |
| 2 | `DisabledUserNotificationExportService` | class | MMCA.ADC.Notification.Shared.UserNotifications |
| 2 | `NotificationHub` | class | MMCA.Common.Infrastructure.Hubs |
| 2 | `PushNotificationCreated` | record | MMCA.Common.Domain.Notifications.PushNotifications.DomainEvents |
| 3 | `NotificationModule` | class | MMCA.ADC.Notification.API |
| 3 | `SignalRLiveChannelPublisher` | class | MMCA.Common.Infrastructure.Services |
| 3 | `SignalRPushNotificationSender` | class | MMCA.Common.Infrastructure.Services |
| 4 | `DevicesController` | class | MMCA.Common.API.Controllers.Notifications |
| 4 | `InboxController` | class | MMCA.Common.API.Controllers.Notifications |
| 4 | `NotificationsController` | class | MMCA.Common.API.Controllers.Notifications |
| 4 | `PushNotificationInvariants` | class | MMCA.Common.Domain.Notifications.PushNotifications.Invariants |
| 5 | `DependencyInjection` | class | MMCA.Common.API.Notifications |
| 5 | `PushNotification` | class | MMCA.Common.Domain.Notifications.PushNotifications |
| 5 | `SendPushNotificationRequestValidator` | class | MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send |
| 5 | `UserNotification` | class | MMCA.Common.Domain.Notifications.UserNotifications |
| 6 | `PushNotificationDTOMapper` | class | MMCA.Common.Application.Notifications.PushNotifications.DTOs |
| 8 | `GetMyNotificationsHandler` | class | MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetInbox |
| 8 | `GetNotificationHistoryHandler` | class | MMCA.Common.Application.Notifications.PushNotifications.UseCases.GetHistory |
| 8 | `GetUnreadNotificationCountHandler` | class | MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetUnreadCount |
| 8 | `MarkAllNotificationsReadHandler` | class | MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkAllRead |
| 8 | `MarkNotificationReadHandler` | class | MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkRead |
| 8 | `SendPushNotificationHandler` | class | MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send |
| 8 | `UserNotificationExportService` | class | MMCA.ADC.Notification.Application |
| 9 | `DependencyInjection` | class | MMCA.ADC.Notification.Application |
| 9 | `DependencyInjection` | class | MMCA.Common.Application.Notifications |
| 9 | `UserNotificationExportGrpcService` | class | MMCA.ADC.Notification.Service.Grpc |
| 9 | `UserNotificationExportServiceGrpcAdapter` | class | MMCA.ADC.Notification.Contracts |
| 10 | `DependencyInjection` | class | MMCA.ADC.Notification.Contracts |

### G11 - Navigation Metadata & Populators (EF-decoupled eager loading)

> `group-11-navigation-populators.md` | 12 types | INavigationMetadata/INavigationPopulator and the loader that hydrate cross-container/cross-source relationships without EF Include coupling (ADR-002).

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

> `group-12-api-hosting-mapping.md` | 56 types | The ASP.NET Core edge: controller bases, middleware, startup, model binders, JSON converters, feature management, idempotency, correlation, and manual DTO/request mapping.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AppAssociationOptions` | class | MMCA.Common.API.Startup |
| 0 | `AssemblyReference` | class | MMCA.Common.API |
| 0 | `ClassReference` | class | MMCA.Common.API |
| 0 | `DbUpdateExceptionHandler` | class | MMCA.Common.API.Middleware |
| 0 | `DisabledFeatureHandler` | class | MMCA.Common.API.FeatureManagement |
| 0 | `ErrorResources` | class | MMCA.Common.API.Resources |
| 0 | `ErrorResourceSource` | class | MMCA.Common.API.Localization |
| 0 | `ExternalAuthExtensions` | class | MMCA.Common.API.Authentication |
| 0 | `GlobalExceptionHandler` | class | MMCA.Common.API.Middleware |
| 0 | `IBaseDTO<TIdentifierType>` | interface | MMCA.Common.Shared.DTOs |
| 0 | `IConcurrencyAware` | interface | MMCA.Common.Shared.DTOs |
| 0 | `ICorrelationContext` | interface | MMCA.Common.Application.Interfaces |
| 0 | `IdempotencyRecord` | record | MMCA.Common.API.Idempotency |
| 0 | `IdempotencySettings` | class | MMCA.Common.API.Idempotency |
| 0 | `IErrorLocalizer` | interface | MMCA.Common.API.Localization |
| 0 | `JwtForwardingDelegatingHandler` | class | MMCA.Common.Infrastructure.Http |
| 0 | `OpenApiEndpointExtensions` | class | MMCA.Common.API.Startup |
| 0 | `OperationCanceledExceptionHandler` | class | MMCA.Common.API.Middleware |
| 0 | `PublicEndpointOutputCachePolicy` | class | MMCA.Common.API.Caching |
| 0 | `QueryFilterModelBinder` | class | MMCA.Common.API.ModelBinders |
| 0 | `ServiceInfoResponse` | record | MMCA.Common.API.Controllers |
| 0 | `ServiceInfoV2Response` | record | MMCA.Common.API.Controllers |
| 0 | `SupportedCultures` | class | MMCA.Common.Shared.Globalization |
| 0 | `ValidationExceptionHandler` | class | MMCA.Common.API.Middleware |
| 1 | `AppAssociationEndpointExtensions` | class | MMCA.Common.API.Startup |
| 1 | `BaseLookup<TIdentifierType>` | record | MMCA.Common.Shared.DTOs |
| 1 | `CorrelationContext` | class | MMCA.Common.Infrastructure.Services |
| 1 | `CorrelationIdMiddleware` | class | MMCA.Common.API.Middleware |
| 1 | `DomainExceptionHandler` | class | MMCA.Common.API.Middleware |
| 1 | `ErrorLocalizer` | class | MMCA.Common.API.Localization |
| 1 | `IdempotencyFilter` | class | MMCA.Common.API.Idempotency |
| 1 | `JwksEndpointExtensions` | class | MMCA.Common.API.Startup |
| 1 | `OutputCacheOptionsExtensions` | class | MMCA.Common.API.Caching |
| 1 | `ServiceInfoControllerBase` | class | MMCA.Common.API.Controllers |
| 1 | `SoftDeletedUserMiddleware` | class | MMCA.Common.API.Middleware |
| 2 | `ErrorHttpMapping` | class | MMCA.Common.API.Middleware |
| 2 | `IdempotentAttribute` | class | MMCA.Common.API.Idempotency |
| 2 | `IEntityControllerBase<TEntityDTO, TIdentifierType>` | interface | MMCA.Common.API.Controllers |
| 2 | `MiniProfilerExtensions` | class | MMCA.Common.API.Startup |
| 2 | `ModuleControllerFeatureProvider` | class | MMCA.Common.API |
| 2 | `OidcDiscoveryEndpointExtensions` | class | MMCA.Common.API.Startup |
| 3 | `ApiControllerBase` | class | MMCA.Common.API.Controllers |
| 3 | `IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>` | interface | MMCA.Common.API.Controllers |
| 3 | `SignalRExtensions` | class | MMCA.Common.API.Startup |
| 3 | `UnhandledResultFailureFilter` | class | MMCA.Common.API.Middleware |
| 3 | `WebApplicationBuilderExtensions` | class | MMCA.Common.API.Startup |
| 4 | `CurrencyJsonConverter` | class | MMCA.Common.API.JsonConverters |
| 4 | `IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces |
| 4 | `IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>` | interface | MMCA.Common.Application.Interfaces |
| 4 | `WebApplicationExtensions` | class | MMCA.Common.API.Startup |
| 5 | `DependencyInjection` | class | MMCA.Common.API |
| 6 | `EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>` | class | MMCA.Common.API.Controllers |
| 6 | `OAuthControllerBase` | class | MMCA.Common.API.Controllers |
| 7 | `AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>` | class | MMCA.Common.API.Controllers |
| 8 | `DatabaseInitializationExtensions` | class | MMCA.Common.API.Startup |
| 10 | `AuthControllerBase` | class | MMCA.Common.API.Controllers |

### G13 - gRPC & Inter-Service Contracts

> `group-13-grpc-contracts.md` | 6 types | Typed gRPC clients/servers, interceptors, Result-over-the-wire, and the ServiceContract marker for synchronous inter-service calls (ADR-007).

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `JwtForwardingClientInterceptor` | class | MMCA.Common.Grpc.Interceptors |
| 0 | `ServiceContractAttribute` | class | MMCA.Common.Shared.Abstractions |
| 2 | `ResultFailureException` | class | MMCA.Common.Grpc.Exceptions |
| 3 | `GrpcResultExceptionInterceptor` | class | MMCA.Common.Grpc.Interceptors |
| 3 | `ResultGrpcExtensions` | class | MMCA.Common.Grpc |
| 4 | `DependencyInjection` | class | MMCA.Common.Grpc |

### G14 - Module System, Composition & Configuration

> `group-14-module-system-composition.md` | 34 types | IModule discovery + Kahn-ordered ModuleLoader, the DI composition roots, assembly markers, data-source/database attributes, and options/settings binding.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AssemblyReference` | class | MMCA.Common.Application |
| 0 | `AssemblyReference` | class | MMCA.Common.Domain |
| 0 | `AssemblyReference` | class | MMCA.Common.Infrastructure |
| 0 | `ClassReference` | class | MMCA.Common.Application |
| 0 | `ClassReference` | class | MMCA.Common.Domain |
| 0 | `ClassReference` | class | MMCA.Common.Infrastructure |
| 0 | `DataSourceEntrySettings` | class | MMCA.Common.Infrastructure.Settings |
| 0 | `FileStorageSettings` | class | MMCA.Common.Infrastructure.Settings |
| 0 | `IApplicationSettings` | interface | MMCA.Common.Application.Settings |
| 0 | `IConnectionStringSettings` | interface | MMCA.Common.Infrastructure.Settings |
| 0 | `IModuleSeeder` | interface | MMCA.Common.Application.Modules |
| 0 | `IPushNotificationSettings` | interface | MMCA.Common.Infrastructure.Settings |
| 0 | `ISmtpSettings` | interface | MMCA.Common.Infrastructure.Settings |
| 0 | `JwksSettings` | class | MMCA.Common.Infrastructure.Settings |
| 0 | `JwtSigningAlgorithm` | enum | MMCA.Common.Infrastructure.Settings |
| 0 | `MessageBusProvider` | enum | MMCA.Common.Infrastructure.Settings |
| 0 | `ModuleSettings` | class | MMCA.Common.Application.Settings |
| 0 | `NativePushSettings` | class | MMCA.Common.Infrastructure.Settings |
| 0 | `UseDatabaseAttribute` | class | MMCA.Common.Infrastructure |
| 1 | `ApplicationSettings` | class | MMCA.Common.Application.Settings |
| 1 | `ConnectionStringSettings` | class | MMCA.Common.Infrastructure.Settings |
| 1 | `DataSourcesSettings` | class | MMCA.Common.Infrastructure.Settings |
| 1 | `IJwtSettings` | interface | MMCA.Common.Infrastructure.Settings |
| 1 | `MessageBusSettings` | class | MMCA.Common.Infrastructure.Settings |
| 1 | `ModulesSettings` | class | MMCA.Common.Application.Settings |
| 1 | `PushNotificationSettings` | class | MMCA.Common.Infrastructure.Settings |
| 1 | `SmtpSettings` | class | MMCA.Common.Infrastructure.Settings |
| 1 | `UseDataSourceAttribute` | class | MMCA.Common.Infrastructure |
| 2 | `IModule` | interface | MMCA.Common.Application.Modules |
| 2 | `JwtSettings` | class | MMCA.Common.Infrastructure.Settings |
| 2 | `OutboxSettings` | class | MMCA.Common.Infrastructure.Settings |
| 3 | `ModuleLoader` | class | MMCA.Common.Application.Modules |
| 9 | `DependencyInjection` | class | MMCA.Common.Infrastructure |
| 9 | `DependencyInjection` | class | MMCA.Common.Application |

### G15 - Common UI Framework (MudBlazor components, theme, base pages)

> `group-15-common-ui-framework.md` | 82 types | Reusable Blazor building blocks: the data-grid list page base, theme, common pages/services, and UI extensions shared by every consumer app.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `BackNavigationResult` | record | MMCA.Common.UI.Services.Navigation |
| 0 | `BrandColors` | class | MMCA.Common.UI.Theme |
| 0 | `BreakpointConstants` | class | MMCA.Common.UI.Common |
| 0 | `CultureDelegatingHandler` | class | MMCA.Common.UI.Services |
| 0 | `IApiSettings` | interface | MMCA.Common.UI.Common.Settings |
| 0 | `IHomePageContent` | interface | MMCA.Common.UI.Common.Interfaces |
| 0 | `IOAuthUISettings` | interface | MMCA.Common.UI.Services.Auth |
| 0 | `ISessionCookieSync` | interface | MMCA.Common.UI.Services.Auth |
| 0 | `ITokenRefresher` | interface | MMCA.Common.UI.Services.Auth |
| 0 | `ITokenStorageService` | interface | MMCA.Common.UI.Services.Auth |
| 0 | `IUserPreferenceWriter` | interface | MMCA.Common.UI.Services |
| 0 | `JwtTokenInfo` | class | MMCA.Common.UI.Services.Auth |
| 0 | `LayoutSettings` | class | MMCA.Common.UI.Common.Settings |
| 0 | `ListPageState` | record | MMCA.Common.UI.Services |
| 0 | `LoginModel` | class | MMCA.Common.UI.Pages.Auth |
| 0 | `MudTranslations` | class | MMCA.Common.UI.Resources |
| 0 | `NavSection` | enum | MMCA.Common.UI.Common |
| 0 | `NotificationRoutePaths` | class | MMCA.Common.UI.Common |
| 0 | `NotificationState` | class | MMCA.Common.UI.Services.Notifications |
| 0 | `PasswordComplexityAttribute` | class | MMCA.Common.UI.Pages.Auth |
| 0 | `PersistedGridState` | record | MMCA.Common.UI.Pages.Common |
| 0 | `PseudoLocalizer` | class | MMCA.Common.UI.Globalization |
| 0 | `RegisterModel` | class | MMCA.Common.UI.Pages.Auth |
| 0 | `ReturnUrlProtector` | class | MMCA.Common.UI.Services.Navigation |
| 0 | `RoutePaths` | class | MMCA.Common.UI.Common |
| 0 | `SharedResource` | class | MMCA.Common.UI.Resources |
| 0 | `ThemeService` | class | MMCA.Common.UI.Services |
| 0 | `UIModuleConfiguration` | class | MMCA.Common.UI.Common.Settings |
| 0 | `UISharedAssemblyReference` | class | MMCA.Common.UI |
| 0 | `UserPreferences` | record | MMCA.Common.UI.Services |
| 0 | `UserPreferencesRequest` | record | MMCA.Common.UI.Services |
| 0 | `WebApplicationExtensions` | class | MMCA.Common.UI.Extensions |
| 1 | `ApiSettings` | class | MMCA.Common.UI.Common.Settings |
| 1 | `ApiUserPreferenceWriter` | class | MMCA.Common.UI.Services |
| 1 | `AuthDelegatingHandler` | class | MMCA.Common.UI.Services.Auth |
| 1 | `AuthenticatedServiceBase` | class | MMCA.Common.UI.Services |
| 1 | `ConfigurationOAuthUISettings` | class | MMCA.Common.UI.Services.Auth |
| 1 | `DefaultOAuthUISettings` | class | MMCA.Common.UI.Services.Auth |
| 1 | `DirectApiTokenRefresher` | class | MMCA.Common.UI.Services.Auth |
| 1 | `IUserPreferenceReader` | interface | MMCA.Common.UI.Services |
| 1 | `JsFetchSessionCookieSync` | class | MMCA.Common.UI.Services.Auth |
| 1 | `JwtAuthenticationStateProvider` | class | MMCA.Common.UI.Services.Auth |
| 1 | `ListPageQueryStateService` | class | MMCA.Common.UI.Services |
| 1 | `ListPageStateService` | class | MMCA.Common.UI.Services |
| 1 | `MauiBackNavigationBridge` | class | MMCA.Common.UI.Services.Navigation |
| 1 | `MmcaCultureBootstrap` | class | MMCA.Common.UI.Services |
| 1 | `MobileInfiniteScrollList<TItem>` | class | MMCA.Common.UI.Components |
| 1 | `NavigationHistoryService` | class | MMCA.Common.UI.Services.Navigation |
| 1 | `NavItem` | record | MMCA.Common.UI.Common |
| 1 | `PseudoStringLocalizer` | class | MMCA.Common.UI.Globalization |
| 1 | `ResxMudLocalizer` | class | MMCA.Common.UI.Globalization |
| 1 | `SameOriginProxyTokenRefresher` | class | MMCA.Common.UI.Services.Auth |
| 1 | `WasmTokenStorageService` | class | MMCA.Common.UI.Services.Auth |
| 2 | `ApiUserPreferenceReader` | class | MMCA.Common.UI.Services |
| 2 | `BlazorCspPolicyProvider` | class | MMCA.Common.UI.Web.Security |
| 2 | `ChannelSubscription` | class | MMCA.Common.UI.Services.Notifications |
| 2 | `ErrorMessages` | class | MMCA.Common.UI.Pages.Common |
| 2 | `IEntityService<TEntityDTO, TIdentifierType>` | interface | MMCA.Common.UI.Common.Interfaces |
| 2 | `INotificationInboxUIService` | interface | MMCA.Common.UI.Services.Notifications |
| 2 | `IPushNotificationUIService` | interface | MMCA.Common.UI.Services.Notifications |
| 2 | `IUIModule` | interface | MMCA.Common.UI.Common.Interfaces |
| 2 | `MMCATheme` | class | MMCA.Common.UI.Theme |
| 2 | `NotificationHubService` | class | MMCA.Common.UI.Services.Notifications |
| 2 | `PseudoStringLocalizerFactory` | class | MMCA.Common.UI.Globalization |
| 2 | `ServiceExceptionHelper` | class | MMCA.Common.UI.Services |
| 3 | `ChildEntityServiceBase` | class | MMCA.Common.UI.Services |
| 3 | `DataGridListPageBase<TDto>` | class | MMCA.Common.UI.Pages.Common |
| 3 | `EntityServiceBase<TEntityDTO, TIdentifierType>` | class | MMCA.Common.UI.Services |
| 3 | `NotificationBell` | class | MMCA.Common.UI.Components.Notifications |
| 3 | `NotificationInbox` | class | MMCA.Common.UI.Pages.Notifications |
| 3 | `NotificationInboxService` | class | MMCA.Common.UI.Services.Notifications |
| 3 | `NotificationList` | class | MMCA.Common.UI.Pages.Notifications |
| 3 | `NotificationSend` | class | MMCA.Common.UI.Pages.Notifications |
| 4 | `NotificationUIModule` | class | MMCA.Common.UI.Notifications |
| 4 | `PushNotificationService` | class | MMCA.Common.UI.Services.Notifications |
| 4 | `ServerTokenStorageService` | class | MMCA.Common.UI.Web.Services |
| 5 | `DependencyInjection` | class | MMCA.Common.UI.Notifications |
| 5 | `DependencyInjection` | class | MMCA.Common.UI.Web |
| 5 | `IAuthUIService` | interface | MMCA.Common.UI.Services.Auth |
| 5 | `MoneyExtensions` | class | MMCA.Common.UI.Extensions |
| 6 | `AuthUIService` | class | MMCA.Common.UI.Services.Auth |
| 7 | `DependencyInjection` | class | MMCA.Common.UI |

### G16 - Aspire Orchestration & Service Defaults

> `group-16-aspire-orchestration.md` | 16 types | The Aspire AppHost wiring, ServiceDefaults, warmup, telemetry and security helpers that compose and run the distributed app locally and in Azure.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `CspPolicy` | record | MMCA.Common.Aspire.Security |
| 0 | `Extensions` | class | MMCA.Common.Aspire.Hosting |
| 0 | `GatewayCorsExtensions` | class | MMCA.Common.Aspire |
| 0 | `HttpResilienceDefaults` | class | MMCA.Common.Shared.Resilience |
| 0 | `IWarmupTask` | interface | MMCA.Common.Aspire.Warmup |
| 0 | `OutboxPollFilterProcessor` | class | MMCA.Common.Aspire.Telemetry |
| 0 | `SecurityHeadersSettings` | class | MMCA.Common.Aspire.Security |
| 0 | `WarmupReadinessGate` | class | MMCA.Common.Aspire.Warmup |
| 1 | `ICspPolicyProvider` | interface | MMCA.Common.Aspire.Security |
| 1 | `OpenIdConnectMetadataWarmupTask` | class | MMCA.Common.Aspire.Warmup |
| 1 | `WarmupHostedService` | class | MMCA.Common.Aspire.Warmup |
| 1 | `WarmupReadinessHealthCheck` | class | MMCA.Common.Aspire.Warmup |
| 2 | `Extensions` | class | MMCA.Common.Aspire |
| 2 | `SecurityHeadersMiddleware` | class | MMCA.Common.Aspire.Security |
| 2 | `StaticCspPolicyProvider` | class | MMCA.Common.Aspire.Security |
| 3 | `SecurityHeadersExtensions` | class | MMCA.Common.Aspire.Security |

### G17 - ADC Conference - Domain Model & Module Contracts

> `group-17-conference-domain.md` | 85 types | The Conference bounded context: Event/Session/Speaker/Category/Question aggregates, their domain events and invariants, plus the Shared identifiers/DTOs/integration-event contracts.

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
| 0 | `ScoreEventSessionsResultDTO` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 0 | `SessionAiScoreDTO` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 0 | `SessionStatuses` | class | MMCA.ADC.Conference.Domain.Sessions |
| 0 | `SimilarSessionPair` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 0 | `SpeakerLocalitySummary` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 0 | `SpeakerSessionSummary` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 0 | `TextQuestionResponses` | record | MMCA.ADC.Conference.Shared.Speakers |
| 1 | `CategoryGroupDistribution` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 1 | `CategoryItemDTO` | record | MMCA.ADC.Conference.Shared.Categories |
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
| 3 | `CategoryChanged` | record | MMCA.ADC.Conference.Domain.Categories.DomainEvents |
| 3 | `EventChanged` | record | MMCA.ADC.Conference.Domain.Events.DomainEvents |
| 3 | `IEventLiveValidationService` | interface | MMCA.ADC.Conference.Shared.Events |
| 3 | `ISessionBookmarkValidationService` | interface | MMCA.ADC.Conference.Shared.Sessions |
| 3 | `QuestionChanged` | record | MMCA.ADC.Conference.Domain.Questions.DomainEvents |
| 3 | `SessionChanged` | record | MMCA.ADC.Conference.Domain.Sessions.DomainEvents |
| 3 | `SessionSelectionDashboardDTO` | record | MMCA.ADC.Conference.Shared.Sessions.DecisionSupport |
| 3 | `SpeakerChanged` | record | MMCA.ADC.Conference.Domain.Speakers.DomainEvents |
| 3 | `SpeakerLinkedToUser` | record | MMCA.ADC.Conference.Shared.Speakers.IntegrationEvents |
| 3 | `SpeakerUnlinkedFromUser` | record | MMCA.ADC.Conference.Shared.Speakers.IntegrationEvents |
| 4 | `DisabledEventLiveValidationService` | class | MMCA.ADC.Conference.Shared.Events |
| 4 | `DisabledSessionBookmarkValidationService` | class | MMCA.ADC.Conference.Shared.Sessions |
| 4 | `EventInvariants` | class | MMCA.ADC.Conference.Domain.Events |
| 4 | `QuestionInvariants` | class | MMCA.ADC.Conference.Domain.Questions |
| 4 | `SessionInvariants` | class | MMCA.ADC.Conference.Domain.Sessions |
| 4 | `SpeakerInvariants` | class | MMCA.ADC.Conference.Domain.Speakers |
| 5 | `Category` | class | MMCA.ADC.Conference.Domain.Categories |
| 5 | `CategoryInvariants` | class | MMCA.ADC.Conference.Domain.Categories |
| 5 | `CategoryItem` | class | MMCA.ADC.Conference.Domain.Categories |
| 5 | `Event` | class | MMCA.ADC.Conference.Domain.Events |
| 5 | `EventQuestionAnswer` | class | MMCA.ADC.Conference.Domain.Events |
| 5 | `EventSpeaker` | class | MMCA.ADC.Conference.Domain.Events |
| 5 | `Question` | class | MMCA.ADC.Conference.Domain.Questions |
| 5 | `Room` | class | MMCA.ADC.Conference.Domain.Events |
| 5 | `SessionAiScore` | class | MMCA.ADC.Conference.Domain.Sessions |
| 5 | `Speaker` | class | MMCA.ADC.Conference.Domain.Speakers |
| 5 | `SpeakerCategoryItem` | class | MMCA.ADC.Conference.Domain.Speakers |
| 5 | `SpeakerQuestionAnswer` | class | MMCA.ADC.Conference.Domain.Speakers |
| 6 | `CurrentEventSelector` | class | MMCA.ADC.Conference.Shared.Events |
| 6 | `Session` | class | MMCA.ADC.Conference.Domain.Sessions |
| 6 | `SessionCategoryItem` | class | MMCA.ADC.Conference.Domain.Sessions |
| 6 | `SessionQuestionAnswer` | class | MMCA.ADC.Conference.Domain.Sessions |
| 6 | `SessionSpeaker` | class | MMCA.ADC.Conference.Domain.Sessions |
| 7 | `CurrentEventDefaults` | class | MMCA.ADC.Conference.Shared.Events |
| 7 | `IEventCascadeDeletionDomainService` | interface | MMCA.ADC.Conference.Domain.Services |
| 8 | `EventCascadeDeletionDomainService` | class | MMCA.ADC.Conference.Domain.Services |

### G18 - ADC Conference - Application & Use Cases

> `group-18-conference-application.md` | 202 types | Conference CQRS handlers, validators, DTOs, specifications, the Sessionize import, and the session-selection decision-support analytics.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AssemblyReference` | class | MMCA.ADC.Conference.Application |
| 0 | `CategoryItemSortRules<T>` | class | MMCA.ADC.Conference.Application.Categories.Validation |
| 0 | `ClassReference` | class | MMCA.ADC.Conference.Application |
| 0 | `EventDateRangeRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 0 | `ExportEventCalendarQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar |
| 0 | `ExportSessionCalendarQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar |
| 0 | `GetCategoryDistributionQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution |
| 0 | `GetContentSimilarityQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity |
| 0 | `GetNowNextQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.NowNext |
| 0 | `GetPublicSessionFilterQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionFilter |
| 0 | `GetSessionBookmarkCountQuery` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCount |
| 0 | `GetSessionFeedbackQuery` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionFeedback |
| 0 | `GetSessionSelectionDashboardQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard |
| 0 | `GetSpeakersByEventFilterQuery` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSpeakersByEventFilter |
| 0 | `GetSpeakerSessionOverlapQuery` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSpeakerSessionOverlap |
| 0 | `RoomCapacityRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 0 | `RoomSortRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 0 | `ScoreEventSessionsCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 0 | `SessionEventIdRules<T>` | class | MMCA.ADC.Conference.Application.Sessions.Validation |
| 0 | `SessionizeCategoryItem` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 0 | `SessionizeLink` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 0 | `SessionizeQuestion` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 0 | `SessionizeQuestionAnswer` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 0 | `SessionizeRoom` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 0 | `SessionizeSyncResult` | record | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 0 | `SessionScoringResult` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 0 | `SessionSimilarityCalculator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity |
| 0 | `SpeakerInfo` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 0 | `StatusBucket` | enum | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution |
| 0 | `StatusBucket` | enum | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard |
| 1 | `ConferenceCategoryUpdateRequest` | record | MMCA.ADC.Conference.Application.Categories.UseCases.Update |
| 1 | `EventUpdateRequest` | record | MMCA.ADC.Conference.Application.Events.UseCases.Update |
| 1 | `QuestionUpdateRequest` | record | MMCA.ADC.Conference.Application.Questions.UseCases.Update |
| 1 | `SessionizeCategory` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 1 | `SessionizeSession` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 1 | `SessionizeSpeaker` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 1 | `SessionScoringInput` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 1 | `SessionUpdateRequest` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.Update |
| 1 | `SpeakerUpdateRequest` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.Update |
| 2 | `IAiScoringService` | interface | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 2 | `SessionizeResponse` | record | MMCA.ADC.Conference.Application.Events.Sessionize |
| 3 | `ISessionizeService` | interface | MMCA.ADC.Conference.Application.Events.Sessionize |
| 3 | `RoomChangedHandler` | class | MMCA.ADC.Conference.Application.Events.DomainEventHandlers |
| 3 | `UpdateEventResult` | record | MMCA.ADC.Conference.Application.Events.UseCases.Update |
| 3 | `UpdateSessionResult` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.Update |
| 4 | `SessionCreatedHandler` | class | MMCA.ADC.Conference.Application.Sessions.DomainEventHandlers |
| 4 | `SpeakerDeletedHandler` | class | MMCA.ADC.Conference.Application.Speakers.DomainEventHandlers |
| 5 | `EventNameRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 5 | `EventTimeZoneRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 5 | `QuestionTextRules<T>` | class | MMCA.ADC.Conference.Application.Questions.Validation |
| 5 | `RoomAccessibilityInfoRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 5 | `RoomFloorRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 5 | `RoomLocationRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 5 | `RoomNameRules<T>` | class | MMCA.ADC.Conference.Application.Events.Validation |
| 5 | `SessionTitleRules<T>` | class | MMCA.ADC.Conference.Application.Sessions.Validation |
| 5 | `SpeakerFirstNameRules<T>` | class | MMCA.ADC.Conference.Application.Speakers.Validation |
| 5 | `SpeakerLastNameRules<T>` | class | MMCA.ADC.Conference.Application.Speakers.Validation |
| 6 | `AddCategoryItemCommand` | record | MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem |
| 6 | `AddEventQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer |
| 6 | `AddEventSpeakerCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker |
| 6 | `AddRoomCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.AddRoom |
| 6 | `AddSpeakerCategoryItemCommand` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem |
| 6 | `CategoryItemDTOMapper` | class | MMCA.ADC.Conference.Application.Categories.DTOs |
| 6 | `CategoryItemNameRules<T>` | class | MMCA.ADC.Conference.Application.Categories.Validation |
| 6 | `ConferenceCategoryCreateRequest` | record | MMCA.ADC.Conference.Application.Categories.UseCases.Create |
| 6 | `ConferenceCategoryTitleRules<T>` | class | MMCA.ADC.Conference.Application.Categories.Validation |
| 6 | `EventCreateRequest` | record | MMCA.ADC.Conference.Application.Events.UseCases.Create |
| 6 | `EventQuestionAnswerDTOMapper` | class | MMCA.ADC.Conference.Application.Events.DTOs |
| 6 | `EventSpeakerDTOMapper` | class | MMCA.ADC.Conference.Application.Events.DTOs |
| 6 | `EventUpdateRequestValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.Update |
| 6 | `LinkUserToSpeakerCommand` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.LinkUser |
| 6 | `OwnEventQuestionAnswerSpecification` | class | MMCA.ADC.Conference.Application.Events.Specifications |
| 6 | `PublishedEventSpecification` | class | MMCA.ADC.Conference.Application.Events.Specifications |
| 6 | `PublishEventCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.Publish |
| 6 | `QuestionCreateRequest` | record | MMCA.ADC.Conference.Application.Questions.UseCases.Create |
| 6 | `QuestionDTOMapper` | class | MMCA.ADC.Conference.Application.Questions.DTOs |
| 6 | `QuestionUpdateRequestValidator` | class | MMCA.ADC.Conference.Application.Questions.UseCases.Update |
| 6 | `RefreshFromSessionizeCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 6 | `RemoveCategoryItemCommand` | record | MMCA.ADC.Conference.Application.Categories.UseCases.RemoveCategoryItem |
| 6 | `RemoveEventQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventQuestionAnswer |
| 6 | `RemoveEventSpeakerCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventSpeaker |
| 6 | `RemoveRoomCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.RemoveRoom |
| 6 | `RemoveSpeakerCategoryItemCommand` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.RemoveSpeakerCategoryItem |
| 6 | `RoomDTOMapper` | class | MMCA.ADC.Conference.Application.Events.DTOs |
| 6 | `SessionUpdateRequestValidator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.Update |
| 6 | `SpeakerCategoryItemDTOMapper` | class | MMCA.ADC.Conference.Application.Speakers.DTOs |
| 6 | `SpeakerCreateRequest` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.Create |
| 6 | `SpeakerLocalityHelper` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport |
| 6 | `SpeakerQuestionAnswerDTOMapper` | class | MMCA.ADC.Conference.Application.Speakers.DTOs |
| 6 | `SpeakerUpdateRequestValidator` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.Update |
| 6 | `UnlinkUserFromSpeakerCommand` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.UnlinkUser |
| 6 | `UnpublishEventCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.Unpublish |
| 6 | `UpdateCategoryItemCommand` | record | MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem |
| 6 | `UpdateConferenceCategoryCommand` | record | MMCA.ADC.Conference.Application.Categories.UseCases.Update |
| 6 | `UpdateEventCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.Update |
| 6 | `UpdateEventQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.UpdateEventQuestionAnswer |
| 6 | `UpdateQuestionCommand` | record | MMCA.ADC.Conference.Application.Questions.UseCases.Update |
| 6 | `UpdateRoomCommand` | record | MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom |
| 6 | `UpdateSpeakerCommand` | record | MMCA.ADC.Conference.Application.Speakers.UseCases.Update |
| 7 | `AddCategoryItemCommandValidator` | class | MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem |
| 7 | `AddEventQuestionAnswerCommandValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer |
| 7 | `AddEventSpeakerCommandValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker |
| 7 | `AddRoomCommandValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.AddRoom |
| 7 | `AddSessionCategoryItemCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem |
| 7 | `AddSessionQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer |
| 7 | `AddSessionSpeakerCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker |
| 7 | `AddSpeakerCategoryItemCommandValidator` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem |
| 7 | `CalendarExportMapper` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar |
| 7 | `ConferenceCategoryCreateRequestMapper` | class | MMCA.ADC.Conference.Application.Categories.UseCases.Create |
| 7 | `ConferenceCategoryCreateRequestValidator` | class | MMCA.ADC.Conference.Application.Categories.UseCases.Create |
| 7 | `ConferenceCategoryDTOMapper` | class | MMCA.ADC.Conference.Application.Categories.DTOs |
| 7 | `ConferenceCategoryUpdateRequestValidator` | class | MMCA.ADC.Conference.Application.Categories.UseCases.Update |
| 7 | `EventCreateRequestMapper` | class | MMCA.ADC.Conference.Application.Events.UseCases.Create |
| 7 | `EventCreateRequestValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.Create |
| 7 | `EventDTOMapper` | class | MMCA.ADC.Conference.Application.Events.DTOs |
| 7 | `OwnSessionQuestionAnswerSpecification` | class | MMCA.ADC.Conference.Application.Sessions.Specifications |
| 7 | `QuestionCreateRequestMapper` | class | MMCA.ADC.Conference.Application.Questions.UseCases.Create |
| 7 | `QuestionCreateRequestValidator` | class | MMCA.ADC.Conference.Application.Questions.UseCases.Create |
| 7 | `RemoveSessionCategoryItemCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionCategoryItem |
| 7 | `RemoveSessionQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionQuestionAnswer |
| 7 | `RemoveSessionSpeakerCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionSpeaker |
| 7 | `SessionCategoryItemDTOMapper` | class | MMCA.ADC.Conference.Application.Sessions.DTOs |
| 7 | `SessionCreateRequest` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.Create |
| 7 | `SessionQuestionAnswerDTOMapper` | class | MMCA.ADC.Conference.Application.Sessions.DTOs |
| 7 | `SessionSpeakerDTOMapper` | class | MMCA.ADC.Conference.Application.Sessions.DTOs |
| 7 | `SpeakerCreateRequestMapper` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.Create |
| 7 | `SpeakerCreateRequestValidator` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.Create |
| 7 | `SpeakerDTOMapper` | class | MMCA.ADC.Conference.Application.Speakers.DTOs |
| 7 | `UpdateCategoryItemCommandValidator` | class | MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem |
| 7 | `UpdateRoomCommandValidator` | class | MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom |
| 7 | `UpdateSessionCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.Update |
| 7 | `UpdateSessionQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application.Sessions.UseCases.UpdateSessionQuestionAnswer |
| 8 | `AddCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem |
| 8 | `AddEventQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer |
| 8 | `AddEventSpeakerHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker |
| 8 | `AddRoomHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.AddRoom |
| 8 | `AddSessionCategoryItemCommandValidator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem |
| 8 | `AddSessionCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem |
| 8 | `AddSessionQuestionAnswerCommandValidator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer |
| 8 | `AddSessionQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer |
| 8 | `AddSessionSpeakerCommandValidator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker |
| 8 | `AddSessionSpeakerHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker |
| 8 | `AddSpeakerCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem |
| 8 | `CreateConferenceCategoryHandler` | class | MMCA.ADC.Conference.Application.Categories.UseCases.Create |
| 8 | `CreateEventHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.Create |
| 8 | `CreateQuestionHandler` | class | MMCA.ADC.Conference.Application.Questions.UseCases.Create |
| 8 | `CreateSpeakerHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.Create |
| 8 | `DeleteEventHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.Delete |
| 8 | `EventLiveValidationService` | class | MMCA.ADC.Conference.Application.Events |
| 8 | `ExportEventCalendarHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar |
| 8 | `ExportSessionCalendarHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar |
| 8 | `GetCategoryDistributionHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution |
| 8 | `GetContentSimilarityHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity |
| 8 | `GetNowNextHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.NowNext |
| 8 | `GetSessionBookmarkCountHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCount |
| 8 | `GetSessionFeedbackHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionFeedback |
| 8 | `GetSessionSelectionDashboardHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard |
| 8 | `GetSpeakersByEventFilterHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.GetSpeakersByEventFilter |
| 8 | `GetSpeakerSessionOverlapHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSpeakerSessionOverlap |
| 8 | `LinkUserToSpeakerHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.LinkUser |
| 8 | `PublishEventHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.Publish |
| 8 | `RemoveCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Categories.UseCases.RemoveCategoryItem |
| 8 | `RemoveEventQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventQuestionAnswer |
| 8 | `RemoveEventSpeakerHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventSpeaker |
| 8 | `RemoveRoomHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.RemoveRoom |
| 8 | `RemoveSessionCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionCategoryItem |
| 8 | `RemoveSessionQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionQuestionAnswer |
| 8 | `RemoveSessionSpeakerHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionSpeaker |
| 8 | `RemoveSpeakerCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.RemoveSpeakerCategoryItem |
| 8 | `ScoreEventSessionsHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions |
| 8 | `SessionBookmarkValidationService` | class | MMCA.ADC.Conference.Application.Sessions |
| 8 | `SessionCreateRequestMapper` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.Create |
| 8 | `SessionCreateRequestValidator` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.Create |
| 8 | `SessionDTOMapper` | class | MMCA.ADC.Conference.Application.Sessions.DTOs |
| 8 | `SessionizeSyncContext` | record | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 8 | `UnlinkUserFromSpeakerHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.UnlinkUser |
| 8 | `UnpublishEventHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.Unpublish |
| 8 | `UpdateCategoryItemHandler` | class | MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem |
| 8 | `UpdateConferenceCategoryHandler` | class | MMCA.ADC.Conference.Application.Categories.UseCases.Update |
| 8 | `UpdateEventHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.Update |
| 8 | `UpdateEventQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.UpdateEventQuestionAnswer |
| 8 | `UpdateQuestionHandler` | class | MMCA.ADC.Conference.Application.Questions.UseCases.Update |
| 8 | `UpdateRoomHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom |
| 8 | `UpdateSessionQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.UpdateSessionQuestionAnswer |
| 8 | `UpdateSpeakerHandler` | class | MMCA.ADC.Conference.Application.Speakers.UseCases.Update |
| 8 | `UserRegisteredHandler` | class | MMCA.ADC.Conference.Application.Users.IntegrationEventHandlers |
| 9 | `CreateSessionHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.Create |
| 9 | `GetPublicSessionFilterHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionFilter |
| 9 | `ISessionizeSyncStrategy` | interface | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 9 | `SpeakerEntityQueryService` | class | MMCA.ADC.Conference.Application.Speakers |
| 9 | `UpdateSessionHandler` | class | MMCA.ADC.Conference.Application.Sessions.UseCases.Update |
| 10 | `CategorySyncStrategy` | class | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 10 | `ConferenceCategoryNavigationPopulator` | class | MMCA.ADC.Conference.Application.Categories |
| 10 | `EventNavigationPopulator` | class | MMCA.ADC.Conference.Application.Events |
| 10 | `QuestionSyncStrategy` | class | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 10 | `RoomSyncStrategy` | class | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 10 | `SessionNavigationPopulator` | class | MMCA.ADC.Conference.Application.Sessions |
| 10 | `SessionSyncStrategy` | class | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 10 | `SpeakerNavigationPopulator` | class | MMCA.ADC.Conference.Application.Speakers |
| 10 | `SpeakerSyncStrategy` | class | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |
| 11 | `DependencyInjection` | class | MMCA.ADC.Conference.Application |
| 11 | `RefreshFromSessionizeHandler` | class | MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize |

### G19 - ADC Conference - Infrastructure & Persistence

> `group-19-conference-infrastructure.md` | 27 types | The Conference module DbContext registration, EF entity configurations, database seeding, and infrastructure services.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AiScoreResponse` | record | MMCA.ADC.Conference.Infrastructure.Services |
| 0 | `AnthropicContentBlock` | record | MMCA.ADC.Conference.Infrastructure.Services |
| 0 | `AnthropicMessage` | record | MMCA.ADC.Conference.Infrastructure.Services |
| 0 | `AssemblyReference` | class | MMCA.ADC.Conference.Infrastructure |
| 0 | `ClassReference` | class | MMCA.ADC.Conference.Infrastructure |
| 1 | `AnthropicRequest` | record | MMCA.ADC.Conference.Infrastructure.Services |
| 1 | `AnthropicResponse` | record | MMCA.ADC.Conference.Infrastructure.Services |
| 3 | `AnthropicScoringService` | class | MMCA.ADC.Conference.Infrastructure.Services |
| 4 | `SessionizeService` | class | MMCA.ADC.Conference.Infrastructure.Services |
| 5 | `DependencyInjection` | class | MMCA.ADC.Conference.Infrastructure |
| 7 | `ModuleApplicationDbContext` | class | MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts |
| 8 | `CategoryItemConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `ConferenceCategoryConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `ConferenceModuleDbSeeder` | class | MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts.Seeding |
| 8 | `EventConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `EventQuestionAnswerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `EventSpeakerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `QuestionConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `RoomConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `SessionAiScoreConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `SessionCategoryItemConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `SessionConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `SessionQuestionAnswerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `SessionSpeakerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `SpeakerCategoryItemConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `SpeakerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |
| 8 | `SpeakerQuestionAnswerConfiguration` | class | MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration |

### G20 - ADC Conference - API, gRPC Contracts & Service Host

> `group-20-conference-api-grpc.md` | 40 types | Conference REST controllers, the .Contracts gRPC surface, the extractable service host, and the gRPC adapter.

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
| 0 | `ClassReference` | class | MMCA.ADC.Conference.API |
| 0 | `ConferenceErrorResources` | class | MMCA.ADC.Conference.API.Resources |
| 0 | `UpdateCategoryItemRequest` | record | MMCA.ADC.Conference.API.Controllers |
| 0 | `UpdateEventQuestionAnswerRequest` | record | MMCA.ADC.Conference.API.Controllers |
| 0 | `UpdateRoomRequest` | record | MMCA.ADC.Conference.API.Controllers |
| 0 | `UpdateSessionQuestionAnswerRequest` | record | MMCA.ADC.Conference.API.Controllers |
| 1 | `SelfHttpOutputCacheWarmupTask` | class | MMCA.ADC.Conference.Service |
| 2 | `DependencyInjection` | class | MMCA.ADC.Conference.API |
| 2 | `GrpcErrorTrailerParser` | class | MMCA.ADC.Conference.Contracts |
| 2 | `ServiceInfoController` | class | MMCA.ADC.Conference.API.Controllers |
| 4 | `SessionSelectionController` | class | MMCA.ADC.Conference.API.Controllers |
| 5 | `ConferenceModule` | class | MMCA.ADC.Conference.API |
| 7 | `CategoryItemsController` | class | MMCA.ADC.Conference.API.Controllers |
| 7 | `EventQuestionAnswersController` | class | MMCA.ADC.Conference.API.Controllers |
| 7 | `EventSpeakersController` | class | MMCA.ADC.Conference.API.Controllers |
| 7 | `RoomsController` | class | MMCA.ADC.Conference.API.Controllers |
| 7 | `SpeakerCategoryItemsController` | class | MMCA.ADC.Conference.API.Controllers |
| 8 | `ConferenceCategoriesController` | class | MMCA.ADC.Conference.API.Controllers |
| 8 | `EventsController` | class | MMCA.ADC.Conference.API.Controllers |
| 8 | `QuestionsController` | class | MMCA.ADC.Conference.API.Controllers |
| 8 | `SessionCategoryItemsController` | class | MMCA.ADC.Conference.API.Controllers |
| 8 | `SessionQuestionAnswersController` | class | MMCA.ADC.Conference.API.Controllers |
| 8 | `SessionsController` | class | MMCA.ADC.Conference.API.Controllers |
| 8 | `SessionSpeakersController` | class | MMCA.ADC.Conference.API.Controllers |
| 8 | `SpeakersController` | class | MMCA.ADC.Conference.API.Controllers |
| 9 | `ConferenceModuleSeeder` | class | MMCA.ADC.Conference.API |
| 9 | `EventLiveValidationGrpcService` | class | MMCA.ADC.Conference.Service.Grpc |
| 9 | `EventLiveValidationServiceGrpcAdapter` | class | MMCA.ADC.Conference.Contracts |
| 9 | `SessionBookmarksGrpcService` | class | MMCA.ADC.Conference.Service.Grpc |
| 9 | `SessionBookmarkValidationServiceGrpcAdapter` | class | MMCA.ADC.Conference.Contracts |
| 10 | `DependencyInjection` | class | MMCA.ADC.Conference.Contracts |

### G21 - ADC Conference - UI

> `group-21-conference-ui.md` | 79 types | The Conference Blazor pages (events, sessions, speakers, categories, questions, rooms, feedback, public, session-selection) and their UI services.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `CategoryItemInfo` | record | MMCA.ADC.Conference.UI.Services |
| 0 | `ConferenceRoutePaths` | class | MMCA.ADC.Conference.UI |
| 0 | `EventInfo` | record | MMCA.ADC.Conference.UI.Services |
| 0 | `IPublicLinkBuilder` | interface | MMCA.ADC.Conference.UI.Services |
| 0 | `SessionSelectionDisplay` | class | MMCA.ADC.Conference.UI.Pages.SessionSelection |
| 0 | `SpeakerInfo` | record | MMCA.ADC.Conference.UI.Services |
| 1 | `ICategoryItemLookupService` | interface | MMCA.ADC.Conference.UI.Services |
| 1 | `IEventLookupService` | interface | MMCA.ADC.Conference.UI.Services |
| 1 | `ISpeakerLookupService` | interface | MMCA.ADC.Conference.UI.Services |
| 1 | `NavigationPublicLinkBuilder` | class | MMCA.ADC.Conference.UI.Services |
| 2 | `IEventSpeakerUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 2 | `IOrganizerEventFeedbackUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 2 | `IOrganizerSessionFeedbackUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 2 | `ISessionCategoryItemUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 2 | `ISessionSpeakerUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 2 | `ISpeakerCategoryItemUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 2 | `SessionSelectionSpeakerOverlap` | class | MMCA.ADC.Conference.UI.Pages.SessionSelection |
| 3 | `CachedSessionPage` | record | MMCA.ADC.Conference.UI.Pages.Public |
| 3 | `CategoryItemLookupService` | class | MMCA.ADC.Conference.UI.Services |
| 3 | `ConferenceUIModule` | class | MMCA.ADC.Conference.UI |
| 3 | `EventLookupService` | class | MMCA.ADC.Conference.UI.Services |
| 3 | `ICategoryItemUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `IConferenceCategoryUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `IEventUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `IQuestionUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `IRoomUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `ISessionUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `ISpeakerDashboardUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `ISpeakerUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 3 | `OrganizerEventFeedbackService` | class | MMCA.ADC.Conference.UI.Services |
| 3 | `OrganizerSessionFeedbackService` | class | MMCA.ADC.Conference.UI.Services |
| 3 | `PublicSessionListFilterBar` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 3 | `SpeakerLookupService` | class | MMCA.ADC.Conference.UI.Services |
| 4 | `CategoryItemService` | class | MMCA.ADC.Conference.UI.Services |
| 4 | `ConferenceCategoryCreate` | class | MMCA.ADC.Conference.UI.Pages.ConferenceCategory |
| 4 | `ConferenceCategoryList` | class | MMCA.ADC.Conference.UI.Pages.ConferenceCategory |
| 4 | `ConferenceCategoryService` | class | MMCA.ADC.Conference.UI.Services |
| 4 | `EventService` | class | MMCA.ADC.Conference.UI.Services |
| 4 | `EventSpeakerService` | class | MMCA.ADC.Conference.UI.Services |
| 4 | `ISessionSelectionUIService` | interface | MMCA.ADC.Conference.UI.Services |
| 4 | `PublicSessionListView` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 4 | `QuestionService` | class | MMCA.ADC.Conference.UI.Services |
| 4 | `RoomService` | class | MMCA.ADC.Conference.UI.Services |
| 4 | `SessionCategoryItemService` | class | MMCA.ADC.Conference.UI.Services |
| 4 | `SessionSelectionAiScores` | class | MMCA.ADC.Conference.UI.Pages.SessionSelection |
| 4 | `SessionService` | class | MMCA.ADC.Conference.UI.Services |
| 4 | `SessionSpeakerService` | class | MMCA.ADC.Conference.UI.Services |
| 4 | `SpeakerCategoryItemService` | class | MMCA.ADC.Conference.UI.Services |
| 4 | `SpeakerDashboardService` | class | MMCA.ADC.Conference.UI.Services |
| 4 | `SpeakerService` | class | MMCA.ADC.Conference.UI.Services |
| 5 | `EventCreate` | class | MMCA.ADC.Conference.UI.Pages.Event |
| 5 | `EventList` | class | MMCA.ADC.Conference.UI.Pages.Event |
| 5 | `OrganizerEventFeedback` | class | MMCA.ADC.Conference.UI.Pages.Feedback |
| 5 | `OrganizerSessionFeedback` | class | MMCA.ADC.Conference.UI.Pages.Feedback |
| 5 | `PublicEventList` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 5 | `QuestionCreate` | class | MMCA.ADC.Conference.UI.Pages.Question |
| 5 | `QuestionList` | class | MMCA.ADC.Conference.UI.Pages.Question |
| 5 | `RoomCreate` | class | MMCA.ADC.Conference.UI.Pages.Room |
| 5 | `SessionCreate` | class | MMCA.ADC.Conference.UI.Pages.Session |
| 5 | `SessionSelectionService` | class | MMCA.ADC.Conference.UI.Services |
| 5 | `SpeakerCreate` | class | MMCA.ADC.Conference.UI.Pages.Speaker |
| 6 | `ConferenceCategoryDetail` | class | MMCA.ADC.Conference.UI.Pages.ConferenceCategory |
| 6 | `DependencyInjection` | class | MMCA.ADC.Conference.UI |
| 6 | `EventDetail` | class | MMCA.ADC.Conference.UI.Pages.Event |
| 6 | `PublicEventDetail` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 6 | `PublicSpeakerDetail` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 6 | `QuestionDetail` | class | MMCA.ADC.Conference.UI.Pages.Question |
| 6 | `RoomDetail` | class | MMCA.ADC.Conference.UI.Pages.Room |
| 6 | `SpeakerCategoryItemsPanel` | class | MMCA.ADC.Conference.UI.Pages.Speaker |
| 6 | `SpeakerDetail` | class | MMCA.ADC.Conference.UI.Pages.Speaker |
| 7 | `PublicSessionDetail` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 7 | `PublicSpeakerList` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 7 | `RoomList` | class | MMCA.ADC.Conference.UI.Pages.Room |
| 7 | `SessionDetail` | class | MMCA.ADC.Conference.UI.Pages.Session |
| 7 | `SessionSelectionDashboard` | class | MMCA.ADC.Conference.UI.Pages.SessionSelection |
| 7 | `SpeakerDashboard` | class | MMCA.ADC.Conference.UI.Pages.Speaker |
| 7 | `SpeakerList` | class | MMCA.ADC.Conference.UI.Pages.Speaker |
| 8 | `PublicSessionList` | class | MMCA.ADC.Conference.UI.Pages.Public |
| 8 | `SessionList` | class | MMCA.ADC.Conference.UI.Pages.Session |

### G22 - ADC Engagement Module (Session Bookmarks)

> `group-22-engagement-module.md` | 67 types | The Engagement bounded context end-to-end: bookmark aggregate, use cases, persistence, API/contracts/service, and feedback UI.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AnswerState` | class | MMCA.ADC.Engagement.UI.Pages.Feedback |
| 0 | `AssemblyReference` | class | MMCA.ADC.Engagement.API |
| 0 | `AssemblyReference` | class | MMCA.ADC.Engagement.Infrastructure |
| 0 | `AssemblyReference` | class | MMCA.ADC.Engagement.Application |
| 0 | `AssemblyReference` | class | MMCA.ADC.Engagement.Domain |
| 0 | `ClassReference` | class | MMCA.ADC.Engagement.API |
| 0 | `ClassReference` | class | MMCA.ADC.Engagement.Infrastructure |
| 0 | `ClassReference` | class | MMCA.ADC.Engagement.Application |
| 0 | `ClassReference` | class | MMCA.ADC.Engagement.Domain |
| 0 | `CreateBookmarkRequest` | record | MMCA.ADC.Engagement.Shared.UserSessionBookmarks |
| 0 | `DependencyInjection` | class | MMCA.ADC.Engagement.Infrastructure |
| 0 | `EngagementErrorResources` | class | MMCA.ADC.Engagement.API.Resources |
| 0 | `EngagementFeatures` | class | MMCA.ADC.Engagement.Shared |
| 0 | `EngagementPermissions` | class | MMCA.ADC.Engagement.Shared.Authorization |
| 0 | `EngagementRoutePaths` | class | MMCA.ADC.Engagement.UI |
| 0 | `GetBookmarkedSessionIdsQuery` | record | MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetBookmarkedSessionIds |
| 0 | `GetUserBookmarksQuery` | record | MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetUserBookmarks |
| 0 | `IBookmarkCountService` | interface | MMCA.ADC.Engagement.Shared.UserSessionBookmarks |
| 0 | `SessionReminder` | record | MMCA.ADC.Engagement.UI.Services |
| 0 | `UserEngagementBookmarkExportDTO` | record | MMCA.ADC.Engagement.Shared.Exports |
| 0 | `UserEngagementSubmittedQuestionExportDTO` | record | MMCA.ADC.Engagement.Shared.Exports |
| 1 | `CreateBookmarkRequestValidator` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.Create |
| 1 | `DisabledBookmarkCountService` | class | MMCA.ADC.Engagement.Shared.UserSessionBookmarks |
| 1 | `SessionReminderPlanner` | class | MMCA.ADC.Engagement.UI.Services |
| 1 | `UserEngagementExportDTO` | record | MMCA.ADC.Engagement.Shared.Exports |
| 1 | `UserSessionBookmarkDTO` | record | MMCA.ADC.Engagement.Shared.UserSessionBookmarks |
| 2 | `DependencyInjection` | class | MMCA.ADC.Engagement.API |
| 2 | `IBookmarkUIService` | interface | MMCA.ADC.Engagement.UI.Services |
| 2 | `IEventFeedbackUIService` | interface | MMCA.ADC.Engagement.UI.Services |
| 2 | `IQuestionLookupService` | interface | MMCA.ADC.Engagement.UI.Services |
| 2 | `ISessionBookmarkUIService` | interface | MMCA.ADC.Engagement.Shared.UserSessionBookmarks |
| 2 | `ISessionFeedbackUIService` | interface | MMCA.ADC.Engagement.UI.Services |
| 2 | `IUserEngagementExportService` | interface | MMCA.ADC.Engagement.Shared.Exports |
| 2 | `SessionReminderCoordinator` | class | MMCA.ADC.Engagement.UI.Services |
| 2 | `UserSessionBookmarkChanged` | record | MMCA.ADC.Engagement.Domain.UserSessionBookmarks.DomainEvents |
| 3 | `BookmarkService` | class | MMCA.ADC.Engagement.UI.Services |
| 3 | `DisabledUserEngagementExportService` | class | MMCA.ADC.Engagement.Shared.Exports |
| 3 | `EngagementUIModule` | class | MMCA.ADC.Engagement.UI |
| 3 | `EventFeedback` | class | MMCA.ADC.Engagement.UI.Pages.Feedback |
| 3 | `EventFeedbackService` | class | MMCA.ADC.Engagement.UI.Services |
| 3 | `QuestionLookupService` | class | MMCA.ADC.Engagement.UI.Services |
| 3 | `SessionBookmarkUIService` | class | MMCA.ADC.Engagement.UI.Services |
| 3 | `SessionFeedbackService` | class | MMCA.ADC.Engagement.UI.Services |
| 4 | `EngagementModule` | class | MMCA.ADC.Engagement.API |
| 4 | `UserSessionBookmarkInvariants` | class | MMCA.ADC.Engagement.Domain.UserSessionBookmarks |
| 5 | `SessionFeedback` | class | MMCA.ADC.Engagement.UI.Pages.Feedback |
| 5 | `UserSessionBookmark` | class | MMCA.ADC.Engagement.Domain.UserSessionBookmarks |
| 6 | `BookmarksController` | class | MMCA.ADC.Engagement.API.Controllers |
| 6 | `IBookmarkManagementDomainService` | interface | MMCA.ADC.Engagement.Domain.Services |
| 6 | `UserSessionBookmarkDTOMapper` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.DTOs |
| 7 | `BookmarkManagementDomainService` | class | MMCA.ADC.Engagement.Domain.Services |
| 7 | `ModuleApplicationDbContext` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.DbContexts |
| 8 | `BookmarkCountService` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.Services |
| 8 | `CreateBookmarkHandler` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.Create |
| 8 | `DependencyInjection` | class | MMCA.ADC.Engagement.UI |
| 8 | `GetBookmarkedSessionIdsHandler` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetBookmarkedSessionIds |
| 8 | `GetUserBookmarksHandler` | class | MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetUserBookmarks |
| 8 | `SessionQuestionConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration |
| 8 | `SessionQuestionUpvoteConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration |
| 8 | `UserEngagementExportService` | class | MMCA.ADC.Engagement.Application.Exports |
| 8 | `UserSessionBookmarkConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration |
| 9 | `BookmarkCountServiceGrpcAdapter` | class | MMCA.ADC.Engagement.Contracts |
| 9 | `BookmarkCountsGrpcService` | class | MMCA.ADC.Engagement.Service.Grpc |
| 9 | `UserEngagementExportGrpcService` | class | MMCA.ADC.Engagement.Service.Grpc |
| 9 | `UserEngagementExportServiceGrpcAdapter` | class | MMCA.ADC.Engagement.Contracts |
| 10 | `DependencyInjection` | class | MMCA.ADC.Engagement.Contracts |
| 11 | `DependencyInjection` | class | MMCA.ADC.Engagement.Application |

### G26 - ADC Engagement Live Layer (Real-Time Polls & Session Q&A)

> `group-23-engagement-live-layer.md` | 92 types | Real-time audience interaction in the Engagement bounded context: event-wide live polls with voting and moderated per-session Q&A with upvoting, over the SignalR hub-channel transport (ADR-039) and the cross-service gRPC live-channel adapter.

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
| 0 | `GetSessionQuestionsQuery` | record | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetSessionQuestions |
| 0 | `ISessionLiveUIService` | interface | MMCA.ADC.Engagement.Shared.SessionQuestions |
| 0 | `LiveEventContext` | record | MMCA.ADC.Engagement.UI.Services |
| 0 | `LivePollChannel` | class | MMCA.ADC.Engagement.Shared.LivePolls |
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
| 1 | `ISessionLookupService` | interface | MMCA.ADC.Engagement.UI.Services |
| 1 | `LivePollDTO` | record | MMCA.ADC.Engagement.Shared.LivePolls |
| 1 | `LivePollResultsDTO` | record | MMCA.ADC.Engagement.Shared.LivePolls |
| 1 | `ModerateQuestionCommand` | record | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Moderate |
| 1 | `SessionLiveUIService` | class | MMCA.ADC.Engagement.UI.Services |
| 1 | `SessionQuestionDTO` | record | MMCA.ADC.Engagement.Shared.SessionQuestions |
| 1 | `ToggleUpvoteCommandValidator` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote |
| 2 | `ILivePollUIService` | interface | MMCA.ADC.Engagement.UI.Services |
| 2 | `ISessionQuestionUIService` | interface | MMCA.ADC.Engagement.UI.Services |
| 2 | `LivePollChanged` | record | MMCA.ADC.Engagement.Domain.LivePolls.DomainEvents |
| 2 | `LivePollVoteChanged` | record | MMCA.ADC.Engagement.Domain.LivePolls.DomainEvents |
| 2 | `SessionQuestionChanged` | record | MMCA.ADC.Engagement.Domain.SessionQuestions.DomainEvents |
| 2 | `SessionQuestionUpvoteChanged` | record | MMCA.ADC.Engagement.Domain.SessionQuestions.DomainEvents |
| 3 | `LivePollAuthorization` | class | MMCA.ADC.Engagement.Application.LivePolls.Services |
| 3 | `LivePollUIService` | class | MMCA.ADC.Engagement.UI.Services |
| 3 | `SessionLivePollPanel` | class | MMCA.ADC.Engagement.UI.Pages.SessionLive |
| 3 | `SessionLookupService` | class | MMCA.ADC.Engagement.UI.Services |
| 3 | `SessionQuestionUIService` | class | MMCA.ADC.Engagement.UI.Services |
| 4 | `LivePollInvariants` | class | MMCA.ADC.Engagement.Domain.LivePolls |
| 4 | `LivePollVoteInvariants` | class | MMCA.ADC.Engagement.Domain.LivePolls |
| 4 | `SessionQuestionInvariants` | class | MMCA.ADC.Engagement.Domain.SessionQuestions |
| 4 | `SessionQuestionsController` | class | MMCA.ADC.Engagement.API.Controllers |
| 4 | `SessionQuestionUpvoteInvariants` | class | MMCA.ADC.Engagement.Domain.SessionQuestions |
| 5 | `CreateLivePollRequestValidator` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create |
| 5 | `LivePollVote` | class | MMCA.ADC.Engagement.Domain.LivePolls |
| 5 | `PresenterView` | class | MMCA.ADC.Engagement.UI.Pages.SessionLive |
| 5 | `SessionLive` | class | MMCA.ADC.Engagement.UI.Pages.SessionLive |
| 5 | `SessionLiveQuestionPanel` | class | MMCA.ADC.Engagement.UI.Pages.SessionLive |
| 5 | `SessionQuestion` | class | MMCA.ADC.Engagement.Domain.SessionQuestions |
| 5 | `SessionQuestionUpvote` | class | MMCA.ADC.Engagement.Domain.SessionQuestions |
| 5 | `SubmitQuestionCommandValidator` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Submit |
| 6 | `CreateLivePollCommandValidator` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create |
| 6 | `LivePoll` | class | MMCA.ADC.Engagement.Domain.LivePolls |
| 6 | `LivePollOption` | class | MMCA.ADC.Engagement.Domain.LivePolls |
| 6 | `SessionLiveModerationPanel` | class | MMCA.ADC.Engagement.UI.Pages.SessionLive |
| 7 | `LiveEventService` | class | MMCA.ADC.Engagement.UI.Services |
| 7 | `LivePollDTOMapper` | class | MMCA.ADC.Engagement.Application.LivePolls.DTOs |
| 7 | `LivePollsController` | class | MMCA.ADC.Engagement.API.Controllers |
| 8 | `CloseLivePollHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Close |
| 8 | `CreateLivePollHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create |
| 8 | `GetEventPollsHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetEventPolls |
| 8 | `HappeningNow` | class | MMCA.ADC.Engagement.UI.Pages.HappeningNow |
| 8 | `LivePollConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration |
| 8 | `LivePollOptionConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration |
| 8 | `LivePollResultsBuilder` | class | MMCA.ADC.Engagement.Application.LivePolls.Services |
| 8 | `LivePollVoteConfiguration` | class | MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration |
| 8 | `ModerateQuestionHandler` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Moderate |
| 8 | `OpenLivePollHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.Open |
| 8 | `SessionQuestionViewBuilder` | class | MMCA.ADC.Engagement.Application.SessionQuestions.Services |
| 8 | `ToggleUpvoteHandler` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote |
| 9 | `CastVoteHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.CastVote |
| 9 | `GetModerationQueueHandler` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetModerationQueue |
| 9 | `GetOpenPollsHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetOpenPolls |
| 9 | `GetPollResultsHandler` | class | MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetPollResults |
| 9 | `GetSessionQuestionsHandler` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetSessionQuestions |
| 9 | `SubmitQuestionHandler` | class | MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Submit |
| 10 | `LivePollNavigationPopulator` | class | MMCA.ADC.Engagement.Application.LivePolls.Services |

### G23 - ADC Identity Module (Users, Profiles, GDPR Export/Erasure)

> `group-24-identity-module.md` | 78 types | The Identity bounded context end-to-end: the User aggregate, change-password/delete/export use cases, persistence, API/contracts/service, and profile/user UI.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `AssemblyReference` | class | MMCA.ADC.Identity.API |
| 0 | `AssemblyReference` | class | MMCA.ADC.Identity.Application |
| 0 | `AssemblyReference` | class | MMCA.ADC.Identity.Domain |
| 0 | `AssemblyReference` | class | MMCA.ADC.Identity.Infrastructure |
| 0 | `ChangePreferencesRequest` | record | MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences |
| 0 | `ClassReference` | class | MMCA.ADC.Identity.Domain |
| 0 | `ClassReference` | class | MMCA.ADC.Identity.API |
| 0 | `ClassReference` | class | MMCA.ADC.Identity.Application |
| 0 | `ClassReference` | class | MMCA.ADC.Identity.Infrastructure |
| 0 | `DependencyInjection` | class | MMCA.ADC.Identity.Infrastructure |
| 0 | `ExportUserDataQuery` | record | MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData |
| 0 | `GetUserAvatarQuery` | record | MMCA.ADC.Identity.Application.Users.UseCases.GetUserAvatar |
| 0 | `GetUserPreferencesQuery` | record | MMCA.ADC.Identity.Application.Users.UseCases.GetPreferences |
| 0 | `GetUsersQuery` | record | MMCA.ADC.Identity.Application.Users.UseCases.GetUsers |
| 0 | `IAttendeeQueryService` | interface | MMCA.ADC.Identity.Shared.Users |
| 0 | `IdentityErrorResources` | class | MMCA.ADC.Identity.API.Resources |
| 0 | `IdentityPermissions` | class | MMCA.ADC.Identity.Shared.Authorization |
| 0 | `IdentityRoutePaths` | class | MMCA.ADC.Identity.UI |
| 0 | `IdentitySettings` | class | MMCA.ADC.Identity.Shared |
| 0 | `RemoveUserAvatarCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.RemoveUserAvatar |
| 0 | `SetUserAvatarCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.SetUserAvatar |
| 0 | `UserAvatarDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 0 | `UserDataExportBookmarkDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 0 | `UserDataExportNotificationDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 0 | `UserDataExportSubmittedQuestionDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 0 | `UserListDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 0 | `UserPreferencesResponse` | record | MMCA.ADC.Identity.Application.Users.UseCases.GetPreferences |
| 1 | `ChangePasswordRequestValidator` | class | MMCA.ADC.Identity.Application.Users.Validation |
| 1 | `DisabledAttendeeQueryService` | class | MMCA.ADC.Identity.Shared.Users |
| 1 | `IUserUIService` | interface | MMCA.ADC.Identity.UI.Services |
| 1 | `UserDataExportEngagementSectionDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 1 | `UserDataExportNotificationSectionDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 1 | `UserDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 2 | `DependencyInjection` | class | MMCA.ADC.Identity.API |
| 2 | `UserDataExportDTO` | record | MMCA.ADC.Identity.Shared.Users |
| 2 | `UserDeleted` | record | MMCA.ADC.Identity.Domain.Users.DomainEvents |
| 2 | `UserPasswordChanged` | record | MMCA.ADC.Identity.Domain.Users.DomainEvents |
| 3 | `IdentityModule` | class | MMCA.ADC.Identity.API |
| 3 | `IdentityUIModule` | class | MMCA.ADC.Identity.UI |
| 3 | `UserRegistered` | record | MMCA.ADC.Identity.Shared.Users.IntegrationEvents |
| 3 | `UserService` | class | MMCA.ADC.Identity.UI.Services |
| 4 | `DependencyInjection` | class | MMCA.ADC.Identity.UI |
| 4 | `UserClaimsController` | class | MMCA.ADC.Identity.API.Controllers |
| 4 | `UserList` | class | MMCA.ADC.Identity.UI.Pages.User |
| 4 | `UserRole` | class | MMCA.ADC.Identity.Domain.Users |
| 5 | `UserInvariants` | class | MMCA.ADC.Identity.Domain.Users |
| 6 | `Profile` | class | MMCA.ADC.Identity.UI.Pages.Profile |
| 6 | `RegisterRequestValidator` | class | MMCA.ADC.Identity.Application.Users.Validation |
| 6 | `User` | class | MMCA.ADC.Identity.Domain.Users |
| 7 | `ChangePasswordCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.ChangePassword |
| 7 | `ChangePreferencesCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences |
| 7 | `DeleteUserCommand` | record | MMCA.ADC.Identity.Application.Users.UseCases.DeleteUser |
| 7 | `ModuleApplicationDbContext` | class | MMCA.ADC.Identity.Infrastructure.Persistence.DbContexts |
| 7 | `OAuthController` | class | MMCA.ADC.Identity.API.Controllers |
| 7 | `UserDTOMapper` | class | MMCA.ADC.Identity.Application.Users.DTOs |
| 8 | `AttendeeQueryService` | class | MMCA.ADC.Identity.Application.Users |
| 8 | `ChangePasswordHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.ChangePassword |
| 8 | `ChangePreferencesHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences |
| 8 | `DeleteUserHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.DeleteUser |
| 8 | `ExportUserDataHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData |
| 8 | `GetUserAvatarHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.GetUserAvatar |
| 8 | `GetUserPreferencesHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.GetPreferences |
| 8 | `GetUsersHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.GetUsers |
| 8 | `IdentityModuleDbSeeder` | class | MMCA.ADC.Identity.Infrastructure.Persistence.DbContexts.Seeding |
| 8 | `SetUserAvatarHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.SetUserAvatar |
| 8 | `SoftDeletedUserValidator` | class | MMCA.ADC.Identity.Application.Users |
| 8 | `SpeakerLinkedToUserHandler` | class | MMCA.ADC.Identity.Application.Speakers.IntegrationEventHandlers |
| 8 | `SpeakerUnlinkedFromUserHandler` | class | MMCA.ADC.Identity.Application.Speakers.IntegrationEventHandlers |
| 8 | `UserConfiguration` | class | MMCA.ADC.Identity.Infrastructure.Persistence.EntityConfiguration |
| 8 | `UsersController` | class | MMCA.ADC.Identity.API.Controllers |
| 9 | `AttendeeQueryServiceGrpcAdapter` | class | MMCA.ADC.Identity.Contracts |
| 9 | `AttendeesGrpcService` | class | MMCA.ADC.Identity.Service.Grpc |
| 9 | `AuthenticationService` | class | MMCA.ADC.Identity.Application.Users |
| 9 | `IdentityModuleSeeder` | class | MMCA.ADC.Identity.API |
| 9 | `RemoveUserAvatarHandler` | class | MMCA.ADC.Identity.Application.Users.UseCases.RemoveUserAvatar |
| 10 | `DependencyInjection` | class | MMCA.ADC.Identity.Application |
| 10 | `DependencyInjection` | class | MMCA.ADC.Identity.Contracts |
| 11 | `AuthController` | class | MMCA.ADC.Identity.API.Controllers |

### G24 - ADC Application Host, UI Shell & Cross-Module Composition

> `group-25-adc-host-composition.md` | 34 types | The ADC host: the Blazor Web/WASM/WinUI shells, host pages/services, security, and the cross-module application composition.

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `ADCEventInfo` | record | MMCA.ADC.UI.Web.Client.Pages |
| 0 | `ADCEventInfo` | record | MMCA.ADC.UI.Pages |
| 0 | `ConferenceTrackInfo` | record | MMCA.ADC.UI.Web.Client.Pages |
| 0 | `ConferenceTrackInfo` | record | MMCA.ADC.UI.Pages |
| 0 | `EventPhase` | enum | MMCA.ADC.UI.Web.Client.Pages |
| 0 | `EventPhase` | enum | MMCA.ADC.UI.Pages |
| 0 | `KeynoteSpeakerInfo` | record | MMCA.ADC.UI.Pages |
| 0 | `KeynoteSpeakerInfo` | record | MMCA.ADC.UI.Web.Client.Pages |
| 0 | `NowNextSession` | record | MMCA.ADC.UI |
| 0 | `SponsorInfo` | record | MMCA.ADC.UI.Pages |
| 0 | `SponsorInfo` | record | MMCA.ADC.UI.Web.Client.Pages |
| 0 | `WebAuthenticatorCallbackActivity` | class | MMCA.ADC.UI |
| 1 | `ADCCollectionResult` | record | MMCA.ADC.UI.Web.Client.Pages |
| 1 | `ADCCollectionResult` | record | MMCA.ADC.UI.Pages |
| 1 | `AppActionsInitializer` | class | MMCA.ADC.UI.Services |
| 1 | `MauiPublicLinkBuilder` | class | MMCA.ADC.UI.Services |
| 1 | `MauiTokenStorageService` | class | MMCA.ADC.UI.Services |
| 1 | `NowNextSnapshot` | record | MMCA.ADC.UI |
| 1 | `SponsorTierInfo` | record | MMCA.ADC.UI.Web.Client.Pages |
| 1 | `SponsorTierInfo` | record | MMCA.ADC.UI.Pages |
| 2 | `MainPage` | class | MMCA.ADC.UI |
| 3 | `App` | class | MMCA.ADC.UI |
| 3 | `DeviceUIModule` | class | MMCA.ADC.UI |
| 3 | `MainActivity` | class | MMCA.ADC.UI |
| 4 | `NowNextWidgetProvider` | class | MMCA.ADC.UI |
| 7 | `ADCHome` | class | MMCA.ADC.UI.Web.Client.Pages |
| 7 | `ADCHome` | class | MMCA.ADC.UI.Pages |
| 8 | `ADCHomePageContent` | class | MMCA.ADC.UI.Pages |
| 8 | `ADCHomePageContent` | class | MMCA.ADC.UI.Web.Client.Pages |
| 9 | `MauiProgram` | class | MMCA.ADC.UI |
| 10 | `App` | class | MMCA.ADC.UI.WinUI |
| 10 | `AppDelegate` | class | MMCA.ADC.UI |
| 10 | `MainApplication` | class | MMCA.ADC.UI |
| 11 | `Program` | class | MMCA.ADC.UI |

### G27 - Device Capability Abstraction Layer (Native Contracts, MAUI, Browser & Fallback Adapters)

> `group-26-device-capability-layer.md` | 87 types | Per-capability interface contracts (biometric, geocoding/geolocation, speech, push registration, media/clipboard/screenshot, haptics, share, external auth/links, local cache/notifications, connectivity/battery/accessibility, deep links) plus their MAUI-native, browser-JS-interop, and inert fallback implementations, selected per host at DI composition time (ADR-042/043/044/045).

| Level | Type | Kind | Namespace |
|-------|------|------|-----------|
| 0 | `CapabilitiesJsModule` | class | MMCA.Common.UI.Services.Capabilities.Browser |
| 0 | `DevicePreferenceKeys` | class | MMCA.Common.UI.Services.Capabilities |
| 0 | `GeoPoint` | record | MMCA.Common.UI.Services.Capabilities |
| 0 | `IAccessibilityAnnouncer` | interface | MMCA.Common.UI.Services.Capabilities |
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
| 0 | `PickedMedia` | class | MMCA.Common.UI.Services.Capabilities |
| 0 | `PushDeviceToken` | record | MMCA.Common.UI.Services.Capabilities |
| 1 | `AlwaysOnlineConnectivityStatusService` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `BrowserAccessibilityAnnouncer` | class | MMCA.Common.UI.Services.Capabilities.Browser |
| 1 | `BrowserClipboardService` | class | MMCA.Common.UI.Services.Capabilities.Browser |
| 1 | `BrowserConnectivityStatusService` | class | MMCA.Common.UI.Services.Capabilities.Browser |
| 1 | `BrowserDevicePreferences` | class | MMCA.Common.UI.Services.Capabilities.Browser |
| 1 | `BrowserExternalLinkService` | class | MMCA.Common.UI.Services.Capabilities.Browser |
| 1 | `BrowserLocalCacheStore` | class | MMCA.Common.UI.Services.Capabilities.Browser |
| 1 | `BrowserMapNavigationService` | class | MMCA.Common.UI.Services.Capabilities.Browser |
| 1 | `BrowserShareService` | class | MMCA.Common.UI.Services.Capabilities.Browser |
| 1 | `DeepLinkRouteEventArgs` | class | MMCA.Common.UI.Services.Capabilities |
| 1 | `IGeocodingService` | interface | MMCA.Common.UI.Services.Capabilities |
| 1 | `IGeolocationService` | interface | MMCA.Common.UI.Services.Capabilities |
| 1 | `ILocalNotificationService` | interface | MMCA.Common.UI.Services.Capabilities |
| 1 | `IMediaPickerService` | interface | MMCA.Common.UI.Services.Capabilities |
| 1 | `InMemoryDevicePreferences` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
| 1 | `IPushDeviceTokenProvider` | interface | MMCA.Common.UI.Services.Capabilities |
| 1 | `MauiAccessibilityAnnouncer` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiBatteryStatusService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiBiometricAuthenticator` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiClipboardService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiConnectivityStatusService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiDevicePreferences` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiExternalLinkService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiFormFactor` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiHapticFeedbackService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiLocalCacheStore` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiMapNavigationService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiScreenshotService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiShareService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiSpeechToTextService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `MauiTextToSpeechService` | class | MMCA.Common.UI.Maui.Capabilities |
| 1 | `NullAccessibilityAnnouncer` | class | MMCA.Common.UI.Services.Capabilities.Fallbacks |
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
| 2 | `IDeepLinkDispatcher` | interface | MMCA.Common.UI.Services.Capabilities |
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

> `group-27-testing-infrastructure.md` | 1170 types | All test projects + the reusable Testing/Testing.E2E/Testing.UI bases, architecture-fitness tests, and the component Gallery harness; individual [Fact]s are rolled up by project (logged exception).

Rolled up by project (individual `[Fact]`s not sectioned - logged exception). Reusable test
infrastructure assemblies (sectioned in full in the chapter) are marked **(infra)**.

| Test project (assembly) | Types | Levels | Kind |
|--------------------------|-------|--------|------|
| `MMCA.ADC.Architecture.Tests` **(infra)** | 26 | L1-L10 |  |
| `MMCA.ADC.Conference.API.Tests`  | 15 | L1-L9 |  |
| `MMCA.ADC.Conference.Application.Tests`  | 139 | L0-L12 |  |
| `MMCA.ADC.Conference.Domain.Tests`  | 22 | L5-L9 |  |
| `MMCA.ADC.Conference.Infrastructure.Tests`  | 7 | L0-L10 |  |
| `MMCA.ADC.Conference.IntegrationTests`  | 36 | L1-L16 |  |
| `MMCA.ADC.Conference.Shared.Tests`  | 17 | L0-L8 |  |
| `MMCA.ADC.Conference.UI.Tests`  | 25 | L3-L9 |  |
| `MMCA.ADC.CrossService.IntegrationTests`  | 12 | L0-L16 |  |
| `MMCA.ADC.E2E.Tests`  | 60 | L0-L5 |  |
| `MMCA.ADC.Engagement.API.Tests`  | 6 | L1-L8 |  |
| `MMCA.ADC.Engagement.Application.Tests`  | 27 | L0-L10 |  |
| `MMCA.ADC.Engagement.Domain.Tests`  | 6 | L6-L8 |  |
| `MMCA.ADC.Engagement.Infrastructure.Tests`  | 2 | L9-L10 |  |
| `MMCA.ADC.Engagement.IntegrationTests`  | 13 | L4-L16 |  |
| `MMCA.ADC.Engagement.Shared.Tests`  | 2 | L2-L2 |  |
| `MMCA.ADC.Engagement.UI.Tests`  | 14 | L3-L7 |  |
| `MMCA.ADC.Gateway.Tests`  | 3 | L12-L13 |  |
| `MMCA.ADC.Identity.API.Tests`  | 7 | L1-L12 |  |
| `MMCA.ADC.Identity.Application.Tests`  | 20 | L2-L10 |  |
| `MMCA.ADC.Identity.Domain.Tests`  | 4 | L7-L7 |  |
| `MMCA.ADC.Identity.Infrastructure.Tests`  | 4 | L8-L10 |  |
| `MMCA.ADC.Identity.IntegrationTests`  | 28 | L0-L17 |  |
| `MMCA.ADC.Identity.Shared.Tests`  | 3 | L2-L5 |  |
| `MMCA.ADC.Identity.UI.Tests`  | 6 | L3-L7 |  |
| `MMCA.ADC.Notification.IntegrationTests`  | 7 | L1-L16 |  |
| `MMCA.Common.API.Tests`  | 65 | L0-L12 |  |
| `MMCA.Common.Application.Tests`  | 147 | L0-L10 |  |
| `MMCA.Common.Architecture.Tests` **(infra)** | 22 | L4-L8 |  |
| `MMCA.Common.Aspire.Tests`  | 10 | L0-L3 |  |
| `MMCA.Common.Benchmarks`  | 4 | L2-L4 |  |
| `MMCA.Common.Domain.Tests`  | 43 | L0-L6 |  |
| `MMCA.Common.Grpc.Tests`  | 13 | L0-L4 |  |
| `MMCA.Common.Infrastructure.Tests`  | 157 | L0-L10 |  |
| `MMCA.Common.Shared.Tests`  | 22 | L0-L5 |  |
| `MMCA.Common.Testing` **(infra)** | 10 | L0-L2 |  |
| `MMCA.Common.Testing.Architecture` **(infra)** | 36 | L0-L4 |  |
| `MMCA.Common.Testing.E2E` **(infra)** | 21 | L0-L4 |  |
| `MMCA.Common.Testing.UI` **(infra)** | 15 | L0-L3 |  |
| `MMCA.Common.UI.E2E.Tests`  | 11 | L8-L11 |  |
| `MMCA.Common.UI.Gallery` **(infra)** | 8 | L0-L7 |  |
| `MMCA.Common.UI.Tests`  | 71 | L0-L6 |  |
| `MMCA.Common.UI.Web.Tests`  | 4 | L1-L5 |  |

