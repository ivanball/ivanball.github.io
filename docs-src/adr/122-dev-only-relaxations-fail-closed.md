# ADR-122: Dev-Only Relaxations Are Environment-Gated and Fail Closed

## Status
Accepted (2026-09-11).

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
unknown, absent, or unparseable environment yields the production posture.** Three subsystems
implement the rule against a nullable environment and cross-reference each other in their own
documentation:

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
  (`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:172-176`), documented as "Fails
  CLOSED ... Mirrors the gate on `Persistence:EnableSensitiveDataLogging`" at `:167-171`.

`RequireHttpsMetadata` on forwarded JWT bearer is the hybrid the SMTP gate was modelled on: explicit
argument, then configuration, then `!environment.IsDevelopment()`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:557-559`),
with a startup-warning filter registered when a non-Development host opts out (`:561-566`).

**The remaining environment-conditional relaxations are plain `IsDevelopment()` checks, not
fail-closed gates**, and this record names them as such: each reads a non-nullable environment the
host always supplies, so there is no unknown case for them to close against. They are listed here so
the inventory is complete, not to claim a guarantee their code does not make.

- CORS: the pipeline selects `CorsPolicyAllowAll` in Development and `CorsPolicyAllowSpecificOrigins`
  otherwise (`.../Startup/Pipeline/MiddlewarePipelineBuilder.cs:111-113`); the allow-any policy is
  registered at `.../Startup/WebApplicationBuilderExtensions.cs:694-697` behind an analyzer
  suppression that states the scope (`:693`). The Aspire gateway takes the same shape on its default
  policy (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/GatewayCorsExtensions.cs:34-42`). See
  ADR-082.
- Cookie `Secure` flag: `Secure = !environment.IsDevelopment()` for the session cookies
  (`.../MMCA.Common.API/SessionCookies/SessionCookieJar.cs:34`) and for the culture cookie
  (`.../Startup/WebApplicationExtensions.cs:121`).
- HSTS: `_enableHsts = options.Value.EnableHsts && !environment.IsDevelopment()`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs:170`), so Development
  is the only way to suppress it once a host enables it. CSP is built from the same flag
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:33`). See
  ADR-023.
- Pseudo-locale: added to the supported cultures and accepted by `/culture/set` only in Development
  (`.../Startup/WebApplicationExtensions.cs:80-82`, `:106`).

The two fail-closed gates that are pure functions are unit-tested on exactly the closing case: the
EF gate with no environment registered is false
(`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/SensitiveDataLoggingGateTests.cs:45-46`,
outside-Development at `:28-33`), and SMTP with no environment enables TLS
(`.../Mail/SmtpTransportSecurityTests.cs:38`), as does an unparseable configured value (`:54`).

## Rationale
- **Unknown is not safe.** The failure this prevents is not a developer flipping a flag on purpose,
  it is a flag arriving somewhere nobody looked. Treating an absent environment as production means
  the accident costs a missing debug aid instead of a log full of tokens.
- **A pure function is testable; an inline `if` is not.** Extracting the EF and SMTP decisions into
  static resolvers is what makes the null-environment case assertable at all.
- **Opting out of the secure default is loud.** SMTP TLS and `RequireHttpsMetadata` both emit a
  startup warning when a deployed host disables them, so the posture appears in the logs of the
  deployment that chose it rather than only in a configuration file.
- **Plain checks stay plain.** CORS, cookies, HSTS, CSP and the pseudo-locale run where the host
  guarantees an environment, so adding a null dance there would be ceremony without a case.

## Trade-offs
- **`ASPNETCORE_ENVIRONMENT` is the trust root.** A host that misreports itself as Development gets
  every relaxation at once. The rule concentrates the risk on one value instead of many, it does not
  remove it.
- **Design-time and test hosts lose the aid.** A directly-constructed test context cannot turn
  sensitive-data logging on, because it registers no environment; it has to supply one to get it.
- **Two shapes, one rule.** A reader has to check which subsystem is a gate and which is a plain
  check; this record is the inventory, and the plain checks carry no null guarantee.
- **The inventory is manual.** Nothing fails a build when a new environment-conditional branch is
  added without following the rule.

## Related
[ADR-070](070-fail-fast-configuration-contract.md) (binds and validates settings at startup; this
record governs when a validated setting may be honored),
[ADR-023](023-security-response-headers.md) (the HSTS and CSP posture relaxed here),
[ADR-082](082-two-tier-cors-posture.md) (the two CORS policies this selects between),
[ADR-120](120-governed-chat-client-boundary.md) (the chat client whose prompt and completion
telemetry the AI gate protects), [ADR-024](024-push-notifications.md) (the notification use case
whose email channel rides the SMTP transport gated here),
[ADR-027](027-multi-locale-i18n.md) (the pseudo-locale that is Development-only).
