# ADR-082: Two-Tier Cross-Origin Posture: Allow-Listed Service Policies, an Any-Header Gateway Policy

## Status
Accepted (2026-08-14). Revised 2026-10-07: anchors refreshed after the v1.233.0 release. Revised 2026-10-21: the ADC and Store browser clients now send API traffic through the UI host's same-origin proxy (ADR-131), whose own deny-all cross-origin gate replaces the "no UI API surface" statement; anchors refreshed. Revised 2026-10-26: anchors refreshed after the host, Bicep and pipeline-extension lines shifted.

## Context
Both deployed applications put a YARP gateway in front of per-module service hosts (ADR-008), and
clients reach the gateway origin while the services answer on their own internal origins. MAUI
clients call the gateway directly. On ADC and Store the WebAssembly client sends its API and hub
traffic to the UI host's same-origin proxy instead (ADR-131), which forwards it server-side, so the
browser itself reaches the gateway only for full-page navigations such as the external sign-in
challenge (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/ApiSettings.cs:21-33`).
That makes CORS an edge decision taken in **two different kinds of host**: a
service host that owns controllers and therefore knows exactly which headers and methods its API
accepts, and a reverse proxy that owns no API surface at all and has to relay whatever a client
sends to the service behind it.

Those two hosts cannot run the same policy. A proxy that allow-lists headers would have to
enumerate every header any fronted service will ever accept, and would break the next endpoint that
introduces one. A service host that allowed any header would be giving away precision it actually
has.

CORS already appears in the record twice, but only in passing: ADR-008 lists it as gateway
middleware and as a reason the gateway exists
(`Website/docs-src/adr/008-service-extraction-topology.md:71`, `:101`), and ADR-058 pins its test
hosts to Production so the restrictive branch is the one under test
(`Website/docs-src/adr/058-runtime-conformance-suites-as-a-package.md:82-84`). Its edge siblings
each have their own record: ADR-023 for the security-response headers and ADR-019 for rate limiting
and the forwarded-header trust that feeds it. This ADR records the posture itself.

## Decision
Ship **two** cross-origin policies from the framework: an allow-listed one for service hosts and a
deliberately broader one for gateways.

- **Service hosts register two named policies from one call.** `AddCommonCors(IConfiguration)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:132`)
  adds `_allowSpecificOrigins` (`:27`, `:136`) and `_allowAll` (`:30`, `:145`). Neither is the
  default policy, so nothing applies until the pipeline names one.
- **The service policy allow-lists origins, headers and methods, and allows credentials.** Origins
  come from `Cors:AllowedOrigins` (`:138`), headers are the four the APIs actually use
  (`Content-Type`, `Authorization`, `x-signalr-user-agent`, `x-requested-with`, `:140`), methods are
  five explicit verbs (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `:141`), and `AllowCredentials()`
  (`:142`) is what lets cookie and bearer traffic cross. The `x-signalr-user-agent` entry is
  load-bearing rather than decorative: it plus credentials is what allows the SignalR hub to
  negotiate cross-origin with a bearer token
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:140-141`).
- **The environment picks between the two policies in the shared middleware pipeline, not at
  registration.** The selection is one named step of the ADR-079 pipeline: the `Cors` step calls
  `app.UseCors(...)` with `CorsPolicyAllowAll` when `app.Environment.IsDevelopment()` and
  `CorsPolicyAllowSpecificOrigins` otherwise
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/Pipeline/MiddlewarePipelineBuilder.cs:97-101`),
  seeded by `CreateDefault()` (`:31`) after the `Routing` step (`:93-95`) and before
  `Authentication` (`:103-105`). Hosts reach it through `UseCommonMiddlewarePipeline()`
  (`WebApplicationExtensions.cs:49`, `:61`), which delegates to that builder (`:171`, `:173`).
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
  `#pragma warning disable S5122` whose comment points at `UseCommonMiddlewarePipeline` as the
  place that gates it (`WebApplicationBuilderExtensions.cs:144-149`; the gating step itself is
  `MiddlewarePipelineBuilder.cs:99-101`); the gateway's Development branch is the same shape
  under the same suppression (`GatewayCorsExtensions.cs:34-41`), selected by `environment
  .IsDevelopment()` at registration time because the gateway has only one policy slot.
- **Allowed origins are configuration, empty by default, filled at deploy time.** Every host ships
  `"Cors": { "AllowedOrigins": [] }`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:18-19`,
  `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json:13-14`,
  `MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/appsettings.json:10-11`,
  `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/appsettings.json:21-22`), and Bicep injects the
  real value into the gateway container of both applications as
  `Cors__AllowedOrigins__0`, pointing at the UI container app's FQDN
  (`MMCA.ADC/infra/main.bicep:2654`, `MMCA.Store/infra/main.bicep:2037`). With the ADC and Store
  WebAssembly clients routed through the same-origin proxy (Context), no first-party browser fetch
  to the gateway remains, so that allow-listed UI origin now governs no cross-origin browser call
  from the UI; the grant stays in place for any client that still calls the gateway from that
  origin. On Store the same key can
  also arrive from Key Vault as `Cors--AllowedOrigins--0`, which is why the vault provider is
  registered before anything reads configuration: the allow-list binds eagerly
  (`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:55-63`, `:64`).
- **Adoption is complete on both tiers.** All seven ADC and Store service hosts call `AddCommonCors`
  (`MMCA.ADC.Identity.Service/Program.cs:160`, `MMCA.ADC.Conference.Service/Program.cs:225`,
  `MMCA.ADC.Engagement.Service/Program.cs:155`, `MMCA.ADC.Notification.Service/Program.cs:144`,
  `MMCA.Store.Catalog.Service/Program.cs:145`, `MMCA.Store.Identity.Service/Program.cs:140`,
  `MMCA.Store.Sales.Service/Program.cs:153`), as does the Helpdesk reference host
  (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:34`), and every one of the eight then
  runs `UseCommonMiddlewarePipeline()` so the selection above applies
  (`MMCA.ADC.Identity.Service/Program.cs:372`, `MMCA.ADC.Conference.Service/Program.cs:461`,
  `MMCA.ADC.Engagement.Service/Program.cs:337`, `MMCA.ADC.Notification.Service/Program.cs:281`,
  `MMCA.Store.Catalog.Service/Program.cs:331`, `MMCA.Store.Identity.Service/Program.cs:318`,
  `MMCA.Store.Sales.Service/Program.cs:320`, `MMCA.Helpdesk.Web/Program.cs:149`). Both gateways call
  `AddCommonGatewayCors` and the bare `app.UseCors()`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:131`, `:179`;
  `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:83`, `:168`).

The Blazor UI hosts register neither call, and no UI host runs the CORS middleware. The ADC and
Store UI.Web hosts do expose an API surface, the same-origin proxy of ADR-131
(`AddCommonSameOriginApiProxy` at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:167` and
`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:159`, mapped by
`MapCommonSameOriginApiProxy` at `:290` and `:268`), but it carries its own deny-all cross-origin
posture outside the CORS middleware: a foreign `Origin` or `Sec-Fetch-Site` gets 403, and `OPTIONS`
is answered locally with 204, no CORS grant and no forwarding, so no preflight ever reaches the
gateway and the gateway policy never decides whether a proxied request may proceed
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyEndpoint.cs:247-260`).
Other proxied requests still pass through the gateway's `app.UseCors()`: the proxy's request
transform starts from YARP's default header copy and changes only `Authorization`, the CSRF header
and the session cookies
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginProxyTransformer.cs:53`,
`:60-62`), so a browser `Origin` naming the UI host is forwarded and matches the allow-listed UI
FQDN; the resulting `Access-Control-*` response headers go to the proxy, not to a browser deciding
on them. Helpdesk's UI host does not adopt the proxy.

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
  (`WebApplicationBuilderExtensions.cs:144`, `GatewayCorsExtensions.cs:36`) mean the analyzer will
  not say so again. The compensating control is ADR-058's `ProductionHostApplicationFactory`, which
  pins `UseEnvironment("Production")` so conformance runs exercise the restrictive branch.
- **The service allow-list is a framework edit, not a host setting.** Headers and methods are
  hardcoded in `AddCommonCors` (`:140-141`), so a service that needs a sixth verb or a fifth header
  needs an MMCA.Common change and a lockstep version bump (ADR-016), not an appsettings entry. That
  is the deliberate direction of the trade (precision over per-host configurability), but it does
  make the cheap change the expensive one.
- **Origins are a deploy-time responsibility with no startup validation.** `Cors:AllowedOrigins` is
  read with a raw `configuration.GetSection(...).Get<string[]>() ?? []` in both registrations
  (`WebApplicationBuilderExtensions.cs:138`, `GatewayCorsExtensions.cs:45-47`); there is no options
  class, no `ValidateOnStart`, and no entry in the fail-fast configuration contract (ADR-070). A
  host deployed without the value starts happily and fails closed at the first cross-origin request,
  which is the safe direction but shows up as a browser console error rather than a boot failure.
- **Nothing asserts the emitted `Access-Control-*` headers.** The tests assert the registered policy
  objects (origins, credentials, the allow-all shape, and fail-closed with no configured origins:
  `MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Startup/WebApplicationBuilderExtensionsTests.cs:210-334`
  for the service tier,
  `MMCA.Common/Tests/Hosting/MMCA.Common.Aspire.Tests/Gateway/GatewayCorsExtensionsTests.cs:22`, `:36`,
  `:46` for the gateway), not a real preflight response. For service hosts the position of `UseCors`
  is still pinned, by the shared pipeline's step-order test
  (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Startup/Pipeline/MiddlewarePipelineBuilderTests.cs:14-39`,
  `Cors` between `Routing` and `Authentication`); the gateways' hand-written `app.UseCors()` has no
  such guard, so an ordering regression there would not be caught by a test.

## Revision (2026-10-01)
No decision changed. Citations were re-anchored to the current source: `AddCommonCors` and its
policy lines (`WebApplicationBuilderExtensions.cs:124-141`), the pipeline `Cors` step
(`MiddlewarePipelineBuilder.cs:97-101`) and its delegation (`WebApplicationExtensions.cs:168`,
`:170`), every host call site, the gateway Bicep entries, and the ADR-008 and ADR-058 cross-references.
Two statements were corrected: the S5122 comment names `UseCommonMiddlewarePipeline` rather than the
gating line (`WebApplicationBuilderExtensions.cs:136`), and the test trade-off now credits the gateway
policy suite (`GatewayCorsExtensionsTests.cs:22`) and the step-order test that pins `UseCors` for
service hosts (`MiddlewarePipelineBuilderTests.cs:14-39`), leaving the ordering gap on the gateways only.

## Revision (2026-10-06)
- No content changed: the two-tier posture, both policies, the environment selection step, the call-site adoption and the test coverage all still hold as written.
- Anchors were re-verified against current source and moved where the code shifted: the `AddCommonCors` policy lines (`WebApplicationBuilderExtensions.cs:132`, `:144-149`), the pipeline delegation (`WebApplicationExtensions.cs:170`, `:172`), the gateway Bicep entries, every host call site, the ADC gateway CORS lines, the service-tier test range (`WebApplicationBuilderExtensionsTests.cs:210-334`) and the ADR-008 cross-reference (`:95`).

## Revision (2026-10-07)
Re-verified against current source. The two-tier posture, both policies, the environment selection
step, the deploy-time origin injection and the adoption on all eight service-tier hosts and both
gateways are unchanged; only three anchors moved after the v1.233.0 release.

1. Anchors re-verified against current source: the ADC gateway Bicep entry for
   `Cors__AllowedOrigins__0` (`MMCA.ADC/infra/main.bicep:2462`; Store unchanged at
   `MMCA.Store/infra/main.bicep:1937`) and the `UseCommonMiddlewarePipeline()` calls in
   `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:448` and
   `MMCA.ADC/Source/Services/MMCA.ADC.Engagement.Service/Program.cs:325`.

## Revision (2026-10-21)
Re-verified against current source. The two tiers, both policies, the environment selection step,
the deploy-time origin injection and adoption on all eight service-tier hosts and both gateways are
unchanged. What moved is who calls the gateway from a browser, and the UI hosts' API surface.

1. The ADC and Store WebAssembly clients send API and hub traffic to the UI host's
   `SameOriginApiEndpoint` rather than the gateway
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Settings/ApiSettings.cs:21-33`;
   `SameOriginProxyTokenRefresher` at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/Program.cs:49`
   and `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/Program.cs:46`). MAUI and the external
   sign-in navigation still reach the gateway origin; Context now says so.
2. The UI hosts are no longer free of an API surface: the same-origin proxy (ADR-131) is registered
   at `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:161`, `:284` and
   `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:153`, `:262`. It refuses a foreign
   origin with 403 and answers `OPTIONS` locally with 204 and no CORS grant
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyEndpoint.cs:247-260`),
   a deny-all posture outside the CORS middleware. Only preflight stops there: other proxied
   requests keep the browser `Origin` through YARP's default header copy
   (`SameOriginProxyTransformer.cs:53`, `:60-62`) and so still meet the gateway's `app.UseCors()`.
   The Decision paragraph replacing "no third tier" records this; Related now cites ADR-131.
3. The gateway's `Cors__AllowedOrigins__0` injection is unchanged, but with the ADC and Store
   WebAssembly clients on the proxy no first-party browser fetch to the gateway remains, so the
   UI-origin grant no longer governs a cross-origin browser call from the UI. The Decision bullet
   on allowed origins now says so.
4. Anchors re-verified against current source: the gateway Bicep entries
   (`MMCA.ADC/infra/main.bicep:2618`, `MMCA.Store/infra/main.bicep:2031`), `AddCommonCors` in
   `MMCA.ADC.Identity.Service/Program.cs:154`, `MMCA.ADC.Conference.Service/Program.cs:219`,
   `MMCA.Store.Identity.Service/Program.cs:134`, `MMCA.Store.Sales.Service/Program.cs:147`, and
   `UseCommonMiddlewarePipeline()` in `MMCA.ADC.Identity.Service/Program.cs:361`,
   `MMCA.ADC.Conference.Service/Program.cs:450`, `MMCA.ADC.Engagement.Service/Program.cs:326`,
   `MMCA.ADC.Notification.Service/Program.cs:270`, `MMCA.Store.Identity.Service/Program.cs:307`,
   `MMCA.Store.Sales.Service/Program.cs:309`.

## Revision (2026-10-26)
Re-verified against current source. The two tiers, both policies, the environment selection step,
the deploy-time origin injection, the Store Key Vault ordering, adoption on all eight service-tier
hosts and both gateways, and the UI hosts' proxy-only API surface (no `AddCommonCors` or `UseCors`
in either UI.Web host) are unchanged; only anchors moved.

1. Anchors re-verified against current source: the `UseCommonMiddlewarePipeline` overloads
   (`WebApplicationExtensions.cs:49`, `:61`) and their delegation (`ApplyPipeline` at `:171`,
   `CreateDefault()` at `:173`); the SignalR header comment
   (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:140-141`); the gateway Bicep
   entries (`MMCA.ADC/infra/main.bicep:2654`, `MMCA.Store/infra/main.bicep:2037`); the Store gateway
   Key Vault comment and call (`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:55-63`,
   `:64`); `AddCommonCors` in `MMCA.ADC.Identity.Service/Program.cs:160`,
   `MMCA.ADC.Conference.Service/Program.cs:225`, `MMCA.ADC.Engagement.Service/Program.cs:155`,
   `MMCA.ADC.Notification.Service/Program.cs:144`, `MMCA.Store.Catalog.Service/Program.cs:145`,
   `MMCA.Store.Identity.Service/Program.cs:140`, `MMCA.Store.Sales.Service/Program.cs:153`;
   `UseCommonMiddlewarePipeline()` in `MMCA.ADC.Identity.Service/Program.cs:372`,
   `MMCA.ADC.Conference.Service/Program.cs:461`, `MMCA.ADC.Engagement.Service/Program.cs:337`,
   `MMCA.ADC.Notification.Service/Program.cs:281`, `MMCA.Store.Catalog.Service/Program.cs:331`,
   `MMCA.Store.Identity.Service/Program.cs:318`, `MMCA.Store.Sales.Service/Program.cs:320` (Helpdesk
   unchanged at `:34` and `:149`); the gateway CORS calls
   (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:131`, `:179`;
   `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:83`, `:168`); the same-origin proxy
   registration and mapping (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:167`, `:290`;
   `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:159`, `:268`); and the ADR-008
   (`:71`, `:101`) and ADR-058 (`:82-84`) cross-references.

## Related
[ADR-079](079-shared-http-middleware-pipeline.md) (the shared middleware pipeline whose fixed order
places the environment-selected CORS policy between routing and authentication), ADR-008 (the
gateway plus per-module service topology this posture splits along, and the record that
first named CORS as a gateway responsibility), ADR-023 (the security-response headers registered
next to CORS in the same gateway and service pipelines), ADR-019 (rate limiting and the
forwarded-header trust that share the same edge and the same middleware ordering), ADR-058 (the
conformance fixtures that pin Production so the restrictive branch is what runs under test),
ADR-070 (the fail-fast configuration contract that `Cors:AllowedOrigins` is deliberately not part
of), ADR-016 (why widening the service allow-list is a lockstep framework release),
[ADR-131](131-same-origin-api-proxy.md) (the UI host's same-origin API proxy, which refuses
cross-origin callers itself and answers preflight locally, so no preflight reaches the gateway
policy).
