# ADR-060: Performance-Regression Gate (Committed Benchmark Baseline in CI)

## Status
Accepted (2026-07-28). Revised 2026-08-01 (corrected the count in Trade-offs: the single ratio floor
names two of the eight benchmarks, so six, not seven, are gated on allocations alone; refreshed the
`ci.yml` line anchors for the `performance-smoke` job, which had shifted by about two lines).

## Context
Rubric section 12 asks for hot-path efficiency that is **measured, not assumed**
(`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:355`). MMCA.Common has a
BenchmarkDotNet harness for its DB-free hot paths, but a harness a maintainer runs by hand proves
nothing about the pull request in front of them. The first CI wiring only proved the benchmarked
code paths still compile and execute; it asserted nothing about the numbers they produced.

Turning that into a real gate runs into the environment it has to run in. CI runs on shared,
GitHub-hosted Ubuntu runners, where wall-clock timings move run to run by more than most regressions
worth catching. An absolute latency assertion (`IsSatisfiedBy` must stay under N nanoseconds) on that
hardware is either tight enough to go red on a noisy neighbour or loose enough never to fire at all.
A gate that cries wolf gets muted, and a gate that never fires was never a gate. That is the design
problem this record answers.

No existing ADR covers it. ADR-015's fitness functions assert **structure and registration**, and
say so explicitly: they are "not runtime behavior"
(`Website/docs-src/adr/015-architecture-fitness-functions.md:48`). ADR-038 gates the supply chain
(SBOM, lock files, vulnerability audit), which is provenance, not cost. ADR-041 instruments
production, so it observes a regression **after** it deploys rather than failing the PR that
introduced it. Nothing owned the statement "a performance regression must fail the merge."

## Decision
Measure the hot-path suite on every code PR and verify the results against a **committed** baseline
that carries two rule kinds: absolute allocation ceilings where the measurement is deterministic, and
benchmark-to-benchmark ratio floors where it is not.

- **A dedicated CI job measures, then verifies.** The `performance-smoke` job, named
  `Performance gate (BenchmarkDotNet Short + baseline verify)`
  (`MMCA.Common/.github/workflows/ci.yml:332-333`), runs the suite with `--filter "*" --job Short
  --exporters json` (`ci.yml:362`) and then runs the verifier over the exported artifacts
  (`ci.yml:371`). `--job Short` (3 warmup plus 3 iterations) is chosen to produce real
  measurements inside the job's 15-minute budget (`ci.yml:336,360`); `--filter "*"` is required
  because BenchmarkDotNet otherwise prompts for a selection and would hang the runner
  (`ci.yml:359-360`).

- **The baseline is a committed JSON file, not a stored previous run.**
  `MMCA.Common/Tests/Performance/perf-baseline.json:1-20` holds an `allocationCeilingsBytes` object
  and a `ratioFloors` array, and its own header states the rule: update it deliberately, in the same
  PR as the change that moves the numbers (`perf-baseline.json:2`).

- **Allocations are gated absolutely.** Each ceiling is per-operation managed bytes, and the verifier
  fails the run when the measured value is strictly greater
  (`MMCA.Common/build/perfgate/Program.cs:67-70`). Eight ceilings are committed today, one per
  benchmark (`perf-baseline.json:4-11`), from `IsSatisfiedBy_CachedCompile` at `0` B/op to
  `ApplyFilters_ThreeMixedOperators` at `87000` B/op. They carry roughly 25% headroom over the
  measured value (`perf-baseline.json:2`).

- **Latency is gated only as a ratio between two benchmarks in the same run.** A `ratioFloors` rule
  names a slow and a fast benchmark and a `minRatio`; the verifier divides
  `mean(slowBenchmark) / mean(fastBenchmark)` and fails when the quotient drops below the floor
  (`Program.cs:74-93`). One floor is committed today: `IsSatisfiedBy_RecompileEachCall` over
  `IsSatisfiedBy_CachedCompile` must stay at or above `1000` (`perf-baseline.json:14-18`), against a
  measured value of roughly 120,000x (`perf-baseline.json:2`). **No absolute latency threshold exists
  anywhere in the gate**: means are read (`Program.cs:43`) and printed for the run log
  (`Program.cs:96-99`), but they are only ever compared to each other.

- **A missing measurement fails, it does not pass.** Every benchmark named by a rule must be present
  in the results, or the verifier reports that "the gate would be vacuous" and fails: once for
  allocation ceilings (`Program.cs:59-62`) and once for either side of a ratio floor
  (`Program.cs:82-86`). Two neighbouring holes are closed the same way: zero exported artifacts is a
  failure rather than an empty pass (`Program.cs:29-33`), and a benchmark that reports no allocation
  data fails with an instruction to keep `[MemoryDiagnoser]` on the suite (`Program.cs:63-66`). All
  violations are listed together and the process exits 1 (`Program.cs:101-110`).

- **The verifier is a dependency-free local tool.** `build/perfgate` has no `PackageReference` at all
  (BCL plus `System.Text.Json`), no lock file, no NuGet audit surface and no analyzer pass
  (`MMCA.Common/build/perfgate/perfgate.csproj:2-21`), so the gate itself cannot become a restore or
  supply-chain problem. It reads BenchmarkDotNet's `*-report-full-compressed.json` exports from the
  results directory it is handed (`Program.cs:26-33`), which CI points at
  `BenchmarkDotNet.Artifacts/results` (`ci.yml:371`).

- **The job is a required merge gate, not advisory.** It is listed among the eight required contexts
  in `MMCA.Common/CONTRIBUTING.md:68-71` and in the reproducible ruleset payload there
  (`CONTRIBUTING.md:179`), and the live branch protection on `ivanball/MMCA.Common` returns the same
  context (read 2026-07-28 via
  `gh api repos/ivanball/MMCA.Common/branches/main/protection --jq '.required_status_checks.contexts[]'`).
  Moving a number therefore requires editing the baseline in the same PR, and raising a ceiling to
  silence a red gate is called out as defeating it (`CONTRIBUTING.md:70-71`).

The suite the gate measures is eight `[MemoryDiagnoser]` benchmarks in two classes
(`Tests/Performance/MMCA.Common.Benchmarks/SpecificationBenchmarks.cs:13`,
`QueryPipelineBenchmarks.cs:16`): the specification compiled-delegate path and its recompile
anti-pattern plus criteria composition (`SpecificationBenchmarks.cs:37-52`), and the per-request read
pipeline, two filter shapes, dynamic sorting, and full-field versus sparse-field shaping of a
100-row page (`QueryPipelineBenchmarks.cs:53-86`). Every one of the eight is named by a ceiling, so
the vacuity check covers the whole suite. The benchmark project references only Application, Domain
and Shared and sits deliberately outside `MMCA.Common.slnx` so the unit-test loop stays fast
(`MMCA.Common.Benchmarks.csproj:3-6,20-24`).

**This gate is MMCA.Common only.** The harness, the baseline and the verifier exist in that repo and
nowhere else. MMCA.ADC and MMCA.Store have no benchmark suite and no perfgate; their performance
artifact for backend hot paths is a k6 load test against deployed read endpoints, which runs monthly
on a schedule and on demand, not on a pull request (`MMCA.ADC/.github/workflows/load-test.yml:1-18`,
`MMCA.Store/.github/workflows/load-test.yml:8-18`). MMCA.Helpdesk has neither. The client-side
counterpart, a Core Web Vitals budget asserted per deploy inside the chromium e2e-gate, is
[ADR-092](092-web-vitals-budget-gate.md)'s decision, not this gate's.

## Rationale
- **A ratio is a property of the code; an absolute nanosecond count is a property of the runner.**
  Both benchmarks in a floor run in the same process, on the same machine, in the same run, under the
  same JIT and the same noise from whatever else that hosted runner is doing. Whatever slows one
  slows the other, so the machine cancels out of the quotient. That is what makes a latency assertion
  valid on hardware nobody controls: the gate never claims to know how fast the runner is, only that
  one path stayed enormously faster than the other.
- **The ratio encodes the invariant that actually matters.** `Specification<TEntity, TId>` caches its
  compiled delegate per instance (`MMCA.Common/Source/Core/MMCA.Common.Domain/Specifications/Specification.cs:27,32`),
  and the two benchmarks are exactly the production path (one instance reused) and the anti-pattern
  the cache exists to avoid (a fresh instance per evaluation, recompiling every call)
  (`SpecificationBenchmarks.cs:36-42`). If someone deletes the cache field, moves the compile into
  the property, or makes the specification transient per call, the ratio collapses toward 1 and no
  amount of runner noise can hide it. The gate asks "does the cache still exist," which survives a
  noisy measurement, instead of "is the cache exactly this fast," which does not.
- **The floor is set three orders of magnitude below the measurement on purpose.** 1000 against a
  measured 120,000 (`perf-baseline.json:2,17`) is not a weak threshold, it is the threshold matched
  to the claim. Anything that keeps the cache intact stays far above it; anything that breaks the
  cache falls far below it. There is no band of ambiguity for CI noise to land in.
- **Allocations are the deterministic half, so they get absolute numbers.** Bytes per operation do
  not depend on how busy the runner is, which is precisely why ceilings are legitimate there and
  ratios are not needed. Splitting the baseline by measurement stability (absolute where
  deterministic, relative where noisy) is what lets one gate assert both kinds of cost without
  either half being a lie.
- **Vacuity is the failure mode a benchmark gate actually has.** A renamed method, a dropped
  `[MemoryDiagnoser]`, or a filter that selects nothing would all leave a gate that passes while
  measuring nothing, which is worse than no gate because it reads as evidence. Failing on absence
  (`Program.cs:59-62,63-66,82-86,29-33`) is the difference between a check and a decoration.
- **A committed baseline makes a cost change reviewable.** The number lives in a file in the diff, so
  deliberately paying more allocation is a line a reviewer sees and questions in the same PR as the
  code that spends it. A gate that compared against the previous run instead would ratchet silently:
  every PR is only slightly worse than the last, and the sum is invisible.
- **Same posture as the rest of the repo's gates.** Turning a discipline ("remember to check the hot
  paths") into a build invariant is the lever ADR-015 applies to layer rules and ADR-038 applies to
  supply-chain provenance; this record applies it to runtime cost.

## Trade-offs
- **The Short job cannot see small latency regressions.** Three warmup and three iterations
  (`ci.yml:360`) give wide confidence intervals: enough for a 1000x floor and for counting bytes,
  useless for detecting a 5% slowdown. Detecting that would need a longer job and a dedicated runner,
  which the 15-minute budget (`ci.yml:336`) deliberately does not buy.
- **Only one ratio floor exists today** (`perf-baseline.json:13-19`), so the machine-independent
  latency half of the gate protects exactly one invariant. That floor names two of the eight
  benchmarks (`perf-baseline.json:14-18`), so the remaining six are gated on allocations alone,
  which catches a new allocation but not a pure CPU regression.
- **The ceilings have roughly 25% headroom** (`perf-baseline.json:2`), so a regression smaller than
  that passes. The headroom is what keeps the gate stable across BenchmarkDotNet and runtime
  revisions; the cost is that it is a ratchet with slack, not a tripwire.
- **Nothing stops a ceiling being raised to make a red gate green.** `CONTRIBUTING.md:70-71` names
  that as defeating the gate, but it is enforced by review, not by the tool.
- **Coverage is the DB-free hot paths only.** The suite references just Application, Domain and
  Shared (`MMCA.Common.Benchmarks.csproj:20-24`), so EF translation, HTTP, serialization and the
  outbox are outside it. The published `ApplyFilters` ceilings are tens of KB per call precisely
  because System.Linq.Dynamic.Core re-parses the predicate on each request
  (`perf-baseline.json:2`): the gate bounds that cost, it does not remove it.
- **The gate runs on pull requests only.** CI has no `push: main` trigger
  (`MMCA.Common/.github/workflows/ci.yml:14-16`), and `release.yml` does not run `build/perfgate` (it
  only mentions the project in a NuGet cache-key comment,
  `MMCA.Common/.github/workflows/release.yml:26,109`), so a release tag is not re-verified against
  the baseline.
- **A green context does not always mean the benchmarks ran.** On a documentation-only PR the heavy
  steps are skipped by the `changes` classifier while all required contexts still post green, which
  is what keeps branch protection satisfiable (`ci.yml:32-35,357,365`).
- **Consumers inherit the numbers, not the gate.** MMCA.ADC, MMCA.Store and MMCA.Helpdesk get the
  framework's bounded hot paths through the released packages, but none of them gates their own
  application code this way.

## Related
ADR-015 (structural fitness functions, which explicitly stop at structure and registration; this is
their runtime-cost counterpart), ADR-038 (the other build-gating control set, applied to supply-chain
provenance rather than cost), ADR-041 (production telemetry, which observes cost after deploy where
this fails it before merge), ADR-055 (the specification contract whose per-instance compiled-delegate
cache the ratio floor protects), ADR-034 (the generic query layer whose per-request filter, sort and
shaping cost the allocation ceilings bound).
