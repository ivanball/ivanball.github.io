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
in the consumer-host paragraph corrected to eight; source citations re-anchored).

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
  is the required form (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:78-81`).
  `.BindConfiguration(T.SectionName)` is the accepted shorthand for the `Bind(GetSection(...))` step and
  is what Store's Sales module uses
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/SalesModule.cs:48-51`, `:53-56`, `:58-61`).
  `ValidateOnStart()` is the load-bearing link: without it the annotations are evaluated lazily on first
  resolution, which is exactly the first-use failure the contract exists to prevent.
- **The framework owns the base set.** Fifteen sections are bound this way in the Infrastructure package's
  `DependencyInjection.cs` alone. Nine sit directly inside `AddInfrastructure` (`ConnectionStringSettings`
  `:78-81`, `SmtpSettings` `:99-102`, `PersistenceSettings` `:135-138`, `OutboxSettings` `:140-143`,
  `LoginProtectionSettings` `:145-148`, `PasswordResetSettings` `:151-154`, `RefreshSessionSettings`
  `:159-162`, `MessageBusSettings` `:174-177`, `JwksSettings` `:179-182`), and two more arrive through the
  `services.AddCaching(configuration)` call that `AddInfrastructure` itself makes (`:131`):
  `CacheSettings` (`:246-249`) and `QueryCachePipelineSettings` (`:251-254`). Those eleven reach every host
  that registers the package. The remaining four sit in opt-in registration methods a host calls only when
  it wants the feature: `SchedulerSettings` in `AddScheduledJobs` (`:407-410`), `AuditTrailSettings` in
  `AddAuditTrail` (`:478-481`), `TenancySettings` in `AddMultiTenancy` (`:527-530`), and
  `PushNotificationSettings` in `AddPushNotifications` (`:631-634`). The two cache sections take the chain
  only when the caller passes configuration: the parameterless `AddCaching` overload registers both
  unbound (`:258-259`), so `IOptions<T>` resolves to the compiled-in defaults instead of failing a caller
  that configures no cache section at all. Five more are bound outside that file: `IdempotencySettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:70-73`), `JwtSettings`, bound
  inside `AddCommonAuthentication`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:541-544`,
  the method starting at `:539`), `ApiSettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:37-40`),
  `GatewayRateLimitingSettings`, bound by the Aspire hosting package's `AddGatewayRateLimiting`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Gateway/GatewayRateLimitingExtensions.cs:194-197`), and
  `GatewaySettings`, bound by the Gateway package's `AddMmcaGateway`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Gateway/GatewayReverseProxyExtensions.cs:54-57`).
  Twenty framework registrations in all.
- **Each service host adds exactly two of its own**, `ApplicationSettings` and `ModulesSettings`, and the
  same pair of chains covers all eight hosts across the three application repos. Seven of the eight reach
  them through one shared framework call rather than an inline copy: `AddModuleHost` binds and validates
  both sections before it builds the host's `ModuleLoader`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/ModuleHostExtensions.cs:61-64` and `:69-72`,
  the method starting at `:51`), so ADC's four services
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:309-311`, and the comment at `:300`
  says what the call binds) and Store's three
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:123-125`) each declare the two
  sections in a single line of host code. The Helpdesk monolith seed still writes both chains out in its
  own `Program.cs` (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:18-21` and `:82-85`), which is
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
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs:55`), `SmtpEmailSender`
  takes `IOptions<SmtpSettings>` (`.../Mail/SmtpEmailSender.cs:12`), `RepositoryFactory` takes
  `IOptions<ApplicationSettings>`
  (`.../Persistence/Repositories/Factory/RepositoryFactory.cs:15`), and `EntityControllerBase` resolves
  the same options per request in its `MaxPageSize` and `MaxExportRows` accessors
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:62` and `:82`).
  Settings classes declare `get`/`init` members only
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Mail/SmtpSettings.cs:18-37`), so the value a
  consumer reads is one it cannot rebind, and there is no second type per section to keep in step with
  the class the chain binds and validates.
- **Eight recorded exceptions in the framework, on one shared reason: an absent section is a working
  default, not a misconfiguration.** `CacheKeyPrefixOptions` is bound with a bare `services.Configure`
  and no validation, because an absent section must leave cache keys exactly as callers write them (a
  single call inside `AddCaching`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:244`, the method starting
  at `:229`).
  `LayoutSettings` binds with `AddOptions().Bind()` and nothing after it for the same reason: it is
  optional footer copy (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:43-44`),
  and the two client-side sections registered beside it bind exactly the same way because an absent
  section leaves the compiled-in defaults: the staleness policy `UiReadCacheOptions` (`:48-49`) and
  `NotificationBellOptions` (`:51-52`).
  `NativePushSettings` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:664-665`)
  and `FileStorageSettings` (`:696-697`) bind the same way inside their opt-in registration methods,
  both of which read the section back and turn themselves into a no-op when it is absent or incomplete,
  so a host registers them unconditionally and switches the feature on by configuration alone.
  `SecurityHeadersSettings` binds through an options builder that calls `.Bind` only when configuration
  was supplied at all, because the same call accepts a code-only `Action<SecurityHeadersSettings>`
  instead (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs:226-234`, the
  method starting at `:220`).
  `DataSourcesSettings` is the one exception with a mechanical rather than a policy reason: it is
  constructed directly from the section rather than through `AddOptions`, because a root-level dictionary
  section does not bind through the options pipeline
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:93-95`).
- **Consumer hosts take the same escape twice, and write the reason at the call site.** ADC's Engagement
  service binds `PointsSettings`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:126-127`) and `CheckInSettings`
  (`:133-134`) without `ValidateOnStart`: the defaults are working values and an explicit zero is the
  documented per-rule kill switch, so no value an organizer could set should stop that host from booting
  mid-conference. Both follow the rule the framework's eight follow: an exception is legitimate when the
  section has no invalid value, and the reason belongs in a comment beside the binding rather than left
  to be inferred from its absence.

**Every layer reads a bound section the same way.** Inside Infrastructure and API that is a constructor
or per-request `IOptions<T>`: `OutboxProcessor`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:59`),
`BrokerEventBus` (`.../Messaging/BrokerEventBus.cs:35`), `LoginProtectionService`
(`.../Auth/LoginProtectionService.cs:21`), `RsaJwksProvider` (`.../Auth/RsaJwksProvider.cs:14`),
`SQLServerDbContext` (`.../Persistence/DbContexts/SQLServerDbContext.cs:36`), and `IdempotencyFilter`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:428`). Consumer code
reads its own sections the same way: Store's Sales Infrastructure in `StripeClientFactory.cs:19`,
`StripePaymentService.cs:60`, `StripeWebhookRegistrationService.cs:27` and
`PaymentReconciliationService.cs:35-36`, and ADC's web host in its `/client-config` minimal-API handler
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:148`).

The Application layer names the options pipeline too, and the framework supplies three of those
injections itself: `AuthenticationServiceBase<TUser>` takes `IOptions<RefreshSessionSettings>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:61`), the shared
`ForgotPasswordHandlerBase` takes `IOptions<PasswordResetSettings>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:40`),
and `CachingQueryDecorator` takes an optional `IOptions<QueryCachePipelineSettings>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/CachingQueryDecorator.cs:48`).
ADC adds five: its Identity `AuthenticationService`
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:55`) and
`ForgotPasswordHandler` (`.../Users/UseCases/ForgotPassword/ForgotPasswordHandler.cs:25`), and in
Engagement `PointsAwarder`
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/Points/Services/PointsAwarder.cs:31`),
`GetLeaderboardHandler` (`.../Points/UseCases/GetLeaderboard/GetLeaderboardHandler.cs:30`) and
`RecordRoomCheckInHandler` (`.../CheckIns/UseCases/RecordRoomCheckIn/RecordRoomCheckInHandler.cs:32`).
Store adds three: its Identity `AuthenticationService`
(`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs:30`)
and `ForgotPasswordHandler` (`.../Users/UseCases/ForgotPassword/ForgotPasswordHandler.cs:26`), and
`CreateCheckoutSessionCommandValidator`
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/CreateCheckoutSession/CreateCheckoutSessionCommandValidator.cs:22`).
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
  members are what make the value unwritable at the point of use, and the validation that ran at boot
  covers every reader because there is only one bound instance to read.
- **One shape makes the contract auditable.** Because the chain is textually identical everywhere it
  appears, a grep for `ValidateOnStart` is a complete inventory of what a host validates at boot: the
  twenty framework registrations, plus whatever the host and its modules add. Collapsing the two
  host-owned sections into `AddModuleHost` shortens that inventory rather than hiding it, since the pair
  is now read once in the framework instead of eight times across the repos.

## Trade-offs
- **Nothing enforces it.** There is no architecture fitness test asserting that a new `AddOptions<T>` call
  carries `ValidateDataAnnotations().ValidateOnStart()`. The uniformity above is convention held by review,
  not a gate, which is weaker than the invariant-over-discipline posture ADR-015 applies elsewhere. A
  section added without the chain fails silently, which is to say it fails later. Eight framework bindings
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
  `IValidateOptions<T>`, and both escape hatches are in use: the former once, the latter twice.
  `JwtSettings` is the only settings type implementing `IValidatableObject`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:16`). Two sections carry a
  separate validator class instead, each registered with `TryAddEnumerable` beside the chain that binds
  it so two modules calling the same registration method cannot run the validation twice.
  `TenancySettingsValidator`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Tenancy/TenancySettingsValidator.cs:23-24`,
  registered at `DependencyInjection.cs:533-534`) exists because confirming that a tenant's data-source
  override names a real physical source needs `IDataSourceResolver`, which no annotation can reach.
  `ConnectionStringSettingsValidator`
  (`.../Persistence/DataSources/ConnectionStringSettingsValidator.cs:30-31`,
  registered at `DependencyInjection.cs:88-89`) exists because the "a host must reach some database" rule
  spans two sections at once, `ConnectionStrings` and `DataSources`, so a SQLite-only host that declares
  its databases as named sources is legitimate while a host declaring none anywhere is not. The cost of
  the second form is that the rule
  leaves the settings type and has to be registered separately, so a host that binds the section without
  also registering the validator validates less than it appears to.
- **A bound value is a snapshot.** `IOptions<T>` captures the instance built at binding time and never
  observes a configuration reload. A section that genuinely needs reload would have to move to
  `IOptionsMonitor<T>`, and none does today.

## Related
ADR-025 (startup warm-up and readiness gating: this contract decides what happens *before* a host reaches
that machinery), ADR-031 (feature flags read from configuration, whose section this contract governs the
binding of), ADR-061 (where a secret value comes from at runtime; this decides what the host does when it
does not arrive), ADR-015 (architecture fitness functions, the enforcement mechanism this contract
currently lacks).
