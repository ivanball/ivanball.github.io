# Article series: maintenance ledger

Working file for `/update-medium` (underscore-prefixed, so the site build skips it). The public index and the mapping table live in `README.md`.

**Conventions**
- One file per article, `<slug>.md`. The slug is the published URL, so it never changes; the
  article number lives in the header blockquote (`Article #N`) and in `assets/data/articles.js`
  (`n`), and a renumber touches only those. The build fails if the two disagree.
- The header blockquote and the trailing `Notes:` evidence ledger stay in the source and are
  stripped at render time: the ledger is the audit trail, not reader content.
- **No em dashes anywhere**: colons, commas, periods, parentheses, or rephrasing instead.
- **No "seam"/"seams" anywhere**, titles included: use a context-fitting alternative (boundary,
  extension point, join point, swap point, pipeline, layer). The framework docs still use the word;
  paraphrase rather than quote it.
- Each file carries: a metadata blockquote header, an SEO subtitle, the article body, a code block, a
  "Trade-offs, honestly" section, an "Apply this even without MMCA" section, a series footer, a CTA
  block, 5 tags, and a verification/honest-gaps Notes line.
- **The site copy is canonical.** Medium and LinkedIn renders are generated on demand by
  `Tools/Scripts/render-medium-variants.ps1` (workspace harness), never committed here.

**Anchor facts (current state, verify before publishing)**
- .NET 10, C# preview (extension types), Apache-2.0, repo `https://github.com/ivanball/MMCA.Common`
  (confirmed via git remote).
- Framework version **v1.205.0**, tracked in lockstep by every consumer (per `MMCA.Common/FACTS.md`).
- 19 NuGet packages released in lockstep; **125 ADRs (001-125)** (per `Website/docs-src/adr/README.md`).
- `MMCA.Common.Testing.Architecture` defines 136 test methods across 53 base classes;
  Common's own build runs 267, plus a compile-time MSBuild layer guard (per `FACTS.md`).
- Two-axis architecture index (current per-repo scorecards): Common **Maturity 97.0% (318/328),
  Implementation 86.0% (705/820)** across all 34 categories (none N/A now: §27 i18n is scored after
  ADR-027 superseded the single-locale ADR-011); ADC **Maturity 98.5% (319/324), Implementation 86.2% (698/810)**.
- ~2,254 fast tests, no Docker. Two real consumer apps: MMCA.ADC (conference, Azure Container Apps) and
  MMCA.Store (e-commerce, Stripe). Both consumers are pinned at 1.205.0 in lockstep.

> **Note on the scorecard:** the repo's committed `Website/docs-src/governance/common-ArchitectureScorecard.md` is now the
> canonical **two-axis** scorecard (Maturity 97.0% (318/328) / Implementation 86.0% (705/820),
> re-scored clean-tree at v1.101.0, then moved by the fifteenth-wave i18n completion train 2026-07-03,
> the sixteenth-wave clean-tree re-score at v1.106.0 2026-07-06, which lifted §14 Testability
> Implementation 8 to 9, the seventeenth-wave re-score at v1.108.0 2026-07-09, which recalibrated
> §21 Accessibility Implementation 9 to 8 on the dark-theme AA-contrast gap, the eighteenth-wave
> re-score at v1.115.0 2026-07-12, which restored §21 Accessibility Implementation to 9 once the
> dark-theme contrast was fixed and locked by a blocking dark-mode axe gate, the nineteenth-wave
> re-score at v1.115.0 2026-07-15, which applied §22 Responsive and §23 Front-End Performance Maturity
> to 4 and recalibrated §12 Performance Maturity 4 to 3, and the twentieth-wave re-score at v1.117.0
> 2026-07-17, which promoted §25 Navigation and §33 Developer Experience Maturity to 4 and lifted §22
> Responsive and §33 Implementation to 9 while recalibrating §13 Observability Implementation to 8, and
> the twenty-first-wave re-score at v1.121.0 2026-07-21, which promoted §12 Performance and Scalability
> Maturity 3 to 4 once its perf gate became a required merge check, and the twenty-second-wave
> re-score at v1.123.0 2026-07-23, which moved nothing: all 34 categories re-confirmed at their
> twenty-first-wave values, and the twenty-third-wave re-score at v1.128.0 2026-07-25, which also moved
> nothing: three proposed maturity lifts (§17, §30, §31), two proposed implementation lifts (§17, §34),
> and two proposed §23 downgrades were all refuted on adversarial re-verification, so both indices hold
> at their prior values, and the twenty-fourth-wave re-score at v1.131.0 2026-07-28, the fourth
> consecutive no-move cycle: two proposed maturity lifts (§9, §30) and three proposed implementation
> lifts (§13, §25, §29) were all refuted on adversarial re-verification, and the twenty-fifth-wave
> re-score at v1.135.0 2026-08-01, which ended that steady state with a single move: **§10
> Cross-Cutting Concerns Implementation 8 to 9** (685 to 687/810, weight 2), awarded because the
> idempotency guard is no longer an in-memory semaphore (`IdempotencyFilter` resolves
> `IDistributedLock`, and `AddCaching` registers the SET-NX-PX plus compare-and-delete
> `RedisDistributedLock` whenever a Redis multiplexer is present; ADR-017 revised, and this is the
> pattern **Article 18** teaches). Four first-pass proposals were adversarially refuted and held at
> prior: §2 and §15 (each Implementation 9 to 10), §17 (3/8 to 4/9), and §31 (Implementation 7 to 8,
> refuted a third time). That cycle also recalibrated the reporting line: Implementation 10 is now
> awardable for an almost perfect implementation, so the former "attainable ceiling" line is retired
> and the index reads directly against 100% (denominators unchanged, so the trend stays comparable). The
> twenty-sixth-wave re-score at v1.142.0 2026-08-07 (git HEAD `710d29d`) moved nothing: 27 categories
> re-confirmed fresh at their prior values and seven first-pass lift proposals (Implementation on §6, §11,
> §12, §25 and §26, plus §17 and §31 on both axes) were adversarially refuted, so both indices hold at
> Maturity 96.9% (314/324) / Implementation 84.8% (687/810). The twenty-seventh-wave re-score at
> v1.152.0 2026-08-14 (git HEAD `3ba8d13`, clean tree) also moved nothing: eight first-pass
> implementation lifts (§5, §11, §13, §25, §26, §29, §34, plus §17) and two maturity lifts (§17, §30)
> were adversarially refuted, so both indices still hold at those values. The two-axis scorecard
> replaced the original single-axis snapshot (80% across 28
> applicable categories, "eleven packages"), which survives in git history as the historical baseline
> (MMCA.Common commit `f518099`, `ArchitectureScorecard.md:3`: "80% (218 of 272 weighted points across
> 28 applicable categories; 6 N/A categories excluded)").
> ADC's two-axis scorecard is `Website/docs-src/governance/adc-ArchitectureScorecard.md` (Maturity 97.2% (311/320) / Implementation
> 85.6% (685/800) as of the twenty-fourth-cycle re-score 2026-07-28, which corrected §15 Implementation
> 8 to 7 on suppression hygiene drift plus the MAUI project sitting outside the CI-audited graph; the
> previously stated 85.9% (687/800) is now stale). Store's is
> `Website/docs-src/governance/store-ArchitectureScorecard.md` (Maturity 97.8% (313/320) / Implementation
> 83.9% (671/800)). The cornerstone articles
> frame proof as "scored, published, then fixed, then re-scored": the 80% snapshot predated several
> remediations (the 13th package, lock files, the SBOM-gated release, `DependencyVersionTests`, the
> ADR-005 erasure pathway), and the two-axis re-verification re-scored after they landed. The former
> workspace eval files (`Docs/Architecture/ArchitectureEvaluation-MMCA.*.md`) are now pointer stubs, so
> cite the in-repo scorecards. Re-derive numbers before publishing.

> **Note on ADRs:** the set has grown to **125 (001-125)**. Each ADR maps to an article or is a recorded
> scope-out. Shared homes: ADR-017 (request idempotency) and ADR-021 (consumer-side inbox idempotency) are
> both taught in **Article 18**; ADR-018 (polyglot persistence) is **Article 11**; ADR-001 (manual DTO
> mapping) is **Article 23**; ADR-026 (two-tier caching) is **Article 19**; ADR-024 (two-channel
> notifications) is **Article 21**; ADR-032 (password hashing) is **Article 17**; ADR-009 (resilience +
> RTO/RPO) is **Article 33**; ADR-025 (startup warm-up) is taught in the Aspire deep-dive, **Article 31**;
> ADR-020 (permission-based authorization) is **Article 24** and ADR-022 (browser session-cookie auth) is
> **Article 25**. A 2026-06 coverage audit added **four dedicated articles**: ADR-034 (generic entity
> controllers) is **Article 28**, ADR-033 (resource-ownership authorization) is **Article 29**, ADR-019
> (rate limiting) + ADR-029 (brute-force protection) share **Article 30**, and ADR-027 (multi-locale
> i18n, which **supersedes** the retired single-locale ADR-011) + ADR-028 (day/dark theme) share
> **Article 38**. The 2026-07-04 coverage audit added **two more**: ADR-035 (optimistic concurrency via
> RowVersion round-trip) is **Article 13** and ADR-036 (external OAuth login) is **Article 26**. That
> audit also recorded two flagged candidates as covered rather than gaps: the §32 supply-chain story
> (lockstep versioning, the MassTransit-v8 pin gate, the SBOM-gated release) stays woven into
> **Articles 1, 3, and 41**, and §21 accessibility-as-a-merge-gate stays woven into **Articles 35 and
> 37**. The 2026-07-06 coverage audit recorded the two newest ADRs as covered-in-section rather than
> gaps: ADR-037 (field-level encryption at rest, the AES-256-GCM `EncryptedStringConverter`) was taught
> in **Article 17** (its "PII at rest" section, including the shipped-but-not-yet-wired honesty), and
> ADR-038 (supply-chain provenance: the SBOM release gate, committed lock files, and the vuln audit)
> is the §32 story already woven into **Articles 1, 3, and 41**, which it formalizes. The 2026-07-10
> coverage audit added **one dedicated article** and recorded two more ADRs as covered-in-section:
> ADR-039 (live channel push: ephemeral events over the notification hub via `ILiveChannelPublisher`)
> is the new **Article 22**; ADR-040 (authenticated output caching for public reads) is taught in
> **Article 19**'s new edge-tier section; and ADR-041 (observability and telemetry strategy) was taught
> in the Aspire deep-dive, **Article 31**. The 2026-07-15 coverage audit (against the grown ADR set
> 042-048) added **one dedicated article** and folded three more ADRs into existing articles: ADR-042
> (device-capability abstraction for MAUI Blazor Hybrid) plus the G27 Device Capability Layer is the new
> **Article 42**, which also carries ADR-043's mobile deep-link handling; ADR-043's native OAuth callback
> (the allow-listed custom-scheme completion) is folded into **Article 26**; ADR-044 (native push delivery,
> the third notification channel) is folded into **Article 21**; and ADR-047 (runtime revocation of
> soft-deleted users' active sessions) is folded into **Article 36**. So ADRs
> 024/025/026/032/033/038/040/043/044/047 all live inside existing articles rather than
> dedicated ones. The 2026-07-17 coverage audit added **two dedicated articles**: ADR-045 (managed file
> storage + avatars) is **Article 43** and ADR-046 (HTTP API versioning) is **Article 44**. The 2026-07-21
> coverage audit (against the grown ADR set 049-050) added **one dedicated article** and recorded one more
> ADR as covered-in-passing: ADR-050 (JWT single rotating refresh token with reuse-detection revocation)
> is the new **Article 27**, inserted into the auth cluster right after external OAuth login and
> renumbering every later article +1; and ADR-049 (the library-scoped `ConfigureAwait(false)` build-gate
> policy) is a foundational build-hygiene convention taught in passing rather than a dedicated piece. The
> 2026-07-23 coverage audit **appended four dedicated articles**, each promoting a pattern previously
> covered only as a section of another article: ADR-031 (feature-flag management, formerly split across
> Articles 7 and 20) is the new **Article 45**; ADR-037 (field-level encryption at rest, formerly
> Article 17's PII section) is the new **Article 46**; ADR-023 (security-response headers + pluggable
> CSP, formerly inside Article 31) is the new **Article 47**; and ADR-041 (observability and telemetry,
> formerly inside Article 31) is the new **Article 48**. All four were appended (no earlier article
> renumbered; the hub moved from 45 to 49). That audit also recorded ADR-051 (client-side auth token
> lifecycle across render modes) as covered-in-section: its `ITokenRefresher` / `ITokenStorageService`
> client half is taught across **Article 25** (the same-origin token proxy) and **Article 37** (the UI
> framework's auth services). It re-affirmed the standing scope-outs: the §17 DevOps/CI-CD deploy story
> and §31 FinOps stay out of this framework-focused series, the §32 supply-chain/SBOM story (ADR-038)
> stays woven into Articles 1, 3, and 41, §21 accessibility-as-a-merge-gate stays woven into Articles
> 35 and 37 (a dedicated E2E-accessibility-harness piece was considered and deferred), consumer-side
> inbox idempotency (ADR-021) stays taught in Articles 18 and 9 (Article 9's trade-offs now describe
> the shipped inbox), and analyzer governance (ADR-049) stays covered in passing via Article 34. The
> 2026-07-25 coverage audit (against the grown ADR set 052-055) **appended one dedicated article** and
> recorded one more ADR as covered-in-section: ADR-054 (choreographed saga compensation with a periodic
> reconciliation backstop) is the new **Article 49**, appended without renumbering any earlier article
> (the hub moved from 49 to 50); and ADR-055 (repository plus specification as the data-access contract)
> is covered as a section inside **Article 6**, the same treatment the 2026-07-23 audit gave the patterns
> it later promoted into Articles 45-48. That audit also recorded two gaps as known and deliberately
> deferred rather than closed: ADR-052 (the generalized background-job execution contract, the bounded
> channel plus hosted drain) has no dedicated article yet, and neither does the dynamic-LINQ
> query-parameterization pattern. It placed ADR-053 (dual-registry keyless OIDC package publishing)
> inside the already-recorded §17/§32 scope-outs, since it is a release-pipeline decision rather than a
> framework pattern. The 2026-07-27 coverage audit **added no new article** and instead closed all six
> of its open gaps as sections of existing articles, the same covered-in-section treatment the
> 2026-07-23 audit applied before promoting four of its patterns into Articles 45-48. Both of that
> audit's deferred gaps are now closed: the **dynamic-LINQ query-parameterization** pattern
> (`DynamicQueryConfig.Parameterized`, the injection surface of the user-supplied filter DSL plus the
> SQL plan-cache reuse it buys) is a section of **Article 28**, which already taught the query contract
> sitting on top of it; and **ADR-052** (the generalized background-job execution contract) is a section
> of **Article 22**, which previously taught only the `DropOldest` ephemeral half and now contrasts it
> with the expensive-work `Wait` mode and its dedup-across-execution claim. The four flagged candidates
> were likewise resolved as sections rather than articles: convention/documentation-as-contract fitness
> gates (`NavigationContractTests`, `FormsConventionTestsBase`, the previously unmapped rubric §25) went
> into **Article 34**, which already owns fitness functions; responsive/adaptive UI switching (rubric
> §22, `BreakpointConstants.IsMobileBreakpoint`, the `MobileInfiniteScrollList` DOM cap) went into
> **Article 37**; GDPR data-subject **export** (the portability counterpart to erasure, degrading a
> section to `Available = false` rather than failing the whole export) went into **Article 36**, which
> taught erasure alone; and the set-based-write audit-field trap (`ExecuteUpdateAsync` bypassing the
> audit interceptor) went into **Article 09**, whose `SaveChangesAsync` sequence is exactly the pipeline
> it bypasses, rather than into Article 10 or 13 as first proposed. That audit also corrected the ADC
> scorecard indices in the anchor-facts block above and added the missing §28 / §23 cells to the Article
> 35 and 37 table rows, which had made the coverage matrix non-invertible. The 2026-07-28 coverage audit
> (against the grown ADR set 056-060, none of which had a matrix cell) **added no new article** and closed
> every gap inside existing pieces, the covered-in-section treatment this series prefers over thin new
> articles: **ADR-058** (runtime conformance suites shipped as a package: six abstract contract bases in
> `MMCA.Common.Testing` subclassed per host and asserted against a really booted host, no committed
> snapshots) expands **Article 35**'s shipped-test-packages section, which had described that package as an
> integration base only, and draws the boundary against ADR-015: fitness functions check structure and
> registration, conformance suites check runtime behaviour; **ADR-060** (the performance-regression gate:
> allocations gated absolutely, latency gated only as a benchmark-to-benchmark ratio because shared CI
> runners are too noisy for an absolute threshold, and fail-closed against a vacuous gate) is a new section
> of **Article 34**, which already owns rules that fail the build; **ADR-056** (the Blazor render-mode
> strategy) is already taught in **Article 37**, whose `PersistentComponentState` section is exactly the
> `InteractiveAuto` double-fetch fix that record decides; and **ADR-059** (the `IModule` contract and
> module composition) is already taught in **Article 14**, which owns Kahn ordering and the disabled-module
> stubs. That audit also resolved two long-standing non-invertible rubric cells: **§1 SOLID Principles**
> now cites **Articles 4 and 7** (the Result railway's narrow combinator surface, and open/closed made
> literal by the decorator pipeline), and **§16 Maintainability and Evolvability** now cites **Article 41**,
> which already tells the ADR-016 lockstep-upgrade story that is the category's load-bearing criterion.
> The 2026-08-01 coverage audit (against the grown ADR set 061-064, none of which had a matrix cell)
> **added no new article** and closed every gap inside existing pieces, the covered-in-section treatment
> this series prefers over thin new articles. **ADR-062** (SLO alerting as code plus the alert-to-runbook
> build gate) splits across two homes, because the record itself has two halves: the alerting mechanism
> (`sloAlertSpecs` materialized as Log Analytics `scheduledQueryRules`, chosen over metric alerts because
> a metric alert cannot express the 401/499 and SignalR-connection-lifetime predicates, and superseded
> rules kept `enabled: false` because an incremental ARM deploy never removes a resource that left the
> template) is a new section of **Article 48**, which owned observability but carried no alerting content
> at all; and the build gate (`ObservabilityConventionTestsBase`, which fails on a missing runbook
> section, an orphaned one, or fewer than `MinimumAlertSpecs`) is a new section of **Article 34**, which
> already owns rules that fail the build and the same fail-closed, cannot-go-vacuous property. **ADR-063**
> (WCAG 2.1 AA as a shipped test contract: `AxeOptions.Wcag21Aa` pinned to the four A+AA tags with axe
> best-practice rules deliberately out of scope, `AccessibilityViolationException`, and the single
> recorded `Wcag21AaExceptMudPagerCombobox` exception) expands **Article 35**, where accessibility had
> been a single clause; a dedicated E2E-accessibility piece was weighed again and again deferred, which
> also keeps the standing §21 treatment (woven into Articles 35 and 37) intact. **ADR-061** (runtime
> secret management via Key Vault references and managed identity) and **ADR-064** (deploy preconditions
> as proof-of-recency gates) both fall inside the already-recorded §17 deploy/IaC scope-out. That audit
> also closed two patterns that no ADR names: cross-replica mutual exclusion (`IDistributedLock` with the
> SET-NX-PX `RedisDistributedLock` and the warn-once in-process fallback) is a section of **Article 18**,
> whose lock story it rewrites rather than supplements, and the non-retryable ambiguous commit
> (`TransactionCommitAmbiguousException`, which keeps EF's `EnableRetryOnFailure` from re-running an
> operation whose outbox rows may already be durable) is a section of **Article 09**. Finally, it recorded
> a standing **group-axis scope-out** that had never been written down: functional groups **G17-G22**
> (the ADC Conference and Engagement modules) and **G24** (the ADC host, UI shell and cross-module
> composition) have no article cell by design, because per-module app internals are out of scope for a
> framework-focused series whose app-facing piece is the Article 41 case study. Recording it makes the
> coverage matrix invertible on the group axis, the same way §17 and §31 are recorded on the rubric axis.
> The 2026-08-07 coverage audit (against the grown ADR set 065-070, none of which had a matrix cell)
> **added no new article** and closed every gap inside existing pieces, the covered-in-section treatment
> this series prefers: **ADR-067** (the shared Blazor shell + `IUIModule` composition, the UI-layer
> counterpart of ADR-059's `IModule`) is a new section of **Article 37**, which owned the UI framework
> but had never taught the shell-composition contract; **ADR-070** (the fail-fast configuration
> contract: every settings section bound via `ValidateDataAnnotations().ValidateOnStart()` so a
> misconfigured host refuses to boot, with read-only facades keeping `IOptions<T>` out of Application)
> is a new section of **Article 31**, the host-boot tutorial; **ADR-069** (the shared DataProtection
> key ring for scaled-out hosts, ADC-adopted, not yet Store) is a new section of **Article 25**, whose
> whole subject is the cookie that must decrypt on any replica; **ADR-065** (the `MMCA.Templates`
> scaffolding pack, revised 2026-08-07) was already substantively taught in **Article 39** (with the
> install path in Article 1) and now has its matrix cell; **ADR-066** (broker transport selection and
> dev/prod parity) was already taught in **Article 9** (the transport halves, with the AppHost
> `WithBroker` half in Article 31) and now has its cells; and **ADR-068** (value objects as validated
> domain primitives) was already taught in **Article 5** and now has its cell. That audit also closed a
> pattern no ADR names: cache-outage fail-open degradation (cache faults treated as misses, logged and
> counted on `idempotency.degraded`, so a Redis outage degrades instead of 500s; shipped v1.137.0) is a
> new section of **Article 19**, with the idempotency arm in **Article 18**.
> The 2026-08-14 coverage audit (against the grown ADR set 071-084, none of which had a matrix cell)
> **added no new article** and closed every gap inside existing pieces, the covered-in-section
> treatment this series prefers: **ADR-073** (the multi-tenancy model) splits across its two natural
> homes, **Article 10** (the resolution middleware, the second named "Tenant" EF filter composing by
> AND with "SoftDelete", the cross-tenant-write-refusing `TenantSaveChangesInterceptor`, DB-per-tenant
> as a `PhysicalDataSource` override, and the per-(source, tenant) outbox drain) and **Article 19**
> (the `TenantCacheKey` `t:{tenantId}:{key}` prefix the caching decorators apply); **ADR-075** (the
> audit trail, a third `SaveChangesInterceptor` writing per-property change history in the same
> transaction) is a new section of **Article 09**, whose `SaveChangesAsync` sequence it joins;
> **ADR-074** (the recurring job scheduler, durable cron on the outbox claim-lease idiom) is a new
> section of **Article 22**, beside the ADR-052 channel it must not be confused with; **ADR-079** (the
> shared HTTP middleware pipeline, `UseCommonMiddlewarePipeline` as the HTTP counterpart of ADR-014's
> decorator order) is a new section of **Article 07**; and **ADR-084** (the Stripe webhook ingress
> contract, status-code-as-ACCEPTED-vs-PROCESSED) is a new section of **Article 49**, completing that
> article's delivery family. Five more of the new records were confirmed already covered: **ADR-076**
> (the DSAR export contract) formalizes the portability section **Article 36** already carries (that
> article now teaches the hoisted `ExportUserDataHandlerBase`); **ADR-077** (the opt-in HybridCache
> third Tier-1 substrate) amends ADR-026 and is taught in **Article 19**'s reworked backends section;
> **ADR-078** (the CSV export endpoint) is taught in **Article 28**, which now covers the streamed
> `[HttpGet("export")]` route; **ADR-071** (barcode scanning + QR display) is the ADR-042
> contract-plus-fallback shape **Article 42** already teaches (matrix cell added); and **ADR-083**
> (the CRUD lifecycle event taxonomy) is a convention taught across **Articles 15, 5, and 9** (cell on
> Article 15). Three fall inside the recorded scope-outs: **ADR-072** (QR badge check-in + points
> gamification) is per-module ADC internals under the standing G17-G22/G24 group-axis scope-out, and
> **ADR-080** (rollout + automatic revision rollback) and **ADR-081** (the cost-baseline deploy gate)
> sit inside the standing §17 deploy-story (and, for 081, §31 FinOps) scope-out. **ADR-082** (the
> two-tier cross-origin posture) is covered in **Article 47**'s edge-hardening startup surface (cell
> added). That audit also recorded one non-ADR flag as resolved: `IcsCalendarBuilder` / `IcsEvent`
> (the RFC 5545 VCALENDAR writer in `MMCA.Common.Shared`) is an intentionally consumer-supplied leaf
> utility, shipped and tested with no in-repo consumer, below the article bar; noted here so the
> shipped-but-unadopted posture is on record, like ADR-037 and ADR-055 before it.
> The ADRs still without a
> dedicated article are recorded, deliberate deferrals:
> ADR-030 (startup
> sole-migrator), adjacent to the IaC/CI-CD deploy story this framework-focused series intentionally leaves
> out; ADR-048 (primitive identifier type aliases), a foundational convention taught in passing across the
> module articles rather than in its own piece; ADR-049 (the `ConfigureAwait(false)` policy), likewise
> covered in passing; ADR-052 (background job execution), now covered as a section of Article 22 rather
> than deferred; ADR-053 (dual-registry
> package publishing), inside the §17/§32 scope-outs; **ADR-057** (expand/contract schema evolution as
> a CI gate), which the 2026-07-28 audit placed in the same §17 deploy-story scope-out: it is enforced only
> in the two app repos' `deploy.yml` and exists because revision rollback never reverts schema, which makes
> it a deploy-pipeline rule rather than a framework pattern; and, from the 2026-08-01 audit, **ADR-061**
> (runtime secret management) and **ADR-064** (deploy recency gates), both inside that same §17 deploy-story
> scope-out, plus **ADR-062** and **ADR-063**, which are covered in section rather than deferred (Articles
> 48 and 34 for 062, Article 35 for 063); and, from the 2026-08-14 audit, **ADR-072** (QR badge
> check-in + points gamification), inside the standing G17-G22/G24 per-module-ADC group-axis
> scope-out, and **ADR-080** (rollout + revision rollback) and **ADR-081** (the cost-baseline deploy
> gate), both inside the same §17 deploy-story scope-out (081 also §31 FinOps); and, from the
> 2026-08-19 audit, **ADR-085** (identifier type aliases revisited), which re-prices and re-defers the
> same wrapper-struct alternative ADR-048 deferred, so it stays in ADR-048's taught-in-passing home.

> **2026-08-15 targeted fold** (MMCA.Common PRs #247 and #248, both merged to main that day, post-v1.152.0):
> **added no new article** and touched five existing pieces. PR #247 (the `EncryptedStringConverter`
> versioned ciphertext envelope `[keyVersion(1)][nonce(12)][ciphertext][tag(16)]` plus the key-ring
> constructor, the version byte AAD-authenticated, overhead now 29 bytes, still zero adopters per
> ADR-037): **Article 46** rewritten as the owner (the former "no rotation story" trade-off is now the
> shipped rotation design, test inventory 21 up from 11, all three renders), with anchor-only ledger
> refreshes in **Articles 17 and 36** (their body claims held). PR #248 (the
> `TransactionCommitAmbiguousException` per-source outcome map: `CommittedSources` / `AmbiguousSource` /
> `RolledBackSources` appended to the message by `DbContextFactory.TryCommit`): a new observability
> paragraph in **Article 09**'s "When the commit itself is ambiguous" section and an extension of
> **Article 10**'s no-two-phase-commit trade-off bullet; the retry-safety narrative both articles carry
> was unchanged in source and untouched. No matrix cell moved (46 already owns ADR-037; #248 has no
> ADR). Known follow-up recorded, outside this series: the onboarding chapter
> `group-07-persistence-ef-core.md` still teaches the pre-#247 envelope and needs its own regen pass.

> **2026-08-19 coverage audit** (against the grown ADR set 085-089, none of which had a matrix cell):
> **added no new article** and closed every gap inside existing pieces, the covered-in-section treatment
> this series prefers. **ADR-088** (gateway edge responsibilities: `GatewayCorrelationMiddleware`,
> `AddGatewayRateLimiting` with its anonymous-including per-IP window, `AddGatewayDownstreamHealthChecks`
> on the `Ready` tag, and the recorded decline of edge JWT pre-validation) plus **ADR-089** (the route
> table moved into YARP `ReverseProxy` configuration, pinned by `RouteMapTests` in both consumer repos)
> are a new edge-ownership step in **Article 32**, whose extraction tutorial already routed through the
> gateway; **ADR-087** (broker poison-message handling) splits across its two natural homes,
> **Article 09** (the delivery half: `FaultIntegrationEventConsumer`, transport-asymmetric delayed
> redelivery, `broker.fault.count`) and **Article 33** (the outbox-publish circuit breaker plus the
> recorded rejection of a per-query DB breaker); **ADR-086** (process manager deferred: the coordinator
> shape, the MassTransit v8 licensing pin, and the three-part build trigger) is a trade-off bullet in
> **Article 49**, whose choreography it defers against; and **ADR-085** (identifier type aliases
> revisited) re-defers ADR-048's wrapper-struct alternative and stays in that record's taught-in-passing
> home (see the deferral list above). The audit also closed one pattern no ADR names:
> `BestEffort.ExecuteAsync` (the never-fail-the-caller side-effect discipline, one Warning plus
> `besteffort.dispatch.failed` per swallowed failure, cancellation rethrown) is a new section of
> **Article 19**, with its meter recorded in **Article 48**'s grown seven-meter inventory.
>
> **2026-09-19 coverage audit** (against the grown ADR set 090-125, of which 090-125 had no matrix cell,
> and the rubric v2 realignment of ADR-110): **appended three dedicated articles** and closed the rest
> inside existing pieces. **ADR-120** with **ADR-111** (the governed LLM boundary: `BoundedChatClient`,
> `GuardrailChatClient`, `UsageRecordingChatClient`, `PromptContract` hashing, `AiUsageMeter`, and the
> `AiDependencyIsolationTestsBase` layering rule) is the new **Article 50**, which also gives functional
> group G28 and rubric §16 AI-Native Application Architecture their first cells; **ADR-114** with
> **ADR-121** (durable internal commands on the outbox lease machinery) is the new **Article 51**, framed
> against the channel (ADR-052) and cron (ADR-074) mechanisms Article 22 already teaches; and **ADR-116**
> (TOTP second factor, email confirmation, stored permission grants and the admin controller bases) is
> the new **Article 52**. Covered in section: **ADR-115** (strongly-typed identifiers as an opt-in
> capability, which retires the ADR-048/085 "deferred" framing) in **Article 5**; **ADR-100** (outbox
> opt-in resolved from the messaging mode) and **ADR-107** (the transaction execution contract) in
> **Article 9**; **ADR-124** (the Blazor circuit ceiling, app-repo code in both consumers) in
> **Article 30**; **ADR-105** (the data-residency build gate) and **ADR-109** (feature-by-folder
> enforced by `FolderWidthTestsBase`) in **Article 34**; **ADR-117** (the AppHost integration test
> tier) in **Article 35**; **ADR-119** (restrict-delete by default) in **Article 36**; **ADR-113**
> (PostgreSQL as the fourth engine) in **Article 11**; **ADR-102** (PBKDF2-only hashing, superseding
> ADR-032) regrounds **Article 17**; **ADR-097** (per-device refresh sessions, superseding ADR-050)
> regrounds **Article 27**; and **ADR-110** (rubric v2) renames §10 and §16 across Articles 1, 3 and
> 41, whose §16 cell moves to Article 50. Scope-outs recorded: **ADR-104** (smart enums, zero adoption)
> as shipped-but-unadopted, and **ADR-112** (catalog-owned effective pricing) as Store per-module
> internals, extending the G17-G22/G24 group-axis scope-out to Store module internals. Every ADR in
> 001-125 and every functional group in G01-G28 now has an article cell or a recorded scope-out.

**Coverage history**

Twenty-six articles were added during coverage audits against the functional-group onboarding guide and the
ADR set, and are now woven into that order: polyglot persistence (ADR-018), manual DTO mapping (ADR-001),
the Common UI framework / front-end story (previously unrepresented), the G06 validation kit, resilience +
recovery objectives (ADR-009), permission-based authorization (ADR-020), browser session-cookie auth for
Blazor SSR (ADR-022), the four a 2026-06 audit surfaced: generic entity controllers
(ADR-034), resource-ownership authorization (ADR-033), edge defense pairing rate limiting (ADR-019) with
brute-force protection (ADR-029), and internationalization plus theming pairing multi-locale i18n (ADR-027,
which superseded the single-locale ADR-011) with day/dark theme (ADR-028), the two the
2026-07-04 audit surfaced: optimistic concurrency (ADR-035) and external OAuth login (ADR-036), the one the
2026-07-10 audit surfaced: live channel push (ADR-039), the new Article 22, the one the 2026-07-15
audit surfaced against the grown ADR set 042-048: the device-capability layer (ADR-042 + G27), the new
Article 42, which also carries ADR-043's mobile deep links, the two the 2026-07-17 audit appended:
managed file storage + avatars (ADR-045), the new Article 43, and HTTP API versioning (ADR-046), the new
Article 44, the one the 2026-07-21 audit surfaced against the grown ADR set 049-050: the
JWT single rotating refresh token with reuse-detection revocation (ADR-050), the new Article 27, inserted
into the auth cluster right after external OAuth login, the four the 2026-07-23 audit
appended as promotions of section-level coverage to dedicated pieces: feature flags in the CQRS pipeline
(ADR-031), the new Article 45, field-level encryption (ADR-037), the new Article 46, security headers +
CSP (ADR-023), the new Article 47, and observability (ADR-041), the new Article 48, and most recently the
one the 2026-07-25 audit appended against the grown ADR set 052-055: choreographed saga compensation with
a periodic reconciliation backstop (ADR-054), the new Article 49. That 2026-07-15 audit also folded ADR-043's
native OAuth callback into Article 26, ADR-044 (native push, the third notification channel) into Article
21, and ADR-047 (soft-deleted-user session revocation) into Article 36. The 2026-07-10 audit had recorded
ADR-040 (authenticated output caching) as covered in Article 19's edge-tier
section and ADR-041 (observability and telemetry) as covered in the Aspire deep-dive (Article 31). Earlier
audits also confirmed ADR-024/025/026/031/032 are already taught inside existing articles (21, 31, 19, 7
and 20, 17). The 2026-07-25 audit recorded ADR-055 (repository plus specification as the data-access
contract) as covered in a section of Article 6, and left ADR-052 (background job execution) and the
dynamic-LINQ query-parameterization pattern as known, deliberately deferred gaps. The 2026-07-28 audit
added **no** article: it closed the whole grown ADR set 056-060 inside existing pieces, expanding Article
35 with the runtime conformance suites (ADR-058) and Article 34 with the performance-regression gate
(ADR-060), confirming ADR-056 already taught in Article 37 and ADR-059 in Article 14, and scoping ADR-057
out with the deploy story. It also gave rubric §1 cells to Articles 4 and 7 and a §16 cell to Article 41,
closing the last two non-invertible rows in the matrix. The 2026-08-01 audit likewise added **no**
article: it closed the grown ADR set 061-064 inside existing pieces, giving Article 48 the ADR-062
alerting-as-code section it had been missing entirely and Article 34 that record's alert-to-runbook
build gate, expanding Article 35 with ADR-063's shipped WCAG 2.1 AA test contract, and scoping ADR-061
and ADR-064 out with the deploy story. It also closed two patterns no ADR names, both as sections:
cross-replica mutual exclusion (`IDistributedLock`) rewrote Article 18's lock story, and the
non-retryable ambiguous commit joined Article 09. Finally it recorded the standing group-axis
scope-out for G17-G22 and G24 (per-module ADC internals), which had never been written down. The
2026-08-07 audit likewise added **no** article: it closed the grown ADR set 065-070 inside existing
pieces, giving Article 37 the ADR-067 `IUIModule` shell-composition section, Article 31 the ADR-070
fail-fast configuration section, and Article 25 the ADR-069 DataProtection key-ring section, while
recording ADR-065 as already taught in Article 39, ADR-066 in Articles 9 and 31, and ADR-068 in
Article 5 (matrix cells added for all six). It also closed the un-named cache-outage fail-open
degradation pattern as sections of Articles 19 and 18. The ADRs
still without a dedicated article are recorded, deliberate deferrals: ADR-030
(startup sole-migrator, deploy-adjacent), ADR-048 (primitive identifier type aliases), and ADR-049 (the
library-scoped `ConfigureAwait(false)` policy) as conventions taught in passing, ADR-104 (smart enums,
shipped with zero adoption) recorded as a shipped-but-unadopted capability, ADR-112 (catalog-owned
effective pricing) inside the per-module group-axis scope-out now extended to Store module
internals, ADR-053 (dual-registry keyless OIDC publishing), ADR-057 (the expand/contract schema gate),
ADR-061 (runtime secret management) and ADR-064 (deploy recency gates), which stay inside the recorded
§17/§32 scope-outs.
