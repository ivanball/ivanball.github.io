# 19. ADC Conference - Infrastructure & Persistence

**What this chapter covers.** This is the **adapter** layer of the Conference module, the place where
the engine-agnostic domain meets concrete technology. Three concerns live here: (1) **persistence
mapping**, the 17 EF Core entity configurations that turn plain domain classes into SQL Server tables,
the abstract `DbContext` that declares the module's `DbSet`s, and the seeder that puts the real
conference events and feedback questions into a fresh database; (2) **outbound integration and
background work**, the HTTP clients that talk to **Sessionize** (the conference's session-submission
platform) and to the **Anthropic Claude API** (the AI session scorer), the hosted worker that drains
the scoring queue off the request path, and the cron job that re-queues a scoring pass a crash cut in
half; and (3) the **DI wiring** that registers those services with the right resilience policy. It is
the per-module realization of Clean Architecture's ports and adapters idea: the
[Application](group-18-conference-application.md) layer declares the ports
([`ISessionizeService`](group-18-conference-application.md#isessionizeservice),
[`IAiScoringService`](group-18-conference-application.md#iaiscoringservice),
[`SessionScoringQueue`](group-18-conference-application.md#sessionscoringqueue)), and this
Infrastructure layer supplies the adapters and the runners. `[Rubric §3, Clean Architecture]` assesses
whether dependencies point inward and the domain stays framework-free; here every EF, HTTP, and
Anthropic concern is quarantined in Infrastructure, so the domain entities in
[Group 17](group-17-conference-domain.md) carry no persistence or transport attribute at all.

## Engine-agnostic entities, engine chosen by the config base class

The most important idea in this chapter is one the entities themselves never express: **what storage
engine each entity uses is decided here, not in the domain.** A Conference domain entity,
[`Session`](group-17-conference-domain.md#session), [`Speaker`](group-17-conference-domain.md#speaker),
[`Event`](group-17-conference-domain.md#event), [`Sponsor`](group-17-conference-domain.md#sponsor),
[`Activity`](group-17-conference-domain.md#activity), the join entities, is a plain class. The *only*
thing that binds it to SQL Server is which base class its configuration inherits from. All 17 configs in
this group ([`SessionConfiguration`](#sessionconfiguration),
[`SpeakerConfiguration`](#speakerconfiguration), [`EventConfiguration`](#eventconfiguration),
[`SponsorConfiguration`](#sponsorconfiguration), [`ActivityConfiguration`](#activityconfiguration), and
the rest) derive from
[`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype)
(for example `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Sessions/SessionConfiguration.cs:12-13`
and `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Activities/ActivityConfiguration.cs:11-12`),
which is a thin shim carrying `[UseDataSource(DataSource.SQLServer)]`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationSQLServer.cs:16-17`)
over the engine-neutral
[`EntityTypeConfiguration<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationtentity-tidentifiertype).
That attribute is what [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry)
reads to decide which physical database an entity belongs to. Swapping just that one base class would
re-point the same `Session` to Cosmos or SQLite with zero change to the domain, the application
handlers, or the entity: this is the per-entity half of the **database-per-service** strategy
([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html),
[ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html)). `[Rubric §8, Data
Architecture]` (deliberate persistence: transactions, migrations, soft-delete, audit, concurrency) is
the dominant lens for the whole persistence half of this chapter.

## Each config inherits the cross-cutting behavior, then adds entity specifics

Every configuration's `Configure` method begins with `base.Configure(builder)` (for example
`SessionConfiguration.cs:18`, `ActivityConfiguration.cs:17`) and *then* adds its own mappings. That one
`base` call is where the framework injects the conventions applied uniformly: the strongly-typed key,
the table name and module schema, and the concurrency token, none of which any individual config
re-states. The per-entity bodies then declare what is unique: column lengths sourced from the domain's
invariant constants (`SessionInvariants.TitleMaxLength` at `SessionConfiguration.cs:20-22`,
`EventInvariants.NameMaxLength` at `EventConfiguration.cs:20-22`, `SponsorInvariants.NameMaxLength` at
`SponsorConfiguration.cs:19-21`, `ActivityInvariants.NameMaxLength` at `ActivityConfiguration.cs:19-21`),
required and optional flags, computed properties excluded with `builder.Ignore(...)` (`Session.Duration`
at `SessionConfiguration.cs:67`, `Speaker.FullName` at `SpeakerConfiguration.cs:68`), value conversions
(`Speaker.Email` round-trips through
[`NullableEmailValueConverter`](group-07-persistence-ef-core.md#nullableemailvalueconverter) at
`SpeakerConfiguration.cs:42-45`, and `Sponsor.Tier` is stored as its underlying `int` with
`HasConversion<int>()` so tier ordering is a plain column sort and adding a package later does not
rewrite existing rows, `SponsorConfiguration.cs:23-27`), and decimal precision (`HasPrecision(3, 1)` on
the overall AI score and all six sub-scores, `SessionAiScoreConfiguration.cs:22-48`, next to a
4000-character `Reasoning`, a 100-character `ModelUsed` and a 32-character `PromptVersion`,
`SessionAiScoreConfiguration.cs:50-63`, the last of which records which prompt contract produced the row).
A config also states how EF reaches an **encapsulated collection**: `Event`'s navigations are getters over
private list fields, so [`EventConfiguration`](#eventconfiguration) pins
`UsePropertyAccessMode(PropertyAccessMode.Field)` on `Rooms`, `EventSpeakers` and `EventQuestionAnswers`
(`EventConfiguration.cs:92-97`). Convention already infers field access there; stating it makes
materialization independent of that inference, and it is access mode only, no schema change
(`EventConfiguration.cs:86-91`).

**Filtered indexes** are where the soft-delete convention becomes visible, and the split is worth
learning because it is easy to misread. Unique indexes on a soft-deletable entity get the
`IsDeleted = 0` predicate **automatically**, applied by
[`SoftDeleteUniqueIndexConvention`](group-07-persistence-ef-core.md#softdeleteuniqueindexconvention)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/SoftDeleteUniqueIndexConvention.cs:43-54`),
so a soft-deleted link never blocks a re-insert;
[`CategoryItemConfiguration`](#categoryitemconfiguration) relies on exactly that and declares its unique
(CategoryId, Name) index with no filter call at all (`CategoryItemConfiguration.cs:30-31`). A
hand-authored **non-unique** index is deliberately left alone by the convention and opts in explicitly
through
[`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions)`.HasSoftDeleteFilter()`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/IndexBuilderExtensions.cs:20-29`),
which replaces the old literal `HasFilter("[IsDeleted] = 0")` by reading the column name from the model
and the quoting from the engine. Five lookup indexes here take that opt-in: `Session.EventId`
(`SessionConfiguration.cs:77-78`), `Sponsor.EventId` (`SponsorConfiguration.cs:67-68`),
`EventQuestionAnswer.EventId` (`EventQuestionAnswerConfiguration.cs:35-36`), and both of
[`ActivityConfiguration`](#activityconfiguration)'s, the plain `EventId` lookup
(`ActivityConfiguration.cs:58-59`) and the composite (EventId, StartTime, SortOrder) that serves the
public activities page's ordering directly instead of sorting an event slice in memory
(`ActivityConfiguration.cs:61-64`). Several unique indexes also call it explicitly for readability even
though the convention would supply it: [`SessionSpeakerConfiguration`](#sessionspeakerconfiguration)'s
(SessionId, SpeakerId) pair (`SessionSpeakerConfiguration.cs:30-32`), the one-score-per-session index on
[`SessionAiScoreConfiguration`](#sessionaiscoreconfiguration) (`SessionAiScoreConfiguration.cs:66-68`),
the equivalent pairs on [`EventSpeakerConfiguration`](#eventspeakerconfiguration)
(`EventSpeakerConfiguration.cs:30-32`),
[`SessionCategoryItemConfiguration`](#sessioncategoryitemconfiguration)
(`SessionCategoryItemConfiguration.cs:30-32`) and
[`SpeakerCategoryItemConfiguration`](#speakercategoryitemconfiguration)
(`SpeakerCategoryItemConfiguration.cs:30-32`), the per-event room name on
[`RoomConfiguration`](#roomconfiguration) (`RoomConfiguration.cs:52-54`), and the one-answer-per-user
(entity, question, creator) triples on
[`SessionQuestionAnswerConfiguration`](#sessionquestionanswerconfiguration)
(`SessionQuestionAnswerConfiguration.cs:43-45`) and
[`EventQuestionAnswerConfiguration`](#eventquestionanswerconfiguration)
(`EventQuestionAnswerConfiguration.cs:42-44`).

Two indexes are deliberately **unfiltered**, and both carry a comment explaining why, because in each
case the filtered composite next to them is not a substitute. `RoomConfiguration` re-declares the
conventional foreign-key index on `EventId` (`RoomConfiguration.cs:46-48`) because EF drops it as
redundant once the composite (EventId, Name) index leads with the same column, while the foreign-key
lookups still want it. `SessionQuestionAnswerConfiguration` keeps its plain `SessionId` index
(`SessionQuestionAnswerConfiguration.cs:34-37`) because the Sessionize sync reads that table by
`SessionId` with the global query filters **off**, and a filtered index cannot serve a query that does
not carry the predicate. **Sparse** filters are a different thing again and stay literal, because they
filter on a nullable business column rather than on soft-delete: `Speaker.LinkedUserId` is unique only
where it is set (`SpeakerConfiguration.cs:63-65`, the User-to-Speaker link), and `Event.SessionizeCode`
is indexed only where present (`EventConfiguration.cs:42-43`). Two further quirks are worth knowing:
[`ConferenceCategoryConfiguration`](#conferencecategoryconfiguration) calls
`ToTable("Category", "Conference")` explicitly (`ConferenceCategoryConfiguration.cs:22-24`) so the
Conference `Category` table cannot collide with another module's `Category`, and
[`SessionConfiguration`](#sessionconfiguration) maps the Session-to-Room relationship with
`OnDelete(DeleteBehavior.Restrict)` (`SessionConfiguration.cs:83-87`) so deleting a room can never
cascade sessions away. Two configs declare no index at all and map columns only,
[`QuestionConfiguration`](#questionconfiguration) (`QuestionConfiguration.cs:10`) and
[`SpeakerQuestionAnswerConfiguration`](#speakerquestionanswerconfiguration)
(`SpeakerQuestionAnswerConfiguration.cs:10`).

## DbSets, the context shape, and how the configurations are actually found

[`ModuleApplicationDbContext`](#moduleapplicationdbcontext)
(`MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:20`) is the
Conference module's abstract `DbContext`. It does one job: declare 15 `internal DbSet<T>` properties
(`Events`, `Rooms`, `EventSpeakers`, `EventQuestionAnswers`, `Sessions`, `SessionSpeakers`,
`SessionQuestionAnswers`, `SessionCategoryItems`, `Speakers`, `SpeakerCategoryItems`, `Categories`,
`CategoryItems`, `Questions`, `Sponsors`, `Activities`, at `ModuleApplicationDbContext.cs:28-70`). It is
**abstract** and inherits from the Common
[`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) through its primary
constructor (`ModuleApplicationDbContext.cs:20-25`), from which it gets the real machinery: the
`SaveChangesAsync` override that stamps audit fields and captures domain events into the outbox, and the
global soft-delete query filters applied to every auditable entity. The concrete class EF actually
instantiates is the single [`SQLServerDbContext`](group-07-persistence-ef-core.md#sqlserverdbcontext) in
the Common framework: **one concrete context class per engine, one instance per database**
([ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html)). The codebase deliberately
does not split into per-module context classes.

A detail that surprises most readers: a `DbSet` is *not* what puts an entity in the model. The base
context walks the registered configuration assemblies and applies every
`IEntityTypeConfigurationSQLServer<,>` implementation whose entity resolves to this context's data
source key
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:610-637`,
with the engine-to-interface switch at `:612-618` and the registry filter at `:625-636`). That is why two
entities with a configuration here, [`SessionAiScore`](group-17-conference-domain.md#sessionaiscore) and
[`SpeakerQuestionAnswer`](group-17-conference-domain.md#speakerquestionanswer), are mapped and queryable
through the repository layer even though `ModuleApplicationDbContext` declares no `DbSet` for either:
17 configurations, 15 `DbSet`s, and the configurations win. `[Rubric §7, Microservices Readiness]` (can a
module become its own service without a rewrite?) is embodied here: the Conference module already runs as
`MMCA.ADC.Conference.Service` over its own `ADC_Conference` database
(`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:32`) with its own outbox, and cross-module
references (a speaker's linked user, a bookmark's session) are scalar columns resolved via gRPC and
integration events, never cross-database foreign keys.

## Seeding: two real events always, sample data only in dev and CI

[`ConferenceModuleDbSeeder`](#conferencemoduledbseeder)
(`MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:25`)
derives from the framework's [`DbSeeder`](group-07-persistence-ef-core.md#dbseeder) and runs after schema
initialization, constructed by [`ConferenceModuleSeeder`](group-20-conference-api-grpc.md#conferencemoduleseeder)
in the API layer (`MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:28`). It is idempotent: every step
first issues an `ExistsAsync` check through the repository and returns early if the row is present
(`ConferenceModuleDbSeeder.cs:69-74`, `:103-108`, `:137-142`), which is what makes it safe to run on every
startup under the production `Migrate` init strategy
([ADR-030](https://ivanball.github.io/docs/adr/030-startup-sole-migrator.html)). It **always** seeds three
things (`ConferenceModuleDbSeeder.cs:50-52`): the **2026 Atlanta Cloud + AI Conference** (2026-05-30,
`America/New_York`, Sessionize code `z1ecmzux`, `ConferenceModuleDbSeeder.cs:76-88`), the **2026 Atlanta
Developers Conference** (2026-10-17, Sessionize code `sf1nopko`, `ConferenceModuleDbSeeder.cs:110-122`),
both published immediately after creation (`:93` and `:127`) and both carrying the shared venue address,
map URL and their own published sponsorship-packet URL (`ConferenceModuleDbSeeder.cs:27-42`), and the
fixed set of **10 feedback questions** (5 session ratings plus a session comment, 3 conference ratings
plus a conference comment, `ConferenceModuleDbSeeder.cs:144-156`) whose ids start at
[`QuestionInvariants`](group-17-conference-domain.md#questioninvariants)`.ManualIdRangeStart`
(`ConferenceModuleDbSeeder.cs:158`) so they never collide with imported data.

It **conditionally** seeds five more things (`ConferenceModuleDbSeeder.cs:54-61`): two sample speakers
(Ada Lovelace and Alan Turing, `:184-188`), two sample sessions with app-assigned ids from
[`SessionInvariants`](group-17-conference-domain.md#sessioninvariants)`.ManualIdRangeStart`, one per
seeded event (`:241-245`, and the ids are explicit because a Session's int PK *is* its Sessionize id, so
the sample rows take a reserved range above any real one, `:237-240`), the EventSpeaker plus
SessionSpeaker links between them (`:310-311`), four sample sponsors across the Platinum, Gold, Silver
and Community tiers, two of them exhibitors with booth numbers (`:349-355`), and three sample social
activities (a pre-conference party the evening before the Developers Conference, a morning coffee
connect, and an after-party) whose event-local wall-clock times are anchored on each event's own start
date (`:409-425`, `:441`). All of that runs only when `includeSampleData` is set. The flag comes from
`Seeding:IncludeSampleConferenceData` (`MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:26`), which the
local Aspire AppHost sets (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:162`) and production
leaves unset. The reason is documented in the seeder's own remarks
(`ConferenceModuleDbSeeder.cs:17-24`): the public-browse E2E tests need at least one session and one
speaker row to exist deterministically, while production's real sessions and speakers arrive through the
Sessionize import. The links are created on *both* paths deliberately, so the direct (EventSpeaker) and
the transitive (SessionSpeaker) branches of the speakers-by-event filter are both exercised in dev and CI
(`ConferenceModuleDbSeeder.cs:307-309`).

## The Sessionize adapter

[`SessionizeService`](#sessionizeservice)
(`MMCA.ADC.Conference.Infrastructure/Events/Sessionize/SessionizeService.cs:10`) is a deliberately thin HTTP
client: the whole class is one method. Given a Sessionize event code it builds the relative URI
`{code}/view/All` (`SessionizeService.cs:15`), calls `GetAsync`, asserts success with
`EnsureSuccessStatusCode` (`SessionizeService.cs:20`), and deserializes into the
[`SessionizeResponse`](group-18-conference-application.md#sessionizeresponse) model owned by the
Application layer (`SessionizeService.cs:22-24`). Unlike the AI adapter it **does** throw on a bad
status, because the import use-case that calls it is a foreground operation with a caller waiting on the
result. It is registered as a typed `HttpClient` in [`DependencyInjection`](#dependencyinjection) with
the base address `https://sessionize.com/api/v2/` baked in
(`MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:23-25`), so it inherits the standard Aspire
resilience handler (Polly retry, timeout, circuit breaker) unchanged: `[Rubric §29, Resilience &
Business Continuity]`, the [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)
policy that every outbound client gets resilience by default. The thinness is intentional: parsing,
mapping, and the import workflow live in Application use-cases, and this adapter owns only the wire call.

## The Anthropic AI scoring adapter

[`AnthropicScoringService`](#anthropicscoringservice)
(`MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AnthropicScoringService.cs:19`) is the richer of the
two adapters: it scores one session proposal against a Program Committee rubric using the **Anthropic
Claude Messages API**. It implements [`IAiScoringService`](group-18-conference-application.md#iaiscoringservice),
publishes both the model id it calls (`claude-haiku-4-5`, `AnthropicScoringService.cs:26`) and a dated
`PromptVersion` (`2026-09-04.1`, `AnthropicScoringService.cs:37`), reads the API key from configuration
(`Anthropic:ApiKey`, expected in user secrets, `AnthropicScoringService.cs:44-49`), POSTs to the relative
`v1/messages` endpoint with an `x-api-key` header (`AnthropicScoringService.cs:67-69`), and caps the
response at 256 tokens (`AnthropicScoringService.cs:58`). Its contract is precise about failure: it
**never throws for a scoring failure**, but **cancellation propagates**. Every failure path (missing key,
non-2xx status, a `stop_reason` of `"refusal"`, no text block in the response, unparseable JSON, a partial
score object, any other exception) funnels into `FailedResult`, which returns zero scores with
`Success = false` (`AnthropicScoringService.cs:366-379`), while the catch filter
`when (ex is not OperationCanceledException)` (`AnthropicScoringService.cs:83`) lets host shutdown unwind.
That split matters because scoring runs in batches: one bad proposal must not abort the batch, but a
deploy must still be able to stop the run.

The wire shapes are eight private sealed records nested inside the service: the request envelope
[`AnthropicRequest`](#anthropicrequest) (`AnthropicScoringService.cs:434`) with its
[`AnthropicMessage`](#anthropicmessage) list (`AnthropicScoringService.cs:467`) and its
[`AnthropicOutputConfig`](#anthropicoutputconfig) (`AnthropicScoringService.cs:452`) wrapping an
[`AnthropicJsonSchemaFormat`](#anthropicjsonschemaformat) (`AnthropicScoringService.cs:458`); the response
envelope [`AnthropicResponse`](#anthropicresponse) (`AnthropicScoringService.cs:476`) with its
[`AnthropicContentBlock`](#anthropiccontentblock) list (`AnthropicScoringService.cs:497`) and its
[`AnthropicUsage`](#anthropicusage) token counts (`AnthropicScoringService.cs:488`); and
[`AiScoreResponse`](#aiscoreresponse) (`AnthropicScoringService.cs:508`), the score JSON the model emits.
Their snake_case `[JsonPropertyName]` names are the only place the vendor's contract appears, so the
Application layer sees only
[`SessionScoringResult`](group-18-conference-application.md#sessionscoringresult): that is
`[Rubric §32, Dependency & Supply-Chain]` in miniature.

The output is **schema-constrained rather than parsed out of prose**. `BuildScoreSchema()` emits a JSON
Schema naming the six criteria as numbers, a `penalty` restricted to `0`, `0.5` or `1`, and a `reasoning`
string, with `additionalProperties = false` and every field required
(`AnthropicScoringService.cs:394-425`); it is built once into the static `ScoreSchema`
(`AnthropicScoringService.cs:392`) and rides the request's `output_config`
(`AnthropicScoringService.cs:61-64`). Because the model can only answer in that shape, the whole text
block is the JSON object and deserialization is a single `JsonSerializer.Deserialize<AiScoreResponse>`
call, with anything else (prose, fences, truncation) treated as a failed call
(`AnthropicScoringService.cs:116-129`). Two defenses remain behind that: the response's `content` list is
searched for the first `"text"` block (`AnthropicScoringService.cs:104-111`), and the six sub-scores and
the penalty are **nullable** so a partial object is rejected by a property pattern rather than silently
defaulting to zero (`AnthropicScoringService.cs:135-147`, with the reason spelled out at
`AnthropicScoringService.cs:506-507`). The overall score is the documented weighted sum (topic 30%,
description 10%, novelty 20%, takeaways 20%, depth 10%, credibility 10%) minus the penalty
(`AnthropicScoringService.cs:151-162`), and every value is clamped to `[1.0, 10.0]` and rounded to one
decimal with banker's rounding (`AnthropicScoringService.cs:364`).

The prompt itself is treated as an attack surface, which is the `[Rubric §11, Security]` story here
alongside the obvious one (the API key is a configuration secret, never hard-coded). Everything a speaker
typed arrives through a public call-for-papers form, so the user message is a delimited envelope
(`<session_proposal>` with `<session_title>`, `<session_description>` and a `<speakers>` block,
`AnthropicScoringService.cs:231-267`) rather than labelled lines, angle brackets in every submitted value
are escaped so a submission cannot forge a delimiter (`AnthropicScoringService.cs:295-298`), and emails
and North-American phone shapes are redacted by source-generated regexes before the text leaves the
process (`AnthropicScoringService.cs:303-320`); speaker names are deliberately left intact because they
are the published conference record and the only evidence the credibility criterion has
(`AnthropicScoringService.cs:253-257`). The system brief carries a matching `UntrustedInputBrief`
constant (`AnthropicScoringService.cs:217-224`) that declares the tagged content data, not instructions,
and routes an injection attempt to the existing 1.0 penalty. `RenderPrompt` exposes the exact prompt pair
without calling the API (`AnthropicScoringService.cs:277-284`) so the golden evaluation suite can hash it
per `PromptVersion`: the remarks on `PromptVersion` state the rule that any edit to the prompt, the
speaker formatting, the redaction rules or the schema must bump the version, so an unversioned edit fails
a test instead of quietly re-basing scores already on the dashboard (`AnthropicScoringService.cs:29-36`).

`[Rubric §13, Observability & Operability]` and `[Rubric §31, Cost/FinOps]` meet in the usage path.
Every response's `usage` block is both logged per session and recorded on counters
(`AnthropicScoringService.cs:92-96`): the nested
[`ScoringInstruments`](#scoringinstruments) holder
(`AnthropicScoringService.cs:326`) creates `scoring.tokens.input` and `scoring.tokens.output`
(`AnthropicScoringService.cs:343-351`) on the **same** meter name the scoring processor already exports,
`SessionScoringProcessor.MeterName` (`AnthropicScoringService.cs:340`), so a host that exports one
exports all of them, and tags both by model and prompt version because those are exactly what move spend
(`AnthropicScoringService.cs:354-361`). The holder exists rather than two field initializers so the meter
is created once per service instance, and it deliberately does not dispose the meter the factory owns
(`AnthropicScoringService.cs:322-341`). Two `[LoggerMessage]` source-generated methods carry the log
half: a warning naming the session id and the failure reason, and an information line with the input and
output token counts (`AnthropicScoringService.cs:427-431`).

## Scoring runs on a hosted drain, guarded across replicas

[`SessionScoringProcessor`](#sessionscoringprocessor)
(`MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/SessionScoringProcessor.cs:49`) is the piece that makes a
multi-minute paid AI pass safe to trigger from an HTTP POST. It is a `BackgroundService` that consumes
[`SessionScoringQueue`](group-18-conference-application.md#sessionscoringqueue) with
`ReadAllAsync(stoppingToken)` (`SessionScoringProcessor.cs:107`), so the host owns the work: shutdown
cancels it and waits for it to unwind instead of a deploy or a scale-in tearing down a half-finished run.
This is the concrete adoption of
[ADR-052](https://ivanball.github.io/docs/adr/052-background-job-execution.html) (bounded queue plus
single-reader hosted drain), and it replaced an untracked fire-and-forget task the controller used to
start.

The queue's dedup lives in one process's memory, and Conference runs at `maxReplicas: 2`
(the `conferenceApp` container app at `MMCA.ADC/infra/main.bicep:1236`, scale rule at
`MMCA.ADC/infra/main.bicep:1357`), so the queue alone never stopped two organizer triggers landing on
different replicas from each running a full paid pass over the same sessions. The worker therefore takes
a **cross-replica lock** before invoking the handler: it creates a per-item DI scope
(`CreateAsyncScope`, `SessionScoringProcessor.cs:160`) because the drain itself is a singleton while the
[`ScoreEventSessionsCommand`](group-18-conference-application.md#scoreeventsessionscommand) handler is
scoped, resolves an [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) from that scope
(`:175`), and calls `TryAcquireAsync` on the key `scoring:inflight:{eventId}` with a 15-minute
time-to-live and a zero wait (`:85`, `:92`, `:101-102`, `:177-179`). A losing replica logs and returns
rather than queueing behind the winner (`:181-188`), because waiting would only mean paying for the same
pass twice in a row. The handle is disposed by an `await using` around the whole run, so the lock comes
back on success, on failure, and via its time-to-live even when the replica is killed mid-pass: the
comment at `:162-174` records that this replaced a cache counter released in a `finally`, which left a
killed replica's key stuck at 1 and locked the event out until an operator cleared it by hand, and it
records the honest limit that a host with no Redis configured falls back to the in-process
`IDistributedLock`, where exclusion is per replica again. Note the doc drift here: ADR-052 still
describes dedup as per-replica and a distributed lock as the point at which this would need a real job
system (`Website/docs-src/adr/052-background-job-execution.md:92-95`), but the lock is in the code today.

Failure handling is decided once instead of per call site. A cancellation during shutdown logs and
returns without requeuing (`SessionScoringProcessor.cs:115-123`); any other exception is caught under an
explicit `CA1031` suppression whose comment states the rule, one failed run must not kill the drain
(`:124-129`); the queue's dedup claim is released in a `finally` (`queue.MarkCompleted(item.EventId)`,
`:130-136`) *before* any requeue, because the order matters (`MarkCompleted` would otherwise clear the
claim a requeue had just re-taken). A thrown failure is retried by re-queuing the item with an incremented
attempt up to `MaxAttempts = 3` (`:74`, `:143-147`), and the ceiling is low on purpose: scoring is paid,
so retries exist to absorb a rate-limit blip, not to grind against an outage. A run that instead returns a
[`Result`](group-01-result-error-handling.md#result) failure is deliberately **not** retried (`:196-205`):
the handler answered, and a business refusal replayed twice more just costs money. When every attempt is
exhausted the terminal path increments the `scoring.run.failed.terminal` counter tagged by event
(`:96-99`, `:150`) on the `MMCA.ADC.Conference.Scoring` meter (`:59`), which the service host exports by
registering that meter name (`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:135`): that
is `[Rubric §13, Observability & Operability]` closing the loop on work that no user is waiting for.

The output cache is evicted **twice** per run, once up front so polling clients stop seeing stale scores
and once after a successful pass (`SessionScoringProcessor.cs:158` and `:208`), and it evicts the narrow
`conference:sessions` tag rather than the root `conference` tag. The comment above that constant records
why in production terms (`:61-66`): evicting the root flushed events, speakers, rooms, categories, and
questions too, so an organizer triggering a scoring run during the event emptied the whole public read
surface onto the Basic-tier database while attendees were browsing. `[Rubric §12, Performance &
Scalability]` and `[Rubric §31, Cost/FinOps]` both live in that one constant
([ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html),
[ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)).

## The sweep that finishes what a crash interrupted

The drain is fast but not durable: the channel lives in one replica's memory, so a deploy, a scale-in or
a crash between the organizer's click and the last session's score leaves an event half scored with
nothing anywhere that would pick it up again.
[`SessionScoringSweepJob`](#sessionscoringsweepjob)
(`MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/SessionScoringSweepJob.cs:54`) is the backstop for exactly
that. It is an [`IScheduledJob`](group-05-cqrs-pipeline.md#ischeduledjob) named
`conference-session-scoring-sweep` with the cron expression `*/5 * * * *`
(`SessionScoringSweepJob.cs:69`, `:77`), so the framework's recurring-job scheduler
([ADR-074](https://ivanball.github.io/docs/adr/074-recurring-job-scheduler.html)) runs it every five
minutes, once across the whole service rather than once per replica, under the persistent claim lease the
outbox pattern established
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/IScheduledJob.cs:16-20`). A host overrides
the cadence through `Scheduler:Jobs:conference-session-scoring-sweep:Cron` without touching code
(`SessionScoringSweepJob.cs:72-76`).

There is no scoring-state column on `Event`, so the job derives the condition from the rows the scoring
handler already writes. It projects every non-service session into
[`SessionScoringCandidate`](#sessionscoringcandidate) (`SessionScoringSweepJob.cs:86-89`, `:208`) and
every persisted score into [`SessionScoreStamp`](#sessionscorestamp) (`:98-100`, `:213`), collapses the
stamps to the newest per session (`:118-132`), then groups the candidates by event (`:105-108`) and
judges each one: an event is mid-pass exactly when **some but not all** of its scorable sessions carry a
score (`:170-173`). Two bounds keep a wrong guess from spending money. An event with **zero** scores is
never enqueued, because nobody asked for it and starting a pass the organizer did not request would bill
every event in the database on the first tick. A partially scored event is enqueued only while its newest
score is inside the 24-hour `RecoveryWindow` (`:66`, `:103`, `:175-179`), so a crash is recovered but a
session the model will never score cannot re-trigger paid passes forever; past that the job logs that it
is leaving the event alone and an organizer re-triggers by hand (`:195-202`). Beyond the enqueue the job
is read-only, and the enqueue itself is safe to repeat because the queue's pending set refuses an event
that is already queued or running, which the job records as the outcome on its log line (`:181-182`,
`:185-193`). `[Rubric §29, Resilience & Business Continuity]` is the lens: the fast path stays in memory,
and a slow, cheap, idempotent sweep notices what the fast path dropped.

## DI wiring and a deliberate resilience override

[`DependencyInjection`](#dependencyinjection)
(`MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:13`) is a single
`extension(IServiceCollection)` block (the codebase's standard DI-registration idiom, taught in the
primer) exposing `AddModuleConferenceInfrastructure()` (`DependencyInjection.cs:20-57`). It registers
both adapters as typed HTTP clients, the drain as a hosted service (`DependencyInjection.cs:46`), and the
sweep as a scheduled job (`DependencyInjection.cs:54`). That last registration carries a nuance worth
reading: the job is registered by the **module**, the way the framework's own audit-trail retention job
is, and it only actually runs in a host that also calls `AddScheduledJobs` and turns the scheduler on,
which `MMCA.ADC.Conference.Service` does
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:314`); anywhere else the registration
is inert (`DependencyInjection.cs:48-53`). The Anthropic client gets a **custom resilience policy**: a
5-minute `HttpClient.Timeout` and the `anthropic-version: 2023-06-01` header
(`DependencyInjection.cs:31-33`), then `RemoveAllResilienceHandlers()` followed by a re-added
`StandardResilienceHandler` with a 3-minute attempt timeout, a 7-minute circuit-breaker sampling window,
a 5-minute total request timeout, and only **one** retry (`DependencyInjection.cs:35-42`). The inline
comment explains why (`DependencyInjection.cs:26-27`): AI scoring of a large batch can take minutes,
which would blow through Aspire's default 30s attempt and 90s total limits, and retrying an expensive LLM
call aggressively is wasteful. This is a precise illustration of
[ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html): every
outbound client is resilient by default, but a client with genuinely different latency characteristics
tunes the policy rather than disabling it. The Sessionize client takes the defaults unchanged.

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
(`MMCA.ADC.Conference.API/Controllers/Sessions/SessionSelectionController.cs:110-131`),
[`SessionScoringProcessor`](#sessionscoringprocessor) picks the event up, evicts the sessions cache tag,
claims the event's distributed lock, runs the scoped command handler which calls
[`AnthropicScoringService`](#anthropicscoringservice) once per session under the tuned resilience policy,
persists one `SessionAiScore` row per session behind the unique filtered index, and evicts the tag again;
if that run dies mid-pass, [`SessionScoringSweepJob`](#sessionscoringsweepjob) notices the partial result
within five minutes and puts the event back on the queue. The two marker types in this assembly,
[`AssemblyReference`](#assemblyreference) and [`ClassReference`](#classreference)
(`MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:5` and
`MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:11`), exist purely so the module loader and the
configuration-assembly scan can reach this assembly by a stable `typeof()` handle instead of a hard-coded
type list, the same extension point every module assembly provides.

### AssemblyReference

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:5` · Level 0 · class (static)

- **What it is**: the assembly-marker type for the Conference Infrastructure assembly: a stable handle that reflection-based scanning can hold instead of a hard-coded assembly name string.
- **Depends on**: `System.Reflection` only. No first-party types.
- **Concept**: cross-reference the framework explanation under [AssemblyReference](group-17-conference-domain.md#assemblyreference) in the Conference Domain chapter; every layer of every module ships an identical pair, and the [module system](group-14-module-system-composition.md#assemblyreference) chapter teaches why.
- **Walkthrough**: two `public static readonly` fields (`AssemblyReference.cs:7-8`): `Assembly = typeof(AssemblyReference).Assembly`, and `AssemblyName` = its simple name with a `?? string.Empty` fallback so the field is never null.
- **Why it's built this way**: assembly scanning (EF `IEntityTypeConfiguration` discovery, handler and mapper registration) and the module loader all need a per-assembly token; taking `typeof(AssemblyReference).Assembly` survives renames and trimming better than a literal name.
- **Where it's used**: Conference module registration and EF configuration discovery scan this assembly through this marker, which is how the sixteen configuration classes in this chapter are found without being listed anywhere.

---

### ClassReference

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:11` · Level 0 · class

- **What it is**: an empty, non-static class whose only purpose is to be a `typeof(...)` or generic anchor for registration APIs that take a type rather than an `Assembly`.
- **Depends on**: nothing.
- **Concept**: cross-reference [ClassReference](group-14-module-system-composition.md#classreference) where the pattern is introduced.
- **Walkthrough**: the whole declaration is one line, `public class ClassReference { }` (`AssemblyReference.cs:11`). It is deliberately non-static (unlike its sibling above) because a static class cannot be used as a generic type argument.
- **Why it's built this way**: some registration helpers are shaped as `Add...(typeof(T))` or `Add...<T>()`; an empty public class gives those calls a target without exposing a real implementation type.
- **Where it's used**: assembly-scanning registration call sites in the Conference module composition path (see [Conference API, gRPC contracts and service host](group-20-conference-api-grpc.md)).

---

### DependencyInjection

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:13` · Level 10 · class (static)

- **What it is**: the DI wiring for Conference Infrastructure. It registers the two outbound HTTP integrations as typed clients, the AI scoring drain as a hosted service, and the scoring crash-recovery sweep as a scheduled job.
- **Depends on**: first-party: [ISessionizeService](group-18-conference-application.md#isessionizeservice) with [SessionizeService](#sessionizeservice), [IAiScoringService](group-18-conference-application.md#iaiscoringservice) with [AnthropicScoringService](#anthropicscoringservice), [SessionScoringProcessor](#sessionscoringprocessor), [SessionScoringSweepJob](#sessionscoringsweepjob). External: `Microsoft.Extensions.DependencyInjection`, `Microsoft.Extensions.Http.Resilience` (Polly).
- **Concept introduced, tuning a resilience pipeline instead of disabling it.** `[Rubric §29, Resilience & Business Continuity]` assesses [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)'s rule that every outbound client carries a resilience handler. The Sessionize client (`:22-24`) is a plain `AddHttpClient<TInterface, TImplementation>` with only a base address, so it inherits the standard handler configured by the Aspire service defaults. The Anthropic client is the interesting case: an AI batch can run for minutes, far past the Aspire default of a 30 second attempt and 90 second total, so the code calls `RemoveAllResilienceHandlers()` (`:35`) and immediately re-adds `AddStandardResilienceHandler` with hand-tuned values (`:36-42`). Removing and re-adding, rather than leaving the client bare, is the pattern worth copying: the client is still retried, still circuit-broken, just on a timescale that matches the work. The inline comment (`:26-27`) records the reasoning at the call site.
- **Walkthrough**: a single `extension(IServiceCollection services)` block (`:14`, the codebase's standard DI idiom, see the primer's [extension(T) note](00-primer.md#c-extensiont-types-read-this-once)) exposes `AddModuleConferenceInfrastructure()` (`:20`).
  - **Sessionize** (`:22-24`): typed client with base address `https://sessionize.com/api/v2/`.
  - **Anthropic** (`:28-42`): base address `https://api.anthropic.com/` (`:31`), the API-version header `anthropic-version: 2023-06-01` (`:32`), and `HttpClient.Timeout` of 5 minutes (`:33`); then the tuned pipeline, attempt timeout 3 minutes (`:38`), circuit-breaker sampling duration 7 minutes (`:39`), total request timeout 5 minutes (`:40`), and `MaxRetryAttempts = 1` (`:41`), a deliberate single retry for an expensive call.
  - **Hosted service** (`:46`): `AddHostedService<SessionScoringProcessor>()`, with a comment (`:44-45`) noting the queue itself is registered by `AddModuleConferenceApplication`, so the producer lives in Application and only the consumer is wired here, and that host ownership is the point: shutdown cancels the work instead of a deploy killing an untracked task.
  - **Scheduled job** (`:54`): `AddScheduledJob<SessionScoringSweepJob>()`. The comment above it (`:48-53`) is worth reading in full: the job is registered here rather than in the service host so the module carries its own job, the way `AddAuditTrail` carries the framework's retention job, and it only *runs* in a host that also calls `AddScheduledJobs` and turns the scheduler on (which `Conference.Service` does). Anywhere else the registration is inert.
  - Returns `services` for chaining (`:56`).
- **Why it's built this way**: typed clients centralize base URL, default headers and the Polly pipeline so the adapter classes stay thin (compare the 26-line [SessionizeService](#sessionizeservice)). Pinning `anthropic-version` at registration is a supply-chain choice, `[Rubric §32, Dependency & Supply-Chain]`: the API contract this code parses is version-pinned, so a vendor-side default change cannot silently reshape the response. Keeping the hosted service and the scheduled job in the module's own registration is `[Rubric §7, Microservices Readiness]`: extracting Conference into its own process moves its background work with it, because the work travels with the module rather than with a host.
- **Where it's used**: called from the Conference module's registration chain (see [ConferenceModule](group-20-conference-api-grpc.md#conferencemodule)), which the module loader invokes in topological order.

---

### AiScoreResponse

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Sessions.Scoring` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AnthropicScoringService.cs:508` · Level 0 · record (private sealed)

- **What it is**: the score object the language model is constrained to emit, deserialized from the response text block. Six weighted sub-scores, a penalty, and a free-text `reasoning` line.
- **Depends on**: no first-party types. External: `System.Text.Json.Serialization.JsonPropertyName`.
- **Concept introduced, anti-corruption serialization records at the edge.** This is a `private sealed record` nested inside [AnthropicScoringService](#anthropicscoringservice) (`AnthropicScoringService.cs:508`), so the vendor's snake_case vocabulary (`topic_relevance`, `actionable_takeaways`, `depth_or_insight_quality`) is named here and nowhere else. `[Rubric §3, Clean Architecture]` assesses whether external contracts stay out of inner layers: the Application layer only ever sees [SessionScoringResult](group-18-conference-application.md#sessionscoringresult), never an Anthropic shape. `[Rubric §32, Dependency & Supply-Chain]` assesses how a third-party API dependency is isolated: if Anthropic reshapes its envelope, only this one file changes.
- **Walkthrough**: eight `init` properties (`:508-533`), each carrying an explicit `[JsonPropertyName]`. `Penalty` (`:511`) and the six criterion scores (`TopicRelevance` `:514`, `DescriptionQuality` `:517`, `Novelty` `:520`, `ActionableTakeaways` `:523`, `DepthOrInsightQuality` `:526`, `CredibilityExperience` `:529`) are **`decimal?`**, not `decimal`: nullability is what makes a *partial* model response detectable. `BuildResult` (`:131`) pattern-matches all seven numeric fields against `{ } value` patterns (`:134-146`) and returns a failed result if any one is missing, instead of silently defaulting a missing score to `0m` and then clamping it up to `1.0`. There is **no overall score on the wire**: the weighted total is computed in-process from the six criteria and the penalty subtracted from it (`:150-162`), so the model is never asked to do arithmetic the code can do exactly. `Reasoning` (`:532`) stays `string?` and is the only genuinely optional field, defaulted to `string.Empty` at `:169`.
- **Why it's built this way**: nesting it as a private record of the one class that speaks HTTP keeps it an implementation detail; making the score fields nullable turns "the model returned four of six scores" into a detectable parse failure rather than a plausible-looking but wrong row in [SessionAiScore](group-17-conference-domain.md#sessionaiscore).
- **Where it's used**: [AnthropicScoringService](#anthropicscoringservice)`.ParseSingleScore` (`:116`) deserializes into it, and `BuildResult` (`:131`) converts it into a [SessionScoringResult](group-18-conference-application.md#sessionscoringresult).

---

`[Rubric §16, AI-Native Application Architecture]` applies: this type is part of the AI session-scoring feature (a model call behind a port, versioned prompt and model, an evaluation gate, metered spend; ADR-111).

### AnthropicContentBlock

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Sessions.Scoring` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AnthropicScoringService.cs:497` · Level 0 · record (private sealed)

- **What it is**: one element of the Messages API response `content` array: a `type` discriminator plus its `text`.
- **Depends on**: no first-party types. External: `System.Text.Json.Serialization`.
- **Concept**: same private wire-record pattern taught under [AiScoreResponse](#aiscoreresponse); nothing new.
- **Walkthrough**: two properties, `Type` (`:500`) and `Text` (`:503`), both `string?`. They are nullable because the adapter must be able to deserialize a block it does not understand without throwing: [AnthropicScoringService](#anthropicscoringservice)`.InterpretResponse` scans the list with `Find(c => string.Equals(c.Type, "text", StringComparison.OrdinalIgnoreCase))` (`:105-106`) and treats a null `Text` as a logged failure (`:108-111`) rather than as an exception.
- **Why it's built this way**: the Messages API returns an array of typed blocks, so the adapter selects the text block by discriminator instead of assuming index 0.
- **Where it's used**: composed into [AnthropicResponse](#anthropicresponse)`.Content` (`:479`).

---

`[Rubric §16, AI-Native Application Architecture]` applies: this type is part of the AI session-scoring feature (a model call behind a port, versioned prompt and model, an evaluation gate, metered spend; ADR-111).

### AnthropicJsonSchemaFormat

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Sessions.Scoring` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AnthropicScoringService.cs:458` · Level 0 · record (private sealed)

- **What it is**: the request fragment that names the output format as `json_schema` and carries the JSON Schema the model's answer must satisfy.
- **Depends on**: no first-party types. External: `System.Text.Json.Serialization`, `System.Text.Json.JsonElement`.
- **Concept introduced, constraining a model instead of parsing after it.** The alternative to a schema is asking politely in the prompt and then defending the parse: slice from the first `{` to the last `}`, strip code fences, hope the model did not add a preamble. Sending a schema moves the guarantee to the provider, which is why `ParseSingleScore` can now deserialize the whole text block directly and treat anything else as a failed call (`:118-119`). `[Rubric §16, AI-Native Application Architecture]` assesses whether model output is constrained and validated rather than trusted: this record is the constraint half, and [AiScoreResponse](#aiscoreresponse)'s all-or-nothing pattern match is the validation half that still runs anyway.
- **Walkthrough**: two properties. `Type` (`:461`) is a plain `string` **defaulted** to `"json_schema"` rather than `required`, because there is exactly one legal value and forcing every construction site to repeat it would add a way to get it wrong. `Schema` (`:464`) is a `required JsonElement`, bound at the single call site to the static `ScoreSchema` (`:63`), which `BuildScoreSchema` (`:394-425`) serializes once into a `JsonElement` held in a `static readonly` field (`:392`) so the schema is built one time per process, not per call.
- **Why it's built this way**: `BuildScoreSchema` derives the schema from the same six criterion names the weighting uses, sets `additionalProperties = false`, marks all eight fields `required`, and pins `penalty` to the enum `0`, `0.5`, `1` (`:412-421`), so the score band and the penalty ladder are enforced by the provider rather than discovered during parsing.
- **Where it's used**: the `Format` property of [AnthropicOutputConfig](#anthropicoutputconfig) (`:455`), constructed inline in `ScoreSessionAsync` (`:63`).

---

### AnthropicMessage

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Sessions.Scoring` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AnthropicScoringService.cs:467` · Level 0 · record (private sealed)

- **What it is**: one conversation turn in the request: a `role` and its `content`.
- **Depends on**: no first-party types. External: `System.Text.Json.Serialization`.
- **Concept**: cross-reference the private wire-record concept under [AiScoreResponse](#aiscoreresponse).
- **Walkthrough**: `required string Role` (`:470`) and `required string Content` (`:473`). Both are `required`, the mirror image of the response records' nullability: the adapter controls what it sends, so a half-built message is a compile error, while what comes back must be parsed defensively. Exactly one instance is ever constructed, with `Role = "user"` and the assembled user prompt as `Content` (`:60`). The stable reviewer brief does **not** ride in this message: it goes in the request's top-level `system` field (`:59`), so only speaker-submitted data is ever carried by a user turn.
- **Why it's built this way**: `required` plus `init` gives an immutable payload validated at construction (see the primer on `required`/`init` immutability).
- **Where it's used**: the `Messages` list of [AnthropicRequest](#anthropicrequest) (`:446`).

---

`[Rubric §16, AI-Native Application Architecture]` applies: this type is part of the AI session-scoring feature (a model call behind a port, versioned prompt and model, an evaluation gate, metered spend; ADR-111).

### AnthropicUsage

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Sessions.Scoring` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AnthropicScoringService.cs:488` · Level 0 · record (private sealed)

- **What it is**: the billed token counts the Messages API reports for one call: input tokens and output tokens.
- **Depends on**: no first-party types. External: `System.Text.Json.Serialization`.
- **Concept introduced, reading the invoice off the response.** Every scoring call is paid work, and the only place the actual cost of a call is knowable is the reply itself. `[Rubric §31, Cost/FinOps]` assesses whether spend is measured rather than estimated: capturing this block is what lets [ScoringInstruments](#scoringinstruments) publish real token counters instead of a per-call count multiplied by a guess.
- **Walkthrough**: two `int` properties, `InputTokens` (`:491`) and `OutputTokens` (`:494`), mapped from `input_tokens` and `output_tokens`. Neither is `required` and neither is nullable: a missing block leaves the whole `Usage` property null on [AnthropicResponse](#anthropicresponse) (`:485`), which is the case the caller actually tests (`if (apiResponse?.Usage is { } usage)`, `:92`), so there is nothing for a per-property null to add.
- **Why it's built this way**: usage is recorded **before** the refusal and empty-text guards run (`:92-96`, ahead of `:98`), because a refused or unusable answer is still a billed call and leaving it out of the counters would understate spend exactly when something is going wrong.
- **Where it's used**: the `Usage` property of [AnthropicResponse](#anthropicresponse) (`:485`); consumed in `InterpretResponse` (`:90`), which logs the pair (`:94`) and forwards it to [ScoringInstruments](#scoringinstruments)`.RecordUsage` (`:95`).

---

`[Rubric §16, AI-Native Application Architecture]` applies: this type is part of the AI session-scoring feature (a model call behind a port, versioned prompt and model, an evaluation gate, metered spend; ADR-111).

### SessionScoreStamp

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Sessions.Scoring` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/SessionScoringSweepJob.cs:213` · Level 0 · record (internal sealed)

- **What it is**: one persisted AI score reduced to the only two fields the crash-recovery sweep reasons about: which session it belongs to, and when it was written.
- **Depends on**: first-party: the `SessionIdentifierType` alias (see the primer on identifier-type aliases). External: the BCL `DateTime`.
- **Concept introduced, the projection record as a query bound.** `[Rubric §12, Performance & Scalability]` assesses whether reads pull only what they need. [SessionScoringSweepJob](#sessionscoringsweepjob) runs every five minutes and needs the score rows of every event, so materializing full [SessionAiScore](group-17-conference-domain.md#sessionaiscore) entities (seven decimals plus reasoning text plus audit columns) would move an order of magnitude more data than the decision needs. The read repository's `GetProjectedAsync` takes this record's constructor as its `select` expression (`SessionScoringSweepJob.cs:98-100`), so the projection is pushed into the query and only the two columns come back.
- **Walkthrough**: a positional `internal sealed record class` with two parameters, `SessionId` and `CreatedOn` (`:213`). `CreatedOn` is the framework audit stamp described in the primer, not a scoring-specific column, which is what lets the sweep date a score without any extra schema.
- **Why it's built this way**: `internal` because nothing outside this assembly has a reason to name it, and positional because it is a tuple with names rather than a modelled concept.
- **Where it's used**: [SessionScoringSweepJob](#sessionscoringsweepjob)`.ExecuteAsync` projects into it (`:99`) and `NewestScorePerSession` (`:118-132`) collapses the resulting list to one timestamp per session.

---

### SessionScoringCandidate

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Sessions.Scoring` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/SessionScoringSweepJob.cs:208` · Level 0 · record (internal sealed)

- **What it is**: one scorable session paired with the event that owns it, as read by the crash-recovery sweep.
- **Depends on**: first-party: the `EventIdentifierType` and `SessionIdentifierType` aliases. External: none.
- **Concept**: the same projection-record bound taught under [SessionScoreStamp](#sessionscorestamp).
- **Walkthrough**: a positional `internal sealed record class` carrying `EventId` and `SessionId` (`:208`). The sweep selects into it under a `where` clause of `!session.IsServiceSession` (`:86-89`), so service sessions (breaks, lunch, keynote logistics) never enter the population. The comment at `:84-85` records why that filter has to match the scoring handler exactly: counting a session the handler will never score would make its event look permanently unfinished.
- **Why it's built this way**: grouping by `EventId` (`:105`) is the whole algorithm, so the projection carries the grouping key rather than forcing a second query or a navigation load.
- **Where it's used**: [SessionScoringSweepJob](#sessionscoringsweepjob)`.ExecuteAsync` (`:86-89`, `:105-108`) and `EnqueueIfInterrupted` (`:142-183`).

---

`[Rubric §16, AI-Native Application Architecture]` applies: this type is part of the AI session-scoring feature (a model call behind a port, versioned prompt and model, an evaluation gate, metered spend; ADR-111).

### AnthropicOutputConfig

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Sessions.Scoring` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AnthropicScoringService.cs:452` · Level 1 · record (private sealed)

- **What it is**: the `output_config` node of the request body, a one-property wrapper around the output format.
- **Depends on**: first-party: [AnthropicJsonSchemaFormat](#anthropicjsonschemaformat) (composed). External: `System.Text.Json.Serialization`.
- **Concept**: cross-reference the private wire-record concept under [AiScoreResponse](#aiscoreresponse); this is the nesting layer the API's shape requires, nothing more.
- **Walkthrough**: one property, `required AnthropicJsonSchemaFormat Format` (`:455`), mapped to `format`. It is `required`, in line with every other outbound property: the adapter never sends a request without an output format, so an unconfigured one is a compile error rather than an unconstrained model call.
- **Why it's built this way**: modelling the wrapper as its own record instead of flattening it keeps the C# shape and the JSON shape in one-to-one correspondence, so a reader comparing this file against the vendor's request documentation does not have to hold a mental mapping.
- **Where it's used**: the `OutputConfig` property of [AnthropicRequest](#anthropicrequest) (`:449`), constructed inline in `ScoreSessionAsync` (`:61-64`).

---

`[Rubric §16, AI-Native Application Architecture]` applies: this type is part of the AI session-scoring feature (a model call behind a port, versioned prompt and model, an evaluation gate, metered spend; ADR-111).

### AnthropicResponse

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Sessions.Scoring` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AnthropicScoringService.cs:476` · Level 1 · record (private sealed)

- **What it is**: the deserialized reply envelope: the content blocks, why the model stopped, and what the call cost.
- **Depends on**: first-party: [AnthropicContentBlock](#anthropiccontentblock) and [AnthropicUsage](#anthropicusage) (composed). External: `System.Text.Json.Serialization`.
- **Concept**: cross-reference [AiScoreResponse](#aiscoreresponse).
- **Walkthrough**: three properties, all nullable. `List<AnthropicContentBlock>? Content` (`:479`) is nullable end to end (`apiResponse?.Content?.Find(...)`, `:105`) so an empty or malformed body deserializes to something the adapter can test instead of throwing. `StopReason` (`:482`) carries the vendor's termination code and is compared ordinally against `"refusal"` (`:98`): a model that declines the request is a distinct, logged failure rather than an empty-text one, which matters because a refusal is the expected outcome when a submission tries to steer the reviewer. `Usage` (`:485`) is the billing block, read first (`:92-96`) so even a refused call is counted.
- **Why it's built this way**: the "we control the request, we distrust the response" asymmetry, expressed in the type system: `required` on the way out, nullable on the way back.
- **Where it's used**: deserialized in [AnthropicScoringService](#anthropicscoringservice)`.ScoreSessionAsync` (`:79`) and interpreted by its `InterpretResponse` (`:90`).

---

`[Rubric §16, AI-Native Application Architecture]` applies: this type is part of the AI session-scoring feature (a model call behind a port, versioned prompt and model, an evaluation gate, metered spend; ADR-111).

### AnthropicRequest

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Sessions.Scoring` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AnthropicScoringService.cs:434` · Level 2 · record (private sealed)

- **What it is**: the POST body for the Anthropic Messages endpoint: which model, how many output tokens are allowed, the standing system brief, the message list, and the output-format constraint.
- **Depends on**: first-party: [AnthropicMessage](#anthropicmessage) and [AnthropicOutputConfig](#anthropicoutputconfig) (composed). External: `System.Text.Json.Serialization`.
- **Concept**: the composite half of the private envelope set introduced under [AiScoreResponse](#aiscoreresponse).
- **Walkthrough**: five `required` properties (`:434-450`): `Model` (`model`, `:437`), `MaxTokens` (`max_tokens`, `:440`), `System` (`system`, `:443`), `List<AnthropicMessage> Messages` (`messages`, `:446`) and `AnthropicOutputConfig OutputConfig` (`output_config`, `:449`). At the one call site (`:55-65`) `Model` is bound to `ModelId` (`:26`) and `MaxTokens` to **256**: the scorer asks for a small JSON object, so a low output cap bounds both latency and per-call cost. `[Rubric §12, Performance & Scalability]` assesses whether expensive calls carry explicit bounds; this is one of two such bounds in the flow, the other being the tuned timeouts in [DependencyInjection](#dependencyinjection). The `System` property is the structural half of the injection defence: the standing reviewer brief travels in a field the API treats as system instruction, and the speaker-submitted text travels in a user turn, so the two are never concatenated into one string.
- **Why it's built this way**: `required` on all five makes an incomplete request unrepresentable, and serializing through a typed record (rather than an anonymous object) keeps the property names under `[JsonPropertyName]` control.
- **Where it's used**: [AnthropicScoringService](#anthropicscoringservice)`.ScoreSessionAsync` (`:55-65`), handed to `JsonContent.Create` (`:69`).

---

`[Rubric §16, AI-Native Application Architecture]` applies: this type is part of the AI session-scoring feature (a model call behind a port, versioned prompt and model, an evaluation gate, metered spend; ADR-111).

### SessionScoringProcessor

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Sessions.Scoring` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/SessionScoringProcessor.cs:49` · Level 3 · class (sealed partial)

- **What it is**: the hosted background worker that drains [SessionScoringQueue](group-18-conference-application.md#sessionscoringqueue) and runs each queued AI scoring pass off the request path, under the host's stopping token and under a cross-replica lock.
- **Depends on**: first-party: [SessionScoringQueue](group-18-conference-application.md#sessionscoringqueue), [SessionScoringWorkItem](group-18-conference-application.md#sessionscoringworkitem), [ScoreEventSessionsCommand](group-18-conference-application.md#scoreeventsessionscommand), [ScoreEventSessionsResultDTO](group-17-conference-domain.md#scoreeventsessionsresultdto), [`ICommandHandler<in TCommand, TResult>`](group-05-cqrs-pipeline.md#icommandhandlerin-tcommand-tresult), [IDistributedLock](group-05-cqrs-pipeline.md#idistributedlock), [Result](group-01-result-error-handling.md#result). External: `BackgroundService`, `IServiceScopeFactory`, `IOutputCacheStore`, `ILogger<T>`, `System.Diagnostics.Metrics`.
- **Concept introduced, replacing fire-and-forget with a host-owned single reader plus a cross-replica lock.** A `BackgroundService` differs from a detached `Task.Run` in one decisive way: the host knows about it, so shutdown cancels the token and waits for the loop to unwind instead of tearing down a half-finished pass with nothing recorded (`:18-24`). One reader matches the queue's `SingleReader = true` (`SessionScoringQueue.cs:47`), so runs are serialized inside a process. The XML doc is explicit that this is only half the story (`:25-34`): serialization is **per process**, and Conference runs with `maxReplicas: 2`, so two organizer triggers landing on different replicas would each pay for a full pass over the same sessions and race each other's writes. The answer is an [IDistributedLock](group-05-cqrs-pipeline.md#idistributedlock) claim taken inside `ScoreAsync`. `[Rubric §7, Microservices Readiness]` assesses whether background work survives horizontal scale-out: the in-process channel alone does not, and the distributed lock is what makes the worker replica-safe. `[Rubric §12, Performance & Scalability]` assesses keeping slow work off the request path: the caller enqueues and returns instead of awaiting a multi-minute batch. `[Rubric §13, Observability & Operability]` assesses whether long-running work reports outcomes: six `[LoggerMessage]` methods cover completed, rejected, terminally failed, retrying, interrupted and not-claimed (`:211-227`), and a `Counter<long>` named `scoring.run.failed.terminal` (`:96-99`) makes abandoned runs alertable. `[Rubric §31, Cost/FinOps]` genuinely applies: every guard in this class exists because a duplicate pass is a duplicate invoice.
- **Walkthrough**
  - The **primary constructor** (`:49-53`) injects the queue, an `IServiceScopeFactory`, an `IOutputCacheStore` and a logger; the XML param docs (`:45-48`) state each role.
  - `MeterName` (`:59`) is `"MMCA.ADC.Conference.Scoring"`, public so a host can register the meter for export (the doc names `MMCA.ADC.Conference.Service` as the host that does, `:56-57`). `TerminalFailureCounter` (`:96-99`) is created from it and tagged by `event_id` (`:77`, `:150`).
  - `SessionsCacheTag` (`:66`) is `"conference:sessions"`. The comment above it (`:61-65`) records an incident-shaped rationale: evicting the root `conference` tag flushed events, speakers, rooms, categories and questions too, so an organizer starting a scoring run during the event emptied the whole public read surface onto the Basic-tier database while attendees were browsing. Scoring writes session scores, so it evicts only the sessions tag.
  - `MaxAttempts = 3` (`:74`) bounds retries, and the doc explains the ceiling is deliberately low because scoring is paid work: retries exist to absorb a transient fault, not to grind against a genuine outage. `ClaimTimeToLive` is 15 minutes (`:85`) and `ClaimWait` is `TimeSpan.Zero` (`:92`), a single non-blocking attempt at the lock, because the loser is a duplicate trigger and waiting for it would only mean paying for the same pass twice in a row. `ClaimKey` formats `scoring:inflight:{eventId}` under `InvariantCulture` (`:101-102`).
  - `ExecuteAsync` (`:105`) is one `await foreach` over `queue.Reader.ReadAllAsync(stoppingToken)` (`:107`). Cancellation during host shutdown logs an interruption and **returns** (`:115-123`), with a comment stating the item is deliberately never re-queued because it would be lost with the process anyway. Any other exception is captured into a local `failure` under a scoped `CA1031` suppression justified inline ("one failed run must not kill the drain", `:124-129`).
  - The `finally` calls `queue.MarkCompleted(item.EventId)` (`:130-136`), and the comment there is the subtle part: the local claim must be released **before** any re-queue, because `MarkCompleted` would otherwise clear the very claim `TryRequeue` just took, leaving the event queued but not marked pending, so a concurrent trigger could start a second pass over it.
  - The retry decision (`:138-150`): no failure means continue; otherwise, if the attempt count is under `MaxAttempts` **and** `queue.TryRequeue(item.EventId, item.Attempt + 1)` succeeds, log a warning and continue. A full queue makes the retry impossible, so it collapses into the terminal path (`:141-142`) rather than being silently dropped: `LogRunFailed` plus a counter increment.
  - `ScoreAsync` (`:154`) evicts the sessions cache tag **before** the run (`:158`) so a client polling the dashboard stops seeing stale scores while work is in flight, creates an async DI scope (`:160`, needed because the command handler and its `DbContext` are scoped while this service is a singleton), resolves the `IDistributedLock` from that scope (`:175`) and takes the claim with `await using` (`:177-179`). A null claim means another replica owns the pass, which is logged and returned from without releasing anything (`:181-188`).
  - With the claim held it resolves `ICommandHandler<ScoreEventSessionsCommand, Result<ScoreEventSessionsResultDTO>>` (`:190-191`) and invokes it (`:193-194`). A `Result` failure is handled as data and **not** retried: the comment (`:198-202`) draws the line precisely, a `Result` failure is a business outcome (nothing to score, the event is not in a scorable state, validation refused the command) and replaying it would only pay for the same refusal twice more, while a thrown exception is what a transient fault looks like from here. Success logs scored and failed counts (`:207`) and evicts the tag again (`:208`) so clients see the new scores.
- **Why it's built this way**: resolving the handler through a scope keeps the CQRS decorator pipeline (logging, caching, transactional) intact for background work, so a queued run behaves exactly like a request-driven command. The lock replaced an earlier cache-counter approach, and the comment at `:166-174` says why: a counter released in a `finally` left the key stuck at 1 when a replica was killed between the increment and the release, locking the event out until an operator cleared it by hand, whereas a lock handle releases on every exit path and its time-to-live releases it for a replica that never reaches one.
- **Where it's used**: registered by [DependencyInjection](#dependencyinjection) with `services.AddHostedService<SessionScoringProcessor>()` (`DependencyInjection.cs:47`); the producing side is the Conference endpoint that calls `TryEnqueue` on [ISessionScoringQueue](group-18-conference-application.md#isessionscoringqueue), and [SessionScoringSweepJob](#sessionscoringsweepjob) is the second producer, re-enqueuing interrupted passes.
- **Caveats / not-in-source**: the class states one honest limit in its own comments (`:172-174`): a host with no Redis configured gets the in-process `IDistributedLock` fallback, where exclusion is per replica again. Whether a given environment has Redis configured is not determinable from this file.

---

`[Rubric §16, AI-Native Application Architecture]` applies: this type is part of the AI session-scoring feature (a model call behind a port, versioned prompt and model, an evaluation gate, metered spend; ADR-111).

### ScoringInstruments

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Sessions.Scoring` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AnthropicScoringService.cs:326` · Level 4 · class (private sealed)

- **What it is**: the two token counters the scoring adapter publishes, wrapped in a small class that owns their creation and their tags.
- **Depends on**: first-party: [SessionScoringProcessor](#sessionscoringprocessor) (for its `MeterName` constant). External: `System.Diagnostics.Metrics.IMeterFactory`, `Meter`, `Counter<long>`.
- **Concept introduced, turning a paid dependency into a metered one.** A log line per call tells you what one session cost after you go looking; a counter tells you what the month is costing while it happens. `[Rubric §31, Cost/FinOps]` assesses whether spend is observable and alertable rather than reconstructed from an invoice: the comment above the field that holds this class (`:381-386`) states the split plainly, the existing usage log stays as per-session forensics and these counters are the aggregate a budget alert queries. `[Rubric §13, Observability & Operability]` assesses instrument hygiene: units and descriptions are supplied on both counters (`:343-346`, `:348-351`), and the tag names are constants (`:328-329`) rather than repeated literals, so a typo cannot silently split one series into two.
- **Walkthrough**
  - The constructor (`:334`) takes the `IMeterFactory` and creates its meter from `SessionScoringProcessor.MeterName` (`:340`), deliberately **reusing** the meter name the background worker already exports rather than minting a second one: a host that wires up one instrument family gets all of them with no extra registration.
  - That line carries a scoped `CA2000` suppression with an inline justification (`:339`, `:341`): the factory caches the meter and disposes it with the container, so disposing it here would tear down a meter other holders are still recording through. This is the rare case where suppressing the analyzer is the correct answer, and the comment (`:336-338`) is what makes that auditable.
  - `_inputTokens` and `_outputTokens` are `Counter<long>` (`:331-332`), named `scoring.tokens.input` and `scoring.tokens.output` with unit `{token}`.
  - `RecordUsage` (`:354`) builds two `KeyValuePair<string, object?>` tags, `model` and `prompt_version` (`:356-357`), and adds both counts under them (`:359-360`). Those two dimensions are chosen because they are exactly what moves spend: a model swap changes the per-token price, a prompt revision changes the token count.
- **Why it's built this way**: holding the counters in a `private sealed` helper rather than as two fields on the adapter keeps meter creation, tag names and the suppression in one place, and lets the adapter own a single readonly field initialized from the injected factory (`:387`). Because the adapter is registered as a typed `HttpClient` service, the factory is injected through its primary constructor and the instrument set is created once per adapter instance.
- **Where it's used**: instantiated by [AnthropicScoringService](#anthropicscoringservice) into its `_instruments` field (`:387`) and called from `InterpretResponse` when the response carries an [AnthropicUsage](#anthropicusage) block (`:95`).

---

`[Rubric §16, AI-Native Application Architecture]` applies: this type is part of the AI session-scoring feature (a model call behind a port, versioned prompt and model, an evaluation gate, metered spend; ADR-111).

### SessionizeService

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Events/Sessionize/SessionizeService.cs:10` · Level 4 · class (sealed)

- **What it is**: the HTTP implementation of [ISessionizeService](group-18-conference-application.md#isessionizeservice). It calls the Sessionize "View All" endpoint, which returns every session, speaker, room and category for a conference in one document.
- **Depends on**: first-party: [ISessionizeService](group-18-conference-application.md#isessionizeservice) (implements), [SessionizeResponse](group-18-conference-application.md#sessionizeresponse) (return shape). External: `HttpClient`, `System.Net.Http.Json`.
- **Concept**: `[Rubric §2, Design Patterns]` and `[Rubric §1, SOLID]` (dependency inversion) assess whether the application depends on an abstraction it owns: the Application layer declares the port, Infrastructure supplies the adapter, and no Application file references `HttpClient`. The whole class is 26 lines because everything configurable (base address, resilience) lives on the typed-client registration in [DependencyInjection](#dependencyinjection).
- **Walkthrough**: a primary constructor takes `HttpClient` (`:10`). `GetAllAsync` builds the relative URI `{sessionizeCode}/view/All` (`:15`), GETs it (`:16-18`), calls `EnsureSuccessStatusCode()` (`:20`), and deserializes to `SessionizeResponse?` (`:22-24`). Both awaits use `.ConfigureAwait(false)`, the repo-wide library rule from [ADR-049](https://ivanball.github.io/docs/adr/049-library-configureawait-policy.html).
- **Why it's built this way**: keeping parsing, mapping and the import workflow in Application use-cases leaves this adapter owning only the wire call, which is what makes it trivially fakeable in tests.
- **Caveat, error handling differs from the AI adapter.** `EnsureSuccessStatusCode()` throws `HttpRequestException` on any non-2xx, and that exception **propagates** out of the class, the opposite of [AnthropicScoringService](#anthropicscoringservice)'s never-throw contract. The difference follows the shape of the work: a Sessionize sync is one explicit organizer action where a failure should surface as an error, while AI scoring is a per-item batch where one item's failure must not stop the rest. The return type is also nullable, so a 2xx with an empty body yields `null` rather than an exception.
- **Where it's used**: the Sessionize import handlers in [Conference Application](group-18-conference-application.md), triggered when an organizer refreshes an event's data.

---

### AnthropicScoringService

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Sessions.Scoring` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AnthropicScoringService.cs:19` · Level 5 · class (sealed partial)

- **What it is**: the adapter that implements [IAiScoringService](group-18-conference-application.md#iaiscoringservice) by calling the Anthropic Claude Messages API (model `claude-haiku-4-5`, `:26`) to score one session proposal against a Program Committee rubric. Its XML doc states the contract plainly (`:14-18`): it never throws for scoring failures, but `OperationCanceledException` propagates. The governance around it (prompt versioning, the golden evaluation suite, the injection posture) is recorded in [ADR-111](https://ivanball.github.io/docs/adr/111-ai-session-scoring-governance.html).
- **Depends on**: first-party: [IAiScoringService](group-18-conference-application.md#iaiscoringservice) (implements), [SessionScoringInput](group-18-conference-application.md#sessionscoringinput), [SessionScoringResult](group-18-conference-application.md#sessionscoringresult), [SpeakerInfo](group-18-conference-application.md#speakerinfo), [SessionScoringProcessor](#sessionscoringprocessor) (for the shared meter name), and its own private types [AnthropicRequest](#anthropicrequest), [AnthropicOutputConfig](#anthropicoutputconfig), [AnthropicJsonSchemaFormat](#anthropicjsonschemaformat), [AnthropicMessage](#anthropicmessage), [AnthropicResponse](#anthropicresponse), [AnthropicContentBlock](#anthropiccontentblock), [AnthropicUsage](#anthropicusage), [AiScoreResponse](#aiscoreresponse), [ScoringInstruments](#scoringinstruments). External: `HttpClient`, `IConfiguration`, `IMeterFactory`, `ILogger<T>`, `System.Text.Json`, `System.Text.RegularExpressions`, `System.Globalization`.
- **Concept introduced, the adapter that keeps an HTTP/LLM vendor at the edge.** `[Rubric §3, Clean Architecture]` and `[Rubric §1, SOLID]` (dependency inversion) assess whether inner layers depend on abstractions rather than vendors: every byte of Anthropic-specific HTTP and JSON lives in this one Infrastructure file, behind an Application-owned port. `[Rubric §11, Security]` assesses secret handling and untrusted input: the key is read from configuration (`Anthropic:ApiKey`, `:44`) and passed as the `x-api-key` header (`:68`), never hard-coded, and the failure log for a missing key names the configuration path, not a value (`:47`); speaker-submitted text is escaped, delimited and redacted before it leaves the process (below). `[Rubric §16, AI-Native Application Architecture]` assesses whether model interaction is versioned, constrained and evaluable: `PromptVersion` (`:37`), the structured-output schema (`:392-425`) and the prompt-injection brief (`:204-217`) are the three pieces. `[Rubric §13, Observability & Operability]` assesses structured, allocation-cheap logging: both log paths are source-generated `[LoggerMessage]` methods (`:427-431`), which is also why the class is `partial`, and token usage additionally lands on counters through [ScoringInstruments](#scoringinstruments). `[Rubric §29, Resilience & Business Continuity]` assesses graceful degradation: six distinct failure paths (missing key `:45-49`, non-2xx `:72-77`, model refusal `:98-102`, empty or absent text block `:108-111`, unparseable or partial JSON `:126-128` and `:134-146`, any other exception `:83-87`) all converge on `FailedResult`, so one bad proposal cannot abort a batch. `[Rubric §27, i18n]` assesses culture-correctness: `CultureInfo.InvariantCulture` is used for every interpolated string that reaches the prompt or the log (`:75`, `:235-236`, `:257-261`), so output never varies with server locale.
- **Walkthrough**
  - A **primary constructor** injects `HttpClient`, `IConfiguration`, `IMeterFactory` and `ILogger<AnthropicScoringService>` (`:19-23`). The base address, the `anthropic-version` header and the resilience pipeline are not set here: they are configured once on the typed client in [DependencyInjection](#dependencyinjection) (`DependencyInjection.cs:33-45`), which is why the request below uses a *relative* URI.
  - `ModelId` (`:26`) is a fixed string exposed through the port so callers can record which model produced a score. `PromptVersion` (`:37`) is the second half of that provenance, a `yyyy-MM-dd.N` stamp persisted on every score. Its remark (`:28-36`) is a maintenance contract: bump it on **any** change to the system prompt, the user-prompt builder, the speaker formatter, the redaction rules or the schema, because the golden evaluation suite pins the rendered prompt by hash per version, so an unversioned edit fails a test instead of quietly re-basing every score already on the dashboard.
  - `ScoreSessionAsync` (`:40`) guards on the missing key first (`:44-49`), builds the user message with `BuildUserPrompt` (`:53`), assembles an [AnthropicRequest](#anthropicrequest) carrying `SystemPrompt`, one user [AnthropicMessage](#anthropicmessage), `MaxTokens = 256` and the schema-constrained [AnthropicOutputConfig](#anthropicoutputconfig) (`:55-65`), then constructs an `HttpRequestMessage` to the relative `v1/messages` with the `x-api-key` header attached per request rather than as a client default (`:67-69`). On a non-success status it reads the error body and logs `HTTP {code}: {body}` before returning `FailedResult` (`:72-77`).
  - `InterpretResponse` (`:90`) records usage **before** it judges the answer (`:92-96`), so a refusal is still counted as spend, then checks `stop_reason == "refusal"` (`:98-102`), then locates the `"text"` block case-insensitively (`:105-106`) and fails on a null one (`:108-111`).
  - `ParseSingleScore` (`:116`) deserializes the whole text block directly, with the inline comment stating why that is now safe (`:118-119`): structured outputs constrain the reply to the schema, so prose, code fences or truncation are a failed call rather than something to salvage. A `JsonException` returns `FailedResult` (`:125-128`).
  - `BuildResult` (`:131`) is the correctness gate. Its single `is not { ... }` pattern (`:134-146`) requires the penalty and all six sub-scores to be present; a partial object is a failed parse, not a success full of defaults. The overall score is then computed here, not asked for: the six criteria are weighted 30/10/20/20/10/10 (`:150-158`) and the penalty subtracted (`:162`), with every value passed through `Clamp` (`:364`), which does `Math.Clamp(value, 1.0m, 10.0m)` and rounds to one decimal with `MidpointRounding.ToEven`.
  - `SystemPrompt` (`:176`) is the domain knowledge of this file: the ADC track list, the six weighted criteria, calibration rules ("most talks should fall between 5.5 and 7.5"), and a penalty ladder of 0.0, 0.5 or 1.0. It ends by concatenating `UntrustedInputBrief` (`:217`), an `internal const` separated out only so the evaluation suite can assert on it by name. That brief names the `<session_proposal>` delimiters, declares everything inside them data rather than instruction, and wires an injection attempt straight to the existing 1.0 penalty, which its XML doc explains is the point (`:204-216`): a rule to apply beats a judgement call to make.
  - `BuildUserPrompt` (`:231`) is the containment half. It emits a delimited, escaped envelope (`<session_proposal>`, `<session_title>`, `<session_description>`) rather than labelled `Title:` / `Description:` lines, and the comment above it (`:226-230`) records why: labelled lines gave a submission no boundary, so a description could open with its own `Title:` line and nothing in the format said which one to believe. `Escape` (`:295`) replaces `<` and `>` with entities, which is the whole containment story because angle brackets are the only characters that can forge a delimiter (`:292-294`).
  - `Redact` (`:303`) runs submitted text through two `[GeneratedRegex]` patterns, `EmailPattern` (`:310`) and `PhonePattern` (`:320`), substituting `[email removed]` (`:287`) and `[phone removed]` (`:290`), both with a 1000 ms match timeout. The phone pattern is deliberately narrow rather than "any run of digits" (`:312-315`) because bios legitimately contain years and team sizes, and redacting those would cost the credibility criterion its evidence for no privacy gain. `FormatSpeakers` (`:242`) applies it to taglines and bios but **not** to names (`:253-255`): a speaker's name is the published conference record and the only handle the credibility criterion has on a track record. With no speakers it emits the literal `<speakers>(no speaker information available)</speakers>` (`:244-245`), which is what makes that criterion degrade gracefully.
  - `RenderPrompt` (`:277`) is the one public affordance for testing: it returns the exact system-plus-user pair this service would send, without calling the API, so the evaluation suite can hash it per `PromptVersion`.
  - `FailedResult` (`:366`) is the single shape of failure: all seven scores `0m`, `Reasoning = "Scoring failed"`, `Success = false`. Note that a zero sits outside the 1.0 to 10.0 band by construction, so a failed row is distinguishable from any real score.
- **Why it's built this way**: concentrating vendor specifics behind the port makes swapping providers or faking the service in tests a one-class change, and the never-throw plus clamp plus all-or-nothing-parse discipline makes raw model output safe to persist into [SessionAiScore](group-17-conference-domain.md#sessionaiscore). The prompt is prescriptive because the scoring semantics depend on it, and it is versioned because the evaluation suite depends on being able to tell one prompt from another.
- **Where it's used**: registered as the `IAiScoringService` implementation by [DependencyInjection](#dependencyinjection) (`DependencyInjection.cs:33-45`); driven per session by [ScoreEventSessionsHandler](group-18-conference-application.md#scoreeventsessionshandler), which is itself driven off the request path by [SessionScoringProcessor](#sessionscoringprocessor). It is exercised directly by `AnthropicScoringServiceTests` and, through `RenderPrompt` and `UntrustedInputBrief`, by the `MMCA.ADC.Conference.Scoring.Evaluation.Tests` project (`PromptContractTests`, `GoldenReplayTests`, `LiveJudgeTests`).
- **Caveats / not-in-source**: there is **no retry inside this class**. Retry (`MaxRetryAttempts = 1`), attempt timeout (3 minutes) and circuit breaking are configured externally on the typed client (`DependencyInjection.cs:42-45`); the in-class contract is "never throw, let the batch continue". Whether scoring is enabled in a given environment is a configuration matter (the key must be present) and is not determinable from this file.

---

### SessionScoringSweepJob

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Sessions.Scoring` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/SessionScoringSweepJob.cs:54` · Level 9 · class (sealed partial)

- **What it is**: the crash-recovery backstop for AI session scoring. Every five minutes it looks for an event whose scoring pass started but never finished, and re-enqueues it on [ISessionScoringQueue](group-18-conference-application.md#isessionscoringqueue).
- **Depends on**: first-party: [IScheduledJob](group-05-cqrs-pipeline.md#ischeduledjob) (implements), [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork), [`IReadRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#ireadrepositorytentity-tidentifiertype), [Session](group-17-conference-domain.md#session), [SessionAiScore](group-17-conference-domain.md#sessionaiscore), [ISessionScoringQueue](group-18-conference-application.md#isessionscoringqueue), [SessionScoringEnqueueResult](group-18-conference-application.md#sessionscoringenqueueresult), [SessionScoringCandidate](#sessionscoringcandidate), [SessionScoreStamp](#sessionscorestamp). External: `TimeProvider`, `ILogger<T>`.
- **Concept introduced, deriving a durable signal from the rows a process already writes.** The queue that [SessionScoringProcessor](#sessionscoringprocessor) drains lives in one process's memory, so it is exactly as durable as the replica holding it: a deploy, a scale-in or a crash between the organizer's trigger and the last session's score leaves the event half scored with nothing anywhere that would ever pick it up (`:13-20`). The instructive move is that this job adds **no state field**. There is no scoring-status column on [Event](group-17-conference-domain.md#event); the condition is derived from the rows the scoring handler already persists, one [SessionAiScore](group-17-conference-domain.md#sessionaiscore) per session as it goes, so an event is mid-pass exactly when SOME but not ALL of its non-service sessions carry a score (`:21-27`). `[Rubric §29, Resilience & Business Continuity]` assesses whether interrupted work is recovered rather than silently lost: this is that recovery path, deliberately the slow one sitting behind a fast in-memory queue. `[Rubric §8, Data Architecture]` assesses whether derived state is inferred from facts instead of duplicated into a status column that can itself go stale. `[Rubric §31, Cost/FinOps]` is unusually explicit here: the doc comment states that each pass issues one paid Anthropic call per session, and the two bounds below exist so a wrong guess does not spend real money on its own.
- **Walkthrough**
  - The **primary constructor** (`:54-58`) injects [IUnitOfWork](group-07-persistence-ef-core.md#iunitofwork), [ISessionScoringQueue](group-18-conference-application.md#isessionscoringqueue), `TimeProvider` and a logger. Taking the clock as `TimeProvider` rather than reading `DateTime.UtcNow` is what makes the recovery window testable, `[Rubric §14, Testability]`.
  - `RecoveryWindow` is 24 hours (`:66`), `internal static readonly` so tests can reference the same constant. `Name` is `"conference-session-scoring-sweep"` (`:69`) and `CronExpression` is `"*/5 * * * *"` (`:77`), with the remark noting a host overrides it via `Scheduler:Jobs:conference-session-scoring-sweep:Cron` without touching code (`:72-76`).
  - `ExecuteAsync` (`:80`) takes a **read** repository from the unit of work (`:82`, the injection rule from the primer: resolve through `IUnitOfWork.GetReadRepository`, never constructor-inject a repository), and projects every non-service session into [SessionScoringCandidate](#sessionscoringcandidate) (`:86-89`). An empty population returns immediately (`:91-94`).
  - It then projects every score row into [SessionScoreStamp](#sessionscorestamp) (`:96-100`), collapses them with `NewestScorePerSession` (`:102`, `:118-132`), and computes the cutoff as `timeProvider.GetUtcNow().UtcDateTime` minus the window (`:103`). The doc on `NewestScorePerSession` (`:111-115`) explains why newest wins rather than last-read: the unique filtered index allows only one live row per session, but a soft-deleted predecessor can still surface through a future read path.
  - Candidates are grouped by `EventId` and each group goes to `EnqueueIfInterrupted` (`:105-108`).
  - `EnqueueIfInterrupted` (`:142`) counts `total` and `scored` for the event and tracks the newest score stamp (`:148-166`). **Bound one** (`:168-173`): `scored == 0` returns, because nobody triggered that event and starting an unrequested pass would bill every event in the database on the first tick; `scored == total` returns because there is nothing to finish. **Bound two** (`:175-179`): if the newest surviving score is older than the cutoff, it logs `LogSweepAbandoned` and lets the event go, so a permanently unscorable session cannot keep re-triggering paid passes and an organizer re-triggers by hand instead.
  - Otherwise it calls `sessionScoringQueue.TryEnqueue(eventId)` and logs the [SessionScoringEnqueueResult](group-18-conference-application.md#sessionscoringenqueueresult) outcome (`:181-182`). Beyond that enqueue the job is read-only, and the enqueue is safe to repeat: the queue's pending set refuses an event already queued or running, so a sweep landing on top of a live pass is a logged no-op rather than a second paid run (`:44-48`).
- **Why it's built this way**: registering the job in the module's own `DependencyInjection` rather than in a service host means the module carries its own recovery job, the way `AddAuditTrail` carries the framework's retention job (`DependencyInjection.cs:49-54`). The registration is inert in a host that does not turn the scheduler on, so a module can ship a job without forcing every host to run it.
- **Where it's used**: registered by [DependencyInjection](#dependencyinjection) via `services.AddScheduledJob<SessionScoringSweepJob>()` (`DependencyInjection.cs:55`); it only executes in a host that also calls `AddScheduledJobs`, which the Conference service host does.
- **Caveats / not-in-source**: each tick reads every non-service session and every score row with no event-level filter pushed down, which is sized for a conference-scale dataset rather than an arbitrary one. Whether the scheduler is enabled and which cron a given environment overrides are configuration questions outside this file.

---

`[Rubric §16, AI-Native Application Architecture]` applies: this type is part of the AI session-scoring feature (a model call behind a port, versioned prompt and model, an evaluation gate, metered spend; ADR-111).

### CategoryItemConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Categories/CategoryItemConfiguration.cs:10` · Level 8 · class

- **What it is**: the EF Core persistence map for the [`CategoryItem`](group-17-conference-domain.md#categoryitem) entity: column facets, the parent relationship to [`Category`](group-17-conference-domain.md#category), and a composite unique index. It is the smallest complete member of the seventeen-class configuration family in this folder, so it is the one this chapter uses to teach the shared shape.
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype) (base, `:11`), [`CategoryItem`](group-17-conference-domain.md#categoryitem), [`Category`](group-17-conference-domain.md#category), [`CategoryInvariants`](group-17-conference-domain.md#categoryinvariants) (`:19`). External: `Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<T>`.
- **Concept introduced, the per-entity configuration class and what the base already did.** Every configuration in this folder is an `internal sealed class` deriving from `EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>` and overriding one method, `Configure(EntityTypeBuilder<TEntity> builder)`, whose first statement is always `base.Configure(builder)` (`:16`). Knowing exactly what that base call does is what stops you re-declaring things by hand:
  - `EntityTypeConfigurationSQLServer` is a **shim with no body** (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationSQLServer.cs:17-20`). Its whole contribution is the `[UseDataSource(DataSource.SQLServer)]` attribute it carries (`:16`), an instance of [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute).
  - The real work is in [`EntityTypeConfiguration<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationtentity-tidentifiertype). Its `Configure` (`EntityTypeConfiguration.cs:37`) reads the attribute off `GetType()` and throws if it is missing (`:43-46`), then calls `ApplyEngineConventions` (`:48`). For `DataSource.SQLServer` that means `ToTable(typeof(TEntity).Name, NamespaceConventions.GetModuleName(typeof(TEntity)) ?? "dbo")`, so the table name comes from the CLR type and **the schema comes from the module segment of the entity's namespace** (`:66`), then `HasKey(p => p.Id)` (`:67`) and either `ValueGeneratedOnAdd()` or `ValueGeneratedNever()` depending on `IsIdValueGenerated` (`:68-71`).
  - Below that, [`EntityTypeConfigurationBase<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationbasetentity-tidentifiertype) does exactly one thing: `builder.Ignore(nameof(AuditableAggregateRootEntity<>.DomainEvents))` for aggregate roots (`EntityTypeConfigurationBase.cs:29-32`), keeping the in-memory event list out of the schema.
  - What the base chain does **not** do is equally important. The soft-delete global query filter, the `rowversion` concurrency token and the soft-delete index convention are installed by the context, not by these classes: [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) adds the query filter at `ApplicationDbContext.cs:348`, marks the concurrency property at `:469` and `:473`, and registers [`SoftDeleteUniqueIndexConvention`](group-07-persistence-ef-core.md#softdeleteuniqueindexconvention) at `:296`. So a configuration class in this folder is only ever about *this entity's* columns, relationships and indexes.

  Because the engine is pinned entirely by the base type, re-pointing a Conference entity at SQLite or Cosmos is a base-class swap with no edit to the body of `Configure`: the domain entity, the handlers and everything above stay untouched. All seventeen Conference configurations use the SQL Server base, since ADC runs SQL Server only.

  `[Rubric §8, Data Architecture]` assesses whether persistence is designed deliberately (typed lengths, correct nullability, FK relationships, purposeful indexes) rather than left to convention defaults: this family is where all of that lives for the Conference database. `[Rubric §3, Clean Architecture]` assesses dependency direction: EF mapping is confined to Infrastructure, and the domain entities carry zero EF attributes, so the domain layer stays framework-free.
- **Concept introduced, length constants sourced from the domain invariants.** Nearly every `HasMaxLength` call in this folder reads a constant from the entity's `…Invariants` class instead of a literal. Here it is `CategoryInvariants.CategoryItemNameMaxLength` (`:19`). The same constant is what the Application layer's FluentValidation rules use, so the column width and the request validator are a **single source of truth**: change the constant once and both move. `[Rubric §15, Best Practices & Code Quality]` assesses exactly this kind of single-definition-point discipline.
- **Walkthrough**
  - **Class declaration** (`:10-11`): `internal sealed class CategoryItemConfiguration : EntityTypeConfigurationSQLServer<CategoryItem, CategoryItemIdentifierType>`. `internal` because nothing outside this assembly configures the model; the second type argument is the module's identifier alias, not a raw CLR type.
  - **`base.Configure(builder)`** (`:16`): table `CategoryItem`, schema `Conference`, key on `Id`, value generation per the entity.
  - **Column facets** (`:18-23`): `Name` is `HasMaxLength(CategoryInvariants.CategoryItemNameMaxLength).IsRequired()`; `Sort` is `IsRequired()`.
  - **Parent relationship** (`:25-28`): `HasOne(p => p.Category).WithMany(p => p.CategoryItems).HasForeignKey(p => p.CategoryId).IsRequired()`. Both ends of the navigation are named, so EF maps the aggregate's real collection property rather than inventing a shadow one.
  - **Composite unique index** (`:30-31`): `HasIndex(p => new { p.CategoryId, p.Name }).IsUnique()`. Note there is **no** explicit filter call here, and none is needed: `SoftDeleteUniqueIndexConvention` runs at model finalizing and adds the `IsDeleted = 0` predicate to every unique index on a soft-deletable entity that does not already declare a filter (`SoftDeleteUniqueIndexConvention.cs:51-55`). The shipped index is therefore filtered, so soft-deleting a category item frees its `(CategoryId, Name)` slot for re-use.
- **Why it's built this way**: one small single-responsibility class per entity keeps the domain a pure POCO set (the Clean Architecture dependency rule) and lets EF discover configurations by assembly scan, so adding an entity is "add a config class" with no central registration edit.
- **Where it's used**: discovered and applied when the concrete [`SQLServerDbContext`](group-07-persistence-ef-core.md#sqlserverdbcontext) builds its model; the resulting schema is snapshotted by the Conference migrations project (`MMCA.ADC.Migrations.SqlServer.Conference`). See also the declarative table-surface manifest [`ModuleApplicationDbContext`](#moduleapplicationdbcontext).

---

### ConferenceCategoryConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Categories/ConferenceCategoryConfiguration.cs:13` · Level 8 · class

- **What it is**: the persistence map for the [`Category`](group-17-conference-domain.md#category) aggregate, the parent of [`CategoryItem`](group-17-conference-domain.md#categoryitem). It is the only configuration in the folder whose class name does not match `{Entity}Configuration`.
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`Category`](group-17-conference-domain.md#category), [`CategoryInvariants`](group-17-conference-domain.md#categoryinvariants). External: `Microsoft.EntityFrameworkCore` (for `ToTable`).
- **Concept**: the shared shape is taught under [`CategoryItemConfiguration`](#categoryitemconfiguration); the only new idea here is the deliberate name/table split.
- **Walkthrough**
  - **Class name** (`:13-14`): the type is `ConferenceCategoryConfiguration`, not `CategoryConfiguration`. The XML doc (`:8-12`) gives the reason: more than one `Category` concept exists in the wider codebase vocabulary, and a distinct configuration class name avoids ambiguity for a reader scanning the folder.
  - **Explicit table mapping** (`:24`): `builder.ToTable("Category", "Conference")`. The comment (`:21-23`) is honest that this is **redundant**, the base would already derive `Category` from `typeof(Category).Name` and `Conference` from the namespace; it is written out for clarity given the class-name mismatch above.
  - **Columns** (`:26-35`): `Title` required at `CategoryInvariants.TitleMaxLength`; `Sort` required; `Type` optional with a literal `HasMaxLength(100)`, one of the few places in the family that does not read a constant.
- **Why it's built this way**: naming the configuration for the bounded context rather than for the CLR type is a small readability trade: the class is findable by module, and the explicit `ToTable` keeps the physical target visible at the call site rather than implied by a base-class convention two files away.
- **Where it's used**: same discovery path as the rest of the family (see [`CategoryItemConfiguration`](#categoryitemconfiguration)).
- **Caveats / not-in-source**: the doc comment (`:10-11`) cites a Catalog-module `Category` as the collision being avoided. Catalog is a **MMCA.Store** module, not an ADC one, so within this repo nothing would actually collide; treat the comment as rationale carried over from the shared framework vocabulary.

---

### EventConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Events/EventConfiguration.cs:12` · Level 8 · class

- **What it is**: the persistence map for [`Event`](group-17-conference-domain.md#event), the top aggregate of the Conference module (the conference itself: dates, venue, publication state, Sessionize linkage).
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`Event`](group-17-conference-domain.md#event), [`EventInvariants`](group-17-conference-domain.md#eventinvariants), [`QuestionModerationDefault`](group-17-conference-domain.md#questionmoderationdefault), [`NullableEmailValueConverter`](group-07-persistence-ef-core.md#nullableemailvalueconverter). External: `Microsoft.EntityFrameworkCore`.
- **Concept reinforced, the filtered non-unique index.** `HasIndex(p => p.SessionizeCode).HasFilter("[SessionizeCode] IS NOT NULL")` (`:42-43`) is filtered but **not** unique. A filtered index only covers the rows matching its predicate, so this one indexes just the events that carry a Sessionize code, which is the population the import path looks up by. It deliberately does not forbid two events sharing a code, and it costs nothing for the events with a null code. `[Rubric §12, Performance and Scalability]` assesses whether indexes are chosen for the actual query shape rather than sprayed across columns: this is a narrow index sized to one lookup.
- **Concept reinforced, a value object mapped by a converter rather than an owned type.** `OrganizerContactEmail` is an [`Email`](group-02-domain-building-blocks.md#email) value object on the entity, but the column is still the same nullable `nvarchar` it was when the property was a string: `HasConversion(new NullableEmailValueConverter())` (`:61`) turns the object into its text on the way down and back on the way up. The comment above it (`:57-59`) states the consequence directly: converter, not `OwnsOne`, so the store type and length are unchanged and no migration is needed. That is the cheap half of [ADR-068](https://ivanball.github.io/docs/adr/068-value-objects-as-validated-primitives.html), a type-safe domain property bought without touching the schema. `[Rubric §8, Data Architecture]` assesses whether the storage shape is chosen independently of the domain shape.
- **Walkthrough**
  - **Required core** (`:20-22`, `:28-36`): `Name` (`EventInvariants.NameMaxLength`), `StartDate`, `EndDate`, and `TimeZone` (`EventInvariants.TimeZoneMaxLength`). Storing the IANA time-zone id as a column rather than baking a UTC offset into the dates is what lets the schedule render correctly across DST.
  - **Optional descriptive, venue and link columns** (`:24-26`, `:45-71`): `Description`, `VenueAddress`, `VenueMapUrl`, `WiFiInfo`, `OrganizerContactEmail`, `SponsorshipPacketUrl` and `TicketingUrl`, each `IsRequired(false)` with its own invariant-sourced max length, and `OrganizerContactEmail` additionally carrying the converter above (`:60-63`).
  - **Sessionize linkage** (`:38-43`, `:80-84`): `SessionizeCode` optional plus the filtered index above; `LastSessionizeRefreshOn` / `LastSessionizeRefreshBy` are optional audit-style columns recording the last import run. `[Rubric §13, Observability and Operability]` assesses whether the system records the provenance of imported data: these two columns answer "when was this event last synced, and by whom" from the row itself.
  - **State flags** (`:73-78`): `IsPublished` required; `QuestionModerationDefault` required, with the comment (`:76`) noting it is stored as an `int` through EF's default enum conversion and that `Pending` (0) is the safe default per BR-233. There is no `HasConversion` call, EF's default enum-to-int mapping is used as-is, and the enum really does declare `Pending = 0` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Events/Live/QuestionModerationDefault.cs:10`), so the safe default is also the zero value in the database.
  - **Navigation access mode** (`:86-97`): `Rooms`, `EventSpeakers` and `EventQuestionAnswers` are each set to `UsePropertyAccessMode(PropertyAccessMode.Field)` because every one of them is a getter over a private list returned as `AsReadOnly()`. The comment (`:86-91`) is explicit that convention already infers field access here and that stating it is insurance: a later change to the property cannot silently turn materialization into a no-op. It is an access-mode declaration only, the relationships themselves stay configured from the child side.
- **Why it's built this way**: everything the organizer may not know at creation time is nullable, so an event can be created early and enriched later without a two-phase workflow; only the four facts that make an event an event are required.
- **Where it's used**: `Event` is the FK target of [`RoomConfiguration`](#roomconfiguration), [`SessionConfiguration`](#sessionconfiguration), [`EventSpeakerConfiguration`](#eventspeakerconfiguration), [`EventQuestionAnswerConfiguration`](#eventquestionanswerconfiguration), [`ActivityConfiguration`](#activityconfiguration) and [`SponsorConfiguration`](#sponsorconfiguration).

---

### EventQuestionAnswerConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Events/EventQuestionAnswerConfiguration.cs:11` · Level 8 · class

- **What it is**: the persistence map for [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer), one attendee's answer to one event-scoped [`Question`](group-17-conference-domain.md#question).
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer), [`Event`](group-17-conference-domain.md#event), [`EventInvariants`](group-17-conference-domain.md#eventinvariants), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions) (`HasSoftDeleteFilter`). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept introduced, `HasSoftDeleteFilter()` and the database as the concurrency backstop.**
  - `HasSoftDeleteFilter()` (`IndexBuilderExtensions.cs:50-64`) replaces a hand-typed `HasFilter("[IsDeleted] = 0")`. It builds the predicate through [`SoftDeleteFilterSql`](group-07-persistence-ef-core.md#softdeletefiltersql) from the live model (`:56`), so a renamed soft-delete column follows automatically and the identifier quoting comes from the engine instead of a SQL-Server-shaped literal. Its `engine` parameter defaults to `DataSource.SQLServer` (`:51`), which is exactly what the `…SQLServer` base already implies. On a **unique** index the call is technically redundant with `SoftDeleteUniqueIndexConvention`, which would apply the same predicate at model finalizing; writing it explicitly keeps the intent readable at the call site, and because the convention skips any index that already declares a filter (`SoftDeleteUniqueIndexConvention.cs:53`) the two can never disagree. On a **non-unique** index like the `EventId` lookup here, the convention deliberately does nothing, so the explicit call is the only way to get the filter.
  - The `(EventId, QuestionId, CreatedBy)` unique index (`:42-44`) is a **race backstop**, and the comment (`:38-41`) is unusually candid about why: the application-level upsert only inspects the in-memory collection, so two concurrent submits can both take the create branch. The database refuses the second one, and the shared `DbUpdateException` handler turns the violation into a 409 for the client. `[Rubric §8, Data Architecture]` assesses whether invariants that matter are enforced where they cannot be raced, and `[Rubric §15, Best Practices and Code Quality]` assesses whether known limitations are documented at the point of the compensating control rather than left for the next reader to discover.
- **Walkthrough**: required `EventId` and `QuestionId` scalars (`:19-23`); required `AnswerValue` at `EventInvariants.AnswerValueMaxLength` (`:25-27`); required parent relationship `HasOne(p => p.Event).WithMany(p => p.EventQuestionAnswers).HasForeignKey(p => p.EventId)` (`:29-32`); soft-delete-filtered lookup index on `EventId` (`:35-36`); the BR-123 filtered unique index (`:42-44`).
- **Why it's built this way**: `CreatedBy` is part of the uniqueness tuple, so "one live answer per question" is scoped **per author**, not globally, which is what a per-attendee feedback form needs.
- **Where it's used**: written by the Conference event-feedback command handlers; read by the feedback queries. Compare its sibling [`SessionQuestionAnswerConfiguration`](#sessionquestionanswerconfiguration), which carries the same BR-123 index but treats its parent lookup index differently for a specific reason.

---

### EventSpeakerConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Events/EventSpeakerConfiguration.cs:11` · Level 8 · class

- **What it is**: the persistence map for the [`EventSpeaker`](group-17-conference-domain.md#eventspeaker) join entity, which records that a speaker is part of an event's line-up.
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`EventSpeaker`](group-17-conference-domain.md#eventspeaker), [`Event`](group-17-conference-domain.md#event), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept introduced, the join-entity template.** Four configurations in this folder are structurally identical, and this is the first: both FK scalars required, one `HasOne(...).WithMany(...)` relationship to the **owning** aggregate only (the side whose collection navigation the join belongs to), and a soft-delete-filtered composite unique index on the two FKs. The other side of the pair is deliberately *not* configured as a relationship, which keeps the entity a one-way child of a single aggregate and matches the DDD rule that an aggregate owns its children. `[Rubric §4, DDD]` assesses aggregate boundary discipline; `[Rubric §8, Data Architecture]` assesses the uniqueness guarantee.
  The soft-delete filter on the unique index is what makes a delete-then-re-add cycle legal: a plain unique index would let a soft-deleted association keep occupying its slot forever, so an organizer could never re-add a speaker they had removed.
- **Walkthrough**: required `EventId` (`:19-20`) and `SpeakerId` (`:22-23`); `HasOne(p => p.Event).WithMany(p => p.EventSpeakers).HasForeignKey(p => p.EventId).IsRequired()` (`:25-28`); `HasIndex(p => new { p.EventId, p.SpeakerId }).IsUnique().HasSoftDeleteFilter()` (`:30-32`).
- **Where it's used**: the same template appears in [`SessionSpeakerConfiguration`](#sessionspeakerconfiguration), [`SessionCategoryItemConfiguration`](#sessioncategoryitemconfiguration) and [`SpeakerCategoryItemConfiguration`](#speakercategoryitemconfiguration).

| Type | File:Line | Owning aggregate | Unique index |
|------|-----------|------------------|--------------|
| `EventSpeakerConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Events/EventSpeakerConfiguration.cs:11` | [`Event`](group-17-conference-domain.md#event) | `(EventId, SpeakerId)` |
| `SessionSpeakerConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Sessions/SessionSpeakerConfiguration.cs:11` | [`Session`](group-17-conference-domain.md#session) | `(SessionId, SpeakerId)` |
| `SessionCategoryItemConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Sessions/SessionCategoryItemConfiguration.cs:11` | [`Session`](group-17-conference-domain.md#session) | `(SessionId, CategoryItemId)` |
| `SpeakerCategoryItemConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Speakers/SpeakerCategoryItemConfiguration.cs:11` | [`Speaker`](group-17-conference-domain.md#speaker) | `(SpeakerId, CategoryItemId)` |

---

### QuestionConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Questions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Questions/QuestionConfiguration.cs:10` · Level 8 · class

- **What it is**: the persistence map for [`Question`](group-17-conference-domain.md#question), the definition of a feedback question (its text, what it attaches to, how it renders, and where it came from).
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`Question`](group-17-conference-domain.md#question), [`QuestionInvariants`](group-17-conference-domain.md#questioninvariants). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept**: the shared shape is taught under [`CategoryItemConfiguration`](#categoryitemconfiguration). What is worth noticing here is that this is the flattest configuration in the folder: six required properties, **no relationships and no indexes at all**.
- **Walkthrough** (`:18-38`): all six columns are `IsRequired()`. `QuestionText`, `QuestionEntity`, `QuestionType` and `QuestionSource` each take their length from `QuestionInvariants`; `Sort` and `IsRequired` (the boolean, not the fluent call) are plain required scalars. `QuestionEntity` and `QuestionType` are declared as `string` on the entity (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Questions/Question.cs:20`, `:23`), **not enums**, so adding a question type or a new attachable entity needs no migration and no enum-to-string conversion.
- **Why it's built this way**: questions are attached to events, sessions and speakers by the three `…QuestionAnswer` entities, and those answers carry a plain `QuestionId` scalar rather than a navigation, so `Question` itself needs no relationship configuration. Modelling the discriminators as strings keeps the question catalogue extensible from data rather than from code.
- **Where it's used**: referenced by `QuestionId` from [`EventQuestionAnswerConfiguration`](#eventquestionanswerconfiguration), [`SessionQuestionAnswerConfiguration`](#sessionquestionanswerconfiguration) and [`SpeakerQuestionAnswerConfiguration`](#speakerquestionanswerconfiguration).

---

### RoomConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Events` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Events/RoomConfiguration.cs:11` · Level 8 · class

- **What it is**: the persistence map for [`Room`](group-17-conference-domain.md#room), a physical room belonging to an [`Event`](group-17-conference-domain.md#event).
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`Room`](group-17-conference-domain.md#room), [`Event`](group-17-conference-domain.md#event), [`EventInvariants`](group-17-conference-domain.md#eventinvariants), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept introduced, re-declaring an index EF would otherwise drop.** The explicit `builder.HasIndex(p => p.EventId)` (`:48`) looks redundant next to the `(EventId, Name)` composite below it, and the comment (`:46-47`) says exactly why it is not: EF removes the conventional foreign-key index as redundant once a composite index **leads with the same column**, but the composite is filtered, and the plain FK lookups still want an unfiltered index. This is a good example of a mapping decision that only makes sense once you know EF's own de-duplication rule; without the comment the line reads as a mistake. `[Rubric §12, Performance and Scalability]` assesses whether index choices survive framework conventions rather than being silently optimized away.
- **Walkthrough**
  - **Required** (`:19-24`): `Name` at `EventInvariants.RoomNameMaxLength`, and `Sort`.
  - **Optional** (`:26-39`): `Capacity` (a nullable scalar with no length), plus `Floor`, `Location` and `AccessibilityInfo`, each with an invariant-sourced max length. `AccessibilityInfo` being a first-class room column, not a note bolted onto the description, is the schema-level half of ADC's accessibility commitment. `[Rubric §21, Accessibility]` assesses whether accessibility is designed into the data rather than added at the view.
  - **Parent relationship** (`:41-44`): required `HasOne(p => p.Event).WithMany(p => p.Rooms).HasForeignKey(p => p.EventId)`.
  - **Indexes** (`:48`, `:52-54`): the re-declared plain `EventId` index, then `HasIndex(p => new { p.EventId, p.Name }).IsUnique().HasSoftDeleteFilter()`. The comment (`:50-51`) states its purpose plainly: it backstops the aggregate's duplicate-room-name invariant, and the soft-delete filter means a deleted room never blocks reusing its name.
- **Why it's built this way**: the domain already refuses a duplicate room name inside the `Event` aggregate; the filtered unique index is the database-side guarantee for the concurrent case the in-memory check cannot see, the same defence-in-depth reasoning as BR-123 in [`EventQuestionAnswerConfiguration`](#eventquestionanswerconfiguration).
- **Where it's used**: `Room` is the optional FK target of [`SessionConfiguration`](#sessionconfiguration), which restricts deletes against it.

---

### SessionAiScoreConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Sessions/SessionAiScoreConfiguration.cs:11` · Level 8 · class

- **What it is**: the persistence map for [`SessionAiScore`](group-17-conference-domain.md#sessionaiscore), the row that stores a language model's rating of one session across seven dimensions plus its written reasoning.
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`SessionAiScore`](group-17-conference-domain.md#sessionaiscore), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept introduced, sizing a decimal column to the value's actual range.** Each of the seven score columns is declared `HasPrecision(3, 1)`, that is `decimal(3,1)`: three total digits, one after the point (`:22-48`). That is the smallest exact-decimal shape that holds a one-decimal rating without the rounding surprises a `float`/`double` column would introduce. Choosing exact decimal for a value that is compared and sorted, rather than binary floating point, is the point. `[Rubric §8, Data Architecture]` assesses type fidelity of stored values.
- **Concept reinforced, recording the provenance of derived data.** `ModelUsed` (`:54-56`, a literal max length of 100), `PromptVersion` (`:61-63`, a literal max length of 32) and `Reasoning` (`:50-52`, a literal max length of 4000) are all three **required**, and all three are among the few columns in this folder whose lengths are written as literals rather than read from an invariants class. Persisting which model produced a score, which version of the prompt contract it was asked under, and the sentence explaining it, alongside the numbers is what makes an AI judgement auditable: you can tell after the fact whether a given score came from a model or a prompt you have since replaced. The comment above `PromptVersion` (`:58-60`) records both the format, a dated contract version `yyyy-MM-dd.N` that makes 32 characters generous, and the backfill: rows written before the column existed carry `"legacy"` from the `AddSessionAiScorePromptVersion` migration's column default. `[Rubric §13, Observability and Operability]` assesses whether derived values carry enough context to be explained later.
- **Walkthrough**: required `SessionId` scalar (`:19-20`); seven `decimal(3,1)` required score columns, `OverallScore`, `TopicRelevanceScore`, `DescriptionQualityScore`, `NoveltyScore`, `ActionableTakeawaysScore`, `DepthOrInsightQualityScore`, `CredibilityExperienceScore` (`:22-48`); required `Reasoning`, `ModelUsed` and `PromptVersion` (`:50-63`); and `HasIndex(p => p.SessionId).IsUnique().HasSoftDeleteFilter()` (`:66-68`), commented "One score per session (among non-deleted)" (`:65`). There is **no** `HasOne` relationship to [`Session`](group-17-conference-domain.md#session): `SessionId` is a plain scalar, so the score row is not a child of the session aggregate.
- **Why it's built this way**: keeping the score in its own table behind a unique-per-session index means re-scoring is a soft-delete plus insert (the filter frees the slot) rather than an in-place overwrite, and the previous scoring run stays on disk for comparison.
- **Where it's used**: written by the Conference scoring pipeline, whose adapter and processor are covered earlier in this chapter under [`AnthropicScoringService`](#anthropicscoringservice) and [`SessionScoringProcessor`](#sessionscoringprocessor).
- **Caveats / not-in-source**: this configuration only defines the table. Whether scoring runs in a given environment is a configuration and feature-gating question decided outside this file. Note also that [`ModuleApplicationDbContext`](#moduleapplicationdbcontext) declares no `DbSet` for `SessionAiScore` (its fifteen sets are listed at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:28-70`), and nothing breaks, because that manifest does not drive the model.

---

`[Rubric §16, AI-Native Application Architecture]` applies: this type is part of the AI session-scoring feature (a model call behind a port, versioned prompt and model, an evaluation gate, metered spend; ADR-111).

### SpeakerCategoryItemConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Speakers/SpeakerCategoryItemConfiguration.cs:11` · Level 8 · class

- **What it is**: the persistence map for the [`SpeakerCategoryItem`](group-17-conference-domain.md#speakercategoryitem) join entity, which tags a speaker with a [`CategoryItem`](group-17-conference-domain.md#categoryitem) (locality, expertise and so on).
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`SpeakerCategoryItem`](group-17-conference-domain.md#speakercategoryitem), [`Speaker`](group-17-conference-domain.md#speaker), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept**: an exact instance of the join-entity template taught under [`EventSpeakerConfiguration`](#eventspeakerconfiguration).
- **Walkthrough**: required `SpeakerId` (`:19-20`) and `CategoryItemId` (`:22-23`); `HasOne(p => p.Speaker).WithMany(p => p.SpeakerCategoryItems).HasForeignKey(p => p.SpeakerId).IsRequired()` (`:25-28`); `HasIndex(p => new { p.SpeakerId, p.CategoryItemId }).IsUnique().HasSoftDeleteFilter()` (`:30-32`). The `CategoryItem` end is intentionally left unmapped as a relationship, so the row belongs to the speaker aggregate alone.
- **Where it's used**: the speaker-profile read paths join through it to resolve a speaker's tags.

---

### SpeakerConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Speakers/SpeakerConfiguration.cs:12` · Level 8 · class

- **What it is**: the persistence map for [`Speaker`](group-17-conference-domain.md#speaker): name, bio, social links, the optional link to an Identity user, and the one value-object column in the Conference module.
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`Speaker`](group-17-conference-domain.md#speaker), [`SpeakerInvariants`](group-17-conference-domain.md#speakerinvariants), [`NullableEmailValueConverter`](group-07-persistence-ef-core.md#nullableemailvalueconverter), and transitively the [`Email`](group-02-domain-building-blocks.md#email) value object. External: `Microsoft.EntityFrameworkCore`.
- **Concept introduced, mapping a value object with `HasConversion` instead of `OwnsOne`.** `builder.Property(p => p.Email).HasConversion(new NullableEmailValueConverter())` (`:42-43`) round-trips the `Email?` value object to a plain nullable string column. The converter (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/EmailValueConverter.cs:60-71`) passes `null` straight through on both legs (`:67-68`), so "no email" stays a SQL `NULL` rather than becoming an empty string or a failed `Email.Create` call. Two design points worth carrying forward:
  - **Why `HasConversion` and not `OwnsOne`**: the backing column stays a plain string, so adopting the value object on a property that used to be a `string` is not a schema change (`EmailValueConverter.cs:8-10`).
  - **Facets stay at the call site**: the converter deliberately owns no length or requiredness, which is why `HasMaxLength(SpeakerInvariants.EmailMaxLength)` and `IsRequired(false)` are chained here (`:44-45`). Those differ per entity and are not the converter's business (`EmailValueConverter.cs:20-22`).

  `[Rubric §4, DDD]` assesses whether value objects survive the trip to storage instead of being flattened into primitives at the boundary. `[Rubric §15, Best Practices & Code Quality]` applies too: the conversion logic lives once in MMCA.Common, so every entity with an email gets identical semantics.
- **Concept reinforced, the partially filtered unique index.** `HasIndex(p => p.LinkedUserId).IsUnique().HasFilter("[LinkedUserId] IS NOT NULL")` (`:63-65`) enforces the one-to-one User to Speaker link **only among speakers that have one**. Without the predicate, SQL Server would treat multiple `NULL`s as duplicates and allow at most one unlinked speaker, which would be nonsense. Note this one is a hand-written literal rather than `HasSoftDeleteFilter()`, because the predicate is about `LinkedUserId`, not about soft delete; the soft-delete clause is not added on top, because `SoftDeleteUniqueIndexConvention` skips any index that already declares a filter (`SoftDeleteUniqueIndexConvention.cs:53`). A soft-deleted linked speaker therefore keeps holding its `LinkedUserId` slot.
- **Walkthrough**
  - **Required identity** (`:20-26`, `:39-40`): `FirstName`, `LastName`, `IsTopSpeaker`.
  - **Optional profile** (`:28-37`, `:47-61`): `Bio` (no max length, so `nvarchar(max)`), `TagLine`, `ProfilePicture`, `TwitterHandle`, `LinkedInUrl`, `GitHubUrl`, `WebsiteUrl`, each length-capped from `SpeakerInvariants` except `Bio`.
  - **Email** (`:42-45`) and the **`LinkedUserId` index** (`:63-65`), described above.
  - **Computed property excluded** (`:68`): `builder.Ignore(p => p.FullName)` keeps the derived `FullName` out of the schema. Ignoring computed properties explicitly is how this codebase keeps derived state a domain concern and off the table.
- **Why it's built this way**: `LinkedUserId` is a **scalar with no FK**, deliberately. The Identity user lives in a different service database, so a cross-database foreign key is not available under database-per-service; the unique index gives the guarantee the FK would have, within the one database that can enforce it. See [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html). `[Rubric §7, Microservices Readiness]` assesses whether the schema is already free of cross-service constraints, which is what makes the Conference service extractable.
- **Where it's used**: `Speaker` is the owning aggregate for [`SpeakerCategoryItemConfiguration`](#speakercategoryitemconfiguration) and [`SpeakerQuestionAnswerConfiguration`](#speakerquestionanswerconfiguration), and the FK target of the `SpeakerId` scalar in [`EventSpeakerConfiguration`](#eventspeakerconfiguration) and [`SessionSpeakerConfiguration`](#sessionspeakerconfiguration).

---

### SpeakerQuestionAnswerConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Speakers` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Speakers/SpeakerQuestionAnswerConfiguration.cs:10` · Level 8 · class

- **What it is**: the persistence map for [`SpeakerQuestionAnswer`](group-17-conference-domain.md#speakerquestionanswer), a speaker's answer to a speaker-scoped [`Question`](group-17-conference-domain.md#question) (the fields Sessionize collects on a submission form).
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`SpeakerQuestionAnswer`](group-17-conference-domain.md#speakerquestionanswer), [`Speaker`](group-17-conference-domain.md#speaker), [`SpeakerInvariants`](group-17-conference-domain.md#speakerinvariants). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept**: the answer-entity shape is taught under [`EventQuestionAnswerConfiguration`](#eventquestionanswerconfiguration). This is the **stripped-down** member of the three: it declares no indexes at all, and it is the only one of the three that does not import `MMCA.Common.Infrastructure.Persistence.Configuration`, because it never needs `HasSoftDeleteFilter()`.
- **Walkthrough** (`:18-31`): required `SpeakerId`, `QuestionId` and `AnswerValue` (at `SpeakerInvariants.AnswerValueMaxLength`), then `HasOne(p => p.Speaker).WithMany(p => p.SpeakerQuestionAnswers).HasForeignKey(p => p.SpeakerId).IsRequired()`. Only the conventional EF index on the `SpeakerId` foreign key exists.
- **Why it's built this way**: these rows arrive from the Sessionize import as part of a speaker payload and are read back with the speaker, never queried independently or submitted concurrently by two authors, so neither the BR-123 anti-race unique index nor an extra lookup index earns its cost here. Contrast with the event and session answer configurations, where an attendee-facing form can be double-submitted.
- **Where it's used**: populated by the Sessionize sync path and read as part of the speaker detail projection.

---

### SessionCategoryItemConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Sessions/SessionCategoryItemConfiguration.cs:11` · Level 9 · class

- **What it is**: the persistence map for the [`SessionCategoryItem`](group-17-conference-domain.md#sessioncategoryitem) join entity, which tags a session with a [`CategoryItem`](group-17-conference-domain.md#categoryitem) (topic, level, track).
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`SessionCategoryItem`](group-17-conference-domain.md#sessioncategoryitem), [`Session`](group-17-conference-domain.md#session), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept**: an exact instance of the join-entity template taught under [`EventSpeakerConfiguration`](#eventspeakerconfiguration).
- **Walkthrough**: required `SessionId` (`:19-20`) and `CategoryItemId` (`:22-23`); `HasOne(p => p.Session).WithMany(p => p.SessionCategoryItems).HasForeignKey(p => p.SessionId).IsRequired()` (`:25-28`); `HasIndex(p => new { p.SessionId, p.CategoryItemId }).IsUnique().HasSoftDeleteFilter()` (`:30-32`).
- **Where it's used**: the session browse and filter queries resolve topic tags through these rows.

---

### SessionConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Sessions/SessionConfiguration.cs:12` · Level 9 · class

- **What it is**: the persistence map for [`Session`](group-17-conference-domain.md#session), the busiest entity in the Conference schema: talk metadata, schedule window, status flags, links, and the relationships to its event and room.
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`Session`](group-17-conference-domain.md#session), [`Event`](group-17-conference-domain.md#event), [`Room`](group-17-conference-domain.md#room), [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore` (for `DeleteBehavior`).
- **Concept introduced, `DeleteBehavior.Restrict` as a schedule-integrity guard.** The optional room relationship (`:83-87`) ends in `.OnDelete(DeleteBehavior.Restrict)`. Under EF's default for an optional relationship the FK would be **set to null** on delete, silently unscheduling every talk in the room; `Restrict` makes the database refuse the delete instead, forcing the organizer to move the sessions first. `[Rubric §8, Data Architecture]` assesses whether referential actions match the business meaning of the relationship rather than the framework default.
- **Concept reinforced, navigation configured on one side only.** Both relationships here use the parameterless `WithMany()` (`:73`, `:84`), meaning **there is no inverse collection navigation** on `Event` or `Room` for sessions. Sessions are a large collection queried with paging and filters, so exposing them as an aggregate navigation would invite accidental full loads; the read paths go through explicit queries instead.
- **Walkthrough**
  - **Required** (`:20-22`, `:38-48`, `:69-70`): `Title` at `SessionInvariants.TitleMaxLength`; four booleans, `IsInformed`, `IsConfirmed`, `IsServiceSession`, `IsPlenumSession`; and the `EventId` scalar.
  - **Optional** (`:24-36`, `:50-64`, `:80-81`): `Description`, `StartsAt`, `EndsAt`, `Status`, `LiveUrl`, `RecordingUrl`, `AccessibilityInfo`, `ResourceLinks`, `RoomId`. That `StartsAt`, `EndsAt` and `RoomId` are all nullable is the schema admitting that a session exists as an accepted talk long before it is scheduled.
  - **`Status` is a plain string** (`:34-36`) capped at `SessionInvariants.StatusMaxLength`, not an enum with a conversion (the entity declares it as `string?` at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/Session.cs:37`), so adding a status value needs no migration.
  - **Computed property excluded** (`:67`): `builder.Ignore(p => p.Duration)`, since `Duration` is derived from `StartsAt` and `EndsAt` (`Session.cs:80`).
  - **Event relationship** (`:72-75`) required, plus `HasIndex(p => p.EventId).HasSoftDeleteFilter()` (`:77-78`), a non-unique filtered lookup index for "all live sessions of this event", the single hottest read in the app.
  - **Room relationship** (`:83-87`) optional, with the `Restrict` behaviour described above.
- **Why it's built this way**: the required or optional split mirrors the real conference workflow (accept first, schedule later), and the two relationship decisions, no inverse navigation and restricted room deletes, both trade a little convenience for predictable performance and predictable schedule integrity.
- **Where it's used**: `Session` is the owning aggregate for [`SessionSpeakerConfiguration`](#sessionspeakerconfiguration), [`SessionCategoryItemConfiguration`](#sessioncategoryitemconfiguration) and [`SessionQuestionAnswerConfiguration`](#sessionquestionanswerconfiguration), and the scalar target of [`SessionAiScoreConfiguration`](#sessionaiscoreconfiguration).

---

### SessionQuestionAnswerConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Sessions/SessionQuestionAnswerConfiguration.cs:11` · Level 9 · class

- **What it is**: the persistence map for [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer), one attendee's answer to one session-scoped feedback [`Question`](group-17-conference-domain.md#question).
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer), [`Session`](group-17-conference-domain.md#session), [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept introduced, when a filtered index is the wrong index.** This configuration keeps a plain, unfiltered `HasIndex(p => p.SessionId)` (`:37`) alongside the filtered composite, and the comment (`:34-36`) gives a reason worth internalising: the Sessionize sync reads this table by `SessionId` **with the query filters OFF**, and a filtered index cannot serve a query that does not carry the filter's predicate. Soft-delete-filtered indexes are the default choice for application reads, but any code path that deliberately bypasses the global query filter needs an unfiltered index or it falls back to a scan. Compare [`EventQuestionAnswerConfiguration`](#eventquestionanswerconfiguration), whose equivalent parent index **is** filtered, because nothing reads event answers with the filters off. `[Rubric §12, Performance and Scalability]` assesses whether indexes match the queries that actually run, including the maintenance ones.
- **Walkthrough**: required `SessionId`, `QuestionId` and `AnswerValue` at `SessionInvariants.AnswerValueMaxLength` (`:19-27`); required parent relationship `HasOne(p => p.Session).WithMany(p => p.SessionQuestionAnswers).HasForeignKey(p => p.SessionId)` (`:29-32`); the deliberately unfiltered `SessionId` index (`:37`); and the BR-123 index `HasIndex(p => new { p.SessionId, p.QuestionId, p.CreatedBy }).IsUnique().HasSoftDeleteFilter()` (`:43-45`), whose comment (`:39-42`) repeats the concurrency rationale taught under [`EventQuestionAnswerConfiguration`](#eventquestionanswerconfiguration): the in-memory upsert can be raced, the database refuses the loser, and the shared `DbUpdateException` handler renders it as a 409.
- **Why it's built this way**: it carries both index shapes because it serves two different consumers, an attendee-facing form that must not double-submit, and an import job that reads across soft-deleted rows.
- **Where it's used**: written by the session-feedback command handlers, read by the feedback aggregation queries and by the Sessionize sync.

---

### SessionSpeakerConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Sessions` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Sessions/SessionSpeakerConfiguration.cs:11` · Level 9 · class

- **What it is**: the persistence map for the [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker) join entity, which records who is presenting a session.
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker), [`Session`](group-17-conference-domain.md#session), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept**: an exact instance of the join-entity template taught under [`EventSpeakerConfiguration`](#eventspeakerconfiguration).
- **Walkthrough**: required `SessionId` (`:19-20`) and `SpeakerId` (`:22-23`); `HasOne(p => p.Session).WithMany(p => p.SessionSpeakers).HasForeignKey(p => p.SessionId).IsRequired()` (`:25-28`); `HasIndex(p => new { p.SessionId, p.SpeakerId }).IsUnique().HasSoftDeleteFilter()` (`:30-32`). The composite unique index is what stops the same speaker being added twice to one session, while still allowing a remove-then-re-add.
- **Where it's used**: joined by the session detail and speaker detail read paths to resolve a session's presenters.

---

### ConferenceModuleDbSeeder

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts.Seeding` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:25` · Level 9 · class

- **What it is**: the Conference module's startup data seeder. It puts the two real conference editions and the ten feedback questions into a fresh database on every boot, and, only when its `includeSampleData` flag is set, a small deterministic browse fixture on top (two speakers, two sessions, the speaker links, four sponsors, three social activities). Every write goes through a domain factory and the unit of work, and every insert is guarded by an existence check, so running it against an already-seeded database is a no-op.
- **Depends on**: first-party: [`DbSeeder`](group-07-persistence-ef-core.md#dbseeder) (base, `:25`), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (`:25`, `:44`) and the `IRepository<TEntity, TIdentifierType>` handles it hands out (`:66`, `:141`, `:189`, `:243`, `:302`, `:356`, `:415`), the domain factories [`Event`](group-17-conference-domain.md#event) (`:81`, `:116`), [`Question`](group-17-conference-domain.md#question) (`:169`), [`Speaker`](group-17-conference-domain.md#speaker) (`:209`), [`Session`](group-17-conference-domain.md#session) (`:273`), [`Sponsor`](group-17-conference-domain.md#sponsor) (`:381`) and [`Activity`](group-17-conference-domain.md#activity) (`:454`), the join entities [`EventSpeaker`](group-17-conference-domain.md#eventspeaker) and [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker) (created indirectly at `:338`, `:341`, `:511`), the id-range constants on [`QuestionInvariants`](group-17-conference-domain.md#questioninvariants) (`:165`) and [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants) (`:251-252`), and [`SponsorTier`](group-17-conference-domain.md#sponsortier) (`:358`). External: BCL only (`DateOnly`, `TimeOnly`, `TimeSpan`, `DateTimeKind`).
- **Concept introduced, seeding through the domain rather than through SQL.** A seeder in this codebase never writes rows. It calls the same static factory an HTTP command handler would call, checks the returned [`Result`](group-01-result-error-handling.md#result) wrapper, hands the entity to a repository, and lets [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) commit. `Event.Create(...)` at `:81-93` is the identical entry point the organizer's create-event use case takes, so seeded data satisfies exactly the invariants that user-created data satisfies: there is no second, looser definition of a valid event hiding in the seeder. The consequence worth internalizing is that a seed insert is a full domain write with all its side effects: `eventResult.Value!.Publish()` at `:98` flips `IsPublished` **and** raises an `EventChanged` domain event (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/Event.cs:310-312`), so the `SaveChangesAsync` at `:101` writes an outbox row alongside the entity row. Startup seeding therefore feeds the same dual-dispatch pipeline as runtime traffic (ADR-003), it does not bypass it. `[Rubric §4, DDD]` assesses whether the domain model is the single place invariants live; routing seed data through the factories is what keeps that true at the one moment it is most tempting to cheat.
- **Concept introduced, idempotency that respects soft delete.** Every existence probe in this file passes `ignoreQueryFilters: true` (`:75`, `:110`, `:145`, `:203`, `:264`, `:375`, `:446`), which turns off the global soft-delete filter for that one query. The comment at `:68-72` gives both halves of the reason. First, a deleted seed row is a decision someone made, not a gap to refill, so the seeder must see it and stand down. Second, the fixed-id rows (questions at `:170`, sample sessions at `:251-252`) keep their primary keys when soft-deleted, so a filtered check would report "missing", re-insert the same id, and take startup down on a primary-key violation. The `ExistsAsync(Expression<Func<TEntity, bool>>, bool ignoreQueryFilters, CancellationToken)` overload that makes this possible is on the shared repository contract (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRepository.cs:62-65`). [`ConferenceModuleDbSeederTests`](group-27-testing-infrastructure.md#conferencemoduledbseedertests) pins the behavior mechanically: its Moq setups match `true` for that parameter only (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Infrastructure.Tests/Seeding/ConferenceModuleDbSeederTests.cs:103-113`), so a future edit that drops the flag falls through to Moq's default `false` and the "skips when exists" tests go red (the reasoning is spelled out in the comment at `:99-102` of that test file). `[Rubric §17, DevOps]` assesses whether startup is repeatable and safe to re-run; this is the pattern that makes "boot the app twice" a non-event.
- **Concept introduced, environment-gated fixture data.** The class takes `bool includeSampleData = false` (`:25`), stores it (`:45`), and branches on it in `SeedAsync` (`:54-61`). The default is off, and the only thing that turns it on is [`ConferenceModuleSeeder`](group-20-conference-api-grpc.md#conferencemoduleseeder) reading `configuration.GetValue<bool>("Seeding:IncludeSampleConferenceData")` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:26`). `GetValue<bool>` on an absent key yields `false`, so a production host that never sets the key gets the real events and questions and nothing else. The one place the key is set is the local Aspire AppHost, `.WithEnvironment("Seeding__IncludeSampleConferenceData", "true")` on the Conference service (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:210`, rationale at `:207-209`). E2E CI inherits it by launching that same AppHost (`MMCA.ADC/.github/workflows/e2e.yml:219`), which is why the two public-browse tests can assume rows exist (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/Conference/Public/PublicBrowseTests.cs:92`, `:102`). `[Rubric §11, Security]` assesses whether non-production affordances are structurally unable to reach production: here the gate is a default-false configuration read in the composition root, not a runtime environment sniff inside the seeder.
- **Concept introduced, reserved manual id ranges.** Conference session ids are app-assigned rather than database-generated because the integer primary key **is** the Sessionize id when a session arrives through the import (comment at `:245-248`). Sample sessions have no Sessionize id, so they take explicit ids from the top of the integer space: `SessionInvariants.ManualIdRangeStart` is `999_999_000` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionInvariants.cs:44`) and the two fixtures take that value and that value plus one (`:251-252`). Questions do the same from `QuestionInvariants.ManualIdRangeStart`, also `999_999_000` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Questions/QuestionInvariants.cs:40`), incremented per question by `id: nextId++` (`:165`, `:170`). The range sits above any id an upstream system will mint, so seed rows and imported rows can never collide, and the same constants are what the organizer-facing create handlers continue from. `[Rubric §8, Data Architecture]` assesses whether key strategy is deliberate; reserving a high range is the cheap alternative to a separate identity column or a synthetic-vs-natural key split.
- **Walkthrough**
  - **Primary constructor and fields** (`:25`, `:44-45`): `ConferenceModuleDbSeeder(IUnitOfWork unitOfWork, bool includeSampleData = false) : DbSeeder()`. The unit of work is null-guarded into `_unitOfWork` at `:44` (the one behavior a unit test asserts directly, `ConferenceModuleDbSeederTests.cs:73-75`); the flag is copied to `_includeSampleData` at `:45`. The base [`DbSeeder`](group-07-persistence-ef-core.md#dbseeder) contributes the `SeedAsync` abstract member and a `GetId<TIdentifier>(int)` helper for int-or-Guid key strategies (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/DbSeeder.cs:20-39`), which this seeder does not use: the Conference identifier aliases are `int`, so literal ids pass straight through.
  - **Literal constants** (`:27-42`): the shared venue address and embedded map URL, two placeholder URLs for sample sponsors and activities, and the two published sponsorship-packet URLs. The five URL constants each carry a `SuppressMessage` for Sonar `S1075` (URIs should not be hardcoded) with a per-constant justification, which is how this repo records "the literal is the data" rather than switching the analyzer off.
  - **`SeedAsync`** (`:48-62`): the whole contract in eleven lines. Three unconditional steps (`:50-52`) then a single `if (_includeSampleData)` block of five (`:54-61`). Ordering is a real dependency chain: sessions need the events, the speaker links need both the speakers and the sessions, sponsors and activities need the events.
  - **`SeedCloudAiConferenceEventAsync`** (`:64-102`): probes for the event by name, tolerating the pre-rename spelling so a database seeded before "2026" was prefixed stays idempotent (`:73-76`). On a miss it builds the 2026 Atlanta Cloud + AI Conference for 2026-05-30 in `America/New_York` with Sessionize code `z1ecmzux` (`:81-93`), returns quietly if the factory fails (`:95-96`), publishes (`:98`), adds and saves (`:100-101`).
  - **`SeedDevelopersConferenceEventAsync`** (`:104-137`): the same shape for the 2026 Atlanta Developers Conference on 2026-10-17, Sessionize code `sf1nopko` (`:116-128`). It needs no legacy-name alternative because that event was never renamed.
  - **`SeedQuestionsAsync`** (`:139-185`): one probe on the sentinel question `"Rate the Session"` with `QuestionSource == "User"` (`:143-146`) decides the whole set, then ten tuples (`:151-163`) become ten `Question.Create` calls with sequential reserved ids (`:167-182`) and a single save (`:184`). Six are session-scoped (five ratings plus a free-text comment), four are event-scoped. The `Times.Exactly(10)` assertion in the unit tests (`ConferenceModuleDbSeederTests.cs:28-30`) is what keeps that count honest.
  - **`SeedSpeakersAsync`** (`:187-228`): two sample speakers, Ada Lovelace and Alan Turing on `example.com` addresses (`:191-195`), each probed by first and last name (`:201-204`) and skipped individually with `continue` rather than aborting the batch (`:206-207`). An `added` flag (`:197`, `:223`) means the save at `:226-227` only runs when something actually changed. That flag pattern repeats in every sample-data method.
  - **`SeedSessionsAsync`** (`:230-298`): resolves both events through the shared helper (`:240-241`), then seeds one session per event (Ada's keynote on the Cloud + AI day, Alan's Azure talk on the Developers day, `:249-253`) so both the auto-filtered public pages and the organizer list's event filter have data for either selection (`:234-239`). Start time is computed from the owning event's own date, `sessionEvent.StartDate.ToDateTime(new TimeOnly(13, 0), DateTimeKind.Utc)` (`:271`), with the comment recording that 13:00 UTC is 09:00 Eastern for both dates; the session runs one hour (`:277-278`). Idempotency here is by title (`:262-265`), which is also why the comment at `:237-239` notes that a database seeded before the one-session-per-event split keeps its old shape: the title check never moves an existing row.
  - **`SeedSampleEventLinksAsync`** (`:300-324`): loads the two sample speakers untracked-free (`asTracking: false`, `:304-309`), bails if either is missing (`:311-314`), then calls the two link helpers and ORs their results (`:319-320`) before one save (`:322-323`). The comment at `:316-318` explains why both link paths are populated: the speakers-by-event filter has a direct branch (through `EventSpeaker`) and a transitive branch (through `SessionSpeaker`), and seeding both exercises both in dev and CI.
  - **`LinkSampleEventSpeakersAsync`** (`:326-345`) and **`LinkSampleSessionSpeakersAsync`** (`:496-516`): both re-fetch with `asTracking: true` and an `includes` list so the aggregate's child collection is loaded before mutation (`:330-331` includes `nameof(Event.EventSpeakers)`; `:500-504` includes `nameof(Session.SessionSpeakers)`). Idempotency is delegated to the domain: `AddEventSpeaker` and `AddSessionSpeaker` return a failed `Result` on an existing non-deleted link, so `.IsSuccess` doubles as the "did anything change" signal (`:338`, `:341`, `:511`).
  - **`SeedSponsorsAsync`** (`:347-404`): four sample sponsors spanning both events and all four [`SponsorTier`](group-17-conference-domain.md#sponsortier) values, two of them exhibitors with booth numbers (`:358-364`), each probed by name (`:373-376`) and built through `Sponsor.Create` (`:381-393`). The mapping these rows land in is [`SponsorConfiguration`](#sponsorconfiguration).
  - **`SeedActivitiesAsync`** (`:406-475`): three social-programme entries expressed as event-local wall-clock offsets rather than absolute timestamps, a pre-conference party the evening before (`DayOffset` of `-1`), a morning coffee, and an after-party (`:419-435`). Each is anchored on its own event's start date at `:452`, `activityEvent.StartDate.AddDays(dayOffset).ToDateTime(TimeOnly.MinValue)`, and the venue URL is only supplied when a venue name exists (`:462`).
  - **`GetSampleEventsAsync`** (`:477-494`): the one static helper. A single `GetAllAsync` fetches both events (again tolerating the pre-rename Cloud + AI name, `:485-486`) with `asTracking: true` so callers can mutate them, then splits the result by name (`:490-491`). Callers pass the `includes` they need, which is why the same helper serves both the no-include sponsor path and the `EventSpeakers`-include link path.
- **Why it's built this way**: this is the file that decides what a freshly provisioned Conference database contains, so it is written to be safe under three conditions that are easy to get wrong. Re-running (guarded by existence checks that see through soft delete), running against production (fixture data behind a default-false configuration key), and running against a database whose real content arrives from elsewhere (reserved id ranges that cannot collide with Sessionize ids). Doing the writes through domain factories and [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) rather than raw SQL or EF `HasData` also means seeding participates in the audit stamping, soft-delete defaults, and outbox dispatch that [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) applies to every save, which matters because per-service databases (ADR-006) each get their own seeding pass at their own host's startup.
- **Where it's used**: instantiated by [`ConferenceModuleSeeder`](group-20-conference-api-grpc.md#conferencemoduleseeder), the module's `IModuleSeeder` adapter, which resolves `IUnitOfWork` and `IConfiguration` from the scope and constructs it with the gate flag (`ConferenceModuleSeeder.cs:21-29`). That adapter is discovered by reflection in [`ModuleLoader`](group-14-module-system-composition.md#moduleloader) (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:92-93`) and invoked in registration order by `SeedAllAsync` (`ModuleLoader.cs:255-261`), which the host calls from [`DatabaseInitializationExtensions`](group-12-api-hosting-mapping.md#databaseinitializationextensions) after schema initialization (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:111`). Its output is what the public browse pages in [Group 21](group-21-conference-ui.md) render in dev and CI, and what the E2E feedback and share workflows target by the reserved session id.
- **Caveats / not-in-source**: (1) Failures are swallowed. A failed factory `Result` produces a bare `return` or `continue` (`:95-96`, `:130-131`, `:178-179`, `:219-220`, `:289-290`, `:395-396`, `:466-467`) with no logging: the class takes no logger, so a seed that silently does nothing leaves no trace beyond the missing rows. The `Publish()` calls at `:98` and `:133` likewise discard their `Result`. (2) The class is `public` and not `sealed`, unlike most types in this Infrastructure assembly. (3) Idempotency keys are names and titles, not database constraints: nothing stops a second row with the same event name, sponsor name, or session title from being created through the normal command paths, after which the seeder's probe would simply keep finding a match. (4) The comment at `:237-239` documents a real migration gap: databases seeded before the sessions were split across the two events keep the old shape and there is no fix-up path in this file, only the advice to reset the local container volume. (5) The sample-data insert order is not transactional across methods. Each method saves independently (`:227`, `:297`, `:323`, `:403`, `:474`), so a crash partway through leaves a partially seeded fixture, which the existence checks will then complete on the next boot. (6) `ConferenceModuleDbSeederTests` covers only the always-on path with `includeSampleData` left at its default (`ConferenceModuleDbSeederTests.cs:115`); the five sample-data methods have no unit-test coverage in that file and are exercised indirectly through E2E.

---

### ActivityConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Activities` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Activities/ActivityConfiguration.cs:11` · Level 9 · class

- **What it is**: the persistence map for [`Activity`](group-17-conference-domain.md#activity), a social or networking item attached to an event (a pre-conference party, a coffee connect, an after-party) that is deliberately not a session: no room, no speakers, and often an external venue carried on the row itself.
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`Activity`](group-17-conference-domain.md#activity), [`ActivityInvariants`](group-17-conference-domain.md#activityinvariants), [`Event`](group-17-conference-domain.md#event), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept introduced, indexing for the sort, not just for the filter.** The second index (`:63-64`) is `HasIndex(p => new { p.EventId, p.StartTime, p.SortOrder }).HasSoftDeleteFilter()`: non-unique, filtered, and composed in exactly the order the public agenda page consumes. The comment (`:61-62`) states the intent: the page filters by one event and orders by start time then sort order, so the composite serves the browse query directly instead of the database pulling the event slice and sorting it afterwards. This is the one place in the folder where an index's **column order is chosen for an ORDER BY** rather than for a lookup predicate, and it is worth reading alongside the narrower lookup index above it (`:58-59`, plain `EventId` with the same soft-delete filter). Contrast [`RoomConfiguration`](#roomconfiguration), whose paired indexes exist because the composite is filtered and the FK lookup wanted an unfiltered one; here both carry the filter, because every read of this table goes through the global query filter. `[Rubric §12, Performance and Scalability]` assesses whether index shape follows the queries that actually run.
- **Concept reinforced, event-local wall-clock time.** `StartTime` and `EndTime` are required plain date-times with no offset column (`:29-33`), and the comment (`:27-28`) is explicit that this mirrors `Session.StartsAt`/`EndsAt`: the IANA zone lives once on the owning [`Event`](group-17-conference-domain.md#event) (see [`EventConfiguration`](#eventconfiguration)) and is never repeated per row. The domain entity says the same thing at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Activities/Activity.cs:28-33`. Storing one zone for the whole programme is what keeps a schedule internally consistent when an activity is moved. `[Rubric §15, Best Practices & Code Quality]` assesses single-definition-point discipline, and this is the time-zone instance of it.
- **Walkthrough**
  - **Required** (`:19-21`, `:29-33`, `:47-51`): `Name` at `ActivityInvariants.NameMaxLength` (200, `ActivityInvariants.cs:13`), `StartTime`, `EndTime`, `SortOrder`, and the `EventId` scalar.
  - **Optional** (`:23-25`, `:35-45`): `Description` (`ActivityInvariants.DescriptionMaxLength`), `VenueName`, `VenueAddress` and `VenueUrl`, each `IsRequired(false)` with its own invariant-sourced max length. An absent `VenueName` is a meaningful value rather than missing data: the domain invariant says so (`ActivityInvariants.cs:38-40`), and the public page falls back to the event venue.
  - **Event relationship** (`:53-56`): required `HasOne(p => p.Event).WithMany().HasForeignKey(p => p.EventId)`, with the **parameterless** `WithMany()`, so `Event` exposes no activities collection. The same one-sided-navigation choice is made in [`SessionConfiguration`](#sessionconfiguration): activities are read by explicit event-scoped queries, not by walking the event aggregate.
  - **Indexes** (`:58-59`, `:63-64`): the filtered `EventId` lookup, then the filtered `(EventId, StartTime, SortOrder)` browse index described above. Neither is unique, so `SoftDeleteUniqueIndexConvention` would not have touched either one, which is why both spell out `HasSoftDeleteFilter()`.
- **Why it's built this way**: an activity is a first-class row rather than a flavour of session because it has a different shape (its own venue, no room, no speakers), and separating it keeps the session table free of columns that only apply to parties. `[Rubric §4, DDD]` assesses whether the model names distinct concepts distinctly instead of overloading one entity with a type discriminator.
- **Where it's used**: exposed as `DbSet<Activity> Activities` on [`ModuleApplicationDbContext`](#moduleapplicationdbcontext) (`ModuleApplicationDbContext.cs:70`); read by the public agenda queries and written by the organizer-facing activity commands.

---

### SponsorConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Sponsors` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Sponsors/SponsorConfiguration.cs:11` · Level 9 · class

- **What it is**: the EF Core persistence map for the [`Sponsor`](group-17-conference-domain.md#sponsor) aggregate: eleven column facets, an enum-to-int conversion for the sponsorship tier, the required relationship to the owning [`Event`](group-17-conference-domain.md#event), and one non-unique filtered lookup index. It is the newest member of the seventeen-class configuration family in this folder (seventeen `*Configuration.cs` files today).
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype) (base, `:12`), [`Sponsor`](group-17-conference-domain.md#sponsor), [`Event`](group-17-conference-domain.md#event), [`SponsorInvariants`](group-17-conference-domain.md#sponsorinvariants) (every `HasMaxLength` argument), [`SponsorTier`](group-17-conference-domain.md#sponsortier) (indirectly, through the `Tier` property it converts), and [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions) for `HasSoftDeleteFilter()` (`:68`, imported at `:3`). External: `Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<T>` (`:1`).
- **Concept**: the shared shape of this family, an `internal sealed` class over the SQL Server base whose `Configure` opens with `base.Configure(builder)` and therefore inherits table name, schema, key and value generation, is taught once under [`CategoryItemConfiguration`](#categoryitemconfiguration). That section also explains why the length constants come from an `...Invariants` class rather than from literals, and what `HasSoftDeleteFilter()` does. Only the two ideas below are new here.
- **Concept introduced, storing an enum as its underlying `int` on purpose.** `Tier` is a [`SponsorTier`](group-17-conference-domain.md#sponsortier), a four-member enum whose numeric values are deliberately the display order: `Platinum = 0`, `Gold = 1`, `Silver = 2`, `Community = 3` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Sponsors/SponsorTier.cs:15-24`, with the ordering rationale in the doc comment at `:4-6` and the CA1008 zero-member note at `:9-10`). The configuration spells the storage out, `builder.Property(p => p.Tier).HasConversion<int>().IsRequired()` (`:25-27`), and the comment above it (`:23-24`) gives both halves of the reason: the tier ordering stays a plain integer column sort, and adding a package later does not rewrite existing rows. The second half is the part worth internalizing. Appending a new member at the high end of the enum leaves every stored row valid, while re-numbering to slot a package into the middle would require a data migration. The shipped column is `Tier int NOT NULL` (`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Conference/Migrations/20260812202047_AddSponsors.cs:22`). This is the only `HasConversion<int>()` in the Conference configuration folder; the one other converter in the family, [`SpeakerConfiguration`](#speakerconfiguration)'s `NullableEmailValueConverter` (`SpeakerConfiguration.cs:43`), converts a value object, not an enum. `[Rubric §8, Data Architecture]` assesses whether column types are a deliberate choice rather than a convention default: writing the conversion at the call site pins the storage shape where a reader of the mapping will see it, instead of leaving it implied by provider convention two layers away.
- **Concept reinforced, a root that references another root by id.** `Sponsor` is an aggregate root in its own right (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sponsors/Sponsor.cs:18`, `sealed class Sponsor : AuditableAggregateRootEntity<SponsorIdentifierType>`), not a child of the `Event` aggregate. The mapping shows that boundary directly: the relationship is declared `HasOne(p => p.Event).WithMany().HasForeignKey(p => p.EventId).IsRequired()` (`:62-65`), and `WithMany()` takes **no** navigation expression because [`Event`](group-17-conference-domain.md#event) exposes no `Sponsors` collection at all (`Event.cs` mentions sponsorship only as the scalar `SponsorshipPacketUrl` at `:62`). So a sponsor knows its event, an event does not enumerate its sponsors, and nothing can load a sponsor set by walking the event aggregate: reads go through a filter on `EventId`. `[Rubric §4, DDD]` assesses whether aggregate boundaries are drawn and then respected in the persistence layer; a one-way navigation is how that boundary gets enforced by the mapping rather than left to discipline. Contrast [`SessionAiScoreConfiguration`](#sessionaiscoreconfiguration), which goes one step further and maps no relationship at all, and [`SessionSpeakerConfiguration`](#sessionspeakerconfiguration), whose `WithMany(p => p.SessionSpeakers)` names both ends because that row genuinely belongs to the session aggregate.
- **Walkthrough**
  - **Class declaration** (`:11-12`): `internal sealed class SponsorConfiguration : EntityTypeConfigurationSQLServer<Sponsor, SponsorIdentifierType>`, the second type argument being the module's identifier alias.
  - **`base.Configure(builder)`** (`:17`): table `Sponsor`, schema `Conference` (both derived, and both visible in the shipped migration at `20260812202047_AddSponsors.cs:15-16`), key on `Id`, identity value generation.
  - **Required scalars** (`:19-21`, `:49-53`, `:59-60`): `Name` at `SponsorInvariants.NameMaxLength` (200, `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sponsors/SponsorInvariants.cs:13`); `Sort` and `IsExhibitor` required with no configured default; `EventId` required.
  - **The tier conversion** (`:25-27`): described above.
  - **Optional presentation columns** (`:29-47`, `:55-57`): `LogoUrl`, `Description`, `WebsiteUrl` and `LinkedInUrl` each `IsRequired(false)` at 2000 characters (`SponsorInvariants.cs:16`, `:19`, `:22`, `:25`); `TwitterHandle` at 100 (`:28`); `BoothNumber` at 50 (`:31`). All seven widths read a constant, so this configuration contains no literal lengths.
  - **Event relationship** (`:62-65`): the one-way required `HasOne`/`WithMany()` pair described above. The shipped foreign key is `FK_Sponsor_Event_EventId` with `ReferentialAction.Cascade` (`20260812202047_AddSponsors.cs:42-48`).
  - **Lookup index** (`:67-68`): `builder.HasIndex(p => p.EventId).HasSoftDeleteFilter()`. It is **not** unique, so [`SoftDeleteUniqueIndexConvention`](group-07-persistence-ef-core.md#softdeleteuniqueindexconvention) would never have touched it and the explicit call is the only way the predicate gets applied; the migration confirms the shipped shape, `IX_Sponsor_EventId` with `filter: "[IsDeleted] = 0"` (`20260812202047_AddSponsors.cs:51-56`). It is aimed at exactly one query: the public sponsor strip fetches a page with `filters["EventId"] = ("equals", ...)` and `sortColumn: "Sort"` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Pages/Public/Sponsors/PublicSponsorList.razor.cs:65-75`), an equality predicate on `EventId` intersected with the global soft-delete filter, and the filtered index covers both halves. `[Rubric §12, Performance and Scalability]` assesses whether index shape follows the queries that actually run.
  - **What is absent from this file** and still ends up in the table: `IsDeleted`, `CreatedOn`/`CreatedBy`, `LastModifiedOn`/`LastModifiedBy` and the `rowversion` concurrency token are all in the shipped table (`20260812202047_AddSponsors.cs:32-37`) without appearing anywhere in `Configure`. They come from [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) and the entity base, which makes this the cleanest single illustration in the chapter of the division of labour taught under [`CategoryItemConfiguration`](#categoryitemconfiguration): a configuration class owns only *this entity's* columns, relationships and indexes.
- **Why it's built this way**: sponsors are per-event data with a public, ordered presentation, so the mapping optimizes for the two things the public page does, filter by event and sort within a tier, and for schema stability as sponsorship packages change. Keeping every width on `SponsorInvariants` means the column, the domain guard (`EnsureNameIsValid` at `SponsorInvariants.cs:39`, `EnsureLogoUrlIsValid` at `:51`, `EnsureBoothNumberIsValid` at `:63`) and the Application-layer request validators cannot drift apart, which is what `[Rubric §15, Best Practices & Code Quality]` looks for. Confining all of it to one Infrastructure class keeps the `Sponsor` entity free of EF attributes, the Clean Architecture dependency rule this whole folder exists to serve.
- **Where it's used**: applied when the concrete [`SQLServerDbContext`](group-07-persistence-ef-core.md#sqlserverdbcontext) for the `ADC_Conference` database builds its model by scanning the module assembly, exactly like its sixteen siblings; snapshotted by the Conference migrations project (`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Conference`, table created by `20260812202047_AddSponsors.cs`). Rows are written by [`ConferenceModuleDbSeeder`](#conferencemoduledbseeder)'s sample-data path and by the sponsor command handlers, and read by [`SponsorService`](group-21-conference-ui.md#sponsorservice) for [`PublicSponsorList`](group-21-conference-ui.md#publicsponsorlist). [`ModuleApplicationDbContext`](#moduleapplicationdbcontext) does declare a `Sponsors` `DbSet`, but as that section explains, the `DbSet` list is an index, not the source of the model.
- **Caveats / not-in-source**: (1) There is **no unique index on `(EventId, Name)`**, or on `Name` at all. The seeder's idempotency check probes `s => s.Name == name` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:364-366`), so uniqueness of sponsor names is an application-level convention with no database backstop, unlike the room-name and session-speaker cases elsewhere in this folder. (2) The `Tier` column carries no check constraint, so a value outside `0..3` would be storable by anything that bypasses the domain factory; the enum is enforced in the CLR type, not in SQL. (3) `BoothNumber` is nullable and independent of `IsExhibitor`: the domain deliberately accepts a booth number on a non-exhibitor (`SponsorInvariants.cs:57-58`, "the flag drives display, it does not reject stored data"), and the mapping adds no constraint tying the two together. (4) The `Cascade` delete on the event foreign key is not overridden here; because the codebase soft-deletes rather than hard-deletes, whether that cascade ever executes in a deployed database is not determinable from source. (5) The grouping by tier that the public page renders happens **in memory** after the fetch (`PublicSponsorList.razor.cs:82-86`), not as a SQL `ORDER BY Tier`, so the int conversion enables a cheap column sort that today's read path does not yet ask the database to perform.

---

### ModuleApplicationDbContext

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:20` · Level 12 · abstract class

- **What it is**: an abstract `DbContext` that names the Conference module's entity sets. It declares fifteen `internal DbSet<T>` properties and forwards its four constructor arguments unchanged to the framework base; it adds no `OnModelCreating`, no `OnConfiguring`, and no behavior of any kind.
- **Depends on**: first-party: [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) (base, `:25`), [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider) (`:23`), [`PhysicalDataSource`](group-07-persistence-ef-core.md#physicaldatasource) (`:24`), and the fifteen Conference entity types it exposes, all from [Group 17](group-17-conference-domain.md): [`Event`](group-17-conference-domain.md#event), [`Room`](group-17-conference-domain.md#room), [`EventSpeaker`](group-17-conference-domain.md#eventspeaker), [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer), [`Session`](group-17-conference-domain.md#session), [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker), [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer), [`SessionCategoryItem`](group-17-conference-domain.md#sessioncategoryitem), [`Speaker`](group-17-conference-domain.md#speaker), [`SpeakerCategoryItem`](group-17-conference-domain.md#speakercategoryitem), [`Category`](group-17-conference-domain.md#category), [`CategoryItem`](group-17-conference-domain.md#categoryitem), [`Question`](group-17-conference-domain.md#question), [`Sponsor`](group-17-conference-domain.md#sponsor), [`Activity`](group-17-conference-domain.md#activity). External: `Microsoft.EntityFrameworkCore.DbContextOptions` and `DbSet<T>` (`:1`).
- **Concept introduced, a `DbSet` list is an index, not the model.** The instinct carried over from a typical EF application is that `DbSet<T>` properties define what the context maps. In this codebase they do not. The model is built by [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext), which walks the assemblies handed to it by [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider) and applies every configuration implementing the engine's interface, filtered to the entities routed to *this* physical data source (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:690-716`). The proof is in the arithmetic: the Conference `EntityConfiguration` folder holds seventeen `*Configuration.cs` files, two more than the fifteen `DbSet`s here. `SessionAiScore` and `SpeakerQuestionAnswer` are mapped, migrated, and queried without ever appearing on this class. Reading the `DbSet` list as a coverage manifest would therefore mislead you; read the configuration folder instead. `[Rubric §8, Data Architecture]` assesses whether the mapping strategy is explicit and centrally governed; convention-by-assembly-scan is what lets one context class serve every module without any module editing it.
- **Concept introduced, `internal` sets as a layering boundary.** All fifteen properties are `internal` (`:28-70`), not `public`. Nothing outside `MMCA.ADC.Conference.Infrastructure` can reach `context.Sessions` even with a context instance in hand. Application-layer handlers get their data through [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and `IRepository<TEntity, TIdentifierType>` instead, which is where soft-delete filtering, tracking choices, and data-source routing are decided. `[Rubric §3, Clean Architecture]` assesses whether the dependency rule is enforced by the compiler rather than by convention; an access modifier is the cheapest available enforcement, and it is why a handler cannot accidentally grow a raw LINQ query against a `DbSet`.
- **Walkthrough**
  - **Class declaration and primary constructor** (`:20-25`): `public abstract class ModuleApplicationDbContext(DbContextOptions options, IServiceProvider serviceProvider, IEntityConfigurationAssemblyProvider assemblyProvider, PhysicalDataSource physicalDataSource) : ApplicationDbContext(options, serviceProvider, assemblyProvider, physicalDataSource)`. Every parameter is passed straight through; the class captures none of them and overrides nothing. Note the untyped `DbContextOptions` rather than `DbContextOptions<TContext>`, which is what allows an arbitrary concrete subclass to supply its own typed options.
  - **The fifteen entity sets** (`:28-70`): `Events` (`:28`), `Rooms` (`:31`), `EventSpeakers` (`:34`), `EventQuestionAnswers` (`:37`), `Sessions` (`:40`), `SessionSpeakers` (`:43`), `SessionQuestionAnswers` (`:46`), `SessionCategoryItems` (`:49`), `Speakers` (`:52`), `SpeakerCategoryItems` (`:55`), `Categories` (`:58`), `CategoryItems` (`:61`), `Questions` (`:64`), `Sponsors` (`:67`), `Activities` (`:70`). Read top to bottom they trace the module's aggregate map: the two roots that own schedules (`Event`, `Session`), their join tables to speakers and categories, the taxonomy pair (`Category` and `CategoryItem`), the feedback pair (`Question` plus the two answer tables), and the two newest per-event additions (`Sponsor`, `Activity`).
  - **What is deliberately absent**: no `OnModelCreating` override, so nothing here competes with the base's assembly scan; no `OnConfiguring`, so provider selection stays with the concrete engine context; no `SaveChanges` override, so audit stamping, soft delete, and outbox dispatch remain the base's job.
- **Why it's built this way**: ADR-006 fixes one sealed context class per engine, shared across modules, rather than one context class per module, and the runtime honors that literally. The concrete context is Common's `sealed class SQLServerDbContext`, which derives from [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) directly (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:15-20`), and the Conference migrations project targets that same type through `IDesignTimeDbContextFactory<SQLServerDbContext>` (`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Conference/DesignTimeSQLServerDbContextFactory.cs:12-15`). Keeping the module-level class abstract, behavior-free, and additive means the per-engine story stated in ADR-018 (SQL Server today, Cosmos and SQLite as further engines) needs no per-module change: a new engine adds one sealed class in MMCA.Common, not fifteen `DbSet` declarations per module. `[Rubric §7, Microservices Readiness]` assesses whether a module could be lifted into its own host without a rewrite; the entity-set surface being module-scoped and `internal` is part of what makes that lift mechanical.
- **Where it's used**: the fifteen sets correspond one to one with fifteen of the seventeen configurations in this chapter, including [`EventConfiguration`](#eventconfiguration), [`SessionConfiguration`](#sessionconfiguration), [`SponsorConfiguration`](#sponsorconfiguration) and [`ActivityConfiguration`](#activityconfiguration), and with the tables the Conference migrations project maintains for the `ADC_Conference` database. Application-layer access to those tables runs through [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), and the rows themselves are first written by [`ConferenceModuleDbSeeder`](#conferencemoduledbseeder).
- **Caveats / not-in-source**: (1) **Nothing derives from this class.** A repository-wide search of MMCA.ADC for the identifier `ModuleApplicationDbContext` returns exactly three hits, the three sibling declarations in the Conference, Engagement, and Identity Infrastructure projects, and no subclass, no DI registration, and no consumer. The class compiles and is packaged, but it is not on the runtime path today: `SQLServerDbContext` bypasses it. Treat this section as documentation of the module's entity surface and of an extension point that is currently unexercised, not of a type in the request path. (2) Consequently the `internal` visibility of the sets protects a surface nothing currently reaches; the layering point it makes is real but presently theoretical for this class. (3) `SessionAiScore` and `SpeakerQuestionAnswer` have configurations in `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/` but no `DbSet` here; whether that is deliberate or an oversight is not determinable from source, since no code reads the `DbSet` list. (4) The three sibling `ModuleApplicationDbContext` classes share a name across three namespaces (Conference at `:20`, Engagement at `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:19`, Identity at `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:15`); each has its own section in its own chapter, so check the namespace before assuming which one a search result refers to.

---


---
[⬅ ADC Conference - Application & Use Cases](group-18-conference-application.md)  •  [Index](00-index.md)  •  [ADC Conference - API, gRPC Contracts & Service Host ➡](group-20-conference-api-grpc.md)
