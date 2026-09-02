# ADR-082: Two-Tier Cross-Origin Posture: Allow-Listed Service Policies, an Any-Header Gateway Policy

## Status
Accepted (2026-08-14).

## Context
Both deployed applications put a YARP gateway in front of per-module service hosts (ADR-008), and
the browser and MAUI clients talk to the gateway origin while the services answer on their own
internal origins. That makes CORS an edge decision taken in **two different kinds of host**: a
service host that owns controllers and therefore knows exactly which headers and methods its API
accepts, and a reverse proxy that owns no API surface at all and has to relay whatever a client
sends to the service behind it.

Those two hosts cannot run the same policy. A proxy that allow-lists headers would have to
enumerate every header any fronted service will ever accept, and would break the next endpoint that
introduces one. A service host that allowed any header would be giving away precision it actually
has.

CORS already appears in the record twice, but only in passing: ADR-008 lists it as gateway
middleware and as a reason the gateway exists
(`Website/docs-src/adr/008-service-extraction-topology.md:40`, `:55`), and ADR-058 pins its test
hosts to Production so the restrictive branch is the one under test
(`Website/docs-src/adr/058-runtime-conformance-suites-as-a-package.md:58-60`). Its edge siblings
each have their own record: ADR-023 for the security-response headers and ADR-019 for rate limiting
and the forwarded-header trust that feeds it. This ADR records the posture itself.

## Decision
Ship **two** cross-origin policies from the framework: an allow-listed one for service hosts and a
deliberately broader one for gateways.

- **Service hosts register two named policies from one call.** `AddCommonCors(IConfiguration)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:581`)
  adds `_allowSpecificOrigins` (`:35`, `:585`) and `_allowAll` (`:38`, `:594`). Neither is the
  default policy, so nothing applies until the pipeline names one.
- **The service policy allow-lists origins, headers and methods, and allows credentials.** Origins
  come from `Cors:AllowedOrigins` (`:587`), headers are the four the APIs actually use
  (`Content-Type`, `Authorization`, `x-signalr-user-agent`, `x-requested-with`, `:589`), methods are
  five explicit verbs (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `:590`), and `AllowCredentials()`
  (`:591`) is what lets cookie and bearer traffic cross. The `x-signalr-user-agent` entry is
  load-bearing rather than decorative: it plus credentials is what allows the SignalR hub to
  negotiate cross-origin with a bearer token
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:126-131`).
- **The environment picks between the two policies in the shared middleware pipeline, not at
  registration.** The selection is one named step of the ADR-079 pipeline: the `Cors` step calls
  `app.UseCors(...)` with `CorsPolicyAllowAll` when `app.Environment.IsDevelopment()` and
  `CorsPolicyAllowSpecificOrigins` otherwise
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/MiddlewarePipelineBuilder.cs:102-106`),
  seeded by `CreateDefault()` (`:31`) after the `Routing` step (`:98-100`) and before
  `Authentication` (`:108-110`). Hosts reach it through `UseCommonMiddlewarePipeline()`
  (`WebApplicationExtensions.cs:46`, `:58`), which delegates to that builder (`:138`, `:140`).
  Registration stays environment-agnostic; one step decides the posture.
- **The gateway gets a different policy, and it is the default policy.**
  `AddCommonGatewayCors(IConfiguration, IHostEnvironment)`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/GatewayCorsExtensions.cs:24`) lives in the Aspire
  hosting package, not in the API package, and calls `AddDefaultPolicy` (`:37`, `:48`) so a gateway
  pairs it with a bare `app.UseCors()`.
- **The gateway policy restricts origins only.** Outside Development it is
  `WithOrigins(Cors:AllowedOrigins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()`
  (`GatewayCorsExtensions.cs:45-52`). A reverse proxy must pass arbitrary client headers through to
  the services it fronts, so origin is the one axis it can still constrain while keeping credentials
  flowing.
- **Both tiers carry a Development-only allow-any-origin branch behind an S5122 suppression.** The
  service `_allowAll` policy is `AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()` under
  `#pragma warning disable S5122` whose comment names the pipeline line that gates it
  (`WebApplicationBuilderExtensions.cs:593-597`); the gateway's Development branch is the same shape
  under the same suppression (`GatewayCorsExtensions.cs:34-41`), selected by `environment
  .IsDevelopment()` at registration time because the gateway has only one policy slot.
- **Allowed origins are configuration, empty by default, filled at deploy time.** Every host ships
  `"Cors": { "AllowedOrigins": [] }`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:10-11`,
  `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json:11`,
  `MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/appsettings.json:11`,
  `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/appsettings.json:22`), and Bicep injects the
  real value into the gateway container of both applications as
  `Cors__AllowedOrigins__0`, pointing at the UI container app's FQDN
  (`MMCA.ADC/infra/main.bicep:1646`, `MMCA.Store/infra/main.bicep:1336`). On Store the same key can
  also arrive from Key Vault as `Cors--AllowedOrigins--0`, which is why the vault provider is
  registered before anything reads configuration: the allow-list binds eagerly
  (`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:54-62`, `:63`).
- **Adoption is complete on both tiers.** All seven ADC and Store service hosts call `AddCommonCors`
  (`MMCA.ADC.Identity.Service/Program.cs:145`, `MMCA.ADC.Conference.Service/Program.cs:164`,
  `MMCA.ADC.Engagement.Service/Program.cs:142`, `MMCA.ADC.Notification.Service/Program.cs:131`,
  `MMCA.Store.Catalog.Service/Program.cs:128`, `MMCA.Store.Identity.Service/Program.cs:123`,
  `MMCA.Store.Sales.Service/Program.cs:136`), as does the Helpdesk reference host
  (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:33`), and every one of the eight then
  runs `UseCommonMiddlewarePipeline()` so the selection above applies
  (`MMCA.ADC.Identity.Service/Program.cs:311`, `MMCA.ADC.Conference.Service/Program.cs:374`,
  `MMCA.ADC.Engagement.Service/Program.cs:308`, `MMCA.ADC.Notification.Service/Program.cs:240`,
  `MMCA.Store.Catalog.Service/Program.cs:258`, `MMCA.Store.Identity.Service/Program.cs:249`,
  `MMCA.Store.Sales.Service/Program.cs:269`, `MMCA.Helpdesk.Web/Program.cs:130`). Both gateways call
  `AddCommonGatewayCors` and the bare `app.UseCors()`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:89`, `:137`;
  `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:77`, `:162`).

The Blazor UI hosts register neither call: they serve their own origin and have no cross-origin API
surface, so there is no third tier.

## Rationale
- **A proxy cannot allow-list what it does not own.** The gateway has no controllers and no
  knowledge of which headers the fronted services accept, so a header allow-list there would be a
  guess that silently breaks the next endpoint. Origin is the axis the proxy genuinely knows, and
  restricting it is what keeps `AllowCredentials()` meaningful.
- **A service host can be precise, so it is.** Four headers and five methods is a real reduction of
  the preflight-accepted surface, and it costs nothing where the API surface is known.
- **Named versus default policy follows from the count.** The service tier needs two policies, so
  they must be named and selected explicitly; the gateway needs one, so the default policy plus a
  bare `UseCors()` is the smaller thing to get wrong.
- **Deciding in the pipeline keeps registration environment-free.** `AddCommonCors` takes no
  `IHostEnvironment` and no host passes one: the single decision point lives beside the other
  ordering decisions in `UseCommonMiddlewarePipeline`, where ADR-019's rate limiter and the auth
  middleware are also placed.
- **Credentials forbid a wildcard origin.** Any policy that allows credentials has to enumerate
  origins, which is exactly why both production branches read `Cors:AllowedOrigins` and only the
  Development branches use `AllowAnyOrigin()` (which drops credentials with it).

## Trade-offs
- **The gateway policy is broad on two of three axes.** Any header and any method are accepted for
  an allow-listed origin. The origin list is the only lever there, so a mistake in
  `Cors:AllowedOrigins` on a gateway is a bigger mistake than the same error on a service host.
- **The allow-any-origin branch ships in production binaries.** Both tiers keep a policy that
  allows every origin and gate it solely on `IHostEnvironment.IsDevelopment()`. Anything that boots
  one of these hosts with `ASPNETCORE_ENVIRONMENT=Development` on a reachable network gets the open
  policy, and the S5122 suppressions
  (`WebApplicationBuilderExtensions.cs:593`, `GatewayCorsExtensions.cs:36`) mean the analyzer will
  not say so again. The compensating control is ADR-058's `ProductionHostApplicationFactory`, which
  pins `UseEnvironment("Production")` so conformance runs exercise the restrictive branch.
- **The service allow-list is a framework edit, not a host setting.** Headers and methods are
  hardcoded in `AddCommonCors` (`:589-590`), so a service that needs a sixth verb or a fifth header
  needs an MMCA.Common change and a lockstep version bump (ADR-016), not an appsettings entry. That
  is the deliberate direction of the trade (precision over per-host configurability), but it does
  make the cheap change the expensive one.
- **Origins are a deploy-time responsibility with no startup validation.** `Cors:AllowedOrigins` is
  read with a raw `configuration.GetSection(...).Get<string[]>() ?? []` in both registrations
  (`WebApplicationBuilderExtensions.cs:587`, `GatewayCorsExtensions.cs:45-47`); there is no options
  class, no `ValidateOnStart`, and no entry in the fail-fast configuration contract (ADR-070). A
  host deployed without the value starts happily and fails closed at the first cross-origin request,
  which is the safe direction but shows up as a browser console error rather than a boot failure.
- **Nothing asserts the emitted `Access-Control-*` headers.** The tests assert the registered policy
  objects (origins, credentials, and the allow-all shape:
  `MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Startup/WebApplicationBuilderExtensionsTests.cs:197-245`),
  not a real preflight response, so a pipeline-ordering regression that moved `UseCors` out of place
  would not be caught by a CORS test.

## Related
[ADR-079](079-shared-http-middleware-pipeline.md) (the shared middleware pipeline whose fixed order
places the environment-selected CORS policy between routing and authentication), ADR-008 (the
gateway plus per-module service topology this posture splits along, and the record that
first named CORS as a gateway responsibility), ADR-023 (the security-response headers registered
next to CORS in the same gateway and service pipelines), ADR-019 (rate limiting and the
forwarded-header trust that share the same edge and the same middleware ordering), ADR-058 (the
conformance fixtures that pin Production so the restrictive branch is what runs under test),
ADR-070 (the fail-fast configuration contract that `Cors:AllowedOrigins` is deliberately not part
of), ADR-016 (why widening the service allow-list is a lockstep framework release).
