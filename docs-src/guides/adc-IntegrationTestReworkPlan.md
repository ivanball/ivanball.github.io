# Integration-Test Tier Rework Plan (RemediationBacklog #14)

_As of: 2026-10-28._

Status: **complete** (all phases landed; the integration tier collects coverage through `dotnet-coverage`).
Speaker analytics cross-service reads are the only deferred item.
- **Phase 0, done.** The `MMCA.Common.API` middleware unit tests are consolidated into `MMCA.Common.API.Tests` in MMCA.Common (Common owns the full exception-handler coverage); ADC carries no `WebAPI.Tests` copy.
- **Phase 1 (Identity), done.** `Tests/Integration/MMCA.ADC.Identity.IntegrationTests`: `IdentityIntegrationTestFixture` derives from the shared `SqlServerIntegrationTestFixtureBase<Program>` in `MMCA.Common.Testing` (boots the host via `WebApplicationFactory<Program>`, overrides config via **process env vars** set before the host starts, real SQL DB via `ADC_TEST_SQL_BASE`/LocalDB, schema applied by `DatabaseInitStrategy=Migrate`, Respawn reset, drop-on-dispose). The first re-homed classes are `AnonymousAuthTests` (8 tests) and `AttendeeClaimsTests` (4). The tier cannot run in the headless dev environment (no reachable SQL Server); it runs in the `integration-tests` job of `deploy.yml` against a pinned SQL Server container (`mssql/server:2022-CU27-ubuntu-22.04`). Run via `MMCA.ADC.Integration.slnf`.
- **Phase 2 (Conference), done.** `Tests/Integration/MMCA.ADC.Conference.IntegrationTests`: the WAF **re-points the `AddForwardedJwtBearer` Bearer scheme at the in-memory test key** (`PostConfigure<JwtBearerOptions>` calling `JwtTokenGenerator.ConfigureInProcessTokenValidation`) and **fakes the Engagement gRPC `IBookmarkCountService`** (`FakeBookmarkCountService`). The host needs no test-specific guard: `Conference.Service/Program.cs` ends with `app.RunAsync()`, and its output-cache warm-up runs as an ADR-025 `IWarmupTask` (`SelfHttpOutputCacheWarmupTask`) that short-circuits in the `Testing` environment. Re-homed `AnonymousConferenceReadTests` (41 tests: anonymous reads + organizer-authenticated writes, so it exercises the JWT override). In `MMCA.ADC.Integration.slnf` (same CI job).
- **Phase 3 (Engagement), done.** `Tests/Integration/MMCA.ADC.Engagement.IntegrationTests`: same WAF shape as Conference (JWT in-process override; Engagement also uses `app.RunAsync()`), with the Conference gRPC `ISessionBookmarkValidationService` **faked** (`FakeSessionBookmarkValidationService`, validates every session except a sentinel id). `AttendeeBookmarkTests` (10 tests) re-homed and adapted to Engagement-only: bookmark CRUD, empty list, delete-then-get, duplicate -> 409, ineligible-session -> 400/404, and the `OwnerOrAdminFilter` ownership matrix (attendee-self / organizer-any / other-attendee -> 403). In `MMCA.ADC.Integration.slnf`.
- **Breadth fan-out, done.** The single-service tests are re-homed onto the per-service fixtures: **Conference**: Organizer Event/Session/Room/Question/Category CRUD + lifecycle + edge-cases, Associations, Attendee Q&A, Speaker management/update-auth; **Identity +4 files (21 tests)**: Auth edge-cases, Attendee auth, Attendee profile (`/UserClaims`), Organizer user management. **Access-denied authz matrices split + re-homed** (55 tests, the #11 authz-gate coverage): `Anonymous` -> Identity 5 / Conference 21 / Engagement 4; `Attendee` -> Conference 24 / Identity 1. The tier has since grown past the re-homed set (Conference `Contract/` and `Data/` fidelity tests, `OrganizerConcurrencyTests`; Engagement check-ins, live polls, points and session questions; Identity compliance, rate limiting and contract tests).
- **Notification tier.** `Tests/Integration/MMCA.ADC.Notification.IntegrationTests` follows the same shape (`NotificationIntegrationTestFixture`; JWT in-process override that keeps the `?access_token=` hub fallback; the Identity gRPC `IAttendeeQueryService` faked) and is the fourth project in `MMCA.ADC.Integration.slnf`.
- **Current size.** Declared `[Fact]` methods per project: Identity 88 (21 files), Conference 250 (33 files), Engagement 91 (12 files), Notification 20 (3 files), so 449 across `MMCA.ADC.Integration.slnf`; the contract-test classes also inherit facts from the shared `MMCA.Common.Testing` conformance bases. The CI step enforces `--minimum-expected-tests 450` against a measured run total of 462.
- **Phase 5, done: the integration tier is a required PR check with coverage.** The `integration-tests` job lives in `deploy.yml` and runs on `pull_request` only: `main` is branch-protected (PR plus required checks, strict up-to-date), so the PR run tests the exact tree that merges, and the job is not in `deploy.needs`. A docs-only diff skips the SQL container and the test step while the job still posts its required status. The test step wraps `dotnet test --solution MMCA.ADC.Integration.slnf` in `dotnet-coverage collect -f cobertura` and uploads the `coverage-integration` artifact, which the report-only `coverage` job merges with the unit tier.
- **Phase 4 (cross-service flows), done: in-process handler tests plus the broker-transport tier.**
  The two load-bearing cross-service flows are re-homed as **in-process consumer-handler integration
  tests** on the per-service fixtures (no Docker: they resolve the real
  `IIntegrationEventHandler<T>` from the booted host and assert against the real DB; they run in the
  SQL `integration-tests` job, same as Phases 1-3):
  - **BR-207 auto-link**: `Tests/Integration/MMCA.ADC.Conference.IntegrationTests/CrossService/CrossServiceUserRegisteredTests.cs`
    drives Conference's `UserRegisteredHandler` (email-match link, name-only match never links,
    no-match skip). Complements `OutboxFidelityTests` (Identity tier, which proves the *producer*
    enqueues the event): the *consumer* auto-link is covered too.
  - **Speaker-link round-trip**: `Tests/Integration/MMCA.ADC.Identity.IntegrationTests/CrossService/CrossServiceSpeakerLinkTests.cs`
    drives Identity's `SpeakerLinkedToUserHandler` / `SpeakerUnlinkedFromUserHandler` (sets / clears
    `User.LinkedSpeakerId`).
  - Both resolve handlers through the `Services` accessor that `SqlServerIntegrationTestFixtureBase`
    exposes.
  - **Broker-transport tier (container-backed).**
    `Tests/Integration/MMCA.ADC.CrossService.IntegrationTests` (`CrossServiceFixture` over the shared
    `CrossServiceFixtureBase`) boots the Identity, Conference and Engagement REST hosts plus two
    Notification replicas in one process (extern-alias `Program` access) against real Testcontainers
    SQL Server, RabbitMQ and Redis. It proves the genuine **MassTransit broker round-trip**
    (`UserRegistered` -> auto-link and `SpeakerLinked/Unlinked` transit outbox -> broker -> consumer, not
    just handler logic), the **Conference -> Engagement bookmark-count gRPC** read (Engagement on a real
    Kestrel socket), and the Notification **Redis backplane fan-out** across replicas
    (`TwoReplicaHubFanOutTests`). 11 tests in 5 classes, behind the `CrossServiceSmokeTests` smoke gate.
    It runs in `cross-service-tests.yml` (weeknights at 06:00 UTC plus `workflow_dispatch`, with a
    skip-if-unchanged guard) alongside the `ServiceBusEmulator.IntegrationTests` transport smoke (2
    tests), needs Docker, and is excluded from both slnf filters. The workflow is **never in
    `deploy.needs`**; instead the `cross-service-freshness` step of the deploy's `freshness` job fails a
    deploy when no run proving both jobs completed within 5 days.
    Speaker analytics cross-service reads remain the only deferred item (low value; revisit if needed).

The original combined `MMCA.ADC.IntegrationTests` (258 tests / 29 files) and `MMCA.ADC.WebAPI.Tests`
referenced the **deleted single `MMCA.ADC.WebAPI` host**. Their single-service tests are re-homed
(breadth fan-out above) and their headline cross-service flows are re-homed (Phase 4 above); the
combined project folder is deleted, and the per-service projects under `Tests/Integration` are the
integration tier.

## Recommended strategy: two tiers

1. **Primary: per-service `WebApplicationFactory<Program>`**: one in-process host per service
   (Identity / Conference / Engagement), cross-service edges mocked. `AddBrokerMessaging`
   short-circuits to in-process when `MessageBus:Provider` is absent, so **no broker container**
   is needed. Covers ~80% of the suite (auth gate, CRUD, validation, soft-delete, ownership).
2. **Secondary: real-broker + real-gRPC.** Testcontainers RabbitMQ (plus SQL Server and Redis), for
   the genuine cross-process flows (BR-207 `UserRegistered` -> speaker auto-link,
   `SpeakerLinkedToUser`/`SpeakerUnlinkedFromUser` round-trip, Conference -> Engagement bookmark count,
   Notification backplane fan-out). Token validation stays in-process here too; the published JWKS and
   OpenID discovery documents are proven separately by `JwksDiscoveryTests` on the JWKS-enabled Identity
   fixture.
3. **Aspire `DistributedApplicationTestingBuilder` is deferred** to the existing Playwright E2E lane
   (too heavy for the integration tier; overlaps E2E).

## Three code facts that shape the rework (verified)

- **Every service host is WAF-compatible**: Identity, Conference, Engagement and Notification all end
  with `app.RunAsync()`. Self-HTTP warm-up runs through the ADR-025 `IWarmupTask` extension point
  (`SelfHttpOutputCacheWarmupTask` on Conference, `SelfHttpWarmupTask` on Identity and Engagement),
  whose shared base short-circuits under the `Testing` environment.
- **Non-Identity services use `AddForwardedJwtBearer`** (fetches `{authority}/.well-known/...` JWKS).
  A per-service WAF has no JWKS authority, so the factory **post-configures `JwtBearerOptions`** with
  `JwtTokenGenerator.ConfigureInProcessTokenValidation` to validate the test public key in-process.
  Identity itself uses `AddCommonAuthentication` (in-process): no override.
- No host declares `public partial class Program;`: the fixtures bind `WebApplicationFactory<Program>`
  to each host's top-level-statements `Program` directly (and through extern aliases in the
  cross-service project).

## Databases

- **SQL Server for the whole per-service tier** (no SQLite tier): each fixture creates a throwaway
  database (LocalDB by default, `ADC_TEST_SQL_BASE` in CI against the job's SQL Server container), the
  host applies the schema with `DatabaseInitStrategy=Migrate`, Respawn resets data between tests, and
  the database is dropped on disposal.
- The SQL-fidelity gaps (#8) are covered on that same engine: soft-delete filters
  (`SoftDeleteFidelityTests`), rowversion concurrency (`OrganizerConcurrencyTests`), audit stamping
  (`AuditStampFidelityTests`), the outbox (`OutboxFidelityTests`). The
  `ef migrations has-pending-model-changes` drift check runs in the `build-and-test` job of `deploy.yml`.
- **Testcontainers SQL Server** backs only the cross-service tier.
- No `SQLServerDbContext` split: per-service DB routing is config-only via `DataSources`.

## Project structure

- One WAF test project per service (`MMCA.ADC.{Identity,Conference,Engagement,Notification}.IntegrationTests`):
  can't reference two `Program`-bearing hosts in one project.
- One `MMCA.ADC.CrossService.IntegrationTests` for the real-broker/real-gRPC tier, plus
  `MMCA.ADC.ServiceBusEmulator.IntegrationTests` for the Azure Service Bus emulator transport smoke.
- The `MMCA.Common.API` exception-handler unit tests live in `MMCA.Common.API.Tests` in MMCA.Common,
  not in an ADC `WebAPI.Tests` project.
- Reuse `MMCA.Common.Testing`: `SqlServerIntegrationTestFixtureBase<TEntryPoint>`,
  `IntegrationTestBase<TFixture>`, `CrossServiceFixtureBase` and `JwtTokenGenerator`.

## CI

- The **per-service tier is `MMCA.ADC.Integration.slnf`**, run by the PR-only `integration-tests` job
  in `deploy.yml` (SQL Server container, no Docker-in-Docker). It is a required PR check, which
  restores the authz/CRUD **merge gate (#11)**. `MMCA.ADC.CI.slnf` stays the unit, architecture and
  bUnit tier of `build-and-test`.
- The **container-based SQL Server + RabbitMQ + Redis tier runs in a separate nightly job**
  (`cross-service-tests.yml`), outside `deploy.needs` and enforced through the
  `cross-service-freshness` deploy gate.

## Phased sequencing (fastest win first)

All six phases are done; each line names what shipped.

- **Phase 0**: the dead WebAPI reference is gone and the middleware unit tests live in
  `MMCA.Common.API.Tests` (MMCA.Common); removes a non-building project (#16).
- **Phase 1**: **Identity WAF** (simplest host) on the reusable
  `SqlServerIntegrationTestFixtureBase<TEntryPoint>`; re-homed the `Auth*`/`AttendeeClaims`/`OrganizerUser`
  tests. Restores the auth/authz gate (#11).
- **Phase 2**, **Conference WAF**: first use of the `JwtBearerOptions` override; the warm-up runs as a
  `Testing`-aware `IWarmupTask`; `IBookmarkCountService` faked; re-homed the CRUD/lifecycle/edge-case block.
- **Phase 3**, **Engagement WAF**: `ISessionBookmarkValidationService` faked; bookmark +
  `OwnerOrAdminFilter` tests.
- **Phase 4**: SQL-fidelity subset (on the per-service SQL Server tier) + cross-service real-broker tier
  (BR-207, speaker-link, bookmark-count, backplane fan-out); the separate container CI job.
- **Phase 5**: integration coverage through `dotnet-coverage` (cobertura, merged by the report-only
  `coverage` job), `slnx`/`Integration.slnf`/`CI.slnf` finalized, the Testability row (section 14) recorded under Resolved in `adc-RemediationBacklog.md`.

## Key risks

- The non-Identity `JwtBearerOptions` in-process override is the trickiest piece: prove it on one
  Conference auth test before fanning out.
- Provider fidelity (owned types, soft-delete filters, rowversion): avoided by running the whole
  per-service tier on SQL Server rather than SQLite.
- Re-homing ~258 cross-module tests is the bulk of the effort: cross-module seeding becomes
  "seed-own-DB + fake-foreign-service"; genuine cross-module assertions move to the real-broker tier.

## Critical files

- `Tests/Integration/MMCA.ADC.{Identity,Conference,Engagement,Notification}.IntegrationTests/Infrastructure/`
  (`<Service>IntegrationTestFixture.cs`, `<Service>TestWebApplicationFactory.cs`,
  `<Service>IntegrationTestBase.cs` with the ADC seed/auth helpers, and the `Fake*` gRPC stand-ins)
- `Tests/Integration/MMCA.ADC.CrossService.IntegrationTests/Infrastructure/CrossServiceFixture.cs`
  and the per-host `*CrossServiceFactory.cs` files
- `Source/Services/MMCA.ADC.Conference.Service/Program.cs` (`SelfHttpOutputCacheWarmupTask`
  registration + `app.RunAsync()`)
- `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs`
  (`AddForwardedJwtBearer`/`AddCommonAuthentication`, the extension point the WAF overrides)
- `MMCA.Common/Source/Hosting/MMCA.Common.Testing/Fixtures/SqlServerIntegrationTestFixtureBase.cs`,
  `Fixtures/IntegrationTestBase.cs`, `Fixtures/CrossServiceFixtureBase.cs`, `Support/JwtTokenGenerator.cs`
- `MMCA.ADC.slnx`, `MMCA.ADC.Integration.slnf`, `MMCA.ADC.CI.slnf`; `.github/workflows/deploy.yml`
  (`integration-tests`, `coverage`, `freshness`) and `.github/workflows/cross-service-tests.yml`
