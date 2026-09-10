# ADR-117: AppHost Integration Testing as a Shipped Package

## Status
Accepted (2026-09-09). Adds the AppHost test tier
[ADR-098](098-aspire-orchestration-not-testing-or-dashboards.md) left out, as a package rather than a
per-repo copy.

## Context
The AppHost is the only file that states how a whole stack fits together: which project resources
exist, which database each one owns, which broker they share, where JWKS discovery points, and the
`WaitFor` graph that orders the startup. Nothing in the framework compiles a claim about any of it.

Every other tier looks past it. `dotnet build MMCA.Common.slnx` type-checks the AppHost's C# but
never runs it, so a resource renamed on one side of a `WithReference` still builds. The in-process
integration tier boots hosts directly through `WebApplicationFactory`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Fixtures/ProductionHostApplicationFactory.cs`),
which is the point of that tier and also means it never sees the orchestration. The cross-service
tier does the same for three hosts at once
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Fixtures/CrossServiceFixtureBase.cs`). The E2E tier
runs against a deployed environment, by which time a composition mistake is a production incident
rather than a test failure.

MMCA.ADC proved both the gap and the shape of the answer. Its
`Tests/Integration/MMCA.ADC.AppHost.SmokeTests` project boots the real AppHost through
`DistributedApplicationTestingBuilder` and asks the gateway for one health answer, and it is
deliberately outside every `.slnx` and `.slnf` so no ordinary build picks it up. What it also proved
is how much of that project is not ADC-specific: a startup budget, a readiness budget, a poll
interval, a poll loop that treats a connection failure as "not yet", and a teardown. Roughly a
hundred lines of infrastructure guarding a single assertion, which the Store repo would have to
copy verbatim to get the same coverage.

Two preconditions turned out to be load-bearing, and both were learned the expensive way. The ADC
nightly ran red from 2026-09-01 and was root-caused on 2026-09-09 (fixed in ADC #189 and Store
#142), each time to something that presents as a timeout on an unrelated resource:

1. **No RS256 key material.** Identity's `appsettings.json` ships a user-secrets placeholder and a
   CI runner has no user secrets, so the JwtBearer options factory threw on the first request. Every
   request answered 500, including `/alive`, so the liveness probe never turned Identity healthy and
   every `WaitFor(identity)` edge waited out the twelve-minute budget. The framework already has the
   channel for the fix (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:353`,
   `WithE2eRsaKeys()`, which forwards `E2E_JWT_PRIVATE_KEY_PEM` / `E2E_JWT_PUBLIC_KEY_PEM` onto
   `Jwt__*` and `Jwks__*`); what it did not have was anything that put a keypair into those
   variables.
2. **An untrusted HTTPS development certificate.** A resource launched with the `https` profile
   answers its stock health probe over TLS terminated by that certificate. Untrusted on a fresh
   runner, every probe failed with `UntrustedRoot` and the dependent resource's `WaitFor` never
   cleared.

There is a third rule the framework already records and that any shared base must not break: a
startup gate probes LIVENESS, never readiness
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/H2cHealthCheckExtensions.cs:53`). A readiness
endpoint aggregates downstream and warm-up checks, so gating startup on it can deadlock the
dependency graph.

## Decision
**Ship the AppHost test tier as a package, `MMCA.Common.Testing.Aspire`, so a consumer's smoke tier
is a subclass and a set of assertions rather than a copied fixture. Make the preconditions a named
skip rather than a timeout, and wait for readiness per resource rather than for "the app started".**

1. **A collection fixture, not a per-test one.**
   `AppHostFixtureBase<TAppHost>`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Aspire/Fixtures/AppHostFixtureBase.Generic.cs`)
   builds through `DistributedApplicationTestingBuilder.CreateAsync<TAppHost>` and the non-generic
   base (`.../Fixtures/AppHostFixtureBase.cs:38-167`) owns the lifecycle. Starting an orchestrator is
   the most expensive thing in any repo per assertion, so it happens once per collection.

2. **Readiness is awaited per resource, inside one shared budget.**
   `WaitForResourcesAsync` (`.../Fixtures/AppHostFixtureBase.cs:242-279`) asks
   `ResourceNotificationService.WaitForResourceHealthyAsync` for a resource that carries a
   `HealthCheckAnnotation` (`:264`) and `WaitForResourceAsync(..., KnownResourceStates.Running)` for
   one that carries none (`:269`), and it says which of the two it did in the failure message. The
   budget is a single deadline shared across resources rather than a per-resource allowance
   (`.../Fixtures/AppHostReadinessBudget.cs:37`, `Remaining`), because with five resources a
   per-resource budget makes a stack that wedges on the last one take five times as long to say so.
   A budget that runs out throws a `TimeoutException` naming the resource and the state it never
   reached. Startup and readiness are separate budgets (`:16`), five minutes each by default (`:23`),
   because they fail for different reasons: startup is dominated by container image pulls on a cold
   agent, readiness by migrations, warm-up and the dependency graph.

3. **Preconditions produce a skip with a reason, never a wedge.**
   `AppHostEnvironmentGate.Evaluate`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Aspire/Preconditions/AppHostEnvironmentGate.cs:38-69`)
   turns a fixture's declared requirements into either "go" or one actionable sentence, which the
   fixture exposes as `SkipReason` / `IsAvailable` (`.../Fixtures/AppHostFixtureBase.cs:53`, `:56`).
   The requirements are an opt-in variable `MMCA_APPHOST_TESTS` (`.../AppHostEnvironmentGate.cs:16`),
   a reachable container runtime (`.../DockerAvailability.cs:31`, a socket and named-pipe probe
   rather than a `docker info` process launch, because the gate runs in front of a skip decision),
   and the development certificate (`.../DeveloperCertificateAvailability.cs:35`, matched on the SDK
   extension OID at `:28`). Opt-in is reported first when several are missing, because on a machine
   with none of them it is the only sentence a developer can act on.

4. **The certificate is detected, never installed.** `DeveloperCertificateAvailability` opens the
   current user's personal store read-only and answers false when it cannot
   (`.../DeveloperCertificateAvailability.cs:61-75`). Installing or trusting a certificate is a
   machine-level act a test fixture has no business performing silently; a CI job that needs one runs
   `dotnet dev-certs https --trust` as an explicit step
   (`MMCA.Common/.github/workflows/ci.yml:924`, in the `apphost-testing` job declared at `:882`).

5. **The RS256 keypair is minted when the environment has none.** `EphemeralRsaKeyPair.Create()`
   (`.../Preconditions/EphemeralRsaKeyPair.cs:42`) generates an RSA-2048 pair and the fixture pushes
   it onto `E2E_JWT_PRIVATE_KEY_PEM` / `E2E_JWT_PUBLIC_KEY_PEM` (`:26`, `:32`) before the AppHost is
   built, restoring the previous values on teardown. The AppHost is built in the test process, so the
   test process environment IS the AppHost environment, which is what makes `WithE2eRsaKeys()` see
   it. Both variables are checked, not either: a half-set pair is worse than none, because the host
   would then validate against a public key nothing signed with.

6. **The assertions state the framework's wiring contracts.** `AppHostTestBase<TFixture>`
   (`.../Fixtures/AppHostTestBase.cs:29`) carries `AssertHealthyAsync` (`:98`), `AssertAliveAsync`
   (`:113`), `AssertReadyAsync` (`:127`), `AssertJwksAsync` (`:147`, which fails on an EMPTY key set
   because `RsaJwksProvider` answers `{"keys":[]}` rather than throwing when publishing is off),
   `AssertH2cAsync` (`:203`, an exact-HTTP/2 request through `H2cProbe`
   (`.../Probes/H2cProbe.cs:61`), because a client allowed to downgrade proves nothing about an h2c
   listener) and `AssertDataSourceAsync` (`.../Fixtures/AppHostTestBase.cs:246`).

7. **`AssertDataSourceAsync` stops at "present and parseable", deliberately.** It resolves the
   resource's environment through `ExecutionConfigurationBuilder` and asserts that
   `DataSources__<logicalName>__<Engine>ConnectionString` exists and parses as a connection string.
   Opening it would mean carrying an ADO provider per engine (SQL Server, PostgreSQL, SQLite) inside
   a test-infrastructure package that has no other reason to know about any of them, and it would
   prove something already proven: the database resource has its own Aspire health check and the
   fixture waited for the service that references it to become healthy. What is NOT otherwise proven,
   and what this does assert, is that the routing key the multi-database resolver reads is the one
   the AppHost wrote. A typo in a logical name is invisible to a build and to every in-process tier.

8. **The package's layer ceiling is `MMCA.Common.Testing`, enforced twice.** It reuses
   `JwtTokenGenerator` and reaches Application and API only through that one edge. The compile-time
   gate is `EnforceTestingAspireLayerBoundary`
   (`MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets:137`), which judges the references
   this csproj DECLARES (by `DefiningProjectName`) rather than the transitive closure the SDK folds
   into `@(ProjectReference)` before `ResolveProjectReferences`. The runtime gate is
   `TestingAspireBoundaryTests`
   (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Layering/TestingAspireBoundaryTests.cs:20`),
   which asserts the same rule against the compiled assembly so a type arriving by a path no
   `ProjectReference` declares is caught too. `MMCA.Common.Aspire` is on the forbidden list as well:
   the probe paths are MIRRORED constants (`.../Probes/AppHostProbePaths.cs:15-41`) precisely so an
   AppHost-tier package never drags the service-defaults graph into a consumer's test project, and a
   unit test cross-asserts each pair against the framework constant it mirrors.

9. **Skipping is the consuming project's call.** The package takes no dependency on the xUnit
   assertion library, so a test class writes
   `Assert.SkipWhen(!Fixture.IsAvailable, Fixture.SkipReason!)` itself. That keeps the skip API where
   a test project already has it and keeps one more package out of a consumer's graph.

10. **The tier runs in CI, advisory, against an in-repo sample.**
    `Tests/Hosting/MMCA.Common.Testing.Aspire.AppHostTests` boots a sample AppHost with a SQLite file
    and ONE sample service project declared as TWO resources, so it needs no container runtime, and
    asserts every helper against it. The two resources are the two cleartext protocol profiles,
    because a cleartext Kestrel endpoint serves one or the other: `sample` runs `HttpProtocols.Http1`
    for the ordinary probes, and `sample-h2c` runs `HttpProtocols.Http2` alone, which is what h2c
    prior knowledge requires (without TLS there is no ALPN, so an `Http1AndHttp2` endpoint answers
    HTTP/1.1 only and logs that it is doing so). `sample-h2c` is gated with the framework's
    `WithH2cHealthCheck()` rather than Aspire's stock HTTP probe, so the tier proves that helper end
    to end as well: the stock probe speaks HTTP/1.1, and nothing else could have turned that resource
    healthy.

    **What the AppHost tier cannot prove, learned from the first real run:** that a SERVICE refuses
    HTTP/1.1. Aspire fronts a project resource with its own endpoint proxy, so the protocol a client
    observes there is the proxy's, and the proxy serves HTTP/1.1 itself even when the service behind
    it is Http2-only. A negative control at that tier passes for the wrong reason and was removed. The
    service-side half is asserted in `MMCA.Common.Testing.Aspire.Tests` (`H2cProbeServerTests`)
    against a cleartext `HttpProtocols.Http2` listener the test owns, where an exact HTTP/1.1 request
    really is refused, and `AssertH2cAsync`'s own documentation states the scope of its claim.
    The three projects (test, sample AppHost, sample service) sit OUTSIDE `MMCA.Common.slnx`: an
    AppHost's committed lock file carries a RID-specific `Aspire.Dashboard.Sdk` entry, so a lock
    committed from Windows fails the solution's locked-mode restore on an ubuntu runner, and the fast
    solution-wide unit loop must not build or discover an orchestrator.

## Rationale
Six shapes were weighed, and each rejection is a property the package keeps:

- **Leave it as a per-repo copy.** This is the status quo, and it is what produced roughly a hundred
  lines of budget and poll-loop code in ADC guarding one assertion, with Store owed the same copy. It
  also leaves the two 2026-09-09 preconditions as tribal knowledge in one workflow file rather than as
  behavior a fixture carries.
- **Put the fixture in `MMCA.Common.Testing`.** Rejected: that package is taken by every integration
  test project in every consumer, and adding `Aspire.Hosting` plus `Aspire.Hosting.Testing` to it
  would put the whole AppHost-side application model into the graph of test projects that never boot
  an orchestrator. A separate package is the same reasoning that already keeps
  `MMCA.Common.Aspire.Hosting` apart from `MMCA.Common.Aspire`.
- **Reference `MMCA.Common.Aspire` and use `HealthEndpointPaths` directly.** Rejected for the same
  graph reason: spelling four probe paths is not worth pulling Azure Monitor, OpenTelemetry and Key
  Vault into a consumer's test project. Mirrored constants plus a cross-asserting unit test give the
  same safety at no dependency cost, which is the posture `MMCA.Common.Aspire.Hosting` already takes
  for the gateway configuration sections it mirrors.
- **Install or trust the development certificate from the fixture.** Rejected: a test run must not
  mutate a machine's certificate stores. Detecting the state and skipping with a sentence that names
  the command is the honest boundary.
- **Gate startup waits on `/health/ready`.** Rejected, and recorded so it is not re-proposed: a
  readiness endpoint aggregates downstream and warm-up checks, so a startup gate on it can deadlock
  the dependency graph. `/alive` is the startup signal; readiness is something a test asserts about a
  service, never something a startup gate waits on.
- **Add a generic outbox-drain helper.** Considered and left out: there is no engine-agnostic HTTP
  signal for "the outbox has drained", so any helper would either poll a database (an ADO provider
  per engine, see decision 7) or poll a consumer-specific endpoint. A consumer that needs it writes
  four lines over the existing `TestPolling.PollUntilAsync`.

## Trade-offs
- **A consumer's smoke tier becomes a subclass.** `MMCA.ADC.AppHost.SmokeTests` is the first, in a
  follow-up PR after this package releases; this PR does not touch ADC. The mapping is mechanical:
  `AppHostCompositionSmokeTests`'s `StartupBudget` / `ReadinessBudget` / `PollInterval` fields become
  one `Budget` override returning an `AppHostReadinessBudget`; its `PollUntilHealthyAsync` loop is
  deleted outright, because the base already waits on each resource's own health signal instead of
  polling one endpoint through the gateway; the `DistributedApplicationTestingBuilder.CreateAsync` /
  `BuildAsync` / `StartAsync` / `StopAsync` sequence becomes the type parameter
  `AppHostFixtureBase<Projects.MMCA_ADC_AppHost>`; and the single `/health` assertion becomes
  `AssertHealthyAsync("gateway")` alongside new `AssertJwksAsync`, `AssertH2cAsync` and
  `AssertDataSourceAsync` calls that the hand-rolled project never made. The workflow job keeps its
  `dotnet dev-certs` step and can drop its `openssl` keypair step, since the fixture mints one.
- **Cost: this is the slowest tier per assertion, and it is deliberately advisory.** The
  `apphost-testing` job runs `continue-on-error`, exactly as ADC's `apphost-smoke` does under
  [ADR-098](098-aspire-orchestration-not-testing-or-dashboards.md), so a flake reds the job for
  visibility without failing the run and can never gate a release. Promote it out of
  `continue-on-error` only after a green streak; delete it if it proves to be a flake generator.
- **A consumer's real stack still needs Docker on the runner.** The in-repo sample avoids containers
  on purpose, so the framework's own CI does not pay for image pulls, but ADC's AppHost starts SQL
  Server, Redis, RabbitMQ and MailDev. That is why `AppHostEnvironmentRequirement.Docker` is part of
  the inherited default and the sample fixture opts OUT of it
  (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Aspire.AppHostTests/SampleAppHostFixture.cs:42`)
  rather than the other way round.
- **The package count moves from 17 to 18** (`MMCA.Common/FACTS.md:19`), and every `MMCA.Common.*` pin
  in each consumer's `Directory.Packages.props` moves together at the next release
  ([ADR-016](016-lockstep-versioning-masstransit-pin.md)).
- **Aspire versions are now coupled in one more place.** `Aspire.Hosting.Testing` is pinned at the
  same 13.5.3 as every other Aspire entry (`MMCA.Common/Directory.Packages.props:344`), because the
  testing host builds the application model the AppHost package produces; a version split between
  them is a model mismatch rather than an upgrade.

## Related
[ADR-098](098-aspire-orchestration-not-testing-or-dashboards.md) (the orchestration posture this tier
tests without changing),
[ADR-058](058-runtime-conformance-suites-as-a-package.md) (the shipped-test-tier-as-a-package pattern
this record follows),
[ADR-016](016-lockstep-versioning-masstransit-pin.md) (the lockstep release the eighteenth package
joins),
[ADR-025](025-startup-warmup-readiness.md) (why a startup gate probes liveness and a test probes
readiness),
[ADR-012](012-grpc-host-transport.md) (the h2c listener the exact-HTTP/2 probe exists for).
