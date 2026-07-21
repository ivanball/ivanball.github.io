# Integration-Test Tier Rework Plan (RemediationBacklog #14)

Status: **complete** (Phase 4 broker-transport tier landed 2026-07-06; Phase 5 residual = coverlet only).
- **Phase 0 ✅** — `Tests/WebAPI` revived as `MMCA.Common.API` middleware unit tests (16 tests), in `MMCA.ADC.CI.slnf`.
- **Phase 1 (Identity) — ✅ verified green in CI.** `Tests/Integration/MMCA.ADC.Identity.IntegrationTests`: reusable `IdentityIntegrationTestFixture` (boots the host via `WebApplicationFactory<Program>`, overrides config via **process env vars** set before `CreateClient`, real SQL DB via `ADC_TEST_SQL_BASE`/LocalDB, Respawn reset, drop-on-dispose) + 11 re-homed tests (`AnonymousAuthTests`, `AttendeeClaimsTests`). **Compiles clean; runtime is verified by the `integration-tests` workflow** (SQL Server service container) — it cannot be run in the headless dev environment (no Docker + an instance-wide SQL logon trigger blocks LocalDB/localhost). Run via `MMCA.ADC.Integration.slnf`.
- **Phase 2 (Conference) — ✅ verified green in CI.** `Tests/Integration/MMCA.ADC.Conference.IntegrationTests`: the WAF **re-points the `AddForwardedJwtBearer` Bearer scheme at the in-memory test key** (`PostConfigure<JwtBearerOptions>` — Authority/ConfigurationManager nulled, static RSA `IssuerSigningKey` + `ValidIssuer`), **fakes the Engagement gRPC `IBookmarkCountService`**, and the host got an env-gated **warmup guard** (`Conference.Service/Program.cs` uses `app.RunAsync()` under `Testing` instead of `StartAsync`+self-HTTP warmup). Re-homed `AnonymousConferenceReadTests` (33 tests — anonymous reads + organizer-authenticated writes, so it exercises the JWT override). Added to `MMCA.ADC.Integration.slnf` (same CI job). Compiles 0/0.
- **Phase 3 (Engagement) — ✅ verified green in CI.** `Tests/Integration/MMCA.ADC.Engagement.IntegrationTests`: same WAF shape as Conference (JWT in-process override; no warmup guard — Engagement uses `app.RunAsync()`), with the Conference gRPC `ISessionBookmarkValidationService` **faked** (validates every session except a sentinel id). `AttendeeBookmarkTests` (10 tests) re-homed and adapted to Engagement-only — bookmark CRUD, duplicate→409, ineligible-session→400/404, and the `OwnerOrAdminFilter` ownership matrix (attendee-self / organizer-any / other-attendee→403). Added to `MMCA.ADC.Integration.slnf`. Compiles 0/0; CI run pending.
- **Breadth fan-out (in progress).** Re-homing the remaining single-service tests onto the proven fixtures: **Conference +14 files (~102 tests)** — Organizer Event/Session/Room/Question/Category CRUD + lifecycle + edge-cases, Associations, Attendee Q&A, Speaker management/update-auth; **Identity +4 files (~21 tests)** — Auth edge-cases, Attendee auth, Attendee profile (`/UserClaims`), Organizer user management. Compiles 0/0. **Access-denied authz matrices split + re-homed** (~55 tests, the #11 authz-gate coverage): `Anonymous` → Identity 5 / Conference 21 / Engagement 4; `Attendee` → Conference 24 / Identity 1. *Still to re-home:* Engagement bookmark edge-cases (3); speaker-link/analytics (cross-service → Phase 4).
- **Phase 5 (partial): integration-tests is now a deploy gate.** The `integration-tests` job moved into `deploy.yml` as a required dependency of `deploy` (`needs: [build-and-test, integration-tests]`), and the standalone `integration-tests.yml` was removed — so the ~290 integration tests must pass before any production deploy (they also run on PRs). Branch-protection required-checks were rejected: they'd force PRs, conflicting with the direct-push-to-main workflow. *Remaining in Phase 5:* coverlet coverage collection (needs the MTP `Microsoft.Testing.Extensions.CodeCoverage` wiring — deferred to avoid risking the now-gating job on an unverified coverage flag).
- **Phase 4 (cross-service flows) — headline flows ✅ done in-process; broker-transport tier deferred.**
  The two load-bearing cross-service flows are re-homed as **in-process consumer-handler integration
  tests** on the proven per-service fixtures (no Docker — they resolve the real
  `IIntegrationEventHandler<T>` from the booted host and assert against the real DB; runtime verified by
  the SQL `integration-tests` job, same as Phases 1–3):
  - **BR-207 auto-link** — `Tests/Integration/MMCA.ADC.Conference.IntegrationTests/CrossService/CrossServiceUserRegisteredTests.cs`
    drives Conference's `UserRegisteredHandler` (name-match link, ambiguous-name skip, no-match skip).
    Complements `OutboxFidelityTests` (Identity tier, which proved the *producer* enqueues the event):
    the *consumer* auto-link is now covered too.
  - **Speaker-link round-trip** — `Tests/Integration/MMCA.ADC.Identity.IntegrationTests/CrossService/CrossServiceSpeakerLinkTests.cs`
    drives Identity's `SpeakerLinkedToUserHandler` / `SpeakerUnlinkedFromUserHandler` (sets / clears
    `User.LinkedSpeakerId`).
  - Both required only a small additive `public IServiceProvider Services => _factory!.Services;` accessor
    on the Conference + Identity fixtures. **Compile 0/0.**
  - **Broker-transport tier: ✅ landed 2026-07-06 (container-backed, non-gating).** New
    `Tests/Integration/MMCA.ADC.CrossService.IntegrationTests` boots all three REST hosts in one process
    (extern-alias `Program` access) against real Testcontainers SQL Server + RabbitMQ, proving the genuine
    **MassTransit broker round-trip** (`UserRegistered`→auto-link and `SpeakerLinked/Unlinked` transit
    outbox→broker→consumer, not just handler logic) plus the **Conference→Engagement bookmark-count gRPC**
    read (Engagement on a real Kestrel socket). 9 tests behind a smoke gate. It runs in the new nightly /
    `workflow_dispatch` `cross-service-tests.yml` (needs Docker), is excluded from both slnf filters, and is
    **never in `deploy.needs`** so it cannot block a production deploy. First execution is a manual dispatch.
    Speaker analytics cross-service reads remain the only deferred item (low value; revisit if needed).

The original `MMCA.ADC.IntegrationTests` (258 tests / 29 files) and `MMCA.ADC.WebAPI.Tests`
referenced the **deleted single `MMCA.ADC.WebAPI` host**, won't build, and were removed from
`MMCA.ADC.slnx`. Their single-service tests are re-homed (breadth fan-out above) and their headline
cross-service flows are re-homed (Phase 4 above), so the orphaned `MMCA.ADC.IntegrationTests` project
folder is now fully superseded and **safe to delete** (the last Phase 5 step):
`Remove-Item -Recurse -Force Tests/Integration/MMCA.ADC.IntegrationTests`.

## Recommended strategy — two tiers

1. **Primary: per-service `WebApplicationFactory<Program>`** — one in-process host per service
   (Identity / Conference / Engagement), cross-service edges mocked. `AddBrokerMessaging`
   short-circuits to in-process when `MessageBus:Provider` is absent, so **no broker container**
   is needed. Covers ~80% of the suite (auth gate, CRUD, validation, soft-delete, ownership).
2. **Secondary: real-broker + real-gRPC** — Testcontainers RabbitMQ + a real Identity JWKS
   endpoint, for the genuine cross-process flows (BR-207 `UserRegistered`→speaker auto-link,
   `SpeakerLinkedToUser`/`SpeakerUnlinkedFromUser` round-trip, Conference→Engagement bookmark count).
3. **Aspire `DistributedApplicationTestingBuilder` is deferred** to the existing Playwright E2E lane
   (too heavy for the integration tier; overlaps E2E).

## Three code facts that shape the rework (verified)

- **Only `Conference.Service` is WAF-incompatible** — it ends with `StartAsync()` + self-HTTP/2
  `WarmupViaHttpAsync` + `WaitForShutdownAsync()`. Identity/Engagement/Notification use `app.RunAsync()`.
  Conference needs an **env-gated guard** (skip warmup + use `RunAsync` under `Testing`).
- **Non-Identity services use `AddForwardedJwtBearer`** (fetches `{authority}/.well-known/...` JWKS).
  A per-service WAF has no JWKS authority, so the fixture must **override `JwtBearerOptions`** to
  validate the `JwtTokenGenerator` test public key in-process (Authority/ConfigurationManager nulled,
  `IssuerSigningKey` set). Identity itself uses `AddCommonAuthentication` (in-process) — no override.
- Each host needs **`public partial class Program;`** (one line) so `WebApplicationFactory<Program>`
  can bind.

## Databases

- **SQLite in-memory** for the fast bulk tier (no Docker, CI-friendly; `DatabaseInitStrategy=EnsureCreated`).
- **MsSql Testcontainers** for a tagged SQL-fidelity subset (soft-delete filters, rowversion
  concurrency, outbox, `ef migrations has-pending-model-changes` drift check — the #8 gaps).
- No `SQLServerDbContext` split — per-service DB routing is config-only via `DataSources`.

## Project structure

- One WAF test project per service (`MMCA.ADC.{Identity,Conference,Engagement}.IntegrationTests`) —
  can't reference two `Program`-bearing hosts in one project.
- One `MMCA.ADC.CrossService.IntegrationTests` for the real-broker/real-gRPC tier.
- Revive `WebAPI.Tests` as a **host-neutral middleware unit-test project** (it's ~16 pure unit tests
  of `MMCA.Common.API` exception handlers — only the dead WebAPI `ProjectReference` broke it).
- Reuse `MMCA.Common.Testing` `IntegrationTestBase<TFixture>` + `JwtTokenGenerator`.

## CI

- Add the **SQLite per-service tier to `CI.slnf`** (seconds, no Docker) → restores the authz/CRUD
  **merge gate (#11)** with no workflow change.
- Keep the **container-based MsSql + RabbitMQ tier in a separate push-to-main / nightly job**.

## Phased sequencing (fastest win first)

- **Phase 0** — re-home `WebAPI.Tests` middleware unit tests; drop the dead WebAPI reference;
  re-add to `slnx`+`CI.slnf`. ~16 tests green; removes a non-building project (#16).
- **Phase 1** — **Identity WAF** (simplest host). Build the reusable `ServiceTestFixture<TProgram>`;
  re-home the `Auth*`/`AttendeeClaims`/`OrganizerUser` tests. Restores the auth/authz gate (#11).
- **Phase 2** — **Conference WAF**: first use of the `JwtBearerOptions` override + the warmup guard;
  mock `IBookmarkCountService`; re-home the CRUD/lifecycle/edge-case block.
- **Phase 3** — **Engagement WAF**: mock `ISessionBookmarkValidationService`; bookmark +
  `OwnerOrAdminFilter` tests.
- **Phase 4** — SQL-fidelity subset (MsSql) + cross-service real-broker tier (BR-207, speaker-link,
  bookmark-count); the separate container CI job.
- **Phase 5** — wire coverlet, finalize `slnx`/`CI.slnf`, update the CLAUDE.md "excluded" note, tick #14.

## Key risks

- The non-Identity `JwtBearerOptions` in-process override is the trickiest piece — prove it on one
  Conference auth test before fanning out.
- SQLite vs SQL-Server fidelity (owned types, soft-delete filters, rowversion) — run the
  concurrency/soft-delete/outbox subset on MsSql.
- Re-homing ~258 cross-module tests is the bulk of the effort: cross-module seeding becomes
  "seed-own-DB + fake-foreign-service"; genuine cross-module assertions move to the real-broker tier.

## Critical files

- `Tests/Integration/MMCA.ADC.IntegrationTests/Infrastructure/TestWebApplicationFactory.cs`
  (combined-host factory → split into per-service fixtures; its JWT config block is the auth-override template)
- `Tests/Integration/MMCA.ADC.IntegrationTests/Infrastructure/IntegrationTestBase.cs` (ADC seed/auth helpers)
- `Source/Services/MMCA.ADC.Conference.Service/Program.cs` (warmup/`StartAsync` guard + `public partial class Program`)
- `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs`
  (`AddForwardedJwtBearer`/`AddCommonAuthentication` — the seam the WAF overrides)
- `MMCA.Common/Source/Hosting/MMCA.Common.Testing/IntegrationTestBase.cs`, `JwtTokenGenerator.cs`
- `MMCA.ADC.slnx`, `MMCA.ADC.CI.slnf` (re-add reworked projects; CI inclusion per above)
