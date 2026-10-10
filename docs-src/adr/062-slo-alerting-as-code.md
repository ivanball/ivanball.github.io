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
   (`MMCA.ADC/infra/main.bicep:373-400`, the 401/499 page at `:378-381`, the hub lifetime at
   `:382-384`).

## Decision
Declare each consumer's SLO alerts as **data in its Bicep template**, materialize them as Log Analytics
scheduled query rules, and make the alert-to-runbook pairing a **build gate shipped by the framework**.

- **`sloAlertSpecs` is the declaration.** A single array of records carrying `key`, `description`,
  `query`, `timeAggregation`, `metricMeasureColumn`, `threshold` and `severity`
  (`MMCA.ADC/infra/main.bicep:401`, `MMCA.Store/infra/main.bicep:321`). Both consumers declare the same
  five SLOs with the same numbers: `failed-requests` (severity 2, more than 10 per 15 min),
  `request-rejections` (severity 3, more than 50 per 15 min), `server-response-time` (severity 3,
  average above 3000ms), `dependency-failures` (severity 2, more than 10 per 15 min)
  (`MMCA.ADC/infra/main.bicep:402-437`, `MMCA.Store/infra/main.bicep:322-357`),
  and `resilience-circuit-open` (severity 2, more than 0 rows), which fires on the first Polly
  `OnCircuitOpened` event a service reports in the window rather than on a rate, because an open
  breaker is already the failure mode the retry budget was meant to absorb
  (`MMCA.ADC/infra/main.bicep:441-449`, reasoning at `:438-440`;
  `MMCA.Store/infra/main.bicep:361-369`, reasoning at `:358-360`). ADC declares a sixth, ADC-only
  spec, `ai-scoring-token-ceiling` (severity 3, a rolling two-day provider token total above the
  `aiScoringTokenCeiling` parameter), and declares it inside the array precisely so the gate covers
  it (`MMCA.ADC/infra/main.bicep:487-499`, reasoning at `:450-486`, the in-array placement at
  `:450-454`).

- **Materialized as Log Analytics scheduled query rules.** One `Microsoft.Insights/scheduledQueryRules`
  per spec (`MMCA.ADC/infra/main.bicep:502`, `MMCA.Store/infra/main.bicep:372`), named
  `${prefix}-alert-${spec.key}-v2` (`MMCA.ADC/infra/main.bicep:506`,
  `MMCA.Store/infra/main.bicep:377`), scoped to the Log Analytics workspace, and by default enabled and
  evaluated every 15 minutes over a 15-minute window with `autoMitigate`
  (`MMCA.Store/infra/main.bicep:384`, `:393-395`). Store pins those four values for every spec. ADC
  reads each from the spec and falls back to the same defaults (`enabled` at
  `MMCA.ADC/infra/main.bicep:520`, `evaluationFrequency`, `windowSize` and `autoMitigate` at
  `:533-537`, reasoning at `:528-531`), because one spec needs different values: the AI ceiling
  evaluates a two-day window every twelve hours and switches itself off when no AI key is deployed
  (`:495-498`). For every other spec evaluation frequency equals window size, so consecutive windows
  tile instead of overlapping: each rule still reads the same 15 minutes of data against the same
  threshold, and what the cadence trades is billed evaluations against worst-case detection latency.
  Both templates state the billing half inline and Store's comment also states the latency half
  (`MMCA.ADC/infra/main.bicep:522-526`, `MMCA.Store/infra/main.bicep:386-392`). A `union(...)` supplies `metricMeasureColumn` only for an
  aggregate rule; the empty-string case makes a rule count returned **rows**, which is what the
  row-count SLOs want (`MMCA.ADC/infra/main.bicep:540-555`, `MMCA.Store/infra/main.bicep:401-413`).

- **The KQL predicate is the point of the migration.** Both consumers' `failed-requests` query
  excludes 401, 404, 429 and 499 (`MMCA.ADC/infra/main.bicep:405`, `MMCA.Store/infra/main.bicep:325`).
  404 and 429 are the volume a scanner, crawler or rate limiter produces with no fault behind it,
  which on ADC paged on 10/6, 10/9 and 10/10 (`MMCA.ADC/infra/main.bicep:388-392`), so
  `request-rejections` watches them separately at a volume threshold and drops the crawler probes for
  `/robots.txt` and `/sitemap.xml` (`MMCA.ADC/infra/main.bicep:414`, `MMCA.Store/infra/main.bicep:334`;
  the robots/sitemap page that first prompted that exclusion is recorded at
  `MMCA.ADC/infra/main.bicep:385-387`). Both `dependency-failures` queries exclude 401 and 499 and
  also anti-join away every row of an operation whose request answered 499, because a dependency call
  cancelled by a disconnecting caller logs `ResultCode` 0 with a `TaskCanceledException`, never 499
  (`MMCA.ADC/infra/main.bicep:432`, reasoning at `:393-395`; `MMCA.Store/infra/main.bicep:352`,
  reasoning at `:313-315`); a timeout with no 499 parent still counts
  (`MMCA.ADC/infra/main.bicep:399-400`). The latency
  query excludes `/hubs/` requests, `ResultCode` 101 (a hub or Blazor circuit connection, whose
  duration is its lifetime) and requests with no `Url` (background consumer spans), and averages
  `DurationMs` only when the window holds at least 5 requests, so a single cold request cannot page
  (`MMCA.ADC/infra/main.bicep:423`, described at `:422`; `MMCA.Store/infra/main.bicep:343`, described
  at `:342`). A genuine 400 or 500 burst still pages at the same threshold as before.

- **The superseded metric alerts are no longer declared, and the `-v2` names stay.** Neither template
  carries a `legacySloMetricAlertSpecs` array or a metric alert on `requests/failed`,
  `requests/duration` or `dependencies/failed`. The only `Microsoft.Insights/metricAlerts` resource
  left in each is the unrelated severity 1 gateway-availability alert, which stays because
  availability has no status-code confound and never produced a false page
  (`MMCA.ADC/infra/main.bicep:753`, severity at `:759`;
  `MMCA.Store/infra/main.bicep:722`, severity at `:728`). The `-v2` suffix on
  the replacements is what made that removal safe and is now part of each rule's identity in Azure:
  renaming it would create a second rule alongside the live one rather than update it, and the
  unsuffixed names stay occupied in the resource group by the superseded alerts, which an incremental
  ARM deployment does not delete just because they left the template
  (`MMCA.ADC/infra/main.bicep:504-505`, `MMCA.Store/infra/main.bicep:374-376`).

- **One unconditional action group.** `alertEmailAddress` is a required parameter with no default
  (`MMCA.ADC/infra/main.bicep:124`, `MMCA.Store/infra/main.bicep:91`), so the action group's email
  receiver is not conditional (`MMCA.ADC/infra/main.bicep:357-371`, its receiver at `:363-369`;
  `MMCA.Store/infra/main.bicep:284`, its receiver at `:291-295`) and every scheduled query rule routes to it
  (`MMCA.ADC/infra/main.bicep:559`, `MMCA.Store/infra/main.bicep:417`). The monthly cost budget
  notifies the same group (`MMCA.ADC/infra/main.bicep:813`, `contactGroups` at `:829`, `:837`;
  `MMCA.Store/infra/main.bicep:800`, `:808`).

- **A saved workbook renders three of the SLO signals.** `sloWorkbook`
  (`MMCA.ADC/infra/main.bicep:792`, `MMCA.Store/infra/main.bicep:763`) is bound to the Log Analytics
  workspace and embeds `workbooks/adc-slo-workbook.json` / `workbooks/store-slo-workbook.json` at
  compile time via `loadTextContent` (`MMCA.ADC/infra/main.bicep:801`,
  `MMCA.Store/infra/main.bicep:772`), grouped per service by `AppRoleName`, so the visualization cannot
  diverge from the alerts by being maintained somewhere else. Both workbooks carry the same five
  panels, covering requests and failures, response-time percentiles and dependency calls and
  failures; neither has a panel for `resilience-circuit-open` or for `request-rejections` (neither
  workbook queries `ResultCode`), and ADC's has none for its AI token
  ceiling, so those specs page without a matching view
  (`MMCA.ADC/infra/workbooks/adc-slo-workbook.json`, which mentions neither
  `resilience.polly.strategy.events` nor the `mmca.ai` counters, and
  `MMCA.Store/infra/workbooks/store-slo-workbook.json`). Nothing gates that pairing: the build gate
  pairs alerts with runbook sections, not with workbook panels. Its opt-in workbook fact (below)
  checks only that a workbook or dashboard resource exists, and neither consumer turns it on.

- **`infra/OPERATIONS.md` is the paired artifact.** Each repo's runbook carries one `###` section per
  SLO alert whose heading contains the `-alert-<key>` infix and the alert's severity as `(sev N)`
  (`MMCA.ADC/infra/OPERATIONS.md:17`, `:50`, `:69`; `MMCA.Store/infra/OPERATIONS.md:17`, `:50`, `:73`),
  each followed by numbered triage steps. Both runbooks carry the sections the `request-rejections`
  and `resilience-circuit-open` specs require (`MMCA.ADC/infra/OPERATIONS.md:33` and `:86`,
  `MMCA.Store/infra/OPERATIONS.md:34` and `:91`), tagged `(sev 3)` and `(sev 2)` to match, and ADC's
  carries a sixth for its AI token ceiling (`MMCA.ADC/infra/OPERATIONS.md:134`, tagged `(sev 3)`).
  Restore procedure is
  deliberately not duplicated here: the
  runbook defers it to `DISASTER-RECOVERY.md` (`MMCA.ADC/infra/OPERATIONS.md:4-6`,
  `MMCA.Store/infra/OPERATIONS.md:4-6`).

- **The pairing is enforced by a framework test base, and it fails the build.**
  `ObservabilityConventionTestsBase`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/ObservabilityConventionTestsBase.cs:30`)
  ships four facts:
  - `MonitoringWorkbookOrDashboard_IsProvisioned_WhenRequired` (`:65-77`) requires the template to
    declare a `Microsoft.Insights/workbooks` or `Microsoft.Portal/dashboards` resource
    (`MonitoringViewResourceRegex`, `:174-175`), but only when the virtual `RequireWorkbook` is
    overridden to true (`:58`, default false); otherwise it returns immediately. Neither ADC's nor
    Store's subclass overrides it, so for both consumers the fact is a no-op.
  - `SloAlertSpecs_AreDiscovered_GateIsNotVacuous` requires at least `MinimumAlertSpecs` discovered
    specs, default 3 (`ObservabilityConventionTestsBase.cs:39`, asserted at `:84-86`), so a drifted
    parse anchor fails loudly instead of passing with zero alerts. The property is virtual, and each
    consumer raises it to its own spec count (below), so the floor also catches a spec that goes
    missing, not only a parser that discovers nothing.
  - `EveryProvisionedSloAlert_HasASeverityCorrectRunbookSection` fails when a spec has no `###` heading
    containing `-alert-<key>` (`:89-115`, the infix constant at `:32`, the lookup at `:99`) **and**
    fails when the matching heading does not carry `(sev N)` for that spec's current severity
    (`:106-110`), so re-tiering an alert without moving its runbook is a red build.
  - `EveryRunbookAlertSection_MapsToAProvisionedAlert` fails on an orphan runbook section whose alert no
    longer exists (`:117-129`).
  Discovery parses the template between the literal anchors `var sloAlertSpecs` and
  `resource sloAlerts` (`:135-138`) with two source-generated regexes (`:165-169`), and a key-count
  versus severity-count mismatch is itself a failure (`:143`), so a change to the spec shape cannot
  quietly desynchronize the parser.

- **Consumers wire it with an embedded-resource pair and a one-override subclass.** The base reads
  `infra.main.bicep` and `infra.OPERATIONS.md` (`ObservabilityConventionTestsBase.cs:42`, `:45`) from
  `ResourceAssembly`, which defaults to the **derived** type's assembly (`:51`); resolving against the
  base's own assembly would look for the consumer's template inside the framework package and always
  throw. Each consumer embeds the two real files under those logical names
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/MMCA.ADC.Architecture.Tests.csproj:17-22`,
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
which sets `MinimumAlertSpecs` to 4 (`:20`) and is the only subclass in the workspace that sets
`RequireWorkbook` to true (`:24`). It runs against a sample template, not a deployed environment.

**Coverage boundary inside the templates.** The gate covers exactly the alerts declared between the two
parse anchors: six specs on ADC (the five shared SLOs plus `ai-scoring-token-ceiling`) and five on
Store. Twelve further alerts sit outside that window, six on each consumer. ADC provisions a
four-entry `scheduledQueryAlertSpecs` array (`MMCA.ADC/infra/main.bicep:595`, keys
`outbox-dead-letter` at `:597`, `sql-dependency-failures` at `:603`, `revision-activation-failed`
at `:609` and `signalr-backplane-errors` at `:615`, the last watching warning-or-above lines from
the Notification service's SignalR Redis backplane logger, materialized at `:622`, all severity 2 at
`:629`), a `log-ingestion-cap-reached` rule (`:674`, severity 2 at `:681`), and a severity 1
gateway-availability metric alert over a three-location URL ping web test (`:720`, alert at `:753`,
severity at `:759`). Store provisions six
as standalone resources rather than from an array: the `outbox-dead-letter` scheduled query rule
(`MMCA.Store/infra/main.bicep:437`, severity 2 at `:444`), the `revision-activation-failed` rule over
`ContainerAppSystemLogs_CL` (`:487`, severity 2 at `:494`) that closes the gap where a revision whose
readiness never went green left the previous revision serving and paged nobody,
`auth-failure-spike` (`:555`, severity 2 at `:562`), which can page alongside `request-rejections`
on a lockout storm on `/Auth`, an overlap the template records as accepted (`:535-537`),
`forbidden-burst` (`:595`, severity 3 at
`:602`), `log-ingestion-quota` (`:641`, severity 2 at `:648`), and the outside-in Gateway availability
web test (`:689`) with its severity 1 metric alert (`:722`, severity at `:728`), alongside the five
SLO rules and the budget notifications. Every one of those twelve sits after its own template's
`sloAlerts` loop closes (`MMCA.ADC/infra/main.bicep:502-563`, `MMCA.Store/infra/main.bicep:372-421`)
and therefore outside the parse window, so the pairing gate neither requires nor forbids runbook
sections for any of them.

Both consumers write triage for nearly all of that ungated space, and both keep it out of the gate's
reach on purpose. Each repo's `OPERATIONS.md` carries an `## Operational alert runbooks` section of
`####` headings with numbered triage steps, one per ungated family it documents. Store's
(`MMCA.Store/infra/OPERATIONS.md:137`) holds all six: `store-alert-outbox-dead-letter` (sev 2) at
`:145`, `store-alert-revision-activation-failed` (sev 2) at `:168`, `store-alert-gateway-availability`
(sev 1) at `:195`, `store-alert-auth-failure-spike` (sev 2) at `:216`, `store-alert-forbidden-burst`
(sev 3) at `:254` and `store-alert-log-ingestion-quota` (sev 2) at `:274`. ADC's
(`MMCA.ADC/infra/OPERATIONS.md:172`) sits after its six `###` SLO sections and holds five of its
six: `adc-prod-alert-outbox-dead-letter` (sev 2) at `:186`, `adc-prod-alert-sql-dependency-failures`
(sev 2) at `:229`, `adc-prod-alert-revision-activation-failed` (sev 2) at `:255`,
`adc-prod-alert-log-ingestion-cap-reached` (sev 2) at `:285` and `adc-prod-alert-gateway-availability`
(sev 1) at `:319`, named with the full deployed names its SLO headings already use. It has no section
for `signalr-backplane-errors`, and its preamble says so: it describes the four-entry
`scheduledQueryAlertSpecs` array and six ungated alerts, five of them with triage, and records that
the AI token ceiling moved into the gated section (`MMCA.ADC/infra/OPERATIONS.md:174-184`), so the
runbook's own count matches the template. The headings are `####` rather than `###` in both repos,
because `RunbookHeadingRegex` is `^###\s+.*$` (`ObservabilityConventionTestsBase.cs:171-172`) and
does not match a `####` line: an `###` heading naming a non-spec alert would read to
`EveryRunbookAlertSection_MapsToAProvisionedAlert` as an orphan section and fail the build. Each
runbook states that reasoning inline, above its own first `####` heading
(`MMCA.Store/infra/OPERATIONS.md:141-143`, `MMCA.ADC/infra/OPERATIONS.md:179-181`). So the triage
exists and is discoverable at 3am for eleven of the twelve ungated alerts (Store six of six, ADC five
of six, the SignalR backplane rule being the one without), while the gate sees exactly six
paired alerts on ADC and five on Store. The one provisioning asymmetry in the ungated space is
deliberate: Store does not port `sql-dependency-failures`, because its own `dependency-failures` SLO
rule already spans SQL, gRPC and HTTP (`MMCA.Store/infra/main.bicep:350-352`), which the template
records beside the outbox rule (`:435-436`), so a narrower SQL-scoped twin would page twice for one
fault.

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
- **The gate checks pairing and severity, plus an opt-in workbook presence check, nothing else.**
  Whether 10 failures per 15 minutes is the right threshold, whether the query measures what it
  claims, and whether the triage steps are correct all remain review concerns. Severity is the only
  value cross-checked between the two files. The `RequireWorkbook` fact proves only that some workbook
  or dashboard resource is declared, never what it shows, and neither consumer enables it.
- **Only the spec-window alerts are covered.** ADC's outbox dead-letter, SQL dependency,
  revision-activation, SignalR backplane-errors, log-ingestion-cap and gateway-availability alerts
  and Store's outbox dead-letter, revision-activation, auth-failure-spike, forbidden-burst,
  log-ingestion-quota and gateway-availability alerts are provisioned but ungated, so all twelve can
  be added, renamed or re-tiered with no **build** consequence. That is not the same as no
  consequence. Eleven of the twelve have written triage today (Store
  `MMCA.Store/infra/OPERATIONS.md:145`, `:168`, `:195`, `:216`, `:254`, `:274`; ADC
  `MMCA.ADC/infra/OPERATIONS.md:186`, `:229`, `:255`, `:285`, `:319`), and the twelfth shows the cost
  being paid: ADC's `signalr-backplane-errors` rule (`MMCA.ADC/infra/main.bicep:615`) shipped with no
  `####` section and nothing failed. Because those sections are invisible to the gate by design, a new
  ungated alert with no section, or a re-tiered or renamed one whose section was not moved, fails
  nothing. Both runbooks record the honour-system caveat themselves, in their Governance sections
  (`MMCA.Store/infra/OPERATIONS.md:337`, gated count and floor at `:340-342`, caveat at `:342-344`;
  `MMCA.ADC/infra/OPERATIONS.md:410`, gated count and floor at `:413-415`, caveat at `:415-418`), and
  both state the gated count their template declares (six on ADC, five on Store) and the floor their
  subclass sets. ADC's caveat also counts six operational alerts, five of them with triage, which
  matches the template. Nothing checks either sentence, because the gate matches headings, not prose.
- **The template is not the inventory of the resource group.** The superseded metric alerts are gone
  from both templates, but an incremental ARM deployment does not delete what it stops declaring, so
  their unsuffixed names stay occupied in the resource group, and the template says so
  (`MMCA.Store/infra/main.bicep:374-376`). Anything that exists only in Azure is invisible to every
  check in this record: the pairing gate parses the template, not the deployment.
- **The runbook heading is not the deployed resource name.** The gate matches only the `-alert-<key>`
  infix, so the prefix in a heading is unchecked. Live rules resolve from `prefix` and carry the `-v2`
  suffix. ADC's headings spell that deployed name out in full, `adc-prod-alert-failed-requests-v2`
  (`MMCA.ADC/infra/OPERATIONS.md:17`), which matches only because `prefix` is `adc-${environmentName}`
  (`MMCA.ADC/infra/main.bicep:160`) and the deployed environment is `prod`: the same runbook read
  against any other environment names rules that do not exist. On Store the prefix does not match at
  all: `prefix` is `mmca-${environmentName}` (`MMCA.Store/infra/main.bicep:118`), so the deployed rule
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

## Related
ADR-041 (the telemetry this alerts on top of: it defines emission, instrumentation and cost knobs and
stops before thresholds, severities and runbooks), ADR-009 (recovery objectives and the drilled
`DISASTER-RECOVERY.md` these runbooks defer restore procedure to; that record is detection's recovery
sibling), ADR-015 (fitness functions: the pairing gate is one, wired through the same shared-package
plus per-repo-subclass extension point), ADR-058 (the other package-shipped test tier, which boots a
real host to assert runtime contracts, where this one parses the consumer's IaC and runbook text).
