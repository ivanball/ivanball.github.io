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
   (`MMCA.ADC/infra/main.bicep:282-295`).

## Decision
Declare each consumer's SLO alerts as **data in its Bicep template**, materialize them as Log Analytics
scheduled query rules, and make the alert-to-runbook pairing a **build gate shipped by the framework**.

- **`sloAlertSpecs` is the declaration.** A single array of records carrying `key`, `description`,
  `query`, `timeAggregation`, `metricMeasureColumn`, `threshold` and `severity`
  (`MMCA.ADC/infra/main.bicep:296`, `MMCA.Store/infra/main.bicep:254`). Both consumers declare the same
  three SLOs with the same numbers: `failed-requests` (severity 2, more than 10 per 15 min),
  `server-response-time` (severity 3, average above 3000ms), `dependency-failures` (severity 2, more
  than 10 per 15 min) (`MMCA.ADC/infra/main.bicep:296-324`, `MMCA.Store/infra/main.bicep:254-282`).

- **Materialized as Log Analytics scheduled query rules.** One `Microsoft.Insights/scheduledQueryRules`
  per spec (`MMCA.ADC/infra/main.bicep:326`, `MMCA.Store/infra/main.bicep:284`), named
  `${prefix}-alert-${spec.key}-v2` (`MMCA.ADC/infra/main.bicep:330`,
  `MMCA.Store/infra/main.bicep:289`), enabled, scoped to the Log Analytics workspace, evaluated every
  5 minutes over a 15-minute window with `autoMitigate`
  (`MMCA.ADC/infra/main.bicep:339-341`, `MMCA.Store/infra/main.bicep:298-300`). A `union(...)` supplies
  `metricMeasureColumn` only for the aggregate rule; the empty-string case makes a rule count returned
  **rows**, which is what the two failure-count SLOs want
  (`MMCA.ADC/infra/main.bicep:347-359`, `MMCA.Store/infra/main.bicep:306-318`).

- **The KQL predicate is the point of the migration.** The failure queries exclude only 401 and 499
  (`MMCA.ADC/infra/main.bicep:300`, `:318`; `MMCA.Store/infra/main.bicep:258`, `:276`) and the latency
  query excludes `/hubs/` requests before averaging `DurationMs`
  (`MMCA.ADC/infra/main.bicep:309`, `MMCA.Store/infra/main.bicep:267`). A genuine 400 or 500 burst
  still pages at the same threshold as before.

- **The superseded metric alerts are no longer declared, and the `-v2` names stay.** Neither template
  carries a `legacySloMetricAlertSpecs` array or a metric alert on `requests/failed`,
  `requests/duration` or `dependencies/failed`. The only `Microsoft.Insights/metricAlerts` resource
  left in each is the unrelated severity 1 gateway-availability alert, which stays because
  availability has no status-code confound and never produced a false page
  (`MMCA.ADC/infra/main.bicep:369-370`, `:474`; `MMCA.Store/infra/main.bicep:416`). The `-v2` suffix on
  the replacements is what made that removal safe and is now part of each rule's identity in Azure:
  renaming it would create a second rule alongside the live one rather than update it, and the
  unsuffixed names stay occupied in the resource group by the superseded alerts, which an incremental
  ARM deployment does not delete just because they left the template
  (`MMCA.ADC/infra/main.bicep:328-329`, `MMCA.Store/infra/main.bicep:286-288`).

- **One unconditional action group.** `alertEmailAddress` is a required parameter with no default
  (`MMCA.ADC/infra/main.bicep:113`, `MMCA.Store/infra/main.bicep:83`), so the action group's email
  receiver is not conditional (`MMCA.ADC/infra/main.bicep:266-280`,
  `MMCA.Store/infra/main.bicep:226-240`) and every scheduled query rule routes to it
  (`MMCA.ADC/infra/main.bicep:363`, `MMCA.Store/infra/main.bicep:322`). The monthly cost budget
  notifies the same group (`MMCA.ADC/infra/main.bicep:545`, `:553`;
  `MMCA.Store/infra/main.bicep:487`, `:495`).

- **A saved workbook renders the same three signals.** `sloWorkbook`
  (`MMCA.ADC/infra/main.bicep:508`, `MMCA.Store/infra/main.bicep:450`) is bound to the Log Analytics
  workspace and embeds `workbooks/adc-slo-workbook.json` / `workbooks/store-slo-workbook.json` at
  compile time via `loadTextContent` (`MMCA.ADC/infra/main.bicep:517`,
  `MMCA.Store/infra/main.bicep:459`), grouped per service by `AppRoleName`, so the visualization cannot
  diverge from the alerts by being maintained somewhere else.

- **`infra/OPERATIONS.md` is the paired artifact.** Each repo's runbook carries one `###` section per
  SLO alert whose heading contains the `-alert-<key>` infix and the alert's severity as `(sev N)`
  (`MMCA.ADC/infra/OPERATIONS.md:15`, `:29`, `:42`; `MMCA.Store/infra/OPERATIONS.md:16`, `:31`, `:44`),
  each followed by numbered triage steps. Restore procedure is deliberately not duplicated here: the
  runbook defers it to `DISASTER-RECOVERY.md` (`MMCA.ADC/infra/OPERATIONS.md:4-6`,
  `MMCA.Store/infra/OPERATIONS.md:4-6`).

- **The pairing is enforced by a framework test base, and it fails the build.**
  `ObservabilityConventionTestsBase`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ObservabilityConventionTestsBase.cs:30`)
  ships three facts:
  - `SloAlertSpecs_AreDiscovered_GateIsNotVacuous` requires at least `MinimumAlertSpecs` discovered
    specs, default 3 (`ObservabilityConventionTestsBase.cs:39`, asserted at `:54-61`), so a drifted
    parse anchor fails loudly instead of passing with zero alerts.
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

- **Consumers wire it with an embedded-resource pair and an empty subclass.** The base reads
  `infra.main.bicep` and `infra.OPERATIONS.md` (`ObservabilityConventionTestsBase.cs:42`, `:45`) from
  `ResourceAssembly`, which defaults to the **derived** type's assembly (`:51`); resolving against the
  base's own assembly would look for the consumer's template inside the framework package and always
  throw. Each consumer embeds the two real files under those logical names
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/MMCA.ADC.Architecture.Tests.csproj:17-22`,
  `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/MMCA.Store.Architecture.Tests.csproj:19-24`)
  and declares a body-less subclass
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/ObservabilityConventionTests.cs:7`,
  `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/ObservabilityConventionTests.cs:7`), so
  the default floor of 3 applies to both. Both test projects are in the CI solution filter
  (`MMCA.ADC/MMCA.ADC.CI.slnf:58`, `MMCA.Store/MMCA.Store.CI.slnf:53`), so the gate runs in the same
  deploy-gating test job as the rest of the fitness tier.

- **The framework guards its own indirection.** `ObservabilityConventionTestsBaseTests`
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/ObservabilityConventionTestsBaseTests.cs:14`)
  subclasses the base from a different assembly, re-points it at a fixture template and runbook
  (`:16-18`), and asserts `ResourceAssembly` is the derived assembly and not the base's (`:27-28`). The
  regression it exists for is silent: framework CI would stay green and the break would surface only in
  the first consumer that adopted the gate.

**Adoption boundary.** ADC and Store only. MMCA.Helpdesk does **not** subclass this base and has no
`infra/*.bicep` at all, so there is nothing for the gate to pair; it is not an un-adopted gate there,
it is an inapplicable one. MMCA.Common runs the base against its own fixture pair, not against a real
deployment.

**Coverage boundary inside the templates.** The gate covers exactly the alerts declared between the two
parse anchors. ADC additionally provisions two operational scheduled query rules,
`outbox-dead-letter` and `sql-dependency-failures` (`MMCA.ADC/infra/main.bicep:385`, materialized at
`:402`, severity 2 at `:407`), and a severity 1 gateway-availability metric alert over a three-location
URL ping web test (`MMCA.ADC/infra/main.bicep:441`, alert at `:475`, severity at `:480`). All three sit
outside the `sloAlertSpecs` window, so the pairing gate neither requires nor forbids runbook sections
for them. Store provisions both of the families
that apply to it, merged on 2026-08-13: the `outbox-dead-letter` scheduled query rule
(`MMCA.Store/infra/main.bicep:342`) and the outside-in Gateway availability web test (`:383`) with its
severity 1 metric alert (`:416`, severity at `:422`), alongside the three SLO rules and the budget
notifications. Both sit after the `sloAlerts` window closes
(`MMCA.Store/infra/main.bicep:284-326`) and therefore outside the parse window, so Store's two extras
are ungated exactly as ADC's three are.

Both consumers write triage for that ungated space, and both keep it out of the gate's reach on
purpose. Each repo's `OPERATIONS.md` carries an `## Operational alert runbooks` section holding one
`####` heading per ungated alert family that repo provisions, each with numbered triage steps. Store's
(`MMCA.Store/infra/OPERATIONS.md:58`) holds `store-alert-outbox-dead-letter` (sev 2) at `:66` and
`store-alert-gateway-availability` (sev 1) at `:89`. ADC's sits after its three `###` SLO sections in
`MMCA.ADC/infra/OPERATIONS.md` and holds `adc-prod-alert-outbox-dead-letter` (sev 2),
`adc-prod-alert-sql-dependency-failures` (sev 2) and `adc-prod-alert-gateway-availability` (sev 1),
named with the full deployed names its SLO headings already use. The headings are `####` rather than
`###` in both repos, because `RunbookHeadingRegex` is `^###\s+.*$`
(`ObservabilityConventionTestsBase.cs:145-146`) and does not match a `####` line: an `###` heading
naming a non-spec alert would read to `EveryRunbookAlertSection_MapsToAProvisionedAlert` as an orphan
section and fail the build. Each runbook states that reasoning inline, above its own first `####`
heading (`MMCA.Store/infra/OPERATIONS.md:62-64` and the matching prose in ADC's section). So the
triage exists and is discoverable at 3am on both sides, while the gate still sees exactly three paired
alerts on each side. The one provisioning asymmetry that remains is deliberate: Store does not port
`sql-dependency-failures`, because its own `dependency-failures` SLO rule already spans SQL, gRPC and
HTTP (`MMCA.Store/infra/main.bicep:340-341`), so a narrower SQL-scoped twin would page twice for one
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
- **Only the spec-window alerts are covered.** ADC's outbox dead-letter, SQL dependency and
  gateway-availability alerts and Store's outbox dead-letter and gateway-availability alerts are
  provisioned but ungated, so all five can be added, renamed or re-tiered with no **build**
  consequence. That is not the same as no consequence: all five have written triage (Store
  `MMCA.Store/infra/OPERATIONS.md:66`, `:89`; ADC's three in the `## Operational alert runbooks`
  section of `MMCA.ADC/infra/OPERATIONS.md`), and because those `####` sections are invisible to
  the gate by design, re-tiering or renaming any of them leaves stale runbook text that nothing
  checks. Both runbooks record that honour-system caveat themselves, in their Governance sections
  (`MMCA.Store/infra/OPERATIONS.md:126-128` and the ADC equivalent).
- **The template is not the inventory of the resource group.** The superseded metric alerts are gone
  from both templates, but an incremental ARM deployment does not delete what it stops declaring, so
  their unsuffixed names stay occupied in the resource group, and the template says so
  (`MMCA.Store/infra/main.bicep:286-288`). Anything that exists only in Azure is invisible to every
  check in this record: the pairing gate parses the template, not the deployment.
- **The runbook heading is not the deployed resource name.** The gate matches only the `-alert-<key>`
  infix, so the prefix in a heading is unchecked. Live rules resolve from `prefix` and carry the `-v2`
  suffix, while the headings read `adc-alert-failed-requests` and `store-alert-failed-requests`. On ADC
  the gap is only the environment segment and the suffix (`prefix` is `adc-${environmentName}`,
  `MMCA.ADC/infra/main.bicep:134`). On Store the prefix does not match at all: `prefix` is
  `mmca-${environmentName}` (`MMCA.Store/infra/main.bicep:101`), so the deployed rule is
  `mmca-<env>-alert-failed-requests-v2` against a heading that starts `store-`. A heading is therefore
  a searchable handle, not a literal copy of what an operator sees in the portal, and on Store it is
  not even a prefix match on the resource name.
- **One action group, one receiver, no routing.** Severity 1 and severity 3 land in the same inbox,
  alongside budget notifications. Severity is metadata for triage order, not a delivery decision.
- **Adoption is opt-in per consumer.** A consumer that provisions alerts without embedding the two
  resources and subclassing the base gets no gate at all, the same audit-the-inventory caveat that
  applies to the rest of the fitness tier (ADR-015).

## Related
ADR-041 (the telemetry this alerts on top of: it defines emission, instrumentation and cost knobs and
stops before thresholds, severities and runbooks), ADR-009 (recovery objectives and the drilled
`DISASTER-RECOVERY.md` these runbooks defer restore procedure to; that record is detection's recovery
sibling), ADR-015 (fitness functions: the pairing gate is one, wired through the same shared-package
plus per-repo-subclass extension point), ADR-058 (the other package-shipped test tier, which boots a
real host to assert runtime contracts, where this one parses the consumer's IaC and runbook text).
