# ADR-079: One Shared, Ordered HTTP Middleware Pipeline for Every Service Host

## Status
Accepted (2026-08-14). Revised 2026-08-19 (refreshed the `WebApplicationBuilderExtensions.cs`
cross-reference anchor, which moved to `:555`).

## Context
In ASP.NET Core, middleware order is behavior, not style: a rate limiter placed before authentication
partitions every request as anonymous, an HTTPS redirect placed in front of a gRPC call breaks the
call, and a tenant resolver that reads `HttpContext.User` before `UseAuthentication` resolves nothing.
Each of those is a silent, correct-looking build.

The framework already ships that pipeline as a single call. Three accepted records cite it as *where*
their middleware sits: ADR-019 relies on forwarded headers running before the rate limiter
(`019-rate-limiting.md:77`), ADR-047 pins `SoftDeletedUserMiddleware` between authentication and
authorization (`047-soft-deleted-user-session-revocation.md:33-38`), and ADR-073 places
`TenantResolutionMiddleware` immediately after `UseAuthentication` because claim-first resolution needs
a populated principal (`073-multi-tenancy-model.md:74-81`). All three take the pipeline as given
context. None of them decides it, and nothing else does either, so the one ordering that every host in
both production apps depends on has been an implementation detail of a method rather than a recorded
decision. This record makes the pipeline itself the decision.

It is the HTTP counterpart of ADR-014, which does the same job for the CQRS decorator chain: one fixed,
documented order that handler and host authors do not re-litigate per project.

## Decision
Ship the edge as **one ordered pipeline in the framework**, `UseCommonMiddlewarePipeline`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:45`), and have
every REST/gRPC host call it instead of composing its own.

- **One call, whole edge, controllers included.** The method is an `extension(WebApplication app)`
  member (`WebApplicationExtensions.cs:37`) that registers every edge middleware and finishes by
  mapping controllers (`:121`), returning the app for chaining (`:123`). A host's composition root is
  one line, not a hand-ordered list.
- **The order is fixed and complete.** Exception handler (`:47`), correlation id (`:48`), request
  localization (`:53`), pre-forwarded scheme/host capture (`:72-77`), forwarded headers (`:79`),
  gRPC-exempt HTTPS redirect (`:87-89`), response compression (`:91`), routing (`:92`), CORS (`:93-95`),
  authentication (`:96`), tenant resolution (`:102`), rate limiter (`:108`), soft-deleted-user check
  (`:109`), authorization (`:110`), output cache (`:111`), JWKS (`:118`) and OIDC discovery (`:119`)
  endpoints, controllers (`:121`).
- **Authentication before tenant resolution, and the code says why.** `TenantResolutionMiddleware`
  is registered at `:102`, immediately after `app.UseAuthentication()` (`:96`), because the claim
  strategy reads `HttpContext.User`, which carries token claims only once authentication has run
  (comment at `:98-101`, ADR-073).
- **Authentication before rate limiting, and the code says why.** `app.UseRateLimiter()` (`:108`) runs
  after authentication on purpose: the global partition keys on the authenticated principal and routes
  anonymous traffic down a `NoLimiter` branch, so an unpopulated `HttpContext.User` would make every
  request look anonymous and the per-user cap would never engage (comment at `:104-107`, ADR-019).
- **Forwarded headers before anything that reads the client IP, trusting any proxy.**
  `UseForwardedHeaders` (`:79`) is configured for `XForwardedFor | XForwardedProto | XForwardedHost`
  (`:55-58`) with both `KnownProxies` and `KnownIPNetworks` cleared (`:63-64`), because cloud reverse
  proxies front the services from internal addresses that are not in the default allow-lists (comment
  at `:60-62`). It sits ahead of the rate limiter (`:108`), which is the ordering ADR-019 depends on.
- **HTTPS redirect is exempted for gRPC.** The redirect is wrapped in `app.UseWhen` and skipped for any
  request whose `Content-Type` starts with `application/grpc` (`:87-89`), because extracted services
  are reached over HTTP/2 cleartext and a 307 on those requests breaks the call (comment at `:81-86`,
  ADR-012).
- **The soft-deleted-user check sits between the limiter and authorization.**
  `SoftDeletedUserMiddleware` (`Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:31`)
  is registered at `:109`, after `UseRateLimiter` (`:108`) and before `UseAuthorization` (`:110`), so a
  revoked account is rejected before any endpoint authorizes it (ADR-047).
- **JWKS and OIDC discovery are always mapped.** `MapJwksEndpoint()` (`:118`) and
  `MapOidcDiscoveryEndpoint()` (`:119`) are unconditional; a non-Identity host answers with an empty key
  set or a 404 rather than a different pipeline shape (comment at `:113-117`;
  `OidcDiscoveryEndpointExtensions.cs:63-66` is the 404 path).
- **Conditional middleware is registered unconditionally and made inert by configuration.** Both
  `TenantResolutionMiddleware` (`:102`) and `SoftDeletedUserMiddleware` (`:109`) are always in the chain
  and gated by their own settings, so the pipeline is literally one shape on every host rather than a
  per-host permutation.
- **Every REST/gRPC host calls it.** All seven extracted services in the two production apps: ADC
  Identity (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:322`), ADC Conference
  (`MMCA.ADC.Conference.Service/Program.cs:392`), ADC Engagement
  (`MMCA.ADC.Engagement.Service/Program.cs:328`), ADC Notification
  (`MMCA.ADC.Notification.Service/Program.cs:258`), Store Catalog
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:266`), Store Identity
  (`MMCA.Store.Identity.Service/Program.cs:257`) and Store Sales
  (`MMCA.Store.Sales.Service/Program.cs:275`). The reference app calls it too
  (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:111`), and because that tree **is** the
  `mmca-app` template (`MMCA.Helpdesk/.template.config/template.json:5,7`, ADR-065), a scaffolded app
  gets the same line: the generated `MMCA.ECommerce` sample has it at
  `MMCA.ECommerce/Source/Hosts/MMCA.ECommerce.Web/Program.cs:100`.
- **Hosts extend it by appending, after the call.** Service hosts map their extra endpoints below the
  one line: OpenAPI outside Production (`MMCA.ADC.Notification.Service/Program.cs:265-268`), the SignalR
  hub (`:275`, which `SignalRExtensions.cs:18-19` documents as "call after
  `UseCommonMiddlewarePipeline`"), and gRPC services (`:277-279`).

Scope is REST and gRPC service hosts. The Blazor UI hosts and the YARP gateways deliberately do not
call it: the gateways compose a much thinner chain (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:95`,
`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:119`), and the UI hosts hand-compose their own,
reusing only the localization half via `UseCommonRequestLocalization()`
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:124`,
`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:164`), which is the public method the pipeline
itself calls at `:53` (`WebApplicationExtensions.cs:133`).

## Rationale
- **Order is behavior, so it belongs to the framework, not to each host.** Four of the adjacencies above
  fail silently when reversed: the limiter stops limiting, the tenant resolver resolves nothing, the
  client IP becomes the proxy's, and gRPC calls get redirected. Centralizing removes the chance to get
  any of them wrong once per host, which is the same invariant-over-discipline posture as ADR-015.
- **One place to change means one place to review.** ADR-019, ADR-047 and ADR-073 each added middleware
  by editing this method, and each got a comment explaining its position. The comments accumulate where
  the ordering lives instead of being copied into seven `Program.cs` files.
- **Unconditional-and-inert keeps the shape stable.** Gating on configuration rather than on
  registration means a host that turns multi-tenancy on later changes a setting, not its pipeline, and
  a diff between two hosts' edges is empty by construction.
- **It preserves the extraction path.** ADR-008 promises a module can be lifted into its own service
  without a rewrite. A host-owned pipeline would make the new service's edge a hand-transcribed copy;
  one shared call makes the extracted service inherit the identical edge behavior for free.
- **It is the HTTP sibling of a pattern already proven in-process.** ADR-014 fixes the decorator order
  for commands and queries for the same reason and with the same result: authors reason about one
  documented sequence.

## Trade-offs
- **Nothing freezes the order.** A workspace-wide search finds no test referencing
  `UseCommonMiddlewarePipeline`: the only non-host references are the method itself, a cross-reference
  in `WebApplicationBuilderExtensions.cs:555` and one in `SignalRExtensions.cs:19`. Reordering two lines
  compiles, passes every analyzer, and passes the unit tiers. The load-bearing adjacencies are protected
  by comments and review, not by a fitness test. That is the weakest point of this decision.
- **There is no extension point for a host that needs a deviation.** The method takes no parameters and
  exposes no hooks (`WebApplicationExtensions.cs:45`). A host can only prepend or append around the
  call; it cannot insert into the middle, replace one step, or drop one. A host that genuinely needs a
  different edge has to stop calling the method and re-implement the whole chain, which is what the
  Blazor UI hosts do (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:145,164`,
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:105,124`). That is the honest cost of the fixed
  order: the escape hatch is all-or-nothing.
- **Controllers are mapped inside the call.** Because `MapControllers()` runs at `:121`, every endpoint
  a host maps afterwards is registered after controller routing. Hosts that need a hub or a gRPC service
  simply map it later, but a host cannot use this method and still map something ahead of controllers.
- **Trusting any proxy is a deliberate security trade.** With `KnownProxies` and `KnownIPNetworks`
  cleared (`:63-64`), `X-Forwarded-For` is accepted from any caller, so the IP-keyed rate-limit
  partitions are spoofable by anything that can reach a service directly. This is safe only because the
  services are not publicly routable and sit behind the gateway; ADR-019 records the same caveat.
- **Security-response headers are not in this pipeline.** ADR-023's `UseCommonSecurityHeaders` is applied
  by the gateways and UI hosts only (`MMCA.ADC.Gateway/Program.cs:117`, `MMCA.Store.Gateway/Program.cs:140`,
  `MMCA.ADC.UI.Web/Program.cs:105`, `MMCA.Store.UI.Web/Program.cs:145`). A service host exposed directly,
  without a gateway in front, would serve responses without them.
- **One step in the fixed order is currently dead weight.** The pre-forwarded scheme/host capture
  (`:72-77`) writes `HttpContext.Items["PreForwardedScheme"]` and `["PreForwardedHost"]`, and its XML doc
  (`:18-35`) says the OIDC discovery endpoint consumes them. It no longer does:
  `MapOidcDiscoveryEndpoint` derives `jwks_uri` from `Jwt:Issuer`
  (`OidcDiscoveryEndpointExtensions.cs:76`, with the rationale at `:68-75`), and a workspace-wide search
  for `PreForwarded` finds no reader anywhere outside this file and the onboarding chapters that
  describe it. The middleware costs one delegate per request and stays because removing it is a separate
  change, but it is not load-bearing today.
- **The method's own summary comment is not the contract.** The order listed at `:39-44` omits request
  localization, the pre-forwarded capture, and the JWKS/OIDC mapping that the body actually registers.
  Read the body, not the summary.

## Related
[ADR-014](014-cqrs-decorator-pipeline.md) (the in-process sibling: one fixed decorator order for commands
and queries), [ADR-019](019-rate-limiting.md) (depends on forwarded headers before the limiter and on the
limiter after authentication), [ADR-047](047-soft-deleted-user-session-revocation.md) (depends on the slot
between authentication and authorization), [ADR-073](073-multi-tenancy-model.md) (depends on the slot
immediately after authentication), [ADR-027](027-multi-locale-i18n.md) (the request localization this
pipeline wires at `:53`), [ADR-012](012-grpc-host-transport.md) (the h2c transport the HTTPS-redirect
exemption exists for), [ADR-040](040-authenticated-output-caching-for-public-reads.md) (the output cache
at `:111`), [ADR-023](023-security-response-headers.md) (the edge middleware deliberately NOT in this
pipeline), [ADR-008](008-service-extraction-topology.md) (the extraction path this shared edge preserves).
