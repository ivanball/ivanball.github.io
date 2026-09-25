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
   (`MMCA.ADC/infra/main.bicep:326-337`).

## Decision
Declare each consumer's SLO alerts as **data in its Bicep template**, materialize them as Log Analytics
scheduled query rules, and make the alert-to-runbook pairing a **build gate shipped by the framework**.

- **`sloAlertSpecs` is the declaration.** A single array of records carrying `key`, `description`,
  `query`, `timeAggregation`, `metricMeasureColumn`, `threshold` and `severity`
  (`MMCA.ADC/infra/main.bicep:343`, `MMCA.Store/infra/main.bicep:293`). Both consumers declare the same
  four SLOs with the same numbers: `failed-requests` (severity 2, more than 10 per 15 min),
  `server-response-time` (severity 3, average above 3000ms), `dependency-failures` (severity 2, more
  than 10 per 15 min) (`MMCA.ADC/infra/main.bicep:344-370`, `MMCA.Store/infra/main.bicep:294-320`),
  and `resilience-circuit-open` (severity 2, more than 0 rows), which fires on the first Polly
  `OnCircuitOpened` event a service reports in the window rather than on a rate, because an open
  breaker is already the failure mode the retry budget was meant to absorb
  (`MMCA.ADC/infra/main.bicep:374-382`, reasoning at `:371-373`;
  `MMCA.Store/infra/main.bicep:324-332`, reasoning at `:321-323`). ADC declares a fifth, ADC-only
  spec, `ai-scoring-token-ceiling` (severity 3, a rolling two-day provider token total above the
  `aiScoringTokenCeiling` parameter), and declares it inside the array precisely so the gate covers
  it (`MMCA.ADC/infra/main.bicep:420-432`, reasoning at `:383-419`, the in-array placement at
  `:383-387`).

- **Materialized as Log Analytics scheduled query rules.** One `Microsoft.Insights/scheduledQueryRules`
  per spec (`MMCA.ADC/infra/main.bicep:435`, `MMCA.Store/infra/main.bicep:335`), named
  `${prefix}-alert-${spec.key}-v2` (`MMCA.ADC/infra/main.bicep:439`,
  `MMCA.Store/infra/main.bicep:340`), scoped to the Log Analytics workspace, and by default enabled and
  evaluated every 15 minutes over a 15-minute window with `autoMitigate`
  (`MMCA.Store/infra/main.bicep:347`, `:356-358`). Store pins those four values for every spec. ADC
  reads each from the spec and falls back to the same defaults (`enabled` at
  `MMCA.ADC/infra/main.bicep:453`, `evaluationFrequency`, `windowSize` and `autoMitigate` at
  `:466-470`, reasoning at `:461-464`), because one spec needs different values: the AI ceiling
  evaluates a two-day window every twelve hours and switches itself off when no AI key is deployed
  (`:428-431`). For every other spec evaluation frequency equals window size, so consecutive windows
  tile instead of overlapping: each rule still reads the same 15 minutes of data against the same
  threshold, and what the cadence trades is billed evaluations against worst-case detection latency,
  which both templates state inline (`MMCA.ADC/infra/main.bicep:455-459`,
  `MMCA.Store/infra/main.bicep:349-355`). A `union(...)` supplies `metricMeasureColumn` only for an
  aggregate rule; the empty-string case makes a rule count returned **rows**, which is what the
  row-count SLOs want (`MMCA.ADC/infra/main.bicep:476-488`, `MMCA.Store/infra/main.bicep:364-376`).

- **The KQL predicate is the point of the migration.** Store's two failure queries exclude only 401 and
  499 (`MMCA.Store/infra/main.bicep:297`, `:315`), as does ADC's dependency query
  (`MMCA.ADC/infra/main.bicep:365`); ADC's `failed-requests` query drops those two codes and also the
  404s a crawler produces probing `/robots.txt` and `/sitemap.xml`
  (`MMCA.ADC/infra/main.bicep:347`, with the page that prompted it recorded at `:338-340`). The latency
  query excludes `/hubs/` requests before averaging `DurationMs`
  (`MMCA.ADC/infra/main.bicep:356`, `MMCA.Store/infra/main.bicep:306`). A genuine 400 or 500 burst
  still pages at the same threshold as before.

- **The superseded metric alerts are no longer declared, and the `-v2` names stay.** Neither template
  carries a `legacySloMetricAlertSpecs` array or a metric alert on `requests/failed`,
  `requests/duration` or `dependencies/failed`. The only `Microsoft.Insights/metricAlerts` resource
  left in each is the unrelated severity 1 gateway-availability alert, which stays because
  availability has no status-code confound and never produced a false page
  (`MMCA.ADC/infra/main.bicep:672`, severity at `:678`;
  `MMCA.Store/infra/main.bicep:685`, severity at `:691`). The `-v2` suffix on
  the replacements is what made that removal safe and is now part of each rule's identity in Azure:
  renaming it would create a second rule alongside the live one rather than update it, and the
  unsuffixed names stay occupied in the resource group by the superseded alerts, which an incremental
  ARM deployment does not delete just because they left the template
  (`MMCA.ADC/infra/main.bicep:437-438`, `MMCA.Store/infra/main.bicep:337-339`).

- **One unconditional action group.** `alertEmailAddress` is a required parameter with no default
  (`MMCA.ADC/infra/main.bicep:124`, `MMCA.Store/infra/main.bicep:91`), so the action group's email
  receiver is not conditional (`MMCA.ADC/infra/main.bicep:310-324`, its receiver at `:318-320`;
  `MMCA.Store/infra/main.bicep:265`) and every scheduled query rule routes to it
  (`MMCA.ADC/infra/main.bicep:492`, `MMCA.Store/infra/main.bicep:380`). The monthly cost budget
  notifies the same group (`MMCA.ADC/infra/main.bicep:748`, `:756`;
  `MMCA.Store/infra/main.bicep:763`, `:771`).

- **A saved workbook renders three of the SLO signals.** `sloWorkbook`
  (`MMCA.ADC/infra/main.bicep:711`, `MMCA.Store/infra/main.bicep:726`) is bound to the Log Analytics
  workspace and embeds `workbooks/adc-slo-workbook.json` / `workbooks/store-slo-workbook.json` at
  compile time via `loadTextContent` (`MMCA.ADC/infra/main.bicep:720`,
  `MMCA.Store/infra/main.bicep:735`), grouped per service by `AppRoleName`, so the visualization cannot
  diverge from the alerts by being maintained somewhere else. Both workbooks carry the same five
  panels, covering requests and failures, response-time percentiles and dependency calls and
  failures; neither has a panel for `resilience-circuit-open`, and ADC's has none for its AI token
  ceiling, so those specs page without a matching view
  (`MMCA.ADC/infra/workbooks/adc-slo-workbook.json`, which mentions neither
  `resilience.polly.strategy.events` nor the `mmca.ai` counters, and
  `MMCA.Store/infra/workbooks/store-slo-workbook.json`). Nothing gates that pairing: the build gate
  pairs alerts with runbook sections, not with workbook panels.

- **`infra/OPERATIONS.md` is the paired artifact.** Each repo's runbook carries one `###` section per
  SLO alert whose heading contains the `-alert-<key>` infix and the alert's severity as `(sev N)`
  (`MMCA.ADC/infra/OPERATIONS.md:17`, `:31`, `:50`; `MMCA.Store/infra/OPERATIONS.md:17`, `:32`, `:55`),
  each followed by numbered triage steps. Both runbooks carry the section the
  `resilience-circuit-open` spec requires (`MMCA.ADC/infra/OPERATIONS.md:63`,
  `MMCA.Store/infra/OPERATIONS.md:69`), both tagged `(sev 2)` to match, and ADC's carries a fifth for
  its AI token ceiling (`MMCA.ADC/infra/OPERATIONS.md:111`, tagged `(sev 3)`). Restore procedure is
  deliberately not duplicated here: the
  runbook defers it to `DISASTER-RECOVERY.md` (`MMCA.ADC/infra/OPERATIONS.md:4-6`,
  `MMCA.Store/infra/OPERATIONS.md:4-6`).

- **The pairing is enforced by a framework test base, and it fails the build.**
  `ObservabilityConventionTestsBase`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/ObservabilityConventionTestsBase.cs:30`)
  ships three facts:
  - `SloAlertSpecs_AreDiscovered_GateIsNotVacuous` requires at least `MinimumAlertSpecs` discovered
    specs, default 3 (`ObservabilityConventionTestsBase.cs:39`, asserted at `:54-61`), so a drifted
    parse anchor fails loudly instead of passing with zero alerts. The property is virtual, and each
    consumer raises it to its own spec count (below), so the floor also catches a spec that goes
    missing, not only a parser that discovers nothing.
  - `EveryProvisionedSloAlert_HasASeverityCorrectRunbookSection` fails when a spec has no `###` heading
    containing `-alert-<key>` (`:64-78`, the infix constant at `:32`, the lookup at `:73`) **and**
    fails when the matching heading does not carry `(sev N)` for that spec's current severity
    (`:80-84`), so re-tiering an alert without moving its runbook is a red build.
  - `EveryRunbookAlertSection_MapsToAProvisionedAlert` fails on an orphan runbook section whose alert no
    longer exists (`:92-103`).
  Discovery parses the template between the literal anchors `var sloAlertSpecs` and
  `resource sloAlerts` (`:109-114`) with two source-generated regexes (`:139-143`), and a key-count
  versus severity-count mismatch is itself a failure (`:117`), so a change to the spec shape cannot
  quietly desynchronize the parser.

- **Consumers wire it with an embedded-resource pair and a one-override subclass.** The base reads
  `infra.main.bicep` and `infra.OPERATIONS.md` (`ObservabilityConventionTestsBase.cs:42`, `:45`) from
  `ResourceAssembly`, which defaults to the **derived** type's assembly (`:51`); resolving against the
  base's own assembly would look for the consumer's template inside the framework package and always
  throw. Each consumer embeds the two real files under those logical names
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/MMCA.ADC.Architecture.Tests.csproj:17-22`,
  `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/MMCA.Store.Architecture.Tests.csproj:19-24`)
  and declares a subclass whose only member raises `MinimumAlertSpecs` to that consumer's spec count:
  5 for ADC
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/ObservabilityConventionTests.cs:7`,
  the override at `:14`) and 4 for Store
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
it is an inapplicable one. MMCA.Common runs the base against its own fixture pair, not against a real
deployment.

**Coverage boundary inside the templates.** The gate covers exactly the alerts declared between the two
parse anchors: five specs on ADC (the four shared SLOs plus `ai-scoring-token-ceiling`) and four on
Store. Eleven further alerts sit outside that window, five on ADC and six on Store. ADC provisions a
three-entry `scheduledQueryAlertSpecs` array (`MMCA.ADC/infra/main.bicep:520`, keys
`outbox-dead-letter` at `:522`, `sql-dependency-failures` at `:528` and `revision-activation-failed`
at `:534`, materialized at `:541`, all severity 2 at `:548`), a `log-ingestion-cap-reached` rule
(`:593`, severity 2 at `:600`), and a severity 1 gateway-availability metric alert over a
three-location URL ping web test (`:639`, alert at `:672`, severity at `:678`). Store provisions six
as standalone resources rather than from an array: the `outbox-dead-letter` scheduled query rule
(`MMCA.Store/infra/main.bicep:400`, severity 2 at `:407`), the `revision-activation-failed` rule over
`ContainerAppSystemLogs_CL` (`:450`, severity 2 at `:457`) that closes the gap where a revision whose
readiness never went green left the previous revision serving and paged nobody,
`auth-failure-spike` (`:518`, severity 2 at `:525`), `forbidden-burst` (`:558`, severity 3 at
`:565`), `log-ingestion-quota` (`:604`, severity 2 at `:611`), and the outside-in Gateway availability
web test (`:652`) with its severity 1 metric alert (`:685`, severity at `:691`), alongside the four
SLO rules and the budget notifications. Every one of those eleven sits after its own template's
`sloAlerts` loop closes (`MMCA.ADC/infra/main.bicep:435-496`, `MMCA.Store/infra/main.bicep:335-384`)
and therefore outside the parse window, so the pairing gate neither requires nor forbids runbook
sections for any of them.

Both consumers write triage for all of that ungated space, and both keep it out of the gate's reach
on purpose. Each repo's `OPERATIONS.md` carries an `## Operational alert runbooks` section of `####`
headings with numbered triage steps, one per ungated family it provisions. Store's
(`MMCA.Store/infra/OPERATIONS.md:115`) holds all six: `store-alert-outbox-dead-letter` (sev 2) at
`:123`, `store-alert-revision-activation-failed` (sev 2) at `:146`, `store-alert-gateway-availability`
(sev 1) at `:173`, `store-alert-auth-failure-spike` (sev 2) at `:194`, `store-alert-forbidden-burst`
(sev 3) at `:231` and `store-alert-log-ingestion-quota` (sev 2) at `:251`. ADC's
(`MMCA.ADC/infra/OPERATIONS.md:149`) sits after its five `###` SLO sections and holds all five:
`adc-prod-alert-outbox-dead-letter` (sev 2) at `:162`, `adc-prod-alert-sql-dependency-failures`
(sev 2) at `:205`, `adc-prod-alert-revision-activation-failed` (sev 2) at `:231`,
`adc-prod-alert-log-ingestion-cap-reached` (sev 2) at `:261` and `adc-prod-alert-gateway-availability`
(sev 1) at `:295`, named with the full deployed names its SLO headings already use. ADC's preamble
counts the five and records that the AI token ceiling moved into the gated section
(`MMCA.ADC/infra/OPERATIONS.md:151-160`). The headings are `####` rather than `###` in both repos,
because `RunbookHeadingRegex` is `^###\s+.*$` (`ObservabilityConventionTestsBase.cs:145-146`) and
does not match a `####` line: an `###` heading naming a non-spec alert would read to
`EveryRunbookAlertSection_MapsToAProvisionedAlert` as an orphan section and fail the build. Each
runbook states that reasoning inline, above its own first `####` heading
(`MMCA.Store/infra/OPERATIONS.md:119-121`, `MMCA.ADC/infra/OPERATIONS.md:156-158`). So the triage
exists and is discoverable at 3am for all eleven ungated alerts, while the gate sees exactly five
paired alerts on ADC and four on Store. The one provisioning asymmetry in the ungated space is
deliberate: Store does not port `sql-dependency-failures`, because its own `dependency-failures` SLO
rule already spans SQL, gRPC and HTTP (`MMCA.Store/infra/main.bicep:313-315`), which the template
records beside the outbox rule (`:398-399`), so a narrower SQL-scoped twin would page twice for one
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
- **The gate checks pairing and severity, nothing else.** Whether 10 failures per 15 minutes is the
  right threshold, whether the query measures what it claims, and whether the triage steps are correct
  all remain review concerns. Severity is the only value cross-checked between the two files.
- **Only the spec-window alerts are covered.** ADC's outbox dead-letter, SQL dependency,
  revision-activation, log-ingestion-cap and gateway-availability alerts and Store's outbox
  dead-letter, revision-activation, auth-failure-spike, forbidden-burst, log-ingestion-quota and
  gateway-availability alerts are provisioned but ungated, so all eleven can be added, renamed or
  re-tiered with no **build** consequence. That is not the same as no consequence. All eleven have
  written triage today (Store `MMCA.Store/infra/OPERATIONS.md:123`, `:146`, `:173`, `:194`, `:231`,
  `:251`; ADC `MMCA.ADC/infra/OPERATIONS.md:162`, `:205`, `:231`, `:261`, `:295`), but because those
  `####` sections are invisible to the gate by design, a new ungated alert with no section, or a
  re-tiered or renamed one whose section was not moved, fails nothing. Both runbooks record the
  honour-system caveat themselves, in their Governance sections
  (`MMCA.Store/infra/OPERATIONS.md:308-313`, `MMCA.ADC/infra/OPERATIONS.md:336-341`), and both now
  state the gated count their template declares (five on ADC, four on Store) and the floor their
  subclass sets. Nothing checks either sentence, because the gate matches headings, not prose.
- **The template is not the inventory of the resource group.** The superseded metric alerts are gone
  from both templates, but an incremental ARM deployment does not delete what it stops declaring, so
  their unsuffixed names stay occupied in the resource group, and the template says so
  (`MMCA.Store/infra/main.bicep:337-339`). Anything that exists only in Azure is invisible to every
  check in this record: the pairing gate parses the template, not the deployment.
- **The runbook heading is not the deployed resource name.** The gate matches only the `-alert-<key>`
  infix, so the prefix in a heading is unchecked. Live rules resolve from `prefix` and carry the `-v2`
  suffix. ADC's headings spell that deployed name out in full, `adc-prod-alert-failed-requests-v2`
  (`MMCA.ADC/infra/OPERATIONS.md:17`), which matches only because `prefix` is `adc-${environmentName}`
  (`MMCA.ADC/infra/main.bicep:157`) and the deployed environment is `prod`: the same runbook read
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

## Related
ADR-041 (the telemetry this alerts on top of: it defines emission, instrumentation and cost knobs and
stops before thresholds, severities and runbooks), ADR-009 (recovery objectives and the drilled
`DISASTER-RECOVERY.md` these runbooks defer restore procedure to; that record is detection's recovery
sibling), ADR-015 (fitness functions: the pairing gate is one, wired through the same shared-package
plus per-repo-subclass extension point), ADR-058 (the other package-shipped test tier, which boots a
real host to assert runtime contracts, where this one parses the consumer's IaC and runbook text).
