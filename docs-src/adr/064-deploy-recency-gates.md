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

## Context
A production rollout in both deployed apps waits on a list of jobs in `deploy.needs`
(`MMCA.ADC/.github/workflows/deploy.yml:1310`, `MMCA.Store/.github/workflows/deploy.yml:1229`). Most of
those jobs have the change itself as their subject: a supply-chain audit (ADR-038), a FinOps
cost check, a chromium end-to-end run against the booted stack. They answer "is this build good."

Four kinds of verification cannot answer that question inside a deploy, because they cannot run
inside one, or cost too much to run there. A point-in-time restore takes minutes and provisions a real
Azure database
(`MMCA.ADC/.github/workflows/dr-drill.yml:3-5`, `MMCA.Store/.github/workflows/dr-drill.yml:3-5`). A k6
load run drives sustained traffic at production read endpoints
(`MMCA.ADC/.github/workflows/load-test.yml:3-6`). The Testcontainers broker round-trip needs a Docker
daemon that the gating jobs deliberately do not have
(`MMCA.ADC/.github/workflows/deploy.yml:926-932`). The firefox and webkit end-to-end legs cost roughly
twenty minutes per engine and were taken off the per-deploy gate in 2026-07 for exactly that reason,
leaving the deploy-path `e2e-gate` chromium-only
(`MMCA.ADC/.github/workflows/deploy.yml:1018-1019`,
`MMCA.Store/.github/workflows/deploy.yml:944-946`). Each therefore lives on its own schedule: weekly
Monday for the drill (`dr-drill.yml:33` in both repos), monthly for the load test
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

- **Four recency jobs sit in `deploy.needs` beside the result-based gates.** `dr-freshness`,
  `load-freshness`, `cross-service-freshness` and `cross-browser-freshness` are listed with `changes`,
  `supply-chain`, `cost-guard`, `e2e-gate`, `backend-test-gate`, `foundation` and `build-images`, plus
  `ai-eval-gate` in ADC only, which is why ADC's list carries 12 entries and Store's 11
  (`MMCA.ADC/.github/workflows/deploy.yml:1310`, `MMCA.Store/.github/workflows/deploy.yml:1229`). Each
  is a five-minute `ubuntu-latest` job holding `actions: read` and `contents: read` only
  (`MMCA.ADC/.github/workflows/deploy.yml:815-821,873-879,933-939,1039-1045`,
  `MMCA.Store/.github/workflows/deploy.yml:744-750,804-810,863-869,953-959`).

- **Each gate asks the Actions API for the newest success of one workflow and fails on its age.** The
  window is a job-level `FRESHNESS_DAYS`: `8` for the weekly DR drill
  (`MMCA.ADC/.github/workflows/deploy.yml:823`, `MMCA.Store/.github/workflows/deploy.yml:752`), `35`
  for the monthly k6 run (`:881` / `:812`), `5` for the weekday-nightly broker tier (ADC `:943`, Store
  `:873`, widened from 3 on 2026-07-18 to tolerate a weekend or holiday, a note carried at
  `:941-942` in ADC and `:871-872` in Store), and `10` for the two alternating weekly browser crons
  (ADC `:1048`, Store `:965`, a seven-day per-engine cadence plus slack for a skipped night or a
  late re-run, reasoned inline at `:1047` in ADC and `:961-964` in Store). The DR and load
  gates read `workflow_runs[0].updated_at` from a `status=success&per_page=1` query against
  `dr-drill.yml` and `load-test.yml` respectively
  (`MMCA.ADC/.github/workflows/deploy.yml:851-853,909-911`,
  `MMCA.Store/.github/workflows/deploy.yml:782-784,840-842`), compute the age in whole days and exit 1
  when it exceeds the window
  (`MMCA.ADC/.github/workflows/deploy.yml:858-864,916-922`,
  `MMCA.Store/.github/workflows/deploy.yml:789-795,847-853`).

- **Absence fails; it does not pass.** An empty result (no successful run at all) prints an error
  naming the workflow to dispatch and exits 1, in every one of the four gates
  (`MMCA.ADC/.github/workflows/deploy.yml:854-857,912-915,1003-1006,1099-1102`,
  `MMCA.Store/.github/workflows/deploy.yml:785-788,843-846,930-933,1019-1022`); Store's broker message is
  the same sentence without the `(TD-02 / TD-17)` suffix ADC carries.

- **The broker gate keys off the jobs, not the run conclusion.** It enumerates completed runs of
  `cross-service-tests.yml` (any conclusion, 25 per page) and, for each, asks the jobs API which of
  the named broker jobs concluded `success`, stopping at the first run where all of them did
  (`MMCA.ADC/.github/workflows/deploy.yml:992-1001`, gate job `:933`; the Store gate enumerates the same
  job names at `MMCA.Store/.github/workflows/deploy.yml:919-928`). Two jobs are required in both repos as of
  2026-08-31 (ADC, TD-17) and immediately after in Store: `cross-service`, the Testcontainers RabbitMQ
  outbox to broker to consumer round-trip, and `servicebus-emulator-smoke`, the Azure Service Bus
  emulator topology plus AMQP round-trip, so the production transport is a deploy precondition too
  (ADR-066). The reasoning for reading jobs rather than the run is recorded inline in both repos: a
  skip-if-unchanged guard can make a run conclude `success` with the test jobs skipped and no
  round-trip executed, and a still-advisory job in the same workflow (`apphost-smoke`) can fail or
  hang so the run concludes `failure` or `cancelled` although both proofs passed
  (`MMCA.ADC/.github/workflows/deploy.yml:978-988`). The ADC comment names the incident that forced
  break-glass while the emulator job was hanging, 2026-07-21 to 07-24
  (`MMCA.ADC/.github/workflows/deploy.yml:983`).

- **The cross-browser gate resolves each engine separately, for the same reason.** It walks completed
  `e2e.yml` runs newest first, twice, once per engine, and takes the first run whose job named
  `E2E (firefox)` or `E2E (webkit)` concluded `success`; the older of the two proofs decides the gate,
  and any engine that is stale or missing sets a `fail` flag so both are reported before the job exits 1
  (`MMCA.ADC/.github/workflows/deploy.yml:1083-1115`,
  `MMCA.Store/.github/workflows/deploy.yml:1003-1034`). Two properties of the nightly force the
  per-job read: the engines run on alternating crons, so the newest firefox proof and the newest webkit
  proof normally come from different runs and there is no single run to point at, and the scheduled
  non-chromium legs are `continue-on-error`, so a run can conclude `success` with an engine red
  (`MMCA.ADC/.github/workflows/deploy.yml:1074-1082`,
  `MMCA.Store/.github/workflows/deploy.yml:993-1002`). Store's comment adds that deploy-gate e2e legs
  never appear in this listing, because a `workflow_call` nests its jobs in the caller's run
  (`MMCA.Store/.github/workflows/deploy.yml:1000-1001`).

- **Break-glass exists as a dispatch input pair and refuses to fire without a written reason.**
  `workflow_dispatch` carries `skip_freshness_gates` (boolean, default `false`) and
  `skip_justification` (string, default empty)
  (`MMCA.ADC/.github/workflows/deploy.yml:8-20`, `MMCA.Store/.github/workflows/deploy.yml:21-33`).
  Every gate reads both into its step environment
  (`MMCA.ADC/.github/workflows/deploy.yml:829-830,887-888,949-950,1054-1055`,
  `MMCA.Store/.github/workflows/deploy.yml:757-758,817-818,878-879,970-971`) and, when the flag is true
  with an empty justification, emits `::error::` and exits 1
  (`MMCA.ADC/.github/workflows/deploy.yml:834-838`,
  `MMCA.Store/.github/workflows/deploy.yml:765-769`). With a justification it writes a headed
  break-glass block plus the reason to the step summary, raises a `::warning::` annotation carrying
  the same text, and exits 0 (`MMCA.ADC/.github/workflows/deploy.yml:839-847`,
  `MMCA.Store/.github/workflows/deploy.yml:770-778`). One input governs all four gates, and both
  repos say so in the input's own description
  (`MMCA.ADC/.github/workflows/deploy.yml:14`, `MMCA.Store/.github/workflows/deploy.yml:27`).

- **The skip path is unreachable on a push.** `inputs` is empty outside a dispatch, so
  `${SKIP_GATES:-false}` reads `false` (`MMCA.ADC/.github/workflows/deploy.yml:834`,
  `MMCA.Store/.github/workflows/deploy.yml:765`), and every gate additionally carries
  `if: github.event_name != 'pull_request'`
  (`MMCA.ADC/.github/workflows/deploy.yml:818,876,936,1042`,
  `MMCA.Store/.github/workflows/deploy.yml:747,807,866,956`): the gates run on push and manual dispatch
  only, never on a pull request.

- **A skipped gate still reports success, which is what the deploy condition demands.** The deploy
  runs under `always()` with explicit per-need results and requires `success` from each freshness gate
  by name; only a conditional test gate may be `skipped`
  (`MMCA.ADC/.github/workflows/deploy.yml:1342-1357`,
  `MMCA.Store/.github/workflows/deploy.yml:1257-1271`). Both repos allow it for the same two jobs,
  `e2e-gate` and `backend-test-gate`, which carry exactly complementary conditions
  over a code deploy (`ui == 'true'` against `ui != 'true'`,
  `MMCA.ADC/.github/workflows/deploy.yml:804,450`,
  `MMCA.Store/.github/workflows/deploy.yml:732,440`), so one of the two always runs and neither has to
  be made unconditional. ADC allows a third, `ai-eval-gate`, whose condition is `code == 'true'`, so on
  a code deploy it never actually skips and the skipped arm covers only the docs-only path the deploy
  itself does not take (`MMCA.ADC/.github/workflows/deploy.yml:502,1334-1337,1357`). Exiting 0 inside
  the step is what keeps break-glass compatible with that contract, and both repos say so in the
  comment above the condition
  (`MMCA.ADC/.github/workflows/deploy.yml:1329-1332`,
  `MMCA.Store/.github/workflows/deploy.yml:1245-1249`).

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
`deploy.needs` lists are no longer identical, because ADC carries `ai-eval-gate` and Store does not:
12 entries in ADC against 11 in Store (`MMCA.ADC/.github/workflows/deploy.yml:1310`,
`MMCA.Store/.github/workflows/deploy.yml:1229`). The four freshness gates and both complementary test
gates are common to the two lists, and each repo declares `backend-test-gate` with the identical
condition, the exact complement of its `e2e-gate`
(`MMCA.ADC/.github/workflows/deploy.yml:450`, `MMCA.Store/.github/workflows/deploy.yml:440`), so in
both repos precisely one of the two runs on any code deploy
(`MMCA.ADC/.github/workflows/deploy.yml:1355-1356`,
`MMCA.Store/.github/workflows/deploy.yml:1270-1271`). The
gate bodies themselves differ only in comments, messages and page size: Store gives the
skip-if-unchanged reason for reading jobs first and names neither the advisory job nor the incident
(`MMCA.Store/.github/workflows/deploy.yml:910-915` against
`MMCA.ADC/.github/workflows/deploy.yml:978-988`), ADC's broker failure messages cite its backlog
items TD-02 and TD-17 (`MMCA.ADC/.github/workflows/deploy.yml:1004,1012`), and the cross-browser gate
walks 40 completed `e2e.yml` runs per engine in ADC against 50 in Store
(`MMCA.ADC/.github/workflows/deploy.yml:1097`, `MMCA.Store/.github/workflows/deploy.yml:1017`).
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
**MMCA.Common has no deploy workflow either**: it ships `ci.yml` and `release.yml`, publishes packages
on a tag rather than deploying a service, and neither file contains a freshness gate.

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
  minutes but left nothing asserting those legs still passed, which is how both engines could sit red
  from 2026-08-24 while deploys kept shipping green
  (`MMCA.ADC/.github/workflows/deploy.yml:1018-1022`). A recency gate restores enforcement for two
  Actions API queries rather than by putting roughly forty minutes of browser time back on every UI
  deploy (`MMCA.ADC/.github/workflows/deploy.yml:1024-1027`).
- **A justified skip beats an undocumented one.** The alternative to break-glass is not "no skip," it
  is someone commenting the gate out or force-merging around it. Requiring a non-empty reason, then
  printing it in the step summary and as a run annotation, ties the decision to the exact deploy that
  shipped without it.
- **Windows are the cadence plus slack, not round numbers.** 8 days over a weekly cron, 35 over a
  monthly one, 5 over a weekday-only nightly, 10 over a weekly per-engine cron: each tolerates one
  missed or delayed run without tolerating a dead schedule. Store's comment states the boundary
  explicitly for the newest window: 7 plus 1 would red the deploy on any single-week hiccup, and a
  wider one would let an engine rot for two full cycles (`MMCA.Store/.github/workflows/deploy.yml:961-964`).

## Trade-offs
- **An unrelated stale proof blocks an unrelated deploy.** A one-line hotfix does not ship when the
  monthly k6 cron did not fire, and the failure surfaces after merge: the gate job goes red and
  `deploy` is left skipped by its explicit per-need condition
  (`MMCA.ADC/.github/workflows/deploy.yml:1349-1352`,
  `MMCA.Store/.github/workflows/deploy.yml:1264-1267`). The coupling is deliberate, and the cost is a
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
  `-gt` (`MMCA.ADC/.github/workflows/deploy.yml:858-862`,
  `MMCA.Store/.github/workflows/deploy.yml:789-793`), so a proof up to a day older than the stated
  number still passes.
- **The job-reading gates scan a bounded history.** The broker gate walks at most the 25 most recent
  completed runs (`MMCA.ADC/.github/workflows/deploy.yml:1001`,
  `MMCA.Store/.github/workflows/deploy.yml:928`) and the cross-browser gate at most 40 in ADC and 50 in
  Store (`MMCA.ADC/.github/workflows/deploy.yml:1097`,
  `MMCA.Store/.github/workflows/deploy.yml:1017`); past that they report "no successful run found,"
  which fails closed but reads as "never ran" rather than "not recently." Each scanned run also costs
  a second API call for its jobs, and the cross-browser gate pays that per engine.
- **No pull-request signal.** Because the gates are push-only, a contributor cannot learn from the PR
  that a proof is about to be stale; the discovery happens on the post-merge deploy run.

## Related
ADR-009 (states the recovery objectives and requires that a restore be drilled and recorded; this
record decides that a deploy is blocked on how recently that drill, and the capacity and broker proofs
beside it, actually happened), ADR-057 (the sibling CI-gate record, which constrains migration shape
and is explicitly a pull-request merge gate rather than a deploy gate).
