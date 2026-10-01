# MMCA.Common: Architecture Remediation Backlog

Derived from the [scorecard](common-ArchitectureScorecard.md): Maturity **96.6%** (317/328) and Implementation **86.0%** (705/820), framework v1.218.0, evidence as of 2026-10-01. Tasks are ranked on both scorecard axes, one band per axis. The **maturity band** holds every category with maturity < 4, ranked by **priority = (4 − maturity) × weight**; the **implementation band** holds every category with implementation <= 8, ranked by **implPriority = max(0, 9 − implementation) × weight** (target 9: a 10 is awardable at re-score time, but it is recognition, not scheduled work). Ties break by weight descending, then category number. A category reaches the Resolved table only at maturity 4 AND implementation >= 9. The maturity band holds **4 categories, 11 gap points**; the implementation band holds **15 categories, 33 gap points**. Levers are cited only where this ledger or the scorecard records one; an unnamed lever is named at the next re-score, never invented here.

## Open work at a glance

| Priority | # | Category | M / I | Band | Next action |
|---|---|---|---|---|---|
| 4 (M), 2 (I) | #31 | Cost Efficiency / FinOps | 2 / 8 | Maturity + Implementation | None scheduled: a documented accepted cap (see *Deliberate and accepted*) |
| 3 (M), 3 (I) | #1 | SOLID Principles | 3 / 8 | Maturity + Implementation | Lever not yet named; ISP, LSP and OCP have no automated gate and S107/S1200 sit at severity suggestion |
| 3 (I) | #4 | Domain-Driven Design | 4 / 8 | Implementation | Lever not yet named; strategic DDD and a strongly typed tenant identifier are the open criteria |
| 3 (I) | #11 | Security | 4 / 8 | Implementation | Lever not yet named; the written threat model is an accepted, unscheduled gap |
| 3 (I) | #29 | Resilience & Business Continuity | 4 / 8 | Implementation | Tested restores, per-service RTO/RPO and measured production SLOs (consumer IaC) |
| 2 (M), 2 (I) | #17 | DevOps & Deployment | 3 / 8 | Maturity + Implementation | Smoke-deploy the `samples/deployment` sample; the Bicep job is compile-only and not a required context |
| 2 (M), 2 (I) | #30 | Compliance, Privacy & Governance | 3 / 8 | Maturity + Implementation | Lever not yet named; consent, lawful basis and residency verification are consumer-owned |
| 2 (I) | #5 | Vertical Slice Architecture | 4 / 8 | Implementation | Lever not yet named |
| 2 (I) | #12 | Performance & Scalability | 4 / 8 | Implementation | Lever not yet named; the load tier is scheduled-only, not a merge gate |
| 2 (I) | #13 | Observability & Operability | 4 / 8 | Implementation | Lever not yet named |
| 2 (I) | #20 | Design System & UI Consistency | 4 / 8 | Implementation | Source the brand hex from one token and add a Common inline-style guard |
| 2 (I) | #23 | Front-End Performance | 4 / 8 | Implementation | Merge the consumers' adoption of the shipped `wasm-payload-budget` action (in progress) |
| 2 (I) | #33 | Developer Experience & Inner Loop | 4 / 8 | Implementation | Lever not yet named |
| 2 (I) | #34 | Architecture Governance & Docs | 4 / 8 | Implementation | Lever not yet named |
| 1 (I) | #27 | Internationalization (i18n) | 4 / 8 | Implementation | Time-zone rendering, error-code coverage for `es`, localized default emails |
| outside bands | #26 | Front-End Security | 4 / 9 | none (in progress) | TD-08: merge consumer adoption of the shipped same-origin data-call proxy |

## Open items

### [ ] #1 · SOLID Principles
- *Gap (maturity):* SRP and DIP are enforced automatically: a ratcheted constructor-dependency ceiling is subclassed in Common (`Tests/Architecture/MMCA.Common.Architecture.Tests/Cqrs/ConstructorDependencies/FrameworkConstructorDependencyTests.cs:25`; services 7 at `:33`, controllers 5 at `:37`, handlers 7 at `:40`), beside the compile-time layer targets and the NetArchTest layer, purity and clock-read subclasses. ISP, LSP and OCP have no automated gate, and S107 and S1200 sit at severity suggestion (`.editorconfig:478,492`).
- *Gap (implementation):* LSP, OCP and ISP have no explicit gate, and `NotSupportedException` appears in 20 source files (mostly MAUI capability classes). The `InternalCommandDeadLetter` 8-field record is excluded from the ceiling by design (`FrameworkConstructorDependencyTests.cs:57-68`).
- *Lever (maturity):* not yet identified.
- *Lever (implementation):* not yet identified.

### [ ] #4 · Domain-Driven Design
- *Gap:* strategic DDD (bounded contexts, ubiquitous language) is realized downstream: the Domain layer holds one aggregate family (Notifications) plus auth support types. The tenant identifier is a plain string by deliberate decision rather than a strong type; ADR-073 records the tenancy model, and `Tests/Architecture/MMCA.Common.Architecture.Tests/Domain/EntityModel/TenantEntityConventionTests.cs:20` gates the `TenantId` marker. Common subclasses `EntityConventionTestsBase` and `ImmutabilityTestsBase` (`Domain/EntityModel/EntityConventionTests.cs:12`, `ImmutabilityTests.cs:11`).
- *Lever:* not yet identified.

### [ ] #11 · Security
- *Gap:* authorization is RBAC with capability indirection plus the opt-in, claim-trusting `OwnerOrAdminFilter` (`Source/Presentation/MMCA.Common.API/DependencyInjection.cs:85`) rather than a resource/attribute policy engine; the ADR-037 `EncryptedStringConverter` is unadopted in Source; and the written threat model the rubric requires is absent repo-wide (an unmet criterion that counts against the score, recorded as not scheduled work under *Deliberate and accepted*).
- *Lever:* not yet identified; a future re-score must not mint a sub-item for the threat model.

### [ ] #29 · Resilience & Business Continuity
- *Gap:* tested restores, RTO/RPO per service and measured production SLOs, which the framework's own guide records as consumer-IaC work (`common-RESILIENCE.md:5-6`). The in-repo restore drill is a build gate and holds Maturity 4.
- *Lever:* the consumer-side evidence above; nothing further is schedulable in-repo.

### [ ] #17 · DevOps & Deployment
- *Gap (both bands):* the `sample-deployment-validate` job is a compile check (`az bicep build` at `ci.yml:831` and `:835`, job at `ci.yml:819`) and is not among the 8 required contexts, and a library cannot deploy itself, so real CD-to-Azure lives in consumers.
- *Lever:* a smoke-deploy of the `samples/deployment` sample, which moves the category from referenced toward proven.

### [ ] #30 · Compliance, Privacy & Governance
- *Gap (both bands):* the in-repo mechanism is complete (erasure extension point, `PiiRedactor`, a fitness-gated erasure contract, DSAR export, audit trail with retention purge, `PRIVACY.md`, a fail-closed CSV export at `Source/Presentation/MMCA.Common.API/Controllers/EntityControllerBase.cs:231,272`, and a non-vacuous PII marking rule at `Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/PiiConventionTests.cs:10-14`), but the audit-trail and export surfaces are opt-in, `DataResidencyTestsBase` has only a self-test probe subclass (`Governance/DataResidencyTestsBaseTests.cs:24`), and consent/lawful basis is absent (zero matches in Domain, Application and Infrastructure).
- *Lever:* not yet identified; further maturity movement needs the consumer apps to carry the consent, lawful-basis and residency process that the framework's `[Pii]`/`IAnonymizable` extension points feed (ADR-005).

### [ ] #5 · Vertical Slice Architecture
- *Gap:* Common is an SDK with no business use-case slices of its own, so slice cohesion is proven in the consumer repos, and handler bases that implement `ICommandHandler`/`IQueryHandler` over a generic parameter stay exempt from the slice rule by design (`Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Cqrs/ArchitectureRules.Slices.cs:31`).
- *Lever:* not yet identified.

### [ ] #12 · Performance & Scalability
- *Gap:* the rubric's load/stress-at-realistic-volumes criterion is met in part: the load tier (`Tests/Performance/MMCA.Common.LoadTests`, `OutboxThroughputLoadTests.cs` and `PagedQueryLoadTests.cs`) runs weekly or on dispatch only, on SQLite, and is not a merge gate (`.github/workflows/load-tests.yml:16`, cron `17 4 * * 0`), and Common carries no capacity-provisioning evidence. The opt-in `MessageBus:PrefetchCount` / `ConcurrentMessageLimit` backpressure knobs (`Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:222,232`) cover the backpressure half.
- *Lever:* not yet identified.

### [ ] #13 · Observability & Operability
- *Gap:* alerts, dashboards and runbooks are provisioned and used only by deployers. The sample's SLO alerts, runbook and workbook (`samples/deployment/main.bicep:338`) are compile-only in CI, and the shipped `ObservabilityConventionTestsBase` defaults its workbook requirement to false (`Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/ObservabilityConventionTestsBase.cs:58`).
- *Lever:* not yet identified.

### [ ] #20 · Design System & UI Consistency
- [ ] **Source the brand hex from one token, and add a Common inline-style guard.** `#1565C0` is defined in both `Source/Presentation/MMCA.Common.UI/Theme/BrandColors.cs:13` and `wwwroot/app.css:63`, and restated raw at `Layout/ReconnectModal.razor.css:99`, outside the token drift guard; 19 inline style declarations sit across 12 razor files with no Common guard, while ADC has one (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Ui/InlineStyleTests.cs:16`).
- *Gap beyond the lever:* the shared layout scoped CSS carries 41 `!important` overrides with raw nav colors (`Layout/NavMenu.razor.css:163-198`) and a badge override block duplicated between `Layout/MainLayout.razor.css:71` and `NavMenu.razor.css:276-286`.

### [~] #23 · Front-End Performance
- [~] **Run the shipped WASM payload budget in the consumers' CI.** The composite action ships in Common (`.github/actions/wasm-payload-budget/action.yml`), Common's `ci.yml` does not run it, and the ADC and Store adoption sits on unmerged branches, in `deploy.yml` (post-merge rather than a merge gate), so no `main` workflow enforces a payload budget. The web-vitals budgets sit at the good-band values (LCP 2500, FCP 1800, TTFB 800, CLS 0.1, INP 200; `Tests/Presentation/MMCA.Common.UI.E2E.Tests/WebVitals/WebVitalsE2ETests.cs:19-23`) on all three required engines.
  - *Evaluated and not adopted: route-level WASM lazy loading.* It needs a framework lazy-module registry, an `OnNavigateAsync` hook in Common's `Routes.razor` and deferred DI registration, and in ADC the landing module (Conference) and a layout-rendered module (Engagement) must load eagerly anyway, so little would be deferred. The payload-budget action (`.github/actions/wasm-payload-budget/action.yml`, shipped in Common and not yet run by ADC or Store `main`) is the #23 lever instead. Revisit when a consumer gains a large module that is neither the landing route nor rendered by the layout.

### [ ] #33 · Developer Experience & Inner Loop
- *Gap:* the criteria are met with several small, documented gaps: source mode binds a consumer to Common's last-built Debug reference assembly and needs a manual rebuild (`MMCA.Common/CONTRIBUTING.md:150`), contributors are told to expect CI-only analyzer and restore round-trips (`CONTRIBUTING.md:167`), the AppHost stalls when launched headless and its test tier is advisory (`.github/workflows/ci.yml:976`), and the agent guardrail hooks live in the workspace harness rather than in Common (Common's `.claude/settings.local.json` configures no hooks).
- *Lever:* not yet identified.

### [ ] #34 · Architecture Governance & Documentation
- *Gap:* governance prose defers to the generated `FACTS.md` for version, package count and fitness counts (`FACTS.md:4,14,19,51,54`) and to the ADR index for the ADR range (`Website/docs-src/adr/README.md:6`); an ADR template ships at `Website/docs-src/adr/_template.md`, and the workspace architecture map marks its body figures historical and points at `FACTS.md` (`Docs/Architecture/ArchitecturalAnalysis.md:3`). No residual is recorded against the criteria.
- *Lever:* not yet identified.

### [ ] #27 · Internationalization (i18n)
- [ ] **Close the three localization gaps:**
  - (a) render UTC instants in the user's time zone: `Source/Presentation/MMCA.Common.UI/Pages/Notifications/NotificationInbox.razor:57` and `NotificationList.razor:69` format raw UTC with `ToString("g")`, and `Pages/Auth/Sessions.razor.cs:234` calls `ToLocalTime()`, which is the server zone under Server/SSR render;
  - (b) cover the framework's emitted error codes for `es`: `ErrorResources.resx` holds 15 codes, so `Auth.InvalidCredentials` (`Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:140`) falls back to English in `Source/Presentation/MMCA.Common.API/Localization/ErrorLocalizer.cs:32` and reaches Spanish users through `Login.razor:246`, and no test checks code coverage;
  - (c) localize the default transactional emails, which are English-only with a fixed plural ("{minutes} minutes") at `Source/Core/MMCA.Common.Application/Users/UseCases/ForgotPassword/ForgotPasswordHandlerBase.cs:133` and `Users/UseCases/EmailConfirmation/SendEmailConfirmationHandlerBase.cs:134`.

### #26 · Front-End Security (M4/I9, outside both bands)
- [~] **TD-08 (#26) - Same-origin data-call proxy** (effort L). The framework owns this lever; ADC and Store consume it. The auth-path BFF is live: the refresh token lives only in the HttpOnly cookie and is exchanged server-side at the same-origin `/auth/session/token` endpoint (`ICookieSessionRefresher`, `Source/Presentation/MMCA.Common.API/SessionCookies/CookieSessionRefresher.cs:30`, implementation `:52`; the `UseCookieSessionRefresh()` pipeline step, `CookieSessionRefreshMiddleware.cs:43`), and the access token is held in memory, hydrated through `SameOriginProxyTokenRefresher` (`Source/Presentation/MMCA.Common.UI/Services/Auth/Tokens/SameOriginProxyTokenRefresher.cs:11`), which calls that endpoint through JS `fetch` with same-origin credentials so the refresh token never reaches JS (`:6-9`). The item is a full same-origin data-call proxy (the access token also out of JS) plus proxied login, register and OAuth flows, which closes the window in which the refresh token transits JS during the login round-trip. Its framework half ships opt-in in v1.218.0 (`Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyEndpoint.cs:29`, registration `SameOriginApiProxyServiceExtensions.cs:37`, CSRF header `Source/Presentation/MMCA.Common.UI/Services/Auth/SameOriginProxyHeaders.cs:14`). Open: consumer adoption. ADC and Store `main` pin `MMCA.Common.API` 1.217.0 and their `Program.cs` maps no `SameOriginApiProxy`; the ADC adoption sits on an unmerged branch and needs interactive verification on its Aspire stack before it merges. Design notes: `MMCA.ADC/TokenStorageDesignNote.md`.

## Implementation band

Every category at implementation <= 8, ranked by implPriority = max(0, 9 − implementation) × weight. Four of these categories (#1, #17, #30, #31) also sit in the maturity band; this band records only their implementation half.

| implPriority | # | Category | w | Impl | Recorded lever |
|---|---|---|---|---|---|
| 3 | #1 | SOLID Principles | 3 | 8 | not yet identified (the constructor ceiling is subclassed at `Tests/Architecture/MMCA.Common.Architecture.Tests/Cqrs/ConstructorDependencies/FrameworkConstructorDependencyTests.cs:25`; LSP, OCP and ISP have no explicit gate, and `NotSupportedException` appears in 20 uninspected source files, mostly MAUI capability classes) (#1 is also in the maturity band) |
| 3 | #4 | Domain-Driven Design | 3 | 8 | not yet identified (strategic DDD is realized downstream, the Notifications family is the only in-repo aggregate, and the tenant identifier is a plain string by decision) |
| 3 | #11 | Security | 3 | 8 | not yet identified (the written threat model is absent repo-wide and recorded as not scheduled work; ownership is opt-in claim-trusting `OwnerOrAdminFilter`, `Source/Presentation/MMCA.Common.API/DependencyInjection.cs:85`, rather than ABAC; the ADR-037 `EncryptedStringConverter` is unadopted in Source) |
| 3 | #29 | Resilience & Business Continuity | 3 | 8 | tested restores, RTO/RPO per service, and measured production SLOs, recorded by the framework's own guide as consumer-IaC work (`common-RESILIENCE.md:5-6`) |
| 2 | #5 | Vertical Slice Architecture | 2 | 8 | not yet identified (Common has no business use-case slices of its own, and generic-parameter handler bases stay exempt from the slice rule, `Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Cqrs/ArchitectureRules.Slices.cs:31`) |
| 2 | #12 | Performance & Scalability | 2 | 8 | not yet identified (the load tier runs weekly or on dispatch only, on SQLite, and is not a merge gate, `.github/workflows/load-tests.yml:16`; the opt-in backpressure knobs at `Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:222,232` cover the backpressure half) |
| 2 | #13 | Observability & Operability | 2 | 8 | not yet identified (the sample ships SLO alerts, a paired runbook and an SLO workbook, `samples/deployment/main.bicep:177,196,237,280,338`, gated by `Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/SampleDeploymentObservabilityTests.cs:12,24`; production alerting and dashboards are deployer-owned) |
| 2 | #17 | DevOps & Deployment | 2 | 8 | the Bicep job is a compile check and is not among the required contexts (the validate job at `ci.yml:819`, `az bicep build` at `:831` and `:835`); a smoke-deploy of the sample is the lever |
| 2 | #20 | Design System & UI Consistency | 2 | 8 | source the brand hex from one token (`Theme/BrandColors.cs:13` vs `wwwroot/app.css:63`, raw `#1565C0` at `Layout/ReconnectModal.razor.css:99`), and a Common inline-style guard |
| 2 | #23 | Front-End Performance | 2 | 8 | run the shipped `.github/actions/wasm-payload-budget/action.yml` in the consumers' CI (adoption in progress, not on ADC or Store `main`); route-level lazy loading is evaluated and not adopted |
| 2 | #30 | Compliance, Privacy & Governance | 2 | 8 | not yet identified (#30 is also in the maturity band) |
| 2 | #31 | Cost Efficiency / FinOps | 2 | 8 | **documented accepted cap, not scheduled work** (see *Deliberate and accepted*); the default-ON probe-telemetry filter and its span processor ship in-repo (`Aspire/Extensions.Telemetry.cs:19,129,233`: config key, `ProbeTelemetryFilterProcessor` registration and default-ON read), and the category ranks first on the maturity band |
| 2 | #33 | Developer Experience & Inner Loop | 2 | 8 | not yet identified |
| 2 | #34 | Architecture Governance & Docs | 2 | 8 | not yet identified |
| 1 | #27 | Internationalization (i18n) | 1 | 8 | three gaps (see *Open items*): UTC times rendered without time-zone handling (`Pages/Notifications/NotificationInbox.razor:57`, `NotificationList.razor:69`, server-zone `ToLocalTime()` at `Pages/Auth/Sessions.razor.cs:234`); `ErrorResources.resx` covers 15 codes, so `Auth.InvalidCredentials` (`AuthenticationServiceBase.cs:140`) reaches Spanish users in English; default emails are English-only with a fixed plural (`ForgotPasswordHandlerBase.cs:133`) |

**Σ implPriority = 33** across the 15 live rows (3 + 3 + 3 + 3 + 2 + 2 + 2 + 2 + 2 + 2 + 2 + 2 + 2 + 2 + 1).

## Maturity band

Every category at maturity < 4, ranked by priority = (4 − maturity) × weight.

| Priority | # | Category | w | Maturity | Recorded lever |
|---|---|---|---|---|---|
| 4 | #31 | Cost Efficiency / FinOps | 2 | 2 | **documented accepted cap, not scheduled work** (see *Deliberate and accepted*): no cost, budget or FinOps convention is enforced by review or CI anywhere in-repo, and the unmet criteria are consumer/IaC execution |
| 3 | #1 | SOLID Principles | 3 | 3 | not yet identified: SRP (the constructor ceiling at `Tests/Architecture/MMCA.Common.Architecture.Tests/Cqrs/ConstructorDependencies/FrameworkConstructorDependencyTests.cs:25`) and DIP are enforced automatically, while ISP, LSP and OCP have no automated gate and S107/S1200 sit at severity suggestion (`.editorconfig:478,492`) |
| 2 | #17 | DevOps & Deployment | 2 | 3 | the Bicep validate job is compile-only and absent from the 8 required contexts, so the CD/IaC-apply axis is not automatically enforced; a library cannot deploy itself |
| 2 | #30 | Compliance, Privacy & Governance | 2 | 3 | the governing process (personal-data inventory, consent capture, residency verification) is absent in-repo or consumer-resident, so the category as a whole is not automatically enforced |

**Σ priority = 11** across the 4 maturity-band rows (4 + 3 + 2 + 2).

## Deliberate and accepted

Recorded decisions and deferred findings: each is real, none is scheduled work.

### [accepted] #31 · Cost Efficiency / FinOps: held at Maturity 2 / Implementation 8 by documented acceptance
The computed maturity priority = (4 − 2) × 2 = **4** is the highest weighted gap of any open category, but the unmet §31 criteria are consumer/IaC execution a NuGet library cannot perform: **right-sizing** and **reversible scale-events** are host-infrastructure actions the framework provisions nothing to take, and **per-service cost attribution** via Aspire resource annotations is inert for the hand-written `main.bicep` consumers (ADC/Store). The in-repo levers ship and are documented: the `Telemetry:TracesSampleRatio` OTel sampler knob, the outbox per-message log at Debug, the default-ON probe-telemetry filter, a fifth `rubric §31` cost knob (`Telemetry:EnablePollyDurationMetrics`, `CHANGELOG.md:233`), and the cost guide's cost-attribution-tag plus cost-guard samples ([`common-COST.md`](../guides/common-COST.md)). No cost convention is enforced by review or CI (`Tests/Architecture` has zero cost/FinOps matches; the `.github` hits are incidental prose, for example the comment at `ci.yml:330`), so Maturity stays 2. Further movement is a consumer-side lift. Reversing this entry is a user decision.

### [accepted] #11 · A written threat model is not scheduled work
The three §11 threat-model documentation items are out of the workspace program by user decision and are not to be re-scheduled without asking. The rubric's §11 criteria name a written threat model, no such document exists in MMCA.Common (zero "threat model" matches in `SECURITY.md`), and its absence is a named §11 red flag, so the criterion stays **unmet and counted**: #11 holds at Maturity 4 / Implementation 8 with its implementation-band row at implPriority 3. The #11 lever does not carry the threat model as schedulable work, and a re-score must not mint a sub-item for it.

### [accepted] Dual-registry publishing, and the release-workflow filename is load-bearing
Every release publishes to **both** nuget.org and GitHub Packages (ADR-053). The nuget.org leg uses keyless OIDC trusted publishing: `NuGet/login` exchanges the workflow's `id-token` for a short-lived, single-use API key, so there is **no stored `NUGET_API_KEY` secret** (`id-token: write` at `release.yml:23` and `:156`, `NuGet/login` at `:131` and `:245`, nuget.org pushes at `:138` and `:253`, the API key read from `steps.nuget-login.outputs`). The trusted-publishing policy on nuget.org is pinned to this workflow **file**, so renaming or relocating `release.yml` breaks the token exchange by design; the constraint is recorded in-file at `release.yml:126` (and `:240-241` for the MAUI job), at its point of use. `FACTS.md:20`, emitted by `FactsGenerator.cs:208`, names nuget.org alongside GitHub Packages.

### [accepted] Consumers skipped v1.128.0 through v1.130.0
MMCA.ADC, MMCA.Store and MMCA.Helpdesk went from 1.127.0 straight to 1.131.0 and never pinned 1.128.0, 1.129.0 or 1.130.0 (`CHANGELOG.md:9-15`). This is ADR-016 lockstep behavior, not drift: 1.128.0 was distribution-only (assemblies byte-identical to 1.127.0), and 1.129.0 and 1.130.0 were superseded within the same day by 1.131.0. Recorded so an audit reading the version ladder does not score the window as three missed lockstep sweeps.

### [accepted] Domain design decisions (#4)
- **Cross-aggregate navigation is deliberately not forbidden.** Aggregate roots reference other roots via `[Navigation]` FK references loaded by the navigation populators (ADR-002), for example `Session.Event` / `Session.Room` in ADC; a strict rule would contradict ADR-002 and break the consumers' aggregates.
- **`Money.operator+` throws on a currency mismatch by design** (a C# operator cannot return `Result<T>`); `Money.Add(...)` is the documented `Result`-returning path (covered by `Addition_DifferentCurrencies_ThrowsInvalidOperationException` / `Add_DifferentCurrencies_ReturnsFailure`).
- **`BaseDomainEvent.DateOccurred` reads the ambient clock by design.** A domain event's occurrence instant is the moment the aggregate raises it, the correct event-sourcing/audit semantic (four domain tests enforce it); moving the stamp to the SaveChanges boundary would turn occurrence-time into persist-time. Documented in `BaseDomainEvent`.

### [accepted] Framework decisions kept as they are
- **The ADR-017 in-process idempotency lock fallback stays**: `IdempotencyFilter` uses the striped per-process semaphore only when a host registers no `IDistributedLock`.
- **The gated Scheduler / AuditTrail table mapping stays**: both tables map only when their feature is enabled.
- **§16 streamed inspection covers fragments, not the assembled answer** (`Source/Core/MMCA.Common.AI/Guardrails/ContentPolicyGuardrail.cs:176-189`): deliberate and recorded, not scheduled. The other two §16 residuals (a host-side way to require the injection policy rather than any guardrail, `Source/Core/MMCA.Common.AI/DependencyInjection.cs:208-217`, `AiSettings.cs:110`; a non-empty default or a documented reason for the empty `BlockedResponsePatterns`, `Guardrails/ContentPolicySettings.cs:57`, short-circuit at `Guardrails/ContentPolicyGuardrail.cs:269`) are the 9→10 rung, recognition at re-score time rather than scheduled work. Retrieval is out of scope by ADR-120 (`120-governed-chat-client-boundary.md:388-391`) and is unexercised, not unmet.
- **`[ServiceContract]` adoption on the consumers' `*.Contracts` projects is optional**: all three consumers subclass `ServiceContractPurityTestsBase`, and the attribute-driven rule stays a documented ratchet until a type carries the attribute.
- **Two performance refactors are deferred with rationale**: an interceptor `DetectChanges` reduction (the second detection pass may be load-bearing for audit stamps; it needs a dedicated EF-internals investigation, and the failure mode is silent data loss), and a by-id fast path around the dynamic query pipeline (a larger refactor, with the pressure mostly removed by ADR-040).

### [deferred] Full-review findings FR-1..FR-7 (recorded, not scheduled)
Each is real, none is scheduled, and each records why it is deferred. IDs follow the C-1..C-7 precedent (FR = full review).
- [ ] **FR-1 (§32/§16) - Re-split `MMCA.Common.Infrastructure` into opt-in provider packages (Cosmos / AzureMessaging / Media).** The single Infrastructure package drags all three EF providers (SQL Server, Cosmos, SQLite), three messaging stacks (in-process, RabbitMQ, Azure Service Bus via MassTransit), and ImageSharp into every consumer's dependency graph, SBOM and vulnerability surface, whether or not the consumer uses them (the SQLite advisory GHSA-2m69-gcr7-jv3q is the recorded example: every consumer inherits it for an engine most never enable). Deferred: a package split is a breaking, lockstep-wide re-shape (ADR-016) that needs its own design pass and consumer sweep. *(Effort L.)*
- [ ] **FR-2 (§15) - `Result<T>.Value` throw-on-failure guard.** Reading `.Value` on a failed result silently returns `null`/default; a guard that throws would convert the silent-null trap into a loud contract violation. Deferred as a breaking behavioral change (consumers may depend on the lenient read); the trap is documented in the `Result<T>` doc-comments. *(Effort M, breaking.)*
- [ ] **FR-3 (§6) - `TResult : Result` compile-time constraint on handler signatures.** The decorator pipeline assumes handler results are `Result`-shaped (the Transactional decorator pattern-matches `Result { IsFailure: true }`); a generic constraint would make that assumption compile-time instead of runtime. Deferred as a breaking generic-signature change; covered by an architecture rule asserting command/query result types derive from `Result`. *(Effort M, breaking.)*
- [ ] **FR-4 (§33) - Reconsider the C# preview extension-type DI surface.** DI registration methods use `extension(IServiceCollection)` blocks (`LangVersion: preview`). As the public registration surface of a published framework this is an adoption risk: consumers must also build with a preview language version until the feature GAs. Revisit when .NET ships the feature as stable; reverting to classic extension methods is mechanical but wide. *(Effort M, watch item.)*
- [ ] **FR-6 (§14) - `MMCA.Common.UI.Maui` has zero automated tests.** The one MAUI-TFM package is built and packed by the dedicated windows CI jobs (ADR-042) but nothing exercises it: the capability contracts and fallbacks are tested in `MMCA.Common.UI.Tests`, while the thin Essentials wrappers are verified only on-device. Options: a windows-job unit tier for the wrapper logic, or a documented on-device smoke checklist. *(Effort M.)*

### Mostly consumer-assessed: #21 Accessibility, #26 Front-End Security
The shared Common.UI surface is scored here; each app's concrete posture is scored downstream. For #26, a host may register its own `ICspPolicyProvider` (first-registered provider wins, `Aspire/Security/SecurityHeaders.cs:263`), so each app's concrete CSP is consumer-assessed; for #21, axe breadth covers the gallery's representative states, and deep consumer states are scored in the consumer repos.

## Resolved

Categories at maturity 4 AND implementation >= 9 (protect them, do not regress), then the closed items inside categories that are still open.

| # | Category | M / I | Evidence |
|---|---|---|---|
| #2 | Design Patterns | 4 / 9 | Specification composition with EF-translatable And/Or/Not, `Domain/Specifications/Specification.cs:62/88/114` |
| #3 | Clean Architecture | 4 / 9 | Compile-time layer guards `Source/Build/MMCA.Common.LayerEnforcement.targets:20` plus NetArchTest `LayerDependencyTests.cs:9` |
| #6 | CQRS & Event-Driven | 4 / 9 | EF-backed inbox dedup, `EfInboxStore.cs:18`, check at `IntegrationEventConsumer.cs:42` and `MarkProcessedAsync` at `:78`; the inbox is opt-in (`MessageBusSettings.cs:64`), which holds Implementation at 9 |
| #7 | Microservices Readiness | 4 / 9 | Anti-Corruption Layer named at `Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:21-22,71,78-80` and `README.md:71`, Strangler Fig route in ADR-007:23 and ADR-008:11,41; extraction rule under a required check (`MicroserviceExtractionTests.cs:11`) |
| #8 | Data Architecture | 4 / 9 | Required-gate CI migration-apply with outcome assertions, `ci.yml:635,654`, plus `MigrationApplyProofTests.cs:95` and the cascade-soft-delete rule `CascadeSoftDeleteConventionTestsBase.cs:29-31` |
| #9 | API & Contract Design | 4 / 9 | OpenAPI committed-baseline diff `OpenApiBaselineTests.cs:45-77` plus the `[ServiceContract]` purity rule `ArchitectureRules.Contracts.cs:32`; regenerate the baseline deliberately in the pull request that changes the contract |
| #10 | Messaging & Integration Architecture | 4 / 9 | Distributed idempotency lock `Infrastructure/Concurrency/RedisDistributedLock.cs:36` behind `IdempotencyFilter.cs:31-34`; layered broker retry at `Infrastructure/DependencyInjection.cs:957,961` |
| #14 | Testability & Test Strategy | 4 / 9 | 68.3% line-coverage floor `ci.yml:462` and the `--minimum-expected-tests 2000` guard at `:161` |
| #15 | Best Practices & Code Quality | 4 / 9 | Five analyzers at error with TWAE and audit=all, `Directory.Build.props:7-13`, blocking vulnerability audit `ci.yml:144`; FR-2 stays recorded under *Deliberate and accepted* |
| #16 | AI-Native Application Architecture | 4 / 9 | `ContentPolicyGuardrail` with startup pattern validation, `Source/Core/MMCA.Common.AI/Guardrails/GuardrailServiceCollectionExtensions.cs:67-70`, plus the prompt-contract pin `PromptContractPinTestsBase.cs:59-62` and golden-replay gate `GoldenReplayTestsBase.cs:57-62` |
| #18 | UI Architecture & Components | 4 / 9 | Smart `DataGridListPageBase<TDto>` over dumb primitives, `MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:18`, bUnit-gated in `Tests/Presentation/MMCA.Common.UI.Tests/Components/` |
| #19 | State Management & Data Flow | 4 / 9 | Client-side staleness policy `IUiReadCache.cs:32,51,59,66` plus the live dirty accessor `UnsavedChangesGuard.razor:34,36,52` |
| #21 | Accessibility (a11y) | 4 / 9 | Required chromium axe gate over both themes, `DarkModeE2ETests.cs:30`, and `role="status"` loading state `Components/PageLoadingState.razor:3` |
| #22 | Responsive & Cross-Browser | 4 / 9 | All three engines are required merge gates, `.github/workflows/ci.yml:257-260` |
| #24 | Forms, Validation & UX Safety | 4 / 9 | One Unicode-aware password rule on client and server, `Shared/Auth/PasswordComplexity.cs:52`, pinned by `PasswordRuleParityTests.cs:36`; resource-keyed auth errors `RegisterModel.cs:16`; confirm-before-revoke `Sessions.razor.cs:117,176` |
| #25 | Navigation & Information Arch | 4 / 9 | Route/auth drift gate `NavigationContractTests.cs:29,44` plus the typed route `NotificationInbox.razor:2` (`NavigationFlow.md:21`) |
| #26 | Front-End Security | 4 / 9 | Hardened default CSP `Aspire/Security/SecurityHeaders.cs:65`, pinned by `SecurityHeadersMiddlewareTests.cs:138-142` |
| #28 | Front-End Testing & Quality | 4 / 9 | Markup-snapshot regression tier `Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs` over `PrimitivesSnapshotTests.cs` |
| #32 | Dependency & Supply-Chain | 4 / 9 | MassTransit-major gate `DependencyVersionTestsBase.cs:24-37`, blocking SBOM `release.yml:104,217`, signed provenance `release.yml:95,212` |
| #1 (item) | Constructor-dependency ceiling subclassed in Common | 3 / 8 | `Tests/Architecture/MMCA.Common.Architecture.Tests/Cqrs/ConstructorDependencies/FrameworkConstructorDependencyTests.cs:25` (services 7 at `:33`, controllers 5 at `:37`, handlers 7 at `:40`) |
| #1 (item) | Narrowed constructors and per-engine data-source strategy | 3 / 8 | `AuthenticationServiceBase.cs:63-70` (7 parameters); `Persistence/DataSources/Engines/IDataSourceEngine.cs:18` via `DataSourceEngines.For`; engine-neutral `RequestExplicitKeyInsert()` at `IUnitOfWork.cs:45` |
| #4 (item) | Result-returning factories fitness-gated | 4 / 8 | `DomainFactoriesReturnResult` and the aggregate rules, `AggregateConventionTestsBase.cs:14-24` |
| #5 (item) | Slice-cohesion fitness function | 4 / 8 | `ArchitectureRules.Slices.cs:35,65` with fixture self-tests `SliceCohesionFitnessTests.cs:21,32,43` |
| #11 (item) | CI vulnerability gate, security invariants, OWASP note | 4 / 8 | `ci.yml:144` via `.github/actions/nuget-vulnerability-audit/action.yml:39,63`; `AnonymousEndpointTestsBase` subclassed in Common and every consumer; `SECURITY.md:84-86` |
| #11 (item) | Secure-by-default `RequireHttpsMetadata` | 4 / 8 | Single `AddForwardedJwtBearer` definition at `API/Startup/WebApplicationBuilderExtensions.cs:444` |
| #11 (item) | `SECURITY.md` documents the shipped Key Vault helper | 4 / 8 | `SECURITY.md:83-86` (`AddCommonKeyVaultConfiguration`, no-op unless `KeyVault:Uri`) |
| #12 (item) | Performance regression gate as a required check | 4 / 8 | `ci.yml:355` job matching the required context, baseline `Tests/Performance/perf-baseline.json:3-13` |
| #13 (item) | SLO alerting as code with a paired runbook | 4 / 8 | `samples/deployment/main.bicep:177,196,237,280` gated by `SampleDeploymentObservabilityTests.cs:12`; outbox meter registered at `Extensions.Telemetry.cs:307` |
| #13 (item) | Sample SLO workbook | 4 / 8 | `samples/deployment/main.bicep:338` (`Microsoft.Insights/workbooks`) required by `SampleDeploymentObservabilityTests.cs:24` (`RequireWorkbook => true`) |
| #17 (item) | Reference Bicep secret binding, Dependabot, gated release | 3 / 8 | Secrets array `samples/deployment/main.bicep:151-152` with binding at `:164`; `.github/dependabot.yml:4,85`; `environment: release` at `release.yml:19,152` |
| #18 (item) | `EditorRequired` convention check on shared components | 4 / 9 | `Tests/Architecture/MMCA.Common.Architecture.Tests/Ui/EditorRequiredParameterConventionTests.cs:26` |
| #20 (item) | Dark-palette contrast gate; MudBlazor as the only component library | 4 / 8 | Dark `PrimaryContrastText`/`ErrorContrastText` at `Theme/MMCATheme.cs:66,93` locked by `Layout/DarkModeE2ETests.cs:30`; no Bootstrap in the RCL (`wwwroot/app.css:108`) |
| #23 (item) | Packaged-asset hygiene and grid virtualization | 4 / 8 | `wwwroot` about 398 KB with a `Content Remove` for `.map` files; opt-in virtualization `DataGridListPageBase.cs:140,606` |
| #23 (item) | Good-band web-vitals budgets on three engines | 4 / 8 | `WebVitals/WebVitalsE2ETests.cs:19-23` (2500/1800/800/0.1/200), required `ui-e2e` at `ci.yml:324` |
| #24 (item) | Password length cap and guard wiring | 4 / 9 | `ResetPasswordModel.cs:20-21` matches `CommonValidationRules.cs:194`; guard at `RoleAdminEdit.razor:7` and `NotificationSend.razor:12` |
| #27 (item) | Pluralization and the plural-sentence convention check | 4 / 8 | `Globalization/StringLocalizerPluralExtensions.cs:40`, 6 facts at `StringLocalizerPluralExtensionsTests.cs:43`, plus `PluralSentenceResourceTests.cs:18` |
| #29 (item) | Build-gated restore drill and fault injection | 4 / 8 | `DatabaseRestoreDrillTests.cs:27`; fault injection `ResilienceCircuitBreakerFaultInjectionTests.cs:17-61` |
| #30 (item) | Erasure extension point, PII redaction, outbox purge | 3 / 8 | `PiiErasureContractFitnessTests.cs:19-40`, `Domain/Privacy/PiiRedactor.cs:24-142`, `OutboxCleanupService.cs:19` |
| #30 (item) | `PRIVACY.md`, fail-closed CSV export, non-vacuous PII marking rule | 3 / 8 | `MMCA.Common/PRIVACY.md`; `EntityControllerBase.cs:231,272`; `Governance/PiiConventionTests.cs:10-14` |
| #33 (item) | Glob-generated `UseLocalMMCA` package swap list | 4 / 8 | `build/LocalSource/MMCA.Common.LocalSource.targets:32`, imported at each consumer's `Directory.Build.targets:6` |
| #34 (item) | CHANGELOG backfill, dual-registry FACTS string, required-gates doc | 4 / 8 | `CHANGELOG.md:691,716`; `FactsGenerator.cs:208` → `FACTS.md:20`; `CONTRIBUTING.md:57-66,113-123` |
| #34 (item) | ADR template and the analysis doc's pointer to `FACTS.md` | 4 / 8 | `Website/docs-src/adr/_template.md`; `Docs/Architecture/ArchitecturalAnalysis.md:3` marks its body figures historical |
| CD-1 | `GetAllForLookupAsync` forwards its predicate | n/a | `Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:278-282`, test `EntityQueryServiceTests.cs:462-480` |
| CD-2 | Lookup projection over a value-object property | n/a | Non-string name property projected in its CLR type and formatted in memory, `EFReadRepository.cs:222,280,295` |
| FR-5 | Cascade soft-delete semantics (#8) | n/a | Opt-in `DeleteChildren<TChild,TChildId>` at `AuditableAggregateRootEntity.cs:273` forced per aggregate by `CascadeSoftDeleteConventionTestsBase.cs:29-31` |
| FR-7 | CS1591 ratchet mechanism (#34) | n/a | No repo-wide CS1591 suppression, `Directory.Build.props:27-30` (`NoWarn` is `RMG020;S8970;RS0041`); 11 Source csproj files still carry their own CS1591 `NoWarn`, the per-project long tail |
| C-1..C-7 | Defect fixes with pinning tests | n/a | Lockout-backoff clamp `LoginProtectionService.cs:54-58` (C-1), query failure metric `LoggingQueryDecorator.cs:39` (C-3), plus the OAuth return URL, child-service bearer token, lookup escaping, purge clock and session-cookie clock fixes (C-2, C-4..C-7) |
