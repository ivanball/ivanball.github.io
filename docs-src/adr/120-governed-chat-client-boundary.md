# ADR-120: Governed Language-Model Boundary (MMCA.Common.AI)

## Status
Accepted (2026-09-11). Extends [ADR-111](111-ai-session-scoring-governance.md), which keeps every
scoring-specific rule it states: this record moves the parts that are not about session scoring into
the framework, as one optional package every future model call composes over.

Revised 2026-09-11: ADC's session scoring runs on the package. The Context, Trade-offs and
Consequences describe the adopted state (a constructor-injected `IChatClient` and `PromptContract`,
framework-owned bounds and one framework meter) instead of a pending migration.

Revised 2026-09-15 (MMCA.Common v1.203.0): the pipeline gains an optional guardrail layer and its
telemetry is exported by the framework host. `IChatGuardrail` (`MMCA.Common.AI.Chat`) is an
extension point only: a host registers one or more implementations and `GuardrailChatClient` runs
them, in registration order, on the request and on the buffered response, throwing
`ChatGuardrailException` on the first `GuardrailVerdict.Block(reason)`. Content policy (delimiting,
redaction, injection handling) still lives in the feature per the trade-off below; the framework now
offers the place to plug it in, not the policy. `AiUsageMeter` also publishes a
`mmca.ai.call.duration` histogram (seconds, tagged `outcome` = `success` | `error` | `canceled`
beside the usage tags), and `MMCA.Common.Aspire`'s `ConfigureOpenTelemetry` registers the
`MMCA.Common.AI` trace source and meter, so a consumer no longer has to add either by hand for the
spans and counters to leave the process.

Revised 2026-09-19: the section 16 re-scoring this record left open for ADC has happened. The
Consequences state the outcome of the thirty-second scorecard cycle (2026-09-16, M4/I9, Implementation
8 to 9) instead of a pending cycle.

Revised 2026-09-21 (MMCA.Common v1.207.0): the provider leaves the governed package. `Ai:Provider`
is a string matched against the `IAiProviderFactory` instances a host registered from an adapter
package (`MMCA.Common.AI.Anthropic`, `MMCA.Common.AI.OpenAI`) and validated at startup; the
`provider` tag is read from the inner client's own metadata; `BoundedChatClient` pins `Ai:Model` and
filters tools through `IChatToolPolicy`; a redaction extension point, one shipped PII policy,
per-update inspection on the streamed path and two registration-time refusals (`Ai:RequireGuardrail`
on by default, `Ai:AllowTools` with no policy) turn the guardrail layer from an extension point into
a default; `PromptTaggingChatClient` joins the pipeline inside the OpenTelemetry layer; and the
evaluation harness ships as `MMCA.Common.AI.Testing`, which the framework runs on its own reference
contract. The consumer-visible half of that (the `provider` tag casing, the two new defaults, the
removed `AiProvider` enum) is mapped in `MMCA.Common/UPGRADING.md` under `[1.207.0]`.

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
**The framework owns the language-model boundary as one optional package, `MMCA.Common.AI`, that
names no vendor. A provider arrives as an adapter package contributing one factory, the governance
half is a pipeline of delegating clients, prompts are versioned contracts the framework hashes,
tools are off until a host turns them on and says which, a host that inspects nothing does not
start, and the evaluation harness ships beside the package.**

1. **One governed package, with no MMCA project reference and no vendor SDK.** `MMCA.Common.AI`
   takes a `FrameworkReference` on `Microsoft.AspNetCore.App`
   (`MMCA.Common/Source/Core/MMCA.Common.AI/MMCA.Common.AI.csproj:11`) for the hosting environment,
   the distributed cache, the configuration binder and the options validation pipeline, plus exactly
   one runtime package: `Microsoft.Extensions.AI` (`:30`), pinned at 10.10.0
   (`MMCA.Common/Directory.Packages.props:108`). The csproj states the reason in place
   (`MMCA.Common.AI.csproj:15-29`): everything the package governs is expressed in
   `Microsoft.Extensions.AI` primitives, so it needs nothing from Domain, Application or
   Infrastructure, must stay installable by a host that has taken none of them, and must not pin a
   vendor for a host that configured a different one.

2. **A provider is an adapter package contributing one factory, selected by name and validated at
   startup.** `IAiProviderFactory` (`MMCA.Common.AI/Providers/IAiProviderFactory.cs:20`) is the whole
   provider boundary: a `Name` a configuration file selects by (`:26`) and a `Create` that hands back
   an ungoverned `IChatClient` (`:34`). Two adapters ship, each one factory and one registration
   call: `MMCA.Common.AI.Anthropic` (`AnthropicAiProviderFactory.cs:14`, name at `:17`, the SDK's own
   `AsIChatClient` at `:48`, `AddAnthropicAiProvider()` at `DependencyInjection.cs:26`) over the
   official Anthropic SDK (`MMCA.Common.AI.Anthropic.csproj:13`, pinned at 12.48.0,
   `Directory.Packages.props:115`), and `MMCA.Common.AI.OpenAI` (`OpenAiProviderFactory.cs:18`, name
   at `:21`, `GetChatClient(model).AsIChatClient()` at `:49-51`, `AddOpenAiProvider()` at
   `DependencyInjection.cs:26`) over `Microsoft.Extensions.AI.OpenAI` and the official OpenAI SDK
   (`MMCA.Common.AI.OpenAI.csproj:13-14`, pinned at `Directory.Packages.props:120-121`).
   `Ai:Provider` is a plain string (`AiSettings.cs:48`) matched case-insensitively against the
   registered factory names (`Providers/AiProviderValidator.cs:41-42`), and
   `CreateProviderChatClient` (`DependencyInjection.cs:239`) asks the match to build the client
   (`:244-247`). A name with no factory behind it is refused at boot, not on a user's first request:
   `AiProviderValidator` (`AiProviderValidator.cs:16`) is an `IValidateOptions<AiSettings>` the
   configuration overload registers (`DependencyInjection.cs:94`) and `ValidateOnStart` runs
   (`:126`), with the registered names, or the adapter packages when there are none, in the message
   (`AiProviderValidator.cs:48-63`). `Ai:Endpoint` (`AiSettings.cs:76`) routes either adapter through
   an AI gateway, a regional endpoint or a compatible server (`AnthropicAiProviderFactory.cs:43-46`,
   `OpenAiProviderFactory.cs:44-47`).

3. **The dependency direction is build-gated in both directions.** `EnforceAiLayerBoundary`
   (`MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets:86`) runs for `MMCA.Common.AI` and
   for every `MMCA.Common.AI.*` project (`:88`), so the adapters and the testing package inherit the
   rule, and fails the build if any of them takes a `ProjectReference` on Domain, Application,
   Infrastructure, API, Grpc or UI (`:90-99`). The other direction is a runtime fitness function:
   `AiDependencyIsolationTestsBase`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/AiDependencyIsolationTestsBase.cs:19`)
   asserts that no layer outside a `*.Infrastructure` assembly or the boundary itself names
   `Anthropic`, `Microsoft.Extensions.AI`, `OpenAI` or `Azure.AI`
   (`Rules/Layering/ArchitectureRules.Ai.cs:26-32`, rule at `:38`), and that nothing outside
   Infrastructure references the governed package at all (`:63`). The boundary is classified by the
   `MMCA.Common.AI.` prefix (`:13`, classification at `:87-95`), which is what admits the adapter
   packages and `MMCA.Common.AI.Testing` to it. A prompt or a bound must not become a type Domain or
   Application depends on.

4. **Governance is a pipeline of delegating clients, ordered outermost first.**
   `AddMmcaChatClient(IConfiguration)` (`DependencyInjection.cs:88`) builds `BoundedChatClient` ->
   optional `GuardrailChatClient` (present only when the host registers at least one
   `IChatGuardrail` or one `IChatRequestRedactor`) -> `UsageRecordingChatClient` -> optional
   `DistributedCache` -> `OpenTelemetry` -> `PromptTagging` -> `Logging` -> the provider client
   (registration at `:149-184`, order documented at `:22-41`). Bounds are outermost so a call the
   configuration forbids is refused before it is inspected, logged, cached or counted, and a
   guardrail block is refused before it is counted. `PromptTaggingChatClient`
   (`Chat/PromptTaggingChatClient.cs:21`) is composed just inside the OpenTelemetry layer
   (`DependencyInjection.cs:183`) so the activity it decorates is that layer's own `gen_ai` span: it
   copies `mmca.prompt.name`, `mmca.prompt.version` and `mmca.prompt.hash` onto it (`:63`) and only
   ever onto an activity from the framework's own source (`:56-57`), so a host with no listener gets
   no stray tags. Telemetry rides the same name as the meter (`DependencyInjection.cs:181`), and
   prompt and completion text reach traces only on a host positively identified as Development
   (`:177`, gate at `:262-266`), which fails closed.

5. **What a call may do is configuration, and the outermost client enforces it.** `BoundedChatClient`
   (`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/BoundedChatClient.cs:65`) clamps `MaxOutputTokens`
   down to `Ai:MaxOutputTokens` while leaving a smaller caller number alone (`:185-187`), sends every
   request out naming `Ai:Model` and refuses one that names a different model (`:205-220`, the
   refusal at `:210-214`), runs every call under a token linked to the caller's own and cancelled
   after `Ai:Timeout` (`:270-275`, the streaming path covered for the whole stream at `:138-145`),
   and refuses a request whose ESTIMATED input exceeds `Ai:PerCallInputTokenBudget` before it reaches
   the provider (`:277-292`). The estimate asks the pipeline for an `IAiTokenEstimator`
   (`Chat/IAiTokenEstimator.cs:14`) and otherwise counts four characters to the token
   (`BoundedChatClient.cs:178`). Caller options are cloned, never mutated (`:183`). Pinning the model
   here is what makes `PromptContract.Model` mean the same thing on an adapter that honors a
   per-request override and one that binds the model at construction
   (`OpenAiProviderFactory.cs:27-32`).

6. **Tools are off by default, and "on" means a policy said yes.** While `Ai:AllowTools` is false,
   tools and the tool mode are stripped from the request (`BoundedChatClient.cs:189-193`). While it
   is true, `FilterTools` (`:231-268`) offers a tool only when EVERY registered `IChatToolPolicy`
   (`Guardrails/IChatToolPolicy.cs:23`) returns `Allowed` (`BoundedChatClient.cs:251`), so policies
   compose by intersection and a new concern can only ever remove tools; `Denied` is the enum's zero
   value (`Guardrails/ToolAuthorization.cs:13`), so a policy that forgets to answer refuses. A tool
   that marks itself consequential (`Guardrails/ChatToolPolicy.cs:29`) clears one more bar: the
   request has to name it in the confirmed list (`:40`, read at `:66-87`, checked at
   `BoundedChatClient.cs:259`), per request and never per session. With no policy registered every
   tool is stripped (`:241-244`), so the layer fails closed, and that combination is refused at
   registration instead (`DependencyInjection.cs:219-226`).

7. **A host that inspects nothing does not start.** `GuardrailChatClient`
   (`Chat/GuardrailChatClient.cs:31`) runs every registered `IChatRequestRedactor`
   (`Guardrails/IChatRequestRedactor.cs:25`) over the materialized messages first (`:126-135`), and
   the redacted list is what the guardrails inspect and what the provider is sent (`:68`, `:95`).
   Then every `IChatGuardrail` (`Chat/IChatGuardrail.cs:20`) inspects the request (`:27`), the
   buffered response (`:37`) and, on the streamed path, each update BEFORE it is yielded
   (`InspectStreamedUpdateAsync`, a default interface member that allows so an implementation written
   earlier keeps compiling, `:56-59`; the per-update loop at `GuardrailChatClient.cs:99-116`), with
   the first block throwing `ChatGuardrailException`. `Ai:RequireGuardrail` defaults to true
   (`AiSettings.cs:110`), and an enabled host that registered neither a guardrail nor a redactor is
   refused at registration with the one-line fix in the message
   (`DependencyInjection.cs:208-217`, both refusals in `RefuseAnUngovernedHost` at `:202`). That fix
   is the one content policy the framework does ship: `PiiRedactionGuardrail`
   (`Guardrails/PiiRedactionGuardrail.cs:39`) removes email addresses and North American phone
   numbers from every outgoing message (`:70-80`, `:110-111`), leaves the application's own
   `Instructions` alone (`:34-37`), and is registered as one singleton under both contracts by
   `AddPiiRedactionGuardrail()` (`Guardrails/GuardrailServiceCollectionExtensions.cs:32`, `:36-40`).
   Contact details are the exception that proves the rule stated in the trade-offs: they are never
   evidence for anything a model is asked, so the judgement does not change between applications.

8. **The configuration surface is one section, validated, and the switch is the registration.**
   `AiSettings` (`MMCA.Common/Source/Core/MMCA.Common.AI/AiSettings.cs:22`) binds `Ai` (`:25`) and
   carries `Enabled` (`:39`), `Provider` (`:48`), `Model` (`:58`), `ApiKey` (`:69`), `Endpoint`
   (`:76`), `MaxOutputTokens` (`:83`, default 1024 at `:28`), `Timeout` (`:89`, default 30 seconds at
   `:31`), `AllowTools` (`:96`), `RequireGuardrail` (`:110`), `EnableCache` (`:116`) and
   `PerCallInputTokenBudget` (`:124`). `Provider`, `Model` and `ApiKey` are required only once
   `Enabled` is true (`:133-176`), so the section ships in every appsettings file. When `Ai:Enabled`
   is false **nothing is registered** (`DependencyInjection.cs:129-132`): a consumer gates on
   `GetService<IChatClient>()` being present, not on a flag it has to read, so a feature with no key
   in a given environment is off by construction.

9. **A prompt is a versioned contract, and the framework computes its identity.** `PromptContract`
   (`MMCA.Common/Source/Core/MMCA.Common.AI/PromptContract.cs:23`) is a record of name, version,
   model and system prompt whose `Hash` (`:46`) is the lowercase hex SHA-256 of those four joined,
   each with its line endings normalized to LF first, so the same prompt hashes identically on
   Windows and Linux and `core.autocrlf` cannot trip a CI gate. The hash is computed on each read
   rather than cached, because a record's copy constructor would carry a cached hash through a `with`
   expression and describe the prompt the copy came from (`:41-46`). `ToChatOptions` (`:53`) and
   `Apply` (`:62`) stamp `mmca.prompt.name`, `mmca.prompt.version` and `mmca.prompt.hash` onto the
   request (`:26`, `:29`, `:32`), which is how the identity reaches the meter and, through
   `PromptTaggingChatClient`, the trace.

10. **The evaluation harness is framework code, and the framework runs it on itself.**
    `MMCA.Common.AI.Testing` ships `ReplayChatClient`
    (`MMCA.Common/Source/Hosting/MMCA.Common.AI.Testing/ReplayChatClient.cs:17`), an offline
    `IChatClient` that answers from recordings and captures what went out (`:48-55`);
    `RecordedResponses` (`RecordedResponses.cs:20`), which reads and writes a `ChatResponse` through
    `AIJsonUtilities.DefaultOptions` (`:26-27`), the abstraction's own JSON shape and never a vendor
    wire format, so a provider swap cannot invalidate a corpus (`:9-19`); `GoldenReplayTestsBase`
    (`GoldenReplayTestsBase.cs:24`), which replays every case through the subclass's real code path
    with a fresh client per case (`:88`), collects failures rather than stopping at the first
    (`:64-70`) and fails an EMPTY corpus, because an evaluation that evaluates nothing passes forever
    (`:57-62`); and `PromptContractPinTestsBase` (`PromptContractPinTestsBase.cs:25`), whose two
    facts fail a contract with no recorded hash (`:39`) and a recorded hash that no longer matches
    (`:60`), against a pin file the subclass names (`:36`). The package takes the governed package
    and no vendor SDK (`MMCA.Common.AI.Testing.csproj:33`, reason at `:23-31`). The framework then
    subclasses both bases over a reference contract nobody deploys
    (`MMCA.Common/Tests/Core/MMCA.Common.AI.Tests/Evaluation/ReferencePrompts.cs:30`), a three-case
    corpus (`ReferenceGoldenReplayTests.cs:17`, cases at `:20`) and a pin file
    (`ReferencePromptContractTests.cs:11`, path at `:17`, the recorded hash at
    `Evaluation/Golden/prompt-versions.json:2`), so the gate and the prompt-change protocol run on
    every MMCA.Common pull request rather than only in the repos that consume them.

11. **Spend is metered once, framework-wide.** `AiUsageMeter`
    (`MMCA.Common/Source/Core/MMCA.Common.AI/Observability/AiUsageMeter.cs:20`) publishes
    `mmca.ai.input_tokens` (`:29`), `mmca.ai.output_tokens` (`:32`) and the `mmca.ai.call.duration`
    histogram (`:45`, outcomes at `:48-54`) on the meter `MMCA.Common.AI` (`:26`), each tagged
    `model`, `prompt_name`, `prompt_version` and `provider` (`:155`). `UsageRecordingChatClient`
    (`Chat/UsageRecordingChatClient.cs:38`) records the provider's own reported numbers rather than
    an estimate, on the buffered path (`:109-114`) and on the streaming path from the `UsageContent`
    item the provider delivers (`:179-190`). The `provider` tag is read from the inner client itself:
    `ResolveProviderName` (`:68`) takes `ChatClientMetadata.ProviderName` when the adapter reports
    one (`:72-76`), so a foreign client supplied through the factory overload is metered as what it
    is, and falls back to the configured name, lower-cased to match the convention the adapters use
    (`:78-80`). A usage the provider did not report records nothing: an absent number must not read
    as a zero on a spend dashboard.

## Rationale
- **These rules belong to the call, not to the feature.** An output ceiling, a timeout, a tool gate
  and a token counter are true of every model call anybody will ever write here. Shipping them as a
  package makes the second feature cheaper than the first, which is the opposite of what imitation
  produces.
- **A package that names a vendor is a package that has chosen for its consumers.** The governed
  half needs nothing from an SDK except an `IChatClient`, so holding one would pin a vendor, a wire
  format and a transitive dependency on every host, including the ones that configured a different
  provider. One factory contract and one adapter package per provider make a swap a package
  reference, a registration call and a configuration value, with nothing else in the host changing
  (`IAiProviderFactory.cs:8-13`).
- **A default is a suggestion and a bound is not.** The provider client is handed the model and the
  ceiling as its defaults (`AnthropicAiProviderFactory.cs:24-27`), and `BoundedChatClient` still
  pins and clamps per call. A governance layer that can be talked out of its limits by a caller
  argument is documentation.
- **Off by absence beats off by flag.** Registering nothing when `Ai:Enabled` is false means a
  feature cannot half-run against a missing key: the dependency is either resolvable or the code path
  does not exist. A boolean everyone has to remember to check is the version of this that fails.
- **A refusal at registration beats a finding at review.** "We shipped a model call and nothing
  inspects it" and "we turned tools on and nothing decides which" are both deployment failures now,
  with the fix in the message (`DependencyInjection.cs:198-201`). A bound nobody reaches is not a
  bound, and the tenth user is the wrong person to discover it.
- **Hashing the prompt is what makes a model dependency evaluable at all.** Recorded golden answers
  are valid for one exact combination of name, version, model and text. Deriving the identity from
  all four means an edit without a version bump still moves the hash, so the evaluation cannot be
  skipped by forgetting, which is exactly the property ADR-111's `PromptContractTests` proved worth
  having.
- **A corpus recorded in the abstraction's shape outlives the provider that produced it.** Storing
  the vendor's own envelope would tie every recorded answer to the adapter that made it, so a
  provider swap would mean re-recording the corpus and losing the regression history it exists to
  hold (`RecordedResponses.cs:9-19`). The code under test only ever sees a `ChatResponse`, so the
  recording is one too.
- **Least privilege needs a middle position.** "No tools" and "every tool the caller attached" are
  the two positions a boolean has; the rubric asks for explicit, authorized, confirmable tools
  (`ArchitectureEvaluationCriteria.md:480`). An intersection of policies plus a per-request
  confirmation for consequential tools is that middle position, and reading is recoverable where
  writing is not (`ChatToolPolicy.cs:16-22`).
- **One meter name across every app is what makes a dashboard portable.** A per-feature meter means a
  per-feature query, and the spend question is asked across services, not within one. Reading the
  `provider` tag from the client rather than from configuration keeps that dashboard honest when the
  client did not come from the configured adapter.

## Trade-offs
- **Off by absence puts a null on the consumer.** Because nothing is registered when `Ai:Enabled` is
  false, a feature resolves the client with `GetService` and holds a nullable dependency: ADC's
  registration does exactly that and its scoring service takes `IChatClient?`
  (`MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:38-46`,
  `AnthropicScoringService.cs:31`). The disabled path is a branch the consumer writes, not a flag the
  framework reads for it.
- **A provider is now two references and a name, not one.** A host has to add the adapter package
  beside the governed one and call its registration method; the governed package cannot fall back to
  a provider it was never handed. The compensation is that the failure is a boot failure naming the
  registered providers (`AiProviderValidator.cs:48-63`) rather than a missing type at compile time or
  a surprise at the first call.
- **Spend is queried under framework names, and the `provider` dimension changed value.** ADC's token
  counters report on `MMCA.Common.AI` under the framework's counter names, so the App Insights spend
  alert and any saved query key on those rather than on a per-service meter
  (`MMCA.ADC.Conference.Service/Program.cs:137-148`). Reading the tag from the client's metadata also
  moves the value from `Anthropic` to `anthropic`, which a saved query has to follow in the same
  release (`MMCA.Common/UPGRADING.md:67-69`).
- **Two defaults can now refuse a host that used to start.** `Ai:RequireGuardrail` true and
  `Ai:AllowTools` with no `IChatToolPolicy` are both startup failures, and pinning the model turns a
  `PromptContract` that disagrees with `Ai:Model` into a refused call
  (`MMCA.Common/UPGRADING.md:71-82`). That is the intended direction, and it is a breaking one.
- **The input budget is an estimate, and says so.** It reads message text plus instructions only, so
  images, tool schemas, provider-side additions and non-Latin scripts are under-counted
  (`BoundedChatClient.cs:52-58`). It is a runaway guardrail with headroom, never a billing figure.
  The authoritative numbers arrive after the call.
- **A cache hit still records usage.** `UsageRecordingChatClient` sits inside the optional response
  cache, so a hit counts what the call would have cost rather than what was billed
  (`DependencyInjection.cs:36-39`). The provider span is absent on a hit, so the two are
  distinguishable, but a spend graph read without that context over-reports.
- **The framework ships exactly one content policy, and it is the narrow one.** Contact-detail
  redaction is shipped because the judgement does not vary; delimiting untrusted input, escaping it,
  handling injection and constraining the response schema stay where ADR-111 put them, in the feature
  that knows what its input is (`IChatGuardrail.cs:9-14`). A second feature still makes those
  decisions for itself.
- **The streamed path inspects fragments, not the answer.** Per-update inspection stops a stream at
  the offending update, but the caller has already seen everything yielded before it, and a rule that
  needs the whole text has to accumulate it inside the implementation
  (`GuardrailChatClient.cs:23-30`). Buffering a streamed answer in the framework would defeat the
  reason a caller chose streaming.
- **The framework ships the evaluation harness, not the evaluation.** The replay client, the golden
  base, the pin base and the protocol are framework code; the corpus, the assertions and any
  live-judge tier remain the feature's, because only the feature knows what a good answer is. The
  framework's own reference contract proves the bases work, not that any product prompt is good.
- **Retrieval stays out of scope.** Nothing here addresses vector or hybrid search, embedding
  freshness or retrieved-content injection; the rubric's retrieval criterion
  (`ArchitectureEvaluationCriteria.md:481`) is answered by the feature that builds one, if one ever
  is.
- **An optional package nobody installs governs nothing.** Store and Helpdesk adopt none of this until
  a feature of theirs calls a model, which is the correct answer and also means the rules are proven
  by exactly one consumer for now.

## Consequences
- **ADC's `AnthropicScoringService` runs on `IChatClient`** (`AnthropicScoringService.cs:30-33`). The
  port `IAiScoringService` stays, `PromptVersion` stays and keeps being persisted with every score,
  and the two-tier evaluation gate stays. The module holds no hand-written provider request, no
  free-standing model or ceiling literal and no per-service meter.
- **Upgrading across this release is a mapped change, not a silent one.**
  `MMCA.Common/UPGRADING.md:37-86` carries the old-to-new table (the removed `AiProvider` enum, the
  `string? configuredProvider` constructor, the factory), the four mechanical steps for a host on the
  Anthropic provider, the `provider` tag casing change and the two new defaults.
- **ADC adopts the adapter package, the shipped guardrail and the harness in the consumer sweep that
  follows the release.** Today the Conference module references `MMCA.Common.AI` alone
  (`MMCA.ADC.Conference.Infrastructure.csproj:19`) and its host calls `AddMmcaChatClient` with no
  provider adapter and no guardrail registered (`MMCA.ADC.Conference.Service/Program.cs:135`), which
  is exactly what the sweep changes: the adapter reference plus `AddAnthropicAiProvider()`,
  `AddPiiRedactionGuardrail()` in place of the in-class redaction, and its golden suite on the
  shipped bases. None of that has landed in ADC.
- **Store and Helpdesk adopt nothing.** Section 16 remains N/A for both until a product feature of
  theirs calls a model.
- **Section 16 has been re-scored for ADC, at M4/I9.** Token usage, model id and prompt version
  reach telemetry through one shared source, and the per-call ceiling is configuration rather than
  a literal in a request body, so the thirty-second scorecard cycle (2026-09-16) scored those
  criteria against the framework pipeline and raised Implementation from 8 to 9
  (`Website/docs-src/governance/adc-ArchitectureScorecard.md:68`; the M2/I5 entry value of
  2026-09-04 is recorded at `:96`). One of the three reasons the cycle names for holding at 9 rather
  than 10 belongs to this package: `GuardrailChatClient` is composed only when a host registers an
  `IChatGuardrail`, and ADC registers none. The framework side of that deduction is answered by the
  shipped `PiiRedactionGuardrail` and the `Ai:RequireGuardrail` default; the ADC side is answered by
  the adoption sweep, and the next cycle scores it then.

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
[ADR-016](016-lockstep-versioning-masstransit-pin.md) (the lockstep release the package and its
adapters ship in and the consumer bump that carries ADC onto them).
