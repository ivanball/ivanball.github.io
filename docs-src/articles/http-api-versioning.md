# HTTP API versioning, proven not just claimed

> Series: MMCA.Common · Article #44 · P2/P3 · Group G12,G13 · Rubric §9 · ADR-046 ·
> Status: grounded in `Website/docs-src/adr/046-http-api-versioning.md`,
> `WebApplicationBuilderExtensions.cs` (`AddCommonApiVersioning`), `OpenApiEndpointExtensions.cs`
> (`MapCommonOpenApi`), `ServiceInfoControllerBase.cs`, `ServiceInfoVersioningContractTestsBase.cs`, and
> the per-host `ServiceInfoController` subclasses in ADC and Store. No em dashes.

**Subtitle:** Most APIs "support versioning" by shipping v1.0 and never a second version. Here is a
header-based setup that introduces versioning without breaking a single caller, and a fitness contract
that proves two live versions coexist instead of asserting they could.

---

Here is a claim that sounds responsible and is almost always untestable:

> "Our API supports versioning."

Open the code and you find `Asp.Versioning` wired up, a default of `1.0`, and exactly one version
ever shipped. The machinery is configured. Whether it actually works past a single version has never
been exercised, because there is no second version to exercise it against. The first time someone
needs to evolve a response shape, they discover the reader was set to a URL segment nobody's client
builder expected, or that the default-version behavior quietly breaks every caller that never sent a
version, or that deprecation was never reported anywhere a client could see it.

A versioning story you cannot demonstrate is a versioning story that erodes silently. It reads as done
in a design doc and fails in the first real evolution.

There is a second trap next to the first. If you reach for versioning by forking the route (`/v1/...`
and `/v2/...`), every URL, every gateway route map, every client URL builder, and every OpenAPI path
now has a version baked into it. The version is not a property of the request. It is a property of the
string, copied everywhere, and it forks the whole surface the moment you add a second one.

## Why it matters

HTTP APIs need a versioning axis of their own: one the caller selects per request, that the service
can advertise, and that it can deprecate over time. In a framework whose thesis is "monolith now,
services later, no rewrite," that axis carries extra weight. A module served in-process today becomes
a service behind a YARP gateway tomorrow, and as it evolves a response shape has to be able to change
without breaking a client still coded against the old shape (ADR-046).

This is a different concern from how asynchronous integration events evolve on the wire. That axis
(ADR-010) is resolved by consumers from a `SchemaVersion` carried inside the serialized event, and it
is never chosen by a caller. The HTTP axis is the opposite: request-time, client-selected, and
reported back in response headers. Conflating the two is how teams end up with one mechanism doing
neither job well.

And without a shared decision, every host wires it differently: URL segment here, query string there,
a different default-version behavior in each service, inconsistent deprecation reporting. The reader,
the default, and the reporting choices drift apart between services that are supposed to look like one
API behind a gateway.

## The MMCA answer: one registration, one exemplar, one fitness contract

MMCA.Common standardizes a single header-based setup in `MMCA.Common.API`, adopts it in every service
host through one call, and keeps it exercised by a shared contract test that proves two live versions
coexist.

**One registration wires the whole policy.** `AddCommonApiVersioning`
(`WebApplicationBuilderExtensions.cs:39`) is the entire decision, in one place: the reader, the
default behavior, the reporting (and the filter that keeps it intact through the output cache), and the
one guard that keeps document generation from tripping over any of it.

```csharp
public IServiceCollection AddCommonApiVersioning()
{
    // DefaultApiVersion is deliberately not set: 1.0 is already the framework default, and the API
    // explorer inherits both it and the assume-default flag (restating either one trips AV0011/AV0024).
    services.AddApiVersioning(options =>
    {
        options.AssumeDefaultVersionWhenUnspecified = true;      // no header -> 1.0
        options.ReportApiVersions = true;                        // advertise supported/deprecated
        options.ApiVersionReader = new HeaderApiVersionReader("api-version");
    }).AddMvc()
    .AddApiExplorer(options =>
    {
        options.GroupNameFormat = "'v'VVV";                      // names each version's explorer group
        options.SubstituteApiVersionInUrl = true;
    });

    services.AddApiParameterDescriptorBackfill();                // guards OpenAPI generation

    // Report the version headers ahead of the body, so an output-cache hit still carries them.
    services.Configure<MvcOptions>(static options =>
        options.Filters.Add(new ApiVersionReportingResultFilter()));

    return services;
}
```

Three of those lines carry the design. The reader is a `HeaderApiVersionReader("api-version")`
(`WebApplicationBuilderExtensions.cs:48`), so routes and query strings stay version-free: a caller
opts into a newer shape by adding one header, not by rewriting the URL. `AssumeDefaultVersionWhenUnspecified`
(`WebApplicationBuilderExtensions.cs:46`) means a client that never sends the header keeps getting
`1.0`, so introducing versioning was not a breaking change for any existing caller. And
`ReportApiVersions` (`WebApplicationBuilderExtensions.cs:47`) means every response carries the
supported and deprecated version lists in its headers, so a client can see which versions a service
still honors and which are on the way out without reading a changelog.

"Every response" includes a cached one, and that takes the last line of the block. The versioning
library writes its report from a `Response.OnStarting` callback, but the output cache snapshots the
response headers when the body starts, before those callbacks run, so a cache hit would replay a
response with no version report. `ApiVersionReportingResultFilter`
(`Caching/ApiVersionReportingResultFilter.cs:21`), registered as a global MVC filter
(`WebApplicationBuilderExtensions.cs:60`), writes `api-supported-versions` and `api-deprecated-versions`
before the result writes its body, so the cached entry stores them; the library's own callback then
finds them present and adds nothing. It reports through whatever `IReportApiVersions` the host
registered (`ApiVersionReportingResultFilter.cs:33`, `:39`), so a host with reporting off still
reports nothing (ADR-046).

Two more details in that block carry less design and more hard-won experience, and the first of them is
a line that is not there. `1.0` is the default because the `Asp.Versioning` library already defaults to
it, so the registration says nothing at all: setting `DefaultApiVersion` explicitly, in either the
versioning options or the explorer options that inherit them, trips the library's own analyzers
(AV0011/AV0024), and the comment standing in its place (`WebApplicationBuilderExtensions.cs:41-43`)
exists so the next reader does not "fix" the omission. And `AddApiParameterDescriptorBackfill`
(`WebApplicationBuilderExtensions.cs:56`) installs `ApiParameterDescriptorBackfillProvider`, added in
v1.146.0 after a real failure: MVC leaves `ApiParameterDescription.ParameterDescriptor` null for a route
token with no matching action parameter, and `Asp.Versioning.OpenApi`, the document pipeline in use when
the guard shipped, dereferenced it without a null check, so a host that routed `api/v{version:apiVersion}/...`
got a `500` from `GET /openapi/{documentName}.json`. The guard fills a placeholder only where one is
missing and never replaces a descriptor MVC supplied (`ApiParameterDescriptorBackfillProvider.cs:65`).
Because this framework's reader is the header, no host was hit either way, which is exactly why that
failure could ship unnoticed. MMCA.Common references only `Asp.Versioning.Mvc` and
`Asp.Versioning.Mvc.ApiExplorer` (`MMCA.Common/Directory.Packages.props:14`, `:20`), not
`Asp.Versioning.OpenApi`; the guard stays because it costs nothing and protects any other consumer of
the API descriptions from the same null (ADR-046).

**A shipped exemplar proves two versions coexist.** This is the part most "we support versioning"
stories skip. `ServiceInfoControllerBase` (`ServiceInfoControllerBase.cs:30`) serves the same
`/ServiceInfo` route under two versions selected by the header. `GetV1` is mapped to `1.0`
(`[MapToApiVersion("1.0")]`, `ServiceInfoControllerBase.cs:40`) and returns the minimal
`ServiceInfoResponse` shape (`ServiceInfoControllerBase.cs:51`). `GetV2` is mapped to `2.0`
(`[MapToApiVersion("2.0")]`, `ServiceInfoControllerBase.cs:46`) and returns the evolved
`ServiceInfoV2Response` (`ServiceInfoControllerBase.cs:54`), a superset that also advertises the
supported and deprecated version lists in its body. Same route, two shapes, chosen by one header. The
base is read-only: both actions are `[HttpGet]` (`ServiceInfoControllerBase.cs:39`, `:45`) and it
declares no write verb. Anonymity is not carried by the base: each sealed subclass grants it with
`[AllowAnonymous]` (ADC's `ServiceInfoController.cs:17`, Store's `:17`).

**The class-level version attributes live on the per-service subclass.** Class-level routing and
versioning attributes are not reliably inherited, so each host supplies a sealed subclass that carries
them (the same inheritance caveat ADR-036 records for ADC's sealed `OAuthController`). ADC's
`ServiceInfoController` declares `[ApiVersion("1.0", Deprecated = true)]` and `[ApiVersion("2.0")]` and
sets the service name to `"Conference"`
(`MMCA.ADC.Conference.API/Controllers/ServiceInfoController.cs:18`, `:19`, `:23`); Store's mirror sets
`"Catalog"` (`MMCA.Store.Catalog.API/Controllers/ServiceInfoController.cs:18`, `:23`). The shared
behavior lives in the base; the attributes do not, so each host repeats them on a one-line subclass.
That `1.0` is declared deprecated on purpose, so the deprecation-reporting path is live rather than
theoretical.

**A shared fitness contract keeps the machinery exercised.** `ServiceInfoVersioningContractTestsBase<TFixture>`
(`ServiceInfoVersioningContractTestsBase.cs:20`) sends `api-version: 1.0` and then `2.0` over the real
host. It asserts the v1.0 response returns the minimal shape and carries an `api-deprecated-versions`
header (`ServiceInfoVersioningContractTestsBase.cs:39`), and that the v2.0 response returns the evolved
shape and carries an `api-supported-versions` header (`ServiceInfoVersioningContractTestsBase.cs:55`).
Because the controller ships in `MMCA.Common.API`, the whole test body is identical across repos: each
consumer's subclass supplies only its fixture. It is one of the seven runtime conformance bases
`MMCA.Common.Testing` ships for a host to subclass (ADR-058), and today it is subclassed on one host
per repo: ADC's Conference service
(`MMCA.ADC.Conference.IntegrationTests/Contract/ApiVersioningTests.cs:15`) and Store's Catalog service
(`MMCA.Store.Catalog.IntegrationTests/Contract/ApiVersioningTests.cs:16`). This is the rubric §9 fitness
check, and the same invariant-over-discipline posture the framework prefers (ADR-015): without a second
working version, everything above would be asserted rather than proven.

**Every REST host adopts it the same way.** The extracted services call `AddCommonApiVersioning` in
their startup: ADC's Conference (`MMCA.ADC.Conference.Service/Program.cs:220`), Identity (`:154`),
Engagement (`:150`), and Notification (`:139`) hosts, Store's Catalog (`:140`), Sales (`:147`), and
Identity (`:134`) hosts, and the monolith reference host
(`MMCA.Helpdesk.Web/Program.cs:35`). One call per host, and the reader, default, and reporting choices
cannot drift apart between services. The discovery exemplar is narrower than the registration: only ADC's
Conference and Store's Catalog hosts ship a `ServiceInfoController` subclass today.

## Trade-offs, honestly

ADR-046 is refreshingly candid about what is real today versus what the shape leaves room for. Four
things are worth naming, and none of them is a bug.

- **The class-level version attributes are not inherited.** Each per-service subclass must repeat the
  `[ApiVersion(...)]` and routing attributes. It is one line of duplication per host, and it is the
  same inheritance caveat ADR-036 already records for ADC's sealed `OAuthController`.
  The shared behavior lives in the base; the attributes are the deliberate exception.
- **Adoption is per host.** A new REST host that forgets `AddCommonApiVersioning` gets no versioning and
  no reported versions, and the shared fitness contract only guards a host once its subclass is added.
  This is the same audit-the-inventory caveat that every opt-in framework registration carries.
- **Only the discovery endpoint has evolved to 2.0.** This is the honest one. Application controllers
  beyond `ServiceInfo` declare only `[ApiVersion("1.0")]` today. The second version exists on the
  `/ServiceInfo` discovery endpoint to keep the versioning path honest, not because any business
  resource has yet needed to evolve its shape. The point of the exemplar is that when a real resource
  does need a `2.0`, the machinery it plugs into has been proven to work, not merely configured.
- **Header versioning is less discoverable than a URL segment, and the OpenAPI document is one
  dev/CI-only `v1`.** A version chosen by header does not show up in a copied URL or a browser address
  bar, so the version in play is only visible to a caller that reads request and response headers. The
  generated contract does not follow the versioning axis either. Each extracted service host registers
  the plain `v1` document itself with `services.AddOpenApi()` (Helpdesk's monolith host serves no
  OpenAPI document at all), next to `AddCommonOpenApi`, which registers no document and only configures
  the ones present (`WebApplicationBuilderExtensions.cs:101`). `MapCommonOpenApi`
  then maps that single document with `app.MapOpenApi().AllowAnonymous()`
  (`Startup/Endpoints/OpenApiEndpointExtensions.cs:74`, document name `v1` at `:28`), throws at startup
  when no `v1` document was registered (`:65-71`), and is a no-op in Production (`:62`). So the `2.0`
  `ServiceInfo` action is served and exercised by the fitness contract above but appears in no
  generated document, and the only document any host's contract test pins is `/openapi/v1.json`
  (`Conformance/OpenApiContractTestsBase.cs:31`). ADC and Store also write that document to disk at
  build time and commit it per service host (four in ADC, three in Store, for example
  `MMCA.ADC.Conference.Service/openapi/MMCA.ADC.Conference.Service.json`), and an "OpenAPI documents are
  current" CI step fails a PR whose document changed without being committed (`MMCA.ADC/.github/workflows/deploy.yml:305`,
  `MMCA.Store/.github/workflows/deploy.yml:291`). That makes the contract diffable in review, but it
  stays a development and CI artifact: never served in production, and not a place the `2.0` shape is
  asserted (the committed Conference document carries `/ServiceInfo` and no `ServiceInfoV2Response`).

The trade the framework makes is clear: stable, version-free URLs and a non-breaking rollout, paid for
with a version that lives in headers rather than the path, and a proof-of-life second version on the
discovery endpoint rather than a business resource that has not needed one yet.

## Apply this even without MMCA

The pattern ports to any HTTP stack that will have to evolve a response shape without a flag day:

1. **Pick one version reader and put it behind one registration.** Header, query, or URL segment: pick
   one, wire it once, and adopt it from a single call so every host is versioned identically. A header
   reader keeps routes and URL builders version-free.
2. **Assume the default when the caller sends nothing.** `AssumeDefaultVersionWhenUnspecified` (or its
   equivalent) is what makes introducing versioning a non-event for existing callers. Without it, the
   day you turn versioning on is the day every un-versioned client breaks.
3. **Report supported and deprecated versions on every response.** Deprecation a client cannot see from
   headers is deprecation nobody acts on. Turn on version reporting and deprecate a real version so the
   reporting path is live, not theoretical.
4. **Ship a real second version and put it under a test.** A single-version API cannot demonstrate that
   its versioning works. A tiny discovery endpoint served under both a deprecated `1.0` and a `2.0`,
   with an integration test that sends each header and asserts the shape and the reported-version
   headers, is the difference between "we support versioning" and versioning you can prove.
5. **Keep the HTTP axis separate from your event-schema axis.** Request-time and client-selected is a
   different problem from consumer-resolved event evolution. One mechanism per axis.

---

**What we covered:** why "we support versioning" is untestable when only `1.0` ever ships, how
`AddCommonApiVersioning` wires a header-based policy (default `1.0` inherited from the library,
assume-default-when-unspecified, report-versions, `api-version` reader, plus the result filter that keeps
the version headers on output-cached responses and the parameter-descriptor backfill that keeps OpenAPI
generation from failing) in one call, how `ServiceInfoControllerBase` ships a
real deprecated `1.0` alongside a `2.0` so `ServiceInfoVersioningContractTestsBase` can prove two versions
coexist rather than assert it, and the honest current-reality caveats (only the discovery endpoint has
a `2.0`, adoption is per host, the attributes are repeated per subclass, and the OpenAPI contract is a
single dev/CI-only `v1` document that does not show the `2.0` shape).

**Next in the series:** Article 45, "Feature Flags in the CQRS Pipeline: Gate Commands, Not Code," on
gating a command in the pipeline instead of branching the code that runs it.

*MMCA.Common is open source. Star the repo, read the 2-minute ADR-046 behind this pattern, or
`dotnet add package MMCA.Common.API` and try the header.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- This pattern's decision record: `Website/docs-src/adr/046-http-api-versioning.md`
- The full 34-category scorecard, §9 included, lives in `Website/docs-src/governance/common-ArchitectureScorecard.md` in the docs site.

*Previous: Article 43, "Managed file storage: uploads you don't have to trust." Next: Article 45,
"Feature Flags in the CQRS Pipeline: Gate Commands, Not Code."*

*Tags: .NET, C Sharp, Software Architecture, API Design, REST APIs*

*Notes: verified type/behavior names with path:line (re-read this run, 2026-10-08, framework v1.233.0):*
- *2026-10-08 (Common v1.233.0): `AddCommonApiVersioning` also registers `ApiVersionReportingResultFilter` as a global MVC filter, `services.Configure<MvcOptions>(static options => options.Filters.Add(new ApiVersionReportingResultFilter()))` at `WebApplicationBuilderExtensions.cs:60` (comment `:58-59`), added in Common #501. The class is `internal sealed`, an `IResultFilter` (`Source/Presentation/MMCA.Common.API/Caching/ApiVersionReportingResultFilter.cs:21`); its remarks (`:13-20`) record that the library reports from a `Response.OnStarting` callback the output cache runs after its header snapshot; `OnResultExecuting` returns early when the response has started (`:27-30`), resolves `ApiVersionMetadata` and `IReportApiVersions` (`:32-33`), and reports through the host's reporter (`:39`). ADR-046 records it as its 2026-10-06 revision (`046-http-api-versioning.md:22`, Decision `:57-59`, revision section `:268`). Added to the code block, a new paragraph after the three-lines paragraph, and "What we covered". Same run: every `WebApplicationBuilderExtensions.cs` anchor moved down two lines (extension block `:32`; `:37`/`:39-41`/`:44`/`:45`/`:46`/`:54`/`:95` became `:39`/`:41-43`/`:46`/`:47`/`:48`/`:56`/`:101`); ADC host call sites (verified with `git grep` on `origin/main`) moved 217/150/147/136 to 220/154/150/139; Store's "OpenAPI documents are current" step moved `:287` to `:291` (`origin/main`). The fourth trade-off bullet's "Each host registers the plain `v1` document" overstated: `MMCA.Helpdesk.Web/Program.cs` calls `AddCommonApiVersioning` (`:35`) but there is no `AddOpenApi`, `AddCommonOpenApi` or `MapCommonOpenApi` anywhere in `MMCA.Helpdesk/Source`, so the sentence is scoped to the extracted service hosts.*
- *`AddCommonApiVersioning` (`Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:39`, inside the `extension(IServiceCollection services)` block opening at `:32`, XML doc `:34-38`); the body is `:40-63`. `DefaultApiVersion` is NOT SET: `:41-43` is a comment recording that the omission is deliberate (`1.0` is already the framework default and the API explorer inherits both it and `AssumeDefaultVersionWhenUnspecified`; restating either one trips AV0011/AV0024). `services.AddApiVersioning(...)` (`:44`), `AssumeDefaultVersionWhenUnspecified = true` (`:46`), `ReportApiVersions = true` (`:47`), `new HeaderApiVersionReader("api-version")` (`:48`), `.AddMvc()` (`:49`), `.AddApiExplorer(...)` (`:50-54`) setting only `GroupNameFormat = "'v'VVV"` (`:52`) and `SubstituteApiVersionInUrl = true` (`:53`), then `services.AddApiParameterDescriptorBackfill();` (`:56`), the result-filter registration (`:60`) and `return services;` (`:62`). The 2026-09-19 ledger anchors (`:327`, `:334-354`, `:336-338`, `:341-343`, `:351`) all moved about 300 lines up; contents unchanged. The code-block comment on `GroupNameFormat` was changed from "feeds the versioned OpenAPI group" to "names each version's explorer group", because no per-version OpenAPI document set exists at v1.221.0.*
- *`ApiParameterDescriptorBackfillProvider` (`Source/Presentation/MMCA.Common.API/OpenApi/ApiParameterDescriptorBackfillProvider.cs:43`, `IApiDescriptionProvider`), fills a placeholder only where MVC left `ParameterDescriptor` null via `??=` (`:65`). `AddApiParameterDescriptorBackfill()` is called from both `AddCommonApiVersioning` (`WebApplicationBuilderExtensions.cs:56`) and `AddCommonOpenApi` (`:103`; method at `:101`, doc at `:87-100`), both delegating to the private `TryAddEnumerable` helper at `:124-126`. Added in v1.146.0; the 500-from-`/openapi/{documentName}.json` rationale is ADR-046 (`Website/docs-src/adr/046-http-api-versioning.md:105-115`), and the "Since v1.217.0 MMCA.Common no longer references `Asp.Versioning.OpenApi`; the guard stays" sentence is at `:116-117`. Package proof: `MMCA.Common/Directory.Packages.props:14` (`Asp.Versioning.Mvc`) and `:20` (`Asp.Versioning.Mvc.ApiExplorer`), no `Asp.Versioning.OpenApi` entry. The article body was changed this run so the dereference is told as the past failure it is, not as a current dependency.*
- *`MapCommonOpenApi` (`Source/Presentation/MMCA.Common.API/Startup/Endpoints/OpenApiEndpointExtensions.cs:60`; the previous ledger's doubled `Startup/Endpoints/Startup/Endpoints/` path does not exist): `DefaultDocumentName = "v1"` (`:28`), the `!app.Environment.IsProduction()` guard (`:62`), the throw when no keyed `IOpenApiDocumentProvider` named `v1` is registered (`:65-71`), and `app.MapOpenApi().AllowAnonymous()` (`:74`); the AV0030 "Missing WithDocumentPerVersion" suppression is at `:56-59` with the justification that `Asp.Versioning.OpenApi` is not referenced. `AddCommonOpenApi` registers no document and only configures the host-registered ones (doc `WebApplicationBuilderExtensions.cs:87-100`, method `:101`, ADR-115 transformers `:108-112`). Host pairing example: ADC Conference `services.AddOpenApi()` / `services.AddCommonOpenApi()` / `app.MapCommonOpenApi()` at `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:322`, `:323`, `:457` (`origin/main`); Store Catalog at `MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:193`, `:194`, `:327`. ADR-046 records this as its 2026-10-01 v1.217.0 revision (`046-http-api-versioning.md:19-21`, body `:231-260`) and the trade-off "The OpenAPI document is dev/CI only, and there is one: `v1`" at `:159-168`. The earlier article claim (`MapOpenApi().WithDocumentPerVersion()`, one document per discovered version) was DRIFTED and is replaced in the fourth trade-off bullet and in "What we covered".*
- *Committed build-time documents (UNVERIFIABLE in the audit, now proven and added): ADC commits four (`MMCA.ADC/Source/Services/{Conference,Engagement,Identity,Notification}.Service/openapi/<host>.json`, generated by the `MmcaGenerateOpenApiDocument` target at `MMCA.ADC/Directory.Build.props:200`), Store commits three (`MMCA.Store/Source/Services/{Catalog,Identity,Sales}.Service/openapi/<host>.json`); the "OpenAPI documents are current" step is `MMCA.ADC/.github/workflows/deploy.yml:305` (prints "All 4" at `:320`) and `MMCA.Store/.github/workflows/deploy.yml:291` ("All 3" at `:307`). ADR-046 revisions 2026-09-22 and 2026-09-25 at `:16-18`, body from `:170`. The committed Conference document has `"/ServiceInfo"` at line 8 and zero `ServiceInfoV2Response` occurrences (Catalog likewise zero), which is the basis for "not a place the `2.0` shape is asserted". Nothing pins the document set beyond `v1`: `OpenApiContractTestsBase.OpenApiDocumentPath` defaults to `/openapi/v1.json` (`Source/Hosting/MMCA.Common.Testing/Conformance/OpenApiContractTestsBase.cs:31`) and the framework baseline fetches that same document (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/OpenApi/OpenApiBaselineTests.cs:54`).*
- *`ServiceInfoControllerBase` (`Source/Presentation/MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:30`); `Supported`/`Deprecated` arrays (`:32-33`); `GetV1` `[MapToApiVersion("1.0")]` (`:40`) returning `ServiceInfoResponse` (record `:51`); `GetV2` `[MapToApiVersion("2.0")]` (`:46`) returning the `ServiceInfoV2Response` superset (record `:54`). Read-only: both actions are `[HttpGet]` (`:39`, `:45`), no write verb; the base carries no `[AllowAnonymous]`. ADR-046 anonymity sentence at `:81-82`.*
- *`ServiceInfoVersioningContractTestsBase<TFixture>` (`Source/Hosting/MMCA.Common.Testing/Conformance/ServiceInfoVersioningContractTestsBase.cs:20`); v1.0 asserts `api-deprecated-versions` (`:39-41`); v2.0 asserts `api-supported-versions` (`:55-57`); reads `/ServiceInfo` with the `api-version` header (`:63-64`). Subclassed on exactly two hosts: `MMCA.ADC/Tests/Integration/MMCA.ADC.Conference.IntegrationTests/Contract/ApiVersioningTests.cs:14-15` and `MMCA.Store/Tests/Integration/MMCA.Store.Catalog.IntegrationTests/Contract/ApiVersioningTests.cs:15-16`. ADR-058 counts seven contract bases (`Website/docs-src/adr/058-runtime-conformance-suites-as-a-package.md:29`).*
- *Per-host subclasses: ADC `ServiceInfoController` `[AllowAnonymous]` (`:17`), `[ApiVersion("1.0", Deprecated = true)]` (`:18`), `[ApiVersion("2.0")]` (`:19`), `ServiceName => "Conference"` (`:23`) in `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ServiceInfoController.cs`; Store mirror `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/Controllers/ServiceInfoController.cs:17,18,19,23` with `"Catalog"`. `EntityControllerBase` declares `[ApiVersion("1.0")]` at `MMCA.Common/Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:33`.*
- *The non-inheritance caveat is recorded by ADR-036 for ADC's sealed `OAuthController` (`Website/docs-src/adr/036-external-oauth-login.md:144-146`); ADR-046 carries it at `:150-152`, the "application controllers declare `1.0` today" paragraph at `:127-129`, the host-adoption bullet at `:118-125`, ADR-015 posture at `:143-144`.*
- *Host adoption of `AddCommonApiVersioning`, all eight call sites re-read on 2026-10-08 (ADC and Store via `git grep` on `origin/main`): ADC Conference (`Source/Services/MMCA.ADC.Conference.Service/Program.cs:220`), Identity (`MMCA.ADC.Identity.Service/Program.cs:154`), Engagement (`MMCA.ADC.Engagement.Service/Program.cs:150`), Notification (`MMCA.ADC.Notification.Service/Program.cs:139`); Store Catalog (`MMCA.Store.Catalog.Service/Program.cs:140`), Sales (`MMCA.Store.Sales.Service/Program.cs:147`), Identity (`MMCA.Store.Identity.Service/Program.cs:134`); Helpdesk (`Source/Hosts/MMCA.Helpdesk.Web/Program.cs:35`). The four ADC anchors moved since 2026-10-02 (was 217/150/147/136); Store and Helpdesk unchanged; still eight hosts. ADR-046's own host anchors (`046-http-api-versioning.md:126-130`) match these except Conference, cited `:219` against `:220`; that is ADR drift, not edited here.*
- *The code block is condensed from `WebApplicationBuilderExtensions.cs:39-63` (comments shortened, body faithful, not byte-for-byte). Anchor facts: 132 accepted ADRs 001-132 (`Website/docs-src/adr/README.md:6`), framework v1.233.0 (`MMCA.Common/FACTS.md:4,14`), 22 published packages (`MMCA.Common/FACTS.md:19`); the article body states none of these counts. Was 131/001-131, v1.221.0 in the 2026-10-02 ledger, and 125/001-125, v1.205.0, 19 in the 2026-09-19 ledger.*

- Full series index: https://ivanball.github.io/writing.html
