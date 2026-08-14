# ADR-058: Runtime Conformance Suites Shipped as a Package

## Status
Accepted (2026-07-28; revised 2026-08-14).

## Context
ADR-015 turned the architecture invariants into build-gating tests, and drew its own boundary
explicitly: the fitness suite asserts "**structure / registration**, not runtime behavior"
(`015-architecture-fitness-functions.md:48`). NetArchTest can prove a controller lives in the right
assembly and that an outbound client *wires* resilience. It cannot prove that a booted host answers a
bad page number with an RFC 9457 problem document, emits HSTS on a liveness probe, drains within a
bounded stop, serves the OpenAPI document it claims to serve, answers two API versions, or nests the
ADR-014 decorators in the documented order. Those are runtime contracts of the framework, and every
one of them is only true if the consuming host wired it correctly: the framework ships the middleware,
the controller base, and the decorator registrations, but the host composes them.

The gap is visible in the ADR set. ADR-046 names exactly one of these checks in passing (a "shared
fitness contract" for versioning, `046-http-api-versioning.md:78`), and ADR-013 defines the RFC 9457
edge contract that another one guards, but neither decides the layer itself. The runtime-conformance
tier has been referenced repeatedly and never recorded on its own.

## Decision
Ship the runtime conformance suites in the **`MMCA.Common.Testing`** package as abstract behavioral
bases that each consuming host subclasses, and run every one of them against a host that was actually
booted.

- **Six contract bases, one per runtime contract.** `ProblemDetailsContractTestsBase<TFixture>`
  (`Source/Hosting/MMCA.Common.Testing/ProblemDetailsContractTestsBase.cs:21`) asserts the two
  error-shaping paths, ASP.NET Core model validation (400, `application/problem+json` with
  `type`/`traceId`/`errors`, `ProblemDetailsContractTestsBase.cs:30`) and the framework's
  `HandleFailure` Result mapping (404, `ProblemDetailsContractTestsBase.cs:42`), against the shared
  shape check `AssertProblemDetailsShapeAsync` (`ProblemDetailsContractTestsBase.cs:67`).
  `OpenApiContractTestsBase<TFixture>` (`OpenApiContractTestsBase.cs:21`) asserts the live
  `/openapi/v1.json` document is OpenAPI 3.x and still describes the pinned public resources
  (`OpenApiContractTestsBase.cs:53`, `OpenApiContractTestsBase.cs:68`).
  `ServiceInfoVersioningContractTestsBase<TFixture>` (`ServiceInfoVersioningContractTestsBase.cs:19`)
  drives `/ServiceInfo` at `api-version: 1.0` and `2.0` and checks the deprecated/supported reporting
  headers (`ServiceInfoVersioningContractTestsBase.cs:38`, `:54`). `SecurityHeadersTestsBase`
  (`SecurityHeadersTestsBase.cs:16`) probes `/alive` and pins six response headers, including
  `Content-Security-Policy: frame-ancestors 'none'` and an HSTS `max-age`
  (`SecurityHeadersTestsBase.cs:29-35`). `GracefulShutdownTestsBase<TEntryPoint>`
  (`GracefulShutdownTestsBase.cs:24`) calls a real `IHost.StopAsync` under a bounded token and asserts
  `ApplicationStopping` then `ApplicationStopped` fired (`GracefulShutdownTestsBase.cs:56`, `:58`,
  `:60`). `DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>`
  (`DecoratorPipelineOrderTestsBase.cs:36`) asserts the ADR-014 nesting.
- **The host is really booted; nothing is inferred from registrations.** The five HTTP-facing suites
  reach the host through `IIntegrationTestFixture` (`IIntegrationTestFixture.cs:8`) and
  `IntegrationTestBase<TFixture>` (`IntegrationTestBase.cs:13`), whose `Client` comes from the
  fixture's `WebApplicationFactory`. Two boot paths ship. Service hosts use
  `SqlServerIntegrationTestFixtureBase<TEntryPoint>` (`SqlServerIntegrationTestFixtureBase.cs:27`):
  it creates a GUID-named throwaway SQL Server database, pushes the connection string and
  `ASPNETCORE_ENVIRONMENT=Testing` as process environment variables *before* the host is built
  (`SqlServerIntegrationTestFixtureBase.cs:75`, `:76`), lets the host's own `DatabaseInitStrategy=Migrate`
  apply the schema when the first client forces the build
  (`SqlServerIntegrationTestFixtureBase.cs:83`), resets data between tests with Respawn
  (`SqlServerIntegrationTestFixtureBase.cs:99`), and drops the database on disposal
  (`SqlServerIntegrationTestFixtureBase.cs:127`). Database-free hosts use
  `ProductionHostApplicationFactory<TEntryPoint>` (`ProductionHostApplicationFactory.cs:22`), which
  pins `UseEnvironment("Production")` (`ProductionHostApplicationFactory.cs:36`) so the
  production-only branches (restrictive CORS, HSTS emission) are the ones under test, and captures the
  started `IHost` (`ProductionHostApplicationFactory.cs:29`) because `StopAsync` is not reachable
  through the `WebApplicationFactory` surface.
- **The consumer supplies its host and its host-specific facts, nothing else.** The abstract surface
  is deliberately small: two probe requests for problem details
  (`ProblemDetailsContractTestsBase.cs:54`, `:60`), a route-count floor and a pinned resource list for
  OpenAPI (`OpenApiContractTestsBase.cs:37`, `:50`), a client factory for security headers
  (`SecurityHeadersTestsBase.cs:42`), a service-collection configurator for the decorator pipeline
  (`DecoratorPipelineOrderTestsBase.cs:44`), and for versioning and graceful shutdown nothing at all
  beyond the fixture or entry point. The two shutdown subclasses are one-line declarations with no body
  (`MMCA.Store/Tests/Hosts/MMCA.Store.Gateway.Tests/GracefulShutdownTests.cs:9`,
  `MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/GracefulShutdownTests.cs:9`), and so is the ADC
  versioning subclass (`MMCA.ADC/Tests/Integration/MMCA.ADC.Conference.IntegrationTests/Contract/ApiVersioningTests.cs:14`).
- **The decorator suite is the one non-HTTP conformance check, and it inspects the object graph, not
  the registration list.** It builds a `ServiceCollection`, runs the repo's own real registration
  sequence through the subclass, resolves the closed handler interface from the built provider, then
  walks outermost to innermost by reading each decorator's private inner-handler field
  (`DecoratorPipelineOrderTestsBase.cs:98`) and compares the names against the ADR-014 order
  (`DecoratorPipelineOrderTestsBase.cs:47`, `:57`). That is what makes it a runtime check: Scrutor
  `TryDecorate` applies decorators in reverse registration order, so a reordered
  `AddApplicationDecorators()` or a module scan that ran after it changes the constructed pipeline
  while every registration still exists.
- **No committed snapshots.** The OpenAPI guard asserts against the live document rather than a
  checked-in file (`OpenApiContractTestsBase.cs:16`), so a new controller can never leave a stale
  snapshot behind, and the assertions are deliberately coarse: a path-count floor plus presence (not
  exact casing) of the pinned resources (`OpenApiContractTestsBase.cs:79`).
- **Hosts extend the base where they have more to prove.** ADC Conference adds a 409
  stale-`RowVersion` conflict test on top of the inherited 400/404 facts, reusing the inherited shape
  assertion (`MMCA.ADC/Tests/Integration/MMCA.ADC.Conference.IntegrationTests/Contract/ProblemDetailsContractTests.cs:39`,
  `:67`).

Adoption today is real but **partial, and uneven per suite**. The OpenAPI guard is the only one with
full coverage of the extracted REST hosts: all four ADC services
(`MMCA.ADC/Tests/Integration/MMCA.ADC.Conference.IntegrationTests/Contract/OpenApiContractTests.cs:14`,
`MMCA.ADC.Engagement.IntegrationTests/Contract/OpenApiContractTests.cs:14`,
`MMCA.ADC.Identity.IntegrationTests/Contract/OpenApiContractTests.cs:15`,
`MMCA.ADC.Notification.IntegrationTests/Contract/OpenApiContractTests.cs:16`) and all three Store
services (`MMCA.Store/Tests/Integration/MMCA.Store.Catalog.IntegrationTests/Contract/OpenApiContractTests.cs:14`,
`MMCA.Store.Identity.IntegrationTests/Contract/OpenApiContractTests.cs:14`,
`MMCA.Store.Sales.IntegrationTests/Contract/OpenApiContractTests.cs:14`). The problem-details guard
covers all three Store services
(`MMCA.Store/Tests/Integration/MMCA.Store.Catalog.IntegrationTests/Contract/ProblemDetailsContractTests.cs:19`,
`MMCA.Store.Identity.IntegrationTests/Contract/ProblemDetailsContractTests.cs:15`,
`MMCA.Store.Sales.IntegrationTests/Contract/ProblemDetailsContractTests.cs:15`) and, since
2026-08-13, all four
ADC services (`MMCA.ADC/Tests/Integration/MMCA.ADC.Conference.IntegrationTests/Contract/ProblemDetailsContractTests.cs:19`,
`MMCA.ADC.Engagement.IntegrationTests/Contract/ProblemDetailsContractTests.cs:16`,
`MMCA.ADC.Identity.IntegrationTests/Contract/ProblemDetailsContractTests.cs:16`,
`MMCA.ADC.Notification.IntegrationTests/Contract/ProblemDetailsContractTests.cs:15`): **ADC
Notification gained the missing subclass**, merged to `main` on 2026-08-13, so every REST host in
both consumers is now guarded for this one contract. The versioning contract is subclassed once per
repo, on ADC Conference (`ApiVersioningTests.cs:14`) and Store Catalog
(`MMCA.Store/Tests/Integration/MMCA.Store.Catalog.IntegrationTests/Contract/ApiVersioningTests.cs:15`),
which is enough to keep the machinery exercised but leaves the other five REST hosts unguarded. The
security-headers and graceful-shutdown suites are subclassed **only on the two Gateway hosts**
(`MMCA.Store/Tests/Hosts/MMCA.Store.Gateway.Tests/SecurityHeadersTests.cs:11`,
`MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/SecurityHeadersTests.cs:11`, plus the two
`GracefulShutdownTests` above); no service host asserts either today. The decorator suite is
subclassed once per consumer, both against the Identity module's `ChangePreferencesCommand` /
`GetUserPreferencesQuery` pair (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DecoratorPipelineOrderTests.cs:25`,
`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/DecoratorPipelineOrderTests.cs:25`).
MMCA.Common dogfoods the only base it can, since it ships no host of its own: a synthetic
`PingCommand`/`PingQuery` pair driven through the framework's own registration sequence
(`Tests/Hosting/MMCA.Common.Testing.Tests/DecoratorPipelineOrderTests.cs:20`).

**MMCA.Helpdesk adopts none of them.** It carries a `MMCA.Common.Testing` package reference in its
domain-test project (`MMCA.Helpdesk/Tests/Modules/Tickets/MMCA.Helpdesk.Tickets.Domain.Tests/MMCA.Helpdesk.Tickets.Domain.Tests.csproj:8`),
but no file in the repo imports the namespace and no conformance base is subclassed: its three test
projects are the Tickets domain and application suites plus the ADR-015 architecture suite, which does
subclass the structural bases from the separate `MMCA.Common.Testing.Architecture` package
(`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/GlobalUsings.cs:3`). The reference
app therefore demonstrates the structural tier and not the runtime tier.

## Rationale
- **Runtime conformance is the half ADR-015 excluded.** Structural rules answer "is the code shaped
  correctly"; these suites answer "does the composed host behave correctly". A host that registers
  everything the framework asks for can still drop a security header in a middleware reorder, wedge a
  rolling deploy with a hosted service that will not drain, or silently invert the decorator pipeline.
  None of that is reachable by reflection over assemblies.
- **The failure this catches does not announce itself in production.** A non-draining host looks
  healthy until a deploy waits out its termination grace period; a missing HSTS header looks healthy
  until an audit; a reordered decorator pipeline looks healthy until a validation runs inside a
  transaction that should never have opened.
- **Write the body once, subclass thin.** Same lever as ADR-015: the assertions live in the package,
  so a new invariant reaches every consumer that already subclassed the base. The gateway shutdown
  subclasses are single lines with no body, which is the intended cost of adoption.
- **Booting the host is what makes it honest.** Pinning `Production` exercises the branches a default
  `Development` boot skips, and a throwaway migrated database means the schema under test is the one
  the host's own init strategy produced, not a fixture's guess.
- **A live document beats a snapshot.** Asserting against the served OpenAPI document removes the
  class of failure where the guard passes because the snapshot was regenerated along with the
  regression.

## Trade-offs
- **Opt-in per host, exactly like ADR-015.** The framework ships the suites; a host gets the gate only
  once someone writes the subclass. That is the same audit-the-inventory caveat, and the adoption
  inventory above is the current answer to it, not a claim of completeness.
- **Coverage is uneven by suite.** Security headers and graceful shutdown are Gateway-only, versioning
  is one host per repo, and Helpdesk has none of it. Problem details is the one suite now subclassed
  on every REST host in both consumers (ADC Notification closed the last gap on 2026-08-13). Every
  remaining hole is an unguarded host for that contract, not a decision that the contract does not
  apply.
- **Most of the suites need a real SQL Server.** The five fixture-driven suites live in the per-service
  integration tier and cannot run in a database-free test pass; only the Gateway pair (no DbContext, no
  broker) and the decorator suite run in the fast tier. That splits the runtime gate across two CI
  jobs with different prerequisites.
- **The assertions are coarse by construction.** `MinimumPathCount` is a floor, `CorePublicResources`
  checks presence rather than schema, and the problem-details base checks shape (`status`, `title`, a
  diagnostic extension) rather than message content. These catch wholesale regressions, not subtle
  ones.
- **The decorator check reads private fields.** Unwrapping the chain depends on each decorator holding
  its inner handler in a field that implements the same closed interface
  (`DecoratorPipelineOrderTestsBase.cs:105-108`); a decorator that stored it differently would silently
  end the walk early rather than fail loudly.
- **A new contract base only reaches consumers at the next lockstep bump.** The suites ship inside the
  package set, so adding one is a framework release plus a consumer sweep (ADR-016), not a local edit
  in the repo that needs the guard.

## Related
ADR-015 (the structural / registration fitness layer this complements; its stated non-goal, "not
runtime behavior", is exactly this ADR's scope, and the two tiers ship as two separate packages),
ADR-014 (the decorator execution order `DecoratorPipelineOrderTestsBase` proves at runtime), ADR-013
(the RFC 9457 ProblemDetails edge contract `ProblemDetailsContractTestsBase` guards), ADR-046 (HTTP
API versioning, whose "shared fitness contract" is one of these bases), ADR-016 (lockstep versioning:
a new conformance base reaches consumers only through a release and a full sweep). Package inventory
for the framework lives in `MMCA.Common/FACTS.md`.
