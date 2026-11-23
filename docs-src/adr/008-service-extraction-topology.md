# ADR-008: Extraction of the Modular Monolith into Per-Module Services + Gateway

## Status
Accepted. **Amended by [ADR-089](089-gateway-topology-owned-by-configuration.md) (2026-08-18)**: the
Gateway keeps the route-to-service map this record gave it, but stops expressing it as `MapForwarder`
calls in code. YARP `ReverseProxy` configuration becomes the single route source, the per-destination
HTTP version policy moves into cluster configuration, and a route-map test becomes the drift gate. The
topology decision itself is unchanged. See also
[ADR-088](088-gateway-edge-responsibilities.md) (2026-08-18) for the cross-cutting behavior the Gateway
gains at the same time, which is the first added to it since this record. Revised 2026-09-04: the
extraction sequence this topology supports is named as the **Strangler Fig** route (a new service
beside the combined host, one route prefix moved at a time at the Gateway, the old host retired last);
ADC's own history was a one-step cutover and is recorded as such below. Revised 2026-09-25: the
Gateway pipeline description is corrected against the code (both Gateways layer Key Vault
configuration, and ADC's Gateway alone carries an authorization middleware pair that evaluates each
route's declared `anonymous` policy, plus a session-asset upload body cap), and every anchor is
refreshed against current line numbers. The topology decision is unchanged. Revised 2026-10-01
(extracted hosts discover only their own module and reach peers over gRPC clients, and JWKS
federation bypasses the Gateway in production; see Revision below). Revised 2026-10-07: the
cross-service tier's cadence is corrected to weeknights only (a scheduled night is skipped when
`main` has not moved since the last successful run), the single arm-deploy step is scoped to
`main.bicep`, and anchors are refreshed after the v1.233.0 release. Revised 2026-10-21: anchors
refreshed after the v1.250.0 consumer sweep. Revised 2026-10-24: anchors refreshed against current source.
Revised 2026-10-26: anchors refreshed against current source, including the live-section host,
Gateway and `Extensions.cs` anchors the 2026-10-24 pass left stale. Revised 2026-10-28: anchors
refreshed against current source. Revised 2026-11-23: the service hosts are described through the
composed `AddMmcaServiceHost` call (module list, gRPC client and Key Vault passed as options) instead
of `AddModuleHost`, the session-asset upload cap is recorded as YARP route configuration rather than
Gateway pipeline code, and anchors are refreshed.

## Context
ADC began as a modular monolith: one `MMCA.ADC.WebAPI` host loaded every module (Identity, Conference,
Engagement, Notification) in-process via the `ModuleLoader`, sharing one database and dispatching
domain/integration events in-process. The modular structure (per-module Domain/Application/
Infrastructure/API/Shared, with strict module isolation enforced by the architecture tests) was always
maintained, but everything deployed and scaled as a single unit.

Two forces pushed past that:

- **Uneven scale + cost.** Traffic is lopsided: the public Conference read paths spike around the event
  while Identity/Engagement/Notification stay flat (the 2026 conference peaked at ~67 concurrent, almost
  all on the Conference surface). Scaling one monolith means scaling everything.
- **Fault & deploy isolation.** A bad deploy or a runaway path in one module took the others down with
  it, and every change redeployed the whole surface.

The modular boundaries were already clean enough to split along; the question was how to extract
**without rewriting business logic** or losing the ability to reason about (and revert) the system.

## Decision
Extract **one service host per module**: `MMCA.ADC.{Identity,Conference,Engagement,Notification}.Service`
and front them with a single **YARP reverse-proxy Gateway** (`MMCA.ADC.Gateway`, pinned to
`https://localhost:6001`). Delete the combined `MMCA.ADC.WebAPI` host.

- **Each service is the monolith with one module enabled.** The hosts still run `ModuleLoader`, just with
  `Modules:{Module}:Enabled=true` for their own module, and each names only its own module assembly
  in the `ModuleAssemblies` option it passes to `AddMmcaServiceHost`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:82`, list at `:89`), so
  peer modules are never discovered there; the cross-module interfaces a service consumes are
  satisfied by gRPC clients the host registers in its `ConfigurePipeline` option (`:356-358`). The Domain/Application/Shared code is identical whether it runs in-process or extracted.
- **Extraction follows the Strangler Fig route; a rewrite is never the plan.** Nothing in the topology
  needs a big-bang switch. A module is extracted by (1) starting its single-module service host beside
  the combined host, which keeps running with that module turned off (`Modules:{Module}:Enabled=false`)
  and its peers satisfied by the `Disabled*` stubs the `ModuleLoader` registers for disabled modules
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:12-14`, `:121`); (2) moving
  that module's route prefix at the Gateway from the combined host's cluster to the new service's, one
  YARP `ReverseProxy` configuration change under ADR-089 and no client change, because the Gateway is
  the only entry point; and (3) retiring the combined host once no route points at it. Old path and
  new path coexist until traffic has moved, and step (2) reverses by flipping the same route back. ADC
  took the shortest form of this route, extracting all four modules in one step and deleting
  `MMCA.ADC.WebAPI` at the end; a consumer with a live monolith should move one module at a time.
- **The Gateway is the only client entry point.** It owns the route-to-service map (`/Auth`, `/Events`,
  `/Bookmarks`, `/hubs`, `/.well-known`, and so on); clients (Blazor/MAUI) never address a service directly. It
  has no DbContext or controllers. Its pipeline is edge rate limiting
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:89`, `:198`), one per-downstream readiness check
  per service (`:105`), forwarded headers (`:178`), correlation (`:183`), security-headers middleware
  (ADR-023, `:135`, `:188`), CORS (`:140`, `:191`), static files (`:203`), `/privacy`, `/terms` and
  `/delete-account` minimal-API endpoints (`:210`, `:217`, `:221`),
  authorization middleware that evaluates the `anonymous` policy every route declares
  (`AddAuthorization` at `:129`, `UseAuthorization` at `:228`; no authentication scheme is registered,
  so the Gateway authenticates no one, ADR-088), and the proxy itself: the route table is loaded from
  the `ReverseProxy` configuration section and mapped by `MapReverseProxy` (`:166-167`, `:231`), not
  expressed as `MapForwarder` calls in code (ADR-089). A request-body cap raised only for the
  session-asset upload path is route configuration, not pipeline code: the
  `conference-session-assets-file` route sets `MaxRequestBodySize`
  (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:275-281`, value at `:280`). Both Gateways
  layer Azure Key Vault configuration before anything binds settings (ADC
  `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:75`, ahead of `AddServiceDefaults` at `:77`; Store
  `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:67`). Every ADC service host follows the
  same order through the composed host: it passes `AddAzureKeyVaultConfiguration` in its
  `ConfigureConfigurationSources` option
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:91`, `:97`), which
  `AddMmcaServiceHost` invokes before it calls `AddServiceDefaults`
  (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:77`, `:83`).
  The ADC UI host does the same through the composed Blazor host
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:39`, invoked at
  `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hosting/BlazorWebHostExtensions.cs:82`, before
  `AddServiceDefaults` at `:85`).
  Store's Gateway is the same shape without the static files, the `/privacy`, `/terms` and
  `/delete-account` endpoints, the upload-cap route and the authorization pair: its routes declare
  `anonymous` too, but it registers no authorization middleware, by design
  (`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json:46-50`).
- **Cross-service communication uses edge transports:** synchronous calls over gRPC contracts (ADR-007);
  asynchronous flows over the outbox to MassTransit broker (ADR-003, ADR-006). Token validation is
  federated via JWKS (ADR-004): locally the AppHost points each service at Identity through the Gateway
  (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:370-372`), while in production each service
  sets its JWT authority to Identity's internal URL directly (`MMCA.ADC/infra/main.bicep:2484`, `:2623`,
  `:2789`). Each service owns its own database (ADR-006).
- **Transport stays at the edge, enforced.** `MicroserviceExtractionTests` in the architecture suite
  forbid gRPC / MassTransit / Protobuf dependencies in any Domain, Application, or Shared assembly, so the
  core stays host-agnostic and the split stays reversible.

## Rationale
- **No business-logic rewrite.** Because a service is just the monolith with one module enabled,
  extraction was a hosting/wiring change, not a domain change, and the module-isolation tests already
  guaranteed modules didn't reach into each other's internals.
- **One entry point.** A single Gateway keeps client config trivial (one pinned URL the MAUI app bakes
  in), centralizes CORS and auth-forwarding, and lets the internal services run cleartext h2c without
  exposing that to clients.
- **Per-module split (not coarser or finer).** The module already was the consistency and ownership
  boundary; one service per module maps deploy/scale units onto boundaries the team already reasons about.
- **Reversible by construction.** Transport at the edge + the `ModuleLoader` mean a service can be
  re-collapsed into a combined host (or peers co-hosted) by a host-level change, not a domain change: a
  host names the module assemblies it boots in code
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:89`), and configuration then
  enables or disables each of them. Useful
  insurance for a small team adopting microservices.

## Trade-offs
- **Operational complexity.** Four deployables plus a Gateway, service discovery, a broker, and
  per-service databases, versus one process. Mitigated locally by Aspire orchestration and in prod by
  Bicep / Azure Container Apps.
- **Distributed-systems semantics.** Cross-service consistency is eventual (outbox + integration events);
  there are no cross-service transactions or cross-database FKs (ADR-006). Bidirectional gRPC pairs
  (Conference and Engagement) need deliberate startup handling (ADR-007).
- **Transport constraints leak into hosting.** The REST services run `Http2`-only on cleartext for h2c
  gRPC, while Notification runs `Http1AndHttp2` for its SignalR WebSocket upgrade: a per-host Kestrel
  nuance that didn't exist in the monolith.
- **Per-host wiring.** Each service still has its own host project, but the shared start-up is one
  framework call: `AddMmcaServiceHost` from `MMCA.Common.ServiceHost` runs the configuration sources,
  the endpoints, Serilog, `AddServiceDefaults` (declared in `MMCA.Common.Aspire` at
  `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:35`), Redis caching, `AddModuleHost` and
  the infrastructure health checks in a fixed order
  (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:63-104`), and a
  host supplies only its options (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:82`).
  What stays per host is those options (module list, protocols, gRPC clients, vendor configuration),
  which is where drift between hosts can still arise. Neither consumer carries a `ServiceDefaults`
  project of its own.

## Applicability
This ADR is framed around ADC (the first repo extracted), but the same topology is now the framework's
**standard extraction shape**, not an ADC-only choice. MMCA.Store followed it: one service host per
module (`MMCA.Store.{Catalog,Identity,Sales}.Service`) behind a single `MMCA.Store.Gateway` (also
pinned to `https://localhost:6001`), with its combined `MMCA.Store.WebAPI` host likewise deleted.
Store's cross-service topology differs in transport detail (see ADR-012: both apps run Profile A on
their gRPC-serving edges, while ADC's Notification and Store's Sales run the mixed-endpoint profile, an
`Http1AndHttp2` default endpoint beside an `Http2`-only named gRPC endpoint), but the extraction shape
is identical.

**Why ADC extracted, said plainly.** The four hosts
(`MMCA.ADC/Source/Services/MMCA.ADC.{Identity,Conference,Engagement,Notification}.Service`) exist
first of all to demonstrate and continuously exercise the extraction path end to end, because
"build the monolith now, extract a service later" is the framework's core promise and a promise
nothing runs is a claim. They are not the output of a scale, team or deploy-cadence trigger. The
conference peaked at roughly 67 concurrent users (Context above), one team owns every module, and all
six deployables still ship in a single pipeline run from one template
(`MMCA.ADC/infra/main.bicep:2131`, `:2402`, `:2556`, `:2704`, `:2899`, `:3062`, deployed together by a
single `azure/arm-deploy` step for `main.bicep` at `MMCA.ADC/.github/workflows/deploy.yml:1929-1935`), so the
independent-deploy benefit this record lists is available rather than taken. What ADC does buy with the split is proof under load that the path
works: transport stays out of Domain, Application and Shared under a build gate
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Layering/MicroserviceExtractionTests.cs:3`), and the
genuine cross-process flows (outbox to broker to consumer, and a real gRPC read) run on weeknights against
real containers (`MMCA.ADC/.github/workflows/cross-service-tests.yml:6-10`, schedule at `:26-32`;
a scheduled night is skipped only when the branch head equals the head of the last successful run,
`:65-77`). A consumer adopting this topology should extract on an observable constraint (a module that must scale
or fail apart from the rest, or an owner who must deploy on their own clock) and stay a modular
monolith until then; ADC deliberately runs ahead of its own constraints so that consumers do not have
to discover the path for themselves.

## Revision (2026-10-01)
Three statements are corrected against the code; the topology itself is unchanged. The extracted
service hosts do not rely on `Disabled*` stubs for their peers: each passes only its own module
assembly to `AddModuleHost` (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:370-372`,
and likewise in the Engagement, Identity and Notification hosts), so peer modules are never discovered
and the cross-module interfaces are wired by host-registered gRPC clients (`:417`). The
`ModuleLoader` stub path (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:119`)
serves a combined host that discovers a disabled module. Because the module list is named in host
code, re-collapsing services is a host-level change rather than configuration alone. JWKS federation
runs through the Gateway only under the AppHost
(`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:373-375`); production points each service at
Identity directly (`MMCA.ADC/infra/main.bicep:1930`). The remaining anchors (Store Gateway
appsettings, `ModuleLoader`, `Extensions.cs`, the six `main.bicep` container apps and the `deploy.yml`
arm-deploy step) are refreshed to current line numbers.

## Revision (2026-10-06)
- No content changed: the topology and every decision above stand.
- The 2026-10-01 note that the remaining anchors were refreshed no longer holds; current locations:
  the Conference host names its single module assembly to `AddModuleHost` at
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:369-371` and registers its gRPC
  client at `:416`; the AppHost JWKS wiring through the Gateway is at
  `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:365-367`; production points the JWT authority
  at Identity at `MMCA.ADC/infra/main.bicep:1969`, `:2103` and `:2255`; the six container apps sit at
  `:1651`, `:1890`, `:2041`, `:2174`, `:2353` and `:2516`, deployed by the single `main.bicep`
  arm-deploy step at `MMCA.ADC/.github/workflows/deploy.yml:1543-1547`.
- Anchors in the live sections were re-verified against current source.

## Revision (2026-10-07)
Re-verified against current source. The topology and every decision above stand: each extracted
host still names a single module assembly to `AddModuleHost`, peers are still reached over
host-registered gRPC clients, JWKS federation still runs through the Gateway only under the AppHost,
and all six container apps still deploy from one `main.bicep` template. Two live statements (the
cross-service cadence and the arm-deploy step) and the anchors moved.

1. The cross-service tier does not run nightly: its schedule is weeknights at 06:00 UTC
   (`MMCA.ADC/.github/workflows/cross-service-tests.yml:32`, cron `0 6 * * 1-5`), and the
   should-run guard (job at `:51`) skips a scheduled night only when the branch head SHA equals the
   head SHA of the last successful run (`:65-77`), so a night after a failed run still runs. The
   Applicability section now says "on weeknights".
2. The single `azure/arm-deploy` step is single for `main.bicep`, which holds all six apps
   (`MMCA.ADC/.github/workflows/deploy.yml:1433-1439`); a separate arm-deploy step deploys
   `infra/foundation.bicep` (`:972`). The Applicability sentence now names the `main.bicep` step.
3. Anchors re-verified against current source: Conference host `AddModuleHost` call at
   `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:371-373` (single-assembly array
   at `:372`; likewise Engagement `:214`, Identity `:266`, Notification `:196`), gRPC client
   registration at `:418`; AppHost JWKS wiring at
   `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:368-370`; production JWT authority at
   `MMCA.ADC/infra/main.bicep:2003`, `:2139` and `:2293`; the six container apps at `:1675`,
   `:1922`, `:2075`, `:2210`, `:2400` and `:2563`; cross-service header at
   `MMCA.ADC/.github/workflows/cross-service-tests.yml:6-10` and trigger block at `:26-32`.

## Revision (2026-10-21)
Re-verified against current source. No content changed: each extracted host still names a single
module assembly to `AddModuleHost`, the Conference host still registers its Engagement gRPC client,
JWKS federation still runs through the Gateway only under the AppHost, production still points the
JWT authority at Identity's internal URL, and exactly six container apps still deploy from one
`main.bicep` arm-deploy step (a second arm-deploy step deploys `infra/foundation.bicep`). Only line
numbers moved; the dated revisions above keep their anchors as written.

1. Anchors re-verified against current source: Conference host `AddModuleHost` call at
   `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:373-375` (single-assembly array
   at `:374`; likewise Engagement `:214`, Identity `:266`, Notification `:196`), gRPC client
   registration `AddEngagementBookmarkCountClient` at `:420` inside the `AddMmcaApplicationPipeline`
   call at `:418-421`; AppHost JWKS wiring at
   `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:373-375`; production JWT authority at
   `MMCA.ADC/infra/main.bicep:2159`, `:2295` and `:2449`; the six container apps at `:1825`,
   `:2078`, `:2231`, `:2366`, `:2556` and `:2719`; the `main.bicep` arm-deploy step at
   `MMCA.ADC/.github/workflows/deploy.yml:1448-1454` and the `foundation.bicep` arm-deploy step at
   `:987`.

## Revision (2026-10-24)
Re-verified against current source. No content changed: production still points the JWT authority at
Identity's internal URL, and exactly six container apps still deploy from one `main.bicep`
arm-deploy step. Only line numbers moved; the dated revisions above keep their anchors as written.

1. Anchors re-verified against current source: production JWT authority at
   `MMCA.ADC/infra/main.bicep:2194`, `:2330` and `:2484`; the six container apps at `:1860`
   (Identity), `:2113` (Conference), `:2266` (Engagement), `:2401` (Notification), `:2591` (Gateway)
   and `:2754` (UI); the `main.bicep` arm-deploy step at
   `MMCA.ADC/.github/workflows/deploy.yml:1449-1455` and the `foundation.bicep` arm-deploy step at
   `:988`.

## Revision (2026-10-26)
Re-verified against current source. No content changed: each extracted host still names a single
module assembly to `AddModuleHost`, the Conference host still registers its Engagement gRPC client,
both Gateways still layer Key Vault configuration ahead of `AddServiceDefaults`, the ADC Gateway
pipeline holds the same middleware in the same order, JWKS federation still runs through the Gateway
only under the AppHost, and exactly six container apps (and no container app jobs) still deploy from
one `main.bicep` arm-deploy step. Only line numbers moved, and this pass also re-points the live-section
host, Gateway and `Extensions.cs` anchors the 2026-10-24 pass did not cover; the dated revisions above
keep their anchors as written.

1. Anchors re-verified against current source: Conference host `AddModuleHost` call at
   `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:379-381` (single-assembly array
   at `:380`; likewise Engagement `:221`, Identity `:273`, Notification `:203`), Key Vault at `:115`
   before `AddServiceDefaults` at `:117`, gRPC client registration `AddEngagementBookmarkCountClient`
   at `:431` inside the `AddMmcaApplicationPipeline` call starting at `:429`; ADC Gateway
   (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs`) Key Vault `:68`, `AddServiceDefaults` `:70`,
   `AddGatewayRateLimiting` `:82` and `UseGatewayRateLimiting` `:186`, downstream readiness checks
   `:96`, `AddAuthorization` `:120`, `AddCommonSecurityHeaders` `:126` and `UseCommonSecurityHeaders`
   `:176`, `AddCommonGatewayCors` `:131` and `UseCors` `:179`, `AddReverseProxy` with `LoadFromConfig`
   `:154-155`, forwarded headers `:166`, correlation `:171`, static files `:191`, `/privacy` `:198`,
   `/terms` `:205`, `/delete-account` `:209`, upload cap `:220-232`, `UseAuthorization` `:237`,
   `MapReverseProxy` `:240`; Store Gateway Key Vault at
   `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:64` before `AddServiceDefaults` at `:66`;
   AppHost JWKS wiring at `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:374-376`; production
   JWT authority at `MMCA.ADC/infra/main.bicep:2195`, `:2331` and `:2485`; the six container apps at
   `:1861` (Identity), `:2114` (Conference), `:2267` (Engagement), `:2402` (Notification), `:2592`
   (Gateway) and `:2755` (UI); the `main.bicep` arm-deploy step at
   `MMCA.ADC/.github/workflows/deploy.yml:1448-1454` and the `foundation.bicep` arm-deploy step at
   `:988`; `AddServiceDefaults` declared at
   `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:33`.

## Revision (2026-10-28)
Re-verified against current source. No content changed: Store's Gateway still layers Key Vault
configuration ahead of `AddServiceDefaults` and registers no authorization middleware while every
route declares `anonymous`, production still points the JWT authority at Identity's internal URL,
and exactly six container apps (and no container app jobs) still deploy from one `main.bicep`
arm-deploy step beside the separate `foundation.bicep` step. Only line numbers moved; the dated
revisions above keep their anchors as written.

1. Anchors re-verified against current source: Store Gateway Key Vault at
   `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:67` before `AddServiceDefaults` at `:69`
   (by-design comment at `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json:45-49`, the
   `anonymous` policy at `:54`); production JWT authority at `MMCA.ADC/infra/main.bicep:2192`,
   `:2328` and `:2482`; the six container apps at `:1858` (Identity), `:2111` (Conference), `:2264`
   (Engagement), `:2399` (Notification), `:2589` (Gateway) and `:2752` (UI); the `main.bicep`
   arm-deploy step at `MMCA.ADC/.github/workflows/deploy.yml:1449-1455` (`uses` at `:1451`,
   template at `:1454`) and the `foundation.bicep` arm-deploy step at `:988`.

## Revision (2026-11-23)
Re-verified against current source. The topology and every decision above stand: each extracted
host still boots a single module assembly, peers are still reached over host-registered gRPC
clients, Key Vault configuration still precedes `AddServiceDefaults` in every host, the ADC Gateway
still registers no authentication scheme, JWKS federation still runs through the Gateway only under
the AppHost, and exactly six container apps (and no container app jobs) still deploy from one
`main.bicep` arm-deploy step beside the separate `foundation.bicep` step. Two live statements and
the anchors moved; the dated revisions above keep their anchors as written.

1. The service hosts no longer call `AddModuleHost` or their own `AddServiceDefaults`. Each passes
   its single module assembly in the `ModuleAssemblies` option of `AddMmcaServiceHost`
   (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:82`, list at `:89`; likewise
   Engagement `:65`, Identity `:89`, Notification `:65`), registers its gRPC client in the
   `ConfigurePipeline` option (`AddEngagementBookmarkCountClient` at `:358`), and supplies Key Vault
   through `ConfigureConfigurationSources` (`:91`, `:97`), which the composed host runs before
   `AddServiceDefaults`
   (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:77`, `:83`).
   The UI host supplies Key Vault the same way through the composed Blazor host
   (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:39`, run at
   `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hosting/BlazorWebHostExtensions.cs:82` before
   `AddServiceDefaults` at `:85`). The Decision and Rationale sections now name that call, and the
   Trade-offs bullet on host wiring now describes the composed start-up
   (`MMCA.Common/Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:63-104`)
   rather than a pipeline each service repeats.
2. The session-asset upload body cap is no longer Gateway pipeline code: it is the
   `MaxRequestBodySize` of the `conference-session-assets-file` route in the YARP configuration
   (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:275-281`, value at `:280`), so the
   Decision section now lists it beside the pipeline rather than inside it.
3. Anchors re-verified against current source: ADC Gateway
   (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs`) Key Vault `:75`, `AddServiceDefaults` `:77`,
   `AddGatewayRateLimiting` `:89` and `UseGatewayRateLimiting` `:198`, downstream readiness checks
   `:105`, `AddAuthorization` `:129`, `AddCommonSecurityHeaders` `:135` and
   `UseCommonSecurityHeaders` `:188`, `AddCommonGatewayCors` `:140` and `UseCors` `:191`,
   `AddReverseProxy` with `LoadFromConfig` `:166-167`, forwarded headers `:178`, correlation `:183`,
   static files `:203`, `/privacy` `:210`, `/terms` `:217`, `/delete-account` `:221`,
   `UseAuthorization` `:228`, `MapReverseProxy` `:231`; `ModuleLoader` stub registration at
   `MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:121`; AppHost JWKS wiring
   at `MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:370-372`; production JWT authority at
   `MMCA.ADC/infra/main.bicep:2484`, `:2623` and `:2789`; the six container apps at `:2131`
   (Identity), `:2402` (Conference), `:2556` (Engagement), `:2704` (Notification), `:2899` (Gateway)
   and `:3062` (UI); the `main.bicep` arm-deploy step at
   `MMCA.ADC/.github/workflows/deploy.yml:1929-1935` (`uses` at `:1931`, template at `:1934`) and the
   `foundation.bicep`
   arm-deploy step at `:1384` (template at `:1387`); `AddServiceDefaults` declared at
   `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:35`; Store Gateway by-design comment at
   `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json:46-50` and the first `anonymous`
   policy at `:55`.

## Related
ADR-003 (outbox dual dispatch), ADR-004 (cross-service token validation via JWKS), ADR-006 (database
per service), and ADR-007 (gRPC cross-service calls) are the facet decisions that sit under this extraction.
