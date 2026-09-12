# ADR-054: Choreographed Saga Compensation with a Reconciliation Backstop

## Status
Accepted (2026-07-25). Amended (2026-07-28): Store's reconciliation sweep now derives from
`PeriodicBackgroundService`, so the shared-loop and adoption paragraphs are rewritten and the
duplicated-scaffolding trade-off is dropped; the scope/`IUnitOfWork` and `maxReplicas` citations
are corrected. Amended (2026-08-01): `SafeDomainEventHandler<TDomainEvent>` logs and **rethrows**,
so the redelivery bullet, the throwing-is-correct rationale and the redelivery trade-off are
corrected: the framework packages no swallow, the one hand-rolled swallow is not an instance of the
base class, and the redelivery blast radius is the whole save's local batch. Amended (2026-09-01):
an order line whose inventory row is missing is no longer silently skipped, so the best-effort
trade-off is rewritten around the returned unmatched ids and the handler warning; the
`RestoreInventory` and `maxReplicas` citations are corrected. Revised (2026-09-11): the
reconciliation sweep now runs two passes per cycle, so the sweep bullet records the second one
(expiring stranded unpaid orders straight to `Cancelled` so the existing compensation releases their
stock) alongside the Stripe reconciliation it already described; the `PaymentReconciliationSettings`
path, the `CheckOutHandler` transaction range, the index, `appsettings.json`, `maxReplicas` and every
`PaymentReconciliationService` citation are re-anchored. Revised again (2026-09-11): unpaid-order
expiry is now armed per order at checkout, so the sweep bullet, the "no new infrastructure" rationale
and the bounded-inconsistency trade-off record the scheduled `Sales.ExpireUnpaidOrder` deadline that
runs ahead of the sweep, and the sweep's expiry pass is described as the backstop it now is; every
`PaymentReconciliationService`, `CheckOutHandler` and `OrderPaymentFailedSagaHandler` citation is
re-anchored, and the two sentences describing that saga handler as an inline notification are
corrected. See the Revision below.

## Context
Checkout spans a boundary no transaction covers. `CheckOutHandler` commits the order insert, the cart
transition and the atomic conditional stock decrements in one local transaction
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/ShoppingCarts/UseCases/CheckOut/CheckOutHandler.cs:135-188`),
but the money moves at Stripe and the confirmation arrives later, as a webhook, from outside the
database. Two failure shapes follow directly:

- **A later step invalidates an earlier one.** Cancelling an order leaves stock that checkout already
  committed. The decrement cannot be rolled back, because its transaction closed minutes ago.
- **The external confirmation never arrives.** A dropped webhook (endpoint outage past Stripe's retry
  window, a misconfigured secret) leaves the order in `PaymentInitiated` forever with its stock held.

Neighbouring records answer adjacent questions and deliberately not this one. ADR-003 gets an event
out of the process at least once. ADR-021 stops a broker redelivery from being applied twice at the
consume edge. ADR-006 decides database-per-service and records "no cross-database transactions, no
two-phase commit" only as a **cost** it accepts. None of them says what a multi-step workflow does
when step two fails or step three never reports back. That is the decision recorded here:
consistency without a distributed transaction.

## Decision
Multi-step workflows are **choreographed sagas**: each step raises a domain event, and the follow-up
or compensating action lives in its own handler. A **periodic reconciliation sweep** is the
saga-timeout backstop for steps that depend on an external system.

- **Compensation is a domain-event handler, never code in the command handler.** `CancelOrderHandler`
  performs the guarded transition and saves, and nothing else
  (`.../Orders/UseCases/Cancel/CancelOrderHandler.cs:42-49`); restoring stock is
  `OrderCancelledSagaHandler : IDomainEventHandler<OrderCancelled>`
  (`.../Orders/Saga/OrderCancelledSagaHandler.cs:30-34`) and notifying the customer of a failed
  payment is `OrderPaymentFailedSagaHandler` (`.../Orders/Saga/OrderPaymentFailedSagaHandler.cs:20-22`).
  A new compensating action is a new handler, not an edit to the command.
- **Each handler runs in its own DI scope.** Domain-event handlers are registered as singletons
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:184-189`), so every one
  opens its own scope through `IServiceScopeFactory` (`OrderCancelledSagaHandler.cs:40`,
  `OrderPaymentFailedSagaHandler.cs:31`,
  `.../Infrastructure/Payments/Reconciliation/PaymentReconciliationService.cs:212,231,277`), and the ones that persist
  resolve their own `IUnitOfWork` inside it (`OrderCancelledSagaHandler.cs:41`,
  `PaymentReconciliationService.cs:213,232,278`). `OrderPaymentFailedSagaHandler` is the exception that
  shows the rule: it resolves the internal-command scheduler and little else in its scope
  (`OrderPaymentFailedSagaHandler.cs:32`) and writes no aggregate of its own, because both halves of
  its compensation (the "your payment did not go through" notification and the re-armed payment
  deadline) are queue rows the scheduler persists. Compensation that does write therefore commits on its own, after the originating
  save, rather than joining the transaction it is compensating for.
- **Idempotency is a persisted marker committed by the SAME `SaveChanges` as the compensating
  writes.** `Order.InventoryRestored` (`.../Domain/Orders/Order.cs:61-67`) is the marker;
  `MarkInventoryRestored` refuses a second call and refuses a non-cancelled order
  (`Order.cs:302-325`). The handler checks the marker first
  (`OrderCancelledSagaHandler.cs:56-62`), applies the increases through a pure domain service
  (`.../Domain/Inventory/InventoryRestorationDomainService.cs:14-34`), then one
  `SaveChangesAsync` commits the increases and the marker together
  (`OrderCancelledSagaHandler.cs:94-102`). Same database, one transaction: the marker cannot exist
  without the writes it guards, and the writes cannot land unmarked.
- **Redelivery is the retry mechanism.** A failing in-process handler leaves its outbox row
  unprocessed (`MMCA.Common/.../Interceptors/DomainEventSaveChangesInterceptor.cs:301-329`) and the
  `OutboxProcessor` re-dispatches the pure domain event on a later cycle
  (`MMCA.Common/.../Outbox/OutboxProcessor.cs:604`), with the bounded retries, backoff and
  dead-lettering ADR-003 already defines (`OutboxProcessor.cs:631-643,667-677`). The framework packages that failure mode and only that
  one: `SafeDomainEventHandler<TDomainEvent>` runs the subclass inside an exception filter whose
  `LogAndRethrow` writes one error line and always returns `false`, so the exception keeps
  propagating, with `OperationCanceledException` excluded because a host shutdown is not a delivery
  failure (`MMCA.Common/.../DomainEvents/SafeDomainEventHandler.cs:36-70`). What it standardizes is
  the log line, not a swallow. No production handler in the four repos derives from it today: its
  only subclass is the test double in its own unit tests
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/DomainEvents/SafeDomainEventHandlerTests.cs:124`).
  A handler whose work is a pure side effect and must not force a redelivery therefore owns that
  decision alone: `OrderPaymentFailedSagaHandler` implements
  `IDomainEventHandler<OrderPaymentFailed>` directly (`OrderPaymentFailedSagaHandler.cs:22-24`) and
  turns each of its two failure modes into a log line rather than a throw: an Error when the
  notification could not be scheduled (`OrderPaymentFailedSagaHandler.cs:38-41`, message at
  `OrderPaymentFailedSagaHandler.cs:100-103`) and a Warning when the payment deadline could not be
  re-armed (`OrderPaymentFailedSagaHandler.cs:86-90`, message at
  `OrderPaymentFailedSagaHandler.cs:108-111`).
- **Concurrent redeliveries are serialized by the `RowVersion` concurrency token.** Every auditable
  entity carries one (`MMCA.Common/.../Entities/AuditableBaseEntity.cs:53`), configured as a
  concurrency token on every non-owned auditable type
  (`MMCA.Common/.../DbContexts/ApplicationDbContext.cs:490-521`, ADR-035). Two deliveries that both
  pass the marker check carry the same original token into their update: one commits, the other gets
  `DbUpdateConcurrencyException` and its outbox retry then finds the committed marker and skips.
- **A periodic sweep drives the transitions a lost webhook would have, and backstops the orders no
  webhook will ever speak for.** `PaymentReconciliationService`
  (`.../Infrastructure/Payments/Reconciliation/PaymentReconciliationService.cs:68`) is registered as a
  hosted service by the Sales module's infrastructure (`.../Infrastructure/DependencyInjection.cs:42`)
  and runs two passes per cycle against one age cutoff
  (`PaymentReconciliationService.cs:119-130`). Both passes select the oldest matching orders, ordered,
  bounded and projected to ids entirely in SQL through one shared helper
  (`PaymentReconciliationService.cs:207-223`) over a dedicated filtered index
  (`.../Persistence/EntityConfiguration/OrderConfiguration.cs:70-76`).
  The reconciliation pass takes orders sitting in `PaymentInitiated` with a Stripe session
  (`PaymentReconciliationService.cs:136-152`), asks Stripe for the session's authoritative status, and
  applies the matching transition: paid to `MarkAsPaid`, expired to `MarkAsPaymentFailed`, still open
  to nothing (`PaymentReconciliationService.cs:325-343`).
  The expiry pass takes unpaid orders with no session to ask about, `PendingPayment` or
  `PaymentFailed` past the same cutoff (`PaymentReconciliationService.cs:178-187`), which hold stock
  checkout already committed and which nothing else can release. It calls no provider: it drives them
  to `Cancelled` through `MarkAsCancelled` (`PaymentReconciliationService.cs:251`), the terminal state
  `OrderCancelledSagaHandler` already listens on, so the compensation and its marker return the stock
  exactly once. `Cancelled` rather than `PaymentFailed` because `PaymentFailed` is retryable, so such
  an order keeps its stock for the whole retry window and loses it only when the window passes without
  a retry (`PaymentReconciliationService.cs:42-48`). Expiry runs before reconciliation in the cycle so
  an order the reconciliation pass just moved into `PaymentFailed` is not cancelled in the same cycle
  (`PaymentReconciliationService.cs:124-129`). The sweep is configuration-gated
  (`.../Payments/Reconciliation/PaymentReconciliationSettings.cs:30`, defaults of a 10-minute interval,
  a 30-minute stuck age and a 50-order batch, carried in
  `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/appsettings.json:90-95`).
- **The sweep gets no private path into the aggregate, and loses races on purpose.** It calls the same
  guarded transitions as the webhook handler
  (`.../Orders/UseCases/ProcessPaymentWebhook/ProcessPaymentWebhookHandler.cs:97,128`) and the
  client-initiated check (`.../Orders/UseCases/VerifyPayment/VerifyPaymentHandler.cs:64`). Both passes
  reload each order tracked in its own scope and re-check the status under the fresh load
  (`PaymentReconciliationService.cs:288-292` for reconciliation,
  `PaymentReconciliationService.cs:241-247` for expiry), and a `DbUpdateConcurrencyException` from a
  webhook or a customer that won the race is logged and skipped, not retried
  (`PaymentReconciliationService.cs:312-317`, `PaymentReconciliationService.cs:263-268`).

The loop shape is deliberate and shared, and it lives in the framework rather than in the sweep.
MMCA.Common ships it as an abstract base class, `PeriodicBackgroundService`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Scheduling/PeriodicBackgroundService.cs:20-42`),
whose `ExecuteAsync` owns the enablement gate, the startup delay, the per-cycle `try`/`catch` that
never kills the loop, and every wait through `TimeProvider`
(`PeriodicBackgroundService.cs:45-87`). `PaymentReconciliationService` derives from it
(`PaymentReconciliationService.cs:74`) and overrides only the three parts that are its own:
`Interval`, read from configuration (`PaymentReconciliationService.cs:81`); `IsEnabled`, which
distinguishes "the toggle is off" from "Stripe is not configured" before refusing to run
(`PaymentReconciliationService.cs:89-107`); and `ExecuteCycleAsync`, which delegates to the
internally visible `ReconcileOnceAsync` so one cycle is testable without the timer
(`PaymentReconciliationService.cs:110-111`). It is the base class's **only** subclass in any of the
four repos, apart from the test double in `PeriodicBackgroundService`'s own unit tests
(`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/PeriodicBackgroundServiceTests.cs:104`).

**Adoption is one module.** This pattern lives in MMCA.Store's Sales module only: the two saga
handlers and the one reconciliation sweep above. MMCA.ADC and MMCA.Helpdesk have no compensating saga
handler and no reconciliation sweep today. The record exists because the mechanism (compensate, mark,
reconcile) is the framework's stated answer to cross-boundary consistency, not because it is broadly
adopted.

## Rationale
- **No two-phase commit is available, and none is wanted.** Transactions are per data source and
  best-effort sequential (ADR-006), and an external payment provider cannot enlist in a database
  transaction at all. Compensation plus reconciliation is the only mechanism left, so the decision is
  how to make it disciplined rather than whether to use it.
- **Choreography fits a workflow whose state is already on the aggregate.** `Order.Status` plus
  `Order.InventoryRestored` *are* the saga state. An orchestrator would add a state machine and a
  persistence store to track what the aggregate already records.
- **A marker committed with its writes beats a marker written after them.** Because both land in one
  `SaveChanges` against one database, idempotency is a database invariant rather than handler
  discipline. This is strictly stronger than ADR-021's inbox, which records the message after the
  handlers succeed and therefore keeps a narrow crash window open.
- **Throwing is the correct failure mode.** The outbox already owns retry policy, backoff and
  dead-lettering, so a handler that cannot complete should fail loudly and let redelivery re-run it
  rather than invent local retries. The framework's one packaged base class now says the same thing
  in code: it logs and rethrows (`SafeDomainEventHandler.cs:36-47`), because a swallowing base made
  the "retried via the outbox" promise false. A handler that reported success had its outbox row
  marked processed, so nothing retried and the side effect was lost with only a log line to show for
  it. Opting out of redelivery is therefore an explicit, per-handler `catch`, not a base class.
- **The Stripe pass needs no new infrastructure; expiry has earned some.** For an order stuck in
  `PaymentInitiated` the authoritative answer already lives at the provider, so a bounded, indexed
  poll plus the existing guarded transitions is enough there: no timer message, no saga-timeout store.
  Expiry is a different question, because nothing outside the database has to be asked, and it is now
  armed per order on ADR-114's internal-command queue rather than waited for by a scan (see the
  Revision below). The sweep keeps running both passes, one as the primary path and one as a backstop.
- **Reusing the domain transitions keeps one state machine.** The sweep cannot reach a state the
  webhook could not, because it goes through the same `Result`-returning methods (ADR-013).

## Trade-offs
- **Inconsistency is bounded, not eliminated.** Between the cancellation commit and the compensation
  commit, stock is held against a cancelled order. Between a dropped webhook and the sweep, an order
  sits in `PaymentInitiated` with stock held for up to the stuck age plus one poll interval (30 plus
  10 minutes at the shipped defaults), and an order that never reaches Stripe at all is cancelled by
  its own scheduled deadline as the window closes, or by the expiry pass up to one poll interval
  later when that deadline was never written. That window is the price of not having a
  distributed transaction.
- **Compensation is best-effort per line, and names what it could not restore.** `RestoreInventory`
  skips an order line whose `InventoryItem` row is missing
  (`InventoryRestorationDomainService.cs:22-27`), but the skip is not silent: the unmatched variant
  ids are collected and returned to the caller (`InventoryRestorationDomainService.cs:25,32`), and
  the handler logs them at Warning naming each one
  (`OrderCancelledSagaHandler.cs:81-87`, message at `OrderCancelledSagaHandler.cs:115`). The marker
  still commits anyway, so that quantity is never restored and nothing retries it: withholding the
  marker would re-apply every matched increase on the next redelivery, which is a double restore
  (`OrderCancelledSagaHandler.cs:89-93`). The miss is narrow because the handler reads inventory with
  `ignoreQueryFilters: true` (`OrderCancelledSagaHandler.cs:75`), so a soft-deleted row still counts
  and a missing row means the row never existed. The stock is still lost; what changed is that the
  loss is recorded rather than invisible.
- **Redelivery re-runs every handler of the event, not the failed one.** The dispatcher iterates
  handlers sequentially with no per-handler isolation
  (`MMCA.Common/.../Services/DomainEventDispatcher.cs:76-85`), so one throwing handler also skips the
  handlers after it, and a redelivery re-runs the ones that already succeeded. The blast radius is
  wider than the one event: the interceptor dispatches every local event of a save in a single call
  and marks their outbox rows processed only afterwards
  (`MMCA.Common/.../Interceptors/DomainEventSaveChangesInterceptor.cs:328-333`), so a throw skips
  that mark for the whole batch and every local event written by that save is redelivered, not just
  the one whose handler failed. Every handler on a shared event must therefore be idempotent against
  both a repeat of its own event and a repeat of every sibling event of the same save, or must
  swallow its failures itself.
- **The sweep is not replica-leased.** The outbox processor claims rows with a lease before working
  them (ADR-003); the sweep takes no such claim, so at the configured `maxReplicas: 2`
  (`MMCA.Store/infra/main.bicep:1793`) two replicas can pick the same stuck order and each spend a
  Stripe status call. Correctness holds through the concurrency token; the duplicated external call
  does not deduplicate.
- **Every compensating action needs its own marker.** There is no generic mechanism: the ADR-021
  inbox dedups broker messages between services, not in-process handler re-runs. A second compensating
  action means a second persisted marker or a naturally idempotent operation, decided by the author.

## Revision (2026-09-11): the unpaid-order deadline moves onto the order, and the sweep becomes its backstop

Expiring an unpaid order is no longer something a scan notices. Every order now arms its own
deadline, and the sweep's expiry pass stays exactly where it was, underneath.

`CheckOutHandler` schedules one `ExpireUnpaidOrderInternalCommand(orderId)`
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/InternalCommands/ExpireUnpaidOrderInternalCommand.cs:23-24`)
to run at `now` plus `UnpaidOrderExpirySettings.Minutes`, through `IInternalCommandScheduler`
(`MMCA.Common/Source/Core/MMCA.Common.Application/InternalCommands/IInternalCommandScheduler.cs:16`,
ADR-114's queue), from inside the same transaction that inserts the order and commits the stock
(`.../ShoppingCarts/UseCases/CheckOut/CheckOutHandler.cs:178-184,226-229`). Inside, not after:
"there is an order" and "there is a deadline for it" have to be one fact, or a crash between two
commits leaves stock held with nothing scheduled to release it. The arming happens after the save
within the delegate, because the order id is store-generated, and it is followed by a second
`SaveChangesAsync` (`CheckOutHandler.cs:237-240`), because `ExecuteInTransactionAsync` commits
without flushing pending changes first: the scheduler only enrolled its row on the enlisted context,
so without that save the deadline would be discarded at commit. A scheduling failure is a Warning and
nothing further (`CheckOutHandler.cs:231-235`, message at `CheckOutHandler.cs:205-208`); it never
fails the checkout, because the deadline is an optimization over a sweep that still runs, and losing
a completed checkout over an unwritten queue row would trade a slow stock release for a lost sale.

`OrderPaymentFailedSagaHandler` re-arms the same command from now after every failed payment attempt
(`.../Orders/Saga/OrderPaymentFailedSagaHandler.cs:67-93`, the schedule at `:81-84`), so a customer
whose card was declined gets the whole window again rather than the remainder of the old one. The
earlier row armed at checkout stays in the queue and runs as a no-op, because the due instant is
re-derived rather than trusted.

`ExpireUnpaidOrderInternalCommandHandler` is where that re-derivation lives
(`.../Orders/InternalCommands/ExpireUnpaidOrderInternalCommandHandler.cs:41-98`). It reloads the
order and returns success untouched if the order is gone or has left `PendingPayment`/`PaymentFailed`
(`:55-65`), then recomputes the deadline as `(LastModifiedOn ?? CreatedOn)` plus `Minutes` and does
nothing if that instant is still in the future (`:67-74`). That is the sweep's own rule applied to a
single order, and it is why the payload is the order id alone: a row armed half an hour ago says
nothing about what the order is doing now, so what is stored decides. When the order is genuinely due
the handler calls the same guarded `MarkAsCancelled` the sweep calls (`:78-83`), and
`OrderCancelledSagaHandler` returns the stock through the marker this record already describes. A
concurrency conflict on the save is a lost race to a webhook that moved the order between the load
and the save, so the row completes successfully rather than retrying into the same conflict
(`:85-93`), and the provider exception is classified through `IConcurrencyConflictDetector` because
the Application layer references no data provider.

Both paths are configuration-gated and are meant to agree. `UnpaidOrderExpirySettings`
(`.../Orders/UnpaidOrderExpirySettings.cs:25-43`, `Enabled` defaulting to true and `Minutes` to 30)
is bound and validated on start beside the sweep's own settings
(`.../MMCA.Store.Sales.API/SalesModule.cs:59-67`), and `PaymentReconciliation:StuckAgeMinutes` carries
the same 30 (`PaymentReconciliationSettings.cs:48`,
`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/appsettings.json:86-95`). Turning `Enabled` off
falls back to the sweep alone, which is slower and still correct.

**The sweep stays, and its expiry pass is unchanged.** A deadline is a row, and a row can fail to be
written (a scheduling failure at checkout is logged, never fatal), can be dead-lettered by the
internal-command processor, or can simply never have existed for an order created before the
mechanism did. Those cases are rare, which is precisely the argument for a backstop rather than
against one: one bounded, indexed query per cycle covers all three without anyone having to decide in
advance which one occurred. The Stripe half of the sweep is untouched and could not become a deadline
anyway, because its work is a live provider call whose answer is only knowable at the moment it is
made, and the failure it exists for (a prolonged webhook outage) strands a backlog, which is the
shape batching is right for (`PaymentReconciliationService.cs:50-59`). Both paths converge on the
same guarded transition and the same `OrderCancelled` compensation, so whichever arrives first wins
and the other finds nothing to do.

**What the deadline buys is timing, and a quieter sweep.** An unpaid order is now cancelled as its
window closes rather than up to one poll interval later (10 minutes at the shipped defaults), which
is the difference between holding a basket for 30 minutes and holding it for 30 minutes give or take
the next cycle. The common case also stops doing work: the expiry pass still runs on its interval,
but on a healthy system it now selects nothing, because the orders it used to collect have already
cancelled themselves.

## Related
ADR-003 (the outbox delivery and retry this leans on for compensation redelivery; this record says
what the redelivered handler must do), ADR-006 (which accepts "no cross-database transaction" as a
cost without saying how it is paid; this is the payment), ADR-021 (dedup of broker redeliveries
between services, complementary to the aggregate marker that dedups in-process handler re-runs),
ADR-035 (the `RowVersion` token that serializes concurrent compensations and lets the sweep lose a
race to a webhook), ADR-014 (the command pipeline whose commit compensation runs after), ADR-052
(in-process background work, the hosted-service family this sweep belongs to, with a fixed-interval
poll instead of a queue drain), ADR-013 (the `Result`-returning guarded transitions both the sweep and the
per-order deadline reuse rather than bypassing), ADR-114 (the durable internal-command queue the
per-order unpaid-order deadline is scheduled on), [ADR-086](086-process-manager-deferred.md) (the orchestrated alternative to
the choreography decided here: deferred, with the shape it would take and the trigger that would build
it, and with this record's reconciliation sweep remaining underneath it).
