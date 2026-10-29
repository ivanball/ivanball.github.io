# ADR-062: SLO Alerting as Code with an Alert-to-Runbook Build Gate

## Status
Accepted (2026-08-01). Revised 2026-08-18: Store's two operational extras (the `outbox-dead-letter`
scheduled query rule and the outside-in Gateway availability web test with its severity 1 metric
alert) merged to `main` on 2026-08-13 and are recorded here as shipped rather than as in flight.
Revised 2026-08-23: both templates grew above the alert block, so every `main.bicep` citation is
re-anchored; two statements are corrected. Store's `OPERATIONS.md` does carry triage for its two
operational extras (under `####` headings, deliberately outside the gate's `###` match), and Store's
resource prefix is `mmca-`, not `store-`, which makes the heading-versus-deployed-name trade-off
wider than previously recorded. No decision changed.
Revised 2026-08-31: both templates dropped the superseded metric alert declarations entirely, so the
bullet that recorded them as "declared and disabled, never deleted", its Rationale entry, and the
carried-debt trade-off are rewritten around what actually keeps the supersede safe (the distinct
`-v2` names). Every `main.bicep` citation is re-anchored again. No decision changed.
Revised 2026-09-01: ADC's `infra/OPERATIONS.md` gained the same `## Operational alert runbooks`
section Store carries, with a `####` heading per ungated alert family it provisions, so the coverage
boundary paragraph and the trade-off that cited Store's triage alone are rewritten around both
consumers. The gate still scopes to the `sloAlertSpecs` window by design and the honour-system caveat
still applies to every `####` section. No decision changed.
Revised 2026-09-03: both consumers now provision a `revision-activation-failed` alert outside the
spec window, and both templates moved the SLO rules and the gateway web test
to a 15-minute cadence, so the coverage-boundary paragraph, the alert counts and the
evaluation-frequency statement are rewritten around what the templates declare today. Store's runbook
carries the matching `####` section and ADC's does not, so the honour-system trade-off is recorded as
one being paid rather than as a hypothetical. The framework base and its cross-assembly guard moved
into `Governance/` subfolders, and every `main.bicep` and `OPERATIONS.md` citation is re-anchored. The
trade-off that described ADC's runbook headings as dropping the environment segment and the `-v2`
suffix is corrected: they spell the deployed production name out in full. No decision changed.
Revised 2026-09-07 (a security-signal rule and an ingestion-cap rule join the SLO rules in Store,
which is what makes the deliberate 401 exclusion in the failure rules safe).
Revised 2026-09-11: the ungated space is now twelve alerts, six per consumer, and triage exists for
nine of them (Store six of six, ADC three of six), so the coverage-boundary paragraph, the triage
paragraph and the ungated trade-off are rewritten around what the templates and runbooks hold today.
The 2026-09-07 revision recorded two new Store rules where three landed, and its closing line had the
gate backwards: those rules are declared outside the `sloAlertSpecs` window, so the gate neither
requires nor forbids their runbook sections. ADC's `failed-requests` query now also excludes crawler
404s, so "only 401 and 499" is true of Store and of ADC's dependency rule, not of all of them.
Store's runbook Governance section no longer counts the ungated alerts; ADC's still does, and
miscounts. Every `main.bicep` and `OPERATIONS.md` citation is re-anchored. No decision changed.
Revised 2026-09-19: both templates grew a fourth SLO spec, `resilience-circuit-open` (severity 2,
threshold 0 rows, fired by the first Polly `OnCircuitOpened` event in the window), and both runbooks
carry its `###` section, so every "three specs per consumer" statement is now four. Neither workbook
gained a panel for it and `MinimumAlertSpecs` stays at 3, both of which are recorded. ADC's runbook
also gained a `####` section for `ai-scoring-token-ceiling`, so ungated triage is ten of twelve
rather than nine, and the two ADC families still without triage are `revision-activation-failed` and
`log-ingestion-cap-reached`. No decision changed.
Revised 2026-09-25: ADC's `ai-scoring-token-ceiling` rule is a fifth `sloAlertSpecs` entry, so ADC's
gate covers five specs and Store's four, and each consumer's test subclass raises `MinimumAlertSpecs`
to its own count (5 and 4). ADC's spec loop takes per-spec cadence and `enabled` overrides, which the
AI ceiling uses. The ungated space is eleven alerts (ADC five, Store six), and every one of the eleven
has written `####` triage in its runbook. The coverage-boundary paragraph, the triage paragraph, the
floor bullets and the ungated trade-off are rewritten around what the templates and runbooks hold
today, and every `main.bicep` and `OPERATIONS.md` citation is re-anchored. No decision changed.
Revised 2026-10-01: both templates grew above the alert block, so every `main.bicep` citation in the
current-state sections is re-anchored. No decision changed.
Revised 2026-10-06: the framework base now ships a fourth, opt-in fact (`RequireWorkbook`, enabled
only by MMCA.Common's own deployment-sample subclass), the latency predicate and the Common adoption
boundary are stated as the code has them, and every ADC citation is re-anchored. No decision changed.
Revised 2026-10-07: ADC's `scheduledQueryAlertSpecs` gained `signalr-backplane-errors`, so the
ungated space is twelve alerts (six per consumer) with triage for eleven, ADC's runbook having no
section for the new rule; ADC anchors and both Governance anchors are re-pointed.
Revised 2026-10-10: both consumers moved 404 and 429 out of `failed-requests` into a new severity 3
`request-rejections` spec (more than 50 per 15 minutes, crawler `/robots.txt` and `/sitemap.xml`
probes excluded), and `dependency-failures` now also drops the rows of any operation whose request
answered 499, after ADC paged on 10/6, 10/9 and 10/10 on scanner and crawler 404/429 bursts and on
10/10 on 499-cancelled dependency rows. ADC's gate covers six specs and Store's five, each subclass
raises `MinimumAlertSpecs` to match (6 and 5), and both runbooks carry the new `###` section. This
supersedes the 2026-09-11 line that "only 401 and 499" is true of Store and of ADC's dependency rule
(every `failed-requests` query now excludes 401, 404, 429 and 499, and both dependency rules add the
499-operation anti-join), the "four SLOs", "five specs and Store's four" and `MinimumAlertSpecs`
(5 and 4) counts carried since 2026-09-19 and 2026-09-25, and the 2026-10-07 note that ADC's runbook
preamble and Governance caveat count five ungated alerts (both now count six, five with triage).
Store's template comment no longer says it has no 429 rule because `failed-requests` counts 429:
`request-rejections` covers that volume, overlapping the `auth-failure-spike` rule on `/Auth` by
accepted design. Every `main.bicep` and `OPERATIONS.md` citation is re-anchored. No decision changed.
Revised 2026-10-11: both consumers' `server-response-time` query now skips any window in which a
Container Apps revision was created or took traffic, after Store paged at 3,067 ms on 10/10 from
five post-deploy probe rows (the 5-row floor alone did not stop it). Both templates gained the
reasoning above `sloAlertSpecs` and both runbooks a deploy-skip note in the latency triage step, so
every `main.bicep` citation past those lines and every `OPERATIONS.md` citation past line 53 is
re-anchored. No decision changed.
Revised 2026-10-19: ADC gains the two security-signal rules Store already had (`auth-failure-spike`, `forbidden-burst`), its ingestion rule also matches `ApproachingQuota`, and its runbook gains the missing `signalr-backplane-errors` triage, so the ungated space is sixteen alerts (ADC nine, Store seven, `broker-error-queue` now on both) with triage for all sixteen; `RequireWorkbook` is recorded as on by default. No decision changed.
Revised 2026-10-21: the runbook pairing is recorded as the whole-token heading match the base ships (an optional `-v<digits>` suffix, no `-p99`-style continuation), the stale "opt-in, neither consumer turns it on" workbook wording is corrected, and every Store `main.bicep`, ADC gateway/workbook/budget and base-file citation is re-anchored.
Revised 2026-10-26: ADC's ungated space grows to twelve alerts (`outbox-backlog-age`, `outbox-broker-circuit-open` and `live-broadcast-dropped` join its `scheduledQueryAlertSpecs` array), so the fleet's is nineteen, all with triage, while ADC's runbook preamble and Governance caveat still count nine; the one-gap asymmetry statement is corrected and the ADC and Store anchors are re-pointed.
Revised 2026-10-28: ADC's runbook preamble and Governance caveat now count twelve operational alerts, all with triage, so the 2026-10-26 "still count nine" statement and the second honour-system miss it recorded are withdrawn, and the ADC `OPERATIONS.md` triage and Governance anchors are re-pointed. No decision changed.
## Context
ADR-041 standardized what the fleet **emits**: RED histograms off the CQRS pipeline, an outbox
dead-letter counter, correlation ids, exporters, and the cost knobs that keep ingestion affordable.
It stops at emission. Which of those signals wakes a human, at what threshold, at what severity, and
what that human does next were decided in the deployment templates and in an operations runbook, with
no record. ADR-009 is adjacent but different: it fixes RTO/RPO, the restore mechanism, and the drilled
`infra/DISASTER-RECOVERY.md`, which is the **recovery** contract, not the **detection** one.

Three forces shaped the decision.

1. **Portal-defined alerts drift.** An alert clicked together in the portal is invisible to review,
   absent from the next environment, and impossible to diff. An alert wired to no notification channel
   is worse than no alert: it looks like coverage and pages nobody.
2. **An alert without triage is a page with no next step**, and a runbook section for an alert that no
   longer exists is stale guidance an operator will follow at 3am. Both directions rot silently,
   because nothing compares the two files.
3. **A metric alert cannot express a predicate.** The original metric alerts on `requests/failed`,
   `requests/duration` and `dependencies/failed` paged on routine traffic: 401 (expired or absent auth)
   and 499 (client disconnected) both count as failed requests, and a long-lived SignalR hub connection
   reports its **connection lifetime** as request duration. On ADC every page on 2026-07-24 and
   2026-07-29 resolved to exactly that, one window holding 8x401 plus 2x499 plus a single readiness 503
   and zero other failures, and five hub connections averaging 11.3s dragged the fleet-wide average to
   5539ms against a 3000ms threshold while every real request was fast
   (`MMCA.ADC/infra/main.bicep:374-407`, the 401/499 page at `:379-382`, the hub lifetime at
   `:383-385`).

## Decision
Declare each consumer's SLO alerts as **data in its Bicep template**, materialize them as Log Analytics
scheduled query rules, and make the alert-to-runbook pairing a **build gate shipped by the framework**.

- **`sloAlertSpecs` is the declaration.** A single array of records carrying `key`, `description`,
  `query`, `timeAggregation`, `metricMeasureColumn`, `threshold` and `severity`
  (`MMCA.ADC/infra/main.bicep:408`, `MMCA.Store/infra/main.bicep:331`). Both consumers declare the same
  five SLOs with the same numbers: `failed-requests` (severity 2, more than 10 per 15 min),
  `request-rejections` (severity 3, more than 50 per 15 min), `server-response-time` (severity 3,
  average above 3000ms), `dependency-failures` (severity 2, more than 10 per 15 min)
  (`MMCA.ADC/infra/main.bicep:409-444`, `MMCA.Store/infra/main.bicep:332-367`),
  and `resilience-circuit-open` (severity 2, more than 0 rows), which fires on the first Polly
  `OnCircuitOpened` event a service reports in the window rather than on a rate, because an open
  breaker is already the failure mode the retry budget was meant to absorb
  (`MMCA.ADC/infra/main.bicep:448-456`, reasoning at `:445-447`;
  `MMCA.Store/infra/main.bicep:371-379`, reasoning at `:368-370`). ADC declares a sixth, ADC-only
  spec, `ai-scoring-token-ceiling` (severity 3, a rolling two-day provider token total above the
  `aiScoringTokenCeiling` parameter), and declares it inside the array precisely so the gate covers
  it (`MMCA.ADC/infra/main.bicep:494-506`, reasoning at `:457-493`, the in-array placement at
  `:457-461`).

- **Materialized as Log Analytics scheduled query rules.** One `Microsoft.Insights/scheduledQueryRules`
  per spec (`MMCA.ADC/infra/main.bicep:509`, `MMCA.Store/infra/main.bicep:382`), named
  `${prefix}-alert-${spec.key}-v2` (`MMCA.ADC/infra/main.bicep:513`,
  `MMCA.Store/infra/main.bicep:387`), scoped to the Log Analytics workspace, and by default enabled and
  evaluated every 15 minutes over a 15-minute window with `autoMitigate`
  (`MMCA.Store/infra/main.bicep:394`, `:403-405`). Store pins those four values for every spec. ADC
  reads each from the spec and falls back to the same defaults (`enabled` at
  `MMCA.ADC/infra/main.bicep:527`, `evaluationFrequency`, `windowSize` and `autoMitigate` at
  `:540-544`, reasoning at `:535-538`), because one spec needs different values: the AI ceiling
  evaluates a two-day window every twelve hours and switches itself off when no AI key is deployed
  (`:502-505`). For every other spec evaluation frequency equals window size, so consecutive windows
  tile instead of overlapping: each rule still reads the same 15 minutes of data against the same
  threshold, and what the cadence trades is billed evaluations against worst-case detection latency.
  Both templates state the billing half inline and Store's comment also states the latency half
  (`MMCA.ADC/infra/main.bicep:529-533`, `MMCA.Store/infra/main.bicep:396-402`). A `union(...)` supplies `metricMeasureColumn` only for an
  aggregate rule; the empty-string case makes a rule count returned **rows**, which is what the
  row-count SLOs want (`MMCA.ADC/infra/main.bicep:547-562`, `MMCA.Store/infra/main.bicep:411-423`).

- **The KQL predicate is the point of the migration.** Both consumers' `failed-requests` query
  excludes 401, 404, 429 and 499 (`MMCA.ADC/infra/main.bicep:412`, `MMCA.Store/infra/main.bicep:335`).
  404 and 429 are the volume a scanner, crawler or rate limiter produces with no fault behind it,
  which on ADC paged on 10/6, 10/9 and 10/10 (`MMCA.ADC/infra/main.bicep:389-393`), so
  `request-rejections` watches them separately at a volume threshold and drops the crawler probes for
  `/robots.txt` and `/sitemap.xml` (`MMCA.ADC/infra/main.bicep:421`, `MMCA.Store/infra/main.bicep:344`;
  the robots/sitemap page that first prompted that exclusion is recorded at
  `MMCA.ADC/infra/main.bicep:386-388`). Both `dependency-failures` queries exclude 401 and 499 and
  also anti-join away every row of an operation whose request answered 499, because a dependency call
  cancelled by a disconnecting caller logs `ResultCode` 0 with a `TaskCanceledException`, never 499
  (`MMCA.ADC/infra/main.bicep:439`, reasoning at `:394-396`; `MMCA.Store/infra/main.bicep:362`,
  reasoning at `:318-320`); a timeout with no 499 parent still counts
  (`MMCA.ADC/infra/main.bicep:400-401`). The latency
  query excludes `/hubs/` requests, `ResultCode` 101 (a hub or Blazor circuit connection, whose
  duration is its lifetime) and requests with no `Url` (background consumer spans), and averages
  `DurationMs` only when the window holds at least 5 requests, so a single cold request cannot page
  (`MMCA.ADC/infra/main.bicep:430`, described at `:429`; `MMCA.Store/infra/main.bicep:353`, described
  at `:352`). It also skips any window in which `ContainerAppSystemLogs_CL` records a
  `RevisionCreation` or `RevisionUpdate`, because during a rollout the post-deploy probes alone
  supply the 5 rows and one of them is a cold first request; a release that stays slow pages in the
  next window (reasoning at `MMCA.ADC/infra/main.bicep:402-407` and
  `MMCA.Store/infra/main.bicep:326-330`). A genuine 400 or 500 burst still pages at the same
  threshold as before.

- **The superseded metric alerts are no longer declared, and the `-v2` names stay.** Neither template
  carries a `legacySloMetricAlertSpecs` array or a metric alert on `requests/failed`,
  `requests/duration` or `dependencies/failed`. The only `Microsoft.Insights/metricAlerts` resource
  left in each is the unrelated severity 1 gateway-availability alert, which stays because
  availability has no status-code confound and never produced a false page
  (`MMCA.ADC/infra/main.bicep:915`, severity at `:921`;
  `MMCA.Store/infra/main.bicep:783`, severity at `:789`). The `-v2` suffix on
  the replacements is what made that removal safe and is now part of each rule's identity in Azure:
  renaming it would create a second rule alongside the live one rather than update it, and the
  unsuffixed names stay occupied in the resource group by the superseded alerts, which an incremental
  ARM deployment does not delete just because they left the template
  (`MMCA.ADC/infra/main.bicep:511-512`, `MMCA.Store/infra/main.bicep:384-386`).

- **One unconditional action group.** `alertEmailAddress` is a required parameter with no default
  (`MMCA.ADC/infra/main.bicep:124`, `MMCA.Store/infra/main.bicep:95`), so the action group's email
  receiver is not conditional (`MMCA.ADC/infra/main.bicep:358-372`, its receiver at `:364-370`;
  `MMCA.Store/infra/main.bicep:289`, its receiver at `:295-301`) and every scheduled query rule routes to it
  (`MMCA.ADC/infra/main.bicep:566`, `MMCA.Store/infra/main.bicep:427`). The monthly cost budget
  notifies the same group (`MMCA.ADC/infra/main.bicep:975`, `contactGroups` at `:991`, `:999`;
  `MMCA.Store/infra/main.bicep:845`, `contactGroups` at `:861`, `:869`).

- **A saved workbook renders three of the SLO signals.** `sloWorkbook`
  (`MMCA.ADC/infra/main.bicep:954`, `MMCA.Store/infra/main.bicep:824`) is bound to the Log Analytics
  workspace and embeds `workbooks/adc-slo-workbook.json` / `workbooks/store-slo-workbook.json` at
  compile time via `loadTextContent` (`MMCA.ADC/infra/main.bicep:963`,
  `MMCA.Store/infra/main.bicep:833`), grouped per service by `AppRoleName`, so the visualization cannot
  diverge from the alerts by being maintained somewhere else. Both workbooks carry the same five
  panels, covering requests and failures, response-time percentiles and dependency calls and
  failures; neither has a panel for `resilience-circuit-open` or for `request-rejections` (neither
  workbook queries `ResultCode`), and ADC's has none for its AI token
  ceiling, so those specs page without a matching view
  (`MMCA.ADC/infra/workbooks/adc-slo-workbook.json`, which mentions neither
  `resilience.polly.strategy.events` nor the `mmca.ai` counters, and
  `MMCA.Store/infra/workbooks/store-slo-workbook.json`). Nothing gates that pairing: the build gate
  pairs alerts with runbook sections, not with workbook panels. Its workbook fact (below), on by
  default and not overridden by either consumer, checks only that a workbook or dashboard resource
  exists.

- **`infra/OPERATIONS.md` is the paired artifact.** Each repo's runbook carries one `###` section per
  SLO alert whose heading names the alert as a whole token (the `-alert-<key>` infix, an optional
  `-v<digits>` suffix, then the end of the heading, whitespace, `(` or a backtick) and carries the
  alert's severity as `(sev N)`
  (`MMCA.ADC/infra/OPERATIONS.md:17`, `:50`, `:71`; `MMCA.Store/infra/OPERATIONS.md:17`, `:50`, `:75`),
  each followed by numbered triage steps. Both runbooks carry the sections the `request-rejections`
  and `resilience-circuit-open` specs require (`MMCA.ADC/infra/OPERATIONS.md:33` and `:88`,
  `MMCA.Store/infra/OPERATIONS.md:34` and `:93`), tagged `(sev 3)` and `(sev 2)` to match, and ADC's
  carries a sixth for its AI token ceiling (`MMCA.ADC/infra/OPERATIONS.md:136`, tagged `(sev 3)`).
  Restore procedure is
  deliberately not duplicated here: the
  runbook defers it to `DISASTER-RECOVERY.md` (`MMCA.ADC/infra/OPERATIONS.md:4-6`,
  `MMCA.Store/infra/OPERATIONS.md:4-6`).

- **The pairing is enforced by a framework test base, and it fails the build.**
  `ObservabilityConventionTestsBase`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/ObservabilityConventionTestsBase.cs:30`)
  ships four facts:
  - `MonitoringWorkbookOrDashboard_IsProvisioned_WhenRequired` (`:67-79`) requires the template to
    declare a `Microsoft.Insights/workbooks` or `Microsoft.Portal/dashboards` resource
    (`MonitoringViewResourceRegex`, `:200-201`) whenever the virtual `RequireWorkbook` is true, which
    is the default (`:60`, since MMCA.Common v1.243.0); a subclass opts out by overriding it to false,
    and the fact then returns immediately. Neither ADC's nor Store's subclass overrides it, so the fact
    runs for both consumers, and both templates satisfy it (`MMCA.ADC/infra/main.bicep:954`,
    `MMCA.Store/infra/main.bicep:824`).
  - `SloAlertSpecs_AreDiscovered_GateIsNotVacuous` requires at least `MinimumAlertSpecs` discovered
    specs, default 3 (`ObservabilityConventionTestsBase.cs:39`, asserted at `:86-88`), so a drifted
    parse anchor fails loudly instead of passing with zero alerts. The property is virtual, and each
    consumer raises it to its own spec count (below), so the floor also catches a spec that goes
    missing, not only a parser that discovers nothing.
  - `EveryProvisionedSloAlert_HasASeverityCorrectRunbookSection` fails when a spec has no `###` heading
    naming `-alert-<key>` (`:91-117`, the infix constant at `:32`, the lookup at `:101`) **and**
    fails when the matching heading does not carry `(sev N)` for that spec's current severity
    (`:108-112`), so re-tiering an alert without moving its runbook is a red build.
  - `EveryRunbookAlertSection_MapsToAProvisionedAlert` fails on an orphan runbook section whose alert no
    longer exists (`:119-131`).
  Both pairing facts match a heading through one predicate, `HeadingNamesAlert` (`:168-178`), whose
  pattern (`:175`) requires `-alert-<key>`, then an optional `-v<digits>`, then the end of the
  heading, whitespace, `(` or a backtick. A plain substring test would let a `server-response-time-p99`
  section answer for `server-response-time`, or hide an orphan `x-extra` section behind a surviving
  `x` alert; the framework pins that whole-token match with its own cases
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/ObservabilityConventionTestsBaseTests.cs:38-61`).
  Discovery parses the template between the literal anchors `var sloAlertSpecs` and
  `resource sloAlerts` (`:135-138`) with two source-generated regexes (`:191-195`), and a key-count
  versus severity-count mismatch is itself a failure (`:145`), so a change to the spec shape cannot
  quietly desynchronize the parser.

- **Consumers wire it with an embedded-resource pair and a one-override subclass.** The base reads
  `infra.main.bicep` and `infra.OPERATIONS.md` (`ObservabilityConventionTestsBase.cs:42`, `:45`) from
  `ResourceAssembly`, which defaults to the **derived** type's assembly (`:51`); resolving against the
  base's own assembly would look for the consumer's template inside the framework package and always
  throw. Each consumer embeds the two real files under those logical names
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/MMCA.ADC.Architecture.Tests.csproj:25-30`,
  `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/MMCA.Store.Architecture.Tests.csproj:16-21`)
  and declares a subclass whose only member raises `MinimumAlertSpecs` to that consumer's spec count:
  6 for ADC
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/ObservabilityConventionTests.cs:7`,
  the override at `:14`) and 5 for Store
  (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Governance/ObservabilityConventionTests.cs:7`,
  the override at `:13`). Both test projects are in the CI solution filter
  (`MMCA.ADC/MMCA.ADC.CI.slnf:59`, `MMCA.Store/MMCA.Store.CI.slnf:53`), so the gate runs in the same
  deploy-gating test job as the rest of the fitness tier.

- **The framework guards its own indirection.** `ObservabilityConventionTestsBaseTests`
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/ObservabilityConventionTestsBaseTests.cs:14`)
  subclasses the base from a different assembly, re-points it at a fixture template and runbook
  (`:16-18`), and asserts `ResourceAssembly` is the derived assembly and not the base's (`:27-28`). The
  regression it exists for is silent: framework CI would stay green and the break would surface only in
  the first consumer that adopted the gate.

**Adoption boundary.** ADC and Store only. MMCA.Helpdesk does **not** subclass this base and has no
`infra/*.bicep` at all, so there is nothing for the gate to pair; it is not an un-adopted gate there,
it is an inapplicable one. MMCA.Common runs the base twice: against its own fixture pair, and through
`SampleDeploymentObservabilityTests` against the framework's deployment sample, `samples/deployment`
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/SampleDeploymentObservabilityTests.cs:12`,
embedded at
`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/MMCA.Common.Architecture.Tests.csproj:39-43`),
which sets `MinimumAlertSpecs` to 4 (`:20`) and states `RequireWorkbook` as true explicitly (`:24`),
the same value every subclass now inherits. It runs against a sample template, not a deployed environment.

**Coverage boundary inside the templates.** The gate covers exactly the alerts declared between the two
parse anchors: six specs on ADC (the five shared SLOs plus `ai-scoring-token-ceiling`) and five on
Store. Nineteen further alerts sit outside that window, twelve on ADC and seven on Store. ADC
provisions an eight-entry `scheduledQueryAlertSpecs` array (`MMCA.ADC/infra/main.bicep:624`, keys
`outbox-dead-letter` at `:626`, `sql-dependency-failures` at `:632`, `revision-activation-failed`
at `:638`, `signalr-backplane-errors` at `:644`, the last watching warning-or-above lines from
the Notification service's SignalR Redis backplane logger, `broker-error-queue` at `:650`,
`outbox-backlog-age` at `:656` (an outbox row waiting more than 15 minutes for dispatch),
`outbox-broker-circuit-open` at `:662` and `live-broadcast-dropped` at `:668` (Engagement dropping
a live-channel broadcast under backpressure), all materialized by one loop at `:675` and pinned to
severity 2 at `:682`), a `log-ingestion-cap-reached` rule (`:729`, severity 2 at `:736`) whose query
matches `ApproachingQuota` as well as `OverQuota` (`:745`), `auth-failure-spike` (`:797`, severity 2
at `:804`), `forbidden-burst` (`:836`, severity 3 at `:843`), and a severity 1 gateway-availability
metric alert over a three-location Standard availability web test (`:882`, `kind: 'standard'` at
`:888`, alert at `:915`, severity at `:921`).
Store provisions seven as standalone resources rather than from an array: the `outbox-dead-letter`
scheduled query rule (`MMCA.Store/infra/main.bicep:450`, severity 2 at `:457`), `broker-error-queue`
(`:498`, severity 2 at `:505`), the `revision-activation-failed` rule over
`ContainerAppSystemLogs_CL` (`:548`, severity 2 at `:555`) that closes the gap where a revision whose
readiness never went green left the previous revision serving and paged nobody,
`auth-failure-spike` (`:616`, severity 2 at `:623`), which can page alongside `request-rejections`
on a lockout storm on `/Auth`, an overlap the template records as accepted (`:596-598`),
`forbidden-burst` (`:656`, severity 3 at `:663`), `log-ingestion-quota` (`:702`, severity 2 at
`:709`), and the outside-in Gateway availability web test (`:750`) with its severity 1 metric alert
(`:783`, severity at `:789`), alongside the five SLO rules and the budget notifications. No other
`infra/*.bicep` file in either repo declares a scheduled query rule or metric alert. The two
security-signal rules (`auth-failure-spike` and `forbidden-burst`) run on both consumers with the
same thresholds. Every one of those nineteen sits after its own template's `sloAlerts` loop closes
(`MMCA.ADC/infra/main.bicep:509-570`, `MMCA.Store/infra/main.bicep:382-431`) and therefore outside
the parse window, so the pairing gate neither requires nor forbids runbook sections for any of them.

Both consumers write triage for all of that ungated space, and both keep it out of the gate's
reach on purpose. Each repo's `OPERATIONS.md` carries an `## Operational alert runbooks` section of
`####` headings with numbered triage steps, one per ungated alert. Store's
(`MMCA.Store/infra/OPERATIONS.md:139`) holds all seven: `store-alert-outbox-dead-letter` (sev 2) at
`:147`, `store-alert-broker-error-queue` (sev 2) at `:178`, `store-alert-revision-activation-failed`
(sev 2) at `:246`, `store-alert-gateway-availability` (sev 1) at `:273`,
`store-alert-auth-failure-spike` (sev 2) at `:294`, `store-alert-forbidden-burst` (sev 3) at `:332`
and `store-alert-log-ingestion-quota` (sev 2) at `:352`, and its preamble counts seven (`:141`).
ADC's (`MMCA.ADC/infra/OPERATIONS.md:174`) sits after its six `###` SLO sections and holds all
twelve: `adc-prod-alert-outbox-dead-letter` (sev 2) at `:189`, `adc-prod-alert-broker-error-queue`
(sev 2) at `:232`, `adc-prod-alert-sql-dependency-failures` (sev 2) at `:279`,
`adc-prod-alert-revision-activation-failed` (sev 2) at `:305`,
`adc-prod-alert-signalr-backplane-errors` (sev 2) at `:335`, `adc-prod-alert-outbox-backlog-age`
(sev 2) at `:364`, `adc-prod-alert-outbox-broker-circuit-open` (sev 2) at `:385`,
`adc-prod-alert-live-broadcast-dropped` (sev 2) at `:400`,
`adc-prod-alert-log-ingestion-cap-reached` (sev 2) at `:418`, `adc-prod-alert-auth-failure-spike`
(sev 2) at `:454`, `adc-prod-alert-forbidden-burst` (sev 3) at `:496` and
`adc-prod-alert-gateway-availability` (sev 1) at `:518`, named with the full deployed names its SLO
headings already use. Its preamble counts twelve, lists all eight `scheduledQueryAlertSpecs` entries
plus the three standalone rules and the gateway metric alert, and says all twelve carry triage
(`MMCA.ADC/infra/OPERATIONS.md:176-185`), so the runbook's own count matches the template.
The headings are `####` rather than `###` in both repos, because `RunbookHeadingRegex` is `^###\s+.*$`
(`ObservabilityConventionTestsBase.cs:197-198`) and does not match a `####` line: an `###` heading
naming a non-spec alert would read to `EveryRunbookAlertSection_MapsToAProvisionedAlert` as an orphan
section and fail the build. Each runbook states that reasoning inline, above its own first `####`
heading (`MMCA.Store/infra/OPERATIONS.md:143-145`, `MMCA.ADC/infra/OPERATIONS.md:182-185`). So the
triage exists and is discoverable at 3am for all nineteen ungated alerts (Store seven of seven, ADC
twelve of twelve), while the gate sees exactly six paired alerts on ADC and five on Store. The
ungated space is not symmetric. Store does not port `sql-dependency-failures`, deliberately, because
its own `dependency-failures` SLO rule already spans SQL, gRPC and HTTP
(`MMCA.Store/infra/main.bicep:360-361`), which the template records beside the outbox rule
(`:448-449`), so a narrower SQL-scoped twin would page twice for one fault. ADC's
`outbox-backlog-age`, `outbox-broker-circuit-open` and `live-broadcast-dropped` have no Store
counterpart. For the first of those Store records the reason in its template: outbox row age is
queryable but gets no alert, because it only grows when the processor falls behind, and a row the
broker refuses dead-letters within about 150 seconds and pages through `outbox-dead-letter`
(`MMCA.Store/infra/main.bicep:443-447`). ADC's template justifies its `outbox-backlog-age` rule on
the opposite premise, that a row older than 15 minutes means the broker is refusing it or the drain
cannot keep up, "neither of which dead-letters until every retry is spent"
(`MMCA.ADC/infra/main.bicep:610-616`, rule description at `:657`). Common's processor supports
Store's reading of the broker-refusal case: every failed publish, an open broker circuit included,
increments `RetryCount` and re-leases the row with backoff
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:595`,
`:609-615`) against a default `MaxRetries` of 5
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxSettings.cs:21`),
so the two templates' comments disagree on that case, while ADC's rule still covers a drain that
falls behind.

## Rationale
- **Alerts as data, not as portal state.** One array is reviewable in a PR, diffable across
  environments, and re-deployable; the rules, the workbook, and the notification channel are created by
  the same template that creates the workloads they watch.
- **A new name, not a reused one, is what makes a supersede safe under incremental ARM.** Removing a
  resource from a template is a no-op against the resource group, so "delete the old alert" on its own
  ships a duplicate paging path rather than replacing one. The replacements take distinct `-v2` names
  instead, which is what lets the legacy declarations be absent from both templates today without
  either renaming a live rule or colliding with the unsuffixed resources that still hold those names.
- **A log-search rule can say what a metric alert cannot.** The whole class of false pages came from
  predicates a metric alert has no way to express. Moving to KQL kept the thresholds and severities
  identical while removing the 401/499 and connection-lifetime confounds, so the change is a precision
  fix, not a sensitivity cut.
- **Pairing enforced, not remembered.** "Update the runbook when you change an alert" is exactly the
  kind of rule that does not survive a growing change history, so it becomes a red build instead
  (ADR-015's invariant-over-discipline posture). Severity is included in the match because a re-tiered
  alert with stale triage urgency is a subtler failure than a missing section.
- **A floor is what keeps a text gate honest.** A parser over someone else's file can silently discover
  nothing. Requiring a minimum spec count converts that failure mode from a vacuous pass into a build
  break.
- **The rule body ships once, the consumer supplies identity.** Same shared-package-plus-subclass
  wiring the rest of the fitness tier uses (ADR-015), so a rule improvement reaches every consumer with
  a version bump rather than a copy-paste.

## Trade-offs
- **It is a text gate over IaC, not a check against deployed state.** The base matches literal anchors
  and regexes in the template and headings in markdown. It proves the two files agree; it does not prove
  the deployment ran, the rule exists in Azure, or the KQL is valid. Renaming `sloAlertSpecs` or
  reshaping its entries breaks the parser, which the floor and the key/severity count assertion are
  designed to surface loudly rather than silently.
- **The gate checks pairing and severity, plus a workbook presence check, nothing else.**
  Whether 10 failures per 15 minutes is the right threshold, whether the query measures what it
  claims, and whether the triage steps are correct all remain review concerns. Severity is the only
  value cross-checked between the two files. The `RequireWorkbook` fact proves only that some workbook
  or dashboard resource is declared, never what it shows; it runs for both consumers by default.
- **Only the spec-window alerts are covered.** ADC's outbox dead-letter, SQL dependency,
  revision-activation, SignalR backplane-errors, broker error-queue, outbox backlog-age, outbox
  broker-circuit-open, live-broadcast-dropped, log-ingestion-cap, auth-failure-spike, forbidden-burst
  and gateway-availability alerts and Store's outbox dead-letter, broker error-queue,
  revision-activation, auth-failure-spike, forbidden-burst, log-ingestion-quota and
  gateway-availability alerts are provisioned but ungated, so all nineteen can be added, renamed or
  re-tiered with no **build** consequence. That is not the same as no consequence. All nineteen have
  written triage today (Store `MMCA.Store/infra/OPERATIONS.md:147`, `:178`, `:246`, `:273`, `:294`,
  `:332`, `:352`; ADC `MMCA.ADC/infra/OPERATIONS.md:189`, `:232`, `:279`, `:305`, `:335`, `:364`,
  `:385`, `:400`, `:418`, `:454`, `:496`, `:518`), but the cost of the honour system has already been
  paid once: ADC's `signalr-backplane-errors` rule (`MMCA.ADC/infra/main.bicep:644`) shipped with no
  `####` section and nothing failed until the 2026-10-19 drift wave wrote one by hand. Because those
  sections are invisible to the gate by design, a new ungated alert with no section, or a re-tiered or
  renamed one whose section was not moved, fails nothing. Both runbooks record the honour-system
  caveat themselves, in their Governance sections (`MMCA.Store/infra/OPERATIONS.md:415`, gated count
  and floor at `:419-420`, caveat at `:421-422`; `MMCA.ADC/infra/OPERATIONS.md:609`, gated count and
  floor at `:613-614`, caveat at `:615-616`), and both state the gated count their template declares
  (six on ADC, five on Store) and the floor their subclass sets. ADC's caveat, like its preamble,
  counts the twelve operational alerts its template declares, all with triage. Nothing checks either
  count sentence, because the gate matches headings, not prose: ADC's runbook carried a stale count of
  nine until it was corrected by hand.
- **The template is not the inventory of the resource group.** The superseded metric alerts are gone
  from both templates, but an incremental ARM deployment does not delete what it stops declaring, so
  their unsuffixed names stay occupied in the resource group, and the template says so
  (`MMCA.Store/infra/main.bicep:384-386`). Anything that exists only in Azure is invisible to every
  check in this record: the pairing gate parses the template, not the deployment.
- **The runbook heading is not the deployed resource name.** The gate matches only from the `-alert-<key>`
  infix onward, as a whole token
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/ObservabilityConventionTestsBase.cs:175`),
  so the prefix in a heading is unchecked. Live rules resolve from `prefix` and carry the `-v2`
  suffix. ADC's headings spell that deployed name out in full, `adc-prod-alert-failed-requests-v2`
  (`MMCA.ADC/infra/OPERATIONS.md:17`), which matches only because `prefix` is `adc-${environmentName}`
  (`MMCA.ADC/infra/main.bicep:160`) and the deployed environment is `prod`: the same runbook read
  against any other environment names rules that do not exist. On Store the prefix does not match at
  all: `prefix` is `mmca-${environmentName}` (`MMCA.Store/infra/main.bicep:122`), so the deployed rule
  is `mmca-<env>-alert-failed-requests-v2` against a heading that reads `store-alert-failed-requests`
  (`MMCA.Store/infra/OPERATIONS.md:17`). A heading is therefore a searchable handle, not a guaranteed
  copy of what an operator sees in the portal, and on Store it is not even a prefix match on the
  resource name.
- **One action group, one receiver, no routing.** Severity 1 and severity 3 land in the same inbox,
  alongside budget notifications. Severity is metadata for triage order, not a delivery decision.
- **Adoption is opt-in per consumer.** A consumer that provisions alerts without embedding the two
  resources and subclassing the base gets no gate at all, the same audit-the-inventory caveat that
  applies to the rest of the fitness tier (ADR-015).

## Revision (2026-09-07)
The alert-to-runbook model is unchanged. Store's rule set grew by three, in one block from the
2026-09-07 security review (`MMCA.Store/infra/main.bicep:458-459`).

1. **A security signal now has a rule of its own** (SEC-Store-54). The failed-request and
   failed-dependency SLO rules exclude 401 and 499 on purpose
   (`MMCA.Store/infra/main.bicep:283`, `:301`, reasoning at `:271-278`), because an expired token and
   a client disconnect are not service failures. The side effect was that a credential-stuffing run
   produced nothing an alert could see. A dedicated rule watches sustained 401s on the `/Auth` route
   (`:492`, query at `:508`, threshold 50 at `:511`), with the trade-off written beside it
   (`:480-491`): a lockout storm under ADR-029 also surfaces as a 401, so the rule's runbook has to
   distinguish an attack from real users being locked out.
2. **An authorization-probing burst has its own severity 3 rule** (`:532`, severity at `:539`,
   query `AppRequests | where ResultCode == "403"` at `:548`, threshold 20 per 15 min at `:551`),
   which keeps a 403 burst distinct from the authentication signal above.
3. **The workspace ingestion cap is alerted on** (SEC-Store-55). At the cap, ingestion of every table
   stops until the next UTC midnight and every other rule in this deployment evaluates empty data, so
   the cap event is a detection outage that has to page before the rules go quiet: `:578`, query at
   `:594`, matching `ApproachingQuota` as well as `OverQuota`.

All three are declared after the `sloAlertSpecs`..`sloAlerts` window closes, which the template states
where they are declared (`:461-464`), so the alert-to-runbook build gate neither requires nor forbids
runbook sections for them. Their triage lives under `####` headings on the honour system instead
(`MMCA.Store/infra/OPERATIONS.md:141`, `:178`, `:198`).

## Revision (2026-10-01)
No decision or rationale changed. Both templates grew by 19 lines above the alert block, so every
`main.bicep` citation in the current-state sections is re-anchored: `sloAlertSpecs` now opens at
`MMCA.ADC/infra/main.bicep:362` and `MMCA.Store/infra/main.bicep:312`, the `sloAlerts` loop at
`MMCA.ADC/infra/main.bicep:454` and `MMCA.Store/infra/main.bicep:354`, and the ungated rules, the
gateway metric alert, the workbook and the budget follow by the same offset. Store's embedded-resource
pair is re-anchored to
`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/MMCA.Store.Architecture.Tests.csproj:16-21`.
The 2026-09-07 revision above keeps its original anchors as a historical record.

## Revision (2026-10-06)
No decision or rationale changed.

- The framework base ships a fourth fact, `MonitoringWorkbookOrDashboard_IsProvisioned_WhenRequired`,
  gated by the virtual `RequireWorkbook` (default false). Neither consumer overrides it; MMCA.Common's
  `SampleDeploymentObservabilityTests` (which runs the gate over `samples/deployment`) is the one
  subclass that does, so the facts list, the adoption boundary and the "pairing and severity"
  trade-off are rewritten around it.
- The latency query is stated in full: besides `/hubs/` it drops `ResultCode` 101 and URL-less
  requests and needs at least 5 requests per window.
- The 2026-09-07 revision's Store rules now sit at `MMCA.Store/infra/main.bicep:537` (auth spike,
  query at `:553`), `:577` (forbidden burst) and `:623` (ingestion quota), with triage at
  `MMCA.Store/infra/OPERATIONS.md:194`, `:232` and `:252`. The auth-spike query now matches
  `ResultCode` 401 or 429 on `/Auth`, not 401 alone as that revision records.
- Every live-section anchor was re-verified against current source. ADC's `main.bicep` citations from
  the action group onward moved by 26 lines (the 2026-10-01 note above is superseded for ADC),
  `prefix` is at `:160`, the base file's fact, parse and regex anchors moved with the new fact, and
  Store's two last triage headings and both runbooks' Governance sections are re-anchored.

## Revision (2026-10-07)
Re-verified against current source. The gate, its four facts, the spec counts (five on ADC, four on
Store), the floors and the adoption boundary are unchanged. What moved is the ungated space on ADC,
every ADC `main.bicep` anchor, and both runbooks' Governance sections (new runbook text landed above
each one after the 2026-10-06 revision).

1. **ADC's ungated array has a fourth entry.** `scheduledQueryAlertSpecs` now declares
   `signalr-backplane-errors` (`MMCA.ADC/infra/main.bicep:595`), severity 2 like the rest of the array
   (`:609`), watching warning-or-above lines from the Notification service's SignalR Redis backplane
   logger. ADC's ungated count is six and the fleet's is twelve, so the coverage-boundary paragraph and
   the ungated trade-off are rewritten around twelve.
2. **Triage covers eleven of the twelve.** `MMCA.ADC/infra/OPERATIONS.md` has no `####` section for
   `signalr-backplane-errors`, and its preamble (`:151-160`) and Governance caveat (`:392-393`) still
   count five ungated alerts that all carry triage. The ADR records that as the honour-system cost
   being paid; the runbook fix belongs to an ADC PR.
3. **Both Governance sections moved down.** The 2026-10-06 anchors were right when written; since
   then Store's runbook gained a manual cost-drift reset entry (`MMCA.Store/infra/OPERATIONS.md:304-313`)
   that pushes its Governance section to `:315`, and ADC's moved to `MMCA.ADC/infra/OPERATIONS.md:386`.
4. Anchors re-verified against current source: in `MMCA.ADC/infra/main.bicep`, the Context reasoning
   at `:373-389` (401/499 at `:378-381`, hub lifetime at `:382-384`), the action group at `:357-371`
   (receiver `:363-369`), `sloAlertSpecs` at `:390` with specs at `:391-417`, the queries at `:394`,
   `:403` (described at `:402`) and `:412`, the crawler note at `:385-387`, `resilience-circuit-open`
   at `:421-429` (reasoning `:418-420`), the AI ceiling at `:467-479` (reasoning `:430-466`, placement
   `:430-434`, overrides `:475-478`), the `sloAlerts` loop at `:482-543` (`-v2` note `:484-485`, name
   `:486`, `enabled` `:500`, cadence notes `:502-506` and `:508-511`, cadence fields `:513-517`,
   `union` `:520-535`, action group `:539`), `scheduledQueryAlertSpecs` at `:575` (keys `:577`, `:583`,
   `:589`, `:595`, loop `:602`, severity `:609`), `log-ingestion-cap-reached` at `:654` (severity
   `:661`), the web test at `:700`, the gateway alert at `:733` (severity `:739`), the workbook at
   `:772` (`loadTextContent` `:781`) and the budget's `contactGroups` at `:809` and `:817`; ADC's
   Governance section at `MMCA.ADC/infra/OPERATIONS.md:386` (count and floor `:389-391`); Store's at
   `MMCA.Store/infra/OPERATIONS.md:315` (count and floor `:319-320`, caveat `:321-322`). The 2026-09-07
   and 2026-10-01 revisions keep their original anchors as a historical record.

## Revision (2026-10-19)
No decision changed. The gated core is unchanged on both consumers (six specs and a floor of 6 on ADC,
`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/ObservabilityConventionTests.cs:14`;
five and 5 on Store, `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Governance/ObservabilityConventionTests.cs:13`).
What moved is the ungated space and one framework default:

1. **ADC ports Stores two security-signal rules.** `auth-failure-spike` (more than 50 401s or 429s on
   `/Auth` per 15 minutes, severity 2, `MMCA.ADC/infra/main.bicep:763`) and `forbidden-burst` (more
   than 20 403s per 15 minutes, severity 3, `:802`) are standalone resources, because the
   `scheduledQueryAlertSpecs` loop pins severity 2 (`:648`). ADCs `log-ingestion-cap-reached` query
   now also matches `ApproachingQuota` (`:711`), as Stores does (`MMCA.Store/infra/main.bicep:714`).
2. **The ungated space is sixteen alerts, all with triage.** `broker-error-queue` now exists on both
   consumers (ADC array entry `MMCA.ADC/infra/main.bicep:634`, Store `MMCA.Store/infra/main.bicep:494`),
   so ADC carries nine ungated alerts and Store seven, superseding the twelve (six per consumer) of
   2026-10-07. ADCs runbook gained the `signalr-backplane-errors` section
   (`MMCA.ADC/infra/OPERATIONS.md:334`) plus the two new security sections (`:399`, `:441`), and its
   preamble and Governance caveat both count nine with triage for all nine (`:176-187`, `:560-561`).
   Stores seven sections are unchanged in content (`MMCA.Store/infra/OPERATIONS.md:147-349`). The
   coverage-boundary paragraph and the ungated trade-off are rewritten around these counts.
3. **`RequireWorkbook` defaults to true** (`ObservabilityConventionTestsBase.cs:60`, MMCA.Common
   v1.243.0), so `MonitoringWorkbookOrDashboard_IsProvisioned_WhenRequired` runs for both consumers
   rather than being a no-op; both templates declare a workbook (`MMCA.ADC/infra/main.bicep:920`,
   `MMCA.Store/infra/main.bicep:820`). MMCA.Commons sample subclass still states it explicitly
   (`SampleDeploymentObservabilityTests.cs:24`).

The deliberate asymmetry is unchanged: Store still does not port `sql-dependency-failures`
(`MMCA.Store/infra/main.bicep:444-445`).

## Revision (2026-10-21)
Re-verified against current source. The gate, its four facts, the spec counts (six on ADC, five on
Store), the floors, the ungated space and the adoption boundary are unchanged. What moved is the
description of how a runbook heading is matched, one stale statement about the workbook fact, and
the anchors.

1. **The pairing gate matches a whole token, not a substring.** Both pairing facts read headings
   through `HeadingNamesAlert`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/ObservabilityConventionTestsBase.cs:168-178`),
   whose pattern (`:175`) accepts `-alert-<key>` only when followed by an optional `-v<digits>` and
   then the end of the heading, whitespace, `(` or a backtick, so a `-p99` or `-extra` continuation
   neither satisfies nor shadows the key
   (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/ObservabilityConventionTestsBaseTests.cs:38-61`).
   The `OPERATIONS.md` bullet and the severity-fact description now say so. The trade-off that the
   heading prefix is unchecked still holds.
2. **The workbook fact runs for both consumers.** `RequireWorkbook` defaults to true
   (`ObservabilityConventionTestsBase.cs:60`) and neither consumer subclass overrides it
   (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/ObservabilityConventionTests.cs:14`,
   `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Governance/ObservabilityConventionTests.cs:13`
   override only `MinimumAlertSpecs`), so the workbook bullet's "opt-in ... neither consumer turns it
   on" sentence and the "opt-in" in the pairing-and-severity trade-off heading are corrected; the
   facts list already said so.
3. Anchors re-verified against current source: in `MMCA.Store/infra/main.bicep`, `alertEmailAddress`
   at `:95`, `prefix` at `:122`, the action group at `:288` (receiver `:294-300`), dependency
   reasoning at `:317-319`, deploy-skip reasoning at `:325-329`, `sloAlertSpecs` at `:330` (specs
   `:331-366`, queries `:334`, `:343`, `:352` described at `:351`, and `:361`),
   `resilience-circuit-open` at `:370-378` (reasoning `:367-369`), the `sloAlerts` loop at `:381`
   (`-v2` note `:383-385`, name `:386`, `enabled` `:393`, cadence comment `:395-401`, cadence fields
   `:402-404`, `union` `:410-422`, action group `:426`), the gateway metric alert at `:779` (severity
   `:785`), the workbook at `:820` (`loadTextContent` `:829`) and the budget at `:841` (`contactGroups`
   `:857`, `:865`); in `MMCA.ADC/infra/main.bicep`, the gateway metric alert at `:881` (severity
   `:887`), the workbook at `:920` (`loadTextContent` `:929`) and the budget at `:941`
   (`contactGroups` `:957`, `:965`); in `ObservabilityConventionTestsBase.cs`, the workbook fact at
   `:67-79`, the floor assertion at `:86-88`, the severity fact at `:91-117` (lookup `:101`, severity
   check `:108-112`), the orphan fact at `:119-131`, the count-mismatch assertion at `:145`, the key
   and severity regexes at `:191-195`, `RunbookHeadingRegex` at `:197-198` and
   `MonitoringViewResourceRegex` at `:200-201`. Store's budget also notifies the action group, as ADC's
   does. The dated revisions above keep their original anchors as a historical record.

## Revision (2026-10-26)
Re-verified against current source. The gate, its four facts, the spec counts (six on ADC, five on
Store), the floors (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/ObservabilityConventionTests.cs:14`,
`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Governance/ObservabilityConventionTests.cs:13`),
Store's seven ungated alerts and the adoption boundary are unchanged. What moved is ADC's ungated
space, the asymmetry statement, the runbook-count statement, and the anchors.

1. **ADC's ungated space is twelve alerts, so the fleet's is nineteen.** ADC's
   `scheduledQueryAlertSpecs` array (`MMCA.ADC/infra/main.bicep:624`) has eight entries, adding
   `outbox-backlog-age` (`:656`), `outbox-broker-circuit-open` (`:662`) and `live-broadcast-dropped`
   (`:668`) to the five recorded on 2026-10-19, all still pinned to severity 2 by the loop (`:675`,
   `:682`). With `log-ingestion-cap-reached` (`:729`), `auth-failure-spike` (`:797`),
   `forbidden-burst` (`:836`) and the gateway metric alert (`:915`) that is twelve on ADC against
   seven on Store, nineteen in total, superseding the sixteen (nine and seven) of 2026-10-19. No other
   `infra/*.bicep` file in either repo declares an alert. The coverage-boundary paragraph and the
   ungated trade-off are rewritten around these counts.
2. **ADC's runbook carries triage for all twelve, but its own count is stale.** Its `####` sections
   now number twelve (`MMCA.ADC/infra/OPERATIONS.md:188` through `:517`, the three new ones at
   `:363`, `:384`, `:399`), while the preamble still says nine signals, lists five array entries and
   says all nine carry triage (`:176-184`), and the Governance caveat repeats nine (`:614-615`). The
   statement that ADC's runbook count matches its template is withdrawn and recorded as a second,
   prose, honour-system miss.
3. **The ungated asymmetry is no longer one deliberate gap.** Store still does not port
   `sql-dependency-failures` (`MMCA.Store/infra/main.bicep:448-449`), and ADC's three new alerts have
   no Store counterpart; for outbox row age Store records why it does not alert
   (`MMCA.Store/infra/main.bicep:443-447`).
4. Anchors re-verified against current source: the ADC embedded-resource pair at
   `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/MMCA.ADC.Architecture.Tests.csproj:25-30`
   (Store's `:16-21` unchanged); in `MMCA.ADC/infra/main.bicep`, every anchor from the action group on
   moved by one (action group `:358-372`, receiver `:364-370`, Context reasoning `:374-407`,
   `sloAlertSpecs` `:408`, specs `:409-444`, queries `:412`, `:421`, `:430` described at `:429`, and
   `:439`, resilience `:448-456`, AI ceiling `:494-506`, the `sloAlerts` loop `:509-570`, name `:513`,
   `enabled` `:527`, cadence fields `:540-544`, `union` `:547-562`, action group `:566`), and the
   ungated block, gateway alert `:915` (severity `:921`), workbook `:954` (`loadTextContent` `:963`)
   and budget `:975` (`contactGroups` `:991`, `:999`) moved further; in `MMCA.Store/infra/main.bicep`,
   every anchor from the action group on moved by one (action group `:289`, receiver `:295-301`,
   `sloAlertSpecs` `:331`, resilience `:371-379`, the `sloAlerts` loop `:382-431`, name `:387`) and the
   ungated rules by four (`outbox-dead-letter` `:450`, `broker-error-queue` `:498`,
   `revision-activation-failed` `:548`, `auth-failure-spike` `:616`, `forbidden-burst` `:656`,
   `log-ingestion-quota` `:702`, web test `:750`, gateway alert `:783`, workbook `:824`, budget `:845`);
   `alertEmailAddress` (`MMCA.ADC/infra/main.bicep:124`, `MMCA.Store/infra/main.bicep:95`) and
   `prefix` (`:160`, `:122`) are unchanged. Store's `####` sections sit at
   `MMCA.Store/infra/OPERATIONS.md:147`, `:178`, `:246`, `:273`, `:294`, `:332`, `:352` and its
   Governance section at `:415`; ADC's Governance section is at `MMCA.ADC/infra/OPERATIONS.md:608`.

## Revision (2026-10-28)
Re-verified against current source. The gate, its four facts, the spec counts (six on ADC, five on
Store), the floors, the nineteen ungated alerts (ADC twelve, Store seven), their triage and the
adoption boundary are unchanged. What moved is ADC's runbook count prose and the ADC `OPERATIONS.md`
anchors.

1. **ADC's runbook count matches its template again.** The preamble now says twelve signals, lists
   all eight `scheduledQueryAlertSpecs` entries plus the log-ingestion cap, the auth-failure spike,
   the 403 burst and the gateway metric alert, and says all twelve carry triage
   (`MMCA.ADC/infra/OPERATIONS.md:176-185`); the Governance caveat says the same
   (`:615-616`). The 2026-10-26 statement that both still count nine, and the second, prose,
   honour-system miss it recorded, are withdrawn; the coverage-boundary paragraph and the ungated
   trade-off are rewritten around the corrected count. The cost of the honour system stands as
   recorded: nothing checks either count sentence, because the gate matches headings, not prose.
2. Anchors re-verified against current source: in `MMCA.ADC/infra/OPERATIONS.md`, every `####`
   heading moved down by one (`:189`, `:232`, `:279`, `:305`, `:335`, `:364`, `:385`, `:400`, `:418`,
   `:454`, `:496`, `:518`), the inline `####` reasoning spans `:182-185`, and the Governance section
   is at `:609` (gated count and floor `:613-614`, caveat `:615-616`); the section heading (`:174`) and
   the six `###` SLO sections (`:17`, `:33`, `:50`, `:71`, `:88`, `:136`) are unchanged. The floor of 6
   still matches
   `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/ObservabilityConventionTests.cs:14`.
   The dated revisions above keep their original anchors as a historical record.

## Related
ADR-041 (the telemetry this alerts on top of: it defines emission, instrumentation and cost knobs and
stops before thresholds, severities and runbooks), ADR-009 (recovery objectives and the drilled
`DISASTER-RECOVERY.md` these runbooks defer restore procedure to; that record is detection's recovery
sibling), ADR-015 (fitness functions: the pairing gate is one, wired through the same shared-package
plus per-repo-subclass extension point), ADR-058 (the other package-shipped test tier, which boots a
real host to assert runtime contracts, where this one parses the consumer's IaC and runbook text).
