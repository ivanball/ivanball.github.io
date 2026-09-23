# 27. Common AI Integration

**What this chapter covers.** This group is the framework's *language-model boundary*: the optional
`MMCA.Common.AI` package that turns a call to an LLM provider into an ordinary, governed external
dependency. Four questions shape every type in it. *What is this call allowed to do?* (a pinned
model, a clamped output ceiling, a wall-clock budget, a policy-gated tool list, an optional input
ceiling). *What may it say, and what may it answer?* (redactors that rewrite a request before
anything reads it, and guardrails that can refuse the request, the response or a single streamed
fragment). *What did it cost, how long did it take, and which prompt spent it?* (two token counters
plus a latency histogram on one framework-wide meter, all tagged by prompt name, version and
provider, with the same prompt identity stamped on the trace). *Which exact prompt produced this
answer?* (a versioned contract whose SHA-256 hash is what an evaluation gate records against). The
32 types answering those questions ship in four packages. The core `MMCA.Common.AI` holds the
settings, the composition entry point, four delegating clients (bounds, guardrails, metering, prompt
tagging), the guardrail, redactor and tool-policy contracts with the two content policies the
framework does ship, the provider-factory contract and its startup validator, a meter and the prompt
contract. Two adapter packages, `MMCA.Common.AI.Anthropic` and `MMCA.Common.AI.OpenAI`, each add one
provider factory and one registration method. `MMCA.Common.AI.Testing` is the offline evaluation
harness a consumer's test project subclasses. The decision record is
[ADR-120](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html), which extends
the feature-level record
[ADR-111](https://ivanball.github.io/docs/adr/111-ai-session-scoring-governance.html).

If you have not yet met the `extension(T)` DI convention or the fail-fast options pattern, skim
[primer section 4](00-primer.md#c-extensiont-types--read-this-once) first: this chapter composes both
and does not re-teach them.

`[Rubric section 16, AI-Native Application Architecture]` is the category this whole group exists to
answer. Section 16 asks whether a model dependency is isolated, versioned, evaluated, observed and
bounded in what it may do, rather than being a free-form HTTP call buried in a feature. The package's
shape is a literal reading of that list: isolation is the single `IChatClient` registration over an
[IAiProviderFactory](#iaiproviderfactory), versioning is [PromptContract](#promptcontract),
evaluation is [GoldenReplayTestsBase](#goldenreplaytestsbase) and
[PromptContractPinTestsBase](#promptcontractpintestsbase), observation is
[AiUsageMeter](#aiusagemeter) plus [PromptTaggingChatClient](#prompttaggingchatclient), the
configured bounds are [BoundedChatClient](#boundedchatclient) with
[IChatToolPolicy](#ichattoolpolicy) deciding which tools survive them, and the content rules on top
are [IChatRequestRedactor](#ichatrequestredactor) and [IChatGuardrail](#ichatguardrail) run by
[GuardrailChatClient](#guardrailchatclient). `[Rubric section 2, Design Patterns]` also applies
throughout, because the mechanism is the decorator: every layer is a `DelegatingChatClient` wrapping
the next, and the provider is a strategy selected by name.

## The configuration surface is the contract

[AiSettings](#aisettings) (`MMCA.Common/Source/Core/MMCA.Common.AI/AiSettings.cs:22`) binds from the
`Ai` section (`AiSettings.cs:25`) and holds every knob the package has: `Enabled` (`:39`), `Provider`
(`:48`), `Model` (`:58`), `ApiKey` (`:69`), the optional `Endpoint` (`:76`), `MaxOutputTokens`
(`:83`, defaulting to 1024 at `:28` and range-checked 1 to 1,000,000 at `:82`), `Timeout` (`:89`,
defaulting to 30 seconds at `:31`), `AllowTools` (`:96`), `RequireGuardrail` (`:110`, defaulting to
true), `EnableCache` (`:116`) and the optional `PerCallInputTokenBudget` (`:124`, range 1 to
`int.MaxValue` at `:123`). Every one of those is a bound rather than a suggestion: the settings doc
comment says so outright (`AiSettings.cs:7-14`), and the runtime enforcement lives one layer out in
[BoundedChatClient](#boundedchatclient), so a caller cannot opt out by passing different
`ChatOptions`. Nothing in the section names a vendor: `Provider` is a plain string matched against the
names of whatever provider factories the host registered (`AiSettings.cs:15-20`, `:41-47`), and
`Endpoint` is what routes any adapter through an AI gateway, a regional endpoint or an
OpenAI-compatible server (`:71-75`).

Validation is conditional, which is what lets the `Ai` section ship in every appsettings file.
`AiSettings` implements `IValidatableObject` (`AiSettings.cs:22`) and its `Validate` yields nothing
at all when `Enabled` is false (`:135-138`); once the dependency is switched on it requires
`Provider` (`:140-146`), `Model` (`:148-153`) and `ApiKey` (`:155-161`), rejects a relative
`Endpoint` (`:163-168`) and rejects a non-positive `Timeout` (`:170-175`). The registration chains
that onto `ValidateDataAnnotations().ValidateOnStart()`
(`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:123-126`), so a misconfigured host
fails at startup rather than on the first user request: the same fail-fast configuration contract the
rest of the framework follows
([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)).
`[Rubric section 11, Security]` is in play at `ApiKey`: the property is documented as binding from Key
Vault in production and from user secrets locally (`AiSettings.cs:62-67`), so the package itself never
decides where the secret comes from.

## The provider is a registered factory, not a type the package names

[IAiProviderFactory](#iaiproviderfactory)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Providers/IAiProviderFactory.cs:20`) is the whole provider
boundary: a `Name` a configuration file selects it by (`:26`) and a `Create(AiSettings,
IServiceProvider)` that returns the innermost, ungoverned client (`:34`). The governance pipeline never
sees a vendor type, so swapping the provider is a package reference, a registration call and a
configuration value with nothing else in the host changing (`IAiProviderFactory.cs:8-13`). Each
adapter package ships exactly one implementation.
[AnthropicAiProviderFactory](#anthropicaiproviderfactory)
(`MMCA.Common/Source/Core/MMCA.Common.AI.Anthropic/AnthropicAiProviderFactory.cs:14`, name
`Anthropic` at `:17`) passes the key, the timeout and an optional base URL from `Endpoint` to the
official SDK's `ClientOptions` (`:37-46`) and adapts the `AnthropicClient` with the SDK's own
`AsIChatClient`, handing it the pinned model and output ceiling as defaults (`:48`), so nothing
hand-rolls the Messages API over `HttpClient` (`:24-27`).
[OpenAiProviderFactory](#openaiproviderfactory)
(`MMCA.Common/Source/Core/MMCA.Common.AI.OpenAI/OpenAiProviderFactory.cs:18`, name `OpenAI` at
`:21`) builds an `OpenAIClient` from an `ApiKeyCredential` with `NetworkTimeout` and the optional
`Endpoint`, then binds the model through `GetChatClient(model).AsIChatClient()` (`:42-51`); because
that client fixes its model at construction, the per-call model pin one layer out is what keeps a
prompt contract's model meaningful on both adapters (`:28-31`).

Each adapter registers itself through its own `extension(IServiceCollection)` block:
[AnthropicAiServiceCollectionExtensions](#anthropicaiservicecollectionextensions)
(`MMCA.Common/Source/Core/MMCA.Common.AI.Anthropic/DependencyInjection.cs:17`) exposes
`AddAnthropicAiProvider()` (`:26`) and
[OpenAiServiceCollectionExtensions](#openaiservicecollectionextensions)
(`MMCA.Common/Source/Core/MMCA.Common.AI.OpenAI/DependencyInjection.cs:17`) exposes
`AddOpenAiProvider()` (`:26`). Both use `TryAddEnumerable` (`:30` in each file), so registration is
additive and idempotent and a host can register several providers and pick one per environment in
configuration (`:10-11`). [AiProviderValidator](#aiprovidervalidator)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Providers/AiProviderValidator.cs:16`) closes the loop at
startup. It is an internal `IValidateOptions<AiSettings>` that matches `Provider` against the
registered names case-insensitively (`:41-42`) and fails with a message listing the registered
providers, or naming both adapter packages and their registration methods when none is registered
(`:48-64`). It stays silent when the section is disabled or the name is blank (`:27-30`), because the
data annotations already report a blank name and one failure should be reported once.

## One entry point, one pipeline, outermost first

[AiServiceCollectionExtensions](#aiservicecollectionextensions)
(`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:77`) is the only composition surface.
It exposes two `AddMmcaChatClient` overloads inside an `extension(IServiceCollection services)` block
(`DependencyInjection.cs:79`), the framework's standard public DI shape
([ADR-106](https://ivanball.github.io/docs/adr/106-extension-members-as-public-di-surface.html)): the
configuration form (`:88`) registers [AiProviderValidator](#aiprovidervalidator) (`:94`) and then
delegates to the factory form (`:113-115`) with `CreateProviderChatClient` as the innermost client
(`:96`). That method resolves every registered [IAiProviderFactory](#iaiproviderfactory), picks the
one whose name matches `Ai:Provider` and calls its `Create` (`:239-248`); its own throw is only a belt
for a host that bypassed the options pipeline (`:235-238`). The provider path is therefore nothing more
than the general path with its innermost client supplied. On the factory form `Ai:Provider` is still
required, but it is only the metrics fallback and is matched against nothing (`:109-111`).

The registration reads top to bottom as a policy. Bind and validate (`:121-126`). Then, if the section
is disabled, **return having registered no client at all** (`:128-132`). That absence is the API: a
consumer gates on `GetService<IChatClient>()` returning null rather than on reading a flag
(`DependencyInjection.cs:66-70`), so a feature whose key is missing in a given environment is off by
construction. When enabled, the registration first scans the descriptors for an `IChatGuardrail` and
an `IChatRequestRedactor` (`:139-140`) and hands the answers to `RefuseAnUngovernedHost` (`:142`, body
at `:202-227`), which makes two refusals at registration time rather than on the tenth user's request.
With `RequireGuardrail` true (its default) and neither extension point registered it throws, naming
`AddPiiRedactionGuardrail()` as the one-line fix and the `RequireGuardrail` switch as the reviewable
opt-out (`:208-217`); with `AllowTools` true and no `IChatToolPolicy` registered it throws too, because
every tool would otherwise be silently stripped (`:219-226`). Then the meter is registered
(`AddMetrics` plus `TryAddSingleton<AiUsageMeter>()`, `:144-145`) and the client is built with
`AddChatClient` followed by `Use` calls, first-registered being outermost because `ChatClientBuilder`
applies its factories in reverse (`:147-184`). The resulting order, outermost first, is
[BoundedChatClient](#boundedchatclient), then the optional
[GuardrailChatClient](#guardrailchatclient), then
[UsageRecordingChatClient](#usagerecordingchatclient), then optional distributed caching, then
OpenTelemetry, then [PromptTaggingChatClient](#prompttaggingchatclient), then logging, then the
provider client (`DependencyInjection.cs:22-31`). The ordering is deliberate: bounds sit outside
everything, so a rejected call is rejected before anything logs or caches it; guardrails sit inside
the bounds and outside metering, because a blocked request never reaches the provider and so has no
cost to record; a cache hit still records "what this call would have cost"; and prompt tagging sits
just inside the OpenTelemetry layer so the activity it decorates is that layer's own span
(`:33-40`).

The guardrail layer is the one conditional wrapper, and how it is decided matters. The registration
adds it only when the collection already carries an `IChatGuardrail` or an `IChatRequestRedactor`
descriptor (`:156-162`), and the check is a descriptor scan rather than a resolve, because building
the layer unconditionally would change the concrete type the container hands back for every
application that adopts neither (`:134-138`, restated in the type's own remarks at `:43-48`). An app
that registers none, and has deliberately set `RequireGuardrail` false, therefore keeps exactly the
chain it had.

Two details in that block are worth reading closely. Caching needs *both* halves, the `EnableCache`
switch and an actually-registered `IDistributedCache`, because a cache the host never registered would
turn every call into a resolve-time throw (`:170-175`). And `EnableSensitiveData` on the OpenTelemetry
layer is driven by `IsDevelopmentHost` (`:177-182`, implementation at `:262-266`), which fails closed:
an environment it cannot positively identify as Development reads as not-Development, so prompt and
completion text never reach telemetry by accident (`:256-260`). That is the same dev-only-relaxation
rule recorded in
[ADR-122](https://ivanball.github.io/docs/adr/122-dev-only-relaxations-fail-closed.html), and it is
`[Rubric section 11, Security]` and `[Rubric section 13, Observability and Operability]` pulling in
opposite directions with the safe default winning.

## The outer layer: what a call is allowed to do

[BoundedChatClient](#boundedchatclient)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/BoundedChatClient.cs:65`) is a `DelegatingChatClient`
that applies five bounds (output tokens, wall clock, tool use, input size, model) to both the
buffered and the streaming path (the list at `BoundedChatClient.cs:16-50`). `Bound` works on a
**clone** of the caller's options (`:183`), clamps `MaxOutputTokens` down with `Math.Min`
(`:185-187`) so a caller asking for less keeps its smaller number, and nulls out `Tools` and
`ToolMode` while `AllowTools` is false (`:189-193`). The model is pinned rather than negotiated: a
request naming a model other than `Ai:Model` throws, and every request goes out naming the pinned
model explicitly whether or not the adapter honors a per-request override (`:205-220`), which is what
makes [PromptContract](#promptcontract)'s model mean the same thing on every provider (`:43-49`).
`CreateLinkedTimeout` links the caller's token to one cancelled after `Timeout` (`:270-275`), so
neither cancellation source masks the other, and on the streaming path the timeout deliberately
covers the whole stream rather than just its first update (`:140-142`).
`[Rubric section 12, Performance and Scalability]` and `[Rubric section 31, Cost and FinOps]` both
live here: the output ceiling is a spend bound and the timeout is a thread-occupancy bound.

While `AllowTools` is true, tools are not all-or-nothing: `FilterTools` (`:231-268`) offers a tool
only when **every** registered [IChatToolPolicy](#ichattoolpolicy) returns
[ToolAuthorization](#toolauthorization)`.Allowed` (`:251`), so policies compose by intersection and a
new concern can only ever remove tools
(`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/IChatToolPolicy.cs:17-21`). With no policy
registered every tool is stripped (`BoundedChatClient.cs:241-244`), and `ToolAuthorization.Denied` is
the enum's zero value so an unassigned answer refuses (`ToolAuthorization.cs:7-8`): the layer fails
closed, and a missing policy costs a capability rather than granting one. On top of the policies, a
tool marked consequential must also be confirmed by the caller for this request (`:259-262`), and the
confirmation never overrides a policy that denied it (`:256-258`). Both markers are plain string keys
on the property bags Microsoft.Extensions.AI already carries, published by the static
[ChatToolPolicy](#chattoolpolicy) (`ChatToolPolicy.cs:23`): `mmca.tool.consequential` on the tool
(`:29`) and `mmca.tool.confirmed` on the options (`:40`), so any tool factory and any caller can
participate without referencing this package (`:10-14`). The distinction they encode is reading
versus writing: a lookup can be offered on a policy decided once, while a tool that sends, moves money
or deletes is a decision a human makes per request (`:17-21`). `[Rubric section 11, Security]` and
`[Rubric section 16]`.

The input-size bound is the one with a caveat baked into its own doc comment.
`EnforceInputBudget` (`BoundedChatClient.cs:277-292`) runs only when `PerCallInputTokenBudget` is set,
estimates the request, and throws an `InvalidOperationException` naming the setting when the estimate
exceeds it (`:290-291`), which fails the call locally instead of paying for it remotely. The estimate
comes from the public static `EstimateInputTokens` (`:155-179`), which concatenates the options'
instructions and every message's text and then either defers to an
[IAiTokenEstimator](#iaitokenestimator) or falls back to one token per four characters (`:178`).
[IAiTokenEstimator](#iaitokenestimator)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/IAiTokenEstimator.cs:14`) is optional and is resolved
*through the client pipeline* rather than from DI, via `this.GetService<IAiTokenEstimator>()`
(`BoundedChatClient.cs:284`), so any inner client that knows its provider's tokenizer can offer one.
The package declines to take a tokenizer dependency for this on purpose (`IAiTokenEstimator.cs:8-12`),
and the source is blunt that the number is a guardrail and not a billing figure: images, tool schemas,
provider-side system additions and non-Latin scripts are all under-counted
(`BoundedChatClient.cs:52-58`). The under-count direction is chosen too: it lets a call through, it
never blocks one that would have fit (`:175-177`). Both entry points bound and budget-check *eagerly*,
the streaming one outside the iterator (`:124-130`), so a forbidden request is refused when it is made,
not when somebody starts reading the stream.

## The middle layer: what the call may say, and what it may answer

Bounds are configuration, so the framework can decide them. Content is not, so it does not.
[IChatGuardrail](#ichatguardrail)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/IChatGuardrail.cs:20`) is the extension point an
application implements to inspect an outgoing request (`InspectRequestAsync`, `:27-30`), a
completed response (`InspectResponseAsync`, `:37-40`) and, through a default-interface member that
allows unless overridden, each streamed update (`InspectStreamedUpdateAsync`, `:56-59`), and the
interface's own doc comment states the split outright: the framework ships the extension point and
no policy (ADR-120), because what counts as a prompt injection, a leaked secret, an off-topic answer
or a disallowed topic depends on the data the application holds and the jurisdiction it runs in, so
a content rule baked into a shared package would be wrong somewhere by construction
(`IChatGuardrail.cs:9-13`). Register one implementation per concern; all of them run and the first
block stops the call (`:12-13`). One operational caveat is recorded on the interface: a guardrail
runs on the hot path of every chat call and inherits the caller's cancellation token rather than
getting a budget of its own, so an implementation that calls a remote classifier has to carry its own
timeout (`:16-19`). A streamed update is a fragment rather than an answer, so a rule that needs the
whole text accumulates it itself, and a block ends the stream after the caller has already seen
everything yielded before it (`:50-55`). `[Rubric section 11, Security]` and `[Rubric section 16]`
both read this extension point.

[IChatRequestRedactor](#ichatrequestredactor)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/IChatRequestRedactor.cs:25`) is the other half of
that extension point: where a guardrail answers yes or no, a redactor lets the call through with less
in it, which for contact details is almost always the answer an application wants (`:8-13`). Its one
member, `Redact` (`:36`), must return **new** message instances and never mutate the caller's, so a
conversation history or an audit record the caller keeps still holds exactly what it built
(`:30-35`). Every registered redactor runs in registration order on the materialized messages before
any guardrail inspects them, on both paths, and the redacted list is what the provider is sent
(`:14-19`); being on the hot path, an implementation must stay allocation-light and must not reach the
network (`:21-24`).

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
(`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/GuardrailChatClient.cs:31`) is the `DelegatingChatClient`
that runs both, holding the registered guardrails and redactors as arrays materialized once in the
constructor (`:33-34`, `:56-57`). On the buffered path it materializes and redacts the messages
(`:68`), inspects the redacted request (`:70`), calls through with that same redacted list (`:72`),
then inspects the response (`:74-84`); a block anywhere throws
[ChatGuardrailException](#chatguardrailexception) carrying the verdict's reason, falling back to
`GuardrailVerdict.UnspecifiedReason` when a block supplied none (`:82`, `:111`, `:150`). The caller's
messages are materialized once before anything reads them (helper at `:119-124`), so the redactors,
the guardrails and the inner client cannot see two different sequences when a caller hands in a
lazily generated one (`:66-67`), and the redactors are folded over that list in registration order
(`:126-135`). The streaming path redacts and inspects the request the same way (`:95-97`) and then
runs every guardrail over each update **before** yielding it (`:99-115`), because once the caller
holds a fragment, refusing it is a statement rather than a control (`:101-102`). What it does not do
is inspect the assembled answer: accumulating a whole streamed answer before releasing any of it
defeats the reason a caller chose streaming, so that stays the caller's choice (`:24-29`).
[ChatGuardrailException](#chatguardrailexception)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/ChatGuardrailException.cs:12`) is a sealed exception
with the three conventional constructors (`:15`, `:22`, `:30`), the parameterless one defaulting its
message to `UnspecifiedReason` (`:16`). A refusal is an exception rather than an empty response so it
cannot be mistaken for the model having nothing to say, and so a caller wanting a graceful fallback
catches this one type (`ChatGuardrailException.cs:7-11`).

## The two content policies the framework does ship

[PiiRedactionGuardrail](#piiredactionguardrail)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/PiiRedactionGuardrail.cs:39`) is the stated
exception to "extension points and no policy": an email address or a phone number is never evidence
for anything a model is asked, so sending one is pure exposure and the judgement does not vary between
applications or jurisdictions (`:11-16`). It implements both contracts. As a redactor it rewrites
every text content of every message, replacing matches of a source-generated email pattern and a
deliberately narrow North American phone pattern (each with a one-second match timeout, `:70-80`)
with `[redacted-email]` and `[redacted-phone]` (`:41-42`), and passes images, function calls and
provider-specific content through untouched (`:95-99`). As a guardrail it allows everything
(`:58-68`), which is exactly enough to satisfy `RequireGuardrail` without pretending to be a content
policy (`:18-22`). Names are not redacted and `ChatOptions.Instructions` is left alone, because a
speaker's name is the published record and the instructions are the application's own text
(`:28-29`, `:34-37`).

[ContentPolicyGuardrail](#contentpolicyguardrail)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ContentPolicyGuardrail.cs:64`) is the configurable
one, and it too implements both halves. On the request side it looks for prompt-injection markers in
**user-role** content only, since system and assistant messages are the application's own text and
the model's own turns (`:34-38`). The eight built-in markers (`:77-87`) are each anchored on an
imperative verb aimed at the model rather than a noun a person might use, which makes the list a floor
rather than a detector (`:54-61`). What happens on a match is the
[ContentPolicyInjectionMode](#contentpolicyinjectionmode)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ContentPolicyInjectionMode.cs:16`): `Redact`, the
default (`:23`), `Block` (`:29`) or `Off` (`:35`). The two active modes are one behavior split across
the pipeline's fixed order (`ContentPolicyGuardrail.cs:25-32`): `Redact` rewrites the marker away
before any guardrail runs, so the request inspection allows; `Block` makes the redactor a pass-through
(`:119-124`) so the inspection sees what the caller actually supplied and refuses naming the marker's
label (`:150-160`). On the response side a configured pattern blocks the buffered answer (`:164-172`)
and each streamed fragment (`:181-189`), with the reason naming the pattern's index and never the text
it matched (`:278-283`); a pattern spanning two updates is missed on the streaming path, so a host that
needs whole-answer certainty uses the buffered one (`:176-179`).
[ContentPolicySettings](#contentpolicysettings)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ContentPolicySettings.cs:23`) binds from its own
`Ai:ContentPolicy` section (`:26`) so a host that never adopts the policy has nothing to configure
(`:11-14`): `InjectionMode` (`:35`), `AdditionalRequestPatterns` (`:45`), `BlockedResponsePatterns`
(`:57`) and `RedactionPlaceholder` (`:69`, defaulting to `[redacted-instruction]` at `:29`). The
built-in markers stay code, not configuration (`:17-21`).

[GuardrailServiceCollectionExtensions](#guardrailservicecollectionextensions)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/GuardrailServiceCollectionExtensions.cs:17`)
registers both: `AddPiiRedactionGuardrail()` (`:33`) and `AddContentPolicyGuardrail(configuration)`
(`:62`), which also binds `ContentPolicySettings` with `ValidateDataAnnotations().ValidateOnStart()`
(`:67-70`) so a pattern that does not compile fails the deployment rather than a user's request
(`:56-57`). Each registers one singleton resolved under both `IChatGuardrail` and
`IChatRequestRedactor` rather than two instances, because the redactor and the guardrail are two
faces of one decision (`:37-41`, `:72-76`, rationale at `:28-31`), and each must run before
`AddMmcaChatClient`, which reads the descriptors (`:30-31`).

## The inner layer: what the call actually cost

[UsageRecordingChatClient](#usagerecordingchatclient)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/UsageRecordingChatClient.cs:38`) sits inside the
guardrails and reports the provider's own numbers. On the buffered path it records after awaiting the
response (`:109-114`), passing `response.Usage`, the model (`response.ModelId` falling back to the
options' `ModelId`, `:111`), the prompt identity read back off the options (`:112-113`) and the
provider (`:114`). On the streaming path it accumulates from the update stream, recording whenever a
`UsageContent` item appears (`:163`, helper at `:181`), which is how providers typically deliver usage
on a final update. The split of responsibility with the outer layer is stated in its remarks
(`:13-15`): a bound has to be decided before the call, a cost has to be measured after it. The
`provider` tag comes from the inner client itself: `ResolveProviderName` (`:68`) reads the
`ChatClientMetadata.ProviderName` every Microsoft.Extensions.AI adapter publishes (`:72`) and falls
back to the configured `Ai:Provider`, lower-cased, only when the client reports none (`:78-80`), so a
foreign client supplied through the factory overload is metered as what it is (`:18-22`). The
registration hands it that configured fallback (`DependencyInjection.cs:165-168`).

It also measures the call. A `Stopwatch` timestamp is taken on entry to both paths
(`UsageRecordingChatClient.cs:89`, `:125`) and the elapsed time is reported to the meter's latency
histogram with an `outcome` of `success`, `error` or `canceled` (`RecordDuration`, `:195-201`). The
buffered path classifies through two catch clauses that re-throw (`:96-105`) and records `success`
only after the call returned (`:107`); the streaming path drives the inner enumerator by hand instead
of using `await foreach`, because the outcome has to be attributed and C# forbids a `yield return`
inside a `try` that has a `catch`, so the duration is written in a `finally` (`:129-133`,
`:168-172`). The stream *ending* is what stops the clock, which is the number a caller of a streaming
API actually feels (`:131`). Recording on the failure paths too is the point: a failure rate and a
latency distribution then come off one series (`:30-35`).

[AiUsageMeter](#aiusagemeter)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Observability/AiUsageMeter.cs:20`) owns all three
instruments: the counters `mmca.ai.input_tokens` (`:29`) and `mmca.ai.output_tokens` (`:32`), and the
histogram `mmca.ai.call.duration` in seconds (`:45`, created at `:85-88`). They are published under
the meter name `MMCA.Common.AI` (`:26`), which is the same name the pipeline's OpenTelemetry layer
uses as its activity source (`DependencyInjection.cs:181`), so one name enables both traces and
metrics. Every adopting app reports to that same meter, which is what makes one dashboard query cover
every service (`AiUsageMeter.cs:12-17`). `Record` (`:101-124`) and `RecordDuration` (`:137-149`) share
one tag builder, so the cost series and the latency series join on the same dimensions: `model`,
`prompt_name`, `prompt_version` and `provider` (`:155-164`), with `outcome` added for the histogram
only (`:146`). `Record` is careful in two places: a null usage records nothing (`:108-111`) and a
count the provider did not report is skipped rather than written as zero (`:115-123`), because an
absent number must not read as a zero on a spend dashboard (`:91-95`). The duration histogram does not
replace `gen_ai.client.operation.duration`, which the Microsoft.Extensions.AI OpenTelemetry layer
already publishes on this same meter: the standard instrument carries the GenAI semantic-convention
dimensions, this one carries the prompt identity and the outcome, so a latency regression can be
attributed to the prompt that caused it (`:34-44`). The meter is created through `IMeterFactory` and
deliberately neither retained nor disposed (`:72-88`, rationale at `:62-67`), since disposing a
factory-owned meter would kill the instrument for every other holder of the name.

[PromptTaggingChatClient](#prompttaggingchatclient)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/PromptTaggingChatClient.cs:21`) gives traces the same
attribution the counters have. It copies the three prompt-identity keys a
[PromptContract](#promptcontract) stamped on the options onto `Activity.Current` (`:63-69`), on both
paths before calling through (`:36`, `:46`). It is composed just inside the OpenTelemetry layer
(`DependencyInjection.cs:183`), so when that layer has a listener the current activity is its own
`gen_ai` span, and it tags only an activity whose source is the `MMCA.Common.AI` name
(`PromptTaggingChatClient.cs:56-57`), so a host with no listener for that source gets no stray tags on
its HTTP request span and a request with no contract writes nothing (`:14-18`).
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
(`PromptContract.cs:11-17`). ADC's evaluation suite does exactly that through the framework's pin
gate, `SessionScoringPromptContractPinTests : PromptContractPinTestsBase`
(`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Scoring.Evaluation.Tests/PromptContractTests.cs:180`).
`[Rubric section 16]` again, and this is the part of it most systems skip.

## Where it runs today, and how it is tested

Exactly one feature in the workspace calls a model: ADC's organizer-facing session scoring. The
Conference service host reads one secret, `Ai:ApiKey`, and derives `Ai:Enabled` from its presence
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:129-134`); the infrastructure
template writes the Key Vault secret into the container app under that same key and local
development keeps it in user secrets (`Program.cs:123-125`), so a host with no key starts with
scoring unavailable rather than failing validation. It then registers the Anthropic adapter with
`AddAnthropicAiProvider()` (`Program.cs:139`), its guardrails with `AddConferenceAiGuardrails`
(`Program.cs:150`) and the governed client with `AddMmcaChatClient(builder.Configuration)`
(`Program.cs:152`), in that order because the last call reads the guardrail descriptors, and
subscribes the framework meter and activity source by literal name (`Program.cs:171-172`).
`AddConferenceAiGuardrails`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:85`)
composes both framework policies, `AddPiiRedactionGuardrail()` and `AddContentPolicyGuardrail`
(`:95-96`), with the module's own response guardrail (`:99`), so in the deployed workspace the
guardrail layer is present on every call. On the module side,
[SessionScoringService](group-19-conference-infrastructure.md#sessionscoringservice)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/SessionScoringService.cs:46`)
consumes the injected `IChatClient` and `PromptContract`, and Conference's Infrastructure registration
resolves the client with `GetService` rather than `GetRequiredService` precisely because the disabled
host registers none
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:42-48`).
`[Rubric section 3, Clean Architecture]`: an ADC architecture fitness test asserts that Infrastructure
is the only layer naming a language-model SDK type or the package
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Layering/AiDependencyIsolationTests.cs:14`).

`[Rubric section 14, Testability]` is served first by the factory overload. Because the innermost
client is just a `Func<IServiceProvider, IChatClient>` (`DependencyInjection.cs:113-115`), the whole
governance pipeline can be exercised with no network at all, which is what the package's own suite
under `MMCA.Common/Tests/Core/MMCA.Common.AI.Tests` does, from `AiServiceCollectionExtensionsTests` and
`BoundedChatClientTests` through `Providers/AdapterFactoryTests`, `Guardrails/ContentPolicyGuardrailTests`,
`Guardrails/ToolPolicyTests` and `PromptTaggingChatClientTests`. A guardrail is equally cheap to test,
being a small interface over in-memory types.

The evaluation half of `[Rubric section 16]` ships as a package of its own, `MMCA.Common.AI.Testing`,
which a consumer's test project subclasses. [ReplayChatClient](#replaychatclient)
(`MMCA.Common/Source/Hosting/MMCA.Common.AI.Testing/ReplayChatClient.cs:17`) is an offline
`IChatClient` that answers with recorded responses and records what went out, so a test asserts the
request as well as the answer (`:7-15`). [RecordedResponses](#recordedresponses)
(`RecordedResponses.cs:20`) reads and writes those recordings in the abstraction's `ChatResponse`
shape through `AIJsonUtilities.DefaultOptions`, never a vendor wire format, so a provider swap does
not invalidate a corpus or lose its regression history (`:10-18`). A
[GoldenReplayCase](#goldenreplaycase) (`GoldenReplayCase.cs:13`) is an id, a one-line description and
a response path resolved relative to the test assembly (`:9-12`), and
[GoldenReplayTestsBase](#goldenreplaytestsbase) (`GoldenReplayTestsBase.cs:24`) replays every case
through the real code under test on a fresh client, collects every failure rather than stopping at the
first, and fails an empty corpus because an evaluation that evaluates nothing passes forever
(`:11-21`). [PromptContractPinTestsBase](#promptcontractpintestsbase)
(`PromptContractPinTestsBase.cs:25`) is the prompt-change protocol as a gate: a JSON pin file maps
`<Name>@<Version>` to the contract hash (`:20-22`), and a contract with no pin or a pin that no longer
matches fails (`:12-18`). ADC subclasses both, in
`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Scoring.Evaluation.Tests/GoldenReplayTests.cs:35`
and `PromptContractTests.cs:180`.

Read the per-type sections next in level order: the Level 0 contracts and values
([AiSettings](#aisettings), [PromptContract](#promptcontract), [GuardrailVerdict](#guardrailverdict),
[IAiTokenEstimator](#iaitokenestimator), [IChatRequestRedactor](#ichatrequestredactor),
[ToolAuthorization](#toolauthorization), [ChatToolPolicy](#chattoolpolicy),
[ContentPolicyInjectionMode](#contentpolicyinjectionmode), [AiUsageMeter](#aiusagemeter) and the
three replay types) first, then the Level 1 types ([IChatGuardrail](#ichatguardrail),
[IChatToolPolicy](#ichattoolpolicy), [IAiProviderFactory](#iaiproviderfactory),
[ChatGuardrailException](#chatguardrailexception),
[UsageRecordingChatClient](#usagerecordingchatclient) and the two test bases), then the Level 2
clients, policies, validator and provider factories, then the Level 3 registrations, and finally
[PromptTaggingChatClient](#prompttaggingchatclient) and the
[AiServiceCollectionExtensions](#aiservicecollectionextensions) entry point that assembles them.

### AiSettings
> MMCA.Common.AI · `MMCA.Common.AI` · `MMCA.Common/Source/Core/MMCA.Common.AI/AiSettings.cs:22` · Level 0 · class

- **What it is**: the bound, validated `Ai` configuration section (`SectionName = "Ai"`,
  `AiSettings.cs:217`) that gates and configures the entire AI integration: whether it is on at all
  (`Enabled`, `AiSettings.cs:231`), which provider and model to call
  (`Provider`/`Model`, `AiSettings.cs:234,242`), the API key, an optional endpoint override, the
  output-token ceiling, the per-call timeout, and opt-ins (`AllowTools`, `RequireGuardrail`,
  `EnableCache`) plus an optional input-token pre-flight budget.
- **Depends on**: `System.ComponentModel.DataAnnotations` (`IValidatableObject`, `[Range]`); no
  first-party dependency of its own, though its doc comments name `AddCommonKeyVaultConfiguration` and
  `Persistence:EnableSensitiveDataLogging` as sibling conventions elsewhere in Common.
- **Concept introduced, an off-by-default dependency with conditional validation.**
  `[Rubric §16, AI-Native Application Architecture]` (assesses whether an LLM dependency is safe to ship
  in every environment): `Enabled` defaults to `false`, and when it is false `AddMmcaChatClient`
  registers no `IChatClient` at all, so resolving one yields `null` and a consumer gates on the service
  being present rather than reading a flag itself (`AiSettings.cs:225-231`). `Provider` is no longer a
  closed enum: it is matched case-insensitively against the registered
  [`IAiProviderFactory`](#iaiproviderfactory)`.Name` of whatever provider packages the host
  referenced (`MMCA.Common.AI.Anthropic` and `MMCA.Common.AI.OpenAI` each ship one), so the provider
  switch lives in the host's package references and its configuration value, not in this framework's
  source (`AiSettings.cs:194-201`). `[Rubric §11, Security]` (assesses secret handling): `ApiKey` is
  required only when `Enabled`, and its doc comment records that production binds it from Key Vault via
  `AddCommonKeyVaultConfiguration`, never from a checked-in settings file (`AiSettings.cs:214-223`).
- **Walkthrough**: two constants, `DefaultMaxOutputTokens = 1024` (`AiSettings.cs:220`) and
  `DefaultTimeout = TimeSpan.FromSeconds(30)` (`AiSettings.cs:223`), back the two settings that ship with
  a value even when the section is silent. `Provider` (`AiSettings.cs:202`) is required when `Enabled`
  and names a registered provider by string, e.g. `Anthropic` or `OpenAI`; an unknown name fails at
  startup naming the registered ones. `Model` is required when `Enabled` because it is part of the
  prompt contract, hashed into `PromptContract.Hash`, so an implicit provider default would silently
  change evaluated behavior on the provider's own schedule rather than on a reviewed version bump, and
  it is also a bound: [`BoundedChatClient`](#boundedchatclient) refuses a request that names a different
  model (`AiSettings.cs:204-211`). `Endpoint` (`AiSettings.cs:225-230`) is an optional absolute URI to
  route through an AI gateway, a regional endpoint or an OpenAI-compatible server; each adapter passes it
  to its SDK's base-address option. `MaxOutputTokens` (`[Range(1, 1_000_000)]`, `AiSettings.cs:236`) is
  the hard ceiling `BoundedChatClient.Bound` clamps every call down to. `Timeout` (`AiSettings.cs:243`)
  is enforced with a token linked to the caller's own, so a caller cancelling early still wins.
  `RequireGuardrail` (`AiSettings.cs:252-264`) defaults to `true`: an enabled host that registers no
  guardrail and no redactor fails at startup rather than shipping an uninspected model call; a host that
  deliberately wants none sets it `false`, which is a reviewable line rather than an absence nobody can
  see. `PerCallInputTokenBudget` (`[Range(1, int.MaxValue)]`, `AiSettings.cs:277-278`) is `null` by
  default, leaving input unbounded, and is an ESTIMATE never a billing figure. `Validate`
  (`AiSettings.cs:287-330`) is the conditional half: it `yield break`s immediately when `!Enabled`
  (`AiSettings.cs:289-292`), so a host that leaves AI off is valid with nothing else set, which is what
  lets the section ship in every `appsettings` file; when enabled it requires `Provider`, `Model`,
  `ApiKey`, an absolute `Endpoint` when one is set, and a positive `Timeout`
  (`AiSettings.cs:294-329`).
- **Why it's built this way**: `IValidatableObject.Validate` runs through
  `.ValidateDataAnnotations().ValidateOnStart()` in `AiServiceCollectionExtensions.AddMmcaChatClient`
  (`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:123-126`), so a misconfigured `Ai`
  section fails at host startup, not on the first call. `Provider` became a string, not an enum, so a new
  vendor is a new adapter package registering a factory, never a change to this framework's source. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: bound and consumed by [`AiServiceCollectionExtensions`](#aiservicecollectionextensions),
  enforced by [`BoundedChatClient`](#boundedchatclient), and its `Provider` value is threaded into
  [`UsageRecordingChatClient`](#usagerecordingchatclient) as the fallback tag when the resolved client
  reports none of its own.

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
- **Where it's used**: returned by [`IChatGuardrail`](#ichatguardrail)'s inspection methods; consumed
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
  (`this.GetService<IAiTokenEstimator>()`, `MMCA.Common/Source/Core/MMCA.Common.AI/Chat/BoundedChatClient.cs:288`)
  and falls back to a built-in heuristic when nothing is registered
  (`BoundedChatClient.EstimateInputTokens`, `BoundedChatClient.cs:179`), so a host that wants
  provider-accurate tokenization can register a real tokenizer without changing the bounding logic.
- **Walkthrough**: the interface has no other members; the contract is the single method plus its two
  doc-comment lines describing the parameter and return value (`IAiTokenEstimator.cs:54-56`).
- **Why it's built this way**: `BoundedChatClient.EstimateInputTokens` is `public static` precisely so a
  caller (or the estimator implementation itself) can reproduce the same estimate the budget check uses
  (`BoundedChatClient.cs:155-179`), and it deliberately rounds up with a cheap four-characters-per-token
  heuristic when no estimator is registered, an under-count that only ever lets a call through, never
  blocks one that would have fit (`BoundedChatClient.cs:176-179`).
- **Where it's used**: [`BoundedChatClient.EnforceInputBudget`](#boundedchatclient)
  (`BoundedChatClient.cs:277-292`) is the only production call site; the test fixture
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
  version back off `ChatOptions` to tag every usage measurement; ADC's `AnthropicScoringService`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AnthropicScoringService.cs`)
  is the production caller that builds a `PromptContract` for session scoring, and ADC's architecture
  fitness test `AiDependencyIsolationTests`
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Layering/AiDependencyIsolationTests.cs`)
  asserts the isolation boundary this contract type crosses.

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

- **What it is**: the extension point a host implements to inspect chat traffic: `InspectRequestAsync`
  before the model is called, `InspectResponseAsync` after a completed response, and
  `InspectStreamedUpdateAsync` for one streamed update, each returning a
  [`GuardrailVerdict`](#guardrailverdict) (`IChatGuardrail.cs:27-30,37-40,56-59`). The streamed member
  is a default interface member that allows by default, so a guardrail written before it existed keeps
  compiling and keeps its streaming behavior.
- **Depends on**: [`GuardrailVerdict`](#guardrailverdict),
  `Microsoft.Extensions.AI.ChatMessage`/`ChatOptions`/`ChatResponse`/`ChatResponseUpdate`.
- **Concept introduced, guardrail as a resolved multi-instance dependency.** `[Rubric §11, Security]`
  (assesses whether content passing through an AI dependency is inspected before and after the model):
  every registered implementation runs, in registration order, on the outgoing request, the completed
  response, and each streamed update (`GuardrailChatClient.cs:65-68,88-102,146-154`); a host that
  registers neither a guardrail nor a redactor pays no cost, see
  [`AiServiceCollectionExtensions`](#aiservicecollectionextensions)'s descriptor check, and an enabled
  host with `RequireGuardrail` true (the default) fails at startup instead.
- **Walkthrough**: `InspectRequestAsync` (`IChatGuardrail.cs:27-30`) takes the materialized (and, if any
  redactor ran, already-redacted) message list and the call's options, returning a verdict; a block here
  stops the call before the provider is reached. `InspectResponseAsync` (`IChatGuardrail.cs:37-40`) takes
  the completed `ChatResponse` and the same options; a block here stops the response from reaching the
  caller after the provider call already ran. `InspectStreamedUpdateAsync`
  (`IChatGuardrail.cs:56-59`) takes one `ChatResponseUpdate` fragment; a rule that needs the whole answer
  has to accumulate it itself, and a block ends the stream from that update on, though the caller has
  already seen every update yielded before it.
- **Why it's built this way**: separate inspection points let an implementation block on
  prompt-injection patterns in the request, unsafe content in a completed answer, and unsafe content in a
  streamed fragment, three different failure modes with three different signals, without forcing a
  streaming caller to buffer the whole answer just to be inspected. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: resolved from DI by [`GuardrailChatClient`](#guardrailchatclient); no built-in
  implementation ships in `MMCA.Common.AI`.
- **Caveats / not-in-source**: no production implementation is present in this codebase; the test fixture
  `MMCA.Common/Tests/Core/MMCA.Common.AI.Tests/Fixtures/StubGuardrail.cs` supplies one for unit tests.

---

### UsageRecordingChatClient
> MMCA.Common.AI.Chat · `MMCA.Common.AI.Chat` · `MMCA.Common/Source/Core/MMCA.Common.AI/Chat/UsageRecordingChatClient.cs:38` · Level 1 · class

- **What it is**: a `DelegatingChatClient` that records every call's token usage AND end-to-end latency to
  [`AiUsageMeter`](#aiusagemeter), tagged with the model, the prompt name/version read off
  [`PromptContract`](#promptcontract), and a resolved provider name.
- **Depends on**: `Microsoft.Extensions.AI.DelegatingChatClient`/`IChatClient`/`UsageContent`/`ChatClientMetadata`,
  `System.Diagnostics.Stopwatch`, [`AiUsageMeter`](#aiusagemeter),
  [`PromptContract`](#promptcontract) (`ReadName`/`ReadVersion`).
- **Concept introduced, cross-referenced.** `[Rubric §13, Observability & Operability]`: same category
  as [`AiUsageMeter`](#aiusagemeter); this type is the call site that turns a response into a
  measurement, closing the loop between [`PromptContract`](#promptcontract)'s stamped identity and the
  meter's counters and duration histogram.
- **Walkthrough**: the constructor takes the inner client, the meter, and an optional configured provider
  fallback, then resolves the `Provider` property once via the static `ResolveProviderName`
  (`UsageRecordingChatClient.cs:42-52`): it prefers whatever the inner client itself reports through
  `ChatClientMetadata.ProviderName`, falls back to the constructor's `configuredProvider` lower-cased, and
  falls back further to the literal `unknown` (`UsageRecordingChatClient.cs:57-81`); this is what lets one
  client work correctly whichever `IAiProviderFactory` built the inner client, or when none did.
  `GetResponseAsync` starts a `Stopwatch` timestamp, awaits the base call inside a
  `try`, and records the duration with `AiUsageMeter.CanceledOutcome` or `ErrorOutcome` from the matching
  `catch` before rethrowing; on success it records the duration with
  `SuccessOutcome`, then records `response.Usage` tagged with `response.ModelId ?? options?.ModelId` and
  the prompt name/version read back off `options` via
  [`PromptContract.ReadName`/`ReadVersion`](#promptcontract),
  returning the response unchanged. `GetStreamingResponseAsync` is
  hand-driven with an explicit `GetAsyncEnumerator`/`MoveNextAsync` loop rather than `await foreach`,
  because C# forbids a `yield return` inside a `try` that has a `catch` clause and the outcome has to be
  known before the `finally` records the duration; it tracks the
  first non-null `modelId` seen across updates, records any `UsageContent` each update carries through the
  private `RecordUsageIn`, yields the update, and in a `finally`
  records the duration under whichever outcome the loop settled
  on, stopping the clock only once the stream itself ends, which is the number a caller of a streaming API
  actually feels. The private `RecordDuration` is the shared
  helper both paths call, and both paths tag every measurement with the resolved `Provider` property
  rather than a constructor field.
- **Why it's built this way**: usage recording happens after the base call returns (or per streamed
  `UsageContent`), so this client never alters the response, only observes it; that keeps it safely
  composable with [`BoundedChatClient`](#boundedchatclient), which does alter requests. Resolving the
  provider tag from the client's own metadata, with the configured value only as a fallback, means the tag
  stays accurate even when the provider-agnostic `AddMmcaChatClient` overload is used with a hand-built
  client. Duration is
  recorded on every outcome, including a thrown exception or a cancellation, so a failure rate and a
  latency distribution come off the same series. See
  [`ADR-111`](https://ivanball.github.io/docs/adr/111-ai-session-scoring-governance.html) and
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: registered last (innermost of the two governance wrappers, so it sees the actual
  provider response) by
  [`AiServiceCollectionExtensions.AddMmcaChatClient`](#aiservicecollectionextensions)
  (`DependencyInjection.cs:164-168`); ADC's `AnthropicScoringService`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AnthropicScoringService.cs`)
  and `MMCA.ADC.Conference.Service/Program.cs` are downstream of the registered pipeline.

---

### BoundedChatClient
> MMCA.Common.AI.Chat · `MMCA.Common.AI.Chat` · `MMCA.Common/Source/Core/MMCA.Common.AI/Chat/BoundedChatClient.cs:65` · Level 2 · class

- **What it is**: a `DelegatingChatClient` (Microsoft.Extensions.AI) that enforces the governance bounds
  from [`AiSettings`](#aisettings) on every call: output-token clamping, model pinning, per-request tool
  policy filtering, a linked per-call timeout, and an optional input-token pre-flight budget.
- **Depends on**: `Microsoft.Extensions.AI.DelegatingChatClient`/`IChatClient`/`ChatOptions`/`AITool`,
  [`AiSettings`](#aisettings), `IChatToolPolicy` (a group of every registered one, injected through the
  constructor), [`IAiTokenEstimator`](#iaitokenestimator) (resolved, not injected),
  `System.Globalization.CultureInfo`, `System.Text.StringBuilder`.
- **Concept introduced, a governance layer as a chat-client decorator.** `[Rubric §12, Performance &
  Scalability]` (assesses whether a resource-bounded dependency is protected against runaway cost or
  latency): every bound applied here (output tokens, timeout, input budget) exists to keep one call from
  exceeding what the host budgeted for it. `[Rubric §29, Resilience & Business Continuity]` (assesses
  whether an external dependency is time-bounded): the linked `CancellationTokenSource`
  (`CreateLinkedTimeout`, `BoundedChatClient.cs:270-276`) guarantees the provider call cannot hang past
  `AiSettings.Timeout` regardless of what the caller's own token does. This is the first client wrapped
  in [`AiServiceCollectionExtensions`](#aiservicecollectionextensions)'s pipeline, matching the
  outermost-first ordering the type's own remarks describe.
- **Walkthrough**: the two-argument constructor (`BoundedChatClient.cs:78-84`) delegates to the
  three-argument one with an empty tool-policy list, for a host that composes the client by hand and does
  not offer tools; the real constructor (`BoundedChatClient.cs:87-97`) takes the inner client, the
  settings, and every `IChatToolPolicy` to consult. `GetResponseAsync` (`BoundedChatClient.cs:100-115`)
  materializes the
  message enumerable once, calls `Bound` to clamp options, calls `EnforceInputBudget`, then races the
  base call against a linked timeout. `GetStreamingResponseAsync`
  (`BoundedChatClient.cs:117-131`) bounds and budget-checks eagerly, OUTSIDE the iterator method
  `StreamBoundedAsync`, so a request the configuration forbids is refused when it is made, not when
  somebody starts reading the stream; `StreamBoundedAsync`
  (`BoundedChatClient.cs:133-153`) then wraps the whole stream, not just its first update, in the linked
  timeout, because a provider that opens a response and then stalls is exactly the failure mode a
  per-call budget exists to bound. The static
  `EstimateInputTokens` (`BoundedChatClient.cs:155-179`) concatenates `options.Instructions` plus every
  message's text and either runs the resolved `IAiTokenEstimator` or falls back to a four-characters-
  per-token heuristic. `Bound` (`BoundedChatClient.cs:181-229`) clones
  the incoming `ChatOptions`, clamps `MaxOutputTokens` to the smaller of the request's own value and
  `_settings.MaxOutputTokens`, and when `AllowTools` is false nulls out `Tools`/`ToolMode` entirely: a
  model that cannot be handed a tool cannot be talked into using one. When `AllowTools` is true it instead
  narrows the offered tools through `FilterTools` (`BoundedChatClient.cs:231-269`), which requires every
  registered `IChatToolPolicy` to authorize a tool (no policy registered means no tool survives, since an
  unanswered capability question is answered by withholding it) and, for a tool `ChatToolPolicy` marks
  consequential, additionally requires the request to carry a matching `mmca.tool.confirmed` stamp read
  by `ChatToolPolicy.ReadConfirmedTools`; a `ToolMode` with no surviving tools is cleared too, since a
  mode the provider cannot honor would otherwise be an error rather than a plain answer. `Bound` also
  enforces `AiSettings.Model` as a pin: a request naming a different `ModelId` throws
  `InvalidOperationException` naming the conflict, and when the request names none the pinned model is
  stamped explicitly so every adapter is asked for it by name and a failed call's model tag is never
  blank. `EnforceInputBudget` (`BoundedChatClient.cs:277-292`) is a no-op when
  `PerCallInputTokenBudget` is unset, otherwise it estimates and throws `InvalidOperationException` with
  the estimated count, the configured budget, and a reminder that the estimate is approximate when the
  estimate exceeds the budget.
- **Why it's built this way**: bounding happens BEFORE the linked timeout is created and BEFORE the base
  call, so a call this client is going to refuse never reaches the network. Clamping the smaller of the
  request's and the settings' `MaxOutputTokens`, rather than always overriding, lets a caller ask for
  less without losing that choice. Tool authorization is checked on top of the caller's confirmation
  stamp, never instead of it, because a human saying yes to a prompt is not a grant of an authority the
  application never had; registration refuses `AllowTools: true` with no `IChatToolPolicy` registered
  (see [`AiServiceCollectionExtensions`](#aiservicecollectionextensions)), so reaching `FilterTools` with
  no policies means the client was composed by hand outside that guard. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: registered first (outermost is applied last by `ChatClientBuilder`, so it ends up
  wrapping everything but `UsageRecordingChatClient`) by
  [`AiServiceCollectionExtensions.AddMmcaChatClient`](#aiservicecollectionextensions)
  (`DependencyInjection.cs:149-154`).

---

### GuardrailChatClient
> MMCA.Common.AI.Chat · `MMCA.Common.AI.Chat` · `MMCA.Common/Source/Core/MMCA.Common.AI/Chat/GuardrailChatClient.cs:31` · Level 2 · class

- **What it is**: a `DelegatingChatClient` that redacts a request with every registered
  `IChatRequestRedactor`, then runs every registered [`IChatGuardrail`](#ichatguardrail) over the
  redacted request, the completed response, and each streamed update, throwing
  [`ChatGuardrailException`](#chatguardrailexception) on the first block.
- **Depends on**: `Microsoft.Extensions.AI.DelegatingChatClient`/`IChatClient`/`ChatMessage`,
  [`IChatGuardrail`](#ichatguardrail), `IChatRequestRedactor`, [`GuardrailVerdict`](#guardrailverdict),
  [`ChatGuardrailException`](#chatguardrailexception).
- **Concept introduced, cross-referenced.** `[Rubric §11, Security]`: same category as
  [`IChatGuardrail`](#ichatguardrail); this type is the pipeline stage that redacts, then actually calls
  every registered guardrail and turns a block into a thrown exception.
- **Walkthrough**: the two-argument constructor (`GuardrailChatClient.cs:39-42`) delegates to the
  three-argument one with an empty redactor list; the real constructor
  (`GuardrailChatClient.cs:48-58`) materializes the injected `IEnumerable<IChatGuardrail>` and
  `IEnumerable<IChatRequestRedactor>` into arrays once. `GetResponseAsync` (`GuardrailChatClient.cs:61-87`)
  materializes the message enumerable, redacts it with `Redact` (`GuardrailChatClient.cs:126-135`, every
  registered redactor applied in order, its output feeding the next), inspects the redacted request
  through every guardrail (`InspectRequestAsync` private
  helper, `GuardrailChatClient.cs:137-154`), calls the base client, then inspects the response through
  every guardrail before returning it, throwing on the first `IsAllowed: false` verdict either side.
  `GetStreamingResponseAsync` (`GuardrailChatClient.cs:90-117`) redacts and inspects
  the request the same way, then, unlike the non-streaming path, also inspects EACH streamed update
  through every guardrail's `InspectStreamedUpdateAsync` before yielding it, so a block ends the stream at
  that update; it does NOT inspect an assembled whole answer, because accumulating one before releasing
  any of it defeats the reason a caller chose streaming, and that accumulation, if a rule needs it, stays
  the caller's own choice. The private `Materialize` (`GuardrailChatClient.cs:119-124`) avoids
  re-enumerating a caller's lazily generated sequence, since the same message list must reach the
  redactors, the guardrails, and the inner client.
- **Why it's built this way**: redaction runs FIRST, on both paths, and its output is what the guardrails
  inspect and what the provider is sent, so a guardrail never has to reason about text a redactor was
  going to remove anyway and nothing downstream of this layer can see the original. Request and response
  inspection both run BEFORE the caller sees anything, for the response side, before `GetResponseAsync`
  returns, so an application that adopts a guardrail never observes a blocked answer even transiently. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: registered by [`AiServiceCollectionExtensions`](#aiservicecollectionextensions)
  only when the host has registered at least one [`IChatGuardrail`](#ichatguardrail) or one
  `IChatRequestRedactor`, checked by descriptor rather than by resolving one, so a host that adopts
  neither pays no pipeline cost.

---

### PromptTaggingChatClient
> MMCA.Common.AI.Chat · `MMCA.Common.AI.Chat` · `MMCA.Common/Source/Core/MMCA.Common.AI/Chat/PromptTaggingChatClient.cs:21` · Level 9 · class

- **What it is**: a `DelegatingChatClient` that copies a call's [`PromptContract`](#promptcontract)
  identity (name, version, hash) onto the current `Activity` as tags, but only when that activity belongs
  to `AiUsageMeter`'s own trace source (`PromptTaggingChatClient.cs:52-63`).
- **Depends on**: `Microsoft.Extensions.AI.DelegatingChatClient`/`IChatClient`,
  `System.Diagnostics.Activity`, [`AiUsageMeter`](#aiusagemeter) (for `MeterName`, matched against
  `Activity.Current.Source.Name`), [`PromptContract`](#promptcontract) (for the three property-key
  constants it reads off `ChatOptions.AdditionalProperties`).
- **Concept introduced, telemetry tagging as its own decorator layer.** `[Rubric §13, Observability &
  Operability]` (assesses whether a traced call carries the prompt identity that produced it, not just a
  raw request/response pair): rather than folding this into
  [`UsageRecordingChatClient`](#usagerecordingchatclient), it is a separate, single-purpose client
  registered near the end of the pipeline, after the OpenTelemetry instrumentation it tags has already
  started the activity it writes into.
- **Walkthrough**: `GetResponseAsync` and `GetStreamingResponseAsync`
  (`PromptTaggingChatClient.cs:29-46`) both call the private `Tag` before delegating to the base client.
  `Tag` (`PromptTaggingChatClient.cs:48-63`) returns immediately unless `Activity.Current` is non-null,
  its `Source.Name` equals `AiUsageMeter.MeterName` exactly (ordinal comparison), and the call's
  `ChatOptions.AdditionalProperties` is present; when all three hold, it walks
  `PromptContract.NamePropertyKey`/`VersionPropertyKey`/`HashPropertyKey`, and for each one present as a
  `string` value calls `activity.SetTag(key, text)`.
- **Why it's built this way**: matching the activity source name, rather than tagging whatever activity
  happens to be current, keeps this client inert when nothing downstream is listening on the AI meter's
  own trace source, so it never writes tags onto an unrelated caller's span.
- **Where it's used**: registered last among the governance decorators, immediately before `.UseLogging()`,
  by [`AiServiceCollectionExtensions.AddMmcaChatClient`](#aiservicecollectionextensions)
  (`DependencyInjection.cs:183`).

---

### AiServiceCollectionExtensions
> MMCA.Common.AI · `MMCA.Common.AI` · `MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:77` · Level 10 · class

- **What it is**: the DI entry point for the whole AI integration: two `extension(IServiceCollection)`
  members, `AddMmcaChatClient(IConfiguration)` and the factory overload
  `AddMmcaChatClient(IConfiguration, Func<IServiceProvider, IChatClient>)`, that bind
  [`AiSettings`](#aisettings), and when enabled, build the full governed pipeline.
- **Depends on**: [`AiSettings`](#aisettings), [`AiUsageMeter`](#aiusagemeter),
  [`BoundedChatClient`](#boundedchatclient), [`GuardrailChatClient`](#guardrailchatclient),
  [`PromptTaggingChatClient`](#prompttaggingchatclient), [`IChatGuardrail`](#ichatguardrail),
  `IChatRequestRedactor`, `IChatToolPolicy`, [`UsageRecordingChatClient`](#usagerecordingchatclient),
  `IAiProviderFactory` (resolved by name, one per adapter package),
  `AiProviderValidator` (both as an `IValidateOptions<AiSettings>` and for its static `Match`/
  `DescribeMismatch` helpers), `Microsoft.Extensions.AI.ChatClientBuilder` (`AddChatClient`, `.Use`,
  `.UseDistributedCache`, `.UseOpenTelemetry`, `.UseLogging`),
  `Microsoft.Extensions.Caching.Distributed.IDistributedCache`,
  `Microsoft.Extensions.Hosting.IHostEnvironment`.
- **Concept introduced, cross-referenced to the primer's `extension(T)` note (00-primer.md#c-extensiont-types--read-this-once).**
  `[Rubric §2, Design Patterns]` (assesses whether a composition pipeline is idiomatic): the method
  builds a `ChatClientBuilder` decorator chain where "first registered is outermost":
  [`BoundedChatClient`](#boundedchatclient) wraps first (outermost), then, only when the host registered
  a guardrail or a redactor, [`GuardrailChatClient`](#guardrailchatclient), then
  [`UsageRecordingChatClient`](#usagerecordingchatclient), then optionally a distributed cache
  layer, then OpenTelemetry, then [`PromptTaggingChatClient`](#prompttaggingchatclient), then logging.
  `[Rubric §16, AI-Native Application Architecture]`: this is the single composition point that turns raw
  provider access into the framework's governed AI dependency, and the point that now refuses to build an
  ungoverned one: an enabled host with `RequireGuardrail` true and no guardrail or redactor, or with
  `AllowTools` true and no `IChatToolPolicy`, throws at registration rather than at the first call.
- **Walkthrough**: `AddMmcaChatClient(IConfiguration)` (`DependencyInjection.cs:88-97`) registers
  `AiProviderValidator` as an `IValidateOptions<AiSettings>` via `TryAddEnumerable` BEFORE delegating to
  the factory overload with `CreateProviderChatClient`, so an unknown or unregistered provider name is a
  boot failure validated alongside the data annotations, not a first-call one. The factory overload
  (`DependencyInjection.cs:99-186`) is the extension point a test uses to exercise the pipeline without a
  network, and the one a host with its own credential story plugs into: it binds and validates
  `AiSettings` (`.Bind(section).ValidateDataAnnotations().ValidateOnStart()`,
  `DependencyInjection.cs:123-126`), reads the settings once with `section.Get<AiSettings>() ?? new
  AiSettings()` (`DependencyInjection.cs:128`), and returns early, registering nothing, when
  `!settings.Enabled` (`DependencyInjection.cs:129-132`). When enabled it checks by service descriptor
  (not resolve) whether the host registered any `IChatGuardrail` or `IChatRequestRedactor`
  (`DependencyInjection.cs:139-140`) and calls the private `RefuseAnUngovernedHost`
  (`DependencyInjection.cs:142,202-227`), which throws when `RequireGuardrail` is true and neither is
  registered, and separately when `AllowTools` is true and no `IChatToolPolicy` is registered; both
  messages name the one-line fix. It then registers `AddMetrics()` and a singleton
  `AiUsageMeter` (`DependencyInjection.cs:144-145`), then builds the chain via `AddChatClient` +
  `.Use(...)` for [`BoundedChatClient`](#boundedchatclient), now also handing it every resolved
  `IChatToolPolicy` (`DependencyInjection.cs:149-154`). Using the descriptor check from above, it adds
  [`GuardrailChatClient`](#guardrailchatclient) to the chain only when a guardrail or a redactor was found,
  resolving both groups at build time (`DependencyInjection.cs:156-162`). It then adds
  [`UsageRecordingChatClient`](#usagerecordingchatclient), passing the bound `AiSettings.Provider` as its
  fallback provider name (`DependencyInjection.cs:164-168`). It adds a
  distributed-cache layer only when `EnableCache` is set AND an `IDistributedCache` is actually
  registered (`DependencyInjection.cs:170-175`), because a cache the host never registered would make
  every call throw at resolve time, so the opt-in needs both halves: the switch AND a store to write to.
  It then applies OpenTelemetry with `EnableSensitiveData` gated by `IsDevelopmentHost`, then
  [`PromptTaggingChatClient`](#prompttaggingchatclient), then logging last
  (`DependencyInjection.cs:177-184`). The private `CreateProviderChatClient`
  (`DependencyInjection.cs:239-248`) resolves every registered `IAiProviderFactory`, matches one by name
  against `AiSettings.Provider` through `AiProviderValidator.Match`, and calls `factory.Create(settings,
  serviceProvider)`; a name with no matching factory throws `InvalidOperationException` built from
  `AiProviderValidator.DescribeMismatch`, which is a belt for the case where the options pipeline was
  bypassed, since `AiProviderValidator` has already refused an unmatched name at startup. The private
  `IsDevelopmentHost` (`DependencyInjection.cs:262-266`) fails CLOSED: an environment it cannot
  positively identify as `Development` (by scanning already-registered `IHostEnvironment` instances)
  reads as not-Development, so prompt and completion text never reach telemetry by accident, mirroring
  the same gate on `Persistence:EnableSensitiveDataLogging` elsewhere in the framework.
- **Why it's built this way**: an early return for `!Enabled` means a host that ships the `Ai` section
  disabled pays zero DI registration cost, not just a runtime no-op. Reading settings once via
  `section.Get<AiSettings>()` (rather than resolving `IOptions<AiSettings>` before the container is
  built) lets the method branch on `Enabled` synchronously during registration.
  `RefuseAnUngovernedHost` runs at registration, with the fix named in the message both times, so a bound
  nobody reaches is not a bound: the deployment fails instead of the tenth user. Resolving the provider by
  name against registered `IAiProviderFactory` instances, rather than switching on a closed enum, means a
  new vendor is a new adapter package, never a change to this class. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: the entry point every AI-enabled host calls; no other type in
  `MMCA.Common.AI` calls it, so its consumers are
  downstream application hosts such as ADC's `MMCA.ADC.Conference.Service`.

### AiUsageMeter
> MMCA.Common.AI.Observability · `MMCA.Common.AI.Observability` · `MMCA.Common/Source/Core/MMCA.Common.AI/Observability/AiUsageMeter.cs:20` · Level 0 · class

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
  (`AiUsageMeter.MeterName` reused at `DependencyInjection.cs:181`), so a host enables traces and metrics
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
  (`AiUsageMeter.cs:155-165`, `model`/`prompt_name`/`prompt_version`/`provider` each falling back to
  `"unknown"` when absent or blank), so a dashboard can join the cost series and the latency series on
  the same tags. `provider` is a plain `string?` here, not the `AiProvider` enum: the caller (the
  resolved chat client's `ChatClientMetadata`) may name a provider the framework does not enumerate, so
  the meter records whatever string it is given rather than forcing it through a closed set.
- **Why it's built this way**: recording input and output as two separate counters, tagged by model and
  prompt identity, lets a spend dashboard break down cost by exactly the dimensions a prompt-versioning
  workflow cares about; the duration histogram carries the same dimensions plus outcome so the same join
  works for latency and failure rate. See
  [`ADR-041`](https://ivanball.github.io/docs/adr/041-observability-and-telemetry.html)
  for the framework's general telemetry conventions and
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html) for this
  meter's place in the governed pipeline.
- **Where it's used**: registered as a singleton and resolved by
  [`AiServiceCollectionExtensions`](#aiservicecollectionextensions) (`DependencyInjection.cs:145,167`);
  `Record` and `RecordDuration` are called exclusively from
  [`UsageRecordingChatClient`](#usagerecordingchatclient), which stops the clock in a `try`/`finally` so
  every outcome, including a cancellation or an exception, is recorded.

---

### ChatToolPolicy
> MMCA.Common.AI.Guardrails · `MMCA.Common.AI.Guardrails` · `MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ChatToolPolicy.cs:23` · Level 0 · class

- **What it is**: a static helper reading two `AdditionalProperties` conventions the tool-calling
  boundary shares: whether a tool declares itself consequential, and which tool names the caller
  confirmed for the current request.
- **Depends on**: `Microsoft.Extensions.AI` (`AITool`, `ChatOptions`).
- **Concept introduced, per-request confirmation via `AdditionalProperties`.** `[Rubric §16, AI-Native
  Application Architecture]` (assesses tool-calling safety patterns): a confirmation is carried as a
  key in `ChatOptions.AdditionalProperties`, never as a typed property, so it composes with any
  `ChatOptions` without a wrapper type. `[Rubric §11, Security]`: the confirmation is scoped to ONE
  request by design (`ChatToolPolicy.cs:33` remark), because a confirmation that outlived the request
  it was given for would be a standing grant, exactly what a confirmation step exists to avoid.
- **Walkthrough**: `ConsequentialPropertyKey = "mmca.tool.consequential"` (`ChatToolPolicy.cs:26`)
  marks an `AITool` as doing something that cannot be undone by not reading the answer.
  `ConfirmedToolsPropertyKey = "mmca.tool.confirmed"` (`ChatToolPolicy.cs:31`) holds the confirmed
  names for the current request. `IsConsequential` (`ChatToolPolicy.cs:40-55`) reads the tool's
  `AdditionalProperties`: a missing key is `false`; a `bool` value is used as-is; a `string` value is
  parsed with `bool.TryParse` (configuration and JSON both hand a boolean over as text, and a tool
  declared consequential in a settings file must not read as harmless because of that); anything else
  is `false`. `ReadConfirmedTools` (`ChatToolPolicy.cs:58-78`) reads the confirmed names off
  `ChatOptions.AdditionalProperties`, accepting a single `string`, an `IEnumerable<string>`, or a
  non-generic `IEnumerable` (a JSON array bound as `object[]`), converting each element with
  `Convert.ToString` and dropping empties; anything else returns none.
- **Why it's built this way**: see
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html) for the
  guardrail boundary this policy plugs into.
- **Where it's used**: [`BoundedChatClient`](#boundedchatclient) calls both methods when filtering
  tools through the registered [`IChatToolPolicy`](#ichattoolpolicy) instances.

---

### ContentPolicyInjectionMode
> MMCA.Common.AI.Guardrails · `MMCA.Common.AI.Guardrails` · `MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ContentPolicyInjectionMode.cs:16` · Level 0 · enum

- **What it is**: the three-way mode [`ContentPolicyGuardrail`](#contentpolicyguardrail) reads to
  decide what to do with a prompt-injection marker found in user-role content.
- **Depends on**: read by [`ContentPolicySettings`](#contentpolicysettings) and
  [`ContentPolicyGuardrail`](#contentpolicyguardrail).
- **Walkthrough**: `Redact = 0` (`ContentPolicyInjectionMode.cs:22-26`, the default) replaces every
  marker match with `ContentPolicySettings.RedactionPlaceholder` and lets the call proceed. `Block = 1`
  (`ContentPolicyInjectionMode.cs:28-32`) leaves the content alone and refuses the call, naming the
  marker that matched. `Off = 2` (`ContentPolicyInjectionMode.cs:34-35`) does neither; configured
  response patterns still apply, because they are a separate axis.
- **Why it's built this way**: keeping redact/block/off as an explicit, mutually exclusive mode (rather
  than two independent booleans) means a host cannot accidentally combine "rewrite the content" with
  "refuse the call on the same content", which would be a contradiction. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: [`ContentPolicySettings.InjectionMode`](#contentpolicysettings);
  [`ContentPolicyGuardrail`](#contentpolicyguardrail) branches on it in `Redact` and
  `InspectRequestAsync`.

---

### GoldenReplayCase
> MMCA.Common.AI.Testing · `MMCA.Common.AI.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.AI.Testing/GoldenReplayCase.cs:13` · Level 0 · record

- **What it is**: one entry in a golden-replay corpus: an `Id`, a `Description`, and a `ResponsePath`
  naming the recorded response file to replay for that case (`GoldenReplayCase.cs:13-17`).
- **Depends on**: none first-party; consumed by [`GoldenReplayTestsBase`](#goldenreplaytestsbase).
- **Walkthrough**: a `sealed record` with three positional properties; `ToString()` returns `Id`
  (`GoldenReplayCase.cs:15-16`), which is what an xUnit theory display name shows.
- **Where it's used**: [`GoldenReplayTestsBase.Cases`](#goldenreplaytestsbase); ADC's
  `MMCA.ADC.Conference.Scoring.Evaluation.Tests` declares its own corpus of these.

---

### IChatRequestRedactor
> MMCA.Common.AI.Guardrails · `MMCA.Common.AI.Guardrails` · `MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/IChatRequestRedactor.cs:25` · Level 0 · interface

- **What it is**: the contract for rewriting a request's messages before they reach the model.
- **Depends on**: `Microsoft.Extensions.AI.ChatMessage`.
- **Concept introduced, new instances, never a mutation.** `[Rubric §1, SOLID]` (single responsibility:
  redaction is its own boundary, separate from allow/block decisions): `Redact` returns NEW
  `ChatMessage` instances carrying the redacted content (`IChatRequestRedactor.cs:29-33` remark); a
  caller holding its own conversation history, retry buffer, or audit record must still hold exactly
  what it built, so an implementation that edited the incoming messages in place would silently rewrite
  the caller's own data as a side effect of sending it.
- **Walkthrough**: one method, `Redact(IReadOnlyList<ChatMessage> messages)`
  (`IChatRequestRedactor.cs:34`), returning the messages to send in place of the ones supplied.
- **Why it's built this way**: separating redaction (`IChatRequestRedactor`, changes the payload) from
  a guardrail's allow/block decision ([`IChatGuardrail`](#ichatguardrail)) lets a type implement one,
  the other, or both, as [`ContentPolicyGuardrail`](#contentpolicyguardrail) and
  [`PiiRedactionGuardrail`](#piiredactionguardrail) do. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: implemented by [`ContentPolicyGuardrail`](#contentpolicyguardrail) and
  [`PiiRedactionGuardrail`](#piiredactionguardrail); consumed by
  [`GuardrailChatClient`](#guardrailchatclient) and by `DependencyInjection`'s
  `AiSettings.RequireGuardrail` check.

---

### RecordedResponses
> MMCA.Common.AI.Testing · `MMCA.Common.AI.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.AI.Testing/RecordedResponses.cs:20` · Level 0 · class

- **What it is**: the static read/write/serialize/deserialize helpers for a recorded `ChatResponse`
  fixture on disk.
- **Depends on**: `Microsoft.Extensions.AI.AIJsonUtilities`, `System.Text.Json`.
- **Walkthrough**: `Options` (`RecordedResponses.cs:26-27`) is the abstraction's own serializer options
  with `WriteIndented = true`, so a recorded answer stays readable in review and a re-recording
  produces a reviewable diff instead of one long line. `Read(path)` (`RecordedResponses.cs:31-40`)
  throws `FileNotFoundException` naming the path and hinting that the corpus may not be copied to the
  output directory. `Write(path, response)` (`RecordedResponses.cs:44-53`) creates the target folder if
  needed before writing. `Serialize`/`Deserialize` (`RecordedResponses.cs:57-63,67-73`) wrap
  `JsonSerializer` with `Options`; `Deserialize` throws if the JSON does not round-trip to a
  `ChatResponse`.
- **Where it's used**: [`GoldenReplayTestsBase`](#goldenreplaytestsbase) reads a recorded response by
  path for each case; ADC's `GoldenCase`/`GoldenReplayTests` (Conference.Scoring.Evaluation.Tests) and
  this repo's own evaluation tests.

---

### ReplayChatClient
> MMCA.Common.AI.Testing · `MMCA.Common.AI.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.AI.Testing/ReplayChatClient.cs:17` · Level 0 · class

- **What it is**: an `IChatClient` test double that answers every call with one or more recorded
  `ChatResponse`s, in order.
- **Depends on**: `Microsoft.Extensions.AI.IChatClient` (implements it), `ChatResponse`.
- **Concept introduced, deterministic replay over a live model call.** `[Rubric §14, Testability]`
  (assesses whether behavior that depends on an external, non-deterministic dependency can be exercised
  deterministically): rather than calling a live model, a test replays a recorded transcript, so the
  assertion exercises the consumer's parsing and handling code without network variance.
- **Walkthrough**: two constructors (`ReplayChatClient.cs:22-27,29-38`), one for a single response, one
  for an ordered list (rejecting an empty list, since a replay client needs at least one recorded
  answer). `LastOptions`, `LastMessages`, `CallCount` (`ReplayChatClient.cs:41-49`) record what the
  client was last called with, for assertions. `GetResponseAsync` and `GetStreamingResponseAsync`
  (`ReplayChatClient.cs:57-86`) both funnel through the private `Record`, with the streaming path
  projecting the SAME recorded response onto the streaming shape via the abstraction's own
  `ToChatResponseUpdates()` conversion, so a test asserting the streamed answer exercises the same
  corpus as the buffered path rather than a second, hand-built approximation of it. `Record`
  (`ReplayChatClient.cs:98-109`) advances through the recorded list and repeats the LAST response once
  exhausted, so a test calling once more than it recorded gets a stable answer rather than an exception
  from the harness pretending to be a failure in the code under test. `Dispose` is a no-op: the replay
  client holds no transport. `GetService` returns itself only when asked for its own type.
- **Where it's used**: [`GoldenReplayTestsBase.RunCaseAsync`](#goldenreplaytestsbase) constructs one per
  case; `ReplayChatClientTests`, ADC's `GoldenReplayTests`, and `ReferenceGoldenReplayTests`.

---

### ToolAuthorization
> MMCA.Common.AI.Guardrails · `MMCA.Common.AI.Guardrails` · `MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ToolAuthorization.cs:10` · Level 0 · enum

- **What it is**: the two-value outcome an [`IChatToolPolicy`](#ichattoolpolicy) returns for one tool
  on one request: `Denied` (`ToolAuthorization.cs:12`, not offered to the model) or `Allowed`
  (`ToolAuthorization.cs:14`, may be offered unless another policy or the confirmation rule refuses it).
- **Where it's used**: return type of `IChatToolPolicy.Authorize`; read by
  [`BoundedChatClient`](#boundedchatclient) when filtering tools.

---

### GoldenReplayTestsBase
> MMCA.Common.AI.Testing · `MMCA.Common.AI.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.AI.Testing/GoldenReplayTestsBase.cs:24` · Level 1 · class

- **What it is**: the abstract xUnit base that drives a golden-replay corpus: for every
  [`GoldenReplayCase`](#goldenreplaycase) it reads the recorded response, wraps it in a
  [`ReplayChatClient`](#replaychatclient), and hands both to the derived class's assertion.
- **Depends on**: [`GoldenReplayCase`](#goldenreplaycase), [`RecordedResponses`](#recordedresponses),
  [`ReplayChatClient`](#replaychatclient), xUnit `[Fact]`.
- **Concept introduced, aggregated-failure regression gate.** `[Rubric §14, Testability]`: rather than
  stopping at the first failing case, the single `[Fact]` runs every case and reports the complete
  failure set in one message, so a full corpus run always shows every regression from one CI attempt.
- **Walkthrough**: `Cases` and `AssertCaseAsync` (`GoldenReplayTestsBase.cs:27,34-38`) are the two
  hooks a derived test class implements: the corpus, and how one case's outcome is asserted (throwing,
  an assertion failure or anything else, fails that case and is reported against its id).
  `EveryGoldenCase_ReplaysAsRecorded` (`GoldenReplayTestsBase.cs:41-59`) copies `Cases` defensively,
  throws `InvalidOperationException` if the corpus is empty (an empty gate would pass without
  evaluating anything), runs every case through `RunCaseAsync`, and throws one exception listing every
  failure when `failures.Count > 0`. `RunCaseAsync` (`GoldenReplayTestsBase.cs:61-86`) resolves the
  response path under `AppContext.BaseDirectory`, reads it via `RecordedResponses.Read`, builds a
  `ReplayChatClient`, and calls `AssertCaseAsync`; every exception is caught
  (`CA1031`/`S2221` suppressed at `GoldenReplayTestsBase.cs:70` with a comment that a failing case must
  be reported, not end the run) and turned into one line naming the case's id and description.
- **Why it's built this way**: see
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html) and
  [`ADR-111`](https://ivanball.github.io/docs/adr/111-ai-session-scoring-governance.html) for the
  scoring-governance context this harness was built for.
- **Where it's used**: ADC's `GoldenReplayTests` (Conference.Scoring.Evaluation.Tests) and this repo's
  own `ReferenceGoldenReplayTests`/`ReplayChatClientTests` subclass it, exercising the gate itself in
  this repo's CI.

---

### IChatToolPolicy
> MMCA.Common.AI.Guardrails · `MMCA.Common.AI.Guardrails` · `MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/IChatToolPolicy.cs:23` · Level 1 · interface

- **What it is**: the contract letting a host decide whether ONE tool may be offered on ONE request.
- **Depends on**: `Microsoft.Extensions.AI` (`AITool`, `ChatOptions`), [`ToolAuthorization`](#toolauthorization).
- **Concept introduced, pluggable per-tool authorization.** `[Rubric §11, Security]` (assesses whether a
  tool-calling boundary can restrict what a model can act on): tool authorization is a registered,
  per-request extension point rather than a static allow-list, so a host can vary which tools are
  offered by caller identity, role, or the request's content.
- **Walkthrough**: one method, `Authorize(AITool tool, ChatOptions options)`
  (`IChatToolPolicy.cs:29`), returning `ToolAuthorization.Allowed` to offer the tool, otherwise it is
  stripped from the request.
- **Where it's used**: every registered `IChatToolPolicy` is consulted by
  [`BoundedChatClient`](#boundedchatclient) (a consequential tool, per
  [`ChatToolPolicy.IsConsequential`](#chattoolpolicy), additionally needs the request's confirmed-tools
  stamp); `DependencyInjection` registers implementations; `StubToolPolicy` in tests.

---

### PromptContractPinTestsBase
> MMCA.Common.AI.Testing · `MMCA.Common.AI.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.AI.Testing/PromptContractPinTestsBase.cs:25` · Level 1 · class

- **What it is**: the abstract xUnit base pinning every declared `PromptContract`'s hash to a recorded
  JSON file, so a prompt, model, or system-text change without a version bump fails CI.
- **Depends on**: [`PromptContract`](#promptcontract) (`Name`, `Version`, `Hash`), `System.Text.Json`.
- **Concept introduced, prompt-version pinning.** `[Rubric §16, AI-Native Application Architecture]`
  (assesses whether prompt changes are governed the way schema or contract changes are): this is the
  companion gate to [`GoldenReplayTestsBase`](#goldenreplaytestsbase); the golden-replay base tests the
  CODE's handling of a recorded answer, this base tests that the PROMPT itself did not drift silently.
- **Walkthrough**: `Contracts` and `PinFilePath` (`PromptContractPinTestsBase.cs:29,35`) are the two
  hooks a derived class implements: the contracts this repo pins, and the pin file's path relative to
  `AppContext.BaseDirectory`. `EveryContract_HasARecordedHash`
  (`PromptContractPinTestsBase.cs:37-52`) fails naming the exact
  `"<Name>@<Version>": "<hash>"` line to add for any contract with no pinned entry, because an
  unrecorded version is a prompt nobody evaluated. `EveryRecordedHash_MatchesTheCurrentContract`
  (`PromptContractPinTestsBase.cs:54-70`) fails naming the recorded and the current hash for any
  contract whose `Hash` no longer matches what is pinned. `KeyOf`
  (`PromptContractPinTestsBase.cs:72`) builds the `"<Name>@<Version>"` key both methods share.
  `LoadContracts` (`PromptContractPinTestsBase.cs:74-86`) throws if `Contracts` is empty, the same
  empty-gate guard `GoldenReplayTestsBase` applies. `ReadPinFile`
  (`PromptContractPinTestsBase.cs:90-107`) treats a MISSING pin file as zero recorded entries rather
  than a failure: that is exactly the "nothing is recorded yet" case
  `EveryContract_HasARecordedHash` already reports, with the lines to add and the path to add them to.
- **Why it's built this way**: see
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html) and
  [`ADR-111`](https://ivanball.github.io/docs/adr/111-ai-session-scoring-governance.html).
- **Where it's used**: ADC's `PromptContractTests`, and this repo's
  `ReferencePromptContractTests`/`RecordedResponsesTests` subclass it.

---

### ContentPolicyGuardrail
> MMCA.Common.AI.Guardrails · `MMCA.Common.AI.Guardrails` · `MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ContentPolicyGuardrail.cs:64` · Level 2 · class

- **What it is**: the sealed partial class implementing both `IChatGuardrail` and
  [`IChatRequestRedactor`](#ichatrequestredactor) for prompt-injection and answer-content policy: it
  redacts or blocks user content matching a marker (eight built-in patterns plus any configured
  `AdditionalRequestPatterns`), and refuses an answer matching a configured `BlockedResponsePatterns`
  entry.
- **Depends on**: [`ContentPolicySettings`](#contentpolicysettings) (bound options),
  [`ContentPolicyInjectionMode`](#contentpolicyinjectionmode), `IChatGuardrail`/
  [`IChatRequestRedactor`](#ichatrequestredactor)/`GuardrailVerdict`, `System.Text.RegularExpressions`
  (`[GeneratedRegex]` source generator).
- **Concept introduced, one type composing redaction AND blocking.** `[Rubric §11, Security]`
  (prompt-injection defense: explains what it protects and where it stops): only
  `ChatRole.User` content is inspected or rewritten, and the streaming inspection path
  (`InspectStreamedUpdateAsync`) checks each fragment rather than the whole answer, so a pattern that
  spans two streamed updates is missed by design; a host that needs whole-answer certainty uses the
  buffered path. `[Rubric §16, AI-Native Application Architecture]`.
- **Walkthrough**: `ConfiguredPatternOptions` (`ContentPolicyGuardrail.cs:919`,
  `IgnoreCase | CultureInvariant`) is what every CONFIGURED pattern compiles with; `MatchTimeout`
  (`ContentPolicyGuardrail.cs:922`, 1 second) bounds a single match so a pathological pattern cannot
  hang a request; `BuiltInPatternOptions` adds `ExplicitCapture` on the BUILT-INS ONLY
  (`ContentPolicyGuardrail.cs:924-927`), because turning that off under a host would silently change
  what a configured pattern's own backreferences mean. `BuiltInMarkers`
  (`ContentPolicyGuardrail.cs:929-939`) pairs eight labeled `[GeneratedRegex]` patterns
  (ignore-previous-instructions, disregard-system-prompt, role-reassignment, new-instructions,
  reveal-system-prompt, act-as-unrestricted, developer-mode, do-anything-now), each with a 1-second
  generated-regex timeout. The constructor (`ContentPolicyGuardrail.cs:952-959`) compiles every
  configured pattern ONCE, at resolve time; a pattern that does not compile has already failed
  `ContentPolicySettings.Validate` at startup, so this constructor is not where a typo is discovered.
  `Redact` (`ContentPolicyGuardrail.cs:967-987`) rewrites only when `InjectionMode` is `Redact`: Block
  mode must inspect what the caller supplied, so rewriting there would hide the marker from the check
  that is supposed to refuse it; Off mode does neither. `InspectRequestAsync`
  (`ContentPolicyGuardrail.cs:995-1013`) allows in every mode except `Block`, because in `Redact` mode
  the redactor has already run and there is nothing left to refuse. `InspectResponseAsync`/
  `InspectStreamedUpdateAsync` (`ContentPolicyGuardrail.cs:1016-1041`) both funnel through
  `InspectAnswerText`, which matches against `BlockedResponsePatterns` and returns a block reason
  naming the pattern's INDEX, never the matched text: the reason reaches the caller, and the point of
  the rule was that the text should not. `RedactMessage`/`RedactText`
  (`ContentPolicyGuardrail.cs:1180-1215`) rewrite only `TextContent`, passing images, function calls,
  and provider-specific content through untouched: a guardrail that silently dropped content it does
  not understand would be a far worse failure than leaving it alone.
- **Why it's built this way**: matches the ADR-120 governed pipeline's split between redaction (silent,
  changes the request shape) and blocking (visible, a refusal). See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: registered by
  [`GuardrailServiceCollectionExtensions.AddContentPolicyGuardrail`](#guardrailservicecollectionextensions)
  as both `IChatGuardrail` and `IChatRequestRedactor` from one singleton; ADC's
  `SessionScoreResponseGuardrail` composes it.

---

### ContentPolicySettings
> MMCA.Common.AI.Guardrails · `MMCA.Common.AI.Guardrails` · `MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ContentPolicySettings.cs:23` · Level 2 · class

- **What it is**: the `IValidatableObject`-bound `Ai:ContentPolicy` options:
  [`InjectionMode`](#contentpolicyinjectionmode), `AdditionalRequestPatterns`,
  `BlockedResponsePatterns`, `RedactionPlaceholder`.
- **Depends on**: [`ContentPolicyInjectionMode`](#contentpolicyinjectionmode),
  [`ContentPolicyGuardrail`](#contentpolicyguardrail) (reuses its pattern-compile options and timeout in
  `Validate`), `System.ComponentModel.DataAnnotations`.
- **Concept introduced, options validation as a startup gate.** `[Rubric §17, DevOps]` (fail-fast
  configuration: a bad setting fails the deployment, not the first request it affects): `Validate`
  compiles every configured pattern and reports every failure at once, so the person deploying a typo'd
  pattern, not the first user who trips it, is the one who sees it.
- **Walkthrough**: `SectionName = "Ai:ContentPolicy"` (`ContentPolicySettings.cs:26`);
  `DefaultRedactionPlaceholder = "[redacted-instruction]"` (`ContentPolicySettings.cs:29`), a VISIBLE
  placeholder on purpose (`ContentPolicySettings.cs:1276-1280` remark) so the model can tell something
  was removed and a trace reviewer can tell a redaction from a sentence the user never wrote.
  `InjectionMode` defaults `Redact` (`ContentPolicySettings.cs:1248`).
  `AdditionalRequestPatterns`/`BlockedResponsePatterns` (`ContentPolicySettings.cs:1258,1270`) default
  to empty; an empty `BlockedResponsePatterns` switches the response half of the policy off entirely,
  because a model that has already said the thing cannot unsay it, so the only available response-side
  answer is a refusal. `RedactionPlaceholder` is `[Required]` (`ContentPolicySettings.cs:1281`).
  `Validate` (`ContentPolicySettings.cs:1295-1306`) runs `ValidatePatterns` over both lists, which calls
  `DescribeFailure` (`ContentPolicySettings.cs:1329-1345`) per pattern: an empty-or-whitespace pattern
  is rejected outright (it would match everything, "never what a policy meant"), otherwise the pattern
  is compiled with `ContentPolicyGuardrail.ConfiguredPatternOptions`/`MatchTimeout` and any
  `ArgumentException` message is surfaced against `SectionName:memberName[index]`.
- **Why it's built this way**: see
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: bound and validated by
  [`GuardrailServiceCollectionExtensions.AddContentPolicyGuardrail`](#guardrailservicecollectionextensions);
  read by [`ContentPolicyGuardrail`](#contentpolicyguardrail).

---

### PiiRedactionGuardrail
> MMCA.Common.AI.Guardrails · `MMCA.Common.AI.Guardrails` · `MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/PiiRedactionGuardrail.cs:39` · Level 2 · class

- **What it is**: the sealed partial class implementing
  [`IChatRequestRedactor`](#ichatrequestredactor) and `IChatGuardrail` that strips emails and phone
  numbers from outgoing message text. The guardrail half is a pass-through (always `Allow`): this type
  only redacts, it never blocks.
- **Depends on**: [`IChatRequestRedactor`](#ichatrequestredactor)/`IChatGuardrail`/`GuardrailVerdict`,
  `System.Text.RegularExpressions`.
- **Concept introduced, configuration-free, unconditional redaction.** Contrasts with
  [`ContentPolicyGuardrail`](#contentpolicyguardrail): `PiiRedactionGuardrail` has no configurable
  options and applies to every outgoing message unconditionally.
- **Walkthrough**: `EmailPattern`/`PhonePattern` (`PiiRedactionGuardrail.cs:1397-1407`) are
  `[GeneratedRegex]` source-generated matchers with a 1-second timeout (email: a standard
  local-part@domain shape; phone: an optional leading country code plus a 10-digit US-shaped number,
  guarded by negative lookaround so it does not clip a longer digit run). `Redact`
  (`PiiRedactionGuardrail.cs:1372-1383`) rewrites EVERY message, not only `ChatRole.User` (unlike
  `ContentPolicyGuardrail`), via the private `RedactMessage`
  (`PiiRedactionGuardrail.cs:1409-1435`), which replaces email matches then phone matches in
  `TextContent` only, passing other content types through untouched for the same reason
  `ContentPolicyGuardrail` does (a guardrail that silently dropped content it does not understand would
  be worse than leaving it alone). `InspectRequestAsync`/`InspectResponseAsync`
  (`PiiRedactionGuardrail.cs:1386-1395`) both unconditionally return `GuardrailVerdict.Allow`.
- **Why it's built this way**: unconditional redaction with zero configuration lets the guardrail
  satisfy `AiSettings.RequireGuardrail` with no setup. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html) and
  [`ADR-111`](https://ivanball.github.io/docs/adr/111-ai-session-scoring-governance.html).
- **Where it's used**: registered by
  [`GuardrailServiceCollectionExtensions.AddPiiRedactionGuardrail`](#guardrailservicecollectionextensions)
  (both contracts from one singleton); ADC's `SessionScoreResponseGuardrail` and
  `SessionScoringService` compose it.

---

### GuardrailServiceCollectionExtensions
> MMCA.Common.AI.Guardrails · `MMCA.Common.AI.Guardrails` · `MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/GuardrailServiceCollectionExtensions.cs:17` · Level 3 · class

- **What it is**: the extension block (C# `extension(IServiceCollection services)`) registering the two
  shipped guardrails: `AddPiiRedactionGuardrail()` and `AddContentPolicyGuardrail(configuration)`.
- **Depends on**: [`PiiRedactionGuardrail`](#piiredactionguardrail),
  [`ContentPolicyGuardrail`](#contentpolicyguardrail), [`ContentPolicySettings`](#contentpolicysettings),
  `IChatGuardrail`/[`IChatRequestRedactor`](#ichatrequestredactor),
  `Microsoft.Extensions.DependencyInjection`.
- **Concept introduced, one singleton under two contracts.** `[Rubric §1, SOLID]` (interface
  segregation without instance duplication): each guardrail implements both `IChatGuardrail` and
  `IChatRequestRedactor`, and both are registered from the SAME singleton via
  `TryAddEnumerable(... => serviceProvider.GetRequiredService<T>())`, never two independent instances;
  a host that later gives the type state would otherwise get two copies of it. Registration uses C#
  extension members as the idiom, not static extension methods.
- **Walkthrough**: `AddPiiRedactionGuardrail`
  (`GuardrailServiceCollectionExtensions.cs:1475-1486`) registers `PiiRedactionGuardrail` once via
  `TryAddSingleton`, then `TryAddEnumerable`-registers it under both `IChatGuardrail` and
  `IChatRequestRedactor`. `AddContentPolicyGuardrail`
  (`GuardrailServiceCollectionExtensions.cs:1504-1521`) additionally binds `ContentPolicySettings` from
  `Ai:ContentPolicy` with `.ValidateDataAnnotations().ValidateOnStart()` (so a bad pattern fails the
  deployment, not a user's request) before registering `ContentPolicyGuardrail` the same two-contract
  way. Both methods' doc remarks state they must be called BEFORE `AddMmcaChatClient`, which reads the
  registered descriptors to decide whether to compose the guardrail layer at all.
- **Why it's built this way**: see
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: called by a consuming host before `AddMmcaChatClient`; ADC's
  `Conference.Infrastructure` `DependencyInjection` is the one usage site outside this file's own
  registration tests.

### IAiProviderFactory
> MMCA.Common.AI · `MMCA.Common.AI.Providers` · `MMCA.Common/Source/Core/MMCA.Common.AI/Providers/IAiProviderFactory.cs:20` · Level 1 · interface

- **What it is**: the boundary a vendor SDK adapter implements to plug into `AddMmcaChatClient`'s
  provider selection. `Name` (`IAiProviderFactory.cs:31`) is the case-insensitive string a config file's
  `Ai:Provider` selects it by; `Create` (`IAiProviderFactory.cs:39`) builds the ungoverned
  `IChatClient` for already-validated [`AiSettings`](#aisettings).
- **Depends on**: [`AiSettings`](#aisettings) (the bound `Ai` section it receives), `Microsoft.Extensions.AI.IChatClient`
  and `IServiceProvider` (both external), both parameters of `Create` (`IAiProviderFactory.cs:39`).
- **Concept introduced, the provider-factory boundary.** `[Rubric §1, SOLID]` (assesses dependency
  inversion and substitutability): `AddMmcaChatClient` and [`AiProviderValidator`](#aiprovidervalidator) depend only on this
  interface, never on a concrete vendor SDK type, so a new provider (a third LLM vendor) is one new
  adapter package plus one registration call, with zero changes to the pipeline or the validator.
  `[Rubric §16, AI-Native Application Architecture]` (assesses whether provider selection is a
  first-class, swappable concern rather than hard-wired code): this interface is the entire swap point,
  recorded in [ADR-120](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Walkthrough**: two members only, `Name` (`IAiProviderFactory.cs:31`, a `string` getter) and
  `Create(AiSettings settings, IServiceProvider serviceProvider)` (`IAiProviderFactory.cs:39`, returns
  `IChatClient`). The doc comment on `Create` (`IAiProviderFactory.cs:38`) records that ownership of the
  returned client passes to the governed pipeline that wraps it, i.e. the factory itself never disposes
  what it builds.
- **Why it's built this way**: `serviceProvider` is passed alongside `settings` so an adapter that needs
  a logger or a named `HttpClient` factory can resolve one without the interface growing a parameter per
  future need (`IAiProviderFactory.cs:37`). The instances that implement it, [`AnthropicAiProviderFactory`](#anthropicaiproviderfactory)
  and [`OpenAiProviderFactory`](#openaiproviderfactory), are registered as `IEnumerable<IAiProviderFactory>` so `AddMmcaChatClient` and
  [`AiProviderValidator`](#aiprovidervalidator) can enumerate every adapter package the host actually referenced, never a fixed list.
- **Where it's used**: `DependencyInjection.cs` in `MMCA.Common.AI` resolves the matching factory to
  build the governed client; [`AiProviderValidator`](#aiprovidervalidator) enumerates all registered factories to validate
  `Ai:Provider` at startup; `MMCA.ADC.Conference.Service/Program.cs` registers an adapter package that
  implements it.
- **Caveats / not-in-source**: the interface itself carries no lifetime attribute; the registration
  call sites (`AnthropicAiServiceCollectionExtensions.AddAnthropicAiProvider`,
  `OpenAiServiceCollectionExtensions.AddOpenAiProvider`) are what fix it to singleton, not this type.

### AiProviderValidator
> MMCA.Common.AI · `MMCA.Common.AI.Providers` · `MMCA.Common/Source/Core/MMCA.Common.AI/Providers/AiProviderValidator.cs:16` · Level 2 · class

- **What it is**: an `IValidateOptions<AiSettings>` that runs at options-bind time and fails startup
  when `Ai:Provider` names no registered [`IAiProviderFactory`](#iaiproviderfactory), rather than surfacing that mismatch on
  the first chat call.
- **Depends on**: `IEnumerable<`[`IAiProviderFactory`](#iaiproviderfactory)`>` (constructor-injected, `AiProviderValidator.cs:16`), [`AiSettings`](#aisettings)
  (the options type it validates), `Microsoft.Extensions.Options.IValidateOptions<TOptions>` and
  `ValidateOptionsResult` (external).
- **Concept introduced, options validation as a startup gate.** `[Rubric §11, Security]` and
  `[Rubric §13, Observability & Operability]` (assesses whether misconfiguration fails fast, loudly, and
  early rather than at request time): a blank or misspelled provider name is caught once here, during
  host startup, instead of surfacing as a confusing runtime failure inside the first request that needs
  the chat client.
- **Walkthrough**: the constructor captures the injected factories into a fixed array
  (`AiProviderValidator.cs:18`, `_factories = [.. factories]`). `Validate` (`AiProviderValidator.cs:65`)
  first short-circuits when `Enabled` is false or `Provider` is blank (`AiProviderValidator.cs:71`,
  deferring to the data-annotation validator so the blank case is reported exactly once, not twice).
  Otherwise it calls the static helper `Match` (`AiProviderValidator.cs:85`), which does a case-insensitive
  `FirstOrDefault` over the factories' `Name`; a hit returns `Success`, a miss calls `DescribeMismatch`
  (`AiProviderValidator.cs:92`) to build the failure text. `DescribeMismatch` branches on whether any
  factory is registered at all (`AiProviderValidator.cs:96`): zero factories means no adapter package is
  referenced, so the message names both adapter packages and their registration calls
  (`AddAnthropicAiProvider()`, `AddOpenAiProvider()`) plus the manual `AddMmcaChatClient` overload
  (`AiProviderValidator.cs:98-101`); one or more factories means the name is simply wrong, so the message
  lists the registered provider names, sorted case-insensitively (`AiProviderValidator.cs:104,106`).
- **Why it's built this way**: `Match` and `DescribeMismatch` are `internal static` (`AiProviderValidator.cs:85,92`)
  so the unit tests can exercise the matching and message-building logic directly without standing up
  the full options pipeline. The class itself is `internal sealed` (`AiProviderValidator.cs:16`): it is
  wiring, registered by `MMCA.Common.AI`'s own `DependencyInjection.cs`, not a public extension point.
- **Where it's used**: registered against `AiSettings` by `DependencyInjection.cs` in `MMCA.Common.AI`
  so it runs automatically whenever the options are bound; exercised directly by
  `MMCA.Common/Tests/Core/MMCA.Common.AI.Tests/AiProviderSelectionTests.cs`.

### AnthropicAiProviderFactory
> MMCA.Common.AI.Anthropic · `MMCA.Common.AI.Anthropic` · `MMCA.Common/Source/Core/MMCA.Common.AI.Anthropic/AnthropicAiProviderFactory.cs:14` · Level 2 · class

- **What it is**: the [`IAiProviderFactory`](#iaiproviderfactory) implementation for Anthropic, selected when `Ai:Provider`
  equals `Anthropic` (`ProviderName`, `AnthropicAiProviderFactory.cs:16`).
- **Depends on**: [`IAiProviderFactory`](#iaiproviderfactory), [`AiSettings`](#aisettings); externally, the Anthropic SDK's `AnthropicClient`
  and `ClientOptions`, and `Microsoft.Extensions.AI`'s `AsIChatClient` adapter extension
  (`AnthropicAiProviderFactory.cs:164`).
- **Concept**: first concrete example of the factory boundary [`IAiProviderFactory`](#iaiproviderfactory) introduces; see that
  section for the swap-point rationale. Introduces one new idea of its own: `AsIChatClient` is the SDK's
  own `Microsoft.Extensions.AI` adapter, so this factory never hand-rolls the Messages API over
  `HttpClient` (`AnthropicAiProviderFactory.cs:140-144`).
- **Walkthrough**: `Name` returns the `const string ProviderName = "Anthropic"` (`AnthropicAiProviderFactory.cs:133,136`).
  `Create` (`AnthropicAiProviderFactory.cs:149`) null-checks `settings`, builds an SDK `ClientOptions`
  from `ApiKey` and `Timeout` (`AnthropicAiProviderFactory.cs:153-157`), and, when `settings.Endpoint`
  is set, overrides `BaseUrl` (`AnthropicAiProviderFactory.cs:159-162`). It then constructs
  `new AnthropicClient(options).AsIChatClient(settings.Model, settings.MaxOutputTokens)`
  (`AnthropicAiProviderFactory.cs:164`), passing the model and output ceiling as the client's defaults.
- **Why it's built this way**: a `[SuppressMessage("Reliability", "CA2000", ...)]` on `Create`
  (`AnthropicAiProviderFactory.cs:145-148`) documents why the built client is not disposed here: ownership
  passes to the `IChatClient` the pipeline wraps (see [`BoundedChatClient`](#boundedchatclient)), and the DI
  container disposes it with the singleton; disposing in the factory would close the transport before the
  first call. The model and output ceiling passed as SDK defaults are not the last word: `BoundedChatClient`
  still pins and clamps per call (`AnthropicAiProviderFactory.cs:141-143`), because a default is a
  suggestion and a bound is not. Recorded in [ADR-120](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: registered by [`AnthropicAiServiceCollectionExtensions`](#anthropicaiservicecollectionextensions).`AddAnthropicAiProvider()`; exercised by
  `MMCA.Common/Tests/Core/MMCA.Common.AI.Tests/Providers/AdapterFactoryTests.cs`.

### OpenAiProviderFactory
> MMCA.Common.AI.OpenAI · `MMCA.Common.AI.OpenAI` · `MMCA.Common/Source/Core/MMCA.Common.AI.OpenAI/OpenAiProviderFactory.cs:18` · Level 2 · class

- **What it is**: the [`IAiProviderFactory`](#iaiproviderfactory) implementation for OpenAI, selected when `Ai:Provider`
  equals `OpenAI` (`ProviderName`, `OpenAiProviderFactory.cs:20`).
- **Depends on**: [`IAiProviderFactory`](#iaiproviderfactory), [`AiSettings`](#aisettings); externally, `OpenAI`'s `OpenAIClient`,
  `OpenAIClientOptions`, `System.ClientModel.ApiKeyCredential`, and `Microsoft.Extensions.AI`'s
  `AsIChatClient` (`OpenAiProviderFactory.cs:217-219`).
- **Concept**: same factory-boundary role as [`AnthropicAiProviderFactory`](#anthropicaiproviderfactory) (see [`IAiProviderFactory`](#iaiproviderfactory) for the
  shared rationale). Differs in one behavior worth flagging on its own: the OpenAI client binds its
  model at construction time, not per call (`OpenAiProviderFactory.cs:196-199`).
- **Walkthrough**: `Name` returns the `const string ProviderName = "OpenAI"` (`OpenAiProviderFactory.cs:189,192`).
  `Create` (`OpenAiProviderFactory.cs:201`) null-checks `settings`, then requires both `Model`
  (`OpenAiProviderFactory.cs:205-206`) and `ApiKey` (`OpenAiProviderFactory.cs:207-208`) with an
  `InvalidOperationException` naming the missing `Ai:` setting when either is absent, unlike Anthropic's
  factory, which tolerates a null model. It builds `OpenAIClientOptions` from `Timeout`
  (`OpenAiProviderFactory.cs:210`), applies `Endpoint` when set (`OpenAiProviderFactory.cs:212-215`), and
  returns `new OpenAIClient(new ApiKeyCredential(apiKey), options).GetChatClient(model).AsIChatClient()`
  (`OpenAiProviderFactory.cs:217-219`).
- **Why it's built this way**: because the SDK binds the model at construction, the pinned model is the
  only one every request can go to; [`BoundedChatClient`](#boundedchatclient) refuses a request naming any other model
  (`OpenAiProviderFactory.cs:196-199`), which keeps a [`PromptContract`](#promptcontract)'s model assertion meaningful here the
  same way it is on adapters (Anthropic's) that honor a per-request override. The eager
  `InvalidOperationException` on a missing model or key fails at first `Create` call rather than deeper
  inside the SDK. Recorded in [ADR-120](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: registered by [`OpenAiServiceCollectionExtensions`](#openaiservicecollectionextensions).`AddOpenAiProvider()`; exercised by
  `MMCA.Common/Tests/Core/MMCA.Common.AI.Tests/Providers/AdapterFactoryTests.cs`.

### AnthropicAiServiceCollectionExtensions, OpenAiServiceCollectionExtensions
<a id="anthropicaiservicecollectionextensions"></a><a id="openaiservicecollectionextensions"></a>
> MMCA.Common.AI.Anthropic + MMCA.Common.AI.OpenAI · `MMCA.Common.AI.Anthropic` / `MMCA.Common.AI.OpenAI` · `MMCA.Common/Source/Core/MMCA.Common.AI.Anthropic/DependencyInjection.cs:17` · Level 3 · class (static) + class (static)

- **What it is**: the per-adapter-package DI registration extensions. Each adds its
  package's provider factory to the set [`AddMmcaChatClient`](#aiservicecollectionextensions) chooses from.

| Type | File:Line | Notes (what differs) |
|------|-----------|----------------------|
| `AnthropicAiServiceCollectionExtensions` | `MMCA.Common/Source/Core/MMCA.Common.AI.Anthropic/DependencyInjection.cs:17` | exposes `AddAnthropicAiProvider()` (`DependencyInjection.cs:250`), registers [`AnthropicAiProviderFactory`](#anthropicaiproviderfactory) |
| `OpenAiServiceCollectionExtensions` | `MMCA.Common/Source/Core/MMCA.Common.AI.OpenAI/DependencyInjection.cs:17` | exposes `AddOpenAiProvider()` (`DependencyInjection.cs:288`), registers [`OpenAiProviderFactory`](#openaiproviderfactory) |

- **Depends on**: `Microsoft.Extensions.DependencyInjection.IServiceCollection` (external) and each
  package's own factory ([`AnthropicAiProviderFactory`](#anthropicaiproviderfactory) or [`OpenAiProviderFactory`](#openaiproviderfactory)).
- **Concept**: both use the `extension(IServiceCollection services)` C# member-extension form (primer:
  [`extension(T)` types](00-primer.md#c-extensiont-types--read-this-once)) rather than a classic static
  `this IServiceCollection` method. `[Rubric §1, SOLID]` (open/closed): each adapter package ships the
  one line that opts it into provider selection, so adding a new vendor never touches
  `MMCA.Common.AI`'s own registration code.
- **Walkthrough**: identical shape in both files: null-check `services`
  (`DependencyInjection.cs:252` / `:290`), call
  `services.TryAddEnumerable(ServiceDescriptor.Singleton<`[`IAiProviderFactory`](#iaiproviderfactory)`, {Factory}>())`
  (`DependencyInjection.cs:254` / `:292`), and return `services` for chaining
  (`DependencyInjection.cs:256` / `:294`). `TryAddEnumerable` is what makes registering both packages in
  the same host additive rather than a last-one-wins replace: both factories end up in the
  `IEnumerable<`[`IAiProviderFactory`](#iaiproviderfactory)`>` [`AiProviderValidator`](#aiprovidervalidator) and `AddMmcaChatClient` enumerate.
- **Why it's built this way**: singleton lifetime matches the factories' own statelessness (both hold no
  mutable fields); `TryAddEnumerable` over plain `AddSingleton` is what lets a host reference both
  adapter packages without one factory silently dropping the other.
- **Where it's used**: `MMCA.ADC.Conference.Service/Program.cs` calls `AddAnthropicAiProvider()`. No
  call site for `AddOpenAiProvider()` is visible in `MMCA.ADC/Source` today; it is exercised only from
  `MMCA.Common.AI.OpenAI`'s own tests.


---
[⬅ Device Capability Abstraction Layer (Native Contracts, MAUI, Browser & Fallback Adapters)](group-26-device-capability-layer.md)  •  [Index](00-index.md)  •  [Testing & Quality Infrastructure ➡](group-28-testing-infrastructure.md)
