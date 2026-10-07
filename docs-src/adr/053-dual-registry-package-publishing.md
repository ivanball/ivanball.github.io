# ADR-053: Dual-Registry Package Publishing (nuget.org plus GitHub Packages)

## Status
Accepted (2026-07-25). Amended (2026-07-25) to put the pre-decision Context statements in the past
tense, to record the `MMCA.` ID prefix reservation as then-pending, to scope the
"documented install path" claim to what is actually updated, and to split the packaging metadata
between `Directory.Build.props` and the per-package csproj files. Amended (2026-07-28): that
reservation has been granted, so the Decision now records it as done rather than pending. See also
[ADR-101](101-common-metapackage.md) (2026-08-29, v1.170.0): the `MMCA.Common` metapackage joins the
set published to both registries from the same tag, with no workflow change; it shortens the install
line this record made credential-free from six references to one. Revised (2026-08-31): the
per-package counts this record used to spell out are replaced by a pointer to
`MMCA.Common/FACTS.md:19-43` (generated and CI-gated, so it cannot drift), and the fork behavior is
corrected to what `release.yml` actually does. Revised (2026-09-01): the two build comments this
record used to quote no longer carry a package count of their own (`release.yml:140-143`,
`Directory.Build.props:68`), so that note is dropped and `MMCA.Common/FACTS.md:19-43` is the single
place the published set is enumerated; the `release.yml` line anchors are re-pinned to the current
file. Revised (2026-09-19): `release.yml` has since gained a deployment-environment gate, a
merged-main ancestry assertion and a locked-mode restore, and the Trade-offs section now enumerates
the added gates. Revised (2026-10-01): every `release.yml` line number quoted below is re-pinned to
the current file (see Revision below). Revised (2026-10-07): anchors re-pinned to the current
`release.yml` and `ci.yml`, the Decision names the SHA-pinned `NuGet/login` action, and the Trade-offs record
that the two publishing jobs run independently, so a release can land half-published.

## Context
The `MMCA.Common.*` packages have shipped to GitHub Packages since the first release (the package
list and its count are generated and CI-gated in `MMCA.Common/FACTS.md:19-43`, so this record links
to them rather than restating them). That was the right default while the framework had exactly one consumer group (this account's own
repositories), which already authenticate to GitHub for other reasons.

It stopped being right the moment the framework was documented publicly. GitHub Packages' **NuGet**
registry requires a personal access token with `read:packages` for a restore, **even when the
package and its repository are public**: only the Container registry supports anonymous pulls. The
practical consequences:

- The `dotnet add package MMCA.Common.API` line printed in the README, in the getting-started guide,
  and in a two-dozen-article series failed for every reader who ran it. They got a 401, not a
  package.
- A reader who wants to try the framework must first create a GitHub PAT and hand-write a
  `nuget.config` with credentials. That is a larger ask than the framework itself, and it happens
  before they have seen any value.
- The packages were invisible to discovery. A nuget.org search API query for `MMCA.Common` returned
  `totalHits: 0`, so the primary place .NET developers look for libraries had never heard of them.
- There is no download signal. Package downloads are the only honest adoption metric available for a
  library, and GitHub Packages does not surface one publicly.

Consumers inside this workspace (MMCA.ADC, MMCA.Store, MMCA.Helpdesk) are unaffected by any of this:
they already restore successfully, and their `local.props` source mode bypasses packages entirely.
So this is purely about people outside the account.

## Decision
Every release publishes to **both** registries, from the same tag, in the same workflow run (two
independent jobs, see Trade-offs).

- `release.yml` keeps its existing `dotnet nuget push` to `https://nuget.pkg.github.com/ivanball/index.json`
  unchanged (`release.yml:120`, `:239`), and gains a second push to `https://api.nuget.org/v3/index.json`
  with `--skip-duplicate` (`release.yml:140`, `:255`). Both the main (ubuntu) job and the MAUI (windows)
  job push to both registries, so when both jobs succeed (see Trade-offs) the lockstep release
  stays whole across every published id: the
  packable projects in `MMCA.Common.slnx` (`MMCA.Common.slnx:8-34`) ship from the ubuntu job, and
  `MMCA.Common.UI.Maui` ships from the windows job (ADR-042 splits the MAUI package into its own
  job). `MMCA.Common/FACTS.md:19-43` is the source of truth for that set, and the workflow comment
  that introduces the MAUI job points at it rather than restating a count (`release.yml:142-145`).
- **Authentication to nuget.org is trusted publishing, not a stored API key.** Each publishing job
  requests a GitHub OIDC token (`permissions: id-token: write`) and exchanges it through
  `NuGet/login`, pinned by commit SHA with a `# v1` comment (`release.yml:133`, `:247`), for an API
  key valid for one hour, immediately before the push. No long-lived credential exists in the
  repository. nuget.org itself now marks API keys "Not recommended" and
  redirects its own API-keys page to trusted publishing.
- The exchange is authorized by a **policy on nuget.org pinned to the permanent GitHub ids** of the
  owner (`ivanball`, #9340301), the repository (`MMCA.Common`, #1190658420), and **this workflow
  file**. Those ids are what defeat a resurrection attack: deleting the repo and recreating it under
  the same name produces different ids, and the policy stops matching.
- **One policy covers both jobs**, because it keys on the workflow file rather than the job. Each
  job still needs its own `id-token: write` permission and its own exchange: a short-lived key is
  single-use and cannot cross a job boundary.
- The nuget.org steps are guarded by `github.repository_owner == 'ivanball'` (`release.yml:132`,
  `:139`, `:246`, `:253`), so a fork skips the trusted-publishing exchange it can never satisfy
  instead of failing on it. The guard covers the nuget.org steps only. The GitHub Packages push
  target is hardcoded to the `ivanball` namespace (`release.yml:120`, `:239`), which a fork's own
  `GITHUB_TOKEN` has no write scope for, so a fork's run reaches that push and fails there. Releasing
  from a fork is therefore not a path this workflow supports on either registry.
- **The `MMCA.` ID prefix reservation has been granted** (2026-07-28), so the ids are protected from
  being taken by anyone else: every published `MMCA.Common.*` id reports `verified: true` in the
  nuget.org search index, where it reported `verified: false` while the request was pending.
  Reservation is a manual account-level action (see Trade-offs), which is why it could never be
  closed out from this repository. API keys remain available for a manual push from a command line,
  which trusted publishing does not cover, but no automated path uses one.
- **nuget.org is the documented install path.** The README already installs with a plain
  `dotnet add package` and carries the nuget.org badges, and the getting-started guide is moved onto
  the same path in this change. GitHub Packages is retained as a mirror, not deprecated: it is where
  prerelease and internal-consumer restores keep working with no change.
- Package listing metadata is treated as part of the deliverable, not an afterthought:
  `PackageProjectUrl`, `PackageIcon`, and `PackageTags` are set once in `Directory.Build.props`,
  which also packs the icon and sets `PackageReadmeFile`. Each package's `Description` and its
  `README.md` pack item stay in the individual csproj, so every package carries its own one-line
  pitch above the shared repository README, and the listing page is the funnel.
- **No backfill.** nuget.org starts at the first release published after this decision. Older
  versions remain available on GitHub Packages only.

## Rationale
- **The install line has to be true.** Documentation that cannot be followed is worse than no
  documentation, because the reader concludes the project is broken rather than that the registry is
  unusual. Every other adoption improvement is downstream of this one.
- **Publishing to both costs one workflow step.** There is no maintenance split: within each job the
  nupkgs from that job's one pack step (`release.yml:92`, `:209`) go to both feeds, so the
  registries receive identical content whenever both pushes succeed. Each job pushes to GitHub
  Packages (`release.yml:120`, `:239`) before the nuget.org login and push (`release.yml:131-140`,
  `:245-255`), so a failed nuget.org step leaves GitHub Packages ahead until the release is re-run.
- **A credential that cannot be stored cannot be leaked.** A stored key would also have carried a
  365-day maximum lifetime, and expiry is the failure mode a presence check cannot catch: the secret
  is still there, so the step still runs, and the release fails at the push. Trusted publishing
  removes the rotation obligation rather than scheduling it.
- **The owner guard beats a secret-presence guard.** It states the actual condition (this is the
  canonical repository) instead of inferring it from configuration, and it keeps the exchange from
  running anywhere the policy could not authorize it.
- **nuget.org is irreversible per version, so the conservative scope is right.** `--skip-duplicate`
  keeps a re-run idempotent, and starting clean avoids publishing a long tail of old versions that
  nobody asked for and that can never be deleted (only unlisted).
- **Reserving the ID prefix is cheap insurance.** Package ids on nuget.org are first-come; an
  unreserved `MMCA.` namespace is a supply-chain risk (ADR-038 covers provenance for the artifacts
  themselves).

## Trade-offs
- **A published version can never be withdrawn.** nuget.org allows unlisting, not deletion. A bad
  release is now permanent public history, which raises the stakes on the release gates. Inside
  `release.yml`, both publishing jobs declare `environment: release` (`release.yml:19`, `:154`), so
  each waits on that environment's protection rules, which are configured in repository settings
  and are therefore not reviewable from this repository; both jobs refuse to publish unless the
  tagged commit is an ancestor of `origin/main` (`release.yml:38-46`, `:173-182`), because a `v*` tag
  is the one ref pushed outside the branch-protection flow; and both run the SBOM hard gate
  (`release.yml:106-110`, `:219-226`). The ubuntu job adds three more: it restores `--locked-mode`
  (`release.yml:66`), so its irreversible push cannot carry a transitive version nobody reviewed; it
  runs a fail-closed vulnerability audit (`release.yml:79-84`); and it enforces a test floor of
  `--minimum-expected-tests 2000` (`release.yml:86-89`). The MAUI job has none of those three: it has
  no restore step of its own, and its build restores implicitly without `--locked-mode`
  (`release.yml:205-206`). Both jobs also attest build provenance (`release.yml:97-100`, `:214-217`).
  The rest run on the merged pull request rather than on the tag, and the ancestry assertion is what
  makes them cover the tagged tree: its comment names the FACTS drift gate, the vulnerability audit,
  the Helpdesk consumer canary (`ci.yml:422-423`), the package-consumption canary (`ci.yml:640`),
  ui-e2e and the perf gate (`release.yml:31-35`).
- **The two publishing jobs are independent, so a release can land half-published.** `publish`
  (`release.yml:11`) and `publish-maui` (`release.yml:146`) declare no `needs:` on each other, so
  they run in parallel and a failure in one does not stop the other's pushes. The lockstep release
  is whole only when both jobs succeed; the MAUI job's timeout comment (`release.yml:148-150`)
  names the half-published outcome as the reason its timeout stays at 40 minutes.
- **Two registries can report different availability.** nuget.org indexing lags a push by minutes,
  so immediately after a release the two feeds disagree briefly. Consumers pinned to exact versions
  are unaffected; anyone restoring the newest version within that window may not see it yet.
- **Public download counts cut both ways.** A visible number that stays near zero is a discouraging
  signal. Accepted deliberately: an honest adoption metric is worth more than no metric, and it is
  the input to the whole distribution effort.
- **The workflow file name is now load-bearing.** The trusted-publishing policy names
  `release.yml`, so renaming or splitting that file silently breaks publishing until the policy is
  edited on nuget.org. That is the price of binding the credential to a specific workflow, and it is
  the same property that makes the credential safe.
- **Publishing configuration now lives in two places**, the workflow and an account-level policy
  that no reviewer can see in a pull request. A stored secret had the same split; this trades an
  invisible secret for an invisible policy, and gains a policy that cannot be exfiltrated.
- **The policy is scoped to an owner, not to a package glob.** It authorizes publishing for every
  package owned by `ivanball`, which is broader than a glob-limited key would have been. Acceptable
  because the counterweight is far tighter: this policy's exchange only happens from one
  repository's one workflow file. It is not the account's only exchange: MMCA.Helpdesk's
  `release-templates.yml:61-70` runs a second one as `ivanball` to publish `MMCA.Templates`, through
  the unpinned tag `NuGet/login@v1` (`release-templates.yml:63`). If its policy is owner-scoped too,
  it can also authorize pushes of the `MMCA.Common.*` ids; the policies themselves live on nuget.org
  and are not determinable from source.
- **Prefix reservation is a manual, account-level action** that cannot be expressed in this
  repository, so that half of the decision is not enforceable by code review.

## Revision (2026-10-01)
No decision changed; the record is re-pinned to `release.yml` as of MMCA.Common v1.216.0 and two
statements are corrected. Re-pinned: the GitHub Packages pushes (`release.yml:118`, `:237`), the
nuget.org pushes (`:138`, `:253`), the owner guards (`:130`, `:137`, `:244`, `:251`), the MAUI job
comment (`:140-143`), the environment declarations (`:19`, `:152`), the ancestry assertions
(`:38-46`, `:171-180`), the locked-mode restore (`:66`), the SBOM gates (`:104-108`, `:217-224`),
`MMCA.Common.slnx:8-34`, `MMCA.Common/FACTS.md:19-43`, and the CI jobs (`ci.yml:475`, `:693`).
Corrected: the gate list is no longer "six, four inside `release.yml`", because the ubuntu job also
runs a fail-closed vulnerability audit (`release.yml:79-82`) and a test floor (`:84-87`), and the
locked-mode restore and the audit cover the ubuntu job only (the MAUI build restores implicitly,
`release.yml:203-204`), so the ADR-038 cross-reference no longer claims all three run before either
push. The owner-scope trade-off now notes the second trusted-publishing exchange in MMCA.Helpdesk
(`release-templates.yml:61-70`).

## Revision (2026-10-07)
Re-verified against current source. The decision is unchanged: both jobs still push to GitHub
Packages and to nuget.org with `--skip-duplicate`, behind owner guards that cover only the nuget.org
login and push steps. What moved is line numbers in two files: in `release.yml`, two lines added to the audit step
at `release.yml:83-84` shift every later anchor by +2; in `ci.yml`, the two CI canaries moved from
`ci.yml:475` and `:693` to `ci.yml:422-423` and `:640` (-53). Three statements of detail changed.

1. The Decision now names the trusted-publishing action as Common actually uses it: `NuGet/login`
   pinned by commit SHA with a `# v1` comment (`release.yml:133`, `:247`), which matches the
   Trade-offs contrast with MMCA.Helpdesk's unpinned `NuGet/login@v1`
   (`release-templates.yml:63`).
2. The Trade-offs gain the job-independence entry: `publish` (`release.yml:11`) and `publish-maui`
   (`release.yml:146`) declare no `needs:`, so a failure in one job does not stop the other's
   pushes and the lockstep release stays whole only when both succeed (`release.yml:148-150`).
3. Anchors re-verified against current source: the GitHub Packages pushes (`release.yml:120`,
   `:239`), the nuget.org pushes (`:140`, `:255`), the owner guards (`:132`, `:139`, `:246`,
   `:253`), the MAUI job comment (`:142-145`), the environment declarations (`:19`, `:154`), the
   ancestry assertions (`:38-46`, `:173-182`), the vulnerability audit (`:79-84`), the test floor
   (`:86-89`), the provenance attestations (`:97-100`, `:214-217`), the SBOM gates (`:106-110`,
   `:219-226`), the MAUI build (`:205-206`), and the CI jobs (`ci.yml:422-423`, `:640`). The
   locked-mode restore (`release.yml:66`) and the ancestry comment (`release.yml:31-35`) are
   unchanged.
4. The Rationale no longer says one pack step feeds both registries: each job has its own pack step
   (`release.yml:92`, `:209`) and pushes to GitHub Packages (`:120`, `:239`) before the guarded
   nuget.org login and push (`:131-140`, `:245-255`), so a failed nuget.org step leaves the two
   registries with different content until the release is re-run.

## Related
ADR-016 (lockstep versioning: every package ships at one version, so both registries receive the
same set of ids per release, enumerated in `MMCA.Common/FACTS.md:19-43`),
ADR-038 (supply-chain provenance: the SBOM hard gate runs before both jobs' pushes, while the
locked-mode restore and the vulnerability audit run in the ubuntu job only; keyless publishing extends that posture to the credential itself),
ADR-042 (the MAUI package's separate windows job, which needs the same dual push to keep the
release whole).
