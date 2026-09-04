# ADR-110: Rubric Version 2, Category Realignment at 34

## Status
Accepted (2026-09-04).

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
(`#NN`, `TD-NN` sub-items), ADRs, onboarding chapters, and articles; the workflows carry the literal
34 in prompts and in the Part A/B/C dispatch split; and any change to the weight sum breaks the
index trend line across cycles.

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
   observability and cost attribution. Developer-side AI tooling is scored in §33, not here. All
   three repos mark it N/A today, which the rubric handles by dropping the weight from both
   denominators and stating the scope-out in the scorecard's N/A note.

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
   rule, re-weighted to 3, until its first re-score against the new criteria; §16 is N/A.

6. **Landing order.** The rubric, the three scorecards, the three backlogs, and this record land in
   one Website PR, because the workflow reads its category list from the scorecard rows and a rubric
   that changes ahead of them would score the old §10 row against the new §10 text. A full re-score
   per repo follows, one PR each, since ten categories gained criteria and §10 needs a first-time
   score. Onboarding chapters, articles, and the wiki that name the two old titles are refreshed by
   the governance commands on their next cycle, never by hand.

## Rationale
Replacing in place preserves every `#NN` citation in the backlogs, every `§NN` in the ADRs and the
scorecard history, the Part A/B/C dispatch split, and the literal 34 in the command, workflow, and
agent prompts. The two slots chosen were the two whose criteria were already scored elsewhere, so
the information loss is limited to relocating a handful of lines. Messaging earns a weight-3 slot
because a MassTransit plus Service Bus system with an outbox has its operational heart in exactly
the concerns §6 conflated with in-process dispatch. AI-native earns a slot even while N/A because an
explicit, criteria-backed scope-out is more honest than silence, and the category is scored the day a
feature calls a model. Multi-tenancy stays as criteria because an all-N/A row would cost three
scorecard rows for a decision three lines can record.

## Trade-offs
- The index trend line carries a denominator change. The scorecard headers and the backlog headers
  record both the old and the new fractions for the cycle where it happened.
- §10 is scored at carried figures that were earned against different criteria until the first
  re-score, which the row says explicitly. Store's §10 sits at implementation 8, so its
  implementation-band priority rises from 2 to 3 with the weight before any new evidence is read.
- The former §16 evidence (lockstep pin, evolvability gate, tech-debt ledger) lives on as prose in
  the retired row and in §32/§33/§34, but nothing re-scores it as its own line.
- Prose that names the two old titles persists in onboarding, articles, and the wiki until the
  governance commands refresh it, and the uncommittable drift prompt was edited in place.
- Every category that gained criteria may move at the next re-score without any code changing,
  which is the intended effect and must not be read as regression.
