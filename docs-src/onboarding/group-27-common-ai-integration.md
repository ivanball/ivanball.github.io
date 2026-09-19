# 27. Common AI Integration

**What this chapter covers.** This group is the framework's *language-model boundary*: the optional
`MMCA.Common.AI` package that turns a call to an LLM provider into an ordinary, governed external
dependency. Four questions shape every type in it. *What is this call allowed to do?* (a pinned
model, a clamped output ceiling, a wall-clock budget, a tool gate, an optional input ceiling).
*What may it say, and what may it answer?* (an application-supplied inspection point that can refuse
a request before the provider sees it, or a response before the caller does). *What did it cost, how
long did it take, and which prompt spent it?* (two token counters plus a latency histogram on one
framework-wide meter, all tagged by prompt name and version). *Which exact prompt produced this
answer?* (a versioned contract whose SHA-256 hash is what an evaluation gate records against). The
package answers all four with twelve types: a settings class and its provider enum, a composition
entry point that builds one delegating client pipeline, three delegating clients (bounds, then
guardrails, then metering), the three types the guardrail contract is made of (an interface, its
verdict struct and the exception a block raises), an optional estimator interface, a meter, and the
prompt contract. The decision record is
[ADR-120](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html), which extends
the feature-level record
[ADR-111](https://ivanball.github.io/docs/adr/111-ai-session-scoring-governance.html).

If you have not yet met the `extension(T)` DI convention or the fail-fast options pattern, skim
[primer section 4](00-primer.md#c-extensiont-types--read-this-once) first: this chapter composes both
and does not re-teach them.

`[Rubric section 16, AI-Native Application Architecture]` is the category this whole group exists to
answer. Section 16 asks whether a model dependency is isolated, versioned, evaluated, observed and
bounded in what it may do, rather than being a free-form HTTP call buried in a feature. The package's
shape is a literal reading of that list: isolation is the single `IChatClient` registration, versioning
is [PromptContract](#promptcontract), observation is [AiUsageMeter](#aiusagemeter), the configured
bounds are [BoundedChatClient](#boundedchatclient), and the content rules an application adds on top
of them are [IChatGuardrail](#ichatguardrail) run by
[GuardrailChatClient](#guardrailchatclient). `[Rubric section 2, Design Patterns]` also applies throughout,
because the mechanism is the decorator: every layer is a `DelegatingChatClient` wrapping the next.

## The configuration surface is the contract

[AiSettings](#aisettings) (`MMCA.Common/Source/Core/MMCA.Common.AI/AiSettings.cs:31`) binds from the
`Ai` section (`AiSettings.cs:34`) and holds every knob the package has: `Enabled` (`:48`), `Provider`
(`:51`), `Model` (`:59`), `ApiKey` (`:70`), `MaxOutputTokens` (`:77`, defaulting to 1024 at `:37` and
range-checked 1 to 1,000,000 at `:76`), `Timeout` (`:83`, defaulting to 30 seconds at `:40`),
`AllowTools` (`:90`), `EnableCache` (`:96`) and the optional `PerCallInputTokenBudget` (`:104`, range
1 to `int.MaxValue` at `:103`). Every one of those is a bound rather than a suggestion: the settings
doc comment says so outright (`AiSettings.cs:22-29`), and the runtime enforcement lives one layer out
in [BoundedChatClient](#boundedchatclient), so a caller cannot opt out by passing different
`ChatOptions`.

Validation is conditional, which is what lets the `Ai` section ship in every appsettings file.
`AiSettings` implements `IValidatableObject` (`AiSettings.cs:31`) and its `Validate` yields nothing
at all when `Enabled` is false (`:115-118`); once the dependency is switched on it requires `Model`
(`:120-125`), requires `ApiKey` (`:127-133`) and rejects a non-positive `Timeout` (`:135-140`). The
registration chains that onto `ValidateDataAnnotations().ValidateOnStart()`
(`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:92-95`), so a misconfigured host
fails at startup rather than on the first user request: the same fail-fast configuration contract the
rest of the framework follows
([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)).
`[Rubric section 11, Security]` is in play at `ApiKey`: the property is documented as binding from Key
Vault in production and from user secrets locally (`AiSettings.cs:63-68`), so the package itself never
decides where the secret comes from.

[AiProvider](#aiprovider) (`AiSettings.cs:11`) is the small enum naming the providers the package can
construct *for itself*, and today it has exactly one member, `Anthropic = 0` (`:17`). That is not a
ceiling on what a host can use: the enum's own doc comment points a host with another provider at the
factory overload of `AddMmcaChatClient` (`AiSettings.cs:6-9`), because the governance pipeline is
provider-agnostic and wraps whatever inner client it is handed.

## One entry point, one pipeline, outermost first

[AiServiceCollectionExtensions](#aiservicecollectionextensions)
(`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:57`) is the only composition surface.
It exposes two `AddMmcaChatClient` overloads inside an `extension(IServiceCollection services)` block
(`DependencyInjection.cs:59`), the framework's standard public DI shape
([ADR-106](https://ivanball.github.io/docs/adr/106-extension-members-as-public-di-surface.html)): the
one-argument form (`:67-68`) delegates to the factory form (`:82-84`) with a known provider factory,
so the Anthropic path is nothing more than the general path with its innermost client supplied.

The registration reads top to bottom as a policy. Bind and validate (`:92-95`). Then, if the section
is disabled, **return having registered no client at all** (`:97-101`). That absence is the API: a
consumer gates on `GetService<IChatClient>()` returning null rather than on reading a flag
(`DependencyInjection.cs:45-51`), so a feature whose key is missing in a given environment is off by
construction. When enabled, the meter is registered (`AddMetrics` plus
`TryAddSingleton<AiUsageMeter>()`, `:103-104`) and the client is built with `AddChatClient` followed
by `Use` calls, first-registered being outermost because `ChatClientBuilder` applies its factories in
reverse (`:106-128`). The resulting order, outermost first, is
[BoundedChatClient](#boundedchatclient), then the optional
[GuardrailChatClient](#guardrailchatclient), then
[UsageRecordingChatClient](#usagerecordingchatclient),
then optional distributed caching, then OpenTelemetry, then logging, then the provider client
(`DependencyInjection.cs:22-30`). The ordering is deliberate: bounds sit outside everything, so a
rejected call is rejected before anything logs or caches it; guardrails sit inside the bounds and
outside metering, because a blocked request never reaches the provider and so has no cost to record;
and a cache hit still records "what this call would have cost" (`:31-39`).

The guardrail layer is the one conditional wrapper, and how it is decided matters. The registration
adds it only when the collection already carries an `IChatGuardrail` service descriptor
(`:117-122`), and the check is a descriptor scan rather than a resolve, because building the layer
unconditionally would change the concrete type the container hands back for every application that
adopts no guardrail at all (`:114-116`, restated in the type's own remarks at `:40-44`). An app that
registers none therefore keeps exactly the chain it had.

Two details in that block are worth reading closely. Caching needs *both* halves, the `EnableCache`
switch and an actually-registered `IDistributedCache`, because a cache the host never registered would
turn every call into a resolve-time throw (`:130-135`). And `EnableSensitiveData` on the OpenTelemetry
layer is driven by `IsDevelopmentHost` (`:137-143`, implementation at `:192-196`), which fails closed:
an environment it cannot positively identify as Development reads as not-Development, so prompt and
completion text never reach telemetry by accident (`:186-191`). That is the same dev-only-relaxation
rule recorded in
[ADR-122](https://ivanball.github.io/docs/adr/122-dev-only-relaxations-fail-closed.html), and it is
`[Rubric section 11, Security]` and `[Rubric section 13, Observability and Operability]` pulling in
opposite directions with the safe default winning. The built-in provider path itself constructs an
`AnthropicClient` and adapts it with the official SDK's own `AsIChatClient`
(`DependencyInjection.cs:169-173`), so nothing here hand-rolls the Messages API over `HttpClient`;
an unrecognized provider throws a `NotSupportedException` that names the factory overload as the way
out (`:174-176`).

## The outer layer: what a call is allowed to do

[BoundedChatClient](#boundedchatclient)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/BoundedChatClient.cs:51`) is a `DelegatingChatClient`
that applies four bounds to both the buffered and the streaming path. `Bound` works on a **clone** of
the caller's options (`BoundedChatClient.cs:149`), clamps `MaxOutputTokens` down with `Math.Min`
(`:151-153`) so a caller asking for less keeps its smaller number, and nulls out `Tools` and
`ToolMode` while `AllowTools` is false (`:155-159`). `CreateLinkedTimeout` links the caller's token to
one cancelled after `Timeout` (`:164-169`), so neither cancellation source masks the other, and on the
streaming path the timeout deliberately covers the whole stream rather than just its first update
(`:104-111`). `[Rubric section 12, Performance and Scalability]` and
`[Rubric section 31, Cost and FinOps]` both live here: the output ceiling is a spend bound and the
timeout is a thread-occupancy bound.

The fourth bound is input size, and it is the one with a caveat baked into its own doc comment.
`EnforceInputBudget` (`:171-186`) runs only when `PerCallInputTokenBudget` is set, estimates the
request, and throws an `InvalidOperationException` naming the setting when the estimate exceeds it
(`:184-185`), which fails the call locally instead of paying for it remotely. The estimate comes from
the public static `EstimateInputTokens` (`:121-145`), which concatenates the options' instructions and
every message's text and then either defers to an [IAiTokenEstimator](#iaitokenestimator) or falls
back to one token per four characters (`:144`). [IAiTokenEstimator](#iaitokenestimator)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/IAiTokenEstimator.cs:14`) is optional and is resolved
*through the client pipeline* rather than from DI, via `this.GetService<IAiTokenEstimator>()`
(`BoundedChatClient.cs:178`), so any inner client that knows its provider's tokenizer can offer one.
The package declines to take a tokenizer dependency for this on purpose (`IAiTokenEstimator.cs:8-12`),
and the source is blunt that the number is a guardrail and not a billing figure: images, tool schemas,
provider-side system additions and non-Latin scripts are all under-counted
(`BoundedChatClient.cs:37-44`). The under-count direction is chosen too: it lets a call through, it
never blocks one that would have fit (`:141-144`). Both entry points bound and budget-check *eagerly*,
the streaming one outside the iterator (`:90-96`), so a forbidden request is refused when it is made,
not when somebody starts reading the stream.

## The middle layer: what the call may say, and what it may answer

Bounds are configuration, so the framework can decide them. Content is not, so it does not.
[IChatGuardrail](#ichatguardrail)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/IChatGuardrail.cs:20`) is the extension point an
application implements to inspect an outgoing request (`InspectRequestAsync`, `:27-30`) and a
completed response (`InspectResponseAsync`, `:37-40`), and the interface's own doc comment states the
split outright: the framework ships the extension point and no policy, because what counts as a
prompt injection, a leaked secret or a disallowed topic depends on the data the application holds and
the jurisdiction it runs in, so a content rule baked into a shared package would be wrong somewhere by
construction (`IChatGuardrail.cs:8-14`). Register one implementation per concern; all of them run and
the first block stops the call (`:12-13`). One operational caveat is recorded on the interface: a
guardrail runs on the hot path of every chat call and inherits the caller's cancellation token rather
than getting a budget of its own, so an implementation that calls a remote classifier has to carry its
own timeout (`:16-19`). `[Rubric section 11, Security]` and `[Rubric section 16]` both read this
extension point.

[GuardrailVerdict](#guardrailverdict)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/GuardrailVerdict.cs:13`) is the answer type: a
`readonly record struct` with `IsAllowed` (`:28`) and an optional `Reason` (`:34`), built either from
the static `Allow` (`:25`) or from `Block(reason)`, which rejects a null-or-whitespace reason outright
(`:39-44`). It is a struct because a guardrail answers on every call and the common answer carries no
payload (`:7-9`), and the `default` value is deliberately a *block* carrying the
`UnspecifiedReason` constant (`:16`), so a half-built verdict fails closed rather than silently
admitting the request (`:9-12`). That is the same fail-closed default the OpenTelemetry sensitive-data
gate uses one layer out, applied to a different question.

[GuardrailChatClient](#guardrailchatclient)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/GuardrailChatClient.cs:21`) is the `DelegatingChatClient`
that runs them, holding the registered guardrails as an array materialized once in the constructor
(`:23,:32`). On the buffered path it inspects the request, calls through, then inspects the response
(`:36-62`); a block on either side throws
[ChatGuardrailException](#chatguardrailexception) carrying the verdict's reason, falling back to
`GuardrailVerdict.UnspecifiedReason` when a block supplied none (`:57`, `:100`). The caller's messages
are materialized once before anything reads them (`:43`, helper at `:80-85`), so the guardrails and
the inner client cannot see two different sequences when a caller hands in a lazily generated one
(`:41-42`). The streaming path inspects the **request only** (`:65-78`), and the remarks say why:
inspecting a streamed answer would mean buffering it to the end, which defeats the reason a caller
chose streaming, so an application that needs response inspection on streamed output buffers at its
own call site (`:16-19`).
[ChatGuardrailException](#chatguardrailexception)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/ChatGuardrailException.cs:12`) is a sealed exception
with the three conventional constructors (`:15`, `:22`, `:30`), the parameterless one defaulting its
message to `UnspecifiedReason` (`:16`). A refusal is an exception rather than an empty response so it
cannot be mistaken for the model having nothing to say, and so a caller wanting a graceful fallback
catches this one type (`ChatGuardrailException.cs:7-11`). No host in `MMCA.ADC/Source` registers a
guardrail today, so in the deployed workspace this layer is absent from the pipeline by the descriptor
check above.

## The inner layer: what the call actually cost

[UsageRecordingChatClient](#usagerecordingchatclient)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/UsageRecordingChatClient.cs:30`) sits inside the
guardrails and reports the provider's own numbers. On the buffered path it records after awaiting the
response (`:73-78`), passing `response.Usage`, the model (`response.ModelId` falling back to the
options' `ModelId`, `:75`) and the prompt identity read back off the options (`:76-77`). On the
streaming path it accumulates from the update stream, recording whenever a `UsageContent` item appears
(`:127`, helper at `:143-154`), which is how providers typically deliver usage on a final update. The
split of responsibility with the outer layer is stated in its remarks (`:11-15`): a bound has to be
decided before the call, a cost has to be measured after it.

It also measures the call. A `Stopwatch` timestamp is taken on entry to both paths (`:53`, `:89`) and
the elapsed time is reported to the meter's latency histogram with an `outcome` of `success`, `error`
or `canceled` (`RecordDuration`, `:159-166`). The buffered path classifies through two catch clauses
that re-throw (`:60-69`) and records `success` only after the call returned (`:71`); the streaming
path drives the inner enumerator by hand instead of using `await foreach`, because the outcome has to
be attributed and C# forbids a `yield return` inside a `try` that has a `catch`, so the duration is
written in a `finally` (`:93-97`, `:132-136`). The stream *ending* is what stops the clock, which is
the number a caller of a streaming API actually feels (`:95`). Recording on the failure paths too is
the point: a failure rate and a latency distribution then come off one series (`:21-27`).

[AiUsageMeter](#aiusagemeter)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Observability/AiUsageMeter.cs:20`) owns all three
instruments: the counters `mmca.ai.input_tokens` (`:29`) and `mmca.ai.output_tokens` (`:32`), and the
histogram `mmca.ai.call.duration` in seconds (`:45`, created at `:85-88`). They are published under
the meter name `MMCA.Common.AI` (`:26`), which is the same name the pipeline's OpenTelemetry layer
uses as its activity source (`DependencyInjection.cs:141`), so one name enables both traces and
metrics. Every adopting app reports to that same meter, which is what makes one dashboard query cover
every service (`AiUsageMeter.cs:12-18`). `Record` (`:101-124`) and `RecordDuration` (`:137-149`) share
one tag builder, so the cost series and the latency series join on the same dimensions: `model`,
`prompt_name`, `prompt_version` and `provider` (`:155-165`), with `outcome` added for the histogram
only (`:146`). `Record` is careful in two places: a null usage records nothing (`:108-111`) and a
count the provider did not report is skipped rather than written as zero (`:115-123`), because an
absent number must not read as a zero on a spend dashboard (`:91-95`). The duration histogram does not
replace `gen_ai.client.operation.duration`, which the Microsoft.Extensions.AI OpenTelemetry layer
already publishes on this same meter: the standard instrument carries the GenAI semantic-convention
dimensions, this one carries the prompt identity and the outcome, so a latency regression can be
attributed to the prompt that caused it (`:34-44`). The meter is created through `IMeterFactory` and
deliberately neither retained nor disposed (`:72-88`, rationale at `:62-67`), since disposing a
factory-owned meter would kill the instrument for every other holder of the name.
`[Rubric section 13, Observability and Operability]`.

## The prompt is a versioned artifact

[PromptContract](#promptcontract) (`MMCA.Common/Source/Core/MMCA.Common.AI/PromptContract.cs:23`) is a
sealed record of the four things that decide what a model will answer: `Name`, `Version`, `Model` and
`SystemPrompt`. Its `Hash` (`:46`) is the lowercase hex SHA-256 of those four joined by a pipe
character (`:90-100`), with every component's line endings normalized to LF first (`:102-103`) so a
Windows checkout and a Linux checkout of the same prompt hash identically and a CI gate cannot be
tripped by `core.autocrlf`. The hash is computed on each read rather than cached, and the reason is
recorded in the remarks (`:40-45`): a record's generated copy constructor copies fields verbatim, so a
cached hash would survive a `with` expression and describe the prompt the copy was made *from*.

That hash is the evaluation hook. `ToChatOptions` (`:53-54`) builds fresh options carrying the model
and the system prompt as instructions, `Apply` (`:62-72`) stamps `mmca.prompt.name`,
`mmca.prompt.version` and `mmca.prompt.hash` (`:26,29,32`) onto options a caller already built, and the
static `ReadName` / `ReadVersion` (`:77,82`) are what
[UsageRecordingChatClient](#usagerecordingchatclient) calls to turn a spend number into a per-prompt
signal. Change any of the four components and the hash moves, so a golden-replay gate that recorded
answers for the old hash demands a re-evaluation instead of silently approving a prompt nobody scored
(`PromptContract.cs:11-17`). ADC's evaluation suite does exactly that, pinning a recorded hash in
`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Scoring.Evaluation.Tests/PromptContractTests.cs:104`.
`[Rubric section 16]` again, and this is the part of it most systems skip.

## Where it runs today, and how it is tested

Exactly one feature in the workspace calls a model: ADC's organizer-facing session scoring. The
Conference service host registers the client with a single
`builder.Services.AddMmcaChatClient(builder.Configuration)` call
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:135`) and subscribes the framework
meter and activity source by literal name (`Program.cs:154-155`); the host also bridges the
already-deployed `Anthropic:ApiKey`
secret onto `Ai:ApiKey` and derives `Ai:Enabled` from its presence (`Program.cs:129-133`), so no live
Key Vault secret had to be renamed. On the module side,
[AnthropicScoringService](group-19-conference-infrastructure.md#anthropicscoringservice)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AnthropicScoringService.cs:9`)
consumes the injected `IChatClient` and `PromptContract`, and Conference's Infrastructure registration
resolves the client with `GetService` rather than `GetRequiredService` precisely because the disabled
host registers none
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:35-38`).
`[Rubric section 3, Clean Architecture]`: an ADC architecture fitness test asserts that Infrastructure
is the only layer naming a language-model SDK type or the package
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Layering/AiDependencyIsolationTests.cs:5`).

`[Rubric section 14, Testability]` is served by the factory overload. Because the innermost client is
just a `Func<IServiceProvider, IChatClient>` (`DependencyInjection.cs:74-76`), the whole governance
pipeline can be exercised with no network at all, which is what the package's own suite does:
`MMCA.Common/Tests/Core/MMCA.Common.AI.Tests` holds `AiServiceCollectionExtensionsTests`,
`AiSettingsTests`, `BoundedChatClientTests`, `GuardrailChatClientTests`, `PromptContractTests` and
`UsageRecordingChatClientTests`. A guardrail is equally cheap to test, being a two-method interface
over in-memory types.
Read the per-type sections next in level order: the Level 0 contracts
([AiProvider](#aiprovider), [PromptContract](#promptcontract), [GuardrailVerdict](#guardrailverdict),
[IAiTokenEstimator](#iaitokenestimator)) first, then the Level 1 types
([AiSettings](#aisettings), [AiUsageMeter](#aiusagemeter),
[ChatGuardrailException](#chatguardrailexception), [IChatGuardrail](#ichatguardrail)), then the three
clients, and finally the registration that assembles them.

### AiProvider
> MMCA.Common.AI · `MMCA.Common.AI` · `MMCA.Common/Source/Core/MMCA.Common.AI/AiSettings.cs:11` · Level 0 · enum

- **What it is**: the enum of language-model providers the governed chat-client pipeline can build a
  client for. Today it has exactly one member, `Anthropic = 0` (`AiSettings.cs:31`, doc comment
  `AiSettings.cs:28-30`): Anthropic's Messages API, constructed through the official Anthropic .NET SDK
  and adapted to `IChatClient` by that SDK's own `AsIChatClient` extension.
- **Depends on**: nothing first-party.
- **Concept introduced, the provider switch.** `[Rubric §16, AI-Native Application Architecture]`
  (assesses whether LLM integration is a governed, swappable dependency rather than a hard-wired SDK
  call): the enum exists so `AiSettings.Provider` (`AiSettings.cs:199`) and
  [`AiServiceCollectionExtensions`](#aiservicecollectionextensions)'s provider switch
  (`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:766-781`) can select an implementation
  by configuration value instead of by type reference, even though only one arm is implemented today.
- **Walkthrough**: a single explicit member, `Anthropic = 0`, so it is also the implicit default of
  `AiSettings.Provider` (`AiSettings.cs:199`).
- **Why it's built this way**: a `switch` on this enum in
  `AiServiceCollectionExtensions.CreateProviderChatClient` (`DependencyInjection.cs:766-781`) throws
  `NotSupportedException` for any unimplemented value and directs the caller to the
  `Func<IServiceProvider, IChatClient>` overload instead, so an unsupported provider fails at startup
  with an actionable message rather than a null-reference deep in the pipeline. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html) for the
  governed-boundary rationale this enum feeds into.
- **Where it's used**: [`AiSettings.Provider`](#aisettings) (`AiSettings.cs:199`), the
  [`UsageRecordingChatClient`](#usagerecordingchatclient) constructor's `provider` parameter
  (`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/UsageRecordingChatClient.cs:662`), and the tag
  [`AiUsageMeter.Record`](#aiusagemeter) stamps on every measurement
  (`MMCA.Common/Source/Core/MMCA.Common.AI/Observability/AiUsageMeter.cs:443`).

---

### GuardrailVerdict
> MMCA.Common.AI.Chat · `MMCA.Common.AI.Chat` · `MMCA.Common/Source/Core/MMCA.Common.AI/Chat/GuardrailVerdict.cs:13` · Level 0 · record struct

- **What it is**: the allow/block outcome a chat guardrail returns for one inspected request or
  response: `IsAllowed` plus an optional `Reason` (`GuardrailVerdict.cs:39,46`), built only through the
  two factory members `Allow` and `Block(reason)` (`GuardrailVerdict.cs:37,51-56`).
- **Depends on**: nothing first-party beyond `IChatGuardrail`, which returns it.
- **Concept introduced, a closed allow/block gate.** `[Rubric §11, Security]` (assesses whether content
  passing through an AI dependency is inspected and the inspection outcome cannot be misconstructed): the
  constructor is `private`, so the only way to produce a blocking verdict is `Block(string reason)`, which
  throws on a null or whitespace reason (`GuardrailVerdict.cs:51-56`); a caller cannot construct a blocked
  verdict that silently carries no explanation.
- **Walkthrough**: `Allow` (`GuardrailVerdict.cs:37`) is a static property returning
  `new(isAllowed: true, reason: null)`. `Block(reason)` (`GuardrailVerdict.cs:51-56`) validates the reason
  with `ArgumentException.ThrowIfNullOrWhiteSpace` before constructing `isAllowed: false`. The constant
  `UnspecifiedReason` (`GuardrailVerdict.cs:28`) exists for the struct's own `default` value, whose `Reason`
  is `null` because it went through neither factory.
- **Why it's built this way**: a record struct keeps every inspection call allocation-free, which matters
  because a guardrail runs on every request and every response, not just the ones it blocks. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html) for the guardrail
  pipeline this verdict gates.
- **Where it's used**: returned by [`IChatGuardrail`](#ichatguardrail)'s two inspection methods; consumed
  by [`GuardrailChatClient`](#guardrailchatclient), which throws
  [`ChatGuardrailException`](#chatguardrailexception) with `verdict.Reason ?? GuardrailVerdict.UnspecifiedReason`
  when `IsAllowed` is `false`.

---

### IAiTokenEstimator
> MMCA.Common.AI.Chat · `MMCA.Common.AI.Chat` · `MMCA.Common/Source/Core/MMCA.Common.AI/Chat/IAiTokenEstimator.cs:14` · Level 0 · interface

- **What it is**: a one-method extension point for estimating how many input tokens a piece of prompt
  text will cost: `int EstimateTokenCount(string text)` (`IAiTokenEstimator.cs:57`).
- **Depends on**: nothing first-party beyond the caller that resolves it.
- **Concept introduced, a pluggable estimator behind a cheap built-in default.**
  `[Rubric §1, SOLID]` (assesses whether a dependency is inverted behind an abstraction rather than
  hard-coded): [`BoundedChatClient`](#boundedchatclient) resolves this interface from DI
  (`this.GetService<IAiTokenEstimator>()`, `MMCA.Common/Source/Core/MMCA.Common.AI/Chat/BoundedChatClient.cs:541`)
  and falls back to a built-in heuristic when nothing is registered
  (`BoundedChatClient.EstimateInputTokens`, `BoundedChatClient.cs:507`), so a host that wants
  provider-accurate tokenization can register a real tokenizer without changing the bounding logic.
- **Walkthrough**: the interface has no other members; the contract is the single method plus its two
  doc-comment lines describing the parameter and return value (`IAiTokenEstimator.cs:54-56`).
- **Why it's built this way**: `BoundedChatClient.EstimateInputTokens` is `public static` precisely so a
  caller (or the estimator implementation itself) can reproduce the same estimate the budget check uses
  (`BoundedChatClient.cs:484-508`), and it deliberately rounds up with a cheap four-characters-per-token
  heuristic when no estimator is registered, an under-count that only ever lets a call through, never
  blocks one that would have fit (`BoundedChatClient.cs:504-507`).
- **Where it's used**: [`BoundedChatClient.EnforceInputBudget`](#boundedchatclient)
  (`BoundedChatClient.cs:534-549`) is the only production call site; the test fixture
  `MMCA.Common/Tests/Core/MMCA.Common.AI.Tests/Fixtures/StubChatClient.cs` supplies a stub implementation
  for unit tests.
- **Caveats / not-in-source**: no built-in implementation ships in `MMCA.Common.AI`; every consumer today
  relies on the character-based fallback rather than registering one.

---

### PromptContract
> MMCA.Common.AI · `MMCA.Common.AI` · `MMCA.Common/Source/Core/MMCA.Common.AI/PromptContract.cs:23` · Level 0 · record

- **What it is**: an immutable, hashable identity for one prompt: `Name`, `Version`, `Model`,
  `SystemPrompt` (`PromptContract.cs:78`). It both builds the `ChatOptions` a call needs
  (`ToChatOptions`, `PromptContract.cs:108-109`) and stamps its own identity onto telemetry so every
  call can be traced back to the exact prompt that produced it.
- **Depends on**: `ChatOptions` (Microsoft.Extensions.AI), `System.Security.Cryptography.SHA256`, and
  `System.Text.Encoding`.
- **Concept introduced, prompt-as-versioned-contract.** `[Rubric §16, AI-Native Application
  Architecture]` (assesses whether prompts are governed, versioned artifacts rather than inline
  strings): the record's `Hash` property (`PromptContract.cs:101`) is a lowercase hex SHA-256 of
  `Name|Version|Model|SystemPrompt`, with every component's line endings normalized to LF first
  (`NormalizeLineEndings`, `PromptContract.cs:157-158`) so the same prompt checked out on Windows and on
  Linux hashes identically and a CI gate cannot be tripped by `core.autocrlf` (`PromptContract.cs:90-93`).
  The three identity values are stamped onto `ChatOptions.AdditionalProperties` under fixed keys
  (`NamePropertyKey`/`VersionPropertyKey`/`HashPropertyKey`, `PromptContract.cs:81-87`), so a request
  carries its own provenance through the pipeline into telemetry.
- **Walkthrough**: `Hash` (`PromptContract.cs:101`) is computed on every read, deliberately not cached in
  a field, because a record's generated copy constructor copies fields verbatim and a cached hash would
  survive a `with` expression describing the prompt the copy was made FROM (`PromptContract.cs:96-100`,
  exactly the drift the type exists to prevent). `ToChatOptions` (`PromptContract.cs:108-109`) builds a
  fresh `ChatOptions` with `ModelId` and `Instructions` set, then delegates to `Apply`. `Apply`
  (`PromptContract.cs:117-127`) stamps `Name`, `Version`, and `Hash` onto an existing `ChatOptions` in
  place and returns it for chaining, for a caller that already built options and needs its own
  temperature or response format alongside the prompt identity. `ReadName`/`ReadVersion`
  (`PromptContract.cs:132,137`) and the private `ReadProperty` (`PromptContract.cs:139-143`) reverse the
  stamp, reading back whatever `Apply` wrote (or `null` when nothing was stamped).
- **Why it's built this way**: hashing four short strings on every read is cheap enough that correctness
  wins outright over caching (`PromptContract.cs:96-100`). See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html) for how this
  identity feeds the governed pipeline, and
  [`ADR-111`](https://ivanball.github.io/docs/adr/111-ai-session-scoring-governance.html) for a concrete
  scoring consumer.
- **Where it's used**: [`UsageRecordingChatClient`](#usagerecordingchatclient) reads the stamped name and
  version back off `ChatOptions` to tag every usage measurement
  (`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/UsageRecordingChatClient.cs:681-682,707-708`); ADC's
  `AnthropicScoringService`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AnthropicScoringService.cs`)
  is the production caller that builds a `PromptContract` for session scoring, and ADC's architecture
  fitness test `AiDependencyIsolationTests`
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Layering/AiDependencyIsolationTests.cs`)
  asserts the isolation boundary this contract type crosses.

---

### AiSettings
> MMCA.Common.AI · `MMCA.Common.AI` · `MMCA.Common/Source/Core/MMCA.Common.AI/AiSettings.cs:31` · Level 1 · class

- **What it is**: the bound, validated `Ai` configuration section (`SectionName = "Ai"`,
  `AiSettings.cs:182`) that gates and configures the entire AI integration: whether it is on at all
  (`Enabled`, `AiSettings.cs:196`), which provider and model to call
  (`Provider`/`Model`, `AiSettings.cs:199,207`), the API key, the output-token ceiling, the per-call
  timeout, and two opt-ins (`AllowTools`, `EnableCache`) plus an optional input-token pre-flight budget.
- **Depends on**: `System.ComponentModel.DataAnnotations` (`IValidatableObject`, `[Range]`); no
  first-party dependency of its own, though its doc comments name `AddCommonKeyVaultConfiguration` and
  `Persistence:EnableSensitiveDataLogging` as sibling conventions elsewhere in Common.
- **Concept introduced, an off-by-default dependency with conditional validation.**
  `[Rubric §16, AI-Native Application Architecture]` (assesses whether an LLM dependency is safe to ship
  in every environment): `Enabled` defaults to `false`, and when it is false `AddMmcaChatClient`
  registers no `IChatClient` at all, so resolving one yields `null` and a consumer gates on the service
  being present rather than reading a flag itself (`AiSettings.cs:190-196`). `[Rubric §11, Security]`
  (assesses secret handling): `ApiKey` is required only when `Enabled`, and its doc comment records that
  production binds it from Key Vault via `AddCommonKeyVaultConfiguration`, never from a checked-in
  settings file (`AiSettings.cs:209-218`).
- **Walkthrough**: two constants, `DefaultMaxOutputTokens = 1024` (`AiSettings.cs:185`) and
  `DefaultTimeout = TimeSpan.FromSeconds(30)` (`AiSettings.cs:188`), back the two settings that ship with
  a value even when the section is silent. `Model` is required when `Enabled` because it is part of the
  prompt contract, hashed into `PromptContract.Hash`, so an implicit provider default would silently
  change evaluated behavior on the provider's own schedule rather than on a reviewed version bump
  (`AiSettings.cs:201-206`). `MaxOutputTokens` (`[Range(1, 1_000_000)]`, `AiSettings.cs:224-225`) is the
  hard ceiling `BoundedChatClient.Bound` clamps every call down to. `Timeout` (`AiSettings.cs:231`) is
  enforced with a token linked to the caller's own, so a caller cancelling early still wins.
  `PerCallInputTokenBudget` (`[Range(1, int.MaxValue)]`, `AiSettings.cs:251-252`) is `null` by default,
  leaving input unbounded, and is an ESTIMATE never a billing figure. `Validate`
  (`AiSettings.cs:261-289`) is the conditional half: it `yield break`s immediately when `!Enabled`
  (`AiSettings.cs:263-266`), so a host that leaves AI off is valid with nothing else set, which is what
  lets the section ship in every `appsettings` file; when enabled it requires `Model`, `ApiKey`, and a
  positive `Timeout` (`AiSettings.cs:268-288`).
- **Why it's built this way**: `IValidatableObject.Validate` runs through
  `.ValidateDataAnnotations().ValidateOnStart()` in `AiServiceCollectionExtensions.AddMmcaChatClient`
  (`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:708-711`), so a misconfigured `Ai`
  section fails at host startup, not on the first call. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: bound and consumed by [`AiServiceCollectionExtensions`](#aiservicecollectionextensions)
  (`DependencyInjection.cs:706-732,764`), enforced by [`BoundedChatClient`](#boundedchatclient)
  (`BoundedChatClient.cs:416-426,510-549`), and its `Provider` value is threaded into
  [`UsageRecordingChatClient`](#usagerecordingchatclient) (`DependencyInjection.cs:732`).

---

### AiUsageMeter
> MMCA.Common.AI.Observability · `MMCA.Common.AI.Observability` · `MMCA.Common/Source/Core/MMCA.Common.AI/Observability/AiUsageMeter.cs:20` · Level 1 · class

- **What it is**: the `System.Diagnostics.Metrics` wrapper that records token usage and call latency for
  the AI dependency: two `Counter<long>` instruments (input and output tokens) plus a `Histogram<double>`
  for end-to-end call duration in seconds (`AiUsageMeter.cs:56-58`).
- **Depends on**: `System.Diagnostics.Metrics` (`Meter`, `Counter<long>`, `Histogram<double>`, `TagList`),
  `IMeterFactory` (Microsoft.Extensions.Diagnostics.Metrics), and `Microsoft.Extensions.AI.UsageDetails`.
- **Concept introduced, factory-owned meter lifetime.** `[Rubric §13, Observability & Operability]`
  (assesses whether a dependency's cost/usage is measurable in production): the constructor takes
  `IMeterFactory` and creates its `Meter` through it, but deliberately does NOT retain or dispose that
  meter itself (`AiUsageMeter.cs:72-89`); the factory owns the meter's lifetime, and disposing a
  factory-owned meter from a consumer would silently kill the instrument for every other holder of the
  same name, so this type is not `IDisposable`, matching how the rest of the framework's meters work
  (`AiUsageMeter.cs:60-66`, `[SuppressMessage("CA2000", ...)]` at `AiUsageMeter.cs:68-71` documents
  the deliberate suppression).
- **Walkthrough**: `MeterName = "MMCA.Common.AI"` (`AiUsageMeter.cs:26`) is shared with the
  `ActivitySource` name the pipeline's OpenTelemetry layer publishes under
  (`AiUsageMeter.MeterName` reused at `DependencyInjection.cs:141`), so a host enables traces and metrics
  for the AI dependency with one name. `InputTokensCounterName`/`OutputTokensCounterName`
  (`AiUsageMeter.cs:29,32`, `mmca.ai.input_tokens`/`mmca.ai.output_tokens`) name the two counters, and
  `CallDurationHistogramName` (`AiUsageMeter.cs:45`, `mmca.ai.call.duration`) names the histogram; its doc
  comment records that Microsoft.Extensions.AI's own `UseOpenTelemetry` layer already publishes
  `gen_ai.client.operation.duration` on the same meter, and this instrument does not replace it, it adds
  the `prompt_name`/`prompt_version`/`outcome` dimensions that let a latency regression be attributed to
  the prompt that caused it (`AiUsageMeter.cs:34-44`). `Record`
  (`AiUsageMeter.cs:101-124`) takes a possibly-`null` `UsageDetails`, model, prompt name/version, and
  provider; a `null` usage, or one whose counts the provider did not report, records nothing (an absent
  number must not read as a zero on a spend dashboard, `AiUsageMeter.cs:108-111,115-122`). `RecordDuration`
  (`AiUsageMeter.cs:137-149`) records the elapsed seconds on every call, including one that threw, tagged
  with the same attribution dimensions plus an `outcome` of `SuccessOutcome`, `ErrorOutcome`, or
  `CanceledOutcome` (`AiUsageMeter.cs:48,51,54`), so a failure rate and a latency distribution come off one
  series. Both methods share their tagging through the private `AttributionTags`
  (`AiUsageMeter.cs:155-165`, `model`/`prompt_name`/`prompt_version` each falling back to `"unknown"`, and
  `provider`), so a dashboard can join the cost series and the latency series on the same tags.
- **Why it's built this way**: recording input and output as two separate counters, tagged by model and
  prompt identity, lets a spend dashboard break down cost by exactly the dimensions a prompt-versioning
  workflow cares about; the duration histogram carries the same dimensions plus outcome so the same join
  works for latency and failure rate. See
  [`ADR-041`](https://ivanball.github.io/docs/adr/041-observability-and-telemetry.html)
  for the framework's general telemetry conventions and
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html) for this
  meter's place in the governed pipeline.
- **Where it's used**: registered as a singleton and resolved by
  [`AiServiceCollectionExtensions`](#aiservicecollectionextensions) (`DependencyInjection.cs:104,127`);
  `Record` and `RecordDuration` are called exclusively from
  [`UsageRecordingChatClient`](#usagerecordingchatclient), which stops the clock in a `try`/`finally` so
  every outcome, including a cancellation or an exception, is recorded.

---

### ChatGuardrailException
> MMCA.Common.AI.Chat · `MMCA.Common.AI.Chat` · `MMCA.Common/Source/Core/MMCA.Common.AI/Chat/ChatGuardrailException.cs:12` · Level 1 · class

- **What it is**: the exception [`GuardrailChatClient`](#guardrailchatclient) throws when a guardrail
  blocks a call: three constructors following the standard .NET exception pattern (parameterless,
  message, message plus inner exception, `ChatGuardrailException.cs:14,20,27`), with the parameterless
  form defaulting its message to [`GuardrailVerdict.UnspecifiedReason`](#guardrailverdict)
  (`ChatGuardrailException.cs:15`).
- **Depends on**: [`GuardrailVerdict`](#guardrailverdict) (for its default message only) and `System.Exception`.
- **Walkthrough**: no members beyond the three constructors; it carries no state of its own, the blocked
  reason travels as the base `Exception.Message`.
- **Why it's built this way**: a dedicated exception type, rather than a generic
  `InvalidOperationException`, lets a caller catch guardrail blocks specifically without also catching
  every other failure the pipeline can throw. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: thrown by [`GuardrailChatClient`](#guardrailchatclient) from both
  `InspectRequestAsync` and the response-side check, always with `verdict.Reason ??
  GuardrailVerdict.UnspecifiedReason` as the message.

---

### IChatGuardrail
> MMCA.Common.AI.Chat · `MMCA.Common.AI.Chat` · `MMCA.Common/Source/Core/MMCA.Common.AI/Chat/IChatGuardrail.cs:20` · Level 1 · interface

- **What it is**: the extension point a host implements to inspect chat traffic before it reaches the
  model and after the model answers: `InspectRequestAsync` and `InspectResponseAsync`, each returning a
  [`GuardrailVerdict`](#guardrailverdict) (`IChatGuardrail.cs:26-29,36-40`).
- **Depends on**: [`GuardrailVerdict`](#guardrailverdict), `Microsoft.Extensions.AI.ChatMessage`/`ChatOptions`/`ChatResponse`.
- **Concept introduced, guardrail as a resolved multi-instance dependency.** `[Rubric §11, Security]`
  (assesses whether content passing through an AI dependency is inspected before and after the model):
  every registered implementation runs, in registration order, on both the outgoing request and the
  completed response (`GuardrailChatClient.cs:34-38,55-58`); a host that registers none pays no cost, see
  [`AiServiceCollectionExtensions`](#aiservicecollectionextensions)'s descriptor check.
- **Walkthrough**: `InspectRequestAsync` (`IChatGuardrail.cs:26-29`) takes the materialized message list
  and the call's options, returning a verdict; a block here stops the call before the provider is reached.
  `InspectResponseAsync` (`IChatGuardrail.cs:36-40`) takes the completed `ChatResponse` and the same
  options; a block here stops the response from reaching the caller after the provider call already ran.
- **Why it's built this way**: two separate inspection points, rather than one, let an implementation
  block on prompt-injection patterns in the request and separately on unsafe content in the answer, which
  are different failure modes with different signals. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: resolved from DI by [`GuardrailChatClient`](#guardrailchatclient); no built-in
  implementation ships in `MMCA.Common.AI`.
- **Caveats / not-in-source**: no production implementation is present in this codebase; the test fixture
  `MMCA.Common/Tests/Core/MMCA.Common.AI.Tests/Fixtures/StubGuardrail.cs` supplies one for unit tests.

---

### BoundedChatClient
> MMCA.Common.AI.Chat · `MMCA.Common.AI.Chat` · `MMCA.Common/Source/Core/MMCA.Common.AI/Chat/BoundedChatClient.cs:51` · Level 2 · class

- **What it is**: a `DelegatingChatClient` (Microsoft.Extensions.AI) that enforces the governance bounds
  from [`AiSettings`](#aisettings) on every call: output-token clamping, tool stripping, a linked
  per-call timeout, and an optional input-token pre-flight budget.
- **Depends on**: `Microsoft.Extensions.AI.DelegatingChatClient`/`IChatClient`/`ChatOptions`,
  [`AiSettings`](#aisettings), [`IAiTokenEstimator`](#iaitokenestimator) (resolved, not injected),
  `System.Globalization.CultureInfo`, `System.Text.StringBuilder`.
- **Concept introduced, a governance layer as a chat-client decorator.** `[Rubric §12, Performance &
  Scalability]` (assesses whether a resource-bounded dependency is protected against runaway cost or
  latency): every bound applied here (output tokens, timeout, input budget) exists to keep one call from
  exceeding what the host budgeted for it. `[Rubric §29, Resilience & Business Continuity]` (assesses
  whether an external dependency is time-bounded): the linked `CancellationTokenSource`
  (`CreateLinkedTimeout`, `BoundedChatClient.cs:527-532`) guarantees the provider call cannot hang past
  `AiSettings.Timeout` regardless of what the caller's own token does. This is the first client wrapped
  in [`AiServiceCollectionExtensions`](#aiservicecollectionextensions)'s pipeline, matching the
  outermost-first ordering the type's own remarks describe (`DependencyInjection.cs:722-723`).
- **Walkthrough**: the constructor takes the inner client and the `AiSettings` to enforce
  (`BoundedChatClient.cs:421-426`). `GetResponseAsync` (`BoundedChatClient.cs:429-443`) materializes the
  message enumerable once, calls `Bound` to clamp options, calls `EnforceInputBudget`, then races the
  base call against a linked timeout. `GetStreamingResponseAsync`
  (`BoundedChatClient.cs:446-460`) bounds and budget-checks eagerly, OUTSIDE the iterator method
  `StreamBoundedAsync`, so a request the configuration forbids is refused when it is made, not when
  somebody starts reading the stream (`BoundedChatClient.cs:453-454`); `StreamBoundedAsync`
  (`BoundedChatClient.cs:462-475`) then wraps the whole stream, not just its first update, in the linked
  timeout, because a provider that opens a response and then stalls is exactly the failure mode a
  per-call budget exists to bound (`BoundedChatClient.cs:469-470`). The static
  `EstimateInputTokens` (`BoundedChatClient.cs:484-508`) concatenates `options.Instructions` plus every
  message's text and either runs the resolved `IAiTokenEstimator` or falls back to a four-characters-
  per-token heuristic (`BoundedChatClient.cs:504-507`). `Bound` (`BoundedChatClient.cs:510-525`) clones
  the incoming `ChatOptions`, clamps `MaxOutputTokens` to the smaller of the request's own value and
  `_settings.MaxOutputTokens`, and nulls out `Tools`/`ToolMode` entirely when `AllowTools` is false: a
  model that cannot be handed a tool cannot be talked into using one (`BoundedChatClient.cs:233-237`
  in `AiSettings`). `EnforceInputBudget` (`BoundedChatClient.cs:534-549`) is a no-op when
  `PerCallInputTokenBudget` is unset, otherwise it estimates and throws `InvalidOperationException` with
  the estimated count, the configured budget, and a reminder that the estimate is approximate when the
  estimate exceeds the budget.
- **Why it's built this way**: bounding happens BEFORE the linked timeout is created and BEFORE the base
  call, so a call this client is going to refuse never reaches the network. Clamping the smaller of the
  request's and the settings' `MaxOutputTokens`, rather than always overriding, lets a caller ask for
  less without losing that choice. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: registered first (outermost is applied last by `ChatClientBuilder`, so it ends up
  wrapping everything but `UsageRecordingChatClient`) by
  [`AiServiceCollectionExtensions.AddMmcaChatClient`](#aiservicecollectionextensions)
  (`DependencyInjection.cs:726-728`).

---

### GuardrailChatClient
> MMCA.Common.AI.Chat · `MMCA.Common.AI.Chat` · `MMCA.Common/Source/Core/MMCA.Common.AI/Chat/GuardrailChatClient.cs:21` · Level 2 · class

- **What it is**: a `DelegatingChatClient` that runs every registered
  [`IChatGuardrail`](#ichatguardrail) over a call's request and response, throwing
  [`ChatGuardrailException`](#chatguardrailexception) on the first block.
- **Depends on**: `Microsoft.Extensions.AI.DelegatingChatClient`/`IChatClient`/`ChatMessage`,
  [`IChatGuardrail`](#ichatguardrail), [`GuardrailVerdict`](#guardrailverdict),
  [`ChatGuardrailException`](#chatguardrailexception).
- **Concept introduced, cross-referenced.** `[Rubric §11, Security]`: same category as
  [`IChatGuardrail`](#ichatguardrail); this type is the pipeline stage that actually calls every
  registered guardrail and turns a block into a thrown exception.
- **Walkthrough**: the constructor materializes the injected `IEnumerable<IChatGuardrail>` into an array
  once (`GuardrailChatClient.cs:28-33`). `GetResponseAsync` (`GuardrailChatClient.cs:36-62`) materializes
  the message enumerable, inspects the request through every guardrail (`InspectRequestAsync` private
  helper, `GuardrailChatClient.cs:87-103`), calls the base client, then inspects the response through
  every guardrail before returning it, throwing on the first `IsAllowed: false` verdict either side
  (`GuardrailChatClient.cs:55-60`). `GetStreamingResponseAsync` (`GuardrailChatClient.cs:65-78`) inspects
  the request the same way but does NOT inspect the streamed response: it only guards the request side,
  because a stream is read incrementally and there is no single completed `ChatResponse` to inspect before
  yielding starts. The private `Materialize` (`GuardrailChatClient.cs:80-85`) avoids re-enumerating a
  caller's lazily generated sequence, the same message list must reach both the guardrails and the inner
  client.
- **Why it's built this way**: request and response inspection both run BEFORE the caller sees anything,
  for the response side, before `GetResponseAsync` returns, so an application that adopts a guardrail
  never observes a blocked answer even transiently. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: registered by [`AiServiceCollectionExtensions`](#aiservicecollectionextensions)
  only when the host has registered at least one [`IChatGuardrail`](#ichatguardrail), checked by
  descriptor rather than by resolving one, so a host that adopts none of this pays no pipeline cost.

---

### UsageRecordingChatClient
> MMCA.Common.AI.Chat · `MMCA.Common.AI.Chat` · `MMCA.Common/Source/Core/MMCA.Common.AI/Chat/UsageRecordingChatClient.cs:30` · Level 2 · class

- **What it is**: a `DelegatingChatClient` that records every call's token usage AND end-to-end latency to
  [`AiUsageMeter`](#aiusagemeter), tagged with the model, the prompt name/version read off
  [`PromptContract`](#promptcontract), and the configured [`AiProvider`](#aiprovider).
- **Depends on**: `Microsoft.Extensions.AI.DelegatingChatClient`/`IChatClient`/`UsageContent`,
  `System.Diagnostics.Stopwatch`, [`AiUsageMeter`](#aiusagemeter),
  [`PromptContract`](#promptcontract) (`ReadName`/`ReadVersion`), [`AiProvider`](#aiprovider).
- **Concept introduced, cross-referenced.** `[Rubric §13, Observability & Operability]`: same category
  as [`AiUsageMeter`](#aiusagemeter); this type is the call site that turns a response into a
  measurement, closing the loop between [`PromptContract`](#promptcontract)'s stamped identity and the
  meter's counters and duration histogram.
- **Walkthrough**: the constructor takes the inner client, the meter, and the provider tag to apply to
  every measurement (`UsageRecordingChatClient.cs:39-45`). `GetResponseAsync`
  (`UsageRecordingChatClient.cs:48-77`) starts a `Stopwatch` timestamp, awaits the base call inside a
  `try`, and records the duration with `AiUsageMeter.CanceledOutcome` or `ErrorOutcome` from the matching
  `catch` before rethrowing (`UsageRecordingChatClient.cs:55-64`); on success it records the duration with
  `SuccessOutcome`, then records `response.Usage` tagged with `response.ModelId ?? options?.ModelId` and
  the prompt name/version read back off `options` via
  [`PromptContract.ReadName`/`ReadVersion`](#promptcontract) (`UsageRecordingChatClient.cs:66-77`),
  returning the response unchanged. `GetStreamingResponseAsync` (`UsageRecordingChatClient.cs:84-141`) is
  hand-driven with an explicit `GetAsyncEnumerator`/`MoveNextAsync` loop rather than `await foreach`,
  because C# forbids a `yield return` inside a `try` that has a `catch` clause and the outcome has to be
  known before the `finally` records the duration (`UsageRecordingChatClient.cs:107-113`); it tracks the
  first non-null `modelId` seen across updates, records any `UsageContent` each update carries through the
  private `RecordUsageIn` (`UsageRecordingChatClient.cs:143-153`), yields the update, and in a `finally`
  (`UsageRecordingChatClient.cs:132-135`) records the duration under whichever outcome the loop settled
  on, stopping the clock only once the stream itself ends, which is the number a caller of a streaming API
  actually feels. The private `RecordDuration` (`UsageRecordingChatClient.cs:159-167`) is the shared
  helper both paths call.
- **Why it's built this way**: usage recording happens after the base call returns (or per streamed
  `UsageContent`), so this client never alters the response, only observes it; that keeps it safely
  composable with [`BoundedChatClient`](#boundedchatclient), which does alter requests. Duration is
  recorded on every outcome, including a thrown exception or a cancellation, so a failure rate and a
  latency distribution come off the same series. See
  [`ADR-111`](https://ivanball.github.io/docs/adr/111-ai-session-scoring-governance.html) and
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: registered last (innermost of the two governance wrappers, so it sees the actual
  provider response) by
  [`AiServiceCollectionExtensions.AddMmcaChatClient`](#aiservicecollectionextensions)
  (`DependencyInjection.cs:729-732`); ADC's `AnthropicScoringService`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AnthropicScoringService.cs`)
  and `MMCA.ADC.Conference.Service/Program.cs` are downstream of the registered pipeline.

---

### AiServiceCollectionExtensions
> MMCA.Common.AI · `MMCA.Common.AI` · `MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:57` · Level 3 · class

- **What it is**: the DI entry point for the whole AI integration: two `extension(IServiceCollection)`
  members, `AddMmcaChatClient(IConfiguration)` and the provider-agnostic
  `AddMmcaChatClient(IConfiguration, Func<IServiceProvider, IChatClient>)`, that bind
  [`AiSettings`](#aisettings), and when enabled, build the full governed pipeline.
- **Depends on**: [`AiSettings`](#aisettings), [`AiUsageMeter`](#aiusagemeter),
  [`BoundedChatClient`](#boundedchatclient), [`GuardrailChatClient`](#guardrailchatclient),
  [`IChatGuardrail`](#ichatguardrail), [`UsageRecordingChatClient`](#usagerecordingchatclient),
  `Microsoft.Extensions.AI.ChatClientBuilder` (`AddChatClient`, `.Use`, `.UseDistributedCache`,
  `.UseOpenTelemetry`, `.UseLogging`), `Microsoft.Extensions.Caching.Distributed.IDistributedCache`,
  `Microsoft.Extensions.Hosting.IHostEnvironment`, and (only in `CreateProviderChatClient`) the
  Anthropic .NET SDK's `AnthropicClient`/`ClientOptions` plus its own `AsIChatClient` adapter.
- **Concept introduced, cross-referenced to the primer's `extension(T)` note (00-primer.md#c-extensiont-types--read-this-once).**
  `[Rubric §2, Design Patterns]` (assesses whether a composition pipeline is idiomatic): the method
  builds a `ChatClientBuilder` decorator chain where "first registered is outermost", explicitly
  documented to read exactly like the ordering diagram in the type's own remarks
  (`DependencyInjection.cs:722-723`): [`BoundedChatClient`](#boundedchatclient) wraps first (outermost),
  then, only when a host has registered a guardrail, [`GuardrailChatClient`](#guardrailchatclient), then
  [`UsageRecordingChatClient`](#usagerecordingchatclient), then optionally a distributed cache
  layer, then OpenTelemetry, then logging. `[Rubric §16, AI-Native Application Architecture]`: this is
  the single composition point that turns raw provider access into the framework's governed AI
  dependency.
- **Walkthrough**: `AddMmcaChatClient(IConfiguration)` (`DependencyInjection.cs:683-684`) is the Anthropic
  overload, nothing more than the provider-agnostic overload with `CreateProviderChatClient` as the
  factory. `AddMmcaChatClient(IConfiguration, Func<...>)` (`DependencyInjection.cs:698-750`) is the real
  extension point a test uses to exercise the pipeline without a network, and the one a future provider
  plugs into (`DependencyInjection.cs:693-697`): it binds and validates `AiSettings`
  (`.Bind(section).ValidateDataAnnotations().ValidateOnStart()`, `DependencyInjection.cs:708-711`), reads
  the settings once with `section.Get<AiSettings>() ?? new AiSettings()`
  (`DependencyInjection.cs:713`), and returns early, registering nothing, when `!settings.Enabled`
  (`DependencyInjection.cs:714-717`). When enabled it registers `AddMetrics()` and a singleton
  `AiUsageMeter` (`DependencyInjection.cs:719-720`), then builds the chain via `AddChatClient` +
  `.Use(...)` for [`BoundedChatClient`](#boundedchatclient) (`DependencyInjection.cs:108-112`). It then
  checks, by service descriptor rather than by resolving one,
  whether the host registered any [`IChatGuardrail`](#ichatguardrail), and only then adds
  [`GuardrailChatClient`](#guardrailchatclient) to the chain (`DependencyInjection.cs:114-122`); a
  descriptor check rather than a resolve is what keeps the layer out of a host that registered none,
  because adding an empty-loop client would change the type the container hands back for every
  application that adopts none of this. It then adds
  [`UsageRecordingChatClient`](#usagerecordingchatclient) (`DependencyInjection.cs:124-128`). It adds a
  distributed-cache layer only when `EnableCache` is set AND an `IDistributedCache` is actually
  registered (`DependencyInjection.cs:736-739`), because a cache the host never registered would make
  every call throw at resolve time, so the opt-in needs both halves: the switch AND a store to write to.
  It then applies OpenTelemetry with `EnableSensitiveData` gated by `IsDevelopmentHost`
  (`DependencyInjection.cs:741-747`), and logging last. The private `CreateProviderChatClient`
  (`DependencyInjection.cs:762-782`) switches on `AiSettings.Provider`: for
  [`AiProvider.Anthropic`](#aiprovider) it constructs `AnthropicClient` with the configured API key and
  timeout and adapts it with the SDK's own `AsIChatClient(settings.Model, settings.MaxOutputTokens)`,
  passing model and output ceiling as the client's defaults ([`BoundedChatClient`](#boundedchatclient)
  still clamps per call, because a default is a suggestion and a bound is not,
  `DependencyInjection.cs:768-772`); any other provider throws `NotSupportedException` naming the
  functional overload as the escape hatch (`DependencyInjection.cs:778-780`). The private
  `IsDevelopmentHost` (`DependencyInjection.cs:796-800`) fails CLOSED: an environment it cannot
  positively identify as `Development` (by scanning already-registered `IHostEnvironment` instances)
  reads as not-Development, so prompt and completion text never reach telemetry by accident, mirroring
  the same gate on `Persistence:EnableSensitiveDataLogging` elsewhere in the framework
  (`DependencyInjection.cs:790-795`).
- **Why it's built this way**: an early return for `!Enabled` means a host that ships the `Ai` section
  disabled pays zero DI registration cost, not just a runtime no-op. Reading settings once via
  `section.Get<AiSettings>()` (rather than resolving `IOptions<AiSettings>` before the container is
  built) lets the method branch on `Enabled` synchronously during registration. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: the entry point every AI-enabled host calls; no other type in
  `MMCA.Common.AI` calls it (`#### Usage sites` lists none outside its own file), so its consumers are
  downstream application hosts such as ADC's `MMCA.ADC.Conference.Service`.


---
[⬅ Device Capability Abstraction Layer (Native Contracts, MAUI, Browser & Fallback Adapters)](group-26-device-capability-layer.md)  •  [Index](00-index.md)  •  [Testing & Quality Infrastructure ➡](group-28-testing-infrastructure.md)
