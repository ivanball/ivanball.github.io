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

## Context
A production rollout in both deployed apps waits on a list of jobs in `deploy.needs`
(`MMCA.ADC/.github/workflows/deploy.yml:1054`, `MMCA.Store/.github/workflows/deploy.yml:999`). Most of
those jobs have the change itself as their subject: a supply-chain audit (ADR-038), a FinOps
cost check, a chromium end-to-end run against the booted stack. They answer "is this build good."

Three kinds of verification cannot answer that question inside a deploy, because they cannot run
inside one. A point-in-time restore takes minutes and provisions a real Azure database
(`MMCA.ADC/.github/workflows/dr-drill.yml:3-5`, `MMCA.Store/.github/workflows/dr-drill.yml:3-5`). A k6
load run drives sustained traffic at production read endpoints
(`MMCA.ADC/.github/workflows/load-test.yml:3-6`). The Testcontainers broker round-trip needs a Docker
daemon that the gating jobs deliberately do not have
(`MMCA.ADC/.github/workflows/deploy.yml:810-811`). Each therefore lives on its own schedule: weekly
Monday for the drill (`dr-drill.yml:32`, Store `:34`), monthly for the load test
(`load-test.yml:18` in both repos), weeknights for the broker tier
(`MMCA.ADC/.github/workflows/cross-service-tests.yml:31`,
`MMCA.Store/.github/workflows/cross-service-tests.yml:35`).

ADR-009 requires that those objectives exist and that a restore be **drilled**: its DR doc carries a
drill-result table "that cannot stay empty." It says nothing about age. A drill recorded in March and
a drill recorded last Monday read identically in a document, and a scheduled workflow that has been
silently failing for six weeks still leaves a green-looking history behind it. Nothing decided what a
deploy should do when the newest proof is old. ADR-057, the other CI-gate record, is explicitly a
pull-request merge gate over migration shape and covers none of this.

## Decision
A production deploy is blocked not only on green tests but on **proof of recency** for out-of-band
verification: three gates assert that a real drill, a real load run and a real broker round-trip
happened recently enough to still mean something.

- **Three recency jobs sit in `deploy.needs` beside the result-based gates.** `dr-freshness`,
  `load-freshness` and `cross-service-freshness` are listed with `supply-chain`, `cost-guard`,
  `e2e-gate`, `foundation` and `build-images`, plus `backend-test-gate` in ADC only
  (`MMCA.ADC/.github/workflows/deploy.yml:1054`, `MMCA.Store/.github/workflows/deploy.yml:999`). Each
  is a five-minute `ubuntu-latest` job holding `actions: read` and `contents: read` only
  (`MMCA.ADC/.github/workflows/deploy.yml:699-705,756-762,815-821`,
  `MMCA.Store/.github/workflows/deploy.yml:657-663,714-720,770-776`).

- **Each gate asks the Actions API for the newest success of one workflow and fails on its age.** The
  window is a job-level `FRESHNESS_DAYS`: `8` for the weekly DR drill
  (`MMCA.ADC/.github/workflows/deploy.yml:707`, `MMCA.Store/.github/workflows/deploy.yml:665`), `35`
  for the monthly k6 run (`:764` / `:722`), `5` for the weekday-nightly broker tier (ADC `:825`, Store
  `:780`, widened from 3 on 2026-07-18 to tolerate a weekend or holiday, a note carried at
  `:823-824` in ADC and `:778-779` in Store). The DR and load
  gates read `workflow_runs[0].updated_at` from a `status=success&per_page=1` query against
  `dr-drill.yml` and `load-test.yml` respectively
  (`MMCA.ADC/.github/workflows/deploy.yml:734-736,791-793`,
  `MMCA.Store/.github/workflows/deploy.yml:692-694,747-749`), compute the age in whole days and exit 1
  when it exceeds the window
  (`MMCA.ADC/.github/workflows/deploy.yml:741-748,798-805`,
  `MMCA.Store/.github/workflows/deploy.yml:699-706,754-761`).

- **Absence fails; it does not pass.** An empty result (no successful run at all) prints an error
  naming the workflow to dispatch and exits 1, in every one of the three gates
  (`MMCA.ADC/.github/workflows/deploy.yml:737-740,794-797,884-887`,
  `MMCA.Store/.github/workflows/deploy.yml:695-698,750-753,834-837`); Store's broker message is the
  same sentence without the `(TD-02 / TD-17)` suffix ADC carries.

- **The broker gate keys off the jobs, not the run conclusion.** It enumerates completed runs of
  `cross-service-tests.yml` (any conclusion, 25 per page) and, for each, asks the jobs API which of
  the named broker jobs concluded `success`, stopping at the first run where all of them did
  (`MMCA.ADC/.github/workflows/deploy.yml:874`, gate job `:815`; the Store gate enumerates the same
  job names in `MMCA.Store/.github/workflows/deploy.yml`). Two jobs are required in both repos as of
  2026-08-31 (ADC, TD-17) and immediately after in Store: `cross-service`, the Testcontainers RabbitMQ
  outbox to broker to consumer round-trip, and `servicebus-emulator-smoke`, the Azure Service Bus
  emulator topology plus AMQP round-trip, so the production transport is a deploy precondition too
  (ADR-066). The reasoning for reading jobs rather than the run is recorded inline in both repos: a
  skip-if-unchanged guard can make a run conclude `success` with the test jobs skipped and no
  round-trip executed, and a still-advisory job in the same workflow (`apphost-smoke`) can fail or
  hang so the run concludes `failure` or `cancelled` although both proofs passed
  (`MMCA.ADC/.github/workflows/deploy.yml:850-869`). The ADC comment names the incident that forced
  break-glass while the emulator job was hanging, 2026-07-21 to 07-24
  (`MMCA.ADC/.github/workflows/deploy.yml:864`).

- **Break-glass exists as a dispatch input pair and refuses to fire without a written reason.**
  `workflow_dispatch` carries `skip_freshness_gates` (boolean, default `false`) and
  `skip_justification` (string, default empty)
  (`MMCA.ADC/.github/workflows/deploy.yml:8-20`, `MMCA.Store/.github/workflows/deploy.yml:8-20`).
  Every gate reads both into its step environment
  (`MMCA.ADC/.github/workflows/deploy.yml:712-713,769-770,830-831`,
  `MMCA.Store/.github/workflows/deploy.yml:670-671,727-728,785-786`) and, when the flag is true with
  an empty justification, emits `::error::` and exits 1
  (`MMCA.ADC/.github/workflows/deploy.yml:717-721`,
  `MMCA.Store/.github/workflows/deploy.yml:675-679`). With a justification it writes a headed
  break-glass block plus the reason to the step summary, raises a `::warning::` annotation carrying
  the same text, and exits 0 (`MMCA.ADC/.github/workflows/deploy.yml:722-730`,
  `MMCA.Store/.github/workflows/deploy.yml:680-688`). One input governs all three gates.

- **The skip path is unreachable on a push.** `inputs` is empty outside a dispatch, so
  `${SKIP_GATES:-false}` reads `false` (`MMCA.ADC/.github/workflows/deploy.yml:717`,
  `MMCA.Store/.github/workflows/deploy.yml:675`), and every gate additionally carries
  `if: github.event_name != 'pull_request'`
  (`MMCA.ADC/.github/workflows/deploy.yml:702,759,818`,
  `MMCA.Store/.github/workflows/deploy.yml:660,717,773`): the gates run on push and manual dispatch
  only, never on a pull request.

- **A skipped gate still reports success, which is what the deploy condition demands.** The deploy
  runs under `always()` with explicit per-need results and requires `success` from each freshness gate
  by name; only a conditional test gate may be `skipped`
  (`MMCA.ADC/.github/workflows/deploy.yml:1080-1093`,
  `MMCA.Store/.github/workflows/deploy.yml:1026-1039`). Both repos allow it for the same two jobs,
  `e2e-gate` and `backend-test-gate`, which carry exactly complementary conditions
  over a code deploy (`ui == 'true'` against `ui != 'true'`,
  `MMCA.ADC/.github/workflows/deploy.yml:396,688`,
  `MMCA.Store/.github/workflows/deploy.yml:349,645`), so one of the two always runs and neither has to
  be made unconditional. Exiting 0 inside the step is what keeps break-glass compatible with that
  contract, and both repos say so in the comment above the condition
  (`MMCA.ADC/.github/workflows/deploy.yml:1072`, `MMCA.Store/.github/workflows/deploy.yml:1014-1018`).

- **Deploy-time only, and deliberately not a required merge check.** Both repos document the freshness
  gates as push-only jobs that run after merge and must not be added to branch protection, since a job
  that never runs on a pull request would block every merge
  (`MMCA.ADC/CONTRIBUTING.md:42-44,111-113`, `MMCA.Store/CONTRIBUTING.md:43-44,118-120`). In both
  files the push-only half is the earlier passage and the "do not require these jobs" sentence is the
  later one. Store's enumeration
  at `CONTRIBUTING.md:43-44` names only `dr-freshness` and `load-freshness`; the generic sentence at
  `:118-120` is what covers `cross-service-freshness` there.

**Adoption is the two deployed apps, and the deploy condition around the gates is now the same shape
in both.** Each repo's `deploy.needs` carries the same ten entries, `backend-test-gate` among them
(`MMCA.ADC/.github/workflows/deploy.yml:1054`, `MMCA.Store/.github/workflows/deploy.yml:999`), and
each declares that job with the identical condition, the exact complement of its `e2e-gate`
(`MMCA.ADC/.github/workflows/deploy.yml:394`, `MMCA.Store/.github/workflows/deploy.yml:347`). So in
both repos the deploy condition tolerates `skipped` from exactly two conditional test gates, of which
precisely one runs on any code deploy (`MMCA.ADC/.github/workflows/deploy.yml:1092-1093`,
`MMCA.Store/.github/workflows/deploy.yml:1038-1039`). The
gate bodies themselves differ only in comments and messages: Store gives the skip-if-unchanged reason
for reading jobs first and names neither the advisory job nor the incident
(`MMCA.Store/.github/workflows/deploy.yml:805-819` against
`MMCA.ADC/.github/workflows/deploy.yml:850-869`), and ADC's broker failure messages cite its backlog
items TD-02 and TD-17 (`MMCA.ADC/.github/workflows/deploy.yml:885,893`). **MMCA.Helpdesk has no
deploy pipeline at all**: its `.github/workflows/` holds four files, `ci.yml`, the two Claude
workflows, and `release-templates.yml`, and the fourth publishes the MMCA.Templates `dotnet new` pack
to nuget.org on a `templates-v*` tag rather than rolling anything out
(`MMCA.Helpdesk/.github/workflows/release-templates.yml:3,17`). `ci.yml` runs two jobs and neither has
an Azure step: `build-and-test` builds and tests against MMCA.Common source
(`MMCA.Helpdesk/.github/workflows/ci.yml:14-60`) and `template-smoke` packs the template, generates an
app and builds it through `build/templates/smoke.ps1`
(`MMCA.Helpdesk/.github/workflows/ci.yml:76-89`). There is no rollout for a recency gate to block.
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
- **Job-level truth for the broker gate.** The run conclusion is wrong in both directions here (a
  skipped-but-green run, a failed-but-proven run), so the only honest signal is whether the specific
  job that performs the round-trip actually ran and passed. Keying off the cheaper signal would have
  produced both a false pass and a deploy-blocking false red.
- **A justified skip beats an undocumented one.** The alternative to break-glass is not "no skip," it
  is someone commenting the gate out or force-merging around it. Requiring a non-empty reason, then
  printing it in the step summary and as a run annotation, ties the decision to the exact deploy that
  shipped without it.
- **Windows are the cadence plus slack, not round numbers.** 8 days over a weekly cron, 35 over a
  monthly one, 5 over a weekday-only nightly: each tolerates one missed or delayed run without
  tolerating a dead schedule.

## Trade-offs
- **An unrelated stale proof blocks an unrelated deploy.** A one-line hotfix does not ship when the
  monthly k6 cron did not fire, and the failure surfaces after merge: the gate job goes red and
  `deploy` is left skipped by its explicit per-need condition
  (`MMCA.ADC/.github/workflows/deploy.yml:1087-1089`,
  `MMCA.Store/.github/workflows/deploy.yml:1033-1035`). The coupling is deliberate, and the cost is a
  blocked rollout at whatever moment the schedule happened to lapse.
- **Break-glass is auditable but human-judged.** Only non-emptiness is checked: nothing rates the
  reason, there is no second approver, no expiry and no tracked follow-up beyond the step-summary
  sentence telling the operator to re-run the workflow. One input also skips all three gates at once,
  so a deploy forced past a broken broker nightly silently forgoes the DR and capacity proofs too.
- **Recency is not relevance.** The DR drill rotates across the live per-service databases by ISO week
  (four in ADC, three in Store), so a "fresh" recovery proof may belong to a database this deploy does
  not touch (`MMCA.ADC/.github/workflows/dr-drill.yml:7-11`,
  `MMCA.Store/.github/workflows/dr-drill.yml:7-13`). The same applies to the other two: the newest k6
  run and the newest round-trip proved an earlier commit, not this one.
- **Whole-day arithmetic widens every window.** The age is integer division by 86400 compared with
  `-gt` (`MMCA.ADC/.github/workflows/deploy.yml:741-743`,
  `MMCA.Store/.github/workflows/deploy.yml:701-703`), so a proof up to a day older than the stated
  number still passes.
- **The broker gate scans a bounded history.** It walks at most the 25 most recent completed runs
  (`MMCA.ADC/.github/workflows/deploy.yml:882`, `MMCA.Store/.github/workflows/deploy.yml:832`); past
  that it reports "no successful run found," which fails closed but reads as "never ran" rather than
  "not recently."
- **No pull-request signal.** Because the gates are push-only, a contributor cannot learn from the PR
  that a proof is about to be stale; the discovery happens on the post-merge deploy run.

## Related
ADR-009 (states the recovery objectives and requires that a restore be drilled and recorded; this
record decides that a deploy is blocked on how recently that drill, and the capacity and broker proofs
beside it, actually happened), ADR-057 (the sibling CI-gate record, which constrains migration shape
and is explicitly a pull-request merge gate rather than a deploy gate).
