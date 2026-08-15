# 19. ADC Conference - Infrastructure & Persistence

**What this chapter covers.** This is the **adapter** layer of the Conference module, the place where
the engine-agnostic domain meets concrete technology. Three concerns live here: (1) **persistence
mapping**, the 16 EF Core entity configurations that turn plain domain classes into SQL Server tables,
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
[`Event`](group-17-conference-domain.md#event), [`Sponsor`](group-17-conference-domain.md#sponsor), the
join entities, is a plain class. The *only* thing that binds it to SQL Server is which base class its
configuration inherits from. All 16 configs in this group
([`SessionConfiguration`](#sessionconfiguration), [`SpeakerConfiguration`](#speakerconfiguration),
[`EventConfiguration`](#eventconfiguration), [`SponsorConfiguration`](#sponsorconfiguration), and the
rest) derive from
[`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype)
(for example `MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionConfiguration.cs:12-13`),
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
`SessionConfiguration.cs:18`) and *then* adds its own mappings. That one `base` call is where the
framework injects the conventions applied uniformly: the strongly-typed key, the table name and module
schema, and the concurrency token, none of which any individual config re-states. The per-entity bodies
then declare what is unique: column lengths sourced from the domain's invariant constants
(`SessionInvariants.TitleMaxLength` at `SessionConfiguration.cs:20-22`, `EventInvariants.NameMaxLength`
at `EventConfiguration.cs:19-21`, `SponsorInvariants.NameMaxLength` at `SponsorConfiguration.cs:19-21`),
required and optional flags, computed properties excluded with `builder.Ignore(...)` (`Session.Duration`
at `SessionConfiguration.cs:67`, `Speaker.FullName` at `SpeakerConfiguration.cs:68`), value conversions
(`Speaker.Email` round-trips through
[`NullableEmailValueConverter`](group-07-persistence-ef-core.md#nullableemailvalueconverter) at
`SpeakerConfiguration.cs:42-45`, and `Sponsor.Tier` is stored as its underlying `int` with
`HasConversion<int>()` so tier ordering is a plain column sort and adding a package later does not
rewrite existing rows, `SponsorConfiguration.cs:23-27`), and decimal precision (`HasPrecision(3, 1)` on
all seven AI sub-scores, `SessionAiScoreConfiguration.cs:22-48`, next to a 4000-character `Reasoning`
and a 100-character `ModelUsed`, `SessionAiScoreConfiguration.cs:50-56`).

**Filtered indexes** are where the soft-delete convention becomes visible, and the split is worth
learning because it is easy to misread. Unique indexes on a soft-deletable entity get the
`IsDeleted = 0` predicate **automatically**, applied by
[`SoftDeleteUniqueIndexConvention`](group-07-persistence-ef-core.md#softdeleteuniqueindexconvention)
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/SoftDeleteUniqueIndexConvention.cs:43-51`),
so a soft-deleted link never blocks a re-insert;
[`CategoryItemConfiguration`](#categoryitemconfiguration) relies on exactly that and declares its unique
(CategoryId, Name) index with no filter call at all (`CategoryItemConfiguration.cs:30-31`). A
hand-authored **non-unique** index is deliberately left alone by the convention and opts in explicitly
through
[`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions)`.HasSoftDeleteFilter()`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/IndexBuilderExtensions.cs:19-30`),
which replaces the old literal `HasFilter("[IsDeleted] = 0")` by reading the column name from the model
and the quoting from the engine. Three lookup indexes here take that opt-in: `Session.EventId`
(`SessionConfiguration.cs:77-78`), `Sponsor.EventId` (`SponsorConfiguration.cs:67-68`), and
`EventQuestionAnswer.EventId` (`EventQuestionAnswerConfiguration.cs:35-36`). Several unique indexes also
call it explicitly for readability even though the convention would supply it:
[`SessionSpeakerConfiguration`](#sessionspeakerconfiguration)'s (SessionId, SpeakerId) pair
(`SessionSpeakerConfiguration.cs:30-32`), the one-score-per-session index on
[`SessionAiScoreConfiguration`](#sessionaiscoreconfiguration) (`SessionAiScoreConfiguration.cs:59-61`),
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
(`EventQuestionAnswerConfiguration.cs:42-44`). Two configs declare no index at all and map columns only,
[`QuestionConfiguration`](#questionconfiguration) (`QuestionConfiguration.cs:10`) and
[`SpeakerQuestionAnswerConfiguration`](#speakerquestionanswerconfiguration)
(`SpeakerQuestionAnswerConfiguration.cs:10`). **Sparse** filters are a different thing again and stay
literal, because they filter on a nullable business column rather than on soft-delete:
`Speaker.LinkedUserId` is unique only where it is set (`SpeakerConfiguration.cs:63-65`, the
User-to-Speaker link), and `Event.SessionizeCode` is indexed only where present
(`EventConfiguration.cs:41-42`). Two further quirks are worth knowing:
[`ConferenceCategoryConfiguration`](#conferencecategoryconfiguration) calls
`ToTable("Category", "Conference")` explicitly (`ConferenceCategoryConfiguration.cs:24`) so the
Conference `Category` table cannot collide with another module's `Category`, and
[`SessionConfiguration`](#sessionconfiguration) maps the Session-to-Room relationship with
`OnDelete(DeleteBehavior.Restrict)` (`SessionConfiguration.cs:83-87`) so deleting a room can never
cascade sessions away.

## DbSets, the context shape, and how the configurations are actually found

[`ModuleApplicationDbContext`](#moduleapplicationdbcontext)
(`MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:19`) is the
Conference module's abstract `DbContext`. It does one job: declare 14 `internal DbSet<T>` properties
(`Events`, `Rooms`, `EventSpeakers`, `EventQuestionAnswers`, `Sessions`, `SessionSpeakers`,
`SessionQuestionAnswers`, `SessionCategoryItems`, `Speakers`, `SpeakerCategoryItems`, `Categories`,
`CategoryItems`, `Questions`, `Sponsors`, at `ModuleApplicationDbContext.cs:27-66`). It is **abstract**
and inherits from the Common
[`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) through its primary
constructor (`ModuleApplicationDbContext.cs:19-24`), from which it gets the real machinery: the
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
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:610-636`,
with the engine-to-interface switch at `:612-618` and the registry filter at `:625-635`). That is why two
entities with a configuration here, [`SessionAiScore`](group-17-conference-domain.md#sessionaiscore) and
[`SpeakerQuestionAnswer`](group-17-conference-domain.md#speakerquestionanswer), are mapped and queryable
through the repository layer even though `ModuleApplicationDbContext` declares no `DbSet` for either:
16 configurations, 14 `DbSet`s, and the configurations win. `[Rubric §7, Microservices Readiness]` (can a
module become its own service without a rewrite?) is embodied here: the Conference module already runs as
`MMCA.ADC.Conference.Service` over its own `ADC_Conference` database with its own `dbo.OutboxMessages`,
and cross-module references (a speaker's linked user, a bookmark's session) are scalar columns resolved
via gRPC and integration events, never cross-database foreign keys.

## Seeding: two real events always, sample data only in dev and CI

[`ConferenceModuleDbSeeder`](#conferencemoduledbseeder)
(`MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:24`)
derives from the framework's [`DbSeeder`](group-07-persistence-ef-core.md#dbseeder) and runs after schema
initialization, constructed by [`ConferenceModuleSeeder`](group-20-conference-api-grpc.md#conferencemoduleseeder)
in the API layer (`MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:28`). It is idempotent: every step
first issues an `ExistsAsync` check through the repository and returns early if the row is present
(`ConferenceModuleDbSeeder.cs:64-69`, `:98-103`, `:132-137`), which is what makes it safe to run on every
startup under the production `Migrate` init strategy
([ADR-030](https://ivanball.github.io/docs/adr/030-startup-sole-migrator.html)). It **always** seeds three
things (`ConferenceModuleDbSeeder.cs:46-48`): the **2026 Atlanta Cloud + AI Conference** (2026-05-30,
`America/New_York`, Sessionize code `z1ecmzux`, `ConferenceModuleDbSeeder.cs:71-83`), the **2026 Atlanta
Developers Conference** (2026-10-17, Sessionize code `sf1nopko`, `ConferenceModuleDbSeeder.cs:105-117`),
both published immediately after creation (`:88` and `:122`) and both carrying the shared venue address,
map URL and their own published sponsorship-packet URL (`ConferenceModuleDbSeeder.cs:26-38`), and the
fixed set of **10 feedback questions** (5 session ratings plus a session comment, 3 conference ratings
plus a conference comment, `ConferenceModuleDbSeeder.cs:139-151`) whose ids start at
[`QuestionInvariants`](group-17-conference-domain.md#questioninvariants)`.ManualIdRangeStart`
(`ConferenceModuleDbSeeder.cs:153`) so they never collide with imported data.

It **conditionally** seeds four more things (`ConferenceModuleDbSeeder.cs:50-56`): two sample speakers
(Ada Lovelace and Alan Turing, `:179-183`), two sample sessions with app-assigned ids from
[`SessionInvariants`](group-17-conference-domain.md#sessioninvariants)`.ManualIdRangeStart`, one per
seeded event (`:236-240`, and the ids are explicit because a Session's int PK *is* its Sessionize id, so
the sample rows take a reserved range above any real one, `:232-235`), the EventSpeaker plus
SessionSpeaker links between them (`:305-306`), and four sample sponsors across the Platinum, Gold, Silver
and Community tiers, two of them exhibitors with booth numbers (`:344-350`). All of that runs only when
`includeSampleData` is set. The flag comes from `Seeding:IncludeSampleConferenceData`
(`MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:26`), which the local Aspire AppHost sets
(`MMCA.ADC.AppHost/Program.cs:162`) and production leaves unset. The reason is documented in the seeder's
own remarks (`ConferenceModuleDbSeeder.cs:16-23`): the public-browse E2E tests need at least one session
and one speaker row to exist deterministically, while production's real sessions and speakers arrive
through the Sessionize import. The links are created on *both* paths deliberately, so the direct
(EventSpeaker) and the transitive (SessionSpeaker) branches of the speakers-by-event filter are both
exercised in dev and CI (`ConferenceModuleDbSeeder.cs:302-304`).

## The Sessionize adapter

[`SessionizeService`](#sessionizeservice)
(`MMCA.ADC.Conference.Infrastructure/Services/SessionizeService.cs:10`) is a deliberately thin HTTP
client: the whole class is one method. Given a Sessionize event code it builds the relative URI
`{code}/view/All` (`SessionizeService.cs:15`), calls `GetAsync`, asserts success with
`EnsureSuccessStatusCode` (`SessionizeService.cs:20`), and deserializes into the
[`SessionizeResponse`](group-18-conference-application.md#sessionizeresponse) model owned by the
Application layer (`SessionizeService.cs:22-24`). Unlike the AI adapter it **does** throw on a bad
status, because the import use-case that calls it is a foreground operation with a caller waiting on the
result. It is registered as a typed `HttpClient` in [`DependencyInjection`](#dependencyinjection) with
the base address `https://sessionize.com/api/v2/` baked in
(`MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:21-23`), so it inherits the standard Aspire
resilience handler (Polly retry, timeout, circuit breaker) unchanged: `[Rubric §29, Resilience &
Business Continuity]`, the [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)
policy that every outbound client gets resilience by default. The thinness is intentional: parsing,
mapping, and the import workflow live in Application use-cases, and this adapter owns only the wire call.

## The Anthropic AI scoring adapter

[`AnthropicScoringService`](#anthropicscoringservice)
(`MMCA.ADC.Conference.Infrastructure/Services/AnthropicScoringService.cs:16`) is the richer of the two
adapters: it scores one session proposal against a Program Committee rubric using the **Anthropic Claude
Messages API**. It implements [`IAiScoringService`](group-18-conference-application.md#iaiscoringservice),
exposes the model id it uses (`claude-haiku-4-5-20251001`, `AnthropicScoringService.cs:22`), reads the
API key from configuration (`Anthropic:ApiKey`, expected in user secrets,
`AnthropicScoringService.cs:29-34`), POSTs to the relative `v1/messages` endpoint with an `x-api-key`
header (`AnthropicScoringService.cs:47-49`), and caps the response at 256 tokens
(`AnthropicScoringService.cs:43`). Its contract is precise about failure: it **never throws for a scoring
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
[`AnthropicContentBlock`](#anthropiccontentblock) list (`AnthropicScoringService.cs:227`), and
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
hard-coded) and `[Rubric §13, Observability & Operability]` in the `[LoggerMessage]` source-generated
warning that records every scoring failure with the session id and reason
(`AnthropicScoringService.cs:196-197`).

## Scoring runs on a hosted drain, guarded across replicas

[`SessionScoringProcessor`](#sessionscoringprocessor)
(`MMCA.ADC.Conference.Infrastructure/Services/SessionScoringProcessor.cs:49`) is the piece that makes a
multi-minute paid AI pass safe to trigger from an HTTP POST. It is a `BackgroundService` that consumes
[`SessionScoringQueue`](group-18-conference-application.md#sessionscoringqueue) with
`ReadAllAsync(stoppingToken)` (`SessionScoringProcessor.cs:107`), so the host owns the work: shutdown
cancels it and waits for it to unwind instead of a deploy or a scale-in tearing down a half-finished run.
This is the concrete adoption of
[ADR-052](https://ivanball.github.io/docs/adr/052-background-job-execution.html) (bounded queue plus
single-reader hosted drain), and it replaced an untracked fire-and-forget task the controller used to
start.

The queue's dedup lives in one process's memory, and Conference runs at `maxReplicas: 2`
(the `conferenceApp` container app at `MMCA.ADC/infra/main.bicep:1219`, scale rule at
`MMCA.ADC/infra/main.bicep:1335`), so the queue alone never stopped two organizer triggers landing on
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
killed replica's key stuck at 1 and locked the event out until an operator cleared it by hand. Note the
doc drift here: ADR-052 still describes dedup as per-replica and the distributed lock as a future step
(`Website/docs-src/adr/052-background-job-execution.md:85-87`), but the lock is in the code today.

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
registering that meter name (`MMCA.ADC.Conference.Service/Program.cs:134`): that is
`[Rubric §13, Observability & Operability]` closing the loop on work that no user is waiting for.

The output cache is evicted **twice** per run, once up front so polling clients stop seeing stale scores
and once after a successful pass (`SessionScoringProcessor.cs:158` and `:208`), and it evicts the narrow
`conference:sessions` tag rather than the root `conference` tag. The comment above that constant records
why in production terms (`:61-66`): evicting the root flushed events, speakers, rooms, categories, and
questions too, so an organizer triggering a scoring run during the event emptied the whole public read
surface onto the Basic-tier database while attendees were browsing. `[Rubric §12, Performance &
Scalability]` and `[Rubric §31, Cost/FinOps]` both live in that one constant
([ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html),
[ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)).

## DI wiring and a deliberate resilience override

[`DependencyInjection`](#dependencyinjection)
(`MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:11`) is a single
`extension(IServiceCollection)` block (the codebase's standard DI-registration idiom, taught in the
primer) exposing `AddModuleConferenceInfrastructure()` (`DependencyInjection.cs:13-19`). It registers
both adapters as typed HTTP clients and the drain as a hosted service (`DependencyInjection.cs:45`). The
Anthropic client gets a **custom resilience policy**: a 5-minute `HttpClient.Timeout` and the
`anthropic-version: 2023-06-01` header (`DependencyInjection.cs:30-32`), then
`RemoveAllResilienceHandlers()` followed by a re-added `StandardResilienceHandler` with a 3-minute attempt
timeout, a 7-minute circuit-breaker sampling window, a 5-minute total request timeout, and only **one**
retry (`DependencyInjection.cs:34-41`). The inline comment explains why (`DependencyInjection.cs:25-26`):
AI scoring of a large batch can take minutes, which would blow through Aspire's default 30s attempt and
90s total limits, and retrying an expensive LLM call aggressively is wasteful. This is a precise
illustration of [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html):
every outbound client is resilient by default, but a client with genuinely different latency
characteristics tunes the policy rather than disabling it. The Sessionize client takes the defaults
unchanged.

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
(`MMCA.ADC.Conference.API/Controllers/SessionSelectionController.cs:110-128`),
[`SessionScoringProcessor`](#sessionscoringprocessor) picks the event up, evicts the sessions cache tag,
claims the event's distributed lock, runs the scoped command handler which calls
[`AnthropicScoringService`](#anthropicscoringservice) once per session under the tuned resilience policy,
persists one `SessionAiScore` row per session behind the unique filtered index, and evicts the tag again.
The two marker types in this assembly, [`AssemblyReference`](#assemblyreference) and
[`ClassReference`](#classreference) (`MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:5` and
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

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Services` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Services/SessionScoringProcessor.cs:40` · Level 3 · class (sealed partial)

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

### CategoryItemConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/CategoryItemConfiguration.cs:10` · Level 8 · class

- **What it is**: the EF Core persistence map for the [`CategoryItem`](group-17-conference-domain.md#categoryitem) entity: column facets, the parent relationship to [`Category`](group-17-conference-domain.md#category), and a composite unique index. It is the smallest complete member of the sixteen-class configuration family in this folder, so it is the one this chapter uses to teach the shared shape.
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype) (base, `:11`), [`CategoryItem`](group-17-conference-domain.md#categoryitem), [`Category`](group-17-conference-domain.md#category), [`CategoryInvariants`](group-17-conference-domain.md#categoryinvariants) (`:19`). External: `Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<T>`.
- **Concept introduced, the per-entity configuration class and what the base already did.** Every configuration in this folder is an `internal sealed class` deriving from `EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>` and overriding one method, `Configure(EntityTypeBuilder<TEntity> builder)`, whose first statement is always `base.Configure(builder)` (`:16`). Knowing exactly what that base call does is what stops you re-declaring things by hand:
  - `EntityTypeConfigurationSQLServer` is a **shim with no body** (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationSQLServer.cs:17`). Its whole contribution is the `[UseDataSource(DataSource.SQLServer)]` attribute it carries (`:16`), an instance of [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute).
  - The real work is in [`EntityTypeConfiguration<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationtentity-tidentifiertype). Its `Configure` reads the attribute off `GetType()` and throws if it is missing (`EntityTypeConfiguration.cs:43-46`), then calls `ApplyEngineConventions` (`:48`). For `DataSource.SQLServer` that means `ToTable(typeof(TEntity).Name, NamespaceConventions.GetModuleName(typeof(TEntity)) ?? "dbo")`, so table name comes from the CLR type and **schema comes from the module segment of the entity's namespace** (`:66`), then `HasKey(p => p.Id)` (`:67`) and either `ValueGeneratedOnAdd()` or `ValueGeneratedNever()` depending on `IsIdValueGenerated` (`:68-71`).
  - Below that, [`EntityTypeConfigurationBase<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationbasetentity-tidentifiertype) does exactly one thing: `builder.Ignore(nameof(AuditableAggregateRootEntity<>.DomainEvents))` for aggregate roots (`EntityTypeConfigurationBase.cs:29-32`), keeping the in-memory event list out of the schema.
  - What the base chain does **not** do is equally important. The soft-delete global query filter, the `rowversion` concurrency token and the soft-delete index convention are installed by the context, not by these classes: [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) adds the query filter at `ApplicationDbContext.cs:348`, marks the concurrency property at `:469` and `:473`, and registers [`SoftDeleteUniqueIndexConvention`](group-07-persistence-ef-core.md#softdeleteuniqueindexconvention) at `:296`. So a configuration class in this folder is only ever about *this entity's* columns, relationships and indexes.

  Because the engine is pinned entirely by the base type, re-pointing a Conference entity at SQLite or Cosmos is a base-class swap with no edit to the body of `Configure`: the domain entity, the handlers and everything above stay untouched. All sixteen Conference configurations use the SQL Server base, since ADC runs SQL Server only.

  `[Rubric §8, Data Architecture]` assesses whether persistence is designed deliberately (typed lengths, correct nullability, FK relationships, purposeful indexes) rather than left to convention defaults: this family is where all of that lives for the Conference database. `[Rubric §3, Clean Architecture]` assesses dependency direction: EF mapping is confined to Infrastructure, and the domain entities carry zero EF attributes, so the domain layer stays framework-free.
- **Concept introduced, length constants sourced from the domain invariants.** Nearly every `HasMaxLength` call in this folder reads a constant from the entity's `…Invariants` class instead of a literal. Here it is `CategoryInvariants.CategoryItemNameMaxLength` (`:19`). The same constant is what the Application layer's FluentValidation rules use, so the column width and the request validator are a **single source of truth**: change the constant once and both move. `[Rubric §16, Maintainability]` assesses exactly this kind of single-definition-point discipline.
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

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/ConferenceCategoryConfiguration.cs:13` · Level 8 · class

- **What it is**: the persistence map for the [`Category`](group-17-conference-domain.md#category) aggregate, the parent of [`CategoryItem`](group-17-conference-domain.md#categoryitem). It is the only configuration in the folder whose class name does not match `{Entity}Configuration`.
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`Category`](group-17-conference-domain.md#category), [`CategoryInvariants`](group-17-conference-domain.md#categoryinvariants). External: `Microsoft.EntityFrameworkCore` (for `ToTable`).
- **Concept**: the shared shape is taught under [`CategoryItemConfiguration`](#categoryitemconfiguration); the only new idea here is the deliberate name/table split.
- **Walkthrough**
  - **Class name** (`:13-14`): the type is `ConferenceCategoryConfiguration`, not `CategoryConfiguration`. The XML doc (`:8-12`) gives the reason: the ADC codebase carries more than one `Category` concept, and a distinct configuration class name avoids ambiguity for a reader scanning the folder.
  - **Explicit table mapping** (`:24`): `builder.ToTable("Category", "Conference")`. The comment (`:21-23`) is honest that this is **redundant**, the base would already derive `Category` from `typeof(Category).Name` and `Conference` from the namespace; it is written out for clarity given the class-name mismatch above.
  - **Columns** (`:26-35`): `Title` required at `CategoryInvariants.TitleMaxLength`; `Sort` required; `Type` optional with a literal `HasMaxLength(100)`, one of the few places in the family that does not read a constant.
- **Why it's built this way**: naming the configuration for the bounded context rather than for the CLR type is a small readability trade: the class is findable by module, and the explicit `ToTable` keeps the physical target visible at the call site rather than implied by a base-class convention two files away.
- **Where it's used**: same discovery path as the rest of the family (see [`CategoryItemConfiguration`](#categoryitemconfiguration)).
- **Caveats / not-in-source**: the doc comment cites a Catalog-module `Category` as the collision being avoided. Catalog is a **MMCA.Store** module, not an ADC one, so within this repo nothing would actually collide; treat the comment as historical rationale carried over from the shared framework vocabulary.

---

### EventConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/EventConfiguration.cs:11` · Level 8 · class

- **What it is**: the persistence map for [`Event`](group-17-conference-domain.md#event), the top aggregate of the Conference module (the conference itself: dates, venue, publication state, Sessionize linkage).
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`Event`](group-17-conference-domain.md#event), [`EventInvariants`](group-17-conference-domain.md#eventinvariants), [`QuestionModerationDefault`](group-17-conference-domain.md#questionmoderationdefault). External: `Microsoft.EntityFrameworkCore`.
- **Concept reinforced, the filtered non-unique index.** `HasIndex(p => p.SessionizeCode).HasFilter("[SessionizeCode] IS NOT NULL")` (`:41-42`) is filtered but **not** unique. A filtered index only covers the rows matching its predicate, so this one indexes just the events that carry a Sessionize code, which is the population the import path looks up by. It deliberately does not forbid two events sharing a code, and it costs nothing for the (many) events with a null code. `[Rubric §12, Performance and Scalability]` assesses whether indexes are chosen for the actual query shape rather than sprayed across columns: this is a narrow index sized to one lookup.
- **Walkthrough**
  - **Required core** (`:19-35`): `Name` (`EventInvariants.NameMaxLength`), `StartDate`, `EndDate`, and `TimeZone` (`EventInvariants.TimeZoneMaxLength`). Storing the IANA time-zone id as a column rather than baking a UTC offset into the dates is what lets the schedule render correctly across DST.
  - **Optional descriptive and venue columns** (`:23-25`, `:44-62`): `Description`, `VenueAddress`, `VenueMapUrl`, `WiFiInfo`, `OrganizerContactEmail`, `SponsorshipPacketUrl`, each `IsRequired(false)` with its own invariant-sourced max length.
  - **Sessionize linkage** (`:37-42`, `:71-75`): `SessionizeCode` optional plus the filtered index above; `LastSessionizeRefreshOn` / `LastSessionizeRefreshBy` are optional audit-style columns recording the last import run. `[Rubric §13, Observability and Operability]` assesses whether the system records the provenance of imported data: these two columns answer "when was this event last synced, and by whom" from the row itself.
  - **State flags** (`:64-69`): `IsPublished` required; `QuestionModerationDefault` required, with the comment (`:67`) noting it is stored as an `int` through EF's default enum conversion and that `Pending` (0) is the safe default per BR-233. There is no `HasConversion` call, EF's default enum-to-int mapping is used as-is, so the safe default is also the zero value in the database.
- **Why it's built this way**: everything the organizer may not know at creation time is nullable, so an event can be created early and enriched later without a two-phase workflow; only the four facts that make an event an event are required.
- **Where it's used**: `Event` is the FK target of [`RoomConfiguration`](#roomconfiguration), [`SessionConfiguration`](#sessionconfiguration), [`EventSpeakerConfiguration`](#eventspeakerconfiguration), [`EventQuestionAnswerConfiguration`](#eventquestionanswerconfiguration) and [`SponsorConfiguration`](#sponsorconfiguration).

---

### EventQuestionAnswerConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/EventQuestionAnswerConfiguration.cs:11` · Level 8 · class

- **What it is**: the persistence map for [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer), one attendee's answer to one event-scoped [`Question`](group-17-conference-domain.md#question).
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer), [`Event`](group-17-conference-domain.md#event), [`EventInvariants`](group-17-conference-domain.md#eventinvariants), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions) (`HasSoftDeleteFilter`). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept introduced, `HasSoftDeleteFilter()` and the database as the concurrency backstop.**
  - `HasSoftDeleteFilter()` (`IndexBuilderExtensions.cs:50-64`) replaces a hand-typed `HasFilter("[IsDeleted] = 0")`. It builds the predicate through [`SoftDeleteFilterSql`](group-07-persistence-ef-core.md#softdeletefiltersql) from the live model (`:56`), so a renamed soft-delete column follows automatically and the identifier quoting comes from the engine instead of a SQL-Server-shaped literal. Its `engine` parameter defaults to `DataSource.SQLServer` (`:51`), which is exactly what the `…SQLServer` base already implies. On a **unique** index the call is technically redundant with `SoftDeleteUniqueIndexConvention`, which would apply the same predicate at model finalizing; writing it explicitly keeps the intent readable at the call site, and because the convention skips any index that already declares a filter (`SoftDeleteUniqueIndexConvention.cs:53`) the two can never disagree. On a **non-unique** index like the `EventId` lookup here, the convention deliberately does nothing, so the explicit call is the only way to get the filter.
  - The `(EventId, QuestionId, CreatedBy)` unique index (`:42-44`) is a **race backstop**, and the comment (`:39-41`) is unusually candid about why: the application-level upsert only inspects the in-memory collection, so two concurrent submits can both take the create branch. The database refuses the second one, and the shared `DbUpdateException` handler turns the violation into a 409 for the client. `[Rubric §8, Data Architecture]` assesses whether invariants that matter are enforced where they cannot be raced, and `[Rubric §15, Best Practices and Code Quality]` assesses whether known limitations are documented at the point of the compensating control rather than left for the next reader to discover.
- **Walkthrough**: required `EventId` and `QuestionId` scalars (`:19-23`); required `AnswerValue` at `EventInvariants.AnswerValueMaxLength` (`:25-27`); required parent relationship `HasOne(p => p.Event).WithMany(p => p.EventQuestionAnswers).HasForeignKey(p => p.EventId)` (`:29-32`); soft-delete-filtered lookup index on `EventId` (`:35-36`); the BR-123 filtered unique index (`:42-44`).
- **Why it's built this way**: `CreatedBy` is part of the uniqueness tuple, so "one live answer per question" is scoped **per author**, not globally, which is what a per-attendee feedback form needs.
- **Where it's used**: written by the Conference event-feedback command handlers; read by the feedback queries. Compare its sibling [`SessionQuestionAnswerConfiguration`](#sessionquestionanswerconfiguration), which carries the same BR-123 index but treats its parent lookup index differently for a specific reason.

---

### EventSpeakerConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/EventSpeakerConfiguration.cs:11` · Level 8 · class

- **What it is**: the persistence map for the [`EventSpeaker`](group-17-conference-domain.md#eventspeaker) join entity, which records that a speaker is part of an event's line-up.
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`EventSpeaker`](group-17-conference-domain.md#eventspeaker), [`Event`](group-17-conference-domain.md#event), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept introduced, the join-entity template.** Four configurations in this folder are structurally identical, and this is the first: both FK scalars required, one `HasOne(...).WithMany(...)` relationship to the **owning** aggregate only (the side whose collection navigation the join belongs to), and a soft-delete-filtered composite unique index on the two FKs. The other side of the pair is deliberately *not* configured as a relationship, which keeps the entity a one-way child of a single aggregate and matches the DDD rule that an aggregate owns its children. `[Rubric §4, DDD]` assesses aggregate boundary discipline; `[Rubric §8, Data Architecture]` assesses the uniqueness guarantee.
  The soft-delete filter on the unique index is what makes a delete-then-re-add cycle legal: a plain unique index would let a soft-deleted association keep occupying its slot forever, so an organizer could never re-add a speaker they had removed.
- **Walkthrough**: required `EventId` (`:19-20`) and `SpeakerId` (`:22-23`); `HasOne(p => p.Event).WithMany(p => p.EventSpeakers).HasForeignKey(p => p.EventId).IsRequired()` (`:25-28`); `HasIndex(p => new { p.EventId, p.SpeakerId }).IsUnique().HasSoftDeleteFilter()` (`:30-32`).
- **Where it's used**: the same template appears in [`SessionSpeakerConfiguration`](#sessionspeakerconfiguration), [`SessionCategoryItemConfiguration`](#sessioncategoryitemconfiguration) and [`SpeakerCategoryItemConfiguration`](#speakercategoryitemconfiguration).

| Type | File:Line | Owning aggregate | Unique index |
|------|-----------|------------------|--------------|
| `EventSpeakerConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/EventSpeakerConfiguration.cs:11` | [`Event`](group-17-conference-domain.md#event) | `(EventId, SpeakerId)` |
| `SessionSpeakerConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionSpeakerConfiguration.cs:11` | [`Session`](group-17-conference-domain.md#session) | `(SessionId, SpeakerId)` |
| `SessionCategoryItemConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionCategoryItemConfiguration.cs:11` | [`Session`](group-17-conference-domain.md#session) | `(SessionId, CategoryItemId)` |
| `SpeakerCategoryItemConfiguration` | `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SpeakerCategoryItemConfiguration.cs:11` | [`Speaker`](group-17-conference-domain.md#speaker) | `(SpeakerId, CategoryItemId)` |

---

### QuestionConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/QuestionConfiguration.cs:10` · Level 8 · class

- **What it is**: the persistence map for [`Question`](group-17-conference-domain.md#question), the definition of a feedback question (its text, what it attaches to, how it renders, and where it came from).
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`Question`](group-17-conference-domain.md#question), [`QuestionInvariants`](group-17-conference-domain.md#questioninvariants). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept**: the shared shape is taught under [`CategoryItemConfiguration`](#categoryitemconfiguration). What is worth noticing here is that this is the flattest configuration in the folder: six required properties, **no relationships and no indexes at all**.
- **Walkthrough** (`:18-38`): all six columns are `IsRequired()`. `QuestionText`, `QuestionEntity`, `QuestionType` and `QuestionSource` each take their length from `QuestionInvariants`; `Sort` and `IsRequired` (the boolean, not the fluent call) are plain required scalars. `QuestionEntity` and `QuestionType` are stored as **strings, not enums**, so adding a question type or a new attachable entity needs no migration and no enum-to-string conversion.
- **Why it's built this way**: questions are attached to events, sessions and speakers by the three `…QuestionAnswer` entities, and those answers carry a plain `QuestionId` scalar rather than a navigation, so `Question` itself needs no relationship configuration. Modelling the discriminators as strings keeps the question catalogue extensible from data rather than from code.
- **Where it's used**: referenced by `QuestionId` from [`EventQuestionAnswerConfiguration`](#eventquestionanswerconfiguration), [`SessionQuestionAnswerConfiguration`](#sessionquestionanswerconfiguration) and [`SpeakerQuestionAnswerConfiguration`](#speakerquestionanswerconfiguration).

---

### RoomConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/RoomConfiguration.cs:11` · Level 8 · class

- **What it is**: the persistence map for [`Room`](group-17-conference-domain.md#room), a physical room belonging to an [`Event`](group-17-conference-domain.md#event).
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`Room`](group-17-conference-domain.md#room), [`Event`](group-17-conference-domain.md#event), [`EventInvariants`](group-17-conference-domain.md#eventinvariants), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept introduced, re-declaring an index EF would otherwise drop.** The explicit `builder.HasIndex(p => p.EventId)` (`:48`) looks redundant next to the `(EventId, Name)` composite below it, and the comment (`:46-47`) says exactly why it is not: EF removes the conventional foreign-key index as redundant once a composite index **leads with the same column**, but the composite is filtered, and the plain FK lookups still want an unfiltered index. This is a good example of a mapping decision that only makes sense once you know EF's own de-duplication rule; without the comment the line reads as a mistake. `[Rubric §12, Performance and Scalability]` assesses whether index choices survive framework conventions rather than being silently optimized away.
- **Walkthrough**
  - **Required** (`:19-24`): `Name` at `EventInvariants.RoomNameMaxLength`, and `Sort`.
  - **Optional** (`:26-39`): `Capacity` (a nullable scalar with no length), plus `Floor`, `Location` and `AccessibilityInfo`, each with an invariant-sourced max length. `AccessibilityInfo` being a first-class room column, not a note bolted onto the description, is the schema-level half of ADC's WCAG commitment. `[Rubric §21, Accessibility]` assesses whether accessibility is designed into the data rather than added at the view.
  - **Parent relationship** (`:41-44`): required `HasOne(p => p.Event).WithMany(p => p.Rooms).HasForeignKey(p => p.EventId)`.
  - **Indexes** (`:48`, `:52-54`): the re-declared plain `EventId` index, then `HasIndex(p => new { p.EventId, p.Name }).IsUnique().HasSoftDeleteFilter()`. The comment (`:50-51`) states its purpose plainly: it backstops the aggregate's duplicate-room-name invariant, and the soft-delete filter means a deleted room never blocks reusing its name.
- **Why it's built this way**: the domain already refuses a duplicate room name inside the `Event` aggregate; the filtered unique index is the database-side guarantee for the concurrent case the in-memory check cannot see, the same defence-in-depth reasoning as BR-123 in [`EventQuestionAnswerConfiguration`](#eventquestionanswerconfiguration).
- **Where it's used**: `Room` is the optional FK target of [`SessionConfiguration`](#sessionconfiguration), which restricts deletes against it.

---

### SessionAiScoreConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionAiScoreConfiguration.cs:11` · Level 8 · class

- **What it is**: the persistence map for [`SessionAiScore`](group-17-conference-domain.md#sessionaiscore), the row that stores a language model's rating of one session across seven dimensions plus its written reasoning.
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`SessionAiScore`](group-17-conference-domain.md#sessionaiscore), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept introduced, sizing a decimal column to the value's actual range.** Each of the seven score columns is declared `HasPrecision(3, 1)`, that is `decimal(3,1)`: three total digits, one after the point (`:22-48`). That is the smallest exact-decimal shape that holds a one-decimal rating without the rounding surprises a `float`/`double` column would introduce. Choosing exact decimal for a value that is compared and sorted, rather than binary floating point, is the point. `[Rubric §8, Data Architecture]` assesses type fidelity of stored values.
- **Concept reinforced, recording the provenance of derived data.** `ModelUsed` (`:54-56`, max 100) and `Reasoning` (`:50-52`, max 4000) are both **required**. Persisting which model produced a score, and the sentence explaining it, alongside the numbers is what makes an AI judgement auditable: you can tell after the fact whether a given score came from a model you have since replaced. `[Rubric §13, Observability and Operability]` assesses whether derived values carry enough context to be explained later.
- **Walkthrough**: required `SessionId` scalar (`:19-20`); seven `decimal(3,1)` required score columns, `OverallScore`, `TopicRelevanceScore`, `DescriptionQualityScore`, `NoveltyScore`, `ActionableTakeawaysScore`, `DepthOrInsightQualityScore`, `CredibilityExperienceScore` (`:22-48`); required `Reasoning` and `ModelUsed` (`:50-56`); and `HasIndex(p => p.SessionId).IsUnique().HasSoftDeleteFilter()` (`:59-61`), commented "One score per session (among non-deleted)". There is **no** `HasOne` relationship to [`Session`](group-17-conference-domain.md#session): `SessionId` is a plain scalar, so the score row is not a child of the session aggregate.
- **Why it's built this way**: keeping the score in its own table behind a unique-per-session index means re-scoring is a soft-delete plus insert (the filter frees the slot) rather than an in-place overwrite, and the previous scoring run stays on disk for comparison.
- **Where it's used**: written by the Conference scoring pipeline, whose adapter and processor are covered earlier in this chapter under [`AnthropicScoringService`](#anthropicscoringservice) and [`SessionScoringProcessor`](#sessionscoringprocessor).
- **Caveats / not-in-source**: this configuration only defines the table. Whether scoring runs in a given environment is a configuration and feature-gating question decided outside this file. Note also that [`ModuleApplicationDbContext`](#moduleapplicationdbcontext) declares no `DbSet` for `SessionAiScore`, and nothing breaks, because that manifest does not drive the model.

---

### SpeakerCategoryItemConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SpeakerCategoryItemConfiguration.cs:11` · Level 8 · class

- **What it is**: the persistence map for the [`SpeakerCategoryItem`](group-17-conference-domain.md#speakercategoryitem) join entity, which tags a speaker with a [`CategoryItem`](group-17-conference-domain.md#categoryitem) (locality, expertise and so on).
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`SpeakerCategoryItem`](group-17-conference-domain.md#speakercategoryitem), [`Speaker`](group-17-conference-domain.md#speaker), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept**: an exact instance of the join-entity template taught under [`EventSpeakerConfiguration`](#eventspeakerconfiguration).
- **Walkthrough**: required `SpeakerId` (`:19-20`) and `CategoryItemId` (`:22-23`); `HasOne(p => p.Speaker).WithMany(p => p.SpeakerCategoryItems).HasForeignKey(p => p.SpeakerId).IsRequired()` (`:25-28`); `HasIndex(p => new { p.SpeakerId, p.CategoryItemId }).IsUnique().HasSoftDeleteFilter()` (`:30-32`). The `CategoryItem` end is intentionally left unmapped as a relationship, so the row belongs to the speaker aggregate alone.
- **Where it's used**: the speaker-profile read paths join through it to resolve a speaker's tags.

---

### SpeakerConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SpeakerConfiguration.cs:12` · Level 8 · class

- **What it is**: the persistence map for [`Speaker`](group-17-conference-domain.md#speaker): name, bio, social links, the optional link to an Identity user, and the one value-object column in the Conference module.
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`Speaker`](group-17-conference-domain.md#speaker), [`SpeakerInvariants`](group-17-conference-domain.md#speakerinvariants), [`NullableEmailValueConverter`](group-07-persistence-ef-core.md#nullableemailvalueconverter), and transitively the [`Email`](group-02-domain-building-blocks.md#email) value object. External: `Microsoft.EntityFrameworkCore`.
- **Concept introduced, mapping a value object with `HasConversion` instead of `OwnsOne`.** `builder.Property(p => p.Email).HasConversion(new NullableEmailValueConverter())` (`:42-43`) round-trips the `Email?` value object to a plain nullable string column. The converter (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conversions/EmailValueConverter.cs:60-70`) passes `null` straight through on both legs, so "no email" stays a SQL `NULL` rather than becoming an empty string or a failed `Email.Create` call. Two design points worth carrying forward:
  - **Why `HasConversion` and not `OwnsOne`**: the backing column stays a plain string, so adopting the value object on a property that used to be a `string` is not a schema change (`EmailValueConverter.cs:8-10`).
  - **Facets stay at the call site**: the converter deliberately owns no length or requiredness, which is why `HasMaxLength(SpeakerInvariants.EmailMaxLength)` and `IsRequired(false)` are chained here (`:44-45`). Those differ per entity and are not the converter's business (`EmailValueConverter.cs:20-22`).

  `[Rubric §4, DDD]` assesses whether value objects survive the trip to storage instead of being flattened into primitives at the boundary. `[Rubric §16, Maintainability]` applies too: the conversion logic lives once in MMCA.Common, so every entity with an email gets identical semantics.
- **Concept reinforced, the partially filtered unique index.** `HasIndex(p => p.LinkedUserId).IsUnique().HasFilter("[LinkedUserId] IS NOT NULL")` (`:63-65`) enforces the one-to-one User to Speaker link **only among speakers that have one**. Without the predicate, SQL Server would treat multiple `NULL`s as duplicates and allow at most one unlinked speaker, which would be nonsense. Note this one is a hand-written literal rather than `HasSoftDeleteFilter()`, because the predicate is about `LinkedUserId`, not about soft delete; the soft-delete clause is added on top automatically, since the index is unique and the convention only skips indexes that already have a filter (`SoftDeleteUniqueIndexConvention.cs:53`).
- **Walkthrough**
  - **Required identity** (`:20-26`, `:39-40`): `FirstName`, `LastName`, `IsTopSpeaker`.
  - **Optional profile** (`:28-37`, `:47-61`): `Bio` (no max length, so `nvarchar(max)`), `TagLine`, `ProfilePicture`, `TwitterHandle`, `LinkedInUrl`, `GitHubUrl`, `WebsiteUrl`, each length-capped from `SpeakerInvariants`.
  - **Email** (`:42-45`) and the **`LinkedUserId` index** (`:63-65`), described above.
  - **Computed property excluded** (`:68`): `builder.Ignore(p => p.FullName)` keeps the derived `FullName` out of the schema. Ignoring computed properties explicitly is how this codebase keeps derived state a domain concern and off the table.
- **Why it's built this way**: `LinkedUserId` is a **scalar with no FK**, deliberately. The Identity user lives in a different service database, so a cross-database foreign key is not available under database-per-service; the unique index gives the guarantee the FK would have, within the one database that can enforce it. See [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html). `[Rubric §7, Microservices Readiness]` assesses whether the schema is already free of cross-service constraints, which is what makes the Conference service extractable.
- **Where it's used**: `Speaker` is the owning aggregate for [`SpeakerCategoryItemConfiguration`](#speakercategoryitemconfiguration) and [`SpeakerQuestionAnswerConfiguration`](#speakerquestionanswerconfiguration), and the FK target of the `SpeakerId` scalar in [`EventSpeakerConfiguration`](#eventspeakerconfiguration) and [`SessionSpeakerConfiguration`](#sessionspeakerconfiguration).

---

### SpeakerQuestionAnswerConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SpeakerQuestionAnswerConfiguration.cs:10` · Level 8 · class

- **What it is**: the persistence map for [`SpeakerQuestionAnswer`](group-17-conference-domain.md#speakerquestionanswer), a speaker's answer to a speaker-scoped [`Question`](group-17-conference-domain.md#question) (the fields Sessionize collects on a submission form).
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`SpeakerQuestionAnswer`](group-17-conference-domain.md#speakerquestionanswer), [`Speaker`](group-17-conference-domain.md#speaker), [`SpeakerInvariants`](group-17-conference-domain.md#speakerinvariants). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept**: the answer-entity shape is taught under [`EventQuestionAnswerConfiguration`](#eventquestionanswerconfiguration). This is the **stripped-down** member of the three: it declares no indexes at all.
- **Walkthrough** (`:18-31`): required `SpeakerId`, `QuestionId` and `AnswerValue` (at `SpeakerInvariants.AnswerValueMaxLength`), then `HasOne(p => p.Speaker).WithMany(p => p.SpeakerQuestionAnswers).HasForeignKey(p => p.SpeakerId).IsRequired()`. Only the conventional EF index on the `SpeakerId` foreign key exists.
- **Why it's built this way**: these rows arrive from the Sessionize import as part of a speaker payload and are read back with the speaker, never queried independently or submitted concurrently by two authors, so neither the BR-123 anti-race unique index nor an extra lookup index earns its cost here. Contrast with the event and session answer configurations, where an attendee-facing form can be double-submitted.
- **Where it's used**: populated by the Sessionize sync path and read as part of the speaker detail projection.

---

### SessionCategoryItemConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionCategoryItemConfiguration.cs:11` · Level 9 · class

- **What it is**: the persistence map for the [`SessionCategoryItem`](group-17-conference-domain.md#sessioncategoryitem) join entity, which tags a session with a [`CategoryItem`](group-17-conference-domain.md#categoryitem) (topic, level, track).
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`SessionCategoryItem`](group-17-conference-domain.md#sessioncategoryitem), [`Session`](group-17-conference-domain.md#session), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept**: an exact instance of the join-entity template taught under [`EventSpeakerConfiguration`](#eventspeakerconfiguration).
- **Walkthrough**: required `SessionId` (`:19-20`) and `CategoryItemId` (`:22-23`); `HasOne(p => p.Session).WithMany(p => p.SessionCategoryItems).HasForeignKey(p => p.SessionId).IsRequired()` (`:25-28`); `HasIndex(p => new { p.SessionId, p.CategoryItemId }).IsUnique().HasSoftDeleteFilter()` (`:30-32`).
- **Where it's used**: the session browse and filter queries resolve topic tags through these rows.

---

### SessionConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionConfiguration.cs:12` · Level 9 · class

- **What it is**: the persistence map for [`Session`](group-17-conference-domain.md#session), the busiest entity in the Conference schema: talk metadata, schedule window, status flags, links, and the relationships to its event and room.
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`Session`](group-17-conference-domain.md#session), [`Event`](group-17-conference-domain.md#event), [`Room`](group-17-conference-domain.md#room), [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore` (for `DeleteBehavior`).
- **Concept introduced, `DeleteBehavior.Restrict` as a schedule-integrity guard.** The optional room relationship (`:83-87`) ends in `.OnDelete(DeleteBehavior.Restrict)`. Under EF's default for an optional relationship the FK would be **set to null** on delete, silently unscheduling every talk in the room; `Restrict` makes the database refuse the delete instead, forcing the organizer to move the sessions first. `[Rubric §8, Data Architecture]` assesses whether referential actions match the business meaning of the relationship rather than the framework default.
- **Concept reinforced, navigation configured on one side only.** Both relationships here use the parameterless `WithMany()` (`:73`, `:84`), meaning **there is no inverse collection navigation** on `Event` or `Room` for sessions. Sessions are a large collection queried with paging and filters, so exposing them as an aggregate navigation would invite accidental full loads; the read paths go through explicit queries instead.
- **Walkthrough**
  - **Required** (`:20-22`, `:38-48`, `:69-70`): `Title` at `SessionInvariants.TitleMaxLength`; four booleans, `IsInformed`, `IsConfirmed`, `IsServiceSession`, `IsPlenumSession`; and the `EventId` scalar.
  - **Optional** (`:24-36`, `:50-64`, `:80-81`): `Description`, `StartsAt`, `EndsAt`, `Status`, `LiveUrl`, `RecordingUrl`, `AccessibilityInfo`, `ResourceLinks`, `RoomId`. That `StartsAt`, `EndsAt` and `RoomId` are all nullable is the schema admitting that a session exists as an accepted talk long before it is scheduled.
  - **`Status` is a plain string** (`:34-36`) capped at `SessionInvariants.StatusMaxLength`, not an enum with a conversion, so adding a status value needs no migration.
  - **Computed property excluded** (`:67`): `builder.Ignore(p => p.Duration)`, since `Duration` is derived from `StartsAt` and `EndsAt`.
  - **Event relationship** (`:72-75`) required, plus `HasIndex(p => p.EventId).HasSoftDeleteFilter()` (`:77-78`), a non-unique filtered lookup index for "all live sessions of this event", the single hottest read in the app.
  - **Room relationship** (`:83-87`) optional, with the `Restrict` behaviour described above.
- **Why it's built this way**: the required or optional split mirrors the real conference workflow (accept first, schedule later), and the two relationship decisions, no inverse navigation and restricted room deletes, both trade a little convenience for predictable performance and predictable schedule integrity.
- **Where it's used**: `Session` is the owning aggregate for [`SessionSpeakerConfiguration`](#sessionspeakerconfiguration), [`SessionCategoryItemConfiguration`](#sessioncategoryitemconfiguration) and [`SessionQuestionAnswerConfiguration`](#sessionquestionanswerconfiguration), and the scalar target of [`SessionAiScoreConfiguration`](#sessionaiscoreconfiguration).

---

### SessionQuestionAnswerConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionQuestionAnswerConfiguration.cs:11` · Level 9 · class

- **What it is**: the persistence map for [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer), one attendee's answer to one session-scoped feedback [`Question`](group-17-conference-domain.md#question).
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer), [`Session`](group-17-conference-domain.md#session), [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept introduced, when a filtered index is the wrong index.** This configuration keeps a plain, unfiltered `HasIndex(p => p.SessionId)` (`:37`) alongside the filtered composite, and the comment (`:34-36`) gives a reason worth internalising: the Sessionize sync reads this table by `SessionId` **with the query filters OFF**, and a filtered index cannot serve a query that does not carry the filter's predicate. Soft-delete-filtered indexes are the default choice for application reads, but any code path that deliberately bypasses the global query filter needs an unfiltered index or it falls back to a scan. Compare [`EventQuestionAnswerConfiguration`](#eventquestionanswerconfiguration), whose equivalent parent index **is** filtered, because nothing reads event answers with the filters off. `[Rubric §12, Performance and Scalability]` assesses whether indexes match the queries that actually run, including the maintenance ones.
- **Walkthrough**: required `SessionId`, `QuestionId` and `AnswerValue` at `SessionInvariants.AnswerValueMaxLength` (`:19-27`); required parent relationship `HasOne(p => p.Session).WithMany(p => p.SessionQuestionAnswers).HasForeignKey(p => p.SessionId)` (`:29-32`); the deliberately unfiltered `SessionId` index (`:37`); and the BR-123 index `HasIndex(p => new { p.SessionId, p.QuestionId, p.CreatedBy }).IsUnique().HasSoftDeleteFilter()` (`:43-45`), whose comment (`:39-42`) repeats the concurrency rationale taught under [`EventQuestionAnswerConfiguration`](#eventquestionanswerconfiguration): the in-memory upsert can be raced, the database refuses the loser, and the shared `DbUpdateException` handler renders it as a 409.
- **Why it's built this way**: it carries both index shapes because it serves two different consumers, an attendee-facing form that must not double-submit, and an import job that reads across soft-deleted rows.
- **Where it's used**: written by the session-feedback command handlers, read by the feedback aggregation queries and by the Sessionize sync.

---

### SessionSpeakerConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionSpeakerConfiguration.cs:11` · Level 9 · class

- **What it is**: the persistence map for the [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker) join entity, which records who is presenting a session.
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker), [`Session`](group-17-conference-domain.md#session), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept**: an exact instance of the join-entity template taught under [`EventSpeakerConfiguration`](#eventspeakerconfiguration).
- **Walkthrough**: required `SessionId` (`:19-20`) and `SpeakerId` (`:22-23`); `HasOne(p => p.Session).WithMany(p => p.SessionSpeakers).HasForeignKey(p => p.SessionId).IsRequired()` (`:25-28`); `HasIndex(p => new { p.SessionId, p.SpeakerId }).IsUnique().HasSoftDeleteFilter()` (`:30-32`). The composite unique index is what stops the same speaker being added twice to one session, while still allowing a remove-then-re-add.
- **Where it's used**: joined by the session detail and speaker detail read paths to resolve a session's presenters.

---

### SponsorConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SponsorConfiguration.cs:11` · Level 9 · class

- **What it is**: the persistence map for [`Sponsor`](group-17-conference-domain.md#sponsor): a sponsoring organization's branding, tier, links, and optional expo-booth details, scoped to one [`Event`](group-17-conference-domain.md#event).
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), [`Sponsor`](group-17-conference-domain.md#sponsor), [`SponsorTier`](group-17-conference-domain.md#sponsortier), [`SponsorInvariants`](group-17-conference-domain.md#sponsorinvariants), [`Event`](group-17-conference-domain.md#event), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept introduced, storing an enum as its underlying int on purpose.** `builder.Property(p => p.Tier).HasConversion<int>().IsRequired()` (`:25-27`) makes the [`SponsorTier`](group-17-conference-domain.md#sponsortier) enum a plain `int` column. EF would map an enum to `int` by default anyway, so the value of writing it out is documentary: the comment (`:23-24`) states the two consequences the team wants pinned down, that **tier ordering becomes a plain column sort** (Platinum before Gold falls out of the numeric ordering, no lookup table and no `CASE` expression), and that **adding a package later does not rewrite existing rows**, which a string-backed enum with a renamed member would. `[Rubric §8, Data Architecture]` assesses whether a stored representation is chosen for the queries and the migrations it will have to survive.
  Contrast this with `Session.Status` (a plain string, [`SessionConfiguration`](#sessionconfiguration) `:34-36`) and `Question.QuestionType` (also a string, [`QuestionConfiguration`](#questionconfiguration) `:26-28`). The codebase does not apply one rule everywhere: values with a meaningful **order** are ints, open-ended vocabularies stay strings.
- **Walkthrough**
  - **Required** (`:19-27`, `:49-53`, `:59-60`): `Name` at `SponsorInvariants.NameMaxLength`; `Tier` as above; `Sort`; `IsExhibitor`; the `EventId` scalar.
  - **Optional branding and links** (`:29-47`): `LogoUrl`, `Description`, `WebsiteUrl`, `LinkedInUrl`, `TwitterHandle`, each length-capped from `SponsorInvariants`. A sponsor row is useful the moment it has a name and a tier; everything the sponsor sends over later is nullable.
  - **Optional booth detail** (`:55-57`): `BoothNumber`, paired with the required `IsExhibitor` flag. Sponsorship and exhibiting are separate facts: a sponsor can have a tier without a booth.
  - **Event relationship** (`:62-65`): required `HasOne(p => p.Event).WithMany().HasForeignKey(p => p.EventId)`, with the parameterless `WithMany()`, so `Event` exposes no sponsors collection, the same one-sided-navigation choice made in [`SessionConfiguration`](#sessionconfiguration).
  - **Lookup index** (`:67-68`): `HasIndex(p => p.EventId).HasSoftDeleteFilter()`, a non-unique filtered index for "all live sponsors of this event", which is exactly what the public sponsor wall queries.
- **Why it's built this way**: the sponsor wall is a public, cached read that always filters by event and orders by tier then `Sort`; making the tier an int and the event lookup a filtered index means that page is a single indexed range scan with an ordering the database can satisfy directly.
- **Where it's used**: the Conference sponsor endpoints and the public sponsor wall UI; the schema is snapshotted by `MMCA.ADC.Migrations.SqlServer.Conference` like the rest of the family.

---

### ConferenceModuleDbSeeder

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts.Seeding` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:24` · Level 9 · class

- **What it is**: the Conference module's idempotent database seeder. It always seeds the **two**
  conference events (Cloud + AI and Developers) and the standard feedback questions, and *optionally*
  seeds sample browse data (speakers, sessions, event/session speaker links, and sponsors) when an
  `includeSampleData` flag is set. It derives from the framework's
  [`DbSeeder`](group-07-persistence-ef-core.md#dbseeder) base
  (`ConferenceModuleDbSeeder.cs:24`), which is the abstract implementation of
  [`IDbSeeder`](group-07-persistence-ef-core.md#idbseeder).
- **Depends on**: [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (the single constructor
  dependency, `:24`), from which every seed method pulls a typed
  [`IRepository<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#irepositorytentity-tidentifiertype)
  (`:61`, `:130`, `:177`, `:230`, `:342`); the domain factories for
  [`Event`](group-17-conference-domain.md#event), [`Question`](group-17-conference-domain.md#question),
  [`Speaker`](group-17-conference-domain.md#speaker), [`Session`](group-17-conference-domain.md#session)
  and [`Sponsor`](group-17-conference-domain.md#sponsor); the aggregate methods
  `Event.AddEventSpeaker` and `Session.AddSessionSpeaker` that create the
  [`EventSpeaker`](group-17-conference-domain.md#eventspeaker) /
  [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker) links; the
  [`SponsorTier`](group-17-conference-domain.md#sponsortier) enum from the module's Shared project
  (`:6`); and the reserved-id constants
  [`QuestionInvariants`](group-17-conference-domain.md#questioninvariants)`.ManualIdRangeStart` and
  [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants)`.ManualIdRangeStart`. Externals
  are BCL only (`DateOnly`, `TimeOnly`, `DateTime`, tuple arrays, LINQ `FirstOrDefault`).
- **Concept reinforced, idempotent and environment-gated seeding through the domain factories.**
  `[Rubric §17, DevOps & Deployment]` assesses whether database initialization is repeatable and safe to
  re-run on every start; `[Rubric §14, Testability]` assesses whether the system provides deterministic
  fixtures a test tier can rely on. Every seed step asks the repository first
  (`ExistsAsync` at `:64`, `:98`, `:132`, `:189`, `:249`, `:359`) and returns or `continue`s when the row
  is already there, so re-running against a seeded database writes nothing. `[Rubric §4, DDD]` shows up
  in *how* the rows are written: seed data goes through the same `Event.Create` / `Question.Create` /
  `Speaker.Create` / `Session.Create` / `Sponsor.Create` factories the command handlers use, each
  returning a `Result<T>` that is checked for `IsFailure` before `AddAsync` (`:85`, `:166`, `:206`,
  `:275`, `:380`), so seeded rows satisfy exactly the same invariants as user-created rows. There is no
  raw-insert back door.
- **Walkthrough**
  - **Constants and suppressions** (`:26`-`:38`): the shared `VenueAddress` literal (`:26`), the venue
    map embed URL (`:29`), the placeholder sample-sponsor website (`:32`), and the two published
    sponsorship-packet URLs, one per event (`:35`, `:38`). Each URL constant carries its own narrowly
    scoped `S1075` (`URIs should not be hardcoded`) suppression with a written justification (`:28`,
    `:31`, `:34`, `:37`). `[Rubric §15, Best Practices & Code Quality]` assesses exactly this: analyzer
    suppressions are per-symbol and explained, never a blanket file- or project-level disable.
  - **Constructor** (`:24`): a primary constructor `(IUnitOfWork unitOfWork, bool includeSampleData = false)`.
    `unitOfWork` is null-guarded into a readonly field (`:40`) and the flag is copied (`:41`). The default
    is `false`, so the production-safe path is the one you get by forgetting the argument.
  - **`SeedAsync`** (`:44`-`:57`): the ordered entry point. Three unconditional steps run first, the
    Cloud + AI event, the Developers event, then the questions (`:46`-`:48`). Only when
    `_includeSampleData` is true does it continue into `SeedSpeakersAsync`, `SeedSessionsAsync`,
    `SeedSampleEventLinksAsync`, and `SeedSponsorsAsync` (`:50`-`:56`). That `if` is the entire
    **environment gate**: real events and feedback questions always exist, sample browse rows exist only
    where the caller asked for them.
  - **`SeedCloudAiConferenceEventAsync`** (`:59`-`:92`): the existence probe deliberately matches **two**
    names, `"2026 Atlanta Cloud + AI Conference"` and the pre-rename `"Atlanta Cloud + AI Conference"`
    (`:64`-`:66`, with the reason in the comment at `:63`), so a database seeded before the rename is not
    given a duplicate. When absent it builds the event through `Event.Create` (`:71`-`:83`): single-day
    2026-05-30, `America/New_York`, Sessionize code `z1ecmzux`, the shared venue constants, organizer
    contact `atlcloudconf@gmail.com`, and the Cloud + AI sponsorship packet URL. A failed `Result` simply
    returns (`:85`-`:86`). It then calls `eventResult.Value!.Publish()` (`:88`) so the event is publicly
    visible the moment it lands, and finishes with `AddAsync` + `SaveChangesAsync` (`:90`-`:91`).
  - **`SeedDevelopersConferenceEventAsync`** (`:94`-`:126`): structurally identical, one name only
    (`"2026 Atlanta Developers Conference"`, `:99`), 2026-10-17, Sessionize code `sf1nopko`, organizer
    contact `atldevcon@gmail.com`, and the Developers-edition packet URL. Both events share the same
    physical venue constants.
  - **`SeedQuestionsAsync`** (`:128`-`:173`): guarded by a single probe for `"Rate the Session"` with
    `QuestionSource == "User"` (`:132`-`:134`), it then walks a literal tuple array of ten questions
    (`:139`-`:151`): six Session-scoped (five `Rating` plus a free-text `Comments`) and four Event-scoped
    (three `Rating` plus `Comments`). Ids are **explicitly assigned**, starting at
    `QuestionInvariants.ManualIdRangeStart` and incrementing (`:153`, `:158`); that constant is
    `999_999_000` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Questions/QuestionInvariants.cs:37`),
    a reserved band sitting above any real Sessionize id so imported questions can never collide with
    these. One `SaveChangesAsync` commits the whole set (`:172`).
  - **`SeedSpeakersAsync`** (`:175`-`:215`, sample-only): two sample speakers, Ada Lovelace and Alan
    Turing (`:179`-`:183`), each existence-checked by first and last name individually (`:189`-`:191`) so
    a partially seeded database is topped up rather than skipped wholesale. Both are created with
    `isTopSpeaker: true`. An `added` flag means `SaveChangesAsync` is called only when something actually
    changed (`:213`-`:214`), the same guard every sample step uses.
  - **`SeedSessionsAsync`** (`:217`-`:284`, sample-only): resolves both seeded events through the shared
    `GetSampleEventsAsync` helper (`:227`-`:228`), then declares two sample sessions, one per event
    (`:236`-`:240`): the keynote on the Cloud + AI event and the Azure talk on the Developers event. Ids
    are assigned from `SessionInvariants.ManualIdRangeStart` and `+ 1` (`:238`-`:239`; the constant is
    `999_999_000` at
    `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionInvariants.cs:41`),
    because a Session's int primary key **is** its Sessionize id (comment at `:232`-`:235`), so app-created
    sessions must take ids from a reserved high band. Start time is computed off the owning event's date,
    `sessionEvent.StartDate.ToDateTime(new TimeOnly(13, 0), DateTimeKind.Utc)` (`:257`), one hour long
    (`:264`), status `"Accepted"`, no room.
  - **`SeedSampleEventLinksAsync`** (`:286`-`:310`, sample-only): loads the two sample speakers untracked
    (`:290`-`:295`), bails if either is missing (`:299`-`:300`), then calls both link helpers and combines
    their results with `added |=` (`:305`-`:306`), the non-short-circuiting operator, so the session-link
    pass always runs even when the event-link pass reported nothing new.
  - **`LinkSampleEventSpeakersAsync`** (`:312`-`:331`): re-reads the events **tracked** and with the
    `EventSpeakers` collection included (`:316`-`:317`, the include is required because the aggregate
    checks that collection), then links Ada to Cloud + AI and Alan to Developers (`:324`, `:327`).
    Idempotency here is delegated to the aggregate: `Event.AddEventSpeaker` returns a
    `Event.Speaker.Duplicate` failure when a non-deleted link for that speaker already exists
    (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/Event.cs:515`-`:522`), so the
    seeder only has to look at `IsSuccess`.
  - **`LinkSampleSessionSpeakersAsync`** (`:410`-`:430`): the same trick on the other side, sessions
    loaded tracked with `SessionSpeakers` included (`:414`-`:418`), then each sample session gets its
    matching speaker by title (`:424`-`:425`). Linking **both** paths is deliberate (comment at
    `:302`-`:304`): the speakers-by-event filter has a direct `EventSpeaker` branch and a transitive
    `SessionSpeaker` branch, and dev/CI data exercises both.
  - **`SeedSponsorsAsync`** (`:333`-`:389`, sample-only): four sample sponsors spread across the two
    events (`:344`-`:350`), a Platinum and a Gold exhibitor with booth numbers on the Cloud + AI event, a
    Silver and a Community non-exhibitor on the Developers event. Sponsors are per-event, so a null event
    is skipped (`:355`-`:356`) and each name is existence-checked (`:359`-`:361`) before `Sponsor.Create`
    (`:366`-`:378`).
  - **`GetSampleEventsAsync`** (`:391`-`:408`): a `static` helper that fetches both events in one tracked
    `GetAllAsync` with a caller-supplied `includes` list (`:397`-`:402`), picks the Developers event by
    exact name and treats "anything else in the result" as the Cloud + AI event (`:404`-`:405`), which is
    how the pre-rename name keeps resolving. Passing `includes` in lets one helper serve both the
    no-navigation callers (`:228`, `:340`) and the `EventSpeakers`-loading caller (`:317`).
- **Why it's built this way**: seeding through domain factories keeps seed rows valid by construction
  rather than by hand-written SQL that drifts from the invariants; per-row existence probes make the
  whole seeder safe to run on every startup, which is what the deployed hosts do (each service migrates
  and seeds its own database, see [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html));
  and the `includeSampleData` default of `false` keeps browse fixtures out of production while
  guaranteeing dev and CI always have at least one session and one speaker. The class remarks
  (`:16`-`:23`) name the two public-browse E2E tests (`PublicBrowseTests.PublicSessionList_*` /
  `PublicSpeakerList_*`) that depend on exactly that guarantee.
- **Where it's used**: constructed and driven by
  [`ConferenceModuleSeeder`](group-20-conference-api-grpc.md#conferencemoduleseeder)
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:28`-`:29`), the
  module's [`IModuleSeeder`](group-14-module-system-composition.md#imoduleseeder) implementation, which
  resolves `IUnitOfWork` from the service provider (`ConferenceModuleSeeder.cs:21`), reads
  `Seeding:IncludeSampleConferenceData` from configuration (`:26`), and awaits `SeedAsync`. Module
  seeders are invoked by [`ModuleLoader`](group-14-module-system-composition.md#moduleloader) in module
  registration order.
- **Caveats / not-in-source**: (1) the seeder reads no configuration itself, the boolean is the caller's
  decision, so which hosts set `Seeding:IncludeSampleConferenceData=true` is a configuration fact, not a
  code fact (the class remarks at `:17`-`:20` say the local AppHost and the E2E CI workflow do, and
  production leaves it unset). (2) Idempotency is by **name/title match**, so renaming a seeded event,
  question, speaker, session, or sponsor in the database causes the next run to insert a fresh copy; the
  Cloud + AI probe carries an explicit second name (`:65`) precisely because that already happened once.
  (3) In `SeedQuestionsAsync` a mid-loop factory failure `return`s before the single `SaveChangesAsync`
  (`:166`-`:167`), so the already-added questions in that batch are never committed, deliberate
  all-or-nothing behavior, but it means a partial question set is not possible and a silent no-op is.
  (4) The comment at `:223`-`:226` records that databases seeded before the sample sessions were split
  across the two events keep the old both-on-one-event shape, because the skip-by-title check never moves
  an existing row; the documented remedy is resetting the local SQL volume.

### ModuleApplicationDbContext

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:19` · Level 9 · class (abstract)

- **What it is**: the Conference module's abstract EF Core `DbContext`. It adds nothing but a typed
  inventory: fourteen `internal DbSet<T>` properties naming the entities this module persists
  (`:27`-`:66`), on top of the framework base
  [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext).
- **Depends on**: [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) (base,
  `:24`) and its four constructor inputs, EF Core's `DbContextOptions`, `IServiceProvider`,
  [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider),
  and [`PhysicalDataSource`](group-07-persistence-ef-core.md#physicaldatasource) (`:20`-`:23`); the
  Conference domain entities [`Event`](group-17-conference-domain.md#event),
  [`Room`](group-17-conference-domain.md#room),
  [`EventSpeaker`](group-17-conference-domain.md#eventspeaker),
  [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer),
  [`Session`](group-17-conference-domain.md#session),
  [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker),
  [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer),
  [`SessionCategoryItem`](group-17-conference-domain.md#sessioncategoryitem),
  [`Speaker`](group-17-conference-domain.md#speaker),
  [`SpeakerCategoryItem`](group-17-conference-domain.md#speakercategoryitem),
  [`Category`](group-17-conference-domain.md#category),
  [`CategoryItem`](group-17-conference-domain.md#categoryitem),
  [`Question`](group-17-conference-domain.md#question), and
  [`Sponsor`](group-17-conference-domain.md#sponsor) (`:27`-`:66`). External: `Microsoft.EntityFrameworkCore`.
- **Concept reinforced, one context class per engine, not per module.** `[Rubric §8, Data Architecture]`
  assesses whether the persistence topology is a deliberate design rather than an accident of code
  organization. The instinctive reading of this file, "each module has its own DbContext class", is
  **not** how the runtime works. The context that actually executes queries is the framework's sealed
  [`SQLServerDbContext`](group-07-persistence-ef-core.md#sqlserverdbcontext)
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:16`),
  one class per storage engine, instantiated once per physical database. Its `OnModelCreating` calls
  `ApplyConfigurationsForEntitiesInContext(DataSource.SQLServer, modelBuilder)`
  (`SQLServerDbContext.cs:88`), which scans every module assembly supplied by the
  `IEntityConfigurationAssemblyProvider` for `IEntityTypeConfigurationSQLServer<,>` implementations and
  applies only those whose entity maps to *this* instance's `DataSourceKey`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:610`-`:637`,
  filtering through [`EntityDataSourceRegistry`](group-07-persistence-ef-core.md#entitydatasourceregistry)).
  In other words the EF model is built from the **entity configurations**, not from `DbSet` declarations,
  and `DataSourceModelCacheKeyFactory` keys the model cache per data source so the same class can hold
  different models per database. That is the design recorded in
  [ADR-006](https://ivanball.github.io/docs/adr/006-database-per-service.html) and
  [ADR-018](https://ivanball.github.io/docs/adr/018-polyglot-persistence.html): splitting the context
  per module is explicitly rejected, because engine choice, not module membership, is what a context
  class encodes.
- **Walkthrough**
  - **Primary constructor** (`:19`-`:24`): four parameters, `DbContextOptions options`,
    `IServiceProvider serviceProvider`, `IEntityConfigurationAssemblyProvider assemblyProvider`, and
    `PhysicalDataSource physicalDataSource`, forwarded verbatim to the base (`:24`). No parameter is
    stored, transformed, or validated here; the whole file is pass-through plus declarations.
  - **The fourteen `DbSet` properties** (`:27`-`:66`): aggregate roots (`Events`, `Sessions`, `Speakers`,
    `Categories`, `Questions`, `Sponsors`), their children (`Rooms`, `CategoryItems`), and the join and
    answer entities (`EventSpeakers`, `EventQuestionAnswers`, `SessionSpeakers`,
    `SessionQuestionAnswers`, `SessionCategoryItems`, `SpeakerCategoryItems`). They are `internal`, not
    `public`: nothing outside this assembly can reach a `DbSet`, which keeps application code on the
    repository and unit-of-work abstractions instead of on EF directly.
  - **Inherited behavior**: the class body defines no overrides at all. Audit stamping, soft-delete and
    tenant query filters, domain-event capture, and outbox persistence all come from the base and its
    interceptors, [`AuditSaveChangesInterceptor`](group-07-persistence-ef-core.md#auditsavechangesinterceptor)
    and [`DomainEventSaveChangesInterceptor`](group-07-persistence-ef-core.md#domaineventsavechangesinterceptor),
    which is how a Conference `SaveChangesAsync` writes an
    [`OutboxMessage`](group-04-events-outbox.md#outboxmessage) row in the same transaction as the
    aggregate change ([ADR-003](https://ivanball.github.io/docs/adr/003-outbox-dual-dispatch.html)).
- **Why it's built this way**: the per-module abstract context is the module's declared persistence
  surface, one file you can read to learn exactly which tables the Conference module owns, without
  fragmenting the runtime into per-module contexts (which would break cross-module transactions and
  multiply model caches). Each sibling module declares its own identically named class in its own
  namespace, Engagement at
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:19`
  and Identity at
  `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:15`,
  so the three read as parallel inventories of three module-owned databases (`ADC_Conference`,
  `ADC_Engagement`, `ADC_Identity`).
- **Where it's used**: as a declaration, and only as one, today. A repository-wide search for the type
  name across `MMCA.ADC/Source` and `MMCA.ADC/Tests` returns nothing but the three class declarations
  themselves, so **no concrete class in this repository derives from it** and no code resolves it from
  DI; the Conference tables are reached through
  [`SQLServerDbContext`](group-07-persistence-ef-core.md#sqlserverdbcontext) instances created by the
  framework's context factories, and the entity configurations covered in the sibling section of this
  chapter are what put those tables in the model.
- **Caveats / not-in-source**: (1) The XML doc comment (`:14`-`:18`) says the class "declares the DbSets
  for all Conference entities". Two entities that **do** have SQL Server configurations in this module,
  [`SessionAiScore`](group-17-conference-domain.md#sessionaiscore) (`SessionAiScoreConfiguration.cs`) and
  `SpeakerQuestionAnswer` (`SpeakerQuestionAnswerConfiguration.cs`), have no `DbSet` here, and they are
  still mapped and still persisted, which is the clearest available proof that the model comes from the
  configurations rather than from this list. Treat the `DbSet` block as a helpful but non-authoritative
  index. (2) Because nothing derives from this abstract class, whether a future engine-specific or
  test-specific subclass is intended is not determinable from source.


---
[⬅ ADC Conference - Application & Use Cases](group-18-conference-application.md)  •  [Index](00-index.md)  •  [ADC Conference - API, gRPC Contracts & Service Host ➡](group-20-conference-api-grpc.md)
