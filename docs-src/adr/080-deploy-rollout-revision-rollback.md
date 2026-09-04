# ADR-080: Production Rollout with Automatic Revision-Only Rollback

## Status
Accepted (2026-08-14). Revised 2026-09-03 (the smoke gate is now two tiers: a revision **activation**
gate runs before the HTTP probes, and the rollback selector filters on `healthState` instead of
taking a positional index, which closes the overshoot trade-off this record used to carry. The
pre-deploy gate sets have re-converged: both repos' `deploy` jobs wait on the same ten needs,
`backend-test-gate` included, so neither rests on the smoke gate as its only backend backstop. The
rollout and revision-only rollback model itself is unchanged, and the citation anchors are
refreshed).

## Context
Both production apps deploy to Azure Container Apps from a single `deploy.yml` job on push to `main`,
and every gate runs **before** anything rolls out: the `deploy` job waits on the same ten needs in
both repos (`changes`, `supply-chain`, `cost-guard`, the three recency gates, the chromium
`e2e-gate`, `backend-test-gate`, `foundation` and `build-images`:
`MMCA.Store/.github/workflows/deploy.yml:999`, `MMCA.ADC/.github/workflows/deploy.yml:1054`), and the
image matrix pushes to ACR without rolling anything out. The rollout itself is one `azure/arm-deploy`
step over `infra/main.bicep` (`MMCA.Store/.github/workflows/deploy.yml:1189-1195`,
`MMCA.ADC/.github/workflows/deploy.yml:1298-1304`).

The question that step leaves open is what happens **after** ARM returns success. ARM success means
the revision was accepted by the control plane, not that it serves: a container that boots, fails to
reach Key Vault or its database, and crash-loops is still a successful template deployment. Without a
post-deploy check, a green workflow run and a dead production are the same colour.

Two existing records already reason from an answer that was never itself written down. ADR-057 states
the premise outright: "production rollback is **revision-only**", the deploy reverts the image "and
nothing else", and the previous release therefore keeps serving against the **new** schema
(`Website/docs-src/adr/057-expand-contract-schema-evolution-gate.md:15-23`), which is the entire
justification for its expand/contract guard. ADR-030 depends on the same model from the other side:
startup migration is the sole migrator, so a failed startup migration fails the new revision and
"there is no automated down-migration"
(`Website/docs-src/adr/030-startup-sole-migrator.md:69-71`). Both CONTRIBUTING files say the same
thing to contributors (`MMCA.Store/CONTRIBUTING.md:56-59`, `MMCA.ADC/CONTRIBUTING.md:57-60`). This
ADR records the rollout and rollback model those documents assume.

## Decision
Roll out one revision at a time, verify it from outside, and auto-revert the **image only** when the
verification fails.

- **Single-revision rollout.** Every container app runs `activeRevisionsMode: 'Single'`, so a deploy
  replaces the serving revision rather than splitting traffic across two: Store's identity, catalog,
  sales, gateway and ui apps (`MMCA.Store/infra/main.bicep:980,1133,1247,1384,1493`) and ADC's
  identity, conference, engagement, notification, gateway and ui apps
  (`MMCA.ADC/infra/main.bicep:1029,1236,1370,1497,1666,1787`). There is no canary or blue/green stage
  and no traffic-splitting step.
- **Readiness gating is the first line of defence.** Every app carries startup, liveness and
  readiness probes, with readiness on `/health/ready`, so ACA holds user traffic on the old revision
  until the new one is warm (`MMCA.Store/infra/main.bicep:1105-1108`, five apps at
  `:1105,1219,1352,1449,1547`; `MMCA.ADC/infra/main.bicep:1187-1211`, six apps at
  `:1187,1321,1448,1603,1722,1844`). This is the ADR-025 warm-up gate doing rollout duty.
- **A two-tier post-deploy smoke gate is the last gating step of the deploy job.** `Smoke test
  (rollback on failure)` verifies the freshly deployed fleet from outside Azure
  (`MMCA.Store/.github/workflows/deploy.yml:1227`, `MMCA.ADC/.github/workflows/deploy.yml:1340`):
  tier 1 proves the new revisions activated, tier 2 probes them over HTTP, and only these two can
  fail the job. The shared `probe` helper retries 12 times with a 15-second curl timeout and a
  10-second sleep between attempts (`MMCA.Store/.github/workflows/deploy.yml:1240-1249`,
  `MMCA.ADC/.github/workflows/deploy.yml:1353-1362`). The step runs under `set -uo pipefail` without
  `-e` (`:1234`, `:1347`), so a failed probe records the failure instead of aborting the step before
  the rollback loop can run.
- **Tier 1 is a revision activation gate and runs before any probe.** For every app the newest
  revision by `createdTime` must report `healthState` `Healthy`, a `runningState` of `Running` or
  `RunningAtMaxScale`, and `trafficWeight` 100, polled 30 times at 20-second intervals (about ten
  minutes) (`MMCA.Store/.github/workflows/deploy.yml:1255-1303`,
  `MMCA.ADC/.github/workflows/deploy.yml:1364-1405`). This is the tier that proves the code this run
  built is the code now serving, and Store's comment records the incident it closes
  (`MMCA.Store/.github/workflows/deploy.yml:1210-1216`): between 2026-08-28 and 2026-09-02 every
  backend revision failed activation, ACA kept the previous revision serving, and the step went green
  because the HTTP probes were answered perfectly by five-day-old code. Both repos read the revision
  as JSON and join it with `jq` rather than asking for `-o tsv`, because a top-level JMESPath
  multiselect list rendered as TSV prints one element per line instead of one tab-separated row and
  every field after the first parses back empty
  (`MMCA.Store/.github/workflows/deploy.yml:1223-1226`,
  `MMCA.ADC/.github/workflows/deploy.yml:1364-1368`).
- **Tier 2 probes assert an expected status code, not merely "not an error".** Store checks Gateway
  `/health`, `/.well-known/jwks.json` (through to Identity), `/Products` (Catalog, anonymous) and
  `/Orders` asserted as exactly **401**, plus the UI root
  (`MMCA.Store/.github/workflows/deploy.yml:1237-1239,1306-1315`); ADC checks Gateway `/health`,
  JWKS, `/Events` (Conference, anonymous), `/Bookmarks` and `/Notifications/inbox` both asserted as
  **401**, plus the UI root (`MMCA.ADC/.github/workflows/deploy.yml:1350-1352,1407-1418`). An
  anonymous 200 on a protected route is a failure, because it would mean authorization stopped being
  enforced; a 401 from the service proves the request traversed Gateway to service to auth pipeline.
- **Hardening checks observe, they do not gate.** The Gateway `X-Content-Type-Options` check prints a
  warning and never sets the failure flag, because a missing hardening header is not a
  "revision not serving" condition and must not trip a fleet-wide rollback
  (`MMCA.Store/.github/workflows/deploy.yml:1317-1324`,
  `MMCA.ADC/.github/workflows/deploy.yml:1420-1427`).
- **On failure, walk every app back to its last healthy revision.** The loop iterates the full app
  list (five for Store at `MMCA.Store/.github/workflows/deploy.yml:1235`, six for ADC at
  `MMCA.ADC/.github/workflows/deploy.yml:1348`). Per app it first re-reads the newest revision and
  skips that app entirely when the revision is already Healthy, Running and holding 100% of the
  traffic (`MMCA.Store/.github/workflows/deploy.yml:1344-1350`,
  `MMCA.ADC/.github/workflows/deploy.yml:1440-1447`), so a gate that failed for some other reason
  cannot undo a good activation. For the rest it selects the newest revision that is `active`,
  `Provisioned`, `Healthy` and not the newest by name, then issues
  `az containerapp revision copy --from-revision`
  (`MMCA.Store/.github/workflows/deploy.yml:1353-1360`,
  `MMCA.ADC/.github/workflows/deploy.yml:1457-1462`). Every app is attempted before any failure is
  reported, so one bad app does not abandon the rest, and the `az` call is deliberately **not** piped:
  a pipeline would report `tail`'s exit status and every rollback would look successful
  (`MMCA.Store/.github/workflows/deploy.yml:1358-1359`).
- **A failed rollback escalates louder than a failed deploy.** Apps whose rollback failed accumulate
  in `rollback_failed`, and the step writes a "Smoke gate failed AND rollback incomplete" block into
  the job summary naming them, because a fleet split across revisions needs immediate manual attention
  and must never read as a clean auto-revert
  (`MMCA.Store/.github/workflows/deploy.yml:1368-1373`,
  `MMCA.ADC/.github/workflows/deploy.yml:1435-1437,1470-1475`).
- **The run fails either way.** After the rollback loop the step exits 1
  (`MMCA.Store/.github/workflows/deploy.yml:1377`, `MMCA.ADC/.github/workflows/deploy.yml:1479`), so
  a reverted deploy is still a red run: recovery is automatic, but it is never silent.
- **What runs after the gate is housekeeping and cannot fail the deploy.** A build-cache purge is the
  job's final step and carries `continue-on-error: true`
  (`MMCA.Store/.github/workflows/deploy.yml:1388-1394`,
  `MMCA.ADC/.github/workflows/deploy.yml:1492-1499`), so a throttled or failed ACR purge can neither
  redden a good rollout nor reach the rollback path. Verification ends at the smoke gate.
- **Rollback is revision-only and never touches data or schema.** There is no down-migration step and
  no deploy-time `sqlcmd` backstop anywhere in the pipeline; each service self-applies its own
  migrations at startup as the sole migrator
  (`MMCA.Store/.github/workflows/deploy.yml:1197-1205`,
  `MMCA.ADC/.github/workflows/deploy.yml:1306-1316`). Reverting the image therefore leaves the new
  schema in place, which is exactly why ADR-057 requires every migration to be backward compatible
  one release back.

## Rationale
- **ARM success is the wrong success signal.** The smoke gate converts "the control plane accepted the
  template" into "the fleet is serving the revision this run built", which is the only claim a deploy
  should be green on. Neither repo rests on it as its only backend backstop any more: in both, the
  ui-scoped `e2e-gate` and `backend-test-gate` are exact complements over a code deploy, so exactly
  one test gate runs before every rollout (`MMCA.Store/.github/workflows/deploy.yml:349,1020-1025`,
  `MMCA.ADC/.github/workflows/deploy.yml:396,1074-1079`), and the smoke gate is a second line of
  defence rather than the gate of record.
- **Activation is a different question from reachability, so it gets its own tier.** Every HTTP probe
  enters through the Gateway, and a healthy Gateway keeps answering from the previous backend
  revision when the new one never goes ready, so probes alone can only prove that *something* serves
  (`MMCA.ADC/.github/workflows/deploy.yml:1318-1339`). Asking the control plane which revision holds
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
  now caught by tier 1 (`MMCA.Store/.github/workflows/deploy.yml:1210-1216`). The rest remain. A
  revision that returns 200 with wrong data, a broken broker consumer, a stalled outbox, a failing
  inter-service gRPC edge, the SignalR hub, and every authenticated write path are all invisible to the
  gate. Store never probes Catalog writes or Stripe; ADC never probes the live layer beyond a 401.
- **The app list is hand-maintained.** `APPS` is a literal string
  (`MMCA.Store/.github/workflows/deploy.yml:1235`, `MMCA.ADC/.github/workflows/deploy.yml:1348`), so a
  new container app added to Bicep is neither activation-checked nor rolled back until someone
  remembers to add it here.
- **A failed revision listing is indistinguishable from "nothing to roll back".** The `az revision
  list` call swallows errors into an empty string, which is also what a genuinely empty result looks
  like when no other revision is `active`, `Provisioned` and `Healthy`; the loop then logs "no
  previous revision: skipping" without adding the app to `rollback_failed`
  (`MMCA.Store/.github/workflows/deploy.yml:1353-1355,1364-1366`,
  `MMCA.ADC/.github/workflows/deploy.yml:1457-1459,1466-1468`), so that app is reported under the
  clean branch.
- **Detection is slow and bounded by the job timeout.** The activation gate runs first and can spend
  about ten minutes before a single probe is sent; each failing probe then burns up to 12 attempts of
  15-second timeout plus a 10-second sleep, and the probes run sequentially, so a total outage adds
  roughly five minutes per probe before the rollback loop starts, against a `timeout-minutes: 40` job
  (`MMCA.Store/.github/workflows/deploy.yml:998`, `MMCA.ADC/.github/workflows/deploy.yml:1053`). The
  two repos bound the activation tier differently: Store polls all five apps inside one 30 x 20s loop,
  so a fleet-wide failure costs about ten minutes once
  (`MMCA.Store/.github/workflows/deploy.yml:1281-1299`), while ADC calls `revision_gate` per app
  sequentially (`MMCA.ADC/.github/workflows/deploy.yml:1385-1396,1400-1405`), so a six-app failure can
  spend up to about an hour in activation polling alone. A job killed at its timeout never runs the
  rollback, and on ADC that ceiling is reachable from the activation tier by itself.
- **Only a smoke-gate failure triggers a rollback.** A regression that passes the probes and is found
  minutes later is reverted by hand (a redeploy of the previous commit or a manual `revision copy`);
  there is no alert-driven auto-rollback wired to the SLO alerts (ADR-062).

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
