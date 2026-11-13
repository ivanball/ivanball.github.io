# ADR-117: AppHost Integration Testing as a Shipped Package

## Status
Accepted (2026-09-09). Adds the AppHost test tier
[ADR-098](098-aspire-orchestration-not-testing-or-dashboards.md) left out, as a package rather than a
per-repo copy.

Revised 2026-09-11: both consumer tiers now subclass the package (MMCA.ADC and MMCA.Store), so the
consumer passages are recorded as current state rather than as follow-up work; stale line anchors
refreshed.

Revised 2026-09-19: the Aspire pin reads 13.5.4, the version every Aspire entry now carries; the
2026-09-09 root-cause fix is recorded as ADC #189 alone, because the Store PR previously cited
carried unrelated work.

Revised 2026-10-01: decision 9 shows a non-null skip reason in every consumer.

Revised 2026-10-06: the ADC gateway test asserts liveness (`/alive`) rather than the aggregate
`/health`, and the package's XML documentation now recommends the safe skip branch.

Revised 2026-10-07: the consumer AppHost smoke projects (ADC and Store) and their CI job are removed,
so the consumer passages are restated as history, and MMCA.Common's `apphost-testing` tier is now
blocking and remains where the base is exercised (see Revision below).

Revised 2026-10-07: anchors refreshed after the v1.233.0 release.

Revised 2026-10-21: the Aspire pin reads 13.6.2 on every Aspire entry, decision 9 says the package's
only xUnit reference is `xunit.v3.extensibility.core` rather than its only reference, and anchors
are refreshed.

Revised 2026-10-26: the Aspire pin reads 13.6.4 on every Aspire entry, and anchors are refreshed.

Revised 2026-10-28: decision 8 records that the runtime boundary test covers a subset of the
compile-time rule and that its trailing-dot `MMCA.Common.Aspire.` entry matches nothing, so the
Aspire ban rests on the compile-time gate; anchors are refreshed.

Revised 2026-11-12 (unreleased, on the `feat/fresh-eyes-wave` branch): the package carries
`DependencyOutageTestBase<TFixture>`, which stops and starts a dependency through the orchestrator
and asserts readiness, liveness, the full health report and, when a scenario names an outbox
database, an outbox drain (decision 11); MMCA.Common's `apphost-testing` job runs an outage scenario
over SQL Server and RabbitMQ containers; MMCA.ADC's adoption branch adds an opt-in AppHost outage
tier, which its workflow can build only once the base is released and ADC's pin moves to it; the rejected outbox-drain helper is revisited; anchors are refreshed (see Revision (2026-11-12)).

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

MMCA.ADC proved both the gap and the shape of the answer. Its AppHost smoke project (removed on
2026-10-07, see Revision below) booted the real AppHost through
`DistributedApplicationTestingBuilder` and sat deliberately outside every `.slnx` and `.slnf`, so no
ordinary build picked it up and CI built it by explicit project path. Before this package existed that
project asked the gateway for one health answer, and what it proved is how little of the code around
that answer is ADC-specific: a startup budget, a readiness budget, a poll interval, a poll loop that
treats a connection failure as "not yet", and a teardown. Roughly a hundred lines of infrastructure
guarding a single assertion, which every other repo with an AppHost would copy verbatim to get the
same coverage.

Two preconditions turned out to be load-bearing, and both were learned the expensive way. The ADC
nightly ran red from 2026-09-01 and was root-caused on 2026-09-09 (fixed in ADC #189), each time to
something that presents as a timeout on an unrelated resource:

1. **No RS256 key material.** Identity's `appsettings.json` ships a user-secrets placeholder and a
   CI runner has no user secrets, so the JwtBearer options factory threw on the first request. Every
   request answered 500, including `/alive`, so the liveness probe never turned Identity healthy and
   every `WaitFor(identity)` edge waited out the twelve-minute budget. The framework already has the
   channel for the fix (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:366`,
   `WithE2eRsaKeys()`, which forwards `E2E_JWT_PRIVATE_KEY_PEM` / `E2E_JWT_PUBLIC_KEY_PEM` onto
   `Jwt__*` and `Jwks__*`); what it did not have was anything that put a keypair into those
   variables.
2. **An untrusted HTTPS development certificate.** A resource launched with the `https` profile
   answers its stock health probe over TLS terminated by that certificate. Untrusted on a fresh
   runner, every probe failed with `UntrustedRoot` and the dependent resource's `WaitFor` never
   cleared.

There is a third rule the framework already records and that any shared base must not break: a
startup gate probes LIVENESS, never readiness
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/H2cHealthCheckExtensions.cs:45`, `:90`). A readiness
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
   base (`.../Fixtures/AppHostFixtureBase.cs:41`, `InitializeAsync` at `:105`, `DisposeAsync` at
   `:138`) owns the lifecycle. Starting an orchestrator is
   the most expensive thing in any repo per assertion, so it happens once per collection.

2. **Readiness is awaited per resource, inside one shared budget.**
   `WaitForResourcesAsync` (`.../Fixtures/AppHostFixtureBase.cs:245`) asks
   `ResourceNotificationService.WaitForResourceHealthyAsync` for a resource that carries a
   `HealthCheckAnnotation` (`:260`) and `WaitForResourceAsync(..., KnownResourceStates.Running)` for
   one that carries none (`:272`), and it says which of the two it did in the failure message. The
   budget is a single deadline shared across resources rather than a per-resource allowance
   (`.../Fixtures/AppHostReadinessBudget.cs:37`, `Remaining`), because with five resources a
   per-resource budget makes a stack that wedges on the last one take five times as long to say so.
   A budget that runs out throws a `TimeoutException` naming the resource and the state it never
   reached. Startup and readiness are separate budgets (`:16`), five minutes each by default (`:23`),
   because they fail for different reasons: startup is dominated by container image pulls on a cold
   agent, readiness by migrations, warm-up and the dependency graph.

3. **Preconditions produce a skip with a reason, never a wedge.**
   `AppHostEnvironmentGate.Evaluate`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Aspire/Preconditions/AppHostEnvironmentGate.cs:38`)
   turns a fixture's declared requirements into either "go" or one actionable sentence, which the
   fixture exposes as `SkipReason` / `IsAvailable` (`.../Fixtures/AppHostFixtureBase.cs:56`, `:59`).
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
   `dotnet dev-certs https --trust` as an explicit step. The framework's own `apphost-testing` job
   needs none, because neither of its sample scenarios needs a development certificate, and its
   header says a consumer stack with an https launch profile adds that step
   (`MMCA.Common/.github/workflows/ci.yml:1069`, `:1086-1089`). ADC's outage workflow is such a
   stack and runs the step (`MMCA.ADC/.github/workflows/apphost-tests.yml:64-65`).

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
   The package does reference one provider directly, for one purpose: the outage base's outbox count
   (decision 11) uses `Microsoft.Data.SqlClient` for SQL Server only and leaves any other engine to an
   override (`.../Outages/DependencyOutageTestBase.cs:5`, `:310-342`). That provider is already in
   the graph through `MMCA.Common.Testing`; the direct reference exists because the package's own code
   calls it (`.../MMCA.Common.Testing.Aspire.csproj:25-27`, `:35`).

8. **The package's layer ceiling is `MMCA.Common.Testing`, enforced at compile time, with a runtime gate for part of it.** It reuses
   `JwtTokenGenerator` and reaches Application and API only through that one edge. The compile-time
   gate is `EnforceTestingAspireLayerBoundary`
   (`MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets:219`), which judges the references
   this csproj DECLARES (by `DefiningProjectName`) rather than the transitive closure the SDK folds
   into `@(ProjectReference)` before `ResolveProjectReferences`. The runtime gate is
   `TestingAspireBoundaryTests`
   (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Layering/TestingAspireBoundaryTests.cs:20`),
   which asserts a subset of that rule against the compiled assembly: it forbids Domain,
   Infrastructure, API and UI (`:25`, `:31`, `:37`, `:43`), so for those four a type arriving by a
   path no `ProjectReference` declares is caught too. It does not forbid Application or Grpc, which
   the compile-time gate forbids only as declared references
   (`MMCA.Common.LayerEnforcement.targets:229`, `:231`, `:234`), so a transitive arrival of either is
   caught by neither gate. `MMCA.Common.Aspire` is forbidden at compile
   time (`:236`); the runtime entry for it is written `"MMCA.Common.Aspire."` with a trailing dot
   (`TestingAspireBoundaryTests.cs:51`), and the framework's own note on NetArchTest matching says
   such an entry matches nothing
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Layering/ArchitectureRules.CloudVendors.cs:14-16`),
   so the Aspire ban is in effect enforced by the compile-time gate alone, which leaves a transitive
   arrival of the service-defaults graph unguarded. The reason for the ban:
   the probe paths are MIRRORED constants (`.../Probes/AppHostProbePaths.cs:15-41`) precisely so an
   AppHost-tier package never drags the service-defaults graph into a consumer's test project, and a
   unit test cross-asserts each pair against the framework constant it mirrors.

9. **Skipping is the consuming project's call.** The package takes no dependency on the xUnit
   assertion library (its only xUnit reference is `xunit.v3.extensibility.core`,
   `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Aspire/MMCA.Common.Testing.Aspire.csproj:25`), so a
   test class writes the skip itself, always with a non-null reason: `Assert.SkipWhen(!Fixture.IsAvailable,
   Fixture.SkipReason ?? "...")`
   (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Aspire.AppHostTests/SampleAppHostTests.cs:155`) or
   the `if (!Fixture.IsAvailable) { Assert.Skip(Fixture.SkipReason!); }` branch the package's own
   documentation prescribes
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Aspire/Fixtures/AppHostFixtureBase.cs:34-35`).
   `SkipReason` is null exactly when the stack started, and `SkipWhen` validates its reason before
   the condition, so a null-forgiven `Fixture.SkipReason!` passed to `SkipWhen` throws
   `ArgumentNullException` on the runner the tier exists for (`.../AppHostFixtureBase.cs:36-37`). That
   keeps the skip API where a test project already has it and keeps one more package out of a
   consumer's graph.

10. **The tier runs in CI, blocking, against an in-repo sample.** The `apphost-testing` job carries
    no `continue-on-error`, so a red fails the run, but it is not a required merge check
    (`MMCA.Common/.github/workflows/ci.yml:1069`, `:1074-1075`).
    `Tests/Hosting/MMCA.Common.Testing.Aspire.AppHostTests` boots, in its default scenario, a sample
    AppHost with a SQLite file and ONE sample service project declared as TWO resources, so that
    scenario needs no container runtime (`ci.yml:1082-1084`), and asserts every helper against it.
    The two resources are the two cleartext protocol profiles,
    because a cleartext Kestrel endpoint serves one or the other: `sample` runs `HttpProtocols.Http1`
    for the ordinary probes, and `sample-h2c` runs `HttpProtocols.Http2` alone, which is what h2c
    prior knowledge requires (without TLS there is no ALPN, so an `Http1AndHttp2` endpoint answers
    HTTP/1.1 only and logs that it is doing so). `sample-h2c` is gated with the framework's
    `WithH2cHealthCheck()` rather than Aspire's stock HTTP probe, so the tier proves that helper end
    to end as well: the stock probe speaks HTTP/1.1, and nothing else could have turned that resource
    healthy.

    The same project carries an outage scenario. `SampleOutageTests` derives
    `DependencyOutageTestBase<SampleOutageAppHostFixture>`
    (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Aspire.AppHostTests/SampleOutageTests.cs:23-24`)
    over a SQL Server container (`sql`) and a RabbitMQ container (`rabbitmq`)
    (`.../SampleOutageAppHostFixture.cs:15`, `:21`), and runs a database outage, a broker outage
    that parks one outbox row and asserts it drains, and a raw stop-and-start
    (`SampleOutageTests.cs:30`, `:46`, `:66`). It stops and starts real containers, so the job needs
    Docker and its budget is 40 minutes (`ci.yml:1073`, `:1084-1086`). Because a SQL Server container
    with no data volume comes back from a stop and start with no tables, the sample service keeps its
    own schema: `SampleSchemaKeeper`, a background service, calls `EnsureCreatedAsync` once a second
    (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Aspire.AppHostTests.SampleService/SampleSchemaKeeper.cs:8-15`,
    `:23`, `:41`).

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

11. **A dependency outage is a scenario the base runs, not a script each consumer writes.**
    `DependencyOutageTestBase<TFixture>`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Aspire/Outages/DependencyOutageTestBase.cs:35`)
    derives `AppHostTestBase<TFixture>`, and `RunOutageAsync` (`:82`) runs one scenario end to end. It
    opens with a baseline, `/health/ready` and `/alive` both 200, so a previous scenario must have
    recovered (`:102-106`). It stops the dependency through the orchestrator's stop command and waits
    for `Exited` or `Finished` (`StopResourceAsync`, `:177-200`, the command at `:181`), then polls
    until the full report and readiness answer what the outage kind prescribes (`:115-118`): a
    database outage fails both, while a broker or cache outage fails `/health` and keeps
    `/health/ready` at 200 (`.../Outages/OutageExpectation.cs:18-20`), which is the `optional`
    tagging of [ADR-025](025-startup-warmup-readiness.md). Once those answers are reached, one GET of
    `/alive` must return 200 (`:120-127`); liveness is not polled during the outage wait, the start
    or the recovery. It then runs the scenario's own work, starts the dependency again through the start
    command and waits for it to report healthy (`StartResourceAsync`, `:211-233`), and asserts
    recovery: `/health` and `/health/ready` back at 200 (`:156-160`). A failure while the dependency
    is down still issues the start command once, best effort, so one red scenario does not take the
    next one down (`:148-154`, `:391-394`). No startup waits on readiness: the baseline polls
    `/health/ready` for at most the `Probe` budget and fails the test rather than hanging when it
    does not reach 200 (`:103`, `:290-298`), and readiness is otherwise asserted (`:29-30`), which
    keeps decision 2 and the liveness rule in Context. A probe that fails with an
    `HttpRequestException` or does not answer within 10 seconds counts as "not yet", never as a pass
    (`:52`, `:245-270`, the two catches at `:262` and `:266`); any other exception, for example from
    creating the client (`:251`), fails the test,
    and the waits spend three budgets, `StateChange`, `Probe` and `Drain` (`:183` and `:217`, `:290`, `:353`;
    defaults at `.../Outages/DependencyOutageBudget.cs:16`). The outage answers depend on the
    framework's per-check timeout, `HealthChecks:CheckTimeoutSeconds` (5 seconds by default, 1 to
    60): a check still running when it expires is reported with its failure status, so a dependency
    that does not answer turns `/health` unhealthy instead of leaving the last report in place
    (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Health.cs:50-53`;
    `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Health/HealthReportCacheOptions.cs:55`).

    **The outbox drain is asserted by a helper the package carries.** A broker scenario may name the database
    resource that holds the outbox (any other outage kind that does is refused, `:89-96`); the base
    then asserts at least one row is pending while the broker is down (`:134-143`) and, after
    recovery, polls `AssertOutboxDrainedAsync` (`:351-369`) until the pending count reaches zero. The
    count is the virtual `CountPendingOutboxMessagesAsync` (`:320-342`), which resolves the
    resource's connection string and counts, through `Microsoft.Data.SqlClient`, the rows of
    `OutboxTableName` (default `dbo.OutboxMessages`, `:64`) whose `ProcessedOn` is null; another
    engine overrides it (`:310-315`).

    **Data survival is the consumer's problem, and the base cannot see it.** Starting a stopped
    Aspire container resource recreates the container, so a database container with no data volume
    comes back empty. The base's documentation states it, with the condition a database outage needs
    to recover (a data volume, a persistent lifetime, or a service that rebuilds its own schema;
    `:23-27`, `:70-72`). The base asserts probe status codes only, and a readiness check can pass as
    soon as the database exists, up to one schema-keeper tick before its tables do
    (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Aspire.AppHostTests/SampleOutageTests.cs:118-120`),
    so a recovered readiness does not distinguish a database that kept its data from one that came
    back empty.

## Rationale
Six shapes were weighed. Five rejections are properties the package keeps; the sixth was revisited:

- **Leave it as a per-repo copy.** Rejected: that is what produced roughly a hundred lines of budget
  and poll-loop code in ADC guarding one assertion, and it puts the same copy in every other repo
  that wants the tier. It also leaves the two 2026-09-09 preconditions as tribal knowledge in one
  workflow file rather than as behavior a fixture carries.
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
- **Add a generic outbox-drain helper.** Left out at first, because there is no engine-agnostic HTTP
  signal for "the outbox has drained", so any helper would either poll a database (an ADO provider
  per engine, see decision 7) or poll a consumer-specific endpoint. Revisited on 2026-11-12 and
  adopted in a narrower shape: the outage tier exists to prove that rows parked during a broker
  outage drain, so the base carries `AssertOutboxDrainedAsync` over a virtual SQL Server count, the
  engine both the sample and ADC hold that outbox on
  (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Aspire.AppHostTests/SampleOutageAppHostFixture.cs:15-18`;
  `MMCA.ADC/Tests/Integration/MMCA.ADC.AppHost.OutageTests/AdcOutageAppHostFixture.cs:21-31`), and
  leaves every other engine to an override (decision 11). The engine-agnostic HTTP signal still does
  not exist.

## Trade-offs
- **A consumer's AppHost tier is a subclass; MMCA.ADC carries one, an outage tier.** While both
  consumers ran a smoke tier (2026-09-11 to 2026-10-07), each was a fixture plus a test class over the
  package: ADC's was two files, a fixture whose body was three overrides (`RequiredEnvironment`,
  `Budget` with twelve minutes startup and eight readiness, and `ResourcesToAwait`) and a test class
  over `AppHostTestBase<AdcAppHostFixture>`, and Store's had the same shape. Both smoke projects, and
  the `apphost-smoke` job that ran them, are removed. Each consumer's real AppHost composition is
  exercised instead by its `e2e.yml`, which boots the AppHost for every E2E run, including the
  deploy's chromium `e2e-gate` (`MMCA.ADC/.github/workflows/e2e.yml:34-36`, `:242`;
  `MMCA.Store/.github/workflows/e2e.yml:252`). ADC's outage tier has the same shape again: a fixture
  with those three overrides plus a builder hook
  (`MMCA.ADC/Tests/Integration/MMCA.ADC.AppHost.OutageTests/AdcOutageAppHostFixture.cs:16`, `:59-62`,
  `:68-69`, `:75-76`, `:85`) and a test class over
  `DependencyOutageTestBase<AdcOutageAppHostFixture>` (`AdcDependencyOutageTests.cs:22-23`); see the
  Revision (2026-11-12).
- **Cost: this is the slowest tier per assertion, and it blocks the CI run without being a required
  merge check.** The `apphost-testing` job has no `continue-on-error`, so a red fails the MMCA.Common
  CI run, but it is not a required merge check (`MMCA.Common/.github/workflows/ci.yml:1074-1075`).
  ADC's outage tier runs from its own workflow, which is neither a required check nor a deploy gate
  (`MMCA.ADC/.github/workflows/apphost-tests.yml:10-11`).
- **A real stack, and the framework's outage scenario, need Docker on the runner.** The default
  sample scenario avoids containers on purpose, and its fixture opts OUT of the inherited
  `AppHostEnvironmentRequirement.Docker`
  (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Aspire.AppHostTests/SampleAppHostFixture.cs:42-43`)
  rather than the other way round. The outage fixture keeps the inherited opt-in plus Docker,
  because it stops real containers (`.../SampleOutageAppHostFixture.cs:9`), so the framework's own job
  now pays for SQL Server and RabbitMQ image pulls (`ci.yml:1084-1086`). ADC's AppHost starts SQL
  Server, Redis, RabbitMQ and MailDev (`AdcOutageAppHostFixture.cs:10-11`).
- **The framework carries one more package** (`MMCA.Common.Testing.Aspire`, listed with the current
  count in `MMCA.Common/FACTS.md:43`), and every `MMCA.Common.*` pin
  in each consumer's `Directory.Packages.props` moves together at the next release
  ([ADR-016](016-lockstep-versioning-masstransit-pin.md)).
- **Aspire versions are now coupled in one more place.** `Aspire.Hosting.Testing` is pinned at the
  same 13.6.4 as every other Aspire entry (`MMCA.Common/Directory.Packages.props:444`, against
  `Aspire.Hosting` at `:435`), because the
  testing host builds the application model the AppHost package produces; a version split between
  them is a model mismatch rather than an upgrade.

## Revision (2026-10-01)
No decision or rationale changed. Decision 9 is corrected: it showed
`Assert.SkipWhen(!Fixture.IsAvailable, Fixture.SkipReason!)` as the consumer's skip, a form that
throws `ArgumentNullException` whenever the stack does start, because `SkipReason` is then null and
`SkipWhen` validates its reason first
(`MMCA.ADC/Tests/Integration/MMCA.ADC.AppHost.SmokeTests/AdcAppHostSmokeTests.cs:59-66`). No
consumer uses it; all three supply a non-null reason (decision 9 now cites each). The package's own
XML documentation still recommends the null-forgiven form
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Aspire/Fixtures/AppHostFixtureBase.cs:35`). The ADC
fixture's body is recorded with its third override, `RequiredEnvironment`
(`.../AdcAppHostFixture.cs:31`). The Aspire pin reads 13.6.0 on every Aspire entry
(`MMCA.Common/Directory.Packages.props:362`, `:371`). Refreshed anchors: `ci.yml:958` and `:1000`,
`cross-service-tests.yml:225`, `:268`, `:275` and `:282`.

## Revision (2026-10-06)
No decision or rationale changed.

- The ADC gateway test is `TheGatewayAnswersLiveness`, asserting `AssertAliveAsync("gateway",
  "http")` rather than `AssertHealthyAsync("gateway")`, because the gateway's aggregate `/health`
  probes every backend inside a short budget
  (`MMCA.ADC/Tests/Integration/MMCA.ADC.AppHost.SmokeTests/AdcAppHostSmokeTests.cs:75-97`); the
  Trade-offs passage now says so.
- The 2026-10-01 note that the package's XML documentation recommends the null-forgiven
  `SkipWhen` form no longer holds: it now recommends
  `if (!Fixture.IsAvailable) { Assert.Skip(Fixture.SkipReason!); }` and warns against `SkipWhen`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Aspire/Fixtures/AppHostFixtureBase.cs:32-36`),
  where the `!` is safe because `SkipReason` is non-null inside that branch.
- The Aspire pin still reads 13.6.0 (`MMCA.Common/Directory.Packages.props:359`, `:368`).
- Anchors re-verified against current source: `AppHostFixtureBase.cs`, `H2cHealthCheckExtensions.cs`,
  `AdcAppHostSmokeTests.cs`, `Directory.Packages.props` and `FACTS.md:40`.

## Revision (2026-10-07)
- The consumer AppHost smoke projects (`MMCA.ADC.AppHost.SmokeTests`, `MMCA.Store.AppHost.SmokeTests`)
  and the `apphost-smoke` job in each `cross-service-tests.yml` are removed, along with the consumers'
  `Aspire.Hosting.Testing` pins; the package is now pinned in MMCA.Common only
  (`MMCA.Common/Directory.Packages.props:368`). Context and Trade-offs describe the consumer tiers as
  history, and the anchors into those projects in earlier revisions no longer resolve.
- Each consumer's AppHost composition is exercised by `e2e.yml` booting the real AppHost on every E2E
  run (`MMCA.ADC/AGENTS.md:77`, `MMCA.Store/AGENTS.md:76`).
- MMCA.Common's `apphost-testing` tier is blocking (no `continue-on-error`) and is where the base is
  exercised; it is not a required merge check (`MMCA.Common/.github/workflows/ci.yml:905`, `:910-911`).
  Its `dotnet dev-certs` step is removed, because the sample serves cleartext only (`:918-921`), so
  decision 4 no longer cites one.
- Decision 9 now cites the framework sample test and the package documentation instead of the deleted
  consumer tests. The decision itself is unchanged.
- Anchors re-verified against current source: the job's cleartext, no-dev-certificate header and its
  note that a consumer stack with an https launch profile adds a `dotnet dev-certs https --trust`
  step sit at `MMCA.Common/.github/workflows/ci.yml:918-921` (decision 4 and the item above), while
  the job name (`:905`) and the BLOCKING, not-a-required-check comment (`:910-911`) are unchanged.

## Revision (2026-10-21)
Re-verified against current source. No decision or rationale changed: the `apphost-testing` job is
still blocking with no `continue-on-error` and no dev-certs step, `WithE2eRsaKeys()` still forwards
the two E2E variables onto `Jwt__*` and `Jwks__*`, and the Aspire coupling still holds. What moved is
the pin version, one wording in decision 9, and the anchors.

1. The Aspire pin reads 13.6.2 on every Aspire entry: `Aspire.Hosting` at
   `MMCA.Common/Directory.Packages.props:366`, `Aspire.Hosting.Testing` at `:375`, with the
   same-version rationale comment at `:371-374`. Trade-offs now says so.
2. Decision 9 said the csproj references only `xunit.v3.extensibility.core`. It also references
   `AwesomeAssertions`, `Aspire.Hosting`, `Aspire.Hosting.Testing` and `MinVer`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Aspire/MMCA.Common.Testing.Aspire.csproj:13`,
   `:17`, `:20`, `:21`) and takes a project reference to `MMCA.Common.Testing` (`:32`), so the
   decision now says `xunit.v3.extensibility.core` (`:25`) is its only xUnit reference. The point is
   unchanged: no `xunit.v3.assert` reference exists.
3. Anchors re-verified against current source: `apphost-testing` job at
   `MMCA.Common/.github/workflows/ci.yml:846`, the BLOCKING, not-a-required-merge-check comment at
   `:851-852`, the no-container, no-dev-certificate header and the consumer
   `dotnet dev-certs https --trust` note at `:859-862` (decisions 4 and 10, Trade-offs);
   `WithE2eRsaKeys()` at `MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:365`
   (variables read at `:369-370`, forwarded at `:377-379`). The anchors inside earlier revisions stay
   as written.

## Revision (2026-10-26)
Re-verified against current source. No decision or rationale changed: the `apphost-testing` job is
still blocking with no `continue-on-error` anywhere in `ci.yml` and no dev-certs step,
`WithE2eRsaKeys()` still forwards the two E2E variables onto `Jwt__*` and `Jwks__*`, the layer
boundary target still judges declared references and forbids `MMCA.Common.Aspire`, and the Aspire
same-version coupling still holds. What moved is the pin version and the anchors.

1. The Aspire pin reads 13.6.4 on every Aspire entry: `Aspire.Hosting` at
   `MMCA.Common/Directory.Packages.props:435`, `Aspire.Hosting.Testing` at `:444`, with the
   same-version rationale comment at `:440-443`. Trade-offs now says so.
2. Anchors re-verified against current source: `apphost-testing` job at
   `MMCA.Common/.github/workflows/ci.yml:989`, the BLOCKING, not-a-required-merge-check comment at
   `:994-995`, the no-container, no-dev-certificate header and the consumer
   `dotnet dev-certs https --trust` note at `:1002-1005` (decisions 4 and 10, Trade-offs);
   `WithE2eRsaKeys()` at `MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:366`
   (variables read at `:370-371`, forwarded at `:378-380`); `EnforceTestingAspireLayerBoundary` at
   `MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets:219` (`BeforeTargets` at `:220`,
   the `DefiningProjectName` filter at `:229`, `MMCA.Common.Aspire` forbidden at `:236`);
   `MMCA.Common.Testing.Aspire` in `MMCA.Common/FACTS.md:43`; and in ADC's `e2e.yml` the
   `workflow_call` entry point the deploy's `e2e-gate` uses at
   `MMCA.ADC/.github/workflows/e2e.yml:34-36` and the AppHost launch at `:242`. The anchors inside
   earlier revisions stay as written.

## Revision (2026-10-28)
Re-verified against current source. No decision or rationale changed: the `apphost-testing` job is
still blocking with no `continue-on-error` and no dev-certs step, and both consumers still state
there is no AppHost smoke project. What moved is the description of the runtime layer gate and the
anchors.

1. Decision 8 said `TestingAspireBoundaryTests` asserts "the same rule" as the compile-time gate,
   `MMCA.Common.Aspire` included. The runtime test forbids Domain, Infrastructure, API and UI
   (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Layering/TestingAspireBoundaryTests.cs:25`,
   `:31`, `:37`, `:43`) and not Application or Grpc, which
   `MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets:231` and `:234` forbid. Its
   service-defaults entry is `"MMCA.Common.Aspire."` with a trailing dot (`TestingAspireBoundaryTests.cs:51`), and the framework's
   own note says NetArchTest matches whole namespace segments, so an entry ending in a dot matches
   nothing
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Layering/ArchitectureRules.CloudVendors.cs:14-16`,
   `:27-28`). Decision 8 now says the runtime gate is a subset and that the Aspire ban is enforced
   by the compile-time gate (`MMCA.Common.LayerEnforcement.targets:236`). The test was not run for
   this revision.
2. Anchors re-verified against current source: `apphost-testing` job at
   `MMCA.Common/.github/workflows/ci.yml:1021`, the BLOCKING, not-a-required-merge-check comment at
   `:1026-1027`, the no-container, no-dev-certificate header and the consumer
   `dotnet dev-certs https --trust` note at `:1034-1037` (decisions 4 and 10, Trade-offs); the
   "No AppHost smoke project" rule at `MMCA.ADC/AGENTS.md:79` and `MMCA.Store/AGENTS.md:78`
   (Trade-offs). The anchors inside earlier revisions stay as written.

## Revision (2026-11-12)
The decisions above stand; one is added (decision 11), the Common tier gains an outage scenario,
MMCA.ADC's adoption branch adds an AppHost tier again, and one rejected alternative is revisited. The Revision
(2026-10-07) stays as written: its removal of the consumer smoke projects still holds, and ADC's new
tier is an outage tier, not the smoke project returning.

1. **The package carries an outage base.** `DependencyOutageTestBase<TFixture>`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Aspire/Outages/DependencyOutageTestBase.cs:35`)
   stops and starts a dependency through the orchestrator's commands (`:181`, `:215`) and asserts
   readiness, liveness, the full report and, when a scenario names the outbox database, an outbox
   drain (`:134`, `:162`). Decision 11
   records it.
2. **The Common tier runs it.** `SampleOutageTests`
   (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Aspire.AppHostTests/SampleOutageTests.cs:23-24`)
   runs a database, a broker and a stop-and-start scenario over SQL Server and RabbitMQ containers, so
   the `apphost-testing` job needs Docker and runs under a 40-minute budget
   (`MMCA.Common/.github/workflows/ci.yml:1073`, `:1084-1086`). The sample service rebuilds its
   schema in `SampleSchemaKeeper` because a recreated container comes back empty
   (`.../SampleService/SampleSchemaKeeper.cs:12-15`). Decision 10 and Trade-offs now say so.
3. **ADC's AppHost tier returns as an opt-in outage tier.**
   `Tests/Integration/MMCA.ADC.AppHost.OutageTests` boots the real ADC AppHost and runs two scenarios
   on the Notification service's probes: a Redis (cache) outage and a RabbitMQ (broker) outage
   (`MMCA.ADC/Tests/Integration/MMCA.ADC.AppHost.OutageTests/AdcDependencyOutageTests.cs:26`, `:45`;
   `AdcOutageAppHostFixture.cs:37`). The broker scenario registers an attendee through the gateway
   while the broker is down and asserts that Identity's outbox drains afterwards
   (`AdcDependencyOutageTests.cs:58-59`, `:73-97`). It runs on throwaway containers: the fixture moves
   every container the AppHost declares persistent to the session lifetime and refuses to start,
   throwing, if any container still reads as persistent (`AdcOutageAppHostFixture.cs:111-127`, the
   check at `:136-147`). There is deliberately no SQL Server scenario: a recreated SQL Server comes
   back with empty databases and the services migrate only at start, so a recovered readiness would be
   asserted over services whose schema is gone (`AdcDependencyOutageTests.cs:14-19`). The fixture
   requires the opt-in variable, Docker and a development certificate
   (`AdcOutageAppHostFixture.cs:59-62`); the certificate gate checks only that one is present and not
   expired in the current user's store, never that it is trusted
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Aspire/Preconditions/DeveloperCertificateAvailability.cs:30-35`,
   `:44-53`), and each test skips with the gate's reason when one is
   missing (`AdcDependencyOutageTests.cs:28-31`); the opt-in is `MMCA_APPHOST_TESTS`, which the
   workflow sets (`MMCA.ADC/.github/workflows/apphost-tests.yml:74`). The project sits outside
   `MMCA.ADC.slnx` and both solution filters (`apphost-tests.yml:11-12`). It takes
   `MMCA.Common.Testing.Aspire` as a package
   (`MMCA.ADC/Tests/Integration/MMCA.ADC.AppHost.OutageTests/MMCA.ADC.AppHost.OutageTests.csproj:14`)
   pinned at 1.288.0 (`MMCA.ADC/Directory.Packages.props:183`), a release that predates the outage
   base, so it builds only in local source mode until MMCA.Common releases the base and ADC's pin
   moves to that release; the workflow below cannot build it before then.
4. **ADC runs it from a non-required workflow.** `apphost-tests.yml` triggers on `workflow_dispatch`,
   on a weekly schedule (`cron: "0 7 * * 2"`, Tuesdays about 07:00 UTC) and on a pull request that
   touches `Source/Hosting/MMCA.ADC.AppHost/**`, `Source/Services/**`,
   `Tests/Integration/MMCA.ADC.AppHost.OutageTests/**` or `Directory.Packages.props`
   (`apphost-tests.yml:15-25`). It is not a required check and not in `deploy.needs` (`:10-11`), it
   tries to trust the development certificate first and, when trusting fails, only creates an
   untrusted one (`dotnet dev-certs https --trust || dotnet dev-certs https`, `:64-65`), which the
   presence-only gate accepts, and `--minimum-expected-tests 1` keeps a run
   that discovered nothing red (`:13`, `:72`).
5. **The outbox-drain helper is revisited.** The Rationale's "Add a generic outbox-drain helper"
   item now records the 2026-11-12 adoption of `AssertOutboxDrainedAsync` over a virtual SQL Server
   count (`DependencyOutageTestBase.cs:320-342`, `:351-369`), and decision 7 notes the one ADO
   provider that brings.
6. **Anchors re-verified against current source:** `apphost-testing` job at
   `MMCA.Common/.github/workflows/ci.yml:1069`, the BLOCKING, not-a-required-merge-check comment at
   `:1074-1075`, the default-scenario, outage-scenario and consumer `dotnet dev-certs https --trust`
   header at `:1082-1089` (decisions 4 and 10, Trade-offs). The anchors inside earlier revisions stay
   as written.

## Related
[ADR-098](098-aspire-orchestration-not-testing-or-dashboards.md) (the orchestration posture this tier
tests without changing),
[ADR-058](058-runtime-conformance-suites-as-a-package.md) (the shipped-test-tier-as-a-package pattern
this record follows),
[ADR-016](016-lockstep-versioning-masstransit-pin.md) (the lockstep release this package joins),
[ADR-025](025-startup-warmup-readiness.md) (why a startup gate probes liveness and a test probes
readiness, and the `optional` tagging the outage base asserts),
[ADR-003](003-outbox-dual-dispatch.md) (the outbox whose drain the outage base asserts),
[ADR-012](012-grpc-host-transport.md) (the h2c listener the exact-HTTP/2 probe exists for).
