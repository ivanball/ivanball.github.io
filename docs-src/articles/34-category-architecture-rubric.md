# What good architecture actually means: a 34-category rubric you can score yourself against

> Series: MMCA.Common · Article #3 (cornerstone) · Pillar P4 · Rubric: all
> Status: grounded in `Website/docs-src/governance/ArchitectureEvaluationCriteria.md` (rubric version 2,
> ADR-110) and `Website/docs-src/governance/common-ArchitectureScorecard.md`. No em dashes. Current facts
> (two-axis index: Maturity 97.0%, Implementation 86.0%; all 34 categories scored, no N/A, with §16
> AI-Native Application Architecture carrying a scored 3 / 6 rather than an exemption; the first-scored
> lowest category later remediated via ADR-005).

**Subtitle:** "Clean architecture" is not a vibe. Here is a 34-category rubric that scores any system on
two axes, demands evidence for every score, and exposes the one line that separates the top tier from
the middle: enforced versus convention-only.

---

Ask ten senior engineers whether a codebase has "good architecture" and you will get ten different
answers, all confident, none comparable. Someone points at the folder structure. Someone else points at
the absence of a god class. A third says it "feels clean." None of those are measurements. They are
impressions, and impressions do not survive a code review six months later, let alone an audit.

I wanted something better for my own framework, so I wrote a rubric: 34 categories, each scored on two
axes, each requiring evidence. Then I scored MMCA.Common against it in public and committed the
scorecard to the repo. The framework landed at a maturity index of 97.0% and an implementation index of
86.0%. This article is about the rubric itself, because the scoring instrument is more reusable than the
score.

## Why "good architecture" needs a rubric

The problem with architectural quality is that it is multi-dimensional and most of the dimensions are
invisible until they bite you. SOLID discipline is invisible until a feature requires editing a switch
statement in nine places. The absence of an outbox is invisible until a broker restart loses an order.
A soft-delete-only data model is invisible until a regulator asks you to delete a person's data and you
realize you cannot.

A rubric makes those dimensions explicit and forces you to look at each one deliberately, instead of
scoring the whole system on whichever facet happens to be salient that day. It also makes the result
comparable: across repos, across teams, and across time, because everyone is answering the same
questions against the same scale.

## The structure: three parts, 34 categories

The rubric (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md`) is organized into three parts that
match how a real system is actually built and operated. It stands at version 2 (ADR-110), which holds the
count at 34 and keeps every category number stable, so scorecard rows, backlog items and ADR citations all
point at the same category across revisions.

**Part A, Application and Backend Architecture (categories 1 to 17).** The classic backend concerns:
SOLID Principles, Design Patterns, Clean Architecture, Domain-Driven Design, Vertical Slice
Architecture, CQRS and Event-Driven Design, Microservices Readiness, Data Architecture, API and
Contract Design, Messaging and Integration Architecture, Security, Performance and Scalability,
Observability and Operability, Testability and Test Strategy, Best Practices and Code Quality,
AI-Native Application Architecture, and DevOps and Deployment.

**Part B, Front-End and UI Architecture (categories 18 to 28).** The presentation tier gets first-class
treatment instead of a footnote: UI Architecture and Component Design; State Management and Data Flow;
Design System, Theming and UI Consistency; Accessibility; Responsive Design and Cross-Browser/Device;
Front-End Performance and Rendering; Forms, Validation and UX Safety; Navigation, Routing and
Information Architecture; Front-End Security; Internationalization and Localization; and Front-End
Testing and Quality.

**Part C, Operational, Governance and Cross-Cutting Concerns (categories 29 to 34).** The lifecycle
concerns that separate a demo from a system you can run for years: Resilience, Reliability and Business
Continuity; Compliance, Privacy and Data Governance; Cost Efficiency / FinOps; Dependency and
Supply-Chain Management; Developer Experience and Inner Loop; and Architecture Governance and
Documentation.

The three-part split is itself opinionated. Most architecture reviews stop at Part A. They never ask
whether a database restore has actually been tested (category 29), whether soft-delete reconciles with
right-to-erasure (category 30), or whether the framework you publish has a breaking-change policy
(category 32). Those are exactly the categories that turn into incidents.

## The two axes: maturity and implementation, evidence or it does not count

Here is the part that makes the rubric honest. Each category gets **two** scores, not one.

- **Maturity (0 to 4)** measures *process*: how consistently and how well-governed the pattern is, on a
  scale from Absent (0) through Initial, Developing, Consistent, to Optimized (4). Level 4 has a precise
  meaning: "enforced automatically (analyzers, tests, CI), documented, and evolved deliberately."
- **Implementation (0 to 10)** measures *substance*: how good the implementation is right now, judged
  against the category's concrete criteria and red flags, from None (0) to Exemplary (where 10 means
  almost perfect: every criterion met at reference quality, no red flags, at most trivial polish left).

The two axes measure genuinely different things. A category can be mature-but-mediocre (enforced
conventions wrapped around a weak design) or excellent-but-inconsistent (a strong implementation
applied in only a few spots). One number cannot capture that gap. Two can, and the size of the gap
between them is itself a finding worth writing down.

And the rule that gives the whole instrument its teeth: **a score without evidence is an opinion.**
Every category requires file paths, PRs, or ADRs as evidence. You do not get to claim a 4 in Clean
Architecture because the folders look right. You claim it because you can point at the test or the
build target that fails when someone violates it.

## How the index is computed

The scores roll up into two indices using per-category weights (defaults provided, adjustable per
engagement). The maturity index is the sum of (category maturity × weight) divided by the sum of
(weight × 4), giving a 0 to 100% architecture-health number. The implementation index is the parallel
calculation over the 0 to 10 axis. Comparing the two tells you which axis is your weaker one: a lower
implementation index means quality is lagging, a lower maturity index means consistency and governance
are.

## The worked example: MMCA.Common, scored on both axes

When I ran MMCA.Common through the rubric (the canonical, version-controlled scorecard lives in
`Website/docs-src/governance/common-ArchitectureScorecard.md`), it landed at a **maturity index of 97.0% and
an implementation index of 86.0%** across **all 34 categories**. No category sits at N/A: multi-locale
i18n ships under ADR-027, which supersedes the single-locale ADR-011, and Internationalization scores
maturity 4, implementation 9 on that evidence, while AI-Native Application Architecture carries a scored
maturity 3, implementation 6 rather than an exemption. The N/A verdict stays available on principle: do
not penalize a system for a category that does not apply to it, but say so explicitly, in a decision
record that any later evidence can reopen.

The high scores clustered exactly where I would want them to: Clean Architecture, SOLID, Microservices
Readiness, Supply-Chain, and Testability all reached maturity 4 with implementation 9, each enforced
automatically. The two axes are deliberately asymmetric: maturity (97.0%) runs ahead of implementation
(86.0%), and that gap is the most useful thing the scorecard says. It is structural, not a defect. It is
also honest in both directions, which is rarer than it sounds: every score states what today's evidence
supports and nothing more, so a category holds a 9 only while its stated reasoning still carries an
Exemplary verdict, and it moves *down* as readily as up when the next re-score reads the evidence
(Testability scores 9 on a gated coverage floor of 68.3%). A rubric that only ever ratchets up is not
being honest, and neither is one that only ratchets down. AI-Native Application Architecture carries the
lowest implementation on its own, at 6 on weight 2, and Cost Efficiency / FinOps holds the lowest
maturity, a 2, precisely because the substance those two reward (a product feature that calls a model,
right-sizing, per-service cost attribution) lives in consumer apps, not in a library.

When I first scored the framework, the lowest category was **Compliance, Privacy and Data Governance**:
soft-delete everywhere, with no right-to-erasure path. That is the exact GDPR conflict the rubric names
as a red flag in category 30. I wrote it down rather than hiding it, and it became the roadmap: ADR-005's
erasure extension point and a PII fitness function that fails the build. That category scores maturity 3,
implementation 8. The gap turned into the next decision, then into a higher score. That is the entire
reason to score yourself in public.

## The one insight worth the whole exercise

When I lined the scores up, a single pattern explained almost all of the variance between the top tier
and the middle tier, and it is the pattern that has driven every re-score since. Every category that
reached maturity 4 is backed by a fitness function or a compile-time guard: layer rules, domain purity,
transport coupling, outbox behavior, an automated database restore drill. Every category still capped at
3 has the right design but leaves its enforcement short of a required merge gate. DevOps and Deployment
is the cleanest illustration: the repo ships a reference Bicep deployment sample plus a CI job that
compiles it, but that job is not one of the eight required contexts on the branch, and the deployment
machinery itself lives in consumer repos, so the rule is trusted rather than gated. Performance and
Scalability sits on the other side of exactly that line: a BenchmarkDotNet harness fails CI on latency or
allocation regressions against a committed baseline, its context is in the branch's required checks, and
the category holds a 4 because the existing check is a check that can fail the merge.

The dividing line between a 4 and a 3 was not design quality. The 3s often had perfectly good designs.
The dividing line was **enforced versus convention-only.** A rule that fails the build is a 4. The same
rule written in a README and trusted to code review is a 3, because reviewers get tired, new hires do
not know the rule, and "the design was right" is cold comfort the day someone commits a violation that
nobody caught.

That is the durable, portable takeaway, and it is true regardless of your stack: the highest-leverage
architectural investment is usually not a better design. It is turning a design you already have into a
check that fails when someone breaks it.

## Trade-offs, honestly

A rubric is a tool, not an oracle, and it has sharp edges worth naming.

- **It can be gamed.** If you score yourself, you can rationalize a 3 into a 4. The evidence requirement
  is the guardrail, but only if you are honest about whether the evidence is a real check or a hopeful
  comment. The MMCA.Common scorecard caught its own framework over-promising in exactly this way: a
  "MassTransit will retry" comment with no configured retry policy, and a `ServiceContractAttribute`
  claiming a test that did not exist. Prose that claims enforcement is not enforcement.
- **Weights are subjective.** The defaults encode my judgment of risk. A FinTech system would weight
  Compliance and Security far higher than a framework does. Re-weight for your context, and write down
  why.
- **Some categories are genuinely N/A.** Be willing to exclude rather than fudge. But excluding should
  be a documented decision, not a convenient dodge for a category you would rather not face.
- **A snapshot ages.** A scorecard is true only for the commit it was read against, and the thing being
  scored keeps moving: nineteen published packages, lock files, an SBOM-gated release, a
  `DependencyVersionTests` guard for the MassTransit pin, and the ADR-005 erasure extension point all
  postdate the first committed pass. Re-verifications re-score it on both axes every release, through
  thirty-six remediation waves. The honest framing is "scored, published, then fixed, then re-scored":
  the score is a starting line, not a trophy. Re-run it per release.

## Apply this even without MMCA

You do not need this framework, or even this exact rubric, to get the benefit:

1. **Pick a fixed set of categories** and score every system against the same set. Comparability is
   most of the value, and it only exists if the questions stop changing.
2. **Score two axes, not one.** Separate "how good is it" from "how consistently is it enforced." The
   gap between them is your most actionable finding.
3. **Demand evidence for every score.** A file path, a PR, an ADR, or it is an opinion. This single rule
   does more than any category definition.
4. **Treat the lowest score as the roadmap,** not the embarrassment. Publishing the gap is what turns it
   into the next decision instead of the next incident.
5. **Convert your best designs into checks.** The 4s in any honest scorecard are the rules that fail the
   build. Find your convention-only 3s and ask which one would most hurt if a newcomer violated it
   silently. Promote that one first.

The rubric's real message is not the score. It is that architectural quality is measurable, the
measurement should be public, and the cheapest way to move a category from a 3 to a 4 is almost never a
redesign. It is a check.

---

**What we covered:** why "good architecture" needs a measurable rubric, the three-part 34-category
structure, the two-axis (maturity plus implementation) scoring with mandatory evidence, MMCA.Common's
97.0% maturity / 86.0% implementation as a worked example including its first-scored lowest category and
its later remediation, and the single insight that explains the top tier: enforced beats convention-only.

**Next in the series:** the Result railway that retired exceptions-as-control-flow, the foundational
pattern every layer returns instead of throwing.

*MMCA.Common is Apache-2.0 licensed and open source. The most useful thing you can do is read the scorecard,
gaps and all, and then score one of your own systems against the rubric.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 The full 34-category rubric (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md`) and the filled scorecard
  (`Website/docs-src/governance/common-ArchitectureScorecard.md`) are in the docs site.

*Tags: Software Architecture, .NET, Engineering Management, Code Quality, Technical Leadership*

*Notes: the two-axis indices (Maturity 97.0% = 318/328, Implementation 86.0% = 705/820), the
all-34-categories-scored / no-N/A status, and the per-category scores are taken from the repo's canonical
two-axis scorecard, `Website/docs-src/governance/common-ArchitectureScorecard.md` (`:120` Maturity index, `:121`
Implementation index, `:124` "N/A (excluded from denominators): none this cycle"). Sigma-weight is 82: §16
AI-Native Application Architecture is scored Maturity 3 / Implementation 6 on weight 2 (`:96`) and that weight
sits in both denominators (`:124`). The category names, the two-axis scale, the three-part structure and the
maturity-level definitions are from `Website/docs-src/governance/ArchitectureEvaluationCriteria.md`, rubric
version 2 of 2026-09-04 (`:15-23`), which keeps 34 categories and every category number while making two
in-place replacements: §10 is Messaging & Integration Architecture (`:329`) and §16 is AI-Native Application
Architecture (`:469`); decision record ADR-110 (`Website/docs-src/adr/110-rubric-v2-category-realignment.md`).
The Exemplary band reads "10 = almost perfect: every criterion met at reference quality, no red flags, at most
trivial polish left" (`ArchitectureEvaluationCriteria.md:60`), and the scorecard's 2026-08-01 recalibration line
retires the former "attainable ceiling" reporting framing (`:122`). §27 Internationalization is Maturity 4 /
Implementation 9 (`:107`) after the i18n completion train (ADR-027 Decision 9): the pseudo-localization pass is a
required chromium CI gate and the framework chrome is fully externalized. ADR-027 supersedes the single-locale
ADR-011 (`Website/docs-src/adr/README.md:23,39`). §11 Security is Maturity 4 / Implementation 8 (`:91`:
deployer-owned vault/managed-identity binding, RBAC-with-capability-indirection). §14 Testability is Maturity 4 /
Implementation 9 (`:94`) on a CI line-coverage floor of 68.3% (the `Enforce coverage floor (unit/arch/bUnit tier,
generated code excluded)` step, `.github/workflows/ci.yml:470`, threshold `m="68.3"` at `:481`, ~70.3% measured per
`:467-468`), so it sits with Clean Architecture §3 (`:83`), SOLID §1 (`:81`), Microservices §7 (`:87`) and
Supply-Chain §32 (`:112`) at Implementation 9 / Maturity 4. §30 Compliance is Maturity 3 / Implementation 8
(`:110`, implementation lifted 7 to 8 in v1.84.0 when `PiiRedactor` shipped). Slice cohesion §5 (`:85`) and
Resilience §29 (`:109`) are Maturity 4 (SliceCohesionTests / the build-gated DatabaseRestoreDrillTests), so
neither lacks an automated guard. §23 Front-End Performance is Maturity 4 / Implementation 8 (`:103`) on the
`WebVitalsE2ETests` LCP/TTFB/CLS budgets inside the blocking chromium `ui-e2e` gate. §9 API & Contract Design is
Maturity 4 / Implementation 9 (`:89`). The categories at Maturity 3 are §16 (`:96`), §17 DevOps & Deployment
(`:97`) and §30 (`:110`), with §31 Cost Efficiency / FinOps at Maturity 2 (`:111`). The article's insight section
tracks §17 as the convention-only survivor: its `sample-deployment-validate` job runs two compile-only
`az bicep build` steps and is absent from the 8 required contexts, and the CD machinery lives in consumer repos,
so deployment stays review-enforced rather than merge-enforced (`:97`); §12 Performance & Scalability is the
merge-enforced counterpart at Maturity 4 (`:92`), gated by the `Performance gate (BenchmarkDotNet Short + baseline
verify)` job (`.github/workflows/ci.yml:378`) which runs `--filter "*" --job Short --exporters json` (`:410`) then
a `build/perfgate` step verifying results against the committed `perf-baseline.json` (`:419`), with no
`continue-on-error` anywhere in the job. The single lowest Implementation is 6, held by §16 alone (`:96`); §31
FinOps is Implementation 8 on weight 2 (`:111`, right-sizing / reversible scale-events / per-service attribution
are consumer/IaC execution). §27 i18n is Implementation 9 (`:107`), §22 Responsive 9 (`:102`), §20 Design System 9
(`:100`) and §21 Accessibility 9 (`:101`), the last two resting on the dark-theme WCAG AA contrast values in the
palette (`Theme/MMCATheme.cs:66,93`) locked by a blocking dark-mode axe gate inside the `ui-e2e` job
(`.github/workflows/ci.yml:270`, whose `browser: [chromium, firefox, webkit]` matrix at `:279` is all-required per
`:280-282`); Deployment §17 (`:97`) is Implementation 8. §10 is Messaging & Integration Architecture at weight 3,
Maturity 4 / Implementation 9 (`:90`). The idempotency guard resolves an `IDistributedLock`
(`Idempotency/IdempotencyFilter.cs:148`) and `AddCaching` registers the SET-NX-PX plus compare-and-delete
`RedisDistributedLock` whenever a Redis multiplexer is present (`Infrastructure/DependencyInjection.cs:319-325`;
ADR-017 revised). Latest full 34-category two-pass evidence re-score is the thirty-sixth wave (2026-09-19 at
framework v1.205.0, git HEAD `90ffa7a`, clean tree, scorecard `:5`), which moves nothing: 24 categories re-confirm
fresh and ten first-pass lift proposals came back FLAG and were refuted on the adversarial pass, so both indices
hold at 97.0% / 86.0%. The twenty-seventh wave (2026-08-14 at v1.152.0, git HEAD `3ba8d13`, clean tree, scorecard
`:67`) likewise moved nothing, refuting nine first-pass proposals. The framework is v1.205.0 per `FACTS.md`
(`FACTS.md:4,14`); nineteen published packages (`FACTS.md:19`). The earlier single-axis snapshot (80% / 218 of
272 / 28 applicable) is the deliberate historical baseline that the two-axis scorecard replaced (scorecard `:3`
notes it survives in git history); confirmed by git archaeology at MMCA.Common commit `f518099` ("Remediation
wave 2"), `ArchitectureScorecard.md:3` ("**Weighted architecture-health index: 80%** (218 of 272 weighted points
across 28 applicable categories; 6 N/A categories excluded)"), so it is kept here as past-tense history, not
re-derived and not a drift. The "MassTransit will retry" over-promise quoted in the gaming trade-off has no match
in the current scorecard text and was not re-verified this run. Re-verify the numbers before publishing.*

- Full series index: https://ivanball.github.io/writing.html
