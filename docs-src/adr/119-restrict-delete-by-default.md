# ADR-119: Delete Behavior Is an Explicit Business Rule (Restrict by Default)

## Status
Accepted (2026-09-11). Inverts EF Core's cascading default for every relationship in every repo built
on this framework, and stamps each foreign key with where its delete behavior came from.

## Context
EF Core picks a delete behavior for you. A required relationship gets `Cascade`, an optional one gets
`ClientSetNull`, and neither choice appears anywhere a reviewer reads. The consequence is a database
constraint that deletes rows below the aggregate that owns them: below the invariants the aggregate
root exists to enforce, below the soft-delete filter, and below the domain events the rest of the
system reacts to.

Across the three applications built on this framework, exactly **two** delete behaviors were ever
written down. ADC restricts Session to Room
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/Sessions/SessionConfiguration.cs:95`)
and Store cascades Product image data
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Infrastructure/Persistence/EntityConfiguration/ProductImageDataConfiguration.cs:35`).
Every other foreign key in ADC, Store and Helpdesk took EF's default: required relationships cascade,
optional ones null out on the client. Those defaults are already encoded in the migrations and are
already the shape of the deployed schemas.

The obvious objection is that this is theoretical, and it is worth stating why it is not. These
applications soft-delete: entities set `IsDeleted` and global query filters exclude them
([ADR-005](005-soft-delete-vs-erasure.md)), so at runtime today no cascade ever fires from ordinary
application code. The genuine hard deletes are narrow and deliberate: the framework's own cleanup
jobs against leaf tables (audit trail retention at
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailCleanupJob.cs:169`,
refresh sessions at `.../Persistence/Auth/RefreshSessionCleanupService.cs:124`, permission grants at
`.../Persistence/Auth/EFPermissionGrantStore.cs:124`, internal commands at
`.../Persistence/InternalCommands/Administration/InternalCommandAdministration.cs:227`) and ADC's
session-score replacement
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/UseCases/DecisionSupport/ScoreEventSessions/SessionScoringRunner.cs:104`).

But the FK constraint is not a runtime detail. It is what the migration writes into the database, and
it is what would fire the day somebody writes a genuine hard delete, runs a data-repair script, or a
DBA cleans a table by hand. A cascade nobody chose is a decision made by a default and discovered by
an incident. The question this record answers is not "what happens today" but "what does the schema
say we intend".

## Decision
**Restrict is the default delete behavior for every relationship nobody configured, a cascade is an
opt-in with a stated reason, and the finished model records which of the two each foreign key is.**

1. **A model-finalizing convention supplies the default.** `RestrictDeleteByDefaultConvention`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/RestrictDeleteByDefaultConvention.cs:41`)
   walks every declared foreign key on the finalized model (`:72-79`) and, when the delete behavior
   has no configuration source or has only EF's own convention as its source (`:98`), sets
   `DeleteBehavior.Restrict` (`:100`). A behavior anybody configured, fluently or by attribute, is
   kept exactly as configured: this convention never overrides a decision (`:105`).

2. **Every foreign key is stamped with where its behavior came from.** The annotation
   `MMCA:DeleteBehaviorSource` (`:47`) carries one of `Explicit` (`:50`), `Convention` (`:53`) or
   `Ownership` (`:56`), so a finished model can be audited without re-running the convention.

3. **Ownership foreign keys are left alone.** An owned type has no identity apart from its owner and
   EF requires that cascade rather than offering it, so the convention stamps `Ownership` and moves
   on (`:89-93`).

4. **Cosmos is a no-op.** The provider has no foreign key constraints to restrict, and stamping a
   delete-behavior decision on a model that cannot enforce one would only make the audit lie
   (`:65-68`).

5. **It is registered on the one base context, after the other two finalizing conventions.**
   `ApplicationDbContext.ConfigureConventions`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:328`)
   adds it at `:349`, deliberately last of the three, so it never stamps a relationship the
   cross-source degrade convention has already removed. Because there is one context class per engine
   over one abstract base ([ADR-006](006-database-per-service.md)), that single registration reaches
   every module, every database and every repo.

6. **Two fitness functions read the stamp back off the finished model.**
   `DeleteBehaviorConventionTestsBase`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Domain/DeleteBehaviorConventionTestsBase.cs:21`)
   exposes `CascadingDeletes_AreExplicitlyOptedIn` (`:30`) and `ConventionDeletes_AreRestricted`
   (`:33`) over the rule bodies in
   `Rules/Domain/ArchitectureRules.DeleteBehavior.cs`: any `Cascade` or `ClientCascade` must carry
   source `Explicit` (`:34`), and any foreign key sourced `Convention` must be `Restrict` (`:65`). A
   subclass supplies `dbContext.Model` from a context built the way the app builds it, so no database
   server is needed: the model is what is asserted. The base points at relational models only, since
   a Cosmos model carries no stamps.

7. **A cascade keeps its reason next to it.** Opting in means writing
   `.OnDelete(DeleteBehavior.Cascade)` in the entity configuration with the business reason beside
   it, which is what turns "the schema happens to cascade here" into a rule somebody can review.

## Rationale
- **The safe default is the one that fails loudly.** Restrict turns an unintended parent delete into
  an error at the point of the delete, where it can be read and fixed. Cascade turns it into missing
  rows discovered later, with no record of what removed them.
- **Soft delete is a reason to fix this, not a reason to skip it.** Because cascades never fire in
  normal operation, nothing in testing or production would ever have surfaced them. That is exactly
  the profile of a latent hazard: invisible until the one script that triggers it.
- **The annotation is what makes the rule auditable.** Asserting "this model does not cascade" is
  weak; asserting "every cascade in this model was chosen, and everything the convention touched
  restricts" is the property that actually holds, and it needs the provenance stamp to be checkable
  at all.
- **One registration on one base context is the whole adoption story.** The per-engine context design
  ([ADR-006](006-database-per-service.md)) is what makes a persistence-wide behavior change a
  framework change rather than a per-module sweep, the same way a fourth engine was
  ([ADR-113](113-postgresql-as-a-first-class-engine.md)).
- **Never overriding an explicit configuration** keeps the convention additive. The two behaviors
  that were already written down keep working exactly as written, and are simply stamped `Explicit`.

## Trade-offs
- **One migration per service database at the next framework bump.** The FK constraints change, so
  each database needs a migration: four in ADC, three in Store, one in Helpdesk. MMCA.Common's own
  tables (outbox, inbox, internal commands, scheduler, audit trail, refresh sessions, permission
  grants, notifications) declare no relationships between each other
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Domain/DeleteBehaviorConventionTests.cs:21-26`),
  so nothing flips inside the framework and its own gate passes vacuously today. That is the point of
  a vacuous gate: the day a framework table gains a relationship, the test decides whether its delete
  behavior was a decision or an accident, before consumers inherit it in a migration.
- **Optional relationships move too, from `ClientSetNull` to `Restrict`.** A client-side null-out is
  the third behavior nobody chose either, and it silently rewrites a foreign key column in memory. A
  relationship that genuinely should null out on delete now has to say so.
- **A real cascade becomes more work to add.** Someone who wants one writes a line and a reason
  instead of inheriting it. That is the intended cost.
- **SQL Server's multiple-cascade-path limit only bites where a configuration opts in.** Restrict
  cannot create a cycle, so the error class that most often forces a schema redesign now appears
  exactly where a human chose a cascade, which is the one place it is diagnosable.
- **The fitness functions assert the model, not the database.** They prove what the next migration
  will write, not what an already-deployed schema contains. The two converge once each database has
  taken its migration, and drift in between is the ordinary migrations-pending state.
- **Cosmos-backed entities get no coverage from this rule**, by construction. The audit says nothing
  about them because the model cannot carry the claim.

## Related
[ADR-006](006-database-per-service.md) (one context class per engine over one abstract base, which is
what makes this a single registration),
[ADR-005](005-soft-delete-vs-erasure.md) (the soft-delete posture that keeps cascades dormant at
runtime and hides them from testing),
[ADR-015](015-architecture-fitness-functions.md) (the shared rule library the two new rules join),
[ADR-018](018-polyglot-persistence.md) and
[ADR-113](113-postgresql-as-a-first-class-engine.md) (the engine axis the convention branches on),
[ADR-016](016-lockstep-versioning-masstransit-pin.md) (the lockstep release the migrations ride in
on).
