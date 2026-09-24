# MMCA.Common: Architecture Remediation Backlog

Derived from the [scorecard](common-ArchitectureScorecard.md): Maturity **97.6%** (320/328) and Implementation **86.7%** (711/820), framework v1.209.0, evidence as of 2026-09-22. Tasks are ranked on both scorecard axes, one band per axis. The **maturity band** holds every category with maturity < 4, ranked by **priority = (4 − maturity) × weight**; the **implementation band** holds every category with implementation <= 8, ranked by **implPriority = max(0, 9 − implementation) × weight** (target 9: a 10 is awardable at re-score time, but it is recognition, not scheduled work). Ties break by weight descending, then category number. A category reaches the Resolved table only at maturity 4 AND implementation >= 9. The maturity band holds **3 categories, 8 gap points**; the implementation band holds **12 categories, 27 gap points**. Levers are cited only where this ledger or the scorecard records one; an unnamed lever is named at the next re-score, never invented here.

## Open work at a glance

| Priority | # | Category | M / I | Band | Next action |
|---|---|---|---|---|---|
| 4 (M), 2 (I) | #31 | Cost Efficiency / FinOps | 2 / 8 | Maturity + Implementation | None scheduled: a documented accepted cap (see *Deliberate and accepted*) |
| 3 (I) | #4 | Domain-Driven Design | 4 / 8 | Implementation | Lever not yet named; strategic DDD and a typed, gated tenant identifier are the open criteria |
| 3 (I) | #11 | Security | 4 / 8 | Implementation | Align `SECURITY.md:81` with the shipped Key Vault helper (doc hygiene); band lever not yet named |
| 3 (I) | #29 | Resilience & Business Continuity | 4 / 8 | Implementation | Tested restores, per-service RTO/RPO and measured production SLOs (consumer IaC) |
| 2 (M), 2 (I) | #17 | DevOps & Deployment | 3 / 8 | Maturity + Implementation | Smoke-deploy the `samples/deployment` sample; the Bicep job is compile-only and not a required context |
| 2 (M), 2 (I) | #30 | Compliance, Privacy & Governance | 3 / 8 | Maturity + Implementation | Lever not yet named; the governing privacy process is consumer-owned |
| 2 (I) | #5 | Vertical Slice Architecture | 4 / 8 | Implementation | Lever not yet named |
| 2 (I) | #12 | Performance & Scalability | 4 / 8 | Implementation | Lever not yet named; load/stress at realistic volumes has zero in-repo evidence |
| 2 (I) | #13 | Observability & Operability | 4 / 8 | Implementation | Add a dashboard or workbook resource to the sample template (effort S) |
| 2 (I) | #23 | Front-End Performance | 4 / 8 | Implementation | CI payload/bundle budget, route code-splitting, tighter web-vitals ceilings (effort M) |
| 2 (I) | #24 | Forms, Validation & UX Safety | 4 / 8 | Implementation | Password-rule parity, localized auth-form errors, confirmation before session revoke (effort M) |
| 2 (I) | #34 | Architecture Governance & Docs | 4 / 8 | Implementation | Refresh the workspace architecture map and add an ADR template |
| outside bands | #20 | Design System & UI Consistency | 4 / 9 | none (residual) | Migrate the remaining Bootstrap chrome to MudBlazor |
| outside bands | #27 | Internationalization (i18n) | 4 / 9 | none (residual) | Fix the `SharedResource.es.resx:467` value and add a plural-sentence convention check (effort S each) |

## Open items

### [ ] #4 · Domain-Driven Design
- *Gap:* strategic DDD (bounded contexts, ubiquitous language) is realized downstream: the Domain layer holds one aggregate family (Notifications) plus auth support types. The rubric-v2 tenancy criterion is met on its first half only: ADR-073 records the model, but the tenant identifier is a plain string by deliberate decision and a missing `ITenantEntity` marker fails no build and no test. `EntityConventionTestsBase` and `ImmutabilityTestsBase` have no MMCA.Common subclass.
- *Lever:* not yet identified.

### [ ] #11 · Security
- [ ] **Bring `SECURITY.md:81` in line with the shipped Key Vault helper** (doc hygiene, not a score lever; effort S). The consumer-responsibilities section lists vault / managed-identity secret binding as "not enforceable in this framework", while `Source/Hosting/MMCA.Common.Aspire/Configuration/KeyVaultConfigurationExtensions.cs:78,109` ships `AddCommonKeyVaultConfiguration` over `DefaultAzureCredential` and the sample template binds the secret by Key Vault URL plus the app's UAMI (`samples/deployment/main.bicep:150`). The fix is a docs edit in the MMCA.Common repo.
- *Gap:* authorization is RBAC with capability indirection plus the opt-in, claim-trusting `OwnerOrAdminFilter` (`Source/Presentation/MMCA.Common.API/DependencyInjection.cs:85`) rather than a resource/attribute policy engine; the ADR-037 `EncryptedStringConverter` is unadopted in Source; and the written threat model the rubric requires is absent repo-wide (an unmet criterion that counts against the score, recorded as not scheduled work under *Deliberate and accepted*).
- *Lever:* not yet identified; a future re-score must not mint a sub-item for the threat model.

### [ ] #29 · Resilience & Business Continuity
- *Gap:* tested restores, RTO/RPO per service and measured production SLOs, which the framework's own guide records as consumer-IaC work (`common-RESILIENCE.md:3,28`). The in-repo restore drill is a build gate and holds Maturity 4.
- *Lever:* the consumer-side evidence above; nothing further is schedulable in-repo.

### [ ] #17 · DevOps & Deployment
- *Gap (both bands):* the `sample-deployment-validate` job is a compile check (`az bicep build` at `ci.yml:807` and `:811`, job at `ci.yml:795`) and is not among the 8 required contexts, and a library cannot deploy itself, so real CD-to-Azure lives in consumers.
- *Lever:* a smoke-deploy of the `samples/deployment` sample, which moves the category from referenced toward proven.

### [ ] #30 · Compliance, Privacy & Governance
- *Gap (both bands):* the in-repo mechanism is complete (erasure extension point, `PiiRedactor`, a fitness-gated erasure contract, DSAR export, audit trail with retention purge), but both surfaces are opt-in, `PiiConventionTests` is structurally vacuous in the framework, `DataResidencyTestsBase` has no in-repo subclass, consent/lawful basis is absent, no `PRIVACY.md` exists here, and the CSV export row-scoping hook is fail-open by default.
- *Lever:* not yet identified; further maturity movement needs the consumer apps to carry the personal-data inventory + DSAR/consent/residency process that the framework's `[Pii]`/`IAnonymizable` extension points feed (ADR-005).

### [ ] #5 · Vertical Slice Architecture
- *Gap:* the slice gate reads abstract bases (`Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Cqrs/ArchitectureRules.Slices.cs:39,69`), but 12 of the 13 Users handler bases stay exempt through their generic-parameter contract (`:110`), and the shared `UserUseCaseLog` switchboard gains a `LoggerMessage` for every new use case.
- *Lever:* not yet identified.

### [ ] #12 · Performance & Scalability
- *Gap:* the rubric's load/stress-at-realistic-volumes criterion has zero in-repo evidence. The opt-in `MessageBus:PrefetchCount` / `ConcurrentMessageLimit` backpressure knobs (`Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:222,232`) cover the backpressure half.
- *Lever:* not yet identified.

### [ ] #13 · Observability & Operability
- [ ] **Ship the dashboards half of the criterion** (effort S). The sample template provisions alerts and a runbook but no dashboard or workbook: the top-level resources from `samples/deployment/main.bicep:54` to `:287` are appInsights, keyVault, sqlServer, appDb, kvSqlConn, allowAzure, caEnv, api, actionGroup, sloAlerts and budget, and the template has zero dashboard or workbook matches. A `Microsoft.Portal/dashboards` or `Microsoft.Insights/workbooks` resource bound to the same SLO queries, kept compile-valid by the existing validate job, is the lever.

### [ ] #23 · Front-End Performance
- [ ] **Initial-load and measurement lever** (effort M): there is no CI payload/bundle budget and no lazy-loading or code-splitting anywhere in `Source/` (zero `LazyAssemblyLoader`/`OnNavigateAsync` matches, zero payload/bundle/size-budget matches in `ci.yml`), and the web-vitals ceilings (4000/3000/1500/0.1/500) sit 1.6x to 1.9x above the package's own good-band defaults, with the suite's own comment calling them interim. INP is sampled on one page and Chromium only (`WebVitalsE2ETests.cs:21` `InpBudgetMs = 500`, `:61` drives an interaction).

### [ ] #24 · Forms, Validation & UX Safety
- [ ] **Three-part lever** (effort M):
  - (a) align `PasswordComplexityAttribute`'s Unicode-aware character classes (`Pages/Auth/PasswordComplexityAttribute.cs:26-30`, `char.IsUpper`/`IsLower`/`!IsLetterOrDigit`) with `StrongPasswordRules`' ASCII regexes (`CommonValidationRules.cs:195-198`), or move both onto one shared rule, and pin the parity with a Theory over non-ASCII passwords (a non-ASCII letter is a client false pass or false fail against the server, the category's first named red flag, on the one form Common owns on both sides);
  - (b) convert the four auth models' English `ErrorMessage` literals (`RegisterModel.cs:11-27`, `LoginModel.cs:11-15`, `ForgotPasswordModel.cs:11`, `ResetPasswordModel.cs:12-25`, pinned by `RegisterFormTests.cs:47-49`) to resource keys resolved through the shipped localizing path (`Pages/Notifications/NotificationSendModel.cs:22-28` via `Validation/DataAnnotationsModelValidator.cs:142-151`) with `es` siblings;
  - (c) put the existing `DeleteConfirmation` / `IAppDialogService.ConfirmAsync` in front of "Sign out everywhere" (`Pages/Auth/Sessions.razor:95-106`, `Sessions.razor.cs:154-172`, which ends the current session too on a single click) and the per-row revoke (`Sessions.razor:78-89`).

### [ ] #34 · Architecture Governance & Documentation
- [~] **Refresh the analysis doc and add an ADR template.** The two ADRs this item asked for exist (`Website/docs-src/adr/006-database-per-service.md`, `007-grpc-extraction.md`), and the ADR index is `Website/docs-src/adr/README.md`. Open: no ADR template file exists under `docs-src/adr/` (the index's "Writing a new ADR" section is prose, not a template), and the workspace-level `Docs/Architecture/ArchitecturalAnalysis.md` contradicts the gated facts, stating 13 published packages at v1.82.0 (`Docs/Architecture/ArchitecturalAnalysis.md:5,99`) against **22** at `FACTS.md:19`.
- [ ] **Re-sync the governance prose to the generated FACTS and the current ADR corpus** (effort S). `FACTS.md` is the source of truth for version, package count and fitness counts (`FACTS.md:4,14,19,51,54`), and the ADR index owns the ADR range (`Website/docs-src/adr/README.md:6`); `build/facts/FactsGenerator.cs:208` emits the dual-registry string reproduced at `FACTS.md:20`. The open half is the workspace architecture map above, which this repo cannot close because the workspace root owns that file.
- *Band lever:* the out-of-repo workspace architecture map, recorded as unresolved.

### #20 · Design System & UI Consistency (M4/I9, outside both bands)
- [ ] **Migrate the remaining Bootstrap chrome to MudBlazor**, drop the bundled Bootstrap CSS, and source the brand hex from one token. Bootstrap 5.3.3 is bundled at `Source/Presentation/MMCA.Common.UI/wwwroot/lib/bootstrap/dist/css/bootstrap.min.css` and `Layout/NavMenu.razor.css:23` compensates for its `.navbar` flex-wrap; the first residual `!important` is at `wwwroot/app.css:124`, with raw hex at `:4-16,60,72,76`.

### #27 · Internationalization (i18n) (M4/I9, outside both bands)
- [ ] **Fix the Spanish singular plural value** at `Resources/SharedResource.es.resx:467`, which ships unaccented while its base and `.Other` siblings carry the accent (effort S).
- [ ] **Add a convention check that fails on a new `{0}` plus plural-noun resource value**, so the count-in-fixed-plural-sentence defect cannot return silently (effort S; the plural mechanism is `Globalization/StringLocalizerPluralExtensions.cs:40`, with one call site at `Pages/Notifications/NotificationSend.razor.cs:117`).

## Implementation band

Every category at implementation <= 8, ranked by implPriority = max(0, 9 − implementation) × weight. Three of these categories (#17, #30, #31) also sit in the maturity band; this band records only their implementation half.

| implPriority | # | Category | w | Impl | Recorded lever |
|---|---|---|---|---|---|
| 3 | #4 | Domain-Driven Design | 3 | 8 | not yet identified (the §4 fitness surface has no MMCA.Common subclass of `EntityConventionTestsBase` or `ImmutabilityTestsBase`, and the Notifications family is the only in-repo aggregate) |
| 3 | #11 | Security | 3 | 8 | not yet identified (the vault/managed-identity half is framework-shipped as opt-in `AddCommonKeyVaultConfiguration` via `DefaultAzureCredential`, `Aspire/Configuration/KeyVaultConfigurationExtensions.cs:78,109`, while `SECURITY.md:81` lists it as a consumer responsibility; the written threat model is absent repo-wide and recorded as not scheduled work; ownership is opt-in claim-trusting `OwnerOrAdminFilter`, `Source/Presentation/MMCA.Common.API/DependencyInjection.cs:85`, rather than ABAC; the ADR-037 `EncryptedStringConverter` is unadopted in Source) |
| 3 | #29 | Resilience & Business Continuity | 3 | 8 | tested restores, RTO/RPO per service, and measured production SLOs, recorded by the framework's own guide as consumer-IaC work (`common-RESILIENCE.md:3,28`) |
| 2 | #5 | Vertical Slice Architecture | 2 | 8 | not yet identified (the gate reads abstract bases, `Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Cqrs/ArchitectureRules.Slices.cs:39,69`, but 12 of the 13 Users bases stay exempt through their generic-parameter contract, `:110`, and the shared `UserUseCaseLog` switchboard grows with every use case) |
| 2 | #12 | Performance & Scalability | 2 | 8 | not yet identified (the rubric's load/stress-at-realistic-volumes criterion has zero in-repo evidence; the opt-in backpressure knobs at `Source/Core/MMCA.Common.Infrastructure/Messaging/MessageBusSettings.cs:222,232` cover the backpressure half) |
| 2 | #13 | Observability & Operability | 2 | 8 | the dashboards half of the SLO criterion: the sample declares four `Microsoft.Insights/scheduledQueryRules` SLO alerts wired to the action group (`samples/deployment/main.bicep:177,196,237,280`) with a paired runbook (`samples/deployment/OPERATIONS.md`), gated by `Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/SampleDeploymentObservabilityTests.cs:12` over `Testing.Architecture/Bases/Governance/ObservabilityConventionTestsBase.cs:30`, but no dashboard or workbook resource exists anywhere in the template (`:54-287`); effort S |
| 2 | #17 | DevOps & Deployment | 2 | 8 | the Bicep job is a compile check and is not among the required contexts (the validate job at `ci.yml:795`, `az bicep build` at `:807` and `:811`); a smoke-deploy of the sample is the lever |
| 2 | #23 | Front-End Performance | 2 | 8 | no CI payload/bundle budget and no lazy-loading/code-splitting anywhere in `Source/` (zero `LazyAssemblyLoader`/`OnNavigateAsync` matches, zero payload/bundle/size-budget matches in `ci.yml`), and web-vitals ceilings (4000/3000/1500/0.1/500) 1.6x to 1.9x above the package's own good-band defaults, which the suite's own comment calls interim; INP is sampled on one page and Chromium only (`WebVitalsE2ETests.cs:21`, `:61`); effort M |
| 2 | #24 | Forms, Validation & UX Safety | 2 | 8 | three-part lever, effort M (see *Open items*): (a) client/server password-rule parity (`Pages/Auth/PasswordComplexityAttribute.cs:26-30` vs `CommonValidationRules.cs:195-198`); (b) resource-keyed validation messages on the four auth models (`RegisterModel.cs:11-27`, `LoginModel.cs:11-15`, `ForgotPasswordModel.cs:11`, `ResetPasswordModel.cs:12-25`); (c) confirmation before "Sign out everywhere" and the per-row revoke (`Pages/Auth/Sessions.razor:95-106`, `:78-89`) |
| 2 | #30 | Compliance, Privacy & Governance | 2 | 8 | not yet identified (#30 is also in the maturity band) |
| 2 | #31 | Cost Efficiency / FinOps | 2 | 8 | **documented accepted cap, not scheduled work** (see *Deliberate and accepted*); the default-ON probe-telemetry filter and its span processor ship in-repo (`Aspire/Extensions.Telemetry.cs:19,129,234`: config key, `ProbeTelemetryFilterProcessor` registration and default-ON read), and the category ranks first on the maturity band |
| 2 | #34 | Architecture Governance & Docs | 2 | 8 | the out-of-repo workspace architecture map, recorded as unresolved: it reads 13 packages at v1.82.0 (`Docs/Architecture/ArchitecturalAnalysis.md:99`) against 22 at v1.209.0 (`FACTS.md:14,19`), see the #34 open item |

**Σ implPriority = 27** across the 12 live rows (3 + 3 + 3 + 2 + 2 + 2 + 2 + 2 + 2 + 2 + 2 + 2).

## Maturity band

Every category at maturity < 4, ranked by priority = (4 − maturity) × weight.

| Priority | # | Category | w | Maturity | Recorded lever |
|---|---|---|---|---|---|
| 4 | #31 | Cost Efficiency / FinOps | 2 | 2 | **documented accepted cap, not scheduled work** (see *Deliberate and accepted*): no cost, budget or FinOps convention is enforced by review or CI anywhere in-repo, and the unmet criteria are consumer/IaC execution |
| 2 | #17 | DevOps & Deployment | 2 | 3 | the Bicep validate job is compile-only and absent from the 8 required contexts, so the CD/IaC-apply axis is not automatically enforced; a library cannot deploy itself |
| 2 | #30 | Compliance, Privacy & Governance | 2 | 3 | the governing process (personal-data inventory, consent capture, residency verification) is absent in-repo or consumer-resident, so the category as a whole is not automatically enforced |

**Σ priority = 8** across the 3 maturity-band rows (4 + 2 + 2).

## Deliberate and accepted

Recorded decisions and deferred findings: each is real, none is scheduled work.

### [accepted] #31 · Cost Efficiency / FinOps: held at Maturity 2 / Implementation 8 by documented acceptance
The computed maturity priority = (4 − 2) × 2 = **4** is the highest weighted gap of any open category, but the unmet §31 criteria are consumer/IaC execution a NuGet library cannot perform: **right-sizing** and **reversible scale-events** are host-infrastructure actions the framework provisions nothing to take, and **per-service cost attribution** via Aspire resource annotations is inert for the hand-written `main.bicep` consumers (ADC/Store). The in-repo levers ship and are documented: the `Telemetry:TracesSampleRatio` OTel sampler knob, the outbox per-message log at Debug, the default-ON probe-telemetry filter, a fifth `rubric §31` cost knob (`Telemetry:EnablePollyDurationMetrics`, `CHANGELOG.md:233`), and the cost guide's cost-attribution-tag plus cost-guard samples ([`common-COST.md`](../guides/common-COST.md)). No cost convention is enforced by review or CI (`Tests/Architecture` has zero cost/FinOps matches; the `.github` hits are incidental prose, for example the comment at `ci.yml:330`), so Maturity stays 2. Further movement is a consumer-side lift. Reversing this entry is a user decision.

### [accepted] #11 · A written threat model is not scheduled work
The three §11 threat-model documentation items are out of the workspace program by user decision and are not to be re-scheduled without asking. The rubric's §11 criteria name a written threat model, no such document exists in MMCA.Common (zero "threat model" matches in `SECURITY.md`), and its absence is a named §11 red flag, so the criterion stays **unmet and counted**: #11 holds at Maturity 4 / Implementation 8 with its implementation-band row at implPriority 3. The #11 lever does not carry the threat model as schedulable work, and a re-score must not mint a sub-item for it.

### [accepted] Dual-registry publishing, and the release-workflow filename is load-bearing
Every release publishes to **both** nuget.org and GitHub Packages (ADR-053). The nuget.org leg uses keyless OIDC trusted publishing: `NuGet/login` exchanges the workflow's `id-token` for a short-lived, single-use API key, so there is **no stored `NUGET_API_KEY` secret** (`id-token: write` at `release.yml:20` and `:139`, `NuGet/login` at `:117` and `:228`, nuget.org pushes at `:124` and `:236`, the API key read from `steps.nuget-login.outputs`). The trusted-publishing policy on nuget.org is pinned to this workflow **file**, so renaming or relocating `release.yml` breaks the token exchange by design; the constraint is recorded in-file at `release.yml:112` (and `:223-224` for the MAUI job), at its point of use. `FACTS.md:20`, emitted by `FactsGenerator.cs:208`, names nuget.org alongside GitHub Packages.

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
- [ ] **FR-7 (§34) - CS1591 ratchet.** XML doc coverage is enforced by convention, not the compiler: `CS1591` sits in `NoWarn` (`Directory.Build.props:27`, `<NoWarn>$(NoWarn);CS1591;RMG020;S8970;RS0041</NoWarn>`), so a public member can ship undocumented without a build break. Ratchet per-project (remove the suppression where already clean, then expand) rather than repo-wide at once. *(Effort S per project, long tail.)*

### [deferred] Low-value residuals (recorded, not scheduled)
- [ ] **#18: consider an analyzer/convention check for `EditorRequired` contracts on shared components.** A "consider", not a gate; carried on the resolved #18 entry rather than as open work.
- [ ] **#33: generate the local-dev package swap list from a glob, or add a smoke test that the `UseLocalMMCA` swap resolves all packages.** The list is hand-maintained three times in each consumer's `Directory.Build.targets` and can drift silently; the required `consumer-source-build` canary fails the merge if the Helpdesk `UseLocalMMCA` swap breaks, which mitigates it.

### Mostly consumer-assessed: #21 Accessibility, #26 Front-End Security
The shared Common.UI surface is scored here; each app's concrete posture is scored downstream. For #26, a host may register its own `ICspPolicyProvider` (first-registered provider wins, `Aspire/Security/SecurityHeaders.cs:263`), so each app's concrete CSP is consumer-assessed; for #21, axe breadth covers the gallery's representative states, and deep consumer states are scored in the consumer repos.

## Resolved

Categories at maturity 4 AND implementation >= 9 (protect them, do not regress), then the closed items inside categories that are still open.

| # | Category | M / I | Evidence |
|---|---|---|---|
| #1 | SOLID Principles | 4 / 9 | Application-owned ports + decorator pipeline registered innermost-first, `Application/DependencyInjection.cs:94-103` |
| #2 | Design Patterns | 4 / 9 | Specification composition with EF-translatable And/Or/Not, `Domain/Specifications/Specification.cs:62/88/114` |
| #3 | Clean Architecture | 4 / 9 | Compile-time layer guards `Source/Build/MMCA.Common.LayerEnforcement.targets:20` plus NetArchTest `LayerDependencyTests.cs:9` |
| #6 | CQRS & Event-Driven | 4 / 9 | EF-backed inbox dedup, `EfInboxStore.cs:18`, check at `IntegrationEventConsumer.cs:42` and `MarkProcessedAsync` at `:78`; the inbox is opt-in (`MessageBusSettings.cs:64`), which holds Implementation at 9 |
| #7 | Microservices Readiness | 4 / 9 | Anti-Corruption Layer named at `Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:21-22,71,78-80` and `README.md:71`, Strangler Fig route in ADR-007:23 and ADR-008:11,41; extraction rule under a required check (`MicroserviceExtractionTests.cs:11`) |
| #8 | Data Architecture | 4 / 9 | Required-gate CI migration-apply with outcome assertions, `ci.yml:578,597`, plus `MigrationApplyProofTests.cs:92` and the cascade-soft-delete rule `CascadeSoftDeleteConventionTestsBase.cs:29-31` |
| #9 | API & Contract Design | 4 / 9 | OpenAPI committed-baseline diff `OpenApiBaselineTests.cs:45-77` plus the `[ServiceContract]` purity rule `ArchitectureRules.Contracts.cs:32`; regenerate the baseline deliberately in the pull request that changes the contract |
| #10 | Messaging & Integration Architecture | 4 / 9 | Distributed idempotency lock `Infrastructure/Concurrency/RedisDistributedLock.cs:36` behind `IdempotencyFilter.cs:31-34`; layered broker retry at `Infrastructure/DependencyInjection.cs:957,961` |
| #14 | Testability & Test Strategy | 4 / 9 | 68.3% line-coverage floor `ci.yml:481` and the `--minimum-expected-tests 2000` guard at `:183` |
| #15 | Best Practices & Code Quality | 4 / 9 | Five analyzers at error with TWAE and audit=all, `Directory.Build.props:7-13`, blocking vulnerability audit `ci.yml:141`; FR-2 stays recorded under *Deliberate and accepted* |
| #16 | AI-Native Application Architecture | 4 / 9 | `ContentPolicyGuardrail` with startup pattern validation, `Source/Core/MMCA.Common.AI/Guardrails/GuardrailServiceCollectionExtensions.cs:67-70`, plus the prompt-contract pin `PromptContractPinTestsBase.cs:59-62` and golden-replay gate `GoldenReplayTestsBase.cs:57-62` |
| #18 | UI Architecture & Components | 4 / 9 | Smart `DataGridListPageBase<TDto>` over dumb primitives, `MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:18`, bUnit-gated in `Tests/Presentation/MMCA.Common.UI.Tests/Components/` |
| #19 | State Management & Data Flow | 4 / 9 | Client-side staleness policy `IUiReadCache.cs:32,51,59,66` plus the live dirty accessor `UnsavedChangesGuard.razor:34,36,52` |
| #20 | Design System & UI Consistency | 4 / 9 | Dark palette contrast `Theme/MMCATheme.cs:60,73` locked by `DarkModeE2ETests.cs:30`; the Bootstrap-chrome residual stays open under *Open items* |
| #21 | Accessibility (a11y) | 4 / 9 | Required chromium axe gate over both themes, `DarkModeE2ETests.cs:30`, and `role="status"` loading state `Components/PageLoadingState.razor:3` |
| #22 | Responsive & Cross-Browser | 4 / 9 | All three engines are required merge gates, `.github/workflows/ci.yml:111-114` |
| #25 | Navigation & Information Arch | 4 / 9 | Route/auth drift gate `NavigationContractTests.cs:29,44` plus the typed route `NotificationInbox.razor:2` (`NavigationFlow.md:21`) |
| #26 | Front-End Security | 4 / 9 | Hardened default CSP `Aspire/Security/SecurityHeaders.cs:65`, pinned by `SecurityHeadersMiddlewareTests.cs:138-142` |
| #27 | Internationalization (i18n) | 4 / 9 | Pluralization `Globalization/StringLocalizerPluralExtensions.cs:40`, 6 facts at `StringLocalizerPluralExtensionsTests.cs:43`; two follow-ups stay open under *Open items* |
| #28 | Front-End Testing & Quality | 4 / 9 | Markup-snapshot regression tier `Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/MarkupSnapshot.cs` over `PrimitivesSnapshotTests.cs` |
| #32 | Dependency & Supply-Chain | 4 / 9 | MassTransit-major gate `DependencyVersionTestsBase.cs:24-37`, blocking SBOM `release.yml:91,204`, signed provenance `release.yml:82,196` |
| #33 | Developer Experience & Inner Loop | 4 / 9 | Required `consumer-source-build` canary `ci.yml:267-303`, listed at `CONTRIBUTING.md:62` |
| #4 (item) | Result-returning factories fitness-gated | 4 / 8 | `DomainFactoriesReturnResult` and the aggregate rules, `AggregateConventionTestsBase.cs:14-24` |
| #5 (item) | Slice-cohesion fitness function | 4 / 8 | `ArchitectureRules.Slices.cs:39,69` with fixture self-tests `SliceCohesionFitnessTests.cs:21,32,43` |
| #11 (item) | CI vulnerability gate, security invariants, OWASP note | 4 / 8 | `ci.yml:141` via `.github/actions/nuget-vulnerability-audit/action.yml:39,63`; `AnonymousEndpointTestsBase` subclassed in Common and every consumer; `SECURITY.md:84-86` |
| #11 (item) | Secure-by-default `RequireHttpsMetadata` | 4 / 8 | Single `AddForwardedJwtBearer` definition at `API/Startup/WebApplicationBuilderExtensions.cs:444` |
| #12 (item) | Performance regression gate as a required check | 4 / 8 | `ci.yml:179` job matching the required context, baseline `Tests/Performance/perf-baseline.json:3-13` |
| #13 (item) | SLO alerting as code with a paired runbook | 4 / 8 | `samples/deployment/main.bicep:177,196,237,280` gated by `SampleDeploymentObservabilityTests.cs:12`; outbox meter registered at `Extensions.Telemetry.cs:307` |
| #17 (item) | Reference Bicep secret binding, Dependabot, gated release | 3 / 8 | Secrets array `samples/deployment/main.bicep:151-152` with binding at `:164`; `.github/dependabot.yml:4,85`; `environment: release` at `release.yml:16,127` |
| #23 (item) | Packaged-asset hygiene and grid virtualization | 4 / 8 | `wwwroot` about 398 KB with a `Content Remove` for `.map` files; opt-in virtualization `DataGridListPageBase.cs:140,606` |
| #24 (item) | Password length cap and guard wiring | 4 / 8 | `ResetPasswordModel.cs:20-21` matches `CommonValidationRules.cs:194`; guard at `RoleAdminEdit.razor:7` and `NotificationSend.razor:12` |
| #29 (item) | Build-gated restore drill and fault injection | 4 / 8 | `DatabaseRestoreDrillTests.cs:27`; fault injection `ResilienceCircuitBreakerFaultInjectionTests.cs:17-61` |
| #30 (item) | Erasure extension point, PII redaction, outbox purge | 3 / 8 | `PiiErasureContractFitnessTests.cs:19-40`, `Domain/Privacy/PiiRedactor.cs:24-142`, `OutboxCleanupService.cs:19` |
| #34 (item) | CHANGELOG backfill, dual-registry FACTS string, required-gates doc | 4 / 8 | `CHANGELOG.md:691,716`; `FactsGenerator.cs:208` → `FACTS.md:20`; `CONTRIBUTING.md:57-66,113-123` |
| CD-1 | `GetAllForLookupAsync` forwards its predicate | n/a | `Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:278-282`, test `EntityQueryServiceTests.cs:462-480` |
| CD-2 | Lookup projection over a value-object property | n/a | Non-string name property projected in its CLR type and formatted in memory, `EFReadRepository.cs:222,280,295` |
| FR-5 | Cascade soft-delete semantics (#8) | n/a | Opt-in `DeleteChildren<TChild,TChildId>` at `AuditableAggregateRootEntity.cs:273` forced per aggregate by `CascadeSoftDeleteConventionTestsBase.cs:29-31` |
| C-1..C-7 | Defect fixes with pinning tests | n/a | Lockout-backoff clamp `LoginProtectionService.cs:54-58` (C-1), query failure metric `LoggingQueryDecorator.cs:39` (C-3), plus the OAuth return URL, child-service bearer token, lookup escaping, purge clock and session-cookie clock fixes (C-2, C-4..C-7) |
