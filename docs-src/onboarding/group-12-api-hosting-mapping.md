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
RFC 9457 Problem Details; the **controller hierarchy** that hands a module ready-made CRUD, export,
auth, and service-discovery endpoints; the **contract surface** (DTO/request mapping, JSON conversion,
model binding, idempotency, correlation, tenancy, feature gating); and the **well-known endpoints**
that make an extracted service self-describing. Read the group as the reusable ASP.NET host a
downstream service (Store, ADC, Helpdesk, or an extracted microservice) drops into place so its own
code is nothing but modules. Its central rubric column is [Rubric §9, API & Contract Design]
(consistent, versioned, standardized contracts and error shapes), with heavy supporting roles for
[Rubric §10, Cross-Cutting Concerns], [Rubric §11, Security], [Rubric §13, Observability &
Operability], [Rubric §7, Microservices Readiness], and (since
[ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html))
[Rubric §27, Internationalization].

**The composition root: `AddAPI` plus the builder extensions.** A host wires the edge through two
static extension classes. [`DependencyInjection`](#dependencyinjection)'s `AddAPI`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:44`) registers MVC
controllers with the global [`UnhandledResultFailureFilter`](#unhandledresultfailurefilter)
(`DependencyInjection.cs:49`), wires two JSON converters into the serializer options, the
[`CurrencyJsonConverter`](#currencyjsonconverter) (`DependencyInjection.cs:53`) and the
[`EnumerationJsonConverterFactory`](group-02-domain-building-blocks.md#enumerationjsonconverterfactory)
(`DependencyInjection.cs:58`, registered here because a concrete enumeration does not inherit the base
class's `[JsonConverter]` attribute), adds the XML formatters (`DependencyInjection.cs:60`), optionally
installs the [`ModuleControllerFeatureProvider`](#modulecontrollerfeatureprovider) when a
[`ModulesSettings`](group-14-module-system-composition.md#modulessettings) instance is supplied
(`DependencyInjection.cs:62-66`), binds [`IdempotencySettings`](#idempotencysettings) with
`ValidateDataAnnotations().ValidateOnStart()` when configuration is supplied
(`DependencyInjection.cs:68-74`,
[ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)), registers
the two scoped action filters [`IdempotencyFilter`](#idempotencyfilter) and
[`OwnerOrAdminFilter`](group-08-auth.md#owneroradminfilter) (`DependencyInjection.cs:77-78`, scoped
because they depend on scoped services), turns on feature management with
[`DisabledFeatureHandler`](#disabledfeaturehandler) (`DependencyInjection.cs:83-84`), and registers the
edge error-localization boundary (`AddErrorLocalization`, `DependencyInjection.cs:87` and `:98`, with
`AddErrorResources<TResource>` at `:113` for each module's own `.resx` set). Three sibling methods on
the same class complete the picture: `AddCommonExceptionHandlers` (`DependencyInjection.cs:126`)
registers the Problem Details service and the five exception handlers in most-specific-first order
(`:131-135`), `AddServerAuthSessionCookie` (`DependencyInjection.cs:151`) registers the Blazor Server
host's SSR cookie reader ([`CookieTokenReader`](group-08-auth.md#cookietokenreader), `:157`) plus the
singleton [`CookieSessionRefresher`](group-08-auth.md#cookiesessionrefresher) (`:163`, singleton so its
in-flight map is shared across requests), and `AddModuleHealthChecks` (`DependencyInjection.cs:179`)
turns [`ModuleLoader`](group-14-module-system-composition.md#moduleloader) discovery results into
`module-{Name}` health checks, tagged `module` so `/health?tag=module` filters them (Healthy for
enabled modules at `:183-189`, Degraded for disabled ones at `:191-198`).
[`WebApplicationBuilderExtensions`](#webapplicationbuilderextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:26`)
carries the identical builder-side setup every service shares: header-based API versioning through the
`api-version` header (`AddCommonApiVersioning`, line 115, reader at line 124, v1.0 assumed when the
header is absent at line 122,
[ADR-046](https://ivanball.github.io/docs/adr/046-http-api-versioning.html)), rate limiting
(`AddCommonRateLimiting`, line 162), Brotli and Gzip compression at `CompressionLevel.Fastest`
(`AddCommonResponseCompression`, line 207, both providers pinned to `Fastest` at lines 215-216 and
220-221 because these are dynamic per-request payloads on fractional vCPUs), OpenAPI (line 236), CORS
(line 387, [ADR-082](https://ivanball.github.io/docs/adr/082-two-tier-cors-posture.html), with the two
policy names as constants at lines 29 and 32), and the two JWT bearer registrations: in-process
`AddCommonAuthentication` (line 344) for the Identity host and `AddForwardedJwtBearer` (line 274) for
extracted services that validate against a remote JWKS. Only one DI ordering rule is load-bearing in
the whole host, and it belongs to the CQRS pipeline group, not here: `AddApplicationDecorators`
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:89`) must run last so Scrutor
can decorate handlers that are already registered. The API registrations themselves are
order-independent. This is the [Rubric §9, API & Contract Design] and [Rubric §10, Cross-Cutting]
story: versioning, compression, rate limiting, and CORS are configured once and inherited by every
service instead of copy-pasted per host.

**The request pipeline, in a fixed order.**
[`WebApplicationExtensions`](#webapplicationextensions)'s `UseCommonMiddlewarePipeline`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:45`) is the
single place the middleware order is decided
([ADR-079](https://ivanball.github.io/docs/adr/079-shared-http-middleware-pipeline.html)), and the
order is deliberate: exception handling (line 47), then
[`CorrelationIdMiddleware`](#correlationidmiddleware) (48), request localization (53), forwarded
headers (79), conditional HTTPS redirect (87-89), response compression (91), routing (92), CORS
(93-95), authentication (96), [`TenantResolutionMiddleware`](#tenantresolutionmiddleware) (102), the
rate limiter (108), [`SoftDeletedUserMiddleware`](#softdeletedusermiddleware) (109), authorization
(110), output cache (111), the JWKS and OIDC discovery endpoints (118-119), and finally
`MapControllers` (121). Three of those positions are worth internalizing. The rate limiter runs
**after** authentication on purpose
([ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html), comment at
`WebApplicationExtensions.cs:104-107`): `GlobalRateLimitPartition`
(`WebApplicationBuilderExtensions.cs:57`) partitions by the authenticated principal and routes
anonymous traffic down a no-limiter branch (lines 64-67), so `HttpContext.User` must already be
populated or every request would look anonymous and the per-user cap (300 requests per minute by
default, `WebApplicationBuilderExtensions.cs:162`) would never engage; health, liveness,
`/.well-known/*`, and `application/grpc` traffic bypass the limiter outright (`IsRateLimitBypassed`,
lines 47-51). Tenant resolution sits immediately after authentication for the mirror-image reason: its
claim strategy reads `HttpContext.User` (`TenantResolutionMiddleware.cs:111`), so running it any
earlier would silently demote every request to the header strategy. And the HTTPS redirect is skipped
for any request whose content type starts with `application/grpc`
(`WebApplicationExtensions.cs:87-89`) because extracted gRPC services speak HTTP/2 cleartext (h2c) and
a 307 redirect would break the call. Forwarded-headers handling clears the known-proxy allowlists so
cloud reverse proxies are trusted regardless of their internal IPs (lines 63-64) and stashes the
pre-forward scheme and host in `HttpContext.Items` under `PreForwardedSchemeKey` and
`PreForwardedHostKey` (lines 24, 35, 72-77). `UseCommonRequestLocalization` (line 133) builds the
culture options from [`SupportedCultures`](#supportedcultures)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Globalization/SupportedCultures.cs:9`: `en-US` as the
default at line 12 and the full `en-US` plus `es` list at line 18, with the `qps-Ploc` pseudo locale at
line 28 added in Development only, `WebApplicationExtensions.cs:140-143`) so edge error localization
runs under the caller's culture, and the companion `MapCultureEndpoint` (line 162) serves the
`GET /culture/set` switch that Blazor UI hosts map
([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).

**One rate-limit policy is applied by default, and only one.** Because the global limiter deliberately
no-ops for anonymous callers and account lockout is per-email, a password spray (one password, many
email addresses) from a single source would otherwise be unthrottled. The framework closes that gap
with the named `auth-ip` policy (`RateLimitPolicyAuthIp`, `WebApplicationBuilderExtensions.cs:41`),
whose partition selector `AuthIpRateLimitPartition` (lines 93-106) is a per-client-IP fixed window
defaulting to 30 requests per minute (line 162) and fails **open** on an unattributable IP (lines
97-98) rather than collapsing every such request into one shared bucket, which would throttle the
in-process test server to a standstill. Unlike the other named limiters, this one is not left for each
app to attach: [`AuthControllerBase`](#authcontrollerbase) carries
`[EnableRateLimiting(WebApplicationBuilderExtensions.RateLimitPolicyAuthIp)]` on both `LoginAsync`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:55`) and
`RegisterAsync` (`AuthControllerBase.cs:76`), so every consumer inherits spray protection by
construction, while `RefreshAsync` (`AuthControllerBase.cs:95-99`) is deliberately left unthrottled
because refresh is periodic and automatic and Blazor Server circuits issue it server-side from one
shared host IP. A consumer that inherits the base without calling `AddCommonRateLimiting` fails at
startup on an unregistered policy, which is the loud failure rather than the silent one
([ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html) for the layering, and
[ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html) for the
brute-force half).

**Correlation, tenancy, and the soft-deleted-user gate: three ambient facts established once.**
[`CorrelationIdMiddleware`](#correlationidmiddleware)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/CorrelationIdMiddleware.cs:15`) reads the
`X-Correlation-ID` request header (the constant lives at `CorrelationIdMiddleware.cs:18`), falling back
to the current W3C trace id then ASP.NET's `TraceIdentifier` (lines 32-34), writes it onto the scoped
[`ICorrelationContext`](#icorrelationcontext)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICorrelationContext.cs:8`, implemented by
[`CorrelationContext`](#correlationcontext), which self-seeds a GUID when no middleware ever sets one,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/CorrelationContext.cs:12`), and echoes it
back through `Response.OnStarting` (`CorrelationIdMiddleware.cs:37-41`). That single id is what the
CQRS logging decorators read
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/LoggingCommandDecorator.cs:16`
and `:23`) and stamp onto every log scope through the
`Command {CommandName} [CorrelationId: {CorrelationId}]` scope definition
(`LoggingCommandDecorator.cs:67`), so one request is traceable end to end.
[`TenantResolutionMiddleware`](#tenantresolutionmiddleware)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/TenantResolutionMiddleware.cs:36`) is the
HTTP half of [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html): it tries each
configured strategy in order (claim, then header; the `Host` strategy is defined but deliberately
unimplemented and options validation refuses to start a host that selected it, lines 105-122) and
publishes the winner on the scoped
[`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext) that the persistence query filter, save
interceptor, and per-tenant database routing all read (line 70). Two decisions mirror the
soft-deleted-user middleware below. It is wired unconditionally but inert by default, because
[`TenancySettings`](group-14-module-system-composition.md#tenancysettings) resolves to defaults with
`Enabled` false in a host that never called `AddMultiTenancy` (line 62). And it fails **closed**: with
`Tenancy:RequireTenant` on, a request that resolves no tenant is answered 400 with an RFC 9457 body
naming the claim and header it looked at (lines 83 and 128-151), because an unscoped request would read
across every tenant, which is the exact outcome tenancy exists to prevent; health, liveness, and
discovery paths are excluded so probes still answer before any tenant exists (lines 89-94).
[`SoftDeletedUserMiddleware`](#softdeletedusermiddleware)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:31`) enforces
business rule BR-133: an authenticated caller whose account was soft-deleted is rejected with a bare
401 (lines 104 and 145), checked first against a marker cached for 30 seconds
([`SoftDeletedUserCache`](group-08-auth.md#softdeletedusercache)`.MarkerDuration`,
`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:29`, keyed at
`SoftDeletedUserMiddleware.cs:85` and written at `:132`) to keep the per-request lookup cheap
([ADR-047](https://ivanball.github.io/docs/adr/047-soft-deleted-user-session-revocation.html)). It
resolves [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator) lazily from
`RequestServices` (line 75) instead of as an `InvokeAsync` parameter, so a service that does not host
Identity passes the request through rather than 500-ing on every call: an explicit nod to the
[Rubric §7, Microservices Readiness] extraction path. And unlike tenancy it fails **open**: a cache
read that throws falls back to the validator query (lines 92-100), and a validator query that throws
lets the request continue (lines 118-126), because failing closed would turn any cache or database blip
into a total outage for every authenticated request, while the exposure it buys back is bounded by the
access-token lifetime. All three middlewares are [Rubric §13, Observability & Operability]
(correlation), [Rubric §11, Security] (deleted-account lockout), and [Rubric §8, Data Architecture]
(tenant scoping) concerns handled once at the edge instead of in every controller.

**Errors become Problem Details, through two channels and one table.** Failures reach the client two
ways. Thrown exceptions are caught by the handler chain registered in `AddCommonExceptionHandlers`
(`DependencyInjection.cs:126-137`), evaluated most-specific-first:
[`OperationCanceledExceptionHandler`](#operationcanceledexceptionhandler) (499 Client Closed Request,
`OperationCanceledExceptionHandler.cs:32`), [`DomainExceptionHandler`](#domainexceptionhandler) (400,
`DomainExceptionHandler.cs:32`), [`DbUpdateExceptionHandler`](#dbupdateexceptionhandler) (409 with a
deliberately generic detail so database schema names never leak, `DbUpdateExceptionHandler.cs:33-36`),
[`ValidationExceptionHandler`](#validationexceptionhandler) (400 with FluentValidation errors grouped
by property name into the `errors` extension, `ValidationExceptionHandler.cs:48-54`), and finally
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
human message at the edge through [`IErrorLocalizer`](#ierrorlocalizer)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Localization/IErrorLocalizer.cs:9`), keyed by the
stable `Code`, leaving `Code`, `Type`, `Source`, and `Target` verbatim so clients can still branch on
them, and leaving the original English message untouched when no localizer is registered (line 51).
[`ErrorLocalizer`](#errorlocalizer)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Localization/ErrorLocalizer.cs:11`) walks the
registered [`ErrorResourceSource`](#errorresourcesource) list in registration order (lines 13-30: the
framework's own [`ErrorResources`](#errorresources) anchor first, then each module's resources added
through `AddErrorResources`, `DependencyInjection.cs:113`) and falls back to the caller's message when
no source knows the code (line 32). This is [Rubric §9, API & Contract Design] (one consistent RFC 9457
shape) meeting the [Rubric §1, SOLID] discipline of never duplicating the mapping, and [Rubric §27,
Internationalization] at the one boundary where a machine-readable code becomes human prose.

**The controller hierarchy: generic CRUD earned by inheritance.** A module gets working endpoints by
subclassing one generic base and supplying its type parameters
([ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html)).
[`ApiControllerBase`](#apicontrollerbase) is the root: `[ApiController]`, `HandleFailure`, nothing
else. [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:34`) adds the
read surface (`GetAllAsync` at line 103, `paged` at line 143, `lookup` at line 350, `GetByIdAsync` at
line 382) over an
[`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
with field projection through a `fields` query parameter, `X-Pagination` header metadata (line 171),
and a page size clamped to `MaxPageSize` (resolved per request from
[`IApplicationSettings`](group-14-module-system-composition.md#iapplicationsettings), defaulting to
500, lines 56-63).
[`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AggregateRootEntityControllerBase.cs:27`)
extends it with an `[Idempotent]` POST create (lines 58-59) that returns 201 through
`CreatedAtRoute("Get{EntityName}ById", ...)` (lines 72-75) and a DELETE that dispatches
[`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype)
and returns 204 (lines 84-97). The interfaces
[`IEntityControllerBase<TEntityDTO, TIdentifierType>`](#ientitycontrollerbasetentitydto-tidentifiertype)
(`IEntityControllerBase.cs:14`) and
[`IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>`](#iaggregaterootentitycontrollerbasetentitydto-tidentifiertype-tcreaterequest)
(`IAggregateRootEntityControllerBase.cs:15`, which extends the read contract at line 19) describe those
shapes for testing and documentation. The generic constraints tie the tower together: `TEntity`
derives from
[`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
for reads and from
[`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)
for writes, `TEntityDTO` implements [`IBaseDTO<TIdentifierType>`](#ibasedtotidentifiertype), and
`TCreateRequest` implements [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest)
(`IEntityControllerBase.cs:17-18`, `IAggregateRootEntityControllerBase.cs:20-22`). Alongside the CRUD
tower sit five special-purpose bases: [`AuthControllerBase`](#authcontrollerbase)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:40`, anonymous
login, register, and refresh over
[`IAuthenticationService`](group-08-auth.md#iauthenticationservice), lines 53-108, plus an
`[Authorize]` revoke at lines 113-117);
[`UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>`](#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/UserAccountAuthControllerBase.cs:40`),
which subclasses it purely additively (line 46) and adds the self-service account endpoints
`PUT password` (line 86), `PUT preferences` (line 112), and `GET preferences` (line 138), taking the
two mutation commands as type parameters because each app owns its own command record while the
preferences query is shared (`UserAccountAuthControllerBase.cs:47-48`);
[`OAuthControllerBase`](#oauthcontrollerbase)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:32`, the Google
and GitHub external-provider flow whose single-use exchange code, cached for two minutes at
`OAuthControllerBase.cs:43`, keeps tokens out of the redirect URL;
[ADR-036](https://ivanball.github.io/docs/adr/036-external-oauth-login.html) and
[ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html));
[`DataExportControllerBase<TQuery>`](#dataexportcontrollerbasetquery)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Privacy/DataExportControllerBase.cs:60`),
the data-subject access and portability endpoint
([ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html)), which serves
`GET {userId}/export` (line 78) as a real file download rather than an inline body (serialized at line
108 and returned through `File(...)` at line 110, with an invariant `user-data-{userId}-{yyyyMMdd}.json`
name derived from the package's own `GeneratedOn` at lines 134-135), gated by both an
`[Authorize]` policy and a `[FeatureGate]` on
[`PrivacyFeatures`](group-08-auth.md#privacyfeatures)`.DataExport` (lines 58-59) while the handler
independently enforces owner-or-privileged-role, and abstract only because each app owns its own query
record (`CreateQuery`, line 120); and
[`ServiceInfoControllerBase`](#serviceinfocontrollerbase)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:30`), whose
dual-version `/ServiceInfo` returns [`ServiceInfoResponse`](#serviceinforesponse) for the deprecated
v1.0 (line 51) and [`ServiceInfoV2Response`](#serviceinfov2response) for v2.0 (line 54, a superset
adding the supported and deprecated version lists at lines 32-33), proving the versioning machinery
works across versions (`[MapToApiVersion]` at lines 40 and 46). All of these carry the same note:
class-level routing and versioning attributes are not reliably inherited, so the per-service sealed
subclass supplies them. This is the clearest [Rubric §5, Vertical Slice] and [Rubric §16,
Maintainability] payoff in the presentation layer: a module writes a DTO, a mapper, and a short sealed
subclass, and inherits a fully paged, filterable, exportable, error-mapped REST resource, with
[Rubric §30, Compliance & Data Governance] covered by the DSAR base.

**Export is a route, not a content negotiation.** `EntityControllerBase.ExportAsync`
(`EntityControllerBase.cs:230-234`) streams the same filtered collection the paged endpoint serves as
an RFC 4180 CSV download, page-looping the query service server-side
([ADR-078](https://ivanball.github.io/docs/adr/078-csv-export-endpoint.html)). It is a distinct path
rather than an `Accept: text/csv` variant for two reasons stated in the source: the public
output-cache policy varies by query string but not by `Accept`, so a cached JSON body could be replayed
to a CSV request, and `AddAPI` sets `ReturnHttpNotAcceptable = false`, so a negotiation miss would fall
back to JSON silently instead of returning 406 (`EntityControllerBase.cs:182-187`). The writing half is
[`CsvWriter`](#csvwriter)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Export/CsvWriter.cs:34`), a deliberately
hand-written internal helper (three behaviors are needed and every package this repo ships is a
dependency every consumer inherits, `CsvWriter.cs:13-17`): it quotes only when RFC 4180 requires it
(`WriteField`, lines 145-156, with the trigger set as a `SearchValues<char>` at line 61), terminates
records with CRLF regardless of host OS (line 48), formats cells invariantly so the same row produces
the same bytes on every machine (`FormatCell`, lines 128-137: lowercase booleans to match the sibling
JSON, ISO 8601 round-trip "O" for timestamps), and writes a UTF-8 BOM explicitly (lines 45 and 69,
paired with the preamble-free encoding at line 55) because Excel reads a BOM-less UTF-8 CSV in the
machine's ANSI code page. The controller opens a `StreamWriter` over `Response.Body` without committing
the response (line 260), which is what keeps the "a failure on page one still returns Problem Details"
path honest, and the row ceiling is announced up front through the `X-Export-Row-Limit` header
(constant at line 439, default 100,000 at line 430, overridable per host at lines 76-83) with the
truncation notice written as a final body line, because headers are frozen the moment the first byte
flushes. Row scoping is a hook, not a default: `GetExportSpecification` returns null (line 488), so a
controller whose list endpoints row-scope reads must override it. That is a [Rubric §12, Performance &
Scalability] and [Rubric §11, Security] pairing worth reading closely.

**Idempotency for safe retries.** Write endpoints are made replay-safe by
[`IdempotentAttribute`](#idempotentattribute)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotentAttribute.cs:16`), a one-line
`ServiceFilterAttribute` that resolves the scoped [`IdempotencyFilter`](#idempotencyfilter)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:66`) from DI
([ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)). The filter runs at two
MVC stages. As an `IAsyncResourceFilter` it runs before model binding, the last point at which the
body can be made replayable, and calls `EnableBuffering` only when an `Idempotency-Key` header is
actually present (lines 121-127), so ordinary traffic pays nothing. As an `IAsyncActionFilter` it does
the real work: with no key the action simply runs (lines 133-138); with one, it derives the cache key
from the caller's `user_id` claim (or `anon:` plus the remote IP), the HTTP method, the route
template, and the client-supplied key, joined and SHA-256 hashed so the key length stays bounded
(`BuildCacheKey`, line 489). Scoping to the caller stops one user's cached response from being
replayed to another; scoping to method plus route stops one key from colliding across endpoints that
share a cache instance. It also hashes the buffered request body (`ComputeRequestBodyHashAsync`, lines
184-195, rewinding the stream on both sides so model binding still sees it) and binds that hash to the
record. The flow is then a lock-free fast path (`TryReplayAsync` at line 145), then the guarded
section. The guard is an [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) resolved
from `RequestServices` when the host registers one (lines 150-158), because a per-process lock only
serializes duplicates that land on the same replica and both deployed apps run more than one; a host
with no distributed lock falls back to the striped
[`KeyedSemaphoreStripe`](group-08-auth.md#keyedsemaphorestripe) (field at line 92, used at lines
201-216) rather than a per-key semaphore table that would grow unbounded or race on removal. Under the
distributed lock the filter waits `LockWait` (5 seconds, line 106) for a lease living `LockTimeToLive`
(30 seconds, line 99), double-checks the cache, and runs the action. Four outcomes are worth
memorizing. A hit replays the stored [`IdempotencyRecord`](#idempotencyrecord)
(`IdempotencyRecord.cs:17`, a status code plus JSON body plus the request-body hash) with an
`X-Idempotent-Replay: true` header (line 387), as a bare `StatusCodeResult` when the stored body is
empty so a replayed 204 does not acquire a content type (lines 388-395). A key reused with a
**different** payload is answered **422 Unprocessable Entity** rather than replayed (lines 375-382 and
`BodyMismatchResult` at 324-333), because replaying would tell the client a genuinely new write
succeeded when nothing ran. A duplicate that cannot take the lock within the wait and finds nothing
cached gets **409 Conflict** (lines 263-275 and `InFlightDuplicateResult` at 303-312), which is
retryable and honest rather than a second execution. And a cache or lock that **faults** is swallowed:
the request runs without the guarantee and the degradation is counted (lines 255-261 and 365-370),
because deduplication is an optimization over an at-least-once client retry and must not become an
outage of every write endpoint. Only 2xx results are stored, and only the two shapes the record can
represent: an `ObjectResult` or a body-less `StatusCodeResult` such as `NoContent()` (`BuildRecord`,
lines 452-478), for [`IdempotencySettings`](#idempotencysettings)`.CacheExpirationHours` (default 24,
constrained to the range 1 to 168, `IdempotencySettings.cs:15-16`) through
[`ICacheService`](group-09-caching.md#icacheservice). Replaying a transient 500 for a whole retention
window would defeat the retry the header exists to enable. All three behaviors are observable:
[`IdempotencyMetrics`](#idempotencymetrics)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyMetrics.cs:16`) publishes
`idempotency.replayed` (lines 36-39), `idempotency.conflict` tagged `kind=body_mismatch` or `in_flight`
(lines 41-44), and `idempotency.degraded` (lines 46-49) on the `MMCA.Common.Idempotency` meter (line
19), so a sustained degraded rate says out loud that deduplication is effectively off. This is a
[Rubric §7, Microservices Readiness], [Rubric §13, Observability & Operability], and [Rubric §29,
Resilience & Business Continuity] control: at-least-once retry from a gateway or a flaky client cannot
create duplicate resources.

**The contract surface: mapping, JSON, and query filters.** The framework maps between the wire and
the domain **by hand**, not through a runtime reflection mapper
([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)). Two interfaces in the
Application layer define the shape, both in
`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityDTOMapper.cs`:
[`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](#ientitydtomappertentity-tentitydto-tidentifiertype)
(line 14) turns an entity into its DTO and supplies a default interface implementation for the
collection overload (line 31), and
[`IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>`](#ientityrequestmappertentity-tcreaterequest-tidentifiertype)
(line 42) turns an incoming request into a domain entity through its factory, returning a
[`Result<T>`](group-01-result-error-handling.md#result) so mapping-time validation (a uniqueness check,
for example) is a first-class failure rather than an exception (line 55). Both are auto-registered by
module assembly scanning. Two edge helpers finish the contract surface:
[`CurrencyJsonConverter`](#currencyjsonconverter)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/JsonConverters/CurrencyJsonConverter.cs:12`)
serializes the [`Currency`](group-02-domain-building-blocks.md#currency) value object as its bare ISO
4217 code (lines 29-30) and throws `JsonException` on a non-string token or an unknown code (line 15
onward), which the framework surfaces as a 400; and [`QueryFilterModelBinder`](#queryfiltermodelbinder)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/ModelBinders/QueryFilterModelBinder.cs:24`) parses
the `filters[Prop].operator=` and `filters[Prop].value=` query-string convention into the
`(operator, value)` dictionary the paged read and export endpoints hand to the specification layer,
capping one request at `MaxFilters = 50` distinct properties (line 34, enforced at line 61, bounding
the per-request reflection work a caller can demand from
[`QueryFilterService`](group-03-querying-specifications.md#queryfilterservice)) and silently discarding
incomplete entries (lines 75-76). The small shared DTO vocabulary those generics rely on lives in
`MMCA.Common.Shared`: [`IBaseDTO<TIdentifierType>`](#ibasedtotidentifiertype)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/IBaseDTO.cs:9`, an `Id` declared with an `init`
accessor at line 13), [`BaseLookup<TIdentifierType>`](#baselookuptidentifiertype)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/BaseLookup.cs:8`, a required id at line 12 plus a
required display name at line 15, for dropdowns and autocomplete), and the optimistic-concurrency pair
[`IConcurrencyAware`](#iconcurrencyaware)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/IConcurrencyAware.cs:13`) and
[`ConcurrencyTokenRequest`](#concurrencytokenrequest)
(`MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/ConcurrencyTokenRequest.cs:12`), the reusable body
for lifecycle transitions that echoes back the `RowVersion` the client last saw (line 15) so a
transition decided against a stale view surfaces as 409 instead of applying silently
([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)). Manual mapping keeps
the DTO contract explicit and reviewable: the [Rubric §9, API & Contract Design] and [Rubric §15, Best
Practices] position this codebase takes deliberately.

**Feature gating and per-module controller visibility.** Two mechanisms let an operator turn surface
area on and off without a code change. [`DisabledFeatureHandler`](#disabledfeaturehandler)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/FeatureManagement/DisabledFeatureHandler.cs:13`)
renders a consistent Problem Details 404 when a `FeatureGate`-protected action is reached while its
flag is off (lines 18-27), so a disabled feature looks like a nonexistent endpoint rather than an error
([ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html)). At a coarser grain,
[`ModuleControllerFeatureProvider`](#modulecontrollerfeatureprovider)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/ModuleControllerFeatureProvider.cs:28`) removes a
disabled module's controllers from MVC discovery entirely, snapshotting the disabled names once (lines
35-39) and matching a `.{ModuleName}.` token against the controller's assembly name or namespace
(lines 60-82, the dots on both sides preventing a `Catalogue` false positive on `Catalog`), so a module
switched off in configuration cannot have its routes mapped (they would otherwise 500, since the
module's DI services were never registered). Together these are the feature-flag story extended to the
HTTP edge and part of the [Rubric §7, Microservices Readiness] "one codebase, many deployment shapes"
design.

**Well-known endpoints and the extraction edge.** Several types here exist only so a module can be
lifted out of the monolith into its own service (ADRs
[004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html),
[007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html),
[008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)).
[`JwksEndpointExtensions`](#jwksendpointextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/JwksEndpointExtensions.cs:15`) serves
`/.well-known/jwks.json` (path constant at line 20, mapped at lines 31-41) from
[`IJwksProvider`](group-08-auth.md#ijwksprovider) so extracted services validate tokens against the
issuer's public keys instead of a shared secret, and
[`OidcDiscoveryEndpointExtensions`](#oidcdiscoveryendpointextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/OidcDiscoveryEndpointExtensions.cs:22`)
serves the minimal discovery document the JWT middleware fetches when `AddForwardedJwtBearer` sets an
authority: it returns 404 when `Jwt:Issuer` is not configured (lines 62-66), derives `jwks_uri` from
that configured issuer rather than from the inbound request (line 76) so issuer and JWKS URI stay
origin-aligned, and disables the camelCase naming policy (line 45) because RFC 8414 field names are
snake_case and `jwksUri` would not be recognized.
[`JwtForwardingDelegatingHandler`](#jwtforwardingdelegatinghandler)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Http/JwtForwardingDelegatingHandler.cs:17`) copies
the caller's inbound `Authorization` header onto outgoing HTTP calls, unless one was already set (lines
25-29) and no-oping when there is no ambient `HttpContext` (lines 31-35), so distributed authorization
flows through a service-to-service hop without any handler threading the token by hand: the HTTP twin
of [`JwtForwardingClientInterceptor`](group-13-grpc-contracts.md#jwtforwardingclientinterceptor).
[`PublicEndpointOutputCachePolicy`](#publicendpointoutputcachepolicy)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/PublicEndpointOutputCachePolicy.cs:35`),
registered by name through [`OutputCacheOptionsExtensions`](#outputcacheoptionsextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheOptionsExtensions.cs:6`, both
overloads at lines 20-21 and 34-35), lets user-independent GET endpoints stay cacheable even when the
UI attaches a bearer token to every request, varying by every query-string key (line 81), refusing to
store responses that set cookies or are not plain 200s (lines 101-103), and offering a `bypassRoles`
escape hatch so a privileged caller who receives an elevated payload always reads fresh, skipping both
lookup and storage (lines 73-75 and 112-113,
[ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)).
[`DatabaseInitializationExtensions`](#databaseinitializationextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:21`)
initializes every physical data source the host owns: it warms the
[`IEntityDataSourceRegistry`](group-07-persistence-ef-core.md#ientitydatasourceregistry) so
entity-to-database routing is deterministic before the first repository call (lines 46-48), runs
`EnsureCreated` for the migration-less Cosmos and SQLite engines up front (lines 58-68), then applies
one of `Migrate`, `EnsureCreated`, or `None` per `ApplicationSettings.DatabaseInitStrategy` (lines
74-89), where `None` is the production guard that throws with a per-source breakdown of pending
migrations (line 83 into `ThrowIfPendingMigrationsAsync` at line 191;
[ADR-030](https://ivanball.github.io/docs/adr/030-startup-sole-migrator.html),
[ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)), repeats the same
strategy per tenant that keeps its own copy of a source, each in a fresh scope with its tenant set
(lines 91-92 and 112-122, [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)),
and finishes by running the enabled modules' seeders on the default scope only (line 98). Five smaller
startup helpers round out the host: [`OpenApiEndpointExtensions`](#openapiendpointextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/OpenApiEndpointExtensions.cs:18`) maps the
per-version OpenAPI document (lines 30-34) and the optional Scalar reference UI (lines 48-52) outside
Production only, [`ApiParameterDescriptorBackfillProvider`](#apiparameterdescriptorbackfillprovider)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/OpenApi/ApiParameterDescriptorBackfillProvider.cs:43`)
fills in the placeholder descriptor MVC leaves null on an unbound route token (lines 65-71) so a
URL-segment-versioned or `{tenant}`-templated route cannot turn document generation into a 500, running
last by ordering itself at `int.MinValue` (line 46) and registered exactly once through
`TryAddEnumerable` however many helpers a host calls
(`WebApplicationBuilderExtensions.cs:132`, `:239`, `:251-253`),
[`SignalRExtensions`](#signalrextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/SignalRExtensions.cs:12`) maps
[`NotificationHub`](group-10-notifications.md#notificationhub) at its configured path when push
notifications are enabled (lines 22-27), [`MiniProfilerExtensions`](#miniprofilerextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/MiniProfilerExtensions.cs:9`) registers
MiniProfiler with Entity Framework profiling when `ApplicationSettings.UseMiniProfiler` is set (lines
16-25), and [`AppAssociationEndpointExtensions`](#appassociationendpointextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/AppAssociationEndpointExtensions.cs:15`) with
[`AppAssociationOptions`](#appassociationoptions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/AppAssociationOptions.cs:9`) serve the
Android Digital Asset Links and Apple App Site Association documents (paths at lines 18 and 24, mapped
at lines 42 and 46) that let a mobile OS hand this host's https links to the installed native app
([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)).
[`ExternalAuthExtensions`](#externalauthextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Authentication/ExternalAuthExtensions.cs:21`)
completes the OAuth half of authentication, staying entirely inert when no provider is configured
(lines 48-50), each provider gated on its `OAuth:{Provider}:ClientId` being present and throwing at
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
- **Depends on**: `System.Reflection` (BCL) only (`AssemblyReference.cs:1`).
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
> MMCA.Common.API · `MMCA.Common.API.Authentication` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Authentication/ExternalAuthExtensions.cs:21` · Level 0 · class (static)

- **What it is**: a static class that registers the external OAuth provider schemes (Google, GitHub) plus the short-lived cookie scheme that carries the external principal from the provider callback to the app's OAuth controller. It is the counterpart wiring that `AddCommonAuthentication` (JWT-only) deliberately leaves out.
- **Depends on**: `AspNet.Security.OAuth.GitHub`, `Microsoft.AspNetCore.Authentication.Google`, and the ASP.NET Core authentication/DI/configuration BCL surface (`ExternalAuthExtensions.cs:1-3`). First-party, it partners with the app's OAuth controller subclassing [OAuthControllerBase](#oauthcontrollerbase), whose `ExtractClaims` consumes the schemes registered here (`ExternalAuthExtensions.cs:9-10`).
- **Concept introduced (config-gated, additive auth registration).** The single `public const string ExternalLoginScheme = "ExternalLogin"` (`ExternalAuthExtensions.cs:27`) is shared with the OAuth controller so the sign-in scheme name can never drift between the two halves of the flow. `[Rubric §11, Security]` assesses how authentication, secrets, and trust boundaries are handled; here each provider is gated on its `OAuth:<Provider>:ClientId` being present, and a missing client secret throws at startup (`ExternalAuthExtensions.cs:74-76` and `:88-90`) rather than silently half-configuring an auth scheme. `[Rubric §9, API & Contract Design]` is relevant because the extension is inert until configured: a host with no OAuth section keeps the JWT-only default untouched, the same opt-in posture as `AddPermissions` ([ADR-020](https://ivanball.github.io/docs/adr/020-permission-based-authorization.html)), and the class doc says so explicitly (`ExternalAuthExtensions.cs:11-19`).
- **Walkthrough**: the whole surface is one C# `extension(IServiceCollection services)` block (`ExternalAuthExtensions.cs:29`), matching the DI convention described in the [primer](00-primer.md#2-architectural-styles-this-codebase-commits-to). `AddExternalAuthProviders(IConfiguration configuration)` (`ExternalAuthExtensions.cs:37`) reads the `OAuth` section (`:39`), pulls `Google:ClientId` and `GitHub:ClientId` (`:40-41`), derives `googleEnabled`/`githubEnabled` from whether each id is non-empty (`:43-44`), and returns the collection untouched when neither is set (`:48-51`) so environments without OAuth secrets are left exactly as `AddCommonAuthentication` left them. When at least one provider is configured it calls `services.AddAuthentication()` with no argument (`:55`), which appends schemes without resetting the JWT default (`:53-54`). It then adds the `ExternalLogin` cookie (`:59-67`): cookie name `mmca_external_login`, `HttpOnly`, `SameSite=Lax` (sufficient because the OAuth round trip returns as a top-level GET navigation, avoiding the `Secure`+cross-site cost of `SameSite=None`, `:63-65`), and a 10-minute expiry (`:66`). Google (`:69-81`) and GitHub (`:83-98`) each set `SignInScheme = ExternalLoginScheme`, a fixed `CallbackPath` (`/auth/callback/google` at `:78`, `/auth/callback/github` at `:92`), and `SaveTokens = true`; GitHub additionally requests the `user:email` scope (`:95`) because it does not return email on the default scope, and the controller's `ClaimTypes.Email` lookup would otherwise fail (`:93-94`). The method returns `services` for chaining (`:100`).
- **Why it's built this way**: the cookie is intentionally short-lived and single-purpose, it exists only to bridge the provider callback to the controller's `CompleteAsync`, which signs it out the moment the local JWT pair is minted (`:57-58`). Splitting the OAuth scheme registration from `AddCommonAuthentication` keeps the JWT-only default (used by most tests and local dev) free of provider secrets.
- **Where it's used**: called from the host composition of a service that exposes social login; pairs with the app's `OAuthController` (subclass of [OAuthControllerBase](#oauthcontrollerbase)).

### PublicEndpointOutputCachePolicy
> MMCA.Common.API · `MMCA.Common.API.Caching` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/PublicEndpointOutputCachePolicy.cs:35` · Level 0 · class (sealed)

- **What it is**: a custom ASP.NET Core `IOutputCachePolicy` for public, user-independent GET/HEAD endpoints that must stay cacheable even when the request carries an `Authorization` header. It replaces the built-in default policy, which refuses to serve or store a cached response for any authenticated request.
- **Depends on**: `Microsoft.AspNetCore.OutputCaching` (`IOutputCachePolicy`, `OutputCacheContext`), `System.Security.Claims`, and `Microsoft.Extensions.Primitives` (`StringValues`), all at `PublicEndpointOutputCachePolicy.cs:1-4`. No first-party dependencies; it is registered by [OutputCacheOptionsExtensions](#outputcacheoptionsextensions).
- **Concept introduced (auth-header-tolerant output caching).** The framework UI attaches a Bearer token to *every* outgoing API request, including reads of `[AllowAnonymous]` endpoints whose payload is identical for every caller. Under the default policy those reads bypass the output cache for any signed-in user and land on the database each time (`PublicEndpointOutputCachePolicy.cs:12-17`). `[Rubric §12, Performance & Scalability]` assesses whether hot read paths avoid redundant work; this policy is a direct performance lever, it lets public reads share one cached entry across authenticated and anonymous callers. `[Rubric §11, Security]` assesses trust boundaries; the class docs (`PublicEndpointOutputCachePolicy.cs:24-33`) are explicit that a cached response is served verbatim to every subsequent caller, so it must be applied only to identity-independent payloads, and the `bypassRoles` mechanism exists precisely so a privileged role that receives an elevated payload (for example organizers seeing unpublished rows) is never served or stored from the shared cache.
- **Walkthrough**: three fields hold the config, `_expiration`, `_bypassRoles`, `_tags` (`PublicEndpointOutputCachePolicy.cs:37-39`). Two constructors: the `params string[] tags` overload (`:44`) delegates to the full one with an empty bypass-roles array (`:45`), and the primary constructor (`:54`) guards its inputs (`ThrowIfLessThanOrEqual(expiration, TimeSpan.Zero)`, null checks on both arrays, `:56-58`). All three interface methods are explicitly implemented, so they are reachable only through `IOutputCachePolicy`. `CacheRequestAsync` (`:66`) computes `attemptOutputCaching` as "is a GET/HEAD request" AND "is not a bypassed caller" (`:71-72`), enables output caching, sets `AllowCacheLookup`/`AllowCacheStorage` to that flag, allows locking, sets the expiration (`:73-77`), and (matching the built-in default) varies the cache key by every query-string parameter via `CacheVaryByRules.QueryKeys = "*"` (`:81`), then copies the eviction tags in (`:83-84`). `ServeFromCacheAsync` (`:90`) is a no-op returning `ValueTask.CompletedTask`. `ServeResponseAsync` (`:94`) refuses to store any response that set a cookie or returned a non-200 status (`:100-104`), the same guard the built-in default applies. Two private helpers close it out: `IsCacheableRequest` (`:109`, GET or HEAD) and `IsBypassedCaller` (`:112`, `Array.Exists(_bypassRoles, user.IsInRole)`).
- **Why it's built this way**: it mirrors the built-in default policy minus exactly one behavior, the authenticated-request bail-out (`:68-70`), so its caching, query-key variance, and cookie/status guards stay identical to what developers already expect. Bypass roles get the default behavior back (no lookup, no storage), which keeps elevated payloads out of the shared cache without disabling caching for everyone. A raw `IOutputCachePolicy` implementation inherits none of the default policy's behavior, so every guard is re-implemented here.
- **Where it's used**: registered as a named policy by [OutputCacheOptionsExtensions](#outputcacheoptionsextensions) and referenced from controller actions via `[OutputCache(PolicyName = ...)]`.
- **Caveats / not-in-source**: the exact endpoints and roles each downstream app applies this to are configured in those apps, not visible from this file.

### OutputCacheOptionsExtensions
> MMCA.Common.API · `MMCA.Common.API.Caching` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/OutputCacheOptionsExtensions.cs:6` · Level 1 · class (static)

- **What it is**: registration helpers that add named output-cache policies backed by [PublicEndpointOutputCachePolicy](#publicendpointoutputcachepolicy) onto ASP.NET Core's `OutputCacheOptions`.
- **Depends on**: `Microsoft.AspNetCore.OutputCaching` (`OutputCacheOptions`, `OutputCacheOptionsExtensions.cs:1`) and [PublicEndpointOutputCachePolicy](#publicendpointoutputcachepolicy).
- **Concept**: this is a thin fluent facade over `OutputCacheOptions.AddPolicy`, using a C# `extension(OutputCacheOptions options)` block (`OutputCacheOptionsExtensions.cs:8`) so the policy registration reads as a first-class option on the options object. See the [DI registration `extension(T)` convention](00-primer.md#2-architectural-styles-this-codebase-commits-to). `[Rubric §9, API & Contract Design]` is relevant, the helper gives callers a self-documenting, named entry point instead of hand-constructing the policy at each call site.
- **Walkthrough**: two overloads of `AddPublicEndpointPolicy`. The first (`OutputCacheOptionsExtensions.cs:20-21`) takes `name`, `expiration`, and `params string[] tags` and registers `new PublicEndpointOutputCachePolicy(expiration, tags)`. The second (`:34-35`) adds a `string[] bypassRoles` parameter before the `params string[] tags` and forwards to the three-argument policy constructor, for endpoints whose payload is identical for every caller except one privileged role. Both are expression-bodied and return `void`, mutating the options in place.
- **Why it's built this way**: keeping the policy construction behind a named helper means the "apply only to `[AllowAnonymous]`, identity-independent endpoints" guidance travels with the API surface (see the doc comments at `:10-16` and `:23-29`) instead of being re-derived at each registration.
- **Where it's used**: called during host composition where the app configures `AddOutputCache(...)`; the registered `name` is then referenced by `[OutputCache(PolicyName = ...)]` on controller actions.

### ModuleControllerFeatureProvider
> MMCA.Common.API · `MMCA.Common.API` · `MMCA.Common/Source/Presentation/MMCA.Common.API/ModuleControllerFeatureProvider.cs:28` · Level 2 · class (sealed)

- **What it is**: an `IApplicationFeatureProvider<ControllerFeature>` that removes controllers belonging to *disabled* modules from MVC's controller discovery, so a module turned off via configuration exposes no routes.
- **Depends on**: [ModulesSettings](group-14-module-system-composition.md#modulessettings) (the config-bound enabled/disabled map, `ModuleControllerFeatureProvider.cs:4`) and the MVC application-parts BCL (`IApplicationFeatureProvider<ControllerFeature>`, `ControllerFeature`, `ApplicationPart`, `:2-3`), plus `System.Reflection` for the `TypeInfo` it inspects (`:1`).
- **Concept introduced (module-aware controller discovery).** MVC discovers controllers by scanning referenced assemblies. When a host references a module's `API` assembly transitively but an operator has disabled that module (`Modules:{Name}:Enabled=false`), MVC would still map its controllers, and every request to them would 500 because the module's DI services were never registered (`ModuleControllerFeatureProvider.cs:19-25`). `[Rubric §7, Microservices Readiness]` assesses whether modules can be composed and decomposed cleanly; this provider is one boundary that lets a module be switched off without deleting code or breaking the host, complementing the disabled-module stub registrations in the module system. `[Rubric §10, Cross-Cutting]` is relevant, the enable/disable decision is enforced once at the edge rather than checked inside each controller.
- **Walkthrough**: the primary-constructor parameter is `ModulesSettings modulesSettings` (`ModuleControllerFeatureProvider.cs:28-29`). `PopulateFeature` (`:33`) first snapshots the disabled module names once (`:36-39`) so it does not re-scan the settings dictionary per controller, returns early if none are disabled (`:41-44`), then materializes the matches and removes every controller matched by `IsDisabledModuleController` (`:46-53`). The private static matcher (`:60`) reads the controller's assembly simple name and namespace, each with a `?? string.Empty` fallback (`:64-65`), and, for each disabled module, tests whether either contains the token `.{ModuleName}.` (`:72`). Wrapping the module name in dots is deliberate: it matches `.Catalog.` inside `MMCA.Store.Catalog.API` or its `.Controllers` namespace while avoiding false positives from substrings like "Catalogue" (`:69-71`). The comparison is `OrdinalIgnoreCase` on both the assembly name and the namespace (`:74-75`), and the loop falls through to `false` when nothing matches (`:81`).
- **Why it's built this way**: matching on the dotted token handles both the `MMCA.{Repo}.{Module}.API` convention and the legacy `{Prefix}.Modules.{Module}.*` convention without maintaining a registry of controller types (`:14-17`). Removing controllers at feature-provider time is earlier than routing, so a disabled module is invisible rather than returning a runtime error.
- **Where it's used**: registered by [DependencyInjection](#dependencyinjection)'s `AddAPI(modulesSettings)` via `ConfigureApplicationPartManager` (`DependencyInjection.cs:64-65`), but only when a non-null `ModulesSettings` is supplied (`DependencyInjection.cs:62`); pairs with the module system's disabled-stub registrations so cross-module interfaces stay resolvable.

### DependencyInjection
> MMCA.Common.API · `MMCA.Common.API` · `MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:25` · Level 11 · class (static)

- **What it is**: the primary DI entry point for the `MMCA.Common.API` layer. Using a C# `extension(IServiceCollection services)` block (`DependencyInjection.cs:27`) it adds six methods to `IServiceCollection`: `AddAPI`, `AddErrorLocalization`, `AddErrorResources<TResource>`, `AddCommonExceptionHandlers`, `AddServerAuthSessionCookie`, and `AddModuleHealthChecks`.
- **Depends on**: a broad slice of the API layer plus feature management and localization (`DependencyInjection.cs:1-18`). Notable first-party types wired here: [CurrencyJsonConverter](#currencyjsonconverter) and the Shared-layer [EnumerationJsonConverterFactory](group-02-domain-building-blocks.md#enumerationjsonconverterfactory) (aliased at `:18` because the Shared and API namespaces both surface converters), [UnhandledResultFailureFilter](#unhandledresultfailurefilter), [IdempotencyFilter](#idempotencyfilter) and [IdempotencySettings](#idempotencysettings), [OwnerOrAdminFilter](group-08-auth.md#owneroradminfilter), [ModuleControllerFeatureProvider](#modulecontrollerfeatureprovider), [DisabledFeatureHandler](#disabledfeaturehandler), [IErrorLocalizer](#ierrorlocalizer)/[ErrorLocalizer](#errorlocalizer), [ErrorResources](#errorresources)/[ErrorResourceSource](#errorresourcesource), the exception handlers ([OperationCanceledExceptionHandler](#operationcanceledexceptionhandler), [DomainExceptionHandler](#domainexceptionhandler), [DbUpdateExceptionHandler](#dbupdateexceptionhandler), [ValidationExceptionHandler](#validationexceptionhandler), [GlobalExceptionHandler](#globalexceptionhandler)), [CookieTokenReader](group-08-auth.md#cookietokenreader) and [ICookieSessionRefresher](group-08-auth.md#icookiesessionrefresher)/[CookieSessionRefresher](group-08-auth.md#cookiesessionrefresher), and [ModuleLoader](group-14-module-system-composition.md#moduleloader)/[ModulesSettings](group-14-module-system-composition.md#modulessettings). Externals: `Microsoft.FeatureManagement` (including its `IDisabledFeaturesHandler` contract), `Microsoft.Extensions.Localization`, ASP.NET Core MVC/ProblemDetails/HealthChecks.
- **Concept introduced (layered DI wiring at the API edge).** `[Rubric §3, Clean Architecture]` assesses whether each layer registers only its own concerns; this class wires controllers, JSON/XML formatters, filters, feature management, exception handlers, and health checks, all API-layer edges, and reaches down to Application only for `ModulesSettings`/`ModuleLoader` (`:16-17`). `[Rubric §13, Observability & Operability]` and `[Rubric §17, DevOps]` both apply through `AddModuleHealthChecks` (`DependencyInjection.cs:179`), which projects module state into `/health` checks tagged `module` so `/health?tag=module` reports each module's status (`:171-172`). `[Rubric §9, API & Contract Design]` is relevant, every parameter is optional and defaulted so a host wires only what it needs.
- **Walkthrough**:
  - `AddAPI(ModulesSettings? modulesSettings = null, IConfiguration? configuration = null)` (`DependencyInjection.cs:44`) registers controllers with `ReturnHttpNotAcceptable = false` and the [UnhandledResultFailureFilter](#unhandledresultfailurefilter) global filter (`:46-50`), adds two JSON converters (`:51-59`) and the XML DataContract formatters (`:60`). The second converter is the load-bearing one: concrete enumerations do not inherit the base class's `[JsonConverter]` attribute because `System.Text.Json` resolves it with `inherit: false`, so the factory is registered once here and every `Enumeration<T>` serializes by `Name` across the whole API surface (`:55-58`). It then conditionally registers [ModuleControllerFeatureProvider](#modulecontrollerfeatureprovider) when `modulesSettings` is non-null (`:62-66`), conditionally binds [IdempotencySettings](#idempotencysettings) from the config section with data-annotation validation on start (`:68-74`), registers the scoped [IdempotencyFilter](#idempotencyfilter) and [OwnerOrAdminFilter](group-08-auth.md#owneroradminfilter) (scoped because they depend on scoped services such as `ICacheService` and `ICurrentUserService`, `:76-78`), turns on feature management with `AddFeatureManagement()` plus the singleton [DisabledFeatureHandler](#disabledfeaturehandler) behind `IDisabledFeaturesHandler` (`:80-84`), and finally calls `AddErrorLocalization()` (`:86-87`).
  - `AddErrorLocalization()` (`:98`) registers ASP.NET localization, the singleton [IErrorLocalizer](#ierrorlocalizer) via `TryAddSingleton` so a host can substitute its own (`:100-101`), and the framework's own [ErrorResources](#errorresources) source (`:102`); `AddErrorResources<TResource>()` (`:113`) adds a module's resource anchor as another [ErrorResourceSource](#errorresourcesource) built from an `IStringLocalizerFactory` (`:115-116`). This is the [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) edge error-localization boundary, keyed by `Error.Code`, and modules add their translations additively (`:106-112`).
  - `AddCommonExceptionHandlers()` (`:126`) registers ProblemDetails (adding a `requestId` extension from `TraceIdentifier`, `:128-130`) then five `IExceptionHandler`s in specificity order (`:131-135`): `OperationCanceled`, `DomainException`, `DbUpdate`, `Validation`, and [GlobalExceptionHandler](#globalexceptionhandler) as the catch-all. ASP.NET Core invokes them in registration order and stops at the first that handles the exception, hence most-specific first and the 500 fallback last (`:122-123`).
  - `AddServerAuthSessionCookie(string apiBaseAddress)` (`:151`) wires the SSR-prerender auth path: it guards the address (`:153`), then adds `HttpContextAccessor`, memory cache, the scoped [CookieTokenReader](group-08-auth.md#cookietokenreader) (`:155-157`), a named `HttpClient` pointed at the internal API base address (`:159-160`), and the [CookieSessionRefresher](group-08-auth.md#cookiesessionrefresher) as a **singleton** (`:163`). The singleton is load-bearing: its in-flight map must be shared across requests for single-flight refresh to work (`:162`). The doc comment is explicit that the address is the internal endpoint, not the browser-facing one (`:146-149`).
  - `AddModuleHealthChecks(ModuleLoader moduleLoader)` (`:179`) adds one health check per module, `Healthy` for each enabled module (`:183-189`) and `Degraded` for each disabled one (`:191-198`), named `module-{Name}` and tagged `module`. It must run after [ModuleLoader](group-14-module-system-composition.md#moduleloader)'s `DiscoverAndRegister` (`:174-177`).
- **Why it's built this way**: bundling the API-edge concerns behind small, defaulted extension methods lets each host opt into exactly the surface it needs (a JWT-only test host skips `AddServerAuthSessionCookie`; a monolith with no disabled modules passes a null `modulesSettings`; a host with no idempotency configuration passes a null `configuration` and keeps the defaults). The exception-handler ordering, the enumeration converter factory, and the refresher's singleton lifetime are the three non-obvious, correctness-critical choices, and all three carry an inline comment. Error localization is registered automatically by `AddAPI` so modules only add their own resources additively ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Where it's used**: called from every service host's composition (`Program.cs` of the ADC/Store/Helpdesk API hosts and the integration-test hosts) to wire the shared API layer; `AddApplicationDecorators()` still runs last in the overall sequence (see `MMCA.Common/CLAUDE.md` DI ordering note).
- **Caveats / not-in-source**: the relative ordering of `AddAPI` against `AddInfrastructure`/`AddApplication` in a given host is not fixed by this file; only `AddApplicationDecorators()` last is load-bearing.

### CsvWriter

> MMCA.Common.API · `MMCA.Common.API.Export` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Export/CsvWriter.cs:34` · Level 0 · class (internal static)

- **What it is**: a hand-written, minimal RFC 4180 CSV writer. It writes into a caller-supplied `TextWriter` one record at a time, so the generic `/export` endpoint can stream a file straight to the response body without ever holding the whole result set in memory.
- **Depends on**: nothing first-party. From the BCL: `TextWriter`, `SearchValues<char>` (`System.Buffers`), `UTF8Encoding` (`System.Text`), and `CultureInfo.InvariantCulture` (`System.Globalization`).
- **Concept introduced: a framework declines dependencies its consumers cannot decline.** `[Rubric §32, Dependency & Supply-Chain]` assesses what a package drags into every downstream application; because MMCA.Common ships under lockstep versioning, a CsvHelper reference here would become a pin in ADC, Store, and Helpdesk that none of them chose. The type doc makes the trade explicit (`CsvWriter.cs:14-16`): the framework needs exactly three behaviors (quote when required, escape embedded quotes, terminate with CRLF), and that is a page of code with full in-repo test coverage. `[Rubric §15, Best Practices & Code Quality]`: every formatting decision is invariant, so the same row produces the same bytes on every machine (`CsvWriter.cs:19-25`). See [ADR-078](https://ivanball.github.io/docs/adr/078-csv-export-endpoint.html).
- **Walkthrough**
  - `Utf8ByteOrderMark` (`CsvWriter.cs:45`) and `LineEnding` (`CsvWriter.cs:48`, the literal `"\r\n"` regardless of host OS) are the two format constants. `Utf8NoPreamble` (`CsvWriter.cs:55`) is a `UTF8Encoding` constructed with `encoderShouldEmitUTF8Identifier: false`, so the `StreamWriter` an export runs through emits no preamble of its own and the BOM decision lives in exactly one place.
  - `MustQuote` (`CsvWriter.cs:61`) is a `SearchValues<char>` over `,"\r\n`: the four characters RFC 4180 section 2 says force quoting. `SearchValues` is the vectorized-lookup type, so the per-field scan is a span search rather than four `IndexOf` passes (`[Rubric §12, Performance & Scalability]`).
  - `WriteByteOrderMark(writer)` (`CsvWriter.cs:69`) writes the BOM unconditionally. The remarks say why (`CsvWriter.cs:40-43`): Excel reads a BOM-less UTF-8 CSV in the machine's ANSI code page, turning every accented character into mojibake, and three bytes is cheaper than a setting nobody finds in time.
  - `WriteHeader(columns, writer)` (`CsvWriter.cs:81`) and `WriteRow(cells, writer)` (`CsvWriter.cs:105`) are the same loop: comma between fields (`CsvWriter.cs:88-91` and `CsvWriter.cs:112-115`), then `LineEnding`. The header escapes a column name exactly like a data field (`CsvWriter.cs:93`), so a column named `full,name` cannot break the record.
  - `FormatCell(value)` (`CsvWriter.cs:128-137`) is the type switch that fixes the value contract: null writes empty, `string` writes verbatim, `bool` writes lowercase `true`/`false` to match the JSON the sibling endpoints emit rather than .NET's capitalized `ToString`, `DateTime` and `DateTimeOffset` write ISO 8601 round-trip `"O"` (chosen over the sortable `"s"` because `"O"` keeps sub-second precision and the offset, so a parsed value equals the exported one), anything else `IFormattable` formats invariantly, and the fallback is `Convert.ToString`.
  - `WriteField(field, writer)` (`CsvWriter.cs:145`) is the only private member: a clean field is written as-is (`CsvWriter.cs:147-151`), and a field containing any `MustQuote` character is wrapped in quotes with embedded quotes doubled (`CsvWriter.cs:153-155`).
- **Why it's built this way**: the writer takes a `TextWriter` rather than returning a string, because the whole point of the export endpoint is that no full result set exists in memory at any moment. Keeping the type `internal static` means it is a framework implementation detail, not a public surface a consumer can bind to and then be broken by.
- **Caveats / not-in-source**: the writer deliberately does **not** neutralize spreadsheet formula injection. A cell whose value opens with `=`, `+`, `-`, or `@` is written verbatim, and the type doc records the reasoning (`CsvWriter.cs:27-32`): CSV is treated as a data-faithful format here and prefixing would corrupt legitimate negative numbers, so a host that opens untrusted exports in a spreadsheet is expected to import them as text. [ADR-078](https://ivanball.github.io/docs/adr/078-csv-export-endpoint.html) explicitly left this open at the record ("this record does not pre-decide the answer"); the code decided it. Note one further divergence: the ADR describes the BOM as "controlled by a setting", while the shipped code writes it unconditionally.
- **Where it's used**: only by [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype)`.ExportAsync`, which takes the encoding at `EntityControllerBase.cs:260`, writes the BOM and header at `EntityControllerBase.cs:298-299`, each data row at `EntityControllerBase.cs:615`, and the trailing markers at `EntityControllerBase.cs:287` and `EntityControllerBase.cs:332`. Covered directly by [`CsvWriterTests`](group-27-testing-infrastructure.md#csvwritertests) (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Export/CsvWriterTests.cs:8`).

### DisabledFeatureHandler

> MMCA.Common.API · `MMCA.Common.API.FeatureManagement` · `MMCA.Common/Source/Presentation/MMCA.Common.API/FeatureManagement/DisabledFeatureHandler.cs:13` · Level 0 · class (sealed)

- **What it is**: the one-method handler that decides what a `[FeatureGate]`-protected controller action returns when its feature flag is off. Instead of ASP.NET Core's default (a bare 404 with no body), it emits an RFC 9457 Problem Details payload so a disabled feature reads the same as any other framework error.
- **Depends on**: `IDisabledFeaturesHandler` and `FeatureGateAttribute` from `Microsoft.FeatureManagement.Mvc` (NuGet); `ProblemDetails`, `ObjectResult`, and `StatusCodes` from ASP.NET Core. No first-party dependencies.
- **Concept introduced: feature gating at the HTTP edge.** `[Rubric §9, API & Contract Design]` assesses whether every response, success or refusal, follows one uniform contract; this handler makes the disabled-feature path match the [`ApiControllerBase`](#apicontrollerbase)`.HandleFailure` shape rather than leaking a framework default. `[Rubric §10, Cross-Cutting]` covers concerns applied uniformly across endpoints, and feature flags are exactly that. Note the split: this class gates *controller actions* decorated with `[FeatureGate]`, while [`FeatureGateCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult) gates *CQRS handlers* one layer deeper. The two surfaces cover the two entry points into a gated capability, which is precisely the dual-surface enforcement [ADR-031](https://ivanball.github.io/docs/adr/031-feature-flag-management.html) records.
- **Walkthrough**: `HandleDisabledFeatures(features, context)` (`DisabledFeatureHandler.cs:16`) sets `context.Result` to an `ObjectResult` wrapping a `ProblemDetails` with `Status = 404` and a fixed title/detail ("Feature not available", `DisabledFeatureHandler.cs:18-23`), and also sets the outer `StatusCode = 404` (`DisabledFeatureHandler.cs:25`) so the response code and the body agree. It returns `Task.CompletedTask` (`DisabledFeatureHandler.cs:28`): the work is synchronous, there is nothing to await.
- **Why it's built this way**: the payload deliberately does not name the disabled feature. An anonymous caller learns only that the endpoint is unavailable, not which flag is off, so the flag set is not enumerable from outside. The `features` parameter is available but unused for that reason.
- **Where it's used**: registered as the app's `IDisabledFeaturesHandler` singleton inside `AddAPI` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:84`, immediately after `services.AddFeatureManagement()` on `DependencyInjection.cs:83`); invoked by `Microsoft.FeatureManagement.Mvc` whenever a `[FeatureGate]` action is hit with its flag disabled.

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
- **Concept introduced: header-based API versioning as a first-class contract.** `[Rubric §9, API & Contract Design]` assesses whether an API can carry multiple versions concurrently and signal deprecation; this controller demonstrates the whole loop: two versions on one route, one marked deprecated, and `ReportApiVersions = true` (set in `AddCommonApiVersioning` on [`WebApplicationBuilderExtensions`](#webapplicationbuilderextensions)) so responses carry `api-supported-versions` / `api-deprecated-versions` headers (class doc, `ServiceInfoControllerBase.cs:6-14`). [ADR-046](https://ivanball.github.io/docs/adr/046-http-api-versioning.html) makes the point that a versioning claim which only ever ships `v1.0` is untestable; this endpoint is what makes it testable.
- **Walkthrough**
  - `Supported = ["1.0", "2.0"]` and `Deprecated = ["1.0"]` (`ServiceInfoControllerBase.cs:32-33`) are the static version lists the v2 payload echoes.
  - `ServiceName` (`ServiceInfoControllerBase.cs:36`) is an abstract property the sealed per-service subclass supplies, because class-level routing/versioning attributes are not reliably inherited (remarks, `ServiceInfoControllerBase.cs:15-29`): the subclass carries `[ApiController]`, `[Route("[controller]")]`, `[AllowAnonymous]`, and the two `[ApiVersion]` attributes.
  - `GetV1()` (`ServiceInfoControllerBase.cs:41`) is `[HttpGet]` + `[MapToApiVersion("1.0")]` (`ServiceInfoControllerBase.cs:39-40`) and returns the minimal [`ServiceInfoResponse`](#serviceinforesponse).
  - `GetV2()` (`ServiceInfoControllerBase.cs:47`) is `[MapToApiVersion("2.0")]` (`ServiceInfoControllerBase.cs:46`) and returns the superset [`ServiceInfoV2Response`](#serviceinfov2response) with the supported/deprecated lists.
- **Why it's built this way**: the type is abstract with an abstract `ServiceName` so each extracted service reuses the identical versioning surface while stamping its own identity, keeping the "build the monolith now, extract a service later" path uniform (`[Rubric §7, Microservices Readiness]`). The endpoint is anonymous and reached on the service host directly; gateways do not route it (class doc, `ServiceInfoControllerBase.cs:12-13`).
- **Where it's used**: subclassed by each service's sealed `ServiceInfoController`, for example ADC's Conference service (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ServiceInfoController.cs:20`, with `ServiceName => "Conference"` at `ServiceInfoController.cs:23`) and Store's Catalog service (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/Controllers/ServiceInfoController.cs:20`, `ServiceName => "Catalog"` at `ServiceInfoController.cs:23`). Because the controller ships in the framework, the fitness contract that exercises it is shared too: [`ServiceInfoVersioningContractTestsBase<TFixture>`](group-27-testing-infrastructure.md#serviceinfoversioningcontracttestsbasetfixture) (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/ServiceInfoVersioningContractTestsBase.cs:19`) asserts the v1 minimal shape plus the `api-deprecated-versions` header (`ServiceInfoVersioningContractTestsBase.cs:28-38`) and the v2 evolved shape plus `api-supported-versions` (`ServiceInfoVersioningContractTestsBase.cs:44-54`), and a repo subclasses it supplying only its fixture.

### IEntityControllerBase<TEntityDTO, TIdentifierType>

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/IEntityControllerBase.cs:14` · Level 2 · interface

- **What it is**: the contract every read-only entity controller implements, four GET-shaped methods for all-entities, paged, lookup, and by-id retrieval.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](#ibasedtotidentifiertype) (constraint), [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), [`BaseLookup<TIdentifierType>`](#baselookuptidentifiertype), and [`QueryFilterModelBinder`](#queryfiltermodelbinder) for the filter parameter.
- **Concept introduced: the generic entity-controller contract.** `[Rubric §9, API & Contract Design]` assesses uniform endpoint conventions across every entity, and this interface is the guarantee that all read controllers expose the same four GET shapes. `[Rubric §1, SOLID]`: it is deliberately the read-only slice, kept separate from the create/delete slice ([`IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>`](#iaggregaterootentitycontrollerbasetentitydto-tidentifiertype-tcreaterequest)) so a child-collection controller can implement reads without inheriting mutation endpoints (Interface Segregation).
- **Walkthrough**: the type constrains `TEntityDTO : IBaseDTO<TIdentifierType>` and `TIdentifierType : notnull` (`IEntityControllerBase.cs:17-18`). The members:
  - `GetAllAsync` unpaged (`IEntityControllerBase.cs:26`), with `fields` projection (`[FromQuery]`) and the two eager-load flags.
  - the paged `GetAllAsync` overload (`IEntityControllerBase.cs:43`), adding `sortColumn`/`sortDirection`, `[Range(1, int.MaxValue)]`-guarded `pageNumber`/`pageSize` (`IEntityControllerBase.cs:49-50`), and a `Dictionary<string, (string Operator, string Value)>` of filters bound by [`QueryFilterModelBinder`](#queryfiltermodelbinder) (`IEntityControllerBase.cs:51`).
  - `GetAllForLookupAsync` for id/label dropdown data (`IEntityControllerBase.cs:58`).
  - `GetByIdAsync` (`IEntityControllerBase.cs:69`), whose `includeFKs` defaults to `true` for the single-entity case (`IEntityControllerBase.cs:71`) while the collection endpoints default it to `false` (`IEntityControllerBase.cs:28` and `IEntityControllerBase.cs:44`).
- **Why it's built this way**: expressing the surface as an interface lets architecture tests and OpenAPI tooling reason about the contract independently of the concrete generic base, and lets the two-level controller hierarchy layer capabilities without collapsing reads and writes into one type. Note what is deliberately **absent**: the CSV `ExportAsync` action added to the generic base is a base-class method only, and this interface still declares exactly four members (`IEntityControllerBase.cs:26`, `:43`, `:58`, `:69`). Adding a fifth would be a breaking change for any consumer implementing the interface explicitly instead of inheriting the base, and a default interface member would hide that break behind a runtime surprise ([ADR-078](https://ivanball.github.io/docs/adr/078-csv-export-endpoint.html)).
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
- **Why it's built this way**: one `virtual` method instead of a `switch` in every action removes duplication and makes the response shape uniform ([ADR-013](https://ivanball.github.io/docs/adr/013-result-pattern.html) for why failures are values rather than exceptions in the first place); keeping it `virtual` lets a subclass ([`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype)) wrap it with logging without reimplementing the mapping. The two `ErrorHttpMapping` members are `internal static` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:36` and `ErrorHttpMapping.cs:47`), which is what lets [`UnhandledResultFailureFilter`](#unhandledresultfailurefilter) reuse the same status-code mapping and the same `errors` extension array for a failed `Result` that an action returned without calling `HandleFailure` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/UnhandledResultFailureFilter.cs:36` and `UnhandledResultFailureFilter.cs:47`). The two bodies are deliberately *not* identical: the filter labels its `ProblemDetails` `Title`/`Detail` "Unhandled result failure" / "The action returned a Result.Failure that was not mapped to an HTTP error response." (`UnhandledResultFailureFilter.cs:42-43`) against the base's "Operation failed" / "One or more errors occurred." (`ApiControllerBase.cs:43-44`), so a response that fell through the filter is distinguishable from one the controller mapped on purpose. Localization is the [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) extension point, keyed by `Error.Code` and leaving `Code`/`Type`/`Source`/`Target` verbatim so clients can still branch on them (`ErrorHttpMapping.cs:47-55`).
- **Where it's used**: the root of the controller hierarchy. [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype), [`AuthControllerBase`](#authcontrollerbase), and every module controller derive from it directly or transitively.

### IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/IAggregateRootEntityControllerBase.cs:15` · Level 3 · interface

- **What it is**: the read-write extension of [`IEntityControllerBase<TEntityDTO, TIdentifierType>`](#ientitycontrollerbasetentitydto-tidentifiertype): it adds `CreateAsync` and `DeleteAsync` for aggregate-root entities.
- **Depends on**: [`IEntityControllerBase<TEntityDTO, TIdentifierType>`](#ientitycontrollerbasetentitydto-tidentifiertype) (base interface), [`IBaseDTO<TIdentifierType>`](#ibasedtotidentifiertype) and [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) (constraints).
- **Concept**: the write half of the segregated controller contract introduced by [`IEntityControllerBase<TEntityDTO, TIdentifierType>`](#ientitycontrollerbasetentitydto-tidentifiertype). `[Rubric §1, SOLID]`: only aggregate roots get a create/delete surface (`TCreateRequest : ICreateRequest`, `IAggregateRootEntityControllerBase.cs:22`), so child-collection controllers that implement only the read interface never expose mutation they should not own. `[Rubric §9, API & Contract Design]`: create returns the created DTO with a 201, delete returns 204, a consistent verb-to-status contract.
- **Walkthrough**: extends the read interface (`IAggregateRootEntityControllerBase.cs:19`) and adds two members: `CreateAsync([Required] TCreateRequest request, ...)` returning the created DTO with 201 (`IAggregateRootEntityControllerBase.cs:28-30`), and `DeleteAsync(TIdentifierType id, ...)` returning 204 No Content (`IAggregateRootEntityControllerBase.cs:36-38`).
- **Where it's used**: implemented by [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest).

### EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:34` · Level 6 · class (abstract)

- **What it is**: the generic read-only controller that gives any entity five working REST endpoints (`GET /`, `GET /paged`, `GET /export`, `GET /lookup`, `GET /{id}`) with filtering, sorting, pagination, and field projection, by delegating to the [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype) pipeline.
- **Depends on**: [`ApiControllerBase`](#apicontrollerbase) (base), [`IEntityControllerBase<TEntityDTO, TIdentifierType>`](#ientitycontrollerbasetentitydto-tidentifiertype) (implements), [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (constraint), [`IApplicationSettings`](group-14-module-system-composition.md#iapplicationsettings), [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), [`BaseLookup<TIdentifierType>`](#baselookuptidentifiertype), [`QueryFilterModelBinder`](#queryfiltermodelbinder), [`Error`](group-01-result-error-handling.md#error), [`CsvWriter`](#csvwriter), [`QueryFieldService`](group-03-querying-specifications.md#queryfieldservice), and [`Specification<TEntity, TIdentifierType>`](group-03-querying-specifications.md#specificationtentity-tidentifiertype); ASP.NET Core MVC, `Asp.Versioning`, `System.Text.Json`, `System.Reflection`, `TimeProvider`, and `ILogger`.
- **Concept introduced: generic controller bases that eliminate CRUD boilerplate.** `[Rubric §9, API & Contract Design]` covers uniform endpoint conventions; `[Rubric §1, SOLID]` covers the Open/Closed side, since a new entity controller extends this base rather than re-writing the endpoints. The class-level `[ApiController]`, `[Route("[controller]")]`, `[ApiVersion("1.0")]` (`EntityControllerBase.cs:31-33`) plus the three generic constraints (`EntityControllerBase.cs:41-43`) turn the type parameters into the contract: name the entity, the DTO, and the identifier alias, and the routes, the versioning, and the query behavior follow ([ADR-034](https://ivanball.github.io/docs/adr/034-generic-entity-query-layer.html)).
- **Walkthrough**
  - Primary constructor (`EntityControllerBase.cs:34-40`) takes the query service and an `ILogger`, both null-guarded into the `QueryService` (`EntityControllerBase.cs:45`) and `Logger` (`EntityControllerBase.cs:50`) protected properties.
  - `MaxPageSize` (`EntityControllerBase.cs:56-63`) resolves [`IApplicationSettings`](group-14-module-system-composition.md#iapplicationsettings) per-request from `HttpContext.RequestServices`, falling back to 500 (`EntityControllerBase.cs:61`). Per-request resolution means a settings change takes effect without a restart. `MaxExportRows` (`EntityControllerBase.cs:76-84`) does the same for the export ceiling, with the extra rule that a configured value of zero or less is treated as unconfigured (`EntityControllerBase.cs:82`), because a cap of zero would silently serve every caller a header-only file. `EntityName` (`EntityControllerBase.cs:89`) is `typeof(TEntity).Name`, used in log messages.
  - `GetAllAsync` unpaged (`EntityControllerBase.cs:103`, `[HttpGet]` at `EntityControllerBase.cs:100`): delegates to the query service with `pageNumber: 1` and `pageSize: MaxPageSize` (`EntityControllerBase.cs:114-115`), so even the "all" endpoint is capped, then either `HandleFailure` or `Ok`.
  - `GetAllAsync` paged (`EntityControllerBase.cs:143`, `[HttpGet("paged")]` at `EntityControllerBase.cs:139`): clamps with `Math.Min(pageSize, MaxPageSize)` (`EntityControllerBase.cs:154`), and on success serializes [`PaginationMetadata`](group-01-result-error-handling.md#paginationmetadata) into the `X-Pagination` response header (`EntityControllerBase.cs:171`) rather than mixing it into the body, `[Rubric §9]` again, and `[Rubric §12, Performance & Scalability]` for the clamp.
  - `ExportAsync` (`EntityControllerBase.cs:234`, `[HttpGet("export")]` at `EntityControllerBase.cs:230`) is covered as its own concept below.
  - `GetAllForLookupAsync` (`EntityControllerBase.cs:350`, `[HttpGet("lookup")]` at `EntityControllerBase.cs:347`): returns `CollectionResult<BaseLookup<TIdentifierType>>`, a lightweight id/label pair, with a `[Required]` `nameProperty` (`EntityControllerBase.cs:351`) choosing the label.
  - `GetByIdAsync` (`EntityControllerBase.cs:382`, `[HttpGet("{id}")]` at `EntityControllerBase.cs:377`): `includeFKs` defaults to `true` for the single-entity case (`EntityControllerBase.cs:384`).
  - `HandleFailure` override (`EntityControllerBase.cs:409-423`): logs the first error at Warning, guarded by `Logger.IsEnabled` (`EntityControllerBase.cs:412`), before delegating to [`ApiControllerBase`](#apicontrollerbase)`.HandleFailure`, so the read path gets observability (`[Rubric §13, Observability & Operability]`) without changing the response mapping.
  - Every read action passes `asTracking: false` to the query service (for example `EntityControllerBase.cs:116`), because a read endpoint never mutates what it loaded.
- **Concept introduced: streaming a bulk extract from a paged read.** `[Rubric §12, Performance & Scalability]` assesses whether a large response is bounded and whether memory grows with the result set; `[Rubric §11, Security]` covers who may pull a whole table in one request. `ExportAsync` answers the "export what you filtered" request without any new query path ([ADR-078](https://ivanball.github.io/docs/adr/078-csv-export-endpoint.html)):
  - **A dedicated route, not content negotiation** (`[HttpGet("export")]`, `EntityControllerBase.cs:230`). The remarks name the two behaviors that make an `Accept: text/csv` formatter wrong here (`EntityControllerBase.cs:182-188`): the public output-cache policy varies by query string but not by `Accept`, so a cached JSON body could be replayed to a CSV request, and `AddAPI` sets `ReturnHttpNotAcceptable = false` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:48`), so a negotiation miss falls back to JSON silently instead of returning 406. A distinct path has neither failure mode.
  - **Field validation before a byte moves** (`EntityControllerBase.cs:242-244`): `ValidateExportFields` (`EntityControllerBase.cs:547`) rejects a `fields=` request naming a property the CSV cannot render, as an `Error.InvalidEntityField` failure (`EntityControllerBase.cs:556-560`), rather than quietly dropping the column.
  - **Row scoping through a hook**: `GetExportSpecification()` (`EntityControllerBase.cs:488`) returns `null` by default and is resolved once, before the first page (`EntityControllerBase.cs:247`), so the same instance filters every page. The remarks are blunt about the consequence (`EntityControllerBase.cs:471-477`): a controller whose list endpoints row-scope reads MUST override this, and leaving it at the default on such a controller hands every caller the whole table.
  - **The page loop** (`EntityControllerBase.cs:263-328`) calls the same `QueryService.GetAllAsync` the paged route uses, at `pageSize = Math.Max(1, MaxPageSize)` (`EntityControllerBase.cs:250`), writing each page out as it materializes. Three termination conditions are distinguished on purpose: a short page is the last page (`EntityControllerBase.cs:316-317`), stopping mid-page means rows were left behind (`EntityControllerBase.cs:309-313`), and a cap landing exactly on a page boundary consults `PaginationMetadata.TotalItemCount` rather than issuing a wasted extra query (`EntityControllerBase.cs:321-325`).
  - **Headers first, then body** (`BeginExportResponse`, `EntityControllerBase.cs:570`): content type `text/csv; charset=utf-8` (`EntityControllerBase.cs:433`), a `Content-Disposition` attachment whose file name is `{controller}-{yyyyMMdd'T'HHmmss'Z'}.csv` built invariantly from an injected `TimeProvider` (`EntityControllerBase.cs:572`, `BuildExportFileName` at `:586-589`, prefix at `:451-463`), and `X-Export-Row-Limit` (`EntityControllerBase.cs:439`, appended at `:576`) so a client can tell "exactly at the limit" from "coincidentally that many rows".
  - **Truncation rides in the body.** Headers freeze the moment the first body byte flushes, so a truncated export ends with a `# export truncated at N rows` record (`EntityControllerBase.cs:330-333`, marker at `:699-700`) and a mid-stream query failure ends with `# export incomplete after N rows` (`EntityControllerBase.cs:286-288`, marker at `:705-706`) plus a Warning log (`LogExportPageFailure`, `EntityControllerBase.cs:714`). A failure on the FIRST page, before anything was written, still returns Problem Details through `HandleFailure` (`EntityControllerBase.cs:280-281`), which is exactly what the "construct the writer but commit nothing" comment protects (`EntityControllerBase.cs:257-259`).
  - **Column resolution is derived, not invented**: `ResolveExportColumns` (`EntityControllerBase.cs:636`) takes the shaped keys of the first row, so the CSV columns for a given `fields=` request are the same camelCase JSON names the JSON endpoints emit; an empty result still gets a header row built from the DTO's own properties in declaration order (`EntityControllerBase.cs:646-654`). `UnexportablePropertyNames` (`EntityControllerBase.cs:501-507`) drops the properties that cannot render a faithful scalar cell, `byte[]`/`ReadOnlyMemory<byte>` concurrency tokens and every collection type except `string` (`IsExportableType`, `EntityControllerBase.cs:529-532`), computed once per closed controller type since a DTO's shape cannot change at runtime.
- **Why it's built this way**: the controller stays thin. All filtering/sorting/paging lives in [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype), and manual DTO mapping ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)) keeps entities off the wire. The controller only translates HTTP concerns: query strings, headers, status codes. The export reuses the paged read wholesale precisely so it cannot disagree with the grid it was launched from, and the row ceiling (`DefaultMaxExportRows = 100_000`, `EntityControllerBase.cs:430`, matching `ApplicationSettings.MaxExportRows`'s own default at `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/ApplicationSettings.cs:29`) is a number an operator can reason about rather than an unbounded connection hold.
- **Caveats / not-in-source**: [ADR-078](https://ivanball.github.io/docs/adr/078-csv-export-endpoint.html) describes truncation as signalled by an `X-Export-Truncated: true` response header; the shipped code sends no such header. It always sends `X-Export-Row-Limit` instead and carries the truncation fact in the trailing body record, with the remarks stating why a header cannot work (`EntityControllerBase.cs:196-203`). Trust the code. The export is also **not** output-cached and inherits only whatever `[Authorize]`/`[FeatureGate]` the derived controller declares (`EntityControllerBase.cs:189-194`).
- **Where it's used**: the base for every read-only module controller, for example ADC's child-collection controllers `SessionSpeakersController` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionSpeakersController.cs:47`, base list at `SessionSpeakersController.cs:55`) and `CategoryItemsController` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/CategoryItemsController.cs:61`, base list at `CategoryItemsController.cs:68`). Extended by [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest) for entities that also create and delete. The `GetExportSpecification` hook is overridden today by Store's owner-scoped controllers: `OrdersController` (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/OrdersController.cs:241`, class at `OrdersController.cs:47`) and `ShoppingCartsController` (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/ShoppingCartsController.cs:224`, class at `ShoppingCartsController.cs:50`). Framework coverage lives in [`EntityControllerBaseTests`](group-27-testing-infrastructure.md#entitycontrollerbasetests) and [`EntityControllerBaseExportTests`](group-27-testing-infrastructure.md#entitycontrollerbaseexporttests) (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Controllers/EntityControllerBaseExportTests.cs:23`, whose double overrides the specification hook at `EntityControllerBaseExportTests.cs:509`).

### OAuthControllerBase

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:32` · Level 6 · class (abstract)

- **What it is**: the base controller for external OAuth2 sign-in (Google, GitHub). It runs the challenge/callback/complete/exchange dance so a browser or native head can log in through a provider and receive a local JWT pair without ever exposing tokens in a redirect URL.
- **Depends on**: [`IAuthenticationService`](group-08-auth.md#iauthenticationservice) (`ExternalLoginAsync`), [`ICacheService`](group-09-caching.md#icacheservice), `IConfiguration`, [`ExternalAuthExtensions`](#externalauthextensions) (the scheme constant, `OAuthControllerBase.cs:37`, defined as `"ExternalLogin"` at `MMCA.Common/Source/Presentation/MMCA.Common.API/Authentication/ExternalAuthExtensions.cs:27`), [`AuthenticationResponse`](group-08-auth.md#authenticationresponse), [`OAuthCodeExchangeRequest`](group-08-auth.md#oauthcodeexchangerequest), and [`Error`](group-01-result-error-handling.md#error); the Google/GitHub OAuth packages and `System.Security.Cryptography`.
- **Concept introduced: the code-exchange OAuth completion pattern.** `[Rubric §11, Security]` assesses how credentials move through the system; the design's whole point is that the redirect after a successful provider login carries only a single-use opaque code, never the access/refresh tokens, so tokens never land in the address bar, browser history, the `Referer` header, or upstream access logs (`OAuthControllerBase.cs:113-115`). `[Rubric §7, Microservices Readiness]`: the base is hoisted from the app hosts so every service reuses the identical flow, with the sealed subclass supplying only `[Route("auth/oauth")]` and versioning (class doc, `OAuthControllerBase.cs:28-31`). See [ADR-036](https://ivanball.github.io/docs/adr/036-external-oauth-login.html).
- **Walkthrough**
  - `OAuthExchangeCodePrefix` and a 2-minute `OAuthExchangeCodeLifetime` (`OAuthControllerBase.cs:42-43`) namespace and time-box the server-side token stash; the short TTL matches the single redirect-then-POST round trip.
  - `GoogleLogin` (`OAuthControllerBase.cs:50`) and `GitHubLogin` (`OAuthControllerBase.cs:58`) both call `ChallengeProvider` (`OAuthControllerBase.cs:258`), which stashes `returnUrl` in `AuthenticationProperties.Items` and sets `RedirectUri = "/auth/oauth/complete"` (`OAuthControllerBase.cs:262-263`).
  - `CompleteAsync` (`OAuthControllerBase.cs:75`): after the middleware handles the provider callback, this reads the external cookie (`OAuthControllerBase.cs:78`), redirects to `/login?error=oauth_failed` when the ticket did not survive (`OAuthControllerBase.cs:80-85`), reads the stashed `returnUrl` with a `GetString` fallback to `"/"` rather than the throwing `Items` indexer (`OAuthControllerBase.cs:87-90`), extracts provider claims (`ExtractClaims`, `OAuthControllerBase.cs:171`), calls `ExternalLoginAsync` to find/create the local user and mint tokens (`OAuthControllerBase.cs:100-101`), signs out the temporary external cookie (`OAuthControllerBase.cs:111`), then mints a 32-byte hex `exchangeCode` (`OAuthControllerBase.cs:116`), stashes the token pair in the cache under it (`OAuthControllerBase.cs:117-118`), and redirects with only the code (`OAuthControllerBase.cs:120`).
  - Name handling is defensive: `ExtractName` prefers `GivenName`/`Surname` claims and otherwise splits the `Name` claim, falling back to `("User", "")` when there is no usable space-separated name (`OAuthControllerBase.cs:181-209`), so a provider that returns only a display name still yields a creatable local account.
  - Native heads ([ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)): `GetAllowedMobileReturnUrl` (`OAuthControllerBase.cs:233`) returns the stashed `returnUrl` as the redirect target only when it is an absolute URI whose custom scheme is listed in `OAuth:AllowedReturnUrlSchemes`; http/https never match (`OAuthControllerBase.cs:236-237`), so the allowlist cannot become an open redirect, and a missing or empty section (or a test double returning `null` from `GetSection`) means "no allowlist", the exact pre-ADR-043 behavior (`OAuthControllerBase.cs:242-246`).
  - `ExchangeAsync` (`OAuthControllerBase.cs:138`): `[HttpPost("exchange")]` + `[AllowAnonymous]` (`OAuthControllerBase.cs:135-136`); the UI swaps the code for the real [`AuthenticationResponse`](group-08-auth.md#authenticationresponse) out-of-band. Because that response is a `readonly record struct` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/AuthenticationResponse.cs:10`), a cache miss yields a default value rather than `null`, so the miss is detected via an empty `AccessToken` (`OAuthControllerBase.cs:152`). The code is then removed (`OAuthControllerBase.cs:158`), making it single-use so a leaked or replayed code cannot mint a second token pair. Both failure paths return the same opaque 400 "Invalid sign-in code" (`OAuthControllerBase.cs:163-169`).
- **Why it's built this way**: carrying tokens in a redirect is the classic OAuth token-leak vector; the single-use code plus a short-lived server-side stash closes it while keeping the client flow a plain redirect and one POST. The `AppendQuery` helper (`OAuthControllerBase.cs:249`) deliberately uses `OriginalString` rather than `ToString()`, because `Uri` normalization appends a trailing slash to authority-only URIs (`atldevcon://oauth-complete`) and native authenticator callback matching can be exact (`OAuthControllerBase.cs:251-253`).
- **Caveats / not-in-source**: the provider scheme registration and the concrete `ExternalLoginAsync` implementation live outside this base ([`ExternalAuthExtensions`](#externalauthextensions) and the app's [`IAuthenticationService`](group-08-auth.md#iauthenticationservice)); this file assumes both are wired.
- **Where it's used**: subclassed by each app's sealed OAuth controller, for example ADC's `OAuthController` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/OAuthController.cs:20`, with `[Route("auth/oauth")]` and `[ApiVersion("1.0")]` at `OAuthController.cs:18-19`), which adds only those class-level attributes.

### AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AggregateRootEntityControllerBase.cs:27` · Level 7 · class (abstract)

- **What it is**: the read-write tier of the controller hierarchy. It extends [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype) (the read endpoints) by adding a `CreateAsync` (POST) and a `DeleteAsync` (DELETE) for aggregate-root entities.
- **Depends on**: [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype) (base), [`IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>`](#iaggregaterootentitycontrollerbasetentitydto-tidentifiertype-tcreaterequest) (implements), [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) (create and delete handlers), [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype), [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) (constraint), [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) (constraint), [`IdempotentAttribute`](#idempotentattribute); ASP.NET Core MVC and `Asp.Versioning`.
- **Concept introduced: idempotent creation guarded at the endpoint.** `[Rubric §9, API & Contract Design]` assesses safe mutation; `CreateAsync` carries `[Idempotent]` (`AggregateRootEntityControllerBase.cs:59`), which wires [`IdempotencyFilter`](#idempotencyfilter) so a retried POST carrying the same `Idempotency-Key` replays the original 201 (flagged `X-Idempotent-Replay: true`, `MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:39`) instead of creating a duplicate aggregate, exactly what mobile and flaky-network clients need. A duplicate that arrives while the first request is still running and cannot take the lock within the 5-second `LockWait` (`IdempotencyFilter.cs:106`) is answered with 409 Conflict rather than a replay (`IdempotencyFilter.cs:306-311`). `[Rubric §1, SOLID]`: the four constraints (`AggregateRootEntityControllerBase.cs:40-43`, notably `TEntity : AuditableAggregateRootEntity<TIdentifierType>`) enforce at compile time that only aggregate roots reach this create/delete surface.
- **Walkthrough**
  - Primary constructor (`AggregateRootEntityControllerBase.cs:27-38`): four parameters, where `queryService` and `logger` are forwarded to the [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype) base (`AggregateRootEntityControllerBase.cs:38`), plus `createHandler` and `deleteHandler`. The `logger` is typed `ILogger<EntityControllerBase<...>>`, not of this class, because `ILogger<T>` is not covariant and the base ctor requires that exact type; the `#pragma warning disable S6672` (`AggregateRootEntityControllerBase.cs:35-37`) is a justified, narrowly-scoped suppression documenting exactly that (`[Rubric §15, Best Practices]`).
  - `CreateHandler` property (`AggregateRootEntityControllerBase.cs:48`): `protected`, so a derived controller that overrides `CreateAsync` to build a more specific command can still reach the handler. `deleteHandler` stays a captured constructor parameter, used directly at `AggregateRootEntityControllerBase.cs:93`, because nothing overrides delete today.
  - `CreateAsync` (`AggregateRootEntityControllerBase.cs:63-76`): `[HttpPost]` + `[Idempotent]` (`AggregateRootEntityControllerBase.cs:58-59`), body bound `[FromBody, Required]` (`AggregateRootEntityControllerBase.cs:64`); it dispatches the create command and on success returns `CreatedAtRoute($"Get{typeof(TEntity).Name}ById", new { id = result.Value!.Id }, result.Value)` (`AggregateRootEntityControllerBase.cs:72-75`), following the `"Get{Entity}ById"` route-name convention derived controllers establish (`AggregateRootEntityControllerBase.cs:69`). On failure it maps errors via `HandleFailure`.
  - `DeleteAsync` (`AggregateRootEntityControllerBase.cs:89-98`): `[HttpDelete("{id}")]` (`AggregateRootEntityControllerBase.cs:84`); builds a [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype), dispatches it, and returns `NoContent()` on success. Delete here means soft-delete: the handler loads the aggregate and calls its `Delete()` method (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/DeleteEntityHandler.cs:30`), so the domain, not the controller, decides whether the removal is allowed.
- **Why it's built this way**: splitting the read-only base from the aggregate-root base means a child-collection controller (add/remove associations, not create whole aggregates) can extend the read base without inheriting create/delete it should not expose (`[Rubric §1, SOLID]`, Interface Segregation), while the actual work stays in injected Application-layer handlers (`[Rubric §3, Clean Architecture]`) that the CQRS decorator pipeline already wraps with validation, transactions, and cache invalidation ([ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)).
- **Where it's used**: concrete aggregate controllers in the modules extend this, for example ADC's `EventsController` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/EventsController.cs:44`, base list at `EventsController.cs:57`), `SessionsController` (`SessionsController.cs:42`, base list at `SessionsController.cs:54`), and `SpeakersController` (`SpeakersController.cs:44`, base list at `SpeakersController.cs:59`); child-only controllers deliberately extend the read-only base instead.

### AuthControllerBase

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:40` · Level 10 · class (abstract)

- **What it is**: the abstract base for password-based authentication endpoints: login, register, refresh, and revoke. A downstream module (Identity) inherits it and adds the route prefix, version attribute, and any module-specific endpoints.
- **Depends on**: [`ApiControllerBase`](#apicontrollerbase) (base), [`IAuthenticationService`](group-08-auth.md#iauthenticationservice) and [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) (injected), [`LoginRequest`](group-08-auth.md#loginrequest), [`RegisterRequest`](group-08-auth.md#registerrequest), [`RefreshTokenRequest`](group-08-auth.md#refreshtokenrequest), [`AuthenticationResponse`](group-08-auth.md#authenticationresponse), and the `RateLimitPolicyAuthIp` constant on [`WebApplicationBuilderExtensions`](#webapplicationbuilderextensions); `Microsoft.AspNetCore.RateLimiting` for `[EnableRateLimiting]`.
- **Concept introduced: a secure-by-default base, not just a shared one.** `[Rubric §9, API & Contract Design]` assesses uniform endpoint conventions and `[Rubric §1, SOLID]` the Open/Closed angle (the base provides `virtual` endpoints, a derived controller overrides only what differs), but the load-bearing idea here is `[Rubric §11, Security]`: anti-spray throttling is **on by default**. `LoginAsync` and `RegisterAsync` carry `[EnableRateLimiting(WebApplicationBuilderExtensions.RateLimitPolicyAuthIp)]` (`AuthControllerBase.cs:55` and `AuthControllerBase.cs:76`), so any consumer inheriting this base gets per-IP protection without opting in. The class doc (`AuthControllerBase.cs:17-26`) records why: the earlier arrangement shipped the policy in the framework and left each app to attach it, and an app that simply inherited these actions silently had no spray protection at all, because the global limiter deliberately no-ops for anonymous traffic and account lockout is per-email ([ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html), [ADR-029](https://ivanball.github.io/docs/adr/029-authentication-brute-force-protection.html)). All four actions otherwise share the same Result-to-ActionResult shape: call the service, check `result.IsFailure`, return `HandleFailure(result.Errors)` or the success result. None carries business logic; they are thin HTTP adapters over [`IAuthenticationService`](group-08-auth.md#iauthenticationservice).
- **Walkthrough**
  - Primary constructor (`AuthControllerBase.cs:40-42`) exposes `AuthenticationService` and `CurrentUserService` as `protected` properties (`AuthControllerBase.cs:45` and `AuthControllerBase.cs:48`) so derived controllers can reach them for extra endpoints.
  - `LoginAsync` (`AuthControllerBase.cs:59`): `[HttpPost("login")]`, `[AllowAnonymous]`, throttled per IP (`AuthControllerBase.cs:53-55`); returns `Ok` or `HandleFailure`. The `[ProducesResponseType]` attributes (`AuthControllerBase.cs:56-58`) feed the OpenAPI contract and include the 429 the limiter can now produce.
  - `RegisterAsync` (`AuthControllerBase.cs:81`): also anonymous and throttled (`AuthControllerBase.cs:74-76`); returns `StatusCode(StatusCodes.Status201Created, ...)` (`AuthControllerBase.cs:89`), correctly 201 Created for a new account rather than 200. It is `virtual` so a module can override it to inject extra context (the doc comment names client IP, `AuthControllerBase.cs:72`).
  - `RefreshAsync` (`AuthControllerBase.cs:99`): `[AllowAnonymous]` (`AuthControllerBase.cs:96`), since exchanging an expired token pair is pre-authentication, and deliberately **not** throttled (`AuthControllerBase.cs:27-33`): refresh is automatic and periodic rather than user-initiated, Blazor Server circuits issue it server-side so every Server-circuit user shares the UI host's IP, and refresh tokens are high-entropy, so brute force is not the threat password spraying is.
  - `RevokeAsync` (`AuthControllerBase.cs:117`): `[Authorize]` (`AuthControllerBase.cs:114`); reads `CurrentUserService.UserId`, returns `Unauthorized()` if null (`AuthControllerBase.cs:119-121`) as a defensive guard even though `[Authorize]` should already prevent a null id, then revokes and returns `NoContent()` (`AuthControllerBase.cs:123-127`).
- **Why it's built this way**: `[Rubric §16, Maintainability]`: adding a new token flow means changing one base, not N module controllers; keeping the four methods `virtual` (rather than the class open-ended) keeps the override surface intentional. The rate-limit default is deliberately a *loud* dependency: a consumer that inherits this base without calling `AddCommonRateLimiting()` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:162`, which registers the `"auth-ip"` policy at `WebApplicationBuilderExtensions.cs:199-201`, constant defined at `WebApplicationBuilderExtensions.cs:41`, with an `authIpPermitLimit` default of 30 requests per minute per IP at `WebApplicationBuilderExtensions.cs:162` over the one-minute window at `WebApplicationBuilderExtensions.cs:101`) fails at startup on an unregistered policy rather than silently serving unthrottled logins (`AuthControllerBase.cs:34-38`).
- **Caveats / not-in-source**: the per-IP partition keys on `Connection.RemoteIpAddress` and deliberately does **not** limit when that address is null (in-process `TestServer`, integration tests): `AuthIpRateLimitPartition` returns `RateLimitPartition.GetNoLimiter("__unknown-ip")` in that case (`WebApplicationBuilderExtensions.cs:93-98`), a fail-open posture matching the global limiter and documented at `WebApplicationBuilderExtensions.cs:87-92` and `WebApplicationBuilderExtensions.cs:191-198`.
- **Where it's used**: the base of every app's Identity `AuthController`, reached today through [`UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>`](#useraccountauthcontrollerbasetchangepasswordcommand-tchangepreferencescommand), which both ADC (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/AuthController.cs:29`) and Store (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/AuthController.cs:27`) extend. ADC's supplies `[Route("[controller]")]` and `[ApiVersion("1.0")]` (`AuthController.cs:27-28`), overrides `RegisterAsync` to pass the client IP (`AuthController.cs:52-58`), and re-declares `LoginAsync` to document the lockout 429 while delegating to `base.LoginAsync` (`AuthController.cs:76-79`). The framework's own coverage drives the base through a minimal test double, `TestAuthController` (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Controllers/AuthControllerBaseTests.cs:180`).

### UserAccountAuthControllerBase<TChangePasswordCommand, TChangePreferencesCommand>

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/UserAccountAuthControllerBase.cs:40` · Level 11 · class (abstract)

- **What it is**: [`AuthControllerBase`](#authcontrollerbase) plus the three self-service account endpoints every app needs once a user is signed in: `PUT password`, `PUT preferences`, and `GET preferences`. The app Identity modules previously carried line-identical copies of all three actions, and the only real difference between them was the command record each one constructed (class doc, `UserAccountAuthControllerBase.cs:14-19`).
- **Depends on**: [`AuthControllerBase`](#authcontrollerbase) (base, constructed with the same [`IAuthenticationService`](group-08-auth.md#iauthenticationservice) and [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) it forwards, `UserAccountAuthControllerBase.cs:46`), two [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) instances and one [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) (`UserAccountAuthControllerBase.cs:43-45`), [`IUserScopedCommand<out TRequest>`](group-14-module-system-composition.md#iuserscopedcommandout-trequest) as the constraint on both command type parameters (`UserAccountAuthControllerBase.cs:47-48`), [`ChangePasswordRequest`](group-08-auth.md#changepasswordrequest), [`ChangePreferencesRequest`](group-08-auth.md#changepreferencesrequest), [`GetUserPreferencesQuery`](group-14-module-system-composition.md#getuserpreferencesquery), [`UserPreferencesResponse`](group-08-auth.md#userpreferencesresponse), and [`Result`](group-01-result-error-handling.md#result); ASP.NET Core MVC and `Microsoft.AspNetCore.Authorization`.
- **Concept introduced: generic-over-the-command deduplication.** Two apps wanted the same HTTP surface but not the same command record: ADC's `ChangePasswordCommand` also implements [`ICacheInvalidating`](group-05-cqrs-pipeline.md#icacheinvalidating) with a cache prefix built from its own `User` type (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:15-18`), while Store's does not (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/UseCases/ChangePassword/ChangePasswordCommand.cs:12-13`), so one shared record could not preserve both behaviors (remarks, `UserAccountAuthControllerBase.cs:21-30`). The resolution is the classic Template Method: the base owns the HTTP shape and the dispatch, and defers *construction* of the app command to two abstract factory methods. `[Rubric §16, Maintainability]` assesses whether a change lands in one place; `[Rubric §1, SOLID]` covers both the Open/Closed extension point and the Dependency Inversion angle, since the base depends only on the `IUserScopedCommand<TRequest>` abstraction and never on either app's concrete record. `[Rubric §2, Design Patterns]`: the two `Create*Command` overrides are the pattern's primitive operations, and their implementations really are one line each (`=> new(userId, request);`).
- **Walkthrough**
  - Type parameters and constraints (`UserAccountAuthControllerBase.cs:40-48`): `TChangePasswordCommand : IUserScopedCommand<ChangePasswordRequest>` and `TChangePreferencesCommand : IUserScopedCommand<ChangePreferencesRequest>`. That constraint is the whole contract the base needs: a command that carries a user id and a request payload.
  - The three handlers become `protected` properties (`UserAccountAuthControllerBase.cs:51`, `:54`, `:57`), matching the base's convention so a derived controller can dispatch them itself for an extra endpoint.
  - `CreateChangePasswordCommand(userId, request)` (`UserAccountAuthControllerBase.cs:66-68`) and `CreateChangePreferencesCommand(userId, request)` (`UserAccountAuthControllerBase.cs:77-79`) are the two abstract factories. Both take a `UserIdentifierType`, the solution-wide identifier alias, so the base never has to know whether an app's user key is an `int` or a `Guid`.
  - `ChangePasswordAsync` (`UserAccountAuthControllerBase.cs:91`): `[HttpPut("password")]` + `[Authorize]` (`UserAccountAuthControllerBase.cs:86-87`). It reads `CurrentUserService.UserId`, returns `Unauthorized()` when null (`UserAccountAuthControllerBase.cs:95-97`), then dispatches `CreateChangePasswordCommand(userId.Value, request)` through the handler (`UserAccountAuthControllerBase.cs:99-101`) and returns `NoContent()` or `HandleFailure`. Note what is absent: no password verification, no hashing, no user lookup. Those live in the app's command handler, behind the CQRS decorator pipeline, so validation and the transaction wrap them ([ADR-014](https://ivanball.github.io/docs/adr/014-cqrs-decorator-pipeline.html)). The doc comment is explicit that this dispatches the handler directly rather than brokering through the authentication service (`UserAccountAuthControllerBase.cs:82-85`).
  - `ChangePreferencesAsync` (`UserAccountAuthControllerBase.cs:117`) mirrors it at `[HttpPut("preferences")]` (`UserAccountAuthControllerBase.cs:112`): the stored UI culture and theme ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html), [ADR-028](https://ivanball.github.io/docs/adr/028-dark-theme-mode.html)) follow the user across devices, and a null field leaves that preference unchanged (`UserAccountAuthControllerBase.cs:108-111`).
  - `GetPreferencesAsync` (`UserAccountAuthControllerBase.cs:142`): `[HttpGet("preferences")]` (`UserAccountAuthControllerBase.cs:138`). This one constructs its query inline, `new GetUserPreferencesQuery(userId.Value)` (`UserAccountAuthControllerBase.cs:150`), because the read side has no per-app detail to preserve; the remarks call that asymmetry out deliberately (`UserAccountAuthControllerBase.cs:28-29`).
  - All three actions repeat the same `UserId is null -> Unauthorized()` guard rather than trusting `[Authorize]` alone, the same defensive posture [`AuthControllerBase`](#authcontrollerbase)`.RevokeAsync` takes.
- **Why it's built this way**: inheriting this base instead of [`AuthControllerBase`](#authcontrollerbase) is purely additive (remarks, `UserAccountAuthControllerBase.cs:31-36`): every inherited login/register/refresh/revoke action, including the default per-IP throttling and the ability to override `RegisterAsync` or attach another `[EnableRateLimiting]` policy app-side, behaves exactly as before. That is what made the consolidation safe to do at all. The alternative (pushing the command records into the framework) would have forced ADC's cache-invalidation behavior onto Store or dropped it from ADC. `[Rubric §14, Testability]`: because the extension point is two abstract methods rather than a service lookup, the framework can exercise the whole base with a test double supplying trivial commands.
- **Where it's used**: extended by each app's Identity `AuthController`: ADC's (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/AuthController.cs:29`, base list at `AuthController.cs:35`, with the two one-line factory overrides at `AuthController.cs:82-89`) and Store's (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/AuthController.cs:27`, base list at `AuthController.cs:33`, factory overrides at `AuthController.cs:65-70`). Covered in the framework by [`UserAccountAuthControllerBaseTests`](group-27-testing-infrastructure.md#useraccountauthcontrollerbasetests) (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Controllers/UserAccountAuthControllerBaseTests.cs:16`), which drives the base through the `TestUserAccountAuthController` double (`UserAccountAuthControllerBaseTests.cs:252`).

### ErrorResourceSource

> MMCA.Common.API · `MMCA.Common.API.Localization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Localization/ErrorResourceSource.cs:12` · Level 0 · class (sealed)

- **What it is**: one registered resource set that [`IErrorLocalizer`](#ierrorlocalizer) consults when translating an error code. It is a thin wrapper around a single `IStringLocalizer`, which is itself backed by one `.resx` family. Common registers one for its own [`ErrorResources`](#errorresources) anchor; each module registers its own additively.
- **Depends on**: `Microsoft.Extensions.Localization.IStringLocalizer` (BCL/extensions); produced from a resource anchor type such as [`ErrorResources`](#errorresources).
- **Concept introduced: an ordered, additive localization registry.** The alternative design is one global resource file that every module has to edit. Instead, the framework registers a *set* of `ErrorResourceSource` instances into DI, Common's first and each module's after it, and the localizer walks that set returning the first match. The wrapper type exists purely so DI can hold several `IStringLocalizer`s as a distinguishable `IEnumerable<ErrorResourceSource>` (a bare `IEnumerable<IStringLocalizer>` would collide with every other localizer in the container). `[Rubric §27, i18n]` assesses whether user-facing text is externalized and extensible per feature; the additive set means adding a module never touches Common's resources. `[Rubric §7, Microservices Readiness]` assesses whether a module can be lifted out intact; because the module owns its own source registration, an extracted service carries its own translations with it. See [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html).
- **Walkthrough**: the whole type is a primary-constructor class taking `IStringLocalizer localizer` (`ErrorResourceSource.cs:12`) and exposing it as a single get-only property, `public IStringLocalizer Localizer { get; } = localizer` (`ErrorResourceSource.cs:15`). There is no behavior; the enumeration and first-match logic live in [`ErrorLocalizer`](#errorlocalizer).
- **Why it's built this way**: registration order is the priority order, and a distinct wrapper type is what makes that order expressible in the container. `AddErrorResources<TResource>()` registers each one as a singleton whose factory asks `IStringLocalizerFactory.Create(typeof(TResource))` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:105-106`), so the anchor type is the only thing a module has to supply.
- **Where it's used**: injected as `IEnumerable<ErrorResourceSource>` into [`ErrorLocalizer`](#errorlocalizer) (`ErrorLocalizer.cs:11`). Common's own source is registered inside `AddErrorLocalization()` (`DependencyInjection.cs:92`), which `AddAPI` calls automatically (`DependencyInjection.cs:77`); modules add theirs by calling `AddErrorResources<TResource>()` (`DependencyInjection.cs:103`).

### IdempotencyMetrics

> MMCA.Common.API · `MMCA.Common.API.Idempotency` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyMetrics.cs:16` · Level 0 · class (internal static)

- **What it is**: the three OpenTelemetry counters that make the idempotency filter observable: how often a stored response was replayed, how often a duplicate was refused, and how often the filter ran *without* its guarantee because the cache or the lock was unhealthy.
- **Depends on**: `System.Diagnostics.Metrics` (`Meter`, `Counter<long>`) from the BCL only. Consumed by [`IdempotencyFilter`](#idempotencyfilter); the meter is exported by the Aspire service defaults.
- **Concept introduced: metering a degradable cross-cutting filter.** `[Rubric §13, Observability & Operability]` assesses whether an operator can tell that a mechanism is still doing its job. That matters here more than for most filters because [`IdempotencyFilter`](#idempotencyfilter) is deliberately best-effort: when its cache or its lock faults, it swallows the fault and lets the request run unguarded rather than failing the write. Without a counter that failure mode is *invisible*, since every request still succeeds, so a Redis outage would silently turn deduplication off across the fleet. `idempotency.degraded` is the signal that turns that silence into an alertable number, and the class doc says so directly (`IdempotencyMetrics.cs:64-67`). `[Rubric §10, Cross-Cutting]` applies because instrument names and tag names are centralized in one type rather than being restated at each call site (`IdempotencyMetrics.cs:12-15`).
- **Walkthrough**
  - `MeterName = "MMCA.Common.Idempotency"` (`IdempotencyMetrics.cs:19`) names the meter; `Meter` is a single static instance built from it (`IdempotencyMetrics.cs:34`).
  - Three counters, all `Counter<long>` with unit `{request}`: `idempotency.replayed` (`IdempotencyMetrics.cs:36-39`), `idempotency.conflict` (`IdempotencyMetrics.cs:41-44`), and `idempotency.degraded` (`IdempotencyMetrics.cs:46-49`).
  - The two conflict shapes are separated by a tag rather than by separate counters: `ConflictKindTag = "kind"` (`IdempotencyMetrics.cs:32`) carries either `ConflictKindBodyMismatch = "body_mismatch"` (`IdempotencyMetrics.cs:24`) or `ConflictKindInFlight = "in_flight"` (`IdempotencyMetrics.cs:29`), so one time series can be split or summed.
  - The three helpers are the only public surface: `RecordReplayed()` (`IdempotencyMetrics.cs:52`), `RecordConflict(string kind)`, which attaches the tag as a `KeyValuePair` (`IdempotencyMetrics.cs:61-62`), and `RecordDegraded()` (`IdempotencyMetrics.cs:68`).
- **Why it's built this way**: `internal static` keeps the instruments off the package's public API while still letting the filter in the same assembly record them. A host exports these by registering the meter, which the Aspire service defaults do with the name as a *literal* (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:159-161`), because `MMCA.Common.Aspire` has no reference to `MMCA.Common.API`; the duplication is called out in both files (`IdempotencyMetrics.cs:8-10`, `Extensions.cs:155-158`).
- **Where it's used**: every recording site is in [`IdempotencyFilter`](#idempotencyfilter): `RecordDegraded` on a failed cache read (`IdempotencyFilter.cs:367`), a failed cache write (`IdempotencyFilter.cs:443`) and a faulted lock acquisition (`IdempotencyFilter.cs:257`); `RecordConflict` for an in-flight duplicate (`IdempotencyFilter.cs:269`) and a body mismatch (`IdempotencyFilter.cs:378`); `RecordReplayed` on every served replay (`IdempotencyFilter.cs:384`).

### IdempotencyRecord

> MMCA.Common.API · `MMCA.Common.API.Idempotency` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyRecord.cs:17` · Level 0 · record (sealed, positional)

- **What it is**: the cached snapshot of an idempotent action's response: the HTTP status code, the JSON-serialized body, and a hash of the request body that produced it. It is what [`IdempotencyFilter`](#idempotencyfilter) writes after the first successful execution and replays for every duplicate carrying the same key.
- **Depends on**: nothing beyond the BCL; a three-parameter positional `record` whose third parameter is optional.
- **Concept**: introduced fully by [`IdempotencyFilter`](#idempotencyfilter); this is the value it persists. Two properties of the shape are load-bearing. First, only status and body are captured, no headers, which is why the replay path re-adds `X-Idempotent-Replay` itself (`IdempotencyFilter.cs:387`) and why a replayed 201 does not carry the original `Location` header. Second, `RequestBodyHash` is *nullable with a default*, which is the whole rollout story: entries written by the previous two-property version still deserialize, and a `null` there means "nothing to compare", so those records replay exactly as they did before and simply age out of the live 24-hour retention window (doc comment, `IdempotencyRecord.cs:9-16`). `[Rubric §9, API & Contract Design]` assesses evolving a persisted contract without a flag day; adding an optional member to a cached record is the cheapest version of that.
- **Walkthrough**: `IdempotencyRecord(int StatusCode, string ResponseBody, string? RequestBodyHash = null)` (`IdempotencyRecord.cs:17`). `StatusCode` is the original response's code, defaulting to 200 when an `ObjectResult` carried none (`IdempotencyFilter.cs:457`). `ResponseBody` is non-nullable: an `ObjectResult` stores `objectResult.Value` serialized with `JsonSerializerOptions.Web` (`IdempotencyFilter.cs:462`), while a body-less 2xx such as the 204 from `NoContent()` stores `string.Empty` (`IdempotencyFilter.cs:472`), which is the signal the replay path uses to answer with a bare status code instead of a JSON content result. `RequestBodyHash` is the lowercase hex SHA-256 of the request body (`IdempotencyFilter.cs:191-194`).
- **Why it's built this way**: keeping the record to three primitives makes it provider-agnostic, so the same artifact round-trips through the in-memory cache or Redis with no serializer coupling. Distinguishing "empty body" from "no body" via the empty string (rather than a nullable) keeps the JSON shape stable across both cases.
- **Where it's used**: read by [`IdempotencyFilter`](#idempotencyfilter) through [`ICacheService`](group-09-caching.md#icacheservice) (`IdempotencyFilter.cs:363`), built by its `BuildRecord` (`IdempotencyFilter.cs:452`), and written back with the configured expiration (`IdempotencyFilter.cs:439`).

### IdempotencySettings

> MMCA.Common.API · `MMCA.Common.API.Idempotency` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencySettings.cs:9` · Level 0 · class (sealed)

- **What it is**: the options object bound from the `Idempotency` configuration section. It carries exactly one knob: how long a cached idempotent response is retained.
- **Depends on**: `System.ComponentModel.DataAnnotations` for the `[Range]` attribute; bound through `Microsoft.Extensions.Options`.
- **Concept**: the standard options pattern (see the [primer](00-primer.md)). `[Rubric §10, Cross-Cutting]` assesses whether a cross-cutting concern is configurable without becoming mandatory; the whole section is optional because the single property has a default, so a host that never mentions idempotency still behaves correctly.
- **Walkthrough**: `SectionName` is a `public static readonly string` equal to `"Idempotency"` (`IdempotencySettings.cs:12`), so the binding key is a symbol rather than a magic string at the call site. `CacheExpirationHours` defaults to 24 (`IdempotencySettings.cs:16`) and is constrained by `[Range(1, 168)]` (`IdempotencySettings.cs:15`), one hour to one week. The property is `init`-only, so the value is fixed once bound.
- **Why it's built this way**: `AddAPI` binds the section only when the caller passes an `IConfiguration`, and when it does it chains `.ValidateDataAnnotations().ValidateOnStart()` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:60-63`), so an out-of-range `CacheExpirationHours` fails the host at startup rather than at the first idempotent POST. `[Rubric §15, Best Practices & Code Quality]`: fail fast, loudly, at composition time.
- **Where it's used**: resolved as `IOptions<IdempotencySettings>` inside [`IdempotencyFilter`](#idempotencyfilter) at store time (`IdempotencyFilter.cs:431-435`). Note the deliberate `GetService`, not `GetRequiredService`: when the options are absent (the `AddAPI` overload called with no configuration) the filter falls back to its hard-coded 24-hour `DefaultExpiration` (`IdempotencyFilter.cs:82`) instead of throwing.

### IErrorLocalizer

> MMCA.Common.API · `MMCA.Common.API.Localization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Localization/IErrorLocalizer.cs:9` · Level 0 · interface

- **What it is**: the contract for localizing a domain [`Error`](group-01-result-error-handling.md#error)'s human-readable message at the HTTP edge, keyed by its stable machine `Code`. Domain, handler, and [`Result`](group-01-result-error-handling.md#result) code stays culture-agnostic; only the edge speaks a culture.
- **Depends on**: nothing beyond the BCL. Implemented by [`ErrorLocalizer`](#errorlocalizer); consumed by [`ErrorHttpMapping`](#errorhttpmapping).
- **Concept introduced: edge localization keyed by a stable code.** The domain raises errors carrying a machine `Code` such as `"PhoneNumber.Empty"` plus an English message (`IErrorLocalizer.cs:15`). Translating on the `Code` rather than on the English prose is what keeps culture out of the [`Error`](group-01-result-error-handling.md#error) type: the same code resolves to any registered culture, and renaming the English text never invalidates a translation. The contract also pins the failure mode: when the code is empty or no registered resource has a key, the caller's `fallbackMessage` is returned *unchanged* (`IErrorLocalizer.cs:11-14`), so an untranslated code degrades to English rather than throwing or emitting a raw resource key. `[Rubric §27, i18n]` assesses whether text is translatable without leaking locale into the core, and the split (code in the domain, culture at the edge) is the clean version of that. `[Rubric §9, API & Contract Design]` applies to the graceful-degradation clause: an error response never becomes an error itself because a translation is missing.
- **Walkthrough**: a single method, `string Localize(string code, string fallbackMessage)` (`IErrorLocalizer.cs:17`). The XML doc is the specification: resolve `code` against the current UI culture, otherwise return `fallbackMessage`.
- **Why it's built this way**: consumers depend on the abstraction while the additive resource-source enumeration stays an implementation detail (see [`ErrorLocalizer`](#errorlocalizer)). Registration uses `TryAddSingleton` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:91`), so an app that wants a different localization strategy registers its own first and the framework's default steps aside. See [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html).
- **Where it's used**: resolved *optionally* at both edge call sites, via `GetService` rather than `GetRequiredService`: [`ApiControllerBase`](#apicontrollerbase)`.HandleFailure` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:47`) and [`UnhandledResultFailureFilter`](#unhandledresultfailurefilter) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/UnhandledResultFailureFilter.cs:46`). Both hand it to [`ErrorHttpMapping`](#errorhttpmapping)`.BuildErrorsExtension` (`ErrorHttpMapping.cs:47`), which accepts a `null` localizer and leaves messages in English.

### ErrorLocalizer

> MMCA.Common.API · `MMCA.Common.API.Localization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Localization/ErrorLocalizer.cs:11` · Level 1 · class (sealed, internal)

- **What it is**: the default [`IErrorLocalizer`](#ierrorlocalizer). It resolves an error code against an ordered set of registered [`ErrorResourceSource`](#errorresourcesource)s (Common first, then modules) using the current UI culture, and falls back to the caller's English message when the code is empty or unknown to every source.
- **Depends on**: [`IErrorLocalizer`](#ierrorlocalizer) (implements), [`ErrorResourceSource`](#errorresourcesource) (injected as a collection); `Microsoft.Extensions.Localization.LocalizedString`.
- **Concept introduced: first-match-wins over an ordered source list.** The interesting mechanism is how "not found" is detected. `IStringLocalizer`'s indexer never returns `null`: on a miss it hands back a `LocalizedString` whose `Value` is the *key itself* and whose `ResourceNotFound` flag is `true`. Testing that flag (`ErrorLocalizer.cs:26`) rather than comparing strings is what lets the loop distinguish a genuine translation from an echoed code, and therefore what lets it keep walking to the next source instead of returning `"PhoneNumber.Empty"` to a user. `[Rubric §27, i18n]` assesses translation coverage and layering; first-match ordering lets Common ship base translations while a module extends the set additively. See [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html).
- **Walkthrough**: the primary constructor takes `IEnumerable<ErrorResourceSource> sources` (`ErrorLocalizer.cs:11`), materialized once into `_sources` with a collection expression (`ErrorLocalizer.cs:13`). `Localize` (`ErrorLocalizer.cs:16`): returns `fallbackMessage` immediately when `code` is null or empty (`ErrorLocalizer.cs:18-21`); otherwise walks `_sources` in registration order, reading `source.Localizer[code]` and returning `localized.Value` on the first entry where `!localized.ResourceNotFound` (`ErrorLocalizer.cs:23-30`); if no source matches it returns `fallbackMessage` (`ErrorLocalizer.cs:32`). The current UI culture is never read explicitly: `IStringLocalizer` resolves it per call, which is why one singleton can serve requests in different cultures concurrently.
- **Why it's built this way**: `internal sealed` keeps the implementation behind the [`IErrorLocalizer`](#ierrorlocalizer) abstraction, so nothing downstream can bind to the enumeration strategy. Snapshotting the DI collection once (rather than enumerating it per lookup) matters because this runs on every failing request. Registering it with `TryAddSingleton` (`DependencyInjection.cs:91`) is safe precisely because the type holds no per-request state.
- **Where it's used**: registered by `AddErrorLocalization()` (`DependencyInjection.cs:88-94`), which `AddAPI` calls (`DependencyInjection.cs:77`); reached at runtime only through the [`IErrorLocalizer`](#ierrorlocalizer) handle that [`ApiControllerBase`](#apicontrollerbase) and [`UnhandledResultFailureFilter`](#unhandledresultfailurefilter) pass into [`ErrorHttpMapping`](#errorhttpmapping).

### IdempotencyFilter

> MMCA.Common.API · `MMCA.Common.API.Idempotency` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:66` · Level 2 · class (sealed, partial)

- **What it is**: the ASP.NET Core filter that gives write operations client-driven idempotency. A client attaches an `Idempotency-Key` header; the first successful response for that key is cached and every subsequent request carrying the same key gets the stored response back, without re-running the action. It implements *both* `IAsyncResourceFilter` and `IAsyncActionFilter` (`IdempotencyFilter.cs:66-67`), which is the detail that makes body-aware deduplication possible.
- **Depends on**: [`ICacheService`](group-09-caching.md#icacheservice) and [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock), both resolved per request from `RequestServices` (`IdempotencyFilter.cs:142` and `IdempotencyFilter.cs:150`); [`IdempotencyRecord`](#idempotencyrecord); [`IdempotencySettings`](#idempotencysettings) via `IOptions<>`; [`IdempotencyMetrics`](#idempotencymetrics); [`IdempotencyHeaders`](group-08-auth.md#idempotencyheaders) for the two header names; [`KeyedSemaphoreStripe`](group-08-auth.md#keyedsemaphorestripe) as the no-distributed-lock fallback. Externals: `SHA256`, `Encoding`, `System.Text.Json`, and `ILogger` with source-generated `[LoggerMessage]` partials.
- **Concept introduced: idempotent mutation as a lock plus a caller-scoped key plus a body binding.** `[Rubric §29, Resilience & Business Continuity]` assesses surviving client retries without duplicating side effects; `[Rubric §9, API & Contract Design]` covers safe retry semantics on non-safe verbs; `[Rubric §11, Security]` applies because the key derivation is a trust boundary, not just a cache detail; `[Rubric §13, Observability & Operability]` applies because every degraded path is counted rather than silent. Three ideas compose here.
  1. **Double-check locking** (doc comment, `IdempotencyFilter.cs:22-31`): read the cache with no lock (the common fast path); on a miss take the lock for this key; re-read, because a concurrent duplicate may have finished while this one waited; only then execute and store. Without the lock, two near-simultaneous retries of a slow create both miss and both execute.
  2. **The lock must be visible to every replica.** A per-process stripe only serializes duplicates that land on the same instance, and both deployed apps run more than one (`IdempotencyFilter.cs:32-37`, `IdempotencyFilter.cs:221-232`), so the primary path uses an [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) and the stripe is only the fallback for a host that registers none.
  3. **The key alone is not enough.** A stored response is bound to the request body that produced it, so a key reused with a *different* payload is refused (422) rather than replayed, which would otherwise silently swallow a genuinely new write (`IdempotencyFilter.cs:42-50`).
- **Walkthrough**
  - Constants and shared state: `IdempotencyKeyHeader` delegates to `IdempotencyHeaders.IdempotencyKey` (`IdempotencyFilter.cs:72`, defined at `MMCA.Common/Source/Core/MMCA.Common.Shared/Http/IdempotencyHeaders.cs:19` as `"Idempotency-Key"`); `CacheKeyPrefix = "idempotency:"` (`IdempotencyFilter.cs:74`); `UserIdClaimType = "user_id"` (`IdempotencyFilter.cs:77`), the claim `TokenService` emits; `DefaultExpiration` of 24 hours (`IdempotencyFilter.cs:82`); `LockTimeToLive` of 30 seconds and `LockWait` of 5 seconds (`IdempotencyFilter.cs:99` and `IdempotencyFilter.cs:106`), sized so a slow action finishes under its own lock while a dead replica does not block a retry for long; and `EmptyBodyHash`, the SHA-256 of zero bytes (`IdempotencyFilter.cs:112-113`).
  - `KeyLocks` (`IdempotencyFilter.cs:92`) is a static [`KeyedSemaphoreStripe`](group-08-auth.md#keyedsemaphorestripe), a fixed set of 256 semaphores that keys hash onto (`MMCA.Common/Source/Core/MMCA.Common.Shared/Concurrency/KeyedSemaphoreStripe.cs:25`). The comment above it (`IdempotencyFilter.cs:84-91`) gives the reason for striping over one-semaphore-per-key: the key embeds a caller-supplied value, so a per-key table either grows without bound or needs an eager removal that races.
  - **Resource stage.** `OnResourceExecutionAsync` (`IdempotencyFilter.cs:121`) runs before model binding, the last point at which the body can still be made replayable. It calls `Request.EnableBuffering()` only when the header is present (`IdempotencyFilter.cs:123-124`), so ordinary traffic on an `[Idempotent]` action pays nothing, then awaits `next()`.
  - **Action stage.** `OnActionExecutionAsync` (`IdempotencyFilter.cs:130`): no header means straight through to `next()` with nothing else resolved (`IdempotencyFilter.cs:133-138`), so idempotency is opt-in per request as well as per action. Otherwise it derives the cache key (`IdempotencyFilter.cs:140`), hashes the body (`IdempotencyFilter.cs:141`), resolves [`ICacheService`](group-09-caching.md#icacheservice) (`IdempotencyFilter.cs:142`), and tries the lock-free replay (`IdempotencyFilter.cs:145`). On a miss it picks a lock strategy: `GetService<IDistributedLock>()` returning null routes to the process-stripe path (`IdempotencyFilter.cs:150-155`), otherwise the distributed path (`IdempotencyFilter.cs:157`).
  - `ReadIdempotencyKey` (`IdempotencyFilter.cs:165-172`) treats a missing *or* whitespace header as absent, and both stages call it so they agree on what "has a key" means.
  - `ComputeRequestBodyHashAsync` (`IdempotencyFilter.cs:184-195`): a stream that cannot seek was never buffered, so it takes `EmptyBodyHash` rather than throwing (`IdempotencyFilter.cs:187-188`). Otherwise it rewinds to 0, hashes, and rewinds *again* (`IdempotencyFilter.cs:190-192`) because model binding still has to read the whole body.
  - `ExecuteUnderProcessLockAsync` (`IdempotencyFilter.cs:201`): acquires the stripe honoring `RequestAborted` inside a `using` so release survives a throw (`IdempotencyFilter.cs:208`), re-checks the cache (`IdempotencyFilter.cs:211`), then executes and stores (`IdempotencyFilter.cs:214`).
  - `ExecuteUnderDistributedLockAsync` (`IdempotencyFilter.cs:240`) is where the interesting policy lives, and it separates three outcomes that a naive implementation conflates.
    - The lock backend *faults*: counted on `idempotency.degraded`, logged, and the action runs unguarded (`IdempotencyFilter.cs:255-261`). There is no holder to wait for, so refusing would turn a cache blip into a write outage.
    - The wait *expires* with the lock still held elsewhere: the holder is executing this key right now, so it re-checks the cache first, and only if still nothing is stored does it record an `in_flight` conflict and answer 409 (`IdempotencyFilter.cs:263-275`). 409 is retryable and honest; executing would be the duplicate write.
    - The lock is *acquired*: `await using` on the handle (`IdempotencyFilter.cs:277`), double-check (`IdempotencyFilter.cs:280`), then execute and store (`IdempotencyFilter.cs:283`).
  - `TryReplayAsync` (`IdempotencyFilter.cs:354`) serves both the fast path and every double-check, returning whether it short-circuited. A cache read that throws is reported as "nothing stored" after counting a degradation (`IdempotencyFilter.cs:361-370`). A stored record whose `RequestBodyHash` differs from this request's hash yields a `body_mismatch` conflict and the 422 (`IdempotencyFilter.cs:375-382`); a `null` stored hash is a legacy entry and replays unconditionally. On a genuine hit it counts the replay (`IdempotencyFilter.cs:384`), appends `X-Idempotent-Replay: true` (`IdempotencyFilter.cs:387`, name from `IdempotencyHeaders.cs:25`), and short-circuits with a bare `StatusCodeResult` when the stored body is empty or a `ContentResult` with `application/json` otherwise (`IdempotencyFilter.cs:388-395`). That split is what makes a replayed 204 look like the original 204 instead of a 204 carrying a content type.
  - `TryStoreAsync` (`IdempotencyFilter.cs:420`) builds the record, reads the expiration from [`IdempotencySettings`](#idempotencysettings) when registered and `DefaultExpiration` otherwise (`IdempotencyFilter.cs:431-435`), and swallows a failing `SetAsync` after counting it (`IdempotencyFilter.cs:437-445`): the action already ran, so failing here would push the client into the very retry the filter exists to deduplicate.
  - `BuildRecord` (`IdempotencyFilter.cs:452`) decides what is cacheable. An `ObjectResult` with a 2xx status stores its value serialized with `JsonSerializerOptions.Web` (`IdempotencyFilter.cs:456-465`; the `VSTHRD103` suppression at `IdempotencyFilter.cs:458` documents that serializing to a string is correctly synchronous). A `StatusCodeResult` with a 2xx status, which is what `NoContent()` and `StatusCode(int)` produce, stores the empty string (`IdempotencyFilter.cs:470-473`). Everything else, including every non-2xx and every redirect or file result, returns `null` and is not stored (`IdempotencyFilter.cs:475-476`); `IsSuccess` is the `>= 200 and < 300` test (`IdempotencyFilter.cs:480`).
  - `BuildCacheKey` (`IdempotencyFilter.cs:489-503`) is the security-relevant part: the subject is the caller's `user_id` claim or, unauthenticated, `anon:{remote address}` (`IdempotencyFilter.cs:491-492`); the route is the attribute route template falling back to the request path (`IdempotencyFilter.cs:494-496`); those plus the HTTP method and the client key are joined with `\n` (`IdempotencyFilter.cs:499`, a character valid in none of the components, so the tuple cannot be forged), SHA-256 hashed (`IdempotencyFilter.cs:500`), and emitted as `idempotency:{lowercase hex}` (`IdempotencyFilter.cs:502`).
  - Logging is entirely source-generated `[LoggerMessage]` partials with instance forwarders (`IdempotencyFilter.cs:505-556`): one Information message for a served replay and five Warnings covering body mismatch, in-flight duplicate, lock-wait timeout, cache-read failure and cache-store failure. `[Rubric §13, Observability & Operability]`: each degraded path has both a counter and a log line naming the cache key.
- **Why it's built this way**: keying on the bare client value would make the key space global, so two callers who happened to pick the same value would share an entry and one user's serialized body could be replayed to another; with services sharing one cache instance that collision reaches across endpoints and services ([ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html)). Hashing also bounds the stored key length regardless of what a client sends. Non-2xx results are deliberately not stored (`IdempotencyFilter.cs:400-407`) because replaying a failure for the whole retention window would mean a client retrying after a transient 500 keeps receiving that 500 for 24 hours instead of the retry actually executing. And the whole cache-and-lock layer is treated as best-effort infrastructure (`IdempotencyFilter.cs:51-57`): deduplication is an optimization over an at-least-once client retry, so a Redis outage must degrade dedup, not every write endpoint carrying the attribute.
- **Caveats / not-in-source**: the replay restores only the status code and the JSON body. Response headers the original action set (a 201's `Location`, for example) are not captured by [`IdempotencyRecord`](#idempotencyrecord) and are therefore not reproduced; only `X-Idempotent-Replay` is added. A prior edition of this guide described the per-process stripe as the only mutual exclusion, with cross-instance double execution as an accepted trade-off: that is stale. The distributed lock is now the primary path (`IdempotencyFilter.cs:150-158`) and the stripe is the fallback for a host that registers no [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock).
- **Where it's used**: registered scoped in `AddAPI` because it depends on scoped services (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:67`), and attached to actions through [`IdempotentAttribute`](#idempotentattribute). In the framework itself that is the create endpoint on [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest) (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AggregateRootEntityControllerBase.cs:59`) and the notification-send endpoint (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationsController.cs:44`). Downstream, ADC marks its poll and question writes (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/Controllers/LivePollsController.cs:61`, `LivePollsController.cs:215`, `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.API/Controllers/SessionQuestionsController.cs:53`) and Store marks its cart and order writes (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/ShoppingCartsController.cs:180`, `ShoppingCartsController.cs:229`, `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/OrdersController.cs:203`).

### IdempotentAttribute

> MMCA.Common.API · `MMCA.Common.API.Idempotency` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotentAttribute.cs:16` · Level 3 · class (sealed)

- **What it is**: the method-level marker that attaches [`IdempotencyFilter`](#idempotencyfilter) to a controller action. Putting `[Idempotent]` on an action opts it into the `Idempotency-Key` replay behavior; leaving it off means the action is never deduplicated.
- **Depends on**: `ServiceFilterAttribute` from ASP.NET Core MVC; resolves [`IdempotencyFilter`](#idempotencyfilter) from DI.
- **Concept introduced: service filters (DI-resolved action filters).** `[Rubric §2, Design Patterns]` covers the filter idiom and how the instance is obtained. A plain `[TypeFilter]` constructs the filter itself, which would confine it to constructor arguments MVC can supply; `ServiceFilterAttribute` (`IdempotentAttribute.cs:16`) resolves it from the container instead, which is what lets the filter be registered `AddScoped` and reach scoped services such as [`ICacheService`](group-09-caching.md#icacheservice) (remarks, `IdempotentAttribute.cs:10-14`). `[Rubric §15, Best Practices & Code Quality]`: `[AttributeUsage(AttributeTargets.Method)]` (`IdempotentAttribute.cs:15`) makes misapplication at class level a compile error rather than a silent no-op.
- **Walkthrough**: the entire type is one line, `public sealed class IdempotentAttribute() : ServiceFilterAttribute(typeof(IdempotencyFilter))` (`IdempotentAttribute.cs:16`); the primary constructor forwards the filter type to the base. The doc notes the filter must be registered in DI, which `AddAPI` does (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:67`); without that registration, resolution fails at request time rather than at startup.
- **Why it's built this way**: opt-in per action is the [ADR-017](https://ivanball.github.io/docs/adr/017-request-idempotency.html) decision. Nothing is deduplicated unless the action declares it, so adding the attribute is additive and safe, and the client still decides per request whether to send a key at all (a keyless request short-circuits at `IdempotencyFilter.cs:133-138`).
- **Caveats / not-in-source**: the flip side of opt-in is that an action which *should* be idempotent but is missing `[Idempotent]` gets no protection whatsoever, and nothing in the type system flags that. Keeping the annotated set correct is an inventory audit, which ADR-017 names explicitly.
- **Where it's used**: applied in the framework to the create endpoint of [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest) (`AggregateRootEntityControllerBase.cs:59`) and to `NotificationsController` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Notifications/NotificationsController.cs:44`), and in the apps to the ADC Engagement and Store Sales write endpoints listed under [`IdempotencyFilter`](#idempotencyfilter).

### ApiParameterDescriptorBackfillProvider
> MMCA.Common.API · `MMCA.Common.API.OpenApi` · `MMCA.Common/Source/Presentation/MMCA.Common.API/OpenApi/ApiParameterDescriptorBackfillProvider.cs:43` · Level 0 · class (internal sealed)

- **What it is**: a defensive `IApiDescriptionProvider` that walks every API description MVC produced
  and fills in a placeholder `ParameterDescriptor` wherever the API explorer left one null, so an
  OpenAPI transformer that dereferences the property cannot turn document generation into a 500.
- **Depends on**: `Microsoft.AspNetCore.Mvc.Abstractions.ParameterDescriptor` and
  `Microsoft.AspNetCore.Mvc.ApiExplorer.IApiDescriptionProvider` (ASP.NET Core). Registered by
  `AddCommonApiVersioning()` and `AddCommonOpenApi()` on
  [`WebApplicationBuilderExtensions`](#webapplicationbuilderextensions).
- **Concept introduced: the API-explorer provider chain as a repair point.** MVC builds its OpenAPI
  input (the `ApiDescription` list) by running a chain of `IApiDescriptionProvider` instances;
  `OnProvidersExecuting` runs in ascending `Order`, `OnProvidersExecuted` in **descending** order, so
  the lowest order gets the last word (`ApiParameterDescriptorBackfillProvider.cs:34-41`). That makes
  the chain a legitimate place to normalize data other components will read.
  `[Rubric §9: API & Contract Design]` assesses whether the machine-readable contract is dependable:
  here the whole point is that `GET /openapi/{documentName}.json` must not fail for a consumer that
  adopts URL-segment versioning. `[Rubric §32: Dependency & Supply-Chain]` also applies: this is a
  local guard around a third-party defect, written so it can be deleted without a behavior change.
- **Walkthrough**
  - `Order => int.MinValue` (`:46`): last to observe the results, so it sees the parameters
    `VersionedApiDescriptionProvider` contributed as well as MVC's own.
  - `OnProvidersExecuting` (`:49`) is intentionally empty: the descriptions this guard repairs do not
    exist yet at that point.
  - `OnProvidersExecuted` (`:56`) null-guards the context (`:58`), flattens
    `context.Results.SelectMany(d => d.ParameterDescriptions)` (`:60`) and applies
    `parameter.ParameterDescriptor ??= new ParameterDescriptor { ... }` (`:65-71`). The `??=` is the
    load-bearing operator: an existing descriptor (a `ControllerParameterDescriptor`, which carries
    the `ParameterInfo` that XML-comment lookups prefer) is never replaced. The synthesized
    replacement takes the parameter name or `string.Empty`, and the type falls back through
    `parameter.Type` then `ModelMetadata?.ModelType` then `typeof(string)`.
- **Why it's built this way**: the class comment (`:12-41`) documents the exact failure it guards:
  MVC leaves `ParameterDescriptor` null for a route-template token with no matching action parameter
  (normal for `[Route("api/v{version:apiVersion}/orders")]` or `[Route("api/{tenant}/orders")]`),
  while `Asp.Versioning.OpenApi` 10.2.1 reads `arg.ParameterDescriptor.Name` without a null check.
  The fix is deliberately general (any unbound route token, not just the version token) so a
  `{tenant}` or `{region}` segment is covered by the same guard.
- **Where it's used**: registered once through the private `AddApiParameterDescriptorBackfill()`
  helper (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:251-253`),
  which uses `TryAddEnumerable` so calling both `AddCommonApiVersioning()` and `AddCommonOpenApi()`
  still yields exactly one instance.

---

### DbUpdateExceptionHandler
> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/DbUpdateExceptionHandler.cs:17` · Level 0 · class (sealed)

- **What it is**: the `IExceptionHandler` that turns an EF Core `DbUpdateException` into an HTTP 409
  Conflict RFC 9457 response with a deliberately generic body, while the full exception is logged
  server-side.
- **Depends on**: `Microsoft.AspNetCore.Diagnostics.IExceptionHandler`,
  `Microsoft.AspNetCore.Http.IProblemDetailsService`, `Microsoft.EntityFrameworkCore.DbUpdateException`.
  Siblings in the same chain: [`OperationCanceledExceptionHandler`](#operationcanceledexceptionhandler),
  [`DomainExceptionHandler`](#domainexceptionhandler),
  [`ValidationExceptionHandler`](#validationexceptionhandler), and the catch-all
  [`GlobalExceptionHandler`](#globalexceptionhandler).
- **Concept introduced: the `IExceptionHandler` chain.** ASP.NET Core resolves registered
  `IExceptionHandler` implementations **in registration order** and calls `TryHandleAsync` on each:
  returning `true` claims the exception and stops the chain, returning `false` passes it on. The
  framework registers the chain in `AddCommonExceptionHandlers()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:126-138`) as
  `OperationCanceled` -> `Domain` -> `DbUpdate` -> `Validation` -> `Global`, and that same method
  calls `AddProblemDetails` with a customization that stamps a `requestId` extension from
  `HttpContext.TraceIdentifier` onto every problem document (`:128-130`). `[Rubric §9: API & Contract
  Design]` assesses whether errors have one uniform, standards-based shape: every handler here writes
  RFC 9457 `application/problem+json` through the same `IProblemDetailsService`, so controllers never
  need a `try`/`catch`. `[Rubric §11: Security]` applies to this handler specifically, see below.
- **Walkthrough**: `TryHandleAsync` (`DbUpdateExceptionHandler.cs:23`):
  - Type-tests with `is not DbUpdateException dbUpdateException` and returns `false` (`:28-29`) so the
    rest of the chain still gets its turn.
  - Logs the exception at `LogError` (`:31`), then sets `StatusCodes.Status409Conflict` (`:33`).
  - Builds the client-facing detail as the fixed string `"A data conflict occurred. Please retry or
    contact support."` (`:37`), with the comment stating why: leaking the EF message would expose
    table, column and constraint names. The full exception is already in the log.
  - Returns `await problemDetailsService.TryWriteAsync(context)` (`:51`), so the response body is
    whatever the configured `ProblemDetailsService` writes.
- **Why it's built this way**: 409 is the honest status for a write rejected by a constraint or a
  concurrency token, and the split between a rich server-side log and a generic client body is the
  standard information-disclosure posture.
- **Where it's used**: registered third in `AddCommonExceptionHandlers()`
  (`DependencyInjection.cs:133`), ahead of [`GlobalExceptionHandler`](#globalexceptionhandler).
- **Caveats / not-in-source**: the class doc comment (`DbUpdateExceptionHandler.cs:12-13`) still says
  "the inner exception message is included in the detail because it typically contains the
  database-level constraint name". The code does **not** do that: it writes the generic string at
  `:37`. Trust the code; the comment is stale.

---

### ErrorResources
> MMCA.Common.API · `MMCA.Common.API.Resources` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Resources/ErrorResources.cs:9` · Level 0 · class (sealed)

- **What it is**: an empty marker class that exists only to be a `typeof(...)` anchor for the
  framework's `ErrorResources.resx` / `ErrorResources.es.resx` files. It carries no members
  (`ErrorResources.cs:9` is the whole declaration).
- **Depends on**: nothing. It is consumed by [`IErrorLocalizer`](#ierrorlocalizer) through
  [`ErrorResourceSource`](#errorresourcesource).
- **Concept: the resource anchor type.** .NET's `IStringLocalizerFactory.Create(Type)` locates a
  satellite resource set by the type's assembly and namespace-relative name, so a resx file needs a
  co-located type to point at even when that type has no behavior. Keeping the anchor a real,
  public, empty class makes the resx discoverable by convention and gives modules a pattern to copy.
  `[Rubric §27: i18n]` assesses whether user-facing text is externalized rather than hard-coded:
  here the resx entries are keyed by the stable domain error `Code` (for example
  `"PhoneNumber.Empty"`, `ErrorResources.cs:5-6`), so a translation never depends on the English
  message string.
- **Walkthrough**: there is nothing to walk. The type is a body-less `sealed class` declared with
  the semicolon form (`ErrorResources.cs:9`); all of its meaning is in the doc comment and its resx
  siblings.
- **Why it's built this way**: see [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html).
  Localizing at the HTTP edge (rather than inside the domain) keeps `Error.Code` culture-free all the
  way through the Application layer, and one anchor per resource set lets modules add their own
  translations additively instead of editing a framework file.
- **Where it's used**: `AddErrorLocalization()` registers it as the framework's own source via
  `services.AddErrorResources<ErrorResources>()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:102`); each module calls
  the same generic `AddErrorResources<TResource>()` (`:113-118`) with its own anchor type.

---

### GlobalExceptionHandler
> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/GlobalExceptionHandler.cs:15` · Level 0 · class (sealed)

- **What it is**: the last handler in the `IExceptionHandler` chain: it claims anything the specific
  handlers declined, logs it at error level, and answers HTTP 500 as RFC 9457 problem details.
- **Depends on**: `IProblemDetailsService` and `ILogger<GlobalExceptionHandler>` (primary-constructor
  injected, `GlobalExceptionHandler.cs:15-18`). Chain concept introduced at
  [`DbUpdateExceptionHandler`](#dbupdateexceptionhandler).
- **Concept**: `[Rubric §10: Cross-Cutting Concerns]` assesses whether error handling is factored out
  of business code, and `[Rubric §13: Observability & Operability]` whether failures are always
  recorded. This handler is the guarantee for both: no exception can escape the pipeline as a raw
  stack trace or an unlogged 500, because this one never returns `false`.
- **Walkthrough**: `TryHandleAsync` (`GlobalExceptionHandler.cs:21`) does no type test at all. It
  logs `"Unhandled exception occurred"` with the exception at `LogError` (`:26`), sets
  `StatusCodes.Status500InternalServerError` (`:28`), and returns the result of
  `problemDetailsService.TryWriteAsync(...)` (`:29-39`) with the generic title
  `"Internal Server Error"` and a "please try again" detail. The exception object is attached to the
  `ProblemDetailsContext` (`:32`) so a configured customization can enrich the document (in
  development, for example) without this class deciding what to expose.
- **Why it's built this way**: returning `TryWriteAsync`'s own boolean rather than a hard-coded
  `true` keeps this handler honest: if no problem-details writer can serve the request, the framework
  is told the exception was not fully handled instead of silently swallowing it. Registration order
  is the only thing that makes it the fallback, so it is registered last (`DependencyInjection.cs:135`).
- **Where it's used**: `AddCommonExceptionHandlers()` (`DependencyInjection.cs:135`); every host that
  calls it inherits the same 500 contract.

---

### OperationCanceledExceptionHandler
> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/OperationCanceledExceptionHandler.cs:16` · Level 0 · class (sealed)

- **What it is**: the handler that maps `OperationCanceledException` (a client that hung up
  mid-request) to HTTP **499 Client Closed Request** instead of letting it inflate the 500 rate.
- **Depends on**: `IProblemDetailsService`, `ILogger<OperationCanceledExceptionHandler>`; chain
  concept at [`DbUpdateExceptionHandler`](#dbupdateexceptionhandler).
- **Concept**: `[Rubric §13: Observability & Operability]` assesses whether the signals operators
  alert on distinguish real faults from normal client behavior. 499 is a non-standard nginx-origin
  code (class comment, `OperationCanceledExceptionHandler.cs:10-12`) that monitoring stacks read as
  "the caller gave up", so cancellations stop looking like server errors on a dashboard.
- **Walkthrough**: `TryHandleAsync` (`:22`) type-tests and returns `false` for anything else
  (`:27-28`), logs at `LogWarning` (`:30`), sets `StatusCodes.Status499ClientClosedRequest` (`:32`),
  and still writes a problem-details body titled `"Operation Canceled Exception"` through
  `TryWriteAsync` (`:33-45`). Note that `Status499ClientClosedRequest` is a real constant on ASP.NET
  Core's `StatusCodes`, so the non-standard code is spelled symbolically, not as a magic number.
- **Why it's built this way**: it is registered **first** in the chain
  (`DependencyInjection.cs:131`). That position matters: a cancellation propagating out of a
  `CancellationToken` would otherwise be claimed by nothing until
  [`GlobalExceptionHandler`](#globalexceptionhandler) turned it into a 500.
- **Where it's used**: `AddCommonExceptionHandlers()` (`DependencyInjection.cs:131`); it fires for
  request-abort propagation from any handler that honors its `CancellationToken`.
- **Caveats / not-in-source**: whether the 499 body actually reaches a disconnected client is not
  determinable from this file; the write is attempted unconditionally at `:45`.

---

### QueryFilterModelBinder
> MMCA.Common.API · `MMCA.Common.API.ModelBinders` · `MMCA.Common/Source/Presentation/MMCA.Common.API/ModelBinders/QueryFilterModelBinder.cs:24` · Level 0 · class (sealed)

- **What it is**: a custom `IModelBinder` that parses the structured filter query string
  (`?filters[Name].operator=contains&filters[Name].value=shirt`) into a
  `Dictionary<string, (string Operator, string Value)>` that list endpoints hand to the query layer.
- **Depends on**: `Microsoft.AspNetCore.Mvc.ModelBinding.IModelBinder` only. Its output is consumed
  by [`QueryFilterService`](group-03-querying-specifications.md#queryfilterservice) via the list
  actions on [`EntityControllerBase`](#entitycontrollerbasetentity-tentitydto-tidentifiertype).
- **Concept introduced: model binding as the parsing boundary for a bespoke query grammar.**
  ASP.NET's default binders cannot express "a bag of per-property operator/value pairs", so the
  grammar is defined once here rather than re-parsed in each controller. `[Rubric §9: API & Contract
  Design]` assesses whether the request contract is explicit and uniform: every list endpoint in
  both apps accepts the identical filter syntax because they share this binder.
  `[Rubric §12: Performance & Scalability]` applies through `MaxFilters`, which bounds attacker-
  controlled work.
- **Walkthrough**
  - `MaxFilters = 50` (`QueryFilterModelBinder.cs:34`): the cap on distinct filter properties per
    request. The comment (`:27-33`) explains the choice: it bounds the per-request reflection
    `QueryFilterService` does for unknown names (it resolves each miss by reflection rather than
    memoizing), and surplus entries are dropped rather than rejected because a 400 would break
    clients that send junk alongside real filters.
  - `BindModelAsync` (`:37`): null-guards the binding context (`:39`), then builds the dictionary with
    `StringComparer.OrdinalIgnoreCase` (`:42`) so client capitalization does not matter.
  - It iterates `Request.Query.Keys` (`:46`), skipping anything that fails `IsFilterKey` (`:91-94`,
    prefix `filters[` plus suffix `].operator` or `].value`), extracts the bracketed property name
    with `GetFilterPropertyName` (`:101-109`) and the suffix with `GetFilterSuffix` (`:116-124`).
  - The two halves of one filter can arrive in either order, so it accumulates into a tuple and
    merges (`:59-70`). The `MaxFilters` check is applied only when a **new** property key would be
    added (`:61-62`), so the cap counts distinct properties, not query-string keys.
  - A second pass removes any entry still missing an operator or a value (`:74-80`): incomplete
    filters are silently discarded, never a 400.
  - Finally `ModelBindingResult.Success(filters)` (`:82`) and a completed task (`:83`): the binder is
    synchronous work behind an async signature, so it allocates no task machinery.
- **Why it's built this way**: silent discard plus case-insensitive matching makes the grammar
  forgiving for hand-built UI query strings, while the hard cap keeps a malicious caller from turning
  the query string into a reflection amplifier.
- **Where it's used**: applied per parameter with
  `[ModelBinder(typeof(QueryFilterModelBinder))]` on the list actions of
  [`IEntityControllerBase`](#ientitycontrollerbasetentitydto-tidentifiertype)
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/IEntityControllerBase.cs:51`) and
  [`EntityControllerBase`](#entitycontrollerbasetentity-tentitydto-tidentifiertype)
  (`.../Controllers/EntityControllerBase.cs:151` and `:239`).

---

### ValidationExceptionHandler
> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ValidationExceptionHandler.cs:17` · Level 0 · class (sealed)

- **What it is**: the handler that converts FluentValidation's `ValidationException` into a 400 whose
  problem document carries an `errors` extension shaped as
  `{ "PropertyName": ["message", ...] }`.
- **Depends on**: `FluentValidation.ValidationException`, `IProblemDetailsService`,
  `ILogger<ValidationExceptionHandler>`; chain concept at
  [`DbUpdateExceptionHandler`](#dbupdateexceptionhandler).
- **Concept**: `[Rubric §9: API & Contract Design]` and `[Rubric §24: Forms/Validation/UX Safety]`.
  The grouped shape is chosen to match what ASP.NET Core's own model-state validation emits
  (comment, `ValidationExceptionHandler.cs:46-47`), so a client form component can render field
  errors with one code path regardless of whether the failure came from model binding or from a
  validator running in the CQRS Validating decorator.
- **Walkthrough**: `TryHandleAsync` (`:23`) type-tests and passes on non-validation exceptions
  (`:28-29`), logs at `LogWarning` (`:31`, not `LogError`: an invalid payload is a client mistake,
  not a system fault), sets 400 (`:33`), builds the problem document (`:34-44`), then groups
  `validationException.Errors` by `PropertyName` into a
  `Dictionary<string, string[]>` (`:48-53`) and adds it under the `"errors"` extension key (`:54`)
  before writing (`:56`).
- **Why it's built this way**: the grouping consolidates several failures for one field into one
  array, which is exactly the `ModelStateDictionary` serialization front ends already understand.
  Note the key is the raw `PropertyName` from FluentValidation, not a camelCased alias.
- **Where it's used**: registered fourth (`DependencyInjection.cs:134`), just before the catch-all;
  it is the exception path that complements the `Result`-based validation failures returned by
  [`ApiControllerBase`](#apicontrollerbase).

---

### CorrelationIdMiddleware
> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/CorrelationIdMiddleware.cs:15` · Level 1 · class (sealed)

- **What it is**: convention-based middleware that establishes one correlation ID per request,
  publishes it on the scoped [`ICorrelationContext`](#icorrelationcontext), and echoes it back to the
  caller in the `X-Correlation-ID` response header.
- **Depends on**: [`ICorrelationContext`](#icorrelationcontext) (injected per invoke, so it is
  resolved from the request scope) and `System.Diagnostics.Activity`.
- **Concept**: distributed trace correlation is introduced at
  [`ICorrelationContext`](#icorrelationcontext); this is the type that populates it.
  `[Rubric §13: Observability & Operability]` assesses whether one logical operation can be
  reconstructed across log entries and services: with this middleware first in the pipeline, every
  later log line, outbox row and downstream call can carry the same ID.
- **Walkthrough**
  - `HeaderName = "X-Correlation-ID"` (`CorrelationIdMiddleware.cs:18`) is a public `const`, so
    clients, tests and downstream code all name the header from one place.
  - `InvokeAsync(HttpContext, ICorrelationContext)` (`:27`): the second parameter is
    **per-invoke injected**, which is how convention-based middleware consumes a scoped service from
    a singleton middleware instance. Both arguments are null-guarded (`:29-30`).
  - The resolution waterfall (`:32-34`): the inbound `X-Correlation-ID` header wins, else
    `Activity.Current?.TraceId` (the W3C trace ID that OpenTelemetry propagates), else ASP.NET's
    `HttpContext.TraceIdentifier`. A caller-supplied ID is therefore honored, and the ID always
    exists.
  - `correlationContext.SetCorrelationId(correlationId)` (`:36`) publishes it, then
    `context.Response.OnStarting(...)` (`:37-41`) registers a callback that writes the response
    header. Writing it in `OnStarting` rather than after `await next(...)` is the only safe way:
    once the response has begun, header writes throw.
  - `await next(context)` (`:43`) continues the pipeline.
- **Why it's built this way**: accepting the client's ID makes cross-system correlation possible when
  the caller already has a trace, and falling back to `Activity.Current` means the correlation ID and
  the OpenTelemetry trace ID are the same value in a normally instrumented host.
- **Where it's used**: wired second in the canonical pipeline, right after the exception handler
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:48`), so
  everything downstream (including the exception handlers above) logs under a known ID. The CQRS
  logging decorators read the same context.

---

### DomainExceptionHandler
> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/DomainExceptionHandler.cs:16` · Level 1 · class (sealed)

- **What it is**: the handler that translates a
  [`DomainException`](group-01-result-error-handling.md#domainexception) into a 400 Bad Request
  problem document whose detail is the domain message itself.
- **Depends on**: [`DomainException`](group-01-result-error-handling.md#domainexception)
  (`MMCA.Common.Shared.Exceptions`), `IProblemDetailsService`,
  `ILogger<DomainExceptionHandler>`; chain concept at
  [`DbUpdateExceptionHandler`](#dbupdateexceptionhandler).
- **Concept**: `[Rubric §4: DDD]` and `[Rubric §9: API & Contract Design]`. A domain exception is a
  broken business rule, not a system fault, so two things differ from the other handlers: it logs at
  `LogWarning` (`DomainExceptionHandler.cs:30`) rather than `LogError`, and it is the **one** handler
  that puts the raw exception message into the client-facing `Detail` (`:41`). That is safe precisely
  because a `DomainException` message is authored by the domain layer for humans, unlike an EF or
  infrastructure message.
- **Walkthrough**: `TryHandleAsync` (`:22`) type-tests and returns `false` otherwise (`:27-28`), logs
  the warning (`:30`), sets `StatusCodes.Status400BadRequest` (`:32`), and writes a problem document
  titled `"Domain Exception"` with the domain message as its detail (`:33-45`).
- **Why it's built this way**: it sits second in the chain (`DependencyInjection.cs:132`), ahead of
  the infrastructure handlers, so a business-rule violation never gets mislabeled as a database
  conflict or an internal error. Remember that the framework's primary path for business failures is
  the [`Result`](group-01-result-error-handling.md#result) pattern; this handler covers the code that
  still throws.
- **Where it's used**: `AddCommonExceptionHandlers()` (`DependencyInjection.cs:132`).

---

### ErrorHttpMapping
> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:14` · Level 2 · class (internal static)

- **What it is**: the single table that maps domain
  [`ErrorType`](group-01-result-error-handling.md#errortype) values to HTTP status codes, plus the
  builder for the `errors` extension array that problem documents carry.
- **Depends on**: [`Error`](group-01-result-error-handling.md#error),
  [`ErrorType`](group-01-result-error-handling.md#errortype),
  [`IErrorLocalizer`](#ierrorlocalizer); `System.Collections.Frozen` and ASP.NET `StatusCodes`.
- **Concept: the Result-to-HTTP translation table.** This is where the
  [`Result`](group-01-result-error-handling.md#result) pattern meets the HTTP contract.
  `[Rubric §9: API & Contract Design]` assesses whether error responses are consistent across the
  whole surface: because both [`ApiControllerBase`](#apicontrollerbase) and
  [`UnhandledResultFailureFilter`](#unhandledresultfailurefilter) call into this one class, they
  cannot drift. `[Rubric §27: i18n]` also applies through the localizer parameter.
- **Walkthrough**
  - `ErrorTypeToStatusCode` (`ErrorHttpMapping.cs:20-30`): a `FrozenDictionary<ErrorType, int>` with
    `Validation` -> 400, `Invariant` -> 400, `NotFound` -> 404, `Conflict` -> 409,
    `Unauthorized` -> 401, `Forbidden` -> 403, `UnprocessableEntity` -> 422, `Failure` -> 400.
    `FrozenDictionary` is the right structure for a table built once at startup and read on every
    failed request: it trades slower construction for the fastest lookups.
  - `GetStatusCode(ErrorType)` (`:36-37`) uses `GetValueOrDefault(..., Status400BadRequest)`, so a
    future error type falls back to 400 rather than throwing inside an error path.
  - `BuildErrorsExtension(IReadOnlyList<Error>, IErrorLocalizer?)` (`:47-55`) projects each error into
    an anonymous object with `Code`, `Message`, `Type` (stringified), `Source` and `Target`. Only
    `Message` is localized, and only when a localizer was supplied (`:51`); a null localizer leaves
    the original English text. `Code`/`Type`/`Source`/`Target` stay verbatim so clients can branch on
    them regardless of culture.
- **Why it's built this way**: `internal` visibility (`:14`) keeps the table an implementation detail
  of the API package. Localizing at this exact point is [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html):
  the domain produces culture-free codes, and the edge does the translation.
- **Where it's used**: [`ApiControllerBase`](#apicontrollerbase) when converting a failed
  `Result` into an `IActionResult`, and
  [`UnhandledResultFailureFilter`](#unhandledresultfailurefilter) as the backstop
  (`UnhandledResultFailureFilter.cs:36` and `:47`).

---

### TenantResolutionMiddleware
> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/TenantResolutionMiddleware.cs:36` · Level 3 · class (sealed)

- **What it is**: middleware that resolves the current request's tenant (from a claim or a header),
  publishes it on the scoped [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext), and
  rejects a request that has none when tenancy is required.
- **Depends on**: [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext),
  [`TenancySettings`](group-14-module-system-composition.md#tenancysettings) (via
  `IOptions<T>`), and `IProblemDetailsService`. The persistence layer's query filter, save
  interceptor and per-tenant database routing all read the context this middleware sets.
- **Concept introduced: request-scoped tenant resolution that fails closed.** `[Rubric §11: Security]`
  assesses whether data isolation holds by default: an unscoped request in a multi-tenant database
  reads across every tenant, which is the exact outcome tenancy exists to prevent, so with
  `Tenancy:RequireTenant` (the default) an unresolved tenant is answered `400 Bad Request` rather
  than allowed through (class comment, `TenantResolutionMiddleware.cs:27-33`).
  `[Rubric §8: Data Architecture]` applies because the value published here is what scopes the EF
  global filter. `[Rubric §10: Cross-Cutting Concerns]`: hosts that never opted in pay nothing, since
  `IOptions<TenancySettings>` resolves to defaults with `Enabled` false and the middleware passes
  every request straight through (`:14-20`).
- **Walkthrough**
  - `UnresolvedTenantTitle` (`:39`): the `internal const` problem title, shared with the tests.
  - `InvokeAsync(HttpContext, ITenantContext, IOptions<TenancySettings>, IProblemDetailsService)`
    (`:50`): per-invoke injection again, null-guarding its three services (`:56-58`).
  - Fast exit (`:62-66`): if `!settings.Enabled` or `IsExcluded(...)`, call `next` and return.
    `IsExcluded` (`:89-94`) matches `settings.EffectiveExcludedPathPrefixes` with
    `StartsWithSegments`, which is how health, liveness and discovery endpoints keep answering before
    any tenant exists.
  - Resolution (`:68-73`): `Resolve(...)` returns the first non-blank candidate, and on success the
    tenant is published with `tenantContext.SetTenant(tenantId)` before the pipeline continues.
  - `Resolve` (`:105-122`) walks `settings.EffectiveResolutionOrder` and switches on the strategy:
    `Claim` reads `context.User?.FindFirst(settings.ClaimType)?.Value`, `Header` reads
    `settings.HeaderName`, and `Host` deliberately yields `null` because it is declared but not
    implemented and options validation refuses to start a host that selected it (`:100-104`).
    Candidates are trimmed (`:118`).
  - Opt-out (`:75-81`): with `RequireTenant` false an unresolved request runs as a system caller and
    sees every tenant's rows, which the comment marks as only correct behind an internal boundary.
  - `RejectAsync` (`:128-151`) writes a 400 problem document that names the exact claim and header
    that were inspected, so the caller can fix the request without reading the source.
- **Why it's built this way**: see [ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html).
  The registration position is load-bearing: it runs immediately after `UseAuthentication()`
  (`WebApplicationExtensions.cs:96-102`) because the claim strategy reads `HttpContext.User`, which
  has no token claims until authentication has run. Registering it earlier would silently demote
  every request to the header strategy.
- **Where it's used**: `UseCommonMiddlewarePipeline()` on
  [`WebApplicationExtensions`](#webapplicationextensions)
  (`WebApplicationExtensions.cs:102`), unconditionally and inert by default.

---

### UnhandledResultFailureFilter
> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/UnhandledResultFailureFilter.cs:21` · Level 3 · class (sealed, partial)

- **What it is**: a globally registered `IAlwaysRunResultFilter` that catches an action which
  returned a failed [`Result`](group-01-result-error-handling.md#result) inside an `Ok(...)` (or any
  `ObjectResult`) and rewrites the response as a proper problem document at the right status code.
- **Depends on**: [`Result`](group-01-result-error-handling.md#result),
  [`Error`](group-01-result-error-handling.md#error), [`ErrorHttpMapping`](#errorhttpmapping),
  [`IErrorLocalizer`](#ierrorlocalizer); `Microsoft.AspNetCore.Mvc.Filters.IAlwaysRunResultFilter`.
- **Concept introduced: the always-run result filter as a safety net.** A regular result filter can
  be bypassed on short-circuit paths; `IAlwaysRunResultFilter` runs for every result MVC is about to
  execute. `[Rubric §9: API & Contract Design]` assesses whether a domain failure can leak as `200
  OK` with error JSON in the body (a client would treat it as success), and `[Rubric §15: Best
  Practices & Code Quality]` assesses defense in depth: this filter converts a class of controller
  mistakes into a correct response plus a warning log instead of a silent wrong answer.
- **Walkthrough**: `OnResultExecuting` (`UnhandledResultFailureFilter.cs:25`):
  - The guard `context.Result is not ObjectResult { Value: Result result } || result.IsSuccess`
    (`:27-30`) makes the filter a no-op for everything except an `ObjectResult` carrying a failed
    `Result`. Note the pattern matches the base `Result`, so `Result<T>` values are caught too.
  - Logs at `Warning` with the action's display name and the errors (`:32`, message template at
    `:57-63`), which is how an operator learns *which* action leaked.
  - Picks the first error, if any, and derives the status through
    [`ErrorHttpMapping.GetStatusCode`](#errorhttpmapping) (`:34-37`); with no errors at all it falls
    back to 500, since a failure with nothing to report is a framework-level anomaly, not a client
    error.
  - Resolves [`IErrorLocalizer`](#ierrorlocalizer) from `HttpContext.RequestServices` with
    `GetService` (`:46`, so a host without localization simply passes null) and attaches the
    localized `errors` extension (`:47`).
  - Replaces `context.Result` with an `ObjectResult(problemDetails) { StatusCode = statusCode }`
    (`:49`).
  - `OnResultExecuted` (`:53`) is intentionally empty: there is nothing to do after the response ran.
- **Why it's built this way**: the logging uses the `[LoggerMessage]` source generator (`:57-63`)
  with a small private forwarder (`:65-66`) so the filter's own `logger` field is used without an
  allocation per call. The class is `partial` for that generator.
- **Where it's used**: added as a global MVC filter inside `AddAPI(...)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:49`), so it applies to
  every controller action in every host.

---

### SoftDeletedUserMiddleware
> MMCA.Common.API · `MMCA.Common.API.Middleware` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:31` · Level 9 · class (sealed, partial)

- **What it is**: middleware that rejects an authenticated request with 401 when the calling user has
  been soft-deleted, using a 30-second cached marker so the check does not cost a database round trip
  on every request.
- **Depends on**: [`ICurrentUserService`](group-08-auth.md#icurrentuserservice),
  [`ICacheService`](group-09-caching.md#icacheservice),
  [`ISoftDeletedUserValidator`](group-08-auth.md#isoftdeleteduservalidator) (resolved lazily), and
  [`SoftDeletedUserCache`](group-08-auth.md#softdeletedusercache) for the key and TTL.
- **Concept introduced: a fail-open security check, and why.** `[Rubric §11: Security]` assesses
  whether revoked principals stop being served, and `[Rubric §29: Resilience & Business Continuity]`
  assesses how a dependency outage degrades. The class remarks (`SoftDeletedUserMiddleware.cs:16-29`)
  document the trade-off explicitly: this check runs on the hot path of every authenticated request,
  so failing closed would turn any cache or database blip into a total outage. Failing open is
  bounded instead, because access tokens live 15 minutes and the deletion already revoked the refresh
  token, so no new access token can be minted. The residual exposure is one already-issued token's
  remaining lifetime, and only while a dependency is unhealthy. `[Rubric §12: Performance &
  Scalability]` covers the cache: the marker is 30 seconds
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:29`), long enough to
  absorb bursts and short enough that the validator query is authoritative again quickly.
- **Walkthrough**: `InvokeAsync(HttpContext, ICurrentUserService, ICacheService, ILogger<...>)`
  (`SoftDeletedUserMiddleware.cs:57`), per-invoke injected including the logger:
  - Anonymous fast path (`:65-73`): no `UserId`, call `next` and return. The comment notes this is the
    common case in extracted services, which see internal gRPC/HTTP traffic with no user.
  - Validator resolution (`:75-83`): `context.RequestServices.GetService<ISoftDeletedUserValidator>()`.
    The validator is implemented by the Identity module, so a service that does not host Identity has
    none registered; lazy resolution lets the middleware no-op there instead of 500-ing every request
    (remarks at `:41-51`). This is the "wired unconditionally, inert when not applicable" convention
    that [`TenantResolutionMiddleware`](#tenantresolutionmiddleware) later copied.
  - Cache read (`:85-100`): key from `SoftDeletedUserCache.KeyFor(userId)` (`user:deleted:{userId}`,
    built with `InvariantCulture` at `SoftDeletedUserCache.cs:42-43`). A cache exception that is not
    an `OperationCanceledException` is logged and treated as a miss, and `cacheReachable` goes false
    so the write is skipped too.
  - `cachedResult is true` (`:102-106`): the user is known deleted, respond 401 and stop the pipeline.
  - Cache miss (`:108-148`): query `IsUserSoftDeletedAsync`. If that throws (again excluding
    cancellation) the request is allowed through with a warning (`:118-125`), which is the fail-open
    path. Otherwise the answer is written back to the cache when the cache is reachable (`:127-141`,
    a failed write only costs the next request a lookup), and a deleted user gets 401 (`:143-147`).
  - Otherwise `next` runs (`:150`).
  - Three `[LoggerMessage]` warnings (`:153-175`) name the failure precisely: cache read, cache write,
    validator, each stating what the request did next.
- **Why it's built this way**: every `catch` filters out `OperationCanceledException`
  (`:93`, `:118`, `:135`), so a client disconnect is never misread as a dependency outage and is left
  to [`OperationCanceledExceptionHandler`](#operationcanceledexceptionhandler). Returning a bare 401
  status with no body is deliberate: a revoked principal gets no detail to work with.
- **Where it's used**: `UseCommonMiddlewarePipeline()` places it after `UseRateLimiter()` and before
  `UseAuthorization()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:109`), so it
  runs only once a principal exists and before any policy grants access.

### AppAssociationOptions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/AppAssociationOptions.cs:9` · Level 0 · class (sealed)

- **What it is**: the strongly-typed options bag carrying the identifiers a mobile OS needs in order to
  verify that an installed native app may claim this host's https links. It feeds
  [`AppAssociationEndpointExtensions`](#appassociationendpointextensions), which serializes it into the
  two well-known documents (Android Digital Asset Links and the Apple App Site Association).
- **Depends on**: nothing first-party. BCL only (`IReadOnlyList<string>`).
- **Concept introduced (deep-link / universal-link association).** For a Blazor Hybrid app to open a
  shared web URL directly in the installed native app rather than the browser, the operating system
  fetches an association document from the URL's host and checks that the installed app's signing
  identity matches what the document names. This options type is the single source of those identities,
  so a certificate rotation is a config change and not a code change (the doc comment says exactly that
  at `AppAssociationOptions.cs:3-8`). `[Rubric §9, API & Contract Design]` assesses whether public
  contracts are typed and pinned rather than hand-built inline; here the "public contract" is the exact
  JSON payload Google and Apple parse, and binding its inputs from an `AppAssociation` configuration
  section is that discipline. `[Rubric §11, Security]` also applies: the fingerprints in this bag are
  what stop an unrelated app from claiming the host's links.
- **Walkthrough**: four members, all `init`-only.
  - `AndroidPackageName` (`AppAssociationOptions.cs:12`, `required`): the Android application id
    declared in `assetlinks.json`.
  - `AndroidCertFingerprints` (`AppAssociationOptions.cs:18`, defaults to `[]`): the SHA-256
    signing-certificate fingerprints; the doc comment (`:14-17`) warns that for Play-distributed builds
    this is the Play App Signing certificate, not the local upload keystore.
  - `AppleAppId` (`AppAssociationOptions.cs:21`, `required`): the `TeamID.BundleID` value used by both
    the `webcredentials` and the `applinks` sections.
  - `AppleAppLinkComponents` (`AppAssociationOptions.cs:28`, defaults to `[]`): the URL patterns (for
    example `"/conference/*"`) that each become a `{ "/": pattern }` component; the comment (`:23-27`)
    notes these should mirror the app's shared Blazor routes, because identical URLs on web and device
    is the Blazor Hybrid payoff (no route-translation table).
- **Why it's built this way**: `required init` gives compile-checked construction plus immutability once
  bound (see the primer on [`required`/`init` immutability](00-primer.md#2-architectural-styles-this-codebase-commits-to)),
  which matches the lifetime: a host builds one instance at startup and the endpoint reads it for the
  process lifetime. Defaulting the two collections to `[]` means a host that ships only one platform
  still constructs a valid document for the other. See
  [ADR-043](https://ivanball.github.io/docs/adr/043-mobile-deep-links-and-native-oauth-callback.html)
  for the deep-link decision this serves.
- **Where it's used**: constructed inline by the ADC Blazor web host and passed straight to the mapper,
  with the Android/Apple identifiers read from the `AppAssociation` configuration section and the
  applinks patterns hard-coded to the app's routes
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:168-179`).
- **Caveats / not-in-source**: the type performs no validation. Whether a fingerprint or bundle id is
  the *correct* one for the shipped app is only observable at install time on the device; the ADC call
  site carries a comment about exactly that trap (Release overrides the Android application id, so the
  Debug package name would silently fail verification for every store install,
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:171-174`).

### ICorrelationContext
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICorrelationContext.cs:8` · Level 0 · interface

- **What it is**: the scoped abstraction that holds the correlation ID for the current request.
  Middleware sets it from the inbound `X-Correlation-ID` header (or a generated value) and everything
  downstream reads it through structured-logging scopes.
- **Depends on**: nothing first-party, nothing external. Its holder implementation is
  [`CorrelationContext`](#correlationcontext) (Infrastructure) and its writer is
  [`CorrelationIdMiddleware`](#correlationidmiddleware) (API).
- **Concept introduced (distributed trace correlation).** `[Rubric §13, Observability & Operability]`
  assesses whether one logical operation can be reconstructed end to end from disjoint logs; a
  **correlation ID** is the single value stamped on every log line for one request that makes that
  possible, and it survives a service extraction because the ID travels on the wire rather than in
  process memory. `[Rubric §10, Cross-Cutting Concerns]` also applies: handlers and decorators read the
  ID through this interface and never touch `HttpContext`, so the concern is factored out of business
  code entirely.
- **Walkthrough**: two members. `CorrelationId { get; }` (`ICorrelationContext.cs:11`) is what every
  downstream reader uses, and `SetCorrelationId(string)` (`ICorrelationContext.cs:15`) is what the
  middleware calls once at the start of a request. Keeping the setter on the same interface rather than
  splitting a second write-only abstraction is a deliberate simplification: exactly one type in the
  stack calls it.
- **Why it's built this way**: the interface lives in **Application**, not Infrastructure, so the CQRS
  logging decorators can enrich their log scope without taking an ASP.NET dependency, which keeps the
  dependency arrow pointing inward `[Rubric §3, Clean Architecture]`. The same shape is deliberately
  mirrored by the tenancy abstraction: [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext)'s
  doc comment names `ICorrelationContext` as its model (one scoped instance per request, populated once
  at the edge, `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ITenantContext.cs:11`).
- **Where it's used**: registered as `services.TryAddScoped<ICorrelationContext, CorrelationContext>()`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:446`), so one instance
  lives per request and a host may substitute its own implementation by registering first. It is written
  by [`CorrelationIdMiddleware`](#correlationidmiddleware), which resolves it as a method parameter of
  `InvokeAsync` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/CorrelationIdMiddleware.cs:27`)
  and sets it from the header, the current `Activity` trace ID, or `HttpContext.TraceIdentifier` in that
  order (`CorrelationIdMiddleware.cs:32-36`). It is read by
  [`LoggingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#loggingcommanddecoratortcommand-tresult)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/LoggingCommandDecorator.cs:16`,
  read into the log scope at `:23-25`) and
  [`LoggingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#loggingquerydecoratortquery-tresult)
  (`.../LoggingQueryDecorator.cs:15`).
- **Caveats / not-in-source**: nothing in the framework source publishes the correlation ID onto outbox
  messages or broker headers, so cross-process correlation today rests on the HTTP header echo plus
  OpenTelemetry's own trace context, not on this interface.

### JwtForwardingDelegatingHandler
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Http` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Http/JwtForwardingDelegatingHandler.cs:17` · Level 0 · class (sealed)

- **What it is**: an HTTP `DelegatingHandler` that copies the inbound `Authorization` header from the
  current `HttpContext` onto every outgoing request, so a typed service client forwards the caller's
  bearer token to a downstream service without any handler threading the token by hand.
- **Depends on**: `Microsoft.AspNetCore.Http.IHttpContextAccessor` (primary-constructor parameter,
  `JwtForwardingDelegatingHandler.cs:17`) and BCL `DelegatingHandler`/`AuthenticationHeaderValue`. It is
  the HTTP twin of the gRPC
  [`JwtForwardingClientInterceptor`](group-13-grpc-contracts.md#jwtforwardingclientinterceptor), a
  relationship the doc comment states outright (`:11-15`).
- **Concept introduced (token propagation for distributed authorization).** `[Rubric §7, Microservices
  Readiness]` assesses whether a module can be lifted into its own process without rewriting
  application code, and `[Rubric §11, Security]` assesses how identity is carried across a trust
  boundary. When an extracted service calls another service on behalf of a user, the downstream needs
  that user's JWT to authorize the call. Doing that per call site would be both repetitive and easy to
  forget; putting it in the `HttpClient` message pipeline makes it a property of the client
  registration, so no application code participates `[Rubric §10, Cross-Cutting Concerns]`.
- **Walkthrough**: one override, `SendAsync` (`JwtForwardingDelegatingHandler.cs:22`).
  - Null-guards the request (`:24`).
  - If `request.Headers.Authorization` is already set it forwards untouched (`:27-30`), so an explicit
    token or a prior handler in the chain is never overwritten.
  - Reads the inbound header through `IHttpContextAccessor` (`:32`); when there is no context or no
    header (background processors, outbox dispatch, tests) it is a plain **no-op** and calls
    `base.SendAsync` (`:33-36`).
  - Normalizes the scheme: a value starting with `Bearer ` (case-insensitive) has the prefix stripped,
    otherwise the whole string is treated as the token, and it is re-attached as a fresh
    `AuthenticationHeaderValue("Bearer", token)` (`:40-45`). The `BearerScheme` constant (`:19`) is the
    one place the scheme name is spelled.
- **Why it's built this way**: the no-op-without-context branch is what lets the handler be registered
  unconditionally on a typed client. Background services run with their own credentials rather than an
  ambient user's token, and without that branch every non-HTTP invocation path would need conditional
  wiring at the call site.
- **Where it's used**: `AddTypedServiceClient<TInterface, TImplementation>(serviceName)` registers it
  transiently and attaches it to the client pipeline
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:716`, `:723`, `:728`),
  alongside `AddHttpContextAccessor()` (`:722`) and the standard Polly resilience handler (`:731`). That
  helper is the HTTP counterpart to `AddTypedGrpcClient<T>`; its doc comment (`:698-711`) says to prefer
  gRPC for service-to-service contracts and to use this for webhook receivers, public REST endpoints,
  and third-party API wrappers.

### OpenApiEndpointExtensions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/OpenApiEndpointExtensions.cs:18` · Level 0 · class (static, extension block)

- **What it is**: two `extension(WebApplication app)` mapping helpers that expose the generated OpenAPI
  document and an optional interactive reference UI, both **outside Production only**.
- **Depends on**: `Scalar.AspNetCore` (NuGet) for the reference UI and `Asp.Versioning`'s
  `WithDocumentPerVersion()` convention. It pairs with `AddCommonOpenApi()` on
  [`WebApplicationBuilderExtensions`](#webapplicationbuilderextensions), which registers the generator.
- **Concept introduced (the OpenAPI document as a dev/CI artifact, not a public surface).**
  `[Rubric §9, API & Contract Design]` assesses whether an API has a machine-readable contract and
  whether that contract is guarded against silent drift. The doc comment
  (`OpenApiEndpointExtensions.cs:7-17`) is explicit on both halves: the document is the source of truth
  for the API surface and is meant to be guarded by a contract-snapshot test in the consumer
  integration tiers, which the framework deliberately does not duplicate because the surface lives in
  the consumer hosts (the shipped base for that gate is
  [`OpenApiContractTestsBase<TFixture>`](group-27-testing-infrastructure.md#openapicontracttestsbasetfixture),
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing/OpenApiContractTestsBase.cs:21`,
  [ADR-058](https://ivanball.github.io/docs/adr/058-runtime-conformance-suites-as-a-package.html)).
  Mapping outside Production is the security posture `[Rubric §11, Security]`: these are internal
  services reached through the Gateway, which does not route the endpoint.
- **Walkthrough**
  - `MapCommonOpenApi()` (`OpenApiEndpointExtensions.cs:30`) calls the built-in `MapOpenApi()` only when
    `!app.Environment.IsProduction()` (`:32-35`) and chains `.WithDocumentPerVersion()`, which applies
    the API-versioning convention so the route resolves one document per discovered API version
    (`/openapi/v1.json` for v1.0, doc comment `:22-29`). It is a no-op in Production and returns `app`
    for chaining (`:37`).
  - `MapCommonScalarUi()` (`OpenApiEndpointExtensions.cs:48`) is the opt-in developer convenience: it
    calls `MapScalarApiReference()` outside Production (`:50-53`), rendering `/scalar/{documentName}`.
    Assets ship inside the `Scalar.AspNetCore` package rather than a CDN (`:45-46`), so it works offline
    and in CI.
- **Why it's built this way**: one shared pair of helpers keeps every service's OpenAPI story identical
  and enforces the "internal spec, not public surface" convention in one place instead of per host. The
  version-aware document mapping is what keeps the route stable as versions accumulate
  ([ADR-046](https://ivanball.github.io/docs/adr/046-http-api-versioning.html)).
- **Where it's used**: inside this workspace the only caller is the framework's own test host
  (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/OpenApi/ApiParameterDescriptorBackfillProviderTests.cs:176`).
  The ADC service hosts today call the stock ASP.NET pair directly instead: `services.AddOpenApi()` and
  a `MapOpenApi()` guarded by their own environment check (for example
  `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:195` and `:331`,
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:270` and `:382`). This is the
  framework offering a convention ahead of the consumers adopting it.

### AppAssociationEndpointExtensions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/AppAssociationEndpointExtensions.cs:15` · Level 1 · class (static, extension block)

- **What it is**: a mapping helper that serves the two well-known app-association documents from an
  [`AppAssociationOptions`](#appassociationoptions): Android Digital Asset Links at
  `/.well-known/assetlinks.json` and the Apple App Site Association at
  `/.well-known/apple-app-site-association`.
- **Depends on**: [`AppAssociationOptions`](#appassociationoptions) (Level 0) for every value; ASP.NET
  `IEndpointRouteBuilder` and `Results.Json`.
- **Concept (anonymous, machine-verified association documents).** Both endpoints are anonymous by
  design because the OS and Apple's CDN fetch them without credentials, which the doc comment states
  (`AppAssociationEndpointExtensions.cs:11-13`). `[Rubric §9, API & Contract Design]`: the exact JSON
  shape is a contract a third party parses, so the code builds it structurally out of dictionaries
  rather than formatting strings by hand.
- **Walkthrough**
  - Two path constants: `AssetLinksPath` (`AppAssociationEndpointExtensions.cs:18`) and
    `AppleAppSiteAssociationPath` (`:24`). The comment on the Apple constant (`:20-23`) records that
    the path deliberately has no file extension because Apple requires that exact path, while the
    content type must still be JSON.
  - `MapAppAssociationEndpoints(AppAssociationOptions options)` (`:35`) null-guards the options (`:37`),
    builds both documents once at map time because they are static for the process lifetime (`:39-40`),
    then maps two `GET`s that each return `Results.Json(...)`, are `.AllowAnonymous()` and are
    `.ExcludeFromDescription()` so they never leak into the OpenAPI document (`:42-48`).
  - `BuildAssetLinks` (`:54`) emits the `delegate_permission/common.handle_all_urls` relation with the
    Android package name and the fingerprint list (`:58-64`).
  - `BuildAppleAppSiteAssociation` (`:68`) emits the `applinks` details block, projecting each
    configured URL pattern into a `{ "/": pattern }` component (`:78-80`), plus the `webcredentials`
    apps list naming the same app id (`:84-87`).
- **Why it's built this way**: building the payload once at map time avoids a per-request allocation for
  a document that never changes `[Rubric §12, Performance & Scalability]`, and holding the RFC 8615
  well-known paths as public constants keeps them from drifting between hosts or between the endpoint
  and any gateway forwarding rule.
- **Where it's used**: the ADC Blazor web host maps them once at startup
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:169`), which is the host that ships a companion
  MAUI Hybrid app.

### JwksEndpointExtensions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/JwksEndpointExtensions.cs:15` · Level 1 · class (static, extension block)

- **What it is**: maps `/.well-known/jwks.json`, serializing the active `JsonWebKeySet` of the Identity
  service so other services can validate its RS256 tokens.
- **Depends on**: [`IJwksProvider`](group-08-auth.md#ijwksprovider), resolved from DI per request, whose
  implementation is [`RsaJwksProvider`](group-08-auth.md#rsajwksprovider); plus
  `Microsoft.IdentityModel.Tokens.JsonWebKeySet` and `System.Text.Json`.
- **Concept (the public-key distribution endpoint of cross-service auth).** `[Rubric §11, Security]` and
  `[Rubric §7, Microservices Readiness]`: with RS256 only the Identity service holds the private key,
  and every other service fetches the public keys from here, so no shared secret ever crosses a service
  boundary ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)). The
  endpoint is `.AllowAnonymous()` (`JwksEndpointExtensions.cs:39`) because clients fetch it *before*
  they have a token, which is what JWKS means (RFC 7517; the doc comment says so at `:27-28`).
- **Walkthrough**: the `DefaultJwksPath` constant (`JwksEndpointExtensions.cs:20`) pins the RFC 8615
  path. `MapJwksEndpoint()` (`:31`) maps a single `GET` whose handler takes `HttpContext` and
  `IJwksProvider` as parameters (`:33`), calls `GetJsonWebKeySet()` (`:35`), serializes with
  `JsonSerializer` (`:36`), sets `application/json; charset=utf-8` explicitly (`:37`), and writes the
  body (`:38`). The whole endpoint is nine lines because the key material and its rotation live behind
  the provider.
- **Why it's built this way**: non-Identity hosts still map it (see
  [`WebApplicationExtensions`](#webapplicationextensions), which calls it unconditionally); their
  provider returns an empty key set rather than erroring, so the wiring is uniform across every host and
  a single gateway forwarder rule for `/.well-known/*` covers JWKS discovery for the whole platform.
- **Where it's used**: mapped inside `UseCommonMiddlewarePipeline()`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:118`), so every
  host that adopts the shared pipeline serves it; the path it owns is the `jwks_uri` value that
  [`OidcDiscoveryEndpointExtensions`](#oidcdiscoveryendpointextensions) advertises, which is in turn what
  `AddForwardedJwtBearer` (on [`WebApplicationBuilderExtensions`](#webapplicationbuilderextensions))
  reaches through OIDC discovery. It also has its own framework test host
  (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Startup/JwksEndpointTests.cs:152`).

### MiniProfilerExtensions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/MiniProfilerExtensions.cs:9` · Level 2 · class (static, extension block)

- **What it is**: a conditional MiniProfiler registration helper. When
  [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings)`.UseMiniProfiler` is
  true it registers MiniProfiler plus its Entity Framework integration; otherwise it does nothing.
- **Depends on**: [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings)
  (the flag is declared on the interface at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Settings/IApplicationSettings.cs:10` and implemented
  at `.../Settings/ApplicationSettings.cs:14`); `StackExchange.Profiling` (NuGet).
- **Concept (opt-in, settings-gated profiling).** `[Rubric §13, Observability & Operability]` assesses
  whether diagnostics exist and whether they cost anything when switched off. One configuration flag
  turns a cross-cutting profiler on or off with no application code involved, and when off the
  MiniProfiler services are never registered at all, so there is no middleware and no per-request work.
- **Walkthrough**: one member, `AddMiniProfilerIfEnabled(ApplicationSettings)`
  (`MiniProfilerExtensions.cs:16`). It tests `applicationSettings.UseMiniProfiler` (`:18`) and only then
  calls `AddMiniProfiler(...)` with a `/profiler` route base, `PopupShowTimeWithChildren`, the dark color
  scheme (`:20-25`), and `.AddEntityFramework()` so EF/SQL timings appear inline. It returns `services`
  either way (`:28`) so the call chains.
- **Why it's built this way**: gating on a settings flag rather than `#if DEBUG` lets one specific
  environment (a staging slot, say) enable profiling without a rebuild, while production leaves it off
  and pays nothing. The default is off:
  [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings)`.UseMiniProfiler` is
  a plain `bool` with no initializer, which the framework test asserts explicitly
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Settings/ApplicationSettingsTests.cs:12-13`).
- **Where it's used**: **no host in this workspace calls it today.** `AddAPI(...)`
  (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:44`) does not invoke it, and
  no ADC or Store `Program.cs` does either; the helper is available for a host that opts in.

### OidcDiscoveryEndpointExtensions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/OidcDiscoveryEndpointExtensions.cs:22` · Level 2 · class (static, extension block)

- **What it is**: maps a minimal OpenID Connect discovery document at
  `/.well-known/openid-configuration`. It returns just enough for token validation (the `issuer` and
  `jwks_uri` fields, plus three supported-algorithm arrays), so a downstream service that points its JWT
  authority here can discover the signing keys automatically. When no issuer is configured it returns
  `404`.
- **Depends on**: [`JwksEndpointExtensions`](#jwksendpointextensions)`.DefaultJwksPath` to compose the
  `jwks_uri` (`OidcDiscoveryEndpointExtensions.cs:76`); `IConfiguration` for `Jwt:Issuer`;
  `System.Text.Json`.
- **Concept (OIDC discovery as the bootstrap for JWKS-based validation).** `[Rubric §7, Microservices
  Readiness]` and `[Rubric §11, Security]`: `AddForwardedJwtBearer` sets an `Authority`, and the JWT
  bearer middleware fetches `{authority}/.well-known/openid-configuration` to learn the issuer and the
  JWKS URL. This endpoint answers that fetch, which is the other half of
  [ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html) alongside
  [`JwksEndpointExtensions`](#jwksendpointextensions).
- **Walkthrough**
  - `DefaultOidcDiscoveryPath` constant (`OidcDiscoveryEndpointExtensions.cs:27`).
  - Three static arrays (`token`, `public`, `RS256`, `:32-34`) and an `OidcJsonOptions` with
    `PropertyNamingPolicy = null` (`:43-46`). Disabling the naming policy is load-bearing: the field
    names are already OIDC snake_case, and camelCasing `jwks_uri` to `jwksUri` would leave
    `OpenIdConnectConfigurationRetriever` unable to recognise the document (`:36-42`). The fields sit
    under a scoped `#pragma warning disable IDE0052` (`:31`, restored `:47`) because the analyzer does
    not see reads that happen inside a C# extension block, and the comment records that
    (`:29-30`).
  - `MapOidcDiscoveryEndpoint()` (`:58`) maps a `GET` that is `.AllowAnonymous()` (`:86`) and reads
    `Jwt:Issuer` (`:62`); a blank issuer returns `Results.NotFound()` (`:63-66`), safe because no
    downstream points its authority at a non-Identity host. Otherwise it derives `jwks_uri` from the
    configured issuer rather than the inbound request (`:76`) and returns the issuer, that URI, and the
    three supported-value arrays (`:78-85`).
- **Why it's built this way**: the comment at `:68-75` documents the subtle reason `jwks_uri` is built
  from the configured issuer and not from the request. Aspire/DCP fronts the Identity service on
  per-launchSettings ports and rewrites `Host` via `X-Forwarded-Host` to canonical ports that internal
  callers cannot always reach, so reusing the issuer keeps issuer and `jwks_uri` origin-aligned (a
  common OIDC client requirement) and routes both through the same gateway that fronts `/Auth`, which
  means one forwarder rule for `/.well-known/*` covers everything.
- **Where it's used**: mapped unconditionally by [`WebApplicationExtensions`](#webapplicationextensions)
  in the shared pipeline (`WebApplicationExtensions.cs:119`); consumed by the bearer middleware that
  `AddForwardedJwtBearer` configures on
  [`WebApplicationBuilderExtensions`](#webapplicationbuilderextensions).

### SignalRExtensions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/SignalRExtensions.cs:12` · Level 3 · class (static, extension block)

- **What it is**: a one-method helper that maps the
  [`NotificationHub`](group-10-notifications.md#notificationhub) SignalR endpoint at the path configured
  in [`PushNotificationSettings`](group-14-module-system-composition.md#pushnotificationsettings), and
  no-ops when push notifications are disabled or their settings were never registered.
- **Depends on**: [`NotificationHub`](group-10-notifications.md#notificationhub) (Infrastructure),
  [`PushNotificationSettings`](group-14-module-system-composition.md#pushnotificationsettings), and
  `IOptions<T>`.
- **Concept (conditional real-time endpoint mapping).** `[Rubric §6, CQRS & Event-Driven]`: the SignalR
  hub is the real-time delivery arm of the notification pipeline, so mapping it behind a settings gate
  means a host that does not push notifications simply never opens the endpoint, and the same
  `Program.cs` line is safe in every host.
- **Walkthrough**: `MapNotificationHub()` (`SignalRExtensions.cs:22`) resolves
  `IOptions<PushNotificationSettings>` through `GetService<T>()`, which returns null when nothing
  registered it, and takes `?.Value` (`:24`). Only when `settings is { Enabled: true }` does it call
  `MapHub<NotificationHub>(settings.HubPath)` (`:25-28`). The doc comment (`:16-21`) notes it must run
  after `UseCommonMiddlewarePipeline()` so authentication and routing are already in place.
- **Why it's built this way**: `GetService` rather than `GetRequiredService`, plus the property-pattern
  guard, is what makes the call unconditionally safe; it matches the same "always call, no-op if not
  applicable" convention as the JWKS and OIDC mappers.
- **Where it's used**: the ADC Notification service maps it after the shared pipeline
  (`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/Program.cs:275`, with the pipeline itself at
  `:258`); that host reads the hub path from configuration rather than hard-coding it (`:271`).

### WebApplicationBuilderExtensions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:26` · Level 3 · class (static, extension block)

- **What it is**: the consolidated **builder-side** registration surface shared by every MMCA host: API
  versioning, rate limiting, response compression, OpenAPI, CORS, and the two JWT authentication modes
  (in-process validation and JWKS-forwarded validation). It is the sibling of
  [`WebApplicationExtensions`](#webapplicationextensions), which owns middleware order; this one owns
  what goes into the DI container.
- **Depends on**: [`JwtSettings`](group-14-module-system-composition.md#jwtsettings) and its
  `JwtSigningAlgorithm`; `AddAuthorizationPolicies` from `MMCA.Common.API.Authorization`;
  [`ApiParameterDescriptorBackfillProvider`](#apiparameterdescriptorbackfillprovider); ASP.NET
  rate-limiting, compression, CORS and `Asp.Versioning` primitives; `Microsoft.IdentityModel.Tokens`.
- **Concept introduced (per-user global rate limiting and algorithm-pinned JWT validation).**
  `[Rubric §12, Performance & Scalability]` (a global limiter protects finite capacity),
  `[Rubric §11, Security]` (algorithm pinning, HTTPS metadata, per-IP anonymous auth throttling) and
  `[Rubric §9, API & Contract Design]` (versioning, OpenAPI and compression handled identically across
  hosts rather than per host).
- **Walkthrough**: the load-bearing members, in file order.
  - `CorsPolicyAllowSpecificOrigins` / `CorsPolicyAllowAll` (`WebApplicationBuilderExtensions.cs:29`,
    `:32`): the two policy names the pipeline chooses between by environment.
  - `RateLimitPolicyAuthIp` (`:41`): the named `"auth-ip"` policy for anonymous authentication attempts.
    Its comment (`:34-40`) states why it exists: the global limiter deliberately no-ops for anonymous
    traffic and per-account lockout is per-email, which would leave a password spray (one password, many
    emails) from a single source unthrottled.
  - `IsRateLimitBypassed(HttpContext)` (`:47`) exempts `/health`, `/alive`, `/.well-known/*` and
    `application/grpc` content types (`:48-51`), all legitimately high-frequency. It is `internal`
    rather than private specifically so the exemption logic is unit-testable through
    `InternalsVisibleTo` instead of only under a request flood (`:45-46`).
  - `GlobalRateLimitPartition(HttpContext, int)` (`:57`) returns a `NoLimiter` for bypassed
    infrastructure (`:59-62`) and for unauthenticated callers (`:64-67`), and otherwise a one-minute
    fixed-window limiter partitioned by `Identity.Name`, then the `user_id` claim, then the remote IP,
    then the literal `"authenticated"` (`:69-80`).
  - `AuthIpRateLimitPartition(HttpContext, int)` (`:93`) partitions the `"auth-ip"` policy on the client
    IP and returns **no limiter at all** when the IP is unattributable (`:97-98`). The remark (`:87-92`)
    explains the choice: failing open on a null IP beats collapsing every such request into one shared
    bucket, which would throttle the in-process `TestServer` and the integration tier to a standstill.
  - `AddCommonApiVersioning()` (`:115`): header-based versioning through the `api-version` reader with
    `AssumeDefaultVersionWhenUnspecified` and `ReportApiVersions` (`:120-130`), the API explorer group
    format `'v'VVV` and `SubstituteApiVersionInUrl` (`:126-130`), then the backfill guard (`:132`). The
    comment (`:117-119`) records that `DefaultApiVersion` is deliberately not set because 1.0 is already
    the framework default and restating it trips AV0011/AV0024. See
    [ADR-046](https://ivanball.github.io/docs/adr/046-http-api-versioning.html).
  - `AddCommonRateLimiting(...)` (`:162`) installs the global limiter (`:167-168`) plus the named
    `FixedPolicy` (`:170`), `UserPolicy` (`:178`) and `"auth-ip"` (`:199-201`) limiters for opt-in
    `[EnableRateLimiting]` use, with rejection status `429` (`:165`). Its defaults are
    `permitLimit: 100, queueLimit: 2, perUserPermitLimit: 30, globalPermitLimit: 300,
    authIpPermitLimit: 30` (`:162`). The long doc comment (`:137-161`) carries the two rationales worth
    knowing: anonymous traffic is deliberately unlimited (public endpoints are output-cached, login
    brute force is handled by the login-protection service, and anonymous Blazor Server traffic shares
    the UI host's IP), and `authIpPermitLimit` is 30 rather than a tighter 10 because Server circuits
    issue the login call server-side, so every Server-circuit user shares that one IP. See
    [ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html).
  - `AddCommonResponseCompression()` (`:207`): Brotli plus Gzip, enabled for HTTPS, both at
    `CompressionLevel.Fastest` (`:209-221`); the comment (`:217-219`) justifies Fastest for gzip too on
    fractional-vCPU hosts serving dynamic payloads.
  - `AddCommonOpenApi()` (`:236`): `services.AddApiVersioning().AddOpenApi()` (`:238`), so the generator
    produces one document per discovered API version named by the explorer's `GroupNameFormat`, plus the
    backfill guard (`:239`). The comment (`:226-234`) notes the parameterless `AddApiVersioning()` only
    returns the builder, so options configured by `AddCommonApiVersioning` accumulate independently of
    call order. Pair it with `MapCommonOpenApi()` on
    [`OpenApiEndpointExtensions`](#openapiendpointextensions).
  - `AddApiParameterDescriptorBackfill()` (`:251`, private) registers
    [`ApiParameterDescriptorBackfillProvider`](#apiparameterdescriptorbackfillprovider) via
    `TryAddEnumerable` (`:252-253`), which de-duplicates on implementation type so calling both
    `AddCommonApiVersioning` and `AddCommonOpenApi` installs the guard exactly once.
  - `AddForwardedJwtBearer(authority, audience, requireHttpsMetadata = false)` (`:274`) is the
    **extracted-service** mode: it validates its two string arguments (`:279-280`), sets `Authority`,
    `Audience` and `RequireHttpsMetadata` (`:285-287`), deliberately leaves `ValidIssuer` unset so the
    middleware takes the issuer from the discovery document (`:295-300`), and pins
    `ValidAlgorithms = [RsaSha256]` as defense against an algorithm-confusion swap (`:302-308`). It also
    installs the SignalR `access_token` query-string fallback for `/hubs` (`:312-325`) and then calls
    `AddAuthorizationPolicies()` (`:328`).
  - `AddCommonAuthentication(IConfiguration)` (`:344`) is the **in-process** mode: it binds
    [`JwtSettings`](group-14-module-system-composition.md#jwtsettings) with data-annotation validation on
    start (`:346-349`), builds validation parameters through `BuildValidationParameters` (`:357`), wires
    the same `/hubs` access-token fallback (`:362-375`), and adds the authorization policies (`:378`).
  - `AddCommonCors(IConfiguration)` (`:387`): the restrictive production policy takes its origins from
    `Cors:AllowedOrigins` and allowlists the SignalR headers and five methods with `AllowCredentials`
    (`:391-398`); the development any-origin policy sits under a justified `#pragma warning disable
    S5122` explaining it is only ever selected when the environment is Development (`:399-404`).
  - `GetValidatedSigningKey(string)` (`:415`) decodes the Base64 HMAC key and throws when it is under
    256 bits (`:418-422`), so a too-short secret fails at startup rather than weakening every token.
  - `BuildValidationParameters(JwtSettings)` (`:434`) branches on
    `JwtSettings.SigningAlgorithm`: RS256 requires `RsaPublicKeyPem` and throws a message that points at
    `AddForwardedJwtBearer` when it is missing (`:438-442`), imports the PEM into an `RSA` held for the
    app lifetime (`:444-447`, with a justified CA2000 suppression) and pins RS256 (`:457`); the default
    HS256 path builds a `SymmetricSecurityKey` from the validated secret and pins HmacSha256
    (`:461-474`).
- **Why it's built this way**: two authentication entry points are the framework's
  monolith-to-microservice hinge
  ([ADR-004](https://ivanball.github.io/docs/adr/004-authentication-dual-fetch.html)): the monolith or
  the issuing Identity service validates in process against a local key, while an extracted service
  validates against the issuer's published JWKS with no shared secret. The explicit `ValidAlgorithms`
  pin on **both** paths is deliberate defense in depth rather than trust in the token header.
- **Where it's used**: every ADC service host calls the builder-side quartet in one block, for example
  `AddCommonCors` / `AddCommonApiVersioning` / `AddCommonRateLimiting` / `AddCommonResponseCompression`
  at `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:167`, `:168`, `:177`, `:190`.
  Identity hosts take the in-process mode (`.../MMCA.ADC.Identity.Service/Program.cs:203`,
  `MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:167`) while the other services take
  the forwarded mode (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:279`,
  `.../MMCA.ADC.Engagement.Service/Program.cs:193`, `.../MMCA.ADC.Notification.Service/Program.cs:179`,
  `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:189`). The `"auth-ip"` policy is
  applied by attribute on the login and register actions
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/AuthController.cs:48`, `:72`;
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/AuthController.cs:48`). The
  internal partition helpers are exercised directly by
  [`WebApplicationBuilderExtensionsTests`](group-27-testing-infrastructure.md#webapplicationbuilderextensionstests).
- **Caveats / not-in-source**: the five permit-limit defaults on `AddCommonRateLimiting` (`:162`) are
  framework defaults only. What a given deployment actually enforces is whatever the host passes (ADC's
  Identity service reads its auth-IP limit from `RateLimiting:AuthIp:PermitLimit`,
  `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:177-178`), and that configuration value
  is not determinable from this file.

### IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityDTOMapper.cs:14` · Level 4 · interface

- **What it is**: the contract for mapping a domain entity to its DTO. It declares `MapToDTO(entity)`
  and ships a default `MapToDTOs(collection)` that fans `MapToDTO` across a collection.
- **Depends on**:
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  and [`IBaseDTO<TIdentifierType>`](#ibasedtotidentifiertype), both as generic constraints.
- **Concept introduced (manual DTO mapping).** `[Rubric §16, Maintainability]`: the framework maps by
  hand in classes implementing this interface rather than through a reflective mapper, so a missing or
  mistyped mapping is a compile error and not a runtime surprise
  ([ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)).
  `[Rubric §1, SOLID]`: the interface has exactly one required member (interface segregation), and the
  default `MapToDTOs` (`IEntityDTOMapper.cs:27-32`) is a C# **default interface method**, so every
  concrete mapper inherits batch mapping for free and overrides it only when a bulk-lookup optimization
  is worth writing `[Rubric §2, Design Patterns]`.
- **Walkthrough**: the three constraints (`IEntityDTOMapper.cs:15-17`) force the entity and the DTO to
  agree on the identifier type and require it to be `notnull`, so a structurally unsound mapper does not
  compile. `MapToDTO(TEntity)` (`:22`) is the single required member. `MapToDTOs(...)` (`:27`)
  null-guards its argument (`:29`) and projects with `Select` into a read-only collection through a
  collection expression (`:31`).
- **Why it's built this way**: [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html)
  chose compile-time discoverability over reflective convenience. Implementations are auto-registered by
  the Scrutor scan, which picks up everything assignable to the open generic
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:134`), so adding a mapper
  needs no DI edit.
- **Where it's used**: it is a constructor dependency and a public property of
  [`EntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#entityqueryservicetentity-tentitydto-tidentifiertype)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:35`, `:51`) and is
  surfaced on the [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)
  contract (`.../Interfaces/IEntityQueryService.cs:25`). The framework ships one implementation itself,
  [`PushNotificationDTOMapper`](group-10-notifications.md#pushnotificationdtomapper)
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Notifications/PushNotifications/DTOs/PushNotificationDTOMapper.cs:13`,
  explicitly registered at `.../Notifications/DependencyInjection.cs:44`), and every module in the apps
  supplies one per entity (for example
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/DTOs/UserDTOMapper.cs:15` and
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sponsors/DTOs/SponsorDTOMapper.cs:14`).

### IEntityRequestMapper<TEntity, TCreateRequest, TIdentifierType>
> MMCA.Common.Application · `MMCA.Common.Application.Interfaces` · `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityDTOMapper.cs:42` · Level 4 · interface

- **What it is**: the create-side counterpart to
  [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](#ientitydtomappertentity-tentitydto-tidentifiertype).
  It maps an incoming create request to a domain entity through that entity's factory method, returning
  `Task<Result<TEntity>>` so asynchronous validation can run before the entity exists. It is declared in
  the **same file** as the read mapper, so one file owns both mapping directions.
- **Depends on**:
  [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
  and [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) as constraints
  (`IEntityDTOMapper.cs:43-45`), and [`Result<T>`](group-01-result-error-handling.md#result) as the
  return payload.
- **Concept (request-to-entity mapping with async validation).** `[Rubric §1, SOLID]`: separating
  create-mapping from read-mapping keeps each interface to one reason to change. `[Rubric §9, API &
  Contract Design]`: the `ICreateRequest` constraint tags a DTO as a create payload, so a read DTO
  cannot be passed down this path by accident. The `Task<Result<TEntity>>` signature is the load-bearing
  detail: creation frequently needs a database round trip (a uniqueness check) before the factory runs,
  and any failure surfaces as a `Result` error rather than an exception, exactly as the doc comment
  describes (`IEntityDTOMapper.cs:35-38`, `:47-50`).
- **Walkthrough**: one member, `CreateEntityAsync(TCreateRequest request, CancellationToken
  cancellationToken = default)` (`IEntityDTOMapper.cs:54`). Implementations call the entity's
  `Create(...)` factory and return its `Result` unchanged, so validation errors thread through without
  translation.
- **Why it's built this way**: the same
  [ADR-001](https://ivanball.github.io/docs/adr/001-manual-dto-mapping.html) rationale (explicit,
  compile-checked mapping), and co-locating it with the read mapper documents the expectation that a
  module supplies both directions per entity.
- **Where it's used**: implemented by the per-entity `*CreateRequestMapper` classes (for example
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sponsors/UseCases/Create/SponsorCreateRequestMapper.cs:12`
  and
  `.../Categories/UseCases/Create/ConferenceCategoryCreateRequestMapper.cs:12`) and injected into the
  matching create handlers (for example
  `MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Application/Tickets/UseCases/Create/CreateTicketHandler.cs:21`,
  the smallest worked example in the workspace).

### DatabaseInitializationExtensions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:21` · Level 8 · class (static, extension block)

- **What it is**: the shared startup routine that, per **physical data source** and then per **tenant
  database**, creates or migrates the schema and finally runs each enabled module's seeder.
- **Depends on**: [`IEntityDataSourceRegistry`](group-07-persistence-ef-core.md#ientitydatasourceregistry),
  [`IDataSourceResolver`](group-07-persistence-ef-core.md#idatasourceresolver),
  [`IDbContextFactory`](group-07-persistence-ef-core.md#idbcontextfactory),
  [`DataSourceKey`](group-07-persistence-ef-core.md#datasourcekey) and its
  [`DataSource`](group-07-persistence-ef-core.md#datasource) engine enum,
  [`TenantDataSourceTargets`](group-07-persistence-ef-core.md#tenantdatasourcetargets) /
  [`TenantDataSourceTarget`](group-07-persistence-ef-core.md#tenantdatasourcetarget),
  [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext),
  [`TenancySettings`](group-14-module-system-composition.md#tenancysettings),
  [`ApplicationSettings`](group-14-module-system-composition.md#applicationsettings) and
  [`ModuleLoader`](group-14-module-system-composition.md#moduleloader).
- **Concept (strategy-driven, per-source database initialization).** `[Rubric §8, Data Architecture]`
  and `[Rubric §17, DevOps & Deployment]`: because of database-per-service
  ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) every physical source a
  host touches is initialized independently, and the chosen strategy is the difference between a
  permissive development host and a production host that refuses to start against a stale schema.
- **Walkthrough**: `InitializeDatabaseAsync(applicationSettings, moduleLoader, cancellationToken)`
  (`DatabaseInitializationExtensions.cs:32`) is the whole public surface.
  - Null-guards all three inputs and opens a scope (`:37-41`).
  - **Warms the entity registry**: it resolves `IEntityDataSourceRegistry` and calls
    `GetPhysicalSourcesInUse()` (`:46-48`), which makes entity-to-database routing deterministic before
    the first repository call instead of a lazy model-building side effect (`:43-45`).
  - For every Cosmos or SQLite source in use that has a connection string, it always calls
    `EnsureCreatedAsync` (`:58-68`). Neither engine has EF migrations, and the comment (`:52-57`) flags
    that this is the **only** path that creates a SQLite source under the `Migrate` and `None`
    strategies, without which the first repository call against such a source fails.
  - `switch`es on `ApplicationSettings.DatabaseInitStrategy` (`:74-89`): `"Migrate"` applies pending EF
    migrations across the SQL sources (`:77`), `"EnsureCreated"` is the legacy path (`:80`), `"None"`
    calls `ThrowIfPendingMigrationsAsync` (`:83`), and anything else throws naming the three valid
    values (`:86-88`).
  - Runs the per-tenant pass, `InitializeTenantDatabasesAsync` (`:91`), then finally
    `moduleLoader.SeedAllAsync(...)` on the default scope only (`:98`). The comment (`:94-97`) explains
    why seeding is not repeated per tenant: no module declares which seeders are tenant-scoped, and
    running one twice against a shared database is worse than not running it per tenant.
  - `InitializeTenantDatabasesAsync` (`:112`) returns immediately when no
    [`TenancySettings`](group-14-module-system-composition.md#tenancysettings) is registered or no
    tenants are configured (`:118-122`), then, for each expanded tenant target (`:124-125`), opens a
    **fresh scope** and sets the tenant on [`ITenantContext`](group-05-cqrs-pipeline.md#itenantcontext)
    *before* asking for a context factory (`:127-131`). The remark (`:107-111`) is the reason: the
    scoped factory binds one physical database per source for the life of a scope, so reusing the outer
    scope would keep handing back the shared database. It then applies the same three-way strategy per
    tenant, migrating only SQL Server and falling back to `EnsureCreated` for other engines (`:133-157`).
  - `ThrowIfTenantPendingMigrationsAsync` (`:165`) and `ThrowIfPendingMigrationsAsync` (`:191`) are the
    production rails. The shared one short-circuits on
    `IDbContextFactory.HasPendingMigrationsAsync` (`:196-199`) and otherwise builds a per-source
    breakdown of exactly which migrations are behind before throwing (`:201-214`); the tenant one skips
    non-SQL-Server engines (`:170-173`) and throws naming the tenant target (`:181-184`).
- **Why it's built this way**: one shared init path keeps every downstream service consistent, and the
  `"None"` strategy is the deploy-time guarantee that an app never serves traffic against an un-migrated
  database when migrations are applied by the pipeline rather than the app. The tenant pass exists
  because nothing else ever opens a per-tenant database
  ([ADR-073](https://ivanball.github.io/docs/adr/073-multi-tenancy-model.html)), so without it such a
  database is never created and never migrated (`:102-105`).
- **Where it's used**: called from each service host's `Program.cs` after `app.Build()` and before the
  middleware pipeline is wired, for example
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:370` (pipeline at `:373`),
  `.../MMCA.ADC.Identity.Service/Program.cs:319`, `.../MMCA.ADC.Engagement.Service/Program.cs:325` and
  `.../MMCA.ADC.Notification.Service/Program.cs:255`. Its branches are covered by
  [`DatabaseInitializationExtensionsTests`](group-27-testing-infrastructure.md#databaseinitializationextensionstests).
- **Caveats / not-in-source**: which strategy a deployment runs is configuration, not code. ADC sets
  `Migrate` in production so each service migrates its own database at startup, which is a deployment
  decision recorded in `MMCA.ADC/CLAUDE.md`, not something this file can show.

### WebApplicationExtensions
> MMCA.Common.API · `MMCA.Common.API.Startup` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:16` · Level 10 · class (static, extension block)

- **What it is**: the `extension(WebApplication app)` type that defines the canonical middleware
  pipeline (`UseCommonMiddlewarePipeline`) plus the request-localization and culture-switch endpoints, so
  every downstream host wires middleware in exactly one order. It is the runtime-side sibling of
  [`WebApplicationBuilderExtensions`](#webapplicationbuilderextensions).
- **Depends on**: [`CorrelationIdMiddleware`](#correlationidmiddleware),
  [`TenantResolutionMiddleware`](#tenantresolutionmiddleware),
  [`SoftDeletedUserMiddleware`](#softdeletedusermiddleware),
  [`WebApplicationBuilderExtensions`](#webapplicationbuilderextensions) for the CORS policy names,
  [`JwksEndpointExtensions`](#jwksendpointextensions),
  [`OidcDiscoveryEndpointExtensions`](#oidcdiscoveryendpointextensions) and
  [`SupportedCultures`](#supportedcultures); ASP.NET forwarded-headers and localization primitives.
- **Concept (one canonical, ordered pipeline).** `[Rubric §10, Cross-Cutting Concerns]` and
  `[Rubric §13, Observability & Operability]`: middleware order is behavior, not taste. Correlation must
  be established before anything downstream logs, and authentication must run before the rate limiter so
  the per-user partition sees a principal at all. Centralizing the order means a host cannot get it
  wrong ([ADR-079](https://ivanball.github.io/docs/adr/079-shared-http-middleware-pipeline.html)).
  `[Rubric §27, i18n]` applies through the localization wiring
  ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)).
- **Walkthrough**
  - Two internal constants, `PreForwardedSchemeKey` (`WebApplicationExtensions.cs:24`) and
    `PreForwardedHostKey` (`:35`), name the `HttpContext.Items` slots that capture the transport scheme
    and host **before** `UseForwardedHeaders` rewrites them. The comment on the host key (`:26-34`)
    records why: Aspire/DCP injects an `X-Forwarded-Host` pointing at the canonical launchSettings URL,
    which internal callers cannot reach.
  - `UseCommonMiddlewarePipeline()` (`:45`) wires, in order: exception handler (`:47`), correlation-id
    middleware (`:48`), request localization (`:53`, so edge error localization runs under the caller's
    culture), forwarded-headers options with `KnownProxies`/`KnownIPNetworks` cleared for cloud reverse
    proxies (`:55-64`), the capture step storing the pre-forwarded scheme and host (`:72-77`),
    `UseForwardedHeaders` (`:79`), an HTTPS redirect wrapped in `UseWhen` that **skips
    `application/grpc`** so h2c gRPC calls are not 307-redirected (`:87-89`), response compression
    (`:91`), routing (`:92`), CORS choosing the development or production policy by environment
    (`:93-95`), authentication (`:96`), tenant resolution (`:102`), the rate limiter (`:108`), the
    soft-deleted-user middleware (`:109`), authorization (`:110`), output cache (`:111`), the
    always-mapped `MapJwksEndpoint()` / `MapOidcDiscoveryEndpoint()` pair (`:118-119`), and finally
    `MapControllers()` (`:121`). Two comments carry the ordering rationale: tenant resolution sits
    immediately after authentication because its claim strategy reads `HttpContext.User` (`:98-101`),
    and the rate limiter sits after authentication per
    [ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html) because otherwise every
    request looks anonymous and the per-user cap never engages (`:104-107`).
  - `UseCommonRequestLocalization()` (`:133`) builds the supported list from
    [`SupportedCultures`](#supportedcultures)`.All` (`:135`), appends the pseudo-locale in Development
    only (`:140-143`), and sets the default plus both supported and supported-UI culture lists
    (`:146-151`). Blazor UI hosts call it explicitly before `MapRazorComponents` so SSR prerender runs
    under the right culture (`:126-132`).
  - `MapCultureEndpoint()` (`:162`) maps the anonymous `GET /culture/set?culture=&redirectUri=` that the
    culture switcher calls. It honors only allowlisted cultures, and the pseudo-locale only in
    Development (`:166`, `:169`), writes the standard ASP.NET culture cookie as **non-HttpOnly** so the
    WASM client can read it (`:172-183`, with `Secure` conditional on the environment and both
    deviations justified inline at `:171`), then local-redirects (`:187-188`) to force a full reload.
- **Why it's built this way**: centralizing the order means a host cannot accidentally place rate
  limiting before authentication or forget forwarded-headers handling behind a cloud proxy. The JWKS and
  OIDC endpoints are mapped unconditionally so a non-Identity host degrades to an empty key set or a
  `404` rather than diverging in wiring (`:113-117`).
- **Where it's used**: called once per service host after `app.Build()`, for example
  `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:322`,
  `.../MMCA.ADC.Conference.Service/Program.cs:373`, `.../MMCA.ADC.Engagement.Service/Program.cs:328` and
  `.../MMCA.ADC.Notification.Service/Program.cs:258`. The Blazor web host instead calls the two
  localization members directly: `UseCommonRequestLocalization()` at
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:124` and `MapCultureEndpoint()` at `:160`.
- **Caveats / not-in-source**: a host that maps additional endpoints (SignalR hubs, minimal-API
  endpoints, app-association documents) does so after this call; the framework cannot enforce that
  ordering, it only documents it on the members that require it (for example
  [`SignalRExtensions`](#signalrextensions)`.MapNotificationHub`,
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/SignalRExtensions.cs:16-21`).

### IBaseDTO<TIdentifierType>
> MMCA.Common.Shared · `MMCA.Common.Shared.DTOs` · `MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/IBaseDTO.cs:9` · Level 0 · interface

- **What it is**: a one-property marker interface. Every DTO that carries an entity identifier exposes `TIdentifierType Id { get; init; }` (`MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/IBaseDTO.cs:13`).
- **Depends on**: nothing first-party, and nothing external beyond the generic constraint. It lives in `MMCA.Common.Shared`, the bottom layer, so a Blazor WebAssembly client and an EF-backed service can both reference it.
- **Concept introduced (the DTO and the marker/role interface).** `[Rubric §9, API & Contract Design]` (assesses DTOs decoupled from domain entities and stable wire contracts): a **DTO** (Data Transfer Object) is the shape that crosses the wire, deliberately separate from the domain entity. `IBaseDTO` lets generic machinery treat *any* DTO uniformly through its `Id`, which is what makes a single generic read service, a single generic controller base, and a single generic UI service possible instead of one hand-written trio per entity. This is also `[Rubric §1, SOLID]`: a textbook **Interface Segregation** interface, with one member (the only thing a generic consumer needs), so clients never depend on more than they use.
- **Walkthrough**: generic over `TIdentifierType` with a `where TIdentifierType : notnull` constraint (`IBaseDTO.cs:10`); the single `Id` is `get; init;` (`IBaseDTO.cs:13`), settable at construction and immutable after. The `init`-not-`set` choice recurs across these contracts (see the primer on [immutability with `required`/`init`](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Why it's built this way**: making the identifier type a generic parameter, rather than hard-coding `int`, lets a DTO match its entity's strongly-typed id alias (see [identifier aliases](00-primer.md#2-architectural-styles-this-codebase-commits-to)), so a `Guid`-keyed aggregate and an `int`-keyed one share the same generic pipeline; the `notnull` constraint forbids `Id` being a nullable type, which keeps the generic code free of null checks on the one value it always needs.
- **Where it's used**: it is the constraint on every generic read/write pipeline in the framework, each declaring the same `where TEntityDTO : IBaseDTO<TIdentifierType>` line: [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityQueryService.cs:21`) and its implementation `EntityQueryService` (`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:39`), [`IEntityDTOMapper<TEntity, TEntityDTO, TIdentifierType>`](#ientitydtomappertentity-tentitydto-tidentifiertype) (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityDTOMapper.cs:16`), the controller hierarchy ([`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype) at `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:42`, plus `IEntityControllerBase.cs:17`, `AggregateRootEntityControllerBase.cs:41`, and `IAggregateRootEntityControllerBase.cs:20` in the same folder), and the UI's [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype) (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IEntityService.cs:13`) with its base `EntityServiceBase` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:29`). Implemented directly by [`BaseLookup<TIdentifierType>`](#baselookuptidentifiertype) and by shipped DTOs such as [`PushNotificationDTO`](group-10-notifications.md#pushnotificationdto) (`MMCA.Common/Source/Core/MMCA.Common.Shared/Notifications/PushNotifications/PushNotificationDTO.cs:8`), plus every module DTO in ADC, Store, and Helpdesk. The architecture-rules package even identifies a DTO by this interface name when enforcing entity/DTO rules (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Entities.cs:173`).

### IConcurrencyAware
> MMCA.Common.Shared · `MMCA.Common.Shared.DTOs` · `MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/IConcurrencyAware.cs:13` · Level 0 · interface

- **What it is**: a contract for DTOs and update requests that round-trip an **optimistic-concurrency token** (`byte[]? RowVersion`).
- **Depends on**: nothing first-party. It is the wire-side half of a pair whose persistence-side half is [`IWriteRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#iwriterepositorytentity-tidentifiertype)`.SetOriginalRowVersion` (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:197`).
- **Concept introduced (optimistic concurrency).** `[Rubric §8, Data Architecture]` (assesses deliberate persistence: transactions, migrations, soft-delete, audit, and **concurrency control**). SQL Server's `rowversion` is a token the database changes on every update of a row. A read DTO exposes the current `RowVersion` so the client can echo it back on the next update; an update request carries the client's last-seen value so the persistence layer can detect a conflicting concurrent edit and return `409 Conflict` instead of silently overwriting. The doc comment (`IConcurrencyAware.cs:9-12`) spells out exactly the failure mode being prevented: without the round-trip an update loads the row fresh and saves it, so two concurrent editors overwrite each other (last-write-wins) and the mapped `409` never fires.
- **Walkthrough**: one property, `byte[]? RowVersion { get; init; }` (`IConcurrencyAware.cs:20`). It is nullable so that creation and legacy clients (which send nothing) **skip** the conflict check; the enforcement end honors the same rule, since `EFRepository.SetOriginalRowVersion` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFRepository.cs:75`) returns early on `rowVersion is not { Length: > 0 }` (`EFRepository.cs:78`) and otherwise writes the client's bytes into EF's `OriginalValue` for the tracked entity's `RowVersion` property (`EFRepository.cs:83`). Note the `[SuppressMessage("Performance", "CA1819")]` on `IConcurrencyAware.cs:19`: exposing a `byte[]` property normally trips the "properties should not return arrays" analyzer rule, but it is required to round-trip the EF token, and the suppression is *justified inline* (`[Rubric §15, Best Practices]`: suppressions are tracked and explained, not blanket-disabled).
- **Why it's built this way**: concurrency control is opt-in per DTO through this interface ([ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html)), so only contended resources pay the extra wire bytes and the client-side echo discipline. Keeping the contract in `Shared` means the same interface is visible to the Blazor client that must echo the token and to the Infrastructure repository that consumes it.
- **Where it's used**: implemented by [`ConcurrencyTokenRequest`](#concurrencytokenrequest) in the framework, and by module-local shapes in the apps: ADC's `LifecycleTransitionRequest` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/LifecycleTransitionRequest.cs:15`) and `EventTransitionRequest` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/EventTransitionRequest.cs:14`), Store's `OrderTransitionRequest` (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Shared/Orders/OrderTransitionRequest.cs:13`), and Helpdesk's `TicketUpdateRequest` (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Shared/Tickets/TicketUpdateRequest.cs:12`). Read DTOs implement it too so the token can be handed out in the first place: Store's `OrderDTO` (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Shared/Orders/OrderDTO.cs:9`) and Helpdesk's `TicketDTO` (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Shared/Tickets/TicketDTO.cs:9`) both declare `IBaseDTO<...>, IConcurrencyAware`. There is a second, child-level enforcement overload that takes any [`IRowVersioned`](group-02-domain-building-blocks.md#irowversioned) entity (`IRepository.cs:209`, implemented at `EFRepository.cs:87-95`), so a child edit under an aggregate root gets the same protection.

### SupportedCultures
> MMCA.Common.Shared · `MMCA.Common.Shared.Globalization` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Globalization/SupportedCultures.cs:9` · Level 0 · class (static)

- **What it is**: the framework-wide allowlist of supported UI cultures ([ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html)). A static class holding the default culture, the full supported set, the Development-only pseudo-localization locale, a closest-match resolver, and two membership tests.
- **Depends on**: nothing first-party. Uses only BCL types (`IReadOnlyList<string>`, `StringComparison`).
- **Concept introduced (internationalization allowlist as one source of truth).** `[Rubric §27, i18n]` (assesses whether locale support is centralized, discoverable, and drift-resistant rather than scattered string checks). Every consumer that decides "is this a language we support" reads this one list: the host request-localization setup, the culture switcher, the MAUI head's culture resolution, and the domain guard on a user's preferred culture. Adding a locale means adding a `.<culture>.resx` sibling set plus one entry here, with no other infrastructure change (`SupportedCultures.cs:3-8`).
- **Walkthrough**
  - `Default = "en-US"` (`SupportedCultures.cs:12`) is the fallback used when no cookie, profile, or `Accept-Language` preference resolves.
  - `All` (`SupportedCultures.cs:18`) is the supported set, default first, and today it is exactly `[Default, "es"]`: English and Spanish. Both the request-localization options and the culture switcher iterate it.
  - `PseudoLocale = "qps-Ploc"` (`SupportedCultures.cs:28`) is the Windows-standard pseudo-localization locale, deliberately **not** part of `All` so the translation-completeness fitness gate does not demand a `.qps-Ploc.resx` sibling. It is wired into request localization and the culture switcher in **Development only**, where it runtime-transforms every resolved resource string (accents, padding, bracket sentinel) to surface hard-coded strings, truncation, and string concatenation without translating anything.
  - `IsSupported(string?)` (`SupportedCultures.cs:35`) returns true for a non-empty culture matched case-insensitively against `All`; `IsPseudoLocale(string?)` (`SupportedCultures.cs:76`) tests case-insensitively against `PseudoLocale`. Both take a nullable string so callers can pass an unvalidated cookie, query value, or profile field straight in.
  - `ResolveClosest(string?)` (`SupportedCultures.cs:51`) is the fallback ladder: blank returns `Default` (`:53-56`), an exact case-insensitive `All` match wins (`:58-62`), otherwise the language subtag is matched, so `"es-MX"` resolves to `"es"` (`:64-66`), and anything left over falls to `Default` (`:68`). The subtag split is done by the private `LanguageOf` (`:83-87`), which returns the input unchanged when there is no `-`, avoiding an allocation for an already-neutral culture. Because `PseudoLocale` is not in `All`, this method can never return it.
- **Why it's built this way**: a single `const` plus `IReadOnlyList` allowlist keeps the localization middleware, the switcher UI, the fitness gate, and the domain guard from drifting apart; separating `PseudoLocale` from `All` lets a diagnostic locale ship in Development without polluting the production culture set or the resx-completeness gate. `ResolveClosest` exists because web heads get language-level fallback for free from request localization's `Accept-Language` matching, while a head with no request pipeline (the MAUI Blazor Hybrid, which resolves against the device locale) has to do it itself, and the doc comment (`SupportedCultures.cs:43-48`) says explicitly that the point is to keep the two paths from diverging. See [ADR-027](https://ivanball.github.io/docs/adr/027-multi-locale-i18n.html) for the culture-resolution and pseudo-localization decision.
- **Where it's used**: [`WebApplicationExtensions`](#webapplicationextensions)`.UseCommonRequestLocalization` builds the supported list from `All` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:135`), appends `PseudoLocale` only outside Production (`:142`), and sets `Default` as the default culture (`:147`); the culture-switch endpoint validates the incoming value with `IsSupported`/`IsPseudoLocale` (`:169`). The `CultureSwitcher` component builds its option list the same way (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/CultureSwitcher.razor:26-27`), [`MmcaCultureBootstrap`](group-15-common-ui-framework.md#mmcaculturebootstrap) falls back to `Default` when the stored culture is not supported (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/MmcaCultureBootstrap.cs:30`), and [`PseudoStringLocalizer`](group-15-common-ui-framework.md#pseudostringlocalizer) activates only under `IsPseudoLocale` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/PseudoStringLocalizer.cs:17`). On the device head, [`MauiCultureStore`](group-26-device-capability-layer.md#mauiculturestore)`.Resolve` prefers the stored choice and otherwise calls `ResolveClosest` on the device locale (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Globalization/MauiCultureStore.cs:41-43`), and [`MauiCultureApplier`](group-26-device-capability-layer.md#mauicultureapplier) refuses an unsupported culture outright (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Maui/Globalization/MauiCultureApplier.cs:32`). The domain guard is [`CommonInvariants`](group-02-domain-building-blocks.md#commoninvariants)`.EnsurePreferredCultureIsValid`, which allows `null` or an `IsSupported` culture (`MMCA.Common/Source/Core/MMCA.Common.Domain/Invariants/CommonInvariants.cs:141-145`); both apps' `UserInvariants` delegate to it (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/UserInvariants.cs:76-79`, `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/UserInvariants.cs:62-63`). The fitness gate [`LocalizationResourceTests`](group-27-testing-infrastructure.md#localizationresourcetests) derives its required-culture set from `All` minus `Default` (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/LocalizationResourceTests.cs:14-17`), so adding a culture here automatically extends the coverage requirement, and [`SupportedCulturesTests`](group-27-testing-infrastructure.md#supportedculturestests) pins the `ResolveClosest` ladder (`MMCA.Common/Tests/Core/MMCA.Common.Shared.Tests/Globalization/SupportedCulturesTests.cs:19-44`).

### BaseLookup<TIdentifierType>
> MMCA.Common.Shared · `MMCA.Common.Shared.DTOs` · `MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/BaseLookup.cs:8` · Level 1 · record class

- **What it is**: a minimal DTO for dropdown and autocomplete lookups: just `Id` and `Name`.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](#ibasedtotidentifiertype) (Level 0), which it implements.
- **Concept (right-sized response shapes).** `[Rubric §9, API & Contract Design]` (assesses whether responses are shaped to their consumer rather than dumping full entities). Instead of returning a full entity DTO to populate a `<select>` element, the system returns `BaseLookup<T>`, carrying only the id and the display name; this cuts wire size and avoids coupling the UI to full entity shapes it does not need. Both `Id` (`BaseLookup.cs:12`) and `Name` (`BaseLookup.cs:15`) are `required`, so hand-written construction is compile-checked, and record equality gives value semantics for free (see [record value objects](group-02-domain-building-blocks.md#currency)).
- **Walkthrough**: the type itself is four lines, but its interesting half lives in the repository that projects into it. [`EFReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#efreadrepositorytentity-tidentifiertype)`.GetAllForLookupAsync` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:86`) takes the *name* of the display property, resolves a cached projection expression (`:97`), and lets the database do the shaping: `.Select(selector).OrderBy(l => l.Name)` (`:99-101`). The selector is built once per `(entity type, property name)` pair into a `ConcurrentDictionary` (`:111`, `:116-138`), binding `Id` and the named property into a `BaseLookup<TIdentifierType>` via `Expression.MemberInit` (`:132-135`); a `string` display property is coalesced to empty and anything else gets a `ToString()` call (`:125-129`). Note the consequence for `required`: an expression-tree `MemberInit` constructs the record without the compiler's required-member check, which is legal because `required` is a compile-time contract, not a runtime one. Above the repository the shape travels as a [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt) through [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype)`.GetAllForLookupAsync` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:350-354`).
- **Why it's built this way**: one shared lookup shape means the UI's generic select components bind to a single type regardless of which entity fills them, and projecting inside the SQL query (rather than materializing entities and mapping) keeps a lookup list cheap `[Rubric §12, Performance & Scalability]`; caching the compiled expression per property name keeps the reflection cost to the first call.
- **Where it's used**: returned by the lookup path at every layer: `IEntityQuerier<TEntity, TIdentifierType>.GetAllForLookupAsync` (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:111`, on the focused collection-query interface declared at `IRepository.cs:78`), [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype)`.GetAllForLookupAsync` (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityQueryService.cs:87`), the controller base (`EntityControllerBase.cs:350`), and the UI's [`IEntityService<TEntityDTO, TIdentifierType>`](group-15-common-ui-framework.md#ientityservicetentitydto-tidentifiertype) (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IEntityService.cs:33`), whose base deserializes it back out of the HTTP response (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/EntityServiceBase.cs:92`).

### ConcurrencyTokenRequest
> MMCA.Common.Shared · `MMCA.Common.Shared.DTOs` · `MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/ConcurrencyTokenRequest.cs:12` · Level 1 · record class (sealed)

- **What it is**: the reusable request body for lifecycle and state-transition endpoints (publish, cancel, open, approve, and so on) whose *only* payload is the optimistic-concurrency token.
- **Depends on**: [`IConcurrencyAware`](#iconcurrencyaware) (Level 0), which it implements and from which `RowVersion` is inherited via `<inheritdoc />` (`ConcurrencyTokenRequest.cs:14-15`).
- **Concept (the token-only request body).** This is the same optimistic-concurrency idea introduced by [`IConcurrencyAware`](#iconcurrencyaware), narrowed to the case where a state transition carries no other data. `[Rubric §9, API & Contract Design]`: rather than each module inventing its own single-property transition record, one shipped shape covers every such endpoint. The doc comment (`ConcurrencyTokenRequest.cs:3-11`) also pins the binding contract: bind it as an **optional** body (ASP.NET Core `EmptyBodyBehavior.Allow`) so body-less legacy callers keep working and simply skip the stale-view check, and a null `RowVersion` skips it too.
- **Walkthrough**: the entire type is `public sealed record class ConcurrencyTokenRequest : IConcurrencyAware` (`ConcurrencyTokenRequest.cs:12`) with one `byte[]? RowVersion { get; init; }` (`:15`). Sealed because there is nothing to specialize; a record because value equality and the `with` expression cost nothing here and match the rest of the DTO family.
- **Why it's built this way**: [ADR-035](https://ivanball.github.io/docs/adr/035-optimistic-concurrency.html) decided that a transition decided against a stale view of the aggregate must surface as `409 Conflict` rather than applying silently (two moderators racing approve-versus-dismiss, two speakers racing open-versus-close). Making the body optional rather than required is the compatibility hinge: the endpoint's protection is additive, so an old client that posts nothing still transitions, protected only by the domain state machine on the freshly loaded aggregate.
- **Where it's used**: **no consumer binds it today.** ADC still declares its own structurally identical copies, `LifecycleTransitionRequest` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/LifecycleTransitionRequest.cs:15`) and `EventTransitionRequest` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/EventTransitionRequest.cs:14`), each carrying a comment that it is "superseded by MMCA.Common's `ConcurrencyTokenRequest` at the next framework sweep" (`LifecycleTransitionRequest.cs:13`, `EventTransitionRequest.cs:12`), and Store keeps its own `OrderTransitionRequest` (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Shared/Orders/OrderTransitionRequest.cs:13`). This is the framework offering the shape ahead of the consumers adopting it.
- **Caveats / not-in-source**: the `EmptyBodyBehavior.Allow` binding is a documented instruction to callers (`ConcurrencyTokenRequest.cs:8`), not something this type can enforce; whether a given endpoint actually binds it optionally is determined at that endpoint's action signature, in the consuming app.

### CorrelationContext
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/CorrelationContext.cs:9` · Level 1 · class (sealed)

- **What it is**: the scoped service that holds the correlation ID for the current request, defaulting to a fresh GUID when no middleware sets one.
- **Depends on**: [`ICorrelationContext`](#icorrelationcontext) (Level 0, `MMCA.Common.Application.Interfaces`), the abstraction it implements (`CorrelationContext.cs:1`, `:9`). Uses BCL `Guid` only.
- **Concept introduced (request correlation for observability).** `[Rubric §13, Observability & Operability]` (assesses whether requests can be traced end to end through logs and across service boundaries). A **correlation ID** is a single value stamped on every log line and propagated call for one logical request, so operators can reassemble a distributed trace from disjoint logs. `[Rubric §3, Clean Architecture]` also applies: the abstraction lives in Application so handlers and decorators depend on the interface, while the concrete holder sits in Infrastructure, keeping the dependency arrow pointing inward.
- **Walkthrough**: `CorrelationId` (`CorrelationContext.cs:12`) is `{ get; private set; }`, initialized eagerly to `Guid.NewGuid().ToString("N")` so a value always exists even if no middleware runs (a background processor, a test path, a gRPC call). `SetCorrelationId(string)` (`CorrelationContext.cs:15-19`) overwrites it, guarding the input with `ArgumentException.ThrowIfNullOrWhiteSpace` (`:17`) so a blank header can never wipe the ID. The private setter means the only write path is that one guarded method. Registration is `services.TryAddScoped<ICorrelationContext, CorrelationContext>()` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:446`): scoped, so one instance lives per request, and `TryAdd`, so a host that wants its own implementation can register it first and win.
- **Why it's built this way**: a scoped holder with an eager default keeps correlation always-on and cheap: every code path has an ID without a null check, and inbound requests still adopt the caller's ID for cross-service tracing. The `"N"` GUID format (32 hex digits, no hyphens) keeps the value compact in log lines and headers.
- **Where it's used**: [`CorrelationIdMiddleware`](#correlationidmiddleware) resolves it per request and calls `SetCorrelationId` with the inbound `X-Correlation-ID` header, falling back to the current `Activity` trace ID and then to `HttpContext.TraceIdentifier` (`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/CorrelationIdMiddleware.cs:32-36`), then echoes the value back on the response through `OnStarting` (`:37-41`). Downstream, [`LoggingCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#loggingcommanddecoratortcommand-tresult) (`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Decorators/LoggingCommandDecorator.cs:16`) and [`LoggingQueryDecorator<TQuery, TResult>`](group-05-cqrs-pipeline.md#loggingquerydecoratortquery-tresult) (`.../LoggingQueryDecorator.cs:15`) take it as a constructor dependency and wrap the ID into their log scope for the full pipeline duration.

### CurrencyJsonConverter
> MMCA.Common.API · `MMCA.Common.API.JsonConverters` · `MMCA.Common/Source/Presentation/MMCA.Common.API/JsonConverters/CurrencyJsonConverter.cs:12` · Level 4 · class (sealed)

- **What it is**: a `System.Text.Json.JsonConverter<Currency>` that serializes [`Currency`](group-02-domain-building-blocks.md#currency) as its ISO 4217 three-letter code string and deserializes by validating that code through `Currency.FromCode`.
- **Depends on**: [`Currency`](group-02-domain-building-blocks.md#currency) (`MMCA.Common.Shared.ValueObjects`, `CurrencyJsonConverter.cs:3`). Extends BCL `JsonConverter<T>` (`CurrencyJsonConverter.cs:12`).
- **Concept (value objects serialize to their natural string form).** `[Rubric §9, API & Contract Design]` (assesses whether the wire contract exposes clean primitives rather than leaking internal object graphs). A domain value object should cross the wire as the compact primitive a client expects (`"USD"`), not as a nested object with a `code` property. The converter is also a validation gate at the boundary: malformed input is rejected before model binding completes, so no handler ever sees an invalid currency.
- **Walkthrough**
  - `Read` (`CurrencyJsonConverter.cs:15`) first rejects any non-string token, throwing `JsonException("Currency must be a string.")` (`:17-18`), which is what stops a JSON number or object from being coerced.
  - It then reads the string, coalescing null to empty (`:20`), runs `Currency.FromCode(code)` (`:21`), and throws `JsonException($"Invalid currency code: {code}")` when the result is a failure (`:22-23`) before returning `result.Value!` (`:25`). Because `FromCode` returns a [`Result`](group-01-result-error-handling.md#result), the converter is bridging the Result world into the exception-based contract `JsonConverter<T>` requires; the thrown `JsonException` surfaces as a `400 Bad Request` from the framework's model binding (doc comment, `:9-10`).
  - `Write` (`CurrencyJsonConverter.cs:29-30`) is a one-liner: `writer.WriteStringValue(value.Code)`.
  - The type is sealed, holds no state, and has exactly these two methods (`[Rubric §15, Best Practices]`: the framework-idiomatic converter pattern).
- **Why it's built this way**: routing (de)serialization through `Currency.FromCode` keeps the single validation gate for currency codes in the value object itself (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Currency.cs:41`, which matches case-insensitively against the closed `All` set), so the API layer neither duplicates the allowlist nor accepts a `Currency` the domain would reject.
- **Where it's used**: registered globally for MVC in [`DependencyInjection`](#dependencyinjection)`.AddAPI`, which chains `.AddJsonOptions(options => options.JsonSerializerOptions.Converters.Add(new CurrencyJsonConverter()))` onto `AddControllers` (`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:51-53`), so every controller request and response serializes `Currency` as a string uniformly.
- **Caveats / not-in-source**: there is a **second, same-named converter** in the Shared layer, [`CurrencyJsonConverter`](group-02-domain-building-blocks.md#currencyjsonconverter) (`MMCA.Common/Source/Core/MMCA.Common.Shared/ValueObjects/Currency.cs:73`), attached to the value object by `[JsonConverter(typeof(CurrencyJsonConverter))]` (`Currency.cs:13`) so that non-MVC paths (cache, outbox, integration events, typed `HttpClient` calls) also get string form. The two now behave the same way on input: the Shared one also rejects a non-string token (`Currency.cs:78-79`) and an unknown code (`:84-85`), differing only in the exception text and in returning a nullable `Currency?` whose null handling is left to `JsonConverter<T>.HandleNull` staying at its default of `false`, documented at `Currency.cs:69-71`. Which of the two wins for a given payload is a `System.Text.Json` converter-precedence question (an options-registered converter versus a type-level attribute) and is not determinable from this source alone; since their input rules match, the answer no longer changes what is accepted.

### DataExportControllerBase<TQuery>
> MMCA.Common.API · `MMCA.Common.API.Controllers.Privacy` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/Privacy/DataExportControllerBase.cs:60` · Level 10 · class (abstract)

- **What it is**: the shipped base controller for the data-subject export endpoint (`GET {route}/{userId}/export`, the GDPR/CCPA access and portability request). A subclass supplies its app's query type and a route; the base owns the action, the authorization posture, the feature gate, and the file-download delivery.
- **Depends on**: [`ApiControllerBase`](#apicontrollerbase) (its base, for `HandleFailure` at `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:25`), [`IQueryHandler<in TQuery, TResult>`](group-05-cqrs-pipeline.md#iqueryhandlerin-tquery-tresult) closed over [`UserDataExportDTO`](group-08-auth.md#userdataexportdto), [`ICurrentUserService`](group-08-auth.md#icurrentuserservice), [`Result`](group-01-result-error-handling.md#result) / [`Error`](group-01-result-error-handling.md#error), [`AuthorizationPolicies`](group-08-auth.md#authorizationpolicies), [`PrivacyFeatures`](group-08-auth.md#privacyfeatures), and the constraint [`IUserOwnedRequest`](group-14-module-system-composition.md#iuserownedrequest) on `TQuery` (`DataExportControllerBase.cs:60-63`). Externals: ASP.NET Core MVC, `System.Text.Json`, and `Microsoft.FeatureManagement.Mvc`'s `[FeatureGate]`.
- **Concept (a privacy endpoint shipped as a base class, not a registered controller).** `[Rubric §30, Compliance/Privacy/Data Governance]` (assesses whether legal obligations such as subject access, portability, and erasure are first-class code rather than manual operations): the access/portability half of a DSAR is framework code here, so an app gets it by subclassing rather than by re-implementing the dispatch, the ownership posture, and the delivery format. `[Rubric §11, Security]` shows up as **defence in depth**: the class-level `[Authorize(Policy = AuthorizationPolicies.RequireAuthenticated)]` (`:58`) demands an authenticated caller, while the handler independently enforces owner-or-privileged-role, so the endpoint cannot leak another subject's data even if a subclass is mounted without its own `[Authorize]` (`:50-55`). `[Rubric §10, Cross-Cutting Concerns]` covers the `[FeatureGate(PrivacyFeatures.DataExport)]` (`:59`): the whole surface stays off, answered by [`DisabledFeatureHandler`](#disabledfeaturehandler)'s 404, until a host deliberately turns the flag on.
- **Walkthrough**
  - The primary constructor takes the app's query handler and [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) (`:60-62`); the latter is re-exposed as the protected `CurrentUserService` property (`:69`) so a subclass can reuse it. `ExportContentType = "application/json"` (`:66`) is the one media type the package is served as.
  - `ExportAsync(UserIdentifierType userId, CancellationToken)` (`:83-85`) is routed by the action-level `[HttpGet("{userId}/export")]` (`:78`) only: the route prefix lives on the subclass, so a controller routed at `Users` serves the same `/Users/{userId}/export` path the hand-written controllers already expose (`:39-43`). The declared responses are 200 with a `UserDataExportDTO`, plus 401/403/404 as `ProblemDetails` (`:79-82`).
  - It reads `CurrentUserService.UserId` first and, when there is none, short-circuits through `HandleFailure` with `Error.Unauthorized("Privacy.Unauthorized", ...)` (`:87-91`), so even the unauthenticated case comes back as RFC 9457 Problem Details rather than a bare status.
  - It then builds the app's query through the abstract `CreateQuery(userId, currentUserId, CurrentUserService.Role)` factory (`:93`, declared at `:120-123`), awaits the handler (`:94-95`), and maps a failed [`Result`](group-01-result-error-handling.md#result) through `HandleFailure(result.Errors)` (`:97-100`), which is what turns the handler's own ownership refusal into a 403.
  - On success it serializes the package itself with `JsonSerializer.SerializeToUtf8Bytes(export, JsonSerializerOptions.Web)` (`:108`) and returns `File(payload, ExportContentType, BuildFileName(...))` (`:110`). The inline comment (`:104-107`) is explicit about why: `Ok(export)` would content-negotiate and render inline, and this document exists to be saved, while `JsonSerializerOptions.Web` keeps the payload byte-shape identical to every other response the API produces.
  - `BuildFileName` (`:134-135`) composes `user-data-{userId}-{yyyyMMdd}.json` with `CultureInfo.InvariantCulture`, taking the date from the package's own `UserDataExportDTO.GeneratedOn` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:26`) so the file name and the document always agree, and so a saved file sorts and parses the same in every locale.
- **Why it's built this way**: [ADR-076](https://ivanball.github.io/docs/adr/076-data-subject-export.html) hoists the export idiom that ADC and Store each wrote by hand. It ships as an **abstract base with a `CreateQuery` factory** rather than as a concrete controller added through an application part because the query type is app-owned (each app's `ExportUserDataQuery` lives in its own Application assembly), and a concrete controller could not construct a type it cannot see (`DataExportControllerBase.cs:44-49`). The route staying on the subclass follows the `AuthControllerBase` precedent: the app owns its URL space (`:39-43`).
- **Where it's used**: **no shipped app derives from it today.** ADC's `UsersController` still owns a standalone export action at the same path (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/UsersController.cs:149-168`), which reimplements the dispatch and returns `Ok(result.Value)` (`:167`), so it renders inline with no `Content-Disposition` and carries no `[FeatureGate]`; ADR-076 records that Store's is the same shape. The only subclass in source is the test double `TestDataExportController` (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/Controllers/Privacy/DataExportControllerBaseTests.cs:271`), which [`DataExportControllerBaseTests`](group-27-testing-infrastructure.md#dataexportcontrollerbasetests) drives to pin the four behaviors that differ from the hand-written controllers: the unauthenticated `ProblemDetails` 401 (`:38-49`), the failure-to-403 mapping (`:52-72`), the `FileContentResult` with the dated file name `user-data-7-20260813.json` (`:75-87`), and the attribute posture (`:134-139` for the policy, `:141-150` for the feature gate, `:156-169` for the disabled-flag 404).
- **Caveats / not-in-source**: because no app subclasses it, the download delivery, the `Content-Disposition` file name, and the `[FeatureGate]` 404 posture are framework behavior that no deployed endpoint currently exhibits; they are verified only by the unit tests above.


---
[⬅ Navigation Metadata & Populators (EF-decoupled eager loading)](group-11-navigation-populators.md)  •  [Index](00-index.md)  •  [gRPC & Inter-Service Contracts ➡](group-13-grpc-contracts.md)
