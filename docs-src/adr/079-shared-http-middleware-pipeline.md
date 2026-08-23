# ADR-079: One Shared, Ordered HTTP Middleware Pipeline for Every Service Host

## Status
Accepted (2026-08-14). Revised 2026-08-19 (refreshed the `WebApplicationBuilderExtensions.cs`
cross-reference anchor, which moved to `:555`). Revised 2026-08-21: the order became data (named
steps seeded by `MiddlewarePipelineBuilder.CreateDefault()`), gained a scoped configure overload
with startup-validated invariants, and is frozen by the `MiddlewarePipelineOrderTestsBase` fitness
function; the two costs this record originally carried as open trade-offs are retired below.

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
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:46`), and have
every REST/gRPC host call it instead of composing its own.

- **One call, whole edge, controllers included.** The method is an `extension(WebApplication app)`
  member (`WebApplicationExtensions.cs:35`) that applies every edge middleware and finishes by
  mapping controllers, returning the app for chaining. A host's composition root is one line, not a
  hand-ordered list.
- **The order is data, not prose.** Each step is a named `MiddlewarePipelineStep` (a name plus the
  configure delegate), the names are constants on `MiddlewarePipelineStepNames`
  (`Startup/MiddlewarePipelineStepNames.cs:17-74`, declared in application order), and
  `MiddlewarePipelineBuilder.CreateDefault()` (`Startup/MiddlewarePipelineBuilder.cs:31-156`) seeds
  the eighteen defaults: exception handler, correlation id, request localization, pre-forwarded
  scheme/host capture, forwarded headers, gRPC-exempt HTTPS redirect, response compression, routing,
  CORS, authentication, tenant resolution, rate limiter, soft-deleted-user check, authorization,
  output cache, JWKS and OIDC discovery endpoints, controllers. Both overloads route through one
  private helper that builds the list and applies it in order (`WebApplicationExtensions.cs:138-147`).
- **A scoped escape hatch, validated at startup.** The
  `UseCommonMiddlewarePipeline(Action<MiddlewarePipelineBuilder>)` overload
  (`WebApplicationExtensions.cs:58`) hands the host the seeded builder, which can `InsertBefore`,
  `InsertAfter`, `Replace`, or `Remove` steps by name (`MiddlewarePipelineBuilder.cs:166-229`;
  unknown anchors and duplicate names throw). `Build()` (`:257-280`) then re-checks the load-bearing
  adjacencies below and throws naming the violated invariant, so a customized pipeline fails while
  the host is starting instead of misordering silently. An invariant binds only when both of its
  steps are still present, so dropping a whole capability (both members of a pair) stays legal.
- **Authentication before tenant resolution, and the code says why.** The `TenantResolution` step
  sits immediately after `Authentication` (`MiddlewarePipelineBuilder.cs:112-118`), because the claim
  strategy reads `HttpContext.User`, which carries token claims only once authentication has run
  (comment at `:114-117`, ADR-073). `Build()` enforces the adjacency (`:264-267`).
- **Authentication before rate limiting, and the code says why.** The `RateLimiting` step runs
  after authentication on purpose: the global partition keys on the authenticated principal and routes
  anonymous traffic down a `NoLimiter` branch, so an unpopulated `HttpContext.User` would make every
  request look anonymous and the per-user cap would never engage (comment at
  `MiddlewarePipelineBuilder.cs:122-125`, ADR-019). `Build()` enforces the precedence (`:269-272`).
- **Forwarded headers before anything that reads the client IP, trusting any proxy.**
  The `ForwardedHeaders` step (`MiddlewarePipelineBuilder.cs:64-80`) is configured for
  `XForwardedFor | XForwardedProto | XForwardedHost` (`:68-71`) with both `KnownProxies` and
  `KnownIPNetworks` cleared (`:76-77`), because cloud reverse proxies front the services from internal
  addresses that are not in the default allow-lists (comment at `:73-75`). It sits ahead of the rate
  limiter, which is the ordering ADR-019 depends on, and `Build()` enforces that it precedes the
  HTTPS redirect (`:274-277`).
- **HTTPS redirect is exempted for gRPC.** The redirect is wrapped in `app.UseWhen` and skipped for any
  request whose `Content-Type` starts with `application/grpc`
  (`MiddlewarePipelineBuilder.cs:90-92`), because extracted services are reached over HTTP/2
  cleartext and a 307 on those requests breaks the call (comment at `:84-89`, ADR-012).
- **The soft-deleted-user check sits between the limiter and authorization.**
  `SoftDeletedUserMiddleware` (`Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:31`)
  is the `SoftDeletedUserFilter` step (`MiddlewarePipelineBuilder.cs:128-130`), after `RateLimiting`
  and before `Authorization`, so a revoked account is rejected before any endpoint authorizes it
  (ADR-047).
- **JWKS and OIDC discovery are always mapped.** The `JwksEndpoint` and `OidcDiscoveryEndpoint` steps
  (`MiddlewarePipelineBuilder.cs:140-151`) are unconditional; a non-Identity host answers with an
  empty key set or a 404 rather than a different pipeline shape (comment at `:142-146`;
  `OidcDiscoveryEndpointExtensions.cs:63-66` is the 404 path).
- **The order is frozen by a fitness function.** `MiddlewarePipelineOrderTestsBase`
  (`Source/Hosting/MMCA.Common.Testing/MiddlewarePipelineOrderTestsBase.cs:29`) is the edge
  counterpart of ADR-014's `DecoratorPipelineOrderTestsBase`: it seeds the default builder, applies
  the subclass's `Configure` customization if any (`:35`), and asserts the step sequence is exactly
  the documented order (`:60-67`) and that `Build()`'s invariants hold (`:69-77`). No
  `WebApplication` is built, so it runs in the fast unit tier. The framework subclasses it in its own
  test pass (`Tests/Hosting/MMCA.Common.Testing.Tests/MiddlewarePipelineOrderTests.cs`); consumer
  repos subclass it next to their decorator-order tests.
- **Conditional middleware is registered unconditionally and made inert at runtime.** Both
  `TenantResolutionMiddleware` (the `TenantResolution` step, `MiddlewarePipelineBuilder.cs:112-118`) and
  `SoftDeletedUserMiddleware` (the `SoftDeletedUserFilter` step, `:128-130`) are always in the chain:
  the first passes the request straight through unless `Tenancy:Enabled` is set
  (`Middleware/TenantResolutionMiddleware.cs:62`), the second resolves `ISoftDeletedUserValidator`
  lazily and no-ops where no implementation is registered
  (`Middleware/SoftDeletedUserMiddleware.cs:43-50`), so the pipeline is literally one shape on every
  host rather than a per-host permutation.
- **Every REST/gRPC host calls it.** All seven extracted services in the two production apps: ADC
  Identity (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:322`), ADC Conference
  (`MMCA.ADC.Conference.Service/Program.cs:399`), ADC Engagement
  (`MMCA.ADC.Engagement.Service/Program.cs:334`), ADC Notification
  (`MMCA.ADC.Notification.Service/Program.cs:264`), Store Catalog
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:268`), Store Identity
  (`MMCA.Store.Identity.Service/Program.cs:257`) and Store Sales
  (`MMCA.Store.Sales.Service/Program.cs:277`). The reference app calls it too
  (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:117`), and because that tree **is** the
  `mmca-app` template (`MMCA.Helpdesk/.template.config/template.json:5,7`, ADR-065), a scaffolded app
  gets the same line: the generated `MMCA.ECommerce` sample has it at
  `MMCA.ECommerce/Source/Hosts/MMCA.ECommerce.Web/Program.cs:100`.
- **Hosts extend it by appending, after the call, or through the builder.** Service hosts map their
  extra endpoints below the one line: OpenAPI outside Production
  (`MMCA.ADC.Notification.Service/Program.cs:271-274`), the SignalR hub (`:281`, which
  `SignalRExtensions.cs:18-19` documents as "call after `UseCommonMiddlewarePipeline`"), and gRPC
  services (`:286` and `:294`). A host that needs a change inside the edge uses the configure overload
  instead; no host does today, and every one of the eight production and reference hosts calls the
  zero-argument overload.

Scope is REST and gRPC service hosts. The Blazor UI hosts and the YARP gateways deliberately do not
call it: the gateways compose a much thinner chain (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:95`,
`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:119`), and the UI hosts hand-compose their own,
reusing only the localization half via `UseCommonRequestLocalization()`
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:124`,
`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:164`), which is the public method the
pipeline's `RequestLocalization` step calls (`MiddlewarePipelineBuilder.cs:47`,
`WebApplicationExtensions.cs:71`).

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
- **Two of this record's original costs are retired (2026-08-21).** As accepted, nothing froze the
  order (no test referenced the method; the adjacencies were protected by comments and review, and
  that was the weakest point of the decision) and there was no extension point (the method took no
  parameters, so the escape hatch was all-or-nothing: stop calling it and re-implement the chain,
  which is what the Blazor UI hosts still deliberately do,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:145,164`,
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:105,124`). Both are addressed by the revision
  above: `MiddlewarePipelineOrderTestsBase` turns a reorder into a red test, `Build()` turns a
  misordered customization into a startup failure, and the configure overload makes the escape hatch
  scoped instead of all-or-nothing. What remains true: the fitness function is opt-in per repo, so a
  consumer that never subclasses it gets only the startup validation, and only for the invariants
  `Build()` knows about, not for the full sequence.
- **The extension API is a new public surface to hold stable.** Step names are now contract:
  renaming a constant on `MiddlewarePipelineStepNames`, or reordering in a way the invariants do not
  cover, is a behavior change for any host using the configure overload. No host uses it yet, which
  makes this cheap today and easy to underestimate later.
- **Controllers are mapped inside the call.** Because the `Controllers` step is last
  (`MiddlewarePipelineBuilder.cs:153-155`), every endpoint a host maps after the call is registered
  after controller routing. Hosts that need a hub or a gRPC service simply map it later; a host that
  genuinely needs something ahead of controllers can now `InsertBefore(Controllers, ...)` through the
  configure overload instead of abandoning the method.
- **Trusting any proxy is a deliberate security trade.** With `KnownProxies` and `KnownIPNetworks`
  cleared (`MiddlewarePipelineBuilder.cs:76-77`), `X-Forwarded-For` is accepted from any caller, so the IP-keyed rate-limit
  partitions are spoofable by anything that can reach a service directly. This is safe only because the
  services are not publicly routable and sit behind the gateway; ADR-019 records the same caveat.
- **Security-response headers are not in this pipeline.** ADR-023's `UseCommonSecurityHeaders` is applied
  by the gateways and UI hosts only (`MMCA.ADC.Gateway/Program.cs:117`, `MMCA.Store.Gateway/Program.cs:140`,
  `MMCA.ADC.UI.Web/Program.cs:105`, `MMCA.Store.UI.Web/Program.cs:145`). A service host exposed directly,
  without a gateway in front, would serve responses without them.
- **One step in the fixed order is currently dead weight.** The pre-forwarded scheme/host capture
  (the `PreForwardedCapture` step, `MiddlewarePipelineBuilder.cs:49-62`) writes
  `HttpContext.Items["PreForwardedScheme"]` and `["PreForwardedHost"]`, and the keys' XML doc
  (`WebApplicationExtensions.cs:18-35`) says the OIDC discovery endpoint consumes them. It no longer
  does: `MapOidcDiscoveryEndpoint` derives `jwks_uri` from `Jwt:Issuer`
  (`OidcDiscoveryEndpointExtensions.cs:76`, with the rationale at `:68-75`), and a workspace-wide search
  for `PreForwarded` finds no reader anywhere outside this file and the onboarding chapters that
  describe it. The step costs one delegate per request and stays because removing it is a separate
  change (now a one-line `Remove` for a host that wants it gone), but it is not load-bearing today,
  and its `Build()` adjacency invariant guards the capture's fidelity, not a live consumer.
  A related casualty of the accepted revision: the method's summary comment, which used to list a
  stale subset of the order, now points at the step-name contract instead of restating it.

## Related
[ADR-014](014-cqrs-decorator-pipeline.md) (the in-process sibling: one fixed decorator order for commands
and queries), [ADR-019](019-rate-limiting.md) (depends on forwarded headers before the limiter and on the
limiter after authentication), [ADR-047](047-soft-deleted-user-session-revocation.md) (depends on the slot
between authentication and authorization), [ADR-073](073-multi-tenancy-model.md) (depends on the slot
immediately after authentication), [ADR-027](027-multi-locale-i18n.md) (the request localization this
pipeline wires at `:47`), [ADR-012](012-grpc-host-transport.md) (the h2c transport the HTTPS-redirect
exemption exists for), [ADR-040](040-authenticated-output-caching-for-public-reads.md) (the output cache
at `:136-138`), [ADR-023](023-security-response-headers.md) (the edge middleware deliberately NOT in this
pipeline), [ADR-008](008-service-extraction-topology.md) (the extraction path this shared edge preserves).
