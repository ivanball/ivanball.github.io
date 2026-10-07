# ADR-107: Transaction Execution and Commit-Ambiguity Contract

## Status
Accepted (2026-09-03; adoption counts and consumer state re-measured 2026-09-19).
Revised 2026-09-25 (MMCA.ADC's `ITransactional` count corrected to six, adding
`BatchAddEventQuestionAnswersCommand`; the direct-caller anchors and the Store package pin refreshed;
Store's `CheckOutHandler` documentation now cites this record for the commit-once behavior and names
all three pre-flight reads, so the two trade-offs that described its comments as stale are retired).
Revised 2026-10-01 (the commit phase now saves enrolled internal-command rows and refuses any other unsaved
tracked change before committing, and MMCA.ADC's count is five with `RefreshFromSessionizeCommand` a documented
opt-out; see Revision below).
Revised 2026-10-06: the commit phase also releases the internal-command processor wake after a successful commit
and drops it on every other path, MMCA.ADC's count is six with `DeleteSessionAssetCommand`, and three more ADC
direct callers are listed.
Revised 2026-10-07: anchors refreshed after the v1.233.0 release.

## Context
Every transactional write in this workspace funnels through one method. `IUnitOfWork.ExecuteInTransactionAsync`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Persistence/IUnitOfWork.cs:63`) is the
Application-layer name for it, `UnitOfWork` forwards straight through
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/UnitOfWork.cs:91-94`), and the implementation is
`DbContextFactory.ExecuteInTransactionAsync`
(`.../Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:551`, contract at
`.../Factory/IDbContextFactory.cs:70`). Two kinds of caller reach it: the ADR-014 pipeline, whose
`TransactionalCommandDecorator` calls it for any command carrying `ITransactional`
(`.../Application/UseCases/Decorators/TransactionalCommandDecorator.cs:33`), and a handler or service that calls it
directly.

The name suggests "begin, do work, commit". The behavior is materially more specific, and every one of those
specifics is a durability decision. The delegate runs under EF Core's execution strategy, which for SQL Server is a
retrying one: `EnableRetryOnFailure(maxRetryCount: 5, maxRetryDelay: TimeSpan.FromSeconds(10))`
(`.../Persistence/DbContexts/SQLServerDbContext.cs:63-66`). So the delegate can run more than once, the change
tracker has to be reset between attempts, in-process event dispatch has to be held back until the data is durable,
and a failure of the commit itself must not be retried at all because its outcome is unknown.

The neighbouring records decide around this without deciding it. ADR-014 decides that the Transactional decorator
wraps a command and rolls back on failure, including on a returned failed `Result`. ADR-006 lists "no cross-database
FKs or transactions" as a trade-off of database-per-service (`006-database-per-service.md:56`). ADR-054 cites
"transactions are per data source and best-effort sequential" as a given it builds compensation on top of
(`054-saga-compensation-and-reconciliation.md:131`). Nothing in ADR-001 through ADR-106 records the execution,
retry and ambiguity contract itself, which is the layer all three depend on.

## Decision
**`ExecuteInTransactionAsync` is a re-entrant, retriable, commit-once unit: the whole delegate is the retriable
work, the commit phase is deliberately outside the retry, and a commit whose outcome cannot be known is reported as
`TransactionCommitAmbiguousException` naming what each physical source did rather than being retried or swallowed.**

1. **One entry point, per-scope state.** `IDbContextFactory` and `IUnitOfWork` are both registered scoped
   (`.../Infrastructure/DependencyInjection.cs:108`, `:130`), and the transaction flag is an instance field
   (`DbContextFactory.cs:87`), so the whole contract below is per request scope. `BeginTransaction` enlists every
   transaction-capable context and skips one already carrying a transaction (`:460-470`, `:468`); a context
   materialized later in the same scope is enlisted on creation (`:119-120`).

2. **A re-entrant call joins the ambient transaction instead of nesting.** When the flag is already set, the method
   awaits the operation and returns its result directly (`:562-563`). Begin, commit, rollback and the deferred-event
   flush belong to the outermost call alone (`:504-506`), because an inner commit would make the outer scope's
   earlier work durable ahead of its own decision. Before this, an `ITransactional` command whose handler also
   opened a transaction hit an `InvalidOperationException` from EF (`:555-561`). Two tests pin the behavior:
   `ExecuteInTransactionAsync_Nested_DoesNotThrowAndCommitsOnce` and
   `ExecuteInTransactionAsync_NestedInnerSucceedsButOuterFails_RollsBackEverything`
   (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/DbContexts/DbContextFactoryTransactionTests.cs:133`,
   `:163`).

3. **The whole delegate is the retriable unit, and each attempt starts from a clean change tracker.** The strategy
   comes from the first transaction-capable context, or from a default context created on the spot so one exists
   before the handler's first repository call; that default context's engine goes through the data-source resolver
   (`ResolveLogical`) rather than being taken literally as SQL Server (`:571-572`). The delegate is invoked inside
   `strategy.ExecuteAsync` (`:578-586`). From the second attempt on, `ResetForRetry` runs first (`:580-581`): it
   drops deferred dispatch and calls `ChangeTracker.Clear()` on every context (`:836-843`). Without it, entities the
   failed attempt added are still `Added` and the retry inserts them a second time, with a duplicate outbox row per
   event (`:525-530`). Anything the commit depends on therefore has to be produced inside the delegate, once per
   attempt.

4. **A returned failed `Result` rolls back exactly like a thrown exception.** The attempt inspects the result and
   calls `RollbackTransaction()` when `IsFailure` is true (`:615-621`), which is the ADR-013 accommodation: a
   framework that mandates Result-over-exceptions cannot let a handler that saves and then fails a later invariant
   leave the partial mutation committed. A thrown exception rolls back and rethrows (`:664-668`), and a cancellation
   takes a guarded path that falls back to dropping deferred work when the rollback itself throws on an
   already-closed connection (`:647-663`). On a successful result, `FlushEnrolledCommandsBeforeCommitAsync` runs
   ahead of the commit (`:625`): when every pending change is an `Added` `InternalCommandMessage` (an internal
   command scheduled after the handler's last save and enrolled on the context), it saves them inside the
   transaction so they commit with the caller's change, and any other unsaved tracked change throws
   `InvalidOperationException`, which the same catch turns into a rollback, because committing would silently
   discard it while the unit reported success (`:681-707`).

5. **The commit is never retried.** `TryCommit` returns its failure instead of throwing it (`:601-605`, `:627-629`)
   so the execution strategy sees a completed attempt, and the failure is thrown outside the strategy afterwards
   (`:592-593`). Throwing inside would not work: the strategy classifies retriability by walking the whole inner
   exception chain, so even a wrapper carrying the transient commit error would be retried (`:588-591`). The reason
   the commit is excluded is that its outcome is unknowable, since a commit can fail after the database applied it
   but before the acknowledgement reached the client, and a retry against a possibly-durable commit duplicates every
   write including the outbox rows (`:532-538`, and on the exception type at
   `.../Factory/TransactionCommitAmbiguousException.cs:9-13`).

6. **The failure names what each physical source did.** `TryCommit` snapshots the enlisted contexts in commit order,
   commits them in turn, and on a throw builds the ambiguity from three groups: the sources already committed, the
   one that threw, and the ones after it in the order that never committed (`DbContextFactory.cs:719-751`).
   `TransactionCommitAmbiguousException` is public and sealed (`TransactionCommitAmbiguousException.cs:22`) and
   exposes `CommittedSources` (`:76`), `AmbiguousSource` (`:85`) and `RolledBackSources` (`:93`); its message is the
   default ambiguity text plus a "Per-source outcome" clause that omits empty groups, so a single-source failure
   reads as one clause rather than three (`:99-118`). With one transactional source, the case every host runs today,
   the ambiguous source is the whole outcome (`:80-83`).

7. **Rollback after a commit failure is best-effort in the literal sense.** `AbandonAfterCommitFailure` rolls back
   whatever is still open and swallows a rollback that itself throws, on the grounds that the transaction is already
   zombied or the connection is gone and the commit ambiguity is the failure worth reporting
   (`DbContextFactory.cs:760-781`). A source listed in `RolledBackSources` therefore wrote nothing that survives
   (`TransactionCommitAmbiguousException.cs:88-91`).

8. **Deferred in-process dispatch is flushed only after a successful commit, and dropped on every other path.**
   Handlers deferred while a transaction is open are flushed per context immediately after the commit succeeds
   (`DbContextFactory.cs:639-643`, `.../Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:160`).
   `RollbackTransaction` drops them (`DbContextFactory.cs:484-495`, `DomainEventSaveChangesInterceptor.cs:177`), and
   so do `ResetForRetry` between attempts and `AbandonAfterCommitFailure` after an ambiguous commit (`:840`,
   `:766`). The processor wake owed by internal commands enrolled in the unit follows the same rule:
   `EnrolledCommandWake.Release` runs right after a successful commit and ahead of the event flush, so a throwing
   in-process handler cannot swallow it (`DbContextFactory.cs:631-634`, and `:481` in `CommitTransaction`), and
   every drop path above goes through `DropDeferredWork`, which drops the owed wake together with the deferred
   dispatch (`:850-854`; the remark at `:519-523`). The consequence is stated on the exception: after an ambiguous commit the outbox rows are the only delivery
   record that survives, and the outbox processor delivers them if the commit did land
   (`TransactionCommitAmbiguousException.cs:16-19`).

9. **The witness row that would close a partial multi-source commit is deliberately not built.** With several
   sources the commits are sequential, so a failure on the second leaves the first durable: the ambiguity is a
   partial commit rather than an unknown one, and the caller's replay is what reconciles it. A marker written inside
   each source's transaction that a replay could read to learn what landed would close this, and the code says it is
   not built because a single transactional source needs none (`DbContextFactory.cs:539-549`). Reporting the
   per-source outcome is what makes the partial state observable in the meantime.

10. **Cosmos is outside the mechanism entirely.** `SupportsTransactions` is true only for a relational engine
    (`context.Engine.Capabilities.IsRelational`, `DbContextFactory.cs:860-861`), so it is false for a Cosmos
    context, and begin, commit and rollback all filter on it (`:468`, `:475`, `:487`), so a
    Cosmos context in the same scope is neither enlisted nor rolled back and is never named in an ambiguity report.

11. **Recovery belongs to the caller, and today that means the ADR-017 idempotency filter.** The remarks say so
    (`:536-537`), and the exception is part of the frozen public surface
    (`.../MMCA.Common.Infrastructure/PublicAPI.Shipped.txt:531-539`), which is what makes it a contract a caller can
    bind to rather than an internal detail. No framework or consumer code catches it: across the four repos the type
    is referenced in code only by the two files that define it and by
    `.../MMCA.Common.Infrastructure.Tests/Persistence/DbContexts/DbContextFactoryCommitAmbiguityTests.cs`, whose five
    cases pin the no-rerun wrapper, the dropped dispatch, the ordinary commit path, the still-retried pre-commit
    failure and the per-source report (`:73`, `:108`, `:132`, `:152`, `:171`). The one consumer mention is prose:
    Store's `CheckOutHandler` remarks name it and hand recovery to the `[Idempotent]` filter
    (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/ShoppingCarts/UseCases/CheckOut/CheckOutHandler.cs:108-115`).

12. **Adoption is deliberately narrow.** MMCA.ADC has six `ITransactional` commands, five in Conference
    (`LinkUserToSpeakerCommand.cs:13`, `UnlinkUserFromSpeakerCommand.cs:12`,
    `BatchAddSessionQuestionAnswersCommand.cs:24`, `BatchAddEventQuestionAnswersCommand.cs:24`,
    `DeleteSessionAssetCommand.cs:16`) and Identity's
    `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserCommand.cs:22`,
    which carries the flag so the erasure lands as one write), plus one documented opt-out
    (`RefreshFromSessionizeCommand.cs:9`, "Deliberately NOT `ITransactional`", because its handler saves the
    throttle stamp on its own before the Sessionize call and then wraps the entity syncs and their save in an explicit
    transaction of its own, so it is a direct caller rather than a non-transactional path), MMCA.Store has three
    (`AddVariantCommand.cs:25`,
    `ReorderProductImagesCommand.cs:24`, `UploadProductImageCommand.cs:27`) plus four commands whose XML doc records
    a deliberate opt-out
    ("Deliberately NOT `ITransactional`": `VerifyPaymentCommand.cs:11`, `ProcessPaymentWebhookCommand.cs:9`,
    `CheckOutCommand.cs:9`, `BulkSetInventoryCommand.cs:11`), and MMCA.Helpdesk has none. Direct callers are the
    framework's own `EFRefreshSessionStore` rotation
    (`.../Infrastructure/Persistence/Auth/EFRefreshSessionStore.cs:134`), ADC's `AuthenticationService` for both
    registration and external login
    (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:86`, `:221`), ADC's
    `RefreshFromSessionizeHandler` (`RefreshFromSessionizeHandler.cs:149`), `DeleteSessionHandler` and
    `DeleteEventHandler` (`DeleteSessionHandler.cs:47`, `DeleteEventHandler.cs:43`, which open the transaction
    themselves because the shared CRUD delete command is not `ITransactional`), ADC's `SessionScoringRunner`
    (`SessionScoringRunner.cs:167`, in a scope of its own), and Store's `CheckOutHandler`
    (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/ShoppingCarts/UseCases/CheckOut/CheckOutHandler.cs:80`),
    `OrderCancelledSagaHandler` (`OrderCancelledSagaHandler.cs:55`) and `UserRegisteredHandler`
    (`UserRegisteredHandler.cs:65`).

## Rationale
- **Retrying the operation is safe; retrying the commit is not.** A transient failure before the commit leaves
  nothing durable, so re-running the delegate against a cleared change tracker is the cheap, correct recovery. A
  transient failure of the commit is a different class of event: the write may already exist. Splitting the two is
  the whole point of returning the commit failure out of the strategy instead of throwing it inside.
- **An unknown outcome should be reported, not guessed.** The alternatives are retrying (which duplicates whatever
  landed) or swallowing (which reports success for work that may not exist). Naming the ambiguity, with the provider
  failure as the inner exception, is the only option that leaves the caller able to do something correct.
- **Per-source outcomes cost nothing and make partial state observable.** The commit loop already knows the order it
  is walking, so recording which sources committed, which threw and which never ran is bookkeeping on a path that is
  already failing, and it turns "something went wrong somewhere" into a message a human can act on.
- **Joining a re-entrant call beats forbidding one.** The alternative is a convention that a handler under
  `ITransactional` must never open its own transaction, enforced by comments. Joining makes the nest one unit and
  removes a whole class of `InvalidOperationException` outright.
- **Post-commit dispatch keeps in-process handlers honest.** An in-process handler that runs inside an uncommitted
  transaction can act on state that then rolls back. Deferring the flush until after the commit, and dropping it on
  every failure path, means a handler only ever sees durable state, and the outbox remains the delivery guarantee
  for everything else (ADR-003).

## Trade-offs
- **The ambiguity is a hard failure the caller must handle, and today nobody catches it.** A host with no
  `[Idempotent]` coverage on the affected endpoint surfaces it as an unhandled exception. The contract moves the
  problem to where it can be solved; it does not solve it.
- **A multi-source commit can leave a genuine partial commit, and the reconciliation is manual.** The witness row is
  not built, so replay plus the outbox is the entire recovery story. That is acceptable only while every host runs a
  single transactional source, which is a property of today's deployments rather than a guarantee of the code.
- **The retry contract is a trap for handler authors.** Anything computed outside the delegate but committed inside
  it is silently wrong on the second attempt, and the change-tracker reset makes the failure quiet rather than loud.
  Store's `CheckOutHandler` documents exactly this: its class doc names the pre-flight that stays outside the
  delegate (the non-tracking cart snapshot plus the two cross-service gRPC reads, Catalog prices and the customer's
  display name, so their latency never holds database locks, `CheckOutHandler.cs:24-31`), the code does that
  pre-flight before opening the transaction (`:54-78`), and the write-phase remarks explain why the whole
  read-execute-write unit runs inside (`:99-107`) and why a commit failure is not retried (`:108-115`, citing this
  record for the behavior MMCA.Common shipped in v1.135.0, `MMCA.Common/CHANGELOG.md:3991`, and that Store consumes at
  v1.233.0, `MMCA.Store/Directory.Packages.props:11`). That is discipline, not enforcement: nothing checks that a
  new handler keeps its commit dependencies inside the delegate.
- **Cosmos participation is silent.** A Cosmos context in a transactional scope is skipped without a warning
  (`DbContextFactory.cs:860-861`), so a future host mixing engines gets partial atomicity with no signal at the call
  site.
- **The commit-order snapshot makes source order load-bearing.** `TryCommit` enumerates the context dictionary and
  that enumeration order is the commit order (`DbContextFactory.cs:725-728`), so which source is durable after a
  partial failure is determined by materialization order rather than by anything the caller declared.

## Revision (2026-10-01)
The commit phase gained a pre-commit step. Since v1.215.0 (`MMCA.Common/CHANGELOG.md:53`), a successful attempt
runs `FlushEnrolledCommandsBeforeCommitAsync` before `TryCommit` (`DbContextFactory.cs:653-654`, defined at
`:695-731`): internal-command rows enrolled after the handler's last save are saved inside the transaction and
commit with it, and any other unsaved tracked change throws `InvalidOperationException` and rolls the unit back
(`:688-692`) instead of being silently discarded. The default context created for the execution strategy now
resolves its engine through `_dataSourceResolver.ResolveLogical` (`:594-601`). Decision items 3 and 4 record both.
The re-entrant, retriable, commit-once and ambiguity rules are unchanged.

The 2026-09-25 count of six ADC `ITransactional` commands was true then and is stale now: `RefreshFromSessionizeCommand`
dropped the flag on 2026-09-30 (ADC #227) and is now a documented opt-out (`RefreshFromSessionizeCommand.cs:9`), so ADC has
five, four in Conference. MMCA.Store has three, since `AddVariantCommand` gained the flag in Store #171
(`AddVariantCommand.cs:25`). Every `DbContextFactory.cs` anchor was refreshed after the file grew, along with the
`IUnitOfWork`, `UnitOfWork`, `TransactionalCommandDecorator`, `DependencyInjection`, nested-transaction test,
`PublicAPI.Shipped.txt`, `CheckOutHandler` and CHANGELOG anchors, and the Store package pin (v1.216.0).

## Revision (2026-10-06)
- The commit phase now also wakes the internal-command processor: `EnrolledCommandWake.Release` runs right after a
  successful commit and before the event flush (`DbContextFactory.cs:631-634`, `:481`), and `DropDeferredWork`
  drops the owed wake on rollback, ambiguous commit and retry (`:850-854`). Decision item 8 records it.
- Decision item 10 now states what `SupportsTransactions` actually tests, the engine's relational capability
  (`context.Engine.Capabilities.IsRelational`, `:860-861`), rather than naming `CosmosDbContext`; the Cosmos
  outcome is unchanged.
- MMCA.ADC has six `ITransactional` commands, not five: `DeleteSessionAssetCommand` (`DeleteSessionAssetCommand.cs:16`)
  is a fifth Conference command. ADC's direct callers also include `DeleteSessionHandler` (`:47`),
  `DeleteEventHandler` (`:43`) and `SessionScoringRunner` (`:167`), and `AuthenticationService` moved to `:86`, `:221`.
- Store now consumes MMCA.Common v1.232.0 (`MMCA.Store/Directory.Packages.props:11`); the v1.135.0 CHANGELOG
  heading is at `MMCA.Common/CHANGELOG.md:3966` and the v1.215.0 heading cited in the 2026-10-01 revision is at `:390`.
- Every `DbContextFactory.cs`, `UnitOfWork`, `DependencyInjection` and `PublicAPI.Shipped.txt` anchor in the live
  sections was re-verified against current source and refreshed where it had moved.

## Revision (2026-10-07)
Re-verified against current source. The execution, retry, commit-once, ambiguity and deferred-dispatch
rules are unchanged, every live `DbContextFactory.cs` anchor still holds, and MMCA.ADC still has six
`ITransactional` commands; only the anchors and the Store package pin below moved.

1. Anchors re-verified against current source: `DomainEventSaveChangesInterceptor.FlushDeferredAsync`
   is at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs:160`
   and `DropDeferred` at `:177`; the `EFRefreshSessionStore` rotation calls `ExecuteInTransactionAsync` at
   `.../Persistence/Auth/EFRefreshSessionStore.cs:134`; the v1.135.0 CHANGELOG heading is at
   `MMCA.Common/CHANGELOG.md:3991`; Store consumes MMCA.Common v1.233.0
   (`MMCA.Store/Directory.Packages.props:11`).

## Related
[ADR-014](014-cqrs-decorator-pipeline.md) (the Transactional decorator that is the main caller, and whose
2026-07-19 revision decided the failed-`Result` rollback this record implements),
[ADR-006](006-database-per-service.md) (database-per-service, whose "no cross-database transactions" trade-off is
what makes the sequential best-effort commit the only option),
[ADR-054](054-saga-compensation-and-reconciliation.md) (compensation and reconciliation, which builds on the same
per-data-source best-effort commit, though it attributes that premise in-line to ADR-006 and does not reference this
record),
[ADR-003](003-outbox-dual-dispatch.md) (the outbox that survives an ambiguous commit, and the deferred in-process
dispatch that does not),
[ADR-013](013-result-pattern.md) (Result-over-exceptions, the reason a returned failure has to roll back),
[ADR-017](017-request-idempotency.md) (the `[Idempotent]` replay this contract names as the caller's recovery),
[ADR-009](009-resilience-and-recovery-objectives.md) (the resilience posture the retrying execution strategy and its
five-attempt budget sit inside).
