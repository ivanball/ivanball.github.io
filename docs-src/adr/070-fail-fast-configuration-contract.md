# ADR-070: Fail-Fast Configuration Contract

## Status
Accepted (2026-08-07). Revised 2026-08-14 (source citations re-anchored). Revised 2026-08-23
(inventory re-counted after the password-reset vertical and the opt-in feature waves: twelve validated
chains in the Infrastructure package and sixteen framework registrations in all, six framework
bindings deliberately off the chain, and a custom `IValidateOptions<T>` in use). Revised 2026-08-31
(the two host-owned sections now bind through the shared `AddModuleHost` call in seven of the eight
hosts instead of an inline chain per host; source citations re-anchored). Revised 2026-09-01
(inventory re-counted: fifteen validated chains in the Infrastructure package and twenty framework
registrations in all, eight framework bindings deliberately off the chain, and two custom
`IValidateOptions<T>` in use; source citations re-anchored). Revised 2026-09-03 (the two cache sections
are reached through the `AddCaching` call `AddInfrastructure` makes rather than an opt-in method, so
eleven of the fifteen Infrastructure chains ship to every host and four are opt-in; the exception count
in the consumer-host paragraph corrected to eight; source citations re-anchored). Revised 2026-09-19
(inventory re-counted after the internal-commands, two-factor, email-confirmation, stored-permission-grant,
AI, CSP and health-report-cache waves: nineteen validated chains in the Infrastructure package, twelve of
them reaching every host and seven opt-in, and twenty-seven framework registrations in all; nine framework
bindings deliberately off the chain; two settings types implementing `IValidatableObject` and three custom
`IValidateOptions<T>` in use). Revised 2026-09-25 (both Identity `AuthenticationService` classes take
their two `IOptions<T>` injections directly; neither app has a settings carrier class any longer).

## Context
Every host in the workspace reads a dozen or more configuration sections: connection strings, SMTP,
JWT key material, outbox tuning, message-bus provider, module enablement, page-size limits. A settings
value can go wrong in two places. It can be discovered at **first use**, where a missing SMTP host
becomes a 500 on the first password-reset mail and an unparseable outbox interval becomes a background
loop that never drains, both on a replica that already passed its readiness probe and is taking live
traffic. Or it can be discovered at **boot**, where the host refuses to start and the platform never
routes to it.

Nothing in the record decided which. ADR-025 gates a replica out of rotation until warm-up has had its
chance, but warm-up runs only on a host that started. ADR-031 decides that feature flags are read from
configuration without saying what happens when the section is absent. ADR-061 decides where a secret
*value* comes from at runtime, not what a host does when the value never arrives.

A second, related question had no recorded answer: how code below the host reaches a bound setting. The
options pipeline is a Microsoft.Extensions.Options concern, and a layer that is supposed to be free of
hosting concerns taking an `IOptions<T>` constructor parameter drags that pipeline into it.

## Decision
**Bind every settings section through a validating chain that runs at startup, and read the bound
value through `IOptions<T>` of the concrete settings class.**

- **One binding shape, used everywhere.**
  `AddOptions<T>().Bind(configuration.GetSection(T.SectionName)).ValidateDataAnnotations().ValidateOnStart()`
  is the required form (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:71-74`).
  `.BindConfiguration(T.SectionName)` is the accepted shorthand for the `Bind(GetSection(...))` step and
  is what Store's Sales module uses for all six of the sections it binds
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/SalesModule.cs:51-54`, `:56-59`, `:61-64`,
  `:66-69`, `:76-79`, `:81-84`).
  `ValidateOnStart()` is the load-bearing link: without it the annotations are evaluated lazily on first
  resolution, which is exactly the first-use failure the contract exists to prevent.
- **The framework owns the base set.** Nineteen sections are bound this way in the Infrastructure package's
  `DependencyInjection` partial class, which spans `DependencyInjection.cs` and its `.Caching`, `.Auth`,
  `.Jobs` and `.Notifications` parts. Nine sit directly inside `AddInfrastructure` (the method starting at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:56`; `ConnectionStringSettings`
  `:71-74`, `SmtpSettings` `:92-95`, `PersistenceSettings` `:138-141`, `OutboxSettings` `:143-146`,
  `LoginProtectionSettings` `:148-151`, `PasswordResetSettings` `:154-157`, `RefreshSessionSettings`
  `:162-165`, `MessageBusSettings` `:177-180`, `JwksSettings` `:182-185`), a tenth arrives through the
  private `AddInternalCommands` helper that `AddInfrastructure` calls (`:222`): `InternalCommandsSettings`
  (`DependencyInjection.Jobs.cs:148-152`, the helper starting at `:146`), and two more arrive through the
  `services.AddCaching(configuration)` call that `AddInfrastructure` itself makes (`:134`):
  `CacheSettings` (`DependencyInjection.Caching.cs:43-46`) and `QueryCachePipelineSettings` (`:48-51`).
  Those twelve reach every host that registers the package. The remaining seven sit in opt-in registration
  methods a host calls only when it wants the feature: `SchedulerSettings` in `AddScheduledJobs`
  (`DependencyInjection.Jobs.cs:39-42`), `TwoFactorSettings` in `AddTwoFactorAuthentication`
  (`DependencyInjection.Auth.cs:41-44`), `EmailConfirmationSettings` in `AddEmailConfirmation`
  (`DependencyInjection.Auth.cs:69-72`), `PermissionGrantSettings` in `AddStoredPermissionGrants`
  (`DependencyInjection.Auth.cs:110-113`), `AuditTrailSettings` in `AddAuditTrail`
  (`DependencyInjection.Jobs.cs:110-113`), `TenancySettings` in `AddMultiTenancy`
  (`DependencyInjection.cs:268-271`), and `PushNotificationSettings` in `AddPushNotifications`
  (`DependencyInjection.Notifications.cs:43-46`). The two cache sections take the chain only when the
  caller passes configuration: `AddCaching` takes an optional `IConfiguration`
  (`DependencyInjection.Caching.cs:26`) and, called without one, registers both unbound (`:55-56`), so
  `IOptions<T>` resolves to the compiled-in defaults instead of failing a caller that configures no cache
  section at all. Twelve more are bound outside the Infrastructure package: `IdempotencySettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:77-80`), `JwtSettings`, bound
  inside `AddCommonAuthentication`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:146-149`,
  the method starting at `:144`), `RateLimitingSettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:353`),
  `ApiSettings` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:39-42`),
  `GatewayRateLimitingSettings`, bound by the Aspire hosting package's `AddGatewayRateLimiting`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Gateway/GatewayRateLimitingExtensions.cs:273-276`),
  `GatewaySettings`, bound by the Gateway package's `AddMmcaGateway`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Gateway/GatewayReverseProxyExtensions.cs:54-57`), `AiSettings`
  (`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:123-126`), `ContentPolicySettings`
  (`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/GuardrailServiceCollectionExtensions.cs:67-70`),
  `BlazorCspSettings` (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:54-56`),
  `BlazorCircuitLimitSettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitExtensions.cs:55-58`),
  `UiRateLimitingSettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hardening/UiRateLimitingExtensions.cs:164-167`), and
  `HealthReportCacheOptions`, bound by the Aspire hosting package
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Health.cs:33-36`).
  Thirty-one framework registrations in all.
- **Each service host adds exactly two of its own**, `ApplicationSettings` and `ModulesSettings`, and the
  same pair of chains covers all eight hosts across the three application repos. Seven of the eight reach
  them through one shared framework call rather than an inline copy: `AddModuleHost` binds and validates
  both sections before it builds the host's `ModuleLoader`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/ModuleHostExtensions.cs:61-64` and `:69-72`,
  the method starting at `:51`), so ADC's four services
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:365-367`, and the comment at `:356`
  says what the call binds) and Store's three
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:124-126`) each declare the two
  sections in a single line of host code. The Helpdesk monolith seed still writes both chains out in its
  own `Program.cs` (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:19-22` and `:94-97`), which is
  exactly what the shared call expands to, so the contract reads the same whether a host takes the helper
  or spells it out. Modules may add their own sections on the same chain, as Store's Sales module does for
  Stripe.
- **Validation is data annotations, extended by `IValidatableObject` where a rule spans fields.**
  `JwtSettings` marks `Issuer` and `Audience` `[Required]`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:53-58`) and implements
  `IValidatableObject` (`:16`) so key material is checked conditionally on the selected algorithm:
  RS256 (the default) demands `RsaPrivateKeyPem`, HS256 demands a `SecretForKey` of at least 32
  characters (`:70-85`). `ValidateDataAnnotations()` invokes that method, so a host configured for
  RS256 with no private key fails to boot rather than failing to sign its first token.
- **`IOptions<T>` of the concrete settings class is the one resolution surface.** Code that needs a
  bound section takes it at the point of use: `TokenService` takes `IOptions<JwtSettings>`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:72`) beside an optional
  `IOptions<JwksSettings>` that names the signing key in the token's `kid` header (`:76`), both of
  `SmtpEmailSender`'s constructors take `IOptions<SmtpSettings>` (`.../Mail/SmtpEmailSender.cs:29` and
  `:50`), `RepositoryFactory` takes
  `IOptions<ApplicationSettings>`
  (`.../Persistence/Repositories/Factory/RepositoryFactory.cs:15`), and `EntityControllerBase` resolves
  the same options per request in its `MaxPageSize` and `MaxExportRows` accessors
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:63` and `:83`).
  Settings classes declare `get`/`init` members
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Mail/SmtpSettings.cs:18-59`), so the value a
  consumer reads is one it cannot rebind, and there is no second type per section to keep in step with
  the class the chain binds and validates. Two framework types keep a public setter:
  `ModuleSettings.RemoteDependencies`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModuleSettings.cs:38`, with CA2227
  suppressed at `:37` because configuration binding needs it) and the three members of
  `OwnerOrAdminFilterOptions`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:16`,
  `:24`, `:31`).
- **Nine recorded exceptions in the framework, seven of them on one shared reason: an absent section is a
  working default, not a misconfiguration.** `CacheKeyPrefixOptions` is bound with a bare `services.Configure`
  and no validation, because an absent section must leave cache keys exactly as callers write them (a
  single call inside `AddCaching`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:41`, the method
  starting at `:26`).
  `LayoutSettings` binds with `AddOptions().Bind()` and nothing after it for the same reason: it is
  optional footer copy (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:45-46`),
  and the two client-side sections registered beside it bind exactly the same way because an absent
  section leaves the compiled-in defaults: the staleness policy `UiReadCacheOptions` (`:50-51`) and
  `NotificationBellOptions` (`:53-54`).
  `NativePushSettings` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Notifications.cs:84-85`)
  and `FileStorageSettings` (`:116-117`) bind the same way inside their opt-in registration methods,
  both of which read the section back and turn themselves into a no-op when it is absent or incomplete,
  so a host registers them unconditionally and switches the feature on by configuration alone.
  `SecurityHeadersSettings` binds through an options builder that calls `.Bind` only when configuration
  was supplied at all, because the same call accepts a code-only `Action<SecurityHeadersSettings>`
  instead (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs:252-261`, the
  method starting at `:246`).
  `DataSourcesSettings` is the one exception with a mechanical rather than a policy reason: it is
  constructed directly from the section rather than through `AddOptions`, because a root-level dictionary
  section does not bind through the options pipeline
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:86-88`).
  `OwnerOrAdminFilterOptions` is the ninth and keeps more of the chain than the rest: it binds with
  `ValidateDataAnnotations()` and drops only `ValidateOnStart`, because its required `BypassRole` has no
  framework default (the framework knows no role names), so validating at startup would fail every host
  that never applies the filter, while validating on first resolve puts the annotation message in front of
  the host that actually uses it
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:91-92`, the reason at `:87-90`).
- **Consumer hosts take the same escape twice, and write the reason at the call site.** ADC's Engagement
  service binds `PointsSettings`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:124-125`) and `CheckInSettings`
  (`:131-132`) without `ValidateOnStart`: the defaults are working values and an explicit zero is the
  documented per-rule kill switch, so no value an organizer could set should stop that host from booting
  mid-conference. Both follow the rule the framework's nine follow: an exception is legitimate when the
  section has no invalid value, and the reason belongs in a comment beside the binding rather than left
  to be inferred from its absence.

**Every layer reads a bound section the same way.** Inside Infrastructure and API that is a constructor
or per-request `IOptions<T>`: `OutboxProcessor`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:60`),
`BrokerEventBus` (`.../Messaging/BrokerEventBus.cs:35`), `LoginProtectionService`
(`.../Auth/LoginProtectionService.cs:21`), `RsaJwksProvider` (`.../Auth/RsaJwksProvider.cs:14`),
`SQLServerDbContext` (`.../Persistence/DbContexts/SQLServerDbContext.cs:36`), and `IdempotencyFilter`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:443`), and so does the
framework's `/client-config` minimal-API handler, which reads `IOptions<ApiSettings>`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/ClientConfig/ClientConfigEndpointExtensions.cs:51`)
and which ADC's web host maps with `app.MapClientConfigEndpoint`
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:247`). Consumer code reads its own sections the
same way: Store's Sales Infrastructure in `StripeClientFactory.cs:37`, `StripePaymentService.cs:63` (and
`:67`), `StripeWebhookRegistrationService.cs:37`, `PaymentReconciliationService.cs:71-72`,
`DenormalizationBackfillService.cs:40` and `OrderFulfilledBackfillService.cs:39`.

The Application layer names the options pipeline too, and the framework supplies five of those
injections itself, across four classes: `AuthenticationServiceBase<TUser>` takes
`IOptions<RefreshSessionSettings>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:82`) and an optional
`IOptions<EmailConfirmationSettings>` beside it (`:84`), the shared
`ForgotPasswordHandlerBase` takes `IOptions<PasswordResetSettings>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:40`),
`SendEmailConfirmationHandlerBase` takes `IOptions<EmailConfirmationSettings>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/EmailConfirmation/SendEmailConfirmationHandlerBase.cs:44`),
and `CachingQueryDecorator` takes an optional `IOptions<QueryCachePipelineSettings>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:48`).
ADC adds six classes: its Identity `AuthenticationService` takes the two injections it forwards to
the base constructor directly, `IOptions<RefreshSessionSettings>` and
`IOptions<EmailConfirmationSettings>`
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:57-58`),
and the other five take one each:
`ForgotPasswordHandler` (`.../Users/UseCases/ForgotPassword/ForgotPasswordHandler.cs:25`),
`SendEmailConfirmationHandler`
(`.../Users/UseCases/SendEmailConfirmation/SendEmailConfirmationHandler.cs:31`), and in
Engagement `PointsAwarder`
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/Points/Services/PointsAwarder.cs:31`),
`GetLeaderboardHandler` (`.../Points/UseCases/GetLeaderboard/GetLeaderboardHandler.cs:30`) and
`RecordRoomCheckInHandler` (`.../CheckIns/UseCases/RecordRoomCheckIn/RecordRoomCheckInHandler.cs:32`).
Store adds ten, with the same shape: its Identity `AuthenticationService` takes the same two
injections directly
(`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs:33-34`),
plus
`ForgotPasswordHandler` (`.../Users/UseCases/ForgotPassword/ForgotPasswordHandler.cs:26`),
`SendEmailConfirmationHandler`
(`.../Users/UseCases/EmailConfirmation/SendEmailConfirmationHandler.cs:32`),
`CreateCheckoutSessionCommandValidator`
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/CreateCheckoutSession/CreateCheckoutSessionCommandValidator.cs:22`),
`CheckOutDeadlineScheduler` (`.../ShoppingCarts/UseCases/CheckOut/CheckOutDeadlineScheduler.cs:27`),
`ExpireUnpaidOrderInternalCommandHandler`
(`.../Orders/InternalCommands/ExpireUnpaidOrderInternalCommandHandler.cs:35`),
`OrderPaymentFailedSagaHandler`, which is the one site that resolves its
`IOptions<UnpaidOrderExpirySettings>` from a scope rather than taking it in the constructor
(`.../Orders/Saga/OrderPaymentFailedSagaHandler.cs:72`), and in Catalog three classes that take
`IOptions<StoreTimeZoneSettings>`: `ProductVariantDTOMapper`, optionally
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Products/DTOs/ProductVariantDTOMapper.cs:29`),
`SetProductDiscountHandler` (`.../Products/UseCases/SetProductDiscount/SetProductDiscountHandler.cs:22`)
and `SetVariantDiscountHandler` (`.../Products/UseCases/SetVariantDiscount/SetVariantDiscountHandler.cs:23`).
Only Helpdesk's Application layer names no `IOptions` at all.

The contract is therefore one rule rather than two: the **fail-fast chain is mandatory for every
section** other than the exceptions recorded above, and **`IOptions<T>` at the point of consumption is
how every layer reads the result**, Application included. The injections listed above are conformant,
not debt. `PasswordResetSettings` shows what the single surface buys: the framework's own base class
takes it and both consumer handlers forward their `IOptions<PasswordResetSettings>` straight into that
base constructor (ADC at
`.../MMCA.ADC.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandler.cs:27`, Store at
`.../MMCA.Store.Identity.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandler.cs:28`), so
what the handler reads is the one instance the host bound and validated at boot, with nothing in
between to fall out of step with it.

## Rationale
- **A boot failure is cheaper than a first-use failure.** A host that will not start is caught by the
  deployment, by a local `dotnet run`, or by CI. A host that starts and fails on the first mail send is
  caught by a user, on a replica the platform already considers healthy.
- **`ValidateOnStart` is the whole point of the chain.** `ValidateDataAnnotations()` alone defers
  evaluation to first resolution, which for a section only a background service reads can be minutes
  after the replica takes traffic. Pairing the two is what converts "configured wrong" into "did not
  start".
- **Validation belongs on the settings type.** Annotations plus `IValidatableObject` keep the rule next
  to the property it constrains, so `JwtSettings` can express "RS256 requires a private key" once instead
  of every host re-checking it.
- **One options surface, validated once.** A read-only alias interface per settings class would be a
  second type to keep in step with the class the chain binds, and a second way for a reader to ask the
  same question. `IOptions<T>` of the concrete class is the one surface a consumer sees, the `init`-only
  members (everywhere but the two setter-bearing types named above) are what make the value unwritable
  at the point of use, and the validation that ran at boot
  covers every reader because there is only one bound instance to read.
- **One shape makes the contract auditable.** Because every chain ends in `ValidateOnStart()`,
  even where it varies (`BlazorCspSettings` drops `ValidateDataAnnotations()`,
  `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:54-56`; `RateLimitingSettings`
  writes the chain on one line,
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:353`;
  Store's `StoreTimeZoneSettings` inserts a delegate `.Validate(...)`,
  `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/CatalogModule.cs:40-44`), a grep for
  `ValidateOnStart` is a complete inventory of what a host validates at boot: the
  thirty-one framework registrations, plus whatever the host and its modules add. Collapsing the two
  host-owned sections into `AddModuleHost` shortens that inventory rather than hiding it, since the pair
  is now read once in the framework instead of eight times across the repos.

## Trade-offs
- **Nothing enforces it.** There is no architecture fitness test asserting that a new `AddOptions<T>` call
  carries `ValidateDataAnnotations().ValidateOnStart()`. The uniformity above is convention held by review,
  not a gate, which is weaker than the invariant-over-discipline posture ADR-015 applies elsewhere. A
  section added without the chain fails silently, which is to say it fails later. Nine framework bindings
  and two consumer-host bindings sit off the chain by choice, and nothing in the build distinguishes
  those from a section whose author simply forgot: only the comment beside each one does.
- **Bad configuration becomes a crash loop, not a degraded start.** A deployed replica with a missing
  required value never reaches the warm-up and readiness machinery of ADR-025: it terminates at host build.
  That is the intended trade (no half-configured replica serves traffic), but it means a configuration
  mistake takes the whole rollout rather than one code path.
- **The options pipeline reaches every layer.** With `IOptions<T>` as the one surface,
  `Microsoft.Extensions.Options` appears in Application-layer constructor signatures as readily as in
  Infrastructure ones. The alternative buys that purity with an alias type per settings class, and this
  record takes the pipeline over the second type.
- **Data annotations are the vocabulary.** Anything richer needs `IValidatableObject` or a custom
  `IValidateOptions<T>`, and both escape hatches are in use in the framework: the former three times, the
  latter four times. `JwtSettings` implements `IValidatableObject`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:16`), and so do `AiSettings`
  (`MMCA.Common/Source/Core/MMCA.Common.AI/AiSettings.cs:22`), whose section is bound with the full chain
  (`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:123-126`), and `ContentPolicySettings`
  (`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ContentPolicySettings.cs:23`). Four validator
  classes sit beside a chain instead, each registered with `TryAddEnumerable` so two modules calling the
  same registration method cannot run the validation twice.
  `AiProviderValidator`
  (`MMCA.Common/Source/Core/MMCA.Common.AI/Providers/AiProviderValidator.cs:16`, registered at
  `MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:94`) exists because whether the
  configured provider names a registered `IAiProviderFactory` depends on what the host registered, which
  no annotation on `AiSettings` can see.
  `TenancySettingsValidator`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettingsValidator.cs:23-24`,
  registered at `DependencyInjection.cs:274-275`) exists because confirming that a tenant's data-source
  override names a real physical source needs `IDataSourceResolver`, which no annotation can reach.
  `ConnectionStringSettingsValidator`
  (`.../Persistence/DataSources/ConnectionStringSettingsValidator.cs:30-31`,
  registered at `DependencyInjection.cs:81-82`) exists because the "a host must reach some database" rule
  spans two sections at once, `ConnectionStrings` and `DataSources`, so a SQLite-only host that declares
  its databases as named sources is legitimate while a host declaring none anywhere is not.
  `BlazorCspSettingsValidator`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspSettingsValidator.cs:13`,
  registered at `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:58-60` beside
  the `BlazorCspSettings` chain at `:54-56`) exists because a configured CSP source has to be screened for
  the characters that would break out of a source expression or widen a directive, which is a rule about
  the shape of each entry in a collection rather than about a single property. The cost of
  the second form is that the rule
  leaves the settings type and has to be registered separately, so a host that binds the section without
  also registering the validator validates less than it appears to. Store uses both forms on its own
  sections: a separate `PaymentReconciliationSettingsValidator`, registered with `TryAddEnumerable`
  beside its chain (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/SalesModule.cs:73-74`), and an
  inline `.Validate(...)` delegate on the `StoreTimeZoneSettings` chain
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/CatalogModule.cs:43`).
- **A bound value is a snapshot.** `IOptions<T>` captures the instance built at binding time and never
  observes a configuration reload. A section that genuinely needs reload would have to move to
  `IOptionsMonitor<T>`, and none does today.

## Revision (2026-10-01)
No decision or rationale changed; the inventory and several descriptions were brought back in line with
source. The framework now has thirty-one registrations on the chain rather than twenty-seven: a grep finds
33 `ValidateOnStart()` calls under `MMCA.Common/Source`, two of them the host-owned pair in
`ModuleHostExtensions.cs:61-64` and `:69-72`, and the four new ones are `RateLimitingSettings`
(`WebApplicationBuilderExtensions.RateLimiting.cs:353`), `ContentPolicySettings`
(`GuardrailServiceCollectionExtensions.cs:67-70`), `BlazorCircuitLimitSettings`
(`BlazorCircuitLimitExtensions.cs:55-58`) and `UiRateLimitingSettings`
(`UiRateLimitingExtensions.cs:164-167`), so twelve sections now bind outside the Infrastructure package.
The Infrastructure `DependencyInjection` class is a partial split across five files, and `AddCaching` is
one method with an optional `IConfiguration` (`DependencyInjection.Caching.cs:26`) rather than two
overloads. The "`get`/`init` members only" statement now names its two exceptions
(`ModuleSettings.cs:38`, `OwnerOrAdminFilterOptions.cs:16`). The Rationale no longer calls the chain
textually identical, since three variants exist. The escape-hatch counts are now three
`IValidatableObject` types and four framework validators (`AiProviderValidator.cs:16` is new), plus
Store's validator and inline delegate. The `/client-config` read moved from ADC's host into the framework
(`ClientConfigEndpointExtensions.cs:51`), Store's `CheckOutHandler` no longer takes `IOptions` (its
injection is in `CheckOutDeadlineScheduler.cs:27`), and Store's Application layer now names ten classes.
Every other citation was re-anchored in place.

## Related
ADR-025 (startup warm-up and readiness gating: this contract decides what happens *before* a host reaches
that machinery), ADR-031 (feature flags read from configuration, whose section this contract governs the
binding of), ADR-061 (where a secret value comes from at runtime; this decides what the host does when it
does not arrive), ADR-015 (architecture fitness functions, the enforcement mechanism this contract
currently lacks).
