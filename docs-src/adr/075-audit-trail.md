# ADR-075: Audit Trail (Same-Transaction Field-Level Change History)

## Status
Accepted (2026-08-13; corrected 2026-08-14: the adoption sweep and the `ApplicationDbContext` line
citations). The implementation lands in the MMCA.Common "enterprise capability wave" release
and is opt-in at three gates: `AddAuditTrail(configuration)` registers the interceptor, the settings, the
reader and the retention job, `AuditTrail:Enabled` (default false) maps the table and turns capture on, and
an entity is audited only when it carries the `IAuditedEntity` marker. Absent registration the interceptor
is not resolved and the whole feature is a no-op.
Revised 2026-09-07 (Store pins the reverse `[Pii]` convention with a fitness test, and deployed SQL
auditing backstops the in-database trail).
Revised 2026-09-25 (both apps' SQL auditing now records UPDATE and DELETE statements against the trail
table, by different means, and the code anchors are refreshed).
Revised 2026-10-01 (retention has no fallback: without the scheduler nothing is purged; see Revision below).
Revised 2026-10-06: inserts and deletes write one summary row, a store-generated key is fixed up by an `UPDATE` after the save, and ADC's trail-DML auditing therefore fires on routine inserts too.
Revised 2026-10-07: the key fix-up issues one filtered `UPDATE` per pending row rather than one statement covering all of them, `AuditTrailSettings` also carries `DataSource` (the engine the reader queries), and anchors are refreshed after the v1.233.0 release.
## Context
The framework already answers "who touched this row last". Every `AuditableBaseEntity` carries
`CreatedOn/By` and `LastModifiedOn/By`, stamped by `AuditSaveChangesInterceptor` on the way into
`SaveChangesAsync`. What it cannot answer is "what changed". The stamps are a single overwrite: the
current value of `LastModifiedBy` erases the previous one, so a row that has been edited nine times
carries the ninth editor and nothing else. Soft-delete (ADR-005) preserves the row, not its history.

That gap becomes concrete the moment a regulated or contested question arrives: which administrator moved
this ticket's priority, what the price was before yesterday's edit, whether a role assignment predates or
postdates an incident. Every consumer in the workspace has the same gap and none of them has built the
same answer, which is exactly the shape of a framework concern rather than an application one.

Several questions had no recorded answer:

- **Where does the capture run?** A repository decorator sees intent but not the change tracker's diff.
  An application-layer handler sees the command, not the properties EF actually marked modified. A
  database trigger sees the diff and nothing else: no user, no correlation id, no PII knowledge.
- **Does the trail commit with the data or beside it?** A trail written after the commit can be lost by a
  crash in the window; a trail written to a different database cannot share the transaction at all.
- **What happens to personal data?** A change trail is precisely the store that outlives the erasure of
  the row it describes, so a naive old-value capture would recreate the personal data that ADR-005 exists
  to remove.
- **What stops it from swamping the database?** Auditing every entity in a shipped framework would put
  every consumer's write path on a multiplier they never asked for.

## Decision

### A fourth `SaveChangesInterceptor`, resolved optionally, running last
`AuditTrailSaveChangesInterceptor` (Infrastructure `Persistence/AuditTrail/`) joins the interceptors
`ApplicationDbContext.OnConfiguring` already passes to `optionsBuilder.AddInterceptors`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:297-322`,
where `AuditSaveChangesInterceptor` and `DomainEventSaveChangesInterceptor` are resolved with
`GetRequiredService` (`:297-298`) and the tenant and audit-trail interceptors with `GetService` (`:305`,
`:319`)). The new one is resolved with `GetService`, not `GetRequiredService` (`:319`, added on its own at
`:321`): a host that never calls `AddAuditTrail`
resolves null, nothing is added to the pipeline, and the feature costs nothing.

**Registration order is execution order and it is load-bearing.** After the wave the sequence is
`AuditSaveChangesInterceptor` (stamps `CreatedBy/On` and `LastModifiedBy/On`), then
`TenantSaveChangesInterceptor` (ADR-073, stamps `TenantId`), then `DomainEventSaveChangesInterceptor`
(writes the outbox rows), then `AuditTrailSaveChangesInterceptor` last, so the diff it captures sees the
final stamped values rather than a half-populated entity. The audit-trail rows it adds are themselves
never audited. `DesignTimeDbContextHelper` registers all four
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Design/DesignTimeDbContextHelper.cs:148-149`,
`:155`, `:167`). Only the two `GetRequiredService` interceptors are hard requirements for `dotnet ef`; the
context resolves the tenant and audit-trail ones with `GetService` (`.../ApplicationDbContext.cs:305`,
`:319`), so omitting either would still work (the helper's own comment says so for the audit-trail one,
`DesignTimeDbContextHelper.cs:162-164`).

### `AuditTrailEntry` is deliberately not an auditable entity
The entity (Infrastructure `Persistence/AuditTrail/AuditTrailEntry.cs`) does **not** implement
`IAuditableEntity`, mirroring `OutboxMessage`. It therefore has no audit stamps of its own and no
soft-delete query filter. Its columns are `Id` (Guid), `EntityType`, `EntityKey`, `PropertyName`,
`OldValue` and `NewValue` (string, nullable), `Operation` (`Added` / `Modified` / `Deleted`), `ChangedBy`,
`ChangedOn`, `CorrelationId`, and a nullable `TenantId` populated when tenancy is active.

### Capture is a change-tracker diff committed in the caller's transaction
`SavingChangesAsync` walks `ChangeTracker.Entries()` and keeps the entities carrying the marker
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:199`,
`:228-231`). For a `Modified` entity it compares `OriginalValue` against `CurrentValue` for each modified
property and adds one row per property whose value actually changed, skipping concurrency tokens and
properties flagged modified but holding an equal value (`:303-312`); a changed owned value object is
captured as `navigation.property` rows, including on an owner left `Unchanged` (`:258-261`, `:394`). An
`Added` or `Deleted` entity writes a single summary row with a null `PropertyName` (`:265-274`;
`.../AuditTrail/AuditTrailEntry.cs:18-22`). Every row goes through `context.Set<AuditTrailEntry>().Add(...)`
(`:446`) into the same `SaveChanges` call as the data, so it commits or rolls back with it: the outbox
mechanic of ADR-003, applied to a different payload. One exception: an inserted entity with a
store-generated key has only a temporary key at capture, so after the save the interceptor rewrites that
row's `EntityKey` (`:276-282`): it loops over the pending rows and issues one `UPDATE` per row, filtered
by that row's `Id`, as `ExecuteUpdateAsync` on the async save path (`:498`, `:507-509`) and
`ExecuteUpdate` on the sync one (`:541-543`), so an audited save inserting N such entities adds N
`UPDATE` statements. Each joins the ambient transaction when one is open; without one it commits
after the data save, so a crash in that window leaves the row holding the temporary key.

Two mechanics are copied verbatim from `DomainEventSaveChangesInterceptor`:

- **A `DiscardAbandonedCapture` equivalent.** `EnableRetryOnFailure` re-runs `SavingChanges` against a
  change tracker that still holds the previous attempt's Added rows, so without an explicit discard one
  transient SQL fault writes the trail twice.
- **Mutation through `Add` only.** The save runs under `DetectChangesOnce` with automatic change detection
  off, so anything that relies on a later detection pass to be noticed is not noticed.

### PII is redacted at capture, never at read
Any property carrying `[Pii]` records `PiiRedactor.RedactedToken`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Privacy/PiiRedactor.cs:27`, the class at `:24`) for both the
old and the new value. The trail stores the fact that a personal field changed, and never its contents.
Redacting on the way out instead would leave clear-text personal data at rest in a store that by
construction survives the erasure of the row it describes.

### Opt-in is a marker interface, plus a settings section
`IAuditedEntity` (Domain) is an empty marker. An entity is audited because someone wrote the interface on
it, which is what keeps volume a deliberate decision rather than a framework-imposed tax.
`AuditTrailSettings` binds section `AuditTrail` (`Enabled` default false, `RetentionDays` default 90 and
bounded `[Range(1, 3650)]`, and `DataSource` default `SQLServer`, the engine whose `Default` database
the reader queries;
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSettings.cs:26`,
`:37-38`, `:46`; consumed at `AuditTrailReader.cs:53`) through the ADR-070 fail-fast chain, which runs
`ValidateDataAnnotations` plus `ValidateOnStart` (`DependencyInjection.Jobs.cs:110-113`). Cosmos is
documented as unsupported for `DataSource` (`AuditTrailSettings.cs:44`) but not validated: the property
carries no validation attribute (`:46`). `AddAuditTrail(configuration)`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Jobs.cs:108`) registers the
interceptor and the settings together, plus `IAuditTrailReader` (`:119`) and `AuditTrailCleanupJob` (`:124`).

### The table lives in every relational source that adopts it
`ApplicationDbContext.OnModelCreating` (`.../ApplicationDbContext.cs:417`) calls
`ConfigureAuditTrail(modelBuilder)` (`:436`, the method itself at `:848`), gated on the settings flag
resolved from the root provider the way the interceptors are (`:332`, checked at `:850`), creating a
`dbo.AuditTrailEntries` table (`:857`) with two indexes: `IX_AuditTrailEntries_Entity` on
`(EntityType, EntityKey, ChangedOn)` for the read path (`:868-869`) and `IX_AuditTrailEntries_ChangedOn`
for the retention sweep (`:874-875`). A same-transaction write requires the table in the same database as
the data, which is the outbox precedent (ADR-006) and the reason the trail is not one central store.
Cosmos skips it: the `CosmosDbContext` `OnModelCreating` override
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/CosmosDbContext.cs:119`) does
not call the base, so it never reaches `ConfigureAuditTrail`, and the audit trail is among the
relational-only tables it leaves out (`:139-140`). The interceptor's model check then makes capture a
no-op there too (`AuditTrailSaveChangesInterceptor.cs:181-184`).

### Retention is the framework's first scheduled job
`AuditTrailCleanupJob` ships as the first `IScheduledJob` (ADR-074), purging rows older than
`RetentionDays`. The framework dogfoods its own scheduler rather than shipping a second periodic
mechanism. There is no fallback: the job runs only when the host also calls `AddScheduledJobs` and sets
`Scheduler:Enabled`, and without that the trail still records but nothing is purged, `RetentionDays` is
inert and pruning is the operator's job
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Jobs.cs:97-101`).

### The read surface is one interface
`IAuditTrailReader` (Application) with an Infrastructure implementation querying by
`(EntityType, EntityKey)`, which is exactly the index. No controller and no UI ship in v1: a change
history is a surface with real authorization and presentation opinions, and consumers hold those opinions.

Adoption in the consumer sweep is seven relational sources, each with its own migration: ADC's Identity,
Conference and Engagement services (its Notification service does not call `AddAuditTrail` and has no
trail migration), Store's Catalog, Sales and Identity services (Store is database-per-service, so each
adopts separately rather than sharing one database), and Helpdesk's Tickets.

## Rationale
- **`IAuditableEntity` is a statement about a business row, and an audit row is not one.** The interface
  means "this row stamps who created and last modified it and participates in soft-delete". An audit row
  has no author beyond the write that produced it, so the stamps would be noise; it must never be
  soft-deleted, because a soft-deleted audit row is a rewritten history that a query filter quietly hides;
  and it would recurse if the stamping interceptor touched it, since stamping is itself a change.
  `OutboxMessage` made the same call for the same three reasons, and matching it keeps one rule for
  infrastructure rows rather than two.
- **The change tracker is the only place the diff actually exists.** EF has already resolved which
  properties changed and holds both values; a decorator above it would have to re-read the row to
  reconstruct what EF discarded, and a database trigger would have the values but none of the identity,
  correlation or `[Pii]` context that makes the row useful.
- **Same-transaction is the difference between a trail and a hint.** A trail written after the commit is
  lost by a crash in the window, and a trail that can be lost is one nobody can rely on in the argument it
  exists to settle. The outbox has run this exact mechanic in production for the whole life of the
  framework, so this is a proven path rather than a new one.
- **Running last is what makes the captured values final.** Capturing before the stamp interceptor
  would record a stale `LastModifiedBy` on rows the same save is about to correct (the trail's own
  `TenantId` comes from the context's current tenant, so it does not depend on order), which is worse than not capturing at all: a wrong history reads exactly like a right
  one.
- **Redacting at capture is the only version that survives erasure.** ADR-005 anonymizes a row in place on
  a data-subject request. If the trail held the old clear-text value, erasure would delete the data from
  the row and leave it in the history, so the compliance path would be defeated by the audit path.
- **Opt-in per entity keeps the cost proportional to the value.** A framework that audited everything
  would multiply every consumer's write volume for rows nobody will ever ask about. The marker makes the
  cost a per-entity decision made by the team that knows which rows get argued over.
- **Reusing the scheduler proves the scheduler.** Retention is a real recurring job with a real failure
  mode, so making it the first `IScheduledJob` exercises ADR-074 in the framework's own code rather than
  waiting for a consumer to be the first to find out.

## Trade-offs
- **Write amplification is real and it is on the caller's latency path.** An update that changes twenty
  properties writes twenty rows inside the caller's transaction (an insert or a delete writes one summary
  row), so an audited save is slower than an
  unaudited one, and the trail is not a beside-the-request concern the way a background publish is.
- **A per-source table makes cross-database history a fan-out.** "What happened to this user across the
  whole system" is a query against ADC's three audited databases, and the framework does not ship that
  query.
- **Values are strings, so a reader gets a rendering rather than a value.** A decimal, an enum and a date
  all arrive as text formatted at capture time, and a large column is stored at whatever length it had.
- **Redact-at-capture is irreversible, which is the point and also a limit.** A `[Pii]` field's old value
  is gone from the trail forever, so the trail can never answer "what was this email address before it
  changed".
- **The marker is per entity, not per property.** Opting an entity in captures every changed property it
  has except its concurrency token, including the ones nobody wanted a history of; a `[Pii]` property
  still gets a row, with the redacted token in both value columns.
- **Nothing enforces the interceptor ordering.** It is registration order held by review, with no fitness
  test asserting it, and a fifth interceptor inserted in the wrong position silently changes what the
  trail sees rather than failing anything.
- **Retention is a purge, not an archive.** Rows past `RetentionDays` are deleted with no cold-storage
  path in v1, so the answer to a question older than the window is that there is no answer.
- **Cosmos-backed sources get no trail at all.** The engine that cannot join the transaction is simply
  skipped, so a consumer's audit coverage is decided by ADR-018 placement rather than by intent.
- **No shipped read surface means the capability is invisible until someone builds one.** Rows accumulate
  from the day `AddAuditTrail` is called; nobody sees them until a consumer writes a page or an endpoint
  over `IAuditTrailReader`.

## Revision (2026-09-07)
Two additions from the 2026-09-07 security review.

1. **The `[Pii]` convention is now checked in both directions** (SEC-Store-19 / SEC-Store-24). The
   shared base already obliged a `[Pii]` property's entity to be anonymizable. Store adds the reverse
   assertion: whatever `Anonymize()` actually overwrites must carry `[Pii]`
   (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Governance/PiiConventionTests.cs:76`),
   with a companion test that every anonymizable domain entity is covered by a sample so the first
   test cannot pass vacuously (`:55`). This catches the failure mode the forward rule cannot: a field
   the erasure path overwrites but the attribute does not cover keeps its pre-erasure value in the
   audit trail's `OldValue` for the full retention window (`:106`), which is an erasure promise
   broken by the record that exists to prove erasure happened.
2. **The trail is backstopped by database-level auditing** (SEC-Store-21). The application owns its
   own trail table, so an actor with write access to the database can edit the evidence. Both apps
   deploy SQL auditing to the Log Analytics workspace, and both record `UPDATE` and `DELETE`
   statements against the trail table there, outside the application's reach, by different means
   (see the 2026-09-25 revision below). That makes the trail tamper-evident, not tamper-proof: the
   same credential can still rewrite the table, but a rewrite leaves a trace somewhere that
   credential cannot reach.

## Revision (2026-09-25): both apps record trail DML, by different means
Revision item 2 above previously held for Store only: ADC's server-level audit carried no statement
auditing, so a rewrite of `dbo.AuditTrailEntries` by the shared admin login left no record. Both apps
now record trail DML, each shaped by its own volume decision.

- **Store: statement auditing at the server.** `sqlAuditingSettings`
  (`MMCA.Store/infra/main.bicep:894`) lists `BATCH_COMPLETED_GROUP` plus the two authentication groups
  (`:875-878`), routed through a `SQLSecurityAuditEvents` diagnostic setting on the master database
  (`:852`). The rationale, including why the batch group is the only way to cover the trail table at
  server scope, is at `:822-846`. The batch group records every statement, so the workspace daily cap
  is sized for it (`MMCA.Store/infra/foundation.bicep:57`, `dailyQuotaGb: 3`).
- **ADC: object-scoped auditing per database.** The server-level policy `sqlServerAuditing`
  (`MMCA.ADC/infra/main.bicep:872`) stays authentication, principal, role, permission and schema-change
  groups only (`:878-885`), with no statement group, for volume (`:863-869`). A database-level policy,
  `auditTrailDmlAuditing` (`:1026`), adds `UPDATE ON dbo.AuditTrailEntries BY public` and
  `DELETE ON dbo.AuditTrailEntries BY public` (`:1034-1035`) on the three databases that carry the trail
  (`auditTrailDatabaseNames`, `:1004`), each with its own `SQLSecurityAuditEvents` diagnostic setting
  (`auditTrailDiagnostics`, `:968`). The rationale is at `:938-961`. Because the trail is append-only in
  normal operation, these actions fire on tampering and on the retention purge only, and the daily cap
  is unchanged. `SqlAuditConventionTests`
  (`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Governance/SqlAuditConventionTests.cs:12`)
  pins both actions in `main.bicep` (`:17`) and the database list (`:36`).

## Revision (2026-10-01): retention has no fallback, and the current-state text matches the code
- **Retention runs on the scheduler or not at all.** The Decision previously named a
  `PeriodicBackgroundService` subclass as the fallback for a host without the scheduler. No such class
  exists: `AddAuditTrail` registers `AuditTrailCleanupJob` as a scheduled job
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Jobs.cs:124`), and without
  `AddScheduledJobs` plus `Scheduler:Enabled` nothing is purged and `RetentionDays` is inert (`:97-101`).
- **Opt-in is three gates, not two.** `AuditTrail:Enabled` defaults to false
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSettings.cs:26`)
  and gates both the table (`.../ApplicationDbContext.cs:333`, `:852`) and capture, since the interceptor
  returns when the model has no `AuditTrailEntry`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:183`).
  `AddAuditTrail` also registers `IAuditTrailReader` (`DependencyInjection.Jobs.cs:119`).
- **The table carries a second index**, `IX_AuditTrailEntries_ChangedOn`, for the retention sweep
  (`.../ApplicationDbContext.cs:876-877`).
- **The ordering rationale no longer claims a null `TenantId`.** The trail row's `TenantId` is read from
  the context's current tenant (`AuditTrailSaveChangesInterceptor.cs:194`), not from the stamped entity,
  so only the stale `LastModifiedBy` half depends on running last.
- **A `[Pii]` property is captured, redacted.** The Trade-offs entry previously said only non-PII
  properties are captured; every changed property gets a row, a personal one with the redacted token on
  both sides (`AuditTrailSaveChangesInterceptor.cs:303`).
- Anchors refreshed: `ApplicationDbContext.cs` interceptor block `:298-323`, `OnModelCreating` `:417`,
  `ConfigureAuditTrail` `:436` / `:850`; `CosmosDbContext.cs` `SupportsOutbox` `:121`; `AddAuditTrail` now
  cited in `DependencyInjection.Jobs.cs:108`. The bicep anchors in the 2026-09-25 revision have since moved
  (Store `MMCA.Store/infra/main.bicep:885`, ADC `MMCA.ADC/infra/main.bicep:846` and `:1003`) and are left
  as recorded there; the auditing content is unchanged.

## Revision (2026-10-06): row shape, the key fix-up, and current anchors
- **Only an update writes one row per changed property.** An `Added` or `Deleted` entity writes a single
  summary row with a null `PropertyName`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:265-274`),
  concurrency tokens and flagged-but-equal values are skipped (`:305`, `:312`), and owned value-object
  changes are captured as `navigation.property` rows (`:394`). The Decision and Trade-offs now say so.
- **The trail is not strictly append-only.** An inserted entity with a store-generated key gets its row's
  `EntityKey` rewritten by an `ExecuteUpdate` after the save (`:276-282`, `:507-509`), outside the
  transaction when none is open. ADC's audited `User`, `Event`, `CheckIn` and `PointsEntry` carry
  `[IdValueGenerated]` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:33`,
  `.../Conference/MMCA.ADC.Conference.Domain/Events/Event.cs:23`,
  `.../Engagement/MMCA.ADC.Engagement.Domain/CheckIns/CheckIn.cs:27`,
  `.../Engagement/MMCA.ADC.Engagement.Domain/Points/PointsEntry.cs:30`), which makes their keys
  store-generated on SQL Server
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DataSources/Engines/SQLServerDataSourceEngine.cs:103-104`).
  So the 2026-09-25 statement that ADC's `UPDATE ON dbo.AuditTrailEntries BY public` action
  (`MMCA.ADC/infra/main.bicep:1034`) fires on tampering and the retention purge only no longer holds: it
  also fires on every insert of those entities. The actual audit volume was not measured.
- **`dotnet ef` needs only the two required interceptors.** The design-time helper registers all four,
  but omitting the tenant or audit-trail one would still work (`DesignTimeDbContextHelper.cs:162-164`).
- **Cosmos no longer cites `SupportsOutbox`**, which does not exist; the skip is the `OnModelCreating`
  override that does not call the base (`CosmosDbContext.cs:119`, `:139-140`).
- **Current locations for anchors recorded in older revisions.** `ApplicationDbContext.cs`: interceptor
  block `:297-322`, `OnModelCreating` `:416`, `ConfigureAuditTrail` call `:435` and method `:847`, flag
  `:332` checked at `:849`, indexes `:867-868` and `:873-874`. `AuditTrailSaveChangesInterceptor.cs`: the
  no-`AuditTrailEntry` gate `:184`, `TenantId` from the context `:195`, both sides redacted at `:324-325`
  (scalar) and `:395-396` (owned). Store `MMCA.Store/infra/main.bicep`: `sqlAuditingSettings` `:885`,
  `BATCH_COMPLETED_GROUP` `:895`, the two authentication groups `:896-897`, `sqlAuditDiagnostics` `:871`
  (category `:878`), rationale `:841-865`. ADC `MMCA.ADC/infra/main.bicep`: `sqlServerAuditing` `:872`,
  groups `:879-885`, `auditTrailDiagnostics` `:1010`, rationale `:979-1003`, `auditTrailDatabaseNames`
  `:1004`, `auditTrailDmlAuditing` `:1026` (the 2026-10-01 note's `:846` and `:1003` were wrong).
- Every anchor in the live sections was re-verified against current source.

## Revision (2026-10-07): per-row key fix-up, the reader's data source, and current anchors
Re-verified against current source. The capture mechanics, the row shape, the opt-in gates, the
redaction rule, the Cosmos skip and both apps' SQL-auditing content are unchanged; no fitness test
asserts interceptor ordering (none in `MMCA.Common.Testing.Architecture` references an interceptor) and
no controller or UI in ADC, Store or Helpdesk `Source/` consumes `IAuditTrailReader`, so those Decision
and Trade-offs statements stand. What moved is one description, one omitted setting, the design-time
omission note and the anchors.

1. **The key fix-up is one statement per row, not one for all rows.** The Decision previously described
   a single set-based `ExecuteUpdate`. The interceptor loops over the pending rows and issues one
   `UPDATE` per row, filtered by that row's `Id`: `ExecuteUpdateAsync` on the async path
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:498`,
   `:507-509`) and `ExecuteUpdate` on the sync path (`:541-543`). Each one is set-based in the sense the
   method's own doc comment uses (it bypasses the change tracker, `:482-484`). This matches ADC's bicep note of "one UPDATE per row" (`MMCA.ADC/infra/main.bicep:1012-1016`).
2. **`AuditTrailSettings` has a third property.** `DataSource` (default `SQLServer`) names the engine
   whose `Default` database `IAuditTrailReader` queries
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSettings.cs:46`,
   consumed at `AuditTrailReader.cs:53`). Cosmos is documented as unsupported (`:44`) but not
   validated, since the property has no validation attribute and `AddAuditTrail` runs only
   `ValidateDataAnnotations` plus `ValidateOnStart` (`DependencyInjection.Jobs.cs:110-113`); `RetentionDays` is bounded `[Range(1, 3650)]` (`:37`). The
   Decision now lists all three.
3. **The design-time omission note cites the context, not only the helper.** The helper's comment covers
   the audit-trail interceptor alone (`DesignTimeDbContextHelper.cs:162-164`); the tenant interceptor's
   optional resolution is `ApplicationDbContext.cs:305`.
4. Anchors re-verified against current source: `ApplicationDbContext.cs` interceptor block `:297-322`
   (`GetRequiredService` `:297-298`, `GetService` `:305` and `:319`, `AddInterceptors` `:321`), flag
   `:332`, `OnModelCreating` `:417`, `ConfigureAuditTrail` call `:436` and method `:848`, flag checked
   `:850`, `ToTable` `:857`, `IX_AuditTrailEntries_Entity` `:868-869`, `IX_AuditTrailEntries_ChangedOn`
   `:874-875` (the 2026-10-06 list's `:416`, `:435`, `:847`, `:849`, `:867-868`, `:873-874` were correct
   when recorded and moved down one line when Common #518 added a comment line at `:391`); `AuditTrailEntry.cs` row-shape paragraph `:18-22`; ADC `MMCA.ADC/infra/main.bicep`:
   `sqlServerAuditing` `:888`, groups `:895-901`, server volume rationale `:879-887`, trail-DML
   rationale `:995-1023`, `auditTrailDatabaseNames` `:1024`, `auditTrailDiagnostics` `:1030`,
   `auditTrailDmlAuditing` `:1046`, `UPDATE` and `DELETE` actions `:1054-1055`. The older anchors in the
   dated revisions above are left as recorded.

## Related
[ADR-003](003-outbox-dual-dispatch.md) (the same-transaction write this copies wholesale, including the
retry-discard and the `Add`-only mutation rule),
[ADR-005](005-soft-delete-vs-erasure.md) (soft-delete, `[Pii]` and erasure: why the trail redacts at
capture and why its rows are purged rather than soft-deleted),
[ADR-073](073-multi-tenancy-model.md) (the interceptor that runs immediately before this one, and the
source of the nullable `TenantId` column), [ADR-074](074-recurring-job-scheduler.md) (the scheduler that
runs the retention purge, and its first consumer),
[ADR-070](070-fail-fast-configuration-contract.md) (the validating chain `AuditTrailSettings` binds
through), [ADR-006](006-database-per-service.md) (why the table is created per relational source rather
than once), [ADR-018](018-polyglot-persistence.md) (the engine axis, and why a Cosmos-backed source opts
out), [ADR-035](035-optimistic-concurrency.md) (the `RowVersion` token that makes a diffed update
deterministic: without it two concurrent writers can produce a history that never happened).
