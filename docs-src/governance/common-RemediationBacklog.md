# MMCA.Common: Architecture Remediation Backlog

Derived from `ArchitectureScorecard.md` (canonical two-axis scoring: **Maturity 97.5% / Implementation 86.3%**, framework v1.185.0. **Thirty-second-wave full re-score, 2026-09-04** (git HEAD `7018a48`, working tree clean): **two scores move, both on the Implementation axis and in opposite directions.** **#31 Cost Efficiency / FinOps Implementation 7→8** on new in-tree substance: the default-ON `Telemetry:FilterProbeTelemetry` knob plus the `ProbeTelemetryFilterProcessor` that un-records probe-child dependency spans (`Aspire/Extensions.cs:224,248`, 27 CI-gated tests), shipped in the v1.182.0 release the CHANGELOG titles "Cost release" (`CHANGELOG.md:136`), which falsifies the byte-identical-evidence ground of the four prior refutations; the acceptance rationale still holds for the remaining criteria, so the row stays capped at 8 and Maturity at 2. **#7 Microservices Readiness Implementation 9→8**, a rubric-change deduction and not the unforced band recalibration eight prior cycles declined: rubric v2 added the named **Anti-Corruption Layer** / **Strangler Fig** criterion (`ArchitectureEvaluationCriteria.md:263`, added by `ADR-110:55`) and neither term appears in MMCA.Common source, docs, or any ADR, while Maturity 4 is untouched because the extraction boundary is a required-check merge gate (`Rules/Layering/ArchitectureRules.Transport.cs:19`, `MMCA.Common.slnx:52`, `ci.yml:144`). Four first-pass lifts came back FLAG and are held at prior by merged-prior policy (#12 and #13 at I8→9, #17 and #30 at 3/8→4/9, the eighth consecutive refusal for #30), and **#10 Messaging & Integration Architecture was scored fresh under its v2 name for the first time and came back CONFIRMED at M4/I9**, retiring the rebase's carried-at-prior caveat. Band deltas: the maturity band is unchanged (#31 at priority 4, then #17 and #30 at priority 2 each, 3 categories / 8 gap points); the implementation band grows to **13 categories, 30 gap points** (from 12 / 29) because #7 enters at implPriority 3 while #31 drops from implPriority 4 to 2 on its lift. Ledger changes this cycle: #7 leaves the level-4 protect enumeration and gains an open heading; #31's accepted-cap entry is re-adjudicated to Maturity 2 / Implementation 8 and now ranks first on the maturity band only; the retired #16 row is marked retired at its open heading and recorded as this repo's one N/A category under ADR-110; the lockstep note advances to **1.185.0** across all three consumers; the #17 dangling-secret sub-item is re-verified still open; and the governance-figure drift under #34 recurs a tenth consecutive cycle, though its living-documentation half is now half closed. The prior thirty-first-wave header, retained: **Thirty-first-wave full re-score, 2026-09-01** (git HEAD `84116a3`, working tree clean): **no score moves**, 26 categories re-confirmed fresh and eight came back FLAG, every proposed lift refuted on adversarial re-verification and held at prior by merged-prior policy (seven implementation proposals refuted at I8→9: #4, #5, #11, #13, #17, #30 and #34, plus #8 at I9→10; two maturity proposals refuted: #17 M3→4 and #30 M3→4, the seventh consecutive refusal; the per-category reasons are on the scorecard's header line). Both ranked bands are unchanged in membership and order: maturity #31 at priority 4, then #17 and #30 at priority 2 each, 3 categories / 8 gap points; implementation **12 categories, 29 gap points** (the 2026-09-04 rubric v2 rebase retired the #16 row, struck through in the band). Ledger changes this cycle are evidence records only: the #17 Dependabot/audit sub-item ticks, the #34 analysis-doc sub-item is partially closed, a #13 anchor is corrected, the stale lockstep note under Deliberate / accepted is resolved (all three consumers pin 1.179.0), and the governance-figure drift under #34 recurs a ninth cycle and now reaches the living docs. The prior thirtieth-wave header, retained: **full re-score, 2026-08-31** (git HEAD `ea44e89`, working tree clean): **four scores move, all Implementation 8→9** (#8, #19, #25, #26, each on work shipped in commit `59d7a97`/PR #325 at v1.175.0, landed after the same-day twenty-ninth-wave adjudication of the prior tree; #8: a required-gate CI migration-apply against an ephemeral SQL Server with outcome assertions plus an in-repo apply proof, `ci.yml:578,597` / `MigrationApplyProofTests.cs:92`; #19: the `IUiReadCache` client-side staleness policy, 27 CI-gated tests; #25: the typed, constrained `@page "/notifications/inbox/{Id:int}"` deep-link route; #26: the complete hardened default CSP carrying both `script-src` and `style-src` plus a per-request `{nonce}` facility, `SecurityHeaders.cs:53-55`), so the implementation band drops from **17 categories / 42 gap points to 13 categories / 31 gap points**, the band's first closures since #10 on the twenty-fifth wave; three further 8→9 proposals (#11, #13, #23) came back FLAG, refuted on adversarial re-verification and held at prior by merged-prior policy; the remaining 27 categories re-confirmed fresh with no maturity move (the maturity band is unchanged: #31 at priority 4, then #17 and #30 at priority 2 each, 3 categories / 8 gap points). The prior twenty-ninth-wave header, retained: **full re-score, 2026-08-31** (git HEAD `5f65ce7`, working tree clean): **no score moves**, 22 categories re-confirmed fresh and twelve categories came back FLAG, every proposed lift refuted on adversarial re-verification and held at prior by merged-prior policy (eleven implementation proposals refuted: §8, §11, §13, §17, §19, §23, §25, §26, §29 and §34 at I8→9, plus §31 at I7→8; and three maturity proposals refuted: §17 M3→4, §30 M3→4 (the sixth consecutive refusal) and §31 M2→3; the per-category reasons are on the scorecard's header line). Categories below Maturity 4: **#17, #30 (M3) and #31 (M2)**, so 31 of 34 sit at Maturity 4; the maturity band is unchanged (#31 at priority 4, then #17 and #30 at priority 2 each, 3 categories / 8 gap points) and the implementation band holds at **17 categories, 42 gap points**. The prior twenty-eighth-wave header, retained: **full re-score, 2026-08-23** (git HEAD `d12cc4d`, working tree clean): **no score moves**, 28 categories re-confirmed fresh and six first-pass lifts came back FLAG, each refuted on adversarial re-verification and held at prior by merged-prior policy (§8, §11, §13, §26, §34 I8→9 and §30 M3→4). That cycle's ledger deltas were reconciliation, not score moves: #11's two remaining Fix sub-items are ticked on shipped evidence (the CI dependency-vuln gate at `ci.yml:113-127` and `SECURITY.md:84-86`) and its stale "3 → 4" heading is corrected while the category stays open in the implementation band at M4/I8; the §11 transitional-overload deletion (`PublicAPI.Unshipped.txt:56-57`) and the §9 consumer-subclassing follow-up (all three consumers subclass `ServiceContractPurityTestsBase`) are ticked; a new #34 CHANGELOG-backfill item is added (v1.159.0 and v1.160.0 shipped with no versioned section); the protect-list I8 enumeration drops #13 (its heading was always open, an internal inconsistency); and the header facts advance (framework v1.160.0, ADR range 001-096, Common's executed fitness count 129, both consumers converged on 1.160.0). The prior header, retained: **Targeted update 2026-08-22: #9 API & Contract Design closes at Maturity 4** (314 → 316/324, 96.9% → 97.5%; Implementation holds at 9) after MMCA.Common PR #271 landed the in-repo OpenAPI committed-baseline diff and the dedicated `[ServiceContract]` purity fitness rule, so the maturity band drops to **#17, #30 (M3) and #31 (M2)** and 31 of 34 categories sit at Maturity 4. The prior header, retained: the 2026-08-14 twenty-seventh-wave two-pass re-score at HEAD `3ba8d13`, working tree clean, moved **no scores**: 25 categories re-confirmed fresh and nine first-pass lifts came back FLAG, each refuted on adversarial re-verification and held at prior by merged-prior policy (§5 I8→9: the new `Users/UseCases` handler bases are abstract and sit outside the concrete-class slice gate, so the enforced surface is unchanged; §11, §13, §25, §29, §34 I8→9: no criterion-closing evidence since 2026-08-07; §26 I8→9: fourth refutation on the unchanged CSP `script-src`/`style-src` omission; §17 3/8→4/9: fourth consecutive refutation, the only §17 diff since the prior score being five documentation lines in `samples/deployment/DEPLOYMENT.md`; §30 M3→4: the newly shipped DSAR export base + field-level audit trail (ADRs 075/076) are real substance but opt-in twice over with no new automatic category gate, the fifth consecutive hold). **Categories still below Maturity 4 at that time: #9, #17, #30 (M3) and #31 (M2)**, so 30 of 34 then sat at Maturity 4; the maturity band was unchanged that cycle (#31 at priority 4, then #9, #17 and #30 at priority 2 each; #9 has since closed, see the targeted update above) and the implementation band holds at **17 categories, 42 gap points**. This cycle's ledger deltas are reconciliation, not score moves: #6 closes to the protect list (its 2026-08-07 deferral waited only for a CONFIRMED verdict, returned this cycle at M4/I9), #28 and #21 are added to the protect enumeration they had already earned, the two #19 `IsDirtyAccessor` sub-items are ticked on shipped evidence, and the header facts advance (framework v1.152.0, ADR range 001-078, both consumers re-converged at 1.152.0). The prior twenty-sixth-wave entry, retained for provenance: the 2026-08-07 re-score at HEAD `710d29d` moved no scores: 27 categories re-confirmed fresh and seven lifts refuted (§6 I9→10: no upcaster pipeline, inbox opt-in-off-by-default; §11 I8→9 and §12 I8→9: no criterion-closing evidence since 2026-08-01; §17 3/8→4/9: third consecutive refutation on byte-identical evidence; §25 I8→9: routes remain parameterless string templates, held by merged-prior policy; §26 I8→9: the static CSP still omits `script-src`/`style-src`; §31 M2→3/I7→8: no §31 artifact since v1.118.0); its ledger deltas closed #18, #20 and #32 to the protect list, closed CD-1 on shipped evidence, and ticked the #6 inbox and #13 outbox-meter sub-items in place. The twenty-fifth-wave entry, likewise retained: the 2026-08-01 re-score at HEAD `f292233` moved one score, ending the four-cycle steady state: **§10 Cross-Cutting Concerns Implementation 8→9** (685 → 687/810), on new shipped evidence (the idempotency guard acquires an `IDistributedLock`, `RedisDistributedLock` SET NX PX + compare-and-delete release, instead of the in-memory semaphore); four first-pass lifts were refuted (§2 I9→10 and §15 I9→10 (a live rubric red flag, and a `NoWarn` surface that grew), §17 3/8→4/9 (compile-only Bicep job, not a required context), §31 I7→8 (third refutation on byte-identical evidence)). The twenty-fourth-wave entry, likewise retained: the 2026-07-28 re-score at HEAD `2c52aa9` moved no scores, the fourth consecutive cycle at 96.9% / 84.6%, refuting five lifts (§9 3→4, §30 3→4, §13 8→9, §25 8→9, §29 8→9); its only new work was doc hygiene under #34. The twenty-third-wave entry, likewise retained: the 2026-07-25 re-score at HEAD `3dff29b` also moved no scores, refuting four lifts (§17 on both axes, §30, §31, §34) and one downgrade (§23). The twenty-second-wave entry, likewise retained: the 2026-07-23 re-score at HEAD `c911480` also moved no scores, refuting three lifts (§9, §10, §30) and two downgrades (§23, §24). The twenty-first-wave entry, likewise retained: the 2026-07-21 re-score at HEAD `4a4fc05` moved exactly one score, **§12 Performance & Scalability Maturity 3→4**, because the `Performance gate (BenchmarkDotNet Short + baseline verify)` context is present in live `required_status_checks` on `main` (8 required contexts), refuting the twentieth wave's sole basis for holding it at 3; seven first-pass lifts (§4, §9, §11, §19, §20, §26, §29) were refuted and the remaining 26 categories re-confirmed.)
The wave-by-wave priority ranking below is the **historical single-axis review** (index 80%, 218/272, 2026-06-08/09); it is retained for provenance and is **superseded by the in-repo two-axis scorecard**, which is the live source of scores.
Tasks are ranked on **both scorecard axes**, one band per axis (two-axis policy adopted 2026-07-28):
- **Maturity band:** every applicable category scoring **maturity < 4**, ranked by **priority = (4 − maturity) × weight**.
- **Implementation band:** every applicable category scoring **implementation <= 8**, ranked by **implPriority = max(0, 9 − implementation) × weight**. The scheduling target is **9, not 10**, even though a 10 is awardable (recalibrated 2026-08-01: a 10 marks an almost perfect implementation, every criterion at reference quality with no red flags): ranking against 10 would put nearly every strong category in the band and drown the real gaps, so the 9→10 rung is recognition earned at re-score time, never scheduled work.

Higher priority = bigger weighted gap = more index points per unit of effort. A category leaves each band independently and reaches the protect list only at **maturity 4 AND implementation >= 9**. The indices keep their `× 4` and `× 10` denominators, so the trend line stays comparable across all twenty-five waves; the 9-target governs scheduling only, and the implementation index reads directly against 100% (the former 90%-attainable-ceiling framing is retired as of 2026-08-01).

**Scope:** the single-axis item counts below are historical (the wave-by-wave ranking is superseded by the two-axis scorecard, per the note above). Under the live two-axis scorecard there is **one N/A category**, §16 AI-Native Application Architecture (rubric v2, 2026-09-04, [ADR-110](../adr/110-rubric-v2-category-realignment.md): N/A until a product feature calls a model), so 33 of 34 categories are scored (§27 i18n is scored after ADR-027) and **30 of the 33 scored categories sit at Maturity 4** (#1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 32, 33, 34; #16 left this list on 2026-09-04 when rubric v2 made it N/A, not because anything regressed; **#22 and #23 joined 2026-07-15** on the nineteenth-wave re-score, **#25 and #33 joined 2026-07-17** on the twentieth-wave re-score, **#12 rejoined 2026-07-21** on the twenty-first-wave re-score when its perf gate became a required check, and **#9 joined 2026-08-22** on the in-repo contract-surface gates shipped in MMCA.Common PR #271); the open work is the **3 categories still below Maturity 4**. Ranked by two-axis priority = (4 − maturity) × weight: **#31** FinOps (Maturity 2, weight 2, computed priority 4) is the highest weighted gap but a documented accepted cap (see *Deliberate / accepted* below), not scheduled work; then the weight-2 Maturity-3 pack at **priority 2** (#17, #30).

> **Two fixes each clear multiple items: do them once:**
> - **MassTransit v8 guard** closes the medium red flags in **#32** *and* **#16**.
> - **bUnit component tests** lift **#28** *and* **#18** (and cover the #19 guard bug).

## Implementation band (implementation <= 8, ranked by implPriority)

Added 2026-07-28 when the ledger gained its second ranked axis. Until then implementation gaps were
never ranked or scheduled, which is why consecutive steady-state cycles moved neither index
and the gap between them (97.5% vs 86.3% today) looked like neglect. Ranked from the current scorecard
(2026-09-04 thirty-second wave: #7 enters the band at implPriority 3 on an Implementation 9→8
rubric-change deduction, and #31 drops from implPriority 4 to 2 on its Implementation 7→8 lift; #7, #12,
#13, #17 and #30 came back FLAG, and where the adversarial pass refuted the proposed lift the prior value
stands by merged-prior policy, while #4, #5, #11, #23, #24, #29, #31 and #34 re-confirmed fresh; prior
thirtieth wave, 2026-08-31: #8, #19, #25 and #26 closed at Implementation 9 and left the band, the band's
first closures since #10 on the twenty-fifth wave): **13 categories, 30 gap points** (12 categories / 29
points going into this cycle; the 2026-09-04 rubric v2 rebase retired the #16 row, struck through in the band).

Levers are cited only where the ledger or scorecard already records one; an unnamed lever is named
at the next re-score, never invented here. Three of these categories (#17, #30, #31) also sit in the
maturity band and keep their entries there; this band records only their implementation half.

| implPriority | # | Category | w | Impl | Recorded lever |
|---|---|---|---|---|---|
| 3 | #4 | Domain-Driven Design | 3 | 8 | not yet identified (a first-pass lift was refuted on the twenty-first wave and again on the thirty-first, 2026-09-01: the §4 fitness surface is byte-identical since v1.152.0, `EntityConventionTestsBase` and `ImmutabilityTestsBase` have no MMCA.Common subclass, and the Notifications family is still the only in-repo aggregate) |
| 3 | #7 | Microservices Readiness | 3 | 8 | name the **Anti-Corruption Layer** over the gRPC adapter convention (`Grpc/DependencyInjection.cs:58`: "register a hand-written adapter that implements the C# interface contract ... and delegates to this typed gRPC client"), and document the **Strangler Fig** extraction route (new path beside old, traffic moved, old path retired) in ADR-007/008, which today records a cutover instead ("Delete the combined `MMCA.ADC.WebAPI` host", `008-service-extraction-topology.md:33`). Entered the band 2026-09-04 (thirty-second wave) on the rubric-v2 criterion at `ArchitectureEvaluationCriteria.md:263` (added by `ADR-110:55`), not on lost work: Maturity 4 is unchanged and CI-enforced (`Rules/Layering/ArchitectureRules.Transport.cs:19` → `Bases/Layering/MicroserviceExtractionTestsBase.cs:13` → `MicroserviceExtractionTests.cs:11`, in `MMCA.Common.slnx:52`, run at `ci.yml:144`) |
| 3 | #11 | Security | 3 | 8 | not yet identified (a first-pass lift was refuted on the twenty-first wave; held-at-prior FLAGs recorded 2026-08-07 and again on the thirtieth and thirty-first waves, 2026-08-31 and 2026-09-01: the sample bicep's vault secret binding is still structurally incomplete (`secretRef: 'sql-conn'` with no `secrets:` array anywhere, `main.bicep:143`), ownership stays opt-in claim-trusting `OwnerOrAdminFilter` rather than ABAC, and the ADR-037 `EncryptedStringConverter` remains unadopted in Source; the only post-refutation security work, the complete default CSP, is a #26 item and closes neither #11 cap) |
| 3 | #29 | Resilience & Business Continuity | 3 | 8 | tested restores, RTO/RPO per service, and measured production SLOs, recorded by the framework's own guide as consumer-IaC work (`common-RESILIENCE.md:3,28`; anchor corrected 2026-08-01); the 8→9 lift was refuted on the twenty-first and twenty-fourth waves |
| 2 | #5 | Vertical Slice Architecture | 2 | 8 | not yet identified (an 8→9 proposal was refuted on the thirty-first wave, 2026-09-01: every recorded cap is still live and the unenforced Users family grew from 5 to 7 use cases) |
| 2 | #12 | Performance & Scalability | 2 | 8 | not yet identified (the 2026-08-07 cycle recorded a held-at-prior 8→9 with verdict FLAG: the only new-evidence candidate predates the 2026-08-01 re-score) |
| 2 | #13 | Observability & Operability | 2 | 8 | SLO-breach alerting with dashboards, plus runbooks for common failures, the two rubric criteria left to the deployer (the recorded reason the 8→9 lift was refuted on the twenty-fourth wave and on every cycle since; held at prior on FLAG on the thirtieth wave, 2026-08-31, the seventh consecutive refusal, on the thirty-first, 2026-09-01, the eighth, and again on the thirty-second, 2026-09-04, the ninth: Common's own sample IaC comments "SLO alerting" at `samples/deployment/main.bicep:155` while `:156` declares only a `Microsoft.Insights/actionGroups` resource, with no `metricAlerts` beside it (anchors corrected 2026-09-04), and the only runbook remains the #29 restore drill) |
| 2 | #16 | ~~Maintainability & Evolvability~~ | 2 | 8 | **Retired 2026-09-04 (rubric v2, [ADR-110](../adr/110-rubric-v2-category-realignment.md)): §16 is now AI-Native Application Architecture and N/A for this repo. The former category's coupling and tech-debt criteria score under #34, lockstep upgrades under #32, onboarding under #33. Struck through for the record; not counted in the band total.** |
| 2 | #17 | DevOps & Deployment | 2 | 8 | the bicep job is a compile check and is not among the required contexts (the recorded reason the 8→9 lift was refuted on the twenty-third wave, and a 4/9 proposal was refuted for the third consecutive cycle on 2026-08-07, on byte-identical evidence, and again on the thirty-first wave, 2026-09-01: no §17 source has changed since 2026-06-27 and only the `ci.yml` anchors moved, to `:719-724` and `:735,739`) |
| 2 | #23 | Front-End Performance | 2 | 8 | packaged-asset hygiene, named on the thirtieth wave (2026-08-31, held at prior on FLAG: the former grid-virtualization cap DID close at v1.175.0, but the `MMCA.Common.UI` wwwroot packs a 434 KB unreferenced app-specific speaker PNG and a 576 KB Bootstrap CSS source map with no `Content Remove` in the csproj; pruning both is the concrete lever; re-verified unchanged 2026-09-04, `wwwroot/images/speakers/miguel-wood.png` and `wwwroot/lib/bootstrap/dist/css/bootstrap.min.css.map` are both still packed). Also open under the same hold: no lazy-loading/code-splitting or CI payload budget, and INP unmeasured with gate ceilings 3-5x the package's own good-band defaults (a proposed 8→7 downgrade was refuted earlier; the score has been contested in both directions) |
| 2 | #24 | Forms, Validation & UX Safety | 2 | 8 | not yet identified (a proposed downgrade was refuted on the twenty-second wave) |
| 2 | #30 | Compliance, Privacy & Governance | 2 | 8 | not yet identified (#30 is also in the maturity band) |
| 2 | #31 | Cost Efficiency / FinOps | 2 | 8 | **Documented accepted cap, not scheduled work** (see *Deliberate / accepted*: now held at Maturity 2 / Implementation 8 by acceptance). Its Implementation half rose 7→8 on 2026-09-04 with the default-ON probe-telemetry filter and its span processor shipped in v1.182.0 (`Aspire/Extensions.cs:224,248`), so it drops out of implPriority 4 into this weight-2 group; it still ranks first on the maturity band, and leaving it visible is the point |
| 2 | #34 | Architecture Governance & Docs | 2 | 8 | the uncommittable workspace-root `ArchitecturalAnalysis.md` cap, recorded as unresolved (the 8→9 lift was refuted on the twenty-third wave and again on the thirty-first, 2026-09-01, held at prior on FLAG: the cap is unchanged and the living docs now contradict the gated package count, see the #34 heading below) |

---

## Progress: first wave (2026-06-08)

Implemented in MMCA.Common, ✅ **verified 2026-06-09**: `dotnet build -c Release` is clean (0 warnings / 0 errors, all analyzers) and all 9 test projects pass (~1,611 tests, 0 failures), including 28 architecture tests (3 new MassTransit fitness cases) and 90 UI tests (6 new bUnit tests). *No `GITHUB_TOKEN` is needed: MMCA.Common restores entirely from nuget.org.*

- ✅ **#32 / #16: MassTransit v8 fitness test.** `DependencyVersionTests` parses `Directory.Packages.props` and fails if the MassTransit major hits 9. *Remaining in #32: lock files, SBOM, CHANGELOG/versioning policy.*
- ✅ **#29 / #6: broker retry policy.** `ConfigureBrokerTransport` applies `UseMessageRetry` (exponential) on both RabbitMQ and Azure Service Bus, configurable via new `MessageBusSettings.RetryLimit` / `RetryMinIntervalSeconds` / `RetryMaxIntervalSeconds`; `IntegrationEventConsumer` comment + log corrected. *Delayed redelivery deliberately omitted (needs the RabbitMQ delayed-exchange plugin absent from the Aspire container). Remaining in #29: RTO/RPO, restore drill, alerting. Remaining in #6: consumer inbox/dedup + event Id.*
- 🟡 **#28 / #18, bUnit harness.** Added `bunit` (pinned **2.0.66**: v2 `BunitContext`/`Render` for xUnit v3), `BunitTestBase` (MudServices + loose JSInterop), and 6 passing tests for `EmptyState` + `MobileCardList`. *Remaining: MobileInfiniteScrollList + UnsavedChangesGuard tests, axe-core a11y, E2E-in-CI.*
- ✅ **#30: compliance boundary (partial).** `IAnonymizable` erasure extension point (Domain), `OutboxCleanupService` purging processed rows older than `Outbox:RetentionDays` (default 7), and **ADR-005**. *Remaining (consumer-side): make PII entities `IAnonymizable`, add erasure/DSR + export endpoints, stop logging PII.*

## Progress: second wave (2026-06-09)

✅ **Verified**: `dotnet build -c Release` clean (0/0) and all 9 test projects pass (1,511 tests, 0 failures).

- ✅ **#32 / #16: supply-chain.** NuGet **lock files** (`RestorePackagesWithLockFile`, 20 committed), `nuget.config` **packageSourceMapping** (`*`→nuget.org), **CycloneDX SBOM** step in `release.yml`, **CHANGELOG.md** + **VERSIONING.md** (SemVer + breaking-change + consumer-sweep policy). With the Wave-1 fitness test, #32 and #16 reach 4.
- ✅ **#11: security.** CI **vuln-audit gate** (`dotnet list package --vulnerable` + `NuGetAudit=all`) and **SECURITY.md** (security model, OWASP note, consumer responsibilities). *Item 13 (NetArchTest security invariants) deferred to consumer suites: infeasible as NetArchTest, and the framework's CORS / anonymous-endpoints are already correct.* **(2026-08-22 addendum: the deferral is superseded. The verdict was correct only for NetArchTest's fluent API; the rules landed as a full-name-reflection fitness base plus executable invariant tests over the real registration code. See the security invariants wave below.)**
- ✅ **#13: observability.** `AddMeter("MMCA.Common.Outbox")` (dead-letter counter now exported) + **CQRS RED histograms** (`cqrs.command/query.duration`, tagged by name + outcome) via `CqrsMetrics`, registered in Aspire `WithMetrics`.
- ✅ **#17: DevOps.** `.github/dependabot.yml` (nuget + actions, MassTransit-major ignored); symbols switched to **embedded** (orphan `snupkg` removed: verified via `dotnet pack`).
- ✅ **#34: governance.** Refreshed the stale DB-per-service passages in `Docs/Architecture/ArchitecturalAnalysis.md`; added **ADR-006** (database-per-service) + **ADR-007** (gRPC extraction) + **ADRs/README.md** index.
- ✅ **#9: contracts (partial).** Corrected the `ServiceContractAttribute` doc (no longer claims a framework test that doesn't exist; enforcement is the consumer's). *OpenAPI generation deferred.*

## Progress: third wave (front-end, 2026-06-09)

✅ **Verified**: build clean (0/0) and all 9 test projects pass (1,519 tests, 0 failures); UI tests 90 → 98 (8 new bUnit tests).

- ✅ **#19: UnsavedChangesGuard live-accessor.** Added optional `Func<bool>? IsDirtyAccessor`; the guard reads current dirty state at navigation time (`CurrentIsDirty`), fixing the one-render param-lag foot-gun. Additive/non-breaking; covered by bUnit tests.
- ✅ **#23: MobileInfiniteScrollList cap.** New `MaxRenderedItems` (default 500) bounds DOM growth: infinite scroll stops fetching at the cap. (`Virtualize` would conflict with the IntersectionObserver loader.) Covered by a bUnit test.
- ✅ **#28 / #18: bUnit coverage.** Added tests for `MobileInfiniteScrollList`, `UnsavedChangesGuard`, and the `PageError`/`PageLoading`/`PageHeader` primitives.
- ✅ **#20: design-system (partial).** Collapsed the duplicated `#1565C0` brand hex to the `--mmca-primary` / `--mmca-primary-dark` CSS vars (single CSS source) + a sync note in `MMCATheme`. *Bootstrap→MudBlazor NavMenu chrome migration deferred (riskier).*
- ✅ **#28 / #5: axe-core a11y.** Added `Deque.AxeCore.Playwright` (4.7.2) + a `Page.AssertNoAccessibilityViolationsAsync()` helper to the shipped E2E package (compiles here; the assertion runs in consumer E2E flows).

*Deferred (no host / larger / low value): browser-journey-in-Common-CI (Common is a library, no app to run E2E against), the Bootstrap NavMenu migration, and the EditorRequired convention check.*

## Progress: fourth wave (breaking changes + consumer sweep, 2026-06-09)

✅ **Verified across all three repos** (built/tested via `local.props` against Common *source*, no token): Common **1,523**, ADC **1,241**, Store **1,088** tests, **0 failures**; all CI solutions build 0/0.

- ✅ **#16: `UserNotification.Create` → `Result<UserNotification>`** (Common-internal; 4 call sites updated: no consumer code calls it).
- ✅ **#4 / #15: aggregate-factory fitness test.** `AggregateConventionTests` reflects over the Domain assembly asserting each aggregate root has a static `Create` returning `Result<T>`. Cross-aggregate-nav rule deliberately omitted (navigation-populator pattern, ADR-002). Consumers' 15 aggregates already comply.
- ✅ **#6 / #19: consumer-side idempotency (inbox).** `MessageId` on `BaseDomainEvent`/`IDomainEvent`; `InboxMessage` entity + EF config; `IInboxStore` (`EfInboxStore`/`NoOpInboxStore`) with dedup in `IntegrationEventConsumer`; **opt-in** `MessageBus:EnableInbox` (default off); `OutboxCleanupService` also purges processed inbox rows. Unit-tested.
- ✅ **5 EF migrations** (`AddInboxMessages`): ADC Identity/Conference/Engagement/Notification (per-service DBs) + Store (shared): each creates `InboxMessages` + the unique `MessageId` index, generated against Common source.

*Remaining (manual/opt-in): set `MessageBus:EnableInbox=true` per service once its migration is applied; optionally mirror the `Result`-return fitness assertion into ADC/Store `EntityConventionTests` (multi-assembly; they already comply). Publishing Common + bumping consumers off `local.props` is a release step (needs the feed/token).*

---

## Progress: v1.80.0 (2026-06-26)

> The single-axis backlog above is from the **2026-06-08/09** review (index 80%). The framework has since
> reached **v1.82.0** and the canonical scoring was the **in-repo, two-axis**
> [`ArchitectureScorecard.md`](../governance/common-ArchitectureScorecard.md)
> (**Maturity 92.2% / Implementation 82.9%** at that wave, current: **92.8% / 85.0%**, see the scorecard
> header). This entry records what shipped and the
> remaining framework-side follow-ups; it does not re-derive the single-axis priority ranking above.

- ✅ **#11 / #1: permission-based authorization (opt-in).** `IPermissionRegistry`/`PermissionRegistryBuilder`
  (Shared) + `[HasPermission]`/`PermissionPolicyProvider`/`PermissionAuthorizationHandler` (API), wired via
  `AddAuthorizationPolicies` + `AddPermissions`, backward-compatible with the named role policies; 13 unit
  tests. Adopted by ADC (≈20 endpoints + `RoleNames.ContentEditor`). RBAC-with-capability-indirection
  (policy-based, not resource/attribute-based).
- ✅ **#14 / #1: `TimeProvider` adoption.** Injected into `TokenService` (token `iat`/`nbf`/`exp`) and the
  notification read handlers; `UserNotification.MarkAsRead(DateTime readOnUtc)` now takes an explicit UTC
  timestamp. Registered `TimeProvider.System` singleton.
- ✅ **#34: ADR-019 (layered rate limiting)** documents the pre-existing authenticated-only global limiter;
  ADRs 017/018 committed; ADR set now **001-019**.

**Framework-side follow-ups:**
- ✅ **Rate-limiter partition/exemption tests** (#11/§ADR-019). `IsRateLimitBypassed`/`GlobalRateLimitPartition`
  are now `internal` (via `InternalsVisibleTo`) and `RateLimitPartitionTests` covers the bypass paths,
  anonymous-vs-authenticated branching, and the per-user partition-key fallback (name → user_id → IP →
  constant). *(2026-06-26)*
- ✅ **Controlled-clock notification handler tests** (#14). Both mark-as-read handler tests now inject a
  fixed `TimeProvider` and assert the stamped `UserNotification.ReadOn`. *(2026-06-26)*
- ✅ **`BaseDomainEvent.DateOccurred` ambient clock: accepted as deliberate, not removed** (#4). A domain
  event's occurrence instant *is* the moment the aggregate raises it, so the creation-time default is the
  correct event-sourcing / audit semantic (and four domain tests enforce it). Relocating the stamp to the
  SaveChanges boundary would shift occurrence-time → persist-time and regress that semantic; threading a
  clock through every aggregate is disproportionate. Documented as a deliberate choice in
  `BaseDomainEvent` rather than changed. *(decision 2026-06-26)*

---

## Progress: v1.81.0/v1.82.0 + governance pass (2026-06-26)

> Released since v1.80.0 (v1.81.0, v1.82.0) plus a sixth governance pass currently **in flight (uncommitted)**.
> All of it lands in categories already scored 9-10, so the two-axis indices were unchanged at that wave
> (**Maturity 92.2% / Implementation 82.9%**; current: **92.8% / 85.0%**); these are evidence/governance
> enrichments, not score-movers.

- ✅ **#9: Scalar OpenAPI UI (opt-in, released v1.81.0).** `MapCommonScalarUi()` renders `/scalar/{doc}`
  from the generated document, non-Production only, via the bundled `Scalar.AspNetCore 2.16.6` (no CDN).
  The committed-baseline drift gate stays deliberately consumer-owned (the API surface lives in the
  consumer hosts). §9 impl held at 9.
- ✅ **#31: `COST.md` FinOps note (released v1.81.0).** Consolidates the framework's cost levers
  (telemetry poll-span filtering, outbox poll/retention tuning) and the right-sizing / attribution /
  surge-revert defaults consumers set. Doc enrichment; §31 impl held at 6 (execution is consumer/IaC).
- ✅ **#11 / #26: RS256 pinned on the JWKS-forwarded auth path (v1.82.0).**
  `ValidAlgorithms = [RsaSha256]` on the forwarded-JWT validation path, matching the in-process pin.
- ✅ **#11 / #26: security-response headers centralized (ADR-023, uncommitted pass).** One pluggable
  middleware in `MMCA.Common.Aspire.Security` (`AddCommonSecurityHeaders` + `ICspPolicyProvider` +
  `SecurityHeadersMiddleware`, unit-tested) replaces per-host hand-rolled headers. §11/§26 impl held at 9
  (default static CSP deliberately omits `script-src`/`style-src` until a host registers a provider).
- ✅ **#34 / #16: FACTS.md now generated + CI drift-gated (uncommitted pass).** `build/facts` computes
  the framework facts from source; `ci.yml:27-28` runs `dotnet run --project build/facts -- . --check` as
  a drift gate, so version / package count / ADR range / fitness counts can no longer drift. The rubric
  (`ArchitectureEvaluationCriteria.md`) and `FACTS.md` are now version-controlled in-repo. ADR set now
  **001-023** (ADR-023 added). §34 impl held at 9 (residual: ArchitecturalAnalysis.md in the
  uncommittable workspace root; plus this pass is mid-commit).

**Open follow-up surfaced this cycle (governance hygiene, not a score-mover):**
- [x] **Commit the sixth governance pass**: ADR-023, the source-generated CI-drift-gated `FACTS.md` +
  `build/facts`, the in-repo rubric, and this two-axis scorecard all shipped in **v1.83.0** (`b9a6a28`),
  resolving the prior cycle's "ADR-023 uncommitted" §34 caveat. *(Done 2026-06-27.)*
- [~] **Backfill the CHANGELOG and commit the docs pass.** *Partly addressed, superseded by the
  v1.85.0 follow-up below:* a `[1.85.0]` CHANGELOG entry was added (commit `f224595`), but **v1.83.0 and
  v1.84.0 still have no release notes** and the v1.85.0 docs governance pass (ADRs 024/025/026, the
  `FACTS.md` ADR-count bump, ADR cross-links, this scorecard/backlog) is still uncommitted. Tracked now
  under "Progress: v1.85.0 → Open follow-up". *(§34, transient hygiene nit, effort S.)*

---

## Progress: v1.83.0/v1.84.0 (2026-06-27)

> Released since v1.82.0 (v1.83.0, v1.84.0) plus a docs-only governance pass currently **in flight
> (uncommitted)**. **One score moved at this wave**: §30 Implementation 7→8. The canonical scoring at
> v1.84.0 was **Maturity 92.2% / Implementation 83.1%** (was 82.9%) per the in-repo
> [`ArchitectureScorecard.md`](../governance/common-ArchitectureScorecard.md); the v1.85.0 eighth wave below then took it to
> **92.8% / 85.0%**.

- ✅ **#30: `PiiRedactor` log-masking shipped (v1.84.0, score 7→8).** `Domain/Privacy/PiiRedactor.cs`
  masks every `[Pii]`-marked member (shallow, value-erasing, `[REDACTED]` token, per-type reflection
  cache) before an entity carrying personal data reaches a structured log or telemetry attribute:
  closing the §30 red flag the rubric names verbatim ("PII in logs/telemetry"), previously
  documented-but-missing. Covered by **7 `PiiRedactorTests`** (incl. "never emits the clear-text PII
  values"). §30 **maturity holds at 3**: DSAR/export endpoints, consent capture, the personal-data
  inventory, residency verification, and retention *execution* stay consumer-owned, and
  `PiiConventionTests` still passes vacuously in-repo (no PII-carrying type lives here; no fitness
  function forces types through the redactor).
- ✅ **#34: sixth governance pass committed (v1.83.0).** ADR-023 (security-response headers), the
  source-generated CI-drift-gated `FACTS.md` + `build/facts`, the in-repo rubric, and the two-axis
  scorecard all shipped, resolving the prior "ADR-023 uncommitted" caveat. §34 holds at M4/I9.
- ✅ **#13 / #29: warm-up / readiness subsystem documented (ADR-025).** `WarmupHostedService` +
  `WarmupReadinessGate` + `OpenIdConnectMetadataWarmupTask` (wired into `AddServiceDefaults`) gate
  `/health/ready` until startup warm-up runs, holding cold replicas out of rotation (gate opens even on
  task failure = availability over warmth, lazy-retry under ADR-009). **Enrichment, not a score move:**
  §13 holds at I9 and §29 holds at 3/7 because the subsystem ships **without unit tests** and the §29
  recovery gaps (restore drill, RTO/RPO, SLOs) are unchanged. *(See the new #29 follow-up below.)*
- ✅ **#6: two-channel notifications documented (ADR-024).** The pre-existing SignalR-push + durable
  `UserNotification`-inbox extension points (`IPushNotificationSender`/`INotificationRecipientProvider`, no-op
  defaults) are now formally recorded. §6 evidence enriched, no move.

**Framework-side follow-ups surfaced this cycle:**
- [x] **#29: unit-test the warm-up/readiness subsystem.** *RESOLVED in the eighth wave (v1.85.0):*
  `Tests/Hosting/MMCA.Common.Aspire.Tests/Warmup/{WarmupReadinessGate,WarmupHostedService,WarmupReadinessHealthCheck}Tests.cs`
  now cover the gate latch/idempotency/thread-safety, the hosted service running each `IWarmupTask`
  once + opening the gate even on task failure, and the health-check transitions. This converted
  "warm-up exists" into "warm-up verified" and lifted §29 Implementation 7→8.

---

## Progress, v1.85.0 (eighth wave: under-8 Implementation remediation, 2026-06-27)

> The under-8 Implementation remediation (commit `78e5312`, **tag `v1.85.0`**, HEAD `7082a5f`) lifted
> every category scored Implementation < 8 with shipped, tested in-repo evidence, and additionally moved
> one maturity score. Re-verified against current source. Canonical scoring is now
> **Maturity 92.8% / Implementation 85.0%** per the in-repo
> [`ArchitectureScorecard.md`](../governance/common-ArchitectureScorecard.md) (was 92.2% / 83.1%). Full Release build clean
> (0 warnings); 1651 tests pass.

- ✅ **#5, Vertical Slice: Implementation 7→8 AND maturity 3→4.** `ArchitectureRules.Slices.cs` +
  `SliceCohesionTestsBase` (shared `MMCA.Common.Testing.Architecture`, the 18th fitness base) + a Common
  `SliceCohesionTests` subclass fail the build if a use-case slice's handler/validator is stranded from
  its same-assembly command/query contract. Because this is **automatic CI enforcement of the slice
  convention**, §5 now meets the rubric's maturity-4 "enforced automatically by tests/CI" bar (like every
  other fitness-gated category): the one maturity move this cycle. §5 moves to the level-4 protect list.
- ✅ **#12, Performance: Implementation 7→8.** `Tests/Performance/MMCA.Common.Benchmarks` (BenchmarkDotNet
  smoke harness, outside the `.slnx`) makes hot-path spec efficiency *measured, not assumed*; the
  max-page-size guard already shipped at v1.84.0.
- ✅ **#17, DevOps: Implementation 7→8.** Reference `samples/deployment/{foundation,main}.bicep`
  (Container Apps + ACR-via-managed-identity + Key Vault + SQL + cost tags + budget; lint clean via
  `az bicep build`) + `DEPLOYMENT.md` (OIDC federated-credential + UAMI bootstrap + smoke-gate/auto-rollback).
  Held at 8: a library can't self-deploy; full CD-to-Azure lives in consumer repos.
- ✅ **#24, Forms/Validation: Implementation 7→8.** Register/Login converted to `EditForm` +
  `DataAnnotationsValidator` + per-field `ValidationMessage` over typed `RegisterModel`/`LoginModel`
  (`PasswordComplexityAttribute` mirroring the server rule), closing the "errors not tied to the input"
  red flag; `AuthModelValidationTests` + `RegisterFormTests` cover it.
- ✅ **#25, Navigation: Implementation 7→8.** In-shell `Pages/Forbidden.razor` (403) wired into
  `Routes.razor` (NotAuthorized→`<Forbidden/>`) + `NavigationFlow.md` documenting the Common UI route/role
  model; `ForbiddenTests` cover it.
- ✅ **#29, Resilience: Implementation 7→8.** Warm-up subsystem now unit-tested (above) + `RESILIENCE.md`
  (baseline SLO/error-budget template + restore-drill runbook reference). Maturity held at 3: the drill
  itself executes in consumer IaC; no in-repo measured RTO/RPO or SLO.
- ✅ **#31, FinOps: Implementation 6→7.** OTel `Telemetry:TracesSampleRatio` →
  `ParentBasedSampler(TraceIdRatioBasedSampler)` knob (unit-tested, the biggest trace-ingestion lever) +
  outbox per-message log moved Information→Debug + `COST.md` cost-attribution-tag/cost-guard samples.
  Maturity held at 2: right-sizing/attribution/reversible-scale is consumer/IaC.
- ✅ **#9 / #34: `ServiceContractAttribute` doc-comment corrected.** It no longer claims a dedicated
  `[ServiceContract]` architecture test exists in each consumer solution; it now states the contract-purity
  invariant is upheld by the transport/layer-purity fitness rules (ADR-015) and that the attribute is an
  available documentation marker no contract type carries yet: closing the long-standing #9 "documents a
  test that doesn't exist" sub-item (§9 already impl 9, no score move).
- ✅ **#10 / #34: ADR-026 (two-tier caching strategy) added.** Documents the `ICacheService` substrate
  (startup-time memory-or-distributed swap via `AddCaching`) + the HTTP output-cache edge, and the
  TTL-backstopped best-effort prefix invalidation: formalizing pre-existing §10 code (no score move).

**Open follow-up surfaced this cycle (governance hygiene, not a score-mover):**
- [x] **Commit the v1.85.0 docs governance pass + backfill the CHANGELOG.** ~~ADRs 024/025/026 are
  untracked, the `FACTS.md` ADR-count bump (23→26) + ADR-003/004/005/010/015 cross-links + the
  `ServiceContractAttribute` doc-fix are modified, and **this scorecard/backlog refresh** is uncommitted.
  The CHANGELOG now carries a `[1.85.0]` entry but still **lacks v1.83.0 and v1.84.0** sections (and
  `[Unreleased]` is empty), so those two releases have no notes.~~ **DONE (verified 2026-07-25):** the
  CHANGELOG carries the backfilled `## [1.83.0] - 2026-06-26` (`CHANGELOG.md:1211`) and
  `## [1.84.0] - 2026-06-27` (`:1200`) sections, `[Unreleased]` is empty above `## [1.128.0] - 2026-07-25`
  (`:7-9`), ADRs 024/025/026 are committed in `Website/docs-src/adr/`, and the MMCA.Common tree is clean
  at tag v1.128.0. *(§34, transient hygiene nit, effort S.)*

---

## Progress, v1.86.0→v1.92.0 (ninth wave: i18n + re-score, 2026-06-29)

> Re-scored against current source at framework **v1.92.0** (HEAD `93ffcac`, dirty tree). Canonical scoring
> is now **Maturity 91.7% / Implementation 84.1%** (was 92.8% / 85.0%) per the in-repo
> [`ArchitectureScorecard.md`](../governance/common-ArchitectureScorecard.md). **Five scores moved**: one new category (§27),
> one offsetting maturity regression (§23), and three closer-evidence recalibrations (§11, §22, §30-reviewed).
> Both indices dip slightly: honest re-calibration plus a newly-scored immature category, not regressed work.

- ➕ **#27: i18n flipped N/A → Maturity 2 / Implementation 6 (NEW open item).** Multi-locale i18n
  (en-US + Spanish) now ships *in the framework itself* (ADR-027, superseding the single-locale ADR-011):
  co-located `.resx` + `IStringLocalizer<T>`, edge error localization keyed by `Error.Code`, a culture
  cookie forwarded as `Accept-Language`, and `User.PreferredCulture`. The last N/A category is now scored,
  so all 34 count. *Gap (the freshest in-repo gap, weight 1, priority 2):* no missing-key/translation-coverage
  CI gate, no pseudo-localization pass, culture-less formatting guarded only by an advisory analyzer
  (`MA0076`). *(See the Priority-2 #27 item below.)*: `Shared/Globalization/SupportedCultures.cs:18`;
  `API/Localization/ErrorResourceSource.cs` + `*.es.resx`; `UI/Components/CultureSwitcher.razor`.
- 🔻 **#11: Security Implementation 9→8 (recalibration; still Maturity 4).** "Strong", not "Exemplary":
  vault/managed-identity secret binding is deployer-owned and authz is RBAC-with-capability-indirection,
  not resource/attribute-based. *Enriched this wave (no further move):* ADR-032 PBKDF2-HMAC-SHA512 password
  hashing (`PasswordHasher.cs`, 600k iterations + legacy-salt migrate + `FixedTimeEquals`, 11 tests) and
  ADR-029 brute-force protection now documented.
- 🔻 **#22: Responsive Implementation 8→7 (recalibration).** Cross-browser gate is chromium-only
  (firefox/webkit advisory), the 48px touch-target rule is cart-drawer-scoped, no density options. Already
  tracked consumer-assessed; no new item.
- 🔻 **#23: Front-End Performance Maturity 4→3 (recalibration).** The patterns are convention/review-enforced,
  not automatically gated or measured (no Core Web Vitals/Lighthouse anywhere). Already an open Priority-2
  item (#23); the regression aligns the backlog with reality.
- ◐ **#29: broker retry sub-items now CLOSE.** `ConfigureBrokerTransport` applies `cfg.UseMessageRetry`
  (exponential) on **both** RabbitMQ (`DependencyInjection.cs:432`) and Azure Service Bus (`:449`); the
  `IntegrationEventConsumer` comment + the doc-comment are corrected. The Priority-3 #29 descriptive text
  ("no `UseMessageRetry`") is **drifted** and corrected below. `UseDelayedRedelivery` stays deliberately
  omitted (`DependencyInjection.cs:408`, accepted). **Category #29 itself stays open at Maturity 3** on the
  unchanged recovery gaps (no in-repo RTO/RPO, drilled restore, SLOs).
- ◐ **#30: PII erasure contract now gated; Maturity held at 3 (reviewed).** A new
  `PiiErasureContractFitnessTests` build gate forces a `[Pii]` `DataSubjectSample` through `PiiRedactor` +
  `IAnonymizable` (`Tests/Architecture/.../PiiErasureContractFitnessTests.cs:19-40`), closing the prior
  "vacuous PII guard" sub-item. **Maturity was reviewed and held at 3** (not lifted to 4): the gate verifies
  the erasure *mechanism*, but the structural `PiiConventionTests` scan is still vacuous (no PII-bearing type
  in Common's Domain) and the broad §30 governance (DSAR/consent/residency/retention/inventory) is
  consumer-resident. See the #30 clarification below.
- ✅ **Evidence enrichment, no score move:** ADR-028 day/dark theme (§20, wired toggle, raw-hex/`!important`
  deductions hold), ADR-030 startup sole-migrator (§8/§17: runtime self-migration, not the CI migration-apply
  gate those gaps name), ADR-031 feature-flag management (§10). ADR set grew 026→032; `FACTS.md` fitness
  counts advanced (71 methods/18 bases, Common runs 38).

**Open follow-up surfaced this cycle (governance hygiene, not a score-mover):**
- [x] **Commit the v1.86.0→v1.92.0 docs/source pass.** **DONE 2026-06-30** (commit `5321aee`): ADR-032 +
  the modified ADRs 001/007/008/017/020/022/030 + `ADRs/README.md` + `FACTS.md` + the
  `WebApplicationExtensions.cs` rate-limiter-ordering edit committed; §34 traceability consistent again.

---

## Progress: tenth wave (focused in-repo remediation, 2026-06-30)

> Four scores moved **up** on shipped, tested in-repo evidence; both indices rose for the first time in
> several waves: **Maturity 91.7% → 92.9%** (301/324), **Implementation 84.1% → 84.9%** (688/810). Full
> Release build clean (0/0); 1670 unit/arch/bUnit tests + 12 chromium E2E pass. Commits `21fbdf9` (§27),
> `c04f456` (§29), `a28ce98` (§28), `fbb463b` (§21).

- ✅ **#27, i18n: Maturity 2→3, Implementation 6→7.** Closes the two ADR-027 §7 follow-ups the scorecard
  named. (a) **Translation-coverage fitness gate:** `ResourceTranslationsAreComplete` (shared
  `MMCA.Common.Testing.Architecture`, the 19th fitness base) run as `LocalizationResourceTests` against
  `SupportedCultures.All` fails the build if any base `.resx` under `Source/` lacks a complete, non-empty
  sibling for a required culture, so coverage is verified not assumed. (b) **Culture-less formatting is now a
  build gate:** `MA0076` raised `suggestion`→`error` in `.editorconfig`; the 33 surfaced sites (validation
  messages, gRPC error details, UI log/notification text, tests) now use explicit `InvariantCulture`. ADR-027
  §7/§8 document both gates plus a locale-addition governance step. Held below M4: no pseudo-localization
  pass, only two locales.
- ✅ **#29, Resilience: Maturity 3→4.** The in-repo restore drill (`DatabaseRestoreDrillTests`) runs on
  **every CI build** (a build gate in the unit tier, NOT a non-gating scheduled cron, which is the standard
  that keeps a scheduled drill at M3), and `RESILIENCE.md` now records the framework's **measured** restore
  baseline (~5 ms median RTO over 5 runs, 0-row RPO byte-for-byte asserted). The recovery procedure is thus
  demonstrated, measured, and automatically enforced in-repo, meeting the M4 bar. Implementation held at 8:
  production RTO/RPO against real cloud backups + measured production SLOs stay consumer IaC.
- ✅ **#28, Front-End Testing: Implementation 8→9.** Closes "no visual-regression layer" with a
  **render-snapshot (golden-markup) regression** tier: `MarkupSnapshot` (shipped in `Testing.UI` for consumer
  reuse) normalizes per-render MudBlazor GUIDs and diffs shared-primitive markup against committed baselines
  (`PrimitivesSnapshotTests`, 5 baselines), failing the build on an unintended structural change. Deterministic
  and OS-independent (markup, not pixels), so it runs in the in-solution unit tier on every CI platform with
  no per-platform golden management (the Windows-dev-box-cannot-produce-Linux-CI-pixel-goldens constraint).
- ✅ **#21, Accessibility: Implementation 8→9.** Broadened the chromium axe gate to the **loading
  (named progressbar) and error (alert) component states**, and added `ACCESSIBILITY.md` (documented manual
  screen-reader pass: landmarks/focus-order/ARIA-names/form-error association). Broadening the scan **found
  and fixed a real WCAG 4.1.2 defect**: `PageLoadingState` carried a prohibited `aria-label` on a bare `<div>`
  around an anonymous progressbar (now `role="status"` + a named spinner).

**Open follow-ups surfaced this wave:**
- [x] **#20 dark-mode palette contrast (Implementation, NEW).** The §21 dark-mode axe prototype found the
  dark palette's **filled-primary button label** and **error-alert message text** fail WCAG AA contrast
  (`PaletteDark.Primary`/`Error` paired with auto-computed text). Tracked here (documented in
  `ACCESSIBILITY.md`), deliberately NOT gated yet; tuning the dark palette is the remediation. *(§20, M.)*
  **RESOLVED 2026-07-11 (remediation wave 1):** `PaletteDark.PrimaryContrastText`/`ErrorContrastText`
  are now dark (`rgba(0,0,0,0.87)`, the Material dark-theme treatment, mirroring the standing
  `WarningContrastText` fix); the dark-mode axe scan is GATED (`DarkModeE2ETests` in the blocking
  chromium `ui-e2e` job: Login + Components re-scanned dark, reproduced both failures pre-fix, green
  post-fix). `ACCESSIBILITY.md` known-limitations updated. This is also the recorded §21 path back to
  Implementation 9 (re-score at the next cycle).
- [~] **Release done, sweep noted (deliberate).** The tenth wave was **released as `v1.93.0`** (git tag at
  HEAD `3e72bfa`; `FACTS.md` records it). Sweeping all 13 packages into ADC/Store/Helpdesk is the separate,
  cross-repo step and is **not verifiable from this repo** (memory records the sweep on 2026-06-30; confirm
  in each consumer's `Directory.Packages.props`). *(§16/§34.)*

---

## Progress: eleventh wave (ADR governance, 2026-06-30)

> **No score moves.** A full 34-category evidence re-score at framework **v1.93.0** (HEAD `3e72bfa`, dirty
> tree) re-confirmed every category at its tenth-wave value; indices hold at **Maturity 92.9% (301/324) /
> Implementation 84.9% (688/810)**. The wave records two pre-existing mechanisms as ADRs and syncs the
> scorecard/`FACTS.md` prose; no remediation lever moved.

- ✅ **ADR-033 + ADR-034 written (governance, no score move).** Both document mechanisms that **already ship
  in framework code**: ADR-033 (resource-ownership authorization) records the `OwnerOrAdminFilter` +
  `OwnershipHelper` axis (single-resource 403 on a `customer_id`-claim mismatch + an ownership `Specification`
  row-scoping collection queries, one admin bypass; opt-in, claim-trusting, not ABAC, Store-adopted), and
  ADR-034 (generic entity controllers + dynamic query contract) records the `EntityControllerBase` /
  `AggregateRootEntityControllerBase` generic REST surface + OData-lite query contract. ADR-033 is the
  resource-ownership criterion §11's Implementation-8 cap named, but it stays ownership-not-ABAC + opt-in, so
  **§11 correctly holds at I8** (watch-item, not a lever).
- ✅ **Scorecard + `FACTS.md` prose synced to ADR set 001-034** and **72 fitness methods / 19 bases** (Common
  runs 39); the stale §16/§34 ADR-count and Top-strength fitness/test counts were corrected.

**Open follow-up surfaced this wave (governance hygiene, not a score-mover):**
- [x] **#34: commit the ADR 033/034 docs pass.** The tree is dirty (ADRs 033/034 added; ADRs 015/026/030 +
  `ADRs/README.md` + `FACTS.md` modified) while the scorecard/backlog now reference 001-034, the recurring
  per-cycle traceability nit, resolves on commit. *(§34, effort S; #34 holds M4/I9.)* **RESOLVED 2026-07-03
  (fourteenth wave):** the working tree is clean at v1.101.0 (HEAD `5e55be2`), ADRs through 036 are committed,
  and `FACTS.md` matches the tag.

## Progress: twelfth wave (under-8 Implementation lift, v1.94.0 pending, 2026-06-30)

> **Two Implementation scores move up**, Maturity holds: **Implementation 84.9% → 85.3% (691/810)**,
> **Maturity 92.9% (301/324)** unchanged. Full Release build clean, **1685 tests pass**. Held for review
> at this writing (v1.94.0 not yet tagged), so the tree is dirty against v1.93.0.

- [x] **#22 · Responsive & Cross-Browser: Implementation 7→8.** Closes the two execution gaps the prior 7
  named: (a) **grid density options** now ship on `DataGridListPageBase` (`DenseGrid` + `ToggleDensity()`,
  round-tripped through `ListPageState` / URL key `d` / sessionStorage, unit-tested in
  `ListPageStateServiceTests` + `ListPageQueryStateServiceTests`); (b) the **48px touch target is generalized**
  from the cart-drawer-only rule into a shared `.mmca-touch-target` affordance (cart drawer + mobile cards +
  data-grid pager), enforced by a phone-viewport Playwright bounding-box test (passes locally, 13/13 UI E2E);
  (c) a **`RESPONSIVE.md`** device/breakpoint/browser matrix is documented (closing the "matrix implicit" note),
  referenced from `CLAUDE.md`. *Maturity held at 3: firefox/webkit still advisory (chromium-only blocking gate).*
- [x] **#27 · Internationalization · Implementation 7→8.** A real **pseudo-localization pass** ships:
  `PseudoLocalizer.Transform` (accents every letter, ~40% padding, bracket sentinel, preserves `{0}`
  placeholders) applied by a `PseudoStringLocalizer`/`PseudoStringLocalizerFactory` decorator over
  `IStringLocalizerFactory` (registered in `AddUIShared`, inert unless the pseudo culture is active),
  activated by a **Development-only `qps-Ploc` culture** wired into `UseCommonRequestLocalization` +
  `MapCultureEndpoint` + the `CultureSwitcher`, with `SupportedCultures.PseudoLocale` deliberately kept out of
  `All` so the translation-completeness gate is unaffected. Unit-tested in `PseudoLocalizationTests`. Closes
  the pseudo-localization gap the prior 7 named. *Maturity held at 3: only two locales ship and the pseudo
  pass is a dev diagnostic, not a CI gate.*
- [x] **#27 · Internationalization · Maturity 3→4 + Implementation 8→9 (fifteenth wave, 2026-07-03, i18n
  completion train; ADR-027 Decision 9).** Both remaining holds are closed with CI-enforced evidence:
  (a) the pseudo pass is now a REQUIRED CI gate (`PseudoLocalizationE2ETests` in the blocking chromium
  `ui-e2e` job: `[!!` sentinel round-trip + no horizontal overflow under ~40% expansion on `/login`,
  `/register`, `/components`, plus an `en-US` leak guard; the gallery host enables `qps-Ploc`
  unconditionally as unpackaged test infrastructure); (b) a second fitness gate
  (`LocalizedTextConventionTests`, subclassing the new shared `LocalizedTextConventionTestsBase`) fails
  the build on hard-coded snackbar/title/`<PageTitle>`/breadcrumb/`NavItem` literals. Implementation 9:
  MudBlazor chrome localized (`ResxMudLocalizer` + `MudTranslations.{resx,es.resx}`, all 145 built-in
  keys en+es, DI-resolution-tested); the framework's own chrome fully externalized (`SharedResource` 22→136
  keys: NavMenu, auth pages, error/empty/loading states, ReconnectModal, notification pages, UI.Web SSR
  Error page); `ErrorMessages.Success` fragment concatenation `[Obsolete]` (whole-sentence page keys);
  `Common.Error.*` no longer surfaces raw `ex.Message`; `NavItem.TitleResource` culture-aware nav;
  `LocalizationResourceTests` non-vacuous floor (`MinimumBaseResources = 3`). *Held below 10: two
  locales, no RTL. §27 joins the protect set at M4/I9.*
- [accepted] **#31 · Cost Efficiency / FinOps: Implementation deliberately capped at 7 (not chased).** A
  documented structural acceptance, not an open lever: the two unmet §31 criteria, **right-sizing** and
  **reversible scale-events**: are consumer/IaC execution a NuGet library provisions nothing to perform, and
  **per-service cost attribution** via Aspire resource annotations is inert for the hand-written-`main.bicep`
  consumers (ADC/Store), so even the one library-addressable criterion does not move the score for the actual
  consumers. The in-repo levers are already shipped (`Telemetry:TracesSampleRatio` sampler, outbox-log trim to
  Debug, `COST.md` attribution-tag + cost-guard samples). Further movement is a consumer-side lift, not an
  in-repo one. *(§31 holds M2/I7; see `COST.md` and the §31 scorecard row.)*

**Deferred follow-up (recorded, not done this wave):**
- [~] **#22: promote firefox (then webkit) from advisory to a blocking cross-browser gate** once observed
  reliably green, to lift §22 Maturity 3→4. *(`ci.yml:89`; effort S, gated on a green streak.)*
  **FIREFOX PROMOTED 2026-07-12 (remediation wave 5):** `ui-e2e`'s `continue-on-error` now exempts only
  webkit; firefox is a required merge gate alongside chromium (observed clean over the recent main-run
  streak). **Webkit stays advisory** (2 flaky reds in its last 10 main runs, 2026-07-11 09:59 and
  2026-07-12 00:45); promote it once it holds a comparable streak. §22 Maturity 3→4 candidacy recorded
  for the next re-score (the recorded lever named the firefox promotion as the move, with webkit staged).

---

## Progress - fourteenth wave (clean-tree evidence re-score at v1.101.0, 2026-07-03)

> A full 34-category, two-pass evidence re-score (per-category scorer plus adversarial verifier) at framework
> **v1.101.0** (HEAD `5e55be2`, working tree **clean**: the recurring uncommitted-docs caveat is closed).
> **Two scores moved.** Canonical scoring is now **Maturity 94.1% (305/324) / Implementation 83.6% (677/810)**
> per the in-repo [`ArchitectureScorecard.md`](../governance/common-ArchitectureScorecard.md) (was 93.5% / 84.0%). Four further
> first-pass downgrade proposals were not applied: §25 (I8 to 7) and §34 (M4/I8 to M3/I7) were refuted by the
> adversarial verifier, and §7/§9/§13 (each I9 to 8, band recalibrations) were declined on review (kept at I9);
> those rows received evidence corrections only.

- ✅ **#24 · Forms, Validation & UX Safety: Maturity 3→4 (CLOSED, moved to the level-4 protect list).** The
  shared auth-form convention is enforced automatically in the CI-gated `.slnx` unit tier:
  `Tests/Presentation/MMCA.Common.UI.Tests/Pages/Auth/AuthModelValidationTests.cs` (8 facts:
  required/email/complexity/password-match) plus `RegisterFormTests.cs` (the per-field `ValidationMessage`
  renders on an empty submit and the auth service is never invoked), meeting the rubric M4 "enforced
  automatically by tests/CI" bar, consistent with §19's M4 on the same CI-gated guard tests. *Caveat recorded:
  the shared `FormsConventionTestsBase` (`Testing.Architecture/Bases/FormsConventionTestsBase.cs:41,51`) is
  consumer-scoped (it enumerates create forms under `Source/Modules`, absent in Common, and no Common subclass
  exists), so the in-repo M4 rests on the bUnit/model tests, not that fitness base.*
- 🔻 **#14 · Testability: Implementation 9→8 (band recalibration, no work regressed).** The row's own stated
  reasoning (a modest 53% gated coverage floor, no mutation testing) describes the rubric's Strong band (7-8)
  while 9 sits in Exemplary, so 8 is the internally-consistent value. Maturity holds at 4. Path back to 9:
  ratchet the coverage floor upward and add mutation testing on the Core tier.
- ✅ **#34 follow-up (commit the ADR 033/034 docs pass) RESOLVED.** Clean tree at v1.101.0 (HEAD `5e55be2`);
  ADRs through 036 committed, `FACTS.md` matches the tag. Ticked in the eleventh-wave section above.
- ◐ **Evidence-cell corrections, scores unchanged:** §7 (the extraction rule body lives in the shared
  `Testing.Architecture` package: `ArchitectureRules.Transport.cs:19` plus `Bases/MicroserviceExtractionTestsBase.cs:13`,
  subclassed at `MicroserviceExtractionTests.cs:10`); §9 (`Scalar.AspNetCore` is 2.16.7 at
  `Directory.Packages.props:24`, not 2.16.6 at `:17`); §13 (drifted `Aspire/Extensions.cs` anchors re-pointed
  to `:37/:92/:147-148/:161/:264/:268/:277/:306/:314`, and the stale "warm-up ships without unit tests"
  hold-reason removed: 9 warm-up tests have existed since the eighth wave, so the hold at I9 rests solely on
  deployer-owned SLO alerting/dashboards/runbooks).

## Progress - defect-fix wave C-1..C-7 (2026-07-05)

Seven approved defect fixes, each behavior change landed with its pinning test flipped (or a new
regression test) in the same change; build 0/0 and the full `.slnx` suite green. One new test-only
package: `Microsoft.Extensions.TimeProvider.Testing` 10.7.0.

- ✅ **C-1 (security, §11)** `LoginProtectionService`: clamped the exponential-backoff shift exponent
  (excess >= 31 formerly yielded negative or wrapped lockout TTLs); backoff theory extended with deep rows.
- ✅ **C-2** `OAuthControllerBase.CompleteAsync`: safe `returnUrl` lookup with `/` fallback instead of
  `KeyNotFoundException` when the ticket lacks the item; regression test added.
- ✅ **C-3 (§13)** `LoggingQueryDecorator`: business failures now record `outcome=failed` on
  `cqrs.query.duration` plus a warning log (parity with the command decorator); the pin documenting
  the old asymmetry as intentional was flipped.
- ✅ **C-4 (BREAKING)** `ChildEntityServiceBase`: derives from `AuthenticatedServiceBase` and attaches
  the Bearer token on POST/DELETE; ctor now requires `ITokenStorageService` (consumer subclasses must
  pass it in the release sweep).
- ✅ **C-5** `EntityServiceBase.GetAllForLookupAsync`: `nameProperty` now `Uri.EscapeDataString`-escaped;
  escape-needing test added.
- ✅ **C-6** `OutboxCleanupService`: optional trailing `TimeProvider` ctor param (defaults to System);
  the purge sweep is now deterministically unit-tested with `FakeTimeProvider` over in-memory SQLite
  (old processed rows purged, newer/pending survive, per-source error isolation, `EnableInbox` gate).
- ✅ **C-7** `SessionCookieAuthenticationHandler`: expiry check moved from `DateTime.UtcNow` to the base
  handler's `TimeProvider`; deterministic fake-clock expiry test added.

---

## Progress: sixteenth wave (clean-tree re-score at v1.106.0, 2026-07-06)

> A full 34-category, two-pass evidence re-score (per-category scorer plus adversarial verifier) at framework
> **v1.106.0** (HEAD `6f8b917`, one commit past the v1.106.0 tag, working tree **clean**). **One score moved.**
> Canonical scoring is now **Maturity 94.4% (306/324) / Implementation 84.1% (681/810)** per the in-repo
> [`ArchitectureScorecard.md`](../governance/common-ArchitectureScorecard.md) (was 94.4% / 83.7%).

- ✅ **#14 · Testability & Test Strategy: Implementation 8→9.** The fourteenth wave capped §14 at 8 on
  "a modest 53% gated coverage floor"; that floor was ratcheted **53.0 → 68.3** (`.github/workflows/ci.yml:226`,
  commit `b75fa8f`, measured ~70.3%) and the suite grew from 1586 to **1880** `[Fact]`/`[Theory]` across
  **262** files via a coverage-driven program that found and fixed **seven real defects** (C-1..C-7, `55f3cab`),
  so the top band is now supported. Maturity holds at 4 (CI-gated fitness tests, the blocking coverage-floor
  gate, and the zero-discovery min-tests guard). Held below 10 by the one remaining Exemplary gap: no mutation
  testing on the Core tier. §14 stays on the level-4 protect list.
- ◐ **#34 · Architecture Governance & Docs: held at M4/I8 (adversarial 8→7 declined).** The re-score's
  adversarial pass proposed docking §34 to Implementation 7 because the scorecard's own prose was stale against
  the CI-gated `FACTS.md` (it self-dated v1.101.0 / ADRs 001-036 while `FACTS.md` reports v1.106.0 / 001-038).
  That staleness is cured by this very refresh (the rewritten scorecard is current at commit time); the durable
  Strong-8 cap remains the uncommittable `ArchitecturalAnalysis.md` in the workspace root. Evidence refreshed to
  ADR set **001-038** and **78 fitness methods / 25 bases (Common runs 40)**.
- ◐ **Evidence enrichment, no score move:** ADR-037 (field-level encryption at rest: `EncryptedStringConverter`
  ships but is explicitly latent/unadopted, §11/§30) and ADR-038 (supply-chain provenance: records the SBOM as
  generated-not-yet-signed, §32) land in categories already at 8-9; the C-1..C-7 defect fixes (§11 backoff-overflow
  clamp, §13 query-failure RED-metric parity) tighten existing mechanisms without moving a band.

**Doc-hygiene follow-ups surfaced this wave (outside the scorecard/backlog, not score-movers):**
- [x] **`SECURITY.md:5` still says "thirteen packages"** (should be fourteen) and **`GETTING-STARTED.md`'s
  `Directory.Packages.props` sample lists 13 package entries plus a stale `1.77.0` example version.** Minor
  §34-adjacent staleness against the CI-gated `FACTS.md` (14 packages); refresh in a docs pass. *(§34, effort S.)*
  **DONE (verified 2026-07-23):** `SECURITY.md` no longer hard-codes a package count, and the
  `common-GETTING-STARTED.md` sample (now centralized in Website `docs-src/guides/`) marks the `1.77.0`
  version as illustrative and defers to `FACTS.md`. Note the item's own "should be fourteen" target was
  itself overtaken: the package count is now 15 per `FACTS.md`.

---

## Progress - seventeenth wave (evidence re-score at v1.108.0, 2026-07-09)

> A full 34-category, two-pass evidence re-score (per-category scorer plus adversarial verifier) at framework
> **v1.108.0** (git HEAD `6c3b3bc`, working tree clean, one commit ahead of origin: the ADR-012 mixed-endpoint
> amendment awaiting push) moves one score and closes nothing: no open item below is proven shipped this run,
> and no below-Maturity-4 category reached M4, so the priority ranking is unchanged (#31 at computed priority 4,
> the documented accepted cap; the seven weight-2 Maturity-3 categories at priority 2).

- ◐ **#21 · Accessibility: Implementation recalibrated 9→8 (Maturity holds 4).** The tenth-wave 9 sat in the
  Exemplary band while the shipped, user-toggleable dark theme carries two documented, deliberately un-gated
  WCAG AA contrast failures (filled-primary button label + error-alert text, `ACCESSIBILITY.md` known
  limitations), a directly unmet §21 color-and-contrast criterion. With the standing smaller gaps (no automated
  focus-trap/reading-order assertion, manual pass only; axe breadth scoped to the gallery's representative
  states) the honest band is Strong; held at 8, not 7, because the gaps read as one minor cluster whose
  contrast half is a single palette-tuning item **already tracked as the open §20 follow-up above** (no
  duplicate item added; tuning the dark palette and gating the dark-mode axe scan is also the path back to 9).
- ◐ **#8 · Data Architecture: held at M4/I8 (adversarial 8→9 declined).** The first pass proposed an
  Implementation lift; refuted because the rubric's §8 "migrations run in CI/CD" criterion stays structurally
  unmet in-repo (`ci.yml` has no migration-apply step; ADR-030 boot-time self-migration is a runtime mechanism,
  not that gate), so the scorecard's standing "Held at 8 (not lifted)" note stands.
- ◐ **#22 · Responsive & Cross-Browser: held at M3/I8 (adversarial 8→9 declined).** No repo change since the
  twelfth-wave 7→8 lift; firefox/webkit remain advisory `continue-on-error` (`ci.yml:89`). The open follow-up
  above (promote firefox to blocking, +1 Maturity) is still the sole §22 lift.
- ◐ **Evidence enrichment, no score move:** ADR-039 (live channel push: ephemeral events over the notification
  hub via `ILiveChannelPublisher`) and the ADR-012 mixed-endpoint transport-profile amendment land in
  categories already scored 8-9; the ADR range refreshes to **001-039** (`FACTS.md`: 78 fitness methods /
  25 bases, Common runs 41).

## Progress - eighteenth wave (runtime performance wave, 2026-07-10)

> A cross-repo runtime-performance audit (4 parallel auditors: framework, ADC, Store, hosting/config)
> found the framework strong on read-path fundamentals (no-tracking, SQL pagination, batched populators,
> pipeline split-query, outbox smart-wait) but flagged a cluster of hot-path costs, all fixed this wave
> (details in `CHANGELOG.md` [Unreleased] and ADR-040). Mostly §12 Performance & Scalability plus §26
> caching evidence:

- ✅ **§12 · Outbox mark-processed set-based + async** (`ExecuteUpdateAsync`; was a nested synchronous
  `SaveChanges()` blocking a thread-pool thread per event-raising command); `InProcessEventBus` batch
  publish = 1 save + 1 update (was 2 round trips per event).
- ✅ **§12/§26 · ADR-040 `PublicEndpointOutputCachePolicy`**: authenticated requests no longer bypass the
  output cache on `[AllowAnonymous]` user-independent GETs (the UI's Bearer-on-every-request made the
  whole output-cache layer serve 0% of logged-in traffic).
- ✅ **§26 · Query cache hardening**: stampede protection in `CachingQueryDecorator` (per-key double-check
  locking); `Result`/`Result<T>` JSON round-trip converter (a Redis cache hit previously could not
  rehydrate: latent production incident once Redis appears); batched prefix invalidation (512-key
  deletes); single-copy serialization.
- ✅ **§12 · Retry ownership**: standard resilience handler capped at 1 retry (UI policy owns user-facing
  retries; stacked budgets amplified brownouts up to 16x); gRPC client resilience unified with the Aspire
  values via new `HttpResilienceDefaults` (Shared) + restored `PooledConnectionLifetime`/keep-alive.
- ✅ **§12 · Allocation/reflection batch**: lazy `Result` error list + shared success instance; typed-DTO
  list responses skip per-row `ExpandoObject` shaping when no `fields` requested (BREAKING: query-service
  generics widened to `object`; wire format unchanged); dispatcher closed-type cache; compiled failure
  factory; `Type.GetType` cache; `LocalView.FindEntry`; split-query heuristic in
  `EFReadRepository.ApplyIncludes`; command started-log to Debug + source-generated scope; gzip Fastest.
- ⏸ **Deferred with rationale**: interceptor `DetectChanges` reduction (the second detection pass may be
  load-bearing for audit stamps; needs a dedicated EF-internals investigation; silent-data-loss failure
  mode) and a by-id fast path around the dynamic query pipeline (larger refactor; pressure mostly removed
  by ADR-040).

## Progress - remediation wave 1 (cross-repo wave plan, 2026-07-11)

> First wave of the 2026-07-11 cross-repo remediation plan (workspace plan file). Ships the shared
> §18/§19 fitness bases the ADC/Store maturity lifts need, closes the tenth-wave #20 dark-palette item,
> and adds a §23 measurement gate. Full Release build 0/0; 2223 tests green; gallery E2E 21/21
> (19 prior + 2 dark-mode) plus 2 new vitals tests.

- ✅ **§18/§19 shared fitness bases (the ADC/Store maturity 3→4 levers, consumed on the next sweep).**
  `UIArchitectureConventionTestsBase` (code-behind 400-line cap + inline `@code` 120-line cap,
  non-vacuity guard) and `StateManagementConventionTestsBase` (no mutable static state in `Layer.Ui`
  assemblies via reflection, `AllowedStaticMembers` for recorded exceptions; plus a no-singleton
  `*StateService`/`*StateContainer` source scan). Both subclassed in-repo (dog-food): the §19 gate
  caught and fixed two real §18 violations (`MobileInfiniteScrollList` ~205 and `NotificationBell`
  ~135 inline `@code` lines, both split to code-behind partials, snapshots/bUnit green) and surfaced
  `ErrorMessages._localizer` (recorded as the one allowed static: write-once wiring extension point, ADR-027).
- ✅ **#20 dark-mode palette contrast RESOLVED + GATED (§20/§21).** Dark `PrimaryContrastText`/
  `ErrorContrastText` now `rgba(0,0,0,0.87)`; `DarkModeE2ETests` (Login + Components, dark palette via
  the `mmca_theme` cookie) reproduced both documented AA failures pre-fix and now gates them in the
  blocking chromium `ui-e2e` job. §21 Implementation 8→9 candidacy recorded for the next re-score
  (CONFIRMED on the eighteenth-wave re-score, 2026-07-12: §21 is M4/I9).
- ✅ **§23 measurement gate.** `WebVitalsE2ETests` asserts LCP/TTFB/CLS budgets on the gallery Login +
  Components pages (shipped `WebVitalsCollector`) inside the blocking `ui-e2e` job, so the shared-chrome
  front-end performance conventions are now measured AND enforced (the two gaps the §23 maturity-3
  recalibration named). §23 maturity 3→4 candidacy recorded for the next re-score
  (CONFIRMED and applied to the scorecard table on the nineteenth-wave re-score, 2026-07-15: §23 is M4/I8, on the protect list).
- ✅ **§34 hygiene.** `GETTING-STARTED.md` no longer restates the current consumer version (links
  `FACTS.md`; sample version marked illustrative). ~~*Noted for a future docs pass:* `CHANGELOG.md`'s
  `[Unreleased]` section still accumulates content shipped in v1.86.0 through v1.114.0 without
  per-release headings.~~ **RESOLVED (verified 2026-07-25):** `CHANGELOG.md` now carries per-release
  headings through `## [1.128.0] - 2026-07-25` with an empty `[Unreleased]` (`CHANGELOG.md:7-9`).

## Progress - eighteenth wave (evidence re-score at v1.115.0, 2026-07-12)

> A full 34-category, two-pass evidence re-score (per-category scorer plus adversarial verifier) at framework
> **v1.115.0** (HEAD `37d0a3b`, working tree **clean**, at the release tag). **Three front-end scores move.**
> Canonical scoring is now **Maturity 95.1% (308/324) / Implementation 84.3% (683/810)** per the in-repo
> [`ArchitectureScorecard.md`](../governance/common-ArchitectureScorecard.md) (was 94.4% / 83.7%). The three candidacies the
> remediation-wave-1 entry recorded are now score-confirmed.

- ✅ **#21 · Accessibility: Implementation 8→9 (CLOSED, stays on the protect / consumer-assessed list).** The
  two documented, deliberately un-gated dark-theme WCAG AA contrast failures that capped §21 at 8 in the
  seventeenth wave (filled-primary button label + error-alert message text) are fixed: dark
  `PrimaryContrastText`/`ErrorContrastText` = `rgba(0,0,0,0.87)` (`Source/Presentation/MMCA.Common.UI/Theme/MMCATheme.cs:60,73`),
  and the dark-mode axe scan is now a blocking gate (`DarkModeE2ETests` in the required chromium `ui-e2e`
  job, `.github/workflows/ci.yml:114`). This is exactly the "tune the dark palette and gate the dark-mode
  axe scan is the path back to 9" the prior §21 row named, and it closes the remediation-wave-1 candidacy
  above. +3 index points (weight 3). Maturity holds at 4.
- ✅ **#20 · Design System & UI Consistency: Implementation 8→9.** The same dark-palette fix, gated by the
  same blocking dark-mode axe scan, closes the WCAG AA contrast half of §20's I8 deduction. +2 index points
  (weight 2). **Not a full clear:** the Bootstrap-chrome→MudBlazor migration (Priority-2 #20 below) and the
  residual `!important`/raw-hex in `wwwroot/app.css:122` remain OPEN (the re-score judged them minor enough
  for I9, so that Priority-2 item stays unchecked). Maturity holds at 4.
- ✅ **#23 · Front-End Performance: Maturity 3→4 (CLOSED, moved to the level-4 protect list).** The
  front-end performance conventions the thirteenth wave recalibrated to review-enforced are now measured AND
  automatically enforced: `WebVitalsE2ETests` asserts LCP/TTFB/CLS budgets on the gallery Login + Components
  pages inside the required chromium `ui-e2e` merge gate
  (`Tests/Presentation/MMCA.Common.UI.E2E.Tests/WebVitalsE2ETests.cs:43`, `.github/workflows/ci.yml:114,145`,
  measurement via `Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs:17`), meeting
  the rubric M4 "enforced automatically (CI)" bar. This closes the remediation-wave-1 candidacy above.
  §23 leaves the priority-2 band, becomes the 27th Maturity-4 category, and joins the protect list.
  Implementation held at 8: desktop `MudDataGrid` still uses server paging rather than row virtualization.
- ◐ **Five adversarially-refuted first-pass proposals, no score move (recorded for the next cycle to
  re-adjudicate).** §7 Microservices Readiness (proposed Implementation 9→8, an unforced band recalibration
  re-litigating a fourteenth-wave decline; holds M4/I9), §10 Cross-Cutting Concerns (proposed 8→9 rejected,
  the three documented hold-reasons still in source; holds M4/I8), §25 Navigation (proposed M2/I6 downgrade
  not supported, every mechanism present on a clean tree; holds M3/I8), §26 Front-End Security (proposed 8→9
  rejected, the CSP `script-src`/`style-src` gap unclosed; holds M4/I8), and §34 Governance (proposed 8→7 on
  a transient stale-prose basis this refresh cures; holds M4/I8).
- ✅ **Evidence enrichment, no score move (ADRs 040-045, since v1.108.0).** ADR-040 authenticated output
  caching, ADR-041 observability/telemetry, ADR-042 MAUI device-capability abstraction (the fifteenth
  package `MMCA.Common.UI.Maui`), ADR-043 mobile deep links + native OAuth callback, ADR-044 native push
  delivery, ADR-045 managed file storage + avatars, all in categories already scored 8-9 (§18/§6/§8/§11/§30).
  The source-generated, CI-gated `FACTS.md` reports **15 packages / ADR set 001-045 / 85 fitness methods
  across 28 bases (Common runs 46)** and the scorecard rows are synced to match.

## Progress - twentieth wave (evidence re-score at v1.117.0, 2026-07-17)

> A full 34-category, two-pass evidence re-score (per-category scorer plus adversarial verifier) at framework
> **v1.117.0** (HEAD `76d70cf`, working tree **clean**). **Four scores move.** Canonical scoring is now
> **Maturity 96.3% (312/324) / Implementation 84.6% (685/810)** per the in-repo
> [`ArchitectureScorecard.md`](../governance/common-ArchitectureScorecard.md) (was 95.1% / 84.3%). Two of the three candidacies
> recorded on 2026-07-16 are score-confirmed; the third (§12) is declined on live branch-protection evidence.

- ✅ **#25 · Navigation & IA: Maturity 3→4 (CLOSED, moved to the level-4 protect list).** The navigation-contract
  drift gate the scorecard risk list prescribed now ships and gates merges: `NavigationContractTests`
  reflects over every routable `MMCA.Common.UI` page (`RouteAttribute`/`AuthorizeAttribute`) and asserts
  route set-equality plus auth-posture agreement against the embedded `NavigationFlow.md` routes table,
  with a non-vacuous 8-route floor
  (`Tests/Architecture/MMCA.Common.Architecture.Tests/NavigationContractTests.cs:29,44`,
  `MMCA.Common.Architecture.Tests.csproj:12` embeds the doc, `MMCA.Common.slnx:45` puts the gate in the
  CI-gated unit tier), meeting the rubric M4 "enforced automatically (CI)" bar and closing the §25 red flag.
  Implementation holds at 8: the gate is enforcement, not new execution breadth, and deep-link param typing
  beyond list-state stays light (plain string route templates, only the sanitized `?returnUrl=` query state).
- ✅ **#33 · Developer Experience: Maturity 3→4 + Implementation 8→9 (CLOSED, moved to the level-4 protect
  list).** The `consumer-source-build` canary promotion recorded below is score-confirmed: the job is a
  required merge gate (no `continue-on-error`; the "Consumer source build (Helpdesk)" context verified in
  live branch protection, `ci.yml:267-303`, `CONTRIBUTING.md:62`), so a framework change that breaks a
  source-mode consumer blocks the merge automatically. The headless-hang and library-not-runnable notes
  stand as implementation caps only (I9, not I10).
- ✅ **#22 · Responsive: Implementation 8→9 (candidacy confirmed; stays on the protect list).** webkit was
  promoted to a required merge gate 2026-07-16 after 11 consecutive green main runs (`ci.yml:111-114`), so
  all three engines now block merges, closing the row's single stated hold-at-8 reason ("webkit remains
  advisory"). `RESPONSIVE.md`'s browser matrix updated with this refresh (it still listed webkit as advisory).
- ◐ **#13 · Observability: Implementation 9→8 (band recalibration, no work lost; stays at Maturity 4).**
  Two of the six §13 criteria (SLO alerting/dashboards, runbooks) are deployer-owned, the rubric's Strong
  band rather than Exemplary: the same deferred-to-consumer calibration §17/§29 already carry. The in-repo
  substance (unconditional warm-up readiness gate with 9 unit tests, RED-metric parity, poll-span filtering)
  is re-confirmed; the row's stale `Aspire/Extensions.cs` line anchors were corrected.
- ⏸ **#12 · Performance: Maturity 3→4 candidacy DECLINED (stays open at M3/I8).** The latency-regression
  gate shipped 2026-07-16 (`--job Short` + `build/perfgate` vs `Tests/Performance/perf-baseline.json`,
  `ci.yml:174-200`) and is a real qualitative upgrade over the runs-clean smoke, but the job's context is
  absent from the live `required_status_checks` list (branch-protection API; `CONTRIBUTING.md:57-62`
  agrees), so a red perf gate does not block a merge and the rubric's merge-gate bar is unmet. Remaining
  step is administrative: promote the context to branch protection once observed reliably green (see the
  reopened #12 item below).
- ⏸ **#17 · DevOps: Implementation 8→9 candidacy DECLINED (stays open at M3/I8).** The
  `sample-deployment-validate` job (blocking, `az bicep build` on every push/PR, `ci.yml:309-322`) keeps the
  reference sample continuously valid, but it is a compile check and the workflow's own comment states a
  real what-if/deploy stays consumer-side, so it is neither new deployment execution (I9) nor automatic CD
  enforcement (M4).
- ◐ **Three adversarially-refuted first-pass proposals, no score move.** §9 API & Contracts (proposed M3→4
  rejected: the contract drift gate is deliberately consumer-owned, `OpenApiEndpointExtensions.cs:13`, and
  no §9-specific CI gate exists in-repo; holds M3/I9 and enters the scorecard risk list in §25's vacated
  slot), §17 DevOps (proposed M3→4 rejected on the same compile-check-only evidence as the impl candidacy;
  holds M3/I8), §31 FinOps (proposed M2→3/I7→8 rejected: the proposal re-cited the identical evidence
  already grounding M2/I7; the accepted cap stands unchanged).
- ✅ **Counts refresh.** The source-generated, CI-gated `FACTS.md` reports **15 packages / ADR set 001-048 /
  85 fitness methods across 28 bases (Common runs 49)**; the scorecard's stale "Common runs 46" prose was
  synced to match.

---

## Progress - twenty-first wave (evidence re-score at v1.121.0, 2026-07-21)

> A full 34-category, two-pass evidence re-score (per-category scorer plus adversarial verifier) at framework
> **v1.121.0** (HEAD `4a4fc05`, working tree **clean**). **One score moves.** Canonical scoring is now
> **Maturity 96.9% (314/324) / Implementation 84.6% (685/810)** per
> [`ArchitectureScorecard.md`](common-ArchitectureScorecard.md) (was 96.3% / 84.6%). The cycle's value is
> mostly in what it refused to move: seven proposed lifts were refuted against source.

- ✅ **#12 · Performance & Scalability: Maturity 3→4, CLOSED and returned to the protect list.** The
  twentieth wave declined this candidacy because the perf gate's context was absent from
  `required_status_checks`. That is no longer true: live branch protection on `main` requires 8 contexts
  including `Performance gate (BenchmarkDotNet Short + baseline verify)`, matching the job name at
  `.github/workflows/ci.yml:179`, and the job has no `continue-on-error` (`ci.yml:196-204`), so a violation
  of the committed `Tests/Performance/perf-baseline.json` ceilings blocks the merge. Implementation holds
  at 8 (load and stress timing at realistic volumes stays consumer-side). This is the only index move:
  312 + 2 = 314 maturity points.
- ◐ **Seven adversarially-refuted first-pass proposals, no score move.** §4 DDD (I8→9 rejected: only
  `Notifications` is a bounded context in `Source/Core/MMCA.Common.Domain`, a criterion the row itself
  cites as its cap; the real v1.120.0 domain-event correctness fixes do not close it), §9 API & Contracts
  (M3→4 rejected: the three contract-test bases are subclassed only in Store/ADC, never in Common's own
  tests), §11 Security (I8→9 rejected: the deployment sample's Key Vault secret binding is still
  incomplete in the bicep template and no authz commit has landed since 2026-07-01), §19 State Management
  and §26 Front-End Security (held at prior on re-verification), §20 Design System (a proposed *downgrade*
  I9→8 rejected; 9 re-confirmed), §29 Resilience (I8→9 rejected: zero commits touch resilience,
  restore-drill, or warm-up files since the twentieth-wave baseline, and the resilience guide still states
  the capping gap).
- ✅ **New item under #34, opened and closed same day: `CONTRIBUTING.md`'s gate list had drifted from live
  protection.** It advertised five required gates and called webkit advisory, while protection requires
  eight, and the reproduce snippet omitted webkit, the Helpdesk canary, and the perf gate (replaying it
  would have *downgraded* protection). Load-bearing rather than cosmetic: this file's authority is what
  held §12 at Maturity 3 for a cycle after its gate was promoted. **Fixed in MMCA.Common PR #100
  (`658786b`)**, which also points readers at the branch-protection API as authoritative over the
  committed copy. §34 holds M4/I8: this closes a stale-docs deduction, not an enforcement gap.
- 📎 **Path provenance note added** to *Deliberate / accepted*: `COST.md` and the other in-repo doc paths
  cited by historical entries moved to `Website/docs-src/` in the 2026-07-20 centralization.
- ✅ **Counts refresh.** The source-generated, CI-gated `FACTS.md` reports **15 packages / 91 fitness
  methods across 30 bases (Common runs 55) / coverage floor 68.3%**.

---

## Progress - twenty-second wave (evidence re-score at v1.123.0, 2026-07-23)

> A full 34-category, two-pass evidence re-score (per-category scorer plus adversarial verifier) at framework
> **v1.123.0** (HEAD `c911480`, working tree **clean**). **No score moves.** Canonical scoring holds at
> **Maturity 96.9% (314/324) / Implementation 84.6% (685/810)** per
> [`ArchitectureScorecard.md`](common-ArchitectureScorecard.md). The cycle's value is entirely in what it
> refused to move: five first-pass proposals (three lifts, two downgrades) were refuted against source.

- ◐ **Three adversarially-refuted lift proposals, no score move.** §9 API & Contracts (M3→4 rejected
  again: `OpenApiContractTestsBase` is subclassed only in consumer hosts, never in Common's own tests, and
  `OpenApiEndpointExtensions.cs:13` records the delegation as deliberate, so no in-repo CI gate enforces
  the contract); §10 Cross-Cutting Concerns (I8→9 rejected: the three documented hold-reasons are still in
  source: the distributed cache path is a no-op without a real `IConnectionMultiplexer`
  (`DependencyInjection.cs:158`), the idempotency semaphore is in-memory rather than
  cross-instance-exclusive, and resilience config is partly literal); §30 Compliance (M3→4 rejected: the
  only automatic gate, `PiiErasureContractFitnessTests`, proves the erasure mechanism, while the
  structural `[Pii]` scan stays vacuous in-repo and the governing process (inventory, DSAR, consent,
  residency, retention) is consumer-resident).
- ◐ **Two adversarially-refuted downgrade proposals, no score move.** §23 Front-End Performance and §24
  Forms, Validation & UX Safety (each I8→7 rejected on a fresh re-read of every cited file): no
  regression exists. §23's web-vitals budget gate is in fact stronger than when its 8 was set (all three
  browser engines now required, `ci.yml:107`), and §24's auth-form surface (Register/Login `EditForm` +
  DataAnnotations, `PasswordComplexityAttribute`, `UnsavedChangesGuard.IsDirtyAccessor`, the CI-gated
  bUnit/model tests) is intact.
- 📎 **Evidence enrichment, no band move.** The v1.122.0-v1.123.0 capability train (typed filter DSL
  operators, the `EntityQueryPipeline` page-size clamp, cache-observability warnings, the
  `IIntegrationEventPublisher` removal with callers moved to `IEventBus`) lands in categories already
  scored 8-9.
- ✅ **Open set and rankings unchanged.** #9, #17, #30 (M3, priority 2 each) and #31 (M2, computed
  priority 4, documented accepted cap); the *Deliberate / accepted* section stands as written. `FACTS.md`
  reports **15 packages / 91 fitness methods across 30 bases (Common runs 55)**.

---

## Progress - twenty-third wave (evidence re-score at v1.128.0, 2026-07-25)

> A full 34-category, two-pass evidence re-score (per-category scorer plus adversarial verifier) at framework
> **v1.128.0** (HEAD `3dff29b`, working tree **clean**). **No score moves**, the third consecutive
> steady-state cycle. Canonical scoring holds at **Maturity 96.9% (314/324) / Implementation 84.6%
> (685/810)** per [`ArchitectureScorecard.md`](common-ArchitectureScorecard.md). Five first-pass
> proposals (four lifts, one downgrade) were refuted against source.

- ✅ **#17 DevOps: proposed M3→4 and I8→9 both refuted, and the refutation sharpened the row.** The
  maturity-3 hold-reason is unchanged in source: the `sample-deployment-validate` job is an
  `az bicep build` compile check, and the workflow's own comment still records that a real what-if or
  deploy stays a consumer-side concern (`.github/workflows/ci.yml:591-592`, steps at `:601-607`). The
  verification also surfaced two drifted claims in the scorecard row itself, both corrected in this
  refresh: `ci.yml` is `pull_request`-only (`:3-16`, the push trigger was removed), and the bicep job's
  context is **absent from the 8 required status checks on `main`** (queried live), so it was never the
  "blocking" gate the row advertised. Implementation holds at 8 because the IaC and rollback material is
  an explicitly non-executed reference sample (`DEPLOYMENT.md:3,80`).
- 📎 **New #17 evidence, no band move.** Releases now publish to nuget.org as well as GitHub Packages
  using `NuGet/login` OIDC trusted publishing with no stored API key (`release.yml:79-88,155-165`,
  ADR-053), under a least-privilege `permissions` block (`:13-16`) with a blocking CycloneDX SBOM gate
  (`:53-58`). This strengthens the secretless-deploy-identity criterion without touching either
  hold-reason, so it lands as evidence enrichment and a new *Deliberate / accepted* note.
- ✅ **#31 FinOps: proposed M2→3 refuted.** A search for cost, FinOps and budget across `.github`, and for
  cost across `Tests/Architecture`, returns zero matches, so no cost convention is enforced by review or
  CI; every cited artifact is byte-identical to the v1.123.0 tree already scored at M2. The documented
  acceptance stands.
- ✅ **#30 and #34 lifts refuted.** #30 holds at M3 (the structural `[Pii]` convention scan is still
  vacuous in-repo, `PiiConventionTests.cs:7-11`, and no Domain type declares `[Pii]`); #34 holds at I8
  because `Docs/Architecture/ArchitecturalAnalysis.md` still lives at the uncommittable workspace root
  with no committable replacement anywhere under `docs-src/` or MMCA.Common.
- ✅ **#23 downgrade refuted.** The proposed M4→3 / I8→7 fails on a fresh read: `WebVitalsE2ETests`
  asserts LCP/TTFB/CLS budgets on two gallery pages inside the unfiltered `ui-e2e` job, which carries no
  `continue-on-error` anywhere.
- 🆕 **One new item, under #34 (priority 2 band, effort S).** The governance prose had drifted five minor
  versions behind the CI-gated `FACTS.md`: the scorecard's §14 fitness counts, its §16 and §34 ADR range,
  and this backlog's header line. All corrected here; the item stays open for the residual generated
  string in `FACTS.md:20`, which still says GitHub Packages only and must be fixed in the generator
  (`build/facts/FactsGenerator.cs:208`) in the MMCA.Common repo.
- ✅ **Closed: the v1.85.0 docs-governance follow-up.** The CHANGELOG carries the backfilled 1.83.0 and
  1.84.0 sections (`CHANGELOG.md:1211,1200`), `[Unreleased]` is empty above `## [1.128.0]` (`:7-9`), and
  ADRs 024/025/026 are committed.
- ✅ **Open set and rankings unchanged.** #9, #17, #30 (M3, priority 2 each) and #31 (M2, computed
  priority 4, documented accepted cap). `FACTS.md` reports **15 packages / 93 fitness methods across 30
  bases (Common runs 56)**; the ADR corpus is **001-055**.
- ✅ **FR-1 through FR-7 re-verified open.** Each of the seven deferred 2026-07-19 review findings was
  re-checked against source this run and none has shipped: the single Infrastructure package
  (`FACTS.md:24`), `Result<T>.Value` still returning null on failure
  (`Shared/Abstractions/Result.cs:139-140`), the unconstrained `TResult` on `ICommandHandler`/
  `IQueryHandler` (`:9` in each), and the preview extension-type DI surface
  (`Application/DependencyInjection.cs:22`) all stand as recorded. They remain unscheduled.

---

## Progress - twenty-fourth wave (evidence re-score at v1.131.0, 2026-07-28)

> A full 34-category, two-pass evidence re-score (per-category scorer plus adversarial verifier) at framework
> **v1.131.0** (HEAD `2c52aa9`, working tree **clean**). **No score moves**, the fourth consecutive
> cycle at these indices. Canonical scoring holds at **Maturity 96.9% (314/324) / Implementation 84.6%
> (685/810)**, which is **94.0% of the 90% attainable ceiling**, per
> [`ArchitectureScorecard.md`](common-ArchitectureScorecard.md). Five first-pass lift proposals were
> refuted against source. **Nothing closed and nothing was added**: both bands are byte-identical to
> the twenty-third wave (maturity 4 items / 10 points, implementation 18 items / 44 points).

- ✅ **#9 API & Contract: proposed M3→4 refuted.** The Maturity-4 bar is automatic enforcement, and
  neither §9 mechanism exists in-repo: the OpenAPI contract-drift gate is delegated to consumer
  integration tiers by the framework's own comment (`OpenApiEndpointExtensions.cs:12-14`), the shipped
  `OpenApiContractTestsBase` has no MMCA.Common subclass, and the `[ServiceContract]` architecture rule
  still does not exist by its own docstring (`ServiceContractAttribute.cs:6-10`). The only CI-gated
  §9-adjacent tests are two DI-registration facts for `AddCommonApiVersioning`
  (`WebApplicationBuilderExtensionsTests.cs:17,29`) that assert registration presence and a fluent
  return, not the version default, backward compatibility, or any contract property. The item stays
  open at priority 2.
- ✅ **#13, #25 and #29 implementation lifts (each 8→9) refuted, and each refutation names the lever
  that was previously unrecorded.** #13 still leaves SLO alerting/dashboards and runbooks to the
  deployer (`ArchitectureEvaluationCriteria.md:379`); #25's "parameters typed and validated" half of the
  route-design criterion is still structurally unexercised (`:645`); #29's tested restores, RTO/RPO and
  measured production SLOs are recorded by the framework's own guide as consumer-IaC work
  (`common-RESILIENCE.md:3,27`), and the only new §29 material (health-check tagging plus the
  readiness-gate fix) is opt-in enrichment of a criterion already partly met. Their implementation-band
  rows are updated from "not yet identified" to those levers.
- ✅ **#30 Compliance & Privacy: proposed M3→4 refuted for the third consecutive cycle.** Zero files
  matching pii/privacy/retention/anonym/consent/erasure/encrypt changed between the twenty-third-wave
  baseline (`3dff29b`) and this HEAD, so the proposal re-cited the identical evidence already grounding
  M3; the structural `[Pii]` scan is still self-documented as vacuous in the framework
  (`PiiConventionTests.cs:7-11`).
- ✅ **#31 FinOps: acceptance re-confirmed, with one precision fix.** `Tests/Architecture` is still
  genuinely zero matches for cost or budget, but `.github` now returns three incidental prose hits (a
  comment pointing at the COST guide, `ci.yml:330`, plus one word each in
  `.github/ISSUE_TEMPLATE/feature_request.yml` and `.github/dependabot.yml`), so the accepted-cap entry's
  "zero matches across `.github`" phrasing is corrected. The conclusion is unaffected: no cost convention
  is enforced by review or CI.
- 🆕 **#34 stays open, scope widened.** The named residual is verbatim unchanged:
  `build/facts/FactsGenerator.cs:208` still emits "Released in lockstep to GitHub Packages", reproduced
  at `FACTS.md:20`, while `release.yml:81-88,157-165` pushes every release to nuget.org as well. The
  recurrence folded in this cycle: the governance prose had drifted three minor versions behind the
  CI-gated `FACTS.md` again (fitness counts read 93/30/56 against an actual 96/31/61, ADR range read
  001-055 against an actual 001-060), plus six drifted evidence anchors in the scorecard, all corrected
  in this refresh.
- ✅ **FR-1 through FR-7 re-verified open on exact anchors.** The single Infrastructure package
  (`FACTS.md:24`), `Result<T>.Value` still null on failure (`Shared/Abstractions/Result.cs:139-140`), the
  unconstrained `TResult` on `ICommandHandler`/`IQueryHandler` (`:9` in each), the preview extension-type
  DI surface (`Application/DependencyInjection.cs:22`), no cascade soft-delete helper *called* anywhere
  in `Source/` (wording corrected 2026-08-31: an opt-in `DeleteChildren<TChild,TChildId>` helper now
  ships at `AuditableAggregateRootEntity.cs:273-292` and is unit-tested, but no `Source/` aggregate
  calls it, a repo-wide grep finding usages only in Domain tests), and `MMCA.Common.UI.Maui` still
  shipping with no test project of its own. FR-7's anchor
  drifted and is corrected: `CS1591` is still suppressed, now at `Directory.Build.props:22`. They remain
  unscheduled.
- ✅ **#11's historical NetArchTest security-invariants bullet stays unticked, correctly.** No
  `AllowAnonymous`/`AllowAnyOrigin` fitness rule exists in `Tests/Architecture`; this is the second-wave
  deferral to consumer suites, not new work.
- 📎 **Recorded, not scored: the consumers skipped v1.128.0 through v1.130.0 deliberately** and swept
  1.127.0 straight to 1.131.0 in one pass (`CHANGELOG.md:9-15`; `MMCA.ADC/Directory.Packages.props:126`
  and `MMCA.Store/Directory.Packages.props:9` both pin 1.131.0). Filed under *Deliberate / accepted* so a
  future audit reading the version ladder does not score it as three missed ADR-016 lockstep sweeps.

---

## Progress - twenty-fifth wave (evidence re-score at v1.135.0, 2026-08-01)

> A full 34-category, two-pass evidence re-score (per-category scorer plus adversarial verifier) at framework
> **v1.135.0** (HEAD `f292233`, working tree **clean**). **One score moves, ending the four-cycle steady
> state: §10 Cross-Cutting Concerns Implementation 8→9.** Canonical scoring is now **Maturity 96.9%
> (314/324) / Implementation 84.8% (687/810)** per
> [`ArchitectureScorecard.md`](common-ArchitectureScorecard.md). The implementation band records its
> first closure since it was ranked: 18 items / 44 points → **17 items / 42 points**. The maturity band
> is unchanged (4 items / 10 points, all re-verified open). This cycle also retires the
> 90%-attainable-ceiling framing (Implementation 10 is awardable for an almost perfect implementation;
> the scheduling target stays 9).

- ✅ **#10 Cross-Cutting Concerns CLOSED on both axes (M4/I9) → protect list.** The lift rests on new
  shipped evidence, not recalibration: `IdempotencyFilter` resolves an `IDistributedLock` and falls back
  to the striped per-process semaphore only when a host registers none
  (`Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:31-34,109,161-164`; fallback
  `:67-73,129`), and `AddCaching()` registers `RedisDistributedLock` (SET NX PX acquire +
  compare-and-delete Lua release) when an `IConnectionMultiplexer` is present, else the warn-logging
  `InProcessDistributedLock` (`Infrastructure/DependencyInjection.cs:181-195`,
  `Infrastructure/Concurrency/RedisDistributedLock.cs:36`). The filter's distributed-lock path is
  unit-covered (4 `DistributedLock_*` facts,
  `Tests/Presentation/MMCA.Common.API.Tests/Idempotency/IdempotencyFilterTests.cs:544`), the shipped
  cache runs against a real Redis in CI (`redis-integration` Testcontainers job, `ci.yml:611-647`), and
  ADR-017 is revised to document the guard. Residuals recorded on the protect list, not here:
  `HttpResilienceDefaults` values are compile-time constants
  (`Shared/Resilience/HttpResilienceDefaults.cs:13,16,19,28`) and prefix eviction stays TTL-only with no
  multiplexer (`Infrastructure/Caching/DistributedCacheService.cs:189`).
- ✅ **#2 and #15 implementation lifts (each 9→10) refuted.** #2: the four cited §2 files are
  byte-identical to the baseline that scored 9 (`git diff 2c52aa9..HEAD` empty over them), and a
  rubric-named §2 red flag is live in shipped code: `ServiceExceptionHelper.ThrowIfDomainExceptionAsync`
  re-throws API error payloads as `DomainInvariantViolationException`
  (`MMCA.Common.UI/Services/ServiceExceptionHelper.cs:50`), invoked from three shipped UI service bases,
  with pages type-sniffing the exception to pick the message (`Pages/Common/ErrorMessages.cs:53`):
  exceptions-as-control-flow where `Result<T>` is the framework's own convention. #15: the repo-wide
  `NoWarn` grew rather than shrank (S8970 added 2026-07-28, `Directory.Build.props:22`), and CD-1/CD-2
  were re-verified live in source this cycle (see below); the one hold-reason that did close (the dated
  `NuGetAuditSuppress`, removed 2026-07-20, `CHANGELOG.md:737-743`) supports 9, not 10. Neither category
  sits in any band; no ledger delta.
- ✅ **#17 DevOps: proposed 4/9 refuted; new tactical sub-item added.** No §17 source changed since the
  v1.128.0 tree already scored 3/8 (`git diff v1.128.0..HEAD -- samples/ .github/workflows/` touches
  `ci.yml` only), the Bicep job is still compile-only (`ci.yml:595-609`, consumer-side what-if comment
  `:591-594`), and its context is absent from the 8 live required checks (branch-protection API, this
  run). The verification surfaced a live defect in the reference IaC, filed under #17 in the maturity
  band below.
- ✅ **#31 FinOps: acceptance re-confirmed, third refutation of the same lift.** The proposed I7→8
  re-cited byte-identical evidence: the newest §31 artifact remains the v1.118.0 metric-family knob pair
  (`CHANGELOG.md:839-848`), in-tree for every re-adjudication since; releases 1.132.0-1.135.0 carry no
  §31 item, and `Tests/Architecture` is still zero matches for cost/budget.
- ✅ **CD-1 and CD-2 re-verified open at v1.135.0, all anchors exact.** CD-1:
  `EntityQueryService.GetAllForLookupAsync` still declares `where`/`orderBy` (`:278-283`) and forwards
  neither (`:299-302`), while the repository overload accepts and applies the predicate
  (`EFReadRepository.cs:82-83`) and hard-codes `OrderBy(l => l.Name)` (`:89`). CD-2: the lookup selector
  still appends `ToString()` for any non-string property (`EFReadRepository.cs:113-117`). The
  v1.132.0-v1.135.0 releases, the two BugHunt remediation PRs included, did not fix either.
- ⚠️ **FR-1 through FR-7 not individually re-verified this cycle.** They stay open exactly as recorded
  (last full re-verification: twenty-fourth wave); flagged here rather than silently re-confirmed.
- 🆕 **#34 drift half updated.** The named residual is verbatim unchanged (`FactsGenerator.cs:208` still
  emits the GitHub-Packages-only lockstep string, reproduced at `FACTS.md:20`). Fitness counts did NOT
  drift this cycle (96/31/61 still matches `FACTS.md:44,47-48`), but two figures did: this ledger
  self-dated v1.131.0 against an actual v1.135.0, and the ADR corpus read 001-060 against an actual
  **001-064** (ADR-061 runtime secret management through ADR-064 deploy recency gates, 2026-08-01 ADR
  audit). Both corrected in this refresh.

## Progress - twenty-sixth wave (evidence re-score at v1.142.0, 2026-08-07)

> Full 34-category two-pass re-score at HEAD `710d29d` (clean tree). **No scores move**: 27 categories
> re-confirmed fresh, and seven first-pass lift proposals were refuted on the adversarial pass and held
> at prior (§6 I9→10, §11 I8→9, §12 I8→9, §17 3/8→4/9, §25 I8→9, §26 I8→9, §31 M2→3/I7→8; details in
> the scorecard's twenty-sixth-wave paragraph). Indices unchanged at 96.9% / 84.8%. The cycle's ledger
> output is reconciliation: closures the scores already justified, sub-item ticks on shipped evidence,
> and the recurring #34 figure re-sync.

- ✅ **#18, #20, #32 closed to the protect list (stale-ledger catch-up, no score move).** All three
  categories already score M4/I9 in the scorecard; their `[ ]` headings below dated from the
  single-axis era. Closing evidence read this run: #18's bUnit primitive coverage
  (`Tests/Presentation/MMCA.Common.UI.Tests/Components/PrimitivesTests.cs` and siblings), #32's
  MassTransit-major fitness gate (`Testing.Architecture/Bases/DependencyVersionTestsBase.cs:4-11`),
  29 committed `packages.lock.json` files, the blocking CycloneDX SBOM steps (`release.yml:53-56`,
  MAUI job `:130-133`), and the CHANGELOG plus `common-VERSIONING.md` policy. #20's closure is
  score-driven; its Bootstrap-chrome residual is NOT closed and stays recorded on the protect entry
  (`wwwroot/lib/bootstrap/dist/css/bootstrap.min.css` still bundled, `Layout/NavMenu.razor.css:23`
  still styles around Bootstrap's `.navbar`).
- ✅ **CD-1 closed: the ledger text had drifted behind shipped code.** `GetAllForLookupAsync` no
  longer declares `orderBy` and now forwards `where`
  (`EntityQueryService.cs:278-282,298-302`; predicate applied at `EFReadRepository.cs:82-83`), with
  the regression test the item asked for at `EntityQueryServiceTests.cs:462-480`. The repository's
  hard-coded `OrderBy(l => l.Name)` (`:89`) is now consistent with a signature that no longer
  promises ordering. CD-2 stays open, anchors exact (`EFReadRepository.cs:113-117`).
- ✅ **Two legacy sub-items ticked on shipped evidence:** #6's EF-backed inbox
  (`Infrastructure/Persistence/Inbox/EfInboxStore.cs:18`) and #13's
  `AddMeter("MMCA.Common.Outbox")` (`Aspire/Extensions.cs:159`). #6 is NOT moved to the protect
  list this cycle: its 4/9 came back with verdict FLAG (the refuted 9→10, not a fresh
  CONFIRMED), so the move waits for a CONFIRMED verdict at the next re-score. #13 stays in the
  implementation band at 4/8.
- ✅ **#17's Bicep secret-binding sub-item and FR-7 re-verified open, anchors exact**
  (`samples/deployment/main.bicep:143` still dangling with no `secrets` array;
  `Directory.Build.props:22` still carries CS1591 in `NoWarn`).
- ⚠️ **FR-1 through FR-6 and C-1..C-7 not individually re-verified this cycle.** They stay open
  exactly as recorded (last full re-verification: twenty-fourth wave); the standing caveat carries
  forward to 2026-08-07 rather than being silently re-confirmed. *(Carried forward again on the
  twenty-seventh-wave re-score: still not individually re-verified, so the caveat now runs to
  2026-08-14; FR-7 was spot-checked and stays open, `Directory.Build.props:22` still carries
  `CS1591;RMG020;S8970` in `NoWarn`.)* *(Carried forward again on the twenty-eighth-wave re-score,
  2026-08-23: FR-1..FR-6 and C-1..C-7 still not individually re-verified except FR-5, which the §8
  adversarial pass re-read in code (`AuditableBaseEntity.cs:47-60`, no cascade, stays open); FR-7
  spot-checked and stays open with a drifted anchor, now `Directory.Build.props:27`, and the
  suppression list grew: `CS1591;RMG020;S8970;RS0041` in `NoWarn`.)*
- 🆕 **#34 drift half updated (the drift recurred, with new figures).** The named residual is
  verbatim unchanged (`FACTS.md:20` still reads "Released in lockstep to GitHub Packages"), and
  three of this ledger's own self-stated figures were stale: it self-dated v1.135.0 against an
  actual **v1.142.0** (`FACTS.md:4,14`), fitness counts read 96/31/61 against an actual **100
  methods across 32 bases, Common runs 78** (`FACTS.md:44-48`), and the ADR corpus read 001-064
  against an actual **001-070**. One structural change: `FACTS.md` no longer states the ADR range
  itself, it delegates the count/range to the Website ADR index (`FACTS.md:38-41`), so that figure
  is now cited from `docs-src/adr/README.md`. All corrected in this refresh.
- 📌 **Live consumer-state note (not an accepted cap; updated 2026-08-23):** the framework is at
  **v1.160.0** (`FACTS.md:4,14`) and BOTH consumers are converged on it:
  `MMCA.Store/Directory.Packages.props:10` and `MMCA.ADC/Directory.Packages.props:96` both pin
  1.160.0 (anchors unchanged from the prior cycle; the v1.159.0/v1.160.0 sweep PRs are merged).
  Lockstep is intact. See the refreshed parenthetical under the skipped-versions
  acceptance below.

---

## Progress - security invariants wave (§11 hardening, 2026-08-22)

Closes the two §11 gaps surfaced by the Article 16 (JWKS dual-fetch) review: the insecure dev
defaults that no two-axis entry named as scheduled work, and the absent security fitness tests.
Landed via MMCA.Common PR #269 (merged 2026-08-22); the consumer sweep has since landed:
`MMCA.Store/Directory.Packages.props:10` and `MMCA.ADC/Directory.Packages.props:96` both pin
MMCA.Common 1.160.0 (shipped in the v1.159.0/v1.160.0 releases).

- ✅ **Secure-by-default `RequireHttpsMetadata`.** `AddForwardedJwtBearer` no longer ships a bare
  `false` default: it resolves explicit argument, then the new
  `Authentication:JwtBearer:RequireHttpsMetadata` config key, then `true` everywhere except
  Development. A resolved `false` outside Development stays legal (the ACA internal-ingress h2c
  authorities need it) and logs one startup warning naming the key; ADC and Store bicep now carry
  the explicit opt-out with the justification recorded beside each authority entry, converting a
  silent insecure default into an auditable decision. The transitional old-signature overload kept
  consumer `main` branches compiling until the sweep landed and is now deleted (verified
  2026-08-23: `API/PublicAPI.Unshipped.txt:56-57` marks both old
  `(string authority, string audience, bool requireHttpsMetadata = false)` forms `*REMOVED*`; the
  single surviving definition is `API/Startup/WebApplicationBuilderExtensions.cs:444` with the
  `configuration` / `environment` / `bool? requireHttpsMetadata` signature).
- ✅ **Security fitness tests exist.** The second-wave "infeasible as NetArchTest" deferral (see
  the 2026-08-22 addendum there) is superseded on both halves. `[AllowAnonymous]` posture:
  `AnonymousEndpointTestsBase` (Testing.Architecture, full-name reflection, zero ASP.NET
  references) fails the build on any occurrence missing from an explicit allow-list, on stale
  allow-list entries, and on an empty scan; subclassed in Common (20 types, 4 allow-listed
  framework credential-exchange actions) and in all three consumers. CORS and token validation:
  executable invariant tests run the real registration code and assert the produced options
  (RS256 stays pinned, the permissive policy never supports credentials, the credentialed policy
  never widens to any origin and fails closed on empty origins, gateway variant included, and
  `RsaJwksProvider` exports only public RSA parameters even when handed a private-key PEM).
  Known limitation, documented in the base: minimal-API `.AllowAnonymous()` metadata is not
  attribute-based and stays out of static reach; the framework's intentional anonymous surface
  (JWKS, OIDC discovery, health) lives there.
- ☑ **Re-adjudicated (2026-08-23 re-score).** §11 was re-scored with this evidence and HELD at
  Maturity 4 / Implementation 8: the wave's substance is predominantly automatic enforcement of
  already-scored capability, which credits Maturity (already 4, capped), and both recorded
  Implementation caps (deployer-owned vault/managed-identity secret binding; RBAC with capability
  indirection, not ABAC) are verbatim unchanged in current source.

## Progress - §9 contract-surface gates (2026-08-22)

Closes both halves of #9, the last weight-2 Maturity-3 item that had a named in-repo lever. Landed via
MMCA.Common PR #271 (squash `8a6c603`, merged 2026-08-22).

- ✅ **OpenAPI committed-baseline diff, in-repo.** `OpenApiBaselineTests` boots a probe host through
  the real `AddCommonOpenApi`/`MapCommonOpenApi` pipeline (`OpenApiProbeHost.cs:20`), normalizes the
  generated `/openapi/v1.json` and fails against the committed
  `Tests/Presentation/MMCA.Common.API.Tests/OpenApi/openapi-baseline.v1.json`
  (`OpenApiBaselineTests.cs:45-77`), with regeneration gated behind an explicit
  `MMCA_UPDATE_OPENAPI_BASELINE=1` run in the same pull request (`:38,153-162`). It covers the
  framework-owned surface (document-per-version naming, the unbound-route-token backfill, the
  generated `ProblemDetails` schema); each consumer host keeps guarding its own concrete surface, and
  that two-level split is recorded at `OpenApiEndpointExtensions.cs:12-19` rather than left implicit.
- ✅ **The `[ServiceContract]` rule exists.** `ServiceContractsDoNotDependOnServiceInternals`
  (`Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Contracts.cs:32`) fails the
  build, naming the offending type, when a marked contract reaches into a mapped
  Domain/Application/Infrastructure namespace; it ships as `Bases/ServiceContractPurityTestsBase.cs:24-26`
  and is subclassed in-repo at `Tests/Architecture/MMCA.Common.Architecture.Tests/ServiceContractPurityTests.cs:11`.
  The attribute's docstring now states the enforced invariant plus the ADR-015 purity rules instead of
  claiming a rule that did not exist. The in-repo run is a documented ratchet (no MMCA.Common type
  carries the attribute yet), which is why Implementation holds at 9.
- ✅ **Both gates run in the CI-gated unit tier** (`MMCA.Common.slnx:36,46`); `FACTS.md` regenerated to
  **110 fitness methods across 38 `*TestsBase` classes**.
- ☑ **Follow-up: subclassing half landed with the v1.160.0 sweep (verified 2026-08-23).** All three
  consumers now subclass the base: `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ServiceContractPurityTests.cs:9`,
  `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/ServiceContractPurityTests.cs:9`,
  `MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ServiceContractPurityTests.cs:9`.
  Optional `[ServiceContract]` adoption on the seven `*.Contracts` projects remains open; the rule is
  attribute-driven, so it stays a documented ratchet until a type carries the attribute.

## Deferred - 2026-07-19 full review (recorded, not scheduled)

> The 2026-07-19 full framework review shipped its accepted fixes on the review branch (rollback on
> business failure + post-commit dispatch, outbox leases + dead-letter visibility, integration-event
> routing via `IMessageBus`; ADR-003/014/030 revisions record them). The items below were reviewed
> and **deliberately deferred**: each is real, none is scheduled, and each records why it did not
> ship with the wave. IDs follow the C-1..C-7 precedent (FR = full review).

- [ ] **FR-1 (§32/§16) - Re-split `MMCA.Common.Infrastructure` into opt-in provider packages
  (Cosmos / AzureMessaging / Media).** The single Infrastructure package drags all three EF
  providers (SQL Server, Cosmos, SQLite), three messaging stacks (in-process, RabbitMQ, Azure
  Service Bus via MassTransit), and ImageSharp into every consumer's dependency graph, SBOM, and
  vulnerability surface, whether or not the consumer uses them (the suppressed SQLite advisory
  GHSA-2m69-gcr7-jv3q is a live example: every consumer inherits it for an engine most never
  enable). Deferred: a package split is a breaking, lockstep-wide re-shape (ADR-016) that needs its
  own design pass and consumer sweep. *(Effort L.)*
- [ ] **FR-2 (§15) - `Result<T>.Value` throw-on-failure guard.** Reading `.Value` on a failed
  result silently returns `null`/default today; a guard that throws would convert the silent-null
  trap into a loud contract violation. Deferred as a breaking behavioral change (consumers may
  depend on the lenient read); the trap is documented in the `Result<T>` doc-comments for now.
  *(Effort M, breaking.)*
- [ ] **FR-3 (§6) - `TResult : Result` compile-time constraint on handler signatures.** The
  decorator pipeline assumes handler results are `Result`-shaped (the Transactional decorator
  pattern-matches `Result { IsFailure: true }`); a generic constraint would make that assumption
  compile-time instead of runtime. Deferred as a breaking generic-signature change; covered in the
  interim by a new architecture rule asserting command/query result types derive from `Result`.
  *(Effort M, breaking.)*
- [ ] **FR-4 (§33) - Reconsider the C# preview extension-type DI surface.** DI registration methods
  use `extension(IServiceCollection)` blocks (`LangVersion: preview`). As the public registration
  surface of a published framework this is an adoption risk: consumers must also build with a
  preview language version until the feature GAs. Revisit when .NET ships the feature as stable;
  reverting to classic extension methods is mechanical but wide. *(Effort M, watch item.)*
- [x] **FR-5 (§8) - Cascade soft-delete semantics. CLOSED 2026-08-31 (thirtieth-wave re-score,
  commit `59d7a97`/PR #325).** The recorded deferral reason ("needs a per-aggregate design pass, not a
  blanket cascade helper") is now met by exactly that shape: the opt-in
  `DeleteChildren<TChild,TChildId>` helper (`AuditableAggregateRootEntity.cs:273`, usage example at
  `:262`) is paired with a fitness rule that FORCES the per-aggregate decision: the shared base
  `AggregatesWithChildCollections_MustCascadeSoftDelete_InDelete`
  (`CascadeSoftDeleteConventionTestsBase.cs:29-31`, with a reviewed per-aggregate exemption list at
  `:27`) fails the build when an aggregate root owning a child collection does not cascade in its
  `Delete()` override, subclassed in-repo (`CascadeSoftDeleteConventionTests.cs:14`) and reinforced by
  a hard-delete ban outside four named framework types (`SoftDeleteEnforcementTests.cs:19`).
  *Residual, kept visible:* Common's own run of the rule is a ratchet, not an assertion (no
  child-bearing aggregate lives under `Source/`, stated at `CascadeSoftDeleteConventionTests.cs:8-12`)
  and the default `Delete()` still flips `IsDeleted` on the single entity only
  (`AuditableBaseEntity.cs:67`); consumer (ADC/Store) subclassing of the new base is CLAIMED in the
  base's docstring but was NOT verified this run: check it at the next consumer re-score. *(Prior
  re-verifications 2026-08-23 and earlier 2026-08-31 preceded the enforcement rule landing at 12:54
  that day.)*
- [ ] **FR-6 (§14) - `MMCA.Common.UI.Maui` has zero automated tests.** The one MAUI-TFM package is
  built and packed by the dedicated windows CI jobs (ADR-042) but nothing exercises it: the
  capability contracts and fallbacks are tested in `MMCA.Common.UI.Tests`, while the thin
  Essentials wrappers themselves are verified only on-device. Options: a windows-job unit tier for
  the wrapper logic, or a documented on-device smoke checklist. *(Effort M.)*
- [ ] **FR-7 (§34) - CS1591 ratchet.** XML doc coverage is enforced by convention, not the
  compiler: `CS1591` sits in `NoWarn` (`Directory.Build.props:27`, anchor corrected again 2026-08-23 after re-verifying open 2026-08-07/2026-08-14; the suppression list also grew: `<NoWarn>$(NoWarn);CS1591;RMG020;S8970;RS0041</NoWarn>`), so a public member can ship
  undocumented without a build break. Ratchet per-project (remove the suppression where already
  clean, then expand) rather than repo-wide at once. *(Effort S per project, long tail.)*

---

## Recorded - 2026-07-31 consumer-discovered defect (not scheduled)

> Found downstream while implementing MMCA.ADC BR-239 (public speaker visibility), which needed a
> filtered lookup read. Recorded rather than fixed in place: the consumer already ships a working
> route-around, and the correction belongs in a framework release plus lockstep sweep (ADR-016),
> not in a consumer PR. IDs follow the C-1..C-7 / FR-1..FR-7 precedent (CD = consumer-discovered).

- [x] **CD-1 (§9/§15) - `EntityQueryService.GetAllForLookupAsync` silently drops its `where` and
  `orderBy` arguments.** **CLOSED (verified 2026-08-07, twenty-sixth-wave re-score): both halves
  are resolved in shipped code.** The service signature no longer declares `orderBy` at all
  (`Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:278-282`: `nameProperty`,
  `where`, `asTracking`, cancellation token), `where` IS forwarded (`:298-302`), the repository
  accepts and applies the predicate (`EFReadRepository.cs:82-83`) and its hard-coded
  `OrderBy(l => l.Name)` (`:89`) is now consistent with a signature that no longer promises
  ordering. The regression test the item asked for exists:
  `Tests/Core/MMCA.Common.Application.Tests/Services/EntityQueryServiceTests.cs:462-480`
  ("GetAllForLookupAsync forwards its predicate"). Original finding, retained for provenance: The service method declares both parameters
  (`Source/Core/MMCA.Common.Application/Services/EntityQueryService.cs:278-283`) and forwards
  neither: after validating `nameProperty` it delegates with only `nameProperty`, `asTracking` and
  the cancellation token (`:299-302`). The two halves differ. **`where` is a genuine drop**: the
  repository overload accepts the predicate and applies it
  (`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IRepository.cs:87-91`,
  `Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:82-83`), so a
  caller that passes a filter gets an unfiltered lookup back with no error and no log: a silently
  ignored filter on a read path, which is the dangerous shape when the filter is the authorization
  rule. **`orderBy` has no repository counterpart at all**: the repository hard-codes
  `OrderBy(l => l.Name)` (`EFReadRepository.cs:89`), so the parameter is inert by construction and
  the signature advertises a capability the layer below never had. MMCA.ADC hit the `where` half
  building its public-speaker lookup filter and routed around the Application layer entirely,
  calling `IRepository.GetAllForLookupAsync` directly from
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/PublicLookupReader.cs:87-91`
  with the defect cited in-file at `:17-24`: a consumer reaching past its own service layer to
  reach a repository feature the service was supposed to expose. **Proposed fix:** forward `where`
  to the existing repository parameter, and either thread `orderBy` down as a new optional
  repository parameter or remove it from the service signature so the contract stops promising it;
  pin the behavior with a regression test asserting a predicate actually filters the lookup result
  (no such test exists today, which is why C-5's `nameProperty` fix passed over the same method
  without surfacing this). *(Effort S: the `where` half is a one-line forward plus a test; the
  `orderBy` half is a small contract decision, and removing the parameter is source-breaking for
  any caller that passes it.)*

- [ ] **CD-2 (§9/§15) - the lookup projection cannot translate value-object properties and throws
  at runtime.** `GetOrBuildLookupSelector` maps the requested property into `BaseLookup.Name` by
  appending a `ToString()` call whenever the property is not a `string`
  (`Source/Core/MMCA.Common.Infrastructure/Persistence/Repositories/EFReadRepository.cs:113-117`).
  For scalar CLR types SQL Server translates that, but for a value-object property (for example a
  `MMCA.Common.Shared.ValueObjects.Email` member) EF cannot translate the call and the query throws
  `InvalidOperationException` at compile time, which surfaces as an HTTP 500 on the lookup
  endpoint. `QueryFieldService.Validate` happily approves the property name first, so the failure
  is a runtime crash rather than a 400. Never observed before because no caller had ever executed
  a lookup on a value-object property; MMCA.ADC's BR-239 integration coverage ran the first one
  (`Speakers/lookup?nameProperty=email`) and had to switch the test to a plain-string property.
  **Proposed fix:** translate value-object properties through their EF-mapped conversion or
  backing member where one exists, and otherwise reject the property at validation time so the
  caller gets a 400 instead of a 500; pin both paths with regression tests alongside the CD-1
  filter test. *(Effort M: the validation half is small; the faithful-projection half needs a
  decision about which conversions are supported.)* *(Re-verified open 2026-08-07,
  twenty-sixth-wave re-score: the selector still appends `ToString()` for any non-string property,
  anchors exact at `EFReadRepository.cs:113-117`; the CD-1 fix did not touch this half.)*
  *(Re-verified open 2026-08-14, twenty-seventh-wave re-score, with an ANCHOR CORRECTION: the
  recorded range had gone stale with the code; `GetOrBuildLookupSelector` now sits at
  `EFReadRepository.cs:116-129`, with the untranslatable `ToString()` append at `:127-129`. The
  defect itself is unchanged and still open.)* *(Re-verified open 2026-08-23, twenty-eighth-wave
  re-score, anchor drifted again: `GetOrBuildLookupSelector` is now at `EFReadRepository.cs:120`
  with the `ToString()` append at `:133` and the call site at `:101`. The defect is unchanged.)*

---

## 🔴 Priority 6: highest leverage

### [x] #28 · Front-End Testing & Quality: score 2 → 4 (weight 3) · *RESOLVED 2026-06-27*
The package ships reusable Blazor primitives with **no fast test tier**.
- ~~**(medium)** No component tests for the UI library~~ **RESOLVED:** `Tests/Presentation/MMCA.Common.UI.Tests` references `bunit` (2.7.2) + the shipped `MMCA.Common.Testing.UI` harness and ships **29 component tests** across the branching primitives (`MobileCardList`, `MobileInfiniteScrollList`: empty/cards/cap/click/error+retry), `UnsavedChangesGuard`, `NotificationBell`, `DeleteConfirmation`, `PageStateScope`, `RedirectToLogin`, and the `PageHeader`/`PageLoadingState`/`PageErrorState` primitives (`PrimitivesTests`).
- ~~**(low)** No axe/Lighthouse or visual-regression step in `ci.yml`~~ **RESOLVED:** `Deque.AxeCore.Playwright` (4.12.0) is pinned and shipped in `MMCA.Common.Testing.E2E` (`Page.AssertNoAccessibilityViolationsAsync()`); the `ui-e2e` CI job runs a **cross-browser matrix** (chromium required gate; firefox/webkit advisory) over the backend-less gallery with **6 axe-core WCAG 2.1 AA assertions** + render smoke.

**Fix**
- [x] Add **bUnit**; write render/parameter/`EventCallback` tests, starting with the branching components (`MobileCardList`, `MobileInfiniteScrollList`). → 29 component tests in `MMCA.Common.UI.Tests`.
- [x] Wire **`Deque.AxeCore.Playwright`** into the existing E2E flows (≥1 a11y assertion). → 6 axe assertions across Login/Register/Components/Notifications.
- [x] Run at least one **browser journey in MMCA.Common CI** so regressions in the shipped E2E helpers are caught here, not only downstream. → `ui-e2e` job (`.github/workflows/ci.yml`), gallery host self-served, chromium gate.

### [x] #30 · Compliance, Privacy & Data Governance: score 1 → 4 (weight 2) · *RESOLVED 2026-06-27*
> _Single-axis review only. In the live two-axis scorecard §30 is **Maturity 3 / Implementation 8**: the in-repo erasure mechanism is complete (and now fitness-gated, see the 2026-06-29 item below), but the broad governance process (DSAR/consent/residency/retention/inventory) is consumer-owned, so two-axis maturity is held at 3, not 4._

Soft-delete is the only deletion model: no lawful erasure path. *(All three fix items shipped; see the wave-1 progress entry above and the 2026-06-27 closeout below.)*
- ~~**(medium)** `AuditableBaseEntity.Delete()` sets `IsDeleted=true` … the exact GDPR/CCPA conflict the rubric names.~~ **RESOLVED:** `IAnonymizable` erasure extension point (`Domain/Interfaces/IAnonymizable.cs`), enforced by the `PiiConventionTests` fitness rule (a `[Pii]`-marked property obliges `IAnonymizable`); the AES-256-GCM `EncryptedStringConverter` ships for retrievable PII.
- ~~**(low)** Processed outbox rows … are never purged~~ **RESOLVED:** `OutboxCleanupService` purges processed outbox (and inbox) rows older than `Outbox:RetentionDays` (default 7) from every relational source.
- ~~**(low)** No PII/consent/DSR machinery~~ **RESOLVED (framework extension point):** `[Pii]` marker + `PiiConventionTests` + `EncryptedStringConverter`, and now `PiiRedactor` masks `[Pii]` members before they reach a structured log / telemetry attribute (closing the documented-but-missing log-redaction half of the `[Pii]` contract). DSR/erasure *endpoints* remain consumer-owned (ADC ships them: see ADC #30).

**Fix**
- [x] Add an **`IAnonymizable` / erasure-orchestration extension point** that reconciles soft-delete with subject deletion (anonymize-in-place, preserve audit trail). → `IAnonymizable` + ADR-005 + `PiiConventionTests` guard.
- [x] Add an **outbox-purge** background option with configurable retention. → `OutboxCleanupService` (`Outbox:RetentionDays`).
- [x] Write an **ADR** framing the soft-delete-vs-erasure tradeoff and the consumer's data-controller obligations. → `ADRs/005-soft-delete-vs-erasure.md`.
- [x] **(2026-06-27) Make the `[Pii]` log-masking real**: `PiiRedactor` (`Domain/Privacy/PiiRedactor.cs`) masks every `[Pii]`-marked member (shallow, value-erasing) so an entity carrying personal data can be logged without leaking clear-text PII; the `PiiAttribute` doc previously *advertised* this policy but no implementation existed. Covered by 7 `PiiRedactorTests`.
- [x] **(2026-06-29) Gate the erasure contract with a fitness function**: `PiiErasureContractFitnessTests` (`Tests/Architecture/.../PiiErasureContractFitnessTests.cs:19-40`) forces a `[Pii]`-marked `DataSubjectSample` through `PiiRedactor` + `IAnonymizable` end-to-end, so the redaction/erasure mechanism is no longer un-gated. *Note:* this verifies the **mechanism**; the repo-wide `PiiConventionTests` scan stays vacuous (no PII-bearing type lives in Common's Domain) and the DSAR/consent/residency/inventory **process** stays consumer-owned, so two-axis §30 maturity is held at 3.

---

## 🟠 Priority 3: score 3, weight 3 (one rung from a 4)

### [x] #29 · Resilience, Reliability & Business Continuity (3 → 4 · *RESOLVED 2026-06-30 (tenth wave)) now on the level-4 protect list*
- ~~**(medium)** No broker retry policy on the extracted-microservice path~~ **RESOLVED (re-verified 2026-06-29):** `ConfigureBrokerTransport` applies `cfg.UseMessageRetry` (exponential) on **both** RabbitMQ (`DependencyInjection.cs:432`) and Azure Service Bus (`:449`), and the `IntegrationEventConsumer` comment + log are corrected. `UseDelayedRedelivery` is deliberately omitted (`DependencyInjection.cs:408`, accepted, needs the RabbitMQ delayed-exchange plugin).
- ~~*Gap (why #29 stays open at Maturity 3):* no in-repo backup/restore drill, RTO/RPO, failover, or SLOs.~~ **CLOSED (tenth wave, Maturity 3→4):** the in-repo `DatabaseRestoreDrillTests` runs as a **build gate on every CI build** (seed→backup→catastrophic-wipe→restore→verify on ephemeral SQLite; 0-row RPO byte-for-byte asserted), and `RESILIENCE.md` records the measured restore baseline (~5 ms median RTO over 5 runs), meeting the M4 "enforced automatically" bar. Production RTO/RPO against real cloud backups + measured prod SLOs stay consumer IaC, so Implementation is held at 8. *(chaos/fault-injection covered below.)*

**Fix**
- [x] **Fault-injection / chaos test landed (C-8, 2026-06-19).** `ResilienceCircuitBreakerFaultInjectionTests` (Grpc.Tests) drives an always-failing dependency through the standard resilience handler and asserts the circuit breaker trips and short-circuits further calls; `OutboxProcessorTests.IntegrationEventPublishFailure_DegradesGracefully_BuffersForRedelivery` asserts the outbox buffers the event (retry++, left unprocessed) when the broker is unreachable instead of crashing the processor.
- [x] Add a default **`UseMessageRetry` (backoff + jitter)** in `ConfigureBrokerTransport`; expose a hook for consumers to tune it (`MessageBusSettings.RetryLimit`/`RetryMinIntervalSeconds`/`RetryMaxIntervalSeconds`). *(`UseDelayedRedelivery` deliberately omitted: accepted.)*
- [x] **Correct or remove** the misleading comment + log message. *(Done: `IntegrationEventConsumer.cs:59-60` + the doc-comments at `DependencyInjection.cs:401,408`.)*

### [x] #32 · Dependency & Supply-Chain Management: 3 → 4 (weight 3, framework) · **CLOSED on both axes (twenty-sixth-wave re-score, 2026-08-07: M4/I9 CONFIRMED)** → moved to the level-4 protect list
> _Stale-ledger catch-up, not a score move: the scorecard has carried §32 at Maturity 4 / Implementation 9 for many cycles while this single-axis-era heading stayed open. Every fix line below shipped long ago and was re-verified this run._
- ~~**(medium)** The safety-critical **MassTransit v8 pin** (`Directory.Packages.props:54-56`) is guarded only by a prose comment; a blanket "update all" once bumped it to v9.1.2, which crashes every broker-enabled host at startup, and CI never starts a broker, so the build stays green.~~ **RESOLVED:** the pin is a build gate (`Testing.Architecture/Bases/DependencyVersionTestsBase.cs:4-11`, subclassed in-repo) and lives in config too (`.github/dependabot.yml` semver-major ignores).
- ~~**(low)** No lock files or SBOM for 11 published packages; no documented breaking-change/SemVer policy or CHANGELOG.~~ **RESOLVED:** 29 committed `packages.lock.json` files; CycloneDX SBOM blocking in the release workflow; CHANGELOG + versioning policy published.

**Fix** *(the pin fix also closes #16's medium)*
- [x] Replace the exact pin with a **constrained range** `[8.5.5,9.0.0)`, **or** add a fitness test asserting the MassTransit major stays ≤ 8. → `DependencyVersionTestsBase` fails the build on a MassTransit major ≥ 9.
- [x] Enable **`RestorePackagesWithLockFile`** + commit lock files. → `Directory.Build.props:8-10`; 29 `packages.lock.json` committed (verified 2026-08-07).
- [x] Add a **CycloneDX SBOM** step to the release workflow. → blocking steps at `release.yml:53-56` (and `:130-133` for the MAUI job).
- [x] Publish a brief **versioning / breaking-change policy** + CHANGELOG. → `CHANGELOG.md` + `Website/docs-src/guides/common-VERSIONING.md`.

### [ ] #11 · Security
> _Stale-ledger catch-up (2026-08-23), not a score move: this heading still read "3 → 4" although the scorecard has carried §11 at Maturity 4 for many cycles. The heading stays open because the category sits in the implementation band at M4/I8 (implPriority 3); with the ticks below, all three Fix sub-items are now `[x]`, but that closes the historical maturity work, not the band row._
- *Gap (updated 2026-08-23):* the original gap line's three named items are all shipped (CI dependency-vuln gate, security fitness tests, SECURITY.md with an OWASP note, see the ticks below and the security invariants wave section). The remaining recorded Implementation caps are unchanged: vault/managed-identity secret binding is deployer-owned (correct for a library), and authorization is RBAC with capability indirection, not ABAC; the implementation-band lever stays "not yet identified, name it at the next re-score".

**Fix**
- [x] Add a `dotnet list package --vulnerable` (or restore `--audit`) **CI gate**. → shipped, verified 2026-08-23: `ci.yml:113` runs `dotnet list MMCA.Common.slnx package --vulnerable --include-transitive`, `:120` re-applies the `<NuGetAuditSuppress>` list read from `Directory.Build.props` (because `dotnet list --vulnerable` ignores suppressions), and `:127` fails the job (`::error::Non-suppressed vulnerable NuGet packages detected`) on any non-suppressed hit; it runs inside the required `build-and-test` context.
- [x] Add **NetArchTest security invariants** (no stray `[AllowAnonymous]`; no `AllowAnyOrigin` + `AllowCredentials`). → landed 2026-08-22, not as NetArchTest fluent rules (genuinely infeasible there) but as `AnonymousEndpointTestsBase` (full-name reflection, subclassed in Common and every consumer) plus executable CORS/JWT invariant tests running the real registrations; see the security invariants wave section.
- [x] Commit a **SECURITY.md** with an OWASP Top-10 review note. → shipped, verified 2026-08-23: `SECURITY.md:84-86` ("## OWASP Top 10": the framework reviewed against the OWASP Top 10 with the most relevant categories mapped).

### [ ] #7 · Microservices Readiness: Implementation 9 → 8 (weight 3)
> _Opened 2026-09-04 (thirty-second-wave re-score) by a rubric change, not by regressed work: rubric v2 added a criterion the framework does not meet as stated, so the row moved from Implementation 9 to 8 and entered the implementation band at implPriority 3. **Maturity 4 is unchanged and CI-enforced**: the transport rule body ships at `Rules/Layering/ArchitectureRules.Transport.cs:19`, is exposed as `Bases/Layering/MicroserviceExtractionTestsBase.cs:13` and subclassed at `MicroserviceExtractionTests.cs:11`, inside `MMCA.Common.slnx:52` and run at `ci.yml:144` under a required check. #7 moves out of the level-4 protect enumeration below and is tracked here instead while its implementation gap is live; the maturity closure it recorded there is not withdrawn._
- *Gap (2026-09-04):* the v2 criterion "Modernization patterns named" asks for an **Anti-Corruption Layer** at the boundary and the **Strangler Fig** route for extraction, new path beside old, traffic moved, old path retired (`ArchitectureEvaluationCriteria.md:263`, added by `ADR-110:55`). Neither term appears anywhere in MMCA.Common source, docs, or any ADR. The ACL is practised without being named: the gRPC extension point tells hosts to "register a hand-written adapter that implements the C# interface contract ... and delegates to this typed gRPC client" (`Grpc/DependencyInjection.cs:58`). ADR-008 documents a cutover instead of a strangler sequence ("Delete the combined `MMCA.ADC.WebAPI` host", `008-service-extraction-topology.md:33`). The other seven criteria are met at high quality, which is why the row sits at the top of the Strong band rather than lower.

**Fix**
- [ ] **(added 2026-09-04, thirty-second-wave re-score; implPriority 3 band, effort S)** **Name the two modernization patterns.** Call the gRPC adapter convention an Anti-Corruption Layer where it is documented (`Grpc/DependencyInjection.cs:58`) and record the Strangler Fig route in ADR-007/008 beside the existing cutover step. This is documentation of an existing practice, not new code, and it returns §7 to Implementation 9 (+3 weighted).

### [x] #4 · Domain-Driven Design (3 to 4; now Maturity 4, no confirmed red flags)
- *Gap (resolved):* no DDD-specific fitness functions; minor factory inconsistencies (`UserNotification.Create` returned a bare entity; `Money.operator+` throws on currency mismatch).

**Fix**
- [x] NetArchTest rules, aggregates expose **private ctors + factory methods**: `AggregateConventionTests` / `EntityConventionTests` assert `DomainExposesAggregateRoots`, `AggregateRootsHaveResultFactory`, and `DomainAggregateRootsHaveNoPublicConstructors` (`Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Entities.cs`).
- [x] Normalize the factory convention to **always return `Result<T>`**: every `Create` factory across Domain + Shared already returns `Result<T>` (8 types: `Address`, `DateRange`, `DateTimeRange`, `Email`, `Money`, `PhoneNumber`, `PushNotification`, `UserNotification`). Locked in by the new `DomainFactoriesReturnResult` fitness function (generalizes the aggregate-only check to value objects, wired into both `AggregateConventionTestsBase` and `EntityConventionTestsBase`), so a future bare-value-object/entity factory fails the build.
- ~~*no cross-aggregate navigation properties*~~ is **deliberately not enforced** (see *Deliberate / accepted* below). Cross-aggregate object navigation is an accepted design feature: aggregate roots reference other roots via `[Navigation]` FK references loaded by the navigation populators (ADR-002), for example `Session.Event` / `Session.Room` in ADC. A strict rule would contradict ADR-002 and break the consumers' 15 aggregates. `Money.operator+` keeps throwing by design (a C# operator cannot return `Result<T>`), and `Money.Add(...)` is the documented `Result`-returning path (covered by `Addition_DifferentCurrencies_ThrowsInvalidOperationException` / `Add_DifferentCurrencies_ReturnsFailure`).

### [x] #18 · UI Architecture & Component Design: 3 → 4 · **CLOSED on both axes (twenty-sixth-wave re-score, 2026-08-07: M4/I9 CONFIRMED)** → moved to the level-4 protect list
> _Stale-ledger catch-up, not a score move: the scorecard has carried §18 at Maturity 4 / Implementation 9 while this heading stayed open._
- ~~*Gap:* no bUnit/render tests; component conventions review-only.~~ **RESOLVED:** the shared #28 work shipped the coverage (see below).

**Fix**
- [x] **(shared with #28)** add bUnit coverage for the primitives. → `Tests/Presentation/MMCA.Common.UI.Tests/Components/` (`PrimitivesTests.cs`, `MobileCardListTests.cs`, `MobileInfiniteScrollListTests.cs`, `UnsavedChangesGuardTests.cs`, over `BunitTestBase.cs`; verified 2026-08-07).
- [ ] Consider an analyzer/convention check for `EditorRequired` contracts on shared components. *(Recorded residual, deferred low-value on the third wave: a "consider", not a gate; carried on the protect entry rather than as open work.)*

### [x] #19 · State Management & Data Flow · **CLOSED on both axes (thirtieth-wave re-score, 2026-08-31: M4/I9)** → moved to the level-4 protect list
- **(low)** `UnsavedChangesGuard` exposes `IsDirty` only as a `[Parameter]`; `HandleBeforeInternalNavigationAsync` reads it one render late, so clearing dirty + `NavigateTo` *without* an intervening `StateHasChanged()` still shows the dialog. `Source/Presentation/MMCA.Common.UI/Components/UnsavedChangesGuard.razor:24,38-55`. Untested. *(This is the known param-lag foot-gun.)*

**Fix**
- [x] Add an optional **`Func<bool>?` live-accessor** parameter so the guard reads current dirty state at navigation time. → shipped: `UnsavedChangesGuard.razor:34` (`[Parameter] public Func<bool>? IsDirtyAccessor`), `:36` (`CurrentIsDirty => IsDirtyAccessor?.Invoke() ?? IsDirty`), `:52` (the navigation-time read), with `:17` additionally binding `ConfirmExternalNavigation="@CurrentIsDirty"`. Anchors corrected 2026-08-31 (drifted by one line); first verified 2026-08-14.
- [x] Cover with a **bUnit test**. → `Tests/Presentation/MMCA.Common.UI.Tests/Components/UnsavedChangesGuardTests.cs:17,38` covers both accessor states.
- *(Closure note, 2026-08-31 thirtieth wave: the category leaves the implementation band at Implementation 9. The staleness-policy gap that held it at 8 is closed by the shipped `IUiReadCache` layer, `Source/Presentation/MMCA.Common.UI/Services/Caching/IUiReadCache.cs:32,51,59,66` (read-through Get/Set, `InvalidatePrefix` on successful writes, `Clear` on sign-out), registered unconditionally by `AddCommonUI` with config-bound TTLs and covered by 27 unit tests in the CI-gated `MMCA.Common.UI.Tests`, plus `NotificationState.IsStale`/`MarkStale` gating the bell's per-navigation refetch.)*

---

## 🟡 Priority 2: score 3, weight 2 (polish / hardening)

### [x] #6 · CQRS & Event-Driven · **CLOSED on both axes (twenty-seventh-wave re-score, 2026-08-14: M4/I9 CONFIRMED)** → moved to the level-4 protect list
- **(medium)** No consumer-side idempotency/inbox for at-least-once broker delivery: duplicate side effects possible in any non-idempotent consumer. **(low)** ~~Same misleading "MassTransit will retry" comment.~~ *(Gone: a repo-wide search returns zero matches for that string under `MMCA.Common/Source`, verified 2026-08-14.)*
- [x] Ship an optional **EF-backed inbox/dedup filter** keyed on a message id; add a unique **event Id** to base events. → shipped: `Source/Core/MMCA.Common.Infrastructure/Persistence/Inbox/EfInboxStore.cs:18` (ADR-021), the dedup check at `IntegrationEventConsumer.cs:42` and `MarkProcessedAsync` at `:78` (re-verified 2026-08-14). Opt-in and off by default (`MessageBusSettings.EnableInbox`, `MessageBusSettings.cs:64` + the registration gate at `DependencyInjection.cs:686`), which is the recorded reason §6's Implementation holds at 9, not 10.
- *(Closure note: the 2026-08-07 entry deferred this move only because §6's verdict that cycle was FLAG; the twenty-seventh-wave re-score returns CONFIRMED at M4/I9, so the deferral condition is met and the category sits in neither band.)*

### [~] #16 · ~~Maintainability & Evolvability~~ · **RETIRED 2026-09-04 (rubric v2, [ADR-110](../adr/110-rubric-v2-category-realignment.md))**
> _§16 is now **AI-Native Application Architecture** and N/A for this repo, so this heading is a record of finished work rather than open work: its coupling and tech-debt criteria moved to #34, upgrades to #32 and onboarding to #33, and its row in the implementation band is struck through. Both sub-item halves below were already proven on 2026-08-31; nothing here is scheduled. See the `[accepted]` entry under *Deliberate / accepted*._
- **(medium)** Blanket NuGet update reintroduced known-bad MassTransit v9 (commit `87d54ee`): fixed by a comment, not a rule. **(low)** No CHANGELOG/breaking-change policy for 11 published packages.
- [x] **Closed by the #32 pin fix** + add a per-release **CHANGELOG**. *(Left open 2026-08-23: the
  CHANGELOG half is demonstrably behind, the newest versioned heading is `[1.158.0] - 2026-08-21`
  (`CHANGELOG.md:80`) while the framework is v1.160.0 with the shipped content parked under
  `[Unreleased]` (`:7`); see the #34 backfill item added this cycle. The #32 pin half was not
  re-read this run, so no claim is made about it.)* **Both halves proven 2026-08-31
  (twenty-ninth-wave re-score):** the pin half by the live fitness method
  `MassTransit_MustNotExceed_MajorVersion8` (`DependencyVersionTestsBase.cs:17-32`, the assertion at
  `:25`), and the CHANGELOG half per the #34 backfill closure above (`CHANGELOG.md:7,691,716`).
  *(Ticking this sub-item is NOT a category closure: #16 stays open and keeps its live row in the
  implementation band at M4/I8.)*

### [ ] #13 · Observability & Operability
- **(low)** The outbox dead-letter Meter `MMCA.Common.Outbox` is created but no `AddMeter` call exists → the dead-letter counter is **never exported** (contradicts CLAUDE.md); mitigated by an Error-level log.
- [x] Add **`AddMeter("MMCA.Common.Outbox")`** to `WithMetrics`; emit **RED histograms** for command/query latency. → shipped: `Source/Hosting/MMCA.Common.Aspire/Extensions.cs:159` registers the meter (verified 2026-08-07); RED command/query metric parity landed earlier (twentieth wave). The category stays in the implementation band at 4/8 (SLO alerting/dashboards and runbooks remain deployer-owned).

### [ ] #17 · DevOps & Deployment
- **(low)** Security/audit only implicit (no Dependabot/CodeQL/audit step).
- [x] Add **Dependabot** + an explicit audit job; push **`.snupkg`** symbol packages (currently built but never published). → shipped, verified 2026-09-01 (thirty-first-wave re-score): Dependabot at `.github/dependabot.yml:4` (nuget) and `:85` (github-actions); the explicit audit job at `ci.yml:113` (`dotnet list --vulnerable --include-transitive`), `:120` (re-applies the `NuGetAuditSuppress` list) and `:127` (fails the job on a non-suppressed hit). The `.snupkg` half is superseded by design, not outstanding: `Directory.Build.props:62` sets `<DebugType>embedded</DebugType>`, so there is no symbol package to publish. Ticking this does NOT close #17: it stays in both bands (M3 priority 2, I8 implPriority 2).
- [ ] **(added 2026-08-01, twenty-fifth-wave re-score; effort S)** **Fix the reference Bicep's dangling secret binding.** `samples/deployment/main.bicep:143` sets `secretRef: 'sql-conn'` on a Container App env var, but the template declares no `secrets` array (re-verified still open 2026-09-04, thirty-second wave: the `secretRef` binding is unchanged at `main.bicep:143` and a search of the template returns no `secrets:` declaration) anywhere (the `configuration` block at `:129-133` carries only ingress and registries), so the shipped reference template would be rejected at deploy time. Blocker: none, and `az bicep build` cannot catch it (the `sample-deployment-validate` job is a compile check, `ci.yml:595-609`). Resolution path: declare the `secrets` array (Key Vault reference per `DEPLOYMENT.md`'s own guidance) or drop the `secretRef` in favor of a documented placeholder. This is the same class of gap the twenty-first wave logged under §11 ("the sample's Key Vault secret binding is still dangling"), now pinned to its exact lines under the category that owns the sample. *(Re-verified open 2026-08-07, anchors exact: `main.bicep:143` still sets `secretRef: 'sql-conn'`, the `configuration` block at `:129-133` still carries only ingress and registries, and a content search of the template returns no `secrets` array.)* *(Re-verified open 2026-08-14, anchors exact: `main.bicep:143` still sets `secretRef: 'sql-conn'` and the template still declares no `secrets` array; the only §17 diff this cycle is five documentation lines in `DEPLOYMENT.md`.)* *(Re-verified open 2026-08-23, anchor exact: `main.bicep:143` still sets `{ name: 'ConnectionStrings__SQLServerConnectionString', secretRef: 'sql-conn' }` and a content search of the template returns no `secrets` array.)* *(Re-verified still open 2026-08-31, twenty-ninth-wave re-score, anchors exact: `main.bicep:143` still sets `{ name: 'ConnectionStrings__SQLServerConnectionString', secretRef: 'sql-conn' }`, the `configuration` block at `:129-133` still carries only `ingress` and `registries`, and the template still has no `secrets` array (the only mentions are prose at `:4-5,65-66`).)* *(Re-verified still open 2026-08-31, thirtieth-wave re-score, anchors exact: `main.bicep:143` still sets `{ name: 'ConnectionStrings__SQLServerConnectionString', secretRef: 'sql-conn' }`, the `configuration:` block still opens at `:129`, and a content search of the template returns no `secrets:` array; #17 keeps its rows in BOTH bands, M3 priority 2 and I8 implPriority 2.)* *(Re-verified still open 2026-09-01, thirty-first-wave re-score, anchors exact: `main.bicep:143` still sets `{ name: 'ConnectionStrings__SQLServerConnectionString', secretRef: 'sql-conn' }`, the `configuration:` block still opens at `:129`, and a content search of the template returns no `secrets:` array; the validate job's anchors moved to `ci.yml:735,739`; #17 keeps its rows in BOTH bands.)*

### [x] #9 · API & Contract Design · **CLOSED at Maturity 4 (2026-08-22, MMCA.Common PR #271)** → moved to the level-4 protect list
- **(low)** `ServiceContractAttribute` documents architecture-test enforcement that **does not exist**.
- [x] Implement the **NetArchTest rule** (or remove the claim); add **OpenAPI generation + a contract snapshot test**. → both halves shipped in-repo via MMCA.Common PR #271 (squash `8a6c603`). **The contract snapshot:** `Tests/Presentation/MMCA.Common.API.Tests/OpenApi/OpenApiBaselineTests.cs:45-77` boots a probe host through the real `AddCommonOpenApi`/`MapCommonOpenApi` pipeline (`OpenApiProbeHost.cs:20`), normalizes `/openapi/v1.json` and fails on any diff against the committed `Tests/Presentation/MMCA.Common.API.Tests/OpenApi/openapi-baseline.v1.json`, regenerated only by setting `MMCA_UPDATE_OPENAPI_BASELINE=1` in the same pull request (`OpenApiBaselineTests.cs:38,153-162`); it is scoped to the framework-owned surface by design, each consumer host keeping its own concrete-surface snapshot tier (the two-level guard is recorded at `Source/Presentation/MMCA.Common.API/Startup/OpenApiEndpointExtensions.cs:12-19`). **The NetArchTest rule:** `ServiceContractsDoNotDependOnServiceInternals` fails the build, naming the offending type, when a `[ServiceContract]` type reaches into a mapped Domain/Application/Infrastructure namespace (`Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Contracts.cs:32`), exposed as `Bases/ServiceContractPurityTestsBase.cs:24-26` and subclassed in-repo at `Tests/Architecture/MMCA.Common.Architecture.Tests/ServiceContractPurityTests.cs:11`; the attribute's docstring no longer claims a non-existent rule (`Source/Core/MMCA.Common.Shared/Abstractions/ServiceContractAttribute.cs`), and the vacuous in-repo pass (no MMCA.Common type carries the attribute yet) is documented rather than hidden. Both test projects sit in the CI-gated unit tier (`MMCA.Common.slnx:36,46`), and `FACTS.md` regenerated to **110 fitness methods across 38 `*TestsBase` classes**. **M3 → 4 granted** (weighted 6/18 → 8/18, Maturity index 314 → 316/324, 96.9% → 97.5%); Implementation holds at 9. Follow-up, not a blocker: consumer subclassing of `ServiceContractPurityTestsBase` (and optional `[ServiceContract]` adoption on the seven `*.Contracts` projects) rides the next release sweep.
- *(Historical, re-verified open 2026-07-28, twenty-fourth-wave re-score; maturity band, priority 2)* Both halves stood at that time. The `[ServiceContract]` rule is still absent by the attribute's own docstring (`ServiceContractAttribute.cs:6-10`), and the contract-drift gate stays deliberately consumer-owned: the framework's comment records the delegation (`OpenApiEndpointExtensions.cs:12-14`) and the shipped `OpenApiContractTestsBase` has no MMCA.Common subclass anywhere under `Tests/`. The only CI-gated §9-adjacent tests are two DI-registration facts for `AddCommonApiVersioning` (`WebApplicationBuilderExtensionsTests.cs:17,29`), which assert registration presence and a fluent return rather than any contract property, so the M3→4 lift was refuted again. Either lever closes it: a minimal in-repo contract-surface fitness check over the framework-owned pieces, or a documented acceptance mirroring #31's treatment.

### [x] #20 · Design System & UI Consistency · **CLOSED on both axes (twenty-sixth-wave re-score, 2026-08-07: M4/I9 CONFIRMED, score-driven closure like #10's)** → moved to the level-4 protect list
> _The category sits in neither band under the live scores (M4, I9), so the heading closes; the residual below is NOT shipped and stays visible on the protect entry._
- **(low)** Bootstrap chrome (NavMenu top bar/hamburger) coexists with MudBlazor in the shared package.
- [ ] Migrate remaining **Bootstrap chrome → MudBlazor**, drop the bundled Bootstrap CSS; source the brand hex from one token. *(Re-verified open 2026-07-28: Bootstrap is still bundled at `Source/Presentation/MMCA.Common.UI/wwwroot/lib/bootstrap/dist/css/bootstrap.min.css` and still referenced by `Layout/NavMenu.razor.css`. Anchor corrected: the first residual `!important` is now `wwwroot/app.css:124`, with raw hex persisting at `:4-16,60,72,76`.)* *(Re-verified open 2026-08-07: Bootstrap 5.3.3 still bundled at `bootstrap.min.css:2`, `NavMenu.razor.css:23` still compensates for Bootstrap's `.navbar` flex-wrap; the `app.css` anchors were not re-checked this cycle and stay as written.)* *(Re-verified open 2026-08-14: Bootstrap still bundled at `wwwroot/lib/bootstrap/dist/css/bootstrap.min.css` and `NavMenu.razor.css:23` still compensates for its `.navbar`; the `app.css` `!important`/raw-hex anchors were again not re-checked and stay as written.)*

### [x] #23 · Front-End Performance: CLOSED at Maturity 4 (nineteenth-wave re-score, 2026-07-15) → moved to the level-4 protect list
- ~~**(low)** `MobileInfiniteScrollList` appends every page into one `MudStack` with **no virtualization/cap**.~~ **RESOLVED (third wave):** `MaxRenderedItems` (default 500) bounds DOM growth.
- [x] Add **`Virtualize`** windowing or a rendered-item cap. → the `MaxRenderedItems` cap (third wave), **and the §23 measurement gate is confirmed:** `WebVitalsE2ETests` asserts LCP/TTFB/CLS budgets inside the blocking chromium `ui-e2e` job (`Tests/Presentation/MMCA.Common.UI.E2E.Tests/WebVitalsE2ETests.cs:43`, `.github/workflows/ci.yml:105-115`), so the remediation-wave-1 maturity 3→4 candidacy is confirmed and applied to the scorecard table.

### [x] #33 · Developer Experience & Inner Loop: **CLOSED at Maturity 4 / Implementation 9 (twentieth-wave re-score, 2026-07-17)** → moved to the level-4 protect list
- **(low, residual, recorded not scheduled)** The package local-dev swap list (fifteen packages per `FACTS.md`; the "11-package" count here had gone stale) is hand-maintained three times in each consumer's `Directory.Build.targets` and can silently drift. *(Partially mitigated: the required `consumer-source-build` canary now fails the merge if the Helpdesk `UseLocalMMCA` swap breaks.)*
- [ ] **Generate the list from a glob**, or add a smoke test that the `UseLocalMMCA` swap resolves all packages.
- [x] **(2026-07-14, partial)** A `consumer-source-build` CI canary now builds MMCA.Helpdesk against the PR's framework source via `UseLocalMMCA` (`.github/workflows/ci.yml:262`, documented in `CONTRIBUTING.md:74`), catching cross-repo source-mode breakage in CI. It is advisory (`continue-on-error: true`); the nineteenth-wave re-score held §33 at M3/I8 (an advisory gate does not clear the automatic-enforcement or Exemplary bars, and the Aspire-headless-hang plus library-not-runnable caps stand). Promote it to a required gate once proven reliably green. **PROMOTED 2026-07-16:** `continue-on-error` removed and the "Consumer source build (Helpdesk)" context added to branch protection after 9 consecutive green runs since introduction (2026-07-14), so a framework change that breaks a source-mode consumer now blocks the merge automatically. **SCORE-CONFIRMED (twentieth-wave re-score, 2026-07-17): §33 is M4/I9** (the promotion verified in live branch protection; the headless-hang and library-not-runnable notes stand as impl caps only, holding I9 short of 10).

### [ ] #34 · Architecture Governance & Documentation
- **(low ×2)** `Docs/Architecture/ArchitecturalAnalysis.md` contradicts the code on DB-per-service ("deliberately not database-per-service," race "only mitigated"); the two biggest recent decisions (DB-per-service, gRPC extraction) lack ADRs.
- [~] Refresh the analysis doc; write the **two missing ADRs**; add an ADR index/template. *(Partially closed 2026-09-01, thirty-first-wave re-score: the two ADRs exist at `Website/docs-src/adr/006-database-per-service.md` and `007-grpc-extraction.md`, and the ADR index is `Website/docs-src/adr/README.md`. Still open: no ADR template file exists under `docs-src/adr/` (the index's 'Writing a new ADR' section is prose, not a template), and the analysis-doc refresh targets the uncommittable workspace-root map, which is #34's own band lever and now contradicts the gated facts, stating the framework grew to 13 published packages against 17 at `FACTS.md:19`, `Docs/Architecture/ArchitecturalAnalysis.md:5`.)*
- [x] **(added 2026-08-23, twenty-eighth-wave re-score; priority 2 band, effort S)** **Backfill the CHANGELOG: two shipped releases have no versioned section.** `CHANGELOG.md:7` (`## [Unreleased]`) carries the v1.160.0 forgot-password vertical content while the newest versioned heading is `## [1.158.0] - 2026-08-21` (`CHANGELOG.md:80`) against an actual **v1.160.0** (`FACTS.md:4,14`), so v1.159.0 and v1.160.0 ship with no release notes. Same class as the (closed) 2026-06-26 and 2026-06-27 CHANGELOG-backfill hygiene items, recurring; also the live blocker on #16's still-open per-release-CHANGELOG sub-item. The fix lands in the MMCA.Common repo (move the shipped content into `## [1.159.0]` / `## [1.160.0]` sections), not here. **CLOSED 2026-08-31 (twenty-ninth-wave re-score):** both missing sections now exist, `## [1.160.0] - 2026-08-22` at `CHANGELOG.md:691` and `## [1.159.0] - 2026-08-22` at `CHANGELOG.md:716`; the ledger head is `## [1.174.0] - 2026-08-30` (`CHANGELOG.md:7`), matching the live **v1.174.0** (`FACTS.md:4,14`), and no `## [Unreleased]` heading remains.
- [ ] **(added 2026-07-25, twenty-third-wave re-score; priority 2 band, effort S)** **Re-sync the governance prose to the generated FACTS and the current ADR corpus.** The CI-gated `FACTS.md` is the source of truth for these numbers and the governance docs had drifted five minor versions behind it: this backlog's header line self-dated framework v1.123.0 while `FACTS.md:4,14,44` reports **v1.128.0 and 93 fitness methods across 30 bases (Common runs 56)** (the per-wave Progress sections below keep their period-accurate counts as provenance and are not restated); the scorecard's §14 row read "85 methods across 28 abstract bases, Common's own build executes 49" against the same `FACTS.md:44` figures; and the scorecard's §16 and §34 rows read "ADRs 001-051" against an actual corpus of **001-055** (`Website/docs-src/adr/052-background-job-execution.md` through `055-repository-and-specification-contract.md`). **All four corrected in the 2026-07-25 refresh of both files**; the item stays open to cover the one residual: `FACTS.md:20` (emitted by `build/facts/FactsGenerator.cs:208`) still describes the packages as "Released in lockstep to GitHub Packages", while `release.yml:86-88` and `:162-165` push every release to nuget.org as well (ADR-053). That string is generated, so the fix is a one-line change in the generator plus a FACTS regen, landed in the MMCA.Common repo rather than here. This is doc drift of the class #34 already tracks, not an enforcement gap, so §34 holds at M4/I8. **Scope widened 2026-07-28 (twenty-fourth-wave re-score):** the residual is verbatim unchanged (`FactsGenerator.cs:208` still emits the GitHub-Packages-only string, reproduced at `FACTS.md:20`, while `release.yml:81-88,157-165` pushes to nuget.org as well), and the drift recurred: the governance prose had fallen three minor versions behind again (fitness counts read 93/30/56 against an actual **96 methods across 31 bases, Common runs 61**, per `FACTS.md:44,47`; the §16 and §34 ADR range read 001-055 against an actual **001-060**), plus six drifted evidence anchors in the scorecard (§9's `AddCommonOpenApi` and header-versioning lines, §13's `AddWarmupReadiness` call site, §17's `sample-deployment-validate` comment and step lines). All corrected in the 2026-07-28 refresh. The recurrence is the argument for fixing the generator string rather than re-syncing prose each cycle. **Re-checked 2026-08-01 (twenty-fifth-wave re-score):** the residual is still verbatim unchanged (`FactsGenerator.cs:208` → `FACTS.md:20`, while `release.yml:86-88,162-165` pushes to nuget.org as well), the fitness counts did NOT drift this cycle (96/31/61 still matches `FACTS.md:44,47-48`), but the version and ADR-range figures drifted again (this ledger self-dated v1.131.0 against an actual v1.135.0; the ADR corpus read 001-060 against an actual **001-064**), both corrected in the 2026-08-01 refresh. **Re-checked 2026-08-07 (twenty-sixth-wave re-score): the residual is still verbatim unchanged (`FACTS.md:20`), and the drift recurred with new figures**: this ledger self-dated v1.135.0 against an actual **v1.142.0** (`FACTS.md:4,14`), the fitness counts read 96/31/61 against an actual **100 methods across 32 bases, Common runs 78** (`FACTS.md:44-48`), and the ADR corpus read 001-064 against an actual **001-070** (through `070-fail-fast-configuration-contract.md`). One structural change to record: `FACTS.md` no longer states an ADR range itself, it delegates the count/range to the Website ADR index (`FACTS.md:38-41`), so the ADR-range figure is now cited from `docs-src/adr/README.md` rather than FACTS. All corrected in the 2026-08-07 refresh; the recurrence (a fourth consecutive cycle of figure re-sync) remains the argument for fixing the generator string rather than re-syncing prose each cycle. **Re-checked 2026-08-14 (twenty-seventh-wave re-score): the residual is still verbatim unchanged (`FACTS.md:20` still reads "Released in lockstep to GitHub Packages" while releases also push nuget.org, ADR-053), and the figure drift recurred a fifth consecutive cycle**: this ledger self-dated v1.142.0 against an actual **v1.152.0** (`FACTS.md:4,14`) and the ADR corpus read 001-070 against an actual **001-078** (`docs-src/adr/README.md`, files 071-078 present); the fitness counts did NOT drift this cycle (100 methods across 32 bases, Common runs 78, still matching `FACTS.md:44,47`). Both corrected in the 2026-08-14 refresh. **Re-checked 2026-08-23 (twenty-eighth-wave re-score): the `FACTS.md:20` residual was not re-read this run and stands as recorded; the figure drift recurred a sixth consecutive cycle**: this ledger self-dated v1.152.0 against an actual **v1.160.0** (`FACTS.md:4,14`) and the ADR corpus read 001-078 against an actual **001-096** (`docs-src/adr/README.md`, through `096-best-effort-side-effects.md`); the shared fitness counts did not drift (110 methods across 38 bases, updated with the 2026-08-22 §9 entry, still matches `FACTS.md:44`) but Common's own executed count is now **129**, not 78 (`FACTS.md:47`). All corrected in the 2026-08-23 refresh. **Re-checked 2026-08-31 (twenty-ninth-wave re-score): the generator residual is verbatim unchanged and the drift recurred a seventh consecutive cycle, with new figures**: `build/facts/FactsGenerator.cs:208` still emits "Released in lockstep to GitHub Packages" while releases also push nuget.org (ADR-053), reproduced at `FACTS.md:20`; the governance prose self-dated v1.160.0 against an actual **v1.174.0** (`FACTS.md:4,14`); the fitness counts read 110 methods across 38 bases with Common running 129, against an actual **121 methods across 45 bases, Common runs 178** (`FACTS.md:46,49`); the package count is **17** (`FACTS.md:19`); and the ADR corpus read 001-096 against an actual **001-104**. The scorecard and backlog headers were re-synced by that refresh; the generator residual and the workspace-map staleness stayed open, and the seventh recurrence remained the argument for fixing the generator string rather than re-syncing prose each cycle. **Re-checked 2026-08-31 (thirtieth-wave re-score): the generator residual is CLOSED**: `build/facts/FactsGenerator.cs:208` now emits "Released in lockstep to nuget.org and GitHub Packages (dual-registry, ADR-053; ...)", reproduced verbatim at `FACTS.md:20`, ending the seven-cycle residual. The figure drift recurred an eighth consecutive cycle: this ledger self-dated v1.174.0 with 121 fitness methods across 45 bases and Common running 178, against an actual **v1.175.0** (`FACTS.md:4,14`), **122 methods across 46 abstract bases** (`FACTS.md:46`) and **Common executing 187** (`FACTS.md:49`); the package count (**17**, `FACTS.md:19`) and the ADR corpus (**001-104**, `docs-src/adr/`) did not drift and needed no edit. All corrected in this 2026-08-31 thirtieth-wave refresh. The workspace-map staleness half was not re-read this run and stands as recorded; #34 stays open in the implementation band at M4/I8 (its band lever, the uncommittable workspace-root `ArchitecturalAnalysis.md` cap, is unchanged). The figure drift recurred a ninth consecutive cycle: this ledger self-dated v1.175.0 with 122 fitness methods across 46 bases, Common running 187 and an ADR corpus of 001-104, against an actual **v1.179.0** (`FACTS.md:4,14`), **123 methods across 46 abstract bases** (`FACTS.md:46`), **Common executing 196** (`FACTS.md:49`) and **ADRs 001-106** (`Website/docs-src/adr/106-extension-members-as-public-di-surface.md`); the package count (17, `FACTS.md:19`) did not drift. All corrected in this 2026-09-01 thirty-first-wave refresh. New this cycle, the drift has spread beyond governance prose into the living documentation, which is §34 red-flag material (docs that contradict the code) and the fresh reason the 8→9 lift was refuted: the onboarding primer restates "fifteen NuGet packages" at `Website/docs-src/onboarding/00-primer.md:15,243` (its source of truth is `Docs/Onboarding/parts`, so the fix goes through `/update-onboarding`, never a hand edit to the rendered chapter), and the workspace map at `Docs/Architecture/ArchitecturalAnalysis.md:5` says 13. The scorecard's own executive summary carried the same stale "fifteen" and is corrected to seventeen in this refresh. #34 stays open in the implementation band at M4/I8. **Re-checked 2026-09-04 (thirty-second-wave re-score): the figure drift recurred a tenth consecutive cycle**: this ledger self-dated v1.179.0 with 123 fitness methods across 46 bases, Common running 196 and an ADR corpus of 001-106, against an actual **v1.185.0** (`FACTS.md:4,14`), **124 methods across 47 abstract bases** (`FACTS.md:46`), **Common executing 197** (`FACTS.md:49`) and **ADRs 001-110** (`Website/docs-src/adr/README.md:117`); the package count (17, `FACTS.md:19`) did not drift. All corrected in this 2026-09-04 refresh. The living-documentation half is now **half closed**: the onboarding primer reads "seventeen NuGet packages" and delegates the count to FACTS (`Website/docs-src/onboarding/00-primer.md:15`, fixed through the onboarding pipeline as required), and `Docs/WorkspaceReference.md:18` states no package count at all, it links FACTS instead; still open is the workspace map, which says 13 packages at v1.82.0 (`Docs/Architecture/ArchitecturalAnalysis.md:49,99`) and is uncommittable workspace reference, the same cap that holds #34 at I8. The ADR-template sub-item above stays `[~]`: re-verified 2026-09-04, no template file exists under `Website/docs-src/adr/`.
- [x] **(added and CLOSED 2026-07-21, twenty-first-wave re-score; priority 2 band, effort S)** **Sync `CONTRIBUTING.md`'s required-merge-gate list and its branch-protection reproduce snippet with live protection.** **DONE (MMCA.Common PR #100, merged `658786b`, all 8 required gates green):** the prose list now names all eight gates with webkit marked as promoted 2026-07-16 and the perf gate described against `Tests/Performance/perf-baseline.json`; the reproduce snippet was extended to the same eight contexts and verified byte-identical against the live protection API; and a line now directs readers to `gh api repos/ivanball/MMCA.Common/branches/main/protection` as authoritative over the committed copy, which is the durable fix for this class of drift. Original finding: Live `required_status_checks` on `main` carries 8 contexts (`build-and-test`; `Build MMCA.Common.UI.Maui (windows, 4 TFMs)`; UI a11y + render smoke on chromium, firefox, and webkit; `coverage`; `Consumer source build (Helpdesk)`; `Performance gate (BenchmarkDotNet Short + baseline verify)`), but the doc lists five gates and still calls webkit advisory (`CONTRIBUTING.md:57-64`), and the reproduce snippet omits webkit, the Helpdesk canary, and the perf gate (`CONTRIBUTING.md:104-112,124`). `ci.yml:116-118` already asserts all three engines are required, so the workflow and the doc disagree. This is load-bearing beyond hygiene: scorecard adjudications cite this file, and its staleness is exactly why §12 was held at Maturity 3 for a cycle after its gate was in fact promoted. Prefer the branch-protection API over the committed snippet when adjudicating.

### [x] #5 · Vertical Slice Architecture, **DONE (eighth wave: impl 7→8 AND maturity 3→4)** → moved to the level-4 protect list
- [x] Slice-cohesion fitness function added: `ArchitectureRules.Slices.cs` + `SliceCohesionTestsBase` (shared package, the 18th fitness base) + Common/ADC subclasses, fails the build if a handler/validator is stranded from its same-assembly contract. Because this is automatic CI enforcement of the slice convention, §5 maturity also rose 3→4 (the rubric's maturity-4 "enforced automatically by tests/CI" bar), so §5 now belongs in "Already at level 4: protect, don't regress" below.

### [x] #12 · Performance & Scalability: **CLOSED at Maturity 4 / Implementation 8 (twenty-first-wave re-score, 2026-07-21)** → back on the level-4 protect list *(reopened 2026-07-15 by the nineteenth-wave Maturity 4→3 recalibration; open for two cycles)*
- [x] BenchmarkDotNet smoke project added (`Tests/Performance/MMCA.Common.Benchmarks`, outside the .slnx). Max-page-size guard already shipped at v1.84.0 (`ApplicationSettings.MaxPageSize` clamp + `EntityQueryPipeline.MaxUnboundedResultLimit`).
- [x] ~~Maturity 3→4 via the build-gating `performance-smoke` job.~~ **RECALIBRATED 4→3 (2026-07-15):** the job is present and blocking on every push/PR with no `continue-on-error` (`.github/workflows/ci.yml:175`), but it is a runs-clean smoke (`--job Dry`; fails only if a benchmarked path throws or no longer compiles, `ci.yml:172,193`), not a latency-regression gate, so it does not automatically enforce the performance property the rubric maturity-4 bar requires. No work was lost; the recalibration rests entirely on the smoke-vs-regression distinction, and the shipped guards (smoke gate, page-size clamp, unbounded-query ceiling) keep Implementation at 8.
- [x] **Add a latency-regression gate** (a committed baseline plus tolerance threshold) over the BenchmarkDotNet hot paths to restore §12 to Maturity 4. Blocker: none, pure CI + baseline work; effort M. **DONE (2026-07-16):** the `performance-smoke` CI job now runs the suite with `--job Short --exporters json` and a second step (`build/perfgate`, dependency-free like `build/facts`) fails the job against the committed `Tests/Performance/perf-baseline.json`: deterministic per-benchmark allocation ceilings (0 / 8000 / 4500 B/op) plus a machine-independent ratio floor (the compiled-expression cache must stay at least 1000x ahead of the recompile anti-pattern; measured ~120,000x), so a broken cache or an allocation storm reds the job instead of running clean. Verified green on real results and red on a seeded ceiling violation. ~~Maturity 3 → 4 candidacy recorded for the next re-score.~~ **Candidacy DECLINED (twentieth-wave re-score, 2026-07-17):** the job's context is absent from the live `required_status_checks` list (branch-protection API; `CONTRIBUTING.md:57-62` agrees), so a red perf gate does not block a PR merge and the rubric's merge-gate bar is unmet; §12 holds M3/I8.
- [x] **Promote the perf-gate job context to branch protection's required checks**, the same promotion path firefox (2026-07-12), webkit (2026-07-16), and the consumer-source-build canary (2026-07-16) completed. **DONE, verified 2026-07-21:** the live `required_status_checks` list on `main` carries 8 contexts including `Performance gate (BenchmarkDotNet Short + baseline verify)`, matching the job name at `.github/workflows/ci.yml:179` exactly, and the job carries no `continue-on-error` (`ci.yml:196-204`), so a baseline violation now blocks the merge. **§12 restored to Maturity 4 on the twenty-first-wave re-score**; Implementation holds at 8 because load and stress timing against realistic volumes stays a consumer-app concern.
- [x] **(residual, doc half of the promotion)** Add the perf-gate context to `CONTRIBUTING.md`'s required-checks list. **DONE (closed by PR #100; verified 2026-07-23):** `CONTRIBUTING.md:57-66` now lists all **eight** required contexts including the perf gate, webkit, and the `Consumer source build (Helpdesk)` canary, and the branch-protection reproduce snippet (`CONTRIBUTING.md:113-123`) matches. The shared doc-sync item under #34 is satisfied for this piece; it never held §12's score.

### [x] #17 · DevOps & Deployment: **DONE (eighth wave, impl 7→8)**
- [x] In-repo reference deployment sample added: `samples/deployment/{foundation,main}.bicep` (lint clean via `az bicep build`) + `DEPLOYMENT.md` (OIDC federated-credential + UAMI bootstrap + smoke-gate/auto-rollback). (Deeper CD-to-Azure lives in consumer repos.)
- [x] **Sample kept continuously valid in CI (2026-07-16):** the new `sample-deployment-validate` job compiles both templates with `az bicep build` on every push/PR, so the §17 reference cannot rot silently (the former lint-clean claim was a point-in-time check). A credentialed what-if/deploy stays consumer-side by design. ~~§17 impl 8→9 candidacy recorded for the next re-score.~~ **Candidacy DECLINED (twentieth-wave re-score, 2026-07-17):** the validate job is a compile check, not new deployment execution, so §17 holds M3/I8 (a first-pass M3→4 proposal was also refuted on the same evidence: the workflow's own comment states a real what-if/deploy stays a consumer-side concern, `ci.yml:591-594` (anchor corrected 2026-08-01; the job's two `az bicep build` steps are now at `:595-609`)).

### [x] #29 · Resilience & Business Continuity: **DONE (eighth wave, impl 7→8)**
- [x] Warm-up subsystem unit-tested (gate/hosted-service/health-check); `RESILIENCE.md` adds an in-repo SLO/error-budget template + restore-drill runbook reference. (The drill itself executes in consumer IaC: ADC's `dr-restore-drill.ps1`.)

---

## ✅ Already at level 4: protect, don't regress
#1 SOLID · #2 Design Patterns · #3 Clean Architecture · **#5 Vertical Slice (maturity 3→4 on the slice-cohesion fitness function)** · **#8 Data Architecture (impl 8→9 on the thirtieth-wave re-score, 2026-08-31, closed on both axes: the required-gate CI migration-apply against an ephemeral SQL Server with outcome assertions, `ci.yml:578,597`, the in-repo apply proof, `MigrationApplyProofTests.cs:92`, and the cascade-soft-delete + hard-delete-ban fitness gates. Residual, kept visible: Common's own cascade run is a ratchet, no child-bearing aggregate lives under `Source/`, and the default `Delete()` still flips only the single entity)** · **#10 Cross-Cutting Concerns (impl 8→9 on the shipped `IDistributedLock` idempotency guard, twenty-fifth-wave re-score, 2026-08-01: closed on both axes)** · #14 Testability · #15 Best Practices & Code Quality · **#22 Responsive & Cross-Browser (maturity 3→4 on the firefox required merge gate, nineteenth-wave re-score, 2026-07-15; impl 8→9 confirmed on the twentieth-wave re-score, 2026-07-17, after webkit's 2026-07-16 promotion made all three engines blocking)** · **#23 Front-End Performance (maturity 3→4 on the blocking `WebVitalsE2ETests` budget gate, confirmed nineteenth-wave re-score)** · **#24 Forms, Validation & UX Safety (maturity 3→4 on the CI-gated auth-form tests, fourteenth wave)** · **#25 Navigation & IA (maturity 3→4 on the CI-gated `NavigationContractTests` drift gate, twentieth-wave re-score, 2026-07-17; impl 8→9 on the thirtieth wave, 2026-08-31, closing it on both axes: the typed, constrained `@page "/notifications/inbox/{Id:int}"` route with its `:int` validation boundary, `NotificationInbox.razor:2` / `NavigationFlow.md:21`)** · **#27 i18n (maturity 3→4 on the fifteenth-wave completion train, 2026-07-03)** · **#29 Resilience (maturity 3→4 on the build-gated restore drill, tenth wave)** · **#33 Developer Experience (maturity 3→4 + impl 8→9 on the required `consumer-source-build` merge gate, twentieth-wave re-score, 2026-07-17)** · **#12 Performance & Scalability (maturity 3→4 on the required `Performance gate (BenchmarkDotNet Short + baseline verify)` merge check, twenty-first-wave re-score, 2026-07-21)** · **#18 UI Architecture & Components (closed on both axes 2026-08-07, twenty-sixth-wave re-score: M4/I9 confirmed on the bUnit primitive suite; the `EditorRequired` analyzer "consider" stays a recorded low-value residual)** · **#20 Design System & UI Consistency (closed on both axes 2026-08-07, M4/I9; the Bootstrap-chrome residual is NOT shipped and stays visible: Bootstrap 5.3.3 still bundled at `wwwroot/lib/bootstrap/dist/css/bootstrap.min.css` with `Layout/NavMenu.razor.css:23` styling around its `.navbar`, so protecting #20 does not mean that migration happened)** · **#32 Dependency & Supply-Chain (closed on both axes 2026-08-07, M4/I9: MassTransit-major fitness gate, 29 committed lock files, blocking CycloneDX SBOM at `release.yml:53-56`, CHANGELOG + versioning policy)** · **#6 CQRS & Event-Driven (closed on both axes 2026-08-14, twenty-seventh-wave re-score: M4/I9 CONFIRMED, ending the 2026-08-07 FLAG deferral; EF-backed inbox + dedup verified at `EfInboxStore.cs:18,25-31` and `IntegrationEventConsumer.cs:42,78`, with `MessageBusSettings.EnableInbox` still opt-in-off-by-default (`MessageBusSettings.cs:64`), the recorded reason Implementation holds at 9)** · **#28 Front-End Testing & Quality (closed on both axes; added to this enumeration 2026-08-14 as reconciliation, its heading was already `[x]`: M4/I9 on the bUnit + snapshot + E2E tiers, `Tests/Presentation/MMCA.Common.UI.Tests/Components/PrimitivesTests.cs` plus 15 sibling component test files)** · **#21 Accessibility (closed on both axes on the eighteenth wave, 2026-07-12; added to this enumeration 2026-08-14 as reconciliation: M4/I9 on the dark-palette contrast fix, `MMCATheme.cs:58,71` per the current anchors, plus the blocking dark-mode axe gate; it also stays listed under Mostly consumer-assessed below)** · **#9 API & Contract Design (maturity 3→4 on 2026-08-22, MMCA.Common PR #271: the in-repo OpenAPI committed-baseline diff, `OpenApiBaselineTests.cs:45-77` against `openapi-baseline.v1.json`, plus the dedicated `[ServiceContract]` purity rule, `ArchitectureRules.Contracts.cs:32` + `ServiceContractPurityTestsBase.cs:24-26`, subclassed at `ServiceContractPurityTests.cs:11`; Implementation stays at 9, so protecting #9 means regenerating the baseline deliberately in the pull request that changes the contract)** · **#19 State Management & Data Flow (closed on both axes 2026-08-31, thirtieth-wave re-score: M4/I9 on the shipped `IUiReadCache` client-side staleness policy, `IUiReadCache.cs:32,51,59,66`, registered unconditionally with config-bound TTLs, prefix invalidation on writes and clear-on-sign-out, plus `NotificationState.IsStale`/`MarkStale`; 27 CI-gated unit tests)** · **#26 Front-End Security (closed on both axes 2026-08-31, thirtieth-wave re-score: M4/I9 on the complete hardened default CSP carrying both `script-src` and `style-src` plus the per-request `{nonce}` facility, `SecurityHeaders.cs:53-55`, string-pinned by CI-gated tests; a host may still register its own `ICspPolicyProvider`, `SecurityHeaders.cs:49-51`, so each app's concrete CSP posture stays consumer-assessed)**
*(All backed by fitness functions: the regression guard is keeping those tests green. This lists the categories that reached Maturity 4 through tracked remediation; under the live two-axis scorecard the full Maturity-4 set is 31 categories, see the Scope note at the top. **This is a maturity-closure record, not a "done" list:** since the second axis was ranked on 2026-07-28, a category here that still scores implementation <= 8 (#5, #12, #23, #24, #29 today; #8 and #25 both reached I9 on the thirtieth wave, 2026-08-31; the enumeration was corrected 2026-08-23 to drop #13, whose heading is open above and which was never moved to this list) keeps a live row in the implementation band above and is not finished work. Full closure needs Maturity 4 **and** implementation >= 9. **#10 Cross-Cutting Concerns is the band's first closure (2026-08-01, M4/I9)**; its I9 does not include everything: resilience defaults remain compile-time constants rather than configuration-bound (`Shared/Resilience/HttpResilienceDefaults.cs:13,16,19,28`) and cache prefix eviction stays TTL-only when no `IConnectionMultiplexer` is registered (`Infrastructure/Caching/DistributedCacheService.cs:189`), so protecting #10 means keeping the `redis-integration` CI tier green (`ci.yml:611-647`), not treating the category as finished. **#12 Performance & Scalability rejoined this list on 2026-07-21** after two cycles out: the nineteenth-wave re-score recalibrated its Maturity 4→3 because the `performance-smoke` job was a runs-clean smoke, the latency-regression gate shipped 2026-07-16, and the twenty-first-wave re-score confirmed its context is now in live `required_status_checks`. Protecting it means keeping `Tests/Performance/perf-baseline.json` honest: a ceiling raised to silence a red gate regresses the category without changing the score.)*

## 🔒 Deliberate / accepted (documented caps, not scheduled work)
### [accepted] #31 · Cost Efficiency / FinOps: held at Maturity 2 / Implementation 8 by documented acceptance
Moved out of the active priority queue on 2026-07-02 (user-approved). Its computed priority = (4 − 2) × 2 = **4** is the highest weighted gap of any open category, but the unmet §31 criteria are consumer/IaC execution a NuGet library cannot perform: **right-sizing** and **reversible scale-events** are host-infrastructure actions the framework provisions nothing to take, and **per-service cost attribution** via Aspire resource annotations is inert for the hand-written `main.bicep` consumers (ADC/Store), so even the one library-addressable criterion does not move the score for the actual consumers. The in-repo levers are already shipped and documented: the `Telemetry:TracesSampleRatio` OTel sampler knob, the outbox per-message log trimmed Information→Debug, and the cost guide's cost-attribution-tag plus cost-guard samples. Further movement is a consumer-side lift, not an in-repo one, so §31 is recorded here as an accepted cap rather than scheduled work. *(Note on paths: `COST.md`, `RESILIENCE.md`, `RESPONSIVE.md`, `ACCESSIBILITY.md`, and the `ADRs/` folder cited throughout this file's historical entries no longer live in the MMCA.Common repo. The 2026-07-20 centralization moved the documentation library to `Website/docs-src/` (guides, ADRs, governance); only `CHANGELOG.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `FACTS.md`, `NavigationFlow.md`, `README.md`, and `SECURITY.md` remain in-repo. Historical in-repo paths are left as written for provenance.)* *(See [`common-COST.md`](../guides/common-COST.md), the §31 scorecard row, and the twelfth-wave `[accepted]` note above for provenance. Re-adjudicated on the twentieth-wave re-score, 2026-07-17: a first-pass M2→3/I7→8 lift proposal was adversarially refuted for re-citing the identical evidence already grounding M2/I7; the acceptance stands unchanged. Re-adjudicated again on the twenty-third-wave re-score, 2026-07-25: a first-pass M2→3 lift was refuted on three independent checks, the sharpest being that a search for cost, FinOps and budget across `.github` and for cost across `Tests/Architecture` returns zero matches, so no cost convention is enforced by review or CI anywhere in-repo; every cited artifact is byte-identical to the v1.123.0 tree already scored at M2. Re-confirmed on the twenty-fourth-wave re-score, 2026-07-28, with one precision fix to the sentence above: `Tests/Architecture` is still genuinely zero matches, but `.github` now returns three **incidental prose** hits, none of them an enforced convention (a comment pointing at the COST guide, `ci.yml:330`, plus one word each in `.github/ISSUE_TEMPLATE/feature_request.yml` and `.github/dependabot.yml`). The conclusion is unchanged: no cost convention is enforced by review or CI, and #31 remains first on both ranked bands and deliberately unworked. Re-confirmed on the twenty-fifth-wave re-score, 2026-08-01: a first-pass I7→8 lift was refuted a third time on byte-identical evidence: the newest §31 artifact remains the v1.118.0 metric-family knob pair (`CHANGELOG.md:839-848`, in-tree for every re-adjudication since 2026-07-17), releases 1.132.0-1.135.0 carry no §31 item, and `Tests/Architecture` is still zero matches for cost or budget. Re-adjudicated on the twenty-sixth-wave re-score, 2026-08-07: a first-pass M2→3 / I7→8 lift came back and was held at prior with **verdict FLAG** (no §31 artifact has landed since v1.118.0), a weaker verdict than the three explicit refutations above, recorded as such rather than as a fourth refutation; the acceptance stands unchanged. Re-adjudicated on the twenty-seventh-wave re-score, 2026-08-14: verdict **CONFIRMED** at M2/I7, a clean fresh re-confirmation after the prior cycle's weaker FLAG hold; no lift was proposed and no new §31 artifact is claimed. Re-adjudicated on the twenty-eighth-wave re-score, 2026-08-23: verdict **CONFIRMED** at M2/I7 a second consecutive time, with no lift proposed; recorded as a verdict only, since the underlying §31 artifact evidence (the COST guide levers, the zero-match `Tests/Architecture` cost/budget searches, the v1.118.0 metric-family knob pair) was not re-read this run. Re-adjudicated on the twenty-ninth-wave re-score, 2026-08-31: verdict **FLAG** this cycle, held at prior M2/I7 by merged-prior policy after a proposed M2→3 / I7→8 lift was refuted, every artifact cited for the lift already existing at and before the prior score and nothing cost-related landing in v1.161 through v1.174; as in the prior cycle, the underlying §31 artifact evidence was not re-read this run and stands as recorded. Re-adjudicated on the thirtieth-wave re-score, 2026-08-31: verdict **CONFIRMED** at M2/I7, a clean fresh re-confirmation after the prior cycle's FLAG hold, with no lift applied; as with the prior two verdict records, this is a verdict record, and the underlying §31 artifact evidence (the COST guide levers, the zero-match `Tests/Architecture` cost/budget searches, the v1.118.0 metric-family knob pair) was not re-read in this reconciliation and stands as recorded. #31 ranks first on the maturity band (priority 4) and, since the thirty-second wave, sits at implPriority 2 inside the weight-2 group of the implementation band; it stays deliberately unworked, and leaving it visible is the point. Re-adjudicated on the thirty-first-wave re-score, 2026-09-01: verdict **CONFIRMED** at M2/I7 for a second consecutive cycle, no lift applied; as with every prior verdict record, the underlying §31 artifact evidence was not re-read in this reconciliation and stands as recorded. Re-adjudicated on the thirty-second-wave re-score, 2026-09-04: verdict **CONFIRMED**, and for the first time the lift is applied, **Implementation 7→8**, on new in-tree evidence read this run. Commit `942847c` (PR #346) added the default-ON `Telemetry:FilterProbeTelemetry` knob, which wires `ProbeTelemetryFilter` into both the ASP.NET Core and HttpClient tracing instrumentation (`Aspire/Extensions.cs:224`), and a `ProbeTelemetryFilterProcessor` registered before the exporters that un-records the probe-child dependency spans the inbound filter cannot reach, the health check's SQL `SELECT 1` and the Redis PING (`Extensions.cs:248`, `Aspire/Telemetry/ProbeTelemetryFilterProcessor.cs:20`); it carries 27 CI-gated tests in `MMCA.Common.Aspire.Tests` (`MMCA.Common.slnx:46`) and shipped in v1.182.0, the release the CHANGELOG titles "Cost release" (`CHANGELOG.md:136`), after v1.181.0 made the two metric-family toggles actually hold under `UseAzureMonitor()` by registering `MetricStreamConfiguration.Drop` views (`CHANGELOG.md:187`). That falsifies the shared premise of the four prior refutations (byte-identical evidence, newest §31 artifact the v1.118.0 knob pair), so they do not bind this cycle. The acceptance rationale itself is unchanged and still holds: right-sizing and reversible scale-events remain consumer/IaC execution the framework only recommends ([`common-COST.md`](../guides/common-COST.md):69), and cost attribution plus budgets exist only as compile-only sample IaC (`samples/deployment/main.bicep:166`), so the cap stays accepted at Implementation 8 and Maturity stays 2 with no cost convention enforced by CI or review anywhere in-repo (zero matches over `Tests/Architecture`, no cost gate in any workflow).)*

### [accepted] #16 · AI-Native Application Architecture: this repo's one N/A category
Recorded 2026-09-04. Rubric v2 ([ADR-110](../adr/110-rubric-v2-category-realignment.md)) replaced §16 Maintainability & Evolvability in place with **AI-Native Application Architecture**, N/A until a product feature calls a model; the old category's unique criteria did not vanish, its coupling and tech-debt measures moved to #34, upgrades to #32 and onboarding to #33. MMCA.Common is a framework library with no model-calling feature, so §16 is scored N/A: its weight 2 leaves both denominators (Σweight 81→80) and it holds no row in either ranked band, its former implementation-band row being struck through as retired. This is a rubric decision rather than an accepted quality gap, recorded here so an audit reading 33 scored rows against 34 categories finds the reason.

### [accepted] Dual-registry publishing, and the release-workflow filename is load-bearing
Since v1.128.0 every release publishes to **both** nuget.org and GitHub Packages (ADR-053). The nuget.org leg uses keyless OIDC trusted publishing: `NuGet/login` exchanges the workflow's `id-token` for a short-lived, single-use API key, so there is **no stored `NUGET_API_KEY` secret** (`release.yml:13-16,79-88`, and `:155-165` for the MAUI job). The trusted-publishing policy on nuget.org is pinned to this workflow **file**, so renaming or relocating `release.yml` breaks the token exchange by design. That constraint is recorded in-file at `release.yml:74-77` (anchor widened 2026-07-28 to where the comment actually begins), at its point of use, which is where it is most likely to be read before a rename: it is documented, not scheduled work, and needs no backlog item. Recorded here so a future cycle does not mistake the filename coupling for accidental fragility. *(Re-verified 2026-07-28: `id-token` permission at `release.yml:16` and `:99`, `NuGet/login` at `:81` and `:157`, nuget.org pushes at `:86-88` and `:162-165`, and still no stored `NUGET_API_KEY`.)* *(Partially re-verified 2026-08-07: the CycloneDX SBOM gate confirmed at `release.yml:53-56` and `:130-133`; the OIDC / no-stored-key anchors were not re-read this cycle and stand as recorded 2026-07-28.)* *(2026-08-31, thirtieth wave: one supporting fact is now consistent rather than contradicted: `FACTS.md:20`, emitted by `FactsGenerator.cs:208`, finally names nuget.org alongside GitHub Packages, closing the #34 generator residual this entry's dual-registry claim used to outrun. The OIDC / no-stored-key anchors were again not re-read and stand as recorded.)* *(2026-09-01, thirty-first wave: `FACTS.md:20` re-confirmed; the §17 verifier located `NuGet/login` at `release.yml:81`, consistent with the 2026-07-28 record, and the remaining OIDC / no-stored-key anchors were not re-read and stand as recorded.)*

### [accepted] Consumers deliberately skipped v1.128.0 through v1.130.0
Recorded 2026-07-28. MMCA.ADC, MMCA.Store and MMCA.Helpdesk went from 1.127.0 straight to **1.131.0** in one pass and never pinned 1.128.0, 1.129.0 or 1.130.0 (`CHANGELOG.md:9-15`; verified downstream at the time at `MMCA.ADC/Directory.Packages.props:126` and `MMCA.Store/Directory.Packages.props:9`, both then on 1.131.0; re-verified 2026-08-01: both consumers then pinned **1.135.0**, at `MMCA.ADC/Directory.Packages.props:127` and `MMCA.Store/Directory.Packages.props:8`; re-verified 2026-08-07: the framework was at v1.142.0 with the sweep in flight, MMCA.Store already on 1.142.0 while MMCA.ADC pinned 1.141.0 with its bump open as ADC PR #106; re-verified 2026-08-14: the framework is at **v1.152.0** (`FACTS.md:4,14`) and BOTH consumers are re-converged on it, `MMCA.Store/Directory.Packages.props:9-10` and `MMCA.ADC/Directory.Packages.props:96` both pinning 1.152.0 (the ADC anchor moved from `:128` to `:96`), so the in-flight-sweep note is closed and lockstep is intact; re-verified 2026-08-31: the framework is at **v1.174.0** (`FACTS.md:4,14`) and both consumers are converged on 1.174.0, `MMCA.ADC/Directory.Packages.props:103` and `MMCA.Store/Directory.Packages.props:9`, so lockstep is intact and the skipped window stays a one-time historical fact). This is ADR-016 lockstep behavior, not drift: 1.128.0 was distribution-only (assemblies byte-identical to 1.127.0), so sweeping it alone would have cost two production deploys for no behavioural change, and 1.129.0 and 1.130.0 were superseded within the same day by 1.131.0. Recorded here because an audit reading the version ladder would otherwise score the window as three missed lockstep sweeps. *(2026-08-31, thirtieth wave: the convergence claim above is UNVERIFIABLE this cycle: the newest re-verification asserts both consumers on 1.174.0 while the framework is now **v1.175.0** (`FACTS.md:4,14`); the consumer pins were not read this run, so no convergence is restated: check both pins at the next sweep rather than assuming lockstep.)* *(2026-09-01, thirty-first wave: RESOLVED. The framework is at **v1.179.0** (`FACTS.md:4,14`) and all three consumers are converged on it: `MMCA.ADC/Directory.Packages.props:107`, `MMCA.Store/Directory.Packages.props:8` and `MMCA.Helpdesk/Directory.Packages.props:74` each pin 1.179.0, so ADR-016 lockstep is intact and the skipped window stays a one-time historical fact.)* *(2026-09-04, thirty-second wave: re-verified at the new release. The framework is at **v1.185.0** (`FACTS.md:4,14`) and all three consumers pin it, `MMCA.ADC/Directory.Packages.props:105`, `MMCA.Store/Directory.Packages.props:9` and `MMCA.Helpdesk/Directory.Packages.props:75` (each the `MMCA.Common.Domain` entry), so ADR-016 lockstep remains intact.)*

## ⚪ Mostly consumer-assessed (the shared Common.UI surface is scored here)
#21 Accessibility · #26 Front-End Security
*(Assessable mainly in consumer apps; #26's framework-default CSP gap closed 2026-08-31, see below, and its shared token-storage surface is covered under #11.)*
- **#26 Front-End Security: CLOSED on both axes (thirtieth-wave re-score, 2026-08-31: M4/I9).** The framework default is no longer missing `script-src`/`style-src`: the complete hardened baseline plus the per-request `{nonce}` facility ship at `SecurityHeaders.cs:53-55`, string-pinned by CI-gated tests; on the protect list above. Closure means the framework default gap is gone, not that host-side CSP is someone else's problem solved: a host may still register its own `ICspPolicyProvider` (`SecurityHeaders.cs:49-51`) and each app's concrete CSP posture is scored downstream, so the category stays listed here for that genuinely consumer-assessed part.
- **#22 Responsive: CLOSED at Maturity 4 / Implementation 9 (impl confirmed twentieth-wave re-score, 2026-07-17).** firefox was promoted to a required merge gate alongside chromium on 2026-07-12, and webkit on 2026-07-16 after 11 consecutive green main runs (`.github/workflows/ci.yml:111-114`, no `continue-on-error` remains in the job), so all three engines block merges; on the protect list above. The former residual (webkit advisory) is closed; Implementation 9 is held short of 10 by the gallery-representative-states scope and the doc-only device matrix.
- **#27 i18n: CLOSED at Maturity 4 / Implementation 9 (fifteenth-wave completion train, 2026-07-03).** No longer consumer-assessed/N/A: it became an active in-repo category after ADR-027 shipped en-US + Spanish (superseding the single-locale ADR-011), and the ADR-027 Decision 9 train closed every stated hold: the pseudo-localization pass is a REQUIRED chromium CI gate (`PseudoLocalizationE2ETests`: `[!!` sentinel round-trip + overflow guard + `en-US` leak guard), the hard-coded-literal gate (`LocalizedTextConventionTests`) and the translation-coverage gate fail the build, and MudBlazor's built-in chrome localizes via `ResxMudLocalizer` (145 keys en+es). Held below 10 only by two locales / no RTL; on the protect list above.
- **#24 Forms/UX Safety: DONE for the shared surface (eighth wave, impl 7→8).** Register/Login are now `EditForm` + DataAnnotations + per-field `ValidationMessage` (typed models + `PasswordComplexity` attr + tests). Consumer module forms remain consumer-scored. **Maturity reached 4 on the fourteenth-wave re-score** (the CI-gated `AuthModelValidationTests` + `RegisterFormTests` meet the automatic-enforcement bar); the category is closed and on the protect list above.
- **#25 Navigation: CLOSED at Maturity 4 / Implementation 9 (maturity on the twentieth-wave re-score, 2026-07-17; implementation on the thirtieth, 2026-08-31).** The eighth wave shipped the in-shell `Forbidden` (403) page + `NavigationFlow.md` for the Common UI surface (impl 7→8); the nineteenth-wave refusal (no drift gate, no route-auth test) is resolved: `NavigationContractTests` (route/doc set-equality + auth-posture agreement over the embedded `NavigationFlow.md`, non-vacuous floor) runs in the CI-gated `.slnx` unit tier, exactly the routing fitness check the risk list prescribed, so the M3→4 lift is score-confirmed; and the long-held "deep-link param typing beyond list-state stays light" cap closed on the thirtieth wave with the typed, constrained `@page "/notifications/inbox/{Id:int}"` route (`NotificationInbox.razor:2`, validation boundary documented at `NavigationFlow.md:21`), lifting Implementation to 9; on the protect list above. Per-actor module flows remain consumer-scored.

---

### Suggested sequencing
1. **MassTransit v8 fitness test** (#32 + #16): one small test, closes two mediums, prevents a recurring prod crash.
2. **Broker retry policy** (#29 + #6): the async path is the system's weakest boundary.
3. **bUnit harness** (#28 + #18 + #19 guard): unlocks the whole front-end tier.
4. **Erasure boundary + outbox purge** (#30): the only score-1 category; real compliance exposure.
5. Sweep the **fitness-function gaps** (#4, #11, #5) and **doc/CI hygiene** (#34, #17, #9, #13) as steady cleanup.
