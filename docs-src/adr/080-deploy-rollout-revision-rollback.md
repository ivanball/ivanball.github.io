# ADR-080: Production Rollout with Automatic Revision-Only Rollback

## Status
Accepted (2026-08-14).

## Context
Both production apps deploy to Azure Container Apps from a single `deploy.yml` job on push to `main`,
and every gate runs **before** anything rolls out: the `deploy` job waits on `supply-chain`,
`cost-guard`, the three recency gates, the chromium `e2e-gate`, `foundation` and `build-images`
(`MMCA.Store/.github/workflows/deploy.yml:862`, `MMCA.ADC/.github/workflows/deploy.yml:866`), and the
image matrix pushes to ACR without rolling anything out. The rollout itself is one `azure/arm-deploy`
step over `infra/main.bicep` (`MMCA.Store/.github/workflows/deploy.yml:1035-1041`,
`MMCA.ADC/.github/workflows/deploy.yml:1070-1076`).

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
(`Website/docs-src/adr/030-startup-sole-migrator.md:62-64`). Both CONTRIBUTING files say the same
thing to contributors (`MMCA.Store/CONTRIBUTING.md:56-59`, `MMCA.ADC/CONTRIBUTING.md:57-60`). This
ADR records the rollout and rollback model those documents assume.

## Decision
Roll out one revision at a time, verify it from outside, and auto-revert the **image only** when the
verification fails.

- **Single-revision rollout.** Every container app runs `activeRevisionsMode: 'Single'`, so a deploy
  replaces the serving revision rather than splitting traffic across two: Store's identity, catalog,
  sales, gateway and ui apps (`MMCA.Store/infra/main.bicep:952,1104,1203,1334,1419`) and ADC's
  identity, conference, engagement, notification, gateway and ui apps
  (`MMCA.ADC/infra/main.bicep:1031,1232,1356,1480,1641,1743`). There is no canary or blue/green stage
  and no traffic-splitting step.
- **Readiness gating is the first line of defence.** Every app carries startup, liveness and
  readiness probes, with readiness on `/health/ready`, so ACA holds user traffic on the old revision
  until the new one is warm (`MMCA.Store/infra/main.bicep:1300-1305`, five apps at
  `:1079,1178,1305,1378,1475`; `MMCA.ADC/infra/main.bicep:1578-1582`, six apps at
  `:1200,1324,1448,1600,1695,1813`). This is the ADR-025 warm-up gate doing rollout duty.
- **A post-deploy smoke gate is the last step of the deploy job.** `Smoke test (rollback on failure)`
  probes the freshly deployed fleet from outside Azure
  (`MMCA.Store/.github/workflows/deploy.yml:1059`, `MMCA.ADC/.github/workflows/deploy.yml:1099`). The
  shared `probe` helper retries 12 times with a 15-second curl timeout and a 10-second sleep between
  attempts (`MMCA.Store/.github/workflows/deploy.yml:1072-1081`,
  `MMCA.ADC/.github/workflows/deploy.yml:1112-1121`). The step runs under `set -uo pipefail` without
  `-e` (`:1066`, `:1106`), so a failed probe records the failure instead of aborting the step before
  the rollback loop can run.
- **The probes assert an expected status code, not merely "not an error".** Store checks Gateway
  `/health`, `/.well-known/jwks.json` (through to Identity), `/Products` (Catalog, anonymous) and
  `/Orders` asserted as exactly **401**, plus the UI root
  (`MMCA.Store/.github/workflows/deploy.yml:1069-1071,1084-1093`); ADC checks Gateway `/health`,
  JWKS, `/Events` (Conference, anonymous), `/Bookmarks` and `/Notifications/inbox` both asserted as
  **401**, plus the UI root (`MMCA.ADC/.github/workflows/deploy.yml:1109-1111,1124-1135`). An
  anonymous 200 on a protected route is a failure, because it would mean authorization stopped being
  enforced; a 401 from the service proves the request traversed Gateway to service to auth pipeline.
- **Hardening checks observe, they do not gate.** The Gateway `X-Content-Type-Options` check prints a
  warning and never sets the failure flag, because a missing hardening header is not a
  "revision not serving" condition and must not trip a fleet-wide rollback
  (`MMCA.Store/.github/workflows/deploy.yml:1095-1102`,
  `MMCA.ADC/.github/workflows/deploy.yml:1137-1144`).
- **On failure, walk every app back to its previous revision.** The loop iterates the full app list
  (five for Store at `MMCA.Store/.github/workflows/deploy.yml:1067`, six for ADC at
  `MMCA.ADC/.github/workflows/deploy.yml:1107`), selects the second-newest `Provisioned` revision by
  `createdTime`, and issues `az containerapp revision copy --from-revision`
  (`MMCA.Store/.github/workflows/deploy.yml:1111-1125`,
  `MMCA.ADC/.github/workflows/deploy.yml:1156-1169`). Every app is attempted before any failure is
  reported, so one bad app does not abandon the rest, and the `az` call is deliberately **not** piped:
  a pipeline would report `tail`'s exit status and every rollback would look successful
  (`MMCA.Store/.github/workflows/deploy.yml:1117-1119`).
- **A failed rollback escalates louder than a failed deploy.** Apps whose rollback failed accumulate
  in `rollback_failed`, and the step writes a "Smoke gate failed AND rollback incomplete" block into
  the job summary naming them, because a fleet split across revisions needs immediate manual attention
  and must never read as a clean auto-revert
  (`MMCA.Store/.github/workflows/deploy.yml:1127-1135`,
  `MMCA.ADC/.github/workflows/deploy.yml:1152-1154,1170-1178`).
- **The run fails either way.** After the rollback loop the step exits 1
  (`MMCA.Store/.github/workflows/deploy.yml:1136`, `MMCA.ADC/.github/workflows/deploy.yml:1179`), so
  a reverted deploy is still a red run: recovery is automatic, but it is never silent.
- **Rollback is revision-only and never touches data or schema.** There is no down-migration step and
  no deploy-time `sqlcmd` backstop anywhere in the pipeline; each service self-applies its own
  migrations at startup as the sole migrator
  (`MMCA.Store/.github/workflows/deploy.yml:1043-1051`,
  `MMCA.ADC/.github/workflows/deploy.yml:1078-1088`). Reverting the image therefore leaves the new
  schema in place, which is exactly why ADR-057 requires every migration to be backward compatible
  one release back.

## Rationale
- **ARM success is the wrong success signal.** The smoke gate converts "the control plane accepted the
  template" into "the fleet answers requests", which is the only claim a deploy should be green on.
  It is also the backend backstop the `deploy` job explicitly relies on when the ui-scoped `e2e-gate`
  legitimately skips (`MMCA.Store/.github/workflows/deploy.yml:879-880`,
  `MMCA.ADC/.github/workflows/deploy.yml:883`).
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
- **Smoke-test blind spots.** The probes assert HTTP status codes on a handful of anonymous endpoints.
  A revision that returns 200 with wrong data, a broken broker consumer, a stalled outbox, a failing
  inter-service gRPC edge, the SignalR hub, and every authenticated write path are all invisible to the
  gate. Store never probes Catalog writes or Stripe; ADC never probes the live layer beyond a 401.
- **The app list is hand-maintained.** `APPS` is a literal string
  (`MMCA.Store/.github/workflows/deploy.yml:1067`, `MMCA.ADC/.github/workflows/deploy.yml:1107`), so a
  new container app added to Bicep is deployed but never rolled back until someone remembers to add it
  here.
- **The previous-revision selector is positional.** It takes index `[1]` of the `Provisioned`
  revisions sorted newest first (`MMCA.Store/.github/workflows/deploy.yml:1112-1114`,
  `MMCA.ADC/.github/workflows/deploy.yml:1157-1159`). When the new revision never reached
  `Provisioned` at all, index `[1]` is one release further back than the revision currently serving, so
  the rollback overshoots.
- **A failed revision listing is indistinguishable from "nothing to roll back".** The `az revision
  list` call swallows errors into an empty string and the loop then logs "no previous revision:
  skipping" without adding the app to `rollback_failed`
  (`MMCA.Store/.github/workflows/deploy.yml:1114,1123-1124`,
  `MMCA.ADC/.github/workflows/deploy.yml:1159,1166-1167`), so that app is reported under the clean
  branch.
- **Detection is slow and bounded by the job timeout.** Each failing probe burns up to 12 attempts of
  15-second timeout plus a 10-second sleep, and the probes run sequentially, so a total outage spends
  roughly five minutes per probe before the rollback loop starts, against a `timeout-minutes: 40` job
  (`MMCA.Store/.github/workflows/deploy.yml:861`, `MMCA.ADC/.github/workflows/deploy.yml:865`). A
  worst-case failure across all probes can approach that ceiling, and a job killed at its timeout never
  runs the rollback.
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
