# ADR-053: Dual-Registry Package Publishing (nuget.org plus GitHub Packages)

## Status
Accepted (2026-07-25).

## Context
The fifteen `MMCA.Common.*` packages have shipped to GitHub Packages since the first release. That
was the right default while the framework had exactly one consumer group (this account's own
repositories), which already authenticate to GitHub for other reasons.

It stopped being right the moment the framework was documented publicly. GitHub Packages' **NuGet**
registry requires a personal access token with `read:packages` for a restore, **even when the
package and its repository are public**: only the Container registry supports anonymous pulls. The
practical consequences:

- The `dotnet add package MMCA.Common.API` line printed in the README, in the getting-started guide,
  and in a two-dozen-article series fails for every reader who runs it. They get a 401, not a
  package.
- A reader who wants to try the framework must first create a GitHub PAT and hand-write a
  `nuget.config` with credentials. That is a larger ask than the framework itself, and it happens
  before they have seen any value.
- The packages are invisible to discovery. A nuget.org search API query for `MMCA.Common` returns
  `totalHits: 0`, so the primary place .NET developers look for libraries has never heard of them.
- There is no download signal. Package downloads are the only honest adoption metric available for a
  library, and GitHub Packages does not surface one publicly.

Consumers inside this workspace (MMCA.ADC, MMCA.Store, MMCA.Helpdesk) are unaffected by any of this:
they already restore successfully, and their `local.props` source mode bypasses packages entirely.
So this is purely about people outside the account.

## Decision
Every release publishes to **both** registries, from the same tag, in the same workflow run.

- `release.yml` keeps its existing `dotnet nuget push` to `https://nuget.pkg.github.com/ivanball/index.json`
  unchanged, and gains a second push to `https://api.nuget.org/v3/index.json` with
  `--skip-duplicate`. Both the main (ubuntu) job and the MAUI (windows) job push to both registries,
  so the lockstep release stays whole across all fifteen packages (ADR-042 splits the MAUI package
  into its own job).
- **Authentication to nuget.org is trusted publishing, not a stored API key.** Each publishing job
  requests a GitHub OIDC token (`permissions: id-token: write`) and exchanges it through
  `NuGet/login@v1` for an API key valid for one hour, immediately before the push. No long-lived
  credential exists in the repository. nuget.org itself now marks API keys "Not recommended" and
  redirects its own API-keys page to trusted publishing.
- The exchange is authorized by a **policy on nuget.org pinned to the permanent GitHub ids** of the
  owner (`ivanball`, #9340301), the repository (`MMCA.Common`, #1190658420), and **this workflow
  file**. Those ids are what defeat a resurrection attack: deleting the repo and recreating it under
  the same name produces different ids, and the policy stops matching.
- **One policy covers both jobs**, because it keys on the workflow file rather than the job. Each
  job still needs its own `id-token: write` permission and its own exchange: a short-lived key is
  single-use and cannot cross a job boundary.
- The nuget.org steps are guarded by `github.repository_owner == 'ivanball'`, so a fork completes a
  full GitHub Packages release instead of failing on an exchange it can never satisfy.
- The `MMCA.` ID prefix is reserved on nuget.org so the package ids cannot be taken by anyone else.
  API keys remain available for a manual push from a command line, which trusted publishing does
  not cover, but no automated path uses one.
- **nuget.org is the documented install path.** README, guides, and articles point there. GitHub
  Packages is retained as a mirror, not deprecated: it is where prerelease and internal-consumer
  restores keep working with no change.
- Package listing metadata is treated as part of the deliverable, not an afterthought:
  `PackageProjectUrl`, `PackageIcon`, `PackageTags`, and a per-package `Description` are set once in
  `Directory.Build.props`, and the repository README is packed into every package as its
  `PackageReadmeFile`, so the listing page is the funnel.
- **No backfill.** nuget.org starts at the first release published after this decision. Older
  versions remain available on GitHub Packages only.

## Rationale
- **The install line has to be true.** Documentation that cannot be followed is worse than no
  documentation, because the reader concludes the project is broken rather than that the registry is
  unusual. Every other adoption improvement is downstream of this one.
- **Publishing to both costs one workflow step.** There is no maintenance split: the same nupkgs
  produced by the same pack step go to two feeds, so the registries cannot drift in content.
- **A credential that cannot be stored cannot be leaked.** A stored key would also have carried a
  365-day maximum lifetime, and expiry is the failure mode a presence check cannot catch: the secret
  is still there, so the step still runs, and the release fails at the push. Trusted publishing
  removes the rotation obligation rather than scheduling it.
- **The owner guard beats a secret-presence guard.** It states the actual condition (this is the
  canonical repository) instead of inferring it from configuration, and it keeps a fork's release
  working.
- **nuget.org is irreversible per version, so the conservative scope is right.** `--skip-duplicate`
  keeps a re-run idempotent, and starting clean avoids publishing a long tail of old versions that
  nobody asked for and that can never be deleted (only unlisted).
- **Reserving the ID prefix is cheap insurance.** Package ids on nuget.org are first-come; an
  unreserved `MMCA.` namespace is a supply-chain risk (ADR-038 covers provenance for the artifacts
  themselves).

## Trade-offs
- **A published version can never be withdrawn.** nuget.org allows unlisting, not deletion. A bad
  release is now permanent public history, which raises the stakes on the release gates (the SBOM
  hard gate, the package-consumption job, and the Helpdesk source-build canary all already run
  before a tag ships).
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
  because the counterweight is far tighter: the exchange only happens from one repository's one
  workflow file.
- **Prefix reservation is a manual, account-level action** that cannot be expressed in this
  repository, so that half of the decision is not enforceable by code review.

## Related
ADR-016 (lockstep versioning: every package ships at one version, so both registries receive the
same fifteen ids per release),
ADR-038 (supply-chain provenance: the SBOM hard gate, lock files, and vulnerability audit that all
run before either push; keyless publishing extends that posture to the credential itself),
ADR-042 (the MAUI package's separate windows job, which needs the same dual push to keep the
release whole).
