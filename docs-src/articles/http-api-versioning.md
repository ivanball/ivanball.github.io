# HTTP API versioning, proven not just claimed

> Series: MMCA.Common · Article #44 · P2/P3 · Group G12,G13 · Rubric §9 · ADR-046 ·
> Status: grounded in `Website/docs-src/adr/046-http-api-versioning.md`,
> `WebApplicationBuilderExtensions.cs` (`AddCommonApiVersioning`), `ServiceInfoControllerBase.cs`,
> `ServiceInfoVersioningContractTestsBase.cs`, and the per-host `ServiceInfoController` subclasses in
> ADC and Store. No em dashes.

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
(`WebApplicationBuilderExtensions.cs:334`) is the entire decision, in one place: the reader, the
default behavior, the reporting, and the one guard that keeps document generation from tripping over
any of it.

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
        options.GroupNameFormat = "'v'VVV";                      // feeds the versioned OpenAPI group
        options.SubstituteApiVersionInUrl = true;
    });

    services.AddApiParameterDescriptorBackfill();                // guards OpenAPI generation

    return services;
}
```

Three of those lines carry the design. The reader is a `HeaderApiVersionReader("api-version")`
(`WebApplicationBuilderExtensions.cs:343`), so routes and query strings stay version-free: a caller
opts into a newer shape by adding one header, not by rewriting the URL. `AssumeDefaultVersionWhenUnspecified`
(`WebApplicationBuilderExtensions.cs:341`) means a client that never sends the header keeps getting
`1.0`, so introducing versioning was not a breaking change for any existing caller. And
`ReportApiVersions` (`WebApplicationBuilderExtensions.cs:342`) means every response carries the
supported and deprecated version lists in its headers, so a client can see which versions a service
still honors and which are on the way out without reading a changelog.

Two more details in that block carry less design and more hard-won experience, and the first of them is
a line that is not there. `1.0` is the default because the `Asp.Versioning` library already defaults to
it, so the registration says nothing at all: setting `DefaultApiVersion` explicitly, in either the
versioning options or the explorer options that inherit them, trips the library's own analyzers
(AV0011/AV0024), and the comment standing in its place (`WebApplicationBuilderExtensions.cs:336-338`)
exists so the next reader does not "fix" the omission. And `AddApiParameterDescriptorBackfill`
(`WebApplicationBuilderExtensions.cs:351`) installs `ApiParameterDescriptorBackfillProvider`, added in
v1.146.0 after a real failure: MVC leaves `ApiParameterDescription.ParameterDescriptor` null for a route
token with no matching action parameter, and `Asp.Versioning.OpenApi` dereferences it without a null
check, so a host that routes `api/v{version:apiVersion}/...` returned a `500` from
`GET /openapi/{documentName}.json`. The guard fills a placeholder only where one is missing and never
replaces a descriptor MVC supplied (`ApiParameterDescriptorBackfillProvider.cs:65`). Because this
framework's reader is the header, no current host was hit either way, which is exactly why that failure
could ship unnoticed (ADR-046).

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
their startup: ADC's Conference (`MMCA.ADC.Conference.Service/Program.cs:203`), Identity (`:152`),
Engagement (`:148`), and Notification (`:140`) hosts, Store's Catalog (`:141`), Sales (`:148`), and
Identity (`:135`) hosts, and the monolith reference host
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
- **Header versioning is less discoverable than a URL segment, and the OpenAPI documents are dev/CI
  only.** A version chosen by header does not show up in a copied URL or a browser address bar, so the
  version in play is only visible to a caller that reads request and response headers. The generated
  contract does follow the versioning axis: `MapCommonOpenApi` applies
  `MapOpenApi().WithDocumentPerVersion()` (`Startup/Endpoints/OpenApiEndpointExtensions.cs:38`), so the
  route resolves one document per discovered API version, named by the explorer's `GroupNameFormat`
  (`v1.0` is the `v1` document). But the whole endpoint is a no-op in Production
  (`Startup/Endpoints/OpenApiEndpointExtensions.cs:36`), and the only document any host's contract test
  pins is `/openapi/v1.json` (`Conformance/OpenApiContractTestsBase.cs:31`), so the machine-readable
  surface is a development and CI artifact, not something a client can browse in production and not a
  place the `2.0` shape is currently asserted.

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
assume-default-when-unspecified, report-versions, `api-version` reader, plus the parameter-descriptor
backfill that keeps OpenAPI generation from failing) in one call, how `ServiceInfoControllerBase` ships a
real deprecated `1.0` alongside a `2.0` so `ServiceInfoVersioningContractTestsBase` can prove two versions
coexist rather than assert it, and the honest current-reality caveats (only the discovery endpoint has
a `2.0`, adoption is per host, the attributes are repeated per subclass, and the OpenAPI documents are
dev/CI only).

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

*Notes: verified type/behavior names with path:line (re-read this run):*
- *`AddCommonApiVersioning` (`Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:334`, inside the `extension(IServiceCollection services)` block opening at `:327`); the body is `:335-354`. `DefaultApiVersion` is NOT SET: `:336-338` is a comment recording that the omission is deliberate (`1.0` is already the framework default and the API explorer inherits both it and `AssumeDefaultVersionWhenUnspecified` from the versioning options below; restating either one trips AV0011/AV0024). `AssumeDefaultVersionWhenUnspecified = true` (`:341`), `ReportApiVersions = true` (`:342`), `new HeaderApiVersionReader("api-version")` (`:343`), `.AddMvc()` (`:344`), `.AddApiExplorer(...)` (`:345-349`) setting only `GroupNameFormat = "'v'VVV"` (`:347`) and `SubstituteApiVersionInUrl = true` (`:348`), then `services.AddApiParameterDescriptorBackfill();` (`:351`) and `return services;` (`:353`). The method's own contents are unchanged; the extension block sits about 100 lines lower in the file than the `:2xx` anchors this ledger carried before, so every anchor above was re-read on 2026-09-19.*
- *`ApiParameterDescriptorBackfillProvider` (`Source/Presentation/MMCA.Common.API/OpenApi/ApiParameterDescriptorBackfillProvider.cs:43`, `IApiDescriptionProvider`), fills a placeholder only where MVC left `ParameterDescriptor` null via `??=` (`:65`), never replacing an existing descriptor. `AddApiParameterDescriptorBackfill()` is called from both `AddCommonApiVersioning` (`WebApplicationBuilderExtensions.cs:351`) and `AddCommonOpenApi` (`:496`; method at `:493`, doc at `:483-492`), both delegating to the shared private helper at `:518-520`. Added in v1.146.0; the 500-from-`/openapi/{documentName}.json` rationale and the "no current host was affected, which is why it could ship unnoticed" note are ADR-046 material (`Website/docs-src/adr/046-http-api-versioning.md:97-107`, amendment recorded at `:8-9`).*
- *`ServiceInfoControllerBase` (`Source/Presentation/MMCA.Common.API/Controllers/ServiceInfoControllerBase.cs:30`); `Supported`/`Deprecated` arrays (`:32-33`); `GetV1` `[MapToApiVersion("1.0")]` (`:40`) returning `ServiceInfoResponse` (record `:51`); `GetV2` `[MapToApiVersion("2.0")]` (`:46`) returning the `ServiceInfoV2Response` superset (record `:54`). Read-only: both actions are `[HttpGet]` (`:39`, `:45`), no write verb. The base carries NO `[AllowAnonymous]` (the only occurrence of the attribute in the file is the sample subclass inside the XML `<code>` block at `:21`); anonymity is granted per subclass. ADR-046 records this in its 2026-08-01 revision note (`Website/docs-src/adr/046-http-api-versioning.md:4-7`), with the anonymity sentence at `:73`; that ADR also carries a 2026-08-12 amendment (`:8-9`), a 2026-08-14 revision (`:10-11`) and a 2026-09-11 revision (`:12-15`, re-anchored citations and a corrected OpenAPI trade-off).*
- *`ServiceInfoVersioningContractTestsBase<TFixture>` (`Source/Hosting/MMCA.Common.Testing/Conformance/ServiceInfoVersioningContractTestsBase.cs:20`, namespace `MMCA.Common.Testing.Conformance`); v1.0 asserts `api-deprecated-versions` (`:39-41`); v2.0 asserts `api-supported-versions` (`:55-57`); reads `/ServiceInfo` with the `api-version` header (`:63-64`). Subclassed on exactly two hosts, one per repo: `MMCA.ADC/Tests/Integration/MMCA.ADC.Conference.IntegrationTests/Contract/ApiVersioningTests.cs:15` and `MMCA.Store/Tests/Integration/MMCA.Store.Catalog.IntegrationTests/Contract/ApiVersioningTests.cs:16` (the declarations span `:14-15` and `:15-16` respectively; no other subclass in either repo). ADR-058 counts seven contract bases, one per runtime contract, all under `Source/Hosting/MMCA.Common.Testing/Conformance/` (`Website/docs-src/adr/058-runtime-conformance-suites-as-a-package.md:27`); this one is taught in depth here and pointed to from Article 35.*
- *Per-host subclasses: ADC `ServiceInfoController` `[AllowAnonymous]` (`:17`), `[ApiVersion("1.0", Deprecated = true)]` / `[ApiVersion("2.0")]`, `ServiceName => "Conference"` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/ServiceInfoController.cs:17,18,19,23`); Store mirror `[AllowAnonymous]` (`:17`), `ServiceName => "Catalog"` (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.API/Controllers/ServiceInfoController.cs:17,18,23`).*
- *The non-inheritance caveat is recorded by ADR-036 only, for ADC's sealed `OAuthController` (`Website/docs-src/adr/036-external-oauth-login.md:144-146`). ADR-034 takes the opposite shape: `[ApiController]` / `[Route("[controller]")]` / `[ApiVersion("1.0")]` sit on the generic base itself (`Website/docs-src/adr/034-generic-entity-query-layer.md:42`, `EntityControllerBase.cs:33-35`, class declaration at `:36`), so the earlier joint attribution to ADR-034 was wrong and is corrected here and in ADR-046 (`046-http-api-versioning.md:5-6`, with the "application controllers declare `1.0` today" paragraph at `:117-119`, the non-inheritance trade-off at `:140-142`, and the ADR-034 correction in Related at `:165-168`).*
- *Host adoption of `AddCommonApiVersioning`, all eight call sites re-read on 2026-09-19: ADC Conference (`Source/Services/MMCA.ADC.Conference.Service/Program.cs:203`), Identity (`Source/Services/MMCA.ADC.Identity.Service/Program.cs:152`), Engagement (`Source/Services/MMCA.ADC.Engagement.Service/Program.cs:148`), Notification (`Source/Services/MMCA.ADC.Notification.Service/Program.cs:140`); Store Catalog (`Source/Services/MMCA.Store.Catalog.Service/Program.cs:141`), Sales (`Source/Services/MMCA.Store.Sales.Service/Program.cs:148`), Identity (`Source/Services/MMCA.Store.Identity.Service/Program.cs:135`); Helpdesk (`Source/Hosts/MMCA.Helpdesk.Web/Program.cs:35`). The inventory is still eight hosts; six of the eight anchors moved since the previous ledger.*
- *`MapCommonOpenApi` (`Source/Presentation/MMCA.Common.API/Startup/Endpoints/Startup/Endpoints/OpenApiEndpointExtensions.cs:38`, XML doc at `:26-33`) is a no-op in Production (the `!app.Environment.IsProduction()` guard at `:36`) and maps `app.MapOpenApi().WithDocumentPerVersion()` (`:38`), documented at `:29-31` as resolving one document per discovered API version; `AddCommonOpenApi`'s doc says the same (`WebApplicationBuilderExtensions.cs:483-492`, method at `:493`). Nothing pins the document set beyond `v1`: `OpenApiContractTestsBase`'s default document path is `/openapi/v1.json` (`Source/Hosting/MMCA.Common.Testing/Conformance/OpenApiContractTestsBase.cs:31`) and the framework baseline fetches that same single document (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/OpenApi/OpenApiBaselineTests.cs:54`), which is the trade-off ADR-046 records at `:149-157`.*
- *The code block above is condensed from `WebApplicationBuilderExtensions.cs:334-354` (comments shortened, body faithful, not byte-for-byte). Anchor facts (125 accepted ADRs 001-125, framework v1.205.0, 19 published packages, §9 scorecard) per `MMCA.Common/FACTS.md:4,14,19` and `Website/docs-src/adr/README.md:6` this run.*

- Full series index: https://ivanball.github.io/writing.html
