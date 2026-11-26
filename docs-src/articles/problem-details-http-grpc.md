# Problem Details across HTTP and gRPC (RFC 9457)

> Series: MMCA.Common · Article #20 · Pillar P2 · Groups G12, G13 · Rubric §9 ·
> Status: grounded in `MMCA.Common/AGENTS.md` (Microservices Extraction Boundaries),
> `Website/docs-src/onboarding/group-12-api-hosting-mapping.md`, `group-13-grpc-contracts.md`, and
> `Website/docs-src/governance/common-ArchitectureScorecard.md` (§9). No em dashes.

**Subtitle:** One error model, two transports. How a `Result` failure becomes the same RFC 9457 shape
whether the caller reached you over HTTP or gRPC, and the honest gaps that still cost the category points.

---

Here is an error contract that looks fine until you have more than one client:

```csharp
[HttpGet("{id}")]
public async Task<IActionResult> Get(int id)
{
    var session = await _service.GetByIdAsync(id);
    if (session is null) return NotFound();          // 404, empty body
    if (!_user.CanView(session)) return Forbid();    // 403, no body
    return Ok(session);                              // 200
}
```

Multiply that across a few hundred actions written by a few different people and you get a few
different error dialects. One endpoint returns `404` with an empty body, another returns `200` with
`{ "error": "not found" }`, a third throws and the framework's default handler emits a stack trace in
development. A client integrating against you cannot write one error handler. It writes one per
endpoint, defensively, and still gets surprised.

Now add a second transport. The day a module is extracted and called over gRPC instead of HTTP, the
caller is reading `RpcException` status codes and trailing metadata, not HTTP status and bodies. If the
error mapping was hand-written per endpoint, none of it carries over. You re-derive the whole contract
on the wire.

## Why it matters

A consistent error contract is not cosmetic. It is the difference between a client that can branch on
"was this a validation problem, a not-found, or a conflict?" mechanically, and a client that has to
pattern-match on prose. RFC 9457 (Problem Details for HTTP APIs, the successor to RFC 7807) exists
precisely so that "machine-readable error" is a settled, standard shape: a `type`, `title`, `status`,
`detail`, and extension members, served as `application/problem+json`.

In a framework whose thesis is "monolith now, services later, no rewrite," the error contract has an
extra requirement: it has to be transport-agnostic. The same logical failure (a not-found, a
forbidden, a conflict) has to look the same to a caller whether the answer came from an in-process
object, an HTTP hop, or a gRPC hop. If it does not, extraction is a breaking change for every consumer.

## The MMCA answer: one mapping decision, one frozen table per transport

MMCA.Common's whole error story starts from one decision recorded across the codebase: expected
failures are *values*, not exceptions. Handlers return `Result<T>` carrying an `Error` list, each error
typed by an `ErrorType`. The edge's only job is to translate that value into the right wire shape.

On the **HTTP** side, the framework's result-returning controller bases (`EntityControllerBase` among
them) derive from `ApiControllerBase`, whose error path is
`HandleFailure(IEnumerable<Error>)` (the same base also emits concurrency `ETag`s and runs `If-Match`
conditional writes, which are outside this article). It produces an `ObjectResult` whose status belongs to the *most
severe* `ErrorType` present, deliberately not the first error's, so an aggregate built by
`Result.Combine` cannot be downgraded by error ordering: a 403 or a 500 travelling alongside a
validation error still answers 403 or 500, and equal ranks keep the earliest error. Every error still
travels in the Problem Details `errors` array; only the status is ranked. A 429 whose `TooManyRequests`
errors carry a retry hint also answers with a `Retry-After` header, the longest hint winning. The actual
`ErrorType -> status` table does not live in the controller. It lives once in `ErrorHttpMapping`, a
`FrozenDictionary` keyed by error type:

```csharp
// ErrorHttpMapping - the single ErrorType -> HTTP status table (FrozenDictionary):
//   Validation         -> 400
//   Invariant          -> 400
//   NotFound           -> 404
//   Conflict           -> 409
//   Unauthorized       -> 401
//   Forbidden          -> 403
//   UnprocessableEntity-> 422
//   Failure            -> 400
//   Unexpected         -> 500
//   TooManyRequests    -> 429
//
// A multi-error failure is ranked, not indexed: GetStatusCode(errors) asks
// ErrorTypeSeverity.MostSevere which type wins, most to least severe:
//   Unexpected > Unauthorized > Forbidden > TooManyRequests > Conflict
//              > NotFound > UnprocessableEntity > Invariant / Validation / Failure
//
// Centralizing the map is what keeps every endpoint's error shape identical.
```

Thrown exceptions get folded into the *same* Problem Details shape by an ordered, most-specific-first
chain of `IExceptionHandler`s: `OperationCanceledExceptionHandler` (client disconnect -> 499, so
monitoring can tell an abandoned request from a server error), `DomainExceptionHandler` (business-rule
violation -> 400), `DbUpdateExceptionHandler` (concurrency or constraint -> 409, with a deliberately
generic message so schema names do not leak), `ValidationExceptionHandler` (FluentValidation -> 400
with a per-property errors dictionary), and `GlobalExceptionHandler` last. That final handler first
answers two caller faults with a client status (a cross-tenant write -> 400 titled "Tenant write
rejected", and a `BadHttpRequestException` keeps the status the server set, typically 413 for an
oversize body or 400 otherwise) and turns everything else into a 500. Together they guarantee one
invariant: every error an action returns or throws leaves the API as an RFC 9457
Problem Details with a sensible status. The invariant covers the MVC pipeline, not the middleware in
front of it: the rate limiter rejects with a 429 that carries a `Retry-After` header whenever the
limiter knows when its window resets, but writes no body, and on an API host an unmatched route is a
bare 404, because the API pipeline does not call `UseStatusCodePages` (only the Blazor web host
pipeline re-executes error statuses to its `/not-found` page).

There is also a guard against the most insidious bug in this space: a controller that calls
`Ok(result)` on a *failed* `Result`. Without a guard that serializes as a misleading `200 OK` carrying
an error body. `UnhandledResultFailureFilter` is an always-run result filter, registered globally, that
catches exactly that programmer mistake, rewrites the response to the correct error status using the
*same* `ErrorHttpMapping` table, and logs a warning. The 200-with-an-error-body trap is closed
structurally, not by code review.

On the **gRPC** side, the same `Result` model crosses the wire unchanged. A gRPC service implementation
calls the inner C# service, gets a `Result`, and calls `result.ThrowIfFailure()`. That throws a
`ResultFailureException` carrying the `Error` list. `GrpcResultExceptionInterceptor`, registered by
`AddGrpcServiceDefaults()`, catches it for all four call shapes (unary and the three streaming kinds),
logs it, and rethrows `errors.ToRpcException()` (or a plain `Internal` status carrying the exception
message when the exception holds no errors): an `RpcException` whose `StatusCode` comes from a
`FrozenDictionary<ErrorType, StatusCode>` that *mirrors* the HTTP table, picked from the most severe
error by the same `ErrorTypeSeverity` ranking the HTTP edge uses, and whose trailing metadata carries
every error as `error-{i}-code/-message/-type/-source/-target` entries. The message, source and target
values are percent-encoded wherever they fall outside printable ASCII, because gRPC text metadata
accepts nothing else.

Both halves of that round trip ship in the framework, in the same file. `errors.ToRpcException()` lives
in MMCA.Common's gRPC package (`ResultGrpcExtensions`), so every extracted service emits the same
structured trailers for free, and `Metadata.ToErrors()` is the exact inverse: it walks the
`error-{i}-*` entries back into an `Error` list, omitting an absent source or target exactly as the
encoder omitted it, and falling back to `ErrorType.Failure` on a type name it does not recognize so a
newer peer cannot break an older client. `RpcException.ToResult()` and `ToResult<T>()` sit on top of it
and rebuild `Result.Failure(errors)`, degrading a transport fault that carries no trailers (a reset
connection, an exceeded deadline) to a single `Unexpected` error coded `Grpc.{StatusCode}` rather than
letting an exception escape. `Unexpected` is deliberate: a fault with no trailers never came from the
peer's own `Result`, so it says nothing about the request, and it reaches the HTTP edge as a 500 at the
top severity rank that callers treat as retryable, never as the definitive 400 a `Failure` would be.
A consumer's client adapter is then a two-line `catch`: ADC's
`SessionBookmarkValidationServiceGrpcAdapter` and `EventLiveValidationServiceGrpcAdapter` catch
`RpcException` and `return ex.ToResult()` or `ex.ToResult<T>()`, and the caller sees the same `Result`
it would have seen in-process.

That status-mapping symmetry is the point. The `ErrorType -> status` decision is made once per transport in a frozen
table, the translation is a pipeline concern written once in an interceptor, and a `NotFound` is a 404
over HTTP and a `NotFound` `RpcException` over gRPC because both tables agree. They are two tables,
not one shared object: the gRPC table documents itself as a mirror of `ErrorHttpMapping`, and the only
code the two transports share is the `ErrorTypeSeverity` ranking that picks the winning error. The same holds for a
temporary refusal: `TooManyRequests` is a 429 over HTTP and `ResourceExhausted` over gRPC.

## The rest of the §9 contract

The same edge standardizes the things that drift if left to each endpoint:

- **Pagination and filtering.** The generic read controllers expose `GET /paged` with filter, sort, and
  page parameters, and emit pagination metadata in an `X-Pagination` response header. A structured
  `?filters[Name].operator=contains&filters[Name].value=shirt` query syntax is parsed by a model binder
  into the dynamic filter the query service applies server-side. Every list endpoint speaks the same
  query and pagination dialect because it inherits it.
- **Header-based API versioning.** Versioning is configured at the host edge as a header concern, not
  baked into route strings per controller.
- **Disabled features speak the same dialect.** A `[FeatureGate]` on an off flag returns an RFC 9457
  404 (via `DisabledFeatureHandler`), not a bespoke 403, so a disabled feature reads as absent and
  still matches the API's error shape. It is not disguised as a missing route: the body is titled
  "Feature not available", while an unknown route on an API host answers with an empty-body 404.

## Trade-offs, honestly

The scorecard scores §9 (API and Contract Design) at Maturity 4 of 4 and Implementation 9 of 10
(weighted 8/18). The category sits at the maturity ceiling: the contract is defined once and checked by
a build, not by review. What is left is the last implementation point, and the scorecard names four
reasons for holding it: the baseline covers only the framework-owned surface, the purity rule's run in
the framework's own repo is vacuous, a single `v1` OpenAPI document is served even though versioning is
header-based, and integration events have a frozen-snapshot gate but no AsyncAPI-style published
contract. The first two are the honest notes below.

- **The contract snapshot is guarded at two levels, on purpose.** The framework generates an OpenAPI
  document: the host registers it with ASP.NET Core's built-in `AddOpenApi()`, `AddCommonOpenApi()`
  layers the framework's transformers onto every registered document, and `MapCommonOpenApi()` serves
  `/openapi/v1.json` outside Production (and fails at startup when no `v1` document is registered).
  `OpenApiBaselineTests` closes the loop in the framework's own CI: it boots an in-memory host over that
  exact registration path (`AddCommonApiVersioning()` + `AddOpenApi()` + `AddCommonOpenApi()` +
  `MapCommonOpenApi()`), fetches `/openapi/v1.json`, normalizes it (the
  host-assigned `servers` block is dropped, object properties are ordered ordinally so generator
  ordering is not mistaken for drift, array order is preserved because it is contractual), and diffs the
  result against the committed baseline for the framework it runs on (`openapi-baseline.v1.net11.json`
  on net11.0, `openapi-baseline.v1.json` on net10.0, because the two framework lines emit the same
  contract with a different spec revision and tag ordering). A change to the generated surface fails the
  build; an intended change is regenerated deliberately, by setting `MMCA_UPDATE_OPENAPI_BASELINE=1`,
  re-running the test on each target framework, and committing the new baselines in the same pull
  request. What that gate covers is the
  framework-owned surface: the probe controllers stand in for a consumer's real controllers precisely
  so the test guards document generation rather than any concrete API. The concrete surface stays
  guarded by the consumer hosts' own contract-snapshot tests, where the endpoints actually live. Two
  levels, one boundary, nothing duplicated.
- **`[ServiceContract]` has a dedicated rule that bites in the consumers and asserts nothing in the
  framework.** The Shared-layer `[ServiceContract]` attribute tags the wire surface of an extracted
  service: the interface its callers depend on. It also accepts classes and structs, but the reference
  consumers mark interfaces only, and no integration event record or DTO carries it.
  `ServiceContractsDoNotDependOnServiceInternals` scans
  every assembly the architecture map registers for types carrying that marker and fails the build,
  naming the offending type, when one reaches into the producing service's Domain, Application, or
  Infrastructure. It is attribute-driven rather than layer-driven for a specific reason: no repo
  registers a Contracts layer in its map today, so a layer-iterating rule would pass vacuously forever,
  while an attribute-driven one starts biting the moment a repo marks its first contract type. The
  honest part is that MMCA.Common marks no type with the attribute, so the framework's own run of the
  rule asserts nothing and is a ratchet there. The consumers are where it bites: ADC marks nine Shared
  interfaces (`ISessionBookmarkValidationService` and `IEventLiveValidationService` among them) and
  Store marks four (`IProductVariantService`, `ICustomerService` and two export services), and both
  repos run the rule on every build.

So the enforcement story reads cleanly in three parts. The error *mapping* is enforced where it is
defined (one frozen table per transport, the gRPC one mirroring the HTTP one, plus the
200-with-error-body filter). The contract
*shape* is enforced by a baseline a build diffs. The contract *purity* invariant is enforced by a
dedicated fitness rule, alongside the layer and transport rules (ADR-015) that guard the same boundary
from the layer side. The remaining implementation point is the four gaps named above: a purity rule no
framework type exercises, half of the snapshot gate that by design can only run in the repos that own
the concrete API surface, one OpenAPI document for a header-versioned API, and no published contract
for integration events.

## Apply this even without MMCA

The pattern ports to any stack with more than one client or more than one transport:

1. **Model expected failures as typed values, not exceptions or ad-hoc status codes.** A small
   `ErrorType` enum is enough.
2. **Map that enum to wire status in one table, per transport.** A `FrozenDictionary` (or any single
   lookup) reused by every endpoint beats a `return NotFound()` scattered across actions.
3. **Make every exit produce the standard shape.** Fold thrown exceptions into the same Problem Details
   via an ordered handler chain, and add a guard that catches the "success status on a failed result"
   mistake before it ships.
4. **If you might extract a module, mirror the table on the other transport.** The gRPC status mapping
   should be the same decision as the HTTP status mapping, written once, so a caller sees one error
   model across the hop.
5. **Put the contract under a check.** A versioned OpenAPI snapshot diffed by CI, or an architecture
   test on the contract types, is the difference between a contract and a hope. The framework above
   does both: it diffs its generated document against a committed baseline and asserts contract purity
   with a dedicated fitness rule, while the concrete API surface is snapshotted in the hosts that own
   it. Wherever a given check lives, make sure it actually runs on every build.

---

**What we covered:** why per-endpoint error handling produces inconsistent contracts that do not
survive a transport change, how MMCA.Common maps `ErrorType` to status through one frozen table per
transport (`ErrorHttpMapping` behind `ApiControllerBase.HandleFailure` over HTTP, its mirror behind
`GrpcResultExceptionInterceptor` over gRPC) ranked by one shared severity order,
how a guard closes the 200-with-error-body trap, and how §9 keeps that contract honest (a committed
OpenAPI baseline the framework's own build diffs, consumer hosts snapshotting their concrete surface,
and a dedicated `[ServiceContract]` purity rule that bites on the interfaces the consumers mark).

**Next in the series:** notifications as a vertical slice, the one concrete bounded context the
framework ships, across push, in-app inbox, and email.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the §9 scorecard entry (gaps
included), or `dotnet add package MMCA.Common.API` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- The full 34-category scorecard, §9 included, lives in `Website/docs-src/governance/common-ArchitectureScorecard.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, gRPC, API Design*

*Notes (2026-11-25 refresh, re-verified 2026-11-25 against MMCA.Common v1.319.0; every anchor in this
entry was re-read this run, and it supersedes the line anchors in the older entries). Changed claims:
(1) `ApiControllerBase` is not single-purpose: `HandleFailure` at
`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:49` (class `:23`, ranked
status `:62` via `ErrorHttpMapping.GetStatusCode`, ranking doc `:36-44`), `SetRetryAfter` on a 429 at
`:74` and `:87-101`, `SetConcurrencyETag` `:125`, `HandleConditionalCommandAsync` `:153` and
`HandleConditionalCommandWithResponseAsync` `:184`; the body names the error path and the `Retry-After`
behavior. (2) A trailer-less gRPC fault is `Unexpected`, not `Failure`:
`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs` `TransportError` `:340-344`
(remarks `:333-339`), `ToResult()` `:219` (doc `:209-212`), `ToResult<T>()` `:244` (doc `:233-236`).
(3) `UseStatusCodePages` is scoped to API hosts: the one call under `MMCA.Common/Source` is
`app.UseStatusCodePagesWithReExecute("/not-found", ...)` in `UseMmcaBlazorWebPipeline`
(`.../MMCA.Common.UI.Web/Hosting/BlazorWebHostExtensions.cs:198`, method `:181`); the other hits are
comments (`.../API/Authorization/Fallback/FallbackAuthorizationHandler.cs:22`,
`.../MMCA.Common.UI/Pages/NotFound.razor:9`, `.../MMCA.Common.UI/Services/Navigation/IForbiddenReExecutionDetector.cs:8`);
the same scoping was applied to the disabled-feature bullet. (4) One OpenAPI baseline per framework:
`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/OpenApi/OpenApiBaselineTests.cs:44-48` (rationale
`:40-43`, per-framework regeneration guidance `:110`, `MMCA_UPDATE_OPENAPI_BASELINE` `:38`, `servers`
dropped `:51-52`). (5) ADC marks nine `[ServiceContract]` interfaces, adding
`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/Tickets/Invitations/IPendingTicketInvitationService.cs:13`
and `.../MMCA.ADC.Identity.Shared/Users/IVerifiedUserLookupService.cs:15` to the seven
(`.../Conference.Shared/Sessions/ISessionBookmarkValidationService.cs:10`,
`.../Conference.Shared/Events/Live/IEventLiveValidationService.cs:13`,
`.../Conference.Shared/Exports/IUserConferenceExportService.cs:13`,
`.../Engagement.Shared/UserSessionBookmarks/IBookmarkCountService.cs:10`,
`.../Engagement.Shared/Exports/IUserEngagementExportService.cs:13`,
`.../Identity.Shared/Users/IAttendeeQueryService.cs:10`,
`.../Notification.Shared/UserNotifications/IUserNotificationExportService.cs:13`). Store four unchanged
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Products/IProductVariantService.cs:33`,
`.../Identity.Shared/Customers/ICustomerService.cs:25`, `.../Sales.Shared/Exports/IUserSalesExportService.cs:20`,
`.../Catalog.Shared/Exports/IUserCatalogExportService.cs:19`); both run the rule
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Layering/ServiceContractPurityTests.cs:9`,
`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Layering/ServiceContractPurityTests.cs:9`).
Re-anchored, unchanged claims: `ErrorHttpMapping` table
`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:23-35` (Unexpected 500 `:33`,
TooManyRequests 429 `:34`), list overload `:54-55` via `ErrorTypeSeverity.MostSevere`; exception chain
`.../MMCA.Common.API/DependencyInjection.cs:162-166` (`AddCommonExceptionHandlers` `:157`),
`UnhandledResultFailureFilter` `:50`; rate limiter
`.../API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:431` (429) and `:435` (`OnRejected`),
`WithRetryAfterHeader` `:30`; gRPC table `ResultGrpcExtensions.cs:37-50` (doc "Mirrors" `:34`,
ResourceExhausted `:49`), `ToRpcException()` `:119` ranking at `:124`, `ToErrors()` `:173`,
`ParseErrorType` falling back to `Failure` `:280-283`, `EscapeTrailerValue` `:289`; ADC adapters in
`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/`: `SessionBookmarkValidationServiceGrpcAdapter.cs`
catches `:53,79`, returns `:58,85`; `EventLiveValidationServiceGrpcAdapter.cs` catches `:65,121,150,186,218`,
returns `ex.ToResult<T>()` `:70,126,155,191,223`. OpenAPI: `AddCommonOpenApi()`
`.../API/Startup/WebApplicationBuilderExtensions.cs:108`; `MapCommonOpenApi()`
`.../Startup/Endpoints/OpenApiEndpointExtensions.cs:59` (non-Production guard `:61`, missing-`v1` throw
`:66`, `AllowAnonymous` `:73`); probe host `.../MMCA.Common.API.Tests/OpenApi/OpenApiProbeHost.cs`
(`CreateAsync` `:28`, `AddCommonApiVersioning()` `:39`, `AddOpenApi()` `:44`, `AddCommonOpenApi()` `:45`,
`MapCommonOpenApi()` `:65`). Scorecard row `Website/docs-src/governance/common-ArchitectureScorecard.md:74`
(weight 2, Maturity 4, Implementation 9, 8/18, the four held-at-9 reasons). Confirmed by this run's audit
and not re-read by the apply pass: the `GlobalExceptionHandler` client-status branches, the
`DisabledFeatureHandler` title, the `ErrorTypeSeverity` ranks, `GrpcResultExceptionInterceptor`'s
`Internal` fallback, and the `ServiceContractAttribute` targets. Side observation, not an article claim:
ADC's own doc comment at `EventLiveValidationServiceGrpcAdapter.cs:229` still describes the transport
fault as `ErrorType.Failure`.*

*Notes (history): the 2026-11-17 refresh dropped the opt-in Scalar UI mapping (no host called it). The
2026-10-29 refresh split the "one table on both transports" wording into one table per transport,
added the rate limiter's `Retry-After` header, and dropped a reference to a nonexistent fence-sync
script. The 2026-10-22 refresh described `GlobalExceptionHandler`'s two client-status branches and
counted the seventh ADC contract. The 2026-10-08 refresh scoped the Problem Details invariant to the
MVC pipeline, dropped the "indistinguishable" disabled-feature wording, and corrected the scorecard's
reasons from two to four. The 2026-10-02 refresh re-anchored every claim and added the `TooManyRequests`
row and ranking tier to the fence. The 2026-08-22 refresh (MMCA.Common PR #271, squash `8a6c603`)
rewrote "Trade-offs, honestly", takeaway 5 and "What we covered" after the OpenAPI baseline gate and the
`[ServiceContract]` purity rule landed; anchors were re-verified 2026-09-19, when the severity-ranking
fence was added.*

- Full series index: https://ivanball.github.io/writing.html
