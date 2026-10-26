# ADR-110: Rubric Version 2, Category Realignment at 34

## Status
Accepted (2026-09-04; section 16 scope corrected 2026-09-04: MMCA.ADC scores the category,
recorded in [ADR-111](111-ai-session-scoring-governance.md); content refreshed 2026-09-19: MMCA.Common
now scores section 16, the section 10 carried-score caveat is discharged for MMCA.Common and
MMCA.Store, and the Part A/B/C dispatch split is attributed to the command document rather than the
workflow). Revised 2026-09-25 (the section 10 carried-score caveat is discharged for all three repos:
MMCA.ADC's scorecard now scores section 10 on the v2 criteria as well). Revised 2026-10-21: evidence
dates moved to the 2026-10-18 re-scores, the articles no longer name the old titles as current, and
the drift prompt is now a tracked harness file. Revised 2026-10-26: evidence dates moved to the
2026-10-22 re-scores, which lowered MMCA.Common's section 10 row from M4/I9 to M4/I8.

## Context
The 34-category Architecture Evaluation Criteria
(`Website/docs-src/governance/ArchitectureEvaluationCriteria.md`) is the only basis on which the
three scorecards are scored, and the `/update-scorecard` workflow reads its category list from each
repo's scorecard rows. A 2026-09-04 review mapped the rubric against a broader enterprise topic map
(distributed systems, integration, cloud-native, data, resilience, security, API, delivery,
AI-native, and scale). Roughly four fifths of that map was already covered under a different
heading. Four gaps were real: nothing scored broker topology, dead-letter handling, or sagas; nothing
scored a threat model or service-to-service authentication; nothing scored progressive delivery; and
nothing scored a product feature that calls a language model.

Two existing categories were also mostly duplication. §10 Cross-Cutting Concerns had five criteria,
of which the pipeline behaviors were already in §5 and §6, caching in §12, resilience in §29, and
mapping in §9; only startup-validated options was unique. §16 Maintainability & Evolvability was the
category §34 was promoted out of, and what remained duplicated §32 (coordinated upgrades), §33
(onboarding cost), and §34 (documentation currency); its unique content was the measured-coupling
criterion, the shotgun-surgery red flag, and the tech-debt register.

Adding categories has a real cost. Every category number is cited by scorecard rows, backlog items
(`#NN`, `TD-NN` sub-items), ADRs, onboarding chapters, and articles; the `/update-scorecard` command
and its workflow both carry the literal 34 in prompts, and the command document carries a Part A/B/C
dispatch split (the workflow itself dispatches one subagent per category); and any change to the
weight sum breaks the index trend line across cycles.

## Decision
**The rubric is versioned, and version 2 keeps 34 categories with stable numbering by replacing the
two overlap-heavy categories in place and adding criteria to eleven others.**

1. **§10 becomes Messaging & Integration Architecture, default weight 3.** Criteria: broker topology
   decided by ADR (transport, topics vs queues, one publishing boundary per source, local/prod
   parity); delivery semantics stated per consumer with idempotent handling; dead-letter and
   poison-message handling with an operational procedure; bounded retention and replay; contract
   evolution with versioned events and consumer-driven contract tests; long-running processes as
   sagas with explicit compensation, never distributed transactions; gateway/BFF discipline. §6 keeps
   the in-process pipeline and the outbox write side; §10 scores what happens once a message leaves
   the process.

2. **§16 becomes AI-Native Application Architecture, default weight 2, N/A until a product feature
   calls a model.** Criteria: model calls behind a port; prompt and model versioning; an evaluation
   suite gating CI; guardrails and PII redaction at the boundary; least-privilege tool calling with a
   human in the loop for consequential actions; retrieval stores governed as data (§8, §30); LLM
   observability and cost attribution. Developer-side AI tooling is scored in §33, not here.
   MMCA.Store marks it N/A, which the rubric handles by dropping the weight from both denominators
   and stating the scope-out in the scorecard's N/A note (Sigma-weight 79). MMCA.Common was scoped
   out the same way at the rebase and is no longer: it scores the category from 2026-09-11, first at
   M2/I5 when `MMCA.Common.AI` shipped under [ADR-120](120-governed-chat-client-boundary.md), and at
   M3/I6 from 2026-09-15 (M4/I9 as of 2026-10-22, `Website/docs-src/governance/common-ArchitectureScorecard.md:80`), so its weight-2 row rejoined both denominators (Sigma-weight 82).
   MMCA.ADC scores it: its AI
   session-scoring feature calls the Anthropic Messages API in production, so the weight-2 category
   is live in both of its denominators from the 2026-09-04 re-score
   ([ADR-111](111-ai-session-scoring-governance.md)).

3. **The unique content of the two retired categories moves, not vanishes.** Startup-validated
   options and the secrets-in-config red flag move to §17. The cache-without-invalidation red flag
   moves to §12. The single-resilience-mechanism criterion and the per-call-retry red flag move to
   §29. Measured coupling, the tech-debt register, and the shotgun-surgery red flag move to §34.

4. **Eleven categories gain criteria.** §4 a stated tenancy model; §7 Anti-Corruption Layer and
   Strangler Fig as the named modernization patterns; §8 expand-contract schema change, analytical
   reads separated from OLTP, polyglot persistence by ADR, and the tenant isolation model; §9 contract
   tests at the boundary and async contract documentation; §11 a threat model, service-to-service
   authentication by identity, and tenant-scoped authorization; §12 and §29 as in item 3; §14
   contract tests at the integration tier; §17 progressive delivery (flags, slots, or canary, or an
   explicitly accepted single-slot risk with a rehearsed rollback) and trunk-based branching; §33
   AI-assisted engineering guardrails (enforced hooks, PR-only landing, same CI gates); §34 as in
   item 3. Multi-tenancy is deliberately criteria, not a category: ADC and Store are single-tenant,
   and one line in §4, §8, and §11 makes that decision visible without an all-N/A row.

5. **The rubric carries a version line, and each scorecard header records the version it was scored
   against.** Because the weight sum changes (81 to 80 for MMCA.Common, 80 to 79 for MMCA.ADC and
   MMCA.Store), the indices on either side of the version boundary are comparable only with that
   note. The rebase itself moves no score: §10 is carried at its prior scores under the merged-prior
   rule, re-weighted to 3, until each repo's first re-score against the new criteria; §16 is N/A at
   the rebase for MMCA.Common and MMCA.Store. For MMCA.ADC §16 is scored rather than scoped out, so
   its weight-2 row re-enters both denominators and its sum returns to 81. Since the rebase, every
   repo has re-scored section 10 against the v2 criteria, so no row carries a merged-prior figure:
   MMCA.Common re-scored it on 2026-09-04 and confirmed it, and its row reads M4/I8 after the
   2026-10-22 re-score (`Website/docs-src/governance/common-ArchitectureScorecard.md:74`); MMCA.Store's row reads M3/I8
   (`Website/docs-src/governance/store-ArchitectureScorecard.md:51`); MMCA.ADC's row scores it on the
   v2 criteria at M3/I8 (`Website/docs-src/governance/adc-ArchitectureScorecard.md:74`, evidence as of
   2026-10-22 per `:5`). MMCA.Common's section 16 scope-out ended on 2026-09-11, taking its sum to 82.

6. **Landing order.** The rubric, the three scorecards, the three backlogs, and this record land in
   one Website PR, because the workflow reads its category list from the scorecard rows and a rubric
   that changes ahead of them would score the old §10 row against the new §10 text. A full re-score
   per repo follows, one PR each, since eleven categories gained criteria and §10 needs a first-time
   score. Onboarding chapters, articles, and the wiki that name the two old titles are refreshed by
   the governance commands on their next cycle, never by hand.

## Rationale
Replacing in place preserves every `#NN` citation in the backlogs, every `§NN` in the ADRs and the
scorecard history, the command document's Part A/B/C dispatch split, and the literal 34 in the
command, workflow, and agent prompts. The two slots chosen were the two whose criteria were already scored elsewhere, so
the information loss is limited to relocating a handful of lines. Messaging earns a weight-3 slot
because a MassTransit plus Service Bus system with an outbox has its operational heart in exactly
the concerns §6 conflated with in-process dispatch. AI-native earns a slot because an explicit,
criteria-backed scope-out is more honest than silence where the category does not apply, and the
category is scored the day a feature calls a model, which for MMCA.ADC is the day the rubric shipped
(ADR-111). Multi-tenancy stays as criteria because an all-N/A row would cost three
scorecard rows for a decision three lines can record.

## Trade-offs
- The index trend line carries a denominator change. The headers recorded both the old and the
  new fractions only in the 2026-09-04 cycle where it happened (the rubric v2 PR, Website `b697c84`,
  and the same-day MMCA.ADC re-score, Website `994fad9`); today the scorecard headers carry only the
  current fractions and the rubric version, and the backlog headers only the current fractions and
  the evidence date, so a cross-boundary comparison has to read the scorecard's version line rather
  than a header note.
- §10 is scored at carried figures that were earned against different criteria until the first
  re-score, which the row says explicitly. Store's §10 sits at implementation 8, so its
  implementation-band priority rises from 2 to 3 with the weight before any new evidence is read.
  That carried state has since cleared for all three repos: each scorecard's section 10 row is scored
  against the v2 criteria (Common M4/I8, ADC M3/I8, Store M3/I8), so no row reads as carried and the
  section 10 figures are comparable across repos again.
- The former §16 evidence (lockstep pin, evolvability gate, tech-debt ledger) lives on as prose in
  the retired row and in §32/§33/§34, but nothing re-scores it as its own line.
- The onboarding chapters and the articles no longer name either old title as current; the article
  pages mention them only as "former" titles in their Notes blocks (one body sentence of the
  fitness-functions article refers to "the former maintainability criteria" without naming the
  title, and the rubric article's body names "Cross-Cutting Concerns" only inside the current Part C
  label, `Website/docs-src/articles/34-category-architecture-rubric.md:61`, which the rubric still uses at
  `ArchitectureEvaluationCriteria.md:768`), and the build-skipped
  `_ledger.md` keeps them only in dated historical entries. Prose that names them as current
  still exists in the wiki sources, which the governance commands have not yet refreshed. The drift
  prompt (`Docs/Planning/Drift/DriftAnalysis-prompt.md`, tracked in the workspace harness repo) was
  edited in place for the v2 section 10 and section 16 entries, but its section 16 entry still says
  N/A in both apps, which no longer holds for MMCA.ADC (item 2 of the Decision); treat that entry as
  stale until the next drift-prompt refresh.
- Every category that gained criteria may move at the next re-score without any code changing,
  which is the intended effect and must not be read as regression.

## Revision (2026-10-21)
Re-verified against current source. The decision, the 34-category numbering, the section 10 and
section 16 replacements and every scored value this record cites are unchanged; what moved is the
evidence date of the three scorecards, the state of the articles, and the tracking of the drift
prompt.

1. The scorecards were re-scored on 2026-10-18 (`Website/docs-src/governance/common-ArchitectureScorecard.md:5`,
   `adc-ArchitectureScorecard.md:5`, `store-ArchitectureScorecard.md:5`). The values are unchanged:
   MMCA.Common section 16 reads M4/I9 (`common-ArchitectureScorecard.md:80`) and section 10 M4/I9
   (`:74`); MMCA.ADC section 10 reads M3/I8 (`adc-ArchitectureScorecard.md:74`); MMCA.Store section 10
   reads M3/I8 (`store-ArchitectureScorecard.md:51`). Items 2 and 5 now carry the 2026-10-18 date.
2. The scorecard headers (`adc-ArchitectureScorecard.md:5-10`, and the same lines in the Common and
   Store files) and the backlog headers (`adc-RemediationBacklog.md:3`, `common-RemediationBacklog.md:3`,
   `store-RemediationBacklog.md:3`) carry only the current fractions (the backlogs carry no rubric
   version, only the evidence date); the dual fractions existed only in the 2026-09-04 cycle, the
   rubric v2 PR (Website `b697c84`) and the same-day MMCA.ADC re-score (Website `994fad9`, whose ADC
   backlog header kept 313/320 and 685/800 beside the rebased figures). The first Trade-offs bullet
   now says so.
3. The articles no longer name either old title as current: the mentions in article pages say "former"
   and sit in their Notes blocks (`Website/docs-src/articles/feature-flags-cqrs-pipeline.md:367`,
   `architecture-fitness-functions.md:626-627`). The wiki sources still name them as current
   (`Wiki/sources/onb-group-05-cqrs-pipeline.md:16`, `Wiki/sources/article-19-self-invalidating-cache.md:33`).
4. The drift prompt is no longer uncommittable: `Docs/Planning/Drift/DriftAnalysis-prompt.md` is
   tracked in the workspace harness repo, and its v2 entries for section 10 and section 16 sit at
   `:157` and `:163`. The section 16 entry (`:163`) still reads N/A in both apps, which contradicts
   MMCA.ADC's scored section 16 row (`adc-ArchitectureScorecard.md:80`); the Trade-offs bullet now
   flags it as stale.
5. Anchors re-verified against current source: `common-ArchitectureScorecard.md:5`, `:74`, `:80`;
   `adc-ArchitectureScorecard.md:5`, `:74`; `store-ArchitectureScorecard.md:5`, `:51`;
   `feature-flags-cqrs-pipeline.md:367`; `architecture-fitness-functions.md:626-627`;
   `DriftAnalysis-prompt.md:157`, `:163`.

## Revision (2026-10-26)
Re-verified against current source. The decision, the 34-category numbering, the section 10 and
section 16 replacements, and the MMCA.ADC and MMCA.Store values this record cites are unchanged; what moved is the
evidence date of the three scorecards and MMCA.Common's section 10 implementation score.

1. The scorecards were re-scored on 2026-10-22 at v1.250.0
   (`Website/docs-src/governance/common-ArchitectureScorecard.md:5`, `adc-ArchitectureScorecard.md:5`,
   `store-ArchitectureScorecard.md:5`). Items 2 and 5 of the Decision now carry the 2026-10-22 date.
2. MMCA.Common's section 10 row now reads weight 3, M4/I8, 12/24 (`common-ArchitectureScorecard.md:74`),
   down from the M4/I9 the 2026-10-21 revision recorded. Decision item 5 and the second Trade-offs
   bullet now read M4/I8. MMCA.Common section 16 still reads M4/I9 (`common-ArchitectureScorecard.md:80`);
   MMCA.ADC section 10 M3/I8 (`adc-ArchitectureScorecard.md:74`) and MMCA.Store section 10 M3/I8
   (`store-ArchitectureScorecard.md:51`) are unchanged.
3. The article mentions of the former titles still say "former" and still sit in the Notes blocks
   (`Website/docs-src/articles/feature-flags-cqrs-pipeline.md:389`, Notes from `:272`;
   `architecture-fitness-functions.md:662-663`, Notes from `:579`). One body sentence outside a Notes
   block, `architecture-fitness-functions.md:169`, refers to "the former maintainability criteria"
   without naming the old title; the Trade-offs bullet now says so.
4. Anchors re-verified against current source: `common-ArchitectureScorecard.md:5`, `:74`, `:80`;
   `adc-ArchitectureScorecard.md:5`, `:74`; `store-ArchitectureScorecard.md:5`, `:51`;
   `feature-flags-cqrs-pipeline.md:272`, `:389`; `architecture-fitness-functions.md:169`, `:579`,
   `:662-663`.
