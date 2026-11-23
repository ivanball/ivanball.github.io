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
Revised 2026-10-28: Store's Sales module now binds eight validated sections, its Application layer names
thirteen `IOptions` injections, and its Sales Infrastructure readers include `StripeTaxCalculator` and
`PaymentReconciliationSettingsValidator`; source citations re-anchored.
Revised 2026-11-04: `JwksSettings` now implements `IValidatableObject` (MMCA.Common 1.277.0), so five
settings types use it, and the `TokenService` constructor anchors moved; see Revision below.
Revised 2026-11-23: inventory re-counted to forty-five framework registrations (twenty-five in the
Infrastructure package with `ViewAsSettings` and four opt-in chains added, plus `PasskeySettings`,
`McpSettings` and the Application `WebhookSettings` outside it) and eleven custom validators; the
`CloudAdapterTripwire` also fails `Passkeys:Enabled` and `MachineClients:Enabled` without their
registration calls; `SignInSettings` takes the retired `UiReadCacheOptions` place among the framework
exceptions and `MultiFactorAuthorizationSettings` makes them sixteen; consumer hosts take the escape five
times and ADC's Conference module once; Store's Sales module binds six
sections; the service hosts reach `AddModuleHost` through `AddMmcaServiceHost`; fourteen framework
Application classes read `IOptions`; source citations re-anchored.

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
  is the required form (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:73-76`).
  `.BindConfiguration(T.SectionName)` is the accepted shorthand for the `Bind(GetSection(...))` step and
  is what Store's Sales module uses for all six of the sections it binds
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/SalesModule.cs:53-56`, `:62-65`, `:67-70`,
  `:72-75`, `:77-80`, `:82-85`).
  `ValidateOnStart()` is the load-bearing link: without it the annotations are evaluated lazily on first
  resolution, which is exactly the first-use failure the contract exists to prevent.
- **The framework owns the base set.** Twenty-four sections are bound on this chain in the
  Infrastructure package (one, `MachineClientSettings`, drops `ValidateDataAnnotations()` and relies on
  its validator; see Rationale). Twenty-three sit in its `DependencyInjection` partial class, which spans nine files:
  `DependencyInjection.cs` and its `.Caching`, `.Auth`, `.Jobs`, `.Notifications`, `.FeatureFlags`,
  `.MachineClients`, `.Persistence` and `.Messaging` parts (the last holds `AddBrokerMessaging`,
  `DependencyInjection.Messaging.cs:48`, which registers no options chain of its own and reads the
  `MessageBus` section back with a plain `Get<MessageBusSettings>()` at `:54` to pick the transport; the
  validated chain for that section is the one in `AddInfrastructure`), and the twenty-fourth sits in the
  package's webhook registration (below). Ten sit directly inside `AddInfrastructure`
  (the method starting at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:58`; `ConnectionStringSettings`
  `:73-76`, `SmtpSettings` `:99-102`, `PersistenceSettings` `:145-148`, `OutboxSettings` `:150-153`,
  `LoginProtectionSettings` `:155-158`, `PasswordResetSettings` `:161-164`, `RefreshSessionSettings`
  `:169-172`, `ViewAsSettings` `:193-196`, `MessageBusSettings` `:215-218`, `JwksSettings` `:220-223`),
  an eleventh arrives through the
  private `AddInternalCommands` helper that `AddInfrastructure` calls (`:275`): `InternalCommandsSettings`
  (`DependencyInjection.Jobs.cs:148-152`, the helper starting at `:146`), and two more arrive through the
  `services.AddCaching(configuration)` call that `AddInfrastructure` itself makes (`:141`):
  `CacheSettings` (`DependencyInjection.Caching.cs:48-51`) and `QueryCachePipelineSettings` (`:53-56`).
  Those thirteen reach every host that registers the package, and so does a twenty-fifth Infrastructure
  registration that binds no section: `AddInfrastructure` puts a `CloudAdapterTripwireOptions` marker on
  the chain (`DependencyInjection.cs:244`, its validator registered at `:245-246`, the reason for the push check at
  `:240-243`, the passkey and machine-client reasons at
  `Configuration/CloudAdapterTripwire.cs:37-49`) so that a host fails at startup when its configuration switches on a capability whose
  registration call is missing: `NativePush:Enabled` while the push sender is still the inert core
  default (no adapter call was made, or the call was made but its push section is incomplete, so it
  returned early), `Passkeys:Enabled` with no passkey ceremony registered, or `MachineClients:Enabled`
  with machine clients not registered. The remaining eleven sit in opt-in registration
  methods a host calls only when it wants the feature: `SchedulerSettings` in `AddScheduledJobs`
  (`DependencyInjection.Jobs.cs:39-42`), `TwoFactorSettings` in `AddTwoFactorAuthentication`
  (`DependencyInjection.Auth.cs:48-51`), `EmailConfirmationSettings` in `AddEmailConfirmation`
  (`DependencyInjection.Auth.cs:81-84`), `SignInLinkSettings` in `AddSignInLinks`
  (`DependencyInjection.Auth.cs:108-111`, the method starting at `:106`), `PermissionGrantSettings` in
  `AddStoredPermissionGrants` (`DependencyInjection.Auth.cs:176-179`), `AuditTrailSettings` in `AddAuditTrail`
  (`DependencyInjection.Jobs.cs:110-113`), `TenancySettings` in `AddMultiTenancy`
  (`DependencyInjection.cs:322-325`, the method starting at `:320`), `PushNotificationSettings` in
  `AddPushNotifications` (`DependencyInjection.Notifications.cs:43-46`, the method starting at `:41`),
  `FeatureFlagOverrideSettings` in `AddReloadableFeatureFlags`
  (`DependencyInjection.FeatureFlags.cs:64-67`, the method starting at `:47`), `MachineClientSettings`
  in `AddMachineClients` (`DependencyInjection.MachineClients.cs:41-43`, the method starting at `:37`),
  and `WebhookSettings` in `AddWebhooks`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookServiceCollectionExtensions.cs:71-74`,
  the method starting at `:67`). The two cache sections take the chain only when the
  caller passes configuration: `AddCaching` takes an optional `IConfiguration`
  (`DependencyInjection.Caching.cs:30`) and, called without one, registers both unbound (`:60-61`), so
  `IOptions<T>` resolves to the compiled-in defaults instead of failing a caller that configures no cache
  section at all. Twenty more registrations sit outside the Infrastructure package, seventeen of them
  binding a section: `IdempotencySettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:78-81`), `JwtSettings`, bound
  inside `AddCommonAuthentication`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:136-139`,
  the method starting at `:134`), `RateLimitingSettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:410`),
  `ApiSettings` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:46-49`, the method
  starting at `:43`),
  `SecurityHeadersSettings`, bound by the Aspire hosting package's `AddCommonSecurityHeaders`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs:276-277`, the method starting
  at `:268`),
  `GatewayRateLimitingSettings`, bound by the Aspire hosting package's `AddGatewayRateLimiting`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Gateway/GatewayRateLimitingExtensions.cs:375-378`,
  the method starting at `:369`),
  `GatewaySettings`, bound by the Gateway package's `AddMmcaGateway`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Gateway/GatewayReverseProxyExtensions.cs:63-66`, the method
  starting at `:56`), `AiSettings`
  (`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:123-128`), `PasskeySettings`, bound by
  the opt-in Passkeys package's `AddPasskeys`
  (`MMCA.Common/Source/Core/MMCA.Common.Passkeys/PasskeysServiceCollectionExtensions.cs:41-43`),
  `McpSettings`, bound by the Mcp package
  (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHostingExtensions.cs:58-63`), `ContentPolicySettings`
  (`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/GuardrailServiceCollectionExtensions.cs:67-70`),
  `BlazorCspSettings` (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:69-71`),
  `SameOriginApiProxySettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:55-65`),
  `BlazorCircuitLimitSettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hardening/BlazorCircuitLimitExtensions.cs:55-58`),
  `UiRateLimitingSettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hardening/UiRateLimitingExtensions.cs:222-225`, the
  method starting at `:217`),
  `HealthReportCacheOptions`, bound by the Aspire hosting package
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Health.cs:33-36`), and
  `ServiceTokenSettings`, bound once by a private helper that both of the gRPC package's
  `AddServiceTokenClient` and `AddServiceTokenAuthentication` call
  (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenServiceCollectionExtensions.cs:110-113`,
  the helper starting at `:103`, called at `:39` and `:70`). Three more bind no section. The
  Application package's `AddWebhookDelivery()` puts `WebhookSettings` on the chain a second time as a
  bare `AddOptions<WebhookSettings>().ValidateOnStart()` beside its `WebhookRegistrationValidator`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.Webhooks.cs:98-99`, the method
  starting at `:94`). It is the same options type and section that the Infrastructure `AddWebhooks`
  binds with the full chain, and the validator fails the host unless a subscription store is registered,
  which in practice means `AddWebhooks` ran
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/WebhookRegistrationValidator.cs:18-22`), so in
  a working host the annotations check that section too. The gRPC
  file's `AddServiceTokenAuthentication` puts a `DefaultSchemeGuard` marker type on the chain so that a
  service-token scheme which became the default authentication scheme fails the host at startup
  (`:81-85`, the reason at `:77-80`), and the Aspire hosting package's `AddServiceDefaults` puts a
  `HostIntegrationTripwireOptions` marker on it
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:50`, its validator registered at
  `:51-52`, the reason at `:46-49`) so that configuration asking for a vendor integration whose adapter
  call was never made (an Application Insights connection string with no exporter, a vault URI with no
  configuration source, a key-ring blob with no DataProtection sink) fails the host at startup
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Integrations/HostIntegrationTripwire.cs:15`).
  Forty-five framework registrations in all (the two `WebhookSettings` registrations name one options
  type and one section).
- **Each service host adds exactly two of its own**, `ApplicationSettings` and `ModulesSettings`, and the
  same pair of chains covers all eight hosts across the three application repos. Seven of the eight reach
  them through one shared framework call rather than an inline copy: `AddModuleHost` binds and validates
  both sections before it builds the host's `ModuleLoader`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/ModuleHostExtensions.cs:61-64` and `:69-72`,
  the method starting at `:51`), and ADC's four services and Store's three reach it through the
  composed service-host start-up of the `MMCA.Common.ServiceHost` package: each calls
  `builder.AddMmcaServiceHost` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:82`,
  `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:32`), which calls `AddModuleHost`
  (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:100`, the method
  starting at `:63`), so no service host writes either chain itself. The Helpdesk monolith seed still
  writes both chains out in its
  own `Program.cs` (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:20-23` and `:109-112`), which is
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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:73`) beside an optional
  `IOptions<JwksSettings>` that names the signing key in the token's `kid` header (`:77`), both of
  `SmtpEmailSender`'s constructors take `IOptions<SmtpSettings>` (`.../Mail/SmtpEmailSender.cs:29` and
  `:50`), `RepositoryFactory` takes
  `IOptions<ApplicationSettings>`
  (`.../Persistence/Repositories/Factory/RepositoryFactory.cs:15`), and `EntityControllerBase` resolves
  the same options per request in its `MaxPageSize` and `MaxExportRows` accessors
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:62` and `:82`).
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
- **Sixteen exceptions in the framework, thirteen of them on one shared reason: an absent section is a
  working default, not a misconfiguration.** `CacheKeyPrefixOptions` is bound with a bare `services.Configure`
  and no validation, because an absent section must leave cache keys exactly as callers write them (a
  single call inside `AddCaching`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:46`, the method
  starting at `:30`).
  `LayoutSettings` binds with `AddOptions().Bind()` and nothing after it for the same reason: it is
  optional footer copy (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:52-53`,
  the reason at `:51`), and four sections registered beside it bind exactly the same way, each with its
  reason in a comment beside the binding: `LegalSettings` (`:57-58`, an absent section leaves every
  legal link empty, the reason at `:55-56`), `RegistrationSettings` (`:62-63`, an absent section keeps
  every register-page block, the reason at `:60-61`), `SignInSettings` (`:67-68`, an absent section
  offers no new sign-in action, the reason at `:65-66`), and `NotificationBellOptions` (`:71-72`, an
  absent section leaves the compiled-in defaults, the reason at `:70`). `LegalAcceptanceOptions` binds
  the same way inside the opt-in `AddLegalAcceptance`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Auth.cs:144-145`), because
  its one setting has no invalid value (any version string turns the feature on, null or whitespace
  turns it off); the reason sits in a comment at the call (`:141-143`), and the method's XML remarks
  (`:135-136`) add that registration asks for acceptance only while `Legal:CurrentTermsVersion` is set.
  The cloud adapter packages bind their six vendor sections with a bare `AddOptions<T>().Bind(...)` and
  no validation, in one of two orders. The four file-storage and hub methods bind first and then read
  the section back: `AzureBlobFileStorageSettings`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureServiceCollectionExtensions.cs:48-49`, read back at
  `:51`), `AzureNotificationHubSettings` (`:90-91`, read back at `:93`), `S3FileStorageSettings`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsServiceCollectionExtensions.cs:55-56`, read back at
  `:58`) and `GcsFileStorageSettings`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GcpServiceCollectionExtensions.cs:53-54`, read back at
  `:56`). The SNS and FCM push methods reverse the order: they read the section first, return early
  unless `NativePush:Enabled` is true and the section is complete, and only then bind
  `SnsNativePushSettings` (`AwsServiceCollectionExtensions.cs`, read at `:179`, bound at `:190`) and
  `FcmNativePushSettings` (`GcpServiceCollectionExtensions.cs`, read at `:154`, bound at `:162`), so with push
  off those two register no options at all. Either way each method turns itself into a no-op when its
  section is absent or incomplete, so a host registers it unconditionally and switches the feature on
  by configuration alone. The one guard is the `CloudAdapterTripwireOptions` marker above: a host that
  sets `NativePush:Enabled` while `INativePushSender` is still `NullNativePushSender` fails at startup,
  whether it made no adapter call or made one whose push section is incomplete (the check at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwire.cs:77-78`, the
  message naming both causes at `:81`, the validator at `:32`; the same validator collects the passkey
  and machine-client failures at `:64-69` and `:71-75` and reports every failure together), so an
  incomplete push section with push switched on fails the host rather than becoming a silent no-op, while
  file storage is deliberately unchecked because a `FileStorage` section is routinely shared
  configuration and the core default fails every upload loudly instead (`:24-28`).
  `DataSourcesSettings` is the one exception with a mechanical rather than a policy reason: it is
  constructed directly from the section rather than through `AddOptions`, because a root-level dictionary
  section does not bind through the options pipeline
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:88-90`, the reason at
  `:86-87`), and it still counts because the result is registered for runtime resolution (`:91`). A
  plain `Get<T>()` that a registration method uses only to decide what to register, and never puts in
  the container, is not an exception: like the `Get<MessageBusSettings>()` above, the reads of
  `RdsIamAuthenticationSettings`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsServiceCollectionExtensions.cs:112`),
  `CloudSqlIamAuthenticationSettings`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GcpServiceCollectionExtensions.cs:95`) and
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
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:94-95`, the reason at `:90-93`).
  `MultiFactorAuthorizationSettings` is the sixteenth: it is bound inside a `Configure<IServiceProvider>`
  delegate with no `ValidateDataAnnotations()` and no `ValidateOnStart()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:142-144`, in
  the private `AddMultiFactorRoleRequirement` starting at `:129`). Its comment (`:140-141`) explains only
  the `GetService` lookup (a host with no `IConfiguration` binds nothing and the rule stays off), not
  why the section skips validation, so it is the one framework exception without a stated reason.
- **Consumer hosts take the same escape five times, and write the reason at the call site.** ADC's
  Engagement service binds `PointsSettings`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:94-95`, the reason at `:91-93`),
  `CheckInSettings` (`:100-101`, the reason at `:97-99`) and `TicketSettings` (`:106-107`, the reason at
  `:103-105`) without `ValidateOnStart`: the defaults are working values and an explicit zero is the
  documented per-rule kill switch, so no value an organizer could set should stop that host from booting
  mid-conference. ADC's Conference service binds `RoomCheckInSettings` the same way
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:313-314`, the reason at `:310-312`),
  and its Identity service binds `InviteEmailSettings`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:207-208`, the reason at `:205-206`: an
  unset app-store link is left out of the invitation email). One consumer module does the same: ADC's
  Conference module binds `SessionizeSettings` with `BindConfiguration` alone
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:38-39`,
  the reason at `:36-37`: a missing section keeps the default response ceiling). All six follow the rule
  the framework's other fifteen follow: an exception is legitimate when the
  section has no invalid value, and the reason belongs in a comment beside the binding rather than left
  to be inferred from its absence.

**Every layer reads a bound section the same way.** Inside Infrastructure and API that is a constructor
or per-request `IOptions<T>`: `OutboxProcessor`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:64`),
`BrokerEventBus` (`.../Messaging/BrokerEventBus.cs:35`), `LoginProtectionService`
(`.../Auth/LoginProtectionService.cs:40`), `RsaJwksProvider` (`.../Auth/RsaJwksProvider.cs:14`),
`SQLServerDbContext` (`.../Persistence/DbContexts/SQLServerDbContext.cs:36`), and `IdempotencyFilter`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:443`), and so does the
framework's `/client-config` minimal-API handler, which reads `IOptions<ApiSettings>`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/ClientConfig/ClientConfigEndpointExtensions.cs:78`)
and which ADC's web host maps with `app.MapClientConfigEndpoint`
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:272`). Consumer code reads its own sections the
same way: Store's Sales Infrastructure in `StripeClientFactory.cs:37`, `StripePaymentService.cs:63` (and
`:67`), `StripeWebhookRegistrationService.cs:49`, `StripeTaxCalculator.cs:24`,
`PaymentReconciliationService.cs:71-72` and `PaymentReconciliationSettingsValidator.cs:22`.

The Application layer names the options pipeline too, and the framework names it in fourteen of its
own classes, thirteen by constructor injection and one by resolving it from a scope: `AuthenticationServiceBase<TUser>` takes an optional
`IOptions<EmailConfirmationSettings>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:81`),
`AuthSessionIssuer` takes `IOptions<RefreshSessionSettings>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Sessions/AuthSessionIssuer.cs:57`),
`ViewAsService` takes `IOptions<ViewAsSettings>` (`.../Auth/ViewAs/ViewAsService.cs:46`),
`MachineClientService` takes `IOptions<MachineClientSettings>`
(`.../Auth/MachineClients/MachineClientService.cs:41`), `PasskeyService` takes
`IOptions<PasskeySettings>` (`.../Auth/Passkeys/PasskeyService.cs:34`),
`AuthenticationValidators` takes an optional `IOptions<LegalAcceptanceOptions>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationValidators.cs:30`), the two
sign-in-link bases take `IOptions<SignInLinkSettings>`, `SendSignInLinkHandlerBase`
(`.../Users/UseCases/SignInLinks/SendSignInLinkHandlerBase.cs:48`) and `RedeemSignInLinkHandlerBase`
(`.../Users/UseCases/SignInLinks/RedeemSignInLinkHandlerBase.cs:62`), three webhook classes read
`IOptions<WebhookSettings>`, `DeliverWebhookInternalCommandHandler`
(`.../Webhooks/Delivery/DeliverWebhookInternalCommandHandler.cs:29`) and `WebhookSubscriptionService`
(`.../Webhooks/Subscriptions/WebhookSubscriptionService.cs:30`) in the constructor and
`WebhookFanOutHandler` by resolving it from a scope (`.../Webhooks/Delivery/WebhookFanOutHandler.cs:62`), the shared
`ForgotPasswordHandlerBase` takes `IOptions<PasswordResetSettings>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:41`),
`SendEmailConfirmationHandlerBase` takes `IOptions<EmailConfirmationSettings>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/EmailConfirmation/SendEmailConfirmationHandlerBase.cs:55`),
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
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/Points/Services/PointsAwarder.cs:32`),
`GetLeaderboardHandler` (`.../Points/UseCases/GetLeaderboard/GetLeaderboardHandler.cs:30`) and
`RecordRoomCheckInHandler`, which takes two, `IOptions<CheckInSettings>` and `IOptions<PointsSettings>`
(`.../CheckIns/UseCases/RecordRoomCheckIn/RecordRoomCheckInHandler.cs:47` and `:48`).
Store adds thirteen, with the same shape: its Identity `AuthenticationService` takes the same single
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
`OrderChargesCalculator`, which takes `IOptions<ShippingSettings>`
(`.../Orders/Charges/OrderChargesCalculator.cs:25`), the two guest-order senders that take
`IOptions<CheckoutRedirectSettings>`, `SendGuestOrderLinkInternalCommandHandler`
(`.../Orders/InternalCommands/SendGuestOrderLinkInternalCommandHandler.cs:38`) and
`GuestOrderPlacedNotifier` (`.../Orders/UseCases/GuestCheckout/GuestOrderPlacedNotifier.cs:30`),
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
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:410`;
  `AiSettings` inserts a `PostConfigure`, `MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:123-128`;
  `McpSettings` carries an inline `.Validate(...)` delegate in place of `ValidateDataAnnotations()`,
  `MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHostingExtensions.cs:58-63`;
  `MachineClientSettings` and `PasskeySettings` drop `ValidateDataAnnotations()` and rely on a validator,
  `DependencyInjection.MachineClients.cs:41-45` and
  `MMCA.Common/Source/Core/MMCA.Common.Passkeys/PasskeysServiceCollectionExtensions.cs:41-44`;
  Store's `StoreTimeZoneSettings` inserts a delegate `.Validate(...)`,
  `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/CatalogModule.cs:40-44`; the gRPC
  package's `DefaultSchemeGuard` binds no section at all and validates through a
  `.Validate<IOptions<AuthenticationOptions>>(...)` delegate,
  `ServiceTokenServiceCollectionExtensions.cs:81-85`; the two startup tripwires,
  `CloudAdapterTripwireOptions` and `HostIntegrationTripwireOptions`, and the Application package's
  `WebhookSettings` are a bare
  `AddOptions<T>().ValidateOnStart()` with no `Bind` and no annotations, checked only by an
  `IValidateOptions<T>`, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:244`,
  `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:50` and
  `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.Webhooks.cs:98`), a grep for
  `ValidateOnStart` is a complete inventory of what a host validates at boot: the
  forty-five framework registrations, plus whatever the host and its modules add. Collapsing the two
  host-owned sections into `AddModuleHost` shortens that inventory rather than hiding it, since the pair
  is now read once in the framework instead of eight times across the repos.

## Trade-offs
- **Nothing enforces it.** There is no architecture fitness test asserting that a new `AddOptions<T>` call
  carries `ValidateDataAnnotations().ValidateOnStart()`. The uniformity above is convention held by review,
  not a gate, which is weaker than the invariant-over-discipline posture ADR-015 applies elsewhere. A
  section added without the chain fails silently, which is to say it fails later. Sixteen framework bindings,
  five consumer-host bindings and one consumer-module binding sit off the chain by choice, and nothing in the build distinguishes
  those from a section whose author simply forgot: only a source comment near each one does, and `MultiFactorAuthorizationSettings` lacks even that (for
  the six
  cloud adapter sections the reason sits only in
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
  `IValidateOptions<T>`, and both escape hatches are in use in the framework: the former five times, the
  latter eleven times. `JwtSettings` implements `IValidatableObject`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:16`), and so do `AiSettings`
  (`MMCA.Common/Source/Core/MMCA.Common.AI/AiSettings.cs:23`), whose section is bound with the full chain
  (`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:123-128`), `ContentPolicySettings`
  (`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ContentPolicySettings.cs:23`) and
  `ServiceTokenSettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/Authentication/ServiceTokenSettings.cs:18`), and
  `JwksSettings` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwksSettings.cs:25`), whose
  section is bound with the full chain (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:220-223`)
  and which fails startup on an additional key with a missing, over-long or repeated `kid` (the
  current `KeyId` included) or with key material that is absent or does not load (`:79-116`). Eleven validator
  classes sit beside a chain instead, each registered with `TryAddEnumerable` so two modules calling the
  same registration method cannot run the validation twice.
  `AiProviderValidator`
  (`MMCA.Common/Source/Core/MMCA.Common.AI/Providers/AiProviderValidator.cs:16`, registered at
  `MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:94`) exists because whether the
  configured provider names a registered `IAiProviderFactory` depends on what the host registered, which
  no annotation on `AiSettings` can see.
  `TenancySettingsValidator`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettingsValidator.cs:24-25`,
  registered at `DependencyInjection.cs:328-329`) exists because confirming that a tenant's data-source
  override names a real physical source needs `IDataSourceResolver`, which no annotation can reach.
  `ConnectionStringSettingsValidator`
  (`.../Persistence/DataSources/ConnectionStringSettingsValidator.cs:30-31`,
  registered at `DependencyInjection.cs:83-84`) exists because the "a host must reach some database" rule
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
  `GatewayReverseProxyExtensions.cs:70-71`) exists because
  `ValidateDataAnnotations()` does not recurse into the nested trace-header and health-check objects,
  so their `[Required]` values would otherwise never be checked at startup.
  `CloudAdapterTripwire`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwire.cs:32`,
  registered at `DependencyInjection.cs:245-246`) and `HostIntegrationTripwire`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Integrations/HostIntegrationTripwire.cs:15`,
  registered at `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:51-52`) validate marker
  types that carry no data at all, because what they check is whether a vendor adapter or opt-in
  registration call was made, which only the registered services can show.
  `MachineClientSettingsValidator`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/MachineClients/MachineClientSettingsValidator.cs:15`,
  registered at `DependencyInjection.MachineClients.cs:44-45`) and `PasskeySettingsValidator`
  (`MMCA.Common/Source/Core/MMCA.Common.Passkeys/PasskeySettingsValidator.cs:12`, registered at
  `PasskeysServiceCollectionExtensions.cs:44`) validate sections whose chains carry no
  `ValidateDataAnnotations()`, and `WebhookRegistrationValidator`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/WebhookRegistrationValidator.cs:13`,
  registered at `MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.Webhooks.cs:99`)
  is the only check that bare `WebhookSettings` registration adds (the annotations come from the
  Infrastructure `AddWebhooks` chain on the same type). The cost of
  the second form is that the rule
  leaves the settings type and has to be registered separately, so a host that binds the section without
  also registering the validator validates less than it appears to. Store uses both forms on its own
  sections: two separate validators registered with `TryAddEnumerable` beside their chains,
  `StripeSettingsValidator` (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/SalesModule.cs:59-60`)
  and `PaymentReconciliationSettingsValidator` (`:89-90`, the reason at `:87-88`), and an
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

## Revision (2026-10-28)
Re-verified against current source. The decision, the rationale, the thirty-seven framework
registrations (a grep still finds 39 `ValidateOnStart()` calls in 22 files under `MMCA.Common/Source`,
the host-owned pair included), the fifteen framework exceptions, the eight custom validators and ADC's
seven Application injections are unchanged; Store's Sales module grew two sections and its Application
layer three injections.

1. Store's Sales module now binds eight sections with `BindConfiguration`, each with
   `ValidateDataAnnotations().ValidateOnStart()`: `StripeSettings`, `CheckoutRedirectSettings`,
   `UnpaidOrderExpirySettings`, `ShippingSettings`, `TaxSettings`, `PaymentReconciliationSettings`,
   `DenormalizationBackfillSettings` and `OrderFulfilledBackfillSettings`
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/SalesModule.cs:52-55`, `:57-60`, `:62-65`,
   `:67-70`, `:72-75`, `:77-80`, `:87-90`, `:92-95`).
2. Store's Application layer names thirteen `IOptions` injections rather than ten. The three added are
   `OrderChargesCalculator` (`IOptions<ShippingSettings>`,
   `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/Charges/OrderChargesCalculator.cs:25`),
   `SendGuestOrderLinkInternalCommandHandler` (`IOptions<CheckoutRedirectSettings>`,
   `.../Orders/InternalCommands/SendGuestOrderLinkInternalCommandHandler.cs:38`) and
   `GuestOrderPlacedNotifier` (`IOptions<CheckoutRedirectSettings>`,
   `.../Orders/UseCases/GuestCheckout/GuestOrderPlacedNotifier.cs:30`).
3. Store's Sales Infrastructure list of `IOptions` readers now also names `StripeTaxCalculator`
   (`IOptions<TaxSettings>`,
   `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripeTaxCalculator.cs:24`)
   and `PaymentReconciliationSettingsValidator`, which reads `IOptions<UnpaidOrderExpirySettings>`
   (`.../Payments/Reconciliation/PaymentReconciliationSettingsValidator.cs:22`).
4. Anchors re-verified against current source: the `PaymentReconciliationSettingsValidator`
   registration (`SalesModule.cs:84-85`, the reason at `:82-83`); ADC UI Web `MapClientConfigEndpoint`
   (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:272`); ADC Engagement `PointsAwarder`
   (`.../Points/Services/PointsAwarder.cs:32`).

## Revision (2026-11-04)
MMCA.Common 1.277.0 adds `JwksSettings.AdditionalKeys` (see
[ADR-004](004-authentication-dual-fetch.md)). The decision, the rationale and the framework
registration count are unchanged: `JwksSettings` keeps its existing chain.
1. `JwksSettings` now implements `IValidatableObject`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwksSettings.cs:25`, `Validate` at `:79`),
   because the annotations on `JwksAdditionalKey` are not reached by `ValidateDataAnnotations()` on the
   parent list. Every additional key needs a `kid` of at most 64 characters, distinct from every other
   entry and from the current `KeyId` (`:81`, `:88-99`), and key material that loads (`:101-114`), so
   a duplicate `kid` or a malformed PEM fails the host at startup. The Trade-offs count of
   `IValidatableObject` types is now five.
2. `TokenService` gained a field above its constructor, so the `IOptions<JwtSettings>` and
   `IOptions<JwksSettings>` parameters moved to
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:73` and `:77`.
3. Anchors re-verified against current source: the `JwksSettings` chain
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:197-200`), the
   `JwtSettings` chain in `AddCommonAuthentication`
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:135-138`)
   and `RsaJwksProvider` (`.../Auth/RsaJwksProvider.cs:14`).

## Revision (2026-11-23)
Re-verified against current source. The decision, the rationale, the five `IValidatableObject` types and the `AddModuleHost` pair are unchanged; the inventory
grew. A grep now finds 47 `ValidateOnStart()` calls in 28 files under `MMCA.Common/Source`, which is
forty-five framework registrations once the host-owned pair is set aside.
1. The Infrastructure package holds twenty-five registrations rather than twenty. `ViewAsSettings`
   joins the chains inside `AddInfrastructure`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:193-196`), so thirteen
   reach every host, and four opt-in chains join the seven: `SignInLinkSettings`
   (`DependencyInjection.Auth.cs:108-111`), `FeatureFlagOverrideSettings`
   (`DependencyInjection.FeatureFlags.cs:64-67`), `MachineClientSettings`
   (`DependencyInjection.MachineClients.cs:41-43`) and `WebhookSettings`
   (`Webhooks/WebhookServiceCollectionExtensions.cs:71-74`). The partial class now spans nine files.
2. Outside the Infrastructure package there are twenty registrations rather than seventeen:
   `PasskeySettings`
   (`MMCA.Common/Source/Core/MMCA.Common.Passkeys/PasskeysServiceCollectionExtensions.cs:41-43`),
   `McpSettings` (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHostingExtensions.cs:58-63`) and
   the bare Application `WebhookSettings` registration
   (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.Webhooks.cs:98`). The Rationale
   lists their chain variants, and `AiSettings` now inserts a `PostConfigure`
   (`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:123-128`).
3. `CloudAdapterTripwire` also fails `Passkeys:Enabled` with no passkey ceremony registered and
   `MachineClients:Enabled` with machine clients not registered, and it reports every failure together
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwire.cs:64-69`,
   `:71-75`, `:85`, the reasons at `:37-49`). The `HostIntegrationTripwireOptions` reason now also names a key-ring blob with no
   DataProtection sink (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:46-49`).
4. Eleven custom validators rather than eight: `MachineClientSettingsValidator`
   (`.../Auth/MachineClients/MachineClientSettingsValidator.cs:15`), `PasskeySettingsValidator`
   (`MMCA.Common/Source/Core/MMCA.Common.Passkeys/PasskeySettingsValidator.cs:12`) and
   `WebhookRegistrationValidator`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/WebhookRegistrationValidator.cs:13`).
5. `UiReadCacheOptions` no longer exists in `MMCA.Common/Source`. `SignInSettings` binds off the chain in
   its place (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:67-68`, the reason
   at `:65-66`), `MultiFactorAuthorizationSettings` binds off the chain with no stated reason
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Authorization/AuthorizationExtensions.cs:142-144`), so
   the framework exceptions number sixteen, and `NotificationBellOptions` now
   carries its own reason comment (`:70`).
6. Consumer hosts take the escape five times rather than twice: ADC Engagement adds `TicketSettings`
   (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:106-107`), ADC Conference binds
   `RoomCheckInSettings` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:313-314`) and
   ADC Identity binds `InviteEmailSettings`
   (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:207-208`), each with its reason
   beside the binding. ADC's Conference module also binds `SessionizeSettings` off the chain
   (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:38-39`,
   the reason at `:36-37`).
7. ADC's four and Store's three service hosts call `builder.AddMmcaServiceHost`
   (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:82`,
   `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:32`), and the
   `MMCA.Common.ServiceHost` package calls `AddModuleHost`
   (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:100`).
8. Store's Sales module binds six sections rather than eight: the two backfill settings and their
   services no longer exist in `MMCA.Store/Source`, so their reader citations are removed. A
   `StripeSettingsValidator` now sits beside the `StripeSettings` chain
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/SalesModule.cs:59-60`).
9. The framework's Application layer names `IOptions` in fourteen classes rather than six; the eight
   added are `ViewAsService`, `MachineClientService`, `PasskeyService`, `SendSignInLinkHandlerBase`,
   `RedeemSignInLinkHandlerBase`, `DeliverWebhookInternalCommandHandler`, `WebhookSubscriptionService`
   and `WebhookFanOutHandler` (the last resolving it from a scope).
10. Anchors re-verified against current source: `AddInfrastructure` (`DependencyInjection.cs:58`) and
    its chains (`:73-76`, `:99-102`, `:145-148`, `:150-153`, `:155-158`, `:161-164`, `:169-172`,
    `:215-218`, `:220-223`), the `AddCaching` call (`:141`) and `AddInternalCommands` call (`:275`),
    the tripwire marker (`:244`, `:245-246`, the push reason `:240-243`), `AddMultiTenancy` (`:320`, `:322-325`,
    `:328-329`), `ConnectionStringSettingsValidator` registration (`:83-84`), `DataSourcesSettings`
    (`:88-90`, `:86-87`, `:91`); `DependencyInjection.Auth.cs` (`:48-51`, `:81-84`, `:176-179`,
    `LegalAcceptanceOptions` `:144-145`, `:141-143`, `:135-136`); `DependencyInjection.Notifications.cs`
    (`:43-46`, `:41`); `DependencyInjection.Caching.cs` (`:30`, `:46`, `:48-51`, `:53-56`, `:60-61`);
    `CloudAdapterTripwire.cs` (`:32`, `:77-78`, `:81`, `:24-28`); the UI shared bindings
    (`DependencyInjection.cs:43`, `:46-49`, `:52-53`, `:57-58`, `:62-63`, `:71-72`); the API
    `IdempotencySettings` (`:78-81`) and `OwnerOrAdminFilterOptions` (`:94-95`, `:90-93`); `JwtSettings`
    (`WebApplicationBuilderExtensions.Authentication.cs:136-139`, `:134`); `RateLimitingSettings`
    (`:410`); `GatewayRateLimitingSettings` (`:375-378`, `:369`); `GatewaySettings`
    (`GatewayReverseProxyExtensions.cs:63-66`, `:56`, validator `:70-71`); `ServiceTokenSettings`
    (`:110-113`, `:103`) and `DefaultSchemeGuard` (`:81-85`, `:77-80`); `UiRateLimitingSettings`
    (`:222-225`, `:217`); the cloud adapter bindings (Azure `:48-49`, `:51`, `:90-91`, `:93`; AWS
    `:55-56`, `:58`, `:112`, `:179`, `:190`; GCP `:53-54`, `:56`, `:95`, `:154`, `:162`); the Engagement
    bindings (`:94-95`, `:91-93`, `:100-101`, `:97-99`); Helpdesk `Program.cs` (`:20-23`, `:109-112`);
    `OutboxProcessor.cs:64`, `LoginProtectionService.cs:40`, `ClientConfigEndpointExtensions.cs:78`,
    `EntityControllerBase.cs:62` and `:82`; `AuthenticationServiceBase.cs:81`, `AuthSessionIssuer.cs:57`,
    `AuthenticationValidators.cs:30`, `SendEmailConfirmationHandlerBase.cs:55`; `AiSettings.cs:23`;
    Store `PaymentReconciliationSettingsValidator` registration (`SalesModule.cs:89-90`, `:87-88`).

## Related
ADR-025 (startup warm-up and readiness gating: this contract decides what happens *before* a host reaches
that machinery), ADR-031 (feature flags read from configuration, whose section this contract governs the
binding of), ADR-061 (where a secret value comes from at runtime; this decides what the host does when it
does not arrive), ADR-015 (architecture fitness functions, the enforcement mechanism this contract
currently lacks).
