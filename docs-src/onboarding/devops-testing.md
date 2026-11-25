# Testing Architecture & Solution Composition

> **Chapter scope note.** The tier chapters (`tier-00` through the sweep) document every type
> in the production codebase one by one. Test types are the logged exception: this chapter covers
> the **4,654** types that live in test projects, grouped by project purpose and foundational
> infrastructure, not written as one section per `[Fact]`. Individual test methods are cited only
> as worked examples. Cross-reference the tier chapters for the production types being tested.
> The counts come from the Roslyn inventory (`00-inventory.md:25-135`), which scans
> `MMCA.Common/Source`, `MMCA.Common/Tests`, `MMCA.ADC/Source` and `MMCA.ADC/Tests` only
> (`00-inventory.md:3-4`): MMCA.Store and MMCA.Helpdesk test types are named in this chapter where
> they carry a decision, but they are not in those totals.

This chapter teaches the complete testing architecture of the MMCA workspace: how the solutions are
sliced, which CI filter sees which tests, how Microsoft Testing Platform differs from VSTest, the
shipped testing-infrastructure NuGet packages, the architecture fitness-function suites that act
as executable governance, the runtime conformance suites that check a really booted host, the
integration and E2E strategies, three worked examples, and the CI gates that decide which tier
blocks which merge or which deploy, including the freshness gates that block on a proof produced
elsewhere, the behavioral gate over the AI session scorer, and the two cross-repo gates that build a
different repo than the one being changed.

---

## 1. Solution composition and the test runner

### Solution files: slnx vs. slnf

The two deployed apps use the same two-file pattern; MMCA.Common and MMCA.Helpdesk ship a `.slnx`
only, because their solutions are already fast enough not to need a CI subset:

| File | Purpose |
|---|---|
| `MMCA.Common.slnx` | Full human solution, 25 source projects + 21 test projects (no `.slnf`) |
| `MMCA.Helpdesk.slnx` | Full seed solution, three test projects, no database needed (no `.slnf`) |
| `MMCA.ADC.slnx` | Full human solution, all source + all 32 in-solution test projects (`MMCA.ADC/MMCA.ADC.slnx:67-129`) |
| `MMCA.ADC.CI.slnf` | CI fast path, source + unit/architecture/UI/host tests only |
| `MMCA.ADC.Integration.slnf` | SQL-gated per-service integration tests only |
| `MMCA.Store.CI.slnf` / `MMCA.Store.Integration.slnf` | Store's pair, mirroring the ADC split |

`MMCA.ADC.CI.slnf` (`MMCA.ADC/MMCA.ADC.CI.slnf:1-68`) includes 36 source projects
(`MMCA.ADC.CI.slnf:5-40`) and 25 test projects (`MMCA.ADC.CI.slnf:41-65`): every per-module unit and
UI suite across Identity, Conference, Engagement and Notification, the AI scoring evaluation suite
`MMCA.ADC.Conference.Scoring.Evaluation.Tests` (`MMCA.ADC.CI.slnf:52`), plus
`MMCA.ADC.Architecture.Tests`, `MMCA.ADC.Gateway.Tests` and `MMCA.ADC.Services.Tests`
(`MMCA.ADC.CI.slnf:62-65`). It deliberately excludes:

- the four per-service integration projects (`MMCA.ADC.{Identity,Conference,Engagement,Notification}.IntegrationTests`)
- the two Testcontainers tiers (`MMCA.ADC.CrossService.IntegrationTests`, `MMCA.ADC.ServiceBusEmulator.IntegrationTests`)
- `Tests/E2E/MMCA.ADC.E2E.Tests`
- the Aspire `AppHost`, the MAUI `MMCA.ADC.UI` project, and the frozen combined migrations archive
- `MMCA.ADC.AppHost.OutageTests`, which sits outside `MMCA.ADC.slnx` altogether (`MMCA.ADC/MMCA.ADC.slnx:107-110`)

Why: the integration tests need a real SQL Server (the `ADC_TEST_SQL_BASE` connection string points
to a CI SQL service container), the Testcontainers tiers need a Docker daemon, and the E2E tests need
the full Aspire stack running. None of that is available in the fast build job, so each is gated by
its own job with its own prerequisites.

**Read the gating carefully, it is easy to state wrongly.** ADC's `integration-tests` job is
**pull-request-only** (`MMCA.ADC/.github/workflows/deploy.yml:900`, with the reasoning at
`deploy.yml:895-899`) and is **not** in the `deploy` job's `needs` list (`deploy.yml:1573`). Its
sibling `build-and-test` is pull-request-only for the same stated reason (`deploy.yml:303-306`). The
comment under the `needs` list spells it out (`deploy.yml:1574-1576`): with strict branch protection
the PR validated the exact merge tree, so those jobs are required PR checks rather than push-time
deploy gates, and they are not re-run on the merge push. The required contexts are exactly four,
`build-and-test`, `supply-chain`, `integration-tests` and `coverage`, as the repo's own contributing
guide records twice (`MMCA.ADC/CONTRIBUTING.md:38-41` and `CONTRIBUTING.md:80-81`).

What actually blocks the deploy is `supply-chain`, `cost-guard`, the `freshness` job with its **four**
steps (`dr-freshness`, `load-freshness`, `cross-service-freshness`, `cross-browser-freshness`),
`foundation`, `build-images`, and two conditional gates: the chromium `e2e-gate` on a UI diff and
`ai-eval-gate`, the paid live judge of the AI session scorer, on a scoring-code diff
(`MMCA.ADC/.github/workflows/deploy.yml:1573`, condition at `deploy.yml:1597-1611`). A backend-only
deploy runs no test job on the push, and that is safe by construction: the PR's `build-and-test` is the
test gate, because branch protection enforces admins and requires an up-to-date branch, so the PR run
covers the exact tree that merges and no post-merge job re-runs those tiers (`deploy.yml:1574-1576`,
and the `e2e-gate` comment at `deploy.yml:1194-1198`). The post-deploy smoke gate is the post-rollout
backstop behind it.
[Rubric §17, DevOps & Deployment]: §17 assesses how consistently CI/CD enforces quality gates; the
two-filter pattern is how the build stays fast on every push while the SQL-dependent tier still has
to be green before a PR can merge at all, and branch protection that binds admins too is how "no production deploy
without test execution" survives both of those optimizations.

**MMCA.Store has the same shape minus `ai-eval-gate`.** Its `deploy` job needs
`[changes, supply-chain, cost-guard, freshness, e2e-gate, foundation, build-images]`
(`MMCA.Store/.github/workflows/deploy.yml:1084`), and its PR `build-and-test` is the test gate under the
same branch protection.

`MMCA.ADC.Integration.slnf` (`MMCA.ADC/MMCA.ADC.Integration.slnf:5-8`) contains exactly four
projects, one per service host: Identity, Conference, Engagement and Notification. These are the
per-service `WebApplicationFactory` integration tests that replaced the combined
`MMCA.ADC.IntegrationTests` project, which has since been **deleted from disk**, not merely
excluded (as is `MMCA.ADC.WebAPI.Tests`, whose middleware coverage was consolidated upstream into
`MMCA.Common.API.Tests`); neither appears in the solution, whose comment above the integration folder
now records only where each remaining tier runs (`MMCA.ADC/MMCA.ADC.slnx:107-110`). `MMCA.Store.Integration.slnf` is the same shape over Catalog, Sales and
Identity (`MMCA.Store/MMCA.Store.Integration.slnf:5-7`).

`MMCA.Common.slnx` holds the framework's source projects (the published package list itself is owned
by `MMCA.Common/FACTS.md`): the meta package `MMCA.Common` (`MMCA.Common/MMCA.Common.slnx:11`), eight
Core (`.AI`, `.AI.Anthropic`, `.AI.OpenAI`, `.Shared`, `.Domain`, `.Application`, `.Infrastructure`,
`.Passkeys`, lines 14-21), five Presentation (`.API`, `.Mcp`, `.Grpc`, `.UI`, `.UI.Web`, lines 24-28), and
fifteen Hosting (`.Aspire`, `.Aspire.Hosting`, `.Aws`, `.Azure`, `.Azure.Startup`, `.Gateway`, `.Gcp`,
`.ServiceHost`, `.Testing`, `.Testing.Architecture`, `.AI.Testing`, `.Testing.Aspire`, `.Testing.Azure`,
`.Testing.E2E`, `.Testing.UI`, lines 31-45), plus **twenty-five** test projects (lines 49-79). The MAUI package, `MMCA.Common.UI.Maui`, sits **outside the
`.slnx`** on purpose: its four MAUI target frameworks cannot build on the ubuntu runners the
solution's CI uses, so it is built and packed by a dedicated windows job
(`MMCA.Common/.github/workflows/ci.yml:269`, rationale in the comment above the job,
`ci.yml:265`,
[ADR-042](https://ivanball.github.io/docs/adr/042-device-capability-abstraction.html)). Twelve test
projects are **also intentionally absent from the `.slnx`**:

- `Tests/Presentation/MMCA.Common.UI.Gallery`, a backend-less Blazor host that renders the real
  login and register pages, a UI-primitives showcase and the notification pages; it exists solely to
  give Playwright something to hit (`ci.yml:335-337`).
- `Tests/Presentation/MMCA.Common.UI.E2E.Tests`, the axe-core + render-smoke suite that hits
  the Gallery.
- `Tests/Core/MMCA.Common.Infrastructure.Redis.Tests`, which runs `DistributedCacheService` against a
  real Redis via Testcontainers (so the unit loop needs no Docker).
- `Tests/Performance/MMCA.Common.Benchmarks`, the BenchmarkDotNet suite behind the ADR-060
  performance gate (see section 7).
- `Tests/Core/MMCA.Common.Infrastructure.PostgreSQL.Tests`, which runs the shipped
  `PostgreSQLDbContext` against a real PostgreSQL via Testcontainers, together with the built-in PostgreSql broker transport
  (the framework's own Npgsql transport) over the same container (`ci.yml:1088-1091`, run step at `ci.yml:1128`).
- `Tests/Core/MMCA.Common.Infrastructure.SQLServer.Tests`, which runs the shipped
  `SQLServerDbContext` and `DbContextFactory` against a real SQL Server via Testcontainers
  (`ci.yml:1192`, run step at `ci.yml:1239`).
- `Tests/Core/MMCA.Common.Infrastructure.RabbitMq.Tests`, which runs the shared broker conformance
  scenarios against the built-in RabbitMQ broker transport on a real RabbitMQ (`ci.yml:1145-1150`, run
  step at `ci.yml:1180`).
- `Tests/Hosting/MMCA.Common.Azure.ServiceBusEmulator.Tests`, which runs the native Service Bus
  transport of `MMCA.Common.Azure` against the official emulator through `ServiceBusEmulatorFixtureBase`
  (`ci.yml:1384-1391`, run step at `ci.yml:1425`).
- `Tests/Hosting/MMCA.Common.Aws.LocalStack.Tests`, which runs the `MMCA.Common.Aws` adapter against
  LocalStack: the S3-compatible store, the SQS/SNS broker transport, Secrets Manager configuration, the
  DataProtection key ring and SNS push (`ci.yml:1251`, run step at `ci.yml:1299`).
- `Tests/Hosting/MMCA.Common.Gcp.Emulator.Tests`, which runs the `MMCA.Common.Gcp` adapter against
  fake-gcs-server (Cloud Storage and the DataProtection key ring) and the Firestore emulator (the FCM
  installation registry) (`ci.yml:1311`, run step at `ci.yml:1365`).
- `Tests/Hosting/MMCA.Common.Testing.Aspire.AppHostTests`, which boots a sample AppHost through
  `Aspire.Hosting.Testing`; its two companion sample projects are out of the `.slnx` with it
  (`ci.yml:1512-1514`).
- `Tests/Performance/MMCA.Common.LoadTests`, the weekly load tier, which runs from its own workflow
  rather than from `ci.yml` (`MMCA.Common/.github/workflows/load-tests.yml:10-12`, section 7).

The exclusions are not all for the same reason, and the comments say which is which. The gallery pair
and the benchmark suite are out so `dotnet test --solution MMCA.Common.slnx` stays fast (no browser
install, no benchmark wall clock: `ci.yml:337-338` and `ci.yml:513`); the Redis, PostgreSQL, RabbitMQ, SQL Server,
AWS LocalStack, Google Cloud emulator, Azure Service Bus emulator and AppHost projects are out because they need a **Docker daemon** or a real orchestrator that the
fast unit loop must not require (`ci.yml:1057`, `ci.yml:1115`, `ci.yml:1229`,
`ci.yml:1288`, `ci.yml:1354`, `ci.yml:1512`), and the load tier is out because a timing tier on shared runners is a trend
signal rather than a merge gate (`load-tests.yml:10-12`). Each runs in its own CI job or workflow,
built by csproj path, for example
`dotnet test --project Tests/Presentation/MMCA.Common.UI.E2E.Tests/MMCA.Common.UI.E2E.Tests.csproj`
(`ci.yml:496`) and the Redis tier at `ci.yml:1068`.
[Rubric §28, Front-End Testing & Quality]: §28 assesses whether UI components have automated
tests; the Gallery + E2E split is the mechanism that adds browser-level coverage without slowing
the primary test loop.

### Microsoft Testing Platform (MTP), not VSTest

All four repos share one `global.json` structure:

```json
{
  "test": {
    "runner": "Microsoft.Testing.Platform"
  }
}
```

(`MMCA.Common/global.json:1-5`, identical in `MMCA.ADC/global.json`, `MMCA.Store/global.json` and
`MMCA.Helpdesk/global.json`)

This selects **MTP** as the test runner instead of the legacy VSTest runner. The practical
consequences:

1. **Exit code 8**, if a test project discovers zero tests MTP exits 8, not 0. Every CI
   `dotnet test` call passes `--minimum-expected-tests` with a floor sized to the tier it runs, so
   a discovery regression is a visible failure rather than a silent skip: `11250` for the whole
   MMCA.Common solution, run once per target framework by the `build-and-test-tfm` matrix
   (`MMCA.Common/.github/workflows/ci.yml:109-110`, `ci.yml:185`), `1` for the browser tier
   (`ci.yml:496`), `1` for the AppHost tier (`ci.yml:1514`), `40` for the cross-repo Helpdesk canary
   (`ci.yml:816`), a floor sized to each Testcontainers tier (`14` for Redis at
   `ci.yml:1068`, `20` for PostgreSQL at `ci.yml:1128`, `8` for RabbitMQ at `ci.yml:1180`, `5` for SQL Server
   at `ci.yml:1239`,
   `18` for AWS LocalStack at `ci.yml:1299`, `14` for the Google Cloud emulator at `ci.yml:1365` and `6`
   for the Azure Service Bus emulator at `ci.yml:1425`),
   and on the ADC side a solution-wide `5000` for the `CI.slnf` pass
   (`MMCA.ADC/.github/workflows/deploy.yml:447`: the measured total rounded down, so a few deleted
   tests do not trip it while a breakage that drops a whole project does, `deploy.yml:437-441`), `450`
   for the `Integration.slnf` pass (`deploy.yml:1037`, reasoning at `deploy.yml:1033-1034`) and `1` for the
   `ai-eval-gate` replay step, whose comment states the reasoning in one line: a filter or discovery
   breakage that runs zero tests must fail here, not report a vacuous pass (`deploy.yml:698-699`); the ADC AppHost outage tier carries the same `1`
   (`MMCA.ADC/.github/workflows/apphost-tests.yml:98`). The one invocation deliberately
   without a floor is the paid live judge of `ai-eval-gate` (`deploy.yml:705-713`): without `AI_API_KEY`
   (mapped from the `ANTHROPIC_API_KEY` repository secret, `deploy.yml:714-717`) every case skips itself
   dynamically, and a zero-run there must not red a deploy on a repo whose secret is absent
   (`deploy.yml:706-708`).

2. **Filter syntax differs.** You pass a `--` separator and then MTP's own filter flags:
   ```bash
   # Run a single test class
   dotnet test --project Tests/Modules/Identity/MMCA.ADC.Identity.Domain.Tests/MMCA.ADC.Identity.Domain.Tests.csproj \
     -- --filter-class "*UserTests*"

   # Run a single test method
   dotnet test --project Tests/Modules/Identity/MMCA.ADC.Identity.Domain.Tests/MMCA.ADC.Identity.Domain.Tests.csproj \
     -- --filter-method "*Create_WithValidData_ReturnsSuccess*"
   ```
   The flags are `--filter-class` and `--filter-method`, not the VSTest `--filter FullyQualifiedName~...`
   form. Always target `--project <csproj>`, never a bare directory path. Passing the wrong flag is a
   quiet failure mode: the run exits non-zero having discovered zero tests rather than telling you the
   filter was unrecognized.

3. **Running compiled test binaries directly.** Because the headless CI environment has no
   reachable SQL, integration tests build but cannot be run-verified via `dotnet test`. The
   workaround is to run the compiled `.Tests.exe` directly for unit tests:
   `./bin/Release/net10.0/MMCA.Common.Shared.Tests.exe`, the MTP binary is self-contained.
   [Rubric §33, Developer Experience & Inner Loop]: §33 assesses the friction of the local
   development cycle; MTP's self-hosted test binaries and the explicit `--minimum-expected-tests`
   guard both reduce "tests silently went away" surprises.

---

## 2. Test project layout

The inventory below is drawn from `00-inventory.md:25-135` (test-assembly counts) and the solution
files above. Counts are distinct types per project as reported by the Roslyn inventory scan, not
`[Fact]` counts.

### MMCA.Common, 3,229 test types across 25 in-solution projects + 160 across 12 out-of-solution

**Unit, Core layer**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.Shared.Tests` | 73 | Unit tests for the Result pattern, `Error`, `ErrorType`, value objects, DTO contracts, supported cultures |
| `MMCA.Common.Domain.Tests` | 73 | Unit tests for entity hierarchy, aggregate root, domain events, specifications, soft-delete, PII redaction |
| `MMCA.Common.Application.Tests` | 535 | Unit tests for CQRS dispatcher, decorator pipeline, module loader, `IMessageBus`, validators, query pipeline, the exportable-user-data handler base, tenant-scoped cache keys and `ICacheService.GetOrCreate` |
| `MMCA.Common.Infrastructure.Tests` | 760 | Unit/integration tests for EF base contexts, outbox processor, repository, caching, JWT generation, JWKS provider, data-source resolver, two-factor and email-confirmation token services, plus the `Scheduling/`, `Persistence/Tenancy/`, `Persistence/AuditTrail/`, `Persistence/InternalCommands/` and hybrid-cache subtrees |
| `MMCA.Common.Infrastructure.Tests.MigrationsFixture` | 1 | A single-type companion project that gives the infrastructure suite a real migrations assembly to point EF at |
| `MMCA.Common.AI.Tests` | 41 | The `MMCA.Common.AI` package's decorator chain over `IChatClient`: `BoundedChatClientTests`, `GuardrailChatClientTests`, `PromptTaggingChatClientTests`, `UsageRecordingChatClientTests`, `PromptContractTests`, `AiSettingsTests`, `AiProviderSelectionTests` and `AiServiceCollectionExtensionsTests`, plus three subtrees: `Providers/` (`AdapterFactoryTests`, `ProviderTagTests`), `Guardrails/` (request redaction, content policy, tool policy, streamed guardrails and their registration) and `Evaluation/` (`ReplayChatClientTests`, `RecordedResponsesTests` and the reference golden-replay and prompt-contract suites), driven by a `StubChatClient`/`StubGuardrail` pair in `Fixtures/` (`MMCA.Common/MMCA.Common.slnx:49`) |
| `MMCA.Common.Passkeys.Tests` | 12 | The tests of the `MMCA.Common.Passkeys` package (`MMCA.Common/MMCA.Common.slnx:55`) |

**Unit, Presentation layer**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.API.Tests` | 382 | Tests for `ApiControllerBase`, exception handlers, idempotency filter, the shared middleware pipeline, JWKS endpoint (also the consolidated home of the ADC/Store middleware coverage), session-cookie auth, CSV export and tenant resolution |
| `MMCA.Common.Mcp.Tests` | 9 | The tests of the `MMCA.Common.Mcp` package (`MMCA.Common/MMCA.Common.slnx:59`) |
| `MMCA.Common.Grpc.Tests` | 29 | Tests for `GrpcResultExceptionInterceptor`, `JwtForwardingClientInterceptor`, Result to `RpcException` mapping, the wire format and resilience handler (`GrpcWireFormatTests`, `ResilienceHandlerTests`, `ResilienceCircuitBreakerFaultInjectionTests`), and the service-token pair: `ServiceTokenClientInterceptorTests` plus the `Authentication/` subtree (provider, settings, client registration, default-scheme guard and the server-side authentication handler) |
| `MMCA.Common.UI.Tests` | 421 | bUnit component tests for shared Blazor components (login/register forms, nav, theming, notification pages) |
| `MMCA.Common.UI.Web.Tests` | 57 | The Blazor Web host layer: `ServerTokenStorageService`, `BlazorCspPolicyProvider`, `WebFormFactor`, the client-config endpoint (`ClientConfig/ClientConfigEndpointTests`), the trusted-caller header (`Security/TrustedCaller*Tests`) and the UI-host hardening kit (`Hardening/BoundedCircuitHandlerTests`, `Hardening/UiRateLimitingTests`) |

**Hosting**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.Aspire.Tests` | 63 | Tests for `AddServiceDefaults`, health-check registration, `OutboxPollFilterProcessor` telemetry suppression, the warmup readiness gate, metrics/trace-ratio toggles, security headers, the Kestrel endpoint extensions and the `Integrations/HostIntegrationTripwireTests` suite (the Key Vault and data-protection extension tests live with the vendor adapters in `MMCA.Common.Azure.Tests` and its AWS and Google Cloud siblings) |
| `MMCA.Common.Aspire.Hosting.Tests` | 16 | The AppHost-side resource builders the framework ships for consumer AppHosts |
| `MMCA.Common.Azure.Startup.Tests` | 8 | The tests of the `MMCA.Common.Azure.Startup` package (`MMCA.Common/MMCA.Common.slnx:69`) |
| `MMCA.Common.ServiceHost.Tests` | 9 | The tests of the `MMCA.Common.ServiceHost` package (`MMCA.Common/MMCA.Common.slnx:72`) |
| `MMCA.Common.Gateway.Tests` | 20 | The shared YARP gateway kit: the rate-limit partitioning, correlation and downstream-readiness behavior the two app gateways inherit |
| `MMCA.Common.Testing.Tests` | 59 | The framework dogfooding its own shipped test bases and helpers: `DecoratorPipelineOrderTests` and `MiddlewarePipelineOrderTests`, `MmcaGatewayHardeningTestsBaseTests`, `HandlerTestBaseTests`, `CrossServiceFixtureBaseTests`, `DependencyInjectionAssertTests`, `FeatureManagementTestExtensionsTests`, `JwtTokenGeneratorTests`, `RateLimiterTestExtensionsTests`, `RecordingHttpForwarderTests` and `TestPollingTests`, plus `CrossServiceHostIsolationTests`, the OpenAPI breaking-change detector (`OpenApiBreakingChangeDetectorTests`, `OpenApiBreakingChangeDetectorParameterTests`, `OpenApiContractTestsBaseBaselineTests`) and the tenant-resolution conformance pair (`TenantResolutionConformanceTests`, `TenantResolutionTestsBaseTests`) |
| `MMCA.Common.Testing.Aspire.Tests` | 15 | The unit tier over the shipped `MMCA.Common.Testing.Aspire` package: `AppHostReadinessBudgetTests`, the three precondition gates (`AppHostEnvironmentGateTests`, `DockerAvailabilityTests`, `DeveloperCertificateAvailabilityTests`), `EphemeralRsaKeyPairTests`, and `AppHostProbePathsTests` plus the two h2c probe suites (`MMCA.Common/MMCA.Common.slnx:73`) |
| `MMCA.Common.Testing.Azure.Tests` | 6 | The container-free contract of the shipped `ServiceBusEmulatorFixtureBase`: the emulator image pin, the bounded-phase budgets, the admin-plane connection string, the transport host configuration, the not-started guards and the consumed-message recorder (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Azure.Tests/Fixtures/ServiceBusEmulatorFixtureBaseTests.cs:20`) |
| `MMCA.Common.Testing.E2E.Tests` | 12 | The E2E settings parse: millisecond timeouts read with the invariant culture, and zero, negative or non-finite values fall back to the default (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.E2E.Tests/Infrastructure/E2ETestConfigurationTests.cs:21`) |
| `MMCA.Common.Azure.Tests` | 34 | The Azure adapter package with no Azure resource: the Service Bus transport and emulator detection, Notification Hubs push and device registration, Blob storage, Key Vault configuration, the DataProtection key ring, the Monitor exporter, and the vendor-boundary rules (`MMCA.Common/Tests/Hosting/MMCA.Common.Azure.Tests/Messaging/AzureServiceBusTransportTests.cs:20`) |
| `MMCA.Common.Aws.Tests` | 39 | The AWS adapter package with no AWS account: the SQS transport, S3 storage, SNS push and device registration, RDS IAM authentication, Secrets Manager configuration and the DataProtection key ring; the same surface runs against LocalStack in `MMCA.Common.Aws.LocalStack.Tests` (`MMCA.Common/Tests/Hosting/MMCA.Common.Aws.Tests/Messaging/AmazonSqsTransportTests.cs:21`) |
| `MMCA.Common.Gcp.Tests` | 31 | The Google Cloud adapter package with no project: Cloud Storage, the KMS-encrypted GCS key ring, FCM push and device registration, Secret Manager configuration, Cloud SQL IAM authentication and the telemetry token source; the emulator tier is `MMCA.Common.Gcp.Emulator.Tests` (`MMCA.Common/Tests/Hosting/MMCA.Common.Gcp.Tests/Storage/GcsFileStorageServiceTests.cs:21`) |

**Architecture**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.Architecture.Tests` | 524 | Thin subclasses of the shared bases plus the Common-only `*FitnessTests` family, alongside `CommonArchitectureMap` and the fake modules, drifted probes and fixtures the adversarial suites drive (see section 4) |

**Out-of-solution (each run by its own dedicated CI job or workflow)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.Common.UI.Gallery` | 15 | Backend-less Blazor host; renders the real login/register pages, a primitives showcase and the notification pages for Playwright to hit |
| `MMCA.Common.UI.E2E.Tests` | 42 | Playwright axe-core WCAG 2.1 AA scans, render smoke, dark mode, web vitals, pseudo-localization and mobile top row against the Gallery |
| `MMCA.Common.Infrastructure.Redis.Tests` | 4 | `DistributedCacheService` against a real Redis via Testcontainers (storage FORMAT fidelity: a mocked `IDistributedCache` cannot answer WRONGTYPE) |
| `MMCA.Common.Benchmarks` | 6 | BenchmarkDotNet hot-path suite behind the ADR-060 performance gate (section 7) |
| `MMCA.Common.Infrastructure.PostgreSQL.Tests` | 21 | `PostgreSQLPersistenceTests` drives the shipped `PostgreSQLDbContext` against a real PostgreSQL container, with its own `PgThing` fixture aggregate, events and a recording dispatcher, and `PostgreSqlBrokerTransportTests` runs the built-in PostgreSql broker transport over the same container (header round trip, delayed redelivery, shared data-source authentication) (`MMCA.Common/.github/workflows/ci.yml:1088-1091`) |
| `MMCA.Common.Testing.Aspire.AppHostTests` | 6 | `SampleAppHostFixture`, `SampleAppHostCollection` and `SampleAppHostTests`: a sample AppHost booted through the shipped `MMCA.Common.Testing.Aspire` fixtures, plus the outage scenario `SampleOutageAppHostFixture`, `SampleOutageCollection` and `SampleOutageTests` over `DependencyOutageTestBase` (`ci.yml:1451-1459`, run at `ci.yml:1514`) |
| `MMCA.Common.Infrastructure.SQLServer.Tests` | 16 | The shipped `SQLServerDbContext` and `DbContextFactory` against a real SQL Server container: session-scoped `SET IDENTITY_INSERT`, server-issued rowversions and the outbox row landing in the same `SaveChanges` as its aggregate (`ci.yml:1201-1203`) |
| `MMCA.Common.Infrastructure.RabbitMq.Tests` | 2 | The built-in RabbitMQ broker transport against a real RabbitMQ container: fanout, delay-queue redelivery, the error queue and competing consumers (`ci.yml:1145-1150`, run at `ci.yml:1180`) |
| `MMCA.Common.Azure.ServiceBusEmulator.Tests` | 9 | The native Service Bus transport of `MMCA.Common.Azure` against the official emulator through `ServiceBusEmulatorFixtureBase`: topology acceptance, subscription forwarding, scheduled redelivery and native dead-lettering (`ci.yml:1384-1391`, run at `ci.yml:1425`) |
| `MMCA.Common.Aws.LocalStack.Tests` | 18 | The `MMCA.Common.Aws` adapter against LocalStack over a shared `LocalStackFixture`: S3 file storage, the SQS/SNS broker transport, Secrets Manager configuration, the DataProtection key ring and SNS push (`ci.yml:1251`, floor at `ci.yml:1299`) |
| `MMCA.Common.Gcp.Emulator.Tests` | 7 | The `MMCA.Common.Gcp` adapter against fake-gcs-server (Cloud Storage file storage and the DataProtection key ring) and the Firestore emulator (the FCM installation registry, with `RecordingFcmMessagingClient` standing in for FCM, which has no emulator) (`ci.yml:1311`, floor at `ci.yml:1365`) |
| `MMCA.Common.LoadTests` | 14 | The weekly load tier: `OutboxThroughputLoadTests`, `PagedQueryLoadTests` and the `Support/` stack (`LoadStack`, `PagedQueryFixture`, `LoadItem`, `CountingMessageBus`, `LoadResults`) over a temp-file SQLite database, run by `load-tests.yml` rather than `ci.yml` (section 7) |

The current scan covers every row above, so the totals below cover all 37 MMCA.Common test projects.
Every out-of-solution row runs from its own CI job, or in the load tier's case its own weekly
workflow, and each is described in section 5 or section 7. Keeping them out of the `.slnx` is
deliberate: a tier that needs Docker, a trusted development certificate or a wall-clock budget must
not be able to break or slow a plain `dotnet build` of the solution for an engineer who has none of
those.

### MMCA.ADC, 1,262 test types across 32 in-solution projects + 3 in one out-of-solution project

**Unit, per-module, per-layer (Identity module)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Identity.Domain.Tests` | 11 | `User` aggregate factory methods, invariants, soft-delete |
| `MMCA.ADC.Identity.Application.Tests` | 45 | Command/query handler tests for register, login, external OAuth, profile management, plus the GDPR export path and the per-module export sections |
| `MMCA.ADC.Identity.Shared.Tests` | 3 | The module's permission grants (`IdentityPermissionGrantsTests`) and the disabled attendee-query service (`DisabledAttendeeQueryServiceTests`) |
| `MMCA.ADC.Identity.API.Tests` | 19 | Controller helper tests, rate-limit bypass |
| `MMCA.ADC.Identity.Infrastructure.Tests` | 12 | Token service, JWKS provider, EF configuration, the refresh-session store |
| `MMCA.ADC.Identity.UI.Tests` | 26 | bUnit tests for `Profile`, login route authorization |

**Unit, per-module, per-layer (Conference module)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Conference.Domain.Tests` | 38 | Event/Session/Speaker/Sponsor aggregate factories, invariants, domain events |
| `MMCA.ADC.Conference.Application.Tests` | 209 | Handler tests for the Conference controllers' use cases (bulk), including the `Sponsors/` create, update, public-filter and mapper tests, the `Partners/` and `SessionAssets/` subtrees, and the batch event question-answer handler and validator |
| `MMCA.ADC.Conference.Shared.Tests` | 9 | DTO tests (category, event, session, speaker), the current-event defaults and selector, the Sessionize code format and the disabled event-live validation service |
| `MMCA.ADC.Conference.API.Tests` | 39 | Controller registration, route tests, `SponsorsControllerTests`, `PartnersControllerTests`, `SessionAssetsControllerTests`, the split event and speaker controllers (`EventLifecycleControllerTests`, `SpeakerLinksControllerTests`, `SpeakerSessionsControllerTests`), `ConferencePermissionGrantsTests` and `EntityExportAuthorizationTests` |
| `MMCA.ADC.Conference.Infrastructure.Tests` | 16 | EF entity configuration, module seeding, the Sessionize import, the AI session-scoring services, the score-response guardrail and its registration (`SessionScoreResponseGuardrailTests`, `ConferenceAiGuardrailsRegistrationTests`) and the session-scores cache evictor |
| `MMCA.ADC.Conference.Scoring.Evaluation.Tests` | 10 | The AI session scorer's behavioural suite: `GoldenReplayTests`, `PromptContractTests` and the opt-in `LiveJudgeTests` (`MMCA.ADC/MMCA.ADC.slnx:88`, in `CI.slnf:49`). Its 10 types are inside the 1,262 below (`00-inventory.md`, current scan); the gate that runs it is in section 7 |
| `MMCA.ADC.Conference.UI.Tests` | 153 | bUnit tests for session/speaker components and dashboards, the sponsor create/detail pages and the public sponsor list |

**Unit, per-module, per-layer (Engagement module)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Engagement.Domain.Tests` | 14 | Bookmark, LivePoll and SessionQuestion aggregates, plus `CheckIn`, `PointsEntry` and the leaderboard opt-in |
| `MMCA.ADC.Engagement.Application.Tests` | 92 | Bookmark, feedback and live-layer handlers, plus the `CheckIns/` subtree (attendee, manual, room and sponsor-visit check-in, badge issue, attendance stats) and the `Points/` subtree (awarder, leaderboard, my-points, organizer overview, and the domain/integration-event points handlers) |
| `MMCA.ADC.Engagement.Shared.Tests` | 8 | The badge payload, check-in scope names and settings, the points settings and subject keys, and the disabled bookmark-count service (`DisabledBookmarkCountServiceTests`) |
| `MMCA.ADC.Engagement.API.Tests` | 15 | Controller surface (bookmarks, live polls and live-poll voting, session questions, check-ins, points) and the module's permission grants |
| `MMCA.ADC.Engagement.Infrastructure.Tests` | 11 | EF config |
| `MMCA.ADC.Engagement.UI.Tests` | 76 | bUnit tests for the conference-day live surfaces (Happening Now, session Live, presenter UI), the QR check-in pages, the points pages, and `CurrentEventNotificationScopeProviderTests` |

**Unit, per-module (Notification module, API + Application only)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Notification.Application.Tests` | 4 | `AttendeeNotificationRecipientProviderTests`, `UserNotificationExportServiceTests` and `DependencyInjectionTests`, over a shared `Helpers/TestSupport` |
| `MMCA.ADC.Notification.API.Tests` | 1 | `NotificationHub` surface |

**Architecture**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Architecture.Tests` | 86 | Fitness-function classes plus `AdcArchitectureMap` and the `ServiceModels` fixture (see section 4) |

**Hosts and services**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Gateway.Tests` | 11 | YARP route map, the ADR-058 conformance subclasses `SecurityHeadersTests`, `GracefulShutdownTests` and `GatewayHardeningTests` against a Production-pinned Gateway boot, plus `AppHostBicepParityTests`, which reads the AppHost and the production Bicep as text (see section 4) |
| `MMCA.ADC.Services.Tests` | 32 | The gRPC export services and their adapters, with a `FakeServerCallContext` |
| `MMCA.ADC.UI.Web.Tests` | 11 | The Blazor Web head itself: `SecurityHeadersTests` and `UiRateLimitingTests` against a `ConferenceUiHostApplicationFactory`, plus `BoundedCircuitHandlerTests`, `FallbackAuthorizationTests`, `ClientConfigEndpointTests` and `SerilogBootstrapTests` (`MMCA.ADC/MMCA.ADC.slnx:105`, in `CI.slnf:64`) |

**Integration (per-service WebApplicationFactory, in `MMCA.ADC.Integration.slnf` only)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.Identity.IntegrationTests` | 57 | Full HTTP tests of the Identity service host against real SQL Server; auth flows, OAuth challenges, attendee/organizer access, outbox fidelity |
| `MMCA.ADC.Conference.IntegrationTests` | 64 | Full HTTP tests of the Conference service host, plus its 409-conflict ProblemDetails extension and the versioning contract |
| `MMCA.ADC.Engagement.IntegrationTests` | 34 | Full HTTP tests of the Engagement service host, including the check-in authorization and scan, room-check-in and sponsor-visit round trips and the points award round trip |
| `MMCA.ADC.Notification.IntegrationTests` | 14 | Full HTTP tests of the Notification service host, including its problem-details and OpenAPI contract subclasses |

**Testcontainers tiers (in `MMCA.ADC.slnx` but in neither `.slnf`; need Docker)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.CrossService.IntegrationTests` | 13 | Boots the three REST hosts in one process against real SQL Server + RabbitMQ containers; exercises the genuine outbox to broker to consumer round-trip and the Conference to Engagement gRPC read |
| `MMCA.ADC.ServiceBusEmulator.IntegrationTests` | 3 | Service Bus transport smoke against the official Azure Service Bus emulator (broker parity), on the shipped `ServiceBusEmulatorFixtureBase` |

**E2E (in `MMCA.ADC.slnx` but excluded from both `.slnf` filters)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.E2E.Tests` | 126 | Playwright browser-automation tests across login, register, password reset, conference browsing, organizer management, bookmark and live flows, plus the 45-scan `AccessibilityTests` suite (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/AccessibilityTests.cs:29`, 45 `[Fact]` methods, each one `ScanAsync`/`ScanGridAsync` call); requires the Aspire stack running |

**Out-of-solution (opt-in, run only by `apphost-tests.yml`)**

| Project | Types | Purpose |
|---|---|---|
| `MMCA.ADC.AppHost.OutageTests` | 3 | Boots the real AppHost through Aspire's testing builder, stops Redis and then RabbitMQ, and asserts what Notification's health endpoints answer during and after each outage (`MMCA.ADC/.github/workflows/apphost-tests.yml:3-8`, section 5) |

### Test-type totals

- **MMCA.Common:** the 25 in-solution projects sum to 73 + 73 + 535 + 760 + 1 + 41 + 12 (Core) + 382 +
  9 + 29 + 421 + 57 (Presentation) + 63 + 16 + 20 + 39 + 34 + 8 + 31 + 9 + 59 + 15 + 6 + 12 (Hosting) +
  524 (architecture) = **3,229**; the 12 out-of-solution projects add 15 + 42 + 4 + 6 + 21 + 6 + 16 + 18 +
  7 + 14 + 2 + 9 = **160**, for **3,389**.
- **MMCA.ADC:** 116 (Identity) + 474 (Conference, incl. the 10-type scoring evaluation suite) + 216 (Engagement) + 5 (Notification) + 86
  (architecture) + 169 (four integration projects) + 16 (two Testcontainers tiers) + 11 (Gateway) + 32
  (Services) + 11 (UI.Web) + 126 (E2E) = **1,262** in the solution. The one out-of-solution project,
  `MMCA.ADC.AppHost.OutageTests` (3 types, run by `apphost-tests.yml`, section 5), brings MMCA.ADC to
  **1,265**.
- **Combined test projects: 4,654.** Separately, the six shipped testing packages contribute
  another **175** types (`MMCA.Common.Testing` 34, `.Testing.Architecture` 78, `.Testing.Aspire` 10,
  `.Testing.Azure` 1, `.Testing.E2E` 33, `.Testing.UI` 19): those are shipped product, not tests, which is why they are
  counted apart. The inventory also lists `MMCA.Common.AI.Testing` (5 types,
  `MMCA.Common/Source/Hosting/MMCA.Common.AI.Testing/`), which ships beside the AI package rather
  than in this family and is not in the 175.

[Rubric §14, Testability & Test Strategy]: §14 assesses the breadth and meaningfulness of the
test suite across all layers; the project layout above, unit per layer, arch per repo,
integration per service, Testcontainers for the cross-service round-trip, E2E for browser flows,
demonstrates deliberate stratification rather than a single catch-all integration tier.

---

## 3. Shipped testing-infrastructure packages

MMCA.Common ships **six** of its twenty-six packages as general testing infrastructure that downstream
apps consume as NuGet references rather than writing their own harness (`MMCA.Common/FACTS.md:19,41-46`;
a sixth, `MMCA.Common.AI.Testing`, is the language-model replay harness covered in
[group-27](group-27-common-ai-integration.md)):

- `MMCA.Common.Testing` (34 types), integration-test base, JWT generator, SQL fixture base, handler
  scaffold, entity builders, and the eight runtime conformance bases (this section).
- `MMCA.Common.Testing.E2E` (33 types), Playwright fixtures, Blazor nav helpers, Identity,
  Preferences and Globalization workflow bases, five page objects, the `AxeOptions` accessibility
  contract, the `AuthOutcomeRules` post-submit classifier, and a web-vitals collector plus its
  page extension (`WebVitalsCollector.cs`, `WebVitalsPageExtensions.cs`) (this section).
- `MMCA.Common.Testing.UI` (19 types), bUnit component-test base, MudBlazor provider harness, HTTP
  test doubles, an error-summary helper and a markup snapshot helper (this section; see the bUnit
  worked example in section 6).
- `MMCA.Common.Testing.Architecture` (78 types), the shared architecture fitness-function rule library (on its own metadata-based engine)
  plus 53 abstract test bases (covered in section 4, where each repo's `*.Architecture.Tests` consumes it).
- `MMCA.Common.Testing.Aspire` (10 types), the AppHost boot fixture, its readiness budget, the
  Docker/certificate/environment preconditions and the wiring probes (this section).
- `MMCA.Common.Testing.Azure` (1 type), `ServiceBusEmulatorFixtureBase`, the Azure Service Bus emulator
  fixture with its pinned 2.x emulator image
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Azure/Fixtures/ServiceBusEmulatorFixtureBase.cs:54,61`),
  unit-tested by the in-solution `MMCA.Common.Testing.Azure.Tests` (this section).

### MMCA.Common.Testing

`MMCA.Common/Source/Hosting/MMCA.Common.Testing/`, 34 types, shipped as `MMCA.Common.Testing`.

#### `IIntegrationTestFixture`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Fixtures/IIntegrationTestFixture.cs:8`

The shared contract between a `WebApplicationFactory` fixture and `IntegrationTestBase<TFixture>`.
Two members: `CreateClient()` (line 11) returns an `HttpClient` configured for the test server, and
`ResetDatabaseAsync()` (line 19) resets the database between tests. The doc comment
(`IIntegrationTestFixture.cs:13-18`) explicitly notes that fixtures for database-per-service hosts
must reset **every** relational source by enumerating `IEntityDataSourceRegistry` and
`IDataSourceResolver`, this is the database-per-microservice
([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)) implication for test
cleanup. Each concrete fixture implements this by opening a per-source `SqlConnection` and calling
`Respawner.ResetAsync`.

#### `IntegrationTestBase<TFixture>`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Fixtures/IntegrationTestBase.cs:13`

The abstract base class all integration test classes inherit from. Generic on `TFixture :
IIntegrationTestFixture`. Implements xUnit v3's `IAsyncLifetime`:

- `InitializeAsync()` calls `Fixture.ResetDatabaseAsync()` before each test, so tests always start
  from a clean database state (line 31).
- `DisposeAsync()` disposes the test `HttpClient` after each test (lines 34-39).
- `SetBearerToken(string token)` writes a `Bearer` `Authorization` header onto `Client`
  (lines 42-44).
- `ClearAuthentication()` removes it (lines 47-48).
- `GetAsync<T>`, `PostAsync<T>`, `PutAsync<T>`, `PutAsync` (no body), `DeleteAsync`, typed HTTP
  helpers (lines 51-72).
- `NextId()`, thread-safe `Interlocked.Increment` over a static counter starting at 1000
  (line 16), giving tests unique integer IDs without collisions under parallel execution (line 75).

Downstream projects extend this by adding role helpers. For example,
`IdentityIntegrationTestBase` (`MMCA.ADC/Tests/Integration/MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestBase.cs:12`)
adds `AuthenticateAsOrganizer(userId)` (line 18), `AuthenticateAsAttendee(userId)` (line 22), and
`AuthenticateAsSpeaker(userId, speakerId)` (line 26), each calls
`SetBearerToken(JwtTokenGenerator.GenerateToken(...))`.

#### `SqlServerIntegrationTestFixtureBase<TEntryPoint>`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Fixtures/SqlServerIntegrationTestFixtureBase.cs:27`

The shared implementation of `IIntegrationTestFixture` for a service host backed by a throwaway SQL
Server database. It owns the whole lifecycle, so a consumer's fixture is only the host-specific
delta (see section 5 for the walkthrough). Two abstract members name the repo's conventions:
`SqlBaseEnvironmentVariable` (line 58, e.g. `ADC_TEST_SQL_BASE`) and `DatabaseNamePrefix` (line 61);
one abstract `CreateFactory()` (line 134) supplies the `WebApplicationFactory`, and one virtual
`ConfigureTestEnvironment` (line 142) pushes host-specific settings.

#### `ProductionHostApplicationFactory<TEntryPoint>`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Fixtures/ProductionHostApplicationFactory.cs:22`

The database-free boot path. Its `CreateHost` override (line 32) pins `UseEnvironment("Production")`
(line 36) so the tests exercise the branches a default `Development` boot skips (restrictive CORS,
HSTS emission), and it captures the started `IHost` in `StartedHost` (line 29, assigned at line 37)
because `IHost.StopAsync` is not reachable through the `WebApplicationFactory` surface. That capture
is what makes the graceful-shutdown suite possible.

#### `HandlerTestBase<THandler>`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Support/HandlerTestBase.cs:38`

A reusable Moq scaffold for command/query handler unit tests, replacing the per-class copy-paste of
`Mock<IUnitOfWork>` plus `GetRepository` wiring plus `SaveChangesAsync` setup. `UnitOfWork` (line 45)
arrives with `SaveChangesAsync` pre-configured to return 1 (constructor, line 41); `Logger` (line 48)
is a `NullLogger<THandler>`. Derived classes call `RegisterRepository<TEntity, TIdentifierType>()`
(line 56) or `RegisterReadRepository<TEntity, TIdentifierType>()` (line 72) per aggregate the handler
touches.

#### The eight runtime conformance bases (ADR-058)

The bases above are plumbing. The eight below are the runtime-contract half of the fitness story:
the architecture rules can prove a controller lives in the right assembly, they cannot prove a booted host answers
a bad page number with an RFC 9457 problem document. All but one run against a host that was
**actually booted**
([ADR-058](https://ivanball.github.io/docs/adr/058-runtime-conformance-suites-as-a-package.html)).

| Base | File | What it asserts |
|---|---|---|
| `ProblemDetailsContractTestsBase<TFixture>` | `ProblemDetailsContractTestsBase.cs:21` | Both error-shaping paths: ASP.NET Core model validation (400, `application/problem+json` with `type`/`traceId`/`errors`, fact at line 29) and the framework's `HandleFailure` Result mapping (404, fact at line 41), each driven by an abstract probe the subclass supplies (lines 54, 60) |
| `OpenApiContractTestsBase<TFixture>` | `OpenApiContractTestsBase.cs:21` | The live `/openapi/v1.json` document (path at line 30) still describes the pinned `CorePublicResources` (line 50, fact at line 67) above a `MinimumPathCount` floor (line 37, asserted at line 64). No committed snapshot: a new controller can never leave a stale one behind |
| `ServiceInfoVersioningContractTestsBase<TFixture>` | `ServiceInfoVersioningContractTestsBase.cs:19` | `/ServiceInfo` served at both `api-version: 1.0` (deprecated, fact at line 27) and `2.0` (fact at line 43), with the `api-deprecated-versions` / `api-supported-versions` reporting headers |
| `SecurityHeadersTestsBase` | `SecurityHeadersTestsBase.cs:16` | Hardened response headers on the `ProbePath`, `/alive` by default (line 19, fact at line 21), including `Content-Security-Policy: frame-ancestors 'none'` and an HSTS `max-age` |
| `GracefulShutdownTestsBase<TEntryPoint>` | `GracefulShutdownTestsBase.cs:24` | A real `IHost.StopAsync` under a bounded 20-second budget (`ShutdownTimeoutSeconds`, line 28) fires `ApplicationStopping` then `ApplicationStopped` (fact at line 33) |
| `MmcaGatewayHardeningTestsBase<TEntryPoint>` | `MmcaGatewayHardeningTestsBase.cs:38` | Eight gateway gates against a real Production boot: per-route throttling (line 125), a tighter named policy (line 147), bypassed paths (line 183), correlation-id generation and echo (lines 210, 228), a readiness check per downstream service (line 245), an active `/alive` probe on every cluster (line 273), and rate-limit partitioning by the **forwarded** client IP rather than the proxy IP (line 309) |
| `MiddlewarePipelineOrderTestsBase` | `MiddlewarePipelineOrderTestsBase.cs:29` | The 18-step edge pipeline runs in exactly the documented order, outermost first (`ExpectedStepNames`, lines 38-57; fact at line 60), and `Build()`'s load-bearing adjacency checks still pass (fact at line 69) |
| `DecoratorPipelineOrderTestsBase<TCommand, TCommandResult, TQuery, TQueryResult>` | `DecoratorPipelineOrderTestsBase.cs:38` | The ADR-014 nesting, read off the constructed object graph via each decorator's private inner-handler field, not off the registration list (expected orders at lines 49 and 61, facts at 71 and 75) |

The two newest are worth reading for the shape of the problem they solve. `MiddlewarePipelineOrderTestsBase`
builds no `WebApplication` at all: the steps are pure data until they are applied, so it runs in the
fast unit tier with no database and no host (`MiddlewarePipelineOrderTestsBase.cs:24-27`). Its value
is that several adjacencies are load-bearing (pre-forwarded capture immediately before
`UseForwardedHeaders`, authentication immediately before tenant resolution, authentication before the
rate limiter per ADR-019, forwarded headers before the HTTPS redirect) and a reorder that breaks one
fails at runtime in ways that look like configuration bugs: an unreachable `jwks_uri`, a tenant that
never resolves, a per-user rate cap that never engages (lines 13-18, restated in the assertion's
because-reason at line 66). The list it compares against is the framework's own 18-step default,
declared once as data (`MiddlewarePipelineOrderTestsBase.cs:40-57`). `MmcaGatewayHardeningTestsBase` goes the other way and needs the real
host, but it drives it through `TestServer.SendAsync` rather than an `HttpClient`, because the
limiter partitions on `Connection.RemoteIpAddress`, which a `TestServer` request leaves null; the kit
deliberately fails open on an unresolvable IP, so a client-driven test could never observe a 429
(lines 22-26). Each of its tests uses its own RFC 5737 TEST-NET-3 client IP so the shared host gives
every one a fresh window (lines 27-28).

Five of the eight reach the host through `IIntegrationTestFixture`; the security-headers base takes a
bare `CreateClient()` (`SecurityHeadersTestsBase.cs:42`), the gateway-hardening base takes a
`WebApplicationFactory` (line 60), and the decorator and middleware bases need no host at all.

**Adoption is now near-complete on the REST hosts, and still uneven on the host-level gates.** This is
the honest inventory:

- **OpenAPI and ProblemDetails** both cover **all four** ADC services and **all three** Store
  services. ADC Notification, which previously had no problem-details subclass, now has one
  (`MMCA.ADC/Tests/Integration/MMCA.ADC.Notification.IntegrationTests/Contract/ProblemDetailsContractTests.cs:16`).
  ADC Conference extends the base with a 409 stale-`RowVersion` conflict test of its own.
- **ServiceInfo versioning** is subclassed once per repo, on ADC Conference
  (`MMCA.ADC/Tests/Integration/MMCA.ADC.Conference.IntegrationTests/Contract/ApiVersioningTests.cs:15`)
  and Store Catalog. That keeps the versioning machinery exercised but leaves the other five REST
  hosts unguarded.
- **Security headers, graceful shutdown and gateway hardening** are subclassed **only on the two
  Gateway hosts** (`MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/SecurityHeadersTests.cs:12`,
  `GracefulShutdownTests.cs:9`, `GatewayHardeningTests.cs:28`, plus the Store trio). No service host
  asserts any of them today.
- **Decorator order and middleware order** are subclassed in **all four repos**: ADC and Store from
  their architecture suites (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Cqrs/DecoratorPipelineOrderTests.cs:28`,
  `MiddlewarePipelineOrderTests.cs:15`), Helpdesk from its own
  (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/DecoratorPipelineOrderTests.cs:35`,
  `MiddlewarePipelineOrderTests.cs:15`), and MMCA.Common dogfooding both against a synthetic
  `PingCommand`/`PingQuery` pair and the framework's own default pipeline
  (`MMCA.Common/Tests/Hosting/MMCA.Common.Testing.Tests/Conformance/DecoratorPipelineOrderTests.cs:22`,
  `MiddlewarePipelineOrderTests.cs:10`).
- **MMCA.Helpdesk now adopts two of the eight.** The seed used to demonstrate only the structural
  tier; the two host-free order gates were the cheapest runtime bases to adopt, and it adopted them.
  The six that need a booted host it still does not.

Each unguarded host is a gap in the record, not a decision that the contract does not apply to it.

#### `JwtTokenGenerator`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Support/JwtTokenGenerator.cs:30`

A static class that mints RS256 JWT tokens for test consumption. Key design decisions visible in
the source:

- **RS256 matches production.** The generator uses `RSA.Create()` + `ImportFromPem` + `RsaSecurityKey`
  (lines 124-130), matching the algorithm configured by `AddCommonAuthentication` in the real host.
  Integration tests therefore exercise the actual JWKS/RS256 validation path, not a relaxed HMAC
  shortcut. [Rubric §11, Security]: §11 assesses how well the test suite validates the security
  model; using the same algorithm in tests as in production is a direct embodiment.
- **Committed keypair, documented as insecure.** `DefaultPublicKeyPem` (line 49) and
  `DefaultPrivateKeyPem` (line 68) are embedded in the source and committed to the public repo. The
  class doc explicitly warns that the embedded RSA keypair is insecure by design and exists solely to
  make integration tests deterministic without a per-run key-generation step, and that no production
  deployment may be configured with it.
- **`DefaultKeyId = "mmca-test-key"`** (line 41) and `DefaultIssuer` (line 33), the `kid` and issuer
  that test host appsettings expose via `Jwks:KeyId`, so `RsaJwksProvider` publishes a JWKS entry with
  the same `kid` and the middleware's key resolution succeeds.
- `GenerateToken(audience, userId, role, additionalClaims?, privateKeyPem?, issuer?, keyId?)`
  (line 112) exports the RSA parameters before disposal (line 127), creates `RsaSecurityKey`
  (line 130), and writes **`NameIdentifier` and `Role`** (lines 139-140). The duplicate custom
  `user_id` claim that used to ride alongside `NameIdentifier` is gone, and the comment above the
  list says why (lines 133-136): `NameIdentifier` is what the JWT bearer handler produces for a real
  token's `sub` under its default inbound mapping, so a test token carrying it reaches every reader
  the same way a production one does, and two claims for one identity can disagree.
- `ConfigureInProcessTokenValidation(options, audience)` (line 170) is the companion that points a
  host's `JwtBearerOptions` at the same committed key, for suites that boot a host in-process rather
  than fetching a JWKS document over HTTP.

#### `EntityBuilderBase<TBuilder, TEntity>`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Builders/EntityBuilderBase.cs:9`

A fluent-builder generic base for test entity construction. Subclasses configure sensible defaults
(so tests only set the property under test) and implement the abstract `Build()` (line 17), which
calls the domain factory method and throws on a `Failure` result. This keeps test arrange code
readable without exposing EF's parameterless constructor. [Rubric §14, Testability]: builder
patterns are a classic indicator of testability investment; the shared base means every downstream
module gets fluent builders "for free" by subclassing.

#### `FeatureManagementTestExtensions`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Support/FeatureManagementTestExtensions.cs:10`

A C# preview `extension(IServiceCollection services)` block (line 12) exposing
`ConfigureTestFeatureFlags(...)` (line 35). Call it in a `WebApplicationFactory.ConfigureServices`
override to override feature flags from `appsettings.json`. The doc comment records the trap it was
written around (lines 18-24): the flags are **layered on top of** the `IConfiguration` the host
already registered and the resulting root is registered in its place, because .NET DI hands a
non-collection dependency the last registration, so building a flags-only root would silently give
every component constructed afterwards a configuration containing nothing but `FeatureManagement`.

#### The cross-service, gateway and polling helpers

Five more shipped types close out the package, all of them for the tiers above the unit loop:

- `CrossServiceFixtureBase` (`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Fixtures/CrossServiceFixtureBase.cs:41`)
  and its `CrossServiceDataSource` record (line 15) are the scaffolding for the cross-service
  real-broker tier: several service hosts booted in **one** process against a real Testcontainers SQL
  Server and a real Testcontainers RabbitMQ. The class remarks (lines 26-39) record the load-bearing
  constraint: each host reads its connection string, message-bus provider and JWT settings from
  configuration at configure-time, before `builder.Build()` and therefore before a
  `WebApplicationFactory` config delta could apply, so **process environment variables are the only
  override channel** (`SetEnvironmentVariable`, line 187) and the hosts must be booted strictly
  sequentially, re-pointing the connection string between boots (`SetHostConnectionString`, line 177).
  ADC's `CrossServiceFixture`
  (`MMCA.ADC/Tests/Integration/MMCA.ADC.CrossService.IntegrationTests/Infrastructure/CrossServiceFixture.cs:23`)
  is its one subclass, carrying only the ADC-specific parts.
- `ServiceBusEmulatorFixtureBase` is the equivalent scaffold for the Azure Service Bus emulator tier,
  so the broker-parity smoke does not re-implement container lifecycle either. It ships in the separate
  `MMCA.Common.Testing.Azure` package, not in `MMCA.Common.Testing`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Azure/Fixtures/ServiceBusEmulatorFixtureBase.cs:54`).
- `RecordingHttpForwarder` is the `IHttpForwarder` double a gateway conformance subclass swaps in, so
  a proxied route answers immediately instead of trying to reach a service-discovery name that
  resolves to nothing in-process (`MmcaGatewayHardeningTestsBase.cs:30-35`), and
  `RateLimiterTestExtensions` supplies `NeutralizeGlobalRateLimiter`, the escape hatch an integration
  fixture uses when a suite must issue more requests from one IP than production would allow.
- `DependencyInjectionAssert` (`DependencyInjectionAssert.cs:13`) asserts the fluent-registration
  contract: `ReturnsSameCollection` (line 21) proves a registration extension hands back the very
  `IServiceCollection` it was given. An extension that returns a different collection silently drops
  every registration chained after it, and nothing else catches that because the dropped services are
  simply absent (lines 6-11).
- `TestPolling.PollUntilAsync` (`TestPolling.cs:22`) is the poll-with-timeout helper for
  eventually-consistent assertions, defaulting to a 60-second budget and a 500ms interval. It returns
  the **last probed value** either way, so a timeout fails on the test's real assertion message
  rather than on a bare timeout.

### MMCA.Common.Testing.E2E

`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/`, 33 types, shipped as
`MMCA.Common.Testing.E2E`. [Rubric §28, Front-End Testing & Quality]: §28 assesses whether UI
components have browser-level automated coverage; this package is the shared foundation for that
coverage.

#### `E2ETestConfiguration`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/E2ETestConfiguration.cs:8`

All E2E configuration is environment-variable driven. Properties:

| Variable | Default | Effect |
|---|---|---|
| `E2E_BASE_URL` | `https://localhost:7108` | Target app URL (overridden per downstream project), line 13 |
| `E2E_HEADLESS` | `true` (absent = headless) | Set `false` to watch tests visually, line 16 |
| `E2E_TIMEOUT` | `30_000` ms | Per-action Playwright timeout, line 19 |
| `E2E_AUTH_TIMEOUT` | inherits `E2E_TIMEOUT` | The post-auth wait, tunable apart because login is the slowest step and spikes on a contended runner, line 28 |
| `E2E_AUTH_GRACE` | `15_000` ms | Grace window in which a transient error alert during a successful `forceLoad` is not treated as a failure, line 39 |
| `E2E_SLOWMO` | `0` ms | Delay between Playwright actions (for visual debugging), line 46 |
| `E2E_BROWSER` | `chromium` | Engine: `chromium`, `firefox`, or `webkit`; unknown values fall back to Chromium, line 54 |
| `E2E_TRACE` | unset | A file path (or a directory, for per-failing-test traces) to capture a full-speed Playwright trace, line 64 |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | `admin@localhost` / `Admin123!` | Seeded admin credentials, lines 72, 75 |
| `E2E_CUSTOMER_EMAIL` / `E2E_CUSTOMER_PASSWORD` | `user@localhost` / `User123!` | Seeded user credentials, lines 84, 87 |

Downstream projects supply app-specific defaults via `[ModuleInitializer]` on the `Default*`
setters (for example `DefaultBaseUrl`, line 10). Environment variables always take precedence.
[Rubric §22, Responsive & Cross-Browser]: `E2E_BROWSER` is the mechanism for running the same suite
against all three browser engines in CI.

#### `PlaywrightFixture` + `E2ETestCollection`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/PlaywrightFixture.cs:6`

`PlaywrightFixture` is an xUnit v3 `IAsyncLifetime` collection fixture. `InitializeAsync()` (line 11)
creates a `IPlaywright` instance, then resolves the browser type from `E2ETestConfiguration.Browser`
via a switch on the upper-cased value (lines 17-22): `"FIREFOX"` to `Playwright.Firefox`,
`"WEBKIT"` to `Playwright.Webkit`, any other value to `Playwright.Chromium`. The comment above the
switch (lines 15-16) calls out the rubric §22 cross-browser intent explicitly. `DisposeAsync`
(line 31) disposes browser and playwright in order, and it null-guards both (lines 35-43) because a
failed `InitializeAsync` (no browser binaries, a launch timeout) leaves them null despite the `null!`
declarations, and the `NullReferenceException` from disposal then replaced the real launch error in
the run output. `E2ETestCollection` (line 48) is the xUnit `[CollectionDefinition]` that wires the
fixture to all classes decorated with `[Collection(E2ETestCollection.Name)]`.

#### `E2ETestBase`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/E2ETestBase.cs:9`

The abstract base all E2E test classes inherit from. Decorates itself `[Collection(E2ETestCollection.Name)]`
(line 8) so it receives the `PlaywrightFixture` singleton. `InitializeAsync()` (line 20) creates a
fresh `IBrowserContext` (with `IgnoreHTTPSErrors: true` for local dev TLS), sets `DefaultTimeout`
from config, optionally starts a trace, and opens a new `IPage` per test. `DisposeAsync()` (line 40)
stops any trace, closes the page and disposes the context, guaranteeing test isolation at the
browser-session level.

Key methods:

- `LoginAsync(email, password)` (line 98), clears any existing session from **both** token stores
  (localStorage for WASM/MAUI hosts and the HttpOnly session cookie for the Blazor Server host;
  clearing only localStorage would leave the next login authenticated as the wrong user), navigates
  to `/login`, fills email and password via `FillFieldAsync`, clicks "Sign in", then settles the
  result through `WaitForAuthResultAsync` (line 136).
- `WaitForAuthResultAsync(authPagePath, operation)` (line 214) races **three** signals with
  `Task.WhenAny` (line 228): the `forceLoad` URL change away from the auth page (line 219), the
  logout button appearing (line 223), and an error alert appearing (line 225). The URL change is the
  interactivity-independent success signal, which matters because under Blazor Server prerender on a
  contended runner the interactive "Sign out" button can hydrate long after a successful login
  (comment, lines 206-213). The losing tasks are explicitly observed (lines 232-234, helper at line
  272) so their timeouts do not surface as unobserved-task failures in an unrelated test.
- **The verdict is a pure function, not inline branching.** The three observed booleans go through
  `AuthOutcomeRules.Classify` (line 236, defined at
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/AuthOutcomeRules.cs:38`), which
  returns one of three outcomes (`AuthOutcome`, `AuthOutcomeRules.cs:4`): `Succeeded`, `ErrorShown`,
  `Silent`. Navigation away or a visible logout control wins outright, so an error alert flashed on
  the way out is not a failure (`AuthOutcomeRules.cs:30-34`). Pulling the classification out of the
  browser code is what makes the four-way decision unit-testable without Playwright
  (`AuthOutcomeRules.cs:16-27`).
- **`Silent` is the case the design exists for, and it now fails.** Both non-success outcomes get the
  grace window once (`AuthSucceededWithinGraceAsync`, line 282, called at line 248), because a slow
  Server-mode success can still be finishing when all three waits time out. After that, `ErrorShown`
  throws with the alert text (lines 253-257) and `Silent` throws naming the elapsed budget and the
  current URL (lines 263-267). A submit that produces neither a navigation nor a rendered error (a
  500 that renders nothing, a dropped request, a JS exception mid-submit) used to let the wait return
  normally, and the caller's follow-up interactivity wait was already satisfied by the
  still-rendered auth page, so login and registration reported success on a sign-in that never
  happened and the real failure surfaced much later as an unrelated assertion (lines 259-262).
- `LoginAsAdminAsync()` (line 92) / `LoginAsUserAsync()` (line 95) delegate to `LoginAsync` with
  credentials from `E2ETestConfiguration`.
- `RegisterNewUserAsync(firstName?, lastName?)` (line 147), synthesizes a unique email, fills the
  registration form, submits, and settles through the same three-signal wait (line 170).
- `WaitForInteractiveOrReloadAsync()` (line 193), waits for interactivity after a post-auth
  `forceLoad` and, if that fails, **reloads once** and waits again rather than re-waiting on the
  same stalled boot. It catches `TimeoutException` as well as `PlaywrightException`, because
  Playwright's timeout derives from `System.TimeoutException` and the narrower catch skipped the
  retry entirely.
- `NavigateAndWaitAsync(path)` (line 302) and `FillFieldAsync(ILocator, string)` (line 310), which
  delegates to `PageExtensions.FillAndVerifyAsync`, the shared Blazor re-hydration guard (see below).
- `UniqueId()` (line 313), eight-char GUID fragment for unique test data.
- `ScanGridAsync()` (line 324) and `ScanAsync()` (line 334), the two accessibility entry points.
  `ScanAsync` waits for any loading bar to clear then asserts the strict `AxeOptions.Wcag21Aa`
  (line 337); `ScanGridAsync` additionally waits for a seeded data row (line 326) then asserts with
  the one recorded exception, `AxeOptions.Wcag21AaExceptMudPagerCombobox` (line 329). **Which helper
  a page uses is the declaration of which rule set applies to it.**

#### `AxeOptions`, the named WCAG 2.1 AA contract (ADR-063)
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/AxeOptions.cs:9`

"Run axe" is not a contract: axe ships advisory best-practice rules alongside the WCAG rule sets, so
two repos running the same tool with different options measure different things. `AxeOptions` makes
the target a shipped, versioned symbol
([ADR-063](https://ivanball.github.io/docs/adr/063-accessibility-conformance-gate.html)).

- `Wcag21Aa` (line 17) pins every scan to a `RunOnly` tag list of exactly `wcag2a`, `wcag2aa`,
  `wcag21a`, `wcag21aa` (line 22): levels A and AA across WCAG 2.0 and 2.1. axe's best-practice
  rules are deliberately out of scope (lines 12-15), which is what makes the gate blockable: every
  failure is a real conformance violation, never an advisory finding.
- `Wcag21AaExceptMudPagerCombobox` (line 35) carries the same four tags (line 40) and disables a
  single rule, `aria-input-field-name` (line 44). It is the **only** recorded exception, and it
  exists for pages whose sole combobox is MudBlazor's own `MudTablePager` "rows per page" select:
  MudBlazor 9.6.0 mirrored combobox semantics onto the MudSelect presenter but gives the pager's
  select no accessible name, and `MudTablePager` exposes no `Label`/`aria-label` parameter, so it is
  not fixable from app markup (lines 26-33). Every other WCAG 2.1 AA rule still runs on those pages.
  The trade-off is real: the rule is disabled for the whole page scan, not just the pager node, so
  the "use only where the sole combobox is a pager" convention is enforced by review, not by the
  compiler (line 33).

Writing the exception as a second named constant rather than a suppression flag forces the caller to
say which contract it is scanning under, and keeps the justification attached to the thing excepted.

#### `PageExtensions`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/PageExtensions.cs:23`

C# preview `extension(IPage page)` (line 62) and `extension(ILocator locator)` (line 335) blocks that
isolate Blazor InteractiveAuto rendering quirks:

- `WaitForBlazorAsync(timeout)` (line 85), polls `window.Blazor?._internal` until truthy
  (the runtime is ready), then lets the render pipeline flush. Without this, event handlers are not
  attached and clicks/fills are silently ignored.
- `GotoAndWaitForBlazorAsync(path)` (line 103), combines `GotoAsync` + `WaitForLoadStateAsync(Load)`
  (not `NetworkIdle`, Blazor's SignalR WebSocket keeps a persistent connection open, so
  `NetworkIdle` is never reached) + `WaitForBlazorAsync` (line 109).
- `BlazorNavigateAsync(path)` (line 118), uses `Blazor.navigateTo` for client-side SPA
  navigation (avoids a full page reload), then polls `window.location.pathname` (line 137) rather
  than calling `WaitForURLAsync`, whose default `WaitUntil=Load` hangs on a same-document navigation
  and leaves the page perpetually "navigating", blocking later actions (lines 132-135).
- `GotoProtectedAsync(path)` (line 160), the auth-protected variant: SSR cannot read JWTs from
  localStorage, so a full page load to an `[Authorize]` page redirects to `/login`. This ensures the
  runtime is available (loading a public page first if needed, line 177) and re-routes via `"/"`
  (line 186) so the target path always triggers a fresh component lifecycle.
- `WaitForPageAndBlazorAsync()` (line 197), waits for `Load` state + render flush; use
  after link/button clicks that trigger full-page navigation.
- Three grid helpers close the gap between "the request finished" and "the DOM settled" on the
  MudBlazor data grids every list page uses: `SearchAndWaitForRowAsync` (line 233),
  `ConfirmDeleteAsync` (line 266) and `WaitForGridToSettleAsync` (line 293). A server-side grid
  re-renders after its own fetch, so asserting immediately after a click reads the pre-fetch rows.
- `FillAndVerifyAsync(value, timeout)` (line 347), fills a form field then asserts
  `ToHaveValueAsync` with Playwright's built-in retry. If the pre-render value was wiped by
  re-hydration (a common Blazor InteractiveAuto timing bug), it falls back to `PressSequentiallyAsync`
  and re-asserts. This is the single shared fill helper for the whole E2E layer.
- `ClickAndVerifyAsync(expected, timeout)` (line 380), the submit-side counterpart: a click that
  lands before the runtime wires `@onclick` is silently ignored, so this clicks, waits a slice of the
  timeout for the visible effect, and re-asserts interactivity before retrying (line 403). A
  genuinely applied click surfaces its effect within one slice, so there is no double submit.
- `ClickAndWaitForUrlAsync(page, urlPattern)` (line 423), the navigation-side counterpart, for
  in-cell grid links (clicking the row itself lands on cell padding between the inline anchors and
  does nothing).
- `AssertNoAccessibilityViolationsAsync(options?)` (line 307), runs `page.RunAxe()` from
  `Deque.AxeCore.Playwright`, collects violations, and throws `AccessibilityViolationException`
  (line 330) if any are found. The message carries each rule's impact, id, help text, node count and
  the offending markup compacted to one line per node (lines 320-328), so a red gate points at the
  element rather than at a dashboard. [Rubric §21, Accessibility]: §21 assesses whether the app meets
  WCAG 2.1 AA; this extension method is the single enforcement point.

The file also carries two documented analyzer suppressions worth knowing about before you edit it
(lines 17-22): CA1708 fires falsely when one static class holds multiple `extension(T)` blocks, and
IDE0051 in SDK 10.0.201+ does not track references that cross an extension-block boundary, so
private members consumed only from inside a block read as unused.

#### `AccessibilityViolationException`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/AccessibilityViolationException.cs:7`

A typed exception thrown by `AssertNoAccessibilityViolationsAsync`. Giving axe-core violations
their own exception type means test runners display the violation summary in the failure message
without requiring the test author to parse raw JSON.

#### `WebVitalsCollector`
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs`

Collects Core Web Vitals from a live page so a budget can be asserted in the browser tier;
MMCA.Common's `WebVitalsE2ETests` is its worked consumer.

#### Page objects
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/PageObjects/`

Five pre-built page-object models for the Identity pages every downstream app shares: `LoginPage`,
`RegisterPage`, `ProfilePage`, `ForgotPasswordPage` and `ResetPasswordPage`. The form-bearing ones
encapsulate locators and the fill/submit sequence and use `FillAndVerifyAsync` internally;
`ProfilePage` exposes profile-field locators and the "Change Password" / "Delete Account" button
locators. Downstream projects extend by composition or inheritance.

#### Workflow base classes
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.E2E/Workflows/`

Eight abstract test bases: six for the standard Identity workflows (`UserLoginTestsBase`,
`UserRegistrationTestsBase`, `ProfileManagementTestsBase`, `LogoutTestsBase`,
`AuthorizationTestsBase` and `PasswordResetTestsBase`, all under `Workflows/Identity/`), one for user
preferences (`Workflows/Preferences/UserPreferencesTestsBase.cs`) and one for pseudo-localization
(`Workflows/Globalization/PseudoLocalizationTestsBase.cs`). Each extends `E2ETestBase`, provides
concrete `[Fact]` methods that apply to any app using `MMCA.Common`'s Identity UI, and the login,
register, profile and password-reset bases call
`AssertNoAccessibilityViolationsAsync(AxeOptions.Wcag21Aa)` once the page is interactive
(`UserLoginTestsBase.cs:83`, `UserRegistrationTestsBase.cs:91`, `ProfileManagementTestsBase.cs:180`,
`PasswordResetTestsBase.cs:88,99`).
[Rubric §21, Accessibility]: axe-core is called **in the base**, not in the consumer, so an app that
adopts the Identity workflow tests cannot accidentally adopt them without the a11y scan. Opting out
is visible, because it means not subclassing the base: MMCA.ADC subclasses login, register, logout,
authorization and password reset but derives its `ProfileManagementTests` from `E2ETestBase` directly
(`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/Identity/ProfileManagementTests.cs:8`), because its
profile page supports only password change and account deletion, and MMCA.Helpdesk has no E2E project
at all.

### MMCA.Common.Testing.UI

`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/`, 19 types, shipped as `MMCA.Common.Testing.UI`.
This is the bUnit half of the two-tier UI strategy, consumed by every `*.UI.Tests` project across the
repos.

- `BunitComponentTestBase` (`Infrastructure/BunitComponentTestBase.cs:37`) extends bUnit v2's
  `BunitContext` and, in its constructor (line 44), registers MudBlazor services (line 46), the
  vendor-neutral toast/confirm facades every migrated page injects (line 53), puts JSInterop in
  `Loose` mode (line 55, so MudBlazor components that probe JS during render do not throw), adds
  `AddAuthorizationCore` with a permissive-but-real `IsAuthenticatedAuthorizationService` (lines
  56-57), registers a **mutable** `AuthenticationStateProvider` (line 58), adds logging plus
  localization (lines 63-64, so components that inject `IStringLocalizer<T>` render without per-test
  setup), and `TryAdd`s `TimeProvider.System` (line 70) so a test that drives time deterministically
  can register a fake instead.
- The provider is mutable (`MutableAuthenticationStateProvider`, line 162) because it must serve both
  cascading-`AuthenticationState` consumers and pages that call `GetAuthenticationStateAsync()` on the
  injected service (class remarks, lines 25-27). `RenderAs<TComponent>(principal, parameters)`
  (line 130) sets the principal and renders with a matching cascading value;
  `RenderUnderTest<TComponent>` (line 124) is the anonymous shortcut; `SetUser` (line 121) changes the
  principal mid-test.
- `RenderMudProviders()` (line 148) renders MudBlazor's popover, dialog and snackbar providers into the
  test's render root so a component that opens a `MudMessageBox` or raises a snackbar has somewhere to
  render, returning the handles as a `MudProviderHandles` record (line 157).
  `ConfigureDataGridListPageHost` (line 100) is the shared arrange step for the grid-backed list pages.
- The remaining types are supporting doubles: `TestPrincipal`, `MarkupSnapshot`,
  `BunitInteractionExtensions`, `ErrorSummaryExtensions`, `HttpTestDoubles`,
  `CapturingHttpMessageHandler`, `StubTokenStorageService`, and `UiHttpServiceHarness`.
- The class remarks (lines 29-35) record the version pin worth knowing: it is written against bUnit v2
  (the line compatible with xUnit v3 and Microsoft Testing Platform), and if a restore ever resolves
  v1.x, this file is the only place that changes.

---

### MMCA.Common.Testing.Aspire

`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Aspire/`, 10 types, shipped as
`MMCA.Common.Testing.Aspire` (`MMCA.Common.Testing.Aspire.csproj:3`). Its package description states
the job exactly: a collection fixture that boots a real Aspire AppHost, waits for per-resource health,
and typed assertions for the framework wiring contracts, health, liveness, JWKS, h2c and data sources
(`MMCA.Common.Testing.Aspire.csproj:4`). Three folders:

- **`Fixtures/`**: `AppHostFixtureBase` (`Fixtures/AppHostFixtureBase.cs:38`) and its generic form
  `AppHostFixtureBase<TAppHost>` (`Fixtures/AppHostFixtureBase.Generic.cs:20`), the per-class
  `AppHostTestBase<TFixture>` (`Fixtures/AppHostTestBase.cs:29`), and `AppHostReadinessBudget`
  (`Fixtures/AppHostReadinessBudget.cs:16`), which makes the wait allowance a passed value rather
  than a timeout hard-coded inside the fixture.
- **`Preconditions/`**: `AppHostEnvironmentGate` (`Preconditions/AppHostEnvironmentGate.cs:9`) and
  `AppHostEnvironmentRequirement` (`Preconditions/AppHostEnvironmentRequirement.cs:10`),
  `DockerAvailability` (`Preconditions/DockerAvailability.cs:13`), `DeveloperCertificateAvailability`
  (`Preconditions/DeveloperCertificateAvailability.cs:22`) and `EphemeralRsaKeyPair`
  (`Preconditions/EphemeralRsaKeyPair.cs:20`). This folder is why the tier can be optional without
  being a silent no-op: the things a real-stack boot needs (a container runtime, a trusted
  development certificate, a signing keypair) are first-class checkable types rather than a note in
  a README.
- **`Probes/`**: `AppHostProbePaths` (`Probes/AppHostProbePaths.cs:15`) and `H2cProbe`
  (`Probes/H2cProbe.cs:25`), the endpoint contract a framework host is expected to satisfy and the
  cleartext HTTP/2 check an ordinary `HttpClient` cannot perform.

MMCA.Common consumes the package from both sides: `MMCA.Common.Testing.Aspire.Tests` (15 types,
in-solution) unit-tests the preconditions and probes, and the out-of-solution
`MMCA.Common.Testing.Aspire.AppHostTests` (6 types) boots a sample AppHost through the fixtures in its
own CI job (`MMCA.Common/.github/workflows/ci.yml:1437`, section 7).

[Rubric §33, Developer Experience]: §33 assesses how much harness an engineer has to build before
writing the test they actually wanted. Shipping the AppHost boot, the readiness wait and the
environment gates as a referenced package means a consumer AppHost gets a composition test by
subclassing two types, and the preconditions keep that test honest on a machine that cannot run it.

---

## 4. Architecture fitness tests, executable governance

[Rubric §34, Architecture Governance & Documentation]: §34 assesses whether architectural
decisions are documented, enforced, and kept honest over time; fitness functions are the "enforced"
axis. [Rubric §3, Clean Architecture]: §3 assesses whether the layering is real (code can't
reference upward) or aspirational (rules stated in a README but never enforced). The architecture
tests make the rules real.

The primer explains (`00-primer.md#architecture-enforcement-is-doubled-fitness-functions`) that
layer rules are enforced **twice**: at compile-time (the MSBuild `.targets` file) and at runtime
(the package's own rule engine). This section covers the runtime half.

### `ArchitectureTypes`, the mechanism

The engine works on compiled assemblies, not source, and needs no third-party package.
`ArchitectureTypes.InAssembly(assembly)` reads the assembly from its file through
`System.Reflection.Metadata` without loading it
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureTypes.cs:50`), and a rule
reads as `ArchitectureTypes.InAssembly(assembly).ShouldNot().HaveDependencyOnAny(namespacePrefix)`.
The condition returns an `ArchitectureRuleResult` directly, with an `IsSuccessful` flag and the
`FailingTypeNames` (nested types spelled `Outer+Inner`; `ArchitectureRuleResult.cs:4`). Dependency
names match whole dot-separated segments, so an entry ending in a dot matches nothing
(`ArchitectureTypes.cs:27-31`), and a type's dependencies include the types its method bodies name,
lambdas and async state machines included (`:31-34`).
The shared `ArchitectureAssert.NoViolations(result, reason)` method converts a failure
into an xUnit assertion failure whose message includes the reason string and the offending type
names, so a developer adding a forbidden reference sees exactly which type broke the rule and why.

**The rule bodies live once, in a shipped package.** `MMCA.Common.Testing.Architecture` holds the
reusable rule library, now **35 `ArchitectureRules.*` partial classes** filed by area under
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/`: `Api/` (`Controllers`),
`Contracts/` (`Contracts`, `ErrorCatalog`, `Events`, `IntegrationEventPurity`, `Protos`, `Upcasters`),
`Cqrs/` (`CancellationTokens`, `CommandValidators`, `DomainEventHandlerSaves`, `Handlers`,
`HandlerResults`, `Idempotency`, `Slices`), `Domain/` (`CascadeSoftDelete`, `DeleteBehavior`,
`DomainThrows`, `Entities`, `Immutability`, `SoftDelete`, `Specifications`, `StronglyTypedIds`),
`Governance/` (`FeatureFlags`, `FolderWidth`, `Governance`, `Naming`), `Layering/` (`Ai`, `Cycles`,
`Layers`, `Modules`, `Purity`, `Transport`) and `Ui/` (`Localization`, `LocalizedText`, `Markup`),
plus a `CallGraphIndex` for the rules that must follow a call chain rather than a type reference, and
**53 abstract `*TestsBase` classes** in `Bases/`, all parameterized by an `IArchitectureMap`. The
package declares **136 test methods across those 53 bases**, and MMCA.Common's own build executes
**267** of them: the methods of the bases its arch-tests subclass, plus its Common-only direct tests
(`MMCA.Common/FACTS.md:48,51`, which is generated from source and CI-gated, so it is the number to
quote rather than a hand count).

Each repo's `*.Architecture.Tests` project consumes the package and supplies its own map:
`CommonArchitectureMap` (MMCA.Common, every layer is a framework layer, one anchor type per package),
`AdcArchitectureMap` (adds the per-module Identity/Conference/Engagement/Notification layers),
`StoreArchitectureMap` and `HelpdeskArchitectureMap`. A concrete test class is then a short sealed
subclass, e.g.:

```csharp
public sealed class LayerDependencyTests : LayerDependencyTestsBase
{
    protected override IArchitectureMap Map { get; } = new CommonArchitectureMap();
}
```

(`MMCA.Common.Architecture.Tests/LayerDependencyTests.cs:9-12`). The map's anchor types
(`CommonArchitectureMap.cs:21-27`, e.g. `typeof(Common.Domain.Entities.BaseEntity<>).Assembly` at
line 22) mean the assembly path is always the one actually compiled into the test run, not a
hard-coded path. Because all four repos drive the same rule bodies, the architecture rules stay
identical across them and a fix to a rule propagates with the next package bump rather than needing a
hand-copy. `MMCA.Common.UI.Maui` is deliberately absent from the Common map
(`CommonArchitectureMap.cs:9-13`): its four MAUI TFM assemblies cannot load in the ubuntu-run
`net10.0` test process, so its layer boundary is enforced at compile time by
`EnforceUIMauiLayerBoundary` in `Source/Build/MMCA.Common.LayerEnforcement.targets` and the windows
`build-maui` job instead.

The walkthroughs below describe **what each rule enforces** (and the count of facts it produces);
the rule *implementations* live in the shared package's `ArchitectureRules.*` + `*TestsBase` files,
not in the per-repo test class.

### MMCA.Common.Architecture.Tests, 524 types

Located at `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/`, filed into the same
per-area folders as the rule library (`Api/`, `Contracts/`, `Cqrs/`, `Domain/`, `Governance/`,
`Layering/`, `Ui/`) plus the `*Fixtures/` trees the adversarial suites drive. Beside the test
classes sit `CommonArchitectureMap`, `GlobalUsings.cs` and the fixture files; most of the 230
inventoried types are those fakes, drifted probes and fixtures, which is why the type count runs so
far ahead of the number of test classes. The project falls into two halves:

**Thin subclasses of a shared mapped base** (about half the files): `LayerDependencyTests`,
`DomainPurityTests`, `MicroserviceExtractionTests`, `PiiConventionTests`, `AggregateConventionTests`,
`DependencyVersionTests`, `EventVersioningConventionTests`, `SliceCohesionTests`,
`HandlerResultConventionTests`, `RawQueryableConventionTests`, `UIArchitectureConventionTests`,
`StateManagementConventionTests`, `LocalizationResourceTests`, `LocalizedTextConventionTests`,
`AnonymousEndpointTests`, `CancellationTokenConventionTests`, `CascadeSoftDeleteConventionTests`,
`ConcurrencyConventionTests`, `ContractImplementationTests`, `IdempotencyConventionTests`,
`NamespaceCycleTests`, `ServiceContractPurityTests`, `SoftDeleteEnforcementTests`, plus the two
conformance subclasses over fake modules (`FakeLeafModuleConformanceTests` and
`FakeDependentModuleConformanceTests`, `ModuleConformanceTestsBaseTests.cs:51,60`).

**Common-only direct tests that guard the rules themselves.** This is the half that has grown most,
and it is the interesting one: a `*FitnessTests` file exists wherever a mapped rule would otherwise
pass vacuously in a framework that ships no business module, or where the rule's own logic needed
adversarial coverage. The family is `PiiErasureContractFitnessTests`, `SpecificationFitnessTests`,
`CancellationTokenFitnessTests`, `CascadeSoftDeleteFitnessTests`,
`CommandValidatorCoverageFitnessTests`, `DomainEventHandlerSaveFitnessTests`,
`DomainThrowFitnessTests`, `ErrorCatalogFitnessTests`, `EventScopeFitnessTests`,
`EventUpcasterFitnessTests`, `IdempotencyFitnessTests`, `NamespaceCycleFitnessTests`,
`PasswordHashingFitnessTests`, `ProtoContractFitnessTests`, `SoftDeleteEnforcementFitnessTests` and
`SortableColumnFitnessTests`, alongside `FrameworkSanityTests`, `NavigationContractTests`,
`LayerDependencyOverrideTests`, `AnonymousEndpointTestsBaseTests`,
`IntegrationEventContractTestsBaseTests`, `ModuleIsolationTestsBaseTests`,
`ObservabilityConventionTestsBaseTests` and `ModuleConformanceTestsBaseTests`.

Four of them deserve naming, because they exist to stop a gate becoming a decoration:

- `PiiErasureContractFitnessTests` forces a representative `[Pii]`-carrying data subject through
  `PiiRedactor` and `IAnonymizable` end to end, because the mapped `PiiConventionTests` scan is
  structurally vacuous in a framework that ships no data-subject entity.
- `SpecificationFitnessTests` tests the rule itself: it asserts
  `SpecificationsDoNotNavigateToOtherEntities` flags a navigating specification and does **not** flag
  a scalar one.
- `ObservabilityConventionTestsBaseTests` subclasses `ObservabilityConventionTestsBase` from a
  *different assembly* than the base (line 14), because the base must read the embedded IaC resources
  of the subclass's assembly. Resolving against the base's own assembly would be a silent break that
  the framework's own CI would never catch.
- `ModuleConformanceTestsBaseTests` (`ModuleConformanceTestsBaseTests.cs:86`) is adversarial coverage
  for `ModuleConformanceTestsBase<TModule>`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/ModuleConformanceTestsBase.cs:21`),
  the base the consumer repos' near-identical `{X}ModuleTests` files collapse into. Its four facts
  (lines 39, 45, 58, 64) assert name, dependencies, `RequiresDependencies` and disabled-stub
  registration; the drift tests assert each check actually **fails** on the drift it claims to catch,
  driven by a `private` drifted subclass (line 131) so xUnit does not collect its deliberately failing
  inherited facts as tests of their own. Another runs the base against a leaf module that overrides
  neither member, proving the base reaches `IModule`'s **default interface implementations** rather
  than members on the concrete type, which is the one thing that would break silently across the
  package boundary.

#### `LayerDependencyTests`
`MMCA.Common.Architecture.Tests/LayerDependencyTests.cs:9`

15 `[Fact]` methods from `LayerDependencyTestsBase`
(`MMCA.Common.Testing.Architecture/Bases/LayerDependencyTestsBase.cs:52-96`): two anti-vacuity guards
plus one per forbidden directed edge in the layer graph.

- `LayerMap_DeclaresEveryExpectedLayer` and `LayerMap_ModulesDeclareEveryExpectedLayer` (2 facts,
  lines 53 and 56). These assert the map actually declares the required layers (`RequiredLayers`,
  line 16; `RequiredModuleLayers`, line 27) and that every declared module registers them too, so a
  map that quietly stopped covering an assembly cannot leave the rules below passing on nothing. A
  module with a deliberately different shape declares that in
  `ModuleRequiredLayerOverrides` (line 49) rather than by being skipped.
- `Domain_ShouldNotDependOn_Application/Infrastructure/Api` (3 facts, lines 60-66)
- `Application_ShouldNotDependOn_Infrastructure/Api` (2 facts, lines 69-72)
- `Infrastructure_ShouldNotDependOn_Api` (1 fact, line 75)
- `Shared_ShouldNotDependOn_Domain/Application/Infrastructure/Api` (4 facts, lines 78-87)
- `Ui_ShouldNotDependOn_Domain/Application/Infrastructure` (3 facts, lines 90-96)

The last three confirm the two deliberate exceptions to the standard stack (`UI` and `Grpc` depend
only on `Shared`) are honored in the other direction, `UI` must not depend on Application,
Infrastructure, or Domain.

#### `DomainPurityTests`
`MMCA.Common.Architecture.Tests/DomainPurityTests.cs:9`

4 facts (`Bases/DomainPurityTestsBase.cs:15,18,21,24`). Two assert Domain and Shared contain no
reference to the forbidden framework list, which lives once in `ArchitectureRules.Purity`
(`ArchitectureRules.Purity.cs:9-22`): `Microsoft.AspNetCore`, `Microsoft.EntityFrameworkCore`,
`Serilog`, `AutoMapper`, `Newtonsoft.Json`, `FluentValidation`, `Scrutor`, `MudBlazor`, `Polly`,
`Stripe`, `StackExchange.Redis`. The other two assert Application depends on neither
`Microsoft.EntityFrameworkCore` nor `Microsoft.AspNetCore`. A repo extends the list rather than
replacing it: `ExtraForbiddenDomainDependencies` (base line 12) is how ADC adds `RabbitMQ`
(`MMCA.ADC.Architecture.Tests/DomainPurityTests.cs:9`).
[Rubric §3, Clean Architecture]: this is the runtime enforcement that the domain is genuinely
framework-independent, not just convention.

#### `MicroserviceExtractionTests`
`MMCA.Common.Architecture.Tests/Layering/MicroserviceExtractionTests.cs:11`

One fact, `CoreLayers_ShouldNotDependOn_Transport`
(`Bases/Layering/MicroserviceExtractionTestsBase.cs:13-14`), enforcing the transport-isolation invariant for
microservice extraction ([ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html)/[ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html)):
the broker clients the framework's own transports run on (`RabbitMQ.Client`,
`Azure.Messaging.ServiceBus`, `Amazon.SQS`, `Amazon.SimpleNotificationService`), `MassTransit`
(banned outright by [ADR-118](https://ivanball.github.io/docs/adr/118-message-transport-library-policy.html)),
`Grpc` and `Google.Protobuf` (`Rules/Layering/ArchitectureRules.Transport.cs:14-23`) must never leak
into Domain, Application or Shared, so a module behaves identically in-process or extracted and the
split stays reversible. Core layers publish through `IEventBus` and their own interfaces instead (the
failure message at lines 37-39).

The Common-only sanity checks the shared library does not generalize live in **`FrameworkSanityTests`**
(`MMCA.Common.Architecture.Tests/FrameworkSanityTests.cs:13`), not in `MicroserviceExtractionTests`.
Six facts (lines 22-47): `Grpc` must not depend on `Domain`, `Application` or `Infrastructure`
(lines 22, 27, 32); `IMessageBus` lives in `Application` (line 37); `IJwksProvider` lives in
`Infrastructure` (line 42); and `ILiveChannelPublisher` lives in `Application` (line 47), so
application code stays transport-free. These pin the abstractions and the transport package to their
correct layer so a future refactor cannot quietly move them. They are Common-only because MMCA.Common
is the one repo that owns the `MMCA.Common.Grpc` transport package and defines those abstractions
(`FrameworkSanityTests.cs:9-11`).

#### `PiiConventionTests`
`MMCA.Common.Architecture.Tests/PiiConventionTests.cs:13`

1 fact, `EntitiesWithPiiProperties_ShouldImplement_IAnonymizable`
(`Bases/PiiConventionTestsBase.cs:12`): any domain entity bearing a `[Pii]`-decorated property must
implement `IAnonymizable` ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html)),
so it has an erasure path. The scan passes vacuously in the framework (MMCA.Common's Domain ships no
data-subject type) and fails the build the moment one is added without an erasure path. That vacuity
is exactly why `PiiErasureContractFitnessTests` exists beside it.
[Rubric §30, Compliance, Privacy & Data Governance]: §30 assesses whether GDPR/CCPA erasure
obligations are structurally enforced; the pair is the structural gate plus its non-vacuous proof.

#### `AggregateConventionTests`
`MMCA.Common.Architecture.Tests/AggregateConventionTests.cs:9`

4 facts checking DDD factory conventions (`Bases/AggregateConventionTestsBase.cs:15,18,21,24`). This
is the minimal aggregate base, for repos with no business modules; module-bearing repos use the
fuller `EntityConventionTestsBase` instead.

- `Domain_ShouldExpose_AggregateRoots` (line 15), asserts the filter finds at least one aggregate
  root, guarding against the whole class becoming vacuous.
- `AggregateRoots_ShouldHave_ResultReturningCreateFactory` (line 18), every aggregate root is built
  via a static `Create(...)` returning `Result<T>`.
- `AggregateRoots_ShouldHave_NoPublicConstructors` (line 21), the factory is the only way in.
- `DomainFactories_ShouldReturn_Result` (line 24), the same Result-returning convention holds for
  every domain and value-object `Create`.

[Rubric §4, Domain-Driven Design]: §4 assesses whether the domain model is authentic DDD; factory
method plus `Result<T>` return plus no public constructor is the DDD "a factory prevents invalid
entity construction" pattern, here enforced automatically rather than by review.

#### `DependencyVersionTests`
`MMCA.Common.Architecture.Tests/Governance/DependencyVersionTests.cs:11`

A subclass of `DependencyVersionTestsBase`, which holds one fact,
`MassTransit_MustNotBeReferenced` (`Bases/Governance/DependencyVersionTestsBase.cs:12-18`): it calls
`ArchitectureRules.NoPackageVersionWithPrefix("MassTransit", ...)`, which finds the repo's
`Directory.Packages.props` by walking up from the test output folder and fails on any
`PackageVersion` whose id starts with the prefix, matched case-insensitively
(`Rules/Governance/ArchitectureRules.Governance.cs:66-88`). The ban is the
[ADR-118](https://ivanball.github.io/docs/adr/118-message-transport-library-policy.html) policy as an
executable rule: the broker transports are framework code over the vendor SDKs behind `IMessageBus`,
and v9 of the library needs a commercial license (the reason string, lines 16-18).

The Common subclass adds its own adversarial facts so the rule is known to bite and not to pass
vacuously (class doc, lines 5-10): a `[Theory]` pins `MassTransit`, `MassTransit.RabbitMQ` and a
lower-cased `masstransit.azure.servicebus.core` into throwaway props files and expects a failure
naming each (lines 13-30), a clean file passes (lines 32-46), and five more facts cover the shipped
version-ceiling rule `ArchitectureRules.PinnedPackageMajorBelow` that consumers still call (lines
48-123).

MMCA.Common is the only repo that declares this class today; MMCA.ADC's architecture suite does not
subclass the base, although the base documents that a consumer may subclass it as-is because the ban
holds for every repo (base doc, line 8). [Rubric §32, Dependency &
Supply-Chain]: §32 assesses whether dependency versions are tracked, pinned, and protected against
accidental bumps; this is the build-time gate for the most dangerous version upgrades in the codebase.
(See the primer `00-primer.md#nuget-lock-files--pinned-audited-sources` for context.)

### MMCA.ADC.Architecture.Tests, 86 types

Located at `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/`: 54 fitness-function classes
plus `AdcArchitectureMap` and the `ServiceModels` fixture (`Domain/DeleteBehaviorConventionTests.cs:70`). Like the Common project, most are thin subclasses of the shared
`*TestsBase` classes from `MMCA.Common.Testing.Architecture`, referenced as a NuGet package
(`MMCA.ADC.Architecture.Tests.csproj:41`; the project also references `MMCA.Common.Testing` at line
43 for `DecoratorPipelineOrderTestsBase` and `MiddlewarePipelineOrderTestsBase`). Each supplies
`AdcArchitectureMap` (`AdcArchitectureMap.cs:14`), which declares the five MMCA.Common framework
layers (lines 21-25) and then the module layers: six each for Identity (28-33), Conference (36-41)
and Engagement (44-49), and **three** for Notification (52-54), which owns no aggregate and no
persistence and therefore ships no Domain, Infrastructure or UI assembly (type comment, lines 8-11).
`LayerDependencyTests` records that shape in its per-module required-layer override rather than
skipping the module, which keeps full enforcement on the other three. The rule bodies are shared;
only the map and the per-repo overrides differ.

The csproj also embeds three files as resources (`MMCA.ADC.Architecture.Tests.csproj:7-23`), because
three of the gates read artifacts rather than assemblies: the shared `ADCHome.razor.css` for the
brand-token guard (lines 11-13), and `infra/main.bicep` plus `infra/OPERATIONS.md` for the SLO
alert-to-runbook pairing guard (lines 17-22).

#### `LayerDependencyTests` (ADC)
`MMCA.ADC.Architecture.Tests/LayerDependencyTests.cs:3`

The same 15 facts as the Common subclass, but the map iterates every framework layer **and** every
declared module layer, so each rule runs once per assembly. The two anti-vacuity guards matter more
here: `LayerMap_ModulesDeclareEveryExpectedLayer` fails if a module stops declaring one of the layers
its override says it has, which is what stops a new module silently escaping the dependency rules.

#### `ModuleIsolationTests`
`MMCA.ADC.Architecture.Tests/ModuleIsolationTests.cs:3`

The cross-module boundary rules, the modular monolith's core governance: a module's Domain must not
depend on any other module's Domain, its Application not on another's Application, Infrastructure
not on another's Infrastructure, API not on another's API, and neither Domain nor Application may
reach into another module's Infrastructure. Cross-module communication is allowed only through
`*.Shared` (contract) layers and DI-injected interfaces. The "all other modules' namespaces at this
layer" list is generated dynamically by `ModuleIsolationTestsBase` / `ArchitectureRules.Modules` from
the modules declared in `AdcArchitectureMap`, so adding a module extends the rule with no edit here.

#### `MicroserviceExtractionTests` (ADC)
`MMCA.ADC.Architecture.Tests/Layering/MicroserviceExtractionTests.cs:3`

The same single transport-isolation fact, applied across all ADC module layers. For Domain,
Application and Shared of every module, plus the Common Domain/Application layers, none of the
broker clients (`RabbitMQ.Client`, `Azure.Messaging.ServiceBus`, `Amazon.SQS`,
`Amazon.SimpleNotificationService`), the banned `MassTransit`, `Grpc` or `Google.Protobuf` may
appear (`Rules/Layering/ArchitectureRules.Transport.cs:14-23`). Transport belongs only in
Infrastructure, the vendor adapters, the `*.Service` hosts, and `*.Contracts` projects (lines 9-11).
A matching detail worth knowing, recorded in the rule itself (lines 11-12): it matches by namespace *prefix*, so `'Grpc'`
catches `Grpc.Core` / `Grpc.Net.*` / `Grpc.AspNetCore` but NOT the project's own `MMCA.Common.Grpc`
(which starts with `MMCA`), so the rule does not accidentally flag the framework's own transport
package.

#### `PiiConventionTests` (ADC)
`MMCA.ADC.Architecture.Tests/PiiConventionTests.cs:3`

The same rule, but the ADC map makes it non-vacuous: the Identity `User` aggregate is PII-bearing, so
the `[Pii]` to `IAnonymizable` check actually has a subject. The Conference `Speaker` is deliberately
not marked, because speaker names and emails are public agenda content sourced from Sessionize, not
app-user PII subject to the privacy policy's erasure right.

#### The remaining ADC classes

The first group is bare subclasses, one line of map and nothing else. The second group carries a
per-repo override, which is where the interesting decisions live.

| Class | Focus |
|---|---|
| `DomainPurityTests` | Framework-independence of all module Domain layers; adds `RabbitMQ` to the forbidden list (line 9) |
| `HandlerConventionTests` | Command/query handlers implement the right interface |
| `ConcurrencyConventionTests` | Every `*UpdateRequest` implements `IConcurrencyAware` (the ADR-035 optimistic-concurrency round-trip) |
| `EntityConventionTests` | Entities inherit the correct base class and use `Create(...)` factories |
| `NamingConventionTests` | Handler/repo/service naming follows conventions |
| `EventConventionTests` | Integration events inherit `BaseIntegrationEvent`, declare a `SchemaVersion`, live in a `*.IntegrationEvents` namespace (ADR-010) |
| `ImmutabilityTests` | DTOs, events and value objects are immutable (records, no public setters) |
| `SharedLayerTests` | Shared projects contain only DTOs, enums, identifier aliases |
| `SliceCohesionTests` | Each `Application/{Aggregate}/UseCases/{Operation}/` slice keeps its command/query, handler and validator in one namespace (§5) |
| `AnonymousEndpointTests` | Every `[AllowAnonymous]` endpoint is a declared, reviewed exception rather than an accident (§11) |
| `CascadeSoftDeleteConventionTests` | Soft-deleting a parent cascades to the children the model says it owns |
| `ContractImplementationTests` / `ServiceContractPurityTests` | The gRPC service contracts and their implementations stay on the right side of the transport boundary |
| `DomainEventHandlerSaveTests` | A domain-event handler does not call `SaveChangesAsync` inside the dispatching transaction |
| `DomainThrowTests` | Domain code returns `Result` failures rather than throwing |
| `ErrorCatalogTests` | Error codes come from the shared catalog, not ad-hoc strings |
| `IdempotencyConventionTests` | Every POST action declares `[Idempotent]` or `[NonIdempotent("why")]` |
| `ProtoContractTests` | The `.proto` contracts keep their field numbering and reserved ranges |
| `SoftDeleteEnforcementTests` | Queries and deletes go through the soft-delete path, never a hard delete |
| `SortableColumnConventionTests` | Every grid column advertised as sortable maps to a real orderable property |
| `MicroserviceExtractionTests`, `LayerDependencyTests`, `ModuleIsolationTests`, `PiiConventionTests` | Covered above |
| `HandlerResultConventionTests` | Every handler's `TResult` is `Result` or `Result<T>`, turning the pipeline's runtime `ResultFailureFactory` constraint into a build-time gate |
| `FrameworkVersionConsistencyTests` | All `MMCA.Common.*` pins in `Directory.Packages.props` share one version: ADR-016 lockstep made executable, so a partial sweep reds at CI time |
| `SpecificationConventionTests` | No specification filters by navigating to another entity (which would not translate if that entity moved data source); kept on as a forward safeguard after the Cosmos/SQLite trial was reverted (ADR-018) |
| `StateManagementConventionTests` | The module UI assemblies carry no mutable static state (a static member is shared across every Blazor Server circuit) and stateful UI services stay scoped (§19) |
| `UIArchitectureConventionTests` | Every code-behind under `Source/` stays within the line cap and inline `@code` blocks stay small (§18) |
| `MiddlewarePipelineOrderTests` | The ADR-058 edge-pipeline order base, subclassed with an empty body because ADC's hosts call the zero-argument `UseCommonMiddlewarePipeline()` overload (line 15) |

| Class with a per-repo override | The decision it encodes |
|---|---|
| `ControllerConventionTests` | Controllers inherit `ApiControllerBase` and declare `[ApiVersion]`, with an explicit exemption list (line 11): `OAuthController` drives the OAuth2 redirect/challenge flow and `ServiceInfoController` is an anonymous version-discovery diagnostic, so neither returns domain Results |
| `IntegrationEventContractTests` | Freezes the cross-service async wire contract as literal signatures (line 9). Reshaping one without versioning it reds the build |
| `ConstructorDependencyCountTests` | Single-responsibility ceiling of **9** (line 24). The doc comment (lines 10-17) is the whole point of the class: it was 8 while the comment claimed `AuthenticationService` had 8 dependencies when it had 7, so the gate carried a phantom slot of headroom and was tightened to the real mark on 2026-07-28; it then moved to 9 when refresh tokens became multi-device sessions and the framework's `AuthenticationServiceBase` took on the session store and its options. Both additions are framework-imposed collaborators of the same facade rather than a second responsibility, so the honest response was a raised ceiling and not an artificial bundle |
| `RawQueryableConventionTests` | Application code must not use the repository's raw `IQueryable` surfaces (EF-coupled handlers cannot move behind a gRPC boundary). `AllowedFiles` (line 33) is an adoption ratchet pinning existing deliberate uses so only NEW code is blocked; `ApplicationSourceDirectories()` (line 21) appends the Notification module's Application project by path so the thin module is scanned under the same rule |
| `FormsConventionTests` | The Conference create forms keep their `UnsavedChangesGuard`, dirty tracking, validated `MudForm` and per-form error summary (§24); `MinimumCreateForms => 8` (line 21) is the anti-vacuity floor and `RequiredMarkers` (line 40) is the marker set, plus a bespoke fact for the Identity Profile form, which does not match the `*Create.razor` glob |
| `LocalizedTextConventionTests` | No hard-coded user-visible literals in `.razor`; `MinimumScannedFiles = 60` (line 18) is the anti-vacuity floor |
| `TranslationCompletenessTests` | Every base `.resx` has a complete, non-empty `.es.resx` sibling (`RequiredCultures`, line 14); `MinimumBaseResources = 40` (line 16) is the floor (§27, ADR-027) |
| `CommandValidatorCoverageTests` | Every handled, data-carrying command has a real validator, with a `MinimumCommands` floor so the module dropping out of the map fails loudly rather than passing vacuously |
| `BrandColorTokenTests` | The shared `ADCHome` stylesheet sources the primary brand color from `var(--mmca-primary)`, not a re-hardcoded hex (§20). Reads the embedded CSS, not an assembly |
| `DataResidencyTests` | The data-residency statement in `PRIVACY.md` must match the region where PII is actually provisioned, extracted by `ExtractDeployedRegion` (line 20) from `deploy.yml`. `ForbiddenResidencyClaims` (line 16) blocks the stale "central United States" wording that once contradicted the deployed region (§30) |
| `ObservabilityConventionTests` | Every provisioned SLO alert in `infra/main.bicep` keeps a matching, severity-correct section in `infra/OPERATIONS.md`, and no orphan runbook sections exist (§13). Reads the two embedded resources |
| `DecoratorPipelineOrderTests` | The ADR-058 runtime conformance base, driven against the real `ChangePreferencesCommand` / `GetUserPreferencesQuery` pair through the Identity module's genuine registration sequence (line 28) |

### The topology gate that reads the AppHost and the Bicep

Three of the ADC architecture gates read artifacts rather than assemblies. A fourth of the same shape
lives outside the architecture project, in the Gateway suite:
`AppHostBicepParityTests` (`MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/AppHostBicepParityTests.cs:24`).

The service-discovery topology is declared **twice** and nothing connects the two declarations. The
Aspire AppHost's `WithReference(peer)` calls inject `services__{peer}__{endpoint}__0` environment
variables for local development and the E2E stack; `infra/main.bicep` hand-writes the same variables
onto each production container app. So a new cross-service call wired in the AppHost boots locally,
passes every test, and then fails in production with an unresolvable service name, and the reverse
case (a Bicep entry for an edge that no longer exists) is dead configuration nobody notices
(class doc, lines 7-16).

Two facts close the loop in both directions:
`EveryAppHostServiceReference_HasAMatchingBicepServiceDiscoveryEntry` (line 53) and
`EveryBicepServiceDiscoveryEntry_HasAMatchingAppHostReference` (line 73). Three details are worth
reading:

- **Both files are read as text, not executed** (lines 17-22). The AppHost is a
  `DistributedApplication` that hangs when started headless, and Bicep is not executable in a test
  process at all. `ReadAppHostEdges` (line 98) parses `Source/Hosting/MMCA.ADC.AppHost/Program.cs`
  statement by statement, mapping each `AddProject<Projects.X>("name")` variable to its Aspire
  resource name (lines 104-105) and attributing every `WithReference` to the resource the statement
  is about (lines 112-128), so both the chained and the standalone call forms are counted. The parse
  is deliberately narrow so reformatting either file does not move the gate.
- **The exception list carries reasons, not just names.** `KnownAppHostOnlyEdges` (line 43) holds the
  five UI edges that production deliberately does not wire as service discovery, and the remarks
  above it (lines 31-42) say why: the Blazor server head reaches only the gateway, through
  `Api__ApiEndpoint`, because one of its consumers is a SignalR `HubConnection` that builds its own
  message handler and never sees the service-discovery handler, while the WASM client needs the
  separately-configured browser-reachable `Api__WasmApiEndpoint`. The comment states the operating
  rule plainly: an unexplained entry is indistinguishable from the drift the test exists to catch
  (lines 28-29).
- **The parse is guarded against becoming vacuous.** The reverse fact asserts the Bicep edge set is
  non-empty first, on the grounds that an empty parse means the test stopped reading the file rather
  than that the file is clean (line 85).

[Rubric §17, DevOps & Deployment]: §17 assesses whether the deployment configuration is verified
rather than trusted; this is a unit-tier test that gates a production infrastructure fact, at no
Azure cost and no container start. [Rubric §13, Observability & Operability]: an unresolvable
service name is a production-only failure with a confusing signature, and this converts it into a
build-time one.

### The same rules in Store and Helpdesk

MMCA.Store's `MMCA.Store.Architecture.Tests` subclasses the same bases over `StoreArchitectureMap`,
and adds the same two order gates (`DecoratorPipelineOrderTests.cs:28`,
`MiddlewarePipelineOrderTests.cs:15`).

MMCA.Helpdesk is the interesting case, because it is the reference app: the bulk of its architecture
suite is **one file** of 21 one-line subclasses over `HelpdeskArchitectureMap`
(`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs`, 181 lines),
which is the intended cost of adoption made visible. Five siblings sit beside it where a subclass
needed more than one line: `AnonymousEndpointTests`, `ContractImplementationTests`,
`ServiceContractPurityTests`, `DecoratorPipelineOrderTests` and `MiddlewarePipelineOrderTests`.

Two details in that file are worth reading. Several subclasses carry a short comment explaining why
the seed opts in even where the rule is vacuous today: `SpecificationConventionTests` is vacuous
because Tickets has no specifications, but keeps the reference app consistent and guards future ones
(lines 25-28), while `EventConventionTests` is explicitly non-vacuous because Tickets ships
`TicketOpenedIntegrationEvent`, which closed an enforcement gap where the rule was only subclassed in
ADC and Store (lines 34-37). And `CommandValidatorCoverageTests` sets `MinimumCommands => 6` against
7 real commands (lines 167-174), with the reasoning that the floor should sit just below the true
count so a rename does not trip it while the module dropping out of the map still does.

The trailing comment (lines 177-181) is the part to read last: it records which bases are **not**
adopted and why, separating "legitimately inapplicable" (`ConstructorDependencyCountTestsBase`
deliberately fails when it finds no Application `*Service`, and this seed's Application layer is
handlers-only; `DataResidency`/`BrandColorToken`/`FormsConvention` are reduced-scope) from an
enforcement gap, and it names the trigger for adopting the first one (the moment an Application
`*Service` appears, at ceiling 7 to match ADC). That distinction is the difference between an audited
inventory and an unexamined one.

### The compile-time layer rules the packages ship

The runtime rules above have a compile-time counterpart that ships inside the packages rather than in
a test project. `MMCA.Common.Shared` carries a `buildTransitive` targets file that gives any consumer
project named `{App}.{Module}.{Layer}` the layer rules at `ResolveProjectReferences`, with no opt-in
(`MMCA.Common/.github/workflows/ci.yml:985-987`): `MMCA0001` for a forbidden project reference and
`MMCA0002` for a forbidden package reference. The proof runs in `package-consumption` (`ci.yml:929`),
the job that consumes the freshly packed local feed, in the step "Layer rules ship with the packages
(compile-time probes)" (`ci.yml:983`). Every step of that job calls one script,
`MMCA.Common/build/consumer-check/Invoke-ConsumerCheck.ps1`, one stage per step (`Pack`, `Scaffold`,
`Build`, `Probes`, dispatched at `Invoke-ConsumerCheck.ps1:281-285`). The reason is stated above the
first step: the script is the one implementation a contributor also runs locally, where
`pwsh build/consumer-check/Invoke-ConsumerCheck.ps1` runs all four stages, while one stage per CI step
keeps each step's name and log (`ci.yml:961-965`). A non-`All` stage refuses to run without a pinned
version, so every stage builds against the same packed nupkgs (`Invoke-ConsumerCheck.ps1:117-118`).
The `Probes` stage builds one positive probe and two negative ones (`Invoke-ConsumerCheck.ps1:262-278`),
and each negative probe must both fail and fail for its named code: `Assert-ProbeFails` stops the check
when the probe builds and again when its log lacks the expected code (`Invoke-ConsumerCheck.ps1:238-256`),
for `MMCA0002` on a domain probe that references the Infrastructure package (line 270) and `MMCA0001`
on a domain probe that references an Application project (line 275). The negatives carry the weight: a
passing probe on its own would also pass if the targets file were silently missing from the package, so
only a build refused with the expected code proves the rules arrived (`ci.yml:988-989`).

---

## 5. Integration and E2E strategy

### Per-service integration tests (SQL-gated)

The four integration test projects (Identity, Conference, Engagement, Notification) each boot their
service in-process with `WebApplicationFactory<Program>`. **The lifecycle is not written per repo:**
it lives once in `SqlServerIntegrationTestFixtureBase<TEntryPoint>`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Fixtures/SqlServerIntegrationTestFixtureBase.cs:27`), and the
concrete fixture supplies only the host-specific delta. Reading the base is what tells you what a
test run actually does:

1. **Database creation.** A throwaway SQL Server database is created with a GUID-embedded name,
   `{DatabaseNamePrefix}_{Guid:N}` (line 71), on the server given by the repo's
   `SqlBaseEnvironmentVariable`. If that variable is absent it defaults to
   `(localdb)\MSSQLLocalDB` (line 70).
2. **Environment injection.** Before the host builds, `ASPNETCORE_ENVIRONMENT=Testing` and the
   connection string are pushed as **process environment variables** (lines 75-76), then the
   subclass pushes its own (line 77). Process variables rather than `ConfigureAppConfiguration`
   because the host reads these at configure-time, before `WebApplicationFactory`'s
   `ConfigureServices` override runs. Pinning `Testing` also stops `appsettings.Development.json`
   loading, whose `DataSources` entry would point the module at `localhost` (line 74).
   Only the **first** original value per key is recorded (line 149), so re-pushing a key cannot
   clobber the restore point, and every one is restored on disposal (lines 159-164).
3. **Schema migration.** Creating the first `HttpClient` (line 83) forces `Program.cs` to run, which
   calls `InitializeDatabaseAsync(DatabaseInitStrategy.Migrate)`: the host's own init strategy
   applies the migrations, so the schema under test is the one production produces, not a fixture's
   guess.
4. **Per-test reset via Respawn.** `Respawner.CreateAsync` (line 90) configures Respawn to delete
   all rows except `__EFMigrationsHistory` (line 93). Each test calls `ResetDatabaseAsync()`
   (line 99) through `IntegrationTestBase.InitializeAsync()` before its body runs. This is faster
   than dropping and re-creating the database and handles foreign key cascades automatically.
5. **Disposal.** `SqlConnection.ClearAllPools()` releases pooled connections so the database is free
   to drop (line 170), then a `SET SINGLE_USER WITH ROLLBACK IMMEDIATE` + `DROP DATABASE` removes it
   (lines 182-183). The GUID name is server-generated, never user input, which is why the CA2100
   suppression there is safe (line 179).

The Identity fixture is what is left after all that:
`IdentityIntegrationTestFixture` (`MMCA.ADC/Tests/Integration/MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestFixture.cs:22`)
declares `ADC_TEST_SQL_BASE` (line 24) and `ADC_IdentityIntegrationTest` (line 26), returns its
factory (line 28), and overrides `ConfigureTestEnvironment` (line 39) with the Identity-specific
concerns: re-pointing the named `DataSources__Identity__SQLServerConnectionString` entry at the same
throwaway database (line 46, because identical strings collapse onto one physical source and keep the
module's tables in the test database), the committed RS256 test keypair and `kid` (lines 49-53), a
lifted registration throttle so the register tests can create several accounts from one IP
(lines 55-56), and dummy OAuth client credentials so the Google/GitHub challenge endpoints wire up
without any real provider call (lines 62-66). It is left **non-sealed** (doc, lines 18-21) so
`JwksEnabledIdentityFixture` can add the single JWKS-publishing delta. The web-application factory
beside it neutralizes the global rate limiter for the same reason
(`IdentityTestWebApplicationFactory.cs:47`).

Cross-service gRPC edges are faked for isolation: the non-Identity services re-point their
`AddForwardedJwtBearer` scheme at the in-process test key, and gRPC clients that would call other
services use stub implementations. This keeps each integration suite testing only its own service's
behavior. [Rubric §14, Testability]: §14 awards credit for isolation, per-test DB reset plus
per-service `WebApplicationFactory` means each test is truly independent.

### Testcontainers tiers: where the fakes stop

The fakes above are the point of the per-service tier, and also its limit: nothing in it exercises a
real broker or a real cross-service call. Two Docker-dependent projects close that gap, both in
`MMCA.ADC.slnx` but in neither `.slnf`, so a full `dotnet test --solution MMCA.ADC.slnx` needs a
Docker daemon (`MMCA.ADC.slnx:107-110` records exactly that).

- `MMCA.ADC.CrossService.IntegrationTests` (13 types) boots the three REST hosts in one process
  against real SQL Server and RabbitMQ containers and drives the genuine outbox to broker to
  consumer round-trip (the `UserRegistered` speaker auto-link, the `SpeakerLinked`/`Unlinked`
  back-link) plus the real Conference to Engagement gRPC read.
- `MMCA.ADC.ServiceBusEmulator.IntegrationTests` (3 types) smokes the Service Bus transport against the
  official Azure Service Bus emulator for broker parity.

Neither is in `deploy.needs`, because the gating jobs have no Docker daemon. Both instead run on a
weekday-nightly schedule (`cross-service-tests.yml:28-32`, jobs `cross-service` at
line 83 and `servicebus-emulator-smoke` at line 148) and their **recency** gates the deploy through
`cross-service-freshness` (`MMCA.ADC/.github/workflows/deploy.yml:1283`): the deploy fails if the last
successful nightly proving **both** tiers is stale, and it counts a run only when both required
broker jobs actually succeeded rather than skipped (`deploy.yml:1298-1301`, through the shared `freshness-gate` action). The emulator smoke has been **authoritative** rather than advisory since
2026-08-31 (`cross-service-tests.yml:138-147`), and the same comment records the standing rule: if it
goes red, fix it or dispatch a green run, do not re-add `continue-on-error` to unblock a deploy. The
window was widened from 3 to 5 days when the nightly moved to weekdays plus skip-if-unchanged, so a
legitimate weekend or holiday gap does not red the gate. Both jobs also sit
behind a `should-run` guard (`cross-service-tests.yml:55`) that skips a night with no new commits.
That is the general pattern for a tier too expensive to run per-deploy: gate
on the freshness of the evidence rather than on the run itself. MMCA.Store mirrors the arrangement
with `MMCA.Store.CrossService.IntegrationTests` and `MMCA.Store.ServiceBusEmulator.IntegrationTests`
behind its own `cross-service-freshness` gate (`MMCA.Store/.github/workflows/deploy.yml:827`).

The full Aspire composition is booted where it is exercised end to end: `e2e.yml` starts the consumer
AppHost for every Playwright run (`MMCA.ADC/.github/workflows/e2e.yml:267`), and the framework's own
AppHost tier, the blocking `apphost-testing` job in MMCA.Common's `ci.yml`, covers the shared
`Aspire.Hosting.Testing` base (`MMCA.Common/.github/workflows/ci.yml:1437-1514`). The nightly
`cross-service-tests.yml` carries no AppHost job: its two test jobs are the two the freshness gate
requires (`MMCA.ADC/.github/workflows/cross-service-tests.yml:83`, `:148`).

### The AppHost outage tier (`apphost-tests.yml`)

`MMCA.ADC/.github/workflows/apphost-tests.yml` is the consumer-side counterpart of the framework's
`apphost-testing` job. Its single job, `apphost-outage`, runs on `ubuntu-latest` with a 45-minute budget
(`apphost-tests.yml:44-47`) and executes `MMCA.ADC.AppHost.OutageTests` (`apphost-tests.yml:93-101`).
That project boots the **real** ADC AppHost through Aspire's testing builder (SQL Server, Redis,
RabbitMQ, MailDev, the four services, the gateway and the UI) on session-lifetime, throwaway
containers, stops Redis and then RabbitMQ, and asserts what Notification's `/health`, `/health/ready`
and `/alive` answer while each dependency is down and after it is back (`apphost-tests.yml:3-6`). The
assertions come from the shipped `DependencyOutageTestBase` in `MMCA.Common.Testing.Aspire`, the base
the framework's own sample outage scenario exercises in `apphost-testing` (`MMCA.Common/.github/workflows/ci.yml:1451-1459`).
There is deliberately no SQL Server scenario: a restarted SQL Server container comes back empty and the
services migrate only at start, so the assertion would test the container, not the stack
(`apphost-tests.yml:7-8`).

**When it runs.** On demand, weekly on Tuesdays at 07:00 UTC (placed off the Monday and Thursday E2E
nights), and on a pull request that touches the AppHost, the service hosts, the test project itself or
`Directory.Packages.props` (`apphost-tests.yml:15-25`), which is exactly the set of changes that can
alter how the composition degrades. A newer push to the same ref cancels the older run
(`apphost-tests.yml:31-33`), and the token is read-only (`apphost-tests.yml:27-29`).

**The steps, and why each exists.**

- **Free runner disk** (`apphost-tests.yml:51-57`): the stack's images plus the build fill the hosted
  runner's root volume, which kills the runner before any log uploads, so toolchains the job never uses
  are dropped first (the same reason `e2e.yml` gives).
- **Two runtimes** (`apphost-tests.yml:36-39`, `apphost-tests.yml:59-62`): `global.json` pins the .NET
  11 SDK and the 10.0 runtime is installed beside it, as in `e2e.yml`.
- **Trusted dev certificate** (`apphost-tests.yml:64-65`): the precondition gate skips every test when no trusted development certificate is present (`apphost-tests.yml:12-13`).
- **Aspire CLI 17.0.0, hash-pinned** (`apphost-tests.yml:67-91`): an Aspire 17 C# AppHost cannot build
  without the matching CLI on `PATH` (ASPIRE013), and the test project references the AppHost. No remote
  script is piped into a shell: the step downloads the versioned archive and refuses it unless its
  SHA-512 equals the pinned value (`apphost-tests.yml:84-86`), and the version moves in lockstep with the
  Aspire packages and with `e2e.yml` and the `deploy.yml` integration job (`apphost-tests.yml:70-72`).
- **Run the tier** (`apphost-tests.yml:93-101`): a plain (not locked) restore matching the AppHost's in
  `e2e.yml`, the opt-in `MMCA_APPHOST_TESTS: '1'` that `AppHostEnvironmentGate` reads, and
  `--minimum-expected-tests 1`.

**Why it gates nothing.** The workflow is not a required check, not in `deploy.needs` and not a
freshness input, so a red run fails this workflow only (`apphost-tests.yml:10-11`). The project sits
outside `MMCA.ADC.slnx` and both solution filters, so the unit loop never builds it
(`apphost-tests.yml:11-12`, `MMCA.ADC/MMCA.ADC.slnx:107-110`). A missing precondition (opt-in unset,
no Docker, no trusted certificate) makes every test skip with the gate's reason, and the floor of `1`
keeps a run that discovered nothing red rather than a green no-op (`apphost-tests.yml:12-13`).

The three AppHost-booting layers divide the work this way: `e2e.yml` boots the AppHost to drive the
healthy path through a browser, MMCA.Common's `apphost-testing` proves the shared fixtures and the
outage base against a sample AppHost on every framework change, and `apphost-tests.yml` proves the same
outage base against ADC's real composition weekly and on every composition-touching PR.
[Rubric §29, Resilience & Business Continuity]: §29 assesses whether the system's behaviour under
dependency failure is designed and verified rather than assumed; this tier turns "what do the health
probes say while Redis or the broker is down, and do they recover" into an executed assertion against
the production composition.
[Rubric §32, Dependency & Supply-Chain]: §32 assesses how third-party artifacts enter the build; the
Aspire CLI is fetched by exact version and refused on a SHA-512 mismatch rather than installed by a piped
script.

### MMCA.Common unit-level infrastructure tests

`MMCA.Common.Infrastructure.Tests` (760 types) uses SQLite-backed `EnsureCreated` contexts for
tests that need a real EF pipeline, with `MMCA.Common.Infrastructure.Tests.MigrationsFixture` beside
it as the real migrations assembly those tests point EF at. SQLite avoids the SQL Server dependency
entirely, which is why `MMCA.Common` builds and tests without any SQL Server or Docker in the local
environment. The tradeoff is that SQLite does not support all SQL Server features (row-level locking,
certain index hints), but EF Core's cross-provider abstraction is sufficient for the behaviors being
tested (outbox persistence, repository queries, soft-delete filters). Where the storage FORMAT itself
is the thing under test, SQLite is not enough: `MMCA.Common.Infrastructure.Redis.Tests` exists
precisely because a counter written as a string and read back as a hash round-trips fine against a
mocked `IDistributedCache` and answers WRONGTYPE against a real server, so that one project runs Redis
via Testcontainers, out of the slnx, in its own CI job (`MMCA.Common/.github/workflows/ci.yml:1017-1027,1057`).
The same argument now has a second instance: `postgresql-integration` (`ci.yml:1080`) runs the shipped
`PostgreSQLDbContext` against a real PostgreSQL container because the SQL the framework **emits** is
what matters there, and a model assertion cannot express it (a partial-index predicate written the SQL
Server way, a soft-delete predicate comparing a boolean to `0`, or a non-UTC `DateTime` Kind all build
a valid EF model and are rejected by the server, `ci.yml:1085-1088`). A third, `sqlserver-integration`
(`ci.yml:1192`), runs the shipped `SQLServerDbContext` and `DbContextFactory` against a real SQL Server
because there the **session** state and server-generated values matter, and neither a mock nor SQLite
can express them: `SET IDENTITY_INSERT` holds only on the session that ran it, a rowversion is issued
by the server on every write, and the outbox row must reach the database in the same `SaveChanges` as
its aggregate (`ci.yml:1199-1203`). It is not a required check yet; promoting it is a branch-protection
setting (`ci.yml:1204-1205`). Two more apply the same argument to the cloud adapter packages.
`aws-integration` (`ci.yml:1251`) runs `MMCA.Common.Aws` against LocalStack, because only a real
endpoint settles whether the S3 API accepts the requests the adapter builds (checksum posture,
path-style addressing) and whether the ambient `MMCA-*` headers survive SNS plus SQS, packed into one message attribute
under the 10-attribute cap (`ci.yml:1257-1262`). `gcp-integration` (`ci.yml:1311`) runs
`MMCA.Common.Gcp` against fake-gcs-server and the Firestore emulator, because only a real endpoint
settles whether a stale `IfGenerationMatch` key-ring write is rejected with 412 and whether the FCM
installation-ownership transaction lets exactly one of two racing claims win (`ci.yml:1318-1329`). Each
runs its project by path with a floor (`18` at `ci.yml:1299`, `14` at `ci.yml:1365`), and neither is a
required check (`ci.yml:1263-1264`, `ci.yml:1330`). Two broker tiers follow the same argument. `rabbitmq-integration` (`ci.yml:1140`) runs
the shared broker conformance scenarios against a real RabbitMQ, because only a broker settles that a
fanout exchange fans out, that a delay queue's message TTL dead-letters the copy back for redelivery
and that competing consumers each get a message once (`ci.yml:1145-1150`). `azure-integration`
(`ci.yml:1377`) runs the native Service Bus transport of `MMCA.Common.Azure` against the official
emulator through `ServiceBusEmulatorFixtureBase`, the base ADC and Store derive their broker-parity tiers
from, because only a real broker settles whether the management plane accepts the topology and whether a
dead-lettered message lands in the native dead-letter queue (`ci.yml:1384-1391`); its 25-minute budget
covers two cold image pulls (`ci.yml:1381-1383`), and it is not a required check (`ci.yml:1390-1391`). An eighth, `apphost-testing` (`ci.yml:1437`), boots a sample AppHost through `Aspire.Hosting.Testing` to execute the one layer
nothing else runs, the AppHost wiring itself: the solution build never runs an AppHost and every
in-process tier boots hosts directly through `WebApplicationFactory`, so a renamed resource, an
unresolvable reference or a `WaitFor` cycle is invisible everywhere else (`ci.yml:1445-1448`). It is
**blocking** (a red fails the run) but not a required merge check, since it is the only tier that
starts a real orchestrator and the slowest thing in the repo per assertion (`ci.yml:1442-1443`). The
sample AppHost's default scenario declares two resources over one sample project, one with a SQLite
file and one on the Http2-only h2c profile, and needs no container runtime; its outage scenario
(`SampleOutageTests` over `DependencyOutageTestBase`) runs a SQL Server and a RabbitMQ container and
stops and starts them, so the job needs Docker, and the pulls plus the stop-start cycles are why its
budget is 40 minutes (`ci.yml:1441`). Neither scenario needs a development certificate
(`ci.yml:1451-1459`). It gates on `MMCA_APPHOST_TESTS` with a `--minimum-expected-tests` floor so a
silently skipped tier is visible rather than a green no-op (`ci.yml:1505-1514`).

### E2E tests

`MMCA.ADC.E2E.Tests` (126 types) and `MMCA.Common.UI.E2E.Tests` (42 types) require either the
full Aspire stack (`dotnet run --project Source/Hosting/MMCA.ADC.AppHost`) or the Gallery
backend (`MMCA.Common.UI.Gallery`) respectively. The Aspire AppHost starts SQL Server, Redis,
RabbitMQ, MailDev, all four service hosts, the Gateway, and the UI; it cannot be launched
headlessly in a local background shell (it stalls at control-plane init), which is why the browser
tier is a CI concern and an interactive-terminal concern, never a background one. In CI, where Docker
is available, `e2e.yml` brings the stack up with `dotnet run` on the AppHost and the hang does not
occur (`MMCA.ADC/.github/workflows/e2e.yml:4-5`).

That workflow is also where the cold-start hardening lives, and it is worth reading because cold start
is the dominant cause of red E2E runs (`e2e.yml:14-22`). Two steps do the work: a **per-service**
readiness gate that waits until the UI, Identity (the login path) and Conference (the data path) each
return 200 through the Gateway, not just the UI aggregate, so the suite never starts against a
half-warm backend; and a warm-up step that JITs every service's hot path before the timed suite,
including a **real admin login POST** that exercises the Identity DB user lookup, the password hash
and RS256 signing, which a UI-only warm-up never touched. `E2E_TIMEOUT` stays at 45 seconds for the
residual first-navigation latency (line 22). The note beneath them (lines 23-25) is the kind of thing
worth keeping: a red run here is residual cold-start timeouts, not an a11y or product regression, so
do not "fix" it by disabling prerender.

When a run does go red, the evidence is in the processes' own logs, not the AppHost's. The
`Collect service logs` step runs on `always()` and sweeps the working tree, `$HOME` and `/tmp` for
every `MMCAADC*.txt` rolling Serilog file, then flattens them into `artifacts/service-logs/`
(`e2e.yml:392-411`). The glob covers the four services and the UI host (`MMCAADCUIWeb<date>.txt`),
and the UI host is in the sweep because it runs the Blazor Server circuit (lines 341-342). The search
is that broad because the directory each process writes to depends on the working directory Aspire
launches it from, and it is needed at all because the AppHost orchestrator log carries only DCP and
dashboard chatter, never the services' own output (lines 343-346). The bundle is uploaded only on
`failure()` with a 3-day retention (the upload step at line 360): a green run needs no offline triage, and each
browser's diagnostics bundle runs to roughly 350 MB.

The cross-browser matrix runs the same suite once per engine by varying `E2E_BROWSER`:
`chromium`, `firefox`, `webkit`. Mobile is covered by responsive layout testing (grid to card at a
narrow viewport), not a separate app. [Rubric §22, Responsive & Cross-Browser/Device]: §22
assesses whether the browser support matrix is exercised; the `E2E_BROWSER` env var is the
mechanism.

**Where the engines actually run differs by repo, and the reason is cost.** The Gallery is
backend-less, so MMCA.Common runs all three engines on every PR and all three are required merge
checks. A full Aspire-stack leg costs roughly twenty to twenty-five minutes, so ADC and Store run
**chromium only** on the deploy path (`e2e.yml:8-11`, the reusable-workflow input at `e2e.yml:31-36`)
and lean on the Common matrix for engine coverage. Their firefox and webkit legs stay on a **Mon/Thu**
schedule (`e2e.yml:49-50`), and since 2026-07-29 the two crons are separate entries rather than one
`1,4` expression specifically so the matrix can branch on `github.event.schedule`: **Monday runs
firefox, Thursday runs webkit**, halving the nightly spend from about 100 to about 50 minutes a week
while still exercising each engine every week (lines 44-48). A manual dispatch still gets all three.
Section 7 has the gate wiring.

[Rubric §21, Accessibility]: the `AssertNoAccessibilityViolationsAsync` call in the shipped workflow
bases, in each app's own `AccessibilityTests`, and in `MMCA.Common.UI.E2E.Tests` is the runtime
axe-core gate for WCAG 2.1 AA. Coverage beyond the shared bases is hand-maintained: nothing forces a
new page into `AccessibilityTests`, and today that suite holds 31 scans in ADC
(`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/AccessibilityTests.cs:17`) and 23 in Store
(`MMCA.Store/Tests/E2E/MMCA.Store.E2E.Tests/Workflows/AccessibilityTests.cs`), against
far larger page inventories.

---

## 6. Worked examples

Three examples tie the infrastructure above to real test code.

### Example A, Architecture fitness function (`DependencyVersionTests`)

The fact and its reason live once in the shared base; the per-repo class subclasses it and adds the
adversarial facts that prove the rule bites:

```csharp
// MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/DependencyVersionTestsBase.cs:10-19
public abstract class DependencyVersionTestsBase
{
    [Fact]
    public void MassTransit_MustNotBeReferenced() =>
        ArchitectureRules.NoPackageVersionWithPrefix(   // parses Directory.Packages.props
            "MassTransit",
            reason: "MassTransit is banned (ADR-118, Amendment 2026-11-23): the broker transports are "
                + "framework code over the vendor SDKs behind IMessageBus, and v9 of the library needs a "
                + "commercial license. Remove every MassTransit* PackageVersion.");
}

// MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/DependencyVersionTests.cs:11-30
public sealed class DependencyVersionTests : DependencyVersionTestsBase
{
    [Theory]
    [InlineData("MassTransit")]
    [InlineData("MassTransit.RabbitMQ")]
    [InlineData("masstransit.azure.servicebus.core")]
    public void NoPackageVersionWithPrefix_WhenABannedPackageIsPinned_Fails(string packageId)
    {
        var propsPath = WriteProps(("RabbitMQ.Client", "7.2.2"), (packageId, "8.5.12"));
        // ... the rule must throw, naming the offending id
    }
    // ...
}
```

**Why this test exists and what it protects.** The framework runs its own broker transports over
the vendor SDKs
([ADR-118](https://ivanball.github.io/docs/adr/118-message-transport-library-policy.html), amended
2026-11-23), so MassTransit has no remaining role, and its v9 needs a commercial license. A
reintroduced `MassTransit*` pin would compile and pass every test, because CI never starts a broker
(base doc, `Bases/Governance/DependencyVersionTestsBase.cs:4-7`). `DependencyVersionTests` makes it a
build-time failure: the shared rule parses `Directory.Packages.props` directly, not the compiled
assembly, and matches the prefix case-insensitively as NuGet ids are
(`Rules/Governance/ArchitectureRules.Governance.cs:76-87`), so the failure happens in the
`build-and-test` job before any project even references the package. The lower-cased
`masstransit.azure.servicebus.core` row in the `[Theory]` exists to pin that case-insensitivity.

This is the pattern of a fitness function: an executable rule that enforces a policy that cannot be
expressed as a type error. The subclass's throwaway-props facts are part of the design: a ban that
only ever runs against a clean file could pass vacuously forever, so the Common suite proves it
fails on a pinned id and passes on a clean one (`DependencyVersionTests.cs:13-46`).
[Rubric §32, Dependency & Supply-Chain]: this is the highest-signal embodiment
of §32 in the codebase, a deliberate, documented dependency policy with an automated gate.

### Example B, Integration test base usage (`IdentityIntegrationTestBase`)

```csharp
// MMCA.ADC/Tests/Integration/MMCA.ADC.Identity.IntegrationTests/Infrastructure/IdentityIntegrationTestBase.cs:12-19
[Collection(IdentityIntegrationTestCollection.Name)]
public abstract class IdentityIntegrationTestBase(IdentityIntegrationTestFixture fixture)
    : IntegrationTestBase<IdentityIntegrationTestFixture>(fixture)
{
    private const string Audience = "AtlDevConapi";

    protected void AuthenticateAsOrganizer(UserIdentifierType userId = 1)
        => SetBearerToken(JwtTokenGenerator.GenerateToken(Audience, userId, "Organizer"));
    // ...
}
```

A concrete test (`AttendeeAuthTests`, `AttendeeProfileTests`, etc.) inherits
`IdentityIntegrationTestBase`. The lifecycle is:

1. `IdentityIntegrationTestFixture` starts once per collection (xUnit class fixture), migrates
   the database, and creates the `Respawner`.
2. `IntegrationTestBase.InitializeAsync()` calls `Fixture.ResetDatabaseAsync()` before each test.
3. The test calls `AuthenticateAsAttendee(userId)` (line 22) which calls `SetBearerToken(...)`,
   subsequent `Client.GetAsync(...)` / `PostAsync(...)` calls carry the `Bearer` header.
4. `IntegrationTestBase.DisposeAsync()` disposes `Client`.
5. After all tests run, `IdentityIntegrationTestFixture.DisposeAsync()` drops the throwaway
   database.

The test author writes only the business assertion. All boilerplate (token minting, HTTP client,
DB reset, teardown) is in the shared infrastructure. This is exactly why the shared package exists.
[Rubric §14, Testability]: the fixture isolation + shared infrastructure is a direct measure
of the §14 "integration test isolation" criterion.

### Example C, bUnit component test (`ProfileTests`)

```csharp
// MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.UI.Tests/Pages/Users/Profile/ProfileTests.cs:18-58
public sealed class ProfileTests : BunitTestBase
{
    public ProfileTests()
    {
        // Only the avatar read runs during initialization; the rest is exercised on button clicks.
        // Every Result-returning member needs an explicit setup: an unstubbed Task<Result> hands
        // back null, not a success.
        var users = new Mock<IUserUIService>();
        users
            .Setup(x => x.GetMyAvatarUrlAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(string.Empty));

        Services.AddSingleton(users.Object);
        Services.AddSingleton(Mock.Of<IAuthUIService>());
    }

    [Fact]
    public void AvatarCard_FallbackAvatarCarriesAccessibleName()
    {
        // MudAvatar renders role="img"; axe role-img-alt (the deploy-gating Profile WCAG
        // scan) requires an accessible name even in the no-photo fallback state.
        var cut = RenderAs<ProfilePage>(UserWithId, _ => { });

        cut.WaitForAssertion(() =>
            cut.Find(".mud-avatar").GetAttribute("aria-label").Should().Be("Your profile photo"));
    }

    [Fact]
    public void WhenUserIdClaimMissing_RendersErrorState()
    {
        var cut = RenderAs<ProfilePage>(UserWithoutId, _ => { });

        cut.WaitForAssertion(() => cut.Markup.Should().Contain("Unable to load profile."));
    }
}
```

**Almost none of the harness is in this repo.** The repo-local `BunitTestBase`
(`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.UI.Tests/BunitTestBase.cs:16`) is three lines: it
inherits `BunitComponentTestBase` from the shipped `MMCA.Common.Testing.UI` package and adds exactly
one thing, `Services.AddDeviceCapabilityDefaults()` (line 18), the framework's device-capability
defaults covering the media picker the profile pages inject (the ADR-042/045 capability abstraction).
Individual tests override it with recording mocks, last registration wins.

Everything the test actually uses comes from the shared base
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:37`):
MudBlazor services, the UI facades, `JSInterop.Mode = JSRuntimeMode.Loose` (so MudBlazor's JS calls
do not throw), `AddAuthorizationCore`, localization, and the **mutable**
`AuthenticationStateProvider` (the `MutableAuthenticationStateProvider` inner class, line 162) that
`ProfilePage` injects directly. `RenderAs<TComponent>(principal, parameters)` (line 130) sets the
provider's principal, then renders the component with a cascading `AuthenticationState` wrapping the
same principal; `RenderUnderTest<TComponent>` (line 124) is the anonymous shortcut. The provider is
mutable rather than a hardcoded-anonymous one precisely so it serves both consumers: components that
read the cascading `AuthenticationState` and pages that call `GetAuthenticationStateAsync()` on the
injected service.

The test constructs `UserWithId` (a principal carrying the `AuthClaimTypes.Subject` claim, line 20)
and `UserWithoutId` (a principal without it, line 23), then asserts two render states. The first
fact (line 41) asserts the fallback avatar carries an accessible name, with a comment naming why
(lines 43-44): MudAvatar renders `role="img"`, and the deploy-gating Profile WCAG scan's
`role-img-alt` rule requires a name even in the no-photo state. The second (line 52) asserts the
error state when the claim is missing. The constructor's comment (line 28) explains the narrow
stubbing: only the avatar read runs during initialization, and the rest of the page's service calls
fire on button clicks, so no render-time test needs them. The first fact is the two tiers meeting: a
browser-tier a11y failure was cheaper to pin at the component tier. `cut.WaitForAssertion` is bUnit's
polling assertion, retrying until the assertion passes or a timeout elapses, handling Blazor's async
rendering cycle.

[Rubric §28, Front-End Testing & Quality]: bUnit tests the component's render logic in isolation
without a browser, giving fast feedback on UI states that are awkward to exercise in Playwright.
The combination of bUnit (fast, component-level) plus Playwright (slow, browser-level) is the two-tier
UI test strategy: bUnit for render-state logic, Playwright for user flows and accessibility.

---

## 7. The tiers and the gates that run them

A test tier only means something once you know what it blocks. This is the map.

| Tier | Prerequisite | Where it runs | What it blocks |
|---|---|---|---|
| Unit + architecture + bUnit | none | Common `build-and-test`; ADC/Store `build-and-test` over `CI.slnf` | Merge, on every code PR |
| AI golden replay + prompt contract | none, no API key, no network | ADC `build-and-test` over `CI.slnf` (the tests carry no trait, `MMCA.ADC/.github/workflows/deploy.yml:661`) | Merge, on every ADC code PR |
| AI live judge (paid model calls) | `ANTHROPIC_API_KEY` | ADC `ai-eval-gate`, only when the diff touches the scoring code | The deploy, on a scoring-code deploy |
| Unit + architecture, seed | none, no database | Helpdesk `build-and-test` over `MMCA.Helpdesk.slnx`, against MMCA.Common **source** | Merge, on Helpdesk PRs |
| Runtime conformance, host-free order gates | none | Same job as the unit tier, all four repos | Merge |
| Runtime conformance, Gateway trio | none (Production-pinned boot) | Same job as the unit tier | Merge |
| Topology parity (AppHost vs. Bicep) | none, text parse | ADC `MMCA.ADC.Gateway.Tests`, so the unit tier | Merge, through the PR's `build-and-test`, which is the deploy's test gate |
| Runtime conformance, HTTP suites | real SQL Server | ADC/Store `integration-tests` over `Integration.slnf` | Merge (PR-only required check), **not** the deploy |
| Testcontainers cross-service / broker | Docker | Nightly `cross-service-tests.yml` | The deploy, indirectly, via `cross-service-freshness` |
| Real-engine persistence (PostgreSQL) | Docker | Common `postgresql-integration` | Nothing until it is added to branch protection; the job is written to be promotable |
| Real-engine persistence (SQL Server) | Docker | Common `sqlserver-integration` | Nothing until it is added to branch protection (`MMCA.Common/.github/workflows/ci.yml:1204-1205`) |
| Cloud adapters (AWS, Google Cloud) | Docker (LocalStack; fake-gcs-server plus the Firestore emulator) | Common `aws-integration`, `gcp-integration` | Nothing until added to branch protection (`MMCA.Common/.github/workflows/ci.yml:1263-1264`, `ci.yml:1330`) |
| AppHost orchestration | `MMCA_APPHOST_TESTS` (no container runtime, no dev certificate) | Common `apphost-testing`, blocking (`MMCA.Common/.github/workflows/ci.yml:1442-1443`) | The CI run goes red; not a required merge check |
| Browser (gallery) | Playwright, no backend | Common `ui-e2e`, three engines | Merge, all three engines |
| Browser (full stack) | full Aspire stack | ADC/Store `e2e-gate`, chromium only | The deploy, when the change is ui-scoped |
| Browser (full stack), firefox and webkit | full Aspire stack | ADC `e2e.yml` on alternating weekly crons, one engine each | The deploy, indirectly, via `cross-browser-freshness` |
| Benchmarks | none | Common `performance-smoke` | Merge |
| Load at volume (outbox drain, paged queries) | none, temp-file SQLite | Common `load-tests.yml`, weekly cron plus manual dispatch | Nothing, deliberately: a trend signal, not a merge gate |
| Cross-repo consumer canary | ephemeral SQL Server | Common `consumer-source-build`, building Helpdesk against this PR's framework source | Merge, on MMCA.Common PRs |
| Template generation smoke | none | Helpdesk `template-smoke`, package mode from nuget.org | Merge, on Helpdesk PRs |

### The accessibility gate (ADR-063)

MMCA.Common's `ui-e2e` job (`MMCA.Common/.github/workflows/ci.yml:339`) builds the out-of-slnx
gallery plus E2E project (`ci.yml:377-381`) and runs the axe scans across a `chromium, firefox, webkit`
matrix (`ci.yml:347-348`), one engine per leg via `E2E_BROWSER` (`ci.yml:495`), with
`fail-fast: false` (`ci.yml:346`) so each engine reports independently. **All three are required merge
checks**, three of the eight enumerated in `MMCA.Common/CONTRIBUTING.md:60-71` (firefox was promoted
2026-07-12 and webkit 2026-07-16 after 11 consecutive green main runs, `ci.yml:349-351` and
`CONTRIBUTING.md:63-65`). No leg collects coverage: the `coverage` job reads only the unit tier
(`ci.yml:564-565`). `CONTRIBUTING.md` also names the live ruleset as authoritative over its own copy
(`CONTRIBUTING.md:75-77`), which is the right instinct for any list of gates.

Because all three legs are required, a leg that cannot install its browser blocks every merge, so the
install is hardened rather than left to the runner's defaults. The job's budget is 34 minutes
(`ci.yml:343`). The browser cache is keyed on the `Microsoft.Playwright` version read out of
`Directory.Packages.props` (`ci.yml:385-395`, key at `ci.yml:406`), since the browser builds are a
function of that version alone and a hash of the whole props file changed on every unrelated bump. The
engine's OS packages (for webkit, about 130 `.deb` files) are cached too, keyed on that version plus
the runner image, so a warm run installs offline (`ci.yml:408-419`). The install step carries its own
26-minute bound (`ci.yml:425-427`), reorders the runner's apt mirror list to put the fastest responder
first, because apt moves to the next mirror only on an error and never on a slow transfer
(`ci.yml:438-443`), and retries each half of the install three times under `timeout`, with the OS half
run as root so a timed-out `apt-get` dies with its process group instead of holding the dpkg lock
against the retry (`ci.yml:421-424`). [Rubric §29, Resilience & Business Continuity]: §29 assesses
whether a system degrades and recovers predictably; here the same thinking is applied to the delivery
pipeline, so a slow package mirror costs minutes on one leg instead of a red required check.

The deployed apps gate the deploy instead: ADC's `e2e-gate` (`MMCA.ADC/.github/workflows/deploy.yml:1202`)
calls the reusable `e2e.yml` (line 819) with `browsers: '["chromium"]'` (line 821), and the `deploy`
job waits on it (`deploy.yml:1573,1197`). Store's is the same shape at
`MMCA.Store/.github/workflows/deploy.yml:751,1083`.

**The deploy gate is ui-scoped and may legitimately skip.** Both apps gate `e2e-gate` on a `ui` change
filter (`MMCA.ADC/.github/workflows/deploy.yml:1213`), and the `deploy` job's condition accepts
`success` **or** `skipped` for that need while requiring `success` from every unconditional one
(`deploy.yml:1600-1611`). That asymmetry is deliberate and was learned the hard way: under default
`success()` semantics a legitimately skipped `e2e-gate` cascaded into a skipped deploy, so a
green run shipped nothing (`deploy.yml:1592-1594`).

On both apps the cost of that fix is bounded by branch protection rather than by a second deploy gate.
Admins are enforced and an up-to-date branch is required, so the PR's `build-and-test` ran the unit,
architecture and bUnit tiers against the exact tree that merges, and a skipped `e2e-gate` does not mean
an untested deploy (`deploy.yml:1194-1198`, `deploy.yml:1574-1576`). What a backend-only deploy still
ships without is a **browser scan**: axe did not run on that commit, and the post-deploy smoke gate is
the backstop for anything the unit tier cannot see.

MMCA.Helpdesk adopts none of the browser tier: it pins the package version but no project references
it, and the repo has no E2E test project at all, so the seed shows a reader no worked example of
adopting the scan.

### The cross-engine freshness gate (rubric §22)

Moving firefox and webkit off the deploy gate bought about 40 minutes per UI deploy, and it opened a
hole of the same shape the broker tier once had: the nightly `e2e.yml` matrix is `fail-fast: false`
with `continue-on-error` on the non-chromium legs, so those legs could stay red for weeks without
blocking a single deploy. The proof was produced and then discarded
(`MMCA.ADC/.github/workflows/deploy.yml:1306-1310`). `cross-browser-freshness` (`deploy.yml:1322`)
closes it the way `cross-service-freshness` (`deploy.yml:1283`) closes the broker one: it does not run
the engines, it refuses to deploy unless a recent run passed on **each** of them.

- **Push-only** (the `freshness` job condition, `deploy.yml:1232`), like every other freshness gate: a PR is not a rollout.
- **A 10-day window** (`deploy.yml:1335`). The two engines alternate on separate weekly crons
  (Monday firefox, Thursday webkit), so the window is a 7-day cadence plus slack for a skipped
  night (the nightly's should-run guard skips a night with no new commits) and for a manual re-run
  landing late.
- **The check is per job, not per run.** It walks completed `e2e.yml` runs newest first and takes
  the first one in which the job named `E2E (<engine>)` itself concluded `success`, regardless of
  the run's conclusion. The run conclusion is unusable in both directions: `continue-on-error` means
  an engine's red need not red the run, another job's red can red a run in which this engine passed,
  and the should-run guard can conclude a run `success` with every leg skipped. Each engine is
  resolved independently, because their proofs normally come from two different runs, and the older
  of the two decides the gate (the step at `deploy.yml:1322-1343` hands this to MMCA.Common's shared `freshness-gate`
  composite action, `deploy.yml:1330`, in its `per-job` mode,
  `MMCA.Common/.github/actions/freshness-gate/action.yml:44-46`, which fails when either engine is
  missing or stale).
- **Break-glass is loud, not silent.** A `workflow_dispatch` skip requires a justification; without
  one the step fails rather than waving the deploy through, and with one it writes a warning and a
  step-summary entry (`MMCA.Common/.github/actions/freshness-gate/action.yml:93-106`). That logic lives
  in the shared action rather than in this file, so ADC and Store run one copy of it (`action.yml:7-8`). The skip path exits `success`
  inside the step, which is why `deploy`'s condition can demand `success` from this need
  unconditionally (`deploy.yml:1607`).

[Rubric §22, Responsive & Cross-Browser]: §22 assesses whether the app is verified on more than one
rendering engine; this gate is what makes the nightly cross-engine matrix *enforced* coverage rather
than a report nobody reads, without putting two more browser legs on the per-deploy critical path.

### The AI scoring evaluation gate (TD-22)

The AI session scorer is the one place in this repo where behavior can change with **no code
change**: a prompt edit, a model deprecation or a provider-side contract change all move the numbers
an organizer uses to accept or decline talks, and every unit test in `CI.slnf` stays green through
all three (`MMCA.ADC/.github/workflows/deploy.yml:651-654`). `ai-eval-gate` (`deploy.yml:671`) is the
behavioral check, and it is split into two tiers by cost.

**Tier 1, golden replay plus prompt contract, on every PR.** Its tests carry no trait, so
`build-and-test` runs them in its `CI.slnf` pass against the exact tree that merges
(`deploy.yml:661-662`); inside `ai-eval-gate` the replay step re-runs the evaluation project with
`--filter-not-trait "Category=AiEval.Live"` and a `--minimum-expected-tests 1` floor
(`deploy.yml:696-703`). No API key and no network: seven recorded proposals in
`Tests/Modules/Conference/MMCA.ADC.Conference.Scoring.Evaluation.Tests/Golden/` are replayed through
the **real** `SessionScoringService`. The harness is the framework's: `GoldenReplayTests`
(`GoldenReplayTests.cs:35`) derives from `GoldenReplayTestsBase` and drives a `ReplayChatClient`,
and each case's recorded answer lives beside it as `Golden/<id>.response.json` in the `ChatResponse`
shape rather than in a provider's wire format, so a provider swap cannot invalidate the corpus
(`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Scoring.Evaluation.Tests/GoldenCase.cs:11-15`).
The replay client sits innermost under the **governed** chain the Conference host composes
(`AddMmcaChatClient` at `GoldenReplayTests.cs:197`), and each case first asserts that the
`GuardrailChatClient` really is in front of it (`GoldenReplayTests.cs:60`): a composition that
quietly dropped the guardrail layer would otherwise satisfy every band assertion, which is the blind
spot the tier had while it drove the scorer bare. Each case then pins both directions at once. What
goes **out**: exactly one model call, carrying the delimited envelope and the untrusted-input brief
(`GoldenReplayTests.cs:69-71`), asserted on the request itself because the service never throws for a
scoring failure and an unmet expectation would otherwise surface only as "Success was false"
(`GoldenReplayTests.cs:67-68`). What comes **back**: the recorded response still parses, still
succeeds, lands inside the band the case declares, and reproduces the weighted overall re-derived
from the same recorded sub-scores. The `contact-details-in-bio` case is the standing proof that
request-side redaction reached the provider: the email address and phone numbers are gone from what
the model received while the speaker's public name survives (`GoldenReplayTests.cs:143`). The base
gives each case a fresh replay client and collects failures rather than stopping at the first, so a
prompt edit reports every case it broke (`GoldenReplayTests.cs:22-24`). A separate fact guards the
corpus itself: at least six unique cases, `injection-attempt` and `no-speakers` both present, and a
recorded response beside every case, because a corpus that quietly shrank to one happy path would
keep the theory green while measuring nothing (`GoldenReplayTests.cs:104-107`).

`PromptContractTests` (`PromptContractTests.cs:29`) is the versioning half. It renders the prompt for
one canonical proposal fixed in the test file rather than read from the corpus (so editing a golden
case cannot change what the hash covers), hashes it, and requires the hash recorded for the current
`PromptVersion` in `Golden/prompt-versions.json` to match (`PromptContractTests.cs:48`). Both failure
modes are real and both fail loudly: a prompt edit without a version bump breaks the hash, and a
version bump without a recorded hash breaks the key lookup, each with the fix spelled out in the
assertion message. Two smaller facts pin the version string as a dated `yyyy-MM-dd.N` contract that
fits the `nvarchar(32)` column it is persisted into (`PromptContractTests.cs:69`) and pin both halves
of the assembled prompt: the reviewer brief, the anti-injection `UntrustedInputBrief` paragraph, the
`<session_proposal>` envelope, and the rule that an absent tagline is omitted rather than emitted
empty (`PromptContractTests.cs:81-84`). A further fact pins the `SessionScoringContract` the service
hands the framework (its name, version, model and system prompt) to those same values
(`PromptContractTests.cs:113-119`).

**Tier 2, the live judge, only when the scoring code changed.** `LiveJudgeTests`
(`LiveJudgeTests.cs:39`) carries `[Trait("Category", "AiEval.Live")]` (line 59) and makes real paid
calls to the configured provider for each golden proposal, asserting the overall lands in the case's
band. It composes the same governed `AddMmcaChatClient` chain as the host and names no vendor type
(`LiveJudgeTests.cs:26`, `LiveJudgeTests.cs:112`). The deploy
runs it only when `needs.changes.outputs.scoring == 'true'` (`deploy.yml:673`), and that filter
is deliberately **narrow**: unlike `code` and `ui` it does not fail safe to true on an unrecognized
path, because a false positive here spends money on every unrelated deploy while the key-free tier
already runs unconditionally (`deploy.yml:235-239`, the three matched paths at `deploy.yml:241-243`).
The whole-diff fail-safe still applies one level up: when the push range cannot be determined the
classifier sets `scoring=true` along with everything else (`deploy.yml:130-135`, `deploy.yml:144-150`).
Without `AI_API_KEY` (`LiveJudgeTests.cs:41`) each case calls `Assert.Skip`
(`LiveJudgeTests.cs:69`), reported as skipped and never as passed, which is why that step alone
carries no `--minimum-expected-tests` floor (`deploy.yml:706-708`). The variable name is
provider-neutral to match the `Ai:ApiKey` configuration key, while the repository secret that feeds
it keeps its `ANTHROPIC_API_KEY` name because it holds an Anthropic credential (`deploy.yml:715-717`).

Two choices are worth naming. The job itself runs only on a code deploy whose diff touches the
scoring code, because it exists for the paid judge: the key-free replay already ran on the PR, and
the job re-runs it first only as a cheap precondition for spending on the judge, so every other
deploy skips it and the `deploy` job accepts `skipped` (`deploy.yml:667-673`, `deploy.yml:1611`); and
the live bands are wide on purpose, because a judge model is not deterministic and a flaky gate gets
ignored (`deploy.yml:664-665`).
[Rubric §14, Testability & Test Strategy]: §14 assesses whether the suite meaningfully covers the
system's real behavior; a deterministic replay of recorded provider responses is how a
non-deterministic dependency becomes testable at all, and the corpus-shape fact is how the tier
avoids the vacuous-pass failure mode every golden suite has.
[Rubric §11, Security]: §11 assesses how the security model is validated; the injection-attempt case
and the `UntrustedInputBrief` assertion mean the prompt-injection defence is pinned by a test that
fails when the paragraph stops being emitted, not by a comment.

### The performance-regression gate (ADR-060)

Rubric §12 asks for hot-path efficiency that is measured, not assumed. The design problem is the
runner: CI runs on shared GitHub-hosted Ubuntu, where wall-clock timings move run to run by more than
most regressions worth catching, so an absolute latency assertion is either tight enough to red on a
noisy neighbour or loose enough never to fire
([ADR-060](https://ivanball.github.io/docs/adr/060-performance-regression-gate.html)). The answer
splits the baseline by measurement stability.

- **A dedicated job measures, then verifies.** `performance-smoke` (`MMCA.Common/.github/workflows/ci.yml:514`),
  named "Performance gate (BenchmarkDotNet Short + baseline verify)" (`ci.yml:515`), runs the
  suite with `--filter "*" --job Short --exporters json` (`ci.yml:550`) and then runs `build/perfgate`
  over the exported artifacts (`ci.yml:559`). `--job Short` is 3 warmup plus 3 iterations, chosen to
  produce real measurements inside a bounded budget; `--filter "*"` is required because
  BenchmarkDotNet otherwise prompts for a selection and would hang the runner (`ci.yml:546-549`).
- **The baseline is a committed JSON file**, `Tests/Performance/perf-baseline.json` (`ci.yml:559`),
  not a stored previous run. A gate comparing against the previous run ratchets silently: every PR is
  only slightly worse than the last, and the sum is invisible. A committed number is a line a reviewer
  questions in the same PR as the code that spends it.
- **Allocations are gated absolutely**, because bytes per operation do not depend on how busy the
  runner is.
- **Latency is gated only as a ratio between two benchmarks in the same run.** Both run in the same
  process, on the same machine, under the same noise, so the machine cancels out of the quotient. The
  committed floor asks "does the cache still exist", which survives a noisy measurement, rather than
  "is the cache exactly this fast", which does not. **No absolute latency threshold exists anywhere in
  the gate.**
- **A missing measurement fails, it does not pass.** Every benchmark named by a rule must be present
  in the results or the verifier reports that the gate would be vacuous and fails. Zero exported
  artifacts is a failure rather than an empty pass, and a benchmark reporting no allocation data fails
  with an instruction to keep `[MemoryDiagnoser]` on the suite. Vacuity is the failure mode a
  benchmark gate actually has: a renamed method or a filter selecting nothing would leave a gate that
  passes while measuring nothing, which is worse than no gate because it reads as evidence
  (the verifier invocation is `ci.yml:559`; the rules it enforces live in `MMCA.Common/build/perfgate`).

The job is a **required merge gate**, not advisory: it is the eighth of the eight contexts listed in
`MMCA.Common/CONTRIBUTING.md:68-71`, which also names raising a ceiling to silence a red gate as
defeating it. That last part is enforced by review, not by the tool.

**This gate is MMCA.Common only.** The harness, the baseline and the verifier exist in that repo and
nowhere else. ADC and Store have no benchmark suite and no perfgate; their performance artifact is a
periodic k6 load test against deployed read endpoints whose recency is gated by `load-freshness`
(`MMCA.ADC/.github/workflows/deploy.yml:1262`), not a pull-request gate. Helpdesk has neither.
Consumers inherit the framework's bounded hot paths through the released packages, not the gate over
their own code.

### The weekly load tier (`load-tests.yml`)

The benchmark gate answers "did a hot path regress", per pull request, without trusting wall-clock
time. It cannot answer "does the persistence stack hold up at realistic volume", which needs real
rows, a real background processor and real timings. MMCA.Common answers that second question in a
separate workflow, `MMCA.Common/.github/workflows/load-tests.yml`, over
`Tests/Performance/MMCA.Common.LoadTests` (14 types, `00-inventory.md:118`; the types are rolled up in
[`group-29-testing-infrastructure.md`](group-29-testing-infrastructure.md)).

- **Three scenarios, each a correctness assertion plus a timing bound** (`load-tests.yml:3-8`).
  `OutboxProcessor_Drains10000Messages_ExactlyOnce_AboveThroughputFloor` enqueues 10,000 messages
  and lets the **real** `OutboxProcessor`, resolved from `AddInfrastructure` as a hosted service,
  drain them, asserting exactly-once delivery and a floor of 500 messages per second
  (`MMCA.Common/Tests/Performance/MMCA.Common.LoadTests/OutboxThroughputLoadTests.cs:22,30,36,63`).
  `PagedQueryLoadTests` seeds 100,000 rows (`Support/PagedQueryFixture.cs:18`), bounds a first page,
  a deep page and a filtered, sorted page at 30, 45 and 65 ms, and runs 50 concurrent paged reads
  against a 750 ms p95 ceiling (`PagedQueryLoadTests.cs:23-25,27,31`). Each ceiling carries the local
  measurements it was set from in a trailing comment, at about 3x headroom (`load-tests.yml:7-8`), so
  a reviewer moving a number can see what it was measured against.
- **The database is a temp-file SQLite with connection pooling off.** `LoadStack` points the
  framework's real persistence and outbox wiring at a file database (`Support/LoadStack.cs:62,66`)
  and turns `Microsoft.Data.Sqlite` pooling off, with the flake rate that motivated it recorded in
  the comment above the setting (`LoadStack.cs:56`). No Docker is needed, so the tier runs on a stock
  runner.
- **Schedule plus manual dispatch, never a pull request.** The cron is Sunday 04:17 UTC, off-peak and
  off the top of the hour where scheduled runs queue up (`load-tests.yml:14-17`). The header states
  why it is neither in `ci.yml` nor a required check (`load-tests.yml:10-12`): the project sits
  outside `MMCA.Common.slnx`, so the solution-wide `dotnet test --solution` never discovers it, and a
  timing tier on shared runners is a trend signal, not a merge gate. It is ADR-060's refusal to gate
  on absolute latency applied from the other side: where absolute ceilings exist, they stay off the
  merge path.
- **The job keeps `ci.yml`'s posture.** Read-only `contents` permission (`load-tests.yml:19-21`), a
  non-cancelling concurrency group (`load-tests.yml:26-28`), a 20-minute timeout that bounds a hung
  processor or restore against a local run of about 15 seconds plus the build (`load-tests.yml:34-35`),
  a shallow checkout with `persist-credentials: false` (`load-tests.yml:37-39`), the same lock-file cache key as `ci.yml`
  (`load-tests.yml:48-52`), a `--locked-mode` restore (`load-tests.yml:54-55`) and a build by csproj
  path, like the other out-of-solution tiers (`load-tests.yml:57-59`). The run step executes the
  self-hosted test executable directly (`load-tests.yml:64`) with `MMCA_LOAD_RESULTS_DIR` pointing at
  the artifact folder (`load-tests.yml:63`, read by `Support/LoadResults.cs:16`).
- **A missing scenario fails.** Each scenario writes its JSON summary before asserting, and the
  "Verify every scenario reported" step requires exactly three of them (`load-tests.yml:66-72`), so a
  discovery or filter regression cannot pass as a no-op: the same anti-vacuity rule the perfgate and
  every `--minimum-expected-tests` floor enforce.
- **The results are kept as a trend.** The summaries upload on `always()`, so a failing run still
  leaves its numbers, with a 90-day retention (`load-tests.yml:74-81`) so runs can be compared over
  time.

[Rubric §12, Performance & Efficiency]: §12 assesses whether performance is measured at realistic
volume rather than assumed; this tier measures the outbox drain and paged reads at production-like
row counts on a schedule, and keeps the absolute numbers it produces out of the merge path, where
runner noise would turn them into a flaky gate.

### The two cross-repo gates, and MMCA.Helpdesk's own CI


Two gates run a *different repo's* code than the one being changed, and both exist because a green
build in one repo has repeatedly proved nothing about the other.

**MMCA.Common's consumer canary** (`consumer-source-build`,
`MMCA.Common/.github/workflows/ci.yml:682`, named "Consumer source build (Helpdesk)" at `ci.yml:683`)
checks MMCA.Helpdesk out as a sibling (`ci.yml:732`) and builds it against **this PR's** framework
source (`ci.yml:804`), so a breaking public-API change reds here rather than after a release plus a
lockstep sweep. Helpdesk is the right canary precisely because it is
minimal: no database and no GitHub Packages token, and its committed `local.props` already swaps the
`MMCA.Common.*` package references for project references into `../MMCA.Common/Source`. The job also
proves the framework's **migration** path end to end, starting an ephemeral SQL Server
(`ci.yml:768`), applying the consumer's real EF migrations to it (`ci.yml:871`) and then asserting the
migrations were recorded and the schema exists (`ci.yml:890`), and it runs the seed's suite with a
floor of `40` (`ci.yml:816`). The same-name-branch resolution step described below has its Common-side
twin here (`ci.yml:715`).

**MMCA.Helpdesk's own `ci.yml`** is the other half of that pair, and it is deliberately small. It runs
on pull requests and pushes to `main` (`MMCA.Helpdesk/.github/workflows/ci.yml:3-7`) with one
`build-and-test` job (line 14) that checks MMCA.Common out as a source companion (line 39) and runs
the whole seed solution with no database:
`dotnet test --solution MMCA.Helpdesk.slnx -c Release --no-build --minimum-expected-tests 1`
(line 60). The header comment states the boundary the seed keeps (lines 9-12): domain plus
architecture run headless here, and the Aspire round-trip is not run at all.

The step worth reading is **"Resolve MMCA.Common ref (same-name branch, else main)"** (line 28). Both
repos gate on the other's `main`, so a breaking framework change and its consumer adaptation would
deadlock each other: neither PR can go green alone. The convention resolves it without a bypass. Name
the adaptation branch here identically to the framework branch, and this step builds against that
branch instead of `main` (lines 24-27, resolution at lines 31-37). No match means `main`, so the
normal case costs nothing.

A second job, `template-smoke` (line 76), is not redundant with the first, and the comment above it
says why in two numbered points (lines 62-75). This repo **is** the source of the `MMCA.Templates`
`dotnet new` pack, so there is no second copy to drift; `build-and-test` builds in **local-source**
mode against MMCA.Common's `main`, while a generated app builds in **package** mode against a
released version from nuget.org, and a source-mode build can pass where a package-mode Release build
fails on an analyzer. The job therefore checks out no MMCA.Common at all (lines 86-87), which is
exactly the credential-free public install path being proven, and runs `build/templates/smoke.ps1`
(line 89). That script packs the template, installs it, generates three deliberately different apps
and restores, builds and tests each, then sweeps the generated tree for residual `Helpdesk` / `Ticket`
tokens, because `sourceName` and the symbol replacements run as separate passes and a token nested
inside another (`Ticket` inside `Tickets`) is where a rename silently half-applies
(`MMCA.Helpdesk/build/templates/smoke.ps1:13`, case rationale at lines 77-101).
[Rubric §33, Developer Experience & Inner Loop]: §33 assesses the friction of adopting and working in
the codebase; a template that generates an app which does not build is the highest-friction failure
this workspace can ship, and this is the gate that catches it.

### Coverage floors

Coverage is enforced as a floor, not reported as a number, and every floor is scoped so it measures
the code it claims to measure.

- **MMCA.Common:** the `coverage` job (`MMCA.Common/.github/workflows/ci.yml:564`) merges the tiers
  with ReportGenerator (`ci.yml:588`) and fails if the **unit tier drops below 68.3% line coverage**
  (`ci.yml:624`). It gates the
  unit tier rather than the merged report because the gallery E2E tier dilutes it, and it excludes
  generated code (`*.generated.cs` / `*.g.cs`) because source generators emit large uncovered files
  that otherwise tank the number: 45.3% raw versus 61.9% hand-written on the run that prompted the
  filter (`ci.yml:603-608`, assembly and file filters applied at `ci.yml:621`). It runs only when
  `build-and-test` succeeded, so an upstream failure does
  not add a confusing secondary coverage failure (`ci.yml:610-612`).
- **MMCA.ADC:** two floors run inside `build-and-test`, both PR-only. The global unit-tier floor sits
  at **55.5%** (`MMCA.ADC/.github/workflows/deploy.yml:467`), measured over **ADC's own code only**.
  The comment above it is the part worth reading: the raw cobertura also
  instruments the consumed framework assemblies (tested in their own repo, near 0% here), plus the
  service hosts and the protobuf-dominated contracts assemblies, and leaving them in deflated the
  number to something that measured nothing (26.8% raw, then 52.8% versus 62.5% filtered after the
  service-host assemblies appeared). The assembly filter is what makes the floor mean what it says,
  and it is one line: `+MMCA.ADC.*;-*.Tests;-MMCA.ADC.*.Service;-MMCA.ADC.*.Contracts`
  (`deploy.yml:465`). A second, tighter floor gates **Application-layer branch coverage at 77.5%**
  (`deploy.yml:503`) over `+MMCA.ADC.*.Application` only (`deploy.yml:494`), because the repo-wide
  average is dominated by UI, Infrastructure and generated code, and because the business decisions
  it wants to measure are branches rather than lines (`deploy.yml:473-479`); the floor sits about two
  points under the 79.7% branch coverage measured on the full unit tier, so ordinary churn does not
  trip it while a real regression does (`deploy.yml:481-484`). It carries its own
  anti-vacuity guard: if the filtered report covers fewer than four assemblies (Conference,
  Engagement, Identity, Notification) the step fails outright, on the grounds that a filter matching
  nothing would make the floor pass vacuously (`deploy.yml:495-499`).
- **MMCA.Store:** the equivalent unit-tier floor sits at **51.6%**
  (`MMCA.Store/.github/workflows/deploy.yml:255`).
- **MMCA.Helpdesk has no coverage floor at all**, and that is consistent with what it is. The seed's
  job is to be readable and adoptable, so its CI asserts that the suite builds and runs
  (`MMCA.Helpdesk/.github/workflows/ci.yml:60`) rather than holding a percentage a reader would have
  to maintain while learning the framework.

[Rubric §17, DevOps & Deployment]: the whole table above is §17's subject. A tier that runs and
blocks nothing is documentation; a tier that blocks something is a gate. The most instructive entry is
`cross-service`, which never runs on the deploy path and still blocks the deploy, through the age of its
last proof in the `freshness` job.

---

## Quick reference: rubric categories touched in this chapter

| Category | Where explained |
|---|---|
| §3 Clean Architecture (enforced) | §4 LayerDependencyTests, DomainPurityTests |
| §4 Domain-Driven Design | §4 AggregateConventionTests factory-method rules |
| §9 API Design & Contracts | §3 the ADR-058 ProblemDetails, OpenAPI and versioning bases |
| §11 Security (test RS256 keypair) | §3 JwtTokenGenerator design note; §3 SecurityHeadersTestsBase and MmcaGatewayHardeningTestsBase; §7 the prompt-contract test that pins the anti-injection brief |
| §12 Performance & Efficiency | §7 the ADR-060 benchmark baseline gate and the weekly load tier |
| §13 Observability & Operability | §4 ObservabilityConventionTests alert-to-runbook pairing, and AppHostBicepParityTests turning an unresolvable service name into a build failure |
| §14 Testability & Test Strategy | §1 CI filter rationale, §2 project layout, §5 integration strategy, §7 the AI scoring evaluation gate and the coverage floors |
| §17 DevOps & Deployment | §1 two-filter CI rationale and the complementary deploy gates, §4 the AppHost/Bicep topology parity gate, §7 the tier-to-gate map |
| §21 Accessibility (a11y) | §3 AxeOptions and AssertNoAccessibilityViolationsAsync, §5 E2E strategy, §7 the ADR-063 gate |
| §22 Responsive & Cross-Browser | §3 PlaywrightFixture engine selection, §5 the alternating-engine nightly |
| §28 Front-End Testing & Quality | §2 UI/E2E project layout, §3 Testing.E2E and Testing.UI packages, §6 bUnit example |
| §29 Resilience | §3 GracefulShutdownTestsBase |
| §30 Compliance, Privacy & Data Governance | §4 PiiConventionTests + PiiErasureContractFitnessTests, DataResidencyTests |
| §32 Dependency & Supply-Chain | §4 DependencyVersionTests, §6 Example A |
| §33 Developer Experience & Inner Loop | §1 MTP filter syntax, self-hosted test binaries; §7 the consumer canary, the same-name-branch convention that keeps it from deadlocking, and the template generation smoke |
| §34 Architecture Governance & Documentation | §4 overall fitness-function framing |

---

## Cross-links

- Primer: [`00-primer.md#5-the-solution--test-layout`](00-primer.md#5-the-solution--test-layout)
 , solution files, MTP runner, slnx-excluded UI projects
- Primer: [`00-primer.md#architecture-enforcement-is-doubled-fitness-functions`](00-primer.md#architecture-enforcement-is-doubled-fitness-functions)
 , compile-time + runtime double enforcement explained
- Devops/CI chapter: `devops-cicd.md`, CI job definitions, the `integration-tests` job that uses
  `MMCA.ADC.Integration.slnf`, the `ui-e2e` job that builds the Gallery + E2E tests by csproj path,
  and the deploy-side jobs (`foundation`, `build-images`, the smoke gate and rollback) that this
  chapter only names as the backstop behind the test tiers
- Type inventory: `00-inventory.md`, the per-assembly type counts this chapter's tables are drawn from
- ADRs:
  - [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html), outbox pattern the integration tests exercise
  - [ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html), PiiConventionTests rationale
  - [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), per-source DB reset in `IIntegrationTestFixture`
  - [ADR-007](https://ivanball.github.io/docs/adr/007-grpc-extraction.html) and [ADR-008](https://ivanball.github.io/docs/adr/008-service-extraction-topology.html), MicroserviceExtractionTests rationale
  - [ADR-015](https://ivanball.github.io/docs/adr/015-architecture-fitness-functions.html), the structural fitness tier of section 4, which stops explicitly at structure and registration
  - [ADR-058](https://ivanball.github.io/docs/adr/058-runtime-conformance-suites-as-a-package.html), the runtime conformance suites of section 3, which pick up where ADR-015 stops
  - [ADR-060](https://ivanball.github.io/docs/adr/060-performance-regression-gate.html), the benchmark baseline gate
  - [ADR-063](https://ivanball.github.io/docs/adr/063-accessibility-conformance-gate.html), WCAG 2.1 AA as a shipped test contract and CI gate
