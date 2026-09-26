# 19. ADC Conference - Infrastructure & Persistence

**What this chapter covers.** This is the **adapter** layer of the Conference module, the place where
the engine-agnostic domain meets concrete technology. Three concerns live here: (1) **persistence
mapping**, the 19 EF Core entity configurations that turn plain domain classes into SQL Server tables,
the abstract `DbContext` that declares the module's `DbSet`s, and the seeder that puts the real
conference events and feedback questions into a fresh database; (2) **outbound integration**, the typed
`HttpClient` that talks to **Sessionize** (the conference's session-submission platform) and the AI
session scorer that runs one proposal through the framework's governed chat client, together with the
response guardrail that pipeline runs on every scoring answer; and (3) the **DI wiring** that registers
those services and composes the Conference AI guardrails, plus the one small output-cache adapter the
durable scoring pass calls back into. It is the per-module realization of Clean Architecture's ports
and adapters idea: the [Application](group-18-conference-application.md) layer declares the ports
([`ISessionizeService`](group-18-conference-application.md#isessionizeservice),
[`IAiScoringService`](group-18-conference-application.md#iaiscoringservice),
[`ISessionScoresCacheEvictor`](group-18-conference-application.md#isessionscorescacheevictor)), and this
Infrastructure layer supplies the adapters. `[Rubric §3, Clean Architecture]` assesses
whether dependencies point inward and the domain stays framework-free; here every EF, HTTP, and
AI concern is quarantined in Infrastructure, so the domain entities in
[Group 17](group-17-conference-domain.md) carry no persistence or transport attribute at all.

## Engine-agnostic entities, engine chosen by the config base class

The most important idea in this chapter is one the entities themselves never express: **what storage
engine each entity uses is decided here, not in the domain.** A Conference domain entity,
[`Session`](group-17-conference-domain.md#session), [`Speaker`](group-17-conference-domain.md#speaker),
[`Event`](group-17-conference-domain.md#event), [`Sponsor`](group-17-conference-domain.md#sponsor),
[`Activity`](group-17-conference-domain.md#activity), [`Partner`](group-17-conference-domain.md#partner),
the join entities, is a plain class. The *only*
thing that binds it to SQL Server is which base class its configuration inherits from. All 19 configs in
this group ([`SessionConfiguration`](#sessionconfiguration),
[`SpeakerConfiguration`](#speakerconfiguration), [`EventConfiguration`](#eventconfiguration),
[`SponsorConfiguration`](#sponsorconfiguration), [`ActivityConfiguration`](#activityconfiguration),
[`PartnerConfiguration`](#partnerconfiguration),
[`SessionAssetConfiguration`](#sessionassetconfiguration), and the rest) derive from
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
`SponsorConfiguration.cs:19-21`, `ActivityInvariants.NameMaxLength` at `ActivityConfiguration.cs:19-21`,
[`PartnerInvariants`](group-17-conference-domain.md#partnerinvariants)`.NameMaxLength` at
`PartnerConfiguration.cs:19-21`),
required and optional flags, derived values resolved one way or the other (`Speaker.FullName` is left out
of the model with `builder.Ignore(...)` at `SpeakerConfiguration.cs:68`, while `Session.Duration` is
mapped as a **stored computed column**,
`HasComputedColumnSql("DATEDIFF(minute, [StartsAt], [EndsAt])", stored: true)` at
`SessionConfiguration.cs:74-75`, because the sessions grid sorts on it and an `ORDER BY` needs a real
column: dynamic LINQ cannot express a date difference and the provider does not translate `DateTime`
subtraction, so the value has to live in the database where no writer can set it to anything else,
`SessionConfiguration.cs:66-73`), value conversions
(`Speaker.Email` round-trips through
[`NullableEmailValueConverter`](group-07-persistence-ef-core.md#nullableemailvalueconverter) at
`SpeakerConfiguration.cs:42-45`, and `Sponsor.Tier` is stored as its underlying `int` with
`HasConversion<int>()` so tier ordering is a plain column sort and adding a package later does not
rewrite existing rows, `SponsorConfiguration.cs:23-27`, and
[`PartnerConfiguration`](#partnerconfiguration) states the same reason for storing `Partner.PartnerType`
as an `int`, `PartnerConfiguration.cs:23-27`), and decimal precision (`HasPrecision(3, 1)` on
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
and the quoting from the engine. Eight lookup indexes here take that opt-in: `Session.EventId`
(`SessionConfiguration.cs:85-86`), `Sponsor.EventId` (`SponsorConfiguration.cs:67-68`),
`Partner.EventId`, the only index [`PartnerConfiguration`](#partnerconfiguration) declares, over the
required per-event foreign key it maps just above (`PartnerConfiguration.cs:44-53`),
`EventQuestionAnswer.EventId` (`EventQuestionAnswerConfiguration.cs:35-36`), both of
[`ActivityConfiguration`](#activityconfiguration)'s, the plain `EventId` lookup
(`ActivityConfiguration.cs:58-59`) and the composite (EventId, StartTime, SortOrder) that serves the
public activities page's ordering directly instead of sorting an event slice in memory
(`ActivityConfiguration.cs:61-64`), and both of
[`SessionAssetConfiguration`](#sessionassetconfiguration)'s, the composite (SessionId, SortOrder) that
serves the only read shape the table has, one session's assets in sort order
(`SessionAssetConfiguration.cs:70-74`), and the `EventId` lookup the event-level cascade delete uses to
select every asset of one event in a single read (`SessionAssetConfiguration.cs:76-78`). Several unique
indexes also call it explicitly for readability even
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
`OnDelete(DeleteBehavior.Restrict)` (`SessionConfiguration.cs:91-95`) so deleting a room can never
cascade sessions away. [`SessionAssetConfiguration`](#sessionassetconfiguration) shows the opposite end
of the modelling choice: both of its foreign keys are declared with `HasOne<Event>()` and
`HasOne<Session>()` and **no navigation property at all**
(`SessionAssetConfiguration.cs:60-68`), so the database gets its referential integrity while the model
gains no traversal path the read side never uses (`SessionAssetConfiguration.cs:13-17`). Two configs
declare no index at all and map columns only,
[`QuestionConfiguration`](#questionconfiguration) (`QuestionConfiguration.cs:10`) and
[`SpeakerQuestionAnswerConfiguration`](#speakerquestionanswerconfiguration)
(`SpeakerQuestionAnswerConfiguration.cs:10`).

## DbSets, the context shape, and how the configurations are actually found

[`ModuleApplicationDbContext`](#moduleapplicationdbcontext)
(`MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:22`) is the
Conference module's abstract `DbContext`. It does one job: declare 17 `internal DbSet<T>` properties
(`Events`, `Rooms`, `EventSpeakers`, `EventQuestionAnswers`, `Sessions`, `SessionSpeakers`,
`SessionQuestionAnswers`, `SessionCategoryItems`, `Speakers`, `SpeakerCategoryItems`, `Categories`,
`CategoryItems`, `Questions`, `Sponsors`, `Partners`, `Activities`, `SessionAssets`, at
`ModuleApplicationDbContext.cs:30-78`). It is **abstract** and inherits from the Common
[`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) through its primary
constructor (`ModuleApplicationDbContext.cs:22-27`), from which it gets the real machinery: the
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
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:823-853`,
with the engine-to-interface switch at `:612-618` and the registry filter at `:625-636`). That is why two
entities with a configuration here, [`SessionAiScore`](group-17-conference-domain.md#sessionaiscore) and
[`SpeakerQuestionAnswer`](group-17-conference-domain.md#speakerquestionanswer), are mapped and queryable
through the repository layer even though `ModuleApplicationDbContext` declares no `DbSet` for either:
19 configurations, 17 `DbSet`s, and the configurations win. `[Rubric §7, Microservices Readiness]` (can a
module become its own service without a rewrite?) is embodied here: the Conference module already runs as
`MMCA.ADC.Conference.Service` over its own `ADC_Conference` database
(`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:32`) with its own outbox, and cross-module
references (a speaker's linked user, a bookmark's session) are scalar columns resolved via gRPC and
integration events, never cross-database foreign keys.

## Seeding: two real events always, sample data only in dev and CI

[`ConferenceModuleDbSeeder`](#conferencemoduledbseeder)
(`MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:27`)
derives from the framework's [`DbSeeder`](group-07-persistence-ef-core.md#dbseeder) and runs after schema
initialization, constructed by [`ConferenceModuleSeeder`](group-20-conference-api-grpc.md#conferencemoduleseeder)
in the API layer (`MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:28`). It is idempotent: every step
first issues an `ExistsAsync` check through the repository and returns early if the row is present
(`ConferenceModuleDbSeeder.cs:79`, `:114`, `:149`), which is what makes it safe to run on every
startup under the production `Migrate` init strategy
([ADR-030](https://ivanball.github.io/docs/adr/030-startup-sole-migrator.html)). It **always** seeds three
things (`ConferenceModuleDbSeeder.cs:55-57`): the **2026 Atlanta Cloud + AI Conference** (2026-05-30,
`America/New_York`, Sessionize code `z1ecmzux`, `ConferenceModuleDbSeeder.cs:89-94`), the **2026 Atlanta
Developers Conference** (2026-10-17, Sessionize code `sf1nopko`, `ConferenceModuleDbSeeder.cs:124-129`),
both published immediately after creation (`:104` and `:139`) and both carrying the shared venue address,
map URL and their own published sponsorship-packet URL (`ConferenceModuleDbSeeder.cs:29-47`), and the
fixed set of **10 feedback questions** (5 session ratings plus a session comment, 3 conference ratings
plus a conference comment, `ConferenceModuleDbSeeder.cs:157-169`) whose ids start at
[`QuestionInvariants`](group-17-conference-domain.md#questioninvariants)`.ManualIdRangeStart`
(`ConferenceModuleDbSeeder.cs:171`) so they never collide with imported data. The Cloud + AI existence
check matches the pre-rename seed name as well as the current one, so a database seeded before the event
was renamed still resolves and is not seeded twice (`:78-80`).

It **conditionally** seeds six more things (`ConferenceModuleDbSeeder.cs:59-67`): two sample speakers
(Ada Lovelace and Alan Turing, `:199-200`), two sample sessions with app-assigned ids from
[`SessionInvariants`](group-17-conference-domain.md#sessioninvariants)`.ManualIdRangeStart`, one per
seeded event (`:257-258`, and the ids are explicit because a Session's int PK *is* its Sessionize id, so
the sample rows take a reserved range above any real one), the EventSpeaker plus
SessionSpeaker links between them (`:325-326`), four sample sponsors across the Platinum, Gold, Silver
and Community tiers, two of them exhibitors with booth numbers (`:364-369`), four sample
[`Partner`](group-17-conference-domain.md#partner) rows, three on the Developers edition (two
`Community` and one `Special`) and one on the Cloud + AI edition, so the landing-page partner band
renders fully in dev and CI and the organizer list has a row whichever event its filter defaults to
(`:416-418`, `:424-429`), and three sample social
activities (a pre-conference party the evening before the Developers Conference, a morning coffee
connect, and an after-party) whose event-local wall-clock times are anchored on each event's own start
date (`:478-479`, `:481-496`). All of that runs only when `includeSampleData` is set. The flag comes from
`Seeding:IncludeSampleConferenceData` (`MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:26`), which the
local Aspire AppHost sets (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:163`) and production
leaves unset. The reason is documented in the seeder's own remarks
(`ConferenceModuleDbSeeder.cs:14-26`): the public-browse E2E tests need at least one session and one
speaker row to exist deterministically, while production's real sessions and speakers arrive through the
Sessionize import. The links are created on *both* paths deliberately, so the direct (EventSpeaker) and
the transitive (SessionSpeaker) branches of the speakers-by-event filter are both exercised in dev and CI
(`ConferenceModuleDbSeeder.cs:322-324`).

## The Sessionize adapter

[`SessionizeService`](#sessionizeservice)
(`MMCA.ADC.Conference.Infrastructure/Events/Sessionize/SessionizeService.cs:12`) is a deliberately thin HTTP
client: the whole class is one method (`SessionizeService.cs:15`). Given a Sessionize event code it
builds the relative URI `{code}/view/All` (`SessionizeService.cs:32`), calls `GetAsync`, asserts success
with `EnsureSuccessStatusCode` (`SessionizeService.cs:37`), and deserializes into the
[`SessionizeResponse`](group-18-conference-application.md#sessionizeresponse) model owned by the
Application layer (`SessionizeService.cs:39-41`). Unlike the AI adapter it **does** throw on a bad
status, because the import use-case that calls it is a foreground operation with a caller waiting on the
result. One thing it does *not* throw on is a malformed event code: the method re-checks the code
against `SessionizeCodeFormat.IsValid` and returns an `Error.Invariant` failure
[`Result`](group-01-result-error-handling.md#result) instead of calling out
(`SessionizeService.cs:23-30`). The comment above it states the threat in full
(`SessionizeService.cs:17-22`): the code becomes the leading segment of a relative URI resolved against
the configured base address, and RFC 3986 reads `//host/path` as a network-path reference, so an
unchecked code would redirect the request to a foreign host whose JSON is then imported as speakers,
sessions and rooms. The request validators already enforce the charset at the boundary, and this is the
second layer that also covers a code written to the database before that rule existed: `[Rubric §11,
Security]` defence in depth on an outbound call. It is registered as a typed `HttpClient` in
[`DependencyInjection`](#dependencyinjection) with the base address `https://sessionize.com/api/v2/`
baked in (`MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:32-34`), so it inherits the standard Aspire
resilience handler (Polly retry, timeout, circuit breaker) unchanged: `[Rubric §29, Resilience &
Business Continuity]`, the [ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)
policy that every outbound client gets resilience by default. The thinness is intentional: parsing,
mapping, and the import workflow live in Application use-cases, and this adapter owns only the wire call.

## The AI scoring adapter and its response guardrail

[`SessionScoringService`](#sessionscoringservice)
(`MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/SessionScoringService.cs:46`) is the richer of the
two adapters: it scores one session proposal against a Program Committee rubric. It owns no transport at
all and names no vendor. It takes an `IChatClient` (`SessionScoringService.cs:47`), a
[`PromptContract`](group-27-common-ai-integration.md#promptcontract) (`:48`) and a logger (`:49`), and the
model, the output ceiling, the per-call timeout and the tool gate are configuration under the `Ai` section
handled by the framework's governed chat client in MMCA.Common.AI (`SessionScoringService.cs:12-17`,
[ADR-111](https://ivanball.github.io/docs/adr/111-ai-session-scoring-governance.html)). What stays here is
the part only this module can know: the prompt, the delimited envelope, the output schema and the scoring
arithmetic. Two duties that used to live in this class have left it for the governed pipeline, and the
remarks record both: contact-detail redaction is the framework's
[`PiiRedactionGuardrail`](group-27-common-ai-integration.md#piiredactionguardrail), so it is a policy the
feature cannot bypass rather than a step this service has to remember (`:29-35`), and validating the
answer is [`SessionScoreResponseGuardrail`](#sessionscoreresponseguardrail)'s (`:36-44`). It implements
[`IAiScoringService`](group-18-conference-application.md#iaiscoringservice) (`:49`), and one scoring call
is `ToChatOptions()` off the contract plus two request-specific settings, a 256-token output ceiling
(`:70`, `:115`) that `Ai:MaxOutputTokens` clamps again at the framework boundary (`:66-68`), and
`ChatResponseFormat.ForJsonSchema(ScoreSchema)` (`:116`), then a single `GetResponseAsync` with the user
message (`:118-121`).

The chat client is nullable **on purpose**, and that is the whole disabled path: it is resolved with
`GetService` rather than `GetRequiredService`, because the framework registers no client when `Ai:Enabled`
is false, so a host with no AI configured still starts and still serves every other Conference endpoint
while scoring answers a failed result and calls nothing (`SessionScoringService.cs:21-26`, `:102-106`, and
the registration comment at `DependencyInjection.cs:42-46`). The rest of the contract is equally precise
about failure: it **never throws for a scoring failure**, but **cancellation propagates** (`:18-19`). A
[`ChatGuardrailException`](group-27-common-ai-integration.md#chatguardrailexception) raised by a registered
guardrail is caught on its own so the log line carries the reason the guardrail reported (`:125-133`),
every other failure (no client, unparseable JSON, a partial score object, any other exception) funnels into
`FailedResult`, which returns zero scores with `Success = false` (`:344-357`), and the catch filter
`when (ex is not OperationCanceledException)` (`:134`) lets host shutdown unwind. That split matters because
scoring runs a whole event: one bad proposal must not abort the pass, but a deploy must still be able to
stop it.

The prompt is a **versioned contract**, not a string constant, and that is what makes a score reproducible.
`SessionScoringContract` is a static `PromptContract` built from the prompt name `session-scoring` (`:56`),
the dated version `2026-09-04.1` (`:219`), the pinned model `claude-haiku-4-5` (`:63`) and the system brief
(`:223-249`), assembled at `:92-93`, and the service reports `ModelId` and `PromptVersion` by reading them
back off that contract so the two can never disagree (`:73`, `:84`, `:216-218`). The framework hashes the
contract and stamps the hash on every request, which is what the golden evaluation gate keys on; the
remarks state the rule that any edit to the system prompt, the user-prompt builder, the speaker formatting
or the schema must bump the version, so an unversioned edit fails a test instead of quietly re-basing scores
already on the dashboard (`:76-83`). `RenderPrompt` exposes the exact prompt pair without calling a model
(`:325-332`) so that suite can hash it offline.

The output is **schema-constrained rather than parsed out of prose**. `BuildScoreSchema()` emits a JSON
Schema naming the six criteria as numbers, a `penalty` restricted to `0`, `0.5` or `1`, and a `reasoning`
string, with `additionalProperties = false` and every field required
(`SessionScoringService.cs:362-393`); it is built once into the static `ScoreSchema` (`:360`) and rides the
request's response format (`:116`). The wire shape now has a file of its own:
[`AiScoreResponse`](#aiscoreresponse)
(`MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AiScoreResponse.cs:22`) is an `internal sealed record`
whose six sub-scores and penalty are **nullable** so a partial object is detectable rather than silently
defaulting to zero (`AiScoreResponse.cs:28-57`), and it carries the one `JsonOptions` instance (`:25`) and
an `IsComplete` check (`:63-70`). It lives beside the scorer rather than inside it because two readers need
it, and one declaration means the guardrail cannot drift from what the scorer would accept
(`AiScoreResponse.cs:14-20`). The scorer's own share is a single `JsonSerializer.Deserialize<AiScoreResponse>`
call (`SessionScoringService.cs:164`), a property pattern that fails a partial object (`:177-189`), and the
documented weighted sum (topic 30%, description 10%, novelty 20%, takeaways 20%, depth 10%, credibility
10%) minus the penalty (`:191-204`), with every value clamped to `[1.0, 10.0]` and rounded to one decimal
with banker's rounding (`:342`). Its `JsonException` catch is kept as the fail-closed path for a caller that
composes the scorer **without** the governed pipeline, as the golden replay suite does (`:159-170`). The
Application layer sees only
[`SessionScoringResult`](group-18-conference-application.md#sessionscoringresult).

[`SessionScoreResponseGuardrail`](#sessionscoreresponseguardrail)
(`MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/SessionScoreResponseGuardrail.cs:34`) is the response
half of that boundary, an [`IChatGuardrail`](group-27-common-ai-integration.md#ichatguardrail) the governed
pipeline runs on every call. It moved out of the scorer for the reason the redaction did: a rule a feature
applies to itself is a rule a second call site can forget, while a registered guardrail cannot be bypassed
by a caller (`SessionScoreResponseGuardrail.cs:15-21`). `InspectResponseAsync` (`:74-82`) answers a
[`GuardrailVerdict`](group-27-common-ai-integration.md#guardrailverdict) that blocks three shapes, each
with a public reason constant: a refusal, detected from both the normalized `ChatFinishReason.ContentFilter`
and the provider's raw `refusal` value so a mapping change on either side cannot turn a refusal into an
unparseable answer (`:94-100`, `:125-134`, reason `:40-41`), an empty answer (`:102-106`, `:44-45`), and
text that does not deserialize to an `AiScoreResponse` or deserializes without `IsComplete`
(`:108-122`, `:51-52`). It is **scoped** to the session-scoring prompt by reading the name off the
request's prompt contract and comparing it to `SessionScoringService.PromptName` (`:62-63`), because "the
answer must be a score object" is false of every other AI call a host might add later, and an unscoped rule
would block the first one (`:23-26`). The request side and streamed updates always allow (`:66-71`,
`:84-90`): it has nothing to say about what goes out, and a per-fragment JSON rule would refuse every
well-formed answer before it finished arriving (`:28-31`).

The prompt itself is treated as an attack surface, which is the `[Rubric §11, Security]` story here
alongside the obvious one (the credential is configuration the framework reads, never a literal in this
file), and it is also where `[Rubric §16, AI-Native]` is most concrete. Everything a speaker typed arrives
through a public call-for-papers form, so the user message is a delimited envelope (`<session_proposal>`
with `<session_title>`, `<session_description>` and a `<speakers>` block,
`SessionScoringService.cs:278-315`) rather than labelled lines, because labelled lines gave a submission no
boundary to be contained by (`:273-277`). Angle brackets in every submitted value are escaped so a
submission cannot forge a delimiter, a typed `</session_title>` arriving as `&lt;/session_title&gt;`
(`:334-340`). Speaker names are deliberately left intact because they are the published conference record
and the only evidence the credibility criterion has (`:300-303`); emails and phone numbers are stripped by
the framework guardrail on the assembled message, and a proposal's instruction-override phrase is
neutralized before the call by the framework's
[`ContentPolicyGuardrail`](group-27-common-ai-integration.md#contentpolicyguardrail) under
`Ai:ContentPolicy` (`DependencyInjection.cs:90-96`). The system brief carries a matching
`UntrustedInputBrief` constant (`SessionScoringService.cs:264-271`) that declares the tagged content data
rather than instructions and routes an injection attempt to the existing 1.0 penalty, which gives the model
a rule to apply instead of a judgement call to make (`:256-261`).

`[Rubric §13, Observability & Operability]` and `[Rubric §31, Cost/FinOps]` meet in the usage path, and
the split of duties there is worth reading. The **aggregate** is the framework's: the governed pipeline's
usage-recording chat client reports `mmca.ai.input_tokens` and `mmca.ai.output_tokens` on the
`MMCA.Common.AI` meter, tagged by model, prompt name, prompt version and provider, which is why the prompt
contract's identity is a first-class value here rather than a log string
(`SessionScoringService.cs:143-145`, `:51-56`). What this adapter keeps is per-session forensics: when the
response carries a usage block it logs the input and output token counts against the session id
(`:146-149`). Two `[LoggerMessage]` source-generated methods carry the log half, a warning naming the
session id and the failure reason, and that information line (`:395-399`).

## The scoring run is durable now, and this layer keeps one adapter inside it

A multi-minute paid AI pass triggered from an HTTP POST used to be this chapter's biggest piece of
machinery: a hosted `BackgroundService` draining an in-memory queue, plus a five-minute cron sweep that
re-queued whatever a crash had cut in half. Both are gone from this assembly, and the registration comment
says why in one line: the framework's internal-command processor owns the durability, the claim lease and
the retry backoff now (`DependencyInjection.cs:52-56`,
[ADR-114](https://ivanball.github.io/docs/adr/114-internal-commands-durable-job-queue.html)). The organizer's
POST schedules a `ScoreEventSessionsInternalCommand` through `IInternalCommandScheduler` and returns
`202 Accepted`
(`MMCA.ADC.Conference.API/Controllers/Sessions/SessionSelectionController.cs:38,132-134,144`), the row is
persisted, and
[`ScoreEventSessionsInternalCommandHandler`](group-18-conference-application.md#scoreeventsessionsinternalcommandhandler)
in the Application layer runs the pass. Cross-replica exclusion did not disappear with the drain, it moved:
the handler takes an [`IDistributedLock`](group-05-cqrs-pipeline.md#idistributedlock) claim on the event
with a 15-minute time-to-live and a zero wait, so the loser of a duplicate trigger logs and succeeds
instead of paying for the same pass twice
(`MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/ScoreEventSessionsInternalCommandHandler.cs:14-21,56,63`).
`[Rubric §29, Resilience & Business Continuity]` reads better for it: durability is one framework
capability rather than a per-module queue plus a per-module sweep.

What this layer keeps is the one step the Application layer cannot take.
[`OutputCacheSessionScoresCacheEvictor`](#outputcachesessionscorescacheevictor)
(`MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/OutputCacheSessionScoresCacheEvictor.cs:17`)
implements the Application-owned port
[`ISessionScoresCacheEvictor`](group-18-conference-application.md#isessionscorescacheevictor) over the
host's `IOutputCacheStore`, because an internal command handled in Application cannot see ASP.NET's output
cache (`DependencyInjection.cs:52-54`). Its whole body is one call, and the value is in *which tag* it
evicts: the narrow `conference:sessions` rather than the root `conference` tag every Conference policy
carries (`OutputCacheSessionScoresCacheEvictor.cs:20,23-24`). The remarks record the production reason
(`:9-15`): scoring writes session scores and nothing else, and evicting the root flushed events, speakers,
rooms, categories and questions too, so an organizer triggering a scoring run during the event emptied the
whole public read surface onto the Basic-tier database twice while attendees were browsing. `[Rubric §12,
Performance & Scalability]` and `[Rubric §31, Cost/FinOps]` both live in that one constant
([ADR-026](https://ivanball.github.io/docs/adr/026-caching-strategy.html),
[ADR-040](https://ivanball.github.io/docs/adr/040-authenticated-output-caching-for-public-reads.html)).

## DI wiring, and what it deliberately no longer registers

[`DependencyInjection`](#dependencyinjection)
(`MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:18`) is a single
`extension(IServiceCollection)` block (the codebase's standard DI-registration idiom, taught in the
primer, `DependencyInjection.cs:20-133`) exposing three methods. The module method,
`AddModuleConferenceInfrastructure()` (`DependencyInjection.cs:26-60`), registers exactly three things:
the Sessionize typed `HttpClient` with its base address baked in (`:32-34`), which takes Aspire's standard
resilience handler unchanged
([ADR-009](https://ivanball.github.io/docs/adr/009-resilience-and-recovery-objectives.html)); the scoring
adapter, constructed by hand as a scoped `IAiScoringService` so it can be handed
`GetService<IChatClient>()` and the static `SessionScoringContract` (`:47-50`); and the output-cache
evictor as a scoped `ISessionScoresCacheEvictor` (`:57`). Both adapters use `TryAdd`, so a host or a test
can substitute either before this call runs.

The other two methods exist because of an ordering rule the module method cannot honor.
`AddConferenceAiGuardrails(IConfiguration)` (`DependencyInjection.cs:85-102`) is the **single composition
point** for every guardrail the Conference AI pipeline runs: the framework's `PiiRedactionGuardrail` and
`ContentPolicyGuardrail` on the request side (`:95-96`) and this module's response guardrail (`:99`).
The remarks give the reason it exists: when each caller assembled its own list, the golden replay suite
drove the scorer bare and the live judge registered one of the three, so the evaluation tiers were judging
a different pipeline from the deployed one; one method shared by the host and every tier means a new
guardrail reaches the gates automatically (`:70-76`). Registering either request-side guardrail also
satisfies `Ai:RequireGuardrail`, which defaults to true (`:93-94`). It must run **before**
`AddMmcaChatClient`, which reads the `IChatGuardrail` descriptors to decide whether to compose the
guardrail layer at all, so a later registration would be silently absent (`:78-82`), and the Conference
service host calls the two in exactly that order
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:150,152`).
`AddSessionScoreResponseGuardrail()` (`DependencyInjection.cs:124-132`) registers the one policy with
`TryAddEnumerable` as a singleton `IChatGuardrail` (`:128-129`), so it stacks with the framework's
guardrails instead of replacing them and a second call composes nothing twice (`:111-115`); it stays public
for a caller that wants only the response gate (`:117-122`).

The three registrations that are **absent** teach as much as the ones that are present, and each left a
comment behind. The provider error classifiers this module used to own (a unique-constraint detector and a
concurrency-conflict detector) are framework surface now, registered by MMCA.Common's `AddInfrastructure`
(`DependencyInjection.cs:28-31`). No `HttpClient` is constructed for the AI provider and no vendor is
named: the transport, the credential, the model, the output ceiling, the per-call timeout and the tool gate
belong to the governed `IChatClient` configured under the `Ai` section and registered by the host's
`AddMmcaChatClient` call over whichever provider adapter `Ai:Provider` names (`:36-40`). And the hosted
drain plus the five-minute crash-recovery sweep are gone entirely (`:52-56`). That is the shape of a
healthy module wiring file: every line in it is something only this module can know.

## How it fits together at runtime

Three flows tie the chapter together. **Persistence flow:** a Conference command handler mutates an
aggregate and the unit of work saves; that resolves the concrete `SQLServerDbContext` over the
`ADC_Conference` database, whose model was built from the configurations registered here (lengths,
indexes, relationships, precision), stamps audit fields, hides deleted rows behind the global filters,
and captures domain events into the per-database outbox, all in one transaction. **Import flow:** an
organizer triggers a Sessionize refresh; the Application use-case calls
[`ISessionizeService`](group-18-conference-application.md#isessionizeservice), the typed `HttpClient`
adapter makes the outbound call inside the default Polly pipeline, and the parsed `SessionizeResponse`
flows back for mapping. **Scoring flow:** the organizer POSTs to the scoring endpoint, the controller only
schedules a `ScoreEventSessionsInternalCommand` and returns `202 Accepted`
(`MMCA.ADC.Conference.API/Controllers/Sessions/SessionSelectionController.cs:132-134,144`), the framework's
internal-command processor picks the persisted row up on one of the replicas, and the Application handler
evicts the sessions cache tag through
[`OutputCacheSessionScoresCacheEvictor`](#outputcachesessionscorescacheevictor), claims the event's
distributed lock, calls [`SessionScoringService`](#sessionscoringservice) once per session through the
governed chat client (whose request-side guardrails strip contact details and neutralize an
instruction-override phrase, and whose [`SessionScoreResponseGuardrail`](#sessionscoreresponseguardrail)
refuses any answer that is not a complete score object), persists one `SessionAiScore` row per session behind the unique filtered index, and
evicts the tag again; if that run dies mid-pass, the command row is still there and the processor replays
it under its own backoff and attempt ceiling. The two marker types in this assembly,
[`AssemblyReference`](#assemblyreference) and [`ClassReference`](#classreference)
(`MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:5` and
`MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:11`), exist purely so the module loader and the
configuration-assembly scan can reach this assembly by a stable `typeof()` handle instead of a hard-coded
type list, the same extension point every module assembly provides.

### AssemblyReference

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/AssemblyReference.cs:5` · Level 0 · class (static)

- **What it is**: the assembly-marker type for the Conference Infrastructure assembly: a stable handle that reflection-based scanning can hold instead of a hard-coded assembly name string.
- **Depends on**: `System.Reflection` only. No first-party types.
- **Concept**: cross-reference the framework explanation under [AssemblyReference](group-17-conference-domain.md#assemblyreference-classreference) in the Conference Domain chapter; every layer of every module ships an identical pair, and the [module system](group-14-module-system-composition.md#assemblyreference) chapter teaches why.
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

### AiScoreResponse

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Sessions.Scoring` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/AiScoreResponse.cs:22` · Level 0 · record (internal sealed)

- **What it is**: the structured-output object a session-scoring call asks the model for, in the shape [SessionScoringService](#sessionscoringservice)'s score schema declares. Six weighted sub-scores, a penalty, and a free-text `reasoning` line.
- **Depends on**: no first-party types (its two readers depend on it, not the other way around). External: `System.Text.Json.Serialization.JsonPropertyName`, `System.Text.Json.JsonSerializerOptions`.
- **Concept introduced, one declaration shared by two readers.** The type used to be a private record nested inside the now-removed `AnthropicScoringService`; it is now its own top-level `internal sealed record` in its own file, and its XML remarks (`:50-56`) say why: two readers need it, [SessionScoringService](#sessionscoringservice), which maps a complete object onto a [SessionScoringResult](group-18-conference-application.md#sessionscoringresult), and [SessionScoreResponseGuardrail](#sessionscoreresponseguardrail), which refuses an incomplete one at the pipeline boundary. One declaration of the shape means the guardrail cannot drift from what the scorer would accept, and the JSON schema is still declared exactly once, on the scorer. `[Rubric §3, Clean Architecture]` assesses whether external contracts stay out of inner layers: the Application layer only ever sees `SessionScoringResult`, never the model's wire shape. `[Rubric §32, Dependency & Supply-Chain]` assesses how a third-party API dependency is isolated: if the model's envelope changes shape, only this one file and its readers change.
- **Walkthrough**: a `static` `JsonOptions` property (`:61`, `PropertyNameCaseInsensitive = true`) both readers deserialize with. Eight `init` properties (`:64-93`), each carrying an explicit `[JsonPropertyName]`. `Penalty` (`:65`) and the six criterion scores (`TopicRelevance` `:69`, `DescriptionQuality` `:73`, `Novelty` `:77`, `ActionableTakeaways` `:81`, `DepthOrInsightQuality` `:85`, `CredibilityExperience` `:89`) are **`decimal?`**, not `decimal`: nullability is what makes a *partial* model response detectable. `Reasoning` (`:93`) stays `string?`, the only genuinely optional field. `IsComplete` (`:99-106`) is a computed `internal bool`: `true` only when the penalty and all six sub-scores are non-null; reasoning is deliberately not required, matching the scorer's own acceptance rule.
- **Why it's built this way**: making the score fields nullable turns "the model returned four of six scores" into a detectable parse failure rather than a plausible-looking but wrong row in [SessionAiScore](group-17-conference-domain.md#sessionaiscore); computing `IsComplete` once on the record itself, rather than re-deriving the same null-check twice, is what lets the scorer and the guardrail agree on "complete" without sharing any other code.
- **Where it's used**: [SessionScoringService](#sessionscoringservice)`.ParseSingleScore` (`:304`) deserializes into it and builds a `SessionScoringResult` from it; [SessionScoreResponseGuardrail](#sessionscoreresponseguardrail)`.Inspect` (`:585`) deserializes into it and reads `IsComplete` to decide whether to allow or block the response.

---

`[Rubric §16, AI-Native Application Architecture]` applies: this type is part of the AI session-scoring feature (a model call behind a port, versioned prompt and model, an evaluation gate, metered spend; ADR-111).

### OutputCacheSessionScoresCacheEvictor

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Sessions.Scoring` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/OutputCacheSessionScoresCacheEvictor.cs:17` · Level 1 · class (sealed)

- **What it is**: the Infrastructure adapter for [ISessionScoresCacheEvictor](group-18-conference-application.md#isessionscorescacheevictor), evicting the output-cache tag that fronts session score reads after a scoring pass writes fresh scores.
- **Depends on**: first-party: [ISessionScoresCacheEvictor](group-18-conference-application.md#isessionscorescacheevictor) (implements). External: `Microsoft.AspNetCore.OutputCaching.IOutputCacheStore`.
- **Concept**: the same dependency-inversion shape taught under [SessionScoringService](#sessionscoringservice) and [SessionizeService](#sessionizeservice): Application declares the port, Infrastructure supplies the concrete ASP.NET Core dependency. The DI registration comment (`DependencyInjection.cs:52-56`) is explicit about why the port exists at all: the internal-command handler that runs a scoring pass lives in the Application layer, which cannot see `IOutputCacheStore` directly.
- **Walkthrough**: a primary constructor injects `IOutputCacheStore` (`:17`). `SessionsCacheTag` (`:20`) is the private constant `"conference:sessions"`, the tag Conference's session-read output-cache policies are registered under. `EvictAsync` (`:23-24`) is a one-line expression body that calls `outputCacheStore.EvictByTagAsync(SessionsCacheTag, cancellationToken)` and returns the `ValueTask` directly, no `await` needed.
- **Why it's built this way**: a single-method adapter keeps the output-cache API entirely out of Application, matching the boundary every other Infrastructure adapter in this chapter draws.
- **Where it's used**: registered by [DependencyInjection](#dependencyinjection) (`services.TryAddScoped<ISessionScoresCacheEvictor, OutputCacheSessionScoresCacheEvictor>()`); called by the scoring pass's internal-command handler once a batch has written new `SessionAiScore` rows, so a cached session-score read never outlives the scores it summarizes. Exercised directly by `OutputCacheSessionScoresCacheEvictorTests`.

---

### SessionScoringService

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Sessions.Scoring` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/SessionScoringService.cs:46` · Level 3 · class (sealed partial)

- **What it is**: the replacement for the removed `AnthropicScoringService`. It implements [IAiScoringService](group-18-conference-application.md#iaiscoringservice) by scoring one session proposal against a Program Committee rubric through the framework's governed `IChatClient` (`MMCA.Common.AI`), rather than by calling a named vendor's HTTP API directly. The governance around it (prompt versioning, the golden evaluation suite, the injection posture) is recorded in [ADR-111](https://ivanball.github.io/docs/adr/111-ai-session-scoring-governance.html); the boundary that put the chat client itself behind a framework port is [ADR-120](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html).
- **Depends on**: first-party: [IAiScoringService](group-18-conference-application.md#iaiscoringservice) (implements), [SessionScoringInput](group-18-conference-application.md#sessionscoringinput), [SessionScoringResult](group-18-conference-application.md#sessionscoringresult), [SpeakerInfo](group-18-conference-application.md#speakerinfo), [PromptContract](group-27-common-ai-integration.md#promptcontract) (constructor parameter and the source of `PromptVersion`), and [AiScoreResponse](#aiscoreresponse) (own file now, not a nested record). External: `Microsoft.Extensions.AI` (`IChatClient`, `ChatMessage`, `ChatResponse`, `ChatOptions`, `ChatGuardrailException`), `ILogger<T>`, `System.Text.Json`, `System.Globalization`.
- **Concept introduced, the module supplies only the prompt, the framework supplies the vendor.** `[Rubric §3, Clean Architecture]` and `[Rubric §1, SOLID]` (dependency inversion) assess whether inner layers depend on abstractions rather than vendors: this class constructs no `HttpClient` and names no vendor anywhere in its own code, it depends on `IChatClient`, the framework's own port. `[Rubric §16, AI-Native Application Architecture]` assesses whether model interaction is versioned, constrained and evaluable: `PromptVersion` (`:224`), the `SessionScoringContract` static (`:232-233`) and `PromptVersionValue` (`:359`, format `yyyy-MM-dd.N`) are the versioning story; the golden evaluation suite pins the rendered prompt by hash per version. `[Rubric §29, Resilience & Business Continuity]` assesses graceful degradation: an unconfigured client (`:242-246`), a guardrail block (`:265-273`), and any other non-cancellation exception (`:274-278`) all converge on `FailedResult`, so one bad proposal cannot abort a batch.
- **Walkthrough**
  - A **primary constructor** injects `IChatClient? chatClient`, `PromptContract promptContract` and `ILogger<SessionScoringService>` (`:186-189`). `IChatClient` is resolved with `GetService`, not `GetRequiredService`, by [DependencyInjection](#dependencyinjection), so a host with AI disabled or no key still starts.
  - `PromptName` (`:196`, `"session-scoring"`) tags every usage measurement on the `MMCA.Common.AI` meter. `ModelIdValue` (`:203`, `"claude-haiku-4-5"`) is pinned into the prompt contract's hash. `MaxOutputTokens` (`:210`, `256`) is the class's own default that `Ai:MaxOutputTokens` clamps again at the framework boundary. `SessionScoringContract` (`:232-233`) is the one static [PromptContract](group-27-common-ai-integration.md#promptcontract) the module scores with, built from those constants plus `SystemPrompt`; composition passes it to the constructor so a test can score against a different contract without touching the registration.
  - `ScoreSessionAsync` (`:236`) null-checks `session` (`:240`), then guards on a disabled client (`:242-246`, log-and-`FailedResult`), builds the user message with `BuildUserPrompt` (`:250`), then asks the contract for its `ChatOptions` (`:254`) and layers on `MaxOutputTokens` (`:255`) and a JSON-schema `ResponseFormat` built from `ScoreSchema` (`:256`). `chatClient.GetResponseAsync` sends one user `ChatMessage` (`:258-261`). A caught `ChatGuardrailException` (`:265-273`) logs the guardrail's own reported reason and returns `FailedResult`; any other non-cancellation exception does the same (`:274-278`).
  - `InterpretResponse` (`:281`) logs usage from `response.Usage` when present (`:286-289`), then hands `response.Text` straight to `ParseSingleScore` (`:294`): refusals, empty answers and malformed text are already refused upstream by [SessionScoreResponseGuardrail](#sessionscoreresponseguardrail), so this method's own job is parse and map.
  - `ParseSingleScore` (`:297-311`) deserializes `responseText` into [AiScoreResponse](#aiscoreresponse) with `AiScoreResponse.JsonOptions` (`:304`) and passes it to `BuildResult`; a `JsonException` is the fail-closed path for a caller that composed the scorer without the governed pipeline, such as the golden replay suite (`:307-310`).
  - `BuildResult` (`:313`) requires the penalty and all six sub-scores present via a single `is not { ... }` pattern (`:317-329`); the overall score is weighted 30/10/20/20/10/10 (`:333-339`) and the penalty subtracted (`:344`), with every value passed through `Clamp` (`:482`), `Math.Clamp(value, 1.0m, 10.0m)` rounded to one decimal with `MidpointRounding.ToEven`.
  - `SystemPrompt` (`:363`) carries the ADC track list, the six weighted criteria, calibration rules ("most talks should fall between 5.5 and 7.5"), and the 0.0/0.5/1.0 penalty ladder, ending with `UntrustedInputBrief` (`:389`, `:404-411`), an `internal const` kept separate only so the evaluation suite can assert on it by name.
  - `BuildUserPrompt` (`:418`) is the containment half: a delimited, escaped envelope (`<session_proposal>`, `<session_title>`, `<session_description>`) rather than labelled `Title:`/`Description:` lines, with the reasoning recorded at `:413-417`. `FormatSpeakers` (`:429`) renders each speaker's name, tagline and bio inside `<speaker>` tags, or the literal `<speakers>(no speaker information available)</speakers>` when there are none (`:431-432`). `Escape` (`:477-480`) replaces `<` and `>` with entities.
  - `RenderPrompt` (`:465`) is the one public affordance for testing: the exact system-plus-user pair this service would send without calling the model, so the evaluation suite can hash it per `PromptVersion`.
  - `FailedResult` (`:484`, tail not shown) is the single shape of failure, matching the prior adapter's contract.
- **Why it's built this way**: concentrating vendor specifics behind `IChatClient` makes swapping providers or faking the service in tests a one-class change; the never-throw-for-scoring, clamp, and all-or-nothing-parse discipline makes raw model output safe to persist into [SessionAiScore](group-17-conference-domain.md#sessionaiscore). Moving [AiScoreResponse](#aiscoreresponse) to its own file, rather than nesting it as before, is what lets [SessionScoreResponseGuardrail](#sessionscoreresponseguardrail) share the exact same shape and completeness check.
- **Where it's used**: registered as the `IAiScoringService` implementation by [DependencyInjection](#dependencyinjection); driven per session by [ScoreEventSessionsHandler](group-18-conference-application.md#scoreeventsessionshandler). Exercised directly by `SessionScoringServiceTests`, `SessionScoreResponseGuardrailTests`, and through `RenderPrompt` by the `MMCA.ADC.Conference.Scoring.Evaluation.Tests` project (`PromptContractTests`, `GoldenReplayTests`, `LiveJudgeTests`).
- **Caveats / not-in-source**: there is **no retry inside this class**. Whatever resilience the chat call carries is the framework's `IChatClient` pipeline's concern, configured where `AddMmcaChatClient` is called; the in-class contract stays "never throw for a scoring failure, let the batch continue".

---

### SessionScoreResponseGuardrail

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Sessions.Scoring` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Sessions/Scoring/SessionScoreResponseGuardrail.cs:34` · Level 4 · class (sealed)

- **What it is**: an `IChatGuardrail` that refuses a session-scoring response before it reaches [SessionScoringService](#sessionscoringservice), for three cases: a provider refusal, an empty answer, or text that is not a complete [AiScoreResponse](#aiscoreresponse).
- **Depends on**: first-party: `IChatGuardrail` (implements), [AiScoreResponse](#aiscoreresponse), `PromptContract` (`ReadName`), [SessionScoringService](#sessionscoringservice)`.PromptName`. External: `Microsoft.Extensions.AI` (`ChatOptions`, `ChatResponse`, `ChatFinishReason`, `GuardrailVerdict`), `System.Text.Json`, `System.Globalization`, `System.Text.CompositeFormat`.
- **Concept introduced, a response-side guardrail scoped to one prompt.** `AppliesTo` (`:534-535`) reads the prompt contract's name off `ChatOptions` and compares it to `SessionScoringService.PromptName`, so this guardrail only ever inspects session-scoring calls and allows everything else through unexamined. `[Rubric §16, AI-Native Application Architecture]` assesses whether an evaluation gate sits at the pipeline boundary rather than inside the caller: the same completeness check the scorer would apply is applied here first, so a malformed answer never reaches [SessionScoringService](#sessionscoringservice) at all. `[Rubric §29, Resilience & Business Continuity]` assesses graceful degradation: three named block reasons (`RefusalReasonFormat` `:512-513`, `EmptyResponseReason` `:516-517`, `MalformedResponseReason` `:523-524`) give the caller a specific, logged reason for every refusal instead of one generic failure.
- **Walkthrough**: `InspectRequestAsync` (`:539-543`) and `InspectStreamedUpdateAsync` (`:558-562`) both always allow, the first because the guardrail has nothing to say about what goes out, the second because the scorer does not stream. `InspectResponseAsync` (`:546-554`) delegates to `Inspect` only `AppliesTo` returns true. `Inspect` (`:564-595`) checks `IsRefusal(response.FinishReason)` first (`:566-572`), then blocks on a null-or-empty `response.Text` (`:575-578`), then deserializes the text into [AiScoreResponse](#aiscoreresponse) with `AiScoreResponse.JsonOptions`, blocking on a `JsonException` (`:583-590`) and on `IsComplete` being false (`:592-594`). `IsRefusal` (`:603-606`) treats both the normalized `ChatFinishReason.ContentFilter` and the raw string `"refusal"` (case-insensitive) as a refusal, because Microsoft.Extensions.AI does not normalize every provider's own refusal signal.
- **Why it's built this way**: pulling the completeness check out to a guardrail, rather than leaving it solely inside the scorer, means the check runs identically for the deployed pipeline and for every evaluation tier that composes guardrails through [DependencyInjection](#dependencyinjection)`.AddConferenceAiGuardrails`, so a guardrail change cannot silently start scoring on incomplete data in one tier and not another.
- **Where it's used**: registered as a singleton `IChatGuardrail` by [DependencyInjection](#dependencyinjection)`.AddSessionScoreResponseGuardrail`, called from `AddConferenceAiGuardrails`. Exercised directly by `SessionScoreResponseGuardrailTests` and by `ConferenceAiGuardrailsRegistrationTests`.

---

### SessionizeService

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Events.Sessionize` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Events/Sessionize/SessionizeService.cs:12` · Level 4 · class (sealed)

- **What it is**: the HTTP implementation of [ISessionizeService](group-18-conference-application.md#isessionizeservice). It calls the Sessionize "View All" endpoint, which returns every session, speaker, room and category for a conference in one document, after validating that the caller-supplied Sessionize code is well-formed.
- **Depends on**: first-party: [ISessionizeService](group-18-conference-application.md#isessionizeservice) (implements), `SessionizeResponse` (return shape), [SessionizeCodeFormat](group-17-conference-domain.md#sessionizecodeformat) (the format validator), `Result<T>` / `Error` (the framework Result pattern). External: `HttpClient`, `System.Net.Http.Json`.
- **Concept introduced, a second-layer format check ahead of a redirect-capable URI segment.** `[Rubric §11, Security]` assesses defense against SSRF-shaped input: `sessionizeCode` becomes the leading segment of a relative URI resolved against the configured Sessionize base address, and the inline `SECURITY` comment (`:14-19`) spells out the exact attack, RFC 3986 resolution reads a code that starts `//host/path` as a network-path reference, so an unchecked code redirects the request to a foreign host whose JSON gets imported as speakers, sessions and rooms. Request validators already enforce the charset at the boundary; this check is deliberately a **second** layer, because it is the one that still covers a code written to the database before that validator rule existed. `[Rubric §2, Design Patterns]` and `[Rubric §1, SOLID]` (dependency inversion) assess whether the application depends on an abstraction it owns: the Application layer declares the port, Infrastructure supplies the adapter, and no Application file references `HttpClient`.
- **Walkthrough**: a primary constructor takes `HttpClient` (`:12`). `GetAllAsync` now returns `Task<Result<SessionizeResponse?>>` rather than a bare nullable task (`:14`). It first checks `SessionizeCodeFormat.IsValid(sessionizeCode)` (`:21`) and, on a bad format, returns `Result.Failure<SessionizeResponse?>` with the invariant error `Event.SessionizeCode.InvalidFormat` (`:22-27`), naming `SessionizeService` as the source and `sessionizeCode` as the target. Past that gate the wire call is unchanged: it builds the relative URI `{sessionizeCode}/view/All` (`:31`), GETs it (`:32-34`), calls `EnsureSuccessStatusCode()` (`:36`), and now wraps the deserialized `SessionizeResponse?` in `Result.Success` (`:38-40`). Both awaits use `.ConfigureAwait(false)`, the repo-wide library rule from [ADR-049](https://ivanball.github.io/docs/adr/049-library-configureawait-policy.html).
- **Why it's built this way**: keeping parsing, mapping and the import workflow in Application use-cases leaves this adapter owning only the wire call and the one input check that only Infrastructure can make (the value that becomes part of a URI), which is what keeps it trivially fakeable in tests.
- **Caveat, error handling still differs from the AI adapter.** `EnsureSuccessStatusCode()` throws `HttpRequestException` on any non-2xx, and that exception **propagates** out of the class, the opposite of [SessionScoringService](#sessionscoringservice)'s never-throw contract; only the new format check returns a `Result` failure instead of throwing. The difference still follows the shape of the work: a Sessionize sync is one explicit organizer action where a failure should surface as an error, while AI scoring is a per-item batch where one item's failure must not stop the rest. The success payload is also nullable, so a 2xx with an empty body yields a successful `Result` wrapping `null` rather than an exception.
- **Where it's used**: the Sessionize import handlers in [Conference Application](group-18-conference-application.md), triggered when an organizer refreshes an event's data.

---

### DependencyInjection

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/DependencyInjection.cs:18` · Level 5 · class (static)

- **What it is**: the DI wiring for Conference Infrastructure. It registers the one remaining outbound HTTP integration (Sessionize) as a typed client, wires the AI scoring adapter against the framework's governed chat client, registers the output-cache eviction adapter the internal-command scoring pass depends on, and composes the three AI guardrails the Conference module runs.
- **Depends on**: first-party: [ISessionizeService](group-18-conference-application.md#isessionizeservice) with [SessionizeService](#sessionizeservice), [IAiScoringService](group-18-conference-application.md#iaiscoringservice) with [SessionScoringService](#sessionscoringservice), [ISessionScoresCacheEvictor](group-18-conference-application.md#isessionscorescacheevictor) with [OutputCacheSessionScoresCacheEvictor](#outputcachesessionscorescacheevictor), `IChatGuardrail` with [SessionScoreResponseGuardrail](#sessionscoreresponseguardrail). External: `Microsoft.Extensions.DependencyInjection`, `Microsoft.Extensions.AI` (`IChatClient`, `IChatGuardrail`).
- **Concept introduced, what moved to the framework and what stayed.** The comment above the Sessionize registration is itself a piece of documentation: provider error classification (`IUniqueConstraintViolationDetector`, `IConcurrencyConflictDetector`) used to be registered by this module and is now framework surface added by MMCA.Common's `AddInfrastructure`. The AI scoring registration comment (`:763-767`) carries the larger version of the same story: the transport, the credential, the model, the output ceiling, the per-call timeout and the tool gate all belong to the framework's governed `IChatClient` now, over whichever provider adapter `Ai:Provider` names, so nothing in this file constructs an `HttpClient` or names a vendor ([ADR-120](https://ivanball.github.io/docs/adr/120-governed-chat-client-boundary.html)). `[Rubric §3, Clean Architecture]` and `[Rubric §7, Microservices Readiness]` assess how cleanly a module's registration surface shrinks as its responsibilities move to shared framework surface without the module losing the ability to run as its own service.
- **Walkthrough**: a single `extension(IServiceCollection services)` block (`:746`, the codebase's standard DI idiom, see the primer's [extension(T) note](00-primer.md#c-extensiont-types-read-this-once)).
  - **`AddModuleConferenceInfrastructure()`** (`:753`): typed client for Sessionize, base address `https://sessionize.com/api/v2/` (`:759-761`); `services.TryAddScoped<IAiScoringService>(serviceProvider => new SessionScoringService(...))` (`:774-777`), a factory registration rather than a constructor-injected `AddHttpClient` pair because [SessionScoringService](#sessionscoringservice) needs `IChatClient` resolved with `GetService` (nullable, the disabled path) alongside `SessionScoringService.SessionScoringContract` and a required `ILogger<SessionScoringService>`; `services.TryAddScoped<ISessionScoresCacheEvictor, OutputCacheSessionScoresCacheEvictor>()` (`:784`), with a comment (`:779-783`) noting the hosted drain and crash-recovery sweep this method used to own are gone, the framework's internal-command processor now owns the durability, claim lease and retry backoff. Returns `services` for chaining (`:786`).
  - **`AddConferenceAiGuardrails(IConfiguration configuration)`** (`:812`): the single composition point for the Conference AI pipeline's three guardrails, shared by the service host and by every evaluation tier. Its remarks (`:797-803`) state the reason it exists at all: when each caller assembled its own guardrail list, the golden replay suite drove the scorer bare and the live judge registered only one of the three, so the tiers that exist to judge the deployed pipeline were judging a different pipeline. It calls `services.AddPiiRedactionGuardrail()` and `services.AddContentPolicyGuardrail(configuration)` (`:822-823`, both framework guardrails, request side) then `services.AddSessionScoreResponseGuardrail()` (`:826`, this module's, response side). Its remarks (`:805-809`) warn it must run BEFORE `AddMmcaChatClient`, which reads the `IChatGuardrail` descriptors to decide whether to compose the guardrail layer at all; every registration is `TryAddEnumerable`, so calling it twice composes the same three.
  - **`AddSessionScoreResponseGuardrail()`** (`:851`): registers [SessionScoreResponseGuardrail](#sessionscoreresponseguardrail) with `services.TryAddEnumerable(ServiceDescriptor.Singleton<IChatGuardrail, SessionScoreResponseGuardrail>())` (`:855-856`). Kept public and separate from `AddConferenceAiGuardrails`, which composes it (remarks `:843-849`), so a caller that wants only the response gate has it, and stacks with the framework's guardrails instead of replacing them.
- **Why it's built this way**: registering `SessionScoringService` from a factory lambda rather than a typed `AddHttpClient` call is the direct consequence of depending on a shared, already-configured `IChatClient` instead of owning a client's lifecycle. Splitting guardrail composition into its own method, called before the host wires `AddMmcaChatClient`, is what lets one registration point reach both the deployed pipeline and every evaluation tier, so a guardrail cannot change production scores without an evaluation case seeing the same guardrail.
- **Where it's used**: `AddModuleConferenceInfrastructure` is called from the Conference module's registration chain (see [ConferenceModule](group-20-conference-api-grpc.md#conferencemodule)), which the module loader invokes in topological order; `AddConferenceAiGuardrails` is called by the service host and by the evaluation tiers ahead of `AddMmcaChatClient`.

---

### CategoryItemConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Categories` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Categories/CategoryItemConfiguration.cs:10` · Level 8 · class

- **What it is**: the EF Core persistence map for the [`CategoryItem`](group-17-conference-domain.md#categoryitem) entity: column facets, the parent relationship to [`Category`](group-17-conference-domain.md#category), and a composite unique index. It is the smallest complete member of the seventeen-class configuration family in this folder, so it is the one this chapter uses to teach the shared shape.
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype) (base, `:11`), [`CategoryItem`](group-17-conference-domain.md#categoryitem), [`Category`](group-17-conference-domain.md#category), [`CategoryInvariants`](group-17-conference-domain.md#categoryinvariants) (`:19`). External: `Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<T>`.
- **Concept introduced, the per-entity configuration class and what the base already did.** Every configuration in this folder is an `internal sealed class` deriving from `EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>` and overriding one method, `Configure(EntityTypeBuilder<TEntity> builder)`, whose first statement is always `base.Configure(builder)` (`:16`). Knowing exactly what that base call does is what stops you re-declaring things by hand:
  - `EntityTypeConfigurationSQLServer` is a **shim with no body** (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Configuration/EntityTypeConfiguration/EntityTypeConfigurationSQLServer.cs:17-20`). Its whole contribution is the `[UseDataSource(DataSource.SQLServer)]` attribute it carries (`:16`), an instance of [`UseDataSourceAttribute`](group-14-module-system-composition.md#usedatasourceattribute).
  - The real work is in [`EntityTypeConfiguration<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationtentity-tidentifiertype). Its `Configure` (`EntityTypeConfiguration.cs:39`) reads the attribute off `GetType()` and throws if it is missing (`:43-46`), then calls `ApplyEngineConventions` (`:48`). For `DataSource.SQLServer` that means `ToTable(typeof(TEntity).Name, NamespaceConventions.GetModuleName(typeof(TEntity)) ?? "dbo")`, so the table name comes from the CLR type and **the schema comes from the module segment of the entity's namespace** (`:66`), then `HasKey(p => p.Id)` (`:67`) and either `ValueGeneratedOnAdd()` or `ValueGeneratedNever()` depending on `IsIdValueGenerated` (`:68-71`).
  - Below that, [`EntityTypeConfigurationBase<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationbasetentity-tidentifiertype) does exactly one thing: `builder.Ignore(nameof(AuditableAggregateRootEntity<>.DomainEvents))` for aggregate roots (`EntityTypeConfigurationBase.cs:29-32`), keeping the in-memory event list out of the schema.
  - What the base chain does **not** do is equally important. The soft-delete global query filter, the `rowversion` concurrency token and the soft-delete index convention are installed by the context, not by these classes: [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) adds the query filter at `ApplicationDbContext.cs:422`, marks the concurrency property at `:469` and `:473`, and registers [`SoftDeleteUniqueIndexConvention`](group-07-persistence-ef-core.md#softdeleteuniqueindexconvention) at `:296`. So a configuration class in this folder is only ever about *this entity's* columns, relationships and indexes.

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
  - `HasSoftDeleteFilter()` (`IndexBuilderExtensions.cs:52-66`) replaces a hand-typed `HasFilter("[IsDeleted] = 0")`. It builds the predicate through [`SoftDeleteFilterSql`](group-07-persistence-ef-core.md#softdeletefiltersql) from the live model (`:56`), so a renamed soft-delete column follows automatically and the identifier quoting comes from the engine instead of a SQL-Server-shaped literal. Its `engine` parameter defaults to `DataSource.SQLServer` (`:51`), which is exactly what the `…SQLServer` base already implies. On a **unique** index the call is technically redundant with `SoftDeleteUniqueIndexConvention`, which would apply the same predicate at model finalizing; writing it explicitly keeps the intent readable at the call site, and because the convention skips any index that already declares a filter (`SoftDeleteUniqueIndexConvention.cs:53`) the two can never disagree. On a **non-unique** index like the `EventId` lookup here, the convention deliberately does nothing, so the explicit call is the only way to get the filter.
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
- **Caveats / not-in-source**: this configuration only defines the table. Whether scoring runs in a given environment is a configuration and feature-gating question decided outside this file. Note also that [`ModuleApplicationDbContext`](#moduleapplicationdbcontext) declares no `DbSet` for `SessionAiScore` (its fifteen sets are listed at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:30-75`), and nothing breaks, because that manifest does not drive the model.

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

### SessionAssetConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.SessionAssets` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionAssets/SessionAssetConfiguration.cs:18` · Level 9 · class

- **What it is**: the persistence map for `SessionAsset`, a file or link (slides, a recording, a resource) attached to a session, with the uploading speaker recorded and its own sort order.
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype), `SessionAsset`, `SessionAssetInvariants`, [`Event`](group-17-conference-domain.md#event), [`Session`](group-17-conference-domain.md#session), [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept**: an instance of the join/child-entity mapping template taught under [`EventSpeakerConfiguration`](#eventspeakerconfiguration) and [`CategoryItemConfiguration`](#categoryitemconfiguration): required scalars sized from an `...Invariants` class, two `HasOne(...).WithMany()` parent relationships with no inverse navigation, and filtered indexes shaped for the two read paths that actually query the table.
- **Walkthrough**
  - **Required** (`:26-33`, `:35-41`, `:54-55`): `EventId`, `SessionId`, `Kind`, `Title` at `SessionAssetInvariants.TitleMaxLength`, `Url` at `SessionAssetInvariants.UrlMaxLength`, `SortOrder`.
  - **Optional** (`:43-52`, `:57-58`): `BlobName` (`SessionAssetInvariants.BlobNameMaxLength`), `ContentType` (`SessionAssetInvariants.ContentTypeMaxLength`), `SizeBytes`, `UploadedBySpeakerId`, all `IsRequired(false)`. `BlobName` and `ContentType` being nullable is the schema admitting that not every asset is a stored blob; an asset that is an external link carries a `Url` and no blob.
  - **Event and Session relationships** (`:60-68`): both required, both `HasOne<Event>()`/`HasOne<Session>()` with the parameterless `WithMany()`, so neither `Event` nor `Session` exposes an assets collection navigation.
  - **Indexes** (`:70-78`): a filtered composite `(SessionId, SortOrder)`, commented as serving the one read shape the public session page has, one session's assets in sort order (`:70-74`); and a filtered single-column `EventId` index for the event-level cascade delete to select every asset of one event in one read (`:76-78`).
- **Why it's built this way**: sizing the two indexes to the two actual consumers, the per-session ordered read and the per-event bulk delete, rather than adding a general-purpose index, follows the pattern used across the rest of this folder.
- **Where it's used**: exposed as `DbSet<SessionAsset> SessionAssets` on [`ModuleApplicationDbContext`](#moduleapplicationdbcontext) (`ModuleApplicationDbContext.cs:78`).

`[Rubric §8, Data Architecture]` applies: index shape follows the two queries the table actually serves rather than a generic default.

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
  - **Required** (`:20-22`, `:38-48`, `:77-78`): `Title` at `SessionInvariants.TitleMaxLength`; four booleans, `IsInformed`, `IsConfirmed`, `IsServiceSession`, `IsPlenumSession`; and the `EventId` scalar.
  - **Optional** (`:24-36`, `:50-64`, `:88-89`): `Description`, `StartsAt`, `EndsAt`, `Status`, `LiveUrl`, `RecordingUrl`, `AccessibilityInfo`, `ResourceLinks`, `RoomId`. That `StartsAt`, `EndsAt` and `RoomId` are all nullable is the schema admitting that a session exists as an accepted talk long before it is scheduled.
  - **`Status` is a plain string** (`:34-36`) capped at `SessionInvariants.StatusMaxLength`, not an enum with a conversion (the entity declares it as `string?` at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/Session.cs:37`), so adding a status value needs no migration.
  - **`Duration` is a stored computed column, not an ignored derived property** (`:74-75`): `builder.Property(p => p.Duration).HasComputedColumnSql("DATEDIFF(minute, [StartsAt], [EndsAt])", stored: true)`. The comment above it (`:66-73`) explains why: the sessions grid sorts on `Duration`, and an `ORDER BY` needs a column, dynamic LINQ cannot express a date difference and the provider does not translate `DateTime` subtraction client-side, so the value has to live in the database. `stored: true` keeps the two representations from drifting, the column is a function of `StartsAt`/`EndsAt`, so no writer can set it to anything else; EF infers `ValueGeneratedOnAddOrUpdate` from a computed column, so the client value is never sent and the stored value is read back after `SaveChanges`. The property stays nullable (`int?`), so there is no `IsRequired()` call: a session without both bounds has no duration, and `DATEDIFF` returns `NULL` for it.
  - **Event relationship** (`:80-83`) required, plus `HasIndex(p => p.EventId).HasSoftDeleteFilter()` (`:85-86`), a non-unique filtered lookup index for "all live sessions of this event", the single hottest read in the app.
  - **Room relationship** (`:91-95`) optional, with the `Restrict` behaviour described above.
- **Why it's built this way**: the required or optional split mirrors the real conference workflow (accept first, schedule later), and the two relationship decisions, no inverse navigation and restricted room deletes, both trade a little convenience for predictable performance and predictable schedule integrity. Moving `Duration` from an ignored computed property to a stored computed column is the same trade applied to sorting: the database, not the client, now owns the one representation of it.
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

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts.Seeding` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:27` · Level 9 · class

- **What it is**: the Conference module's startup data seeder. It puts the two real conference editions and the ten feedback questions into a fresh database on every boot, and, only when its `includeSampleData` flag is set, a small deterministic browse fixture on top (two speakers, two sessions, the speaker links, four sponsors, four partners, three social activities). Every write goes through a domain factory and the unit of work, and every insert is guarded by an existence check, so running it against an already-seeded database is a no-op.
- **Depends on**: first-party: [`DbSeeder`](group-07-persistence-ef-core.md#dbseeder) (base, `:27`), [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) (`:27`, `:49`) and the `IRepository<TEntity, TIdentifierType>` handles it hands out (`:72`, `:147`, `:195`, `:249`, `:308`, `:362`, `:414`, `:422`, `:470`), the domain factories [`Event`](group-17-conference-domain.md#event) (`:87`, `:122`), [`Question`](group-17-conference-domain.md#question) (`:175`), [`Speaker`](group-17-conference-domain.md#speaker) (`:215`), [`Session`](group-17-conference-domain.md#session) (`:279`), [`Sponsor`](group-17-conference-domain.md#sponsor) (`:387`), `Partner` (`:447`) and [`Activity`](group-17-conference-domain.md#activity) (`:516`), the join entities [`EventSpeaker`](group-17-conference-domain.md#eventspeaker) and [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker) (created indirectly at `:344`, `:347`, `:573`), the id-range constants on [`QuestionInvariants`](group-17-conference-domain.md#questioninvariants) (`:171`) and [`SessionInvariants`](group-17-conference-domain.md#sessioninvariants) (`:257-258`), and [`SponsorTier`](group-17-conference-domain.md#sponsortier) (`:366`). External: BCL only (`DateOnly`, `TimeOnly`, `TimeSpan`, `DateTimeKind`).
- **Concept introduced, seeding through the domain rather than through SQL.** A seeder in this codebase never writes rows. It calls the same static factory an HTTP command handler would call, checks the returned [`Result`](group-01-result-error-handling.md#result) wrapper, hands the entity to a repository, and lets [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) commit. `Event.Create(...)` at `:87-99` is the identical entry point the organizer's create-event use case takes, so seeded data satisfies exactly the invariants that user-created data satisfies: there is no second, looser definition of a valid event hiding in the seeder. The consequence worth internalizing is that a seed insert is a full domain write with all its side effects: `eventResult.Value!.Publish()` at `:104` flips `IsPublished` **and** raises an `EventChanged` domain event (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/Event.cs:310-312`), so the `SaveChangesAsync` at `:107` writes an outbox row alongside the entity row. Startup seeding therefore feeds the same dual-dispatch pipeline as runtime traffic (ADR-003), it does not bypass it. This is what Rubric section 4 (DDD) assesses whether the domain model is the single place invariants live; routing seed data through the factories is what keeps that true at the one moment it is most tempting to cheat.
- **Concept introduced, idempotency that respects soft delete.** Every existence probe in this file passes `ignoreQueryFilters: true` (`:81`, `:116`, `:151`, `:209`, `:270`, `:381`, `:441`, `:508`), which turns off the global soft-delete filter for that one query. The comment at `:74-78` gives both halves of the reason. First, a deleted seed row is a decision someone made, not a gap to refill, so the seeder must see it and stand down. Second, the fixed-id rows (questions at `:175`, sample sessions at `:257-258`) keep their primary keys when soft-deleted, so a filtered check would report "missing", re-insert the same id, and take startup down on a primary-key violation. The `ExistsAsync(Expression<Func<TEntity, bool>>, bool ignoreQueryFilters, CancellationToken)` overload that makes this possible is on the shared repository contract (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IRepository.cs:62-65`). [`ConferenceModuleDbSeederTests`](group-28-testing-infrastructure.md#per-project-test-rollup) pins the behavior mechanically: its Moq setups match `true` for that parameter only (`MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Infrastructure.Tests/Seeding/ConferenceModuleDbSeederTests.cs:103-113`), so a future edit that drops the flag falls through to Moq's default `false` and the "skips when exists" tests go red (the reasoning is spelled out in the comment at `:99-102` of that test file). This is what Rubric section 17 (DevOps) assesses whether startup is repeatable and safe to re-run; this is the pattern that makes "boot the app twice" a non-event.
- **Concept introduced, environment-gated fixture data.** The class takes `bool includeSampleData = false` (`:27`), stores it (`:50`), and branches on it in `SeedAsync` (`:59-67`). The default is off, and the only thing that turns it on is [`ConferenceModuleSeeder`](group-20-conference-api-grpc.md#conferencemoduleseeder) reading `configuration.GetValue<bool>("Seeding:IncludeSampleConferenceData")` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/ConferenceModuleSeeder.cs:26`). `GetValue<bool>` on an absent key yields `false`, so a production host that never sets the key gets the real events and questions and nothing else. The one place the key is set is the local Aspire AppHost, `.WithEnvironment("Seeding__IncludeSampleConferenceData", "true")` on the Conference service (`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:211`, rationale at `:207-209`). E2E CI inherits it by launching that same AppHost (`MMCA.ADC/.github/workflows/e2e.yml:219`), which is why the two public-browse tests can assume rows exist (`MMCA.ADC/Tests/E2E/MMCA.ADC.E2E.Tests/Workflows/Conference/Public/PublicBrowseTests.cs:93`, `:102`). This is what Rubric section 11 (Security) assesses whether non-production affordances are structurally unable to reach production: here the gate is a default-false configuration read in the composition root, not a runtime environment sniff inside the seeder.
- **Concept introduced, reserved manual id ranges.** Conference session ids are app-assigned rather than database-generated because the integer primary key **is** the Sessionize id when a session arrives through the import (comment at `:251-254`). Sample sessions have no Sessionize id, so they take explicit ids from the top of the integer space: `SessionInvariants.ManualIdRangeStart` is `999_999_000` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/SessionInvariants.cs:44`) and the two fixtures take that value and that value plus one (`:257-258`). Questions do the same from `QuestionInvariants.ManualIdRangeStart`, also `999_999_000` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Questions/QuestionInvariants.cs:40`), incremented per question by `id: nextId++` (`:171`, `:175`). The range sits above any id an upstream system will mint, so seed rows and imported rows can never collide, and the same constants are what the organizer-facing create handlers continue from. This is what Rubric section 8 (Data Architecture) assesses whether key strategy is deliberate; reserving a high range is the cheap alternative to a separate identity column or a synthetic-vs-natural key split.
- **Walkthrough**
  - **Primary constructor and fields** (`:27`, `:49-50`): `ConferenceModuleDbSeeder(IUnitOfWork unitOfWork, bool includeSampleData = false) : DbSeeder()`. The unit of work is null-guarded into `_unitOfWork` at `:49` (the one behavior a unit test asserts directly, `ConferenceModuleDbSeederTests.cs:73-75`); the flag is copied to `_includeSampleData` at `:50`. The base [`DbSeeder`](group-07-persistence-ef-core.md#dbseeder) contributes the `SeedAsync` abstract member and a `GetId<TIdentifier>(int)` helper for int-or-Guid key strategies (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/DbSeeder.cs:20-39`), which this seeder does not use: the Conference identifier aliases are `int`, so literal ids pass straight through.
  - **Literal constants** (`:29-47`): the shared venue address and embedded map URL, three placeholder URLs for sample sponsors, partners and activities, and the two published sponsorship-packet URLs. The six URL constants each carry a `SuppressMessage` for Sonar `S1075` (URIs should not be hardcoded) with a per-constant justification, which is how this repo records "the literal is the data" rather than switching the analyzer off.
  - **`SeedAsync`** (`:53-67`): the whole contract in fifteen lines. Three unconditional steps (`:55-57`) then a single `if (_includeSampleData)` block of six (`:61-66`). Ordering is a real dependency chain: sessions need the events, the speaker links need both the speakers and the sessions, sponsors and partners need the events, and partners are seeded right after sponsors and before activities.
  - **`SeedCloudAiConferenceEventAsync`** (`:70-108`): probes for the event by name, tolerating the pre-rename spelling so a database seeded before "2026" was prefixed stays idempotent (`:79-82`). On a miss it builds the 2026 Atlanta Cloud + AI Conference for 2026-05-30 in `America/New_York` with Sessionize code `z1ecmzux` (`:87-99`), returns quietly if the factory fails (`:101-102`), publishes (`:104`), adds and saves (`:106-107`).
  - **`SeedDevelopersConferenceEventAsync`** (`:110-143`): the same shape for the 2026 Atlanta Developers Conference on 2026-10-17, Sessionize code `sf1nopko` (`:122-134`). It needs no legacy-name alternative because that event was never renamed.
  - **`SeedQuestionsAsync`** (`:145-191`): one probe on the sentinel question `"Rate the Session"` with `QuestionSource == "User"` (`:149-152`) decides the whole set, then ten tuples (`:157-169`) become ten `Question.Create` calls with sequential reserved ids (`:173-188`) and a single save (`:190`). Six are session-scoped (five ratings plus a free-text comment), four are event-scoped. The `Times.Exactly(10)` assertion in the unit tests (`ConferenceModuleDbSeederTests.cs:28-30`) is what keeps that count honest.
  - **`SeedSpeakersAsync`** (`:193-234`): two sample speakers, Ada Lovelace and Alan Turing on `example.com` addresses (`:197-201`), each probed by first and last name (`:207-210`) and skipped individually with `continue` rather than aborting the batch (`:212-213`). An `added` flag means the save (`:233`) only runs when something actually changed. That flag pattern repeats in every sample-data method.
  - **`SeedSessionsAsync`** (`:236-304`): resolves both events through the shared helper (`:246-247`), then seeds one session per event (Ada's keynote on the Cloud + AI day, Alan's Azure talk on the Developers day, `:255-259`) so both the auto-filtered public pages and the organizer list's event filter have data for either selection. Start time is computed from the owning event's own date, `sessionEvent.StartDate.ToDateTime(new TimeOnly(13, 0), DateTimeKind.Utc)`, with a comment recording that 13:00 UTC is 09:00 Eastern for both dates; the session runs one hour. Idempotency here is by title, which is also why a comment notes that a database seeded before the one-session-per-event split keeps its old shape: the title check never moves an existing row.
  - **`SeedSampleEventLinksAsync`** (`:306-330`): loads the two sample speakers untracked-free (`asTracking: false`, `:310-315`), bails if either is missing (`:317-320`), then calls the two link helpers and ORs their results (`:325-326`) before one save (`:328-329`). The comment above `:325` explains why both link paths are populated: the speakers-by-event filter has a direct branch (through `EventSpeaker`) and a transitive branch (through `SessionSpeaker`), and seeding both exercises both in dev and CI.
  - **`LinkSampleEventSpeakersAsync`** (`:332-351`) and **`LinkSampleSessionSpeakersAsync`** (`:558-577`): both re-fetch with `asTracking: true` and an `includes` list so the aggregate's child collection is loaded before mutation (`:337` includes `nameof(Event.EventSpeakers)`; `:563` includes `nameof(Session.SessionSpeakers)`). Idempotency is delegated to the domain: `AddEventSpeaker` and `AddSessionSpeaker` return a failed `Result` on an existing non-deleted link, so `.IsSuccess` doubles as the "did anything change" signal (`:344`, `:347`, `:573`).
  - **`SeedSponsorsAsync`** (`:353-410`): four sample sponsors spanning both events and all four [`SponsorTier`](group-17-conference-domain.md#sponsortier) values, two of them exhibitors with booth numbers (`:366-369`), each probed by name (`:379-382`) and built through `Sponsor.Create` (`:387-399`). The mapping these rows land in is [`SponsorConfiguration`](#sponsorconfiguration).
  - **`SeedPartnersAsync`** (`:412-466`): four sample partners spanning both events, three attached to the Developers edition, `Community` and `Community` and `Special`, and one attached to the Cloud + AI edition, `Community`, so the comment (`:417-419`) explains the landing-page band renders fully in dev and CI on the Developers side while the organizer list still has a row whichever event its filter defaults to. Each is probed by name (`:437-440`) and built through `Partner.Create` (`:447-455`). The mapping these rows land in is [`PartnerConfiguration`](#partnerconfiguration).
  - **`SeedActivitiesAsync`** (`:468-536`): three social-programme entries expressed as event-local wall-clock offsets rather than absolute timestamps, a pre-conference party the evening before (`DayOffset` of `-1`), a morning coffee, and an after-party. Each is anchored on its own event's start date, `activityEvent.StartDate.AddDays(dayOffset).ToDateTime(TimeOnly.MinValue)`, and the venue URL is only supplied when a venue name exists.
  - **`GetSampleEventsAsync`** (`:539-556`): the one static helper. A single `GetAllAsync` fetches both events (again tolerating the pre-rename Cloud + AI name, `:544`) with `asTracking: true` so callers can mutate them, then splits the result by name. Callers pass the `includes` they need, which is why the same helper serves both the no-include sponsor and partner paths and the `EventSpeakers`-include link path.
- **Why it's built this way**: this is the file that decides what a freshly provisioned Conference database contains, so it is written to be safe under three conditions that are easy to get wrong. Re-running (guarded by existence checks that see through soft delete), running against production (fixture data behind a default-false configuration key), and running against a database whose real content arrives from elsewhere (reserved id ranges that cannot collide with Sessionize ids). Doing the writes through domain factories and [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) rather than raw SQL or EF `HasData` also means seeding participates in the audit stamping, soft-delete defaults, and outbox dispatch that [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) applies to every save, which matters because per-service databases (ADR-006) each get their own seeding pass at their own host's startup.
- **Where it's used**: instantiated by [`ConferenceModuleSeeder`](group-20-conference-api-grpc.md#conferencemoduleseeder), the module's `IModuleSeeder` adapter, which resolves `IUnitOfWork` and `IConfiguration` from the scope and constructs it with the gate flag (`ConferenceModuleSeeder.cs:21-29`). That adapter is discovered by reflection in [`ModuleLoader`](group-14-module-system-composition.md#moduleloader) (`MMCA.Common/Source/Core/MMCA.Common.Application/Modules/ModuleLoader.cs:92-93`) and invoked in registration order by `SeedAllAsync` (`ModuleLoader.cs:255-261`), which the host calls from [`DatabaseInitializationExtensions`](group-12-api-hosting-mapping.md#databaseinitializationextensions) after schema initialization (`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/DatabaseInitializationExtensions.cs:110`). Its output is what the public browse pages in [Group 21](group-21-conference-ui.md) render in dev and CI, and what the E2E feedback and share workflows target by the reserved session id.
- **Caveats / not-in-source**: (1) Failures are swallowed. A failed factory `Result` produces a bare `return` or `continue` (`:101-102`, `:136-137`, `:184-185`, `:225-226`, `:295-296`, `:401-402`, `:457-458`, `:528-529`) with no logging: the class takes no logger, so a seed that silently does nothing leaves no trace beyond the missing rows. The `Publish()` calls at `:104` and `:139` likewise discard their `Result`. (2) The class is `public` and not `sealed`, unlike most types in this Infrastructure assembly. (3) Idempotency keys are names and titles, not database constraints: nothing stops a second row with the same event name, sponsor name, partner name, or session title from being created through the normal command paths, after which the seeder's probe would simply keep finding a match. (4) A comment in `SeedSessionsAsync` documents a real migration gap: databases seeded before the sessions were split across the two events keep the old shape and there is no fix-up path in this file, only the advice to reset the local container volume. (5) The sample-data insert order is not transactional across methods. Each method saves independently (`:233`, `:303`, `:329`, `:409`, `:465`, `:536`), so a crash partway through leaves a partially seeded fixture, which the existence checks will then complete on the next boot. (6) `ConferenceModuleDbSeederTests` covers only the always-on path with `includeSampleData` left at its default (`ConferenceModuleDbSeederTests.cs:115`); the six sample-data methods, now including `SeedPartnersAsync`, have no unit-test coverage in that file and are exercised indirectly through E2E.

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
- **Where it's used**: exposed as `DbSet<Activity> Activities` on [`ModuleApplicationDbContext`](#moduleapplicationdbcontext) (`ModuleApplicationDbContext.cs:75`); read by the public agenda queries and written by the organizer-facing activity commands.

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
- **Caveats / not-in-source**: (1) There is **no unique index on `(EventId, Name)`**, or on `Name` at all. The seeder's idempotency check probes `s => s.Name == name` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/Seeding/ConferenceModuleDbSeeder.cs:370-372`), so uniqueness of sponsor names is an application-level convention with no database backstop, unlike the room-name and session-speaker cases elsewhere in this folder. (2) The `Tier` column carries no check constraint, so a value outside `0..3` would be storable by anything that bypasses the domain factory; the enum is enforced in the CLR type, not in SQL. (3) `BoothNumber` is nullable and independent of `IsExhibitor`: the domain deliberately accepts a booth number on a non-exhibitor (`SponsorInvariants.cs:57-58`, "the flag drives display, it does not reject stored data"), and the mapping adds no constraint tying the two together. (4) The `Cascade` delete on the event foreign key is not overridden here; because the codebase soft-deletes rather than hard-deletes, whether that cascade ever executes in a deployed database is not determinable from source. (5) The grouping by tier that the public page renders happens **in memory** after the fetch (`PublicSponsorList.razor.cs:82-86`), not as a SQL `ORDER BY Tier`, so the int conversion enables a cheap column sort that today's read path does not yet ask the database to perform.

---

### PartnerConfiguration

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.EntityConfiguration.Partners` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Partners/PartnerConfiguration.cs:11` · Level 9 · class

- **What it is**: the EF Core persistence map for the `Partner` entity: a community organization or special partner (venue host and similar) attached to an event, shown on the public partners band alongside sponsors.
- **Depends on**: first-party: [`EntityTypeConfigurationSQLServer<TEntity, TIdentifierType>`](group-07-persistence-ef-core.md#entitytypeconfigurationsqlservertentity-tidentifiertype) (base, `:11-12`), `Partner`, `PartnerInvariants` (every `HasMaxLength` argument), [`Event`](group-17-conference-domain.md#event), and [`IndexBuilderExtensions`](group-07-persistence-ef-core.md#indexbuilderextensions) for `HasSoftDeleteFilter()` (`:53`). External: `Microsoft.EntityFrameworkCore.Metadata.Builders`.
- **Concept**: the same family shape taught under [`CategoryItemConfiguration`](#categoryitemconfiguration) and applied again by [`SponsorConfiguration`](#sponsorconfiguration): an `internal sealed` class over the SQL Server base whose `Configure` opens with `base.Configure(builder)` and sizes every string from an `...Invariants` class.
- **Concept reinforced, storing an enum as its underlying `int`.** `PartnerType` is stored `HasConversion<int>().IsRequired()` (`:25-27`), and the comment above it (`:23-24`) gives the same reason as [`SponsorConfiguration`](#sponsorconfiguration)'s `Tier` column: the group ordering stays a plain column sort and adding a partner type later does not rewrite existing rows. `PartnerType` is a two-member enum, `Community = 0` and `Special = 1` (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Partners/PartnerType.cs:15-18`), with `Community` deliberately the zero value because it carries no commercial weight, so an omitted type landing on it is harmless (`PartnerType.cs:8-10`).
- **Walkthrough**
  - **Class declaration** (`:11-12`): `internal sealed class PartnerConfiguration : EntityTypeConfigurationSQLServer<Partner, PartnerIdentifierType>`.
  - **`base.Configure(builder)`** (`:17`): table, schema, key and value generation, as in every configuration in this folder.
  - **Required scalars** (`:19-21`, `:41-45`): `Name` at `PartnerInvariants.NameMaxLength` (200, `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Partners/PartnerInvariants.cs:16`); `Sort`; `EventId`.
  - **The type conversion** (`:25-27`): described above.
  - **Optional presentation columns** (`:29-39`): `LogoUrl` (`PartnerInvariants.LogoUrlMaxLength`, 2000, `PartnerInvariants.cs:19`), `Description` (`DescriptionMaxLength`, 2000, `:22`), `WebsiteUrl` (`WebsiteUrlMaxLength`, 2000, `:25`), all `IsRequired(false)`.
  - **Event relationship** (`:47-50`): required `HasOne(p => p.Event).WithMany().HasForeignKey(p => p.EventId).IsRequired()`, the parameterless `WithMany()` again meaning `Event` exposes no `Partners` collection navigation, the same one-way boundary [`SponsorConfiguration`](#sponsorconfiguration) draws for `Sponsor`.
  - **Lookup index** (`:52-53`): `builder.HasIndex(p => p.EventId).HasSoftDeleteFilter()`, not unique, aimed at the public partners-band query filtered by event.
- **Why it's built this way**: `Partner` mirrors `Sponsor`'s shape deliberately, per-event data with a public, ordered presentation, so the mapping makes the same three choices: an `int`-backed type column that tolerates future values, a one-way required relationship to `Event`, and a single filtered index sized to the one read the public band performs.
- **Where it's used**: applied when the concrete [`SQLServerDbContext`](group-07-persistence-ef-core.md#sqlserverdbcontext) builds its model by scanning the module assembly, one of nineteen configurations now in this folder. `Partner` gets a `Partners` `DbSet` on [`ModuleApplicationDbContext`](#moduleapplicationdbcontext) (`ModuleApplicationDbContext.cs:72`). Rows are written by [`ConferenceModuleDbSeeder`](#conferencemoduledbseeder)'s `SeedPartnersAsync` (`ConferenceModuleDbSeeder.cs:412-455`) and by the partner command handlers.
- **Caveats / not-in-source**: (1) There is no unique index on `(EventId, Name)` or on `Name` alone; the seeder's idempotency check probes `p => p.Name == name` (`ConferenceModuleDbSeeder.cs:428-431`), so name uniqueness is an application-level convention with no database backstop, the same gap [`SponsorConfiguration`](#sponsorconfiguration) carries. (2) `PartnerType` carries no check constraint, so a value outside `0..1` would be storable by anything that bypasses the domain factory.

---

### ModuleApplicationDbContext

> MMCA.ADC.Conference.Infrastructure · `MMCA.ADC.Conference.Infrastructure.Persistence.DbContexts` · `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:22` · Level 12 · abstract class

- **What it is**: an abstract `DbContext` that names the Conference module's entity sets. It declares seventeen `internal DbSet<T>` properties and forwards its four constructor arguments unchanged to the framework base; it adds no `OnModelCreating`, no `OnConfiguring`, and no behavior of any kind.
- **Depends on**: first-party: [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) (base, `:25`), [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider) (`:23`), [`PhysicalDataSource`](group-07-persistence-ef-core.md#physicaldatasource) (`:24`), and the seventeen Conference entity types it exposes, all from [Group 17](group-17-conference-domain.md) except `SessionAsset` (mapped by [`SessionAssetConfiguration`](#sessionassetconfiguration) in this chapter) and `Partner` (mapped by [`PartnerConfiguration`](#partnerconfiguration) in this chapter): [`Event`](group-17-conference-domain.md#event), [`Room`](group-17-conference-domain.md#room), [`EventSpeaker`](group-17-conference-domain.md#eventspeaker), [`EventQuestionAnswer`](group-17-conference-domain.md#eventquestionanswer), [`Session`](group-17-conference-domain.md#session), [`SessionSpeaker`](group-17-conference-domain.md#sessionspeaker), [`SessionQuestionAnswer`](group-17-conference-domain.md#sessionquestionanswer), [`SessionCategoryItem`](group-17-conference-domain.md#sessioncategoryitem), `SessionAsset`, [`Speaker`](group-17-conference-domain.md#speaker), [`SpeakerCategoryItem`](group-17-conference-domain.md#speakercategoryitem), [`Category`](group-17-conference-domain.md#category), [`CategoryItem`](group-17-conference-domain.md#categoryitem), [`Question`](group-17-conference-domain.md#question), [`Sponsor`](group-17-conference-domain.md#sponsor), `Partner`, [`Activity`](group-17-conference-domain.md#activity). External: `Microsoft.EntityFrameworkCore.DbContextOptions` and `DbSet<T>` (`:1`).
- **Concept introduced, a `DbSet` list is an index, not the model.** The instinct carried over from a typical EF application is that `DbSet<T>` properties define what the context maps. In this codebase they do not. The model is built by [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext), which walks the assemblies handed to it by [`IEntityConfigurationAssemblyProvider`](group-07-persistence-ef-core.md#ientityconfigurationassemblyprovider) and applies every configuration implementing the engine's interface, filtered to the entities routed to *this* physical data source (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:950-977`). The proof is in the arithmetic: the Conference `EntityConfiguration` folder holds nineteen `*Configuration.cs` files (seventeen plus [`SessionAssetConfiguration`](#sessionassetconfiguration) and [`PartnerConfiguration`](#partnerconfiguration)), two more than the seventeen `DbSet`s here. `SessionAiScore` and `SpeakerQuestionAnswer` are mapped, migrated, and queried without ever appearing on this class. Reading the `DbSet` list as a coverage manifest would therefore mislead you; read the configuration folder instead. This is what Rubric section 8 (Data Architecture) assesses whether the mapping strategy is explicit and centrally governed; convention-by-assembly-scan is what lets one context class serve every module without any module editing it.
- **Concept introduced, `internal` sets as a layering boundary.** All seventeen properties are `internal` (`:28-78`), not `public`. Nothing outside `MMCA.ADC.Conference.Infrastructure` can reach `context.Sessions` even with a context instance in hand. Application-layer handlers get their data through [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork) and `IRepository<TEntity, TIdentifierType>` instead, which is where soft-delete filtering, tracking choices, and data-source routing are decided. This is what Rubric section 3 (Clean Architecture) assesses whether the dependency rule is enforced by the compiler rather than by convention; an access modifier is the cheapest available enforcement, and it is why a handler cannot accidentally grow a raw LINQ query against a `DbSet`.
- **Walkthrough**
  - **Class declaration and primary constructor** (`:20-25`): `public abstract class ModuleApplicationDbContext(DbContextOptions options, IServiceProvider serviceProvider, IEntityConfigurationAssemblyProvider assemblyProvider, PhysicalDataSource physicalDataSource) : ApplicationDbContext(options, serviceProvider, assemblyProvider, physicalDataSource)`. Every parameter is passed straight through; the class captures none of them and overrides nothing. Note the untyped `DbContextOptions` rather than `DbContextOptions<TContext>`, which is what allows an arbitrary concrete subclass to supply its own typed options.
  - **The seventeen entity sets** (`:28-78`): `Events` (`:28`), `Rooms` (`:31`), `EventSpeakers` (`:34`), `EventQuestionAnswers` (`:37`), `Sessions` (`:40`), `SessionSpeakers` (`:43`), `SessionQuestionAnswers` (`:46`), `SessionCategoryItems` (`:49`), `Speakers` (`:52`), `SpeakerCategoryItems` (`:55`), `Categories` (`:58`), `CategoryItems` (`:61`), `Questions` (`:64`), `Sponsors` (`:67`), `Partners` (`:70`), `Activities` (`:73`), `SessionAssets` (`:77`). Read top to bottom they trace the module's aggregate map: the two roots that own schedules (`Event`, `Session`), their join tables to speakers and categories, the taxonomy pair (`Category` and `CategoryItem`), the feedback pair (`Question` plus the two answer tables), the three per-event additions (`Sponsor`, `Partner`, `Activity`), and the newest set, `SessionAssets`, appended at the end rather than grouped with the other session-scoped sets. `Partners` was inserted between `Sponsors` and `Activities`, next to the entity it mirrors, unlike `SessionAssets`.
  - **What is deliberately absent**: no `OnModelCreating` override, so nothing here competes with the base's assembly scan; no `OnConfiguring`, so provider selection stays with the concrete engine context; no `SaveChanges` override, so audit stamping, soft delete, and outbox dispatch remain the base's job.
- **Why it's built this way**: ADR-006 fixes one sealed context class per engine, shared across modules, rather than one context class per module, and the runtime honors that literally. The concrete context is Common's `sealed class SQLServerDbContext`, which derives from [`ApplicationDbContext`](group-07-persistence-ef-core.md#applicationdbcontext) directly (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/SQLServerDbContext.cs:15-20`), and the Conference migrations project targets that same type through `IDesignTimeDbContextFactory<SQLServerDbContext>` (`MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Conference/DesignTimeSQLServerDbContextFactory.cs:12-15`). Keeping the module-level class abstract, behavior-free, and additive means the per-engine story stated in ADR-018 (SQL Server today, Cosmos and SQLite as further engines) needs no per-module change: a new engine adds one sealed class in MMCA.Common, not seventeen `DbSet` declarations per module. This is what Rubric section 7 (Microservices Readiness) assesses whether a module could be lifted into its own host without a rewrite; the entity-set surface being module-scoped and `internal` is part of what makes that lift mechanical.
- **Where it's used**: the seventeen sets correspond one to one with seventeen of the nineteen configurations in this chapter, including [`EventConfiguration`](#eventconfiguration), [`SessionConfiguration`](#sessionconfiguration), [`SponsorConfiguration`](#sponsorconfiguration), [`PartnerConfiguration`](#partnerconfiguration), [`ActivityConfiguration`](#activityconfiguration) and [`SessionAssetConfiguration`](#sessionassetconfiguration), and with the tables the Conference migrations project maintains for the `ADC_Conference` database. Application-layer access to those tables runs through [`IUnitOfWork`](group-07-persistence-ef-core.md#iunitofwork), and the rows themselves are first written by [`ConferenceModuleDbSeeder`](#conferencemoduledbseeder).
- **Caveats / not-in-source**: (1) **Nothing derives from this class.** A repository-wide search of MMCA.ADC for the identifier `ModuleApplicationDbContext` returns exactly three hits, the three sibling declarations in the Conference, Engagement, and Identity Infrastructure projects, and no subclass, no DI registration, and no consumer. The class compiles and is packaged, but it is not on the runtime path today: `SQLServerDbContext` bypasses it. Treat this section as documentation of the module's entity surface and of an extension point that is currently unexercised, not of a type in the request path. (2) Consequently the `internal` visibility of the sets protects a surface nothing currently reaches; the layering point it makes is real but presently theoretical for this class. (3) `SessionAiScore` and `SpeakerQuestionAnswer` have configurations in `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/` but no `DbSet` here; whether that is deliberate or an oversight is not determinable from source, since no code reads the `DbSet` list. (4) The three sibling `ModuleApplicationDbContext` classes share a name across three namespaces (Conference at `:20`, Engagement at `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:19`, Identity at `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/DbContexts/ModuleApplicationDbContext.cs:15`); each has its own section in its own chapter, so check the namespace before assuming which one a search result refers to.


---
[⬅ ADC Conference - Application & Use Cases](group-18-conference-application.md)  •  [Index](00-index.md)  •  [ADC Conference - API, gRPC Contracts & Service Host ➡](group-20-conference-api-grpc.md)
