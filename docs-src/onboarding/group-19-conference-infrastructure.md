# 19. ADC Conference - Infrastructure & Persistence

**What this chapter covers.** This is the **adapter** layer of the Conference module, the place where
the engine-agnostic domain meets concrete technology. Three concerns live here: (1) **persistence
mapping**, the 15 EF Core entity configurations that turn plain domain classes into SQL Server tables,
the abstract `DbContext` that declares the module's `DbSet`s, and the seeder that puts the real
conference events and feedback questions into a fresh database; (2) **outbound integration and
background work**, the HTTP clients that talk to **Sessionize** (the conference's session-submission
platform) and to the **Anthropic Claude API** (the AI session scorer), plus the hosted worker that
drains the scoring queue off the request path; and (3) the **DI wiring** that registers those services
with the right resilience policy. It is the per-module realization of Clean Architecture's ports and
adapters idea: the [Application](group-18-conference-application.md) layer declares the ports
([`ISessionizeService`](group-18-conference-application.md#isessionizeservice),
[`IAiScoringService`](group-18-conference-application.md#iaiscoringservice),
[`SessionScoringQueue`](group-18-conference-application.md#sessionscoringqueue)), and this
Infrastructure layer supplies the adapters and the runner. `[Rubric §3, Clean Architecture]` assesses
whether dependencies point inward and the domain stays framework-free; here every EF, HTTP, and
Anthropic concern is quarantined in Infrastructure, so the domain entities in
[Group 17](group-17-conference-domain.md) carry no persistence or transport attribute at all.

## Engine-agnostic entities, engine chosen by the config base class

The most important idea in this chapter is one the entities themselves never express: **what storage
engine each entity uses is decided here, not in the domain.** A Conference domain entity,
[`Session`](group-17-conference-domain.md#session), [`Speaker`](group-17-conference-domain.md#speaker),
[`Event`](group-17-conference-domain.md#event), the join entities, is a plain class. The *only* thing
that binds it to SQL Server is which base class its configuration inherits from. All 15 configs in this
group ([`SessionConfiguration`](#sessionconfiguration), [`SpeakerConfiguration`](#speakerconfiguration),
[`EventConfiguration`](#eventconfiguration), and the rest) derive from
[`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype)
(for example `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionConfiguration.cs:12`),
which is a thin shim carrying `[UseDataSource(DataSource.SQLServer)]`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationSQLServer.cs:16`)
over the engine-neutral
[`EntityTypeConfiguration<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationtentity-tidentifiertype).
That attribute is what [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry)
reads to decide which physical database an entity belongs to. Swapping just that one base class would
re-point the same `Session` to Cosmos or SQLite with zero change to the domain, the application
handlers, or the entity: this is the per-entity half of the **database-per-service** strategy
([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html), [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). `[Rubric §8, Data Architecture]` (deliberate persistence: transactions, migrations,
soft-delete, audit, concurrency) is the dominant lens for the whole persistence half of this chapter.

## Each config inherits the cross-cutting behavior, then adds entity specifics

Every configuration's `Configure` method begins with `base.Configure(builder)` (for example
`SessionConfiguration.cs:17`) and *then* adds its own mappings. That one `base` call is where the
framework injects the conventions applied uniformly: the strongly-typed key, the table name and module
schema, and the concurrency token, none of which any individual config re-states. The per-entity bodies
then declare what is unique: column lengths sourced from the domain's invariant constants
(`SessionInvariants.TitleMaxLength` at `SessionConfiguration.cs:20`, `EventInvariants.NameMaxLength` at
`EventConfiguration.cs:20`), required and optional flags, computed properties excluded with
`builder.Ignore(...)` (`Session.Duration` at `SessionConfiguration.cs:66`, `Speaker.FullName` at
`SpeakerConfiguration.cs:70`), value-object conversions (`Speaker.Email` round-trips through
`Email.Create` at `SpeakerConfiguration.cs:42-47`), decimal precision (`HasPrecision(3, 1)` on all seven
AI sub-scores, `SessionAiScoreConfiguration.cs:22-48`), and **filtered indexes**. The filters come in
two flavors and both matter. Soft-delete filters scope uniqueness to live rows, so a soft-deleted link
does not block a re-insert: `HasFilter("[IsDeleted] = 0")` appears on the unique (SessionId, SpeakerId)
pair (`SessionSpeakerConfiguration.cs:30-32`), on the one-score-per-session index
(`SessionAiScoreConfiguration.cs:59-61`), on the EventSpeaker, SessionCategoryItem, and
SpeakerCategoryItem pairs, and on the non-unique lookup indexes for `Session.EventId`
(`SessionConfiguration.cs:76-77`) and `EventQuestionAnswer.EventId`. Sparse filters skip nulls:
`Speaker.LinkedUserId` is unique only where it is set (`SpeakerConfiguration.cs:65-67`, the
User-to-Speaker link), and `Event.SessionizeCode` is indexed only where present
(`EventConfiguration.cs:41-42`). Two further quirks are worth knowing:
[`ConferenceCategoryConfiguration`](#conferencecategoryconfiguration) calls
`ToTable("Category", "Conference")` explicitly (`ConferenceCategoryConfiguration.cs:24`) so the
Conference `Category` table cannot collide with another module's `Category`, and
[`SessionConfiguration`](#sessionconfiguration) maps the Session-to-Room relationship with
`OnDelete(DeleteBehavior.Restrict)` (`SessionConfiguration.cs:86`) so deleting a room can never cascade
sessions away.

## DbSets, the context shape, and how the configurations are actually found

[`ModuleApplicationDbContext`](#moduleapplicationdbcontext)
(`MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:18`) is the
Conference module's abstract `DbContext`. It does one job: declare 13 `internal DbSet<T>` properties
(`Events`, `Rooms`, `EventSpeakers`, `EventQuestionAnswers`, `Sessions`, `SessionSpeakers`,
`SessionQuestionAnswers`, `SessionCategoryItems`, `Speakers`, `SpeakerCategoryItems`, `Categories`,
`CategoryItems`, `Questions`, at `ModuleApplicationDbContext.cs:26-62`). It is **abstract** and inherits
from the Common [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext), from
which it gets the real machinery: the `SaveChangesAsync` override that stamps audit fields, captures
domain events into the outbox, and the global soft-delete query filters applied to every
`IAuditableEntity`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:243-257`).
The concrete class EF actually instantiates is the single
[`SQLServerDbContext`](group-07-persistence-ef-core.md#sqlserverdbcontext) in the Common framework:
**one concrete context class per engine, one instance per database** ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). The codebase
deliberately does not split into per-module context classes.

A detail that surprises most readers: a `DbSet` is *not* what puts an entity in the model. The base
context walks the registered configuration assemblies and applies every
`IEntityTypeConfigurationSQLServer<,>` implementation whose entity resolves to this context's data
source key (`ApplicationDbContext.cs:351-377`). That is why two entities with a configuration here,
`SessionAiScore` and `SpeakerQuestionAnswer`, are mapped and queryable through the repository layer even
though `ModuleApplicationDbContext` declares no `DbSet` for either: 15 configurations, 13 `DbSet`s, and
the configurations win. `[Rubric §7, Microservices Readiness]` (can a module become its own service
without a rewrite?) is embodied here: the Conference module already runs as `MMCA.ADC.Conference.Service`
over its own `ADC_Conference` database with its own `dbo.OutboxMessages`, and cross-module references
(a speaker's linked user, a bookmark's session) are scalar columns resolved via gRPC and integration
events, never cross-database foreign keys.

## Seeding: two real events always, sample data only in dev and CI

[`ConferenceModuleDbSeeder`](#conferencemoduledbseeder)
(`MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:22`)
derives from the framework's [`DbSeeder`](group-07-persistence-ef-core.md#dbseeder) and runs after
schema initialization, constructed by `ConferenceModuleSeeder` in the API layer
(`MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:28`). It is idempotent: every step first issues an
`ExistsAsync` check through the repository and returns early if the row is present, which is what makes
it safe to run on every startup under the production `Migrate` init strategy ([ADR-030](https://ivanball.github.io/docs/adr/030-startup-sole-migrator.html)). It **always**
seeds three things (`ConferenceModuleDbSeeder.cs:35-37`): the **2026 Atlanta Cloud + AI Conference**
(2026-05-30, `America/New_York`, Sessionize code `z1ecmzux`, `ConferenceModuleDbSeeder.cs:59-69`), the
**2026 Atlanta Developers Conference** (2026-10-17, no Sessionize code,
`ConferenceModuleDbSeeder.cs:91-101`), both published immediately after creation, and the fixed set of
**10 feedback questions** (5 session ratings plus a session comment, 3 conference ratings plus a
conference comment, `ConferenceModuleDbSeeder.cs:123-135`) whose ids start at
[`QuestionInvariants`](group-17-conference-domain.md#questioninvariants)`.ManualIdRangeStart`
(`ConferenceModuleDbSeeder.cs:137`) so they never collide with imported data. It **conditionally** seeds
two sample speakers (Ada Lovelace and Alan Turing, `ConferenceModuleDbSeeder.cs:165-166`), two sample
sessions, one per seeded event (`ConferenceModuleDbSeeder.cs:220-224`), and the EventSpeaker plus
SessionSpeaker links between them (`ConferenceModuleDbSeeder.cs:270-294`), only when `includeSampleData`
is set. The flag comes from `Seeding:IncludeSampleConferenceData` (`ConferenceModuleSeeder.cs:26`), which
the local Aspire AppHost sets (`MMCA.ADC.AppHost/Program.cs:164`) and production leaves unset. The reason
is documented in the seeder's own remarks (`ConferenceModuleDbSeeder.cs:14-21`): the public-browse E2E
tests need at least one session and one speaker row to exist deterministically, while production's real
sessions and speakers arrive through the Sessionize import. The sample links are created on *both* paths
deliberately, so the direct and the transitive branches of the speakers-by-event filter are exercised in
dev and CI (`ConferenceModuleDbSeeder.cs:286-290`).

## The Sessionize adapter

[`SessionizeService`](#sessionizeservice)
(`MMCA.ADC.Conference.Infrastructure/Services/SessionizeService.cs:10`) is a deliberately thin HTTP
client: the whole class is one method. Given a Sessionize event code it builds the relative URI
`{code}/view/All` (`SessionizeService.cs:15`), calls `GetAsync`, asserts success with
`EnsureSuccessStatusCode` (`SessionizeService.cs:20`), and deserializes into the
[`SessionizeResponse`](group-18-conference-application.md#sessionizeresponse) model owned by the
Application layer. Unlike the AI adapter it **does** throw on a bad status, because the import use-case
that calls it is a foreground operation with a caller waiting on the result. It is registered as a typed
`HttpClient` in [`DependencyInjection`](#dependencyinjection) with the base address
`https://sessionize.com/api/v2/` baked in
(`MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:21-23`), so it inherits the standard Aspire
resilience handler (Polly retry, timeout, circuit breaker) unchanged: `[Rubric §29, Resilience]`, the
[ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html) policy that every outbound client gets resilience by default. The thinness is intentional:
parsing, mapping, and the import workflow live in Application use-cases, and this adapter owns only the
wire call.

## The Anthropic AI scoring adapter

[`AnthropicScoringService`](#anthropicscoringservice)
(`MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:16`) is the richer of the two
adapters: it scores one session proposal against a Program Committee rubric using the **Anthropic Claude
Messages API**. It implements [`IAiScoringService`](group-18-conference-application.md#iaiscoringservice),
exposes the model id it uses (`claude-haiku-4-5-20251001`, `AnthropicScoringService.cs:22`), reads the
API key from configuration (`Anthropic:ApiKey`, expected in user secrets,
`AnthropicScoringService.cs:29`), POSTs to the relative `v1/messages` endpoint with an `x-api-key` header
(`AnthropicScoringService.cs:47-48`), and caps the response at 256 tokens
(`AnthropicScoringService.cs:44`). Its contract is precise about failure: it **never throws for a scoring
failure**, but **cancellation propagates**. Every failure path (missing key, non-2xx status, no text block
in the response, unparseable JSON, any other exception) funnels into `FailedResult`, which returns zero
scores with `Success = false` (`AnthropicScoringService.cs:179-192`), while the catch filter
`when (ex is not OperationCanceledException)` (`AnthropicScoringService.cs:71`) lets host shutdown unwind.
That split matters because scoring runs in batches: one bad proposal must not abort the batch, but a
deploy must still be able to stop the run.

The wire shapes are five private sealed records nested inside the service: the request envelope
[`AnthropicRequest`](#anthropicrequest) (`AnthropicScoringService.cs:200`) with its
[`AnthropicMessage`](#anthropicmessage) list (`AnthropicScoringService.cs:212`), the response envelope
[`AnthropicResponse`](#anthropicresponse) (`AnthropicScoringService.cs:221`) with its
[`AnthropicContentBlock`](#anthropiccontentblock) array (`AnthropicScoringService.cs:227`), and
[`AiScoreResponse`](#aiscoreresponse) (`AnthropicScoringService.cs:238`), the score JSON the model is
prompted to emit. Their snake_case `[JsonPropertyName]` names are the only place the vendor's contract
appears, so the Application layer sees only
[`SessionScoringResult`](group-18-conference-application.md#sessionscoringresult): that is
`[Rubric §32, Dependency & Supply-Chain]` in miniature. Parsing is defensive at three levels: the
response's `content` list is searched for the first `"text"` block (`AnthropicScoringService.cs:60-61`),
the JSON object is located by index between the first `{` and the last `}` so a chatty model preamble is
tolerated (`AnthropicScoringService.cs:81-86`), and all seven sub-scores are **nullable** so a partial
object is rejected as a failed parse by a property pattern rather than silently defaulting to zero
(`AnthropicScoringService.cs:96-108`, with the reason spelled out at `AnthropicScoringService.cs:236-237`).
Accepted scores are clamped to `[1.0, 10.0]` and rounded to one decimal with banker's rounding
(`AnthropicScoringService.cs:177`), and the speaker block of the prompt is formatted with
`CultureInfo.InvariantCulture` (`AnthropicScoringService.cs:166-171`) to stay culture-deterministic.
`[Rubric §11, Security]` shows up in the obvious place (the API key is a configuration secret, never
hard-coded) and `[Rubric §13, Observability]` in the `[LoggerMessage]` source-generated warning that
records every scoring failure with the session id and reason (`AnthropicScoringService.cs:196-197`).

## Scoring runs on a hosted drain, not on the request thread

[`SessionScoringProcessor`](#sessionscoringprocessor)
(`MMCA.ADC.Conference.Infrastructure/Services/SessionScoringProcessor.cs:31`) is the piece that makes a
multi-minute paid AI pass safe to trigger from an HTTP POST. It is a `BackgroundService` that consumes
[`SessionScoringQueue`](group-18-conference-application.md#sessionscoringqueue) with
`ReadAllAsync(stoppingToken)` (`SessionScoringProcessor.cs:47`), so the host owns the work: shutdown
cancels it and waits for it to unwind instead of a deploy or a scale-in tearing down a half-finished run.
This is the concrete adoption of [ADR-052](https://ivanball.github.io/docs/adr/052-background-job-execution.html) (bounded queue plus single-reader hosted drain), and it replaced
an untracked fire-and-forget task the controller used to start. Per item it creates its own DI scope
(`CreateAsyncScope`, `SessionScoringProcessor.cs:79`) because the drain itself is a singleton while the
[`ScoreEventSessionsCommand`](group-18-conference-application.md#scoreeventsessionscommand) handler is
scoped, resolves that handler through
[`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult)
(`SessionScoringProcessor.cs:80-81`), and releases the queue's dedup claim in a `finally`
(`queue.MarkCompleted(eventId)`, `SessionScoringProcessor.cs:68`) so a failed or interrupted run does not
permanently block the same event. Failure handling is decided once instead of per call site: a
cancellation during shutdown logs and returns (`SessionScoringProcessor.cs:53-59`), and any other
exception is caught under an explicit `CA1031` suppression whose comment states the rule, one failed run
must not kill the drain (`SessionScoringProcessor.cs:60-65`). The output cache is evicted **twice** per
run, once up front so polling clients stop seeing stale scores and once after a successful pass
(`SessionScoringProcessor.cs:77` and `SessionScoringProcessor.cs:93`), and it evicts the narrow
`conference:sessions` tag rather than the root `conference` tag. The comment above that constant records
why in production terms (`SessionScoringProcessor.cs:37-42`): evicting the root flushed events, speakers,
rooms, categories, and questions too, so an organizer triggering a scoring run during the event emptied
the whole public read surface onto the Basic-tier database while attendees were browsing.
`[Rubric §12, Performance & Scalability]` and `[Rubric §31, Cost/FinOps]` both live in that one constant
([ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html), [ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)).

## DI wiring and a deliberate resilience override

[`DependencyInjection`](#dependencyinjection)
(`MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:11`) is a single
`extension(IServiceCollection)` block (the codebase's standard DI-registration idiom, taught in the
primer) exposing `AddModuleConferenceInfrastructure()`. It registers both adapters as typed HTTP clients
and the drain as a hosted service (`DependencyInjection.cs:45`). The Anthropic client gets a **custom
resilience policy**: a 5-minute `HttpClient.Timeout` and the `anthropic-version: 2023-06-01` header
(`DependencyInjection.cs:31-32`), then `RemoveAllResilienceHandlers()` followed by a re-added
`StandardResilienceHandler` with a 3-minute attempt timeout, a 7-minute circuit-breaker sampling window,
a 5-minute total request timeout, and only **one** retry (`DependencyInjection.cs:34-41`). The inline
comment explains why (`DependencyInjection.cs:25-26`): AI scoring of a large batch can take minutes,
which would blow through Aspire's default 30s attempt and 90s total limits, and retrying an expensive LLM
call aggressively is wasteful. This is a precise illustration of [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html): every outbound client is
resilient by default, but a client with genuinely different latency characteristics tunes the policy
rather than disabling it. The Sessionize client takes the defaults unchanged.

## How it fits together at runtime

Three flows tie the chapter together. **Persistence flow:** a Conference command handler mutates an
aggregate and the unit of work saves; that resolves the concrete `SQLServerDbContext` over the
`ADC_Conference` database, whose model was built from the configurations registered here (lengths,
indexes, relationships, precision), stamps audit fields, hides deleted rows behind the global filters,
and captures domain events into the per-database outbox, all in one transaction. **Import flow:** an
organizer triggers a Sessionize refresh; the Application use-case calls
[`ISessionizeService`](group-18-conference-application.md#isessionizeservice), the typed `HttpClient`
adapter makes the outbound call inside the default Polly pipeline, and the parsed `SessionizeResponse`
flows back for mapping. **Scoring flow:** the organizer POSTs to the scoring endpoint, the controller
only calls `TryEnqueue` and returns `202 Accepted` or `409 Conflict`
(`MMCA.ADC.Conference.API/Controllers/SessionSelectionController.cs:108-116`),
[`SessionScoringProcessor`](#sessionscoringprocessor) picks the event up, evicts the sessions cache tag,
runs the scoped command handler which calls [`AnthropicScoringService`](#anthropicscoringservice) once per
session under the tuned resilience policy, persists one `SessionAiScore` row per session behind the unique
filtered index, and evicts the tag again. The two marker types in this assembly,
[`AssemblyReference`](#assemblyreference) and [`ClassReference`](#classreference)
(`MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:5` and
`MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:11`), exist purely so the module loader and the
configuration-assembly scan can reach this assembly by a stable `typeof()` handle instead of a hard-coded
type list, the same extension point every module assembly provides.

### AiScoreResponse

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:238` · Level 0 · record (private sealed)

- **What it is**: the score object the language model is prompted to emit, deserialized from the JSON span found inside the response text. Seven numeric sub-scores plus a free-text `reasoning` line.
- **Depends on**: no first-party types. External: `System.Text.Json.Serialization.JsonPropertyName`.
- **Concept introduced, anti-corruption serialization records at the edge.** This is a `private sealed record` nested inside [`AnthropicScoringService`](#anthropicscoringservice) (`AnthropicScoringService.cs:238`), so the vendor's snake_case vocabulary (`topic_relevance`, `actionable_takeaways`, `depth_or_insight_quality`) is named here and nowhere else. `[Rubric §3, Clean Architecture]` assesses whether external contracts stay out of inner layers: the Application layer only ever sees [`SessionScoringResult`](group-18-conference-application.md#sessionscoringresult), never an Anthropic shape. `[Rubric §32, Dependency & Supply-Chain]` assesses how a third-party API dependency is isolated: if Anthropic reshapes its envelope, only this one file changes.
- **Walkthrough**: eight `init` properties (`:240-262`), each carrying an explicit `[JsonPropertyName]`. The seven score properties (`Overall`, `TopicRelevance`, `DescriptionQuality`, `Novelty`, `ActionableTakeaways`, `DepthOrInsightQuality`, `CredibilityExperience`) are **`decimal?`**, not `decimal`, and the comment above the record (`:236-237`) explains the reason: nullability is what makes a *partial* model response detectable. `BuildResult` (`:92-108`) pattern-matches all seven against `{ } value` patterns and returns a failed result if any one is missing, instead of silently defaulting a missing score to `0m` and then clamping it up to `1.0`. `Reasoning` (`:261-262`) stays `string?` and is the only genuinely optional field, defaulted to `string.Empty` at `:120`.
- **Why it's built this way**: nesting it as a private record of the one class that speaks HTTP keeps it an implementation detail; making the score fields nullable turns "the model returned three of seven scores" into a detectable parse failure rather than a plausible-looking but wrong row in `SessionAiScore`.
- **Where it's used**: [`AnthropicScoringService.ParseSingleScore`](#anthropicscoringservice) (`:87`) deserializes into it, and `BuildResult` (`:92`) converts it into a [`SessionScoringResult`](group-18-conference-application.md#sessionscoringresult).

---

### AnthropicContentBlock

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:227` · Level 0 · record (private sealed)

- **What it is**: one element of the Messages API response `content` array: a `type` discriminator plus its `text`.
- **Depends on**: no first-party types. External: `System.Text.Json.Serialization`.
- **Concept**: same private wire-record pattern taught under [`AiScoreResponse`](#aiscoreresponse); nothing new.
- **Walkthrough**: two properties, `Type` and `Text` (`:229-233`), both `string?`. They are nullable because the adapter must be able to deserialize a block it does not understand without throwing: [`AnthropicScoringService`](#anthropicscoringservice) scans the list with `Find(c => string.Equals(c.Type, "text", StringComparison.OrdinalIgnoreCase))` (`:60-61`) and treats a null `Text` as a failure (`:63-67`) rather than as an exception.
- **Why it's built this way**: the Messages API returns an array of typed blocks, so the adapter selects the text block by discriminator instead of assuming index 0.
- **Where it's used**: composed into [`AnthropicResponse.Content`](#anthropicresponse) (`:223-224`).

---

### AnthropicMessage

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:212` · Level 0 · record (private sealed)

- **What it is**: one conversation turn in the request: a `role` and its `content`.
- **Depends on**: no first-party types. External: `System.Text.Json.Serialization`.
- **Concept**: cross-reference the private wire-record concept under [`AiScoreResponse`](#aiscoreresponse).
- **Walkthrough**: `required string Role` and `required string Content` (`:213-218`). Both are `required`, the mirror image of the response records' nullability: the adapter controls what it sends, so a half-built message is a compile error, while what comes back must be parsed defensively. Exactly one instance is ever constructed, with `Role = "user"` and the rubric prompt as `Content` (`:44`).
- **Why it's built this way**: `required` + `init` gives an immutable payload validated at construction (see the primer on `required`/`init` immutability).
- **Where it's used**: the `Messages` list of [`AnthropicRequest`](#anthropicrequest) (`:208-209`).

---

### AssemblyReference

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:5` · Level 0 · class (static)

- **What it is**: the assembly-marker type for the Conference Infrastructure assembly: a stable handle that reflection-based scanning can hold instead of a hard-coded assembly name string.
- **Depends on**: `System.Reflection` only. No first-party types.
- **Concept**: cross-reference the framework explanation under [AssemblyReference](group-17-conference-domain.md#assemblyreference) in the Conference Domain chapter; every layer of every module ships an identical pair, and the [Common module system](group-14-module-system-composition.md#assemblyreference) chapter teaches why.
- **Walkthrough**: two `public static readonly` fields (`AssemblyReference.cs:7-8`): `Assembly = typeof(AssemblyReference).Assembly`, and `AssemblyName` = its simple name with a `?? string.Empty` fallback so the field is never null.
- **Why it's built this way**: assembly scanning (EF `IEntityTypeConfiguration` discovery, handler and mapper registration) and the module loader all need a per-assembly token; taking `typeof(AssemblyReference).Assembly` survives renames and trimming better than a literal name.
- **Where it's used**: Conference module DI/registration and EF configuration discovery scan this assembly through this marker.

---

### ClassReference

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:11` · Level 0 · class

- **What it is**: an empty, non-static class whose only purpose is to be a `typeof(...)` / generic anchor for registration APIs that take a type rather than an `Assembly`.
- **Depends on**: nothing.
- **Concept**: cross-reference [ClassReference](group-14-module-system-composition.md#classreference) where the pattern is introduced.
- **Walkthrough**: the whole declaration is one line, `public class ClassReference { }` (`AssemblyReference.cs:11`). It is deliberately non-static (unlike its sibling above) because a static class cannot be used as a generic type argument.
- **Why it's built this way**: some registration helpers are shaped as `Add...(typeof(T))` or `Add...<T>()`; an empty public class gives those calls a target without exposing a real implementation type.
- **Where it's used**: assembly-scanning registration call sites in the Conference module composition path (see [Group 20](group-20-conference-api-grpc.md)).

---

### AnthropicRequest

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:200` · Level 1 · record (private sealed)

- **What it is**: the POST body for the Anthropic Messages endpoint: which model, how many output tokens are allowed, and the message list.
- **Depends on**: first-party: [`AnthropicMessage`](#anthropicmessage) (composed). External: `System.Text.Json.Serialization`.
- **Concept**: the composite half of the private envelope set introduced under [`AiScoreResponse`](#aiscoreresponse).
- **Walkthrough**: three `required` properties (`:202-209`), `Model` (`model`), `MaxTokens` (`max_tokens`) and `List<AnthropicMessage> Messages` (`messages`). At the one call site (`:40-45`) `Model` is bound to `ModelId` (`:22`) and `MaxTokens` to **256**: the scorer asks for a one-line JSON object, so a small output cap bounds both latency and per-call cost. `[Rubric §12, Performance & Scalability]` assesses whether expensive calls carry explicit bounds; this is one of two such bounds in the flow, the other being the tuned timeouts in [`DependencyInjection`](#dependencyinjection).
- **Why it's built this way**: `required` on all three makes an incomplete request unrepresentable, and serializing through a typed record (rather than an anonymous object) keeps the property names under `[JsonPropertyName]` control.
- **Where it's used**: [`AnthropicScoringService.ScoreSessionAsync`](#anthropicscoringservice) (`:40-49`), handed to `JsonContent.Create`.

---

### AnthropicResponse

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:221` · Level 1 · record (private sealed)

- **What it is**: the deserialized reply envelope: a nullable list of content blocks.
- **Depends on**: first-party: [`AnthropicContentBlock`](#anthropiccontentblock) (composed). External: `System.Text.Json.Serialization`.
- **Concept**: cross-reference [`AiScoreResponse`](#aiscoreresponse).
- **Walkthrough**: one property, `List<AnthropicContentBlock>? Content` (`:223-224`). Nullable end to end (`apiResponse?.Content?.Find(...)`, `:60`) so an empty or malformed body deserializes to something the adapter can test instead of throwing; the null path falls through to `FailedResult` (`:63-67`).
- **Why it's built this way**: the "we control the request, we distrust the response" asymmetry, expressed in the type system: `required` on the way out, nullable on the way back.
- **Where it's used**: [`AnthropicScoringService.ScoreSessionAsync`](#anthropicscoringservice) (`:59`).

---

### AnthropicScoringService

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:16` · Level 3 · class (sealed partial)

- **What it is**: the adapter that implements [`IAiScoringService`](group-18-conference-application.md#iaiscoringservice) by calling the Anthropic Claude Messages API (model `claude-haiku-4-5-20251001`, `:22`) to score one session proposal against a Program Committee rubric. Its XML doc states the contract plainly (`:11-15`): it never throws for scoring failures, but `OperationCanceledException` propagates.
- **Depends on**: first-party: [`IAiScoringService`](group-18-conference-application.md#iaiscoringservice) (implements), [`SessionScoringInput`](group-18-conference-application.md#sessionscoringinput), [`SessionScoringResult`](group-18-conference-application.md#sessionscoringresult), [`SpeakerInfo`](group-18-conference-application.md#speakerinfo), and its own private records [`AnthropicRequest`](#anthropicrequest), [`AnthropicMessage`](#anthropicmessage), [`AnthropicResponse`](#anthropicresponse), [`AnthropicContentBlock`](#anthropiccontentblock), [`AiScoreResponse`](#aiscoreresponse). External: `HttpClient`, `IConfiguration`, `ILogger<T>`, `System.Text.Json`, `System.Globalization`.
- **Concept introduced, the adapter that keeps an HTTP/LLM vendor at the edge.** `[Rubric §3, Clean Architecture]` and `[Rubric §1, SOLID]` (dependency inversion) assess whether inner layers depend on abstractions rather than vendors: every byte of Anthropic-specific HTTP and JSON lives in this one Infrastructure file, behind an Application-owned port. `[Rubric §11, Security]` assesses secret handling: the key is read from configuration (`Anthropic:ApiKey`, `:29`) and passed as the `x-api-key` header (`:48`), never hard-coded, and the failure log for a missing key names the configuration path, not a value (`:32`). `[Rubric §13, Observability & Operability]` assesses structured, allocation-cheap logging: failures go through a source-generated `[LoggerMessage]` warning carrying session id and reason (`:196-197`), which is also why the class is `partial`. `[Rubric §29, Resilience & Business Continuity]` assesses graceful degradation: five distinct failure paths (missing key `:30-34`, non-2xx `:52-57`, empty/absent text block `:63-67`, unparseable or partial JSON `:83-84` and `:96-108`, any other exception `:71-75`) all converge on `FailedResult`, so one bad proposal cannot abort a batch. `[Rubric §27, i18n]` assesses culture-correctness: `CultureInfo.InvariantCulture` is used for every interpolated string that reaches the prompt or the log (`:55`, `:166-171`), so output never varies with server locale.
- **Walkthrough**
  - A **primary constructor** injects `HttpClient`, `IConfiguration` and `ILogger<AnthropicScoringService>` (`:16-19`). The base address, the `anthropic-version` header and the resilience pipeline are not set here: they are configured once on the typed client in [`DependencyInjection`](#dependencyinjection), which is why the request below uses a *relative* URI.
  - `ModelId` (`:22`) is a fixed string exposed through the port so callers can record which model produced a score alongside the score itself.
  - `ScoreSessionAsync` (`:25`) guards on the missing key first (`:29-34`), builds the reviewer prompt with `BuildPrompt` (`:38`), assembles an [`AnthropicRequest`](#anthropicrequest) with a single user [`AnthropicMessage`](#anthropicmessage) and `MaxTokens = 256` (`:40-45`), then constructs an `HttpRequestMessage` to the relative `v1/messages` with the `x-api-key` header attached per request rather than as a client default (`:47-49`).
  - On a non-success status it reads the error body and logs `HTTP {code}: {body}` before returning `FailedResult` (`:52-57`). On success it deserializes to [`AnthropicResponse`](#anthropicresponse), finds the `"text"` block case-insensitively (`:59-61`), and passes its text to `ParseSingleScore`.
  - `ParseSingleScore` (`:78`) does not assume a bare JSON body: it slices from the first `{` to the last `}` (`:81-86`) so a model that wraps its answer in prose still parses, then deserializes with case-insensitive options (`JsonOptions`, `:194`).
  - `BuildResult` (`:92`) is the correctness gate. Its single `is not { ... }` pattern (`:96-108`) requires all seven sub-scores to be present; a partial object is a failed parse, not a success full of defaults. Only then does it build a [`SessionScoringResult`](group-18-conference-application.md#sessionscoringresult) with every score passed through `Clamp` (`:177`), which does `Math.Clamp(value, 1.0m, 10.0m)` and rounds to one decimal with `MidpointRounding.ToEven`.
  - `BuildPrompt` (`:125-154`) is the domain knowledge of this file: the ADC track list, six weighted criteria (topic relevance 30%, description quality 10%, novelty 20%, actionable takeaways 20%, depth or insight quality 10%, credibility and experience 10%), calibration rules ("most talks should fall between 5.5 and 7.5", `:147`), explicit penalties (`:149-151`), and a closing instruction to respond with only a JSON object (`:152-153`). `FormatSpeakers` (`:156-175`) renders the [`SpeakerInfo`](group-18-conference-application.md#speakerinfo) list, or the literal "(no speaker information available)" when there are none (`:158-159`), which is what makes the credibility criterion degrade gracefully.
  - `FailedResult` (`:179-192`) is the single shape of failure: all seven scores `0m`, `Reasoning = "Scoring failed"`, `Success = false`. Note that a zero is out of the `1.0-10.0` band by construction, so a failed row is distinguishable from any real score.
- **Why it's built this way**: concentrating vendor specifics behind the port makes swapping providers or faking the service in tests a one-class change, and the never-throw plus clamp plus all-or-nothing-parse discipline makes raw model output safe to persist into [`SessionAiScore`](group-17-conference-domain.md#sessionaiscore). The prompt is prescriptive because the parse depends on it.
- **Where it's used**: registered as the `IAiScoringService` implementation by [`DependencyInjection`](#dependencyinjection) (`DependencyInjection.cs:28-41`); driven per session by [`ScoreEventSessionsHandler`](group-18-conference-application.md#scoreeventsessionshandler), which is itself driven off the request path by [`SessionScoringProcessor`](#sessionscoringprocessor).
- **Caveats / not-in-source**: there is **no retry inside this class**. Retry, attempt timeout and circuit breaking are configured externally on the typed client (see [`DependencyInjection`](#dependencyinjection)); the in-class contract is "never throw, let the batch continue". Whether scoring is enabled in production at all is a configuration matter (the key must be present) and is not determinable from this file.

---

### SessionScoringProcessor

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Services/SessionScoringProcessor.cs:31` · Level 3 · class (sealed partial)

- **What it is**: the hosted background worker that drains [`SessionScoringQueue`](group-18-conference-application.md#sessionscoringqueue) and runs each queued AI scoring pass off the request path, under the host's stopping token.
- **Depends on**: first-party: [`SessionScoringQueue`](group-18-conference-application.md#sessionscoringqueue), [`ScoreEventSessionsCommand`](group-18-conference-application.md#scoreeventsessionscommand), [`ScoreEventSessionsResultDTO`](group-17-conference-domain.md#scoreeventsessionsresultdto), [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult), [`Result`](group-01-result-error-handling.md#result). External: `BackgroundService`, `IServiceScopeFactory`, `IOutputCacheStore`, `ILogger<T>`.
- **Concept introduced, replacing fire-and-forget with a host-owned single reader.** A `BackgroundService` differs from a detached `Task.Run` in one decisive way: the host knows about it. Shutdown cancels the token and waits for the loop to unwind, so a deploy or a scale-in no longer tears down a half-finished pass with nothing recorded (`:12-21`). Because exactly one reader exists (matching the queue's `SingleReader = true` configuration, `SessionScoringQueue.cs:27`), runs are serialized and two events cannot compete for the Anthropic rate limit simultaneously. `[Rubric §12, Performance & Scalability]` assesses keeping slow work off the request path: the controller enqueues and returns instead of awaiting a multi-minute LLM batch. `[Rubric §13, Observability & Operability]` assesses whether long-running work reports outcomes: four `[LoggerMessage]` methods cover completed, rejected, failed and interrupted (`:96-106`), including the shutdown case, which is the one an operator most needs to see in a deploy window. `[Rubric §29, Resilience]` assesses failure containment: a failed run is logged and the drain keeps going.
- **Walkthrough**
  - The **primary constructor** (`:31-35`) injects the queue, an `IServiceScopeFactory`, an `IOutputCacheStore` and a logger; the XML docs on the parameters (`:27-30`) state each role.
  - `SessionsCacheTag` (`:42`) is `"conference:sessions"`. The comment above it (`:37-41`) records a real incident-shaped rationale: evicting the root `conference` tag flushed events, speakers, rooms, categories and questions too, so an organizer starting a scoring run during the event emptied the entire public read surface onto the Basic-tier database while attendees were browsing. Scoring writes session scores, so it evicts only the sessions tag.
  - `ExecuteAsync` (`:45`) is a single `await foreach` over `queue.Reader.ReadAllAsync(stoppingToken)` (`:47`). Three handlers wrap each iteration: a cancellation catch that logs interruption and **returns** (`:53-59`), a deliberately broad `catch (Exception)` with a scoped `CA1031` suppression justified inline ("one failed run must not kill the drain", `:60-65`), and a `finally` that calls `queue.MarkCompleted(eventId)` (`:66-69`) so the claim is released on every path and a restarted host can accept the same event again.
  - `ScoreAsync` (`:73`) evicts the sessions cache tag **before** the run (`:77`) so a polling dashboard stops serving stale scores while work is in flight, creates an async DI scope (`:79`, needed because the command handler and its `DbContext` are scoped while this service is a singleton), resolves `ICommandHandler<ScoreEventSessionsCommand, Result<ScoreEventSessionsResultDTO>>` (`:80-81`) and invokes it (`:83-84`).
  - The result is handled as data, not as an exception: `IsFailure` logs the first error message via a list pattern (`:86-90`) and returns without a second eviction; success logs scored and failed counts (`:92`) and evicts again (`:93`) so clients see the new scores.
- **Why it's built this way**: resolving the handler through a scope keeps the CQRS decorator pipeline (logging, caching, transactional) intact for background work, so a queued run behaves exactly like a request-driven command. Evicting the narrow tag twice, before and after, is the cheapest way to keep a polled read surface honest without a push channel.
- **Where it's used**: registered by [`DependencyInjection`](#dependencyinjection) with `services.AddHostedService<SessionScoringProcessor>()` (`DependencyInjection.cs:45`); the producing side is the Conference API endpoint that calls `TryEnqueue` on [`ISessionScoringQueue`](group-18-conference-application.md#isessionscoringqueue).
- **Caveats / not-in-source**: the queue is in-memory (a `Channel`), so an interrupted run is *not* re-queued automatically by this class; it only releases the claim so the event can be submitted again. Whether the host is restarted fast enough for that to matter is an operational concern outside this file.

---

### SessionizeService

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Services/SessionizeService.cs:10` · Level 4 · class (sealed)

- **What it is**: the HTTP implementation of [`ISessionizeService`](group-18-conference-application.md#isessionizeservice). It calls the Sessionize "View All" endpoint, which returns every session, speaker, room and category for a conference in one document.
- **Depends on**: first-party: [`ISessionizeService`](group-18-conference-application.md#isessionizeservice) (implements), [`SessionizeResponse`](group-18-conference-application.md#sessionizeresponse) (return shape). External: `HttpClient`, `System.Net.Http.Json`.
- **Concept**: `[Rubric §2, Design Patterns]` and `[Rubric §1, SOLID]` (dependency inversion) assess whether the application depends on an abstraction it owns: the Application layer declares the port, Infrastructure supplies the adapter, and no Application file references `HttpClient`. The whole class is 26 lines because everything configurable (base address, resilience) lives on the typed-client registration in [`DependencyInjection`](#dependencyinjection).
- **Walkthrough**: a primary constructor takes `HttpClient` (`:10`). `GetAllAsync` builds the relative URI `{sessionizeCode}/view/All` (`:15`), `GET`s it (`:16-18`), calls `EnsureSuccessStatusCode()` (`:20`), and deserializes to `SessionizeResponse?` (`:22-24`). Both awaits use `.ConfigureAwait(false)` (the repo-wide rule from [ADR-049](https://ivanball.github.io/docs/adr/049-library-configureawait-policy.html)).
- **Why it's built this way**: keeping parsing, mapping and the import workflow in Application use-cases leaves this adapter owning only the wire call, which is what makes it trivially fakeable in tests.
- **Caveat, error handling differs from the AI adapter.** `EnsureSuccessStatusCode()` throws `HttpRequestException` on any non-2xx, and that exception **propagates** out of the class, the opposite of [`AnthropicScoringService`](#anthropicscoringservice)'s never-throw contract. The difference is deliberate and follows the shape of the work: a Sessionize sync is one explicit organizer action where a failure should surface as an error, while AI scoring is a per-item batch where one item's failure must not stop the rest. The return type is also nullable, so a 2xx with an empty body yields `null` rather than an exception.
- **Where it's used**: the Sessionize import handlers in [Conference Application](group-18-conference-application.md), triggered when an organizer refreshes an event's data.

---

### DependencyInjection

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:11` · Level 5 · class (static)

- **What it is**: the DI wiring for Conference Infrastructure. It registers the two outbound HTTP integrations as typed clients and the AI scoring drain as a hosted service.
- **Depends on**: first-party: [`ISessionizeService`](group-18-conference-application.md#isessionizeservice) / [`SessionizeService`](#sessionizeservice), [`IAiScoringService`](group-18-conference-application.md#iaiscoringservice) / [`AnthropicScoringService`](#anthropicscoringservice), [`SessionScoringProcessor`](#sessionscoringprocessor). External: `Microsoft.Extensions.DependencyInjection`, `Microsoft.Extensions.Http.Resilience` (Polly).
- **Concept introduced, tuning a resilience pipeline instead of disabling it.** `[Rubric §29, Resilience & Business Continuity]` assesses [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)'s rule that every outbound client carries a resilience handler. The Sessionize client (`:22-23`) is a plain `AddHttpClient<TInterface, TImplementation>` with only a base address, so it inherits the standard handler configured by the Aspire service defaults. The Anthropic client is the interesting case: an AI batch can run for minutes, far past the Aspire default of a 30 second attempt and 90 second total, so the code calls `RemoveAllResilienceHandlers()` and immediately re-adds `AddStandardResilienceHandler` with hand-tuned values (`:34-41`). Removing and re-adding, rather than leaving the client bare, is the pattern worth copying: the client is still retried, still circuit-broken, just on a timescale that matches the work. The inline comment (`:25-26`) records the reasoning at the call site.
- **Walkthrough**: a single `extension(IServiceCollection services)` block (`:13`, the codebase's standard DI idiom, see the primer's [`extension(T)` note](00-primer.md#c-extensiont-types-read-this-once)) exposes `AddModuleConferenceInfrastructure()` (`:19`).
  - **Sessionize** (`:21-23`): typed client with base address `https://sessionize.com/api/v2/`.
  - **Anthropic** (`:27-41`): base address `https://api.anthropic.com/` (`:30`), the API-version header `anthropic-version: 2023-06-01` (`:31`), and `HttpClient.Timeout = 5 minutes` (`:32`); then the tuned pipeline: attempt timeout 3 minutes (`:37`), circuit-breaker sampling duration 7 minutes (`:38`), total request timeout 5 minutes (`:39`), and `MaxRetryAttempts = 1` (`:40`), a deliberate single retry for an expensive call.
  - **Hosted service** (`:45`): `AddHostedService<SessionScoringProcessor>()`, with a comment (`:43-44`) noting the queue itself is registered by `AddModuleConferenceApplication`, so the producer lives in Application and only the consumer is wired here.
  - Returns `services` for chaining (`:47`).
- **Why it's built this way**: typed clients centralize base URL, default headers and the Polly pipeline so the adapter classes stay thin (compare the 26-line [`SessionizeService`](#sessionizeservice)). Pinning `anthropic-version` at registration is a supply-chain choice, `[Rubric §32, Dependency & Supply-Chain]`: the API contract this code parses is version-pinned, so a vendor-side default change cannot silently reshape the response.
- **Where it's used**: called from the Conference module's registration chain in the API layer (see [Conference API, gRPC contracts and service host](group-20-conference-api-grpc.md)), which is itself invoked by the module loader.

---

### ModuleApplicationDbContext

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:18` · Level 7 · class (abstract)

- **What it is**: an **abstract** EF Core context for the Conference module that declares typed `DbSet`s for thirteen Conference entities and inherits auditing, soft-delete and domain-event dispatch from the framework's [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext).
- **Depends on**: first-party: [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) (base), [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider), [`PhysicalDataSource`](group-07-persistence-ef-core.md#physicaldatasource), and the Conference entities it sets: [`Event`](group-17-conference-domain.md#event), [`Room`](group-17-conference-domain.md#room), [`EventSpeaker`](group-17-conference-domain.md#eventspeaker), [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer), [`Session`](group-17-conference-domain.md#session), [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker), [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer), [`SessionCategoryItem`](group-17-conference-domain.md#sessioncategoryitem), [`Speaker`](group-17-conference-domain.md#speaker), [`SpeakerCategoryItem`](group-17-conference-domain.md#speakercategoryitem), [`Category`](group-17-conference-domain.md#category), [`CategoryItem`](group-17-conference-domain.md#categoryitem), [`Question`](group-17-conference-domain.md#question). External: `Microsoft.EntityFrameworkCore`.
- **Concept introduced, the module-scoped DbSet manifest.** `[Rubric §8, Data Architecture]` assesses how persistence is organized per bounded context and `[Rubric §4, DDD]` assesses aggregate boundaries: this one file is the readable inventory of what the Conference database owns. The primary constructor forwards all four parameters straight to the base (`:18-23`), so it inherits audit stamping in `SaveChangesAsync`, the soft-delete global query filters, and the outbox capture of domain events with no code of its own ([ADR-005](https://ivanball.github.io/docs/adr/005-soft-delete-vs-erasure.html) soft-delete, [ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html) outbox).
- **Walkthrough**: the primary constructor `(DbContextOptions options, IServiceProvider serviceProvider, IEntityConfigurationAssemblyProvider assemblyProvider, PhysicalDataSource physicalDataSource)` chains to `ApplicationDbContext(...)` (`:18-23`). The body is nothing but thirteen `internal DbSet<T> { get; set; }` declarations (`:26-62`), each XML-documented. There is **no** `OnModelCreating` or `OnConfiguring` override: mapping comes entirely from the per-entity `EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>` classes discovered by assembly scanning (see the configurations later in this chapter).
- **Why it's built this way**: it mirrors database-per-service ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). Each module declares its own table surface inside its own Infrastructure project, so extracting the module into a standalone service (which ADC has already done, `MMCA.ADC.Conference.Service` over `ADC_Conference`) does not require untangling a shared context. The `DbSet`s are `internal` because only Infrastructure code addresses them directly.
- **Caveats / not-in-source**: **this abstract class is never inherited or instantiated anywhere in the ADC source or tests.** A repo-wide search for the symbol returns exactly three hits, the three declarations themselves (Conference `:18`, plus the identical files in Identity and Engagement Infrastructure). At runtime the concrete context is the sealed [`SQLServerDbContext`](group-07-persistence-ef-core.md#sqlserverdbcontext) from MMCA.Common, which also derives from `ApplicationDbContext` and builds its model by scanning `IEntityTypeConfiguration` types, not from these `DbSet`s ([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) mandates one concrete context class per engine). So treat this file as a **declarative manifest of the Conference bounded context's table surface**, not a live runtime context. A concrete symptom of that status: [`SessionAiScore`](group-17-conference-domain.md#sessionaiscore) is a real, configured, migrated Conference entity but has **no** `DbSet` here, and nothing breaks, because the manifest does not drive the model.

---

### ConferenceModuleDbSeeder

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts.Seeding` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:22` · Level 8 · class

- **What it is**: the Conference module's idempotent database seeder. It always seeds **two** real conference events and the standard feedback questions, and optionally seeds sample browse data (speakers, sessions, and the speaker-to-event links) when `includeSampleData` is set. It derives from the framework's [`DbSeeder`](group-07-persistence-ef-core.md#dbseeder) base.
- **Depends on**: first-party: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (constructor), [`IRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype) (obtained per aggregate), the domain factories on [`Event`](group-17-conference-domain.md#event), [`Question`](group-17-conference-domain.md#question), [`Speaker`](group-17-conference-domain.md#speaker) and [`Session`](group-17-conference-domain.md#session), and the invariant constants [`QuestionInvariants`](group-17-conference-domain.md#questioninvariants)`.ManualIdRangeStart` / [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants)`.ManualIdRangeStart`. External: `DateOnly`, `TimeOnly`, `DateTime`.
- **Concept reinforced, idempotent and environment-gated seeding through the domain factories.** `[Rubric §17, DevOps]` assesses repeatable, safe-to-re-run database initialization and `[Rubric §14, Testability]` assesses deterministic fixtures. Every seed step performs an `ExistsAsync` check before inserting (`:52-57` and `:84-89` for the two events, `:116-121` for the questions, `:173-178` per speaker, `:233-238` per session), so re-running against an already-seeded database is a no-op, which is exactly what production's `DatabaseInitStrategy=Migrate` startup path relies on. Just as important, every seeded row goes through the same `Event.Create` / `Question.Create` / `Speaker.Create` / `Session.Create` factories the command handlers use, each returning a `Result<T>` that is checked for `IsFailure` before `AddAsync` (`:71-72`, `:150-151`, `:190-191`, `:259-260`). There is no raw-insert back door, so seed data satisfies the identical invariants as user-created data. `[Rubric §4, DDD]` assesses whether invariants are enforced in one place; this is that guarantee holding even for infrastructure code.
- **Walkthrough**
  - **Constructor** (`:22`): primary constructor `(IUnitOfWork unitOfWork, bool includeSampleData = false)`. `unitOfWork` is null-guarded into a field (`:29`), and `includeSampleData` defaults to `false`, which is the production-safe default.
  - **Constants** (`:24-27`): the shared venue address, and the venue map URL carrying a narrowly scoped `S1075` suppression with a justification (`:26`). `[Rubric §15, Best Practices & Code Quality]` assesses whether analyzer suppressions are scoped and explained rather than blanket-disabled; this is the pattern.
  - **`SeedAsync`** (`:33-45`): runs the two event seeders and the question seeder unconditionally, then, only when `_includeSampleData` is true, the speaker, session and event-link seeders (`:39-44`). That `if` is the environment gate.
  - **`SeedCloudAiConferenceEventAsync`** (`:47-78`): seeds the "2026 Atlanta Cloud + AI Conference" (single day 2026-05-30, `America/New_York`, Sessionize code `z1ecmzux`, FCS Innovation Academy venue) and calls `.Publish()` on the created aggregate (`:74`) so it is immediately public. Its existence check matches **either** the current name or the pre-rename "Atlanta Cloud + AI Conference" (`:52-54`, comment at `:51`), so a database seeded before the rename does not get a duplicate.
  - **`SeedDevelopersConferenceEventAsync`** (`:80-110`): the same shape for the "2026 Atlanta Developers Conference" on 2026-10-17, with `sessionizeCode: null` (`:98`), the observable difference between an event whose sessions come from a Sessionize import and one that does not have a Sessionize submission yet.
  - **`SeedQuestionsAsync`** (`:112-157`): seeds ten standard feedback questions from a tuple array (`:123-135`), six Session-scoped (five `Rating` plus one `Text` "Comments") and four Event-scoped (three `Rating` plus one `Text`), all with `questionSource: "User"`. Ids are assigned explicitly starting at `QuestionInvariants.ManualIdRangeStart` (`:137`, `:142`), reserving a manual id band so seeded questions never collide with imported or organizer-created ones. One `SaveChangesAsync` covers all ten (`:156`).
  - **`SeedSpeakersAsync`** (`:159-199`, sample only): two sample speakers (Ada Lovelace, Alan Turing), each existence-checked individually so a partially seeded database completes, with a single `SaveChangesAsync` guarded by an `added` flag (`:197-198`).
  - **`SeedSessionsAsync`** (`:201-268`, sample only): resolves both seeded events (`:211-212`) and attaches one sample session to each ("Welcome & Keynote (Sample)" to Cloud + AI, "Building on Azure (Sample)" to Developers), so both the auto-filtered public pages and the organizer list's event filter have data in dev and CI (`:205-210`). Ids come from `SessionInvariants.ManualIdRangeStart` and `+ 1` (`:222-223`) because the `Session` int primary key **is** the Sessionize id (`:216-219`); the reserved range sits above any real Sessionize id. Start times are computed off the owning event's day at 13:00 UTC, which is 09:00 Eastern for both dates (`:240-241`).
  - **`SeedSampleEventLinksAsync`** (`:270-294`, sample only): loads the two sample speakers (`:274-284`) and links each to both its event ([`EventSpeaker`](group-17-conference-domain.md#eventspeaker), `:296-315`) and its session ([`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker), `:336-356`). Idempotency here is delegated to the aggregate: `AddEventSpeaker` / `AddSessionSpeaker` fail on an existing non-deleted link, and the seeder simply treats a failed add as "already there" (`:286-291`). The comment states why both link paths are seeded: it exercises the direct and the transitive branch of the speakers-by-event filter in dev and CI.
  - **`GetSampleEventsAsync`** (`:317-334`): the shared lookup, tracking enabled, that resolves both events by name (again tolerating the pre-rename Cloud + AI name) and returns them as a tuple.
- **Why it's built this way**: seeding through domain factories keeps seed data valid by construction; the `includeSampleData` flag keeps browse fixtures out of production while guaranteeing the public-browse E2E tests (`PublicBrowseTests.PublicSessionList_*` / `PublicSpeakerList_*`, named in the class remarks at `:18-20`) always find at least one session and one speaker row in dev and CI.
- **Where it's used**: constructed and run by [`ConferenceModuleSeeder`](group-20-conference-api-grpc.md#conferencemoduleseeder) in the API layer (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:21-29`), which resolves an `IUnitOfWork`, reads `Seeding:IncludeSampleConferenceData` from configuration (`:26`), and calls `SeedAsync`. That `IModuleSeeder` is invoked by the framework's database-initialization path after migrations. The flag is set to `true` only by the local Aspire AppHost (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:163-164`) and the E2E CI workflow; production leaves it unset.
- **Caveats / not-in-source**: the seeder never reads configuration itself; the boolean is decided entirely by its caller. The sample-session seeder also carries a documented limitation (`:208-210`): a database seeded before the per-event split keeps its old both-sessions-on-one-event shape, because the skip-by-title idempotency check never moves an existing row. Resetting the local SQL volume is the stated remedy.

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
to scalar columns under the database-per-service model (see [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)).

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
