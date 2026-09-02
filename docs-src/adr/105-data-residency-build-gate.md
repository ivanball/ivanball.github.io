# ADR-105: The Published Data-Residency Claim as a Build Gate

## Status
Accepted (2026-09-01).

## Context
Both deployed apps publish a privacy policy at their repo root, and each has a section that tells a
user where their personal data is stored (`MMCA.ADC/PRIVACY.md:61`, `MMCA.Store/PRIVACY.md:53`).
That sentence is a public commitment about a named jurisdiction, and it is one of the few parts of a
privacy policy that a reader could in principle check against reality.

It is also the part most likely to be quietly wrong. The region a policy names is typed once, by a
human, at the moment the policy is written. The region where the databases holding that data are
actually provisioned lives in infrastructure code that moves for reasons having nothing to do with
the policy: ADC pins its SQL server's region to a default declared inside its deploy workflow,
deliberately separate from where its Container Apps run, because the subscription blocks the SQL
resource provider in the resource group's own location
(`MMCA.ADC/.github/workflows/deploy.yml:1152-1157`); Store runs single-region and records that region
as a single sentence in its DR runbook (`MMCA.Store/infra/DISASTER-RECOVERY.md:19`). Either can move
without anyone opening `PRIVACY.md`, and the failure is silent: nothing breaks, no test goes red, no
alert fires, and the app keeps serving traffic while the published claim is false. This workspace had
exactly that gap, which is why ADC's guard still carries an explicit block on the stale claim its
policy once made
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:9-10,16`).

The compliance surface around this is already fitness-enforced wherever a compiler can see it.
ADR-005's erasure path is guarded by `PiiConventionTestsBase`, which fails the build when a domain
entity carrying a `[Pii]` property does not implement `IAnonymizable`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/PiiConventionTestsBase.cs:3-12`).
Residency is not a property of any type, so that technique does not reach it: the claim lives in
prose and the truth lives in a workflow file or a runbook. It is a doc-to-infrastructure consistency
problem, the same shape ADC already solves for SLO alerts by embedding the Bicep template and the
operations runbook into the architecture test assembly and pairing them
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/MMCA.ADC.Architecture.Tests.csproj:14-22`,
ADR-062), and the same shape ADR-081 solves for the cost baseline at deploy time.

## Decision
**The published data-residency claim is a build-gated assertion. A shared fitness base parses the
region where a repo actually provisions its PII-bearing storage from that repo's own infrastructure
source of truth, and fails the build unless the repo's `PRIVACY.md` states that region.**

1. **One shared base, one test, authored in the framework.** `DataResidencyTestsBase`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/DataResidencyTestsBase.cs:14`)
   declares a single `[Fact]`, `PrivacyPolicy_DataStorageRegion_MatchesDeployedRegion` (`:25-45`),
   and names the rubric category it serves in its own summary (`:3-13`, rubric section 30,
   Compliance, Privacy and Governance). It is one of the 46 abstract bases in that package's
   `Bases/` directory, so it is subclassed per repo rather than copied.

2. **The repo supplies its own source of truth.** The only abstract behavior is
   `ExtractDeployedRegion(string repoRoot)` (`:53`), documented to parse the region from whatever the
   repo actually provisions from (a workflow default, an infra runbook, a Bicep parameter) and to
   assert with a clear `because` when its expected marker is missing rather than return an empty
   string (`:47-52`). The base makes no assumption about where a repo's truth lives.

3. **Both files are read from the working tree, not embedded.** The test locates the repo root by
   walking up from the test assembly's base directory to the directory holding `{RepoToken}.slnx`
   (`:28`, via
   `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureMapBase.cs:79-90`), then
   reads `PRIVACY.md` from that root (`:34`). The repo identity comes from the same `IArchitectureMap`
   every other rule in the package takes (`:16`).

4. **Absence fails, it does not pass.** The extracted region must be non-null and non-whitespace
   before any comparison happens, with the stated reason that the region must be parseable from the
   repo's infrastructure source of truth (`:31-33`). A repo whose marker has been renamed or deleted
   goes red rather than silently comparing nothing.

5. **Matching is whitespace-insensitive and case-insensitive, in both directions.** `Normalize`
   strips every whitespace character and upper-cases the rest (`:57-58`, CA1308 rationale at
   `:55-56`), and is applied to the policy text and to the extracted region alike, so a policy
   written in prose form matches an Azure region token written without spaces (`:35`, `:37-38`). The
   assertion is containment: the normalized policy must contain the normalized region.

6. **A denylist blocks stale and copied claims from returning.** `ForbiddenResidencyClaims` is a
   virtual, empty-by-default list (`:23`); every entry is normalized and asserted absent from the
   policy (`:40-44`), with a failure message stating that the claim is stale or belongs to another
   deployment. This is what a positive match alone cannot catch: a policy can name the correct region
   and still carry a contradicting sentence beside it.

7. **ADC parses its deploy workflow.** `DataResidencyTests`
   (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:12`, map at `:14`)
   reads `.github/workflows/deploy.yml`, finds the `SQL_LOCATION_OVERRIDE:-` marker, asserts it is
   present, and takes the letters and digits that follow it as the region (`:20-31`, marker at `:24`,
   assertion at `:26-27`). That default is the region ADC's SQL server and database land in
   (`MMCA.ADC/.github/workflows/deploy.yml:1157`). Its denylist carries one entry, the
   pre-migration claim that once contradicted the deployed region (`:16`, explained at `:9-10`).

8. **Store parses its DR runbook.** `DataResidencyTests`
   (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/DataResidencyTests.cs:12`, map at
   `:14`) reads `infra/DISASTER-RECOVERY.md`, finds the single-region sentence by its `one region (`
   marker and takes the comma-terminated token that follows, asserting both the marker and the
   terminator are present (`:20-35`, marker at `:24`, assertions at `:26-27` and `:31-32`). Its
   denylist carries two entries, the regions belonging to the other deployment, so a policy paragraph
   copied between the two repos fails (`:16`, explained at `:9-10`).

9. **It runs in the ordinary fitness suite, with no credentials and no cloud calls.** The rule lives
   in each repo's `*.Architecture.Tests` project and executes on every build and pull request like
   every other architecture rule. Unlike the deploy-time gates it never authenticates to Azure and
   never reads live resource state: both of its inputs are committed files.

10. **Adoption is exactly the two deployed apps.** ADC and Store subclass the base; MMCA.Helpdesk
    references the same package
    (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/MMCA.Helpdesk.Architecture.Tests.csproj:24`)
    but declares no `DataResidencyTests` and has no `PRIVACY.md`, and MMCA.Common has neither. The
    base is available to any consumer; it applies to a repo that publishes a residency claim, which
    today is the two apps with users.

11. **The base is frozen public API.** The type, its constructor, the `[Fact]`, the abstract `Map`
    and `ExtractDeployedRegion`, and the virtual `ForbiddenResidencyClaims` are all in the package's
    shipped baseline
    (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/PublicAPI.Shipped.txt:40-42,237-238,370`),
    so reshaping the extension point is a reviewable text diff and a breaking change under ADR-015.

## Rationale
- **The statement with the most legal weight had the least enforcement.** Every other compliance
  claim in these repos is backed by code a rule can inspect: erasure by `IAnonymizable`, PII marking
  by `[Pii]`, export by a contract. Residency was backed by a sentence, and a sentence is the one
  artifact nothing in the build was reading.
- **The truth has to be per repo, because the deployments genuinely differ.** ADC's SQL region is set
  independently of its compute region for a subscription-level reason
  (`MMCA.ADC/.github/workflows/deploy.yml:1152-1156`), while Store's whole footprint is one region
  documented in its DR runbook. A single hardcoded extractor would have fit neither; making
  `ExtractDeployedRegion` the only abstract member keeps the assertion, the normalization and the
  denylist shared while the parsing stays local.
- **Build time is the right time, because both inputs are committed.** ADR-081's cost baseline has to
  query Azure, because the thing it guards is live resource configuration that drifts by hand. What a
  repo claims and what it declares it will provision are both files in the repo, so the cheapest and
  earliest place to compare them is the test suite that already runs on every pull request, with no
  OIDC, no subscription access and no deploy pipeline involvement.
- **A denylist is the only defense against the copy-paste failure.** The two policies are
  structurally similar documents in sibling repos, and the realistic drift is a paragraph carried
  across or a pre-migration sentence left behind. A positive match passes both of those; naming them
  explicitly does not.
- **Failing on an unparseable marker beats defaulting.** The base insists on a non-empty region
  (`DataResidencyTestsBase.cs:31-33`) and both subclasses assert their marker exists, so renaming the
  workflow variable or reformatting the runbook sentence produces a red build with a message naming
  the expected marker, rather than a gate that quietly stops checking.
- **Shipping the rule as a package base matches how every other fitness rule is shared.** ADR-058's
  posture applies: the rule is authored once, versioned with the framework, and adopted as a short
  subclass, so a fix to the comparison logic reaches every consumer through a version bump instead of
  a copy-edit in each repo.

## Trade-offs
- **It proves the policy agrees with a file, not with Azure.** Both extractors read committed text.
  A database provisioned by hand into another region, a restore into a different geography, or a
  geo-redundant backup target is invisible to this gate. In ADC's case the marker parsed is a shell
  default (`MMCA.ADC/.github/workflows/deploy.yml:1157`), so a deploy run with `SQL_LOCATION_OVERRIDE`
  set lands the SQL server in a region the test will never see, and the test still passes.
- **Containment is looser than equality.** The assertion is that the normalized policy contains the
  normalized region (`DataResidencyTestsBase.cs:37-38`), so a policy naming several regions passes as
  long as one of them matches, and a match anywhere in the document counts, including in a sentence
  that is not the residency statement. The denylist is the only counterweight and it is hand
  maintained.
- **Whitespace-stripped containment makes one region token a prefix of another.** After
  normalization a shorter region token is a substring of its numbered sibling, so a policy naming the
  numbered variant satisfies an extracted base-region token. The check is strong against a wholly
  different region and weak against an adjacent one.
- **The markers are load-bearing strings inside files maintained for other reasons.** Renaming the
  workflow's override variable, or reflowing the DR sentence so its comma moves, breaks the build in
  a repo where nobody touched the privacy policy
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/DataResidencyTests.cs:24`,
  `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/DataResidencyTests.cs:24,30-32`). That
  is the intended fail-loud posture, but the cost lands on an unrelated edit.
- **The suite needs the repo working tree.** `FindRepoRoot` walks up for `{RepoToken}.slnx` and throws
  when it is absent (`ArchitectureMapBase.cs:79-90`), so this rule cannot run from a copied artifact
  the way an assembly-only rule can.
- **One region per repo, one storage class.** The model is a single string compared against a single
  policy. A second store of personal data in another location (blob storage, a broker's retained
  payloads, log analytics retention) has no representation here.
- **Nothing detects a missing subclass.** A consumer that publishes a `PRIVACY.md` and never derives
  from the base gets no failure and no warning; the gate exists only where someone opted in. The
  framework ships the rule, the repo has to adopt it.

## Related
[ADR-009](009-resilience-and-recovery-objectives.md) (the single-region acceptance a consumer must
declare: this record is what keeps the published claim honest about which region that is),
[ADR-005](005-soft-delete-vs-erasure.md) (the erasure path guarded by the sibling section 30 fitness
function, `PiiConventionTestsBase`),
[ADR-076](076-data-subject-export.md) (the export half of the same compliance surface, enforced in
code rather than in prose),
[ADR-015](015-architecture-fitness-functions.md) (the fitness-function posture this rule extends from
code shape to a published document, and the public-API baseline that freezes its extension point),
[ADR-058](058-runtime-conformance-suites-as-a-package.md) (rules authored once in a package and
adopted as thin per-repo subclasses),
[ADR-062](062-slo-alerting-as-code.md) (the other doc-to-infrastructure pairing gate: alert specs
against runbook sections),
[ADR-081](081-cost-baseline-deploy-gate.md) (the deploy-time sibling, which has to query live Azure
state because its subject is live configuration rather than committed text).
