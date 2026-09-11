# ADR-120: Governed Language-Model Boundary (MMCA.Common.AI)

## Status
Accepted (2026-09-11). Extends [ADR-111](111-ai-session-scoring-governance.md), which keeps every
scoring-specific rule it states: this record moves the parts that are not about session scoring into
the framework, as one optional package every future model call composes over.

Revised 2026-09-11: ADC's session scoring runs on the package. The Context, Trade-offs and
Consequences describe the adopted state (a constructor-injected `IChatClient` and `PromptContract`,
framework-owned bounds and one framework meter) instead of a pending migration.

## Context
Rubric section 16, AI-Native Application Architecture, asks one question of a product feature that
calls a language model: is that dependency governed like any other external system, meaning
isolated, versioned, evaluated, observed and bounded in what it may do
(`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:469`, intent at `:471`, the seven
criteria at `:476-482`). The category is N/A until a feature calls a model and is scored the moment
one does (`:473`).

Exactly one feature does. ADC's organizer-facing session scoring takes a constructor-injected
`IChatClient` and `PromptContract`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AnthropicScoringService.cs:30-33`),
and [ADR-111](111-ai-session-scoring-governance.md) records the governance it grew: a port in
Application, a pinned model, a dated prompt version, a golden-replay evaluation gate that hashes the
rendered prompt per version, delimited and redacted input, a schema-constrained response, and a
budgeted spend alert. What the module owns is what only session scoring knows: the prompt text, the
redaction rules and the response schema. What it does not own is the call. The model id (`:47`) and
the 256-token output ceiling (`:54`) are folded into the prompt contract and clamped again by
`Ai:MaxOutputTokens` at the framework boundary, `ModelId` (`:57`) and `PromptVersion` (`:68`) read
through the injected contract rather than standing as independent literals, nothing in the module
constructs an `HttpClient` for Anthropic
(`MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:33-46`), and Infrastructure is the only
layer that names the package (`MMCA.ADC.Conference.Infrastructure.csproj:19`, reason at `:15-18`).
Token counters come off the framework meter `MMCA.Common.AI` rather than a meter named for the
feature (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:135`, meter registration
at `:137-148`). That division is the whole point of this record: ADR-111 names the alternative in
its own trade-offs, where one feature, one provider and one model leave no general model-calling
abstraction, so a second AI feature inherits the conventions by imitation rather than by
construction. ADC scored M2/I5 on section 16 in the 2026-09-04 cycle, before the package existed
(`Website/docs-src/governance/adc-ArchitectureScorecard.md:68`); Store and Helpdesk have no feature
that calls a model, so the category is N/A for them.

Imitation is the wrong transport for this particular set of rules. Every one of them is a property
of *calling a model*, not a property of *scoring a session*: an output-token ceiling, a wall-clock
budget, a tool-use gate, a prompt whose identity is hashed, a token counter tagged by model and
prompt version. Written per feature, each is a fresh chance to forget one, and the forgetting is
invisible until a bill or an incident. Written once, they are what a second feature gets for free.

The external landscape had already converged on the shape. Microsoft's October 2024 eShopSupport
sample ("eShop infused with AI") demonstrated the `Microsoft.Extensions.AI` abstractions precisely so
that a provider swap does not touch business logic, and the October 2025 Microsoft Agent Framework
orchestration post made OpenTelemetry instrumentation the default expectation for a production agent
rather than an afterthought. Both point at the same conclusion this workspace reached from its own
rubric: the interesting artifact is not the provider client, it is the governed pipeline around it.

## Decision
**The framework owns the language-model boundary as one optional package, `MMCA.Common.AI`. The
provider half is the official SDK's own `IChatClient` adapter, the governance half is a pipeline of
delegating clients, prompts are versioned contracts the framework hashes, and tools are off until a
host turns them on.**

1. **One package, with no MMCA project reference.** `MMCA.Common.AI` takes a `FrameworkReference` on
   `Microsoft.AspNetCore.App` (`MMCA.Common/Source/Core/MMCA.Common.AI/MMCA.Common.AI.csproj:11`) for
   the hosting environment, the distributed cache, the configuration binder and the options
   validation pipeline, plus exactly two runtime packages: `Microsoft.Extensions.AI` (`:29`), pinned
   at 10.10.0 (`MMCA.Common/Directory.Packages.props:108`), and `Anthropic` (`:30`), the official
   Anthropic .NET SDK, pinned at 12.47.0 (`Directory.Packages.props:115`). The csproj states the
   reason in place (`MMCA.Common.AI.csproj:15-28`): everything the package governs is expressed in
   `Microsoft.Extensions.AI` primitives, so it needs nothing from Domain, Application or
   Infrastructure and must stay installable by a host that has taken none of them.

2. **The dependency direction is build-gated in both directions.** `EnforceAiLayerBoundary`
   (`MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets:86-100`) fails the build if the
   package ever takes a `ProjectReference` on Domain, Application, Infrastructure, API, Grpc or UI.
   The other direction is a runtime fitness function: `AiDependencyIsolationTestsBase`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/AiDependencyIsolationTestsBase.cs:19`)
   asserts that no layer outside a `*.Infrastructure` assembly or the package itself names
   `Anthropic`, `Microsoft.Extensions.AI`, `OpenAI` or `Azure.AI`
   (`Rules/Layering/ArchitectureRules.Ai.cs:26-32`, rule at `:38`), and that nothing outside
   Infrastructure references `MMCA.Common.AI` at all (`:63`, prefix at `:13`, classification at
   `:87-95`). A prompt or a bound must not become a type Domain or Application depends on.

3. **The provider adapter is the SDK's, not ours.** `CreateProviderChatClient`
   (`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:138`) constructs an
   `AnthropicClient` and calls the SDK's own `AsIChatClient` extension with the configured model and
   output ceiling (`:149-153`). Nothing in the framework hand-rolls a Messages API request, and a
   provider the package does not know is supplied through the factory overload of
   `AddMmcaChatClient` (`:74`) rather than by adding a second vendor dependency here.

4. **Governance is a pipeline of delegating clients, ordered outermost first.**
   `AddMmcaChatClient(IConfiguration)` (`:59`) builds `BoundedChatClient` ->
   `UsageRecordingChatClient` -> optional `DistributedCache` -> `OpenTelemetry` -> `Logging` ->
   provider (registration at `:100-123`, order documented at `:22-36`). Bounds are outermost so a
   call the configuration forbids is refused before it is logged, cached or counted. Telemetry rides
   the same name as the meter (`:120-122`), and prompt and completion text reach traces only on a
   host positively identified as Development (`:117`, gate at `:172-176`), which fails closed.

5. **What a call may do is configuration, and the outermost client enforces it.** `BoundedChatClient`
   (`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/BoundedChatClient.cs:51`) clamps `MaxOutputTokens`
   down to `Ai:MaxOutputTokens` while leaving a smaller caller number alone (`:151-153`), runs every
   call under a token linked to the caller's own and cancelled after `Ai:Timeout` (`:164-169`, the
   streaming path covered for the whole stream at `:104-112`), strips tools and the tool mode while
   `Ai:AllowTools` is false (`:155-159`), and refuses a request whose ESTIMATED input exceeds
   `Ai:PerCallInputTokenBudget` before it reaches the provider (`:171-186`). The estimate asks the
   pipeline for an `IAiTokenEstimator` (`Chat/IAiTokenEstimator.cs:14`) and otherwise counts four
   characters to the token (`:144`). Caller options are cloned, never mutated (`:149`).

6. **The configuration surface is one section, validated, and the switch is the registration.**
   `AiSettings` (`MMCA.Common/Source/Core/MMCA.Common.AI/AiSettings.cs:31`) binds `Ai` (`:34`) and
   carries `Enabled` (`:48`), `Provider` (`:51`), `Model` (`:59`), `ApiKey` (`:70`),
   `MaxOutputTokens` (`:77`, default 1024 at `:37`), `Timeout` (`:83`, default 30 seconds at `:40`),
   `AllowTools` (`:90`), `EnableCache` (`:96`) and `PerCallInputTokenBudget` (`:104`). `Model` and
   `ApiKey` are required only once `Enabled` is true (`:113-141`), so the section ships in every
   appsettings file. When `Ai:Enabled` is false **nothing is registered**
   (`DependencyInjection.cs:90-93`): a consumer gates on `GetService<IChatClient>()` being present,
   not on a flag it has to read, so a feature with no key in a given environment is off by
   construction.

7. **A prompt is a versioned contract, and the framework computes its identity.** `PromptContract`
   (`MMCA.Common/Source/Core/MMCA.Common.AI/PromptContract.cs:23`) is a record of name, version,
   model and system prompt whose `Hash` (`:46`) is the lowercase hex SHA-256 of those four joined,
   each with its line endings normalized to LF first (`:90-103`), so the same prompt hashes
   identically on Windows and Linux and `core.autocrlf` cannot trip a CI gate. The hash is computed
   on each read rather than cached, because a record's copy constructor would carry a cached hash
   through a `with` expression and describe the prompt the copy came from (`:40-45`). `ToChatOptions`
   (`:53`) and `Apply` (`:62`) stamp `mmca.prompt.name`, `mmca.prompt.version` and `mmca.prompt.hash`
   onto the request (`:26`, `:29`, `:32`), which is how the identity reaches telemetry.

8. **Spend is metered once, framework-wide.** `AiUsageMeter`
   (`MMCA.Common/Source/Core/MMCA.Common.AI/Observability/AiUsageMeter.cs:20`) publishes
   `mmca.ai.input_tokens` (`:29`) and `mmca.ai.output_tokens` (`:32`) on the meter `MMCA.Common.AI`
   (`:26`), each tagged `model`, `prompt_name`, `prompt_version` and `provider` (`:86-92`).
   `UsageRecordingChatClient` (`Chat/UsageRecordingChatClient.cs:21`) records the provider's own
   reported numbers rather than an estimate, on the buffered path (`:46-51`) and on the streaming
   path from the `UsageContent` item the provider delivers (`:57-83`). The `Meter` is created through
   `IMeterFactory` and deliberately neither retained nor disposed (`AiUsageMeter.cs:49-62`), because
   disposing a factory-owned meter kills the instrument for every other holder of the same name. A
   usage the provider did not report records nothing (`:81-84`): an absent number must not read as a
   zero on a spend dashboard.

## Rationale
- **These rules belong to the call, not to the feature.** An output ceiling, a timeout, a tool gate
  and a token counter are true of every model call anybody will ever write here. Shipping them as a
  package makes the second feature cheaper than the first, which is the opposite of what imitation
  produces.
- **A default is a suggestion and a bound is not.** The provider client is handed the model and the
  ceiling as its defaults, and `BoundedChatClient` still clamps per call
  (`DependencyInjection.cs:146-148`). A governance layer that can be talked out of its limits by a
  caller argument is documentation.
- **Off by absence beats off by flag.** Registering nothing when `Ai:Enabled` is false means a
  feature cannot half-run against a missing key: the dependency is either resolvable or the code path
  does not exist. A boolean everyone has to remember to check is the version of this that fails.
- **Hashing the prompt is what makes a model dependency evaluable at all.** Recorded golden answers
  are valid for one exact combination of name, version, model and text. Deriving the identity from
  all four means an edit without a version bump still moves the hash, so the evaluation cannot be
  skipped by forgetting, which is exactly the property ADR-111's `PromptContractTests` proved worth
  having.
- **Tools off by default is the cheap half of least privilege.** Stripping tools from the request is
  the difference between telling a model not to act and being unable to hand it the means. The rubric
  asks for explicit, authorized, confirmable tools (`ArchitectureEvaluationCriteria.md:480`); until a
  feature needs any, the honest answer is that none exist.
- **One meter name across every app is what makes a dashboard portable.** A per-feature meter means a
  per-feature query, and the spend question is asked across services, not within one.
- **Taking the official SDK for its adapter, and nothing else.** The value in the `Anthropic` package
  here is `AsIChatClient`. Anything else this package needed from a vendor would be a sign the
  boundary is in the wrong place.

## Trade-offs
- **Off by absence puts a null on the consumer.** Because nothing is registered when `Ai:Enabled` is
  false, a feature resolves the client with `GetService` and holds a nullable dependency: ADC's
  registration does exactly that and its scoring service takes `IChatClient?`
  (`MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:38-46`,
  `AnthropicScoringService.cs:31`). The disabled path is a branch the consumer writes, not a flag the
  framework reads for it.
- **Spend is queried under framework names.** `IAiScoringService`, the dated `PromptVersion` and the
  golden-replay gate are the feature's, but the meter is not: ADC's token counters report on
  `MMCA.Common.AI` under the framework's counter names, so the App Insights spend alert and any saved
  query key on those rather than on a per-service meter
  (`MMCA.ADC.Conference.Service/Program.cs:137-148`). That is the standing cost of having one name
  instead of one per feature.
- **The input budget is an estimate, and says so.** It reads message text plus instructions only, so
  images, tool schemas, provider-side additions and non-Latin scripts are under-counted
  (`BoundedChatClient.cs:37-44`). It is a runaway guardrail with headroom, never a billing figure.
  The authoritative numbers arrive after the call.
- **A cache hit still records usage.** `UsageRecordingChatClient` sits inside the optional response
  cache, so a hit counts what the call would have cost rather than what was billed
  (`DependencyInjection.cs:30-36`). The provider span is absent on a hit, so the two are
  distinguishable, but a spend graph read without that context over-reports.
- **The package governs the call, not the prompt's content.** Delimiting untrusted input, escaping it,
  redacting PII and constraining the response schema stay where ADR-111 put them: in the feature that
  knows what its input is. This record does not turn those into framework code, and a second feature
  still has to make those decisions for itself.
- **One provider is built in.** Anything other than Anthropic goes through the factory overload
  (`DependencyInjection.cs:74`) and an unrecognized provider throws with that instruction
  (`:154-156`). The pipeline is provider-agnostic; the convenience is not.
- **An optional package nobody installs governs nothing.** Store and Helpdesk adopt none of this until
  a feature of theirs calls a model, which is the correct answer and also means the rules are proven
  by exactly one consumer for now.

## Consequences
- **ADC's `AnthropicScoringService` runs on `IChatClient`** (`AnthropicScoringService.cs:30-33`). The
  port `IAiScoringService` stays, `PromptVersion` stays and keeps being persisted with every score,
  and the two-tier evaluation gate stays. The module holds no hand-written provider request, no
  free-standing model or ceiling literal and no per-service meter.
- **Store and Helpdesk adopt nothing.** Section 16 remains N/A for both until a product feature of
  theirs calls a model.
- **Section 16 re-scoring is open for ADC on "observed" and "bounded".** Token usage, model id and
  prompt version reach telemetry through one shared source, and the per-call ceiling is
  configuration rather than a literal in a request body, so the next scorecard cycle scores those
  two criteria against the framework pipeline. The criteria this record does not touch (evaluation,
  guardrails, retrieval) are unchanged.

## Related
[ADR-111](111-ai-session-scoring-governance.md) (the record this one extends: every scoring-specific
rule, the prompt-change protocol, the golden and live evaluation tiers, the input and output
guardrails and the budgeted ceiling alert stay there and are not superseded),
[ADR-041](041-observability-and-telemetry.md) (the telemetry posture the meter and the
`ActivitySource` join, and the reason both share one name),
[ADR-110](110-rubric-v2-category-realignment.md) (the rubric revision that created section 16),
[ADR-015](015-architecture-fitness-functions.md) (the shared rule library
`AiDependencyIsolationTestsBase` ships in),
[ADR-101](101-common-metapackage.md) (why an optional package stays out of the metapackage),
[ADR-070](070-fail-fast-configuration-contract.md) (the bind-validate-on-start contract `AiSettings`
follows),
[ADR-061](061-runtime-secret-management.md) (the Key Vault path `Ai:ApiKey` binds from in
production),
[ADR-016](016-lockstep-versioning-masstransit-pin.md) (the lockstep release the package ships in and
the consumer bump that carries ADC onto it).
