# The LLM Is a Dependency: A Bounded, Guarded, Metered Boundary for Chat Completions

> Series: MMCA.Common · Article #50 (deep-dive) · Pillar P2/P4 · Group G28 · Rubric §16 · ADR-120, ADR-111 ·
> Status: grounded in `Website/docs-src/adr/120-governed-chat-client-boundary.md`,
> `Website/docs-src/adr/111-ai-session-scoring-governance.md`,
> `MMCA.Common/Source/Core/MMCA.Common.AI/AiSettings.cs`,
> `.../MMCA.Common.AI/PromptContract.cs`, `.../MMCA.Common.AI/DependencyInjection.cs`,
> `.../MMCA.Common.AI/Providers/AiProviderValidator.cs`, `.../Providers/IAiProviderFactory.cs`,
> `.../Chat/BoundedChatClient.cs`, `.../Chat/GuardrailChatClient.cs`,
> `.../Chat/IChatGuardrail.cs`, `.../Chat/GuardrailVerdict.cs`, `.../Chat/ChatGuardrailException.cs`,
> `.../Chat/IAiTokenEstimator.cs`, `.../Chat/UsageRecordingChatClient.cs`,
> `.../Guardrails/GuardrailServiceCollectionExtensions.cs`, `.../Guardrails/ContentPolicyGuardrail.cs`,
> `.../MMCA.Common.AI/Observability/AiUsageMeter.cs`,
> `MMCA.Common/Source/Core/MMCA.Common.AI.Anthropic/AnthropicAiProviderFactory.cs`,
> `MMCA.Common/Source/Hosting/MMCA.Common.AI.Testing/GoldenReplayTestsBase.cs`,
> `.../MMCA.Common.AI.Testing/PromptContractPinTestsBase.cs`,
> `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/AiDependencyIsolationTestsBase.cs`,
> `MMCA.Common/FACTS.md`, the §16 criteria of `Website/docs-src/governance/ArchitectureEvaluationCriteria.md`,
> and the §16 rows of `Website/docs-src/governance/common-ArchitectureScorecard.md`. No em dashes.

**Subtitle:** A chat completion is an unbounded, metered, non-deterministic call to somebody else's
server, and most codebases make it by newing up a vendor client in the middle of a feature. Here is the
same call as a governed dependency: a pipeline of delegating clients that caps what it may do, lets the
application refuse it, counts what it cost, and a fitness function that keeps all of it out of your
domain.

---

You add one AI feature. It is a single method, and the vendor SDK makes it three lines: construct the
client, hand it the prompt, read the text back. It ships on a Friday and it works.

Then ask the questions a production dependency has to answer. What is the most this call can spend in one
request? How long can it hold a request thread if the provider stops answering? Can somebody hand it a
tool and let it act? Which version of the prompt produced the answer sitting in your database? What did
last Tuesday cost, and which prompt spent it? Every one of those is a property of *calling a model*, and
none of them is a property of *your feature*. Written per feature, each is a fresh chance to forget one,
and the forgetting is invisible until a bill or an incident.

That is the argument **ADR-120** makes, and its conclusion is unglamorous: the language model is a
dependency, so govern it like one. The provider half is the vendor SDK's own adapter, in a package of its
own. The governance half is a pipeline you compose once and every future feature inherits.

## Why it matters

Rubric §16, AI-Native Application Architecture, asks exactly one question of a product feature that calls
a model: is that dependency governed like any other external system, meaning isolated, versioned,
evaluated, observed and bounded in what it may do
(`ArchitectureEvaluationCriteria.md:469`, intent at `:471`). Its seven criteria are model calls behind a
port, prompt and model versioning, an evaluation suite gating CI, guardrails at the boundary,
least-privilege tool calling, retrieval as data architecture, and LLM observability with cost
attribution (`:476-482`). Its red flags are just as concrete: provider SDK types or prompt strings inside
domain or application code, an agent that can call any tool with the caller's full permissions, and "no
idea what a feature costs per call" (`:485-489`).

The category is deliberately N/A until a product feature calls a model, and scored the moment one does
(`:473`). That applicability rule is the honest part: most systems get to skip §16, right up until the
afternoon they do not.

MMCA.Common scores it. The §16 row sits at Maturity 4 / Implementation 9 at weight 2
(`common-ArchitectureScorecard.md:80`), with §16 in both denominators and a weight total of 82
(`:104`). The row walks the seven criteria as five met, one partial and one unexercised: evaluation is
gated in CI by a golden-replay base that refuses an empty corpus, guardrails are the partial criterion,
and retrieval is the unexercised one. Maturity 4 is the build-breaking part (the prompt-contract pin, the
golden-replay gate, the registration-time guardrail refusal and the startup pattern validation all fail
the build), and Implementation 9 rather than 10 is the guardrail residuals, which you will see again in
the trade-offs.

## The MMCA answer: four optional packages, and the call is a pipeline

The AI boundary is four of the twenty-two published framework packages (`MMCA.Common/FACTS.md:19`), all
at framework v1.221.0 (`:14`): `MMCA.Common.AI`, the governed pipeline (`:22`);
`MMCA.Common.AI.Anthropic` and `MMCA.Common.AI.OpenAI`, provider adapters that each register one
`IAiProviderFactory` (`:23`, `:24`); and `MMCA.Common.AI.Testing`, the replay and golden-evaluation
harness (`:34`). All four are optional: nothing in the metapackage drags them in, and a host that never
calls a model never installs them. In the onboarding taxonomy the types sit in group **G28, Common AI
Integration**, thirty-two types across levels L0 to L10
(`Website/docs-src/onboarding/00-group-taxonomy.md:82`). That is a small surface for what it governs, and
the smallness is the design.

The composition entry point is `AddMmcaChatClient` (`DependencyInjection.cs:88`), and what it registers is
one `IChatClient` built as a pipeline, outermost first (built at `:149-184`, the same order documented as
a diagram in the type remarks at `:22-31`):

```csharp
// The shape AddMmcaChatClient composes, outermost first.
BoundedChatClient                // what the call is ALLOWED to do: tokens, timeout, tools, input size, model
  GuardrailChatClient            // optional: present when an IChatGuardrail or IChatRequestRedactor is registered
    UsageRecordingChatClient     // what the call cost, and how long it took
      DistributedCaching         // optional: Ai:EnableCache AND a registered IDistributedCache
        OpenTelemetry            // traces under the MMCA.Common.AI source
          PromptTagging          // the prompt identity as attributes on that trace
            Logging
              provider client    // whichever registered IAiProviderFactory matches Ai:Provider
```

The ordering is not decoration. Bounds are outermost, so a call the configuration forbids is refused
before anything downstream logs it, caches it or counts it. Guardrails sit inside the bounds and outside
usage recording, so a blocked request never reaches the provider and therefore has no cost to record.
Prompt tagging sits just inside the OpenTelemetry layer, so the activity it decorates is that layer's own
`gen_ai` span. The comment in the source says all of that in place (`DependencyInjection.cs:33-41`).

Two smaller decisions in the same file are worth naming. **The provider is a registered factory, never a
type this package names.** The configuration overload resolves every registered `IAiProviderFactory`
(`IAiProviderFactory.cs:20`, `Name` at `:26`, `Create` at `:34`) and selects the one whose name matches
`Ai:Provider` (`CreateProviderChatClient`, `DependencyInjection.cs:239-248`). The factories live in the
adapter packages, and each is the vendor's own adapter: `AddAnthropicAiProvider`
(`MMCA.Common.AI.Anthropic/DependencyInjection.cs:26`) registers one whose `Create` is
`new AnthropicClient(options).AsIChatClient(...)` (`AnthropicAiProviderFactory.cs:48`), and
`AddOpenAiProvider` (`MMCA.Common.AI.OpenAI/DependencyInjection.cs:26`) does the same over the OpenAI SDK
(`OpenAiProviderFactory.cs:51`). Nothing here hand-rolls a request over `HttpClient`. A provider name the
host never registered fails at boot rather than on a user's first request: `AddMmcaChatClient` registers
`AiProviderValidator` into the options pipeline (`DependencyInjection.cs:94`), which fails with the
registered names in the message (`AiProviderValidator.cs:34`), and `CreateProviderChatClient` keeps a belt
throw for a host that bypassed that pipeline (`DependencyInjection.cs:244-245`). A host with its own
credential story, or a test with no network, supplies the innermost client through the factory overload
(`:113`). And **prompt and completion text reach traces only on a host positively identified as
Development** (`enableSensitiveData` at `:177`, `IsDevelopmentHost` at `:262-266`), a check that fails
closed: an environment the package cannot see reads as not-Development (`:256-261`).

## Off by absence, not off by flag

`AiSettings` (`AiSettings.cs:22`) binds one configuration section, `Ai` (`:25`), and carries the whole
surface: `Enabled` (`:46`), `Provider` (`:55`, the name of a registered provider), `Model` (`:65`),
`ApiKey` (`:76`), `Endpoint` (`:83`), `MaxOutputTokens` (`:90`, defaulting to 1024 at `:28`), `Timeout`
(`:96`, defaulting to 30 seconds at `:31` and capped at one hour at `:38`), `AllowTools` (`:103`),
`RequireGuardrail` (`:117`, defaulting to true), `EnableCache` (`:123`) and `PerCallInputTokenBudget`
(`:131`). `Provider`, `Model` and `ApiKey` are required only once `Enabled` is true, alongside an absolute
`Endpoint` when one is set and a `Timeout` inside its range (`Validate`, `:140-190`), which is what lets
the section ship in every appsettings file rather than only in the ones that use it.

The load-bearing line is four lines long. When `Ai:Enabled` is false, **nothing is registered**
(`DependencyInjection.cs:128-132`): the settings still bind and validate, and no `IChatClient` enters the
container at all.

That pushes a null onto the consumer on purpose. A feature resolves the client with
`GetService<IChatClient>()` and holds a nullable dependency, so the disabled path is a branch the feature
writes rather than a flag the framework reads on its behalf. The payoff is that a feature with no key in
a given environment is off *by construction*: there is no half-running state where the flag says on and
the credential is missing. A boolean everybody has to remember to check is the version of this that
fails.

## Bounds: five of them, on both paths

`BoundedChatClient` (`BoundedChatClient.cs:65`) is a `DelegatingChatClient` and enforces five bounds,
each applied to the buffered and the streaming path (the list is documented on the type at `:16-50`):

1. **Output tokens.** `MaxOutputTokens` is clamped down to the configured ceiling, while a caller asking
   for less keeps its own smaller number (`:185-187`). Output tokens are the expensive half of a chat
   call, so this is a cost bound.
2. **Wall clock.** Every call runs under a token linked to the caller's own and cancelled after
   `Ai:Timeout` (`:270-275`). On the streaming path the timeout covers the whole stream rather than its
   first update (`:133-146`, with the reasoning at `:140-141`): a provider that opens a response and then
   stalls is exactly the failure a per-call budget exists to bound.
3. **Tool use.** While `Ai:AllowTools` is false, tools and the tool mode are stripped from the request
   (`:189-193`). That is the difference between telling a model not to act and being unable to hand it
   the means. While it is true, `FilterTools` (`:231-268`) offers a tool only when every registered
   `IChatToolPolicy` allows it (`:251`), and a tool marked consequential only when the request also
   confirms it by name (`:259`). The confirmation is checked on top of the policies, never instead of
   them (`:256-258`), and with no policy at all every tool is stripped (`:241-244`).
4. **Input size.** When `Ai:PerCallInputTokenBudget` is set, an estimated input above the budget fails
   the call locally instead of paying for it remotely (`:277-292`).
5. **Model.** The request goes out naming `Ai:Model`, and a request that names a different model is
   refused (`:205-220`). Adapters differ in whether a per-request model id overrides the one the client
   was built with, so pinning it here makes `PromptContract.Model` mean the same thing on every provider:
   the model the prompt was evaluated against, and the only one it may be sent to (`:43-49`).

The estimate asks the pipeline for an `IAiTokenEstimator` (`IAiTokenEstimator.cs:14`) and otherwise
counts four characters to the token (`BoundedChatClient.cs:178`), the usual rough rule for English prose.
The type documentation is blunt about what that cannot see: it reads message text plus instructions only,
so images, tool schemas, provider-side additions and non-Latin scripts are all under-counted (`:51-58`).
It is a runaway guardrail with headroom, never a billing figure. The estimator interface is declared in
the package rather than taken as a dependency on a tokenizer library, and the reason is stated in place
(`IAiTokenEstimator.cs:9-12`): a package whose whole point is keeping the model dependency small should
not acquire a second one to count characters.

One detail that costs nothing and prevents a real bug: the options a caller passes are never mutated.
Each call works on a clone (`BoundedChatClient.cs:183`), so a caller reusing one `ChatOptions` instance
across requests does not silently inherit this client's clamping.

```csharp
// Illustrative of the documented shape: the bounds BoundedChatClient applies.
private ChatOptions Bound(ChatOptions? options)
{
    var bounded = options?.Clone() ?? new ChatOptions();

    // A caller asking for more gets the ceiling; a caller asking for less keeps its number.
    bounded.MaxOutputTokens = bounded.MaxOutputTokens is { } requested
        ? Math.Min(requested, _settings.MaxOutputTokens)
        : _settings.MaxOutputTokens;

    if (!_settings.AllowTools)
    {
        bounded.Tools = null;
        bounded.ToolMode = null;
    }
    else
    {
        // Only the tools every IChatToolPolicy allows (and the caller confirmed, if consequential).
        bounded.Tools = FilterTools(bounded);
        if (bounded.Tools is null)
        {
            bounded.ToolMode = null;
        }
    }

    // The model is part of the prompt contract, not negotiated per call.
    if (_settings.Model is { } pinned)
    {
        if (bounded.ModelId is { } requestedModel && !string.Equals(requestedModel, pinned, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"The request names model '{requestedModel}' but Ai:Model pins '{pinned}'.");
        }

        bounded.ModelId = pinned;
    }

    return bounded;
}

private CancellationTokenSource CreateLinkedTimeout(CancellationToken cancellationToken)
{
    // Linked, so a caller cancelling early still wins and neither source masks the other.
    var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
    linked.CancelAfter(_settings.Timeout);
    return linked;
}

private void EnforceInputBudget(IReadOnlyList<ChatMessage> messages, ChatOptions options)
{
    if (_settings.PerCallInputTokenBudget is not { } budget)
    {
        return;
    }

    // The estimator is optional; the fallback is four characters to the token.
    var estimated = EstimateInputTokens(messages, options, this.GetService<IAiTokenEstimator>());
    if (estimated <= budget)
    {
        return;
    }

    throw new InvalidOperationException(
        $"The request's estimated input size ({estimated} tokens) exceeds Ai:PerCallInputTokenBudget "
        + $"({budget} tokens). The estimate is approximate: shorten the prompt or raise the budget deliberately.");
}
```

On the streaming path, the bound and the budget check run eagerly, outside the iterator
(`BoundedChatClient.cs:124-130`): a request the configuration forbids is refused when it is made, not when
somebody gets around to reading the stream.

## Guardrails: an extension point, two narrow policies, no domain policy

`IChatGuardrail` (`IChatGuardrail.cs:21`) has three members, each answering with a `GuardrailVerdict`:
`InspectRequestAsync` (`:28-31`), `InspectResponseAsync` (`:38-41`) and `InspectStreamedUpdateAsync`
(`:57-60`), which allows by default. Beside it sits `IChatRequestRedactor`
(`Guardrails/IChatRequestRedactor.cs:25`). An application registers one implementation per concern, and
`GuardrailChatClient` (`GuardrailChatClient.cs:31`) applies every redactor first, so what the guardrails
inspect and what the provider is sent is the redacted request (`:68`, `:126-135`, remark at `:18-20`).
Then it runs every guardrail in registration order, and the first block throws `ChatGuardrailException`
(`ChatGuardrailException.cs:12`, thrown at `GuardrailChatClient.cs:82`, `:111` and `:150`).

The framework ships the extension point, two opt-in domain-neutral guardrails and no domain policy, and
the interface documentation says why (`IChatGuardrail.cs:9-14`). `AddPiiRedactionGuardrail`
(`Guardrails/GuardrailServiceCollectionExtensions.cs:33`) registers contact-detail redaction
(`PiiRedactionGuardrail.cs:39`). `AddContentPolicyGuardrail` (`:62`) registers `ContentPolicyGuardrail`
(`ContentPolicyGuardrail.cs:64`), which matches eight built-in prompt-injection markers (`:77-87`) in
user-role content and redacts, blocks or ignores them per `InjectionMode` (`Redact` by default,
`ContentPolicySettings.cs:35`), plus any request pattern the host adds and a response-side refusal on
configured blocked patterns; one singleton serves as both a guardrail and a redactor (`ADR-120:40-47`).
Those two ship because neither judgement varies by application (`ADR-120:368-372`). What counts as an
off-topic answer or a disallowed topic depends on the data the application holds and the jurisdiction it
operates in, so a rule like that baked into a shared package would be wrong somewhere by construction.
That policy stays with the feature that knows what its input is.

Three details in that layer repay attention:

- **The verdict fails closed.** `GuardrailVerdict` is a `readonly record struct` (`GuardrailVerdict.cs:13`)
  whose `default` value reads as a block carrying `UnspecifiedReason` (`:16`), because `Allow` is an
  explicit static (`:25`) and `Block(reason)` refuses a blank reason (`:39-44`). A half-built verdict
  stops the call rather than silently admitting it.
- **The layer is absent when unused, and unused is a startup failure.** `AddMmcaChatClient` checks the
  service *descriptors*, not a resolved service, and adds `GuardrailChatClient` only when an
  `IChatGuardrail` or an `IChatRequestRedactor` is registered (`DependencyInjection.cs:139-140`,
  `:156-162`, comment at `:134-138`), so an empty-loop client never changes the type the container hands
  back. But `Ai:RequireGuardrail` defaults to true (`AiSettings.cs:117`), so an enabled host that
  registered neither throws at registration with `AddPiiRedactionGuardrail()` named as the fix
  (`DependencyInjection.cs:208-217`). A host that deliberately wants none sets the flag false, which is a
  reviewable line rather than an absence nobody can see.
- **The streaming path inspects the request and each update before it is yielded**
  (`GuardrailChatClient.cs:90-117`, the before-the-yield comment at `:101-102`). It does not inspect the
  assembled answer (remark at `:23-30`): a block stops the stream at that update, the caller has already
  seen every fragment before it, and a rule that needs the whole text accumulates it inside its own
  implementation (`IChatGuardrail.cs:51-56`).

A refusal is an exception rather than an empty response, and the reason is recorded on the exception type
(`ChatGuardrailException.cs:7-11`): an empty response is indistinguishable from the model having nothing
to say, and a caller that wants a graceful fallback catches this type specifically.

## Prompts: a versioned contract the framework hashes and gates

`PromptContract` (`PromptContract.cs:23`) is a record of four things: name, version, model and system
prompt. Its `Hash` (`:46`) is the lowercase hex SHA-256 of those four joined with a pipe, each with its
line endings normalized to LF first (`:90-103`), so the same prompt hashes identically on Windows and
Linux and `core.autocrlf` cannot trip a CI gate.

Deriving the identity from all four components is the point. Recorded golden answers are valid for one
exact combination of name, version, model and text, so an edit without a version bump still moves the
hash and the evaluation cannot be skipped by forgetting. The hash is computed on each read rather than
cached, and the remark explains the trap (`:40-45`): a record's generated copy constructor copies fields
verbatim, so a cached hash would survive a `with` expression and describe the prompt the copy was made
*from*, which is exactly the drift this type exists to prevent.

`ToChatOptions` (`:53`) and `Apply` (`:62`) stamp three properties onto the request: `mmca.prompt.name`
(`:26`), `mmca.prompt.version` (`:29`) and `mmca.prompt.hash` (`:32`). That is how the prompt's identity
reaches telemetry: `PromptContract.ReadName` (`:77`) and `ReadVersion` (`:82`) are how the metering layer
reads it back off the options a call carried, and `PromptTaggingChatClient`
(`Chat/PromptTaggingChatClient.cs:21`) puts it on the `gen_ai` span (`DependencyInjection.cs:183`).

`MMCA.Common.AI.Testing` turns that identity into two gates, and the framework runs both on its own
reference contract (`ADR-120:261`). `PromptContractPinTestsBase` (`PromptContractPinTestsBase.cs:25`) pins
every contract's hash in a JSON file, and its two facts fail on a contract with no recorded hash (`:39`)
and on a recorded hash that no longer matches its contract (`:60`). `GoldenReplayTestsBase`
(`GoldenReplayTestsBase.cs:24`) replays every case of a corpus through the real code against the answer
recorded for it, with no model, no credential and no network, so it runs on every CI leg (`:7-9`). It
collects every failing case rather than stopping at the first (`:18-20`), and an empty corpus is a failure
too (`:57-62`), because an evaluation that evaluates nothing passes forever.

## Metering: two counters, one histogram, one name

`AiUsageMeter` (`AiUsageMeter.cs:20`) publishes `mmca.ai.input_tokens` (`:29`) and
`mmca.ai.output_tokens` (`:32`) on the meter `MMCA.Common.AI` (`:26`), plus a
`mmca.ai.call.duration` histogram in seconds (`:45`). Every instrument shares four attribution
dimensions, `model`, `prompt_name`, `prompt_version` and `provider` (`AttributionTags`, `:155-165`), and
the histogram adds an `outcome` of `success`, `error` or `canceled` (`:48`, `:51`, `:54`, applied at
`:137-149`).

Those dimensions are chosen to answer the question an unexplained spend jump actually asks. A model swap
moves the per-token price; a prompt revision moves the token count. Tagging by model and by prompt version
resolves the jump to one or the other without opening a log.

One meter name across every application is what makes a dashboard portable: a per-feature meter means a
per-feature query, and the spend question is asked across services, not within one. The histogram is
deliberately not a replacement for `Microsoft.Extensions.AI`'s own
`gen_ai.client.operation.duration`, which the OpenTelemetry layer already publishes on the same meter.
The standard instrument carries the GenAI semantic-convention dimensions; this one carries the prompt
identity and the outcome, so a latency regression is attributable to the prompt that caused it and a
failure rate reads off the same series as the latency (`:36-43`).

`UsageRecordingChatClient` (`UsageRecordingChatClient.cs:38`) is what feeds it, and it records the
provider's own reported numbers rather than an estimate. The type documentation says why it sits here
rather than beside the input-budget check (`:13-15`): a bound has to be decided *before* the call, and a
cost has to be measured *after* it. The `provider` tag is the name the client reports about itself
through `ChatClientMetadata`, with the configured name lowercased as the fallback
(`ResolveProviderName`, `:68-81`). The buffered path records duration on all three outcomes and then the
usage (`:84-117`); the streaming path drives the enumerator by hand rather than with `await foreach`,
because the duration has to be attributed to an outcome and C# forbids a `yield return` inside a `try`
with a `catch` (`:129-131`), and it harvests usage from the `UsageContent` item the provider delivers on
the stream (`RecordUsageIn`, `:179-190`).

Two absences are deliberate. A usage the provider did not report records nothing (`AiUsageMeter.cs:108-123`):
an absent number must not read as a zero on a spend dashboard. And the `Meter` itself is created through
`IMeterFactory` and neither retained nor disposed (`:62-67`), because disposing a factory-owned meter
kills the instrument for every other holder of the same name.

## The layering rule that keeps all of this at one place

A governed boundary that leaks is not a boundary. There are exactly two ways this one leaks, and
`AiDependencyIsolationTestsBase` (`AiDependencyIsolationTestsBase.cs:19`) is the shared fitness function
that closes both, one `[Fact]` each:

- `LanguageModelSdks_ShouldStayAt_TheModelBoundary` (`:24-25`) asserts that no layer outside an
  Infrastructure assembly or the package itself names a vendor SDK: `Anthropic`, `OpenAI`, `Azure.AI` or
  `Microsoft.Extensions.AI` itself.
- `GovernedAiPackage_ShouldStayBehind_Infrastructure` (`:28-29`) asserts that nothing outside
  Infrastructure references `MMCA.Common.AI` at all.

The second rule is the interesting one, and the class documentation explains the failure it prevents
(`:6-13`): a module can take the framework's governed package as a convenience and start passing a
`PromptContract` around as a domain type. Either leak turns "the app calls a model at one place" into
"the model is spread through the app", and a dependency that is everywhere cannot be versioned,
evaluated, capped or swapped.

It ships the way every shared rule in this framework ships: as an abstract base subclassed in each repo's
architecture tests with that repo's architecture map (`:14-17`), one of 141 fitness test methods across 55
abstract `*TestsBase` classes, of which MMCA.Common's own build executes 339 (`MMCA.Common/FACTS.md:51`,
`:54`). A prompt or a bound must not become a type your domain depends on, and that sentence is a failing
test rather than a code review comment.

## Trade-offs, honestly

- **Guardrails are the one partial §16 criterion, and they hold the row at Implementation 9.** Both
  shipped policies are opt-in, so `Ai:RequireGuardrail` is satisfied by the PII redactor alone and a host
  can enable AI with no injection defense at all; the response half of the content policy is inert until
  a host configures patterns; and the streamed path inspects fragments, so a pattern spanning two updates
  is missed by design (`common-ArchitectureScorecard.md:80`). The framework makes "no guardrail" a
  startup failure. It does not make "the right guardrail" one.
- **Retrieval is unexercised, on purpose.** Nothing in the package addresses vector or hybrid search,
  embedding freshness or retrieved-content injection, and ADR-120 leaves the rubric's retrieval
  criterion to the feature that builds one, if one ever is (`ADR-120:390-393`). The scorecard reads it as
  unexercised rather than unmet because the criterion is worded conditionally on such a store existing
  (`common-ArchitectureScorecard.md:80`).
- **The framework ships the evaluation harness, not the evaluation.** The replay client, the golden base,
  the pin base and the protocol are framework code; the corpus, the assertions and any live-judge tier
  remain the feature's, because only the feature knows what a good answer is. The framework's own
  reference contract proves the bases work, not that any product prompt is good (`ADR-120:386-389`). The
  package governs the call. It does not make your feature evaluable for you.
- **The package governs the call and only the narrowest part of the content.** Contact-detail redaction
  and a small injection-marker list ship; delimiting untrusted input, escaping it, constraining the
  response schema and any domain-specific check stay in the feature that knows what its input is
  (`ADR-120:368-380`). The marker list is eight phrases on purpose, so ordinary prose about instructions
  survives it, which also means it catches the common phrasings rather than every phrasing.
- **Least-privilege tool calling is framework mechanism, not framework policy.** With `Ai:AllowTools`
  true, a tool reaches the model only when every `IChatToolPolicy` allows it and, if consequential, the
  request confirms it (`BoundedChatClient.cs:231-268`), and tools-on with no policy refuses to start
  (`DependencyInjection.cs:219-226`). What a policy allows is still the application's to write, and the
  rubric's "authorized per caller" (`ArchitectureEvaluationCriteria.md:480`) is only as good as that
  policy.
- **Two defaults can refuse a host at startup.** `Ai:RequireGuardrail` true and `Ai:AllowTools` with no
  policy are both registration-time failures, and the model pin turns a `PromptContract` that disagrees
  with `Ai:Model` into a refused call (`ADR-120:356-359`). That is the intended direction, and it means
  adopting the package is more than one line of registration.
- **Off by absence puts a null on the consumer.** Nothing is registered when `Ai:Enabled` is false
  (`DependencyInjection.cs:128-132`), so a feature resolves with `GetService` and holds a nullable
  dependency. That is a branch in your code, written once per feature, that the framework will not write
  for you (`ADR-120:339-344`).
- **A cache hit still records usage.** `UsageRecordingChatClient` sits inside the optional response cache
  (`DependencyInjection.cs:36-39`), so a hit counts what the call would have cost rather than what was
  billed. The provider span is absent on a hit, so the two are distinguishable, but a spend graph read
  without that context over-reports (`ADR-120:364-367`).
- **The input budget is an estimate and says so.** Message text plus instructions only, four characters
  to the token, everything else under-counted (`BoundedChatClient.cs:51-58`). Treat it as a runaway
  guardrail with headroom. The authoritative numbers arrive after the call.
- **A provider is two references and a name.** A host adds an adapter package beside the governed one,
  calls its registration method and names it in `Ai:Provider`; the governed package cannot fall back to a
  provider it was never handed (`ADR-120:345-349`). Two adapters ship (`MMCA.Common/FACTS.md:23`, `:24`),
  anything else implements `IAiProviderFactory` or goes through the factory overload
  (`DependencyInjection.cs:113`), and a misnamed provider is a boot failure naming the registered ones
  (`AiProviderValidator.cs:34`).
- **An optional package nobody installs governs nothing, and adoption here is one feature.** MMCA.ADC's
  Conference module takes the package in Infrastructure (`MMCA.ADC.Conference.Infrastructure.csproj:19`)
  and its service host takes it with the Anthropic adapter (`MMCA.ADC.Conference.Service.csproj:31`,
  `:34`). The host calls `AddAnthropicAiProvider` (`MMCA.ADC.Conference.Service/Program.cs:139`),
  `AddConferenceAiGuardrails` (`:150`), which registers the PII redactor, the content policy and the
  module's own response guardrail (`MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:85`, `:95`,
  `:96`, `:99`), and `AddMmcaChatClient` (`Program.cs:152`), then subscribes the meter and trace source by
  name (`:171-172`). Its organizer-facing session scoring (`SessionScoringService.cs:46`) is the one
  product feature in these repos that calls a model. MMCA.Store adopts none of it: §16 is N/A there
  because no product feature calls a model (`store-ArchitectureScorecard.md:57`). The rules are proven by
  exactly one consumer (`ADR-120:394-396`).

## Apply this even without MMCA

The shape ports to any stack with a DI container and a vendor SDK. `Microsoft.Extensions.AI` makes it
cheap in .NET because `IChatClient` and `DelegatingChatClient` already exist, but the pattern is older
than the abstraction.

1. **Wrap the vendor client; do not subclass your feature around it.** A delegating decorator per concern
   composes, and a decorator you did not register is a concern you deliberately skipped. Use the vendor
   SDK's own adapter onto whatever common interface your ecosystem has, keep each adapter in its own
   package behind a factory the host registers by name, validate that name at startup, and write no
   transport code of your own: the day you hand-roll the HTTP request is the day the boundary is in the
   wrong place.
2. **Put the bounds outermost, and make them configuration.** An output-token ceiling, a wall-clock
   budget, a tool switch backed by per-tool policy, an optional input ceiling and a pinned model, read
   from one validated settings section. Clamp rather than default: a governance layer a caller can talk
   out of its limits with an argument is documentation. Link your timeout token to the caller's own so
   early cancellation still wins.
3. **Turn the feature off by absence, not by flag.** Register nothing when the dependency is disabled, so
   the code path cannot half-exist against a missing key. A nullable dependency is a branch somebody
   writes once; a boolean is a check everybody has to remember.
4. **Make the prompt a versioned artifact with a computed identity, and gate it.** Name, version, model
   and text, and a hash over all four with line endings normalized first. Compute it on read, never cache
   it in a field. Stamp the name, version and hash onto the request so telemetry carries them. Pin the
   hash in a file a test checks, and replay recorded answers offline in CI with a gate that fails on an
   empty corpus. Without that, "did anybody re-evaluate this prompt" is a question about somebody's
   memory.
5. **Count the provider's numbers, not your own, and count them once.** One meter name and one set of
   counter names across every service, with the model, provider, prompt name and prompt version as
   dimensions. Record nothing when the provider reported nothing: an absent number that reads as zero is
   worse than a gap, because a gap is visible.
6. **Ship the guardrail extension point, and only the policies that never vary by application.** Let
   the application register redactors and inspectors for requests, responses and streamed updates, run
   all of them, fail closed on a default verdict, and stop on the first refusal. Make "no guardrail at
   all" a startup failure with an explicit, reviewable opt-out. Domain content policy belongs to the
   feature that knows what its input is and which jurisdiction it answers to.
7. **Write the layering rule as a test.** Assert that no vendor SDK name appears outside your
   infrastructure layer, and that your own governed wrapper does not either. The second assertion is the
   one people skip, and it is the one that stops a prompt type from becoming a domain type.

The rule of thumb: **anything you would demand of a database, a payment provider or a message broker, you
have to demand of a model call too, and a model call needs two more things on top: a versioned prompt and
a per-call ceiling. If you cannot say what one call can spend, you do not have a dependency. You have a
subscription with a code path attached.**

---

**What we covered:** why the properties of a model call belong to the call rather than to the feature
that makes it, how `MMCA.Common.AI` composes `BoundedChatClient`, an optional `GuardrailChatClient`,
`UsageRecordingChatClient` and prompt tagging into one governed `IChatClient` over a provider adapter
selected by name, why registering nothing when the dependency is disabled beats a flag, the five bounds
and the honest limits of the estimated input budget, `IChatGuardrail` and `IChatRequestRedactor` as an
extension point with two narrow shipped policies, a fail-closed verdict and a registration-time refusal,
`PromptContract`'s SHA-256 identity over name, version, model and text and the pin and golden-replay gates
built on it, the `AiUsageMeter` counters and latency histogram that make spend attributable to a prompt
version, and the `AiDependencyIsolationTestsBase` fitness function that keeps both the vendor SDK and the
governed package behind Infrastructure.

**Next in the series:** Article 51, "Four ways to do work later: channels, cron, the outbox and durable internal
commands."

*MMCA.Common is open source. Star the repo, read the 2-minute ADR-120 behind this pattern, or
`dotnet add package MMCA.Common.API` and build the monolith you can extract later.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- This pattern's decision records: `Website/docs-src/adr/120-governed-chat-client-boundary.md` and
  `Website/docs-src/adr/111-ai-session-scoring-governance.md`
- The full 34-category scorecard, §16 included, lives in
  `Website/docs-src/governance/common-ArchitectureScorecard.md` in the docs site.

*Previous: Article 49, "Undo is a feature: saga compensation and the reconciliation backstop." Next:
Article 51, "Four ways to do work later: channels, cron, the outbox and durable internal commands."*

*Tags: .NET, C Sharp, AI, LLM, Software Architecture*

*Notes: verified type/behavior names with path:line (all re-read this run, 2026-10-02, MMCA.Common
v1.221.0). Both code blocks are illustrative of the documented shape rather than byte-for-byte source. The
first is the pipeline diagram from `MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:22-31`,
re-commented; the second condenses `BoundedChatClient.Bound` (`:181-223`), `CreateLinkedTimeout`
(`:270-275`) and `EnforceInputBudget` (`:277-292`) into one block, with both exception messages shortened
(`:210-213`, `:291`) and the comments added. This run reworked the scoring framing (M3/I6 to M4/I9, five
met, one partial, one unexercised), the package framing (one package to four), the G28 inventory (12 types
L0-L3 to 32 types L0-L10), the bound count (four to five), the guardrail section (shipped policies,
redactors, streamed-update inspection, the `RequireGuardrail` refusal), the tool-governance and provider
trade-offs, and added the AI.Testing pin and golden-replay gates. Source drift noted, not edited:
`BoundedChatClient.cs:13` still says "Four bounds" above a five-item list (`:16-50`), and
`ADR-120:411-412` cites `Program.cs:140/151/153` where the calls sit at `:139/150/152`.*
- *Package source, paths rooted at `MMCA.Common/Source/Core/MMCA.Common.AI/`:*
  - *`AiSettings.cs`: `AiSettings : IValidatableObject` `:22`, `SectionName` `"Ai"` `:25`,
    `DefaultMaxOutputTokens` 1024 `:28`, `DefaultTimeout` 30 seconds `:31`, `MaxTimeout` one hour `:38`,
    `Enabled` `:46`, `Provider` (string) `:55`, `Model` `:65`, `ApiKey` `:76`, `Endpoint` `:83`,
    `MaxOutputTokens` `:90` (`[Range(1, 1_000_000)]` `:89`), `Timeout` `:96`, `AllowTools` `:103`,
    `RequireGuardrail` default true `:117` (rationale `:108-115`), `EnableCache` `:123`,
    `PerCallInputTokenBudget` `:131`, conditional `Validate` `:140-190` (Provider `:147`, Model `:155`,
    ApiKey `:162`, Endpoint `:170`, Timeout range `:177`, `:184`).*
  - *`DependencyInjection.cs`: pipeline diagram `:22-31`, ordering rationale `:33-41` (cache-hit usage
    `:36-39`, prompt tagging `:39-40`), `AiServiceCollectionExtensions` `:77`, `AddMmcaChatClient(IConfiguration)`
    `:88` registering `AiProviderValidator` `:94`, factory overload `:113`, bind + `ValidateDataAnnotations`
    + `ValidateOnStart` `:123-126`, register-nothing-when-disabled return `:128-132`, descriptor checks
    `:139-140` (comment `:134-138`), `RefuseAnUngovernedHost` call `:142`, `AddMetrics` /
    `TryAddSingleton<AiUsageMeter>` `:144-145`, pipeline build `:149-184` (`BoundedChatClient` with
    `IChatToolPolicy` `:151-154`, `GuardrailChatClient` with redactors `:156-162`, `UsageRecordingChatClient`
    `:164-168`, both-halves cache opt-in `:172-175`, `enableSensitiveData` `:177`, `UseOpenTelemetry`
    `:180-182`, `PromptTaggingChatClient` `:183`, `UseLogging` `:184`), `RequireGuardrail` refusal
    `:208-217`, tools-without-policy refusal `:219-226`, `CreateProviderChatClient` `:239-248` (belt throw
    `:244-245`), `IsDevelopmentHost` `:262-266` (fails-closed remark `:256-261`).*
  - *`Providers/IAiProviderFactory.cs`: interface `:20`, `Name` `:26`, `Create` `:34`.
    `Providers/AiProviderValidator.cs`: class `:16`, `ValidateOptionsResult.Fail` `:34`. Adapters:
    `MMCA.Common.AI.Anthropic/DependencyInjection.cs:26` (`AddAnthropicAiProvider`),
    `MMCA.Common.AI.Anthropic/AnthropicAiProviderFactory.cs:14` with
    `new AnthropicClient(options).AsIChatClient(...)` `:48`; `MMCA.Common.AI.OpenAI/DependencyInjection.cs:26`
    (`AddOpenAiProvider`), `MMCA.Common.AI.OpenAI/OpenAiProviderFactory.cs:18` with `.AsIChatClient()` `:51`.*
  - *`Chat/BoundedChatClient.cs`: five-bound list `:16-50` (tool policy `:28-38`, model pin `:43-49`),
    estimate caveat `:51-58`, no-mutation remark `:59-63`, class `:65`, eager bound/budget `:124-130`,
    `StreamBoundedAsync` `:133-146` (whole-stream comment `:140-141`), four-characters fallback `:178`
    (comment `:175-177`), `Bound` `:181-223` (clone `:183`, clamp `:185-187`, tool strip `:189-193`,
    `FilterTools` call `:196`, model pin `:205-220`), `FilterTools` `:231-268` (no policy `:241-244`,
    every-policy check `:251`, confirmation-not-override comment `:256-258`, consequential `:259`),
    `CreateLinkedTimeout` `:270-275`, `EnforceInputBudget` `:277-292`.*
  - *`Chat/IChatGuardrail.cs`: extension point plus two shipped guardrails and no domain policy `:9-14`,
    hot-path remark `:17-20`, interface `:21`, `InspectRequestAsync` `:28-31`, `InspectResponseAsync`
    `:38-41`, `InspectStreamedUpdateAsync` default Allow `:57-60` (fragment remark `:51-56`).
    `Chat/GuardrailChatClient.cs`: redact-then-inspect summary `:8-10`, layer placement `:12-16`,
    redaction-first `:18-20`, streaming remark `:23-30`, class `:31`, ctors `:39`, `:48-58`, buffered
    path `:61-87` (redact `:68`, throw `:82`), streaming path `:90-117` (inspect-before-yield comment
    `:101-102`, throw `:111`), `Redact` `:126-135`, `InspectRequestAsync` `:137-153` (throw `:150`).
    `Guardrails/IChatRequestRedactor.cs:25`, `Guardrails/IChatToolPolicy.cs:23`,
    `Guardrails/GuardrailServiceCollectionExtensions.cs` (`AddPiiRedactionGuardrail` `:33`,
    `AddContentPolicyGuardrail` `:62`), `Guardrails/PiiRedactionGuardrail.cs:39`,
    `Guardrails/ContentPolicyGuardrail.cs` (class `:64`, eight `BuiltInMarkers` `:77-87`),
    `Guardrails/ContentPolicySettings.cs:35` (`InjectionMode` default `Redact`).
    `Chat/GuardrailVerdict.cs`: readonly record struct `:13`, `UnspecifiedReason` `:16`, `Allow` `:25`,
    `Block` `:39-44`. `Chat/ChatGuardrailException.cs`: class `:12`, rationale `:7-11`.
    `Chat/IAiTokenEstimator.cs`: interface `:14`, no-second-dependency rationale `:9-12`.
    `Chat/PromptTaggingChatClient.cs:21`.*
  - *`PromptContract.cs` (unchanged anchors, confirmed by this run's audit): record `:23`, property keys
    `:26`, `:29`, `:32`, `Hash` `:46` with the do-not-cache remark `:40-45`, `ToChatOptions` `:53`, `Apply`
    `:62`, `ReadName` `:77`, `ReadVersion` `:82`, hash and normalization `:90-103`.*
  - *`Observability/AiUsageMeter.cs` (unchanged anchors, confirmed by this run's audit): class `:20`,
    `MeterName` `:26`, counters `:29`, `:32`, histogram `:45` with remark `:36-43`, outcomes `:48`, `:51`,
    `:54`, do-not-dispose remark `:62-67`, absent usage records nothing `:108-123`, `RecordDuration`
    `:137-149`, `AttributionTags` `:155-165`.*
  - *`Chat/UsageRecordingChatClient.cs`: bound-before/cost-after rationale `:13-15`, class `:38`,
    `ResolveProviderName` from `ChatClientMetadata` with lowercased config fallback `:68-81`, buffered path
    `:84-117`, hand-driven-enumerator comment `:129-131`, `RecordUsageIn` over `UsageContent` `:179-190`.*
- *Evaluation harness, `MMCA.Common/Source/Hosting/MMCA.Common.AI.Testing/`: `GoldenReplayTestsBase.cs`
  (offline replay summary `:7-9`, collected failures `:18-20`, class `:24`, `EveryGoldenCase_ReplaysAsRecorded`
  `:43`, empty-corpus failure `:57-62`); `PromptContractPinTestsBase.cs` (protocol summary `:8-23`, class
  `:25`, `EveryContract_HasARecordedHash` `:39`, `EveryRecordedHash_MatchesTheCurrentContract` `:60`).*
- *Fitness function:
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/AiDependencyIsolationTestsBase.cs`:
  two-ways-it-leaks documentation `:6-13`, subclass-per-repo instruction `:14-17`, class `:19`,
  `LanguageModelSdks_ShouldStayAt_TheModelBoundary` `:24-25`,
  `GovernedAiPackage_ShouldStayBehind_Infrastructure` `:28-29`.*
- *ADR-120 (`Website/docs-src/adr/120-governed-chat-client-boundary.md`, 461 lines): Accepted 2026-09-11
  `:4`, revisions `:8`, `:12`, the AI.Testing harness and prompt tagging `:34-38`, the v1.208.0
  `ContentPolicyGuardrail` revision `:40-47`; decision 10 (evaluation harness is framework code) `:261`;
  trade-offs cited here: off-by-absence `:339-344`, provider is two references and a name `:345-349`, two
  defaults can refuse a host `:356-359`, cache-hit usage `:364-367`, two narrow content policies
  `:368-380`, streamed fragments `:381-385`, harness not evaluation `:386-389`, retrieval out of scope
  `:390-393`, one consumer `:394-396`; consequences: ADC adoption `:410-416`, ADC §16 at M4/I10 `:419-424`.*
- *ADR-111 (`Website/docs-src/adr/111-ai-session-scoring-governance.md`), Accepted 2026-09-04 and
  **extended, not superseded**, by ADR-120 `:4`: the scoring-specific rules, the prompt-change protocol,
  the two evaluation tiers, the input and output guardrails and the budgeted ceiling alert stay with the
  feature. Its decision 8 (the framework meters the tokens, a budgeted ceiling alert watches the total)
  is at `:226`.*
- *Rubric: §16 heading (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:469`), intent
  `:471`, applicability `:473`, the seven criteria `:476-482` (least-privilege tool calling `:480`,
  retrieval `:481`), red flags `:485-489`, default weight 2 `:491` (anchors confirmed by this run's audit).*
- *Scorecards: MMCA.Common §16 at weight 2, Maturity 4 / Implementation 9, 8/18, five met, one partial
  (guardrails), one unexercised (retrieval), held at I9 by three guardrail residuals
  (`Website/docs-src/governance/common-ArchitectureScorecard.md:80`); no N/A rows, 34 rows, weight total 82
  (`:104`). MMCA.Store §16 N/A, no product feature calls a model (`store-ArchitectureScorecard.md:57`).*
- *Numbers: framework v1.221.0 (`MMCA.Common/FACTS.md:14`, dated 2026-10-02 at `:4`), twenty-two
  published packages (`:19`) with `MMCA.Common.AI` `:22`, `MMCA.Common.AI.Anthropic` `:23`,
  `MMCA.Common.AI.OpenAI` `:24` and `MMCA.Common.AI.Testing` `:34`; 141 fitness test methods across 55
  abstract bases (`:51`), MMCA.Common's own build executing 339 (`:54`). Group G28 Common AI Integration,
  32 types, levels L0-L10 (`Website/docs-src/onboarding/00-group-taxonomy.md:82`, chapter
  `Website/docs-src/onboarding/group-27-common-ai-integration.md`).*
- *Consumer adoption, read this run:
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/MMCA.ADC.Conference.Infrastructure.csproj:19`
  takes `MMCA.Common.AI`; `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/MMCA.ADC.Conference.Service.csproj`
  takes `MMCA.Common.AI` `:31` and `MMCA.Common.AI.Anthropic` `:34`; the host's `Program.cs` section comment
  `:116`, `AddAnthropicAiProvider` `:139`, `AddConferenceAiGuardrails` `:150`, `AddMmcaChatClient` `:152`,
  `AddMeter`/`AddSource("MMCA.Common.AI")` `:171-172`; `MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs`
  `AddConferenceAiGuardrails` `:85` registering `AddPiiRedactionGuardrail` `:95`,
  `AddContentPolicyGuardrail` `:96`, `AddSessionScoreResponseGuardrail` `:99`;
  `.../Sessions/Scoring/SessionScoringService.cs:46` is the one feature that calls a model (taking
  `IChatClient?`). The audit for this run found no `MMCA.Store/Source` file referencing `MMCA.Common.AI`,
  `Anthropic` or `Microsoft.Extensions.AI` outside one `packages.lock.json`.*

- Full series index: https://ivanball.github.io/writing.html
