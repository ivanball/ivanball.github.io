# ADR-122: Dev-Only Relaxations Are Environment-Gated and Fail Closed

## Status
Accepted (2026-09-11). Revised 2026-10-01: citations re-anchored. Revised 2026-10-06: the plain-check inventory adds the Development-only design-time database skip. Revised 2026-10-07: the inventory names the `!IsProduction()` OpenAPI and Scalar mappings as outside the rule, the UI-side null-aware pseudo-locale check, and the Serilog file sink as out of scope. Revised 2026-10-26: the session cookies now also set `Secure` on a Development HTTPS request, so only a plain-http Development run omits it, and the cookie bullet describes the session and culture cookies separately; CORS and pseudo-locale anchors refreshed. Revised 2026-11-17: `MapCommonScalarUi` and the Scalar dependency are removed (no host called it), so `MapCommonOpenApi` is the one `!IsProduction()` mapping the inventory names outside the rule (MMCA.Common v1.300.0). Revised 2026-11-23: the fail-closed gates grow from three to five (the webhook insecure-targets gate and the AI endpoint https rule), the cookie bullet adds the view-as overlay cookie, which reads a nullable environment, the plain-check inventory adds the Development-only anonymous gRPC reflection mapping and the Blazor exception-handler branch, and anchors are refreshed.

## Context
Several capabilities are useful locally and dangerous in a deployed environment: EF Core rendering
parameter values into logs and exception messages, an SMTP session that skips TLS, prompt and
completion text in telemetry, an allow-any-origin CORS policy, a cookie without `Secure`, JWT
metadata fetched over plain HTTP. Each needs a switch, and a switch is exactly what travels: a
copied `appsettings` file, a promoted container image, an environment variable set once and
forgotten. A relaxation controlled by a bare boolean is one careless copy away from a production
data leak.

There is a second hazard that is easy to miss. Not every host presents an environment. Design-time
tooling, a directly-constructed test context, and a service collection assembled outside a host
builder register no `IHostEnvironment` at all, so any gate that reads one has to decide what
"unknown" means. ADR-070 governs binding and validating settings at startup; it does not say when a
validated setting may be honored.

## Decision
**A relaxation applies only when the environment is positively identified as Development. An
unknown, absent, or unparseable environment yields the production posture.** Five gates implement
the rule against a nullable environment. The AI telemetry and webhook gates cite the EF gate or
this record in their own documentation; the SMTP resolver cites the `AddForwardedJwtBearer`
resolution it mirrors (`.../Infrastructure/Mail/SmtpTransportSecurity.cs:7-11`), and the AI
endpoint rule states only that it fails closed (`MMCA.Common/Source/Core/MMCA.Common.AI/AiSettings.cs:231-235`):

- **EF sensitive-data logging.** `SensitiveDataLoggingGate.IsEnabled` is an AND of the setting and
  the environment, written so that a null environment is not Development
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/SensitiveDataLoggingGate.cs:35-36`,
  rule stated at `:11-22`). The setting's own documentation calls itself "a request, not a switch"
  and repeats the null rule (`.../Persistence/PersistenceSettings.cs:29-34`).
- **SMTP transport security.** `SmtpTransportSecurity.Resolve` reads the `Smtp:EnableSsl` key first
  and otherwise returns `environment?.IsDevelopment() != true`, so no environment means TLS
  (`.../Infrastructure/Mail/SmtpTransportSecurity.cs:37-48`). A deployed host that turns TLS off for
  a configured relay is not silent: it logs one startup warning naming the key and the host
  (`:61-77`, message text at `:85`).
- **AI prompt and completion telemetry.** `IsDevelopmentHost` scans the service collection for a
  registered `IHostEnvironment` instance and returns false when it finds none
  (`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:264-268`, called at `:179`), documented as "Fails
  CLOSED ... Mirrors the gate on `Persistence:EnableSensitiveDataLogging`" at `:259-261`.
- **AI endpoint scheme.** When `Ai:Enabled` is true (validation returns early otherwise,
  `MMCA.Common/Source/Core/MMCA.Common.AI/AiSettings.cs:155-158`), a non-https `Ai:Endpoint` fails
  validation outside Development, because every call carries the API key in its headers
  (`:218-226`). The Development check reads the
  validation context's `IHostEnvironment` and otherwise falls back to the stamped
  `IsDevelopmentHost` (`:236-239`, property `:140`, stamped at `DependencyInjection.cs:126` as
  `GetService<IHostEnvironment>()?.IsDevelopment() == true`), so no environment means https only.
- **Webhook insecure targets.** `WebhookInsecureTargets.AreAllowed` is
  `settings.AllowInsecureTargetsInDevelopment && environment is not null && environment.IsDevelopment()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Webhooks/WebhookInsecureTargets.cs:17-18`, its
  documentation citing this record at `:7-9`), and every consumer of the flag goes through it: the
  target validator (`.../Webhooks/DnsWebhookTargetValidator.cs:30`), the sender
  (`.../Webhooks/HttpWebhookSender.cs:45`) and the HTTP client's connect callback
  (`.../Webhooks/WebhookServiceCollectionExtensions.cs:97-99`). A host that sets the flag outside
  Development logs one startup warning that it is ignored
  (`.../Webhooks/InsecureWebhookTargetsNoticeService.cs:27`, message text at `:40`).

`RequireHttpsMetadata` on forwarded JWT bearer is the hybrid the SMTP gate was modelled on: explicit
argument, then configuration, then `!environment.IsDevelopment()`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:64-66`),
with a startup-warning filter registered when a non-Development host opts out (`:68-72`).

**The remaining environment-conditional relaxations are plain `IsDevelopment()` checks, not
fail-closed gates**, and this record names them as such: most read a non-nullable environment the
host always supplies, so there is no unknown case for them to close against (two read a nullable
environment and treat null as not Development: the view-as overlay cookie, noted under the cookie
flag, and the UI-side check noted under the pseudo-locale). They are listed here so the
Development-gated inventory is complete, not to claim a guarantee their code does not make.

- CORS: the pipeline selects `CorsPolicyAllowAll` in Development and `CorsPolicyAllowSpecificOrigins`
  otherwise (`.../Startup/Pipeline/MiddlewarePipelineBuilder.cs:98-100`); the allow-any policy is
  registered at `.../Startup/WebApplicationBuilderExtensions.cs:152-155` behind an analyzer
  suppression that states the scope (`:151`). The Aspire gateway takes the same shape on its default
  policy (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/GatewayCorsExtensions.cs:34-42`). See
  ADR-082.
- Cookie `Secure` flag: the session cookies use
  `Secure = !environment.IsDevelopment() || context.Request.IsHttps`
  (`.../MMCA.Common.API/SessionCookies/SessionCookieJar.cs:69`), so every non-Development host sets
  the flag whatever the request scheme, and in Development an HTTPS request also gets it; only a
  plain-http request in Development goes without it, whatever the host name (rationale at `:60-64`). The culture cookie uses `Secure = !app.Environment.IsDevelopment()`
  (`.../Startup/WebApplicationExtensions.cs:135`). The view-as overlay cookie takes the session
  cookies' shape, `Secure = !development || context.Request.IsHttps`, but reads the environment
  as `services?.GetService<IWebHostEnvironment>()?.IsDevelopment() == true`
  (`.../MMCA.Common.API/SessionCookies/ViewAsOverlayCookie.cs:122`, `:127`), so a context with no
  request services reads as not Development and gets the flag.
- HSTS: `_enableHsts = options.Value.EnableHsts && !environment.IsDevelopment()`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs:175`), so Development
  is the only way to suppress it once a host enables it. CSP is built from the same flag
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:41`). See
  ADR-023.
- Pseudo-locale: added to the supported cultures and accepted by `/culture/set` only in Development
  (`.../Startup/WebApplicationExtensions.cs:81-84`, `:120-123`). The culture switcher offers it in
  the menu only when `Services.GetService<IHostEnvironment>()?.IsDevelopment() == true`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/CultureSwitcher.razor:37-40`), so
  a WASM render, which registers no `IHostEnvironment` (`:34-36`), does not offer it; the WASM bootstrap takes the
  decision as an explicit `allowPseudoLocale` argument from the host
  (`.../MMCA.Common.UI/Services/Culture/MmcaCultureBootstrap.cs:41`, documented at `:31-34`).
- Design-time database skip: database initialization returns early only when the host is
  Development and the `OpenApiDesignTimeKey` setting is true
  (`.../Startup/DatabaseInitializationExtensions.cs:174-177`), so a build-time OpenAPI run does not
  touch a database.
- gRPC reflection: the shared service host maps the reflection service, declared `AllowAnonymous()`
  for the fallback authorization policy, only in Development
  (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostApplicationExtensions.cs:59-64`),
  so a deployed host exposes no anonymous descriptor endpoint.
- Blazor error handling: `UseMmcaBlazorWebPipeline` runs the host's `DevelopmentPipeline` callback
  in Development and only outside it installs
  `UseExceptionHandler("/Error", createScopeForErrors: true)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hosting/BlazorWebHostExtensions.cs:189-196`).

One endpoint mapping is gated on `!IsProduction()` rather than on Development, so it does not
follow this record's rule: in a host that calls it, Staging or any environment name other than
`Production` gets it. `MapCommonOpenApi` maps the OpenAPI document with `AllowAnonymous()`
(`.../Startup/Endpoints/OpenApiEndpointExtensions.cs:61`, `:73`), and the ADC and Store service
hosts call it through the shared service-host start-up
(`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostApplicationExtensions.cs:57`). It exposes API description, not data. ADR-046 documents the OpenAPI document's
posture. It is named here so the inventory states where the rule does not apply.

The Serilog minimum level (`Debug` in Development, `Information` otherwise,
`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Logging/SerilogHostExtensions.cs:77`) and the
rolling file sink (written outside Production, `ShouldWriteFileSink` at `:87-88`, see ADR-041) are
also environment-conditional but relax no security control, so they are not part of this inventory.
The same holds for the error page's Development guidance block, which adds static text only
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Components/Pages/Error.razor:42-54`), and for
the key-ring-at-rest startup warning, which the Azure and Google Cloud data protection registrations
skip in Development when no key-encryption key is configured
(`MMCA.Common/Source/Hosting/MMCA.Common.Azure.Startup/AzureDataProtectionExtensions.cs:95-99`,
`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GoogleCloudDataProtectionExtensions.cs:116-121`): it
suppresses a warning, not a control.

The three fail-closed gates that are pure functions are tested on exactly the closing case: the
EF gate with no environment registered is false
(`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/SensitiveDataLoggingGateTests.cs:45-46`,
outside-Development at `:28-33`), SMTP with no environment enables TLS
(`.../Mail/SmtpTransportSecurityTests.cs:38`), as does an unparseable configured value (`:54`), and
the webhook gate, exercised through the target validator with the flag set and no environment,
refuses both a localhost and a private-address target
(`.../Webhooks/DnsWebhookTargetValidatorTests.cs:147-159`, assertion citing this record at `:156`).

## Rationale
- **Unknown is not safe.** The failure this prevents is not a developer flipping a flag on purpose,
  it is a flag arriving somewhere nobody looked. Treating an absent environment as production means
  the accident costs a missing debug aid instead of a log full of tokens.
- **A pure function is testable; an inline `if` is not.** Extracting the EF, SMTP and webhook
  decisions into static resolvers is what makes the null-environment case assertable at all.
- **Opting out of the secure default is loud.** SMTP TLS and `RequireHttpsMetadata` both emit a
  startup warning when a deployed host disables them, and the webhook flag warns when a deployed
  host sets it, so the posture appears in the logs of the deployment that chose it rather than only
  in a configuration file.
- **Plain checks stay plain.** CORS, the session and culture cookies, HSTS, CSP and the server-side
  pseudo-locale checks run where the host guarantees an environment, so adding a null dance there
  would be ceremony without a case. The two checks that can see no environment (the view-as
  overlay cookie and the UI culture switcher) read null as not Development.

## Trade-offs
- **`ASPNETCORE_ENVIRONMENT` is the trust root.** A host that misreports itself as Development gets
  every relaxation at once. The rule concentrates the risk on one value instead of many, it does not
  remove it.
- **Design-time and test hosts lose the aid.** A directly-constructed test context cannot turn
  sensitive-data logging on, because it registers no environment; it has to supply one to get it.
- **Two shapes, one rule.** A reader has to check which subsystem is a gate and which is a plain
  check; this record is the inventory, and apart from the two nullable reads it names, the plain
  checks carry no null guarantee.
- **The inventory is manual.** Nothing fails a build when a new environment-conditional branch is
  added without following the rule.

## Revision (2026-10-01)
No decision or rationale changed. Citations were re-anchored to the current source: the AI gate
(`DependencyInjection.cs:262-266`, remarks `:257-260`), the `RequireHttpsMetadata` resolution and
warning filter, now in the partial file `WebApplicationBuilderExtensions.Authentication.cs:63-65` and
`:67-71`, the CORS selection (`MiddlewarePipelineBuilder.cs:99-101`) and allow-any policy
(`WebApplicationBuilderExtensions.cs:139-142`, suppression `:138`), the culture cookie `Secure` flag
(`WebApplicationExtensions.cs:134`), the pseudo-locale check (`:119-122`), and the CSP flag
(`BlazorCspPolicyProvider.cs:41`).

## Revision (2026-10-06)
- The plain-check inventory gained the design-time database skip
  (`DatabaseInitializationExtensions.cs:153`), a Development-only branch it previously omitted, and
  now names the Serilog minimum level (`SerilogHostExtensions.cs:77`) as environment-conditional but
  out of scope.
- Anchors re-verified against current source: `RequireHttpsMetadata` resolution and warning filter
  moved to `WebApplicationBuilderExtensions.Authentication.cs:64-66` and `:68-72`, the allow-any CORS
  policy to `WebApplicationBuilderExtensions.cs:145-148` (suppression `:144`), the session cookie
  `Secure` flag to `SessionCookieJar.cs:64`, and HSTS to `SecurityHeaders.cs:175`; all other
  citations still hold.

## Revision (2026-10-07)
Re-verified against current source. The rule, the three fail-closed gates and the Development-gated
plain checks are unchanged; the inventory now states where the rule does not apply and covers two
branches it omitted.

1. The two endpoint mappings gated on `!IsProduction()` rather than Development are named as
   outside the rule: `MapCommonOpenApi` maps the document anonymously
   (`OpenApiEndpointExtensions.cs:62`, `:74`), cross-referenced to ADR-046, and the opt-in
   `MapCommonScalarUi` maps the Scalar UI (`:91-93`), which no consumer host calls.
2. The pseudo-locale bullet adds the UI-side check: `CultureSwitcher.razor:24-27` reads a nullable
   `IHostEnvironment` and offers the pseudo-locale only when it is Development, and the WASM
   bootstrap takes an explicit `allowPseudoLocale` argument (`MmcaCultureBootstrap.cs:41`). The
   "non-nullable environment" sentence is now scoped to the server-side checks.
3. The out-of-scope sentence adds the Serilog file sink (`SerilogHostExtensions.cs:87-88`) beside
   the minimum level (`:77`), and the error page's static Development guidance (`Error.razor:37`).
4. Anchors re-verified against current source: the design-time database skip moved to
   `DatabaseInitializationExtensions.cs:174-177`; all other citations still hold.

## Revision (2026-10-26)
Re-verified against current source. The rule, the three fail-closed gates and the rest of the
Development-gated inventory are unchanged; the session cookie's `Secure` expression moved, so the
cookie bullet now describes the session and culture cookies separately.

1. The session cookies are `Secure` outside Development whatever the request scheme and, in
   Development, whenever the request arrived over HTTPS
   (`SessionCookieJar.cs:68`, `Secure = !environment.IsDevelopment() || context.Request.IsHttps`,
   rationale `:60-63`); only a plain-http request in Development omits the flag. The culture cookie keeps
   `Secure = !app.Environment.IsDevelopment()` (`WebApplicationExtensions.cs:135`).
2. Anchors re-verified against current source: the CORS selection moved to
   `MiddlewarePipelineBuilder.cs:98-100`, and the pseudo-locale supported-cultures branch and
   `/culture/set` check to `WebApplicationExtensions.cs:81-84` and `:120-123`; all other citations
   still hold.

## Revision (2026-11-17)
Re-verified against current source. The rule, the three fail-closed gates and the Development-gated
inventory are unchanged; one of the two `!IsProduction()` mappings the inventory named is gone.

1. `MapCommonScalarUi` and the `Scalar.AspNetCore` dependency are removed from `MMCA.Common.API`
   because no host called it; they were removed in the API-projects drift review (MMCA.Common
   v1.300.0). `MapCommonOpenApi` is now the only mapping the inventory names outside the rule, and
   the paragraph describes it alone. The `MapCommonScalarUi` statement and its `:91-93` anchor in the
   Revision (2026-10-07) are history and are superseded by this revision.
2. Anchors re-verified against current source: the `!IsProduction()` check and the anonymous
   `MapOpenApi()` call moved to `OpenApiEndpointExtensions.cs:61` and `:73`, and the paragraph now
   cites the shared service-host call (`ServiceHostApplicationExtensions.cs:57`) through which the ADC
   and Store service hosts map the document.

## Revision (2026-11-23)
Re-verified against current source. The rule, the three gates the record named and the existing
plain checks are unchanged in behavior; the inventory missed two fail-closed gates, one nullable
server-side check and two Development-gated branches, and several anchors moved.

1. Two more fail-closed gates are named in the Decision. The webhook insecure-targets gate
   (`WebhookInsecureTargets.cs:17-18`, documentation citing this record at `:7-9`) is the one
   decision the validator (`DnsWebhookTargetValidator.cs:30`), the sender
   (`HttpWebhookSender.cs:45`) and the connect callback (`WebhookServiceCollectionExtensions.cs:97-99`)
   consult, with a startup warning when a deployed host sets the flag
   (`InsecureWebhookTargetsNoticeService.cs:27`, `:40`). The AI endpoint https rule
   (`AiSettings.cs:218-226`) falls back to the stamped `IsDevelopmentHost` (`:236-239`, `:140`,
   stamped at `DependencyInjection.cs:126`). The Rationale now counts the webhook gate among the
   static resolvers and the loud opt-outs.
2. The cookie bullet adds the view-as overlay cookie, which reads a nullable environment
   (`ViewAsOverlayCookie.cs:122`) and sets `Secure = !development || context.Request.IsHttps`
   (`:127`); the "non-nullable environment" sentence now names it beside the UI-side check.
3. The plain-check inventory adds the Development-only anonymous gRPC reflection mapping
   (`ServiceHostApplicationExtensions.cs:59-64`) and the Blazor pipeline's Development branch, which
   installs `UseExceptionHandler("/Error", createScopeForErrors: true)` only outside Development
   (`BlazorWebHostExtensions.cs:189-196`). The out-of-scope paragraph adds the key-ring-at-rest
   startup warning that the Azure and Google Cloud data protection registrations skip in
   Development (`AzureDataProtectionExtensions.cs:95-99`,
   `GoogleCloudDataProtectionExtensions.cs:116-121`). The Decision now states which gates' own
   documentation cites the EF gate or this record, and that the AI endpoint rule applies only when
   `Ai:Enabled` is true (`AiSettings.cs:155-158`); the Rationale and Trade-offs name the two
   nullable plain checks.
4. The closing-case test paragraph adds the webhook gate's null-environment test
   (`DnsWebhookTargetValidatorTests.cs:147-159`, assertion `:156`).
5. Anchors re-verified against current source: the AI gate moved to `DependencyInjection.cs:264-268`
   (call `:179`, remarks text `:259-261`), the allow-any CORS policy to
   `WebApplicationBuilderExtensions.cs:152-155` (suppression `:151`), the session cookie `Secure`
   expression to `SessionCookieJar.cs:69` (rationale `:60-64`), the culture switcher check to
   `CultureSwitcher.razor:37-40` (WASM comment `:34-36`), and the error page's Development block to
   `Error.razor:42-54`; all other citations still hold.

## Related
[ADR-070](070-fail-fast-configuration-contract.md) (binds and validates settings at startup; this
record governs when a validated setting may be honored),
[ADR-023](023-security-response-headers.md) (the HSTS and CSP posture relaxed here),
[ADR-082](082-two-tier-cors-posture.md) (the two CORS policies this selects between),
[ADR-120](120-governed-chat-client-boundary.md) (the chat client whose prompt and completion
telemetry the AI gate protects), [ADR-024](024-push-notifications.md) (the notification use case
whose email channel rides the SMTP transport gated here),
[ADR-027](027-multi-locale-i18n.md) (the pseudo-locale that is Development-only),
[ADR-046](046-http-api-versioning.md) (the OpenAPI document mapped outside Production),
[ADR-041](041-observability-and-telemetry.md) (the Serilog level and file sink named out of scope).
