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
Revised 2026-09-11: the skippable-need lists are no longer symmetric. ADC's deploy condition tolerates
three conditional gates (`e2e-gate`, `backend-test-gate` and `ai-eval-gate`) while Store tolerates two,
and both repos now carry a fourth freshness gate (`cross-browser-freshness`) beside `cost-guard` in
`deploy.needs`. Citations re-anchored throughout (both Bicep templates, both `deploy.yml` files); the
gate mechanism, the `2` ceiling and the per-repo SQL tier sets are unchanged.
Revised 2026-09-19: two content corrections. ADR-064 is now described as deciding **four**
proof-of-recency gates rather than three, matching its own 2026-09-11 revision, and the claim that the
two `cost-guard.yml` files differ *only* in prefix, tier set, heading and drift wording is dropped,
because Store's header carries three passages ADC's does not. The gate mechanism, the `2` ceiling and
the per-repo SQL tier sets are unchanged.
Revised 2026-10-01 (Store's SQL check now reads the service objective and accepts only Basic or
Standard S0, closing the S0-to-S3 gap; see Revision below).
Revised 2026-10-06: ADC's dated conference-mode window is recorded as a sanctioned per-repo
difference in the gate, and Common's workflow list now includes `load-tests.yml`.
Revised 2026-10-07: Common's workflow list is three files with no Claude workflows, ADC's Notification
app is recorded as staying off the conference-mode replica ceiling, and `backend-test-gate` is
recorded as gone from both deploy conditions; anchors refreshed after the v1.233.0 release.
Revised 2026-10-19: ADC's cron runs daily while Store's stays weekly (a sanctioned per-repo cadence), the circular-remediation trade-off is retired because neither drift message suggests re-running the deploy, `deploy_gate` is recorded as a `workflow_call` input, and the ADC and deploy-path anchors are re-pointed.
Revised 2026-10-21: anchors refreshed after both Bicep templates, both CONTRIBUTING files, ADC's
`cost-guard.yml` and ADR-064 moved; no statement changed.
Revised 2026-10-26: the "no drift message offers a re-run" sentence is scoped to the surge-drift
messages, since ADC's expired-window message does say to run the deploy (which the gate lets
through), and anchors are refreshed after both Bicep templates and both `deploy.yml` files moved.
Revised 2026-10-28: the per-service `service` cost-attribution tag, enforced by the shared
`CostTagConventionTestsBase` fitness test in ADC and Store, is recorded as the gate's attribution
companion, and anchors are refreshed after both Bicep templates, both CONTRIBUTING files and ADR-064
moved.

## Context
Both deployed apps run a deliberately small production footprint: every Container App is declared with
`maxReplicas: 2` (ADC's five scaled apps read `conferenceScaledMaxReplicas`, which `conferenceMode` raises
to 4, `MMCA.ADC/infra/main.bicep:192`, while Notification keeps a literal `maxReplicas: 2`, `:2577`; the
same mode lifts ADC's hot-path databases to S2, `:1149-1153`; see Revision (2026-10-06)) and every SQL
database with the `Basic` tier
(`MMCA.Store/infra/main.bicep:1689,1813,1961,2080,2198` and `:1041-1045`;
`MMCA.ADC/infra/main.bicep:2103,2256,2391,2577,2730,2881` and `:1151-1153`). That
footprint is the cost baseline, and it is what the monthly bill is planned against.

The footprint is also expected to move temporarily. A conference day, a load test, a slow query under
real traffic: an operator scales the replica ceiling or the SQL tier up by hand and is supposed to
scale it back down afterwards. The failure mode is not the surge, it is the **un-reverted** surge, and
it is silent: nothing breaks, no alert fires on a healthy oversized system, and the app keeps serving
traffic perfectly while costing several times its baseline.

The existing control against that was the monthly Azure budget declared in both Bicep templates
(`MMCA.Store/infra/main.bicep:845-873`, `MMCA.ADC/infra/main.bicep:975-1003`), which notifies at 80% of
actual spend and 100% of forecast spend. The Store template names the exact case it is meant to catch
in its own comment, "a scale-up (manual SQL-tier / replica) silently running for weeks"
(`MMCA.Store/infra/main.bicep:843`). A spend threshold is a lagging indicator: by the time it
trips, weeks of the overspend have already happened, and the notification says a number, not which
resource is wrong. What was missing was a check on the **configuration** itself, and a moment at which
someone would have to look at it.

This is the FinOps sibling of the deploy gates the framework already records: ADR-038 (supply-chain
provenance), ADR-060 (the performance-regression gate against a committed baseline) and ADR-062 (SLO
alerting as code). ADR-064 decides the four proof-of-recency gates and mentions this gate only in
passing: as "a FinOps cost check" among the jobs that "have the change itself as their subject"
(`Website/docs-src/adr/064-deploy-recency-gates.md:49-50`), and as `cost-guard` in its list of
`deploy.needs` jobs (`:86`, four-gate decision `:82`, `:85`), but it does not decide it. This record
does.

## Decision
The cost baseline is asserted by a **read-only reusable workflow** that both runs on a schedule and sits in
`deploy.needs`, so an un-reverted scale-up blocks the next production deploy.

- **One workflow, two triggers plus a call.** `cost-guard.yml` carries a 07:00 UTC cron,
  `workflow_dispatch`, and `workflow_call`
  (`MMCA.Store/.github/workflows/cost-guard.yml:19-26`, `MMCA.ADC/.github/workflows/cost-guard.yml:12-24`).
  The cadence is a sanctioned per-repo difference: ADC runs daily (`MMCA.ADC/.github/workflows/cost-guard.yml:14`),
  so an expired conference window or an out-of-band scale-up is reported within a day, and Store runs
  on Mondays (`MMCA.Store/.github/workflows/cost-guard.yml:21`), because it has no dated window to expire.
  The single `surge-drift` job runs on `ubuntu-latest` with a 10-minute timeout under
  `environment: production`, which is what makes the OIDC token subject match the federated credential
  the deploy itself uses (`MMCA.Store/.github/workflows/cost-guard.yml:36-41`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:37-41`). Permissions are `id-token: write` and
  `contents: read` only (`MMCA.Store/.github/workflows/cost-guard.yml:28-30`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:26-28`).

- **Two dimensions are checked, both by name prefix inside one resource group.** For every Container
  App whose name starts with `mmca-` (Store) or `adc-` (ADC), the job reads
  `properties.template.scale.maxReplicas` and flags a value greater than `BASELINE_MAX_REPLICAS`,
  which is `"2"` in both repos (`MMCA.Store/.github/workflows/cost-guard.yml:34,80-85`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:32,83-88`). For every SQL server under the same prefix it
  enumerates the databases except `master` and reads `sku.tier` (ADC) or both `sku.tier` and the
  service objective `sku.name` (Store)
  (`MMCA.Store/.github/workflows/cost-guard.yml:94-105`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:97-104`). The resource group comes from the
  `AZURE_RESOURCE_GROUP` repo variable (`MMCA.Store/.github/workflows/cost-guard.yml:33`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:31`).

- **The accepted SQL tier differs per repo, deliberately.** ADC accepts `Basic` and nothing else
  (`MMCA.ADC/.github/workflows/cost-guard.yml:101`). Store accepts `Basic` (any objective)
  **or** `Standard` at objective `S0` only, through the `sql_sku_ok` function
  (`MMCA.Store/.github/workflows/cost-guard.yml:62-68`, applied at `:102`), so a scaled-up Standard
  (S1 to S12) reports drift even though its tier reads `Standard`. Every Store database is Basic today: the live
  per-service databases are declared Basic (`MMCA.Store/infra/main.bicep:1041-1045`) and the legacy
  `MMCAStore` archive that used to sit beside them at S0 is gone, exported on 2026-09-02 to the
  bacpac blob `sql-archive/MMCAStore-20260902.bacpac` and then dropped
  (`MMCA.Store/infra/main.bicep:1011-1018`). The wider window is kept anyway, and the workflow header
  states why: so that a **deliberate** bump to S0 (the tier a Store database would be raised to under
  real load, or the tier a bacpac restore would land on) does not fail the gate as if it were an
  un-reverted surge, while anything above Standard S0 still does
  (`MMCA.Store/.github/workflows/cost-guard.yml:9-13`). ADC has no comparable headroom case: its
  archive was dropped the same day (`MMCA.ADC/infra/main.bicep:1114-1123`) and its baseline stayed at
  `Basic` alone. The asymmetry is deliberate in both directions.

- **It never mutates production.** Every Azure call is an `az ... list` or `az ... show`; the one
  write in the step is `az config set extension.use_dynamic_install=yes_without_prompt`, which
  configures the runner's own CLI and touches nothing in the subscription
  (`MMCA.Store/.github/workflows/cost-guard.yml:53`, `MMCA.ADC/.github/workflows/cost-guard.yml:53`).
  The job's stated contract is that on drift it fails the run and prints what to reset
  (`MMCA.Store/.github/workflows/cost-guard.yml:7`, `MMCA.ADC/.github/workflows/cost-guard.yml:9-10`).
  There is no auto-revert.

- **The output is a step-summary table, and drift is a non-zero exit.** The job writes a Container Apps
  table and a SQL table with a per-row `ok` or `DRIFT` status into `$GITHUB_STEP_SUMMARY`, then either
  prints the reset instruction and exits 1, or prints the all-clear
  (`MMCA.Store/.github/workflows/cost-guard.yml:70-112`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:50-123`). The whole step runs under `set -euo pipefail`
  (`MMCA.Store/.github/workflows/cost-guard.yml:52`, `MMCA.ADC/.github/workflows/cost-guard.yml:52`).

- **`deploy` waits on it by name.** `cost-guard` is listed in `deploy.needs`
  (`MMCA.Store/.github/workflows/deploy.yml:1099`, `MMCA.ADC/.github/workflows/deploy.yml:1161`), and
  because the deploy condition runs under `always()` with explicit per-need results, the condition
  requires `needs.cost-guard.result == 'success'` literally
  (`MMCA.Store/.github/workflows/deploy.yml:1122-1132`, the literal at `:1128`;
  `MMCA.ADC/.github/workflows/deploy.yml:1188-1199`, the literal at `:1194`). The only needs allowed to be `skipped` there are
  the diff-scoped gates, and the two lists are not symmetric. Store tolerates one, `e2e-gate`, which
  runs when the diff touches the UI (`MMCA.Store/.github/workflows/deploy.yml:764,1132`). ADC tolerates
  `e2e-gate` plus `ai-eval-gate`, which runs when the diff touches the scoring code
  (`MMCA.ADC/.github/workflows/deploy.yml:526,1198-1199`). Either way a cost-guard that fails, errors or
  is skipped on a code push leaves `deploy` unrun; on a docs-only push `cost-guard` and `deploy` both
  skip (`MMCA.ADC/.github/workflows/deploy.yml:787,1192`,
  `MMCA.Store/.github/workflows/deploy.yml:734,1126`).

- **Gate on deploys only, never on pull requests.** The calling job carries
  `if: github.event_name != 'pull_request'` and `secrets: inherit`
  (`MMCA.Store/.github/workflows/deploy.yml:732-741`,
  `MMCA.ADC/.github/workflows/deploy.yml:785-798`), because there is no production OIDC on a PR and the
  deploy is PR-skipped anyway. ADC's calling job also grants its own `id-token: write` and
  `contents: read` (`MMCA.ADC/.github/workflows/deploy.yml:790-792`), because ADC's workflow-level
  permissions deliberately omit `id-token` (`:28-37`); Store's calling job does the same
  (`MMCA.Store/.github/workflows/deploy.yml:737-739`), because its workflow-level permissions omit
  `id-token` too (`:44-53`). Both repos' CONTRIBUTING files list `cost-guard` among the push-only
  jobs that must **not** be added to branch protection (`MMCA.Store/CONTRIBUTING.md:42,122`,
  `MMCA.ADC/CONTRIBUTING.md:42,115`).

- **Raising the baseline is a reviewed repo change, not a click.** The ceiling lives in the workflow's
  `env` (`MMCA.Store/.github/workflows/cost-guard.yml:34`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:32`) and the tier allow-list lives in the comparison
  (`MMCA.Store/.github/workflows/cost-guard.yml:62-68`, `MMCA.ADC/.github/workflows/cost-guard.yml:101`).
  A legitimately larger footprint means editing those **and** the Bicep that declares the footprint,
  in a pull request, together: otherwise the next `main.bicep` run pushes the resource back down to
  the declared value. Neither surge-drift message offers a re-run of the deploy as the reset, because
  with the gate in `deploy.needs` that re-run would fail again: Store's says to reset to baseline by
  hand in Azure (`MMCA.Store/.github/workflows/cost-guard.yml:109`), and ADC's out-of-band message
  points at the runbook's recovery move, which reverts through an expired conference window
  (`MMCA.ADC/.github/workflows/cost-guard.yml:120`). The one message that does say to run the deploy
  is ADC's expired-window message (`MMCA.ADC/.github/workflows/cost-guard.yml:117`), and there the
  re-run succeeds, because on the deploy path an expired window passes the gate (`:112-114`) and that
  deploy reverts `conferenceMode`.

- **Spend is attributable per service, by a tag the build enforces.** The gate caps the footprint;
  a companion fitness test keeps the bill splittable. `CostTagConventionTestsBase`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/CostTagConventionTestsBase.cs:29`)
  reads the consumer's embedded `infra/main.bicep` and fails when any `Microsoft.App/containerApps`
  resource has no `service:` key in the `tags:` line within the first lines of its body (`:58-75`,
  pattern `:106`), or when the file does not contain the database tag line that unions into
  `commonTags` a `service` value derived from the database name prefix (`:82-93`, expected line
  `:88`). The check is textual: it does not itself require the union with `commonTags` on an app,
  and the single database-line match covers every database only because each repo declares its
  per-service databases in one loop resource (`MMCA.ADC/infra/main.bicep:1141-1147`,
  `MMCA.Store/infra/main.bicep:1033-1039`). Today every app tag in both templates is that union
  (anchors below). A minimum
  container-app count keeps it non-vacuous (`:36`, `:63-65`). ADC derives it with six apps and the
  `ADC_` prefix
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/CostTagConventionTests.cs:10-14`;
  tags at `MMCA.ADC/infra/main.bicep:1147,1860,2113,2266,2401,2591,2754`), and Store with five apps
  and the `Store_` prefix
  (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Governance/CostTagConventionTests.cs:10-14`;
  tags at `MMCA.Store/infra/main.bicep:1039,1517,1699,1823,1975,2104`). MMCA.Helpdesk has no
  derivation, consistent with it having no Azure deploy.

**Adoption is the two deployed apps, in near-identical form apart from ADC's conference window (Revision (2026-10-06)).** The files differ in the resource name
prefix, the accepted SQL tier set, the header rationale, the summary heading and the wording of the
drift message (ADC's names the conference-day surge, Store's does not). The step body diverges too:
Store's carries an ADR-081 comment block (`MMCA.Store/.github/workflows/cost-guard.yml:57-61`), the
`sql_sku_ok` tier-plus-objective check (`:62-68`, `:96-97`, `:102`), a `tier / objective` SQL column
(`:90`), and an S0-specific baseline line (`:73`) and drift message (`:109`). The header is where
the two also diverge: Store's carries three passages ADC's has no counterpart for, the SQL-baseline rationale
(`MMCA.Store/.github/workflows/cost-guard.yml:9-13`), a note that the check reads `maxReplicas` only
and is therefore blind by design to the 2026-09-02 container right-size (`:15-17`), and a
`(Mirrors MMCA.ADC.)` marker on the `workflow_call` trigger (`:25`). MMCA.Helpdesk and MMCA.Common
carry no `cost-guard.yml` and no deploy workflow at all: Helpdesk's `.github/workflows/` holds `ci.yml`,
`release-templates.yml` and the two Claude workflows, and Common's holds only `ci.yml`, `release.yml`
and `load-tests.yml`, so neither has a rollout for this gate to block.

## Rationale
- **Configuration drift is the leading indicator; spend is the lagging one.** The budget notification
  fires at 80% of actual spend, after the money is gone, and names a number rather than a resource.
  Reading `maxReplicas` and `sku.tier` directly answers "what is wrong and where" on day one of the
  drift instead of week three.
- **The deploy is the moment someone is already looking.** A scheduled run catches an un-reverted surge
  up to a day late on ADC and up to seven days late on Store, and a red scheduled run is easy to leave
  unread. Putting the same check in
  `deploy.needs` attaches it to an event that has a human waiting on it, which is what converts a
  notification into a control.
- **Read-only is what makes it safe on the critical path.** The gate performs a handful of `az`
  queries and mutates nothing in the subscription, so its worst failure mode is a blocked deploy,
  never an unintended production change. Auto-reverting a surge would be the opposite trade: a gate
  that can itself take production down mid-incident, possibly while the surge is the thing keeping
  the app up.
- **One definition serves both cadences.** Making the check a reusable workflow (`workflow_call`)
  rather than duplicating a job into `deploy.yml` means the scheduled run and the deploy gate cannot
  drift apart, and dispatching it manually to answer "are we at baseline right now" costs nothing.
- **The baseline belongs in version control next to the Bicep that declares it.** A threshold stored
  in the repo is reviewed, diffed and dated when it changes; a threshold stored in someone's memory of
  what the footprint should be is not a baseline at all.
- **Per-repo tier sets, because a baseline should encode the intended footprint, not the narrowest
  one.** Store's Basic-or-S0 window is not laxity. Basic is a 5-DTU tier with a 2 GB cap, and S0
  is the first step above it, so S0 is where a Store database goes under real load or when a bacpac
  restore lands. Accepting it means an operator making that deliberate, cheap move does not have to
  open a pull request against a CI threshold first, while everything that actually signals an
  un-reverted surge (S1 and up, Premium, BusinessCritical) still fails the gate. ADC keeps `Basic`
  alone because it has no such intended step: a narrower window there costs nothing and catches more.

## Trade-offs
- **A legitimate scale-up blocks Store deploys until the baseline is edited.** ADC declares its
  conference-day surge in IaC behind a dated window instead (Revision (2026-10-06)). On Store, standing up extra capacity
  for a real event and then shipping a fix during it requires a pull request against
  `BASELINE_MAX_REPLICAS` first. That is the intended friction, but it is friction at exactly the
  moment (a live event) when nobody wants to be opening a PR against a CI threshold.
- **The reset happens out of band.** With `cost-guard` in `deploy.needs`, any run of `deploy.yml`
  re-runs a failing gate and leaves `deploy` unrun, so the Bicep never re-applies while drift persists.
  Both drift messages say so rather than suggesting a re-run (Store resets by hand in Azure,
  `MMCA.Store/.github/workflows/cost-guard.yml:109`; ADC follows its runbook,
  `MMCA.ADC/.github/workflows/cost-guard.yml:120`); the one exception is ADC's expired conference window,
  where the deploy IS the revert and the gate passes on the deploy path (`:112-114`).
- **There is no break-glass for this gate.** The `workflow_dispatch` inputs cover only the four
  freshness gates (`skip_freshness_gates` plus `skip_justification`,
  `MMCA.Store/.github/workflows/deploy.yml:21-33`), and Store's `cost-guard.yml` declares no inputs at all (ADC's declares only `deploy_gate`, a
  `workflow_call` input, `MMCA.ADC/.github/workflows/cost-guard.yml:19-24`, which selects the deploy-path exits rather than
  skipping the check), so
  the ADR-064 escape hatch does not reach it. Getting past a red cost guard means fixing the footprint
  or changing the baseline.
- **It reads live Azure state, so it can block a deploy for a non-cost reason.** An Azure control-plane
  outage, an OIDC login failure, a throttled `az` call or an expired federated credential fails the job
  and therefore the deploy, and none of those mean the footprint is wrong. The job holds
  `id-token: write` and logs in before it can check anything
  (`MMCA.Store/.github/workflows/cost-guard.yml:43-48`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:43-48`).
- **An empty reading passes.** A replica count that comes back empty is defaulted to `0` by
  `${max:-0}` and scores `ok` with a `?` in the table
  (`MMCA.Store/.github/workflows/cost-guard.yml:83-84`,
  `MMCA.ADC/.github/workflows/cost-guard.yml:86-87`). The gate fails open on an unreadable value rather
  than closed, the opposite of the fail-on-absence posture ADR-064 took for the recency gates.
- **Only two cost dimensions and one name prefix are covered.** Service Bus, Redis, Log Analytics
  retention and everything else in the resource group are invisible to the gate, as is any resource
  whose name does not start with the app prefix or that lives in another resource group. Store's
  Service Bus is Standard tier (`MMCA.Store/infra/main.bicep:1079-1086`, tier at `:1085`) and would go unchecked if it
  were scaled up.
- **The ceiling is an upper bound, not an equality.** Scaling a resource **below** the baseline is not
  drift, so an accidental `maxReplicas: 1` on a service that needs two, or a downgrade that costs
  availability rather than money, passes silently. This gate is about spend, not about capacity being
  correct.

## Revision (2026-10-01)
Store's SQL check now matches its own stated window. It reads `[sku.tier, sku.name]`
(`MMCA.Store/.github/workflows/cost-guard.yml:96-97`) and passes a database only through
`sql_sku_ok`, which accepts `Basic/*` or `Standard/S0` and nothing else (`:62-68`, applied at `:102`),
with an ADR-081 comment that the window must not be narrowed to Basic-only (`:57-61`). A scaled-up
Standard (S1 to S12) therefore fails the gate, so the trade-off recording that an S0-to-S3 surge on
Store passes is removed, the Decision now describes the Store window as Basic or S0, and the Adoption
paragraph lists the step-body differences this introduced. ADC is unchanged (tier only, Basic only,
`MMCA.ADC/.github/workflows/cost-guard.yml:97,99`). ADC's `cost-guard` caller now grants its own
job-level `id-token: write` (`MMCA.ADC/.github/workflows/deploy.yml:857-859`), which the Decision
notes. Citations re-anchored throughout (Store's `cost-guard.yml`, both Bicep
templates, both `deploy.yml` files, ADR-064); the `2` replica ceiling and the gate mechanism are
unchanged.

## Related
[ADR-064](064-deploy-recency-gates.md) (the sibling deploy-precondition record, which decides the
four proof-of-recency gates and enumerates this one only in passing; its break-glass input does not
apply here), [ADR-060](060-performance-regression-gate.md) (the other committed-baseline gate, where
the baseline is a benchmark rather than a footprint),
[ADR-062](062-slo-alerting-as-code.md) (the alerting-side control this complements: alerts fire on
symptoms in production, this fails a build on configuration),
[ADR-038](038-supply-chain-provenance.md) (the other result-based job in the same `deploy.needs`
list).

## Revision (2026-10-06)

**Common's workflow list is corrected.** `MMCA.Common/.github/workflows/` holds five files: `ci.yml`,
`release.yml`, `load-tests.yml` and the two Claude workflows; the Adoption paragraph had omitted
`load-tests.yml`. The conclusion is unchanged: Common has no `cost-guard.yml` and no deploy workflow.

**ADC's conference-mode window is a sanctioned per-repo difference.** ADC declares its conference-day
surge in IaC: `conferenceMode` (`MMCA.ADC/infra/main.bicep:157`) sets `conferenceScaledMaxReplicas` to
4 instead of 2 (`:191`), the scaled apps read it (for example `:1882`), and it lifts the attendee
hot-path databases from Basic to S2 (`:949-953`). The repository variable
`CONFERENCE_MODE_UNTIL` (yyyy-MM-dd) tells the gate whether that surge is expected
(`MMCA.ADC/.github/workflows/cost-guard.yml:31`), and the workflow takes one `workflow_call` input,
`deploy_gate` (`:19`, read at `:32`). The step rejects a malformed date (`:63-66`) and classifies the
window as on or expired (`:68`). On drift it exits 0 while the window is on (`:107-108`); exits 0 on the
deploy path once the window has ended, because that deploy returns the footprint to baseline
(`:111-112`); exits 1 off the deploy path when an ended window left the surge live (`:115-116`); and
with no window set reports surge drift and exits 1 (`:118-119`). Store has no such window: it has no
event-driven surge, and its S0 headroom (above) is its only tolerance. The "declares no inputs",
"every Container App is declared with `maxReplicas: 2`" and "a legitimate scale-up blocks deploys"
statements above are scoped accordingly.

Trade-off added: **while the window is on, the gate passes any drift.** The on-window exit is 0
whatever the reading (`cost-guard.yml:107-108`), so a scale-up beyond the declared surge, or a SQL
tier change, also passes until `CONFERENCE_MODE_UNTIL` lapses. A far-future date keeps the gate open
for as long as it stands.

The body's `cost-guard.yml`, `deploy.yml` and Bicep anchors point at the current lines. Store's
calling job is corrected too: like ADC's, it grants its own `id-token: write`
(`MMCA.Store/.github/workflows/deploy.yml:826-828`) under workflow-level permissions that omit it
(`:44-53`).

## Revision (2026-10-07)
Re-verified against current source. The gate mechanism, the `2` replica ceiling, the per-repo SQL
tier sets and ADC's conference-mode window are unchanged; three statements and the Bicep and
`deploy.yml` anchors moved.

1. **Common's workflow list is three files.** `MMCA.Common/.github/workflows/` holds `ci.yml`,
   `load-tests.yml` and `release.yml` and no Claude workflows, so the Adoption paragraph no longer
   says "the same two". The Revision (2026-10-06) count of five is superseded. Helpdesk's list
   (`ci.yml`, `claude-code-review.yml`, `claude.yml`, `release-templates.yml`) is unchanged. The
   conclusion stands: neither repo carries `cost-guard.yml` or a deploy workflow.
2. **ADC's Notification app stays off the conference-mode ceiling.** Five ADC Container Apps read
   `conferenceScaledMaxReplicas` (`MMCA.ADC/infra/main.bicep:1914,2067,2202,2541,2692`), while
   Notification declares a literal `maxReplicas: 2` and its comment states it keeps the baseline in
   conference mode too (`:2385-2388`). The Context now names that split.
3. **`backend-test-gate` is gone from both deploy conditions.** Neither `deploy.yml` declares it. ADC's
   deploy tolerates two skippable needs, `e2e-gate` and `ai-eval-gate`
   (`MMCA.ADC/.github/workflows/deploy.yml:1145,1182-1183`), and Store's one, `e2e-gate`
   (`MMCA.Store/.github/workflows/deploy.yml:1083,1116`), which is what the Decision already says. The
   2026-09-03 and 2026-09-11 Status sentences that mention it are history and stay as written.
4. **ADC's AtlDevCon bacpac no longer exists.** The archive note now records that the bacpac was
   deleted on 2026-10-03, so AtlDevCon has no restore path (`MMCA.ADC/infra/main.bicep:932-938,980-981`).
   The Decision's point is unaffected: ADC's baseline is `Basic` alone.
5. Anchors re-verified against current source: ADC `conferenceScaledMaxReplicas`
   (`MMCA.ADC/infra/main.bicep:192`), the S2 switch (`:965-969`), the budget (`:793-821`), the
   AtlDevCon note (`:932-938`); the `cost-guard` calling jobs
   (`MMCA.Store/.github/workflows/deploy.yml:730-739`, `if` at `:732`, permissions `:735-737`;
   `MMCA.ADC/.github/workflows/deploy.yml:770-783`, `if` at `:772`, permissions `:775-777`,
   `deploy_gate: true` at `:781-782`). Anchors inside the earlier dated revisions stay as written.

## Revision (2026-10-19)
No decision changed; the gate, its two dimensions, both tier sets and the deploy-path wiring hold.
Five statements are corrected:
1. **The schedule is a per-repo cadence.** ADC's cron runs daily at 07:00 UTC
   (`MMCA.ADC/.github/workflows/cost-guard.yml:14`, since ADC #280), so an expired conference window or
   an out-of-band scale-up is reported within a day; Store's stays Monday 07:00 UTC
   (`MMCA.Store/.github/workflows/cost-guard.yml:21`), since it has no dated window to expire. The
   Decision and the Rationale bullet that described a weekly cron in both repos now say so.
2. **The circular-remediation trade-off is retired.** Neither drift message suggests re-running the
   deploy any more: Store's says to reset to baseline by hand in Azure
   (`MMCA.Store/.github/workflows/cost-guard.yml:109`), and ADC's out-of-band message points at the
   runbook's recovery move (`MMCA.ADC/.github/workflows/cost-guard.yml:120`). The Trade-offs bullet now
   records the out-of-band reset as the design, and the Decision sentence that justified the old
   message is rewritten.
3. **`deploy_gate` is a `workflow_call` input** (`MMCA.ADC/.github/workflows/cost-guard.yml:19-24`); the
   `workflow_dispatch` trigger declares none (`:15`). The 2026-10-06 revision's wording is corrected in
   place.
4. **ADC `cost-guard.yml` anchors moved down by two lines**: triggers
   `:12-24`, job `:37-41`, permissions `:26-28`, ceiling `:32`, replica loop `:83-88`, SQL loop
   `:97-104` with the Basic check at `:101`, resource group `:31`, `az config` `:53`, contract
   `:9-10`, step `:50-123` under `set -euo pipefail` at `:52`, login `:43-48`, empty-read default
   `:86-87`. Store's `cost-guard.yml` anchors are unchanged.
5. **Deploy-path anchors re-pointed.** `deploy.needs`: `MMCA.ADC/.github/workflows/deploy.yml:1160`,
   `MMCA.Store/.github/workflows/deploy.yml:1098`; the `always()` condition: ADC `:1187-1198` (literal
   `needs.cost-guard.result == 'success'` at `:1193`), Store `:1121-1131` (`:1127`); the calling job:
   ADC `:784-797` (`if` at `:786`, permissions `:789-791`), Store `:731-740` (`if` at `:733`,
   permissions `:736-738`); the diff-scoped gates: Store `e2e-gate` `if` at `:763`, ADC `ai-eval-gate`
   `if` at `:525`.

## Revision (2026-10-21)
Re-verified against current source. The gate mechanism, the `2` replica ceiling, the per-repo SQL
tier sets, the budget thresholds (80% actual, 100% forecast), ADC's conference-mode window and every
fact in the archive notes are unchanged; only anchors in the live sections moved. Anchors inside the
earlier dated revisions stay as written.

1. Anchors re-verified against current source: Store `maxReplicas: 2` apps
   (`MMCA.Store/infra/main.bicep:1682,1806,1954,2073,2191`), Store per-service SQL `Basic` sku
   (`:1036-1039`), Store budget (`:841-866`, thresholds `:854` and `:862`, "silently running"
   comment `:839`), Store `MMCAStore` archive note (`:1006-1013`), Store Service Bus `Standard`
   (`:1074-1081`, tier at `:1080`); ADC scaled apps reading `conferenceScaledMaxReplicas`
   (`MMCA.ADC/infra/main.bicep:2070,2223,2358,2697,2848`), Notification's literal `maxReplicas: 2`
   (`:2544`, comment `:2541-2543`), the S2/Basic switch (`:1115-1119`, Basic at `:1119`), the budget
   (`:941-966`, thresholds `:954` and `:962`), the AtlDevCon note (`:1080-1086`, bacpac deletion on
   2026-10-03 at `:1085`); `conferenceMode` (`:157`) and `conferenceScaledMaxReplicas` (`:192`) are
   unchanged. CONTRIBUTING push-only lists: `MMCA.Store/CONTRIBUTING.md:42,120`,
   `MMCA.ADC/CONTRIBUTING.md:42,112`. ADR-064's "change itself as their subject" passage
   (`Website/docs-src/adr/064-deploy-recency-gates.md:46-47`) and its four-gate decision (`:78-80`).
   ADC's deploy-path pass on an expired window is `MMCA.ADC/.github/workflows/cost-guard.yml:112-114`.

## Revision (2026-10-26)
Re-verified against current source. The gate mechanism, the `2` replica ceiling, the per-repo SQL
tier sets, the budget thresholds, ADC's conference-mode window and the deploy-path wiring are
unchanged; one Decision sentence is scoped and the Bicep and `deploy.yml` anchors moved. Anchors
inside the earlier dated revisions stay as written.

1. **The re-run sentence is scoped to the surge-drift messages.** The Decision said flatly that
   neither drift message offers a re-run of the deploy. ADC's expired-window message does say to run
   the deploy (`MMCA.ADC/.github/workflows/cost-guard.yml:117`), and that re-run is not circular,
   because on the deploy path an expired window exits 0 (`:112-114`) and the deploy reverts
   `conferenceMode`. Store's message (`MMCA.Store/.github/workflows/cost-guard.yml:109`) and ADC's
   out-of-band message (`MMCA.ADC/.github/workflows/cost-guard.yml:120`) still offer no re-run. The
   Decision now names the exception the Trade-offs bullet already carried.
2. Anchors re-verified against current source: Store `maxReplicas: 2` apps
   (`MMCA.Store/infra/main.bicep:1688,1812,1960,2079,2197`), Store per-service SQL `Basic` sku
   (`:1040-1044`, name at `:1041`), Store budget (`:845-873`, thresholds `:858` and `:866`, "silently
   running" comment `:843`), Store `MMCAStore` archive note (`:1010-1017`), Store Service Bus
   `Standard` (`:1078-1085`, tier at `:1084`); ADC scaled apps reading `conferenceScaledMaxReplicas`
   (`MMCA.ADC/infra/main.bicep:2106,2259,2394,2733,2884`), Notification's literal `maxReplicas: 2`
   (`:2580`, comment `:2577-2579`), the S2/Basic switch (`:1149-1153`, Basic at `:1153`), the budget
   (`:975-1003`, thresholds `:988` and `:996`), the AtlDevCon note (`:1114-1123`, bacpac deletion on
   2026-10-03 at `:1119`, repeated at `:1164-1165`); `conferenceMode` (`:157`) and
   `conferenceScaledMaxReplicas` (`:192`) are unchanged. `deploy.needs`:
   `MMCA.Store/.github/workflows/deploy.yml:1099`, `MMCA.ADC/.github/workflows/deploy.yml:1161`; the
   `always()` condition: Store `:1122-1132` (literal at `:1128`, `e2e-gate` tolerance `:1132`, docs-only
   `:1126`), ADC `:1188-1199` (literal at `:1194`, tolerances `:1198-1199`, docs-only `:1192`); the
   diff-scoped gates: Store `e2e-gate` `if` at `:764`, ADC `ai-eval-gate` `if` at `:526`; the calling
   job: Store `:732-741` (`if` at `:734`, permissions `:737-739`), ADC `:785-798` (`if` at `:787`,
   permissions `:790-792`).

## Revision (2026-10-28)
Re-verified against current source. The gate mechanism, the `2` replica ceiling, the per-repo SQL
tier sets, the budget thresholds, ADC's conference-mode window and the deploy-path wiring are
unchanged; one Decision bullet is added and the Bicep, CONTRIBUTING and ADR-064 anchors moved.
Anchors inside the earlier dated revisions stay as written.

1. **The per-service cost-attribution tag is recorded.** Every container app and per-service
   database in both deployed apps' `infra/main.bicep` carries a `service` tag unioned into
   `commonTags`, so Azure Cost Analysis splits the bill by service. The shared
   `CostTagConventionTestsBase`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/CostTagConventionTestsBase.cs:29`,
   container-app check `:58-75`, database check `:82-93`) checks it textually: each container app
   needs a `service:` key in its `tags:` line (`:68`, `:106`), and the file must contain the one
   looped database tag line (`:88-90`), with a minimum app count so the parse cannot pass
   vacuously (`:36`). It does not itself require the `commonTags` union on an app. ADC derives it with `MinimumContainerApps => 6` and
   `DatabaseNamePrefix => "ADC_"`
   (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/CostTagConventionTests.cs:10-14`),
   Store with `5` and `"Store_"`
   (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Governance/CostTagConventionTests.cs:10-14`);
   MMCA.Helpdesk has no derivation. The Decision gains a bullet for it. This is attribution, not
   a cap: the Trade-offs bullet on the gate's two cost dimensions still holds.
2. Anchors re-verified against current source: Store `maxReplicas: 2` apps
   (`MMCA.Store/infra/main.bicep:1689,1813,1961,2080,2198`), Store per-service SQL `Basic` sku
   (`:1041-1045`, database `service` tag `:1039`), Store `MMCAStore` archive note (`:1011-1018`,
   bacpac blob at `:1015`), Store Service Bus `Standard` (`:1079-1086`, tier at `:1085`), Store
   budget unchanged (`:845`, comment `:843`); ADC scaled apps reading `conferenceScaledMaxReplicas`
   (`MMCA.ADC/infra/main.bicep:2103,2256,2391,2730,2881`), Notification's literal `maxReplicas: 2`
   (`:2577`, comment `:2574-2576`), the S2/Basic switch unchanged (`:1149-1153`), `conferenceMode`
   (`:157`) and `conferenceScaledMaxReplicas` (`:192`) unchanged. CONTRIBUTING push-only lists:
   `MMCA.Store/CONTRIBUTING.md:42,122`, `MMCA.ADC/CONTRIBUTING.md:42,115`. ADR-064's "change itself
   as their subject" passage (`Website/docs-src/adr/064-deploy-recency-gates.md:49-50`), its
   `cost-guard` entry in the `deploy.needs` list (`:86`) and its four-gate decision (`:82`, `:85`). ADC `cost-guard.yml` env anchors in the live sections hold
   (`AZURE_RESOURCE_GROUP` `:31`, `BASELINE_MAX_REPLICAS` `:32`); `CONFERENCE_MODE_UNTIL` and
   `DEPLOY_GATE` now sit at `:33` and `:34`, cited only inside the Revision (2026-10-06) text.
