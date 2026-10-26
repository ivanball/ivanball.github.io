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
Revised 2026-10-01 (inventory re-counted: thirty-one framework registrations; three `IValidatableObject`
types and four custom validators; source citations re-anchored). Revised 2026-10-06 (inventory re-counted:
thirty-three framework registrations with `SecurityHeadersSettings` and `SameOriginApiProxySettings` now on
the chain, eleven framework bindings deliberately off it, five custom `IValidateOptions<T>`, and each
Identity `AuthenticationService` now takes a single `IOptions<T>`; source citations re-anchored).
Revised 2026-10-07: `LegalAcceptanceOptions` now states its off-chain reason in a comment at the call
site rather than only in XML remarks, and anchors were refreshed after the v1.233.0 release.
Revised 2026-10-21: inventory re-counted to thirty-five framework registrations (`ServiceTokenSettings`
and the `DefaultSchemeGuard` marker added), four `IValidatableObject` types and six custom validators
(`GatewaySettingsValidator` added), seven ADC Application injections, and get-only collections noted
on `SameOriginApiProxySettings`; source citations re-anchored.
Revised 2026-10-26: inventory re-counted to thirty-seven framework registrations (the
`CloudAdapterTripwireOptions` and `HostIntegrationTripwireOptions` startup-tripwire markers added),
eight custom validators, and fifteen framework exceptions now that the cloud adapter packages bind six
vendor sections off the chain in place of `NativePushSettings` and `FileStorageSettings`; source
citations re-anchored; the `NativePush:Enabled` tripwire also fails an incomplete push section, the SNS
and FCM push settings bind only once push is enabled and complete, and registration-time `Get<T>()`
reads never placed in the container are stated as outside the exception inventory.

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
  is the required form (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:72-75`).
  `.BindConfiguration(T.SectionName)` is the accepted shorthand for the `Bind(GetSection(...))` step and
  is what Store's Sales module uses for all six of the sections it binds
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/SalesModule.cs:51-54`, `:56-59`, `:61-64`,
  `:66-69`, `:76-79`, `:81-84`).
  `ValidateOnStart()` is the load-bearing link: without it the annotations are evaluated lazily on first
  resolution, which is exactly the first-use failure the contract exists to prevent.
- **The framework owns the base set.** Nineteen sections are bound this way in the Infrastructure package's
  `DependencyInjection` partial class, which spans `DependencyInjection.cs` and its `.Caching`, `.Auth`,
  `.Jobs`, `.Notifications` and `.Messaging` parts (the last holds `AddBrokerMessaging`,
  `DependencyInjection.Messaging.cs:48`, which registers no options chain of its own and reads the
  `MessageBus` section back with a plain `Get<MessageBusSettings>()` at `:54` to pick the transport; the
  validated chain for that section is the one in `AddInfrastructure`). Nine sit directly inside `AddInfrastructure`
  (the method starting at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:57`; `ConnectionStringSettings`
  `:72-75`, `SmtpSettings` `:98-101`, `PersistenceSettings` `:144-147`, `OutboxSettings` `:149-152`,
  `LoginProtectionSettings` `:154-157`, `PasswordResetSettings` `:160-163`, `RefreshSessionSettings`
  `:168-171`, `MessageBusSettings` `:192-195`, `JwksSettings` `:197-200`), a tenth arrives through the
  private `AddInternalCommands` helper that `AddInfrastructure` calls (`:252`): `InternalCommandsSettings`
  (`DependencyInjection.Jobs.cs:148-152`, the helper starting at `:146`), and two more arrive through the
  `services.AddCaching(configuration)` call that `AddInfrastructure` itself makes (`:140`):
  `CacheSettings` (`DependencyInjection.Caching.cs:43-46`) and `QueryCachePipelineSettings` (`:48-51`).
  Those twelve reach every host that registers the package, and so does a twentieth Infrastructure
  registration that binds no section: `AddInfrastructure` puts a `CloudAdapterTripwireOptions` marker on
  the chain (`DependencyInjection.cs:221`, its validator registered at `:222-223`, the reason at
  `:217-220`) so that a host whose configuration enables `NativePush` while the push sender is still the
  inert core default (no adapter call was made, or the call was made but its push section is incomplete,
  so it returned early) fails at startup. The remaining seven sit in opt-in registration
  methods a host calls only when it wants the feature: `SchedulerSettings` in `AddScheduledJobs`
  (`DependencyInjection.Jobs.cs:39-42`), `TwoFactorSettings` in `AddTwoFactorAuthentication`
  (`DependencyInjection.Auth.cs:42-45`), `EmailConfirmationSettings` in `AddEmailConfirmation`
  (`DependencyInjection.Auth.cs:70-73`), `PermissionGrantSettings` in `AddStoredPermissionGrants`
  (`DependencyInjection.Auth.cs:141-144`), `AuditTrailSettings` in `AddAuditTrail`
  (`DependencyInjection.Jobs.cs:110-113`), `TenancySettings` in `AddMultiTenancy`
  (`DependencyInjection.cs:299-302`, the method starting at `:297`), and `PushNotificationSettings` in `AddPushNotifications`
  (`DependencyInjection.Notifications.cs:40-43`, the method starting at `:38`). The two cache sections take the chain only when the
  caller passes configuration: `AddCaching` takes an optional `IConfiguration`
  (`DependencyInjection.Caching.cs:26`) and, called without one, registers both unbound (`:55-56`), so
  `IOptions<T>` resolves to the compiled-in defaults instead of failing a caller that configures no cache
  section at all. Seventeen more registrations sit outside the Infrastructure package, fifteen of them
  binding a section: `IdempotencySettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:77-80`), `JwtSettings`, bound
  inside `AddCommonAuthentication`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:135-138`,
  the method starting at `:133`), `RateLimitingSettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:399`),
  `ApiSettings` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:43-46`, the method
  starting at `:40`),
  `SecurityHeadersSettings`, bound by the Aspire hosting package's `AddCommonSecurityHeaders`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs:276-277`, the method starting
  at `:268`),
  `GatewayRateLimitingSettings`, bound by the Aspire hosting package's `AddGatewayRateLimiting`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Gateway/GatewayRateLimitingExtensions.cs:296-299`,
  the method starting at `:290`),
  `GatewaySettings`, bound by the Gateway package's `AddMmcaGateway`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Gateway/GatewayReverseProxyExtensions.cs:55-58`), `AiSettings`
  (`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:123-126`), `ContentPolicySettings`
  (`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/GuardrailServiceCollectionExtensions.cs:67-70`),
  `BlazorCspSettings` (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:69-71`),
  `SameOriginApiProxySettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:55-65`),
  `BlazorCircuitLimitSettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitExtensions.cs:55-58`),
  `UiRateLimitingSettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hardening/UiRateLimitingExtensions.cs:202-205`, the
  method starting at `:197`),
  `HealthReportCacheOptions`, bound by the Aspire hosting package
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Health.cs:33-36`), and
  `ServiceTokenSettings`, bound once by a private helper that both of the gRPC package's
  `AddServiceTokenClient` and `AddServiceTokenAuthentication` call
  (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenServiceCollectionExtensions.cs:103-106`,
  the helper starting at `:96`, called at `:39` and `:67`). The last two bind no section. The same
  file's `AddServiceTokenAuthentication` puts a `DefaultSchemeGuard` marker type on the chain so that a
  service-token scheme which became the default authentication scheme fails the host at startup
  (`:78-82`, the reason at `:74-77`), and the Aspire hosting package's `AddServiceDefaults` puts a
  `HostIntegrationTripwireOptions` marker on it
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:44`, its validator registered at
  `:45-46`, the reason at `:40-43`) so that configuration asking for a vendor integration whose adapter
  call was never made (an Application Insights connection string with no exporter, a vault URI with no
  configuration source) fails the host at startup
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Integrations/HostIntegrationTripwire.cs:15`).
  Thirty-seven framework registrations in all.
- **Each service host adds exactly two of its own**, `ApplicationSettings` and `ModulesSettings`, and the
  same pair of chains covers all eight hosts across the three application repos. Seven of the eight reach
  them through one shared framework call rather than an inline copy: `AddModuleHost` binds and validates
  both sections before it builds the host's `ModuleLoader`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/ModuleHostExtensions.cs:61-64` and `:69-72`,
  the method starting at `:51`), so ADC's four services
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:379-381`, and the comment at `:370`
  says what the call binds) and Store's three
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:131-133`, the comment at `:119`) each declare the two
  sections in a single line of host code. The Helpdesk monolith seed still writes both chains out in its
  own `Program.cs` (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:19-22` and `:92-95`), which is
  exactly what the shared call expands to, so the contract reads the same whether a host takes the helper
  or spells it out. Modules may add their own sections on the same chain, as Store's Sales module does for
  Stripe.
- **Validation is data annotations, extended by `IValidatableObject` where a rule spans fields.**
  `JwtSettings` marks `Issuer` and `Audience` `[Required]`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:53-58`) and implements
  `IValidatableObject` (`:16`) so key material is checked conditionally on the selected algorithm:
  RS256 (the default) demands `RsaPrivateKeyPem`, HS256 demands a `SecretForKey` of at least 32
  characters (`:79-94`). `ValidateDataAnnotations()` invokes that method, so a host configured for
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
  the class the chain binds and validates. Three bound framework types keep a public setter:
  `ModuleSettings.RemoteDependencies`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ModuleSettings.cs:38`, with CA2227
  suppressed at `:37` because configuration binding needs it), every scalar member of
  `SameOriginApiProxySettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxySettings.cs:39`,
  `:47`, `:83`, `:90`, `:98`; its two collections, `AdditionalTokenIssuingPaths` at `:53` and
  `MaxRequestBodySizeByPath` at `:76`, are get-only; `GatewayAddress` is filled in by a `PostConfigure` at
  `SameOriginApiProxyServiceExtensions.cs:60-63`), and `RegistrationSettings.CollectAddress`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/RegistrationSettings.cs:18`). Three
  code-configured options types that bind no section also carry setters: `SessionCookieSettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/SessionCookies/SessionCookieSettings.cs:19`, `:29`,
  `:38`), the three members of `OwnerOrAdminFilterOptions`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/OwnerOrAdminFilterOptions.cs:16`,
  `:24`, `:31`), which a host sets with `services.Configure` in code, and `FallbackAuthorizationOptions.Enabled`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/Fallback/FallbackAuthorizationOptions.cs:52`).
- **Fifteen exceptions in the framework, thirteen of them on one shared reason: an absent section is a
  working default, not a misconfiguration.** `CacheKeyPrefixOptions` is bound with a bare `services.Configure`
  and no validation, because an absent section must leave cache keys exactly as callers write them (a
  single call inside `AddCaching`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:41`, the method
  starting at `:26`).
  `LayoutSettings` binds with `AddOptions().Bind()` and nothing after it for the same reason: it is
  optional footer copy (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:49-50`),
  and four sections registered beside it bind exactly the same way, each with its reason in a comment
  beside the binding: `LegalSettings` (`:54-55`, an absent section leaves every legal link empty, the
  reason at `:52-53`), `RegistrationSettings` (`:59-60`, an absent section keeps every register-page
  block, the reason at `:57-58`), and the two client-side sections whose absence leaves the compiled-in
  defaults, the staleness policy `UiReadCacheOptions` (`:64-65`) and `NotificationBellOptions`
  (`:67-68`), the shared reason at `:62-63`. `LegalAcceptanceOptions` binds the same way inside the opt-in `AddLegalAcceptance`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Auth.cs:109-110`), because
  its one setting has no invalid value (any version string turns the feature on, null or whitespace
  turns it off); the reason sits in a comment at the call (`:106-108`), and the method's XML remarks
  (`:100-101`) add that registration asks for acceptance only while `Legal:CurrentTermsVersion` is set.
  The cloud adapter packages bind their six vendor sections with a bare `AddOptions<T>().Bind(...)` and
  no validation, in one of two orders. The four file-storage and hub methods bind first and then read
  the section back: `AzureBlobFileStorageSettings`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureServiceCollectionExtensions.cs:45-46`, read back at
  `:48`), `AzureNotificationHubSettings` (`:87-88`, read back at `:90`), `S3FileStorageSettings`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsServiceCollectionExtensions.cs:54-55`, read back at
  `:57`) and `GcsFileStorageSettings`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GcpServiceCollectionExtensions.cs:52-53`, read back at
  `:55`). The SNS and FCM push methods reverse the order: they read the section first, return early
  unless `NativePush:Enabled` is true and the section is complete, and only then bind
  `SnsNativePushSettings` (`AwsServiceCollectionExtensions.cs:168-175`, bound at `:180`) and
  `FcmNativePushSettings` (`GcpServiceCollectionExtensions.cs:146-153`, bound at `:158`), so with push
  off those two register no options at all. Either way each method turns itself into a no-op when its
  section is absent or incomplete, so a host registers it unconditionally and switches the feature on
  by configuration alone. The one guard is the `CloudAdapterTripwireOptions` marker above: a host that
  sets `NativePush:Enabled` while `INativePushSender` is still `NullNativePushSender` fails at startup,
  whether it made no adapter call or made one whose push section is incomplete (the check at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwire.cs:48-50`, the
  message naming both causes at `:53`, the validator at `:30`), so an incomplete push section with push
  switched on fails the host rather than becoming a silent no-op, while
  file storage is deliberately unchecked because a `FileStorage` section is routinely shared
  configuration and the core default fails every upload loudly instead (`:22-26`).
  `DataSourcesSettings` is the one exception with a mechanical rather than a policy reason: it is
  constructed directly from the section rather than through `AddOptions`, because a root-level dictionary
  section does not bind through the options pipeline
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:87-89`, the reason at
  `:85-86`), and it still counts because the result is registered for runtime resolution (`:90`). A
  plain `Get<T>()` that a registration method uses only to decide what to register, and never puts in
  the container, is not an exception: like the `Get<MessageBusSettings>()` above, the reads of
  `RdsIamAuthenticationSettings`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsServiceCollectionExtensions.cs:111`),
  `CloudSqlIamAuthenticationSettings`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GcpServiceCollectionExtensions.cs:94`) and
  `AmazonSqsTransportSettings`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Messaging/AmazonSqsTransport.cs:78`) run while the
  host registers its services, so whatever they check (a half-set key pair, a connection string that
  would send a token in clear) fails registration rather than first use.
  `OwnerOrAdminFilterOptions` is the fifteenth and keeps more of the chain than the rest: it binds no
  section (hosts set it in code), is registered with `ValidateDataAnnotations()` and drops only
  `ValidateOnStart`, because its required `BypassRole` has no
  framework default (the framework knows no role names), so validating at startup would fail every host
  that never applies the filter, while validating on first resolve puts the annotation message in front of
  the host that actually uses it
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:91-92`, the reason at `:87-90`).
- **Consumer hosts take the same escape twice, and write the reason at the call site.** ADC's Engagement
  service binds `PointsSettings`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:134-135`, the reason at `:131-133`) and
  `CheckInSettings` (`:141-142`, the reason at `:138-140`) without `ValidateOnStart`: the defaults are working values and an explicit zero is the
  documented per-rule kill switch, so no value an organizer could set should stop that host from booting
  mid-conference. Both follow the rule the framework's fifteen follow: an exception is legitimate when the
  section has no invalid value, and the reason belongs in a comment beside the binding rather than left
  to be inferred from its absence.

**Every layer reads a bound section the same way.** Inside Infrastructure and API that is a constructor
or per-request `IOptions<T>`: `OutboxProcessor`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:61`),
`BrokerEventBus` (`.../Messaging/BrokerEventBus.cs:35`), `LoginProtectionService`
(`.../Auth/LoginProtectionService.cs:32`), `RsaJwksProvider` (`.../Auth/RsaJwksProvider.cs:14`),
`SQLServerDbContext` (`.../Persistence/DbContexts/SQLServerDbContext.cs:36`), and `IdempotencyFilter`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:443`), and so does the
framework's `/client-config` minimal-API handler, which reads `IOptions<ApiSettings>`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/ClientConfig/ClientConfigEndpointExtensions.cs:53`)
and which ADC's web host maps with `app.MapClientConfigEndpoint`
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:271`). Consumer code reads its own sections the
same way: Store's Sales Infrastructure in `StripeClientFactory.cs:37`, `StripePaymentService.cs:63` (and
`:67`), `StripeWebhookRegistrationService.cs:49`, `PaymentReconciliationService.cs:71-72`,
`DenormalizationBackfillService.cs:40` and `OrderFulfilledBackfillService.cs:39`.

The Application layer names the options pipeline too, and the framework supplies six of those
injections itself, one in each of six classes: `AuthenticationServiceBase<TUser>` takes an optional
`IOptions<EmailConfirmationSettings>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:74`),
`AuthSessionIssuer` takes `IOptions<RefreshSessionSettings>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Sessions/AuthSessionIssuer.cs:44`),
`AuthenticationValidators` takes an optional `IOptions<LegalAcceptanceOptions>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationValidators.cs:28`), the shared
`ForgotPasswordHandlerBase` takes `IOptions<PasswordResetSettings>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:41`),
`SendEmailConfirmationHandlerBase` takes `IOptions<EmailConfirmationSettings>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/EmailConfirmation/SendEmailConfirmationHandlerBase.cs:45`),
and `CachingQueryDecorator` takes an optional `IOptions<QueryCachePipelineSettings>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:48`).
ADC adds seven injections across six classes, one each in all but the last: its Identity `AuthenticationService` takes the
`IOptions<EmailConfirmationSettings>` it forwards to the base constructor
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:57`),
and the other five are:
`ForgotPasswordHandler` (`.../Users/UseCases/ForgotPassword/ForgotPasswordHandler.cs:25`),
`SendEmailConfirmationHandler`
(`.../Users/UseCases/SendEmailConfirmation/SendEmailConfirmationHandler.cs:31`), and in
Engagement `PointsAwarder`
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/Points/Services/PointsAwarder.cs:31`),
`GetLeaderboardHandler` (`.../Points/UseCases/GetLeaderboard/GetLeaderboardHandler.cs:30`) and
`RecordRoomCheckInHandler`, which takes two, `IOptions<CheckInSettings>` and `IOptions<PointsSettings>`
(`.../CheckIns/UseCases/RecordRoomCheckIn/RecordRoomCheckInHandler.cs:47` and `:48`).
Store adds ten, with the same shape: its Identity `AuthenticationService` takes the same single
injection
(`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs:32`),
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
  members (everywhere but the setter-bearing types named above) are what make the value unwritable
  at the point of use, and the validation that ran at boot
  covers every reader because there is only one bound instance to read.
- **One shape makes the contract auditable.** Because every chain ends in `ValidateOnStart()`,
  even where it varies (`BlazorCspSettings` drops `ValidateDataAnnotations()`,
  `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:69-71`, and so does
  `SameOriginApiProxySettings`, which inserts a `PostConfigure`,
  `SameOriginApiProxyServiceExtensions.cs:55-65`; `SecurityHeadersSettings` calls `.Bind` only when
  configuration was supplied, `SecurityHeaders.cs:276-281`; `RateLimitingSettings`
  writes the chain on one line,
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:399`;
  Store's `StoreTimeZoneSettings` inserts a delegate `.Validate(...)`,
  `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/CatalogModule.cs:40-44`; the gRPC
  package's `DefaultSchemeGuard` binds no section at all and validates through a
  `.Validate<IOptions<AuthenticationOptions>>(...)` delegate,
  `ServiceTokenServiceCollectionExtensions.cs:78-82`; the two startup tripwires,
  `CloudAdapterTripwireOptions` and `HostIntegrationTripwireOptions`, are a bare
  `AddOptions<T>().ValidateOnStart()` with no `Bind` and no annotations, checked only by an
  `IValidateOptions<T>`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:221`
  and `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:44`), a grep for
  `ValidateOnStart` is a complete inventory of what a host validates at boot: the
  thirty-seven framework registrations, plus whatever the host and its modules add. Collapsing the two
  host-owned sections into `AddModuleHost` shortens that inventory rather than hiding it, since the pair
  is now read once in the framework instead of eight times across the repos.

## Trade-offs
- **Nothing enforces it.** There is no architecture fitness test asserting that a new `AddOptions<T>` call
  carries `ValidateDataAnnotations().ValidateOnStart()`. The uniformity above is convention held by review,
  not a gate, which is weaker than the invariant-over-discipline posture ADR-015 applies elsewhere. A
  section added without the chain fails silently, which is to say it fails later. Fifteen framework bindings
  and two consumer-host bindings sit off the chain by choice, and nothing in the build distinguishes
  those from a section whose author simply forgot: only a source comment near each one does (one comment
  covers both client-side UI sections, and for the six cloud adapter sections the reason sits only in
  the XML summary of each registration method, for example
  `MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureServiceCollectionExtensions.cs:37` and `:77-79`,
  `MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsServiceCollectionExtensions.cs:43` and `:146`, and
  `MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GcpServiceCollectionExtensions.cs:38` and `:122`).
- **Bad configuration becomes a crash loop, not a degraded start.** A deployed replica with a missing
  required value never reaches the warm-up and readiness machinery of ADR-025: it terminates at host build.
  That is the intended trade (no half-configured replica serves traffic), but it means a configuration
  mistake takes the whole rollout rather than one code path.
- **The options pipeline reaches every layer.** With `IOptions<T>` as the one surface,
  `Microsoft.Extensions.Options` appears in Application-layer constructor signatures as readily as in
  Infrastructure ones. The alternative buys that purity with an alias type per settings class, and this
  record takes the pipeline over the second type.
- **Data annotations are the vocabulary.** Anything richer needs `IValidatableObject` or a custom
  `IValidateOptions<T>`, and both escape hatches are in use in the framework: the former four times, the
  latter eight times. `JwtSettings` implements `IValidatableObject`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:16`), and so do `AiSettings`
  (`MMCA.Common/Source/Core/MMCA.Common.AI/AiSettings.cs:22`), whose section is bound with the full chain
  (`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:123-126`), `ContentPolicySettings`
  (`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ContentPolicySettings.cs:23`) and
  `ServiceTokenSettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenSettings.cs:18`). Eight validator
  classes sit beside a chain instead, each registered with `TryAddEnumerable` so two modules calling the
  same registration method cannot run the validation twice.
  `AiProviderValidator`
  (`MMCA.Common/Source/Core/MMCA.Common.AI/Providers/AiProviderValidator.cs:16`, registered at
  `MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:94`) exists because whether the
  configured provider names a registered `IAiProviderFactory` depends on what the host registered, which
  no annotation on `AiSettings` can see.
  `TenancySettingsValidator`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettingsValidator.cs:24-25`,
  registered at `DependencyInjection.cs:305-306`) exists because confirming that a tenant's data-source
  override names a real physical source needs `IDataSourceResolver`, which no annotation can reach.
  `ConnectionStringSettingsValidator`
  (`.../Persistence/DataSources/ConnectionStringSettingsValidator.cs:30-31`,
  registered at `DependencyInjection.cs:82-83`) exists because the "a host must reach some database" rule
  spans two sections at once, `ConnectionStrings` and `DataSources`, so a SQLite-only host that declares
  its databases as named sources is legitimate while a host declaring none anywhere is not.
  `BlazorCspSettingsValidator`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspSettingsValidator.cs:13`,
  registered at `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:74-75` beside
  the `BlazorCspSettings` chain at `:69-71`) exists because a configured CSP source has to be screened for
  the characters that would break out of a source expression or widen a directive, which is a rule about
  the shape of each entry in a collection rather than about a single property.
  `SameOriginApiProxySettingsValidator`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxySettingsValidator.cs:16`,
  registered at `SameOriginApiProxyServiceExtensions.cs:66-67`) validates the proxy section, whose chain
  carries no `ValidateDataAnnotations()`.
  `GatewaySettingsValidator`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Gateway/GatewaySettingsValidator.cs:19`, registered at
  `GatewayReverseProxyExtensions.cs:62-63`, the reason at `:60-61`) exists because
  `ValidateDataAnnotations()` does not recurse into the nested trace-header and health-check objects,
  so their `[Required]` values would otherwise never be checked at startup.
  `CloudAdapterTripwire`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwire.cs:30`,
  registered at `DependencyInjection.cs:222-223`) and `HostIntegrationTripwire`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Integrations/HostIntegrationTripwire.cs:15`,
  registered at `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:45-46`) validate marker
  types that carry no data at all, because what they check is whether a vendor adapter call was made,
  which only the registered services can show. The cost of
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

## Revision (2026-10-06)
No decision or rationale changed; the inventory was re-counted against source.
- A grep now finds 35 `ValidateOnStart()` calls under `MMCA.Common/Source`; less the host-owned pair that
  is thirty-three framework registrations (nineteen in Infrastructure, fourteen outside). The two new ones
  outside are `SecurityHeadersSettings` (`SecurityHeaders.cs:276-277`), which is no longer an exception,
  and `SameOriginApiProxySettings` (`SameOriginApiProxyServiceExtensions.cs:55-65`).
- The off-chain exceptions are now eleven: the eight still recorded plus `LegalSettings`,
  `RegistrationSettings` (UI `DependencyInjection.cs:53-54`, `:58-59`) and `LegalAcceptanceOptions`
  (`DependencyInjection.Auth.cs:106-107`), whose reason sits only in XML remarks.
- Custom `IValidateOptions<T>` validators are now five (`SameOriginApiProxySettingsValidator.cs:14`).
- The setter list now names `SameOriginApiProxySettings` and `RegistrationSettings.CollectAddress`, and
  moves `OwnerOrAdminFilterOptions` to the code-configured group, since it binds no section
  (API `DependencyInjection.cs:91-92`): three bound types and three code-configured types.
- `IOptions<RefreshSessionSettings>` moved from `AuthenticationServiceBase` to `AuthSessionIssuer.cs:42`,
  `AuthenticationValidators.cs:28` takes an optional `IOptions<LegalAcceptanceOptions>`, and each app's
  Identity `AuthenticationService` now takes one injection (ADC `:57`, Store `:32`).
- The Infrastructure `DependencyInjection` partial now spans six files (`.Messaging` registers no options
  chain; it only reads the `MessageBus` section back at `DependencyInjection.Messaging.cs:49`).
- `UiRateLimitingSettings` re-anchored to `UiRateLimitingExtensions.cs:180-183`; every other citation was
  re-verified against current source and re-anchored in place.

## Revision (2026-10-07)
Re-verified against current source. The decision, the rationale and every count are unchanged
(thirty-three framework registrations, eleven framework exceptions, five custom validators); one
exception's description moved.

1. `LegalAcceptanceOptions` now carries its reason in a comment at the call
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Auth.cs:106-108`, the
   binding at `:109-110`): the one setting has no invalid value. The XML remarks (`:100-101`) remain,
   so the Decision no longer says the reason sits only there. The Trade-offs caveat now names
   `NativePushSettings` and `FileStorageSettings` instead: they bind with no comment at the call
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Notifications.cs:84-85`,
   `:116-117`), their reason only in the XML summary of each registration method (`:76-78`,
   `:109-110`).
2. Anchors re-verified against current source: `PermissionGrantSettings`
   (`DependencyInjection.Auth.cs:141-144`), ADC Conference.Service `AddModuleHost`
   (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:371-373`, the comment at `:362`),
   `OutboxProcessor` (`.../Persistence/Outbox/Processing/OutboxProcessor.cs:59`) and
   `AuthSessionIssuer` (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Sessions/AuthSessionIssuer.cs:44`).

## Revision (2026-10-21)
Re-verified against current source. The decision, the rationale, the nineteen Infrastructure chains, the
eleven framework exceptions and the two consumer-host exceptions are unchanged; the inventory outside
Infrastructure grew, two escape-hatch counts moved, and two descriptions were corrected.

1. A grep now finds 37 `ValidateOnStart()` calls in 21 files under `MMCA.Common/Source`; less the
   host-owned pair in `ModuleHostExtensions.cs:61-64` and `:69-72` that is thirty-five framework
   registrations (nineteen in Infrastructure, sixteen outside). The two new ones are `ServiceTokenSettings`
   (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenServiceCollectionExtensions.cs:103-106`)
   and the `DefaultSchemeGuard` marker chain in the same file (`:78-82`), which binds no section and
   validates through a `.Validate<IOptions<AuthenticationOptions>>(...)` delegate; the Rationale's list of
   chain variants now names it.
2. `IValidatableObject` is implemented four times (`ServiceTokenSettings.cs:18` is new) and custom
   `IValidateOptions<T>` validators are six: `GatewaySettingsValidator`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Gateway/GatewaySettingsValidator.cs:19`) is registered with
   `TryAddEnumerable` at `GatewayReverseProxyExtensions.cs:62-63` because `ValidateDataAnnotations()`
   does not recurse into nested objects.
3. ADC's Application layer names seven injections across the same six classes: `RecordRoomCheckInHandler`
   takes both `IOptions<CheckInSettings>` and `IOptions<PointsSettings>`
   (`.../CheckIns/UseCases/RecordRoomCheckIn/RecordRoomCheckInHandler.cs:46` and `:47`).
4. Only the scalar members of `SameOriginApiProxySettings` keep a setter (`SameOriginApiProxySettings.cs:39`,
   `:47`, `:83`, `:90`, `:98`); its collections `AdditionalTokenIssuingPaths` (`:53`) and
   `MaxRequestBodySizeByPath` (`:76`) are get-only.
5. `JwtSettings.Validate` now spans `JwtSettings.cs:79-94` (HS256 check `:81-86`, RS256 check `:88-93`).
6. Anchors re-verified against current source: Infrastructure `DependencyInjection.cs`
   (`MessageBusSettings` `:192-195`, `JwksSettings` `:197-200`, `AddInternalCommands` call `:237`,
   `AddMultiTenancy` `:282` with its chain at `:284-287` and the `TenancySettingsValidator` registration at
   `:290-291`); `DependencyInjection.Notifications.cs` (`NativePushSettings` `:87-88`, `FileStorageSettings`
   `:119-120`, XML-summary reasons `:79-81` and `:112-113`); UI `DependencyInjection.cs` (method `:40`,
   `ApiSettings` `:43-46`, `LayoutSettings` `:49-50`, `LegalSettings` `:54-55` and reason `:52-53`,
   `RegistrationSettings` `:59-60` and reason `:57-58`, `UiReadCacheOptions` `:64-65`,
   `NotificationBellOptions` `:67-68`, shared reason `:62-63`); `GatewayReverseProxyExtensions.cs:55-58`;
   `SameOriginApiProxySettingsValidator.cs:16`; ADC Conference.Service `AddModuleHost`
   (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:373-375`, the comment at `:364`);
   `OutboxProcessor.cs:61`; ADC UI Web `MapClientConfigEndpoint` (`Program.cs:265`);
   `StripeWebhookRegistrationService.cs:49`; `ForgotPasswordHandlerBase.cs:41`;
   `SendEmailConfirmationHandlerBase.cs:45`.

## Revision (2026-10-26)
Re-verified against current source. The decision, the rationale, the nineteen Infrastructure sections
(twelve reaching every host, seven opt-in), the two consumer-host exceptions and the six framework
Application injections are unchanged; the cloud-neutral adapter split moved two exceptions into vendor
packages and added two startup tripwires.

1. A grep now finds 39 `ValidateOnStart()` calls in 22 files under `MMCA.Common/Source`; less the
   host-owned pair in `ModuleHostExtensions.cs:64` and `:72` that is thirty-seven framework
   registrations (twenty in Infrastructure, seventeen outside). The two new ones bind no section:
   `CloudAdapterTripwireOptions`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:221`), inside
   `AddInfrastructure` and so reaching every host, and `HostIntegrationTripwireOptions`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:44`), inside `AddServiceDefaults`. Both
   are a bare `AddOptions<T>().ValidateOnStart()`, and the Rationale's list of chain variants now names
   that shape.
2. Custom `IValidateOptions<T>` validators are eight: `CloudAdapterTripwire`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwire.cs:30`,
   registered with `TryAddEnumerable` at `DependencyInjection.cs:222-223`) and `HostIntegrationTripwire`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Integrations/HostIntegrationTripwire.cs:15`,
   registered at `Extensions.cs:45-46`) are new.
3. `NativePushSettings` and `FileStorageSettings` no longer exist, and
   `DependencyInjection.Notifications.cs` holds only the `PushNotificationSettings` chain (`:40-43`). The
   cloud adapter packages bind six vendor sections off the chain instead: `AzureBlobFileStorageSettings`
   and `AzureNotificationHubSettings` (`AzureServiceCollectionExtensions.cs:45-46`, `:87-88`),
   `S3FileStorageSettings` and `SnsNativePushSettings` (`AwsServiceCollectionExtensions.cs:54-55`,
   `:180`), and `GcsFileStorageSettings` and `FcmNativePushSettings`
   (`GcpServiceCollectionExtensions.cs:52-53`, `:158`). The framework exceptions are therefore fifteen,
   thirteen on the shared "absent section is a working default" reason; the Trade-offs now cite the
   adapter XML summaries for that reason, and the Decision notes that `NativePush:Enabled` with the push
   sender still `NullNativePushSender` fails startup through `CloudAdapterTripwire`.
4. The tripwire covers more than a missing adapter call: it fails whenever `INativePushSender` is still
   `NullNativePushSender` (`CloudAdapterTripwire.cs:48-50`, message at `:53`), which includes an adapter
   call whose push section is incomplete, because each push method returns early then
   (`AzureServiceCollectionExtensions.cs:91-96`, `AwsServiceCollectionExtensions.cs:170-175`,
   `GcpServiceCollectionExtensions.cs:148-153`). The two non-Azure push methods also bind in the other
   order from the four storage and hub methods: the section is read first and
   `AddOptions<T>().Bind(...)` runs only past the enabled-and-complete gate (Aws `:168-180`, Gcp
   `:146-158`), so with push off they register no options. The Decision now says both.
5. The fifteen exceptions are unchanged in count. The Decision now states that a registration-time
   `Get<T>()` never placed in the container is outside the inventory, naming the three adapter reads that
   fall there: `RdsIamAuthenticationSettings` (`AwsServiceCollectionExtensions.cs:111`),
   `CloudSqlIamAuthenticationSettings` (`GcpServiceCollectionExtensions.cs:94`) and
   `AmazonSqsTransportSettings` (`AmazonSqsTransport.cs:78`); `DataSourcesSettings` counts because it is
   registered (`DependencyInjection.cs:90`).
6. Anchors re-verified against current source: Infrastructure `DependencyInjection.cs` (`AddCaching` call
   `:140`, `AddInternalCommands` call `:252`, `AddMultiTenancy` `:297` with its chain at `:299-302` and the
   `TenancySettingsValidator` registration at `:305-306`); `AddPushNotifications`
   (`DependencyInjection.Notifications.cs:38`, chain `:40-43`); `AddBrokerMessaging`
   (`DependencyInjection.Messaging.cs:48`, `Get<MessageBusSettings>()` at `:54`); `RateLimitingSettings`
   (`WebApplicationBuilderExtensions.RateLimiting.cs:399`); `GatewayRateLimitingSettings`
   (`GatewayRateLimitingExtensions.cs:296-299`, method `:290`); `UiRateLimitingSettings`
   (`UiRateLimitingExtensions.cs:202-205`, method `:197`); ADC Conference.Service `AddModuleHost`
   (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:379-381`, the comment at `:370`);
   Store Catalog.Service `AddModuleHost`
   (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:131-133`, the comment at `:119`);
   ADC Engagement `PointsSettings` (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:134-135`,
   reason `:131-133`) and `CheckInSettings` (`:141-142`, reason `:138-140`);
   `AuthenticationServiceBase.cs:74`; `RecordRoomCheckInHandler.cs:47` and `:48`;
   `LoginProtectionService.cs:32`; ADC UI Web `MapClientConfigEndpoint` (`Program.cs:271`).

## Related
ADR-025 (startup warm-up and readiness gating: this contract decides what happens *before* a host reaches
that machinery), ADR-031 (feature flags read from configuration, whose section this contract governs the
binding of), ADR-061 (where a secret value comes from at runtime; this decides what the host does when it
does not arrive), ADR-015 (architecture fitness functions, the enforcement mechanism this contract
currently lacks).
