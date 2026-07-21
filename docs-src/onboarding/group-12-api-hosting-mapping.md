# 12. API Hosting, Middleware, Idempotency & DTO/Contract Mapping

**What this group covers.** This is the ASP.NET Core edge of the framework: the layer that turns
an HTTP request into a domain call and a [`Result`](group-01-result-error-handling.md#result) back
into an HTTP response. Everything here lives in `MMCA.Common.API` (with two collaborators in
`MMCA.Common.Application` and `MMCA.Common.Infrastructure` for the transport-agnostic contracts),
the presentation layer that sits above Infrastructure in the dependency flow (see
[primer §1](00-primer.md#1-the-big-picture)). The group has five interlocking concerns: the
**composition root** that registers and orders the whole edge; the **middleware pipeline** every
request flows through; the **exception-and-error translation** that keeps responses shaped like RFC
9457 Problem Details; the **controller hierarchy** that gives modules ready-made CRUD, auth, and
service-discovery endpoints; and the **contract surface** (DTO/request mapping, JSON conversion,
model binding, idempotency, correlation, feature gating) that a module reuses instead of
re-implementing. Read this group as the reusable ASP.NET host a downstream service (Store, ADC,
Helpdesk, or an extracted microservice) drops into place so its own code is nothing but modules. Its
central rubric column is [Rubric §9, API & Contract Design] (consistent, versioned, standardized
contracts and error shapes), with heavy supporting roles for [Rubric §10, Cross-Cutting Concerns],
[Rubric §11, Security], [Rubric §13, Observability & Operability], [Rubric §7, Microservices
Readiness], and (since ADR-027) [Rubric §27, Internationalization].

**The composition root: `AddAPI` plus the builder extensions.** A host wires the edge through two
static extension classes. [`DependencyInjection`](#dependencyinjection)'s `AddAPI`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/DependencyInjection.cs:42`) registers MVC
controllers, adds the global [`UnhandledResultFailureFilter`](#unhandledresultfailurefilter) and the
scoped [`IdempotencyFilter`](#idempotencyfilter), wires the
[`CurrencyJsonConverter`](#currencyjsonconverter) into the JSON options, optionally installs the
[`ModuleControllerFeatureProvider`](#modulecontrollerfeatureprovider) to hide disabled-module
controllers, binds `IdempotencySettings`, turns on feature management with the
[`DisabledFeatureHandler`](#disabledfeaturehandler), and registers the edge error-localization seam
(ADR-027, `DependencyInjection.cs:77`). [`WebApplicationBuilderExtensions`](#webapplicationbuilderextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:23`)
carries the identical builder-side setup every service shares: header-based API versioning
(`AddCommonApiVersioning`, line 76), rate limiting (`AddCommonRateLimiting`, line 108), Brotli/Gzip
compression (line 141), OpenAPI (line 166), CORS (line 300), and the two JWT bearer registrations
(in-process `AddCommonAuthentication` at line 257 for the Identity host, and `AddForwardedJwtBearer`
at line 187 for extracted services that validate against a remote JWKS). The one load-bearing
ordering rule (`AddApplicationDecorators()` must run last so Scrutor can decorate already-registered
handlers) lives one layer down in the CQRS pipeline group; the API registrations themselves are
order-independent. This is the [Rubric §9, API & Contract Design] and [Rubric §10, Cross-Cutting]
story: versioning, compression, rate limiting, and CORS are configured once and inherited by every
service rather than copy-pasted per host.

**The request pipeline, in a fixed order.**
[`WebApplicationExtensions`](#webapplicationextensions)'s `UseCommonMiddlewarePipeline`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationExtensions.cs:45`) is the
single place the middleware order is decided, and the order is deliberate: exception handling →
[`CorrelationIdMiddleware`](#correlationidmiddleware) → request localization → forwarded headers →
conditional HTTPS redirect → response compression → routing → CORS → authentication → rate limiter →
[`SoftDeletedUserMiddleware`](#softdeletedusermiddleware) → authorization → output cache → JWKS/OIDC
endpoints → controllers. Two of those positions are worth internalizing. The rate limiter runs
**after** authentication on purpose (ADR-019, `WebApplicationExtensions.cs:97`): the global limiter
partitions by the authenticated principal and routes anonymous traffic down a no-limiter branch, so
`HttpContext.User` must already be populated or every request would look anonymous and the per-user
cap would never engage. And the HTTPS redirect is skipped for `application/grpc` traffic
(`WebApplicationExtensions.cs:87`) because extracted gRPC services speak HTTP/2 cleartext (h2c) and a
307 redirect would break the call. The forwarded-headers handling also captures the pre-forward
scheme and host (lines 72-77) so the OIDC discovery document advertises a `jwks_uri` the original
caller can actually reach. `UseCommonRequestLocalization` (line 126) sets the request culture from
the query string, culture cookie, then `Accept-Language`, so the edge error localization runs under
the caller's culture (ADR-027).

**Correlation and the soft-deleted-user gate.**
[`CorrelationIdMiddleware`](#correlationidmiddleware)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/CorrelationIdMiddleware.cs:15`) reads
the `X-Correlation-ID` request header, falling back to the current W3C trace id or ASP.NET's
`TraceIdentifier`, writes it onto the scoped [`ICorrelationContext`](#icorrelationcontext)
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/ICorrelationContext.cs:8`, implemented
by [`CorrelationContext`](#correlationcontext)), and echoes it back on the response
(`CorrelationIdMiddleware.cs:37`). That single id is what the CQRS logging decorator stamps onto
every log scope, so one request is traceable end to end. [`SoftDeletedUserMiddleware`](#softdeletedusermiddleware)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:15`)
enforces business rule BR-133: an authenticated user whose account was soft-deleted is rejected with
401, checked against a 30-second cache to keep the per-request lookup cheap. It resolves its
validator lazily (line 53) so a service that does not host Identity simply no-ops instead of 500-ing
every request, an explicit nod to the [Rubric §7, Microservices Readiness] extraction path. Both are
[Rubric §13, Observability & Operability] (correlation) and [Rubric §11, Security] (deleted-account
lockout) concerns handled once at the edge.

**Errors become Problem Details, two ways.** Failures reach the client through two channels that
share one translation table. Thrown exceptions are caught by the handler chain registered in
`AddCommonExceptionHandlers` (`DependencyInjection.cs:116`), evaluated most-specific-first:
`OperationCanceledExceptionHandler`, [`DomainExceptionHandler`](#domainexceptionhandler)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/DomainExceptionHandler.cs:16`),
`DbUpdateExceptionHandler`, `ValidationExceptionHandler`, and finally
[`GlobalExceptionHandler`](#globalexceptionhandler) as the 500 catch-all
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/GlobalExceptionHandler.cs:15`). Business
failures that travel as `Result.Failure` (not exceptions) are mapped by
[`ApiControllerBase`](#apicontrollerbase)'s `HandleFailure`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:25`), and the
safety net [`UnhandledResultFailureFilter`](#unhandledresultfailurefilter)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/UnhandledResultFailureFilter.cs:21`)
catches any action that accidentally returned a failed `Result` as a 200 body and rewrites it as the
correct error. All three paths call [`ErrorHttpMapping`](#errorhttpmapping)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:15`), whose
`FrozenDictionary<ErrorType, int>` (line 21) is the single source of truth mapping each
[`ErrorType`](group-01-result-error-handling.md#errortype) (Validation/Invariant → 400, NotFound →
404, Conflict → 409, Unauthorized → 401, Forbidden → 403, and so on) to a status code, and whose
`BuildErrorsExtension` (line 48) localizes each [`Error`](group-01-result-error-handling.md#error)'s
human message at the edge by its stable `Code` while leaving Code/Type/Source verbatim for clients to
branch on. This is [Rubric §9, API & Contract Design] (consistent RFC 9457 responses) meeting the
[Rubric §1, SOLID] discipline of never duplicating the mapping.

**The controller hierarchy, generic CRUD earned by inheritance.** A module gets working endpoints by
subclassing one generic base and supplying its type parameters. [`ApiControllerBase`](#apicontrollerbase)
is the root: it owns `HandleFailure` and nothing else. [`EntityControllerBase<TEntity, TEntityDTO,
TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:28`) adds the
read surface (`GetAll`, `paged`, `lookup`, `GetById`) over an
[`IEntityQueryService`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype),
with field projection, `X-Pagination` header metadata, and page-size clamping.
[`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType,
TCreateRequest>`](#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AggregateRootEntityControllerBase.cs:27`)
extends it with an `[Idempotent]` POST create (201 with a `Location` header) and a DELETE, dispatched
through CQRS command handlers. The interfaces [`IEntityControllerBase<TEntityDTO,
TIdentifierType>`](#ientitycontrollerbasetentitydto-tidentifiertype) and
[`IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType,
TCreateRequest>`](#iaggregaterootentitycontrollerbasetentitydto-tidentifiertype-tcreaterequest)
describe those shapes for testing and documentation. The generic constraints tie the tower together:
`TEntity` must derive from
[`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype)
(or, for writes,
[`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype)),
and `TEntityDTO` must implement
[`IBaseDTO<TIdentifierType>`](#ibasedtotidentifiertype). Alongside the CRUD tower sit three
special-purpose bases: [`AuthControllerBase`](#authcontrollerbase)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:16`, login /
register / refresh / revoke), [`OAuthControllerBase`](#oauthcontrollerbase)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:32`, the Google
/ GitHub external-provider flow whose single-use exchange code keeps tokens out of the redirect URL,
ADR-043), and [`ServiceInfoControllerBase`](#serviceinfocontrollerbase)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:30`), whose
dual-version `/ServiceInfo` (returning [`ServiceInfoResponse`](#serviceinforesponse) or
[`ServiceInfoV2Response`](#serviceinfov2response)) proves the API-versioning machinery works across
versions. This is the clearest [Rubric §5, Vertical Slice] and [Rubric §16, Maintainability] payoff
in the presentation layer: a module writes a DTO, a mapper, and a five-line sealed subclass, and
inherits a fully paged, filterable, error-mapped REST resource.

**Idempotency for safe retries.** Write endpoints are made replay-safe by the
[`IdempotentAttribute`](#idempotentattribute)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotentAttribute.cs:16`), a
`ServiceFilterAttribute` that resolves [`IdempotencyFilter`](#idempotencyfilter)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:34`) from DI. When
a client sends an `Idempotency-Key` header, the filter first checks the cache on a lock-free fast
path, then serializes concurrent duplicates behind a per-key `SemaphoreSlim` with a double-check
(lines 84-100), executes the action once, and caches the response as an
[`IdempotencyRecord`](#idempotencyrecord) for 24 hours (configurable via
[`IdempotencySettings`](#idempotencysettings)). Replays return the cached body with an
`X-Idempotent-Replay: true` header. Absent the header, the action runs normally. This is a [Rubric
§7, Microservices Readiness] and [Rubric §29, Resilience & Business Continuity] control: at-least-once
retry from a gateway or a flaky client cannot create duplicate resources.

**The contract surface: mapping, JSON, and query filters.** The framework maps between the wire and
the domain **by hand**, not with a runtime reflection mapper (ADR-001). Two interfaces in the
Application layer define the shape: [`IEntityDTOMapper<TEntity, TEntityDTO,
TIdentifierType>`](#ientitydtomappertentity-tentitydto-tidentifiertype) turns an entity into its DTO,
and [`IEntityRequestMapper<TEntity, TCreateRequest,
TIdentifierType>`](#ientityrequestmappertentity-tcreaterequest-tidentifiertype) turns an incoming
request into a domain entity via its factory, returning a
[`Result<T>`](group-01-result-error-handling.md#result) so mapping-time validation (uniqueness, for
example) is a first-class failure rather than an exception (both in
`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IEntityDTOMapper.cs:14` and `:42`). Both
are auto-registered by module assembly scanning. Two more edge helpers finish the contract surface:
[`CurrencyJsonConverter`](#currencyjsonconverter)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/JsonConverters/CurrencyJsonConverter.cs:13`)
serializes the [`Currency`](group-02-domain-building-blocks.md#currency) value object as its bare ISO
4217 code and rejects unknown codes with a 400 on read; and
[`QueryFilterModelBinder`](#queryfiltermodelbinder)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/ModelBinders/QueryFilterModelBinder.cs:24`) parses
the `filters[Prop].operator=` / `filters[Prop].value=` query-string convention into the
`(operator, value)` dictionary the paged read endpoint hands to the specification layer. Manual
mapping keeps the DTO contract explicit and reviewable, the [Rubric §9, API & Contract Design] and
[Rubric §15, Best Practices] position the codebase takes deliberately. The
[`IBaseDTO<TIdentifierType>`](#ibasedtotidentifiertype) marker
(`MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/IBaseDTO.cs:9`) plus
[`BaseLookup<TIdentifierType>`](#baselookuptidentifiertype) and the
[`IConcurrencyAware`](#iconcurrencyaware) contract are the small shared DTO vocabulary the generic
controllers rely on.

**Feature gating and per-module controller visibility.** Two mechanisms let an operator turn surface
area on and off without a redeploy. [`DisabledFeatureHandler`](#disabledfeaturehandler)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/FeatureManagement/DisabledFeatureHandler.cs:13`)
renders a consistent 404 Problem Details when a `FeatureGate`-protected action is hit while its flag
is off, so a disabled feature looks like a nonexistent endpoint rather than an error. At a coarser
grain, [`ModuleControllerFeatureProvider`](#modulecontrollerfeatureprovider)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/ModuleControllerFeatureProvider.cs:28`) removes a
disabled module's controllers from MVC discovery entirely, so a module switched off in
configuration cannot have its routes mapped (which would otherwise 500, since its DI services were
never registered). Together these are the [Rubric §6, CQRS & Event-Driven] feature-flag story
extended to the HTTP edge and part of the [Rubric §7, Microservices Readiness] "one codebase, many
deployment shapes" design.

**The extraction edge: JWKS, forwarded tokens, and public caching.** Several types in this group
exist only so a module can be lifted out of the monolith into its own service (ADRs 004, 007, 008).
[`JwksEndpointExtensions`](#jwksendpointextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/JwksEndpointExtensions.cs:16`) serves
`/.well-known/jwks.json` from the Identity host so extracted services validate tokens against the
issuer's public keys instead of a shared secret; `AddForwardedJwtBearer` on the consuming side points
its bearer middleware at that endpoint. [`JwtForwardingDelegatingHandler`](#jwtforwardingdelegatinghandler)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Http/JwtForwardingDelegatingHandler.cs:17`)
copies the caller's inbound `Authorization` header onto outgoing HTTP calls so distributed
authorization flows through a service-to-service hop without any handler threading the token by hand
(the HTTP twin of the gRPC client interceptor). [`PublicEndpointOutputCachePolicy`](#publicendpointoutputcachepolicy)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Caching/PublicEndpointOutputCachePolicy.cs:35`)
lets user-independent GET endpoints stay cacheable even when the framework UI attaches a bearer token
to every request, with a `bypassRoles` escape hatch so a privileged caller who receives an elevated
payload always reads fresh. And [`DatabaseInitializationExtensions`](#databaseinitializationextensions)
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:17`)
migrates and seeds each physical data source a host owns, per the database-per-service model (ADR-006).
These are the [Rubric §7, Microservices Readiness], [Rubric §11, Security] (JWKS-based validation),
and [Rubric §12, Performance & Scalability] (edge caching) concerns that make the same controller
code run identically in a monolith and in a fleet of extracted services behind a YARP gateway.

**Where this group sits.** Everything above is the outermost ring. It depends downward on the CQRS
pipeline and query services (Groups 03 and 05), the caching and auth infrastructure (Groups 08 and
09), the module system that discovers controllers and drives health checks (Group 14 via
[`ModuleLoader`](group-14-module-system-composition.md#moduleloader)), and the domain and Result
primitives (Groups 01 and 02). It is depended on by nothing inside the framework: the app hosts and
the gRPC transport group (Group 13) call into it. Read this group as the framework's HTTP grammar,
the reusable edge every downstream service inherits so its own code stays modules and domain logic,
never plumbing.

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
- **Concept introduced (config-gated, additive auth registration).** The single `const string ExternalLoginScheme = "ExternalLogin"` (`ExternalAuthExtensions.cs:29`) is shared with the OAuth controller so the sign-in scheme name can never drift between the two halves of the flow. `[Rubric §11, Security]` assesses how authentication, secrets, and trust boundaries are handled; here each provider is gated on its `OAuth:<Provider>:ClientId` being present, and a missing client secret throws at startup (`ExternalAuthExtensions.cs:77` and `:91`) rather than silently half-configuring an auth scheme. `[Rubric §9, API & Contract Design]` is relevant because the extension is inert until configured: a host with no OAuth section keeps the JWT-only default untouched, the same opt-in posture as `AddPermissions` (ADR-020).
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
- **Concept**: this is a thin fluent facade over `OutputCacheOptions.AddPolicy`, using a C# `extension(OutputCacheOptions options)` block (`OutputCacheOptionsExtensions.cs:8`) so the policy registration reads as a first-class option on the options object. See the [DI registration `extension(T)` convention](../00-primer.md#2-architectural-styles-this-codebase-commits-to). `[Rubric §9, API & Contract Design]` is relevant, the helper gives callers a self-documenting, named entry point instead of hand-constructing the policy at each call site.
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
  - `AddErrorLocalization()` (`:88`) registers ASP.NET localization, the singleton [IErrorLocalizer](#ierrorlocalizer) via `TryAddSingleton` (`:91`), and the framework's own [ErrorResources](#errorresources) source; `AddErrorResources<TResource>()` (`:103`) adds a module's resource anchor as another [ErrorResourceSource](#errorresourcesource) built from an `IStringLocalizerFactory` (`:105-106`). This is the ADR-027 edge error-localization seam, keyed by `Error.Code`.
  - `AddCommonExceptionHandlers()` (`:116`) registers ProblemDetails (adding a `requestId` from `TraceIdentifier`, `:118-120`) then five `IExceptionHandler`s in specificity order (`:121-125`): `OperationCanceled`, `DomainException`, `DbUpdate`, `Validation`, and [GlobalExceptionHandler](#globalexceptionhandler) as the catch-all. ASP.NET Core invokes them in registration order and stops at the first that handles the exception, hence most-specific first and the 500 fallback last.
  - `AddServerAuthSessionCookie(string apiBaseAddress)` (`:141`) wires the SSR-prerender auth path: `HttpContextAccessor`, memory cache, the scoped [CookieTokenReader](group-08-auth.md#cookietokenreader), a named `HttpClient` pointed at the internal API base address (`:149-150`), and the [CookieSessionRefresher](group-08-auth.md#cookiesessionrefresher) as a **singleton** (`:153`). The singleton is load-bearing: its in-flight map must be shared across requests for single-flight refresh to work.
  - `AddModuleHealthChecks(ModuleLoader moduleLoader)` (`:169`) adds one health check per module, `Healthy` for each enabled module and `Degraded` for each disabled one (`:173-188`), named `module-{Name}` and tagged `module`. It must run after [ModuleLoader](group-14-module-system-composition.md#moduleloader)'s `DiscoverAndRegister`.
- **Why it's built this way**: bundling the API-edge concerns behind small, defaulted extension methods lets each host opt into exactly the surface it needs (a JWT-only test host skips `AddServerAuthSessionCookie`; a monolith with no disabled modules passes a null `modulesSettings`). The exception-handler ordering and the refresher's singleton lifetime are the two non-obvious, correctness-critical choices, both documented inline. Error localization is registered automatically by `AddAPI` so modules only add their own resources additively (ADR-027).
- **Where it's used**: called from every service host's composition (`Program.cs` of the ADC/Store/Helpdesk API hosts and the integration-test hosts) to wire the shared API layer; `AddApplicationDecorators()` still runs last in the overall sequence (see `MMCA.Common/CLAUDE.md` DI ordering note).
- **Caveats / not-in-source**: the relative ordering of `AddAPI` against `AddInfrastructure`/`AddApplication` in a given host is not fixed by this file; only `AddApplicationDecorators()` last is load-bearing.

### DisabledFeatureHandler

> MMCA.Common.API · `MMCA.Common.API.FeatureManagement` · `MMCA.Common/Source/Presentation/MMCA.Common.API/FeatureManagement/DisabledFeatureHandler.cs:13` · Level 0 · class (sealed)

- **What it is**: the one-method handler that decides what a `[FeatureGate]`-protected controller action returns when its feature flag is off. Instead of ASP.NET Core's default (a bare 404 with no body), it emits a proper RFC 9457 Problem Details payload so a disabled feature reads the same as any other framework error.
- **Depends on**: `IDisabledFeaturesHandler` and `FeatureGateAttribute` from `Microsoft.FeatureManagement.Mvc` (NuGet); `ProblemDetails`, `ObjectResult`, and `StatusCodes` from ASP.NET Core. No first-party dependencies.
- **Concept introduced: feature gating at the HTTP edge.** `[Rubric §9, API & Contract Design]` assesses whether every response, success or refusal, follows one uniform contract; this handler makes the disabled-feature path match the `ApiControllerBase.HandleFailure` shape rather than leaking a framework default. `[Rubric §10, Cross-Cutting]` covers concerns applied uniformly across endpoints; feature flags are exactly that. Note the split: this class gates *controller actions* decorated with `[FeatureGate]`, while [`FeatureGateCommandDecorator<TCommand, TResult>`](group-05-cqrs-pipeline.md#featuregatecommanddecoratortcommand-tresult) gates *CQRS handlers* one layer deeper. The two cover the two entry points into a gated capability.
- **Walkthrough**: `HandleDisabledFeatures(features, context)` (line 16) sets `context.Result` to an `ObjectResult` wrapping a `ProblemDetails` with `Status = 404` and a fixed title/detail ("Feature not available", lines 18-23), and also sets the outer `StatusCode = 404` (line 25) so the response code and the body agree. It returns `Task.CompletedTask` (line 28): the work is synchronous, there is nothing to await.
- **Why it's built this way**: the payload deliberately does not name the disabled feature: an anonymous caller learns only that the endpoint is unavailable, not which flag is off, so the flag set is not enumerable from outside.
- **Where it's used**: registered as the app's `IDisabledFeaturesHandler` in the API `DependencyInjection` wiring; invoked by `Microsoft.FeatureManagement.Mvc` whenever a `[FeatureGate]` action is hit with its flag disabled.

### IdempotencyRecord

> MMCA.Common.API · `MMCA.Common.API.Idempotency` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyRecord.cs:9` · Level 0 · record (sealed)

- **What it is**: the cached snapshot of an idempotent action's response: the HTTP status code plus the JSON-serialized body. It is what [`IdempotencyFilter`](#idempotencyfilter) writes on the first request and replays for every duplicate.
- **Depends on**: nothing beyond the BCL; a two-parameter positional `record`.
- **Concept**: introduced fully by [`IdempotencyFilter`](#idempotencyfilter); this is the value object it persists. `[Rubric §9, API & Contract Design]`: only the status and body are captured, not headers, which is why the replay path re-adds `X-Idempotent-Replay` itself rather than storing it.
- **Walkthrough**: `IdempotencyRecord(int StatusCode, string ResponseBody)` (line 9): `StatusCode` is the original response's code (defaulting to 200 when an `ObjectResult` carries none), `ResponseBody` is the value serialized with `JsonSerializerOptions.Web`.
- **Where it's used**: stored and read by [`IdempotencyFilter`](#idempotencyfilter) through [`ICacheService`](group-09-caching.md#icacheservice).

### IdempotencySettings

> MMCA.Common.API · `MMCA.Common.API.Idempotency` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencySettings.cs:9` · Level 0 · class (sealed)

- **What it is**: the options object bound from the `Idempotency` configuration section, controlling how long a cached idempotent response is retained.
- **Depends on**: `System.ComponentModel.DataAnnotations` for the `[Range]` validation attribute.
- **Concept**: the standard options pattern (see [primer](../00-primer.md)). `[Rubric §10, Cross-Cutting]`: the whole section is optional because every property has a default, so a host that never configures idempotency still behaves correctly.
- **Walkthrough**: `SectionName = "Idempotency"` (line 12) names the binding section; `CacheExpirationHours` (line 16) defaults to 24 and is constrained to `[Range(1, 168)]` (line 15), one hour to one week. The property is `init`-only, so the value is fixed once bound.
- **Where it's used**: resolved as `IOptions<IdempotencySettings>` inside [`IdempotencyFilter`](#idempotencyfilter); when it is absent the filter falls back to a hard-coded 24-hour window.

### ServiceInfoResponse

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:51` · Level 0 · record (sealed, nested)

- **What it is**: the v1.0 (minimal) payload returned by the service-info discovery endpoint: just the service name and the API version.
- **Depends on**: nothing beyond the BCL; a nested positional `record` inside [`ServiceInfoControllerBase`](#serviceinfocontrollerbase).
- **Concept**: the deprecated shape in a versioned-contract pair. `[Rubric §9, API & Contract Design]` assesses whether the API can evolve without breaking callers; this record is the "before" shape that v1.0 clients keep receiving unchanged while v2.0 clients get the superset.
- **Walkthrough**: `ServiceInfoResponse(string Service, string ApiVersion)` (line 51): returned by `GetV1()` populated with the concrete service name and the literal `"1.0"`.
- **Where it's used**: produced by [`ServiceInfoControllerBase`](#serviceinfocontrollerbase)`.GetV1()`; superseded by [`ServiceInfoV2Response`](#serviceinfov2response).

### ServiceInfoV2Response

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:54` · Level 0 · record (sealed, nested)

- **What it is**: the v2.0 (evolved) service-info payload: a strict superset of [`ServiceInfoResponse`](#serviceinforesponse) that additionally advertises the supported and deprecated version lists.
- **Depends on**: nothing beyond the BCL; a nested positional `record` inside [`ServiceInfoControllerBase`](#serviceinfocontrollerbase).
- **Concept**: the additive-evolution half of the versioned pair. `[Rubric §9, API & Contract Design]`: adding fields (not renaming or removing) is the backward-compatible way to grow a contract, so a v1.0 caller who never sees the new fields is unaffected.
- **Walkthrough**: `ServiceInfoV2Response(string Service, string ApiVersion, IReadOnlyList<string> SupportedVersions, IReadOnlyList<string> DeprecatedVersions)` (lines 54-58): the two extra members surface the `Supported`/`Deprecated` arrays the controller holds, so the body itself documents the version landscape (the same facts the `api-supported-versions` headers carry).
- **Where it's used**: produced by [`ServiceInfoControllerBase`](#serviceinfocontrollerbase)`.GetV2()`.

### IdempotencyFilter

> MMCA.Common.API · `MMCA.Common.API.Idempotency` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:34` · Level 1 · class (sealed)

- **What it is**: the ASP.NET Core `IAsyncActionFilter` that gives write operations client-driven idempotency. A client attaches an `Idempotency-Key` header; the first response for that key is cached and every subsequent request carrying the same key gets the stored response back verbatim, without re-running the action.
- **Depends on**: [`ICacheService`](group-09-caching.md#icacheservice) (resolved per-request from `RequestServices`), [`IdempotencyRecord`](#idempotencyrecord), [`IdempotencySettings`](#idempotencysettings) via `IOptions<>`; `SemaphoreSlim`, `ConcurrentDictionary`, and `System.Text.Json` from the BCL.
- **Concept introduced: idempotent mutation with double-check locking.** `[Rubric §9, API & Contract Design]` covers safe retry semantics on non-safe verbs; `[Rubric §29, Resilience & Business Continuity]` covers surviving client retries without duplicating side effects. The flow (doc comment lines 23-28) is a classic double-check: (1) read the cache with no lock, the common fast path; (2) if missed, take a per-key `SemaphoreSlim`; (3) re-read the cache, because a concurrent request may have finished and cached while this one waited; (4) only then run the action and cache the result. Without the lock, two near-simultaneous retries of a slow create could both miss the cache and both execute.
- **Walkthrough**
  - `IdempotencyKeyHeader => "Idempotency-Key"` (line 39) and `CacheKeyPrefix => "idempotency:"` (line 41) define the wire and cache namespacing; `DefaultExpiration` is 24 hours (line 46), used only when [`IdempotencySettings`](#idempotencysettings) is not registered.
  - `KeyLocks` (line 52) is a static `ConcurrentDictionary<string, SemaphoreSlim>`; entries are created on demand and removed again to keep it from growing without bound (see the finally block).
  - `OnActionExecutionAsync` (line 55): if the header is missing or blank, it just calls `next()` and returns, so idempotency is strictly opt-in per request (lines 58-63).
  - Fast path (lines 70-81): a cache hit appends `X-Idempotent-Replay: true` (line 73) and short-circuits with a `ContentResult` carrying the stored status and body, so the action never runs.
  - Slow path (lines 84-120): acquires the per-key semaphore honoring `RequestAborted`, re-checks the cache, then runs `next()`. It caches only when the result is an `ObjectResult` (line 105), serializing `objectResult.Value` synchronously with `JsonSerializerOptions.Web` (the `VSTHRD103` suppression on line 107 documents that string serialization is correctly synchronous). Expiration comes from [`IdempotencySettings`](#idempotencysettings) if present, else `DefaultExpiration` (lines 113-117).
  - Cleanup (lines 122-129): the `finally` releases the semaphore and, when `CurrentCount == 1` (no other waiters), removes it from `KeyLocks` so the dictionary stays bounded.
- **Why it's built this way**: only `ObjectResult` responses are cached; redirects, file results, and empty results are intentionally skipped because they are not meaningful to replay. Storing just status + body (in [`IdempotencyRecord`](#idempotencyrecord)) keeps the cached artifact small and provider-agnostic.
- **Where it's used**: wired onto actions through the [`IdempotentAttribute`](#idempotentattribute); most visibly on the create endpoint of [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest).

### ServiceInfoControllerBase

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:30` · Level 1 · class (abstract)

- **What it is**: an anonymous, read-only discovery controller that proves the API-versioning machinery works across more than one version. The same `/ServiceInfo` route is served by v1.0 (deprecated) and v2.0, selected via the `api-version` header.
- **Depends on**: `Asp.Versioning` (`ApiVersion`, `MapToApiVersion`, `ReportApiVersions`) and ASP.NET Core MVC; returns [`ServiceInfoResponse`](#serviceinforesponse) and [`ServiceInfoV2Response`](#serviceinfov2response).
- **Concept introduced: header-based API versioning as a first-class contract.** `[Rubric §9, API & Contract Design]` assesses whether an API can carry multiple versions concurrently and signal deprecation; this controller demonstrates the whole loop: two versions on one route, one marked deprecated, and `ReportApiVersions = true` (set in `AddCommonApiVersioning`) so responses carry `api-supported-versions` / `api-deprecated-versions` headers.
- **Walkthrough**
  - `Supported = ["1.0", "2.0"]` and `Deprecated = ["1.0"]` (lines 32-33) are the static version lists the v2 payload echoes.
  - `ServiceName` (line 36) is an abstract property the sealed per-service subclass supplies (e.g. `"Conference"`), because class-level routing/versioning attributes are not reliably inherited (remarks, lines 15-29): the subclass carries `[ApiController]`, `[Route]`, `[AllowAnonymous]`, and the two `[ApiVersion]` attributes.
  - `GetV1()` (line 41) is `[MapToApiVersion("1.0")]` and returns the minimal [`ServiceInfoResponse`](#serviceinforesponse); `GetV2()` (line 47) is `[MapToApiVersion("2.0")]` and returns the superset [`ServiceInfoV2Response`](#serviceinfov2response) with the supported/deprecated lists.
- **Why it's built this way**: the type is abstract with an abstract `ServiceName` so each extracted service reuses the identical versioning surface while stamping its own identity, keeping the "build the monolith now, extract a service later" path uniform. The endpoint is anonymous and reached on the service host directly (gateways do not route it, per the class remark on line 13).
- **Where it's used**: subclassed by each service host's sealed `ServiceInfoController`.

### IdempotentAttribute

> MMCA.Common.API · `MMCA.Common.API.Idempotency` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/IdempotentAttribute.cs:16` · Level 2 · class (sealed)

- **What it is**: the method-level marker that attaches [`IdempotencyFilter`](#idempotencyfilter) to a controller action. Putting `[Idempotent]` on an action opts it into the `Idempotency-Key` replay behavior.
- **Depends on**: `ServiceFilterAttribute` from ASP.NET Core MVC; resolves [`IdempotencyFilter`](#idempotencyfilter) from DI.
- **Concept introduced: service filters (DI-resolved action filters).** `[Rubric §2, Design Patterns]` covers the filter/decorator idiom; a plain `[TypeFilter]` would new-up the filter, but `ServiceFilterAttribute` (base ctor, line 16) resolves it from the container instead, so the filter can take scoped dependencies like [`ICacheService`](group-09-caching.md#icacheservice). `[Rubric §15, Best Practices]`: the attribute is one line (`ServiceFilterAttribute(typeof(IdempotencyFilter))`) with `[AttributeUsage(AttributeTargets.Method)]` (line 15) restricting it to actions.
- **Walkthrough**: the whole type is `public sealed class IdempotentAttribute() : ServiceFilterAttribute(typeof(IdempotencyFilter))` (line 16); the primary constructor forwards the filter type to the base. The docs note the filter must be registered in DI (see the API `DependencyInjection`), otherwise resolution fails at request time.
- **Where it's used**: applied to the create endpoint on [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest) and available for any module action that needs retry-safe writes.

### IEntityControllerBase<TEntityDTO, TIdentifierType>

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/IEntityControllerBase.cs:14` · Level 2 · interface

- **What it is**: the contract every read-only entity controller implements: four GET-shaped methods for all-entities, paged, lookup, and by-id retrieval.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](#ibasedtotidentifiertype) (constraint), [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), [`BaseLookup<TIdentifierType>`](#baselookuptidentifiertype), and [`QueryFilterModelBinder`](#queryfiltermodelbinder) for the filter parameter.
- **Concept introduced: the generic entity-controller contract.** `[Rubric §9, API & Contract Design]` assesses uniform endpoint conventions across every entity; this interface is the guarantee that all read controllers expose the same four GET shapes. `[Rubric §1, SOLID]`: it is deliberately the read-only slice, kept separate from the create/delete slice ([`IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>`](#iaggregaterootentitycontrollerbasetentitydto-tidentifiertype-tcreaterequest)) so a child-collection controller can implement reads without inheriting mutation endpoints (Interface Segregation).
- **Walkthrough**: the type constrains `TEntityDTO : IBaseDTO<TIdentifierType>` and `TIdentifierType : notnull` (lines 17-18). The members: `GetAllAsync` (unpaged, with `fields` projection and eager-load flags, line 26); the paged `GetAllAsync` overload adding `sortColumn`/`sortDirection`, `[Range(1, int.MaxValue)]`-guarded `pageNumber`/`pageSize`, and a `filters` dictionary bound by [`QueryFilterModelBinder`](#queryfiltermodelbinder) (line 43); `GetAllForLookupAsync` for id/name dropdown data (line 58); and `GetByIdAsync` (line 69), whose `includeFKs` defaults to `true` for the single-entity case.
- **Why it's built this way**: expressing the surface as an interface lets architecture tests and OpenAPI tooling reason about the contract independently of the concrete generic base, and lets the two-level controller hierarchy layer capabilities without collapsing reads and writes into one type.
- **Where it's used**: implemented by [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype) and extended by [`IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>`](#iaggregaterootentitycontrollerbasetentitydto-tidentifiertype-tcreaterequest).

### ApiControllerBase

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:16` · Level 3 · class (abstract)

- **What it is**: the base class every API controller inherits. It carries the `[ApiController]` behavior and one shared method, `HandleFailure`, that turns domain errors into RFC 9457 Problem Details responses.
- **Depends on**: [`Error`](group-01-result-error-handling.md#error), [`ErrorType`](group-01-result-error-handling.md#errortype), [`ErrorHttpMapping`](#errorhttpmapping), and [`IErrorLocalizer`](#ierrorlocalizer) (resolved optionally from `RequestServices`).
- **Concept introduced: centralized error-to-HTTP mapping.** `[Rubric §9, API & Contract Design]` assesses whether every endpoint fails the same way; `[Rubric §3, Clean Architecture]` covers keeping the HTTP-translation concern in the presentation layer rather than the domain. This is the boundary where a [`Result`](group-01-result-error-handling.md#result) failure from the Application/Domain layers becomes an HTTP status: the domain never knows about status codes, this base owns that mapping. The `[ApiController]` attribute (line 15) enables automatic model-state validation, binding-source inference, and `ProblemDetails` serialization.
- **Walkthrough**: `HandleFailure(IEnumerable<Error> errors)` (line 25) is `protected virtual`:
  - Null/empty guard (lines 27-35): with no errors it returns a 500 "Unknown error", treating an empty failure as a programming mistake, not a domain outcome.
  - First-error-drives-status (line 38): `ErrorHttpMapping.GetStatusCode(errorList[0].Type)` picks the status from the first error's [`ErrorType`](group-01-result-error-handling.md#errortype); the convention (doc comment) is that callers order the most significant error first.
  - Builds a `ProblemDetails` and attaches `Extensions["errors"]` (line 48) via `ErrorHttpMapping.BuildErrorsExtension`, optionally localized through [`IErrorLocalizer`](#ierrorlocalizer) if one is registered (line 47), then returns it with `StatusCode(...)`.
- **Why it's built this way**: one `virtual` method instead of a `switch` in every action removes duplication and makes the response shape uniform; keeping it `virtual` lets a subclass ([`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype)) wrap it with logging without reimplementing the mapping.
- **Where it's used**: the root of the controller hierarchy: [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype), [`AuthControllerBase`](#authcontrollerbase), and every module controller derive from it directly or transitively.

### IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/IAggregateRootEntityControllerBase.cs:15` · Level 3 · interface

- **What it is**: the read-write extension of [`IEntityControllerBase<TEntityDTO, TIdentifierType>`](#ientitycontrollerbasetentitydto-tidentifiertype): it adds `CreateAsync` and `DeleteAsync` for aggregate-root entities.
- **Depends on**: [`IEntityControllerBase<TEntityDTO, TIdentifierType>`](#ientitycontrollerbasetentitydto-tidentifiertype) (base interface), [`IBaseDTO<TIdentifierType>`](#ibasedtotidentifiertype) and [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) (constraints).
- **Concept**: the write half of the segregated controller contract introduced by [`IEntityControllerBase<TEntityDTO, TIdentifierType>`](#ientitycontrollerbasetentitydto-tidentifiertype). `[Rubric §1, SOLID]`: only aggregate roots get a create/delete surface (`TCreateRequest : ICreateRequest`, line 22), so child-collection controllers that implement only the read interface never expose mutation they should not own. `[Rubric §9, API & Contract Design]`: create returns the created DTO with a 201, delete returns 204, a consistent verb-to-status contract.
- **Walkthrough**: extends the read interface (line 19) and adds two members: `CreateAsync([Required] TCreateRequest request, ...)` returning the created DTO with 201 (line 28), and `DeleteAsync(TIdentifierType id, ...)` returning 204 No Content (line 36).
- **Where it's used**: implemented by [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest).

### EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:28` · Level 6 · class (abstract)

- **What it is**: the generic read-only controller that gives any entity four working REST endpoints (`GET /`, `GET /paged`, `GET /lookup`, `GET /{id}`) with filtering, sorting, pagination, and field projection, by delegating to the [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype) pipeline.
- **Depends on**: [`ApiControllerBase`](#apicontrollerbase) (base), [`IEntityControllerBase<TEntityDTO, TIdentifierType>`](#ientitycontrollerbasetentitydto-tidentifiertype) (implements), [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype), [`AuditableBaseEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditablebaseentitytidentifiertype) (constraint), [`IApplicationSettings`](group-14-module-system-composition.md#iapplicationsettings), [`CollectionResult<T>`](group-01-result-error-handling.md#collectionresultt), [`PagedCollectionResult<T>`](group-01-result-error-handling.md#pagedcollectionresultt), [`BaseLookup<TIdentifierType>`](#baselookuptidentifiertype), [`QueryFilterModelBinder`](#queryfiltermodelbinder), [`Error`](group-01-result-error-handling.md#error); ASP.NET Core MVC and `Asp.Versioning`.
- **Concept introduced: generic controller bases that eliminate CRUD boilerplate.** `[Rubric §9, API & Contract Design]` covers uniform endpoint conventions; `[Rubric §1, SOLID]` covers the Open/Closed side, a new entity controller extends this base rather than re-writing four endpoints. The class-level `[ApiController]`, `[Route("[controller]")]`, `[ApiVersion("1.0")]` (lines 25-27) plus the two generic constraints (`TEntity : AuditableBaseEntity<TIdentifierType>`, `TEntityDTO : IBaseDTO<TIdentifierType>`, lines 35-37) turn the type parameters into the contract.
- **Walkthrough**
  - Primary constructor (lines 28-38) takes the query service and an `ILogger`, both null-guarded into the `QueryService` (line 39) and `Logger` (line 44) protected properties.
  - `MaxPageSize` (line 50) resolves [`IApplicationSettings`](group-14-module-system-composition.md#iapplicationsettings) per-request from `HttpContext.RequestServices`, falling back to 500; per-request resolution means a settings change takes effect without a restart.
  - `GetAllAsync` unpaged (line 76): delegates to the query service capped at `MaxPageSize`, then either `HandleFailure` or `Ok`.
  - `GetAllAsync` paged (line 116): `GET /paged`; clamps `pageSize` with `Math.Min(pageSize, MaxPageSize)` (line 127), and on success serializes `PaginationMetadata` into the `X-Pagination` response header (line 144) rather than mixing it into the body, `[Rubric §9]` again.
  - `GetAllForLookupAsync` (line 157): `GET /lookup`; returns `CollectionResult<BaseLookup<TIdentifierType>>`, a lightweight id/label pair, with `nameProperty` choosing the label.
  - `GetByIdAsync` (line 189): `GET /{id}`; `includeFKs` defaults to `true` for the single-entity case.
  - `HandleFailure` override (line 216): logs the first error at Warning (guarded by `Logger.IsEnabled`) before delegating to [`ApiControllerBase`](#apicontrollerbase)`.HandleFailure`, so the read path gets observability without changing the response mapping.
- **Why it's built this way**: the controller stays thin: all filtering/sorting/paging lives in [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype), and manual DTO mapping (ADR-001) keeps entities off the wire. The controller only translates HTTP concerns: query strings, headers, status codes.
- **Where it's used**: the base for every read-only module controller; extended by [`AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>`](#aggregaterootentitycontrollerbasetentity-tentitydto-tidentifiertype-tcreaterequest) for entities that also create and delete.

### OAuthControllerBase

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/OAuthControllerBase.cs:32` · Level 6 · class (abstract)

- **What it is**: the base controller for external OAuth2 sign-in (Google, GitHub). It runs the challenge/callback/complete/exchange dance so a browser or native head can log in through a provider and receive a local JWT pair without ever exposing tokens in a redirect URL.
- **Depends on**: [`IAuthenticationService`](group-08-auth.md#iauthenticationservice) (`ExternalLoginAsync`), [`ICacheService`](group-09-caching.md#icacheservice), `IConfiguration`, [`ExternalAuthExtensions`](#externalauthextensions) (scheme constant), [`AuthenticationResponse`](group-08-auth.md#authenticationresponse) and [`OAuthCodeExchangeRequest`](group-08-auth.md#oauthcodeexchangerequest); the Google/GitHub OAuth packages and `System.Security.Cryptography`.
- **Concept introduced: the code-exchange OAuth completion pattern.** `[Rubric §11, Security]` assesses how credentials move through the system; the design's whole point is that the redirect after a successful provider login carries only a single-use opaque code, never the access/refresh tokens, so tokens never land in the address bar, browser history, the `Referer` header, or upstream access logs. `[Rubric §7, Microservices Readiness]`: the base is hoisted from the app hosts so every service reuses the identical flow, with the sealed subclass supplying only `[Route("auth/oauth")]` and versioning (class remark, lines 28-31).
- **Walkthrough**
  - `OAuthExchangeCodePrefix` and a 2-minute `OAuthExchangeCodeLifetime` (lines 42-43) namespace and time-box the server-side token stash; the short TTL matches the single redirect-then-POST round trip.
  - `GoogleLogin` (line 50) and `GitHubLogin` (line 58) both call `ChallengeProvider` (line 258), which stashes `returnUrl` and sets `RedirectUri = "/auth/oauth/complete"`.
  - `CompleteAsync` (line 75): after the middleware handles the provider callback, this reads the external cookie, extracts provider claims (`ExtractClaims`, line 171), calls `ExternalLoginAsync` (line 100) to find/create the local user and mint tokens, signs out the temporary external cookie (line 111), then mints a 32-byte hex `exchangeCode` (line 116), stashes the token pair in the cache under it, and redirects with only the code.
  - Native heads (ADR-043): `GetAllowedMobileReturnUrl` (line 233) returns the stashed `returnUrl` as the redirect target only when it is an absolute URI whose custom scheme is listed in `OAuth:AllowedReturnUrlSchemes`; http/https never match (lines 236-237), so the allowlist cannot become an open redirect, and an empty allowlist preserves the exact web-only behavior.
  - `ExchangeAsync` (line 138): `[AllowAnonymous]` `[HttpPost("exchange")]`; the UI swaps the code for the real [`AuthenticationResponse`](group-08-auth.md#authenticationresponse) out-of-band. Because that response is a struct, a cache miss yields a default value, so the miss is detected via an empty `AccessToken` (line 152); the code is then removed (`RemoveAsync`, line 158), making it single-use so a leaked or replayed code cannot mint a second token pair.
- **Why it's built this way**: carrying tokens in a redirect is the classic OAuth token-leak vector; the single-use code plus a short-lived server-side stash closes it while keeping the client flow a plain redirect and one POST. The `AppendQuery` helper (line 249) deliberately uses `OriginalString` so native callback URIs match exactly.
- **Caveats / not-in-source**: the provider scheme registration and the concrete `ExternalLoginAsync` implementation live outside this base ([`ExternalAuthExtensions`](#externalauthextensions) and the app's [`IAuthenticationService`](group-08-auth.md#iauthenticationservice)); this file assumes both are wired.
- **Where it's used**: subclassed by each app's sealed OAuth controller (`[Route("auth/oauth")]`).

### AggregateRootEntityControllerBase<TEntity, TEntityDTO, TIdentifierType, TCreateRequest>

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AggregateRootEntityControllerBase.cs:27` · Level 7 · class (abstract)

- **What it is**: the read-write tier of the controller hierarchy. It extends [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype) (the four read endpoints) by adding a `CreateAsync` (POST) and a `DeleteAsync` (DELETE) for aggregate-root entities.
- **Depends on**: [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype) (base), [`IAggregateRootEntityControllerBase<TEntityDTO, TIdentifierType, TCreateRequest>`](#iaggregaterootentitycontrollerbasetentitydto-tidentifiertype-tcreaterequest) (implements), [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult) (create and delete handlers), [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype), [`AuditableAggregateRootEntity<TIdentifierType>`](group-02-domain-building-blocks.md#auditableaggregaterootentitytidentifiertype) (constraint), [`ICreateRequest`](group-05-cqrs-pipeline.md#icreaterequest) (constraint), [`IdempotentAttribute`](#idempotentattribute); ASP.NET Core MVC and `Asp.Versioning`.
- **Concept introduced: idempotent creation guarded at the endpoint.** `[Rubric §9, API & Contract Design]` assesses safe mutation; `CreateAsync` carries `[Idempotent]` (line 59), which wires [`IdempotencyFilter`](#idempotencyfilter) so a retried POST with the same `Idempotency-Key` gets the original 201 back instead of creating a duplicate aggregate, exactly what mobile and flaky-network clients need. `[Rubric §1, SOLID]`: the four constraints (lines 40-43, notably `TEntity : AuditableAggregateRootEntity<TIdentifierType>`) enforce at compile time that only aggregate roots reach this create/delete surface.
- **Walkthrough**
  - Primary constructor (lines 27-44): four parameters, `queryService` and `logger` are forwarded to the [`EntityControllerBase<TEntity, TEntityDTO, TIdentifierType>`](#entitycontrollerbasetentity-tentitydto-tidentifiertype) base (line 38), plus `createHandler` and `deleteHandler`. The `logger` is typed `ILogger<EntityControllerBase<...>>`, not of this class, because `ILogger<T>` is not covariant and the base ctor requires that exact type; the `#pragma warning disable S6672` (lines 35-37) is a justified, narrowly-scoped suppression documenting exactly that (`[Rubric §15, Best Practices]`).
  - `CreateHandler` property (line 48): `protected`, so a derived controller that overrides `CreateAsync` to build a more specific command can still reach the handler.
  - `CreateAsync` (lines 63-76): `[HttpPost]` + `[Idempotent]`; dispatches the create command, and on success returns `CreatedAtRoute($"Get{typeof(TEntity).Name}ById", new { id = result.Value!.Id }, result.Value)` (lines 72-75), following the `"Get{Entity}ById"` route-name convention derived controllers establish. On failure it maps errors via `HandleFailure`.
  - `DeleteAsync` (lines 89-98): `[HttpDelete("{id}")]`; builds a [`DeleteEntityCommand<TEntity, TIdentifierType>`](group-05-cqrs-pipeline.md#deleteentitycommandtentity-tidentifiertype), dispatches it, and returns `NoContent()` on success.
- **Why it's built this way**: splitting the read-only base from the aggregate-root base means a child-collection controller (add/remove associations, not create whole aggregates) can extend the read base without inheriting create/delete it should not expose (`[Rubric §1, SOLID]`, Interface Segregation), while the actual work stays in injected Application-layer handlers (`[Rubric §3, Clean Architecture]`).
- **Where it's used**: concrete aggregate controllers in the modules extend this; child-only controllers deliberately extend the read-only base instead.

### AuthControllerBase

> MMCA.Common.API · `MMCA.Common.API.Controllers` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:16` · Level 10 · class (abstract)

- **What it is**: the abstract base for password-based authentication endpoints: login, register, refresh, and revoke. A downstream module (Identity) inherits it and adds the route prefix, version attribute, and any module-specific endpoints (e.g. change-password).
- **Depends on**: [`ApiControllerBase`](#apicontrollerbase) (base), [`IAuthenticationService`](group-08-auth.md#iauthenticationservice) and [`ICurrentUserService`](group-08-auth.md#icurrentuserservice) (injected), [`LoginRequest`](group-08-auth.md#loginrequest), [`RegisterRequest`](group-08-auth.md#registerrequest), [`RefreshTokenRequest`](group-08-auth.md#refreshtokenrequest), [`AuthenticationResponse`](group-08-auth.md#authenticationresponse).
- **Concept introduced: template-method inheritance for shared HTTP endpoints.** `[Rubric §9, API & Contract Design]` assesses uniform endpoint conventions; `[Rubric §1, SOLID]` covers the Open/Closed angle, the base provides `virtual` endpoints and a derived controller overrides only what differs. All four actions share the same Result-to-ActionResult shape: call the service, check `result.IsFailure`, return `HandleFailure(result.Errors)` or the success result; none carries business logic, they are thin HTTP adapters over [`IAuthenticationService`](group-08-auth.md#iauthenticationservice).
- **Walkthrough**
  - Constructor (line 16) exposes `AuthenticationService` and `CurrentUserService` as `protected` properties (lines 21-24) so derived controllers can reach them for extra endpoints.
  - `LoginAsync` (line 33): `[AllowAnonymous]` `[HttpPost("login")]`; returns `Ok` or `HandleFailure`. The `[ProducesResponseType]` attributes (lines 31-32) feed the OpenAPI contract.
  - `RegisterAsync` (line 53): `[AllowAnonymous]`; returns `StatusCode(201, ...)` (line 61), correctly 201 Created for a new account rather than 200. It is `virtual` so a module can override it to inject extra context (the doc comment names client-IP for rate limiting).
  - `RefreshAsync` (line 71): `[AllowAnonymous]`, since exchanging an expired token pair is pre-authentication.
  - `RevokeAsync` (line 89): `[Authorize]`; reads `CurrentUserService.UserId`, returns `Unauthorized()` if null (lines 91-93) as a defensive guard even though `[Authorize]` should already prevent a null id, then revokes and returns `NoContent()`.
- **Why it's built this way**: `[Rubric §16, Maintainability]`: adding a new token flow means changing one base, not N module controllers; keeping the four methods `virtual` (not the class open-ended) keeps the override surface intentional.
- **Where it's used**: extended by the Identity module's concrete `AuthController`, which supplies `[Route]`, `[ApiVersion]`, and the change-password endpoint.

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
- **Concept introduced: resource anchor types.** .NET's `IStringLocalizer` resolves translations by pairing a marker `Type` with `.resx` files that share its name and namespace. The class has no members (`ErrorResources.cs:9` declares `public sealed class ErrorResources;`) because it exists purely so the localizer factory can key on it. `[Rubric §27, i18n]` assesses whether user-facing text is externalized for translation; keying resources by the stable error `Code` (not by English prose) lets the same key resolve to any culture. See ADR-027 (multi-locale i18n).
- **Walkthrough**: Body-less type declaration; there is nothing to trace beyond the declaration itself.
- **Why it's built this way**: A dedicated anchor keeps the framework's own error translations discoverable and separate from each module's, which register their own additive resource anchors.
- **Where it's used**: Registered as an [ErrorResourceSource](#errorresourcesource) at startup (Common first); resolved at the edge by [ErrorLocalizer](#errorlocalizer).

---

### ErrorResourceSource

> MMCA.Common.API · `MMCA.Common.API.Localization` · `MMCA.Common/Source/Presentation/MMCA.Common.API/Localization/ErrorResourceSource.cs:12` · Level 0 · class (sealed)

- **What it is**: A registered resource source that [IErrorLocalizer](#ierrorlocalizer) consults when translating an error code. It wraps one `IStringLocalizer` (backing one `.resx` set). Common registers one for its own [ErrorResources](#errorresources); each module registers its own additively.
- **Depends on**: `Microsoft.Extensions.Localization.IStringLocalizer`; produced from [ErrorResources](#errorresources)-style anchors via `AddErrorResources<TResource>()`.
- **Concept introduced: an ordered, additive localization registry.** Rather than one global resource file, the framework registers a set of `ErrorResourceSource` instances (Common first, then modules). The localizer enumerates them and returns the first match, so a module can add translations for its own codes without touching Common's file. `[Rubric §27, i18n]` and `[Rubric §7, Microservices Readiness]` both apply: the additive set means an extracted module carries its own translations. See ADR-027.
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
- **Concept introduced: edge localization keyed by stable code.** The domain raises errors with a machine `Code` (for example `"PhoneNumber.Empty"`) plus an English message. `IErrorLocalizer.Localize(code, fallbackMessage)` translates that code against the current UI culture, returning the fallback unchanged when the code is empty or no resource has a key (`IErrorLocalizer.cs:11-17`). This keeps culture out of the [Error](group-01-result-error-handling.md#error) type and confines translation to the presentation boundary. `[Rubric §27, i18n]` assesses whether text is translatable without leaking locale into the core; the graceful fallback also satisfies `[Rubric §9, API & Contract Design]` since an untranslated code degrades to English rather than throwing. See ADR-027.
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
- **Concept introduced: first-match-wins over an ordered source list.** `[Rubric §27, i18n]` assesses translation coverage and layering. The localizer materializes the injected `IEnumerable<ErrorResourceSource>` into a read-only list once (`ErrorLocalizer.cs:13`) and, per lookup, walks it in registration order returning the first source whose localizer has the key. See ADR-027.
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
- **Walkthrough**: `GetStatusCode(ErrorType)` (line 37) uses `GetValueOrDefault(errorType, 400)`, so any future unmapped error type degrades to 400 rather than throwing. `BuildErrorsExtension(IReadOnlyList<Error>, IErrorLocalizer?)` (line 48) projects each error into an anonymous object with `Code`, `Message`, `Type`, `Source`, and `Target`. The `Message` is localized at the edge via the optional [IErrorLocalizer](#ierrorlocalizer), keyed by the stable `Code` (ADR-027); a `null` localizer leaves the English `Message` unchanged, while `Code`, `Type`, `Source`, and `Target` stay verbatim so clients can still branch on them (lines 48-56).
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
  once bound (see the primer's [immutability conventions](../00-primer.md#2-architectural-styles-this-codebase-commits-to)):
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
- **Concept: the public-key distribution endpoint of cross-service auth (ADR-004).** `[Rubric §11,
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
- **Concept: OIDC discovery as the bootstrap for JWKS-based validation (ADR-004).** `[Rubric §7,
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
  `AddCommonAuthentication`) are the framework's monolith-to-microservice hinge (ADR-004): the
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
- **Concept introduced: manual DTO mapping (ADR-001).** `[Rubric §16: Maintainability]`: the
  framework maps by hand in classes implementing this interface rather than using AutoMapper, so a
  missing mapping is a compile error, not a runtime surprise. `[Rubric §1: SOLID]`: the interface is
  single-purpose (ISP), and the default `MapToDTOs` (`IEntityDTOMapper.cs:27-32`) is a C# default
  interface method, so concrete mappers inherit batch mapping for free and only override it when a
  bulk-lookup optimization is worth it `[Rubric §2: Design Patterns]`.
- **Walkthrough**: the triple-generic constraints (`IEntityDTOMapper.cs:15-17`) force the entity and
  DTO to agree on the identifier type and require it be `notnull`, so a structurally unsound mapper
  will not compile. `MapToDTO(TEntity)` (`:22`) is the one required member; `MapToDTOs(...)` (`:27`)
  null-guards then projects with `Select` into a read-only collection.
- **Why it's built this way**: see ADR-001: compile-time discoverability over reflective convenience.
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
- **Why it's built this way**: same ADR-001 rationale: explicit, compile-checked mapping. Keeping it
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
  `[Rubric §27: i18n]` also applies through the localization wiring (ADR-027).
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
    → rate limiter (after auth on purpose per ADR-019, `:96-101`) → soft-deleted-user middleware →
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
  Architecture]` and `[Rubric §17: DevOps & Deployment]`: because of database-per-service (ADR-006)
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
- **Depends on**: nothing first-party.
- **Concept introduced (the DTO and the marker/role interface).** `[Rubric §9, API & Contract Design]` (assesses DTOs decoupled from domain entities and stable wire contracts): a **DTO** (Data Transfer Object) is the shape that crosses the wire, deliberately separate from the domain entity. `IBaseDTO` lets generic machinery (generic query services and controller base classes) treat *any* DTO uniformly through its `Id`. This is also `[Rubric §1, SOLID]` (SRP/OCP/LSP/**ISP**/DIP): a textbook **Interface Segregation** interface, with one member (the only thing a generic consumer needs), so clients never depend on more than they use.
- **Walkthrough**: generic over `TIdentifierType` with a `where TIdentifierType : notnull` constraint (`IBaseDTO.cs:10`); the single `Id` is `get; init;` (`IBaseDTO.cs:13`), settable at construction and immutable after. The `init`-not-`set` choice recurs across these contracts (see the primer on [immutability with `required`/`init`](00-primer.md#2-architectural-styles-this-codebase-commits-to)).
- **Why it's built this way**: making the identifier type a generic parameter, rather than hard-coding `int`, lets a DTO match its entity's strongly-typed id alias (see [identifier aliases](00-primer.md#2-architectural-styles-this-codebase-commits-to)); the `notnull` constraint forbids `Id` being a nullable type.
- **Where it's used**: the base contract for DTOs across every module, and the constraint on generic consumers: [`IEntityQueryService<TEntity, TEntityDTO, TIdentifierType>`](group-03-querying-specifications.md#ientityqueryservicetentity-tentitydto-tidentifiertype) and the controller base classes. [`BaseLookup<TIdentifierType>`](#baselookuptidentifiertype) implements it.

### IConcurrencyAware
> MMCA.Common.Shared · `MMCA.Common.Shared.DTOs` · `MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/IConcurrencyAware.cs:13` · Level 0 · interface

- **What it is**: a contract for DTOs and update requests that round-trip an **optimistic-concurrency token** (`byte[]? RowVersion`).
- **Depends on**: nothing first-party.
- **Concept introduced (optimistic concurrency).** `[Rubric §8, Data Architecture]` (assesses deliberate persistence: transactions, migrations, soft-delete, audit, and **concurrency control**). SQL Server's `rowversion` is a token that changes on every update. A read DTO exposes the current `RowVersion` so the client can echo it back on the next update; an update request carries the client's last-seen value so the persistence layer can detect a conflicting concurrent edit and return a `409 Conflict` instead of silently overwriting (the last-write-wins data-loss bug). The doc comment (`IConcurrencyAware.cs:9-12`) spells out exactly this failure mode.
- **Walkthrough**: one property, `byte[]? RowVersion { get; init; }` (`IConcurrencyAware.cs:20`). It is nullable so that creation and legacy clients (which send nothing) **skip** the conflict check. Note the `[SuppressMessage("Performance", "CA1819")]` on `IConcurrencyAware.cs:19`: exposing a `byte[]` property normally trips the "properties should not return arrays" analyzer rule, but it is required to round-trip the EF token, and the suppression is *justified inline* (`[Rubric §15, Best Practices]`: suppressions are tracked and explained, not blanket-disabled).
- **Why it's built this way**: concurrency control is opt-in per DTO through this interface, so only contended resources pay for it; the token is plumbed from EF up through the DTO and back down on the next write.
- **Where it's used**: implemented by update-request and read DTOs in modules where edits collide; paired with [`IWriteRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#iwriterepositorytentity-tidentifiertype)`.SetOriginalRowVersion`, which pushes the client's last-seen value into EF's original-values tracker so `SaveChanges` raises the conflict.

### SupportedCultures
> MMCA.Common.Shared · `MMCA.Common.Shared.Globalization` · `MMCA.Common/Source/Core/MMCA.Common.Shared/Globalization/SupportedCultures.cs:9` · Level 0 · class (static)

- **What it is**: the framework-wide allowlist of supported UI cultures (ADR-027). A static class holding the default culture, the full supported set, the Development-only pseudo-localization locale, and two membership tests.
- **Depends on**: nothing first-party. Uses only BCL types (`IReadOnlyList<string>`, `StringComparison`).
- **Concept introduced (internationalization allowlist as one source of truth).** `[Rubric §27, i18n]` (assesses whether locale support is centralized, discoverable, and drift-resistant rather than scattered string checks). Every consumer that decides "is this a language we support" reads this one list: the UI and service hosts' `UseRequestLocalization`, the culture switcher, and the Identity `User.PreferredCulture` guard. Adding a locale means adding a `.<culture>.resx` sibling set plus one entry here, with no other infrastructure change (`SupportedCultures.cs:3-8`).
- **Walkthrough**: `Default = "en-US"` (`SupportedCultures.cs:12`) is the fallback used when no cookie, profile, or `Accept-Language` preference resolves. `All` (`SupportedCultures.cs:18`) is the supported set, default first (`[Default, "es"]`); both the request-localization options and the culture switcher iterate it. `PseudoLocale = "qps-Ploc"` (`SupportedCultures.cs:28`) is the Windows-standard pseudo-localization locale, deliberately **not** part of `All` so the translation-completeness fitness gate does not demand a `.qps-Ploc.resx` sibling; it is wired into request localization and the culture switcher in **Development only**, where it runtime-transforms every resolved resource string (accents, padding, bracket sentinel) to surface hard-coded strings, truncation, and string concatenation. `IsSupported(string?)` (`SupportedCultures.cs:35`) returns true for a non-empty culture matched case-insensitively against `All`; `IsPseudoLocale(string?)` (`SupportedCultures.cs:44`) tests case-insensitively against `PseudoLocale`.
- **Why it's built this way**: a single `const`/`IReadOnlyList` allowlist keeps the localization middleware, the switcher UI, and the profile guard from drifting apart; separating `PseudoLocale` from `All` lets a diagnostic locale ship in Development without polluting the production culture set or the resx-completeness gate. See ADR-027 for the culture-resolution and pseudo-localization decision.
- **Where it's used**: the UI/service host request-localization setup, the culture switcher component, the translation-completeness fitness test, and the Identity `User.PreferredCulture` validation.

### BaseLookup<TIdentifierType>
> MMCA.Common.Shared · `MMCA.Common.Shared.DTOs` · `MMCA.Common/Source/Core/MMCA.Common.Shared/DTOs/BaseLookup.cs:8` · Level 1 · record class

- **What it is**: a minimal DTO for dropdown and autocomplete lookups: just `Id` and `Name`.
- **Depends on**: [`IBaseDTO<TIdentifierType>`](#ibasedtotidentifiertype) (Level 0), which it implements.
- **Concept (right-sized response shapes).** `[Rubric §9, API & Contract Design]` (assesses whether responses are shaped to their consumer rather than dumping full entities). Instead of returning a full entity DTO to populate a `<select>` element, the system returns `BaseLookup<T>`, carrying only the id and the display name; this cuts wire size and avoids coupling the UI to full entity shapes it does not need. Both `Id` (`BaseLookup.cs:12`) and `Name` (`BaseLookup.cs:15`) are `required` so the type is always fully populated at construction, and record equality gives value semantics for free (see [record value objects](group-02-domain-building-blocks.md#currency)).
- **Where it's used**: returned by lookup query handlers across both apps; consumed by `MudSelect`/autocomplete components that only need an id-and-display-name pair.

### CorrelationContext
> MMCA.Common.Infrastructure · `MMCA.Common.Infrastructure.Services` · `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/CorrelationContext.cs:9` · Level 1 · class (sealed)

- **What it is**: the scoped service that holds the correlation ID for the current request, defaulting to a fresh GUID when middleware does not set one.
- **Depends on**: [`ICorrelationContext`](#icorrelationcontext) (Level 0, `MMCA.Common.Application.Interfaces`), the abstraction it implements. Uses BCL `Guid` only.
- **Concept introduced (request correlation for observability).** `[Rubric §13, Observability & Operability]` (assesses whether requests can be traced end to end through logs and across service boundaries). A **correlation ID** is a single value stamped on every log line and propagated call for one logical request, so operators can reassemble a distributed trace from disjoint logs. The abstraction lives in Application (`ICorrelationContext.cs:8`) so handlers and decorators depend on the interface, not on Infrastructure; the implementation registers as a **scoped** service so one instance lives per request. Note also `[Rubric §3, Clean Architecture]` (dependency inversion: the concrete correlation holder sits in Infrastructure while consumers bind the Application interface).
- **Walkthrough**: `CorrelationId` (`CorrelationContext.cs:12`) is `{ get; private set; }`, initialized eagerly to `Guid.NewGuid().ToString("N")` so a value always exists even if no middleware runs (for example a background or test path). `SetCorrelationId(string)` (`CorrelationContext.cs:15-19`) overwrites it, guarding the input with `ArgumentException.ThrowIfNullOrWhiteSpace` so a blank header can never wipe the ID. Middleware reads the `X-Correlation-ID` header, calls `SetCorrelationId`, and the value then flows through the handler pipeline via structured-logging scopes (`ICorrelationContext.cs:4-6`).
- **Why it's built this way**: a scoped holder with an eager default keeps correlation always-on and cheap: every code path has an ID without a null check, and inbound requests still adopt the caller's ID for cross-service tracing. Keeping the interface in Application preserves the layering rule that Infrastructure implements Application abstractions, never the reverse.
- **Where it's used**: set by the correlation middleware from the inbound header; read by the Logging decorator in the CQRS pipeline (which logs full pipeline duration against the correlation ID) and by structured-logging scopes throughout request handling.

### CurrencyJsonConverter
> MMCA.Common.API · `MMCA.Common.API.JsonConverters` · `MMCA.Common/Source/Presentation/MMCA.Common.API/JsonConverters/CurrencyJsonConverter.cs:13` · Level 4 · class (sealed)

- **What it is**: a `System.Text.Json.JsonConverter<Currency>` that serializes [`Currency`](group-02-domain-building-blocks.md#currency) as its ISO 4217 three-letter code string and deserializes by validating that code through `Currency.FromCode`.
- **Depends on**: [`Currency`](group-02-domain-building-blocks.md#currency) (Level 3, `MMCA.Common.Shared.ValueObjects`). Extends BCL `JsonConverter<T>`.
- **Concept (value objects serialize to their natural string form).** `[Rubric §9, API & Contract Design]` (assesses whether the wire contract exposes clean primitives rather than leaking internal object graphs). A domain value object should cross the wire as the compact primitive a client expects (`"USD"`), not as a nested object. This converter also enforces validity at the boundary: malformed input is rejected before it reaches a handler.
- **Walkthrough**: `Read` (`CurrencyJsonConverter.cs:16`) first rejects any non-string token, throwing `JsonException("Currency must be a string.")` (`CurrencyJsonConverter.cs:18-19`); it then reads the string (`CurrencyJsonConverter.cs:21`), runs `Currency.FromCode(code)` (`CurrencyJsonConverter.cs:22`), and throws `JsonException($"Invalid currency code: {code}")` on failure (`CurrencyJsonConverter.cs:23-24`). Any thrown `JsonException` surfaces as a `400 Bad Request` from the framework's model binding, so an invalid currency never reaches a handler. `Write` (`CurrencyJsonConverter.cs:30-31`) is a one-liner: `writer.WriteStringValue(value.Code)`. The type is sealed, holds no state, and has exactly these two methods (`[Rubric §15, Best Practices]`: the framework-idiomatic converter pattern).
- **Why it's built this way**: routing (de)serialization through `Currency.FromCode` keeps the single validation gate for currency codes in the value object itself, so the API layer neither duplicates the allowlist nor accepts a `Currency` the domain would reject.
- **Where it's used**: registered as a global JSON converter in `WebApplicationBuilderExtensions`, so every API request and response serializes `Currency` as a string uniformly.


---
[⬅ Navigation Metadata & Populators (EF-decoupled eager loading)](group-11-navigation-populators.md)  •  [Index](00-index.md)  •  [gRPC & Inter-Service Contracts ➡](group-13-grpc-contracts.md)
