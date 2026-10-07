# ADR-064: Deploy Preconditions as Proof-of-Recency Gates

## Status
Accepted (2026-08-01). Revised 2026-08-07: the MMCA.Helpdesk workflow inventory below was corrected
(it also carries `release-templates.yml`, and its `ci.yml` runs two jobs, not one); the conclusion
that Helpdesk has no rollout for a recency gate to block is unchanged. Revised 2026-09-01: the broker
recency gate now requires TWO job conclusions, `cross-service` and `servicebus-emulator-smoke`, in
both repos (ADC promoted the emulator tier on 2026-08-31 as TD-17, Store immediately after), so the
bullet that described one required job and treated `servicebus-emulator-smoke` as the advisory job
that justifies reading jobs instead of the run conclusion is restated; that justification now rests
on `apphost-smoke`, which is still advisory. The same date records a second change, in MMCA.ADC
only: `backend-test-gate` (TD-20, added 2026-08-31) joined `deploy.needs`, so ADC's deploy condition
now tolerates `skipped` from two conditional test gates rather than one, while MMCA.Store still
tolerates it from `e2e-gate` alone. The three freshness gates and the gate mechanism are unchanged.
Revised 2026-09-03: MMCA.Store gained its own `backend-test-gate`, so the asymmetry the 2026-09-01
revision recorded is closed and both repos now run the same complementary pair of conditional test
gates; Store's `deploy.yml` citations are re-anchored for the lines the new job displaced.
Revised 2026-09-11: a **fourth** freshness gate, `cross-browser-freshness`, now runs in both repos
(`MMCA.ADC/.github/workflows/deploy.yml:1039`, `MMCA.Store/.github/workflows/deploy.yml:953`), so
every sentence that said "three" says four, and the same break-glass input governs all four. MMCA.ADC
also added a third conditional test gate, `ai-eval-gate`
(`MMCA.ADC/.github/workflows/deploy.yml:500-502`), which Store does not have, so the two
`deploy.needs` lists are no longer identical: 12 entries in ADC, 11 in Store. Every `deploy.yml`
citation below is re-anchored for the lines the new jobs displaced.
Revised 2026-09-19: the MMCA.Helpdesk inventory is corrected again. Its `ci.yml` now runs **four**
jobs, not the two the 2026-08-07 revision recorded: `changes`, `build-and-test`, `template-smoke`
and `postgresql-canary`, the last an advisory `continue-on-error` PostgreSQL consumer canary added
for ADR-113. The workflow-file count is still four and none of the four `ci.yml` jobs has an Azure
step, so the conclusion that Helpdesk has no rollout for a recency gate to block is unchanged.
Revised 2026-09-25: every `deploy.yml` citation in both repos is re-anchored onto its current line.
The gates, their windows, the break-glass contract and the `ai-eval-gate` asymmetry (12 `deploy.needs`
entries in ADC, 11 in Store) are unchanged.
Revised 2026-10-01 (the four gate bodies now run as one shared composite action owned by MMCA.Common,
so the per-repo copies and their message differences are gone; see Revision below).
Revised 2026-10-06: the job-reading gates now page an unfiltered run listing and filter completed runs client-side (MMCA.Common v1.220.0), and every citation is re-anchored.
Revised 2026-10-07: the four gates now run as the four steps of one `freshness` job that skips a docs-only push, `backend-test-gate` is retired in both repos, and the success-only lookup filters client-side (see Revision below).

## Context
A production rollout in both deployed apps waits on a list of jobs in `deploy.needs`
(`MMCA.ADC/.github/workflows/deploy.yml:1145`, `MMCA.Store/.github/workflows/deploy.yml:1083`). Most of
those jobs have the change itself as their subject: a supply-chain audit (ADR-038), a FinOps
cost check, a chromium end-to-end run against the booted stack. They answer "is this build good."

Four kinds of verification cannot answer that question inside a deploy, because they cannot run
inside one, or cost too much to run there. A point-in-time restore takes minutes and provisions a real
Azure database
(`MMCA.ADC/.github/workflows/dr-drill.yml:3-5`, `MMCA.Store/.github/workflows/dr-drill.yml:3-5`). A k6
load run drives sustained traffic at production read endpoints
(`MMCA.ADC/.github/workflows/load-test.yml:3-6`). The Testcontainers broker round-trip needs a Docker
daemon that the gating jobs deliberately do not have
(`MMCA.ADC/.github/workflows/deploy.yml:863-866`, `MMCA.Store/.github/workflows/deploy.yml:820-823`).
The firefox and webkit end-to-end legs cost roughly
twenty minutes per engine and were taken off the per-deploy gate in 2026-07 for exactly that reason,
leaving the deploy-path `e2e-gate` chromium-only
(`MMCA.ADC/.github/workflows/deploy.yml:893-896`,
`MMCA.Store/.github/workflows/deploy.yml:848-850`). Each therefore lives on its own schedule: weekly
Monday for the drill (`MMCA.ADC/.github/workflows/dr-drill.yml:32`,
`MMCA.Store/.github/workflows/dr-drill.yml:33`), monthly for the load test
(`load-test.yml:23`, Store `:21`), weeknights for the broker tier
(`MMCA.ADC/.github/workflows/cross-service-tests.yml:31`,
`MMCA.Store/.github/workflows/cross-service-tests.yml:35`), and alternating weekly crons for the two
non-chromium engines, Monday firefox and Thursday webkit
(`MMCA.ADC/.github/workflows/e2e.yml:49-50`, `MMCA.Store/.github/workflows/e2e.yml:46-47`).

ADR-009 requires that those objectives exist and that a restore be **drilled**: its DR doc carries a
drill-result table "that cannot stay empty." It says nothing about age. A drill recorded in March and
a drill recorded last Monday read identically in a document, and a scheduled workflow that has been
silently failing for six weeks still leaves a green-looking history behind it. Nothing decided what a
deploy should do when the newest proof is old. ADR-057, the other CI-gate record, is explicitly a
pull-request merge gate over migration shape and covers none of this.

## Decision
A production deploy is blocked not only on green tests but on **proof of recency** for out-of-band
verification: four gates assert that a real drill, a real load run, a real broker round-trip and a
real run on each non-chromium browser engine happened recently enough to still mean something.

- **Four recency gates run as the four steps of one `freshness` job in `deploy.needs`, beside the
  result-based gates.** The job is listed with `changes`, `supply-chain`, `cost-guard`, `e2e-gate`,
  `foundation` and `build-images`, plus `ai-eval-gate` in ADC only, which is why ADC's list carries 8
  entries and Store's 7 (`MMCA.ADC/.github/workflows/deploy.yml:1145`,
  `MMCA.Store/.github/workflows/deploy.yml:1083`). The job runs on `ubuntu-latest` holding
  `actions: read` and `contents: read` only, with a 5-minute timeout in ADC and 10 in Store
  (`MMCA.ADC/.github/workflows/deploy.yml:817-824`, `MMCA.Store/.github/workflows/deploy.yml:774-781`).
  Each step keeps its gate's name as both `name` and `id`: `dr-freshness`, `load-freshness`,
  `cross-service-freshness` and `cross-browser-freshness`
  (`MMCA.ADC/.github/workflows/deploy.yml:830-831,849-850,870-871,909-910`,
  `MMCA.Store/.github/workflows/deploy.yml:788-789,806-807,825-826,856-857`). The last three carry
  `if: ${{ !cancelled() }}`, so they still run and report after an earlier step fails
  (`MMCA.ADC/.github/workflows/deploy.yml:851,872,911`,
  `MMCA.Store/.github/workflows/deploy.yml:808,827,858`). Every step calls one shared composite action,
  `ivanball/MMCA.Common/.github/actions/freshness-gate`
  (`MMCA.ADC/.github/workflows/deploy.yml:835,854,877,917`,
  `MMCA.Store/.github/workflows/deploy.yml:792,811,832,864`), so the gate logic has one implementation
  (`MMCA.Common/.github/actions/freshness-gate/action.yml`).

- **Each gate asks the Actions API for the newest proof of one workflow and fails on its age.** The
  window is the action's `window-days` input: `8` for the weekly DR drill
  (`MMCA.ADC/.github/workflows/deploy.yml:839`, `MMCA.Store/.github/workflows/deploy.yml:796`), `35`
  for the monthly k6 run (`:858` / `:815`), `5` for the weekday-nightly broker tier (ADC `:883`, Store
  `:838`, widened from 3 on 2026-07-18 to tolerate a weekend or holiday, a note carried at
  `:881` in ADC and `:836` in Store), and `10` for the two alternating weekly browser crons
  (ADC `:922`, Store `:872`, a seven-day per-engine cadence plus slack for a skipped night or a
  late re-run, reasoned inline at `:899-902` in ADC and `:868-871` in Store). The DR and load
  gates pass no `required-jobs`, so the action pages an unfiltered run listing of `dr-drill.yml` and
  `load-test.yml` respectively, keeps the runs that completed with conclusion `success` (filtered
  client-side) and reads the newest one's `updated_at`
  (`MMCA.Common/.github/actions/freshness-gate/action.yml:152-167,223-231`), computes the age in whole
  days and fails when it exceeds the window
  (`MMCA.Common/.github/actions/freshness-gate/action.yml:143-147,246`).

- **Absence fails; it does not pass.** An empty result (no successful run at all) prints a `FAIL` line
  naming the workflow to dispatch and exits 1
  (`MMCA.Common/.github/actions/freshness-gate/action.yml:227-228`); in the job-reading modes a missing
  proof sets the `fail` flag and the step exits 1 at the end
  (`MMCA.Common/.github/actions/freshness-gate/action.yml:214-215,246`). One action produces every
  message, so both repos print the same sentences apart from the scan bound in the cross-browser absence message. A failed Actions API read
  also fails closed with `::error::`, in every mode
  (`MMCA.Common/.github/actions/freshness-gate/action.yml:212,224`).

- **The broker gate keys off the jobs, not the run conclusion.** It passes the two broker job names as
  `required-jobs` with `required-jobs-mode: same-run` and `max-runs: '25'`
  (`MMCA.ADC/.github/workflows/deploy.yml:885-889`, `MMCA.Store/.github/workflows/deploy.yml:840-844`),
  so the action enumerates completed runs of `cross-service-tests.yml` (any conclusion) and, for each,
  asks the jobs API which jobs concluded `success`, stopping at the first run where all the named jobs
  did (`MMCA.Common/.github/actions/freshness-gate/action.yml:186-216`). The listing is requested
  without a server-side `status` filter and narrowed to completed runs client-side, paging (at most
  five pages of `max-runs` each) until `max-runs` completed runs are collected or the listing ends, and
  the first listed run's id and creation time go to the step summary so a stale listing is visible
  (`MMCA.Common/.github/actions/freshness-gate/action.yml:152-182`). Two jobs are required in both repos as of
  2026-08-31 (ADC, TD-17) and immediately after in Store: `cross-service`, the Testcontainers RabbitMQ
  outbox to broker to consumer round-trip, and `servicebus-emulator-smoke`, the Azure Service Bus
  emulator topology plus AMQP round-trip, so the production transport is a deploy precondition too
  (ADR-066). The reasoning for reading jobs rather than the run is recorded inline in both repos: a
  skip-if-unchanged guard can make a run conclude `success` with the test jobs skipped and no
  round-trip executed (`MMCA.ADC/.github/workflows/deploy.yml:875-876`,
  `MMCA.Store/.github/workflows/deploy.yml:830-831`). Store's comment adds that an advisory job can
  fail a run that holds a genuine proof (`MMCA.Store/.github/workflows/deploy.yml:831`), but neither
  repo's `cross-service-tests.yml` carries an advisory job today: its jobs are `should-run`,
  `cross-service` and `servicebus-emulator-smoke`
  (`MMCA.ADC/.github/workflows/cross-service-tests.yml:51,79,142`,
  `MMCA.Store/.github/workflows/cross-service-tests.yml:54,85,141`).

- **The cross-browser gate resolves each engine separately, for the same reason.** It passes
  `E2E (firefox)` and `E2E (webkit)` as `required-jobs` with `required-jobs-mode: per-job`
  (`MMCA.ADC/.github/workflows/deploy.yml:924-928`, `MMCA.Store/.github/workflows/deploy.yml:874-878`),
  so the action walks completed `e2e.yml` runs newest first once per engine, takes the first run in
  which that engine's job concluded `success`, and age-checks each engine's proof on its own; any
  engine that is stale or missing sets the `fail` flag, so both are reported before the step exits 1
  (`MMCA.Common/.github/actions/freshness-gate/action.yml:147,215,234-241,246`). Two properties of
  the nightly force the per-job read: the engines run on alternating crons, so the newest firefox proof
  and the newest webkit proof normally come from different runs and there is no single run to point at,
  and the scheduled non-chromium legs are `continue-on-error`, so a run can conclude `success` with an
  engine red (`MMCA.ADC/.github/workflows/e2e.yml:147`, `MMCA.Store/.github/workflows/e2e.yml:149`).
  ADC records both properties inline (`MMCA.ADC/.github/workflows/deploy.yml:899-900,904-906`); Store's
  comments record only the alternation (`MMCA.Store/.github/workflows/deploy.yml:850,859-860`).

- **Break-glass exists as a dispatch input pair and refuses to fire without a written reason.**
  `workflow_dispatch` carries `skip_freshness_gates` (boolean, default `false`) and
  `skip_justification` (string, default empty)
  (`MMCA.ADC/.github/workflows/deploy.yml:13-20`, `MMCA.Store/.github/workflows/deploy.yml:26-33`).
  Every step passes both to the action as `skip` and `skip-justification`
  (`MMCA.ADC/.github/workflows/deploy.yml:841-842,860-861,890-891,929-930`,
  `MMCA.Store/.github/workflows/deploy.yml:798-799,817-818,845-846,879-880`), which maps them into its
  step environment (`MMCA.Common/.github/actions/freshness-gate/action.yml:93-94`) and, when the flag
  is true with an empty justification, emits `::error::` and exits 1
  (`MMCA.Common/.github/actions/freshness-gate/action.yml:100-103`). With a justification it writes a
  headed break-glass block plus the reason to the step summary, raises a `::warning::` annotation
  carrying the same text, and exits 0
  (`MMCA.Common/.github/actions/freshness-gate/action.yml:104-113`). One input governs all four gates,
  because every step reads the same two inputs.

- **The skip path is unreachable on a push, and the gates never run on a pull request or a docs-only
  push.** `inputs` is empty outside a dispatch, so `${FG_SKIP:-false}` reads `false`
  (`MMCA.Common/.github/actions/freshness-gate/action.yml:100`), and the `freshness` job carries
  `if: github.event_name != 'pull_request' && needs.changes.outputs.code == 'true'`
  (`MMCA.ADC/.github/workflows/deploy.yml:819`, `MMCA.Store/.github/workflows/deploy.yml:778`): the
  gates run on a push or manual dispatch that changes code, and a docs-only push skips them along with
  the deploy, whose condition also requires `needs.changes.outputs.code == 'true'`
  (`MMCA.ADC/.github/workflows/deploy.yml:1176`, `MMCA.Store/.github/workflows/deploy.yml:1110`).

- **A break-glass skip still reports success, which is what the deploy condition demands.** The deploy
  runs under `always()` with explicit per-need results and requires `success` from the `freshness` job
  by name; only a conditional gate may be `skipped`
  (`MMCA.ADC/.github/workflows/deploy.yml:1172-1183`,
  `MMCA.Store/.github/workflows/deploy.yml:1106-1116`). Store allows it for `e2e-gate` alone, which runs
  only when the diff touches the UI (`MMCA.Store/.github/workflows/deploy.yml:761`); ADC allows it for
  `e2e-gate` (`MMCA.ADC/.github/workflows/deploy.yml:803`) and for `ai-eval-gate`, which runs only when
  the diff touches the scoring code (`MMCA.ADC/.github/workflows/deploy.yml:511`). A code deploy that
  skips `e2e-gate` is still tested: the test gate is the pull request's `build-and-test`, because
  branch protection enforces admins and requires an up-to-date branch, so the merged tree is the
  PR-tested tree (`MMCA.ADC/.github/workflows/deploy.yml:798-800,1146-1148`,
  `MMCA.Store/.github/workflows/deploy.yml:757-759,1084-1086`). Exiting 0 inside the step is what keeps
  break-glass compatible with that contract, and both repos say so in the comment above the condition
  (`MMCA.ADC/.github/workflows/deploy.yml:1166-1167`,
  `MMCA.Store/.github/workflows/deploy.yml:1100-1102`).

- **Deploy-time only, and deliberately not a required merge check.** Both repos document the freshness
  gates as push-only jobs that run after merge and must not be added to branch protection, since a job
  that never runs on a pull request would block every merge
  (`MMCA.ADC/CONTRIBUTING.md:42-44,111-113`, `MMCA.Store/CONTRIBUTING.md:42-43,118-120`). In both
  files the push-only half is the earlier passage and the "do not require these jobs" sentence is the
  later one. Neither enumeration is exhaustive: ADC's at `CONTRIBUTING.md:42-44` stops at
  `cross-service-freshness` and Store's at `:42-43` names only `dr-freshness` and `load-freshness`, so
  the generic "the freshness gates" sentence (`MMCA.ADC/CONTRIBUTING.md:111`,
  `MMCA.Store/CONTRIBUTING.md:118`) is what covers `cross-browser-freshness` in both.

**Adoption is the two deployed apps, and all four gates are the same shape in both.** The
`deploy.needs` lists are not identical, because ADC carries `ai-eval-gate` and Store does not:
8 entries in ADC against 7 in Store (`MMCA.ADC/.github/workflows/deploy.yml:1145`,
`MMCA.Store/.github/workflows/deploy.yml:1083`). The `freshness` job and `e2e-gate` are common to the
two lists. There is no per-repo gate body: both repos call
the same MMCA.Common action, so every message is identical apart from that scan bound, and the only per-repo difference in the
gate inputs is the cross-browser scan bound, 40 completed `e2e.yml` runs in ADC against 50 in Store
(`MMCA.ADC/.github/workflows/deploy.yml:928`, `MMCA.Store/.github/workflows/deploy.yml:878`). The job
timeout differs too, 5 minutes in ADC against 10 in Store
(`MMCA.ADC/.github/workflows/deploy.yml:821`, `MMCA.Store/.github/workflows/deploy.yml:777`). The
broker-step comments explaining the job read differ by one clause, Store's added note about an
advisory job (`MMCA.ADC/.github/workflows/deploy.yml:875-876`, `MMCA.Store/.github/workflows/deploy.yml:830-831`);
ADC's backlog items TD-02 and TD-17 survive only in comments, in ADC
(`MMCA.ADC/.github/workflows/deploy.yml:863,1151`) and in the Store step header that mirrors them
(`MMCA.Store/.github/workflows/deploy.yml:820`); the header comments above each step still
differ in wording.
**MMCA.Helpdesk has no
deploy pipeline at all**: its `.github/workflows/` holds four files, `ci.yml`, the two Claude
workflows, and `release-templates.yml`, and the fourth publishes the MMCA.Templates `dotnet new` pack
to nuget.org on a `templates-v*` tag rather than rolling anything out
(`MMCA.Helpdesk/.github/workflows/release-templates.yml:3,17`). `ci.yml` runs four jobs and none has
an Azure step: `changes` classifies the changed paths so the heavy advisory job below can skip a
docs-only pull request (`MMCA.Helpdesk/.github/workflows/ci.yml:17`), `build-and-test` builds and
tests against MMCA.Common source (`MMCA.Helpdesk/.github/workflows/ci.yml:58`), `template-smoke`
packs the template, generates an app and builds it through `build/templates/smoke.ps1`
(`MMCA.Helpdesk/.github/workflows/ci.yml:120`), and `postgresql-canary` generates a
PostgreSQL-shaped app against a real `postgres:17` service container as the ADR-113 consumer canary,
advisory by `continue-on-error` and gated on `needs.changes.outputs.code == 'true'`
(`MMCA.Helpdesk/.github/workflows/ci.yml:146,152,155`). There is no rollout for a recency gate to
block.
**MMCA.Common has no deploy workflow either**: its `.github/workflows/` holds three files, `ci.yml`,
`release.yml` and `load-tests.yml` (a scheduled and manually dispatched load run,
`MMCA.Common/.github/workflows/load-tests.yml:16-17`); it publishes
packages on a tag rather than deploying a service, and none of those files runs a freshness gate. It does own the gate implementation: the composite action
`MMCA.Common/.github/actions/freshness-gate/action.yml`, which both deployed apps consume.

## Rationale
- **A proof with no expiry date is documentation, not a control.** ADR-009 already required the drill
  to be recorded, and recording it was the honest half of the problem; a record has no shelf life. The
  age comparison is what converts an artifact into something that can say no.
- **The expensive verification stays off the deploy path.** Running the restore, the k6 scenario or a
  Testcontainers broker tier per deploy would add minutes and real Azure or Docker cost to every
  rollout, and the broker tier could not run there at all. One or two Actions API reads inside a
  five-minute job buys the same guarantee at effectively zero marginal cost, which is exactly why the
  gate is affordable enough to keep enabled.
- **Fail on absence, because a vacuous gate is worse than none.** A gate that passes when it finds
  nothing reads as evidence while proving nothing, so an empty query result exits 1 rather than 0.
- **Job-level truth for the broker and cross-browser gates.** The run conclusion is wrong in both
  directions here (a skipped-but-green run, a failed-but-proven run), so the only honest signal is
  whether the specific job that performs the round-trip, or that drives the engine, actually ran and
  passed. Keying off the cheaper signal would have produced both a false pass and a deploy-blocking
  false red.
- **An unenforced proof rots quietly.** Moving firefox and webkit off the per-deploy gate saved the
  minutes but left nothing asserting those legs still passed, so cross-engine coverage could sit red
  for weeks while deploys kept shipping green
  (`MMCA.Store/.github/workflows/deploy.yml:851-852`). A recency gate restores enforcement for two
  Actions API queries rather than by putting roughly forty minutes of browser time back on every UI
  deploy (`MMCA.ADC/.github/workflows/deploy.yml:895-896`).
- **A justified skip beats an undocumented one.** The alternative to break-glass is not "no skip," it
  is someone commenting the gate out or force-merging around it. Requiring a non-empty reason, then
  printing it in the step summary and as a run annotation, ties the decision to the exact deploy that
  shipped without it.
- **Windows are the cadence plus slack, not round numbers.** 8 days over a weekly cron, 35 over a
  monthly one, 5 over a weekday-only nightly, 10 over a weekly per-engine cron: each tolerates one
  missed or delayed run without tolerating a dead schedule. Store's comment states the boundary
  explicitly for the newest window: 7 plus 1 would red the deploy on any single-week hiccup, and a
  wider one would let an engine rot for two full cycles (`MMCA.Store/.github/workflows/deploy.yml:868-871`).

## Trade-offs
- **An unrelated stale proof blocks an unrelated deploy.** A one-line hotfix does not ship when the
  monthly k6 cron did not fire, and the failure surfaces after merge: the `freshness` job goes red and
  `deploy` is left skipped by its explicit per-need condition
  (`MMCA.ADC/.github/workflows/deploy.yml:1172-1183`,
  `MMCA.Store/.github/workflows/deploy.yml:1106-1116`). The coupling is deliberate, and the cost is a
  blocked rollout at whatever moment the schedule happened to lapse.
- **Break-glass is auditable but human-judged.** Only non-emptiness is checked: nothing rates the
  reason, there is no second approver, no expiry and no tracked follow-up beyond the step-summary
  sentence telling the operator to re-run the workflow. One input also skips all four gates at once,
  so a deploy forced past a broken broker nightly silently forgoes the DR, capacity and cross-engine
  proofs too.
- **Recency is not relevance.** The DR drill rotates across the live per-service databases by ISO week
  (four in ADC, three in Store), so a "fresh" recovery proof may belong to a database this deploy does
  not touch (`MMCA.ADC/.github/workflows/dr-drill.yml:7-11`,
  `MMCA.Store/.github/workflows/dr-drill.yml:7-13`). The same applies to the other three: the newest k6
  run, the newest round-trip and the newest firefox and webkit legs proved an earlier commit, not this
  one. The cross-browser window is the widest, so a UI change can ship against an engine proof up to
  ten days old.
- **Whole-day arithmetic widens every window.** The age is integer division by 86400 compared with
  `-gt` (`MMCA.Common/.github/actions/freshness-gate/action.yml:143,145`), so a proof up to a day
  older than the stated number still passes.
- **The job-reading gates scan a bounded history.** The broker gate walks at most the 25 most recent
  completed runs (`MMCA.ADC/.github/workflows/deploy.yml:889`,
  `MMCA.Store/.github/workflows/deploy.yml:844`) and the cross-browser gate at most 40 in ADC and 50 in
  Store (`MMCA.ADC/.github/workflows/deploy.yml:928`,
  `MMCA.Store/.github/workflows/deploy.yml:878`); the action rejects a `max-runs` outside 1 to 100
  (`MMCA.Common/.github/actions/freshness-gate/action.yml:119-120`). Past the bound they fail closed
  with a message that names it, "no completed <workflow> run among the newest <N> in which <jobs>
  executed and passed" (`MMCA.Common/.github/actions/freshness-gate/action.yml:214`). Each scanned run
  also costs a second API call for its jobs, and the cross-browser gate pays that per engine; when
  in-progress runs crowd the listing, collecting the completed runs can take extra listing pages
  (at most five, `MMCA.Common/.github/actions/freshness-gate/action.yml:164-180`).
- **No pull-request signal.** Because the gates are push-only, a contributor cannot learn from the PR
  that a proof is about to be stale; the discovery happens on the post-merge deploy run.

## Revision (2026-10-01)
The four gate bodies no longer live in each repo's `deploy.yml`. MMCA.Common v1.216.0 (#463) added the
composite action `MMCA.Common/.github/actions/freshness-gate/action.yml`, and both deployed apps now
call it from a single step per gate (`MMCA.ADC/.github/workflows/deploy.yml:861,886,915,967`,
`MMCA.Store/.github/workflows/deploy.yml:834,859,887,926`). The decision is unchanged: the same four
gates, windows (`8`, `35`, `5`, `10`, now the `window-days` input in place of the job-level
`FRESHNESS_DAYS`), job-reading logic, fail-on-absence rule and break-glass contract hold, and the
deploy condition and `deploy.needs` counts (12 in ADC, 11 in Store) are untouched. What changed is
where the logic lives and three consequences of sharing it. First, the per-repo differences in
messages are gone (apart from the cross-browser scan bound): ADC's broker failure messages no longer carry the `(TD-02 / TD-17)` suffix, and
the broker-gate step comments in the two repos are now identical
(`MMCA.ADC/.github/workflows/deploy.yml:911-914`, `MMCA.Store/.github/workflows/deploy.yml:883-886`),
so ADC's inline naming of `apphost-smoke` and of the 2026-07-21 to 07-24 break-glass incident, and
Store's comment about `workflow_call` legs not appearing in the listing, no longer exist in source.
Second, the job-reading failure message now names the scan bound
(`MMCA.Common/.github/actions/freshness-gate/action.yml:176`) and a failed Actions API read fails
closed with `::error::` (`:173-174`), so the "never ran rather than not recently" ambiguity the
Trade-offs recorded is gone. Third, the cross-browser gate age-checks each engine independently
(`:197-200`) rather than computing the older of the two proofs, which gives the same outcome. Every
gate-body citation in Decision, Rationale and Trade-offs is re-anchored onto the action or onto the
current `deploy.yml` lines, and the Adoption paragraph now records that MMCA.Common owns the gate
implementation. Not recorded as a decision here: both apps reference the action at the mutable ref
`@main` (`MMCA.ADC/.github/workflows/deploy.yml:861`, `MMCA.Store/.github/workflows/deploy.yml:834`)
while other actions in the same file are pinned to a commit SHA
(`MMCA.ADC/.github/workflows/deploy.yml:79`), so a merge to MMCA.Common `main` changes both apps'
deploy gates with no consumer-side change. Whether that is deliberate is not determinable from source.

## Revision (2026-10-06)
- The job-reading listing changed in MMCA.Common v1.220.0 (`MMCA.Common/CHANGELOG.md:247`): runs are
  listed without the server-side `status=completed` filter, narrowed to completed runs client-side,
  paged (at most five pages) until `max-runs` completed runs are collected, and the first listed run
  is logged to the step summary (`MMCA.Common/.github/actions/freshness-gate/action.yml:148-198`).
  Decision and Trade-offs now record this, plus the 1 to 100 validation of `max-runs`
  (`:116-118`). The pass/fail decision on a correct listing is unchanged.
- MMCA.Common's workflow inventory in the Adoption paragraph now lists five files, adding
  `load-tests.yml`; none runs a freshness gate, so the conclusion stands.
- Correction to the 2026-10-01 note on the `@main` ref: third-party actions are SHA-pinned
  (`MMCA.ADC/.github/workflows/deploy.yml:79`, `MMCA.Store/.github/workflows/deploy.yml:88`), but
  every first-party MMCA.Common action in both files is referenced at `@main`, not only
  `freshness-gate` (ADC `:478,647,672`, Store `:510,617,642`).
- Current locations of jobs named in earlier Status revisions: `cross-browser-freshness` at
  `MMCA.ADC/.github/workflows/deploy.yml:1000` and `MMCA.Store/.github/workflows/deploy.yml:954`;
  `ai-eval-gate` at `MMCA.ADC/.github/workflows/deploy.yml:558-560`.
- Every `path:line` anchor in Context, Decision, Rationale and Trade-offs was re-verified against
  current source and re-anchored; gates, windows, `deploy.needs` counts (12 in ADC, 11 in Store) and
  the break-glass contract are unchanged.

## Revision (2026-10-07)
- The four freshness gates are no longer four jobs. Both apps run them as the four steps of one
  `freshness` job, each step keeping its gate's name as `name` and `id`, the last three under
  `if: ${{ !cancelled() }}` (`MMCA.ADC/.github/workflows/deploy.yml:817-930`,
  `MMCA.Store/.github/workflows/deploy.yml:774-880`), and `deploy.needs` names `freshness` in their
  place (`MMCA.ADC/.github/workflows/deploy.yml:1145`, `MMCA.Store/.github/workflows/deploy.yml:1083`).
  Gate names, windows, job-reading modes, scan bounds and the break-glass contract are unchanged.
- The `freshness` job skips a docs-only push (`needs.changes.outputs.code == 'true'`,
  `MMCA.ADC/.github/workflows/deploy.yml:819`, `MMCA.Store/.github/workflows/deploy.yml:778`), as do
  `cost-guard` and, on a push, `supply-chain` (ADC `:772`, `:566`; Store `:732`, `:529`); the deploy
  itself already skipped that path (ADC `:1176`, Store `:1110`).
- `backend-test-gate` is retired in both repos, ending the post-merge `CI.slnf` re-test that ADC added
  as TD-20 on 2026-08-31 and Store adopted on 2026-09-03. Branch protection on both repos now enforces
  admins with strict up-to-date required checks, so the merged tree is the tree the pull request's
  `build-and-test` already tested (`MMCA.ADC/.github/workflows/deploy.yml:1146-1148`,
  `MMCA.Store/.github/workflows/deploy.yml:1084-1086`; the protection settings themselves live in
  GitHub, not in any file). The deploy condition therefore tolerates `skipped` from `e2e-gate` alone in
  Store and from `e2e-gate` and `ai-eval-gate` in ADC, and `ai-eval-gate` now also requires a diff that
  touches the scoring code (`MMCA.ADC/.github/workflows/deploy.yml:511`). The `deploy.needs` counts
  are 8 in ADC and 7 in Store.
- The success-only lookup used by the DR and load gates no longer lists runs with a server-side
  `status=success` filter: like the job-reading modes it pages an unfiltered listing and keeps the runs
  that completed with conclusion `success` client-side
  (`MMCA.Common/.github/actions/freshness-gate/action.yml:12-15,152-167`). The pass/fail decision on a
  correct listing is unchanged.
- `cross-service-tests.yml` no longer carries an advisory job in either repo (the `apphost-smoke` job
  is removed; the jobs are `should-run`, `cross-service` and `servicebus-emulator-smoke`), so the
  advisory-job half of the broker gate's job-read rationale has no live example; the skip-if-unchanged
  half still applies.
- MMCA.Common's workflow inventory in the Adoption paragraph is three files; its two Claude workflows
  are deleted.
- Decision, Adoption, Rationale and Trade-offs are re-anchored onto the current `deploy.yml` and action
  lines.

## Related
ADR-009 (states the recovery objectives and requires that a restore be drilled and recorded; this
record decides that a deploy is blocked on how recently that drill, and the capacity and broker proofs
beside it, actually happened), ADR-057 (the sibling CI-gate record, which constrains migration shape
and is explicitly a pull-request merge gate rather than a deploy gate).
