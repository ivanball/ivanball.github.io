# 19. ADC Conference - Infrastructure & Persistence

**What this chapter covers.** This is the **adapter** layer of the Conference module, the place where
the engine-agnostic domain meets concrete technology. Three concerns live here: (1) **persistence
mapping**, the EF Core entity configurations that turn plain domain classes into SQL Server tables,
the abstract `DbContext` that declares the module's `DbSet`s, and the seeder that puts the real
conference event and feedback questions into a fresh database; (2) **outbound integration services**,
the HTTP clients that talk to **Sessionize** (the conference's session-submission platform) and to the
**Anthropic Claude API** (the AI session scorer); and (3) the **DI wiring** that registers those
services with the right resilience policy. It is the per-module realization of Clean Architecture's
"ports and adapters" idea: the [Application](group-18-conference-application.md) layer declares the
ports ([`ISessionizeService`](group-18-conference-application.md#isessionizeservice),
[`IAiScoringService`](group-18-conference-application.md#iaiscoringservice)), and this Infrastructure
layer supplies the adapters. `[Rubric §3, Clean Architecture]` assesses whether dependencies point
inward and the domain stays framework-free; here every EF/HTTP/Anthropic concern is quarantined in
Infrastructure, so the domain entities in [Group 17](group-17-conference-domain.md) carry no
persistence or transport attribute at all.

## Engine-agnostic entities, engine chosen by the config base class

The most important idea in this chapter is one the entities themselves never express: **what storage
engine each entity uses is decided here, not in the domain.** A Conference domain entity, `Session`,
`Speaker`, `Event`, `Room`, the join entities, is a plain class. The *only* thing that binds it to SQL
Server is which base class its configuration inherits from. Every config in this group
([`SessionConfiguration`](group-19-conference-infrastructure.md#sessionconfiguration),
[`SpeakerConfiguration`](group-19-conference-infrastructure.md#speakerconfiguration),
[`EventConfiguration`](group-19-conference-infrastructure.md#eventconfiguration), and the rest)
derives from
[`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype),
which itself sits on the engine-neutral
[`EntityTypeConfigurationBase<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationbasetentity-tidentifiertype)
in the Common framework. That base carries the `[UseDataSource(SQLServer)]` marker the
`EntityDataSourceRegistry` reads to decide which physical `DbContext` an entity is built into. Swapping
just that one base class would re-point the same `Session` to Cosmos or SQLite with zero change to the
domain, the application handlers, or the entity, this is the per-entity half of the
**database-per-service** strategy (ADR-006). In practice all 15 Conference configs use the `…SQLServer`
base (the primer's adoption note explains why Cosmos/SQLite are supported-but-dormant seams).
`[Rubric §8, Data Architecture]` (deliberate persistence: transactions, migrations, soft-delete,
audit, concurrency) is the dominant lens for the whole persistence half of this chapter.

## Each config inherits the cross-cutting behavior, then adds entity specifics

Every configuration's `Configure` method begins with `base.Configure(builder)` (e.g.
`SessionConfiguration.cs:18`) and *then* adds its own mappings. That one `base` call is where the
framework injects the conventions you'll see applied uniformly: the strongly-typed key, the
soft-delete `IsDeleted` shadow handling, the audit columns, and a `rowversion` concurrency token,
none of which any individual config re-states. The per-entity bodies then declare what is unique:
column lengths sourced from the domain's invariant constants (`SessionInvariants.TitleMaxLength`,
`EventInvariants.NameMaxLength`), required/optional flags, computed properties excluded with
`builder.Ignore(...)` (e.g. `Session.Duration`, `SessionConfiguration.cs:67`), and **filtered unique
indexes** that scope uniqueness to non-deleted rows, `HasFilter("[IsDeleted] = 0")` appears on the
`SessionSpeaker` (Session, Speaker) pair, the one-score-per-`Session` index on `SessionAiScore`, and
others, so soft-deleted rows don't block a re-insert. A couple of configs carry a deliberate quirk
worth knowing: [`ConferenceCategoryConfiguration`](group-19-conference-infrastructure.md#conferencecategoryconfiguration)
calls `ToTable("Category", "Conference")` explicitly (`ConferenceCategoryConfiguration.cs:24`) so the
Conference `Category` table doesn't collide with another module's `Category`, and
[`SessionConfiguration`](group-19-conference-infrastructure.md#sessionconfiguration) maps the
`Session→Room` relationship with `OnDelete(DeleteBehavior.Restrict)` so deleting a room can't cascade
sessions away.

## DbSets and the DbContext shape

[`ModuleApplicationDbContext`](group-19-conference-infrastructure.md#moduleapplicationdbcontext) is the
Conference module's abstract `DbContext`. It does one job: declare the `DbSet<T>` for every Conference
entity, `Events`, `Rooms`, `Sessions`, `Speakers`, the four join entities, `Categories`,
`CategoryItems`, `Questions`, and the answer tables. It is **abstract** and inherits from the Common
[`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext), from which it gets the
real machinery: the `SaveChangesAsync` override that stamps audit fields, applies soft-delete, captures
domain events into the outbox, and the global query filters that hide deleted rows. The concrete class
that EF actually instantiates is the single
[`SQLServerDbContext`](group-07-persistence-ef-core.md#sqlserverdbcontext) in the Common framework,
**one concrete context class, one instance per database** (ADR-006). The codebase deliberately does
**not** split into per-module context classes; `ModuleApplicationDbContext` exists only to declare the
module's `DbSet`s and discover its configurations, not to be a second concrete context. This is the
per-database half of database-per-service: the Conference service owns the `ADC_Conference` database
and its own `dbo.OutboxMessages`, so it never races another service for outbox rows.
`[Rubric §7, Microservices Readiness]` (can a module become its own service without a rewrite?) is
embodied here, the Conference module already runs as `MMCA.ADC.Conference.Service` over its own DB,
and cross-module references (a speaker's linked user, a bookmark's session) are scalar columns resolved
via gRPC + integration events, never cross-database foreign keys.

## Seeding: real data always, sample data only in dev/CI

[`ConferenceModuleDbSeeder`](group-19-conference-infrastructure.md#conferencemoduledbseeder) is run
after schema initialization (invoked from the module's `SeedAsync`, wired in the API layer's
`ConferenceModuleSeeder`). It is idempotent, every seed step first does an `ExistsAsync` check and
returns early if the row is already present, so it is safe to run on every startup, which is exactly
how production's `"Migrate"` database-init strategy uses it. It always seeds two things: the real
**Atlanta Cloud + AI Conference** `Event` (date, venue, time zone, and the `SessionizeCode` that links
the event to its Sessionize submission, `ConferenceModuleDbSeeder.cs:52-62`) and the fixed set of
**feedback `Question`s** (session ratings + conference ratings, using a reserved manual-ID range so
they never collide with imported data). It conditionally seeds two sample **`Speaker`s** and two sample
**`Session`s** *only* when `Seeding:IncludeSampleConferenceData=true`, a flag set by the local Aspire
AppHost and the E2E CI workflow but left unset in production. The reason is concrete and documented in
the seeder's own remarks (`ConferenceModuleDbSeeder.cs:14-21`): the public-browse E2E tests need at
least one session and one speaker row to exist deterministically, while production's real sessions and
speakers arrive through the Sessionize import, not the seeder. This is the seam that the
`ConferenceModuleDbSeederTests` in [Group 25](group-27-testing-infrastructure.md) exercise.

## The Sessionize adapter

[`SessionizeService`](group-19-conference-infrastructure.md#sessionizeservice) is a deliberately thin
HTTP client (the whole class is ~25 lines): given a Sessionize event code, it `GET`s the platform's
"View All" endpoint and deserializes the JSON into the `SessionizeResponse` model owned by the
Application layer. It implements [`ISessionizeService`](group-18-conference-application.md#isessionizeservice)
and is registered as a **typed `HttpClient`** in
[`DependencyInjection`](group-19-conference-infrastructure.md#dependencyinjection)
(`DependencyInjection.cs:23-24`) with the Sessionize base address baked in. Because it is registered
via `AddHttpClient<,>`, it automatically inherits the standard Aspire resilience handler (Polly
retry/timeout/circuit-breaker) configured in `ServiceDefaults`, `[Rubric §29, Resilience]`, the
ADR-009 policy that every outbound client gets resilience by default. The thinness is intentional:
parsing, mapping, and the actual import workflow live in Application use-cases; this adapter only owns
the wire call.

## The Anthropic AI scoring adapter

[`AnthropicScoringService`](group-19-conference-infrastructure.md#anthropicscoringservice) is the
richer of the two adapters, it scores a single session proposal against a Program-Committee rubric
using the **Anthropic Claude Messages API**. It implements
[`IAiScoringService`](group-18-conference-application.md#iaiscoringservice), exposes the model id it
uses (`claude-haiku-4-5-20251001`, `AnthropicScoringService.cs:21`), reads the API key from
configuration (`Anthropic:ApiKey`, expected in user secrets), and, importantly, **never throws**:
every failure path (missing key, non-2xx response, empty body, deserialization failure, any exception)
funnels into a `FailedResult` carrying zero scores and `Success = false`. That non-throwing contract
matters because scoring runs in batches and a single bad proposal must not abort the batch. The wire
shapes are the small private records grouped in this chapter,
[`AnthropicRequest`](group-19-conference-infrastructure.md#anthropicrequest),
[`AnthropicMessage`](group-19-conference-infrastructure.md#anthropicmessage),
[`AnthropicResponse`](group-19-conference-infrastructure.md#anthropicresponse),
[`AnthropicContentBlock`](group-19-conference-infrastructure.md#anthropiccontentblock), and
[`AiScoreResponse`](group-19-conference-infrastructure.md#aiscoreresponse) (the JSON the model is
prompted to return, parsed by locating the `{...}` span in the response text). The prompt is built
inline (`BuildPrompt`), the speaker block is formatted with `CultureInfo.InvariantCulture` to stay
culture-deterministic (`AnthropicScoringService.cs:145`, the §27 invariant-formatting point the primer
flags), and each returned score is clamped to `[1.0, 10.0]` with banker's rounding before it becomes a
`SessionScoringResult`. `[Rubric §11, Security]` shows up in the obvious place, the API key is a
configuration secret, never hard-coded, and `[Rubric §13, Observability]` in the `[LoggerMessage]`
source-generated warning that records every scoring failure with the session id and reason.

## DI wiring and a deliberate resilience override

[`DependencyInjection`](group-19-conference-infrastructure.md#dependencyinjection) is a single
`extension(IServiceCollection)` block (the codebase's standard DI-registration idiom, taught in the
primer) exposing `AddModuleConferenceInfrastructure()`. It registers both adapters as typed HTTP
clients, but the Anthropic client gets a **custom resilience policy**: it calls
`RemoveAllResilienceHandlers()` and re-adds a `StandardResilienceHandler` with much longer timeouts,
a 3-minute attempt timeout, a 5-minute total request timeout, a 7-minute circuit-breaker sampling
window, and only **one** retry (`DependencyInjection.cs:35-42`). The inline comment explains why: AI
scoring of a large batch can take several minutes, which would blow through Aspire's default 30s/90s
limits, and retrying an expensive LLM call aggressively is wasteful. This is a precise illustration of
the resilience story from ADR-009, every outbound client is resilient by default, but a client with
genuinely different latency characteristics tunes the policy rather than disabling it. The Sessionize
client, by contrast, takes the defaults unchanged.

## How it fits together at runtime

Two flows tie the chapter together. **Persistence flow:** a Conference command handler mutates an
aggregate and calls `SaveChangesAsync` on the unit of work; that resolves the concrete
`SQLServerDbContext` over the `ADC_Conference` database, which applies the configurations registered
here (lengths, indexes, relationships), stamps audit fields, soft-deletes via global filters, and
captures any domain events into the per-database outbox, all in one transaction. **Integration flow:**
an organizer triggers a Sessionize refresh or an AI-scoring run; the Application use-case calls the
port, the typed `HttpClient` adapter here makes the outbound call wrapped in its (default or tuned)
Polly pipeline, and the result flows back as either a parsed `SessionizeResponse` or a
`SessionScoringResult`, never an unhandled exception in the AI case. The two
[`AssemblyReference`](group-19-conference-infrastructure.md#assemblyreference) /
[`ClassReference`](group-19-conference-infrastructure.md#classreference) marker types in this assembly
exist purely so the module loader and Scrutor can scan this assembly to discover the configurations,
seeder, and services without a hard-coded type list, the same scanning seam every module assembly
provides.

### AiScoreResponse, AnthropicContentBlock, AnthropicMessage

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Services` · Level 0 · record (sealed, private)

Three `private sealed record` types nested inside [`AnthropicScoringService`](#anthropicscoringservice) that model the Anthropic Messages API wire shapes. They are invisible outside that class, the encapsulation point that keeps the AI vendor's JSON contract from leaking past the Infrastructure layer.

| Type | File:Line | Purpose |
|------|-----------|---------|
| `AiScoreResponse` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:215` | The score JSON the model is prompted to return: `overall`, `topic_relevance`, `description_quality`, `novelty`, `actionable_takeaways`, `depth_or_insight_quality`, `credibility_experience` (all `decimal`), plus `reasoning` (`string?`) |
| `AnthropicContentBlock` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:206` | One block from the response `content` array: `type` (`"text"`) + `text`, both nullable |
| `AnthropicMessage` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:191` | One conversation message: `required` `role` (`"user"`) + `required` `content` (the prompt) |

- **What they are**: passive serialization records. `AnthropicMessage` is the request-side payload (one user-role message carrying the prompt); `AnthropicContentBlock` is one element of the response's `content` array; `AiScoreResponse` is the structured score the JSON body inside the chosen text block deserializes to.
- **Depends on**: no first-party types. External: `System.Text.Json.Serialization.JsonPropertyName` only.
- **Concept introduced, anti-corruption serialization records at the edge.** `[Rubric §3, Clean Architecture]` (assesses whether external contracts stay out of inner layers): the vendor's snake_case envelope (`max_tokens`, `topic_relevance`, …) is named on these records via `[JsonPropertyName]` and **nowhere else**: the Application layer sees only [`SessionScoringResult`](group-18-conference-application.md#sessionscoringresult), never an Anthropic type. `[Rubric §32, Dependency & Supply-Chain]` (assesses how a third-party API dependency is isolated): if Anthropic reshapes its envelope, as it has before, only this one file changes.
- **Walkthrough**: `AnthropicMessage` uses `required string Role`/`required string Content` (`:193-197`) so a message can't be half-built. `AnthropicContentBlock` keeps `Type`/`Text` nullable (`:209-212`) because a response block may carry a non-text type. `AiScoreResponse`'s eight properties (`:217-239`) map the snake_case keys the prompt instructs Claude to emit; `Reasoning` is the only nullable one. The deserialization is case-insensitive (`JsonOptions`, `AnthropicScoringService.cs:173`), so casing drift in the model output is tolerated.
- **Why it's built this way**: nesting all three as private inner records of the adapter (rather than public DTOs) makes them an implementation detail of the one class that talks HTTP. Records give value semantics and concise `init` properties for what are pure data carriers.
- **Where it's used**: [`AnthropicScoringService`](#anthropicscoringservice) only: `AnthropicMessage` inside the request, `AnthropicContentBlock` when scanning the response `content` list for the `"text"` block, `AiScoreResponse` when parsing that block's JSON body into per-criterion scores.

---

### AssemblyReference, ClassReference

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:5` · Level 0 · class (static) + class

The assembly-marker pair for the Conference Infrastructure assembly. No behavior, a stable `typeof()` handle for reflection-based scanning.

| Type | File:Line | Notes |
|------|-----------|-------|
| `AssemblyReference` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:5` | `static class` exposing `Assembly` and `AssemblyName` |
| `ClassReference` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:11` | Empty non-static class; a `typeof(ClassReference)` token for `Add…(typeof(...))` registration calls |

- **What it is**: the same two-type marker pattern every layer of every module repeats. `AssemblyReference.Assembly` returns `typeof(AssemblyReference).Assembly` and `AssemblyName` its simple name (`:7-8`); `ClassReference` is an empty class used purely as a generic/`typeof` anchor.
- **Depends on**: `System.Reflection` only. No first-party types.
- **Concept introduced**: cross-reference the framework explanation under [AssemblyReference / ClassReference (Conference.Domain)](group-17-conference-domain.md#assemblyreference--classreference-conferencedomain); identical structure, different assembly.
- **Walkthrough**: omitted; structurally identical to every other layer's marker pair.
- **Why it's built this way**: uniformity: Scrutor assembly scanning (EF entity configurations, DTO/request mappers, handlers) and `ModuleLoader` DI wiring all take a stable per-assembly handle, so each assembly ships one.
- **Where it's used**: Conference module DI registration and EF `IEntityTypeConfiguration` discovery scan this assembly via these markers.

---

### AnthropicRequest, AnthropicResponse

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Services` · Level 1 · record (sealed, private)

The two top-level request/response envelopes for the Anthropic Messages call, one rung above the leaf records because they compose them.

| Type | File:Line | Notes |
|------|-----------|-------|
| `AnthropicRequest` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:179` | Request body: `required` `Model` (`model`), `required` `MaxTokens` (`max_tokens`), `required List<AnthropicMessage> Messages` (`messages`) |
| `AnthropicResponse` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:200` | Response body: a nullable `List<AnthropicContentBlock>? Content` (`content`) |

- **What they are**: the outer wire shapes. `AnthropicRequest` is what gets POSTed (model id + token cap + the message list); `AnthropicResponse` is the deserialized reply, whose `Content` is the list of [`AnthropicContentBlock`](#aiscoreresponse-anthropiccontentblock-anthropicmessage) the adapter scans for the `"text"` block.
- **Depends on**: first-party: [`AnthropicMessage`](#aiscoreresponse-anthropiccontentblock-anthropicmessage) (composed in `Messages`), [`AnthropicContentBlock`](#aiscoreresponse-anthropiccontentblock-anthropicmessage) (composed in `Content`). External: `System.Text.Json.Serialization`.
- **Concept introduced**: cross-reference the anti-corruption record concept taught under [AiScoreResponse, AnthropicContentBlock, AnthropicMessage](#aiscoreresponse-anthropiccontentblock-anthropicmessage); these are the composite layer of the same private envelope set.
- **Walkthrough**: `AnthropicRequest`'s three properties are all `required` (`:181-188`) so the request can't be partially constructed; `MaxTokens` is set to `256` at the call site (`AnthropicScoringService.cs:42`) to bound cost and latency. `AnthropicResponse.Content` is nullable (`:202-203`) because a malformed/empty reply must deserialize without throwing, the adapter then falls through to a failed result.
- **Why it's built this way**: same encapsulation rationale as the leaf records: keep the Anthropic JSON shape private to the adapter. `required` on the request and nullable on the response mirror the asymmetry between "we control what we send" and "we must defensively parse what we get back".
- **Where it's used**: [`AnthropicScoringService.ScoreSessionAsync`](#anthropicscoringservice): builds an `AnthropicRequest`, deserializes the body to `AnthropicResponse`.

---

### AnthropicScoringService

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:15` · Level 3 · class (sealed partial)

- **What it is**: the concrete adapter implementing [`IAiScoringService`](group-18-conference-application.md#iaiscoringservice) by calling the **Anthropic Claude Messages API** (model `claude-haiku-4-5-20251001`, `:21`) to score one session proposal against a Program-Committee rubric. Like its port, **it never throws**, every failure becomes a failed `SessionScoringResult`.
- **Depends on**: first-party: [`IAiScoringService`](group-18-conference-application.md#iaiscoringservice) (implements), [`SessionScoringInput`](group-18-conference-application.md#sessionscoringinput), [`SessionScoringResult`](group-18-conference-application.md#sessionscoringresult), [`SpeakerInfo`](group-18-conference-application.md#speakerinfo) (the Application decision-support types), and its own private records [`AnthropicRequest`](#anthropicrequest-anthropicresponse)/[`AnthropicMessage`](#aiscoreresponse-anthropiccontentblock-anthropicmessage)/[`AnthropicResponse`](#anthropicrequest-anthropicresponse)/[`AnthropicContentBlock`](#aiscoreresponse-anthropiccontentblock-anthropicmessage)/[`AiScoreResponse`](#aiscoreresponse-anthropiccontentblock-anthropicmessage). External: `HttpClient`, `IConfiguration`, `ILogger<T>`, `System.Text.Json`, `System.Globalization`.
- **Concept introduced, the adapter that keeps an SDK/HTTP dependency at the edge.** `[Rubric §3, Clean Architecture]` / `[Rubric §1, SOLID, DIP]` (assess whether the inner layers depend on abstractions, not vendors): all Anthropic HTTP and JSON detail lives here in Infrastructure, behind the Application's port. `[Rubric §11, Security]` (assesses secrets handling): the API key is read from configuration (`Anthropic:ApiKey`, sourced from user secrets, `:28`) and sent as the `x-api-key` header, never hard-coded or logged. `[Rubric §13, Observability]` (assesses structured, low-cost logging): failures go through a source-generated `[LoggerMessage]` warning (`:175-176`). `[Rubric §29, Resilience]` (assesses graceful degradation): every failure path, missing key, non-2xx, empty body, any exception, funnels into `FailedResult` (`:31-33`, `:51-56`, `:62-66`, `:70-74`) so one session's API failure can't abort a batch. `[Rubric §12, Performance]` (assesses cost/latency bounds): `MaxTokens = 256` (`:42`) caps the response. `[Rubric §27, i18n]` (assesses culture-correctness): speaker formatting uses `CultureInfo.InvariantCulture` (`:145-150`) so prompt text never varies by server locale.
- **Walkthrough**
  - A **primary constructor** injects `HttpClient`, `IConfiguration`, `ILogger<AnthropicScoringService>` (`:15-18`); the class is `sealed partial` because `[LoggerMessage]` generates the partial method body.
  - `ModelId` (`:21`) is a fixed string the port exposes so callers can record which model produced a score.
  - `ScoreSessionAsync` (`:24`) guards on a missing key first (`:28-33`), builds the reviewer prompt via `BuildPrompt` (`:37`, `:106`, a weighted six-criterion ADC rubric with explicit scoring rules and penalties), assembles an [`AnthropicRequest`](#anthropicrequest-anthropicresponse) carrying one [`AnthropicMessage`](#aiscoreresponse-anthropiccontentblock-anthropicmessage) (`:39-44`), POSTs to the relative `v1/messages` with the `x-api-key` header (`:46-48`), and on a non-success status logs the body and returns `FailedResult` (`:51-56`).
  - On success it deserializes the body to [`AnthropicResponse`](#anthropicrequest-anthropicresponse), `Find`s the first `"text"` block (`:58-60`), and hands the text to `ParseSingleScore` (`:68`, `:77`), which extracts the `{…}` substring (`:80-85`), deserializes it to [`AiScoreResponse`](#aiscoreresponse-anthropiccontentblock-anthropicmessage), and `Clamp`s every score to `1.0–10.0` with banker's rounding to one decimal (`:94-100`, `:156`) before producing a successful `SessionScoringResult`.
  - `FormatSpeakers` (`:135`) builds the speaker block from [`SpeakerInfo`](group-18-conference-application.md#speakerinfo) using `InvariantCulture`; `JsonOptions` (`:173`) enables case-insensitive matching.
- **Why it's built this way**: concentrating the vendor specifics here makes swapping AI providers (or mocking in tests) a one-class change behind the port; the never-throw + clamp discipline makes raw model output safe to persist. The prompt is deliberately prescriptive ("respond with ONLY a JSON object") so the response reliably parses.
- **Where it's used**: registered as the `IAiScoringService` implementation by [`DependencyInjection`](#dependencyinjection) (with custom resilience timeouts for the long batch call); driven by the ScoreEventSessions command handler in [Conference Application](group-18-conference-application.md).
- **Caveats / not-in-source**: behavior depends on Anthropic returning parseable JSON; malformed output falls through to `FailedResult`. There is **no retry inside this class**, the retry/timeout policy is configured externally on the `HttpClient` in [`DependencyInjection`](#dependencyinjection), and the in-class resilience contract is "never throw + let the batch continue", not internal retries.

---

### SessionizeService

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Services/SessionizeService.cs:10` · Level 4 · class (sealed)

- **What it is**: the HTTP-client implementation of [`ISessionizeService`](group-18-conference-application.md#isessionizeservice): it calls the Sessionize "View All" API to retrieve every session/speaker/room/category for a conference in one document.
- **Depends on**: first-party: [`ISessionizeService`](group-18-conference-application.md#isessionizeservice) (implements), [`SessionizeResponse`](group-18-conference-application.md#sessionizeresponse) (return shape). External: `HttpClient`, `System.Net.Http.Json`.
- **Concept**: `[Rubric §2, Design Patterns]` / `[Rubric §1, SOLID, DIP]` (assess inversion of control): the Application defines `ISessionizeService`; Infrastructure provides the HTTP adapter, so the Application layer never references `HttpClient`. The implementation is intentionally minimal, a primary-constructor `HttpClient` (registered as a **typed client** in [`DependencyInjection`](#dependencyinjection), so the base URL and Polly pipeline are configured once), a `GetAsync` to `{sessionizeCode}/view/All` relative to the base URL (`:15-18`), and `ReadFromJsonAsync<SessionizeResponse>` (`:22-24`). All awaits use `.ConfigureAwait(false)`.
- **Caveat, error handling differs from the AI adapter.** `response.EnsureSuccessStatusCode()` (`:20`) converts an HTTP error into an `HttpRequestException` that **propagates** uncaught, unlike [`AnthropicScoringService`](#anthropicscoringservice)'s never-throw contract. The calling handler treats a thrown Sessionize failure as a non-domain error (mapped to a 5xx/Problem Details upstream), which is acceptable because a sync is an explicit organizer action, not a per-item batch.
- **Where it's used**: called by the Sessionize-sync command handler in [Conference Application](group-18-conference-application.md) when an organizer triggers a data refresh (gated behind the `Conference.SessionizeIntegration` feature flag).

---

### DependencyInjection

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:12` · Level 5 · class (static)

- **What it is**: the DI wiring for Conference Infrastructure: it registers the two outbound HTTP integrations, the Sessionize client and the Anthropic AI-scoring client, as typed `HttpClient`s.
- **Depends on**: first-party: [`ISessionizeService`](group-18-conference-application.md#isessionizeservice)/[`SessionizeService`](#sessionizeservice), [`IAiScoringService`](group-18-conference-application.md#iaiscoringservice)/[`AnthropicScoringService`](#anthropicscoringservice). External: `Microsoft.Extensions.DependencyInjection`, `Microsoft.Extensions.Http.Resilience` (Polly).
- **Concept introduced, custom resilience configuration for slow external APIs.** `[Rubric §29, Resilience]` (assesses ADR-009: a resilience handler on every outbound client). The Sessionize client (`:23-24`) is a plain `AddHttpClient<IService, Impl>` with a base address, inheriting the Aspire standard resilience handler. The Anthropic client (`:29-42`) is the interesting case: AI batch scoring can take **minutes**, so the code calls `RemoveAllResilienceHandlers()` and then `AddStandardResilienceHandler` with hand-tuned timeouts, this is the correct pattern when the Aspire default (30s attempt / 90s total) is too short. The inline comment (`:26-27`) documents *why* the defaults are removed.
- **Walkthrough**: a single `extension(IServiceCollection services)` block (`:14`) exposes `AddModuleConferenceInfrastructure()` (`:20`). Sessionize (`:22-24`): typed client with `https://sessionize.com/api/v2/` base. Anthropic (`:28-42`): base `https://api.anthropic.com/`, an `anthropic-version: 2023-06-01` header (`:32`), a 5-minute `HttpClient.Timeout` (`:33`), then `.RemoveAllResilienceHandlers().AddStandardResilienceHandler(...)` configuring a 3-minute attempt timeout (`:38`), a 7-minute circuit-breaker sampling window (`:39`), a 5-minute total-request timeout (`:40`), and `MaxRetryAttempts = 1` (`:41`), a deliberate "one retry only" for an expensive non-idempotent batch. Returns `services` for chaining (`:44`).
- **Why it's built this way**: registering both integrations as typed clients centralizes base URL, default headers, and the resilience pipeline so the service classes stay thin (see [`SessionizeService`](#sessionizeservice), [`AnthropicScoringService`](#anthropicscoringservice)). The C# `extension(IServiceCollection)` member (see the primer's [`extension(T)` note](00-primer.md#c-extensiont-types--read-this-once)) keeps the registration call site readable: `services.AddModuleConferenceInfrastructure()`.
- **Where it's used**: invoked from the Conference module's top-level registration (the module `IModule.Register`/`AddModuleConference…` chain in [Conference API & module composition](group-20-conference-api-grpc.md)).

---

### ModuleApplicationDbContext

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:18` · Level 7 · class (abstract)

- **What it is**: an **abstract** EF Core context for the Conference module that declares typed `DbSet`s for all thirteen Conference entities and inherits auditing, soft-delete, and domain-event dispatch from the common [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) base.
- **Depends on**: first-party: [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) (base), [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider), [`PhysicalDataSource`](group-07-persistence-ef-core.md#physicaldatasource), and every Conference aggregate/child entity it sets (`Event`, `Room`, `EventSpeaker`, `EventQuestionAnswer`, `Session`, `SessionSpeaker`, `SessionQuestionAnswer`, `SessionCategoryItem`, `Speaker`, `SpeakerCategoryItem`, `Category`, `CategoryItem`, `Question`, see [Conference Domain](group-17-conference-domain.md)). External: `Microsoft.EntityFrameworkCore`.
- **Concept introduced, the module-scoped DbSet manifest that documents the bounded context's tables.** `[Rubric §8, Data Architecture]` (assesses how persistence is organized per bounded context) and `[Rubric §4, DDD]` (assesses aggregate boundaries): this one file is the readable inventory of which entities the Conference database owns. Its primary constructor forwards all four parameters straight to the base (`:18-23`), so it picks up the audit-stamping `SaveChangesAsync`, the soft-delete global query filters, and the outbox/domain-event interceptors with no extra code, see ADR-005 (soft-delete) and ADR-003 (outbox).
- **Walkthrough**: the primary constructor `(DbContextOptions options, IServiceProvider serviceProvider, IEntityConfigurationAssemblyProvider assemblyProvider, PhysicalDataSource physicalDataSource)` chains to `ApplicationDbContext(...)` (`:18-23`). The body is purely thirteen `internal DbSet<T> { get; set; }` declarations (`:26-62`), one per Conference entity, each XML-documented. There is **no** `OnModelCreating`/`OnConfiguring` override here, entity mapping comes from per-entity `EntityTypeConfigurationSQLServer<TEntity, TId>` classes discovered by assembly scanning, not from this context.
- **Why it's built this way**: it mirrors the database-per-service strategy (ADR-006): each module declares its own table surface in its own Infrastructure project, so a module can be extracted into a standalone service without untangling a shared monolithic context. The `DbSet`s are `internal` because only Infrastructure-layer code (repositories, populators) addresses them directly.
- **Caveats / not-in-source**: **this abstract class is never inherited or instantiated anywhere in the ADC source or tests** (verified: the only reference to the symbol is its own declaration). At runtime the *concrete* context is the sealed [`SQLServerDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) from MMCA.Common, which also derives from `ApplicationDbContext` and resolves entities by scanning `IEntityTypeConfiguration` types, not via these `DbSet`s (ADR-006 mandates one concrete context class, per database). So `ModuleApplicationDbContext` functions as a **declarative manifest / documentation of the Conference bounded context's table surface** rather than a live runtime context; its sibling files in Identity and Engagement Infrastructure play the identical role. Do not assume these `DbSet`s drive the actual EF model, the configuration classes and `SQLServerDbContext` do.

### Conference EF entity configurations

> 15 `internal sealed` classes in `MMCA.ADC.Conference.Infrastructure`, namespace
> `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration`, all Level 7, each extending
> [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype).

These are the per-entity persistence maps for the Conference module. Every one follows the same
two-step shape: override `Configure(EntityTypeBuilder<TEntity> builder)`, call `base.Configure(builder)`
**first** (the framework base derives the table name from `typeof(TEntity).Name`, derives the schema
from the module namespace, installs the soft-delete global query filter, configures the audit fields,
and adds the `rowversion` concurrency token), then declare the entity-specific property constraints,
relationships, and indexes. Because the storage engine is decided **entirely** by the base class they
inherit (the `…SQLServer` base, see [primer §2 "engine-agnostic entities"](00-primer.md#2-architectural-styles-this-codebase-commits-to)),
re-pointing any of these entities to Cosmos or SQLite would mean swapping only the base type, the
domain entity and everything above it stay untouched. All 15 use the `…SQLServer` base (ADC runs SQL
Server only).

`[Rubric §8, Data Architecture]` (assesses deliberate persistence design: correct length
constraints, soft-delete-aware unique indexes, FK relationships, and ignoring computed properties so
they never reach a column). `[Rubric §3, Clean Architecture]` (assesses dependency direction, EF
configuration is confined to the Infrastructure layer; the [`Event`](group-17-conference-domain.md#event),
[`Session`](group-17-conference-domain.md#session), [`Speaker`](group-17-conference-domain.md#speaker)
etc. domain entities carry no EF attributes whatsoever, so the domain stays framework-free).

**Concept reinforced, length constants from the domain invariants.** Almost every `HasMaxLength`
call reads a constant from the entity's `…Invariants` class
([`EventInvariants`](group-17-conference-domain.md#eventinvariants),
[`SessionInvariants`](group-17-conference-domain.md#sessioninvariants),
[`SpeakerInvariants`](group-17-conference-domain.md#speakerinvariants),
[`CategoryInvariants`](group-17-conference-domain.md#categoryinvariants),
[`QuestionInvariants`](group-17-conference-domain.md#questioninvariants)) rather than a literal. That
makes the field length a **single source of truth** shared between the schema (here) and the
FluentValidation rule objects in the Application layer, change the constant once and both the column
width and the validator move together.

**Concept reinforced, the soft-delete-aware filtered unique index.** Several join/child configs
declare `HasIndex(...).IsUnique().HasFilter("[IsDeleted] = 0")`. A plain unique index would forbid a
user from ever re-creating an association they previously soft-deleted (the old soft-deleted row still
occupies the unique slot). Filtering the index to `IsDeleted = 0` makes the constraint apply **only to
live rows**, so a delete-then-recreate cycle is legal while still guaranteeing at most one active
association at a time. This is the same pattern used framework-wide (compare `UserSessionBookmark` in
the Engagement module).

| Type | File:Line | Entity mapped | Notable configuration |
|------|-----------|---------------|----------------------|
| `CategoryItemConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/CategoryItemConfiguration.cs:11` | [`CategoryItem`](group-17-conference-domain.md#categoryitem) | `Name` (required, `CategoryItemNameMaxLength`), `Sort`; required FK to `Category`; composite unique index `(CategoryId, Name)` |
| `ConferenceCategoryConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/ConferenceCategoryConfiguration.cs:13` | [`Category`](group-17-conference-domain.md#category) | Explicit `ToTable("Category", "Conference")`; `Title` (required, `TitleMaxLength`), `Sort`, `Type` (optional, max 100) |
| `EventConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/EventConfiguration.cs:11` | [`Event`](group-17-conference-domain.md#event) | `Name`, dates, `TimeZone` (required); optional `Description`, `SessionizeCode`, venue fields, `WiFiInfo`; filtered (non-unique) index on `SessionizeCode` |
| `EventQuestionAnswerConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/EventQuestionAnswerConfiguration.cs:11` | [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer) | `EventId`, `QuestionId`, `AnswerValue` (required); FK to `Event`; filtered index on `EventId` |
| `EventSpeakerConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/EventSpeakerConfiguration.cs:11` | [`EventSpeaker`](group-17-conference-domain.md#eventspeaker) | FK to `Event`; soft-delete-aware unique index `(EventId, SpeakerId)` |
| `QuestionConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/QuestionConfiguration.cs:10` | [`Question`](group-17-conference-domain.md#question) | `QuestionText`, `QuestionEntity`, `QuestionType`, `Sort`, `IsRequired`, `QuestionSource` (all required) |
| `RoomConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/RoomConfiguration.cs:10` | [`Room`](group-17-conference-domain.md#room) | `Name`, `Sort` (required); optional `Capacity`, `Floor`, `Location`, `AccessibilityInfo`; required FK to `Event` |
| `SessionAiScoreConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionAiScoreConfiguration.cs:11` | [`SessionAiScore`](group-17-conference-domain.md#sessionaiscore) | Seven `decimal(3,1)` score columns, `Reasoning` (max 4000), `ModelUsed` (max 100); one-score-per-session unique filtered index |
| `SessionCategoryItemConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionCategoryItemConfiguration.cs:11` | [`SessionCategoryItem`](group-17-conference-domain.md#sessioncategoryitem) | FK to `Session`; soft-delete-aware unique index `(SessionId, CategoryItemId)` |
| `SessionConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionConfiguration.cs:12` | [`Session`](group-17-conference-domain.md#session) | `Title` required; optional `Status`/dates/URLs; four `bool` flags; `Ignore(Duration)`; FKs to `Event` and (restrict-delete) `Room` |
| `SessionQuestionAnswerConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionQuestionAnswerConfiguration.cs:10` | [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer) | `SessionId`, `QuestionId`, `AnswerValue` (required); FK to `Session` |
| `SessionSpeakerConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionSpeakerConfiguration.cs:11` | [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker) | FK to `Session`; soft-delete-aware unique index `(SessionId, SpeakerId)` |
| `SpeakerCategoryItemConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SpeakerCategoryItemConfiguration.cs:11` | [`SpeakerCategoryItem`](group-17-conference-domain.md#speakercategoryitem) | FK to `Speaker`; soft-delete-aware unique index `(SpeakerId, CategoryItemId)` |
| `SpeakerConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SpeakerConfiguration.cs:12` | [`Speaker`](group-17-conference-domain.md#speaker) | `Email` value-object conversion; filtered unique index on `LinkedUserId`; `Ignore(FullName)` |
| `SpeakerQuestionAnswerConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SpeakerQuestionAnswerConfiguration.cs:10` | [`SpeakerQuestionAnswer`](group-17-conference-domain.md#speakerquestionanswer) | `SpeakerId`, `QuestionId`, `AnswerValue` (required); FK to `Speaker` |

**`CategoryItemConfiguration`, the reference example** (lines 11-34). After `base.Configure`, it sets
`Name` to `HasMaxLength(CategoryInvariants.CategoryItemNameMaxLength).IsRequired()` and `Sort` to
`IsRequired()`, declares the parent relationship fluently,
`HasOne(p => p.Category).WithMany(p => p.CategoryItems).HasForeignKey(p => p.CategoryId).IsRequired()`
(lines 26-29), then `HasIndex(p => new { p.CategoryId, p.Name }).IsUnique()` (lines 31-32), a
**composite** unique index so the same item name can't appear twice in one category. (Note: this one is
*not* `IsDeleted`-filtered, the uniqueness is on category+name regardless of delete state.)

**`ConferenceCategoryConfiguration`** (line 13) is the only one that overrides the table name
explicitly: `builder.ToTable("Category", "Conference")` (line 24). The base would already derive
`Category` from `typeof(Category).Name`, so the call is for clarity / disambiguation from any other
module's `Category`, the doc comment (lines 10-11) cites avoiding a collision with a Catalog-module
`Category`. `Type` is optional (`HasMaxLength(100).IsRequired(false)`).

**`EventConfiguration`** (line 11) maps the event aggregate root: required `Name`
(`EventInvariants.NameMaxLength`), `StartDate`, `EndDate`, and `TimeZone`; everything else optional.
The `SessionizeCode` index (lines 41-42) is `HasIndex(p => p.SessionizeCode).HasFilter("[SessionizeCode] IS NOT NULL")`,
**filtered but not unique** (it indexes only events that have a Sessionize code, accelerating
import lookups, without forbidding two events from sharing a code or both being null).
`LastSessionizeRefreshOn`/`LastSessionizeRefreshBy` are optional audit-style columns for the
Sessionize sync.

**`SessionConfiguration`** (line 12) is the busiest entity config. `Title` is required; `Description`,
`StartsAt`, `EndsAt`, `Status` (max `SessionInvariants.StatusMaxLength`), and the URL/accessibility/
resource fields are all optional. Four booleans (`IsInformed`, `IsConfirmed`, `IsServiceSession`,
`IsPlenumSession`) are required. `builder.Ignore(p => p.Duration)` (line 67) keeps the computed
`Duration` property out of the schema. Two relationships: a required FK to `Event` declared with
`WithMany()` (no inverse navigation collection on `Event`, lines 72-75) plus a filtered index on
`EventId` (lines 77-78), and an **optional** FK to `Room` configured with
`.OnDelete(DeleteBehavior.Restrict)` (lines 83-87) so deleting a room cannot cascade-orphan the
sessions scheduled in it. (`Status` is stored as a plain nullable string with a max length, it is
*not* an enum-to-string `HasConversion`, so adding a status value needs no migration anyway.)

**`SessionAiScoreConfiguration`** (line 11) persists the Anthropic-generated session scoring. Seven
score properties (`OverallScore`, `TopicRelevanceScore`, `DescriptionQualityScore`, `NoveltyScore`,
`ActionableTakeawaysScore`, `DepthOrInsightQualityScore`, `CredibilityExperienceScore`) each use
`HasPrecision(3, 1)`, a `decimal(3,1)`, i.e. a 0.0–99.9 column sized for a one-decimal 0–10 rating
(lines 22-48). `Reasoning` is capped at 4000 chars and `ModelUsed` at 100. The
`HasIndex(p => p.SessionId).IsUnique().HasFilter("[IsDeleted] = 0")` (lines 59-61) enforces **one live
AI score per session**. `[Rubric §13, Observability & Operability]` (assesses recording the *origin*
of derived data): persisting `ModelUsed` and free-text `Reasoning` alongside the numeric scores keeps
the AI judgement auditable and reproducible, you can tell which model produced a given score and why.

**`SpeakerConfiguration`** (line 12) carries the only value-object mapping in the set. The `Email`
property (lines 42-47) uses
`HasConversion(e => e == null ? null : e.Value, v => v == null ? null : Email.Create(v).Value)` to
round-trip the [`Email`](group-02-domain-building-blocks.md#email) value object to/from a nullable
`string` column (speaker email is optional). The unique index on `LinkedUserId`
(`IsUnique().HasFilter("[LinkedUserId] IS NOT NULL")`, lines 65-67) enforces the 1:1 User↔Speaker link
only among speakers that *have* a linked user, leaving unlinked speakers unconstrained.
`builder.Ignore(p => p.FullName)` (line 70) drops the computed `FullName` from the schema.

**The join-entity configs** (`EventSpeaker`, `SessionSpeaker`, `SpeakerCategoryItem`,
`SessionCategoryItem`) are structurally identical: both FK scalar columns required, a required `HasOne`
relationship to the *owning* aggregate (the one whose collection navigation they belong to), and a
**soft-delete-aware composite unique index** on the two FKs. `EventQuestionAnswer`,
`SessionQuestionAnswer`, and `SpeakerQuestionAnswer` follow the same FK pattern but carry a required
`AnswerValue` string column instead of a second association; only `EventQuestionAnswer` adds a filtered
lookup index on its parent FK.

**Why they're built this way**: confining all EF mapping to small, single-responsibility
configuration classes in Infrastructure keeps the domain entities pure POCOs (Clean Architecture
dependency rule) and lets Scrutor auto-discover every `IEntityTypeConfiguration` by assembly scan, so
adding an entity is "add the config class" with no central registration edit. Driving every length
from the shared invariants constant prevents schema/validator drift.

**Where they're used**: discovered and applied by the Conference module's `DbContext`
(`ModuleApplicationDbContext` → the concrete `SQLServerDbContext`) when EF builds the model; the
per-module migrations project (`MMCA.ADC.Migrations.SqlServer.Conference`) snapshots the resulting
schema. Cross-module FKs (e.g. `UserSessionBookmark.SessionId → Session`) are deliberately **not**
configured here, that would create a cross-module Infrastructure→Domain coupling, and instead degrade
to scalar columns under the database-per-service model (see [ADR-006](../ADRs/006-database-per-service.md)).

- **Caveats / not-in-source**: `SessionAiScore` persistence exists, but whether AI scoring is run in
  production at all is a runtime/config concern not visible in these configs (see the Anthropic scoring
  service and feature gating elsewhere). The configs only define the table that *would* hold scores.

### ConferenceModuleDbSeeder

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts.Seeding` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:22` · Level 8 · class

- **What it is**: the Conference module's idempotent database seeder. It always seeds the default
  conference event and the standard feedback questions, and *optionally* seeds sample browse data
  (speakers + sessions) when an `includeSampleData` flag is set. It derives from the framework's
  [`DbSeeder`](group-07-persistence-ef-core.md#dbseeder) base.
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (ctor); the domain
  factories/repositories for [`Event`](group-17-conference-domain.md#event),
  [`Question`](group-17-conference-domain.md#question),
  [`Speaker`](group-17-conference-domain.md#speaker), and
  [`Session`](group-17-conference-domain.md#session); the invariants constants
  ([`QuestionInvariants`](group-17-conference-domain.md#questioninvariants)`.ManualIdRangeStart`,
  [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants)`.ManualIdRangeStart`); BCL
  (`DateOnly`, `DateTime`).
- **Concept reinforced, idempotent, environment-gated seeding through the domain factories.**
  `[Rubric §17, DevOps & Deployment]` (assesses repeatable, safe-to-re-run database initialization)
  and `[Rubric §14, Testability]` (deterministic fixtures the E2E suite can rely on). Every seed
  method calls `repository.ExistsAsync(...)` before inserting (lines 45-50 for the event, 77-82 for the
  questions, 134-139 per speaker, 193-201 per session), so re-running on an already-seeded database is a
  no-op. Crucially, seed rows go through the same `Event.Create` / `Question.Create` / `Speaker.Create`
  / `Session.Create` factory methods the handlers use (each returns a `Result<T>` that is checked for
  `IsFailure` before `AddAsync`), so seeded data satisfies the identical domain invariants as
  user-created data, there is no "raw insert" back door.
- **Walkthrough**
  - **Constructor** (line 22): primary constructor `(IUnitOfWork unitOfWork, bool includeSampleData = false)`;
    `unitOfWork` is null-guarded (line 24), `includeSampleData` defaults to `false` (production-safe).
  - **`SeedAsync`** (lines 28-38): awaits `SeedEventAsync` then `SeedQuestionsAsync` unconditionally;
    only if `_includeSampleData` does it then run `SeedSpeakersAsync` and `SeedSessionsAsync`. This is
    the **environment gate**, the real event + feedback questions are always present, sample
    browse rows only in dev/CI.
  - **`SeedEventAsync`** (lines 41-71): if no event named "Atlanta Cloud + AI Conference" exists,
    builds it via `Event.Create(...)` (single-day 2026-05-30, `America/New_York`, Sessionize code
    `z1ecmzux`, FCS Innovation Academy venue), calls `.Publish()` on the result (line 67) so it is
    immediately public, then `AddAsync` + `SaveChangesAsync`. The hard-coded venue map URL carries a
    justified `S1075` suppression (line 40), `[Rubric §15, Best Practices]` (suppressions are scoped
    and explained, not blanket-disabled).
  - **`SeedQuestionsAsync`** (lines 73-118): seeds ten standard feedback questions, six Session-scoped
    (five `Rating` + one `Text` `Comments`) and four Event-scoped, all with `questionSource: "User"`.
    IDs are explicitly assigned from `QuestionInvariants.ManualIdRangeStart` upward (line 98), reserving
    a manual ID band so they never collide with Sessionize-imported or organizer-created questions.
  - **`SeedSpeakersAsync` / `SeedSessionsAsync`** (lines 120-230, sample-only): seed two sample speakers
    (Ada Lovelace, Alan Turing) and two sample sessions, each existence-checked individually. Sessions
    are assigned explicit IDs from `SessionInvariants.ManualIdRangeStart` (lines 184-185), the comment
    (lines 178-181) explains the Session int PK *is* the Sessionize id, so sample sessions take IDs at
    the top of a reserved range above any real Sessionize id to avoid collision.
- **Why it's built this way**: seeding through the domain factories keeps seed data valid by
  construction; the `includeSampleData` flag (default `false`) keeps test/browse fixtures out of
  production while guaranteeing the public-browse E2E tests (`PublicBrowseTests.PublicSessionList_*` /
  `PublicSpeakerList_*`, cited in the remarks, lines 17-20) always have at least one session and
  speaker row in dev/CI.
- **Where it's used**: instantiated and run by `ConferenceModuleSeeder`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:26-29`), which
  reads `Seeding:IncludeSampleConferenceData` from configuration, resolves an `IUnitOfWork`, constructs
  `new ConferenceModuleDbSeeder(unitOfWork, includeSampleData)`, and calls `SeedAsync`. That module
  seeder is invoked by the framework's database-initialization path after schema migration. The
  `IncludeSampleConferenceData` flag is set only by the local Aspire AppHost and the E2E CI workflow;
  production leaves it unset.
- **Caveats / not-in-source**: the seeder itself does not read configuration; the
  `includeSampleData` boolean is decided by the caller (`ConferenceModuleSeeder`, API layer). The exact
  step that calls `ConferenceModuleSeeder.SeedAsync` (database-initialization extension) lives outside
  this file and is covered in the persistence/module chapters.


---
[⬅ ADC Conference - Application & Use Cases](group-18-conference-application.md)  •  [Index](00-index.md)  •  [ADC Conference - API, gRPC Contracts & Service Host ➡](group-20-conference-api-grpc.md)
