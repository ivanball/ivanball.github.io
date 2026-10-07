# ADR-080: Production Rollout with Automatic Revision-Only Rollback

## Status
Accepted (2026-08-14). Revised 2026-09-03 (the smoke gate is now two tiers: a revision **activation**
gate runs before the HTTP probes, and the rollback selector filters on `healthState` instead of
taking a positional index, which closes the overshoot trade-off this record used to carry. The
pre-deploy gate sets have re-converged: Store's `deploy` job waits on eleven needs and ADC's on
twelve (ADC adds `ai-eval-gate`), `backend-test-gate` included in both, so neither rests on the
smoke gate as its only backend backstop. The rollout and revision-only rollback model itself is
unchanged, and the citation anchors are refreshed).
Anchors refreshed 2026-10-01.
Revised 2026-10-07: the four recency gates now run as steps of one `freshness` job and
`backend-test-gate` is retired, so `deploy` waits on seven needs in Store and eight in ADC, and the
test gate is the pull request's required checks.
Revised 2026-10-07: anchors refreshed after the v1.233.0 release and the Store and ADC deploy
workflow prunes; the rollout and revision-only rollback model is unchanged.

## Context
Both production apps deploy to Azure Container Apps from a single `deploy.yml` job on push to `main`,
and every gate runs **before** anything rolls out. The `deploy` job waits on seven needs in Store
(`MMCA.Store/.github/workflows/deploy.yml:1083`) and eight in ADC
(`MMCA.ADC/.github/workflows/deploy.yml:1145`): the shared seven are `changes`, `supply-chain`,
`cost-guard`, the `freshness` job (whose four steps are the recency gates `dr-freshness`, `load-freshness`,
`cross-service-freshness` and `cross-browser-freshness`), the chromium `e2e-gate`, `foundation` and
`build-images`, and ADC adds `ai-eval-gate` for its AI session scorer (ADR-111). The
image matrix pushes to ACR without rolling anything out. The rollout itself is one `azure/arm-deploy`
step over `infra/main.bicep` (`MMCA.Store/.github/workflows/deploy.yml:1300-1306`,
`MMCA.ADC/.github/workflows/deploy.yml:1433-1439`).

The question that step leaves open is what happens **after** ARM returns success. ARM success means
the revision was accepted by the control plane, not that it serves: a container that boots, fails to
reach Key Vault or its database, and crash-loops is still a successful template deployment. Without a
post-deploy check, a green workflow run and a dead production are the same colour.

Two existing records already reason from an answer that was never itself written down. ADR-057 states
the premise outright: "production rollback is **revision-only**", the deploy reverts the image "and
nothing else", and the previous release therefore keeps serving against the **new** schema
(`Website/docs-src/adr/057-expand-contract-schema-evolution-gate.md:20-26`), which is the entire
justification for its expand/contract guard. ADR-030 depends on the same model from the other side:
startup migration is the sole migrator, so a failed startup migration fails the new revision and
"there is no automated down-migration"
(`Website/docs-src/adr/030-startup-sole-migrator.md:78-80`). Both CONTRIBUTING files say the same
thing to contributors (`MMCA.Store/CONTRIBUTING.md:56-59`, `MMCA.ADC/CONTRIBUTING.md:57-60`). This
ADR records the rollout and rollback model those documents assume.

## Decision
Roll out one revision at a time, verify it from outside, and auto-revert the **image only** when the
verification fails.

- **Single-revision rollout.** Every container app runs `activeRevisionsMode: 'Single'`, so a deploy
  replaces the serving revision rather than splitting traffic across two: Store's identity, catalog,
  sales, gateway and ui apps (`MMCA.Store/infra/main.bicep:1433,1612,1736,1885,2014`) and ADC's
  identity, conference, engagement, notification, gateway and ui apps
  (`MMCA.ADC/infra/main.bicep:1688,1935,2088,2223,2413,2576`). There is no canary or blue/green stage
  and no traffic-splitting step.
- **Readiness gating is the first line of defence.** Every app carries startup, liveness and
  readiness probes, so ACA holds user traffic on the old revision until the new one is ready
  (`MMCA.Store/infra/main.bicep:1585-1587`, five apps at `:1585,1709,1854,1964,2089`;
  `MMCA.ADC/infra/main.bicep:1886-1911`, six apps at `:1886,2039,2174,2341,2504,2658`). Every
  backend and the UI take readiness on `/health/ready`, which is the ADR-025 warm-up gate doing
  rollout duty. The Gateway is the exception in both repos: its readiness probe is `/alive`, because
  its `/health/ready` fans out to every downstream and would let one failed downstream mark the only
  Gateway replica unready, and the Gateway has no JwtBearer warm-up task to wait for
  (`MMCA.Store/infra/main.bicep:1966-1973`, `MMCA.ADC/infra/main.bicep:2520-2529`).
- **A two-tier post-deploy smoke gate is the last gating step of the deploy job.** `Smoke test
  (rollback on failure)` verifies the freshly deployed fleet from outside Azure
  (`MMCA.Store/.github/workflows/deploy.yml:1338`, `MMCA.ADC/.github/workflows/deploy.yml:1475`):
  tier 1 proves the new revisions activated, tier 2 probes them over HTTP, and only these two can
  fail the job. The shared `probe` helper retries 12 times with a 15-second curl timeout and a
  10-second sleep between attempts (`MMCA.Store/.github/workflows/deploy.yml:1351-1360`,
  `MMCA.ADC/.github/workflows/deploy.yml:1488-1497`); Store adds a `probe_post` twin with the same
  retry loop and exact-status rule (`MMCA.Store/.github/workflows/deploy.yml:1364-1374`). The step
  runs under `set -uo pipefail` without `-e` (`:1345`, `:1482`), so a failed probe records the
  failure instead of aborting the step before the rollback loop can run.
- **Tier 1 is a revision activation gate and runs before any probe.** For every app the newest
  revision by `createdTime` must report `healthState` `Healthy`, a `runningState` of `Running` or
  `RunningAtMaxScale`, and `trafficWeight` 100, polled 30 times at 20-second intervals (about ten
  minutes) (`MMCA.Store/.github/workflows/deploy.yml:1398-1428`,
  `MMCA.ADC/.github/workflows/deploy.yml:1521-1550`). This is the tier that proves the code this run
  built is the code now serving, and Store's comment records the incident it closes
  (`MMCA.Store/.github/workflows/deploy.yml:1321-1327`): between 2026-08-28 and 2026-09-02 every
  backend revision failed activation, ACA kept the previous revision serving, and the step went green
  because the HTTP probes were answered perfectly by five-day-old code. Both repos read the revision
  as JSON and join it with `jq` rather than asking for `-o tsv`, because a top-level JMESPath
  multiselect list rendered as TSV prints one element per line instead of one tab-separated row and
  every field after the first parses back empty
  (`MMCA.Store/.github/workflows/deploy.yml:1334-1337,1376-1386`,
  `MMCA.ADC/.github/workflows/deploy.yml:1499-1510`).
- **Tier 2 probes assert an expected status code, not merely "not an error".** Store checks Gateway
  `/health`, `/.well-known/jwks.json` (through to Identity), `/Products` (Catalog, anonymous),
  `/Orders` asserted as exactly **401**, an unsigned `POST /Payments/webhook` asserted as exactly
  **400** (the Stripe webhook path rejecting a delivery with no signature), plus the UI root
  (`MMCA.Store/.github/workflows/deploy.yml:1430-1448`); ADC checks Gateway `/health`,
  JWKS, `/Events` (Conference, anonymous), `/Bookmarks` and `/Notifications/inbox` both asserted as
  **401**, plus the UI root (`MMCA.ADC/.github/workflows/deploy.yml:1552-1563`). An
  anonymous 200 on a protected route is a failure, because it would mean authorization stopped being
  enforced; a 401 from the service proves the request traversed Gateway to service to auth pipeline.
- **Hardening checks observe, they do not gate.** The Gateway `X-Content-Type-Options` check prints a
  warning and never sets the failure flag, because a missing hardening header is not a
  "revision not serving" condition and must not trip a fleet-wide rollback
  (`MMCA.Store/.github/workflows/deploy.yml:1450-1457`,
  `MMCA.ADC/.github/workflows/deploy.yml:1565-1572`).
- **On failure, walk every app back to its last healthy revision.** The loop iterates the full app
  list (five for Store at `MMCA.Store/.github/workflows/deploy.yml:1346`, six for ADC at
  `MMCA.ADC/.github/workflows/deploy.yml:1483`). Per app it first re-reads the newest revision and
  skips that app entirely when the revision is already Healthy, Running and holding 100% of the
  traffic (`MMCA.Store/.github/workflows/deploy.yml:1473-1483`,
  `MMCA.ADC/.github/workflows/deploy.yml:1585-1592`), so a gate that failed for some other reason
  cannot undo a good activation. For the rest it selects the newest revision that is `active`,
  `Provisioned`, `Healthy` and not the newest by name, then issues
  `az containerapp revision copy --from-revision`
  (`MMCA.Store/.github/workflows/deploy.yml:1484-1496`,
  `MMCA.ADC/.github/workflows/deploy.yml:1593-1607`). Every app is attempted before any failure is
  reported, so one bad app does not abandon the rest, and the `az` call is deliberately **not** piped:
  a pipeline would report `tail`'s exit status and every rollback would look successful
  (`MMCA.Store/.github/workflows/deploy.yml:1491-1493`).
- **A failed rollback escalates louder than a failed deploy.** Apps whose rollback failed accumulate
  in `rollback_failed`, and the step writes a "Smoke gate failed AND rollback incomplete" block into
  the job summary naming them, because a fleet split across revisions needs immediate manual attention
  and must never read as a clean auto-revert
  (`MMCA.Store/.github/workflows/deploy.yml:1501-1509`,
  `MMCA.ADC/.github/workflows/deploy.yml:1580-1582,1615-1623`).
- **The run fails either way.** After the rollback loop the step exits 1
  (`MMCA.Store/.github/workflows/deploy.yml:1510`, `MMCA.ADC/.github/workflows/deploy.yml:1624`), so
  a reverted deploy is still a red run: recovery is automatic, but it is never silent.
- **What runs after the gate is housekeeping and cannot fail the deploy.** A build-cache purge is the
  job's final step and carries `continue-on-error: true`
  (`MMCA.Store/.github/workflows/deploy.yml:1512-1530`,
  `MMCA.ADC/.github/workflows/deploy.yml:1626-1644`), so a throttled or failed ACR purge can neither
  redden a good rollout nor reach the rollback path. Verification ends at the smoke gate.
- **Rollback is revision-only and never touches data or schema.** There is no down-migration step and
  no deploy-time `sqlcmd` backstop anywhere in the pipeline; each service self-applies its own
  migrations at startup as the sole migrator
  (`MMCA.Store/.github/workflows/deploy.yml:1308-1316`,
  `MMCA.ADC/.github/workflows/deploy.yml:1441-1451`). Reverting the image therefore leaves the new
  schema in place, which is exactly why ADR-057 requires every migration to be backward compatible
  one release back.

## Rationale
- **ARM success is the wrong success signal.** The smoke gate converts "the control plane accepted the
  template" into "the fleet is serving the revision this run built", which is the only claim a deploy
  should be green on. Neither repo rests on it as its only backend backstop: in both, the test gate is
  the pull request's required checks, because branch protection enforces admins and requires an
  up-to-date branch, so the merged tree is the PR-tested tree
  (`MMCA.Store/.github/workflows/deploy.yml:1084-1086`, `MMCA.ADC/.github/workflows/deploy.yml:1146-1148`),
  and the smoke gate is a second line of defence rather than the gate of record.
- **Activation is a different question from reachability, so it gets its own tier.** Every HTTP probe
  enters through the Gateway, and a healthy Gateway keeps answering from the previous backend
  revision when the new one never goes ready, so probes alone can only prove that *something* serves
  (`MMCA.ADC/.github/workflows/deploy.yml:1453-1474`). Asking the control plane which revision holds
  the traffic is the only check that distinguishes a shipped deploy from a silently skipped one.
- **Probing through the Gateway exercises the real path.** Hitting the public Gateway FQDN rather than
  each service directly proves ingress, YARP routing, service discovery and the target service's auth
  pipeline in one request, which is what actually breaks: a service that deployed but cannot reach its
  secrets or database fails JWKS long before it fails a container health probe.
- **Revision-only rollback is the cheap half that is safe to automate.** Copying a previous revision
  is idempotent, fast and side-effect-free. Reverting data is neither, so it stays a human decision
  backed by the drilled restore path (ADR-009) instead of being attempted by a workflow step at 2 a.m.
- **Single-revision mode keeps the failure model legible.** With no traffic splitting there is exactly
  one serving revision per app, so "roll back" has an unambiguous meaning and the post-failure state is
  either fully reverted or explicitly reported as split.
- **Loud beats tidy.** Failing the run after a successful rollback, and escalating harder when the
  rollback itself failed, keeps a broken release visible; a workflow that self-healed quietly would let
  the same bad commit ship again.

## Trade-offs
- **Schema is never rolled back, so a bad migration is fix-forward only.** The image reverts and the
  database does not, so the previous release resumes against the new schema. This is the constraint
  ADR-057's expand/contract guard exists to keep survivable, and a half-applied migration still needs
  manual recovery (ADR-030). A destructive migration turns the rollback path itself into a broken
  release.
- **A mid-fleet rollback failure splits revisions.** The loop is best-effort per app, so a partial
  failure leaves some apps on the new revision and some on the old, with no automated reconciliation:
  the escalation in the job summary is the entire remediation, and it is manual.
- **Smoke-test blind spots.** The tier-2 probes assert HTTP status codes on a handful of anonymous
  endpoints. The stale-code blind spot is closed: a green gate answered by the previous revision is
  now caught by tier 1 (`MMCA.Store/.github/workflows/deploy.yml:1321-1327`). The rest remain. A
  revision that returns 200 with wrong data, a broken broker consumer, a stalled outbox, a failing
  inter-service gRPC edge, the SignalR hub, and every authenticated write path are all invisible to the
  gate. Store never probes Catalog writes, and reaches the Stripe path only through the unsigned
  webhook POST that must be rejected with 400, never a signed delivery
  (`MMCA.Store/.github/workflows/deploy.yml:1439-1446`); ADC never probes the live layer beyond a 401.
- **The app list is hand-maintained.** `APPS` is a literal string
  (`MMCA.Store/.github/workflows/deploy.yml:1346`, `MMCA.ADC/.github/workflows/deploy.yml:1483`), so a
  new container app added to Bicep is neither activation-checked nor rolled back until someone
  remembers to add it here.
- **A failed revision listing is indistinguishable from "nothing to roll back".** The `az revision
  list` call swallows errors into an empty string, which is also what a genuinely empty result looks
  like when no other revision is `active`, `Provisioned` and `Healthy`; the loop then logs "no
  previous revision: skipping" without adding the app to `rollback_failed`
  (`MMCA.Store/.github/workflows/deploy.yml:1486-1488,1497-1499`,
  `MMCA.ADC/.github/workflows/deploy.yml:1602-1604,1611-1613`), so that app is reported under the
  clean branch.
- **Detection is slow and bounded by the job timeout.** The activation gate runs first and can spend
  about ten minutes before a single probe is sent; each failing probe then burns up to 12 attempts of
  15-second timeout plus a 10-second sleep, and the probes run sequentially, so a total outage adds
  roughly five minutes per probe before the rollback loop starts, against a `timeout-minutes: 40` job
  (`MMCA.Store/.github/workflows/deploy.yml:1082`, `MMCA.ADC/.github/workflows/deploy.yml:1144`). Both
  repos now bound the activation tier the same way, on one shared budget (see the 2026-09-10
  revision), so a fleet-wide activation failure costs about ten minutes once in either repo rather
  than scaling with the app count. The rollback loop is reachable inside the 40-minute job in both.
- **Only a smoke-gate failure triggers a rollback.** A regression that passes the probes and is found
  minutes later is reverted by hand (a redeploy of the previous commit or a manual `revision copy`);
  there is no alert-driven auto-rollback wired to the SLO alerts (ADR-062).

## Revision (2026-09-10)

**ADC's activation tier is now one shared budget over the whole fleet, matching Store.** The attempt
loop is the outer loop and the apps are iterated inside it: `for i in $(seq 1 30)` at
`MMCA.ADC/.github/workflows/deploy.yml:1677` encloses `for app in $APPS` at `:1679`, the pass
collects a `pending` list and breaks on the first fully-activated sweep (`:1690`), and there is one
`sleep 20` per pass (`:1692`), the whole gate spanning `:1668-1697`. Store's is the same shape
(`MMCA.Store/.github/workflows/deploy.yml:1514` outer, `:1516` inner, break at `:1529`, sleep at
`:1531`).

The arithmetic is the point of the change, not the tidiness. A shared budget is 30 x 20s = about ten
minutes of activation polling regardless of how many apps are pending, so the ceiling no longer
scales with the fleet: ADC's six apps used to be able to spend roughly an hour there, against a
`timeout-minutes: 40` job (`:1304`; Store `:1199`). A job killed at its timeout never reaches its
rollback loop, so the old shape could turn a failed activation into a deploy with no revert, which is
the failure this record exists to prevent. Both rollback loops are unchanged and reachable
(`MMCA.ADC/.github/workflows/deploy.yml:1730-1761`,
`MMCA.Store/.github/workflows/deploy.yml:1565-1600`).

## Revision (2026-10-01)

**Three current-state statements are corrected; the rollout and revision-only rollback model is
unchanged.** First, the Gateway is not readiness-gated on `/health/ready`: in both repos its
readiness probe is `/alive`, because its `/health/ready` fans out to every downstream and one failed
downstream would mark the only Gateway replica unready, while the Gateway has no JwtBearer warm-up
task for readiness to wait on (`MMCA.Store/infra/main.bicep:1956-1963`,
`MMCA.ADC/infra/main.bicep:2423-2432`). The backends and the UI still take readiness on
`/health/ready`. Second, Store's tier 2 gained a sixth probe: an unsigned `POST /Payments/webhook`
through a new `probe_post` helper that must return exactly 400, so a webhook that accepts an
unauthenticated delivery or a payment path that is not served fails the gate
(`MMCA.Store/.github/workflows/deploy.yml:1420-1432,1497-1504`); the Trade-offs blind-spot line no
longer says Store never probes Stripe. Third, the Status line said both `deploy` jobs wait on the
same ten needs, which contradicted Context: Store waits on eleven and ADC on twelve
(`MMCA.Store/.github/workflows/deploy.yml:1136`, `MMCA.ADC/.github/workflows/deploy.yml:1185`). Every
`deploy.yml` and `main.bicep` anchor in Context, Decision, Rationale and Trade-offs is refreshed, and
the ADR-057 citation now spans the quoted lines (`057-expand-contract-schema-evolution-gate.md:20-26`).
The 2026-09-10 revision keeps its original anchors as a historical record.

## Revision (2026-10-06)

**No content correction: the rollout and revision-only rollback model, the eleven and twelve
`deploy` needs, the probe set and the rollback semantics all still match source.** Both `deploy.yml`
files grew, so every anchor moved. The facts the 2026-09-10 revision records now sit at: ADC's shared
activation budget `seq 1 30` at `MMCA.ADC/.github/workflows/deploy.yml:1638` with one `sleep 20` at
`:1653` (Store `MMCA.Store/.github/workflows/deploy.yml:1519` and `:1536`), the rollback loops at
`MMCA.ADC/.github/workflows/deploy.yml:1687-1732` and `MMCA.Store/.github/workflows/deploy.yml:1577-1623`,
and `timeout-minutes: 40` at ADC `:1241` and Store `:1186`. The Gateway `/alive` readiness probe the
2026-10-01 revision cites is now at `MMCA.Store/infra/main.bicep:1966-1973` and
`MMCA.ADC/infra/main.bicep:2473-2482`. Every `deploy.yml`, `main.bicep` and ADR-030 anchor in
Context, Decision, Rationale and Trade-offs was re-verified against current source; the earlier
revisions keep their anchors as recorded.

## Revision (2026-10-07)

**Re-verified against current source. No content correction: the rollout and revision-only rollback
model, the probe set, the rollback semantics and the seven and eight `deploy` needs
(`MMCA.Store/.github/workflows/deploy.yml:1083`, `MMCA.ADC/.github/workflows/deploy.yml:1145`) all
still match source.** Both `deploy.yml` files shrank in their workflow prunes and `MMCA.ADC/infra/main.bicep`
grew, so every anchor in Context, Decision, Rationale and Trade-offs moved and is re-pointed here.

1. The 2026-10-06 revision's statement that the eleven and twelve `deploy` needs still match source
   is historical: the needs are now seven in Store and eight in ADC, as the third Status sentence and
   Context already record. The 2026-10-06 anchors no longer resolve and stay as recorded; the facts
   they cite now sit at: ADC's shared activation budget `seq 1 30` at
   `MMCA.ADC/.github/workflows/deploy.yml:1530` with one `sleep 20` at `:1545` (Store
   `MMCA.Store/.github/workflows/deploy.yml:1406` and `:1423`), the rollback loops at
   `MMCA.ADC/.github/workflows/deploy.yml:1579-1624` and `MMCA.Store/.github/workflows/deploy.yml:1464-1510`,
   and `timeout-minutes: 40` at ADC `:1144` and Store `:1082`.
2. ADC's probe URLs are no longer held in separate variables: each probe passes its URL inline
   (`MMCA.ADC/.github/workflows/deploy.yml:1552-1563`, Store `MMCA.Store/.github/workflows/deploy.yml:1430-1448`),
   so the tier-2 citations drop the old variable-line ranges.
3. Anchors re-verified against current source: arm-deploy `MMCA.Store/.github/workflows/deploy.yml:1300-1306`
   and `MMCA.ADC/.github/workflows/deploy.yml:1433-1439`; no-sqlcmd sole-migrator note Store `:1308-1316`,
   ADC `:1441-1451`; smoke step Store `:1338`, ADC `:1475`; `set -uo pipefail` Store `:1345`, ADC `:1482`;
   `APPS` Store `:1346`, ADC `:1483`; `probe` Store `:1351-1360`, ADC `:1488-1497`; `probe_post` Store
   `:1364-1374`; JSON plus `jq` revision read Store `:1334-1337,1376-1386`, ADC `:1499-1510`; tier 1
   Store `:1398-1428`, ADC `:1521-1550`; incident comment Store `:1321-1327`; tier-2 probes Store
   `:1430-1448`, ADC `:1552-1563`; unsigned-webhook comment Store `:1439-1446`; hardening Store
   `:1450-1457`, ADC `:1565-1572`; skip guard Store `:1473-1483`, ADC `:1585-1592`; selector and copy
   Store `:1484-1496`, ADC `:1593-1607`; unpiped copy Store `:1491-1493`; swallowed listing Store
   `:1486-1488,1497-1499`, ADC `:1602-1604,1611-1613`; attempt-every-app comment and summary ADC
   `:1580-1582,1615-1623`, Store summary `:1501-1509`; `exit 1` Store `:1510`, ADC `:1624`; purge Store
   `:1512-1530`, ADC `:1626-1644`; gateway-serves-old-code rationale ADC `:1453-1474`; test-gate
   rationale Store `:1084-1086`, ADC `:1146-1148` (unchanged); `activeRevisionsMode: 'Single'`
   `MMCA.ADC/infra/main.bicep:1688,1935,2088,2223,2413,2576`; ADC probe blocks `:1886-1911`, six apps at
   `:1886,2039,2174,2341,2504,2658`; ADC Gateway `/alive` readiness `:2520-2529`. The Store
   `main.bicep` anchors are unchanged.

## Related
[ADR-057](057-expand-contract-schema-evolution-gate.md) (built on this model: revision-only rollback
is why every migration must be backward compatible one release back),
[ADR-030](030-startup-sole-migrator.md) (startup migration as sole migrator, the reason no schema
revert exists to automate), [ADR-025](025-startup-warmup-readiness.md) (the readiness gate that keeps
traffic off a cold revision during the rollout), [ADR-064](064-deploy-recency-gates.md) (the recency
gates that must be green before the rollout starts), [ADR-009](009-resilience-and-recovery-objectives.md)
(the drilled restore path that covers what revision rollback cannot),
[ADR-006](006-database-per-service.md) (per-service databases, so recovery blast radius is one
service), [ADR-062](062-slo-alerting-as-code.md) (post-deploy detection for regressions the smoke gate
misses).
