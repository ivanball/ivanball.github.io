# ADR-081: The Cost Baseline as a Hard Deploy Gate

## Status
Accepted (2026-08-14). Revised 2026-08-31 (the read-only claim is qualified: one `az config set` on
the runner's own CLI precedes the queries; citations re-anchored). Revised 2026-09-01: ADC's
Notification app now declares `maxReplicas: 2` like its five peers, so the declared baseline is
uniform across all eleven Container Apps in the two repos, and ADC's deploy condition now tolerates
two skippable test gates rather than one; the gate mechanism and the `2` ceiling are unchanged.
Revised 2026-09-03: the premise recorded for Store's wider SQL tier window is corrected. The legacy
`MMCAStore` archive it was written around was exported to a bacpac and dropped on 2026-09-02, so the
window is no longer about keeping an S0 rollback readable; it is kept so a deliberate bump to S0 does
not read as drift. Store also gained a `backend-test-gate`, so the pair of skippable test gates is
now symmetric across the two repos. Citations re-anchored throughout (both `cost-guard.yml` files,
both Bicep templates, both `deploy.yml` files); the gate mechanism and the `2` ceiling are unchanged.

## Context
Both deployed apps run a deliberately small production footprint: every Container App is declared with
`maxReplicas: 2` and every SQL database with the `Basic` tier
(`MMCA.Store/infra/main.bicep:1112,1226,1359,1458,1556` and `:648-651`;
`MMCA.ADC/infra/main.bicep:1215,1349,1476,1641,1752,1874` and `:669-672`). That
footprint is the cost baseline, and it is what the monthly bill is planned against.

The footprint is also expected to move temporarily. A conference day, a load test, a slow query under
real traffic: an operator scales the replica ceiling or the SQL tier up by hand and is supposed to
scale it back down afterwards. The failure mode is not the surge, it is the **un-reverted** surge, and
it is silent: nothing breaks, no alert fires on a healthy oversized system, and the app keeps serving
traffic perfectly while costing several times its baseline.

The existing control against that was the monthly Azure budget declared in both Bicep templates
(`MMCA.Store/infra/main.bicep:548-576`, `MMCA.ADC/infra/main.bicep:563-591`), which notifies at 80% of
actual spend and 100% of forecast spend. The Store template names the exact case it is meant to catch
in its own comment, "a scale-up (manual SQL-tier / replica) silently running for weeks"
(`MMCA.Store/infra/main.bicep:546`). A spend threshold is a lagging indicator: by the time it
trips, weeks of the overspend have already happened, and the notification says a number, not which
resource is wrong. What was missing was a check on the **configuration** itself, and a moment at which
someone would have to look at it.

This is the FinOps sibling of the deploy gates the framework already records: ADR-038 (supply-chain
provenance), ADR-060 (the performance-regression gate against a committed baseline) and ADR-062 (SLO
alerting as code). ADR-064 decides the three proof-of-recency gates and enumerates `cost-guard`
in passing among the jobs that "have the change itself as their subject"
(`Website/docs-src/adr/064-deploy-recency-gates.md:21-22,44`), but it does not decide it. This record
does.

## Decision
The cost baseline is asserted by a **read-only reusable workflow** that both runs weekly and sits in
`deploy.needs`, so an un-reverted scale-up blocks the next production deploy.

- **One workflow, two triggers plus a call.** `cost-guard.yml` carries a Monday 07:00 UTC cron,
  `workflow_dispatch`, and `workflow_call`
  (`MMCA.Store/.github/workflows/cost-guard.yml:19-26`, `MMCA.ADC/.github/workflows/cost-guard.yml:10-17`).
  The single `surge-drift` job runs on `ubuntu-latest` with a 10-minute timeout under
  `environment: production`, which is what makes the OIDC token subject match the federated credential
  the deploy itself uses (`MMCA.Store/.github/workflows/cost-guard.yml:36-41`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:27-39`). Permissions are `id-token: write` and
  `contents: read` only (`MMCA.Store/.github/workflows/cost-guard.yml:28-30`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:19-21`).

- **Two dimensions are checked, both by name prefix inside one resource group.** For every Container
  App whose name starts with `mmca-` (Store) or `adc-` (ADC), the job reads
  `properties.template.scale.maxReplicas` and flags a value greater than `BASELINE_MAX_REPLICAS`,
  which is `"2"` in both repos (`MMCA.Store/.github/workflows/cost-guard.yml:34,67-72`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:25,58-63`). For every SQL server under the same prefix it
  enumerates the databases except `master` and reads `sku.tier`
  (`MMCA.Store/.github/workflows/cost-guard.yml:81-90`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:72-79`). The resource group comes from the
  `AZURE_RESOURCE_GROUP` repo variable (`MMCA.Store/.github/workflows/cost-guard.yml:33`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:24`).

- **The accepted SQL tier differs per repo, deliberately.** ADC accepts `Basic` and nothing else
  (`MMCA.ADC/.github/workflows/cost-guard.yml:76`). Store accepts `Basic` **or** `Standard`
  (`MMCA.Store/.github/workflows/cost-guard.yml:87`). Every Store database is Basic today: the live
  per-service databases are declared Basic (`MMCA.Store/infra/main.bicep:648-651`) and the legacy
  `MMCAStore` archive that used to sit beside them at S0 is gone, exported on 2026-09-02 to the
  bacpac blob `sql-archive/MMCAStore-20260902.bacpac` and then dropped
  (`MMCA.Store/infra/main.bicep:620-627`). The wider window is kept anyway, and the workflow header
  states why: so that a **deliberate** bump to S0 (the tier a Store database would be raised to under
  real load, or the tier a bacpac restore would land on) does not fail the gate as if it were an
  un-reverted surge, while anything above Standard still does
  (`MMCA.Store/.github/workflows/cost-guard.yml:9-13`). ADC has no comparable headroom case: its
  archive was dropped the same day (`MMCA.ADC/infra/main.bicep:635-639`) and its baseline stayed at
  `Basic` alone. The asymmetry is deliberate in both directions.

- **It never mutates production.** Every Azure call is an `az ... list` or `az ... show`; the one
  write in the step is `az config set extension.use_dynamic_install=yes_without_prompt`, which
  configures the runner's own CLI and touches nothing in the subscription
  (`MMCA.Store/.github/workflows/cost-guard.yml:53`, `MMCA.ADC/.github/workflows/cost-guard.yml:44`).
  The job's stated contract is that on drift it fails the run and prints what to reset
  (`MMCA.Store/.github/workflows/cost-guard.yml:7`, `MMCA.ADC/.github/workflows/cost-guard.yml:7-8`).
  There is no auto-revert.

- **The output is a step-summary table, and drift is a non-zero exit.** The job writes a Container Apps
  table and a SQL table with a per-row `ok` or `DRIFT` status into `$GITHUB_STEP_SUMMARY`, then either
  prints the reset instruction and exits 1, or prints the all-clear
  (`MMCA.Store/.github/workflows/cost-guard.yml:57-97`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:48-86`). The whole step runs under `set -euo pipefail`
  (`MMCA.Store/.github/workflows/cost-guard.yml:52`, `MMCA.ADC/.github/workflows/cost-guard.yml:43`).

- **`deploy` waits on it by name.** `cost-guard` is listed in `deploy.needs`
  (`MMCA.Store/.github/workflows/deploy.yml:999`, `MMCA.ADC/.github/workflows/deploy.yml:1054`), and
  because the deploy condition runs under `always()` with explicit per-need results, the condition
  requires `needs.cost-guard.result == 'success'` literally
  (`MMCA.Store/.github/workflows/deploy.yml:1026-1039`,
  `MMCA.ADC/.github/workflows/deploy.yml:1080-1093`). The only needs allowed to be `skipped` there are
  the diff-scoped test gates, and both repos now carry the same pair: `e2e-gate` or
  `backend-test-gate`, whose UI and backend conditions are exact complements, so exactly one of the
  two runs on every code deploy (`MMCA.Store/.github/workflows/deploy.yml:1038-1039`,
  `MMCA.ADC/.github/workflows/deploy.yml:1092-1093`). A cost-guard that fails, errors or is skipped
  leaves `deploy` unrun in either repo.

- **Gate on deploys only, never on pull requests.** The calling job carries
  `if: github.event_name != 'pull_request'` and `secrets: inherit`
  (`MMCA.Store/.github/workflows/deploy.yml:622-625`,
  `MMCA.ADC/.github/workflows/deploy.yml:665-668`), because there is no production OIDC on a PR and the
  deploy is PR-skipped anyway. Both repos' CONTRIBUTING files list `cost-guard` among the push-only
  jobs that must **not** be added to branch protection (`MMCA.Store/CONTRIBUTING.md:42,118`,
  `MMCA.ADC/CONTRIBUTING.md:42,111`).

- **Raising the baseline is a reviewed repo change, not a click.** The ceiling lives in the workflow's
  `env` (`MMCA.Store/.github/workflows/cost-guard.yml:34`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:25`) and the tier allow-list lives in the comparison
  (`MMCA.Store/.github/workflows/cost-guard.yml:87`, `MMCA.ADC/.github/workflows/cost-guard.yml:76`).
  A legitimately larger footprint means editing those **and** the Bicep that declares the footprint,
  in a pull request, together: otherwise the next `main.bicep` run pushes the resource back down to
  the declared value, which is exactly why the drift message points at re-running the deploy as the
  reset (`MMCA.Store/.github/workflows/cost-guard.yml:94`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:83`).

**Adoption is the two deployed apps, in near-identical form.** The files differ only in the resource
name prefix, the accepted SQL tier set, the summary heading and the wording of the drift message
(ADC's names the conference-day surge, Store's does not). MMCA.Helpdesk and MMCA.Common carry no
`cost-guard.yml` and no deploy workflow at all: Helpdesk's `.github/workflows/` holds `ci.yml`,
`release-templates.yml` and the two Claude workflows, and Common's holds `ci.yml`, `release.yml` and
the same two, so neither has a rollout for this gate to block.

## Rationale
- **Configuration drift is the leading indicator; spend is the lagging one.** The budget notification
  fires at 80% of actual spend, after the money is gone, and names a number rather than a resource.
  Reading `maxReplicas` and `sku.tier` directly answers "what is wrong and where" on day one of the
  drift instead of week three.
- **The deploy is the moment someone is already looking.** A weekly cron catches an un-reverted surge
  up to seven days late, and a red scheduled run is easy to leave unread. Putting the same check in
  `deploy.needs` attaches it to an event that has a human waiting on it, which is what converts a
  notification into a control.
- **Read-only is what makes it safe on the critical path.** The gate performs a handful of `az`
  queries and mutates nothing in the subscription, so its worst failure mode is a blocked deploy,
  never an unintended production change. Auto-reverting a surge would be the opposite trade: a gate
  that can itself take production down mid-incident, possibly while the surge is the thing keeping
  the app up.
- **One definition serves both cadences.** Making the check a reusable workflow (`workflow_call`)
  rather than duplicating a job into `deploy.yml` means the weekly run and the deploy gate cannot
  drift apart, and dispatching it manually to answer "are we at baseline right now" costs nothing.
- **The baseline belongs in version control next to the Bicep that declares it.** A threshold stored
  in the repo is reviewed, diffed and dated when it changes; a threshold stored in someone's memory of
  what the footprint should be is not a baseline at all.
- **Per-repo tier sets, because a baseline should encode the intended footprint, not the narrowest
  one.** Store's Basic-or-Standard window is not laxity. Basic is a 5-DTU tier with a 2 GB cap, and S0
  is the first step above it, so S0 is where a Store database goes under real load or when a bacpac
  restore lands. Accepting it means an operator making that deliberate, cheap move does not have to
  open a pull request against a CI threshold first, while everything that actually signals an
  un-reverted surge (S1 and up, Premium, BusinessCritical) still fails the gate. ADC keeps `Basic`
  alone because it has no such intended step: a narrower window there costs nothing and catches more.

## Trade-offs
- **A legitimate scale-up blocks deploys until the baseline is edited.** Standing up extra capacity
  for a real event and then shipping a fix during it requires a pull request against
  `BASELINE_MAX_REPLICAS` first. That is the intended friction, but it is friction at exactly the
  moment (a live event) when nobody wants to be opening a PR against a CI threshold.
- **The printed remediation is circular on the deploy path.** The drift message suggests resetting
  "by re-running the deploy workflow" (`MMCA.Store/.github/workflows/cost-guard.yml:94`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:83`), which was accurate while the check was cron-only.
  Now that `cost-guard` sits in `deploy.needs`, any run of `deploy.yml` re-runs the failing gate and
  leaves `deploy` unrun, so the Bicep never re-applies. The reset has to happen out of band (portal or
  `az`) before a deploy can proceed.
- **There is no break-glass for this gate.** The `workflow_dispatch` inputs cover only the three
  freshness gates (`skip_freshness_gates` plus `skip_justification`,
  `MMCA.Store/.github/workflows/deploy.yml:8-20`), and `cost-guard.yml` declares no inputs at all, so
  the ADR-064 escape hatch does not reach it. Getting past a red cost guard means fixing the footprint
  or changing the baseline.
- **It reads live Azure state, so it can block a deploy for a non-cost reason.** An Azure control-plane
  outage, an OIDC login failure, a throttled `az` call or an expired federated credential fails the job
  and therefore the deploy, and none of those mean the footprint is wrong. The job holds
  `id-token: write` and logs in before it can check anything
  (`MMCA.Store/.github/workflows/cost-guard.yml:43-48`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:34-39`).
- **Store's tier check is coarser than its own comment claims.** The inline note says a "scaled-up
  Standard like S3" is drift (`MMCA.Store/.github/workflows/cost-guard.yml:85-86`, and the header at
  `:12-13` says it flags "S1+"), but the comparison is against `sku.tier`, and every S-series database
  reports tier `Standard`. A surge from S0 to S3 on Store therefore passes the gate; only Premium,
  BusinessCritical, Hyperscale and similar are caught. ADC, accepting `Basic` alone, does not have
  this gap.
- **An empty reading passes.** A replica count that comes back empty is defaulted to `0` by
  `${max:-0}` and scores `ok` with a `?` in the table
  (`MMCA.Store/.github/workflows/cost-guard.yml:70-71`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:61-62`). The gate fails open on an unreadable value rather
  than closed, the opposite of the fail-on-absence posture ADR-064 took for the recency gates.
- **Only two cost dimensions and one name prefix are covered.** Service Bus, Redis, Log Analytics
  retention and everything else in the resource group are invisible to the gate, as is any resource
  whose name does not start with the app prefix or that lives in another resource group. Store's
  Service Bus is Standard tier (`MMCA.Store/infra/main.bicep:690-692`) and would go unchecked if it
  were scaled up.
- **The ceiling is an upper bound, not an equality.** Scaling a resource **below** the baseline is not
  drift, so an accidental `maxReplicas: 1` on a service that needs two, or a downgrade that costs
  availability rather than money, passes silently. This gate is about spend, not about capacity being
  correct.

## Related
[ADR-064](064-deploy-recency-gates.md) (the sibling deploy-precondition record, which decides the
three proof-of-recency gates and enumerates this one only in passing; its break-glass input does not
apply here), [ADR-060](060-performance-regression-gate.md) (the other committed-baseline gate, where
the baseline is a benchmark rather than a footprint),
[ADR-062](062-slo-alerting-as-code.md) (the alerting-side control this complements: alerts fire on
symptoms in production, this fails a build on configuration),
[ADR-038](038-supply-chain-provenance.md) (the other result-based job in the same `deploy.needs`
list).
