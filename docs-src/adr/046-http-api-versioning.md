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
  (`Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:334`) deliberately
  does **not** set `DefaultApiVersion`: `1.0` is already the `Asp.Versioning` library default, and the
  API explorer inherits both it and `AssumeDefaultVersionWhenUnspecified` from the versioning options,
  so restating either one trips AV0011/AV0024. The code comment recording that omission is at
  `WebApplicationBuilderExtensions.cs:336`-`WebApplicationBuilderExtensions.cs:338`. What the registration does set: it assumes the default
  version when a caller sends no header
  (`AssumeDefaultVersionWhenUnspecified = true`, `WebApplicationBuilderExtensions.cs:341`), reports
  the supported/deprecated versions on every response (`ReportApiVersions = true`,
  `WebApplicationBuilderExtensions.cs:342`), and selects the version from an `api-version` request
  header (`new HeaderApiVersionReader("api-version")`, `WebApplicationBuilderExtensions.cs:343`). The
  reader is header-based deliberately: routes and query strings stay version-free, so a caller opts
  into a newer shape by adding one header rather than changing the URL.
- **The API explorer is wired for versioned OpenAPI.** The same call chains `.AddMvc()` then
  `.AddApiExplorer` (`WebApplicationBuilderExtensions.cs:344`,
  `WebApplicationBuilderExtensions.cs:345`), formatting version groups as `'v'VVV`
  (`WebApplicationBuilderExtensions.cs:347`) and substituting the version into the URL where a host
  routes one (`SubstituteApiVersionInUrl = true`, `WebApplicationBuilderExtensions.cs:348`). The
  explorer's default-version behavior is inherited rather than configured, exactly as the comment
  above it records (`WebApplicationBuilderExtensions.cs:336`-`WebApplicationBuilderExtensions.cs:338`). That
  group format names the OpenAPI documents `AddCommonOpenApi` registers through the versioning
  builder (`WebApplicationBuilderExtensions.cs:493`, `WebApplicationBuilderExtensions.cs:495`), one
  per discovered API version (`WebApplicationBuilderExtensions.cs:484`-`WebApplicationBuilderExtensions.cs:486`,
  so `1.0` is the `v1` document). `MapCommonOpenApi` serves them at `/openapi/{documentName}.json`
  outside Production only
  (`Source/Presentation/MMCA.Common.API/Startup/Endpoints/OpenApiEndpointExtensions.cs:34`, guarded at
  `OpenApiEndpointExtensions.cs:36`, mapped with `.WithDocumentPerVersion()` at
  `OpenApiEndpointExtensions.cs:38`).
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
- **Every REST host adopts it the same way.** The extracted services call `AddCommonApiVersioning`
  in their startup: ADC's Conference
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:220`) and Identity
  (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:152`) hosts, Store's Catalog host
  (`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:142`), and the same call is made
  by the other extracted hosts (ADC Engagement `Program.cs:148`, ADC Notification `Program.cs:140`,
  Store Sales `Program.cs:149`, Store Identity `Program.cs:136`) and by the monolith reference host
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
- **The OpenAPI documents are dev/CI only, and only `v1` is pinned.** `MapCommonOpenApi` is a no-op
  in Production (`OpenApiEndpointExtensions.cs:36`), so the machine-readable contract is an internal
  dev/CI artifact rather than a public production surface. The route resolves one document per
  discovered API version (`.WithDocumentPerVersion()`, `OpenApiEndpointExtensions.cs:38`), but
  nothing asserts the generated document set: the framework baseline fetches only `/openapi/v1.json`
  (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/OpenApi/OpenApiBaselineTests.cs:54`), as does
  each consumer's contract test through the shared default
  (`Source/Hosting/MMCA.Common.Testing/Conformance/OpenApiContractTestsBase.cs:31`), so what a host
  declaring `2.0` publishes under `v2` is generated by convention and left unasserted.

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

## Related
ADR-010 (integration-event schema versioning: the asynchronous, `SchemaVersion`-carried,
consumer-resolved axis this deliberately contrasts with; HTTP versioning here is request-time and
client-selected), ADR-015 (the fitness-function approach that
`ServiceInfoVersioningContractTestsBase` embodies, keeping the versioning machinery exercised rather
than asserted), ADR-036 (the other controller-convention decision that records the same class-level
`[ApiVersion]` non-inheritance, handled there by ADC's sealed `OAuthController` subclass), ADR-034
(the generic entity controller bases, which take the opposite shape: `[ApiController]` /
`[Route("[controller]")]` / `[ApiVersion("1.0")]` sit on the generic base itself,
`EntityControllerBase.cs:33-35`).
