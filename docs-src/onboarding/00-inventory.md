# Phase 0: Type Inventory

Generated mechanically by a Roslyn syntactic parse of every in-scope `.cs` file under
`MMCA.Common/Source`, `MMCA.Common/Tests`, `MMCA.ADC/Source`, `MMCA.ADC/Tests`.

- Files scanned: **2950** (in-scope **2828**, generated/excluded **122**)
- Type declaration rows (including partial-class fragments): **3797**
- Distinct type nodes (partials collapsed): **3668**
- `extension(T)` blocks: **78**

## Counts by kind

| Kind | Count (declarations) |
|------|------|
| class | 2978 |
| record | 569 |
| interface | 201 |
| enum | 29 |
| record struct | 18 |
| delegate | 1 |
| struct | 1 |

## Counts by assembly (distinct nodes)

| Assembly | Distinct types |
|----------|------|
| MMCA.ADC.Architecture.Tests | 35 |
| MMCA.ADC.Conference.API | 36 |
| MMCA.ADC.Conference.API.Tests | 20 |
| MMCA.ADC.Conference.Application | 285 |
| MMCA.ADC.Conference.Application.Tests | 166 |
| MMCA.ADC.Conference.Contracts | 4 |
| MMCA.ADC.Conference.Domain | 45 |
| MMCA.ADC.Conference.Domain.Tests | 28 |
| MMCA.ADC.Conference.Infrastructure | 33 |
| MMCA.ADC.Conference.Infrastructure.Tests | 15 |
| MMCA.ADC.Conference.IntegrationTests | 37 |
| MMCA.ADC.Conference.Service | 3 |
| MMCA.ADC.Conference.Shared | 55 |
| MMCA.ADC.Conference.Shared.Tests | 17 |
| MMCA.ADC.Conference.UI | 106 |
| MMCA.ADC.Conference.UI.Tests | 45 |
| MMCA.ADC.CrossService.IntegrationTests | 11 |
| MMCA.ADC.E2E.Tests | 83 |
| MMCA.ADC.Engagement.API | 10 |
| MMCA.ADC.Engagement.API.Tests | 9 |
| MMCA.ADC.Engagement.Application | 85 |
| MMCA.ADC.Engagement.Application.Tests | 59 |
| MMCA.ADC.Engagement.Contracts | 3 |
| MMCA.ADC.Engagement.Domain | 30 |
| MMCA.ADC.Engagement.Domain.Tests | 11 |
| MMCA.ADC.Engagement.Infrastructure | 15 |
| MMCA.ADC.Engagement.Infrastructure.Tests | 4 |
| MMCA.ADC.Engagement.IntegrationTests | 22 |
| MMCA.ADC.Engagement.Service | 3 |
| MMCA.ADC.Engagement.Shared | 61 |
| MMCA.ADC.Engagement.Shared.Tests | 7 |
| MMCA.ADC.Engagement.UI | 67 |
| MMCA.ADC.Engagement.UI.Tests | 34 |
| MMCA.ADC.Gateway | 1 |
| MMCA.ADC.Gateway.Tests | 8 |
| MMCA.ADC.Identity.API | 12 |
| MMCA.ADC.Identity.API.Tests | 7 |
| MMCA.ADC.Identity.Application | 34 |
| MMCA.ADC.Identity.Application.Tests | 28 |
| MMCA.ADC.Identity.Contracts | 2 |
| MMCA.ADC.Identity.Domain | 7 |
| MMCA.ADC.Identity.Domain.Tests | 4 |
| MMCA.ADC.Identity.Infrastructure | 6 |
| MMCA.ADC.Identity.Infrastructure.Tests | 4 |
| MMCA.ADC.Identity.IntegrationTests | 34 |
| MMCA.ADC.Identity.Service | 2 |
| MMCA.ADC.Identity.Shared | 17 |
| MMCA.ADC.Identity.Shared.Tests | 3 |
| MMCA.ADC.Identity.UI | 8 |
| MMCA.ADC.Identity.UI.Tests | 6 |
| MMCA.ADC.Notification.API | 2 |
| MMCA.ADC.Notification.API.Tests | 1 |
| MMCA.ADC.Notification.Application | 3 |
| MMCA.ADC.Notification.Application.Tests | 5 |
| MMCA.ADC.Notification.Contracts | 3 |
| MMCA.ADC.Notification.IntegrationTests | 9 |
| MMCA.ADC.Notification.Service | 2 |
| MMCA.ADC.Notification.Shared | 3 |
| MMCA.ADC.ServiceBusEmulator.IntegrationTests | 3 |
| MMCA.ADC.Services.Tests | 5 |
| MMCA.ADC.UI | 16 |
| MMCA.ADC.UI.Web.Client | 1 |
| MMCA.Common.API | 96 |
| MMCA.Common.API.Tests | 121 |
| MMCA.Common.Application | 186 |
| MMCA.Common.Application.Tests | 265 |
| MMCA.Common.Architecture.Tests | 89 |
| MMCA.Common.Aspire | 27 |
| MMCA.Common.Aspire.Hosting | 1 |
| MMCA.Common.Aspire.Tests | 36 |
| MMCA.Common.Benchmarks | 6 |
| MMCA.Common.Domain | 47 |
| MMCA.Common.Domain.Tests | 57 |
| MMCA.Common.Grpc | 5 |
| MMCA.Common.Grpc.Tests | 15 |
| MMCA.Common.Infrastructure | 184 |
| MMCA.Common.Infrastructure.Redis.Tests | 2 |
| MMCA.Common.Infrastructure.Tests | 323 |
| MMCA.Common.Shared | 68 |
| MMCA.Common.Shared.Tests | 33 |
| MMCA.Common.Testing | 19 |
| MMCA.Common.Testing.Architecture | 48 |
| MMCA.Common.Testing.E2E | 25 |
| MMCA.Common.Testing.Tests | 17 |
| MMCA.Common.Testing.UI | 15 |
| MMCA.Common.UI | 152 |
| MMCA.Common.UI.E2E.Tests | 15 |
| MMCA.Common.UI.Gallery | 9 |
| MMCA.Common.UI.Maui | 31 |
| MMCA.Common.UI.Tests | 88 |
| MMCA.Common.UI.Web | 4 |
| MMCA.Common.UI.Web.Tests | 4 |

## Full inventory

| Type | Kind | Assembly | Namespace | File:Line |
|------|------|----------|-----------|-----------|
| `AdcArchitectureMap` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/AdcArchitectureMap.cs:8` |
| `AnonymousEndpointTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/AnonymousEndpointTests.cs:21` |
| `BrandColorTokenTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/BrandColorTokenTests.cs:12` |
| `ConcurrencyConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/ConcurrencyConventionTests.cs:3` |
| `ConstructorDependencyCountTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/ConstructorDependencyCountTests.cs:17` |
| `ControllerConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/ControllerConventionTests.cs:3` |
| `DataResidencyTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:12` |
| `DecoratorPipelineOrderTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/DecoratorPipelineOrderTests.cs:27` |
| `DomainPurityTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/DomainPurityTests.cs:3` |
| `EntityConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/EntityConventionTests.cs:3` |
| `EventConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/EventConventionTests.cs:3` |
| `FormsConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/FormsConventionTests.cs:14` |
| `FrameworkVersionConsistencyTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/FrameworkVersionConsistencyTests.cs:9` |
| `HandlerConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/HandlerConventionTests.cs:3` |
| `HandlerResultConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/HandlerResultConventionTests.cs:8` |
| `IdempotencyConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/IdempotencyConventionTests.cs:3` |
| `ImmutabilityTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/ImmutabilityTests.cs:3` |
| `IntegrationEventContractTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/IntegrationEventContractTests.cs:3` |
| `LayerDependencyTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/LayerDependencyTests.cs:3` |
| `LocalizedTextConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/LocalizedTextConventionTests.cs:14` |
| `MicroserviceExtractionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/MicroserviceExtractionTests.cs:3` |
| `MiddlewarePipelineOrderTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/MiddlewarePipelineOrderTests.cs:15` |
| `ModuleIsolationTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/ModuleIsolationTests.cs:3` |
| `NamingConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/NamingConventionTests.cs:3` |
| `ObservabilityConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/ObservabilityConventionTests.cs:7` |
| `PiiConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/PiiConventionTests.cs:3` |
| `ProtoContractTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/ProtoContractTests.cs:3` |
| `RawQueryableConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/RawQueryableConventionTests.cs:11` |
| `ServiceContractPurityTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/ServiceContractPurityTests.cs:9` |
| `SharedLayerTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/SharedLayerTests.cs:3` |
| `SliceCohesionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/SliceCohesionTests.cs:8` |
| `SpecificationConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/SpecificationConventionTests.cs:8` |
| `StateManagementConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/StateManagementConventionTests.cs:9` |
| `TranslationCompletenessTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/TranslationCompletenessTests.cs:12` |
| `UIArchitectureConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/UIArchitectureConventionTests.cs:10` |
| `AssemblyReference` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API` | `MMCA.ADC.Conference.API/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API` | `MMCA.ADC.Conference.API/AssemblyReference.cs:11` |
| `ConferenceModule` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API` | `MMCA.ADC.Conference.API/ConferenceModule.cs:15` |
| `ConferenceModuleSeeder` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API` | `MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:13` |
| `DependencyInjection` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API` | `MMCA.ADC.Conference.API/DependencyInjection.cs:14` |
| `CurrentUserServiceExtensions` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Authorization` | `MMCA.ADC.Conference.API/Authorization/CurrentUserServiceExtensions.cs:10` |
| `ActivitiesController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/ActivitiesController.cs:37` |
| `AddCategoryItemRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:25` |
| `AddEventQuestionAnswerRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:27` |
| `AddEventSpeakerRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/EventSpeakersController.cs:29` |
| `AddRoomRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/RoomsController.cs:30` |
| `AddSessionCategoryItemRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SessionCategoryItemsController.cs:29` |
| `AddSessionQuestionAnswerRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:27` |
| `AddSessionSpeakerRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SessionSpeakersController.cs:29` |
| `AddSpeakerCategoryItemRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SpeakerCategoryItemsController.cs:29` |
| `CategoryItemsController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:62` |
| `ConferenceCategoriesController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/ConferenceCategoriesController.cs:32` |
| `EventQuestionAnswersController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:57` |
| `EventsController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/EventsController.cs:45` |
| `EventSpeakersController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/EventSpeakersController.cs:47` |
| `QuestionsController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/QuestionsController.cs:31` |
| `RoomsController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/RoomsController.cs:92` |
| `ServiceInfoController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/ServiceInfoController.cs:20` |
| `SessionCategoryItemsController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SessionCategoryItemsController.cs:48` |
| `SessionQuestionAnswersController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:57` |
| `SessionsController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SessionsController.cs:42` |
| `SessionSelectionController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SessionSelectionController.cs:30` |
| `SessionSpeakersController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SessionSpeakersController.cs:48` |
| `SpeakerCategoryItemsController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SpeakerCategoryItemsController.cs:48` |
| `SpeakersController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SpeakersController.cs:44` |
| `SponsorsController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SponsorsController.cs:37` |
| `UpdateCategoryItemRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:41` |
| `UpdateEventQuestionAnswerRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:40` |
| `UpdateRoomRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/RoomsController.cs:58` |
| `UpdateSessionQuestionAnswerRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:40` |
| `ConferenceErrorResources` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Resources` | `MMCA.ADC.Conference.API/Resources/ConferenceErrorResources.cs:11` |
| `ConferencePermissionGrantsTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Authorization` | `MMCA.ADC.Conference.API.Tests/Authorization/ConferencePermissionGrantsTests.cs:14` |
| `ActivitiesControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/ActivitiesControllerTests.cs:26` |
| `CategoryItemsControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/CategoryItemsControllerTests.cs:19` |
| `ConditionalWriteConventionTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/ConditionalWriteConventionTests.cs:16` |
| `ConferenceCategoriesControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/ConferenceCategoriesControllerTests.cs:18` |
| `EntityExportAuthorizationTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/EntityExportAuthorizationTests.cs:18` |
| `EventQuestionAnswersControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/EventQuestionAnswersControllerTests.cs:20` |
| `EventsControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/EventsControllerTests.cs:28` |
| `EventSpeakersControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/EventSpeakersControllerTests.cs:25` |
| `QuestionsControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/QuestionsControllerTests.cs:18` |
| `RoomsControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/RoomsControllerTests.cs:26` |
| `SessionCategoryItemsControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/SessionCategoryItemsControllerTests.cs:25` |
| `SessionQuestionAnswersControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/SessionQuestionAnswersControllerTests.cs:20` |
| `SessionsControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/SessionsControllerTests.cs:29` |
| `SessionSelectionControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/SessionSelectionControllerTests.cs:19` |
| `SessionSpeakersControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/SessionSpeakersControllerTests.cs:25` |
| `SpeakerCategoryItemsControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/SpeakerCategoryItemsControllerTests.cs:25` |
| `SpeakersControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/SpeakersControllerTests.cs:31` |
| `SponsorsControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/SponsorsControllerTests.cs:26` |
| `ConferenceErrorResourcesTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Localization` | `MMCA.ADC.Conference.API.Tests/Localization/ConferenceErrorResourcesTests.cs:15` |
| `AssemblyReference` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application` | `MMCA.ADC.Conference.Application/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application` | `MMCA.ADC.Conference.Application/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application` | `MMCA.ADC.Conference.Application/DependencyInjection.cs:39` |
| `ActivityNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities` | `MMCA.ADC.Conference.Application/Activities/ActivityNavigationPopulator.cs:12` |
| `ActivityDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.DTOs` | `MMCA.ADC.Conference.Application/Activities/DTOs/ActivityDTOMapper.cs:13` |
| `ActivityCreateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.UseCases.Create` | `MMCA.ADC.Conference.Application/Activities/UseCases/Create/ActivityCreateRequest.cs:10` |
| `ActivityCreateRequestMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.UseCases.Create` | `MMCA.ADC.Conference.Application/Activities/UseCases/Create/ActivityCreateRequestMapper.cs:11` |
| `ActivityCreateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.UseCases.Create` | `MMCA.ADC.Conference.Application/Activities/UseCases/Create/ActivityCreateRequestValidator.cs:7` |
| `CreateActivityHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.UseCases.Create` | `MMCA.ADC.Conference.Application/Activities/UseCases/Create/CreateActivityHandler.cs:16` |
| `GetPublicActivityFilterHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.UseCases.GetPublicActivityFilter` | `MMCA.ADC.Conference.Application/Activities/UseCases/GetPublicActivityFilter/GetPublicActivityFilterHandler.cs:16` |
| `GetPublicActivityFilterQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.UseCases.GetPublicActivityFilter` | `MMCA.ADC.Conference.Application/Activities/UseCases/GetPublicActivityFilter/GetPublicActivityFilterQuery.cs:13` |
| `ActivityUpdateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.UseCases.Update` | `MMCA.ADC.Conference.Application/Activities/UseCases/Update/ActivityUpdateRequest.cs:10` |
| `ActivityUpdateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.UseCases.Update` | `MMCA.ADC.Conference.Application/Activities/UseCases/Update/ActivityUpdateRequestValidator.cs:7` |
| `UpdateActivityCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.UseCases.Update` | `MMCA.ADC.Conference.Application/Activities/UseCases/Update/UpdateActivityCommand.cs:9` |
| `UpdateActivityHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.UseCases.Update` | `MMCA.ADC.Conference.Application/Activities/UseCases/Update/UpdateActivityHandler.cs:15` |
| `ActivityDescriptionRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.Validation` | `MMCA.ADC.Conference.Application/Activities/Validation/ActivityValidationRules.cs:25` |
| `ActivityEventIdRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.Validation` | `MMCA.ADC.Conference.Application/Activities/Validation/ActivityValidationRules.cs:74` |
| `ActivityNameRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.Validation` | `MMCA.ADC.Conference.Application/Activities/Validation/ActivityValidationRules.cs:13` |
| `ActivitySortOrderRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.Validation` | `MMCA.ADC.Conference.Application/Activities/Validation/ActivityValidationRules.cs:111` |
| `ActivityTimeRangeRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.Validation` | `MMCA.ADC.Conference.Application/Activities/Validation/ActivityValidationRules.cs:87` |
| `ActivityVenueAddressRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.Validation` | `MMCA.ADC.Conference.Application/Activities/Validation/ActivityValidationRules.cs:49` |
| `ActivityVenueNameRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.Validation` | `MMCA.ADC.Conference.Application/Activities/Validation/ActivityValidationRules.cs:37` |
| `ActivityVenueUrlRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Activities.Validation` | `MMCA.ADC.Conference.Application/Activities/Validation/ActivityValidationRules.cs:62` |
| `CategoryItemNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories` | `MMCA.ADC.Conference.Application/Categories/CategoryItemNavigationPopulator.cs:11` |
| `ConferenceCategoryNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories` | `MMCA.ADC.Conference.Application/Categories/ConferenceCategoryNavigationPopulator.cs:11` |
| `CategoryItemDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.DTOs` | `MMCA.ADC.Conference.Application/Categories/DTOs/CategoryItemDTOMapper.cs:12` |
| `ConferenceCategoryDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.DTOs` | `MMCA.ADC.Conference.Application/Categories/DTOs/ConferenceCategoryDTOMapper.cs:13` |
| `AddCategoryItemCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem` | `MMCA.ADC.Conference.Application/Categories/UseCases/AddCategoryItem/AddCategoryItemCommand.cs:14` |
| `AddCategoryItemCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem` | `MMCA.ADC.Conference.Application/Categories/UseCases/AddCategoryItem/AddCategoryItemCommandValidator.cs:7` |
| `AddCategoryItemHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem` | `MMCA.ADC.Conference.Application/Categories/UseCases/AddCategoryItem/AddCategoryItemHandler.cs:15` |
| `ConferenceCategoryCreateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.Create` | `MMCA.ADC.Conference.Application/Categories/UseCases/Create/ConferenceCategoryCreateRequest.cs:10` |
| `ConferenceCategoryCreateRequestMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.Create` | `MMCA.ADC.Conference.Application/Categories/UseCases/Create/ConferenceCategoryCreateRequestMapper.cs:11` |
| `ConferenceCategoryCreateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.Create` | `MMCA.ADC.Conference.Application/Categories/UseCases/Create/ConferenceCategoryCreateRequestValidator.cs:7` |
| `CreateConferenceCategoryHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.Create` | `MMCA.ADC.Conference.Application/Categories/UseCases/Create/CreateConferenceCategoryHandler.cs:16` |
| `RemoveCategoryItemCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.RemoveCategoryItem` | `MMCA.ADC.Conference.Application/Categories/UseCases/RemoveCategoryItem/RemoveCategoryItemCommand.cs:12` |
| `RemoveCategoryItemHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.RemoveCategoryItem` | `MMCA.ADC.Conference.Application/Categories/UseCases/RemoveCategoryItem/RemoveCategoryItemHandler.cs:13` |
| `ConferenceCategoryUpdateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.Update` | `MMCA.ADC.Conference.Application/Categories/UseCases/Update/ConferenceCategoryUpdateRequest.cs:6` |
| `ConferenceCategoryUpdateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.Update` | `MMCA.ADC.Conference.Application/Categories/UseCases/Update/ConferenceCategoryUpdateRequestValidator.cs:7` |
| `UpdateConferenceCategoryCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.Update` | `MMCA.ADC.Conference.Application/Categories/UseCases/Update/UpdateConferenceCategoryCommand.cs:9` |
| `UpdateConferenceCategoryHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.Update` | `MMCA.ADC.Conference.Application/Categories/UseCases/Update/UpdateConferenceCategoryHandler.cs:15` |
| `UpdateCategoryItemCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem` | `MMCA.ADC.Conference.Application/Categories/UseCases/UpdateCategoryItem/UpdateCategoryItemCommand.cs:14` |
| `UpdateCategoryItemCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem` | `MMCA.ADC.Conference.Application/Categories/UseCases/UpdateCategoryItem/UpdateCategoryItemCommandValidator.cs:7` |
| `UpdateCategoryItemHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem` | `MMCA.ADC.Conference.Application/Categories/UseCases/UpdateCategoryItem/UpdateCategoryItemHandler.cs:13` |
| `CategoryItemNameRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.Validation` | `MMCA.ADC.Conference.Application/Categories/Validation/ConferenceCategoryValidationRules.cs:27` |
| `CategoryItemSortRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.Validation` | `MMCA.ADC.Conference.Application/Categories/Validation/ConferenceCategoryValidationRules.cs:40` |
| `ConferenceCategoryTitleRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.Validation` | `MMCA.ADC.Conference.Application/Categories/Validation/ConferenceCategoryValidationRules.cs:13` |
| `PublicConferenceVisibility` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Common` | `MMCA.ADC.Conference.Application/Common/PublicConferenceVisibility.cs:28` |
| `EventLiveValidationService` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events` | `MMCA.ADC.Conference.Application/Events/EventLiveValidationService.cs:22` |
| `EventNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events` | `MMCA.ADC.Conference.Application/Events/EventNavigationPopulator.cs:11` |
| `EventQuestionAnswerNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events` | `MMCA.ADC.Conference.Application/Events/EventQuestionAnswerNavigationPopulator.cs:11` |
| `EventSpeakerNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events` | `MMCA.ADC.Conference.Application/Events/EventSpeakerNavigationPopulator.cs:11` |
| `RoomNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events` | `MMCA.ADC.Conference.Application/Events/RoomNavigationPopulator.cs:11` |
| `RoomChangedHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.DomainEventHandlers` | `MMCA.ADC.Conference.Application/Events/DomainEventHandlers/RoomChangedHandler.cs:11` |
| `EventDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.DTOs` | `MMCA.ADC.Conference.Application/Events/DTOs/EventDTOMapper.cs:14` |
| `EventQuestionAnswerDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.DTOs` | `MMCA.ADC.Conference.Application/Events/DTOs/EventQuestionAnswerDTOMapper.cs:12` |
| `EventSpeakerDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.DTOs` | `MMCA.ADC.Conference.Application/Events/DTOs/EventSpeakerDTOMapper.cs:12` |
| `RoomDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.DTOs` | `MMCA.ADC.Conference.Application/Events/DTOs/RoomDTOMapper.cs:12` |
| `ISessionizeService` | interface | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Sessionize` | `MMCA.ADC.Conference.Application/Events/Sessionize/ISessionizeService.cs:6` |
| `SessionizeCategory` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Sessionize` | `MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:41` |
| `SessionizeCategoryItem` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Sessionize` | `MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:60` |
| `SessionizeLink` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Sessionize` | `MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:126` |
| `SessionizeQuestion` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Sessionize` | `MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:25` |
| `SessionizeQuestionAnswer` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Sessionize` | `MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:192` |
| `SessionizeResponse` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Sessionize` | `MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:6` |
| `SessionizeRoom` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Sessionize` | `MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:73` |
| `SessionizeSession` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Sessionize` | `MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:139` |
| `SessionizeSpeaker` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Sessionize` | `MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:86` |
| `PublishedEventSpecification` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Specifications` | `MMCA.ADC.Conference.Application/Events/Specifications/PublishedEventSpecification.cs:11` |
| `AddEventQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer` | `MMCA.ADC.Conference.Application/Events/UseCases/AddEventQuestionAnswer/AddEventQuestionAnswerCommand.cs:11` |
| `AddEventQuestionAnswerCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer` | `MMCA.ADC.Conference.Application/Events/UseCases/AddEventQuestionAnswer/AddEventQuestionAnswerCommandValidator.cs:8` |
| `AddEventQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer` | `MMCA.ADC.Conference.Application/Events/UseCases/AddEventQuestionAnswer/AddEventQuestionAnswerHandler.cs:18` |
| `AddEventSpeakerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker` | `MMCA.ADC.Conference.Application/Events/UseCases/AddEventSpeaker/AddEventSpeakerCommand.cs:10` |
| `AddEventSpeakerCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker` | `MMCA.ADC.Conference.Application/Events/UseCases/AddEventSpeaker/AddEventSpeakerCommandValidator.cs:8` |
| `AddEventSpeakerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker` | `MMCA.ADC.Conference.Application/Events/UseCases/AddEventSpeaker/AddEventSpeakerHandler.cs:15` |
| `AddRoomCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.AddRoom` | `MMCA.ADC.Conference.Application/Events/UseCases/AddRoom/AddRoomCommand.cs:15` |
| `AddRoomCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.AddRoom` | `MMCA.ADC.Conference.Application/Events/UseCases/AddRoom/AddRoomCommandValidator.cs:7` |
| `AddRoomHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.AddRoom` | `MMCA.ADC.Conference.Application/Events/UseCases/AddRoom/AddRoomHandler.cs:18` |
| `CreateEventHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Create` | `MMCA.ADC.Conference.Application/Events/UseCases/Create/CreateEventHandler.cs:16` |
| `EventCreateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Create` | `MMCA.ADC.Conference.Application/Events/UseCases/Create/EventCreateRequest.cs:10` |
| `EventCreateRequestMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Create` | `MMCA.ADC.Conference.Application/Events/UseCases/Create/EventCreateRequestMapper.cs:11` |
| `EventCreateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Create` | `MMCA.ADC.Conference.Application/Events/UseCases/Create/EventCreateRequestValidator.cs:7` |
| `DeleteEventHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Delete` | `MMCA.ADC.Conference.Application/Events/UseCases/Delete/DeleteEventHandler.cs:18` |
| `GetPublicEventSpeakerFilterHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.GetPublicEventSpeakerFilter` | `MMCA.ADC.Conference.Application/Events/UseCases/GetPublicEventSpeakerFilter/GetPublicEventSpeakerFilterHandler.cs:22` |
| `GetPublicEventSpeakerFilterQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.GetPublicEventSpeakerFilter` | `MMCA.ADC.Conference.Application/Events/UseCases/GetPublicEventSpeakerFilter/GetPublicEventSpeakerFilterQuery.cs:10` |
| `GetPublicRoomFilterHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.GetPublicRoomFilter` | `MMCA.ADC.Conference.Application/Events/UseCases/GetPublicRoomFilter/GetPublicRoomFilterHandler.cs:16` |
| `GetPublicRoomFilterQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.GetPublicRoomFilter` | `MMCA.ADC.Conference.Application/Events/UseCases/GetPublicRoomFilter/GetPublicRoomFilterQuery.cs:14` |
| `PublishEventCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Publish` | `MMCA.ADC.Conference.Application/Events/UseCases/Publish/PublishEventCommand.cs:12` |
| `PublishEventHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Publish` | `MMCA.ADC.Conference.Application/Events/UseCases/Publish/PublishEventHandler.cs:13` |
| `CategorySyncStrategy` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/CategorySyncStrategy.cs:12` |
| `ISessionizeSyncStrategy` | interface | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/ISessionizeSyncStrategy.cs:7` |
| `QuestionSyncStrategy` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/QuestionSyncStrategy.cs:12` |
| `RefreshFromSessionizeCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeCommand.cs:13` |
| `RefreshFromSessionizeHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeHandler.cs:19` |
| `RoomSyncStrategy` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RoomSyncStrategy.cs:20` |
| `SessionizeSyncContext` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/SessionizeSyncContext.cs:11` |
| `SessionizeSyncResult` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/ISessionizeSyncStrategy.cs:21` |
| `SessionizeSyncWarnings` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/SessionizeSyncWarnings.cs:9` |
| `SessionSyncStrategy` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/SessionSyncStrategy.cs:14` |
| `SpeakerSyncStrategy` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/SpeakerSyncStrategy.cs:14` |
| `RemoveEventQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventQuestionAnswer` | `MMCA.ADC.Conference.Application/Events/UseCases/RemoveEventQuestionAnswer/RemoveEventQuestionAnswerCommand.cs:9` |
| `RemoveEventQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventQuestionAnswer` | `MMCA.ADC.Conference.Application/Events/UseCases/RemoveEventQuestionAnswer/RemoveEventQuestionAnswerHandler.cs:14` |
| `RemoveEventSpeakerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventSpeaker` | `MMCA.ADC.Conference.Application/Events/UseCases/RemoveEventSpeaker/RemoveEventSpeakerCommand.cs:9` |
| `RemoveEventSpeakerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventSpeaker` | `MMCA.ADC.Conference.Application/Events/UseCases/RemoveEventSpeaker/RemoveEventSpeakerHandler.cs:13` |
| `RemoveRoomCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RemoveRoom` | `MMCA.ADC.Conference.Application/Events/UseCases/RemoveRoom/RemoveRoomCommand.cs:9` |
| `RemoveRoomHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RemoveRoom` | `MMCA.ADC.Conference.Application/Events/UseCases/RemoveRoom/RemoveRoomHandler.cs:13` |
| `UnpublishEventCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Unpublish` | `MMCA.ADC.Conference.Application/Events/UseCases/Unpublish/UnpublishEventCommand.cs:12` |
| `UnpublishEventHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Unpublish` | `MMCA.ADC.Conference.Application/Events/UseCases/Unpublish/UnpublishEventHandler.cs:13` |
| `EventUpdateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Update` | `MMCA.ADC.Conference.Application/Events/UseCases/Update/EventUpdateRequest.cs:7` |
| `EventUpdateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Update` | `MMCA.ADC.Conference.Application/Events/UseCases/Update/EventUpdateRequestValidator.cs:7` |
| `UpdateEventCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Update` | `MMCA.ADC.Conference.Application/Events/UseCases/Update/UpdateEventCommand.cs:10` |
| `UpdateEventHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Update` | `MMCA.ADC.Conference.Application/Events/UseCases/Update/UpdateEventHandler.cs:16` |
| `UpdateEventResult` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Update` | `MMCA.ADC.Conference.Application/Events/UseCases/Update/UpdateEventCommand.cs:19` |
| `UpdateEventQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.UpdateEventQuestionAnswer` | `MMCA.ADC.Conference.Application/Events/UseCases/UpdateEventQuestionAnswer/UpdateEventQuestionAnswerCommand.cs:10` |
| `UpdateEventQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.UpdateEventQuestionAnswer` | `MMCA.ADC.Conference.Application/Events/UseCases/UpdateEventQuestionAnswer/UpdateEventQuestionAnswerHandler.cs:14` |
| `UpdateRoomCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom` | `MMCA.ADC.Conference.Application/Events/UseCases/UpdateRoom/UpdateRoomCommand.cs:15` |
| `UpdateRoomCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom` | `MMCA.ADC.Conference.Application/Events/UseCases/UpdateRoom/UpdateRoomCommandValidator.cs:7` |
| `UpdateRoomHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom` | `MMCA.ADC.Conference.Application/Events/UseCases/UpdateRoom/UpdateRoomHandler.cs:13` |
| `EventDateRangeRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:109` |
| `EventNameRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:13` |
| `EventOrganizerContactEmailRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:57` |
| `EventSponsorshipPacketUrlRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:75` |
| `EventTicketingUrlRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:93` |
| `EventTimeZoneRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:25` |
| `RoomAccessibilityInfoRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:77` |
| `RoomCapacityRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:37` |
| `RoomFloorRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:51` |
| `RoomLocationRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:64` |
| `RoomNameRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:12` |
| `RoomSortRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:25` |
| `QuestionDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.DTOs` | `MMCA.ADC.Conference.Application/Questions/DTOs/QuestionDTOMapper.cs:12` |
| `CreateQuestionHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.UseCases.Create` | `MMCA.ADC.Conference.Application/Questions/UseCases/Create/CreateQuestionHandler.cs:19` |
| `QuestionCreateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.UseCases.Create` | `MMCA.ADC.Conference.Application/Questions/UseCases/Create/QuestionCreateRequest.cs:10` |
| `QuestionCreateRequestMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.UseCases.Create` | `MMCA.ADC.Conference.Application/Questions/UseCases/Create/QuestionCreateRequestMapper.cs:11` |
| `QuestionCreateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.UseCases.Create` | `MMCA.ADC.Conference.Application/Questions/UseCases/Create/QuestionCreateRequestValidator.cs:7` |
| `QuestionUpdateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.UseCases.Update` | `MMCA.ADC.Conference.Application/Questions/UseCases/Update/QuestionUpdateRequest.cs:6` |
| `QuestionUpdateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.UseCases.Update` | `MMCA.ADC.Conference.Application/Questions/UseCases/Update/QuestionUpdateRequestValidator.cs:7` |
| `UpdateQuestionCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.UseCases.Update` | `MMCA.ADC.Conference.Application/Questions/UseCases/Update/UpdateQuestionCommand.cs:9` |
| `UpdateQuestionHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.UseCases.Update` | `MMCA.ADC.Conference.Application/Questions/UseCases/Update/UpdateQuestionHandler.cs:19` |
| `QuestionTextRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.Validation` | `MMCA.ADC.Conference.Application/Questions/Validation/QuestionValidationRules.cs:12` |
| `SessionBookmarkValidationService` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions` | `MMCA.ADC.Conference.Application/Sessions/SessionBookmarkValidationService.cs:12` |
| `SessionCategoryItemNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions` | `MMCA.ADC.Conference.Application/Sessions/SessionCategoryItemNavigationPopulator.cs:11` |
| `SessionNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions` | `MMCA.ADC.Conference.Application/Sessions/SessionNavigationPopulator.cs:13` |
| `SessionQuestionAnswerNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions` | `MMCA.ADC.Conference.Application/Sessions/SessionQuestionAnswerNavigationPopulator.cs:11` |
| `SessionSpeakerNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions` | `MMCA.ADC.Conference.Application/Sessions/SessionSpeakerNavigationPopulator.cs:11` |
| `SessionCreatedHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.DomainEventHandlers` | `MMCA.ADC.Conference.Application/Sessions/DomainEventHandlers/SessionCreatedHandler.cs:11` |
| `SessionCategoryItemDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.DTOs` | `MMCA.ADC.Conference.Application/Sessions/DTOs/SessionCategoryItemDTOMapper.cs:12` |
| `SessionDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.DTOs` | `MMCA.ADC.Conference.Application/Sessions/DTOs/SessionDTOMapper.cs:14` |
| `SessionQuestionAnswerDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.DTOs` | `MMCA.ADC.Conference.Application/Sessions/DTOs/SessionQuestionAnswerDTOMapper.cs:12` |
| `SessionSpeakerDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.DTOs` | `MMCA.ADC.Conference.Application/Sessions/DTOs/SessionSpeakerDTOMapper.cs:12` |
| `PublicSessionStatusSpecification` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.Specifications` | `MMCA.ADC.Conference.Application/Sessions/Specifications/PublicSessionStatusSpecification.cs:20` |
| `AddSessionCategoryItemCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem` | `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionCategoryItem/AddSessionCategoryItemCommand.cs:10` |
| `AddSessionCategoryItemCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem` | `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionCategoryItem/AddSessionCategoryItemCommandValidator.cs:8` |
| `AddSessionCategoryItemHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem` | `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionCategoryItem/AddSessionCategoryItemHandler.cs:16` |
| `AddSessionQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer` | `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionQuestionAnswer/AddSessionQuestionAnswerCommand.cs:11` |
| `AddSessionQuestionAnswerCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer` | `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionQuestionAnswer/AddSessionQuestionAnswerCommandValidator.cs:8` |
| `AddSessionQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer` | `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionQuestionAnswer/AddSessionQuestionAnswerHandler.cs:20` |
| `AddSessionSpeakerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker` | `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionSpeaker/AddSessionSpeakerCommand.cs:10` |
| `AddSessionSpeakerCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker` | `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionSpeaker/AddSessionSpeakerCommandValidator.cs:8` |
| `AddSessionSpeakerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker` | `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionSpeaker/AddSessionSpeakerHandler.cs:16` |
| `CreateSessionHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Create` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Create/CreateSessionHandler.cs:22` |
| `SessionCreateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Create` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Create/SessionCreateRequest.cs:10` |
| `SessionCreateRequestMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Create` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Create/SessionCreateRequestMapper.cs:11` |
| `SessionCreateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Create` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Create/SessionCreateRequestValidator.cs:7` |
| `LocalityLookupEntry` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/SpeakerLocalityHelper.cs:13` |
| `SpeakerLocalityHelper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/SpeakerLocalityHelper.cs:21` |
| `GetCategoryDistributionHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetCategoryDistribution/GetCategoryDistributionHandler.cs:14` |
| `GetCategoryDistributionQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetCategoryDistribution/GetCategoryDistributionQuery.cs:5` |
| `StatusBucket` | enum | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetCategoryDistribution/GetCategoryDistributionHandler.cs:94` |
| `GetContentSimilarityHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetContentSimilarity/GetContentSimilarityHandler.cs:14` |
| `GetContentSimilarityQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetContentSimilarity/GetContentSimilarityQuery.cs:6` |
| `SessionSimilarityCalculator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetContentSimilarity/SessionSimilarityCalculator.cs:9` |
| `GetSessionSelectionDashboardHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSessionSelectionDashboard/GetSessionSelectionDashboardHandler.cs:16` |
| `GetSessionSelectionDashboardQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSessionSelectionDashboard/GetSessionSelectionDashboardQuery.cs:5` |
| `StatusBucket` | enum | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSessionSelectionDashboard/GetSessionSelectionDashboardHandler.cs:314` |
| `GetSpeakerSessionOverlapHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSpeakerSessionOverlap` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSpeakerSessionOverlap/GetSpeakerSessionOverlapHandler.cs:18` |
| `GetSpeakerSessionOverlapQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSpeakerSessionOverlap` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSpeakerSessionOverlap/GetSpeakerSessionOverlapQuery.cs:5` |
| `IAiScoringService` | interface | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/IAiScoringService.cs:6` |
| `ISessionScoringQueue` | interface | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ISessionScoringQueue.cs:31` |
| `ScoreEventSessionsCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsCommand.cs:5` |
| `ScoreEventSessionsHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsHandler.cs:18` |
| `SessionScoringEnqueueResult` | enum | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ISessionScoringQueue.cs:4` |
| `SessionScoringInput` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/IAiScoringService.cs:33` |
| `SessionScoringQueue` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/SessionScoringQueue.cs:34` |
| `SessionScoringResult` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/IAiScoringService.cs:40` |
| `SessionScoringWorkItem` | record struct | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/SessionScoringQueue.cs:21` |
| `SpeakerInfo` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/IAiScoringService.cs:23` |
| `DeleteSessionHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Delete` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Delete/DeleteSessionHandler.cs:16` |
| `CalendarExportMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` | `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/CalendarExportMapper.cs:14` |
| `ExportEventCalendarHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` | `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportEventCalendarHandler.cs:15` |
| `ExportEventCalendarQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` | `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportEventCalendarQuery.cs:5` |
| `ExportSessionCalendarHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` | `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportSessionCalendarHandler.cs:16` |
| `ExportSessionCalendarQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` | `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportSessionCalendarQuery.cs:5` |
| `GetPublicSessionCategoryItemFilterHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionCategoryItemFilter` | `MMCA.ADC.Conference.Application/Sessions/UseCases/GetPublicSessionCategoryItemFilter/GetPublicSessionCategoryItemFilterHandler.cs:16` |
| `GetPublicSessionCategoryItemFilterQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionCategoryItemFilter` | `MMCA.ADC.Conference.Application/Sessions/UseCases/GetPublicSessionCategoryItemFilter/GetPublicSessionCategoryItemFilterQuery.cs:8` |
| `GetPublicSessionFilterHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionFilter` | `MMCA.ADC.Conference.Application/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterHandler.cs:20` |
| `GetPublicSessionFilterQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionFilter` | `MMCA.ADC.Conference.Application/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterQuery.cs:11` |
| `GetPublicSessionSpeakerFilterHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionSpeakerFilter` | `MMCA.ADC.Conference.Application/Sessions/UseCases/GetPublicSessionSpeakerFilter/GetPublicSessionSpeakerFilterHandler.cs:15` |
| `GetPublicSessionSpeakerFilterQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionSpeakerFilter` | `MMCA.ADC.Conference.Application/Sessions/UseCases/GetPublicSessionSpeakerFilter/GetPublicSessionSpeakerFilterQuery.cs:8` |
| `GetSessionsBySpeakerFilterHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.GetSessionsBySpeakerFilter` | `MMCA.ADC.Conference.Application/Sessions/UseCases/GetSessionsBySpeakerFilter/GetSessionsBySpeakerFilterHandler.cs:21` |
| `GetSessionsBySpeakerFilterQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.GetSessionsBySpeakerFilter` | `MMCA.ADC.Conference.Application/Sessions/UseCases/GetSessionsBySpeakerFilter/GetSessionsBySpeakerFilterQuery.cs:11` |
| `GetNowNextHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.NowNext` | `MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextHandler.cs:20` |
| `GetNowNextQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.NowNext` | `MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextQuery.cs:23` |
| `RemoveSessionCategoryItemCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionCategoryItem` | `MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionCategoryItem/RemoveSessionCategoryItemCommand.cs:9` |
| `RemoveSessionCategoryItemHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionCategoryItem` | `MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionCategoryItem/RemoveSessionCategoryItemHandler.cs:13` |
| `RemoveSessionQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionQuestionAnswer` | `MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionQuestionAnswer/RemoveSessionQuestionAnswerCommand.cs:9` |
| `RemoveSessionQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionQuestionAnswer` | `MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionQuestionAnswer/RemoveSessionQuestionAnswerHandler.cs:14` |
| `RemoveSessionSpeakerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionSpeaker` | `MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionSpeaker/RemoveSessionSpeakerCommand.cs:9` |
| `RemoveSessionSpeakerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionSpeaker` | `MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionSpeaker/RemoveSessionSpeakerHandler.cs:13` |
| `SessionUpdateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Update` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Update/SessionUpdateRequest.cs:6` |
| `SessionUpdateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Update` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Update/SessionUpdateRequestValidator.cs:7` |
| `UpdateSessionCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Update` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Update/UpdateSessionCommand.cs:10` |
| `UpdateSessionHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Update` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Update/UpdateSessionHandler.cs:17` |
| `UpdateSessionResult` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Update` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Update/UpdateSessionCommand.cs:19` |
| `UpdateSessionQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.UpdateSessionQuestionAnswer` | `MMCA.ADC.Conference.Application/Sessions/UseCases/UpdateSessionQuestionAnswer/UpdateSessionQuestionAnswerCommand.cs:10` |
| `UpdateSessionQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.UpdateSessionQuestionAnswer` | `MMCA.ADC.Conference.Application/Sessions/UseCases/UpdateSessionQuestionAnswer/UpdateSessionQuestionAnswerHandler.cs:14` |
| `SessionAccessibilityInfoRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.Validation` | `MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:87` |
| `SessionDescriptionRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.Validation` | `MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:37` |
| `SessionEventIdRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.Validation` | `MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:24` |
| `SessionLiveUrlRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.Validation` | `MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:62` |
| `SessionRecordingUrlRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.Validation` | `MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:75` |
| `SessionResourceLinksRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.Validation` | `MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:99` |
| `SessionRoomScheduling` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.Validation` | `MMCA.ADC.Conference.Application/Sessions/Validation/SessionRoomScheduling.cs:27` |
| `SessionStatusRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.Validation` | `MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:49` |
| `SessionTitleRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.Validation` | `MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:13` |
| `SpeakerCategoryItemNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers` | `MMCA.ADC.Conference.Application/Speakers/SpeakerCategoryItemNavigationPopulator.cs:11` |
| `SpeakerEntityQueryService` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers` | `MMCA.ADC.Conference.Application/Speakers/SpeakerEntityQueryService.cs:15` |
| `SpeakerNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers` | `MMCA.ADC.Conference.Application/Speakers/SpeakerNavigationPopulator.cs:11` |
| `SpeakerQuestionAnswerNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers` | `MMCA.ADC.Conference.Application/Speakers/SpeakerQuestionAnswerNavigationPopulator.cs:11` |
| `SpeakerDeletedHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.DomainEventHandlers` | `MMCA.ADC.Conference.Application/Speakers/DomainEventHandlers/SpeakerDeletedHandler.cs:20` |
| `SpeakerCategoryItemDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.DTOs` | `MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerCategoryItemDTOMapper.cs:12` |
| `SpeakerDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.DTOs` | `MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerDTOMapper.cs:17` |
| `SpeakerQuestionAnswerDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.DTOs` | `MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerQuestionAnswerDTOMapper.cs:12` |
| `AddSpeakerCategoryItemCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem` | `MMCA.ADC.Conference.Application/Speakers/UseCases/AddSpeakerCategoryItem/AddSpeakerCategoryItemCommand.cs:13` |
| `AddSpeakerCategoryItemCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem` | `MMCA.ADC.Conference.Application/Speakers/UseCases/AddSpeakerCategoryItem/AddSpeakerCategoryItemCommandValidator.cs:8` |
| `AddSpeakerCategoryItemHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem` | `MMCA.ADC.Conference.Application/Speakers/UseCases/AddSpeakerCategoryItem/AddSpeakerCategoryItemHandler.cs:15` |
| `CreateSpeakerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.Create` | `MMCA.ADC.Conference.Application/Speakers/UseCases/Create/CreateSpeakerHandler.cs:16` |
| `SpeakerCreateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.Create` | `MMCA.ADC.Conference.Application/Speakers/UseCases/Create/SpeakerCreateRequest.cs:10` |
| `SpeakerCreateRequestMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.Create` | `MMCA.ADC.Conference.Application/Speakers/UseCases/Create/SpeakerCreateRequestMapper.cs:11` |
| `SpeakerCreateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.Create` | `MMCA.ADC.Conference.Application/Speakers/UseCases/Create/SpeakerCreateRequestValidator.cs:7` |
| `GetPublicSpeakerCategoryItemFilterHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.GetPublicSpeakerCategoryItemFilter` | `MMCA.ADC.Conference.Application/Speakers/UseCases/GetPublicSpeakerCategoryItemFilter/GetPublicSpeakerCategoryItemFilterHandler.cs:17` |
| `GetPublicSpeakerCategoryItemFilterQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.GetPublicSpeakerCategoryItemFilter` | `MMCA.ADC.Conference.Application/Speakers/UseCases/GetPublicSpeakerCategoryItemFilter/GetPublicSpeakerCategoryItemFilterQuery.cs:8` |
| `GetPublicSpeakerFilterHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.GetPublicSpeakerFilter` | `MMCA.ADC.Conference.Application/Speakers/UseCases/GetPublicSpeakerFilter/GetPublicSpeakerFilterHandler.cs:17` |
| `GetPublicSpeakerFilterQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.GetPublicSpeakerFilter` | `MMCA.ADC.Conference.Application/Speakers/UseCases/GetPublicSpeakerFilter/GetPublicSpeakerFilterQuery.cs:20` |
| `GetSessionBookmarkCountHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCount` | `MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionBookmarkCount/GetSessionBookmarkCountHandler.cs:14` |
| `GetSessionBookmarkCountQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCount` | `MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionBookmarkCount/GetSessionBookmarkCountQuery.cs:6` |
| `GetSessionBookmarkCountsHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCounts` | `MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionBookmarkCounts/GetSessionBookmarkCountsHandler.cs:17` |
| `GetSessionBookmarkCountsQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCounts` | `MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionBookmarkCounts/GetSessionBookmarkCountsQuery.cs:6` |
| `GetSessionFeedbackHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionFeedback` | `MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionFeedback/GetSessionFeedbackHandler.cs:15` |
| `GetSessionFeedbackQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionFeedback` | `MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionFeedback/GetSessionFeedbackQuery.cs:6` |
| `GetSpeakersByEventFilterHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSpeakersByEventFilter` | `MMCA.ADC.Conference.Application/Speakers/UseCases/GetSpeakersByEventFilter/GetSpeakersByEventFilterHandler.cs:19` |
| `GetSpeakersByEventFilterQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSpeakersByEventFilter` | `MMCA.ADC.Conference.Application/Speakers/UseCases/GetSpeakersByEventFilter/GetSpeakersByEventFilterQuery.cs:12` |
| `LinkUserToSpeakerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.LinkUser` | `MMCA.ADC.Conference.Application/Speakers/UseCases/LinkUser/LinkUserToSpeakerCommand.cs:13` |
| `LinkUserToSpeakerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.LinkUser` | `MMCA.ADC.Conference.Application/Speakers/UseCases/LinkUser/LinkUserToSpeakerHandler.cs:20` |
| `RemoveSpeakerCategoryItemCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.RemoveSpeakerCategoryItem` | `MMCA.ADC.Conference.Application/Speakers/UseCases/RemoveSpeakerCategoryItem/RemoveSpeakerCategoryItemCommand.cs:12` |
| `RemoveSpeakerCategoryItemHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.RemoveSpeakerCategoryItem` | `MMCA.ADC.Conference.Application/Speakers/UseCases/RemoveSpeakerCategoryItem/RemoveSpeakerCategoryItemHandler.cs:13` |
| `UnlinkUserFromSpeakerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.UnlinkUser` | `MMCA.ADC.Conference.Application/Speakers/UseCases/UnlinkUser/UnlinkUserFromSpeakerCommand.cs:12` |
| `UnlinkUserFromSpeakerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.UnlinkUser` | `MMCA.ADC.Conference.Application/Speakers/UseCases/UnlinkUser/UnlinkUserFromSpeakerHandler.cs:19` |
| `SpeakerUpdateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.Update` | `MMCA.ADC.Conference.Application/Speakers/UseCases/Update/SpeakerUpdateRequest.cs:8` |
| `SpeakerUpdateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.Update` | `MMCA.ADC.Conference.Application/Speakers/UseCases/Update/SpeakerUpdateRequestValidator.cs:7` |
| `UpdateSpeakerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.Update` | `MMCA.ADC.Conference.Application/Speakers/UseCases/Update/UpdateSpeakerCommand.cs:13` |
| `UpdateSpeakerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.Update` | `MMCA.ADC.Conference.Application/Speakers/UseCases/Update/UpdateSpeakerHandler.cs:15` |
| `SpeakerFirstNameRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.Validation` | `MMCA.ADC.Conference.Application/Speakers/Validation/SpeakerValidationRules.cs:11` |
| `SpeakerLastNameRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.Validation` | `MMCA.ADC.Conference.Application/Speakers/Validation/SpeakerValidationRules.cs:22` |
| `SponsorNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors` | `MMCA.ADC.Conference.Application/Sponsors/SponsorNavigationPopulator.cs:12` |
| `SponsorDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.DTOs` | `MMCA.ADC.Conference.Application/Sponsors/DTOs/SponsorDTOMapper.cs:13` |
| `CreateSponsorHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.UseCases.Create` | `MMCA.ADC.Conference.Application/Sponsors/UseCases/Create/CreateSponsorHandler.cs:16` |
| `SponsorCreateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.UseCases.Create` | `MMCA.ADC.Conference.Application/Sponsors/UseCases/Create/SponsorCreateRequest.cs:11` |
| `SponsorCreateRequestMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.UseCases.Create` | `MMCA.ADC.Conference.Application/Sponsors/UseCases/Create/SponsorCreateRequestMapper.cs:11` |
| `SponsorCreateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.UseCases.Create` | `MMCA.ADC.Conference.Application/Sponsors/UseCases/Create/SponsorCreateRequestValidator.cs:7` |
| `GetPublicSponsorFilterHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.UseCases.GetPublicSponsorFilter` | `MMCA.ADC.Conference.Application/Sponsors/UseCases/GetPublicSponsorFilter/GetPublicSponsorFilterHandler.cs:16` |
| `GetPublicSponsorFilterQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.UseCases.GetPublicSponsorFilter` | `MMCA.ADC.Conference.Application/Sponsors/UseCases/GetPublicSponsorFilter/GetPublicSponsorFilterQuery.cs:13` |
| `SponsorUpdateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.UseCases.Update` | `MMCA.ADC.Conference.Application/Sponsors/UseCases/Update/SponsorUpdateRequest.cs:11` |
| `SponsorUpdateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.UseCases.Update` | `MMCA.ADC.Conference.Application/Sponsors/UseCases/Update/SponsorUpdateRequestValidator.cs:7` |
| `UpdateSponsorCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.UseCases.Update` | `MMCA.ADC.Conference.Application/Sponsors/UseCases/Update/UpdateSponsorCommand.cs:9` |
| `UpdateSponsorHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.UseCases.Update` | `MMCA.ADC.Conference.Application/Sponsors/UseCases/Update/UpdateSponsorHandler.cs:15` |
| `SponsorBoothNumberRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.Validation` | `MMCA.ADC.Conference.Application/Sponsors/Validation/SponsorValidationRules.cs:86` |
| `SponsorDescriptionRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.Validation` | `MMCA.ADC.Conference.Application/Sponsors/Validation/SponsorValidationRules.cs:38` |
| `SponsorEventIdRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.Validation` | `MMCA.ADC.Conference.Application/Sponsors/Validation/SponsorValidationRules.cs:98` |
| `SponsorLinkedInUrlRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.Validation` | `MMCA.ADC.Conference.Application/Sponsors/Validation/SponsorValidationRules.cs:62` |
| `SponsorLogoUrlRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.Validation` | `MMCA.ADC.Conference.Application/Sponsors/Validation/SponsorValidationRules.cs:26` |
| `SponsorNameRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.Validation` | `MMCA.ADC.Conference.Application/Sponsors/Validation/SponsorValidationRules.cs:13` |
| `SponsorSortRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.Validation` | `MMCA.ADC.Conference.Application/Sponsors/Validation/SponsorValidationRules.cs:110` |
| `SponsorTwitterHandleRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.Validation` | `MMCA.ADC.Conference.Application/Sponsors/Validation/SponsorValidationRules.cs:74` |
| `SponsorWebsiteUrlRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sponsors.Validation` | `MMCA.ADC.Conference.Application/Sponsors/Validation/SponsorValidationRules.cs:50` |
| `UserRegisteredHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Users.IntegrationEventHandlers` | `MMCA.ADC.Conference.Application/Users/IntegrationEventHandlers/UserRegisteredHandler.cs:40` |
| `ActivityNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Activities` | `MMCA.ADC.Conference.Application.Tests/Activities/ActivityNavigationPopulatorTests.cs:9` |
| `ActivityDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Activities.DTOs` | `MMCA.ADC.Conference.Application.Tests/Activities/DTOs/ActivityDTOMapperTests.cs:7` |
| `CreateActivityHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Activities.UseCases` | `MMCA.ADC.Conference.Application.Tests/Activities/UseCases/CreateActivityHandlerTests.cs:13` |
| `UpdateActivityHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Activities.UseCases` | `MMCA.ADC.Conference.Application.Tests/Activities/UseCases/UpdateActivityHandlerTests.cs:12` |
| `GetPublicActivityFilterHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Activities.UseCases.GetPublicActivityFilter` | `MMCA.ADC.Conference.Application.Tests/Activities/UseCases/GetPublicActivityFilter/GetPublicActivityFilterHandlerTests.cs:18` |
| `ActivityCreateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Activities.Validation` | `MMCA.ADC.Conference.Application.Tests/Activities/Validation/ActivityCreateRequestValidatorTests.cs:7` |
| `ActivityUpdateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Activities.Validation` | `MMCA.ADC.Conference.Application.Tests/Activities/Validation/ActivityUpdateRequestValidatorTests.cs:7` |
| `CategoryItemNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories` | `MMCA.ADC.Conference.Application.Tests/Categories/CategoryItemNavigationPopulatorTests.cs:9` |
| `ConferenceCategoryNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories` | `MMCA.ADC.Conference.Application.Tests/Categories/ConferenceCategoryNavigationPopulatorTests.cs:9` |
| `CategoryItemDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.DTOs` | `MMCA.ADC.Conference.Application.Tests/Categories/DTOs/CategoryItemDTOMapperTests.cs:7` |
| `ConferenceCategoryDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.DTOs` | `MMCA.ADC.Conference.Application.Tests/Categories/DTOs/ConferenceCategoryDTOMapperTests.cs:7` |
| `AddCategoryItemHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.UseCases` | `MMCA.ADC.Conference.Application.Tests/Categories/UseCases/AddCategoryItemHandlerTests.cs:12` |
| `CreateConferenceCategoryHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.UseCases` | `MMCA.ADC.Conference.Application.Tests/Categories/UseCases/CreateConferenceCategoryHandlerTests.cs:13` |
| `RemoveCategoryItemHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.UseCases` | `MMCA.ADC.Conference.Application.Tests/Categories/UseCases/RemoveCategoryItemHandlerTests.cs:11` |
| `UpdateCategoryItemHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.UseCases` | `MMCA.ADC.Conference.Application.Tests/Categories/UseCases/UpdateCategoryItemHandlerTests.cs:11` |
| `UpdateConferenceCategoryHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.UseCases` | `MMCA.ADC.Conference.Application.Tests/Categories/UseCases/UpdateConferenceCategoryHandlerTests.cs:12` |
| `AddCategoryItemCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.Validation` | `MMCA.ADC.Conference.Application.Tests/Categories/Validation/CategoryCommandValidatorTests.cs:8` |
| `ConferenceCategoryCreateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.Validation` | `MMCA.ADC.Conference.Application.Tests/Categories/Validation/ConferenceCategoryCreateRequestValidatorTests.cs:7` |
| `ConferenceCategoryUpdateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.Validation` | `MMCA.ADC.Conference.Application.Tests/Categories/Validation/ConferenceCategoryUpdateRequestValidatorTests.cs:6` |
| `ConferenceCategoryValidationRulesTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.Validation` | `MMCA.ADC.Conference.Application.Tests/Categories/Validation/ConferenceCategoryValidationRulesTests.cs:8` |
| `TestCategoryItemModel` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.Validation` | `MMCA.ADC.Conference.Application.Tests/Categories/Validation/ConferenceCategoryValidationRulesTests.cs:11` |
| `TestCategoryItemValidator` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.Validation` | `MMCA.ADC.Conference.Application.Tests/Categories/Validation/ConferenceCategoryValidationRulesTests.cs:19` |
| `TestCategoryModel` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.Validation` | `MMCA.ADC.Conference.Application.Tests/Categories/Validation/ConferenceCategoryValidationRulesTests.cs:10` |
| `TestCategoryTitleValidator` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.Validation` | `MMCA.ADC.Conference.Application.Tests/Categories/Validation/ConferenceCategoryValidationRulesTests.cs:13` |
| `UpdateCategoryItemCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.Validation` | `MMCA.ADC.Conference.Application.Tests/Categories/Validation/CategoryCommandValidatorTests.cs:54` |
| `RoomChangedHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.DomainEvents` | `MMCA.ADC.Conference.Application.Tests/DomainEvents/RoomChangedHandlerTests.cs:10` |
| `SessionCreatedHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.DomainEvents` | `MMCA.ADC.Conference.Application.Tests/DomainEvents/SessionCreatedHandlerTests.cs:10` |
| `EventLiveValidationServiceTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events` | `MMCA.ADC.Conference.Application.Tests/Events/EventLiveValidationServiceTests.cs:16` |
| `EventNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events` | `MMCA.ADC.Conference.Application.Tests/Events/EventNavigationPopulatorTests.cs:9` |
| `EventQuestionAnswerNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events` | `MMCA.ADC.Conference.Application.Tests/Events/EventQuestionAnswerNavigationPopulatorTests.cs:9` |
| `EventSpeakerNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events` | `MMCA.ADC.Conference.Application.Tests/Events/EventSpeakerNavigationPopulatorTests.cs:9` |
| `FixedTimeProvider` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events` | `MMCA.ADC.Conference.Application.Tests/Events/EventLiveValidationServiceTests.cs:388` |
| `RoomNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events` | `MMCA.ADC.Conference.Application.Tests/Events/RoomNavigationPopulatorTests.cs:9` |
| `RoomChangedHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.DomainEventHandlers` | `MMCA.ADC.Conference.Application.Tests/Events/DomainEventHandlers/RoomChangedHandlerTests.cs:10` |
| `EventDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.DTOs` | `MMCA.ADC.Conference.Application.Tests/Events/DTOs/EventDTOMapperTests.cs:7` |
| `EventQuestionAnswerDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.DTOs` | `MMCA.ADC.Conference.Application.Tests/Events/DTOs/EventQuestionAnswerDTOMapperTests.cs:7` |
| `EventSpeakerDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.DTOs` | `MMCA.ADC.Conference.Application.Tests/Events/DTOs/EventSpeakerDTOMapperTests.cs:7` |
| `RoomDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.DTOs` | `MMCA.ADC.Conference.Application.Tests/Events/DTOs/RoomDTOMapperTests.cs:7` |
| `PublishedEventSpecificationTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Specifications` | `MMCA.ADC.Conference.Application.Tests/Events/Specifications/PublishedEventSpecificationTests.cs:7` |
| `AddEventQuestionAnswerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/AddEventQuestionAnswerHandlerTests.cs:13` |
| `AddEventSpeakerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/AddEventSpeakerHandlerTests.cs:12` |
| `AddRoomHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/AddRoomHandlerTests.cs:14` |
| `CreateEventHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/CreateEventHandlerTests.cs:13` |
| `DeleteEventHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/DeleteEventHandlerTests.cs:18` |
| `PublishEventHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/PublishEventHandlerTests.cs:11` |
| `RefreshFromSessionizeHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/RefreshFromSessionizeHandlerTests.cs:15` |
| `RemoveEventQuestionAnswerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/RemoveEventQuestionAnswerHandlerTests.cs:12` |
| `RemoveEventSpeakerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/RemoveEventSpeakerHandlerTests.cs:11` |
| `RemoveRoomHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/RemoveRoomHandlerTests.cs:11` |
| `UnpublishEventHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/UnpublishEventHandlerTests.cs:11` |
| `UpdateEventHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/UpdateEventHandlerTests.cs:14` |
| `UpdateEventQuestionAnswerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/UpdateEventQuestionAnswerHandlerTests.cs:12` |
| `UpdateRoomHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/UpdateRoomHandlerTests.cs:11` |
| `GetPublicEventSpeakerFilterHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases.GetPublicEventSpeakerFilter` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/GetPublicEventSpeakerFilter/GetPublicEventSpeakerFilterHandlerTests.cs:19` |
| `AddEventQuestionAnswerCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/CommandValidatorTests.cs:10` |
| `AddEventSpeakerCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/CommandValidatorTests.cs:40` |
| `AddRoomCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/CommandValidatorTests.cs:62` |
| `EventCreateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/EventCreateRequestValidatorTests.cs:6` |
| `EventUpdateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/EventUpdateRequestValidatorTests.cs:6` |
| `EventValidationRulesTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/EventValidationRulesTests.cs:8` |
| `RoomValidationRulesTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/EventValidationRulesTests.cs:118` |
| `TestEventModel` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/EventValidationRulesTests.cs:11` |
| `TestEventValidator` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/EventValidationRulesTests.cs:18` |
| `TestRoomModel` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/EventValidationRulesTests.cs:121` |
| `TestRoomValidator` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/EventValidationRulesTests.cs:130` |
| `UpdateRoomCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/CommandValidatorTests.cs:116` |
| `QuestionDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Questions.DTOs` | `MMCA.ADC.Conference.Application.Tests/Questions/DTOs/QuestionDTOMapperTests.cs:7` |
| `CreateQuestionHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Questions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Questions/UseCases/CreateQuestionHandlerTests.cs:15` |
| `UpdateQuestionHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Questions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Questions/UseCases/UpdateQuestionHandlerTests.cs:16` |
| `QuestionCreateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Questions.Validation` | `MMCA.ADC.Conference.Application.Tests/Questions/Validation/QuestionCreateRequestValidatorTests.cs:7` |
| `QuestionUpdateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Questions.Validation` | `MMCA.ADC.Conference.Application.Tests/Questions/Validation/QuestionUpdateRequestValidatorTests.cs:6` |
| `QuestionValidationRulesTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Questions.Validation` | `MMCA.ADC.Conference.Application.Tests/Questions/Validation/QuestionValidationRulesTests.cs:8` |
| `TestQuestionModel` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Questions.Validation` | `MMCA.ADC.Conference.Application.Tests/Questions/Validation/QuestionValidationRulesTests.cs:10` |
| `TestQuestionTextValidator` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Questions.Validation` | `MMCA.ADC.Conference.Application.Tests/Questions/Validation/QuestionValidationRulesTests.cs:12` |
| `SessionBookmarkValidationServiceTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions` | `MMCA.ADC.Conference.Application.Tests/Sessions/SessionBookmarkValidationServiceTests.cs:12` |
| `SessionCategoryItemNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions` | `MMCA.ADC.Conference.Application.Tests/Sessions/SessionCategoryItemNavigationPopulatorTests.cs:9` |
| `SessionNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions` | `MMCA.ADC.Conference.Application.Tests/Sessions/SessionNavigationPopulatorTests.cs:9` |
| `SessionQuestionAnswerNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions` | `MMCA.ADC.Conference.Application.Tests/Sessions/SessionQuestionAnswerNavigationPopulatorTests.cs:9` |
| `SessionRoomFilterTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions` | `MMCA.ADC.Conference.Application.Tests/Sessions/SessionRoomFilterTests.cs:15` |
| `SessionSpeakerNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions` | `MMCA.ADC.Conference.Application.Tests/Sessions/SessionSpeakerNavigationPopulatorTests.cs:9` |
| `SessionScoringQueueTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/DecisionSupport/SessionScoringQueueTests.cs:11` |
| `SessionCreatedHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.DomainEventHandlers` | `MMCA.ADC.Conference.Application.Tests/Sessions/DomainEventHandlers/SessionCreatedHandlerTests.cs:10` |
| `SessionCategoryItemDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.DTOs` | `MMCA.ADC.Conference.Application.Tests/Sessions/DTOs/SessionCategoryItemDTOMapperTests.cs:7` |
| `SessionDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.DTOs` | `MMCA.ADC.Conference.Application.Tests/Sessions/DTOs/SessionDTOMapperTests.cs:8` |
| `SessionQuestionAnswerDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.DTOs` | `MMCA.ADC.Conference.Application.Tests/Sessions/DTOs/SessionQuestionAnswerDTOMapperTests.cs:7` |
| `SessionSpeakerDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.DTOs` | `MMCA.ADC.Conference.Application.Tests/Sessions/DTOs/SessionSpeakerDTOMapperTests.cs:7` |
| `AddSessionCategoryItemHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/AddSessionCategoryItemHandlerTests.cs:12` |
| `AddSessionQuestionAnswerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/AddSessionQuestionAnswerHandlerTests.cs:14` |
| `AddSessionSpeakerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/AddSessionSpeakerHandlerTests.cs:12` |
| `CreateSessionHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/CreateSessionHandlerTests.cs:16` |
| `DeleteSessionHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DeleteSessionHandlerTests.cs:12` |
| `RemoveSessionCategoryItemHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/RemoveSessionCategoryItemHandlerTests.cs:11` |
| `RemoveSessionQuestionAnswerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/RemoveSessionQuestionAnswerHandlerTests.cs:12` |
| `RemoveSessionSpeakerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/RemoveSessionSpeakerHandlerTests.cs:11` |
| `UpdateSessionHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/UpdateSessionHandlerTests.cs:13` |
| `UpdateSessionQuestionAnswerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/UpdateSessionQuestionAnswerHandlerTests.cs:13` |
| `GetCategoryDistributionHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/GetCategoryDistributionHandlerTests.cs:13` |
| `GetContentSimilarityHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/GetContentSimilarityHandlerTests.cs:12` |
| `GetSessionSelectionDashboardHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/GetSessionSelectionDashboardHandlerTests.cs:15` |
| `GetSpeakerSessionOverlapHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/GetSpeakerSessionOverlapHandlerTests.cs:13` |
| `ScoreEventSessionsHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/ScoreEventSessionsHandlerTests.cs:13` |
| `SessionSimilarityCalculatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/SessionSimilarityCalculatorTests.cs:6` |
| `SpeakerLocalityHelperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/SpeakerLocalityHelperTests.cs:8` |
| `CalendarExportMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.ExportCalendar` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/ExportCalendar/CalendarExportMapperTests.cs:14` |
| `ExportEventCalendarHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.ExportCalendar` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/ExportCalendar/ExportEventCalendarHandlerTests.cs:17` |
| `ExportSessionCalendarHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.ExportCalendar` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/ExportCalendar/ExportSessionCalendarHandlerTests.cs:16` |
| `GetPublicSessionCategoryItemFilterHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.GetPublicSessionCategoryItemFilter` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/GetPublicSessionCategoryItemFilter/GetPublicSessionCategoryItemFilterHandlerTests.cs:18` |
| `GetPublicSessionFilterHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.GetPublicSessionFilter` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterHandlerTests.cs:12` |
| `GetPublicSessionSpeakerFilterHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.GetPublicSessionSpeakerFilter` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/GetPublicSessionSpeakerFilter/GetPublicSessionSpeakerFilterHandlerTests.cs:18` |
| `GetSessionsBySpeakerFilterHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.GetSessionsBySpeakerFilter` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/GetSessionsBySpeakerFilter/GetSessionsBySpeakerFilterHandlerTests.cs:16` |
| `FixedTimeProvider` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.NowNext` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/NowNext/GetNowNextHandlerTests.cs:32` |
| `GetNowNextHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.NowNext` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/NowNext/GetNowNextHandlerTests.cs:17` |
| `GetNowNextQueryCacheTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.NowNext` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/NowNext/GetNowNextQueryCacheTests.cs:14` |
| `AddSessionCategoryItemCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.Validation` | `MMCA.ADC.Conference.Application.Tests/Sessions/Validation/SessionCommandValidatorTests.cs:60` |
| `AddSessionQuestionAnswerCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.Validation` | `MMCA.ADC.Conference.Application.Tests/Sessions/Validation/SessionCommandValidatorTests.cs:8` |
| `AddSessionSpeakerCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.Validation` | `MMCA.ADC.Conference.Application.Tests/Sessions/Validation/SessionCommandValidatorTests.cs:38` |
| `SessionCreateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.Validation` | `MMCA.ADC.Conference.Application.Tests/Sessions/Validation/SessionCreateRequestValidatorTests.cs:7` |
| `SessionRoomSchedulingTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.Validation` | `MMCA.ADC.Conference.Application.Tests/Sessions/Validation/SessionRoomSchedulingTests.cs:12` |
| `SessionUpdateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.Validation` | `MMCA.ADC.Conference.Application.Tests/Sessions/Validation/SessionUpdateRequestValidatorTests.cs:7` |
| `SessionValidationRulesTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.Validation` | `MMCA.ADC.Conference.Application.Tests/Sessions/Validation/SessionValidationRulesTests.cs:8` |
| `TestSessionModel` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.Validation` | `MMCA.ADC.Conference.Application.Tests/Sessions/Validation/SessionValidationRulesTests.cs:10` |
| `TestSessionValidator` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.Validation` | `MMCA.ADC.Conference.Application.Tests/Sessions/Validation/SessionValidationRulesTests.cs:12` |
| `SpeakerCategoryItemNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers` | `MMCA.ADC.Conference.Application.Tests/Speakers/SpeakerCategoryItemNavigationPopulatorTests.cs:9` |
| `SpeakerEntityQueryServiceTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers` | `MMCA.ADC.Conference.Application.Tests/Speakers/SpeakerEntityQueryServiceTests.cs:15` |
| `SpeakerNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers` | `MMCA.ADC.Conference.Application.Tests/Speakers/SpeakerNavigationPopulatorTests.cs:9` |
| `SpeakerQuestionAnswerNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers` | `MMCA.ADC.Conference.Application.Tests/Speakers/SpeakerQuestionAnswerNavigationPopulatorTests.cs:9` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.DomainEventHandlers` | `MMCA.ADC.Conference.Application.Tests/Speakers/DomainEventHandlers/SpeakerDeletedHandlerTests.cs:17` |
| `SpeakerDeletedHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.DomainEventHandlers` | `MMCA.ADC.Conference.Application.Tests/Speakers/DomainEventHandlers/SpeakerDeletedHandlerTests.cs:14` |
| `SpeakerCategoryItemDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.DTOs` | `MMCA.ADC.Conference.Application.Tests/Speakers/DTOs/SpeakerCategoryItemDTOMapperTests.cs:7` |
| `SpeakerDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.DTOs` | `MMCA.ADC.Conference.Application.Tests/Speakers/DTOs/SpeakerDTOMapperTests.cs:9` |
| `SpeakerQuestionAnswerDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.DTOs` | `MMCA.ADC.Conference.Application.Tests/Speakers/DTOs/SpeakerQuestionAnswerDTOMapperTests.cs:7` |
| `AddSpeakerCategoryItemHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/AddSpeakerCategoryItemHandlerTests.cs:12` |
| `CreateSpeakerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/CreateSpeakerHandlerTests.cs:13` |
| `GetSessionBookmarkCountHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/GetSessionBookmarkCountHandlerTests.cs:11` |
| `GetSessionBookmarkCountsHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/GetSessionBookmarkCountsHandlerTests.cs:11` |
| `GetSessionFeedbackHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/GetSessionFeedbackHandlerTests.cs:11` |
| `LinkUserToSpeakerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/LinkUserToSpeakerHandlerTests.cs:13` |
| `RemoveSpeakerCategoryItemHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/RemoveSpeakerCategoryItemHandlerTests.cs:11` |
| `UnlinkUserFromSpeakerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/UnlinkUserFromSpeakerHandlerTests.cs:12` |
| `UpdateSpeakerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/UpdateSpeakerHandlerTests.cs:12` |
| `GetPublicSpeakerCategoryItemFilterHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases.GetPublicSpeakerCategoryItemFilter` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/GetPublicSpeakerCategoryItemFilter/GetPublicSpeakerCategoryItemFilterHandlerTests.cs:19` |
| `GetPublicSpeakerFilterHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases.GetPublicSpeakerFilter` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/GetPublicSpeakerFilter/GetPublicSpeakerFilterHandlerTests.cs:22` |
| `GetSpeakersByEventFilterHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases.GetSpeakersByEventFilter` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/GetSpeakersByEventFilter/GetSpeakersByEventFilterHandlerTests.cs:18` |
| `AddSpeakerCategoryItemCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.Validation` | `MMCA.ADC.Conference.Application.Tests/Speakers/Validation/SpeakerCommandValidatorTests.cs:6` |
| `SpeakerCreateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.Validation` | `MMCA.ADC.Conference.Application.Tests/Speakers/Validation/SpeakerCreateRequestValidatorTests.cs:6` |
| `SpeakerUpdateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.Validation` | `MMCA.ADC.Conference.Application.Tests/Speakers/Validation/SpeakerUpdateRequestValidatorTests.cs:6` |
| `SpeakerValidationRulesTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.Validation` | `MMCA.ADC.Conference.Application.Tests/Speakers/Validation/SpeakerValidationRulesTests.cs:8` |
| `TestSpeakerModel` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.Validation` | `MMCA.ADC.Conference.Application.Tests/Speakers/Validation/SpeakerValidationRulesTests.cs:10` |
| `TestSpeakerValidator` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.Validation` | `MMCA.ADC.Conference.Application.Tests/Speakers/Validation/SpeakerValidationRulesTests.cs:12` |
| `SponsorNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sponsors` | `MMCA.ADC.Conference.Application.Tests/Sponsors/SponsorNavigationPopulatorTests.cs:9` |
| `SponsorDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sponsors.DTOs` | `MMCA.ADC.Conference.Application.Tests/Sponsors/DTOs/SponsorDTOMapperTests.cs:8` |
| `CreateSponsorHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sponsors.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sponsors/UseCases/CreateSponsorHandlerTests.cs:14` |
| `UpdateSponsorHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sponsors.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sponsors/UseCases/UpdateSponsorHandlerTests.cs:13` |
| `GetPublicSponsorFilterHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sponsors.UseCases.GetPublicSponsorFilter` | `MMCA.ADC.Conference.Application.Tests/Sponsors/UseCases/GetPublicSponsorFilter/GetPublicSponsorFilterHandlerTests.cs:19` |
| `SponsorCreateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sponsors.Validation` | `MMCA.ADC.Conference.Application.Tests/Sponsors/Validation/SponsorCreateRequestValidatorTests.cs:8` |
| `SponsorUpdateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sponsors.Validation` | `MMCA.ADC.Conference.Application.Tests/Sponsors/Validation/SponsorUpdateRequestValidatorTests.cs:8` |
| `InMemoryRepository<TEntity, TIdentifierType>` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Support` | `MMCA.ADC.Conference.Application.Tests/Support/TestSupport.cs:18` |
| `RecordingEventBus` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Support` | `MMCA.ADC.Conference.Application.Tests/Support/TestSupport.cs:328` |
| `RecordingUnitOfWork` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Support` | `MMCA.ADC.Conference.Application.Tests/Support/TestSupport.cs:246` |
| `CategorySyncStrategyTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sync` | `MMCA.ADC.Conference.Application.Tests/Sync/CategorySyncStrategyTests.cs:15` |
| `QuestionSyncStrategyTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sync` | `MMCA.ADC.Conference.Application.Tests/Sync/QuestionSyncStrategyTests.cs:16` |
| `RoomSyncStrategyTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sync` | `MMCA.ADC.Conference.Application.Tests/Sync/RoomSyncStrategyTests.cs:11` |
| `SessionSyncStrategyTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sync` | `MMCA.ADC.Conference.Application.Tests/Sync/SessionSyncStrategyTests.cs:15` |
| `SpeakerSyncStrategyTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sync` | `MMCA.ADC.Conference.Application.Tests/Sync/SpeakerSyncStrategyTests.cs:12` |
| `Fakes` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Users.IntegrationEventHandlers` | `MMCA.ADC.Conference.Application.Tests/Users/IntegrationEventHandlers/UserRegisteredHandlerTests.cs:18` |
| `UserRegisteredHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Users.IntegrationEventHandlers` | `MMCA.ADC.Conference.Application.Tests/Users/IntegrationEventHandlers/UserRegisteredHandlerTests.cs:15` |
| `DependencyInjection` | class | MMCA.ADC.Conference.Contracts | `MMCA.ADC.Conference.Contracts` | `MMCA.ADC.Conference.Contracts/DependencyInjection.cs:15` |
| `EventLiveValidationServiceGrpcAdapter` | class | MMCA.ADC.Conference.Contracts | `MMCA.ADC.Conference.Contracts` | `MMCA.ADC.Conference.Contracts/EventLiveValidationServiceGrpcAdapter.cs:23` |
| `GrpcErrorTrailerParser` | class | MMCA.ADC.Conference.Contracts | `MMCA.ADC.Conference.Contracts` | `MMCA.ADC.Conference.Contracts/GrpcErrorTrailerParser.cs:14` |
| `SessionBookmarkValidationServiceGrpcAdapter` | class | MMCA.ADC.Conference.Contracts | `MMCA.ADC.Conference.Contracts` | `MMCA.ADC.Conference.Contracts/SessionBookmarkValidationServiceGrpcAdapter.cs:24` |
| `AssemblyReference` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain` | `MMCA.ADC.Conference.Domain/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain` | `MMCA.ADC.Conference.Domain/AssemblyReference.cs:11` |
| `Activity` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Activities` | `MMCA.ADC.Conference.Domain/Activities/Activity.cs:20` |
| `ActivityInvariants` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Activities` | `MMCA.ADC.Conference.Domain/Activities/ActivityInvariants.cs:10` |
| `ActivityChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Activities.DomainEvents` | `MMCA.ADC.Conference.Domain/Activities/DomainEvents/ActivityChanged.cs:12` |
| `Category` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Categories` | `MMCA.ADC.Conference.Domain/Categories/Category.cs:16` |
| `CategoryInvariants` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Categories` | `MMCA.ADC.Conference.Domain/Categories/CategoryInvariants.cs:11` |
| `CategoryItem` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Categories` | `MMCA.ADC.Conference.Domain/Categories/CategoryItem.cs:14` |
| `CategoryChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Categories.DomainEvents` | `MMCA.ADC.Conference.Domain/Categories/DomainEvents/CategoryChanged.cs:12` |
| `CategoryItemChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Categories.DomainEvents` | `MMCA.ADC.Conference.Domain/Categories/DomainEvents/CategoryItemChanged.cs:13` |
| `Event` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Events` | `MMCA.ADC.Conference.Domain/Events/Event.cs:23` |
| `EventInvariants` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Events` | `MMCA.ADC.Conference.Domain/Events/EventInvariants.cs:10` |
| `EventQuestionAnswer` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Events` | `MMCA.ADC.Conference.Domain/Events/EventQuestionAnswer.cs:13` |
| `EventSpeaker` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Events` | `MMCA.ADC.Conference.Domain/Events/EventSpeaker.cs:13` |
| `Room` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Events` | `MMCA.ADC.Conference.Domain/Events/Room.cs:12` |
| `EventChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Events.DomainEvents` | `MMCA.ADC.Conference.Domain/Events/DomainEvents/EventChanged.cs:12` |
| `EventQuestionAnswerChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Events.DomainEvents` | `MMCA.ADC.Conference.Domain/Events/DomainEvents/EventQuestionAnswerChanged.cs:13` |
| `EventSpeakerChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Events.DomainEvents` | `MMCA.ADC.Conference.Domain/Events/DomainEvents/EventSpeakerChanged.cs:13` |
| `RoomChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Events.DomainEvents` | `MMCA.ADC.Conference.Domain/Events/DomainEvents/RoomChanged.cs:13` |
| `Question` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Questions` | `MMCA.ADC.Conference.Domain/Questions/Question.cs:14` |
| `QuestionInvariants` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Questions` | `MMCA.ADC.Conference.Domain/Questions/QuestionInvariants.cs:10` |
| `QuestionChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Questions.DomainEvents` | `MMCA.ADC.Conference.Domain/Questions/DomainEvents/QuestionChanged.cs:12` |
| `EventCascadeDeletionDomainService` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Services` | `MMCA.ADC.Conference.Domain/Services/EventCascadeDeletionDomainService.cs:16` |
| `IEventCascadeDeletionDomainService` | interface | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Services` | `MMCA.ADC.Conference.Domain/Services/IEventCascadeDeletionDomainService.cs:15` |
| `Session` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions` | `MMCA.ADC.Conference.Domain/Sessions/Session.cs:22` |
| `SessionAiScore` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions` | `MMCA.ADC.Conference.Domain/Sessions/SessionAiScore.cs:13` |
| `SessionCategoryItem` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions` | `MMCA.ADC.Conference.Domain/Sessions/SessionCategoryItem.cs:13` |
| `SessionInvariants` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions` | `MMCA.ADC.Conference.Domain/Sessions/SessionInvariants.cs:10` |
| `SessionQuestionAnswer` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions` | `MMCA.ADC.Conference.Domain/Sessions/SessionQuestionAnswer.cs:13` |
| `SessionSpeaker` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions` | `MMCA.ADC.Conference.Domain/Sessions/SessionSpeaker.cs:13` |
| `SessionStatuses` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions` | `MMCA.ADC.Conference.Domain/Sessions/SessionStatuses.cs:14` |
| `SessionCategoryItemChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions.DomainEvents` | `MMCA.ADC.Conference.Domain/Sessions/DomainEvents/SessionCategoryItemChanged.cs:13` |
| `SessionChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions.DomainEvents` | `MMCA.ADC.Conference.Domain/Sessions/DomainEvents/SessionChanged.cs:13` |
| `SessionQuestionAnswerChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions.DomainEvents` | `MMCA.ADC.Conference.Domain/Sessions/DomainEvents/SessionQuestionAnswerChanged.cs:13` |
| `SessionSpeakerChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions.DomainEvents` | `MMCA.ADC.Conference.Domain/Sessions/DomainEvents/SessionSpeakerChanged.cs:13` |
| `Speaker` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Speakers` | `MMCA.ADC.Conference.Domain/Speakers/Speaker.cs:22` |
| `SpeakerCategoryItem` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Speakers` | `MMCA.ADC.Conference.Domain/Speakers/SpeakerCategoryItem.cs:13` |
| `SpeakerInvariants` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Speakers` | `MMCA.ADC.Conference.Domain/Speakers/SpeakerInvariants.cs:10` |
| `SpeakerQuestionAnswer` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Speakers` | `MMCA.ADC.Conference.Domain/Speakers/SpeakerQuestionAnswer.cs:13` |
| `SpeakerCategoryItemChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Speakers.DomainEvents` | `MMCA.ADC.Conference.Domain/Speakers/DomainEvents/SpeakerCategoryItemChanged.cs:13` |
| `SpeakerChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Speakers.DomainEvents` | `MMCA.ADC.Conference.Domain/Speakers/DomainEvents/SpeakerChanged.cs:16` |
| `SpeakerQuestionAnswerChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Speakers.DomainEvents` | `MMCA.ADC.Conference.Domain/Speakers/DomainEvents/SpeakerQuestionAnswerChanged.cs:13` |
| `Sponsor` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sponsors` | `MMCA.ADC.Conference.Domain/Sponsors/Sponsor.cs:18` |
| `SponsorInvariants` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sponsors` | `MMCA.ADC.Conference.Domain/Sponsors/SponsorInvariants.cs:10` |
| `SponsorChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sponsors.DomainEvents` | `MMCA.ADC.Conference.Domain/Sponsors/DomainEvents/SponsorChanged.cs:12` |
| `ActivityTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Activities` | `MMCA.ADC.Conference.Domain.Tests/Activities/ActivityTests.cs:10` |
| `ActivityBuilder` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Builders` | `MMCA.ADC.Conference.Domain.Tests/Builders/ActivityBuilder.cs:10` |
| `EventBuilder` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Builders` | `MMCA.ADC.Conference.Domain.Tests/Builders/EventBuilder.cs:10` |
| `SessionBuilder` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Builders` | `MMCA.ADC.Conference.Domain.Tests/Builders/SessionBuilder.cs:10` |
| `SpeakerBuilder` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Builders` | `MMCA.ADC.Conference.Domain.Tests/Builders/SpeakerBuilder.cs:10` |
| `SponsorBuilder` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Builders` | `MMCA.ADC.Conference.Domain.Tests/Builders/SponsorBuilder.cs:11` |
| `CategoryTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Categories` | `MMCA.ADC.Conference.Domain.Tests/Categories/CategoryTests.cs:8` |
| `EventQuestionAnswerTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Events` | `MMCA.ADC.Conference.Domain.Tests/Events/EventQuestionAnswerTests.cs:14` |
| `EventSpeakerTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Events` | `MMCA.ADC.Conference.Domain.Tests/Events/EventSpeakerTests.cs:13` |
| `EventTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Events` | `MMCA.ADC.Conference.Domain.Tests/Events/EventTests.cs:10` |
| `ActivityInvariantsTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Invariants` | `MMCA.ADC.Conference.Domain.Tests/Invariants/ActivityInvariantsTests.cs:6` |
| `CategoryInvariantsTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Invariants` | `MMCA.ADC.Conference.Domain.Tests/Invariants/CategoryInvariantsTests.cs:6` |
| `EventInvariantsTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Invariants` | `MMCA.ADC.Conference.Domain.Tests/Invariants/EventInvariantsTests.cs:6` |
| `QuestionInvariantsTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Invariants` | `MMCA.ADC.Conference.Domain.Tests/Invariants/QuestionInvariantsTests.cs:6` |
| `SessionInvariantsTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Invariants` | `MMCA.ADC.Conference.Domain.Tests/Invariants/SessionInvariantsTests.cs:6` |
| `SpeakerInvariantsTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Invariants` | `MMCA.ADC.Conference.Domain.Tests/Invariants/SpeakerInvariantsTests.cs:6` |
| `SponsorInvariantsTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Invariants` | `MMCA.ADC.Conference.Domain.Tests/Invariants/SponsorInvariantsTests.cs:6` |
| `QuestionTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Questions` | `MMCA.ADC.Conference.Domain.Tests/Questions/QuestionTests.cs:6` |
| `EventCascadeDeletionDomainServiceTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Services` | `MMCA.ADC.Conference.Domain.Tests/Services/EventCascadeDeletionDomainServiceTests.cs:9` |
| `SessionAiScoreTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Sessions` | `MMCA.ADC.Conference.Domain.Tests/Sessions/SessionAiScoreTests.cs:10` |
| `SessionCategoryItemTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Sessions` | `MMCA.ADC.Conference.Domain.Tests/Sessions/SessionCategoryItemTests.cs:14` |
| `SessionQuestionAnswerTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Sessions` | `MMCA.ADC.Conference.Domain.Tests/Sessions/SessionQuestionAnswerTests.cs:15` |
| `SessionSpeakerTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Sessions` | `MMCA.ADC.Conference.Domain.Tests/Sessions/SessionSpeakerTests.cs:14` |
| `SessionTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Sessions` | `MMCA.ADC.Conference.Domain.Tests/Sessions/SessionTests.cs:8` |
| `SpeakerCategoryItemTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Speakers` | `MMCA.ADC.Conference.Domain.Tests/Speakers/SpeakerCategoryItemTests.cs:13` |
| `SpeakerQuestionAnswerTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Speakers` | `MMCA.ADC.Conference.Domain.Tests/Speakers/SpeakerQuestionAnswerTests.cs:14` |
| `SpeakerTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Speakers` | `MMCA.ADC.Conference.Domain.Tests/Speakers/SpeakerTests.cs:8` |
| `SponsorTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Sponsors` | `MMCA.ADC.Conference.Domain.Tests/Sponsors/SponsorTests.cs:11` |
| `AssemblyReference` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure` | `MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure` | `MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure` | `MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:12` |
| `ModuleApplicationDbContext` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts` | `MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:20` |
| `ConferenceModuleDbSeeder` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts.Seeding` | `MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:25` |
| `ActivityConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/ActivityConfiguration.cs:11` |
| `CategoryItemConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/CategoryItemConfiguration.cs:10` |
| `ConferenceCategoryConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/ConferenceCategoryConfiguration.cs:13` |
| `EventConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/EventConfiguration.cs:11` |
| `EventQuestionAnswerConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/EventQuestionAnswerConfiguration.cs:11` |
| `EventSpeakerConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/EventSpeakerConfiguration.cs:11` |
| `QuestionConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/QuestionConfiguration.cs:10` |
| `RoomConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/RoomConfiguration.cs:11` |
| `SessionAiScoreConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionAiScoreConfiguration.cs:11` |
| `SessionCategoryItemConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionCategoryItemConfiguration.cs:11` |
| `SessionConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionConfiguration.cs:12` |
| `SessionQuestionAnswerConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionQuestionAnswerConfiguration.cs:11` |
| `SessionSpeakerConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionSpeakerConfiguration.cs:11` |
| `SpeakerCategoryItemConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SpeakerCategoryItemConfiguration.cs:11` |
| `SpeakerConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SpeakerConfiguration.cs:12` |
| `SpeakerQuestionAnswerConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SpeakerQuestionAnswerConfiguration.cs:10` |
| `SponsorConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SponsorConfiguration.cs:11` |
| `AiScoreResponse` | record | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Services` | `MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:238` |
| `AnthropicContentBlock` | record | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Services` | `MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:227` |
| `AnthropicMessage` | record | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Services` | `MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:212` |
| `AnthropicRequest` | record | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Services` | `MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:200` |
| `AnthropicResponse` | record | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Services` | `MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:221` |
| `AnthropicScoringService` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Services` | `MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:16` |
| `SessionizeService` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Services` | `MMCA.ADC.Conference.Infrastructure/Services/SessionizeService.cs:10` |
| `SessionScoreStamp` | record | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Services` | `MMCA.ADC.Conference.Infrastructure/Services/SessionScoringSweepJob.cs:213` |
| `SessionScoringCandidate` | record | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Services` | `MMCA.ADC.Conference.Infrastructure/Services/SessionScoringSweepJob.cs:208` |
| `SessionScoringProcessor` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Services` | `MMCA.ADC.Conference.Infrastructure/Services/SessionScoringProcessor.cs:49` |
| `SessionScoringSweepJob` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Services` | `MMCA.ADC.Conference.Infrastructure/Services/SessionScoringSweepJob.cs:54` |
| `ConferenceEntityConfigurationTests` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Persistence` | `MMCA.ADC.Conference.Infrastructure.Tests/Persistence/ConferenceEntityConfigurationTests.cs:13` |
| `ConferenceTestDbContext` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Persistence` | `MMCA.ADC.Conference.Infrastructure.Tests/Persistence/ConferenceEntityConfigurationTests.cs:755` |
| `ConferenceModuleDbSeederTests` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Seeding` | `MMCA.ADC.Conference.Infrastructure.Tests/Seeding/ConferenceModuleDbSeederTests.cs:11` |
| `SeederMocks` | record | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Seeding` | `MMCA.ADC.Conference.Infrastructure.Tests/Seeding/ConferenceModuleDbSeederTests.cs:79` |
| `AnthropicScoringServiceTests` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Services` | `MMCA.ADC.Conference.Infrastructure.Tests/Services/AnthropicScoringServiceTests.cs:12` |
| `FakeAnthropicHandler` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Services` | `MMCA.ADC.Conference.Infrastructure.Tests/Services/AnthropicScoringServiceTests.cs:36` |
| `FixedTimeProvider` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Services` | `MMCA.ADC.Conference.Infrastructure.Tests/Services/SessionScoringSweepJobTests.cs:211` |
| `Handle` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Services` | `MMCA.ADC.Conference.Infrastructure.Tests/Services/SessionScoringProcessorTests.cs:235` |
| `RecordingDistributedLock` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Services` | `MMCA.ADC.Conference.Infrastructure.Tests/Services/SessionScoringProcessorTests.cs:197` |
| `RecordingLogger` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Services` | `MMCA.ADC.Conference.Infrastructure.Tests/Services/SessionScoringProcessorTests.cs:307` |
| `RecordingScoringHandler` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Services` | `MMCA.ADC.Conference.Infrastructure.Tests/Services/SessionScoringProcessorTests.cs:344` |
| `SessionizeServiceTests` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Services` | `MMCA.ADC.Conference.Infrastructure.Tests/Services/SessionizeServiceTests.cs:11` |
| `SessionScoringProcessorTests` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Services` | `MMCA.ADC.Conference.Infrastructure.Tests/Services/SessionScoringProcessorTests.cs:23` |
| `SessionScoringSweepJobTests` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Services` | `MMCA.ADC.Conference.Infrastructure.Tests/Services/SessionScoringSweepJobTests.cs:18` |
| `TerminalFailureRecorder` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Services` | `MMCA.ADC.Conference.Infrastructure.Tests/Services/SessionScoringProcessorTests.cs:249` |
| `AnonymousAccessDeniedTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Anonymous` | `MMCA.ADC.Conference.IntegrationTests/Anonymous/AnonymousAccessDeniedTests.cs:8` |
| `AttendeeAccessDeniedTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Attendee` | `MMCA.ADC.Conference.IntegrationTests/Attendee/AttendeeAccessDeniedTests.cs:8` |
| `AttendeeQuestionAnswerTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Attendee` | `MMCA.ADC.Conference.IntegrationTests/Attendee/AttendeeQuestionAnswerTests.cs:9` |
| `ApiVersioningTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Contract` | `MMCA.ADC.Conference.IntegrationTests/Contract/ApiVersioningTests.cs:14` |
| `OpenApiContractTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Contract` | `MMCA.ADC.Conference.IntegrationTests/Contract/OpenApiContractTests.cs:14` |
| `ProblemDetailsContractTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Contract` | `MMCA.ADC.Conference.IntegrationTests/Contract/ProblemDetailsContractTests.cs:19` |
| `CrossServiceUserRegisteredTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.CrossService` | `MMCA.ADC.Conference.IntegrationTests/CrossService/CrossServiceUserRegisteredTests.cs:26` |
| `AuditStampFidelityTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Data` | `MMCA.ADC.Conference.IntegrationTests/Data/AuditStampFidelityTests.cs:18` |
| `IdempotencyReplayTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Data` | `MMCA.ADC.Conference.IntegrationTests/Data/IdempotencyReplayTests.cs:17` |
| `SoftDeleteFidelityTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Data` | `MMCA.ADC.Conference.IntegrationTests/Data/SoftDeleteFidelityTests.cs:17` |
| `ConferenceIntegrationTestBase` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Infrastructure` | `MMCA.ADC.Conference.IntegrationTests/Infrastructure/ConferenceIntegrationTestBase.cs:15` |
| `ConferenceIntegrationTestCollection` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Infrastructure` | `MMCA.ADC.Conference.IntegrationTests/Infrastructure/ConferenceIntegrationTestCollection.cs:8` |
| `ConferenceIntegrationTestFixture` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Infrastructure` | `MMCA.ADC.Conference.IntegrationTests/Infrastructure/ConferenceIntegrationTestFixture.cs:17` |
| `ConferenceTestWebApplicationFactory` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Infrastructure` | `MMCA.ADC.Conference.IntegrationTests/Infrastructure/ConferenceTestWebApplicationFactory.cs:33` |
| `FakeAiScoringService` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Infrastructure` | `MMCA.ADC.Conference.IntegrationTests/Infrastructure/FakeAiScoringService.cs:11` |
| `FakeBookmarkCountService` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Infrastructure` | `MMCA.ADC.Conference.IntegrationTests/Infrastructure/FakeBookmarkCountService.cs:9` |
| `FakeSessionizeService` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Infrastructure` | `MMCA.ADC.Conference.IntegrationTests/Infrastructure/FakeSessionizeService.cs:12` |
| `OrganizerAssociationEdgeCaseTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerAssociationEdgeCaseTests.cs:10` |
| `OrganizerAssociationTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerAssociationTests.cs:10` |
| `OrganizerCategoryTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerCategoryTests.cs:10` |
| `OrganizerConcurrencyTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerConcurrencyTests.cs:16` |
| `OrganizerEventLifecycleTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerEventLifecycleTests.cs:10` |
| `OrganizerEventTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerEventTests.cs:10` |
| `OrganizerQuestionAnswerTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerQuestionAnswerTests.cs:9` |
| `OrganizerQuestionTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerQuestionTests.cs:10` |
| `OrganizerRoomEdgeCaseTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerRoomEdgeCaseTests.cs:10` |
| `OrganizerRoomTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerRoomTests.cs:10` |
| `OrganizerSessionEdgeCaseTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerSessionEdgeCaseTests.cs:10` |
| `OrganizerSessionTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerSessionTests.cs:10` |
| `SessionizeRefreshTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/SessionizeRefreshTests.cs:17` |
| `SessionSelectionTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/SessionSelectionTests.cs:19` |
| `AnonymousConferenceReadTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Reads` | `MMCA.ADC.Conference.IntegrationTests/Reads/AnonymousConferenceReadTests.cs:15` |
| `OutputCacheEvictionTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Reads` | `MMCA.ADC.Conference.IntegrationTests/Reads/OutputCacheEvictionTests.cs:25` |
| `SessionIncludeChildrenRegressionTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Reads` | `MMCA.ADC.Conference.IntegrationTests/Reads/SessionIncludeChildrenRegressionTests.cs:24` |
| `SpeakerFeedbackAuthTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Speaker` | `MMCA.ADC.Conference.IntegrationTests/Speaker/SpeakerFeedbackAuthTests.cs:15` |
| `SpeakerManagementTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Speaker` | `MMCA.ADC.Conference.IntegrationTests/Speaker/SpeakerManagementTests.cs:9` |
| `SpeakerUpdateAuthTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Speaker` | `MMCA.ADC.Conference.IntegrationTests/Speaker/SpeakerUpdateAuthTests.cs:7` |
| `SelfHttpOutputCacheWarmupTask` | class | MMCA.ADC.Conference.Service | `MMCA.ADC.Conference.Service` | `MMCA.ADC.Conference.Service/SelfHttpOutputCacheWarmupTask.cs:22` |
| `EventLiveValidationGrpcService` | class | MMCA.ADC.Conference.Service | `MMCA.ADC.Conference.Service.Grpc` | `MMCA.ADC.Conference.Service/Grpc/EventLiveValidationGrpcService.cs:22` |
| `SessionBookmarksGrpcService` | class | MMCA.ADC.Conference.Service | `MMCA.ADC.Conference.Service.Grpc` | `MMCA.ADC.Conference.Service/Grpc/SessionBookmarksGrpcService.cs:23` |
| `ConferenceFeatures` | class | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared` | `MMCA.ADC.Conference.Shared/ConferenceFeatures.cs:8` |
| `ActivityDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Activities` | `MMCA.ADC.Conference.Shared/Activities/ActivityDTO.cs:10` |
| `ConferencePermissions` | class | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Authorization` | `MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:9` |
| `ConferenceReadAudience` | class | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Authorization` | `MMCA.ADC.Conference.Shared/Authorization/ConferenceReadAudience.cs:23` |
| `CategoryItemDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Categories` | `MMCA.ADC.Conference.Shared/Categories/CategoryItemDTO.cs:8` |
| `ConferenceCategoryDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Categories` | `MMCA.ADC.Conference.Shared/Categories/ConferenceCategoryDTO.cs:9` |
| `CurrentEventDefaults` | class | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/CurrentEventDefaults.cs:8` |
| `CurrentEventSelector` | class | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/CurrentEventSelector.cs:10` |
| `DisabledEventLiveValidationService` | class | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/DisabledEventLiveValidationService.cs:22` |
| `EventDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/EventDTO.cs:9` |
| `EventLiveInfo` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/EventLiveInfo.cs:13` |
| `EventQuestionAnswerDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/EventQuestionAnswerDTO.cs:9` |
| `EventSpeakerDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/EventSpeakerDTO.cs:8` |
| `EventTransitionRequest` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/EventTransitionRequest.cs:14` |
| `IEventLiveValidationService` | interface | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/IEventLiveValidationService.cs:11` |
| `QuestionModerationDefault` | enum | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/QuestionModerationDefault.cs:7` |
| `RefreshFromSessionizeResultDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/RefreshFromSessionizeResultDTO.cs:7` |
| `RoomDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/RoomDTO.cs:8` |
| `RoomSessionInfo` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/RoomSessionInfo.cs:18` |
| `SessionLiveInfo` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/SessionLiveInfo.cs:17` |
| `SponsorLiveInfo` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/SponsorLiveInfo.cs:12` |
| `EventFeedbackSubmitted` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events.IntegrationEvents` | `MMCA.ADC.Conference.Shared/Events/IntegrationEvents/EventFeedbackSubmitted.cs:18` |
| `QuestionDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Questions` | `MMCA.ADC.Conference.Shared/Questions/QuestionDTO.cs:9` |
| `DisabledSessionBookmarkValidationService` | class | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions` | `MMCA.ADC.Conference.Shared/Sessions/DisabledSessionBookmarkValidationService.cs:30` |
| `ISessionBookmarkValidationService` | interface | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions` | `MMCA.ADC.Conference.Shared/Sessions/ISessionBookmarkValidationService.cs:10` |
| `NowNextDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions` | `MMCA.ADC.Conference.Shared/Sessions/NowNextDTO.cs:14` |
| `NowNextSessionDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions` | `MMCA.ADC.Conference.Shared/Sessions/NowNextDTO.cs:29` |
| `SessionCategoryItemDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions` | `MMCA.ADC.Conference.Shared/Sessions/SessionCategoryItemDTO.cs:8` |
| `SessionDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions` | `MMCA.ADC.Conference.Shared/Sessions/SessionDTO.cs:9` |
| `SessionQuestionAnswerDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions` | `MMCA.ADC.Conference.Shared/Sessions/SessionQuestionAnswerDTO.cs:9` |
| `SessionSpeakerDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions` | `MMCA.ADC.Conference.Shared/Sessions/SessionSpeakerDTO.cs:8` |
| `CategoryDistributionDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` | `MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/CategoryDistributionDTO.cs:7` |
| `CategoryGroupDistribution` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` | `MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/CategoryDistributionDTO.cs:14` |
| `CategoryItemDistribution` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` | `MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/CategoryDistributionDTO.cs:27` |
| `ContentSimilarityDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` | `MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/ContentSimilarityDTO.cs:7` |
| `MultiSessionSpeaker` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` | `MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/SpeakerSessionOverlapDTO.cs:18` |
| `ScoreEventSessionsResultDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` | `MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/SessionAiScoreDTO.cs:60` |
| `SessionAiScoreDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` | `MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/SessionAiScoreDTO.cs:6` |
| `SessionSelectionDashboardDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` | `MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/SessionSelectionDashboardDTO.cs:8` |
| `SimilarSessionPair` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` | `MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/ContentSimilarityDTO.cs:14` |
| `SpeakerLocalitySummary` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` | `MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/SessionSelectionDashboardDTO.cs:45` |
| `SpeakerSessionOverlapDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` | `MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/SpeakerSessionOverlapDTO.cs:8` |
| `SpeakerSessionSummary` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions.DecisionSupport` | `MMCA.ADC.Conference.Shared/Sessions/DecisionSupport/SpeakerSessionOverlapDTO.cs:37` |
| `SessionFeedbackSubmitted` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sessions.IntegrationEvents` | `MMCA.ADC.Conference.Shared/Sessions/IntegrationEvents/SessionFeedbackSubmitted.cs:19` |
| `LinkUserRequest` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Speakers` | `MMCA.ADC.Conference.Shared/Speakers/LinkUserRequest.cs:6` |
| `RatingQuestionSummary` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Speakers` | `MMCA.ADC.Conference.Shared/Speakers/SessionFeedbackDTO.cs:22` |
| `SessionFeedbackDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Speakers` | `MMCA.ADC.Conference.Shared/Speakers/SessionFeedbackDTO.cs:6` |
| `SpeakerCategoryItemDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Speakers` | `MMCA.ADC.Conference.Shared/Speakers/SpeakerCategoryItemDTO.cs:8` |
| `SpeakerDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Speakers` | `MMCA.ADC.Conference.Shared/Speakers/SpeakerDTO.cs:9` |
| `SpeakerQuestionAnswerDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Speakers` | `MMCA.ADC.Conference.Shared/Speakers/SpeakerQuestionAnswerDTO.cs:9` |
| `TextQuestionResponses` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Speakers` | `MMCA.ADC.Conference.Shared/Speakers/SessionFeedbackDTO.cs:38` |
| `SpeakerLinkedToUser` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Speakers.IntegrationEvents` | `MMCA.ADC.Conference.Shared/Speakers/IntegrationEvents/SpeakerLinkedToUser.cs:20` |
| `SpeakerUnlinkedFromUser` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Speakers.IntegrationEvents` | `MMCA.ADC.Conference.Shared/Speakers/IntegrationEvents/SpeakerUnlinkedFromUser.cs:17` |
| `SponsorDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sponsors` | `MMCA.ADC.Conference.Shared/Sponsors/SponsorDTO.cs:9` |
| `SponsorTier` | enum | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Sponsors` | `MMCA.ADC.Conference.Shared/Sponsors/SponsorTier.cs:12` |
| `ConferenceCategoryDTOTests` | class | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Categories` | `MMCA.ADC.Conference.Shared.Tests/Categories/ConferenceCategoryDTOTests.cs:6` |
| `CurrentEventDefaultsTests` | class | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Events` | `MMCA.ADC.Conference.Shared.Tests/Events/CurrentEventDefaultsTests.cs:11` |
| `CurrentEventSelectorTests` | class | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Events` | `MMCA.ADC.Conference.Shared.Tests/Events/CurrentEventSelectorTests.cs:11` |
| `DisabledEventLiveValidationServiceTests` | class | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Events` | `MMCA.ADC.Conference.Shared.Tests/Events/DisabledEventLiveValidationServiceTests.cs:12` |
| `EventDTOTests` | class | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Events` | `MMCA.ADC.Conference.Shared.Tests/Events/EventDTOTests.cs:6` |
| `EventQuestionAnswerDTOTests` | class | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Events` | `MMCA.ADC.Conference.Shared.Tests/Events/EventQuestionAnswerDTOTests.cs:6` |
| `EventSpeakerDTOTests` | class | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Events` | `MMCA.ADC.Conference.Shared.Tests/Events/EventSpeakerDTOTests.cs:6` |
| `RoomDTOTests` | class | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Events` | `MMCA.ADC.Conference.Shared.Tests/Events/RoomDTOTests.cs:6` |
| `TestEvent` | record | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Events` | `MMCA.ADC.Conference.Shared.Tests/Events/CurrentEventSelectorTests.cs:15` |
| `QuestionDTOTests` | class | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Questions` | `MMCA.ADC.Conference.Shared.Tests/Questions/QuestionDTOTests.cs:6` |
| `SessionCategoryItemDTOTests` | class | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Sessions` | `MMCA.ADC.Conference.Shared.Tests/Sessions/SessionCategoryItemDTOTests.cs:6` |
| `SessionDTOTests` | class | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Sessions` | `MMCA.ADC.Conference.Shared.Tests/Sessions/SessionDTOTests.cs:6` |
| `SessionQuestionAnswerDTOTests` | class | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Sessions` | `MMCA.ADC.Conference.Shared.Tests/Sessions/SessionQuestionAnswerDTOTests.cs:6` |
| `SessionSpeakerDTOTests` | class | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Sessions` | `MMCA.ADC.Conference.Shared.Tests/Sessions/SessionSpeakerDTOTests.cs:6` |
| `SpeakerCategoryItemDTOTests` | class | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Speakers` | `MMCA.ADC.Conference.Shared.Tests/Speakers/SpeakerCategoryItemDTOTests.cs:6` |
| `SpeakerDTOTests` | class | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Speakers` | `MMCA.ADC.Conference.Shared.Tests/Speakers/SpeakerDTOTests.cs:6` |
| `SpeakerQuestionAnswerDTOTests` | class | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Speakers` | `MMCA.ADC.Conference.Shared.Tests/Speakers/SpeakerQuestionAnswerDTOTests.cs:6` |
| `ConferenceRoutePaths` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI` | `MMCA.ADC.Conference.UI/ConferenceRoutePaths.cs:8` |
| `ConferenceUIModule` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI` | `MMCA.ADC.Conference.UI/ConferenceUIModule.cs:14` |
| `DependencyInjection` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI` | `MMCA.ADC.Conference.UI/DependencyInjection.cs:11` |
| `InfiniteScrollSentinel` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Components` | `MMCA.ADC.Conference.UI/Components/InfiniteScrollSentinel.razor.cs:21` |
| `ActivityCreate` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Activity` | `MMCA.ADC.Conference.UI/Pages/Activity/ActivityCreate.razor.cs:16` |
| `ActivityDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Activity` | `MMCA.ADC.Conference.UI/Pages/Activity/ActivityDetail.razor.cs:16` |
| `ActivityList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Activity` | `MMCA.ADC.Conference.UI/Pages/Activity/ActivityList.razor.cs:19` |
| `ConferenceCategoryCreate` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.ConferenceCategory` | `MMCA.ADC.Conference.UI/Pages/ConferenceCategory/ConferenceCategoryCreate.razor.cs:9` |
| `ConferenceCategoryDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.ConferenceCategory` | `MMCA.ADC.Conference.UI/Pages/ConferenceCategory/ConferenceCategoryDetail.razor.cs:11` |
| `ConferenceCategoryList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.ConferenceCategory` | `MMCA.ADC.Conference.UI/Pages/ConferenceCategory/ConferenceCategoryList.razor.cs:11` |
| `EventCreate` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Event` | `MMCA.ADC.Conference.UI/Pages/Event/EventCreate.razor.cs:13` |
| `EventDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Event` | `MMCA.ADC.Conference.UI/Pages/Event/EventDetail.razor.cs:15` |
| `EventList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Event` | `MMCA.ADC.Conference.UI/Pages/Event/EventList.razor.cs:16` |
| `OrganizerEventFeedback` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Feedback` | `MMCA.ADC.Conference.UI/Pages/Feedback/OrganizerEventFeedback.razor.cs:14` |
| `OrganizerSessionFeedback` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Feedback` | `MMCA.ADC.Conference.UI/Pages/Feedback/OrganizerSessionFeedback.razor.cs:14` |
| `ADCCollectionResult` | record | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Home` | `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:297` |
| `ADCEventInfo` | record | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Home` | `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:299` |
| `ADCHome` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Home` | `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:18` |
| `ADCSponsorCollectionResult` | record | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Home` | `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:311` |
| `ADCSponsorInfo` | record | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Home` | `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:313` |
| `ConferenceTrackInfo` | record | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Home` | `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:372` |
| `EventPhase` | enum | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Home` | `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:72` |
| `KeynoteSpeakerInfo` | record | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Home` | `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:371` |
| `PreConferenceWorkshopInfo` | record | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Home` | `MMCA.ADC.Conference.UI/Pages/Home/ADCHome.razor.cs:379` |
| `CachedSessionPage` | record | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicSessionList.razor.cs:366` |
| `PublicActivityList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicActivityList.razor.cs:19` |
| `PublicEventDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicEventDetail.razor.cs:16` |
| `PublicEventList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicEventList.razor.cs:30` |
| `PublicScheduleRoomOptions` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicScheduleRoomOptions.cs:11` |
| `PublicSessionDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicSessionDetail.razor.cs:20` |
| `PublicSessionList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicSessionList.razor.cs:25` |
| `PublicSessionListFilterBar` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicSessionListFilterBar.razor.cs:15` |
| `PublicSessionListView` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicSessionListView.razor.cs:23` |
| `PublicSpeakerDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicSpeakerDetail.razor.cs:14` |
| `PublicSpeakerList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicSpeakerList.razor.cs:35` |
| `PublicSponsorList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicSponsorList.razor.cs:18` |
| `QuestionCreate` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Question` | `MMCA.ADC.Conference.UI/Pages/Question/QuestionCreate.razor.cs:9` |
| `QuestionDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Question` | `MMCA.ADC.Conference.UI/Pages/Question/QuestionDetail.razor.cs:11` |
| `QuestionList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Question` | `MMCA.ADC.Conference.UI/Pages/Question/QuestionList.razor.cs:11` |
| `RoomCreate` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Room` | `MMCA.ADC.Conference.UI/Pages/Room/RoomCreate.razor.cs:9` |
| `RoomDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Room` | `MMCA.ADC.Conference.UI/Pages/Room/RoomDetail.razor.cs:12` |
| `RoomList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Room` | `MMCA.ADC.Conference.UI/Pages/Room/RoomList.razor.cs:12` |
| `SessionCreate` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Session` | `MMCA.ADC.Conference.UI/Pages/Session/SessionCreate.razor.cs:15` |
| `SessionDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Session` | `MMCA.ADC.Conference.UI/Pages/Session/SessionDetail.razor.cs:17` |
| `SessionList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Session` | `MMCA.ADC.Conference.UI/Pages/Session/SessionList.razor.cs:18` |
| `ScorePollSignal` | enum | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.SessionSelection` | `MMCA.ADC.Conference.UI/Pages/SessionSelection/ScorePollTracker.cs:6` |
| `ScorePollTracker` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.SessionSelection` | `MMCA.ADC.Conference.UI/Pages/SessionSelection/ScorePollTracker.cs:31` |
| `SessionSelectionAiScores` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.SessionSelection` | `MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionAiScores.razor.cs:12` |
| `SessionSelectionDashboard` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.SessionSelection` | `MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionDashboard.razor.cs:13` |
| `SessionSelectionDisplay` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.SessionSelection` | `MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionDisplay.cs:11` |
| `SessionSelectionFilterOptions` | record | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.SessionSelection` | `MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionFilterOptions.cs:11` |
| `SessionSelectionSpeakerOverlap` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.SessionSelection` | `MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionSpeakerOverlap.razor.cs:11` |
| `SpeakerCategoryItemsPanel` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Speaker` | `MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerCategoryItemsPanel.razor.cs:16` |
| `SpeakerCreate` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Speaker` | `MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerCreate.razor.cs:13` |
| `SpeakerDashboard` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Speaker` | `MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerDashboard.razor.cs:19` |
| `SpeakerDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Speaker` | `MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerDetail.razor.cs:19` |
| `SpeakerList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Speaker` | `MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerList.razor.cs:19` |
| `SpeakerQr` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Speaker` | `MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerQr.razor.cs:19` |
| `SponsorCreate` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Sponsor` | `MMCA.ADC.Conference.UI/Pages/Sponsor/SponsorCreate.razor.cs:15` |
| `SponsorDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Sponsor` | `MMCA.ADC.Conference.UI/Pages/Sponsor/SponsorDetail.razor.cs:15` |
| `SponsorList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Sponsor` | `MMCA.ADC.Conference.UI/Pages/Sponsor/SponsorList.razor.cs:19` |
| `ActivityService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ActivityService.cs:10` |
| `CategoryItemInfo` | record | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ICategoryItemLookupService.cs:7` |
| `CategoryItemLookupService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/CategoryItemLookupService.cs:11` |
| `CategoryItemService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/CategoryItemService.cs:10` |
| `ConferenceCategoryService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ConferenceCategoryService.cs:10` |
| `EventInfo` | record | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/IEventLookupService.cs:12` |
| `EventLookupService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/EventLookupService.cs:11` |
| `EventService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/EventService.cs:13` |
| `EventSpeakerService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:14` |
| `IActivityUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/IActivityUIService.cs:9` |
| `ICategoryItemLookupService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ICategoryItemLookupService.cs:16` |
| `ICategoryItemUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ICategoryItemUIService.cs:9` |
| `IConferenceCategoryUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/IConferenceCategoryUIService.cs:9` |
| `IEventLookupService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/IEventLookupService.cs:24` |
| `IEventSpeakerUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/IChildEntityUIService.cs:10` |
| `IEventUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/IEventUIService.cs:10` |
| `IOrganizerEventFeedbackUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/IOrganizerFeedbackUIService.cs:10` |
| `IOrganizerSessionFeedbackUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/IOrganizerFeedbackUIService.cs:26` |
| `IPublicLinkBuilder` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/IPublicLinkBuilder.cs:9` |
| `IQuestionUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/IQuestionUIService.cs:9` |
| `IRoomUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/IRoomUIService.cs:9` |
| `ISessionCategoryItemUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/IChildEntityUIService.cs:28` |
| `ISessionSelectionUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ISessionSelectionUIService.cs:8` |
| `ISessionSpeakerUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/IChildEntityUIService.cs:19` |
| `ISessionUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ISessionUIService.cs:9` |
| `ISpeakerCategoryItemUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/IChildEntityUIService.cs:37` |
| `ISpeakerDashboardUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ISpeakerDashboardUIService.cs:9` |
| `ISpeakerLookupService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ISpeakerLookupService.cs:15` |
| `ISpeakerUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ISpeakerUIService.cs:9` |
| `ISponsorUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ISponsorUIService.cs:9` |
| `NavigationPublicLinkBuilder` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/NavigationPublicLinkBuilder.cs:10` |
| `OrganizerEventFeedbackService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/OrganizerFeedbackService.cs:15` |
| `OrganizerSessionFeedbackService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/OrganizerFeedbackService.cs:62` |
| `QuestionService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/QuestionService.cs:10` |
| `RoomService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/RoomService.cs:13` |
| `SessionCategoryItemService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:46` |
| `SessionSelectionService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/SessionSelectionService.cs:12` |
| `SessionService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/SessionService.cs:10` |
| `SessionSpeakerService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:30` |
| `SpeakerCategoryItemService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:62` |
| `SpeakerDashboardService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/SpeakerDashboardService.cs:15` |
| `SpeakerInfo` | record | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ISpeakerLookupService.cs:7` |
| `SpeakerLookupService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/SpeakerLookupService.cs:11` |
| `SpeakerService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/SpeakerService.cs:12` |
| `SponsorService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/SponsorService.cs:10` |
| `BunitTestBase` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests` | `MMCA.ADC.Conference.UI.Tests/BunitTestBase.cs:19` |
| `ManagementRouteAuthorizationTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests` | `MMCA.ADC.Conference.UI.Tests/ManagementRouteAuthorizationTests.cs:19` |
| `AddToCalendarButtonTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Components` | `MMCA.ADC.Conference.UI.Tests/Components/AddToCalendarButtonTests.cs:22` |
| `QrCodeButtonTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Components` | `MMCA.ADC.Conference.UI.Tests/Components/QrCodeButtonTests.cs:14` |
| `SharePageButtonTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Components` | `MMCA.ADC.Conference.UI.Tests/Components/SharePageButtonTests.cs:17` |
| `ActivityCreateTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Activity` | `MMCA.ADC.Conference.UI.Tests/Pages/Activity/ActivityCreateTests.cs:19` |
| `ActivityDetailTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Activity` | `MMCA.ADC.Conference.UI.Tests/Pages/Activity/ActivityDetailTests.cs:18` |
| `EventCreateTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Event` | `MMCA.ADC.Conference.UI.Tests/Pages/Event/EventCreateTests.cs:17` |
| `EventDetailTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Event` | `MMCA.ADC.Conference.UI.Tests/Pages/Event/EventDetailTests.cs:17` |
| `OrganizerEventFeedbackTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Feedback` | `MMCA.ADC.Conference.UI.Tests/Pages/Feedback/OrganizerEventFeedbackTests.cs:18` |
| `OrganizerSessionFeedbackTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Feedback` | `MMCA.ADC.Conference.UI.Tests/Pages/Feedback/OrganizerSessionFeedbackTests.cs:19` |
| `ADCHomeTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Home` | `MMCA.ADC.Conference.UI.Tests/Pages/Home/ADCHomeTests.cs:20` |
| `ADCHomeTicketingTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Home` | `MMCA.ADC.Conference.UI.Tests/Pages/Home/ADCHomeTests.cs:124` |
| `PublicActivityListTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicActivityListTests.cs:16` |
| `PublicEventDetailTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicEventDetailTests.cs:15` |
| `PublicEventListRedirectTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicEventListRedirectTests.cs:34` |
| `PublicSessionDetailBookmarkTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicSessionDetailBookmarkTests.cs:23` |
| `PublicSessionDetailLiveButtonTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicSessionDetailLiveButtonTests.cs:23` |
| `PublicSessionDetailTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicSessionDetailTests.cs:22` |
| `PublicSessionListEventFilterTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicSessionListEventFilterTests.cs:22` |
| `PublicSessionListRoomFilterTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicSessionListRoomFilterTests.cs:20` |
| `PublicSessionListViewBookmarkTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicSessionListViewBookmarkTests.cs:19` |
| `PublicSpeakerDetailTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicSpeakerDetailTests.cs:13` |
| `PublicSpeakerListCardGridTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicSpeakerListCardGridTests.cs:24` |
| `PublicSpeakerListEventFilterTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicSpeakerListEventFilterTests.cs:21` |
| `PublicSponsorListTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicSponsorListTests.cs:16` |
| `QuestionCreateTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Question` | `MMCA.ADC.Conference.UI.Tests/Pages/Question/QuestionCreateTests.cs:18` |
| `QuestionDetailTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Question` | `MMCA.ADC.Conference.UI.Tests/Pages/Question/QuestionDetailTests.cs:17` |
| `RoomDetailTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Room` | `MMCA.ADC.Conference.UI.Tests/Pages/Room/RoomDetailTests.cs:16` |
| `SessionDetailRoomCacheTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Session` | `MMCA.ADC.Conference.UI.Tests/Pages/Session/SessionDetailRoomCacheTests.cs:19` |
| `SessionListEventFilterTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Session` | `MMCA.ADC.Conference.UI.Tests/Pages/Session/SessionListEventFilterTests.cs:20` |
| `SessionSelectionAiScoresTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.SessionSelection` | `MMCA.ADC.Conference.UI.Tests/Pages/SessionSelection/SessionSelectionAiScoresTests.cs:15` |
| `SessionSelectionDashboardTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.SessionSelection` | `MMCA.ADC.Conference.UI.Tests/Pages/SessionSelection/SessionSelectionDashboardTests.cs:18` |
| `SessionSelectionSpeakerOverlapTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.SessionSelection` | `MMCA.ADC.Conference.UI.Tests/Pages/SessionSelection/SessionSelectionSpeakerOverlapTests.cs:14` |
| `SessionSelectionStaleResponseTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.SessionSelection` | `MMCA.ADC.Conference.UI.Tests/Pages/SessionSelection/SessionSelectionStaleResponseTests.cs:21` |
| `FixedOriginLinkBuilder` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Speaker` | `MMCA.ADC.Conference.UI.Tests/Pages/Speaker/SpeakerQrTests.cs:94` |
| `SpeakerDashboardTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Speaker` | `MMCA.ADC.Conference.UI.Tests/Pages/Speaker/SpeakerDashboardTests.cs:21` |
| `SpeakerQrTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Speaker` | `MMCA.ADC.Conference.UI.Tests/Pages/Speaker/SpeakerQrTests.cs:17` |
| `SponsorCreateTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Sponsor` | `MMCA.ADC.Conference.UI.Tests/Pages/Sponsor/SponsorCreateTests.cs:19` |
| `SponsorDetailTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Sponsor` | `MMCA.ADC.Conference.UI.Tests/Pages/Sponsor/SponsorDetailTests.cs:18` |
| `EventServiceTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Services` | `MMCA.ADC.Conference.UI.Tests/Services/EventServiceTests.cs:15` |
| `OrganizerEventFeedbackServiceTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Services` | `MMCA.ADC.Conference.UI.Tests/Services/OrganizerEventFeedbackServiceTests.cs:15` |
| `OrganizerSessionFeedbackServiceTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Services` | `MMCA.ADC.Conference.UI.Tests/Services/OrganizerSessionFeedbackServiceTests.cs:14` |
| `SessionSelectionServiceTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Services` | `MMCA.ADC.Conference.UI.Tests/Services/SessionSelectionServiceTests.cs:13` |
| `SpeakerDashboardServiceTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Services` | `MMCA.ADC.Conference.UI.Tests/Services/SpeakerDashboardServiceTests.cs:20` |
| `BookmarkCountGrpcTests` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.CrossService` | `MMCA.ADC.CrossService.IntegrationTests/CrossService/BookmarkCountGrpcTests.cs:17` |
| `CrossServiceSmokeTests` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.CrossService` | `MMCA.ADC.CrossService.IntegrationTests/CrossService/CrossServiceSmokeTests.cs:15` |
| `SpeakerLinkBrokerFlowTests` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.CrossService` | `MMCA.ADC.CrossService.IntegrationTests/CrossService/SpeakerLinkBrokerFlowTests.cs:17` |
| `UserRegisteredBrokerFlowTests` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.CrossService` | `MMCA.ADC.CrossService.IntegrationTests/CrossService/UserRegisteredBrokerFlowTests.cs:20` |
| `ConferenceCrossServiceFactory` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.Infrastructure` | `MMCA.ADC.CrossService.IntegrationTests/Infrastructure/ConferenceCrossServiceFactory.cs:29` |
| `CrossServiceCollection` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.Infrastructure` | `MMCA.ADC.CrossService.IntegrationTests/Infrastructure/CrossServiceCollection.cs:10` |
| `CrossServiceFixture` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.Infrastructure` | `MMCA.ADC.CrossService.IntegrationTests/Infrastructure/CrossServiceFixture.cs:23` |
| `CrossServiceTestBase` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.Infrastructure` | `MMCA.ADC.CrossService.IntegrationTests/Infrastructure/CrossServiceTestBase.cs:20` |
| `EngagementCrossServiceFactory` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.Infrastructure` | `MMCA.ADC.CrossService.IntegrationTests/Infrastructure/EngagementCrossServiceFactory.cs:33` |
| `IdentityCrossServiceFactory` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.Infrastructure` | `MMCA.ADC.CrossService.IntegrationTests/Infrastructure/IdentityCrossServiceFactory.cs:28` |
| `RateLimiterNeutralizer` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.Infrastructure` | `MMCA.ADC.CrossService.IntegrationTests/Infrastructure/IdentityCrossServiceFactory.cs:43` |
| `E2ETestCollection` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Infrastructure` | `MMCA.ADC.E2E.Tests/Infrastructure/E2ETestCollection.cs:8` |
| `TestSetup` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Infrastructure` | `MMCA.ADC.E2E.Tests/Infrastructure/TestSetup.cs:5` |
| `CheckInScanPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/CheckInScanPage.cs:10` |
| `ConferenceCategoryCreatePage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/ConferenceCategoryCreatePage.cs:3` |
| `ConferenceCategoryDetailPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/ConferenceCategoryDetailPage.cs:3` |
| `ConferenceCategoryListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/ConferenceCategoryListPage.cs:3` |
| `EventCreatePage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/EventCreatePage.cs:3` |
| `EventDetailPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/EventDetailPage.cs:3` |
| `EventFeedbackPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/EventFeedbackPage.cs:3` |
| `EventListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/EventListPage.cs:3` |
| `HappeningNowPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/HappeningNowPage.cs:9` |
| `LiveSessionPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/LiveSessionPage.cs:16` |
| `MyBadgePage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/MyBadgePage.cs:7` |
| `MyPointsPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/MyPointsPage.cs:8` |
| `OrganizerAttendancePage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/OrganizerAttendancePage.cs:8` |
| `OrganizerEventFeedbackPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/OrganizerEventFeedbackPage.cs:3` |
| `OrganizerPointsOverviewPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/OrganizerPointsOverviewPage.cs:8` |
| `OrganizerSessionFeedbackPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/OrganizerSessionFeedbackPage.cs:3` |
| `PresenterViewPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/PresenterViewPage.cs:9` |
| `PublicEventDetailPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/PublicEventDetailPage.cs:3` |
| `PublicEventListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/PublicEventListPage.cs:3` |
| `PublicSessionDetailPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/PublicSessionDetailPage.cs:3` |
| `PublicSessionListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/PublicSessionListPage.cs:3` |
| `PublicSpeakerDetailPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/PublicSpeakerDetailPage.cs:3` |
| `PublicSpeakerListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/PublicSpeakerListPage.cs:10` |
| `PublicSponsorListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/PublicSponsorListPage.cs:8` |
| `QuestionCreatePage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/QuestionCreatePage.cs:3` |
| `QuestionDetailPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/QuestionDetailPage.cs:3` |
| `QuestionListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/QuestionListPage.cs:3` |
| `RoomCheckInPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/RoomCheckInPage.cs:8` |
| `RoomCreatePage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/RoomCreatePage.cs:3` |
| `RoomDetailPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/RoomDetailPage.cs:3` |
| `RoomListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/RoomListPage.cs:3` |
| `SessionCreatePage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/SessionCreatePage.cs:3` |
| `SessionDetailPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/SessionDetailPage.cs:3` |
| `SessionFeedbackPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/SessionFeedbackPage.cs:3` |
| `SessionListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/SessionListPage.cs:3` |
| `SpeakerCreatePage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/SpeakerCreatePage.cs:3` |
| `SpeakerDashboardPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/SpeakerDashboardPage.cs:3` |
| `SpeakerDetailPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/SpeakerDetailPage.cs:3` |
| `SpeakerListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/SpeakerListPage.cs:3` |
| `SpeakerQrPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/SpeakerQrPage.cs:7` |
| `SponsorCreatePage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/SponsorCreatePage.cs:8` |
| `SponsorDetailPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/SponsorDetailPage.cs:8` |
| `SponsorListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/SponsorListPage.cs:3` |
| `SponsorVisitPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/SponsorVisitPage.cs:8` |
| `UserListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/UserListPage.cs:3` |
| `AccessibilityTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows` | `MMCA.ADC.E2E.Tests/Workflows/AccessibilityTests.cs:17` |
| `PseudoLocalizationTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows` | `MMCA.ADC.E2E.Tests/Workflows/PseudoLocalizationTests.cs:34` |
| `WebVitalsTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows` | `MMCA.ADC.E2E.Tests/Workflows/WebVitalsTests.cs:23` |
| `DataIntegrityTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/DataIntegrityTests.cs:11` |
| `FeaturedEvent` | record | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/PublicBrowseTests.cs:462` |
| `OrganizerCategoryManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/OrganizerCategoryManagementTests.cs:9` |
| `OrganizerEventManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/OrganizerEventManagementTests.cs:9` |
| `OrganizerFeedbackAnalyticsTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/OrganizerFeedbackAnalyticsTests.cs:9` |
| `OrganizerQuestionManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/OrganizerQuestionManagementTests.cs:9` |
| `OrganizerRelationshipManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/OrganizerRelationshipManagementTests.cs:15` |
| `OrganizerRoomManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/OrganizerRoomManagementTests.cs:9` |
| `OrganizerSessionManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/OrganizerSessionManagementTests.cs:9` |
| `OrganizerSpeakerManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/OrganizerSpeakerManagementTests.cs:9` |
| `OrganizerSponsorManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/OrganizerSponsorManagementTests.cs:12` |
| `PublicBrowseTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/PublicBrowseTests.cs:9` |
| `PublicSponsorBrowseTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/PublicSponsorBrowseTests.cs:13` |
| `SessionSelectionDashboardTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/SessionSelectionDashboardTests.cs:12` |
| `SpeakerDashboardTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/SpeakerDashboardTests.cs:9` |
| `SpeakerSelfServiceTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/SpeakerSelfServiceTests.cs:25` |
| `AttendeeBookmarkTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Engagement` | `MMCA.ADC.E2E.Tests/Workflows/Engagement/AttendeeBookmarkTests.cs:13` |
| `AttendeeFeedbackTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Engagement` | `MMCA.ADC.E2E.Tests/Workflows/Engagement/AttendeeFeedbackTests.cs:9` |
| `AttendeeShareAndExportTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Engagement` | `MMCA.ADC.E2E.Tests/Workflows/Engagement/AttendeeShareAndExportTests.cs:12` |
| `CheckInAndPointsTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Engagement` | `MMCA.ADC.E2E.Tests/Workflows/Engagement/CheckInAndPointsTests.cs:29` |
| `LiveEventFixture` | record | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Engagement` | `MMCA.ADC.E2E.Tests/Workflows/Engagement/LiveSessionQaTests.cs:253` |
| `LivePollWorkflowTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Engagement` | `MMCA.ADC.E2E.Tests/Workflows/Engagement/LivePollWorkflowTests.cs:13` |
| `LiveSessionQaTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Engagement` | `MMCA.ADC.E2E.Tests/Workflows/Engagement/LiveSessionQaTests.cs:22` |
| `AccountDeletionTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Identity` | `MMCA.ADC.E2E.Tests/Workflows/Identity/AccountDeletionTests.cs:9` |
| `AuthorizationTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Identity` | `MMCA.ADC.E2E.Tests/Workflows/Identity/AuthorizationTests.cs:11` |
| `LogoutTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Identity` | `MMCA.ADC.E2E.Tests/Workflows/Identity/LogoutTests.cs:5` |
| `PasswordResetTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Identity` | `MMCA.ADC.E2E.Tests/Workflows/Identity/PasswordResetTests.cs:5` |
| `ProfileManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Identity` | `MMCA.ADC.E2E.Tests/Workflows/Identity/ProfileManagementTests.cs:8` |
| `UserLoginTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Identity` | `MMCA.ADC.E2E.Tests/Workflows/Identity/UserLoginTests.cs:5` |
| `UserManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Identity` | `MMCA.ADC.E2E.Tests/Workflows/Identity/UserManagementTests.cs:9` |
| `UserRegistrationTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Identity` | `MMCA.ADC.E2E.Tests/Workflows/Identity/UserRegistrationTests.cs:5` |
| `NotificationTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Notifications` | `MMCA.ADC.E2E.Tests/Workflows/Notifications/NotificationTests.cs:10` |
| `UserPreferencesTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Preferences` | `MMCA.ADC.E2E.Tests/Workflows/Preferences/UserPreferencesTests.cs:10` |
| `AssemblyReference` | class | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API` | `MMCA.ADC.Engagement.API/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API` | `MMCA.ADC.Engagement.API/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API` | `MMCA.ADC.Engagement.API/DependencyInjection.cs:14` |
| `EngagementModule` | class | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API` | `MMCA.ADC.Engagement.API/EngagementModule.cs:14` |
| `BookmarksController` | class | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API.Controllers` | `MMCA.ADC.Engagement.API/Controllers/BookmarksController.cs:33` |
| `CheckInsController` | class | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API.Controllers` | `MMCA.ADC.Engagement.API/Controllers/CheckInsController.cs:35` |
| `LivePollsController` | class | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API.Controllers` | `MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:44` |
| `PointsController` | class | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API.Controllers` | `MMCA.ADC.Engagement.API/Controllers/PointsController.cs:36` |
| `SessionQuestionsController` | class | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API.Controllers` | `MMCA.ADC.Engagement.API/Controllers/SessionQuestionsController.cs:39` |
| `EngagementErrorResources` | class | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API.Resources` | `MMCA.ADC.Engagement.API/Resources/EngagementErrorResources.cs:9` |
| `EngagementPermissionGrantsTests` | class | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Authorization` | `MMCA.ADC.Engagement.API.Tests/Authorization/EngagementPermissionGrantsTests.cs:15` |
| `BookmarksControllerTests` | class | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Controllers` | `MMCA.ADC.Engagement.API.Tests/Controllers/BookmarksControllerTests.cs:19` |
| `CheckInsControllerTests` | class | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Controllers` | `MMCA.ADC.Engagement.API.Tests/Controllers/CheckInsControllerTests.cs:19` |
| `ConditionalWriteConventionTests` | class | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Controllers` | `MMCA.ADC.Engagement.API.Tests/Controllers/ConditionalWriteConventionTests.cs:15` |
| `ControllerMocks` | record | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Controllers` | `MMCA.ADC.Engagement.API.Tests/Controllers/BookmarksControllerTests.cs:303` |
| `ControllerMocks` | record | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Controllers` | `MMCA.ADC.Engagement.API.Tests/Controllers/CheckInsControllerTests.cs:520` |
| `ControllerMocks` | record | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Controllers` | `MMCA.ADC.Engagement.API.Tests/Controllers/LivePollsControllerTests.cs:307` |
| `ControllerMocks` | record | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Controllers` | `MMCA.ADC.Engagement.API.Tests/Controllers/PointsControllerTests.cs:385` |
| `ControllerMocks` | record | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Controllers` | `MMCA.ADC.Engagement.API.Tests/Controllers/SessionQuestionsControllerTests.cs:301` |
| `LivePollsControllerTests` | class | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Controllers` | `MMCA.ADC.Engagement.API.Tests/Controllers/LivePollsControllerTests.cs:22` |
| `PointsControllerTests` | class | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Controllers` | `MMCA.ADC.Engagement.API.Tests/Controllers/PointsControllerTests.cs:21` |
| `SessionQuestionsControllerTests` | class | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Controllers` | `MMCA.ADC.Engagement.API.Tests/Controllers/SessionQuestionsControllerTests.cs:19` |
| `EngagementErrorResourcesTests` | class | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Localization` | `MMCA.ADC.Engagement.API.Tests/Localization/EngagementErrorResourcesTests.cs:15` |
| `AssemblyReference` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application` | `MMCA.ADC.Engagement.Application/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application` | `MMCA.ADC.Engagement.Application/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application` | `MMCA.ADC.Engagement.Application/DependencyInjection.cs:28` |
| `CheckInDTOMapper` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.CheckIns.DTOs` | `MMCA.ADC.Engagement.Application/CheckIns/DTOs/CheckInDTOMapper.cs:12` |
| `CheckInProcessor` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.CheckIns.Services` | `MMCA.ADC.Engagement.Application/CheckIns/Services/CheckInProcessor.cs:16` |
| `CheckInAttendeeHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.CheckIns.UseCases.CheckInAttendee` | `MMCA.ADC.Engagement.Application/CheckIns/UseCases/CheckInAttendee/CheckInAttendeeHandler.cs:18` |
| `CheckInAttendeeRequestValidator` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.CheckIns.UseCases.CheckInAttendee` | `MMCA.ADC.Engagement.Application/CheckIns/UseCases/CheckInAttendee/CheckInAttendeeRequestValidator.cs:9` |
| `GetAttendanceStatsHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.CheckIns.UseCases.GetAttendanceStats` | `MMCA.ADC.Engagement.Application/CheckIns/UseCases/GetAttendanceStats/GetAttendanceStatsHandler.cs:15` |
| `GetAttendanceStatsQuery` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.CheckIns.UseCases.GetAttendanceStats` | `MMCA.ADC.Engagement.Application/CheckIns/UseCases/GetAttendanceStats/GetAttendanceStatsQuery.cs:8` |
| `GetOrCreateMyBadgeCommand` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.CheckIns.UseCases.GetOrCreateMyBadge` | `MMCA.ADC.Engagement.Application/CheckIns/UseCases/GetOrCreateMyBadge/GetOrCreateMyBadgeCommand.cs:11` |
| `GetOrCreateMyBadgeHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.CheckIns.UseCases.GetOrCreateMyBadge` | `MMCA.ADC.Engagement.Application/CheckIns/UseCases/GetOrCreateMyBadge/GetOrCreateMyBadgeHandler.cs:17` |
| `ManualCheckInHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.CheckIns.UseCases.ManualCheckIn` | `MMCA.ADC.Engagement.Application/CheckIns/UseCases/ManualCheckIn/ManualCheckInHandler.cs:16` |
| `ManualCheckInRequestValidator` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.CheckIns.UseCases.ManualCheckIn` | `MMCA.ADC.Engagement.Application/CheckIns/UseCases/ManualCheckIn/ManualCheckInRequestValidator.cs:9` |
| `RecordRoomCheckInHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.CheckIns.UseCases.RecordRoomCheckIn` | `MMCA.ADC.Engagement.Application/CheckIns/UseCases/RecordRoomCheckIn/RecordRoomCheckInHandler.cs:24` |
| `RoomCheckInRequestValidator` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.CheckIns.UseCases.RecordRoomCheckIn` | `MMCA.ADC.Engagement.Application/CheckIns/UseCases/RecordRoomCheckIn/RoomCheckInRequestValidator.cs:9` |
| `RecordSponsorVisitHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.CheckIns.UseCases.RecordSponsorVisit` | `MMCA.ADC.Engagement.Application/CheckIns/UseCases/RecordSponsorVisit/RecordSponsorVisitHandler.cs:32` |
| `SponsorVisitRequestValidator` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.CheckIns.UseCases.RecordSponsorVisit` | `MMCA.ADC.Engagement.Application/CheckIns/UseCases/RecordSponsorVisit/SponsorVisitRequestValidator.cs:9` |
| `DuplicateKeyDetection` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Common` | `MMCA.ADC.Engagement.Application/Common/DuplicateKeyDetection.cs:7` |
| `UserEngagementExportService` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Exports` | `MMCA.ADC.Engagement.Application/Exports/UserEngagementExportService.cs:17` |
| `ILiveChannelPublishQueue` | interface | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Live` | `MMCA.ADC.Engagement.Application/Live/ILiveChannelPublishQueue.cs:21` |
| `LiveChannelPublishQueue` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Live` | `MMCA.ADC.Engagement.Application/Live/LiveChannelPublishQueue.cs:14` |
| `LiveChannelPublishWorkItem` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Live` | `MMCA.ADC.Engagement.Application/Live/ILiveChannelPublishQueue.cs:10` |
| `LivePollVoteChangedHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.DomainEventHandlers` | `MMCA.ADC.Engagement.Application/LivePolls/DomainEventHandlers/LivePollVoteChangedHandler.cs:38` |
| `LivePollDTOMapper` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.DTOs` | `MMCA.ADC.Engagement.Application/LivePolls/DTOs/LivePollDTOMapper.cs:13` |
| `LivePollAuthorization` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.Services` | `MMCA.ADC.Engagement.Application/LivePolls/Services/LivePollAuthorization.cs:12` |
| `LivePollNavigationPopulator` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.Services` | `MMCA.ADC.Engagement.Application/LivePolls/Services/LivePollNavigationPopulator.cs:11` |
| `LivePollOptionNavigationPopulator` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.Services` | `MMCA.ADC.Engagement.Application/LivePolls/Services/LivePollOptionNavigationPopulator.cs:11` |
| `LivePollResultsBuilder` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.Services` | `MMCA.ADC.Engagement.Application/LivePolls/Services/LivePollResultsBuilder.cs:12` |
| `CastVoteCommand` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.CastVote` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteCommand.cs:11` |
| `CastVoteCommandValidator` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.CastVote` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteCommandValidator.cs:8` |
| `CastVoteHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.CastVote` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteHandler.cs:19` |
| `CloseLivePollCommand` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Close` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Close/CloseLivePollCommand.cs:12` |
| `CloseLivePollHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Close` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Close/CloseLivePollHandler.cs:19` |
| `CreateLivePollCommand` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollCommand.cs:14` |
| `CreateLivePollCommandValidator` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollCommandValidator.cs:9` |
| `CreateLivePollHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollHandler.cs:20` |
| `CreateLivePollRequestValidator` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Create` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Create/CreateLivePollRequestValidator.cs:10` |
| `GetEventPollsHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetEventPolls` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetEventPolls/GetEventPollsHandler.cs:14` |
| `GetEventPollsQuery` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetEventPolls` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetEventPolls/GetEventPollsQuery.cs:7` |
| `GetOpenPollsHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetOpenPolls` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetOpenPolls/GetOpenPollsHandler.cs:15` |
| `GetOpenPollsQuery` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetOpenPolls` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetOpenPolls/GetOpenPollsQuery.cs:11` |
| `GetPollResultsHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetPollResults` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetPollResults/GetPollResultsHandler.cs:13` |
| `GetPollResultsQuery` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.GetPollResults` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetPollResults/GetPollResultsQuery.cs:9` |
| `OpenLivePollCommand` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Open` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Open/OpenLivePollCommand.cs:12` |
| `OpenLivePollHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Open` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Open/OpenLivePollHandler.cs:20` |
| `SessionQuestionSubmittedPointsHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Points.DomainEventHandlers` | `MMCA.ADC.Engagement.Application/Points/DomainEventHandlers/SessionQuestionSubmittedPointsHandler.cs:51` |
| `AttendeeCheckedInPointsHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Points.IntegrationEventHandlers` | `MMCA.ADC.Engagement.Application/Points/IntegrationEventHandlers/AttendeeCheckedInPointsHandler.cs:30` |
| `EventFeedbackSubmittedPointsHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Points.IntegrationEventHandlers` | `MMCA.ADC.Engagement.Application/Points/IntegrationEventHandlers/EventFeedbackSubmittedPointsHandler.cs:26` |
| `SessionFeedbackSubmittedPointsHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Points.IntegrationEventHandlers` | `MMCA.ADC.Engagement.Application/Points/IntegrationEventHandlers/SessionFeedbackSubmittedPointsHandler.cs:28` |
| `UserDeletedPointsHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Points.IntegrationEventHandlers` | `MMCA.ADC.Engagement.Application/Points/IntegrationEventHandlers/UserDeletedPointsHandler.cs:36` |
| `IPointsAwarder` | interface | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Points.Services` | `MMCA.ADC.Engagement.Application/Points/Services/IPointsAwarder.cs:19` |
| `PointsAwarder` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Points.Services` | `MMCA.ADC.Engagement.Application/Points/Services/PointsAwarder.cs:29` |
| `GetLeaderboardHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Points.UseCases.GetLeaderboard` | `MMCA.ADC.Engagement.Application/Points/UseCases/GetLeaderboard/GetLeaderboardHandler.cs:28` |
| `GetLeaderboardQuery` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Points.UseCases.GetLeaderboard` | `MMCA.ADC.Engagement.Application/Points/UseCases/GetLeaderboard/GetLeaderboardQuery.cs:12` |
| `OptInRow` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Points.UseCases.GetLeaderboard` | `MMCA.ADC.Engagement.Application/Points/UseCases/GetLeaderboard/GetLeaderboardHandler.cs:87` |
| `PointsRow` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Points.UseCases.GetLeaderboard` | `MMCA.ADC.Engagement.Application/Points/UseCases/GetLeaderboard/GetLeaderboardHandler.cs:92` |
| `GetMyPointsHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Points.UseCases.GetMyPoints` | `MMCA.ADC.Engagement.Application/Points/UseCases/GetMyPoints/GetMyPointsHandler.cs:25` |
| `GetMyPointsQuery` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Points.UseCases.GetMyPoints` | `MMCA.ADC.Engagement.Application/Points/UseCases/GetMyPoints/GetMyPointsQuery.cs:14` |
| `GetPointsOverviewHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Points.UseCases.GetPointsOverview` | `MMCA.ADC.Engagement.Application/Points/UseCases/GetPointsOverview/GetPointsOverviewHandler.cs:25` |
| `GetPointsOverviewQuery` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Points.UseCases.GetPointsOverview` | `MMCA.ADC.Engagement.Application/Points/UseCases/GetPointsOverview/GetPointsOverviewQuery.cs:8` |
| `OverviewRow` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Points.UseCases.GetPointsOverview` | `MMCA.ADC.Engagement.Application/Points/UseCases/GetPointsOverview/GetPointsOverviewHandler.cs:102` |
| `SetLeaderboardParticipationHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Points.UseCases.SetLeaderboardParticipation` | `MMCA.ADC.Engagement.Application/Points/UseCases/SetLeaderboardParticipation/SetLeaderboardParticipationHandler.cs:29` |
| `SessionQuestionUpvoteChangedHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.DomainEventHandlers` | `MMCA.ADC.Engagement.Application/SessionQuestions/DomainEventHandlers/SessionQuestionUpvoteChangedHandler.cs:39` |
| `SessionQuestionViewBuilder` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.Services` | `MMCA.ADC.Engagement.Application/SessionQuestions/Services/SessionQuestionViewBuilder.cs:12` |
| `GetModerationQueueHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetModerationQueue` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/GetModerationQueue/GetModerationQueueHandler.cs:19` |
| `GetModerationQueueQuery` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetModerationQueue` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/GetModerationQueue/GetModerationQueueQuery.cs:11` |
| `GetSessionQuestionsHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetSessionQuestions` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/GetSessionQuestions/GetSessionQuestionsHandler.cs:26` |
| `GetSessionQuestionsQuery` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetSessionQuestions` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/GetSessionQuestions/GetSessionQuestionsQuery.cs:11` |
| `ModerateQuestionCommand` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Moderate` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Moderate/ModerateQuestionCommand.cs:15` |
| `ModerateQuestionHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Moderate` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Moderate/ModerateQuestionHandler.cs:23` |
| `SubmitQuestionCommand` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Submit` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionCommand.cs:11` |
| `SubmitQuestionCommandValidator` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Submit` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionCommandValidator.cs:9` |
| `SubmitQuestionHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Submit` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionHandler.cs:25` |
| `ToggleUpvoteCommand` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/ToggleUpvote/ToggleUpvoteCommand.cs:11` |
| `ToggleUpvoteCommandValidator` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/ToggleUpvote/ToggleUpvoteCommandValidator.cs:8` |
| `ToggleUpvoteHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/ToggleUpvote/ToggleUpvoteHandler.cs:17` |
| `UserSessionBookmarkCacheEvictionHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.UserSessionBookmarks.DomainEventHandlers` | `MMCA.ADC.Engagement.Application/UserSessionBookmarks/DomainEventHandlers/UserSessionBookmarkCacheEvictionHandler.cs:43` |
| `UserSessionBookmarkDTOMapper` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.UserSessionBookmarks.DTOs` | `MMCA.ADC.Engagement.Application/UserSessionBookmarks/DTOs/UserSessionBookmarkDTOMapper.cs:12` |
| `BookmarkCountService` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.UserSessionBookmarks.Services` | `MMCA.ADC.Engagement.Application/UserSessionBookmarks/Services/BookmarkCountService.cs:11` |
| `CreateBookmarkHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.Create` | `MMCA.ADC.Engagement.Application/UserSessionBookmarks/UseCases/Create/CreateBookmarkHandler.cs:18` |
| `CreateBookmarkRequestValidator` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.Create` | `MMCA.ADC.Engagement.Application/UserSessionBookmarks/UseCases/Create/CreateBookmarkRequestValidator.cs:9` |
| `GetBookmarkedSessionIdsHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetBookmarkedSessionIds` | `MMCA.ADC.Engagement.Application/UserSessionBookmarks/UseCases/GetBookmarkedSessionIds/GetBookmarkedSessionIdsHandler.cs:12` |
| `GetBookmarkedSessionIdsQuery` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetBookmarkedSessionIds` | `MMCA.ADC.Engagement.Application/UserSessionBookmarks/UseCases/GetBookmarkedSessionIds/GetBookmarkedSessionIdsQuery.cs:5` |
| `GetUserBookmarksHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetUserBookmarks` | `MMCA.ADC.Engagement.Application/UserSessionBookmarks/UseCases/GetUserBookmarks/GetUserBookmarksHandler.cs:17` |
| `GetUserBookmarksQuery` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetUserBookmarks` | `MMCA.ADC.Engagement.Application/UserSessionBookmarks/UseCases/GetUserBookmarks/GetUserBookmarksQuery.cs:8` |
| `CheckInAttendeeHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.CheckIns.UseCases` | `MMCA.ADC.Engagement.Application.Tests/CheckIns/UseCases/CheckInAttendeeHandlerTests.cs:16` |
| `GetAttendanceStatsHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.CheckIns.UseCases` | `MMCA.ADC.Engagement.Application.Tests/CheckIns/UseCases/GetAttendanceStatsHandlerTests.cs:12` |
| `GetOrCreateMyBadgeHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.CheckIns.UseCases` | `MMCA.ADC.Engagement.Application.Tests/CheckIns/UseCases/GetOrCreateMyBadgeHandlerTests.cs:12` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.CheckIns.UseCases` | `MMCA.ADC.Engagement.Application.Tests/CheckIns/UseCases/CheckInAttendeeHandlerTests.cs:246` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.CheckIns.UseCases` | `MMCA.ADC.Engagement.Application.Tests/CheckIns/UseCases/GetOrCreateMyBadgeHandlerTests.cs:136` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.CheckIns.UseCases` | `MMCA.ADC.Engagement.Application.Tests/CheckIns/UseCases/ManualCheckInHandlerTests.cs:133` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.CheckIns.UseCases` | `MMCA.ADC.Engagement.Application.Tests/CheckIns/UseCases/RecordRoomCheckInHandlerTests.cs:204` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.CheckIns.UseCases` | `MMCA.ADC.Engagement.Application.Tests/CheckIns/UseCases/RecordSponsorVisitHandlerTests.cs:181` |
| `ManualCheckInHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.CheckIns.UseCases` | `MMCA.ADC.Engagement.Application.Tests/CheckIns/UseCases/ManualCheckInHandlerTests.cs:15` |
| `RecordRoomCheckInHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.CheckIns.UseCases` | `MMCA.ADC.Engagement.Application.Tests/CheckIns/UseCases/RecordRoomCheckInHandlerTests.cs:16` |
| `RecordSponsorVisitHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.CheckIns.UseCases` | `MMCA.ADC.Engagement.Application.Tests/CheckIns/UseCases/RecordSponsorVisitHandlerTests.cs:15` |
| `CheckInAttendeeRequestValidatorTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.CheckIns.Validation` | `MMCA.ADC.Engagement.Application.Tests/CheckIns/Validation/CheckInAttendeeRequestValidatorTests.cs:7` |
| `ManualCheckInRequestValidatorTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.CheckIns.Validation` | `MMCA.ADC.Engagement.Application.Tests/CheckIns/Validation/ManualCheckInRequestValidatorTests.cs:7` |
| `RoomCheckInRequestValidatorTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.CheckIns.Validation` | `MMCA.ADC.Engagement.Application.Tests/CheckIns/Validation/RoomCheckInRequestValidatorTests.cs:7` |
| `SponsorVisitRequestValidatorTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.CheckIns.Validation` | `MMCA.ADC.Engagement.Application.Tests/CheckIns/Validation/SponsorVisitRequestValidatorTests.cs:7` |
| `LiveChannelPublishQueueTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Live` | `MMCA.ADC.Engagement.Application.Tests/Live/LiveChannelPublishQueueTests.cs:10` |
| `LivePollVoteChangedHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.DomainEventHandlers` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/DomainEventHandlers/LivePollVoteChangedHandlerTests.cs:23` |
| `RecordingQueue` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.DomainEventHandlers` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/DomainEventHandlers/LivePollVoteChangedHandlerTests.cs:157` |
| `LivePollDTOMapperTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.DTOs` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/DTOs/LivePollDTOMapperTests.cs:9` |
| `LivePollOptionNavigationPopulatorTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.Services` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/Services/LivePollOptionNavigationPopulatorTests.cs:9` |
| `LivePollResultsBuilderTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.Services` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/Services/LivePollResultsBuilderTests.cs:17` |
| `CastVoteHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/CastVoteHandlerTests.cs:13` |
| `CloseLivePollHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/CloseLivePollHandlerTests.cs:15` |
| `CreateLivePollHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/CreateLivePollHandlerTests.cs:14` |
| `GetEventPollsHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/GetEventPollsHandlerTests.cs:12` |
| `GetOpenPollsHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/GetOpenPollsHandlerTests.cs:12` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/CastVoteHandlerTests.cs:168` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/CloseLivePollHandlerTests.cs:128` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/CreateLivePollHandlerTests.cs:199` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/OpenLivePollHandlerTests.cs:192` |
| `OpenLivePollHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/OpenLivePollHandlerTests.cs:15` |
| `CastVoteCommandValidatorTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.Validation` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/Validation/CastVoteCommandValidatorTests.cs:6` |
| `CreateLivePollCommandValidatorTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.Validation` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/Validation/CreateLivePollCommandValidatorTests.cs:9` |
| `SessionQuestionSubmittedPointsHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Points.DomainEventHandlers` | `MMCA.ADC.Engagement.Application.Tests/Points/DomainEventHandlers/SessionQuestionSubmittedPointsHandlerTests.cs:29` |
| `ThrowingPointsAwarder` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Points.DomainEventHandlers` | `MMCA.ADC.Engagement.Application.Tests/Points/DomainEventHandlers/SessionQuestionSubmittedPointsHandlerTests.cs:236` |
| `AttendeeCheckedInPointsHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Points.IntegrationEventHandlers` | `MMCA.ADC.Engagement.Application.Tests/Points/IntegrationEventHandlers/AttendeeCheckedInPointsHandlerTests.cs:15` |
| `EventFeedbackSubmittedPointsHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Points.IntegrationEventHandlers` | `MMCA.ADC.Engagement.Application.Tests/Points/IntegrationEventHandlers/EventFeedbackSubmittedPointsHandlerTests.cs:14` |
| `SessionFeedbackSubmittedPointsHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Points.IntegrationEventHandlers` | `MMCA.ADC.Engagement.Application.Tests/Points/IntegrationEventHandlers/SessionFeedbackSubmittedPointsHandlerTests.cs:14` |
| `UserDeletedPointsHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Points.IntegrationEventHandlers` | `MMCA.ADC.Engagement.Application.Tests/Points/IntegrationEventHandlers/UserDeletedPointsHandlerTests.cs:14` |
| `AwarderMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Points.Services` | `MMCA.ADC.Engagement.Application.Tests/Points/Services/PointsAwarderTests.cs:289` |
| `MutableOptions` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Points.Services` | `MMCA.ADC.Engagement.Application.Tests/Points/Services/PointsAwarderTests.cs:284` |
| `PointsAwarderTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Points.Services` | `MMCA.ADC.Engagement.Application.Tests/Points/Services/PointsAwarderTests.cs:13` |
| `AwardCall` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Points.Support` | `MMCA.ADC.Engagement.Application.Tests/Points/Support/RecordingPointsAwarder.cs:14` |
| `RecordingPointsAwarder` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Points.Support` | `MMCA.ADC.Engagement.Application.Tests/Points/Support/RecordingPointsAwarder.cs:30` |
| `GetLeaderboardHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Points.UseCases` | `MMCA.ADC.Engagement.Application.Tests/Points/UseCases/GetLeaderboardHandlerTests.cs:12` |
| `GetMyPointsHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Points.UseCases` | `MMCA.ADC.Engagement.Application.Tests/Points/UseCases/GetMyPointsHandlerTests.cs:14` |
| `GetPointsOverviewHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Points.UseCases` | `MMCA.ADC.Engagement.Application.Tests/Points/UseCases/GetPointsOverviewHandlerTests.cs:11` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Points.UseCases` | `MMCA.ADC.Engagement.Application.Tests/Points/UseCases/SetLeaderboardParticipationHandlerTests.cs:294` |
| `SetLeaderboardParticipationHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Points.UseCases` | `MMCA.ADC.Engagement.Application.Tests/Points/UseCases/SetLeaderboardParticipationHandlerTests.cs:14` |
| `GetModerationQueueHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.SessionQuestions.UseCases` | `MMCA.ADC.Engagement.Application.Tests/SessionQuestions/UseCases/GetModerationQueueHandlerTests.cs:16` |
| `GetSessionQuestionsHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.SessionQuestions.UseCases` | `MMCA.ADC.Engagement.Application.Tests/SessionQuestions/UseCases/GetSessionQuestionsHandlerTests.cs:12` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.SessionQuestions.UseCases` | `MMCA.ADC.Engagement.Application.Tests/SessionQuestions/UseCases/GetModerationQueueHandlerTests.cs:121` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.SessionQuestions.UseCases` | `MMCA.ADC.Engagement.Application.Tests/SessionQuestions/UseCases/ModerateQuestionHandlerTests.cs:249` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.SessionQuestions.UseCases` | `MMCA.ADC.Engagement.Application.Tests/SessionQuestions/UseCases/SubmitQuestionHandlerTests.cs:177` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.SessionQuestions.UseCases` | `MMCA.ADC.Engagement.Application.Tests/SessionQuestions/UseCases/ToggleUpvoteHandlerTests.cs:245` |
| `ModerateQuestionHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.SessionQuestions.UseCases` | `MMCA.ADC.Engagement.Application.Tests/SessionQuestions/UseCases/ModerateQuestionHandlerTests.cs:15` |
| `SubmitQuestionHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.SessionQuestions.UseCases` | `MMCA.ADC.Engagement.Application.Tests/SessionQuestions/UseCases/SubmitQuestionHandlerTests.cs:17` |
| `ToggleUpvoteHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.SessionQuestions.UseCases` | `MMCA.ADC.Engagement.Application.Tests/SessionQuestions/UseCases/ToggleUpvoteHandlerTests.cs:13` |
| `FixedTimeProvider` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Support` | `MMCA.ADC.Engagement.Application.Tests/Support/TestSupport.cs:14` |
| `InMemoryQueryableExecutor` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Support` | `MMCA.ADC.Engagement.Application.Tests/Support/TestSupport.cs:24` |
| `TestSupport` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Support` | `MMCA.ADC.Engagement.Application.Tests/Support/TestSupport.cs:44` |
| `UserSessionBookmarkCacheEvictionHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.DomainEventHandlers` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/DomainEventHandlers/UserSessionBookmarkCacheEvictionHandlerTests.cs:20` |
| `UserSessionBookmarkDTOMapperTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.DTOs` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/DTOs/UserSessionBookmarkDTOMapperTests.cs:7` |
| `BookmarkCountServiceTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.Services` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/Services/BookmarkCountServiceTests.cs:11` |
| `CreateBookmarkHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.UseCases` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/UseCases/CreateBookmarkHandlerTests.cs:16` |
| `GetBookmarkedSessionIdsHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.UseCases` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/UseCases/GetBookmarkedSessionIdsHandlerTests.cs:9` |
| `GetUserBookmarksHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.UseCases` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/UseCases/GetUserBookmarksHandlerTests.cs:15` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.UseCases` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/UseCases/CreateBookmarkHandlerTests.cs:115` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.UseCases` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/UseCases/GetUserBookmarksHandlerTests.cs:24` |
| `CreateBookmarkRequestValidatorTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.Validation` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/Validation/CreateBookmarkRequestValidatorTests.cs:7` |
| `BookmarkCountServiceGrpcAdapter` | class | MMCA.ADC.Engagement.Contracts | `MMCA.ADC.Engagement.Contracts` | `MMCA.ADC.Engagement.Contracts/BookmarkCountServiceGrpcAdapter.cs:14` |
| `DependencyInjection` | class | MMCA.ADC.Engagement.Contracts | `MMCA.ADC.Engagement.Contracts` | `MMCA.ADC.Engagement.Contracts/DependencyInjection.cs:16` |
| `UserEngagementExportServiceGrpcAdapter` | class | MMCA.ADC.Engagement.Contracts | `MMCA.ADC.Engagement.Contracts` | `MMCA.ADC.Engagement.Contracts/UserEngagementExportServiceGrpcAdapter.cs:18` |
| `AssemblyReference` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain` | `MMCA.ADC.Engagement.Domain/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain` | `MMCA.ADC.Engagement.Domain/AssemblyReference.cs:11` |
| `AttendeeBadge` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.Badges` | `MMCA.ADC.Engagement.Domain/Badges/AttendeeBadge.cs:18` |
| `AttendeeBadgeInvariants` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.Badges` | `MMCA.ADC.Engagement.Domain/Badges/AttendeeBadgeInvariants.cs:9` |
| `CheckIn` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.CheckIns` | `MMCA.ADC.Engagement.Domain/CheckIns/CheckIn.cs:28` |
| `CheckInInvariants` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.CheckIns` | `MMCA.ADC.Engagement.Domain/CheckIns/CheckInInvariants.cs:10` |
| `LivePoll` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.LivePolls` | `MMCA.ADC.Engagement.Domain/LivePolls/LivePoll.cs:18` |
| `LivePollInvariants` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.LivePolls` | `MMCA.ADC.Engagement.Domain/LivePolls/LivePollInvariants.cs:9` |
| `LivePollOption` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.LivePolls` | `MMCA.ADC.Engagement.Domain/LivePolls/LivePollOption.cs:13` |
| `LivePollVote` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.LivePolls` | `MMCA.ADC.Engagement.Domain/LivePolls/LivePollVote.cs:19` |
| `LivePollVoteInvariants` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.LivePolls` | `MMCA.ADC.Engagement.Domain/LivePolls/LivePollVoteInvariants.cs:9` |
| `LivePollChanged` | record | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.LivePolls.DomainEvents` | `MMCA.ADC.Engagement.Domain/LivePolls/DomainEvents/LivePollChanged.cs:17` |
| `LivePollVoteChanged` | record | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.LivePolls.DomainEvents` | `MMCA.ADC.Engagement.Domain/LivePolls/DomainEvents/LivePollVoteChanged.cs:21` |
| `LeaderboardOptIn` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.Points` | `MMCA.ADC.Engagement.Domain/Points/LeaderboardOptIn.cs:19` |
| `LeaderboardOptInInvariants` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.Points` | `MMCA.ADC.Engagement.Domain/Points/LeaderboardOptInInvariants.cs:9` |
| `PointsEntry` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.Points` | `MMCA.ADC.Engagement.Domain/Points/PointsEntry.cs:31` |
| `PointsEntryInvariants` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.Points` | `MMCA.ADC.Engagement.Domain/Points/PointsEntryInvariants.cs:10` |
| `LeaderboardOptInChanged` | record | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.Points.DomainEvents` | `MMCA.ADC.Engagement.Domain/Points/DomainEvents/LeaderboardOptInChanged.cs:15` |
| `PointsEntryChanged` | record | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.Points.DomainEvents` | `MMCA.ADC.Engagement.Domain/Points/DomainEvents/PointsEntryChanged.cs:17` |
| `BookmarkManagementDomainService` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.Services` | `MMCA.ADC.Engagement.Domain/Services/BookmarkManagementDomainService.cs:10` |
| `IBookmarkManagementDomainService` | interface | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.Services` | `MMCA.ADC.Engagement.Domain/Services/IBookmarkManagementDomainService.cs:12` |
| `SessionQuestion` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.SessionQuestions` | `MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestion.cs:19` |
| `SessionQuestionInvariants` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.SessionQuestions` | `MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestionInvariants.cs:9` |
| `SessionQuestionUpvote` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.SessionQuestions` | `MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestionUpvote.cs:19` |
| `SessionQuestionUpvoteInvariants` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.SessionQuestions` | `MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestionUpvoteInvariants.cs:9` |
| `SessionQuestionChanged` | record | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.SessionQuestions.DomainEvents` | `MMCA.ADC.Engagement.Domain/SessionQuestions/DomainEvents/SessionQuestionChanged.cs:30` |
| `SessionQuestionUpvoteChanged` | record | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.SessionQuestions.DomainEvents` | `MMCA.ADC.Engagement.Domain/SessionQuestions/DomainEvents/SessionQuestionUpvoteChanged.cs:20` |
| `UserSessionBookmark` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.UserSessionBookmarks` | `MMCA.ADC.Engagement.Domain/UserSessionBookmarks/UserSessionBookmark.cs:16` |
| `UserSessionBookmarkInvariants` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.UserSessionBookmarks` | `MMCA.ADC.Engagement.Domain/UserSessionBookmarks/UserSessionBookmarkInvariants.cs:9` |
| `UserSessionBookmarkChanged` | record | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.UserSessionBookmarks.DomainEvents` | `MMCA.ADC.Engagement.Domain/UserSessionBookmarks/DomainEvents/UserSessionBookmarkChanged.cs:21` |
| `AttendeeBadgeTests` | class | MMCA.ADC.Engagement.Domain.Tests | `MMCA.ADC.Engagement.Domain.Tests.Badges` | `MMCA.ADC.Engagement.Domain.Tests/Badges/AttendeeBadgeTests.cs:6` |
| `CheckInTests` | class | MMCA.ADC.Engagement.Domain.Tests | `MMCA.ADC.Engagement.Domain.Tests.CheckIns` | `MMCA.ADC.Engagement.Domain.Tests/CheckIns/CheckInTests.cs:8` |
| `LivePollTests` | class | MMCA.ADC.Engagement.Domain.Tests | `MMCA.ADC.Engagement.Domain.Tests.LivePolls` | `MMCA.ADC.Engagement.Domain.Tests/LivePolls/LivePollTests.cs:10` |
| `LivePollVoteTests` | class | MMCA.ADC.Engagement.Domain.Tests | `MMCA.ADC.Engagement.Domain.Tests.LivePolls` | `MMCA.ADC.Engagement.Domain.Tests/LivePolls/LivePollVoteTests.cs:8` |
| `LeaderboardOptInTests` | class | MMCA.ADC.Engagement.Domain.Tests | `MMCA.ADC.Engagement.Domain.Tests.Points` | `MMCA.ADC.Engagement.Domain.Tests/Points/LeaderboardOptInTests.cs:8` |
| `PointsEntryInvariantsTests` | class | MMCA.ADC.Engagement.Domain.Tests | `MMCA.ADC.Engagement.Domain.Tests.Points` | `MMCA.ADC.Engagement.Domain.Tests/Points/PointsEntryInvariantsTests.cs:7` |
| `PointsEntryTests` | class | MMCA.ADC.Engagement.Domain.Tests | `MMCA.ADC.Engagement.Domain.Tests.Points` | `MMCA.ADC.Engagement.Domain.Tests/Points/PointsEntryTests.cs:10` |
| `BookmarkManagementDomainServiceTests` | class | MMCA.ADC.Engagement.Domain.Tests | `MMCA.ADC.Engagement.Domain.Tests.Services` | `MMCA.ADC.Engagement.Domain.Tests/Services/BookmarkManagementDomainServiceTests.cs:7` |
| `SessionQuestionTests` | class | MMCA.ADC.Engagement.Domain.Tests | `MMCA.ADC.Engagement.Domain.Tests.SessionQuestions` | `MMCA.ADC.Engagement.Domain.Tests/SessionQuestions/SessionQuestionTests.cs:9` |
| `SessionQuestionUpvoteTests` | class | MMCA.ADC.Engagement.Domain.Tests | `MMCA.ADC.Engagement.Domain.Tests.SessionQuestions` | `MMCA.ADC.Engagement.Domain.Tests/SessionQuestions/SessionQuestionUpvoteTests.cs:8` |
| `UserSessionBookmarkTests` | class | MMCA.ADC.Engagement.Domain.Tests | `MMCA.ADC.Engagement.Domain.Tests.UserSessionBookmarks` | `MMCA.ADC.Engagement.Domain.Tests/UserSessionBookmarks/UserSessionBookmarkTests.cs:8` |
| `AssemblyReference` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure` | `MMCA.ADC.Engagement.Infrastructure/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure` | `MMCA.ADC.Engagement.Infrastructure/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure` | `MMCA.ADC.Engagement.Infrastructure/DependencyInjection.cs:9` |
| `LiveChannelPublishProcessor` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Live` | `MMCA.ADC.Engagement.Infrastructure/Live/LiveChannelPublishProcessor.cs:30` |
| `ModuleApplicationDbContext` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Persistence.DbContexts` | `MMCA.ADC.Engagement.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:19` |
| `AttendeeBadgeConfiguration` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/AttendeeBadgeConfiguration.cs:15` |
| `CheckInConfiguration` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/CheckInConfiguration.cs:19` |
| `LeaderboardOptInConfiguration` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/LeaderboardOptInConfiguration.cs:17` |
| `LivePollConfiguration` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/LivePollConfiguration.cs:15` |
| `LivePollOptionConfiguration` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/LivePollOptionConfiguration.cs:10` |
| `LivePollVoteConfiguration` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/LivePollVoteConfiguration.cs:17` |
| `PointsEntryConfiguration` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/PointsEntryConfiguration.cs:21` |
| `SessionQuestionConfiguration` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/SessionQuestionConfiguration.cs:16` |
| `SessionQuestionUpvoteConfiguration` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/SessionQuestionUpvoteConfiguration.cs:17` |
| `UserSessionBookmarkConfiguration` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/UserSessionBookmarkConfiguration.cs:17` |
| `LiveChannelPublishProcessorTests` | class | MMCA.ADC.Engagement.Infrastructure.Tests | `MMCA.ADC.Engagement.Infrastructure.Tests.Live` | `MMCA.ADC.Engagement.Infrastructure.Tests/Live/LiveChannelPublishProcessorTests.cs:10` |
| `RecordingPublisher` | class | MMCA.ADC.Engagement.Infrastructure.Tests | `MMCA.ADC.Engagement.Infrastructure.Tests.Live` | `MMCA.ADC.Engagement.Infrastructure.Tests/Live/LiveChannelPublishProcessorTests.cs:73` |
| `EngagementEntityConfigurationTests` | class | MMCA.ADC.Engagement.Infrastructure.Tests | `MMCA.ADC.Engagement.Infrastructure.Tests.Persistence` | `MMCA.ADC.Engagement.Infrastructure.Tests/Persistence/EngagementEntityConfigurationTests.cs:11` |
| `EngagementTestDbContext` | class | MMCA.ADC.Engagement.Infrastructure.Tests | `MMCA.ADC.Engagement.Infrastructure.Tests.Persistence` | `MMCA.ADC.Engagement.Infrastructure.Tests/Persistence/EngagementEntityConfigurationTests.cs:268` |
| `AnonymousBookmarkAccessDeniedTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Bookmarks` | `MMCA.ADC.Engagement.IntegrationTests/Bookmarks/AnonymousBookmarkAccessDeniedTests.cs:8` |
| `AttendeeBookmarkTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Bookmarks` | `MMCA.ADC.Engagement.IntegrationTests/Bookmarks/AttendeeBookmarkTests.cs:15` |
| `CheckInAuthorizationTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.CheckIns` | `MMCA.ADC.Engagement.IntegrationTests/CheckIns/CheckInAuthorizationTests.cs:14` |
| `CheckInRow` | record | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.CheckIns` | `MMCA.ADC.Engagement.IntegrationTests/CheckIns/RoomCheckInRoundTripTests.cs:246` |
| `CheckInScanRoundTripTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.CheckIns` | `MMCA.ADC.Engagement.IntegrationTests/CheckIns/CheckInScanRoundTripTests.cs:23` |
| `LedgerRow` | record | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.CheckIns` | `MMCA.ADC.Engagement.IntegrationTests/CheckIns/SponsorVisitRoundTripTests.cs:262` |
| `RoomCheckInRoundTripTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.CheckIns` | `MMCA.ADC.Engagement.IntegrationTests/CheckIns/RoomCheckInRoundTripTests.cs:26` |
| `SponsorVisitRoundTripTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.CheckIns` | `MMCA.ADC.Engagement.IntegrationTests/CheckIns/SponsorVisitRoundTripTests.cs:27` |
| `OpenApiContractTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Contract` | `MMCA.ADC.Engagement.IntegrationTests/Contract/OpenApiContractTests.cs:14` |
| `ProblemDetailsContractTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Contract` | `MMCA.ADC.Engagement.IntegrationTests/Contract/ProblemDetailsContractTests.cs:16` |
| `EngagementIntegrationTestBase` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Infrastructure` | `MMCA.ADC.Engagement.IntegrationTests/Infrastructure/EngagementIntegrationTestBase.cs:12` |
| `EngagementIntegrationTestCollection` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Infrastructure` | `MMCA.ADC.Engagement.IntegrationTests/Infrastructure/EngagementIntegrationTestCollection.cs:8` |
| `EngagementIntegrationTestFixture` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Infrastructure` | `MMCA.ADC.Engagement.IntegrationTests/Infrastructure/EngagementIntegrationTestFixture.cs:17` |
| `EngagementTestWebApplicationFactory` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Infrastructure` | `MMCA.ADC.Engagement.IntegrationTests/Infrastructure/EngagementTestWebApplicationFactory.cs:40` |
| `FakeEventLiveValidationService` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Infrastructure` | `MMCA.ADC.Engagement.IntegrationTests/Infrastructure/FakeEventLiveValidationService.cs:22` |
| `FakeSessionBookmarkValidationService` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Infrastructure` | `MMCA.ADC.Engagement.IntegrationTests/Infrastructure/FakeSessionBookmarkValidationService.cs:12` |
| `LivePollAuthorizationTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.LivePolls` | `MMCA.ADC.Engagement.IntegrationTests/LivePolls/LivePollAuthorizationTests.cs:13` |
| `OrganizerLivePollLifecycleTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.LivePolls` | `MMCA.ADC.Engagement.IntegrationTests/LivePolls/OrganizerLivePollLifecycleTests.cs:18` |
| `LedgerRow` | record | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Points` | `MMCA.ADC.Engagement.IntegrationTests/Points/PointsAwardRoundTripTests.cs:332` |
| `PointsAwardRoundTripTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Points` | `MMCA.ADC.Engagement.IntegrationTests/Points/PointsAwardRoundTripTests.cs:41` |
| `PointsEndpointTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Points` | `MMCA.ADC.Engagement.IntegrationTests/Points/PointsEndpointTests.cs:33` |
| `SessionQuestionLifecycleTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.SessionQuestions` | `MMCA.ADC.Engagement.IntegrationTests/SessionQuestions/SessionQuestionLifecycleTests.cs:18` |
| `SelfHttpWarmupTask` | class | MMCA.ADC.Engagement.Service | `MMCA.ADC.Engagement.Service` | `MMCA.ADC.Engagement.Service/SelfHttpWarmupTask.cs:23` |
| `BookmarkCountsGrpcService` | class | MMCA.ADC.Engagement.Service | `MMCA.ADC.Engagement.Service.Grpc` | `MMCA.ADC.Engagement.Service/Grpc/BookmarkCountsGrpcService.cs:24` |
| `UserEngagementExportGrpcService` | class | MMCA.ADC.Engagement.Service | `MMCA.ADC.Engagement.Service.Grpc` | `MMCA.ADC.Engagement.Service/Grpc/UserEngagementExportGrpcService.cs:23` |
| `EngagementFeatures` | class | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared` | `MMCA.ADC.Engagement.Shared/EngagementFeatures.cs:8` |
| `LifecycleTransitionRequest` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared` | `MMCA.ADC.Engagement.Shared/LifecycleTransitionRequest.cs:15` |
| `EngagementPermissions` | class | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Authorization` | `MMCA.ADC.Engagement.Shared/Authorization/EngagementPermissions.cs:9` |
| `AttendanceStatsDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.CheckIns` | `MMCA.ADC.Engagement.Shared/CheckIns/AttendanceStatsDTO.cs:7` |
| `BadgePayload` | class | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.CheckIns` | `MMCA.ADC.Engagement.Shared/CheckIns/BadgePayload.cs:12` |
| `CheckInAttendeeRequest` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.CheckIns` | `MMCA.ADC.Engagement.Shared/CheckIns/CheckInAttendeeRequest.cs:6` |
| `CheckInDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.CheckIns` | `MMCA.ADC.Engagement.Shared/CheckIns/CheckInDTO.cs:8` |
| `CheckInResultDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.CheckIns` | `MMCA.ADC.Engagement.Shared/CheckIns/CheckInResultDTO.cs:8` |
| `CheckInScope` | enum | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.CheckIns` | `MMCA.ADC.Engagement.Shared/CheckIns/CheckInScope.cs:11` |
| `CheckInScopeNames` | class | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.CheckIns` | `MMCA.ADC.Engagement.Shared/CheckIns/CheckInScopeNames.cs:8` |
| `CheckInSettings` | class | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.CheckIns` | `MMCA.ADC.Engagement.Shared/CheckIns/CheckInSettings.cs:11` |
| `ManualCheckInRequest` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.CheckIns` | `MMCA.ADC.Engagement.Shared/CheckIns/ManualCheckInRequest.cs:7` |
| `MyBadgeDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.CheckIns` | `MMCA.ADC.Engagement.Shared/CheckIns/MyBadgeDTO.cs:7` |
| `RoomCheckInRequest` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.CheckIns` | `MMCA.ADC.Engagement.Shared/CheckIns/RoomCheckInRequest.cs:8` |
| `RoomCheckInResultDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.CheckIns` | `MMCA.ADC.Engagement.Shared/CheckIns/RoomCheckInResultDTO.cs:9` |
| `SessionAttendanceDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.CheckIns` | `MMCA.ADC.Engagement.Shared/CheckIns/SessionAttendanceDTO.cs:6` |
| `SponsorVisitRequest` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.CheckIns` | `MMCA.ADC.Engagement.Shared/CheckIns/SponsorVisitRequest.cs:7` |
| `SponsorVisitResultDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.CheckIns` | `MMCA.ADC.Engagement.Shared/CheckIns/SponsorVisitResultDTO.cs:12` |
| `AttendeeCheckedIn` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.CheckIns.IntegrationEvents` | `MMCA.ADC.Engagement.Shared/CheckIns/IntegrationEvents/AttendeeCheckedIn.cs:22` |
| `DisabledUserEngagementExportService` | class | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Exports` | `MMCA.ADC.Engagement.Shared/Exports/DisabledUserEngagementExportService.cs:7` |
| `IUserEngagementExportService` | interface | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Exports` | `MMCA.ADC.Engagement.Shared/Exports/IUserEngagementExportService.cs:11` |
| `UserEngagementBookmarkExportDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Exports` | `MMCA.ADC.Engagement.Shared/Exports/UserEngagementBookmarkExportDTO.cs:7` |
| `UserEngagementCheckInExportDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Exports` | `MMCA.ADC.Engagement.Shared/Exports/UserEngagementCheckInExportDTO.cs:11` |
| `UserEngagementExportDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Exports` | `MMCA.ADC.Engagement.Shared/Exports/UserEngagementExportDTO.cs:9` |
| `UserEngagementPointsEntryExportDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Exports` | `MMCA.ADC.Engagement.Shared/Exports/UserEngagementPointsEntryExportDTO.cs:9` |
| `UserEngagementSubmittedQuestionExportDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Exports` | `MMCA.ADC.Engagement.Shared/Exports/UserEngagementSubmittedQuestionExportDTO.cs:7` |
| `CastVoteRequest` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.LivePolls` | `MMCA.ADC.Engagement.Shared/LivePolls/CastVoteRequest.cs:8` |
| `CreateLivePollRequest` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.LivePolls` | `MMCA.ADC.Engagement.Shared/LivePolls/CreateLivePollRequest.cs:6` |
| `LivePollChannel` | class | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.LivePolls` | `MMCA.ADC.Engagement.Shared/LivePolls/LivePollChannel.cs:11` |
| `LivePollClosedPayload` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.LivePolls` | `MMCA.ADC.Engagement.Shared/LivePolls/LivePollClosedPayload.cs:8` |
| `LivePollDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.LivePolls` | `MMCA.ADC.Engagement.Shared/LivePolls/LivePollDTO.cs:8` |
| `LivePollOpenedPayload` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.LivePolls` | `MMCA.ADC.Engagement.Shared/LivePolls/LivePollOpenedPayload.cs:10` |
| `LivePollOptionDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.LivePolls` | `MMCA.ADC.Engagement.Shared/LivePolls/LivePollOptionDTO.cs:6` |
| `LivePollOptionResultDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.LivePolls` | `MMCA.ADC.Engagement.Shared/LivePolls/LivePollOptionResultDTO.cs:6` |
| `LivePollResultsDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.LivePolls` | `MMCA.ADC.Engagement.Shared/LivePolls/LivePollResultsDTO.cs:8` |
| `LivePollStatus` | enum | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.LivePolls` | `MMCA.ADC.Engagement.Shared/LivePolls/LivePollStatus.cs:7` |
| `LeaderboardEntryDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Points` | `MMCA.ADC.Engagement.Shared/Points/LeaderboardEntryDTO.cs:7` |
| `MyPointsDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Points` | `MMCA.ADC.Engagement.Shared/Points/MyPointsDTO.cs:7` |
| `PointsActivityTotalDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Points` | `MMCA.ADC.Engagement.Shared/Points/PointsActivityTotalDTO.cs:7` |
| `PointsActivityType` | enum | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Points` | `MMCA.ADC.Engagement.Shared/Points/PointsActivityType.cs:18` |
| `PointsEntryDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Points` | `MMCA.ADC.Engagement.Shared/Points/PointsEntryDTO.cs:7` |
| `PointsOverviewDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Points` | `MMCA.ADC.Engagement.Shared/Points/PointsOverviewDTO.cs:12` |
| `PointsSettings` | class | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Points` | `MMCA.ADC.Engagement.Shared/Points/PointsSettings.cs:12` |
| `PointsSubjectKeys` | class | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Points` | `MMCA.ADC.Engagement.Shared/Points/PointsSubjectKeys.cs:10` |
| `SetLeaderboardParticipationRequest` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Points` | `MMCA.ADC.Engagement.Shared/Points/SetLeaderboardParticipationRequest.cs:8` |
| `ISessionLiveUIService` | interface | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.SessionQuestions` | `MMCA.ADC.Engagement.Shared/SessionQuestions/ISessionLiveUIService.cs:10` |
| `ModerationAction` | enum | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.SessionQuestions` | `MMCA.ADC.Engagement.Shared/SessionQuestions/ModerationAction.cs:7` |
| `QuestionStatus` | enum | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.SessionQuestions` | `MMCA.ADC.Engagement.Shared/SessionQuestions/QuestionStatus.cs:8` |
| `SessionQuestionAnsweredPayload` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.SessionQuestions` | `MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionAnsweredPayload.cs:8` |
| `SessionQuestionApprovedPayload` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.SessionQuestions` | `MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionApprovedPayload.cs:10` |
| `SessionQuestionChannel` | class | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.SessionQuestions` | `MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionChannel.cs:12` |
| `SessionQuestionDismissedPayload` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.SessionQuestions` | `MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionDismissedPayload.cs:8` |
| `SessionQuestionDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.SessionQuestions` | `MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionDTO.cs:10` |
| `SessionQuestionPendingCountChangedPayload` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.SessionQuestions` | `MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionPendingCountChangedPayload.cs:10` |
| `SessionQuestionUpvoteChangedPayload` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.SessionQuestions` | `MMCA.ADC.Engagement.Shared/SessionQuestions/SessionQuestionUpvoteChangedPayload.cs:10` |
| `SubmitQuestionRequest` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.SessionQuestions` | `MMCA.ADC.Engagement.Shared/SessionQuestions/SubmitQuestionRequest.cs:8` |
| `CreateBookmarkRequest` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.UserSessionBookmarks` | `MMCA.ADC.Engagement.Shared/UserSessionBookmarks/CreateBookmarkRequest.cs:6` |
| `DisabledBookmarkCountService` | class | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.UserSessionBookmarks` | `MMCA.ADC.Engagement.Shared/UserSessionBookmarks/DisabledBookmarkCountService.cs:7` |
| `IBookmarkCountService` | interface | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.UserSessionBookmarks` | `MMCA.ADC.Engagement.Shared/UserSessionBookmarks/IBookmarkCountService.cs:8` |
| `ISessionBookmarkUIService` | interface | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.UserSessionBookmarks` | `MMCA.ADC.Engagement.Shared/UserSessionBookmarks/ISessionBookmarkUIService.cs:8` |
| `UserSessionBookmarkDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.UserSessionBookmarks` | `MMCA.ADC.Engagement.Shared/UserSessionBookmarks/UserSessionBookmarkDTO.cs:8` |
| `BadgePayloadTests` | class | MMCA.ADC.Engagement.Shared.Tests | `MMCA.ADC.Engagement.Shared.Tests.CheckIns` | `MMCA.ADC.Engagement.Shared.Tests/CheckIns/BadgePayloadTests.cs:6` |
| `CheckInScopeNamesTests` | class | MMCA.ADC.Engagement.Shared.Tests | `MMCA.ADC.Engagement.Shared.Tests.CheckIns` | `MMCA.ADC.Engagement.Shared.Tests/CheckIns/CheckInScopeNamesTests.cs:6` |
| `CheckInSettingsTests` | class | MMCA.ADC.Engagement.Shared.Tests | `MMCA.ADC.Engagement.Shared.Tests.CheckIns` | `MMCA.ADC.Engagement.Shared.Tests/CheckIns/CheckInSettingsTests.cs:6` |
| `PointsSettingsTests` | class | MMCA.ADC.Engagement.Shared.Tests | `MMCA.ADC.Engagement.Shared.Tests.Points` | `MMCA.ADC.Engagement.Shared.Tests/Points/PointsSettingsTests.cs:6` |
| `PointsSubjectKeysTests` | class | MMCA.ADC.Engagement.Shared.Tests | `MMCA.ADC.Engagement.Shared.Tests.Points` | `MMCA.ADC.Engagement.Shared.Tests/Points/PointsSubjectKeysTests.cs:7` |
| `DisabledBookmarkCountServiceTests` | class | MMCA.ADC.Engagement.Shared.Tests | `MMCA.ADC.Engagement.Shared.Tests.UserSessionBookmarks` | `MMCA.ADC.Engagement.Shared.Tests/UserSessionBookmarks/DisabledBookmarkCountServiceTests.cs:6` |
| `UserSessionBookmarkDTOTests` | class | MMCA.ADC.Engagement.Shared.Tests | `MMCA.ADC.Engagement.Shared.Tests.UserSessionBookmarks` | `MMCA.ADC.Engagement.Shared.Tests/UserSessionBookmarks/UserSessionBookmarkDTOTests.cs:6` |
| `DependencyInjection` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI` | `MMCA.ADC.Engagement.UI/DependencyInjection.cs:15` |
| `EngagementRoutePaths` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI` | `MMCA.ADC.Engagement.UI/EngagementRoutePaths.cs:8` |
| `EngagementUIModule` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI` | `MMCA.ADC.Engagement.UI/EngagementUIModule.cs:17` |
| `LiveEventListener` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Components` | `MMCA.ADC.Engagement.UI/Components/LiveEventListener.razor.cs:26` |
| `AttendeeSearchPanel` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.CheckIn` | `MMCA.ADC.Engagement.UI/Pages/CheckIn/AttendeeSearchPanel.razor.cs:16` |
| `CheckInScan` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.CheckIn` | `MMCA.ADC.Engagement.UI/Pages/CheckIn/CheckInScan.razor.cs:16` |
| `MyBadge` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.CheckIn` | `MMCA.ADC.Engagement.UI/Pages/CheckIn/MyBadge.razor.cs:14` |
| `OrganizerAttendance` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.CheckIn` | `MMCA.ADC.Engagement.UI/Pages/CheckIn/OrganizerAttendance.razor.cs:14` |
| `ScanOutcome` | record | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.CheckIn` | `MMCA.ADC.Engagement.UI/Pages/CheckIn/CheckInScan.razor.cs:290` |
| `ScanOutcomeKind` | enum | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.CheckIn` | `MMCA.ADC.Engagement.UI/Pages/CheckIn/CheckInScan.razor.cs:293` |
| `SessionAttendanceRow` | record | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.CheckIn` | `MMCA.ADC.Engagement.UI/Pages/CheckIn/OrganizerAttendance.razor.cs:120` |
| `AnswerState` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.Feedback` | `MMCA.ADC.Engagement.UI/Pages/Feedback/EventFeedback.razor.cs:271` |
| `AnswerState` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.Feedback` | `MMCA.ADC.Engagement.UI/Pages/Feedback/SessionFeedback.razor.cs:304` |
| `EventFeedback` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.Feedback` | `MMCA.ADC.Engagement.UI/Pages/Feedback/EventFeedback.razor.cs:16` |
| `SessionFeedback` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.Feedback` | `MMCA.ADC.Engagement.UI/Pages/Feedback/SessionFeedback.razor.cs:16` |
| `HappeningNow` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.HappeningNow` | `MMCA.ADC.Engagement.UI/Pages/HappeningNow/HappeningNow.razor.cs:23` |
| `OptionState` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.HappeningNow` | `MMCA.ADC.Engagement.UI/Pages/HappeningNow/HappeningNow.razor.cs:390` |
| `MyPoints` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.Points` | `MMCA.ADC.Engagement.UI/Pages/Points/MyPoints.razor.cs:14` |
| `OrganizerPointsOverview` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.Points` | `MMCA.ADC.Engagement.UI/Pages/Points/OrganizerPointsOverview.razor.cs:18` |
| `CheckInState` | enum | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.Rooms` | `MMCA.ADC.Engagement.UI/Pages/Rooms/RoomCheckIn.razor.cs:96` |
| `RoomCheckIn` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.Rooms` | `MMCA.ADC.Engagement.UI/Pages/Rooms/RoomCheckIn.razor.cs:19` |
| `OptionState` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.SessionLive` | `MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLiveModerationPanel.razor.cs:246` |
| `PresenterView` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.SessionLive` | `MMCA.ADC.Engagement.UI/Pages/SessionLive/PresenterView.razor.cs:18` |
| `SessionLive` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.SessionLive` | `MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLive.razor.cs:24` |
| `SessionLiveModerationPanel` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.SessionLive` | `MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLiveModerationPanel.razor.cs:19` |
| `SessionLivePollPanel` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.SessionLive` | `MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLivePollPanel.razor.cs:17` |
| `SessionLiveQuestionPanel` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.SessionLive` | `MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLiveQuestionPanel.razor.cs:18` |
| `SponsorVisit` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.Sponsors` | `MMCA.ADC.Engagement.UI/Pages/Sponsors/SponsorVisit.razor.cs:20` |
| `VisitState` | enum | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.Sponsors` | `MMCA.ADC.Engagement.UI/Pages/Sponsors/SponsorVisit.razor.cs:96` |
| `AttendeeLookupService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/AttendeeLookupService.cs:16` |
| `AttendeeRow` | record | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/AttendeeLookupService.cs:170` |
| `AttendeeSearchField` | enum | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/IAttendeeLookupService.cs:39` |
| `AttendeeSummary` | record | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/IAttendeeLookupService.cs:13` |
| `BookmarkService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/BookmarkService.cs:15` |
| `CheckInErrorCodes` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/CheckInErrorCodes.cs:8` |
| `CheckInService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/CheckInService.cs:15` |
| `CurrentEventNotificationScopeProvider` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/CurrentEventNotificationScopeProvider.cs:23` |
| `EventFeedbackService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/EventFeedbackService.cs:13` |
| `IAttendeeLookupService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/IAttendeeLookupService.cs:55` |
| `IBookmarkUIService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/IBookmarkUIService.cs:9` |
| `ICheckInUIService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/ICheckInUIService.cs:9` |
| `IEventFeedbackUIService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/IFeedbackUIService.cs:21` |
| `ILiveEventUIService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/ILiveEventUIService.cs:7` |
| `ILivePollUIService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/ILivePollUIService.cs:10` |
| `INowNextService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/INowNextService.cs:38` |
| `IPointsUIService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/IPointsUIService.cs:9` |
| `IQuestionLookupService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/IFeedbackUIService.cs:10` |
| `ISessionFeedbackUIService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/IFeedbackUIService.cs:43` |
| `ISessionLookupService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/ISessionLookupService.cs:17` |
| `ISessionQuestionUIService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/ISessionQuestionUIService.cs:10` |
| `LiveEventContext` | record | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/LiveEventContext.cs:13` |
| `LiveEventService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/LiveEventService.cs:14` |
| `LivePollUIService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/LivePollUIService.cs:15` |
| `NowNextService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/NowNextService.cs:13` |
| `NowNextSessionInfo` | record | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/INowNextService.cs:25` |
| `NowNextSnapshot` | record | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/INowNextService.cs:13` |
| `PointsService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/PointsService.cs:14` |
| `QuestionLookupService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/QuestionLookupService.cs:12` |
| `SelfCheckInOutcome<TResult>` | record | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/SelfCheckInOutcome.cs:20` |
| `SessionBookmarkUIService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/SessionBookmarkUIService.cs:17` |
| `SessionFeedbackService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/SessionFeedbackService.cs:13` |
| `SessionInfo` | record | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/ISessionLookupService.cs:7` |
| `SessionLiveUIService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/SessionLiveUIService.cs:10` |
| `SessionLookupService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/SessionLookupService.cs:11` |
| `SessionQuestionUIService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/SessionQuestionUIService.cs:15` |
| `SessionReminder` | record | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/SessionReminderPlanner.cs:13` |
| `SessionReminderCoordinator` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/SessionReminderCoordinator.cs:16` |
| `SessionReminderPlanner` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/SessionReminderPlanner.cs:29` |
| `LiveEventListenerResilienceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Components` | `MMCA.ADC.Engagement.UI.Tests/Components/LiveEventListenerResilienceTests.cs:31` |
| `LiveChannelJoinTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages` | `MMCA.ADC.Engagement.UI.Tests/Pages/LiveChannelJoinTests.cs:37` |
| `CheckInScanTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.CheckIn` | `MMCA.ADC.Engagement.UI.Tests/Pages/CheckIn/CheckInScanTests.cs:23` |
| `MyBadgeTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.CheckIn` | `MMCA.ADC.Engagement.UI.Tests/Pages/CheckIn/MyBadgeTests.cs:18` |
| `OrganizerAttendanceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.CheckIn` | `MMCA.ADC.Engagement.UI.Tests/Pages/CheckIn/OrganizerAttendanceTests.cs:17` |
| `EventFeedbackTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.Feedback` | `MMCA.ADC.Engagement.UI.Tests/Pages/Feedback/EventFeedbackTests.cs:19` |
| `SessionFeedbackPartialSubmitTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.Feedback` | `MMCA.ADC.Engagement.UI.Tests/Pages/Feedback/SessionFeedbackPartialSubmitTests.cs:22` |
| `SessionFeedbackTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.Feedback` | `MMCA.ADC.Engagement.UI.Tests/Pages/Feedback/SessionFeedbackTests.cs:21` |
| `HappeningNowTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.HappeningNow` | `MMCA.ADC.Engagement.UI.Tests/Pages/HappeningNow/HappeningNowTests.cs:29` |
| `LivePollCardTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.HappeningNow` | `MMCA.ADC.Engagement.UI.Tests/Pages/HappeningNow/LivePollCardTests.cs:14` |
| `MyPointsTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.Points` | `MMCA.ADC.Engagement.UI.Tests/Pages/Points/MyPointsTests.cs:18` |
| `OrganizerPointsOverviewTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.Points` | `MMCA.ADC.Engagement.UI.Tests/Pages/Points/OrganizerPointsOverviewTests.cs:18` |
| `RoomCheckInTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.Rooms` | `MMCA.ADC.Engagement.UI.Tests/Pages/Rooms/RoomCheckInTests.cs:18` |
| `PresenterViewTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.SessionLive` | `MMCA.ADC.Engagement.UI.Tests/Pages/SessionLive/PresenterViewTests.cs:29` |
| `SessionLiveModerationPanelTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.SessionLive` | `MMCA.ADC.Engagement.UI.Tests/Pages/SessionLive/SessionLiveModerationPanelTests.cs:19` |
| `SessionLivePollPanelTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.SessionLive` | `MMCA.ADC.Engagement.UI.Tests/Pages/SessionLive/SessionLivePollPanelTests.cs:20` |
| `SessionLiveQuestionPanelTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.SessionLive` | `MMCA.ADC.Engagement.UI.Tests/Pages/SessionLive/SessionLiveQuestionPanelTests.cs:19` |
| `SponsorVisitTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.Sponsors` | `MMCA.ADC.Engagement.UI.Tests/Pages/Sponsors/SponsorVisitTests.cs:19` |
| `AdvanceableTimeProvider` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/AttendeeLookupServiceTests.cs:101` |
| `AttendeeLookupServiceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/AttendeeLookupServiceTests.cs:14` |
| `BookmarkServiceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/BookmarkServiceTests.cs:17` |
| `CurrentEventNotificationScopeProviderTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/CurrentEventNotificationScopeProviderTests.cs:13` |
| `EventFeedbackServiceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/EventFeedbackServiceTests.cs:15` |
| `GatedHttpMessageHandler` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/AttendeeLookupServiceTests.cs:114` |
| `LivePollUIServiceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/LivePollUIServiceTests.cs:16` |
| `MutableTimeProvider` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/CurrentEventNotificationScopeProviderTests.cs:108` |
| `NowNextServiceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/NowNextServiceTests.cs:13` |
| `QuestionLookupServiceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/QuestionLookupServiceTests.cs:13` |
| `SessionBookmarkUIServiceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/SessionBookmarkUIServiceTests.cs:18` |
| `SessionFeedbackServiceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/SessionFeedbackServiceTests.cs:15` |
| `SessionLookupServiceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/SessionLookupServiceTests.cs:14` |
| `SessionQuestionUIServiceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/SessionQuestionUIServiceTests.cs:16` |
| `SessionReminderCoordinatorTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/SessionReminderCoordinatorTests.cs:16` |
| `SessionReminderPlannerTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/SessionReminderPlannerTests.cs:11` |
| `Http2ForwardingConfigFilter` | class | MMCA.ADC.Gateway | `MMCA.ADC.Gateway` | `MMCA.ADC.Gateway/Http2ForwardingConfigFilter.cs:23` |
| `ClusterProfile` | record | MMCA.ADC.Gateway.Tests | `MMCA.ADC.Gateway.Tests` | `MMCA.ADC.Gateway.Tests/RouteMapTests.cs:258` |
| `GatewayApplicationFactory` | class | MMCA.ADC.Gateway.Tests | `MMCA.ADC.Gateway.Tests` | `MMCA.ADC.Gateway.Tests/GatewayHardeningTests.cs:252` |
| `GatewayHardeningTests` | class | MMCA.ADC.Gateway.Tests | `MMCA.ADC.Gateway.Tests` | `MMCA.ADC.Gateway.Tests/GatewayHardeningTests.cs:27` |
| `GracefulShutdownTests` | class | MMCA.ADC.Gateway.Tests | `MMCA.ADC.Gateway.Tests` | `MMCA.ADC.Gateway.Tests/GracefulShutdownTests.cs:9` |
| `RecordingHttpForwarder` | class | MMCA.ADC.Gateway.Tests | `MMCA.ADC.Gateway.Tests` | `MMCA.ADC.Gateway.Tests/RecordingHttpForwarder.cs:21` |
| `RouteMapApplicationFactory` | class | MMCA.ADC.Gateway.Tests | `MMCA.ADC.Gateway.Tests` | `MMCA.ADC.Gateway.Tests/RouteMapTests.cs:269` |
| `RouteMapTests` | class | MMCA.ADC.Gateway.Tests | `MMCA.ADC.Gateway.Tests` | `MMCA.ADC.Gateway.Tests/RouteMapTests.cs:35` |
| `SecurityHeadersTests` | class | MMCA.ADC.Gateway.Tests | `MMCA.ADC.Gateway.Tests` | `MMCA.ADC.Gateway.Tests/SecurityHeadersTests.cs:11` |
| `AssemblyReference` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API` | `MMCA.ADC.Identity.API/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API` | `MMCA.ADC.Identity.API/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API` | `MMCA.ADC.Identity.API/DependencyInjection.cs:18` |
| `IdentityModule` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API` | `MMCA.ADC.Identity.API/IdentityModule.cs:13` |
| `IdentityModuleSeeder` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API` | `MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:14` |
| `HttpContextExternalLoginEmailVerifier` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API.Authentication` | `MMCA.ADC.Identity.API/Authentication/HttpContextExternalLoginEmailVerifier.cs:17` |
| `AuthController` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API.Controllers` | `MMCA.ADC.Identity.API/Controllers/AuthController.cs:29` |
| `OAuthController` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API.Controllers` | `MMCA.ADC.Identity.API/Controllers/OAuthController.cs:20` |
| `PasswordResetController` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API.Controllers` | `MMCA.ADC.Identity.API/Controllers/PasswordResetController.cs:28` |
| `UserClaimsController` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API.Controllers` | `MMCA.ADC.Identity.API/Controllers/UserClaimsController.cs:16` |
| `UsersController` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API.Controllers` | `MMCA.ADC.Identity.API/Controllers/UsersController.cs:32` |
| `IdentityErrorResources` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API.Resources` | `MMCA.ADC.Identity.API/Resources/IdentityErrorResources.cs:11` |
| `DependencyInjectionTests` | class | MMCA.ADC.Identity.API.Tests | `MMCA.ADC.Identity.API.Tests` | `MMCA.ADC.Identity.API.Tests/DependencyInjectionTests.cs:9` |
| `IdentityModuleTests` | class | MMCA.ADC.Identity.API.Tests | `MMCA.ADC.Identity.API.Tests` | `MMCA.ADC.Identity.API.Tests/IdentityModuleTests.cs:5` |
| `AuthControllerTests` | class | MMCA.ADC.Identity.API.Tests | `MMCA.ADC.Identity.API.Tests.Controllers` | `MMCA.ADC.Identity.API.Tests/Controllers/AuthControllerTests.cs:17` |
| `OAuthControllerTests` | class | MMCA.ADC.Identity.API.Tests | `MMCA.ADC.Identity.API.Tests.Controllers` | `MMCA.ADC.Identity.API.Tests/Controllers/OAuthControllerTests.cs:16` |
| `UserClaimsControllerTests` | class | MMCA.ADC.Identity.API.Tests | `MMCA.ADC.Identity.API.Tests.Controllers` | `MMCA.ADC.Identity.API.Tests/Controllers/UserClaimsControllerTests.cs:9` |
| `UsersControllerTests` | class | MMCA.ADC.Identity.API.Tests | `MMCA.ADC.Identity.API.Tests.Controllers` | `MMCA.ADC.Identity.API.Tests/Controllers/UsersControllerTests.cs:20` |
| `IdentityErrorResourcesTests` | class | MMCA.ADC.Identity.API.Tests | `MMCA.ADC.Identity.API.Tests.Localization` | `MMCA.ADC.Identity.API.Tests/Localization/IdentityErrorResourcesTests.cs:15` |
| `AssemblyReference` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application` | `MMCA.ADC.Identity.Application/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application` | `MMCA.ADC.Identity.Application/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application` | `MMCA.ADC.Identity.Application/DependencyInjection.cs:19` |
| `SpeakerLinkedToUserHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Speakers.IntegrationEventHandlers` | `MMCA.ADC.Identity.Application/Speakers/IntegrationEventHandlers/SpeakerLinkedToUserHandler.cs:20` |
| `SpeakerUnlinkedFromUserHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Speakers.IntegrationEventHandlers` | `MMCA.ADC.Identity.Application/Speakers/IntegrationEventHandlers/SpeakerUnlinkedFromUserHandler.cs:20` |
| `AttendeeQueryService` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users` | `MMCA.ADC.Identity.Application/Users/AttendeeQueryService.cs:11` |
| `AuthenticationService` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users` | `MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:35` |
| `IExternalLoginEmailVerifier` | interface | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users` | `MMCA.ADC.Identity.Application/Users/IExternalLoginEmailVerifier.cs:11` |
| `UserDTOMapper` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.DTOs` | `MMCA.ADC.Identity.Application/Users/DTOs/UserDTOMapper.cs:14` |
| `ChangePasswordCommand` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ChangePassword` | `MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:14` |
| `ChangePasswordHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ChangePassword` | `MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordHandler.cs:17` |
| `ChangePreferencesCommand` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences` | `MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommand.cs:14` |
| `ChangePreferencesHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences` | `MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandler.cs:17` |
| `DeleteUserCommand` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.DeleteUser` | `MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserCommand.cs:11` |
| `DeleteUserHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.DeleteUser` | `MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:28` |
| `EngagementUserDataExportSection` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData` | `MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/EngagementUserDataExportSection.cs:19` |
| `ExportUserDataHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData` | `MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:30` |
| `ExportUserDataQuery` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData` | `MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataQuery.cs:12` |
| `NotificationUserDataExportSection` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData` | `MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/NotificationUserDataExportSection.cs:18` |
| `ForgotPasswordCommand` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ForgotPassword` | `MMCA.ADC.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordCommand.cs:12` |
| `ForgotPasswordHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ForgotPassword` | `MMCA.ADC.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandler.cs:20` |
| `GetUserPreferencesHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.GetPreferences` | `MMCA.ADC.Identity.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandler.cs:13` |
| `GetUserAvatarHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.GetUserAvatar` | `MMCA.ADC.Identity.Application/Users/UseCases/GetUserAvatar/GetUserAvatarHandler.cs:10` |
| `GetUserAvatarQuery` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.GetUserAvatar` | `MMCA.ADC.Identity.Application/Users/UseCases/GetUserAvatar/GetUserAvatarQuery.cs:5` |
| `GetUsersHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.GetUsers` | `MMCA.ADC.Identity.Application/Users/UseCases/GetUsers/GetUsersHandler.cs:16` |
| `GetUsersQuery` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.GetUsers` | `MMCA.ADC.Identity.Application/Users/UseCases/GetUsers/GetUsersQuery.cs:12` |
| `RemoveUserAvatarCommand` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.RemoveUserAvatar` | `MMCA.ADC.Identity.Application/Users/UseCases/RemoveUserAvatar/RemoveUserAvatarCommand.cs:8` |
| `RemoveUserAvatarHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.RemoveUserAvatar` | `MMCA.ADC.Identity.Application/Users/UseCases/RemoveUserAvatar/RemoveUserAvatarHandler.cs:14` |
| `ResetPasswordCommand` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ResetPassword` | `MMCA.ADC.Identity.Application/Users/UseCases/ResetPassword/ResetPasswordCommand.cs:14` |
| `ResetPasswordHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ResetPassword` | `MMCA.ADC.Identity.Application/Users/UseCases/ResetPassword/ResetPasswordHandler.cs:18` |
| `SetUserAvatarCommand` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.SetUserAvatar` | `MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarCommand.cs:10` |
| `SetUserAvatarHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.SetUserAvatar` | `MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarHandler.cs:16` |
| `ChangePasswordRequestValidator` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.Validation` | `MMCA.ADC.Identity.Application/Users/Validation/ChangePasswordRequestValidator.cs:11` |
| `RegisterRequestValidator` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.Validation` | `MMCA.ADC.Identity.Application/Users/Validation/RegisterRequestValidator.cs:12` |
| `UserDTOMapperTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.DTOs` | `MMCA.ADC.Identity.Application.Tests/DTOs/UserDTOMapperTests.cs:7` |
| `Fakes` | record | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Speakers.IntegrationEventHandlers` | `MMCA.ADC.Identity.Application.Tests/Speakers/IntegrationEventHandlers/SpeakerLinkedToUserHandlerTests.cs:16` |
| `Fakes` | record | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Speakers.IntegrationEventHandlers` | `MMCA.ADC.Identity.Application.Tests/Speakers/IntegrationEventHandlers/SpeakerUnlinkedFromUserHandlerTests.cs:16` |
| `SpeakerLinkedToUserHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Speakers.IntegrationEventHandlers` | `MMCA.ADC.Identity.Application.Tests/Speakers/IntegrationEventHandlers/SpeakerLinkedToUserHandlerTests.cs:13` |
| `SpeakerUnlinkedFromUserHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Speakers.IntegrationEventHandlers` | `MMCA.ADC.Identity.Application.Tests/Speakers/IntegrationEventHandlers/SpeakerUnlinkedFromUserHandlerTests.cs:13` |
| `InMemoryRepository<TEntity, TIdentifierType>` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Support` | `MMCA.ADC.Identity.Application.Tests/Support/TestSupport.cs:17` |
| `RecordingUnitOfWork` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Support` | `MMCA.ADC.Identity.Application.Tests/Support/TestSupport.cs:245` |
| `AttendeeQueryServiceTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users` | `MMCA.ADC.Identity.Application.Tests/Users/AttendeeQueryServiceTests.cs:11` |
| `AuthenticationServiceTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users` | `MMCA.ADC.Identity.Application.Tests/Users/AuthenticationServiceTests.cs:18` |
| `ServiceMocks` | record | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users` | `MMCA.ADC.Identity.Application.Tests/Users/AuthenticationServiceTests.cs:490` |
| `SoftDeletedUserValidatorTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users` | `MMCA.ADC.Identity.Application.Tests/Users/SoftDeletedUserValidatorTests.cs:15` |
| `ChangePasswordHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/ChangePasswordHandlerTests.cs:12` |
| `ChangePreferencesHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/ChangePreferencesHandlerTests.cs:12` |
| `DeleteUserHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/DeleteUserHandlerTests.cs:15` |
| `EngagementUserDataExportSectionTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/EngagementUserDataExportSectionTests.cs:11` |
| `ExportUserDataHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/ExportUserDataHandlerTests.cs:16` |
| `ExportUserDataRegistrationTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/ExportUserDataRegistrationTests.cs:16` |
| `FixedTimeProvider` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/DeleteUserHandlerTests.cs:328` |
| `ForgotPasswordHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/ForgotPasswordHandlerTests.cs:22` |
| `GetUserPreferencesHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/GetUserPreferencesHandlerTests.cs:15` |
| `GetUsersHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/GetUsersHandlerTests.cs:12` |
| `NotificationUserDataExportSectionTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/NotificationUserDataExportSectionTests.cs:9` |
| `ResetPasswordHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/ResetPasswordHandlerTests.cs:19` |
| `SetUserAvatarHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/SetUserAvatarHandlerTests.cs:16` |
| `ThrowingExportSection` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/ExportUserDataHandlerTests.cs:353` |
| `ChangePasswordRequestValidatorTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Validation` | `MMCA.ADC.Identity.Application.Tests/Validation/ChangePasswordRequestValidatorTests.cs:7` |
| `LoginRequestValidatorTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Validation` | `MMCA.ADC.Identity.Application.Tests/Validation/LoginRequestValidatorTests.cs:7` |
| `RefreshTokenRequestValidatorTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Validation` | `MMCA.ADC.Identity.Application.Tests/Validation/RefreshTokenRequestValidatorTests.cs:7` |
| `RegisterRequestValidatorTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Validation` | `MMCA.ADC.Identity.Application.Tests/Validation/RegisterRequestValidatorTests.cs:7` |
| `AttendeeQueryServiceGrpcAdapter` | class | MMCA.ADC.Identity.Contracts | `MMCA.ADC.Identity.Contracts` | `MMCA.ADC.Identity.Contracts/AttendeeQueryServiceGrpcAdapter.cs:14` |
| `DependencyInjection` | class | MMCA.ADC.Identity.Contracts | `MMCA.ADC.Identity.Contracts` | `MMCA.ADC.Identity.Contracts/DependencyInjection.cs:14` |
| `AssemblyReference` | class | MMCA.ADC.Identity.Domain | `MMCA.ADC.Identity.Domain` | `MMCA.ADC.Identity.Domain/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Identity.Domain | `MMCA.ADC.Identity.Domain` | `MMCA.ADC.Identity.Domain/AssemblyReference.cs:11` |
| `User` | class | MMCA.ADC.Identity.Domain | `MMCA.ADC.Identity.Domain.Users` | `MMCA.ADC.Identity.Domain/Users/User.cs:33` |
| `UserInvariants` | class | MMCA.ADC.Identity.Domain | `MMCA.ADC.Identity.Domain.Users` | `MMCA.ADC.Identity.Domain/Users/UserInvariants.cs:9` |
| `UserRole` | class | MMCA.ADC.Identity.Domain | `MMCA.ADC.Identity.Domain.Users` | `MMCA.ADC.Identity.Domain/Users/UserRole.cs:17` |
| `UserDeleted` | record | MMCA.ADC.Identity.Domain | `MMCA.ADC.Identity.Domain.Users.DomainEvents` | `MMCA.ADC.Identity.Domain/Users/DomainEvents/UserDeleted.cs:10` |
| `UserPasswordChanged` | record | MMCA.ADC.Identity.Domain | `MMCA.ADC.Identity.Domain.Users.DomainEvents` | `MMCA.ADC.Identity.Domain/Users/DomainEvents/UserPasswordChanged.cs:9` |
| `UserBuilder` | class | MMCA.ADC.Identity.Domain.Tests | `MMCA.ADC.Identity.Domain.Tests.Builders` | `MMCA.ADC.Identity.Domain.Tests/Builders/UserBuilder.cs:10` |
| `UserAnonymizeTests` | class | MMCA.ADC.Identity.Domain.Tests | `MMCA.ADC.Identity.Domain.Tests.Users` | `MMCA.ADC.Identity.Domain.Tests/Users/UserAnonymizeTests.cs:12` |
| `UserInvariantsAndRoleTests` | class | MMCA.ADC.Identity.Domain.Tests | `MMCA.ADC.Identity.Domain.Tests.Users` | `MMCA.ADC.Identity.Domain.Tests/Users/UserInvariantsAndRoleTests.cs:14` |
| `UserTests` | class | MMCA.ADC.Identity.Domain.Tests | `MMCA.ADC.Identity.Domain.Tests.Users` | `MMCA.ADC.Identity.Domain.Tests/Users/UserTests.cs:7` |
| `AssemblyReference` | class | MMCA.ADC.Identity.Infrastructure | `MMCA.ADC.Identity.Infrastructure` | `MMCA.ADC.Identity.Infrastructure/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Identity.Infrastructure | `MMCA.ADC.Identity.Infrastructure` | `MMCA.ADC.Identity.Infrastructure/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.ADC.Identity.Infrastructure | `MMCA.ADC.Identity.Infrastructure` | `MMCA.ADC.Identity.Infrastructure/DependencyInjection.cs:11` |
| `ModuleApplicationDbContext` | class | MMCA.ADC.Identity.Infrastructure | `MMCA.ADC.Identity.Infrastructure.Persistence.DbContexts` | `MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:15` |
| `IdentityModuleDbSeeder` | class | MMCA.ADC.Identity.Infrastructure | `MMCA.ADC.Identity.Infrastructure.Persistence.DbContexts.Seeding` | `MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:27` |
| `UserConfiguration` | class | MMCA.ADC.Identity.Infrastructure | `MMCA.ADC.Identity.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:12` |
| `IdentityEntityConfigurationTests` | class | MMCA.ADC.Identity.Infrastructure.Tests | `MMCA.ADC.Identity.Infrastructure.Tests.Persistence` | `MMCA.ADC.Identity.Infrastructure.Tests/Persistence/IdentityEntityConfigurationTests.cs:9` |
| `IdentityTestDbContext` | class | MMCA.ADC.Identity.Infrastructure.Tests | `MMCA.ADC.Identity.Infrastructure.Tests.Persistence` | `MMCA.ADC.Identity.Infrastructure.Tests/Persistence/IdentityEntityConfigurationTests.cs:138` |
| `IdentityModuleDbSeederTests` | class | MMCA.ADC.Identity.Infrastructure.Tests | `MMCA.ADC.Identity.Infrastructure.Tests.Seeding` | `MMCA.ADC.Identity.Infrastructure.Tests/Seeding/IdentityModuleDbSeederTests.cs:10` |
| `SeederMocks` | record | MMCA.ADC.Identity.Infrastructure.Tests | `MMCA.ADC.Identity.Infrastructure.Tests.Seeding` | `MMCA.ADC.Identity.Infrastructure.Tests/Seeding/IdentityModuleDbSeederTests.cs:84` |
| `AnonymousAccessDeniedTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Anonymous` | `MMCA.ADC.Identity.IntegrationTests/Anonymous/AnonymousAccessDeniedTests.cs:8` |
| `AnonymousAuthEdgeCaseTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Anonymous` | `MMCA.ADC.Identity.IntegrationTests/Anonymous/AnonymousAuthEdgeCaseTests.cs:8` |
| `JwksDiscoveryTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Anonymous` | `MMCA.ADC.Identity.IntegrationTests/Anonymous/JwksDiscoveryTests.cs:16` |
| `OAuthChallengeTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Anonymous` | `MMCA.ADC.Identity.IntegrationTests/Anonymous/OAuthChallengeTests.cs:14` |
| `AttendeeAccessDeniedTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Attendee` | `MMCA.ADC.Identity.IntegrationTests/Attendee/AttendeeAccessDeniedTests.cs:8` |
| `AttendeeAuthTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Attendee` | `MMCA.ADC.Identity.IntegrationTests/Attendee/AttendeeAuthTests.cs:9` |
| `AttendeeClaimsTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Attendee` | `MMCA.ADC.Identity.IntegrationTests/Attendee/AttendeeClaimsTests.cs:13` |
| `AttendeeProfileTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Attendee` | `MMCA.ADC.Identity.IntegrationTests/Attendee/AttendeeProfileTests.cs:9` |
| `AuthPreferencesTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Attendee` | `MMCA.ADC.Identity.IntegrationTests/Attendee/AuthPreferencesTests.cs:14` |
| `AuthResponse` | record | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Attendee` | `MMCA.ADC.Identity.IntegrationTests/Attendee/AttendeeAuthTests.cs:126` |
| `PreferencesResponse` | record | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Attendee` | `MMCA.ADC.Identity.IntegrationTests/Attendee/AuthPreferencesTests.cs:109` |
| `UserExportTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Attendee` | `MMCA.ADC.Identity.IntegrationTests/Attendee/UserExportTests.cs:18` |
| `AnonymousAuthTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Auth` | `MMCA.ADC.Identity.IntegrationTests/Auth/AnonymousAuthTests.cs:11` |
| `ExchangeResponse` | record | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Auth` | `MMCA.ADC.Identity.IntegrationTests/Auth/OAuthExchangeTests.cs:68` |
| `OAuthExchangeTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Auth` | `MMCA.ADC.Identity.IntegrationTests/Auth/OAuthExchangeTests.cs:18` |
| `PasswordResetFlowTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Auth` | `MMCA.ADC.Identity.IntegrationTests/Auth/PasswordResetFlowTests.cs:18` |
| `ErasureAndPiiLoggingTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Compliance` | `MMCA.ADC.Identity.IntegrationTests/Compliance/ErasureAndPiiLoggingTests.cs:19` |
| `OpenApiContractTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Contract` | `MMCA.ADC.Identity.IntegrationTests/Contract/OpenApiContractTests.cs:15` |
| `ProblemDetailsContractTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Contract` | `MMCA.ADC.Identity.IntegrationTests/Contract/ProblemDetailsContractTests.cs:16` |
| `CrossServiceSpeakerLinkTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.CrossService` | `MMCA.ADC.Identity.IntegrationTests/CrossService/CrossServiceSpeakerLinkTests.cs:23` |
| `OutboxFidelityTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Data` | `MMCA.ADC.Identity.IntegrationTests/Data/OutboxFidelityTests.cs:17` |
| `FakeUserEngagementExportService` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/FakeUserEngagementExportService.cs:12` |
| `FakeUserNotificationExportService` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/FakeUserNotificationExportService.cs:10` |
| `IdentityIntegrationTestBase` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestBase.cs:12` |
| `IdentityIntegrationTestCollection` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestCollection.cs:8` |
| `IdentityIntegrationTestFixture` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestFixture.cs:22` |
| `IdentityTestWebApplicationFactory` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityTestWebApplicationFactory.cs:31` |
| `JwksEnabledIdentityFixture` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/JwksEnabledIdentityFixture.cs:13` |
| `JwksIntegrationTestBase` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/JwksIntegrationTestBase.cs:11` |
| `JwksIntegrationTestCollection` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/JwksIntegrationTestCollection.cs:9` |
| `PiiCaptureLogger` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/PiiLogCapture.cs:30` |
| `PiiCaptureLoggerProvider` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/PiiLogCapture.cs:21` |
| `PiiLogCapture` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/PiiLogCapture.cs:12` |
| `OrganizerUserTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Organizer` | `MMCA.ADC.Identity.IntegrationTests/Organizer/OrganizerUserTests.cs:10` |
| `SelfHttpWarmupTask` | class | MMCA.ADC.Identity.Service | `MMCA.ADC.Identity.Service` | `MMCA.ADC.Identity.Service/SelfHttpWarmupTask.cs:23` |
| `AttendeesGrpcService` | class | MMCA.ADC.Identity.Service | `MMCA.ADC.Identity.Service.Grpc` | `MMCA.ADC.Identity.Service/Grpc/AttendeesGrpcService.cs:19` |
| `IdentitySettings` | class | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared` | `MMCA.ADC.Identity.Shared/IdentitySettings.cs:7` |
| `IdentityPermissions` | class | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Authorization` | `MMCA.ADC.Identity.Shared/Authorization/IdentityPermissions.cs:8` |
| `DisabledAttendeeQueryService` | class | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/DisabledAttendeeQueryService.cs:7` |
| `IAttendeeQueryService` | interface | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/IAttendeeQueryService.cs:8` |
| `UserAvatarDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserAvatarDTO.cs:6` |
| `UserDataExportBookmarkDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserDataExportBookmarkDTO.cs:7` |
| `UserDataExportCheckInDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserDataExportCheckInDTO.cs:8` |
| `UserDataExportEngagementSectionDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserDataExportEngagementSectionDTO.cs:11` |
| `UserDataExportNotificationDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserDataExportNotificationDTO.cs:7` |
| `UserDataExportNotificationSectionDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserDataExportNotificationSectionDTO.cs:10` |
| `UserDataExportPointsEntryDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserDataExportPointsEntryDTO.cs:7` |
| `UserDataExportSubjectDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserDataExportSubjectDTO.cs:16` |
| `UserDataExportSubmittedQuestionDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserDataExportSubmittedQuestionDTO.cs:7` |
| `UserDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserDTO.cs:8` |
| `UserListDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserListDTO.cs:7` |
| `UserDeleted` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users.IntegrationEvents` | `MMCA.ADC.Identity.Shared/Users/IntegrationEvents/UserDeleted.cs:24` |
| `UserRegistered` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users.IntegrationEvents` | `MMCA.ADC.Identity.Shared/Users/IntegrationEvents/UserRegistered.cs:23` |
| `DisabledAttendeeQueryServiceTests` | class | MMCA.ADC.Identity.Shared.Tests | `MMCA.ADC.Identity.Shared.Tests.Users` | `MMCA.ADC.Identity.Shared.Tests/Users/DisabledAttendeeQueryServiceTests.cs:6` |
| `UserDTOTests` | class | MMCA.ADC.Identity.Shared.Tests | `MMCA.ADC.Identity.Shared.Tests.Users` | `MMCA.ADC.Identity.Shared.Tests/Users/UserDTOTests.cs:6` |
| `UserListDTOTests` | class | MMCA.ADC.Identity.Shared.Tests | `MMCA.ADC.Identity.Shared.Tests.Users` | `MMCA.ADC.Identity.Shared.Tests/Users/UserListDTOTests.cs:6` |
| `DependencyInjection` | class | MMCA.ADC.Identity.UI | `MMCA.ADC.Identity.UI` | `MMCA.ADC.Identity.UI/DependencyInjection.cs:11` |
| `IdentityRoutePaths` | class | MMCA.ADC.Identity.UI | `MMCA.ADC.Identity.UI` | `MMCA.ADC.Identity.UI/IdentityRoutePaths.cs:6` |
| `IdentityUIModule` | class | MMCA.ADC.Identity.UI | `MMCA.ADC.Identity.UI` | `MMCA.ADC.Identity.UI/IdentityUIModule.cs:13` |
| `ListPageActions` | class | MMCA.ADC.Identity.UI | `MMCA.ADC.Identity.UI.Common` | `MMCA.ADC.Identity.UI/Common/ListPageActions.cs:13` |
| `Profile` | class | MMCA.ADC.Identity.UI | `MMCA.ADC.Identity.UI.Pages.Profile` | `MMCA.ADC.Identity.UI/Pages/Profile/Profile.razor.cs:15` |
| `UserList` | class | MMCA.ADC.Identity.UI | `MMCA.ADC.Identity.UI.Pages.User` | `MMCA.ADC.Identity.UI/Pages/User/UserList.razor.cs:16` |
| `IUserUIService` | interface | MMCA.ADC.Identity.UI | `MMCA.ADC.Identity.UI.Services` | `MMCA.ADC.Identity.UI/Services/IUserUIService.cs:11` |
| `UserService` | class | MMCA.ADC.Identity.UI | `MMCA.ADC.Identity.UI.Services` | `MMCA.ADC.Identity.UI/Services/UserService.cs:14` |
| `BunitTestBase` | class | MMCA.ADC.Identity.UI.Tests | `MMCA.ADC.Identity.UI.Tests` | `MMCA.ADC.Identity.UI.Tests/BunitTestBase.cs:17` |
| `IdentityRouteAuthorizationTests` | class | MMCA.ADC.Identity.UI.Tests | `MMCA.ADC.Identity.UI.Tests` | `MMCA.ADC.Identity.UI.Tests/IdentityRouteAuthorizationTests.cs:16` |
| `ProfileChangePasswordTests` | class | MMCA.ADC.Identity.UI.Tests | `MMCA.ADC.Identity.UI.Tests.Pages.Profile` | `MMCA.ADC.Identity.UI.Tests/Pages/Profile/ProfileChangePasswordTests.cs:16` |
| `ProfileTests` | class | MMCA.ADC.Identity.UI.Tests | `MMCA.ADC.Identity.UI.Tests.Pages.Profile` | `MMCA.ADC.Identity.UI.Tests/Pages/Profile/ProfileTests.cs:16` |
| `UserListTests` | class | MMCA.ADC.Identity.UI.Tests | `MMCA.ADC.Identity.UI.Tests.Pages.User` | `MMCA.ADC.Identity.UI.Tests/Pages/User/UserListTests.cs:22` |
| `UserServiceTests` | class | MMCA.ADC.Identity.UI.Tests | `MMCA.ADC.Identity.UI.Tests.Services` | `MMCA.ADC.Identity.UI.Tests/Services/UserServiceTests.cs:15` |
| `DependencyInjection` | class | MMCA.ADC.Notification.API | `MMCA.ADC.Notification.API` | `MMCA.ADC.Notification.API/DependencyInjection.cs:13` |
| `NotificationModule` | class | MMCA.ADC.Notification.API | `MMCA.ADC.Notification.API` | `MMCA.ADC.Notification.API/NotificationModule.cs:15` |
| `NotificationModuleTests` | class | MMCA.ADC.Notification.API.Tests | `MMCA.ADC.Notification.API.Tests` | `MMCA.ADC.Notification.API.Tests/NotificationModuleTests.cs:8` |
| `AttendeeNotificationRecipientProvider` | class | MMCA.ADC.Notification.Application | `MMCA.ADC.Notification.Application` | `MMCA.ADC.Notification.Application/AttendeeNotificationRecipientProvider.cs:10` |
| `DependencyInjection` | class | MMCA.ADC.Notification.Application | `MMCA.ADC.Notification.Application` | `MMCA.ADC.Notification.Application/DependencyInjection.cs:12` |
| `UserNotificationExportService` | class | MMCA.ADC.Notification.Application | `MMCA.ADC.Notification.Application` | `MMCA.ADC.Notification.Application/UserNotificationExportService.cs:15` |
| `AttendeeNotificationRecipientProviderTests` | class | MMCA.ADC.Notification.Application.Tests | `MMCA.ADC.Notification.Application.Tests` | `MMCA.ADC.Notification.Application.Tests/AttendeeNotificationRecipientProviderTests.cs:7` |
| `DependencyInjectionTests` | class | MMCA.ADC.Notification.Application.Tests | `MMCA.ADC.Notification.Application.Tests` | `MMCA.ADC.Notification.Application.Tests/DependencyInjectionTests.cs:10` |
| `UserNotificationExportServiceTests` | class | MMCA.ADC.Notification.Application.Tests | `MMCA.ADC.Notification.Application.Tests` | `MMCA.ADC.Notification.Application.Tests/UserNotificationExportServiceTests.cs:11` |
| `InMemoryQueryableExecutor` | class | MMCA.ADC.Notification.Application.Tests | `MMCA.ADC.Notification.Application.Tests.Support` | `MMCA.ADC.Notification.Application.Tests/Support/TestSupport.cs:11` |
| `TestSupport` | class | MMCA.ADC.Notification.Application.Tests | `MMCA.ADC.Notification.Application.Tests.Support` | `MMCA.ADC.Notification.Application.Tests/Support/TestSupport.cs:31` |
| `DependencyInjection` | class | MMCA.ADC.Notification.Contracts | `MMCA.ADC.Notification.Contracts` | `MMCA.ADC.Notification.Contracts/DependencyInjection.cs:16` |
| `LiveChannelPublisherGrpcAdapter` | class | MMCA.ADC.Notification.Contracts | `MMCA.ADC.Notification.Contracts` | `MMCA.ADC.Notification.Contracts/LiveChannelPublisherGrpcAdapter.cs:20` |
| `UserNotificationExportServiceGrpcAdapter` | class | MMCA.ADC.Notification.Contracts | `MMCA.ADC.Notification.Contracts` | `MMCA.ADC.Notification.Contracts/UserNotificationExportServiceGrpcAdapter.cs:17` |
| `OpenApiContractTests` | class | MMCA.ADC.Notification.IntegrationTests | `MMCA.ADC.Notification.IntegrationTests.Contract` | `MMCA.ADC.Notification.IntegrationTests/Contract/OpenApiContractTests.cs:16` |
| `ProblemDetailsContractTests` | class | MMCA.ADC.Notification.IntegrationTests | `MMCA.ADC.Notification.IntegrationTests.Contract` | `MMCA.ADC.Notification.IntegrationTests/Contract/ProblemDetailsContractTests.cs:15` |
| `FakeAttendeeQueryService` | class | MMCA.ADC.Notification.IntegrationTests | `MMCA.ADC.Notification.IntegrationTests.Infrastructure` | `MMCA.ADC.Notification.IntegrationTests/Infrastructure/FakeAttendeeQueryService.cs:12` |
| `NotificationIntegrationTestBase` | class | MMCA.ADC.Notification.IntegrationTests | `MMCA.ADC.Notification.IntegrationTests.Infrastructure` | `MMCA.ADC.Notification.IntegrationTests/Infrastructure/NotificationIntegrationTestBase.cs:17` |
| `NotificationIntegrationTestCollection` | class | MMCA.ADC.Notification.IntegrationTests | `MMCA.ADC.Notification.IntegrationTests.Infrastructure` | `MMCA.ADC.Notification.IntegrationTests/Infrastructure/NotificationIntegrationTestCollection.cs:8` |
| `NotificationIntegrationTestFixture` | class | MMCA.ADC.Notification.IntegrationTests | `MMCA.ADC.Notification.IntegrationTests.Infrastructure` | `MMCA.ADC.Notification.IntegrationTests/Infrastructure/NotificationIntegrationTestFixture.cs:17` |
| `NotificationTestWebApplicationFactory` | class | MMCA.ADC.Notification.IntegrationTests | `MMCA.ADC.Notification.IntegrationTests.Infrastructure` | `MMCA.ADC.Notification.IntegrationTests/Infrastructure/NotificationTestWebApplicationFactory.cs:34` |
| `NotificationControllerTests` | class | MMCA.ADC.Notification.IntegrationTests | `MMCA.ADC.Notification.IntegrationTests.Notifications` | `MMCA.ADC.Notification.IntegrationTests/Notifications/NotificationControllerTests.cs:16` |
| `NotificationHubTests` | class | MMCA.ADC.Notification.IntegrationTests | `MMCA.ADC.Notification.IntegrationTests.Notifications` | `MMCA.ADC.Notification.IntegrationTests/Notifications/NotificationHubTests.cs:15` |
| `LiveChannelGrpcService` | class | MMCA.ADC.Notification.Service | `MMCA.ADC.Notification.Service.Grpc` | `MMCA.ADC.Notification.Service/Grpc/LiveChannelGrpcService.cs:22` |
| `UserNotificationExportGrpcService` | class | MMCA.ADC.Notification.Service | `MMCA.ADC.Notification.Service.Grpc` | `MMCA.ADC.Notification.Service/Grpc/UserNotificationExportGrpcService.cs:27` |
| `DisabledUserNotificationExportService` | class | MMCA.ADC.Notification.Shared | `MMCA.ADC.Notification.Shared.UserNotifications` | `MMCA.ADC.Notification.Shared/UserNotifications/DisabledUserNotificationExportService.cs:7` |
| `IUserNotificationExportService` | interface | MMCA.ADC.Notification.Shared | `MMCA.ADC.Notification.Shared.UserNotifications` | `MMCA.ADC.Notification.Shared/UserNotifications/IUserNotificationExportService.cs:11` |
| `UserNotificationExportItemDTO` | record | MMCA.ADC.Notification.Shared | `MMCA.ADC.Notification.Shared.UserNotifications` | `MMCA.ADC.Notification.Shared/UserNotifications/UserNotificationExportItemDTO.cs:7` |
| `ServiceBusRoundTripSmokeTests` | class | MMCA.ADC.ServiceBusEmulator.IntegrationTests | `MMCA.ADC.ServiceBusEmulator.IntegrationTests` | `MMCA.ADC.ServiceBusEmulator.IntegrationTests/ServiceBusRoundTripSmokeTests.cs:26` |
| `ServiceBusEmulatorCollection` | class | MMCA.ADC.ServiceBusEmulator.IntegrationTests | `MMCA.ADC.ServiceBusEmulator.IntegrationTests.Infrastructure` | `MMCA.ADC.ServiceBusEmulator.IntegrationTests/Infrastructure/ServiceBusEmulatorFixture.cs:186` |
| `ServiceBusEmulatorFixture` | class | MMCA.ADC.ServiceBusEmulator.IntegrationTests | `MMCA.ADC.ServiceBusEmulator.IntegrationTests.Infrastructure` | `MMCA.ADC.ServiceBusEmulator.IntegrationTests/Infrastructure/ServiceBusEmulatorFixture.cs:48` |
| `UserEngagementExportGrpcServiceTests` | class | MMCA.ADC.Services.Tests | `MMCA.ADC.Services.Tests.Exports` | `MMCA.ADC.Services.Tests/Exports/UserEngagementExportGrpcServiceTests.cs:17` |
| `UserEngagementExportServiceGrpcAdapterTests` | class | MMCA.ADC.Services.Tests | `MMCA.ADC.Services.Tests.Exports` | `MMCA.ADC.Services.Tests/Exports/UserEngagementExportServiceGrpcAdapterTests.cs:16` |
| `UserNotificationExportGrpcServiceTests` | class | MMCA.ADC.Services.Tests | `MMCA.ADC.Services.Tests.Exports` | `MMCA.ADC.Services.Tests/Exports/UserNotificationExportGrpcServiceTests.cs:17` |
| `UserNotificationExportServiceGrpcAdapterTests` | class | MMCA.ADC.Services.Tests | `MMCA.ADC.Services.Tests.Exports` | `MMCA.ADC.Services.Tests/Exports/UserNotificationExportServiceGrpcAdapterTests.cs:15` |
| `FakeServerCallContext` | class | MMCA.ADC.Services.Tests | `MMCA.ADC.Services.Tests.Support` | `MMCA.ADC.Services.Tests/Support/FakeServerCallContext.cs:10` |
| `App` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/App.xaml.cs:7` |
| `AppDelegate` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/iOS/AppDelegate.cs:16` |
| `AppDelegate` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/MacCatalyst/AppDelegate.cs:9` |
| `DeviceUIModule` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/DeviceUIModule.cs:19` |
| `MainActivity` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/Android/MainActivity.cs:27` |
| `MainApplication` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/Android/MainApplication.cs:10` |
| `MainPage` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/MainPage.xaml.cs:12` |
| `MauiProgram` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/MauiProgram.cs:35` |
| `NowNextSession` | record | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:134` |
| `NowNextSnapshot` | record | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:132` |
| `NowNextWidgetProvider` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:22` |
| `Program` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/iOS/Program.cs:8` |
| `Program` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/MacCatalyst/Program.cs:8` |
| `WebAuthenticatorCallbackActivity` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/Android/WebAuthenticatorCallbackActivity.cs:19` |
| `ADCHomePageContent` | class | MMCA.ADC.UI | `MMCA.ADC.UI.Pages` | `MMCA.ADC.UI/Pages/ADCHomePageContent.cs:8` |
| `AppActionsInitializer` | class | MMCA.ADC.UI | `MMCA.ADC.UI.Services` | `MMCA.ADC.UI/Services/AppActionsInitializer.cs:15` |
| `MauiPublicLinkBuilder` | class | MMCA.ADC.UI | `MMCA.ADC.UI.Services` | `MMCA.ADC.UI/Services/MauiPublicLinkBuilder.cs:13` |
| `App` | class | MMCA.ADC.UI | `MMCA.ADC.UI.WinUI` | `MMCA.ADC.UI/Platforms/Windows/App.xaml.cs:8` |
| `ADCHomePageContent` | class | MMCA.ADC.UI.Web.Client | `MMCA.ADC.UI.Web.Client.Pages` | `MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:11` |
| `AssemblyReference` | class | MMCA.Common.API | `MMCA.Common.API` | `MMCA.Common.API/AssemblyReference.cs:8` |
| `ClassReference` | class | MMCA.Common.API | `MMCA.Common.API` | `MMCA.Common.API/AssemblyReference.cs:20` |
| `DependencyInjection` | class | MMCA.Common.API | `MMCA.Common.API` | `MMCA.Common.API/DependencyInjection.cs:25` |
| `ModuleControllerFeatureProvider` | class | MMCA.Common.API | `MMCA.Common.API` | `MMCA.Common.API/ModuleControllerFeatureProvider.cs:28` |
| `ExternalAuthExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Authentication` | `MMCA.Common.API/Authentication/ExternalAuthExtensions.cs:21` |
| `AllowMissingOwnerAttribute` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/AllowMissingOwnerAttribute.cs:21` |
| `AuthorizationExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/AuthorizationExtensions.cs:12` |
| `AuthorizationPolicies` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/AuthorizationPolicies.cs:11` |
| `HasPermissionAttribute` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/HasPermissionAttribute.cs:13` |
| `OwnerOrAdminFilter` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:30` |
| `OwnerOrAdminFilterOptions` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:11` |
| `OwnershipHelper` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/OwnershipHelper.cs:10` |
| `PermissionAuthorizationHandler` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:13` |
| `PermissionPolicy` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/PermissionPolicy.cs:9` |
| `PermissionPolicyProvider` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:13` |
| `PermissionRequirement` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/PermissionRequirement.cs:10` |
| `OutputCacheEvictionExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Caching` | `MMCA.Common.API/Caching/OutputCacheEvictionExtensions.cs:14` |
| `OutputCacheEvictionHandler` | class | MMCA.Common.API | `MMCA.Common.API.Caching` | `MMCA.Common.API/Caching/OutputCacheEvictionHandler.cs:32` |
| `OutputCacheMetrics` | class | MMCA.Common.API | `MMCA.Common.API.Caching` | `MMCA.Common.API/Caching/OutputCacheMetrics.cs:16` |
| `OutputCacheOptionsExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Caching` | `MMCA.Common.API/Caching/OutputCacheOptionsExtensions.cs:6` |
| `PublicEndpointOutputCachePolicy` | class | MMCA.Common.API | `MMCA.Common.API.Caching` | `MMCA.Common.API/Caching/PublicEndpointOutputCachePolicy.cs:35` |
| `ConcurrencyETag` | class | MMCA.Common.API | `MMCA.Common.API.Concurrency` | `MMCA.Common.API/Concurrency/ConcurrencyETag.cs:23` |
| `SupportsIfMatchAttribute` | class | MMCA.Common.API | `MMCA.Common.API.Concurrency` | `MMCA.Common.API/Concurrency/SupportsIfMatchAttribute.cs:47` |
| `AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>` | class | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/AggregateRootEntityControllerBase.cs:27` |
| `ApiControllerBase` | class | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/ApiControllerBase.cs:16` |
| `AuthControllerBase` | class | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/AuthControllerBase.cs:41` |
| `EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>` | class | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/EntityControllerBase.cs:35` |
| `IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>` | interface | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/IAggregateRootEntityControllerBase.cs:15` |
| `IEntityControllerBase<TEntityDTO, TIdentifierType>` | interface | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/IEntityControllerBase.cs:14` |
| `OAuthControllerBase` | class | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/OAuthControllerBase.cs:33` |
| `PasswordResetAuthControllerBase<TForgotPasswordCommand, TResetPasswordCommand>` | class | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/PasswordResetAuthControllerBase.cs:43` |
| `ServiceInfoControllerBase` | class | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:30` |
| `ServiceInfoResponse` | record | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:51` |
| `ServiceInfoV2Response` | record | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:54` |
| `UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>` | class | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/UserAccountAuthControllerBase.cs:40` |
| `DevicesController` | class | MMCA.Common.API | `MMCA.Common.API.Controllers.Notifications` | `MMCA.Common.API/Controllers/Notifications/DevicesController.cs:25` |
| `InboxController` | class | MMCA.Common.API | `MMCA.Common.API.Controllers.Notifications` | `MMCA.Common.API/Controllers/Notifications/NotificationInboxController.cs:30` |
| `NotificationsController` | class | MMCA.Common.API | `MMCA.Common.API.Controllers.Notifications` | `MMCA.Common.API/Controllers/Notifications/NotificationsController.cs:30` |
| `DataExportControllerBase<TQuery>` | class | MMCA.Common.API | `MMCA.Common.API.Controllers.Privacy` | `MMCA.Common.API/Controllers/Privacy/DataExportControllerBase.cs:60` |
| `CsvWriter` | class | MMCA.Common.API | `MMCA.Common.API.Export` | `MMCA.Common.API/Export/CsvWriter.cs:34` |
| `CurrentUserTargetingContextAccessor` | class | MMCA.Common.API | `MMCA.Common.API.FeatureManagement` | `MMCA.Common.API/FeatureManagement/CurrentUserTargetingContextAccessor.cs:51` |
| `DisabledFeatureHandler` | class | MMCA.Common.API | `MMCA.Common.API.FeatureManagement` | `MMCA.Common.API/FeatureManagement/DisabledFeatureHandler.cs:13` |
| `IdempotencyFilter` | class | MMCA.Common.API | `MMCA.Common.API.Idempotency` | `MMCA.Common.API/Idempotency/IdempotencyFilter.cs:66` |
| `IdempotencyMetrics` | class | MMCA.Common.API | `MMCA.Common.API.Idempotency` | `MMCA.Common.API/Idempotency/IdempotencyMetrics.cs:16` |
| `IdempotencyRecord` | record | MMCA.Common.API | `MMCA.Common.API.Idempotency` | `MMCA.Common.API/Idempotency/IdempotencyRecord.cs:17` |
| `IdempotencySettings` | class | MMCA.Common.API | `MMCA.Common.API.Idempotency` | `MMCA.Common.API/Idempotency/IdempotencySettings.cs:9` |
| `IdempotentAttribute` | class | MMCA.Common.API | `MMCA.Common.API.Idempotency` | `MMCA.Common.API/Idempotency/IdempotentAttribute.cs:16` |
| `NonIdempotentAttribute` | class | MMCA.Common.API | `MMCA.Common.API.Idempotency` | `MMCA.Common.API/Idempotency/NonIdempotentAttribute.cs:23` |
| `CurrencyJsonConverter` | class | MMCA.Common.API | `MMCA.Common.API.JsonConverters` | `MMCA.Common.API/JsonConverters/CurrencyJsonConverter.cs:12` |
| `ErrorLocalizer` | class | MMCA.Common.API | `MMCA.Common.API.Localization` | `MMCA.Common.API/Localization/ErrorLocalizer.cs:11` |
| `ErrorResourceSource` | class | MMCA.Common.API | `MMCA.Common.API.Localization` | `MMCA.Common.API/Localization/ErrorResourceSource.cs:12` |
| `IErrorLocalizer` | interface | MMCA.Common.API | `MMCA.Common.API.Localization` | `MMCA.Common.API/Localization/IErrorLocalizer.cs:9` |
| `CorrelationIdMiddleware` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/CorrelationIdMiddleware.cs:15` |
| `DbUpdateExceptionHandler` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/DbUpdateExceptionHandler.cs:17` |
| `DomainExceptionHandler` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/DomainExceptionHandler.cs:16` |
| `ErrorHttpMapping` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/ErrorHttpMapping.cs:14` |
| `GlobalExceptionHandler` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/GlobalExceptionHandler.cs:15` |
| `OperationCanceledExceptionHandler` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/OperationCanceledExceptionHandler.cs:16` |
| `SoftDeletedUserMiddleware` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:31` |
| `TenantResolutionMiddleware` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/TenantResolutionMiddleware.cs:36` |
| `UnhandledResultFailureFilter` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/UnhandledResultFailureFilter.cs:21` |
| `ValidationExceptionHandler` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/ValidationExceptionHandler.cs:17` |
| `QueryFilterModelBinder` | class | MMCA.Common.API | `MMCA.Common.API.ModelBinders` | `MMCA.Common.API/ModelBinders/QueryFilterModelBinder.cs:24` |
| `DependencyInjection` | class | MMCA.Common.API | `MMCA.Common.API.Notifications` | `MMCA.Common.API/Notifications/DependencyInjection.cs:9` |
| `ApiParameterDescriptorBackfillProvider` | class | MMCA.Common.API | `MMCA.Common.API.OpenApi` | `MMCA.Common.API/OpenApi/ApiParameterDescriptorBackfillProvider.cs:43` |
| `RateLimitAlgorithm` | enum | MMCA.Common.API | `MMCA.Common.API.RateLimiting` | `MMCA.Common.API/RateLimiting/RateLimitAlgorithm.cs:8` |
| `RateLimitingSettings` | class | MMCA.Common.API | `MMCA.Common.API.RateLimiting` | `MMCA.Common.API/RateLimiting/RateLimitingSettings.cs:21` |
| `RedisFixedWindowRateLimiter` | class | MMCA.Common.API | `MMCA.Common.API.RateLimiting` | `MMCA.Common.API/RateLimiting/RedisFixedWindowRateLimiter.cs:37` |
| `RedisRateLimitLease` | class | MMCA.Common.API | `MMCA.Common.API.RateLimiting` | `MMCA.Common.API/RateLimiting/RedisFixedWindowRateLimiter.cs:169` |
| `ErrorResources` | class | MMCA.Common.API | `MMCA.Common.API.Resources` | `MMCA.Common.API/Resources/ErrorResources.cs:9` |
| `CookieSessionRefresher` | class | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:51` |
| `CookieSessionRefreshMiddleware` | class | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/CookieSessionRefreshMiddleware.cs:13` |
| `CookieSessionRefreshMiddlewareExtensions` | class | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/CookieSessionRefreshMiddleware.cs:35` |
| `CookieTokenReader` | class | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/CookieTokenReader.cs:10` |
| `ICookieSessionRefresher` | interface | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:29` |
| `SessionCookieAuthenticationExtensions` | class | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/SessionCookieAuthenticationHandler.cs:90` |
| `SessionCookieAuthenticationHandler` | class | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/SessionCookieAuthenticationHandler.cs:24` |
| `SessionCookieEndpoints` | class | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:15` |
| `SessionCookieJar` | class | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/SessionCookieJar.cs:11` |
| `SessionCookieRequest` | record | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:72` |
| `SessionTokenResponse` | record | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:20` |
| `SessionTokenResult` | record struct | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:14` |
| `AppAssociationEndpointExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/AppAssociationEndpointExtensions.cs:15` |
| `AppAssociationOptions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/AppAssociationOptions.cs:9` |
| `DatabaseInitializationExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:21` |
| `InsecureJwtMetadataWarningStartupFilter` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/InsecureJwtMetadataWarningStartupFilter.cs:15` |
| `JwksEndpointExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/JwksEndpointExtensions.cs:15` |
| `MiddlewarePipelineBuilder` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/MiddlewarePipelineBuilder.cs:15` |
| `MiddlewarePipelineStep` | record | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/MiddlewarePipelineStep.cs:21` |
| `MiddlewarePipelineStepNames` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/MiddlewarePipelineStepNames.cs:14` |
| `MiniProfilerExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/MiniProfilerExtensions.cs:9` |
| `OidcDiscoveryEndpointExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/OidcDiscoveryEndpointExtensions.cs:22` |
| `OpenApiEndpointExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/OpenApiEndpointExtensions.cs:22` |
| `SignalRExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/SignalRExtensions.cs:12` |
| `WebApplicationBuilderExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:31` |
| `WebApplicationExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/WebApplicationExtensions.cs:14` |
| `FakeCategoriesController` | class | MMCA.Common.API.Tests | `Fakes.MMCA.Store.Catalog.API.Controllers` | `MMCA.Common.API.Tests/Fakes/FakeCategoriesController.cs:7` |
| `DependencyInjectionTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests` | `MMCA.Common.API.Tests/DependencyInjectionTests.cs:18` |
| `ModuleControllerFeatureProviderTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests` | `MMCA.Common.API.Tests/ModuleControllerFeatureProviderTests.cs:8` |
| `ExternalAuthExtensionsTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Authentication` | `MMCA.Common.API.Tests/Authentication/ExternalAuthExtensionsTests.cs:20` |
| `AuthorizationExtensionsTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Authorization` | `MMCA.Common.API.Tests/Authorization/AuthorizationExtensionsTests.cs:11` |
| `OwnerOrAdminFilterTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Authorization` | `MMCA.Common.API.Tests/Authorization/OwnerOrAdminFilterTests.cs:14` |
| `OwnershipHelperTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Authorization` | `MMCA.Common.API.Tests/Authorization/OwnershipHelperTests.cs:11` |
| `PermissionAuthorizationHandlerTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Authorization` | `MMCA.Common.API.Tests/Authorization/PermissionAuthorizationHandlerTests.cs:9` |
| `PermissionPolicyProviderTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Authorization` | `MMCA.Common.API.Tests/Authorization/PermissionPolicyProviderTests.cs:8` |
| `TestOwnerSpecification` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Authorization` | `MMCA.Common.API.Tests/Authorization/OwnershipHelperTests.cs:16` |
| `OutputCacheEvictionHandlerTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Caching` | `MMCA.Common.API.Tests/Caching/OutputCacheEvictionHandlerTests.cs:20` |
| `PublicEndpointOutputCachePolicyTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Caching` | `MMCA.Common.API.Tests/Caching/PublicEndpointOutputCachePolicyTests.cs:9` |
| `RecordingLogger` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Caching` | `MMCA.Common.API.Tests/Caching/OutputCacheEvictionHandlerTests.cs:124` |
| `ConcurrencyETagTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Concurrency` | `MMCA.Common.API.Tests/Concurrency/ConcurrencyETagTests.cs:10` |
| `SupportsIfMatchAttributeTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Concurrency` | `MMCA.Common.API.Tests/Concurrency/SupportsIfMatchAttributeTests.cs:17` |
| `UpdateThingRequest` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Concurrency` | `MMCA.Common.API.Tests/Concurrency/SupportsIfMatchAttributeTests.cs:23` |
| `AggregateRootEntityControllerBaseTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/AggregateRootEntityControllerBaseTests.cs:17` |
| `ApiControllerBaseTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/ApiControllerBaseTests.cs:9` |
| `AuthControllerBaseRateLimitTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/AuthControllerBaseRateLimitTests.cs:21` |
| `AuthControllerBaseTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/AuthControllerBaseTests.cs:13` |
| `EntityControllerBaseETagTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseETagTests.cs:22` |
| `EntityControllerBaseExportColumnTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseExportTests.cs:653` |
| `EntityControllerBaseExportTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseExportTests.cs:24` |
| `EntityControllerBaseTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseTests.cs:18` |
| `ExportMoney` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseExportTests.cs:642` |
| `ExportShapeTestController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseExportTests.cs:604` |
| `ExportShapeTestDTO` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseExportTests.cs:626` |
| `ExportTestController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseExportTests.cs:495` |
| `ExportTestDTO` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseExportTests.cs:611` |
| `ExportTestEntity` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseExportTests.cs:609` |
| `Mocks` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/OAuthControllerBaseTests.cs:32` |
| `OAuthControllerBaseTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/OAuthControllerBaseTests.cs:26` |
| `OverridingAuthController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/AuthControllerBaseRateLimitTests.cs:87` |
| `PasswordResetAuthControllerBaseTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/PasswordResetAuthControllerBaseTests.cs:23` |
| `PlainDTO` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseETagTests.cs:168` |
| `PlainEntity` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseETagTests.cs:165` |
| `PlainEntityController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseETagTests.cs:181` |
| `ScopedExportTestController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseExportTests.cs:504` |
| `SingleServiceProvider` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/OAuthControllerBaseTests.cs:628` |
| `SpecificationHonoringQueryService` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseExportTests.cs:518` |
| `TestAggDTO` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/AggregateRootEntityControllerBaseTests.cs:151` |
| `TestAggregateEntity` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/AggregateRootEntityControllerBaseTests.cs:149` |
| `TestAggregateRootController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/AggregateRootEntityControllerBaseTests.cs:141` |
| `TestApiController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/ApiControllerBaseTests.cs:180` |
| `TestAuthController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/AuthControllerBaseTests.cs:180` |
| `TestChangePasswordCommand` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/UserAccountAuthControllerBaseTests.cs:242` |
| `TestChangePreferencesCommand` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/UserAccountAuthControllerBaseTests.cs:249` |
| `TestCreateRequest` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/AggregateRootEntityControllerBaseTests.cs:156` |
| `TestDTO` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseTests.cs:345` |
| `TestEntity` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseTests.cs:343` |
| `TestEntityController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseTests.cs:332` |
| `TestForgotPasswordCommand` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/PasswordResetAuthControllerBaseTests.cs:155` |
| `TestOAuthController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/OAuthControllerBaseTests.cs:638` |
| `TestPasswordResetController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/PasswordResetAuthControllerBaseTests.cs:165` |
| `TestResetPasswordCommand` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/PasswordResetAuthControllerBaseTests.cs:162` |
| `TestUserAccountAuthController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/UserAccountAuthControllerBaseTests.cs:252` |
| `UserAccountAuthControllerBaseTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/UserAccountAuthControllerBaseTests.cs:16` |
| `VersionedDTO` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseETagTests.cs:155` |
| `VersionedEntity` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseETagTests.cs:152` |
| `VersionedEntityController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseETagTests.cs:175` |
| `DevicesControllerTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers.Notifications` | `MMCA.Common.API.Tests/Controllers/Notifications/DevicesControllerTests.cs:17` |
| `NotificationInboxControllerTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers.Notifications` | `MMCA.Common.API.Tests/Controllers/Notifications/NotificationInboxControllerTests.cs:17` |
| `NotificationsControllerTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers.Notifications` | `MMCA.Common.API.Tests/Controllers/Notifications/NotificationsControllerTests.cs:16` |
| `DataExportControllerBaseTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers.Privacy` | `MMCA.Common.API.Tests/Controllers/Privacy/DataExportControllerBaseTests.cs:30` |
| `StubFeatureManager` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers.Privacy` | `MMCA.Common.API.Tests/Controllers/Privacy/DataExportControllerBaseTests.cs:245` |
| `SubjectSnapshot` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers.Privacy` | `MMCA.Common.API.Tests/Controllers/Privacy/DataExportControllerBaseTests.cs:243` |
| `TestDataExportController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers.Privacy` | `MMCA.Common.API.Tests/Controllers/Privacy/DataExportControllerBaseTests.cs:268` |
| `TestExportQuery` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers.Privacy` | `MMCA.Common.API.Tests/Controllers/Privacy/DataExportControllerBaseTests.cs:260` |
| `CsvWriterTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Export` | `MMCA.Common.API.Tests/Export/CsvWriterTests.cs:8` |
| `CurrentUserTargetingContextAccessorTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.FeatureManagement` | `MMCA.Common.API.Tests/FeatureManagement/CurrentUserTargetingContextAccessorTests.cs:14` |
| `DisabledFeatureHandlerTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.FeatureManagement` | `MMCA.Common.API.Tests/FeatureManagement/DisabledFeatureHandlerTests.cs:11` |
| `IdempotencyFilterPassthroughTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Idempotency` | `MMCA.Common.API.Tests/Idempotency/IdempotencyFilterPassthroughTests.cs:22` |
| `IdempotencyFilterTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Idempotency` | `MMCA.Common.API.Tests/Idempotency/IdempotencyFilterTests.cs:19` |
| `IdempotencySettingsTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Idempotency` | `MMCA.Common.API.Tests/Idempotency/IdempotencySettingsTests.cs:6` |
| `NonSeekableStream` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Idempotency` | `MMCA.Common.API.Tests/Idempotency/IdempotencyFilterTests.cs:972` |
| `TrackingHandle` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Idempotency` | `MMCA.Common.API.Tests/Idempotency/IdempotencyFilterTests.cs:1010` |
| `CurrencyJsonConverterTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.JsonConverters` | `MMCA.Common.API.Tests/JsonConverters/CurrencyJsonConverterTests.cs:9` |
| `EdgeErrorLocalizationTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Localization` | `MMCA.Common.API.Tests/Localization/EdgeErrorLocalizationTests.cs:16` |
| `ErrorLocalizerTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Localization` | `MMCA.Common.API.Tests/Localization/ErrorLocalizerTests.cs:13` |
| `StubErrorLocalizer` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Localization` | `MMCA.Common.API.Tests/Localization/EdgeErrorLocalizationTests.cs:18` |
| `TestController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Localization` | `MMCA.Common.API.Tests/Localization/EdgeErrorLocalizationTests.cs:24` |
| `CorrelationIdMiddlewareTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Middleware` | `MMCA.Common.API.Tests/Middleware/CorrelationIdMiddlewareTests.cs:10` |
| `ExceptionHandlerTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Middleware` | `MMCA.Common.API.Tests/Middleware/ExceptionHandlerTests.cs:13` |
| `SoftDeletedUserMiddlewareTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Middleware` | `MMCA.Common.API.Tests/Middleware/SoftDeletedUserMiddlewareTests.cs:13` |
| `TenantResolutionMiddlewareTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Middleware` | `MMCA.Common.API.Tests/Middleware/TenantResolutionMiddlewareTests.cs:17` |
| `TestDomainException` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Middleware` | `MMCA.Common.API.Tests/Middleware/ExceptionHandlerTests.cs:313` |
| `UnhandledResultFailureFilterTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Middleware` | `MMCA.Common.API.Tests/Middleware/UnhandledResultFailureFilterTests.cs:13` |
| `QueryFilterModelBinderTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.ModelBinders` | `MMCA.Common.API.Tests/ModelBinders/QueryFilterModelBinderTests.cs:9` |
| `ApiParameterDescriptorBackfillProviderTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.OpenApi` | `MMCA.Common.API.Tests/OpenApi/ApiParameterDescriptorBackfillProviderTests.cs:31` |
| `OpenApiBaselineTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.OpenApi` | `MMCA.Common.API.Tests/OpenApi/OpenApiBaselineTests.cs:35` |
| `OpenApiProbeHost` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.OpenApi` | `MMCA.Common.API.Tests/OpenApi/OpenApiProbeHost.cs:20` |
| `ProbeControllerFeatureProvider` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.OpenApi` | `MMCA.Common.API.Tests/OpenApi/OpenApiProbeHost.cs:65` |
| `ProblemDetailsProbeController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.OpenApi` | `MMCA.Common.API.Tests/OpenApi/OpenApiBaselineTests.cs:172` |
| `SegmentVersionedProbeController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.OpenApi` | `MMCA.Common.API.Tests/OpenApi/ApiParameterDescriptorBackfillProviderTests.cs:157` |
| `UnboundRouteTokenProbeController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.OpenApi` | `MMCA.Common.API.Tests/OpenApi/ApiParameterDescriptorBackfillProviderTests.cs:172` |
| `RateLimitingSettingsTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.RateLimiting` | `MMCA.Common.API.Tests/RateLimiting/RateLimitingSettingsTests.cs:13` |
| `RedisFixedWindowRateLimiterTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.RateLimiting` | `MMCA.Common.API.Tests/RateLimiting/RedisFixedWindowRateLimiterTests.cs:16` |
| `CookieSessionRefresherTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/CookieSessionRefresherTests.cs:24` |
| `CookieSessionRefreshMiddlewareTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/CookieSessionRefreshMiddlewareTests.cs:15` |
| `CookieTokenReaderTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/CookieTokenReaderTests.cs:14` |
| `NextDelegateSpy` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/CookieSessionRefreshMiddlewareTests.cs:144` |
| `RefresherHarness` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/CookieSessionRefresherTests.cs:335` |
| `SessionCookieAuthenticationHandlerTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/SessionCookieAuthenticationHandlerTests.cs:21` |
| `SessionCookieEndpointsTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/SessionCookieEndpointsTests.cs:20` |
| `SessionCookieJarTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/SessionCookieJarTests.cs:17` |
| `StubHttpClientFactory` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/CookieSessionRefresherTests.cs:364` |
| `StubHttpMessageHandler` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/CookieSessionRefresherTests.cs:370` |
| `StubRefresher` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/SessionCookieEndpointsTests.cs:145` |
| `AppAssociationEndpointTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/AppAssociationEndpointTests.cs:24` |
| `DatabaseInitializationExtensionsTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/DatabaseInitializationExtensionsTests.cs:29` |
| `FixedAssemblyProvider` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/DatabaseInitializationExtensionsTests.cs:94` |
| `ForwardedJwtBearerSecurityTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/ForwardedJwtBearerSecurityTests.cs:22` |
| `InitTestWidget` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/DatabaseInitializationExtensionsTests.cs:100` |
| `InitTestWidgetConfiguration` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/DatabaseInitializationExtensionsTests.cs:106` |
| `JwksEndpointTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/JwksEndpointTests.cs:26` |
| `MiddlewarePipelineBuilderTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/MiddlewarePipelineBuilderTests.cs:12` |
| `OidcDiscoveryEndpointTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/OidcDiscoveryEndpointTests.cs:20` |
| `RateLimitAlgorithmSelectionTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/RateLimitAlgorithmSelectionTests.cs:21` |
| `RateLimitPartitionTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/RateLimitPartitionTests.cs:16` |
| `StubHostEnvironment` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/ForwardedJwtBearerSecurityTests.cs:146` |
| `WebApplicationBuilderExtensionsTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/WebApplicationBuilderExtensionsTests.cs:14` |
| `AssemblyReference` | class | MMCA.Common.Application | `MMCA.Common.Application` | `MMCA.Common.Application/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.Common.Application | `MMCA.Common.Application` | `MMCA.Common.Application/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.Common.Application | `MMCA.Common.Application` | `MMCA.Common.Application/DependencyInjection.cs:22` |
| `AuditTrailEntryDTO` | record | MMCA.Common.Application | `MMCA.Common.Application.Auditing` | `MMCA.Common.Application/Auditing/AuditTrailEntryDTO.cs:12` |
| `AuthenticationServiceBase<TUser>` | class | MMCA.Common.Application | `MMCA.Common.Application.Auth` | `MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:34` |
| `AuthenticationValidators` | class | MMCA.Common.Application | `MMCA.Common.Application.Auth` | `MMCA.Common.Application/Auth/AuthenticationValidators.cs:16` |
| `IAuthenticationService` | interface | MMCA.Common.Application | `MMCA.Common.Application.Auth` | `MMCA.Common.Application/Auth/IAuthenticationService.cs:11` |
| `ILoginProtectionService` | interface | MMCA.Common.Application | `MMCA.Common.Application.Auth` | `MMCA.Common.Application/Auth/ILoginProtectionService.cs:10` |
| `IPasswordResetTokenService` | interface | MMCA.Common.Application | `MMCA.Common.Application.Auth` | `MMCA.Common.Application/Auth/IPasswordResetTokenService.cs:10` |
| `PasswordResetSettings` | class | MMCA.Common.Application | `MMCA.Common.Application.Auth` | `MMCA.Common.Application/Auth/PasswordResetSettings.cs:10` |
| `SoftDeletedUserCache` | class | MMCA.Common.Application | `MMCA.Common.Application.Auth` | `MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:17` |
| `ForgotPasswordRequestValidator` | class | MMCA.Common.Application | `MMCA.Common.Application.Auth.Validation` | `MMCA.Common.Application/Auth/Validation/ForgotPasswordRequestValidator.cs:11` |
| `LoginRequestValidator` | class | MMCA.Common.Application | `MMCA.Common.Application.Auth.Validation` | `MMCA.Common.Application/Auth/Validation/LoginRequestValidator.cs:11` |
| `RefreshTokenRequestValidator` | class | MMCA.Common.Application | `MMCA.Common.Application.Auth.Validation` | `MMCA.Common.Application/Auth/Validation/RefreshTokenRequestValidator.cs:10` |
| `ResetPasswordRequestValidator` | class | MMCA.Common.Application | `MMCA.Common.Application.Auth.Validation` | `MMCA.Common.Application/Auth/Validation/ResetPasswordRequestValidator.cs:12` |
| `SafeDomainEventHandler<TDomainEvent>` | class | MMCA.Common.Application | `MMCA.Common.Application.DomainEvents` | `MMCA.Common.Application/DomainEvents/SafeDomainEventHandler.cs:32` |
| `ReadRepositoryExtensions` | class | MMCA.Common.Application | `MMCA.Common.Application.Extensions` | `MMCA.Common.Application/Extensions/ReadRepositoryExtensions.cs:10` |
| `ValidationFailureExtensions` | class | MMCA.Common.Application | `MMCA.Common.Application.Extensions` | `MMCA.Common.Application/Extensions/ValidationFailureExtensions.cs:9` |
| `CacheKeyLocks` | class | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/ICacheService.cs:142` |
| `IAuditTrailReader` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IAuditTrailReader.cs:20` |
| `ICacheService` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/ICacheService.cs:10` |
| `ICorrelationContext` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/ICorrelationContext.cs:8` |
| `ICreateRequest` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/ICreateRequest.cs:8` |
| `IDistributedLock` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IDistributedLock.cs:30` |
| `IDomainEventDispatcher` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IDomainEventDispatcher.cs:8` |
| `IDomainEventHandler<in TDomainEvent>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IDomainEventHandler.cs:10` |
| `IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IEntityDTOMapper.cs:14` |
| `IEntityDTOProjector<TEntity, TEntityDTO, TIdentifierType>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IEntityDTOProjector.cs:51` |
| `IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IEntityQueryService.cs:19` |
| `IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IEntityDTOMapper.cs:42` |
| `IEventBus` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IEventBus.cs:11` |
| `IEventUpcaster` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IEventUpcaster.cs:28` |
| `IEventUpcaster<in TSource, out TTarget>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IEventUpcaster.cs:67` |
| `IEventUpcasterRegistry` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IEventUpcasterRegistry.cs:24` |
| `IIntegrationEventHandler<in TIntegrationEvent>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IIntegrationEventHandler.cs:15` |
| `INavigationMetadata` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/INavigationMetadata.cs:34` |
| `INavigationPopulator<in TEntity>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/INavigationPopulator.cs:9` |
| `IScheduledJob` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IScheduledJob.cs:36` |
| `ITenantContext` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/ITenantContext.cs:22` |
| `NavigationMetadata` | class | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/NavigationMetadata.cs:9` |
| `NavigationPropertyInfo` | record | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/INavigationMetadata.cs:23` |
| `NavigationType` | enum | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/INavigationMetadata.cs:6` |
| `DataSource` | enum | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IDataSourceService.cs:6` |
| `DataSourceKey` | record struct | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/DataSourceKey.cs:15` |
| `ICurrentUserService` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/ICurrentUserService.cs:9` |
| `IDataSourceService` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IDataSourceService.cs:24` |
| `IEmailSender` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IEmailSender.cs:6` |
| `IEntityConfigurationAssemblyProvider` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IEntityConfigurationAssemblyProvider.cs:10` |
| `IEntityQuerier<TEntity, TIdentifierType>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:80` |
| `IEntityReader<TEntity, TIdentifierType>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:21` |
| `IFileStorageService` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IFileStorageService.cs:11` |
| `IImageProcessor` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IImageProcessor.cs:11` |
| `ILiveChannelPublisher` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/ILiveChannelPublisher.cs:9` |
| `ImageContentSniffer` | class | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/ImageContentSniffer.cs:10` |
| `INativePushSender` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/INativePushSender.cs:10` |
| `INotificationRecipientProvider` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/INotificationRecipientProvider.cs:8` |
| `IPasswordHasher` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IPasswordHasher.cs:6` |
| `IPushDeviceRegistrar` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IPushDeviceRegistrar.cs:11` |
| `IPushNotificationSender` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IPushNotificationSender.cs:7` |
| `IQueryableExecutor` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IQueryableExecutor.cs:7` |
| `IReadRepository<TEntity, TIdentifierType>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:221` |
| `IRepository<TEntity, TIdentifierType>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:349` |
| `ISoftDeletedUserValidator` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/ISoftDeletedUserValidator.cs:7` |
| `ITokenService` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/ITokenService.cs:8` |
| `IUnitOfWork` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IUnitOfWork.cs:10` |
| `IUpdatePropertySetter<TEntity>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IUpdatePropertySetter.cs:13` |
| `IWriteRepository<TEntity, TIdentifierType>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:244` |
| `NullNotificationRecipientProvider` | class | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/NullNotificationRecipientProvider.cs:8` |
| `IMessageBus` | interface | MMCA.Common.Application | `MMCA.Common.Application.Messaging` | `MMCA.Common.Application/Messaging/IMessageBus.cs:28` |
| `IModule` | interface | MMCA.Common.Application | `MMCA.Common.Application.Modules` | `MMCA.Common.Application/Modules/IModule.cs:7` |
| `IModuleSeeder` | interface | MMCA.Common.Application | `MMCA.Common.Application.Modules` | `MMCA.Common.Application/Modules/IModuleSeeder.cs:8` |
| `ModuleLoader` | class | MMCA.Common.Application | `MMCA.Common.Application.Modules` | `MMCA.Common.Application/Modules/ModuleLoader.cs:15` |
| `DependencyInjection` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications` | `MMCA.Common.Application/Notifications/DependencyInjection.cs:26` |
| `PushNotificationDTOMapper` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications.PushNotifications.DTOs` | `MMCA.Common.Application/Notifications/PushNotifications/DTOs/PushNotificationDTOMapper.cs:12` |
| `PushNotificationDTOProjection` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications.PushNotifications.DTOs` | `MMCA.Common.Application/Notifications/PushNotifications/DTOs/PushNotificationDTOProjector.cs:22` |
| `PushNotificationDTOProjector` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications.PushNotifications.DTOs` | `MMCA.Common.Application/Notifications/PushNotifications/DTOs/PushNotificationDTOProjector.cs:35` |
| `GetNotificationHistoryHandler` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications.PushNotifications.UseCases.GetHistory` | `MMCA.Common.Application/Notifications/PushNotifications/UseCases/GetHistory/GetNotificationHistoryHandler.cs:15` |
| `GetNotificationHistoryQuery` | record | MMCA.Common.Application | `MMCA.Common.Application.Notifications.PushNotifications.UseCases.GetHistory` | `MMCA.Common.Application/Notifications/PushNotifications/UseCases/GetHistory/GetNotificationHistoryQuery.cs:6` |
| `SendPushNotificationCommand` | record | MMCA.Common.Application | `MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send` | `MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationCommand.cs:11` |
| `SendPushNotificationHandler` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send` | `MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:17` |
| `SendPushNotificationRequestValidator` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send` | `MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationRequestValidator.cs:12` |
| `GetMyNotificationsHandler` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetInbox` | `MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetInbox/GetMyNotificationsHandler.cs:16` |
| `GetMyNotificationsQuery` | record | MMCA.Common.Application | `MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetInbox` | `MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetInbox/GetMyNotificationsQuery.cs:11` |
| `GetUnreadNotificationCountHandler` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetUnreadCount` | `MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetUnreadCount/GetUnreadNotificationCountHandler.cs:13` |
| `GetUnreadNotificationCountQuery` | record | MMCA.Common.Application | `MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetUnreadCount` | `MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetUnreadCount/GetUnreadNotificationCountQuery.cs:9` |
| `MarkAllNotificationsReadCommand` | record | MMCA.Common.Application | `MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkAllRead` | `MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkAllRead/MarkAllNotificationsReadCommand.cs:10` |
| `MarkAllNotificationsReadHandler` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkAllRead` | `MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkAllRead/MarkAllNotificationsReadHandler.cs:12` |
| `MarkNotificationReadCommand` | record | MMCA.Common.Application | `MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkRead` | `MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkRead/MarkNotificationReadCommand.cs:6` |
| `MarkNotificationReadHandler` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkRead` | `MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkRead/MarkNotificationReadHandler.cs:12` |
| `BestEffort` | class | MMCA.Common.Application | `MMCA.Common.Application.Services` | `MMCA.Common.Application/Services/BestEffort.cs:25` |
| `BestEffortLog` | class | MMCA.Common.Application | `MMCA.Common.Application.Services` | `MMCA.Common.Application/Services/BestEffort.cs:79` |
| `BestEffortMetrics` | class | MMCA.Common.Application | `MMCA.Common.Application.Services` | `MMCA.Common.Application/Services/BestEffort.cs:99` |
| `DomainEventDispatcher` | class | MMCA.Common.Application | `MMCA.Common.Application.Services` | `MMCA.Common.Application/Services/DomainEventDispatcher.cs:23` |
| `EntityQueryService<TEntity, TEntityDTO, TIdentifierType>` | class | MMCA.Common.Application | `MMCA.Common.Application.Services` | `MMCA.Common.Application/Services/EntityQueryService.cs:31` |
| `EventUpcasterRegistry` | class | MMCA.Common.Application | `MMCA.Common.Application.Services` | `MMCA.Common.Application/Services/EventUpcasterRegistry.cs:30` |
| `NavigationLoader` | class | MMCA.Common.Application | `MMCA.Common.Application.Services` | `MMCA.Common.Application/Services/NavigationLoader.cs:21` |
| `NullNavigationPopulator<TEntity>` | class | MMCA.Common.Application | `MMCA.Common.Application.Services` | `MMCA.Common.Application/Services/NullNavigationPopulator.cs:11` |
| `PropertyAccessor` | record struct | MMCA.Common.Application | `MMCA.Common.Application.Services` | `MMCA.Common.Application/Services/QueryFieldService.cs:46` |
| `QueryFieldService` | class | MMCA.Common.Application | `MMCA.Common.Application.Services` | `MMCA.Common.Application/Services/QueryFieldService.cs:16` |
| `BoolFilterStrategy` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Filtering` | `MMCA.Common.Application/Services/Filtering/BoolFilterStrategy.cs:12` |
| `DateTimeFilterStrategy` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Filtering` | `MMCA.Common.Application/Services/Filtering/DateTimeFilterStrategy.cs:13` |
| `DecimalFilterStrategy` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Filtering` | `MMCA.Common.Application/Services/Filtering/DecimalFilterStrategy.cs:14` |
| `DynamicQueryConfig` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Filtering` | `MMCA.Common.Application/Services/Filtering/DynamicQueryConfig.cs:18` |
| `FilterValueParser` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Filtering` | `MMCA.Common.Application/Services/Filtering/FilterValueParser.cs:8` |
| `GuidFilterStrategy` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Filtering` | `MMCA.Common.Application/Services/Filtering/GuidFilterStrategy.cs:13` |
| `IFilterStrategy` | interface | MMCA.Common.Application | `MMCA.Common.Application.Services.Filtering` | `MMCA.Common.Application/Services/Filtering/IFilterStrategy.cs:6` |
| `IntFilterStrategy` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Filtering` | `MMCA.Common.Application/Services/Filtering/IntFilterStrategy.cs:15` |
| `LongFilterStrategy` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Filtering` | `MMCA.Common.Application/Services/Filtering/LongFilterStrategy.cs:14` |
| `QueryFilterService` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Filtering` | `MMCA.Common.Application/Services/Filtering/QueryFilterService.cs:19` |
| `StringFilterStrategy` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Filtering` | `MMCA.Common.Application/Services/Filtering/StringFilterStrategy.cs:12` |
| `ChildNavigationDescriptor<TEntity, TParentId, TChild, TChildId>` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Navigation` | `MMCA.Common.Application/Services/Navigation/ChildNavigationDescriptor.cs:15` |
| `DeclarativeNavigationPopulator<TEntity>` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Navigation` | `MMCA.Common.Application/Services/Navigation/DeclarativeNavigationPopulator.cs:14` |
| `FKNavigationDescriptor<TEntity, TChild, TChildId>` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Navigation` | `MMCA.Common.Application/Services/Navigation/FKNavigationDescriptor.cs:14` |
| `INavigationDescriptor<in TEntity>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Services.Navigation` | `MMCA.Common.Application/Services/Navigation/INavigationDescriptor.cs:10` |
| `EntityQueryParameters<TEntity>` | record | MMCA.Common.Application | `MMCA.Common.Application.Services.Query` | `MMCA.Common.Application/Services/Query/EntityQueryParameters.cs:11` |
| `EntityQueryPipeline` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Query` | `MMCA.Common.Application/Services/Query/EntityQueryPipeline.cs:13` |
| `IEntityQueryPipeline` | interface | MMCA.Common.Application | `MMCA.Common.Application.Services.Query` | `MMCA.Common.Application/Services/Query/IEntityQueryPipeline.cs:10` |
| `INavigationMetadataProvider` | interface | MMCA.Common.Application | `MMCA.Common.Application.Services.Query` | `MMCA.Common.Application/Services/Query/INavigationMetadataProvider.cs:9` |
| `NavigationMetadataProvider` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Query` | `MMCA.Common.Application/Services/Query/NavigationMetadataProvider.cs:20` |
| `PagingMath` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Query` | `MMCA.Common.Application/Services/Query/PagingMath.cs:20` |
| `ApplicationSettings` | class | MMCA.Common.Application | `MMCA.Common.Application.Settings` | `MMCA.Common.Application/Settings/ApplicationSettings.cs:8` |
| `IApplicationSettings` | interface | MMCA.Common.Application | `MMCA.Common.Application.Settings` | `MMCA.Common.Application/Settings/IApplicationSettings.cs:7` |
| `ModuleSettings` | class | MMCA.Common.Application | `MMCA.Common.Application.Settings` | `MMCA.Common.Application/Settings/ModuleSettings.cs:6` |
| `ModulesSettings` | class | MMCA.Common.Application | `MMCA.Common.Application.Settings` | `MMCA.Common.Application/Settings/ModulesSettings.cs:7` |
| `CrossSourceSpecification` | class | MMCA.Common.Application | `MMCA.Common.Application.Specifications` | `MMCA.Common.Application/Specifications/CrossSourceSpecification.cs:22` |
| `DeleteEntityCommand<TEntity, TIdentifierType>` | record | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/DeleteEntityCommand.cs:11` |
| `DeleteEntityHandler<TEntity, TIdentifierType>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/DeleteEntityHandler.cs:14` |
| `ICacheInvalidating` | interface | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/ICacheInvalidating.cs:8` |
| `ICommandHandler<in TCommand, TResult>` | interface | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/ICommandHandler.cs:9` |
| `ICommandWithRequest<out TRequest>` | interface | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/ICommandWithRequest.cs:14` |
| `IFeatureGated` | interface | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/IFeatureGated.cs:10` |
| `IHasTimeout` | interface | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/IHasTimeout.cs:14` |
| `IQueryCacheable` | interface | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/IQueryCacheable.cs:8` |
| `IQueryHandler<in TQuery, TResult>` | interface | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/IQueryHandler.cs:9` |
| `IRequiresPermission` | interface | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/IRequiresPermission.cs:16` |
| `ITransactional` | interface | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/ITransactional.cs:6` |
| `AuthorizationCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/AuthorizationCommandDecorator.cs:26` |
| `AuthorizationQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/AuthorizationQueryDecorator.cs:21` |
| `CachingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/CachingCommandDecorator.cs:32` |
| `CachingQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:34` |
| `CqrsMetrics` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/CqrsMetrics.cs:21` |
| `FeatureGateCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/FeatureGateCommandDecorator.cs:18` |
| `FeatureGateQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/FeatureGateQueryDecorator.cs:18` |
| `LoggingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/LoggingCommandDecorator.cs:14` |
| `LoggingQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/LoggingQueryDecorator.cs:13` |
| `ProfilingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/ProfilingCommandDecorator.cs:11` |
| `ProfilingQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/ProfilingQueryDecorator.cs:11` |
| `QueryCacheKeyLocks` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:194` |
| `ResultFailureFactory` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/ResultFailureFactory.cs:11` |
| `TenantCacheKey` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/TenantCacheKey.cs:25` |
| `TimeoutCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/TimeoutCommandDecorator.cs:33` |
| `TimeoutQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/TimeoutQueryDecorator.cs:33` |
| `TransactionalCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/TransactionalCommandDecorator.cs:18` |
| `ValidatingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/ValidatingCommandDecorator.cs:24` |
| `IUserOwnedRequest` | interface | MMCA.Common.Application | `MMCA.Common.Application.Users` | `MMCA.Common.Application/Users/IUserOwnedRequest.cs:8` |
| `IUserScopedCommand<out TRequest>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Users` | `MMCA.Common.Application/Users/IUserScopedCommand.cs:13` |
| `IUserScopedRequest` | interface | MMCA.Common.Application | `MMCA.Common.Application.Users` | `MMCA.Common.Application/Users/IUserScopedRequest.cs:8` |
| `SoftDeletedUserValidator<TUser>` | class | MMCA.Common.Application | `MMCA.Common.Application.Users` | `MMCA.Common.Application/Users/SoftDeletedUserValidator.cs:19` |
| `UserOwnershipRule` | class | MMCA.Common.Application | `MMCA.Common.Application.Users` | `MMCA.Common.Application/Users/UserOwnershipRule.cs:21` |
| `UserUseCaseLog` | class | MMCA.Common.Application | `MMCA.Common.Application.Users` | `MMCA.Common.Application/Users/UserUseCaseLog.cs:11` |
| `ChangePasswordHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application | `MMCA.Common.Application.Users.UseCases.ChangePassword` | `MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:24` |
| `ChangePreferencesHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application | `MMCA.Common.Application.Users.UseCases.ChangePreferences` | `MMCA.Common.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandlerBase.cs:23` |
| `DeleteUserHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application | `MMCA.Common.Application.Users.UseCases.DeleteUser` | `MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:38` |
| `ExportUserDataHandlerBase<TUser, TQuery>` | class | MMCA.Common.Application | `MMCA.Common.Application.Users.UseCases.ExportUserData` | `MMCA.Common.Application/Users/UseCases/ExportUserData/ExportUserDataHandlerBase.cs:49` |
| `IUserDataExportSection` | interface | MMCA.Common.Application | `MMCA.Common.Application.Users.UseCases.ExportUserData` | `MMCA.Common.Application/Users/UseCases/ExportUserData/IUserDataExportSection.cs:20` |
| `UserDataExportSectionDefaults` | class | MMCA.Common.Application | `MMCA.Common.Application.Users.UseCases.ExportUserData` | `MMCA.Common.Application/Users/UseCases/ExportUserData/IUserDataExportSection.cs:105` |
| `UserDataExportSectionResult` | record | MMCA.Common.Application | `MMCA.Common.Application.Users.UseCases.ExportUserData` | `MMCA.Common.Application/Users/UseCases/ExportUserData/IUserDataExportSection.cs:47` |
| `ForgotPasswordHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application | `MMCA.Common.Application.Users.UseCases.ForgotPassword` | `MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:35` |
| `GetUserPreferencesHandlerBase<TUser>` | class | MMCA.Common.Application | `MMCA.Common.Application.Users.UseCases.GetPreferences` | `MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandlerBase.cs:21` |
| `GetUserPreferencesQuery` | record | MMCA.Common.Application | `MMCA.Common.Application.Users.UseCases.GetPreferences` | `MMCA.Common.Application/Users/UseCases/GetPreferences/GetUserPreferencesQuery.cs:5` |
| `ResetPasswordHandlerBase<TUser, TCommand>` | class | MMCA.Common.Application | `MMCA.Common.Application.Users.UseCases.ResetPassword` | `MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:30` |
| `AddressLine1Rules<T>` | class | MMCA.Common.Application | `MMCA.Common.Application.Validation` | `MMCA.Common.Application/Validation/AddressValidationRules.cs:31` |
| `AddressLine2Rules<T>` | class | MMCA.Common.Application | `MMCA.Common.Application.Validation` | `MMCA.Common.Application/Validation/AddressValidationRules.cs:42` |
| `AddressValidator` | class | MMCA.Common.Application | `MMCA.Common.Application.Validation` | `MMCA.Common.Application/Validation/AddressValidationRules.cs:13` |
| `CityRules<T>` | class | MMCA.Common.Application | `MMCA.Common.Application.Validation` | `MMCA.Common.Application/Validation/AddressValidationRules.cs:52` |
| `CommandRequestValidator<TCommand, TRequest>` | class | MMCA.Common.Application | `MMCA.Common.Application.Validation` | `MMCA.Common.Application/Validation/CommandRequestValidator.cs:19` |
| `CountryRules<T>` | class | MMCA.Common.Application | `MMCA.Common.Application.Validation` | `MMCA.Common.Application/Validation/AddressValidationRules.cs:82` |
| `EmailRules<T>` | class | MMCA.Common.Application | `MMCA.Common.Application.Validation` | `MMCA.Common.Application/Validation/CommonValidationRules.cs:36` |
| `NonNegativeIntRules<T>` | class | MMCA.Common.Application | `MMCA.Common.Application.Validation` | `MMCA.Common.Application/Validation/CommonValidationRules.cs:71` |
| `OptionalStringRules<T>` | class | MMCA.Common.Application | `MMCA.Common.Application.Validation` | `MMCA.Common.Application/Validation/CommonValidationRules.cs:25` |
| `PasswordRules<T>` | class | MMCA.Common.Application | `MMCA.Common.Application.Validation` | `MMCA.Common.Application/Validation/CommonValidationRules.cs:83` |
| `PositiveDecimalRules<T>` | class | MMCA.Common.Application | `MMCA.Common.Application.Validation` | `MMCA.Common.Application/Validation/CommonValidationRules.cs:60` |
| `PositiveIntRules<T>` | class | MMCA.Common.Application | `MMCA.Common.Application.Validation` | `MMCA.Common.Application/Validation/CommonValidationRules.cs:49` |
| `RequiredStringRules<T>` | class | MMCA.Common.Application | `MMCA.Common.Application.Validation` | `MMCA.Common.Application/Validation/CommonValidationRules.cs:13` |
| `StateRules<T>` | class | MMCA.Common.Application | `MMCA.Common.Application.Validation` | `MMCA.Common.Application/Validation/AddressValidationRules.cs:62` |
| `StrongPasswordRules<T>` | class | MMCA.Common.Application | `MMCA.Common.Application.Validation` | `MMCA.Common.Application/Validation/CommonValidationRules.cs:97` |
| `ZipCodeRules<T>` | class | MMCA.Common.Application | `MMCA.Common.Application.Validation` | `MMCA.Common.Application/Validation/AddressValidationRules.cs:72` |
| `DependencyInjectionTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DependencyInjectionTests.cs:10` |
| `DomainEventDispatcherAdditionalTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherAdditionalTests.cs:11` |
| `DomainEventDispatcherTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherTests.cs:11` |
| `ImageContentSnifferTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/ImageContentSnifferTests.cs:12` |
| `MultiHandlerEvent` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherAdditionalTests.cs:76` |
| `MultiHandlerEventHandler1` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherAdditionalTests.cs:78` |
| `MultiHandlerEventHandler2` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherAdditionalTests.cs:89` |
| `NavigationMetadataTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/NavigationMetadataTests.cs:13` |
| `NullNotificationRecipientProviderTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/NullNotificationRecipientProviderTests.cs:9` |
| `RecordingDomainHandlerForRetired` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherAdditionalTests.cs:145` |
| `RecordingIntegrationHandler<TEvent>` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherAdditionalTests.cs:133` |
| `RetiredEvent` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherAdditionalTests.cs:121` |
| `RetiredToSuccessorUpcaster` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherAdditionalTests.cs:128` |
| `SuccessorEvent` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherAdditionalTests.cs:123` |
| `TestDomainEventHandlerForIntegration` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherAdditionalTests.cs:27` |
| `TestEvent` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherTests.cs:13` |
| `TestEventHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherTests.cs:17` |
| `TestIntegrationEvent` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherAdditionalTests.cs:14` |
| `TestIntegrationEvent` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherTests.cs:15` |
| `TestIntegrationEventDomainHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherTests.cs:28` |
| `TestIntegrationEventHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherAdditionalTests.cs:16` |
| `TestIntegrationEventHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherTests.cs:39` |
| `AuditTrailEntryDTOTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auditing` | `MMCA.Common.Application.Tests/Auditing/AuditTrailEntryDTOTests.cs:13` |
| `AuthenticationServiceBaseTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth` | `MMCA.Common.Application.Tests/Auth/AuthenticationServiceBaseTests.cs:22` |
| `AuthenticationValidatorsTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth` | `MMCA.Common.Application.Tests/Auth/AuthenticationValidatorsTests.cs:14` |
| `FixedTimeProvider` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth` | `MMCA.Common.Application.Tests/Auth/AuthenticationServiceBaseTests.cs:588` |
| `ServiceMocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth` | `MMCA.Common.Application.Tests/Auth/AuthenticationServiceBaseTests.cs:530` |
| `SoftDeletedUserCacheTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth` | `MMCA.Common.Application.Tests/Auth/SoftDeletedUserCacheTests.cs:13` |
| `TestAuthenticationService` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth` | `MMCA.Common.Application.Tests/Auth/AuthenticationServiceBaseTests.cs:631` |
| `TestAuthUser` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth` | `MMCA.Common.Application.Tests/Auth/AuthenticationServiceBaseTests.cs:598` |
| `ForgotPasswordRequestValidatorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth.Validation` | `MMCA.Common.Application.Tests/Auth/Validation/ForgotPasswordRequestValidatorTests.cs:7` |
| `LoginRequestValidatorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth.Validation` | `MMCA.Common.Application.Tests/Auth/Validation/LoginRequestValidatorTests.cs:7` |
| `RefreshTokenRequestValidatorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth.Validation` | `MMCA.Common.Application.Tests/Auth/Validation/RefreshTokenRequestValidatorTests.cs:7` |
| `ResetPasswordRequestValidatorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth.Validation` | `MMCA.Common.Application.Tests/Auth/Validation/ResetPasswordRequestValidatorTests.cs:7` |
| `AuthorizationCommandDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/AuthorizationCommandDecoratorTests.cs:11` |
| `AuthorizationQueryDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/AuthorizationQueryDecoratorTests.cs:11` |
| `BudgetedCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/TimeoutCommandDecoratorTests.cs:152` |
| `BudgetedQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/TimeoutQueryDecoratorTests.cs:130` |
| `CacheableTestQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingQueryDecoratorTests.cs:376` |
| `CacheDoubleCheckMetricQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingQueryDecoratorTests.cs:421` |
| `CacheHitMetricQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingQueryDecoratorTests.cs:415` |
| `CacheInvalidatingTestCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingCommandDecoratorTests.cs:254` |
| `CacheMissMetricQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingQueryDecoratorTests.cs:403` |
| `CachePipelineTestCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CommandDecoratorPipelineTests.cs:370` |
| `CacheReadCanceledQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingQueryDecoratorTests.cs:397` |
| `CacheReadFailureMetricQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingQueryDecoratorTests.cs:409` |
| `CacheReadFailureQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingQueryDecoratorTests.cs:391` |
| `CachingCommandDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingCommandDecoratorTests.cs:12` |
| `CachingDecoratorConstructorSelectionTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingDecoratorConstructorSelectionTests.cs:21` |
| `CachingDecoratorTenantScopingTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingDecoratorTenantScopingTests.cs:16` |
| `CachingQueryDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingQueryDecoratorTests.cs:12` |
| `CachingTestEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingCommandDecoratorTests.cs:264` |
| `CapturedCounter` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingQueryDecoratorTests.cs:18` |
| `CapturedMeasurement` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CqrsMetricsTests.cs:27` |
| `CommandDecoratorPipelineTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CommandDecoratorPipelineTests.cs:17` |
| `CqrsMetricsProbeCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CqrsMetricsTests.cs:221` |
| `CqrsMetricsProbeQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CqrsMetricsTests.cs:223` |
| `CqrsMetricsTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CqrsMetricsTests.cs:20` |
| `CtorProbeCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingDecoratorConstructorSelectionTests.cs:82` |
| `CtorProbeCommandHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingDecoratorConstructorSelectionTests.cs:87` |
| `CtorProbeQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingDecoratorConstructorSelectionTests.cs:93` |
| `CtorProbeQueryHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingDecoratorConstructorSelectionTests.cs:100` |
| `FeatureGateCommandDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/FeatureGateCommandDecoratorTests.cs:10` |
| `FeatureGatedCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/FeatureGateCommandDecoratorTests.cs:162` |
| `FeatureGatedCommandWithValue` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/FeatureGateCommandDecoratorTests.cs:167` |
| `FeatureGatedQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/FeatureGateQueryDecoratorTests.cs:143` |
| `FeatureGatedQueryNonGeneric` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/FeatureGateQueryDecoratorTests.cs:148` |
| `FeatureGateQueryDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/FeatureGateQueryDecoratorTests.cs:10` |
| `FullPipelineTestCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CommandDecoratorPipelineTests.cs:379` |
| `GuardedCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/AuthorizationCommandDecoratorTests.cs:147` |
| `GuardedCommandWithValue` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/AuthorizationCommandDecoratorTests.cs:152` |
| `GuardedQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/AuthorizationQueryDecoratorTests.cs:100` |
| `LoggingCommandDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/LoggingCommandDecoratorTests.cs:11` |
| `LoggingQueryDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/LoggingQueryDecoratorTests.cs:11` |
| `Mocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/LoggingCommandDecoratorTests.cs:14` |
| `Mocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/LoggingQueryDecoratorTests.cs:14` |
| `NonCacheableTestQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingQueryDecoratorTests.cs:374` |
| `NonTransactionalCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/TransactionalCommandDecoratorTests.cs:85` |
| `OptedOutCacheInvalidatingTestCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingCommandDecoratorTests.cs:259` |
| `PipelineTestCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CommandDecoratorPipelineTests.cs:367` |
| `PlainCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/FeatureGateCommandDecoratorTests.cs:160` |
| `PlainQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/FeatureGateQueryDecoratorTests.cs:141` |
| `PlainTestCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingCommandDecoratorTests.cs:252` |
| `ProfilingCommandDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/ProfilingCommandDecoratorTests.cs:9` |
| `ProfilingQueryDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/ProfilingQueryDecoratorTests.cs:9` |
| `ProfilingTestCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/ProfilingCommandDecoratorTests.cs:58` |
| `ProfilingTestQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/ProfilingQueryDecoratorTests.cs:59` |
| `ResultFailureFactoryTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/ResultFailureFactoryTests.cs:15` |
| `StampedeTestQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingQueryDecoratorTests.cs:382` |
| `TestLoggingCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/LoggingCommandDecoratorTests.cs:95` |
| `TestLoggingQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/LoggingQueryDecoratorTests.cs:81` |
| `TestValidatingCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/ValidatingCommandDecoratorTests.cs:211` |
| `TimeoutCommandDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/TimeoutCommandDecoratorTests.cs:9` |
| `TimeoutQueryDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/TimeoutQueryDecoratorTests.cs:9` |
| `TransactionalCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/TransactionalCommandDecoratorTests.cs:87` |
| `TransactionalCommandDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/TransactionalCommandDecoratorTests.cs:10` |
| `TransactionalPipelineTestCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CommandDecoratorPipelineTests.cs:376` |
| `UnbudgetedCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/TimeoutCommandDecoratorTests.cs:150` |
| `UnbudgetedQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/TimeoutQueryDecoratorTests.cs:128` |
| `UnguardedCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/AuthorizationCommandDecoratorTests.cs:145` |
| `UnguardedQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/AuthorizationQueryDecoratorTests.cs:98` |
| `ValidatingCommandDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/ValidatingCommandDecoratorTests.cs:12` |
| `RecordingLogger` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.DomainEvents` | `MMCA.Common.Application.Tests/DomainEvents/SafeDomainEventHandlerTests.cs:94` |
| `SafeDomainEventHandlerTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.DomainEvents` | `MMCA.Common.Application.Tests/DomainEvents/SafeDomainEventHandlerTests.cs:14` |
| `TestSafeDomainEvent` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.DomainEvents` | `MMCA.Common.Application.Tests/DomainEvents/SafeDomainEventHandlerTests.cs:88` |
| `TestSafeDomainEventHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.DomainEvents` | `MMCA.Common.Application.Tests/DomainEvents/SafeDomainEventHandlerTests.cs:124` |
| `ReadRepositoryExtensionsTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Extensions` | `MMCA.Common.Application.Tests/Extensions/ReadRepositoryExtensionsTests.cs:11` |
| `TestReadEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Extensions` | `MMCA.Common.Application.Tests/Extensions/ReadRepositoryExtensionsTests.cs:64` |
| `ValidationFailureExtensionsTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Extensions` | `MMCA.Common.Application.Tests/Extensions/ValidationFailureExtensionsTests.cs:8` |
| `CacheServiceGetOrCreateTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Interfaces` | `MMCA.Common.Application.Tests/Interfaces/CacheServiceGetOrCreateTests.cs:17` |
| `RecordingCacheService` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Interfaces` | `MMCA.Common.Application.Tests/Interfaces/CacheServiceGetOrCreateTests.cs:203` |
| `FakeConsumerModule` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Modules` | `MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:344` |
| `FakeCycleModuleOne` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Modules` | `MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:358` |
| `FakeCycleModuleTwo` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Modules` | `MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:370` |
| `FakeModuleAlpha` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Modules` | `MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:298` |
| `FakeModuleAlphaSeeder` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Modules` | `MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:307` |
| `FakeModuleBravo` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Modules` | `MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:288` |
| `FakeModuleCharlie` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Modules` | `MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:278` |
| `FakeModuleTracker` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Modules` | `MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:260` |
| `FakeRemoteContractRealAdapter` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Modules` | `MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:274` |
| `FakeRemoteContractStub` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Modules` | `MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:271` |
| `FakeStrictModule` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Modules` | `MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:319` |
| `FakeStubbedModule` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Modules` | `MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:332` |
| `IFakeRemoteContract` | interface | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Modules` | `MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:268` |
| `ModuleLoaderTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Modules` | `MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:19` |
| `FixedTimeProvider` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/MarkAllNotificationsReadHandlerTests.cs:161` |
| `FixedTimeProvider` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/MarkNotificationReadHandlerTests.cs:67` |
| `GetMyNotificationsHandlerTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/GetMyNotificationsHandlerTests.cs:13` |
| `GetNotificationHistoryHandlerTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/GetNotificationHistoryHandlerTests.cs:13` |
| `GetUnreadNotificationCountHandlerTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/GetUnreadNotificationCountHandlerTests.cs:11` |
| `HandlerMocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/GetUnreadNotificationCountHandlerTests.cs:148` |
| `HandlerMocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/MarkAllNotificationsReadHandlerTests.cs:166` |
| `HandlerMocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/MarkNotificationReadHandlerTests.cs:72` |
| `HandlerMocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/SendPushNotificationHandlerTests.cs:285` |
| `MarkAllNotificationsReadHandlerTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/MarkAllNotificationsReadHandlerTests.cs:11` |
| `MarkNotificationReadHandlerTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/MarkNotificationReadHandlerTests.cs:10` |
| `NotificationDependencyInjectionTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/NotificationDependencyInjectionTests.cs:21` |
| `PushNotificationDTOMapperTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/PushNotificationDTOMapperTests.cs:9` |
| `PushNotificationDTOProjectorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/PushNotificationDTOProjectorTests.cs:16` |
| `SendPushNotificationHandlerTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/SendPushNotificationHandlerTests.cs:15` |
| `SendPushNotificationRequestValidatorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/SendPushNotificationRequestValidatorTests.cs:10` |
| `BestEffortTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/BestEffortTests.cs:13` |
| `CacheProbeEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/QueryFieldServiceTests.cs:336` |
| `ChildA` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:64` |
| `ChildB` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:66` |
| `ChildC` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:68` |
| `ChildD` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:70` |
| `ChildNavigationDescriptorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/ChildNavigationDescriptorTests.cs:9` |
| `CustomerRenamedV1` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EventUpcasterRegistryTests.cs:23` |
| `CustomerRenamedV2` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EventUpcasterRegistryTests.cs:25` |
| `CustomerRenamedV3` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EventUpcasterRegistryTests.cs:30` |
| `DeclarativeNavigationPopulatorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/DeclarativeNavigationPopulatorTests.cs:9` |
| `EntityQueryParametersTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryParametersTests.cs:12` |
| `EntityQueryPipelineOrderingTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryPipelineOrderingTests.cs:16` |
| `EntityQueryPipelineTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryPipelineTests.cs:11` |
| `EntityQueryServiceProjectionTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceProjectionTests.cs:19` |
| `EntityQueryServiceResolutionTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceResolutionTests.cs:19` |
| `EntityQueryServiceTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceTests.cs:13` |
| `EnvelopeCopyingV1ToV2Upcaster` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EventUpcasterRegistryTests.cs:54` |
| `EventUpcasterRegistryTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EventUpcasterRegistryTests.cs:19` |
| `FakeEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceTests.cs:15` |
| `FakeEntityDTO` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceTests.cs:20` |
| `FakeEntityDTOMapper` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceTests.cs:236` |
| `FKNavigationDescriptorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/FKNavigationDescriptorTests.cs:9` |
| `InMemoryQueryableExecutor` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryPipelineOrderingTests.cs:126` |
| `InMemoryQueryableExecutor` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceProjectionTests.cs:245` |
| `InMemoryQueryableExecutor` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceTests.cs:219` |
| `MappedDto` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/QueryFieldServiceTests.cs:242` |
| `MappedEntityQueryService` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceTests.cs:245` |
| `MixedEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:38` |
| `NavigationLoaderTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationLoaderTests.cs:10` |
| `NavigationMetadataProviderTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:11` |
| `NavigationPopulatorStubEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/DeclarativeNavigationPopulatorTests.cs:199` |
| `NoNavEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:47` |
| `NullNavigationPopulatorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NullNavigationPopulatorTests.cs:8` |
| `OrderEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/ChildNavigationDescriptorTests.cs:11` |
| `OrderingTestEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryPipelineOrderingTests.cs:20` |
| `OrderLineEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/ChildNavigationDescriptorTests.cs:16` |
| `ParentEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/FKNavigationDescriptorTests.cs:11` |
| `ProductDto` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/QueryFieldServiceTests.cs:8` |
| `ProjectedEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceProjectionTests.cs:21` |
| `ProjectedEntityDTO` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceProjectionTests.cs:28` |
| `QueryFieldServiceTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/QueryFieldServiceTests.cs:6` |
| `QueryFieldServiceTieBreakTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/QueryFieldServiceTieBreakTests.cs:11` |
| `ReadOnlyCollectionEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:52` |
| `RecordingLogger` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/BestEffortTests.cs:143` |
| `RelatedA` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:58` |
| `RelatedB` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:60` |
| `RelatedC` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:62` |
| `RelatedEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/FKNavigationDescriptorTests.cs:16` |
| `ResolvedEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceResolutionTests.cs:21` |
| `ResolvedEntityDTO` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceResolutionTests.cs:26` |
| `ResolvedProjector` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceResolutionTests.cs:31` |
| `ResolvedProjectorMarker` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceResolutionTests.cs:94` |
| `RivalV1ToV3Upcaster` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EventUpcasterRegistryTests.cs:65` |
| `SelfMappingUpcaster` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EventUpcasterRegistryTests.cs:79` |
| `SortTestEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/QueryFieldServiceTieBreakTests.cs:13` |
| `SpyMapper` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceProjectionTests.cs:36` |
| `StubChild` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationLoaderTests.cs:204` |
| `StubEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NullNavigationPopulatorTests.cs:10` |
| `StubParent` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationLoaderTests.cs:199` |
| `SupportedChild` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:26` |
| `SupportedFK` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:14` |
| `TestableEntityQueryService` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceTests.cs:205` |
| `TestEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryParametersTests.cs:14` |
| `TestEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryPipelineTests.cs:20` |
| `TestProjector` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceProjectionTests.cs:56` |
| `UnrelatedEvent` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EventUpcasterRegistryTests.cs:35` |
| `UnsupportedChild` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:32` |
| `UnsupportedFK` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:20` |
| `V1ToV2Upcaster` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EventUpcasterRegistryTests.cs:38` |
| `V2ToV1Upcaster` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EventUpcasterRegistryTests.cs:72` |
| `V2ToV3Upcaster` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EventUpcasterRegistryTests.cs:44` |
| `BoolFilterStrategyTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/BoolFilterStrategyTests.cs:6` |
| `DateTimeFilterStrategyTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/DateTimeFilterStrategyTests.cs:6` |
| `DecimalFilterStrategyTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/DecimalFilterStrategyTests.cs:6` |
| `GuidFilterStrategyTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/GuidFilterStrategyTests.cs:6` |
| `IntFilterStrategyTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/IntFilterStrategyTests.cs:7` |
| `Item` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/BoolFilterStrategyTests.cs:8` |
| `Item` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/DateTimeFilterStrategyTests.cs:8` |
| `Item` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/DecimalFilterStrategyTests.cs:8` |
| `Item` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/GuidFilterStrategyTests.cs:8` |
| `Item` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/IntFilterStrategyTests.cs:9` |
| `Item` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/LongFilterStrategyTests.cs:8` |
| `Item` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/StringFilterStrategyTests.cs:8` |
| `LongFilterStrategyTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/LongFilterStrategyTests.cs:6` |
| `Product` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/QueryFilterServiceTests.cs:8` |
| `Product` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/QueryFilterServiceValidateTests.cs:9` |
| `QueryFilterServicePropertyCacheTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/QueryFilterServicePropertyCacheTests.cs:14` |
| `QueryFilterServiceTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/QueryFilterServiceTests.cs:6` |
| `QueryFilterServiceValidateTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/QueryFilterServiceValidateTests.cs:6` |
| `StringFilterStrategyTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/StringFilterStrategyTests.cs:6` |
| `TestStrategy` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/QueryFilterServiceTests.cs:252` |
| `Widget` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/QueryFilterServicePropertyCacheTests.cs:18` |
| `PagingMathTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Query` | `MMCA.Common.Application.Tests/Services/Query/PagingMathTests.cs:12` |
| `ApplicationSettingsTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Settings` | `MMCA.Common.Application.Tests/Settings/ApplicationSettingsTests.cs:8` |
| `ModulesSettingsTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Settings` | `MMCA.Common.Application.Tests/Settings/ModulesSettingsTests.cs:6` |
| `CrossSourceSpecificationTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Specifications` | `MMCA.Common.Application.Tests/Specifications/CrossSourceSpecificationTests.cs:10` |
| `Dependent` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Specifications` | `MMCA.Common.Application.Tests/Specifications/CrossSourceSpecificationTests.cs:12` |
| `Principal` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Specifications` | `MMCA.Common.Application.Tests/Specifications/CrossSourceSpecificationTests.cs:19` |
| `DeleteEntityHandlerTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.UseCases` | `MMCA.Common.Application.Tests/UseCases/DeleteEntityHandlerTests.cs:10` |
| `TestAggregateEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.UseCases` | `MMCA.Common.Application.Tests/UseCases/DeleteEntityHandlerTests.cs:96` |
| `CancellingSection` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ExportUserDataHandlerBaseTests.cs:320` |
| `ChangePasswordHandlerBaseTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ChangePasswordHandlerBaseTests.cs:15` |
| `ChangePreferencesHandlerBaseTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ChangePreferencesHandlerBaseTests.cs:16` |
| `DeleteUserHandlerBaseTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/DeleteUserHandlerBaseTests.cs:14` |
| `ExportUserDataHandlerBaseTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ExportUserDataHandlerBaseTests.cs:17` |
| `ForgotPasswordHandlerBaseTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ForgotPasswordHandlerBaseTests.cs:20` |
| `GetUserPreferencesHandlerBaseTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/GetUserPreferencesHandlerBaseTests.cs:14` |
| `HandlerMocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ChangePasswordHandlerBaseTests.cs:97` |
| `HandlerMocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ChangePreferencesHandlerBaseTests.cs:90` |
| `HandlerMocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/DeleteUserHandlerBaseTests.cs:177` |
| `HandlerMocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ExportUserDataHandlerBaseTests.cs:234` |
| `HandlerMocks` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ForgotPasswordHandlerBaseTests.cs:136` |
| `HandlerMocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/GetUserPreferencesHandlerBaseTests.cs:70` |
| `HandlerMocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ResetPasswordHandlerBaseTests.cs:137` |
| `RecordingSection` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ExportUserDataHandlerBaseTests.cs:289` |
| `ResetPasswordHandlerBaseTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ResetPasswordHandlerBaseTests.cs:18` |
| `SoftDeletedUserValidatorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/SoftDeletedUserValidatorTests.cs:13` |
| `TestChangePasswordCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/UserUseCaseTestDoubles.cs:109` |
| `TestChangePasswordHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ChangePasswordHandlerBaseTests.cs:122` |
| `TestChangePreferencesCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/UserUseCaseTestDoubles.cs:113` |
| `TestChangePreferencesHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ChangePreferencesHandlerBaseTests.cs:108` |
| `TestDeleteUserCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/UserUseCaseTestDoubles.cs:117` |
| `TestDeleteUserHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/DeleteUserHandlerBaseTests.cs:195` |
| `TestExportUserDataHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ExportUserDataHandlerBaseTests.cs:252` |
| `TestExportUserDataQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/UserUseCaseTestDoubles.cs:123` |
| `TestForgotPasswordCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ForgotPasswordHandlerBaseTests.cs:186` |
| `TestForgotPasswordHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ForgotPasswordHandlerBaseTests.cs:190` |
| `TestGetUserPreferencesHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/GetUserPreferencesHandlerBaseTests.cs:87` |
| `TestHidingDeleteUser` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/UserUseCaseTestDoubles.cs:96` |
| `TestIdentityUser` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/UserUseCaseTestDoubles.cs:13` |
| `TestResetPasswordCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ResetPasswordHandlerBaseTests.cs:172` |
| `TestResetPasswordHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ResetPasswordHandlerBaseTests.cs:176` |
| `ThrowingSection` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/ExportUserDataHandlerBaseTests.cs:309` |
| `UserOwnershipRuleTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Users` | `MMCA.Common.Application.Tests/Users/UserOwnershipRuleTests.cs:11` |
| `AddressValidationRulesTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/AddressValidationRulesTests.cs:8` |
| `CommandRequestValidatorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommandRequestValidatorTests.cs:9` |
| `CommonValidationRulesTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommonValidationRulesTests.cs:6` |
| `PermissiveTestRequestValidator` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommandRequestValidatorTests.cs:82` |
| `TestAddressModel` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/AddressValidationRulesTests.cs:155` |
| `TestCommandWithRequest` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommandRequestValidatorTests.cs:72` |
| `TestDecimalModel` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommonValidationRulesTests.cs:335` |
| `TestIntModel` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommonValidationRulesTests.cs:330` |
| `TestOptionalStringModel` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommonValidationRulesTests.cs:325` |
| `TestRequest` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommandRequestValidatorTests.cs:70` |
| `TestRequestValidator` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommandRequestValidatorTests.cs:74` |
| `TestStringModel` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommonValidationRulesTests.cs:320` |
| `AbstractAnonymousFixtureControllerBase` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/AnonymousEndpointTestsBaseTests.cs:84` |
| `AbstractFitnessControllerBase` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/IdempotencyFitnessTests.cs:71` |
| `AggregateConventionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/AggregateConventionTests.cs:9` |
| `AnonymousEndpointTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/AnonymousEndpointTests.cs:14` |
| `AnonymousEndpointTestsBaseTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/AnonymousEndpointTestsBaseTests.cs:13` |
| `AnonymousFixtureController` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/AnonymousEndpointTestsBaseTests.cs:74` |
| `CancellationTestMap` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/CancellationTokenFitnessTests.cs:63` |
| `CancellationTokenConventionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/CancellationTokenConventionTests.cs:10` |
| `CancellationTokenFitnessTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/CancellationTokenFitnessTests.cs:12` |
| `CommonArchitectureMap` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/CommonArchitectureMap.cs:15` |
| `ConformantTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/AnonymousEndpointTestsBaseTests.cs:126` |
| `CycleTestMap` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/NamespaceCycleFitnessTests.cs:52` |
| `DataSubjectSample` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/PiiErasureContractFitnessTests.cs:79` |
| `DependencyVersionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/DependencyVersionTests.cs:9` |
| `DisabledFakeExportService` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/ModuleConformanceTestsBaseTests.cs:28` |
| `DomainPurityTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/DomainPurityTests.cs:9` |
| `DriftedTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/AnonymousEndpointTestsBaseTests.cs:100` |
| `DriftedTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/ModuleConformanceTestsBaseTests.cs:131` |
| `EmptyScanTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/AnonymousEndpointTestsBaseTests.cs:117` |
| `EventScopeFitnessTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/EventScopeFitnessTests.cs:13` |
| `EventUpcasterFitnessTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/EventUpcasterFitnessTests.cs:12` |
| `EventVersioningConventionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/EventVersioningConventionTests.cs:12` |
| `FakeConsumerMap` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/EventScopeFitnessTests.cs:50` |
| `FakeDependentModule` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/ModuleConformanceTestsBaseTests.cs:31` |
| `FakeDependentModuleConformanceTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/ModuleConformanceTestsBaseTests.cs:60` |
| `FakeLeafModule` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/ModuleConformanceTestsBaseTests.cs:15` |
| `FakeLeafModuleConformanceTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/ModuleConformanceTestsBaseTests.cs:51` |
| `FitnessDependent` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:48` |
| `FitnessPrincipal` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:57` |
| `FrameworkSanityTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/FrameworkSanityTests.cs:13` |
| `HandlerResultConventionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/HandlerResultConventionTests.cs:12` |
| `IdempotencyConventionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/IdempotencyConventionTests.cs:10` |
| `IdempotencyFitnessTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/IdempotencyFitnessTests.cs:12` |
| `IdempotencyTestMap` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/IdempotencyFitnessTests.cs:52` |
| `IdempotentFitnessController` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/IdempotencyFitnessTests.cs:61` |
| `IFakeExportService` | interface | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/ModuleConformanceTestsBaseTests.cs:25` |
| `InheritingFitnessController` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/IdempotencyFitnessTests.cs:81` |
| `InheritingFixtureController` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/AnonymousEndpointTestsBaseTests.cs:94` |
| `LayerDependencyTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/LayerDependencyTests.cs:9` |
| `LocalizationResourceTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/LocalizationResourceTests.cs:12` |
| `LocalizedTextConventionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/LocalizedTextConventionTests.cs:11` |
| `MicroserviceExtractionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/MicroserviceExtractionTests.cs:10` |
| `ModuleConformanceTestsBaseTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/ModuleConformanceTestsBaseTests.cs:86` |
| `NamespaceCycleFitnessTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/NamespaceCycleFitnessTests.cs:11` |
| `NamespaceCycleTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/NamespaceCycleTests.cs:9` |
| `NavigatingQuerySpec` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:76` |
| `NavigatingSpec` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:63` |
| `NavigationContractTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/NavigationContractTests.cs:17` |
| `NonIdempotentFitnessController` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/IdempotencyFitnessTests.cs:84` |
| `ObservabilityConventionTestsBaseTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/ObservabilityConventionTestsBaseTests.cs:14` |
| `PasswordHashingFitnessTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/PasswordHashingFitnessTests.cs:15` |
| `PiiConventionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/PiiConventionTests.cs:13` |
| `PiiErasureContractFitnessTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/PiiErasureContractFitnessTests.cs:19` |
| `ProtoContractFitnessTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/ProtoContractFitnessTests.cs:14` |
| `RawQueryableConventionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/RawQueryableConventionTests.cs:13` |
| `ScalarOnlyQuerySpec` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:89` |
| `ScalarOnlySpec` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:69` |
| `ServiceContractPurityTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/ServiceContractPurityTests.cs:11` |
| `SliceCohesionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/SliceCohesionTests.cs:10` |
| `SpecificationFitnessTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:13` |
| `SpecTestMap` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:40` |
| `StaleAllowListTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/AnonymousEndpointTestsBaseTests.cs:108` |
| `StateManagementConventionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/StateManagementConventionTests.cs:11` |
| `TypeLevelAnonymousFixtureController` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/AnonymousEndpointTestsBaseTests.cs:98` |
| `UIArchitectureConventionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/UIArchitectureConventionTests.cs:11` |
| `UndeclaredFitnessController` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/IdempotencyFitnessTests.cs:94` |
| `UpcasterTestMap` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/EventUpcasterFitnessTests.cs:74` |
| `CompliantFixtureService` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.CancellationFixtures` | `MMCA.Common.Architecture.Tests/CancellationFixtures/CancellationTokenFixtures.cs:6` |
| `ExemptableFixtureService` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.CancellationFixtures` | `MMCA.Common.Architecture.Tests/CancellationFixtures/CancellationTokenFixtures.cs:57` |
| `ExternalContractFixtureService` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.CancellationFixtures` | `MMCA.Common.Architecture.Tests/CancellationFixtures/CancellationTokenFixtures.cs:67` |
| `MisnamedTokenFixtureService` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.CancellationFixtures` | `MMCA.Common.Architecture.Tests/CancellationFixtures/CancellationTokenFixtures.cs:49` |
| `MisplacedTokenFixtureService` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.CancellationFixtures` | `MMCA.Common.Architecture.Tests/CancellationFixtures/CancellationTokenFixtures.cs:37` |
| `MissingTokenFixtureService` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.CancellationFixtures` | `MMCA.Common.Architecture.Tests/CancellationFixtures/CancellationTokenFixtures.cs:27` |
| `AcyclicConsumer` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.CycleFixtures.Acyclic` | `MMCA.Common.Architecture.Tests/CycleFixtures/Acyclic/AcyclicFixtures.cs:6` |
| `LeftModelBase` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.CycleFixtures.Left` | `MMCA.Common.Architecture.Tests/CycleFixtures/Left/LeftFixtures.cs:13` |
| `LeftService` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.CycleFixtures.Left` | `MMCA.Common.Architecture.Tests/CycleFixtures/Left/LeftFixtures.cs:6` |
| `RightModel` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.CycleFixtures.Right` | `MMCA.Common.Architecture.Tests/CycleFixtures/Right/RightFixtures.cs:6` |
| `FixtureBackwardsV1` | record | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.UpcasterFixtures.IntegrationEvents` | `MMCA.Common.Architecture.Tests/UpcasterFixtures/IntegrationEvents/EventUpcasterFixtures.cs:45` |
| `FixtureBackwardsV2` | record | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.UpcasterFixtures.IntegrationEvents` | `MMCA.Common.Architecture.Tests/UpcasterFixtures/IntegrationEvents/EventUpcasterFixtures.cs:48` |
| `FixtureBackwardsVersionUpcaster` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.UpcasterFixtures.IntegrationEvents` | `MMCA.Common.Architecture.Tests/UpcasterFixtures/IntegrationEvents/EventUpcasterFixtures.cs:78` |
| `FixtureCompliantV1` | record | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.UpcasterFixtures.IntegrationEvents` | `MMCA.Common.Architecture.Tests/UpcasterFixtures/IntegrationEvents/EventUpcasterFixtures.cs:15` |
| `FixtureCompliantV1ToV2Upcaster` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.UpcasterFixtures.IntegrationEvents` | `MMCA.Common.Architecture.Tests/UpcasterFixtures/IntegrationEvents/EventUpcasterFixtures.cs:54` |
| `FixtureCompliantV2` | record | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.UpcasterFixtures.IntegrationEvents` | `MMCA.Common.Architecture.Tests/UpcasterFixtures/IntegrationEvents/EventUpcasterFixtures.cs:18` |
| `FixtureCompliantV2ToV3Upcaster` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.UpcasterFixtures.IntegrationEvents` | `MMCA.Common.Architecture.Tests/UpcasterFixtures/IntegrationEvents/EventUpcasterFixtures.cs:60` |
| `FixtureCompliantV3` | record | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.UpcasterFixtures.IntegrationEvents` | `MMCA.Common.Architecture.Tests/UpcasterFixtures/IntegrationEvents/EventUpcasterFixtures.cs:24` |
| `FixtureContestedClaimUpcaster` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.UpcasterFixtures.IntegrationEvents` | `MMCA.Common.Architecture.Tests/UpcasterFixtures/IntegrationEvents/EventUpcasterFixtures.cs:66` |
| `FixtureContestedV1` | record | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.UpcasterFixtures.IntegrationEvents` | `MMCA.Common.Architecture.Tests/UpcasterFixtures/IntegrationEvents/EventUpcasterFixtures.cs:30` |
| `FixtureContestedV2` | record | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.UpcasterFixtures.IntegrationEvents` | `MMCA.Common.Architecture.Tests/UpcasterFixtures/IntegrationEvents/EventUpcasterFixtures.cs:33` |
| `FixtureContestedV3` | record | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.UpcasterFixtures.IntegrationEvents` | `MMCA.Common.Architecture.Tests/UpcasterFixtures/IntegrationEvents/EventUpcasterFixtures.cs:39` |
| `FixtureRivalClaimUpcaster` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests.UpcasterFixtures.IntegrationEvents` | `MMCA.Common.Architecture.Tests/UpcasterFixtures/IntegrationEvents/EventUpcasterFixtures.cs:72` |
| `DataProtectionExtensions` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire` | `MMCA.Common.Aspire/DataProtection/DataProtectionExtensions.cs:19` |
| `Extensions` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire` | `MMCA.Common.Aspire/Extensions.cs:28` |
| `GatewayCorsExtensions` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire` | `MMCA.Common.Aspire/GatewayCorsExtensions.cs:16` |
| `HealthCheckTags` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire` | `MMCA.Common.Aspire/HealthCheckTags.cs:6` |
| `KeyVaultConfigurationExtensions` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire` | `MMCA.Common.Aspire/Configuration/KeyVaultConfigurationExtensions.cs:21` |
| `DownstreamServiceHealthCheck` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Gateway` | `MMCA.Common.Aspire/Gateway/DownstreamServiceHealthCheck.cs:25` |
| `GatewayCorrelationExtensions` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Gateway` | `MMCA.Common.Aspire/Gateway/GatewayCorrelationMiddleware.cs:73` |
| `GatewayCorrelationMiddleware` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Gateway` | `MMCA.Common.Aspire/Gateway/GatewayCorrelationMiddleware.cs:27` |
| `GatewayDownstreamRegistry` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Gateway` | `MMCA.Common.Aspire/Gateway/GatewayHealthCheckExtensions.cs:124` |
| `GatewayHealthCheckExtensions` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Gateway` | `MMCA.Common.Aspire/Gateway/GatewayHealthCheckExtensions.cs:15` |
| `GatewayRateLimitingExtensions` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Gateway` | `MMCA.Common.Aspire/Gateway/GatewayRateLimitingExtensions.cs:31` |
| `GatewayRateLimitingSettings` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Gateway` | `MMCA.Common.Aspire/Gateway/GatewayRateLimitingSettings.cs:39` |
| `KestrelEndpointExtensions` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Kestrel` | `MMCA.Common.Aspire/Kestrel/KestrelEndpointExtensions.cs:24` |
| `KestrelListenerSpec` | record | MMCA.Common.Aspire | `MMCA.Common.Aspire.Kestrel` | `MMCA.Common.Aspire/Kestrel/KestrelEndpointExtensions.cs:132` |
| `CspPolicy` | record | MMCA.Common.Aspire | `MMCA.Common.Aspire.Security` | `MMCA.Common.Aspire/Security/SecurityHeaders.cs:57` |
| `ICspPolicyProvider` | interface | MMCA.Common.Aspire | `MMCA.Common.Aspire.Security` | `MMCA.Common.Aspire/Security/SecurityHeaders.cs:65` |
| `SecurityHeadersExtensions` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Security` | `MMCA.Common.Aspire/Security/SecurityHeaders.cs:154` |
| `SecurityHeadersMiddleware` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Security` | `MMCA.Common.Aspire/Security/SecurityHeaders.cs:94` |
| `SecurityHeadersSettings` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Security` | `MMCA.Common.Aspire/Security/SecurityHeaders.cs:18` |
| `StaticCspPolicyProvider` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Security` | `MMCA.Common.Aspire/Security/SecurityHeaders.cs:72` |
| `OutboxPollFilterProcessor` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Telemetry` | `MMCA.Common.Aspire/Telemetry/OutboxPollFilterProcessor.cs:15` |
| `IWarmupTask` | interface | MMCA.Common.Aspire | `MMCA.Common.Aspire.Warmup` | `MMCA.Common.Aspire/Warmup/IWarmupTask.cs:9` |
| `OpenIdConnectMetadataWarmupTask` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Warmup` | `MMCA.Common.Aspire/Warmup/OpenIdConnectMetadataWarmupTask.cs:21` |
| `SelfHttpWarmupTaskBase` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Warmup` | `MMCA.Common.Aspire/Warmup/SelfHttpWarmupTaskBase.cs:28` |
| `WarmupHostedService` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Warmup` | `MMCA.Common.Aspire/Warmup/WarmupHostedService.cs:28` |
| `WarmupReadinessGate` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Warmup` | `MMCA.Common.Aspire/Warmup/WarmupReadinessGate.cs:10` |
| `WarmupReadinessHealthCheck` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Warmup` | `MMCA.Common.Aspire/Warmup/WarmupReadinessHealthCheck.cs:9` |
| `Extensions` | class | MMCA.Common.Aspire.Hosting | `MMCA.Common.Aspire.Hosting` | `MMCA.Common.Aspire.Hosting/Extensions.cs:23` |
| `KeyVaultConfigurationExtensionsTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Configuration` | `MMCA.Common.Aspire.Tests/Configuration/KeyVaultConfigurationExtensionsTests.cs:27` |
| `SourceCollectingConfigurationManager` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Configuration` | `MMCA.Common.Aspire.Tests/Configuration/KeyVaultConfigurationExtensionsTests.cs:160` |
| `SourceCollectingHostApplicationBuilder` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Configuration` | `MMCA.Common.Aspire.Tests/Configuration/KeyVaultConfigurationExtensionsTests.cs:132` |
| `StubHostEnvironment` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Configuration` | `MMCA.Common.Aspire.Tests/Configuration/KeyVaultConfigurationExtensionsTests.cs:192` |
| `StubLoggingBuilder` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Configuration` | `MMCA.Common.Aspire.Tests/Configuration/KeyVaultConfigurationExtensionsTests.cs:203` |
| `StubMetricsBuilder` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Configuration` | `MMCA.Common.Aspire.Tests/Configuration/KeyVaultConfigurationExtensionsTests.cs:208` |
| `DataProtectionExtensionsTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.DataProtection` | `MMCA.Common.Aspire.Tests/DataProtection/DataProtectionExtensionsTests.cs:19` |
| `GatewayCorrelationMiddlewareTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Gateway` | `MMCA.Common.Aspire.Tests/Gateway/GatewayCorrelationMiddlewareTests.cs:15` |
| `GatewayCorsExtensionsTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Gateway` | `MMCA.Common.Aspire.Tests/Gateway/GatewayCorsExtensionsTests.cs:19` |
| `GatewayDownstreamHealthChecksTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Gateway` | `MMCA.Common.Aspire.Tests/Gateway/GatewayDownstreamHealthChecksTests.cs:16` |
| `GatewayRateLimitingTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Gateway` | `MMCA.Common.Aspire.Tests/Gateway/GatewayRateLimitingTests.cs:19` |
| `RecordingHttpResponseFeature` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Gateway` | `MMCA.Common.Aspire.Tests/Gateway/GatewayCorrelationMiddlewareTests.cs:106` |
| `StubHandler` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Gateway` | `MMCA.Common.Aspire.Tests/Gateway/GatewayDownstreamHealthChecksTests.cs:175` |
| `StubHostEnvironment` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Gateway` | `MMCA.Common.Aspire.Tests/Gateway/GatewayCorsExtensionsTests.cs:78` |
| `StubHttpClientFactory` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Gateway` | `MMCA.Common.Aspire.Tests/Gateway/GatewayDownstreamHealthChecksTests.cs:170` |
| `InfrastructureHealthChecksTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Health` | `MMCA.Common.Aspire.Tests/Health/InfrastructureHealthChecksTests.cs:16` |
| `KestrelEndpointExtensionsTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Kestrel` | `MMCA.Common.Aspire.Tests/Kestrel/KestrelEndpointExtensionsTests.cs:14` |
| `SecurityHeadersMiddlewareTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Security` | `MMCA.Common.Aspire.Tests/Security/SecurityHeadersMiddlewareTests.cs:16` |
| `StubCspProvider` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Security` | `MMCA.Common.Aspire.Tests/Security/SecurityHeadersMiddlewareTests.cs:102` |
| `StubWebHostEnvironment` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Security` | `MMCA.Common.Aspire.Tests/Security/SecurityHeadersMiddlewareTests.cs:107` |
| `MetricsInstrumentationToggleTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Telemetry` | `MMCA.Common.Aspire.Tests/Telemetry/MetricsInstrumentationToggleTests.cs:12` |
| `OutboxPollFilterProcessorTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Telemetry` | `MMCA.Common.Aspire.Tests/Telemetry/OutboxPollFilterProcessorTests.cs:12` |
| `TracesSampleRatioTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Telemetry` | `MMCA.Common.Aspire.Tests/Telemetry/TracesSampleRatioTests.cs:11` |
| `CapturingLogger` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Warmup` | `MMCA.Common.Aspire.Tests/Warmup/SelfHttpWarmupTaskBaseTests.cs:403` |
| `ConfigurableWarmupTask` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Warmup` | `MMCA.Common.Aspire.Tests/Warmup/SelfHttpWarmupTaskBaseTests.cs:330` |
| `FakeEnvironment` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Warmup` | `MMCA.Common.Aspire.Tests/Warmup/SelfHttpWarmupTaskBaseTests.cs:368` |
| `FakeLifetime` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Warmup` | `MMCA.Common.Aspire.Tests/Warmup/SelfHttpWarmupTaskBaseTests.cs:379` |
| `FakeServer` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Warmup` | `MMCA.Common.Aspire.Tests/Warmup/SelfHttpWarmupTaskBaseTests.cs:353` |
| `HangingTask` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Warmup` | `MMCA.Common.Aspire.Tests/Warmup/WarmupHostedServiceTests.cs:43` |
| `RecordingTask` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Warmup` | `MMCA.Common.Aspire.Tests/Warmup/WarmupHostedServiceTests.cs:21` |
| `SelfHttpWarmupTaskBaseTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Warmup` | `MMCA.Common.Aspire.Tests/Warmup/SelfHttpWarmupTaskBaseTests.cs:28` |
| `TestServerHost` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Warmup` | `MMCA.Common.Aspire.Tests/Warmup/SelfHttpWarmupTaskBaseTests.cs:429` |
| `ThrowingTask` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Warmup` | `MMCA.Common.Aspire.Tests/Warmup/WarmupHostedServiceTests.cs:34` |
| `WarmupHostedServiceTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Warmup` | `MMCA.Common.Aspire.Tests/Warmup/WarmupHostedServiceTests.cs:13` |
| `WarmupReadinessGateTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Warmup` | `MMCA.Common.Aspire.Tests/Warmup/WarmupReadinessGateTests.cs:10` |
| `WarmupReadinessHealthCheckTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Warmup` | `MMCA.Common.Aspire.Tests/Warmup/WarmupReadinessHealthCheckTests.cs:11` |
| `ActiveSpec` | class | MMCA.Common.Benchmarks | `MMCA.Common.Benchmarks` | `MMCA.Common.Benchmarks/SpecificationBenchmarks.cs:28` |
| `MinValueSpec` | class | MMCA.Common.Benchmarks | `MMCA.Common.Benchmarks` | `MMCA.Common.Benchmarks/SpecificationBenchmarks.cs:23` |
| `ProductRow` | class | MMCA.Common.Benchmarks | `MMCA.Common.Benchmarks` | `MMCA.Common.Benchmarks/QueryPipelineBenchmarks.cs:19` |
| `QueryPipelineBenchmarks` | class | MMCA.Common.Benchmarks | `MMCA.Common.Benchmarks` | `MMCA.Common.Benchmarks/QueryPipelineBenchmarks.cs:17` |
| `SampleItem` | class | MMCA.Common.Benchmarks | `MMCA.Common.Benchmarks` | `MMCA.Common.Benchmarks/SpecificationBenchmarks.cs:16` |
| `SpecificationBenchmarks` | class | MMCA.Common.Benchmarks | `MMCA.Common.Benchmarks` | `MMCA.Common.Benchmarks/SpecificationBenchmarks.cs:14` |
| `AssemblyReference` | class | MMCA.Common.Domain | `MMCA.Common.Domain` | `MMCA.Common.Domain/AssemblyReference.cs:8` |
| `ClassReference` | class | MMCA.Common.Domain | `MMCA.Common.Domain` | `MMCA.Common.Domain/AssemblyReference.cs:18` |
| `IdValueGeneratedAttribute` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Attributes` | `MMCA.Common.Domain/Attributes/IdValueGeneratedAttribute.cs:9` |
| `NavigationAttribute` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Attributes` | `MMCA.Common.Domain/Attributes/NavigationAttribute.cs:10` |
| `PiiAttribute` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Attributes` | `MMCA.Common.Domain/Attributes/PiiAttribute.cs:19` |
| `IAuthUser` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Auth` | `MMCA.Common.Domain/Auth/IAuthUser.cs:10` |
| `IErasableUser` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Auth` | `MMCA.Common.Domain/Auth/IErasableUser.cs:30` |
| `IPasswordChangeableUser` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Auth` | `MMCA.Common.Domain/Auth/IPasswordChangeableUser.cs:11` |
| `IUserPreferences` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Auth` | `MMCA.Common.Domain/Auth/IUserPreferences.cs:10` |
| `BaseDomainEvent` | record | MMCA.Common.Domain | `MMCA.Common.Domain.DomainEvents` | `MMCA.Common.Domain/DomainEvents/BaseDomainEvent.cs:26` |
| `BaseIntegrationEvent` | record | MMCA.Common.Domain | `MMCA.Common.Domain.DomainEvents` | `MMCA.Common.Domain/DomainEvents/BaseIntegrationEvent.cs:11` |
| `EntityChangedEvent<TIdentifierType>` | record | MMCA.Common.Domain | `MMCA.Common.Domain.DomainEvents` | `MMCA.Common.Domain/DomainEvents/EntityChangedEvent.cs:24` |
| `AuditableAggregateRootEntity<TIdentifierType>` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Entities` | `MMCA.Common.Domain/Entities/AuditableAggregateRootEntity.cs:13` |
| `AuditableBaseEntity<TIdentifierType>` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Entities` | `MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:13` |
| `BaseEntity<TIdentifierType>` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Entities` | `MMCA.Common.Domain/Entities/BaseEntity.cs:14` |
| `DomainEntityState` | enum | MMCA.Common.Domain | `MMCA.Common.Domain.Enums` | `MMCA.Common.Domain/Enums/DomainEntityState.cs:7` |
| `EntityTypeExtensions` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Extensions` | `MMCA.Common.Domain/Extensions/EntityTypeExtensions.cs:9` |
| `OutputCacheEvictionRequested` | record | MMCA.Common.Domain | `MMCA.Common.Domain.IntegrationEvents` | `MMCA.Common.Domain/IntegrationEvents/OutputCacheEvictionRequested.cs:27` |
| `IAggregateRoot` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Interfaces` | `MMCA.Common.Domain/Interfaces/IAggregateRoot.cs:9` |
| `IAnonymizable` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Interfaces` | `MMCA.Common.Domain/Interfaces/IAnonymizable.cs:22` |
| `IAuditableEntity` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Interfaces` | `MMCA.Common.Domain/Interfaces/IAuditableEntity.cs:8` |
| `IAuditedEntity` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Interfaces` | `MMCA.Common.Domain/Interfaces/IAuditedEntity.cs:34` |
| `IBaseEntity<TIdentifierType>` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Interfaces` | `MMCA.Common.Domain/Interfaces/IBaseEntity.cs:7` |
| `IDomainEvent` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Interfaces` | `MMCA.Common.Domain/Interfaces/IDomainEvent.cs:7` |
| `IIntegrationEvent` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Interfaces` | `MMCA.Common.Domain/Interfaces/IIntegrationEvent.cs:15` |
| `IRowVersioned` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Interfaces` | `MMCA.Common.Domain/Interfaces/IRowVersioned.cs:11` |
| `ISpecification<TEntity, TIdentifierType>` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Interfaces` | `MMCA.Common.Domain/Interfaces/ISpecification.cs:12` |
| `ITenantEntity` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Interfaces` | `MMCA.Common.Domain/Interfaces/ITenantEntity.cs:33` |
| `CommonInvariants` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Invariants` | `MMCA.Common.Domain/Invariants/CommonInvariants.cs:12` |
| `PushNotification` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Notifications.PushNotifications` | `MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:16` |
| `PushNotificationStatus` | enum | MMCA.Common.Domain | `MMCA.Common.Domain.Notifications.PushNotifications` | `MMCA.Common.Domain/Notifications/PushNotifications/PushNotificationStatus.cs:6` |
| `PushNotificationCreated` | record | MMCA.Common.Domain | `MMCA.Common.Domain.Notifications.PushNotifications.DomainEvents` | `MMCA.Common.Domain/Notifications/PushNotifications/DomainEvents/PushNotificationCreated.cs:11` |
| `PushNotificationInvariants` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Notifications.PushNotifications.Invariants` | `MMCA.Common.Domain/Notifications/PushNotifications/Invariants/PushNotificationInvariants.cs:10` |
| `UserNotification` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Notifications.UserNotifications` | `MMCA.Common.Domain/Notifications/UserNotifications/UserNotification.cs:12` |
| `PiiRedactor` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Privacy` | `MMCA.Common.Domain/Privacy/PiiRedactor.cs:24` |
| `RedactableProperty` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Privacy` | `MMCA.Common.Domain/Privacy/PiiRedactor.cs:123` |
| `AndSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Specifications` | `MMCA.Common.Domain/Specifications/Specification.cs:81` |
| `InlineSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Specifications` | `MMCA.Common.Domain/Specifications/Specification.cs:45` |
| `NotSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Specifications` | `MMCA.Common.Domain/Specifications/Specification.cs:128` |
| `OrderExpression` | record | MMCA.Common.Domain | `MMCA.Common.Domain.Specifications` | `MMCA.Common.Domain/Specifications/QuerySpecification.cs:150` |
| `OrSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Specifications` | `MMCA.Common.Domain/Specifications/Specification.cs:105` |
| `OwnedByUserSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Specifications` | `MMCA.Common.Domain/Specifications/OwnedByUserSpecification.cs:20` |
| `ParameterReplacer` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Specifications` | `MMCA.Common.Domain/Specifications/ParameterReplacer.cs:24` |
| `QuerySpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Specifications` | `MMCA.Common.Domain/Specifications/QuerySpecification.cs:38` |
| `Specification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Specifications` | `MMCA.Common.Domain/Specifications/Specification.cs:15` |
| `SpecificationComposer` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Specifications` | `MMCA.Common.Domain/Specifications/Specification.cs:146` |
| `SpecificationExtensions` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Specifications` | `MMCA.Common.Domain/Specifications/SpecificationExtensions.cs:30` |
| `DecoratedEntity` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Attributes` | `MMCA.Common.Domain.Tests/Attributes/IdValueGeneratedAttributeTests.cs:73` |
| `EntityWithNavigation` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Attributes` | `MMCA.Common.Domain.Tests/Attributes/NavigationAttributeTests.cs:74` |
| `IdValueGeneratedAttributeTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Attributes` | `MMCA.Common.Domain.Tests/Attributes/IdValueGeneratedAttributeTests.cs:6` |
| `NavigationAttributeTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Attributes` | `MMCA.Common.Domain.Tests/Attributes/NavigationAttributeTests.cs:6` |
| `UndecoratedEntity` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Attributes` | `MMCA.Common.Domain.Tests/Attributes/IdValueGeneratedAttributeTests.cs:75` |
| `BaseDomainEventTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.DomainEvents` | `MMCA.Common.Domain.Tests/DomainEvents/BaseDomainEventTests.cs:6` |
| `BaseIntegrationEventTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.DomainEvents` | `MMCA.Common.Domain.Tests/DomainEvents/BaseIntegrationEventTests.cs:6` |
| `EntityChangedEventTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.DomainEvents` | `MMCA.Common.Domain.Tests/DomainEvents/EntityChangedEventTests.cs:7` |
| `TestDomainEvent` | record | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.DomainEvents` | `MMCA.Common.Domain.Tests/DomainEvents/BaseDomainEventTests.cs:8` |
| `TestEntityChangedEvent` | record | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.DomainEvents` | `MMCA.Common.Domain.Tests/DomainEvents/EntityChangedEventTests.cs:63` |
| `TestGuidEntityChangedEvent` | record | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.DomainEvents` | `MMCA.Common.Domain.Tests/DomainEvents/EntityChangedEventTests.cs:67` |
| `TestIntegrationEvent` | record | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.DomainEvents` | `MMCA.Common.Domain.Tests/DomainEvents/BaseIntegrationEventTests.cs:49` |
| `AuditableAggregateRootEntityAdditionalTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Entities` | `MMCA.Common.Domain.Tests/Entities/AuditableAggregateRootEntityAdditionalTests.cs:6` |
| `AuditableAggregateRootEntityTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Entities` | `MMCA.Common.Domain.Tests/Entities/AuditableAggregateRootEntityTests.cs:6` |
| `AuditableBaseEntityAdditionalTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Entities` | `MMCA.Common.Domain.Tests/Entities/AuditableBaseEntityAdditionalTests.cs:6` |
| `AuditableBaseEntityTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Entities` | `MMCA.Common.Domain.Tests/Entities/AuditableBaseEntityTests.cs:6` |
| `BaseEntityTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Entities` | `MMCA.Common.Domain.Tests/Entities/BaseEntityTests.cs:7` |
| `ChildEntity` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Entities` | `MMCA.Common.Domain.Tests/Entities/AuditableAggregateRootEntityAdditionalTests.cs:8` |
| `GuidIdEntity` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Entities` | `MMCA.Common.Domain.Tests/Entities/BaseEntityTests.cs:13` |
| `StringIdEntity` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Entities` | `MMCA.Common.Domain.Tests/Entities/BaseEntityTests.cs:11` |
| `TestAggregate` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Entities` | `MMCA.Common.Domain.Tests/Entities/AuditableAggregateRootEntityAdditionalTests.cs:13` |
| `TestAggregate` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Entities` | `MMCA.Common.Domain.Tests/Entities/AuditableAggregateRootEntityTests.cs:10` |
| `TestDomainEvent` | record | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Entities` | `MMCA.Common.Domain.Tests/Entities/AuditableAggregateRootEntityTests.cs:8` |
| `TestEntity` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Entities` | `MMCA.Common.Domain.Tests/Entities/AuditableBaseEntityTests.cs:8` |
| `TestEntity` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Entities` | `MMCA.Common.Domain.Tests/Entities/BaseEntityTests.cs:9` |
| `UndeletableEntity` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Entities` | `MMCA.Common.Domain.Tests/Entities/AuditableBaseEntityAdditionalTests.cs:8` |
| `ValidatingAggregate` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Entities` | `MMCA.Common.Domain.Tests/Entities/AuditableAggregateRootEntityAdditionalTests.cs:27` |
| `EntityTypeExtensionsTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Extensions` | `MMCA.Common.Domain.Tests/Extensions/EntityTypeExtensionsTests.cs:8` |
| `EntityWithGeneratedId` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Extensions` | `MMCA.Common.Domain.Tests/Extensions/EntityTypeExtensionsTests.cs:11` |
| `EntityWithoutGeneratedId` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Extensions` | `MMCA.Common.Domain.Tests/Extensions/EntityTypeExtensionsTests.cs:13` |
| `OutputCacheEvictionRequestedTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.IntegrationEvents` | `MMCA.Common.Domain.Tests/IntegrationEvents/OutputCacheEvictionRequestedTests.cs:12` |
| `CommonInvariantsTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Invariants` | `MMCA.Common.Domain.Tests/Invariants/CommonInvariantsTests.cs:9` |
| `PushNotificationCreatedTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Notifications` | `MMCA.Common.Domain.Tests/Notifications/PushNotificationCreatedTests.cs:8` |
| `PushNotificationInvariantsTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Notifications` | `MMCA.Common.Domain.Tests/Notifications/PushNotificationInvariantsTests.cs:7` |
| `PushNotificationTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Notifications` | `MMCA.Common.Domain.Tests/Notifications/PushNotificationTests.cs:7` |
| `UserNotificationTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Notifications` | `MMCA.Common.Domain.Tests/Notifications/UserNotificationTests.cs:6` |
| `NoPii` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Privacy` | `MMCA.Common.Domain.Tests/Privacy/PiiRedactorTests.cs:27` |
| `PiiRedactorTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Privacy` | `MMCA.Common.Domain.Tests/Privacy/PiiRedactorTests.cs:12` |
| `Subject` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Privacy` | `MMCA.Common.Domain.Tests/Privacy/PiiRedactorTests.cs:14` |
| `AgeGreaterThanSpec` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationTests.cs:22` |
| `AgeGreaterThanSpecification` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationCompositionTests.cs:33` |
| `AgeRangeSpec` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationAdditionalTests.cs:22` |
| `CompositionTestEntity` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationCompositionTests.cs:20` |
| `DefaultsSpecification` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/QuerySpecificationTests.cs:23` |
| `FakeAnswer` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/OwnedByUserSpecificationTests.cs:12` |
| `FullyConfiguredSpecification` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/QuerySpecificationTests.cs:28` |
| `InvocationFinder` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationCompositionTests.cs:278` |
| `NameEqualsSpec` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationAdditionalTests.cs:16` |
| `NameStartsWithSpec` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationTests.cs:16` |
| `NameStartsWithSpecification` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationCompositionTests.cs:27` |
| `NegativePagingSpecification` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/QuerySpecificationTests.cs:46` |
| `OwnedByUserSpecificationTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/OwnedByUserSpecificationTests.cs:8` |
| `ParameterFinder` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationCompositionTests.cs:297` |
| `QuerySpecificationTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/QuerySpecificationTests.cs:14` |
| `QueryTestEntity` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/QuerySpecificationTests.cs:16` |
| `SpecificationAdditionalTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationAdditionalTests.cs:8` |
| `SpecificationCompositionTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationCompositionTests.cs:18` |
| `SpecificationTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationTests.cs:8` |
| `TestEntity` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationAdditionalTests.cs:10` |
| `TestEntity` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationTests.cs:10` |
| `DependencyInjection` | class | MMCA.Common.Grpc | `MMCA.Common.Grpc` | `MMCA.Common.Grpc/DependencyInjection.cs:15` |
| `ResultGrpcExtensions` | class | MMCA.Common.Grpc | `MMCA.Common.Grpc` | `MMCA.Common.Grpc/ResultGrpcExtensions.cs:27` |
| `ResultFailureException` | class | MMCA.Common.Grpc | `MMCA.Common.Grpc.Exceptions` | `MMCA.Common.Grpc/Exceptions/ResultFailureException.cs:16` |
| `GrpcResultExceptionInterceptor` | class | MMCA.Common.Grpc | `MMCA.Common.Grpc.Interceptors` | `MMCA.Common.Grpc/Interceptors/GrpcResultExceptionInterceptor.cs:19` |
| `JwtForwardingClientInterceptor` | class | MMCA.Common.Grpc | `MMCA.Common.Grpc.Interceptors` | `MMCA.Common.Grpc/Interceptors/JwtForwardingClientInterceptor.cs:19` |
| `CountingFailureHandler` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/ResilienceCircuitBreakerFaultInjectionTests.cs:63` |
| `DependencyInjectionTests` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/DependencyInjectionTests.cs:20` |
| `FakeClient` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/DependencyInjectionTests.cs:22` |
| `FakeGrpcClient` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/ResilienceHandlerTests.cs:17` |
| `FakeRequest` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/JwtForwardingClientInterceptorTests.cs:280` |
| `FakeResponse` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/JwtForwardingClientInterceptorTests.cs:282` |
| `FakeServerCallContext` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/GrpcResultExceptionInterceptorTests.cs:125` |
| `FakeStreamReader` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/JwtForwardingClientInterceptorTests.cs:284` |
| `FakeStreamWriter` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/JwtForwardingClientInterceptorTests.cs:291` |
| `GrpcResultExceptionInterceptorTests` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/GrpcResultExceptionInterceptorTests.cs:24` |
| `JwtForwardingClientInterceptorTests` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/JwtForwardingClientInterceptorTests.cs:19` |
| `ResilienceCircuitBreakerFaultInjectionTests` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/ResilienceCircuitBreakerFaultInjectionTests.cs:14` |
| `ResilienceHandlerTests` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/ResilienceHandlerTests.cs:13` |
| `ResultFailureExceptionTests` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/ResultFailureExceptionTests.cs:13` |
| `ResultGrpcExtensionsTests` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/ResultGrpcExtensionsTests.cs:14` |
| `AssemblyReference` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure` | `MMCA.Common.Infrastructure/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure` | `MMCA.Common.Infrastructure/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure` | `MMCA.Common.Infrastructure/DependencyInjection.cs:40` |
| `UseDatabaseAttribute` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure` | `MMCA.Common.Infrastructure/UseDatabaseAttribute.cs:22` |
| `UseDataSourceAttribute` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure` | `MMCA.Common.Infrastructure/UseDataSourceAttribute.cs:13` |
| `IJwksProvider` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Auth` | `MMCA.Common.Infrastructure/Auth/IJwksProvider.cs:11` |
| `LoginProtectionService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Auth` | `MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:19` |
| `LoginProtectionSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Auth` | `MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:9` |
| `PasswordResetEntry` | record | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Auth` | `MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:171` |
| `PasswordResetTokenService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Auth` | `MMCA.Common.Infrastructure/Auth/PasswordResetTokenService.cs:26` |
| `RsaJwksProvider` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Auth` | `MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:15` |
| `CacheKeyNamespace` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Caching` | `MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:41` |
| `CacheKeyPrefixOptions` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Caching` | `MMCA.Common.Infrastructure/Caching/CacheKeyPrefix.cs:28` |
| `CacheOptions` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Caching` | `MMCA.Common.Infrastructure/Caching/CacheOptions.cs:9` |
| `DistributedCacheService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Caching` | `MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:18` |
| `HybridCacheService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Caching` | `MMCA.Common.Infrastructure/Caching/HybridCacheService.cs:37` |
| `MemoryCacheService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Caching` | `MMCA.Common.Infrastructure/Caching/MemoryCacheService.cs:18` |
| `RedisPrefixScanner` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Caching` | `MMCA.Common.Infrastructure/Caching/RedisPrefixScanner.cs:24` |
| `InProcessDistributedLock` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Concurrency` | `MMCA.Common.Infrastructure/Concurrency/InProcessDistributedLock.cs:31` |
| `InProcessLockHandle` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Concurrency` | `MMCA.Common.Infrastructure/Concurrency/InProcessDistributedLock.cs:79` |
| `RedisDistributedLock` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Concurrency` | `MMCA.Common.Infrastructure/Concurrency/RedisDistributedLock.cs:24` |
| `RedisLockHandle` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Concurrency` | `MMCA.Common.Infrastructure/Concurrency/RedisDistributedLock.cs:88` |
| `JwtForwardingDelegatingHandler` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Http` | `MMCA.Common.Infrastructure/Http/JwtForwardingDelegatingHandler.cs:17` |
| `NotificationHub` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Hubs` | `MMCA.Common.Infrastructure/Hubs/NotificationHub.cs:17` |
| `BrokerMetrics` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Messaging` | `MMCA.Common.Infrastructure/Messaging/BrokerMetrics.cs:18` |
| `DefaultEntityConfigurationAssemblyProvider` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence` | `MMCA.Common.Infrastructure/Persistence/DefaultEntityConfigurationAssemblyProvider.cs:12` |
| `EFQueryableExecutor` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence` | `MMCA.Common.Infrastructure/Persistence/EFQueryableExecutor.cs:11` |
| `EntityConfigurationOptions` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence` | `MMCA.Common.Infrastructure/Persistence/EntityConfigurationOptions.cs:10` |
| `NamespaceConventions` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence` | `MMCA.Common.Infrastructure/Persistence/NamespaceConventions.cs:7` |
| `ProfilingHelper` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence` | `MMCA.Common.Infrastructure/Persistence/ProfilingHelper.cs:9` |
| `SoftDeleteFilterSql` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence` | `MMCA.Common.Infrastructure/Persistence/SoftDeleteFilterSql.cs:16` |
| `UnitOfWork` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence` | `MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:13` |
| `AuditTrailCleanupJob` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.AuditTrail` | `MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailCleanupJob.cs:48` |
| `AuditTrailEntry` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.AuditTrail` | `MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailEntry.cs:23` |
| `AuditTrailReader` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.AuditTrail` | `MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailReader.cs:35` |
| `AuditTrailSaveChangesInterceptor` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.AuditTrail` | `MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:62` |
| `CaptureContext` | record struct | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.AuditTrail` | `MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:541` |
| `PendingEntityKey` | record | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.AuditTrail` | `MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:550` |
| `EntityTypeBuilderExtensions` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeBuilderExtensions.cs:12` |
| `IndexBuilderExtensions` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration` | `MMCA.Common.Infrastructure/Persistence/Configuration/IndexBuilderExtensions.cs:10` |
| `EntityTypeConfiguration<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfiguration.cs:28` |
| `EntityTypeConfigurationBase<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationBase.cs:19` |
| `EntityTypeConfigurationCosmos<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationCosmos.cs:18` |
| `EntityTypeConfigurationSqlite<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationSqlite.cs:17` |
| `EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationSQLServer.cs:17` |
| `IEntityTypeConfigurationBase<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationBase.cs:14` |
| `IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationCosmos.cs:13` |
| `IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationSqlite.cs:13` |
| `IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationSQLServer.cs:13` |
| `PushNotificationConfiguration` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration.Notifications` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/Notifications/PushNotificationConfiguration.cs:16` |
| `UserNotificationConfiguration` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration.Notifications` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/Notifications/UserNotificationConfiguration.cs:15` |
| `CrossDataSourceDegradeConvention` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Conventions` | `MMCA.Common.Infrastructure/Persistence/Conventions/CrossDataSourceDegradeConvention.cs:33` |
| `SoftDeleteUniqueIndexConvention` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Conventions` | `MMCA.Common.Infrastructure/Persistence/Conventions/SoftDeleteUniqueIndexConvention.cs:24` |
| `EmailValueConverter` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Conversions` | `MMCA.Common.Infrastructure/Persistence/Conversions/EmailValueConverter.cs:33` |
| `EnumerationValueConverter<TEnumeration>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Conversions` | `MMCA.Common.Infrastructure/Persistence/Conversions/EnumerationValueConverter.cs:33` |
| `NullableEmailValueConverter` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Conversions` | `MMCA.Common.Infrastructure/Persistence/Conversions/EmailValueConverter.cs:60` |
| `NullableEnumerationValueConverter<TEnumeration>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Conversions` | `MMCA.Common.Infrastructure/Persistence/Conversions/EnumerationValueConverter.cs:62` |
| `NullablePhoneNumberValueConverter` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Conversions` | `MMCA.Common.Infrastructure/Persistence/Conversions/PhoneNumberValueConverter.cs:61` |
| `PhoneNumberValueConverter` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Conversions` | `MMCA.Common.Infrastructure/Persistence/Conversions/PhoneNumberValueConverter.cs:33` |
| `DataSourceResolver` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DataSources` | `MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceResolver.cs:13` |
| `EntityDataSourceRegistry` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DataSources` | `MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:21` |
| `IDataSourceResolver` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DataSources` | `MMCA.Common.Infrastructure/Persistence/DataSources/IDataSourceResolver.cs:15` |
| `IEntityDataSourceRegistry` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DataSources` | `MMCA.Common.Infrastructure/Persistence/DataSources/IEntityDataSourceRegistry.cs:11` |
| `PhysicalDataSource` | record | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DataSources` | `MMCA.Common.Infrastructure/Persistence/DataSources/PhysicalDataSource.cs:17` |
| `Snapshot` | record | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DataSources` | `MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:25` |
| `TenantDataSourceTarget` | record struct | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DataSources` | `MMCA.Common.Infrastructure/Persistence/DataSources/TenantDataSourceTargets.cs:13` |
| `TenantDataSourceTargets` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DataSources` | `MMCA.Common.Infrastructure/Persistence/DataSources/TenantDataSourceTargets.cs:40` |
| `ApplicationDbContext` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts` | `MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:39` |
| `CosmosDbContext` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts` | `MMCA.Common.Infrastructure/Persistence/DbContexts/CosmosDbContext.cs:14` |
| `DataSourceModelCacheKeyFactory` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts` | `MMCA.Common.Infrastructure/Persistence/DbContexts/DataSourceModelCacheKeyFactory.cs:16` |
| `DetectChangesScope` | struct | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts` | `MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:223` |
| `ModelBuilderExtensions` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts` | `MMCA.Common.Infrastructure/Persistence/DbContexts/ModelBuilderExtensions.cs:10` |
| `SqliteDbContext` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts` | `MMCA.Common.Infrastructure/Persistence/DbContexts/SqliteDbContext.cs:12` |
| `SQLServerDbContext` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts` | `MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:16` |
| `ValReturn<T>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts` | `MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:105` |
| `DesignTimeDbContextHelper` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:36` |
| `DesignTimeDbContextOptions` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextOptions.cs:11` |
| `ExplicitAssemblyProvider` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:126` |
| `NullDomainEventDispatcher` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:131` |
| `ApplicationDbContextEFFactory` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/ApplicationDbContextEFFactory.cs:14` |
| `DbContextFactory` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:39` |
| `DefaultCosmosDbContextFactory` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DefaultEngineDbContextFactories.cs:31` |
| `DefaultSqliteDbContextFactory` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DefaultEngineDbContextFactories.cs:22` |
| `DefaultSqlServerDbContextFactory` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DefaultEngineDbContextFactories.cs:13` |
| `IDbContextFactory` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/IDbContextFactory.cs:10` |
| `IdentityInsertGroup` | record | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:410` |
| `IPhysicalDbContextFactory` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/IPhysicalDbContextFactory.cs:15` |
| `PhysicalDbContextFactory` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/PhysicalDbContextFactory.cs:16` |
| `TransactionCommitAmbiguousException` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/TransactionCommitAmbiguousException.cs:22` |
| `DbSeeder` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/DbSeeder.cs:7` |
| `IDbSeeder` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/IDbSeeder.cs:7` |
| `IdentityModuleDbSeederBase<TUser>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeederBase.cs:38` |
| `SeedAccount` | record | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/SeedAccount.cs:17` |
| `EncryptedStringConverter` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Encryption` | `MMCA.Common.Infrastructure/Persistence/Encryption/EncryptedStringConverter.cs:72` |
| `EfInboxStore` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Inbox` | `MMCA.Common.Infrastructure/Persistence/Inbox/EfInboxStore.cs:18` |
| `IInboxStore` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Inbox` | `MMCA.Common.Infrastructure/Persistence/Inbox/IInboxStore.cs:9` |
| `InboxDisabledWarningService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Inbox` | `MMCA.Common.Infrastructure/Persistence/Inbox/InboxDisabledWarningService.cs:18` |
| `InboxMessage` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Inbox` | `MMCA.Common.Infrastructure/Persistence/Inbox/InboxMessage.cs:8` |
| `NoOpInboxStore` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Inbox` | `MMCA.Common.Infrastructure/Persistence/Inbox/NoOpInboxStore.cs:7` |
| `AggregateCapture` | record | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Interceptors` | `MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:349` |
| `AuditSaveChangesInterceptor` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Interceptors` | `MMCA.Common.Infrastructure/Persistence/Interceptors/AuditSaveChangesInterceptor.cs:13` |
| `CapturedState` | record | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Interceptors` | `MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:358` |
| `CrossTenantWriteException` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Interceptors` | `MMCA.Common.Infrastructure/Persistence/Interceptors/CrossTenantWriteException.cs:24` |
| `DeferredDispatch` | record | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Interceptors` | `MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:365` |
| `DomainEventSaveChangesInterceptor` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Interceptors` | `MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:38` |
| `TenantSaveChangesInterceptor` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Interceptors` | `MMCA.Common.Infrastructure/Persistence/Interceptors/TenantSaveChangesInterceptor.cs:36` |
| `IOutboxSignal` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Outbox` | `MMCA.Common.Infrastructure/Persistence/Outbox/IOutboxSignal.cs:8` |
| `OutboxCleanupService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Outbox` | `MMCA.Common.Infrastructure/Persistence/Outbox/OutboxCleanupService.cs:40` |
| `OutboxCycleResult` | record struct | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Outbox` | `MMCA.Common.Infrastructure/Persistence/Outbox/OutboxCycleResult.cs:19` |
| `OutboxFinalizer` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Outbox` | `MMCA.Common.Infrastructure/Persistence/Outbox/OutboxFinalizer.cs:12` |
| `OutboxMessage` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Outbox` | `MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:14` |
| `OutboxMetrics` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Outbox` | `MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMetrics.cs:15` |
| `OutboxProcessor` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Outbox` | `MMCA.Common.Infrastructure/Persistence/Outbox/OutboxProcessor.cs:54` |
| `OutboxSignal` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Outbox` | `MMCA.Common.Infrastructure/Persistence/Outbox/OutboxSignal.cs:15` |
| `EFReadRepository<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Repositories` | `MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:19` |
| `EFReadRepositoryDecorator<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Repositories` | `MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepositoryDecorator.cs:17` |
| `EFRepository<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Repositories` | `MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:23` |
| `EFRepositoryDecorator<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Repositories` | `MMCA.Common.Infrastructure/Persistence/Repositories/EFRepositoryDecorator.cs:14` |
| `KeysetQueryBuilder` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Repositories` | `MMCA.Common.Infrastructure/Persistence/Repositories/KeysetQueryBuilder.cs:22` |
| `SpecificationEvaluator` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Repositories` | `MMCA.Common.Infrastructure/Persistence/Repositories/SpecificationEvaluator.cs:20` |
| `UpdatePropertySetterBuilder<TEntity>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Repositories` | `MMCA.Common.Infrastructure/Persistence/Repositories/UpdatePropertySetterBuilder.cs:14` |
| `IRepositoryFactory` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Repositories.Factory` | `MMCA.Common.Infrastructure/Persistence/Repositories/Factory/IRepositoryFactory.cs:11` |
| `RepositoryFactory` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Repositories.Factory` | `MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:14` |
| `CosmosIntIdValueGenerator` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.ValueGenerators` | `MMCA.Common.Infrastructure/Persistence/ValueGenerators/CosmosIntIdValueGenerator.cs:16` |
| `JobClaim` | record | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Scheduling` | `MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:447` |
| `ScheduledJobEntry` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Scheduling` | `MMCA.Common.Infrastructure/Scheduling/ScheduledJobEntry.cs:20` |
| `ScheduledJobRunner` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Scheduling` | `MMCA.Common.Infrastructure/Scheduling/ScheduledJobRunner.cs:39` |
| `SchedulerMetrics` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Scheduling` | `MMCA.Common.Infrastructure/Scheduling/SchedulerMetrics.cs:16` |
| `AzureBlobFileStorageService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/AzureBlobFileStorageService.cs:15` |
| `AzureNotificationHubDeviceRegistrar` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/AzureNotificationHubDeviceRegistrar.cs:15` |
| `AzureNotificationHubNativePushSender` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/AzureNotificationHubNativePushSender.cs:14` |
| `BrokerEventBus` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/BrokerEventBus.cs:30` |
| `BrokerMessageBus` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/BrokerMessageBus.cs:24` |
| `ClaimBasedUserIdProvider` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/ClaimBasedUserIdProvider.cs:9` |
| `CorrelationContext` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/CorrelationContext.cs:9` |
| `CurrentUserService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/CurrentUserService.cs:13` |
| `DataSourceService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/DataSourceService.cs:12` |
| `EventUpcasterStartupValidator` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/EventUpcasterStartupValidator.cs:20` |
| `FaultIntegrationEventConsumer<TEvent>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/FaultIntegrationEventConsumer.cs:27` |
| `ImageSharpImageProcessor` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/ImageSharpImageProcessor.cs:14` |
| `InProcessEventBus` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/InProcessEventBus.cs:23` |
| `InProcessMessageBus` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/InProcessMessageBus.cs:19` |
| `IntegrationEventConsumer<TEvent>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/IntegrationEventConsumer.cs:26` |
| `IntegrationEventConsumerExtensions` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/IntegrationEventConsumerExtensions.cs:12` |
| `NativePushPayloads` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/NativePushPayloads.cs:10` |
| `NullFileStorageService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/NullFileStorageService.cs:11` |
| `NullLiveChannelPublisher` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/NullLiveChannelPublisher.cs:11` |
| `NullNativePushSender` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/NullNativePushSender.cs:10` |
| `NullPushDeviceRegistrar` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/NullPushDeviceRegistrar.cs:12` |
| `NullPushNotificationSender` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/NullPushNotificationSender.cs:10` |
| `PasswordHasher` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/PasswordHasher.cs:12` |
| `PeriodicBackgroundService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/PeriodicBackgroundService.cs:20` |
| `SignalRLiveChannelPublisher` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/SignalRLiveChannelPublisher.cs:12` |
| `SignalRPushNotificationSender` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/SignalRPushNotificationSender.cs:13` |
| `SmtpEmailSender` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/SmtpEmailSender.cs:12` |
| `TenantContext` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/TenantContext.cs:11` |
| `TokenService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/TokenService.cs:23` |
| `UpcastingIntegrationEventConsumer<TEvent>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/UpcastingIntegrationEventConsumer.cs:31` |
| `AuditTrailSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/AuditTrailSettings.cs:16` |
| `ConnectionStringSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/ConnectionStringSettings.cs:9` |
| `DataSourceEntrySettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/DataSourceEntrySettings.cs:19` |
| `DataSourcesSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/DataSourcesSettings.cs:13` |
| `FileStorageSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/FileStorageSettings.cs:10` |
| `IConnectionStringSettings` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/IConnectionStringSettings.cs:6` |
| `IJwtSettings` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/IJwSettings.cs:10` |
| `IPushNotificationSettings` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/IPushNotificationSettings.cs:6` |
| `ISmtpSettings` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/ISmtpSettings.cs:6` |
| `JwksSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/JwksSettings.cs:17` |
| `JwtSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/JwtSettings.cs:16` |
| `JwtSigningAlgorithm` | enum | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/JwtSigningAlgorithm.cs:18` |
| `MessageBusProvider` | enum | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/MessageBusSettings.cs:116` |
| `MessageBusSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/MessageBusSettings.cs:11` |
| `NativePushSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/NativePushSettings.cs:9` |
| `OutboxSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/OutboxSettings.cs:10` |
| `PersistenceSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/PersistenceSettings.cs:10` |
| `PushNotificationSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/PushNotificationSettings.cs:6` |
| `ScheduledJobOverrideSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/SchedulerSettings.cs:66` |
| `SchedulerSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/SchedulerSettings.cs:16` |
| `SmtpSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/SmtpSettings.cs:9` |
| `TenancySettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/TenancySettings.cs:50` |
| `TenancySettingsValidator` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/TenancySettingsValidator.cs:23` |
| `TenantDataSourceOverrideSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/TenancySettings.cs:138` |
| `TenantEntrySettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/TenancySettings.cs:121` |
| `TenantResolutionStrategy` | enum | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/TenancySettings.cs:6` |
| `DistributedCacheServiceRedisTests` | class | MMCA.Common.Infrastructure.Redis.Tests | `MMCA.Common.Infrastructure.Redis.Tests` | `MMCA.Common.Infrastructure.Redis.Tests/DistributedCacheServiceRedisTests.cs:27` |
| `HybridCacheServiceRedisTests` | class | MMCA.Common.Infrastructure.Redis.Tests | `MMCA.Common.Infrastructure.Redis.Tests` | `MMCA.Common.Infrastructure.Redis.Tests/HybridCacheServiceRedisTests.cs:35` |
| `DependencyInjectionAdditionalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests` | `MMCA.Common.Infrastructure.Tests/DependencyInjectionAdditionalTests.cs:12` |
| `DependencyInjectionBrokerMessagingTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests` | `MMCA.Common.Infrastructure.Tests/DependencyInjectionBrokerMessagingTests.cs:15` |
| `DependencyInjectionInfrastructureTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests` | `MMCA.Common.Infrastructure.Tests/DependencyInjectionInfrastructureTests.cs:15` |
| `DependencyInjectionPushNotificationsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests` | `MMCA.Common.Infrastructure.Tests/DependencyInjectionPushNotificationsTests.cs:11` |
| `DependencyInjectionTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests` | `MMCA.Common.Infrastructure.Tests/DependencyInjectionTests.cs:18` |
| `UseDataSourceAttributeTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests` | `MMCA.Common.Infrastructure.Tests/UseDataSourceAttributeTests.cs:6` |
| `FakeCacheService` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Auth` | `MMCA.Common.Infrastructure.Tests/Auth/LoginProtectionServiceTests.cs:291` |
| `FakeCacheService` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Auth` | `MMCA.Common.Infrastructure.Tests/Auth/PasswordResetTokenServiceTests.cs:222` |
| `LoginProtectionServiceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Auth` | `MMCA.Common.Infrastructure.Tests/Auth/LoginProtectionServiceTests.cs:14` |
| `PasswordResetTokenServiceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Auth` | `MMCA.Common.Infrastructure.Tests/Auth/PasswordResetTokenServiceTests.cs:18` |
| `RsaJwksProviderTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Auth` | `MMCA.Common.Infrastructure.Tests/Auth/RsaJwksProviderTests.cs:14` |
| `AddCommonHybridCacheTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Caching` | `MMCA.Common.Infrastructure.Tests/Caching/AddCommonHybridCacheTests.cs:18` |
| `CacheOptionsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Caching` | `MMCA.Common.Infrastructure.Tests/Caching/CacheOptionsTests.cs:6` |
| `DistributedCacheServiceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Caching` | `MMCA.Common.Infrastructure.Tests/Caching/DistributedCacheServiceTests.cs:13` |
| `FaultingHybridCache` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Caching` | `MMCA.Common.Infrastructure.Tests/Caching/HybridCacheServiceTests.cs:450` |
| `HybridCacheServiceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Caching` | `MMCA.Common.Infrastructure.Tests/Caching/HybridCacheServiceTests.cs:22` |
| `MemoryCacheServiceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Caching` | `MMCA.Common.Infrastructure.Tests/Caching/MemoryCacheServiceTests.cs:11` |
| `RecordingDistributedCache` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Caching` | `MMCA.Common.Infrastructure.Tests/Caching/HybridCacheServiceTests.cs:345` |
| `RecordingHybridCache` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Caching` | `MMCA.Common.Infrastructure.Tests/Caching/HybridCacheServiceTests.cs:400` |
| `WarningCountingLogger` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Caching` | `MMCA.Common.Infrastructure.Tests/Caching/DistributedCacheServiceTests.cs:117` |
| `InProcessDistributedLockTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Concurrency` | `MMCA.Common.Infrastructure.Tests/Concurrency/InProcessDistributedLockTests.cs:12` |
| `RedisDistributedLockTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Concurrency` | `MMCA.Common.Infrastructure.Tests/Concurrency/RedisDistributedLockTests.cs:15` |
| `NotificationHubTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Hubs` | `MMCA.Common.Infrastructure.Tests/Hubs/NotificationHubTests.cs:11` |
| `AllSpecification` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositorySpecificationTests.cs:208` |
| `AlwaysRetryExecutionStrategy` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryCommitAmbiguityTests.cs:336` |
| `ApplicationDbContextEFFactoryTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ApplicationDbContextEFFactoryTests.cs:10` |
| `ApplicationDbContextTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ApplicationDbContextTests.cs:19` |
| `AuditSaveChangesInterceptorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditSaveChangesInterceptorTests.cs:13` |
| `BbbSpecification` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryKeysetPagingTests.cs:266` |
| `BetaSpecification` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositorySpecificationTests.cs:213` |
| `BetaSpecification` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SpecificationEvaluatorTests.cs:193` |
| `CleanupTestContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxCleanupServiceTests.cs:567` |
| `CommitFailingDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryCommitAmbiguityTests.cs:267` |
| `CosmosIntIdValueGeneratorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/CosmosIntIdValueGeneratorTests.cs:6` |
| `DbContextFactoryAdditionalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryAdditionalTests.cs:18` |
| `DbContextFactoryCommitAmbiguityTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryCommitAmbiguityTests.cs:32` |
| `DbContextFactorySaveIntegrityTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactorySaveIntegrityTests.cs:27` |
| `DbContextFactoryTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryTests.cs:10` |
| `DbContextFactoryTransactionTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryTransactionTests.cs:28` |
| `DbSeederTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbSeederTests.cs:6` |
| `DefaultEntityConfigurationAssemblyProviderTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DefaultEntityConfigurationAssemblyProviderTests.cs:8` |
| `DeletedByNameSpecification` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositorySpecificationTests.cs:228` |
| `DetectionTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SaveChangeDetectionTests.cs:105` |
| `DomainEventCaptureExclusionTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventCaptureExclusionTests.cs:26` |
| `DomainEventSaveChangesInterceptorOutboxRoutingTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventSaveChangesInterceptorOutboxRoutingTests.cs:26` |
| `DomainEventSaveChangesInterceptorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventSaveChangesInterceptorTests.cs:17` |
| `EFQueryableExecutorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFQueryableExecutorTests.cs:11` |
| `EFReadRepositoryDecoratorAdditionalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryDecoratorAdditionalTests.cs:10` |
| `EFReadRepositoryDecoratorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryDecoratorTests.cs:11` |
| `EFReadRepositoryGetByIdFilterTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryGetByIdFilterTests.cs:17` |
| `EFReadRepositoryKeysetPagingTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryKeysetPagingTests.cs:16` |
| `EFReadRepositoryProjectedFilterTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryProjectedFilterTests.cs:16` |
| `EFReadRepositorySpecificationTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositorySpecificationTests.cs:16` |
| `EFRepositoryAdditionalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryAdditionalTests.cs:9` |
| `EFRepositoryAuditStampTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryAuditStampTests.cs:25` |
| `EFRepositoryDecoratorAdditionalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryDecoratorAdditionalTests.cs:10` |
| `EFRepositoryDecoratorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryDecoratorTests.cs:9` |
| `EFRepositoryIntegrationTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryIntegrationTests.cs:12` |
| `EmptyAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SQLServerDbContextTests.cs:76` |
| `EncryptedStringConverterTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EncryptedStringConverterTests.cs:6` |
| `EntityConfigurationOptionsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityConfigurationOptionsTests.cs:6` |
| `EntityTypeConfigurationBaseTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationBaseTests.cs:14` |
| `EntityTypeConfigurationTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationTests.cs:9` |
| `ExclusionAggregate` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventCaptureExclusionTests.cs:142` |
| `ExclusionEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventCaptureExclusionTests.cs:140` |
| `ExclusionTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventCaptureExclusionTests.cs:147` |
| `FailingDatabaseFacade` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryCommitAmbiguityTests.cs:322` |
| `FailingSaveInterceptor` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventSaveChangesInterceptorOutboxRoutingTests.cs:252` |
| `FakeAggregate` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/RepositoryFactoryTests.cs:123` |
| `FakeAggregate` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/UnitOfWorkAdditionalTests.cs:93` |
| `FakeAggregate` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/UnitOfWorkTests.cs:151` |
| `FakeAggregateEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryDecoratorAdditionalTests.cs:49` |
| `FakeAggregateEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryDecoratorTests.cs:64` |
| `FakeEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryDecoratorAdditionalTests.cs:93` |
| `FakeEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryDecoratorTests.cs:152` |
| `FakeEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/RepositoryFactoryTests.cs:128` |
| `FakeEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/UnitOfWorkAdditionalTests.cs:98` |
| `FakeEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/UnitOfWorkTests.cs:156` |
| `FakeTimeProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditSaveChangesInterceptorTests.cs:127` |
| `HighRankSpecification` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositorySpecificationTests.cs:218` |
| `IdentityModuleDbSeederBaseTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/IdentityModuleDbSeederBaseTests.cs:17` |
| `IncludingSoftDeletedSpecification` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositorySpecificationTests.cs:258` |
| `IncludingSpecification` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositorySpecificationTests.cs:244` |
| `IncludingSpecification` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SpecificationEvaluatorTests.cs:221` |
| `IntegrityAggregate` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactorySaveIntegrityTests.cs:129` |
| `IntegrityEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactorySaveIntegrityTests.cs:127` |
| `IntegrityTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactorySaveIntegrityTests.cs:134` |
| `MarkAllNotificationsReadHandlerTrackingTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/MarkAllNotificationsReadHandlerTrackingTests.cs:24` |
| `MidSaveContextCreatingDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryAdditionalTests.cs:200` |
| `Mocks` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxCleanupServiceTests.cs:44` |
| `Mocks` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/UnitOfWorkAdditionalTests.cs:13` |
| `Mocks` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/UnitOfWorkTests.cs:15` |
| `ModelBuilderExtensionsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ModelBuilderExtensionsTests.cs:12` |
| `NamedSoftDeleteTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryProjectedFilterTests.cs:94` |
| `NoMatchSpecification` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositorySpecificationTests.cs:223` |
| `NotificationTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/MarkAllNotificationsReadHandlerTrackingTests.cs:162` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditSaveChangesInterceptorTests.cs:187` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryCommitAmbiguityTests.cs:343` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactorySaveIntegrityTests.cs:184` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryTransactionTests.cs:282` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventCaptureExclusionTests.cs:184` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventSaveChangesInterceptorOutboxRoutingTests.cs:326` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventSaveChangesInterceptorTests.cs:219` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryAuditStampTests.cs:168` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxCleanupServiceTests.cs:624` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/QueryParameterizationTests.cs:149` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SaveChangeDetectionTests.cs:147` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SoftDeleteQueryFilterTests.cs:114` |
| `OrderedSpecification` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SpecificationEvaluatorTests.cs:198` |
| `OutboxCleanupServiceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxCleanupServiceTests.cs:31` |
| `OutboxMessageTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxMessageTests.cs:11` |
| `OutboxProcessorExecuteAsyncTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxProcessorExecuteAsyncTests.cs:20` |
| `OutboxProcessorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxProcessorTests.cs:31` |
| `OutboxProcessorWaitTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxProcessorWaitTests.cs:10` |
| `OutboxRoutingTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventSaveChangesInterceptorOutboxRoutingTests.cs:266` |
| `OutboxSignalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxSignalTests.cs:13` |
| `OutboxTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxProcessorTests.cs:965` |
| `PagedSpecification` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SpecificationEvaluatorTests.cs:228` |
| `PlainDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryAuditStampTests.cs:148` |
| `Product` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/QueryParameterizationTests.cs:99` |
| `ProfilingHelperTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ProfilingHelperTests.cs:10` |
| `ProjectedTestEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryProjectedFilterTests.cs:89` |
| `ProjectionTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/PushNotificationProjectionTranslationTests.cs:108` |
| `PushNotificationProjectionTranslationTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/PushNotificationProjectionTranslationTests.cs:15` |
| `QueryParameterizationTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/QueryParameterizationTests.cs:26` |
| `QueryShapeTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/QueryParameterizationTests.cs:106` |
| `RankDescendingSpecification` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SpecificationEvaluatorTests.cs:209` |
| `ReentrantSaveInterceptor` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryAdditionalTests.cs:249` |
| `RepositoryFactoryTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/RepositoryFactoryTests.cs:14` |
| `SaveChangeDetectionTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SaveChangeDetectionTests.cs:24` |
| `SeededIds` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/MarkAllNotificationsReadHandlerTrackingTests.cs:152` |
| `SeederMocks` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/IdentityModuleDbSeederBaseTests.cs:108` |
| `SoftDeletableEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SoftDeleteQueryFilterTests.cs:62` |
| `SoftDeletableTestEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryGetByIdFilterTests.cs:93` |
| `SoftDeleteQueryFilterTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SoftDeleteQueryFilterTests.cs:22` |
| `SoftDeleteTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryGetByIdFilterTests.cs:98` |
| `SoftDeleteTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SoftDeleteQueryFilterTests.cs:67` |
| `SpecificationEvaluatorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SpecificationEvaluatorTests.cs:15` |
| `SpecificationTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SpecificationTestContext.cs:43` |
| `SpecTestChild` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SpecificationTestContext.cs:28` |
| `SpecTestEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SpecificationTestContext.cs:12` |
| `SqliteTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationTests.cs:62` |
| `SqliteTestEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationTests.cs:52` |
| `SqliteTestEntityConfig` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationTests.cs:58` |
| `SQLServerDbContextTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SQLServerDbContextTests.cs:27` |
| `StampedEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryAuditStampTests.cs:103` |
| `StampTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryAuditStampTests.cs:108` |
| `TestableDbSeeder` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbSeederTests.cs:53` |
| `TestAggregate` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryCommitAmbiguityTests.cs:257` |
| `TestAggregate` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryTransactionTests.cs:228` |
| `TestAggregate` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventSaveChangesInterceptorOutboxRoutingTests.cs:242` |
| `TestAggregate` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventSaveChangesInterceptorTests.cs:174` |
| `TestAggregateEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationBaseTests.cs:53` |
| `TestAggregateEntityConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationBaseTests.cs:63` |
| `TestApplicationDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ApplicationDbContextTests.cs:93` |
| `TestAuditDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditSaveChangesInterceptorTests.cs:138` |
| `TestAuditEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditSaveChangesInterceptorTests.cs:136` |
| `TestChildEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryIntegrationTests.cs:563` |
| `TestConfigDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationBaseTests.cs:87` |
| `TestDataSourceService` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ModelBuilderExtensionsTests.cs:118` |
| `TestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryAdditionalTests.cs:229` |
| `TestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryIntegrationTests.cs:568` |
| `TestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/RepositoryFactoryTests.cs:133` |
| `TestDomainEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventSaveChangesInterceptorTests.cs:172` |
| `TestDomainEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxMessageTests.cs:13` |
| `TestDomainEvent` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxProcessorTests.cs:941` |
| `TestDomainEventDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventSaveChangesInterceptorTests.cs:179` |
| `TestDomainEventWithData` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxMessageTests.cs:15` |
| `TestEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ApplicationDbContextTests.cs:88` |
| `TestEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryAdditionalTests.cs:221` |
| `TestEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryIntegrationTests.cs:552` |
| `TestEntitySqliteConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ModelBuilderExtensionsTests.cs:107` |
| `TestIdentityModuleDbSeeder` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/IdentityModuleDbSeederBaseTests.cs:143` |
| `TestIntegrationEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventSaveChangesInterceptorOutboxRoutingTests.cs:240` |
| `TestIntegrationEvent` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxProcessorTests.cs:953` |
| `TestItem` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFQueryableExecutorTests.cs:15` |
| `TestLocalEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryCommitAmbiguityTests.cs:255` |
| `TestLocalEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryTransactionTests.cs:226` |
| `TestLocalEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventSaveChangesInterceptorOutboxRoutingTests.cs:238` |
| `TestMappedEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ModelBuilderExtensionsTests.cs:98` |
| `TestModelBuilderDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ModelBuilderExtensionsTests.cs:136` |
| `TestNonAggregateConfigDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationBaseTests.cs:95` |
| `TestNonAggregateEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationBaseTests.cs:58` |
| `TestNonAggregateEntityConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationBaseTests.cs:75` |
| `TestSeedUser` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/IdentityModuleDbSeederBaseTests.cs:131` |
| `TopTwoByRankSpecification` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositorySpecificationTests.cs:233` |
| `TrackedSpecification` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositorySpecificationTests.cs:251` |
| `TransactionTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryTransactionTests.cs:233` |
| `UnitOfWorkAdditionalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/UnitOfWorkAdditionalTests.cs:11` |
| `UnitOfWorkTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/UnitOfWorkTests.cs:13` |
| `UnorderedQuerySpecification` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SpecificationEvaluatorTests.cs:216` |
| `Widget` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/SaveChangeDetectionTests.cs:100` |
| `AddAuditTrailTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.AuditTrail` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AddAuditTrailTests.cs:15` |
| `AuditedThing` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.AuditTrail` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailTestHarness.cs:40` |
| `AuditTrailCleanupJobTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.AuditTrail` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailCleanupJobTests.cs:22` |
| `AuditTrailModelGateTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.AuditTrail` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailModelGateTests.cs:27` |
| `AuditTrailReaderTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.AuditTrail` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailReaderTests.cs:20` |
| `AuditTrailSaveChangesInterceptorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.AuditTrail` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailSaveChangesInterceptorTests.cs:18` |
| `AuditTrailTestContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.AuditTrail` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailTestHarness.cs:74` |
| `AuditTrailTestHarness` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.AuditTrail` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailTestHarness.cs:28` |
| `CompositeKeyThing` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.AuditTrail` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailTestHarness.cs:61` |
| `FailingSaveInterceptor` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.AuditTrail` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailTestHarness.cs:173` |
| `GateTestContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.AuditTrail` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailModelGateTests.cs:76` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.AuditTrail` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailModelGateTests.cs:122` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.AuditTrail` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailTestHarness.cs:187` |
| `PlainThing` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.AuditTrail` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailTestHarness.cs:53` |
| `CosmosIndexedEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Configuration` | `MMCA.Common.Infrastructure.Tests/Persistence/Configuration/IndexBuilderExtensionsTests.cs:81` |
| `FilteredIndexTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Configuration` | `MMCA.Common.Infrastructure.Tests/Persistence/Configuration/IndexBuilderExtensionsTests.cs:91` |
| `HandRolledOwner` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Configuration` | `MMCA.Common.Infrastructure.Tests/Persistence/Configuration/OwnsMoneyTests.cs:167` |
| `HelperOwner` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Configuration` | `MMCA.Common.Infrastructure.Tests/Persistence/Configuration/OwnsMoneyTests.cs:155` |
| `IndexBuilderExtensionsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Configuration` | `MMCA.Common.Infrastructure.Tests/Persistence/Configuration/IndexBuilderExtensionsTests.cs:16` |
| `MoneyTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Configuration` | `MMCA.Common.Infrastructure.Tests/Persistence/Configuration/OwnsMoneyTests.cs:178` |
| `OwnsMoneyTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Configuration` | `MMCA.Common.Infrastructure.Tests/Persistence/Configuration/OwnsMoneyTests.cs:18` |
| `PropertyFacets` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Configuration` | `MMCA.Common.Infrastructure.Tests/Persistence/Configuration/OwnsMoneyTests.cs:144` |
| `PushNotificationConfigurationTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Configuration` | `MMCA.Common.Infrastructure.Tests/Persistence/Configuration/PushNotificationConfigurationTests.cs:16` |
| `PushNotificationTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Configuration` | `MMCA.Common.Infrastructure.Tests/Persistence/Configuration/PushNotificationConfigurationTests.cs:60` |
| `RenamedFlagEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Configuration` | `MMCA.Common.Infrastructure.Tests/Persistence/Configuration/IndexBuilderExtensionsTests.cs:86` |
| `SqliteIndexedEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Configuration` | `MMCA.Common.Infrastructure.Tests/Persistence/Configuration/IndexBuilderExtensionsTests.cs:76` |
| `SqlServerIndexedEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Configuration` | `MMCA.Common.Infrastructure.Tests/Persistence/Configuration/IndexBuilderExtensionsTests.cs:67` |
| `FilteredIndexEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Conventions` | `MMCA.Common.Infrastructure.Tests/Persistence/Conventions/SoftDeleteUniqueIndexConventionTests.cs:92` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Conventions` | `MMCA.Common.Infrastructure.Tests/Persistence/Conventions/SoftDeleteUniqueIndexConventionTests.cs:150` |
| `SoftDeleteUniqueIndexConventionTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Conventions` | `MMCA.Common.Infrastructure.Tests/Persistence/Conventions/SoftDeleteUniqueIndexConventionTests.cs:23` |
| `UniqueIndexTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Conventions` | `MMCA.Common.Infrastructure.Tests/Persistence/Conventions/SoftDeleteUniqueIndexConventionTests.cs:97` |
| `UniqueNamedEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Conventions` | `MMCA.Common.Infrastructure.Tests/Persistence/Conventions/SoftDeleteUniqueIndexConventionTests.cs:87` |
| `EmailValueConverterTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Conversions` | `MMCA.Common.Infrastructure.Tests/Persistence/Conversions/EmailValueConverterTests.cs:12` |
| `EnumerationValueConverterTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Conversions` | `MMCA.Common.Infrastructure.Tests/Persistence/Conversions/EnumerationValueConverterTests.cs:13` |
| `PhoneNumberValueConverterTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Conversions` | `MMCA.Common.Infrastructure.Tests/Persistence/Conversions/PhoneNumberValueConverterTests.cs:11` |
| `Priority` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Conversions` | `MMCA.Common.Infrastructure.Tests/Persistence/Conversions/EnumerationValueConverterTests.cs:89` |
| `CosmosConfigurationPortabilityTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CosmosConfigurationPortabilityTests.cs:28` |
| `CrossDataSourceDegradeConventionTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CrossDataSourceDegradeConventionTests.cs:24` |
| `DataSourceResolverTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/DataSourceResolverTests.cs:9` |
| `DegradeCustomer` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CrossDataSourceDegradeConventionTests.cs:199` |
| `DegradeOrder` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CrossDataSourceDegradeConventionTests.cs:190` |
| `DegradeTestContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CrossDataSourceDegradeConventionTests.cs:212` |
| `DesignAlphaEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/DesignTimeDbContextHelperTests.cs:100` |
| `DesignAlphaEntityConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/DesignTimeDbContextHelperTests.cs:111` |
| `DesignBetaEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/DesignTimeDbContextHelperTests.cs:105` |
| `DesignBetaEntityConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/DesignTimeDbContextHelperTests.cs:114` |
| `DesignTimeDbContextHelperTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/DesignTimeDbContextHelperTests.cs:10` |
| `EmptyAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CrossDataSourceDegradeConventionTests.cs:185` |
| `EntityDataSourceRegistryTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:15` |
| `FixedAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CosmosConfigurationPortabilityTests.cs:79` |
| `FixedAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:175` |
| `FixedAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/MultiSourceSqliteIntegrationTests.cs:208` |
| `MapRegistry` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CrossDataSourceDegradeConventionTests.cs:173` |
| `MultiSourceCustomer` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/MultiSourceSqliteIntegrationTests.cs:224` |
| `MultiSourceCustomerConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/MultiSourceSqliteIntegrationTests.cs:240` |
| `MultiSourceOrder` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/MultiSourceSqliteIntegrationTests.cs:215` |
| `MultiSourceOrderConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/MultiSourceSqliteIntegrationTests.cs:237` |
| `MultiSourceSqliteIntegrationTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/MultiSourceSqliteIntegrationTests.cs:29` |
| `MultiSourceTestEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/MultiSourceSqliteIntegrationTests.cs:229` |
| `PortablePrincipal` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CosmosConfigurationPortabilityTests.cs:94` |
| `PortablePrincipalConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CosmosConfigurationPortabilityTests.cs:116` |
| `PortableThing` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CosmosConfigurationPortabilityTests.cs:85` |
| `PortableThingConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CosmosConfigurationPortabilityTests.cs:103` |
| `RegistryDuplicate` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:191` |
| `RegistryDuplicateConfigurationA` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:219` |
| `RegistryDuplicateConfigurationB` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:222` |
| `RegistryInvoice` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:186` |
| `RegistryInvoiceConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:211` |
| `RegistryOrder` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:181` |
| `RegistryOrderConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:209` |
| `RegistrySqlServerEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:201` |
| `RegistrySqlServerEntityConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:213` |
| `RegistryUnattributed` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:196` |
| `RegistryUnattributedConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:225` |
| `EfInboxStoreTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Inbox` | `MMCA.Common.Infrastructure.Tests/Persistence/Inbox/EfInboxStoreTests.cs:27` |
| `InboxDisabledWarningServiceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Inbox` | `MMCA.Common.Infrastructure.Tests/Persistence/Inbox/InboxDisabledWarningServiceTests.cs:11` |
| `InboxTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Inbox` | `MMCA.Common.Infrastructure.Tests/Persistence/Inbox/EfInboxStoreTests.cs:181` |
| `RecordingLogger` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Inbox` | `MMCA.Common.Infrastructure.Tests/Persistence/Inbox/InboxDisabledWarningServiceTests.cs:19` |
| `AddMultiTenancyTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Tenancy` | `MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/AddMultiTenancyTests.cs:19` |
| `ApplicationDbContextTenantFilterTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Tenancy` | `MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/ApplicationDbContextTenantFilterTests.cs:14` |
| `DbContextFactoryTenantTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Tenancy` | `MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/DbContextFactoryTenantTests.cs:21` |
| `MutableTenantContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Tenancy` | `MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/DbContextFactoryTenantTests.cs:240` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Tenancy` | `MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/TenantTestHarness.cs:182` |
| `PlainThing` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Tenancy` | `MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/TenantTestHarness.cs:42` |
| `TenantDataSourceTargetTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Tenancy` | `MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/TenantDataSourceTargetTests.cs:18` |
| `TenantDetail` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Tenancy` | `MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/TenantTestHarness.cs:33` |
| `TenantSaveChangesInterceptorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Tenancy` | `MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/TenantSaveChangesInterceptorTests.cs:12` |
| `TenantTestContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Tenancy` | `MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/TenantTestHarness.cs:60` |
| `TenantThing` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Tenancy` | `MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/TenantTestHarness.cs:21` |
| `TrailedTenantThing` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Tenancy` | `MMCA.Common.Infrastructure.Tests/Persistence/Tenancy/TenantTestHarness.cs:48` |
| `DatabaseRestoreDrillTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Resilience` | `MMCA.Common.Infrastructure.Tests/Resilience/DatabaseRestoreDrillTests.cs:18` |
| `DrillResult` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Resilience` | `MMCA.Common.Infrastructure.Tests/Resilience/DatabaseRestoreDrillTests.cs:175` |
| `AddScheduledJobsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Scheduling` | `MMCA.Common.Infrastructure.Tests/Scheduling/AddScheduledJobsTests.cs:16` |
| `CronosNextOccurrenceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Scheduling` | `MMCA.Common.Infrastructure.Tests/Scheduling/CronosNextOccurrenceTests.cs:11` |
| `DelegateScheduledJob` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Scheduling` | `MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerTestHarness.cs:151` |
| `FirstJob` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Scheduling` | `MMCA.Common.Infrastructure.Tests/Scheduling/AddScheduledJobsTests.cs:119` |
| `GateTestContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Scheduling` | `MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerModelGateTests.cs:71` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Scheduling` | `MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerModelGateTests.cs:118` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Scheduling` | `MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerTestHarness.cs:141` |
| `ScheduledJobRunnerTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Scheduling` | `MMCA.Common.Infrastructure.Tests/Scheduling/ScheduledJobRunnerTests.cs:22` |
| `SchedulerMetricsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Scheduling` | `MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerMetricsTests.cs:13` |
| `SchedulerModelGateTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Scheduling` | `MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerModelGateTests.cs:26` |
| `SchedulerTestContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Scheduling` | `MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerTestHarness.cs:92` |
| `SchedulerTestHarness` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Scheduling` | `MMCA.Common.Infrastructure.Tests/Scheduling/SchedulerTestHarness.cs:28` |
| `SecondJob` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Scheduling` | `MMCA.Common.Infrastructure.Tests/Scheduling/AddScheduledJobsTests.cs:128` |
| `AzureNotificationHubDeviceRegistrarTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/AzureNotificationHubDeviceRegistrarTests.cs:16` |
| `BrokerEventBusTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerEventBusTests.cs:27` |
| `BrokerMessageBusTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerMessageBusTests.cs:19` |
| `ClaimBasedUserIdProviderTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/ClaimBasedUserIdProviderTests.cs:13` |
| `CorrelationContextTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/CorrelationContextTests.cs:6` |
| `CountingSweep` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/PeriodicBackgroundServiceTests.cs:103` |
| `CurrentUserServiceAdditionalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/CurrentUserServiceAdditionalTests.cs:9` |
| `CurrentUserServiceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/CurrentUserServiceTests.cs:11` |
| `DataSourceServiceAdditionalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/DataSourceServiceAdditionalTests.cs:14` |
| `DataSourceServiceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/DataSourceServiceTests.cs:13` |
| `EventUpcasterStartupValidatorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/EventUpcasterStartupValidatorTests.cs:20` |
| `FakeEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/DataSourceServiceAdditionalTests.cs:84` |
| `FakeEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/DataSourceServiceTests.cs:165` |
| `FaultIntegrationEventConsumerTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/FaultIntegrationEventConsumerTests.cs:15` |
| `ImageSharpImageProcessorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/ImageSharpImageProcessorTests.cs:15` |
| `InProcessEventBusOutboxTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessEventBusOutboxTests.cs:25` |
| `InProcessEventBusTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessEventBusTests.cs:20` |
| `InProcessMessageBusTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessMessageBusTests.cs:20` |
| `IntegrationEventConsumerTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/IntegrationEventConsumerTests.cs:11` |
| `Mocks` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerEventBusTests.cs:30` |
| `Mocks` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerMessageBusTests.cs:26` |
| `Mocks` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessMessageBusTests.cs:25` |
| `NativePushPayloadsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/NativePushPayloadsTests.cs:12` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerEventBusTests.cs:332` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessEventBusOutboxTests.cs:150` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessEventBusTests.cs:153` |
| `NullLiveChannelPublisherTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/NullLiveChannelPublisherTests.cs:6` |
| `NullPushNotificationSenderTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/NullPushNotificationSenderTests.cs:6` |
| `NullUserService` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/CurrentUserServiceTests.cs:277` |
| `OrderPlacedV2` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/UpcastingIntegrationEventConsumerTests.cs:31` |
| `OtherIntegrationEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerMessageBusTests.cs:23` |
| `PasswordHasherSecurityTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/PasswordHasherSecurityTests.cs:18` |
| `PasswordHasherTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/PasswordHasherTests.cs:8` |
| `PeriodicBackgroundServiceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/PeriodicBackgroundServiceTests.cs:15` |
| `RecordingDomainHandler` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessMessageBusTests.cs:231` |
| `RecordingIntegrationHandler` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessMessageBusTests.cs:240` |
| `RecordingOriginalHandler` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessMessageBusTests.cs:219` |
| `RecordingSuccessorHandler` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessMessageBusTests.cs:208` |
| `RetiredOrderPlaced` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/UpcastingIntegrationEventConsumerTests.cs:29` |
| `RetiredTestIntegrationEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessMessageBusTests.cs:195` |
| `RetiredToV2Upcaster` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessMessageBusTests.cs:202` |
| `RetiredToV2Upcaster` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/UpcastingIntegrationEventConsumerTests.cs:36` |
| `RivalV1ToV3Upcaster` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/EventUpcasterStartupValidatorTests.cs:40` |
| `RoleOnlyService` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/CurrentUserServiceTests.cs:290` |
| `SampleV1ToV2Upcaster` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/EventUpcasterStartupValidatorTests.cs:35` |
| `SignalRLiveChannelPublisherTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/SignalRLiveChannelPublisherTests.cs:8` |
| `SignalRPushNotificationSenderAdditionalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/SignalRPushNotificationSenderAdditionalTests.cs:12` |
| `SignalRPushNotificationSenderTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/SignalRPushNotificationSenderTests.cs:8` |
| `SmtpEmailSenderTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/SmtpEmailSenderTests.cs:7` |
| `TenantContextTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/TenantContextTests.cs:10` |
| `TestConnectionContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/ClaimBasedUserIdProviderTests.cs:81` |
| `TestDuplexPipe` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/ClaimBasedUserIdProviderTests.cs:108` |
| `TestFaultedEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/FaultIntegrationEventConsumerTests.cs:17` |
| `TestIntegrationEvent` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerEventBusTests.cs:226` |
| `TestIntegrationEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerMessageBusTests.cs:21` |
| `TestIntegrationEvent` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessEventBusOutboxTests.cs:94` |
| `TestIntegrationEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessMessageBusTests.cs:22` |
| `TestIntegrationEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/IntegrationEventConsumerTests.cs:13` |
| `TestIntegrationEventV2` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessMessageBusTests.cs:197` |
| `TestNonOutboxContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerEventBusTests.cs:292` |
| `TestNonOutboxContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessEventBusTests.cs:118` |
| `TestOutboxContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerEventBusTests.cs:237` |
| `TestOutboxContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessEventBusOutboxTests.cs:105` |
| `TokenServiceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/TokenServiceTests.cs:11` |
| `UnregisteredEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/DataSourceServiceAdditionalTests.cs:86` |
| `UpcastingIntegrationEventConsumerTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/UpcastingIntegrationEventConsumerTests.cs:26` |
| `ValidatorSampleV1` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/EventUpcasterStartupValidatorTests.cs:23` |
| `ValidatorSampleV2` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/EventUpcasterStartupValidatorTests.cs:25` |
| `ValidatorSampleV3` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/EventUpcasterStartupValidatorTests.cs:30` |
| `ConnectionStringSettingsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Settings` | `MMCA.Common.Infrastructure.Tests/Settings/SettingsTests.cs:132` |
| `JwtSettingsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Settings` | `MMCA.Common.Infrastructure.Tests/Settings/SettingsTests.cs:8` |
| `MessageBusSettingsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Settings` | `MMCA.Common.Infrastructure.Tests/Settings/SettingsTests.cs:227` |
| `OutboxSettingsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Settings` | `MMCA.Common.Infrastructure.Tests/Settings/SettingsTests.cs:180` |
| `PersistenceSettingsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Settings` | `MMCA.Common.Infrastructure.Tests/Settings/PersistenceSettingsTests.cs:12` |
| `PushNotificationSettingsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Settings` | `MMCA.Common.Infrastructure.Tests/Settings/SettingsTests.cs:269` |
| `SmtpSettingsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Settings` | `MMCA.Common.Infrastructure.Tests/Settings/SettingsTests.cs:62` |
| `EmptyEntityDataSourceRegistry` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.TestDoubles` | `MMCA.Common.Infrastructure.Tests/TestDoubles/TestDataSourceDoubles.cs:11` |
| `TestPhysicalDataSources` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.TestDoubles` | `MMCA.Common.Infrastructure.Tests/TestDoubles/TestDataSourceDoubles.cs:32` |
| `AuthenticationRequest` | record struct | MMCA.Common.Shared | `MMCA.Common.Shared` | `MMCA.Common.Shared/AuthenticationRequest.cs:15` |
| `CollectionResult<T>` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/PaginationMetadata.cs:92` |
| `Error` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/Error.cs:15` |
| `ErrorType` | enum | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/ErrorType.cs:8` |
| `KeysetCollectionResult<T>` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/KeysetPagination.cs:85` |
| `KeysetCursor` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/KeysetPagination.cs:125` |
| `KeysetPageRequest` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/KeysetPagination.cs:20` |
| `PagedCollectionResult<T>` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/PaginationMetadata.cs:119` |
| `PaginationMetadata` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/PaginationMetadata.cs:12` |
| `Result` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/Result.cs:18` |
| `Result<T>` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/Result.cs:137` |
| `ServiceContractAttribute` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/ServiceContractAttribute.cs:21` |
| `AuthClaimTypes` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/AuthClaimTypes.cs:7` |
| `AuthenticationResponse` | record struct | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/AuthenticationResponse.cs:10` |
| `ChangePasswordRequest` | record struct | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/ChangePasswordRequest.cs:8` |
| `ChangePreferencesRequest` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/ChangePreferencesRequest.cs:10` |
| `ForgotPasswordRequest` | record struct | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/ForgotPasswordRequest.cs:8` |
| `IPermissionRegistry` | interface | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/IPermissionRegistry.cs:13` |
| `LoginRequest` | record struct | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/LoginRequest.cs:8` |
| `OAuthCodeExchangeRequest` | record struct | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/OAuthCodeExchangeRequest.cs:11` |
| `PermissionRegistry` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/PermissionRegistry.cs:10` |
| `PermissionRegistryBuilder` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/PermissionRegistryBuilder.cs:8` |
| `RefreshTokenRequest` | record struct | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/RefreshTokenRequest.cs:9` |
| `RegisterRequest` | record struct | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/RegisterRequest.cs:13` |
| `ResetPasswordRequest` | record struct | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/ResetPasswordRequest.cs:9` |
| `RoleNames` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/RoleNames.cs:12` |
| `RoleValue` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/RoleValue.cs:25` |
| `UserPreferencesResponse` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/UserPreferencesResponse.cs:9` |
| `IcsCalendarBuilder` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Calendars` | `MMCA.Common.Shared/Calendars/IcsCalendarBuilder.cs:12` |
| `IcsEvent` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Calendars` | `MMCA.Common.Shared/Calendars/IcsEvent.cs:15` |
| `KeyedSemaphoreStripe` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Concurrency` | `MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:22` |
| `Releaser` | record struct | MMCA.Common.Shared | `MMCA.Common.Shared.Concurrency` | `MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:78` |
| `BaseLookup<TIdentifierType>` | record | MMCA.Common.Shared | `MMCA.Common.Shared.DTOs` | `MMCA.Common.Shared/DTOs/BaseLookup.cs:8` |
| `ConcurrencyTokenRequest` | record | MMCA.Common.Shared | `MMCA.Common.Shared.DTOs` | `MMCA.Common.Shared/DTOs/ConcurrencyTokenRequest.cs:12` |
| `IBaseDTO<TIdentifierType>` | interface | MMCA.Common.Shared | `MMCA.Common.Shared.DTOs` | `MMCA.Common.Shared/DTOs/IBaseDTO.cs:9` |
| `IConcurrencyAware` | interface | MMCA.Common.Shared | `MMCA.Common.Shared.DTOs` | `MMCA.Common.Shared/DTOs/IConcurrencyAware.cs:13` |
| `DomainException` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Exceptions` | `MMCA.Common.Shared/Exceptions/DomainException.cs:9` |
| `DomainInvariantViolationException` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Exceptions` | `MMCA.Common.Shared/Exceptions/DomainInvariantViolationException.cs:9` |
| `DomainHelper` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Extensions` | `MMCA.Common.Shared/Extensions/DomainHelper.cs:8` |
| `SupportedCultures` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Globalization` | `MMCA.Common.Shared/Globalization/SupportedCultures.cs:9` |
| `IdempotencyHeaders` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Http` | `MMCA.Common.Shared/Http/IdempotencyHeaders.cs:13` |
| `NotificationFeatures` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Notifications` | `MMCA.Common.Shared/Notifications/NotificationFeatures.cs:6` |
| `DeviceInstallationRequest` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Notifications.PushNotifications` | `MMCA.Common.Shared/Notifications/PushNotifications/DeviceInstallationRequest.cs:12` |
| `PushNotificationDTO` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Notifications.PushNotifications` | `MMCA.Common.Shared/Notifications/PushNotifications/PushNotificationDTO.cs:8` |
| `SendPushNotificationRequest` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Notifications.PushNotifications` | `MMCA.Common.Shared/Notifications/PushNotifications/SendPushNotificationRequest.cs:6` |
| `UserNotificationDTO` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Notifications.UserNotifications` | `MMCA.Common.Shared/Notifications/UserNotifications/UserNotificationDTO.cs:7` |
| `PrivacyFeatures` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Privacy` | `MMCA.Common.Shared/Privacy/PrivacyFeatures.cs:6` |
| `UserDataExportDTO` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Privacy` | `MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:15` |
| `UserDataExportSectionDTO` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Privacy` | `MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:61` |
| `BrokerResilienceDefaults` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Resilience` | `MMCA.Common.Shared/Resilience/BrokerResilienceDefaults.cs:24` |
| `HttpResilienceDefaults` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Resilience` | `MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:10` |
| `PropertyReader` | delegate | MMCA.Common.Shared | `MMCA.Common.Shared.Serialization` | `MMCA.Common.Shared/Serialization/ResultJsonConverterFactory.cs:118` |
| `ResultConverter` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Serialization` | `MMCA.Common.Shared/Serialization/ResultJsonConverterFactory.cs:35` |
| `ResultConverter<T>` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Serialization` | `MMCA.Common.Shared/Serialization/ResultJsonConverterFactory.cs:63` |
| `ResultJsonConverterFactory` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Serialization` | `MMCA.Common.Shared/Serialization/ResultJsonConverterFactory.cs:15` |
| `Address` | record | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/Address.cs:16` |
| `AddressInvariants` | class | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/AddressInvariants.cs:9` |
| `Currency` | record | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/Currency.cs:14` |
| `CurrencyJsonConverter` | class | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/Currency.cs:73` |
| `DateRange` | record | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/DateRange.cs:9` |
| `DateTimeRange` | record | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/DateTimeRange.cs:10` |
| `Email` | record | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/Email.cs:16` |
| `EmailInvariants` | class | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/EmailInvariants.cs:11` |
| `Enumeration<TEnumeration>` | class | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/Enumeration.cs:71` |
| `EnumerationConverter<TEnumeration>` | class | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/Enumeration.cs:224` |
| `EnumerationJsonConverterFactory` | class | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/Enumeration.cs:195` |
| `Money` | record | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/Money.cs:21` |
| `PhoneNumber` | record | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/PhoneNumber.cs:16` |
| `PhoneNumberInvariants` | class | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/PhoneNumberInvariants.cs:11` |
| `ValueObject` | record | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/ValueObject.cs:8` |
| `CollectionResultTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Abstractions` | `MMCA.Common.Shared.Tests/Abstractions/CollectionResultTests.cs:6` |
| `ErrorTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Abstractions` | `MMCA.Common.Shared.Tests/Abstractions/ErrorTests.cs:6` |
| `KeysetPaginationTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Abstractions` | `MMCA.Common.Shared.Tests/Abstractions/KeysetPaginationTests.cs:10` |
| `PaginationMetadataTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Abstractions` | `MMCA.Common.Shared.Tests/Abstractions/PaginationMetadataTests.cs:7` |
| `ResultTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Abstractions` | `MMCA.Common.Shared.Tests/Abstractions/ResultTests.cs:6` |
| `PermissionRegistryTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Auth` | `MMCA.Common.Shared.Tests/Auth/PermissionRegistryTests.cs:6` |
| `RoleValueTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Auth` | `MMCA.Common.Shared.Tests/Auth/RoleValueTests.cs:13` |
| `IcsCalendarBuilderTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Calendars` | `MMCA.Common.Shared.Tests/Calendars/IcsCalendarBuilderTests.cs:12` |
| `KeyedSemaphoreStripeTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Concurrency` | `MMCA.Common.Shared.Tests/Concurrency/KeyedSemaphoreStripeTests.cs:12` |
| `ConcreteDomainException` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Exceptions` | `MMCA.Common.Shared.Tests/Exceptions/DomainExceptionTests.cs:8` |
| `DomainExceptionTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Exceptions` | `MMCA.Common.Shared.Tests/Exceptions/DomainExceptionTests.cs:6` |
| `DomainHelperTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Extensions` | `MMCA.Common.Shared.Tests/Extensions/DomainHelperTests.cs:6` |
| `SupportedCulturesTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Globalization` | `MMCA.Common.Shared.Tests/Globalization/SupportedCulturesTests.cs:11` |
| `ResultJsonConverterFactoryTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Serialization` | `MMCA.Common.Shared.Tests/Serialization/ResultJsonConverterFactoryTests.cs:12` |
| `TestDTO` | record | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Serialization` | `MMCA.Common.Shared.Tests/Serialization/ResultJsonConverterFactoryTests.cs:16` |
| `AddressInvariantsTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/AddressInvariantsTests.cs:6` |
| `AddressTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/AddressTests.cs:6` |
| `Alert` | record | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/EnumerationSerializationTests.cs:133` |
| `CurrencyJsonConverterTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/CurrencyJsonConverterTests.cs:7` |
| `CurrencyTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/CurrencyTests.cs:6` |
| `DateRangeTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/DateRangeTests.cs:6` |
| `DateTimeRangeTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/DateTimeRangeTests.cs:6` |
| `EmailTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/EmailTests.cs:6` |
| `EnumerationSerializationTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/EnumerationSerializationTests.cs:15` |
| `EnumerationTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/EnumerationTests.cs:10` |
| `Grade` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/EnumerationSerializationTests.cs:122` |
| `MoneySerializationTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/MoneySerializationTests.cs:11` |
| `MoneyTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/MoneyTests.cs:6` |
| `PhoneNumberTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/PhoneNumberTests.cs:6` |
| `Priority` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/EnumerationTests.cs:122` |
| `Severity` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/EnumerationSerializationTests.cs:111` |
| `Severity` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/EnumerationTests.cs:134` |
| `TestValueObject` | record | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/ValueObjectTests.cs:8` |
| `ValueObjectTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/ValueObjectTests.cs:6` |
| `CrossServiceDataSource` | record | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/CrossServiceFixtureBase.cs:15` |
| `CrossServiceFixtureBase` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/CrossServiceFixtureBase.cs:41` |
| `DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/DecoratorPipelineOrderTestsBase.cs:38` |
| `DependencyInjectionAssert` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/DependencyInjectionAssert.cs:13` |
| `FeatureManagementTestExtensions` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/FeatureManagementTestExtensions.cs:10` |
| `GracefulShutdownTestsBase<TEntryPoint>` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/GracefulShutdownTestsBase.cs:24` |
| `HandlerTestBase<THandler>` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/HandlerTestBase.cs:38` |
| `IIntegrationTestFixture` | interface | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/IIntegrationTestFixture.cs:8` |
| `IntegrationTestBase<TFixture>` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/IntegrationTestBase.cs:13` |
| `JwtTokenGenerator` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/JwtTokenGenerator.cs:30` |
| `MiddlewarePipelineOrderTestsBase` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/MiddlewarePipelineOrderTestsBase.cs:29` |
| `OpenApiContractTestsBase<TFixture>` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/OpenApiContractTestsBase.cs:21` |
| `ProblemDetailsContractTestsBase<TFixture>` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/ProblemDetailsContractTestsBase.cs:21` |
| `ProductionHostApplicationFactory<TEntryPoint>` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/ProductionHostApplicationFactory.cs:22` |
| `SecurityHeadersTestsBase` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/SecurityHeadersTestsBase.cs:16` |
| `ServiceInfoVersioningContractTestsBase<TFixture>` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/ServiceInfoVersioningContractTestsBase.cs:19` |
| `SqlServerIntegrationTestFixtureBase<TEntryPoint>` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/SqlServerIntegrationTestFixtureBase.cs:27` |
| `TestPolling` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/TestPolling.cs:9` |
| `EntityBuilderBase<TBuilder, TEntity>` | class | MMCA.Common.Testing | `MMCA.Common.Testing.Builders` | `MMCA.Common.Testing/Builders/EntityBuilderBase.cs:9` |
| `AggregateConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/AggregateConventionTestsBase.cs:10` |
| `AnonymousEndpointTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/AnonymousEndpointTestsBase.cs:30` |
| `ArchitectureAssert` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureAssert.cs:8` |
| `ArchitectureMapBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureMapBase.cs:11` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.CancellationTokens.cs:5` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Contracts.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Controllers.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Cycles.cs:5` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Entities.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Events.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Governance.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.HandlerResults.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Handlers.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Idempotency.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Immutability.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Layers.cs:9` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Localization.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.LocalizedText.cs:5` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Modules.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Naming.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Protos.cs:5` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Purity.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Slices.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:5` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Transport.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Upcasters.cs:5` |
| `BrandColorTokenTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/BrandColorTokenTestsBase.cs:13` |
| `CancellationTokenConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/CancellationTokenConventionTestsBase.cs:16` |
| `ConcurrencyConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/ConcurrencyConventionTestsBase.cs:8` |
| `ConstructorDependencyCountTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/ConstructorDependencyCountTestsBase.cs:14` |
| `ControllerConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/ControllerConventionTestsBase.cs:7` |
| `CrossEntityNavigationFinder` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:97` |
| `DataResidencyTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/DataResidencyTestsBase.cs:14` |
| `DependencyVersionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/DependencyVersionTestsBase.cs:15` |
| `DomainPurityTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/DomainPurityTestsBase.cs:8` |
| `EntityConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/EntityConventionTestsBase.cs:9` |
| `EventConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/EventConventionTestsBase.cs:9` |
| `FormsConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/FormsConventionTestsBase.cs:15` |
| `FrameworkVersionConsistencyTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/FrameworkVersionConsistencyTestsBase.cs:13` |
| `HandlerConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/HandlerConventionTestsBase.cs:8` |
| `HandlerResultConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/HandlerResultConventionTestsBase.cs:16` |
| `IArchitectureMap` | interface | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/IArchitectureMap.cs:39` |
| `IdempotencyConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/IdempotencyConventionTestsBase.cs:10` |
| `ImmutabilityTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/ImmutabilityTestsBase.cs:8` |
| `IntegrationEventContractTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/IntegrationEventContractTestsBase.cs:11` |
| `Layer` | enum | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/IArchitectureMap.cs:9` |
| `LayerDependencyTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/LayerDependencyTestsBase.cs:7` |
| `LayerRef` | record | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/IArchitectureMap.cs:31` |
| `LocalizationResourceTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/LocalizationResourceTestsBase.cs:10` |
| `LocalizedTextConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/LocalizedTextConventionTestsBase.cs:13` |
| `MicroserviceExtractionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/MicroserviceExtractionTestsBase.cs:8` |
| `ModuleConformanceTestsBase<TModule>` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/ModuleConformanceTestsBase.cs:21` |
| `ModuleIsolationTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/ModuleIsolationTestsBase.cs:8` |
| `NamespaceCycleTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/NamespaceCycleTestsBase.cs:15` |
| `NamingConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/NamingConventionTestsBase.cs:8` |
| `ObservabilityConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/ObservabilityConventionTestsBase.cs:30` |
| `PiiConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/PiiConventionTestsBase.cs:7` |
| `ProtoContractTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/ProtoContractTestsBase.cs:19` |
| `ProtoScope` | record | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Protos.cs:297` |
| `ProtoScopeKind` | enum | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Protos.cs:286` |
| `RawQueryableConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/RawQueryableConventionTestsBase.cs:30` |
| `RouteAuthorizationTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/RouteAuthorizationTestsBase.cs:22` |
| `RuleHelpers` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/RuleHelpers.cs:14` |
| `ServiceContractPurityTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/ServiceContractPurityTestsBase.cs:20` |
| `SharedLayerTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/SharedLayerTestsBase.cs:7` |
| `SliceCohesionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/SliceCohesionTestsBase.cs:10` |
| `SpecificationConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/SpecificationConventionTestsBase.cs:10` |
| `StateManagementConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/StateManagementConventionTestsBase.cs:17` |
| `UIArchitectureConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/UIArchitectureConventionTestsBase.cs:14` |
| `AccessibilityViolationException` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/AccessibilityViolationException.cs:7` |
| `AdminCredentials` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:66` |
| `AxeOptions` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/AxeOptions.cs:9` |
| `E2ETestBase` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:8` |
| `E2ETestCollection` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:48` |
| `E2ETestConfiguration` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:8` |
| `PageExtensions` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:19` |
| `PlaywrightFixture` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:6` |
| `UserCredentials` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:78` |
| `WebVitalsArtifact` | record | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:90` |
| `WebVitalsBudget` | record | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:103` |
| `WebVitalsCollector` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:20` |
| `WebVitalsSample` | record | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:76` |
| `ForgotPasswordPage` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.PageObjects` | `MMCA.Common.Testing.E2E/PageObjects/ForgotPasswordPage.cs:6` |
| `LoginPage` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.PageObjects` | `MMCA.Common.Testing.E2E/PageObjects/LoginPage.cs:6` |
| `ProfilePage` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.PageObjects` | `MMCA.Common.Testing.E2E/PageObjects/ProfilePage.cs:6` |
| `RegisterPage` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.PageObjects` | `MMCA.Common.Testing.E2E/PageObjects/RegisterPage.cs:6` |
| `ResetPasswordPage` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.PageObjects` | `MMCA.Common.Testing.E2E/PageObjects/ResetPasswordPage.cs:6` |
| `AuthorizationTestsBase` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Workflows.Identity` | `MMCA.Common.Testing.E2E/Workflows/Identity/AuthorizationTestsBase.cs:18` |
| `LogoutTestsBase` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Workflows.Identity` | `MMCA.Common.Testing.E2E/Workflows/Identity/LogoutTestsBase.cs:9` |
| `PasswordResetTestsBase` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Workflows.Identity` | `MMCA.Common.Testing.E2E/Workflows/Identity/PasswordResetTestsBase.cs:17` |
| `ProfileManagementTestsBase` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Workflows.Identity` | `MMCA.Common.Testing.E2E/Workflows/Identity/ProfileManagementTestsBase.cs:11` |
| `UserLoginTestsBase` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Workflows.Identity` | `MMCA.Common.Testing.E2E/Workflows/Identity/UserLoginTestsBase.cs:10` |
| `UserRegistrationTestsBase` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Workflows.Identity` | `MMCA.Common.Testing.E2E/Workflows/Identity/UserRegistrationTestsBase.cs:10` |
| `UserPreferencesTestsBase` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Workflows.Preferences` | `MMCA.Common.Testing.E2E/Workflows/Preferences/UserPreferencesTestsBase.cs:21` |
| `CrossServiceFixtureBaseTests` | class | MMCA.Common.Testing.Tests | `MMCA.Common.Testing.Tests` | `MMCA.Common.Testing.Tests/CrossServiceFixtureBaseTests.cs:13` |
| `DecoratorPipelineOrderTests` | class | MMCA.Common.Testing.Tests | `MMCA.Common.Testing.Tests` | `MMCA.Common.Testing.Tests/DecoratorPipelineOrderTests.cs:21` |
| `DependencyInjectionAssertTests` | class | MMCA.Common.Testing.Tests | `MMCA.Common.Testing.Tests` | `MMCA.Common.Testing.Tests/DependencyInjectionAssertTests.cs:12` |
| `FakeCrossServiceFixture` | class | MMCA.Common.Testing.Tests | `MMCA.Common.Testing.Tests` | `MMCA.Common.Testing.Tests/CrossServiceFixtureBaseTests.cs:106` |
| `FakeHandler` | class | MMCA.Common.Testing.Tests | `MMCA.Common.Testing.Tests` | `MMCA.Common.Testing.Tests/HandlerTestBaseTests.cs:43` |
| `HandlerTestBaseTests` | class | MMCA.Common.Testing.Tests | `MMCA.Common.Testing.Tests` | `MMCA.Common.Testing.Tests/HandlerTestBaseTests.cs:12` |
| `ISampleService` | interface | MMCA.Common.Testing.Tests | `MMCA.Common.Testing.Tests` | `MMCA.Common.Testing.Tests/DependencyInjectionAssertTests.cs:44` |
| `JwtTokenGeneratorTests` | class | MMCA.Common.Testing.Tests | `MMCA.Common.Testing.Tests` | `MMCA.Common.Testing.Tests/JwtTokenGeneratorTests.cs:18` |
| `MiddlewarePipelineOrderTests` | class | MMCA.Common.Testing.Tests | `MMCA.Common.Testing.Tests` | `MMCA.Common.Testing.Tests/MiddlewarePipelineOrderTests.cs:10` |
| `PingCommand` | record | MMCA.Common.Testing.Tests | `MMCA.Common.Testing.Tests` | `MMCA.Common.Testing.Tests/DecoratorPipelineOrderTests.cs:41` |
| `PingCommandHandler` | class | MMCA.Common.Testing.Tests | `MMCA.Common.Testing.Tests` | `MMCA.Common.Testing.Tests/DecoratorPipelineOrderTests.cs:45` |
| `PingQuery` | record | MMCA.Common.Testing.Tests | `MMCA.Common.Testing.Tests` | `MMCA.Common.Testing.Tests/DecoratorPipelineOrderTests.cs:43` |
| `PingQueryHandler` | class | MMCA.Common.Testing.Tests | `MMCA.Common.Testing.Tests` | `MMCA.Common.Testing.Tests/DecoratorPipelineOrderTests.cs:51` |
| `SampleService` | class | MMCA.Common.Testing.Tests | `MMCA.Common.Testing.Tests` | `MMCA.Common.Testing.Tests/DependencyInjectionAssertTests.cs:46` |
| `TestAggregate` | class | MMCA.Common.Testing.Tests | `MMCA.Common.Testing.Tests` | `MMCA.Common.Testing.Tests/HandlerTestBaseTests.cs:45` |
| `TestChildEntity` | class | MMCA.Common.Testing.Tests | `MMCA.Common.Testing.Tests` | `MMCA.Common.Testing.Tests/HandlerTestBaseTests.cs:47` |
| `TestPollingTests` | class | MMCA.Common.Testing.Tests | `MMCA.Common.Testing.Tests` | `MMCA.Common.Testing.Tests/TestPollingTests.cs:11` |
| `BunitComponentTestBase` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:33` |
| `BunitInteractionExtensions` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/BunitInteractionExtensions.cs:12` |
| `CapturedRequest` | record | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:129` |
| `CapturingHttpMessageHandler` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:18` |
| `FreshApiClientFactory` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:73` |
| `HttpTestDoubles` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/HttpTestDoubles.cs:12` |
| `IsAuthenticatedAuthorizationService` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:111` |
| `MarkupSnapshot` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:21` |
| `MarkupSnapshotResult` | record struct | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:104` |
| `MudProviderHandles` | record | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:92` |
| `MutableAuthenticationStateProvider` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:97` |
| `Route` | record | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:110` |
| `StubTokenStorageService` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/StubTokenStorageService.cs:13` |
| `TestPrincipal` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/TestPrincipal.cs:6` |
| `UiHttpServiceHarness` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:12` |
| `DependencyInjection` | class | MMCA.Common.UI | `MMCA.Common.UI` | `MMCA.Common.UI/DependencyInjection.cs:21` |
| `UISharedAssemblyReference` | class | MMCA.Common.UI | `MMCA.Common.UI` | `MMCA.Common.UI/DependencyInjection.cs:167` |
| `BreakpointConstants` | class | MMCA.Common.UI | `MMCA.Common.UI.Common` | `MMCA.Common.UI/Common/BreakpointConstants.cs:9` |
| `NavItem` | record | MMCA.Common.UI | `MMCA.Common.UI.Common` | `MMCA.Common.UI/Common/NavItem.cs:17` |
| `NavSection` | enum | MMCA.Common.UI | `MMCA.Common.UI.Common` | `MMCA.Common.UI/Common/NavSection.cs:7` |
| `NotificationRoutePaths` | class | MMCA.Common.UI | `MMCA.Common.UI.Common` | `MMCA.Common.UI/Common/NotificationRoutePaths.cs:6` |
| `RoutePaths` | class | MMCA.Common.UI | `MMCA.Common.UI.Common` | `MMCA.Common.UI/Common/RoutePaths.cs:7` |
| `IEntityService<TEntityDTO, TIdentifierType>` | interface | MMCA.Common.UI | `MMCA.Common.UI.Common.Interfaces` | `MMCA.Common.UI/Common/Interfaces/IEntityService.cs:12` |
| `IHomePageContent` | interface | MMCA.Common.UI | `MMCA.Common.UI.Common.Interfaces` | `MMCA.Common.UI/Common/Interfaces/IHomePageContent.cs:8` |
| `IUIModule` | interface | MMCA.Common.UI | `MMCA.Common.UI.Common.Interfaces` | `MMCA.Common.UI/Common/Interfaces/IUIModule.cs:10` |
| `ApiSettings` | class | MMCA.Common.UI | `MMCA.Common.UI.Common.Settings` | `MMCA.Common.UI/Common/Settings/ApiSettings.cs:9` |
| `IApiSettings` | interface | MMCA.Common.UI | `MMCA.Common.UI.Common.Settings` | `MMCA.Common.UI/Common/Settings/IApiSettings.cs:6` |
| `LayoutSettings` | class | MMCA.Common.UI | `MMCA.Common.UI.Common.Settings` | `MMCA.Common.UI/Common/Settings/LayoutSettings.cs:9` |
| `UIModuleConfiguration` | class | MMCA.Common.UI | `MMCA.Common.UI.Common.Settings` | `MMCA.Common.UI/Common/Settings/UIModuleConfiguration.cs:10` |
| `MobileInfiniteScrollList<TItem>` | class | MMCA.Common.UI | `MMCA.Common.UI.Components` | `MMCA.Common.UI/Components/MobileInfiniteScrollList.razor.cs:17` |
| `QrErrorCorrectionLevel` | enum | MMCA.Common.UI | `MMCA.Common.UI.Components` | `MMCA.Common.UI/Components/QrErrorCorrectionLevel.cs:9` |
| `NotificationBell` | class | MMCA.Common.UI | `MMCA.Common.UI.Components.Notifications` | `MMCA.Common.UI/Components/Notifications/NotificationBell.razor.cs:22` |
| `MoneyExtensions` | class | MMCA.Common.UI | `MMCA.Common.UI.Extensions` | `MMCA.Common.UI/Extensions/MoneyExtensions.cs:14` |
| `WebApplicationExtensions` | class | MMCA.Common.UI | `MMCA.Common.UI.Extensions` | `MMCA.Common.UI/Extensions/WebApplicationExtensions.cs:8` |
| `PseudoLocalizer` | class | MMCA.Common.UI | `MMCA.Common.UI.Globalization` | `MMCA.Common.UI/Globalization/PseudoLocalizer.cs:20` |
| `PseudoStringLocalizer` | class | MMCA.Common.UI | `MMCA.Common.UI.Globalization` | `MMCA.Common.UI/Globalization/PseudoStringLocalizer.cs:13` |
| `PseudoStringLocalizerFactory` | class | MMCA.Common.UI | `MMCA.Common.UI.Globalization` | `MMCA.Common.UI/Globalization/PseudoStringLocalizerFactory.cs:11` |
| `ResxMudLocalizer` | class | MMCA.Common.UI | `MMCA.Common.UI.Globalization` | `MMCA.Common.UI/Globalization/ResxMudLocalizer.cs:17` |
| `DependencyInjection` | class | MMCA.Common.UI | `MMCA.Common.UI.Notifications` | `MMCA.Common.UI/Notifications/DependencyInjection.cs:12` |
| `NotificationUIModule` | class | MMCA.Common.UI | `MMCA.Common.UI.Notifications` | `MMCA.Common.UI/Notifications/NotificationUIModule.cs:14` |
| `ForgotPasswordModel` | class | MMCA.Common.UI | `MMCA.Common.UI.Pages.Auth` | `MMCA.Common.UI/Pages/Auth/ForgotPasswordModel.cs:9` |
| `LoginModel` | class | MMCA.Common.UI | `MMCA.Common.UI.Pages.Auth` | `MMCA.Common.UI/Pages/Auth/LoginModel.cs:9` |
| `PasswordComplexityAttribute` | class | MMCA.Common.UI | `MMCA.Common.UI.Pages.Auth` | `MMCA.Common.UI/Pages/Auth/PasswordComplexityAttribute.cs:12` |
| `RegisterModel` | class | MMCA.Common.UI | `MMCA.Common.UI.Pages.Auth` | `MMCA.Common.UI/Pages/Auth/RegisterModel.cs:9` |
| `ResetPasswordModel` | class | MMCA.Common.UI | `MMCA.Common.UI.Pages.Auth` | `MMCA.Common.UI/Pages/Auth/ResetPasswordModel.cs:10` |
| `DataGridListPageBase<TDto>` | class | MMCA.Common.UI | `MMCA.Common.UI.Pages.Common` | `MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:20` |
| `ErrorMessages` | class | MMCA.Common.UI | `MMCA.Common.UI.Pages.Common` | `MMCA.Common.UI/Pages/Common/ErrorMessages.cs:17` |
| `PersistedGridState` | record | MMCA.Common.UI | `MMCA.Common.UI.Pages.Common` | `MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:805` |
| `NotificationInbox` | class | MMCA.Common.UI | `MMCA.Common.UI.Pages.Notifications` | `MMCA.Common.UI/Pages/Notifications/NotificationInbox.razor.cs:17` |
| `NotificationList` | class | MMCA.Common.UI | `MMCA.Common.UI.Pages.Notifications` | `MMCA.Common.UI/Pages/Notifications/NotificationList.razor.cs:16` |
| `NotificationSend` | class | MMCA.Common.UI | `MMCA.Common.UI.Pages.Notifications` | `MMCA.Common.UI/Pages/Notifications/NotificationSend.razor.cs:16` |
| `MudTranslations` | class | MMCA.Common.UI | `MMCA.Common.UI.Resources` | `MMCA.Common.UI/Resources/MudTranslations.cs:10` |
| `SharedResource` | class | MMCA.Common.UI | `MMCA.Common.UI.Resources` | `MMCA.Common.UI/Resources/SharedResource.cs:9` |
| `ApiUserPreferenceReader` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ApiUserPreferenceReader.cs:14` |
| `ApiUserPreferenceWriter` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ApiUserPreferenceWriter.cs:22` |
| `AuthenticatedServiceBase` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/AuthenticatedServiceBase.cs:15` |
| `ChildEntityServiceBase` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ChildEntityServiceBase.cs:17` |
| `CultureDelegatingHandler` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/CultureDelegatingHandler.cs:13` |
| `EndpointCultureApplier` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/EndpointCultureApplier.cs:18` |
| `EntityServiceBase<TEntityDTO, TIdentifierType>` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/EntityServiceBase.cs:25` |
| `ICultureApplier` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ICultureApplier.cs:14` |
| `IFormFactor` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/IFormFactor.cs:7` |
| `IUserPreferenceReader` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/IUserPreferenceReader.cs:9` |
| `IUserPreferenceWriter` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/IUserPreferenceWriter.cs:9` |
| `LazyJsModule` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/LazyJsModule.cs:20` |
| `ListPageQueryStateService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ListPageQueryStateService.cs:28` |
| `ListPageState` | record | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ListPageStateService.cs:9` |
| `ListPageStateService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ListPageStateService.cs:58` |
| `MmcaCultureBootstrap` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/MmcaCultureBootstrap.cs:14` |
| `ServiceExceptionHelper` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ServiceExceptionHelper.cs:11` |
| `ThemeService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ThemeService.cs:16` |
| `UserPreferences` | record | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/UserPreferences.cs:9` |
| `UserPreferencesRequest` | record | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ApiUserPreferenceWriter.cs:29` |
| `WasmFormFactor` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/WasmFormFactor.cs:9` |
| `AuthDelegatingHandler` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Auth` | `MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:9` |
| `AuthUIService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Auth` | `MMCA.Common.UI/Services/Auth/AuthUIService.cs:15` |
| `ConfigurationOAuthUISettings` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Auth` | `MMCA.Common.UI/Services/Auth/ConfigurationOAuthUISettings.cs:13` |
| `DefaultOAuthUISettings` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Auth` | `MMCA.Common.UI/Services/Auth/DefaultOAuthUISettings.cs:7` |
| `DirectApiTokenRefresher` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Auth` | `MMCA.Common.UI/Services/Auth/DirectApiTokenRefresher.cs:11` |
| `IAuthUIService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Auth` | `MMCA.Common.UI/Services/Auth/IAuthUIService.cs:9` |
| `IOAuthUISettings` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Auth` | `MMCA.Common.UI/Services/Auth/IOAuthUISettings.cs:9` |
| `ISessionCookieSync` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Auth` | `MMCA.Common.UI/Services/Auth/ISessionCookieSync.cs:8` |
| `ITokenRefresher` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Auth` | `MMCA.Common.UI/Services/Auth/ITokenRefresher.cs:13` |
| `ITokenStorageService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Auth` | `MMCA.Common.UI/Services/Auth/ITokenStorageService.cs:8` |
| `JsFetchSessionCookieSync` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Auth` | `MMCA.Common.UI/Services/Auth/JsFetchSessionCookieSync.cs:11` |
| `JwtAuthenticationStateProvider` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Auth` | `MMCA.Common.UI/Services/Auth/JwtAuthenticationStateProvider.cs:12` |
| `JwtTokenInfo` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Auth` | `MMCA.Common.UI/Services/Auth/JwtTokenInfo.cs:9` |
| `SameOriginProxyTokenRefresher` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Auth` | `MMCA.Common.UI/Services/Auth/SameOriginProxyTokenRefresher.cs:11` |
| `WasmTokenStorageService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Auth` | `MMCA.Common.UI/Services/Auth/WasmTokenStorageService.cs:11` |
| `DeepLinkDispatcher` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/DeepLinkDispatcher.cs:9` |
| `DeepLinkRouteEventArgs` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/DeepLinkRouteEventArgs.cs:4` |
| `DependencyInjection` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:16` |
| `DevicePreferenceKeys` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/DevicePreferenceKeys.cs:7` |
| `GeoPoint` | record | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/GeoPoint.cs:9` |
| `IAccessibilityAnnouncer` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IAccessibilityAnnouncer.cs:9` |
| `IBarcodeScannerService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IBarcodeScannerService.cs:11` |
| `IBatteryStatusService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IBatteryStatusService.cs:8` |
| `IBiometricAuthenticator` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IBiometricAuthenticator.cs:9` |
| `IClipboardService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IClipboardService.cs:7` |
| `IConnectivityStatusService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IConnectivityStatusService.cs:10` |
| `IDeepLinkDispatcher` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IDeepLinkDispatcher.cs:10` |
| `IDevicePreferences` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IDevicePreferences.cs:11` |
| `IExternalAuthBroker` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IExternalAuthBroker.cs:10` |
| `IExternalLinkService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IExternalLinkService.cs:9` |
| `IGeocodingService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IGeocodingService.cs:9` |
| `IGeolocationService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IGeolocationService.cs:8` |
| `IHapticFeedbackService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IHapticFeedbackService.cs:8` |
| `ILocalCacheStore` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/ILocalCacheStore.cs:9` |
| `ILocalNotificationService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/ILocalNotificationService.cs:10` |
| `IMapNavigationService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IMapNavigationService.cs:8` |
| `IMediaPickerService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IMediaPickerService.cs:9` |
| `IPushDeviceTokenProvider` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IPushDeviceTokenProvider.cs:10` |
| `IPushRegistrationService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IPushRegistrationService.cs:10` |
| `IScreenshotService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IScreenshotService.cs:8` |
| `IShareService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IShareService.cs:8` |
| `ISpeechToTextService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/ISpeechToTextService.cs:10` |
| `ITextToSpeechService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/ITextToSpeechService.cs:9` |
| `LocalNotificationRequest` | record | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/LocalNotificationRequest.cs:15` |
| `PickedMedia` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IMediaPickerService.cs:29` |
| `PushDeviceToken` | record | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities` | `MMCA.Common.UI/Services/Capabilities/IPushDeviceTokenProvider.cs:19` |
| `BrowserAccessibilityAnnouncer` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Browser` | `MMCA.Common.UI/Services/Capabilities/Browser/BrowserAccessibilityAnnouncer.cs:8` |
| `BrowserClipboardService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Browser` | `MMCA.Common.UI/Services/Capabilities/Browser/BrowserClipboardService.cs:4` |
| `BrowserConnectivityStatusService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Browser` | `MMCA.Common.UI/Services/Capabilities/Browser/BrowserConnectivityStatusService.cs:11` |
| `BrowserDevicePreferences` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Browser` | `MMCA.Common.UI/Services/Capabilities/Browser/BrowserDevicePreferences.cs:10` |
| `BrowserExternalLinkService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Browser` | `MMCA.Common.UI/Services/Capabilities/Browser/BrowserExternalLinkService.cs:8` |
| `BrowserLocalCacheStore` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Browser` | `MMCA.Common.UI/Services/Capabilities/Browser/BrowserLocalCacheStore.cs:10` |
| `BrowserMapNavigationService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Browser` | `MMCA.Common.UI/Services/Capabilities/Browser/BrowserMapNavigationService.cs:7` |
| `BrowserShareService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Browser` | `MMCA.Common.UI/Services/Capabilities/Browser/BrowserShareService.cs:8` |
| `CapabilitiesJsModule` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Browser` | `MMCA.Common.UI/Services/Capabilities/Browser/CapabilitiesJsModule.cs:12` |
| `AlwaysOnlineConnectivityStatusService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/AlwaysOnlineConnectivityStatusService.cs:7` |
| `InMemoryDevicePreferences` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/InMemoryDevicePreferences.cs:10` |
| `NullAccessibilityAnnouncer` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullAccessibilityAnnouncer.cs:4` |
| `NullBarcodeScannerService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullBarcodeScannerService.cs:9` |
| `NullBatteryStatusService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullBatteryStatusService.cs:4` |
| `NullBiometricAuthenticator` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullBiometricAuthenticator.cs:4` |
| `NullClipboardService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullClipboardService.cs:4` |
| `NullExternalLinkService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullExternalLinkService.cs:7` |
| `NullGeocodingService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullGeocodingService.cs:4` |
| `NullGeolocationService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullGeolocationService.cs:4` |
| `NullHapticFeedbackService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullHapticFeedbackService.cs:4` |
| `NullLocalCacheStore` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullLocalCacheStore.cs:4` |
| `NullLocalNotificationService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullLocalNotificationService.cs:4` |
| `NullMapNavigationService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullMapNavigationService.cs:4` |
| `NullMediaPickerService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullMediaPickerService.cs:7` |
| `NullPushDeviceTokenProvider` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullPushDeviceTokenProvider.cs:9` |
| `NullPushRegistrationService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullPushRegistrationService.cs:7` |
| `NullScreenshotService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullScreenshotService.cs:4` |
| `NullShareService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullShareService.cs:4` |
| `NullSpeechToTextService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullSpeechToTextService.cs:6` |
| `NullTextToSpeechService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/NullTextToSpeechService.cs:4` |
| `UnavailableExternalAuthBroker` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Capabilities.Fallbacks` | `MMCA.Common.UI/Services/Capabilities/Fallbacks/UnavailableExternalAuthBroker.cs:7` |
| `BackNavigationResult` | record | MMCA.Common.UI | `MMCA.Common.UI.Services.Navigation` | `MMCA.Common.UI/Services/Navigation/MauiBackNavigationBridge.cs:19` |
| `MauiBackNavigationBridge` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Navigation` | `MMCA.Common.UI/Services/Navigation/MauiBackNavigationBridge.cs:28` |
| `NavigationHistoryService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Navigation` | `MMCA.Common.UI/Services/Navigation/NavigationHistoryService.cs:12` |
| `ReturnUrlProtector` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Navigation` | `MMCA.Common.UI/Services/Navigation/ReturnUrlProtector.cs:9` |
| `ChannelReferenceCounter` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Notifications` | `MMCA.Common.UI/Services/Notifications/ChannelReferenceCounter.cs:16` |
| `ChannelSubscription` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Notifications` | `MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:412` |
| `INotificationInboxUIService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Notifications` | `MMCA.Common.UI/Services/Notifications/INotificationInboxUIService.cs:9` |
| `INotificationScopeProvider` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Notifications` | `MMCA.Common.UI/Services/Notifications/INotificationScopeProvider.cs:14` |
| `IPushNotificationUIService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Notifications` | `MMCA.Common.UI/Services/Notifications/IPushNotificationUIService.cs:9` |
| `NotificationHubService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Notifications` | `MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:26` |
| `NotificationInboxService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Notifications` | `MMCA.Common.UI/Services/Notifications/NotificationInboxService.cs:28` |
| `NotificationState` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Notifications` | `MMCA.Common.UI/Services/Notifications/NotificationState.cs:8` |
| `NullNotificationScopeProvider` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Notifications` | `MMCA.Common.UI/Services/Notifications/NullNotificationScopeProvider.cs:8` |
| `PushNotificationService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Notifications` | `MMCA.Common.UI/Services/Notifications/PushNotificationService.cs:15` |
| `BrandColors` | class | MMCA.Common.UI | `MMCA.Common.UI.Theme` | `MMCA.Common.UI/Theme/BrandColors.cs:10` |
| `MMCATheme` | class | MMCA.Common.UI | `MMCA.Common.UI.Theme` | `MMCA.Common.UI/Theme/MMCATheme.cs:9` |
| `ComponentsPageE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/ComponentsPageE2ETests.cs:10` |
| `DarkModeE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/DarkModeE2ETests.cs:16` |
| `ForgotPasswordPageE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/ForgotPasswordPageE2ETests.cs:9` |
| `LoginPageE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/LoginPageE2ETests.cs:9` |
| `MobileTopRowE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/MobileTopRowE2ETests.cs:18` |
| `NotificationPagesE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/NotificationPagesE2ETests.cs:13` |
| `PseudoLocalizationE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/PseudoLocalizationE2ETests.cs:24` |
| `RegisterPageE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/RegisterPageE2ETests.cs:9` |
| `ResetPasswordPageE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/ResetPasswordPageE2ETests.cs:9` |
| `StickySidebarE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/StickySidebarE2ETests.cs:23` |
| `WebVitalsBudgetTests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/WebVitalsBudgetTests.cs:12` |
| `WebVitalsE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/WebVitalsE2ETests.cs:16` |
| `GalleryAxeTestBase` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests.Infrastructure` | `MMCA.Common.UI.E2E.Tests/Infrastructure/GalleryAxeTestBase.cs:14` |
| `GalleryE2ECollection` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests.Infrastructure` | `MMCA.Common.UI.E2E.Tests/Infrastructure/GalleryE2ECollection.cs:11` |
| `GalleryHostFixture` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests.Infrastructure` | `MMCA.Common.UI.E2E.Tests/Infrastructure/GalleryHostFixture.cs:17` |
| `GalleryHost` | class | MMCA.Common.UI.Gallery | `MMCA.Common.UI.Gallery` | `MMCA.Common.UI.Gallery/GalleryHost.cs:21` |
| `GalleryAuthenticationStateProvider` | class | MMCA.Common.UI.Gallery | `MMCA.Common.UI.Gallery.Stubs` | `MMCA.Common.UI.Gallery/Stubs/GalleryAuthenticationStateProvider.cs:16` |
| `GalleryFakeAuthenticationHandler` | class | MMCA.Common.UI.Gallery | `MMCA.Common.UI.Gallery.Stubs` | `MMCA.Common.UI.Gallery/Stubs/GalleryFakeAuthenticationHandler.cs:19` |
| `GalleryUIModule` | class | MMCA.Common.UI.Gallery | `MMCA.Common.UI.Gallery.Stubs` | `MMCA.Common.UI.Gallery/Stubs/GalleryUIModule.cs:13` |
| `NoOpAuthUIService` | class | MMCA.Common.UI.Gallery | `MMCA.Common.UI.Gallery.Stubs` | `MMCA.Common.UI.Gallery/Stubs/NoOpAuthUIService.cs:12` |
| `NullTokenRefresher` | class | MMCA.Common.UI.Gallery | `MMCA.Common.UI.Gallery.Stubs` | `MMCA.Common.UI.Gallery/Stubs/NullTokenRefresher.cs:9` |
| `NullTokenStorageService` | class | MMCA.Common.UI.Gallery | `MMCA.Common.UI.Gallery.Stubs` | `MMCA.Common.UI.Gallery/Stubs/NullTokenStorageService.cs:10` |
| `StubNotificationInboxUIService` | class | MMCA.Common.UI.Gallery | `MMCA.Common.UI.Gallery.Stubs` | `MMCA.Common.UI.Gallery/Stubs/StubNotificationInboxUIService.cs:11` |
| `StubPushNotificationUIService` | class | MMCA.Common.UI.Gallery | `MMCA.Common.UI.Gallery.Stubs` | `MMCA.Common.UI.Gallery/Stubs/StubPushNotificationUIService.cs:11` |
| `DependencyInjection` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui` | `MMCA.Common.UI.Maui/DependencyInjection.cs:16` |
| `DeviceCapabilitiesInitializer` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui` | `MMCA.Common.UI.Maui/DeviceCapabilitiesInitializer.cs:14` |
| `HostingDependencyInjection` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui` | `MMCA.Common.UI.Maui/HostingDependencyInjection.cs:14` |
| `MainPageBase` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui` | `MMCA.Common.UI.Maui/MainPageBase.cs:20` |
| `BarcodeScanPage` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/BarcodeScanPage.cs:21` |
| `MauiAccessibilityAnnouncer` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiAccessibilityAnnouncer.cs:9` |
| `MauiBarcodeScannerService` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiBarcodeScannerService.cs:24` |
| `MauiBatteryStatusService` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiBatteryStatusService.cs:9` |
| `MauiBiometricAuthenticator` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiBiometricAuthenticator.cs:13` |
| `MauiClipboardService` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiClipboardService.cs:6` |
| `MauiConnectivityStatusService` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiConnectivityStatusService.cs:11` |
| `MauiDevicePreferences` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiDevicePreferences.cs:12` |
| `MauiExternalAuthBroker` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiExternalAuthBroker.cs:19` |
| `MauiExternalLinkService` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiExternalLinkService.cs:10` |
| `MauiFormFactor` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiFormFactor.cs:12` |
| `MauiGeocodingService` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiGeocodingService.cs:10` |
| `MauiGeolocationService` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiGeolocationService.cs:11` |
| `MauiHapticFeedbackService` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiHapticFeedbackService.cs:11` |
| `MauiLocalCacheStore` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiLocalCacheStore.cs:11` |
| `MauiLocalNotificationService` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiLocalNotificationService.cs:13` |
| `MauiMapNavigationService` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiMapNavigationService.cs:11` |
| `MauiMediaPickerService` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiMediaPickerService.cs:11` |
| `MauiPushRegistrationService` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiPushRegistrationService.cs:15` |
| `MauiScreenshotService` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiScreenshotService.cs:10` |
| `MauiShareService` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiShareService.cs:6` |
| `MauiSpeechToTextService` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiSpeechToTextService.cs:14` |
| `MauiTextToSpeechService` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiTextToSpeechService.cs:12` |
| `MauiCultureApplier` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Globalization` | `MMCA.Common.UI.Maui/Globalization/MauiCultureApplier.cs:22` |
| `MauiCultureInitializer` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Globalization` | `MMCA.Common.UI.Maui/Globalization/MauiCultureInitializer.cs:14` |
| `MauiCultureStore` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Globalization` | `MMCA.Common.UI.Maui/Globalization/MauiCultureStore.cs:19` |
| `MauiTokenStorageService` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Services` | `MMCA.Common.UI.Maui/Services/MauiTokenStorageService.cs:22` |
| `BunitTestBase` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests` | `MMCA.Common.UI.Tests/BunitTestBase.cs:15` |
| `CultureSwitcherTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/CultureSwitcherTests.cs:17` |
| `DeleteConfirmationTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/DeleteConfirmationTests.cs:17` |
| `DocumentLanguageTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/DocumentLanguageTests.cs:13` |
| `EmptyStateTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/EmptyStateTests.cs:6` |
| `MmcaThemeProvidersTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/MmcaThemeProvidersTests.cs:19` |
| `MobileCardListTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/MobileCardListTests.cs:8` |
| `MobileInfiniteScrollListTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/MobileInfiniteScrollListTests.cs:11` |
| `NotificationBellHost` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/NotificationBellTests.cs:17` |
| `NotificationBellTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/NotificationBellTests.cs:48` |
| `NotificationListenerTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/NotificationListenerTests.cs:23` |
| `PageStateScopeTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/PageStateScopeTests.cs:12` |
| `PrimitivesSnapshotTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/PrimitivesSnapshotTests.cs:14` |
| `PrimitivesTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/PrimitivesTests.cs:6` |
| `QrCodeImageTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/QrCodeImageTests.cs:11` |
| `RecordingCultureApplier` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/CultureSwitcherTests.cs:83` |
| `RedirectToLoginTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/RedirectToLoginTests.cs:12` |
| `ThemeToggleTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/ThemeToggleTests.cs:16` |
| `UnsavedChangesGuardTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/UnsavedChangesGuardTests.cs:8` |
| `BiometricGateTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components.Capabilities` | `MMCA.Common.UI.Tests/Components/Capabilities/BiometricGateTests.cs:19` |
| `DeepLinkListenerTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components.Capabilities` | `MMCA.Common.UI.Tests/Components/Capabilities/DeepLinkListenerTests.cs:14` |
| `ExternalLinkTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components.Capabilities` | `MMCA.Common.UI.Tests/Components/Capabilities/ExternalLinkTests.cs:15` |
| `FakeBiometricAuthenticator` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components.Capabilities` | `MMCA.Common.UI.Tests/Components/Capabilities/BiometricGateTests.cs:127` |
| `FakeConnectivityService` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components.Capabilities` | `MMCA.Common.UI.Tests/Components/Capabilities/OfflineBannerTests.cs:56` |
| `FakeDevicePreferences` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components.Capabilities` | `MMCA.Common.UI.Tests/Components/Capabilities/BiometricGateTests.cs:143` |
| `FakeExternalLinkService` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components.Capabilities` | `MMCA.Common.UI.Tests/Components/Capabilities/ExternalLinkTests.cs:63` |
| `OfflineBannerTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components.Capabilities` | `MMCA.Common.UI.Tests/Components/Capabilities/OfflineBannerTests.cs:15` |
| `MoneyExtensionsTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Extensions` | `MMCA.Common.UI.Tests/Extensions/MoneyExtensionsTests.cs:7` |
| `EndpointCultureApplierTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Globalization` | `MMCA.Common.UI.Tests/Globalization/EndpointCultureApplierTests.cs:15` |
| `FakeStringLocalizer` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Globalization` | `MMCA.Common.UI.Tests/Globalization/PseudoLocalizationTests.cs:126` |
| `FakeStringLocalizerFactory` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Globalization` | `MMCA.Common.UI.Tests/Globalization/PseudoLocalizationTests.cs:149` |
| `PseudoLocalizationTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Globalization` | `MMCA.Common.UI.Tests/Globalization/PseudoLocalizationTests.cs:9` |
| `ResxMudLocalizerTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Globalization` | `MMCA.Common.UI.Tests/Globalization/ResxMudLocalizerTests.cs:14` |
| `CapturedRequest` | record | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Infrastructure` | `MMCA.Common.UI.Tests/Infrastructure/HttpTestDoubles.cs:11` |
| `CapturingHttpMessageHandlerTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Infrastructure` | `MMCA.Common.UI.Tests/Infrastructure/CapturingHttpMessageHandlerTests.cs:16` |
| `SharedHttpTestDoublesTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Infrastructure` | `MMCA.Common.UI.Tests/Infrastructure/SharedHttpTestDoublesTests.cs:15` |
| `StubHttpClientFactory` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Infrastructure` | `MMCA.Common.UI.Tests/Infrastructure/HttpTestDoubles.cs:57` |
| `StubHttpMessageHandler` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Infrastructure` | `MMCA.Common.UI.Tests/Infrastructure/HttpTestDoubles.cs:22` |
| `StubTokenStorageServiceTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Infrastructure` | `MMCA.Common.UI.Tests/Infrastructure/StubTokenStorageServiceTests.cs:13` |
| `UiHttpServiceHarnessTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Infrastructure` | `MMCA.Common.UI.Tests/Infrastructure/UiHttpServiceHarnessTests.cs:13` |
| `NavMenuTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Layout` | `MMCA.Common.UI.Tests/Layout/NavMenuTests.cs:21` |
| `StubUiModule` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Layout` | `MMCA.Common.UI.Tests/Layout/NavMenuTests.cs:136` |
| `ForbiddenTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages` | `MMCA.Common.UI.Tests/Pages/ForbiddenTests.cs:10` |
| `AuthModelValidationTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Auth` | `MMCA.Common.UI.Tests/Pages/Auth/AuthModelValidationTests.cs:11` |
| `RegisterFormTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Auth` | `MMCA.Common.UI.Tests/Pages/Auth/RegisterFormTests.cs:16` |
| `DataGridListPageBaseTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Common` | `MMCA.Common.UI.Tests/Pages/Common/DataGridListPageBaseTests.cs:19` |
| `ErrorMessagesTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Common` | `MMCA.Common.UI.Tests/Pages/Common/ErrorMessagesTests.cs:12` |
| `OtherDomainException` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Common` | `MMCA.Common.UI.Tests/Pages/Common/ErrorMessagesTests.cs:77` |
| `TestGridPage` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Common` | `MMCA.Common.UI.Tests/Pages/Common/DataGridListPageBaseTests.cs:39` |
| `WidgetRow` | record | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Common` | `MMCA.Common.UI.Tests/Pages/Common/DataGridListPageBaseTests.cs:37` |
| `NotificationInboxTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Notifications` | `MMCA.Common.UI.Tests/Pages/Notifications/NotificationInboxTests.cs:18` |
| `NotificationListTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Notifications` | `MMCA.Common.UI.Tests/Pages/Notifications/NotificationListTests.cs:18` |
| `NotificationSendTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Notifications` | `MMCA.Common.UI.Tests/Pages/Notifications/NotificationSendTests.cs:17` |
| `ApiClientRegistrationTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/ApiClientRegistrationTests.cs:16` |
| `ApiUserPreferenceWriterTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/ApiUserPreferenceWriterTests.cs:16` |
| `ChildEntityServiceBaseTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/ChildEntityServiceBaseTests.cs:18` |
| `EntityServiceBaseIdempotencyRetryTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/EntityServiceBaseIdempotencyRetryTests.cs:20` |
| `EntityServiceBaseTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/EntityServiceBaseTests.cs:22` |
| `LazyJsModuleTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/LazyJsModuleTests.cs:14` |
| `ListPageQueryStateServiceTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/ListPageQueryStateServiceTests.cs:6` |
| `ListPageStateServiceTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/ListPageStateServiceTests.cs:8` |
| `MembershipService` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/ChildEntityServiceBaseTests.cs:20` |
| `Mocks` | record | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/ChildEntityServiceBaseTests.cs:30` |
| `Mocks` | record | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/EntityServiceBaseTests.cs:34` |
| `RecordingNavigationManager` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/ListPageQueryStateServiceTests.cs:264` |
| `ScriptedHandler` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/EntityServiceBaseIdempotencyRetryTests.cs:41` |
| `ServiceExceptionHelperTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/ServiceExceptionHelperTests.cs:9` |
| `WasmFormFactorTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/WasmFormFactorTests.cs:13` |
| `WidgetDto` | record | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/EntityServiceBaseIdempotencyRetryTests.cs:24` |
| `WidgetDto` | record | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/EntityServiceBaseTests.cs:24` |
| `WidgetService` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/EntityServiceBaseIdempotencyRetryTests.cs:31` |
| `WidgetService` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/EntityServiceBaseTests.cs:31` |
| `AuthDelegatingHandlerTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Auth` | `MMCA.Common.UI.Tests/Services/Auth/AuthDelegatingHandlerTests.cs:15` |
| `DirectApiTokenRefresherTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Auth` | `MMCA.Common.UI.Tests/Services/Auth/DirectApiTokenRefresherTests.cs:17` |
| `JwtAuthenticationStateProviderTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Auth` | `MMCA.Common.UI.Tests/Services/Auth/JwtAuthenticationStateProviderTests.cs:13` |
| `Mocks` | record | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Auth` | `MMCA.Common.UI.Tests/Services/Auth/DirectApiTokenRefresherTests.cs:19` |
| `Mocks` | record | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Auth` | `MMCA.Common.UI.Tests/Services/Auth/WasmTokenStorageServiceTests.cs:17` |
| `SameOriginProxyTokenRefresherTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Auth` | `MMCA.Common.UI.Tests/Services/Auth/SameOriginProxyTokenRefresherTests.cs:14` |
| `WasmTokenStorageServiceTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Auth` | `MMCA.Common.UI.Tests/Services/Auth/WasmTokenStorageServiceTests.cs:15` |
| `CapabilityFallbackTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Capabilities` | `MMCA.Common.UI.Tests/Services/Capabilities/CapabilityFallbackTests.cs:12` |
| `DeepLinkDispatcherTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Capabilities` | `MMCA.Common.UI.Tests/Services/Capabilities/DeepLinkDispatcherTests.cs:11` |
| `ReturnUrlProtectorTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Navigation` | `MMCA.Common.UI.Tests/Services/Navigation/ReturnUrlProtectorTests.cs:6` |
| `CapturingLogger` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Notifications` | `MMCA.Common.UI.Tests/Services/Notifications/NotificationHubServiceTests.cs:286` |
| `ChannelReferenceCounterTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Notifications` | `MMCA.Common.UI.Tests/Services/Notifications/NotificationHubServiceTests.cs:320` |
| `ConcurrencyTrackingTokenStorage` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Notifications` | `MMCA.Common.UI.Tests/Services/Notifications/NotificationHubServiceTests.cs:241` |
| `Mocks` | record | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Notifications` | `MMCA.Common.UI.Tests/Services/Notifications/NotificationInboxServiceTests.cs:24` |
| `Mocks` | record | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Notifications` | `MMCA.Common.UI.Tests/Services/Notifications/PushNotificationServiceTests.cs:21` |
| `NotificationHubServiceTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Notifications` | `MMCA.Common.UI.Tests/Services/Notifications/NotificationHubServiceTests.cs:29` |
| `NotificationInboxServiceTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Notifications` | `MMCA.Common.UI.Tests/Services/Notifications/NotificationInboxServiceTests.cs:22` |
| `NotificationStateTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Notifications` | `MMCA.Common.UI.Tests/Services/Notifications/NotificationStateTests.cs:11` |
| `PushNotificationServiceTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Notifications` | `MMCA.Common.UI.Tests/Services/Notifications/PushNotificationServiceTests.cs:19` |
| `StubScopeProvider` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Notifications` | `MMCA.Common.UI.Tests/Services/Notifications/NotificationInboxServiceTests.cs:27` |
| `StubScopeProvider` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Notifications` | `MMCA.Common.UI.Tests/Services/Notifications/PushNotificationServiceTests.cs:24` |
| `BrandColorTokenTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Theme` | `MMCA.Common.UI.Tests/Theme/BrandColorTokenTests.cs:14` |
| `DependencyInjection` | class | MMCA.Common.UI.Web | `MMCA.Common.UI.Web` | `MMCA.Common.UI.Web/DependencyInjection.cs:14` |
| `BlazorCspPolicyProvider` | class | MMCA.Common.UI.Web | `MMCA.Common.UI.Web.Security` | `MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:21` |
| `ServerTokenStorageService` | class | MMCA.Common.UI.Web | `MMCA.Common.UI.Web.Services` | `MMCA.Common.UI.Web/Services/ServerTokenStorageService.cs:17` |
| `WebFormFactor` | class | MMCA.Common.UI.Web | `MMCA.Common.UI.Web.Services` | `MMCA.Common.UI.Web/Services/WebFormFactor.cs:12` |
| `BlazorCspPolicyProviderTests` | class | MMCA.Common.UI.Web.Tests | `MMCA.Common.UI.Web.Tests.Security` | `MMCA.Common.UI.Web.Tests/Security/BlazorCspPolicyProviderTests.cs:21` |
| `Mocks` | record | MMCA.Common.UI.Web.Tests | `MMCA.Common.UI.Web.Tests.Services` | `MMCA.Common.UI.Web.Tests/Services/ServerTokenStorageServiceTests.cs:25` |
| `ServerTokenStorageServiceTests` | class | MMCA.Common.UI.Web.Tests | `MMCA.Common.UI.Web.Tests.Services` | `MMCA.Common.UI.Web.Tests/Services/ServerTokenStorageServiceTests.cs:19` |
| `WebFormFactorTests` | class | MMCA.Common.UI.Web.Tests | `MMCA.Common.UI.Web.Tests.Services` | `MMCA.Common.UI.Web.Tests/Services/WebFormFactorTests.cs:17` |

## `extension(T)` blocks

| Receiver | Assembly | File:Line |
|----------|----------|-----------|
| `ICurrentUserService currentUserService` | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API/Authorization/CurrentUserServiceExtensions.cs:12` |
| `IServiceCollection services` | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API/DependencyInjection.cs:16` |
| `IServiceCollection services` | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application/DependencyInjection.cs:41` |
| `IServiceCollection services` | MMCA.ADC.Conference.Contracts | `MMCA.ADC.Conference.Contracts/DependencyInjection.cs:17` |
| `IServiceCollection services` | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:14` |
| `IServiceCollection services` | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI/DependencyInjection.cs:13` |
| `IServiceCollection services` | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API/DependencyInjection.cs:16` |
| `IServiceCollection services` | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application/DependencyInjection.cs:30` |
| `IServiceCollection services` | MMCA.ADC.Engagement.Contracts | `MMCA.ADC.Engagement.Contracts/DependencyInjection.cs:18` |
| `IServiceCollection services` | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure/DependencyInjection.cs:11` |
| `IServiceCollection services` | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI/DependencyInjection.cs:17` |
| `IServiceCollection services` | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API/DependencyInjection.cs:20` |
| `IServiceCollection services` | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application/DependencyInjection.cs:21` |
| `IServiceCollection services` | MMCA.ADC.Identity.Contracts | `MMCA.ADC.Identity.Contracts/DependencyInjection.cs:16` |
| `IServiceCollection services` | MMCA.ADC.Identity.Infrastructure | `MMCA.ADC.Identity.Infrastructure/DependencyInjection.cs:13` |
| `IServiceCollection services` | MMCA.ADC.Identity.UI | `MMCA.ADC.Identity.UI/DependencyInjection.cs:13` |
| `IServiceCollection services` | MMCA.ADC.Notification.API | `MMCA.ADC.Notification.API/DependencyInjection.cs:15` |
| `IServiceCollection services` | MMCA.ADC.Notification.Application | `MMCA.ADC.Notification.Application/DependencyInjection.cs:14` |
| `IServiceCollection services` | MMCA.ADC.Notification.Contracts | `MMCA.ADC.Notification.Contracts/DependencyInjection.cs:18` |
| `IServiceCollection services` | MMCA.Common.API | `MMCA.Common.API/Authentication/ExternalAuthExtensions.cs:29` |
| `IServiceCollection services` | MMCA.Common.API | `MMCA.Common.API/Authorization/AuthorizationExtensions.cs:14` |
| `IServiceCollection services` | MMCA.Common.API | `MMCA.Common.API/Caching/OutputCacheEvictionExtensions.cs:16` |
| `OutputCacheOptions options` | MMCA.Common.API | `MMCA.Common.API/Caching/OutputCacheOptionsExtensions.cs:8` |
| `IServiceCollection services` | MMCA.Common.API | `MMCA.Common.API/DependencyInjection.cs:27` |
| `IMvcBuilder builder` | MMCA.Common.API | `MMCA.Common.API/Notifications/DependencyInjection.cs:11` |
| `IApplicationBuilder app` | MMCA.Common.API | `MMCA.Common.API/SessionCookies/CookieSessionRefreshMiddleware.cs:37` |
| `AuthenticationBuilder builder` | MMCA.Common.API | `MMCA.Common.API/SessionCookies/SessionCookieAuthenticationHandler.cs:92` |
| `IEndpointRouteBuilder endpoints` | MMCA.Common.API | `MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:20` |
| `IEndpointRouteBuilder endpoints` | MMCA.Common.API | `MMCA.Common.API/Startup/AppAssociationEndpointExtensions.cs:26` |
| `IServiceProvider services` | MMCA.Common.API | `MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:23` |
| `IEndpointRouteBuilder endpoints` | MMCA.Common.API | `MMCA.Common.API/Startup/JwksEndpointExtensions.cs:22` |
| `IServiceCollection services` | MMCA.Common.API | `MMCA.Common.API/Startup/MiniProfilerExtensions.cs:11` |
| `IEndpointRouteBuilder endpoints` | MMCA.Common.API | `MMCA.Common.API/Startup/OidcDiscoveryEndpointExtensions.cs:49` |
| `WebApplication app` | MMCA.Common.API | `MMCA.Common.API/Startup/OpenApiEndpointExtensions.cs:24` |
| `WebApplication app` | MMCA.Common.API | `MMCA.Common.API/Startup/SignalRExtensions.cs:14` |
| `IServiceCollection services` | MMCA.Common.API | `MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:236` |
| `WebApplication app` | MMCA.Common.API | `MMCA.Common.API/Startup/WebApplicationExtensions.cs:35` |
| `IServiceCollection services` | MMCA.Common.Application | `MMCA.Common.Application/DependencyInjection.cs:24` |
| `ValidationResult result` | MMCA.Common.Application | `MMCA.Common.Application/Extensions/ValidationFailureExtensions.cs:11` |
| `IServiceCollection services` | MMCA.Common.Application | `MMCA.Common.Application/Notifications/DependencyInjection.cs:28` |
| `IServiceCollection services` | MMCA.Common.Aspire | `MMCA.Common.Aspire/Extensions.cs:306` |
| `WebApplication app` | MMCA.Common.Aspire | `MMCA.Common.Aspire/Extensions.cs:323` |
| `IApplicationBuilder app` | MMCA.Common.Aspire | `MMCA.Common.Aspire/Gateway/GatewayCorrelationMiddleware.cs:75` |
| `IServiceCollection services` | MMCA.Common.Aspire | `MMCA.Common.Aspire/Gateway/GatewayHealthCheckExtensions.cs:41` |
| `IServiceCollection services` | MMCA.Common.Aspire | `MMCA.Common.Aspire/Gateway/GatewayRateLimitingExtensions.cs:133` |
| `IApplicationBuilder app` | MMCA.Common.Aspire | `MMCA.Common.Aspire/Gateway/GatewayRateLimitingExtensions.cs:190` |
| `IServiceCollection services` | MMCA.Common.Aspire | `MMCA.Common.Aspire/GatewayCorsExtensions.cs:18` |
| `WebApplicationBuilder builder` | MMCA.Common.Aspire | `MMCA.Common.Aspire/Kestrel/KestrelEndpointExtensions.cs:39` |
| `IServiceCollection services` | MMCA.Common.Aspire | `MMCA.Common.Aspire/Security/SecurityHeaders.cs:156` |
| `IApplicationBuilder app` | MMCA.Common.Aspire | `MMCA.Common.Aspire/Security/SecurityHeaders.cs:186` |
| `IDistributedApplicationBuilder builder` | MMCA.Common.Aspire.Hosting | `MMCA.Common.Aspire.Hosting/Extensions.cs:37` |
| `IResourceBuilder<ProjectResource> identity` | MMCA.Common.Aspire.Hosting | `MMCA.Common.Aspire.Hosting/Extensions.cs:124` |
| `IResourceBuilder<ProjectResource> service` | MMCA.Common.Aspire.Hosting | `MMCA.Common.Aspire.Hosting/Extensions.cs:194` |
| `Type entityType` | MMCA.Common.Domain | `MMCA.Common.Domain/Extensions/EntityTypeExtensions.cs:11` |
| `IServiceCollection services` | MMCA.Common.Grpc | `MMCA.Common.Grpc/DependencyInjection.cs:17` |
| `ErrorType errorType` | MMCA.Common.Grpc | `MMCA.Common.Grpc/ResultGrpcExtensions.cs:46` |
| `Result result` | MMCA.Common.Grpc | `MMCA.Common.Grpc/ResultGrpcExtensions.cs:57` |
| `IReadOnlyList<Error> errors` | MMCA.Common.Grpc | `MMCA.Common.Grpc/ResultGrpcExtensions.cs:95` |
| `IServiceCollection services` | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure/DependencyInjection.cs:42` |
| `IndexBuilder indexBuilder` | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure/Persistence/Configuration/IndexBuilderExtensions.cs:12` |
| `ModelBuilder modelBuilder` | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure/Persistence/DbContexts/ModelBuilderExtensions.cs:12` |
| `IBusRegistrationConfigurator x` | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure/Services/IntegrationEventConsumerExtensions.cs:14` |
| `string? id` | MMCA.Common.Shared | `MMCA.Common.Shared/Extensions/DomainHelper.cs:13` |
| `IServiceCollection services` | MMCA.Common.Testing | `MMCA.Common.Testing/FeatureManagementTestExtensions.cs:12` |
| `Assembly assembly` | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture/RuleHelpers.cs:16` |
| `Type type` | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture/RuleHelpers.cs:40` |
| `PropertyInfo property` | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture/RuleHelpers.cs:114` |
| `IPage page` | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:21` |
| `ILocator locator` | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:185` |
| `IServiceCollection services` | MMCA.Common.UI | `MMCA.Common.UI/DependencyInjection.cs:23` |
| `Money price` | MMCA.Common.UI | `MMCA.Common.UI/Extensions/MoneyExtensions.cs:16` |
| `IReadOnlyCollection<Money> prices` | MMCA.Common.UI | `MMCA.Common.UI/Extensions/MoneyExtensions.cs:23` |
| `IApplicationBuilder app` | MMCA.Common.UI | `MMCA.Common.UI/Extensions/WebApplicationExtensions.cs:10` |
| `IServiceCollection services` | MMCA.Common.UI | `MMCA.Common.UI/Notifications/DependencyInjection.cs:14` |
| `IServiceCollection services` | MMCA.Common.UI | `MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:18` |
| `IServiceCollection services` | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui/DependencyInjection.cs:18` |
| `MauiAppBuilder builder` | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui/HostingDependencyInjection.cs:16` |
| `IServiceCollection services` | MMCA.Common.UI.Web | `MMCA.Common.UI.Web/DependencyInjection.cs:16` |

## Generated / excluded artifacts (no type sections written)

122 files excluded as generated (EF migrations, snapshots, *.g.cs, AssemblyInfo).

| File |
|------|
| `MMCA.ADC.Migrations.SqlServer.Conference/DesignTimeSQLServerDbContextFactory.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260606053146_InitialCreate.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260606053146_InitialCreate.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260609123507_AddInboxMessages.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260609123507_AddInboxMessages.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260710011421_AddEventQuestionModerationDefault.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260710011421_AddEventQuestionModerationDefault.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260720031645_CommonV1120OutboxLeaseAndSoftDeleteIndexFilters.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260720031645_CommonV1120OutboxLeaseAndSoftDeleteIndexFilters.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260725131458_AddOutboxInboxRetentionIndexes.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260725131458_AddOutboxInboxRetentionIndexes.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260805105907_AddQuestionAnswerUniqueUpsertIndexes.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260805105907_AddQuestionAnswerUniqueUpsertIndexes.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260812202047_AddSponsors.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260812202047_AddSponsors.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260813223101_AddRoomNameUniqueIndex.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260813223101_AddRoomNameUniqueIndex.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260813223144_RepairOrphanedSessionChildRows.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260813223144_RepairOrphanedSessionChildRows.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260814114613_AddAuditTrailAndScheduler.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260814114613_AddAuditTrailAndScheduler.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260814210425_AddEventOrganizerContactEmail.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260814210425_AddEventOrganizerContactEmail.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260814214554_AddEventSponsorshipPacketUrl.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260814214554_AddEventSponsorshipPacketUrl.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260819153953_AddEventTicketingUrl.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260819153953_AddEventTicketingUrl.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260819160828_AddActivity.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260819160828_AddActivity.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/SQLServerDbContextModelSnapshot.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/DesignTimeSQLServerDbContextFactory.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260606053150_InitialCreate.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260606053150_InitialCreate.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260609123513_AddInboxMessages.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260609123513_AddInboxMessages.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260710003630_AddLivePolls.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260710003630_AddLivePolls.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260710014410_AddSessionQuestions.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260710014410_AddSessionQuestions.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260719154351_AddUserSessionBookmarkSessionIdIndex.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260719154351_AddUserSessionBookmarkSessionIdIndex.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260720031650_CommonV1120OutboxLeaseAndSoftDeleteIndexFilters.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260720031650_CommonV1120OutboxLeaseAndSoftDeleteIndexFilters.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260725050113_AddLivePollSessionIdStatusIndex.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260725050113_AddLivePollSessionIdStatusIndex.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260725131500_AddOutboxInboxRetentionIndexes.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260725131500_AddOutboxInboxRetentionIndexes.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260813015755_AddCheckInsAndAttendeeBadges.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260813015755_AddCheckInsAndAttendeeBadges.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260813030258_AddPoints.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260813030258_AddPoints.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260813140927_AddSponsorVisitCheckIns.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260813140927_AddSponsorVisitCheckIns.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260814114616_AddAuditTrailAndScheduler.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/20260814114616_AddAuditTrailAndScheduler.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Engagement/Migrations/SQLServerDbContextModelSnapshot.cs` |
| `MMCA.ADC.Migrations.SqlServer.Identity/DesignTimeSQLServerDbContextFactory.cs` |
| `MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20260606053130_InitialCreate.cs` |
| `MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20260606053130_InitialCreate.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20260609123427_AddInboxMessages.cs` |
| `MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20260609123427_AddInboxMessages.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20260627221640_AddUserPreferences.cs` |
| `MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20260627221640_AddUserPreferences.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20260711050203_AddUserAvatar.cs` |
| `MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20260711050203_AddUserAvatar.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20260720031638_CommonV1120OutboxLeaseAndSoftDeleteIndexFilters.cs` |
| `MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20260720031638_CommonV1120OutboxLeaseAndSoftDeleteIndexFilters.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20260725131455_AddOutboxInboxRetentionIndexes.cs` |
| `MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20260725131455_AddOutboxInboxRetentionIndexes.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20260814114610_AddAuditTrailAndScheduler.cs` |
| `MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20260814114610_AddAuditTrailAndScheduler.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Identity/Migrations/SQLServerDbContextModelSnapshot.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/DesignTimeSQLServerDbContextFactory.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260606053154_InitialCreate.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260606053154_InitialCreate.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260609123517_AddInboxMessages.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260609123517_AddInboxMessages.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260720031653_CommonV1120OutboxLeaseAndSoftDeleteIndexFilters.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260720031653_CommonV1120OutboxLeaseAndSoftDeleteIndexFilters.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260725131502_AddOutboxInboxRetentionIndexes.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260725131502_AddOutboxInboxRetentionIndexes.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260803211109_AddPushNotificationDedupKey.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260803211109_AddPushNotificationDedupKey.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260804185520_CommonV1141PushNotificationDedupIndexSoftDeleteFilter.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260804185520_CommonV1141PushNotificationDedupIndexSoftDeleteFilter.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260814010643_AddPushNotificationScopeKey.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260814010643_AddPushNotificationScopeKey.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/SQLServerDbContextModelSnapshot.cs` |
| `MMCA.ADC.Migrations.SqlServer/DesignTimeSQLServerDbContextFactory.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260323183711_InitialCreate.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260323183711_InitialCreate.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260324013135_AddSpeakerPropertyMaxLengthsAndSessionRoomDeleteBehavior.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260324013135_AddSpeakerPropertyMaxLengthsAndSessionRoomDeleteBehavior.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260327153342_AddSpeakerLinkedUserIdUniqueIndex.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260327153342_AddSpeakerLinkedUserIdUniqueIndex.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260327154414_MakeCategoryAndCategoryItemIdsDatabaseGenerated.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260327154414_MakeCategoryAndCategoryItemIdsDatabaseGenerated.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260329030817_AddRowVersionToAllEntities.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260329030817_AddRowVersionToAllEntities.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260329065409_AddExternalLoginProviderFields.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260329065409_AddExternalLoginProviderFields.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260329195439_AddNotificationModule.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260329195439_AddNotificationModule.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260330111101_AddUserNotificationEntity.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260330111101_AddUserNotificationEntity.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260330120317_UpdateNotificationNamespaces.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260330120317_UpdateNotificationNamespaces.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260402223839_AddFilteredIndexesOnIsDeleted.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260402223839_AddFilteredIndexesOnIsDeleted.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260404195749_AddSessionAiScore.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260404195749_AddSessionAiScore.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260404234718_ChangeAiScoresToDecimal.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260404234718_ChangeAiScoresToDecimal.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260404235704_AddDepthAndCredibilityScores.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260404235704_AddDepthAndCredibilityScores.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260406151740_AddIsDeletedFilterToSessionAiScoreUniqueIndex.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260406151740_AddIsDeletedFilterToSessionAiScoreUniqueIndex.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260415002619_AddOutboxTraceContext.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260415002619_AddOutboxTraceContext.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260423223117_AlterSpeakerBioToNvarcharMax.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/20260423223117_AlterSpeakerBioToNvarcharMax.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer/Migrations/SQLServerDbContextModelSnapshot.cs` |
