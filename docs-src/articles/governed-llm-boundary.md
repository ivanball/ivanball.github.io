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
> `.../Guardrails/IPromptInjectionGuardrail.cs`, `.../Guardrails/ContentPolicySettings.cs`,
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

MMCA.Common scores it. The §16 row sits at Maturity 4 / Implementation 8 at weight 2
(`common-ArchitectureScorecard.md:81`), with §16 in both denominators and a weight total of 82
(`:105`). The row walks the seven criteria as four met, two partial and one unexercised: guardrails and
evaluation are the partial criteria, and retrieval is the unexercised one. Maturity 4 is the
build-breaking part (the prompt-contract pin, the golden-replay gate, the registration-time guardrail
refusal and the startup pattern validation all fail the build), and Implementation 8 rather than 9 is
the two partial criteria, because the 9 band needs every criterion met. You will see both again in the
trade-offs.

## The MMCA answer: four optional packages, and the call is a pipeline

The AI boundary is four of the 30 published framework packages (`MMCA.Common/FACTS.md:20`), all
at framework v1.319.0 (`:14`): `MMCA.Common.AI`, the governed pipeline (`:23`);
`MMCA.Common.AI.Anthropic` and `MMCA.Common.AI.OpenAI`, provider adapters that each register one
`IAiProviderFactory` (`:24`, `:25`); and `MMCA.Common.AI.Testing`, the replay and golden-evaluation
harness (`:37`). All four are optional: nothing in the metapackage drags them in (`:90`), and a host that
never calls a model never installs them. In the onboarding taxonomy the types sit in group **G28, Common
AI Integration**, forty-six types across levels L0 to L6
(`Website/docs-src/onboarding/00-group-taxonomy.md:82`). That is a small surface for what it governs, and
the smallness is the design.

The composition entry point is `AddMmcaChatClient` (`DependencyInjection.cs:89`), and what it registers is
one `IChatClient` built as a pipeline, outermost first (built at `:151-188`, the same order documented as
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
`gen_ai` span. The comment in the source says all of that in place (`DependencyInjection.cs:33-40`).

Two smaller decisions in the same file are worth naming. **The provider is a registered factory, never a
type this package names.** The configuration overload resolves every registered `IAiProviderFactory`
(`IAiProviderFactory.cs:20`, `Name` at `:26`, `Create` at `:34`) and selects the one whose name matches
`Ai:Provider` (`CreateProviderChatClient`, `DependencyInjection.cs:282-291`). The factories live in the
adapter packages, and each is the vendor's own adapter: `AddAnthropicAiProvider`
(`MMCA.Common.AI.Anthropic/DependencyInjection.cs:26`) registers one whose `Create` is
`new AnthropicClient(options).AsIChatClient(...)` (`AnthropicAiProviderFactory.cs:48`), and
`AddOpenAiProvider` (`MMCA.Common.AI.OpenAI/DependencyInjection.cs:26`) does the same over the OpenAI SDK
(`OpenAiProviderFactory.cs:51`). Nothing here hand-rolls a request over `HttpClient`. A provider name the
host never registered fails at boot rather than on a user's first request: `AddMmcaChatClient` registers
`AiProviderValidator` into the options pipeline (`DependencyInjection.cs:95`), which fails with the
registered names in the message (`AiProviderValidator.cs:34`), and `CreateProviderChatClient` keeps a belt
throw for a host that bypassed that pipeline (`DependencyInjection.cs:287-288`). A host with its own
credential story, or a test with no network, supplies the innermost client through the factory overload
(`:114`). And **prompt and completion text reach traces only on a host positively identified as
Development** (`enableSensitiveData` at `:181`, `IsDevelopmentHost` at `:305-309`), a check that fails
closed: an environment the package cannot see reads as not-Development (`:299-304`).

## Off by absence, not off by flag

`AiSettings` (`AiSettings.cs:23`) binds one configuration section, `Ai` (`:26`), and carries the whole
surface: `Enabled` (`:47`), `Provider` (`:56`, the name of a registered provider), `Model` (`:66`),
`ApiKey` (`:78`), `Endpoint` (`:85`), `MaxOutputTokens` (`:92`, defaulting to 1024 at `:29`), `Timeout`
(`:98`, defaulting to 30 seconds at `:32` and capped at one hour at `:39`), `AllowTools` (`:105`),
`RequireGuardrail` (`:122`, defaulting to true), `EnableCache` (`:128`) and `PerCallInputTokenBudget`
(`:136`). `Provider`, `Model` and `ApiKey` are required only once `Enabled` is true, alongside a
`Timeout` inside its range and an `Endpoint`, when one is set, that is absolute and, outside
Development, https, because every call carries the key in its headers (`Validate`, `:156-204`;
`ValidateEndpoint`, `:212-232`, the https rule at `:221-229`). That conditional shape is what lets the
section ship in every appsettings file rather than only in the ones that use it.

The load-bearing check is five lines long. When `Ai:Enabled` is false, **no `IChatClient` is
registered** (`DependencyInjection.cs:131-135`): the settings still bind and validate (`:124-129`), the
configuration overload still registers the provider validator (`:95`), and the client is the one thing
that never enters the container (remark at `:66-72`).

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
   for less keeps its own smaller number (`:197-199`). Output tokens are the expensive half of a chat
   call, so this is a cost bound.
2. **Wall clock.** Every call runs under a token linked to the caller's own and cancelled after
   `Ai:Timeout` (`:280-285`). On the streaming path the timeout covers the whole stream rather than its
   first update (`:133-146`, with the reasoning at `:140-141`): a provider that opens a response and then
   stalls is exactly the failure a per-call budget exists to bound.
3. **Tool use.** While `Ai:AllowTools` is false, tools and the tool mode are stripped from the request
   (`:201-205`). That is the difference between telling a model not to act and being unable to hand it
   the means. While it is true, `FilterTools` (`:241-278`) offers a tool only when every registered
   `IChatToolPolicy` allows it (`:261`), and a tool marked consequential only when the request also
   confirms it by name (`:269`). The confirmation is checked on top of the policies, never instead of
   them (`:266-268`), and with no policy at all every tool is stripped (`:248-254`). When the surviving
   tools cannot honor the requested tool mode (none survive, or a `RequireSpecific` mode names a tool the
   filter stripped), the mode falls back to auto so the model answers plainly (`CanHonorToolMode`,
   `:181-191`, applied at `:209-212`).
4. **Input size.** When `Ai:PerCallInputTokenBudget` is set, an estimated input above the budget fails
   the call locally instead of paying for it remotely (`:287-302`).
5. **Model.** The request goes out naming `Ai:Model`, and a request that names a different model is
   refused (`:215-230`). Adapters differ in whether a per-request model id overrides the one the client
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
Each call works on a clone (`BoundedChatClient.cs:195`), so a caller reusing one `ChatOptions` instance
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

        // No tools left, or a RequireSpecific mode naming a stripped tool: fall back to auto.
        if (!CanHonorToolMode(bounded))
        {
            bounded.ToolMode = null;
        }
    }

    // The model is part of the prompt contract, not negotiated per call.
    if (_settings.Model is { } pinned)
    {
        if (bounded.ModelId is { } requestedModel && !string.Equals(requestedModel, pinned, StringComparison.Ordinal))
        {
            var setting = $"{AiSettings.SectionName}:{nameof(AiSettings.Model)}";
            throw new InvalidOperationException(
                $"The request names model '{requestedModel}' but {setting} pins '{pinned}'.");
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

    var setting = $"{AiSettings.SectionName}:{nameof(AiSettings.PerCallInputTokenBudget)}";
    throw new InvalidOperationException(string.Create(CultureInfo.InvariantCulture,
        $"The request's estimated input size ({estimated} tokens) exceeds {setting} ({budget} tokens)."));
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
(`Guardrails/GuardrailServiceCollectionExtensions.cs:34`) registers contact-detail redaction
(`PiiRedactionGuardrail.cs:42`). `AddContentPolicyGuardrail` (`:64`) registers `ContentPolicyGuardrail`
(`ContentPolicyGuardrail.cs:65`), which matches eight built-in prompt-injection markers (`:78-88`) in
user-role content and redacts, blocks or ignores them per `InjectionMode` (`Redact` by default,
`ContentPolicySettings.cs:45`), plus any request pattern the host adds and a response-side refusal on
configured blocked patterns; one singleton serves as both a guardrail and a redactor (`ADR-120:40-47`).
It is also the shipped implementation carrying the `IPromptInjectionGuardrail` marker
(`Guardrails/IPromptInjectionGuardrail.cs:21`, implemented at `ContentPolicyGuardrail.cs:65`), which is
what the startup refusal below looks for.
Those two ship because neither judgement varies by application (`ADR-120:435-442`). What counts as an
off-topic answer or a disallowed topic depends on the data the application holds and the jurisdiction it
operates in, so a rule like that baked into a shared package would be wrong somewhere by construction.
That policy stays with the feature that knows what its input is.

Three details in that layer repay attention:

- **The verdict fails closed.** `GuardrailVerdict` is a `readonly record struct` (`GuardrailVerdict.cs:13`)
  whose `default` value reads as a block carrying `UnspecifiedReason` (`:16`), because `Allow` is an
  explicit static (`:25`) and `Block(reason)` refuses a blank reason (`:39-44`). A half-built verdict
  stops the call rather than silently admitting it.
- **The layer is absent when unused, and an undefended host is a startup failure.** `AddMmcaChatClient`
  checks the service *descriptors*, not a resolved service, and adds `GuardrailChatClient` only when an
  `IChatGuardrail` or an `IChatRequestRedactor` is registered (`DependencyInjection.cs:142-143`,
  `:160-166`, comment at `:137-141`), so an empty-loop client never changes the type the container hands
  back. But `Ai:RequireGuardrail` defaults to true (`AiSettings.cs:122`), and what it asks for is a
  prompt-injection defense specifically: a guardrail or redactor whose implementation type is marked
  `IPromptInjectionGuardrail`, read from the descriptor too (`DependencyInjection.cs:144`, `:253-267`).
  An enabled host without one throws at registration with `AddContentPolicyGuardrail(configuration)`
  named as the fix, and the message says outright that `AddPiiRedactionGuardrail()` alone does not
  satisfy it, because it strips contact details, not injected instructions (`:215-228`). A host that
  deliberately wants none sets the flag false, which is a reviewable line rather than an absence nobody
  can see.
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
(`Chat/PromptTaggingChatClient.cs:21`) puts it on the `gen_ai` span (`DependencyInjection.cs:187`).

`MMCA.Common.AI.Testing` turns that identity into two gates, and the framework runs both on its own
reference contract (`ADR-120:318`). `PromptContractPinTestsBase` (`PromptContractPinTestsBase.cs:25`) pins
every contract's hash in a JSON file, and its two facts fail on a contract with no recorded hash (`:39`)
and on a recorded hash that no longer matches its contract (`:60`). `GoldenReplayTestsBase`
(`GoldenReplayTestsBase.cs:31`) replays every case of a corpus through the real code against the answer
recorded for it, with no model, no credential and no network, so it runs on every CI leg (`:7-9`). It
collects every failing case rather than stopping at the first (`:18-21`, the replay fact at `:81`), and
an empty corpus is a failure too (`:108-113`), because an evaluation that evaluates nothing passes
forever. Its second fact closes the other way a corpus goes quiet: each case carries the hash of the
contract it was recorded against, and `EveryGoldenCase_WasRecordedAgainstTheCurrentContract` (`:56`)
fails, naming the cases, when that hash is not the hash of the `CurrentContract` the code ships
(`:40`). Replaying an old answer against a changed prompt would still pass while proving nothing, so the
gate demands a re-recording instead (`:24-28`).

## Metering: two counters, one histogram, one name

`AiUsageMeter` (`AiUsageMeter.cs:20`) publishes `mmca.ai.input_tokens` (`:29`) and
`mmca.ai.output_tokens` (`:32`) on the meter `MMCA.Common.AI` (`:26`), plus a
`mmca.ai.call.duration` histogram in seconds (`:45`). Every instrument shares four attribution
dimensions, `model`, `prompt_name`, `prompt_version` and `provider` (`AttributionTags`, `:158-168`), and
the histogram adds an `outcome` of `success`, `error` or `canceled` (`:48`, `:51`, `:57`, applied at
`:149` inside `RecordDuration`, `:140-152`).

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
with a `catch` (`:134-136`), and it harvests usage from the `UsageContent` item the provider delivers on
the stream (`RecordUsageIn`, `:185-196`). A streamed call counts as `canceled` until the stream is seen to
end, so a consumer that stops reading early (a guardrail blocking an update, a caller breaking out of its
loop) is never recorded as a success (`:128-132`).

Two absences are deliberate. A usage the provider did not report records nothing (`AiUsageMeter.cs:95-97`,
enforced in `Record` at `:104-127`): an absent number must not read as a zero on a spend dashboard. And
the `Meter` itself is created through `IMeterFactory` and neither retained nor disposed (`:65-70`),
because disposing a factory-owned meter
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
architecture tests with that repo's architecture map (`:14-17`), one of 186 fitness test methods across 74
abstract `*TestsBase` classes, of which MMCA.Common's own build executes 767 (`MMCA.Common/FACTS.md:98`,
`:101`). A prompt or a bound must not become a type your domain depends on, and that sentence is a failing
test rather than a code review comment.

## Trade-offs, honestly

- **Guardrails are one of two partial §16 criteria, and together with evaluation they hold the row at
  Implementation 8.** `Ai:RequireGuardrail` asks for a prompt-injection defense, so a host whose only
  guardrail is the PII redactor is refused at startup (`DependencyInjection.cs:215-228`). Two residuals
  remain: the response half of the content policy is inert until a host configures patterns, and the
  streamed path inspects fragments, so a pattern spanning two updates is missed by design
  (`common-ArchitectureScorecard.md:81`). The framework makes "no injection defense" a startup failure.
  It does not make the defense sufficient: eight markers catch the common phrasings, and a response
  policy with no patterns checks nothing.
- **Retrieval is unexercised, on purpose.** Nothing in the package addresses vector or hybrid search,
  embedding freshness or retrieved-content injection, and ADR-120 leaves the rubric's retrieval
  criterion to the feature that builds one, if one ever is (`ADR-120:457-460`). The scorecard reads it as
  unexercised rather than unmet because the criterion is worded conditionally on such a store existing
  (`common-ArchitectureScorecard.md:81`).
- **The framework ships the evaluation harness, not the evaluation, and the scorecard counts evaluation
  as partial.** The replay client, the golden base, the pin base and the protocol are framework code; the
  corpus, the assertions and any live-judge tier remain the feature's, because only the feature knows
  what a good answer is. The framework's own reference contract proves the bases work, not that any
  product prompt is good (`ADR-120:453-456`): its reference cases assert against the same constants the
  code sends, and there is no judge or rubric scoring and no regression threshold
  (`common-ArchitectureScorecard.md:81`). The package governs the call. It does not make your feature
  evaluable for you.
- **The package governs the call and only the narrowest part of the content.** Contact-detail redaction
  and a small injection-marker list ship; delimiting untrusted input, escaping it, constraining the
  response schema and any domain-specific check stay in the feature that knows what its input is
  (`ADR-120:435-447`). The marker list is eight phrases on purpose, so ordinary prose about instructions
  survives it, which also means it catches the common phrasings rather than every phrasing.
- **Least-privilege tool calling is framework mechanism, not framework policy.** With `Ai:AllowTools`
  true, a tool reaches the model only when every `IChatToolPolicy` allows it and, if consequential, the
  request confirms it (`BoundedChatClient.cs:241-278`), and tools-on with no policy refuses to start
  (`DependencyInjection.cs:230-237`). What a policy allows is still the application's to write, and the
  rubric's "authorized per caller" (`ArchitectureEvaluationCriteria.md:480`) is only as good as that
  policy.
- **An enabled host can be refused at startup on several counts.** Options validation fails a blank
  `Ai:Provider`, `Ai:Model` or `Ai:ApiKey`, a `Timeout` out of range, and an `Ai:Endpoint` that is
  relative or, outside Development, not https (`AiSettings.cs:156-232`), and a provider name no factory
  matches (`AiProviderValidator.cs:34`). `Ai:RequireGuardrail` with no injection defense and
  `Ai:AllowTools` with no policy are registration-time failures (`DependencyInjection.cs:215-237`), a
  content-policy pattern that does not compile fails the host too, and the model pin turns a
  `PromptContract` that disagrees with `Ai:Model` into a refused call (`ADR-120:416-426`). That is the
  intended direction, and it means adopting the package is more than one line of registration.
- **Off by absence puts a null on the consumer.** No `IChatClient` is registered when `Ai:Enabled` is
  false, only the bound settings (`DependencyInjection.cs:124-135`), so a feature resolves with
  `GetService` and holds a nullable dependency. That is a branch in your code, written once per feature,
  that the framework will not write for you (`ADR-120:399-404`).
- **A cache hit still records usage.** `UsageRecordingChatClient` sits inside the optional response cache
  (`DependencyInjection.cs:36-39`), so a hit counts what the call would have cost rather than what was
  billed. The provider span is absent on a hit, so the two are distinguishable, but a spend graph read
  without that context over-reports (`ADR-120:431-434`).
- **The input budget is an estimate and says so.** Message text plus instructions only, four characters
  to the token, everything else under-counted (`BoundedChatClient.cs:51-58`). Treat it as a runaway
  guardrail with headroom. The authoritative numbers arrive after the call.
- **A provider is two references and a name.** A host adds an adapter package beside the governed one,
  calls its registration method and names it in `Ai:Provider`; the governed package cannot fall back to a
  provider it was never handed (`ADR-120:405-409`). Two adapters ship (`MMCA.Common/FACTS.md:24`, `:25`),
  anything else implements `IAiProviderFactory` or goes through the factory overload
  (`DependencyInjection.cs:114`), and a misnamed provider is a boot failure naming the registered ones
  (`AiProviderValidator.cs:34`).
- **An optional package nobody installs governs nothing, and adoption here is one feature.** MMCA.ADC's
  Conference module takes the package in Infrastructure (`MMCA.ADC.Conference.Infrastructure.csproj:19`)
  and its service host takes it with the Anthropic adapter (`MMCA.ADC.Conference.Service.csproj:30`,
  `:33`). The host calls `AddAnthropicAiProvider` (`MMCA.ADC.Conference.Service/Program.cs:241`),
  `AddConferenceAiGuardrails` (`:253`), which registers the PII redactor, the content policy and the
  module's own response guardrail (`MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:90`, `:100`,
  `:101`, `:104`), and `AddMmcaChatClient` (`Program.cs:255`), then subscribes the meter and trace source by
  name (`:274-275`). Its organizer-facing session scoring (`SessionScoringService.cs:47`) is the one
  product feature in these repos that calls a model. MMCA.Store adopts none of it: §16 is N/A there
  because no product feature calls a model (`store-ArchitectureScorecard.md:59`). The rules are proven by
  exactly one consumer (`ADR-120:461-463`).

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
   empty corpus and on a recording made against a different hash. Without that, "did anybody re-evaluate
   this prompt" is a question about somebody's memory.
5. **Count the provider's numbers, not your own, and count them once.** One meter name and one set of
   counter names across every service, with the model, provider, prompt name and prompt version as
   dimensions. Record nothing when the provider reported nothing: an absent number that reads as zero is
   worse than a gap, because a gap is visible.
6. **Ship the guardrail extension point, and only the policies that never vary by application.** Let
   the application register redactors and inspectors for requests, responses and streamed updates, run
   all of them, fail closed on a default verdict, and stop on the first refusal. Make "no prompt-injection
   defense" a startup failure with an explicit, reviewable opt-out, and do not let a policy that defends
   against something else satisfy it. Domain content policy belongs to the feature that knows what its
   input is and which jurisdiction it answers to.
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
selected by name, why registering no client when the dependency is disabled beats a flag, the five bounds
and the honest limits of the estimated input budget, `IChatGuardrail` and `IChatRequestRedactor` as an
extension point with two narrow shipped policies, a fail-closed verdict and a registration-time refusal
of a host with no prompt-injection defense, `PromptContract`'s SHA-256 identity over name, version, model
and text and the pin and golden-replay gates built on it, the `AiUsageMeter` counters and latency
histogram that make spend attributable to a prompt version, and the `AiDependencyIsolationTestsBase`
fitness function that keeps both the vendor SDK and the governed package behind Infrastructure.

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

*Notes: 2026-11-25 refresh, re-verified 2026-11-25 against MMCA.Common v1.319.0 (`MMCA.Common/FACTS.md:14`,
as of 2026-11-25 at `:4`), audit verdict Needs-edit. Changed this run (every anchor read this run):
the §16 row is M4/I8 with four met, two partial (guardrails and evaluation) and one unexercised, held at
I8 because the 9 band needs every criterion met (`common-ArchitectureScorecard.md:81`), weight total 82 at
`:105`; `Ai:RequireGuardrail` is satisfied only by an implementation marked `IPromptInjectionGuardrail`
(v1.317.0, `ADR-120:660-668`), so the guardrail bullet, the first trade-off, apply item 6 and the
covered paragraph name the injection-defense refusal (`DependencyInjection.cs:144`, `:215-228`,
`:253-267`; `AiSettings.cs:107-122`; `Guardrails/IPromptInjectionGuardrail.cs:21`;
`ContentPolicyGuardrail.cs:65`); the golden-replay section names the contract-hash fact
(`GoldenReplayTestsBase.cs:24-28`, `:40`, `:56`); the evaluation trade-off states why evaluation is
partial (`common-ArchitectureScorecard.md:81`); the settings paragraph adds the https endpoint rule
(`AiSettings.cs:212-232`, https at `:221-229`, v1.313.0 per `ADR-120:67-69`); the off-by-absence
wording says no client is registered rather than nothing (`DependencyInjection.cs:66-72`, `:95`,
`:124-135`, matching the `ADR-120` 2026-11-23 revision item 3 at `:639-645`); the "two defaults can
refuse" trade-off lists every startup refusal (`ADR-120:416-426`); 30 published packages (`FACTS.md:20`;
AI anchors `:23`, `:24`, `:25`, `:37`; metapackage `:90`); fitness 186 methods across 74 bases with 767
executed (`FACTS.md:98`, `:101`); G28 has 46 types, L0-L6 (`00-group-taxonomy.md:82`); ADR-120 is 685
lines (decision 10 `:318`, trade-offs `:398-463`); ADR-111 decision 8 `:250`; store §16 N/A at
`store-ArchitectureScorecard.md:59`; ADC host anchors `Program.cs:241`, `:253`, `:255`, `:274-275`
(section comment `:230`), service csproj `:30`, `:33`, Conference `DependencyInjection.cs:90`, `:100`,
`:101`, `:104`; every `DependencyInjection.cs` and `AiSettings.cs` anchor re-located (lists below).
Class anchors of every `Chat/`, `Providers/`, `PromptContract.cs` and `AiUsageMeter.cs` type and the
`BoundedChatClient` member anchors (`Bound` `:193`, `FilterTools` `:241`, `CreateLinkedTimeout` `:280`,
`EnforceInputBudget` `:287`, fallback `:178`) were re-read this run and are unchanged; the remaining
interior anchors of those files are carried from the 2026-10-22 read and were confirmed by this run's
audit. Source drift noted, not edited: `BoundedChatClient.cs:13` still says "Four bounds" above a
five-item list (`:16-50`), re-confirmed 2026-11-25; ADR-120's Consequences and its 2026-11-23 revision
cite the ADC host at `Program.cs:240`, `:252`, `:254`, `:273-274` (`ADR-120:478`, `:655-656`), one line
above current source.
Earlier entries: 2026-10-29 (the release before the v1.3xx line; 26 packages, 160 methods across 64
bases with 479 executed, G28 33 types, ADR-120 597 lines, ADC host `Program.cs:147`, `:158`, `:160`,
`:179-180`); 2026-10-22 (v1.250.0; 159/63/458, ADR-120 538 lines, `AiUsageMeter` and
`UsageRecordingChatClient` anchors re-located, canceled-until-the-stream-ends outcome named); 2026-10-08
(v1.233.0; `CanHonorToolMode` added to the tool-use bound and the second code block, 153/61/410);
2026-10-02 (v1.221.0; scoring framing M3/I6 to M4/I9, one package to four, G28 12 types to 32, four
bounds to five, shipped guardrail policies, the AI.Testing gates).
Both code blocks are illustrative of the documented shape rather than byte-for-byte source. The
first is the pipeline diagram from `MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:22-31`,
re-commented; the second condenses `BoundedChatClient.Bound` (`:193-233`), `CreateLinkedTimeout`
(`:280-285`) and `EnforceInputBudget` (`:287-302`) into one block, with both exception messages shortened
(`:219-223`, `:300-301`) and the comments added (the tool-mode comment paraphrases the `CanHonorToolMode`
documentation `:181-187`).*
- *Package source, paths rooted at `MMCA.Common/Source/Core/MMCA.Common.AI/`:*
  - *`AiSettings.cs` (re-read 2026-11-25): `AiSettings : IValidatableObject` `:23`, `SectionName` `"Ai"` `:26`,
    `DefaultMaxOutputTokens` 1024 `:29`, `DefaultTimeout` 30 seconds `:32`, `MaxTimeout` one hour `:39`,
    `Enabled` `:47`, `Provider` (string) `:56`, `Model` `:66`, `ApiKey` `:78`, `Endpoint` `:85`,
    `MaxOutputTokens` `:92`, `Timeout` `:98`, `AllowTools` `:105`,
    `RequireGuardrail` default true `:122` (prompt-injection rationale `:107-121`), `EnableCache` `:128`,
    `PerCallInputTokenBudget` `:136`, `IsDevelopmentHost` `:143`, conditional `Validate` `:156-204`
    (Provider `:163`, Model `:171`, ApiKey `:178`, endpoint call `:186`, Timeout range `:191`, `:198`),
    `ValidateEndpoint` `:212-232` (absolute `:214`, https outside Development `:221-229`), fails-closed
    `IsDevelopment` `:239-242`.*
  - *`DependencyInjection.cs` (re-read 2026-11-25): pipeline diagram `:22-31`, ordering rationale `:33-40`
    (cache-hit usage `:36-39`, prompt tagging `:39-40`), injection-defense remark `:43-50`, disabled-host
    remark `:66-72`, `AiServiceCollectionExtensions` `:78`, `AddMmcaChatClient(IConfiguration)` `:89`
    registering `AiProviderValidator` `:95`, factory overload `:114`, bind + `PostConfigure` +
    `ValidateDataAnnotations` + `ValidateOnStart` `:124-129`, register-no-client-when-disabled gate
    `:131-135`, descriptor checks `:142-143` plus `hasInjectionGuardrail` `:144` (comment `:137-141`),
    `RefuseAnUngovernedHost` call `:146`, `AddMetrics` / `TryAddSingleton<AiUsageMeter>` `:148-149`,
    pipeline build `:151-188` (`BoundedChatClient` with `IChatToolPolicy` `:155-158`,
    `GuardrailChatClient` with redactors `:160-166`, `UsageRecordingChatClient` `:168-172`, both-halves
    cache opt-in `:176-179`, `enableSensitiveData` `:181`, `UseOpenTelemetry` `:184-186`,
    `PromptTaggingChatClient` `:187`, `UseLogging` `:188`), `RefuseAnUngovernedHost` `:210` (remark
    `:204-209`), injection-guardrail refusal `:215-228`, tools-without-policy refusal `:230-237`,
    `IsPromptInjectionGuardrail` `:253-267`, `CreateProviderChatClient` `:282-291` (belt throw
    `:287-288`), `IsDevelopmentHost` `:305-309` (fails-closed remark `:299-304`).*
  - *`Providers/IAiProviderFactory.cs`: interface `:20` (re-read 2026-11-25), `Name` `:26`, `Create` `:34`.
    `Providers/AiProviderValidator.cs`: class `:16`, `ValidateOptionsResult.Fail` `:34`. Adapters:
    `MMCA.Common.AI.Anthropic/DependencyInjection.cs:26` (`AddAnthropicAiProvider`),
    `MMCA.Common.AI.Anthropic/AnthropicAiProviderFactory.cs:14` with
    `new AnthropicClient(options).AsIChatClient(...)` `:48`; `MMCA.Common.AI.OpenAI/DependencyInjection.cs:26`
    (`AddOpenAiProvider`), `MMCA.Common.AI.OpenAI/OpenAiProviderFactory.cs:18` with `.AsIChatClient()` `:51`.*
  - *`Chat/BoundedChatClient.cs` (class and member anchors re-read 2026-11-25): five-bound list `:16-50`
    (tool policy `:28-38`, model pin `:43-49`), estimate caveat `:51-58`, no-mutation remark `:59-63`,
    class `:65`, eager bound/budget `:124-130`, `StreamBoundedAsync` `:133-146` (whole-stream comment
    `:140-141`), four-characters fallback `(text.Length + 3) / 4` `:178` (comment `:175-177`),
    `CanHonorToolMode` `:188-191` (documentation `:181-187`), `Bound` `:193-233` (clone `:195`, clamp
    `:197-199`, tool strip `:201-205`, `FilterTools` call `:208`, tool-mode fallback `:209-212`, model pin
    `:215-230`, its exception `:219-223`), `FilterTools` `:241-278` (no policy `:248-254`, every-policy
    check `:261`, confirmation-not-override comment `:266-268`, consequential `:269`),
    `CreateLinkedTimeout` `:280-285`, `EnforceInputBudget` `:287-302` (exception `:300-301`).*
  - *`Chat/IChatGuardrail.cs`: extension point plus two shipped guardrails and no domain policy `:9-14`,
    hot-path remark `:17-20`, interface `:21`, `InspectRequestAsync` `:28-31`, `InspectResponseAsync`
    `:38-41`, `InspectStreamedUpdateAsync` default Allow `:57-60` (fragment remark `:51-56`).
    `Chat/GuardrailChatClient.cs`: redact-then-inspect summary `:8-10`, layer placement `:12-16`,
    redaction-first `:18-20`, streaming remark `:23-30`, class `:31`, ctors `:39`, `:48-58`, buffered
    path `:61-87` (redact `:68`, throw `:82`), streaming path `:90-117` (inspect-before-yield comment
    `:101-102`, throw `:111`), `Redact` `:126-135`, `InspectRequestAsync` `:137-153` (throw `:150`).
    `Guardrails/IChatRequestRedactor.cs:25`, `Guardrails/IChatToolPolicy.cs:23`,
    `Guardrails/IPromptInjectionGuardrail.cs:21`,
    `Guardrails/GuardrailServiceCollectionExtensions.cs` (`AddPiiRedactionGuardrail` `:34`,
    `AddContentPolicyGuardrail` `:64`), `Guardrails/PiiRedactionGuardrail.cs:42` (implements
    `IChatRequestRedactor` and `IChatGuardrail`, not the injection marker),
    `Guardrails/ContentPolicyGuardrail.cs` (class implementing `IPromptInjectionGuardrail` `:65`, eight
    `BuiltInMarkers` `:78-88`), `Guardrails/ContentPolicySettings.cs:45` (`InjectionMode` default
    `Redact`), all re-read 2026-11-25.
    `Chat/GuardrailVerdict.cs`: readonly record struct `:13`, `UnspecifiedReason` `:16`, `Allow` `:25`,
    `Block` `:39-44`. `Chat/ChatGuardrailException.cs`: class `:12`, rationale `:7-11`.
    `Chat/IAiTokenEstimator.cs`: interface `:14`, no-second-dependency rationale `:9-12`.
    `Chat/PromptTaggingChatClient.cs:21`.*
  - *`PromptContract.cs` (record `:23` re-read 2026-11-25): property keys
    `:26`, `:29`, `:32`, `Hash` `:46` with the do-not-cache remark `:40-45`, `ToChatOptions` `:53`, `Apply`
    `:62`, `ReadName` `:77`, `ReadVersion` `:82`, hash and normalization `:90-103`.*
  - *`Observability/AiUsageMeter.cs` (class `:20` re-read 2026-11-25): `MeterName` `:26`, counters `:29`,
    `:32`, histogram `:45` with remark `:36-43`, outcomes `:48`, `:51`, `:57` (canceled summary
    `:53-56`), do-not-dispose remark `:65-70`, absent usage records nothing `:95-97` (`Record`
    `:104-127`, null return `:111-114`), `RecordDuration` `:140-152` (outcome tag `:149`),
    `AttributionTags` `:158-168`.*
  - *`Chat/UsageRecordingChatClient.cs` (class `:38` re-read 2026-11-25): bound-before/cost-after
    rationale `:13-15`, `ResolveProviderName` from `ChatClientMetadata` with lowercased config fallback
    `:68-81`, buffered path `:84-117`, canceled-until-the-stream-ends comment `:128-132`,
    hand-driven-enumerator comment `:134-136`, `RecordUsageIn` over `UsageContent` `:185-196`.*
- *Evaluation harness, `MMCA.Common/Source/Hosting/MMCA.Common.AI.Testing/`: `GoldenReplayTestsBase.cs`
  (re-read 2026-11-25: offline replay summary `:7-9`, collected failures and empty corpus `:18-21`,
  contract-hash remark `:24-28`, class `:31`, `CurrentContract` `:40`,
  `EveryGoldenCase_WasRecordedAgainstTheCurrentContract` `:56`, `EveryGoldenCase_ReplaysAsRecorded`
  `:81`, empty-corpus throw in `LoadCases` `:108-113`); `PromptContractPinTestsBase.cs` (protocol summary
  `:8-23`, class `:25`, `EveryContract_HasARecordedHash` `:39`,
  `EveryRecordedHash_MatchesTheCurrentContract` `:60`).*
- *Fitness function:
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/AiDependencyIsolationTestsBase.cs`:
  two-ways-it-leaks documentation `:6-13`, subclass-per-repo instruction `:14-17`, class `:19`,
  `LanguageModelSdks_ShouldStayAt_TheModelBoundary` `:24-25`,
  `GovernedAiPackage_ShouldStayBehind_Infrastructure` `:28-29`.*
- *ADR-120 (`Website/docs-src/adr/120-governed-chat-client-boundary.md`, 685 lines, re-read
  2026-11-25): the v1.208.0 `ContentPolicyGuardrail` revision `:40-47`, the 2026-11-23 status line
  `:67-71`; decision 7 (a host that inspects nothing does not start) `:222`, decision 10 (evaluation
  harness is framework code) `:318`; trade-offs `:398-463`: off-by-absence `:399-404`, provider is two
  references and a name `:405-409`, an enabled host is refused at startup `:416-426`, cache-hit usage
  `:431-434`, two narrow content policies `:435-447` (neither varies by application `:435-442`), streamed
  fragments `:448-452`, harness not evaluation `:453-456`, retrieval out of scope `:457-460`, one consumer
  `:461-463`; Consequences `:465`; revision 2026-11-23 `:614-658` (disabled-host wording item 3
  `:639-645`); revision 2026-11-24 (v1.317.0 injection-defense requirement and contract-hashed golden
  cases) `:660-668`.*
- *ADR-111 (`Website/docs-src/adr/111-ai-session-scoring-governance.md`), Accepted 2026-09-04 and
  **extended, not superseded**, by ADR-120 `:4`: the scoring-specific rules, the prompt-change protocol,
  the two evaluation tiers, the input and output guardrails and the budgeted ceiling alert stay with the
  feature. Its decision 8 (the framework meters the tokens, a budgeted ceiling alert watches the total)
  is at `:250` (re-read 2026-11-25).*
- *Rubric: §16 heading (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:469`), intent
  `:471`, applicability `:473`, the seven criteria `:476-482` (least-privilege tool calling `:480`,
  retrieval `:481`), red flags `:485-489`, default weight 2 `:491` (re-read 2026-10-22; the scorecard row
  read this run cites the same lines).*
- *Scorecards (re-read 2026-11-25): MMCA.Common §16 at weight 2, Maturity 4 / Implementation 8, 8/16,
  four met, two partial (guardrails, with two residuals after the v1.317.0 injection-defense fix; and
  evaluation, no judge or rubric scoring and no regression threshold), one unexercised (retrieval), held
  at I8 because the 9 band needs every criterion met
  (`Website/docs-src/governance/common-ArchitectureScorecard.md:81`); no N/A rows, 34 rows, weight total
  82 (`:105`). MMCA.Store §16 N/A, no product feature calls a model (`store-ArchitectureScorecard.md:59`).*
- *Numbers (re-read 2026-11-25): framework v1.319.0 (`MMCA.Common/FACTS.md:14`, dated 2026-11-25 at
  `:4`), 30 published packages (`:20`) with `MMCA.Common.AI` `:23`, `MMCA.Common.AI.Anthropic` `:24`,
  `MMCA.Common.AI.OpenAI` `:25` and `MMCA.Common.AI.Testing` `:37`, the metapackage `MMCA.Common`
  referencing none of them (`:90`); 186 fitness test methods across 74 abstract bases (`:98`),
  MMCA.Common's own build executing 767 (`:101`). Group G28 Common AI Integration, 46 types, levels
  L0-L6 (`Website/docs-src/onboarding/00-group-taxonomy.md:82`, chapter
  `Website/docs-src/onboarding/group-27-common-ai-integration.md`).*
- *Consumer adoption, re-read 2026-11-25:
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/MMCA.ADC.Conference.Infrastructure.csproj:19`
  takes `MMCA.Common.AI`; `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/MMCA.ADC.Conference.Service.csproj`
  takes `MMCA.Common.AI` `:30` and `MMCA.Common.AI.Anthropic` `:33`; the host's `Program.cs` section comment
  `:230`, `AddAnthropicAiProvider` `:241`, `AddConferenceAiGuardrails` `:253`, `AddMmcaChatClient` `:255`,
  `AddMeter` `:274` and `AddSource("MMCA.Common.AI")` `:275`; `MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs`
  `AddConferenceAiGuardrails` `:90` registering `AddPiiRedactionGuardrail` `:100`,
  `AddContentPolicyGuardrail` `:101`, `AddSessionScoreResponseGuardrail` `:104`;
  `.../Sessions/Scoring/SessionScoringService.cs:47` is the one feature that calls a model (taking
  `IChatClient?` at `:48`). The 2026-10-02 audit found no `MMCA.Store/Source` file referencing `MMCA.Common.AI`,
  `Anthropic` or `Microsoft.Extensions.AI` outside one `packages.lock.json`; not re-run this run.*

- Full series index: https://ivanball.github.io/writing.html
