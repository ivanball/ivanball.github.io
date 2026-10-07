# ADR-046: HTTP API Versioning Strategy

## Status
Accepted (2026-07-15). Revised 2026-08-01 (anonymity is granted by each per-service subclass, not by
`ServiceInfoControllerBase`; corrected the ADR-034 cross-reference, which puts the class-level
attributes on its own generic base rather than noting a non-inheritance caveat; refreshed the
`AddCommonApiVersioning` call-site lines in the ADC Conference/Identity and Store Catalog hosts).
Amended 2026-08-12 (v1.146.0): the registration also guards OpenAPI generation against an unbound route
token, which a URL-segment-versioned host would otherwise trip on.
Revised 2026-08-14 (the registration never sets `DefaultApiVersion`: `1.0` comes from the
`Asp.Versioning` library default and the omission is deliberate).
Revised 2026-09-11 (re-anchored the registration, explorer, OpenAPI and host call-site citations,
which have since moved; corrected the OpenAPI trade-off: `AddCommonOpenApi` plus
`MapCommonOpenApi().WithDocumentPerVersion()` resolve one document per discovered API version rather
than a single `v1` document).
Revised 2026-09-22 (MMCA.ADC commits a build-time OpenAPI document per service host, gated in CI; see the Revision below).
Revised 2026-09-25 (MMCA.Store adopts the same committed-document gate, so both consumers carry it;
re-anchored the host call-site citations; see the Revision (2026-09-25) below).
Revised 2026-10-01 for v1.217.0 (the host registers the single `v1` OpenAPI document itself and
`AddCommonOpenApi` only configures it; per-version documents are gone; see the Revision (2026-10-01,
v1.217.0) below).
Revised 2026-10-06: the registration also adds `ApiVersionReportingResultFilter` as a global MVC filter so output-cached responses keep the version headers; re-anchored the citations.
Revised 2026-10-07: anchors re-verified against current source after the v1.233.0 release, no decision change.

## Context
The framework's REST surface is served by controllers hosted in extracted service processes behind a
YARP gateway. As those services evolve, a response shape has to be able to change without breaking a
client still coded against the old shape. HTTP APIs need a versioning axis of their own: one that a
caller selects per request and that the service can advertise and deprecate over time. This is a
different concern from how asynchronous integration events evolve on the wire (ADR-010): that axis is
resolved by consumers from a `SchemaVersion` carried in the serialized event, never chosen by a
caller. The HTTP axis is request-time, client-selected, and reported back in response headers.

Without a shared decision, each host would wire `Asp.Versioning` differently (URL-segment vs. query
vs. header, different default-version behavior, inconsistent deprecation reporting), and there would
be no proof that the machinery actually works past a single version. A "we support versioning"
claim that only ever ships `v1.0` is untestable and erodes silently.

## Decision
Standardize one header-based API-versioning setup in `MMCA.Common.API`, adopt it in every service
host through a single registration call, and keep it exercised by a shared fitness contract that
proves two live versions coexist.

- **One registration wires the whole policy.** `AddCommonApiVersioning`
  (`Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:39`) deliberately
  does **not** set `DefaultApiVersion`: `1.0` is already the `Asp.Versioning` library default, and the
  API explorer inherits both it and `AssumeDefaultVersionWhenUnspecified` from the versioning options,
  so restating either one trips AV0011/AV0024. The code comment recording that omission is at
  `WebApplicationBuilderExtensions.cs:41`-`WebApplicationBuilderExtensions.cs:43`. What the registration does set: it assumes the default
  version when a caller sends no header
  (`AssumeDefaultVersionWhenUnspecified = true`, `WebApplicationBuilderExtensions.cs:46`), reports
  the supported/deprecated versions on every response (`ReportApiVersions = true`,
  `WebApplicationBuilderExtensions.cs:47`), and selects the version from an `api-version` request
  header (`new HeaderApiVersionReader("api-version")`, `WebApplicationBuilderExtensions.cs:48`). The
  reader is header-based deliberately: routes and query strings stay version-free, so a caller opts
  into a newer shape by adding one header rather than changing the URL. The same call also adds
  `ApiVersionReportingResultFilter` as a global MVC filter (`WebApplicationBuilderExtensions.cs:60`,
  class at `Source/Presentation/MMCA.Common.API/Caching/ApiVersionReportingResultFilter.cs:21`), which
  reports the version headers ahead of the response body so an output-cache entry stores them and a
  cache hit still carries `api-supported-versions` (comment at `WebApplicationBuilderExtensions.cs:58`-`:59`).
- **The API explorer is wired for versioned OpenAPI.** The same call chains `.AddMvc()` then
  `.AddApiExplorer` (`WebApplicationBuilderExtensions.cs:49`,
  `WebApplicationBuilderExtensions.cs:50`), formatting version groups as `'v'VVV`
  (`WebApplicationBuilderExtensions.cs:52`) and substituting the version into the URL where a host
  routes one (`SubstituteApiVersionInUrl = true`, `WebApplicationBuilderExtensions.cs:53`). The
  explorer's default-version behavior is inherited rather than configured, exactly as the comment
  above it records (`WebApplicationBuilderExtensions.cs:41`-`WebApplicationBuilderExtensions.cs:43`). The
  explorer feeds the controllers' API descriptions to the OpenAPI generator; it does not name the
  documents. Since v1.217.0 each host registers the single `v1` document itself with ASP.NET Core's
  `services.AddOpenApi()`, and `AddCommonOpenApi`
  (`WebApplicationBuilderExtensions.cs:101`, contract in the doc comment at `:87`-`:100`) registers no
  document: it configures every document the host registered. `MapCommonOpenApi` serves it at
  `/openapi/v1.json` outside Production only
  (`Source/Presentation/MMCA.Common.API/Startup/Endpoints/OpenApiEndpointExtensions.cs:60`, guarded at
  `OpenApiEndpointExtensions.cs:62`, mapped `.AllowAnonymous()` at `OpenApiEndpointExtensions.cs:74`),
  and fails at startup when the host registered no `v1` document (`OpenApiEndpointExtensions.cs:64`-`:72`).
  Why the host must keep the call: see the Revision (2026-10-01, v1.217.0).
- **A shipped exemplar proves two versions coexist.** `ServiceInfoControllerBase`
  (`Source/Presentation/MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:30`) serves the same
  `/ServiceInfo` route under two versions selected by the header: `GetV1` is mapped to `1.0`
  (`[MapToApiVersion("1.0")]`, `ServiceInfoControllerBase.cs:40`) and returns the minimal
  `ServiceInfoResponse` shape (`ServiceInfoControllerBase.cs:51`); `GetV2` is mapped to `2.0`
  (`[MapToApiVersion("2.0")]`, `ServiceInfoControllerBase.cs:46`) and returns the evolved
  `ServiceInfoV2Response`, a superset that also advertises the supported and deprecated version lists
  (`ServiceInfoControllerBase.cs:54`). The base is read-only: both actions are `[HttpGet]`
  (`ServiceInfoControllerBase.cs:39`, `ServiceInfoControllerBase.cs:45`) and it declares no write verb.
  Anonymity is not carried by the base; each sealed subclass grants it with `[AllowAnonymous]`
  (ADC's `ServiceInfoController.cs:17`, Store's `ServiceInfoController.cs:17`).
- **The class-level version attributes live on the per-service subclass.** Class-level
  routing/versioning attributes are not reliably inherited, so each host supplies a sealed subclass
  carrying them. ADC's `ServiceInfoController` declares `[ApiVersion("1.0", Deprecated = true)]` and
  `[ApiVersion("2.0")]` and sets the service name to `"Conference"`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ServiceInfoController.cs:18`,
  `ServiceInfoController.cs:19`, `ServiceInfoController.cs:23`); Store's mirror sets `"Catalog"`
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/Controllers/ServiceInfoController.cs:18`,
  `ServiceInfoController.cs:23`). `1.0` is declared deprecated so the deprecation-reporting path is
  live rather than theoretical.
- **A shared fitness contract keeps the machinery exercised.**
  `ServiceInfoVersioningContractTestsBase<TFixture>`
  (`Source/Hosting/MMCA.Common.Testing/Conformance/ServiceInfoVersioningContractTestsBase.cs:20`) sends
  `api-version: 1.0` and `2.0` over the real host and asserts the v1.0 minimal shape carries an
  `api-deprecated-versions` header (`ServiceInfoVersioningContractTestsBase.cs:39`) while the v2.0
  evolved shape carries `api-supported-versions` (`ServiceInfoVersioningContractTestsBase.cs:55`).
  Because the controller ships in `MMCA.Common.API`, the whole test body is identical across repos:
  each consumer's subclass supplies only its fixture (for example ADC's `ApiVersioningTests`,
  `MMCA.ADC/Tests/Integration/MMCA.ADC.Conference.IntegrationTests/Contract/ApiVersioningTests.cs:14`,
  and Store's equivalent at
  `MMCA.Store/Tests/Integration/MMCA.Store.Catalog.IntegrationTests/Contract/ApiVersioningTests.cs`).
  This is the rubric SS9 fitness check: without a second working version, everything above would be
  asserted rather than proven.
- **The registration also backfills missing API-parameter descriptors** (added in v1.146.0). MVC leaves
  `ApiParameterDescription.ParameterDescriptor` null for a route token with no matching action
  parameter, and `Asp.Versioning.OpenApi` dereferences it without a null check, so a host that routes
  `api/v{version:apiVersion}/...` returned a 500 from `GET /openapi/{documentName}.json`. Both
  `AddCommonApiVersioning` and `AddCommonOpenApi` now register `ApiParameterDescriptorBackfillProvider`
  (`Source/Presentation/MMCA.Common.API/OpenApi/ApiParameterDescriptorBackfillProvider.cs`), an
  `IApiDescriptionProvider` that runs last and fills a placeholder wherever one is missing, never
  replacing an existing descriptor. The guard is deliberately general, because it is the token being
  unbound rather than the versioning that produces the null: an unbound `{tenant}` or `{region}` fails
  identically. It goes inert once the upstream null check lands. The header-based reader above means no
  current host was affected either way, which is precisely why the failure could ship unnoticed.
  Since v1.217.0 MMCA.Common no longer references `Asp.Versioning.OpenApi`; the guard stays because it
  costs nothing and still protects any other consumer of the API descriptions from the same null.
- **Every REST host adopts it the same way.** The extracted services call `AddCommonApiVersioning`
  in their startup: ADC's Conference
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:219`) and Identity
  (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:154`) hosts, Store's Catalog host
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:140`), and the same call is made
  by the other extracted hosts (ADC Engagement `Program.cs:150`, ADC Notification `Program.cs:139`,
  Store Sales `Program.cs:147`, Store Identity `Program.cs:134`) and by the monolith reference host
  (`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:35`).

Application controllers beyond `ServiceInfo` declare `[ApiVersion("1.0")]` today: the second version
exists on the discovery endpoint to keep the versioning path honest, not because any business
resource has yet needed to evolve its shape.

## Rationale
- **Header selection keeps URLs stable.** Routing stays version-free, so gateway route maps, client
  URL builders, and OpenAPI paths do not fork per version; a caller opts into a newer shape with one
  header.
- **Assume-default keeps existing callers working.** `AssumeDefaultVersionWhenUnspecified` means a
  client that never sends the header keeps getting `1.0`, so introducing versioning was not a
  breaking change for any existing caller.
- **Report-and-deprecate makes evolution visible.** `ReportApiVersions` plus a deprecated `1.0`
  means a client can see, from response headers alone, which versions a service still supports and
  which are on the way out, without reading a changelog.
- **A living exemplar beats a claim.** A single-version API cannot demonstrate that its versioning
  works. Shipping `ServiceInfo` with a real, deprecated `1.0` alongside `2.0` gives the fitness
  contract something concrete to assert, the same invariant-over-discipline posture the framework
  prefers (ADR-015).
- **Define once, adopt everywhere.** Putting the whole policy behind `AddCommonApiVersioning` and the
  exemplar behind `ServiceInfoControllerBase` means every host is versioned identically by one call
  and one subclass, so the reader/default/reporting choices cannot drift apart between services.

## Trade-offs
- **The class-level version attributes are not inherited.** Each per-service subclass must repeat the
  `[ApiVersion(...)]` and routing attributes (the same inheritance caveat ADR-036 records for ADC's
  sealed `OAuthController`); the shared behavior lives in the base, but the attributes do not.
- **Adoption is per host.** A new REST host that forgets `AddCommonApiVersioning` gets no versioning
  and no reported versions, the same audit-the-inventory caveat other opt-in framework registrations
  carry; the shared fitness contract only guards a host once its subclass is added.
- **Header versioning is less discoverable than a URL segment.** A version chosen by header does not
  show up in a copied URL or a browser address bar, so the version in play is only visible to a
  caller that reads request/response headers.
- **The OpenAPI document is dev/CI only, and there is one: `v1`.** `MapCommonOpenApi` is a no-op
  in Production (`OpenApiEndpointExtensions.cs:62`), so the machine-readable contract is an internal
  dev/CI artifact rather than a public production surface. Since v1.217.0 each host registers only the
  `v1` document, so a version a controller adds beyond `1.0` (today only the `2.0` `ServiceInfo`
  action) is served and exercised by the fitness contract above but appears in no generated document.
  The framework baseline and each consumer's contract test fetch `/openapi/v1.json`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/OpenApi/OpenApiBaselineTests.cs`,
  `Source/Hosting/MMCA.Common.Testing/Conformance/OpenApiContractTestsBase.cs:31`). A host that later
  needs a second documented version registers a second document itself; the framework no longer
  generates one per version.

## Revision (2026-09-22): the consumer contract is a committed artifact

The trade-off above described the OpenAPI document as a dev/CI artifact that nothing outside a
running host could diff. MMCA.ADC now writes it to disk at build time. `MMCA.ADC/Directory.Build.props`
gives every `*.Service` host the `MmcaGenerateOpenApiDocument` target, which runs the ASP.NET Core
document generator (`Microsoft.Extensions.ApiDescription.Server`) against the built assembly under a
design-time environment: the Development configuration plus a placeholder JWT authority, so the host
builds without a database or an Identity peer and is never started to serve a request. The output is
`Source/Services/<host>/openapi/<host>.json`, and the four documents are committed. The `OpenAPI
documents are current` step in `MMCA.ADC/.github/workflows/deploy.yml` runs after the build and fails
the PR when a document changed without being committed, so a route, parameter, status code or
response-shape change is a reviewable diff in the PR that caused it. Generation was verified
byte-identical across runs before the files were committed. The package's own build hook stays off
because it cannot carry the design-time environment, and `dotnet publish` skips the target, so the
container builds do not run it.

The framework side is unchanged: `OpenApiContractTestsBase` still asserts the live document, and the
committed file is the consumer's artifact, produced by the consumer's build. The gate is not a
framework primitive: each consumer carries its own copy of the target and the CI step, and both
consumers now do (see the 2026-09-25 revision).

## Revision (2026-09-25): both consumers commit and gate their OpenAPI documents

MMCA.Store now carries the same gate, so the committed contract is a property of both consumers
rather than of MMCA.ADC alone. Each repo's `Directory.Build.props` references
`Microsoft.Extensions.ApiDescription.Server` (`MMCA.ADC/Directory.Build.props:172`,
`MMCA.Store/Directory.Build.props:176`), switches the package's own build hook off
(`MMCA.Store/Directory.Build.props:186`), and defines the `MmcaGenerateOpenApiDocument` target
(`MMCA.ADC/Directory.Build.props:200`, `MMCA.Store/Directory.Build.props:207`), which writes
`Source/Services/<host>/openapi/<host>.json` after each `*.Service` build under the design-time
environment. Store's design-time environment also switches off the background work its hosts start
(payment reconciliation and the two backfills, `MMCA.Store/Directory.Build.props:221`), because
document generation starts the host. Every service `Program.cs` skips the schema initializer when
`MmcaOpenApiDesignTime` is set in Development: ADC Conference `:438`, Engagement `:315`, Identity
`:343`, Notification `:262`; Store Catalog `:313`, Sales `:297`, Identity `:297`.

ADC commits four documents and Store commits three
(`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/openapi/MMCA.Store.Catalog.Service.json`,
`MMCA.Store.Sales.Service/openapi/MMCA.Store.Sales.Service.json`,
`MMCA.Store.Identity.Service/openapi/MMCA.Store.Identity.Service.json`). Each repo's `deploy.yml`
runs an `OpenAPI documents are current` step in `build-and-test` after the Release build
(`MMCA.ADC/.github/workflows/deploy.yml:297`, `MMCA.Store/.github/workflows/deploy.yml:232`): it fails
when the committed count differs from the host count (Store `:241-243`) or when
`git diff --exit-code` finds a regenerated document (ADC `:309`, Store `:245`), and uploads the
regenerated set on a mismatch (ADC `:314`, Store `:250`).

## Revision (2026-10-01)

No decision or rationale changed. Re-anchored the citations in Decision, Trade-offs and Related, which
had moved: `AddCommonApiVersioning` and its options (`WebApplicationBuilderExtensions.cs:37`-`:51`),
`AddCommonOpenApi` (`WebApplicationBuilderExtensions.cs:91`, `:93`, doc comment `:82`-`:84`),
`MapCommonOpenApi` (`OpenApiEndpointExtensions.cs:42`, `:44`, `:46`), the host call sites (ADC
Conference `:218`, Identity `:149`, Engagement `:146`, Notification `:138`; Store Catalog `:139`, Sales
`:146`, Identity `:133`) and `EntityControllerBase.cs:31-33`. The Decision now records that the
document endpoint is mapped `.AllowAnonymous()` (`OpenApiEndpointExtensions.cs:46`). Two details in the
2026-09-25 revision are left as recorded: the design-time schema-initializer skip now runs through the
framework helper `InitializeDatabaseUnlessDesignTimeAsync`
(`Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:144`, check at
`:151`), which each service `Program.cs` calls, and ADC's `OpenAPI documents are current` step
(`MMCA.ADC/.github/workflows/deploy.yml:305`) also checks the committed count (`:314`).

## Revision (2026-10-01, v1.217.0): the host registers the OpenAPI document

**What changed.** `AddCommonOpenApi` used to register the documents itself through the versioning
builder (`AddApiVersioning().AddOpenApi()`, one document per discovered API version), and
`MapCommonOpenApi` mapped them with `.WithDocumentPerVersion()`. Both ADC and Store therefore kept
their own `services.AddOpenApi()` plus a hand-written `MapOpenApi().AllowAnonymous()` instead of the
framework pair. Switching a host to the framework pair changed its committed document: across ADC's four
hosts 134 operation summaries disappeared, `info.title` became `GetDocument.Insider | v1`, `info.version` went
from `1.0.0` to `1.0`, every `api-version` header gained `enum: ["1.0"]`, and an extra `v2` document
appeared.

**Why.** The .NET 10 OpenAPI XML-comment source generator attaches a project's controller summaries by
intercepting the `AddOpenApi` call sites of the project being compiled. A registration made inside the
framework assembly is never intercepted, so the host's summaries were lost. The versioning
registration's own transformers produced the title, version, enum and extra-document differences.

**Decision now (MMCA.Common #465).** The host keeps the `services.AddOpenApi()` call in its own
project; `AddCommonOpenApi` (`WebApplicationBuilderExtensions.cs:95`) only configures the registered
documents (the ADR-115 strongly-typed-identifier transformers, `:102`-`:106`, and the parameter
backfill guard); `MapCommonOpenApi` maps the plain `v1` document and throws when none was registered.
`Asp.Versioning.OpenApi` is no longer a dependency. Its analyzer rule AV0030 still fires on the plain
mapping (the rule ships with the versioning packages Common keeps) and is suppressed at that one
declaration as a false positive (`OpenApiEndpointExtensions.cs:56`-`:59`). Every ADC and Store service
host now registers as `services.AddOpenApi(); services.AddCommonOpenApi();` and maps with
`app.MapCommonOpenApi()` (ADC Conference `Program.cs:317`, `:318`, `:451`; Engagement `:165`, `:166`,
`:327`; Identity `:177`, `:178`, `:352`; Notification `:148`, `:149`, `:269`; Store Catalog `:193`,
`:194`, `:322`; Sales `:167`, `:168`, `:306`; Identity `:154`, `:155`, `:306`; adopted in ADC #234 and
Store #179). The swap left all seven committed documents byte-identical in content, which is the
acceptance test the change was held to. `AddCommonOpenApiHostRegistrationTests` pins the contract in
the framework.

## Revision (2026-10-06)

- The Decision now records that `AddCommonApiVersioning` also registers `ApiVersionReportingResultFilter`
  as a global MVC filter (`WebApplicationBuilderExtensions.cs:60`; class at
  `Caching/ApiVersionReportingResultFilter.cs:21`), so version headers are written before the body and
  an output-cache hit still carries them. No decision or rationale changed.
- Current locations of facts recorded in earlier revisions: `AddCommonOpenApi` is at
  `WebApplicationBuilderExtensions.cs:101` with its transformers at `:105`-`:112`; the host
  registrations (`AddOpenApi`, `AddCommonOpenApi`, `MapCommonOpenApi`) are ADC Conference `:319`,
  `:320`, `:453`; Engagement `:168`, `:169`, `:331`; Identity `:182`, `:183`, `:363`; Notification
  `:155`, `:156`, `:276`; Store Catalog `:193`, `:194`, `:327`; Sales `:167`, `:168`, `:306`; Identity
  `:154`, `:155`, `:306`. The design-time skip helper `InitializeDatabaseUnlessDesignTimeAsync` is
  declared at `DatabaseInitializationExtensions.cs:146` with its check at `:153`, called from ADC
  Conference `Program.cs:443`, Engagement `:321`, Identity `:353`, Notification `:266`; Store Catalog
  `:317`, Sales `:296`, Identity `:296`. The `OpenAPI documents are current` step is at
  `MMCA.ADC/.github/workflows/deploy.yml:305` (count check `:313`-`:315`, diff `:317`, upload `:322`)
  and `MMCA.Store/.github/workflows/deploy.yml:290` (count check `:299`-`:301`, diff `:303`, upload
  `:308`).
- Anchors in Decision, Trade-offs and Related were re-verified against current source.

## Revision (2026-10-07)

Re-verified against current source. No decision, rationale or trade-off changed, and every anchor in
Decision, Trade-offs and Related still resolves. Line numbers cited inside the earlier dated
revisions (host registrations, the design-time skip helper, both `deploy.yml` gates and both
`Directory.Build.props` blocks) have since moved and are left as recorded.

1. Anchors re-verified against current source: `AddCommonApiVersioning`
   (`WebApplicationBuilderExtensions.cs:39`, comment `:41`-`:43`, options `:46`-`:48`, explorer
   `:49`-`:53`, result filter `:58`-`:60`), `AddCommonOpenApi` (`WebApplicationBuilderExtensions.cs:101`,
   doc comment `:87`-`:100`), `MapCommonOpenApi` (`OpenApiEndpointExtensions.cs:60`, guard `:62`, throw
   `:64`-`:72`, `.AllowAnonymous()` `:74`), `ApiVersionReportingResultFilter.cs:21`,
   `ServiceInfoControllerBase.cs:30`, `:39`, `:40`, `:45`, `:46`, `:51`, `:54`, both subclasses
   (`ServiceInfoController.cs:17`, `:18`, `:19`, `:23` in ADC Conference and Store Catalog),
   `ServiceInfoVersioningContractTestsBase.cs:20`, `:39`, `:55`, `ApiVersioningTests.cs:14`,
   `OpenApiContractTestsBase.cs:31`, `EntityControllerBase.cs:31-33`, and the `AddCommonApiVersioning`
   host call sites (ADC Conference `Program.cs:219`, Identity `:154`, Engagement `:150`, Notification
   `:139`; Store Catalog `:140`, Sales `:147`, Identity `:134`; Helpdesk Web `Program.cs:35`).

## Related
ADR-010 (integration-event schema versioning: the asynchronous, `SchemaVersion`-carried,
consumer-resolved axis this deliberately contrasts with; HTTP versioning here is request-time and
client-selected), ADR-015 (the fitness-function approach that
`ServiceInfoVersioningContractTestsBase` embodies, keeping the versioning machinery exercised rather
than asserted), ADR-036 (the other controller-convention decision that records the same class-level
`[ApiVersion]` non-inheritance, handled there by ADC's sealed `OAuthController` subclass), ADR-034
(the generic entity controller bases, which take the opposite shape: `[ApiController]` /
`[Route("[controller]")]` / `[ApiVersion("1.0")]` sit on the generic base itself,
`EntityControllerBase.cs:31-33`).
