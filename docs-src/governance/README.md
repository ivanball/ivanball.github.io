# Architecture Governance

The governance artifacts behind the MMCA platform: the shared 34-category evaluation rubric, and each repo's evidence-based scorecard plus its remediation backlog. Every score cites real code (path and line), and every backlog item traces to a rubric category.

## The rubric

- [Architecture Evaluation Criteria](ArchitectureEvaluationCriteria.md): the 34-category rubric (Maturity 0-4 and Implementation 0-10 per category) that all three application repos are scored against.

## Scorecards and backlogs

| Repo | Scorecard | Remediation backlog |
|------|-----------|---------------------|
| MMCA.Common (framework) | [Scorecard](common-ArchitectureScorecard.md) | [Backlog](common-RemediationBacklog.md) |
| MMCA.Store (e-commerce) | [Scorecard](store-ArchitectureScorecard.md) | [Backlog](store-RemediationBacklog.md) |
| MMCA.ADC (conference) | [Scorecard](adc-ArchitectureScorecard.md) | [Backlog](adc-RemediationBacklog.md) |

## How these are maintained

Scores are re-verified from source on a cadence: each category is scored by reading the current code, config, and CI (never rolled forward), and any change lands with the evidence that justifies it. The backlogs record what was found, what shipped, and what was consciously accepted as-is. Framework-wide numbers (package count, ADR range, fitness-function totals) are owned by [FACTS.md](https://github.com/ivanball/MMCA.Common/blob/main/FACTS.md) in the MMCA.Common repo.

Related reading: the [Architecture Decision Records](../adr/README.md) document the decisions these scorecards measure.
