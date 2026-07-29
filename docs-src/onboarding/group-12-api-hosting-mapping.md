# 12. API Hosting, Middleware, Idempotency & DTO/Contract Mapping

**What this group covers.** This is the ASP.NET Core edge of the framework: the layer that turns an
HTTP request into a domain call and turns a [`Result`](group-01-result-error-handling.md#result) back
into an HTTP response. Almost everything here lives in `MMCA.Common.API` (the presentation layer that
sits above Infrastructure in the dependency flow, see [primer §1](00-primer.md#1-the-big-picture)),
with a handful of transport-agnostic collaborators in `MMCA.Common.Application`
([`ICorrelationContext`](#icorrelationcontext),
[`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](#ientitydtomappertentity-tentitydto-tidentifiertype)),
`MMCA.Common.Infrastructure` ([`CorrelationContext`](#correlationcontext),
[`JwtForwardingDelegatingHandler`](#jwtforwardingdelegatinghandler)), and `MMCA.Common.Shared` (the
DTO vocabulary and [`SupportedCultures`](#supportedcultures)). The group has six interlocking
concerns: the **composition root** that registers the whole edge; the **middleware pipeline** every
request flows through in a fixed order; the **error translation** that keeps every failure shaped like
RFC 9457 Problem Details; the **controller hierarchy** that hands a module ready-made CRUD, auth, and
service-discovery endpoints; the **contract surface** (DTO/request mapping, JSON conversion, model
binding, idempotency, correlation, feature gating); and the **well-known endpoints** that make an
extracted service self-describing. Read the group as the reusable ASP.NET host a downstream service
(Store, ADC, Helpdesk, or an extracted microservice) drops into place so its own code is nothing but
modules. Its central rubric column is [Rubric §9, API & Contract Design] (consistent, versioned,
standardized contracts and error shapes), with heavy supporting roles for [Rubric §10, Cross-Cutting
Concerns], [Rubric §11, Security], [Rubric §13, Observability & Operability], [Rubric §7, Microservices
Readiness], and (since [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html))
[Rubric §27, Internationalization].

**The composition root: `AddAPI` plus the builder extensions.** A host wires the edge through two
static extension classes. [`DependencyInjection`](#dependencyinjection)'s `AddAPI`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:42`) registers MVC
controllers with the global [`UnhandledResultFailureFilter`](#unhandledresultfailurefilter)
(`DependencyInjection.cs:47`), wires the [`CurrencyJsonConverter`](#currencyjsonconverter) into the
JSON options and adds the XML formatters (`DependencyInjection.cs:49-50`), optionally installs the
[`ModuleControllerFeatureProvider`](#modulecontrollerfeatureprovider) when a
[`ModulesSettings`](group-14-module-system-composition.md#modulessettings) instance is supplied
(`DependencyInjection.cs:52-56`), binds [`IdempotencySettings`](#idempotencysettings) with
`ValidateDataAnnotations().ValidateOnStart()` when configuration is supplied
(`DependencyInjection.cs:58-64`), registers the two scoped action filters
[`IdempotencyFilter`](#idempotencyfilter) and
[`OwnerOrAdminFilter`](group-08-auth.md#owneroradminfilter) (`DependencyInjection.cs:67-68`, scoped
because they depend on scoped services), turns on feature management with
[`DisabledFeatureHandler`](#disabledfeaturehandler) (`DependencyInjection.cs:73-74`), and registers the
edge error-localization boundary (`AddErrorLocalization`, `DependencyInjection.cs:77` and `:88`, with
`AddErrorResources<TResource>` at `:103` for each module's own `.resx` set). Three sibling methods on
the same class complete the picture: `AddCommonExceptionHandlers` (`DependencyInjection.cs:116`)
registers the Problem Details service and the five exception handlers in most-specific-first order
(`:121-125`), `AddServerAuthSessionCookie` (`DependencyInjection.cs:141`) registers the Blazor Server
host's SSR cookie reader ([`CookieTokenReader`](group-08-auth.md#cookietokenreader)) plus the
singleton [`CookieSessionRefresher`](group-08-auth.md#cookiesessionrefresher), and
`AddModuleHealthChecks` (`DependencyInjection.cs:169`) turns
[`ModuleLoader`](group-14-module-system-composition.md#moduleloader) discovery results into
`module-{Name}` health checks, tagged `module` so `/health?tag=module` filters them (Healthy for
enabled modules at `:173-179`, Degraded for disabled ones at `:181-188`).
[`WebApplicationBuilderExtensions`](#webapplicationbuilderextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:23`)
carries the identical builder-side setup every service shares: header-based API versioning through the
`api-version` header (`AddCommonApiVersioning`, line 110, reader at line 117, v1.0 assumed when the
header is absent at lines 114-115,
[ADR-046](https://ivanball.github.io/docs/adr/046-http-api-versioning.html)), rate limiting
(`AddCommonRateLimiting`, line 155), Brotli and Gzip compression at `CompressionLevel.Fastest`
(`AddCommonResponseCompression`, line 200, both providers pinned to `Fastest` at lines 208-214 because
these are dynamic per-request payloads on fractional vCPUs), OpenAPI (line 225), CORS (line 359), and
the two JWT bearer registrations: in-process `AddCommonAuthentication` (line 316) for the Identity host
and `AddForwardedJwtBearer` (line 246) for extracted services that validate against a remote JWKS.
Only one DI ordering rule is load-bearing in the whole host, and it belongs to the CQRS pipeline group,
not here: `AddApplicationDecorators`
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:88`) must run last so Scrutor
can decorate handlers that are already registered. The API registrations themselves are
order-independent. This is the [Rubric §9, API & Contract Design] and [Rubric §10, Cross-Cutting]
story: versioning, compression, rate limiting, and CORS are configured once and inherited by every
service instead of copy-pasted per host.

**The request pipeline, in a fixed order.**
[`WebApplicationExtensions`](#webapplicationextensions)'s `UseCommonMiddlewarePipeline`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:45`) is the
single place the middleware order is decided, and the order is deliberate: exception handling (line
47), then [`CorrelationIdMiddleware`](#correlationidmiddleware) (48), request localization (53),
forwarded headers (79), conditional HTTPS redirect (87-89), response compression (91), routing (92),
CORS (93), authentication (96), the rate limiter (101),
[`SoftDeletedUserMiddleware`](#softdeletedusermiddleware) (102), authorization (103), output cache
(104), the JWKS and OIDC discovery endpoints (111-112), and finally `MapControllers` (114). Two of
those positions are worth internalizing. The rate limiter runs **after** authentication on purpose
([ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html), comment at
`WebApplicationExtensions.cs:97-100`): `GlobalRateLimitPartition`
(`WebApplicationBuilderExtensions.cs:54`) partitions by the authenticated principal and routes
anonymous traffic down a no-limiter branch (lines 61-64), so `HttpContext.User` must already be
populated or every request would look anonymous and the per-user cap (300 requests per minute by
default, `WebApplicationBuilderExtensions.cs:155`) would never engage; health, liveness,
`/.well-known/*`, and `application/grpc` traffic bypass the limiter outright (`IsRateLimitBypassed`,
lines 44-48). And the HTTPS redirect is skipped for any request whose content type starts with
`application/grpc` (`WebApplicationExtensions.cs:87-89`) because extracted gRPC services speak HTTP/2
cleartext (h2c) and a 307 redirect would break the call. Forwarded-headers handling clears the
known-proxy allowlists so cloud reverse proxies are trusted regardless of their internal IPs (lines
63-64) and stashes the pre-forward scheme and host in `HttpContext.Items` under `PreForwardedSchemeKey`
and `PreForwardedHostKey` (lines 24, 35, 72-77). `UseCommonRequestLocalization` (line 126) builds the
culture options from [`SupportedCultures`](#supportedcultures)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Globalization/SupportedCultures.cs:9`: `en-US` at line 12
plus `es` at line 18, with the `qps-Ploc` pseudo locale at line 28 added in Development only,
`WebApplicationExtensions.cs:133-136`) so edge error localization runs under the caller's culture, and
the companion `MapCultureEndpoint` (line 155) serves the `GET /culture/set` switch that Blazor UI hosts
map ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).

**One rate-limit policy is applied by default, and only one.** Because the global limiter deliberately
no-ops for anonymous callers and account lockout is per-email, a password spray (one password, many
email addresses) from a single source would otherwise be unthrottled. The framework closes that gap
with the named `auth-ip` policy (`RateLimitPolicyAuthIp`, `WebApplicationBuilderExtensions.cs:38`),
whose partition selector `AuthIpRateLimitPartition` (lines 90-103) is a per-client-IP fixed window
defaulting to 30 requests per minute (line 155) and fails **open** on an unattributable IP (lines
94-95) rather than collapsing every such request into one shared bucket, which would throttle the
in-process test server to a standstill. Unlike the other named limiters, this one is not left for each
app to attach: [`AuthControllerBase`](#authcontrollerbase) carries
`[EnableRateLimiting(WebApplicationBuilderExtensions.RateLimitPolicyAuthIp)]` on both `LoginAsync`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:55`) and
`RegisterAsync` (`AuthControllerBase.cs:76`), so every consumer inherits spray protection by
construction, while `RefreshAsync` (`AuthControllerBase.cs:95-99`) is deliberately left unthrottled
because refresh is periodic and automatic and Blazor Server circuits issue it server-side from one
shared host IP. A consumer that inherits the base without calling `AddCommonRateLimiting` fails at
startup on an unregistered policy, which is the loud failure rather than the silent one
([ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html) for the layering,
[ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) for the
brute-force half; note that ADR-019's text still says the named policies are opt-in only, which the
default on this base has since overtaken).

**Correlation and the soft-deleted-user gate.** [`CorrelationIdMiddleware`](#correlationidmiddleware)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/CorrelationIdMiddleware.cs:15`) reads the
`X-Correlation-ID` request header (the constant lives at `CorrelationIdMiddleware.cs:18`), falling back
to the current W3C trace id then ASP.NET's `TraceIdentifier` (lines 32-34), writes it onto the scoped
[`ICorrelationContext`](#icorrelationcontext)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICorrelationContext.cs:8`, implemented by
[`CorrelationContext`](#correlationcontext), which self-seeds a GUID when no middleware ever sets one,
`CorrelationContext.cs:12`), and echoes it back through `Response.OnStarting`
(`CorrelationIdMiddleware.cs:37-41`). That single id is what the CQRS logging decorators read
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/LoggingCommandDecorator.cs:23`)
and stamp onto every log scope
(`LoggingCommandDecorator.cs:67`), so one request is traceable end to end.
[`SoftDeletedUserMiddleware`](#softdeletedusermiddleware)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:15`) enforces
business rule BR-133: an authenticated caller whose account was soft-deleted is rejected with a bare
401 (lines 69 and 81), checked against a 30-second cache (line 17, written at line 77) to keep the
per-request lookup cheap
([ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html)). It
resolves [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator) lazily from
`RequestServices` (line 53) instead of as an `InvokeAsync` parameter, so a service that does not host
Identity passes the request through rather than 500-ing on every call: an explicit nod to the
[Rubric §7, Microservices Readiness] extraction path. Both middlewares are [Rubric §13, Observability
& Operability] (correlation) and [Rubric §11, Security] (deleted-account lockout) concerns handled once
at the edge instead of in every controller.

**Errors become Problem Details, through two channels and one table.** Failures reach the client two
ways. Thrown exceptions are caught by the handler chain registered in `AddCommonExceptionHandlers`
(`DependencyInjection.cs:116-128`), evaluated most-specific-first:
[`OperationCanceledExceptionHandler`](#operationcanceledexceptionhandler) (499 Client Closed Request,
`OperationCanceledExceptionHandler.cs:32`), [`DomainExceptionHandler`](#domainexceptionhandler) (400,
`DomainExceptionHandler.cs:32`), [`DbUpdateExceptionHandler`](#dbupdateexceptionhandler) (409 with a
deliberately generic detail so database schema names never leak, `DbUpdateExceptionHandler.cs:33-37`),
[`ValidationExceptionHandler`](#validationexceptionhandler) (400 with FluentValidation errors grouped
by property name, `ValidationExceptionHandler.cs:48-54`), and finally
[`GlobalExceptionHandler`](#globalexceptionhandler) as the 500 catch-all
(`GlobalExceptionHandler.cs:28`). Business failures that travel as `Result.Failure` rather than as
exceptions are mapped by [`ApiControllerBase`](#apicontrollerbase)'s `HandleFailure`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:25`), which derives
the status code from the **first** error in the list (line 38) and falls back to a 500 when the error
list is empty (lines 29-35), and the safety net
[`UnhandledResultFailureFilter`](#unhandledresultfailurefilter)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/UnhandledResultFailureFilter.cs:21`, an
`IAlwaysRunResultFilter`) catches any action that accidentally returned a failed `Result` as a 200
body, logs a warning, and rewrites it as the correct error (lines 27-49). All of those paths converge
on [`ErrorHttpMapping`](#errorhttpmapping)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:14`), whose
`FrozenDictionary<ErrorType, int>` (lines 20-30) is the single source of truth mapping each
[`ErrorType`](group-01-result-error-handling.md#errortype) (Validation and Invariant to 400, NotFound
to 404, Conflict to 409, Unauthorized to 401, Forbidden to 403, UnprocessableEntity to 422, Failure to
400) to a status code, with 400 as the fallback for anything unmapped (lines 36-37). Its
`BuildErrorsExtension` (line 47) localizes each [`Error`](group-01-result-error-handling.md#error)'s
human message at the edge through [`IErrorLocalizer`](#ierrorlocalizer), keyed by the stable `Code`,
leaving `Code`, `Type`, `Source`, and `Target` verbatim so clients can still branch on them, and
leaving the original English message untouched when no localizer is registered (line 51).
[`ErrorLocalizer`](#errorlocalizer)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Localization/ErrorLocalizer.cs:11`) walks the
registered [`ErrorResourceSource`](#errorresourcesource) list in registration order (lines 23-30: the
framework's own [`ErrorResources`](#errorresources) first, then each module's resources added through
`AddErrorResources`, `DependencyInjection.cs:103`) and falls back to the caller's message when no
source knows the code (line 32). This is [Rubric §9, API & Contract Design] (one consistent RFC 9457
shape) meeting the [Rubric §1, SOLID] discipline of never duplicating the mapping, and [Rubric §27,
Internationalization] at the one boundary where a machine-readable code becomes human prose.

**The controller hierarchy: generic CRUD earned by inheritance.** A module gets working endpoints by
subclassing one generic base and supplying its type parameters.
[`ApiControllerBase`](#apicontrollerbase) is the root: `[ApiController]`, `HandleFailure`, nothing
else. [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:28`) adds the
read surface (`GetAllAsync` at line 76, `paged` at line 116, `lookup` at line 157, `GetByIdAsync` at
line 189) over an
[`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
with field projection through a `fields` query parameter, `X-Pagination` header metadata (line 144),
and a page size clamped to `MaxPageSize` (resolved per request from
[`IApplicationSettings`](group-14-module-system-composition.md#iapplicationsettings), defaulting to
500, lines 50-57 and 127).
[`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AggregateRootEntityControllerBase.cs:27`)
extends it with an `[Idempotent]` POST create that returns 201 through
`CreatedAtRoute("Get{EntityName}ById", ...)` (lines 58-76) and a DELETE that dispatches
[`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
and returns 204 (lines 84-98). The interfaces
[`IEntityControllerBase<TEntityDTO, TIdentifierType>`](#ientitycontrollerbasetentitydto-tidentifiertype)
and
[`IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>`](#iaggregaterootentitycontrollerbasetentitydto-tidentifiertype-tcreaterequest)
describe those shapes for testing and documentation. The generic constraints tie the tower together:
`TEntity` derives from
[`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
for reads and from
[`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
for writes, `TEntityDTO` implements [`IBaseDTO<TIdentifierType>`](#ibasedtotidentifiertype), and
`TCreateRequest` implements [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest)
(`EntityControllerBase.cs:35-37`, `AggregateRootEntityControllerBase.cs:40-43`). Alongside the CRUD
tower sit three special-purpose bases: [`AuthControllerBase`](#authcontrollerbase)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:40`, anonymous
login, register, and refresh over
[`IAuthenticationService`](group-08-auth.md#iauthenticationservice), lines 53-108, plus an
`[Authorize]` revoke at lines 113-117),
[`OAuthControllerBase`](#oauthcontrollerbase)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:32`, the Google
and GitHub external-provider flow whose single-use exchange code, cached for two minutes at
`OAuthControllerBase.cs:42-43`, keeps tokens out of the redirect URL;
[ADR-036](https://ivanball.github.io/docs/adr/036-external-oauth-login.html) and
[ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)),
and [`ServiceInfoControllerBase`](#serviceinfocontrollerbase)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:30`), whose
dual-version `/ServiceInfo` returns [`ServiceInfoResponse`](#serviceinforesponse) for the deprecated
v1.0 and [`ServiceInfoV2Response`](#serviceinfov2response) for v2.0, proving the versioning machinery
works across versions (lines 39-48). All three carry the same note: class-level routing and versioning
attributes are not reliably inherited, so the per-service sealed subclass supplies them. This is the
clearest [Rubric §5, Vertical Slice] and [Rubric §16, Maintainability] payoff in the presentation
layer: a module writes a DTO, a mapper, and a short sealed subclass, and inherits a fully paged,
filterable, error-mapped REST resource.

**Idempotency for safe retries.** Write endpoints are made replay-safe by
[`IdempotentAttribute`](#idempotentattribute)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotentAttribute.cs:16`), a one-line
`ServiceFilterAttribute` that resolves the scoped [`IdempotencyFilter`](#idempotencyfilter)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:43`) from DI
([ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)). With no
`Idempotency-Key` header the action simply runs (lines 73-78). With one, the filter derives its cache
key from the caller's `user_id` claim (or `anon:` plus the remote IP), the HTTP method, the route
template, and the client-supplied key, SHA-256 hashed so the key length stays bounded (`BuildCacheKey`,
lines 165-179): scoping to the caller stops one user's cached response from being replayed to another,
and scoping to method plus route stops one key from colliding across endpoints that share a cache
instance. It then checks the cache on a lock-free fast path (line 84), serializes concurrent
duplicates behind a striped [`KeyedSemaphoreStripe`](group-08-auth.md#keyedsemaphorestripe) (field at
line 67, acquired at line 88) rather than a per-key semaphore table that would grow unbounded or race
on removal, double-checks the cache (line 91), executes the action, and stores the response as an
[`IdempotencyRecord`](#idempotencyrecord) (status code plus JSON body,
`IdempotencyRecord.cs:9`) through
[`ICacheService`](group-09-caching.md#icacheservice) for
[`IdempotencySettings`](#idempotencysettings)`.CacheExpirationHours` (default 24, constrained to the
range 1 to 168, `IdempotencySettings.cs:15-16`). Only successful `ObjectResult`s are stored (lines
136-141): replaying a transient 500 for a whole retention window would defeat the retry the header
exists to enable. Replays return the cached body with an `X-Idempotent-Replay: true` header (line
112). This is a [Rubric §7, Microservices Readiness] and [Rubric §29, Resilience & Business
Continuity] control: at-least-once retry from a gateway or a flaky client cannot create duplicate
resources.

**The contract surface: mapping, JSON, and query filters.** The framework maps between the wire and
the domain **by hand**, not through a runtime reflection mapper
([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)). Two interfaces in the
Application layer define the shape, both in
`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityDTOMapper.cs`:
[`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](#ientitydtomappertentity-tentitydto-tidentifiertype)
(line 14) turns an entity into its DTO and supplies a default interface implementation for the
collection overload (lines 27-32), and
[`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](#ientityrequestmappertentity-tcreaterequest-tidentifiertype)
(line 42) turns an incoming request into a domain entity through its factory, returning a
[`Result<T>`](group-01-result-error-handling.md#result) so mapping-time validation (a uniqueness check,
for example) is a first-class failure rather than an exception (line 54). Both are auto-registered by
module assembly scanning. Two edge helpers finish the contract surface:
[`CurrencyJsonConverter`](#currencyjsonconverter)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/JsonConverters/CurrencyJsonConverter.cs:12`)
serializes the [`Currency`](group-02-domain-building-blocks.md#currency) value object as its bare ISO
4217 code (line 30) and throws `JsonException` on a non-string token or an unknown code (lines 17-23),
which the framework surfaces as a 400; and [`QueryFilterModelBinder`](#queryfiltermodelbinder)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/ModelBinders/QueryFilterModelBinder.cs:24`) parses
the `filters[Prop].operator=` and `filters[Prop].value=` query-string convention into the
`(operator, value)` dictionary the paged read endpoint hands to the specification layer, capping one
request at `MaxFilters = 50` distinct properties (line 34) and silently discarding incomplete entries
(lines 74-80). The small shared DTO vocabulary those generics rely on lives in `MMCA.Common.Shared`:
[`IBaseDTO<TIdentifierType>`](#ibasedtotidentifiertype)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/IBaseDTO.cs:9`, an `Id` declared with an `init`
accessor at line 13), [`BaseLookup<TIdentifierType>`](#baselookuptidentifiertype)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/BaseLookup.cs:8`, id plus display name, for
dropdowns and autocomplete), and the optimistic-concurrency pair
[`IConcurrencyAware`](#iconcurrencyaware)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/IConcurrencyAware.cs:13`) and
[`ConcurrencyTokenRequest`](#concurrencytokenrequest)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/ConcurrencyTokenRequest.cs:12`), the reusable body
for lifecycle transitions that echoes back the `RowVersion` the client last saw so a transition decided
against a stale view surfaces as 409 instead of applying silently
([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)). Manual mapping keeps
the DTO contract explicit and reviewable: the [Rubric §9, API & Contract Design] and [Rubric §15, Best
Practices] position this codebase takes deliberately.

**Feature gating and per-module controller visibility.** Two mechanisms let an operator turn surface
area on and off without a code change. [`DisabledFeatureHandler`](#disabledfeaturehandler)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/FeatureManagement/DisabledFeatureHandler.cs:13`)
renders a consistent Problem Details 404 when a `FeatureGate`-protected action is reached while its
flag is off (lines 18-26), so a disabled feature looks like a nonexistent endpoint rather than an error
([ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html)). At a coarser grain,
[`ModuleControllerFeatureProvider`](#modulecontrollerfeatureprovider)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/ModuleControllerFeatureProvider.cs:28`) removes a
disabled module's controllers from MVC discovery entirely, matching a `.{ModuleName}.` token against
the controller's assembly name or namespace (lines 60-82, the dots on both sides preventing a
`Catalogue` false positive on `Catalog`), so a module switched off in configuration cannot have its
routes mapped (they would otherwise 500, since the module's DI services were never registered).
Together these are the feature-flag story extended to the HTTP edge and part of the
[Rubric §7, Microservices Readiness] "one codebase, many deployment shapes" design.

**Well-known endpoints and the extraction edge.** Several types here exist only so a module can be
lifted out of the monolith into its own service (ADRs
[004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html),
[007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html),
[008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).
[`JwksEndpointExtensions`](#jwksendpointextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/JwksEndpointExtensions.cs:15`) serves
`/.well-known/jwks.json` (path constant at line 20) from
[`IJwksProvider`](group-08-auth.md#ijwksprovider) so extracted services validate tokens against the
issuer's public keys instead of a shared secret, and
[`OidcDiscoveryEndpointExtensions`](#oidcdiscoveryendpointextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/OidcDiscoveryEndpointExtensions.cs:22`)
serves the minimal discovery document the JWT middleware fetches when `AddForwardedJwtBearer` sets an
authority: it returns 404 when `Jwt:Issuer` is not configured (lines 62-66), derives `jwks_uri` from
that configured issuer rather than from the inbound request (line 76) so issuer and JWKS URI stay
origin-aligned, and disables the camelCase naming policy (lines 43-46) because RFC 8414 field names are
snake_case and `jwksUri` would not be recognized. [`JwtForwardingDelegatingHandler`](#jwtforwardingdelegatinghandler)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Http/JwtForwardingDelegatingHandler.cs:17`) copies
the caller's inbound `Authorization` header onto outgoing HTTP calls, unless one was already set (lines
27-30) and no-oping when there is no ambient `HttpContext` (lines 32-36), so distributed authorization
flows through a service-to-service hop without any handler threading the token by hand: the HTTP twin
of [`JwtForwardingClientInterceptor`](group-13-grpc-contracts.md#jwtforwardingclientinterceptor).
[`PublicEndpointOutputCachePolicy`](#publicendpointoutputcachepolicy)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/PublicEndpointOutputCachePolicy.cs:35`),
registered by name through [`OutputCacheOptionsExtensions`](#outputcacheoptionsextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheOptionsExtensions.cs:6`), lets
user-independent GET endpoints stay cacheable even when the UI attaches a bearer token to every
request, varying by every query-string key (line 81), refusing to store responses that set cookies or
are not plain 200s (lines 100-104), and offering a `bypassRoles` escape hatch so a privileged caller
who receives an elevated payload always reads fresh (lines 71-75,
[ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)).
[`DatabaseInitializationExtensions`](#databaseinitializationextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:17`)
initializes every physical data source the host owns: `EnsureCreated` for the migration-less Cosmos and
SQLite engines (lines 54-64), then one of `Migrate`, `EnsureCreated`, or `None` per
`ApplicationSettings.DatabaseInitStrategy`, where `None` is the production guard that throws with a
per-source breakdown of pending migrations (lines 70-85 and 95-119;
[ADR-030](https://ivanball.github.io/docs/adr/030-startup-sole-migrator.html),
[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), finishing by running the
enabled modules' seeders (line 87). Four smaller startup helpers round out the host:
[`OpenApiEndpointExtensions`](#openapiendpointextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/OpenApiEndpointExtensions.cs:18`) maps
`/openapi/{documentName}.json` (line 28) and the optional Scalar reference UI (line 46) outside
Production only, [`SignalRExtensions`](#signalrextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/SignalRExtensions.cs:12`) maps
[`NotificationHub`](group-10-notifications.md#notificationhub) at its configured path when push
notifications are enabled (lines 24-28), [`MiniProfilerExtensions`](#miniprofilerextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/MiniProfilerExtensions.cs:9`) registers
MiniProfiler with Entity Framework profiling when `ApplicationSettings.UseMiniProfiler` is set (lines
18-25), and [`AppAssociationEndpointExtensions`](#appassociationendpointextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/AppAssociationEndpointExtensions.cs:15`) with
[`AppAssociationOptions`](#appassociationoptions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/AppAssociationOptions.cs:9`) serve the
Android Digital Asset Links and Apple App Site Association documents (paths at lines 18 and 24) that
let a mobile OS hand this host's https links to the installed native app
([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)).
[`ExternalAuthExtensions`](#externalauthextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authentication/ExternalAuthExtensions.cs:21`)
completes the OAuth half of authentication, staying entirely inert when no provider is configured
(lines 48-51), each provider gated on its `OAuth:{Provider}:ClientId` being present and throwing at
startup when the matching client secret is missing (lines 74-76 and 88-90). Taken together these are
the [Rubric §7, Microservices Readiness], [Rubric §11, Security], and [Rubric §12, Performance &
Scalability] concerns that let the same controller code run identically in a monolith and in a fleet of
extracted services behind a YARP gateway.

**Where this group sits.** Everything above is the outermost ring. It depends downward on the CQRS
pipeline and query services (Groups 03 and 05), the auth and caching infrastructure (Groups 08 and
09), the persistence factories (Group 07), and the module system that discovers controllers and drives
health checks (Group 14 via [`ModuleLoader`](group-14-module-system-composition.md#moduleloader)), and
it rests on the Result and domain primitives (Groups 01 and 02). Nothing inside the framework depends
on it: the app hosts and the gRPC transport group (Group 13) call into it.
[`AssemblyReference`](#assemblyreference) and [`ClassReference`](#classreference)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/AssemblyReference.cs:8` and `:20`) are the scanning
anchors that let those callers point at this assembly without naming an incidental type. Read the
group as the framework's HTTP grammar: the reusable edge every downstream service inherits so its own
code stays modules and domain logic, never plumbing.

### AssemblyReference
> MMCA.Common.API · `MMCA.Common.API` · `MMCA.Common/Source/Presentation/MMCA.Common.API/AssemblyReference.cs:8` · Level 0 · class (static)

- **What it is**: a tiny static class that exposes the `MMCA.Common.API` assembly handle and its simple name, so convention-based scanners have a stable, refactor-safe anchor into this layer.
- **Depends on**: `System.Reflection` (BCL) only.
- **Concept introduced (assembly-marker types for convention scanning).** Scrutor-based DI registration and the NetArchTest architecture rules both need a stable "anchor" type to say *scan the assembly that contains this*. Rather than reaching for `typeof(SomeIncidentalClass).Assembly`, a dedicated `AssemblyReference` makes the intent explicit and survives type moves. `[Rubric §2, Design Patterns]` assesses whether recurring structural problems are solved with named, reusable patterns; here the same two-type marker shape repeats in every layer and module assembly (Domain, Application, Infrastructure, API, and each conference/engagement/identity package), which is exactly this pattern applied uniformly. `[Rubric §33, Developer Experience]` assesses how easy the framework is to build on; centralizing one assembly handle per package means every scan call references one obvious token.
- **Walkthrough**: two `public static readonly` fields. `Assembly` (`AssemblyReference.cs:11`) is `typeof(AssemblyReference).Assembly`, resolved once at type initialization. `AssemblyName` (`AssemblyReference.cs:14`) is `Assembly.GetName().Name` with a `?? string.Empty` fallback for logging and diagnostics.
- **Why it's built this way**: a purpose-built anchor decouples scanning from any incidental type. The pattern is duplicated in every layer so each assembly is self-describing without a cross-layer reference back to a single "well-known" class.
- **Where it's used**: module handler/validator/mapper scanning (`ScanModuleApplicationServices<...>`, see [ModuleLoader](group-14-module-system-composition.md#moduleloader)) and the architecture tests' package-assembly pinning.

### ClassReference
> MMCA.Common.API · `MMCA.Common.API` · `MMCA.Common/Source/Presentation/MMCA.Common.API/AssemblyReference.cs:20` · Level 0 · class

- **What it is**: an empty, instantiable class in the `MMCA.Common.API` assembly, used where a generic constraint or a `typeof(...)` needs a concrete reference *type* from this layer rather than an `Assembly` instance.
- **Depends on**: nothing. See [AssemblyReference](#assemblyreference) for the full concept; `ClassReference` is its type-shaped sibling.
- **Concept**: covered under [AssemblyReference](#assemblyreference). Where `AssemblyReference.Assembly` answers "which assembly," `ClassReference` answers "give me a `class` token from that assembly" for APIs whose generic parameter is constrained to a reference type (`where T : class`).
- **Walkthrough**: the whole type is `public class ClassReference;` (`AssemblyReference.cs:20`), a body-less class declaration. It carries no members; its identity is the entire point.
- **Why it's built this way**: some registration and scanning helpers take a marker *type parameter* instead of an `Assembly`; a dedicated empty class keeps those call sites from accidentally binding to a real domain or controller type.
- **Where it's used**: generic registration helpers that need a per-assembly type anchor from the API layer.

### ExternalAuthExtensions
> MMCA.Common.API · `MMCA.Common.API.Authentication` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authentication/ExternalAuthExtensions.cs:23` · Level 0 · class (static)

- **What it is**: a static class that registers the external OAuth provider schemes (Google, GitHub) plus the short-lived cookie scheme that carries the external principal from the provider callback to the app's OAuth controller. It is the counterpart wiring that `AddCommonAuthentication` (JWT-only) deliberately leaves out.
- **Depends on**: `AspNet.Security.OAuth.GitHub`, `Microsoft.AspNetCore.Authentication.Google`, and the ASP.NET Core authentication/DI/configuration BCL surface. First-party, it partners with the app's OAuth controller subclassing [OAuthControllerBase](#oauthcontrollerbase), whose `ExtractClaims` consumes the schemes registered here.
- **Concept introduced (config-gated, additive auth registration).** The single `const string ExternalLoginScheme = "ExternalLogin"` (`ExternalAuthExtensions.cs:29`) is shared with the OAuth controller so the sign-in scheme name can never drift between the two halves of the flow. `[Rubric §11, Security]` assesses how authentication, secrets, and trust boundaries are handled; here each provider is gated on its `OAuth:<Provider>:ClientId` being present, and a missing client secret throws at startup (`ExternalAuthExtensions.cs:77` and `:91`) rather than silently half-configuring an auth scheme. `[Rubric §9, API & Contract Design]` is relevant because the extension is inert until configured: a host with no OAuth section keeps the JWT-only default untouched, the same opt-in posture as `AddPermissions` ([ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html)).
- **Walkthrough**: `AddExternalAuthProviders(IConfiguration configuration)` (`ExternalAuthExtensions.cs:39`) reads the `OAuth` section (`:41`), derives `googleEnabled`/`githubEnabled` from whether each `ClientId` is non-empty (`:45-46`), and returns immediately when neither is set (`:50-53`) so environments without OAuth secrets are left exactly as `AddCommonAuthentication` left them. When at least one provider is configured it calls `services.AddAuthentication()` with no argument (`:57`), which appends schemes without resetting the JWT default. It then adds the `ExternalLogin` cookie (`:61-69`): `HttpOnly`, `SameSite=Lax` (sufficient because the OAuth round trip returns as a top-level GET navigation, avoiding the `Secure`+cross-site cost of `SameSite=None`), and a 10-minute expiry. Google (`:71-83`) and GitHub (`:85-100`) each set `SignInScheme = ExternalLoginScheme`, a fixed `CallbackPath`, and `SaveTokens = true`; GitHub additionally requests the `user:email` scope (`:97`) because it does not return email on the default scope, and the controller's `ClaimTypes.Email` lookup would otherwise fail.
- **Why it's built this way**: the cookie is intentionally short-lived and single-purpose, it exists only to bridge the provider callback to the controller's `CompleteAsync`, which signs it out the moment the local JWT pair is minted. Splitting the OAuth scheme registration from `AddCommonAuthentication` keeps the JWT-only default (used by most tests and local dev) free of provider secrets.
- **Where it's used**: called from the host composition of a service that exposes social login; pairs with the app's `OAuthController` (subclass of [OAuthControllerBase](#oauthcontrollerbase)).

### PublicEndpointOutputCachePolicy
> MMCA.Common.API · `MMCA.Common.API.Caching` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/PublicEndpointOutputCachePolicy.cs:35` · Level 0 · class (sealed)

- **What it is**: a custom ASP.NET Core `IOutputCachePolicy` for public, user-independent GET/HEAD endpoints that must stay cacheable even when the request carries an `Authorization` header. It replaces the built-in default policy, which refuses to serve or store a cached response for any authenticated request.
- **Depends on**: `Microsoft.AspNetCore.OutputCaching` (`IOutputCachePolicy`, `OutputCacheContext`), `System.Security.Claims`, and `Microsoft.Extensions.Primitives` (`StringValues`). No first-party dependencies; it is registered by [OutputCacheOptionsExtensions](#outputcacheoptionsextensions).
- **Concept introduced (auth-header-tolerant output caching).** The framework UI attaches a Bearer token to *every* outgoing API request, including reads of `[AllowAnonymous]` endpoints whose payload is identical for every caller. Under the default policy those reads bypass the output cache for any signed-in user and land on the database each time. `[Rubric §12, Performance & Scalability]` assesses whether hot read paths avoid redundant work; this policy is a direct performance lever, it lets public reads share one cached entry across authenticated and anonymous callers. `[Rubric §11, Security]` assesses trust boundaries; the class docs (`PublicEndpointOutputCachePolicy.cs:24-33`) are explicit that a cached response is served verbatim to every subsequent caller, so it must be applied only to identity-independent payloads, and the `bypassRoles` mechanism exists precisely so a privileged role that receives an elevated payload (for example organizers seeing unpublished rows) is never served or stored from the shared cache.
- **Walkthrough**: three fields hold the config, `_expiration`, `_bypassRoles`, `_tags` (`PublicEndpointOutputCachePolicy.cs:37-39`). Two constructors: the `params string[] tags` overload (`:44`) delegates to the full one with an empty bypass-roles array, and the primary constructor (`:54`) guards its inputs (`ThrowIfLessThanOrEqual(expiration, TimeSpan.Zero)`, null checks on both arrays, `:56-58`). `CacheRequestAsync` (`:66`) computes `attemptOutputCaching` as "is a GET/HEAD request" AND "is not a bypassed caller" (`:71-72`), enables output caching, sets `AllowCacheLookup`/`AllowCacheStorage` to that flag, allows locking, sets the expiration, and (matching the built-in default) varies the cache key by every query-string parameter via `CacheVaryByRules.QueryKeys = "*"` (`:81`), then copies the eviction tags in (`:83-84`). `ServeFromCacheAsync` (`:90`) is a no-op. `ServeResponseAsync` (`:94`) refuses to store any response that set a cookie or returned a non-200 status (`:100-104`), the same guard the built-in default applies. Two private helpers close it out: `IsCacheableRequest` (`:109`, GET or HEAD) and `IsBypassedCaller` (`:112`, `Array.Exists(_bypassRoles, user.IsInRole)`).
- **Why it's built this way**: it mirrors the built-in default policy minus exactly one behavior, the authenticated-request bail-out, so its caching, query-key variance, and cookie/status guards stay identical to what developers already expect. Bypass roles get the default behavior back (no lookup, no storage), which keeps elevated payloads out of the shared cache without disabling caching for everyone. This is the mechanism behind the `bypassRoles` output-cache fix: a raw `IOutputCachePolicy` implementation inherits none of the default policy's behavior, so every guard is re-implemented here.
- **Where it's used**: registered as a named policy by [OutputCacheOptionsExtensions](#outputcacheoptionsextensions) and referenced from controller actions via `[OutputCache(PolicyName = ...)]`.
- **Caveats / not-in-source**: the exact endpoints and roles each downstream app applies this to are configured in those apps, not visible from this file.

### OutputCacheOptionsExtensions
> MMCA.Common.API · `MMCA.Common.API.Caching` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheOptionsExtensions.cs:6` · Level 1 · class (static)

- **What it is**: registration helpers that add named output-cache policies backed by [PublicEndpointOutputCachePolicy](#publicendpointoutputcachepolicy) onto ASP.NET Core's `OutputCacheOptions`.
- **Depends on**: `Microsoft.AspNetCore.OutputCaching` (`OutputCacheOptions`) and [PublicEndpointOutputCachePolicy](#publicendpointoutputcachepolicy).
- **Concept**: this is a thin fluent facade over `OutputCacheOptions.AddPolicy`, using a C# `extension(OutputCacheOptions options)` block (`OutputCacheOptionsExtensions.cs:8`) so the policy registration reads as a first-class option on the options object. See the [DI registration `extension(T)` convention](00-primer.md#2-architectural-styles-this-codebase-commits-to). `[Rubric §9, API & Contract Design]` is relevant, the helper gives callers a self-documenting, named entry point instead of hand-constructing the policy at each call site.
- **Walkthrough**: two overloads of `AddPublicEndpointPolicy`. The first (`OutputCacheOptionsExtensions.cs:20`) takes `name`, `expiration`, and `params string[] tags` and registers `new PublicEndpointOutputCachePolicy(expiration, tags)`. The second (`:34`) adds a `string[] bypassRoles` parameter before the `params string[] tags` and forwards to the three-argument policy constructor, for endpoints whose payload is identical for every caller except one privileged role. Both are expression-bodied and return `void`, mutating the options in place.
- **Why it's built this way**: keeping the policy construction behind a named helper means the "apply only to `[AllowAnonymous]`, identity-independent endpoints" guidance travels with the API surface (see the doc comments at `:10-16` and `:23-29`) instead of being re-derived at each registration.
- **Where it's used**: called during host composition where the app configures `AddOutputCache(...)`; the registered `name` is then referenced by `[OutputCache(PolicyName = ...)]` on controller actions.

### ModuleControllerFeatureProvider
> MMCA.Common.API · `MMCA.Common.API` · `MMCA.Common/Source/Presentation/MMCA.Common.API/ModuleControllerFeatureProvider.cs:28` · Level 2 · class (sealed)

- **What it is**: an `IApplicationFeatureProvider<ControllerFeature>` that removes controllers belonging to *disabled* modules from MVC's controller discovery, so a module turned off via configuration exposes no routes.
- **Depends on**: [ModulesSettings](group-14-module-system-composition.md#modulessettings) (the config-bound enabled/disabled map) and the MVC application-parts BCL (`IApplicationFeatureProvider<ControllerFeature>`, `ControllerFeature`).
- **Concept introduced (module-aware controller discovery).** MVC discovers controllers by scanning referenced assemblies. When a host references a module's `API` assembly transitively but an operator has disabled that module (`Modules:{Name}:Enabled=false`), MVC would still map its controllers, and every request to them would 500 because the module's DI services were never registered (`ModuleControllerFeatureProvider.cs:19-25`). `[Rubric §7, Microservices Readiness]` assesses whether modules can be composed and decomposed cleanly; this provider is one boundary that lets a module be switched off without deleting code or breaking the host, complementing the disabled-module stub registrations in the module system. `[Rubric §10, Cross-Cutting]` is relevant, the enable/disable decision is enforced once at the edge rather than checked inside each controller.
- **Walkthrough**: the primary-constructor parameter is `ModulesSettings modulesSettings` (`ModuleControllerFeatureProvider.cs:28-29`). `PopulateFeature` (`:33`) first snapshots the disabled module names once (`:36-39`) so it does not re-scan the settings dictionary per controller, returns early if none are disabled (`:41-44`), then removes every controller matched by `IsDisabledModuleController` (`:46-53`). The private matcher (`:60`) reads the controller's assembly simple name and namespace (`:64-65`) and, for each disabled module, tests whether either contains the token `.{ModuleName}.` (`:72`). Wrapping the module name in dots is deliberate: it matches `.Catalog.` inside `MMCA.Store.Catalog.API` or its `.Controllers` namespace while avoiding false positives from substrings like `Catalogue` (`:69-72`). The comparison is `OrdinalIgnoreCase` (`:74-75`).
- **Why it's built this way**: matching on the dotted token handles both the `MMCA.{Repo}.{Module}.API` convention and the legacy `{Prefix}.Modules.{Module}.*` convention without maintaining a registry of controller types. Removing controllers at feature-provider time is earlier than routing, so a disabled module is invisible rather than returning a runtime error.
- **Where it's used**: registered by [DependencyInjection](#dependencyinjection)'s `AddAPI(modulesSettings)` via `ConfigureApplicationPartManager` (`DependencyInjection.cs:54-55`), but only when a non-null `ModulesSettings` is supplied; pairs with the module system's disabled-stub registrations so cross-module interfaces stay resolvable.

### DependencyInjection
> MMCA.Common.API · `MMCA.Common.API` · `MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:24` · Level 5 · class (static)

- **What it is**: the primary DI entry point for the `MMCA.Common.API` layer. Using a C# `extension(IServiceCollection services)` block it adds six methods to `IServiceCollection`: `AddAPI`, `AddErrorLocalization`, `AddErrorResources<TResource>`, `AddCommonExceptionHandlers`, `AddServerAuthSessionCookie`, and `AddModuleHealthChecks`.
- **Depends on**: a broad slice of the API layer plus feature management and localization. Notable first-party types wired here: [CurrencyJsonConverter](#currencyjsonconverter), [UnhandledResultFailureFilter](#unhandledresultfailurefilter), [IdempotencyFilter](#idempotencyfilter), [OwnerOrAdminFilter](group-08-auth.md#owneroradminfilter), [ModuleControllerFeatureProvider](#modulecontrollerfeatureprovider), [DisabledFeatureHandler](#disabledfeaturehandler), [IErrorLocalizer](#ierrorlocalizer)/[ErrorLocalizer](#errorlocalizer), [ErrorResources](#errorresources)/[ErrorResourceSource](#errorresourcesource), the exception handlers ([GlobalExceptionHandler](#globalexceptionhandler) plus the domain/db/validation/cancel handlers), [CookieTokenReader](group-08-auth.md#cookietokenreader) and [ICookieSessionRefresher](group-08-auth.md#icookiesessionrefresher)/[CookieSessionRefresher](group-08-auth.md#cookiesessionrefresher), and [ModuleLoader](group-14-module-system-composition.md#moduleloader)/[ModulesSettings](group-14-module-system-composition.md#modulessettings). Externals: `Microsoft.FeatureManagement`, `Microsoft.Extensions.Localization`, ASP.NET Core MVC/ProblemDetails/HealthChecks.
- **Concept introduced (layered DI wiring at the API edge).** `[Rubric §3, Clean Architecture]` assesses whether each layer registers only its own concerns; this class wires controllers, JSON/XML formatters, filters, feature management, exception handlers, and health checks, all API-layer edges, and reaches down to Application only for `ModulesSettings`/`ModuleLoader`. `[Rubric §13, Observability & Operability]` and `[Rubric §17, DevOps]` both apply through `AddModuleHealthChecks` (`DependencyInjection.cs:169`), which projects module state into `/health` checks tagged `module` so `/health?tag=module` reports each module's status. `[Rubric §9, API & Contract Design]` is relevant, every method is opt-in and defaulted so a host wires only what it needs.
- **Walkthrough**:
  - `AddAPI(ModulesSettings? modulesSettings = null, IConfiguration? configuration = null)` (`DependencyInjection.cs:42`) registers controllers with `ReturnHttpNotAcceptable = false` and the [UnhandledResultFailureFilter](#unhandledresultfailurefilter) global filter (`:44-48`), adds the [CurrencyJsonConverter](#currencyjsonconverter) to JSON options and XML DataContract formatters (`:49-50`), conditionally registers [ModuleControllerFeatureProvider](#modulecontrollerfeatureprovider) when `modulesSettings` is non-null (`:52-56`), conditionally binds `IdempotencySettings` from config with data-annotation validation on start (`:58-64`), registers the scoped [IdempotencyFilter](#idempotencyfilter) and [OwnerOrAdminFilter](group-08-auth.md#owneroradminfilter) (scoped because they depend on scoped services, `:66-68`), turns on feature management with `AddFeatureManagement()` plus the singleton [DisabledFeatureHandler](#disabledfeaturehandler) (`:73-74`), and finally calls `AddErrorLocalization()` (`:77`).
  - `AddErrorLocalization()` (`:88`) registers ASP.NET localization, the singleton [IErrorLocalizer](#ierrorlocalizer) via `TryAddSingleton` (`:91`), and the framework's own [ErrorResources](#errorresources) source; `AddErrorResources<TResource>()` (`:103`) adds a module's resource anchor as another [ErrorResourceSource](#errorresourcesource) built from an `IStringLocalizerFactory` (`:105-106`). This is the [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) edge error-localization boundary, keyed by `Error.Code`.
  - `AddCommonExceptionHandlers()` (`:116`) registers ProblemDetails (adding a `requestId` from `TraceIdentifier`, `:118-120`) then five `IExceptionHandler`s in specificity order (`:121-125`): `OperationCanceled`, `DomainException`, `DbUpdate`, `Validation`, and [GlobalExceptionHandler](#globalexceptionhandler) as the catch-all. ASP.NET Core invokes them in registration order and stops at the first that handles the exception, hence most-specific first and the 500 fallback last.
  - `AddServerAuthSessionCookie(string apiBaseAddress)` (`:141`) wires the SSR-prerender auth path: `HttpContextAccessor`, memory cache, the scoped [CookieTokenReader](group-08-auth.md#cookietokenreader), a named `HttpClient` pointed at the internal API base address (`:149-150`), and the [CookieSessionRefresher](group-08-auth.md#cookiesessionrefresher) as a **singleton** (`:153`). The singleton is load-bearing: its in-flight map must be shared across requests for single-flight refresh to work.
  - `AddModuleHealthChecks(ModuleLoader moduleLoader)` (`:169`) adds one health check per module, `Healthy` for each enabled module and `Degraded` for each disabled one (`:173-188`), named `module-{Name}` and tagged `module`. It must run after [ModuleLoader](group-14-module-system-composition.md#moduleloader)'s `DiscoverAndRegister`.
- **Why it's built this way**: bundling the API-edge concerns behind small, defaulted extension methods lets each host opt into exactly the surface it needs (a JWT-only test host skips `AddServerAuthSessionCookie`; a monolith with no disabled modules passes a null `modulesSettings`). The exception-handler ordering and the refresher's singleton lifetime are the two non-obvious, correctness-critical choices, both documented inline. Error localization is registered automatically by `AddAPI` so modules only add their own resources additively ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Where it's used**: called from every service host's composition (`Program.cs` of the ADC/Store/Helpdesk API hosts and the integration-test hosts) to wire the shared API layer; `AddApplicationDecorators()` still runs last in the overall sequence (see `MMCA.Common/CLAUDE.md` DI ordering note).
- **Caveats / not-in-source**: the relative ordering of `AddAPI` against `AddInfrastructure`/`AddApplication` in a given host is not fixed by this file; only `AddApplicationDecorators()` last is load-bearing.

### DisabledFeatureHandler

> MMCA.Common.API · `MMCA.Common.API.FeatureManagement` · `MMCA.Common/Source/Presentation/MMCA.Common.API/FeatureManagement/DisabledFeatureHandler.cs:13` · Level 0 · class (sealed)

- **What it is**: the one-method handler that decides what a `[FeatureGate]`-protected controller action returns when its feature flag is off. Instead of ASP.NET Core's default (a bare 404 with no body), it emits an RFC 9457 Problem Details payload so a disabled feature reads the same as any other framework error.
- **Depends on**: `IDisabledFeaturesHandler` and `FeatureGateAttribute` from `Microsoft.FeatureManagement.Mvc` (NuGet); `ProblemDetails`, `ObjectResult`, and `StatusCodes` from ASP.NET Core. No first-party dependencies.
- **Concept introduced: feature gating at the HTTP edge.** `[Rubric §9, API & Contract Design]` assesses whether every response, success or refusal, follows one uniform contract; this handler makes the disabled-feature path match the [`ApiControllerBase`](#apicontrollerbase)`.HandleFailure` shape rather than leaking a framework default. `[Rubric §10, Cross-Cutting]` covers concerns applied uniformly across endpoints, and feature flags are exactly that. Note the split: this class gates *controller actions* decorated with `[FeatureGate]`, while [`FeatureGateCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult) gates *CQRS handlers* one layer deeper. The two surfaces cover the two entry points into a gated capability, which is precisely the dual-surface enforcement [ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html) records.
- **Walkthrough**: `HandleDisabledFeatures(features, context)` (`DisabledFeatureHandler.cs:16`) sets `context.Result` to an `ObjectResult` wrapping a `ProblemDetails` with `Status = 404` and a fixed title/detail ("Feature not available", `DisabledFeatureHandler.cs:18-23`), and also sets the outer `StatusCode = 404` (`DisabledFeatureHandler.cs:25`) so the response code and the body agree. It returns `Task.CompletedTask` (`DisabledFeatureHandler.cs:28`): the work is synchronous, there is nothing to await.
- **Why it's built this way**: the payload deliberately does not name the disabled feature. An anonymous caller learns only that the endpoint is unavailable, not which flag is off, so the flag set is not enumerable from outside. The `features` parameter is available but unused for that reason.
- **Where it's used**: registered as the app's `IDisabledFeaturesHandler` singleton inside `AddAPI` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:74`, immediately after `services.AddFeatureManagement()` on `DependencyInjection.cs:73`); invoked by `Microsoft.FeatureManagement.Mvc` whenever a `[FeatureGate]` action is hit with its flag disabled.

### IdempotencyRecord

> MMCA.Common.API · `MMCA.Common.API.Idempotency` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyRecord.cs:9` · Level 0 · record (sealed)

- **What it is**: the cached snapshot of an idempotent action's response, the HTTP status code plus the JSON-serialized body. It is what [`IdempotencyFilter`](#idempotencyfilter) writes on the first successful request and replays for every duplicate.
- **Depends on**: nothing beyond the BCL; a two-parameter positional `record`.
- **Concept**: introduced fully by [`IdempotencyFilter`](#idempotencyfilter); this is the value it persists. `[Rubric §9, API & Contract Design]`: only the status and body are captured, not headers, which is why the replay path re-adds `X-Idempotent-Replay` itself (`IdempotencyFilter.cs:112`) and why a replayed 201 does not carry the original `Location` header (a trade-off [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html) records explicitly).
- **Walkthrough**: `IdempotencyRecord(int StatusCode, string ResponseBody)` (`IdempotencyRecord.cs:9`). `StatusCode` is the original response's code (defaulting to 200 when an `ObjectResult` carries none, `IdempotencyFilter.cs:139`), `ResponseBody` is `objectResult.Value` serialized with `JsonSerializerOptions.Web` (`IdempotencyFilter.cs:146`).
- **Why it's built this way**: keeping the record to two primitives makes it provider-agnostic, so the same artifact round-trips through the in-memory cache or Redis with no serializer coupling.
- **Where it's used**: stored and read by [`IdempotencyFilter`](#idempotencyfilter) through [`ICacheService`](group-09-caching.md#icacheservice) (`IdempotencyFilter.cs:108` and `IdempotencyFilter.cs:155`).

### IdempotencySettings

> MMCA.Common.API · `MMCA.Common.API.Idempotency` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencySettings.cs:9` · Level 0 · class (sealed)

- **What it is**: the options object bound from the `Idempotency` configuration section, controlling how long a cached idempotent response is retained.
- **Depends on**: `System.ComponentModel.DataAnnotations` for the `[Range]` validation attribute.
- **Concept**: the standard options pattern (see [primer](00-primer.md)). `[Rubric §10, Cross-Cutting]`: the whole section is optional because the one property has a default, so a host that never configures idempotency still behaves correctly.
- **Walkthrough**: `SectionName` is a `public static readonly string` equal to `"Idempotency"` (`IdempotencySettings.cs:12`), used as the binding key rather than a magic string at the call site. `CacheExpirationHours` (`IdempotencySettings.cs:16`) defaults to 24 and is constrained by `[Range(1, 168)]` (`IdempotencySettings.cs:15`), one hour to one week. The property is `init`-only, so the value is fixed once bound.
- **Why it's built this way**: `AddAPI` binds the section only when a caller passes an `IConfiguration` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:58-64`), and it does so with `.ValidateDataAnnotations().ValidateOnStart()`, so an out-of-range `CacheExpirationHours` fails the host at startup rather than at the first idempotent POST. `[Rubric §15, Best Practices]`: fail fast, loudly, at composition time.
- **Where it's used**: resolved as `IOptions<IdempotencySettings>` inside [`IdempotencyFilter`](#idempotencyfilter) (`IdempotencyFilter.cs:149-153`); when the options are not registered (the `AddAPI` overload called with no configuration) the filter falls back to its hard-coded 24-hour `DefaultExpiration` (`IdempotencyFilter.cs:58`).

### ServiceInfoResponse

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:51` · Level 0 · record (sealed, nested)

- **What it is**: the v1.0 (minimal) payload returned by the service-info discovery endpoint: just the service name and the API version.
- **Depends on**: nothing beyond the BCL; a nested positional `record` inside [`ServiceInfoControllerBase`](#serviceinfocontrollerbase).
- **Concept**: the deprecated shape in a versioned-contract pair. `[Rubric §9, API & Contract Design]` assesses whether an API can evolve without breaking callers; this record is the "before" shape that v1.0 clients keep receiving unchanged while v2.0 clients get the superset ([ADR-046](https://ivanball.github.io/docs/adr/046-http-api-versioning.html)).
- **Walkthrough**: `ServiceInfoResponse(string Service, string ApiVersion)` (`ServiceInfoControllerBase.cs:51`), returned by `GetV1()` populated with the concrete service name and the literal `"1.0"` (`ServiceInfoControllerBase.cs:42`).
- **Where it's used**: produced by [`ServiceInfoControllerBase`](#serviceinfocontrollerbase)`.GetV1()`; superseded by [`ServiceInfoV2Response`](#serviceinfov2response).

### ServiceInfoV2Response

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:54` · Level 0 · record (sealed, nested)

- **What it is**: the v2.0 (evolved) service-info payload, a strict superset of [`ServiceInfoResponse`](#serviceinforesponse) that additionally advertises the supported and deprecated version lists.
- **Depends on**: nothing beyond the BCL; a nested positional `record` inside [`ServiceInfoControllerBase`](#serviceinfocontrollerbase).
- **Concept**: the additive-evolution half of the versioned pair. `[Rubric §9, API & Contract Design]`: adding fields (not renaming or removing them) is the backward-compatible way to grow a contract, so a v1.0 caller who never sees the new fields is unaffected.
- **Walkthrough**: `ServiceInfoV2Response(string Service, string ApiVersion, IReadOnlyList<string> SupportedVersions, IReadOnlyList<string> DeprecatedVersions)` (`ServiceInfoControllerBase.cs:54-58`). The two extra members surface the `Supported`/`Deprecated` arrays the controller holds (`ServiceInfoControllerBase.cs:32-33`), so the body itself documents the version landscape, the same facts the `api-supported-versions` / `api-deprecated-versions` headers carry.
- **Where it's used**: produced by [`ServiceInfoControllerBase`](#serviceinfocontrollerbase)`.GetV2()` (`ServiceInfoControllerBase.cs:47-48`).

### ServiceInfoControllerBase

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:30` · Level 1 · class (abstract)

- **What it is**: an anonymous, read-only discovery controller that proves the API-versioning machinery works across more than one version. The same `/ServiceInfo` route is served by v1.0 (deprecated) and v2.0, selected via the `api-version` header.
- **Depends on**: `Asp.Versioning` (`MapToApiVersion`) and ASP.NET Core MVC (`ControllerBase`); returns [`ServiceInfoResponse`](#serviceinforesponse) and [`ServiceInfoV2Response`](#serviceinfov2response), both nested in this file.
- **Concept introduced: header-based API versioning as a first-class contract.** `[Rubric §9, API & Contract Design]` assesses whether an API can carry multiple versions concurrently and signal deprecation; this controller demonstrates the whole loop: two versions on one route, one marked deprecated, and `ReportApiVersions = true` (set in `AddCommonApiVersioning` on [`WebApplicationBuilderExtensions`](#webapplicationbuilderextensions)) so responses carry `api-supported-versions` / `api-deprecated-versions` headers. [ADR-046](https://ivanball.github.io/docs/adr/046-http-api-versioning.html) makes the point that a versioning claim which only ever ships `v1.0` is untestable; this endpoint is what makes it testable.
- **Walkthrough**
  - `Supported = ["1.0", "2.0"]` and `Deprecated = ["1.0"]` (`ServiceInfoControllerBase.cs:32-33`) are the static version lists the v2 payload echoes.
  - `ServiceName` (`ServiceInfoControllerBase.cs:36`) is an abstract property the sealed per-service subclass supplies, because class-level routing/versioning attributes are not reliably inherited (remarks, `ServiceInfoControllerBase.cs:15-29`): the subclass carries `[ApiController]`, `[Route("[controller]")]`, `[AllowAnonymous]`, and the two `[ApiVersion]` attributes.
  - `GetV1()` (`ServiceInfoControllerBase.cs:41`) is `[HttpGet]` + `[MapToApiVersion("1.0")]` (`ServiceInfoControllerBase.cs:39-40`) and returns the minimal [`ServiceInfoResponse`](#serviceinforesponse).
  - `GetV2()` (`ServiceInfoControllerBase.cs:47`) is `[MapToApiVersion("2.0")]` (`ServiceInfoControllerBase.cs:46`) and returns the superset [`ServiceInfoV2Response`](#serviceinfov2response) with the supported/deprecated lists.
- **Why it's built this way**: the type is abstract with an abstract `ServiceName` so each extracted service reuses the identical versioning surface while stamping its own identity, keeping the "build the monolith now, extract a service later" path uniform (`[Rubric §7, Microservices Readiness]`). The endpoint is anonymous and reached on the service host directly; gateways do not route it (class remark, `ServiceInfoControllerBase.cs:13`).
- **Where it's used**: subclassed by each service's sealed `ServiceInfoController`, for example ADC's Conference service (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ServiceInfoController.cs:20`, with `ServiceName => "Conference"` at `ServiceInfoController.cs:23`) and Store's Catalog service (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/Controllers/ServiceInfoController.cs:20`). Because the controller ships in the framework, the fitness contract that exercises it is shared too: `ServiceInfoVersioningContractTestsBase<TFixture>` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/ServiceInfoVersioningContractTestsBase.cs:19`) asserts the v1 minimal shape plus the `api-deprecated-versions` header (`ServiceInfoVersioningContractTestsBase.cs:28-41`) and the v2 evolved shape plus `api-supported-versions` (`ServiceInfoVersioningContractTestsBase.cs:44-57`), and a repo subclasses it supplying only its fixture.

### IdempotencyFilter

> MMCA.Common.API · `MMCA.Common.API.Idempotency` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:43` · Level 2 · class (sealed)

- **What it is**: the ASP.NET Core `IAsyncActionFilter` that gives write operations client-driven idempotency. A client attaches an `Idempotency-Key` header; the first successful response for that key is cached and every subsequent request carrying the same key gets the stored response back verbatim, without re-running the action.
- **Depends on**: [`ICacheService`](group-09-caching.md#icacheservice) (resolved per-request from `RequestServices`, `IdempotencyFilter.cs:81`), [`IdempotencyRecord`](#idempotencyrecord), [`IdempotencySettings`](#idempotencysettings) via `IOptions<>`, and [`KeyedSemaphoreStripe`](group-08-auth.md#keyedsemaphorestripe) from `MMCA.Common.Shared.Concurrency`; `SHA256`, `Encoding`, and `System.Text.Json` from the BCL.
- **Concept introduced: idempotent mutation with double-check locking over a caller-scoped key.** `[Rubric §9, API & Contract Design]` covers safe retry semantics on non-safe verbs, `[Rubric §29, Resilience & Business Continuity]` covers surviving client retries without duplicating side effects, and `[Rubric §11, Security]` applies because the *key derivation* is a security boundary, not just a cache detail. The flow (doc comment, `IdempotencyFilter.cs:19-41`) is a classic double-check: (1) read the cache with no lock, the common fast path; (2) on a miss, take the stripe guarding this key; (3) re-read the cache, because a concurrent request may have finished and cached while this one waited; (4) only then run the action and cache the result. Without the lock, two near-simultaneous retries of a slow create could both miss the cache and both execute.
- **Walkthrough**
  - `IdempotencyKeyHeader => "Idempotency-Key"` (`IdempotencyFilter.cs:48`) and `CacheKeyPrefix => "idempotency:"` (`IdempotencyFilter.cs:50`) define the wire and cache namespacing; `UserIdClaimType = "user_id"` (`IdempotencyFilter.cs:53`) is the claim the key is scoped to, matching what `TokenService` emits; `DefaultExpiration` is 24 hours (`IdempotencyFilter.cs:58`), used only when [`IdempotencySettings`](#idempotencysettings) is not registered.
  - `KeyLocks` (`IdempotencyFilter.cs:67`) is a static [`KeyedSemaphoreStripe`](group-08-auth.md#keyedsemaphorestripe): a fixed set of 256 semaphores (`MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:25`) that a key hashes onto. The comment above it (`IdempotencyFilter.cs:60-66`) is the reason: a `ConcurrentDictionary` of one semaphore per key forces a choice between a removal race and unbounded growth from a caller-supplied key, and striping has neither problem.
  - `OnActionExecutionAsync` (`IdempotencyFilter.cs:70`): if the header is missing or blank it just calls `next()` and returns (`IdempotencyFilter.cs:73-78`), so idempotency is strictly opt-in per request and a non-idempotent call never even resolves the cache service.
  - Fast path (`IdempotencyFilter.cs:80-85`): builds the derived cache key, resolves [`ICacheService`](group-09-caching.md#icacheservice), and calls `TryReplayAsync` with no lock held.
  - Slow path (`IdempotencyFilter.cs:88-96`): acquires the stripe honoring `RequestAborted` inside a `using` (so the release survives a throw), re-checks via `TryReplayAsync` (`IdempotencyFilter.cs:91`), then runs `next()` and hands the executed context to `TryStoreAsync`.
  - `TryReplayAsync` (`IdempotencyFilter.cs:103-121`): on a cache hit it appends `X-Idempotent-Replay: true` (`IdempotencyFilter.cs:112`) and short-circuits with a `ContentResult` carrying the stored status, body, and `application/json` (`IdempotencyFilter.cs:113-118`), so the action never runs. It returns whether it short-circuited, which is what makes the same method serve both the fast path and the double-check.
  - `TryStoreAsync` (`IdempotencyFilter.cs:130-156`): stores only an `ObjectResult` (`IdempotencyFilter.cs:136`) whose status is 2xx (`IdempotencyFilter.cs:139-141`), serializes the value synchronously with `JsonSerializerOptions.Web` (the `VSTHRD103` suppression on `IdempotencyFilter.cs:143` documents that string serialization is correctly synchronous), then takes the expiration from [`IdempotencySettings`](#idempotencysettings) when registered and `DefaultExpiration` otherwise (`IdempotencyFilter.cs:149-153`).
  - `BuildCacheKey` (`IdempotencyFilter.cs:165-179`) is the load-bearing part: the subject is the caller's `user_id` claim or, unauthenticated, `anon:{remote address}` (`IdempotencyFilter.cs:167-168`); the route is the attribute route template falling back to the request path (`IdempotencyFilter.cs:170-172`); those plus the HTTP method and the client key are joined with `\n` (`IdempotencyFilter.cs:175`, a character valid in none of the components, so the tuple cannot be forged), SHA-256 hashed (`IdempotencyFilter.cs:176`), and emitted as `idempotency:{lowercase hex}` (`IdempotencyFilter.cs:178`).
- **Why it's built this way**: keying on the bare client value made the key space global, so two callers who happened to pick the same value shared an entry and one user's serialized body was replayed to another, and because services can share one cache instance the collision reached across endpoints and services ([ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)). Hashing also bounds the stored key length regardless of what the client sends. Non-2xx results are deliberately not stored (`IdempotencyFilter.cs:123-129`): replaying a failure for the whole retention window would mean a client retrying the same key after a transient 500 keeps receiving that 500 for 24 hours instead of the retry actually executing.
- **Where it's used**: wired onto actions through [`IdempotentAttribute`](#idempotentattribute), most visibly on the create endpoint of [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest) (`AggregateRootEntityControllerBase.cs:59`). Registered scoped in `AddAPI` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:67`) because it depends on scoped services.
- **Caveats / not-in-source**: the stripe only serializes duplicates that land on the same instance. Two simultaneous identical requests routed to different instances can both miss the cache and execute; a configured distributed cache makes the later *replay* consistent but provides no cross-instance mutual exclusion ([ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html), Trade-offs).

### IEntityControllerBase<TEntityDTO, TIdentifierType>

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/IEntityControllerBase.cs:14` · Level 2 · interface

- **What it is**: the contract every read-only entity controller implements, four GET-shaped methods for all-entities, paged, lookup, and by-id retrieval.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](#ibasedtotidentifiertype) (constraint), [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), [`BaseLookup<TIdentifierType>`](#baselookuptidentifiertype), and [`QueryFilterModelBinder`](#queryfiltermodelbinder) for the filter parameter.
- **Concept introduced: the generic entity-controller contract.** `[Rubric §9, API & Contract Design]` assesses uniform endpoint conventions across every entity, and this interface is the guarantee that all read controllers expose the same four GET shapes. `[Rubric §1, SOLID]`: it is deliberately the read-only slice, kept separate from the create/delete slice ([`IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>`](#iaggregaterootentitycontrollerbasetentitydto-tidentifiertype-tcreaterequest)) so a child-collection controller can implement reads without inheriting mutation endpoints (Interface Segregation).
- **Walkthrough**: the type constrains `TEntityDTO : IBaseDTO<TIdentifierType>` and `TIdentifierType : notnull` (`IEntityControllerBase.cs:17-18`). The members:
  - `GetAllAsync` unpaged (`IEntityControllerBase.cs:26`), with `fields` projection (`[FromQuery]`) and the two eager-load flags.
  - the paged `GetAllAsync` overload (`IEntityControllerBase.cs:43`), adding `sortColumn`/`sortDirection`, `[Range(1, int.MaxValue)]`-guarded `pageNumber`/`pageSize` (`IEntityControllerBase.cs:49-50`), and a `Dictionary<string, (string Operator, string Value)>` of filters bound by [`QueryFilterModelBinder`](#queryfiltermodelbinder) (`IEntityControllerBase.cs:51`).
  - `GetAllForLookupAsync` for id/label dropdown data (`IEntityControllerBase.cs:58`).
  - `GetByIdAsync` (`IEntityControllerBase.cs:69`), whose `includeFKs` defaults to `true` for the single-entity case (`IEntityControllerBase.cs:71`) while the collection endpoints default it to `false`.
- **Why it's built this way**: expressing the surface as an interface lets architecture tests and OpenAPI tooling reason about the contract independently of the concrete generic base, and lets the two-level controller hierarchy layer capabilities without collapsing reads and writes into one type.
- **Where it's used**: implemented by [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype) and extended by [`IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>`](#iaggregaterootentitycontrollerbasetentitydto-tidentifiertype-tcreaterequest).

### ApiControllerBase

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:16` · Level 3 · class (abstract)

- **What it is**: the base class every API controller inherits. It carries the `[ApiController]` behavior and one shared method, `HandleFailure`, that turns domain errors into RFC 9457 Problem Details responses.
- **Depends on**: [`Error`](group-01-result-error-handling.md#error), [`ErrorType`](group-01-result-error-handling.md#errortype), [`ErrorHttpMapping`](#errorhttpmapping), and [`IErrorLocalizer`](#ierrorlocalizer) (resolved optionally from `RequestServices`).
- **Concept introduced: centralized error-to-HTTP mapping.** `[Rubric §9, API & Contract Design]` assesses whether every endpoint fails the same way; `[Rubric §3, Clean Architecture]` covers keeping the HTTP-translation concern in the presentation layer rather than the domain. This is the boundary where a [`Result`](group-01-result-error-handling.md#result) failure from the Application/Domain layers becomes an HTTP status: the domain never knows about status codes, this base owns that mapping. The `[ApiController]` attribute (`ApiControllerBase.cs:15`) enables automatic model-state validation, binding-source inference, and `ProblemDetails` serialization.
- **Walkthrough**: `HandleFailure(IEnumerable<Error> errors)` (`ApiControllerBase.cs:25`) is `protected virtual`:
  - Null/empty guard (`ApiControllerBase.cs:27-35`): with no errors it returns a 500 "Unknown error", treating an empty failure as a programming mistake rather than a domain outcome.
  - First-error-drives-status (`ApiControllerBase.cs:38`): `ErrorHttpMapping.GetStatusCode(errorList[0].Type)` picks the status from the first error's [`ErrorType`](group-01-result-error-handling.md#errortype); the convention, spelled out in the inline comment just above it (`ApiControllerBase.cs:37`), is that callers order the most significant error first.
  - Builds a `ProblemDetails` with that status and a fixed title/detail (`ApiControllerBase.cs:40-45`), attaches `Extensions["errors"]` via `ErrorHttpMapping.BuildErrorsExtension` (`ApiControllerBase.cs:48`), optionally localized through an [`IErrorLocalizer`](#ierrorlocalizer) resolved with `GetService` (`ApiControllerBase.cs:47`, so a host without localization simply passes `null`), then returns `StatusCode(statusCode, problemDetails)` (`ApiControllerBase.cs:50`).
- **Why it's built this way**: one `virtual` method instead of a `switch` in every action removes duplication and makes the response shape uniform ([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html) for why failures are values rather than exceptions in the first place); keeping it `virtual` lets a subclass ([`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype)) wrap it with logging without reimplementing the mapping. The two `ErrorHttpMapping` members are `internal static` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:36` and `ErrorHttpMapping.cs:47`), which is what lets [`UnhandledResultFailureFilter`](#unhandledresultfailurefilter) reuse the same status-code mapping and the same `errors` extension array for a failed `Result` that an action returned without calling `HandleFailure` (`UnhandledResultFailureFilter.cs:36` and `UnhandledResultFailureFilter.cs:47`). The two bodies are deliberately *not* identical: the filter labels its `ProblemDetails` `Title`/`Detail` "Unhandled result failure" / "The action returned a Result.Failure that was not mapped to an HTTP error response." (`UnhandledResultFailureFilter.cs:41-42`) against the base's "Operation failed" / "One or more errors occurred." (`ApiControllerBase.cs:43-44`), so a response that fell through the filter is distinguishable from one the controller mapped on purpose. Localization is the [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) extension point, keyed by `Error.Code`.
- **Where it's used**: the root of the controller hierarchy. [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype), [`AuthControllerBase`](#authcontrollerbase), and every module controller derive from it directly or transitively.

### IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/IAggregateRootEntityControllerBase.cs:15` · Level 3 · interface

- **What it is**: the read-write extension of [`IEntityControllerBase<TEntityDTO, TIdentifierType>`](#ientitycontrollerbasetentitydto-tidentifiertype): it adds `CreateAsync` and `DeleteAsync` for aggregate-root entities.
- **Depends on**: [`IEntityControllerBase<TEntityDTO, TIdentifierType>`](#ientitycontrollerbasetentitydto-tidentifiertype) (base interface), [`IBaseDTO<TIdentifierType>`](#ibasedtotidentifiertype) and [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) (constraints).
- **Concept**: the write half of the segregated controller contract introduced by [`IEntityControllerBase<TEntityDTO, TIdentifierType>`](#ientitycontrollerbasetentitydto-tidentifiertype). `[Rubric §1, SOLID]`: only aggregate roots get a create/delete surface (`TCreateRequest : ICreateRequest`, `IAggregateRootEntityControllerBase.cs:22`), so child-collection controllers that implement only the read interface never expose mutation they should not own. `[Rubric §9, API & Contract Design]`: create returns the created DTO with a 201, delete returns 204, a consistent verb-to-status contract.
- **Walkthrough**: extends the read interface (`IAggregateRootEntityControllerBase.cs:19`) and adds two members: `CreateAsync([Required] TCreateRequest request, ...)` returning the created DTO with 201 (`IAggregateRootEntityControllerBase.cs:28-30`), and `DeleteAsync(TIdentifierType id, ...)` returning 204 No Content (`IAggregateRootEntityControllerBase.cs:36-38`).
- **Where it's used**: implemented by [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest).

### IdempotentAttribute

> MMCA.Common.API · `MMCA.Common.API.Idempotency` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotentAttribute.cs:16` · Level 3 · class (sealed)

- **What it is**: the method-level marker that attaches [`IdempotencyFilter`](#idempotencyfilter) to a controller action. Putting `[Idempotent]` on an action opts it into the `Idempotency-Key` replay behavior.
- **Depends on**: `ServiceFilterAttribute` from ASP.NET Core MVC; resolves [`IdempotencyFilter`](#idempotencyfilter) from DI.
- **Concept introduced: service filters (DI-resolved action filters).** `[Rubric §2, Design Patterns]` covers the filter/decorator idiom: a plain `[TypeFilter]` would new-up the filter, but `ServiceFilterAttribute` (`IdempotentAttribute.cs:16`) resolves it from the container instead, so the filter can take scoped dependencies like [`ICacheService`](group-09-caching.md#icacheservice) (remarks, `IdempotentAttribute.cs:10-14`). `[Rubric §15, Best Practices]`: the attribute is one line with `[AttributeUsage(AttributeTargets.Method)]` (`IdempotentAttribute.cs:15`) restricting it to actions.
- **Walkthrough**: the whole type is `public sealed class IdempotentAttribute() : ServiceFilterAttribute(typeof(IdempotencyFilter))` (`IdempotentAttribute.cs:16`); the primary constructor forwards the filter type to the base. The docs note the filter must be registered in DI, which `AddAPI` does (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:67`); without it, resolution fails at request time.
- **Why it's built this way**: opt-in per action is the [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html) decision. Nothing is deduplicated unless the action declares it, so adding the attribute is additive and safe, and the client still decides per request whether to send a key.
- **Caveats / not-in-source**: the flip side of opt-in is that an action which *should* be idempotent but is missing `[Idempotent]` gets no protection at all, an inventory-audit caveat ADR-017 names explicitly.
- **Where it's used**: applied to the create endpoint on [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest) (`AggregateRootEntityControllerBase.cs:59`) and available for any module action that needs retry-safe writes.

### EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:28` · Level 6 · class (abstract)

- **What it is**: the generic read-only controller that gives any entity four working REST endpoints (`GET /`, `GET /paged`, `GET /lookup`, `GET /{id}`) with filtering, sorting, pagination, and field projection, by delegating to the [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype) pipeline.
- **Depends on**: [`ApiControllerBase`](#apicontrollerbase) (base), [`IEntityControllerBase<TEntityDTO, TIdentifierType>`](#ientitycontrollerbasetentitydto-tidentifiertype) (implements), [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (constraint), [`IApplicationSettings`](group-14-module-system-composition.md#iapplicationsettings), [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata), [`BaseLookup<TIdentifierType>`](#baselookuptidentifiertype), [`QueryFilterModelBinder`](#queryfiltermodelbinder), [`Error`](group-01-result-error-handling.md#error); ASP.NET Core MVC, `Asp.Versioning`, and `ILogger`.
- **Concept introduced: generic controller bases that eliminate CRUD boilerplate.** `[Rubric §9, API & Contract Design]` covers uniform endpoint conventions; `[Rubric §1, SOLID]` covers the Open/Closed side, since a new entity controller extends this base rather than re-writing four endpoints. The class-level `[ApiController]`, `[Route("[controller]")]`, `[ApiVersion("1.0")]` (`EntityControllerBase.cs:25-27`) plus the three generic constraints (`EntityControllerBase.cs:35-37`) turn the type parameters into the contract: name the entity, the DTO, and the identifier alias, and the routes, the versioning, and the query behavior follow ([ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html)).
- **Walkthrough**
  - Primary constructor (`EntityControllerBase.cs:28-33`) takes the query service and an `ILogger`, both null-guarded into the `QueryService` (`EntityControllerBase.cs:39`) and `Logger` (`EntityControllerBase.cs:44`) protected properties.
  - `MaxPageSize` (`EntityControllerBase.cs:50-57`) resolves [`IApplicationSettings`](group-14-module-system-composition.md#iapplicationsettings) per-request from `HttpContext.RequestServices`, falling back to 500. Per-request resolution means a settings change takes effect without a restart. `EntityName` (`EntityControllerBase.cs:62`) is `typeof(TEntity).Name`, used in log messages.
  - `GetAllAsync` unpaged (`EntityControllerBase.cs:76`, `[HttpGet]` at `EntityControllerBase.cs:73`): delegates to the query service with `pageNumber: 1` and `pageSize: MaxPageSize` (`EntityControllerBase.cs:87-88`), so even the "all" endpoint is capped, then either `HandleFailure` or `Ok`.
  - `GetAllAsync` paged (`EntityControllerBase.cs:116`, `[HttpGet("paged")]` at `EntityControllerBase.cs:112`): clamps with `Math.Min(pageSize, MaxPageSize)` (`EntityControllerBase.cs:127`), and on success serializes [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata) into the `X-Pagination` response header (`EntityControllerBase.cs:144`) rather than mixing it into the body, `[Rubric §9]` again, and `[Rubric §12, Performance & Scalability]` for the clamp.
  - `GetAllForLookupAsync` (`EntityControllerBase.cs:157`, `[HttpGet("lookup")]` at `EntityControllerBase.cs:154`): returns `CollectionResult<BaseLookup<TIdentifierType>>`, a lightweight id/label pair, with a `[Required]` `nameProperty` (`EntityControllerBase.cs:158`) choosing the label.
  - `GetByIdAsync` (`EntityControllerBase.cs:189`, `[HttpGet("{id}")]` at `EntityControllerBase.cs:184`): `includeFKs` defaults to `true` for the single-entity case (`EntityControllerBase.cs:191`).
  - `HandleFailure` override (`EntityControllerBase.cs:216-230`): logs the first error at Warning, guarded by `Logger.IsEnabled` (`EntityControllerBase.cs:219`), before delegating to [`ApiControllerBase`](#apicontrollerbase)`.HandleFailure`, so the read path gets observability (`[Rubric §13, Observability & Operability]`) without changing the response mapping.
  - Every action passes `asTracking: false` to the query service (for example `EntityControllerBase.cs:89`), because a read endpoint never mutates what it loaded.
- **Why it's built this way**: the controller stays thin. All filtering/sorting/paging lives in [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype), and manual DTO mapping ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)) keeps entities off the wire. The controller only translates HTTP concerns: query strings, headers, status codes.
- **Where it's used**: the base for every read-only module controller, for example ADC's child-collection controllers `SessionSpeakersController` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSpeakersController.cs:46`) and `CategoryItemsController` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:68`). Extended by [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest) for entities that also create and delete.

### OAuthControllerBase

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:32` · Level 6 · class (abstract)

- **What it is**: the base controller for external OAuth2 sign-in (Google, GitHub). It runs the challenge/callback/complete/exchange dance so a browser or native head can log in through a provider and receive a local JWT pair without ever exposing tokens in a redirect URL.
- **Depends on**: [`IAuthenticationService`](group-08-auth.md#iauthenticationservice) (`ExternalLoginAsync`), [`ICacheService`](group-09-caching.md#icacheservice), `IConfiguration`, [`ExternalAuthExtensions`](#externalauthextensions) (the scheme constant, `OAuthControllerBase.cs:37`), [`AuthenticationResponse`](group-08-auth.md#authenticationresponse), [`OAuthCodeExchangeRequest`](group-08-auth.md#oauthcodeexchangerequest), and [`Error`](group-01-result-error-handling.md#error); the Google/GitHub OAuth packages and `System.Security.Cryptography`.
- **Concept introduced: the code-exchange OAuth completion pattern.** `[Rubric §11, Security]` assesses how credentials move through the system; the design's whole point is that the redirect after a successful provider login carries only a single-use opaque code, never the access/refresh tokens, so tokens never land in the address bar, browser history, the `Referer` header, or upstream access logs (`OAuthControllerBase.cs:113-115`). `[Rubric §7, Microservices Readiness]`: the base is hoisted from the app hosts so every service reuses the identical flow, with the sealed subclass supplying only `[Route("auth/oauth")]` and versioning (class remark, `OAuthControllerBase.cs:28-31`). See [ADR-036](https://ivanball.github.io/docs/adr/036-external-oauth-login.html).
- **Walkthrough**
  - `OAuthExchangeCodePrefix` and a 2-minute `OAuthExchangeCodeLifetime` (`OAuthControllerBase.cs:42-43`) namespace and time-box the server-side token stash; the short TTL matches the single redirect-then-POST round trip.
  - `GoogleLogin` (`OAuthControllerBase.cs:50`) and `GitHubLogin` (`OAuthControllerBase.cs:58`) both call `ChallengeProvider` (`OAuthControllerBase.cs:258`), which stashes `returnUrl` in `AuthenticationProperties.Items` and sets `RedirectUri = "/auth/oauth/complete"` (`OAuthControllerBase.cs:262-263`).
  - `CompleteAsync` (`OAuthControllerBase.cs:75`): after the middleware handles the provider callback, this reads the external cookie (`OAuthControllerBase.cs:78`), redirects to `/login?error=oauth_failed` when the ticket did not survive (`OAuthControllerBase.cs:80-85`), reads the stashed `returnUrl` with a `GetString` fallback to `"/"` rather than the throwing `Items` indexer (`OAuthControllerBase.cs:87-90`), extracts provider claims (`ExtractClaims`, `OAuthControllerBase.cs:171`), calls `ExternalLoginAsync` to find/create the local user and mint tokens (`OAuthControllerBase.cs:100-101`), signs out the temporary external cookie (`OAuthControllerBase.cs:111`), then mints a 32-byte hex `exchangeCode` (`OAuthControllerBase.cs:116`), stashes the token pair in the cache under it (`OAuthControllerBase.cs:117-118`), and redirects with only the code (`OAuthControllerBase.cs:120`).
  - Name handling is defensive: `ExtractName` prefers `GivenName`/`Surname` claims and otherwise splits the `Name` claim, falling back to `("User", "")` when there is no usable space-separated name (`OAuthControllerBase.cs:181-209`), so a provider that returns only a display name still yields a creatable local account.
  - Native heads ([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)): `GetAllowedMobileReturnUrl` (`OAuthControllerBase.cs:233`) returns the stashed `returnUrl` as the redirect target only when it is an absolute URI whose custom scheme is listed in `OAuth:AllowedReturnUrlSchemes`; http/https never match (`OAuthControllerBase.cs:236-237`), so the allowlist cannot become an open redirect, and a missing or empty section (or a test double returning `null` from `GetSection`) means "no allowlist", the exact pre-ADR-043 behavior (`OAuthControllerBase.cs:242-246`).
  - `ExchangeAsync` (`OAuthControllerBase.cs:138`): `[HttpPost("exchange")]` + `[AllowAnonymous]` (`OAuthControllerBase.cs:135-136`); the UI swaps the code for the real [`AuthenticationResponse`](group-08-auth.md#authenticationresponse) out-of-band. Because that response is a `readonly record struct` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthenticationResponse.cs:10`), a cache miss yields a default value rather than `null`, so the miss is detected via an empty `AccessToken` (`OAuthControllerBase.cs:152`). The code is then removed (`OAuthControllerBase.cs:158`), making it single-use so a leaked or replayed code cannot mint a second token pair. Both failure paths return the same opaque 400 "Invalid sign-in code" (`OAuthControllerBase.cs:163-169`).
- **Why it's built this way**: carrying tokens in a redirect is the classic OAuth token-leak vector; the single-use code plus a short-lived server-side stash closes it while keeping the client flow a plain redirect and one POST. The `AppendQuery` helper (`OAuthControllerBase.cs:249`) deliberately uses `OriginalString` rather than `ToString()`, because `Uri` normalization appends a trailing slash to authority-only URIs (`atldevcon://oauth-complete`) and native authenticator callback matching can be exact (`OAuthControllerBase.cs:251-253`).
- **Caveats / not-in-source**: the provider scheme registration and the concrete `ExternalLoginAsync` implementation live outside this base ([`ExternalAuthExtensions`](#externalauthextensions) and the app's [`IAuthenticationService`](group-08-auth.md#iauthenticationservice)); this file assumes both are wired.
- **Where it's used**: subclassed by each app's sealed OAuth controller, for example ADC's `OAuthController` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/OAuthController.cs:20-23`), which adds only `[ApiController]`, `[Route("auth/oauth")]`, and `[ApiVersion("1.0")]` and has an empty body.

### AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AggregateRootEntityControllerBase.cs:27` · Level 7 · class (abstract)

- **What it is**: the read-write tier of the controller hierarchy. It extends [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype) (the four read endpoints) by adding a `CreateAsync` (POST) and a `DeleteAsync` (DELETE) for aggregate-root entities.
- **Depends on**: [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype) (base), [`IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>`](#iaggregaterootentitycontrollerbasetentitydto-tidentifiertype-tcreaterequest) (implements), [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) (create and delete handlers), [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype), [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) (constraint), [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) (constraint), [`IdempotentAttribute`](#idempotentattribute); ASP.NET Core MVC and `Asp.Versioning`.
- **Concept introduced: idempotent creation guarded at the endpoint.** `[Rubric §9, API & Contract Design]` assesses safe mutation; `CreateAsync` carries `[Idempotent]` (`AggregateRootEntityControllerBase.cs:59`), which wires [`IdempotencyFilter`](#idempotencyfilter) so a retried POST with the same `Idempotency-Key` gets the original 201 back instead of creating a duplicate aggregate, exactly what mobile and flaky-network clients need. `[Rubric §1, SOLID]`: the four constraints (`AggregateRootEntityControllerBase.cs:40-43`, notably `TEntity : AuditableAggregateRootEntity<TIdentifierType>`) enforce at compile time that only aggregate roots reach this create/delete surface.
- **Walkthrough**
  - Primary constructor (`AggregateRootEntityControllerBase.cs:27-38`): four parameters, where `queryService` and `logger` are forwarded to the [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype) base (`AggregateRootEntityControllerBase.cs:38`), plus `createHandler` and `deleteHandler`. The `logger` is typed `ILogger<EntityControllerBase<...>>`, not of this class, because `ILogger<T>` is not covariant and the base ctor requires that exact type; the `#pragma warning disable S6672` (`AggregateRootEntityControllerBase.cs:35-37`) is a justified, narrowly-scoped suppression documenting exactly that (`[Rubric §15, Best Practices]`).
  - `CreateHandler` property (`AggregateRootEntityControllerBase.cs:48`): `protected`, so a derived controller that overrides `CreateAsync` to build a more specific command can still reach the handler. `deleteHandler` stays a captured constructor parameter, used directly at `AggregateRootEntityControllerBase.cs:93`, because nothing overrides delete today.
  - `CreateAsync` (`AggregateRootEntityControllerBase.cs:63-76`): `[HttpPost]` + `[Idempotent]` (`AggregateRootEntityControllerBase.cs:58-59`), body bound `[FromBody, Required]` (`AggregateRootEntityControllerBase.cs:64`); it dispatches the create command and on success returns `CreatedAtRoute($"Get{typeof(TEntity).Name}ById", new { id = result.Value!.Id }, result.Value)` (`AggregateRootEntityControllerBase.cs:72-75`), following the `"Get{Entity}ById"` route-name convention derived controllers establish. On failure it maps errors via `HandleFailure`.
  - `DeleteAsync` (`AggregateRootEntityControllerBase.cs:89-98`): `[HttpDelete("{id}")]` (`AggregateRootEntityControllerBase.cs:84`); builds a [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype), dispatches it, and returns `NoContent()` on success. Delete here means soft-delete: the handler loads the aggregate and calls its `Delete()` method (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/DeleteEntityHandler.cs:30`), so the domain, not the controller, decides whether the removal is allowed.
- **Why it's built this way**: splitting the read-only base from the aggregate-root base means a child-collection controller (add/remove associations, not create whole aggregates) can extend the read base without inheriting create/delete it should not expose (`[Rubric §1, SOLID]`, Interface Segregation), while the actual work stays in injected Application-layer handlers (`[Rubric §3, Clean Architecture]`) that the CQRS decorator pipeline already wraps with validation, transactions, and cache invalidation ([ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)).
- **Where it's used**: concrete aggregate controllers in the modules extend this, for example ADC's `EventsController` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventsController.cs:57`), `SessionsController` (`SessionsController.cs:54`), and `SpeakersController` (`SpeakersController.cs:56`); child-only controllers deliberately extend the read-only base instead.

### AuthControllerBase

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:40` · Level 10 · class (abstract)

- **What it is**: the abstract base for password-based authentication endpoints: login, register, refresh, and revoke. A downstream module (Identity) inherits it and adds the route prefix, version attribute, and any module-specific endpoints (change-password, preferences).
- **Depends on**: [`ApiControllerBase`](#apicontrollerbase) (base), [`IAuthenticationService`](group-08-auth.md#iauthenticationservice) and [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) (injected), [`LoginRequest`](group-08-auth.md#loginrequest), [`RegisterRequest`](group-08-auth.md#registerrequest), [`RefreshTokenRequest`](group-08-auth.md#refreshtokenrequest), [`AuthenticationResponse`](group-08-auth.md#authenticationresponse), and the `RateLimitPolicyAuthIp` constant on [`WebApplicationBuilderExtensions`](#webapplicationbuilderextensions); `Microsoft.AspNetCore.RateLimiting` for `[EnableRateLimiting]`.
- **Concept introduced: a secure-by-default base, not just a shared one.** `[Rubric §9, API & Contract Design]` assesses uniform endpoint conventions and `[Rubric §1, SOLID]` the Open/Closed angle (the base provides `virtual` endpoints, a derived controller overrides only what differs), but the load-bearing idea here is `[Rubric §11, Security]`: anti-spray throttling is **on by default**. `LoginAsync` and `RegisterAsync` carry `[EnableRateLimiting(WebApplicationBuilderExtensions.RateLimitPolicyAuthIp)]` (`AuthControllerBase.cs:55` and `AuthControllerBase.cs:76`), so any consumer inheriting this base gets per-IP protection without opting in. The class doc (`AuthControllerBase.cs:17-26`) records why: the earlier arrangement shipped the policy in the framework and left each app to attach it, and an app that simply inherited these actions silently had no spray protection at all, because the global limiter deliberately no-ops for anonymous traffic and account lockout is per-email ([ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html), [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)). All four actions otherwise share the same Result-to-ActionResult shape: call the service, check `result.IsFailure`, return `HandleFailure(result.Errors)` or the success result. None carries business logic; they are thin HTTP adapters over [`IAuthenticationService`](group-08-auth.md#iauthenticationservice).
- **Walkthrough**
  - Primary constructor (`AuthControllerBase.cs:40-42`) exposes `AuthenticationService` and `CurrentUserService` as `protected` properties (`AuthControllerBase.cs:45` and `AuthControllerBase.cs:48`) so derived controllers can reach them for extra endpoints.
  - `LoginAsync` (`AuthControllerBase.cs:59`): `[HttpPost("login")]`, `[AllowAnonymous]`, throttled per IP (`AuthControllerBase.cs:53-55`); returns `Ok` or `HandleFailure`. The `[ProducesResponseType]` attributes (`AuthControllerBase.cs:56-58`) feed the OpenAPI contract and include the 429 the limiter can now produce.
  - `RegisterAsync` (`AuthControllerBase.cs:81`): also anonymous and throttled (`AuthControllerBase.cs:74-76`); returns `StatusCode(StatusCodes.Status201Created, ...)` (`AuthControllerBase.cs:89`), correctly 201 Created for a new account rather than 200. It is `virtual` so a module can override it to inject extra context (the doc comment names client IP).
  - `RefreshAsync` (`AuthControllerBase.cs:99`): `[AllowAnonymous]` (`AuthControllerBase.cs:96`), since exchanging an expired token pair is pre-authentication, and deliberately **not** throttled (`AuthControllerBase.cs:27-33`): refresh is automatic and periodic rather than user-initiated, Blazor Server circuits issue it server-side so every Server-circuit user shares the UI host's IP, and refresh tokens are high-entropy, so brute force is not the threat password spraying is.
  - `RevokeAsync` (`AuthControllerBase.cs:117`): `[Authorize]` (`AuthControllerBase.cs:114`); reads `CurrentUserService.UserId`, returns `Unauthorized()` if null (`AuthControllerBase.cs:119-121`) as a defensive guard even though `[Authorize]` should already prevent a null id, then revokes and returns `NoContent()` (`AuthControllerBase.cs:123-127`).
- **Why it's built this way**: `[Rubric §16, Maintainability]`: adding a new token flow means changing one base, not N module controllers; keeping the four methods `virtual` (rather than the class open-ended) keeps the override surface intentional. The rate-limit default is deliberately a *loud* dependency: a consumer that inherits this base without calling `AddCommonRateLimiting()` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:155`, which registers the `"auth-ip"` policy at `WebApplicationBuilderExtensions.cs:192-194` with a default of 30 requests per minute per IP) fails at startup on an unregistered policy rather than silently serving unthrottled logins (`AuthControllerBase.cs:34-38`).
- **Caveats / not-in-source**: the per-IP partition keys on `Connection.RemoteIpAddress` and deliberately does **not** limit when that address is null (in-process `TestServer`, integration tests), a fail-open posture matching the global limiter (`WebApplicationBuilderExtensions.cs:184-191`).
- **Where it's used**: extended by each app's Identity `AuthController`, for example ADC's (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/AuthController.cs:32`), which supplies `[Route("[controller]")]` and `[ApiVersion("1.0")]` (`AuthController.cs:24-25`), overrides `RegisterAsync` to pass the client IP (`AuthController.cs:44-55`), re-declares `LoginAsync` to document the lockout 429 while delegating to `base.LoginAsync` (`AuthController.cs:68-71`), and adds the change-password and preferences endpoints.

### DbUpdateExceptionHandler

> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/DbUpdateExceptionHandler.cs:17` · Level 0 · class (sealed)

- **What it is**: An `IExceptionHandler` that maps EF Core's `Microsoft.EntityFrameworkCore.DbUpdateException` to an HTTP 409 Conflict RFC 9457 Problem Details response. The full exception is logged server-side; the client sees only a generic message.
- **Depends on**: `Microsoft.AspNetCore.Diagnostics.IExceptionHandler`, `Microsoft.AspNetCore.Http.IProblemDetailsService` (the RFC 9457 writer), `Microsoft.EntityFrameworkCore.DbUpdateException`; sits ahead of [GlobalExceptionHandler](#globalexceptionhandler) in the pipeline.
- **Concept introduced: the `IExceptionHandler` pipeline.** ASP.NET Core (8+) exposes `IExceptionHandler` as an ordered chain: each handler's `TryHandleAsync` returns `true` to claim an exception or `false` to pass it on. Type-specific handlers register first; the catch-all [GlobalExceptionHandler](#globalexceptionhandler) registers last. This yields one consistent `application/problem+json` shape across every error type without `try/catch` in controllers. `[Rubric §9, API & Contract Design]` assesses whether error responses are uniform and standards-based; the chain produces RFC 9457 bodies for every failure path. `[Rubric §11, Security]` assesses whether responses leak internals; the handler deliberately swaps the raw EF message (which carries table, column, and constraint names) for a generic detail.
- **Walkthrough**: `TryHandleAsync` (`DbUpdateExceptionHandler.cs:23`): pattern-matches `exception is not DbUpdateException` and returns `false` immediately so unrelated exceptions stay in the pipeline (line 28). Logs the full `dbUpdateException` at `LogError` (line 31). Sets `Response.StatusCode = 409` (line 33). Builds a `ProblemDetailsContext` with the generic detail `"A data conflict occurred. Please retry or contact support."` (line 37), title `"Database Update Exception"` (line 46), and returns `await problemDetailsService.TryWriteAsync(context)` (line 51).
- **Why it's built this way**: 409 is the correct status for a write rejected by a constraint (unique index, optimistic-concurrency token, foreign key). Logging the exception while returning a scrubbed body preserves observability without exposing schema. The primary constructor injects the logger and problem-details writer with no boilerplate.
- **Where it's used**: Registered via `AddExceptionHandler<DbUpdateExceptionHandler>()` in the API startup, ordered before [GlobalExceptionHandler](#globalexceptionhandler) so DB conflicts return 409 rather than 500.

---

### ErrorResources

> MMCA.Common.API · `MMCA.Common.API.Resources` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Resources/ErrorResources.cs:9` · Level 0 · class (sealed)

- **What it is**: An empty anchor type whose only job is to name the framework's error-message `.resx` set. Its sibling files (`ErrorResources.resx` / `ErrorResources.es.resx`) are keyed by a domain error's stable machine `Code` (for example `"PhoneNumber.Empty"`).
- **Depends on**: Nothing at runtime; `IStringLocalizerFactory.Create(typeof(ErrorResources))` uses the type as the resource-lookup anchor (see the doc comment at `ErrorResources.cs:7`). Consumed through [ErrorResourceSource](#errorresourcesource) and [IErrorLocalizer](#ierrorlocalizer).
- **Concept introduced: resource anchor types.** .NET's `IStringLocalizer` resolves translations by pairing a marker `Type` with `.resx` files that share its name and namespace. The class has no members (`ErrorResources.cs:9` declares `public sealed class ErrorResources;`) because it exists purely so the localizer factory can key on it. `[Rubric §27, i18n]` assesses whether user-facing text is externalized for translation; keying resources by the stable error `Code` (not by English prose) lets the same key resolve to any culture. See [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) (multi-locale i18n).
- **Walkthrough**: Body-less type declaration; there is nothing to trace beyond the declaration itself.
- **Why it's built this way**: A dedicated anchor keeps the framework's own error translations discoverable and separate from each module's, which register their own additive resource anchors.
- **Where it's used**: Registered as an [ErrorResourceSource](#errorresourcesource) at startup (Common first); resolved at the edge by [ErrorLocalizer](#errorlocalizer).

---

### ErrorResourceSource

> MMCA.Common.API · `MMCA.Common.API.Localization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Localization/ErrorResourceSource.cs:12` · Level 0 · class (sealed)

- **What it is**: A registered resource source that [IErrorLocalizer](#ierrorlocalizer) consults when translating an error code. It wraps one `IStringLocalizer` (backing one `.resx` set). Common registers one for its own [ErrorResources](#errorresources); each module registers its own additively.
- **Depends on**: `Microsoft.Extensions.Localization.IStringLocalizer`; produced from [ErrorResources](#errorresources)-style anchors via `AddErrorResources<TResource>()`.
- **Concept introduced: an ordered, additive localization registry.** Rather than one global resource file, the framework registers a set of `ErrorResourceSource` instances (Common first, then modules). The localizer enumerates them and returns the first match, so a module can add translations for its own codes without touching Common's file. `[Rubric §27, i18n]` and `[Rubric §7, Microservices Readiness]` both apply: the additive set means an extracted module carries its own translations. See [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html).
- **Walkthrough**: Primary-constructor class exposing a single `public IStringLocalizer Localizer { get; }` property assigned from the injected `localizer` (`ErrorResourceSource.cs:15`). No behavior beyond holding the localizer.
- **Why it's built this way**: Wrapping the localizer in a distinct type lets DI register several as an `IEnumerable<ErrorResourceSource>` in a defined order, which is the enumeration [ErrorLocalizer](#errorlocalizer) walks.
- **Where it's used**: Injected as a collection into [ErrorLocalizer](#errorlocalizer); populated by the framework and by each module's `AddErrorResources<TResource>()` call.

---

### GlobalExceptionHandler

> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/GlobalExceptionHandler.cs:15` · Level 0 · class (sealed)

- **What it is**: The catch-all backstop of the exception-handler chain: it converts any unhandled exception into an HTTP 500 Problem Details response and logs it at error level.
- **Depends on**: `IExceptionHandler`, `IProblemDetailsService`; it is the final fallback behind the specific handlers ([DbUpdateExceptionHandler](#dbupdateexceptionhandler), [ValidationExceptionHandler](#validationexceptionhandler), [OperationCanceledExceptionHandler](#operationcanceledexceptionhandler), [DomainExceptionHandler](#domainexceptionhandler)).
- **Concept introduced**: This is the terminal handler in the `IExceptionHandler` pipeline taught under [DbUpdateExceptionHandler](#dbupdateexceptionhandler). `[Rubric §9, API & Contract Design]` (uniform errors) and `[Rubric §15, Best Practices & Code Quality]` (no unhandled exception escapes as an untyped 500): every path that no specific handler claims still produces an RFC 9457 body.
- **Walkthrough**: `TryHandleAsync` (`GlobalExceptionHandler.cs:21`) does not pattern-match on a type; it always claims. Logs the exception at `LogError` (line 26), sets `Response.StatusCode = 500` (line 28), and returns `await problemDetailsService.TryWriteAsync(...)` with title `"Internal Server Error"` and detail `"An error occurred while processing your request. Please try again"` (lines 29-39).
- **Why it's built this way**: Returning `TryWriteAsync`'s result (rather than hardcoding `true`) keeps the body consistent with whatever `ProblemDetailsService` is configured to emit. It must register last so the specific handlers get first claim.
- **Where it's used**: Registered via `AddExceptionHandler<GlobalExceptionHandler>()` as the last handler in API startup.

---

### IErrorLocalizer

> MMCA.Common.API · `MMCA.Common.API.Localization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Localization/IErrorLocalizer.cs:9` · Level 0 · interface

- **What it is**: The contract for localizing a domain `Error`'s human-readable message at the HTTP edge, keyed by its stable machine `Code`. Domain, handler, and [Result](group-01-result-error-handling.md#result) code stays culture-agnostic; only the edge speaks a culture.
- **Depends on**: Nothing beyond BCL; implemented by [ErrorLocalizer](#errorlocalizer) and consumed by [ErrorHttpMapping](#errorhttpmapping).
- **Concept introduced: edge localization keyed by stable code.** The domain raises errors with a machine `Code` (for example `"PhoneNumber.Empty"`) plus an English message. `IErrorLocalizer.Localize(code, fallbackMessage)` translates that code against the current UI culture, returning the fallback unchanged when the code is empty or no resource has a key (`IErrorLocalizer.cs:11-17`). This keeps culture out of the [Error](group-01-result-error-handling.md#error) type and confines translation to the presentation boundary. `[Rubric §27, i18n]` assesses whether text is translatable without leaking locale into the core; the graceful fallback also satisfies `[Rubric §9, API & Contract Design]` since an untranslated code degrades to English rather than throwing. See [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html).
- **Walkthrough**: Single method `string Localize(string code, string fallbackMessage)` (line 17). The XML doc pins the contract: empty code or no matching resource returns `fallbackMessage`.
- **Why it's built this way**: An interface (not a concrete localizer) lets the edge depend on the abstraction while the additive resource-source enumeration lives in the implementation.
- **Where it's used**: Resolved optionally in [ErrorHttpMapping.BuildErrorsExtension](#errorhttpmapping) and [UnhandledResultFailureFilter](#unhandledresultfailurefilter); a `null` localizer leaves messages in English.

---

### OperationCanceledExceptionHandler

> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/OperationCanceledExceptionHandler.cs:16` · Level 0 · class (sealed)

- **What it is**: An `IExceptionHandler` that maps `OperationCanceledException` (typically a mid-request client disconnect) to HTTP 499 Client Closed Request, so monitoring can tell cancellations apart from server errors.
- **Depends on**: `IExceptionHandler`, `IProblemDetailsService`; sits ahead of [GlobalExceptionHandler](#globalexceptionhandler).
- **Concept introduced**: Uses the `IExceptionHandler` chain from [DbUpdateExceptionHandler](#dbupdateexceptionhandler). `[Rubric §13, Observability & Operability]` assesses whether operational signals are distinguishable; 499 (a non-standard nginx-origin code) keeps client aborts out of the 5xx error rate so dashboards and alerts stay honest.
- **Walkthrough**: `TryHandleAsync` (`OperationCanceledExceptionHandler.cs:22`): returns `false` when the exception is not an `OperationCanceledException` (line 27). Logs at `LogWarning` with the client disconnected (line 30). Sets `Response.StatusCode = 499` (line 32) and writes a Problem Details body with title `"Operation Canceled Exception"` and detail `"The operation was canceled by the client"`, returning `await problemDetailsService.TryWriteAsync(context)` (lines 33-45).
- **Why it's built this way**: Logging at `Warning` (not `Error`) keeps the signal-to-noise ratio high for expected disconnects while still emitting a standards-shaped body.
- **Caveats / not-in-source**: An earlier edition of this guide described this handler as logging at information level and writing no body; the current source logs at warning and does write a 499 Problem Details body (lines 30, 33-45). Trust the code.
- **Where it's used**: Registered before [GlobalExceptionHandler](#globalexceptionhandler); triggered by `CancellationToken` propagation from request aborts throughout the pipeline.

---

### QueryFilterModelBinder

> MMCA.Common.API · `MMCA.Common.API.ModelBinders` · `MMCA.Common/Source/Presentation/MMCA.Common.API/ModelBinders/QueryFilterModelBinder.cs:24` · Level 0 · class (sealed)

- **What it is**: A custom `IModelBinder` that parses a structured filter query string into a `Dictionary<string, (string Operator, string Value)>`, enabling typed server-side filtering on list endpoints.
- **Depends on**: `Microsoft.AspNetCore.Mvc.ModelBinding.IModelBinder` and `ModelBindingContext`; BCL `Dictionary`/`StringComparer`.
- **Concept introduced: structured query-string binding.** The wire format is `?filters[PropertyName].operator=eq&filters[PropertyName].value=SomeValue`; multiple properties bind at once. The binder is deliberately lenient: property names match case-insensitively, and incomplete entries (missing either operator or value) are silently discarded rather than raising a 400 (`QueryFilterModelBinder.cs:59-65`). `[Rubric §9, API & Contract Design]` assesses filter contract ergonomics; the operator/value split gives clients typed comparisons (`eq`, `contains`, `gte`) without an ad-hoc string grammar.
- **Walkthrough**: `BindModelAsync` (line 27): null-guards the context, reads `Request.Query`, and builds a case-insensitive dictionary (line 32). It iterates keys, keeping only those matching the `filters[...].operator` / `filters[...].value` pattern (`IsFilterKey`, line 76), extracts the bracketed property name (`GetFilterPropertyName`, line 86) and the suffix (`GetFilterSuffix`, line 101), and merges the two halves into a tuple since they may arrive in any order (lines 49-56). A final pass removes any tuple still missing a half (lines 59-65), then sets `bindingContext.Result = ModelBindingResult.Success(filters)` (line 67).
- **Why it's built this way**: Accumulating both halves before validating tolerates arbitrary query-key ordering; silent discard of partial filters avoids surfacing 400s while a UI is still assembling parameters.
- **Where it's used**: Applied via `[ModelBinder(typeof(QueryFilterModelBinder))]` on filter-dictionary parameters of list controller actions; the resulting dictionary feeds query handlers.

---

### ValidationExceptionHandler

> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ValidationExceptionHandler.cs:17` · Level 0 · class (sealed)

- **What it is**: An `IExceptionHandler` that maps FluentValidation's `ValidationException` to HTTP 400 Bad Request, grouping errors by property so clients receive the standard `{ "field": ["error1", "error2"] }` shape.
- **Depends on**: `FluentValidation.ValidationException`, `IExceptionHandler`, `IProblemDetailsService`; sits ahead of [GlobalExceptionHandler](#globalexceptionhandler).
- **Concept introduced**: Uses the `IExceptionHandler` chain from [DbUpdateExceptionHandler](#dbupdateexceptionhandler). `[Rubric §9, API & Contract Design]` and `[Rubric §24, Forms/Validation/UX Safety]`: emitting the same field-to-messages dictionary that ASP.NET Core's built-in model validation produces lets front-end form code apply one uniform error-display path regardless of which validator fired.
- **Walkthrough**: `TryHandleAsync` (`ValidationExceptionHandler.cs:23`): returns `false` when the exception is not a `ValidationException` (line 28). Logs at `LogWarning` (line 31), sets status 400 (line 33), and builds a Problem Details context with title `"Validation Exception"` and detail `"One or more validation errors occurred"` (lines 34-44). It groups `validationException.Errors` by `PropertyName` into a `Dictionary<string, string[]>` and adds it under the `"errors"` extension key (lines 48-54), then returns `await problemDetailsService.TryWriteAsync(context)` (line 56).
- **Why it's built this way**: Grouping consolidates multiple failures for one field into a single array entry, matching the `ModelStateDictionary` serialization front ends expect.
- **Where it's used**: Registered before [GlobalExceptionHandler](#globalexceptionhandler); the FluentValidation decorator in the command pipeline surfaces its exceptions here automatically.

---

### CorrelationIdMiddleware

> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/CorrelationIdMiddleware.cs:15` · Level 1 · class (sealed)

- **What it is**: Middleware that resolves a correlation ID for each request and echoes it in the `X-Correlation-ID` response header for client-side tracing.
- **Depends on**: [ICorrelationContext](#icorrelationcontext) (the scoped per-request correlation store); `System.Diagnostics.Activity`, `RequestDelegate`.
- **Concept introduced: the correlation-ID resolution waterfall.** `[Rubric §13, Observability & Operability]` assesses whether requests can be traced end to end. `InvokeAsync` picks the ID from, in order: the client-supplied `X-Correlation-ID` header (`HeaderName`, line 18), the W3C `Activity.Current?.TraceId` propagated by OpenTelemetry, then ASP.NET Core's `HttpContext.TraceIdentifier` (lines 32-34). It writes the ID into [ICorrelationContext](#icorrelationcontext) so downstream code (for example the logging decorator) can stamp it onto every log line.
- **Walkthrough**: Primary constructor takes the next `RequestDelegate`. `InvokeAsync` (line 27) null-guards its arguments, computes `correlationId` via the waterfall, calls `correlationContext.SetCorrelationId(correlationId)` (line 36), and registers `context.Response.OnStarting(...)` to set the response header just before the body flushes (lines 37-41) before awaiting `next(context)`.
- **Why it's built this way**: Writing the header inside `OnStarting` (rather than immediately) is the only safe point after an awaited `next` call; it avoids "headers already sent" once the response has begun. `ICorrelationContext` is received as a method parameter so DI supplies the scoped instance per request.
- **Where it's used**: Registered early in the middleware pipeline; the correlation value is read by the CQRS logging decorator for structured log stamping.

---

### DomainExceptionHandler

> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/DomainExceptionHandler.cs:16` · Level 1 · class (sealed)

- **What it is**: An `IExceptionHandler` that translates a [DomainException](group-01-result-error-handling.md#domainexception) into HTTP 400 Bad Request with an RFC 9457 Problem Details body carrying the exception message.
- **Depends on**: [DomainException](group-01-result-error-handling.md#domainexception), `IExceptionHandler`, `IProblemDetailsService`; sits alongside the other handlers ahead of [GlobalExceptionHandler](#globalexceptionhandler).
- **Concept introduced**: Uses the `IExceptionHandler` chain from [DbUpdateExceptionHandler](#dbupdateexceptionhandler). `[Rubric §9, API & Contract Design]` (uniform error format) and `[Rubric §4, Domain-Driven Design]`: a domain-rule violation surfaces as a client-correctable 400, distinct from infrastructure 500s.
- **Walkthrough**: `TryHandleAsync` (`DomainExceptionHandler.cs:22`): returns `false` when the exception is not a `DomainException` (line 27). Logs at `LogWarning` (line 30) because a domain exception is an expected business error, not a system failure. Sets status 400 (line 32), builds a Problem Details context titled `"Domain Exception"` with `Detail = domainException.Message` (lines 33-43), and returns `await problemDetailsService.TryWriteAsync(context)` (line 45).
- **Why it's built this way**: Passing the domain message straight into the detail is safe because domain exceptions carry business-language text, not schema. Warning-level logging keeps expected business failures out of the error stream.
- **Where it's used**: Registered by the API startup alongside [GlobalExceptionHandler](#globalexceptionhandler), [ValidationExceptionHandler](#validationexceptionhandler), [DbUpdateExceptionHandler](#dbupdateexceptionhandler), and [OperationCanceledExceptionHandler](#operationcanceledexceptionhandler).

---

### ErrorLocalizer

> MMCA.Common.API · `MMCA.Common.API.Localization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Localization/ErrorLocalizer.cs:11` · Level 1 · class (sealed, internal)

- **What it is**: The default [IErrorLocalizer](#ierrorlocalizer) implementation: it resolves an error code against an ordered set of registered [ErrorResourceSource](#errorresourcesource)s (Common first, then modules) using the current UI culture, falling back to the caller's English message when the code is empty or unknown to every source.
- **Depends on**: [IErrorLocalizer](#ierrorlocalizer), [ErrorResourceSource](#errorresourcesource); `Microsoft.Extensions.Localization.LocalizedString`.
- **Concept introduced: first-match-wins over an ordered source list.** `[Rubric §27, i18n]` assesses translation coverage and layering. The localizer materializes the injected `IEnumerable<ErrorResourceSource>` into a read-only list once (`ErrorLocalizer.cs:13`) and, per lookup, walks it in registration order returning the first source whose localizer has the key. See [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html).
- **Walkthrough**: Primary constructor takes `IEnumerable<ErrorResourceSource> sources`, stored as `_sources` via a collection expression (line 13). `Localize` (line 16): returns `fallbackMessage` immediately when `code` is null or empty (lines 18-21); otherwise iterates `_sources`, reading `source.Localizer[code]` and returning `localized.Value` on the first hit where `!localized.ResourceNotFound` (lines 23-30); if no source matches, returns `fallbackMessage` (line 32).
- **Why it's built this way**: `internal sealed` keeps the implementation behind the [IErrorLocalizer](#ierrorlocalizer) abstraction. Snapshotting the sources once avoids re-enumerating a DI collection on every request. First-match ordering lets Common ship base translations while modules override or extend additively.
- **Where it's used**: Registered as the `IErrorLocalizer` for the edge; invoked by [ErrorHttpMapping.BuildErrorsExtension](#errorhttpmapping) and [UnhandledResultFailureFilter](#unhandledresultfailurefilter).

---

### SoftDeletedUserMiddleware

> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:15` · Level 1 · class (sealed)

- **What it is**: Middleware that rejects requests from authenticated users who have been soft-deleted (business rule BR-133), returning HTTP 401. A 30-second cache keeps the check off the database on most requests.
- **Depends on**: [ICurrentUserService](group-08-auth.md#icurrentuserservice), [ICacheService](group-09-caching.md#icacheservice), and (resolved lazily) [ISoftDeletedUserValidator](group-08-auth.md#isoftdeleteduservalidator); `RequestDelegate`.
- **Concept introduced: lazy service resolution for extraction-safe middleware.** `[Rubric §11, Security]` assesses whether revoked identities can keep acting; a soft-deleted user is blocked within the cache window. `[Rubric §12, Performance & Scalability]` assesses per-request cost; caching the deleted flag for 30 seconds (`CacheDuration`, line 17) removes a DB hit from the hot path. `[Rubric §7, Microservices Readiness]`: the validator is resolved via `context.RequestServices.GetService<ISoftDeletedUserValidator>()` (line 53) instead of a constructor parameter, so in extracted services that do not host Identity (where no validator is registered) the middleware no-ops rather than failing every request. The doc comment at lines 26-35 spells out this rationale.
- **Walkthrough**: `InvokeAsync` (line 36): null-guards the context; if `currentUserService.UserId` is null the request is unauthenticated and passes straight through (lines 43-51). It then resolves the validator lazily and, if absent, continues (lines 53-61, the extracted-service path). Otherwise it builds a cache key `user:deleted:{userId}` via `string.Create` with `InvariantCulture` (line 63). A cached `true` short-circuits to 401 (lines 66-71). On a cache miss it calls `softDeletedUserValidator.IsUserSoftDeletedAsync`, caches the result for 30 seconds, and returns 401 if deleted (lines 73-84); otherwise it calls `next(context)` (line 86).
- **Why it's built this way**: Lazy resolution keeps one middleware registration valid across both the Identity host and services that never host Identity, without startup crashes or per-request 500s. The short TTL bounds the window in which a just-deleted user can still act while keeping the check cheap.
- **Where it's used**: Registered in the API pipeline after authentication; the validator is implemented by the Identity module.

---

### ErrorHttpMapping

> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:15` · Level 2 · class (internal static)

- **What it is**: The single source of truth that maps [ErrorType](group-01-result-error-handling.md#errortype) values to HTTP status codes and builds the `errors` extension array for RFC 9457 Problem Details responses. It keeps [ApiControllerBase](#apicontrollerbase) and [UnhandledResultFailureFilter](#unhandledresultfailurefilter) consistent without duplicating the mapping.
- **Depends on**: [Error](group-01-result-error-handling.md#error), [ErrorType](group-01-result-error-handling.md#errortype), [IErrorLocalizer](#ierrorlocalizer); `System.Collections.Frozen`, ASP.NET Core `StatusCodes`.
- **Concept introduced: the complete ErrorType-to-HTTP table.** `[Rubric §9, API & Contract Design]` (standardized error responses). The `FrozenDictionary<ErrorType, int>` (lines 21-31) is the table [ErrorType](group-01-result-error-handling.md#errortype) implies: `Validation` and `Invariant` to 400, `NotFound` to 404, `Conflict` to 409, `Unauthorized` to 401, `Forbidden` to 403, `UnprocessableEntity` to 422, `Failure` to 400. `FrozenDictionary` (not `Dictionary`) is chosen because the map is fixed at startup and read on every failing request, so lock-free optimal reads matter.
- **Walkthrough**: `GetStatusCode(ErrorType)` (line 37) uses `GetValueOrDefault(errorType, 400)`, so any future unmapped error type degrades to 400 rather than throwing. `BuildErrorsExtension(IReadOnlyList<Error>, IErrorLocalizer?)` (line 48) projects each error into an anonymous object with `Code`, `Message`, `Type`, `Source`, and `Target`. The `Message` is localized at the edge via the optional [IErrorLocalizer](#ierrorlocalizer), keyed by the stable `Code` ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)); a `null` localizer leaves the English `Message` unchanged, while `Code`, `Type`, `Source`, and `Target` stay verbatim so clients can still branch on them (lines 48-56).
- **Why it's built this way**: Centralizing the mapping in one `internal static` class keeps controller and filter responses identical and prevents misuse from outside the API package. Threading the localizer through here (rather than into each call site) is what added edge localization without changing consumers' shape.
- **Caveats / not-in-source**: A prior edition documented `BuildErrorsExtension(errors)` with no localizer parameter; the current signature takes an `IErrorLocalizer?` second argument (line 48). Trust the code.
- **Where it's used**: Consumed by [ApiControllerBase](#apicontrollerbase) and [UnhandledResultFailureFilter](#unhandledresultfailurefilter) (both Level 3).

---

### UnhandledResultFailureFilter

> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/UnhandledResultFailureFilter.cs:21` · Level 3 · class (sealed, partial)

- **What it is**: A global `IAlwaysRunResultFilter` that catches controller actions which accidentally return a [Result](group-01-result-error-handling.md#result) failure inside an `ObjectResult` (for example `return Ok(result)`) and replaces the response with a proper Problem Details error instead of leaking the failure as a 200 OK.
- **Depends on**: [Result](group-01-result-error-handling.md#result), [Error](group-01-result-error-handling.md#error), [ErrorHttpMapping](#errorhttpmapping), [IErrorLocalizer](#ierrorlocalizer); ASP.NET Core MVC filter types.
- **Concept introduced: the always-run result filter as a safety net.** `[Rubric §9, API & Contract Design]` (assesses whether unhandled domain failures leak as 200 OK with error JSON) and `[Rubric §15, Best Practices & Code Quality]` (defense in depth). Without this filter, `return Ok(someResult)` where `someResult.IsFailure` would serialize the `Result` as a 200 body, hiding the error from clients and monitoring. `IAlwaysRunResultFilter` runs even on short-circuit paths, so it cannot be bypassed.
- **Walkthrough**: `OnResultExecuting` (`UnhandledResultFailureFilter.cs:25`): the guard `context.Result is not ObjectResult { Value: Result result } || result.IsSuccess` makes the filter a no-op unless the response wraps a failed `Result` (line 27). On a failure it logs at `Warning` via a source-generated `LoggerMessage` (lines 32, 57-66), derives the status code from the first error's type through [ErrorHttpMapping](#errorhttpmapping) (falling back to 500 when there are no errors, lines 34-37), and builds a `ProblemDetails` titled `"Unhandled result failure"` (lines 39-44). It resolves [IErrorLocalizer](#ierrorlocalizer) from request services (may be null) and fills the `errors` extension via `ErrorHttpMapping.BuildErrorsExtension` (lines 46-47), then swaps `context.Result` for the Problem Details `ObjectResult` at that status (line 49). `OnResultExecuted` (line 53) is empty.
- **Why it's built this way**: A global always-run filter is the last line of defense against a developer mistake (returning a raw failed `Result`); the `Warning` log gives operators immediate visibility into which action leaked. Reusing [ErrorHttpMapping](#errorhttpmapping) keeps this response identical to the controller-base path.
- **Where it's used**: Registered globally in the API startup via `MvcOptions.Filters`; it fires on every action response.

### AppAssociationOptions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/AppAssociationOptions.cs:9` · Level 0 · class (sealed)

- **What it is**: the strongly-typed options bag that carries the identifiers a mobile OS needs to
  verify that an installed native app may claim this host's https links. It feeds
  [`AppAssociationEndpointExtensions`](#appassociationendpointextensions), which serializes it into
  the two well-known documents (Android Digital Asset Links and the Apple App Site Association).
- **Depends on**: BCL only (`IReadOnlyList<string>`). Consumed by
  [`AppAssociationEndpointExtensions`](#appassociationendpointextensions).
- **Concept introduced: deep-link / universal-link association.** For a Blazor Hybrid app to open
  a shared web URL directly in the installed native app (rather than the browser), the operating
  system fetches a signed association document from the URL's host and checks that the installed
  app's signing identity matches. This options type is the single source of those identities so a
  certificate rotation becomes a config change, not a code change (the doc comment at
  `AppAssociationOptions.cs:3-8` makes that intent explicit). `[Rubric §9: API & Contract Design]`
  assesses whether public contracts (here, the exact JSON payload consumed by Google/Apple) are
  pinned and typed rather than hand-built inline; binding them from an `AppAssociation` config
  section is that discipline.
- **Walkthrough**: four members, all `init`-only:
  - `AndroidPackageName` (`AppAssociationOptions.cs:12`, `required`): the Android application id
    declared in `assetlinks.json`.
  - `AndroidCertFingerprints` (`AppAssociationOptions.cs:18`, defaults to `[]`): SHA-256
    signing-certificate fingerprints; the doc comment warns this is the Play App Signing
    certificate, not the local upload keystore.
  - `AppleAppId` (`AppAssociationOptions.cs:21`, `required`): the `TeamID.BundleID` used by both
    `webcredentials` and `applinks`.
  - `AppleAppLinkComponents` (`AppAssociationOptions.cs:28`, defaults to `[]`): URL patterns (for
    example `"/conference/*"`) that each become a `{ "/": pattern }` entry; the comment notes these
    should mirror the app's shared Blazor routes so web and device use identical URLs.
- **Why it's built this way**: `required init` gives compile-checked construction with immutability
  once bound (see the primer's [immutability conventions](00-primer.md#2-architectural-styles-this-codebase-commits-to)):
  the host binds it once from configuration and the endpoint reads it for the process lifetime.
- **Where it's used**: passed to `MapAppAssociationEndpoints(...)` on
  [`AppAssociationEndpointExtensions`](#appassociationendpointextensions) in a Blazor UI host's
  endpoint mapping.

---

### ICorrelationContext
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICorrelationContext.cs:8` · Level 0 · interface

- **What it is**: a scoped service that holds and exposes the correlation ID for the current
  request. Middleware sets it from the inbound `X-Correlation-ID` header (or a generated value) and
  everything downstream reads it through structured-logging scopes.
- **Depends on**: BCL only. Its HTTP-bound implementation lives in Infrastructure and is set by
  [`CorrelationIdMiddleware`](#correlationidmiddleware).
- **Concept introduced: distributed trace correlation.** In a modular monolith that can be
  extracted into microservices, a correlation ID threads a single logical operation across log
  entries, outbox messages, and downstream service calls so every log line for one request can be
  found together. `[Rubric §13: Observability & Operability]` assesses exactly this ability to
  reconstruct one operation end to end; `[Rubric §10: Cross-Cutting Concerns]` assesses whether
  such concerns are factored out of business code, which this interface does by letting handlers and
  decorators read the ID without touching `HttpContext`.
- **Walkthrough**: two members: `CorrelationId { get; }` (`ICorrelationContext.cs:11`) that
  everything downstream reads, and `SetCorrelationId(string)` (`ICorrelationContext.cs:15`) that the
  middleware calls once at the start of each request. Putting the setter on the same interface (not
  a second internal interface) keeps the write path to the one place that owns it.
- **Why it's built this way**: the interface lives in **Application**, not Infrastructure, so the
  CQRS logging decorators can enrich their log scope with the ID without taking an ASP.NET
  dependency. That keeps the dependency arrow pointing inward ([Rubric §3: Clean Architecture]).
- **Where it's used**: the logging command/query decorators wrap the ID into their log scope; the
  Infrastructure middleware sets it; outbox processors propagate it in domain-event metadata.

---

### JwtForwardingDelegatingHandler
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Http` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Http/JwtForwardingDelegatingHandler.cs:17` · Level 0 · class (sealed)

- **What it is**: an HTTP `DelegatingHandler` that copies the inbound `Authorization` header from
  the current `HttpContext` onto every outgoing HTTP request, so a typed service client forwards the
  caller's bearer token to a downstream service without each handler threading the token by hand.
- **Depends on**: `Microsoft.AspNetCore.Http.IHttpContextAccessor` (BCL/ASP.NET). It is the HTTP
  twin of the gRPC [`JwtForwardingClientInterceptor`](group-13-grpc-contracts.md#jwtforwardingclientinterceptor).
- **Concept introduced: token propagation for distributed authorization.** `[Rubric §7,
  Microservices Readiness]` and `[Rubric §11: Security]`: when an extracted service calls another
  service's HTTP API on behalf of a user, the downstream needs that user's JWT to authorize. This
  handler moves that mechanical forwarding out of application code and into a message-pipeline
  concern registered once.
- **Walkthrough**: `SendAsync` (`JwtForwardingDelegatingHandler.cs:22`):
  - Null-guards the request (`:24`).
  - If `request.Headers.Authorization` is already set, it forwards untouched (`:27-30`) so an
    explicit token or a prior handler is never overwritten.
  - Reads the inbound `Authorization` from `IHttpContextAccessor.HttpContext` (`:32`); if there is
    no context or no header (background processors, outbox dispatch) it is a **no-op** and just
    calls `base.SendAsync` (`:33-36`).
  - Normalizes the scheme: if the inbound value starts with `Bearer ` it strips that prefix,
    otherwise it treats the whole string as the token, then re-attaches it as a fresh
    `AuthenticationHeaderValue("Bearer", token)` (`:40-45`).
- **Why it's built this way**: sealed, and the null-context no-op is deliberate: background services
  use their own credentials, not the ambient user's token, so the handler can be registered globally
  on typed clients without conditional wiring at call sites.
- **Where it's used**: attached to typed HTTP clients via `AddHttpMessageHandler<...>()` in
  Infrastructure DI; paired with the gRPC interceptor for the two transports.

---

### OpenApiEndpointExtensions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/OpenApiEndpointExtensions.cs:18` · Level 0 · class (static, extension block)

- **What it is**: two `extension(WebApplication app)` mapping helpers that expose the generated
  OpenAPI document and an optional interactive reference UI, both **outside Production only**.
- **Depends on**: `Scalar.AspNetCore` (NuGet) for the reference UI; pairs with
  `AddCommonOpenApi()` on [`WebApplicationBuilderExtensions`](#webapplicationbuilderextensions),
  which registers the generator.
- **Concept introduced: the OpenAPI contract as a dev/CI artifact, not a public surface.**
  `[Rubric §9: API & Contract Design]` assesses whether the API has a machine-readable contract and
  whether it is guarded against silent drift. The doc comment (`OpenApiEndpointExtensions.cs:7-17`)
  is explicit that the document is the source of truth for the API surface and is intended to be
  guarded by a contract-snapshot test in the consumer integration tiers (the framework deliberately
  does not duplicate that gate because the surface lives in the consumer hosts). Mapping outside
  Production is the security posture: these are internal services reached through the Gateway, so the
  spec is never a public production endpoint `[Rubric §11: Security]`.
- **Walkthrough**
  - `MapCommonOpenApi()` (`OpenApiEndpointExtensions.cs:28`): calls the built-in `MapOpenApi()` only
    when `!app.Environment.IsProduction()` (`:30-33`), serving `/openapi/{documentName}.json`. No-op
    in Production.
  - `MapCommonScalarUi()` (`OpenApiEndpointExtensions.cs:46`): opt-in developer convenience that
    calls `MapScalarApiReference()` outside Production (`:48-51`), rendering `/scalar/{documentName}`.
    Assets are served by the bundled Scalar package (no external CDN), so it is safe for offline/CI.
- **Why it's built this way**: one shared pair of helpers keeps every service's OpenAPI story
  identical and keeps the "internal spec, not public surface" convention enforced in one place
  rather than per host.
- **Where it's used**: called from each service host's `Program.cs` after the app is built,
  alongside the middleware pipeline mapping.

---

### AppAssociationEndpointExtensions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/AppAssociationEndpointExtensions.cs:15` · Level 1 · class (static, extension block)

- **What it is**: a mapping helper that serves the two well-known app-association documents from an
  [`AppAssociationOptions`](#appassociationoptions): Android Digital Asset Links at
  `/.well-known/assetlinks.json` and the Apple App Site Association at
  `/.well-known/apple-app-site-association`.
- **Depends on**: [`AppAssociationOptions`](#appassociationoptions) (Level 0) for the payload
  values; ASP.NET `IEndpointRouteBuilder`/`Results.Json`.
- **Concept: anonymous, machine-verified association documents.** Both endpoints are anonymous by
  design because the OS and Apple's CDN fetch them without credentials (doc comment
  `AppAssociationEndpointExtensions.cs:11-13`). `[Rubric §9: API & Contract Design]`: the exact JSON
  shape is a contract that a third party parses, so the code builds it structurally rather than
  hand-formatting strings.
- **Walkthrough**
  - Two path constants: `AssetLinksPath` (`AppAssociationEndpointExtensions.cs:18`) and
    `AppleAppSiteAssociationPath` (`:24`); the comment on the Apple constant notes the path has no
    file extension by Apple's requirement while the content type must still be JSON.
  - `MapAppAssociationEndpoints(AppAssociationOptions options)` (`:35`): null-guards the options
    (`:37`), builds both documents once at map time (they are static for the process lifetime,
    `:39-40`), then maps two anonymous `GET`s that each return `Results.Json(...)` and are
    `.ExcludeFromDescription()` so they never leak into the OpenAPI document (`:42-48`).
  - `BuildAssetLinks` (`:54`) emits the `delegate_permission/common.handle_all_urls` relation with
    the Android package name and cert fingerprints; `BuildAppleAppSiteAssociation` (`:68`) emits the
    `applinks` details (one `{ "/": pattern }` component per configured URL pattern) plus the
    `webcredentials` apps list.
- **Why it's built this way**: building the payload once at map time avoids per-request allocation
  for a document that never changes, and centralizing the RFC 8615 well-known paths as constants
  keeps them from drifting between hosts.
- **Where it's used**: called on a Blazor UI host that ships a companion native/Hybrid app.

---

### JwksEndpointExtensions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/JwksEndpointExtensions.cs:16` · Level 1 · class (static, extension block)

- **What it is**: maps `/.well-known/jwks.json`, serializing the active `JsonWebKeySet` of the
  Identity service so other services can validate its RS256 tokens.
- **Depends on**: [`IJwksProvider`](group-08-auth.md#ijwksprovider) (resolved from DI at request
  time), whose implementation is [`RsaJwksProvider`](group-08-auth.md#rsajwksprovider);
  `Microsoft.IdentityModel.Tokens.JsonWebKeySet`.
- **Concept: the public-key distribution endpoint of cross-service auth ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)).** `[Rubric §11,
  Security]` and `[Rubric §7: Microservices Readiness]`: with RS256, only the Identity service
  holds the private key; every other service fetches the public keys here and validates tokens
  without a shared secret. The endpoint is `.AllowAnonymous()` (`JwksEndpointExtensions.cs:40`)
  because clients fetch it *before* they have a token, which is JWKS by definition (RFC 7517).
- **Walkthrough**: `DefaultJwksPath` constant (`JwksEndpointExtensions.cs:21`);
  `MapJwksEndpoint()` (`:32`) maps an anonymous `GET` that resolves `IJwksProvider`, calls
  `GetJsonWebKeySet()`, serializes with `System.Text.Json`, and writes it as
  `application/json; charset=utf-8` (`:34-40`).
- **Why it's built this way**: non-Identity hosts still map it (see
  [`WebApplicationExtensions`](#webapplicationextensions)); their provider returns an empty key set
  rather than erroring, so the wiring is uniform across every host and JWKS discovery can be routed
  through the Gateway with one forwarder rule.
- **Where it's used**: mapped inside `UseCommonMiddlewarePipeline()`; the URL it serves is what
  `AddForwardedJwtBearer` (on [`WebApplicationBuilderExtensions`](#webapplicationbuilderextensions))
  reaches via OIDC discovery.

---

### MiniProfilerExtensions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/MiniProfilerExtensions.cs:9` · Level 2 · class (static, extension block)

- **What it is**: a conditional MiniProfiler registration helper: when
  [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings)`.UseMiniProfiler`
  is true it registers MiniProfiler plus its Entity Framework integration, otherwise it does nothing.
- **Depends on**: [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings)
  (Level 1); `StackExchange.Profiling` (NuGet).
- **Concept: opt-in, settings-gated profiling.** `[Rubric §13: Observability & Operability]`
  assesses the presence of diagnostics that do not cost anything when off. A single config flag turns
  a cross-cutting profiler on or off without touching application code.
- **Walkthrough**: `AddMiniProfilerIfEnabled(ApplicationSettings)`
  (`MiniProfilerExtensions.cs:16`): only when `UseMiniProfiler` is true (`:18`) it calls
  `AddMiniProfiler(...)` with a `/profiler` route base, popup timing, the dark color scheme, and
  `.AddEntityFramework()` so SQL/EF timings show inline (`:20-25`).
- **Why it's built this way**: gating on a settings flag rather than an `#if DEBUG` lets a specific
  environment (for example a staging slot) enable profiling without a rebuild, while production
  leaves it off to avoid the overhead.
- **Where it's used**: called from the shared `AddAPI(...)` registration path in downstream hosts.

---

### OidcDiscoveryEndpointExtensions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/OidcDiscoveryEndpointExtensions.cs:23` · Level 2 · class (static, extension block)

- **What it is**: maps a minimal OpenID Connect discovery document at
  `/.well-known/openid-configuration`. It returns just enough for token validation (the `issuer` and
  `jwks_uri` fields) so a downstream service that points its JWT authority here can auto-discover the
  signing keys. When no issuer is configured it returns 404.
- **Depends on**: [`JwksEndpointExtensions`](#jwksendpointextensions)`.DefaultJwksPath` to compose
  the `jwks_uri`; `IConfiguration` for `Jwt:Issuer`.
- **Concept: OIDC discovery as the bootstrap for JWKS-based validation ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)).** `[Rubric §7,
  Microservices Readiness]` and `[Rubric §11: Security]`: `AddForwardedJwtBearer` sets an
  `Authority`, and the JWT bearer middleware fetches `{authority}/.well-known/openid-configuration`
  on startup to learn the issuer and the JWKS URL. This endpoint answers that fetch.
- **Walkthrough**
  - `DefaultOidcDiscoveryPath` constant (`OidcDiscoveryEndpointExtensions.cs:28`).
  - Three static field arrays and an `OidcJsonOptions` with `PropertyNamingPolicy = null`
    (`:33-47`): the naming policy is disabled so snake_case field names (`jwks_uri`) survive
    serialization; the comment explains that camelCasing them would break
    `OpenIdConnectConfigurationRetriever`.
  - `MapOidcDiscoveryEndpoint()` (`:59`) maps an anonymous `GET` (`:87`) that reads `Jwt:Issuer`
    (`:63`); if blank it returns `Results.NotFound()` (`:64-67`) which is safe because no downstream
    points its authority at a non-Identity host. Otherwise it derives `jwks_uri` from the configured
    issuer (`:77`) rather than the inbound request, and returns the issuer, `jwks_uri`, and the
    supported response-types/subject-types/signing-alg arrays (`:79-86`).
- **Why it's built this way**: the long comment at `:69-76` documents the subtle reason `jwks_uri`
  is built from the configured issuer, not the request: Aspire/DCP fronts the Identity service on
  per-launchSettings ports and rewrites `Host` via `X-Forwarded-Host` to ports callers cannot reach,
  so reusing the issuer keeps issuer and `jwks_uri` origin-aligned and routes both through the same
  gateway that fronts `/Auth`.
- **Where it's used**: mapped by [`WebApplicationExtensions`](#webapplicationextensions) in the
  standard pipeline; consumed by the bearer middleware that `AddForwardedJwtBearer` configures.

---

### SignalRExtensions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/SignalRExtensions.cs:12` · Level 3 · class (static, extension block)

- **What it is**: a one-method helper that maps the
  [`NotificationHub`](group-10-notifications.md#notificationhub) SignalR endpoint at the path
  configured in [`PushNotificationSettings`](group-14-module-system-composition.md#pushnotificationsettings),
  and no-ops when push notifications are disabled or unregistered.
- **Depends on**: [`NotificationHub`](group-10-notifications.md#notificationhub) (Infrastructure),
  [`PushNotificationSettings`](group-14-module-system-composition.md#pushnotificationsettings), and
  `IOptions<T>`.
- **Concept: conditional real-time endpoint mapping.** `[Rubric §6: CQRS & Event-Driven]`: the
  SignalR hub is the real-time delivery arm of the notification pipeline, and mapping it behind a
  settings gate means a host that does not push notifications simply never opens the endpoint.
- **Walkthrough**: `MapNotificationHub()` (`SignalRExtensions.cs:22`): resolves
  `IOptions<PushNotificationSettings>` via `GetService<T>()` (returns null if never registered), and
  only when `settings is { Enabled: true }` calls `MapHub<NotificationHub>(settings.HubPath)`
  (`:24-28`). The doc comment notes it must run after `UseCommonMiddlewarePipeline()` so auth and
  routing are in place first.
- **Why it's built this way**: resolving the options with `GetService` (not `GetRequiredService`)
  and the property-pattern guard make it safe to call unconditionally in every host's `Program.cs`,
  matching the same "always call, no-op if not applicable" convention as the JWKS/OIDC mappers.
- **Where it's used**: called from a notification-capable host's `Program.cs` after the pipeline.

---

### WebApplicationBuilderExtensions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:23` · Level 3 · class (static, extension block)

- **What it is**: the consolidated **builder-side** service registration surface shared by every
  MMCA host: API versioning, rate limiting, response compression, OpenAPI, CORS, and the two JWT
  authentication modes (in-process validation and JWKS-forwarded validation). It is the sibling of
  [`WebApplicationExtensions`](#webapplicationextensions) (which owns the middleware order); this one
  owns what goes into the DI container.
- **Depends on**: [`JwtSettings`](group-14-module-system-composition.md#jwtsettings) and its
  `JwtSigningAlgorithm`; `MMCA.Common.API.Authorization` (`AddAuthorizationPolicies`);
  ASP.NET rate-limiting/compression/CORS/versioning primitives; `Microsoft.IdentityModel.Tokens`.
- **Concept introduced: per-user global rate limiting and algorithm-pinned JWT validation.**
  `[Rubric §12: Performance & Scalability]` (rate limiting protects capacity), `[Rubric §11,
  Security]` (algorithm pinning, HTTPS metadata), and `[Rubric §9: API & Contract Design]`
  (versioning, OpenAPI, compression as consistent cross-host contract concerns).
- **Walkthrough**: the interesting members:
  - `IsRateLimitBypassed(HttpContext)` (`WebApplicationBuilderExtensions.cs:35`): `internal` (so it
    is unit-testable via `InternalsVisibleTo` rather than only under a flood): bypasses `/health`,
    `/alive`, `/.well-known/*`, and `application/grpc` traffic, all legitimately high-frequency.
  - `GlobalRateLimitPartition(...)` (`:45`): returns a `NoLimiter` for bypassed infrastructure and
    for anonymous callers (`:47-55`), and otherwise a per-user fixed-window limiter keyed by
    name → `user_id` claim → IP (`:57-68`). The comment on `AddCommonRateLimiting` (`:96-107`)
    explains why anonymous traffic is deliberately not limited (public endpoints are output-cached,
    login brute-force is handled elsewhere, and Blazor Server anonymous traffic shares the UI host's
    IP).
  - `AddCommonApiVersioning()` (`:76`): header-based versioning (`api-version`), v1.0 default.
  - `AddCommonRateLimiting(...)` (`:108`): installs the global limiter plus named
    `FixedPolicy`/`UserPolicy` limiters for opt-in `[EnableRateLimiting]` use; rejection status is
    `429` (`:111`).
  - `AddCommonResponseCompression()` (`:141`): Brotli + Gzip for HTTPS, both at
    `CompressionLevel.Fastest` (the comment at `:151-153` justifies Fastest on fractional-vCPU hosts).
  - `AddCommonOpenApi()` (`:166`): registers the built-in OpenAPI generator (pair with
    [`OpenApiEndpointExtensions`](#openapiendpointextensions)).
  - `AddForwardedJwtBearer(authority, audience, requireHttpsMetadata=false)` (`:187`): the
    **extracted-service** mode: trusts an external Identity service's JWKS via OIDC authority
    discovery, deliberately leaves `ValidIssuer` unset so the middleware takes it from the discovery
    document (`:208-213`), and pins `ValidAlgorithms` to RS256 as defense against an
    algorithm-confusion swap (`:215-221`). It also installs the SignalR `access_token` query-string
    fallback for `/hubs` (`:225-238`).
  - `AddCommonAuthentication(IConfiguration)` (`:257`): the **in-process** mode: binds/validates
    `JwtSettings` on start (`:259-262`) and builds validation parameters via
    `BuildValidationParameters` (`:345`), which supports both RS256 (public key from
    `RsaPublicKeyPem`) and the default HS256 (Base64 HMAC secret), each with a matching
    `ValidAlgorithms` pin.
  - `AddCommonCors(IConfiguration)` (`:300`): a restrictive named policy for production (origins
    from `Cors:AllowedOrigins`) and an open one for development.
  - `GetValidatedSigningKey(string)` (`:326`): decodes the Base64 HMAC key and throws if it is
    under 256 bits, so a too-short secret fails fast at startup.
- **Why it's built this way**: two authentication entry points (`AddForwardedJwtBearer` vs
  `AddCommonAuthentication`) are the framework's monolith-to-microservice hinge ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)): the
  monolith validates in-process with a shared secret or local key, an extracted service validates
  against the issuer's published JWKS with no shared secret. The RS256 pin on both paths is
  deliberate defense-in-depth.
- **Where it's used**: called in each host's `WebApplicationBuilder` setup, before the middleware
  pipeline is configured by [`WebApplicationExtensions`](#webapplicationextensions).
- **Caveats / not-in-source**: the `perUserPermitLimit`/`permitLimit`/`globalPermitLimit` defaults
  (`:108`) are the framework defaults; the effective limits per deployment are set by callers and are
  not determinable from this file alone.

---

### IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityDTOMapper.cs:14` · Level 4 · interface

- **What it is**: the contract for mapping a domain entity to its DTO. It declares `MapToDTO(entity)`
  and ships a default `MapToDTOs(collection)` that fans `MapToDTO` across a collection.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (constraint), [`IBaseDTO<TIdentifierType>`](#ibasedtotidentifiertype) (constraint).
- **Concept introduced: manual DTO mapping ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)).** `[Rubric §16: Maintainability]`: the
  framework maps by hand in classes implementing this interface rather than using AutoMapper, so a
  missing mapping is a compile error, not a runtime surprise. `[Rubric §1: SOLID]`: the interface is
  single-purpose (ISP), and the default `MapToDTOs` (`IEntityDTOMapper.cs:27-32`) is a C# default
  interface method, so concrete mappers inherit batch mapping for free and only override it when a
  bulk-lookup optimization is worth it `[Rubric §2: Design Patterns]`.
- **Walkthrough**: the triple-generic constraints (`IEntityDTOMapper.cs:15-17`) force the entity and
  DTO to agree on the identifier type and require it be `notnull`, so a structurally unsound mapper
  will not compile. `MapToDTO(TEntity)` (`:22`) is the one required member; `MapToDTOs(...)` (`:27`)
  null-guards then projects with `Select` into a read-only collection.
- **Why it's built this way**: see [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html): compile-time discoverability over reflective convenience.
  Scrutor auto-registers every implementation as scoped during the module scan.
- **Where it's used**: implemented by every concrete `*DTOMapper` in the ADC and Store Application
  layers; consumed by query handlers and entity read services.

---

### IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityDTOMapper.cs:42` · Level 4 · interface

- **What it is**: the create-side counterpart to
  [`IEntityDTOMapper`](#ientitydtomappertentity-tentitydto-tidentifiertype): it maps an incoming
  create request to a domain entity through the entity's factory method, returning
  `Task<Result<TEntity>>` so async validation (for example a uniqueness check) can run before the
  entity exists. It is declared in the **same file** as `IEntityDTOMapper`, so one file owns both
  mapping directions.
- **Depends on**: [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  (constraint), [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) (constraint),
  [`Result<T>`](group-01-result-error-handling.md#result) (return).
- **Concept: request-to-entity mapping with async validation.** `[Rubric §1: SOLID]` (SRP:
  separating create-mapping from read-mapping) and `[Rubric §9: API & Contract Design]` (the
  `ICreateRequest` constraint tags a DTO as a create payload so it cannot be passed to a read path).
  The async `Task<Result<TEntity>>` signature is the load-bearing detail: creation may need a
  database round-trip (a duplicate check) before the factory method runs, and any failure surfaces as
  an [`Error`](group-01-result-error-handling.md#result) instead of an exception.
- **Walkthrough**: one member, `CreateEntityAsync(TCreateRequest request, CancellationToken)`
  (`IEntityDTOMapper.cs:54`). Implementations call the entity's `Create(...)` factory and return its
  `Result`, threading validation errors through unchanged.
- **Why it's built this way**: same [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html) rationale: explicit, compile-checked mapping. Keeping it
  in the same file as the read mapper documents that a module supplies both directions per entity.
- **Where it's used**: implemented by concrete `*RequestMapper` classes; consumed by the generic
  create-command handlers.

---

### WebApplicationExtensions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:16` · Level 4 · class (static, extension block)

- **What it is**: the `extension(WebApplication app)` type that defines the canonical middleware
  pipeline (`UseCommonMiddlewarePipeline`) plus the request-localization and culture-switch endpoints,
  so every downstream host wires middleware in exactly one order. It is the runtime-side sibling of
  [`WebApplicationBuilderExtensions`](#webapplicationbuilderextensions) (registration side).
- **Depends on**: [`CorrelationIdMiddleware`](#correlationidmiddleware),
  [`SoftDeletedUserMiddleware`](#softdeletedusermiddleware),
  [`WebApplicationBuilderExtensions`](#webapplicationbuilderextensions) (CORS policy names),
  [`JwksEndpointExtensions`](#jwksendpointextensions), [`OidcDiscoveryEndpointExtensions`](#oidcdiscoveryendpointextensions),
  and [`SupportedCultures`](#supportedcultures); ASP.NET forwarded-headers/localization primitives.
- **Concept: one canonical, ordered pipeline.** `[Rubric §10: Cross-Cutting Concerns]` and
  `[Rubric §13: Observability]`: the order is load-bearing (correlation must be set before anything
  downstream logs, auth must run before rate limiting so the per-user partition sees a principal).
  `[Rubric §27: i18n]` also applies through the localization wiring ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Walkthrough**
  - Two internal constants, `PreForwardedSchemeKey` (`WebApplicationExtensions.cs:24`) and
    `PreForwardedHostKey` (`:35`), capture the transport scheme and host **before**
    `UseForwardedHeaders` rewrites them; the OIDC discovery endpoint needs the pre-forwarded values
    because Aspire/DCP injects an `X-Forwarded-Host` that internal callers cannot reach.
  - `UseCommonMiddlewarePipeline()` (`:45`) wires, in order: exception handler → correlation-id
    middleware → request localization → forwarded headers (with `KnownProxies`/`KnownIPNetworks`
    cleared for cloud proxies, `:63-64`) → a capture step storing the pre-forwarded scheme/host
    (`:72-77`) → HTTPS redirect *skipped for `application/grpc`* so h2c gRPC is not broken
    (`:87-89`) → response compression → routing → CORS (dev vs prod policy, `:93-95`) → authentication
    → rate limiter (after auth on purpose per [ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html), `:96-101`) → soft-deleted-user middleware →
    authorization → output cache → the always-mapped `MapJwksEndpoint()`/`MapOidcDiscoveryEndpoint()`
    (`:111-112`) → `MapControllers()` (`:114`).
  - `UseCommonRequestLocalization()` (`:126`) adds `RequestLocalization` for
    [`SupportedCultures`](#supportedcultures) and, in Development only, the pseudo-locale
    (`:133-136`); Blazor UI hosts call it explicitly before `MapRazorComponents`.
  - `MapCultureEndpoint()` (`:155`) maps the anonymous `GET /culture/set` that writes the ASP.NET
    culture cookie (non-HttpOnly so the WASM client can read it) and local-redirects to force a full
    reload (`:160-179`).
- **Why it's built this way**: centralizing the order means a host cannot accidentally place rate
  limiting before auth or forget forwarded-headers handling; the JWKS/OIDC endpoints are mapped
  unconditionally so a non-Identity host degrades to an empty key set / 404 rather than diverging.
- **Where it's used**: called once per host `Program.cs` after `app.Build()`.

---

### DatabaseInitializationExtensions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:17` · Level 8 · class (static)

- **What it is**: the shared startup routine that, per **physical data source**, creates or migrates
  the schema and then runs each enabled module's seeder.
- **Depends on**: [`IEntityDataSourceRegistry`](group-07-persistence-ef-core.md#ientitydatasourceregistry),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver),
  [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory),
  [`DataSourceKey`](group-07-persistence-ef-core.md#datasourcekey),
  [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings), and
  [`ModuleLoader`](group-14-module-system-composition.md#moduleloader).
- **Concept: strategy-driven, per-source database initialization.** `[Rubric §8: Data
  Architecture]` and `[Rubric §17: DevOps & Deployment]`: because of database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html))
  every physical source a host touches is initialized independently, and the strategy chosen is what
  makes the difference between a permissive dev host and a production host that refuses to start
  against a stale schema.
- **Walkthrough**: `InitializeDatabaseAsync(...)` (`DatabaseInitializationExtensions.cs:27`):
  - Null-guards its arguments and opens a scope (`:33-37`).
  - **Warms the entity registry** by resolving `IEntityDataSourceRegistry` and calling
    `GetPhysicalSourcesInUse()` (`:42-44`), so entity-to-database routing is deterministic before the
    first repository call rather than a lazy model-building side effect.
  - For every Cosmos/SQLite source in use that has a connection string, always `EnsureCreatedAsync`
    (`:54-64`): those engines have no EF migrations, and the comment notes this is the only path that
    creates a SQLite source under the `Migrate`/`None` strategies.
  - `switch`es on `ApplicationSettings.DatabaseInitStrategy` (`:70-85`): `"Migrate"` applies pending
    EF migrations per SQL source (dev/test); `"EnsureCreated"` is the legacy path; `"None"`
    (production) calls `ThrowIfPendingMigrationsAsync`; anything else throws with the valid values.
  - Finally runs `moduleLoader.SeedAllAsync(...)` for every enabled module (`:87`).
  - `ThrowIfPendingMigrationsAsync(...)` (`:94`) is the production safety rail: if any SQL source has
    unapplied migrations it throws with a per-source breakdown of exactly which migrations are behind
    (`:104-117`).
- **Why it's built this way**: one shared init path keeps every downstream service consistent, and
  the `"None"`-strict-validate strategy is the deploy-time guarantee that the app never serves traffic
  against an un-migrated database (migrations are applied by the deploy pipeline, not the app).
- **Where it's used**: called from each service host's `Program.cs` after `app.Build()`, before the
  host begins serving.

### IBaseDTO<TIdentifierType>
> MMCA.Common.Shared · `MMCA.Common.Shared.DTOs` · `MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/IBaseDTO.cs:9` · Level 0 · interface

- **What it is**: a one-property marker interface. Every DTO that carries an entity identifier exposes `TIdentifierType Id { get; init; }` (`IBaseDTO.cs:13`).
- **Depends on**: nothing first-party, and nothing external beyond the generic constraint. It lives in `MMCA.Common.Shared`, the bottom layer, so a Blazor WebAssembly client and an EF-backed service can both reference it.
- **Concept introduced (the DTO and the marker/role interface).** `[Rubric §9, API & Contract Design]` (assesses DTOs decoupled from domain entities and stable wire contracts): a **DTO** (Data Transfer Object) is the shape that crosses the wire, deliberately separate from the domain entity. `IBaseDTO` lets generic machinery treat *any* DTO uniformly through its `Id`, which is what makes a single generic read service, a single generic controller base, and a single generic UI service possible instead of one hand-written trio per entity. This is also `[Rubric §1, SOLID]`: a textbook **Interface Segregation** interface, with one member (the only thing a generic consumer needs), so clients never depend on more than they use.
- **Walkthrough**: generic over `TIdentifierType` with a `where TIdentifierType : notnull` constraint (`IBaseDTO.cs:10`); the single `Id` is `get; init;` (`IBaseDTO.cs:13`), settable at construction and immutable after. The `init`-not-`set` choice recurs across these contracts (see the primer on [immutability with `required`/`init`](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Why it's built this way**: making the identifier type a generic parameter, rather than hard-coding `int`, lets a DTO match its entity's strongly-typed id alias (see [identifier aliases](00-primer.md#2-architectural-styles-this-codebase-commits-to)), so a `Guid`-keyed aggregate and an `int`-keyed one share the same generic pipeline; the `notnull` constraint forbids `Id` being a nullable type, which keeps the generic code free of null checks on the one value it always needs.
- **Where it's used**: the constraint on every generic read/write pipeline in the framework, all four of them declaring the same `where TEntityDTO : IBaseDTO<TIdentifierType>` line: [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityQueryService.cs:21`), [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](#ientitydtomappertentity-tentitydto-tidentifiertype) (`.../IEntityDTOMapper.cs:16`), [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:36`), and [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype) (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IEntityService.cs:13`). Implemented directly by [`BaseLookup<TIdentifierType>`](#baselookuptidentifiertype) and by shipped DTOs such as [`PushNotificationDTO`](group-10-notifications.md#pushnotificationdto) (`MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/PushNotifications/PushNotificationDTO.cs:8`), plus every module DTO in ADC and Store.

### IConcurrencyAware
> MMCA.Common.Shared · `MMCA.Common.Shared.DTOs` · `MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/IConcurrencyAware.cs:13` · Level 0 · interface

- **What it is**: a contract for DTOs and update requests that round-trip an **optimistic-concurrency token** (`byte[]? RowVersion`).
- **Depends on**: nothing first-party. It is the wire-side half of a pair whose persistence-side half is [`IWriteRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#iwriterepositorytentity-tidentifiertype)`.SetOriginalRowVersion`.
- **Concept introduced (optimistic concurrency).** `[Rubric §8, Data Architecture]` (assesses deliberate persistence: transactions, migrations, soft-delete, audit, and **concurrency control**). SQL Server's `rowversion` is a token the database changes on every update of a row. A read DTO exposes the current `RowVersion` so the client can echo it back on the next update; an update request carries the client's last-seen value so the persistence layer can detect a conflicting concurrent edit and return `409 Conflict` instead of silently overwriting. The doc comment (`IConcurrencyAware.cs:9-12`) spells out exactly the failure mode being prevented: without the round-trip an update loads the row fresh and saves it, so two concurrent editors overwrite each other (last-write-wins) and the mapped `409` never fires.
- **Walkthrough**: one property, `byte[]? RowVersion { get; init; }` (`IConcurrencyAware.cs:20`). It is nullable so that creation and legacy clients (which send nothing) **skip** the conflict check; the enforcement end honors the same rule, since `EFRepository.SetOriginalRowVersion` returns early on `rowVersion is not { Length: > 0 }` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:82-83`) and otherwise writes the client's bytes into EF's `OriginalValue` for the tracked entity's `RowVersion` property (`EFRepository.cs:85-87`). Note the `[SuppressMessage("Performance", "CA1819")]` on `IConcurrencyAware.cs:19`: exposing a `byte[]` property normally trips the "properties should not return arrays" analyzer rule, but it is required to round-trip the EF token, and the suppression is *justified inline* (`[Rubric §15, Best Practices]`: suppressions are tracked and explained, not blanket-disabled).
- **Why it's built this way**: concurrency control is opt-in per DTO through this interface ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)), so only contended resources pay the extra wire bytes and the client-side echo discipline. Keeping the contract in `Shared` means the same interface is visible to the Blazor client that must echo the token and to the Infrastructure repository that consumes it.
- **Where it's used**: implemented by [`ConcurrencyTokenRequest`](#concurrencytokenrequest) in the framework, and by module-local equivalents in the apps: ADC's `LifecycleTransitionRequest` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/LifecycleTransitionRequest.cs:15`) and `EventTransitionRequest` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/EventTransitionRequest.cs:14`). There is a second, child-level enforcement overload that takes any [`IRowVersioned`](group-02-domain-building-blocks.md#irowversioned) entity (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:185`), so a child edit under an aggregate root gets the same protection.

### SupportedCultures
> MMCA.Common.Shared · `MMCA.Common.Shared.Globalization` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Globalization/SupportedCultures.cs:9` · Level 0 · class (static)

- **What it is**: the framework-wide allowlist of supported UI cultures ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). A static class holding the default culture, the full supported set, the Development-only pseudo-localization locale, and two membership tests.
- **Depends on**: nothing first-party. Uses only BCL types (`IReadOnlyList<string>`, `StringComparison`).
- **Concept introduced (internationalization allowlist as one source of truth).** `[Rubric §27, i18n]` (assesses whether locale support is centralized, discoverable, and drift-resistant rather than scattered string checks). Every consumer that decides "is this a language we support" reads this one list: the host request-localization setup, the culture switcher, and the Identity `PreferredCulture` guard. Adding a locale means adding a `.<culture>.resx` sibling set plus one entry here, with no other infrastructure change (`SupportedCultures.cs:3-8`).
- **Walkthrough**
  - `Default = "en-US"` (`SupportedCultures.cs:12`) is the fallback used when no cookie, profile, or `Accept-Language` preference resolves.
  - `All` (`SupportedCultures.cs:18`) is the supported set, default first, and today it is exactly `[Default, "es"]`: English and Spanish. Both the request-localization options and the culture switcher iterate it.
  - `PseudoLocale = "qps-Ploc"` (`SupportedCultures.cs:28`) is the Windows-standard pseudo-localization locale, deliberately **not** part of `All` so the translation-completeness fitness gate does not demand a `.qps-Ploc.resx` sibling. It is wired into request localization and the culture switcher in **Development only**, where it runtime-transforms every resolved resource string (accents, padding, bracket sentinel) to surface hard-coded strings, truncation, and string concatenation without translating anything.
  - `IsSupported(string?)` (`SupportedCultures.cs:35`) returns true for a non-empty culture matched case-insensitively against `All`; `IsPseudoLocale(string?)` (`SupportedCultures.cs:44`) tests case-insensitively against `PseudoLocale`. Both take a nullable string so callers can pass an unvalidated cookie, query value, or profile field straight in.
- **Why it's built this way**: a single `const` plus `IReadOnlyList` allowlist keeps the localization middleware, the switcher UI, the fitness gate, and the profile guard from drifting apart; separating `PseudoLocale` from `All` lets a diagnostic locale ship in Development without polluting the production culture set or the resx-completeness gate. See [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) for the culture-resolution and pseudo-localization decision.
- **Where it's used**: [`WebApplicationExtensions`](#webapplicationextensions)`.UseCommonRequestLocalization` builds the supported list from `All`, appends `PseudoLocale` only outside Production, and sets `Default` as the default culture (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:128-141`); the culture-switch endpoint validates the incoming value with `IsSupported`/`IsPseudoLocale` (`WebApplicationExtensions.cs:162`). On the client side, [`MmcaCultureBootstrap`](group-15-common-ui-framework.md#mmcaculturebootstrap) falls back to `Default` when the stored culture is not supported (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/MmcaCultureBootstrap.cs:30`) and [`PseudoStringLocalizer`](group-15-common-ui-framework.md#pseudostringlocalizer) activates only under `IsPseudoLocale` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/PseudoStringLocalizer.cs:17`). The fitness gate [`LocalizationResourceTests`](group-27-testing-infrastructure.md#localizationresourcetests) derives its required-culture set from `All` minus `Default` (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/LocalizationResourceTests.cs:15-16`), so adding a culture here automatically extends the coverage requirement. Both apps' `UserInvariants` validate a user's preferred culture through `IsSupported` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserInvariants.cs:78`, `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/UserInvariants.cs:64`).

### BaseLookup<TIdentifierType>
> MMCA.Common.Shared · `MMCA.Common.Shared.DTOs` · `MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/BaseLookup.cs:8` · Level 1 · record class

- **What it is**: a minimal DTO for dropdown and autocomplete lookups: just `Id` and `Name`.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](#ibasedtotidentifiertype) (Level 0), which it implements.
- **Concept (right-sized response shapes).** `[Rubric §9, API & Contract Design]` (assesses whether responses are shaped to their consumer rather than dumping full entities). Instead of returning a full entity DTO to populate a `<select>` element, the system returns `BaseLookup<T>`, carrying only the id and the display name; this cuts wire size and avoids coupling the UI to full entity shapes it does not need. Both `Id` (`BaseLookup.cs:12`) and `Name` (`BaseLookup.cs:15`) are `required`, so hand-written construction is compile-checked, and record equality gives value semantics for free (see [record value objects](group-02-domain-building-blocks.md#currency)).
- **Walkthrough**: the type itself is four lines, but its interesting half lives in the repository that projects into it. [`EFReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#efreadrepositorytentity-tidentifiertype)`.GetAllForLookupAsync` takes the *name* of the display property, resolves a cached projection expression, and lets the database do the shaping: `.Select(selector).OrderBy(l => l.Name)` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:85-91`). The selector is built once per `(entity type, property name)` pair into a `ConcurrentDictionary` (`EFReadRepository.cs:99`, `:104-126`), binding `Id` and the named property into a `BaseLookup<TIdentifierType>` via `Expression.MemberInit` (`:120-123`) and coalescing a null string to empty (`:113-114`). Note the consequence for `required`: an expression-tree `MemberInit` constructs the record without the compiler's required-member check, which is legal because `required` is a compile-time contract, not a runtime one. Above the repository the shape travels as a [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt) through [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype)`.GetAllForLookupAsync` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:157-169`).
- **Why it's built this way**: one shared lookup shape means the UI's generic select components bind to a single type regardless of which entity fills them, and projecting inside the SQL query (rather than materializing entities and mapping) keeps a lookup list cheap `[Rubric §12, Performance & Scalability]`.
- **Where it's used**: returned by the lookup path at every layer: `IEntityQuerier<TEntity, TIdentifierType>.GetAllForLookupAsync` (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:87`, the focused collection-query interface declared at `IRepository.cs:64`), [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)`.GetAllForLookupAsync` (`.../IEntityQueryService.cs:82`), the controller base (`EntityControllerBase.cs:157`), and the UI's [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype) (`.../IEntityService.cs:33`), which deserializes it back out of the HTTP response (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:90-99`).

### ConcurrencyTokenRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.DTOs` · `MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/ConcurrencyTokenRequest.cs:12` · Level 1 · record class (sealed)

- **What it is**: the reusable request body for lifecycle and state-transition endpoints (publish, cancel, open, approve, and so on) whose *only* payload is the optimistic-concurrency token.
- **Depends on**: [`IConcurrencyAware`](#iconcurrencyaware) (Level 0), which it implements and from which `RowVersion` is inherited via `<inheritdoc />` (`ConcurrencyTokenRequest.cs:14-15`).
- **Concept (the token-only request body).** This is the same optimistic-concurrency idea introduced by [`IConcurrencyAware`](#iconcurrencyaware), narrowed to the case where a state transition carries no other data. `[Rubric §9, API & Contract Design]`: rather than each module inventing its own single-property transition record, one shipped shape covers every such endpoint. The doc comment (`ConcurrencyTokenRequest.cs:3-11`) also pins the binding contract: bind it as an **optional** body (`EmptyBodyBehavior.Allow`) so body-less legacy callers keep working and simply skip the stale-view check, and a null `RowVersion` skips it too.
- **Walkthrough**: the entire type is `public sealed record class ConcurrencyTokenRequest : IConcurrencyAware` (`ConcurrencyTokenRequest.cs:12`) with one `byte[]? RowVersion { get; init; }` (`:15`). Sealed because there is nothing to specialize; a record because value equality and the `with` expression cost nothing here and match the rest of the DTO family.
- **Why it's built this way**: [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html) decided that a transition decided against a stale view of the aggregate must surface as `409 Conflict` rather than applying silently (two moderators racing approve-versus-dismiss, two speakers racing open-versus-close). Making the body optional rather than required is the compatibility hinge: the endpoint's protection is additive, so an old client that posts nothing still transitions, protected only by the domain state machine on the freshly loaded aggregate.
- **Where it's used**: **no consumer binds it today.** ADC still declares its own structurally identical copies, `LifecycleTransitionRequest` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/LifecycleTransitionRequest.cs:15`) and `EventTransitionRequest` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/EventTransitionRequest.cs:14`), each carrying a comment that it is "superseded by MMCA.Common's `ConcurrencyTokenRequest` at the next framework sweep" (`LifecycleTransitionRequest.cs:13`, `EventTransitionRequest.cs:12`). This is the framework offering the shape ahead of the consumers adopting it.
- **Caveats / not-in-source**: the `EmptyBodyBehavior.Allow` binding is a documented instruction to callers (`ConcurrencyTokenRequest.cs:8`), not something this type can enforce; whether a given endpoint actually binds it optionally is determined at that endpoint's action signature, in the consuming app.

### CorrelationContext
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/CorrelationContext.cs:9` · Level 1 · class (sealed)

- **What it is**: the scoped service that holds the correlation ID for the current request, defaulting to a fresh GUID when no middleware sets one.
- **Depends on**: [`ICorrelationContext`](#icorrelationcontext) (Level 0, `MMCA.Common.Application.Interfaces`), the abstraction it implements (`CorrelationContext.cs:1`, `:9`). Uses BCL `Guid` only.
- **Concept introduced (request correlation for observability).** `[Rubric §13, Observability & Operability]` (assesses whether requests can be traced end to end through logs and across service boundaries). A **correlation ID** is a single value stamped on every log line and propagated call for one logical request, so operators can reassemble a distributed trace from disjoint logs. `[Rubric §3, Clean Architecture]` also applies: the abstraction lives in Application (`ICorrelationContext.cs:8`) so handlers and decorators depend on the interface, while the concrete holder sits in Infrastructure, keeping the dependency arrow pointing inward.
- **Walkthrough**: `CorrelationId` (`CorrelationContext.cs:12`) is `{ get; private set; }`, initialized eagerly to `Guid.NewGuid().ToString("N")` so a value always exists even if no middleware runs (a background processor, a test path, a gRPC call). `SetCorrelationId(string)` (`CorrelationContext.cs:15-19`) overwrites it, guarding the input with `ArgumentException.ThrowIfNullOrWhiteSpace` (`:17`) so a blank header can never wipe the ID. The private setter means the only write path is that one guarded method. Registration is `services.TryAddScoped<ICorrelationContext, CorrelationContext>()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:187`): scoped, so one instance lives per request, and `TryAdd`, so a host that wants its own implementation can register it first and win.
- **Why it's built this way**: a scoped holder with an eager default keeps correlation always-on and cheap: every code path has an ID without a null check, and inbound requests still adopt the caller's ID for cross-service tracing. The `"N"` GUID format (32 hex digits, no hyphens) keeps the value compact in log lines and headers.
- **Where it's used**: [`CorrelationIdMiddleware`](#correlationidmiddleware) resolves it per request and calls `SetCorrelationId` with the inbound `X-Correlation-ID` header, falling back to the current `Activity` trace ID and then to `HttpContext.TraceIdentifier` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/CorrelationIdMiddleware.cs:32-36`), then echoes the value back on the response (`:37-41`). Downstream, [`LoggingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#loggingcommanddecoratortcommand-tresult) (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/LoggingCommandDecorator.cs:16`) and [`LoggingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#loggingquerydecoratortquery-tresult) (`.../LoggingQueryDecorator.cs:15`) take it as a constructor dependency and wrap the ID into their log scope for the full pipeline duration.

### CurrencyJsonConverter
> MMCA.Common.API · `MMCA.Common.API.JsonConverters` · `MMCA.Common/Source/Presentation/MMCA.Common.API/JsonConverters/CurrencyJsonConverter.cs:12` · Level 4 · class (sealed)

- **What it is**: a `System.Text.Json.JsonConverter<Currency>` that serializes [`Currency`](group-02-domain-building-blocks.md#currency) as its ISO 4217 three-letter code string and deserializes by validating that code through `Currency.FromCode`.
- **Depends on**: [`Currency`](group-02-domain-building-blocks.md#currency) (`MMCA.Common.Shared.ValueObjects`). Extends BCL `JsonConverter<T>` (`CurrencyJsonConverter.cs:12`).
- **Concept (value objects serialize to their natural string form).** `[Rubric §9, API & Contract Design]` (assesses whether the wire contract exposes clean primitives rather than leaking internal object graphs). A domain value object should cross the wire as the compact primitive a client expects (`"USD"`), not as a nested object with a `code` property. The converter is also a validation gate at the boundary: malformed input is rejected before model binding completes, so no handler ever sees an invalid currency.
- **Walkthrough**
  - `Read` (`CurrencyJsonConverter.cs:15`) first rejects any non-string token, throwing `JsonException("Currency must be a string.")` (`:17-18`), which is what stops a JSON number or object from being coerced.
  - It then reads the string, coalescing null to empty (`:20`), runs `Currency.FromCode(code)` (`:21`), and throws `JsonException($"Invalid currency code: {code}")` when the result is a failure (`:22-23`) before returning `result.Value!` (`:25`). Because `FromCode` returns a [`Result`](group-01-result-error-handling.md#result), the converter is bridging the Result world into the exception-based contract `JsonConverter<T>` requires; the thrown `JsonException` surfaces as a `400 Bad Request` from the framework's model binding (doc comment, `:9-10`).
  - `Write` (`CurrencyJsonConverter.cs:29-30`) is a one-liner: `writer.WriteStringValue(value.Code)`.
  - The type is sealed, holds no state, and has exactly these two methods (`[Rubric §15, Best Practices]`: the framework-idiomatic converter pattern).
- **Why it's built this way**: routing (de)serialization through `Currency.FromCode` keeps the single validation gate for currency codes in the value object itself (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Currency.cs:41-51`, which matches case-insensitively against the closed `All` set), so the API layer neither duplicates the allowlist nor accepts a `Currency` the domain would reject.
- **Where it's used**: registered globally for MVC in [`DependencyInjection`](#dependencyinjection)`.AddAPI`, which chains `.AddJsonOptions(options => options.JsonSerializerOptions.Converters.Add(new CurrencyJsonConverter()))` onto `AddControllers` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:49`), so every controller request and response serializes `Currency` as a string uniformly.
- **Caveats / not-in-source**: there is a **second, same-named converter** in the Shared layer, [`CurrencyJsonConverter`](group-02-domain-building-blocks.md#currencyjsonconverter) (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Currency.cs:65`), attached to the value object by `[JsonConverter(typeof(CurrencyJsonConverter))]` (`Currency.cs:13`) so that non-MVC serialization paths (the UI's `HttpClient` calls, WebAssembly) also get string form. The two differ in behavior: the Shared one returns `null` for a null token and does not reject non-string tokens (`Currency.cs:68-72`), while this API one rejects any non-string token outright (`CurrencyJsonConverter.cs:17-18`). Which of the two wins for a given payload is a `System.Text.Json` converter-precedence question (an options-registered converter versus a type-level attribute) and is not determinable from this source alone.


---
[⬅ Navigation Metadata & Populators (EF-decoupled eager loading)](group-11-navigation-populators.md)  •  [Index](00-index.md)  •  [gRPC & Inter-Service Contracts ➡](group-13-grpc-contracts.md)
