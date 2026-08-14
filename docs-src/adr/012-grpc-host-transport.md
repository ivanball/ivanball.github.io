# ADR-012: gRPC-Host Transport Convention (Http2-only h2c vs. Http1AndHttp2 + ALPN)

## Status
Accepted (re-verified against source 2026-08-14).

## Update (2026-06-22): Store converged to Profile A
Store originally chose Profile B, but its cross-service gRPC failed in Azure Container Apps. With
`Http1AndHttp2` Kestrel + `transport: 'auto'` ingress on a **cleartext** endpoint there is no ALPN, so
envoy delivered HTTP/1.1 to Catalog and Identity (which **do** serve inbound gRPC: Sales → Catalog,
Sales → Identity) and Kestrel rejected it with `HTTP_1_1_REQUIRED` (Sales `AddItemCommand` 500'd calling
`IProductVariantService.ExistsAsync`). The lesson: a "consumer-only / one-directional" edge topology
still has inbound **cleartext gRPC servers**, and ACA cleartext ingress cannot deliver HTTP/2 to them
under Profile B.

Fixed in commit 49b7283 (deployed green) by adopting **Profile A** for Store:
- Catalog + Identity run `Http2`-only on cleartext (`Kestrel:EndpointDefaults:Protocols=Http2`), ACA
  ingress `transport: 'http2'`, and shipped at the time with **TCP** startup/liveness probes
  (Http2-only Kestrel rejects the kubelet's HTTP/1.1 `httpGet` probes with GOAWAY).
  *(The TCP-probe half of this bullet was superseded on 2026-07-27: Store replaced those probes with
  the dedicated Http1-only probe listener. The Kestrel and ingress halves still hold. See the
  2026-07-28 update below.)*
- Gateway forwards HTTP/2 (`ForwardHttp2=true`, `VersionPolicy=RequestVersionExact`); Catalog/Identity
  routes carry HTTP/2, Sales routes stay HTTP/1.1.
- Sales (no gRPC server) stays `Http1AndHttp2` with `transport: 'http'`.
  *(The "no gRPC server" half was superseded on 2026-08-14: Sales serves one inbound gRPC contract
  from a dedicated `Http2`-only named endpoint. Its default endpoint and `transport: 'http'` ingress
  still hold. See the 2026-08-14 update below.)*
- JWKS authority differs by environment: **prod ACA** keeps the direct `http://identity` authority (the
  http2 ingress carries the HTTP/1.1 JwtBearer JWKS metadata fetch to the container), while the
  **local-Aspire** path was subsequently moved to the gateway-routed `WithJwksDiscovery(identity, gateway)`
  form (the D32 fix): a single-arg local `WithJwksDiscovery` would aim the HTTP/1.1 backchannel at the
  now-Http2-only Identity HTTPS endpoint and fail on the ALPN mismatch. So Store's local JWKS now matches
  Profile A's gateway-routed discovery; only prod uses the in-cluster direct authority.

**Both consumers now use Profile A** for their gRPC-serving edges. `Http1AndHttp2` (Profile-B Kestrel)
survives on two non-gRPC-serving hosts for two different reasons: ADC's **Notification** service (its
WebSocket Upgrade handshake needs HTTP/1.1) and Store's **Sales** service (a consumer-only host that
serves no inbound cleartext gRPC, so it never needed Http2-only). Profile B is retained below as (a) the
original rationale for the split and (b) the still-valid rule for those no-inbound-gRPC hosts.
*(Since 2026-07-09, ADC's Notification does serve inbound gRPC, from a dedicated Http2-only
endpoint alongside its Http1AndHttp2 default endpoint: see the mixed-endpoint update below, and the
2026-08-07 update for the second gRPC service that endpoint now carries. Store's Sales is no longer
a no-inbound-gRPC host either: it runs that same mixed-endpoint profile today, for
`IUserSalesExportService`. See the 2026-08-14 update below.)*

## Update (2026-07-09): ADC Notification adds a mixed-endpoint profile (per-endpoint protocols)

The live-channel push pipeline (ADR-039) gave ADC's Notification service an **inbound cleartext gRPC
server** (`LiveChannelPushService.PushToChannel`, called best-effort by Engagement command handlers)
while it still hosts the SignalR hub whose WebSocket transport needs the HTTP/1.1 Upgrade handshake.
That combination breaks the original per-host rule ("a WebSocket host cannot be a cleartext gRPC
server"): neither whole-host profile fits, because the constraint was only ever per **endpoint**, not
per host. The resolution is to split protocols across two Kestrel endpoints in one process:

- **Kestrel (per-endpoint, not per-host):** the default `http` endpoint (container port 8080) stays
  `Http1AndHttp2` for REST, health probes, and the SignalR WebSocket Upgrade; a second named `grpc`
  endpoint (container port 8081) is `Http2`-only for h2c prior-knowledge gRPC. Declared in
  `Kestrel:Endpoints` in the service's appsettings (with distinct fixed dev ports in
  `appsettings.Development.json`, not in the launch profile: see the 2026-08-07 update below).
- **Aspire (local):** the AppHost wires `engagementService.WithReference(notificationService)`, which
  injects `services__notification__grpc__0`; the typed client registers against the **named endpoint
  scheme** `http://_grpc.notification` so service discovery resolves the gRPC port, not the default
  one. Deliberately no `WaitFor`: the publish path is best-effort and must not couple Engagement
  startup to Notification availability.
- **ACA (prod):** the main ingress stays HTTP/1.1-capable for WebSockets; the gRPC port is exposed via
  `additionalPortMappings` as a dedicated **internal TCP** port mapping (TCP passthrough sidesteps the
  envoy single-transport limitation: one app cannot serve HTTP/1.1 WebSockets and end-to-end HTTP/2 on
  the same HTTP ingress). The Bicep injects the same discovery variable pointing at
  `http://<app>-notification:8081`.
- **Probes and gateway: unchanged.** The default endpoint still answers the kubelet's HTTP/1.1
  `httpGet` probes (no TCP-probe workaround needed, unlike full Profile A hosts), and the gateway
  never routes the gRPC endpoint (it is service-to-service only).
  *(The probes half of this bullet was superseded on 2026-07-25: Notification's probes now target a
  third, dedicated Http1-only listener, and no ADC host uses TCP probes. The gateway half still
  holds. See the 2026-07-25 update below.)*

Rule refinement: a service that needs the HTTP/1.1 Upgrade handshake AND must serve inbound cleartext
gRPC uses this **mixed-endpoint profile**: Profile B protocols on the default endpoint, a Profile A
`Http2`-only named endpoint for gRPC, discovery via the named-endpoint scheme, and (in ACA) an
additional internal TCP port. It costs one extra port everywhere (appsettings, launch profile, Bicep)
and is only worth it when both constraints genuinely meet in one host.

## Update (2026-07-25): probe listeners are ADC's answer, not TCP probes; and gateway-routed JWKS is a local-only rule

Two claims above were written from an earlier state of the code and no longer describe either app.

**1. ADC probes never touch the traffic endpoint; TCP probes were then Store-only.** Every ADC service now
adds a dedicated `Http1`-only Kestrel listener whose only job is to answer the platform's HTTP/1.1
`httpGet` probes, on a port that is never exposed via ingress:

- The three Profile A hosts (Identity, Conference, Engagement) listen on **8081**. Bicep injects
  `HealthProbe__Port=8081` (`MMCA.ADC/infra/main.bicep:1076`, `:1267`, `:1387`) and points startup,
  liveness, and readiness at it (three `httpGet` probes on 8081, `main.bicep:1183-1207` for
  Identity, under the explanatory comment at `:1176-1182`). The listener is added from each
  service's `Program.cs` (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:81`,
  Conference `Program.cs:85`, Engagement `Program.cs:68`); the per-service
  `KestrelConfiguration.ConfigureHttp2WithHealthProbe` helper this update originally named no longer
  exists and has been replaced by a shared framework method (see the 2026-08-07 update below).
- The mixed-endpoint host (Notification) listens on **8082**, one port above its `grpc` endpoint:
  `HealthProbe__Port=8082` at `main.bicep:1530`, with all three probes on 8082 at
  `main.bicep:1583-1607`. Its listener is added from
  `MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:71` and is strictly
  additive on top of the config-declared 8080 and 8081 endpoints, explicitly so that all four
  services probe the same way.

So Notification's default endpoint no longer serves the probes either, and the parenthetical
contrast with "full Profile A hosts" was backwards: those hosts use the same dedicated-listener
pattern, not TCP probes. As of this update `tcpSocket` probes were still in use in **MMCA.Store**,
on Identity and Catalog, whose Http2-only default endpoint would answer an HTTP/1.1 `httpGet` with
GOAWAY `HTTP_1_1_REQUIRED`. The trade is real: a TCP probe only proves the listener is bound, while
the dedicated listener lets readiness run the actual `/health/ready` check (warmup gate plus the
DB-aware check), which is why ADC moved, and (two days later) why Store followed: see the
2026-07-28 update below.

**2. `WithJwksDiscovery(identity, gateway)` is local Aspire wiring, not ADC's production rule.**
The two-argument call sites are all in the AppHost
(`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:271-273`), which configures the local
Aspire environment only. In production ACA, ADC's Bicep hardcodes the **direct in-cluster authority**
`http://${identityApp.name}` on every token-validating service: Conference (`main.bicep:1284`),
Engagement (`:1403`), and Notification (`:1546`). Identity's own ingress is `transport: 'http2'`
(`main.bicep:1037`; Conference `:1238` and Engagement `:1362` match, while Notification `:1485`,
the Gateway `:1645`, and the UI `:1747` stay `'http'`), so envoy accepts the HTTP/1.1 JwtBearer
metadata fetch and carries it to the container. That is exactly the arrangement the Store update
above describes, so the
"JWKS authority differs by environment" nuance is **not** Store-specific: both apps route discovery
through the gateway locally and use the direct in-cluster authority in production. Read the Profile A
JWKS bullet below as the local-development rule plus the reason the direct authority cannot be used
from a default backchannel outside ACA.

## Update (2026-07-28): the probe listener is the single pattern in both apps (no TCP probes anywhere)

Store PR #55 (commit `297064bb`, merged 2026-07-27) ported ADC's dedicated probe listener to Store,
so the Store-only `tcpSocket` exception recorded in the 2026-07-25 update above is gone. **Neither
production Bicep file contains a `tcpSocket` probe: every container app in both apps is probed over
HTTP/1.1 `httpGet`.** The pattern is now uniform:

- **Each `Http2`-only host adds a dedicated `Http1`-only Kestrel listener** whose only job is to
  answer the platform's HTTP/1.1 probes, on a port that is never exposed via ingress. It is added
  when `HealthProbe:Port` is set: the call re-declares the h2c traffic endpoint on 8080 and opens
  the probe port as `Http1`. At this update the two apps carried byte-identical copies of a
  per-service `KestrelConfiguration.ConfigureHttp2WithHealthProbe`; those copies have since been
  folded into one framework method (the 2026-08-07 update below). Store's call sites are
  `MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:65` and
  `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:58`.
- **Bicep injects the port and points startup, liveness, and readiness at it.** Store sets
  `HealthProbe__Port=8081` on Identity (`MMCA.Store/infra/main.bicep:1064`) and Catalog (`:1164`),
  with `/alive` for startup and liveness and `/health/ready` for readiness on 8081
  (`main.bicep:1077-1079` and `:1176-1178`). ADC is unchanged (8081 for the three Profile A hosts,
  8082 for Notification): its Bicep line anchors drift with unrelated observability commits, and
  were last re-verified and corrected in the 2026-07-25 section above on 2026-08-14.
- **Hosts whose default endpoint never went Http2-only keep probing their traffic port.** Store's
  Sales, Gateway, and UI probe 8080 directly (`MMCA.Store/infra/main.bicep:1303-1305`, `:1376-1378`,
  `:1473-1475`), because an `Http1AndHttp2` endpoint answers the HTTP/1.1 probe on its own.

Rule: the dedicated probe listener is part of Profile A, not an app-specific workaround. A host that
goes `Http2`-only on cleartext gets the extra `Http1` listener plus `HealthProbe__Port` in its Bicep
in the same change. A TCP probe is not the answer: it only proves the socket is bound and never
reaches the readiness pipeline (the warmup gate plus the DB-aware check), so a replica that cannot
reach its database keeps serving traffic.

## Update (2026-08-07): the probe listener moved into MMCA.Common, and Notification's gRPC endpoint carries a second service

**1. One shared framework method, not a per-service file.** The `KestrelConfiguration.cs` copies the
two updates above cite no longer exist in either app. The pattern was extracted into
`MMCA.Common.Aspire` as one `WebApplicationBuilder` extension,
`ConfigureEndpointsWithHealthProbe(HttpProtocols defaultProtocols, bool redeclareCleartextEndpoint =
true, int cleartextPort = DefaultCleartextPort)`
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Kestrel/KestrelEndpointExtensions.cs:77`, with
`DefaultCleartextPort = 8080` at `:37`). It applies the protocol set to the endpoint defaults
(`:92`) and declares each explicit listener (`:96`); with no `HealthProbe:Port` configured it
declares no explicit listener at all (`:119`), so the endpoint defaults stand alone and Aspire's
dynamic local ports keep working. Both deployed profiles are now that one call with different
arguments:

- **Profile A hosts** pass `HttpProtocols.Http2` and keep the default
  `redeclareCleartextEndpoint: true`, because an explicit `Listen` call overrides the container's
  `ASPNETCORE_HTTP_PORTS` binding, so the h2c traffic endpoint has to be re-declared alongside the
  probe port (`KestrelEndpointExtensions.cs:49-52`). Call sites: ADC Identity `Program.cs:81`,
  Conference `Program.cs:85`, Engagement `Program.cs:68`; Store Identity `Program.cs:65`, Catalog
  `Program.cs:58`.
- **The mixed-endpoint hosts** pass `HttpProtocols.Http1AndHttp2` with
  `redeclareCleartextEndpoint: false`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:71`, and Store's Sales at
  `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:76`). That flag is the
  parameter name for the "strictly additive" behavior the 2026-07-25 update described: a host whose
  endpoints come from configuration must not re-bind a port the configuration already owns
  (`KestrelEndpointExtensions.cs:53-59`, `:64-68`).

No host writes `ConfigureEndpointDefaults` by hand any more: the call appears nowhere in either
app's source, and every service that constrains its Kestrel protocols does it through this one
framework method (the Gateway and UI hosts constrain nothing and keep the platform defaults).
(This section originally recorded Store's Sales as
the one holdout still writing the call literally. That is no longer true: Sales runs the
mixed-endpoint profile on the shared helper, `Program.cs:76`. See the 2026-08-14 update below.)

**2. Notification's `grpc` endpoint now serves two gRPC services, one of them authorized.** The
mixed-endpoint profile is no longer a one-edge exception. Notification maps `LiveChannelGrpcService`
(the best-effort Engagement push ingress,
`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:280`) and
`UserNotificationExportGrpcService` with `.RequireAuthorization()` (`:288`) on the same `Http2`-only
`grpc` endpoint. The second consumer is Identity: its data-subject export aggregates the user's
notification inbox rows through the client registered at
`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:281`, wired by
`identityService.WithReference(notificationService)` locally
(`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:237`) and by the same
`services__notification__grpc__0` discovery variable in production (`MMCA.ADC/infra/main.bicep:1120`,
pointing at the `additionalPortMappings` h2c port). The contracts are
`Protos/live_channel.proto:19` and `Protos/user_notification_export.proto:17` in
`MMCA.ADC.Notification.Contracts`. Transport-wise nothing changes, which is the point: the one extra
port the mixed-endpoint profile costs carries any number of gRPC services. Ingress isolation is not
treated as the authorization boundary, though: the export endpoint returns personal data keyed by a
raw user id, so it requires the caller's forwarded JWT on top of being internal-only.

**3. Notification's dev ports live in `appsettings.Development.json`, not the launch profile.** Its
`launchSettings.json` carries no `applicationUrl` (two bare profiles that set only
`ASPNETCORE_ENVIRONMENT`). The fixed dev ports are Kestrel endpoint configuration
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/appsettings.Development.json:6-21`: http
55998 `Http1AndHttp2`, https 55997 `Http1AndHttp2`, grpc 55996 `Http2`), and the in-file comment
(`:2-5`) records why: Aspire models endpoints from Kestrel config, and mixing an `applicationUrl`
with Kestrel endpoint configuration is an AppHost error. So the "declare the extra port in three
places" trade-off is appsettings (production), `appsettings.Development.json` (local), and the ACA
`additionalPortMappings`.

## Update (2026-08-14): Store's Sales runs the mixed-endpoint profile too, so no pure Profile B host remains

Sales gained an inbound gRPC edge of its own (`IUserSalesExportService`, the Identity-driven
data-subject export), and it resolved that the same way ADC's Notification did: not by flipping the
host to `Http2`-only, but by adding a dedicated `Http2`-only named endpoint beside an
`Http1AndHttp2` default. The mixed-endpoint profile is therefore a two-app pattern, and its driver
is not only the WebSocket Upgrade handshake. Sales' default endpoint has to stay HTTP/1.1-capable
because the ACA `http`-transport envoy delivers HTTP/1.1 and because the Gateway forwards Sales'
REST routes plus the Stripe webhook over HTTP/1.1
(`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:62-72`).

- **Kestrel:** `http` on 8080 `Http1AndHttp2` and `grpc` on 8081 `Http2`, both declared in
  configuration (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/appsettings.json:11-13` and
  `:15-17`), with the fixed dev ports in `appsettings.Development.json` (http 55996, https 55995,
  grpc 55990, at `:9-20`) for the same reason Notification uses that file rather than a launch
  profile (`:2-6`). The host calls the shared framework method,
  `builder.ConfigureEndpointsWithHealthProbe(HttpProtocols.Http1AndHttp2, redeclareCleartextEndpoint: false)`
  (`Program.cs:76`), exactly as Notification does.
- **The gRPC service is authorized, not merely internal:** `UserSalesExportGrpcService` is mapped
  with `.RequireAuthorization()` (`Program.cs:291`) because it returns personal data keyed by a raw
  `CustomerId`; the caller forwards the end user's JWT. That matches the reasoning recorded for
  ADC's export endpoint in the 2026-08-07 update.
- **Discovery:** Identity registers the client with `AddSalesUserExportClient()`
  (`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:237`), whose default service
  name is the named-endpoint scheme `_grpc.sales`
  (`MMCA.Store/Source/Services/MMCA.Store.Sales.Contracts/DependencyInjection.cs:51`). Locally the
  AppHost wires `identityService.WithReference(salesService)`
  (`MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:199`); in production the Bicep injects
  `services__sales__grpc__0 = http://<prefix>-sales:8081` on Identity
  (`MMCA.Store/infra/main.bicep:1040`).
- **ACA:** Sales' main ingress stays `transport: 'http'` (`main.bicep:1209`) and the gRPC port is an
  internal TCP `additionalPortMappings` entry on 8081 (`:1216-1222`), the same TCP-passthrough
  arrangement ADC's Notification uses. Sales still needs no `HealthProbe__Port`: its
  `Http1AndHttp2` default endpoint answers the platform's HTTP/1.1 probes on 8080 directly
  (`:1303-1305`).

Consequence for this ADR's taxonomy: **no deployed host is pure Profile B any more.**
`Http1AndHttp2` survives in both apps only as the default-endpoint half of the mixed-endpoint
profile (ADC Notification for the SignalR WebSocket Upgrade, Store Sales for REST plus the Stripe
webhook), each paired with an `Http2`-only named endpoint for cleartext gRPC. Read the Profile B
section below as the description of that half, plus the historical rationale for the original split.

## Context
Once modules were extracted into separate service hosts (ADR-008) that call each other synchronously
over gRPC (ADR-007), each service's Kestrel had to serve **both** REST traffic (HTTP/1.1 from the
gateway and clients) and gRPC traffic (HTTP/2 from peer services). On a **cleartext** endpoint there
is no TLS, so there is no ALPN to negotiate the protocol: Kestrel must be told up front which
protocol(s) the cleartext port speaks. Two valid configurations exist, and the two downstream apps
deliberately pick different ones because their cross-service topologies differ:

- **MMCA.ADC** has a **bidirectional** gRPC pair (Conference ↔ Engagement, plus Notification →
  Identity). A gRPC client over h2c must reach a server that speaks HTTP/2 on cleartext.
- **MMCA.Store** was *originally assumed* to have only **one-directional, consumer-only** gRPC edges
  (Sales → Catalog, Sales → Identity). That assumption proved wrong in Azure Container Apps (Catalog
  and Identity **do** serve inbound cleartext gRPC) which is why Store later converged on Profile A
  (see the Update above). This section preserves the original split as historical rationale.

The subtlety: a gRPC client using h2c **prior knowledge** sends an HTTP/2 preface with no upgrade
handshake. If the server's cleartext endpoint is `Http1AndHttp2`, Kestrel (lacking ALPN on
cleartext) answers HTTP/1.1 and the client fails with `HTTP_1_1_REQUIRED`. Forcing `Http2`-only on
cleartext fixes gRPC but then a default `HttpClient` (HTTP/1.1): e.g. the JwtBearer JWKS backchannel
or the YARP forwarder: can no longer hit that endpoint directly. So the Kestrel choice forces
matching choices for **gateway forwarding** and **JWKS discovery routing**.

## Decision
Pick one of two coherent transport profiles per app, and wire the gateway forwarder and JWKS
discovery to match.

### Profile A (ADC): `Http2`-only h2c + gateway-routed JWKS
Use when services must **serve** gRPC on cleartext (any bidirectional / inbound gRPC edge).

- **Kestrel:** endpoint defaults set to `HttpProtocols.Http2` (also
  `"Kestrel:EndpointDefaults:Protocols": "Http2"` in appsettings). No Profile A host writes the
  `ConfigureEndpointDefaults` call itself: it lives inside the shared framework method
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Kestrel/KestrelEndpointExtensions.cs:92`), which
  each host invokes as `builder.ConfigureEndpointsWithHealthProbe(HttpProtocols.Http2)`. The
  cleartext endpoint is HTTP/2-only (h2c prior knowledge), so peer gRPC clients negotiate without
  TLS/ALPN.
- **Gateway:** `ForwardHttp2 = true` → YARP forwards REST as HTTP/2 (`HttpVersion.Version20`,
  `VersionPolicy = RequestVersionExact`). `RequestVersionOrLower` would silently downgrade to HTTP/1.1,
  which the Http2-only backend rejects with `HTTP_1_1_REQUIRED`, so the policy must be *exact*. In Azure
  Container Apps, ingress must be `transport: http2`.
- **JWKS discovery (local):** `WithJwksDiscovery(identity, gateway)`. The default JwtBearer metadata
  backchannel is HTTP/1.1 and **cannot** reach the Http2-only Identity endpoint directly, so the
  authority is set to the **gateway** HTTPS origin; the gateway terminates TLS, speaks HTTP/1.1 + 2
  via ALPN, and routes `/.well-known/*` on to Identity over HTTP/2 (ADR-004). This is the
  **local Aspire** wiring only (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:271-273`).
  **In production ACA both apps set the direct in-cluster authority** `http://<identity app>` and let
  the `transport: 'http2'` ingress carry the HTTP/1.1 metadata fetch to the container: see the
  2026-07-25 update above for the ADC Bicep anchors.
- **Exception:** the Notification service keeps `Http1AndHttp2` on its default endpoint because
  SignalR's WebSocket transport needs the HTTP/1.1 Upgrade handshake. Since 2026-07-09 it also serves
  inbound gRPC from a dedicated `Http2`-only named endpoint (the mixed-endpoint profile in the update
  above), today two services on that one endpoint: `LiveChannelGrpcService` and the authorized
  `UserNotificationExportGrpcService`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:280`, `:288`). So "serves no
  inbound gRPC" no longer holds for the host, only for its default endpoint.

### Profile B: `Http1AndHttp2` + HTTPS/ALPN + `ForwardHttp2=false` + direct JWKS (Store's original choice; now retained only as the default-endpoint half of the mixed-endpoint profile)
Use when no service needs to **serve** gRPC on cleartext (consumer-only / one-directional gRPC).

- **Kestrel:** `ConfigureEndpointDefaults(o => o.Protocols = HttpProtocols.Http1AndHttp2)` (also
  `"Protocols": "Http1AndHttp2"`), applied today by the shared framework method rather than written
  by hand: the two hosts that keep this profile on their default endpoint both call
  `builder.ConfigureEndpointsWithHealthProbe(HttpProtocols.Http1AndHttp2, redeclareCleartextEndpoint: false)`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:71`,
  `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Program.cs:76`). The cleartext endpoint
  defaults to HTTP/1.1 (no ALPN); the **HTTPS** endpoint negotiates HTTP/1.1 **or** HTTP/2 via ALPN.
  gRPC clients use the HTTPS endpoint
  (the AppHost selects the `https` launch profile) so they get HTTP/2 through ALPN.
- **Gateway:** `ForwardHttp2 = false` (default) → YARP forwards REST as HTTP/1.1, which the
  `Http1AndHttp2` backends accept on cleartext. In ACA, envoy ingress is plain HTTP/1.1.
- **JWKS discovery:** `WithJwksDiscovery(identity)` with **no gateway argument**. The default
  JwtBearer backchannel reaches Identity's HTTPS endpoint and ALPN negotiates HTTP/2, so no gateway
  hop is needed for discovery (the gateway still routes `/.well-known/*` so the canonical issuer
  origin serves the discovery doc for clients).

### When to use which
- **Any service that hosts an inbound gRPC server reachable over cleartext h2c (especially a
  bidirectional pair) → Profile A.** Cleartext h2c prior knowledge requires an `Http2`-only endpoint;
  that in turn forces `ForwardHttp2=true` and gateway-routed JWKS.
- **Only consumer-only / one-directional gRPC, with gRPC riding the HTTPS/ALPN endpoint → Profile B.**
  Keep `Http1AndHttp2`, `ForwardHttp2=false`, and direct `WithJwksDiscovery(identity)`.
- A service whose default endpoint must stay HTTP/1.1-capable must keep `Http1AndHttp2` on that
  endpoint, whether the reason is the **HTTP/1.1 Upgrade** handshake (SignalR WebSockets, ADC's
  Notification) or an HTTP/1.1 REST and webhook surface behind an `http`-transport ingress (Store's
  Sales). If it must also serve cleartext gRPC, do not flip the host profile: add a dedicated
  `Http2`-only named endpoint instead (the 2026-07-09 mixed-endpoint update above, and the
  2026-08-14 update for the second host on it).

## Rationale
- **The Kestrel protocol choice is the root constraint**; the gateway-forward mode and the JWKS
  authority are downstream consequences, not independent knobs. Documenting them as a pair prevents
  the half-configured failure modes (`HTTP_1_1_REQUIRED` on gRPC, or a JwtBearer backchannel that
  can't fetch JWKS from an Http2-only endpoint).
- **Each app picks the minimum that its topology needs.** ADC's bidirectional gRPC forced the
  `Http2`-only profile (and the gateway-routed JWKS that comes with it) from the start. Store
  originally chose Profile B on the assumption its gRPC edges were consumer-only, but Catalog and
  Identity in fact serve inbound cleartext gRPC (Sales → Catalog, Sales → Identity), so it converged
  on Profile A (see the Update above). Profile B now survives only as the default-endpoint half of
  the mixed-endpoint profile, on the two hosts whose default endpoint has to answer HTTP/1.1: ADC's
  Notification (the SignalR WebSocket Upgrade) and Store's Sales (REST plus the Stripe webhook).

## Trade-offs
- **Two profiles to keep straight.** A service that gains an inbound gRPC edge must migrate from
  Profile B to Profile A *and* flip `ForwardHttp2` and the JWKS wiring together, or it breaks.
- **ACA ingress coupling.** Profile A requires `transport: http2` on the container app ingress;
  Profile B uses default HTTP/1.1 ingress. The Bicep must match the chosen profile.
- **Mixed profiles within one app are possible but sharp-edged** (ADC's Notification and Store's Sales
  each run `Http1AndHttp2` Kestrel defaults inside an otherwise-Profile-A app); only do this for a
  service whose default endpoint serves no cleartext gRPC, and document why.
- **Mixed endpoints within one host cost a port.** The Notification mixed-endpoint profile needs the
  extra gRPC port declared consistently in `appsettings.json`, `appsettings.Development.json` (the
  dev ports, not the launch profile), and the ACA `additionalPortMappings`; a missing declaration in
  any one of them fails only at runtime (discovery resolves a port nothing listens on, or ACA never
  exposes it). The port is a per-host cost, not a per-edge one: that one endpoint already serves two
  gRPC services.

## Related
- ADR-004 (cross-service token validation via JWKS / OIDC discovery), ADR-007 (gRPC cross-service
  calls), ADR-008 (monolith → services + gateway topology), ADR-039 (live-channel push: the pipeline
  that gave Notification its inbound gRPC edge and motivated the mixed-endpoint profile).
