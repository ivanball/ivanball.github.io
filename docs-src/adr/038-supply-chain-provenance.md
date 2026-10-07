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
## Context
MMCA.Common is a published framework: on every `v*` tag (release.yml:3-5) it packs its NuGet packages
and pushes them to both GitHub Packages (release.yml:119-120) and nuget.org through OIDC trusted
publishing (release.yml:122-140), where the two production apps and the reference seed consume
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
(SECURITY.md:44-53). No ADR owned them as a single coherent posture. This record does, and it exceeds
ADR-016's scope: ADR-016 gestures at lock files as sweep mechanics, this ADR owns supply-chain
integrity as the decision.

## Decision
Treat supply-chain integrity as a set of build-gating controls, the same invariant-over-discipline
posture ADR-015 applies to architecture rules. Four controls, each a hard gate:

1. **A CycloneDX SBOM is a hard release gate.** The release workflow calls the shared
   `cyclonedx-sbom` composite action with output directory `./sbom` (release.yml:106-110), which
   installs the CycloneDX tool (.github/actions/cyclonedx-sbom/action.yml:51-52) and generates a JSON
   software bill of materials for the whole solution (action.yml:66). It then fails the release
   (`exit 1`) when the BOM file is missing or empty (`test -s "$bom"`, action.yml:68) or lists zero
   components (action.yml:69-71), and the upload step sets `if-no-files-found: error`
   (release.yml:112-117, and release.yml:228-233 in `publish-maui`). The step runs as a blocking gate
   (release.yml:102-105), so every published version ships a verifiable SBOM or no packages are pushed.

2. **NuGet lock files are committed for reproducible restores.** `RestorePackagesWithLockFile` is set
   repo-wide (Directory.Build.props:8), so each project records its full resolved transitive graph in a
   committed `packages.lock.json` (for example Source/Core/MMCA.Common.Domain/packages.lock.json).
   Restore in CI and in release runs against that committed graph (ci.yml:132, release.yml:66), so
   the versions CI vets and the release packs are the ones on record.

3. **CI fails on any non-suppressed vulnerable package.** The audit step calls the shared
   `nuget-vulnerability-audit` composite action (ci.yml:138-148; skipped with the rest of the code jobs
   on a docs-only change, ci.yml:139), and the release `publish` job runs the same action before Test
   and Pack (release.yml:75-84), so an advisory published between the PR run and the tag also stops the
   push. The action runs `dotnet list <solution> package --vulnerable --include-transitive`
   (.github/actions/nuget-vulnerability-audit/action.yml:54) and fails the build (`exit 1`) on any
   vulnerable-package row (action.yml:85-91). Accepted advisories are the sole
   exception, and their single source of truth is the `NuGetAuditSuppress` list in
   `Directory.Build.props`. Because `dotnet list --vulnerable` ignores `NuGetAuditSuppress`, the action
   re-derives that accept-list itself by reading only the `Include` value of each
   `<NuGetAuditSuppress>` element in `Directory.Build.props`, so a `GHSA-*` id mentioned in a comment
   does not silence anything (action.yml:74-83). The accepted-advisory list is currently empty: the one prior entry, the SQLite
   advisory GHSA-2m69-gcr7-jv3q (CVE-2025-6965), was suppressed from 2026-06-19 while SQLitePCLRaw
   shipped no patched build. SQLitePCLRaw 2.1.12 (published 2026-07-14) delivered the patched build, so
   the suppression was removed on 2026-07-20 and replaced with a direct fix: a
   `SQLitePCLRaw.bundle_e_sqlite3` pin tracked in `Directory.Packages.props`, currently at version 3.0.5
   (Directory.Packages.props:58, rationale comment :54-57), referenced directly by
   `MMCA.Common.Infrastructure` (MMCA.Common.Infrastructure.csproj:40-42) and by `MMCA.Common.Aspire`
   (MMCA.Common.Aspire.csproj:69-73, for the copy `AspNetCore.HealthChecks.Sqlite` pulls in) so the
   patched version flows to consumers through the published package graph, the same pattern used for
   the MessagePack pin. This complements the build-time audit: `NuGetAudit` with `NuGetAuditMode=all`
   (Directory.Build.props:9-10)
   under repo-wide `TreatWarningsAsErrors` (Directory.Build.props:7) already promotes an advisory to a
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
  (.github/actions/cyclonedx-sbom/action.yml:68-71, release.yml:117). That is the section 32 provenance criterion enforced, not merely asserted
  (ArchitectureEvaluationCriteria.md:852).
- **One accept-list, re-applied where the tool ignores it.** The audit keeps `Directory.Build.props`
  as the only place an advisory is accepted, and re-reads that file in CI precisely because
  `dotnet list --vulnerable` does not honor `NuGetAuditSuppress` (.github/actions/nuget-vulnerability-audit/action.yml:74-78). A `NuGetAuditSuppress`
  item is the sanctioned way to accept an advisory, paired with a dated rationale in an adjacent
  comment, so a reviewer sees every accepted advisory in one place rather than a blanket suppression.
  No suppressions are active today: the accept-list is empty after the 2026-07-20/21 SQLite fix.
- **Build-gates-invariants, at the supply-chain layer.** SBOM, audit, and source mapping turn
  "remember to check the dependencies" into red builds, the same lever ADR-015 uses for the layer and
  event rules and ADR-016 uses for the MassTransit pin.
- **Reproducibility feeds the audit.** Committed lock files (Directory.Build.props:8) record the exact
  transitive graph the audit and SBOM run against, so the release ships the versions CI actually
  vetted.

## Trade-offs
- **The SBOM is generated and archived, not yet signed or attested** (superseded 2026-09-22; see the Revision below). The gate proves a bill of
  materials exists for each release (.github/actions/cyclonedx-sbom/action.yml:68-71); it does not add cryptographic attestation or
  signature verification of the pushed packages. That is a possible follow-up, not a claim made here.
- **Accept-list drift is possible.** A `NuGetAuditSuppress` entry silences the audit for that id until
  someone removes it, and its accompanying rationale comment is a review reminder, not an automated
  expiry. No entries are active today, but the mechanism carries this cost whenever an advisory is
  accepted.
- **Audit granularity is text-matched.** The audit action matches vulnerable rows and `GHSA-*` ids by
  parsing tool output (.github/actions/nuget-vulnerability-audit/action.yml:85-91). It is deliberately simple and depends on the `dotnet list`
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

## Related
ADR-016 (lockstep versioning + the MassTransit-v8 license pin; this record extends dependency
governance from versioning and licensing into supply-chain provenance and integrity), ADR-015
(architecture invariants enforced as build-gating fitness functions; the same gate-the-build posture
applied here to dependencies), ADR-010 (integration-event schema versioning; another release-discipline
control that turns a contract into an enforced signal). See SECURITY.md ("Dependency & supply-chain
security", SECURITY.md:44-53) for the consumer-facing summary and rubric section 32
(ArchitectureEvaluationCriteria.md:843-861) for the evaluation criteria.
