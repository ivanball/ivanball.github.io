# Phase 0: Type Inventory

Generated mechanically by a Roslyn syntactic parse of every in-scope `.cs` file under
`MMCA.Common/Source`, `MMCA.Common/Tests`, `MMCA.ADC/Source`, `MMCA.ADC/Tests`.

- Files scanned: **2134** (in-scope **2066**, generated/excluded **68**)
- Type declaration rows (including partial-class fragments): **2616**
- Distinct type nodes (partials collapsed): **2497**
- `extension(T)` blocks: **46**

## Counts by kind

| Kind | Count (declarations) |
|------|------|
| class | 1982 |
| record | 440 |
| interface | 164 |
| enum | 17 |
| record struct | 12 |
| delegate | 1 |

## Counts by assembly (distinct nodes)

| Assembly | Distinct types |
|----------|------|
| MMCA.ADC.Architecture.Tests | 26 |
| MMCA.ADC.Conference.API | 33 |
| MMCA.ADC.Conference.API.Tests | 15 |
| MMCA.ADC.Conference.Application | 202 |
| MMCA.ADC.Conference.Application.Tests | 139 |
| MMCA.ADC.Conference.Contracts | 4 |
| MMCA.ADC.Conference.Domain | 39 |
| MMCA.ADC.Conference.Domain.Tests | 22 |
| MMCA.ADC.Conference.Infrastructure | 27 |
| MMCA.ADC.Conference.Infrastructure.Tests | 7 |
| MMCA.ADC.Conference.IntegrationTests | 36 |
| MMCA.ADC.Conference.Service | 3 |
| MMCA.ADC.Conference.Shared | 46 |
| MMCA.ADC.Conference.Shared.Tests | 17 |
| MMCA.ADC.Conference.UI | 79 |
| MMCA.ADC.Conference.UI.Tests | 25 |
| MMCA.ADC.CrossService.IntegrationTests | 12 |
| MMCA.ADC.E2E.Tests | 60 |
| MMCA.ADC.Engagement.API | 8 |
| MMCA.ADC.Engagement.API.Tests | 6 |
| MMCA.ADC.Engagement.Application | 46 |
| MMCA.ADC.Engagement.Application.Tests | 27 |
| MMCA.ADC.Engagement.Contracts | 3 |
| MMCA.ADC.Engagement.Domain | 20 |
| MMCA.ADC.Engagement.Domain.Tests | 6 |
| MMCA.ADC.Engagement.Infrastructure | 10 |
| MMCA.ADC.Engagement.Infrastructure.Tests | 2 |
| MMCA.ADC.Engagement.IntegrationTests | 13 |
| MMCA.ADC.Engagement.Service | 2 |
| MMCA.ADC.Engagement.Shared | 33 |
| MMCA.ADC.Engagement.Shared.Tests | 2 |
| MMCA.ADC.Engagement.UI | 37 |
| MMCA.ADC.Engagement.UI.Tests | 14 |
| MMCA.ADC.Gateway.Tests | 3 |
| MMCA.ADC.Identity.API | 10 |
| MMCA.ADC.Identity.API.Tests | 7 |
| MMCA.ADC.Identity.Application | 31 |
| MMCA.ADC.Identity.Application.Tests | 20 |
| MMCA.ADC.Identity.Contracts | 2 |
| MMCA.ADC.Identity.Domain | 7 |
| MMCA.ADC.Identity.Domain.Tests | 4 |
| MMCA.ADC.Identity.Infrastructure | 6 |
| MMCA.ADC.Identity.Infrastructure.Tests | 4 |
| MMCA.ADC.Identity.IntegrationTests | 28 |
| MMCA.ADC.Identity.Service | 1 |
| MMCA.ADC.Identity.Shared | 14 |
| MMCA.ADC.Identity.Shared.Tests | 3 |
| MMCA.ADC.Identity.UI | 7 |
| MMCA.ADC.Identity.UI.Tests | 6 |
| MMCA.ADC.Notification.API | 2 |
| MMCA.ADC.Notification.Application | 3 |
| MMCA.ADC.Notification.Contracts | 3 |
| MMCA.ADC.Notification.IntegrationTests | 7 |
| MMCA.ADC.Notification.Service | 2 |
| MMCA.ADC.Notification.Shared | 3 |
| MMCA.ADC.UI | 25 |
| MMCA.ADC.UI.Web.Client | 9 |
| MMCA.Common.API | 73 |
| MMCA.Common.API.Tests | 65 |
| MMCA.Common.Application | 139 |
| MMCA.Common.Application.Tests | 147 |
| MMCA.Common.Architecture.Tests | 22 |
| MMCA.Common.Aspire | 14 |
| MMCA.Common.Aspire.Hosting | 1 |
| MMCA.Common.Aspire.Tests | 10 |
| MMCA.Common.Benchmarks | 4 |
| MMCA.Common.Domain | 34 |
| MMCA.Common.Domain.Tests | 43 |
| MMCA.Common.Grpc | 5 |
| MMCA.Common.Grpc.Tests | 13 |
| MMCA.Common.Infrastructure | 125 |
| MMCA.Common.Infrastructure.Tests | 157 |
| MMCA.Common.Shared | 50 |
| MMCA.Common.Shared.Tests | 22 |
| MMCA.Common.Testing | 10 |
| MMCA.Common.Testing.Architecture | 36 |
| MMCA.Common.Testing.E2E | 21 |
| MMCA.Common.Testing.UI | 15 |
| MMCA.Common.UI | 141 |
| MMCA.Common.UI.E2E.Tests | 11 |
| MMCA.Common.UI.Gallery | 8 |
| MMCA.Common.UI.Maui | 24 |
| MMCA.Common.UI.Tests | 71 |
| MMCA.Common.UI.Web | 4 |
| MMCA.Common.UI.Web.Tests | 4 |

## Full inventory

| Type | Kind | Assembly | Namespace | File:Line |
|------|------|----------|-----------|-----------|
| `AdcArchitectureMap` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/AdcArchitectureMap.cs:10` |
| `BrandColorTokenTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/BrandColorTokenTests.cs:11` |
| `ConcurrencyConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/ConcurrencyConventionTests.cs:3` |
| `ConstructorDependencyCountTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/ConstructorDependencyCountTests.cs:9` |
| `ControllerConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/ControllerConventionTests.cs:3` |
| `DataResidencyTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:12` |
| `DomainPurityTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/DomainPurityTests.cs:3` |
| `EntityConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/EntityConventionTests.cs:3` |
| `EventConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/EventConventionTests.cs:3` |
| `FormsConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/FormsConventionTests.cs:14` |
| `FrameworkVersionConsistencyTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/FrameworkVersionConsistencyTests.cs:9` |
| `HandlerConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/HandlerConventionTests.cs:3` |
| `ImmutabilityTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/ImmutabilityTests.cs:3` |
| `IntegrationEventContractTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/IntegrationEventContractTests.cs:3` |
| `LayerDependencyTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/LayerDependencyTests.cs:3` |
| `LocalizedTextConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/LocalizedTextConventionTests.cs:14` |
| `MicroserviceExtractionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/MicroserviceExtractionTests.cs:3` |
| `ModuleIsolationTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/ModuleIsolationTests.cs:3` |
| `NamingConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/NamingConventionTests.cs:3` |
| `PiiConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/PiiConventionTests.cs:3` |
| `SharedLayerTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/SharedLayerTests.cs:3` |
| `SliceCohesionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/SliceCohesionTests.cs:8` |
| `SpecificationConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/SpecificationConventionTests.cs:8` |
| `StateManagementConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/StateManagementConventionTests.cs:11` |
| `TranslationCompletenessTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/TranslationCompletenessTests.cs:12` |
| `UIArchitectureConventionTests` | class | MMCA.ADC.Architecture.Tests | `MMCA.ADC.Architecture.Tests` | `MMCA.ADC.Architecture.Tests/UIArchitectureConventionTests.cs:12` |
| `AssemblyReference` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API` | `MMCA.ADC.Conference.API/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API` | `MMCA.ADC.Conference.API/AssemblyReference.cs:11` |
| `ConferenceModule` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API` | `MMCA.ADC.Conference.API/ConferenceModule.cs:15` |
| `ConferenceModuleSeeder` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API` | `MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:13` |
| `DependencyInjection` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API` | `MMCA.ADC.Conference.API/DependencyInjection.cs:14` |
| `AddCategoryItemRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:23` |
| `AddEventQuestionAnswerRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:26` |
| `AddEventSpeakerRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/EventSpeakersController.cs:22` |
| `AddRoomRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/RoomsController.cs:24` |
| `AddSessionCategoryItemRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SessionCategoryItemsController.cs:22` |
| `AddSessionQuestionAnswerRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:26` |
| `AddSessionSpeakerRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SessionSpeakersController.cs:23` |
| `AddSpeakerCategoryItemRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SpeakerCategoryItemsController.cs:22` |
| `CategoryItemsController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:60` |
| `ConferenceCategoriesController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/ConferenceCategoriesController.cs:32` |
| `EventQuestionAnswersController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:56` |
| `EventsController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/EventsController.cs:42` |
| `EventSpeakersController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/EventSpeakersController.cs:39` |
| `QuestionsController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/QuestionsController.cs:31` |
| `RoomsController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/RoomsController.cs:85` |
| `ServiceInfoController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/ServiceInfoController.cs:20` |
| `SessionCategoryItemsController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SessionCategoryItemsController.cs:39` |
| `SessionQuestionAnswersController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:56` |
| `SessionsController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SessionsController.cs:40` |
| `SessionSelectionController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SessionSelectionController.cs:30` |
| `SessionSpeakersController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SessionSpeakersController.cs:40` |
| `SpeakerCategoryItemsController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SpeakerCategoryItemsController.cs:39` |
| `SpeakersController` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SpeakersController.cs:41` |
| `UpdateCategoryItemRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:39` |
| `UpdateEventQuestionAnswerRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/EventQuestionAnswersController.cs:39` |
| `UpdateRoomRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/RoomsController.cs:52` |
| `UpdateSessionQuestionAnswerRequest` | record | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Controllers` | `MMCA.ADC.Conference.API/Controllers/SessionQuestionAnswersController.cs:39` |
| `ConferenceErrorResources` | class | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API.Resources` | `MMCA.ADC.Conference.API/Resources/ConferenceErrorResources.cs:11` |
| `ConferencePermissionGrantsTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Authorization` | `MMCA.ADC.Conference.API.Tests/Authorization/ConferencePermissionGrantsTests.cs:15` |
| `CategoryItemsControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/CategoryItemsControllerTests.cs:18` |
| `ConferenceCategoriesControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/ConferenceCategoriesControllerTests.cs:18` |
| `EventQuestionAnswersControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/EventQuestionAnswersControllerTests.cs:19` |
| `EventsControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/EventsControllerTests.cs:25` |
| `EventSpeakersControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/EventSpeakersControllerTests.cs:17` |
| `QuestionsControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/QuestionsControllerTests.cs:18` |
| `RoomsControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/RoomsControllerTests.cs:19` |
| `SessionCategoryItemsControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/SessionCategoryItemsControllerTests.cs:17` |
| `SessionQuestionAnswersControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/SessionQuestionAnswersControllerTests.cs:19` |
| `SessionsControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/SessionsControllerTests.cs:24` |
| `SessionSpeakersControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/SessionSpeakersControllerTests.cs:18` |
| `SpeakerCategoryItemsControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/SpeakerCategoryItemsControllerTests.cs:17` |
| `SpeakersControllerTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Controllers` | `MMCA.ADC.Conference.API.Tests/Controllers/SpeakersControllerTests.cs:25` |
| `ConferenceErrorResourcesTests` | class | MMCA.ADC.Conference.API.Tests | `MMCA.ADC.Conference.API.Tests.Localization` | `MMCA.ADC.Conference.API.Tests/Localization/ConferenceErrorResourcesTests.cs:15` |
| `AssemblyReference` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application` | `MMCA.ADC.Conference.Application/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application` | `MMCA.ADC.Conference.Application/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application` | `MMCA.ADC.Conference.Application/DependencyInjection.cs:34` |
| `ConferenceCategoryNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories` | `MMCA.ADC.Conference.Application/Categories/ConferenceCategoryNavigationPopulator.cs:11` |
| `CategoryItemDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.DTOs` | `MMCA.ADC.Conference.Application/Categories/DTOs/CategoryItemDTOMapper.cs:12` |
| `ConferenceCategoryDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.DTOs` | `MMCA.ADC.Conference.Application/Categories/DTOs/ConferenceCategoryDTOMapper.cs:13` |
| `AddCategoryItemCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem` | `MMCA.ADC.Conference.Application/Categories/UseCases/AddCategoryItem/AddCategoryItemCommand.cs:19` |
| `AddCategoryItemCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem` | `MMCA.ADC.Conference.Application/Categories/UseCases/AddCategoryItem/AddCategoryItemCommandValidator.cs:7` |
| `AddCategoryItemHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.AddCategoryItem` | `MMCA.ADC.Conference.Application/Categories/UseCases/AddCategoryItem/AddCategoryItemHandler.cs:15` |
| `ConferenceCategoryCreateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.Create` | `MMCA.ADC.Conference.Application/Categories/UseCases/Create/ConferenceCategoryCreateRequest.cs:10` |
| `ConferenceCategoryCreateRequestMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.Create` | `MMCA.ADC.Conference.Application/Categories/UseCases/Create/ConferenceCategoryCreateRequestMapper.cs:11` |
| `ConferenceCategoryCreateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.Create` | `MMCA.ADC.Conference.Application/Categories/UseCases/Create/ConferenceCategoryCreateRequestValidator.cs:7` |
| `CreateConferenceCategoryHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.Create` | `MMCA.ADC.Conference.Application/Categories/UseCases/Create/CreateConferenceCategoryHandler.cs:16` |
| `RemoveCategoryItemCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.RemoveCategoryItem` | `MMCA.ADC.Conference.Application/Categories/UseCases/RemoveCategoryItem/RemoveCategoryItemCommand.cs:15` |
| `RemoveCategoryItemHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.RemoveCategoryItem` | `MMCA.ADC.Conference.Application/Categories/UseCases/RemoveCategoryItem/RemoveCategoryItemHandler.cs:13` |
| `ConferenceCategoryUpdateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.Update` | `MMCA.ADC.Conference.Application/Categories/UseCases/Update/ConferenceCategoryUpdateRequest.cs:6` |
| `ConferenceCategoryUpdateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.Update` | `MMCA.ADC.Conference.Application/Categories/UseCases/Update/ConferenceCategoryUpdateRequestValidator.cs:7` |
| `UpdateConferenceCategoryCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.Update` | `MMCA.ADC.Conference.Application/Categories/UseCases/Update/UpdateConferenceCategoryCommand.cs:14` |
| `UpdateConferenceCategoryHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.Update` | `MMCA.ADC.Conference.Application/Categories/UseCases/Update/UpdateConferenceCategoryHandler.cs:15` |
| `UpdateCategoryItemCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem` | `MMCA.ADC.Conference.Application/Categories/UseCases/UpdateCategoryItem/UpdateCategoryItemCommand.cs:17` |
| `UpdateCategoryItemCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem` | `MMCA.ADC.Conference.Application/Categories/UseCases/UpdateCategoryItem/UpdateCategoryItemCommandValidator.cs:7` |
| `UpdateCategoryItemHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.UseCases.UpdateCategoryItem` | `MMCA.ADC.Conference.Application/Categories/UseCases/UpdateCategoryItem/UpdateCategoryItemHandler.cs:13` |
| `CategoryItemNameRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.Validation` | `MMCA.ADC.Conference.Application/Categories/Validation/ConferenceCategoryValidationRules.cs:26` |
| `CategoryItemSortRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.Validation` | `MMCA.ADC.Conference.Application/Categories/Validation/ConferenceCategoryValidationRules.cs:39` |
| `ConferenceCategoryTitleRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Categories.Validation` | `MMCA.ADC.Conference.Application/Categories/Validation/ConferenceCategoryValidationRules.cs:12` |
| `EventLiveValidationService` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events` | `MMCA.ADC.Conference.Application/Events/EventLiveValidationService.cs:18` |
| `EventNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events` | `MMCA.ADC.Conference.Application/Events/EventNavigationPopulator.cs:11` |
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
| `SessionizeQuestionAnswer` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Sessionize` | `MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:195` |
| `SessionizeResponse` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Sessionize` | `MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:6` |
| `SessionizeRoom` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Sessionize` | `MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:73` |
| `SessionizeSession` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Sessionize` | `MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:140` |
| `SessionizeSpeaker` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Sessionize` | `MMCA.ADC.Conference.Application/Events/Sessionize/SessionizeModels.cs:86` |
| `OwnEventQuestionAnswerSpecification` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Specifications` | `MMCA.ADC.Conference.Application/Events/Specifications/OwnEventQuestionAnswerSpecification.cs:11` |
| `PublishedEventSpecification` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Specifications` | `MMCA.ADC.Conference.Application/Events/Specifications/PublishedEventSpecification.cs:11` |
| `AddEventQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer` | `MMCA.ADC.Conference.Application/Events/UseCases/AddEventQuestionAnswer/AddEventQuestionAnswerCommand.cs:17` |
| `AddEventQuestionAnswerCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer` | `MMCA.ADC.Conference.Application/Events/UseCases/AddEventQuestionAnswer/AddEventQuestionAnswerCommandValidator.cs:8` |
| `AddEventQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.AddEventQuestionAnswer` | `MMCA.ADC.Conference.Application/Events/UseCases/AddEventQuestionAnswer/AddEventQuestionAnswerHandler.cs:17` |
| `AddEventSpeakerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker` | `MMCA.ADC.Conference.Application/Events/UseCases/AddEventSpeaker/AddEventSpeakerCommand.cs:15` |
| `AddEventSpeakerCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker` | `MMCA.ADC.Conference.Application/Events/UseCases/AddEventSpeaker/AddEventSpeakerCommandValidator.cs:8` |
| `AddEventSpeakerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.AddEventSpeaker` | `MMCA.ADC.Conference.Application/Events/UseCases/AddEventSpeaker/AddEventSpeakerHandler.cs:15` |
| `AddRoomCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.AddRoom` | `MMCA.ADC.Conference.Application/Events/UseCases/AddRoom/AddRoomCommand.cs:20` |
| `AddRoomCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.AddRoom` | `MMCA.ADC.Conference.Application/Events/UseCases/AddRoom/AddRoomCommandValidator.cs:7` |
| `AddRoomHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.AddRoom` | `MMCA.ADC.Conference.Application/Events/UseCases/AddRoom/AddRoomHandler.cs:15` |
| `CreateEventHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Create` | `MMCA.ADC.Conference.Application/Events/UseCases/Create/CreateEventHandler.cs:16` |
| `EventCreateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Create` | `MMCA.ADC.Conference.Application/Events/UseCases/Create/EventCreateRequest.cs:10` |
| `EventCreateRequestMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Create` | `MMCA.ADC.Conference.Application/Events/UseCases/Create/EventCreateRequestMapper.cs:11` |
| `EventCreateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Create` | `MMCA.ADC.Conference.Application/Events/UseCases/Create/EventCreateRequestValidator.cs:7` |
| `DeleteEventHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Delete` | `MMCA.ADC.Conference.Application/Events/UseCases/Delete/DeleteEventHandler.cs:16` |
| `PublishEventCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Publish` | `MMCA.ADC.Conference.Application/Events/UseCases/Publish/PublishEventCommand.cs:11` |
| `PublishEventHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Publish` | `MMCA.ADC.Conference.Application/Events/UseCases/Publish/PublishEventHandler.cs:13` |
| `CategorySyncStrategy` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/CategorySyncStrategy.cs:11` |
| `ISessionizeSyncStrategy` | interface | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/ISessionizeSyncStrategy.cs:7` |
| `QuestionSyncStrategy` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/QuestionSyncStrategy.cs:11` |
| `RefreshFromSessionizeCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeCommand.cs:18` |
| `RefreshFromSessionizeHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RefreshFromSessionizeHandler.cs:16` |
| `RoomSyncStrategy` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/RoomSyncStrategy.cs:8` |
| `SessionizeSyncContext` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/SessionizeSyncContext.cs:11` |
| `SessionizeSyncResult` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/ISessionizeSyncStrategy.cs:21` |
| `SessionSyncStrategy` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/SessionSyncStrategy.cs:12` |
| `SpeakerSyncStrategy` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RefreshFromSessionize` | `MMCA.ADC.Conference.Application/Events/UseCases/RefreshFromSessionize/SpeakerSyncStrategy.cs:12` |
| `RemoveEventQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventQuestionAnswer` | `MMCA.ADC.Conference.Application/Events/UseCases/RemoveEventQuestionAnswer/RemoveEventQuestionAnswerCommand.cs:13` |
| `RemoveEventQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventQuestionAnswer` | `MMCA.ADC.Conference.Application/Events/UseCases/RemoveEventQuestionAnswer/RemoveEventQuestionAnswerHandler.cs:14` |
| `RemoveEventSpeakerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventSpeaker` | `MMCA.ADC.Conference.Application/Events/UseCases/RemoveEventSpeaker/RemoveEventSpeakerCommand.cs:12` |
| `RemoveEventSpeakerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RemoveEventSpeaker` | `MMCA.ADC.Conference.Application/Events/UseCases/RemoveEventSpeaker/RemoveEventSpeakerHandler.cs:13` |
| `RemoveRoomCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RemoveRoom` | `MMCA.ADC.Conference.Application/Events/UseCases/RemoveRoom/RemoveRoomCommand.cs:12` |
| `RemoveRoomHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.RemoveRoom` | `MMCA.ADC.Conference.Application/Events/UseCases/RemoveRoom/RemoveRoomHandler.cs:13` |
| `UnpublishEventCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Unpublish` | `MMCA.ADC.Conference.Application/Events/UseCases/Unpublish/UnpublishEventCommand.cs:11` |
| `UnpublishEventHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Unpublish` | `MMCA.ADC.Conference.Application/Events/UseCases/Unpublish/UnpublishEventHandler.cs:13` |
| `EventUpdateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Update` | `MMCA.ADC.Conference.Application/Events/UseCases/Update/EventUpdateRequest.cs:7` |
| `EventUpdateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Update` | `MMCA.ADC.Conference.Application/Events/UseCases/Update/EventUpdateRequestValidator.cs:7` |
| `UpdateEventCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Update` | `MMCA.ADC.Conference.Application/Events/UseCases/Update/UpdateEventCommand.cs:15` |
| `UpdateEventHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Update` | `MMCA.ADC.Conference.Application/Events/UseCases/Update/UpdateEventHandler.cs:17` |
| `UpdateEventResult` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.Update` | `MMCA.ADC.Conference.Application/Events/UseCases/Update/UpdateEventCommand.cs:24` |
| `UpdateEventQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.UpdateEventQuestionAnswer` | `MMCA.ADC.Conference.Application/Events/UseCases/UpdateEventQuestionAnswer/UpdateEventQuestionAnswerCommand.cs:14` |
| `UpdateEventQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.UpdateEventQuestionAnswer` | `MMCA.ADC.Conference.Application/Events/UseCases/UpdateEventQuestionAnswer/UpdateEventQuestionAnswerHandler.cs:14` |
| `UpdateRoomCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom` | `MMCA.ADC.Conference.Application/Events/UseCases/UpdateRoom/UpdateRoomCommand.cs:18` |
| `UpdateRoomCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom` | `MMCA.ADC.Conference.Application/Events/UseCases/UpdateRoom/UpdateRoomCommandValidator.cs:7` |
| `UpdateRoomHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.UseCases.UpdateRoom` | `MMCA.ADC.Conference.Application/Events/UseCases/UpdateRoom/UpdateRoomHandler.cs:13` |
| `EventDateRangeRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:55` |
| `EventNameRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:13` |
| `EventTimeZoneRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/EventValidationRules.cs:25` |
| `RoomAccessibilityInfoRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:77` |
| `RoomCapacityRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:37` |
| `RoomFloorRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:51` |
| `RoomLocationRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:64` |
| `RoomNameRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:12` |
| `RoomSortRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Events.Validation` | `MMCA.ADC.Conference.Application/Events/Validation/RoomValidationRules.cs:25` |
| `QuestionDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.DTOs` | `MMCA.ADC.Conference.Application/Questions/DTOs/QuestionDTOMapper.cs:12` |
| `CreateQuestionHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.UseCases.Create` | `MMCA.ADC.Conference.Application/Questions/UseCases/Create/CreateQuestionHandler.cs:16` |
| `QuestionCreateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.UseCases.Create` | `MMCA.ADC.Conference.Application/Questions/UseCases/Create/QuestionCreateRequest.cs:10` |
| `QuestionCreateRequestMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.UseCases.Create` | `MMCA.ADC.Conference.Application/Questions/UseCases/Create/QuestionCreateRequestMapper.cs:11` |
| `QuestionCreateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.UseCases.Create` | `MMCA.ADC.Conference.Application/Questions/UseCases/Create/QuestionCreateRequestValidator.cs:7` |
| `QuestionUpdateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.UseCases.Update` | `MMCA.ADC.Conference.Application/Questions/UseCases/Update/QuestionUpdateRequest.cs:6` |
| `QuestionUpdateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.UseCases.Update` | `MMCA.ADC.Conference.Application/Questions/UseCases/Update/QuestionUpdateRequestValidator.cs:7` |
| `UpdateQuestionCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.UseCases.Update` | `MMCA.ADC.Conference.Application/Questions/UseCases/Update/UpdateQuestionCommand.cs:16` |
| `UpdateQuestionHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.UseCases.Update` | `MMCA.ADC.Conference.Application/Questions/UseCases/Update/UpdateQuestionHandler.cs:18` |
| `QuestionTextRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Questions.Validation` | `MMCA.ADC.Conference.Application/Questions/Validation/QuestionValidationRules.cs:12` |
| `SessionBookmarkValidationService` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions` | `MMCA.ADC.Conference.Application/Sessions/SessionBookmarkValidationService.cs:12` |
| `SessionNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions` | `MMCA.ADC.Conference.Application/Sessions/SessionNavigationPopulator.cs:12` |
| `SessionCreatedHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.DomainEventHandlers` | `MMCA.ADC.Conference.Application/Sessions/DomainEventHandlers/SessionCreatedHandler.cs:11` |
| `SessionCategoryItemDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.DTOs` | `MMCA.ADC.Conference.Application/Sessions/DTOs/SessionCategoryItemDTOMapper.cs:12` |
| `SessionDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.DTOs` | `MMCA.ADC.Conference.Application/Sessions/DTOs/SessionDTOMapper.cs:14` |
| `SessionQuestionAnswerDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.DTOs` | `MMCA.ADC.Conference.Application/Sessions/DTOs/SessionQuestionAnswerDTOMapper.cs:12` |
| `SessionSpeakerDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.DTOs` | `MMCA.ADC.Conference.Application/Sessions/DTOs/SessionSpeakerDTOMapper.cs:12` |
| `OwnSessionQuestionAnswerSpecification` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.Specifications` | `MMCA.ADC.Conference.Application/Sessions/Specifications/OwnSessionQuestionAnswerSpecification.cs:11` |
| `AddSessionCategoryItemCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem` | `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionCategoryItem/AddSessionCategoryItemCommand.cs:15` |
| `AddSessionCategoryItemCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem` | `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionCategoryItem/AddSessionCategoryItemCommandValidator.cs:8` |
| `AddSessionCategoryItemHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionCategoryItem` | `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionCategoryItem/AddSessionCategoryItemHandler.cs:16` |
| `AddSessionQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer` | `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionQuestionAnswer/AddSessionQuestionAnswerCommand.cs:18` |
| `AddSessionQuestionAnswerCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer` | `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionQuestionAnswer/AddSessionQuestionAnswerCommandValidator.cs:8` |
| `AddSessionQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionQuestionAnswer` | `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionQuestionAnswer/AddSessionQuestionAnswerHandler.cs:19` |
| `AddSessionSpeakerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker` | `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionSpeaker/AddSessionSpeakerCommand.cs:15` |
| `AddSessionSpeakerCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker` | `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionSpeaker/AddSessionSpeakerCommandValidator.cs:8` |
| `AddSessionSpeakerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.AddSessionSpeaker` | `MMCA.ADC.Conference.Application/Sessions/UseCases/AddSessionSpeaker/AddSessionSpeakerHandler.cs:16` |
| `CreateSessionHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Create` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Create/CreateSessionHandler.cs:16` |
| `SessionCreateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Create` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Create/SessionCreateRequest.cs:10` |
| `SessionCreateRequestMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Create` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Create/SessionCreateRequestMapper.cs:11` |
| `SessionCreateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Create` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Create/SessionCreateRequestValidator.cs:7` |
| `SpeakerLocalityHelper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/SpeakerLocalityHelper.cs:10` |
| `GetCategoryDistributionHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetCategoryDistribution/GetCategoryDistributionHandler.cs:14` |
| `GetCategoryDistributionQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetCategoryDistribution/GetCategoryDistributionQuery.cs:5` |
| `StatusBucket` | enum | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetCategoryDistribution` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetCategoryDistribution/GetCategoryDistributionHandler.cs:94` |
| `GetContentSimilarityHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetContentSimilarity/GetContentSimilarityHandler.cs:14` |
| `GetContentSimilarityQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetContentSimilarity/GetContentSimilarityQuery.cs:6` |
| `SessionSimilarityCalculator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetContentSimilarity` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetContentSimilarity/SessionSimilarityCalculator.cs:9` |
| `GetSessionSelectionDashboardHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSessionSelectionDashboard/GetSessionSelectionDashboardHandler.cs:16` |
| `GetSessionSelectionDashboardQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSessionSelectionDashboard/GetSessionSelectionDashboardQuery.cs:5` |
| `StatusBucket` | enum | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSessionSelectionDashboard` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSessionSelectionDashboard/GetSessionSelectionDashboardHandler.cs:308` |
| `GetSpeakerSessionOverlapHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSpeakerSessionOverlap` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSpeakerSessionOverlap/GetSpeakerSessionOverlapHandler.cs:18` |
| `GetSpeakerSessionOverlapQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.GetSpeakerSessionOverlap` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/GetSpeakerSessionOverlap/GetSpeakerSessionOverlapQuery.cs:5` |
| `IAiScoringService` | interface | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/IAiScoringService.cs:6` |
| `ScoreEventSessionsCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsCommand.cs:5` |
| `ScoreEventSessionsHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsHandler.cs:15` |
| `SessionScoringInput` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/IAiScoringService.cs:33` |
| `SessionScoringResult` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/IAiScoringService.cs:40` |
| `SpeakerInfo` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.DecisionSupport.ScoreEventSessions` | `MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/IAiScoringService.cs:23` |
| `CalendarExportMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` | `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/CalendarExportMapper.cs:13` |
| `ExportEventCalendarHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` | `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportEventCalendarHandler.cs:15` |
| `ExportEventCalendarQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` | `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportEventCalendarQuery.cs:5` |
| `ExportSessionCalendarHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` | `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportSessionCalendarHandler.cs:16` |
| `ExportSessionCalendarQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.ExportCalendar` | `MMCA.ADC.Conference.Application/Sessions/UseCases/ExportCalendar/ExportSessionCalendarQuery.cs:5` |
| `GetPublicSessionFilterHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionFilter` | `MMCA.ADC.Conference.Application/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterHandler.cs:17` |
| `GetPublicSessionFilterQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.GetPublicSessionFilter` | `MMCA.ADC.Conference.Application/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterQuery.cs:9` |
| `GetNowNextHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.NowNext` | `MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextHandler.cs:20` |
| `GetNowNextQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.NowNext` | `MMCA.ADC.Conference.Application/Sessions/UseCases/NowNext/GetNowNextQuery.cs:11` |
| `RemoveSessionCategoryItemCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionCategoryItem` | `MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionCategoryItem/RemoveSessionCategoryItemCommand.cs:12` |
| `RemoveSessionCategoryItemHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionCategoryItem` | `MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionCategoryItem/RemoveSessionCategoryItemHandler.cs:13` |
| `RemoveSessionQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionQuestionAnswer` | `MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionQuestionAnswer/RemoveSessionQuestionAnswerCommand.cs:13` |
| `RemoveSessionQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionQuestionAnswer` | `MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionQuestionAnswer/RemoveSessionQuestionAnswerHandler.cs:14` |
| `RemoveSessionSpeakerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionSpeaker` | `MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionSpeaker/RemoveSessionSpeakerCommand.cs:12` |
| `RemoveSessionSpeakerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.RemoveSessionSpeaker` | `MMCA.ADC.Conference.Application/Sessions/UseCases/RemoveSessionSpeaker/RemoveSessionSpeakerHandler.cs:13` |
| `SessionUpdateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Update` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Update/SessionUpdateRequest.cs:6` |
| `SessionUpdateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Update` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Update/SessionUpdateRequestValidator.cs:7` |
| `UpdateSessionCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Update` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Update/UpdateSessionCommand.cs:15` |
| `UpdateSessionHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Update` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Update/UpdateSessionHandler.cs:17` |
| `UpdateSessionResult` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.Update` | `MMCA.ADC.Conference.Application/Sessions/UseCases/Update/UpdateSessionCommand.cs:24` |
| `UpdateSessionQuestionAnswerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.UpdateSessionQuestionAnswer` | `MMCA.ADC.Conference.Application/Sessions/UseCases/UpdateSessionQuestionAnswer/UpdateSessionQuestionAnswerCommand.cs:15` |
| `UpdateSessionQuestionAnswerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.UseCases.UpdateSessionQuestionAnswer` | `MMCA.ADC.Conference.Application/Sessions/UseCases/UpdateSessionQuestionAnswer/UpdateSessionQuestionAnswerHandler.cs:14` |
| `SessionEventIdRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.Validation` | `MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:24` |
| `SessionTitleRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Sessions.Validation` | `MMCA.ADC.Conference.Application/Sessions/Validation/SessionValidationRules.cs:13` |
| `SpeakerEntityQueryService` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers` | `MMCA.ADC.Conference.Application/Speakers/SpeakerEntityQueryService.cs:15` |
| `SpeakerNavigationPopulator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers` | `MMCA.ADC.Conference.Application/Speakers/SpeakerNavigationPopulator.cs:11` |
| `SpeakerDeletedHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.DomainEventHandlers` | `MMCA.ADC.Conference.Application/Speakers/DomainEventHandlers/SpeakerDeletedHandler.cs:20` |
| `SpeakerCategoryItemDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.DTOs` | `MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerCategoryItemDTOMapper.cs:12` |
| `SpeakerDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.DTOs` | `MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerDTOMapper.cs:17` |
| `SpeakerQuestionAnswerDTOMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.DTOs` | `MMCA.ADC.Conference.Application/Speakers/DTOs/SpeakerQuestionAnswerDTOMapper.cs:12` |
| `AddSpeakerCategoryItemCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem` | `MMCA.ADC.Conference.Application/Speakers/UseCases/AddSpeakerCategoryItem/AddSpeakerCategoryItemCommand.cs:18` |
| `AddSpeakerCategoryItemCommandValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem` | `MMCA.ADC.Conference.Application/Speakers/UseCases/AddSpeakerCategoryItem/AddSpeakerCategoryItemCommandValidator.cs:8` |
| `AddSpeakerCategoryItemHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.AddSpeakerCategoryItem` | `MMCA.ADC.Conference.Application/Speakers/UseCases/AddSpeakerCategoryItem/AddSpeakerCategoryItemHandler.cs:15` |
| `CreateSpeakerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.Create` | `MMCA.ADC.Conference.Application/Speakers/UseCases/Create/CreateSpeakerHandler.cs:16` |
| `SpeakerCreateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.Create` | `MMCA.ADC.Conference.Application/Speakers/UseCases/Create/SpeakerCreateRequest.cs:10` |
| `SpeakerCreateRequestMapper` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.Create` | `MMCA.ADC.Conference.Application/Speakers/UseCases/Create/SpeakerCreateRequestMapper.cs:11` |
| `SpeakerCreateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.Create` | `MMCA.ADC.Conference.Application/Speakers/UseCases/Create/SpeakerCreateRequestValidator.cs:7` |
| `GetSessionBookmarkCountHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCount` | `MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionBookmarkCount/GetSessionBookmarkCountHandler.cs:14` |
| `GetSessionBookmarkCountQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionBookmarkCount` | `MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionBookmarkCount/GetSessionBookmarkCountQuery.cs:12` |
| `GetSessionFeedbackHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionFeedback` | `MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionFeedback/GetSessionFeedbackHandler.cs:15` |
| `GetSessionFeedbackQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSessionFeedback` | `MMCA.ADC.Conference.Application/Speakers/UseCases/GetSessionFeedback/GetSessionFeedbackQuery.cs:14` |
| `GetSpeakersByEventFilterHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSpeakersByEventFilter` | `MMCA.ADC.Conference.Application/Speakers/UseCases/GetSpeakersByEventFilter/GetSpeakersByEventFilterHandler.cs:19` |
| `GetSpeakersByEventFilterQuery` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.GetSpeakersByEventFilter` | `MMCA.ADC.Conference.Application/Speakers/UseCases/GetSpeakersByEventFilter/GetSpeakersByEventFilterQuery.cs:12` |
| `LinkUserToSpeakerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.LinkUser` | `MMCA.ADC.Conference.Application/Speakers/UseCases/LinkUser/LinkUserToSpeakerCommand.cs:18` |
| `LinkUserToSpeakerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.LinkUser` | `MMCA.ADC.Conference.Application/Speakers/UseCases/LinkUser/LinkUserToSpeakerHandler.cs:17` |
| `RemoveSpeakerCategoryItemCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.RemoveSpeakerCategoryItem` | `MMCA.ADC.Conference.Application/Speakers/UseCases/RemoveSpeakerCategoryItem/RemoveSpeakerCategoryItemCommand.cs:15` |
| `RemoveSpeakerCategoryItemHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.RemoveSpeakerCategoryItem` | `MMCA.ADC.Conference.Application/Speakers/UseCases/RemoveSpeakerCategoryItem/RemoveSpeakerCategoryItemHandler.cs:13` |
| `UnlinkUserFromSpeakerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.UnlinkUser` | `MMCA.ADC.Conference.Application/Speakers/UseCases/UnlinkUser/UnlinkUserFromSpeakerCommand.cs:17` |
| `UnlinkUserFromSpeakerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.UnlinkUser` | `MMCA.ADC.Conference.Application/Speakers/UseCases/UnlinkUser/UnlinkUserFromSpeakerHandler.cs:16` |
| `SpeakerUpdateRequest` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.Update` | `MMCA.ADC.Conference.Application/Speakers/UseCases/Update/SpeakerUpdateRequest.cs:6` |
| `SpeakerUpdateRequestValidator` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.Update` | `MMCA.ADC.Conference.Application/Speakers/UseCases/Update/SpeakerUpdateRequestValidator.cs:7` |
| `UpdateSpeakerCommand` | record | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.Update` | `MMCA.ADC.Conference.Application/Speakers/UseCases/Update/UpdateSpeakerCommand.cs:14` |
| `UpdateSpeakerHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.UseCases.Update` | `MMCA.ADC.Conference.Application/Speakers/UseCases/Update/UpdateSpeakerHandler.cs:15` |
| `SpeakerFirstNameRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.Validation` | `MMCA.ADC.Conference.Application/Speakers/Validation/SpeakerValidationRules.cs:11` |
| `SpeakerLastNameRules<T>` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Speakers.Validation` | `MMCA.ADC.Conference.Application/Speakers/Validation/SpeakerValidationRules.cs:22` |
| `UserRegisteredHandler` | class | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application.Users.IntegrationEventHandlers` | `MMCA.ADC.Conference.Application/Users/IntegrationEventHandlers/UserRegisteredHandler.cs:39` |
| `ConferenceCategoryNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories` | `MMCA.ADC.Conference.Application.Tests/Categories/ConferenceCategoryNavigationPopulatorTests.cs:10` |
| `CategoryItemDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.DTOs` | `MMCA.ADC.Conference.Application.Tests/Categories/DTOs/CategoryItemDTOMapperTests.cs:7` |
| `ConferenceCategoryDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.DTOs` | `MMCA.ADC.Conference.Application.Tests/Categories/DTOs/ConferenceCategoryDTOMapperTests.cs:7` |
| `AddCategoryItemHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.UseCases` | `MMCA.ADC.Conference.Application.Tests/Categories/UseCases/AddCategoryItemHandlerTests.cs:13` |
| `CreateConferenceCategoryHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.UseCases` | `MMCA.ADC.Conference.Application.Tests/Categories/UseCases/CreateConferenceCategoryHandlerTests.cs:15` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.UseCases` | `MMCA.ADC.Conference.Application.Tests/Categories/UseCases/AddCategoryItemHandlerTests.cs:16` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.UseCases` | `MMCA.ADC.Conference.Application.Tests/Categories/UseCases/CreateConferenceCategoryHandlerTests.cs:18` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.UseCases` | `MMCA.ADC.Conference.Application.Tests/Categories/UseCases/RemoveCategoryItemHandlerTests.cs:14` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.UseCases` | `MMCA.ADC.Conference.Application.Tests/Categories/UseCases/UpdateCategoryItemHandlerTests.cs:14` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.UseCases` | `MMCA.ADC.Conference.Application.Tests/Categories/UseCases/UpdateConferenceCategoryHandlerTests.cs:17` |
| `RemoveCategoryItemHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.UseCases` | `MMCA.ADC.Conference.Application.Tests/Categories/UseCases/RemoveCategoryItemHandlerTests.cs:11` |
| `UpdateCategoryItemHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.UseCases` | `MMCA.ADC.Conference.Application.Tests/Categories/UseCases/UpdateCategoryItemHandlerTests.cs:11` |
| `UpdateConferenceCategoryHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.UseCases` | `MMCA.ADC.Conference.Application.Tests/Categories/UseCases/UpdateConferenceCategoryHandlerTests.cs:14` |
| `AddCategoryItemCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.Validation` | `MMCA.ADC.Conference.Application.Tests/Categories/Validation/CategoryCommandValidatorTests.cs:8` |
| `ConferenceCategoryCreateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.Validation` | `MMCA.ADC.Conference.Application.Tests/Categories/Validation/ConferenceCategoryCreateRequestValidatorTests.cs:8` |
| `ConferenceCategoryUpdateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.Validation` | `MMCA.ADC.Conference.Application.Tests/Categories/Validation/ConferenceCategoryUpdateRequestValidatorTests.cs:6` |
| `ConferenceCategoryValidationRulesTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.Validation` | `MMCA.ADC.Conference.Application.Tests/Categories/Validation/ConferenceCategoryValidationRulesTests.cs:8` |
| `TestCategoryItemModel` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.Validation` | `MMCA.ADC.Conference.Application.Tests/Categories/Validation/ConferenceCategoryValidationRulesTests.cs:11` |
| `TestCategoryItemValidator` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.Validation` | `MMCA.ADC.Conference.Application.Tests/Categories/Validation/ConferenceCategoryValidationRulesTests.cs:19` |
| `TestCategoryModel` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.Validation` | `MMCA.ADC.Conference.Application.Tests/Categories/Validation/ConferenceCategoryValidationRulesTests.cs:10` |
| `TestCategoryTitleValidator` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.Validation` | `MMCA.ADC.Conference.Application.Tests/Categories/Validation/ConferenceCategoryValidationRulesTests.cs:13` |
| `UpdateCategoryItemCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Categories.Validation` | `MMCA.ADC.Conference.Application.Tests/Categories/Validation/CategoryCommandValidatorTests.cs:54` |
| `RoomChangedHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.DomainEvents` | `MMCA.ADC.Conference.Application.Tests/DomainEvents/RoomChangedHandlerTests.cs:12` |
| `SessionCreatedHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.DomainEvents` | `MMCA.ADC.Conference.Application.Tests/DomainEvents/SessionCreatedHandlerTests.cs:12` |
| `EventLiveValidationServiceTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events` | `MMCA.ADC.Conference.Application.Tests/Events/EventLiveValidationServiceTests.cs:12` |
| `EventNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events` | `MMCA.ADC.Conference.Application.Tests/Events/EventNavigationPopulatorTests.cs:10` |
| `ServiceMocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events` | `MMCA.ADC.Conference.Application.Tests/Events/EventLiveValidationServiceTests.cs:206` |
| `RoomChangedHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.DomainEventHandlers` | `MMCA.ADC.Conference.Application.Tests/Events/DomainEventHandlers/RoomChangedHandlerTests.cs:10` |
| `EventDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.DTOs` | `MMCA.ADC.Conference.Application.Tests/Events/DTOs/EventDTOMapperTests.cs:7` |
| `EventQuestionAnswerDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.DTOs` | `MMCA.ADC.Conference.Application.Tests/Events/DTOs/EventQuestionAnswerDTOMapperTests.cs:8` |
| `EventSpeakerDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.DTOs` | `MMCA.ADC.Conference.Application.Tests/Events/DTOs/EventSpeakerDTOMapperTests.cs:7` |
| `RoomDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.DTOs` | `MMCA.ADC.Conference.Application.Tests/Events/DTOs/RoomDTOMapperTests.cs:7` |
| `OwnEventQuestionAnswerSpecificationTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Specifications` | `MMCA.ADC.Conference.Application.Tests/Events/Specifications/OwnEventQuestionAnswerSpecificationTests.cs:7` |
| `PublishedEventSpecificationTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Specifications` | `MMCA.ADC.Conference.Application.Tests/Events/Specifications/PublishedEventSpecificationTests.cs:7` |
| `AddEventQuestionAnswerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/AddEventQuestionAnswerHandlerTests.cs:14` |
| `AddEventSpeakerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/AddEventSpeakerHandlerTests.cs:13` |
| `AddRoomHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/AddRoomHandlerTests.cs:14` |
| `CreateEventHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/CreateEventHandlerTests.cs:15` |
| `DeleteEventHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/DeleteEventHandlerTests.cs:15` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/AddEventQuestionAnswerHandlerTests.cs:17` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/AddEventSpeakerHandlerTests.cs:16` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/AddRoomHandlerTests.cs:17` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/CreateEventHandlerTests.cs:18` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/DeleteEventHandlerTests.cs:18` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/PublishEventHandlerTests.cs:14` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/RemoveEventQuestionAnswerHandlerTests.cs:15` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/RemoveEventSpeakerHandlerTests.cs:14` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/RemoveRoomHandlerTests.cs:14` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/UnpublishEventHandlerTests.cs:14` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/UpdateEventHandlerTests.cs:17` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/UpdateEventQuestionAnswerHandlerTests.cs:15` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/UpdateRoomHandlerTests.cs:14` |
| `PublishEventHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/PublishEventHandlerTests.cs:11` |
| `RefreshFromSessionizeHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/RefreshFromSessionizeHandlerTests.cs:13` |
| `RemoveEventQuestionAnswerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/RemoveEventQuestionAnswerHandlerTests.cs:12` |
| `RemoveEventSpeakerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/RemoveEventSpeakerHandlerTests.cs:11` |
| `RemoveRoomHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/RemoveRoomHandlerTests.cs:11` |
| `UnpublishEventHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/UnpublishEventHandlerTests.cs:11` |
| `UpdateEventHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/UpdateEventHandlerTests.cs:14` |
| `UpdateEventQuestionAnswerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/UpdateEventQuestionAnswerHandlerTests.cs:12` |
| `UpdateRoomHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.UseCases` | `MMCA.ADC.Conference.Application.Tests/Events/UseCases/UpdateRoomHandlerTests.cs:11` |
| `AddEventQuestionAnswerCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/CommandValidatorTests.cs:10` |
| `AddEventSpeakerCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/CommandValidatorTests.cs:40` |
| `AddRoomCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/CommandValidatorTests.cs:62` |
| `EventCreateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/EventCreateRequestValidatorTests.cs:7` |
| `EventUpdateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/EventUpdateRequestValidatorTests.cs:7` |
| `EventValidationRulesTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/EventValidationRulesTests.cs:8` |
| `RoomValidationRulesTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/EventValidationRulesTests.cs:118` |
| `TestEventModel` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/EventValidationRulesTests.cs:11` |
| `TestEventValidator` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/EventValidationRulesTests.cs:18` |
| `TestRoomModel` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/EventValidationRulesTests.cs:121` |
| `TestRoomValidator` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/EventValidationRulesTests.cs:130` |
| `UpdateRoomCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Events.Validation` | `MMCA.ADC.Conference.Application.Tests/Events/Validation/CommandValidatorTests.cs:116` |
| `QuestionDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Questions.DTOs` | `MMCA.ADC.Conference.Application.Tests/Questions/DTOs/QuestionDTOMapperTests.cs:7` |
| `CreateQuestionHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Questions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Questions/UseCases/CreateQuestionHandlerTests.cs:16` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Questions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Questions/UseCases/CreateQuestionHandlerTests.cs:19` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Questions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Questions/UseCases/UpdateQuestionHandlerTests.cs:19` |
| `UpdateQuestionHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Questions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Questions/UseCases/UpdateQuestionHandlerTests.cs:16` |
| `QuestionCreateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Questions.Validation` | `MMCA.ADC.Conference.Application.Tests/Questions/Validation/QuestionCreateRequestValidatorTests.cs:7` |
| `QuestionUpdateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Questions.Validation` | `MMCA.ADC.Conference.Application.Tests/Questions/Validation/QuestionUpdateRequestValidatorTests.cs:6` |
| `QuestionValidationRulesTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Questions.Validation` | `MMCA.ADC.Conference.Application.Tests/Questions/Validation/QuestionValidationRulesTests.cs:8` |
| `TestQuestionModel` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Questions.Validation` | `MMCA.ADC.Conference.Application.Tests/Questions/Validation/QuestionValidationRulesTests.cs:10` |
| `TestQuestionTextValidator` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Questions.Validation` | `MMCA.ADC.Conference.Application.Tests/Questions/Validation/QuestionValidationRulesTests.cs:12` |
| `ServiceMocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions` | `MMCA.ADC.Conference.Application.Tests/Sessions/SessionBookmarkValidationServiceTests.cs:14` |
| `SessionBookmarkValidationServiceTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions` | `MMCA.ADC.Conference.Application.Tests/Sessions/SessionBookmarkValidationServiceTests.cs:11` |
| `SessionNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions` | `MMCA.ADC.Conference.Application.Tests/Sessions/SessionNavigationPopulatorTests.cs:10` |
| `SessionCreatedHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.DomainEventHandlers` | `MMCA.ADC.Conference.Application.Tests/Sessions/DomainEventHandlers/SessionCreatedHandlerTests.cs:10` |
| `SessionCategoryItemDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.DTOs` | `MMCA.ADC.Conference.Application.Tests/Sessions/DTOs/SessionCategoryItemDTOMapperTests.cs:7` |
| `SessionDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.DTOs` | `MMCA.ADC.Conference.Application.Tests/Sessions/DTOs/SessionDTOMapperTests.cs:8` |
| `SessionQuestionAnswerDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.DTOs` | `MMCA.ADC.Conference.Application.Tests/Sessions/DTOs/SessionQuestionAnswerDTOMapperTests.cs:7` |
| `SessionSpeakerDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.DTOs` | `MMCA.ADC.Conference.Application.Tests/Sessions/DTOs/SessionSpeakerDTOMapperTests.cs:7` |
| `OwnSessionQuestionAnswerSpecificationTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.Specifications` | `MMCA.ADC.Conference.Application.Tests/Sessions/Specifications/OwnSessionQuestionAnswerSpecificationTests.cs:7` |
| `AddSessionCategoryItemHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/AddSessionCategoryItemHandlerTests.cs:13` |
| `AddSessionQuestionAnswerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/AddSessionQuestionAnswerHandlerTests.cs:15` |
| `AddSessionSpeakerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/AddSessionSpeakerHandlerTests.cs:13` |
| `CreateSessionHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/CreateSessionHandlerTests.cs:16` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/AddSessionCategoryItemHandlerTests.cs:16` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/AddSessionQuestionAnswerHandlerTests.cs:18` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/AddSessionSpeakerHandlerTests.cs:16` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/CreateSessionHandlerTests.cs:19` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/RemoveSessionCategoryItemHandlerTests.cs:14` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/RemoveSessionQuestionAnswerHandlerTests.cs:15` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/RemoveSessionSpeakerHandlerTests.cs:14` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/UpdateSessionHandlerTests.cs:16` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/UpdateSessionQuestionAnswerHandlerTests.cs:16` |
| `RemoveSessionCategoryItemHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/RemoveSessionCategoryItemHandlerTests.cs:11` |
| `RemoveSessionQuestionAnswerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/RemoveSessionQuestionAnswerHandlerTests.cs:12` |
| `RemoveSessionSpeakerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/RemoveSessionSpeakerHandlerTests.cs:11` |
| `UpdateSessionHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/UpdateSessionHandlerTests.cs:13` |
| `UpdateSessionQuestionAnswerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/UpdateSessionQuestionAnswerHandlerTests.cs:13` |
| `GetCategoryDistributionHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/GetCategoryDistributionHandlerTests.cs:11` |
| `GetContentSimilarityHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/GetContentSimilarityHandlerTests.cs:11` |
| `GetSessionSelectionDashboardHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/GetSessionSelectionDashboardHandlerTests.cs:14` |
| `GetSpeakerSessionOverlapHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/GetSpeakerSessionOverlapHandlerTests.cs:12` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/GetCategoryDistributionHandlerTests.cs:16` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/GetContentSimilarityHandlerTests.cs:16` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/GetSessionSelectionDashboardHandlerTests.cs:21` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/GetSpeakerSessionOverlapHandlerTests.cs:19` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/ScoreEventSessionsHandlerTests.cs:18` |
| `ScoreEventSessionsHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/ScoreEventSessionsHandlerTests.cs:12` |
| `SessionSimilarityCalculatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/SessionSimilarityCalculatorTests.cs:6` |
| `SpeakerLocalityHelperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.DecisionSupport` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/DecisionSupport/SpeakerLocalityHelperTests.cs:8` |
| `CalendarExportMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.ExportCalendar` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/ExportCalendar/CalendarExportMapperTests.cs:14` |
| `ExportSessionCalendarHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.ExportCalendar` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/ExportCalendar/ExportSessionCalendarHandlerTests.cs:16` |
| `GetPublicSessionFilterHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.GetPublicSessionFilter` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterHandlerTests.cs:11` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.GetPublicSessionFilter` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/GetPublicSessionFilter/GetPublicSessionFilterHandlerTests.cs:17` |
| `FixedTimeProvider` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.NowNext` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/NowNext/GetNowNextHandlerTests.cs:32` |
| `GetNowNextHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.UseCases.NowNext` | `MMCA.ADC.Conference.Application.Tests/Sessions/UseCases/NowNext/GetNowNextHandlerTests.cs:17` |
| `AddSessionCategoryItemCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.Validation` | `MMCA.ADC.Conference.Application.Tests/Sessions/Validation/SessionCommandValidatorTests.cs:60` |
| `AddSessionQuestionAnswerCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.Validation` | `MMCA.ADC.Conference.Application.Tests/Sessions/Validation/SessionCommandValidatorTests.cs:8` |
| `AddSessionSpeakerCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.Validation` | `MMCA.ADC.Conference.Application.Tests/Sessions/Validation/SessionCommandValidatorTests.cs:38` |
| `SessionCreateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.Validation` | `MMCA.ADC.Conference.Application.Tests/Sessions/Validation/SessionCreateRequestValidatorTests.cs:6` |
| `SessionUpdateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.Validation` | `MMCA.ADC.Conference.Application.Tests/Sessions/Validation/SessionUpdateRequestValidatorTests.cs:6` |
| `SessionValidationRulesTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.Validation` | `MMCA.ADC.Conference.Application.Tests/Sessions/Validation/SessionValidationRulesTests.cs:8` |
| `TestSessionModel` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.Validation` | `MMCA.ADC.Conference.Application.Tests/Sessions/Validation/SessionValidationRulesTests.cs:10` |
| `TestSessionValidator` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sessions.Validation` | `MMCA.ADC.Conference.Application.Tests/Sessions/Validation/SessionValidationRulesTests.cs:12` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers` | `MMCA.ADC.Conference.Application.Tests/Speakers/SpeakerEntityQueryServiceTests.cs:19` |
| `SpeakerEntityQueryServiceTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers` | `MMCA.ADC.Conference.Application.Tests/Speakers/SpeakerEntityQueryServiceTests.cs:14` |
| `SpeakerNavigationPopulatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers` | `MMCA.ADC.Conference.Application.Tests/Speakers/SpeakerNavigationPopulatorTests.cs:10` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.DomainEventHandlers` | `MMCA.ADC.Conference.Application.Tests/Speakers/DomainEventHandlers/SpeakerDeletedHandlerTests.cs:17` |
| `SpeakerDeletedHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.DomainEventHandlers` | `MMCA.ADC.Conference.Application.Tests/Speakers/DomainEventHandlers/SpeakerDeletedHandlerTests.cs:14` |
| `SpeakerCategoryItemDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.DTOs` | `MMCA.ADC.Conference.Application.Tests/Speakers/DTOs/SpeakerCategoryItemDTOMapperTests.cs:7` |
| `SpeakerDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.DTOs` | `MMCA.ADC.Conference.Application.Tests/Speakers/DTOs/SpeakerDTOMapperTests.cs:9` |
| `SpeakerQuestionAnswerDTOMapperTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.DTOs` | `MMCA.ADC.Conference.Application.Tests/Speakers/DTOs/SpeakerQuestionAnswerDTOMapperTests.cs:7` |
| `AddSpeakerCategoryItemHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/AddSpeakerCategoryItemHandlerTests.cs:13` |
| `CreateSpeakerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/CreateSpeakerHandlerTests.cs:15` |
| `GetSessionBookmarkCountHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/GetSessionBookmarkCountHandlerTests.cs:11` |
| `GetSessionFeedbackHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/GetSessionFeedbackHandlerTests.cs:11` |
| `LinkUserToSpeakerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/LinkUserToSpeakerHandlerTests.cs:15` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/AddSpeakerCategoryItemHandlerTests.cs:16` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/CreateSpeakerHandlerTests.cs:18` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/LinkUserToSpeakerHandlerTests.cs:18` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/RemoveSpeakerCategoryItemHandlerTests.cs:14` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/UnlinkUserFromSpeakerHandlerTests.cs:17` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/UpdateSpeakerHandlerTests.cs:16` |
| `RemoveSpeakerCategoryItemHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/RemoveSpeakerCategoryItemHandlerTests.cs:11` |
| `UnlinkUserFromSpeakerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/UnlinkUserFromSpeakerHandlerTests.cs:14` |
| `UpdateSpeakerHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/UpdateSpeakerHandlerTests.cs:13` |
| `GetSpeakersByEventFilterHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases.GetSpeakersByEventFilter` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/GetSpeakersByEventFilter/GetSpeakersByEventFilterHandlerTests.cs:17` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.UseCases.GetSpeakersByEventFilter` | `MMCA.ADC.Conference.Application.Tests/Speakers/UseCases/GetSpeakersByEventFilter/GetSpeakersByEventFilterHandlerTests.cs:25` |
| `AddSpeakerCategoryItemCommandValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.Validation` | `MMCA.ADC.Conference.Application.Tests/Speakers/Validation/SpeakerCommandValidatorTests.cs:6` |
| `SpeakerCreateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.Validation` | `MMCA.ADC.Conference.Application.Tests/Speakers/Validation/SpeakerCreateRequestValidatorTests.cs:6` |
| `SpeakerUpdateRequestValidatorTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.Validation` | `MMCA.ADC.Conference.Application.Tests/Speakers/Validation/SpeakerUpdateRequestValidatorTests.cs:6` |
| `SpeakerValidationRulesTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.Validation` | `MMCA.ADC.Conference.Application.Tests/Speakers/Validation/SpeakerValidationRulesTests.cs:8` |
| `TestSpeakerModel` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.Validation` | `MMCA.ADC.Conference.Application.Tests/Speakers/Validation/SpeakerValidationRulesTests.cs:10` |
| `TestSpeakerValidator` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Speakers.Validation` | `MMCA.ADC.Conference.Application.Tests/Speakers/Validation/SpeakerValidationRulesTests.cs:12` |
| `CategorySyncStrategyTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sync` | `MMCA.ADC.Conference.Application.Tests/Sync/CategorySyncStrategyTests.cs:11` |
| `QuestionSyncStrategyTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sync` | `MMCA.ADC.Conference.Application.Tests/Sync/QuestionSyncStrategyTests.cs:6` |
| `RoomSyncStrategyTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sync` | `MMCA.ADC.Conference.Application.Tests/Sync/RoomSyncStrategyTests.cs:10` |
| `SessionSyncStrategyTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sync` | `MMCA.ADC.Conference.Application.Tests/Sync/SessionSyncStrategyTests.cs:11` |
| `SpeakerSyncStrategyTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Sync` | `MMCA.ADC.Conference.Application.Tests/Sync/SpeakerSyncStrategyTests.cs:8` |
| `Mocks` | record | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Users.IntegrationEventHandlers` | `MMCA.ADC.Conference.Application.Tests/Users/IntegrationEventHandlers/UserRegisteredHandlerTests.cs:19` |
| `UserRegisteredHandlerTests` | class | MMCA.ADC.Conference.Application.Tests | `MMCA.ADC.Conference.Application.Tests.Users.IntegrationEventHandlers` | `MMCA.ADC.Conference.Application.Tests/Users/IntegrationEventHandlers/UserRegisteredHandlerTests.cs:16` |
| `DependencyInjection` | class | MMCA.ADC.Conference.Contracts | `MMCA.ADC.Conference.Contracts` | `MMCA.ADC.Conference.Contracts/DependencyInjection.cs:15` |
| `EventLiveValidationServiceGrpcAdapter` | class | MMCA.ADC.Conference.Contracts | `MMCA.ADC.Conference.Contracts` | `MMCA.ADC.Conference.Contracts/EventLiveValidationServiceGrpcAdapter.cs:23` |
| `GrpcErrorTrailerParser` | class | MMCA.ADC.Conference.Contracts | `MMCA.ADC.Conference.Contracts` | `MMCA.ADC.Conference.Contracts/GrpcErrorTrailerParser.cs:14` |
| `SessionBookmarkValidationServiceGrpcAdapter` | class | MMCA.ADC.Conference.Contracts | `MMCA.ADC.Conference.Contracts` | `MMCA.ADC.Conference.Contracts/SessionBookmarkValidationServiceGrpcAdapter.cs:24` |
| `AssemblyReference` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain` | `MMCA.ADC.Conference.Domain/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain` | `MMCA.ADC.Conference.Domain/AssemblyReference.cs:11` |
| `Category` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Categories` | `MMCA.ADC.Conference.Domain/Categories/Category.cs:16` |
| `CategoryInvariants` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Categories` | `MMCA.ADC.Conference.Domain/Categories/CategoryInvariants.cs:10` |
| `CategoryItem` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Categories` | `MMCA.ADC.Conference.Domain/Categories/CategoryItem.cs:14` |
| `CategoryChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Categories.DomainEvents` | `MMCA.ADC.Conference.Domain/Categories/DomainEvents/CategoryChanged.cs:12` |
| `CategoryItemChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Categories.DomainEvents` | `MMCA.ADC.Conference.Domain/Categories/DomainEvents/CategoryItemChanged.cs:13` |
| `Event` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Events` | `MMCA.ADC.Conference.Domain/Events/Event.cs:17` |
| `EventInvariants` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Events` | `MMCA.ADC.Conference.Domain/Events/EventInvariants.cs:10` |
| `EventQuestionAnswer` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Events` | `MMCA.ADC.Conference.Domain/Events/EventQuestionAnswer.cs:13` |
| `EventSpeaker` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Events` | `MMCA.ADC.Conference.Domain/Events/EventSpeaker.cs:13` |
| `Room` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Events` | `MMCA.ADC.Conference.Domain/Events/Room.cs:12` |
| `EventChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Events.DomainEvents` | `MMCA.ADC.Conference.Domain/Events/DomainEvents/EventChanged.cs:12` |
| `EventQuestionAnswerChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Events.DomainEvents` | `MMCA.ADC.Conference.Domain/Events/DomainEvents/EventQuestionAnswerChanged.cs:13` |
| `EventSpeakerChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Events.DomainEvents` | `MMCA.ADC.Conference.Domain/Events/DomainEvents/EventSpeakerChanged.cs:13` |
| `RoomChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Events.DomainEvents` | `MMCA.ADC.Conference.Domain/Events/DomainEvents/RoomChanged.cs:13` |
| `Question` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Questions` | `MMCA.ADC.Conference.Domain/Questions/Question.cs:15` |
| `QuestionInvariants` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Questions` | `MMCA.ADC.Conference.Domain/Questions/QuestionInvariants.cs:10` |
| `QuestionChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Questions.DomainEvents` | `MMCA.ADC.Conference.Domain/Questions/DomainEvents/QuestionChanged.cs:12` |
| `EventCascadeDeletionDomainService` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Services` | `MMCA.ADC.Conference.Domain/Services/EventCascadeDeletionDomainService.cs:11` |
| `IEventCascadeDeletionDomainService` | interface | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Services` | `MMCA.ADC.Conference.Domain/Services/IEventCascadeDeletionDomainService.cs:12` |
| `Session` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions` | `MMCA.ADC.Conference.Domain/Sessions/Session.cs:16` |
| `SessionAiScore` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions` | `MMCA.ADC.Conference.Domain/Sessions/SessionAiScore.cs:12` |
| `SessionCategoryItem` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions` | `MMCA.ADC.Conference.Domain/Sessions/SessionCategoryItem.cs:13` |
| `SessionInvariants` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions` | `MMCA.ADC.Conference.Domain/Sessions/SessionInvariants.cs:10` |
| `SessionQuestionAnswer` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions` | `MMCA.ADC.Conference.Domain/Sessions/SessionQuestionAnswer.cs:13` |
| `SessionSpeaker` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions` | `MMCA.ADC.Conference.Domain/Sessions/SessionSpeaker.cs:13` |
| `SessionStatuses` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions` | `MMCA.ADC.Conference.Domain/Sessions/SessionStatuses.cs:8` |
| `SessionCategoryItemChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions.DomainEvents` | `MMCA.ADC.Conference.Domain/Sessions/DomainEvents/SessionCategoryItemChanged.cs:13` |
| `SessionChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions.DomainEvents` | `MMCA.ADC.Conference.Domain/Sessions/DomainEvents/SessionChanged.cs:13` |
| `SessionQuestionAnswerChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions.DomainEvents` | `MMCA.ADC.Conference.Domain/Sessions/DomainEvents/SessionQuestionAnswerChanged.cs:13` |
| `SessionSpeakerChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Sessions.DomainEvents` | `MMCA.ADC.Conference.Domain/Sessions/DomainEvents/SessionSpeakerChanged.cs:13` |
| `Speaker` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Speakers` | `MMCA.ADC.Conference.Domain/Speakers/Speaker.cs:15` |
| `SpeakerCategoryItem` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Speakers` | `MMCA.ADC.Conference.Domain/Speakers/SpeakerCategoryItem.cs:13` |
| `SpeakerInvariants` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Speakers` | `MMCA.ADC.Conference.Domain/Speakers/SpeakerInvariants.cs:10` |
| `SpeakerQuestionAnswer` | class | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Speakers` | `MMCA.ADC.Conference.Domain/Speakers/SpeakerQuestionAnswer.cs:13` |
| `SpeakerCategoryItemChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Speakers.DomainEvents` | `MMCA.ADC.Conference.Domain/Speakers/DomainEvents/SpeakerCategoryItemChanged.cs:13` |
| `SpeakerChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Speakers.DomainEvents` | `MMCA.ADC.Conference.Domain/Speakers/DomainEvents/SpeakerChanged.cs:16` |
| `SpeakerQuestionAnswerChanged` | record | MMCA.ADC.Conference.Domain | `MMCA.ADC.Conference.Domain.Speakers.DomainEvents` | `MMCA.ADC.Conference.Domain/Speakers/DomainEvents/SpeakerQuestionAnswerChanged.cs:13` |
| `EventBuilder` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Builders` | `MMCA.ADC.Conference.Domain.Tests/Builders/EventBuilder.cs:10` |
| `SessionBuilder` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Builders` | `MMCA.ADC.Conference.Domain.Tests/Builders/SessionBuilder.cs:10` |
| `SpeakerBuilder` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Builders` | `MMCA.ADC.Conference.Domain.Tests/Builders/SpeakerBuilder.cs:10` |
| `CategoryTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Categories` | `MMCA.ADC.Conference.Domain.Tests/Categories/CategoryTests.cs:8` |
| `EventQuestionAnswerTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Events` | `MMCA.ADC.Conference.Domain.Tests/Events/EventQuestionAnswerTests.cs:14` |
| `EventSpeakerTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Events` | `MMCA.ADC.Conference.Domain.Tests/Events/EventSpeakerTests.cs:13` |
| `EventTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Events` | `MMCA.ADC.Conference.Domain.Tests/Events/EventTests.cs:9` |
| `CategoryInvariantsTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Invariants` | `MMCA.ADC.Conference.Domain.Tests/Invariants/CategoryInvariantsTests.cs:6` |
| `EventInvariantsTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Invariants` | `MMCA.ADC.Conference.Domain.Tests/Invariants/EventInvariantsTests.cs:6` |
| `QuestionInvariantsTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Invariants` | `MMCA.ADC.Conference.Domain.Tests/Invariants/QuestionInvariantsTests.cs:6` |
| `SessionInvariantsTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Invariants` | `MMCA.ADC.Conference.Domain.Tests/Invariants/SessionInvariantsTests.cs:6` |
| `SpeakerInvariantsTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Invariants` | `MMCA.ADC.Conference.Domain.Tests/Invariants/SpeakerInvariantsTests.cs:6` |
| `QuestionTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Questions` | `MMCA.ADC.Conference.Domain.Tests/Questions/QuestionTests.cs:6` |
| `EventCascadeDeletionDomainServiceTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Services` | `MMCA.ADC.Conference.Domain.Tests/Services/EventCascadeDeletionDomainServiceTests.cs:8` |
| `SessionAiScoreTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Sessions` | `MMCA.ADC.Conference.Domain.Tests/Sessions/SessionAiScoreTests.cs:10` |
| `SessionCategoryItemTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Sessions` | `MMCA.ADC.Conference.Domain.Tests/Sessions/SessionCategoryItemTests.cs:14` |
| `SessionQuestionAnswerTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Sessions` | `MMCA.ADC.Conference.Domain.Tests/Sessions/SessionQuestionAnswerTests.cs:15` |
| `SessionSpeakerTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Sessions` | `MMCA.ADC.Conference.Domain.Tests/Sessions/SessionSpeakerTests.cs:14` |
| `SessionTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Sessions` | `MMCA.ADC.Conference.Domain.Tests/Sessions/SessionTests.cs:8` |
| `SpeakerCategoryItemTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Speakers` | `MMCA.ADC.Conference.Domain.Tests/Speakers/SpeakerCategoryItemTests.cs:13` |
| `SpeakerQuestionAnswerTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Speakers` | `MMCA.ADC.Conference.Domain.Tests/Speakers/SpeakerQuestionAnswerTests.cs:14` |
| `SpeakerTests` | class | MMCA.ADC.Conference.Domain.Tests | `MMCA.ADC.Conference.Domain.Tests.Speakers` | `MMCA.ADC.Conference.Domain.Tests/Speakers/SpeakerTests.cs:8` |
| `AssemblyReference` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure` | `MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure` | `MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure` | `MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:12` |
| `ModuleApplicationDbContext` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts` | `MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:18` |
| `ConferenceModuleDbSeeder` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts.Seeding` | `MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:22` |
| `CategoryItemConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/CategoryItemConfiguration.cs:11` |
| `ConferenceCategoryConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/ConferenceCategoryConfiguration.cs:13` |
| `EventConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/EventConfiguration.cs:11` |
| `EventQuestionAnswerConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/EventQuestionAnswerConfiguration.cs:11` |
| `EventSpeakerConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/EventSpeakerConfiguration.cs:11` |
| `QuestionConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/QuestionConfiguration.cs:10` |
| `RoomConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/RoomConfiguration.cs:10` |
| `SessionAiScoreConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionAiScoreConfiguration.cs:11` |
| `SessionCategoryItemConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionCategoryItemConfiguration.cs:11` |
| `SessionConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionConfiguration.cs:12` |
| `SessionQuestionAnswerConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionQuestionAnswerConfiguration.cs:10` |
| `SessionSpeakerConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionSpeakerConfiguration.cs:11` |
| `SpeakerCategoryItemConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SpeakerCategoryItemConfiguration.cs:11` |
| `SpeakerConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SpeakerConfiguration.cs:12` |
| `SpeakerQuestionAnswerConfiguration` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SpeakerQuestionAnswerConfiguration.cs:10` |
| `AiScoreResponse` | record | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Services` | `MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:238` |
| `AnthropicContentBlock` | record | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Services` | `MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:227` |
| `AnthropicMessage` | record | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Services` | `MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:212` |
| `AnthropicRequest` | record | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Services` | `MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:200` |
| `AnthropicResponse` | record | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Services` | `MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:221` |
| `AnthropicScoringService` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Services` | `MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:16` |
| `SessionizeService` | class | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure.Services` | `MMCA.ADC.Conference.Infrastructure/Services/SessionizeService.cs:10` |
| `ConferenceEntityConfigurationTests` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Persistence` | `MMCA.ADC.Conference.Infrastructure.Tests/Persistence/ConferenceEntityConfigurationTests.cs:14` |
| `ConferenceTestDbContext` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Persistence` | `MMCA.ADC.Conference.Infrastructure.Tests/Persistence/ConferenceEntityConfigurationTests.cs:672` |
| `ConferenceModuleDbSeederTests` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Seeding` | `MMCA.ADC.Conference.Infrastructure.Tests/Seeding/ConferenceModuleDbSeederTests.cs:11` |
| `SeederMocks` | record | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Seeding` | `MMCA.ADC.Conference.Infrastructure.Tests/Seeding/ConferenceModuleDbSeederTests.cs:79` |
| `AnthropicScoringServiceTests` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Services` | `MMCA.ADC.Conference.Infrastructure.Tests/Services/AnthropicScoringServiceTests.cs:12` |
| `FakeAnthropicHandler` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Services` | `MMCA.ADC.Conference.Infrastructure.Tests/Services/AnthropicScoringServiceTests.cs:36` |
| `SessionizeServiceTests` | class | MMCA.ADC.Conference.Infrastructure.Tests | `MMCA.ADC.Conference.Infrastructure.Tests.Services` | `MMCA.ADC.Conference.Infrastructure.Tests/Services/SessionizeServiceTests.cs:11` |
| `AnonymousAccessDeniedTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Anonymous` | `MMCA.ADC.Conference.IntegrationTests/Anonymous/AnonymousAccessDeniedTests.cs:8` |
| `AttendeeAccessDeniedTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Attendee` | `MMCA.ADC.Conference.IntegrationTests/Attendee/AttendeeAccessDeniedTests.cs:7` |
| `AttendeeQuestionAnswerTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Attendee` | `MMCA.ADC.Conference.IntegrationTests/Attendee/AttendeeQuestionAnswerTests.cs:9` |
| `ApiVersioningTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Contract` | `MMCA.ADC.Conference.IntegrationTests/Contract/ApiVersioningTests.cs:14` |
| `OpenApiContractTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Contract` | `MMCA.ADC.Conference.IntegrationTests/Contract/OpenApiContractTests.cs:14` |
| `ProblemDetailsContractTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Contract` | `MMCA.ADC.Conference.IntegrationTests/Contract/ProblemDetailsContractTests.cs:18` |
| `CrossServiceUserRegisteredTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.CrossService` | `MMCA.ADC.Conference.IntegrationTests/CrossService/CrossServiceUserRegisteredTests.cs:21` |
| `AuditStampFidelityTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Data` | `MMCA.ADC.Conference.IntegrationTests/Data/AuditStampFidelityTests.cs:17` |
| `IdempotencyReplayTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Data` | `MMCA.ADC.Conference.IntegrationTests/Data/IdempotencyReplayTests.cs:17` |
| `SoftDeleteFidelityTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Data` | `MMCA.ADC.Conference.IntegrationTests/Data/SoftDeleteFidelityTests.cs:16` |
| `ConferenceIntegrationTestBase` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Infrastructure` | `MMCA.ADC.Conference.IntegrationTests/Infrastructure/ConferenceIntegrationTestBase.cs:14` |
| `ConferenceIntegrationTestCollection` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Infrastructure` | `MMCA.ADC.Conference.IntegrationTests/Infrastructure/ConferenceIntegrationTestCollection.cs:8` |
| `ConferenceIntegrationTestFixture` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Infrastructure` | `MMCA.ADC.Conference.IntegrationTests/Infrastructure/ConferenceIntegrationTestFixture.cs:17` |
| `ConferenceTestWebApplicationFactory` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Infrastructure` | `MMCA.ADC.Conference.IntegrationTests/Infrastructure/ConferenceTestWebApplicationFactory.cs:32` |
| `FakeAiScoringService` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Infrastructure` | `MMCA.ADC.Conference.IntegrationTests/Infrastructure/FakeAiScoringService.cs:11` |
| `FakeBookmarkCountService` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Infrastructure` | `MMCA.ADC.Conference.IntegrationTests/Infrastructure/FakeBookmarkCountService.cs:9` |
| `FakeSessionizeService` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Infrastructure` | `MMCA.ADC.Conference.IntegrationTests/Infrastructure/FakeSessionizeService.cs:12` |
| `OrganizerAssociationEdgeCaseTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerAssociationEdgeCaseTests.cs:9` |
| `OrganizerAssociationTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerAssociationTests.cs:9` |
| `OrganizerCategoryTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerCategoryTests.cs:9` |
| `OrganizerConcurrencyTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerConcurrencyTests.cs:15` |
| `OrganizerEventLifecycleTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerEventLifecycleTests.cs:9` |
| `OrganizerEventTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerEventTests.cs:9` |
| `OrganizerQuestionAnswerTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerQuestionAnswerTests.cs:9` |
| `OrganizerQuestionTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerQuestionTests.cs:9` |
| `OrganizerRoomEdgeCaseTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerRoomEdgeCaseTests.cs:9` |
| `OrganizerRoomTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerRoomTests.cs:9` |
| `OrganizerSessionEdgeCaseTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerSessionEdgeCaseTests.cs:9` |
| `OrganizerSessionTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/OrganizerSessionTests.cs:9` |
| `SessionizeRefreshTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/SessionizeRefreshTests.cs:16` |
| `SessionSelectionTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Organizer` | `MMCA.ADC.Conference.IntegrationTests/Organizer/SessionSelectionTests.cs:18` |
| `AnonymousConferenceReadTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Reads` | `MMCA.ADC.Conference.IntegrationTests/Reads/AnonymousConferenceReadTests.cs:14` |
| `OutputCacheEvictionTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Reads` | `MMCA.ADC.Conference.IntegrationTests/Reads/OutputCacheEvictionTests.cs:24` |
| `SessionIncludeChildrenRegressionTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Reads` | `MMCA.ADC.Conference.IntegrationTests/Reads/SessionIncludeChildrenRegressionTests.cs:23` |
| `SpeakerManagementTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Speaker` | `MMCA.ADC.Conference.IntegrationTests/Speaker/SpeakerManagementTests.cs:9` |
| `SpeakerUpdateAuthTests` | class | MMCA.ADC.Conference.IntegrationTests | `MMCA.ADC.Conference.IntegrationTests.Speaker` | `MMCA.ADC.Conference.IntegrationTests/Speaker/SpeakerUpdateAuthTests.cs:7` |
| `SelfHttpOutputCacheWarmupTask` | class | MMCA.ADC.Conference.Service | `MMCA.ADC.Conference.Service` | `MMCA.ADC.Conference.Service/SelfHttpOutputCacheWarmupTask.cs:18` |
| `EventLiveValidationGrpcService` | class | MMCA.ADC.Conference.Service | `MMCA.ADC.Conference.Service.Grpc` | `MMCA.ADC.Conference.Service/Grpc/EventLiveValidationGrpcService.cs:22` |
| `SessionBookmarksGrpcService` | class | MMCA.ADC.Conference.Service | `MMCA.ADC.Conference.Service.Grpc` | `MMCA.ADC.Conference.Service/Grpc/SessionBookmarksGrpcService.cs:23` |
| `ConferenceFeatures` | class | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared` | `MMCA.ADC.Conference.Shared/ConferenceFeatures.cs:8` |
| `ConferencePermissions` | class | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Authorization` | `MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:9` |
| `CategoryItemDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Categories` | `MMCA.ADC.Conference.Shared/Categories/CategoryItemDTO.cs:8` |
| `ConferenceCategoryDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Categories` | `MMCA.ADC.Conference.Shared/Categories/ConferenceCategoryDTO.cs:9` |
| `CurrentEventDefaults` | class | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/CurrentEventDefaults.cs:8` |
| `CurrentEventSelector` | class | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/CurrentEventSelector.cs:10` |
| `DisabledEventLiveValidationService` | class | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/DisabledEventLiveValidationService.cs:22` |
| `EventDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/EventDTO.cs:9` |
| `EventLiveInfo` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/EventLiveInfo.cs:13` |
| `EventQuestionAnswerDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/EventQuestionAnswerDTO.cs:9` |
| `EventSpeakerDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/EventSpeakerDTO.cs:8` |
| `IEventLiveValidationService` | interface | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/IEventLiveValidationService.cs:11` |
| `QuestionModerationDefault` | enum | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/QuestionModerationDefault.cs:7` |
| `RefreshFromSessionizeResultDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/RefreshFromSessionizeResultDTO.cs:7` |
| `RoomDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/RoomDTO.cs:8` |
| `SessionLiveInfo` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Events` | `MMCA.ADC.Conference.Shared/Events/SessionLiveInfo.cs:17` |
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
| `LinkUserRequest` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Speakers` | `MMCA.ADC.Conference.Shared/Speakers/LinkUserRequest.cs:6` |
| `RatingQuestionSummary` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Speakers` | `MMCA.ADC.Conference.Shared/Speakers/SessionFeedbackDTO.cs:22` |
| `SessionFeedbackDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Speakers` | `MMCA.ADC.Conference.Shared/Speakers/SessionFeedbackDTO.cs:6` |
| `SpeakerCategoryItemDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Speakers` | `MMCA.ADC.Conference.Shared/Speakers/SpeakerCategoryItemDTO.cs:8` |
| `SpeakerDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Speakers` | `MMCA.ADC.Conference.Shared/Speakers/SpeakerDTO.cs:9` |
| `SpeakerQuestionAnswerDTO` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Speakers` | `MMCA.ADC.Conference.Shared/Speakers/SpeakerQuestionAnswerDTO.cs:9` |
| `TextQuestionResponses` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Speakers` | `MMCA.ADC.Conference.Shared/Speakers/SessionFeedbackDTO.cs:38` |
| `SpeakerLinkedToUser` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Speakers.IntegrationEvents` | `MMCA.ADC.Conference.Shared/Speakers/IntegrationEvents/SpeakerLinkedToUser.cs:20` |
| `SpeakerUnlinkedFromUser` | record | MMCA.ADC.Conference.Shared | `MMCA.ADC.Conference.Shared.Speakers.IntegrationEvents` | `MMCA.ADC.Conference.Shared/Speakers/IntegrationEvents/SpeakerUnlinkedFromUser.cs:17` |
| `ConferenceCategoryDTOTests` | class | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Categories` | `MMCA.ADC.Conference.Shared.Tests/Categories/ConferenceCategoryDTOTests.cs:6` |
| `CurrentEventDefaultsTests` | class | MMCA.ADC.Conference.Shared.Tests | `MMCA.ADC.Conference.Shared.Tests.Events` | `MMCA.ADC.Conference.Shared.Tests/Events/CurrentEventDefaultsTests.cs:10` |
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
| `ConferenceRoutePaths` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI` | `MMCA.ADC.Conference.UI/ConferenceRoutePaths.cs:6` |
| `ConferenceUIModule` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI` | `MMCA.ADC.Conference.UI/ConferenceUIModule.cs:14` |
| `DependencyInjection` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI` | `MMCA.ADC.Conference.UI/DependencyInjection.cs:11` |
| `ConferenceCategoryCreate` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.ConferenceCategory` | `MMCA.ADC.Conference.UI/Pages/ConferenceCategory/ConferenceCategoryCreate.razor.cs:9` |
| `ConferenceCategoryDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.ConferenceCategory` | `MMCA.ADC.Conference.UI/Pages/ConferenceCategory/ConferenceCategoryDetail.razor.cs:11` |
| `ConferenceCategoryList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.ConferenceCategory` | `MMCA.ADC.Conference.UI/Pages/ConferenceCategory/ConferenceCategoryList.razor.cs:10` |
| `EventCreate` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Event` | `MMCA.ADC.Conference.UI/Pages/Event/EventCreate.razor.cs:13` |
| `EventDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Event` | `MMCA.ADC.Conference.UI/Pages/Event/EventDetail.razor.cs:15` |
| `EventList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Event` | `MMCA.ADC.Conference.UI/Pages/Event/EventList.razor.cs:15` |
| `OrganizerEventFeedback` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Feedback` | `MMCA.ADC.Conference.UI/Pages/Feedback/OrganizerEventFeedback.razor.cs:16` |
| `OrganizerSessionFeedback` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Feedback` | `MMCA.ADC.Conference.UI/Pages/Feedback/OrganizerSessionFeedback.razor.cs:15` |
| `CachedSessionPage` | record | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicSessionList.razor.cs:346` |
| `PublicEventDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicEventDetail.razor.cs:14` |
| `PublicEventList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicEventList.razor.cs:15` |
| `PublicSessionDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicSessionDetail.razor.cs:20` |
| `PublicSessionList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicSessionList.razor.cs:26` |
| `PublicSessionListFilterBar` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicSessionListFilterBar.razor.cs:15` |
| `PublicSessionListView` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicSessionListView.razor.cs:20` |
| `PublicSpeakerDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicSpeakerDetail.razor.cs:14` |
| `PublicSpeakerList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Public` | `MMCA.ADC.Conference.UI/Pages/Public/PublicSpeakerList.razor.cs:23` |
| `QuestionCreate` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Question` | `MMCA.ADC.Conference.UI/Pages/Question/QuestionCreate.razor.cs:9` |
| `QuestionDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Question` | `MMCA.ADC.Conference.UI/Pages/Question/QuestionDetail.razor.cs:11` |
| `QuestionList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Question` | `MMCA.ADC.Conference.UI/Pages/Question/QuestionList.razor.cs:10` |
| `RoomCreate` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Room` | `MMCA.ADC.Conference.UI/Pages/Room/RoomCreate.razor.cs:9` |
| `RoomDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Room` | `MMCA.ADC.Conference.UI/Pages/Room/RoomDetail.razor.cs:12` |
| `RoomList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Room` | `MMCA.ADC.Conference.UI/Pages/Room/RoomList.razor.cs:11` |
| `SessionCreate` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Session` | `MMCA.ADC.Conference.UI/Pages/Session/SessionCreate.razor.cs:14` |
| `SessionDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Session` | `MMCA.ADC.Conference.UI/Pages/Session/SessionDetail.razor.cs:17` |
| `SessionList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Session` | `MMCA.ADC.Conference.UI/Pages/Session/SessionList.razor.cs:18` |
| `SessionSelectionAiScores` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.SessionSelection` | `MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionAiScores.razor.cs:12` |
| `SessionSelectionDashboard` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.SessionSelection` | `MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionDashboard.razor.cs:13` |
| `SessionSelectionDisplay` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.SessionSelection` | `MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionDisplay.cs:11` |
| `SessionSelectionSpeakerOverlap` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.SessionSelection` | `MMCA.ADC.Conference.UI/Pages/SessionSelection/SessionSelectionSpeakerOverlap.razor.cs:11` |
| `SpeakerCategoryItemsPanel` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Speaker` | `MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerCategoryItemsPanel.razor.cs:16` |
| `SpeakerCreate` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Speaker` | `MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerCreate.razor.cs:13` |
| `SpeakerDashboard` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Speaker` | `MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerDashboard.razor.cs:16` |
| `SpeakerDetail` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Speaker` | `MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerDetail.razor.cs:22` |
| `SpeakerList` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Pages.Speaker` | `MMCA.ADC.Conference.UI/Pages/Speaker/SpeakerList.razor.cs:18` |
| `CategoryItemInfo` | record | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ICategoryItemLookupService.cs:7` |
| `CategoryItemLookupService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/CategoryItemLookupService.cs:11` |
| `CategoryItemService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/CategoryItemService.cs:10` |
| `ConferenceCategoryService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ConferenceCategoryService.cs:10` |
| `EventInfo` | record | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/IEventLookupService.cs:7` |
| `EventLookupService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/EventLookupService.cs:11` |
| `EventService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/EventService.cs:12` |
| `EventSpeakerService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:14` |
| `ICategoryItemLookupService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ICategoryItemLookupService.cs:16` |
| `ICategoryItemUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ICategoryItemUIService.cs:9` |
| `IConferenceCategoryUIService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/IConferenceCategoryUIService.cs:9` |
| `IEventLookupService` | interface | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/IEventLookupService.cs:18` |
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
| `NavigationPublicLinkBuilder` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/NavigationPublicLinkBuilder.cs:10` |
| `OrganizerEventFeedbackService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/OrganizerFeedbackService.cs:15` |
| `OrganizerSessionFeedbackService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/OrganizerFeedbackService.cs:62` |
| `QuestionService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/QuestionService.cs:10` |
| `RoomService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/RoomService.cs:12` |
| `SessionCategoryItemService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:46` |
| `SessionSelectionService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/SessionSelectionService.cs:12` |
| `SessionService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/SessionService.cs:10` |
| `SessionSpeakerService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:30` |
| `SpeakerCategoryItemService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ChildEntityServices.cs:62` |
| `SpeakerDashboardService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/SpeakerDashboardService.cs:14` |
| `SpeakerInfo` | record | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/ISpeakerLookupService.cs:7` |
| `SpeakerLookupService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/SpeakerLookupService.cs:11` |
| `SpeakerService` | class | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI.Services` | `MMCA.ADC.Conference.UI/Services/SpeakerService.cs:12` |
| `BunitTestBase` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests` | `MMCA.ADC.Conference.UI.Tests/BunitTestBase.cs:19` |
| `ManagementRouteAuthorizationTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests` | `MMCA.ADC.Conference.UI.Tests/ManagementRouteAuthorizationTests.cs:19` |
| `AddToCalendarButtonTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Components` | `MMCA.ADC.Conference.UI.Tests/Components/AddToCalendarButtonTests.cs:21` |
| `QrCodeButtonTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Components` | `MMCA.ADC.Conference.UI.Tests/Components/QrCodeButtonTests.cs:14` |
| `SharePageButtonTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Components` | `MMCA.ADC.Conference.UI.Tests/Components/SharePageButtonTests.cs:17` |
| `EventCreateTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Event` | `MMCA.ADC.Conference.UI.Tests/Pages/Event/EventCreateTests.cs:17` |
| `EventDetailTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Event` | `MMCA.ADC.Conference.UI.Tests/Pages/Event/EventDetailTests.cs:16` |
| `OrganizerEventFeedbackTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Feedback` | `MMCA.ADC.Conference.UI.Tests/Pages/Feedback/OrganizerEventFeedbackTests.cs:18` |
| `OrganizerSessionFeedbackTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Feedback` | `MMCA.ADC.Conference.UI.Tests/Pages/Feedback/OrganizerSessionFeedbackTests.cs:19` |
| `PublicEventDetailTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicEventDetailTests.cs:14` |
| `PublicSessionDetailLiveButtonTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicSessionDetailLiveButtonTests.cs:22` |
| `PublicSessionDetailTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicSessionDetailTests.cs:20` |
| `PublicSessionListEventFilterTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicSessionListEventFilterTests.cs:21` |
| `PublicSpeakerDetailTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicSpeakerDetailTests.cs:13` |
| `PublicSpeakerListEventFilterTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Public` | `MMCA.ADC.Conference.UI.Tests/Pages/Public/PublicSpeakerListEventFilterTests.cs:21` |
| `QuestionCreateTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Question` | `MMCA.ADC.Conference.UI.Tests/Pages/Question/QuestionCreateTests.cs:18` |
| `QuestionDetailTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Question` | `MMCA.ADC.Conference.UI.Tests/Pages/Question/QuestionDetailTests.cs:17` |
| `SessionListEventFilterTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Session` | `MMCA.ADC.Conference.UI.Tests/Pages/Session/SessionListEventFilterTests.cs:21` |
| `SessionSelectionDashboardTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.SessionSelection` | `MMCA.ADC.Conference.UI.Tests/Pages/SessionSelection/SessionSelectionDashboardTests.cs:18` |
| `SpeakerDashboardTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Pages.Speaker` | `MMCA.ADC.Conference.UI.Tests/Pages/Speaker/SpeakerDashboardTests.cs:21` |
| `EventServiceTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Services` | `MMCA.ADC.Conference.UI.Tests/Services/EventServiceTests.cs:15` |
| `OrganizerEventFeedbackServiceTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Services` | `MMCA.ADC.Conference.UI.Tests/Services/OrganizerEventFeedbackServiceTests.cs:15` |
| `OrganizerSessionFeedbackServiceTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Services` | `MMCA.ADC.Conference.UI.Tests/Services/OrganizerSessionFeedbackServiceTests.cs:14` |
| `SessionSelectionServiceTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Services` | `MMCA.ADC.Conference.UI.Tests/Services/SessionSelectionServiceTests.cs:13` |
| `SpeakerDashboardServiceTests` | class | MMCA.ADC.Conference.UI.Tests | `MMCA.ADC.Conference.UI.Tests.Services` | `MMCA.ADC.Conference.UI.Tests/Services/SpeakerDashboardServiceTests.cs:16` |
| `BookmarkCountGrpcTests` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.CrossService` | `MMCA.ADC.CrossService.IntegrationTests/CrossService/BookmarkCountGrpcTests.cs:16` |
| `CrossServiceSmokeTests` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.CrossService` | `MMCA.ADC.CrossService.IntegrationTests/CrossService/CrossServiceSmokeTests.cs:15` |
| `SpeakerLinkBrokerFlowTests` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.CrossService` | `MMCA.ADC.CrossService.IntegrationTests/CrossService/SpeakerLinkBrokerFlowTests.cs:17` |
| `UserRegisteredBrokerFlowTests` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.CrossService` | `MMCA.ADC.CrossService.IntegrationTests/CrossService/UserRegisteredBrokerFlowTests.cs:19` |
| `ConferenceCrossServiceFactory` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.Infrastructure` | `MMCA.ADC.CrossService.IntegrationTests/Infrastructure/ConferenceCrossServiceFactory.cs:26` |
| `CrossServiceCollection` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.Infrastructure` | `MMCA.ADC.CrossService.IntegrationTests/Infrastructure/CrossServiceCollection.cs:10` |
| `CrossServiceFixture` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.Infrastructure` | `MMCA.ADC.CrossService.IntegrationTests/Infrastructure/CrossServiceFixture.cs:35` |
| `CrossServiceTestBase` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.Infrastructure` | `MMCA.ADC.CrossService.IntegrationTests/Infrastructure/CrossServiceTestBase.cs:20` |
| `EngagementCrossServiceFactory` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.Infrastructure` | `MMCA.ADC.CrossService.IntegrationTests/Infrastructure/EngagementCrossServiceFactory.cs:33` |
| `IdentityCrossServiceFactory` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.Infrastructure` | `MMCA.ADC.CrossService.IntegrationTests/Infrastructure/IdentityCrossServiceFactory.cs:28` |
| `InProcessJwtBearer` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.Infrastructure` | `MMCA.ADC.CrossService.IntegrationTests/Infrastructure/InProcessJwtBearer.cs:14` |
| `RateLimiterNeutralizer` | class | MMCA.ADC.CrossService.IntegrationTests | `MMCA.ADC.CrossService.IntegrationTests.Infrastructure` | `MMCA.ADC.CrossService.IntegrationTests/Infrastructure/IdentityCrossServiceFactory.cs:43` |
| `E2ETestCollection` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Infrastructure` | `MMCA.ADC.E2E.Tests/Infrastructure/E2ETestCollection.cs:10` |
| `TestSetup` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Infrastructure` | `MMCA.ADC.E2E.Tests/Infrastructure/TestSetup.cs:5` |
| `ConferenceCategoryCreatePage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/ConferenceCategoryCreatePage.cs:3` |
| `ConferenceCategoryDetailPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/ConferenceCategoryDetailPage.cs:3` |
| `ConferenceCategoryListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/ConferenceCategoryListPage.cs:3` |
| `EventCreatePage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/EventCreatePage.cs:3` |
| `EventDetailPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/EventDetailPage.cs:3` |
| `EventFeedbackPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/EventFeedbackPage.cs:3` |
| `EventListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/EventListPage.cs:3` |
| `HappeningNowPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/HappeningNowPage.cs:9` |
| `OrganizerEventFeedbackPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/OrganizerEventFeedbackPage.cs:3` |
| `OrganizerSessionFeedbackPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/OrganizerSessionFeedbackPage.cs:3` |
| `PublicEventDetailPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/PublicEventDetailPage.cs:3` |
| `PublicEventListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/PublicEventListPage.cs:3` |
| `PublicSessionDetailPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/PublicSessionDetailPage.cs:3` |
| `PublicSessionListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/PublicSessionListPage.cs:3` |
| `PublicSpeakerDetailPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/PublicSpeakerDetailPage.cs:3` |
| `PublicSpeakerListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/PublicSpeakerListPage.cs:3` |
| `QuestionCreatePage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/QuestionCreatePage.cs:3` |
| `QuestionDetailPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/QuestionDetailPage.cs:3` |
| `QuestionListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/QuestionListPage.cs:3` |
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
| `UserListPage` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.PageObjects` | `MMCA.ADC.E2E.Tests/PageObjects/UserListPage.cs:3` |
| `AccessibilityTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows` | `MMCA.ADC.E2E.Tests/Workflows/AccessibilityTests.cs:17` |
| `PseudoLocalizationTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows` | `MMCA.ADC.E2E.Tests/Workflows/PseudoLocalizationTests.cs:34` |
| `WebVitalsTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows` | `MMCA.ADC.E2E.Tests/Workflows/WebVitalsTests.cs:23` |
| `OrganizerCategoryManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/OrganizerCategoryManagementTests.cs:9` |
| `OrganizerEventManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/OrganizerEventManagementTests.cs:9` |
| `OrganizerFeedbackAnalyticsTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/OrganizerFeedbackAnalyticsTests.cs:9` |
| `OrganizerQuestionManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/OrganizerQuestionManagementTests.cs:9` |
| `OrganizerRelationshipManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/OrganizerRelationshipManagementTests.cs:15` |
| `OrganizerRoomManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/OrganizerRoomManagementTests.cs:9` |
| `OrganizerSessionManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/OrganizerSessionManagementTests.cs:9` |
| `OrganizerSpeakerManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/OrganizerSpeakerManagementTests.cs:9` |
| `PublicBrowseTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/PublicBrowseTests.cs:9` |
| `SessionSelectionDashboardTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/SessionSelectionDashboardTests.cs:10` |
| `SpeakerDashboardTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/SpeakerDashboardTests.cs:9` |
| `SpeakerSelfServiceTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Conference` | `MMCA.ADC.E2E.Tests/Workflows/Conference/SpeakerSelfServiceTests.cs:19` |
| `AttendeeBookmarkTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Engagement` | `MMCA.ADC.E2E.Tests/Workflows/Engagement/AttendeeBookmarkTests.cs:13` |
| `AttendeeFeedbackTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Engagement` | `MMCA.ADC.E2E.Tests/Workflows/Engagement/AttendeeFeedbackTests.cs:9` |
| `LivePollWorkflowTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Engagement` | `MMCA.ADC.E2E.Tests/Workflows/Engagement/LivePollWorkflowTests.cs:13` |
| `AccountDeletionTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Identity` | `MMCA.ADC.E2E.Tests/Workflows/Identity/AccountDeletionTests.cs:9` |
| `AuthorizationTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Identity` | `MMCA.ADC.E2E.Tests/Workflows/Identity/AuthorizationTests.cs:11` |
| `LogoutTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Identity` | `MMCA.ADC.E2E.Tests/Workflows/Identity/LogoutTests.cs:5` |
| `ProfileManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Identity` | `MMCA.ADC.E2E.Tests/Workflows/Identity/ProfileManagementTests.cs:13` |
| `UserLoginTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Identity` | `MMCA.ADC.E2E.Tests/Workflows/Identity/UserLoginTests.cs:5` |
| `UserManagementTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Identity` | `MMCA.ADC.E2E.Tests/Workflows/Identity/UserManagementTests.cs:9` |
| `UserRegistrationTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Identity` | `MMCA.ADC.E2E.Tests/Workflows/Identity/UserRegistrationTests.cs:5` |
| `NotificationTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Notifications` | `MMCA.ADC.E2E.Tests/Workflows/Notifications/NotificationTests.cs:10` |
| `UserPreferencesTests` | class | MMCA.ADC.E2E.Tests | `MMCA.ADC.E2E.Tests.Workflows.Preferences` | `MMCA.ADC.E2E.Tests/Workflows/Preferences/UserPreferencesTests.cs:10` |
| `AssemblyReference` | class | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API` | `MMCA.ADC.Engagement.API/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API` | `MMCA.ADC.Engagement.API/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API` | `MMCA.ADC.Engagement.API/DependencyInjection.cs:14` |
| `EngagementModule` | class | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API` | `MMCA.ADC.Engagement.API/EngagementModule.cs:14` |
| `BookmarksController` | class | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API.Controllers` | `MMCA.ADC.Engagement.API/Controllers/BookmarksController.cs:32` |
| `LivePollsController` | class | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API.Controllers` | `MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:40` |
| `SessionQuestionsController` | class | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API.Controllers` | `MMCA.ADC.Engagement.API/Controllers/SessionQuestionsController.cs:35` |
| `EngagementErrorResources` | class | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API.Resources` | `MMCA.ADC.Engagement.API/Resources/EngagementErrorResources.cs:9` |
| `EngagementPermissionGrantsTests` | class | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Authorization` | `MMCA.ADC.Engagement.API.Tests/Authorization/EngagementPermissionGrantsTests.cs:16` |
| `BookmarksControllerTests` | class | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Controllers` | `MMCA.ADC.Engagement.API.Tests/Controllers/BookmarksControllerTests.cs:20` |
| `ControllerMocks` | record | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Controllers` | `MMCA.ADC.Engagement.API.Tests/Controllers/BookmarksControllerTests.cs:400` |
| `ControllerMocks` | record | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Controllers` | `MMCA.ADC.Engagement.API.Tests/Controllers/LivePollsControllerTests.cs:359` |
| `ControllerMocks` | record | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Controllers` | `MMCA.ADC.Engagement.API.Tests/Controllers/SessionQuestionsControllerTests.cs:288` |
| `LivePollsControllerTests` | class | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Controllers` | `MMCA.ADC.Engagement.API.Tests/Controllers/LivePollsControllerTests.cs:21` |
| `SessionQuestionsControllerTests` | class | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Controllers` | `MMCA.ADC.Engagement.API.Tests/Controllers/SessionQuestionsControllerTests.cs:18` |
| `EngagementErrorResourcesTests` | class | MMCA.ADC.Engagement.API.Tests | `MMCA.ADC.Engagement.API.Tests.Localization` | `MMCA.ADC.Engagement.API.Tests/Localization/EngagementErrorResourcesTests.cs:15` |
| `AssemblyReference` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application` | `MMCA.ADC.Engagement.Application/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application` | `MMCA.ADC.Engagement.Application/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application` | `MMCA.ADC.Engagement.Application/DependencyInjection.cs:27` |
| `UserEngagementExportService` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.Exports` | `MMCA.ADC.Engagement.Application/Exports/UserEngagementExportService.cs:14` |
| `LivePollDTOMapper` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.DTOs` | `MMCA.ADC.Engagement.Application/LivePolls/DTOs/LivePollDTOMapper.cs:13` |
| `LivePollAuthorization` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.Services` | `MMCA.ADC.Engagement.Application/LivePolls/Services/LivePollAuthorization.cs:12` |
| `LivePollNavigationPopulator` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.Services` | `MMCA.ADC.Engagement.Application/LivePolls/Services/LivePollNavigationPopulator.cs:11` |
| `LivePollResultsBuilder` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.Services` | `MMCA.ADC.Engagement.Application/LivePolls/Services/LivePollResultsBuilder.cs:12` |
| `CastVoteCommand` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.CastVote` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteCommand.cs:11` |
| `CastVoteCommandValidator` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.CastVote` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteCommandValidator.cs:8` |
| `CastVoteHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.CastVote` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteHandler.cs:19` |
| `CloseLivePollCommand` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Close` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Close/CloseLivePollCommand.cs:11` |
| `CloseLivePollHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Close` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Close/CloseLivePollHandler.cs:17` |
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
| `OpenLivePollCommand` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Open` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Open/OpenLivePollCommand.cs:11` |
| `OpenLivePollHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.LivePolls.UseCases.Open` | `MMCA.ADC.Engagement.Application/LivePolls/UseCases/Open/OpenLivePollHandler.cs:19` |
| `SessionQuestionViewBuilder` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.Services` | `MMCA.ADC.Engagement.Application/SessionQuestions/Services/SessionQuestionViewBuilder.cs:12` |
| `GetModerationQueueHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetModerationQueue` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/GetModerationQueue/GetModerationQueueHandler.cs:19` |
| `GetModerationQueueQuery` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetModerationQueue` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/GetModerationQueue/GetModerationQueueQuery.cs:11` |
| `GetSessionQuestionsHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetSessionQuestions` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/GetSessionQuestions/GetSessionQuestionsHandler.cs:15` |
| `GetSessionQuestionsQuery` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.GetSessionQuestions` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/GetSessionQuestions/GetSessionQuestionsQuery.cs:9` |
| `ModerateQuestionCommand` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Moderate` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Moderate/ModerateQuestionCommand.cs:14` |
| `ModerateQuestionHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Moderate` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Moderate/ModerateQuestionHandler.cs:21` |
| `SubmitQuestionCommand` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Submit` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionCommand.cs:11` |
| `SubmitQuestionCommandValidator` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Submit` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionCommandValidator.cs:9` |
| `SubmitQuestionHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.Submit` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/Submit/SubmitQuestionHandler.cs:23` |
| `ToggleUpvoteCommand` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/ToggleUpvote/ToggleUpvoteCommand.cs:11` |
| `ToggleUpvoteCommandValidator` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/ToggleUpvote/ToggleUpvoteCommandValidator.cs:8` |
| `ToggleUpvoteHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.SessionQuestions.UseCases.ToggleUpvote` | `MMCA.ADC.Engagement.Application/SessionQuestions/UseCases/ToggleUpvote/ToggleUpvoteHandler.cs:19` |
| `UserSessionBookmarkDTOMapper` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.UserSessionBookmarks.DTOs` | `MMCA.ADC.Engagement.Application/UserSessionBookmarks/DTOs/UserSessionBookmarkDTOMapper.cs:12` |
| `BookmarkCountService` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.UserSessionBookmarks.Services` | `MMCA.ADC.Engagement.Application/UserSessionBookmarks/Services/BookmarkCountService.cs:11` |
| `CreateBookmarkHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.Create` | `MMCA.ADC.Engagement.Application/UserSessionBookmarks/UseCases/Create/CreateBookmarkHandler.cs:17` |
| `CreateBookmarkRequestValidator` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.Create` | `MMCA.ADC.Engagement.Application/UserSessionBookmarks/UseCases/Create/CreateBookmarkRequestValidator.cs:9` |
| `GetBookmarkedSessionIdsHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetBookmarkedSessionIds` | `MMCA.ADC.Engagement.Application/UserSessionBookmarks/UseCases/GetBookmarkedSessionIds/GetBookmarkedSessionIdsHandler.cs:12` |
| `GetBookmarkedSessionIdsQuery` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetBookmarkedSessionIds` | `MMCA.ADC.Engagement.Application/UserSessionBookmarks/UseCases/GetBookmarkedSessionIds/GetBookmarkedSessionIdsQuery.cs:10` |
| `GetUserBookmarksHandler` | class | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetUserBookmarks` | `MMCA.ADC.Engagement.Application/UserSessionBookmarks/UseCases/GetUserBookmarks/GetUserBookmarksHandler.cs:17` |
| `GetUserBookmarksQuery` | record | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application.UserSessionBookmarks.UseCases.GetUserBookmarks` | `MMCA.ADC.Engagement.Application/UserSessionBookmarks/UseCases/GetUserBookmarks/GetUserBookmarksQuery.cs:18` |
| `LivePollDTOMapperTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.DTOs` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/DTOs/LivePollDTOMapperTests.cs:9` |
| `CastVoteHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/CastVoteHandlerTests.cs:15` |
| `CloseLivePollHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/CloseLivePollHandlerTests.cs:14` |
| `CreateLivePollHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/CreateLivePollHandlerTests.cs:14` |
| `GetEventPollsHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/GetEventPollsHandlerTests.cs:12` |
| `GetOpenPollsHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/GetOpenPollsHandlerTests.cs:12` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/CastVoteHandlerTests.cs:166` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/CloseLivePollHandlerTests.cs:141` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/CreateLivePollHandlerTests.cs:199` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/OpenLivePollHandlerTests.cs:192` |
| `OpenLivePollHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.UseCases` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/UseCases/OpenLivePollHandlerTests.cs:14` |
| `CastVoteCommandValidatorTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.Validation` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/Validation/CastVoteCommandValidatorTests.cs:6` |
| `CreateLivePollCommandValidatorTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.LivePolls.Validation` | `MMCA.ADC.Engagement.Application.Tests/LivePolls/Validation/CreateLivePollCommandValidatorTests.cs:8` |
| `GetModerationQueueHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.SessionQuestions.UseCases` | `MMCA.ADC.Engagement.Application.Tests/SessionQuestions/UseCases/GetModerationQueueHandlerTests.cs:14` |
| `GetSessionQuestionsHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.SessionQuestions.UseCases` | `MMCA.ADC.Engagement.Application.Tests/SessionQuestions/UseCases/GetSessionQuestionsHandlerTests.cs:12` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.SessionQuestions.UseCases` | `MMCA.ADC.Engagement.Application.Tests/SessionQuestions/UseCases/GetModerationQueueHandlerTests.cs:119` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.SessionQuestions.UseCases` | `MMCA.ADC.Engagement.Application.Tests/SessionQuestions/UseCases/ModerateQuestionHandlerTests.cs:227` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.SessionQuestions.UseCases` | `MMCA.ADC.Engagement.Application.Tests/SessionQuestions/UseCases/SubmitQuestionHandlerTests.cs:149` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.SessionQuestions.UseCases` | `MMCA.ADC.Engagement.Application.Tests/SessionQuestions/UseCases/ToggleUpvoteHandlerTests.cs:188` |
| `ModerateQuestionHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.SessionQuestions.UseCases` | `MMCA.ADC.Engagement.Application.Tests/SessionQuestions/UseCases/ModerateQuestionHandlerTests.cs:14` |
| `SubmitQuestionHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.SessionQuestions.UseCases` | `MMCA.ADC.Engagement.Application.Tests/SessionQuestions/UseCases/SubmitQuestionHandlerTests.cs:16` |
| `ToggleUpvoteHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.SessionQuestions.UseCases` | `MMCA.ADC.Engagement.Application.Tests/SessionQuestions/UseCases/ToggleUpvoteHandlerTests.cs:13` |
| `FixedTimeProvider` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Support` | `MMCA.ADC.Engagement.Application.Tests/Support/TestSupport.cs:13` |
| `InMemoryQueryableExecutor` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Support` | `MMCA.ADC.Engagement.Application.Tests/Support/TestSupport.cs:23` |
| `TestSupport` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.Support` | `MMCA.ADC.Engagement.Application.Tests/Support/TestSupport.cs:43` |
| `UserSessionBookmarkDTOMapperTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.DTOs` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/DTOs/UserSessionBookmarkDTOMapperTests.cs:7` |
| `BookmarkCountServiceTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.Services` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/Services/BookmarkCountServiceTests.cs:10` |
| `ServiceMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.Services` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/Services/BookmarkCountServiceTests.cs:34` |
| `CreateBookmarkHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.UseCases` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/UseCases/CreateBookmarkHandlerTests.cs:16` |
| `GetBookmarkedSessionIdsHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.UseCases` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/UseCases/GetBookmarkedSessionIdsHandlerTests.cs:9` |
| `GetUserBookmarksHandlerTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.UseCases` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/UseCases/GetUserBookmarksHandlerTests.cs:13` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.UseCases` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/UseCases/CreateBookmarkHandlerTests.cs:85` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.UseCases` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/UseCases/GetBookmarkedSessionIdsHandlerTests.cs:46` |
| `HandlerMocks` | record | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.UseCases` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/UseCases/GetUserBookmarksHandlerTests.cs:16` |
| `CreateBookmarkRequestValidatorTests` | class | MMCA.ADC.Engagement.Application.Tests | `MMCA.ADC.Engagement.Application.Tests.UserSessionBookmarks.Validation` | `MMCA.ADC.Engagement.Application.Tests/UserSessionBookmarks/Validation/CreateBookmarkRequestValidatorTests.cs:7` |
| `BookmarkCountServiceGrpcAdapter` | class | MMCA.ADC.Engagement.Contracts | `MMCA.ADC.Engagement.Contracts` | `MMCA.ADC.Engagement.Contracts/BookmarkCountServiceGrpcAdapter.cs:14` |
| `DependencyInjection` | class | MMCA.ADC.Engagement.Contracts | `MMCA.ADC.Engagement.Contracts` | `MMCA.ADC.Engagement.Contracts/DependencyInjection.cs:16` |
| `UserEngagementExportServiceGrpcAdapter` | class | MMCA.ADC.Engagement.Contracts | `MMCA.ADC.Engagement.Contracts` | `MMCA.ADC.Engagement.Contracts/UserEngagementExportServiceGrpcAdapter.cs:16` |
| `AssemblyReference` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain` | `MMCA.ADC.Engagement.Domain/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain` | `MMCA.ADC.Engagement.Domain/AssemblyReference.cs:11` |
| `LivePoll` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.LivePolls` | `MMCA.ADC.Engagement.Domain/LivePolls/LivePoll.cs:18` |
| `LivePollInvariants` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.LivePolls` | `MMCA.ADC.Engagement.Domain/LivePolls/LivePollInvariants.cs:9` |
| `LivePollOption` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.LivePolls` | `MMCA.ADC.Engagement.Domain/LivePolls/LivePollOption.cs:13` |
| `LivePollVote` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.LivePolls` | `MMCA.ADC.Engagement.Domain/LivePolls/LivePollVote.cs:20` |
| `LivePollVoteInvariants` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.LivePolls` | `MMCA.ADC.Engagement.Domain/LivePolls/LivePollVoteInvariants.cs:9` |
| `LivePollChanged` | record | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.LivePolls.DomainEvents` | `MMCA.ADC.Engagement.Domain/LivePolls/DomainEvents/LivePollChanged.cs:17` |
| `LivePollVoteChanged` | record | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.LivePolls.DomainEvents` | `MMCA.ADC.Engagement.Domain/LivePolls/DomainEvents/LivePollVoteChanged.cs:15` |
| `BookmarkManagementDomainService` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.Services` | `MMCA.ADC.Engagement.Domain/Services/BookmarkManagementDomainService.cs:10` |
| `IBookmarkManagementDomainService` | interface | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.Services` | `MMCA.ADC.Engagement.Domain/Services/IBookmarkManagementDomainService.cs:12` |
| `SessionQuestion` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.SessionQuestions` | `MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestion.cs:19` |
| `SessionQuestionInvariants` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.SessionQuestions` | `MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestionInvariants.cs:9` |
| `SessionQuestionUpvote` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.SessionQuestions` | `MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestionUpvote.cs:20` |
| `SessionQuestionUpvoteInvariants` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.SessionQuestions` | `MMCA.ADC.Engagement.Domain/SessionQuestions/SessionQuestionUpvoteInvariants.cs:9` |
| `SessionQuestionChanged` | record | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.SessionQuestions.DomainEvents` | `MMCA.ADC.Engagement.Domain/SessionQuestions/DomainEvents/SessionQuestionChanged.cs:17` |
| `SessionQuestionUpvoteChanged` | record | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.SessionQuestions.DomainEvents` | `MMCA.ADC.Engagement.Domain/SessionQuestions/DomainEvents/SessionQuestionUpvoteChanged.cs:14` |
| `UserSessionBookmark` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.UserSessionBookmarks` | `MMCA.ADC.Engagement.Domain/UserSessionBookmarks/UserSessionBookmark.cs:17` |
| `UserSessionBookmarkInvariants` | class | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.UserSessionBookmarks` | `MMCA.ADC.Engagement.Domain/UserSessionBookmarks/UserSessionBookmarkInvariants.cs:9` |
| `UserSessionBookmarkChanged` | record | MMCA.ADC.Engagement.Domain | `MMCA.ADC.Engagement.Domain.UserSessionBookmarks.DomainEvents` | `MMCA.ADC.Engagement.Domain/UserSessionBookmarks/DomainEvents/UserSessionBookmarkChanged.cs:15` |
| `LivePollTests` | class | MMCA.ADC.Engagement.Domain.Tests | `MMCA.ADC.Engagement.Domain.Tests.LivePolls` | `MMCA.ADC.Engagement.Domain.Tests/LivePolls/LivePollTests.cs:9` |
| `LivePollVoteTests` | class | MMCA.ADC.Engagement.Domain.Tests | `MMCA.ADC.Engagement.Domain.Tests.LivePolls` | `MMCA.ADC.Engagement.Domain.Tests/LivePolls/LivePollVoteTests.cs:8` |
| `BookmarkManagementDomainServiceTests` | class | MMCA.ADC.Engagement.Domain.Tests | `MMCA.ADC.Engagement.Domain.Tests.Services` | `MMCA.ADC.Engagement.Domain.Tests/Services/BookmarkManagementDomainServiceTests.cs:7` |
| `SessionQuestionTests` | class | MMCA.ADC.Engagement.Domain.Tests | `MMCA.ADC.Engagement.Domain.Tests.SessionQuestions` | `MMCA.ADC.Engagement.Domain.Tests/SessionQuestions/SessionQuestionTests.cs:9` |
| `SessionQuestionUpvoteTests` | class | MMCA.ADC.Engagement.Domain.Tests | `MMCA.ADC.Engagement.Domain.Tests.SessionQuestions` | `MMCA.ADC.Engagement.Domain.Tests/SessionQuestions/SessionQuestionUpvoteTests.cs:8` |
| `UserSessionBookmarkTests` | class | MMCA.ADC.Engagement.Domain.Tests | `MMCA.ADC.Engagement.Domain.Tests.UserSessionBookmarks` | `MMCA.ADC.Engagement.Domain.Tests/UserSessionBookmarks/UserSessionBookmarkTests.cs:8` |
| `AssemblyReference` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure` | `MMCA.ADC.Engagement.Infrastructure/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure` | `MMCA.ADC.Engagement.Infrastructure/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure` | `MMCA.ADC.Engagement.Infrastructure/DependencyInjection.cs:8` |
| `ModuleApplicationDbContext` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Persistence.DbContexts` | `MMCA.ADC.Engagement.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:16` |
| `LivePollConfiguration` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/LivePollConfiguration.cs:16` |
| `LivePollOptionConfiguration` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/LivePollOptionConfiguration.cs:11` |
| `LivePollVoteConfiguration` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/LivePollVoteConfiguration.cs:17` |
| `SessionQuestionConfiguration` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/SessionQuestionConfiguration.cs:17` |
| `SessionQuestionUpvoteConfiguration` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/SessionQuestionUpvoteConfiguration.cs:17` |
| `UserSessionBookmarkConfiguration` | class | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Engagement.Infrastructure/Persistence/EntityConfiguration/UserSessionBookmarkConfiguration.cs:17` |
| `EngagementEntityConfigurationTests` | class | MMCA.ADC.Engagement.Infrastructure.Tests | `MMCA.ADC.Engagement.Infrastructure.Tests.Persistence` | `MMCA.ADC.Engagement.Infrastructure.Tests/Persistence/EngagementEntityConfigurationTests.cs:12` |
| `EngagementTestDbContext` | class | MMCA.ADC.Engagement.Infrastructure.Tests | `MMCA.ADC.Engagement.Infrastructure.Tests.Persistence` | `MMCA.ADC.Engagement.Infrastructure.Tests/Persistence/EngagementEntityConfigurationTests.cs:269` |
| `AnonymousBookmarkAccessDeniedTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Bookmarks` | `MMCA.ADC.Engagement.IntegrationTests/Bookmarks/AnonymousBookmarkAccessDeniedTests.cs:8` |
| `AttendeeBookmarkTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Bookmarks` | `MMCA.ADC.Engagement.IntegrationTests/Bookmarks/AttendeeBookmarkTests.cs:14` |
| `OpenApiContractTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Contract` | `MMCA.ADC.Engagement.IntegrationTests/Contract/OpenApiContractTests.cs:14` |
| `ProblemDetailsContractTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Contract` | `MMCA.ADC.Engagement.IntegrationTests/Contract/ProblemDetailsContractTests.cs:16` |
| `EngagementIntegrationTestBase` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Infrastructure` | `MMCA.ADC.Engagement.IntegrationTests/Infrastructure/EngagementIntegrationTestBase.cs:12` |
| `EngagementIntegrationTestCollection` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Infrastructure` | `MMCA.ADC.Engagement.IntegrationTests/Infrastructure/EngagementIntegrationTestCollection.cs:8` |
| `EngagementIntegrationTestFixture` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Infrastructure` | `MMCA.ADC.Engagement.IntegrationTests/Infrastructure/EngagementIntegrationTestFixture.cs:17` |
| `EngagementTestWebApplicationFactory` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Infrastructure` | `MMCA.ADC.Engagement.IntegrationTests/Infrastructure/EngagementTestWebApplicationFactory.cs:39` |
| `FakeEventLiveValidationService` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Infrastructure` | `MMCA.ADC.Engagement.IntegrationTests/Infrastructure/FakeEventLiveValidationService.cs:15` |
| `FakeSessionBookmarkValidationService` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.Infrastructure` | `MMCA.ADC.Engagement.IntegrationTests/Infrastructure/FakeSessionBookmarkValidationService.cs:12` |
| `LivePollAuthorizationTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.LivePolls` | `MMCA.ADC.Engagement.IntegrationTests/LivePolls/LivePollAuthorizationTests.cs:13` |
| `OrganizerLivePollLifecycleTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.LivePolls` | `MMCA.ADC.Engagement.IntegrationTests/LivePolls/OrganizerLivePollLifecycleTests.cs:17` |
| `SessionQuestionLifecycleTests` | class | MMCA.ADC.Engagement.IntegrationTests | `MMCA.ADC.Engagement.IntegrationTests.SessionQuestions` | `MMCA.ADC.Engagement.IntegrationTests/SessionQuestions/SessionQuestionLifecycleTests.cs:17` |
| `BookmarkCountsGrpcService` | class | MMCA.ADC.Engagement.Service | `MMCA.ADC.Engagement.Service.Grpc` | `MMCA.ADC.Engagement.Service/Grpc/BookmarkCountsGrpcService.cs:12` |
| `UserEngagementExportGrpcService` | class | MMCA.ADC.Engagement.Service | `MMCA.ADC.Engagement.Service.Grpc` | `MMCA.ADC.Engagement.Service/Grpc/UserEngagementExportGrpcService.cs:16` |
| `EngagementFeatures` | class | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared` | `MMCA.ADC.Engagement.Shared/EngagementFeatures.cs:8` |
| `EngagementPermissions` | class | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Authorization` | `MMCA.ADC.Engagement.Shared/Authorization/EngagementPermissions.cs:9` |
| `DisabledUserEngagementExportService` | class | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Exports` | `MMCA.ADC.Engagement.Shared/Exports/DisabledUserEngagementExportService.cs:7` |
| `IUserEngagementExportService` | interface | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Exports` | `MMCA.ADC.Engagement.Shared/Exports/IUserEngagementExportService.cs:11` |
| `UserEngagementBookmarkExportDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Exports` | `MMCA.ADC.Engagement.Shared/Exports/UserEngagementBookmarkExportDTO.cs:7` |
| `UserEngagementExportDTO` | record | MMCA.ADC.Engagement.Shared | `MMCA.ADC.Engagement.Shared.Exports` | `MMCA.ADC.Engagement.Shared/Exports/UserEngagementExportDTO.cs:8` |
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
| `DisabledBookmarkCountServiceTests` | class | MMCA.ADC.Engagement.Shared.Tests | `MMCA.ADC.Engagement.Shared.Tests.UserSessionBookmarks` | `MMCA.ADC.Engagement.Shared.Tests/UserSessionBookmarks/DisabledBookmarkCountServiceTests.cs:6` |
| `UserSessionBookmarkDTOTests` | class | MMCA.ADC.Engagement.Shared.Tests | `MMCA.ADC.Engagement.Shared.Tests.UserSessionBookmarks` | `MMCA.ADC.Engagement.Shared.Tests/UserSessionBookmarks/UserSessionBookmarkDTOTests.cs:6` |
| `DependencyInjection` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI` | `MMCA.ADC.Engagement.UI/DependencyInjection.cs:13` |
| `EngagementRoutePaths` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI` | `MMCA.ADC.Engagement.UI/EngagementRoutePaths.cs:6` |
| `EngagementUIModule` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI` | `MMCA.ADC.Engagement.UI/EngagementUIModule.cs:14` |
| `AnswerState` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.Feedback` | `MMCA.ADC.Engagement.UI/Pages/Feedback/EventFeedback.razor.cs:263` |
| `AnswerState` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.Feedback` | `MMCA.ADC.Engagement.UI/Pages/Feedback/SessionFeedback.razor.cs:296` |
| `EventFeedback` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.Feedback` | `MMCA.ADC.Engagement.UI/Pages/Feedback/EventFeedback.razor.cs:16` |
| `SessionFeedback` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.Feedback` | `MMCA.ADC.Engagement.UI/Pages/Feedback/SessionFeedback.razor.cs:16` |
| `HappeningNow` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.HappeningNow` | `MMCA.ADC.Engagement.UI/Pages/HappeningNow/HappeningNow.razor.cs:21` |
| `OptionState` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.HappeningNow` | `MMCA.ADC.Engagement.UI/Pages/HappeningNow/HappeningNow.razor.cs:383` |
| `OptionState` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.SessionLive` | `MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLiveModerationPanel.razor.cs:233` |
| `PresenterView` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.SessionLive` | `MMCA.ADC.Engagement.UI/Pages/SessionLive/PresenterView.razor.cs:17` |
| `SessionLive` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.SessionLive` | `MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLive.razor.cs:23` |
| `SessionLiveModerationPanel` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.SessionLive` | `MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLiveModerationPanel.razor.cs:19` |
| `SessionLivePollPanel` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.SessionLive` | `MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLivePollPanel.razor.cs:17` |
| `SessionLiveQuestionPanel` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Pages.SessionLive` | `MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLiveQuestionPanel.razor.cs:18` |
| `BookmarkService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/BookmarkService.cs:14` |
| `EventFeedbackService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/EventFeedbackService.cs:13` |
| `IBookmarkUIService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/IBookmarkUIService.cs:10` |
| `IEventFeedbackUIService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/IFeedbackUIService.cs:21` |
| `ILiveEventUIService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/ILiveEventUIService.cs:7` |
| `ILivePollUIService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/ILivePollUIService.cs:10` |
| `IQuestionLookupService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/IFeedbackUIService.cs:10` |
| `ISessionFeedbackUIService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/IFeedbackUIService.cs:43` |
| `ISessionLookupService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/ISessionLookupService.cs:17` |
| `ISessionQuestionUIService` | interface | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/ISessionQuestionUIService.cs:10` |
| `LiveEventContext` | record | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/LiveEventContext.cs:13` |
| `LiveEventService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/LiveEventService.cs:14` |
| `LivePollUIService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/LivePollUIService.cs:12` |
| `QuestionLookupService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/QuestionLookupService.cs:12` |
| `SessionBookmarkUIService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/SessionBookmarkUIService.cs:16` |
| `SessionFeedbackService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/SessionFeedbackService.cs:13` |
| `SessionInfo` | record | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/ISessionLookupService.cs:7` |
| `SessionLiveUIService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/SessionLiveUIService.cs:10` |
| `SessionLookupService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/SessionLookupService.cs:11` |
| `SessionQuestionUIService` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/SessionQuestionUIService.cs:12` |
| `SessionReminder` | record | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/SessionReminderPlanner.cs:13` |
| `SessionReminderCoordinator` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/SessionReminderCoordinator.cs:16` |
| `SessionReminderPlanner` | class | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI.Services` | `MMCA.ADC.Engagement.UI/Services/SessionReminderPlanner.cs:29` |
| `EventFeedbackTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.Feedback` | `MMCA.ADC.Engagement.UI.Tests/Pages/Feedback/EventFeedbackTests.cs:19` |
| `SessionFeedbackTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.Feedback` | `MMCA.ADC.Engagement.UI.Tests/Pages/Feedback/SessionFeedbackTests.cs:21` |
| `HappeningNowTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.HappeningNow` | `MMCA.ADC.Engagement.UI.Tests/Pages/HappeningNow/HappeningNowTests.cs:28` |
| `LivePollCardTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Pages.HappeningNow` | `MMCA.ADC.Engagement.UI.Tests/Pages/HappeningNow/LivePollCardTests.cs:14` |
| `BookmarkServiceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/BookmarkServiceTests.cs:17` |
| `EventFeedbackServiceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/EventFeedbackServiceTests.cs:15` |
| `LivePollUIServiceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/LivePollUIServiceTests.cs:15` |
| `QuestionLookupServiceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/QuestionLookupServiceTests.cs:13` |
| `SessionBookmarkUIServiceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/SessionBookmarkUIServiceTests.cs:18` |
| `SessionFeedbackServiceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/SessionFeedbackServiceTests.cs:15` |
| `SessionLookupServiceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/SessionLookupServiceTests.cs:14` |
| `SessionQuestionUIServiceTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/SessionQuestionUIServiceTests.cs:14` |
| `SessionReminderCoordinatorTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/SessionReminderCoordinatorTests.cs:16` |
| `SessionReminderPlannerTests` | class | MMCA.ADC.Engagement.UI.Tests | `MMCA.ADC.Engagement.UI.Tests.Services` | `MMCA.ADC.Engagement.UI.Tests/Services/SessionReminderPlannerTests.cs:11` |
| `GatewayApplicationFactory` | class | MMCA.ADC.Gateway.Tests | `MMCA.ADC.Gateway.Tests` | `MMCA.ADC.Gateway.Tests/GatewayApplicationFactory.cs:12` |
| `GracefulShutdownTests` | class | MMCA.ADC.Gateway.Tests | `MMCA.ADC.Gateway.Tests` | `MMCA.ADC.Gateway.Tests/GracefulShutdownTests.cs:14` |
| `SecurityHeadersTests` | class | MMCA.ADC.Gateway.Tests | `MMCA.ADC.Gateway.Tests` | `MMCA.ADC.Gateway.Tests/SecurityHeadersTests.cs:11` |
| `AssemblyReference` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API` | `MMCA.ADC.Identity.API/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API` | `MMCA.ADC.Identity.API/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API` | `MMCA.ADC.Identity.API/DependencyInjection.cs:15` |
| `IdentityModule` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API` | `MMCA.ADC.Identity.API/IdentityModule.cs:13` |
| `IdentityModuleSeeder` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API` | `MMCA.ADC.Identity.API/IdentityModuleSeeder.cs:12` |
| `AuthController` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API.Controllers` | `MMCA.ADC.Identity.API/Controllers/AuthController.cs:24` |
| `OAuthController` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API.Controllers` | `MMCA.ADC.Identity.API/Controllers/OAuthController.cs:20` |
| `UserClaimsController` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API.Controllers` | `MMCA.ADC.Identity.API/Controllers/UserClaimsController.cs:16` |
| `UsersController` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API.Controllers` | `MMCA.ADC.Identity.API/Controllers/UsersController.cs:31` |
| `IdentityErrorResources` | class | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API.Resources` | `MMCA.ADC.Identity.API/Resources/IdentityErrorResources.cs:11` |
| `DependencyInjectionTests` | class | MMCA.ADC.Identity.API.Tests | `MMCA.ADC.Identity.API.Tests` | `MMCA.ADC.Identity.API.Tests/DependencyInjectionTests.cs:8` |
| `IdentityModuleTests` | class | MMCA.ADC.Identity.API.Tests | `MMCA.ADC.Identity.API.Tests` | `MMCA.ADC.Identity.API.Tests/IdentityModuleTests.cs:7` |
| `AuthControllerTests` | class | MMCA.ADC.Identity.API.Tests | `MMCA.ADC.Identity.API.Tests.Controllers` | `MMCA.ADC.Identity.API.Tests/Controllers/AuthControllerTests.cs:17` |
| `OAuthControllerTests` | class | MMCA.ADC.Identity.API.Tests | `MMCA.ADC.Identity.API.Tests.Controllers` | `MMCA.ADC.Identity.API.Tests/Controllers/OAuthControllerTests.cs:16` |
| `UserClaimsControllerTests` | class | MMCA.ADC.Identity.API.Tests | `MMCA.ADC.Identity.API.Tests.Controllers` | `MMCA.ADC.Identity.API.Tests/Controllers/UserClaimsControllerTests.cs:9` |
| `UsersControllerTests` | class | MMCA.ADC.Identity.API.Tests | `MMCA.ADC.Identity.API.Tests.Controllers` | `MMCA.ADC.Identity.API.Tests/Controllers/UsersControllerTests.cs:20` |
| `IdentityErrorResourcesTests` | class | MMCA.ADC.Identity.API.Tests | `MMCA.ADC.Identity.API.Tests.Localization` | `MMCA.ADC.Identity.API.Tests/Localization/IdentityErrorResourcesTests.cs:15` |
| `AssemblyReference` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application` | `MMCA.ADC.Identity.Application/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application` | `MMCA.ADC.Identity.Application/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application` | `MMCA.ADC.Identity.Application/DependencyInjection.cs:17` |
| `SpeakerLinkedToUserHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Speakers.IntegrationEventHandlers` | `MMCA.ADC.Identity.Application/Speakers/IntegrationEventHandlers/SpeakerLinkedToUserHandler.cs:20` |
| `SpeakerUnlinkedFromUserHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Speakers.IntegrationEventHandlers` | `MMCA.ADC.Identity.Application/Speakers/IntegrationEventHandlers/SpeakerUnlinkedFromUserHandler.cs:19` |
| `AttendeeQueryService` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users` | `MMCA.ADC.Identity.Application/Users/AttendeeQueryService.cs:11` |
| `AuthenticationService` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users` | `MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:22` |
| `SoftDeletedUserValidator` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users` | `MMCA.ADC.Identity.Application/Users/SoftDeletedUserValidator.cs:10` |
| `UserDTOMapper` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.DTOs` | `MMCA.ADC.Identity.Application/Users/DTOs/UserDTOMapper.cs:14` |
| `ChangePasswordCommand` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ChangePassword` | `MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:16` |
| `ChangePasswordHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ChangePassword` | `MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordHandler.cs:14` |
| `ChangePreferencesCommand` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences` | `MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesCommand.cs:12` |
| `ChangePreferencesHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences` | `MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesHandler.cs:13` |
| `ChangePreferencesRequest` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ChangePreferences` | `MMCA.ADC.Identity.Application/Users/UseCases/ChangePreferences/ChangePreferencesRequest.cs:10` |
| `DeleteUserCommand` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.DeleteUser` | `MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserCommand.cs:13` |
| `DeleteUserHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.DeleteUser` | `MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:15` |
| `ExportUserDataHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData` | `MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataHandler.cs:26` |
| `ExportUserDataQuery` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.ExportUserData` | `MMCA.ADC.Identity.Application/Users/UseCases/ExportUserData/ExportUserDataQuery.cs:10` |
| `GetUserPreferencesHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.GetPreferences` | `MMCA.ADC.Identity.Application/Users/UseCases/GetPreferences/GetUserPreferencesHandler.cs:9` |
| `GetUserPreferencesQuery` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.GetPreferences` | `MMCA.ADC.Identity.Application/Users/UseCases/GetPreferences/GetUserPreferencesQuery.cs:7` |
| `UserPreferencesResponse` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.GetPreferences` | `MMCA.ADC.Identity.Application/Users/UseCases/GetPreferences/UserPreferencesResponse.cs:9` |
| `GetUserAvatarHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.GetUserAvatar` | `MMCA.ADC.Identity.Application/Users/UseCases/GetUserAvatar/GetUserAvatarHandler.cs:10` |
| `GetUserAvatarQuery` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.GetUserAvatar` | `MMCA.ADC.Identity.Application/Users/UseCases/GetUserAvatar/GetUserAvatarQuery.cs:5` |
| `GetUsersHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.GetUsers` | `MMCA.ADC.Identity.Application/Users/UseCases/GetUsers/GetUsersHandler.cs:15` |
| `GetUsersQuery` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.GetUsers` | `MMCA.ADC.Identity.Application/Users/UseCases/GetUsers/GetUsersQuery.cs:18` |
| `RemoveUserAvatarCommand` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.RemoveUserAvatar` | `MMCA.ADC.Identity.Application/Users/UseCases/RemoveUserAvatar/RemoveUserAvatarCommand.cs:8` |
| `RemoveUserAvatarHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.RemoveUserAvatar` | `MMCA.ADC.Identity.Application/Users/UseCases/RemoveUserAvatar/RemoveUserAvatarHandler.cs:14` |
| `SetUserAvatarCommand` | record | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.SetUserAvatar` | `MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarCommand.cs:10` |
| `SetUserAvatarHandler` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.UseCases.SetUserAvatar` | `MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarHandler.cs:16` |
| `ChangePasswordRequestValidator` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.Validation` | `MMCA.ADC.Identity.Application/Users/Validation/ChangePasswordRequestValidator.cs:11` |
| `RegisterRequestValidator` | class | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application.Users.Validation` | `MMCA.ADC.Identity.Application/Users/Validation/RegisterRequestValidator.cs:11` |
| `UserDTOMapperTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.DTOs` | `MMCA.ADC.Identity.Application.Tests/DTOs/UserDTOMapperTests.cs:7` |
| `Mocks` | record | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Speakers.IntegrationEventHandlers` | `MMCA.ADC.Identity.Application.Tests/Speakers/IntegrationEventHandlers/SpeakerLinkedToUserHandlerTests.cs:15` |
| `Mocks` | record | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Speakers.IntegrationEventHandlers` | `MMCA.ADC.Identity.Application.Tests/Speakers/IntegrationEventHandlers/SpeakerUnlinkedFromUserHandlerTests.cs:15` |
| `SpeakerLinkedToUserHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Speakers.IntegrationEventHandlers` | `MMCA.ADC.Identity.Application.Tests/Speakers/IntegrationEventHandlers/SpeakerLinkedToUserHandlerTests.cs:12` |
| `SpeakerUnlinkedFromUserHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Speakers.IntegrationEventHandlers` | `MMCA.ADC.Identity.Application.Tests/Speakers/IntegrationEventHandlers/SpeakerUnlinkedFromUserHandlerTests.cs:12` |
| `AttendeeQueryServiceTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users` | `MMCA.ADC.Identity.Application.Tests/Users/AttendeeQueryServiceTests.cs:10` |
| `AuthenticationServiceTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users` | `MMCA.ADC.Identity.Application.Tests/Users/AuthenticationServiceTests.cs:20` |
| `ServiceMocks` | record | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users` | `MMCA.ADC.Identity.Application.Tests/Users/AttendeeQueryServiceTests.cs:13` |
| `ServiceMocks` | record | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users` | `MMCA.ADC.Identity.Application.Tests/Users/AuthenticationServiceTests.cs:372` |
| `SoftDeletedUserValidatorTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users` | `MMCA.ADC.Identity.Application.Tests/Users/SoftDeletedUserValidatorTests.cs:10` |
| `ChangePasswordHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/ChangePasswordHandlerTests.cs:13` |
| `ChangePreferencesHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/ChangePreferencesHandlerTests.cs:11` |
| `DeleteUserHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/DeleteUserHandlerTests.cs:12` |
| `ExportUserDataHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/ExportUserDataHandlerTests.cs:13` |
| `GetUserPreferencesHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/GetUserPreferencesHandlerTests.cs:12` |
| `GetUsersHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/GetUsersHandlerTests.cs:12` |
| `Mocks` | record | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/ChangePasswordHandlerTests.cs:16` |
| `Mocks` | record | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/ChangePreferencesHandlerTests.cs:14` |
| `Mocks` | record | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/DeleteUserHandlerTests.cs:15` |
| `Mocks` | record | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/GetUserPreferencesHandlerTests.cs:15` |
| `Mocks` | record | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/GetUsersHandlerTests.cs:15` |
| `SetUserAvatarHandlerTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Users.UseCases` | `MMCA.ADC.Identity.Application.Tests/Users/UseCases/SetUserAvatarHandlerTests.cs:16` |
| `ChangePasswordRequestValidatorTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Validation` | `MMCA.ADC.Identity.Application.Tests/Validation/ChangePasswordRequestValidatorTests.cs:7` |
| `LoginRequestValidatorTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Validation` | `MMCA.ADC.Identity.Application.Tests/Validation/LoginRequestValidatorTests.cs:7` |
| `RefreshTokenRequestValidatorTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Validation` | `MMCA.ADC.Identity.Application.Tests/Validation/RefreshTokenRequestValidatorTests.cs:7` |
| `RegisterRequestValidatorTests` | class | MMCA.ADC.Identity.Application.Tests | `MMCA.ADC.Identity.Application.Tests.Validation` | `MMCA.ADC.Identity.Application.Tests/Validation/RegisterRequestValidatorTests.cs:8` |
| `AttendeeQueryServiceGrpcAdapter` | class | MMCA.ADC.Identity.Contracts | `MMCA.ADC.Identity.Contracts` | `MMCA.ADC.Identity.Contracts/AttendeeQueryServiceGrpcAdapter.cs:14` |
| `DependencyInjection` | class | MMCA.ADC.Identity.Contracts | `MMCA.ADC.Identity.Contracts` | `MMCA.ADC.Identity.Contracts/DependencyInjection.cs:14` |
| `AssemblyReference` | class | MMCA.ADC.Identity.Domain | `MMCA.ADC.Identity.Domain` | `MMCA.ADC.Identity.Domain/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Identity.Domain | `MMCA.ADC.Identity.Domain` | `MMCA.ADC.Identity.Domain/AssemblyReference.cs:11` |
| `User` | class | MMCA.ADC.Identity.Domain | `MMCA.ADC.Identity.Domain.Users` | `MMCA.ADC.Identity.Domain/Users/User.cs:17` |
| `UserInvariants` | class | MMCA.ADC.Identity.Domain | `MMCA.ADC.Identity.Domain.Users` | `MMCA.ADC.Identity.Domain/Users/UserInvariants.cs:10` |
| `UserRole` | class | MMCA.ADC.Identity.Domain | `MMCA.ADC.Identity.Domain.Users` | `MMCA.ADC.Identity.Domain/Users/UserRole.cs:17` |
| `UserDeleted` | record | MMCA.ADC.Identity.Domain | `MMCA.ADC.Identity.Domain.Users.DomainEvents` | `MMCA.ADC.Identity.Domain/Users/DomainEvents/UserDeleted.cs:10` |
| `UserPasswordChanged` | record | MMCA.ADC.Identity.Domain | `MMCA.ADC.Identity.Domain.Users.DomainEvents` | `MMCA.ADC.Identity.Domain/Users/DomainEvents/UserPasswordChanged.cs:9` |
| `UserBuilder` | class | MMCA.ADC.Identity.Domain.Tests | `MMCA.ADC.Identity.Domain.Tests.Builders` | `MMCA.ADC.Identity.Domain.Tests/Builders/UserBuilder.cs:10` |
| `UserAnonymizeTests` | class | MMCA.ADC.Identity.Domain.Tests | `MMCA.ADC.Identity.Domain.Tests.Users` | `MMCA.ADC.Identity.Domain.Tests/Users/UserAnonymizeTests.cs:12` |
| `UserInvariantsAndRoleTests` | class | MMCA.ADC.Identity.Domain.Tests | `MMCA.ADC.Identity.Domain.Tests.Users` | `MMCA.ADC.Identity.Domain.Tests/Users/UserInvariantsAndRoleTests.cs:14` |
| `UserTests` | class | MMCA.ADC.Identity.Domain.Tests | `MMCA.ADC.Identity.Domain.Tests.Users` | `MMCA.ADC.Identity.Domain.Tests/Users/UserTests.cs:8` |
| `AssemblyReference` | class | MMCA.ADC.Identity.Infrastructure | `MMCA.ADC.Identity.Infrastructure` | `MMCA.ADC.Identity.Infrastructure/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.ADC.Identity.Infrastructure | `MMCA.ADC.Identity.Infrastructure` | `MMCA.ADC.Identity.Infrastructure/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.ADC.Identity.Infrastructure | `MMCA.ADC.Identity.Infrastructure` | `MMCA.ADC.Identity.Infrastructure/DependencyInjection.cs:11` |
| `ModuleApplicationDbContext` | class | MMCA.ADC.Identity.Infrastructure | `MMCA.ADC.Identity.Infrastructure.Persistence.DbContexts` | `MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:15` |
| `IdentityModuleDbSeeder` | class | MMCA.ADC.Identity.Infrastructure | `MMCA.ADC.Identity.Infrastructure.Persistence.DbContexts.Seeding` | `MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeeder.cs:16` |
| `UserConfiguration` | class | MMCA.ADC.Identity.Infrastructure | `MMCA.ADC.Identity.Infrastructure.Persistence.EntityConfiguration` | `MMCA.ADC.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:12` |
| `IdentityEntityConfigurationTests` | class | MMCA.ADC.Identity.Infrastructure.Tests | `MMCA.ADC.Identity.Infrastructure.Tests.Persistence` | `MMCA.ADC.Identity.Infrastructure.Tests/Persistence/IdentityEntityConfigurationTests.cs:10` |
| `IdentityTestDbContext` | class | MMCA.ADC.Identity.Infrastructure.Tests | `MMCA.ADC.Identity.Infrastructure.Tests.Persistence` | `MMCA.ADC.Identity.Infrastructure.Tests/Persistence/IdentityEntityConfigurationTests.cs:139` |
| `IdentityModuleDbSeederTests` | class | MMCA.ADC.Identity.Infrastructure.Tests | `MMCA.ADC.Identity.Infrastructure.Tests.Seeding` | `MMCA.ADC.Identity.Infrastructure.Tests/Seeding/IdentityModuleDbSeederTests.cs:10` |
| `SeederMocks` | record | MMCA.ADC.Identity.Infrastructure.Tests | `MMCA.ADC.Identity.Infrastructure.Tests.Seeding` | `MMCA.ADC.Identity.Infrastructure.Tests/Seeding/IdentityModuleDbSeederTests.cs:84` |
| `AnonymousAccessDeniedTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Anonymous` | `MMCA.ADC.Identity.IntegrationTests/Anonymous/AnonymousAccessDeniedTests.cs:8` |
| `AnonymousAuthEdgeCaseTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Anonymous` | `MMCA.ADC.Identity.IntegrationTests/Anonymous/AnonymousAuthEdgeCaseTests.cs:7` |
| `JwksDiscoveryTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Anonymous` | `MMCA.ADC.Identity.IntegrationTests/Anonymous/JwksDiscoveryTests.cs:16` |
| `OAuthChallengeTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Anonymous` | `MMCA.ADC.Identity.IntegrationTests/Anonymous/OAuthChallengeTests.cs:14` |
| `AttendeeAccessDeniedTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Attendee` | `MMCA.ADC.Identity.IntegrationTests/Attendee/AttendeeAccessDeniedTests.cs:8` |
| `AttendeeAuthTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Attendee` | `MMCA.ADC.Identity.IntegrationTests/Attendee/AttendeeAuthTests.cs:9` |
| `AttendeeClaimsTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Attendee` | `MMCA.ADC.Identity.IntegrationTests/Attendee/AttendeeClaimsTests.cs:13` |
| `AttendeeProfileTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Attendee` | `MMCA.ADC.Identity.IntegrationTests/Attendee/AttendeeProfileTests.cs:9` |
| `AuthPreferencesTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Attendee` | `MMCA.ADC.Identity.IntegrationTests/Attendee/AuthPreferencesTests.cs:14` |
| `AuthResponse` | record | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Attendee` | `MMCA.ADC.Identity.IntegrationTests/Attendee/AttendeeAuthTests.cs:126` |
| `PreferencesResponse` | record | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Attendee` | `MMCA.ADC.Identity.IntegrationTests/Attendee/AuthPreferencesTests.cs:109` |
| `UserExportTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Attendee` | `MMCA.ADC.Identity.IntegrationTests/Attendee/UserExportTests.cs:15` |
| `AnonymousAuthTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Auth` | `MMCA.ADC.Identity.IntegrationTests/Auth/AnonymousAuthTests.cs:11` |
| `ExchangeResponse` | record | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Auth` | `MMCA.ADC.Identity.IntegrationTests/Auth/OAuthExchangeTests.cs:68` |
| `OAuthExchangeTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Auth` | `MMCA.ADC.Identity.IntegrationTests/Auth/OAuthExchangeTests.cs:18` |
| `ProblemDetailsContractTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Contract` | `MMCA.ADC.Identity.IntegrationTests/Contract/ProblemDetailsContractTests.cs:16` |
| `CrossServiceSpeakerLinkTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.CrossService` | `MMCA.ADC.Identity.IntegrationTests/CrossService/CrossServiceSpeakerLinkTests.cs:23` |
| `OutboxFidelityTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Data` | `MMCA.ADC.Identity.IntegrationTests/Data/OutboxFidelityTests.cs:17` |
| `FakeUserEngagementExportService` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/FakeUserEngagementExportService.cs:10` |
| `FakeUserNotificationExportService` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/FakeUserNotificationExportService.cs:10` |
| `IdentityIntegrationTestBase` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestBase.cs:12` |
| `IdentityIntegrationTestCollection` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestCollection.cs:8` |
| `IdentityIntegrationTestFixture` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestFixture.cs:22` |
| `IdentityTestWebApplicationFactory` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityTestWebApplicationFactory.cs:30` |
| `JwksEnabledIdentityFixture` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/JwksEnabledIdentityFixture.cs:13` |
| `JwksIntegrationTestBase` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/JwksIntegrationTestBase.cs:11` |
| `JwksIntegrationTestCollection` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Infrastructure` | `MMCA.ADC.Identity.IntegrationTests/Infrastructure/JwksIntegrationTestCollection.cs:9` |
| `OrganizerUserTests` | class | MMCA.ADC.Identity.IntegrationTests | `MMCA.ADC.Identity.IntegrationTests.Organizer` | `MMCA.ADC.Identity.IntegrationTests/Organizer/OrganizerUserTests.cs:9` |
| `AttendeesGrpcService` | class | MMCA.ADC.Identity.Service | `MMCA.ADC.Identity.Service.Grpc` | `MMCA.ADC.Identity.Service/Grpc/AttendeesGrpcService.cs:19` |
| `IdentitySettings` | class | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared` | `MMCA.ADC.Identity.Shared/IdentitySettings.cs:7` |
| `IdentityPermissions` | class | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Authorization` | `MMCA.ADC.Identity.Shared/Authorization/IdentityPermissions.cs:8` |
| `DisabledAttendeeQueryService` | class | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/DisabledAttendeeQueryService.cs:7` |
| `IAttendeeQueryService` | interface | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/IAttendeeQueryService.cs:8` |
| `UserAvatarDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserAvatarDTO.cs:7` |
| `UserDataExportBookmarkDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserDataExportBookmarkDTO.cs:7` |
| `UserDataExportDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserDataExportDTO.cs:16` |
| `UserDataExportEngagementSectionDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserDataExportEngagementSectionDTO.cs:10` |
| `UserDataExportNotificationDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserDataExportNotificationDTO.cs:7` |
| `UserDataExportNotificationSectionDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserDataExportNotificationSectionDTO.cs:9` |
| `UserDataExportSubmittedQuestionDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserDataExportSubmittedQuestionDTO.cs:7` |
| `UserDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserDTO.cs:8` |
| `UserListDTO` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users` | `MMCA.ADC.Identity.Shared/Users/UserListDTO.cs:7` |
| `UserRegistered` | record | MMCA.ADC.Identity.Shared | `MMCA.ADC.Identity.Shared.Users.IntegrationEvents` | `MMCA.ADC.Identity.Shared/Users/IntegrationEvents/UserRegistered.cs:23` |
| `DisabledAttendeeQueryServiceTests` | class | MMCA.ADC.Identity.Shared.Tests | `MMCA.ADC.Identity.Shared.Tests.Users` | `MMCA.ADC.Identity.Shared.Tests/Users/DisabledAttendeeQueryServiceTests.cs:6` |
| `UserDTOTests` | class | MMCA.ADC.Identity.Shared.Tests | `MMCA.ADC.Identity.Shared.Tests.Users` | `MMCA.ADC.Identity.Shared.Tests/Users/UserDTOTests.cs:6` |
| `UserListDTOTests` | class | MMCA.ADC.Identity.Shared.Tests | `MMCA.ADC.Identity.Shared.Tests.Users` | `MMCA.ADC.Identity.Shared.Tests/Users/UserListDTOTests.cs:6` |
| `DependencyInjection` | class | MMCA.ADC.Identity.UI | `MMCA.ADC.Identity.UI` | `MMCA.ADC.Identity.UI/DependencyInjection.cs:11` |
| `IdentityRoutePaths` | class | MMCA.ADC.Identity.UI | `MMCA.ADC.Identity.UI` | `MMCA.ADC.Identity.UI/IdentityRoutePaths.cs:6` |
| `IdentityUIModule` | class | MMCA.ADC.Identity.UI | `MMCA.ADC.Identity.UI` | `MMCA.ADC.Identity.UI/IdentityUIModule.cs:13` |
| `Profile` | class | MMCA.ADC.Identity.UI | `MMCA.ADC.Identity.UI.Pages.Profile` | `MMCA.ADC.Identity.UI/Pages/Profile/Profile.razor.cs:15` |
| `UserList` | class | MMCA.ADC.Identity.UI | `MMCA.ADC.Identity.UI.Pages.User` | `MMCA.ADC.Identity.UI/Pages/User/UserList.razor.cs:15` |
| `IUserUIService` | interface | MMCA.ADC.Identity.UI | `MMCA.ADC.Identity.UI.Services` | `MMCA.ADC.Identity.UI/Services/IUserUIService.cs:11` |
| `UserService` | class | MMCA.ADC.Identity.UI | `MMCA.ADC.Identity.UI.Services` | `MMCA.ADC.Identity.UI/Services/UserService.cs:14` |
| `BunitTestBase` | class | MMCA.ADC.Identity.UI.Tests | `MMCA.ADC.Identity.UI.Tests` | `MMCA.ADC.Identity.UI.Tests/BunitTestBase.cs:17` |
| `IdentityRouteAuthorizationTests` | class | MMCA.ADC.Identity.UI.Tests | `MMCA.ADC.Identity.UI.Tests` | `MMCA.ADC.Identity.UI.Tests/IdentityRouteAuthorizationTests.cs:16` |
| `ProfileChangePasswordTests` | class | MMCA.ADC.Identity.UI.Tests | `MMCA.ADC.Identity.UI.Tests.Pages.Profile` | `MMCA.ADC.Identity.UI.Tests/Pages/Profile/ProfileChangePasswordTests.cs:16` |
| `ProfileTests` | class | MMCA.ADC.Identity.UI.Tests | `MMCA.ADC.Identity.UI.Tests.Pages.Profile` | `MMCA.ADC.Identity.UI.Tests/Pages/Profile/ProfileTests.cs:16` |
| `UserListTests` | class | MMCA.ADC.Identity.UI.Tests | `MMCA.ADC.Identity.UI.Tests.Pages.User` | `MMCA.ADC.Identity.UI.Tests/Pages/User/UserListTests.cs:22` |
| `UserServiceTests` | class | MMCA.ADC.Identity.UI.Tests | `MMCA.ADC.Identity.UI.Tests.Services` | `MMCA.ADC.Identity.UI.Tests/Services/UserServiceTests.cs:15` |
| `DependencyInjection` | class | MMCA.ADC.Notification.API | `MMCA.ADC.Notification.API` | `MMCA.ADC.Notification.API/DependencyInjection.cs:13` |
| `NotificationModule` | class | MMCA.ADC.Notification.API | `MMCA.ADC.Notification.API` | `MMCA.ADC.Notification.API/NotificationModule.cs:16` |
| `AttendeeNotificationRecipientProvider` | class | MMCA.ADC.Notification.Application | `MMCA.ADC.Notification.Application` | `MMCA.ADC.Notification.Application/AttendeeNotificationRecipientProvider.cs:10` |
| `DependencyInjection` | class | MMCA.ADC.Notification.Application | `MMCA.ADC.Notification.Application` | `MMCA.ADC.Notification.Application/DependencyInjection.cs:12` |
| `UserNotificationExportService` | class | MMCA.ADC.Notification.Application | `MMCA.ADC.Notification.Application` | `MMCA.ADC.Notification.Application/UserNotificationExportService.cs:15` |
| `DependencyInjection` | class | MMCA.ADC.Notification.Contracts | `MMCA.ADC.Notification.Contracts` | `MMCA.ADC.Notification.Contracts/DependencyInjection.cs:16` |
| `LiveChannelPublisherGrpcAdapter` | class | MMCA.ADC.Notification.Contracts | `MMCA.ADC.Notification.Contracts` | `MMCA.ADC.Notification.Contracts/LiveChannelPublisherGrpcAdapter.cs:20` |
| `UserNotificationExportServiceGrpcAdapter` | class | MMCA.ADC.Notification.Contracts | `MMCA.ADC.Notification.Contracts` | `MMCA.ADC.Notification.Contracts/UserNotificationExportServiceGrpcAdapter.cs:17` |
| `FakeAttendeeQueryService` | class | MMCA.ADC.Notification.IntegrationTests | `MMCA.ADC.Notification.IntegrationTests.Infrastructure` | `MMCA.ADC.Notification.IntegrationTests/Infrastructure/FakeAttendeeQueryService.cs:12` |
| `NotificationIntegrationTestBase` | class | MMCA.ADC.Notification.IntegrationTests | `MMCA.ADC.Notification.IntegrationTests.Infrastructure` | `MMCA.ADC.Notification.IntegrationTests/Infrastructure/NotificationIntegrationTestBase.cs:17` |
| `NotificationIntegrationTestCollection` | class | MMCA.ADC.Notification.IntegrationTests | `MMCA.ADC.Notification.IntegrationTests.Infrastructure` | `MMCA.ADC.Notification.IntegrationTests/Infrastructure/NotificationIntegrationTestCollection.cs:8` |
| `NotificationIntegrationTestFixture` | class | MMCA.ADC.Notification.IntegrationTests | `MMCA.ADC.Notification.IntegrationTests.Infrastructure` | `MMCA.ADC.Notification.IntegrationTests/Infrastructure/NotificationIntegrationTestFixture.cs:17` |
| `NotificationTestWebApplicationFactory` | class | MMCA.ADC.Notification.IntegrationTests | `MMCA.ADC.Notification.IntegrationTests.Infrastructure` | `MMCA.ADC.Notification.IntegrationTests/Infrastructure/NotificationTestWebApplicationFactory.cs:33` |
| `NotificationControllerTests` | class | MMCA.ADC.Notification.IntegrationTests | `MMCA.ADC.Notification.IntegrationTests.Notifications` | `MMCA.ADC.Notification.IntegrationTests/Notifications/NotificationControllerTests.cs:15` |
| `NotificationHubTests` | class | MMCA.ADC.Notification.IntegrationTests | `MMCA.ADC.Notification.IntegrationTests.Notifications` | `MMCA.ADC.Notification.IntegrationTests/Notifications/NotificationHubTests.cs:15` |
| `LiveChannelGrpcService` | class | MMCA.ADC.Notification.Service | `MMCA.ADC.Notification.Service.Grpc` | `MMCA.ADC.Notification.Service/Grpc/LiveChannelGrpcService.cs:19` |
| `UserNotificationExportGrpcService` | class | MMCA.ADC.Notification.Service | `MMCA.ADC.Notification.Service.Grpc` | `MMCA.ADC.Notification.Service/Grpc/UserNotificationExportGrpcService.cs:20` |
| `DisabledUserNotificationExportService` | class | MMCA.ADC.Notification.Shared | `MMCA.ADC.Notification.Shared.UserNotifications` | `MMCA.ADC.Notification.Shared/UserNotifications/DisabledUserNotificationExportService.cs:7` |
| `IUserNotificationExportService` | interface | MMCA.ADC.Notification.Shared | `MMCA.ADC.Notification.Shared.UserNotifications` | `MMCA.ADC.Notification.Shared/UserNotifications/IUserNotificationExportService.cs:11` |
| `UserNotificationExportItemDTO` | record | MMCA.ADC.Notification.Shared | `MMCA.ADC.Notification.Shared.UserNotifications` | `MMCA.ADC.Notification.Shared/UserNotifications/UserNotificationExportItemDTO.cs:7` |
| `App` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/App.xaml.cs:7` |
| `AppDelegate` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/iOS/AppDelegate.cs:17` |
| `AppDelegate` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/MacCatalyst/AppDelegate.cs:9` |
| `DeviceUIModule` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/DeviceUIModule.cs:18` |
| `MainActivity` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/Android/MainActivity.cs:28` |
| `MainApplication` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/Android/MainApplication.cs:10` |
| `MainPage` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/MainPage.xaml.cs:13` |
| `MauiProgram` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/MauiProgram.cs:29` |
| `NowNextSession` | record | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:135` |
| `NowNextSnapshot` | record | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:133` |
| `NowNextWidgetProvider` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/Android/NowNextWidgetProvider.cs:23` |
| `Program` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/iOS/Program.cs:8` |
| `Program` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/MacCatalyst/Program.cs:8` |
| `WebAuthenticatorCallbackActivity` | class | MMCA.ADC.UI | `MMCA.ADC.UI` | `MMCA.ADC.UI/Platforms/Android/WebAuthenticatorCallbackActivity.cs:19` |
| `ADCCollectionResult` | record | MMCA.ADC.UI | `MMCA.ADC.UI.Pages` | `MMCA.ADC.UI/Pages/ADCHome.razor.cs:176` |
| `ADCEventInfo` | record | MMCA.ADC.UI | `MMCA.ADC.UI.Pages` | `MMCA.ADC.UI/Pages/ADCHome.razor.cs:178` |
| `ADCHome` | class | MMCA.ADC.UI | `MMCA.ADC.UI.Pages` | `MMCA.ADC.UI/Pages/ADCHome.razor.cs:13` |
| `ADCHomePageContent` | class | MMCA.ADC.UI | `MMCA.ADC.UI.Pages` | `MMCA.ADC.UI/Pages/ADCHomePageContent.cs:8` |
| `ConferenceTrackInfo` | record | MMCA.ADC.UI | `MMCA.ADC.UI.Pages` | `MMCA.ADC.UI/Pages/ADCHome.razor.cs:285` |
| `EventPhase` | enum | MMCA.ADC.UI | `MMCA.ADC.UI.Pages` | `MMCA.ADC.UI/Pages/ADCHome.razor.cs:29` |
| `KeynoteSpeakerInfo` | record | MMCA.ADC.UI | `MMCA.ADC.UI.Pages` | `MMCA.ADC.UI/Pages/ADCHome.razor.cs:284` |
| `SponsorInfo` | record | MMCA.ADC.UI | `MMCA.ADC.UI.Pages` | `MMCA.ADC.UI/Pages/ADCHome.razor.cs:287` |
| `SponsorTierInfo` | record | MMCA.ADC.UI | `MMCA.ADC.UI.Pages` | `MMCA.ADC.UI/Pages/ADCHome.razor.cs:286` |
| `AppActionsInitializer` | class | MMCA.ADC.UI | `MMCA.ADC.UI.Services` | `MMCA.ADC.UI/Services/AppActionsInitializer.cs:16` |
| `MauiPublicLinkBuilder` | class | MMCA.ADC.UI | `MMCA.ADC.UI.Services` | `MMCA.ADC.UI/Services/MauiPublicLinkBuilder.cs:13` |
| `MauiTokenStorageService` | class | MMCA.ADC.UI | `MMCA.ADC.UI.Services` | `MMCA.ADC.UI/Services/MauiTokenStorageService.cs:9` |
| `App` | class | MMCA.ADC.UI | `MMCA.ADC.UI.WinUI` | `MMCA.ADC.UI/Platforms/Windows/App.xaml.cs:8` |
| `ADCCollectionResult` | record | MMCA.ADC.UI.Web.Client | `MMCA.ADC.UI.Web.Client.Pages` | `MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:207` |
| `ADCEventInfo` | record | MMCA.ADC.UI.Web.Client | `MMCA.ADC.UI.Web.Client.Pages` | `MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:209` |
| `ADCHome` | class | MMCA.ADC.UI.Web.Client | `MMCA.ADC.UI.Web.Client.Pages` | `MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:13` |
| `ADCHomePageContent` | class | MMCA.ADC.UI.Web.Client | `MMCA.ADC.UI.Web.Client.Pages` | `MMCA.ADC.UI.Web.Client/Pages/ADCHomePageContent.cs:8` |
| `ConferenceTrackInfo` | record | MMCA.ADC.UI.Web.Client | `MMCA.ADC.UI.Web.Client.Pages` | `MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:316` |
| `EventPhase` | enum | MMCA.ADC.UI.Web.Client | `MMCA.ADC.UI.Web.Client.Pages` | `MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:30` |
| `KeynoteSpeakerInfo` | record | MMCA.ADC.UI.Web.Client | `MMCA.ADC.UI.Web.Client.Pages` | `MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:315` |
| `SponsorInfo` | record | MMCA.ADC.UI.Web.Client | `MMCA.ADC.UI.Web.Client.Pages` | `MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:318` |
| `SponsorTierInfo` | record | MMCA.ADC.UI.Web.Client | `MMCA.ADC.UI.Web.Client.Pages` | `MMCA.ADC.UI.Web.Client/Pages/ADCHome.razor.cs:317` |
| `AssemblyReference` | class | MMCA.Common.API | `MMCA.Common.API` | `MMCA.Common.API/AssemblyReference.cs:8` |
| `ClassReference` | class | MMCA.Common.API | `MMCA.Common.API` | `MMCA.Common.API/AssemblyReference.cs:20` |
| `DependencyInjection` | class | MMCA.Common.API | `MMCA.Common.API` | `MMCA.Common.API/DependencyInjection.cs:24` |
| `ModuleControllerFeatureProvider` | class | MMCA.Common.API | `MMCA.Common.API` | `MMCA.Common.API/ModuleControllerFeatureProvider.cs:28` |
| `ExternalAuthExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Authentication` | `MMCA.Common.API/Authentication/ExternalAuthExtensions.cs:23` |
| `AuthorizationExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/AuthorizationExtensions.cs:12` |
| `AuthorizationPolicies` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/AuthorizationPolicies.cs:11` |
| `HasPermissionAttribute` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/HasPermissionAttribute.cs:13` |
| `OwnerOrAdminFilter` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/OwnerOrAdminFilter.cs:20` |
| `OwnerOrAdminFilterOptions` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:11` |
| `OwnershipHelper` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/OwnershipHelper.cs:10` |
| `PermissionAuthorizationHandler` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/PermissionAuthorizationHandler.cs:13` |
| `PermissionPolicy` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/PermissionPolicy.cs:9` |
| `PermissionPolicyProvider` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/PermissionPolicyProvider.cs:13` |
| `PermissionRequirement` | class | MMCA.Common.API | `MMCA.Common.API.Authorization` | `MMCA.Common.API/Authorization/PermissionRequirement.cs:10` |
| `OutputCacheOptionsExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Caching` | `MMCA.Common.API/Caching/OutputCacheOptionsExtensions.cs:6` |
| `PublicEndpointOutputCachePolicy` | class | MMCA.Common.API | `MMCA.Common.API.Caching` | `MMCA.Common.API/Caching/PublicEndpointOutputCachePolicy.cs:35` |
| `AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>` | class | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/AggregateRootEntityControllerBase.cs:27` |
| `ApiControllerBase` | class | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/ApiControllerBase.cs:16` |
| `AuthControllerBase` | class | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/AuthControllerBase.cs:16` |
| `EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>` | class | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/EntityControllerBase.cs:28` |
| `IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>` | interface | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/IAggregateRootEntityControllerBase.cs:15` |
| `IEntityControllerBase<TEntityDTO, TIdentifierType>` | interface | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/IEntityControllerBase.cs:14` |
| `OAuthControllerBase` | class | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/OAuthControllerBase.cs:32` |
| `ServiceInfoControllerBase` | class | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:30` |
| `ServiceInfoResponse` | record | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:51` |
| `ServiceInfoV2Response` | record | MMCA.Common.API | `MMCA.Common.API.Controllers` | `MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:54` |
| `DevicesController` | class | MMCA.Common.API | `MMCA.Common.API.Controllers.Notifications` | `MMCA.Common.API/Controllers/Notifications/DevicesController.cs:25` |
| `InboxController` | class | MMCA.Common.API | `MMCA.Common.API.Controllers.Notifications` | `MMCA.Common.API/Controllers/Notifications/NotificationInboxController.cs:31` |
| `NotificationsController` | class | MMCA.Common.API | `MMCA.Common.API.Controllers.Notifications` | `MMCA.Common.API/Controllers/Notifications/NotificationsController.cs:31` |
| `DisabledFeatureHandler` | class | MMCA.Common.API | `MMCA.Common.API.FeatureManagement` | `MMCA.Common.API/FeatureManagement/DisabledFeatureHandler.cs:13` |
| `IdempotencyFilter` | class | MMCA.Common.API | `MMCA.Common.API.Idempotency` | `MMCA.Common.API/Idempotency/IdempotencyFilter.cs:34` |
| `IdempotencyRecord` | record | MMCA.Common.API | `MMCA.Common.API.Idempotency` | `MMCA.Common.API/Idempotency/IdempotencyRecord.cs:9` |
| `IdempotencySettings` | class | MMCA.Common.API | `MMCA.Common.API.Idempotency` | `MMCA.Common.API/Idempotency/IdempotencySettings.cs:9` |
| `IdempotentAttribute` | class | MMCA.Common.API | `MMCA.Common.API.Idempotency` | `MMCA.Common.API/Idempotency/IdempotentAttribute.cs:16` |
| `CurrencyJsonConverter` | class | MMCA.Common.API | `MMCA.Common.API.JsonConverters` | `MMCA.Common.API/JsonConverters/CurrencyJsonConverter.cs:13` |
| `ErrorLocalizer` | class | MMCA.Common.API | `MMCA.Common.API.Localization` | `MMCA.Common.API/Localization/ErrorLocalizer.cs:11` |
| `ErrorResourceSource` | class | MMCA.Common.API | `MMCA.Common.API.Localization` | `MMCA.Common.API/Localization/ErrorResourceSource.cs:12` |
| `IErrorLocalizer` | interface | MMCA.Common.API | `MMCA.Common.API.Localization` | `MMCA.Common.API/Localization/IErrorLocalizer.cs:9` |
| `CorrelationIdMiddleware` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/CorrelationIdMiddleware.cs:15` |
| `DbUpdateExceptionHandler` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/DbUpdateExceptionHandler.cs:17` |
| `DomainExceptionHandler` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/DomainExceptionHandler.cs:16` |
| `ErrorHttpMapping` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/ErrorHttpMapping.cs:15` |
| `GlobalExceptionHandler` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/GlobalExceptionHandler.cs:15` |
| `OperationCanceledExceptionHandler` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/OperationCanceledExceptionHandler.cs:16` |
| `SoftDeletedUserMiddleware` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:15` |
| `UnhandledResultFailureFilter` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/UnhandledResultFailureFilter.cs:21` |
| `ValidationExceptionHandler` | class | MMCA.Common.API | `MMCA.Common.API.Middleware` | `MMCA.Common.API/Middleware/ValidationExceptionHandler.cs:17` |
| `QueryFilterModelBinder` | class | MMCA.Common.API | `MMCA.Common.API.ModelBinders` | `MMCA.Common.API/ModelBinders/QueryFilterModelBinder.cs:24` |
| `DependencyInjection` | class | MMCA.Common.API | `MMCA.Common.API.Notifications` | `MMCA.Common.API/Notifications/DependencyInjection.cs:9` |
| `ErrorResources` | class | MMCA.Common.API | `MMCA.Common.API.Resources` | `MMCA.Common.API/Resources/ErrorResources.cs:9` |
| `CookieSessionRefresher` | class | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:43` |
| `CookieSessionRefreshMiddleware` | class | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/CookieSessionRefreshMiddleware.cs:14` |
| `CookieSessionRefreshMiddlewareExtensions` | class | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/CookieSessionRefreshMiddleware.cs:36` |
| `CookieTokenReader` | class | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/CookieTokenReader.cs:10` |
| `ICookieSessionRefresher` | interface | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:26` |
| `SessionCookieAuthenticationExtensions` | class | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/SessionCookieAuthenticationHandler.cs:90` |
| `SessionCookieAuthenticationHandler` | class | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/SessionCookieAuthenticationHandler.cs:24` |
| `SessionCookieEndpoints` | class | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:15` |
| `SessionCookieJar` | class | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/SessionCookieJar.cs:11` |
| `SessionCookieRequest` | record | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/SessionCookieEndpoints.cs:69` |
| `SessionTokenResponse` | record | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:17` |
| `SessionTokenResult` | record struct | MMCA.Common.API | `MMCA.Common.API.SessionCookies` | `MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:11` |
| `AppAssociationEndpointExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/AppAssociationEndpointExtensions.cs:15` |
| `AppAssociationOptions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/AppAssociationOptions.cs:9` |
| `DatabaseInitializationExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:17` |
| `JwksEndpointExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/JwksEndpointExtensions.cs:16` |
| `MiniProfilerExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/MiniProfilerExtensions.cs:9` |
| `OidcDiscoveryEndpointExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/OidcDiscoveryEndpointExtensions.cs:23` |
| `OpenApiEndpointExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/OpenApiEndpointExtensions.cs:18` |
| `SignalRExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/SignalRExtensions.cs:12` |
| `WebApplicationBuilderExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:23` |
| `WebApplicationExtensions` | class | MMCA.Common.API | `MMCA.Common.API.Startup` | `MMCA.Common.API/Startup/WebApplicationExtensions.cs:16` |
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
| `PublicEndpointOutputCachePolicyTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Caching` | `MMCA.Common.API.Tests/Caching/PublicEndpointOutputCachePolicyTests.cs:9` |
| `AggregateRootEntityControllerBaseTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/AggregateRootEntityControllerBaseTests.cs:17` |
| `ApiControllerBaseTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/ApiControllerBaseTests.cs:9` |
| `AuthControllerBaseTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/AuthControllerBaseTests.cs:13` |
| `EntityControllerBaseTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseTests.cs:18` |
| `Mocks` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/OAuthControllerBaseTests.cs:32` |
| `OAuthControllerBaseTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/OAuthControllerBaseTests.cs:26` |
| `SingleServiceProvider` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/OAuthControllerBaseTests.cs:628` |
| `TestAggDTO` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/AggregateRootEntityControllerBaseTests.cs:151` |
| `TestAggregateEntity` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/AggregateRootEntityControllerBaseTests.cs:149` |
| `TestAggregateRootController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/AggregateRootEntityControllerBaseTests.cs:141` |
| `TestApiController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/ApiControllerBaseTests.cs:180` |
| `TestAuthController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/AuthControllerBaseTests.cs:180` |
| `TestCreateRequest` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/AggregateRootEntityControllerBaseTests.cs:156` |
| `TestDTO` | record | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseTests.cs:347` |
| `TestEntity` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseTests.cs:345` |
| `TestEntityController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/EntityControllerBaseTests.cs:334` |
| `TestOAuthController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers` | `MMCA.Common.API.Tests/Controllers/OAuthControllerBaseTests.cs:635` |
| `DevicesControllerTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers.Notifications` | `MMCA.Common.API.Tests/Controllers/Notifications/DevicesControllerTests.cs:17` |
| `NotificationInboxControllerTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers.Notifications` | `MMCA.Common.API.Tests/Controllers/Notifications/NotificationInboxControllerTests.cs:17` |
| `NotificationsControllerTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Controllers.Notifications` | `MMCA.Common.API.Tests/Controllers/Notifications/NotificationsControllerTests.cs:15` |
| `DisabledFeatureHandlerTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.FeatureManagement` | `MMCA.Common.API.Tests/FeatureManagement/DisabledFeatureHandlerTests.cs:11` |
| `IdempotencyFilterTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Idempotency` | `MMCA.Common.API.Tests/Idempotency/IdempotencyFilterTests.cs:14` |
| `IdempotencySettingsTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Idempotency` | `MMCA.Common.API.Tests/Idempotency/IdempotencySettingsTests.cs:6` |
| `CurrencyJsonConverterTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.JsonConverters` | `MMCA.Common.API.Tests/JsonConverters/CurrencyJsonConverterTests.cs:9` |
| `EdgeErrorLocalizationTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Localization` | `MMCA.Common.API.Tests/Localization/EdgeErrorLocalizationTests.cs:16` |
| `ErrorLocalizerTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Localization` | `MMCA.Common.API.Tests/Localization/ErrorLocalizerTests.cs:14` |
| `StubErrorLocalizer` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Localization` | `MMCA.Common.API.Tests/Localization/EdgeErrorLocalizationTests.cs:18` |
| `TestController` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Localization` | `MMCA.Common.API.Tests/Localization/EdgeErrorLocalizationTests.cs:24` |
| `CorrelationIdMiddlewareTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Middleware` | `MMCA.Common.API.Tests/Middleware/CorrelationIdMiddlewareTests.cs:10` |
| `ExceptionHandlerTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Middleware` | `MMCA.Common.API.Tests/Middleware/ExceptionHandlerTests.cs:15` |
| `SoftDeletedUserMiddlewareTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Middleware` | `MMCA.Common.API.Tests/Middleware/SoftDeletedUserMiddlewareTests.cs:11` |
| `TestDomainException` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Middleware` | `MMCA.Common.API.Tests/Middleware/ExceptionHandlerTests.cs:315` |
| `UnhandledResultFailureFilterTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Middleware` | `MMCA.Common.API.Tests/Middleware/UnhandledResultFailureFilterTests.cs:13` |
| `QueryFilterModelBinderTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.ModelBinders` | `MMCA.Common.API.Tests/ModelBinders/QueryFilterModelBinderTests.cs:9` |
| `CookieSessionRefresherTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/CookieSessionRefresherTests.cs:21` |
| `CookieSessionRefreshMiddlewareTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/CookieSessionRefreshMiddlewareTests.cs:15` |
| `CookieTokenReaderTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/CookieTokenReaderTests.cs:14` |
| `NextDelegateSpy` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/CookieSessionRefreshMiddlewareTests.cs:144` |
| `RefresherHarness` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/CookieSessionRefresherTests.cs:203` |
| `SessionCookieAuthenticationHandlerTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/SessionCookieAuthenticationHandlerTests.cs:21` |
| `SessionCookieEndpointsTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/SessionCookieEndpointsTests.cs:20` |
| `SessionCookieJarTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/SessionCookieJarTests.cs:17` |
| `StubHttpClientFactory` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/CookieSessionRefresherTests.cs:228` |
| `StubHttpMessageHandler` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/CookieSessionRefresherTests.cs:234` |
| `StubRefresher` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.SessionCookies` | `MMCA.Common.API.Tests/SessionCookies/SessionCookieEndpointsTests.cs:145` |
| `AppAssociationEndpointTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/AppAssociationEndpointTests.cs:25` |
| `DatabaseInitializationExtensionsTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/DatabaseInitializationExtensionsTests.cs:29` |
| `FixedAssemblyProvider` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/DatabaseInitializationExtensionsTests.cs:94` |
| `InitTestWidget` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/DatabaseInitializationExtensionsTests.cs:100` |
| `InitTestWidgetConfiguration` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/DatabaseInitializationExtensionsTests.cs:106` |
| `JwksEndpointTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/JwksEndpointTests.cs:26` |
| `OidcDiscoveryEndpointTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/OidcDiscoveryEndpointTests.cs:20` |
| `RateLimitPartitionTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/RateLimitPartitionTests.cs:16` |
| `WebApplicationBuilderExtensionsTests` | class | MMCA.Common.API.Tests | `MMCA.Common.API.Tests.Startup` | `MMCA.Common.API.Tests/Startup/WebApplicationBuilderExtensionsTests.cs:14` |
| `AssemblyReference` | class | MMCA.Common.Application | `MMCA.Common.Application` | `MMCA.Common.Application/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.Common.Application | `MMCA.Common.Application` | `MMCA.Common.Application/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.Common.Application | `MMCA.Common.Application` | `MMCA.Common.Application/DependencyInjection.cs:21` |
| `AuthenticationServiceBase<TUser>` | class | MMCA.Common.Application | `MMCA.Common.Application.Auth` | `MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:34` |
| `AuthenticationValidators` | class | MMCA.Common.Application | `MMCA.Common.Application.Auth` | `MMCA.Common.Application/Auth/AuthenticationValidators.cs:16` |
| `IAuthenticationService` | interface | MMCA.Common.Application | `MMCA.Common.Application.Auth` | `MMCA.Common.Application/Auth/IAuthenticationService.cs:11` |
| `ILoginProtectionService` | interface | MMCA.Common.Application | `MMCA.Common.Application.Auth` | `MMCA.Common.Application/Auth/ILoginProtectionService.cs:10` |
| `LoginRequestValidator` | class | MMCA.Common.Application | `MMCA.Common.Application.Auth.Validation` | `MMCA.Common.Application/Auth/Validation/LoginRequestValidator.cs:11` |
| `RefreshTokenRequestValidator` | class | MMCA.Common.Application | `MMCA.Common.Application.Auth.Validation` | `MMCA.Common.Application/Auth/Validation/RefreshTokenRequestValidator.cs:10` |
| `SafeDomainEventHandler<TDomainEvent>` | class | MMCA.Common.Application | `MMCA.Common.Application.DomainEvents` | `MMCA.Common.Application/DomainEvents/SafeDomainEventHandler.cs:14` |
| `ReadRepositoryExtensions` | class | MMCA.Common.Application | `MMCA.Common.Application.Extensions` | `MMCA.Common.Application/Extensions/ReadRepositoryExtensions.cs:10` |
| `ValidationFailureExtensions` | class | MMCA.Common.Application | `MMCA.Common.Application.Extensions` | `MMCA.Common.Application/Extensions/ValidationFailureExtensions.cs:9` |
| `ICacheService` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/ICacheService.cs:8` |
| `ICorrelationContext` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/ICorrelationContext.cs:8` |
| `ICreateRequest` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/ICreateRequest.cs:8` |
| `IDomainEventDispatcher` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IDomainEventDispatcher.cs:8` |
| `IDomainEventHandler<in TDomainEvent>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IDomainEventHandler.cs:10` |
| `IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IEntityDTOMapper.cs:14` |
| `IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IEntityQueryService.cs:19` |
| `IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IEntityDTOMapper.cs:42` |
| `IEventBus` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IEventBus.cs:11` |
| `IIntegrationEventHandler<in TIntegrationEvent>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IIntegrationEventHandler.cs:15` |
| `IIntegrationEventPublisher` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/IIntegrationEventPublisher.cs:15` |
| `INavigationMetadata` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/INavigationMetadata.cs:34` |
| `INavigationPopulator<in TEntity>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/INavigationPopulator.cs:9` |
| `NavigationMetadata` | class | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/NavigationMetadata.cs:9` |
| `NavigationPropertyInfo` | record | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/INavigationMetadata.cs:23` |
| `NavigationType` | enum | MMCA.Common.Application | `MMCA.Common.Application.Interfaces` | `MMCA.Common.Application/Interfaces/INavigationMetadata.cs:6` |
| `DataSource` | enum | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IDataSourceService.cs:6` |
| `DataSourceKey` | record struct | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/DataSourceKey.cs:15` |
| `ICurrentUserService` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/ICurrentUserService.cs:9` |
| `IDataSourceService` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IDataSourceService.cs:24` |
| `IEmailSender` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IEmailSender.cs:6` |
| `IEntityConfigurationAssemblyProvider` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IEntityConfigurationAssemblyProvider.cs:10` |
| `IEntityQuerier<TEntity, TIdentifierType>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:64` |
| `IEntityReader<TEntity, TIdentifierType>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:14` |
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
| `IReadRepository<TEntity, TIdentifierType>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:110` |
| `IRepository<TEntity, TIdentifierType>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:202` |
| `ISoftDeletedUserValidator` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/ISoftDeletedUserValidator.cs:7` |
| `ITokenService` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/ITokenService.cs:8` |
| `IUnitOfWork` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IUnitOfWork.cs:10` |
| `IWriteRepository<TEntity, TIdentifierType>` | interface | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:133` |
| `NullNotificationRecipientProvider` | class | MMCA.Common.Application | `MMCA.Common.Application.Interfaces.Infrastructure` | `MMCA.Common.Application/Interfaces/Infrastructure/NullNotificationRecipientProvider.cs:8` |
| `IMessageBus` | interface | MMCA.Common.Application | `MMCA.Common.Application.Messaging` | `MMCA.Common.Application/Messaging/IMessageBus.cs:28` |
| `IModule` | interface | MMCA.Common.Application | `MMCA.Common.Application.Modules` | `MMCA.Common.Application/Modules/IModule.cs:7` |
| `IModuleSeeder` | interface | MMCA.Common.Application | `MMCA.Common.Application.Modules` | `MMCA.Common.Application/Modules/IModuleSeeder.cs:8` |
| `ModuleLoader` | class | MMCA.Common.Application | `MMCA.Common.Application.Modules` | `MMCA.Common.Application/Modules/ModuleLoader.cs:15` |
| `DependencyInjection` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications` | `MMCA.Common.Application/Notifications/DependencyInjection.cs:27` |
| `PushNotificationDTOMapper` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications.PushNotifications.DTOs` | `MMCA.Common.Application/Notifications/PushNotifications/DTOs/PushNotificationDTOMapper.cs:12` |
| `GetNotificationHistoryHandler` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications.PushNotifications.UseCases.GetHistory` | `MMCA.Common.Application/Notifications/PushNotifications/UseCases/GetHistory/GetNotificationHistoryHandler.cs:15` |
| `GetNotificationHistoryQuery` | record | MMCA.Common.Application | `MMCA.Common.Application.Notifications.PushNotifications.UseCases.GetHistory` | `MMCA.Common.Application/Notifications/PushNotifications/UseCases/GetHistory/GetNotificationHistoryQuery.cs:6` |
| `SendPushNotificationCommand` | record | MMCA.Common.Application | `MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send` | `MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationCommand.cs:11` |
| `SendPushNotificationHandler` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send` | `MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationHandler.cs:17` |
| `SendPushNotificationRequestValidator` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications.PushNotifications.UseCases.Send` | `MMCA.Common.Application/Notifications/PushNotifications/UseCases/Send/SendPushNotificationRequestValidator.cs:10` |
| `GetMyNotificationsHandler` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetInbox` | `MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetInbox/GetMyNotificationsHandler.cs:16` |
| `GetMyNotificationsQuery` | record | MMCA.Common.Application | `MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetInbox` | `MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetInbox/GetMyNotificationsQuery.cs:7` |
| `GetUnreadNotificationCountHandler` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetUnreadCount` | `MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetUnreadCount/GetUnreadNotificationCountHandler.cs:12` |
| `GetUnreadNotificationCountQuery` | record | MMCA.Common.Application | `MMCA.Common.Application.Notifications.UserNotifications.UseCases.GetUnreadCount` | `MMCA.Common.Application/Notifications/UserNotifications/UseCases/GetUnreadCount/GetUnreadNotificationCountQuery.cs:5` |
| `MarkAllNotificationsReadCommand` | record | MMCA.Common.Application | `MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkAllRead` | `MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkAllRead/MarkAllNotificationsReadCommand.cs:5` |
| `MarkAllNotificationsReadHandler` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkAllRead` | `MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkAllRead/MarkAllNotificationsReadHandler.cs:11` |
| `MarkNotificationReadCommand` | record | MMCA.Common.Application | `MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkRead` | `MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkRead/MarkNotificationReadCommand.cs:6` |
| `MarkNotificationReadHandler` | class | MMCA.Common.Application | `MMCA.Common.Application.Notifications.UserNotifications.UseCases.MarkRead` | `MMCA.Common.Application/Notifications/UserNotifications/UseCases/MarkRead/MarkNotificationReadHandler.cs:12` |
| `DomainEventDispatcher` | class | MMCA.Common.Application | `MMCA.Common.Application.Services` | `MMCA.Common.Application/Services/DomainEventDispatcher.cs:16` |
| `EntityQueryService<TEntity, TEntityDTO, TIdentifierType>` | class | MMCA.Common.Application | `MMCA.Common.Application.Services` | `MMCA.Common.Application/Services/EntityQueryService.cs:28` |
| `NavigationLoader` | class | MMCA.Common.Application | `MMCA.Common.Application.Services` | `MMCA.Common.Application/Services/NavigationLoader.cs:21` |
| `NullNavigationPopulator<TEntity>` | class | MMCA.Common.Application | `MMCA.Common.Application.Services` | `MMCA.Common.Application/Services/NullNavigationPopulator.cs:11` |
| `PropertyAccessor` | record struct | MMCA.Common.Application | `MMCA.Common.Application.Services` | `MMCA.Common.Application/Services/QueryFieldService.cs:23` |
| `QueryFieldService` | class | MMCA.Common.Application | `MMCA.Common.Application.Services` | `MMCA.Common.Application/Services/QueryFieldService.cs:16` |
| `BoolFilterStrategy` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Filtering` | `MMCA.Common.Application/Services/Filtering/BoolFilterStrategy.cs:11` |
| `DateTimeFilterStrategy` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Filtering` | `MMCA.Common.Application/Services/Filtering/DateTimeFilterStrategy.cs:13` |
| `DecimalFilterStrategy` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Filtering` | `MMCA.Common.Application/Services/Filtering/DecimalFilterStrategy.cs:12` |
| `GuidFilterStrategy` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Filtering` | `MMCA.Common.Application/Services/Filtering/GuidFilterStrategy.cs:11` |
| `IFilterStrategy` | interface | MMCA.Common.Application | `MMCA.Common.Application.Services.Filtering` | `MMCA.Common.Application/Services/Filtering/IFilterStrategy.cs:6` |
| `IntFilterStrategy` | class | MMCA.Common.Application | `MMCA.Common.Application.Services.Filtering` | `MMCA.Common.Application/Services/Filtering/IntFilterStrategy.cs:11` |
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
| `ApplicationSettings` | class | MMCA.Common.Application | `MMCA.Common.Application.Settings` | `MMCA.Common.Application/Settings/ApplicationSettings.cs:6` |
| `IApplicationSettings` | interface | MMCA.Common.Application | `MMCA.Common.Application.Settings` | `MMCA.Common.Application/Settings/IApplicationSettings.cs:7` |
| `ModuleSettings` | class | MMCA.Common.Application | `MMCA.Common.Application.Settings` | `MMCA.Common.Application/Settings/ModuleSettings.cs:6` |
| `ModulesSettings` | class | MMCA.Common.Application | `MMCA.Common.Application.Settings` | `MMCA.Common.Application/Settings/ModulesSettings.cs:7` |
| `CrossSourceSpecification` | class | MMCA.Common.Application | `MMCA.Common.Application.Specifications` | `MMCA.Common.Application/Specifications/CrossSourceSpecification.cs:22` |
| `ParameterReplacer` | class | MMCA.Common.Application | `MMCA.Common.Application.Specifications` | `MMCA.Common.Application/Specifications/CrossSourceSpecification.cs:93` |
| `DeleteEntityCommand<TEntity, TIdentifierType>` | record | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/DeleteEntityCommand.cs:12` |
| `DeleteEntityHandler<TEntity, TIdentifierType>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/DeleteEntityHandler.cs:14` |
| `ICacheInvalidating` | interface | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/ICacheInvalidating.cs:8` |
| `ICommandHandler<in TCommand, TResult>` | interface | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/ICommandHandler.cs:9` |
| `ICommandWithRequest<out TRequest>` | interface | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/ICommandWithRequest.cs:14` |
| `IFeatureGated` | interface | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/IFeatureGated.cs:10` |
| `IQueryCacheable` | interface | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/IQueryCacheable.cs:8` |
| `IQueryHandler<in TQuery, TResult>` | interface | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/IQueryHandler.cs:9` |
| `ITransactional` | interface | MMCA.Common.Application | `MMCA.Common.Application.UseCases` | `MMCA.Common.Application/UseCases/ITransactional.cs:6` |
| `CachingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/CachingCommandDecorator.cs:16` |
| `CachingQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:16` |
| `CqrsMetrics` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/CqrsMetrics.cs:12` |
| `FeatureGateCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/FeatureGateCommandDecorator.cs:18` |
| `FeatureGateQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/FeatureGateQueryDecorator.cs:18` |
| `LoggingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/LoggingCommandDecorator.cs:14` |
| `LoggingQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/LoggingQueryDecorator.cs:13` |
| `ProfilingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/ProfilingCommandDecorator.cs:11` |
| `ProfilingQueryDecorator<TQuery, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/ProfilingQueryDecorator.cs:11` |
| `QueryCacheKeyLocks` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:71` |
| `ResultFailureFactory` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/ResultFailureFactory.cs:11` |
| `TransactionalCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/TransactionalCommandDecorator.cs:18` |
| `ValidatingCommandDecorator<TCommand, TResult>` | class | MMCA.Common.Application | `MMCA.Common.Application.UseCases.Decorators` | `MMCA.Common.Application/UseCases/Decorators/ValidatingCommandDecorator.cs:24` |
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
| `TestDomainEventHandlerForIntegration` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherAdditionalTests.cs:27` |
| `TestEvent` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherTests.cs:13` |
| `TestEventHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherTests.cs:17` |
| `TestIntegrationEvent` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherAdditionalTests.cs:14` |
| `TestIntegrationEvent` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherTests.cs:15` |
| `TestIntegrationEventDomainHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherTests.cs:28` |
| `TestIntegrationEventHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherAdditionalTests.cs:16` |
| `TestIntegrationEventHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests` | `MMCA.Common.Application.Tests/DomainEventDispatcherTests.cs:39` |
| `AuthenticationServiceBaseTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth` | `MMCA.Common.Application.Tests/Auth/AuthenticationServiceBaseTests.cs:22` |
| `AuthenticationValidatorsTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth` | `MMCA.Common.Application.Tests/Auth/AuthenticationValidatorsTests.cs:14` |
| `FixedTimeProvider` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth` | `MMCA.Common.Application.Tests/Auth/AuthenticationServiceBaseTests.cs:526` |
| `ServiceMocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth` | `MMCA.Common.Application.Tests/Auth/AuthenticationServiceBaseTests.cs:468` |
| `TestAuthenticationService` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth` | `MMCA.Common.Application.Tests/Auth/AuthenticationServiceBaseTests.cs:571` |
| `TestAuthUser` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth` | `MMCA.Common.Application.Tests/Auth/AuthenticationServiceBaseTests.cs:536` |
| `LoginRequestValidatorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth.Validation` | `MMCA.Common.Application.Tests/Auth/Validation/LoginRequestValidatorTests.cs:8` |
| `RefreshTokenRequestValidatorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Auth.Validation` | `MMCA.Common.Application.Tests/Auth/Validation/RefreshTokenRequestValidatorTests.cs:8` |
| `CacheableTestQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingQueryDecoratorTests.cs:133` |
| `CacheInvalidatingTestCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingCommandDecoratorTests.cs:72` |
| `CachePipelineTestCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CommandDecoratorPipelineTests.cs:359` |
| `CachingCommandDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingCommandDecoratorTests.cs:10` |
| `CachingQueryDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingQueryDecoratorTests.cs:10` |
| `CapturedMeasurement` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CqrsMetricsTests.cs:27` |
| `CommandDecoratorPipelineTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CommandDecoratorPipelineTests.cs:16` |
| `CqrsMetricsProbeCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CqrsMetricsTests.cs:221` |
| `CqrsMetricsProbeQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CqrsMetricsTests.cs:223` |
| `CqrsMetricsTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CqrsMetricsTests.cs:20` |
| `FeatureGateCommandDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/FeatureGateCommandDecoratorTests.cs:10` |
| `FeatureGatedCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/FeatureGateCommandDecoratorTests.cs:111` |
| `FeatureGatedCommandWithValue` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/FeatureGateCommandDecoratorTests.cs:116` |
| `FeatureGatedQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/FeatureGateQueryDecoratorTests.cs:92` |
| `FeatureGatedQueryNonGeneric` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/FeatureGateQueryDecoratorTests.cs:97` |
| `FeatureGateQueryDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/FeatureGateQueryDecoratorTests.cs:10` |
| `FullPipelineTestCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CommandDecoratorPipelineTests.cs:368` |
| `LoggingCommandDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/LoggingCommandDecoratorTests.cs:11` |
| `LoggingQueryDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/LoggingQueryDecoratorTests.cs:11` |
| `Mocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/LoggingCommandDecoratorTests.cs:14` |
| `Mocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/LoggingQueryDecoratorTests.cs:14` |
| `NonCacheableTestQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingQueryDecoratorTests.cs:131` |
| `NonTransactionalCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/TransactionalCommandDecoratorTests.cs:85` |
| `PipelineTestCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CommandDecoratorPipelineTests.cs:356` |
| `PlainCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/FeatureGateCommandDecoratorTests.cs:109` |
| `PlainQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/FeatureGateQueryDecoratorTests.cs:90` |
| `PlainTestCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingCommandDecoratorTests.cs:70` |
| `ProfilingCommandDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/ProfilingCommandDecoratorTests.cs:9` |
| `ProfilingQueryDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/ProfilingQueryDecoratorTests.cs:9` |
| `ProfilingTestCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/ProfilingCommandDecoratorTests.cs:58` |
| `ProfilingTestQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/ProfilingQueryDecoratorTests.cs:59` |
| `ResultFailureFactoryTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/ResultFailureFactoryTests.cs:15` |
| `StampedeTestQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CachingQueryDecoratorTests.cs:139` |
| `TestLoggingCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/LoggingCommandDecoratorTests.cs:95` |
| `TestLoggingQuery` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/LoggingQueryDecoratorTests.cs:81` |
| `TestValidatingCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/ValidatingCommandDecoratorTests.cs:138` |
| `TransactionalCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/TransactionalCommandDecoratorTests.cs:87` |
| `TransactionalCommandDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/TransactionalCommandDecoratorTests.cs:10` |
| `TransactionalPipelineTestCommand` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/CommandDecoratorPipelineTests.cs:365` |
| `ValidatingCommandDecoratorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Decorators` | `MMCA.Common.Application.Tests/Decorators/ValidatingCommandDecoratorTests.cs:12` |
| `SafeDomainEventHandlerTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.DomainEvents` | `MMCA.Common.Application.Tests/DomainEvents/SafeDomainEventHandlerTests.cs:9` |
| `TestSafeDomainEvent` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.DomainEvents` | `MMCA.Common.Application.Tests/DomainEvents/SafeDomainEventHandlerTests.cs:61` |
| `TestSafeDomainEventHandler` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.DomainEvents` | `MMCA.Common.Application.Tests/DomainEvents/SafeDomainEventHandlerTests.cs:63` |
| `ReadRepositoryExtensionsTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Extensions` | `MMCA.Common.Application.Tests/Extensions/ReadRepositoryExtensionsTests.cs:11` |
| `TestReadEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Extensions` | `MMCA.Common.Application.Tests/Extensions/ReadRepositoryExtensionsTests.cs:64` |
| `ValidationFailureExtensionsTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Extensions` | `MMCA.Common.Application.Tests/Extensions/ValidationFailureExtensionsTests.cs:8` |
| `ModuleLoaderTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Modules` | `MMCA.Common.Application.Tests/Modules/ModuleLoaderTests.cs:11` |
| `FixedTimeProvider` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/MarkAllNotificationsReadHandlerTests.cs:65` |
| `FixedTimeProvider` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/MarkNotificationReadHandlerTests.cs:67` |
| `GetMyNotificationsHandlerTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/GetMyNotificationsHandlerTests.cs:14` |
| `GetNotificationHistoryHandlerTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/GetNotificationHistoryHandlerTests.cs:14` |
| `GetUnreadNotificationCountHandlerTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/GetUnreadNotificationCountHandlerTests.cs:10` |
| `HandlerMocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/GetUnreadNotificationCountHandlerTests.cs:51` |
| `HandlerMocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/MarkAllNotificationsReadHandlerTests.cs:70` |
| `HandlerMocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/MarkNotificationReadHandlerTests.cs:72` |
| `HandlerMocks` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/SendPushNotificationHandlerTests.cs:150` |
| `MarkAllNotificationsReadHandlerTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/MarkAllNotificationsReadHandlerTests.cs:10` |
| `MarkNotificationReadHandlerTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/MarkNotificationReadHandlerTests.cs:10` |
| `NotificationDependencyInjectionTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/NotificationDependencyInjectionTests.cs:22` |
| `PushNotificationDTOMapperTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/PushNotificationDTOMapperTests.cs:9` |
| `SendPushNotificationHandlerTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/SendPushNotificationHandlerTests.cs:14` |
| `SendPushNotificationRequestValidatorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Notifications` | `MMCA.Common.Application.Tests/Notifications/SendPushNotificationRequestValidatorTests.cs:9` |
| `ChildA` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:64` |
| `ChildB` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:66` |
| `ChildC` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:68` |
| `ChildD` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:70` |
| `ChildNavigationDescriptorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/ChildNavigationDescriptorTests.cs:9` |
| `DeclarativeNavigationPopulatorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/DeclarativeNavigationPopulatorTests.cs:10` |
| `EntityQueryParametersTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryParametersTests.cs:12` |
| `EntityQueryPipelineTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryPipelineTests.cs:11` |
| `EntityQueryServiceTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceTests.cs:12` |
| `FakeEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceTests.cs:14` |
| `FakeEntityDTO` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceTests.cs:19` |
| `FKNavigationDescriptorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/FKNavigationDescriptorTests.cs:9` |
| `MixedEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:38` |
| `NavigationLoaderTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationLoaderTests.cs:10` |
| `NavigationMetadataProviderTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:11` |
| `NavigationPopulatorStubEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/DeclarativeNavigationPopulatorTests.cs:200` |
| `NoNavEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:47` |
| `NullNavigationPopulatorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NullNavigationPopulatorTests.cs:8` |
| `OrderEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/ChildNavigationDescriptorTests.cs:11` |
| `OrderLineEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/ChildNavigationDescriptorTests.cs:16` |
| `ParentEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/FKNavigationDescriptorTests.cs:11` |
| `ProductDto` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/QueryFieldServiceTests.cs:9` |
| `QueryFieldServiceTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/QueryFieldServiceTests.cs:7` |
| `ReadOnlyCollectionEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:52` |
| `RelatedA` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:58` |
| `RelatedB` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:60` |
| `RelatedC` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:62` |
| `RelatedEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/FKNavigationDescriptorTests.cs:16` |
| `StubChild` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationLoaderTests.cs:204` |
| `StubEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NullNavigationPopulatorTests.cs:10` |
| `StubParent` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationLoaderTests.cs:199` |
| `SupportedChild` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:26` |
| `SupportedFK` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:14` |
| `TestableEntityQueryService` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryServiceTests.cs:158` |
| `TestEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryParametersTests.cs:14` |
| `TestEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/EntityQueryPipelineTests.cs:20` |
| `UnsupportedChild` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:32` |
| `UnsupportedFK` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services` | `MMCA.Common.Application.Tests/Services/NavigationMetadataProviderTests.cs:20` |
| `BoolFilterStrategyTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/BoolFilterStrategyTests.cs:6` |
| `DateTimeFilterStrategyTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/DateTimeFilterStrategyTests.cs:6` |
| `DecimalFilterStrategyTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/DecimalFilterStrategyTests.cs:6` |
| `GuidFilterStrategyTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/GuidFilterStrategyTests.cs:6` |
| `IntFilterStrategyTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/IntFilterStrategyTests.cs:6` |
| `Item` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/BoolFilterStrategyTests.cs:8` |
| `Item` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/DateTimeFilterStrategyTests.cs:8` |
| `Item` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/DecimalFilterStrategyTests.cs:8` |
| `Item` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/GuidFilterStrategyTests.cs:8` |
| `Item` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/IntFilterStrategyTests.cs:8` |
| `Item` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/StringFilterStrategyTests.cs:8` |
| `Product` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/QueryFilterServiceTests.cs:8` |
| `Product` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/QueryFilterServiceValidateTests.cs:9` |
| `QueryFilterServiceTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/QueryFilterServiceTests.cs:6` |
| `QueryFilterServiceValidateTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/QueryFilterServiceValidateTests.cs:6` |
| `StringFilterStrategyTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/StringFilterStrategyTests.cs:6` |
| `TestStrategy` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Services.Filtering` | `MMCA.Common.Application.Tests/Services/Filtering/QueryFilterServiceTests.cs:212` |
| `ApplicationSettingsTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Settings` | `MMCA.Common.Application.Tests/Settings/ApplicationSettingsTests.cs:6` |
| `ModulesSettingsTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Settings` | `MMCA.Common.Application.Tests/Settings/ModulesSettingsTests.cs:6` |
| `CrossSourceSpecificationTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Specifications` | `MMCA.Common.Application.Tests/Specifications/CrossSourceSpecificationTests.cs:10` |
| `Dependent` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Specifications` | `MMCA.Common.Application.Tests/Specifications/CrossSourceSpecificationTests.cs:12` |
| `Principal` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Specifications` | `MMCA.Common.Application.Tests/Specifications/CrossSourceSpecificationTests.cs:19` |
| `DeleteEntityHandlerTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.UseCases` | `MMCA.Common.Application.Tests/UseCases/DeleteEntityHandlerTests.cs:10` |
| `TestAggregateEntity` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.UseCases` | `MMCA.Common.Application.Tests/UseCases/DeleteEntityHandlerTests.cs:83` |
| `AddressValidationRulesTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/AddressValidationRulesTests.cs:9` |
| `CommandRequestValidatorTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommandRequestValidatorTests.cs:9` |
| `CommonValidationRulesTests` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommonValidationRulesTests.cs:7` |
| `PermissiveTestRequestValidator` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommandRequestValidatorTests.cs:82` |
| `TestAddressModel` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/AddressValidationRulesTests.cs:156` |
| `TestCommandWithRequest` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommandRequestValidatorTests.cs:72` |
| `TestDecimalModel` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommonValidationRulesTests.cs:336` |
| `TestIntModel` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommonValidationRulesTests.cs:331` |
| `TestOptionalStringModel` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommonValidationRulesTests.cs:326` |
| `TestRequest` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommandRequestValidatorTests.cs:70` |
| `TestRequestValidator` | class | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommandRequestValidatorTests.cs:74` |
| `TestStringModel` | record | MMCA.Common.Application.Tests | `MMCA.Common.Application.Tests.Validation` | `MMCA.Common.Application.Tests/Validation/CommonValidationRulesTests.cs:321` |
| `AggregateConventionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/AggregateConventionTests.cs:9` |
| `CommonArchitectureMap` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/CommonArchitectureMap.cs:15` |
| `DataSubjectSample` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/PiiErasureContractFitnessTests.cs:79` |
| `DependencyVersionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/DependencyVersionTests.cs:9` |
| `DomainPurityTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/DomainPurityTests.cs:9` |
| `EventVersioningConventionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/EventVersioningConventionTests.cs:10` |
| `FitnessDependent` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:36` |
| `FitnessPrincipal` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:45` |
| `FrameworkSanityTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/FrameworkSanityTests.cs:13` |
| `LayerDependencyTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/LayerDependencyTests.cs:9` |
| `LocalizationResourceTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/LocalizationResourceTests.cs:12` |
| `LocalizedTextConventionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/LocalizedTextConventionTests.cs:11` |
| `MicroserviceExtractionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/MicroserviceExtractionTests.cs:10` |
| `NavigatingSpec` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:51` |
| `PiiConventionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/PiiConventionTests.cs:13` |
| `PiiErasureContractFitnessTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/PiiErasureContractFitnessTests.cs:19` |
| `ScalarOnlySpec` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:57` |
| `SliceCohesionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/SliceCohesionTests.cs:10` |
| `SpecificationFitnessTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:15` |
| `SpecTestMap` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/SpecificationFitnessTests.cs:28` |
| `StateManagementConventionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/StateManagementConventionTests.cs:11` |
| `UIArchitectureConventionTests` | class | MMCA.Common.Architecture.Tests | `MMCA.Common.Architecture.Tests` | `MMCA.Common.Architecture.Tests/UIArchitectureConventionTests.cs:11` |
| `Extensions` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire` | `MMCA.Common.Aspire/Extensions.cs:23` |
| `GatewayCorsExtensions` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire` | `MMCA.Common.Aspire/GatewayCorsExtensions.cs:16` |
| `CspPolicy` | record | MMCA.Common.Aspire | `MMCA.Common.Aspire.Security` | `MMCA.Common.Aspire/Security/SecurityHeaders.cs:56` |
| `ICspPolicyProvider` | interface | MMCA.Common.Aspire | `MMCA.Common.Aspire.Security` | `MMCA.Common.Aspire/Security/SecurityHeaders.cs:64` |
| `SecurityHeadersExtensions` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Security` | `MMCA.Common.Aspire/Security/SecurityHeaders.cs:149` |
| `SecurityHeadersMiddleware` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Security` | `MMCA.Common.Aspire/Security/SecurityHeaders.cs:93` |
| `SecurityHeadersSettings` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Security` | `MMCA.Common.Aspire/Security/SecurityHeaders.cs:17` |
| `StaticCspPolicyProvider` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Security` | `MMCA.Common.Aspire/Security/SecurityHeaders.cs:71` |
| `OutboxPollFilterProcessor` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Telemetry` | `MMCA.Common.Aspire/Telemetry/OutboxPollFilterProcessor.cs:15` |
| `IWarmupTask` | interface | MMCA.Common.Aspire | `MMCA.Common.Aspire.Warmup` | `MMCA.Common.Aspire/Warmup/IWarmupTask.cs:9` |
| `OpenIdConnectMetadataWarmupTask` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Warmup` | `MMCA.Common.Aspire/Warmup/OpenIdConnectMetadataWarmupTask.cs:21` |
| `WarmupHostedService` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Warmup` | `MMCA.Common.Aspire/Warmup/WarmupHostedService.cs:14` |
| `WarmupReadinessGate` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Warmup` | `MMCA.Common.Aspire/Warmup/WarmupReadinessGate.cs:10` |
| `WarmupReadinessHealthCheck` | class | MMCA.Common.Aspire | `MMCA.Common.Aspire.Warmup` | `MMCA.Common.Aspire/Warmup/WarmupReadinessHealthCheck.cs:9` |
| `Extensions` | class | MMCA.Common.Aspire.Hosting | `MMCA.Common.Aspire.Hosting` | `MMCA.Common.Aspire.Hosting/Extensions.cs:17` |
| `SecurityHeadersMiddlewareTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Security` | `MMCA.Common.Aspire.Tests/Security/SecurityHeadersMiddlewareTests.cs:16` |
| `StubCspProvider` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Security` | `MMCA.Common.Aspire.Tests/Security/SecurityHeadersMiddlewareTests.cs:102` |
| `StubWebHostEnvironment` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Security` | `MMCA.Common.Aspire.Tests/Security/SecurityHeadersMiddlewareTests.cs:107` |
| `OutboxPollFilterProcessorTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Telemetry` | `MMCA.Common.Aspire.Tests/Telemetry/OutboxPollFilterProcessorTests.cs:12` |
| `TracesSampleRatioTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Telemetry` | `MMCA.Common.Aspire.Tests/Telemetry/TracesSampleRatioTests.cs:12` |
| `RecordingTask` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Warmup` | `MMCA.Common.Aspire.Tests/Warmup/WarmupHostedServiceTests.cs:14` |
| `ThrowingTask` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Warmup` | `MMCA.Common.Aspire.Tests/Warmup/WarmupHostedServiceTests.cs:27` |
| `WarmupHostedServiceTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Warmup` | `MMCA.Common.Aspire.Tests/Warmup/WarmupHostedServiceTests.cs:12` |
| `WarmupReadinessGateTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Warmup` | `MMCA.Common.Aspire.Tests/Warmup/WarmupReadinessGateTests.cs:10` |
| `WarmupReadinessHealthCheckTests` | class | MMCA.Common.Aspire.Tests | `MMCA.Common.Aspire.Tests.Warmup` | `MMCA.Common.Aspire.Tests/Warmup/WarmupReadinessHealthCheckTests.cs:11` |
| `ActiveSpec` | class | MMCA.Common.Benchmarks | `MMCA.Common.Benchmarks` | `MMCA.Common.Benchmarks/SpecificationBenchmarks.cs:28` |
| `MinValueSpec` | class | MMCA.Common.Benchmarks | `MMCA.Common.Benchmarks` | `MMCA.Common.Benchmarks/SpecificationBenchmarks.cs:23` |
| `SampleItem` | class | MMCA.Common.Benchmarks | `MMCA.Common.Benchmarks` | `MMCA.Common.Benchmarks/SpecificationBenchmarks.cs:16` |
| `SpecificationBenchmarks` | class | MMCA.Common.Benchmarks | `MMCA.Common.Benchmarks` | `MMCA.Common.Benchmarks/SpecificationBenchmarks.cs:14` |
| `AssemblyReference` | class | MMCA.Common.Domain | `MMCA.Common.Domain` | `MMCA.Common.Domain/AssemblyReference.cs:8` |
| `ClassReference` | class | MMCA.Common.Domain | `MMCA.Common.Domain` | `MMCA.Common.Domain/AssemblyReference.cs:18` |
| `IdValueGeneratedAttribute` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Attributes` | `MMCA.Common.Domain/Attributes/IdValueGeneratedAttribute.cs:9` |
| `NavigationAttribute` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Attributes` | `MMCA.Common.Domain/Attributes/NavigationAttribute.cs:10` |
| `PiiAttribute` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Attributes` | `MMCA.Common.Domain/Attributes/PiiAttribute.cs:19` |
| `IAuthUser` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Auth` | `MMCA.Common.Domain/Auth/IAuthUser.cs:10` |
| `BaseDomainEvent` | record | MMCA.Common.Domain | `MMCA.Common.Domain.DomainEvents` | `MMCA.Common.Domain/DomainEvents/BaseDomainEvent.cs:18` |
| `BaseIntegrationEvent` | record | MMCA.Common.Domain | `MMCA.Common.Domain.DomainEvents` | `MMCA.Common.Domain/DomainEvents/BaseIntegrationEvent.cs:11` |
| `EntityChangedEvent<TIdentifierType>` | record | MMCA.Common.Domain | `MMCA.Common.Domain.DomainEvents` | `MMCA.Common.Domain/DomainEvents/EntityChangedEvent.cs:24` |
| `AuditableAggregateRootEntity<TIdentifierType>` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Entities` | `MMCA.Common.Domain/Entities/AuditableAggregateRootEntity.cs:13` |
| `AuditableBaseEntity<TIdentifierType>` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Entities` | `MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:13` |
| `BaseEntity<TIdentifierType>` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Entities` | `MMCA.Common.Domain/Entities/BaseEntity.cs:14` |
| `DomainEntityState` | enum | MMCA.Common.Domain | `MMCA.Common.Domain.Enums` | `MMCA.Common.Domain/Enums/DomainEntityState.cs:7` |
| `EntityTypeExtensions` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Extensions` | `MMCA.Common.Domain/Extensions/EntityTypeExtensions.cs:9` |
| `IAggregateRoot` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Interfaces` | `MMCA.Common.Domain/Interfaces/IAggregateRoot.cs:9` |
| `IAnonymizable` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Interfaces` | `MMCA.Common.Domain/Interfaces/IAnonymizable.cs:22` |
| `IAuditableEntity` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Interfaces` | `MMCA.Common.Domain/Interfaces/IAuditableEntity.cs:8` |
| `IBaseEntity<TIdentifierType>` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Interfaces` | `MMCA.Common.Domain/Interfaces/IBaseEntity.cs:7` |
| `IDomainEvent` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Interfaces` | `MMCA.Common.Domain/Interfaces/IDomainEvent.cs:7` |
| `IIntegrationEvent` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Interfaces` | `MMCA.Common.Domain/Interfaces/IIntegrationEvent.cs:15` |
| `ISpecification<TEntity, TIdentifierType>` | interface | MMCA.Common.Domain | `MMCA.Common.Domain.Interfaces` | `MMCA.Common.Domain/Interfaces/ISpecification.cs:12` |
| `CommonInvariants` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Invariants` | `MMCA.Common.Domain/Invariants/CommonInvariants.cs:10` |
| `PushNotification` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Notifications.PushNotifications` | `MMCA.Common.Domain/Notifications/PushNotifications/PushNotification.cs:14` |
| `PushNotificationStatus` | enum | MMCA.Common.Domain | `MMCA.Common.Domain.Notifications.PushNotifications` | `MMCA.Common.Domain/Notifications/PushNotifications/PushNotificationStatus.cs:6` |
| `PushNotificationCreated` | record | MMCA.Common.Domain | `MMCA.Common.Domain.Notifications.PushNotifications.DomainEvents` | `MMCA.Common.Domain/Notifications/PushNotifications/DomainEvents/PushNotificationCreated.cs:11` |
| `PushNotificationInvariants` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Notifications.PushNotifications.Invariants` | `MMCA.Common.Domain/Notifications/PushNotifications/Invariants/PushNotificationInvariants.cs:9` |
| `UserNotification` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Notifications.UserNotifications` | `MMCA.Common.Domain/Notifications/UserNotifications/UserNotification.cs:12` |
| `PiiRedactor` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Privacy` | `MMCA.Common.Domain/Privacy/PiiRedactor.cs:24` |
| `RedactableProperty` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Privacy` | `MMCA.Common.Domain/Privacy/PiiRedactor.cs:123` |
| `AndSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Specifications` | `MMCA.Common.Domain/Specifications/Specification.cs:62` |
| `InlineSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Specifications` | `MMCA.Common.Domain/Specifications/Specification.cs:45` |
| `NotSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Specifications` | `MMCA.Common.Domain/Specifications/Specification.cs:114` |
| `OrSpecification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Specifications` | `MMCA.Common.Domain/Specifications/Specification.cs:88` |
| `Specification<TEntity, TIdentifierType>` | class | MMCA.Common.Domain | `MMCA.Common.Domain.Specifications` | `MMCA.Common.Domain/Specifications/Specification.cs:15` |
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
| `CommonInvariantsTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Invariants` | `MMCA.Common.Domain.Tests/Invariants/CommonInvariantsTests.cs:7` |
| `PushNotificationCreatedTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Notifications` | `MMCA.Common.Domain.Tests/Notifications/PushNotificationCreatedTests.cs:8` |
| `PushNotificationInvariantsTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Notifications` | `MMCA.Common.Domain.Tests/Notifications/PushNotificationInvariantsTests.cs:7` |
| `PushNotificationTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Notifications` | `MMCA.Common.Domain.Tests/Notifications/PushNotificationTests.cs:7` |
| `UserNotificationTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Notifications` | `MMCA.Common.Domain.Tests/Notifications/UserNotificationTests.cs:6` |
| `NoPii` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Privacy` | `MMCA.Common.Domain.Tests/Privacy/PiiRedactorTests.cs:27` |
| `PiiRedactorTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Privacy` | `MMCA.Common.Domain.Tests/Privacy/PiiRedactorTests.cs:12` |
| `Subject` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Privacy` | `MMCA.Common.Domain.Tests/Privacy/PiiRedactorTests.cs:14` |
| `AgeGreaterThanSpec` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationTests.cs:22` |
| `AgeRangeSpec` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationAdditionalTests.cs:22` |
| `NameEqualsSpec` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationAdditionalTests.cs:16` |
| `NameStartsWithSpec` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationTests.cs:16` |
| `SpecificationAdditionalTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationAdditionalTests.cs:8` |
| `SpecificationTests` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationTests.cs:8` |
| `TestEntity` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationAdditionalTests.cs:10` |
| `TestEntity` | class | MMCA.Common.Domain.Tests | `MMCA.Common.Domain.Tests.Specifications` | `MMCA.Common.Domain.Tests/Specifications/SpecificationTests.cs:10` |
| `DependencyInjection` | class | MMCA.Common.Grpc | `MMCA.Common.Grpc` | `MMCA.Common.Grpc/DependencyInjection.cs:16` |
| `ResultGrpcExtensions` | class | MMCA.Common.Grpc | `MMCA.Common.Grpc` | `MMCA.Common.Grpc/ResultGrpcExtensions.cs:22` |
| `ResultFailureException` | class | MMCA.Common.Grpc | `MMCA.Common.Grpc.Exceptions` | `MMCA.Common.Grpc/Exceptions/ResultFailureException.cs:16` |
| `GrpcResultExceptionInterceptor` | class | MMCA.Common.Grpc | `MMCA.Common.Grpc.Interceptors` | `MMCA.Common.Grpc/Interceptors/GrpcResultExceptionInterceptor.cs:19` |
| `JwtForwardingClientInterceptor` | class | MMCA.Common.Grpc | `MMCA.Common.Grpc.Interceptors` | `MMCA.Common.Grpc/Interceptors/JwtForwardingClientInterceptor.cs:19` |
| `CountingFailureHandler` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/ResilienceCircuitBreakerFaultInjectionTests.cs:64` |
| `DependencyInjectionTests` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/DependencyInjectionTests.cs:20` |
| `FakeClient` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/DependencyInjectionTests.cs:22` |
| `FakeGrpcClient` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/ResilienceHandlerTests.cs:18` |
| `FakeRequest` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/JwtForwardingClientInterceptorTests.cs:280` |
| `FakeResponse` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/JwtForwardingClientInterceptorTests.cs:282` |
| `FakeStreamReader` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/JwtForwardingClientInterceptorTests.cs:284` |
| `FakeStreamWriter` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/JwtForwardingClientInterceptorTests.cs:291` |
| `JwtForwardingClientInterceptorTests` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/JwtForwardingClientInterceptorTests.cs:19` |
| `ResilienceCircuitBreakerFaultInjectionTests` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/ResilienceCircuitBreakerFaultInjectionTests.cs:15` |
| `ResilienceHandlerTests` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/ResilienceHandlerTests.cs:14` |
| `ResultFailureExceptionTests` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/ResultFailureExceptionTests.cs:13` |
| `ResultGrpcExtensionsTests` | class | MMCA.Common.Grpc.Tests | `MMCA.Common.Grpc.Tests` | `MMCA.Common.Grpc.Tests/ResultGrpcExtensionsTests.cs:15` |
| `AssemblyReference` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure` | `MMCA.Common.Infrastructure/AssemblyReference.cs:5` |
| `ClassReference` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure` | `MMCA.Common.Infrastructure/AssemblyReference.cs:11` |
| `DependencyInjection` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure` | `MMCA.Common.Infrastructure/DependencyInjection.cs:38` |
| `UseDatabaseAttribute` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure` | `MMCA.Common.Infrastructure/UseDatabaseAttribute.cs:22` |
| `UseDataSourceAttribute` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure` | `MMCA.Common.Infrastructure/UseDataSourceAttribute.cs:13` |
| `IJwksProvider` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Auth` | `MMCA.Common.Infrastructure/Auth/IJwksProvider.cs:11` |
| `LoginProtectionService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Auth` | `MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:18` |
| `LoginProtectionSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Auth` | `MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:9` |
| `RsaJwksProvider` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Auth` | `MMCA.Common.Infrastructure/Auth/RsaJwksProvider.cs:15` |
| `CacheOptions` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Caching` | `MMCA.Common.Infrastructure/Caching/CacheOptions.cs:9` |
| `DistributedCacheService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Caching` | `MMCA.Common.Infrastructure/Caching/DistributedCacheService.cs:14` |
| `MemoryCacheService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Caching` | `MMCA.Common.Infrastructure/Caching/MemoryCacheService.cs:12` |
| `JwtForwardingDelegatingHandler` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Http` | `MMCA.Common.Infrastructure/Http/JwtForwardingDelegatingHandler.cs:17` |
| `NotificationHub` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Hubs` | `MMCA.Common.Infrastructure/Hubs/NotificationHub.cs:17` |
| `DefaultEntityConfigurationAssemblyProvider` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence` | `MMCA.Common.Infrastructure/Persistence/DefaultEntityConfigurationAssemblyProvider.cs:12` |
| `EFQueryableExecutor` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence` | `MMCA.Common.Infrastructure/Persistence/EFQueryableExecutor.cs:11` |
| `EntityConfigurationOptions` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence` | `MMCA.Common.Infrastructure/Persistence/EntityConfigurationOptions.cs:10` |
| `NamespaceConventions` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence` | `MMCA.Common.Infrastructure/Persistence/NamespaceConventions.cs:7` |
| `ProfilingHelper` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence` | `MMCA.Common.Infrastructure/Persistence/ProfilingHelper.cs:9` |
| `UnitOfWork` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence` | `MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:13` |
| `EntityTypeConfiguration<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfiguration.cs:29` |
| `EntityTypeConfigurationBase<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationBase.cs:19` |
| `EntityTypeConfigurationCosmos<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationCosmos.cs:19` |
| `EntityTypeConfigurationSqlite<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationSqlite.cs:18` |
| `EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationSQLServer.cs:18` |
| `IEntityTypeConfigurationBase<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationBase.cs:14` |
| `IEntityTypeConfigurationCosmos<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationCosmos.cs:13` |
| `IEntityTypeConfigurationSqlite<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationSqlite.cs:13` |
| `IEntityTypeConfigurationSQLServer<TEntity, TIdentifierType>` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/IEntityTypeConfigurationSQLServer.cs:13` |
| `PushNotificationConfiguration` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration.Notifications` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/Notifications/PushNotificationConfiguration.cs:15` |
| `UserNotificationConfiguration` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Configuration.EntityTypeConfiguration.Notifications` | `MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/Notifications/UserNotificationConfiguration.cs:15` |
| `CrossDataSourceDegradeConvention` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Conventions` | `MMCA.Common.Infrastructure/Persistence/Conventions/CrossDataSourceDegradeConvention.cs:34` |
| `DataSourceResolver` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DataSources` | `MMCA.Common.Infrastructure/Persistence/DataSources/DataSourceResolver.cs:13` |
| `EntityDataSourceRegistry` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DataSources` | `MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:21` |
| `IDataSourceResolver` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DataSources` | `MMCA.Common.Infrastructure/Persistence/DataSources/IDataSourceResolver.cs:15` |
| `IEntityDataSourceRegistry` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DataSources` | `MMCA.Common.Infrastructure/Persistence/DataSources/IEntityDataSourceRegistry.cs:11` |
| `PhysicalDataSource` | record | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DataSources` | `MMCA.Common.Infrastructure/Persistence/DataSources/PhysicalDataSource.cs:17` |
| `Snapshot` | record | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DataSources` | `MMCA.Common.Infrastructure/Persistence/DataSources/EntityDataSourceRegistry.cs:25` |
| `ApplicationDbContext` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts` | `MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:34` |
| `CosmosDbContext` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts` | `MMCA.Common.Infrastructure/Persistence/DbContexts/CosmosDbContext.cs:15` |
| `DataSourceModelCacheKeyFactory` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts` | `MMCA.Common.Infrastructure/Persistence/DbContexts/DataSourceModelCacheKeyFactory.cs:16` |
| `ModelBuilderExtensions` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts` | `MMCA.Common.Infrastructure/Persistence/DbContexts/ModelBuilderExtensions.cs:10` |
| `SqliteDbContext` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts` | `MMCA.Common.Infrastructure/Persistence/DbContexts/SqliteDbContext.cs:13` |
| `SQLServerDbContext` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts` | `MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:14` |
| `ValReturn<T>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts` | `MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:51` |
| `DesignTimeDbContextHelper` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:34` |
| `DesignTimeDbContextOptions` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextOptions.cs:11` |
| `ExplicitAssemblyProvider` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:106` |
| `NullDomainEventDispatcher` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Design` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:111` |
| `ApplicationDbContextEFFactory` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/ApplicationDbContextEFFactory.cs:15` |
| `DbContextFactory` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:19` |
| `DefaultCosmosDbContextFactory` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DefaultEngineDbContextFactories.cs:31` |
| `DefaultSqliteDbContextFactory` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DefaultEngineDbContextFactories.cs:22` |
| `DefaultSqlServerDbContextFactory` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DefaultEngineDbContextFactories.cs:13` |
| `IDbContextFactory` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/IDbContextFactory.cs:11` |
| `IdentityInsertGroup` | record | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:226` |
| `IPhysicalDbContextFactory` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/IPhysicalDbContextFactory.cs:14` |
| `PhysicalDbContextFactory` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Factory` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/PhysicalDbContextFactory.cs:16` |
| `DbSeeder` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/DbSeeder.cs:7` |
| `IDbSeeder` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding` | `MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/IDbSeeder.cs:7` |
| `EncryptedStringConverter` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Encryption` | `MMCA.Common.Infrastructure/Persistence/Encryption/EncryptedStringConverter.cs:28` |
| `EfInboxStore` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Inbox` | `MMCA.Common.Infrastructure/Persistence/Inbox/EfInboxStore.cs:18` |
| `IInboxStore` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Inbox` | `MMCA.Common.Infrastructure/Persistence/Inbox/IInboxStore.cs:9` |
| `InboxMessage` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Inbox` | `MMCA.Common.Infrastructure/Persistence/Inbox/InboxMessage.cs:8` |
| `NoOpInboxStore` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Inbox` | `MMCA.Common.Infrastructure/Persistence/Inbox/NoOpInboxStore.cs:7` |
| `AuditSaveChangesInterceptor` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Interceptors` | `MMCA.Common.Infrastructure/Persistence/Interceptors/AuditSaveChangesInterceptor.cs:13` |
| `CapturedState` | record | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Interceptors` | `MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:155` |
| `DomainEventSaveChangesInterceptor` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Interceptors` | `MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:21` |
| `IOutboxSignal` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Outbox` | `MMCA.Common.Infrastructure/Persistence/Outbox/IOutboxSignal.cs:8` |
| `OutboxCleanupService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Outbox` | `MMCA.Common.Infrastructure/Persistence/Outbox/OutboxCleanupService.cs:32` |
| `OutboxCycleResult` | record struct | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Outbox` | `MMCA.Common.Infrastructure/Persistence/Outbox/OutboxCycleResult.cs:19` |
| `OutboxFinalizer` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Outbox` | `MMCA.Common.Infrastructure/Persistence/Outbox/OutboxFinalizer.cs:12` |
| `OutboxMessage` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Outbox` | `MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:14` |
| `OutboxProcessor` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Outbox` | `MMCA.Common.Infrastructure/Persistence/Outbox/OutboxProcessor.cs:37` |
| `OutboxSignal` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Outbox` | `MMCA.Common.Infrastructure/Persistence/Outbox/OutboxSignal.cs:9` |
| `EFReadRepository<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Repositories` | `MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:15` |
| `EFReadRepositoryDecorator<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Repositories` | `MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepositoryDecorator.cs:15` |
| `EFRepository<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Repositories` | `MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:14` |
| `EFRepositoryDecorator<TEntity, TIdentifierType>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Repositories` | `MMCA.Common.Infrastructure/Persistence/Repositories/EFRepositoryDecorator.cs:13` |
| `IRepositoryFactory` | interface | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Repositories.Factory` | `MMCA.Common.Infrastructure/Persistence/Repositories/Factory/IRepositoryFactory.cs:11` |
| `RepositoryFactory` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.Repositories.Factory` | `MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:13` |
| `CosmosIntIdValueGenerator` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Persistence.ValueGenerators` | `MMCA.Common.Infrastructure/Persistence/ValueGenerators/CosmosIntIdValueGenerator.cs:16` |
| `AzureBlobFileStorageService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/AzureBlobFileStorageService.cs:15` |
| `AzureNotificationHubDeviceRegistrar` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/AzureNotificationHubDeviceRegistrar.cs:15` |
| `AzureNotificationHubNativePushSender` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/AzureNotificationHubNativePushSender.cs:14` |
| `BrokerEventBus` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/BrokerEventBus.cs:30` |
| `BrokerMessageBus` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/BrokerMessageBus.cs:24` |
| `ClaimBasedUserIdProvider` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/ClaimBasedUserIdProvider.cs:9` |
| `CorrelationContext` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/CorrelationContext.cs:9` |
| `CurrentUserService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/CurrentUserService.cs:12` |
| `DataSourceService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/DataSourceService.cs:12` |
| `ImageSharpImageProcessor` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/ImageSharpImageProcessor.cs:14` |
| `InProcessEventBus` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/InProcessEventBus.cs:23` |
| `InProcessMessageBus` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/InProcessMessageBus.cs:20` |
| `IntegrationEventConsumer<TEvent>` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/IntegrationEventConsumer.cs:26` |
| `IntegrationEventConsumerExtensions` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/IntegrationEventConsumerExtensions.cs:11` |
| `IntegrationEventPublisher` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/IntegrationEventPublisher.cs:12` |
| `NativePushPayloads` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/NativePushPayloads.cs:10` |
| `NullFileStorageService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/NullFileStorageService.cs:11` |
| `NullLiveChannelPublisher` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/NullLiveChannelPublisher.cs:11` |
| `NullNativePushSender` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/NullNativePushSender.cs:10` |
| `NullPushDeviceRegistrar` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/NullPushDeviceRegistrar.cs:12` |
| `NullPushNotificationSender` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/NullPushNotificationSender.cs:10` |
| `PasswordHasher` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/PasswordHasher.cs:12` |
| `SignalRLiveChannelPublisher` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/SignalRLiveChannelPublisher.cs:12` |
| `SignalRPushNotificationSender` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/SignalRPushNotificationSender.cs:13` |
| `SmtpEmailSender` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/SmtpEmailSender.cs:12` |
| `TokenService` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Services` | `MMCA.Common.Infrastructure/Services/TokenService.cs:23` |
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
| `MessageBusProvider` | enum | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/MessageBusSettings.cs:68` |
| `MessageBusSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/MessageBusSettings.cs:11` |
| `NativePushSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/NativePushSettings.cs:9` |
| `OutboxSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/OutboxSettings.cs:10` |
| `PushNotificationSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/PushNotificationSettings.cs:6` |
| `SmtpSettings` | class | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure.Settings` | `MMCA.Common.Infrastructure/Settings/SmtpSettings.cs:9` |
| `DependencyInjectionAdditionalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests` | `MMCA.Common.Infrastructure.Tests/DependencyInjectionAdditionalTests.cs:13` |
| `DependencyInjectionInfrastructureTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests` | `MMCA.Common.Infrastructure.Tests/DependencyInjectionInfrastructureTests.cs:15` |
| `DependencyInjectionPushNotificationsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests` | `MMCA.Common.Infrastructure.Tests/DependencyInjectionPushNotificationsTests.cs:11` |
| `DependencyInjectionTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests` | `MMCA.Common.Infrastructure.Tests/DependencyInjectionTests.cs:16` |
| `UseDataSourceAttributeTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests` | `MMCA.Common.Infrastructure.Tests/UseDataSourceAttributeTests.cs:6` |
| `FakeCacheService` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Auth` | `MMCA.Common.Infrastructure.Tests/Auth/LoginProtectionServiceTests.cs:230` |
| `LoginProtectionServiceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Auth` | `MMCA.Common.Infrastructure.Tests/Auth/LoginProtectionServiceTests.cs:14` |
| `RsaJwksProviderTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Auth` | `MMCA.Common.Infrastructure.Tests/Auth/RsaJwksProviderTests.cs:14` |
| `CacheOptionsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Caching` | `MMCA.Common.Infrastructure.Tests/Caching/CacheOptionsTests.cs:6` |
| `DistributedCacheServiceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Caching` | `MMCA.Common.Infrastructure.Tests/Caching/DistributedCacheServiceTests.cs:10` |
| `MemoryCacheServiceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Caching` | `MMCA.Common.Infrastructure.Tests/Caching/MemoryCacheServiceTests.cs:7` |
| `NotificationHubTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Hubs` | `MMCA.Common.Infrastructure.Tests/Hubs/NotificationHubTests.cs:11` |
| `ApplicationDbContextEFFactoryTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ApplicationDbContextEFFactoryTests.cs:10` |
| `ApplicationDbContextTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ApplicationDbContextTests.cs:19` |
| `AuditSaveChangesInterceptorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditSaveChangesInterceptorTests.cs:13` |
| `CleanupTestContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxCleanupServiceTests.cs:515` |
| `CosmosIntIdValueGeneratorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/CosmosIntIdValueGeneratorTests.cs:6` |
| `DbContextFactoryAdditionalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryAdditionalTests.cs:11` |
| `DbContextFactoryTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbContextFactoryTests.cs:12` |
| `DbSeederTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbSeederTests.cs:6` |
| `DefaultEntityConfigurationAssemblyProviderTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DefaultEntityConfigurationAssemblyProviderTests.cs:9` |
| `DomainEventSaveChangesInterceptorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventSaveChangesInterceptorTests.cs:18` |
| `EFQueryableExecutorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFQueryableExecutorTests.cs:11` |
| `EFReadRepositoryDecoratorAdditionalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryDecoratorAdditionalTests.cs:10` |
| `EFReadRepositoryDecoratorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryDecoratorTests.cs:11` |
| `EFRepositoryAdditionalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryAdditionalTests.cs:9` |
| `EFRepositoryDecoratorAdditionalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryDecoratorAdditionalTests.cs:10` |
| `EFRepositoryDecoratorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryDecoratorTests.cs:9` |
| `EFRepositoryIntegrationTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryIntegrationTests.cs:9` |
| `EncryptedStringConverterTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EncryptedStringConverterTests.cs:6` |
| `EntityConfigurationOptionsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityConfigurationOptionsTests.cs:7` |
| `EntityTypeConfigurationBaseTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationBaseTests.cs:14` |
| `EntityTypeConfigurationTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationTests.cs:9` |
| `FakeAggregate` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/RepositoryFactoryTests.cs:123` |
| `FakeAggregate` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/UnitOfWorkAdditionalTests.cs:93` |
| `FakeAggregate` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/UnitOfWorkTests.cs:151` |
| `FakeAggregateEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryDecoratorAdditionalTests.cs:49` |
| `FakeAggregateEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryDecoratorTests.cs:64` |
| `FakeEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryDecoratorAdditionalTests.cs:92` |
| `FakeEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFReadRepositoryDecoratorTests.cs:152` |
| `FakeEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/RepositoryFactoryTests.cs:128` |
| `FakeEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/UnitOfWorkAdditionalTests.cs:98` |
| `FakeEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/UnitOfWorkTests.cs:156` |
| `FakeTimeProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditSaveChangesInterceptorTests.cs:127` |
| `Mocks` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxCleanupServiceTests.cs:46` |
| `Mocks` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/UnitOfWorkAdditionalTests.cs:13` |
| `Mocks` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/UnitOfWorkTests.cs:15` |
| `ModelBuilderExtensionsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ModelBuilderExtensionsTests.cs:12` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditSaveChangesInterceptorTests.cs:187` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventSaveChangesInterceptorTests.cs:220` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxCleanupServiceTests.cs:572` |
| `OutboxCleanupServiceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxCleanupServiceTests.cs:34` |
| `OutboxMessageTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxMessageTests.cs:12` |
| `OutboxProcessorExecuteAsyncTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxProcessorExecuteAsyncTests.cs:22` |
| `OutboxProcessorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxProcessorTests.cs:28` |
| `OutboxProcessorWaitTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxProcessorWaitTests.cs:10` |
| `OutboxTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxProcessorTests.cs:473` |
| `ProfilingHelperTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ProfilingHelperTests.cs:10` |
| `RepositoryFactoryTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/RepositoryFactoryTests.cs:14` |
| `SqliteTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationTests.cs:62` |
| `SqliteTestEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationTests.cs:52` |
| `SqliteTestEntityConfig` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationTests.cs:58` |
| `TestableDbSeeder` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DbSeederTests.cs:53` |
| `TestAggregate` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventSaveChangesInterceptorTests.cs:175` |
| `TestAggregateEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationBaseTests.cs:53` |
| `TestAggregateEntityConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationBaseTests.cs:63` |
| `TestApplicationDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ApplicationDbContextTests.cs:93` |
| `TestAuditDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditSaveChangesInterceptorTests.cs:138` |
| `TestAuditEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/AuditSaveChangesInterceptorTests.cs:136` |
| `TestConfigDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationBaseTests.cs:87` |
| `TestDataSourceService` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ModelBuilderExtensionsTests.cs:118` |
| `TestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryAdditionalTests.cs:229` |
| `TestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryIntegrationTests.cs:435` |
| `TestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/RepositoryFactoryTests.cs:133` |
| `TestDomainEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventSaveChangesInterceptorTests.cs:173` |
| `TestDomainEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxMessageTests.cs:14` |
| `TestDomainEvent` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxProcessorTests.cs:449` |
| `TestDomainEventDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/DomainEventSaveChangesInterceptorTests.cs:180` |
| `TestDomainEventWithData` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxMessageTests.cs:16` |
| `TestEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ApplicationDbContextTests.cs:88` |
| `TestEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryAdditionalTests.cs:221` |
| `TestEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFRepositoryIntegrationTests.cs:427` |
| `TestEntitySqliteConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ModelBuilderExtensionsTests.cs:107` |
| `TestIntegrationEvent` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/OutboxProcessorTests.cs:461` |
| `TestItem` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EFQueryableExecutorTests.cs:15` |
| `TestMappedEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ModelBuilderExtensionsTests.cs:98` |
| `TestModelBuilderDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/ModelBuilderExtensionsTests.cs:136` |
| `TestNonAggregateConfigDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationBaseTests.cs:95` |
| `TestNonAggregateEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationBaseTests.cs:58` |
| `TestNonAggregateEntityConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/EntityTypeConfigurationBaseTests.cs:75` |
| `UnitOfWorkAdditionalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/UnitOfWorkAdditionalTests.cs:11` |
| `UnitOfWorkTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence` | `MMCA.Common.Infrastructure.Tests/Persistence/UnitOfWorkTests.cs:13` |
| `CosmosConfigurationPortabilityTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CosmosConfigurationPortabilityTests.cs:29` |
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
| `FixedAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CosmosConfigurationPortabilityTests.cs:80` |
| `FixedAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/EntityDataSourceRegistryTests.cs:175` |
| `FixedAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/MultiSourceSqliteIntegrationTests.cs:209` |
| `MapRegistry` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CrossDataSourceDegradeConventionTests.cs:173` |
| `MultiSourceCustomer` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/MultiSourceSqliteIntegrationTests.cs:225` |
| `MultiSourceCustomerConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/MultiSourceSqliteIntegrationTests.cs:241` |
| `MultiSourceOrder` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/MultiSourceSqliteIntegrationTests.cs:216` |
| `MultiSourceOrderConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/MultiSourceSqliteIntegrationTests.cs:238` |
| `MultiSourceSqliteIntegrationTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/MultiSourceSqliteIntegrationTests.cs:30` |
| `MultiSourceTestEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/MultiSourceSqliteIntegrationTests.cs:230` |
| `PortablePrincipal` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CosmosConfigurationPortabilityTests.cs:95` |
| `PortablePrincipalConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CosmosConfigurationPortabilityTests.cs:117` |
| `PortableThing` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CosmosConfigurationPortabilityTests.cs:86` |
| `PortableThingConfiguration` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.DataSources` | `MMCA.Common.Infrastructure.Tests/Persistence/DataSources/CosmosConfigurationPortabilityTests.cs:104` |
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
| `InboxTestDbContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Persistence.Inbox` | `MMCA.Common.Infrastructure.Tests/Persistence/Inbox/EfInboxStoreTests.cs:141` |
| `DatabaseRestoreDrillTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Resilience` | `MMCA.Common.Infrastructure.Tests/Resilience/DatabaseRestoreDrillTests.cs:19` |
| `DrillResult` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Resilience` | `MMCA.Common.Infrastructure.Tests/Resilience/DatabaseRestoreDrillTests.cs:176` |
| `BrokerEventBusTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerEventBusTests.cs:27` |
| `BrokerMessageBusTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerMessageBusTests.cs:19` |
| `ClaimBasedUserIdProviderTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/ClaimBasedUserIdProviderTests.cs:13` |
| `CorrelationContextTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/CorrelationContextTests.cs:6` |
| `CurrentUserServiceAdditionalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/CurrentUserServiceAdditionalTests.cs:9` |
| `CurrentUserServiceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/CurrentUserServiceTests.cs:9` |
| `DataSourceServiceAdditionalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/DataSourceServiceAdditionalTests.cs:14` |
| `DataSourceServiceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/DataSourceServiceTests.cs:13` |
| `FakeEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/DataSourceServiceAdditionalTests.cs:84` |
| `FakeEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/DataSourceServiceTests.cs:165` |
| `ImageSharpImageProcessorTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/ImageSharpImageProcessorTests.cs:15` |
| `InProcessEventBusOutboxTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessEventBusOutboxTests.cs:25` |
| `InProcessEventBusTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessEventBusTests.cs:20` |
| `InProcessMessageBusTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessMessageBusTests.cs:19` |
| `IntegrationEventConsumerTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/IntegrationEventConsumerTests.cs:12` |
| `IntegrationEventPublisherTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/IntegrationEventPublisherTests.cs:9` |
| `Mocks` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerEventBusTests.cs:30` |
| `Mocks` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerMessageBusTests.cs:26` |
| `Mocks` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessMessageBusTests.cs:24` |
| `NativePushPayloadsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/NativePushPayloadsTests.cs:12` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerEventBusTests.cs:281` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessEventBusOutboxTests.cs:150` |
| `NullAssemblyProvider` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessEventBusTests.cs:153` |
| `NullLiveChannelPublisherTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/NullLiveChannelPublisherTests.cs:6` |
| `NullPushNotificationSenderTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/NullPushNotificationSenderTests.cs:6` |
| `OtherIntegrationEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerMessageBusTests.cs:23` |
| `PasswordHasherTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/PasswordHasherTests.cs:8` |
| `RecordingDomainHandler` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessMessageBusTests.cs:152` |
| `RecordingIntegrationHandler` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessMessageBusTests.cs:161` |
| `SignalRLiveChannelPublisherTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/SignalRLiveChannelPublisherTests.cs:9` |
| `SignalRPushNotificationSenderAdditionalTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/SignalRPushNotificationSenderAdditionalTests.cs:13` |
| `SignalRPushNotificationSenderTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/SignalRPushNotificationSenderTests.cs:9` |
| `SmtpEmailSenderTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/SmtpEmailSenderTests.cs:7` |
| `TestConnectionContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/ClaimBasedUserIdProviderTests.cs:81` |
| `TestDuplexPipe` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/ClaimBasedUserIdProviderTests.cs:108` |
| `TestIntegrationEvent` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerEventBusTests.cs:192` |
| `TestIntegrationEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerMessageBusTests.cs:21` |
| `TestIntegrationEvent` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessEventBusOutboxTests.cs:94` |
| `TestIntegrationEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessMessageBusTests.cs:21` |
| `TestIntegrationEvent` | record | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/IntegrationEventConsumerTests.cs:14` |
| `TestNonOutboxContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerEventBusTests.cs:241` |
| `TestNonOutboxContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessEventBusTests.cs:118` |
| `TestOutboxContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/BrokerEventBusTests.cs:203` |
| `TestOutboxContext` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/InProcessEventBusOutboxTests.cs:105` |
| `TokenServiceTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/TokenServiceTests.cs:11` |
| `UnregisteredEntity` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Services` | `MMCA.Common.Infrastructure.Tests/Services/DataSourceServiceAdditionalTests.cs:86` |
| `ConnectionStringSettingsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Settings` | `MMCA.Common.Infrastructure.Tests/Settings/SettingsTests.cs:132` |
| `JwtSettingsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Settings` | `MMCA.Common.Infrastructure.Tests/Settings/SettingsTests.cs:8` |
| `OutboxSettingsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Settings` | `MMCA.Common.Infrastructure.Tests/Settings/SettingsTests.cs:180` |
| `PushNotificationSettingsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Settings` | `MMCA.Common.Infrastructure.Tests/Settings/SettingsTests.cs:227` |
| `SmtpSettingsTests` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.Settings` | `MMCA.Common.Infrastructure.Tests/Settings/SettingsTests.cs:62` |
| `EmptyEntityDataSourceRegistry` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.TestDoubles` | `MMCA.Common.Infrastructure.Tests/TestDoubles/TestDataSourceDoubles.cs:11` |
| `TestPhysicalDataSources` | class | MMCA.Common.Infrastructure.Tests | `MMCA.Common.Infrastructure.Tests.TestDoubles` | `MMCA.Common.Infrastructure.Tests/TestDoubles/TestDataSourceDoubles.cs:32` |
| `AuthenticationRequest` | record struct | MMCA.Common.Shared | `MMCA.Common.Shared` | `MMCA.Common.Shared/AuthenticationRequest.cs:15` |
| `CollectionResult<T>` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/PaginationMetadata.cs:64` |
| `Error` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/Error.cs:15` |
| `ErrorType` | enum | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/ErrorType.cs:8` |
| `PagedCollectionResult<T>` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/PaginationMetadata.cs:91` |
| `PaginationMetadata` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/PaginationMetadata.cs:12` |
| `Result` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/Result.cs:18` |
| `Result<T>` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/Result.cs:119` |
| `ServiceContractAttribute` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Abstractions` | `MMCA.Common.Shared/Abstractions/ServiceContractAttribute.cs:19` |
| `AuthClaimTypes` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/AuthClaimTypes.cs:7` |
| `AuthenticationResponse` | record struct | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/AuthenticationResponse.cs:10` |
| `ChangePasswordRequest` | record struct | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/ChangePasswordRequest.cs:8` |
| `IPermissionRegistry` | interface | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/IPermissionRegistry.cs:13` |
| `LoginRequest` | record struct | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/LoginRequest.cs:8` |
| `OAuthCodeExchangeRequest` | record struct | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/OAuthCodeExchangeRequest.cs:11` |
| `PermissionRegistry` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/PermissionRegistry.cs:10` |
| `PermissionRegistryBuilder` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/PermissionRegistryBuilder.cs:8` |
| `RefreshTokenRequest` | record struct | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/RefreshTokenRequest.cs:9` |
| `RegisterRequest` | record struct | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/RegisterRequest.cs:13` |
| `RoleNames` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/RoleNames.cs:12` |
| `RoleValue` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Auth` | `MMCA.Common.Shared/Auth/RoleValue.cs:25` |
| `IcsCalendarBuilder` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Calendars` | `MMCA.Common.Shared/Calendars/IcsCalendarBuilder.cs:12` |
| `IcsEvent` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Calendars` | `MMCA.Common.Shared/Calendars/IcsEvent.cs:15` |
| `BaseLookup<TIdentifierType>` | record | MMCA.Common.Shared | `MMCA.Common.Shared.DTOs` | `MMCA.Common.Shared/DTOs/BaseLookup.cs:8` |
| `IBaseDTO<TIdentifierType>` | interface | MMCA.Common.Shared | `MMCA.Common.Shared.DTOs` | `MMCA.Common.Shared/DTOs/IBaseDTO.cs:9` |
| `IConcurrencyAware` | interface | MMCA.Common.Shared | `MMCA.Common.Shared.DTOs` | `MMCA.Common.Shared/DTOs/IConcurrencyAware.cs:13` |
| `DomainException` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Exceptions` | `MMCA.Common.Shared/Exceptions/DomainException.cs:9` |
| `DomainInvariantViolationException` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Exceptions` | `MMCA.Common.Shared/Exceptions/DomainInvariantViolationException.cs:9` |
| `DomainHelper` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Extensions` | `MMCA.Common.Shared/Extensions/DomainHelper.cs:8` |
| `SupportedCultures` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Globalization` | `MMCA.Common.Shared/Globalization/SupportedCultures.cs:9` |
| `NotificationFeatures` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Notifications` | `MMCA.Common.Shared/Notifications/NotificationFeatures.cs:6` |
| `DeviceInstallationRequest` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Notifications.PushNotifications` | `MMCA.Common.Shared/Notifications/PushNotifications/DeviceInstallationRequest.cs:12` |
| `PushNotificationDTO` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Notifications.PushNotifications` | `MMCA.Common.Shared/Notifications/PushNotifications/PushNotificationDTO.cs:8` |
| `SendPushNotificationRequest` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Notifications.PushNotifications` | `MMCA.Common.Shared/Notifications/PushNotifications/SendPushNotificationRequest.cs:6` |
| `UserNotificationDTO` | record | MMCA.Common.Shared | `MMCA.Common.Shared.Notifications.UserNotifications` | `MMCA.Common.Shared/Notifications/UserNotifications/UserNotificationDTO.cs:7` |
| `HttpResilienceDefaults` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Resilience` | `MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:10` |
| `PropertyReader` | delegate | MMCA.Common.Shared | `MMCA.Common.Shared.Serialization` | `MMCA.Common.Shared/Serialization/ResultJsonConverterFactory.cs:95` |
| `ResultConverter` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Serialization` | `MMCA.Common.Shared/Serialization/ResultJsonConverterFactory.cs:35` |
| `ResultConverter<T>` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Serialization` | `MMCA.Common.Shared/Serialization/ResultJsonConverterFactory.cs:60` |
| `ResultJsonConverterFactory` | class | MMCA.Common.Shared | `MMCA.Common.Shared.Serialization` | `MMCA.Common.Shared/Serialization/ResultJsonConverterFactory.cs:15` |
| `Address` | record | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/Address.cs:16` |
| `AddressInvariants` | class | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/AddressInvariants.cs:9` |
| `Currency` | record | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/Currency.cs:14` |
| `CurrencyJsonConverter` | class | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/Currency.cs:65` |
| `DateRange` | record | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/DateRange.cs:9` |
| `DateTimeRange` | record | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/DateTimeRange.cs:10` |
| `Email` | record | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/Email.cs:13` |
| `EmailInvariants` | class | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/EmailInvariants.cs:11` |
| `Money` | record | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/Money.cs:18` |
| `PhoneNumber` | record | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/PhoneNumber.cs:13` |
| `PhoneNumberInvariants` | class | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/PhoneNumberInvariants.cs:11` |
| `ValueObject` | record | MMCA.Common.Shared | `MMCA.Common.Shared.ValueObjects` | `MMCA.Common.Shared/ValueObjects/ValueObject.cs:8` |
| `CollectionResultTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Abstractions` | `MMCA.Common.Shared.Tests/Abstractions/CollectionResultTests.cs:6` |
| `ErrorTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Abstractions` | `MMCA.Common.Shared.Tests/Abstractions/ErrorTests.cs:6` |
| `PaginationMetadataTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Abstractions` | `MMCA.Common.Shared.Tests/Abstractions/PaginationMetadataTests.cs:6` |
| `ResultTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Abstractions` | `MMCA.Common.Shared.Tests/Abstractions/ResultTests.cs:6` |
| `PermissionRegistryTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Auth` | `MMCA.Common.Shared.Tests/Auth/PermissionRegistryTests.cs:6` |
| `IcsCalendarBuilderTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Calendars` | `MMCA.Common.Shared.Tests/Calendars/IcsCalendarBuilderTests.cs:12` |
| `ConcreteDomainException` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Exceptions` | `MMCA.Common.Shared.Tests/Exceptions/DomainExceptionTests.cs:8` |
| `DomainExceptionTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Exceptions` | `MMCA.Common.Shared.Tests/Exceptions/DomainExceptionTests.cs:6` |
| `DomainHelperTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Extensions` | `MMCA.Common.Shared.Tests/Extensions/DomainHelperTests.cs:6` |
| `ResultJsonConverterFactoryTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Serialization` | `MMCA.Common.Shared.Tests/Serialization/ResultJsonConverterFactoryTests.cs:12` |
| `TestDTO` | record | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.Serialization` | `MMCA.Common.Shared.Tests/Serialization/ResultJsonConverterFactoryTests.cs:16` |
| `AddressInvariantsTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/AddressInvariantsTests.cs:6` |
| `AddressTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/AddressTests.cs:6` |
| `CurrencyJsonConverterTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/CurrencyJsonConverterTests.cs:7` |
| `CurrencyTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/CurrencyTests.cs:6` |
| `DateRangeTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/DateRangeTests.cs:6` |
| `DateTimeRangeTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/DateTimeRangeTests.cs:6` |
| `EmailTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/EmailTests.cs:6` |
| `MoneyTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/MoneyTests.cs:6` |
| `PhoneNumberTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/PhoneNumberTests.cs:6` |
| `TestValueObject` | record | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/ValueObjectTests.cs:8` |
| `ValueObjectTests` | class | MMCA.Common.Shared.Tests | `MMCA.Common.Shared.Tests.ValueObjects` | `MMCA.Common.Shared.Tests/ValueObjects/ValueObjectTests.cs:6` |
| `FeatureManagementTestExtensions` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/FeatureManagementTestExtensions.cs:10` |
| `IIntegrationTestFixture` | interface | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/IIntegrationTestFixture.cs:8` |
| `IntegrationTestBase<TFixture>` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/IntegrationTestBase.cs:13` |
| `JwtTokenGenerator` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/JwtTokenGenerator.cs:29` |
| `OpenApiContractTestsBase<TFixture>` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/OpenApiContractTestsBase.cs:21` |
| `ProblemDetailsContractTestsBase<TFixture>` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/ProblemDetailsContractTestsBase.cs:21` |
| `SecurityHeadersTestsBase` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/SecurityHeadersTestsBase.cs:16` |
| `ServiceInfoVersioningContractTestsBase<TFixture>` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/ServiceInfoVersioningContractTestsBase.cs:19` |
| `SqlServerIntegrationTestFixtureBase<TEntryPoint>` | class | MMCA.Common.Testing | `MMCA.Common.Testing` | `MMCA.Common.Testing/SqlServerIntegrationTestFixtureBase.cs:27` |
| `EntityBuilderBase<TBuilder, TEntity>` | class | MMCA.Common.Testing | `MMCA.Common.Testing.Builders` | `MMCA.Common.Testing/Builders/EntityBuilderBase.cs:9` |
| `AggregateConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/AggregateConventionTestsBase.cs:8` |
| `ArchitectureAssert` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureAssert.cs:8` |
| `ArchitectureMapBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureMapBase.cs:11` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Controllers.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Entities.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Events.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Governance.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Handlers.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Immutability.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Layers.cs:9` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Localization.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.LocalizedText.cs:5` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Modules.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Naming.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Purity.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Slices.cs:3` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:5` |
| `ArchitectureRules` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Transport.cs:3` |
| `BrandColorTokenTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/BrandColorTokenTestsBase.cs:13` |
| `ConcurrencyConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/ConcurrencyConventionTestsBase.cs:8` |
| `ConstructorDependencyCountTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/ConstructorDependencyCountTestsBase.cs:14` |
| `ControllerConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/ControllerConventionTestsBase.cs:7` |
| `CrossEntityNavigationFinder` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/ArchitectureRules.Specifications.cs:97` |
| `DataResidencyTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/DataResidencyTestsBase.cs:14` |
| `DependencyVersionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/DependencyVersionTestsBase.cs:15` |
| `DomainPurityTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/DomainPurityTestsBase.cs:8` |
| `EntityConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/EntityConventionTestsBase.cs:8` |
| `EventConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/EventConventionTestsBase.cs:8` |
| `FormsConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/FormsConventionTestsBase.cs:15` |
| `FrameworkVersionConsistencyTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/FrameworkVersionConsistencyTestsBase.cs:13` |
| `HandlerConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/HandlerConventionTestsBase.cs:8` |
| `IArchitectureMap` | interface | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/IArchitectureMap.cs:39` |
| `ImmutabilityTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/ImmutabilityTestsBase.cs:8` |
| `IntegrationEventContractTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/IntegrationEventContractTestsBase.cs:11` |
| `Layer` | enum | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/IArchitectureMap.cs:9` |
| `LayerDependencyTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/LayerDependencyTestsBase.cs:7` |
| `LayerRef` | record | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/IArchitectureMap.cs:31` |
| `LocalizationResourceTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/LocalizationResourceTestsBase.cs:10` |
| `LocalizedTextConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/LocalizedTextConventionTestsBase.cs:13` |
| `MicroserviceExtractionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/MicroserviceExtractionTestsBase.cs:8` |
| `ModuleIsolationTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/ModuleIsolationTestsBase.cs:8` |
| `NamingConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/NamingConventionTestsBase.cs:8` |
| `PiiConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/PiiConventionTestsBase.cs:7` |
| `RouteAuthorizationTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/RouteAuthorizationTestsBase.cs:22` |
| `RuleHelpers` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/RuleHelpers.cs:8` |
| `SharedLayerTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/SharedLayerTestsBase.cs:7` |
| `SliceCohesionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/SliceCohesionTestsBase.cs:10` |
| `SpecificationConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/SpecificationConventionTestsBase.cs:10` |
| `StateManagementConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/StateManagementConventionTestsBase.cs:17` |
| `UIArchitectureConventionTestsBase` | class | MMCA.Common.Testing.Architecture | `MMCA.Common.Testing.Architecture` | `MMCA.Common.Testing.Architecture/Bases/UIArchitectureConventionTestsBase.cs:14` |
| `AccessibilityViolationException` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/AccessibilityViolationException.cs:7` |
| `AdminCredentials` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:66` |
| `AxeOptions` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/AxeOptions.cs:9` |
| `E2ETestBase` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:10` |
| `E2ETestCollection` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:40` |
| `E2ETestConfiguration` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:8` |
| `PageExtensions` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:14` |
| `PlaywrightFixture` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:6` |
| `UserCredentials` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:78` |
| `WebVitalsArtifact` | record | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:87` |
| `WebVitalsCollector` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:17` |
| `WebVitalsSample` | record | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Infrastructure` | `MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:73` |
| `LoginPage` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.PageObjects` | `MMCA.Common.Testing.E2E/PageObjects/LoginPage.cs:6` |
| `ProfilePage` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.PageObjects` | `MMCA.Common.Testing.E2E/PageObjects/ProfilePage.cs:6` |
| `RegisterPage` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.PageObjects` | `MMCA.Common.Testing.E2E/PageObjects/RegisterPage.cs:6` |
| `AuthorizationTestsBase` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Workflows.Identity` | `MMCA.Common.Testing.E2E/Workflows/Identity/AuthorizationTestsBase.cs:18` |
| `LogoutTestsBase` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Workflows.Identity` | `MMCA.Common.Testing.E2E/Workflows/Identity/LogoutTestsBase.cs:9` |
| `ProfileManagementTestsBase` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Workflows.Identity` | `MMCA.Common.Testing.E2E/Workflows/Identity/ProfileManagementTestsBase.cs:11` |
| `UserLoginTestsBase` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Workflows.Identity` | `MMCA.Common.Testing.E2E/Workflows/Identity/UserLoginTestsBase.cs:10` |
| `UserRegistrationTestsBase` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Workflows.Identity` | `MMCA.Common.Testing.E2E/Workflows/Identity/UserRegistrationTestsBase.cs:10` |
| `UserPreferencesTestsBase` | class | MMCA.Common.Testing.E2E | `MMCA.Common.Testing.E2E.Workflows.Preferences` | `MMCA.Common.Testing.E2E/Workflows/Preferences/UserPreferencesTestsBase.cs:21` |
| `BunitComponentTestBase` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:33` |
| `BunitInteractionExtensions` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/BunitInteractionExtensions.cs:12` |
| `CapturedRequest` | record | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:129` |
| `CapturingHttpMessageHandler` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:18` |
| `FreshApiClientFactory` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:75` |
| `HttpTestDoubles` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/HttpTestDoubles.cs:12` |
| `IsAuthenticatedAuthorizationService` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:111` |
| `MarkupSnapshot` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:21` |
| `MarkupSnapshotResult` | record struct | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs:104` |
| `MudProviderHandles` | record | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:92` |
| `MutableAuthenticationStateProvider` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:97` |
| `Route` | record | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/CapturingHttpMessageHandler.cs:110` |
| `StubTokenStorageService` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/StubTokenStorageService.cs:13` |
| `TestPrincipal` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/TestPrincipal.cs:6` |
| `UiHttpServiceHarness` | class | MMCA.Common.Testing.UI | `MMCA.Common.Testing.UI` | `MMCA.Common.Testing.UI/Infrastructure/UiHttpServiceHarness.cs:14` |
| `DependencyInjection` | class | MMCA.Common.UI | `MMCA.Common.UI` | `MMCA.Common.UI/DependencyInjection.cs:19` |
| `UISharedAssemblyReference` | class | MMCA.Common.UI | `MMCA.Common.UI` | `MMCA.Common.UI/DependencyInjection.cs:123` |
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
| `LayoutSettings` | class | MMCA.Common.UI | `MMCA.Common.UI.Common.Settings` | `MMCA.Common.UI/Common/Settings/LayoutSettings.cs:7` |
| `UIModuleConfiguration` | class | MMCA.Common.UI | `MMCA.Common.UI.Common.Settings` | `MMCA.Common.UI/Common/Settings/UIModuleConfiguration.cs:10` |
| `MobileInfiniteScrollList<TItem>` | class | MMCA.Common.UI | `MMCA.Common.UI.Components` | `MMCA.Common.UI/Components/MobileInfiniteScrollList.razor.cs:15` |
| `NotificationBell` | class | MMCA.Common.UI | `MMCA.Common.UI.Components.Notifications` | `MMCA.Common.UI/Components/Notifications/NotificationBell.razor.cs:14` |
| `MoneyExtensions` | class | MMCA.Common.UI | `MMCA.Common.UI.Extensions` | `MMCA.Common.UI/Extensions/MoneyExtensions.cs:9` |
| `WebApplicationExtensions` | class | MMCA.Common.UI | `MMCA.Common.UI.Extensions` | `MMCA.Common.UI/Extensions/WebApplicationExtensions.cs:9` |
| `PseudoLocalizer` | class | MMCA.Common.UI | `MMCA.Common.UI.Globalization` | `MMCA.Common.UI/Globalization/PseudoLocalizer.cs:20` |
| `PseudoStringLocalizer` | class | MMCA.Common.UI | `MMCA.Common.UI.Globalization` | `MMCA.Common.UI/Globalization/PseudoStringLocalizer.cs:13` |
| `PseudoStringLocalizerFactory` | class | MMCA.Common.UI | `MMCA.Common.UI.Globalization` | `MMCA.Common.UI/Globalization/PseudoStringLocalizerFactory.cs:11` |
| `ResxMudLocalizer` | class | MMCA.Common.UI | `MMCA.Common.UI.Globalization` | `MMCA.Common.UI/Globalization/ResxMudLocalizer.cs:17` |
| `DependencyInjection` | class | MMCA.Common.UI | `MMCA.Common.UI.Notifications` | `MMCA.Common.UI/Notifications/DependencyInjection.cs:11` |
| `NotificationUIModule` | class | MMCA.Common.UI | `MMCA.Common.UI.Notifications` | `MMCA.Common.UI/Notifications/NotificationUIModule.cs:14` |
| `LoginModel` | class | MMCA.Common.UI | `MMCA.Common.UI.Pages.Auth` | `MMCA.Common.UI/Pages/Auth/LoginModel.cs:9` |
| `PasswordComplexityAttribute` | class | MMCA.Common.UI | `MMCA.Common.UI.Pages.Auth` | `MMCA.Common.UI/Pages/Auth/PasswordComplexityAttribute.cs:12` |
| `RegisterModel` | class | MMCA.Common.UI | `MMCA.Common.UI.Pages.Auth` | `MMCA.Common.UI/Pages/Auth/RegisterModel.cs:9` |
| `DataGridListPageBase<TDto>` | class | MMCA.Common.UI | `MMCA.Common.UI.Pages.Common` | `MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:20` |
| `ErrorMessages` | class | MMCA.Common.UI | `MMCA.Common.UI.Pages.Common` | `MMCA.Common.UI/Pages/Common/ErrorMessages.cs:17` |
| `PersistedGridState` | record | MMCA.Common.UI | `MMCA.Common.UI.Pages.Common` | `MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:778` |
| `NotificationInbox` | class | MMCA.Common.UI | `MMCA.Common.UI.Pages.Notifications` | `MMCA.Common.UI/Pages/Notifications/NotificationInbox.razor.cs:17` |
| `NotificationList` | class | MMCA.Common.UI | `MMCA.Common.UI.Pages.Notifications` | `MMCA.Common.UI/Pages/Notifications/NotificationList.razor.cs:16` |
| `NotificationSend` | class | MMCA.Common.UI | `MMCA.Common.UI.Pages.Notifications` | `MMCA.Common.UI/Pages/Notifications/NotificationSend.razor.cs:16` |
| `MudTranslations` | class | MMCA.Common.UI | `MMCA.Common.UI.Resources` | `MMCA.Common.UI/Resources/MudTranslations.cs:10` |
| `SharedResource` | class | MMCA.Common.UI | `MMCA.Common.UI.Resources` | `MMCA.Common.UI/Resources/SharedResource.cs:9` |
| `ApiUserPreferenceReader` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ApiUserPreferenceReader.cs:14` |
| `ApiUserPreferenceWriter` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ApiUserPreferenceWriter.cs:15` |
| `AuthenticatedServiceBase` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/AuthenticatedServiceBase.cs:14` |
| `ChildEntityServiceBase` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ChildEntityServiceBase.cs:17` |
| `CultureDelegatingHandler` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/CultureDelegatingHandler.cs:13` |
| `EntityServiceBase<TEntityDTO, TIdentifierType>` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/EntityServiceBase.cs:23` |
| `IFormFactor` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/IFormFactor.cs:7` |
| `IUserPreferenceReader` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/IUserPreferenceReader.cs:9` |
| `IUserPreferenceWriter` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/IUserPreferenceWriter.cs:9` |
| `ListPageQueryStateService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ListPageQueryStateService.cs:28` |
| `ListPageState` | record | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ListPageStateService.cs:9` |
| `ListPageStateService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ListPageStateService.cs:58` |
| `MmcaCultureBootstrap` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/MmcaCultureBootstrap.cs:14` |
| `ServiceExceptionHelper` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ServiceExceptionHelper.cs:11` |
| `ThemeService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ThemeService.cs:16` |
| `UserPreferences` | record | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/UserPreferences.cs:9` |
| `UserPreferencesRequest` | record | MMCA.Common.UI | `MMCA.Common.UI.Services` | `MMCA.Common.UI/Services/ApiUserPreferenceWriter.cs:19` |
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
| `ChannelSubscription` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Notifications` | `MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:329` |
| `INotificationInboxUIService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Notifications` | `MMCA.Common.UI/Services/Notifications/INotificationInboxUIService.cs:9` |
| `IPushNotificationUIService` | interface | MMCA.Common.UI | `MMCA.Common.UI.Services.Notifications` | `MMCA.Common.UI/Services/Notifications/IPushNotificationUIService.cs:9` |
| `NotificationHubService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Notifications` | `MMCA.Common.UI/Services/Notifications/NotificationHubService.cs:24` |
| `NotificationInboxService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Notifications` | `MMCA.Common.UI/Services/Notifications/NotificationInboxService.cs:12` |
| `NotificationState` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Notifications` | `MMCA.Common.UI/Services/Notifications/NotificationState.cs:8` |
| `PushNotificationService` | class | MMCA.Common.UI | `MMCA.Common.UI.Services.Notifications` | `MMCA.Common.UI/Services/Notifications/PushNotificationService.cs:13` |
| `BrandColors` | class | MMCA.Common.UI | `MMCA.Common.UI.Theme` | `MMCA.Common.UI/Theme/BrandColors.cs:10` |
| `MMCATheme` | class | MMCA.Common.UI | `MMCA.Common.UI.Theme` | `MMCA.Common.UI/Theme/MMCATheme.cs:9` |
| `ComponentsPageE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/ComponentsPageE2ETests.cs:10` |
| `DarkModeE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/DarkModeE2ETests.cs:16` |
| `LoginPageE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/LoginPageE2ETests.cs:9` |
| `MobileTopRowE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/MobileTopRowE2ETests.cs:17` |
| `NotificationPagesE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/NotificationPagesE2ETests.cs:13` |
| `PseudoLocalizationE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/PseudoLocalizationE2ETests.cs:24` |
| `RegisterPageE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/RegisterPageE2ETests.cs:9` |
| `WebVitalsE2ETests` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests` | `MMCA.Common.UI.E2E.Tests/WebVitalsE2ETests.cs:16` |
| `GalleryAxeTestBase` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests.Infrastructure` | `MMCA.Common.UI.E2E.Tests/Infrastructure/GalleryAxeTestBase.cs:14` |
| `GalleryE2ECollection` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests.Infrastructure` | `MMCA.Common.UI.E2E.Tests/Infrastructure/GalleryE2ECollection.cs:11` |
| `GalleryHostFixture` | class | MMCA.Common.UI.E2E.Tests | `MMCA.Common.UI.E2E.Tests.Infrastructure` | `MMCA.Common.UI.E2E.Tests/Infrastructure/GalleryHostFixture.cs:17` |
| `GalleryHost` | class | MMCA.Common.UI.Gallery | `MMCA.Common.UI.Gallery` | `MMCA.Common.UI.Gallery/GalleryHost.cs:20` |
| `AnonymousAuthenticationStateProvider` | class | MMCA.Common.UI.Gallery | `MMCA.Common.UI.Gallery.Stubs` | `MMCA.Common.UI.Gallery/Stubs/AnonymousAuthenticationStateProvider.cs:11` |
| `GalleryUIModule` | class | MMCA.Common.UI.Gallery | `MMCA.Common.UI.Gallery.Stubs` | `MMCA.Common.UI.Gallery/Stubs/GalleryUIModule.cs:13` |
| `NoOpAuthUIService` | class | MMCA.Common.UI.Gallery | `MMCA.Common.UI.Gallery.Stubs` | `MMCA.Common.UI.Gallery/Stubs/NoOpAuthUIService.cs:12` |
| `NullTokenRefresher` | class | MMCA.Common.UI.Gallery | `MMCA.Common.UI.Gallery.Stubs` | `MMCA.Common.UI.Gallery/Stubs/NullTokenRefresher.cs:9` |
| `NullTokenStorageService` | class | MMCA.Common.UI.Gallery | `MMCA.Common.UI.Gallery.Stubs` | `MMCA.Common.UI.Gallery/Stubs/NullTokenStorageService.cs:10` |
| `StubNotificationInboxUIService` | class | MMCA.Common.UI.Gallery | `MMCA.Common.UI.Gallery.Stubs` | `MMCA.Common.UI.Gallery/Stubs/StubNotificationInboxUIService.cs:11` |
| `StubPushNotificationUIService` | class | MMCA.Common.UI.Gallery | `MMCA.Common.UI.Gallery.Stubs` | `MMCA.Common.UI.Gallery/Stubs/StubPushNotificationUIService.cs:11` |
| `DependencyInjection` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui` | `MMCA.Common.UI.Maui/DependencyInjection.cs:15` |
| `DeviceCapabilitiesInitializer` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui` | `MMCA.Common.UI.Maui/DeviceCapabilitiesInitializer.cs:15` |
| `HostingDependencyInjection` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui` | `MMCA.Common.UI.Maui/HostingDependencyInjection.cs:10` |
| `MauiAccessibilityAnnouncer` | class | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui.Capabilities` | `MMCA.Common.UI.Maui/Capabilities/MauiAccessibilityAnnouncer.cs:9` |
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
| `BunitTestBase` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests` | `MMCA.Common.UI.Tests/Components/BunitTestBase.cs:15` |
| `DeleteConfirmationTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/DeleteConfirmationTests.cs:17` |
| `EmptyStateTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/EmptyStateTests.cs:6` |
| `MmcaThemeProvidersTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/MmcaThemeProvidersTests.cs:19` |
| `MobileCardListTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/MobileCardListTests.cs:8` |
| `MobileInfiniteScrollListTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/MobileInfiniteScrollListTests.cs:11` |
| `NotificationBellTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/NotificationBellTests.cs:15` |
| `PageStateScopeTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/PageStateScopeTests.cs:12` |
| `PrimitivesSnapshotTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/PrimitivesSnapshotTests.cs:14` |
| `PrimitivesTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/PrimitivesTests.cs:6` |
| `RedirectToLoginTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Components` | `MMCA.Common.UI.Tests/Components/RedirectToLoginTests.cs:12` |
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
| `StubUiModule` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Layout` | `MMCA.Common.UI.Tests/Layout/NavMenuTests.cs:101` |
| `ForbiddenTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages` | `MMCA.Common.UI.Tests/Pages/ForbiddenTests.cs:10` |
| `AuthModelValidationTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Auth` | `MMCA.Common.UI.Tests/Pages/Auth/AuthModelValidationTests.cs:11` |
| `RegisterFormTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Auth` | `MMCA.Common.UI.Tests/Pages/Auth/RegisterFormTests.cs:16` |
| `DataGridListPageBaseTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Common` | `MMCA.Common.UI.Tests/Pages/Common/DataGridListPageBaseTests.cs:19` |
| `ErrorMessagesTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Common` | `MMCA.Common.UI.Tests/Pages/Common/ErrorMessagesTests.cs:12` |
| `OtherDomainException` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Common` | `MMCA.Common.UI.Tests/Pages/Common/ErrorMessagesTests.cs:77` |
| `TestGridPage` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Common` | `MMCA.Common.UI.Tests/Pages/Common/DataGridListPageBaseTests.cs:37` |
| `WidgetRow` | record | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Common` | `MMCA.Common.UI.Tests/Pages/Common/DataGridListPageBaseTests.cs:35` |
| `NotificationInboxTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Notifications` | `MMCA.Common.UI.Tests/Pages/Notifications/NotificationInboxTests.cs:18` |
| `NotificationListTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Notifications` | `MMCA.Common.UI.Tests/Pages/Notifications/NotificationListTests.cs:18` |
| `NotificationSendTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Pages.Notifications` | `MMCA.Common.UI.Tests/Pages/Notifications/NotificationSendTests.cs:17` |
| `ChildEntityServiceBaseTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/ChildEntityServiceBaseTests.cs:21` |
| `EntityServiceBaseTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/EntityServiceBaseTests.cs:24` |
| `ListPageQueryStateServiceTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/ListPageQueryStateServiceTests.cs:6` |
| `ListPageStateServiceTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/ListPageStateServiceTests.cs:8` |
| `MembershipService` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/ChildEntityServiceBaseTests.cs:23` |
| `Mocks` | record | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/ChildEntityServiceBaseTests.cs:33` |
| `Mocks` | record | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/EntityServiceBaseTests.cs:36` |
| `RecordingNavigationManager` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/ListPageQueryStateServiceTests.cs:264` |
| `ServiceExceptionHelperTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/ServiceExceptionHelperTests.cs:12` |
| `WasmFormFactorTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/WasmFormFactorTests.cs:13` |
| `WidgetDto` | record | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/EntityServiceBaseTests.cs:26` |
| `WidgetService` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services` | `MMCA.Common.UI.Tests/Services/EntityServiceBaseTests.cs:33` |
| `AuthDelegatingHandlerTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Auth` | `MMCA.Common.UI.Tests/Services/Auth/AuthDelegatingHandlerTests.cs:17` |
| `DirectApiTokenRefresherTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Auth` | `MMCA.Common.UI.Tests/Services/Auth/DirectApiTokenRefresherTests.cs:19` |
| `JwtAuthenticationStateProviderTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Auth` | `MMCA.Common.UI.Tests/Services/Auth/JwtAuthenticationStateProviderTests.cs:13` |
| `Mocks` | record | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Auth` | `MMCA.Common.UI.Tests/Services/Auth/DirectApiTokenRefresherTests.cs:21` |
| `Mocks` | record | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Auth` | `MMCA.Common.UI.Tests/Services/Auth/WasmTokenStorageServiceTests.cs:17` |
| `SameOriginProxyTokenRefresherTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Auth` | `MMCA.Common.UI.Tests/Services/Auth/SameOriginProxyTokenRefresherTests.cs:14` |
| `WasmTokenStorageServiceTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Auth` | `MMCA.Common.UI.Tests/Services/Auth/WasmTokenStorageServiceTests.cs:15` |
| `CapabilityFallbackTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Capabilities` | `MMCA.Common.UI.Tests/Services/Capabilities/CapabilityFallbackTests.cs:12` |
| `DeepLinkDispatcherTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Capabilities` | `MMCA.Common.UI.Tests/Services/Capabilities/DeepLinkDispatcherTests.cs:11` |
| `ReturnUrlProtectorTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Navigation` | `MMCA.Common.UI.Tests/Services/Navigation/ReturnUrlProtectorTests.cs:6` |
| `Mocks` | record | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Notifications` | `MMCA.Common.UI.Tests/Services/Notifications/NotificationInboxServiceTests.cs:25` |
| `Mocks` | record | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Notifications` | `MMCA.Common.UI.Tests/Services/Notifications/PushNotificationServiceTests.cs:23` |
| `NotificationHubServiceTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Notifications` | `MMCA.Common.UI.Tests/Services/Notifications/NotificationHubServiceTests.cs:23` |
| `NotificationInboxServiceTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Notifications` | `MMCA.Common.UI.Tests/Services/Notifications/NotificationInboxServiceTests.cs:23` |
| `NotificationStateTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Notifications` | `MMCA.Common.UI.Tests/Services/Notifications/NotificationStateTests.cs:11` |
| `PushNotificationServiceTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Services.Notifications` | `MMCA.Common.UI.Tests/Services/Notifications/PushNotificationServiceTests.cs:21` |
| `BrandColorTokenTests` | class | MMCA.Common.UI.Tests | `MMCA.Common.UI.Tests.Theme` | `MMCA.Common.UI.Tests/Theme/BrandColorTokenTests.cs:15` |
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
| `IServiceCollection services` | MMCA.ADC.Conference.API | `MMCA.ADC.Conference.API/DependencyInjection.cs:16` |
| `IServiceCollection services` | MMCA.ADC.Conference.Application | `MMCA.ADC.Conference.Application/DependencyInjection.cs:36` |
| `IServiceCollection services` | MMCA.ADC.Conference.Contracts | `MMCA.ADC.Conference.Contracts/DependencyInjection.cs:17` |
| `IServiceCollection services` | MMCA.ADC.Conference.Infrastructure | `MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:14` |
| `IServiceCollection services` | MMCA.ADC.Conference.UI | `MMCA.ADC.Conference.UI/DependencyInjection.cs:13` |
| `IServiceCollection services` | MMCA.ADC.Engagement.API | `MMCA.ADC.Engagement.API/DependencyInjection.cs:16` |
| `IServiceCollection services` | MMCA.ADC.Engagement.Application | `MMCA.ADC.Engagement.Application/DependencyInjection.cs:29` |
| `IServiceCollection services` | MMCA.ADC.Engagement.Contracts | `MMCA.ADC.Engagement.Contracts/DependencyInjection.cs:18` |
| `IServiceCollection services` | MMCA.ADC.Engagement.Infrastructure | `MMCA.ADC.Engagement.Infrastructure/DependencyInjection.cs:10` |
| `IServiceCollection services` | MMCA.ADC.Engagement.UI | `MMCA.ADC.Engagement.UI/DependencyInjection.cs:15` |
| `IServiceCollection services` | MMCA.ADC.Identity.API | `MMCA.ADC.Identity.API/DependencyInjection.cs:17` |
| `IServiceCollection services` | MMCA.ADC.Identity.Application | `MMCA.ADC.Identity.Application/DependencyInjection.cs:19` |
| `IServiceCollection services` | MMCA.ADC.Identity.Contracts | `MMCA.ADC.Identity.Contracts/DependencyInjection.cs:16` |
| `IServiceCollection services` | MMCA.ADC.Identity.Infrastructure | `MMCA.ADC.Identity.Infrastructure/DependencyInjection.cs:13` |
| `IServiceCollection services` | MMCA.ADC.Identity.UI | `MMCA.ADC.Identity.UI/DependencyInjection.cs:13` |
| `IServiceCollection services` | MMCA.ADC.Notification.API | `MMCA.ADC.Notification.API/DependencyInjection.cs:15` |
| `IServiceCollection services` | MMCA.ADC.Notification.Application | `MMCA.ADC.Notification.Application/DependencyInjection.cs:14` |
| `IServiceCollection services` | MMCA.ADC.Notification.Contracts | `MMCA.ADC.Notification.Contracts/DependencyInjection.cs:18` |
| `IServiceCollection services` | MMCA.Common.API | `MMCA.Common.API/Authentication/ExternalAuthExtensions.cs:31` |
| `IServiceCollection services` | MMCA.Common.API | `MMCA.Common.API/Authorization/AuthorizationExtensions.cs:14` |
| `OutputCacheOptions options` | MMCA.Common.API | `MMCA.Common.API/Caching/OutputCacheOptionsExtensions.cs:8` |
| `IServiceCollection services` | MMCA.Common.API | `MMCA.Common.API/DependencyInjection.cs:26` |
| `AuthenticationBuilder builder` | MMCA.Common.API | `MMCA.Common.API/SessionCookies/SessionCookieAuthenticationHandler.cs:92` |
| `IEndpointRouteBuilder endpoints` | MMCA.Common.API | `MMCA.Common.API/Startup/AppAssociationEndpointExtensions.cs:26` |
| `IEndpointRouteBuilder endpoints` | MMCA.Common.API | `MMCA.Common.API/Startup/JwksEndpointExtensions.cs:23` |
| `IServiceCollection services` | MMCA.Common.API | `MMCA.Common.API/Startup/MiniProfilerExtensions.cs:11` |
| `IEndpointRouteBuilder endpoints` | MMCA.Common.API | `MMCA.Common.API/Startup/OidcDiscoveryEndpointExtensions.cs:50` |
| `WebApplication app` | MMCA.Common.API | `MMCA.Common.API/Startup/OpenApiEndpointExtensions.cs:20` |
| `WebApplication app` | MMCA.Common.API | `MMCA.Common.API/Startup/SignalRExtensions.cs:14` |
| `IServiceCollection services` | MMCA.Common.API | `MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:71` |
| `WebApplication app` | MMCA.Common.API | `MMCA.Common.API/Startup/WebApplicationExtensions.cs:37` |
| `IServiceCollection services` | MMCA.Common.Application | `MMCA.Common.Application/DependencyInjection.cs:23` |
| `ValidationResult result` | MMCA.Common.Application | `MMCA.Common.Application/Extensions/ValidationFailureExtensions.cs:11` |
| `IServiceCollection services` | MMCA.Common.Application | `MMCA.Common.Application/Notifications/DependencyInjection.cs:29` |
| `Type entityType` | MMCA.Common.Domain | `MMCA.Common.Domain/Extensions/EntityTypeExtensions.cs:11` |
| `IServiceCollection services` | MMCA.Common.Grpc | `MMCA.Common.Grpc/DependencyInjection.cs:18` |
| `IServiceCollection services` | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure/DependencyInjection.cs:40` |
| `IBusRegistrationConfigurator x` | MMCA.Common.Infrastructure | `MMCA.Common.Infrastructure/Services/IntegrationEventConsumerExtensions.cs:13` |
| `string? id` | MMCA.Common.Shared | `MMCA.Common.Shared/Extensions/DomainHelper.cs:13` |
| `IServiceCollection services` | MMCA.Common.UI | `MMCA.Common.UI/DependencyInjection.cs:21` |
| `IApplicationBuilder app` | MMCA.Common.UI | `MMCA.Common.UI/Extensions/WebApplicationExtensions.cs:11` |
| `IServiceCollection services` | MMCA.Common.UI | `MMCA.Common.UI/Notifications/DependencyInjection.cs:13` |
| `IServiceCollection services` | MMCA.Common.UI | `MMCA.Common.UI/Services/Capabilities/DependencyInjection.cs:18` |
| `IServiceCollection services` | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui/DependencyInjection.cs:17` |
| `MauiAppBuilder builder` | MMCA.Common.UI.Maui | `MMCA.Common.UI.Maui/HostingDependencyInjection.cs:12` |
| `IServiceCollection services` | MMCA.Common.UI.Web | `MMCA.Common.UI.Web/DependencyInjection.cs:16` |

## Generated / excluded artifacts (no type sections written)

68 files excluded as generated (EF migrations, snapshots, *.g.cs, AssemblyInfo).

| File |
|------|
| `MMCA.ADC.Migrations.SqlServer.Conference/DesignTimeSQLServerDbContextFactory.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260606053146_InitialCreate.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260606053146_InitialCreate.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260609123507_AddInboxMessages.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260609123507_AddInboxMessages.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260710011421_AddEventQuestionModerationDefault.cs` |
| `MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260710011421_AddEventQuestionModerationDefault.Designer.cs` |
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
| `MMCA.ADC.Migrations.SqlServer.Identity/Migrations/SQLServerDbContextModelSnapshot.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/DesignTimeSQLServerDbContextFactory.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260606053154_InitialCreate.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260606053154_InitialCreate.Designer.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260609123517_AddInboxMessages.cs` |
| `MMCA.ADC.Migrations.SqlServer.Notification/Migrations/20260609123517_AddInboxMessages.Designer.cs` |
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
