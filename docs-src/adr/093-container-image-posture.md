# ADR-093: Container Image Build and Runtime Posture

## Status
Accepted (2026-08-23) for the three build decisions below. The two runtime postures in "Open
postures" are recorded as **undecided**: they describe what the images do today and the trade-off
each one carries, not a decision to keep doing it.

## Context
Eleven Dockerfiles produce every deployable container in the two Azure-hosted applications: six in
MMCA.ADC (four services, the Gateway, the Blazor web host) and five in MMCA.Store (three services,
the Gateway, the Blazor web host). They are uniform by copy, not by a shared base file or a template:
each one is a four-stage file with the same shape (`base` on
`mcr.microsoft.com/dotnet/aspnet:10.0`, `build` on `mcr.microsoft.com/dotnet/sdk:10.0`, `publish`,
`final`), and the differences between them are the project path, the `COPY` granularity, and one
publish property (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Dockerfile:1,6,37,46`).
Nothing in the repositories reconciles them: an edit to one is an edit to one.

That uniformity encodes three decisions that were made once, defended in Dockerfile comments, and
never written down anywhere a reader of the architecture library would find them. It also leaves two
runtime properties in the state of "what the default gave us", which is worth recording as such so
that a later hardening pass starts from a stated position rather than from a discovery.

The images are built in CI, not by hand: a fan-out `build-images` matrix job with one leg per image
(`MMCA.ADC/.github/workflows/deploy.yml:898,908-926` for the six ADC legs,
`MMCA.Store/.github/workflows/deploy.yml:844,854-869` for the five Store legs) runs
`docker/build-push-action@v7` over a buildx builder
(`MMCA.ADC/.github/workflows/deploy.yml:943-948`), pushes each image to ACR under both the commit sha
and `latest` (`:954-956`), and caches layers in that same registry with `mode=max` (`:970-971`).
The job runs concurrently with the e2e gate and rolls nothing out; that separation is ADR-080's
subject, not this one's.

## Decision
**1. The GitHub Packages credential is a BuildKit secret, never an `ARG` or `ENV`.** Both
applications' `nuget.config` source-maps `MMCA.*` to GitHub Packages, so every restore inside an
image needs a token. It arrives as `--secret id=github_token`, mounted into the restore `RUN`
(`.../MMCA.ADC.Conference.Service/Dockerfile:26-28`) and again into the publish `RUN` (`:42-44`),
because publish performs its own restore pass. The value is read out of `/run/secrets/github_token`
into a shell-local `GITHUB_TOKEN` that lives only for that command, which is the variable
`nuget.config` expands. The Dockerfile states the reason in place: a build-arg promoted to `ENV`
lands in image layers, the build cache, and `docker history` (`:8-10`). CI passes it as a
`secrets:` input to the build action, not a `build-args:` input
(`MMCA.ADC/.github/workflows/deploy.yml:962-963`,
`MMCA.Store/.github/workflows/deploy.yml:908-909`), and the workflow repeats the constraint in its
own comments (`MMCA.ADC/.github/workflows/deploy.yml:887-891`). Secret *content* is deliberately not
part of the BuildKit cache key, so rotating the token does not invalidate the restore layer; that is
safe only because the package set is pinned by committed lock files and any
`Directory.Packages.props` change lands in a `COPY` layer that busts the cache anyway
(`MMCA.ADC/.github/workflows/deploy.yml:958-961`).

**2. There is deliberately no separate `dotnet build` stage.** The `build` stage restores and stops;
`publish` does its own restore and build. This is a measured decision, dated in the file: on
2026-07-24 (CI run 30115729720) the build stage emitted `bin/Release/net10.0/` while the
ReadyToRun publish emitted `bin/Release/net10.0/linux-x64/`, because the SDK infers a RID for
ReadyToRun. Different paths, so publish never reused build output and every image compiled twice,
about 75 seconds of pure waste per image
(`.../MMCA.ADC.Conference.Service/Dockerfile:30-35`). The Store Dockerfiles carry the same note and
cite the ADC measurement rather than repeating it
(`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Dockerfile:32-37`). Nothing is lost by dropping the
stage: analyzer gating (`TreatWarningsAsErrors`, `AnalysisMode=All`) runs inside publish. The two
web-host images, which do not use ReadyToRun, drop the stage for the weaker reason that it is one
redundant MSBuild evaluation (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Dockerfile:39-41`,
`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Dockerfile:39-41`).

**3. `PublishReadyToRun=true` on the nine service and gateway images, and only those.** The four ADC
services and the ADC Gateway (`.../MMCA.ADC.Conference.Service/Dockerfile:44`,
`.../MMCA.ADC.Identity.Service/Dockerfile:44`, `.../MMCA.ADC.Engagement.Service/Dockerfile:44`,
`.../MMCA.ADC.Notification.Service/Dockerfile:44`, `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Dockerfile:47`)
and the three Store services and the Store Gateway
(`.../MMCA.Store.Catalog.Service/Dockerfile:42`, `.../MMCA.Store.Identity.Service/Dockerfile:42`,
`.../MMCA.Store.Sales.Service/Dockerfile:42`,
`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Dockerfile:45`) AOT-compile IL at publish time. The two
Blazor web hosts do not (`.../MMCA.ADC.UI.Web/Dockerfile:48`,
`.../MMCA.Store.UI.Web/Dockerfile:47`). The stated purpose is cold start: deploys, restarts and
scale-out replicas skip first-request JIT (`.../MMCA.ADC.Conference.Service/Dockerfile:39-40`), and
the containers those replicas land on are fractional-vCPU Container Apps: 0.25 vCPU / 0.5 GiB for
four of the six ADC apps and 0.5 vCPU / 1 GiB for the other two
(`MMCA.ADC/infra/main.bicep:1026,1222,1346,1487,1631,1737`). On that much CPU, JIT time is not
noise.

**4. Every image is published with `UseAppHost=false` and started through the shared runtime.** The
`final` stage is the `base` stage plus the publish output, `ENV ASPNETCORE_ENVIRONMENT=Production`,
and `ENTRYPOINT ["dotnet", "<Host>.dll"]`
(`.../MMCA.ADC.Conference.Service/Dockerfile:46-50`); the base stage exposes 8080 and 8081, the
REST and h2c gRPC ports of the ADR-012 endpoint profile (`:3-4`). No image installs a package, adds
a shell script, or runs a health-check command of its own: liveness is the Container Apps probe
configured in Bicep.

## Open postures (undecided)
**The base image is a floating tag, not a digest.** All eleven images start from
`mcr.microsoft.com/dotnet/aspnet:10.0` with no digest pin
(`.../MMCA.ADC.Conference.Service/Dockerfile:1` and the corresponding first line of the other ten),
and build on `mcr.microsoft.com/dotnet/sdk:10.0` the same way (`:6`). The consequence is two-sided
and neither side has been chosen: a rebuild picks up Microsoft's monthly runtime patches with no
action, and a rebuild is also not reproducible, since the same commit built a month apart yields a
different runtime layer. Note the asymmetry with the application layer, which *is* pinned: the
deployment references each image by commit sha, not by `latest`
(`MMCA.ADC/.github/workflows/deploy.yml:955,1095-1100`). So the code in a revision is exactly
identified and the runtime under it is not.

**No image drops privileges: all eleven run as root.** No Dockerfile in either repository contains a
`USER` directive, and the `final` stage adds no user (`.../MMCA.ADC.Conference.Service/Dockerfile:46-50`).
The .NET 10 `aspnet` image ships a non-root `app` user, so this is one line per file plus a check
that nothing writes outside the publish directory, not a rearchitecture. It has not been done, and
nothing currently fails because of it: Container Apps runs each container in its own sandbox, so
root inside the container is not root on a shared host.

Neither posture is currently observed by any gate. The supply-chain job generates its CycloneDX SBOM
from the solution filter (`MMCA.ADC/.github/workflows/deploy.yml:441-450`), so it describes the
NuGet graph, not the image: no image scanner runs in either pipeline, and a base-layer CVE would
therefore not be reported by the checks that gate a deploy.

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
  root user, no image scan" down as open is what lets a later hardening pass argue about the
  trade-off instead of rediscovering the state.

## Trade-offs
- **Eleven copies drift independently.** There is no shared base Dockerfile and no test that
  compares them, so a fix applied to one image is applied to one image. The ReadyToRun split (nine
  yes, two no) is deliberate, but it means "they are all the same" is already false and a reader
  cannot rely on any single file as the canonical one.
- **Full-source copies make the cache coarse.** The service images copy the whole `Source/` tree
  before restore (`.../MMCA.ADC.Conference.Service/Dockerfile:23`) because the project-reference
  chains through the migrations projects are deep, so any source edit invalidates the restore layer
  for those images. The Gateway and web-host images copy individual `.csproj` files first and keep
  the finer-grained cache (`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Dockerfile:21`).
- **ReadyToRun costs build time and image size.** It compiles per RID at publish, which is time
  spent on every image build and bytes carried in every layer, in exchange for latency at start.
- **The token is still a token.** Passing it as a secret protects the image, not the feed
  relationship: the build still requires a credential with `packages:read` even though the same
  packages are published credential-free to nuget.org (ADR-053), because both applications keep
  their `MMCA.*` source mapping on GitHub Packages.
- **Root plus a floating base is the compounding one.** Individually each open posture is mild; a
  base-layer vulnerability that no scanner reports, in a container whose process runs as root, is
  the combination worth closing first.

## Related
[ADR-038](038-supply-chain-provenance.md) (supply-chain provenance: it gates the **package** graph
with lock files, a vulnerability audit and an SBOM, and stops at the repository boundary, so the
image layers this ADR describes are outside its coverage),
[ADR-080](080-deploy-rollout-revision-rollback.md) (what happens to these images after they are
built: the revision-only rollout and automatic image rollback, whose `build-images` phase is the job
described here), [ADR-064](064-deploy-recency-gates.md) (the proof-of-recency preconditions on a
deploy, none of which observes the image contents, which is the gap the open postures above name),
[ADR-053](053-dual-registry-package-publishing.md) (the dual-registry publishing that makes the credential
in decision 1 a repository-mapping choice rather than a necessity).
