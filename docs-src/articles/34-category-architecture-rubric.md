# What good architecture actually means: a 34-category rubric you can score yourself against

> Series: MMCA.Common · Article #3 (cornerstone) · Pillar P4 · Rubric: all
> Status: grounded in `Website/docs-src/governance/ArchitectureEvaluationCriteria.md` (rubric version 2,
> ADR-110) and `Website/docs-src/governance/common-ArchitectureScorecard.md`. No em dashes. Current facts
> (two-axis index: Maturity 96.6%, Implementation 86.0%; all 34 categories scored, no N/A, with §16
> AI-Native Application Architecture carrying a scored 4 / 9 rather than an exemption; the first-scored
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
scorecard to the repo. The framework stands at a maturity index of 96.6% and an implementation index of
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
`Website/docs-src/governance/common-ArchitectureScorecard.md`), it landed at a **maturity index of 96.6% and
an implementation index of 86.0%** across **all 34 categories**. No category sits at N/A: multi-locale
i18n ships under ADR-027, which supersedes the single-locale ADR-011, and Internationalization scores
maturity 4, implementation 8 on that evidence, while AI-Native Application Architecture carries a scored
maturity 4, implementation 9 rather than an exemption, because the framework ships its own governed
model-calling package. The N/A verdict stays available on principle: do not penalize a system for a
category that does not apply to it, but say so explicitly, in a decision record that any later evidence
can reopen.

The high scores clustered exactly where I would want them to: Clean Architecture, Microservices
Readiness, Supply-Chain, and Testability all reached maturity 4 with implementation 9, each enforced
automatically. The two axes are deliberately asymmetric: maturity (96.6%) runs ahead of implementation
(86.0%), and that gap is the most useful thing the scorecard says. It is structural, not a defect. It is
also honest in both directions, which is rarer than it sounds: every score states what today's evidence
supports and nothing more, so a category holds a 9 only while its stated reasoning still carries an
Exemplary verdict, and it moves *down* as readily as up when the next re-score reads the evidence
(Testability scores 9 on a gated coverage floor of 68.3%). A rubric that only ever ratchets up is not
being honest, and neither is one that only ratchets down. No category scores below 8 on implementation,
and Cost Efficiency / FinOps holds the lowest maturity, a 2. Most of the remaining implementation gap is
structural rather than neglected: deployment execution, production SLOs, cost right-sizing and the
consent process belong to the consuming apps, not to a library.

When I first scored the framework, the lowest category was **Compliance, Privacy and Data Governance**:
soft-delete everywhere, with no right-to-erasure path. That is the exact GDPR conflict the rubric names
as a red flag in category 30. I wrote it down rather than hiding it, and it became the roadmap: ADR-005's
erasure extension point and a PII fitness function that fails the build. That category scores maturity 3,
implementation 8. The gap turned into the next decision, then into a higher score. That is the entire
reason to score yourself in public.

## The one insight worth the whole exercise

When I lined the scores up, a single pattern explained almost all of the variance between the top tier
and the middle tier, and it is the pattern that has driven every re-score since. Thirty of the 34
categories sit at maturity 4, most of them on build-breaking gates: layer rules, domain purity,
transport coupling, outbox behavior, an automated database restore drill. The three categories still
capped at 3 have the right design but stop short of an automatic, always-on gate: SOLID enforces only its
single-responsibility and dependency-inversion rules automatically, Compliance ships its audit-trail and
data-export surfaces opt-in, and DevOps and Deployment is the cleanest illustration: the repo ships a
reference Bicep deployment sample plus a CI job that compiles it, but that job is not one of the eight
required contexts on the branch, and the deployment machinery itself lives in consumer repos, so the
rule is trusted rather than gated. Performance and
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
  scored keeps moving: twenty-two published packages, lock files, an SBOM-gated release, a
  `DependencyVersionTests` guard for the MassTransit pin, and the ADR-005 erasure extension point all
  postdate the first committed pass. Each re-verification re-scores it on both axes and stamps the
  version and commit it read. The honest framing is "scored, published, then fixed, then re-scored":
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
96.6% maturity / 86.0% implementation as a worked example including its first-scored lowest category and
its later remediation, and the single insight that explains the top tier: enforced beats convention-only.

**Next in the series:** the Result railway that retired exceptions-as-control-flow, the foundational
pattern every layer returns instead of throwing.

*MMCA.Common is Apache-2.0 licensed and open source. The most useful thing you can do is read the scorecard,
gaps and all, and then score one of your own systems against the rubric.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 The full 34-category rubric (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md`) and the filled scorecard
  (`Website/docs-src/governance/common-ArchitectureScorecard.md`) are in the docs site.

*Tags: Software Architecture, .NET, Engineering Management, Code Quality, Technical Leadership*

*Notes (2026-10-08 refresh, framework v1.233.0): the two-axis indices (Maturity 96.6% = 317/328, Implementation
86.0% = 705/820), the all-34-categories-scored / no-N/A status and the per-category scores are taken from the
canonical two-axis scorecard, `Website/docs-src/governance/common-ArchitectureScorecard.md` (`:9` Maturity index,
`:10` Implementation index, `:104` "N/A (excluded from denominators): none", sigma-weight 82). Scorecard evidence
stamp: 2026-10-07 at v1.233.0, git HEAD `55e427b3`, clean tree (`:5`); the framework is v1.233.0 per
`MMCA.Common/FACTS.md:4,14`, so the scorecard and FACTS agree on the version, and the article claims only that each re-verification
stamps the version and commit it read. Twenty-two published packages (`FACTS.md:19`). Category row N sits at
scorecard line 64+N (`:65` to `:98`). Section 16 AI-Native Application Architecture is Maturity 4 / Implementation
9 on weight 2 (`:80`), scored because `MMCA.Common.AI` ships a model-calling feature (`:104`). The Maturity-3
categories are section 1 SOLID (`:65`: only SRP and DIP are enforced automatically, ISP, LSP and OCP have no
automated gate), section 17 DevOps & Deployment (`:81`) and section 30 Compliance (`:94`: audit trail and DSAR
export are opt-in twice over), with section 31 Cost Efficiency / FinOps at Maturity 2 (`:95`); the maturity band
is at `:12`. Thirty of 34 categories sit at Maturity 4, "most of them on build-breaking gates" (`:15`), which is
why the insight section says "most" rather than "every". The lowest Implementation is 8, held by 15 categories
(`:13`); the structural-gap sentence paraphrases `:15`. At Maturity 4 / Implementation 9: Clean Architecture
section 3 (`:67`), Microservices section 7 (`:71`), Testability section 14 (`:78`) and Supply-Chain section 32
(`:96`, weight 3). Section 27 Internationalization is Maturity 4 / Implementation 8 on weight 1 (`:91`); ADR-027
supersedes the single-locale ADR-011 (`Website/docs-src/adr/README.md:24,40`). Section 20 Design System is
Implementation 8 (`:84`), section 21 Accessibility 9 (`:85`) and section 22 Responsive 9 (`:86`); the dark-theme
WCAG AA contrast values are at `Source/Presentation/MMCA.Common.UI/Theme/MMCATheme.cs:66,93`, locked by the
`ui-e2e` job (`.github/workflows/ci.yml:223`, `browser: [chromium, firefox, webkit]` matrix at `:232`, all three
required per `:233-235`). Section 14 Testability rests on a CI line-coverage floor of 68.3% (the `Enforce coverage
floor (unit/arch/bUnit tier, generated code excluded)` step at `ci.yml:398`, `m="68.3"` at `:409`, 70.3% measured
per `:396`). Section 9 API & Contract Design is Maturity 4 / Implementation 9 (`:73`), section 10 Messaging &
Integration Architecture is weight 3, Maturity 4 / Implementation 9 (`:74`), section 11 Security is Maturity 4 /
Implementation 8 (`:75`), section 23 Front-End Performance is Maturity 4 / Implementation 8 (`:87`), and slice
cohesion section 5 (`:69`) and Resilience section 29 (`:93`) are Maturity 4. The insight section's convention-only
survivor is section 17: `sample-deployment-validate` (`ci.yml:766`) runs two compile-only `az bicep build` steps
(`:778`, `:782`) and is absent from the 8 required contexts (scorecard `:81`, read from the branch-protection
API); section 12 Performance & Scalability is the merge-enforced counterpart at Maturity 4 (`:76`), gated by the
`Performance gate (BenchmarkDotNet Short + baseline verify)` job (`ci.yml:311`) running `--filter "*" --job Short
--exporters json` (`:343`) then `build/perfgate` against the committed `perf-baseline.json` (`:352`). The
idempotency guard resolves an `IDistributedLock`
(`Source/Presentation/MMCA.Common.API/Idempotency/IdempotencyFilter.cs:149`) and `AddCaching` registers
`RedisDistributedLock` whenever a Redis multiplexer is present
(`Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:88-96`; SET with When.NotExists and an
expiry plus compare-and-delete at
`Source/Core/MMCA.Common.Infrastructure/Concurrency/RedisDistributedLock.cs:37,67`). The SBOM release gate is
`.github/workflows/release.yml:106` (the `Generate SBOM (CycloneDX)` step; hard-gate comment `:103-105`); the MassTransit pin guard is
`Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/DependencyVersionTests.cs:9`. Rubric facts are from
`Website/docs-src/governance/ArchitectureEvaluationCriteria.md`: version 2 of 2026-09-04 (`:15-23`, ADR-110),
section 10 Messaging & Integration Architecture (`:329`), section 16 AI-Native Application Architecture (`:469`),
Level 4 Optimized (`:39`), the Exemplary band "10 = almost perfect" (`:60`), section 30 red flags (`:805`, `:812`)
and section 32 breaking-change policy (`:850`); the scorecard states Implementation 10 is awardable (`:107`). Kept
on purpose as the original snapshot: the earlier single-axis baseline (80% / 218 of 272 / 28 applicable) and the
first-scored lowest category (Compliance, soft-delete only, no erasure) are from MMCA.Common commit `f518099`,
`ArchitectureScorecard.md:3` and `:42`; the "MassTransit will retry" comment and the `ServiceContractAttribute`
claiming a nonexistent test are at `:100` and `:117` of the same commit. Neither is in the current scorecard. 2026-10-08
run (Common v1.233.0): no reader-visible claim changed; Notes header v1.221.0 to v1.233.0; scorecard stamp
2026-10-01 / v1.218.0 / `f93bc6e2` dirty to 2026-10-07 / v1.233.0 / `55e427b3` clean, so "the scorecard trails
FACTS" became "agree"; `ci.yml` anchors re-read (`ui-e2e` 248/257/258-260 to 223/232/233-235, coverage floor
451/462/449 to 398/409/396, `sample-deployment-validate` 819/831/835 to 766/778/782, Performance gate 356/388/397 to
311/343/352); SBOM gate `release.yml:101` to `:106`; `DependencyInjection.Caching.cs:86-94` to `:88-96`. Scorecard
rows `:76` and `:81` still cite the pre-shift `ci.yml` lines (upstream drift, not corrected here). 2026-10-02
run: maturity 97.0% (318/328) to 96.6% (317/328); section 16 from 3/6 to 4/9; SOLID dropped from the Maturity 4 /
Implementation 9 cluster (it is 3/8); section 27 and section 20 implementation 9 to 8; lowest implementation 6
(section 16 alone) to 8 (15 categories); Maturity-3 set 16/17/30 to 1/17/30; packages nineteen to twenty-two;
"every category at maturity 4 is backed by a fitness function" narrowed to "most of them on build-breaking gates";
"every release, through thirty-six remediation waves" removed (no wave count in any governance file); the v1.84.0
PiiRedactor 7-to-8 history removed (not in the current scorecard); the 2026-08-01 recalibration anchor replaced by
`:107`. Re-verify the numbers before publishing.*

- Full series index: https://ivanball.github.io/writing.html
