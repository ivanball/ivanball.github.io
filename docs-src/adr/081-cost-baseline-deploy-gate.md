# ADR-081: The Cost Baseline as a Hard Deploy Gate

## Status
Accepted (2026-08-14). Revised 2026-08-31 (the read-only claim is qualified: one `az config set` on
the runner's own CLI precedes the queries; citations re-anchored).

## Context
Both deployed apps run a deliberately small production footprint: every Container App is declared with
`maxReplicas: 2` and every SQL database with the `Basic` tier
(`MMCA.Store/infra/main.bicep:1038,1142,1273,1349,1447` and `:557-559,587-589`;
`MMCA.ADC/infra/main.bicep:1177,1304,1431,1684,1806` and `:612-614,645-647`, with ADC's Notification
app deliberately right-sized at `maxReplicas: 1`, `MMCA.ADC/infra/main.bicep:1586-1591`). That
footprint is the cost baseline, and it is what the monthly bill is planned against.

The footprint is also expected to move temporarily. A conference day, a load test, a slow query under
real traffic: an operator scales the replica ceiling or the SQL tier up by hand and is supposed to
scale it back down afterwards. The failure mode is not the surge, it is the **un-reverted** surge, and
it is silent: nothing breaks, no alert fires on a healthy oversized system, and the app keeps serving
traffic perfectly while costing several times its baseline.

The existing control against that was the monthly Azure budget declared in both Bicep templates
(`MMCA.Store/infra/main.bicep:471-499`, `MMCA.ADC/infra/main.bicep:529-557`), which notifies at 80% of
actual spend and 100% of forecast spend. The Store template names the exact case it is meant to catch
in its own comment, "a scale-up (manual SQL-tier / replica) silently running for weeks"
(`MMCA.Store/infra/main.bicep:469`). A spend threshold is a lagging indicator: by the time it
trips, weeks of the overspend have already happened, and the notification says a number, not which
resource is wrong. What was missing was a check on the **configuration** itself, and a moment at which
someone would have to look at it.

This is the FinOps sibling of the deploy gates the framework already records: ADR-038 (supply-chain
provenance), ADR-060 (the performance-regression gate against a committed baseline) and ADR-062 (SLO
alerting as code). ADR-064 decides the three proof-of-recency gates and enumerates `cost-guard`
in passing among the jobs that "have the change itself as their subject"
(`Website/docs-src/adr/064-deploy-recency-gates.md:11-12,39`), but it does not decide it. This record
does.

## Decision
The cost baseline is asserted by a **read-only reusable workflow** that both runs weekly and sits in
`deploy.needs`, so an un-reverted scale-up blocks the next production deploy.

- **One workflow, two triggers plus a call.** `cost-guard.yml` carries a Monday 07:00 UTC cron,
  `workflow_dispatch`, and `workflow_call`
  (`MMCA.Store/.github/workflows/cost-guard.yml:14-21`, `MMCA.ADC/.github/workflows/cost-guard.yml:10-17`).
  The single `surge-drift` job runs on `ubuntu-latest` with a 10-minute timeout under
  `environment: production`, which is what makes the OIDC token subject match the federated credential
  the deploy itself uses (`MMCA.Store/.github/workflows/cost-guard.yml:31-43`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:27-39`). Permissions are `id-token: write` and
  `contents: read` only (`MMCA.Store/.github/workflows/cost-guard.yml:23-25`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:19-21`).

- **Two dimensions are checked, both by name prefix inside one resource group.** For every Container
  App whose name starts with `mmca-` (Store) or `adc-` (ADC), the job reads
  `properties.template.scale.maxReplicas` and flags a value greater than `BASELINE_MAX_REPLICAS`,
  which is `"2"` in both repos (`MMCA.Store/.github/workflows/cost-guard.yml:29,62-67`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:25,58-63`). For every SQL server under the same prefix it
  enumerates the databases except `master` and reads `sku.tier`
  (`MMCA.Store/.github/workflows/cost-guard.yml:76-85`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:72-79`). The resource group comes from the
  `AZURE_RESOURCE_GROUP` repo variable (`MMCA.Store/.github/workflows/cost-guard.yml:28`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:24`).

- **The accepted SQL tier differs per repo, deliberately.** ADC accepts `Basic` and nothing else
  (`MMCA.ADC/.github/workflows/cost-guard.yml:76`). Store accepts `Basic` **or** `Standard`
  (`MMCA.Store/.github/workflows/cost-guard.yml:82`), because its retained legacy `MMCAStore` archive
  was downgraded from S0 to Basic and the bump back to S0 is the documented rollback path, so a
  rollback must not read as drift (`MMCA.Store/.github/workflows/cost-guard.yml:9-12`, and the same
  reasoning beside the resource at `MMCA.Store/infra/main.bicep:548-551`).

- **It never mutates production.** Every Azure call is an `az ... list` or `az ... show`; the one
  write in the step is `az config set extension.use_dynamic_install=yes_without_prompt`, which
  configures the runner's own CLI and touches nothing in the subscription
  (`MMCA.Store/.github/workflows/cost-guard.yml:48`, `MMCA.ADC/.github/workflows/cost-guard.yml:44`).
  The job's stated contract is that on drift it fails the run and prints what to reset
  (`MMCA.Store/.github/workflows/cost-guard.yml:7`, `MMCA.ADC/.github/workflows/cost-guard.yml:7-8`).
  There is no auto-revert.

- **The output is a step-summary table, and drift is a non-zero exit.** The job writes a Container Apps
  table and a SQL table with a per-row `ok` or `DRIFT` status into `$GITHUB_STEP_SUMMARY`, then either
  prints the reset instruction and exits 1, or prints the all-clear
  (`MMCA.Store/.github/workflows/cost-guard.yml:52-92`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:48-86`). The whole step runs under `set -euo pipefail`
  (`MMCA.Store/.github/workflows/cost-guard.yml:47`, `MMCA.ADC/.github/workflows/cost-guard.yml:43`).

- **`deploy` waits on it by name.** `cost-guard` is listed in `deploy.needs`
  (`MMCA.Store/.github/workflows/deploy.yml:941`, `MMCA.ADC/.github/workflows/deploy.yml:992`), and
  because the deploy condition runs under `always()` with explicit per-need results, the condition
  requires `needs.cost-guard.result == 'success'` literally
  (`MMCA.Store/.github/workflows/deploy.yml:960-972`,
  `MMCA.ADC/.github/workflows/deploy.yml:1010-1022`). Only `e2e-gate` is allowed to be `skipped` there,
  so a cost-guard that fails, errors or is skipped leaves `deploy` unrun.

- **Gate on deploys only, never on pull requests.** The calling job carries
  `if: github.event_name != 'pull_request'` and `secrets: inherit`
  (`MMCA.Store/.github/workflows/deploy.yml:572-575`,
  `MMCA.ADC/.github/workflows/deploy.yml:616-619`), because there is no production OIDC on a PR and the
  deploy is PR-skipped anyway. Both repos' CONTRIBUTING files list `cost-guard` among the push-only
  jobs that must **not** be added to branch protection (`MMCA.Store/CONTRIBUTING.md:42,118`,
  `MMCA.ADC/CONTRIBUTING.md:42,111`).

- **Raising the baseline is a reviewed repo change, not a click.** The ceiling lives in the workflow's
  `env` (`MMCA.Store/.github/workflows/cost-guard.yml:29`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:25`) and the tier allow-list lives in the comparison
  (`MMCA.Store/.github/workflows/cost-guard.yml:82`, `MMCA.ADC/.github/workflows/cost-guard.yml:76`).
  A legitimately larger footprint means editing those **and** the Bicep that declares the footprint,
  in a pull request, together: otherwise the next `main.bicep` run pushes the resource back down to
  the declared value, which is exactly why the drift message points at re-running the deploy as the
  reset (`MMCA.Store/.github/workflows/cost-guard.yml:89`,
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
- **Per-repo tier sets, because the two footprints genuinely differ.** Store's widened Basic-or-
  Standard window is not laxity, it is the price of keeping a documented S0 rollback path from reading
  as drift on every deploy.

## Trade-offs
- **A legitimate scale-up blocks deploys until the baseline is edited.** Standing up extra capacity
  for a real event and then shipping a fix during it requires a pull request against
  `BASELINE_MAX_REPLICAS` first. That is the intended friction, but it is friction at exactly the
  moment (a live event) when nobody wants to be opening a PR against a CI threshold.
- **The printed remediation is circular on the deploy path.** The drift message suggests resetting
  "by re-running the deploy workflow" (`MMCA.Store/.github/workflows/cost-guard.yml:89`,
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
  (`MMCA.Store/.github/workflows/cost-guard.yml:38-43`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:34-39`).
- **Store's tier check is coarser than its own comment claims.** The inline note says a "scaled-up
  Standard like S3" is drift (`MMCA.Store/.github/workflows/cost-guard.yml:80-81`, and the header at
  `:12` says it flags "S1+"), but the comparison is against `sku.tier`, and every S-series database
  reports tier `Standard`. A surge from S0 to S3 on Store therefore passes the gate; only Premium,
  BusinessCritical, Hyperscale and similar are caught. ADC, accepting `Basic` alone, does not have
  this gap.
- **An empty reading passes.** A replica count that comes back empty is defaulted to `0` by
  `${max:-0}` and scores `ok` with a `?` in the table
  (`MMCA.Store/.github/workflows/cost-guard.yml:65-66`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:61-62`). The gate fails open on an unreadable value rather
  than closed, the opposite of the fail-on-absence posture ADR-064 took for the recency gates.
- **Only two cost dimensions and one name prefix are covered.** Service Bus, Redis, Log Analytics
  retention and everything else in the resource group are invisible to the gate, as is any resource
  whose name does not start with the app prefix or that lives in another resource group. Store's
  Service Bus is Standard tier (`MMCA.Store/infra/main.bicep:628-630`) and would go unchecked if it
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
