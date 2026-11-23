# ADR-093: Container Image Build and Runtime Posture

## Status
Accepted (2026-08-23) for the three build decisions below. The two runtime postures below were
recorded as **undecided** at that date: they described what the images did and the trade-off each
one carried, not a decision to keep doing it. Both are closed. Revised 2026-09-03: the Container
Apps sizing that decision 3's cold-start argument rests on is now uniform across all six ADC apps,
so the 4-vs-2 split that argument cited is gone. See Revision (2026-09-03) at the end.
Revised 2026-09-07 (base images are digest-pinned, every final stage drops to `USER $APP_UID`,
image builds restore in locked mode, and both consumers scan the built image with Trivy).
Revised 2026-09-10: the locked-mode inventory is restated per image (nine of eleven build-stage
restores, the two UI images excluded by design), and the Trivy scan is report-only in **both**
consumers, not gating in ADC. See Revision (2026-09-10) at the end.
Revised 2026-09-19: the body now states the closed runtime postures in the present tense, instead of
leaving the superseded "open" wording standing beside the revisions that closed it.
Revised 2026-09-25 (re-anchored every `deploy.yml` citation, which moved with both workflows, the
Trivy step included; recorded that Store's scan runs only on a leg that rebuilt its image; the
locked-mode table's Dockerfile citations were re-checked and still hold).
Revised 2026-10-01 (three Context and decision 4 statements corrected against the files). See
Revision (2026-10-01).
Revised 2026-10-06: the Trivy scan is a recorded non-gating decision in both consumers and runs on
every leg, Store's re-tagged legs included (so the 2026-09-25 note above no longer holds); ADC
container sizing is no longer uniform, because `conferenceMode` scales four apps up and Identity
further for conference day while the 0.25 vCPU / 0.5 GiB baseline still applies outside it; and
the build job's per-image gate (build only a changed image, re-tag the rest) is described. See
Revision (2026-10-06).
Revised 2026-10-07: ADC's unchanged-leg re-tag also refreshes `latest` against the ACR purge, the
SBOM step is recorded as pull-request-only, the publish-property citation is corrected, and every
`deploy.yml` and `main.bicep` anchor is refreshed after both workflow prunes.
Revised 2026-10-19: Store's unchanged-leg re-tag also refreshes `latest` against the ACR purge, so the open gap recorded on 2026-10-07 is closed and both consumers re-tag the same way.
Revised 2026-10-21: anchors refreshed after the `deploy.yml` and `main.bicep` growth in both consumers; no decision or posture changed. See Revision (2026-10-21).
Revised 2026-10-26: anchors refreshed after further `deploy.yml` growth in both consumers (+1), `main.bicep` growth (+36) and a one-line shift in the ADC Gateway Dockerfile; no decision or posture changed. See Revision (2026-10-26).
Revised 2026-10-28: anchors refreshed after a three-line shift in the ADC `main.bicep` per-app sizing and port blocks; no decision or posture changed. See Revision (2026-10-28).
Revised 2026-11-04: the Trivy scan gates the deploy in both consumers (the baseline was clean), and all eleven runtime stages are chiseled images. See Revision (2026-11-04).
Revised 2026-11-23: ADC's images carry the ADR-141 dual framework line (an 11.0 production runtime,
a 10.0 rollback runtime, `latest` pushed only by the production line), every image builds on
`sdk:11.0`, the service images copy only project and lock files before restore, the image build
skips analyzers on `main`, and the live sections now state the gating Trivy scan instead of the
superseded report-only posture. See Revision (2026-11-23).
## Context
Eleven Dockerfiles produce every deployable container in the two Azure-hosted applications: six in
MMCA.ADC (four services, the Gateway, the Blazor web host) and five in MMCA.Store (three services,
the Gateway, the Blazor web host). They are uniform by copy, not by a shared base file or a template,
and the two repositories differ in shape. Store's five are four-stage files (`base` on
`mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled-extra`, `build` on
`mcr.microsoft.com/dotnet/sdk:11.0`, `publish`, `final`:
`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Dockerfile:11,19,63,82`); the app targets
net10.0 and runs on the 10.0 runtime, built by the .NET 11 SDK the workspace pins (`:16-18`). ADC's
six build one of the two framework lines of ADR-141 per build: `ARG MMCA_NET=net11.0` before the
first stage (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Dockerfile:9`) selects between
two runtime bases, `base-net11.0` on `aspnet:11.0-resolute-chiseled-extra` (`:20`) and
`base-net10.0` on `aspnet:10.0-noble-chiseled-extra` (`:22`), through `FROM base-${MMCA_NET} AS
base` (`:24`), and reaches MSBuild as `ENV MmcaNet` in the build stage (`:35-36`), which picks the
target framework and the lock file set; then come `build` on `sdk:11.0` (`:31`), `publish` (`:75`)
and `final` (`:94`). net11.0 is the production line and net10.0 the rollback line, chosen by the
`runtime` input of the deploy workflow (`MMCA.ADC/.github/workflows/deploy.yml:21-29`, `:38`). The
other differences between files are the project path, the `COPY` granularity (the two web-host
images also copy the `.slnx`, and the seven service images open with a pinned
`# syntax=docker/dockerfile:1.29.0` directive, `:1`, for the `COPY --parents` restore layer), whether
the build-stage restore passes `--locked-mode` (the two web-host images do not:
`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Dockerfile:60-62`,
`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Dockerfile:47-49`), and one publish property
(`PublishReadyToRun=true`, `.../MMCA.ADC.Conference.Service/Dockerfile:92`).
Every base image is named by `sha256` digest with the tag kept as a readable suffix. The SDK digest
is one value in all eleven files (`.../MMCA.ADC.Conference.Service/Dockerfile:31`,
`.../MMCA.Store.Sales.Service/Dockerfile:19`). The runtime digest is not: ADC production runs the
11.0 runtime, and only ADC's net10.0 line names the same 10.0 runtime digest as Store
(`.../MMCA.ADC.Conference.Service/Dockerfile:22`, `.../MMCA.Store.Sales.Service/Dockerfile:11`).
Five of ADC's six images (the four services and the Gateway) also copy both lock files beside each
project (`packages.lock.json` for net11.0, `packages.net10.0.lock.json` for net10.0,
`.../MMCA.ADC.Conference.Service/Dockerfile:56`, `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Dockerfile:51`),
because `MMCA.ADC/Directory.Build.props:89` points `NuGetLockFilePath` at the second one on the
net10.0 line. The UI.Web image copies only `.csproj` files, since its two projects keep no lock file
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Dockerfile:47-54`, reason `:57-59`).
Nothing in the repositories reconciles them: an edit to one is an edit to one.

That uniformity encodes three decisions that were made once, defended in Dockerfile comments, and
never written down anywhere a reader of the architecture library would find them. It also left two
runtime properties in the state of "what the default gave us", which was worth recording as such so
that a later hardening pass started from a stated position rather than from a discovery. That pass
ran on 2026-09-07 and closed both.

The images are built in CI, not by hand: a fan-out `build-images` matrix job with one leg per image
(`MMCA.ADC/.github/workflows/deploy.yml:1410,1426-1444` for the six ADC legs,
`MMCA.Store/.github/workflows/deploy.yml:1157,1172-1188` for the five Store legs). A leg whose image
changed runs `docker/build-push-action@v7` over a buildx builder
(`MMCA.ADC/.github/workflows/deploy.yml:1462,1466`) and pushes the image to ACR under the commit sha
(`:1485`). Store always pushes `latest` beside it
(`MMCA.Store/.github/workflows/deploy.yml:1226-1228`); ADC pushes `latest` only when the build is
for the net11.0 production line, so a net10.0 rollback build pushes the sha tag alone
(`MMCA.ADC/.github/workflows/deploy.yml:1486`, reason `:1480-1483`). ADC passes the line and the
analyzer switch as build arguments (`MMCA_NET` and `RUN_ANALYZERS`, `:1475-1477`). Both cache layers
in that same registry with `mode=max`, ADC under one cache ref per framework line (`:1500-1503`),
Store under one ref per image (`MMCA.Store/.github/workflows/deploy.yml:1243-1244`). The build step
is gated per image on `matrix.changed` (ADC `MMCA.ADC/.github/workflows/deploy.yml:1465`, Store
`MMCA.Store/.github/workflows/deploy.yml:1214`); a leg whose image is unchanged skips the build and
instead re-tags the last `latest` to the commit sha with `az acr import` (ADC
`MMCA.ADC/.github/workflows/deploy.yml:1513,1521-1525`, Store
`MMCA.Store/.github/workflows/deploy.yml:1247,1267-1271`), so the leg still succeeds and every image
exists under the sha the deployment addresses (rationale
`MMCA.ADC/.github/workflows/deploy.yml:1405-1409`). Both re-tag steps then run a second
`az acr import` that copies the new sha tag back onto `latest` (ADC `:1534-1538`, rationale
`:1526-1533`; Store `MMCA.Store/.github/workflows/deploy.yml:1280-1284`, rationale `:1272-1279`):
the digest is the same, only the tag's update time moves, so the daily ACR purge
(`acr purge --filter '.*:.*' --ago 3d --keep 3 --untagged`, `MMCA.ADC/infra/foundation.bicep:132`,
`MMCA.Store/infra/foundation.bicep:132`) does not age out the tag an unchanged leg reads from. A
second purge line in both registries trims the layer cache (`--filter 'buildcache:.*' --ago 1h
--keep 10 --untagged`, `:135` in each). Without the second import, an image left unchanged across
enough deploys would lose `latest`, because only a rebuilt leg pushes it
(`MMCA.Store/.github/workflows/deploy.yml:1228`), and the next unchanged leg would fail and block
the deploy.
The job runs concurrently with the e2e gate and rolls nothing out; that separation is ADR-080's
subject, not this one's.

## Decision
**1. The GitHub Packages credential is a BuildKit secret, never an `ARG` or `ENV`.** Both
applications' `nuget.config` source-maps `MMCA.*` to GitHub Packages, so every restore inside an
image needs a token. It arrives as `--secret id=github_token`, mounted into the restore `RUN`
(`.../MMCA.ADC.Conference.Service/Dockerfile:59-61`) and again into the publish `RUN` (`:90-92`),
because publish performs its own restore pass. The value is read out of `/run/secrets/github_token`
into a shell-local `GITHUB_TOKEN` that lives only for that command, which is the variable
`nuget.config` expands. The Dockerfile states the reason in place: a build-arg promoted to `ENV`
lands in image layers, the build cache, and `docker history` (`:37-39`). CI passes it as a
`secrets:` input to the build action, not a `build-args:` input
(`MMCA.ADC/.github/workflows/deploy.yml:1492-1493`,
`MMCA.Store/.github/workflows/deploy.yml:1235-1236`), and the workflow repeats the constraint in its
own comments (`MMCA.ADC/.github/workflows/deploy.yml:1400-1403`). Secret *content* is deliberately not
part of the BuildKit cache key, so rotating the token does not invalidate the restore layer; that is
safe only because the package set is pinned by committed lock files and any
`Directory.Packages.props` change lands in a `COPY` layer that busts the cache anyway
(`MMCA.ADC/.github/workflows/deploy.yml:1487-1491`).

**2. There is deliberately no separate `dotnet build` stage.** The `build` stage restores and stops;
`publish` does its own restore and build. This is a measured decision, dated in the file: on
2026-07-24 (CI run 30115729720) the build stage emitted `bin/Release/<tfm>/` while the
ReadyToRun publish emitted `bin/Release/<tfm>/linux-x64/`, because the SDK infers a RID for
ReadyToRun. Different paths, so publish never reused build output and every image compiled twice,
about 75 seconds of pure waste per image
(`.../MMCA.ADC.Conference.Service/Dockerfile:67-71`). The Store Dockerfiles carry the same note and
cite the ADC measurement rather than repeating it
(`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Dockerfile:50-57`). Analyzer gating
(`TreatWarningsAsErrors`, `AnalysisMode=All`) does not depend on the stage either: it runs in the
pull-request jobs on the same tree, and the image publish passes `-p:RunAnalyzers=$RUN_ANALYZERS`
(`.../MMCA.ADC.Conference.Service/Dockerfile:92`, default `true` at `:81`, reason `:72-73` and
`:77-80`), which the deploy workflow sets to `false` on `main` and `true` on any other ref
(`MMCA.ADC/.github/workflows/deploy.yml:1477`, `MMCA.Store/.github/workflows/deploy.yml:1223`).
Source generators run either way. The two web-host images, which do not use ReadyToRun, drop the
stage for the weaker reason that it is one redundant MSBuild evaluation
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Dockerfile:67-69`,
`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Dockerfile:54-56`).

**3. `PublishReadyToRun=true` on the nine service and gateway images, and only those.** The four ADC
services and the ADC Gateway (`.../MMCA.ADC.Conference.Service/Dockerfile:92`,
`.../MMCA.ADC.Identity.Service/Dockerfile:92`, `.../MMCA.ADC.Engagement.Service/Dockerfile:92`,
`.../MMCA.ADC.Notification.Service/Dockerfile:92`, `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Dockerfile:88`)
and the three Store services and the Store Gateway
(`.../MMCA.Store.Catalog.Service/Dockerfile:80`, `.../MMCA.Store.Identity.Service/Dockerfile:80`,
`.../MMCA.Store.Sales.Service/Dockerfile:80`,
`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Dockerfile:76`) AOT-compile IL at publish time. The two
Blazor web hosts do not (`.../MMCA.ADC.UI.Web/Dockerfile:81`,
`.../MMCA.Store.UI.Web/Dockerfile:67`). The stated purpose is cold start: deploys, restarts and
scale-out replicas skip first-request JIT (`.../MMCA.ADC.Conference.Service/Dockerfile:82-83`), and
the containers those replicas land on are fractional-vCPU Container Apps. Outside conference mode
all six ADC apps (identity, conference, engagement, notification, gateway, ui) run on 0.25 vCPU /
0.5 GiB: notification declares it literally (`MMCA.ADC/infra/main.bicep:2753`), and the other five
take it as the baseline branch of `conferenceScaledResources` (`:204`; conference `:2446`,
engagement `:2591`, gateway `:2947`, ui `:3098`) or `conferenceIdentityResources` (`:208`;
identity `:2175`). The `conferenceMode` parameter (`:179`) lifts those four to 0.5 vCPU / 1 GiB and
Identity to 1.0 vCPU / 2 GiB for conference day (rationale `:196-208`). On that much CPU, JIT time
is not noise.

**4. Every image is published with `UseAppHost=false` and started through the shared runtime.** The
`final` stage is the `base` stage plus the publish output, `ENV ASPNETCORE_ENVIRONMENT=Production`,
`USER $APP_UID` (added 2026-09-07, see the revision below) and `ENTRYPOINT ["dotnet", "<Host>.dll"]`
(`.../MMCA.ADC.Conference.Service/Dockerfile:94-107`, `UseAppHost=false` at `:92`); the base stage
exposes 8080 and 8081 (`:26-27`). For Identity, Conference and Engagement, 8080 is the h2c ingress
endpoint and 8081 the HTTP/1.1 health-probe listener (Identity
`MMCA.ADC/infra/main.bicep:2147,2150,2192`, Conference `:2418,2421,2461`, Engagement
`:2572,2575,2606`); only Notification serves h2c gRPC on 8081, the ADR-012 mixed profile, behind an
`http` main ingress on 8080, with its probe listener on 8082
(`MMCA.ADC/infra/main.bicep:2720,2722,2731-2732,2772`). No image installs a package, adds
a shell script, or runs a health-check command of its own: liveness is the Container Apps probe
configured in Bicep.

## Runtime postures (closed 2026-09-07)
**The base image is pinned by digest.** All eleven images name every runtime and SDK image by
`sha256`, with the tag left in place as a readable suffix (ADC
`.../MMCA.ADC.Conference.Service/Dockerfile:20`, `:22` and `:31`; Store
`.../MMCA.Store.Sales.Service/Dockerfile:11` and `:19`). Every runtime base is a chiseled `-extra`
image (no shell or package manager, ICU and tzdata kept): `11.0-resolute-chiseled-extra` for ADC's
production line, `10.0-noble-chiseled-extra` for ADC's net10.0 line and for all of Store. A rebuild
of the same commit now resolves
the same runtime layer, and Microsoft's monthly runtime patches arrive as a Dependabot bump of the
digest rather than as a side effect of rebuilding (ADR-038). That restores the symmetry with the
application layer, which was already pinned: the deployment references each image by commit sha, not
by `latest` (`MMCA.ADC/.github/workflows/deploy.yml:1485,1674,1718-1723`). See Revision (2026-09-07)
item 1.

**Every image drops privileges.** `USER $APP_UID` is the last instruction before the entrypoint in
all eleven (ADC services `Dockerfile:106`, ADC Gateway `:103`, ADC UI.Web `:95`, Store services
`:93`, Store Gateway `:89`, Store UI.Web `:80`), and the .NET base image is what defines the uid. The
comment above the line records what kept the change to one line per file: nothing in these images
writes to the container filesystem at runtime, and every port the host binds is 8080 or higher,
outside the range a non-root user cannot bind
(`.../MMCA.ADC.Conference.Service/Dockerfile:98-105`). See Revision (2026-09-07) item 2.

**The image scan gates the deploy.** Each deploy scans the sha-tagged image of every leg with Trivy,
pinned by SHA, with `severity: CRITICAL,HIGH`, `ignore-unfixed: true`, `exit-code: '1'` and no
`continue-on-error` (ADC `MMCA.ADC/.github/workflows/deploy.yml:1559-1566`, comment `:1548-1558`;
Store `MMCA.Store/.github/workflows/deploy.yml:1306-1313`, comment `:1295-1305`), so a fixable
CRITICAL or HIGH finding fails that `build-images` leg, and the deploy job proceeds only on
`needs.build-images.result == 'success'` (ADC `:1607`, Store
`MMCA.Store/.github/workflows/deploy.yml:1350`). Both scan every leg's tag, including a leg that only
re-tagged an unchanged image (ADC `MMCA.ADC/.github/workflows/deploy.yml:1544-1546`, Store
`MMCA.Store/.github/workflows/deploy.yml:1291-1293`), so a CVE disclosed after an image was built
still blocks the next rollout until the digest is bumped or the CVE is accepted in a `.trivyignore`
with a justification. The supply-chain job generates its CycloneDX SBOM from the solution filter, on
pull requests only, through the shared MMCA.Common `cyclonedx-sbom` composite action pinned to a
Common release, which fails on a missing or zero-component BOM
(`MMCA.ADC/.github/workflows/deploy.yml:804-820`, condition `:805`, action `:815`, filter `:817`;
`MMCA.Store/.github/workflows/deploy.yml:641-654`, condition `:642`, action `:649`, filter `:651`), so
it describes the NuGet graph and not the image, which leaves the Trivy scan as the only thing in
either pipeline that looks at the base layer at all (`MMCA.ADC/.github/workflows/deploy.yml:1540-1542`).
See Revision (2026-11-04).

## Rationale
- **A secret that is never a layer cannot leak from a layer.** BuildKit secret mounts are the only
  mechanism that keeps the credential out of the image, the build cache and `docker history` at the
  same time, and the cost is one extra line per `RUN`. The alternative that looks simpler (an `ARG`
  plus `ENV`) is the exact anti-pattern the mount exists to replace.
- **The build stage was measured, not assumed.** The decision to drop it rests on an observed
  duplicate compile with a named CI run and a number attached, which is also why the comment stayed
  in the file: the stage looks like an obvious optimization and would otherwise be re-added by the
  next reader.
- **ReadyToRun buys the scarcest resource.** On 0.25 vCPU, first-request JIT is a visible tail on
  every deploy and scale-out. Paying it once at publish, in CI, on a runner with more CPU than the
  container will ever have, is the trade the deployment topology asks for.
- **The web hosts are excluded for a reason, not by omission.** Their Dockerfiles say so in place:
  without ReadyToRun the publish RID path matches the build path, which is what makes the missing
  build stage cheap rather than wasteful there.
- **Recording an undecided posture is worth more than implying a decision.** Writing "floating tag,
  root user, no image scan" down as open is what let the 2026-09-07 hardening pass argue about the
  trade-off instead of rediscovering the state: the digest pin and the non-root user closed two of
  those three on 2026-09-07, and the scan became a gate on 2026-11-04 once its baseline was clean.

## Trade-offs
- **Eleven copies drift independently.** There is no shared base Dockerfile and no test that
  compares them, so a fix applied to one image is applied to one image. The ReadyToRun split (nine
  yes, two no) is deliberate, but it means "they are all the same" is already false and a reader
  cannot rely on any single file as the canonical one.
- **The restore layer depends on every project file.** Rather than list the projects each service
  reaches through its references (its own module layers, its own per-database migrations project,
  which references only that module's Infrastructure, and peer `Contracts` and `Shared` projects:
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/MMCA.ADC.Conference.Service.csproj:39-50`,
  `MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Conference/MMCA.ADC.Migrations.SqlServer.Conference.csproj:15`,
  `MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer.Sales/MMCA.Store.Migrations.SqlServer.Sales.csproj:15`),
  the service images copy every `Source/**/*.csproj` and its lock files with `COPY --parents` (`.../MMCA.ADC.Conference.Service/Dockerfile:56`,
  `.../MMCA.Store.Sales.Service/Dockerfile:39`) and copy the rest of `Source/` only after it
  (`:65`, Store `:52`). A source-only edit leaves the restore layer cached (`:54-55`, Store
  `:36-38`), but a change to any project or lock file under `Source/`, or to one of the five root
  build-configuration files copied before it (`:43-47`, Store `:27-31`), busts it for every service
  image; a project or lock file under `Tests/` does not. The Gateway and web-host images copy individual `.csproj` files and
  keep a finer-grained cache (`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Dockerfile:33-34`).
- **ReadyToRun costs build time and image size.** It compiles per RID at publish, which is time
  spent on every image build and bytes carried in every layer, in exchange for latency at start.
- **The token is still a token.** Passing it as a secret protects the image, not the feed
  relationship: the build still requires a credential with `packages:read` even though the same
  packages are published credential-free to nuget.org (ADR-053), because both applications keep
  their `MMCA.*` source mapping on GitHub Packages.
- **The gate can block a deploy for a reason outside the diff.** A base-layer vulnerability that no
  scanner reports, in a container whose process runs as root, was the combination worth closing
  first, and the digest pin plus `USER $APP_UID` closed it; the gating scan closed the rest. The
  cost is that a CVE disclosed against a pinned digest, or a failure of the scan action itself,
  fails every deploy until the digest is bumped, the CVE is accepted in `.trivyignore`, or the job
  is re-run (`MMCA.ADC/.github/workflows/deploy.yml:1551-1557`).

## Revision (2026-09-07)
The open postures this record listed are closed in both consumers, from the 2026-09-07 security
review.

1. **Base images are pinned by digest** (SEC-ADC-32 / SEC-ADC-54 / SEC-Store-45 / SEC-Store-57). Each
   Dockerfile names the runtime and SDK images by `sha256` with the tag left as a readable suffix, so
   a rebuild resolves the same layers: for example
   `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Dockerfile:4` and `:10`, and
   `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Dockerfile:5` and `:12`. Dependabot's docker
   ecosystem (ADR-038) is what keeps a digest pin from becoming a pin to a stale, unpatched layer.
2. **The final stage runs as a non-root user** (SEC-ADC-58). `USER $APP_UID` is the last instruction
   before the entrypoint in every image (ADC `Dockerfile:67`, Store `Dockerfile:65`). The variable is
   set by the .NET base image, so the app does not have to invent a uid.
3. **The image build restores in locked mode** (SEC-Store-44 / SEC-ADC-31). The restore inside the
   build stage passes `--locked-mode` (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Dockerfile:38`,
   rationale at `:31-35`), which is what makes the shipped artifact's package graph the one the lock
   file and the CI vulnerability gate actually saw. The publish restore is deliberately left unlocked,
   and one image per repo is unlocked outright: see the 2026-09-10 revision for the current inventory.
4. **The built image is scanned, and since 2026-11-04 the scan gates the deploy** (Revision (2026-11-04) item 2; the rest of this item records the report-only posture that preceded it). Each deploy scans every image with Trivy
   (`MMCA.ADC/.github/workflows/deploy.yml:1297`, action pinned by SHA at `:1299`;
   `MMCA.Store/.github/workflows/deploy.yml:1183`, `:1191`). Neither gates: both steps carry
   `continue-on-error: true` (ADC `:1298`, Store `:1190`), so ADC's `exit-code: '1'` (`:1305`) marks
   the step failed without failing the job, and Store's `exit-code: '0'` (`:1197`) does not even do
   that. The flip to gating is recorded as a follow-up beside each (ADC `:1289-1296`, Store
   `:1174-1179`), and `ignore-unfixed: true` stays either way.

## Related
[ADR-038](038-supply-chain-provenance.md) (supply-chain provenance: it gates the **package** graph
with lock files, a vulnerability audit and an SBOM, and stops at the repository boundary, so the
image layers this ADR describes are outside its coverage),
[ADR-080](080-deploy-rollout-revision-rollback.md) (what happens to these images after they are
built: the revision-only rollout and automatic image rollback, whose `build-images` phase is the job
described here), [ADR-064](064-deploy-recency-gates.md) (the proof-of-recency preconditions on a
deploy, none of which observes the image contents, which is the gap the gating image scan above
covers),
[ADR-141](141-two-framework-lines-from-one-tree.md) (the net11.0 and net10.0 framework lines that
select ADC's runtime base image, lock file set and `latest` tag),
[ADR-053](053-dual-registry-package-publishing.md) (the dual-registry publishing that makes the credential
in decision 1 a repository-mapping choice rather than a necessity).

## Revision (2026-09-03)

**Container sizing is uniform, so the ReadyToRun argument applies evenly.** Decision 3 justified
ReadyToRun by the CPU the replicas land on and cited a split: four ADC apps at 0.25 vCPU / 0.5 GiB
and two at 0.5 vCPU / 1 GiB. There is no split now. All six ADC container apps, identity,
conference, engagement, notification, gateway and ui, are declared
`resources: { cpu: json('0.25'), memory: '0.5Gi' }`
(`MMCA.ADC/infra/main.bicep:1058,1267,1391,1532,1692,1805`), so every image in that application
starts on a quarter of a vCPU.

The two that moved are conference and gateway, and each records the measurement and its rollback in
place rather than in a commit message: conference averages 0.012-0.017 cores with a p95 under 0.03
against the 0.5 vCPU it previously held, its working set runs 320-380 MB, and a p95 of 376 MB is 73
percent of the new 512 MiB limit, which is called out as the one to watch
(`MMCA.ADC/infra/main.bicep:1260-1266`); the gateway shows the same CPU profile with a 190-235 MB
working set because it is pure YARP forwarding with no `DbContext`
(`MMCA.ADC/infra/main.bicep:1685-1691`). Reverting either to `{ cpu: json('0.5'), memory: '1Gi' }`
is one line and one deploy.

Both comments note the consequence that matters here: startup CPU spikes are throttled by the
smaller quota, so cold start roughly doubles, and revision overlap keeps the previous revision
serving until readiness goes green so traffic does not see it. That raises rather than weakens the
case for publishing the service and gateway images ReadyToRun, since the JIT work removed at
publish time is work the container no longer has quota to do quickly.

Citations for the two Store `build-images` anchors in Context and decision 1 are re-pointed to the
job and its `secrets:` input (`MMCA.Store/.github/workflows/deploy.yml:1091,1101-1116` and `:1158-1159`);
the workflow itself is unchanged in substance.

## Revision (2026-09-10)

**Locked mode is back on Store's four non-UI images, and the inventory is stated per image rather
than by one example.** The anchor in Revision (2026-09-07) item 3 pointed at a line that had stopped
carrying `--locked-mode`, so the record claimed a control the command no longer applied. It applies again, and
the current state is:

| Repo | Image | Build-stage restore | Locked |
| --- | --- | --- | --- |
| Store | `Source/Hosts/MMCA.Store.Gateway/Dockerfile` | `:41` | yes |
| Store | `Source/Services/MMCA.Store.Catalog.Service/Dockerfile` | `:38` | yes |
| Store | `Source/Services/MMCA.Store.Identity.Service/Dockerfile` | `:38` | yes |
| Store | `Source/Services/MMCA.Store.Sales.Service/Dockerfile` | `:38` | yes |
| Store | `Source/Hosts/UI/MMCA.Store.UI.Web/Dockerfile` | `:46` | no, by design |
| ADC | `Source/Hosts/MMCA.ADC.Gateway/Dockerfile` | `:32` | yes |
| ADC | `Source/Services/MMCA.ADC.Conference.Service/Dockerfile` | `:32` | yes |
| ADC | `Source/Services/MMCA.ADC.Engagement.Service/Dockerfile` | `:32` | yes |
| ADC | `Source/Services/MMCA.ADC.Identity.Service/Dockerfile` | `:32` | yes |
| ADC | `Source/Services/MMCA.ADC.Notification.Service/Dockerfile` | `:32` | yes |
| ADC | `Source/Hosts/UI/MMCA.ADC.UI.Web/Dockerfile` | `:41` | no, by design |

Nine of eleven, and the two exclusions are the same one in each repo. **The UI image is unlocked
because it has no lock file to check against**: Store's Blazor host and its WebAssembly client both
set `<RestorePackagesWithLockFile>false</RestorePackagesWithLockFile>`
(`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/MMCA.Store.UI.Web.csproj:5`,
`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web.Client/MMCA.Store.UI.Web.Client.csproj:8`), and ADC's
pair carries the same opt-out
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/MMCA.ADC.UI.Web.csproj:3`,
`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web.Client/MMCA.ADC.UI.Web.Client.csproj:8`, with the reason
stated in the Dockerfile itself at
`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Dockerfile:37`). Passing `--locked-mode` there would fail
every build rather than gate anything, so the flag's absence is the correct configuration and not an
unclosed hole.

**The publish restore stays unlocked in every image, in both repos.** ReadyToRun publishes to a
RID-specific path, which pulls a RID graph the committed lock does not describe, and locked mode
answers that with NU1004 regardless of whether anything actually drifted. Locking the build restore
is the narrow control that works: it is the restore whose graph the CI vulnerability gate and the
committed lock both saw, and it runs before the publish, so a drifted pin still fails the image
build. The SEC-Store-44 comment above Store's Sales restore now says exactly that
(`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Dockerfile:31-35`), which is the property a
rationale comment has to have: it describes the command beneath it.

**Related correction, same revision.** Revision (2026-09-07) item 4 asserted that ADC's Trivy scan
fails the job while Store's is report-only for one cycle, and the asymmetry does not exist: ADC's step carries
`continue-on-error: true` (`MMCA.ADC/.github/workflows/deploy.yml:1298`), so its `exit-code: '1'`
(`:1305`) marks the step failed and lets the job pass. Both consumers are report-only. ADC's own
comment (`:1293-1296`) names floating base images as the reason to stay non-gating, and that reason
is stale: the base images are digest-pinned (Revision (2026-09-07) item 1), so ADC can either flip
`continue-on-error` to `false` or rewrite the comment to state the real remaining reason. That choice
is left open here rather than decided.

## Revision (2026-10-01)

No decision or rationale changed. Three statements in Context and decision 4 no longer matched the
files and are corrected in place. **The digest pair is shared, not per repository**: all eleven
Dockerfiles name the same `aspnet` and `sdk` digests
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Dockerfile:4,10`,
`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Dockerfile:5,12`). **The Dockerfiles also differ
in the build-stage restore**: nine pass `--locked-mode` and the two web-host images do not
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Dockerfile:41`,
`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Dockerfile:46`), which the Revision (2026-09-10) table
already recorded. **8081 is not the gRPC port on the cited image**: on Identity, Conference and
Engagement it is the HTTP/1.1 health-probe listener beside the h2c ingress on 8080
(`MMCA.ADC/infra/main.bicep:1962-1963,1969`), and only Notification serves h2c gRPC on 8081, with its
probe on 8082 (`MMCA.ADC/infra/main.bicep:2196-2201`).

Every other Dockerfile, `deploy.yml` and `main.bicep` citation in Context, Decision, Runtime
postures and Trade-offs is re-anchored to the current line; the workflows and Dockerfiles moved, the
behavior did not. The earlier Revision sections keep the anchors they recorded. For reference, the
ADC Trivy step is now `MMCA.ADC/.github/workflows/deploy.yml:1172` (pin `:1174`, `continue-on-error`
`:1173`, `exit-code: '1'` `:1180`) and Store's is `MMCA.Store/.github/workflows/deploy.yml:1090`
(pin `:1098`, `continue-on-error` `:1097`, `exit-code: '0'` `:1104`, follow-up `:1081-1086`); the
non-root `USER` line in the Store services is `Dockerfile:72`; and ADC's Trivy comment still names a
floating base image as the reason to stay non-gating (`MMCA.ADC/.github/workflows/deploy.yml:1168-1171`),
so the stale-reason finding in Revision (2026-09-10) still stands.

## Revision (2026-10-06)

**One Trivy posture in both consumers, recorded as a decision.** Both deploy workflows run the scan
the same way: on every image leg, the re-tagged unchanged images included, with `exit-code: '1'` so a
CRITICAL or HIGH finding marks the step failed, and `continue-on-error: true` so the finding never
fails the job or stops the rollout (ADC `MMCA.ADC/.github/workflows/deploy.yml:1229`,
`continue-on-error` `:1230`, pin `:1231`, `exit-code` `:1237`; Store
`MMCA.Store/.github/workflows/deploy.yml:1174`, `continue-on-error` `:1175`, pin `:1176`, `exit-code`
`:1182`). Store's scan carries no `matrix.changed` guard and runs after the re-tag step (`:1128-1129`),
so a leg that only re-tagged is scanned too (`:1160-1161`). ADC's step comment gives the same reason
for staying non-gating, observing the baseline (`:1219-1223`), so the stale-reason finding of Revision
(2026-09-10) and Revision (2026-10-01) is closed. Both comments name the same exit: flip
`continue-on-error` to `false` once the baseline is clean or the residue is justified in a
`.trivyignore` (ADC `:1227-1228`, Store `:1170-1171`). This replaces the open item: the scan is a
deliberate non-gating report in both repos, not a difference between them.

Also corrected in this pass:

- **ADC sizing is no longer uniform.** Decision 3 and the Revision (2026-09-03) premise said all six
  ADC apps are declared 0.25 vCPU / 0.5 GiB. That is now the baseline only: `conferenceMode`
  (`MMCA.ADC/infra/main.bicep:157`) lifts conference, engagement, gateway and ui to 0.5 vCPU / 1 GiB
  through `conferenceScaledResources` (`:182`) and Identity to 1.0 vCPU / 2 GiB through
  `conferenceIdentityResources` (`:186`), and only notification keeps a literal 0.25 / 0.5Gi
  (`:2222`). The ReadyToRun argument holds at the baseline. The conference and gateway right-sizing
  comments that revision cited are now at `:1927-1933` and `:2393-2400`.
- **The build job gates per image.** Context now states that only a changed image is built and
  pushed (`matrix.changed`, ADC `MMCA.ADC/.github/workflows/deploy.yml:1150`, Store
  `MMCA.Store/.github/workflows/deploy.yml:1101`), and that an unchanged leg re-tags `latest` to the
  commit sha instead.
- **The 2026-09-25 Status note is superseded**: Store's Trivy scan runs on every leg, not only on a
  leg that rebuilt its image (see the paragraph above). The Revision (2026-10-01) claim that every
  `deploy.yml` and `main.bicep` citation in the live sections was current did not hold for the
  `build-images`, buildx, tag, cache, `secrets:`, SBOM, sha-reference, sizing and port anchors.
- Every `deploy.yml` and `main.bicep` anchor in Context, Decision and Runtime postures was
  re-verified against current source and re-pointed; the earlier Revision sections keep the anchors
  they recorded on their dates.

## Revision (2026-10-07)

Re-verified against current source. No decision, runtime posture or rationale changed: the secret
mount, the missing build stage, the ReadyToRun split, the shared-runtime entrypoint, the digest pin,
`USER $APP_UID`, the non-gating Trivy scan on every leg and the `conferenceMode` sizing all read as
recorded. What moved is the build job's description and most workflow and Bicep anchors: the
2026-10-07 workflow prunes in both consumers and further growth of `main.bicep` shifted every
workflow anchor and the per-app sizing, port and probe anchors, while the `conferenceMode` block
(`MMCA.ADC/infra/main.bicep:157`, rationale `:174-186`, `:182`, `:186`) and the Dockerfile anchors
did not move. The closing claim of Revision (2026-10-06) that the live-section anchors were current no longer
holds. That revision keeps the anchors it recorded on its date.

1. **ADC's re-tag step keeps `latest` alive.** After importing `latest` onto the commit sha, an
   unchanged ADC leg runs a second `az acr import` that copies the sha tag back onto `latest`
   (`MMCA.ADC/.github/workflows/deploy.yml:1108-1112`). The digest is the same; only the tag's update
   time moves, so the daily ACR purge (which keeps the most recently updated tags per repository)
   does not delete the tag the next unchanged leg reads from (rationale `:1100-1107`). This applies
   to every unchanged ADC leg. Store's re-tag step performs only the first import
   (`MMCA.Store/.github/workflows/deploy.yml:1045-1049`) under the same purge
   (`MMCA.Store/infra/foundation.bicep:103`), so Store's unchanged legs carry the failure mode ADC's
   second import prevents. Context now says so and records it as an open gap, not a decision.
2. **The SBOM step runs on pull requests only.** Both steps carry an `if:` on
   `github.event_name == 'pull_request'` (`MMCA.ADC/.github/workflows/deploy.yml:602`,
   `MMCA.Store/.github/workflows/deploy.yml:565`), and the solution-filter input sits at
   `MMCA.ADC/.github/workflows/deploy.yml:612` and `MMCA.Store/.github/workflows/deploy.yml:574`.
   Runtime postures now states that, which does not change the conclusion: the SBOM describes the
   NuGet graph, not the image.
3. **The publish-property citation pointed at the stage lines.** Context cited
   `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Dockerfile:4,10,41,55` for the one differing
   publish property; those are the four `FROM` lines. The property, `PublishReadyToRun=true`, is at
   `:53`, and Context now cites both.
4. Anchors re-verified against current source: ADC `deploy.yml` job `:998`, matrix `:1013-1032`,
   per-image gate rationale `:993-997`, buildx `:1049-1050`, build-push action `:1054`,
   `matrix.changed` `:1053`, tags `:1060-1062`, `secrets:` `:1068-1069`, secret and cache-key comment
   `:1063-1067`, job-header secret comment `:988-991`, cache `:1076-1077`, re-tag step `:1086-1099`,
   Trivy `:1132` (`continue-on-error` `:1133`, pin `:1134`, `exit-code: '1'` `:1140`, every-leg
   comment `:1118-1120`, non-gating reason `:1122-1129`, flip-to-gating exit `:1130-1131`), SBOM
   `:601-615`, sha references `:1061,1234,1268-1273`; Store `deploy.yml` job `:940`, matrix
   `:955-971`, `matrix.changed` `:997`, `secrets:` `:1013-1014`, re-tag step `:1024-1049`, Trivy
   `:1070` (`continue-on-error` `:1071`, pin `:1072`, `exit-code: '1'` `:1078`, every-leg comment
   `:1056-1058`, flip-to-gating exit `:1066-1067`), SBOM `:564-577`; ADC `main.bicep`
   `conferenceMode` `:157`, `conferenceScaledResources` `:182`, `conferenceIdentityResources` `:186`
   (rationale `:174-186`), notification literal `:2258`, conference `:1966`, engagement `:2109`,
   gateway `:2448`, ui `:2599`, identity `:1717`, Identity ports `:1691,1694,1733`, Conference
   `:1938,1941,1980`, Engagement `:2091,2094,2122`, Notification `:2226,2228,2230-2238,2276`, and the
   conference and gateway right-sizing comments `:1959-1965` and `:2440-2447`.

## Revision (2026-10-19)

No decision, runtime posture or rationale changed. The open gap recorded in Context and in item 1 of
Revision (2026-10-07) is closed: Store's "Re-tag unchanged ... image to this commit sha" step now runs
the same second `az acr import` ADC runs, copying the commit-sha tag back onto `latest` with `--force`
(`MMCA.Store/.github/workflows/deploy.yml:1060-1064`, rationale copied from ADC at `:1052-1059`, the
first import at `:1047-1051`). Store's registry runs the same daily purge
(`MMCA.Store/infra/foundation.bicep:103`), so an image left unchanged across many deploys keeps a fresh
`latest` and the next unchanged leg can still read it. Context now describes both consumers' re-tag
steps together, and the build and re-tag anchors in that paragraph are re-pointed (ADC job `:1013`,
matrix `:1028-1047`, buildx `:1065`, build-push `:1069`, `matrix.changed` `:1068`, tags `:1075-1077`,
cache `:1091-1092`, re-tag step `:1101-1127`, rationale `:1008-1012`; Store job `:942`, matrix
`:957-973`, `matrix.changed` `:999`, `latest` push `:1008`, re-tag step `:1026-1064`). Workflow and
Bicep anchors outside that paragraph were not re-verified in this revision.

## Revision (2026-10-21)

Re-verified against current source. No decision, runtime posture or rationale changed: the
`secrets:` input, the PR-only SBOM, the non-gating Trivy scan on every leg (`continue-on-error:
true`, `exit-code: '1'`, `ignore-unfixed: true` in both consumers), the sha-addressed deployment,
the `conferenceMode` sizing and the port topology all read as recorded. The re-tag paragraph in
Context, re-pointed on 2026-10-19, still holds. What moved is every other `deploy.yml` and
`main.bicep` anchor in Decision and Runtime postures, re-pointed in place. The earlier Revision
sections keep the anchors they recorded on their dates, including the open-gap wording of Revision
(2026-10-07) item 1, which Revision (2026-10-19) and the Context paragraph already record as closed.

1. Anchors re-verified against current source: ADC `deploy.yml` `secrets:` `:1083-1084`, job-header
   BuildKit secret comment `:1003-1006`, secret and cache-key comment `:1078-1082`, sha tag `:1076`,
   `IMAGE_TAG` `:1249`, per-image arguments `:1283-1288` (the every-image-by-sha comment is `:1095`),
   Trivy step `:1147` (`continue-on-error` `:1148`, `ignore-unfixed` `:1154`, `exit-code: '1'`
   `:1155`, every-leg comment `:1133-1135`), SBOM step `:615-629` (condition `:616`, filter `:626`);
   Store `deploy.yml` `secrets:` `:1015-1016`, Trivy step `:1085` (`continue-on-error` `:1086`,
   `ignore-unfixed` `:1092`, `exit-code: '1'` `:1093`, every-leg comment `:1071-1073`), SBOM step
   `:565-578` (condition `:566`, filter `:575`); ADC `main.bicep` notification literal `:2414`,
   conference `:2122`, engagement `:2265`, gateway `:2604`, ui `:2755`, identity `:1867`
   (`conferenceMode` `:157`, `conferenceScaledResources` `:182`, `conferenceIdentityResources`
   `:186`, rationale `:174-186` unchanged), Identity ports `:1841,1844,1883`, Conference
   `:2094,2097,2136`, Engagement `:2247,2250,2278`, Notification `:2382,2384,2390-2396,2432`, and the
   conference and gateway right-sizing comments `:2115-2121` and `:2597-2603`.

## Revision (2026-10-26)

Re-verified against current source. No decision, runtime posture or rationale changed: the per-image
`matrix.changed` gate, the two-import re-tag that keeps `latest` alive in both consumers, the
`secrets:` input, the PR-only SBOM, the non-gating Trivy scan on every leg (`continue-on-error:
true`, `exit-code: '1'`, `ignore-unfixed: true` in both), the sha-addressed deployment, the
`conferenceMode` sizing, the port topology and `USER $APP_UID` in all eleven images all read as
recorded. What moved is anchors only: every `deploy.yml` anchor in both consumers shifted by one
line, every per-app `main.bicep` anchor by 36, and the ADC Gateway `USER` line by one. All are
re-pointed in place in Context, Decision and Runtime postures. The earlier Revision sections keep
the anchors they recorded on their dates.

1. Anchors re-verified against current source: ADC `deploy.yml` job `:1014`, matrix `:1029-1048`,
   per-image gate rationale `:1009-1013`, buildx `:1066`, build-push `:1070`, `matrix.changed`
   `:1069`, tags `:1076-1078` (sha `:1077`, `latest` `:1078`), cache `:1092-1093`, `secrets:`
   `:1084-1085`, job-header BuildKit secret comment `:1004-1007`, secret and cache-key comment
   `:1079-1083`, re-tag step `:1102` (condition `:1103`, first import `:1111-1115`, rationale
   `:1116-1123`, second import `:1124-1128`), Trivy step `:1148` (`continue-on-error` `:1149`,
   action `:1150`, `ignore-unfixed` `:1155`, `exit-code: '1'` `:1156`, every-leg comment
   `:1134-1136`), SBOM step `:616-630` (condition `:617`, filter `:627`), `IMAGE_TAG` `:1250`,
   per-image arguments `:1284-1289`; Store `deploy.yml` job `:943`, matrix `:958-974`,
   `matrix.changed` `:1000`, `latest` push `:1009`, `secrets:` `:1016-1017`, cache-to `:1025`,
   re-tag step `:1027` (condition `:1028`, first import `:1048-1052`, rationale `:1053-1060`, second
   import `:1061-1065`), Trivy step `:1086` (`continue-on-error` `:1087`, `ignore-unfixed` `:1093`,
   `exit-code: '1'` `:1094`, every-leg comment `:1072-1074`), SBOM step `:566-579` (condition
   `:567`, filter `:576`); ADC `main.bicep` notification literal `:2450`, conference `:2158`,
   engagement `:2301`, gateway `:2640`, ui `:2791`, identity `:1903` (`conferenceMode` `:157`,
   `conferenceScaledResources` `:182`, `conferenceIdentityResources` `:186`, rationale `:174-186`
   unchanged), Identity ports `:1877,1880,1919`, Conference `:2130,2133,2172`, Engagement
   `:2283,2286,2314`, Notification `:2418,2420,2426-2432,2468`; ADC Gateway
   `Source/Hosts/MMCA.ADC.Gateway/Dockerfile:73` (`USER $APP_UID`; the other ten `USER` lines are
   unchanged).

## Revision (2026-10-28)

Re-verified against current source. No decision, runtime posture or rationale changed: the
`conferenceMode` sizing (0.25 vCPU / 0.5 GiB baseline, notification literal, the two conditional
resource variables) and the port topology (h2c ingress on 8080 with the HTTP/1.1 probe listener on
8081 for Identity, Conference and Engagement; Notification's `http` main ingress on 8080, h2c gRPC
on an additional 8081 port mapping and probe on 8082) all read as recorded. What moved is anchors
only: every per-app and port anchor in `MMCA.ADC/infra/main.bicep` shifted up by three lines, while
the `conferenceMode` block did not move. Decisions 3 and 4 are re-pointed in place. The earlier
Revision sections keep the anchors they recorded on their dates.

1. Anchors re-verified against current source: ADC `main.bicep` notification literal `:2447`,
   conference `:2155`, engagement `:2298`, gateway `:2637`, ui `:2788`, identity `:1900`
   (`conferenceMode` `:157`, `conferenceScaledResources` `:182`, `conferenceIdentityResources`
   `:186` unchanged), Identity ports `:1874,1877,1916`, Conference `:2127,2130,2169`, Engagement
   `:2280,2283,2311`, Notification `:2415,2417,2423-2429,2465`.

## Revision (2026-11-04)

The image scan is a deploy gate in both consumers, and every runtime stage is a chiseled image.
This closes the open gate recorded in Context ("What stays open is the gate, not the image") and the
non-gating decision of Revision (2026-10-06): the exit both workflows named, a clean baseline, was
met. Decision 4 now reads as item 2 below. The earlier Revision sections keep the anchors and
posture they recorded on their dates.

1. **Chiseled runtime images** (ADC #321, Store #254). All eleven final stages run on
   `mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled-extra`, still digest-pinned
   (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Dockerfile:7`,
   `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Dockerfile:7`; six of six ADC and five of
   five Store Dockerfiles). The `-extra` variant carries ICU and tzdata, which the `es` culture and
   time-zone conversions need. A chiseled image ships no shell and no package manager, which shrinks
   the base layer the scan below inspects.
2. **The scan gates.** The per-image Trivy step no longer carries `continue-on-error`, so a fixable
   CRITICAL or HIGH finding fails that `build-images` leg (`MMCA.ADC/.github/workflows/deploy.yml:1149`,
   action pinned by SHA at `:1150`, `exit-code: '1'` `:1156`; `MMCA.Store/.github/workflows/deploy.yml:1087`,
   `:1088`, `:1094`), and the deploy job requires `build-images` to succeed (ADC `:1197`, Store
   `:1131`), so nothing rolls out. The baseline that justified the flip: all eleven chiseled images
   scanned 0 OS and 0 dotnet-core CRITICAL/HIGH on the v1.277.0 deploys. Every leg is still scanned,
   re-tagged unchanged images included, and `ignore-unfixed: true` stays.
3. **The two exits, and the cost accepted.** A finding is cleared by bumping the base-image digest
   to a patched one, or by accepting a specific CVE in a repo-root `.trivyignore` with a written
   justification and a review date (the comment beside each step, ADC `:1138-1148`, Store
   `:1076-1086`). An infrastructure failure of the action itself (an ACR pull, a
   vulnerability-database download) now also blocks a deploy; the remedy is re-running the failed
   job, not bypassing the gate.

## Revision (2026-11-23)

Re-verified against current source. The three build decisions, decision 4's shared-runtime
entrypoint, the digest pin, `USER $APP_UID` in
all eleven images, the per-image `matrix.changed` gate, the two-import re-tag, the PR-only SBOM,
the sha-addressed deployment, the `conferenceMode` sizing and the port topology all read as
recorded. What moved is the image shape in ADC (the ADR-141 dual framework line), the SDK version,
the restore-layer copy, the analyzer switch on `main`, and every Dockerfile, workflow and Bicep
anchor. The live sections also still described the report-only Trivy posture that Revision
(2026-11-04) superseded; they now state the gate. The earlier Revision sections keep the anchors and
posture they recorded on their dates, including Revision (2026-11-04) item 1, which named
`10.0-noble-chiseled-extra` as the base of all eleven final stages.

1. **ADC builds one of two framework lines per image.** `ARG MMCA_NET=net11.0`
   (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Dockerfile:9`) selects
   `base-net11.0` on `aspnet:11.0-resolute-chiseled-extra` (`:20`) or `base-net10.0` on
   `aspnet:10.0-noble-chiseled-extra` (`:22`) through `FROM base-${MMCA_NET}` (`:24`), and sets
   `ENV MmcaNet` in the build stage (`:35-36`), so an ADC file has six `FROM` lines (`:20`, `:22`,
   `:24`, `:31`, `:75`, `:94`) where Store's has four
   (`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/Dockerfile:11,19,63,82`). The deploy
   workflow feeds the value from its `runtime` input (`MMCA.ADC/.github/workflows/deploy.yml:21-29`,
   `:38`, build argument `:1476`). ADC production therefore runs the 11.0 runtime; only its net10.0
   line shares Store's 10.0 runtime digest. Context and Runtime postures now say so.
2. **Every image builds on `sdk:11.0`**, one digest in all eleven files
   (`.../MMCA.ADC.Conference.Service/Dockerfile:31`, `.../MMCA.Store.Sales.Service/Dockerfile:19`);
   Store still targets net10.0 and runs on the 10.0 runtime (`:16-18`).
3. **ADC pushes `latest` from the production line only.** The `tags:` block adds `latest` only when
   `MMCA_NET == 'net11.0'` (`MMCA.ADC/.github/workflows/deploy.yml:1486`, reason `:1480-1483`), so a
   net10.0 rollback build pushes the sha tag alone, and the layer cache ref carries the line
   (`:1500-1503`). Store pushes both tags on every build
   (`MMCA.Store/.github/workflows/deploy.yml:1226-1228`) under one cache ref per image (`:1243-1244`).
4. **ADC locks against the selected line's lock file.** Five of the six ADC images (the four
   services and the Gateway) copy both `packages.lock.json` and `packages.net10.0.lock.json`
   (`.../MMCA.ADC.Conference.Service/Dockerfile:56`, `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Dockerfile:51`);
   UI.Web copies only `.csproj` files, because its two projects keep no lock file
   (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Dockerfile:47-54`, reason `:57-59`). And `MMCA.ADC/Directory.Build.props:89` points `NuGetLockFilePath` at the second on net10.0. The
   nine-of-eleven locked restore inventory holds: Store Gateway `:44`, Store Catalog, Identity and
   Sales `:48`, ADC Gateway `:56`, ADC Conference, Engagement, Identity and Notification `:61`;
   unlocked by design, ADC UI.Web `:60-62` (reason `:57-59`) and Store UI.Web `:47-49` (reason
   `:41-46`).
5. **The service images no longer copy all of `Source/` before restore.** They copy only the project
   and lock files with `COPY --parents` (`.../MMCA.ADC.Conference.Service/Dockerfile:56`,
   `.../MMCA.Store.Sales.Service/Dockerfile:39`) under a pinned `# syntax=docker/dockerfile:1.29.0`
   directive (`:1` in all seven service files), then the full tree after restore (`:65`, Store
   `:52`), so a source-only edit leaves the restore layer cached. The Trade-offs bullet that called
   the cache coarse is rewritten to the current cost.
6. **The image publish skips analyzers on `main`.** Publish passes `-p:RunAnalyzers=$RUN_ANALYZERS`
   (`.../MMCA.ADC.Conference.Service/Dockerfile:92`, default `true` at `:81`), and the workflow sets
   it to `false` on `main` (`MMCA.ADC/.github/workflows/deploy.yml:1477`,
   `MMCA.Store/.github/workflows/deploy.yml:1223`) because the pull-request jobs already ran the
   analyzers on the same tree. Decision 2 no longer says analyzer gating runs inside publish.
7. **The live sections state the gating scan.** Runtime postures, the last Trade-offs bullet, the
   last Rationale bullet and the ADR-064 entry in Related described the report-only scan as current.
   Source has no `continue-on-error` on either step (ADC
   `MMCA.ADC/.github/workflows/deploy.yml:1559-1566`, Store
   `MMCA.Store/.github/workflows/deploy.yml:1306-1313`), and the deploy job proceeds only when
   `build-images` succeeded (ADC `:1607`, Store `:1350`).
8. **The ACR purge and SBOM details.** Both registries purge with
   `acr purge --filter '.*:.*' --ago 3d --keep 3 --untagged` and trim the layer cache with a second
   line (`--filter 'buildcache:.*' --ago 1h --keep 10 --untagged`;
   `MMCA.ADC/infra/foundation.bicep:132,135`, `MMCA.Store/infra/foundation.bicep:132,135`). The SBOM
   step runs the shared MMCA.Common `cyclonedx-sbom` composite action pinned to the v1.313.0 release
   commit and fails on a missing or empty BOM (`MMCA.ADC/.github/workflows/deploy.yml:806-815`,
   `MMCA.Store/.github/workflows/deploy.yml:649`).
9. Anchors re-verified against current source: ADC Conference Dockerfile restore mount `:59-61`,
   publish mount `:90-92`, secret reason `:37-39`, no-build note `:67-73`, ReadyToRun comment
   `:82-83`, final stage `:94-107`, `EXPOSE` `:26-27`, `USER` comment `:98-105`; ReadyToRun ADC
   services `:92`, ADC Gateway `:88`, Store services `:80`, Store Gateway `:76`; web-host publish ADC
   `:81`, Store `:67`; no-build notes Store Gateway `:50-57`, ADC UI.Web `:67-69`, Store UI.Web
   `:54-56`; Store Gateway project copy `:33-34`; `USER $APP_UID` ADC services `:106`, ADC Gateway
   `:103`, ADC UI.Web `:95`, Store services `:93`, Store Gateway `:89`, Store UI.Web `:80`. ADC
   `deploy.yml` job `:1410`, matrix `:1426-1444`, per-image gate rationale `:1405-1409`, buildx
   `:1462`, build-push `:1466`, `matrix.changed` `:1465`, build arguments `:1475-1477`, tags
   `:1484-1486`, secret and cache-key comment `:1487-1491`, `secrets:` `:1492-1493`, job-header
   secret comment `:1400-1403`, cache `:1502-1503`, re-tag step condition `:1513` (first import
   `:1521-1525`, rationale `:1526-1533`, second import `:1534-1538`), Trivy `:1559-1566` (every-leg
   comment `:1544-1546`, gating comment `:1548-1558`), SBOM `:804-820` (condition `:805`, filter
   `:817`), deploy `needs.build-images.result` `:1607`, `IMAGE_TAG` `:1674`, per-image arguments
   `:1718-1723`. Store `deploy.yml` job `:1157`, matrix `:1172-1188`, `matrix.changed` `:1214`,
   build-push `:1215`, tags `:1226-1228`, `secrets:` `:1235-1236`, cache `:1243-1244`, re-tag step
   condition `:1247` (first import `:1267-1271`, rationale `:1272-1279`, second import
   `:1280-1284`), Trivy `:1306-1313` (every-leg comment `:1291-1293`, gating comment `:1295-1305`),
   SBOM `:641-654` (condition `:642`, filter `:651`), deploy condition `:1350`. ADC `main.bicep`
   `conferenceMode` `:179`, `conferenceScaledResources` `:204`, `conferenceIdentityResources` `:208`
   (rationale `:196-208`), notification literal `:2753`, conference `:2446`, engagement `:2591`,
   gateway `:2947`, ui `:3098`, identity `:2175`, Identity ports `:2147,2150,2192`, Conference
   `:2418,2421,2461`, Engagement `:2572,2575,2606`, Notification `:2720,2722,2731-2732,2772`.
