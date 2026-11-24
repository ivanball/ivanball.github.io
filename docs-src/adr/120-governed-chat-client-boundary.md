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

Revised 2026-09-21 (MMCA.Common v1.208.0): the framework ships a second content
policy, `ContentPolicyGuardrail`, bound from `Ai:ContentPolicy`: it redacts, blocks or ignores eight
built-in prompt-injection markers in user-role content according to `InjectionMode` (`Redact` by
default) plus any request pattern the host adds, and it refuses an answer matching a configured
blocked-response pattern, both on the buffered response and on each streamed update.
`AddContentPolicyGuardrail(configuration)` validates every configured pattern at startup and
registers one singleton under both `IChatGuardrail` and `IChatRequestRedactor`, so registering it
satisfies `Ai:RequireGuardrail` on its own (released in v1.208.0).

Revised 2026-10-01: the current-state sections match the code (ADC's full adoption, the v1.213.0
hardening, refreshed citations).

Revised 2026-10-06: the Anthropic SDK pin reads 12.53.0, and every live-section anchor is re-verified
against current source.

Revised 2026-10-07: `PiiRedactionGuardrail` also redacts tool results and tool-call arguments that
arrive as `JsonElement` values (since v1.232.0), and its anchors and the CHANGELOG release anchors
are refreshed.

Revised 2026-10-21: `PiiRedactionGuardrail` passes signed reasoning and items with nothing to
redact through unchanged, and a rebuilt item keeps its metadata (still not `RawRepresentation`)
(since v1.247.0), and the package pins and anchors are refreshed.

Revised 2026-10-26: the Anthropic SDK pin is 13.3.0, ADC's section 16 score reads M4/I9 as the
scorecard does, `ContentPolicyGuardrail` keeps item metadata like the PII policy and both guardrails keep
`CreatedAt` (since v1.261.0), the type-level fitness rule's namespace root is stated, and anchors are refreshed.
Revised 2026-10-28: anchors refreshed after MMCA.Common v1.265.1.
Revised 2026-11-23: the two `Microsoft.Extensions.AI` pins follow the framework and the vendor pins
are current, an enabled host's `Ai:Endpoint` must be https outside Development (v1.313.0; absolute
since v1.207.0), the Trade-offs list every startup refusal an enabled host can meet, a disabled host
still gets the bound settings (with the provider and endpoint checks skipped) and only the
`IChatClient` is absent, and anchors are refreshed.

## Context
Rubric section 16, AI-Native Application Architecture, asks one question of a product feature that
calls a language model: is that dependency governed like any other external system, meaning
isolated, versioned, evaluated, observed and bounded in what it may do
(`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:469`, intent at `:471`, the seven
criteria at `:476-482`). The category is N/A until a feature calls a model and is scored the moment
one does (`:473`).

Exactly one feature does. ADC's organizer-facing session scoring takes a constructor-injected
`IChatClient` and `PromptContract`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/SessionScoringService.cs:47-50`),
and [ADR-111](111-ai-session-scoring-governance.md) records the governance it grew: a port in
Application, a pinned model, a dated prompt version, a golden-replay evaluation gate that hashes the
rendered prompt per version, delimited and redacted input, a schema-constrained response, and a
budgeted spend alert. What the module owns is what only session scoring knows: the prompt text, the
redaction rules and the response schema. What it does not own is the call. The model id (`:64`) is
folded into the prompt contract (`:93-94`), the 256-token output ceiling is one named constant
(`:71`) set on the request (`:116`) and clamped again by `Ai:MaxOutputTokens` at the framework
boundary, `ModelId` (`:74`) and `PromptVersion` (`:85`) read through the injected contract rather
than standing as independent literals, nothing in the module constructs an `HttpClient` for Anthropic
(`MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:41-55`), and Infrastructure is the only
layer that names the package (`MMCA.ADC.Conference.Infrastructure.csproj:19`, reason at `:15-18`).
Token counters come off the framework meter `MMCA.Common.AI` rather than a meter named for the
feature (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:254`, meter registration
at `:273-274`). That division is the whole point of this record: ADR-111 names the alternative in
its own trade-offs, where one feature, one provider and one model leave no general model-calling
abstraction, so a second AI feature inherits the conventions by imitation rather than by
construction. ADC scored M2/I5 on section 16 in the 2026-09-04 cycle, before the package existed,
and scores M4/I9 on it now (`Website/docs-src/governance/adc-ArchitectureScorecard.md:80`); Store
and Helpdesk have no feature that calls a model, so the category is N/A for them.

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
   one runtime package: `Microsoft.Extensions.AI` (`:30`), pinned per framework through
   `$(MmcaExtensionsVersion)` (`MMCA.Common/Directory.Packages.props:163`: 10.11.1 on net10.0 at
   `:53`, 11.0.1 on net11.0 at `:65`). The csproj states the reason in place
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
   official Anthropic SDK (`MMCA.Common.AI.Anthropic.csproj:13`, pinned at 13.12.0,
   `Directory.Packages.props:170`), and `MMCA.Common.AI.OpenAI` (`OpenAiProviderFactory.cs:18`, name
   at `:21`, `GetChatClient(model).AsIChatClient()` at `:49-51`, `AddOpenAiProvider()` at
   `DependencyInjection.cs:26`) over `Microsoft.Extensions.AI.OpenAI` and the official OpenAI SDK
   (`MMCA.Common.AI.OpenAI.csproj:13-14`; `Microsoft.Extensions.AI.OpenAI` on
   `$(MmcaExtensionsVersion)` and `OpenAI` at 2.15.0, `Directory.Packages.props:175-176`).
   `Ai:Provider` is a plain string (`AiSettings.cs:56`) matched case-insensitively against the
   registered factory names (`Providers/AiProviderValidator.cs:41-42`), and
   `CreateProviderChatClient` (`DependencyInjection.cs:241`) matches the factory and asks it to build
   the client (`:246-249`). A name with no factory behind it is refused at boot, not on a user's first request:
   `AiProviderValidator` (`AiProviderValidator.cs:16`) is an `IValidateOptions<AiSettings>` the
   configuration overload registers (`DependencyInjection.cs:94`) and `ValidateOnStart` runs
   (`:128`), with the registered names, or the adapter packages when there are none, in the message
   (`AiProviderValidator.cs:48-63`). `Ai:Endpoint` (`AiSettings.cs:85`) routes either adapter through
   an AI gateway, a regional endpoint or a compatible server (`AnthropicAiProviderFactory.cs:43-46`,
   `OpenAiProviderFactory.cs:44-47`). Because every call carries `Ai:ApiKey` in its headers, an
   enabled host's endpoint must be an absolute URI and must be https outside Development, or options
   validation fails at startup (`ValidateEndpoint` at `AiSettings.cs:209-229`, called at `:183`); the
   Development answer comes from the host environment, stamped onto the settings by a
   `PostConfigure` (`DependencyInjection.cs:125-126`) and failing closed (`AiSettings.cs:236-239`).

3. **The dependency direction is build-gated in both directions.** `EnforceAiLayerBoundary`
   (`MMCA.Common/Source/Build/MMCA.Common.LayerEnforcement.targets:86`) runs for `MMCA.Common.AI` and
   for every `MMCA.Common.AI.*` project (`:88`), so the adapters and the testing package inherit the
   rule, and fails the build if any of them takes a `ProjectReference` on Domain, Application,
   Infrastructure, API, Grpc or UI (`:90-99`). The other direction is a runtime fitness function:
   `AiDependencyIsolationTestsBase`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/AiDependencyIsolationTestsBase.cs:19`)
   asserts that no layer outside a `*.Infrastructure` assembly or the boundary itself names
   `Anthropic`, `Microsoft.Extensions.AI`, `OpenAI` or `Azure.AI`
   (`Rules/Layering/ArchitectureRules.Ai.cs:38-44`, rule at `:50`), and that nothing outside
   Infrastructure references the governed package at all (`:75`, check at `:83`). The boundary
   assembly is classified by name with the `MMCA.Common.AI.` prefix (`:19`, classification at
   `:99-107`), which is what admits the adapter packages and `MMCA.Common.AI.Testing` to it; the
   type-level rule matches the undotted namespace root `MMCA.Common.AI` (`:25`), because NetArchTest
   matches whole namespace segments and an entry ending in a dot would match nothing (`:13-14`). A prompt or a
   bound must not become a type Domain or Application depends on.

4. **Governance is a pipeline of delegating clients, ordered outermost first.**
   `AddMmcaChatClient(IConfiguration)` (`DependencyInjection.cs:88`) builds `BoundedChatClient` ->
   optional `GuardrailChatClient` (present only when the host registers at least one
   `IChatGuardrail` or one `IChatRequestRedactor`) -> `UsageRecordingChatClient` -> optional
   `DistributedCache` -> `OpenTelemetry` -> `PromptTagging` -> `Logging` -> the provider client
   (registration at `:149-186`, order documented at `:22-41`). Bounds are outermost so a call the
   configuration forbids is refused before it is inspected, logged, cached or counted, and a
   guardrail block is refused before it is counted. `PromptTaggingChatClient`
   (`Chat/PromptTaggingChatClient.cs:21`) is composed just inside the OpenTelemetry layer
   (`DependencyInjection.cs:185`) so the activity it decorates is that layer's own `gen_ai` span: it
   copies `mmca.prompt.name`, `mmca.prompt.version` and `mmca.prompt.hash` onto it (`:63`) and only
   ever onto an activity from the framework's own source (`:56-57`), so a host with no listener gets
   no stray tags. Telemetry rides the same name as the meter (`DependencyInjection.cs:183`), and
   prompt and completion text reach traces only on a host positively identified as Development
   (`:179`, gate at `:264-268`), which fails closed.

5. **What a call may do is configuration, and the outermost client enforces it.** `BoundedChatClient`
   (`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/BoundedChatClient.cs:65`) clamps `MaxOutputTokens`
   down to `Ai:MaxOutputTokens` while leaving a smaller caller number alone (`:197-199`), sends every
   request out naming `Ai:Model` and refuses one that names a different model (`:215-230`, the
   refusal at `:217-224`), runs every call under a token linked to the caller's own and cancelled
   after `Ai:Timeout` (`:280-285`, the streaming path covered for the whole stream at `:138-145`),
   and refuses a request whose ESTIMATED input exceeds `Ai:PerCallInputTokenBudget` before it reaches
   the provider (`:287-302`). The estimate asks the pipeline for an `IAiTokenEstimator`
   (`Chat/IAiTokenEstimator.cs:14`) and otherwise counts four characters to the token
   (`BoundedChatClient.cs:178`). Caller options are cloned, never mutated (`:195`). Pinning the model
   here is what makes `PromptContract.Model` mean the same thing on an adapter that honors a
   per-request override and one that binds the model at construction
   (`OpenAiProviderFactory.cs:27-32`).

6. **Tools are off by default, and "on" means a policy said yes.** While `Ai:AllowTools` is false,
   tools and the tool mode are stripped from the request (`BoundedChatClient.cs:201-205`). While it
   is true, `FilterTools` (`:241-278`) offers a tool only when EVERY registered `IChatToolPolicy`
   (`Guardrails/IChatToolPolicy.cs:23`) returns `Allowed` (`BoundedChatClient.cs:261`), so policies
   compose by intersection and a new concern can only ever remove tools; `Denied` is the enum's zero
   value (`Guardrails/ToolAuthorization.cs:13`), so a policy that forgets to answer refuses. A tool
   that marks itself consequential (`Guardrails/ChatToolPolicy.cs:30`) clears one more bar: the
   request has to name it in the confirmed list (`:43`, read at `:78-109`, checked at
   `BoundedChatClient.cs:269`), per request and never per session. With no policy registered every
   tool is stripped (`:251-254`), so the layer fails closed, and that combination is refused at
   registration instead (`DependencyInjection.cs:221-228`).

7. **A host that inspects nothing does not start.** `GuardrailChatClient`
   (`Chat/GuardrailChatClient.cs:31`) runs every registered `IChatRequestRedactor`
   (`Guardrails/IChatRequestRedactor.cs:25`) over the materialized messages first (`:126-135`), and
   the redacted list is what the guardrails inspect and what the provider is sent (`:68`, `:95`).
   Then every `IChatGuardrail` (`Chat/IChatGuardrail.cs:21`) inspects the request (`:28`), the
   buffered response (`:38`) and, on the streamed path, each update BEFORE it is yielded
   (`InspectStreamedUpdateAsync`, a default interface member that allows so an implementation written
   earlier keeps compiling, `:57-60`; the per-update loop at `GuardrailChatClient.cs:99-116`), with
   the first block throwing `ChatGuardrailException`. `Ai:RequireGuardrail` defaults to true
   (`AiSettings.cs:122`), and an enabled host that registered no prompt-injection defense, an
   `IChatGuardrail` or `IChatRequestRedactor` whose implementation type implements the marker
   `IPromptInjectionGuardrail` (`Guardrails/IPromptInjectionGuardrail.cs:21`), is refused at
   registration with the one-line fix in the message (`DependencyInjection.cs:144-146`, the
   descriptor test at `:253`, both refusals in `RefuseAnUngovernedHost` at `:210`). The framework
   ships two content policies. The first,
   `PiiRedactionGuardrail` (`Guardrails/PiiRedactionGuardrail.cs:40`), removes email addresses and
   North American phone numbers from every outgoing message, including reasoning text, tool results
   and the arguments of tool calls (`:71-81`, `:123-157`, `RedactText` at `:192`), whether those
   arrive as strings or as `JsonElement` values, where only string values are rewritten and property
   names, numbers and booleans are copied as they are (`:159-164`, `RedactJson` at `:200`,
   `WriteRedacted` at `:212-244`). Two kinds of item pass through unchanged: a reasoning block that
   carries `ProtectedData` (a signed thinking block) is never rebuilt, because an edited signed
   block is rejected when the conversation is sent back (`:118-120`, `:125`), and an item with
   nothing to redact passes through by reference (`:109`, `:156`). A rebuilt item keeps
   `AdditionalProperties`, `Annotations` and a tool item's `InformationalOnly` and `Exception`
   (`:136`, `:148-149`), copied by the internal helper both shipped policies share
   (`Guardrails/ContentMetadata.cs:22`), but not `RawRepresentation`, the provider's original
   object, which still holds the unredacted text (`:112-115`, `ContentMetadata.cs:13-16`). It
   leaves the application's own `Instructions` alone (`:35-37`), and is registered as one singleton
   under both contracts by `AddPiiRedactionGuardrail()`
   (`Guardrails/GuardrailServiceCollectionExtensions.cs:33`, `:37-41`).
   Contact details are one of the two judgements the framework is willing to make for every
   application: they are never evidence for anything a model is asked, so the judgement does not
   change between applications.

   The second is prompt injection. `ContentPolicyGuardrail` (`Guardrails/ContentPolicyGuardrail.cs:64`)
   is one type under both contracts: as an `IChatRequestRedactor` it rewrites user-role content, as an
   `IChatGuardrail` it inspects the request, the buffered response and each streamed update. It binds
   `Ai:ContentPolicy` (`Guardrails/ContentPolicySettings.cs:26`). `InjectionMode`
   (`ContentPolicySettings.cs:35`) picks one of three answers to a marker in user-role content:
   `Redact` (the default, `Guardrails/ContentPolicyInjectionMode.cs:23`) replaces the match with
   `RedactionPlaceholder` (`[redacted-instruction]` unless configured, `ContentPolicySettings.cs:70`)
   and lets the call proceed, `Block` (`ContentPolicyInjectionMode.cs:29`) leaves the text alone and
   refuses the call naming the marker, `Off` (`:35`) does neither. The eight built-in markers are code
   rather than configuration (`ContentPolicyGuardrail.cs:77-87`): `ignore-previous-instructions`,
   `disregard-system-prompt`, `role-reassignment`, `new-instructions`, `reveal-system-prompt`,
   `act-as-unrestricted`, `developer-mode` and `do-anything-now`. `AdditionalRequestPatterns`
   (`ContentPolicySettings.cs:45`) merges an application's own regular expressions into that list, and
   `BlockedResponsePatterns` (`:57`) is the other half: inspected on the buffered response
   (`ContentPolicyGuardrail.cs:167`) and on each streamed update (`:184`), refusing by pattern index
   and never echoing the text that matched (`:270`, `:283`). Only user-role messages are ever
   rewritten, never the application's system prompt or a prior assistant turn
   (`ContentPolicyGuardrail.cs:111-138`, role filter at `:134`). Within a rewritten message an item
   with no marker passes through by reference and a rebuilt text item keeps its
   `AdditionalProperties` and `Annotations` (`:337-341`), and both policies keep
   `ChatMessage.CreatedAt` on the message they rebuild (`:356`, `PiiRedactionGuardrail.cs:97`),
   since v1.261.0 (`MMCA.Common/CHANGELOG.md:1002`, L244). A configured pattern that does not compile fails the host at
   startup rather than on a user's request (`ContentPolicySettings.cs:83`, `ValidateOnStart` at
   `Guardrails/GuardrailServiceCollectionExtensions.cs:67-70`), and
   `AddContentPolicyGuardrail(IConfiguration)` (`GuardrailServiceCollectionExtensions.cs:62`)
   registers one singleton under both interfaces (`:72-76`). It is the `IPromptInjectionGuardrail`
   the framework ships (`ContentPolicyGuardrail.cs:65`), so registering it is what satisfies
   `Ai:RequireGuardrail`; the PII policy alone does not, because it strips contact details and lets
   injected instructions through. `BlockedResponsePatterns` is empty by default
   (`ContentPolicySettings.cs:75`) by design: which responses to refuse is a domain judgement, so the
   framework ships the mechanism and each host supplies its patterns or its own response gate (the
   reason is on the type and the property, `:16`, `:61`). `PiiRedactionGuardrail` ships from
   MMCA.Common v1.207.0 and `ContentPolicyGuardrail` from v1.208.0 (`MMCA.Common/CHANGELOG.md:2310-2312`,
   `:2265-2266`).

8. **The configuration surface is one section, validated, and the switch is the registration.**
   `AiSettings` (`MMCA.Common/Source/Core/MMCA.Common.AI/AiSettings.cs:23`) binds `Ai` (`:26`) and
   carries `Enabled` (`:47`), `Provider` (`:56`), `Model` (`:66`), `ApiKey` (`:78`), `Endpoint`
   (`:85`), `MaxOutputTokens` (`:92`, default 1024 at `:29`), `Timeout` (`:98`, default 30 seconds at
   `:32`), `AllowTools` (`:105`), `RequireGuardrail` (`:119`), `EnableCache` (`:125`) and
   `PerCallInputTokenBudget` (`:133`). `Provider`, `Model` and `ApiKey` are required, and the
   `Endpoint` rules checked, only once `Enabled` is true (`:153-201`, early exit at `:155-158`), so
   the section ships in every appsettings file. When `Ai:Enabled` is false the host still gets the
   bound `AiSettings` (`DependencyInjection.cs:123-128`, and the provider validator on the
   configuration overload, `:94`, which passes a disabled host at once,
   `Providers/AiProviderValidator.cs:27-30`, so only the `[Range]` annotations at `AiSettings.cs:91`
   and `:132` still apply) but **no `IChatClient` is registered** (`:130-134`): a consumer gates on
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
    `IChatClient` that answers from recordings and captures what went out (`:50-56`);
    `RecordedResponses` (`RecordedResponses.cs:20`), which reads and writes a `ChatResponse` through
    `AIJsonUtilities.DefaultOptions` (`:26-27`), the abstraction's own JSON shape and never a vendor
    wire format, so a provider swap cannot invalidate a corpus (`:9-19`); `GoldenReplayTestsBase`
    (`GoldenReplayTestsBase.cs:24`), which replays every case through the subclass's real code path
    with a fresh client per case (`:88`), collects failures rather than stopping at the first
    (`:64-70`) and fails an EMPTY corpus, because an evaluation that evaluates nothing passes forever
    (`:104-113`); every `GoldenReplayCase` records the hash of the prompt contract it was recorded
    against (`GoldenReplayCase.cs:19`), and the base fails, naming each stale case, when that hash
    differs from the `CurrentContract` the subclass supplies (`GoldenReplayTestsBase.cs:40`, the fact
    at `:56`), so a prompt change cannot pass against recordings of the old prompt; and `PromptContractPinTestsBase` (`PromptContractPinTestsBase.cs:25`), whose two
    facts fail a contract with no recorded hash (`:39`) and a recorded hash that no longer matches
    (`:60`), against a pin file the subclass names (`:36`). The package takes the governed package
    and no vendor SDK (`MMCA.Common.AI.Testing.csproj:35`, reason at `:25-33`). The framework then
    subclasses both bases over a reference contract nobody deploys
    (`MMCA.Common/Tests/Core/MMCA.Common.AI.Tests/Evaluation/ReferencePrompts.cs:30`), a three-case
    corpus (`ReferenceGoldenReplayTests.cs:17`, cases at `:20`) and a pin file
    (`ReferencePromptContractTests.cs:11`, path at `:17`, the recorded hash at
    `Evaluation/Golden/prompt-versions.json:2`), so the gate and the prompt-change protocol run on
    every MMCA.Common pull request rather than only in the repos that consume them.

11. **Spend is metered once, framework-wide.** `AiUsageMeter`
    (`MMCA.Common/Source/Core/MMCA.Common.AI/Observability/AiUsageMeter.cs:20`) publishes
    `mmca.ai.input_tokens` (`:29`), `mmca.ai.output_tokens` (`:32`) and the `mmca.ai.call.duration`
    histogram (`:45`, outcomes at `:48-57`) on the meter `MMCA.Common.AI` (`:26`), each tagged
    `model`, `prompt_name`, `prompt_version` and `provider` (`:158-168`). `UsageRecordingChatClient`
    (`Chat/UsageRecordingChatClient.cs:38`) records the provider's own reported numbers rather than
    an estimate, on the buffered path (`:109-114`) and on the streaming path from the `UsageContent`
    item the provider delivers (`RecordUsageIn` at `:185-195`). The `provider` tag is read from the
    inner client itself: `ResolveProviderName` (`:68`) takes `ChatClientMetadata.ProviderName` when the adapter reports
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
- **Off by absence beats off by flag.** Registering no client when `Ai:Enabled` is false means a
  feature cannot half-run against a missing key: the dependency is either resolvable or the code path
  does not exist. A boolean everyone has to remember to check is the version of this that fails.
- **A refusal at registration beats a finding at review.** "We shipped a model call and nothing
  inspects it" and "we turned tools on and nothing decides which" are both deployment failures now,
  with the fix in the message (`DependencyInjection.cs:200-203`). A bound nobody reaches is not a
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
  writing is not (`ChatToolPolicy.cs:17-23`).
- **One meter name across every app is what makes a dashboard portable.** A per-feature meter means a
  per-feature query, and the spend question is asked across services, not within one. Reading the
  `provider` tag from the client rather than from configuration keeps that dashboard honest when the
  client did not come from the configured adapter.

## Trade-offs
- **Off by absence puts a null on the consumer.** Because no client is registered when `Ai:Enabled`
  is false, a feature resolves the client with `GetService` and holds a nullable dependency: ADC's
  registration does exactly that and its scoring service takes `IChatClient?`
  (`MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:41-55`, `GetService` at `:53`,
  `SessionScoringService.cs:48`). The disabled path is a branch the consumer writes, not a flag the
  framework reads for it.
- **A provider is now two references and a name, not one.** A host has to add the adapter package
  beside the governed one and call its registration method; the governed package cannot fall back to
  a provider it was never handed. The compensation is that the failure is a boot failure naming the
  registered providers (`AiProviderValidator.cs:48-63`) rather than a missing type at compile time or
  a surprise at the first call.
- **Spend is queried under framework names, and the `provider` dimension changed value.** ADC's token
  counters report on `MMCA.Common.AI` under the framework's counter names, so the App Insights spend
  alert and any saved query key on those rather than on a per-service meter
  (`MMCA.ADC.Conference.Service/Program.cs:273-274`). Reading the tag from the client's metadata also
  moves the value from `Anthropic` to `anthropic`, which a saved query has to follow in the same
  release (`MMCA.Common/UPGRADING.md:1923-1925`).
- **An enabled host is refused at startup, not on a first request.** Options validation fails a blank
  `Ai:Provider`, `Ai:Model` or `Ai:ApiKey` (`AiSettings.cs:160-181`), a `Timeout` at or below zero or
  above the one-hour cap (`:188-200`, cap at `:39`), a provider name no factory matches
  (`Providers/AiProviderValidator.cs:32-34`), and an `Ai:Endpoint` that is relative (since v1.207.0)
  or, outside Development, not https (`AiSettings.cs:209-229`; the https rule is a breaking change of
  v1.313.0, `MMCA.Common/CHANGELOG.md:64`, `MMCA.Common/UPGRADING.md:73`). `Ai:RequireGuardrail` true
  and `Ai:AllowTools` with no `IChatToolPolicy` are both registration failures, and a content-policy
  pattern that does not compile fails the host too (Decision item 7). Pinning the model refuses per
  call instead: a `PromptContract` that disagrees with `Ai:Model` becomes a refused call
  (`MMCA.Common/UPGRADING.md:1927-1938`). That is the intended direction, and each default that can
  refuse was a breaking one.
- **The input budget is an estimate, and says so.** It reads message text plus instructions only, so
  images, tool schemas, provider-side additions and non-Latin scripts are under-counted
  (`BoundedChatClient.cs:52-58`). It is a runaway guardrail with headroom, never a billing figure.
  The authoritative numbers arrive after the call.
- **A cache hit still records usage.** `UsageRecordingChatClient` sits inside the optional response
  cache, so a hit counts what the call would have cost rather than what was billed
  (`DependencyInjection.cs:36-39`). The provider span is absent on a hit, so the two are
  distinguishable, but a spend graph read without that context over-reports.
- **The framework ships two content policies, and both are narrow.** Contact-detail redaction
  (`PiiRedactionGuardrail.cs:40`) and the injection and blocked-response policy
  (`ContentPolicyGuardrail.cs:64`) are shipped because neither judgement varies by application: a
  phone number is never evidence for anything a model is asked, and an imperative aimed at the model
  is never the input's own argument. The built-in marker list stays deliberately small (eight
  phrases, `ContentPolicyGuardrail.cs:77-87`) so ordinary prose about instructions or an initial
  prompt survives it (`ContentPolicyGuardrailTests.cs:37`); a list broad enough to catch every
  phrasing would redact the evidence it was protecting. Everything that depends on what the input IS
  stays where ADR-111 put it, in the feature that knows: delimiting untrusted input, escaping it,
  constraining the response schema, and any domain-specific check (`IChatGuardrail.cs:9-14`). A
  second feature still makes those decisions for itself, and an application with a stricter idea of
  its own content adds `Ai:ContentPolicy:AdditionalRequestPatterns` (`ContentPolicySettings.cs:45`)
  or registers a guardrail of its own.
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
- **ADC's `SessionScoringService` runs on `IChatClient`** (`SessionScoringService.cs:47-50`). The
  port `IAiScoringService` stays, `PromptVersion` stays and keeps being persisted with every score,
  and the two-tier evaluation gate stays. The module holds no hand-written provider request, no
  free-standing model literal and no per-service meter; its output ceiling is one named constant
  (`:71`) that `Ai:MaxOutputTokens` clamps again.
- **Upgrading across this release is a mapped change, not a silent one.**
  `MMCA.Common/UPGRADING.md:1893-1942` carries the old-to-new table (`:1916-1921`) (the removed `AiProvider` enum, the
  `string? configuredProvider` constructor, the factory), the four mechanical steps for a host on the
  Anthropic provider, the `provider` tag casing change and the three new default bounds.
- **ADC runs on the adapter package, the shipped guardrails and the harness.** The Conference module
  references `MMCA.Common.AI` alone (`MMCA.ADC.Conference.Infrastructure.csproj:19`); the host
  references the adapter (`MMCA.ADC.Conference.Service.csproj:33`) and calls
  `AddAnthropicAiProvider()` (`MMCA.ADC.Conference.Service/Program.cs:240`),
  `AddConferenceAiGuardrails(configuration)` (`:252`) and `AddMmcaChatClient` (`:254`).
  `AddConferenceAiGuardrails` (`MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:90`)
  registers `AddPiiRedactionGuardrail()` (`:100`), `AddContentPolicyGuardrail(configuration)` (`:101`)
  and the module's own `SessionScoreResponseGuardrail` (`:104`). The golden suite runs on the shipped
  bases (`GoldenReplayTests.cs:35`, `PromptContractTests.cs:180`).
- **Store and Helpdesk adopt nothing.** Section 16 remains N/A for both until a product feature of
  theirs calls a model.
- **Section 16 scores M4/I9 for ADC.** Token usage, model id and prompt version reach telemetry
  through one shared source, the per-call ceiling is clamped by configuration at the framework
  boundary, and `GuardrailChatClient` is composed because `AddConferenceAiGuardrails` registers three
  guardrails (`Website/docs-src/governance/adc-ArchitectureScorecard.md:80`). The framework side of
  that is the shipped `PiiRedactionGuardrail`, `ContentPolicyGuardrail` and the
  `Ai:RequireGuardrail` default; the ADC side is the registration above.

## Revision (2026-10-01)
No decision or rationale changed; the current-state sections now match the code. ADC adopted the
package fully: the host calls `AddAnthropicAiProvider()`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:140`) and
`AddConferenceAiGuardrails` (`:151`), which registers the PII and content policies plus a module
response guardrail (`MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:95-99`), and section
16 reads M4/I10 (`Website/docs-src/governance/adc-ArchitectureScorecard.md:80`). Both content
policies are released, in v1.207.0 and v1.208.0 (`MMCA.Common/CHANGELOG.md:402`, `:381`). Three
v1.213.0 changes harden the boundary without changing it: `PiiRedactionGuardrail` also redacts
reasoning text, string tool results and string tool-call arguments (`PiiRedactionGuardrail.cs:105-123`,
`CHANGELOG.md:165`), a consequential-tool marker in an unrecognised shape reads as consequential
(`ChatToolPolicy.cs:49`, `CHANGELOG.md:164`), and `Ai:Timeout` is capped at one hour
(`AiSettings.cs:38`, validated at `:184-189`). The scorer is now `SessionScoringService`, and its
256-token ceiling is a module constant (`SessionScoringService.cs:70`, set on the request at `:115`)
rather than a field of the prompt contract (`PromptContract.cs:23`). Refreshed citations: the ADC
scorer, registration and host lines, `AiSettings`, `ChatToolPolicy`,
`GuardrailServiceCollectionExtensions`, `ContentPolicyGuardrail` (markers at `:77-87`),
`ReplayChatClient`, the `[1.207.0]` block of `MMCA.Common/UPGRADING.md` (`:200-248`) and the
Anthropic SDK pin (12.52.0).

## Revision (2026-10-06)
- The official Anthropic SDK pin is 12.53.0 (`MMCA.Common/Directory.Packages.props:111`), not 12.52.0;
  decision item 2 now also states the OpenAI adapter's pins (`Microsoft.Extensions.AI.OpenAI` 10.10.1
  and `OpenAI` 2.14.0, `:116-117`). No decision, rationale or trade-off changed.
- The PII and content-policy release entries now point at the specific CHANGELOG lines
  (`MMCA.Common/CHANGELOG.md:773`, `:727`); the v1.213.0 hardening recorded in the 2026-10-01
  revision sits at `CHANGELOG.md:505`, `:506` and `:516`, and the PII content switch at
  `PiiRedactionGuardrail.cs:109-128`.
- Anchors re-verified against current source: the `Directory.Packages.props` pins,
  `BoundedChatClient`, `IChatGuardrail`, `PiiRedactionGuardrail`, `MMCA.Common.AI.Testing.csproj`,
  the `[1.207.0]` block of `MMCA.Common/UPGRADING.md` (`:471-520`), ADC's `SessionScoringService`
  and the Conference host's `Program.cs`.

## Revision (2026-10-07)
Re-verified against current source. No decision, rationale or trade-off changed in direction; the
PII policy's scope grew and the release anchors moved when the v1.233.0 and v1.232.1 CHANGELOG
blocks landed above them.

1. Decision item 7 now states that `PiiRedactionGuardrail` redacts tool results and tool-call
   arguments that arrive as `JsonElement` values as well as strings, rewriting only string values
   (`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/PiiRedactionGuardrail.cs:112`, `:129-134`,
   `RedactJson` at `:144`), released in v1.232.0 (`MMCA.Common/CHANGELOG.md:46`, M195).
2. Anchors re-verified against current source: `PiiRedactionGuardrail` (class at `:40`, also in
   the Trade-offs, patterns at `:71-81`, content switch at `:108-127`, `RedactText` at `:136-137`,
   the `Instructions` remark at `:35-37`), and the release entries for `PiiRedactionGuardrail` and
   `ContentPolicyGuardrail` (`MMCA.Common/CHANGELOG.md:798`, `:752`). The v1.213.0 hardening the
   2026-10-01 revision records now sits at `CHANGELOG.md:530`, `:531` and `:541`; the earlier
   revisions keep their anchors as written.

## Revision (2026-10-21)
Re-verified against current source. No decision, rationale or trade-off changed in direction; the
PII policy gained two pass-through cases and metadata preservation in v1.247.0, three package
pins moved, and the release and UPGRADING anchors moved as later blocks landed above them.

1. Decision item 7 now states that `PiiRedactionGuardrail` passes a reasoning block carrying
   `ProtectedData` through unredacted and an item with nothing to redact through by reference, and
   that a rebuilt item keeps `AdditionalProperties`, `Annotations`, `InformationalOnly` and
   `Exception` but not `RawRepresentation`
   (`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/PiiRedactionGuardrail.cs:124`, `:108-119`,
   `:155`, `:162-168`), released in v1.247.0 (`MMCA.Common/CHANGELOG.md:113`, M239). A rebuilt
   item carried no `RawRepresentation` before v1.247.0 either; that release added the
   pass-through cases and the metadata copy.
2. Decision items 1 and 2 state the current pins: `Microsoft.Extensions.AI` 10.11.0, the Anthropic
   SDK 12.60.0 and `Microsoft.Extensions.AI.OpenAI` 10.11.0, with `OpenAI` unchanged at 2.14.0
   (`MMCA.Common/Directory.Packages.props:104`, `:111`, `:116`, `:117`).
3. Anchors re-verified against current source: `PiiRedactionGuardrail` (content switch at
   `:122-156`, `RedactArgument` at `:170-174`, the JSON checks at `:177-199`, `RedactText` at
   `:203`, `RedactJson` at `:211`, `WriteRedacted` at `:223-255`), `ContentPolicySettings` (`RedactionPlaceholder` at `:70`,
   `Validate` at `:83`), `AiUsageMeter` (outcomes at `:48-57`, `AttributionTags` at `:158-168`),
   the release entries for `PiiRedactionGuardrail` and `ContentPolicyGuardrail`
   (`MMCA.Common/CHANGELOG.md:1117`, `:1071`), and the `[1.207.0]` block of
   `MMCA.Common/UPGRADING.md` (`:887-936`, casing note at `:917-919`, defaults at `:921-932`). The
   earlier revisions keep their anchors as written.

## Revision (2026-10-26)
Re-verified against current source. No decision, rationale or trade-off changed in direction; the
Anthropic SDK took a major-version bump, the content policy gained the PII policy's item fidelity
in v1.261.0, the live sections' section 16 score is corrected, and many anchors moved.

1. Decision item 2 states the Anthropic SDK pin as 13.3.0
   (`MMCA.Common/Directory.Packages.props:112`); the adapter's construction is unchanged
   (`MMCA.Common/Source/Core/MMCA.Common.AI.Anthropic/AnthropicAiProviderFactory.cs:48`).
2. The Context and Consequences state ADC's section 16 score as M4/I9, which is what the scorecard
   row carries (`Website/docs-src/governance/adc-ArchitectureScorecard.md:80`) and what the
   2026-09-19 Status sentence already said; they read M4/I10.
3. Decision item 7 states that `ContentPolicyGuardrail` passes a user content item with no marker
   through by reference, keeps `AdditionalProperties` and `Annotations` on a rebuilt text item,
   and that both shipped policies keep `ChatMessage.CreatedAt`
   (`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ContentPolicyGuardrail.cs:337-341`, `:356`,
   `PiiRedactionGuardrail.cs:97`), released in v1.261.0 (`MMCA.Common/CHANGELOG.md:22`, L244). The
   metadata copy now lives in one internal helper both policies call
   (`Guardrails/ContentMetadata.cs:22`, `RawRepresentation` still not copied, `:13-16`).
4. Decision item 3 states that the type-level rule matches the undotted namespace root
   `MMCA.Common.AI` while assembly classification keeps the dotted prefix
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Layering/ArchitectureRules.Ai.cs:19`,
   `:25`, reason at `:10-18`).
5. Anchors re-verified against current source: `Directory.Packages.props` (`:105`, `:112`,
   `:117-118`), `ArchitectureRules.Ai.cs` (SDK list at `:38-44`, rules at `:50` and `:75`,
   classification at `:99-107`), `ChatToolPolicy` (confirmed-tools key at `:43`, read at
   `:78-109`), `PiiRedactionGuardrail` (content switch at `:123-157`, `RedactArgument` at
   `:159-164`, `RedactText` at `:192`, `RedactJson` at `:200`, `WriteRedacted` at `:212-244`),
   `ContentPolicyGuardrail` (`InspectResponseAsync` at `:167`, `InspectStreamedUpdateAsync` at
   `:184`, `InspectAnswerText` at `:270`, user-role rewrite at `:111-138`),
   `UsageRecordingChatClient` (`RecordUsageIn` at `:185-195`), ADC's Conference host
   (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:147`, `:158`, `:160`,
   `:179-180`), the release entries for `PiiRedactionGuardrail` and `ContentPolicyGuardrail`
   (`MMCA.Common/CHANGELOG.md:1332`, `:1286`), and the `[1.207.0]` block of
   `MMCA.Common/UPGRADING.md` (`:1115-1164`, casing note at `:1145-1147`, defaults at
   `:1149-1160`). The earlier revisions keep their anchors as written.

## Revision (2026-10-28)
Re-verified against current source. No decision, rationale or trade-off changed; the release
dating of both guardrails and of the v1.261.0 metadata fix is unchanged, and only their CHANGELOG
anchors moved as the v1.264.0, v1.265.0 and v1.265.1 blocks landed above them.

1. Anchors re-verified against current source: in Decision item 7 the v1.261.0 entry that keeps
   `ChatMessage.CreatedAt` on a rebuilt message (L244) is at `MMCA.Common/CHANGELOG.md:65` (the
   `[1.261.0]` block starts at `:50`), the `PiiRedactionGuardrail` release entry at `:1375` (the
   `[1.207.0]` block starts at `:1345`) and the `ContentPolicyGuardrail` release entry at `:1329`
   (the `[1.208.0]` block starts at `:1324`). The earlier revisions keep their anchors as written.

## Revision (2026-11-23)
Re-verified against current source. No decision changed in direction; the pipeline, the refusals,
the guardrails and ADC's wiring are unchanged. Package pins moved, v1.313.0 added an https endpoint
rule the live sections did not state, the disabled-path wording overstated what is skipped, and most
anchors moved.

1. Decision items 1 and 2 state the current pins: `Microsoft.Extensions.AI` and
   `Microsoft.Extensions.AI.OpenAI` take `$(MmcaExtensionsVersion)`, 10.11.1 on net10.0 and 11.0.1 on
   net11.0 (`MMCA.Common/Directory.Packages.props:163`, `:175`, `:53`, `:65`), the Anthropic SDK is
   13.12.0 (`:170`) and `OpenAI` 2.15.0 (`:176`), the two vendor SDKs on one pin for both frameworks.
   The extensions train and Anthropic 13.12.0 shipped in v1.315.0 (`MMCA.Common/CHANGELOG.md:18`),
   `OpenAI` 2.15.0 in v1.285.0 (`MMCA.Common/CHANGELOG.md:636`).
   `MMCA.Common.AI` still has exactly one runtime package (`MMCA.Common.AI.csproj:30`; MinVer at
   `:31` is build-only).
2. Decision item 2 and the Trade-offs state that an enabled host's `Ai:Endpoint` must be an absolute
   URI, and https outside Development, or options validation fails at startup
   (`MMCA.Common/Source/Core/MMCA.Common.AI/AiSettings.cs:209-229`, called at `:183`, skipped while
   disabled at `:155-158`), with Development read from the host environment stamped by a
   `PostConfigure` (`DependencyInjection.cs:125-126`) and failing closed (`AiSettings.cs:236-239`).
   The absolute-URI rule dates from v1.207.0; the https rule is a breaking change of v1.313.0
   (`MMCA.Common/CHANGELOG.md:64`, `MMCA.Common/UPGRADING.md:73`). The Trade-offs bullet now lists
   every startup refusal an enabled host can meet: the required `Provider`, `Model` and `ApiKey`
   (`AiSettings.cs:160-181`), the `Timeout` bounds (`:188-200`), an unmatched provider
   (`Providers/AiProviderValidator.cs:32-34`), the endpoint rules, the two registration refusals and
   an uncompilable content-policy pattern, with the pinned model kept as a per-call refusal.
3. Decision item 8, the Rationale and the Trade-offs state that a disabled host registers no
   `IChatClient` but does get the bound `AiSettings` and, on the configuration overload, the provider
   validator (`DependencyInjection.cs:94`, `:123-128`, gate at `:130-134`); both `AiSettings.Validate`
   and the provider validator return early for a disabled host (`AiSettings.cs:155-158`,
   `Providers/AiProviderValidator.cs:27-30`), so only the `[Range]` annotations (`AiSettings.cs:91`,
   `:132`) still apply. They read "nothing is registered", as the lead of the code's own remark still
   does (`DependencyInjection.cs:66`) although its body names the bound settings (`:66-67`).
4. Anchors re-verified against current source: `DependencyInjection.cs` (`ValidateOnStart` at
   `:128`, pipeline at `:149-186`, sensitive-data flag at `:179`, source name at `:183`, prompt
   tagging at `:185`, the Development gate at `:264-268`, `RefuseAnUngovernedHost` at `:204`, its
   refusals at `:210-219` and `:221-228`, `CreateProviderChatClient` at `:241`, match and build at `:246-249`,
   the Rationale remark at `:200-203`), `AiSettings` (class at `:23` through
   `PerCallInputTokenBudget` at `:133`, `Validate` at `:153-201`), the release entries for the
   v1.261.0 metadata fix, `PiiRedactionGuardrail` and `ContentPolicyGuardrail`
   (`MMCA.Common/CHANGELOG.md:1002`, `:2310-2312`, `:2265-2266`), the `[1.207.0]` block of
   `MMCA.Common/UPGRADING.md` (`:1893-1942`, table at `:1916-1921`, casing note at `:1923-1925`,
   defaults at `:1927-1938`), and ADC's wiring (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:240`,
   `:252`, `:254`, meter and source at `:273-274`; `MMCA.ADC.Conference.Service.csproj:33`; the
   Conference `DependencyInjection.cs` client registration at `:41-55`, guardrails at `:90`, `:100`,
   `:101`, `:104`). The earlier revisions keep their anchors as written.

## Revision (2026-11-24)

MMCA.Common v1.317.0 narrows `Ai:RequireGuardrail` to a prompt-injection defense: only a guardrail or
redactor whose implementation type implements `IPromptInjectionGuardrail` satisfies it, so a host whose
only guardrail is the PII redactor is refused at startup. `ContentPolicyGuardrail` implements the marker.
The empty default of `BlockedResponsePatterns` is kept and its reason is written on the settings type.
`GoldenReplayCase` gains the prompt-contract hash it was recorded against, and `GoldenReplayTestsBase`
gains the `CurrentContract` member and a fact that fails a recording made against a different contract.
Consumer changes are in `MMCA.Common/UPGRADING.md` under 1.317.0.

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
