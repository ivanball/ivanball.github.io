# ADR-038: Supply-Chain Provenance (SBOM Release Gate + Lock Files + Vulnerability Audit)

## Status
Accepted (2026-07-06; revised 2026-07-21).
Revised 2026-09-07 (MMCA.Common pins every action by commit SHA and every global tool by version,
restores in locked mode, fails the vulnerability gate closed, and gates the release behind a
protected environment plus a merged-main assertion).
Revised 2026-09-19 (locked-mode restore described at its actual scope: the two explicit restore steps,
CI `build-and-test` and release `publish`, not every job in either workflow).
Revised 2026-09-22 (build-provenance attestations on every released nupkg; the audit and SBOM gates are shared composite actions consumed by ADC and Store; see the Revision below).
Revised 2026-10-01 (current-state sections re-anchored to the composite actions; see the Revision below).
Revised 2026-10-06: the SQLitePCLRaw pin is recorded at its current version (3.0.5) and both projects that reference it, and `wasm-payload-budget` joins the first-party actions consumers reference by branch.
Revised 2026-10-07: anchors refreshed after the v1.233.0 release, and the 2026-09-07 record of two `dotnet-coverage` installs is updated: the second install has since been removed, leaving the single pinned install in CI `build-and-test`.
Revised 2026-10-21: the accept-list is no longer empty; it holds five ImageSharp 3.1.12 advisories, each with a reachability argument, and the consumer and SQLitePCLRaw anchors are refreshed.
Revised 2026-10-25: the accept-list is empty again; the five ImageSharp 3.1.12 entries were removed in 1.258.0 when ImageSharp left the dependency graph, and the consumers deleted their mirrored entries in the same sweep (see the Revision below).
Revised 2026-10-26: the 2026-10-06 record that every `uses:` remains SHA-pinned is qualified to third-party actions (four `uses:` lines reference the repository's own composite actions by local path), and anchors are refreshed after the v1.261.0 release.
Revised 2026-10-28: the first Trade-offs bullet now states that every released nupkg carries a build-provenance attestation while the SBOM is kept only as an unattested workflow artifact under the repository's artifact retention, and the CHANGELOG and SQLitePCLRaw anchors are refreshed.
Revised 2026-11-23: the accept-list holds two net11.0 `System.Security.Cryptography.Pkcs` false-positive entries, the SQLitePCLRaw pin is retired, the release gates run in `contents: read` pack jobs ahead of the publish jobs, the CI and release workflows hold four locked restores, and both consumers pin the five first-party actions by commit SHA instead of `@main` (see the Revision below).
## Context
MMCA.Common is a published framework: on every `v*` tag (release.yml:3-5) it packs its NuGet packages
and pushes them to both GitHub Packages (release.yml:167-168) and nuget.org through OIDC trusted
publishing (release.yml:170-188), where the two production apps and the reference seed consume
them. A published framework is a supply-chain amplifier: a vulnerable, substituted, or unreproducible
dependency does not stay in one repo, it ships downstream to every consumer. Rubric §32 (Dependency &
Supply-Chain Management) is weighted higher for exactly this reason: its default weight rises to 3 for
a published framework such as MMCA.Common (ArchitectureEvaluationCriteria.md:861), and it asks for
provenance and integrity (SBOM, lock files, trusted sources only) on top of the versioning hygiene
§15 covers (ArchitectureEvaluationCriteria.md:852).

ADR-016 answers two dependency-governance questions (how the packages version and roll out, and the
MassTransit-v8 license pin), but it deliberately stops there. The four controls that actually
establish provenance and integrity, an SBOM release gate, committed lock files, a CI vulnerability
audit, and package source mapping, already live in the release and CI workflows,
`Directory.Build.props`, and `nuget.config`, and are summarized for consumers in SECURITY.md
(SECURITY.md:48-57). No ADR owned them as a single coherent posture. This record does, and it exceeds
ADR-016's scope: ADR-016 gestures at lock files as sweep mechanics, this ADR owns supply-chain
integrity as the decision.

## Decision
Treat supply-chain integrity as a set of build-gating controls, the same invariant-over-discipline
posture ADR-015 applies to architecture rules. Four controls, each a hard gate:

1. **A CycloneDX SBOM is a hard release gate.** The release workflow's `pack` job calls the shared
   `cyclonedx-sbom` composite action with output directory `./sbom` (release.yml:110-114), which
   installs the CycloneDX tool (.github/actions/cyclonedx-sbom/action.yml:55-56) and generates a JSON
   software bill of materials for the whole solution (action.yml:70). It then fails the release
   (`exit 1`) when the BOM file is missing or empty (`test -s "$bom"`, action.yml:72) or lists zero
   components (action.yml:73-75), and the upload step sets `if-no-files-found: error`
   (release.yml:116-121). `pack-maui` runs the same action over `./sbom-maui` (release.yml:315-322)
   with its own upload (release.yml:324-329). The step runs as a blocking gate (release.yml:106-109),
   and both publish jobs need both pack jobs (release.yml:133, :342), so no packages are pushed
   unless both SBOM gates passed. The SBOM itself is kept only as a workflow artifact (see
   Trade-offs).

2. **NuGet lock files are committed for reproducible restores.** `RestorePackagesWithLockFile` is set
   repo-wide (Directory.Build.props:20), so each project records its full resolved transitive graph in
   a committed `packages.lock.json` (for example Source/Core/MMCA.Common.Domain/packages.lock.json).
   Restore in CI and in the release pack jobs runs against that committed graph in locked mode
   (ci.yml:146, :219, release.yml:75, :298), so the versions CI vets and the release packs are the
   ones on record.

3. **CI fails on any non-suppressed vulnerable package.** The audit step calls the shared
   `nuget-vulnerability-audit` composite action in CI's `build-and-test-checks` job (ci.yml:221-231;
   skipped with the rest of the code steps on a docs-only change, ci.yml:222), and the release `pack`
   job runs the same action (release.yml:91-96) before Test (release.yml:98) and Pack
   (release.yml:103), as does `pack-maui` over its own project graph (release.yml:302-307) before
   its Build (release.yml:309-310) and Pack (release.yml:312-313), so an
   advisory published between the PR run and the tag also stops the push. The action runs `dotnet list <solution> package --vulnerable --include-transitive`
   (.github/actions/nuget-vulnerability-audit/action.yml:54) and fails the build (`exit 1`) on any
   vulnerable-package row (action.yml:86-92). Accepted advisories are the sole
   exception, and their single source of truth is the `NuGetAuditSuppress` list in
   `Directory.Build.props`. Because `dotnet list --vulnerable` ignores `NuGetAuditSuppress`, the action
   re-derives that accept-list itself by reading only the `Include` value of each
   `<NuGetAuditSuppress>` element in `Directory.Build.props`, so a `GHSA-*` id mentioned in a comment
   does not silence anything (action.yml:74-84). The action accepts the bare-id form or the
   advisory-URL form (action.yml:82); only the URL form, which NuGet restore honors, satisfies both
   gates (action.yml:76-77). Each entry goes in an ItemGroup in `Directory.Build.props`, in
   advisory-URL form, with its reachability argument in a comment, for the CI audit action to
   re-apply (Directory.Build.props:65-69). The list holds two entries today, GHSA-846f-f764-76mx and
   GHSA-2fmv-rv2c-59x7, both in advisory-URL form (Directory.Build.props:84-87). They are
   `System.Security.Cryptography.Pkcs` advisories that NuGet reports on `net11.0` against an unpruned
   transitive 9.0.18 that never loads, because the ASP.NET Core 11 shared framework supplies 11.0.0;
   the comment records them as a false positive rather than an accepted risk, with the removal
   condition (a Pkcs 11.0.1 that the `net11.0` framework version moves to) and the reason they are
   unconditional across target frameworks (Directory.Build.props:71-83). They arrived in 1.286.0
   (CHANGELOG.md:626). An empty list stays a handled case, not an error: the action reports `<none>`
   as the accepted set (action.yml:85), skips the filter (action.yml:87-89), and so fails on every
   vulnerable row (action.yml:90-91). The five `SixLabors.ImageSharp` 3.1.12 entries that preceded
   them were removed in 1.258.0 when image normalization stopped depending on ImageSharp
   (CHANGELOG.md:1035); see the 2026-10-25 Revision. The earlier SQLite advisory GHSA-2m69-gcr7-jv3q
   (CVE-2025-6965) was suppressed from 2026-06-19 while SQLitePCLRaw shipped no patched build, then
   replaced on 2026-07-20 by a direct `SQLitePCLRaw.bundle_e_sqlite3` pin. That pin is retired too:
   1.307.0 removed it, together with the MessagePack, SSH.NET and System.Formats.Cbor security pins,
   because upstream now floors a patched build (EF Core Sqlite floors SQLitePCLRaw 2.1.13, past the
   vulnerable range; CHANGELOG.md:219 under header :188), and no `.props`, `.csproj` or `.targets`
   file in MMCA.Common references SQLitePCLRaw today. This complements the build-time audit:
   `NuGetAudit` with `NuGetAuditMode=all` (Directory.Build.props:21-22)
   under repo-wide `TreatWarningsAsErrors` (Directory.Build.props:19) already promotes an advisory to a
   build failure, and the CI step adds a solution-wide, transitive check carrying an auditable
   accept-list.

4. **Package source mapping pins every dependency to an explicit feed.** `nuget.config` clears
   inherited sources and declares nuget.org only (nuget.config:9-12), then a `packageSourceMapping`
   block routes package pattern `*` to that source (nuget.config:13-17). This is the
   dependency-confusion and typosquat defense: a package from any other feed cannot be silently
   substituted (nuget.config:3-8). MMCA.Common needs only the single `* -> nuget.org` mapping because it
   publishes the `MMCA.*` packages rather than consuming them (nuget.config:6-7), so no GitHub Packages
   token is required to build or restore it.

## Rationale
- **Provenance is a gate, not a document.** A hard-failing SBOM step means the bill of materials
  cannot silently go missing on a release: the artifact is produced or the release stops
  (.github/actions/cyclonedx-sbom/action.yml:72-75, release.yml:121). That is the section 32 provenance criterion enforced, not merely asserted
  (ArchitectureEvaluationCriteria.md:852).
- **One accept-list, re-applied where the tool ignores it.** The audit keeps `Directory.Build.props`
  as the only place an advisory is accepted, and re-reads that file in CI precisely because
  `dotnet list --vulnerable` does not honor `NuGetAuditSuppress` (.github/actions/nuget-vulnerability-audit/action.yml:5). A `NuGetAuditSuppress`
  item is the sanctioned way to silence an advisory, whether an accepted risk or a false positive,
  paired with its reachability argument in an adjacent comment (Directory.Build.props:65-69), so a
  reviewer sees every silenced advisory in one place rather than a blanket suppression.
  Two suppressions are active today, both `net11.0` false positives whose adjacent comment states
  why and when to remove them (Directory.Build.props:71-87).
- **Build-gates-invariants, at the supply-chain layer.** SBOM, audit, and source mapping turn
  "remember to check the dependencies" into red builds, the same lever ADR-015 uses for the layer and
  event rules and ADR-016 uses for the MassTransit pin.
- **Reproducibility feeds the audit.** Committed lock files (Directory.Build.props:20) record the exact
  transitive graph the audit and SBOM run against, so the release ships the versions CI actually
  vetted.

## Trade-offs
- **The packages are attested; the SBOM is a workflow artifact, not attested.** Both publish jobs
  download the packages their pack job handed on (release.yml:147-151, :355-359) and attach a signed
  SLSA build-provenance attestation to every `.nupkg` through `actions/attest-build-provenance`
  (release.yml:156-159 in `publish`, :364-367 in `publish-maui`), but the attestation subject is the
  packages only (`subject-path` at release.yml:159, :367). The SBOM gate proves a bill of materials
  exists for each release (.github/actions/cyclonedx-sbom/action.yml:72-75) and hands its path to
  the job (action.yml:76); a separate Upload SBOM step in each pack job then stores it as a workflow
  artifact (release.yml:116-121 in `pack`, :324-329 in `pack-maui`). Neither upload
  sets `retention-days` and no step attaches the BOM to a release, so the SBOM lasts only as long as
  the repository's artifact retention keeps it, not as long as the packages it describes. The BOM
  file carries no attestation of its own, and nothing in the pipeline forces a consumer to run
  `gh attestation verify` before restoring a package.
- **Accept-list drift is possible.** A `NuGetAuditSuppress` entry silences the audit for that id until
  someone removes it, and its accompanying rationale comment is a review reminder, not an automated
  expiry. The two entries today (Directory.Build.props:84-87) carry a written removal condition, a
  Pkcs 11.0.1 (Directory.Build.props:78-79), but nothing checks it, so they stay until someone acts
  on it; the five ImageSharp entries that held the list until 1.258.0 left only because the package
  itself left the graph (CHANGELOG.md:1035), not because anything prompted a revisit.
- **Audit granularity is text-matched.** The audit action matches vulnerable rows and `GHSA-*` ids by
  parsing tool output (.github/actions/nuget-vulnerability-audit/action.yml:82-91). It is deliberately simple and depends on the `dotnet list`
  output shape rather than a structured feed.
- **Source mapping constrains where packages come from.** Restricting to nuget.org (nuget.config:15)
  is the point, but it means adding a dependency from any other feed is a deliberate `nuget.config`
  edit, not an ambient possibility.

## Revision (2026-09-07)
The provenance chain gained the controls that make it reproducible under an attacker, from the
2026-09-07 security review.

1. **Actions are pinned by commit SHA, not by a mutable tag** (SEC-Common-59). Every `uses:` in
   MMCA.Common's pipelines names a 40-character SHA with the tag as a trailing comment, in CI
   (`MMCA.Common/.github/workflows/ci.yml:51`, `:96`, `:245`) and in the release
   (`MMCA.Common/.github/workflows/release.yml:22`, `:44`, `:89`, and `NuGet/login` at `:109`). A tag
   is a movable pointer in someone else's repository; the SHA is what a supply-chain record can
   actually claim.
2. **Global tools are version-pinned** (SEC-Common-58 / SEC-ADC-35). `CycloneDX` is installed at
   `--version 6.2.0` in both release jobs (`release.yml:83`, `:186`) and `dotnet-coverage` at
   `--version 18.11.0` in CI (`ci.yml:172`, `:336`). The SBOM generator in particular ran unpinned
   inside the job that goes on to publish, which put an unreviewed binary upstream of the artifact
   the SBOM describes.
3. **The two gating restores run in locked mode** (SEC-Common-63 / SEC-ADC-34).
   `dotnet restore MMCA.Common.slnx --locked-mode` is an explicit step in exactly two jobs: CI's
   `build-and-test` (`ci.yml:120-129`, whose Build then runs `--no-restore` at `:133`) and the
   release's `publish` (`release.yml:57-62`, whose Build runs `--no-restore` at `:69` and whose Test
   and Pack then run `--no-build` at `:72` and `:75`). Those are the only two `--locked-mode`
   restores in either workflow: the identical sentence at
   `ci.yml:103`, `:217`, `:296`, `:395`, `:559`, `:714`, `:829` and at
   `release.yml:163` is a comment inside a `setup-dotnet` cache block explaining the cache key, not a
   restore command. Every other job that compiles restores implicitly, without the flag, from its
   build, run, test or pack command: `build-maui` (`ci.yml:263`), `ui-e2e` (`:309`),
   `performance-smoke` (`:410`), `consumer-source-build` (`:587`), `package-consumption` (`:725`),
   `redis-integration` (`:845`), `postgresql-integration` (`:880`), `apphost-testing` (`:939`), and
   the release's `publish-maui`, which has no restore step at all (`release.yml:178`). The FACTS
   drift gate inside `build-and-test` restores implicitly too (`ci.yml:118`), because `build/facts`
   sits outside `MMCA.Common.slnx` and carries no lock file. So the enforcement is deliberately
   placed rather than universal: it covers the graph that gets built, audited, SBOM'd, packed and
   pushed. The lock files were committed but never enforced anywhere, so a drifted graph silently
   re-resolved on that path rather than failing.
4. **The vulnerability gate fails closed** (SEC-Common-62). The audit step captures the tool's exit
   code and fails the job when `dotnet list --vulnerable` itself errors (`ci.yml:146-149`) instead of
   reading an empty log as a clean result, and it honors the same accepted-advisory list the build
   uses, sourced from `Directory.Build.props` (`:154-166`).
5. **The publish is gated** (SEC-Common-64). Both release jobs declare `environment: release`
   (`release.yml:16`, `:127`) and assert the tagged commit is on merged `main` before doing anything
   (`:34`, `:145`). A push to nuget.org is irreversible, so the one ref that is not reviewed through
   a pull request gets a check that it descends from one that was.
6. **Store watches its base images.** A `docker` ecosystem joins the GitHub Actions one in Store's
   Dependabot configuration (`MMCA.Store/.github/dependabot.yml:32`, beside `:15`), which is what
   keeps a digest-pinned base image (ADR-093) from becoming a pin to a stale layer.

## Revision (2026-09-22): attestations, and one implementation of each gate

Two of the trade-offs above have moved. First, every `.nupkg` a release packs now carries a signed
SLSA build-provenance attestation: `release.yml` calls `actions/attest-build-provenance` (SHA-pinned)
after `dotnet pack` in both publish jobs, with `attestations: write` added to their permissions, and a
consumer verifies a package with `gh attestation verify <file>.nupkg --owner ivanball`. MMCA.Common is
a public repository, so the attestation is also written to the public Sigstore transparency log. The
private MMCA.ADC container images are not attested by this revision.

Second, the vulnerability audit and the SBOM gate are composite actions in this repository,
`.github/actions/nuget-vulnerability-audit` and `.github/actions/cyclonedx-sbom`, consumed here by
local path (`ci.yml`, `release.yml`) and by `MMCA.ADC/.github/workflows/deploy.yml` as
`ivanball/MMCA.Common/.github/actions/...@main`. That retires the copy in ADC whose own comment said it
mirrored this repository's block. It is also the one place a first-party action is referenced by branch
rather than by commit SHA, and that is deliberate: `main` here is PR-protected, and a moving ref is what
makes a fix to the gate reach every consumer without a per-repository bump. The audit action accepts
both report headers the SDK has printed and fails closed on any other output, exactly as the inline
block did; the SBOM action fails on a zero-component bill of materials and normalises a `.slnf` itself.

## Revision (2026-10-01)
No decision or rationale changed; the current-state sections now describe the gates where they live
today. Context names both registries a tag publishes to: GitHub Packages (`release.yml:117-118`) and
nuget.org through OIDC trusted publishing (`release.yml:129-138`). Decision 1 describes the SBOM gate
as the `cyclonedx-sbom` composite action (`release.yml:104-108`), which fails on a missing or empty
file (`.github/actions/cyclonedx-sbom/action.yml:68`) or a zero-component BOM (`action.yml:69-71`)
rather than on an empty directory; the earlier `continue-on-error` history is no longer anchored in
the workflow. Decision 3 records that the release `publish` job re-runs the same audit action before
Test and Pack (`release.yml:75-82`) and that the accept-list reads only `<NuGetAuditSuppress>`
`Include` values (`.github/actions/nuget-vulnerability-audit/action.yml:74-83`). Two statements in the
2026-09-22 Revision are now incomplete and are corrected here rather than in place: MMCA.Store's
`deploy.yml` consumes both actions too (`MMCA.Store/.github/workflows/deploy.yml:580`, `:605`), and a
third Common action, `freshness-gate`, is also referenced `@main` by both consumers
(`MMCA.ADC/.github/workflows/deploy.yml:861`, `MMCA.Store/.github/workflows/deploy.yml:834`), so the
audit and SBOM pair is not the only first-party action referenced by branch. Refreshed citations:
`ArchitectureEvaluationCriteria.md` (section 32 at `:843-861`), `SECURITY.md:43-52`, the locked
restores (`ci.yml:132`, `release.yml:66`), the upload step (`release.yml:110-115`, `:226-231`) and
`MMCA.Common.Infrastructure.csproj:38-40`. Anchors inside the earlier Revision sections are left as
recorded.

## Revision (2026-10-06)
- The SQLite fix in Decision 3 now names the pin's current version, 3.0.5
  (`Directory.Packages.props:58`), and the second project that references it directly,
  `MMCA.Common.Aspire` (`MMCA.Common.Aspire.csproj:73`), beside `MMCA.Common.Infrastructure`
  (`MMCA.Common.Infrastructure.csproj:42`).
- The branch-referenced first-party actions number four, not three: `wasm-payload-budget` is also
  consumed `@main` (`MMCA.Store/.github/workflows/deploy.yml:510`, `MMCA.ADC/.github/workflows/deploy.yml:478`).
  Current consumer locations of the others: audit and SBOM at Store `deploy.yml:617`, `:642` and ADC
  `deploy.yml:647`, `:672`; `freshness-gate` at Store `deploy.yml:876`, `:901`, `:929`, `:968` and ADC
  `deploy.yml:908`, `:933`, `:962`, `:1014`.
- Facts recorded in the 2026-09-07 Revision still hold at moved anchors. Every `uses:` remains
  SHA-pinned (CI checkout `ci.yml:51`, setup-dotnet `:99`, cache `:223`; release checkout
  `release.yml:26`, `:159`, attest `:96`, `:213`, `NuGet/login` `:131`, `:245`). CycloneDX is no
  longer installed in `release.yml`: both release jobs call the `cyclonedx-sbom` action
  (`release.yml:105`, `:221`), whose `tool-version` input defaults to 6.2.0
  (`.github/actions/cyclonedx-sbom/action.yml:29`) and installs at `action.yml:51-52`;
  `dotnet-coverage --version 18.11.0` is at `ci.yml:150`, `:314`. The two locked restores are
  `ci.yml:132` (Build `--no-restore` at `:136`) and `release.yml:66`; the cache-key comments naming
  `--locked-mode` sit at `ci.yml:106`, `:195`, `:274`, `:373`, `:545`, `:713`, `:860` and
  `release.yml:55`, `:189`. The fail-closed audit logic lives in the composite action
  (`.github/actions/nuget-vulnerability-audit/action.yml:63-68`, header check `:69-73`,
  accept-list `:74-84`). The release jobs declare `environment: release` at `release.yml:19`, `:152`.
- Anchors in the live sections were re-verified against current source; SECURITY.md's supply-chain
  section moved to `SECURITY.md:44-53`.

## Revision (2026-10-07)
Re-verified against current source. No decision, gate or rationale changed: the SBOM gate, the two
locked-mode restores, the fail-closed audit in both CI and the release `publish` job, and nuget.org
source mapping all hold, and both consumers still reference the four first-party actions
(`nuget-vulnerability-audit`, `cyclonedx-sbom`, `freshness-gate`, `wasm-payload-budget`) `@main`.
One fact recorded in an earlier Revision moved, and the workflow anchors shifted.

1. **`dotnet-coverage` is installed once, not twice.** CI installs it pinned at `--version 18.11.0`
   in `build-and-test` only (`MMCA.Common/.github/workflows/ci.yml:152`); no other job in `ci.yml`
   installs it, so the second location recorded in the 2026-09-07 and 2026-10-06 Revisions no longer
   exists.
2. Anchors re-verified against current source:
   - `release.yml`: tag trigger `:5`; release audit step `:79-84` (comment from `:75`), before Test
     `:86` and Pack `:91`; attest `:98`, `:215`; SBOM gate comment `:102-105`, Generate SBOM
     `:106-110` (`uses` `:107`) and `:219-226` (`uses` `:223`) in `publish-maui`; Upload SBOM
     `:112-117` (`if-no-files-found: error` at `:117`) and `:228-233`; GitHub Packages push
     `:119-120`; nuget.org block `:122-140` (`NuGet/login` `:133`, `:247`; push `:140`); checkout
     `:26`, `:161`; `environment: release` `:19`, `:154`; locked restore `:66`; cache-key comments
     naming `--locked-mode` `:55`, `:191`.
   - `ci.yml`: checkout `:51`, setup-dotnet `:99`, `actions/cache` `:270`; locked restore `:132`,
     Build `--no-restore` `:136`; audit step `:138-148` (`uses` `:144`, docs-only guard `:139`);
     cache-key comments naming `--locked-mode` `:106`, `:197`, `:249`, `:328`, `:492`, `:660`,
     `:807`.
   - Consumers: `MMCA.Store/.github/workflows/deploy.yml` `wasm-payload-budget` `:511`, audit `:558`,
     SBOM `:572`, `freshness-gate` `:792`, `:811`, `:832`, `:864`;
     `MMCA.ADC/.github/workflows/deploy.yml` `wasm-payload-budget` `:481`, audit `:595`, SBOM `:610`,
     `freshness-gate` `:835`, `:854`, `:877`, `:917`.

## Revision (2026-10-21)
Re-verified against current source. The four controls, the single accept-list re-applied by the
audit action, and the four first-party actions referenced `@main` by both consumers are unchanged.
What moved is the content of the accept-list: it is no longer empty.

1. **Five ImageSharp advisories are accepted.** `MMCA.Common/Directory.Build.props:47-53` holds five
   active `NuGetAuditSuppress` entries in advisory-URL form (`:48-52`): GHSA-j9gm-c75j-xc9q,
   GHSA-jjfr-hcj7-qf5w, GHSA-wmxv-xphr-5c9g, GHSA-j3p4-wp97-rph4 and GHSA-gwg2-r3hj-4w44, all
   against `SixLabors.ImageSharp` 3.1.12 (`Directory.Packages.props:144`), published 2026-10-07 and
   patched only in 4.1.2, which the v3 license pin rules out. The rationale comment
   (`Directory.Build.props:33-46`) argues reachability per advisory and accepts GHSA-gwg2-r3hj-4w44
   as reachable in principle, a bounded denial-of-service risk. The audit action matches the
   advisory-URL form (`.github/actions/nuget-vulnerability-audit/action.yml:74-82`), so the entries
   are in force in CI and in the release `publish` job as well as in restore. Decision 3, Rationale
   and Trade-offs now say so in place of "the accept-list is empty".
2. Anchors re-verified against current source:
   - `MMCA.Common.Infrastructure.csproj`: security-pin comment `:43-44`, `SQLitePCLRaw.bundle_e_sqlite3`
     reference `:45`. `MMCA.Common.Aspire.csproj:69-73` and `Directory.Packages.props:58` (comment
     from `:54`) hold.
   - Consumers: `MMCA.Store/.github/workflows/deploy.yml` `wasm-payload-budget` `:512`, audit `:559`,
     SBOM `:573`, `freshness-gate` `:794`, `:813`, `:834`, `:866`;
     `MMCA.ADC/.github/workflows/deploy.yml` `wasm-payload-budget` `:495`, audit `:609`, SBOM `:624`,
     `freshness-gate` `:850`, `:869`, `:892`, `:932`.

## Revision (2026-10-25, accept-list empty again)
Re-verified against current source. The four controls, the single accept-list in
`Directory.Build.props`, and the audit action that re-applies it are unchanged. What moved is the
content of the list: it is empty again, and the five entries recorded in the 2026-10-21 Revision are
gone.

1. **The five ImageSharp entries are removed.** In 1.258.0 image normalization moved from
   `SixLabors.ImageSharp` to SkiaSharp, MMCA.Common.Infrastructure stopped depending on ImageSharp,
   and with the package out of the dependency graph the five accepted 3.1.12 advisories no longer
   apply, so their `NuGetAuditSuppress` entries were deleted (`MMCA.Common/CHANGELOG.md:23`). In
   1.259.0 image normalization left the framework entirely (`CHANGELOG.md:17`), so the list did not
   refill with a replacement package's advisories. `MMCA.Common/Directory.Build.props:33-36` now holds
   only a comment: no advisory is accepted today, and a future entry is a `NuGetAuditSuppress` item in
   advisory-URL form with its reachability argument in a comment, re-applied by the CI audit action.
2. **An empty list is handled, not special-cased.** The action prints `<none>` as the accepted set
   (`.github/actions/nuget-vulnerability-audit/action.yml:85`), applies no filter
   (`action.yml:87-89`), and fails on any vulnerable row (`action.yml:90-91`). Decision 3, Rationale
   and Trade-offs now describe the empty list in place of the five active entries.
3. **The consumer mirrors went in the same sweep.** Store, ADC and Helpdesk each deleted the ImageSharp
   suppress block they had mirrored from MMCA.Common, in their 2026-10-25 version-bump PRs (Store #227,
   ADC #293, Helpdesk #192). On each repository's `main`, `Directory.Build.props` holds no
   `NuGetAuditSuppress` item; Store's states the empty list in a comment
   (`MMCA.Store/Directory.Build.props:39-42`).
4. Anchors re-verified against current source: the audit action's report check `action.yml:71`,
   accept-list `:74-84` (both forms `:82`), vulnerable-row match `:86`; the SQLite pin
   `Directory.Packages.props:59` (comment `:54-58`), `MMCA.Common.Infrastructure.csproj:36-38` and
   `MMCA.Common.Aspire.csproj:54-58`.

## Revision (2026-10-26)
Re-verified against current source. The four controls, the empty accept-list, the SBOM gate in both
release jobs and the fail-closed audit are unchanged. What moved is the 1.261.0 CHANGELOG section,
which pushed the 1.258.0 and 1.259.0 entries down, plus one workflow anchor and the SECURITY.md
section; and one statement in the 2026-10-06 Revision needs a qualifier.

1. **"Every `uses:` remains SHA-pinned" covers third-party actions only.** The 2026-09-07 Revision
   records that every `uses:` in MMCA.Common's pipelines names a 40-character SHA, which held when it
   was written: the composite actions arrived with the 2026-09-22 change. The 2026-10-06 Revision
   restates it ("Every `uses:` remains SHA-pinned") after that change, so it was already too broad
   then. Every third-party action still names a SHA, but four `uses:` lines reference the repository's own composite actions by local path,
   which carries no SHA: `nuget-vulnerability-audit` at `MMCA.Common/.github/workflows/ci.yml:144`
   and `MMCA.Common/.github/workflows/release.yml:80`, and `cyclonedx-sbom` at `release.yml:107` and
   `:225`. That is the local-path consumption the 2026-09-22 Revision describes; the code reviewed is
   the same commit being built, so there is no external ref to pin.
2. Anchors re-verified against current source:
   - `MMCA.Common/CHANGELOG.md`: the 1.258.0 entry (SkiaSharp replaces ImageSharp, the
     `NuGetAuditSuppress` entries go) is `:55` under header `:51`; the 1.259.0 entry (image
     normalization leaves the framework) is `:49` under header `:45`. Decision 3 and Trade-offs now
     cite `:55`; the 2026-10-25 Revision's `:23` and `:17` are left as recorded.
   - `MMCA.Common/SECURITY.md`: "Dependency & supply-chain security" header `:48`, bullets `:50-57`
     (CycloneDX SBOM bullet `:56`), cited in Context and Related.
   - `release.yml`: `publish-maui` Generate SBOM `:221-228` (`uses` `:225`), Upload SBOM `:230-235`
     (`if-no-files-found: error` at `:235`), cited in Decision 1. The `publish` job anchors in
     Decision 1 (`:102-105`, `:106-110`, `:112-117`) and Context (`:119-120`, `:122-140`) and the locked restores
     (`ci.yml:132`, `release.yml:66`) hold.

## Revision (2026-10-28)
Re-verified against current source. The four controls, the empty accept-list, the SBOM gate, the
fail-closed audit and the four first-party actions both consumers reference `@main` are unchanged.
What moved is one live Trade-offs bullet that still described the pre-2026-09-22 state in the present
tense, plus the CHANGELOG and SQLitePCLRaw anchors.

1. **The first Trade-offs bullet describes attestation as it is.** It said the SBOM is "not yet
   signed or attested" and that the pipeline adds no cryptographic attestation, under an inline
   superseded marker. Both release jobs attest every packed nupkg with
   `actions/attest-build-provenance` (`MMCA.Common/.github/workflows/release.yml:94-100` in
   `publish`, `:213-219` in `publish-maui`), with `subject-path` naming the packages only (`:100`,
   `:219`). The bullet now says the packages are attested; the SBOM action only writes the BOM and
   its `bom-path` output (`.github/actions/cyclonedx-sbom/action.yml:68-72`), and a separate Upload
   SBOM step stores it as a workflow artifact (`release.yml:112-117` in `publish`, `:230-235` in
   `publish-maui`) with no `retention-days` and no release-asset step, so it expires under the
   repository's artifact retention and carries no attestation of its own; consumer-side
   verification is not enforced by the pipeline.
2. Anchors re-verified against current source:
   - `MMCA.Common/CHANGELOG.md`: the 1.258.0 entry (SkiaSharp replaces ImageSharp, the
     `NuGetAuditSuppress` entries go) is `:98` under header `:94`; the 1.259.0 entry (image
     normalization leaves the framework) is `:92` under header `:88`. Decision 3 and Trade-offs now
     cite `:98`; the 2026-10-25 and 2026-10-26 Revisions' anchors are left as recorded.
   - `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/MMCA.Common.Infrastructure.csproj`:
     security-pin comment `:40-41`, `SQLitePCLRaw.bundle_e_sqlite3` reference `:42`, cited in
     Decision 3 as `:40-42`.

## Revision (2026-11-23)
Re-verified against current source. The four controls are unchanged: a CycloneDX SBOM hard gate,
committed lock files restored in locked mode, a fail-closed audit that re-applies the single
`NuGetAuditSuppress` accept-list, and nuget.org-only source mapping. What moved is the content of the
accept-list, the retirement of the SQLitePCLRaw pin, the shape of the release workflow, the CI job
layout, and how the consumers reference the first-party actions.

1. **The accept-list holds two entries.** `MMCA.Common/Directory.Build.props:84-87` carries
   GHSA-846f-f764-76mx (`:85`) and GHSA-2fmv-rv2c-59x7 (`:86`) in advisory-URL form, both
   `System.Security.Cryptography.Pkcs` advisories that the comment at `:71-83` records as a `net11.0`
   false positive (the shared framework loads 11.0.0; restore audits an unpruned transitive 9.0.18)
   with a removal condition, a Pkcs 11.0.1. The general comment is at `:65-69`. They were added in
   1.286.0 (`MMCA.Common/CHANGELOG.md:626`). Decision 3, Rationale and Trade-offs now describe them in
   place of the empty list recorded by the 2026-10-25 Revision.
2. **The SQLitePCLRaw pin is retired.** 1.307.0 removed the `SQLitePCLRaw.bundle_e_sqlite3`,
   `MessagePack`, `SSH.NET` and `System.Formats.Cbor` security pins because upstream now floors a
   patched build; EF Core Sqlite floors SQLitePCLRaw 2.1.13, past the vulnerable range of
   GHSA-2m69-gcr7-jv3q (`CHANGELOG.md:219`, header `:188`). No `.props`, `.csproj` or `.targets` file
   in MMCA.Common references SQLitePCLRaw, MessagePack or ImageSharp, so the
   `MMCA.Common.Infrastructure.csproj`, `Directory.Packages.props` and other csproj anchors in the
   2026-10-01, 2026-10-06, 2026-10-21, 2026-10-25 and 2026-10-28 Revisions no longer resolve; they
   are left as recorded.
3. **The release gates run in pack jobs.** `release.yml` is split into `pack`, `publish`,
   `github-release`, `pack-maui` and `publish-maui` (comment `:10-19`). Each `pack*` job holds
   `contents: read` and runs the merged-main assertion (`:43-51`, `:257-266`), the locked restore,
   the audit, the build, the pack and the SBOM gate; only `pack` also runs the tests (`:98-101`),
   and `pack-maui` goes from Build (`:309-310`) straight to Pack (`:312-313`). Each `publish*` job declares
   `environment: release` (`:140`, `:348`), needs both pack jobs (`:133`, `:342`), checks out and
   restores nothing (`:135`, `:161-162`), and attests the downloaded packages (`:147-151` then
   `:156-159`; `:355-359` then `:364-367`) before pushing them. So the 2026-09-07 item 5 ("both
   release jobs" assert merged `main`) and the 2026-09-22 statement that attestation runs "after
   `dotnet pack` in both publish jobs" describe an earlier layout.
4. **Four explicit locked restores, not two.** `dotnet restore ... --locked-mode` runs in CI
   `build-and-test-tfm` (`ci.yml:146`), CI `build-and-test-checks` (`ci.yml:219`), release `pack`
   (`release.yml:75`) and release `pack-maui` (`release.yml:298`, project-scoped, followed by its own
   audit at `:302-307`). This supersedes the "exactly two jobs" scope in the 2026-09-19 Status sentence
   and the 2026-09-07 item 3, including the statement that `publish-maui` has no restore step: the
   MAUI restore now lives in `pack-maui`, and neither publish job restores. The other `--locked-mode`
   mentions in `ci.yml` are comments. Outside those two workflows, `load-tests.yml` restores the load
   project in locked mode as well (`MMCA.Common/.github/workflows/load-tests.yml:56`), so four is the
   count for the CI and release workflows, not the repository.
5. **CI `build-and-test` is an aggregate gate.** The required context (`ci.yml:236-237`, comment
   `:233-235`) needs `build-and-test-tfm`, a `net10.0`/`net11.0` matrix (`:100-110`), and
   `build-and-test-checks` (`:188`), which hosts the audit (`:221-231`, code guard `:222`).
6. **`dotnet-coverage` has six pinned installs.** `--version 18.11.0` is installed at `ci.yml:154`
   (`build-and-test-tfm`, once per matrix leg) and at `:1062`, `:1122`, `:1182`, `:1242` and `:1309`
   (the integration tiers), so the 2026-10-07 item 1 ("in `build-and-test` only") no longer holds.
7. **Consumers pin the first-party actions by commit SHA.** Both `deploy.yml` files reference the
   Common actions at `@e991c4707cacc90ab01217730eed5ec0960cac4c # v1.313.0`, not `@main`, and a fifth
   action, `coverage-ratchet`, joins the four. ADC (`MMCA.ADC/.github/workflows/deploy.yml`):
   `wasm-payload-budget` `:642`, audit `:798`, SBOM `:815`, `coverage-ratchet` `:1147`, `:1157`,
   `freshness-gate` `:1247`, `:1266`, `:1289`, `:1329`. Store
   (`MMCA.Store/.github/workflows/deploy.yml`): `:541`, `:635`, `:649`, `:912`, `:922`, `:1009`,
   `:1028`, `:1049`, `:1081`. Store states the policy at `deploy.yml:9-12`: a change merged to Common
   `main` reaches the pipeline only through a PR that the github-actions Dependabot group opens when
   Common tags a release. This reverses the 2026-09-22 rationale that a moving `@main` ref is the
   deliberate way a gate fix reaches every consumer; the 2026-10-01 through 2026-10-28 Revisions'
   `@main` statements describe that earlier state.
8. **Six local-path `uses:` lines.** The repository's own composite actions are referenced by local
   path at `ci.yml:227` (audit), `ci.yml:655` (`coverage-ratchet`), `release.yml:92` and `:303`
   (audit), and `release.yml:111` and `:319` (SBOM), not the four the 2026-10-26 item 1 lists.
   Every third-party `uses:` still names a 40-character SHA (for example `release.yml:30`, `:117`,
   `:157`, `:181`).
9. **The CycloneDX default is 6.2.1.** The `tool-version` input defaults to 6.2.1
   (`.github/actions/cyclonedx-sbom/action.yml:33`), because 6.2.0 crashes on two versions of one
   package in the merged graph, which the per-framework EF Core and Npgsql lines produce
   (`action.yml:27-30`).
10. Anchors re-verified against current source:
    - `release.yml`: tag trigger `:3-5`; `pack` locked restore `:75`, audit `:91-96` (`uses` `:92`),
      Test `:98`, Pack `:103`, SBOM gate comment `:106-109`, Generate SBOM `:110-114` (`uses` `:111`),
      Upload SBOM `:116-121` (`if-no-files-found: error` `:121`); `publish` GitHub Packages push
      `:167-168`, OIDC comment `:170-178`, `NuGet/login` `:179-184`, nuget.org push `:186-188`;
      `pack-maui` Generate SBOM `:315-322`, Upload SBOM `:324-329`; `publish-maui` pushes `:375-376`,
      `:382-387`, `:389-391`.
    - `.github/actions/cyclonedx-sbom/action.yml`: install `:55-56`, CycloneDX invocation `:70`,
      `test -s` `:72`, zero-component check `:73-75`, `bom-path` `:76`.
    - `.github/actions/nuget-vulnerability-audit/action.yml`: `dotnet list --vulnerable` `:54`,
      accept-list `:74-84` (both forms `:82`), `<none>` `:85`, failure on a vulnerable row `:91`.
    - `Directory.Build.props`: `TreatWarningsAsErrors` `:19`, `RestorePackagesWithLockFile` `:20`,
      `NuGetAudit` `:21`, `NuGetAuditMode` `:22`.
    - `CHANGELOG.md`: the 1.258.0 entry is `:1035` under header `:1031`; the 1.259.0 entry is
      `:1029` under header `:1025`. Decision 3 and Trade-offs now cite `:1035`.

## Related
ADR-016 (lockstep versioning + the MassTransit-v8 license pin; this record extends dependency
governance from versioning and licensing into supply-chain provenance and integrity), ADR-015
(architecture invariants enforced as build-gating fitness functions; the same gate-the-build posture
applied here to dependencies), ADR-010 (integration-event schema versioning; another release-discipline
control that turns a contract into an enforced signal). See SECURITY.md ("Dependency & supply-chain
security", SECURITY.md:48-57) for the consumer-facing summary and rubric section 32
(ArchitectureEvaluationCriteria.md:843-861) for the evaluation criteria.
