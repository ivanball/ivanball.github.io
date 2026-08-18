# ADR-070: Fail-Fast Configuration Contract

## Status
Accepted (2026-08-07). Revised 2026-08-14 (source citations re-anchored; the consumer-repo facade
claim narrowed to production code, with the controller-test exception recorded).

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
**Bind every settings section through a validating chain that runs at startup, and expose a settings
type through a read-only interface when it must be read above Infrastructure.**

- **One binding shape, used everywhere.**
  `AddOptions<T>().Bind(configuration.GetSection(T.SectionName)).ValidateDataAnnotations().ValidateOnStart()`
  is the required form (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:67-70`).
  `.BindConfiguration(T.SectionName)` is the accepted shorthand for the `Bind(GetSection(...))` step and
  is what Store's Sales module uses
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/SalesModule.cs:47-50`, `:52-55`).
  `ValidateOnStart()` is the load-bearing link: without it the annotations are evaluated lazily on first
  resolution, which is exactly the first-use failure the contract exists to prevent.
- **The framework owns the base set.** Eight sections are bound this way in the Infrastructure package's
  `DependencyInjection.cs` alone: seven inside `AddInfrastructure` (`ConnectionStringSettings` `:67-70`,
  `SmtpSettings` `:81-84`, `PersistenceSettings` `:123-126`, `OutboxSettings` `:128-131`,
  `LoginProtectionSettings` `:133-136`, `MessageBusSettings` `:139-142`, `JwksSettings` `:144-147`) and an
  eighth in the opt-in `AddPushNotifications` (`PushNotificationSettings` `:530-533`). Three more are bound
  by the Presentation packages: `IdempotencySettings`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:70-73`), `JwtSettings`, bound
  inside `AddCommonAuthentication`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:502-505`),
  and `ApiSettings` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:32-35`).
- **Each service host adds exactly two of its own**, `ApplicationSettings` and `ModulesSettings`, and all
  eight hosts across the three application repos do it identically: ADC's four services (for example
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:170-173` and `:313-316`), Store's three
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:123-126` and `:226-229`), and the
  Helpdesk monolith seed (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:17-20` and `:75-78`).
  Modules may add their own sections on the same chain, as Store's Sales module does for Stripe.
- **Validation is data annotations, extended by `IValidatableObject` where a rule spans fields.**
  `JwtSettings` marks `Issuer` and `Audience` `[Required]`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/JwtSettings.cs:34-39`) and implements
  `IValidatableObject` (`:16`) so key material is checked conditionally on the selected algorithm: HS256
  demands a `SecretForKey` of at least 32 characters, RS256 demands `RsaPrivateKeyPem` (`:51-66`).
  `ValidateDataAnnotations()` invokes that method, so a host configured for RS256 with no private key
  fails to boot rather than failing to sign its first token.
- **Read-only interface facades over `IOptions`.** Five settings types are additionally registered as
  singletons that resolve `IOptions<T>.Value` and hand back an interface: `IApplicationSettings`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:31`), `IJwtSettings`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:65`),
  `IConnectionStringSettings` (`:71`), `ISmtpSettings` (`:85`), and `IPushNotificationSettings` (`:534-535`).
  The interfaces declare `get`/`init` members only
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/ISmtpSettings.cs:6-28`), so a consumer can
  read a setting and cannot rebind it. The interface for `IJwtSettings` lives in a file named
  `IJwSettings.cs` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Settings/IJwSettings.cs:10`); the
  type name, not the filename, is the contract.
- **Three recorded exceptions to the chain, all in the framework.** `CacheKeyPrefixOptions` is bound with
  a bare `services.Configure` and no validation, because an absent section must leave cache keys exactly
  as callers write them (a single call inside `AddCaching`,
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:172`, the method starting
  at `:164`).
  `LayoutSettings` is bound without validation for the same reason: it is optional footer copy
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:38-39`). `DataSourcesSettings` is
  constructed directly from the section rather than through `AddOptions`, because a root-level dictionary
  section does not bind through the options pipeline
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:75-77`).

**Adoption of the facade half is partial, and this ADR settles the direction rather than claiming the
state.** Only five of the framework's settings types have a facade; the rest are consumed as `IOptions<T>`
inside Infrastructure and API, which is where they belong: `OutboxProcessor`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxProcessor.cs:57`),
`BrokerEventBus` (`.../Services/BrokerEventBus.cs:34`), `LoginProtectionService`
(`.../Auth/LoginProtectionService.cs:21`), `RsaJwksProvider` (`.../Auth/RsaJwksProvider.cs:15`),
`SQLServerDbContext` (`.../Persistence/DbContexts/SQLServerDbContext.cs:37`), and `IdempotencyFilter`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:432`). The facades are
consumed only inside the framework: `EntityControllerBase` resolves `IApplicationSettings` per request at
two sites, its `MaxPageSize` and `MaxExportRows` accessors
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:60` and `:80`),
`RepositoryFactory` takes it in its constructor
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/Factory/RepositoryFactory.cs:14`),
`TokenService` takes `IJwtSettings` (`.../Services/TokenService.cs:47`), and `SmtpEmailSender` takes
`ISmtpSettings` (`.../Services/SmtpEmailSender.cs:12`). No consumer repo's production code resolves a
facade: nothing under `Source/` in ADC, Store, or Helpdesk references `IApplicationSettings`,
`IJwtSettings`, or `ISmtpSettings`. The only consumer references are in controller tests, and they exist
because of `EntityControllerBase`: Store registers a stand-in `IApplicationSettings` in six API test
fixtures so `MaxPageSize` resolves (for example
`MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.API.Tests/Controllers/ShoppingCartsControllerTests.cs:44`),
and six ADC Conference controller tests name it only in a comment recording that an empty provider yields
the default (for example
`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.API.Tests/Controllers/SponsorsControllerTests.cs:41`);
Helpdesk has no reference of either kind.
Where consumer code reads a setting it injects `IOptions<T>` directly (Store's Sales Infrastructure
in `StripeClientFactory.cs:21`, `StripePaymentService.cs:62`, `StripeWebhookRegistrationService.cs:29`,
`PaymentReconciliationService.cs:35-36`; ADC's web host in its `/client-config` minimal-API handler,
`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:145`, and its calendar component in
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Components/AddToCalendarButton.razor:7`).

The Application-layer invariant nevertheless holds today: no Application-layer file in any of the four
repos takes an `IOptions` dependency, because settings are read at the Infrastructure, API, and host
edges. The settled direction is therefore narrower than "never use `IOptions`": the **fail-fast chain is
mandatory for every section** other than the three recorded exceptions, and the **facade is the required
form only when a settings type must be read above Infrastructure**. Below that boundary `IOptions<T>` at
the point of consumption stays correct, and the direct injections listed above are conformant, not debt,
with the exception that new framework settings crossing into Application or controller code get a facade.

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
- **A facade keeps the options pipeline out of layers that should not name it.** `EntityControllerBase`
  and `RepositoryFactory` need one number each; taking `IApplicationSettings` rather than
  `IOptions<ApplicationSettings>` keeps `Microsoft.Extensions.Options` out of their signatures, and the
  `init`-only members make the setting unwritable at the point of use.
- **One shape makes the contract auditable.** Because the chain is textually identical in all eleven
  framework registrations and all sixteen host registrations, a grep for `ValidateOnStart` is a complete
  inventory of what a host validates at boot.

## Trade-offs
- **Nothing enforces it.** There is no architecture fitness test asserting that a new `AddOptions<T>` call
  carries `ValidateDataAnnotations().ValidateOnStart()`. The uniformity above is convention held by review,
  not a gate, which is weaker than the invariant-over-discipline posture ADR-015 applies elsewhere. A
  section added without the chain fails silently, which is to say it fails later.
- **Bad configuration becomes a crash loop, not a degraded start.** A deployed replica with a missing
  required value never reaches the warm-up and readiness machinery of ADR-025: it terminates at host build.
  That is the intended trade (no half-configured replica serves traffic), but it means a configuration
  mistake takes the whole rollout rather than one code path.
- **Two ways to read a setting coexist.** Five types have a facade and the rest do not, and no consumer
  repo's production code uses a facade at all, so a reader encounters both forms. The boundary above sets which is correct
  where, but it does not make the codebase look uniform today.
- **Data annotations are the vocabulary.** Anything richer needs `IValidatableObject` or a custom
  `IValidateOptions<T>`, and only `JwtSettings` reaches for the former today.
- **A facade is a snapshot.** Each facade is a singleton resolved from `IOptions<T>.Value`, so it captures
  the bound instance once and never observes a configuration reload. `IOptions<T>` itself has the same
  property; a section that genuinely needs reload would have to move to `IOptionsMonitor<T>`, and none
  does today.

## Related
ADR-025 (startup warm-up and readiness gating: this contract decides what happens *before* a host reaches
that machinery), ADR-031 (feature flags read from configuration, whose section this contract governs the
binding of), ADR-061 (where a secret value comes from at runtime; this decides what the host does when it
does not arrive), ADR-015 (architecture fitness functions, the enforcement mechanism this contract
currently lacks).
