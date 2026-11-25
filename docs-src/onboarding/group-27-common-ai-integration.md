# 27. Common AI Integration

**What this chapter covers.** This group is the framework's *language-model boundary*, in both
directions: the optional `MMCA.Common.AI` package that turns a call to an LLM provider into an
ordinary, governed external dependency, and the opt-in `MMCA.Common.Mcp` package that lets a model
client call a module's queries as tools. Four questions shape every type on the chat side. *What is this call allowed to do?* (a pinned
model, a clamped output ceiling, a wall-clock budget, a policy-gated tool list, an optional input
ceiling). *What may it say, and what may it answer?* (redactors that rewrite a request before
anything reads it, and guardrails that can refuse the request, the response or a single streamed
fragment). *What did it cost, how long did it take, and which prompt spent it?* (two token counters
plus a latency histogram on one framework-wide meter, all tagged by prompt name, version and
provider, with the same prompt identity stamped on the trace). *Which exact prompt produced this
answer?* (a versioned contract whose SHA-256 hash is what an evaluation gate records against). The
46 types answering those questions ship in five packages. The core `MMCA.Common.AI` holds the
settings, the composition entry point, four delegating clients (bounds, guardrails, metering, prompt
tagging), the guardrail, redactor and tool-policy contracts, the prompt-injection marker interface,
the two content policies the framework does ship (and the internal helper they share), the
provider-factory contract and its startup validator, a meter and the prompt contract. Two adapter
packages, `MMCA.Common.AI.Anthropic` and `MMCA.Common.AI.OpenAI`, each add one provider factory and
one registration method. `MMCA.Common.AI.Testing` is the offline evaluation harness a consumer's test
project subclasses. `MMCA.Common.Mcp` carries the other direction: its 12 types register a Model
Context Protocol endpoint, govern each tool call on it and inspect what a model will read before the
endpoint starts. The decision record for the chat side is
[ADR-120](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html), which extends
the feature-level record
[ADR-111](https://ivanball.github.io/docs/adr/111-ai-session-scoring-governance.html); the endpoint
is [ADR-138](https://ivanball.github.io/docs/adr/138-mcp-endpoint-over-module-queries.html).

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
[GuardrailChatClient](#guardrailchatclient). The MCP endpoint answers the same section from the
other side, where the model is the caller: [McpToolGovernance](#mcptoolgovernance) decides which
tools a caller may see and call, and [ToolDescriptionInspector](#tooldescriptioninspector) refuses
to serve a description that hides text. `[Rubric section 2, Design Patterns]` also applies
throughout, because the mechanism is the decorator: every layer is a `DelegatingChatClient` wrapping
the next, and the provider is a strategy selected by name.

## The configuration surface is the contract

[AiSettings](#aisettings) (`MMCA.Common/Source/Core/MMCA.Common.AI/AiSettings.cs:23`) binds from the
`Ai` section (`AiSettings.cs:26`) and holds every knob the package has: `Enabled` (`:47`), `Provider`
(`:56`), `Model` (`:66`), `ApiKey` (`:78`), the optional `Endpoint` (`:85`), `MaxOutputTokens`
(`:92`, defaulting to 1024 at `:29` and range-checked 1 to 1,000,000 at `:91`), `Timeout` (`:98`,
defaulting to 30 seconds at `:32`), `AllowTools` (`:105`), `RequireGuardrail` (`:122`, defaulting to
true), `EnableCache` (`:128`) and the optional `PerCallInputTokenBudget` (`:136`, range 1 to
`int.MaxValue` at `:135`). Every one of those is a bound rather than a suggestion: the settings doc
comment says so outright (`AiSettings.cs:8-15`), and the runtime enforcement lives one layer out in
[BoundedChatClient](#boundedchatclient), so a caller cannot opt out by passing different
`ChatOptions`. Nothing in the section names a vendor: `Provider` is a plain string matched against the
names of whatever provider factories the host registered (`AiSettings.cs:16-21`, `:49-55`), and
`Endpoint` is what routes any adapter through an AI gateway, a regional endpoint or an
OpenAI-compatible server (`:80-84`).

Validation is conditional, which is what lets the `Ai` section ship in every appsettings file.
`AiSettings` implements `IValidatableObject` (`AiSettings.cs:23`) and its `Validate` yields nothing
at all when `Enabled` is false (`:158-161`); once the dependency is switched on it requires
`Provider` (`:163-169`), `Model` (`:171-176`) and `ApiKey` (`:178-184`), checks `Endpoint`
(`:186-189`) and rejects a non-positive `Timeout` (`:191-196`) as well as one above `MaxTimeout`
(`:198-203`). That ceiling is one hour (`:39`) for a reason recorded beside it: a bare number in
configuration binds as days, and a value above roughly 49.7 days makes every call throw where the
timeout is armed (`:34-38`). The endpoint rules live in `ValidateEndpoint` (`:212-232`): a relative
URI is rejected (`:214-219`), and so is any scheme other than https outside Development, because
every call carries `ApiKey` in its request headers (`:221-229`, rationale at `:206-208`). Whether the
host is Development comes from the validation context's `IHostEnvironment` when it carries one and
otherwise from the internal `IsDevelopmentHost` flag (`:239-242`, property at `:143`), and an
environment it cannot see reads as not Development. The registration stamps that flag in a
`PostConfigure` from the registered environment and chains `ValidateDataAnnotations().ValidateOnStart()`
(`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:124-129`), so a misconfigured host
fails at startup rather than on the first user request: the same fail-fast configuration contract the
rest of the framework follows
([ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)).
`[Rubric section 11, Security]` is in play at `ApiKey`: the property is documented as binding from Key
Vault in production (through `AddAzureKeyVaultConfiguration` in `MMCA.Common.Azure.Startup`) and from
user secrets or an environment variable locally (`AiSettings.cs:68-77`), so the package itself never
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
[AnthropicAiServiceCollectionExtensions](#anthropicaiservicecollectionextensions-openaiservicecollectionextensions)
(`MMCA.Common/Source/Core/MMCA.Common.AI.Anthropic/DependencyInjection.cs:17`) exposes
`AddAnthropicAiProvider()` (`:26`) and
[OpenAiServiceCollectionExtensions](#anthropicaiservicecollectionextensions-openaiservicecollectionextensions)
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
(`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:78`) is the only composition surface.
It exposes two `AddMmcaChatClient` overloads inside an `extension(IServiceCollection services)` block
(`DependencyInjection.cs:80`), the framework's standard public DI shape
([ADR-106](https://ivanball.github.io/docs/adr/106-extension-members-as-public-di-surface.html)): the
configuration form (`:89`) registers [AiProviderValidator](#aiprovidervalidator) (`:95`) and then
delegates to the factory form (`:114`) with `CreateProviderChatClient` as the innermost client
(`:97`). That method resolves every registered [IAiProviderFactory](#iaiproviderfactory), picks the
one whose name matches `Ai:Provider` through the validator's own `Match` and calls its `Create`
(`:282-291`); its throw, worded by the validator's `DescribeMismatch` (`:287-288`), is only a belt for
a host that bypassed the options pipeline (`:278-281`). The provider path is therefore nothing more
than the general path with its innermost client supplied. On the factory form `Ai:Provider` is still
required, but it is only the metrics fallback and is matched against nothing (`:111-112`).

The registration reads top to bottom as a policy. Bind, stamp the environment and validate
(`:122-129`). Then, if the section is disabled, **return having registered no client at all**
(`:131-135`). That absence is the API: a consumer gates on `GetService<IChatClient>()` returning null
rather than on reading a flag (`DependencyInjection.cs:66-72`), so a feature whose key is missing in a
given environment is off by construction. When enabled, the registration first scans the descriptors
for an `IChatGuardrail`, an `IChatRequestRedactor` and a prompt-injection defense (`:142-144`) and
hands the last answer to `RefuseAnUngovernedHost` (`:146`, body at `:210-238`), which makes two
refusals at registration time rather than on the tenth user's request. With `RequireGuardrail` true
(its default) and no prompt-injection defense registered it throws, naming
`AddContentPolicyGuardrail(configuration)` as the one-line fix, stating that
`AddPiiRedactionGuardrail()` alone does not satisfy it, and naming the `RequireGuardrail` switch as
the reviewable opt-out (`:215-228`); with `AllowTools` true and no `IChatToolPolicy` registered it
throws too, because every tool would otherwise be silently stripped (`:230-237`). Then the meter is
registered (`AddMetrics` plus `TryAddSingleton<AiUsageMeter>()`, `:148-149`) and the client is built
with `AddChatClient` followed by `Use` calls, first-registered being outermost because
`ChatClientBuilder` applies its factories in reverse (`:151-188`). The resulting order, outermost
first, is [BoundedChatClient](#boundedchatclient), then the optional
[GuardrailChatClient](#guardrailchatclient), then
[UsageRecordingChatClient](#usagerecordingchatclient), then optional distributed caching, then
OpenTelemetry, then [PromptTaggingChatClient](#prompttaggingchatclient), then logging, then the
provider client (`DependencyInjection.cs:22-31`). The ordering is deliberate: bounds sit outside
everything, so a rejected call is rejected before anything logs or caches it; guardrails sit inside
the bounds and outside metering, because a blocked request never reaches the provider and so has no
cost to record; a cache hit still records "what this call would have cost"; and prompt tagging sits
just inside the OpenTelemetry layer so the activity it decorates is that layer's own span
(`:33-40`).

What counts as a prompt-injection defense is decided by a type, not by the mere presence of a
guardrail. [IPromptInjectionGuardrail](#ipromptinjectionguardrail)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/IPromptInjectionGuardrail.cs:21`) is a marker
interface with no members: the type carrying it is still registered as an `IChatGuardrail` or an
`IChatRequestRedactor`, and the requirement is about the threat rather than about having something in
the layer, since a PII redactor lets "ignore previous instructions" straight through
(`IPromptInjectionGuardrail.cs:7-13`). `IsPromptInjectionGuardrail` (`DependencyInjection.cs:253-267`)
reads it off the descriptor without resolving anything: an unkeyed registration of either contract
whose implementation type, taken from the descriptor's type, its instance or the return type of a
typed factory (`:262-264`, `:269-270`), is assignable to the marker. A factory typed only as the
contract cannot be recognized and does not count (`:247-252`), which is why an application writing its
own defense registers it with a concrete implementation type, an instance or a typed factory
(`IPromptInjectionGuardrail.cs:15-20`). [ContentPolicyGuardrail](#contentpolicyguardrail) is the
implementation the framework ships.

The guardrail layer is the one conditional wrapper, and how it is decided matters. The registration
adds it only when the collection already carries an `IChatGuardrail` or an `IChatRequestRedactor`
descriptor (`:160-166`), and the check is a descriptor scan rather than a resolve, because building
the layer unconditionally would change the concrete type the container hands back for every
application that adopts neither (`:137-141`, restated in the type's own remarks at `:43-50`). An app
that registers none, and has deliberately set `RequireGuardrail` false, therefore keeps exactly the
chain it had.

Two details in that block are worth reading closely. Caching needs *both* halves, the `EnableCache`
switch and an actually-registered `IDistributedCache`, because a cache the host never registered would
turn every call into a resolve-time throw (`:174-179`). And `EnableSensitiveData` on the OpenTelemetry
layer is driven by `IsDevelopmentHost` (`:181-186`, implementation at `:305-309`), which fails closed:
an environment it cannot positively identify as Development reads as not-Development, so prompt and
completion text never reach telemetry by accident (`:299-304`). That is the same dev-only-relaxation
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
registered every tool is stripped (`BoundedChatClient.cs:251-254`), and `ToolAuthorization.Denied` is
the enum's zero value so an unassigned answer refuses (`ToolAuthorization.cs:7-8`): the layer fails
closed, and a missing policy costs a capability rather than granting one. On top of the policies, a
tool marked consequential must also be confirmed by the caller for this request (`:259-262`), and the
confirmation never overrides a policy that denied it (`:256-258`). Both markers are plain string keys
on the property bags Microsoft.Extensions.AI already carries, published by the static
[ChatToolPolicy](#chattoolpolicy)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ChatToolPolicy.cs:24`): `mmca.tool.consequential`
on the tool (`:30`) and `mmca.tool.confirmed` on the options (`:43`), so any tool factory and any
caller can participate without referencing this package (`:11-14`). The distinction they encode is
reading versus writing: a lookup can be offered on a policy decided once, while a tool that sends,
moves money or deletes is a decision a human makes per request (`:18-22`). The marker reader fails
closed too: only a definite false (a `bool`, a parseable string or a JSON `false`) reads as harmless,
and a marker in any shape it does not recognise reads as consequential (`IsConsequential`,
`:51-70`). The confirmation reader accepts a single string, a string sequence, the `JsonElement`
string or array that options bound from JSON carry, and a non-generic sequence such as a JSON array
bound as `object[]` (`ReadConfirmedTools`, `:78-111`, the last arm at `:102-108`), so a tool
confirmed over the wire is not silently stripped as unconfirmed (`:91-93`).
`[Rubric section 11, Security]` and `[Rubric section 16]`.

The input-size bound is the one with a caveat baked into its own doc comment.
`EnforceInputBudget` (`BoundedChatClient.cs:287-302`) runs only when `PerCallInputTokenBudget` is set,
estimates the request, and throws an `InvalidOperationException` naming the setting when the estimate
exceeds it (`:290-291`), which fails the call locally instead of paying for it remotely. The estimate
comes from the public static `EstimateInputTokens` (`:155-179`), which concatenates the options'
instructions and every message's text and then either defers to an
[IAiTokenEstimator](#iaitokenestimator) or falls back to one token per four characters (`:178`).
[IAiTokenEstimator](#iaitokenestimator)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/IAiTokenEstimator.cs:14`) is optional and is resolved
*through the client pipeline* rather than from DI, via `this.GetService<IAiTokenEstimator>()`
(`BoundedChatClient.cs:294`), so any inner client that knows its provider's tokenizer can offer one.
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
(`MMCA.Common/Source/Core/MMCA.Common.AI/Chat/IChatGuardrail.cs:21`) is the extension point an
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
(`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/PiiRedactionGuardrail.cs:42`) is one stated
exception to "extension points and no policy": an email address or a phone number is never evidence
for anything a model is asked, so sending one is pure exposure and the judgement does not vary between
applications or jurisdictions (`:13-17`). It implements both contracts. As a redactor it rewrites the
text every message carries, replacing matches of a source-generated email pattern and a deliberately
narrow North American phone pattern (each with a one-second match timeout, `:73-84`) with
`[redacted-email]` and `[redacted-phone]` (`:44-45`). That text is message text, reasoning text, a
tool result and a tool call's arguments, whether they arrive as CLR strings or as `JsonElement`
values (`RedactContent`, `:125-159`, rationale at `:105-109`), because a tool's output is exactly
where contact details turn up. JSON is rebuilt value by value so property names and numbers are
copied verbatim and a ten-digit timestamp never becomes a phone placeholder (`:197-246`). An item with
nothing to redact passes through by reference; a rebuilt one keeps its metadata through
[ContentMetadata](#contentmetadata) but deliberately drops `RawRepresentation`, which still holds the
unredacted text and which the OpenAI adapters would send verbatim (`:110-118`). A reasoning block
carrying `ProtectedData` is never rebuilt, because an edited signed block is rejected when the
conversation is sent back (`:119-123`, `:127`), and images and provider-specific content pass
through untouched (`:154-158`). As a guardrail it allows everything (`:61-72`), so it never pretends
to be a content policy it is not, and for the same reason it is **not** an
[IPromptInjectionGuardrail](#ipromptinjectionguardrail): registering it alone does not satisfy
`RequireGuardrail` (`:19-25`). Names are not redacted and `ChatOptions.Instructions` is left alone,
because a speaker's name is the published record and the instructions are the application's own text
(`:31-32`, `:37-39`).

[ContentMetadata](#contentmetadata)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ContentMetadata.cs:9`) is the one internal helper
both shipped policies share so the two cannot drift (`:5-8`). Its single method, `WithMetadataOf`
(`:22`), copies `AdditionalProperties` and `Annotations` from the item being replaced onto its rebuilt
copy (`:25-26`) and pointedly does not copy `RawRepresentation` (`:13-16`): carrying the provider's
original object across would let the adapter undo the redaction it was just given.

[ContentPolicyGuardrail](#contentpolicyguardrail)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ContentPolicyGuardrail.cs:65`) is the configurable
one, and it implements three contracts: `IChatGuardrail`, `IChatRequestRedactor` and
[IPromptInjectionGuardrail](#ipromptinjectionguardrail), which makes it the prompt-injection defense
whose registration satisfies `RequireGuardrail` (`:19-23`). On the request side it looks for
prompt-injection markers in **user-role** content only, since system and assistant messages are the
application's own text and the model's own turns (`:34-39`). The eight built-in markers (`:78-88`) are
each anchored on an imperative verb aimed at the model rather than a noun a person might use, which
makes the list a floor rather than a detector (`:54-63`). They are compiled case-insensitively and
culture-invariantly with explicit capture, while a configured pattern gets the same options without
explicit capture, so its backreferences keep their meaning, and the same one-second match timeout
(`:68`, `:71`, `:73-76`). What happens on a match is the
[ContentPolicyInjectionMode](#contentpolicyinjectionmode)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ContentPolicyInjectionMode.cs:16`): `Redact`, the
default (`:23`), `Block` (`:29`) or `Off` (`:35`). The two active modes are one behavior split across
the pipeline's fixed order (`ContentPolicyGuardrail.cs:26-33`): `Redact` rewrites the marker away
before any guardrail runs, so the request inspection allows; `Block` makes the redactor a pass-through
(`:123-128`) so the inspection sees what the caller actually supplied and refuses naming the marker's
label (`:154-164`). A rewritten user message is a new instance, a content item with no marker is the
same instance it came in as, and a rebuilt text item keeps its metadata through
[ContentMetadata](#contentmetadata) exactly as the PII policy does (`:111-118`, `:337-342`). The
placeholder goes in through a match evaluator rather than a replacement string, because as a
replacement pattern `$&` or `$0` would put the matched marker straight back (`:364-370`). On the
response side a configured pattern blocks the buffered answer (`:168-176`) and each streamed fragment
(`:185-193`), with the reason naming the pattern's index and never the text it matched (`:282-287`);
a pattern spanning two updates is missed on the streaming path, so a host that needs whole-answer
certainty uses the buffered one (`:179-184`).
[ContentPolicySettings](#contentpolicysettings)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ContentPolicySettings.cs:33`) binds from its own
`Ai:ContentPolicy` section (`:36`) so a host that never adopts the policy has nothing to configure
(`:11-13`): `InjectionMode` (`:45`), `AdditionalRequestPatterns` (`:55`), `BlockedResponsePatterns`
(`:75`) and the required `RedactionPlaceholder` (`:87-88`, defaulting to `[redacted-instruction]` at
`:39`, inserted as literal text per `:78-80`). The built-in markers stay code, not configuration
(`:17-21`), and `BlockedResponsePatterns` ships empty by design: what an answer must never say is a
fact about the application, so the framework ships the mechanism and each host supplies its own
patterns or its own response guardrail (`:22-31`, `:66-73`). The settings validate themselves: a
blank pattern or one that does not compile with the guardrail's own options and timeout is reported by
section, list and index (`Validate`, `:101-112`; `:121-151`).

[GuardrailServiceCollectionExtensions](#guardrailservicecollectionextensions)
(`MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/GuardrailServiceCollectionExtensions.cs:17`)
registers both: `AddPiiRedactionGuardrail()` (`:34`), whose doc comment states that it alone does not
satisfy `RequireGuardrail` (`:22-25`), and `AddContentPolicyGuardrail(configuration)` (`:64`), which
does (`:52-53`) and also binds `ContentPolicySettings` with
`ValidateDataAnnotations().ValidateOnStart()` (`:69-72`) so a pattern that does not compile fails the
deployment rather than a user's request (`:58-59`). Each registers one singleton resolved under both
`IChatGuardrail` and `IChatRequestRedactor` rather than two instances, because the redactor and the
guardrail are two faces of one decision (`:38-42`, `:74-78`, rationale at `:29-31`). Those are typed
factory registrations, so the descriptor's factory return type is the concrete guardrail and the
registration-time marker check can see it. Each must run before `AddMmcaChatClient`, which reads the
descriptors (`:31-32`, `:60-62`).

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
registration hands it that configured fallback (`DependencyInjection.cs:168-172`).

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
uses as its activity source (`DependencyInjection.cs:185`), so one name enables both traces and
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
(`DependencyInjection.cs:187`), so when that layer has a listener the current activity is its own
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

## The other direction: a model client calling the application

Everything above governs the application calling a model. `MMCA.Common.Mcp` governs a model client
calling the application, through a Model Context Protocol endpoint over the module's existing
queries (ADR-138). Unlike the AI packages it does reference the framework, because the governance it
applies is the framework's own: it reads the rate-limit policy from `MMCA.Common.API.Startup` and the
permission policy from `MMCA.Common.API.Authorization`
(`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHostingExtensions.cs:9`,
`McpToolGovernance.cs:7`).

[McpHostingExtensions](#mcphostingextensions) (`McpHostingExtensions.cs:38`) is the whole consumer
surface: two calls, both inert unless `Mcp:Enabled` is true (`:15-19`). `AddCommonMcpServer` (`:52`),
on an `extension(IHostApplicationBuilder)` block, always binds [McpSettings](#mcpsettings) and
validates on start that every configured per-tool limit is at least 1 (`:57-63`), then returns having
registered nothing else when the endpoint is off (`:65-68`). Switched on, it runs the caller's
[CommonMcpOptions](#commonmcpoptions) callback (`:70-71`), registers the HTTP context accessor, the
[McpToolRateLimiter](#mcptoolratelimiter) and the [McpEnabledMarker](#mcpenabledmarker) singletons
(`:73-75`), and adds the SDK's MCP server with a stateless HTTP transport (`:77-78`), the list and
call filters from [McpToolGovernance](#mcptoolgovernance) (`:79-83`), the selected tool types through
the `IEnumerable<Type>` overload named explicitly so the list is not bound as a tool target
(`:85-87`), and every selected assembly (`:89-92`). The tool shape it expects is a static
`[McpServerToolType]` class in the module's API project whose read-only methods inject the same query
handler the HTTP endpoint injects, so the decorator pipeline (authorization, caching, validation)
applies to a tool call exactly as to a request (`:22-25`). `MapCommonMcp` (`:114`) maps the endpoint at
`/mcp` by default (`:41`). It first asks for the marker: absent, it throws when configuration says the
endpoint is enabled (a host that forgot `AddCommonMcpServer`, `:119-125`) and otherwise maps nothing,
so the path answers 404 (`:127`). Present, it runs both startup inspections (`:130-132`) and maps the
endpoint anonymous at the HTTP layer with the `mcp` rate-limit policy (`:134-136`), because a public
tool needs no token and a permissioned tool checks its caller itself (`:28-31`).
[McpEnabledMarker](#mcpenabledmarker) (`McpHostingExtensions.cs:143`) is the private, member-less
class that lets the second call tell whether the first one registered anything.

[CommonMcpOptions](#commonmcpoptions) (`CommonMcpOptions.cs:9`) selects what is exposed: the
assemblies scanned for `[McpServerToolType]` classes (`ToolAssemblies`, `:12`) and individual tool
classes for a host that does not want a whole assembly scanned (`ToolTypes`, `:15`).
[McpSettings](#mcpsettings) (`McpSettings.cs:19`) binds from the `Mcp` section (`:22`); `Enabled`
(`:25`) is off by default, and `Tools` (`:31`) holds per-tool settings keyed case-insensitively by tool
name, where a tool with no entry is enabled and limited only by the endpoint-wide policy (`:27-29`).
Each entry is a [McpToolSettings](#mcptoolsettings) (`McpToolSettings.cs:4`): `Enabled` defaulting to
true (`:10`) and an optional `PermitsPerMinute` (`:17`), counted per caller (user id, else client IP)
and in memory per instance (`:12-16`).

Access is declared on each tool method, and declaring it is mandatory.
[McpToolPermissionAttribute](#mcptoolpermissionattribute) (`McpToolPermissionAttribute.cs:12`) carries
the `Permission` (`:15`) a caller must hold, checked through the same `perm:` authorization policy
`[HasPermission]` uses (`:3-9`). [McpToolPublicAttribute](#mcptoolpublicattribute)
(`McpToolPublicAttribute.cs:12`) records that a tool needing no token was made public on purpose, so
it must expose only data an anonymous HTTP endpoint already serves (`:3-10`). A tool carrying neither
stops the endpoint from starting: `ThrowIfAccessUndeclared` (`McpToolGovernance.cs:95-111`) names every
undeclared tool in one message.

[McpToolGovernance](#mcptoolgovernance) (`McpToolGovernance.cs:20`) is the internal static class
behind the two SDK request filters (`:14-19`). The `tools/list` filter (`ListTools`, `:25`) keeps only
the tools that are enabled and that the caller is permitted to call (`:34-42`) and marks the result
`CacheScope.Private`, because the list now depends on who asked (`:46-47`). The `tools/call` filter
(`CallTool`, `:54`) refuses a disabled tool (`:63-66`), a tool whose permission the caller lacks
(`:68-74`) and a call over the tool's per-minute limit (`:76-83`), each as an error result carrying a
code (`Mcp.ToolUnavailable`, `Mcp.Forbidden`, `Mcp.RateLimited`) built by `Refused` (`:154-158`),
so the model reads the refusal and stops instead of retrying blindly (`:152-153`). The permission check
(`IsPermittedAsync`, `:130-145`) admits any caller to a tool with no permission, refuses an
unauthenticated caller otherwise, and then asks `IAuthorizationService` for
`PermissionPolicy.NameFor(permission)` (`:142-143`), so a role grant or a direct permission claim
admits the caller exactly as it would on the module's HTTP endpoint (`:128-129`). The rate-limit caller
key is the user id, else the remote IP, else `anonymous` (`:147-150`).
[McpToolRateLimiter](#mcptoolratelimiter) (`McpToolRateLimiter.cs:11`) is the internal per-tool limit
underneath the endpoint-wide `mcp` policy (`:6-10`): a `PartitionedRateLimiter` of one-minute fixed
windows with no queue (`:16-25`), partitioned by tool, permit count and caller so idle partitions are
dropped and a configuration reload that changes a limit starts a fresh window (`:13-15`). `TryAcquire`
(`:32-36`) takes one permit, and [ToolCall](#toolcall) (`:41`) is the private
`readonly record struct` of tool, caller and permit count the limiter partitions on.
`[Rubric section 11, Security]` and `[Rubric section 16]`.

The last two types answer a threat specific to this direction: text a model reads but a reviewer does
not see (R023). [McpHiddenText](#mcphiddentext) (`McpHiddenText.cs:14`) is the public check. `Find`
(`:21-52`) reports every tag character (U+E0000 to U+E007F, `:83`), every Unicode format character
(category Cf, zero-width characters and bidi controls, `:36-39`) and every HTML comment opener
(`:44-49`), each with its UTF-16 position. `Strip` (`:63-78`) removes the tag and format characters
and leaves a comment opener in place, since in a result it is visible text; dropping the zero-width
joiner splits a joined emoji into its parts, the stated price of never forwarding a character a
reviewer cannot see (`:54-60`). A tool returning third-party text runs `Strip` over it (`:9-12`), as
ADC's Conference tools do
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Mcp/ConferenceMcpResults.cs:33`).
[ToolDescriptionInspector](#tooldescriptioninspector) (`ToolDescriptionInspector.cs:11`) runs `Find`
at startup: `ThrowIfHiddenText` (`:25-59`) inspects the server instructions, title and description
(`:31-36`) and every tool's name, title, annotation title, description and input and output schema
(`:38-50`), walking every property name and string value of a schema because a parameter's
`[Description]` lands there (`:70-93`), so a poisoned description fails startup instead of reaching a
client (`:6-10`).

## Where it runs today, and how it is tested

Exactly one feature in the workspace calls a model: ADC's organizer-facing session scoring. The
Conference service host reads one secret, `Ai:ApiKey`, and derives `Ai:Enabled` from its presence
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:107-112`); the infrastructure
template writes the Key Vault secret into the container app under that same key and local
development keeps it in user secrets (`Program.cs:99-106`), so a host with no key starts with
scoring unavailable rather than failing validation. It then registers the Anthropic adapter with
`AddAnthropicAiProvider()` (`Program.cs:241`), its guardrails with `AddConferenceAiGuardrails`
(`Program.cs:253`) and the governed client with `AddMmcaChatClient(configuration)`
(`Program.cs:255`), in that order because the last call reads the guardrail descriptors, and
subscribes the framework meter and activity source by literal name (`Program.cs:274-275`).
`AddConferenceAiGuardrails`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:90`)
composes both framework policies, `AddPiiRedactionGuardrail()` and `AddContentPolicyGuardrail`
(`:100-101`), with the module's own response guardrail (`:104`); the content policy is the
registration that satisfies `RequireGuardrail`, and in the deployed workspace the guardrail layer is
present on every call. On the module side,
[SessionScoringService](group-19-conference-infrastructure.md#sessionscoringservice)
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/SessionScoringService.cs:47`)
consumes the injected `IChatClient` and `PromptContract`, and Conference's Infrastructure registration
resolves the client with `GetService` rather than `GetRequiredService` precisely because the disabled
host registers none
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:46-54`).
`[Rubric section 3, Clean Architecture]`: an ADC architecture fitness test asserts that Infrastructure
is the only layer naming a language-model SDK type or the package
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Layering/AiDependencyIsolationTests.cs:14`).
The same host also adopts the MCP endpoint: `AddCommonMcpServer` exposes the read-only public schedule
tools of `ConferenceMcpTools` (`Program.cs:368`,
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Mcp/ConferenceMcpTools.cs:22`) and
`MapCommonMcp` maps `/mcp` (`Program.cs:379`).

`[Rubric section 14, Testability]` is served first by the factory overload. Because the innermost
client is just a `Func<IServiceProvider, IChatClient>` (`DependencyInjection.cs:114-116`), the whole
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
[GoldenReplayCase](#goldenreplaycase) (`GoldenReplayCase.cs:19`) is an id, a one-line description, a
response path resolved relative to the test assembly, and the `PromptContractHash` the response was
recorded against (`:7-18`). [GoldenReplayTestsBase](#goldenreplaytestsbase)
(`GoldenReplayTestsBase.cs:31`) replays every case through the real code under test on a fresh client,
collects every failure rather than stopping at the first, and fails an empty corpus because an
evaluation that evaluates nothing passes forever (`:11-22`). A subclass also supplies the
`CurrentContract` it ships (`:40`), and `EveryGoldenCase_WasRecordedAgainstTheCurrentContract`
(`:56`) fails, naming the cases, whenever a recorded hash differs from it, because replaying an answer
recorded under another prompt, model or system text still passes while proving nothing (`:23-29`).
[PromptContractPinTestsBase](#promptcontractpintestsbase)
(`PromptContractPinTestsBase.cs:25`) is the prompt-change protocol as a gate: a JSON pin file maps
`<Name>@<Version>` to the contract hash (`:20-22`), and a contract with no pin or a pin that no longer
matches fails (`:12-18`). ADC subclasses both, in
`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Scoring.Evaluation.Tests/GoldenReplayTests.cs:35`
and `PromptContractTests.cs:180`.

Read the per-type sections next in level order: the Level 0 contracts and values
([AiSettings](#aisettings), [PromptContract](#promptcontract), [GuardrailVerdict](#guardrailverdict),
[IAiTokenEstimator](#iaitokenestimator), [IChatRequestRedactor](#ichatrequestredactor),
[IPromptInjectionGuardrail](#ipromptinjectionguardrail), [ToolAuthorization](#toolauthorization),
[ChatToolPolicy](#chattoolpolicy), [ContentMetadata](#contentmetadata),
[ContentPolicyInjectionMode](#contentpolicyinjectionmode), [AiUsageMeter](#aiusagemeter), the three
replay types, and the MCP options, settings, attributes, [McpHiddenText](#mcphiddentext),
[McpEnabledMarker](#mcpenabledmarker) and [ToolCall](#toolcall)) first, then the Level 1 types
([IChatGuardrail](#ichatguardrail), [IChatToolPolicy](#ichattoolpolicy),
[IAiProviderFactory](#iaiproviderfactory), [ChatGuardrailException](#chatguardrailexception),
[UsageRecordingChatClient](#usagerecordingchatclient),
[PromptTaggingChatClient](#prompttaggingchatclient), the two test bases, [McpSettings](#mcpsettings),
[McpToolRateLimiter](#mcptoolratelimiter) and [ToolDescriptionInspector](#tooldescriptioninspector)),
then the Level 2 clients, policies, validator, provider factories and
[McpToolGovernance](#mcptoolgovernance), then the Level 3 registrations and
[PiiRedactionGuardrail](#piiredactionguardrail) with the
[AiServiceCollectionExtensions](#aiservicecollectionextensions) entry point that assembles them, then
[GuardrailServiceCollectionExtensions](#guardrailservicecollectionextensions) at Level 4, and finally
[McpHostingExtensions](#mcphostingextensions) at Level 6.

### AiSettings
> MMCA.Common.AI · `MMCA.Common.AI` · `MMCA.Common/Source/Core/MMCA.Common.AI/AiSettings.cs:23` · Level 0 · class

- **What it is**: the bound, validated `Ai` configuration section (`SectionName = "Ai"`,
  `AiSettings.cs:26`) that gates and configures the entire AI integration: whether it is on at all
  (`Enabled`, `AiSettings.cs:47`), which provider and model to call
  (`Provider`/`Model`, `AiSettings.cs:56,66`), the API key, an optional endpoint override, the
  output-token ceiling, the per-call timeout (capped by `MaxTimeout`), and opt-ins (`AllowTools`,
  `RequireGuardrail`, `EnableCache`) plus an optional input-token pre-flight budget.
- **Depends on**: `System.ComponentModel.DataAnnotations` (`IValidatableObject`, `[Range]`) and
  `Microsoft.Extensions.Hosting.IHostEnvironment` (read during validation to decide whether a non-https
  `Endpoint` is allowed); no first-party dependency of its own, though its doc comments name
  `AddAzureKeyVaultConfiguration` in `MMCA.Common.Azure.Startup` as the sibling convention elsewhere in
  Common that supplies `ApiKey` in production (`AiSettings.cs:68-78`).
- **Concept introduced, an off-by-default dependency with conditional validation.**
  `[Rubric §16, AI-Native Application Architecture]` (assesses whether an LLM dependency is safe to ship
  in every environment): `Enabled` defaults to `false`, and when it is false `AddMmcaChatClient`
  registers no `IChatClient` at all, so resolving one yields `null` and a consumer gates on the service
  being present rather than reading a flag itself (`AiSettings.cs:41-47`). `Provider` is a string, not a
  closed enum: it is matched case-insensitively against the registered
  [`IAiProviderFactory`](#iaiproviderfactory)`.Name` of whatever provider packages the host
  referenced (`MMCA.Common.AI.Anthropic` and `MMCA.Common.AI.OpenAI` each ship one), so the provider
  switch lives in the host's package references and its configuration value, not in this framework's
  source (`AiSettings.cs:16-20`, `AiSettings.cs:49-56`). `[Rubric §11, Security]` (assesses secret
  handling): `ApiKey` is required only when `Enabled`, and its doc comment records that production binds
  it from Key Vault via `AddAzureKeyVaultConfiguration` (in `MMCA.Common.Azure.Startup`), never from a
  checked-in settings file (`AiSettings.cs:68-78`). Because every call carries that key in its request
  headers, a non-https `Endpoint` is refused outside Development (`AiSettings.cs:221-229`).
- **Walkthrough**: two defaults, `DefaultMaxOutputTokens = 1024` (`AiSettings.cs:29`) and
  `DefaultTimeout = TimeSpan.FromSeconds(30)` (`AiSettings.cs:32`), back the two settings that ship with
  a value even when the section is silent; a third static, `MaxTimeout = TimeSpan.FromHours(1)`
  (`AiSettings.cs:34-39`), is the largest per-call timeout validation accepts. `Provider`
  (`AiSettings.cs:56`) is required when `Enabled` and names a registered provider by string, e.g.
  `Anthropic` or `OpenAI`; an unknown name fails at startup naming the registered ones. `Model`
  (`AiSettings.cs:58-66`) is required when `Enabled` because it is part of the prompt contract, hashed
  into `PromptContract.Hash`, so an implicit provider default would silently change evaluated behavior on
  the provider's own schedule rather than on a reviewed version bump, and it is also a bound:
  [`BoundedChatClient`](#boundedchatclient) refuses a request that names a different model.
  `Endpoint` (`AiSettings.cs:80-85`) is an optional absolute URI to route through an AI gateway, a
  regional endpoint or an OpenAI-compatible server; each adapter passes it to its SDK's base-address
  option, and outside Development it must be https. `MaxOutputTokens` (`[Range(1, 1_000_000)]`, `AiSettings.cs:91-92`) is the hard ceiling
  `BoundedChatClient.Bound` clamps every call down to. `Timeout` (`AiSettings.cs:94-98`) is enforced with
  a token linked to the caller's own, so a caller cancelling early still wins. `AllowTools`
  (`AiSettings.cs:100-105`) is `false` by default, and while it is false any tools on a request are
  stripped before the call. `RequireGuardrail` (`AiSettings.cs:107-122`) defaults to `true`: an enabled
  host that registers no prompt-injection guardrail fails at startup rather than shipping a model call
  nothing defends against injected instructions, and the message names the one-line fix
  (`AddContentPolicyGuardrail(configuration)`). Only a guardrail or redactor whose implementation type is
  marked [`IPromptInjectionGuardrail`](#ipromptinjectionguardrail) satisfies it: a
  [`PiiRedactionGuardrail`](#piiredactionguardrail) on its own strips contact details but not injected
  instructions, so it does not. A host that deliberately wants none sets it `false`, which is a
  reviewable line rather than an absence nobody can see. `EnableCache`
  (`AiSettings.cs:124-128`) is off by default and stays off when no `IDistributedCache` is registered.
  `PerCallInputTokenBudget` (`[Range(1, int.MaxValue)]`, `AiSettings.cs:135-136`) is `null` by default,
  leaving input unbounded, and is an ESTIMATE never a billing figure. The `internal`
  `IsDevelopmentHost` (`AiSettings.cs:138-143`) is not bound from configuration: `AddMmcaChatClient`
  stamps it from the registered `IHostEnvironment` before options validation runs, and it reads `false`
  (production) when no environment is registered. `Validate` (`AiSettings.cs:156-204`) is the
  conditional half: it `yield break`s immediately when `!Enabled` (`AiSettings.cs:158-161`), so a host
  that leaves AI off is valid with nothing else set, which is what lets the section ship in every
  `appsettings` file; when enabled it requires `Provider`, `Model`, `ApiKey`, an acceptable `Endpoint`
  when one is set, a positive `Timeout`, and a `Timeout` no greater than `MaxTimeout`
  (`AiSettings.cs:163-203`). The endpoint rules live in the private `ValidateEndpoint`
  (`AiSettings.cs:212-232`): the URI must be absolute, and its scheme must be https unless the host is
  Development, because every call carries `ApiKey` in its request headers. The private `IsDevelopment`
  (`AiSettings.cs:239-242`) asks the validation context for an `IHostEnvironment` first and falls back to
  the stamped `IsDevelopmentHost`, so it fails closed: an environment that cannot be seen reads as not
  Development. The `MaxTimeout` check exists because a bare number in configuration binds as DAYS, and a
  value above roughly 49.7 days makes every call throw where the timeout is armed; the one-hour cap
  rejects every bare-number value while leaving any plausible per-call budget alone, and its message
  points at the `00:00:30` form (`AiSettings.cs:198-203`).
- **Why it's built this way**: `IValidatableObject.Validate` runs through
  `.ValidateDataAnnotations().ValidateOnStart()` in `AiServiceCollectionExtensions.AddMmcaChatClient`
  (`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:124-129`), so a misconfigured `Ai`
  section, including a `Timeout` mistyped as a bare number, fails at host startup, not on the first call.
  `Provider` is a string, not an enum, so a new vendor is a new adapter package registering a factory,
  never a change to this framework's source. The https rule relaxes only in a positively identified
  Development host, so a missing environment can never loosen it. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html),
  [`ADR-070`](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html) and
  [`ADR-122`](https://ivanball.github.io/docs/adr/122-dev-only-relaxations-fail-closed.html).
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
  throws on a null or whitespace reason (`GuardrailVerdict.cs:39-44`); a caller cannot construct a blocked
  verdict that silently carries no explanation.
- **Walkthrough**: `Allow` (`GuardrailVerdict.cs:37`) is a static property returning
  `new(isAllowed: true, reason: null)`. `Block(reason)` (`GuardrailVerdict.cs:39-44`) validates the reason
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
  text will cost: `int EstimateTokenCount(string text)` (`IAiTokenEstimator.cs:19`).
- **Depends on**: nothing first-party beyond the caller that resolves it.
- **Concept introduced, a pluggable estimator behind a cheap built-in default.**
  `[Rubric §1, SOLID]` (assesses whether a dependency is inverted behind an abstraction rather than
  hard-coded): [`BoundedChatClient`](#boundedchatclient) resolves this interface from DI
  (`this.GetService<IAiTokenEstimator>()`, `MMCA.Common/Source/Core/MMCA.Common.AI/Chat/BoundedChatClient.cs:298`)
  and falls back to a built-in heuristic when nothing is registered
  (`BoundedChatClient.EstimateInputTokens`, `BoundedChatClient.cs:179`), so a host that wants
  provider-accurate tokenization can register a real tokenizer without changing the bounding logic.
- **Walkthrough**: the interface has no other members; the contract is the single method plus its two
  doc-comment lines describing the parameter and return value (`IAiTokenEstimator.cs:17-18`).
- **Why it's built this way**: `BoundedChatClient.EstimateInputTokens` is `public static` precisely so a
  caller (or the estimator implementation itself) can reproduce the same estimate the budget check uses
  (`BoundedChatClient.cs:155-179`), and it deliberately rounds up with a cheap four-characters-per-token
  heuristic when no estimator is registered, an under-count that only ever lets a call through, never
  blocks one that would have fit (`BoundedChatClient.cs:176-179`).
- **Where it's used**: [`BoundedChatClient.EnforceInputBudget`](#boundedchatclient)
  (`BoundedChatClient.cs:287-302`) is the only production call site; the test fixture
  `MMCA.Common/Tests/Core/MMCA.Common.AI.Tests/Fixtures/StubChatClient.cs` supplies a stub implementation
  for unit tests.
- **Caveats / not-in-source**: no built-in implementation ships in `MMCA.Common.AI`; every consumer today
  relies on the character-based fallback rather than registering one.

---

### PromptContract
> MMCA.Common.AI · `MMCA.Common.AI` · `MMCA.Common/Source/Core/MMCA.Common.AI/PromptContract.cs:23` · Level 0 · record

- **What it is**: an immutable, hashable identity for one prompt: `Name`, `Version`, `Model`,
  `SystemPrompt` (`PromptContract.cs:78`). It both builds the `ChatOptions` a call needs
  (`ToChatOptions`, `PromptContract.cs:53-54`) and stamps its own identity onto telemetry so every
  call can be traced back to the exact prompt that produced it.
- **Depends on**: `ChatOptions` (Microsoft.Extensions.AI), `System.Security.Cryptography.SHA256`, and
  `System.Text.Encoding`.
- **Concept introduced, prompt-as-versioned-contract.** `[Rubric §16, AI-Native Application
  Architecture]` (assesses whether prompts are governed, versioned artifacts rather than inline
  strings): the record's `Hash` property (`PromptContract.cs:101`) is a lowercase hex SHA-256 of
  `Name|Version|Model|SystemPrompt`, with every component's line endings normalized to LF first
  (`NormalizeLineEndings`, `PromptContract.cs:102-103`) so the same prompt checked out on Windows and on
  Linux hashes identically and a CI gate cannot be tripped by `core.autocrlf` (`PromptContract.cs:90-93`).
  The three identity values are stamped onto `ChatOptions.AdditionalProperties` under fixed keys
  (`NamePropertyKey`/`VersionPropertyKey`/`HashPropertyKey`, `PromptContract.cs:81-87`), so a request
  carries its own provenance through the pipeline into telemetry.
- **Walkthrough**: `Hash` (`PromptContract.cs:101`) is computed on every read, deliberately not cached in
  a field, because a record's generated copy constructor copies fields verbatim and a cached hash would
  survive a `with` expression describing the prompt the copy was made FROM (`PromptContract.cs:96-100`,
  exactly the drift the type exists to prevent). `ToChatOptions` (`PromptContract.cs:53-54`) builds a
  fresh `ChatOptions` with `ModelId` and `Instructions` set, then delegates to `Apply`. `Apply`
  (`PromptContract.cs:62-72`) stamps `Name`, `Version`, and `Hash` onto an existing `ChatOptions` in
  place and returns it for chaining, for a caller that already built options and needs its own
  temperature or response format alongside the prompt identity. `ReadName`/`ReadVersion`
  (`PromptContract.cs:77,82`) and the private `ReadProperty` (`PromptContract.cs:84-88`) reverse the
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
> MMCA.Common.AI.Chat · `MMCA.Common.AI.Chat` · `MMCA.Common/Source/Core/MMCA.Common.AI/Chat/IChatGuardrail.cs:21` · Level 1 · interface

- **What it is**: the extension point a host implements to inspect chat traffic: `InspectRequestAsync`
  before the model is called, `InspectResponseAsync` after a completed response, and
  `InspectStreamedUpdateAsync` for one streamed update, each returning a
  [`GuardrailVerdict`](#guardrailverdict) (`IChatGuardrail.cs:28-31,38-41,57-60`). The streamed member
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
- **Walkthrough**: `InspectRequestAsync` (`IChatGuardrail.cs:28-31`) takes the materialized (and, if any
  redactor ran, already-redacted) message list and the call's options, returning a verdict; a block here
  stops the call before the provider is reached. `InspectResponseAsync` (`IChatGuardrail.cs:38-41`) takes
  the completed `ChatResponse` and the same options; a block here stops the response from reaching the
  caller after the provider call already ran. `InspectStreamedUpdateAsync`
  (`IChatGuardrail.cs:57-60`) takes one `ChatResponseUpdate` fragment; a rule that needs the whole answer
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
  actually feels. The outcome starts as `CanceledOutcome` (`UsageRecordingChatClient.cs:196`) and flips to
  `SuccessOutcome` only when `MoveNextAsync` returns false (`UsageRecordingChatClient.cs:161-165`), so a
  consumer that stops enumerating early (a guardrail blocking an update, a caller breaking out of its
  loop) reaches the `finally` with neither `catch` having run and is recorded as canceled, not as a
  success; usage already delivered update by update stays recorded. The private `RecordDuration` is the shared
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
  (`DependencyInjection.cs:168-172`); ADC's `AnthropicScoringService`
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
  (`CreateLinkedTimeout`, `BoundedChatClient.cs:280-285`) guarantees the provider call cannot hang past
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
  per-token heuristic. `Bound` (`BoundedChatClient.cs:193-233`) clones
  the incoming `ChatOptions`, clamps `MaxOutputTokens` to the smaller of the request's own value and
  `_settings.MaxOutputTokens`, and when `AllowTools` is false nulls out `Tools`/`ToolMode` entirely: a
  model that cannot be handed a tool cannot be talked into using one. When `AllowTools` is true it instead
  narrows the offered tools through `FilterTools` (`BoundedChatClient.cs:241-278`), which requires every
  registered `IChatToolPolicy` to authorize a tool (no policy registered means no tool survives, since an
  unanswered capability question is answered by withholding it) and, for a tool `ChatToolPolicy` marks
  consequential, additionally requires the request to carry a matching `mmca.tool.confirmed` stamp read
  by `ChatToolPolicy.ReadConfirmedTools`. A `ToolMode` the provider cannot honor is then cleared back to
  auto by `CanHonorToolMode` (`BoundedChatClient.cs:181-191`): that covers a mode with no surviving tools
  (`RequireAny` would otherwise be an error rather than a plain answer) and a `RequireSpecific` mode
  naming a tool the filter stripped, since the provider rejects a `tool_choice` for a tool the request
  does not offer. `Bound` also
  enforces `AiSettings.Model` as a pin: a request naming a different `ModelId` throws
  `InvalidOperationException` naming the conflict, and when the request names none the pinned model is
  stamped explicitly so every adapter is asked for it by name and a failed call's model tag is never
  blank. `EnforceInputBudget` (`BoundedChatClient.cs:287-302`) is a no-op when
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
  (`DependencyInjection.cs:153-158`).

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
  (`DependencyInjection.cs:187`).

---

### AiServiceCollectionExtensions
> MMCA.Common.AI · `MMCA.Common.AI` · `MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:78` · Level 3 · class

- **What it is**: the DI entry point for the whole AI integration: two `extension(IServiceCollection)`
  members, `AddMmcaChatClient(IConfiguration)` and the factory overload
  `AddMmcaChatClient(IConfiguration, Func<IServiceProvider, IChatClient>)`, that bind
  [`AiSettings`](#aisettings), and when enabled, build the full governed pipeline.
- **Depends on**: [`AiSettings`](#aisettings), [`AiUsageMeter`](#aiusagemeter),
  [`BoundedChatClient`](#boundedchatclient), [`GuardrailChatClient`](#guardrailchatclient),
  [`PromptTaggingChatClient`](#prompttaggingchatclient), [`IChatGuardrail`](#ichatguardrail),
  `IChatRequestRedactor`, `IChatToolPolicy`, [`IPromptInjectionGuardrail`](#ipromptinjectionguardrail)
  (the marker the guardrail requirement looks for), [`UsageRecordingChatClient`](#usagerecordingchatclient),
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
  ungoverned one: an enabled host with `RequireGuardrail` true and no prompt-injection guardrail, or with
  `AllowTools` true and no `IChatToolPolicy`, throws at registration rather than at the first call.
- **Walkthrough**: `AddMmcaChatClient(IConfiguration)` (`DependencyInjection.cs:89-98`) registers
  `AiProviderValidator` as an `IValidateOptions<AiSettings>` via `TryAddEnumerable` BEFORE delegating to
  the factory overload with `CreateProviderChatClient`, so an unknown or unregistered provider name is a
  boot failure validated alongside the data annotations, not a first-call one. The factory overload
  (`DependencyInjection.cs:100-191`) is the extension point a test uses to exercise the pipeline without a
  network, and the one a host with its own credential story plugs into: it binds and validates
  `AiSettings` (`.Bind(section)`, then a `PostConfigure<IServiceProvider>` that stamps
  `AiSettings.IsDevelopmentHost` from the registered `IHostEnvironment`, then
  `.ValidateDataAnnotations().ValidateOnStart()`, `DependencyInjection.cs:124-129`), so the endpoint
  https rule in [`AiSettings`](#aisettings) knows whether it may relax. It reads the settings once with
  `section.Get<AiSettings>() ?? new AiSettings()` (`DependencyInjection.cs:131`), and returns early,
  registering nothing, when `!settings.Enabled` (`DependencyInjection.cs:132-135`). When enabled it checks
  by service descriptor (not resolve) whether the host registered any `IChatGuardrail` or
  `IChatRequestRedactor`, and separately whether any of those registrations is a prompt-injection defense
  (`DependencyInjection.cs:142-144`), and passes only that last answer to the private
  `RefuseAnUngovernedHost` (`DependencyInjection.cs:146,210-238`). It throws when `RequireGuardrail` is
  true and no prompt-injection guardrail is registered, with a message naming
  `AddContentPolicyGuardrail(configuration)` (see [`ContentPolicyGuardrail`](#contentpolicyguardrail)) and
  stating that `AddPiiRedactionGuardrail()` alone does not satisfy it, because it strips contact details,
  not injected instructions (`DependencyInjection.cs:215-228`); and separately when `AllowTools` is true
  and no `IChatToolPolicy` is registered (`DependencyInjection.cs:230-237`). The private
  `IsPromptInjectionGuardrail` (`DependencyInjection.cs:253-267`) reads a descriptor rather than resolving
  it: an unkeyed `IChatGuardrail` or `IChatRequestRedactor` registration counts only when its
  implementation type, taken from `ImplementationType`, the instance, or the generic return type of a
  typed factory (`FactoryReturnType`, `DependencyInjection.cs:269-270`), is assignable to
  [`IPromptInjectionGuardrail`](#ipromptinjectionguardrail); a factory typed only as the contract cannot
  be recognized and does not count. It then registers `AddMetrics()` and a singleton
  `AiUsageMeter` (`DependencyInjection.cs:148-149`), then builds the chain via `AddChatClient` +
  `.Use(...)` for [`BoundedChatClient`](#boundedchatclient), now also handing it every resolved
  `IChatToolPolicy` (`DependencyInjection.cs:153-158`). Using the descriptor check from above, it adds
  [`GuardrailChatClient`](#guardrailchatclient) to the chain only when a guardrail or a redactor was found,
  resolving both groups at build time (`DependencyInjection.cs:160-166`). It then adds
  [`UsageRecordingChatClient`](#usagerecordingchatclient), passing the bound `AiSettings.Provider` as its
  fallback provider name (`DependencyInjection.cs:168-172`). It adds a
  distributed-cache layer only when `EnableCache` is set AND an `IDistributedCache` is actually
  registered (`DependencyInjection.cs:174-179`), because a cache the host never registered would make
  every call throw at resolve time, so the opt-in needs both halves: the switch AND a store to write to.
  It then applies OpenTelemetry with `EnableSensitiveData` gated by `IsDevelopmentHost`, then
  [`PromptTaggingChatClient`](#prompttaggingchatclient), then logging last
  (`DependencyInjection.cs:181-188`). The private `CreateProviderChatClient`
  (`DependencyInjection.cs:282-291`) resolves every registered `IAiProviderFactory`, matches one by name
  against `AiSettings.Provider` through `AiProviderValidator.Match`, and calls `factory.Create(settings,
  serviceProvider)`; a name with no matching factory throws `InvalidOperationException` built from
  `AiProviderValidator.DescribeMismatch`, which is a belt for the case where the options pipeline was
  bypassed, since `AiProviderValidator` has already refused an unmatched name at startup. The private
  `IsDevelopmentHost` (`DependencyInjection.cs:305-309`) fails CLOSED: an environment it cannot
  positively identify as `Development` (by scanning already-registered `IHostEnvironment` instances)
  reads as not-Development, so prompt and completion text never reach telemetry by accident, mirroring
  the same gate on `Persistence:EnableSensitiveDataLogging` elsewhere in the framework.
- **Why it's built this way**: an early return for `!Enabled` means a host that ships the `Ai` section
  disabled pays zero DI registration cost, not just a runtime no-op. Reading settings once via
  `section.Get<AiSettings>()` (rather than resolving `IOptions<AiSettings>` before the container is
  built) lets the method branch on `Enabled` synchronously during registration.
  `RefuseAnUngovernedHost` runs at registration, with the fix named in the message both times, so a bound
  nobody reaches is not a bound: the deployment fails instead of the tenth user. The guardrail requirement
  asks for a defense against prompt injection specifically, because that is the threat every model call
  shares; a PII redactor alone leaves it open (`DependencyInjection.cs:204-209`). Resolving the provider by
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
  for end-to-end call duration in seconds (`AiUsageMeter.cs:59-61`).
- **Depends on**: `System.Diagnostics.Metrics` (`Meter`, `Counter<long>`, `Histogram<double>`, `TagList`),
  `IMeterFactory` (Microsoft.Extensions.Diagnostics.Metrics), and `Microsoft.Extensions.AI.UsageDetails`.
- **Concept introduced, factory-owned meter lifetime.** `[Rubric §13, Observability & Operability]`
  (assesses whether a dependency's cost/usage is measurable in production): the constructor takes
  `IMeterFactory` and creates its `Meter` through it, but deliberately does NOT retain or dispose that
  meter itself (`AiUsageMeter.cs:75-92`); the factory owns the meter's lifetime, and disposing a
  factory-owned meter from a consumer would silently kill the instrument for every other holder of the
  same name, so this type is not `IDisposable`, matching how the rest of the framework's meters work
  (`AiUsageMeter.cs:63-69`, `[SuppressMessage("CA2000", ...)]` at `AiUsageMeter.cs:71-74` documents
  the deliberate suppression).
- **Walkthrough**: `MeterName = "MMCA.Common.AI"` (`AiUsageMeter.cs:26`) is shared with the
  `ActivitySource` name the pipeline's OpenTelemetry layer publishes under
  (`AiUsageMeter.MeterName` reused at `MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:185`),
  so a host enables traces and metrics
  for the AI dependency with one name. `InputTokensCounterName`/`OutputTokensCounterName`
  (`AiUsageMeter.cs:29,32`, `mmca.ai.input_tokens`/`mmca.ai.output_tokens`) name the two counters, and
  `CallDurationHistogramName` (`AiUsageMeter.cs:45`, `mmca.ai.call.duration`) names the histogram; its doc
  comment records that Microsoft.Extensions.AI's own `UseOpenTelemetry` layer already publishes
  `gen_ai.client.operation.duration` on the same meter, and this instrument does not replace it, it adds
  the `prompt_name`/`prompt_version`/`outcome` dimensions that let a latency regression be attributed to
  the prompt that caused it (`AiUsageMeter.cs:34-44`). `Record`
  (`AiUsageMeter.cs:104-127`) takes a possibly-`null` `UsageDetails`, model, prompt name/version, and
  provider; a `null` usage, or one whose counts the provider did not report, records nothing (an absent
  number must not read as a zero on a spend dashboard, `AiUsageMeter.cs:111-114,118-125`). `RecordDuration`
  (`AiUsageMeter.cs:140-152`) records the elapsed seconds on every call, including one that threw, tagged
  with the same attribution dimensions plus an `outcome` of `SuccessOutcome`, `ErrorOutcome`, or
  `CanceledOutcome` (`AiUsageMeter.cs:48,51,57`; the canceled value also covers a streamed call whose consumer stopped enumerating before the stream ended, `AiUsageMeter.cs:53-56`), so a failure rate and a latency distribution come off one
  series. Both methods share their tagging through the private `AttributionTags`
  (`AiUsageMeter.cs:158-168`, `model`/`prompt_name`/`prompt_version`/`provider` each falling back to
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
  [`AiServiceCollectionExtensions`](#aiservicecollectionextensions)
  (`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:149,171`);
  `Record` and `RecordDuration` are called exclusively from
  [`UsageRecordingChatClient`](#usagerecordingchatclient), which stops the clock in a `try`/`finally` so
  every outcome, including a cancellation or an exception, is recorded.

---

### ChatToolPolicy
> MMCA.Common.AI.Guardrails · `MMCA.Common.AI.Guardrails` · `MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ChatToolPolicy.cs:24` · Level 0 · class

- **What it is**: a static helper reading two `AdditionalProperties` conventions the tool-calling
  boundary shares: whether a tool declares itself consequential, and which tool names the caller
  confirmed for the current request.
- **Depends on**: `Microsoft.Extensions.AI` (`AITool`, `ChatOptions`), `System.Text.Json`
  (`JsonElement`).
- **Concept introduced, per-request confirmation via `AdditionalProperties`.** `[Rubric §16, AI-Native
  Application Architecture]` (assesses tool-calling safety patterns): a confirmation is carried as a
  key in `ChatOptions.AdditionalProperties`, never as a typed property, so it composes with any
  `ChatOptions` without a wrapper type. `[Rubric §11, Security]`: the confirmation is scoped to ONE
  request by design (`ChatToolPolicy.cs:39-42` remark), because a confirmation that outlived the
  request it was given for would be a standing grant, exactly what a confirmation step exists to avoid.
  The consequential marker, by contrast, fails closed: it is the whole write-safety gate, so only a
  definite false reads as harmless (`ChatToolPolicy.cs:58-61`).
- **Walkthrough**: `ConsequentialPropertyKey = "mmca.tool.consequential"` (`ChatToolPolicy.cs:30`)
  marks an `AITool` as doing something that cannot be undone by not reading the answer.
  `ConfirmedToolsPropertyKey = "mmca.tool.confirmed"` (`ChatToolPolicy.cs:43`) holds the confirmed
  names for the current request. `IsConsequential` (`ChatToolPolicy.cs:51-70`) reads the tool's
  `AdditionalProperties`: a missing key is `false`; a `bool` value is used as-is; a `string` value
  goes through the private `ParsedOrConsequential` (`ChatToolPolicy.cs:72-73`), which returns `false`
  only for text that parses as `false` and `true` for anything else, unparseable text included
  (configuration hands a boolean over as text, and a tool declared consequential in a settings file
  must not read as harmless because of that); a `JsonElement` of kind `False` is `false`, a
  `JsonElement` of kind `String` goes through the same `ParsedOrConsequential` (a JSON-bound bag
  hands values over as `JsonElement`); and a marker present in any other shape reads as `true`
  (`ChatToolPolicy.cs:62-69`). `ReadConfirmedTools` (`ChatToolPolicy.cs:78-111`) reads the confirmed names off
  `ChatOptions.AdditionalProperties`, accepting a single `string`, an `IEnumerable<string>`, a
  `JsonElement` of kind `String` (one name) or of kind `Array` (its string items, non-string items
  and empty names dropped) (`ChatToolPolicy.cs:94-100`), or a non-generic `IEnumerable` (a JSON array
  bound as `object[]`), converting each element with `Convert.ToString` and dropping empties
  (`ChatToolPolicy.cs:103-108`);
  anything else returns none. The two `JsonElement` arms exist because options carried over the wire
  bind their bag values as `JsonElement`, a struct that is neither a string nor a sequence, so without
  them a confirmed tool would read as unconfirmed and be stripped (`ChatToolPolicy.cs:91-93`).
- **Why it's built this way**: see
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html) for the
  guardrail boundary this policy plugs into.
- **Where it's used**: [`BoundedChatClient`](#boundedchatclient) calls both methods when filtering
  tools through the registered [`IChatToolPolicy`](#ichattoolpolicy) instances.

---

### ContentMetadata
> MMCA.Common.AI.Guardrails · `MMCA.Common.AI.Guardrails` · `MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ContentMetadata.cs:9` · Level 0 · class

- **What it is**: an `internal static` helper holding the one rule both rewriting guardrails follow
  when they rebuild a content item to change its text: which metadata the rebuilt copy keeps
  (`ContentMetadata.cs:5-8`). It is shared by [`PiiRedactionGuardrail`](#piiredactionguardrail) and
  [`ContentPolicyGuardrail`](#contentpolicyguardrail) "so the two cannot drift".
- **Depends on**: `Microsoft.Extensions.AI` (`AIContent`).
- **Concept introduced, metadata fidelity without the raw representation.** `[Rubric §11, Security]`
  (data exposure: whether a control can be undone downstream): a redacting rebuild keeps what
  describes the item but drops what still carries the original text, because a copied
  `RawRepresentation` would hand the unredacted provider object back to the adapter.
- **Walkthrough**: `WithMetadataOf<TContent>(AIContent source, TContent rebuilt)`
  (`ContentMetadata.cs:22-28`, constrained `where TContent : AIContent`) copies
  `AdditionalProperties` and `Annotations` from `source` onto `rebuilt` and returns `rebuilt`, so a
  caller can wrap the constructor call inline. It deliberately does NOT copy `RawRepresentation`
  (`ContentMetadata.cs:11-17`): the provider's original object still holds the unredacted text, and
  the OpenAI adapters send a raw representation verbatim in place of the item, which would undo the
  redaction. Type-specific members (a tool call's `InformationalOnly`, a tool result's `Exception`)
  are not its concern; the caller sets those on the rebuilt item.
- **Why it's built this way**: one helper instead of two private copies keeps the redaction
  guarantee identical across both guardrails. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: `PiiRedactionGuardrail.RedactContent` (`PiiRedactionGuardrail.cs:129-152`,
  text, reasoning, tool-result and tool-call arms) and `ContentPolicyGuardrail.RedactMessage`
  (`ContentPolicyGuardrail.cs:342`, rebuilt text items).

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

### IPromptInjectionGuardrail
> MMCA.Common.AI.Guardrails · `MMCA.Common.AI.Guardrails` · `MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/IPromptInjectionGuardrail.cs:21` · Level 0 · interface

- **What it is**: a member-less marker interface (`public interface IPromptInjectionGuardrail;`,
  `IPromptInjectionGuardrail.cs:21`) flagging a guardrail or redactor that defends against prompt
  injection in user content, which is what [`AiSettings.RequireGuardrail`](#aisettings) asks an
  enabled host to register (`IPromptInjectionGuardrail.cs:3-5`).
- **Depends on**: nothing; it declares no members.
- **Concept introduced, a requirement keyed to the threat, not to the layer.** `[Rubric §11,
  Security]` (prompt-injection defense as a startup-enforced requirement): the type carrying the
  marker is still registered as an [`IChatGuardrail`](#ichatguardrail) or an
  [`IChatRequestRedactor`](#ichatrequestredactor); the marker only lets the registration-time check
  tell an injection defense apart from any other guardrail. Having SOMETHING in the guardrail layer
  is not enough: a PII redactor strips contact details but lets "ignore previous instructions"
  straight through, so on its own it does not satisfy the requirement
  (`IPromptInjectionGuardrail.cs:6-13`). `[Rubric §16, AI-Native Application Architecture]`.
- **Walkthrough**: `AddMmcaChatClient` reads the registered descriptors rather than resolving them.
  `IsPromptInjectionGuardrail` (`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:253-267`)
  counts an unkeyed `IChatGuardrail` or `IChatRequestRedactor` descriptor whose implementation type
  (from `ImplementationType`, the instance's type, or a typed factory's return type) is assignable to
  this interface; a factory typed only as the contract cannot be recognized and does not count
  (`DependencyInjection.cs:247-252`). `RefuseAnUngovernedHost`
  (`DependencyInjection.cs:210-228`) throws `InvalidOperationException` at registration when
  `RequireGuardrail` is true and no such descriptor exists, naming the fix in the message: call
  `AddContentPolicyGuardrail(configuration)`, mark your own defense with this interface, or set
  `Ai:RequireGuardrail` to false as a reviewable line. An application writing its own defense
  implements the interface on that type and registers it with a concrete implementation type, an
  instance, or a typed factory, so the check can see it (`IPromptInjectionGuardrail.cs:15-20`).
- **Why it's built this way**: a marker keeps the check a pure registration-time read (the same
  fail-fast idea as the rest of `AddMmcaChatClient`) without adding members every guardrail would have
  to implement. See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: implemented by [`ContentPolicyGuardrail`](#contentpolicyguardrail), the one
  implementation the framework ships (registered by
  [`GuardrailServiceCollectionExtensions.AddContentPolicyGuardrail`](#guardrailservicecollectionextensions));
  read by `DependencyInjection`'s registration-time check; covered by `GuardrailRegistrationTests`.
  [`PiiRedactionGuardrail`](#piiredactionguardrail) deliberately does not carry it.

---

### ToolAuthorization
> MMCA.Common.AI.Guardrails · `MMCA.Common.AI.Guardrails` · `MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ToolAuthorization.cs:10` · Level 0 · enum

- **What it is**: the two-value outcome an [`IChatToolPolicy`](#ichattoolpolicy) returns for one tool
  on one request: `Denied` (`ToolAuthorization.cs:12`, not offered to the model) or `Allowed`
  (`ToolAuthorization.cs:14`, may be offered unless another policy or the confirmation rule refuses it).
- **Where it's used**: return type of `IChatToolPolicy.Authorize`; read by
  [`BoundedChatClient`](#boundedchatclient) when filtering tools.

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

### ContentPolicyGuardrail
> MMCA.Common.AI.Guardrails · `MMCA.Common.AI.Guardrails` · `MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ContentPolicyGuardrail.cs:65` · Level 2 · class

- **What it is**: the sealed partial class implementing `IChatGuardrail`,
  [`IChatRequestRedactor`](#ichatrequestredactor) and the
  [`IPromptInjectionGuardrail`](#ipromptinjectionguardrail) marker (`ContentPolicyGuardrail.cs:65`)
  for prompt-injection and answer-content policy: it
  redacts or blocks user content matching a marker (eight built-in patterns plus any configured
  `AdditionalRequestPatterns`), and refuses an answer matching a configured `BlockedResponsePatterns`
  entry. The marker is what makes registering it satisfy `AiSettings.RequireGuardrail`.
- **Depends on**: [`ContentPolicySettings`](#contentpolicysettings) (bound options),
  [`ContentPolicyInjectionMode`](#contentpolicyinjectionmode), [`IChatGuardrail`](#ichatguardrail)/
  [`IChatRequestRedactor`](#ichatrequestredactor)/[`IPromptInjectionGuardrail`](#ipromptinjectionguardrail)/`GuardrailVerdict`,
  [`ContentMetadata`](#contentmetadata), `System.Text.RegularExpressions` (`[GeneratedRegex]` source
  generator).
- **Concept introduced, one type composing redaction AND blocking.** `[Rubric §11, Security]`
  (prompt-injection defense: explains what it protects and where it stops): only
  `ChatRole.User` content is inspected or rewritten, and the streaming inspection path
  (`InspectStreamedUpdateAsync`) checks each fragment rather than the whole answer, so a pattern that
  spans two streamed updates is missed by design; a host that needs whole-answer certainty uses the
  buffered path. `[Rubric §16, AI-Native Application Architecture]`.
- **Walkthrough**: `ConfiguredPatternOptions` (`ContentPolicyGuardrail.cs:68`,
  `IgnoreCase | CultureInvariant`) is what every CONFIGURED pattern compiles with; `MatchTimeout`
  (`ContentPolicyGuardrail.cs:71`, 1 second) bounds a single match so a pathological pattern cannot
  hang a request; `BuiltInPatternOptions` adds `ExplicitCapture` on the BUILT-INS ONLY
  (`ContentPolicyGuardrail.cs:73-76`), because turning that off under a host would silently change
  what a configured pattern's own backreferences mean. `BuiltInMarkers`
  (`ContentPolicyGuardrail.cs:78-88`) pairs eight labeled `[GeneratedRegex]` patterns
  (ignore-previous-instructions, disregard-system-prompt, role-reassignment, new-instructions,
  reveal-system-prompt, act-as-unrestricted, developer-mode, do-anything-now), each with a 1-second
  generated-regex timeout. The constructor (`ContentPolicyGuardrail.cs:101-108`) compiles every
  configured pattern ONCE, at resolve time; a pattern that does not compile has already failed
  `ContentPolicySettings.Validate` at startup, so this constructor is not where a typo is discovered.
  `Redact` (`ContentPolicyGuardrail.cs:119-139`) rewrites only when `InjectionMode` is `Redact`: Block
  mode must inspect what the caller supplied, so rewriting there would hide the marker from the check
  that is supposed to refuse it; Off mode does neither. Non-user messages pass through as the same
  instance, and a rewritten user message is a NEW instance, so a caller holding its own conversation
  history still holds exactly what it built (`ContentPolicyGuardrail.cs:111-118` remark).
  `InspectRequestAsync`
  (`ContentPolicyGuardrail.cs:147-165`) allows in every mode except `Block`, because in `Redact` mode
  the redactor has already run and there is nothing left to refuse. `InspectResponseAsync`/
  `InspectStreamedUpdateAsync` (`ContentPolicyGuardrail.cs:168-193`) both funnel through
  `InspectAnswerText`, which matches against `BlockedResponsePatterns` and returns a block reason
  naming the pattern's INDEX, never the matched text: the reason reaches the caller, and the point of
  the rule was that the text should not. `RedactMessage`/`RedactText`
  (`ContentPolicyGuardrail.cs:332-374`) rewrite only `TextContent`, passing images, function calls,
  and provider-specific content through untouched: a guardrail that silently dropped content it does
  not understand would be a far worse failure than leaving it alone. Inside a rewritten message, a
  text item with no marker is kept as the same instance, and a rebuilt text item keeps its
  `AdditionalProperties` and `Annotations` through the shared
  [`ContentMetadata.WithMetadataOf`](#contentmetadata) (`ContentPolicyGuardrail.cs:339-342`), the
  same helper [`PiiRedactionGuardrail`](#piiredactionguardrail) uses; the rebuilt message keeps
  `AuthorName`, `MessageId`, `CreatedAt` and `AdditionalProperties`
  (`ContentPolicyGuardrail.cs:353-359`). `RedactText`
  (`ContentPolicyGuardrail.cs:362`) replaces each marker with a `MatchEvaluator` that returns the
  placeholder, not the replacement-string overload: the placeholder is literal text, and as a
  replacement pattern `$&` or `$0` would put the matched marker straight back.
- **Why it's built this way**: matches the ADR-120 governed pipeline's split between redaction (silent,
  changes the request shape) and blocking (visible, a refusal). See
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: registered by
  [`GuardrailServiceCollectionExtensions.AddContentPolicyGuardrail`](#guardrailservicecollectionextensions)
  as both `IChatGuardrail` and `IChatRequestRedactor` from one singleton, where its
  `IPromptInjectionGuardrail` implementation type satisfies the `RequireGuardrail` check in
  `DependencyInjection` (`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:253-267`);
  ADC's `SessionScoreResponseGuardrail` composes it.

---

### ContentPolicySettings
> MMCA.Common.AI.Guardrails · `MMCA.Common.AI.Guardrails` · `MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/ContentPolicySettings.cs:33` · Level 2 · class

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
- **Walkthrough**: `SectionName = "Ai:ContentPolicy"` (`ContentPolicySettings.cs:36`);
  `DefaultRedactionPlaceholder = "[redacted-instruction]"` (`ContentPolicySettings.cs:39`), a VISIBLE
  placeholder on purpose (`ContentPolicySettings.cs:82-86` remark) so the model can tell something
  was removed and a trace reviewer can tell a redaction from a sentence the user never wrote.
  `InjectionMode` defaults `Redact` (`ContentPolicySettings.cs:45`).
  `AdditionalRequestPatterns`/`BlockedResponsePatterns` (`ContentPolicySettings.cs:55,75`) default
  to empty; an empty `BlockedResponsePatterns` switches the response half of the policy off entirely,
  because a model that has already said the thing cannot unsay it, so the only available response-side
  answer is a refusal. That emptiness is by design, not omission (`ContentPolicySettings.cs:22-31`,
  `66-73`): what an answer must never say is a fact about the application (an internal code name, a
  customer identifier format, a price the model must not quote), so no pattern the framework could
  ship is right for every host, and a guessed default would refuse legitimate answers in one
  application while protecting nothing in another. The framework ships the mechanism (buffered and
  streamed response inspection, the index-only block reason, startup validation); each host supplies
  its own patterns, or registers its own response `IChatGuardrail` when a regular expression is the
  wrong tool. The prompt-injection half does not depend on this list and runs either way.
  `RedactionPlaceholder` is `[Required]` (`ContentPolicySettings.cs:87-88`) and is inserted as literal text, so a `$` sequence in it is not a regex substitution (`ContentPolicySettings.cs:77-80`).
  `Validate` (`ContentPolicySettings.cs:101-112`) runs `ValidatePatterns` over both lists, which calls
  `DescribeFailure` (`ContentPolicySettings.cs:135-151`) per pattern: an empty-or-whitespace pattern
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
> MMCA.Common.AI.Guardrails · `MMCA.Common.AI.Guardrails` · `MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/PiiRedactionGuardrail.cs:42` · Level 3 · class

- **What it is**: the sealed partial class implementing
  [`IChatRequestRedactor`](#ichatrequestredactor) and `IChatGuardrail` that strips emails and phone
  numbers from the text carried by outgoing messages, tool calls and tool results included. The guardrail half is a pass-through (always `Allow`): this type
  only redacts, it never blocks.
- **Depends on**: [`IChatRequestRedactor`](#ichatrequestredactor)/`IChatGuardrail`/`GuardrailVerdict`,
  [`ContentMetadata`](#contentmetadata), `System.Text.RegularExpressions`, `System.Text.Json`.
- **Concept introduced, configuration-free, unconditional redaction.** Contrasts with
  [`ContentPolicyGuardrail`](#contentpolicyguardrail): `PiiRedactionGuardrail` has no configurable
  options and applies to every outgoing message unconditionally.
- **Walkthrough**: `EmailPattern`/`PhonePattern` (`PiiRedactionGuardrail.cs:73-83`) are
  `[GeneratedRegex]` source-generated matchers with a 1-second timeout (email: a standard
  local-part@domain shape; phone: an optional leading country code plus a 10-digit US-shaped number,
  guarded by negative lookaround so it does not clip a longer digit run). `Redact`
  (`PiiRedactionGuardrail.cs:48-59`) rewrites EVERY message, not only `ChatRole.User` (unlike
  `ContentPolicyGuardrail`), via the private `RedactMessage`
  (`PiiRedactionGuardrail.cs:85-102`), which rebuilds each message (keeping role, `AuthorName`,
  `MessageId`, `CreatedAt` and `AdditionalProperties`, `PiiRedactionGuardrail.cs:95-101`) and hands every content item to `RedactContent`
  (`PiiRedactionGuardrail.cs:125-159`). That switch rebuilds an item only when it actually holds
  contact details: non-empty `TextContent` and `TextReasoningContent`, a `FunctionResultContent`
  whose result is a `JsonElement` or a `string`, and a `FunctionCallContent` with an argument value
  that is a `string` or a `JsonElement` (routed through `RedactArgument`,
  `PiiRedactionGuardrail.cs:161-166`; other argument values kept as-is). The "holds contact
  details" test is `HasContactDetails`/`ArgumentHasContactDetails`/`JsonHasContactDetails`
  (`PiiRedactionGuardrail.cs:168-192`), which compares `RedactText` output with the input; an item
  with nothing to redact passes through by reference. A rebuilt item keeps its metadata through
  the shared [`ContentMetadata.WithMetadataOf`](#contentmetadata) (`AdditionalProperties` and
  `Annotations`), plus a tool call's `InformationalOnly` and `Exception` and a tool result's
  `Exception`, set in the rebuilding arms themselves (`PiiRedactionGuardrail.cs:135-152`), but NOT
  `RawRepresentation`: the provider's original object still holds the unredacted text, and the
  OpenAI adapters send a raw representation verbatim in place of the item, which would undo the
  redaction (`PiiRedactionGuardrail.cs:104-124`). A `TextReasoningContent` carrying `ProtectedData`
  is never rebuilt (`PiiRedactionGuardrail.cs:127`): that data is the provider's signature over
  the text (Anthropic's thinking signature), and an edited signed block is rejected when the
  conversation is sent back.
  Both shapes matter because Microsoft.Extensions.AI's function-invoking client marshals a tool's
  return value and the model's arguments into `JsonElement`, and a tool's output is exactly where
  contact details turn up (a customer lookup, a directory search). Plain text goes through
  `RedactText` (`PiiRedactionGuardrail.cs:194-195`), which replaces email matches then phone
  matches. A `JsonElement` goes through `RedactJson` (`PiiRedactionGuardrail.cs:202-212`) and the
  recursive `WriteRedacted` (`PiiRedactionGuardrail.cs:214-246`), which rebuilds the document with
  a `Utf8JsonWriter`, redacting only string VALUES and copying property names, numbers, booleans and
  nulls verbatim: running the patterns over the raw JSON text would turn a bare 10-digit number (a
  Unix timestamp) into a phone placeholder and break the document. Binary and other non-text
  content (images, results and arguments that are neither a string nor a `JsonElement`,
  provider-specific items) passes through untouched for the same reason `ContentPolicyGuardrail` gives
  (a guardrail that silently dropped content it does not understand would be worse than leaving it
  alone). `InspectRequestAsync`/`InspectResponseAsync`
  (`PiiRedactionGuardrail.cs:62-71`) both unconditionally return `GuardrailVerdict.Allow`.
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
> MMCA.Common.AI.Guardrails · `MMCA.Common.AI.Guardrails` · `MMCA.Common/Source/Core/MMCA.Common.AI/Guardrails/GuardrailServiceCollectionExtensions.cs:17` · Level 4 · class

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
  (`GuardrailServiceCollectionExtensions.cs:34-45`) registers `PiiRedactionGuardrail` once via
  `TryAddSingleton`, then `TryAddEnumerable`-registers it under both `IChatGuardrail` and
  `IChatRequestRedactor`. `AddContentPolicyGuardrail`
  (`GuardrailServiceCollectionExtensions.cs:64-81`) additionally binds `ContentPolicySettings` from
  `Ai:ContentPolicy` with `.ValidateDataAnnotations().ValidateOnStart()` (so a bad pattern fails the
  deployment, not a user's request) before registering `ContentPolicyGuardrail` the same two-contract
  way. Both methods' doc remarks state they must be called BEFORE `AddMmcaChatClient`, which reads the
  registered descriptors to decide whether to compose the guardrail layer at all. Only the second
  call satisfies `AiSettings.RequireGuardrail`: `ContentPolicyGuardrail` is an
  [`IPromptInjectionGuardrail`](#ipromptinjectionguardrail) (`GuardrailServiceCollectionExtensions.cs:47-54`),
  while `AddPiiRedactionGuardrail` on its own does NOT, because the requirement asks for a
  prompt-injection defense and a PII redactor is not one (`GuardrailServiceCollectionExtensions.cs:21-26`).
- **Why it's built this way**: see
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: called by a consuming host before `AddMmcaChatClient`; ADC's
  `Conference.Infrastructure` `DependencyInjection` is the one usage site outside this file's own
  registration tests.

### GoldenReplayCase
> MMCA.Common.AI.Testing · `MMCA.Common.AI.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.AI.Testing/GoldenReplayCase.cs:19` · Level 0 · record

- **What it is**: one entry in a golden-replay corpus: an `Id`, a `Description`, a `ResponsePath`
  naming the recorded response file to replay for that case, and the `PromptContractHash` of the
  [`PromptContract`](#promptcontract) the response was recorded against (`GoldenReplayCase.cs:19`).
- **Depends on**: none first-party (the hash is a plain string; its doc comment points at
  `PromptContract.Hash`); consumed by [`GoldenReplayTestsBase`](#goldenreplaytestsbase).
- **Walkthrough**: a `sealed record` with four positional properties (`GoldenReplayCase.cs:19`).
  `ResponsePath` is resolved relative to `AppContext.BaseDirectory`, so a corpus is data copied next
  to the test assembly. `PromptContractHash` exists so the base class can fail a case whose recording
  was made under a different prompt, model or system text than the one that ships. `ToString()`
  returns `Id` (`GoldenReplayCase.cs:22`), which is what an xUnit theory display name shows.
- **Where it's used**: [`GoldenReplayTestsBase.Cases`](#goldenreplaytestsbase); ADC's
  `MMCA.ADC.Conference.Scoring.Evaluation.Tests` declares its own corpus of these.

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
- **Walkthrough**: two constructors (`ReplayChatClient.cs:26-29,37-47`), one for a single response, one
  for an ordered list (rejecting an empty list, since a replay client needs at least one recorded
  answer). `LastOptions`, `LastMessages`, `CallCount` (`ReplayChatClient.cs:50-56`) record what the
  client was last called with, for assertions. `GetResponseAsync` and `GetStreamingResponseAsync`
  (`ReplayChatClient.cs:65-94`) both funnel through the private `Record`, with the streaming path
  projecting the SAME recorded response onto the streaming shape via the abstraction's own
  `ToChatResponseUpdates()` conversion, so a test asserting the streamed answer exercises the same
  corpus as the buffered path rather than a second, hand-built approximation of it. `Record`
  (`ReplayChatClient.cs:104-122`) advances through the recorded list and repeats the LAST response once
  exhausted, so a test calling once more than it recorded gets a stable answer rather than an exception
  from the harness pretending to be a failure in the code under test. It snapshots the messages
  outside the lock, then takes one `Lock` (`_sync`, `ReplayChatClient.cs:20`) over the index read, the
  `CallCount` increment and the `LastMessages`/`LastOptions` writes (`ReplayChatClient.cs:112-121`),
  so concurrent calls neither lose a count nor pair one call's messages with another call's options.
  `Dispose` is a no-op: the replay
  client holds no transport. `GetService` returns itself only when asked for its own type.
- **Where it's used**: [`GoldenReplayTestsBase.RunCaseAsync`](#goldenreplaytestsbase) constructs one per
  case; `ReplayChatClientTests`, ADC's `GoldenReplayTests`, and `ReferenceGoldenReplayTests`.

---

### GoldenReplayTestsBase
> MMCA.Common.AI.Testing · `MMCA.Common.AI.Testing` · `MMCA.Common/Source/Hosting/MMCA.Common.AI.Testing/GoldenReplayTestsBase.cs:31` · Level 1 · class

- **What it is**: the abstract xUnit base that drives a golden-replay corpus: for every
  [`GoldenReplayCase`](#goldenreplaycase) it reads the recorded response, wraps it in a
  [`ReplayChatClient`](#replaychatclient), and hands both to the derived class's assertion; a second
  gate fails every case recorded against a different [`PromptContract`](#promptcontract) than the one
  the code under test ships.
- **Depends on**: [`GoldenReplayCase`](#goldenreplaycase), [`PromptContract`](#promptcontract),
  [`RecordedResponses`](#recordedresponses), [`ReplayChatClient`](#replaychatclient), xUnit `[Fact]`.
- **Concept introduced, aggregated-failure regression gate.** `[Rubric §14, Testability]`: rather than
  stopping at the first failing case, each `[Fact]` checks every case and reports the complete
  failure set in one message, so a full corpus run always shows every regression (and every stale
  recording) from one CI attempt.
- **Walkthrough**: `Cases`, `CurrentContract` and `AssertCaseAsync` (`GoldenReplayTestsBase.cs:34,40,50-53`)
  are the three hooks a derived test class implements: the corpus, the prompt contract the code under
  test sends today (the same instance, so the compared hash is the production hash), and how one
  case's outcome is asserted (throwing, an assertion failure or anything else, fails that case and is
  reported against its id). Both facts load the corpus through `LoadCases`
  (`GoldenReplayTestsBase.cs:104-116`), which copies `Cases` defensively and throws
  `InvalidOperationException` if it is empty (an empty gate would pass without evaluating anything).
  `EveryGoldenCase_WasRecordedAgainstTheCurrentContract` (`GoldenReplayTestsBase.cs:55-78`) throws if
  `CurrentContract` is null, collects every non-null case whose `PromptContractHash` differs ordinally
  from `CurrentContract.Hash`, and throws one exception naming the contract's `Name@Version`, its hash
  and each stale case id, telling the author to re-record those cases: a replayed old answer would
  still pass while proving nothing about the prompt that ships.
  `EveryGoldenCase_ReplaysAsRecorded` (`GoldenReplayTestsBase.cs:80-102`) runs every case through
  `RunCaseAsync` and throws one exception listing every failure when `failures.Count > 0`.
  `RunCaseAsync` (`GoldenReplayTestsBase.cs:118-143`) reports a null entry as its own failure, resolves
  the response path under `AppContext.BaseDirectory`, reads it via `RecordedResponses.Read`, builds a
  `ReplayChatClient`, and calls `AssertCaseAsync`; every exception is caught
  (`CA1031`/`S2221` suppressed at `GoldenReplayTestsBase.cs:127` with a comment that a failing case must
  be reported, not end the run) and turned into one line naming the case's id and description.
- **Why it's built this way**: see
  [`ADR-120`](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html) and
  [`ADR-111`](https://ivanball.github.io/docs/adr/111-ai-session-scoring-governance.html) for the
  scoring-governance context this harness was built for.
- **Where it's used**: ADC's `GoldenReplayTests` (Conference.Scoring.Evaluation.Tests) and this repo's
  own `ReferenceGoldenReplayTests`/`ReplayChatClientTests` subclass it, exercising the gate itself in
  this repo's CI.

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

### CommonMcpOptions
> MMCA.Common.Mcp · `MMCA.Common.Mcp` · `MMCA.Common/Source/Presentation/MMCA.Common.Mcp/CommonMcpOptions.cs:9` · Level 0 · class

- **What it is**: the tool-selection bag a host fills inside the `AddCommonMcpServer` callback: which
  `[McpServerToolType]` classes the MCP endpoint exposes (`CommonMcpOptions.cs:5-8`).
- **Depends on**: nothing first-party; `System.Reflection.Assembly` (external, `CommonMcpOptions.cs:1`).
- **Concept**: the options-callback shape of a C# `extension(T)` registration method (see
  [C# `extension(T)` types, read this once](00-primer.md#c-extensiont-types--read-this-once)); the MCP
  endpoint itself is introduced on [`McpHostingExtensions`](#mcphostingextensions).
- **Walkthrough**: two get-only, collection-initialized lists. `ToolAssemblies` (`CommonMcpOptions.cs:12`)
  names assemblies whose tool classes are all scanned; `ToolTypes` (`CommonMcpOptions.cs:15`) names
  individual tool classes for a host that does not want a whole assembly scanned.
- **Why it's built this way**: get-only lists mean a host can only add to them, never replace them, and
  the instance is built only after `Mcp:Enabled` is confirmed true
  (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHostingExtensions.cs:65-71`), so a disabled
  endpoint never runs the callback. Recorded in
  [ADR-138](https://ivanball.github.io/docs/adr/138-mcp-endpoint-over-module-queries.html).
- **Where it's used**: consumed by `AddCommonMcpServer` (`McpHostingExtensions.cs:87,89-92`); the ADC
  Conference service adds one type,
  `builder.AddCommonMcpServer(options => options.ToolTypes.Add(typeof(ConferenceMcpTools)))`
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:368`, see
  [`ConferenceMcpTools`](group-20-conference-api-grpc.md#conferencemcptools)).

### McpEnabledMarker
> MMCA.Common.Mcp · `MMCA.Common.Mcp` · `MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHostingExtensions.cs:143` · Level 0 · class (private, nested)

- **What it is**: an empty private nested class whose only job is to exist in the container when MCP was
  registered, so `MapCommonMcp` can tell whether `AddCommonMcpServer` ran with the endpoint enabled
  (`McpHostingExtensions.cs:142-143`).
- **Depends on**: nothing.
- **Concept**: a DI marker registration, a type registered for its presence rather than its behavior.
- **Walkthrough**: `TryAddSingleton<McpEnabledMarker>()` runs only on the enabled path of
  `AddCommonMcpServer` (`McpHostingExtensions.cs:75`); `MapCommonMcp` probes
  `GetService<McpEnabledMarker>()` (`McpHostingExtensions.cs:119`) and, when it is absent but
  `Mcp:Enabled` reads true, throws because the registration call was forgotten
  (`McpHostingExtensions.cs:121-124`); otherwise it maps nothing.
- **Why it's built this way**: being `private` (`McpHostingExtensions.cs:143`) means no other code can
  register it, so its presence is proof that this class's own enabled path ran, which a check against an
  SDK service type could not guarantee.
- **Where it's used**: only inside [`McpHostingExtensions`](#mcphostingextensions).

### McpHiddenText
> MMCA.Common.Mcp · `MMCA.Common.Mcp` · `MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHiddenText.cs:14` · Level 0 · class (static)

- **What it is**: the detector and stripper for text a model reads but a human reviewer does not see:
  Unicode format characters (category Cf, such as zero-width and bidi controls), tag characters
  (U+E0000 to U+E007F) and HTML comment openers (`McpHiddenText.cs:6-13`).
- **Depends on**: nothing first-party; `System.Text.Rune`, `System.Globalization.UnicodeCategory` and
  `StringBuilder` (external, `McpHiddenText.cs:1-2`).
- **Concept introduced, hidden-text poisoning of model-visible text.** `[Rubric §16, AI-Native Application
  Architecture]` (assesses whether LLM-facing surfaces are governed rather than trusted): a tool
  description or a tool result is read verbatim by the model, so an invisible instruction riding in it is
  a prompt-injection vector a code reviewer cannot spot. `[Rubric §11, Security]` (assesses whether
  untrusted input is neutralized at a defined boundary): the same check is applied at two boundaries,
  descriptions at startup and third-party text in results at call time (`McpHiddenText.cs:9-12`).
- **Walkthrough**: `Find` (`McpHiddenText.cs:21`) returns empty for null or empty input, then walks the
  text by `Rune` (so a surrogate pair is one code point), reporting a tag character
  (`McpHiddenText.cs:32`, test at `McpHiddenText.cs:83`) or a Cf character (`McpHiddenText.cs:36`) with
  its UTF-16 position, then scans ordinally for every `"<!--"` (`McpHiddenText.cs:16,44-48`). `Strip`
  (`McpHiddenText.cs:63`) returns the input unchanged when nothing is invisible; otherwise it rebuilds
  the string without any rune that `IsInvisible` (`McpHiddenText.cs:80-81`) flags.
- **Why it's built this way**: `Strip` deliberately leaves an HTML comment opener in place, because in
  a result it is visible text rather than hidden text, and it accepts that dropping the zero-width joiner
  splits joined emoji sequences: the documented price of never forwarding a character a reviewer cannot
  see (`McpHiddenText.cs:54-60`). Recorded in
  [ADR-138](https://ivanball.github.io/docs/adr/138-mcp-endpoint-over-module-queries.html).
- **Where it's used**: [`ToolDescriptionInspector`](#tooldescriptioninspector) delegates its startup
  check to `Find` (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/ToolDescriptionInspector.cs:16`);
  the ADC Conference tools run `Strip` over third-party text before returning it
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Mcp/ConferenceMcpResults.cs:33`);
  covered by `MMCA.Common/Tests/Presentation/MMCA.Common.Mcp.Tests/McpHiddenTextTests.cs`.

### McpToolPermissionAttribute
> MMCA.Common.Mcp · `MMCA.Common.Mcp` · `MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpToolPermissionAttribute.cs:12` · Level 0 · class (attribute)

- **What it is**: a method attribute that restricts one MCP tool to callers holding a named permission;
  a caller without it neither sees the tool in `tools/list` nor can call it
  (`McpToolPermissionAttribute.cs:3-9`).
- **Depends on**: nothing first-party at compile time; at run time the check resolves the same
  [`PermissionPolicy`](group-08-auth.md#permissionpolicy) name that
  [`HasPermissionAttribute`](group-08-auth.md#haspermissionattribute) uses
  (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpToolGovernance.cs:143`).
- **Concept**: per-tool authorization on an endpoint that is anonymous at the HTTP layer.
  `[Rubric §11, Security]` (assesses whether authorization is declarative and consistent across entry
  points): a tool reuses the module's existing `perm:` policy, so a role grant admits a caller to the
  tool exactly as to the HTTP endpoint it mirrors (`McpToolGovernance.cs:128-129`).
- **Walkthrough**: a primary-constructor attribute exposing one get-only `Permission`
  (`McpToolPermissionAttribute.cs:12,15`), restricted to methods, single-use, not inherited
  (`McpToolPermissionAttribute.cs:11`).
- **Why it's built this way**: the permission is a plain string so the attribute has no reference to the
  API authorization assembly; the governance filter reads it back from the tool's metadata
  (`McpToolGovernance.cs:125`). A tool without it is public, which is why
  [`McpToolPublicAttribute`](#mcptoolpublicattribute) exists to record that choice.
- **Where it's used**: read by [`McpToolGovernance`](#mcptoolgovernance) for filtering and for the
  startup access check (`McpToolGovernance.cs:100-101`); the permission-coverage fitness rule resolves
  its `Permission` value
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Api/ArchitectureRules.PermissionCoverage.cs:10,121`).
- **Caveats / not-in-source**: no tool in `MMCA.ADC/Source` carries this attribute today; every ADC
  Conference tool is `[McpToolPublic]`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Mcp/ConferenceMcpTools.cs:33`).

### McpToolPublicAttribute
> MMCA.Common.Mcp · `MMCA.Common.Mcp` · `MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpToolPublicAttribute.cs:12` · Level 0 · class (attribute)

- **What it is**: a marker attribute declaring that an MCP tool is intentionally public, so it needs no
  token and may expose only data an anonymous HTTP endpoint already serves
  (`McpToolPublicAttribute.cs:3-10`).
- **Depends on**: nothing.
- **Concept**: an explicit access declaration, the counterpart of
  [`McpToolPermissionAttribute`](#mcptoolpermissionattribute). `[Rubric §34, Architecture Governance &
  Documentation]` (assesses whether rules are enforced rather than remembered): the choice is checked
  twice, at startup by `MapCommonMcp` and in a fitness test that requires exactly one of the two
  attributes on every `[McpServerTool]` method (`McpToolPublicAttribute.cs:6-9`).
- **Walkthrough**: a one-line `sealed` attribute with no members (`McpToolPublicAttribute.cs:12`),
  method-only, single-use, not inherited (`McpToolPublicAttribute.cs:11`).
- **Why it's built this way**: public is the behavioral default (no permission attribute means no
  check), so without a marker an omission and a decision would look the same; this attribute turns the
  omission into a startup failure.
- **Where it's used**: [`McpToolGovernance`](#mcptoolgovernance)`.ThrowIfAccessUndeclared`
  (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpToolGovernance.cs:100-101`); the fitness rule
  matches it by full name
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Api/ArchitectureRules.McpToolAccess.cs:8,26-27`),
  run by [`McpToolAccessDeclarationTestsBase`](group-29-testing-infrastructure.md#per-project-test-rollup);
  every ADC Conference tool carries it
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Mcp/ConferenceMcpTools.cs:33,52,72,90,109,127`).

### McpToolSettings
> MMCA.Common.Mcp · `MMCA.Common.Mcp` · `MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpToolSettings.cs:4` · Level 0 · class

- **What it is**: the settings for one MCP tool, bound from `Mcp:Tools:<name>` (`McpToolSettings.cs:3`).
- **Depends on**: nothing.
- **Concept**: per-tool operational switches; the endpoint-level configuration is on
  [`McpSettings`](#mcpsettings).
- **Walkthrough**: `Enabled` (`McpToolSettings.cs:10`) defaults to `true`; a disabled tool is absent
  from `tools/list` and a call returns an error result. `PermitsPerMinute` (`McpToolSettings.cs:17`) is
  a nullable per-caller, per-instance limit; `null` sets none.
- **Why it's built this way**: defaults that change nothing (enabled, unlimited) mean a tool needs an
  entry only when an operator wants to switch it off or bound it. A set `PermitsPerMinute` must be 1 or
  more, enforced at startup by `ValidateOnStart`
  (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHostingExtensions.cs:60-63`).
- **Where it's used**: the value type of [`McpSettings`](#mcpsettings)`.Tools`
  (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpSettings.cs:31`), read by
  [`McpToolGovernance`](#mcptoolgovernance).

### ToolCall
> MMCA.Common.Mcp · `MMCA.Common.Mcp` · `MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpToolRateLimiter.cs:41` · Level 0 · record struct (private, nested)

- **What it is**: the partition input of [`McpToolRateLimiter`](#mcptoolratelimiter): tool name, caller
  key and the tool's configured permit count (`McpToolRateLimiter.cs:41`).
- **Depends on**: nothing.
- **Concept**: see [`McpToolRateLimiter`](#mcptoolratelimiter).
- **Walkthrough**: a `private readonly record struct` with three positional members; `TryAcquire`
  builds one per call (`McpToolRateLimiter.cs:34`) and the partition factory turns it into the key
  `"{Tool}\n{PermitsPerMinute}\n{Caller}"` (`McpToolRateLimiter.cs:16-18`).
- **Why it's built this way**: a value type avoids an allocation per call, and carrying the permit count
  in it lets the partition key include the count, so a configuration reload that changes the limit
  starts a fresh window (`McpToolRateLimiter.cs:13-15`).
- **Where it's used**: only inside [`McpToolRateLimiter`](#mcptoolratelimiter).

### IAiProviderFactory
> MMCA.Common.AI · `MMCA.Common.AI.Providers` · `MMCA.Common/Source/Core/MMCA.Common.AI/Providers/IAiProviderFactory.cs:20` · Level 1 · interface

- **What it is**: the boundary a vendor SDK adapter implements to plug into `AddMmcaChatClient`'s
  provider selection. `Name` (`IAiProviderFactory.cs:31`) is the case-insensitive string a config file's
  `Ai:Provider` selects it by; `Create` (`IAiProviderFactory.cs:34`) builds the ungoverned
  `IChatClient` for already-validated [`AiSettings`](#aisettings).
- **Depends on**: [`AiSettings`](#aisettings) (the bound `Ai` section it receives), `Microsoft.Extensions.AI.IChatClient`
  and `IServiceProvider` (both external), both parameters of `Create` (`IAiProviderFactory.cs:34`).
- **Concept introduced, the provider-factory boundary.** `[Rubric §1, SOLID]` (assesses dependency
  inversion and substitutability): `AddMmcaChatClient` and [`AiProviderValidator`](#aiprovidervalidator) depend only on this
  interface, never on a concrete vendor SDK type, so a new provider (a third LLM vendor) is one new
  adapter package plus one registration call, with zero changes to the pipeline or the validator.
  `[Rubric §16, AI-Native Application Architecture]` (assesses whether provider selection is a
  first-class, swappable concern rather than hard-wired code): this interface is the entire swap point,
  recorded in [ADR-120](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Walkthrough**: two members only, `Name` (`IAiProviderFactory.cs:31`, a `string` getter) and
  `Create(AiSettings settings, IServiceProvider serviceProvider)` (`IAiProviderFactory.cs:34`, returns
  `IChatClient`). The doc comment on `Create` (`IAiProviderFactory.cs:33`) records that ownership of the
  returned client passes to the governed pipeline that wraps it, i.e. the factory itself never disposes
  what it builds.
- **Why it's built this way**: `serviceProvider` is passed alongside `settings` so an adapter that needs
  a logger or a named `HttpClient` factory can resolve one without the interface growing a parameter per
  future need (`IAiProviderFactory.cs:32`). The instances that implement it, [`AnthropicAiProviderFactory`](#anthropicaiproviderfactory)
  and [`OpenAiProviderFactory`](#openaiproviderfactory), are registered as `IEnumerable<IAiProviderFactory>` so `AddMmcaChatClient` and
  [`AiProviderValidator`](#aiprovidervalidator) can enumerate every adapter package the host actually referenced, never a fixed list.
- **Where it's used**: `DependencyInjection.cs` in `MMCA.Common.AI` resolves the matching factory to
  build the governed client; [`AiProviderValidator`](#aiprovidervalidator) enumerates all registered factories to validate
  `Ai:Provider` at startup; `MMCA.ADC.Conference.Service/Program.cs` registers an adapter package that
  implements it.
- **Caveats / not-in-source**: the interface itself carries no lifetime attribute; the registration
  call sites (`AnthropicAiServiceCollectionExtensions.AddAnthropicAiProvider`,
  `OpenAiServiceCollectionExtensions.AddOpenAiProvider`) are what fix it to singleton, not this type.

### McpSettings
> MMCA.Common.Mcp · `MMCA.Common.Mcp` · `MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpSettings.cs:19` · Level 1 · class

- **What it is**: the configuration for the MCP endpoint, bound from the `Mcp` section; the endpoint is
  off unless `Enabled` is `true` (`McpSettings.cs:3-7`).
- **Depends on**: [`McpToolSettings`](#mcptoolsettings) (the per-tool entries).
- **Concept**: an off-by-default feature switch with fail-fast validation. `[Rubric §13, Observability &
  Operability]` (assesses whether operators can change behavior safely through configuration): an
  operator enables the endpoint, disables a single tool or caps it per minute without a redeploy, and a
  bad limit fails startup rather than the first call (fail-fast contract,
  [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html)).
- **Walkthrough**: `SectionName = "Mcp"` (`McpSettings.cs:22`); `Enabled` (`McpSettings.cs:25`) has no
  initializer, so it defaults to `false`; `Tools` (`McpSettings.cs:31`) is a get-only dictionary keyed
  by the `[McpServerTool]` name with `StringComparer.OrdinalIgnoreCase`. A tool with no entry is enabled
  and bounded only by the endpoint-wide `mcp` rate-limit policy (`McpSettings.cs:27-30`). The doc
  comment carries a sample section (`McpSettings.cs:8-18`).
- **Why it's built this way**: with `Enabled` false, `AddCommonMcpServer` registers only these options
  and no MCP service, and `MapCommonMcp` maps no route, so `/mcp` answers 404 (`McpSettings.cs:4-6`):
  an off endpoint has no attack surface at all. Recorded in
  [ADR-138](https://ivanball.github.io/docs/adr/138-mcp-endpoint-over-module-queries.html).
- **Where it's used**: bound and validated by `AddCommonMcpServer`
  (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHostingExtensions.cs:57-63`); read live through
  `IOptionsMonitor<McpSettings>` by [`McpToolGovernance`](#mcptoolgovernance)
  (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpToolGovernance.cs:32,61`).

### McpToolRateLimiter
> MMCA.Common.Mcp · `MMCA.Common.Mcp` · `MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpToolRateLimiter.cs:11` · Level 1 · class (internal)

- **What it is**: the per-tool rate limit behind `Mcp:Tools:<name>:PermitsPerMinute`: a one-minute
  fixed window per tool and caller, held in memory per instance (`McpToolRateLimiter.cs:6-10`).
- **Depends on**: [`ToolCall`](#toolcall) (its partition input); `System.Threading.RateLimiting`'s
  `PartitionedRateLimiter` and `FixedWindowRateLimiterOptions` (external, `McpToolRateLimiter.cs:2`).
- **Concept**: a second, narrower rate limit under the endpoint-wide one. `[Rubric §12, Performance &
  Scalability]` (assesses whether expensive work is bounded per caller): the `mcp` policy from
  `AddCommonRateLimiting` bounds a caller's total requests
  ([ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html)), while this limiter bounds one
  expensive tool on its own (`McpToolRateLimiter.cs:8-9`).
- **Walkthrough**: `_limiter` (`McpToolRateLimiter.cs:16`) is a `PartitionedRateLimiter` that gives each
  key a fixed-window limiter with `PermitLimit` from the call, a one-minute `Window`, `QueueLimit = 0`
  (no waiting) and auto-replenishment (`McpToolRateLimiter.cs:17-25`). `TryAcquire`
  (`McpToolRateLimiter.cs:32`) takes one permit via `AttemptAcquire` and returns whether the lease was
  acquired, disposing the lease immediately (`McpToolRateLimiter.cs:34-35`). `Dispose`
  (`McpToolRateLimiter.cs:39`) disposes the limiter.
- **Why it's built this way**: the partitioned limiter drops idle partitions, so a stream of distinct
  callers does not grow memory without bound, and the permit count is part of the key so a reload that
  changes it starts a fresh window (`McpToolRateLimiter.cs:13-15`). `QueueLimit = 0` makes an over-limit
  call fail at once, which the governance filter turns into a readable error result.
- **Where it's used**: registered as a singleton by `AddCommonMcpServer`
  (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHostingExtensions.cs:74`) and called from
  [`McpToolGovernance`](#mcptoolgovernance)`.CallTool`
  (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpToolGovernance.cs:78`).
- **Caveats / not-in-source**: the count is per instance (`McpToolRateLimiter.cs:7-8`), so with several
  replicas a caller's effective limit is the configured value times the replica count.

### ToolDescriptionInspector
> MMCA.Common.Mcp · `MMCA.Common.Mcp` · `MMCA.Common/Source/Presentation/MMCA.Common.Mcp/ToolDescriptionInspector.cs:11` · Level 1 · class (internal static)

- **What it is**: the startup check that refuses to map the MCP endpoint when any tool, parameter or
  server description hides text (`ToolDescriptionInspector.cs:6-10`).
- **Depends on**: [`McpHiddenText`](#mcphiddentext) (the detector); the MCP SDK's `McpServerOptions`
  and `System.Text.Json.JsonElement` (external, `ToolDescriptionInspector.cs:1-2`).
- **Concept**: the startup half of the hidden-text defence introduced on
  [`McpHiddenText`](#mcphiddentext). `[Rubric §16, AI-Native Application Architecture]`: a poisoned
  description fails startup instead of reaching a client (`ToolDescriptionInspector.cs:8-9`).
- **Walkthrough**: `FindHiddenText` (`ToolDescriptionInspector.cs:16`) forwards to
  `McpHiddenText.Find`. `ThrowIfHiddenText` (`ToolDescriptionInspector.cs:25`) collects findings from the
  server instructions, server title and description, then for each tool its name, title, annotation
  title, description, input schema and (when present) output schema, and throws one
  `InvalidOperationException` listing every location (`ToolDescriptionInspector.cs:54`). `Collect`
  (`ToolDescriptionInspector.cs:61`) formats one location; `CollectSchema`
  (`ToolDescriptionInspector.cs:72`) recurses through strings, object property names and values
  (`ToolDescriptionInspector.cs:80`) and array items.
- **Why it's built this way**: a parameter's `[Description]` lands in the generated JSON schema, so every
  property name and string value there is model-visible and is inspected, not only `description` keys
  (`ToolDescriptionInspector.cs:70-71`). Reporting every problem in one exception lets a developer fix
  them all in one pass. Recorded in
  [ADR-138](https://ivanball.github.io/docs/adr/138-mcp-endpoint-over-module-queries.html).
- **Where it's used**: called by `MapCommonMcp` before mapping
  (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHostingExtensions.cs:131`); covered by
  `MMCA.Common/Tests/Presentation/MMCA.Common.Mcp.Tests/ToolDescriptionInspectionTests.cs`.

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
  first short-circuits when `Enabled` is false or `Provider` is blank (`AiProviderValidator.cs:27`,
  deferring to the data-annotation validator so the blank case is reported exactly once, not twice).
  Otherwise it calls the static helper `Match` (`AiProviderValidator.cs:41`), which does a case-insensitive
  `FirstOrDefault` over the factories' `Name`; a hit returns `Success`, a miss calls `DescribeMismatch`
  (`AiProviderValidator.cs:48`) to build the failure text. `DescribeMismatch` branches on whether any
  factory is registered at all (`AiProviderValidator.cs:52`): zero factories means no adapter package is
  referenced, so the message names both adapter packages and their registration calls
  (`AddAnthropicAiProvider()`, `AddOpenAiProvider()`) plus the manual `AddMmcaChatClient` overload
  (`AiProviderValidator.cs:54-57`); one or more factories means the name is simply wrong, so the message
  lists the registered provider names, sorted case-insensitively (`AiProviderValidator.cs:60,62`).
- **Why it's built this way**: `Match` and `DescribeMismatch` are `internal static` (`AiProviderValidator.cs:41,48`)
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
  (`AnthropicAiProviderFactory.cs:48`).
- **Concept**: first concrete example of the factory boundary [`IAiProviderFactory`](#iaiproviderfactory) introduces; see that
  section for the swap-point rationale. Introduces one new idea of its own: `AsIChatClient` is the SDK's
  own `Microsoft.Extensions.AI` adapter, so this factory never hand-rolls the Messages API over
  `HttpClient` (`AnthropicAiProviderFactory.cs:24-25`).
- **Walkthrough**: `Name` returns the `const string ProviderName = "Anthropic"` (`AnthropicAiProviderFactory.cs:17,20`).
  `Create` (`AnthropicAiProviderFactory.cs:33`) null-checks `settings`, builds an SDK `ClientOptions`
  from `ApiKey` and `Timeout` (`AnthropicAiProviderFactory.cs:37-41`), and, when `settings.Endpoint`
  is set, overrides `BaseUrl` (`AnthropicAiProviderFactory.cs:43-46`). It then constructs
  `new AnthropicClient(options).AsIChatClient(settings.Model, settings.MaxOutputTokens)`
  (`AnthropicAiProviderFactory.cs:48`), passing the model and output ceiling as the client's defaults.
- **Why it's built this way**: a `[SuppressMessage("Reliability", "CA2000", ...)]` on `Create`
  (`AnthropicAiProviderFactory.cs:29-32`) documents why the built client is not disposed here: ownership
  passes to the `IChatClient` the pipeline wraps (see [`BoundedChatClient`](#boundedchatclient)), and the DI
  container disposes it with the singleton; disposing in the factory would close the transport before the
  first call. The model and output ceiling passed as SDK defaults are not the last word: `BoundedChatClient`
  still pins and clamps per call (`AnthropicAiProviderFactory.cs:26-27`), because a default is a
  suggestion and a bound is not. Recorded in [ADR-120](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: registered by [`AnthropicAiServiceCollectionExtensions`](#anthropicaiservicecollectionextensions-openaiservicecollectionextensions).`AddAnthropicAiProvider()`; exercised by
  `MMCA.Common/Tests/Core/MMCA.Common.AI.Tests/Providers/AdapterFactoryTests.cs`.

### McpToolGovernance
> MMCA.Common.Mcp · `MMCA.Common.Mcp` · `MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpToolGovernance.cs:20` · Level 2 · class (internal static)

- **What it is**: the per-tool governance applied through the MCP SDK's request filters: `tools/list`
  drops every tool the caller could not call, and `tools/call` refuses a disabled tool, a tool whose
  permission the caller lacks, and a call over the tool's per-minute limit, each as an error result
  rather than an exception (`McpToolGovernance.cs:14-19`).
- **Depends on**: [`McpSettings`](#mcpsettings), [`McpToolSettings`](#mcptoolsettings),
  [`McpToolPermissionAttribute`](#mcptoolpermissionattribute),
  [`McpToolPublicAttribute`](#mcptoolpublicattribute), [`McpToolRateLimiter`](#mcptoolratelimiter),
  [`PermissionPolicy`](group-08-auth.md#permissionpolicy) and the `FindUserIdValue` claim helper from
  `MMCA.Common.Shared.Auth` ([`ClaimsPrincipalExtensions`](group-08-auth.md#claimsprincipalextensions));
  externally `IAuthorizationService`, `IHttpContextAccessor`, `IOptionsMonitor<T>` and the SDK's
  `McpRequestHandler<TParams, TResult>` (`McpToolGovernance.cs:1-10`).
- **Concept introduced, per-tool governance on an anonymous endpoint.** `[Rubric §11, Security]`
  (assesses whether authorization is enforced at every entry point, not only the obvious one): the
  endpoint is anonymous at the HTTP layer, so the filter is where a permissioned tool is hidden and
  refused, using the same `perm:` policy the module's HTTP endpoints use (`McpToolGovernance.cs:128-129`).
  `[Rubric §16, AI-Native Application Architecture]` (assesses whether model-facing failures are shaped
  for a model): a refusal is a tool error result carrying a code, so the model reads it and stops
  instead of retrying blindly (`McpToolGovernance.cs:152-158`).
- **Walkthrough**: `ListTools` (`McpToolGovernance.cs:25`) runs the SDK handler first, reads the current
  [`McpSettings`](#mcpsettings) (`McpToolGovernance.cs:32`), keeps each tool that is enabled and whose
  permission the caller satisfies, and marks the result `CacheScope.Private` because the list now
  depends on who asked (`McpToolGovernance.cs:46-47`). `CallTool` (`McpToolGovernance.cs:54`) checks in
  order: enabled, else `Mcp.ToolUnavailable` (`McpToolGovernance.cs:65`); permitted, else
  `Mcp.Forbidden` (`McpToolGovernance.cs:71`); within `PermitsPerMinute` when set, else `Mcp.RateLimited`
  (`McpToolGovernance.cs:76-80`); then calls the SDK handler. `ThrowIfAccessUndeclared`
  (`McpToolGovernance.cs:95`) lists, sorted ordinally, every registered tool carrying neither access
  attribute and throws (`McpToolGovernance.cs:108`). Helpers: `IsEnabled` treats a missing entry as
  enabled (`McpToolGovernance.cs:114`); `FindPermission` uses the matched primitive or looks the tool up
  by name (`McpToolGovernance.cs:117-125`); `IsPermittedAsync` admits anyone when there is no permission,
  refuses an unauthenticated caller, otherwise authorizes against `PermissionPolicy.NameFor(permission)`
  (`McpToolGovernance.cs:130-143`); `CallerKey` uses the user id, else the client IP, else `"anonymous"`
  (`McpToolGovernance.cs:147-150`).
- **Why it's built this way**: settings are read through `IOptionsMonitor` per request, so disabling a
  tool or changing its limit takes effect on reload without a restart. Filtering the list and refusing
  the call share `IsEnabled` and `IsPermittedAsync`, so a tool a caller cannot see is also one the
  caller cannot call. Recorded in
  [ADR-138](https://ivanball.github.io/docs/adr/138-mcp-endpoint-over-module-queries.html).
- **Where it's used**: wired by `AddCommonMcpServer` as the list and call filters
  (`MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHostingExtensions.cs:81-82`), and
  `ThrowIfAccessUndeclared` runs in `MapCommonMcp` (`McpHostingExtensions.cs:132`); covered by
  `MMCA.Common/Tests/Presentation/MMCA.Common.Mcp.Tests/McpGovernanceTests.cs`.
- **Caveats / not-in-source**: an anonymous caller of a rate-limited tool behind a proxy that hides the
  client IP falls into the shared `"anonymous"` partition (`McpToolGovernance.cs:150`); whether a host's
  forwarded-headers setup prevents that is not determinable from this file.

### McpHostingExtensions
> MMCA.Common.Mcp · `MMCA.Common.Mcp` · `MMCA.Common/Source/Presentation/MMCA.Common.Mcp/McpHostingExtensions.cs:38` · Level 6 · class (static, `extension(T)` blocks)

- **What it is**: the two consumer calls that opt a host into the Model Context Protocol (MCP) endpoint,
  `builder.AddCommonMcpServer(...)` and `app.MapCommonMcp()`; both do nothing unless `Mcp:Enabled` is
  true (`McpHostingExtensions.cs:15-19`).
- **Depends on**: [`CommonMcpOptions`](#commonmcpoptions), [`McpSettings`](#mcpsettings),
  [`McpToolRateLimiter`](#mcptoolratelimiter), [`McpEnabledMarker`](#mcpenabledmarker),
  [`McpToolGovernance`](#mcptoolgovernance), [`ToolDescriptionInspector`](#tooldescriptioninspector),
  [`WebApplicationBuilderExtensions`](group-12-api-hosting-mapping.md#webapplicationbuilderextensions)
  (for the `mcp` rate-limit policy name); externally the `ModelContextProtocol.AspNetCore` SDK
  (`McpHostingExtensions.cs:10-11`).
- **Concept introduced, an MCP endpoint over module queries.** `[Rubric §16, AI-Native Application
  Architecture]` (assesses whether the system exposes governed, model-consumable capabilities): tools are
  static `[McpServerToolType]` classes in a module's API project that inject the same query handler the
  HTTP endpoint injects, so the decorator pipeline applies to a tool call exactly as to a request
  (`McpHostingExtensions.cs:21-26`). `[Rubric §13, Observability & Operability]`: misconfiguration fails
  at startup, not on the first call. Registration uses `extension(T)` blocks (see
  [C# `extension(T)` types, read this once](00-primer.md#c-extensiont-types--read-this-once)). Recorded in
  [ADR-138](https://ivanball.github.io/docs/adr/138-mcp-endpoint-over-module-queries.html).
- **Walkthrough**: `DefaultPath = "/mcp"` (`McpHostingExtensions.cs:41`). `AddCommonMcpServer`
  (`McpHostingExtensions.cs:52`) always binds [`McpSettings`](#mcpsettings) with a `ValidateOnStart` rule
  that a set `PermitsPerMinute` is 1 or more (`McpHostingExtensions.cs:57-63`); if `Enabled` is false it
  returns there. Otherwise it runs the host's callback (`McpHostingExtensions.cs:71`), registers the
  HTTP context accessor, the rate limiter and the marker (`McpHostingExtensions.cs:73-75`), and adds the
  MCP server with stateless streamable HTTP, the two governance filters and the selected tools
  (`McpHostingExtensions.cs:77-92`). `MapCommonMcp` (`McpHostingExtensions.cs:114`) returns without
  mapping when the marker is absent, unless `Mcp:Enabled` is true, in which case it throws because
  registration was skipped (`McpHostingExtensions.cs:119-124`). It then runs the hidden-text and
  access-declaration checks (`McpHostingExtensions.cs:131-132`) and maps the endpoint with
  `AllowAnonymous()` and the `mcp` rate-limit policy (`McpHostingExtensions.cs:134-136`;
  `RateLimitPolicyMcp = "mcp"` at
  `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:57`).
- **Why it's built this way**: the tool types are passed as `(IEnumerable<Type>)` explicitly, because
  passing the `IList<Type>` straight through binds the SDK's `WithTools<TTarget>(target)` overload and
  registers the list itself as a tool target (`McpHostingExtensions.cs:85-87`). The endpoint is anonymous
  at the HTTP layer so a public tool needs no token, and the host's `UseAuthentication` must run first so
  permissioned tools see the signed-in caller (`McpHostingExtensions.cs:28-31`). Stateless sessions
  (`McpHostingExtensions.cs:78`) keep no per-session server state, so any replica can serve any request.
  The rate-limit layering follows [ADR-019](https://ivanball.github.io/docs/adr/019-rate-limiting.html)
  and the startup validation [ADR-070](https://ivanball.github.io/docs/adr/070-fail-fast-configuration-contract.html).
- **Where it's used**: the ADC Conference service registers
  [`ConferenceMcpTools`](group-20-conference-api-grpc.md#conferencemcptools) and maps the endpoint
  (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:368,379`); exercised by
  `MMCA.Common/Tests/Presentation/MMCA.Common.Mcp.Tests/McpTestHost.cs` and `McpGovernanceTests.cs`.
- **Caveats / not-in-source**: whether `Mcp:Enabled` is true in any deployed ADC environment is
  configuration, not determinable from source.

### OpenAiProviderFactory
> MMCA.Common.AI.OpenAI · `MMCA.Common.AI.OpenAI` · `MMCA.Common/Source/Core/MMCA.Common.AI.OpenAI/OpenAiProviderFactory.cs:18` · Level 2 · class

- **What it is**: the [`IAiProviderFactory`](#iaiproviderfactory) implementation for OpenAI, selected when `Ai:Provider`
  equals `OpenAI` (`ProviderName`, `OpenAiProviderFactory.cs:20`).
- **Depends on**: [`IAiProviderFactory`](#iaiproviderfactory), [`AiSettings`](#aisettings); externally, `OpenAI`'s `OpenAIClient`,
  `OpenAIClientOptions`, `System.ClientModel.ApiKeyCredential`, and `Microsoft.Extensions.AI`'s
  `AsIChatClient` (`OpenAiProviderFactory.cs:49-51`).
- **Concept**: same factory-boundary role as [`AnthropicAiProviderFactory`](#anthropicaiproviderfactory) (see [`IAiProviderFactory`](#iaiproviderfactory) for the
  shared rationale). Differs in one behavior worth flagging on its own: the OpenAI client binds its
  model at construction time, not per call (`OpenAiProviderFactory.cs:28-31`).
- **Walkthrough**: `Name` returns the `const string ProviderName = "OpenAI"` (`OpenAiProviderFactory.cs:21,24`).
  `Create` (`OpenAiProviderFactory.cs:33`) null-checks `settings`, then requires both `Model`
  (`OpenAiProviderFactory.cs:37-38`) and `ApiKey` (`OpenAiProviderFactory.cs:39-40`) with an
  `InvalidOperationException` naming the missing `Ai:` setting when either is absent, unlike Anthropic's
  factory, which tolerates a null model. It builds `OpenAIClientOptions` from `Timeout`
  (`OpenAiProviderFactory.cs:42`), applies `Endpoint` when set (`OpenAiProviderFactory.cs:44-47`), and
  returns `new OpenAIClient(new ApiKeyCredential(apiKey), options).GetChatClient(model).AsIChatClient()`
  (`OpenAiProviderFactory.cs:49-51`).
- **Why it's built this way**: because the SDK binds the model at construction, the pinned model is the
  only one every request can go to; [`BoundedChatClient`](#boundedchatclient) refuses a request naming any other model
  (`OpenAiProviderFactory.cs:28-31`), which keeps a [`PromptContract`](#promptcontract)'s model assertion meaningful here the
  same way it is on adapters (Anthropic's) that honor a per-request override. The eager
  `InvalidOperationException` on a missing model or key fails at first `Create` call rather than deeper
  inside the SDK. Recorded in [ADR-120](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Where it's used**: registered by [`OpenAiServiceCollectionExtensions`](#anthropicaiservicecollectionextensions-openaiservicecollectionextensions).`AddOpenAiProvider()`; exercised by
  `MMCA.Common/Tests/Core/MMCA.Common.AI.Tests/Providers/AdapterFactoryTests.cs`.


---
[⬅ Device Capability Abstraction Layer (Native Contracts, MAUI, Browser & Fallback Adapters)](group-26-device-capability-layer.md)  •  [Index](00-index.md)  •  [Common Cloud Provider Adapters (AWS, Azure, GCP) ➡](group-28-common-cloud-provider-adapters.md)
