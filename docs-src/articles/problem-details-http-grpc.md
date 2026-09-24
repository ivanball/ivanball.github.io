# Problem Details across HTTP and gRPC (RFC 9457)

> Series: MMCA.Common · Article #20 · Pillar P2 · Groups G12, G13 · Rubric §9 ·
> Status: grounded in `MMCA.Common/CLAUDE.md` (Result pattern, gRPC extraction boundaries),
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

## The MMCA answer: one mapping table, reused on both transports

MMCA.Common's whole error story starts from one decision recorded across the codebase: expected
failures are *values*, not exceptions. Handlers return `Result<T>` carrying an `Error` list, each error
typed by an `ErrorType`. The edge's only job is to translate that value into the right wire shape.

On the **HTTP** side, every controller derives from `ApiControllerBase`, whose single job is
`HandleFailure(IEnumerable<Error>)`. It produces an `ObjectResult` whose status belongs to the *most
severe* `ErrorType` present, deliberately not the first error's, so an aggregate built by
`Result.Combine` cannot be downgraded by error ordering: a 403 or a 500 travelling alongside a
validation error still answers 403 or 500, and equal ranks keep the earliest error. Every error still
travels in the Problem Details `errors` array; only the status is ranked. The actual
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
//
// A multi-error failure is ranked, not indexed: GetStatusCode(errors) asks
// ErrorTypeSeverity.MostSevere which type wins, most to least severe:
//   Unexpected > Unauthorized > Forbidden > Conflict > NotFound
//              > UnprocessableEntity > Invariant / Validation / Failure
//
// Centralizing the map is what keeps every endpoint's error shape identical.
```

Thrown exceptions get folded into the *same* Problem Details shape by an ordered, most-specific-first
chain of `IExceptionHandler`s: `OperationCanceledExceptionHandler` (client disconnect -> 499, so
monitoring can tell an abandoned request from a server error), `DomainExceptionHandler` (business-rule
violation -> 400), `DbUpdateExceptionHandler` (concurrency or constraint -> 409, with a deliberately
generic message so schema names do not leak), `ValidationExceptionHandler` (FluentValidation -> 400
with a per-property errors dictionary), and `GlobalExceptionHandler` as the catch-all 500. Together
they guarantee one invariant: every error leaving the API, thrown or returned, is an RFC 9457 Problem
Details with a sensible status.

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
logs it, and rethrows `errors.ToRpcException()`: an `RpcException` whose `StatusCode` comes from a
`FrozenDictionary<ErrorType, StatusCode>` that *mirrors* the HTTP table, picked from the most severe
error by the same `ErrorTypeSeverity` ranking the HTTP edge uses, and whose trailing metadata carries
every error as `error-{i}-code/-message/-type/-source/-target` entries.

Both halves of that round trip ship in the framework, in the same file. `errors.ToRpcException()` lives
in MMCA.Common's gRPC package (`ResultGrpcExtensions`), so every extracted service emits the same
structured trailers for free, and `Metadata.ToErrors()` is the exact inverse: it walks the
`error-{i}-*` entries back into an `Error` list, omitting an absent source or target exactly as the
encoder omitted it, and falling back to `ErrorType.Failure` on a type name it does not recognize so a
newer peer cannot break an older client. `RpcException.ToResult()` and `ToResult<T>()` sit on top of it
and rebuild `Result.Failure(errors)`, degrading a transport fault that carries no trailers (a reset
connection, an exceeded deadline) to a single `Failure` error coded `Grpc.{StatusCode}` rather than
letting an exception escape. A consumer's client adapter is then a two-line `catch`: ADC's
`SessionBookmarkValidationServiceGrpcAdapter` and `EventLiveValidationServiceGrpcAdapter` catch
`RpcException` and `return ex.ToResult<T>()`, and the caller sees the same `Result` it would have seen
in-process.

That status-mapping symmetry is the point. The `ErrorType -> status` decision is made once per transport in a frozen
table, the translation is a pipeline concern written once in an interceptor, and a `NotFound` is a 404
over HTTP and a `NotFound` `RpcException` over gRPC because both tables agree.

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
  404 (via `DisabledFeatureHandler`), not a bespoke 403, so a disabled feature is indistinguishable
  from a route that does not exist and still matches the API's error shape.

## Trade-offs, honestly

The scorecard scores §9 (API and Contract Design) at Maturity 4 of 4 and Implementation 9 of 10
(weighted 8/18). The category sits at the maturity ceiling: the contract is defined once and checked by
a build, not by review. What is left is the last implementation point, and two honest notes say where
it lives.

- **The contract snapshot is guarded at two levels, on purpose.** The framework generates an OpenAPI
  document: `AddCommonOpenApi()` calls ASP.NET Core's built-in `AddOpenApi()`, `MapCommonOpenApi()`
  serves `/openapi/v1.json` outside Production, and an opt-in `MapCommonScalarUi()` renders the Scalar
  reference UI from that document. `OpenApiBaselineTests` closes the loop in the framework's own CI: it
  boots an in-memory host over that exact registration path (`AddCommonApiVersioning()` +
  `AddCommonOpenApi()` + `MapCommonOpenApi()`), fetches `/openapi/v1.json`, normalizes it (the
  host-assigned `servers` block is dropped, object properties are ordered ordinally so generator
  ordering is not mistaken for drift, array order is preserved because it is contractual), and diffs the
  result against a committed `openapi-baseline.v1.json`. A change to the generated surface fails the
  build; an intended change is regenerated deliberately, by setting `MMCA_UPDATE_OPENAPI_BASELINE=1`
  and committing the new baseline in the same pull request. What that gate covers is the
  framework-owned surface: the probe controllers stand in for a consumer's real controllers precisely
  so the test guards document generation rather than any concrete API. The concrete surface stays
  guarded by the consumer hosts' own contract-snapshot tests, where the endpoints actually live. Two
  levels, one boundary, nothing duplicated.
- **`[ServiceContract]` has a dedicated rule that guards more than it currently catches.** The
  Shared-layer `[ServiceContract]` attribute tags the wire surface of an extracted service (the
  interfaces, event records, and boundary DTOs). `ServiceContractsDoNotDependOnServiceInternals` scans
  every assembly the architecture map registers for types carrying that marker and fails the build,
  naming the offending type, when one reaches into the producing service's Domain, Application, or
  Infrastructure. It is attribute-driven rather than layer-driven for a specific reason: no repo
  registers a Contracts layer in its map today, so a layer-iterating rule would pass vacuously forever,
  while an attribute-driven one starts biting the moment a repo marks its first contract type. The
  honest part is that MMCA.Common marks no type with the attribute, so the framework's own run of the
  rule asserts nothing. The attribute is an adoptable marker, and the rule standing behind it is a
  ratchet rather than a check that catches violations daily.

So the enforcement story reads cleanly in three parts. The error *mapping* is enforced where it is
defined (a frozen table reused on both transports, plus the 200-with-error-body filter). The contract
*shape* is enforced by a baseline a build diffs. The contract *purity* invariant is enforced by a
dedicated fitness rule, alongside the layer and transport rules (ADR-015) that guard the same boundary
from the layer side. The remaining implementation point is exactly the honesty above: a purity rule no
framework type exercises yet, and half of the snapshot gate that by design can only run in the repos
that own the concrete API surface.

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
survive a transport change, how MMCA.Common maps `ErrorType` to status through a single frozen table
reused by `ApiControllerBase.HandleFailure` over HTTP and `GrpcResultExceptionInterceptor` over gRPC,
how a guard closes the 200-with-error-body trap, and how §9 keeps that contract honest (a committed
OpenAPI baseline the framework's own build diffs, consumer hosts snapshotting their concrete surface,
and a dedicated `[ServiceContract]` purity rule waiting on the first marked type).

**Next in the series:** notifications as a vertical slice, the one concrete bounded context the
framework ships, across push, in-app inbox, and email.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the §9 scorecard entry (gaps
included), or `dotnet add package MMCA.Common.API` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- The full 34-category scorecard, §9 included, lives in `Website/docs-src/governance/common-ArchitectureScorecard.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, gRPC, API Design*

*Notes: verified type/behavior names: `Result<T>`/`Error`/`ErrorType`, `ApiControllerBase.HandleFailure`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:35`, whose doc at
`:22-30` records that the status belongs to the most severe `ErrorType` present and not the first
error's, ranking `Unexpected` 500 > `Unauthorized` 401 > `Forbidden` 403 > `Conflict` 409 > `NotFound`
404 > `UnprocessableEntity` 422 > `Invariant`/`Validation`/`Failure` 400 with ties keeping the earliest
error; implemented at `:47-48` via `ErrorHttpMapping.GetStatusCode(errorList)`), `ErrorHttpMapping`
(the nine-entry `FrozenDictionary<ErrorType, int>` at
`MMCA.Common/Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:20-31`, including
`[ErrorType.Unexpected] = StatusCodes.Status500InternalServerError` at `:30`, exactly as the article's
table renders it; the list overload at `:50-51` delegates the ranking to `ErrorTypeSeverity.MostSevere`,
which lives in `MMCA.Common.Shared` so the gRPC edge classifies the same aggregate identically), the
exception-handler chain
(`OperationCanceledExceptionHandler` 499, `DomainExceptionHandler` 400, `DbUpdateExceptionHandler` 409,
`ValidationExceptionHandler` 400, `GlobalExceptionHandler` 500), `UnhandledResultFailureFilter`
(200-with-error-body guard), `DisabledFeatureHandler` (404), `X-Pagination` header, header versioning,
`GrpcResultExceptionInterceptor`, `result.ThrowIfFailure()`, `ResultFailureException`,
`errors.ToRpcException()` (FrozenDictionary<ErrorType, StatusCode> mirroring the HTTP table). Transport
symmetry is symmetric in ownership too: encoder and decoder both ship in
`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/ResultGrpcExtensions.cs`. `ToRpcException()` at
`:113` ranks by `ErrorTypeSeverity.MostSevere` (`:117`, documented at `:102-108` as the same ranking the
HTTP edge uses) and writes the `error-{i}-code/-message/-type` trailers at `:125-131`;
`Metadata.ToErrors()` at `:165` decodes them back, documented at `:155-158` as the encoder's inverse
with an unrecognized `error-{i}-type` falling back to `ErrorType.Failure` so a newer peer cannot break
an older client; `RpcException.ToResult()` at `:210` and `ToResult<T>()` at `:234` rebuild
`Result.Failure(errors)`, and a trailer-less transport fault degrades to a single `Failure` error coded
`Grpc.{StatusCode}` through `TransportError` at `:285-289`. The consumer-owned `GrpcErrorTrailerParser`
an earlier pass documented is gone from MMCA.ADC: both adapters call the framework decoder
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Contracts/SessionBookmarkValidationServiceGrpcAdapter.cs:53,58,79,85`
and `EventLiveValidationServiceGrpcAdapter.cs:56,61,89,94,118,123,150,155`), and their class remarks
(`:20` and `:21` respectively) name "the framework's own `RpcException.ToResult` decoder". Scorecard evidence,
re-verified at source: the "API & Contract Design" row is
`Website/docs-src/governance/common-ArchitectureScorecard.md:89` (weight 2, Maturity 4, Implementation
9, weighted 8/18); line 87 in that file is row 7, Microservices Readiness, and line 79 is the table
header. OpenAPI generation ships: `AddCommonOpenApi()` => `services.AddApiVersioning().AddOpenApi()`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:493,495`);
`MapCommonOpenApi()` serves `/openapi/v1.json` outside Production
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/Endpoints/OpenApiEndpointExtensions.cs:34`)
plus the opt-in `MapCommonScalarUi()` (same file, `:52`).*

*Notes (2026-08-22 refresh, MMCA.Common PR #271, squash `8a6c603`; anchors re-verified 2026-09-19, and
line numbers not re-read this pass were dropped rather than carried): the "Trade-offs, honestly" section,
takeaway 5 and the "What we covered" paragraph were rewritten after two in-repo contract-surface fitness
checks landed on `main`. (1) The OpenAPI baseline gate:
`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/OpenApi/OpenApiBaselineTests.cs` boots
`OpenApiProbeHost.CreateAsync` (`.../OpenApi/OpenApiProbeHost.cs:28`, a real `WebApplication` on
`UseTestServer` with `AddCommonApiVersioning()` + `AddCommonOpenApi()` at `:40` and
`MapCommonOpenApi()` at `:60`, the registration path recorded in its class doc at `:16`), fetches
`/openapi/v1.json`, normalizes it (volatile root `servers` dropped, object properties ordered ordinally,
array order kept) and asserts equality against the committed
`.../OpenApi/openapi-baseline.v1.json`; deliberate regeneration is
`MMCA_UPDATE_OPENAPI_BASELINE=1`, and the probe controllers stand in for a consumer's controllers so
the gate guards framework document generation while consumer hosts keep their own contract-snapshot
tests. (2) The `[ServiceContract]` purity rule: `ArchitectureRules.ServiceContractsDoNotDependOnServiceInternals`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Contracts/ArchitectureRules.Contracts.cs:32`;
the partial class moved under `Rules/Contracts/` since the previous pass), asserted through
`ArchitectureAssert.NoViolations`, which names the failing types; surfaced by
`ServiceContractPurityTestsBase`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/ServiceContractPurityTestsBase.cs`,
whose remarks record the attribute-driven-not-layer-driven choice and the vacuous-pass case) and
subclassed at
`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Layering/ServiceContractPurityTests.cs`.
`ServiceContractAttribute`'s doc comment
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Abstractions/ServiceContractAttribute.cs`) states the
invariant is enforced by the dedicated rule alongside the ADR-015 transport/layer rules, and that the
attribute is an adoptable marker MMCA.Common applies to no type. Not described in the body: the same
partial class carries a second contract rule, `ServiceContractImplementationsAreNotPublic`
(`Rules/Contracts/ArchitectureRules.Contracts.cs:81`), alongside a
`Bases/Contracts/ContractImplementationTestsBase.cs`, so the `[ServiceContract]` rule surface is a pair
of rules rather than the single purity rule the body names. Scorecard: the Section 9 numbers in the body
(Maturity 4 of 4, Implementation 9 of 10, weighted 8/18) match
`common-ArchitectureScorecard.md:89` on disk today, so the earlier "re-check once the Website PR merges"
caveat is closed. The `ErrorHttpMapping` and severity-ranking code fence changed in the 2026-09-19
refresh, so `Tools/Scripts/sync-medium-fences.ps1 -Verify` was re-run.*

- Full series index: https://ivanball.github.io/writing.html
