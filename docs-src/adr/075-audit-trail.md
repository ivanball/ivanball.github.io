# ADR-075: Audit Trail (Same-Transaction Field-Level Change History)

## Status
Accepted (2026-08-13; corrected 2026-08-14: the adoption sweep and the `ApplicationDbContext` line
citations). The implementation lands in the MMCA.Common "enterprise capability wave" release
and is opt-in twice over: `AddAuditTrail(configuration)` registers the interceptor and the settings, and
an entity is audited only when it carries the `IAuditedEntity` marker. Absent registration the interceptor
is not resolved and the whole feature is a no-op.

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
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:236-260`,
where `AuditSaveChangesInterceptor` and `DomainEventSaveChangesInterceptor` are resolved with
`GetRequiredService` and the tenant and audit-trail interceptors with `GetService`). The new one is
resolved with `GetService`, not `GetRequiredService` (`:258`): a host that never calls `AddAuditTrail`
resolves null, nothing is added to the pipeline, and the feature costs nothing.

**Registration order is execution order and it is load-bearing.** After the wave the sequence is
`AuditSaveChangesInterceptor` (stamps `CreatedBy/On` and `LastModifiedBy/On`), then
`TenantSaveChangesInterceptor` (ADR-073, stamps `TenantId`), then `DomainEventSaveChangesInterceptor`
(writes the outbox rows), then `AuditTrailSaveChangesInterceptor` last, so the diff it captures sees the
final stamped values rather than a half-populated entity. The audit-trail rows it adds are themselves
never audited. `DesignTimeDbContextHelper` registers all four, or `dotnet ef` breaks for every consumer.

### `AuditTrailEntry` is deliberately not an auditable entity
The entity (Infrastructure `Persistence/AuditTrail/AuditTrailEntry.cs`) does **not** implement
`IAuditableEntity`, mirroring `OutboxMessage`. It therefore has no audit stamps of its own and no
soft-delete query filter. Its columns are `Id` (Guid), `EntityType`, `EntityKey`, `PropertyName`,
`OldValue` and `NewValue` (string, nullable), `Operation` (`Added` / `Modified` / `Deleted`), `ChangedBy`,
`ChangedOn`, `CorrelationId`, and a nullable `TenantId` populated when tenancy is active.

### Capture is a change-tracker diff committed in the caller's transaction
`SavingChangesAsync` walks `ChangeTracker.Entries()`, keeps the entities carrying the marker, compares
`OriginalValue` against `CurrentValue` for each modified property, and adds one row per changed property
through `context.Set<AuditTrailEntry>().Add(...)`. The rows go into the same `SaveChanges` call as the
data, so they commit or roll back with it: the outbox mechanic of ADR-003, applied to a different payload.

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
`AuditTrailSettings` binds section `AuditTrail` (`Enabled`, `RetentionDays` default 90) through the
ADR-070 fail-fast chain, and `AddAuditTrail(configuration)` in Infrastructure's `DependencyInjection.cs`
registers the interceptor and the settings together.

### The table lives in every relational source that adopts it
`ApplicationDbContext.OnModelCreating` (`.../ApplicationDbContext.cs:304`) calls
`ConfigureAuditTrail(modelBuilder)` (`:326`, the method itself at `:572`), gated on the settings flag
resolved from the root provider the way the interceptors are, creating an `AuditTrailEntries` table with
an index on
`(EntityType, EntityKey, ChangedOn)`. A same-transaction write requires the table in the same database as
the data, which is the outbox precedent (ADR-006) and the reason the trail is not one central store.
Cosmos skips it, the way `CosmosDbContext` reports `SupportsOutbox => false`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/CosmosDbContext.cs:69`).

### Retention is the framework's first scheduled job
`AuditTrailCleanupJob` ships as the first `IScheduledJob` (ADR-074), purging rows older than
`RetentionDays`. The framework dogfoods its own scheduler rather than shipping a second periodic
mechanism; a `PeriodicBackgroundService` subclass is the fallback for a host that does not enable the
scheduler.

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
- **Running last is what makes the captured values final.** Capturing before the tenant and stamp
  interceptors would record a `TenantId` of null and a stale `LastModifiedBy` on rows the same save is
  about to correct, which is worse than not capturing at all: a wrong history reads exactly like a right
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
- **Write amplification is real and it is on the caller's latency path.** An entity with twenty changed
  properties writes twenty rows inside the caller's transaction, so an audited save is slower than an
  unaudited one, and the trail is not a beside-the-request concern the way a background publish is.
- **A per-source table makes cross-database history a fan-out.** "What happened to this user across the
  whole system" is a query against ADC's three audited databases, and the framework does not ship that
  query.
- **Values are strings, so a reader gets a rendering rather than a value.** A decimal, an enum and a date
  all arrive as text formatted at capture time, and a large column is stored at whatever length it had.
- **Redact-at-capture is irreversible, which is the point and also a limit.** A `[Pii]` field's old value
  is gone from the trail forever, so the trail can never answer "what was this email address before it
  changed".
- **The marker is per entity, not per property.** Opting an entity in captures every non-PII property it
  has, including the ones nobody wanted a history of.
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
