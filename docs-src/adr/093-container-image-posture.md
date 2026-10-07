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
## Context
Eleven Dockerfiles produce every deployable container in the two Azure-hosted applications: six in
MMCA.ADC (four services, the Gateway, the Blazor web host) and five in MMCA.Store (three services,
the Gateway, the Blazor web host). They are uniform by copy, not by a shared base file or a template:
each one is a four-stage file with the same shape (`base` on
`mcr.microsoft.com/dotnet/aspnet:10.0`, `build` on `mcr.microsoft.com/dotnet/sdk:10.0`, `publish`,
`final`), and the differences between them are the project path, the `COPY` granularity (the two
web-host images also copy the `.slnx`), whether the build-stage restore passes `--locked-mode` (the
two web-host images do not: `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Dockerfile:41`,
`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Dockerfile:46`), and one publish property
(`PublishReadyToRun=true`, `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Dockerfile:53`; the
four stage lines are `:4`, `:10`, `:41` and `:55`).
Both of those base images are named by `sha256` digest with the tag kept as a readable suffix, and
all eleven images resolve the same runtime and SDK pair (ADC
`.../MMCA.ADC.Conference.Service/Dockerfile:4` and `:10`, Store
`.../MMCA.Store.Sales.Service/Dockerfile:5` and `:12`; see Revision (2026-09-07) item 1).
Nothing in the repositories reconciles them: an edit to one is an edit to one.

That uniformity encodes three decisions that were made once, defended in Dockerfile comments, and
never written down anywhere a reader of the architecture library would find them. It also left two
runtime properties in the state of "what the default gave us", which was worth recording as such so
that a later hardening pass started from a stated position rather than from a discovery. That pass
ran on 2026-09-07 and closed both.

The images are built in CI, not by hand: a fan-out `build-images` matrix job with one leg per image
(`MMCA.ADC/.github/workflows/deploy.yml:998,1013-1032` for the six ADC legs,
`MMCA.Store/.github/workflows/deploy.yml:940,955-971` for the five Store legs). A leg whose image
changed runs `docker/build-push-action@v7` over a buildx builder
(`MMCA.ADC/.github/workflows/deploy.yml:1049-1050,1054`), pushes the image to ACR under both the
commit sha and `latest` (`:1060-1062`), and caches layers in that same registry with `mode=max`
(`:1076-1077`). The build step is gated per image on `matrix.changed` (ADC `:1053`, Store
`MMCA.Store/.github/workflows/deploy.yml:997`); a leg whose image is unchanged skips the build and
instead re-tags the last `latest` to the commit sha with `az acr import` (ADC `:1086-1099`, Store
`MMCA.Store/.github/workflows/deploy.yml:1024-1049`), so the leg still succeeds and every image
exists under the sha the deployment addresses (rationale
`MMCA.ADC/.github/workflows/deploy.yml:993-997`). ADC's re-tag step then runs a second
`az acr import` that copies the new sha tag back onto `latest` (`:1108-1112`, rationale
`:1100-1107`): the digest is the same, only the tag's update time moves, so the daily ACR purge does
not age out the tag an unchanged leg reads from. Store's re-tag step performs only the first import
(`MMCA.Store/.github/workflows/deploy.yml:1045-1049`), although Store's registry runs the same daily
purge (`acr purge --filter '.*:.*' --ago 3d --keep 3`, `MMCA.Store/infra/foundation.bicep:103`) and
only a rebuilt leg pushes `latest` (`MMCA.Store/.github/workflows/deploy.yml:1006`). A Store image
left unchanged across enough deploys is therefore exposed to the failure ADC's second import
prevents (a purged `latest` fails the next unchanged leg and blocks the deploy). No source records
this as a deliberate choice; it is an open gap.
The job runs concurrently with the e2e gate and rolls nothing out; that separation is ADR-080's
subject, not this one's.

## Decision
**1. The GitHub Packages credential is a BuildKit secret, never an `ARG` or `ENV`.** Both
applications' `nuget.config` source-maps `MMCA.*` to GitHub Packages, so every restore inside an
image needs a token. It arrives as `--secret id=github_token`, mounted into the restore `RUN`
(`.../MMCA.ADC.Conference.Service/Dockerfile:30-32`) and again into the publish `RUN` (`:51-53`),
because publish performs its own restore pass. The value is read out of `/run/secrets/github_token`
into a shell-local `GITHUB_TOKEN` that lives only for that command, which is the variable
`nuget.config` expands. The Dockerfile states the reason in place: a build-arg promoted to `ENV`
lands in image layers, the build cache, and `docker history` (`:12-14`). CI passes it as a
`secrets:` input to the build action, not a `build-args:` input
(`MMCA.ADC/.github/workflows/deploy.yml:1068-1069`,
`MMCA.Store/.github/workflows/deploy.yml:1013-1014`), and the workflow repeats the constraint in its
own comments (`MMCA.ADC/.github/workflows/deploy.yml:988-991`). Secret *content* is deliberately not
part of the BuildKit cache key, so rotating the token does not invalidate the restore layer; that is
safe only because the package set is pinned by committed lock files and any
`Directory.Packages.props` change lands in a `COPY` layer that busts the cache anyway
(`MMCA.ADC/.github/workflows/deploy.yml:1063-1067`).

**2. There is deliberately no separate `dotnet build` stage.** The `build` stage restores and stops;
`publish` does its own restore and build. This is a measured decision, dated in the file: on
2026-07-24 (CI run 30115729720) the build stage emitted `bin/Release/net10.0/` while the
ReadyToRun publish emitted `bin/Release/net10.0/linux-x64/`, because the SDK infers a RID for
ReadyToRun. Different paths, so publish never reused build output and every image compiled twice,
about 75 seconds of pure waste per image
(`.../MMCA.ADC.Conference.Service/Dockerfile:34-39`). The Store Dockerfiles carry the same note and
cite the ADC measurement rather than repeating it
(`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Dockerfile:47-52`). Nothing is lost by dropping the
stage: analyzer gating (`TreatWarningsAsErrors`, `AnalysisMode=All`) runs inside publish. The two
web-host images, which do not use ReadyToRun, drop the stage for the weaker reason that it is one
redundant MSBuild evaluation (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Dockerfile:46-48`,
`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Dockerfile:51-53`).

**3. `PublishReadyToRun=true` on the nine service and gateway images, and only those.** The four ADC
services and the ADC Gateway (`.../MMCA.ADC.Conference.Service/Dockerfile:53`,
`.../MMCA.ADC.Identity.Service/Dockerfile:53`, `.../MMCA.ADC.Engagement.Service/Dockerfile:53`,
`.../MMCA.ADC.Notification.Service/Dockerfile:53`, `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Dockerfile:58`)
and the three Store services and the Store Gateway
(`.../MMCA.Store.Catalog.Service/Dockerfile:59`, `.../MMCA.Store.Identity.Service/Dockerfile:59`,
`.../MMCA.Store.Sales.Service/Dockerfile:59`,
`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Dockerfile:66`) AOT-compile IL at publish time. The two
Blazor web hosts do not (`.../MMCA.ADC.UI.Web/Dockerfile:55`,
`.../MMCA.Store.UI.Web/Dockerfile:59`). The stated purpose is cold start: deploys, restarts and
scale-out replicas skip first-request JIT (`.../MMCA.ADC.Conference.Service/Dockerfile:43-44`), and
the containers those replicas land on are fractional-vCPU Container Apps. Outside conference mode
all six ADC apps (identity, conference, engagement, notification, gateway, ui) run on 0.25 vCPU /
0.5 GiB: notification declares it literally (`MMCA.ADC/infra/main.bicep:2258`), and the other five
take it as the baseline branch of `conferenceScaledResources` (`:182`; conference `:1966`,
engagement `:2109`, gateway `:2448`, ui `:2599`) or `conferenceIdentityResources` (`:186`;
identity `:1717`). The `conferenceMode` parameter (`:157`) lifts those four to 0.5 vCPU / 1 GiB and
Identity to 1.0 vCPU / 2 GiB for conference day (rationale `:174-186`). On that much CPU, JIT time
is not noise.

**4. Every image is published with `UseAppHost=false` and started through the shared runtime.** The
`final` stage is the `base` stage plus the publish output, `ENV ASPNETCORE_ENVIRONMENT=Production`,
`USER $APP_UID` (added 2026-09-07, see the revision below) and `ENTRYPOINT ["dotnet", "<Host>.dll"]`
(`.../MMCA.ADC.Conference.Service/Dockerfile:55-68`); the base stage exposes 8080 and 8081
(`:6-7`). For Identity, Conference and Engagement, 8080 is the h2c ingress endpoint and 8081 the
HTTP/1.1 health-probe listener (Identity `MMCA.ADC/infra/main.bicep:1691,1694,1733`, Conference
`:1938,1941,1980`, Engagement `:2091,2094,2122`); only Notification serves h2c gRPC on 8081, the
ADR-012 mixed profile, behind an `http` main ingress on 8080, with its probe listener on 8082
(`MMCA.ADC/infra/main.bicep:2226,2228,2230-2238,2276`). No image installs a package, adds
a shell script, or runs a health-check command of its own: liveness is the Container Apps probe
configured in Bicep.

## Runtime postures (closed 2026-09-07)
**The base image is pinned by digest.** All eleven images name the runtime and the SDK image by
`sha256`, with the `10.0` tag left in place as a readable suffix (ADC
`.../MMCA.ADC.Conference.Service/Dockerfile:4` and `:10`; Store
`.../MMCA.Store.Sales.Service/Dockerfile:5` and `:12`). A rebuild of the same commit now resolves
the same runtime layer, and Microsoft's monthly runtime patches arrive as a Dependabot bump of the
digest rather than as a side effect of rebuilding (ADR-038). That restores the symmetry with the
application layer, which was already pinned: the deployment references each image by commit sha, not
by `latest` (`MMCA.ADC/.github/workflows/deploy.yml:1061,1234,1268-1273`). See Revision (2026-09-07)
item 1.

**Every image drops privileges.** `USER $APP_UID` is the last instruction before the entrypoint in
all eleven (ADC services `Dockerfile:67`, ADC Gateway `:72`, ADC UI.Web `:69`, Store services and
Store UI.Web `:72`, Store Gateway `:79`), and the .NET base image is what defines the uid. The
comment above the line records what kept the change to one line per file: nothing in these images
writes to the container filesystem at runtime, and every port the host binds is 8080 or higher,
outside the range a non-root user cannot bind
(`.../MMCA.ADC.Conference.Service/Dockerfile:59-66`). See Revision (2026-09-07) item 2.

What stays open is the gate, not the image. Each deploy scans the image it pushes with Trivy, but
report-only in both consumers (`MMCA.ADC/.github/workflows/deploy.yml:1132-1133`,
`MMCA.Store/.github/workflows/deploy.yml:1070-1071`), so a base-layer CRITICAL or HIGH is printed in the
step log and does not stop a rollout. Both scan every leg's tag, including a leg that only re-tagged
an unchanged image (ADC `MMCA.ADC/.github/workflows/deploy.yml:1118-1120`; Store's scan runs after its
re-tag step, `MMCA.Store/.github/workflows/deploy.yml:1056-1058`), so a CVE disclosed after an image
was built is still found. The supply-chain job generates its CycloneDX SBOM from the solution filter,
on pull requests only (`MMCA.ADC/.github/workflows/deploy.yml:601-615`, condition `:602`, filter
`:612`; `MMCA.Store/.github/workflows/deploy.yml:564-577`, condition `:565`, filter `:574`), so it
describes the NuGet graph
and not the image, which leaves that report-only scan as the only thing in either pipeline that
looks at the base layer at all. Keeping it non-gating while the baseline is observed is the recorded
decision for both repos: see Revision (2026-10-06).

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
  trade-off instead of rediscovering the state, and two of those three are closed because of it.

## Trade-offs
- **Eleven copies drift independently.** There is no shared base Dockerfile and no test that
  compares them, so a fix applied to one image is applied to one image. The ReadyToRun split (nine
  yes, two no) is deliberate, but it means "they are all the same" is already false and a reader
  cannot rely on any single file as the canonical one.
- **Full-source copies make the cache coarse.** The service images copy the whole `Source/` tree
  before restore (`.../MMCA.ADC.Conference.Service/Dockerfile:27`) because the project-reference
  chains through the migrations projects are deep, so any source edit invalidates the restore layer
  for those images. The Gateway and web-host images copy individual `.csproj` files first and keep
  the finer-grained cache (`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Dockerfile:30-31`).
- **ReadyToRun costs build time and image size.** It compiles per RID at publish, which is time
  spent on every image build and bytes carried in every layer, in exchange for latency at start.
- **The token is still a token.** Passing it as a secret protects the image, not the feed
  relationship: the build still requires a credential with `packages:read` even though the same
  packages are published credential-free to nuget.org (ADR-053), because both applications keep
  their `MMCA.*` source mapping on GitHub Packages.
- **The compounding posture was closed first; the gate was not.** A base-layer vulnerability that no
  scanner reports, in a container whose process runs as root, was the combination worth closing
  first, and the digest pin plus `USER $APP_UID` closed it. What is left is weaker and singular: the
  scan runs and reports, and nothing fails a deploy on what it finds.

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
4. **The built image is scanned, report-only in both.** Each deploy scans every image with Trivy
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
deploy, none of which observes the image contents, which is the gap the report-only image scan above
names),
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
