# The LLM Is a Dependency: A Bounded, Guarded, Metered Boundary for Chat Completions

> Series: MMCA.Common · Article #50 (deep-dive) · Pillar P2/P4 · Group G28 · Rubric §16 · ADR-120, ADR-111 ·
> Status: grounded in `Website/docs-src/adr/120-governed-chat-client-boundary.md`,
> `Website/docs-src/adr/111-ai-session-scoring-governance.md`,
> `MMCA.Common/Source/Core/MMCA.Common.AI/AiSettings.cs`,
> `.../MMCA.Common.AI/PromptContract.cs`, `.../MMCA.Common.AI/DependencyInjection.cs`,
> `.../MMCA.Common.AI/Chat/BoundedChatClient.cs`, `.../Chat/GuardrailChatClient.cs`,
> `.../Chat/IChatGuardrail.cs`, `.../Chat/GuardrailVerdict.cs`, `.../Chat/ChatGuardrailException.cs`,
> `.../Chat/IAiTokenEstimator.cs`, `.../Chat/UsageRecordingChatClient.cs`,
> `.../MMCA.Common.AI/Observability/AiUsageMeter.cs`,
> `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/AiDependencyIsolationTestsBase.cs`,
> the §16 criteria of `Website/docs-src/governance/ArchitectureEvaluationCriteria.md`, and the §16 rows of
> `Website/docs-src/governance/common-ArchitectureScorecard.md`. No em dashes.

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
dependency, so govern it like one. The provider half is the vendor SDK's own adapter. The governance half
is a pipeline you compose once and every future feature inherits.

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

MMCA.Common scores it. The §16 row sits at Maturity 3 / Implementation 6, moved there on the
thirty-fifth-wave re-score of 2026-09-15 on the strength of the guardrail extension point, the latency
histogram and host-side telemetry export (`common-ArchitectureScorecard.md:75`), with §16 back in both
denominators at weight 2 (`:124`). Implementation 6 is the Adequate band and the row says why: two of the
seven criteria are wholly absent from the framework by design, which is a sentence you will see again in
the trade-offs.

## The MMCA answer: one optional package, and the call is a pipeline

`MMCA.Common.AI` is one of the nineteen published framework packages (`MMCA.Common/FACTS.md:19`, listed
at `:22`, framework v1.205.0 at `:14`) and it is optional: nothing in the metapackage drags it in, and a
host that never calls a model never installs it. In the onboarding taxonomy it is group **G28, Common AI
Integration**, twelve types across levels L0 to L3
(`Website/docs-src/onboarding/00-group-taxonomy.md:82`). Twelve types is the whole surface. That smallness
is the design.

The composition entry point is `AddMmcaChatClient` (`DependencyInjection.cs:67`), and what it registers is
one `IChatClient` built as a pipeline, outermost first (registration at `:108-143`, the same order
documented as a diagram in the type remarks at `:22-30`):

```csharp
// The shape AddMmcaChatClient composes, outermost first.
BoundedChatClient            // what the call is ALLOWED to do: tokens, timeout, tools, input size
  GuardrailChatClient        // optional: present only when an IChatGuardrail is registered
    UsageRecordingChatClient // what the call cost, and how long it took
      DistributedCaching     // optional: Ai:EnableCache AND a registered IDistributedCache
        OpenTelemetry        // traces under the MMCA.Common.AI source
          Logging
            provider client  // Anthropic, via the SDK's own AsIChatClient adapter
```

The ordering is not decoration. Bounds are outermost, so a call the configuration forbids is refused
before anything downstream logs it, caches it or counts it. Guardrails sit inside the bounds and outside
usage recording, so a blocked request never reaches the provider and therefore has no cost to record. The
comment in the source says all of that in place (`DependencyInjection.cs:31-39`).

Two smaller decisions in the same method are worth naming. **The provider adapter is the vendor's, not
ours**: `CreateProviderChatClient` constructs an `AnthropicClient` and calls the SDK's own
`AsIChatClient` extension with the configured model and ceiling (`:158`, adapter call at `:169-173`), so
nothing here hand-rolls a Messages API request over `HttpClient`. A provider the package does not know
goes through the factory overload (`:82`) rather than by adding a second vendor dependency, and an
unrecognized provider throws with that instruction in the message (`:174-176`). And **prompt and
completion text reach traces only on a host positively identified as Development** (`:137`, gate at
`:192-196`), a check that fails closed: an environment the package cannot see reads as not-Development.

## Off by absence, not off by flag

`AiSettings` (`AiSettings.cs:31`) binds one configuration section, `Ai` (`:34`), and carries the whole
surface: `Enabled` (`:48`), `Provider` (`:51`), `Model` (`:59`), `ApiKey` (`:70`), `MaxOutputTokens`
(`:77`, defaulting to 1024 at `:37`), `Timeout` (`:83`, defaulting to 30 seconds at `:40`), `AllowTools`
(`:90`), `EnableCache` (`:96`) and `PerCallInputTokenBudget` (`:104`). `Model` and `ApiKey` are required
only once `Enabled` is true (`Validate`, `:113-141`), which is what lets the section ship in every
appsettings file rather than only in the ones that use it.

The load-bearing line is four lines long. When `Ai:Enabled` is false, **nothing is registered**
(`DependencyInjection.cs:97-101`): the settings still bind and validate, and no `IChatClient` enters the
container at all.

That pushes a null onto the consumer on purpose. A feature resolves the client with
`GetService<IChatClient>()` and holds a nullable dependency, so the disabled path is a branch the feature
writes rather than a flag the framework reads on its behalf. The payoff is that a feature with no key in
a given environment is off *by construction*: there is no half-running state where the flag says on and
the credential is missing. A boolean everybody has to remember to check is the version of this that
fails.

## Bounds: four of them, on both paths

`BoundedChatClient` (`BoundedChatClient.cs:51`) is a `DelegatingChatClient` and enforces four bounds, each
applied to the buffered and the streaming path (the list is documented on the type at `:15-36`):

1. **Output tokens.** `MaxOutputTokens` is clamped down to the configured ceiling, while a caller asking
   for less keeps its own smaller number (`:151-153`). Output tokens are the expensive half of a chat
   call, so this is a cost bound.
2. **Wall clock.** Every call runs under a token linked to the caller's own and cancelled after
   `Ai:Timeout` (`:164-169`). On the streaming path the timeout covers the whole stream rather than its
   first update (`:99-112`, with the reasoning at `:106-107`): a provider that opens a response and then
   stalls is exactly the failure a per-call budget exists to bound.
3. **Tool use.** While `Ai:AllowTools` is false, tools and the tool mode are stripped from the request
   (`:155-159`). That is the difference between telling a model not to act and being unable to hand it
   the means.
4. **Input size.** When `Ai:PerCallInputTokenBudget` is set, an estimated input above the budget fails
   the call locally instead of paying for it remotely (`:171-186`).

The estimate asks the pipeline for an `IAiTokenEstimator` (`IAiTokenEstimator.cs:14`) and otherwise
counts four characters to the token (`BoundedChatClient.cs:144`), the usual rough rule for English prose.
The type documentation is blunt about what that cannot see: it reads message text plus instructions only,
so images, tool schemas, provider-side additions and non-Latin scripts are all under-counted (`:37-44`).
It is a runaway guardrail with headroom, never a billing figure. The estimator interface is declared in
the package rather than taken as a dependency on a tokenizer library, and the reason is stated in place
(`IAiTokenEstimator.cs:9-12`): a package whose whole point is keeping the model dependency small should
not acquire a second one to count characters.

One detail that costs nothing and prevents a real bug: the options a caller passes are never mutated.
Each call works on a clone (`:149`), so a caller reusing one `ChatOptions` instance across requests does
not silently inherit this client's clamping.

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
        + $"({budget} tokens). The estimate is approximate: shorten the prompt or raise the budget.");
}
```

On the streaming path, the bound and the budget check run eagerly, outside the iterator
(`BoundedChatClient.cs:90-94`): a request the configuration forbids is refused when it is made, not when
somebody gets around to reading the stream.

## Guardrails: the framework ships the extension point, not the policy

`IChatGuardrail` (`IChatGuardrail.cs:20`) has two methods: `InspectRequestAsync` (`:27-30`) and
`InspectResponseAsync` (`:37-40`), each answering with a `GuardrailVerdict`. An application registers one
implementation per concern, `GuardrailChatClient` (`GuardrailChatClient.cs:21`) runs every one of them in
registration order, and the first block throws `ChatGuardrailException`
(`ChatGuardrailException.cs:12`, thrown at `GuardrailChatClient.cs:57` and `:100`).

The framework ships no policy, and the interface documentation says why (`IChatGuardrail.cs:9-13`): what
counts as a prompt injection, a leaked secret, an off-topic answer or a disallowed topic depends on the
data the application holds and the jurisdiction it operates in, so a content rule baked into a shared
package would be wrong somewhere by construction. The package offers the place to plug policy in. The
policy stays with the feature that knows what its input is.

Three details in that layer repay attention:

- **The verdict fails closed.** `GuardrailVerdict` is a `readonly record struct` (`GuardrailVerdict.cs:13`)
  whose `default` value reads as a block carrying `UnspecifiedReason` (`:16`), because `Allow` is an
  explicit static (`:25`) and `Block(reason)` refuses a blank reason (`:39-44`). A half-built verdict
  stops the call rather than silently admitting it.
- **The layer is absent when it is unused.** `AddMmcaChatClient` checks the service *descriptors*, not a
  resolved service, and adds `GuardrailChatClient` only when at least one `IChatGuardrail` is registered
  (`DependencyInjection.cs:117-121`). An empty-loop client would otherwise change the type the container
  hands back for every application that adopts none of this (the comment is at `:114-116`).
- **The streaming path inspects the request only** (`GuardrailChatClient.cs:65-78`, remark at `:16-20`).
  Inspecting a streamed answer means buffering it to the end, which defeats the reason a caller chose
  streaming, so an application that needs response inspection on streamed output buffers at its own call
  site and owns that decision.

A refusal is an exception rather than an empty response, and the reason is recorded on the exception type
(`ChatGuardrailException.cs:7-11`): an empty response is indistinguishable from the model having nothing
to say, and a caller that wants a graceful fallback catches this type specifically.

## Prompts: a versioned contract the framework hashes

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
reaches telemetry, and `PromptContract.ReadName` (`:77`) and `ReadVersion` (`:82`) are how the metering
layer reads it back off the options a call carried.

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

`UsageRecordingChatClient` (`UsageRecordingChatClient.cs:30`) is what feeds it, and it records the
provider's own reported numbers rather than an estimate. The type documentation says why it sits here
rather than beside the input-budget check (`:11-15`): a bound has to be decided *before* the call, and a
cost has to be measured *after* it. The buffered path records duration on all three outcomes and then the
usage (`:48-81`); the streaming path drives the enumerator by hand rather than with `await foreach`,
because the duration has to be attributed to an outcome and C# forbids a `yield return` inside a `try`
with a `catch` (`:93-95`), and it harvests usage from the `UsageContent` item the provider delivers on
the stream (`:143-154`).

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
architecture tests with that repo's architecture map (`:14-17`), one of 136 fitness test methods across 53
abstract `*TestsBase` classes, of which MMCA.Common's own build executes 267 (`MMCA.Common/FACTS.md:48`,
`:51`). A prompt or a bound must not become a type your domain depends on, and that sentence is a failing
test rather than a code review comment.

## Trade-offs, honestly

- **Two of the seven §16 criteria are absent from the framework on purpose.** An evaluation gate in CI
  and retrieval as data architecture are feature-side, and ADR-120 records both as scope-outs rather than
  as gaps to be closed later (`ADR-120:226`, `:236-237`). The §16 row's Implementation 6 is the Adequate
  band precisely because of that split (`common-ArchitectureScorecard.md:75`). The package governs the
  call. It does not make your feature evaluable for you.
- **The package governs the call, not the prompt's content.** Delimiting untrusted input, escaping it,
  redacting PII and constraining the response schema stay in the feature that knows what its input is
  (`ADR-120:209-213`). `IChatGuardrail` is where that policy plugs in, and a second feature still has to
  make those decisions for itself.
- **Tool governance is a blanket switch, not per-caller authorization.** `Ai:AllowTools` is one boolean
  for the whole host, and stripping tools (`BoundedChatClient.cs:155-159`) is the cheap half of least
  privilege. The rubric asks for tools that are explicit, authorized per caller, and idempotent or
  confirmable (`ArchitectureEvaluationCriteria.md:480`). Until a feature needs any, the honest answer is
  that none exist.
- **Off by absence puts a null on the consumer.** Nothing is registered when `Ai:Enabled` is false
  (`DependencyInjection.cs:97-101`), so a feature resolves with `GetService` and holds a nullable
  dependency. That is a branch in your code, written once per feature, that the framework will not write
  for you (`ADR-120:189-195`).
- **A cache hit still records usage.** `UsageRecordingChatClient` sits inside the optional response cache
  (`DependencyInjection.cs:22-30`), so a hit counts what the call would have cost rather than what was
  billed. The provider span is absent on a hit, so the two are distinguishable, but a spend graph read
  without that context over-reports (`ADR-120:205-209`).
- **The input budget is an estimate and says so.** Message text plus instructions only, four characters
  to the token, everything else under-counted (`BoundedChatClient.cs:37-44`). Treat it as a runaway
  guardrail with headroom. The authoritative numbers arrive after the call.
- **The streaming guardrail sees the request only** (`GuardrailChatClient.cs:65-78`). Response inspection
  on a streamed answer means buffering it, which defeats streaming, so that trade is pushed to the call
  site rather than made for you.
- **One provider is built in.** Anything other than Anthropic goes through the factory overload
  (`DependencyInjection.cs:82`) and an unrecognized provider throws with that instruction (`:174-176`).
  The pipeline is provider-agnostic; the convenience is not.
- **An optional package nobody installs governs nothing, and adoption here is one feature.** MMCA.ADC's
  Conference module takes the package in Infrastructure and in its service host
  (`MMCA.ADC.Conference.Infrastructure.csproj:19`, `MMCA.ADC.Conference.Service.csproj:27`), and its
  organizer-facing session scoring is the one product feature in these repos that calls a model
  (`AnthropicScoringService.cs:9`), with the host subscribing the meter and trace source by name
  (`MMCA.ADC.Conference.Service/Program.cs:154-155`). MMCA.Store adopts none of it: §16 is N/A there
  because no product feature calls a model (`store-ArchitectureScorecard.md:61`). The rules are proven by
  exactly one consumer.

## Apply this even without MMCA

The shape ports to any stack with a DI container and a vendor SDK. `Microsoft.Extensions.AI` makes it
cheap in .NET because `IChatClient` and `DelegatingChatClient` already exist, but the pattern is older
than the abstraction.

1. **Wrap the vendor client; do not subclass your feature around it.** A delegating decorator per concern
   composes, and a decorator you did not register is a concern you deliberately skipped. Use the vendor
   SDK's own adapter onto whatever common interface your ecosystem has, and write no transport code of
   your own: the day you hand-roll the HTTP request is the day the boundary is in the wrong place.
2. **Put the bounds outermost, and make them configuration.** An output-token ceiling, a wall-clock
   budget, a tool switch and an optional input ceiling, read from one validated settings section. Clamp
   rather than default: a governance layer a caller can talk out of its limits with an argument is
   documentation. Link your timeout token to the caller's own so early cancellation still wins.
3. **Turn the feature off by absence, not by flag.** Register nothing when the dependency is disabled, so
   the code path cannot half-exist against a missing key. A nullable dependency is a branch somebody
   writes once; a boolean is a check everybody has to remember.
4. **Make the prompt a versioned artifact with a computed identity.** Name, version, model and text, and
   a hash over all four with line endings normalized first. Compute it on read, never cache it in a
   field. Stamp the name, version and hash onto the request so telemetry carries them. Without that hash,
   an evaluation suite has nothing stable to key its recorded answers on, and "did anybody re-evaluate
   this prompt" becomes a question about somebody's memory.
5. **Count the provider's numbers, not your own, and count them once.** One meter name and one set of
   counter names across every service, with the model, provider, prompt name and prompt version as
   dimensions. Record nothing when the provider reported nothing: an absent number that reads as zero is
   worse than a gap, because a gap is visible.
6. **Ship the guardrail extension point without the guardrail policy.** Let the application register
   inspectors for requests and responses, run all of them, fail closed on a default verdict, and stop on
   the first refusal. Content policy belongs to the feature that knows what its input is and which
   jurisdiction it answers to.
7. **Write the layering rule as a test.** Assert that no vendor SDK name appears outside your
   infrastructure layer, and that your own governed wrapper does not either. The second assertion is the
   one people skip, and it is the one that stops a prompt type from becoming a domain type.

The rule of thumb: **anything you would demand of a database, a payment provider or a message broker, you
have to demand of a model call too, and a model call needs two more things on top: a versioned prompt and
a per-call ceiling. If you cannot say what one call can spend, you do not have a dependency. You have a
subscription with a code path attached.**

---

**What we covered:** why the properties of a model call belong to the call rather than to the feature
that makes it, how `MMCA.Common.AI` composes `BoundedChatClient`, an optional `GuardrailChatClient` and
`UsageRecordingChatClient` into one governed `IChatClient`, why registering nothing when the dependency is
disabled beats a flag, the four bounds and the honest limits of the estimated input budget, `IChatGuardrail`
as an extension point that ships no policy and fails closed, `PromptContract`'s SHA-256 identity over name,
version, model and text, the `AiUsageMeter` counters and latency histogram that make spend attributable to
a prompt version, and the `AiDependencyIsolationTestsBase` fitness function that keeps both the vendor SDK
and the governed package behind Infrastructure.

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

*Notes: verified type/behavior names with path:line (all re-read this run, 2026-09-19). Both code blocks
are illustrative of the documented shape rather than byte-for-byte source. The first is the pipeline
diagram from `MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:22-30`, re-commented; the
second condenses `BoundedChatClient.Bound` (`:147-162`), `CreateLinkedTimeout` (`:164-169`) and
`EnforceInputBudget` (`:171-186`) into one block, with the exception message shortened from `:185` and the
estimator comment added.*
- *Package source, paths rooted at `MMCA.Common/Source/Core/MMCA.Common.AI/`:*
  - *`AiSettings.cs`: `AiSettings : IValidatableObject` `:31`, `SectionName` `"Ai"` `:34`,
    `DefaultMaxOutputTokens` 1024 `:37`, `DefaultTimeout` 30 seconds `:40`, `Enabled` `:48`,
    `Provider` `:51`, `Model` `:59`, `ApiKey` `:70`, `MaxOutputTokens` `:77` (`[Range(1, 1_000_000)]`
    `:76`), `Timeout` `:83`, `AllowTools` `:90`, `EnableCache` `:96`, `PerCallInputTokenBudget` `:104`,
    conditional `Validate` `:113-141`. `AiProvider` enum `:11` with `Anthropic = 0` `:17`.*
  - *`DependencyInjection.cs`: `AiServiceCollectionExtensions` `:57`, pipeline diagram `:22-30` and the
    ordering rationale `:31-39`, `AddMmcaChatClient(IConfiguration)` `:67`, factory overload `:82`,
    bind + `ValidateDataAnnotations` + `ValidateOnStart` `:92-95`, the register-nothing-when-disabled
    return `:97-101`, `AddMetrics`/`TryAddSingleton<AiUsageMeter>` `:103-104`, `BoundedChatClient`
    registration `:108-112`, the descriptor check plus `GuardrailChatClient` `:117-121` (rationale comment
    `:114-116`), `UsageRecordingChatClient` `:124-128`, the both-halves cache opt-in `:132-134`,
    `enableSensitiveData` `:137`, `UseOpenTelemetry(sourceName: AiUsageMeter.MeterName)` `:139-142`,
    `UseLogging` `:143`, `CreateProviderChatClient` `:158` with `AnthropicClient(...).AsIChatClient(...)`
    `:169-173` and the unsupported-provider throw `:174-176`, `IsDevelopmentHost` `:192-196` (fails-closed
    remark `:186-191`).*
  - *`Chat/BoundedChatClient.cs`: `BoundedChatClient : DelegatingChatClient` `:51`, the four-bound list
    `:15-36`, the estimate caveat `:37-44`, buffered path `:66-80`, streaming path `:83-97` with the
    eager bound/budget `:92-94` and its comment `:90-91`, `StreamBoundedAsync` `:99-112` (whole-stream
    timeout comment `:106-107`), `EstimateInputTokens` `:121-145` with the four-characters fallback `:144`
    and its comment `:141-143`, `Bound` `:147-162` (clone `:149`, clamp `:151-153`, tool strip `:155-159`),
    `CreateLinkedTimeout` `:164-169`, `EnforceInputBudget` `:171-186` (estimator lookup `:178`, throw
    `:185`).*
  - *`Chat/IChatGuardrail.cs`: interface `:20`, `InspectRequestAsync` `:27-30`, `InspectResponseAsync`
    `:37-40`, the extension-point-not-policy rationale `:9-13`, hot-path remark `:16-19`.
    `Chat/GuardrailChatClient.cs`: class `:21`, ctor `:28-33`, buffered path `:36-62` (request inspection
    `:45`, response loop `:49-59`, throw `:57`), streaming request-only path `:65-78` with the remark
    `:16-20`, `InspectRequestAsync` `:87-103` (throw `:100`). `Chat/GuardrailVerdict.cs`: readonly record
    struct `:13`, `UnspecifiedReason` `:16`, `Allow` `:25`, `IsAllowed` `:28`, `Reason` `:34`, `Block`
    `:39-44`, fail-closed remark `:7-12`. `Chat/ChatGuardrailException.cs`: class `:12`, the
    exception-not-empty-response rationale `:7-11`. `Chat/IAiTokenEstimator.cs`: interface `:14`,
    `EstimateTokenCount` `:19`, the no-second-dependency rationale `:9-12`.*
  - *`PromptContract.cs`: record `:23`, `NamePropertyKey` `"mmca.prompt.name"` `:26`, `VersionPropertyKey`
    `:29`, `HashPropertyKey` `:32`, `Hash` `:46` with the do-not-cache remark `:40-45`, `ToChatOptions`
    `:53`, `Apply` `:62`, `ReadName` `:77`, `ReadVersion` `:82`, `ComputeHash` `:90-100` (pipe join
    `:92-97`, `Convert.ToHexStringLower(SHA256.HashData(...))` `:99`), `NormalizeLineEndings` `:102-103`.*
  - *`Observability/AiUsageMeter.cs`: class `:20`, `MeterName` `"MMCA.Common.AI"` `:26`,
    `mmca.ai.input_tokens` `:29`, `mmca.ai.output_tokens` `:32`, `mmca.ai.call.duration` `:45` with the
    not-a-duplicate-of-`gen_ai.client.operation.duration` remark `:36-43`, outcome constants `:48`, `:51`,
    `:54`, the `IMeterFactory` ctor `:72-89` with the do-not-dispose remark `:62-67`, `Record` `:101-124`
    (absent counts record nothing `:108-123`), `RecordDuration` `:137-149`, `AttributionTags` `:155-165`.*
  - *`Chat/UsageRecordingChatClient.cs`: class `:30`, the bound-before/cost-after rationale `:11-15`,
    buffered path `:48-81` (canceled `:60-64`, error `:65-69`, success duration `:71`, `_meter.Record`
    `:73-78`), streaming path `:84-137` with the hand-driven-enumerator comment `:93-95` and the `finally`
    duration `:134`, `RecordUsageIn` over `UsageContent` `:143-154`, `RecordDuration` `:159-166`.*
- *Fitness function:
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Layering/AiDependencyIsolationTestsBase.cs`:
  class `:19`, `LanguageModelSdks_ShouldStayAt_TheModelBoundary` `:24-25`,
  `GovernedAiPackage_ShouldStayBehind_Infrastructure` `:28-29`, the two-ways-it-leaks documentation
  `:6-13`, the subclass-per-repo instruction `:14-17`.*
- *ADR-120 (`Website/docs-src/adr/120-governed-chat-client-boundary.md`), Accepted 2026-09-11 `:4`, revised
  2026-09-11 `:8`, 2026-09-15 for the guardrail layer and host-side telemetry export `:12-24`, and
  2026-09-19 for the ADC re-score `:26-28`. The decision statement `:75-78`; the eight decision points
  `:80-159`; the trade-offs cited here: off-by-absence `:189-195`, cache-hit usage `:205-209`, content
  policy stays feature-side `:209-213`, one built-in provider `:213-215`, one consumer `:216-218`;
  consequences `:221-237`, including ADC's §16 at M4/I9 from the 2026-09-16 cycle `:228-237` and the
  Store/Helpdesk N/A `:225-226`.*
- *ADR-111 (`Website/docs-src/adr/111-ai-session-scoring-governance.md`), Accepted 2026-09-04 and
  **extended, not superseded**, by ADR-120 `:4`: the scoring-specific rules, the prompt-change protocol,
  the two evaluation tiers and the budgeted ceiling alert stay with the feature. Its decision 8 records
  that the feature defines no meter of its own and that token usage rides `UsageRecordingChatClient` on
  the `MMCA.Common.AI` meter `:170-187`; its closing trade-off states that the call, the credential, the
  metering and the prompt contract are framework surface while everything above them is scoped to session
  scoring `:292-296`.*
- *Rubric: §16 AI-Native Application Architecture heading
  (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:469`), intent `:471`, the N/A-until-a-
  feature-calls-a-model applicability rule `:473`, the seven criteria `:476-482` (least-privilege tool
  calling at `:480`), the red flags `:485-489`, default weight 2 `:491`.*
- *Scorecards: MMCA.Common's §16 at Maturity 3 / Implementation 6 from the thirty-fifth-wave re-score of
  2026-09-15 (`Website/docs-src/governance/common-ArchitectureScorecard.md:75`), with §16 in both
  denominators at weight 2 and a rubric weight total of 82 (`:124`). MMCA.Store's §16 is N/A because no
  product feature
  calls a model (`store-ArchitectureScorecard.md:61`).*
- *Numbers: framework v1.205.0 (`MMCA.Common/FACTS.md:14`, dated 2026-09-17 at `:4`), nineteen published
  packages with `MMCA.Common.AI` among them (`:19`, `:22`), 136 fitness test methods across 53 abstract
  bases with MMCA.Common's own build executing 267 (`:48`, `:51`). Group G28 Common AI Integration, 12
  types, levels L0-L3 (`Website/docs-src/onboarding/00-group-taxonomy.md:82`, chapter
  `Website/docs-src/onboarding/group-27-common-ai-integration.md`).*
- *Consumer adoption, read this run: `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/MMCA.ADC.Conference.Infrastructure.csproj:19`
  and `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/MMCA.ADC.Conference.Service.csproj:27` take the
  package; `.../Sessions/Scoring/AnthropicScoringService.cs:9` is the one feature that calls a model; the
  Conference host registers the meter and trace source by name at
  `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:154-155` (section comment `:114`). A
  search of `MMCA.Store/Source` for `MMCA.Common.AI`, `Anthropic` or `Microsoft.Extensions.AI` returns
  matches only inside one `packages.lock.json`, and no Store source file.*

- Full series index: https://ivanball.github.io/writing.html
