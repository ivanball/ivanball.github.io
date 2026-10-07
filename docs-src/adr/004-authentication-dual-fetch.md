# ADR-004: Cross-Service Token Validation via JWKS / OIDC Discovery

## Status
Accepted. Updated 2026-09-03 (`JwtSettings` / `JwtSigningAlgorithm` cited at their real `Auth/`
paths, and the validator registration described with its current signature and secure-by-default
`RequireHttpsMetadata` resolution). Revised 2026-10-07: gateway-routed discovery is scoped to the
local Aspire wiring (production ACA validators in ADC and Store use the direct internal-ingress
Identity authority), and the resilience claim now says the Polly pipeline covers the warmup prefetch
but not the JwtBearer middleware's own discovery fetch.

## Context
When the modular monolith is extracted into per-module service hosts behind a gateway (ADR-008),
every service must authenticate the same end-user JWT, but only one service (Identity) issues tokens.
In the monolith, issuer and validator are the same process, so a single symmetric secret
(HMAC-SHA256) suffices: the secret that signs a token also validates it. Once Identity is a separate
process, sharing that symmetric secret with every other service means every service can also *mint*
tokens, and rotating the secret becomes a coordinated multi-service change. We needed a way for
extracted services to validate Identity's tokens without holding any signing key material, and
without pinning configuration that breaks when the internal service-discovery hostname differs from
the public issuer URL.

## Decision
Validate cross-service tokens with **asymmetric (RS256) signatures plus JWKS / OIDC discovery**,
keeping the symmetric (HS256) shared-secret path as the in-process monolith option. The signing
mode is a single configuration switch (`JwtSettings.SigningAlgorithm`), and it defaults to `RS256`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:30`, reasoning at `:24-29`):
a host that never sets the key gets the algorithm that survives extraction. A single-process monolith
opts into HS256 explicitly, alongside the `Jwt:SecretForKey` that choice requires
(`.../Auth/JwtSigningAlgorithm.cs:14-19`).

**Issuer side (Identity service).**
- Identity signs access tokens with its RSA private key (RS256) and publishes only the matching
  public key (ADC's Identity service sets `"SigningAlgorithm": "RS256"`).
- `IJwksProvider` / `RsaJwksProvider` materialize a `JsonWebKeySet` from a PEM public key
  (`JwksSettings`: `Enabled` defaults to `false`, `KeyId` defaults to `"default"`, key supplied
  inline via `RsaPublicKeyPem` or by `RsaPublicKeyPath`). When publishing is disabled or no key is
  configured, the provider returns an empty key set, so the endpoint stays queryable.
- Two well-known endpoints are mapped centrally for every host (`MapJwksEndpoint`,
  `MapOidcDiscoveryEndpoint`), both anonymous: `/.well-known/jwks.json` and
  `/.well-known/openid-configuration`. The discovery document advertises the validation-relevant
  `issuer` + `jwks_uri` (plus minimal OIDC metadata: `response_types_supported`,
  `subject_types_supported`, `id_token_signing_alg_values_supported`) and returns `404` when
  `Jwt:Issuer` is unset, so a non-Identity host serving the same route exposes nothing.

**Validator side (every other service).**
- `AddForwardedJwtBearer(authority, audience, configuration, environment, requireHttpsMetadata: null)`
  points the JWT bearer middleware at an `Authority`, so it fetches
  `{authority}/.well-known/openid-configuration`, follows `jwks_uri`, and validates the token
  signature against the published key
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:52-57`).
  No service except Identity holds key material. ADC's Conference, Engagement, and Notification
  services and Store's Catalog and Sales services all use this path
  (`.../MMCA.ADC.Conference.Service/Program.cs:331`, `.../MMCA.ADC.Engagement.Service/Program.cs:178`,
  `.../MMCA.ADC.Notification.Service/Program.cs:168`; `.../MMCA.Store.Catalog.Service/Program.cs:205`,
  `.../MMCA.Store.Sales.Service/Program.cs:179`), passing the host's `IConfiguration` and
  `IHostEnvironment` and leaving `requireHttpsMetadata` at its default. All five resolve the audience
  fail-closed through the Common `JwtAudience.RequireConfigured(builder.Configuration[JwtAudience.ConfigKey])`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/Auth/JwtAudience.cs:17`, key `Jwt:Audience`
  at `:20`, guard at `:28`), so a host with no configured audience fails at startup instead of
  validating against a hard-coded default.
- The metadata fetch is HTTPS-only by default, and the caller supplies configuration and environment
  so the framework can resolve that: the explicit `requireHttpsMetadata` argument when it is not
  null, then the `Authentication:JwtBearer:RequireHttpsMetadata` configuration key, then `true`
  everywhere except Development (`.../WebApplicationBuilderExtensions.Authentication.cs:64-66`, key
  declared at `:25`). Resolving to `false` outside Development stays legal, because an internal-ingress h2c
  authority is a real deployment shape, but it registers `InsecureJwtMetadataWarningStartupFilter`
  so the host logs one startup warning naming the key
  (`.../WebApplicationBuilderExtensions.Authentication.cs:68-72`).
- `ValidIssuer` is deliberately **not** pinned: the middleware takes the issuer from the discovery
  document, because the `authority` need not be the token's `iss` origin. Locally the authority is
  the gateway's HTTPS endpoint (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:332-335`);
  in ADC's production deployment it is Identity's internal-ingress URL `http://${identityApp.name}`
  (`MMCA.ADC/infra/main.bicep:2003`) while Identity issues tokens with `iss` set to the public
  gateway origin (`MMCA.ADC/infra/main.bicep:1769`).
- Both validators pin `TokenValidationParameters.ValidAlgorithms` so an attacker cannot force an
  algorithm swap (for example, signing an HS256 token using the RSA public key as the HMAC secret):
  the **forwarded JWKS** validator (`AddForwardedJwtBearer`) pins `[RS256]` (the JWKS path only ever
  validates Identity's asymmetric tokens), and the **in-process** validator
  (`AddCommonAuthentication` → `BuildValidationParameters`) pins `[RS256]` for the asymmetric path or
  `[HS256]` for the symmetric one.
- `AddCommonAuthentication(configuration)` remains the in-process path: HS256 with the shared Base64
  secret (the monolith option), or RS256 validating against a locally configured public-key PEM (no
  JWKS fetch). It requires `RsaPublicKeyPem` when RS256 is selected and directs extracted services to
  `AddForwardedJwtBearer` instead.

**Discovery routing and fallback.**
- Discovery is wired by the AppHost helper `WithJwksDiscovery(identity, gateway?)`. Because the
  extracted REST services listen HTTP/2-only on cleartext for h2c gRPC (ADR-012), the default
  HTTP/1.1 JwtBearer backchannel cannot reach Identity directly, so the authority is set to the
  **gateway** HTTPS origin; the gateway terminates TLS, speaks HTTP/1.1 and HTTP/2 via ALPN, and
  forwards `/.well-known/*` on to Identity. When no gateway is passed, it **falls back** to Identity's
  HTTPS endpoint directly (HTTP/2-only, so the gateway form is preferred). ADC's AppHost uses the
  two-argument gateway form for all three validating services
  (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:368-370`).
- That gateway routing is the local Aspire wiring only; Store's AppHost uses the same gateway form
  for Catalog and Sales (`MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:357-358`). In
  the Azure Container Apps deployments the validators set `Authentication__JwtBearer__Authority`
  to Identity's internal-ingress URL `http://${identityApp.name}` directly (ADC:
  `MMCA.ADC/infra/main.bicep:2003`, `:2139`, `:2293`; Store: `MMCA.Store/infra/main.bicep:1684`,
  `:1819`), where TLS terminates at the platform edge, and pair it with
  `Authentication__JwtBearer__RequireHttpsMetadata=false` (ADC: `:2007`, `:2143`, `:2297`; Store:
  `:1689`, `:1824`), which is the shape the startup warning above exists for.
- `OpenIdConnectMetadataWarmupTask` (MMCA.Common.Aspire) pre-fetches the discovery document at
  startup through an `IHttpClientFactory` client
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Warmup/OpenIdConnectMetadataWarmupTask.cs:45`),
  aimed at the classic "first request fails, second succeeds" pattern on a cold, CPU-throttled
  Azure Container Apps Consumption replica. It warms the issuer and the discovery path, but it does
  not populate the JwtBearer middleware's `ConfigurationManager`, which caches discovery state
  separately and still performs its own fetch on the first authenticated request
  (`.../Warmup/OpenIdConnectMetadataWarmupTask.cs:16-19`).
- SignalR cannot send an `Authorization` header on the WebSocket upgrade, so both registration paths
  read the token from the `access_token` query string for `/hubs` requests.

## Rationale
- **No shared signing key.** Only Identity can mint tokens; every other service holds only the public
  key it fetched, so a compromised non-Identity service cannot forge tokens, and key rotation is
  publish-once at the issuer.
- **Discovery over hard-coded keys.** Fetching the key set via OIDC discovery means consumers need no
  per-service key configuration, and rotation does not require redeploying every validator.
- **Origin-aligned issuer.** Deriving the issuer from the discovery document rather than pinning it
  keeps validation working when the internal hostname and the public issuer differ, which is the
  normal case behind a gateway.
- **RS256 is the default, HS256 the monolith option.** A single-process deployment whose issuer and
  validators live in one host can share the symmetric key and skip RSA key management entirely, so the
  algorithm switch lets the same code run either way. The default is the asymmetric one because it is
  the choice whose token format does not change when that host is later extracted, and because a host
  that never thought about the setting should not be the one holding a key that mints tokens.

## Trade-offs
- **More moving parts than a shared secret.** RS256 needs key generation, distribution of the public
  half, a JWKS endpoint, and discovery wiring, versus one symmetric string.
- **Discovery is a startup dependency.** A validator cannot verify tokens until it has fetched the key
  set. The warmup task reduces the cold-start cost without removing it: the middleware's own fetch
  uses its own `HttpClient` (no `Backchannel` is set, see below), so it does not reuse the warmup
  client's connection pool, and only issuer-side and process-wide state is shared. The middleware
  caches the key set after its first fetch. The Polly pipeline only partly covers this: `AddServiceDefaults()` attaches
  `AddStandardResilienceHandler` through `ConfigureHttpClientDefaults`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:39-49`), which reaches only
  `IHttpClientFactory` clients, so the warmup prefetch is covered
  (`.../Warmup/OpenIdConnectMetadataWarmupTask.cs:22`, `:45`). The JwtBearer middleware's own
  `ConfigurationManager` fetch is separate (`OpenIdConnectMetadataWarmupTask.cs:16-19`), and
  `AddForwardedJwtBearerCore` sets no `Backchannel` or `BackchannelHttpHandler`
  (`.../WebApplicationBuilderExtensions.Authentication.cs:83-114`), so that fetch does not run
  through a Common-registered resilience pipeline; what retry, if any, applies to it is left to
  the framework's default backchannel. ADR-009 itself does not address discovery.
- **Transport coupling.** Locally, the HTTP/2-only cleartext endpoints (ADR-012) force discovery
  through the gateway; the direct-Identity fallback exists but is HTTP/2-only, so the AppHost prefers
  the gateway form. In production the internal-ingress authority removes that coupling at the cost
  of a cleartext metadata fetch inside the environment.
- **Endpoint hygiene is on the issuer.** JWKS and discovery are anonymous by definition; the discovery
  doc returns `404` on non-issuer hosts and the JWKS provider returns an empty set when unconfigured,
  so only the real issuer advertises a key.

## Revision (2026-10-01)
Anchor-only refresh; no decision or rationale changed. The `AddForwardedJwtBearer` registration
lives in the partial file
`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs`,
so its citations are re-anchored there: the signature at `:51-56`, the `RequireHttpsMetadata`
resolution at `:63-65`, the config key at `:24`, and the `InsecureJwtMetadataWarningStartupFilter`
registration at `:67-71`.

## Revision (2026-10-06)
Anchor-only refresh; no decision, rationale or behavior changed.
- The `AddForwardedJwtBearer` citations in the Decision section moved down one line in
  `WebApplicationBuilderExtensions.Authentication.cs`: the signature is now at `:52-57`, the
  `RequireHttpsMetadata` resolution at `:64-66`, the config key at `:25`, and the
  `InsecureJwtMetadataWarningStartupFilter` registration at `:68-72` (the filter class itself is
  declared at `Startup/Auth/InsecureJwtMetadataWarningStartupFilter.cs:15`).
- The ADC Conference service call is cited at `Program.cs:329`, where `services.AddForwardedJwtBearer(` starts.
- All other anchors in the live sections were re-verified against current source and are unchanged.

## Revision (2026-10-07)
Re-verified against current source. The signing model, the validator registration, the
`RequireHttpsMetadata` resolution and the decision not to pin `ValidIssuer` are unchanged; three
statements about discovery routing, the warmup task and discovery resilience were overstated and
are now scoped to what source shows.
1. Gateway-routed discovery is the local Aspire wiring
   (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:368-370`,
   `MMCA.Store/Source/Hosting/MMCA.Store.AppHost/Program.cs:357-358`). The production validators use
   Identity's internal-ingress authority directly (ADC: `MMCA.ADC/infra/main.bicep:2003`, `:2139`,
   `:2293`; Store: `MMCA.Store/infra/main.bicep:1684`, `:1819`) with `RequireHttpsMetadata=false`
   (ADC: `:2007`, `:2143`, `:2297`; Store: `:1689`, `:1824`). The Decision bullet, the
   `ValidIssuer` bullet (whose example authority was the Aspire service-discovery URL; it now names
   the gateway endpoint locally and the internal-ingress URL in production, against the public
   `Jwt__Issuer` at `MMCA.ADC/infra/main.bicep:1769`), the Transport coupling trade-off and the
   ADR-012 entry under Related now say so.
2. The warmup bullet no longer says the first authenticated request skips the discovery round trip:
   the middleware's `ConfigurationManager` still performs its own fetch
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Warmup/OpenIdConnectMetadataWarmupTask.cs:16-19`),
   and the Discovery trade-off now says the warmup reduces rather than absorbs the cold-start cost.
3. The Discovery trade-off no longer credits ADR-009 with covering the discovery fetch. The
   standard resilience handler is attached through `ConfigureHttpClientDefaults`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:39-49`) and so reaches the
   `IHttpClientFactory` client the warmup task uses (`.../Warmup/OpenIdConnectMetadataWarmupTask.cs:45`);
   `AddForwardedJwtBearerCore` sets no backchannel
   (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:83-114`),
   so the middleware's own `ConfigurationManager` fetch is outside that pipeline. The ADR-009 entry
   under Related now says so.
4. Anchors re-verified against current source: the ADC Conference service call moved to
   `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:331`; the
   `AddForwardedJwtBearer` signature (`:52-57`), `RequireHttpsMetadata` resolution (`:64-66`) and
   warning-filter registration (`:68-72`) in `WebApplicationBuilderExtensions.Authentication.cs`
   are unchanged.

## Related
ADR-007 (gRPC calls forward the validated JWT downstream via `JwtForwardingClientInterceptor`),
ADR-008 (the extraction that split issuer and validator into separate processes), ADR-012 (the
HTTP/2-only transport that forces gateway-routed discovery in the local Aspire wiring), ADR-009
(resilience; its Polly pipeline covers the warmup prefetch, not the middleware's own discovery
fetch).
