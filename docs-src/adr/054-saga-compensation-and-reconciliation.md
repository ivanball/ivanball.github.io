# ADR-054: Choreographed Saga Compensation with a Reconciliation Backstop

## Status
Accepted (2026-07-25). Amended (2026-07-28): Store's reconciliation sweep now derives from
`PeriodicBackgroundService`, so the shared-loop and adoption paragraphs are rewritten and the
duplicated-scaffolding trade-off is dropped; the scope/`IUnitOfWork` and `maxReplicas` citations
are corrected. Amended (2026-08-01): `SafeDomainEventHandler<TDomainEvent>` logs and **rethrows**,
so the redelivery bullet, the throwing-is-correct rationale and the redelivery trade-off are
corrected: the framework packages no swallow, the one hand-rolled swallow is not an instance of the
base class, and the redelivery blast radius is the whole save's local batch.

## Context
Checkout spans a boundary no transaction covers. `CheckOutHandler` commits the order insert, the cart
transition and the atomic conditional stock decrements in one local transaction
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/ShoppingCarts/UseCases/CheckOut/CheckOutHandler.cs:94-136`),
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
  (`.../Orders/Saga/OrderCancelledSagaHandler.cs:31-34`) and notifying the customer of a failed
  payment is `OrderPaymentFailedSagaHandler` (`.../Orders/Saga/OrderPaymentFailedSagaHandler.cs:20-22`).
  A new compensating action is a new handler, not an edit to the command.
- **Each handler runs in its own DI scope.** Domain-event handlers are registered as singletons
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:143-148`), so every one
  opens its own scope through `IServiceScopeFactory` (`OrderCancelledSagaHandler.cs:41`,
  `OrderPaymentFailedSagaHandler.cs:29`,
  `.../Infrastructure/Services/PaymentReconciliationService.cs:89,132`), and the ones that persist
  resolve their own `IUnitOfWork` inside it (`OrderCancelledSagaHandler.cs:42`,
  `PaymentReconciliationService.cs:91,133`). `OrderPaymentFailedSagaHandler` is the exception that
  shows the rule: it resolves only `ICustomerService` and `IEmailSender`
  (`OrderPaymentFailedSagaHandler.cs:30-31`) and persists nothing, because its compensation is a
  notification. Compensation that does write therefore commits on its own, after the originating
  save, rather than joining the transaction it is compensating for.
- **Idempotency is a persisted marker committed by the SAME `SaveChanges` as the compensating
  writes.** `Order.InventoryRestored` (`.../Domain/Orders/Order.cs:48-54`) is the marker;
  `MarkInventoryRestored` refuses a second call and refuses a non-cancelled order
  (`Order.cs:281-298`). The handler checks the marker first
  (`OrderCancelledSagaHandler.cs:56-62`), applies the increases through a pure domain service
  (`.../Domain/Services/InventoryRestorationDomainService.cs:14-27`), then one
  `SaveChangesAsync` commits the increases and the marker together
  (`OrderCancelledSagaHandler.cs:94-102`). Same database, one transaction: the marker cannot exist
  without the writes it guards, and the writes cannot land unmarked.
- **Redelivery is the retry mechanism.** A failing in-process handler leaves its outbox row
  unprocessed (`MMCA.Common/.../Interceptors/DomainEventSaveChangesInterceptor.cs:301-329`) and the
  `OutboxProcessor` re-dispatches the pure domain event on a later cycle
  (`MMCA.Common/.../Outbox/OutboxProcessor.cs:507-597`), with the bounded retries, backoff and
  dead-lettering ADR-003 already defines. The framework packages that failure mode and only that
  one: `SafeDomainEventHandler<TDomainEvent>` runs the subclass inside an exception filter whose
  `LogAndRethrow` writes one error line and always returns `false`, so the exception keeps
  propagating, with `OperationCanceledException` excluded because a host shutdown is not a delivery
  failure (`MMCA.Common/.../DomainEvents/SafeDomainEventHandler.cs:36-70`). What it standardizes is
  the log line, not a swallow. No production handler in the four repos derives from it today: its
  only subclass is the test double in its own unit tests
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/DomainEvents/SafeDomainEventHandlerTests.cs:124`).
  A handler whose work is a pure side effect and must not force a redelivery therefore writes the
  catch by hand and owns that decision alone: `OrderPaymentFailedSagaHandler` implements
  `IDomainEventHandler<OrderPaymentFailed>` directly (`OrderPaymentFailedSagaHandler.cs:20-22`) and
  swallows everything except cancellation into an Error log (`OrderPaymentFailedSagaHandler.cs:52-55`).
- **Concurrent redeliveries are serialized by the `RowVersion` concurrency token.** Every auditable
  entity carries one (`MMCA.Common/.../Entities/AuditableBaseEntity.cs:39`), configured as a
  concurrency token on every non-owned auditable type
  (`MMCA.Common/.../DbContexts/ApplicationDbContext.cs:445-473`, ADR-035). Two deliveries that both
  pass the marker check carry the same original token into their update: one commits, the other gets
  `DbUpdateConcurrencyException` and its outbox retry then finds the committed marker and skips.
- **A periodic sweep drives the transitions a lost webhook would have.**
  `PaymentReconciliationService` (`.../Infrastructure/Services/PaymentReconciliationService.cs:33-38`)
  is registered as a hosted service by the Sales module's infrastructure
  (`.../Infrastructure/DependencyInjection.cs:34-36`). Each cycle selects the oldest orders that have
  sat in `PaymentInitiated` past a cutoff, ordered, bounded and projected to ids entirely in SQL
  (`PaymentReconciliationService.cs:101-109`) over a dedicated filtered index
  (`.../Persistence/EntityConfiguration/OrderConfiguration.cs:46-52`), asks Stripe for the session's
  authoritative status, and applies the matching transition: paid to `MarkAsPaid`, expired to
  `MarkAsPaymentFailed`, still open to nothing (`PaymentReconciliationService.cs:180-202`). It is
  configuration-gated (`.../Infrastructure/Settings/PaymentReconciliationSettings.cs:13-36`, defaults
  of a 10-minute interval, a 30-minute stuck age and a 50-order batch, carried in
  `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/appsettings.json:62-67`).
- **The sweep gets no private path into the aggregate, and loses races on purpose.** It calls the same
  guarded transitions as the webhook handler
  (`.../Orders/UseCases/ProcessPaymentWebhook/ProcessPaymentWebhookHandler.cs:97,128`) and the
  client-initiated check (`.../Orders/UseCases/VerifyPayment/VerifyPaymentHandler.cs:64`). It reloads
  each order tracked in its own scope and re-checks the status under the fresh load
  (`PaymentReconciliationService.cs:136-147`), and a `DbUpdateConcurrencyException` from a webhook
  that won the race is logged and skipped, not retried
  (`PaymentReconciliationService.cs:167-172`).

The loop shape is deliberate and shared, and it lives in the framework rather than in the sweep.
MMCA.Common ships it as an abstract base class, `PeriodicBackgroundService`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/PeriodicBackgroundService.cs:20-42`),
whose `ExecuteAsync` owns the enablement gate, the startup delay, the per-cycle `try`/`catch` that
never kills the loop, and every wait through `TimeProvider`
(`PeriodicBackgroundService.cs:45-87`). `PaymentReconciliationService` derives from it
(`PaymentReconciliationService.cs:39`) and overrides only the three parts that are its own:
`Interval`, read from configuration (`PaymentReconciliationService.cs:46`); `IsEnabled`, which
distinguishes "the toggle is off" from "Stripe is not configured" before refusing to run
(`PaymentReconciliationService.cs:54-72`); and `ExecuteCycleAsync`, which delegates to the
internally visible `ReconcileOnceAsync` so one cycle is testable without the timer
(`PaymentReconciliationService.cs:75-76`). It is the base class's **only** subclass in any of the
four repos, apart from the test double in `PeriodicBackgroundService`'s own unit tests
(`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Services/PeriodicBackgroundServiceTests.cs:104`).

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
- **The sweep needs no new infrastructure.** The authoritative answer already lives at the provider,
  so a bounded, indexed poll plus the existing guarded transitions is enough: no timer message, no
  scheduler, no saga-timeout store.
- **Reusing the domain transitions keeps one state machine.** The sweep cannot reach a state the
  webhook could not, because it goes through the same `Result`-returning methods (ADR-013).

## Trade-offs
- **Inconsistency is bounded, not eliminated.** Between the cancellation commit and the compensation
  commit, stock is held against a cancelled order. Between a dropped webhook and the sweep, an order
  sits in `PaymentInitiated` with stock held for up to the stuck age plus one poll interval (30 plus
  10 minutes at the shipped defaults). That window is the price of not having a distributed
  transaction.
- **Compensation is best-effort per line.** `RestoreInventory` skips an order line whose
  `InventoryItem` row is missing (`InventoryRestorationDomainService.cs:20-21`) and the marker still
  commits, so that quantity is never restored and nothing retries it. Tolerable only because an
  inventory row is auto-created for every variant, which makes a missing row mean the variant itself
  is gone.
- **Redelivery re-runs every handler of the event, not the failed one.** The dispatcher iterates
  handlers sequentially with no per-handler isolation
  (`MMCA.Common/.../Services/DomainEventDispatcher.cs:76-85`), so one throwing handler also skips the
  handlers after it, and a redelivery re-runs the ones that already succeeded. The blast radius is
  wider than the one event: the interceptor dispatches every local event of a save in a single call
  and marks their outbox rows processed only afterwards
  (`MMCA.Common/.../Interceptors/DomainEventSaveChangesInterceptor.cs:305-310`), so a throw skips
  that mark for the whole batch and every local event written by that save is redelivered, not just
  the one whose handler failed. Every handler on a shared event must therefore be idempotent against
  both a repeat of its own event and a repeat of every sibling event of the same save, or must
  swallow its failures itself.
- **The sweep is not replica-leased.** The outbox processor claims rows with a lease before working
  them (ADR-003); the sweep takes no such claim, so at the configured `maxReplicas: 2`
  (`MMCA.Store/infra/main.bicep:1339`) two replicas can pick the same stuck order and each spend a
  Stripe status call. Correctness holds through the concurrency token; the duplicated external call
  does not deduplicate.
- **Every compensating action needs its own marker.** There is no generic mechanism: the ADR-021
  inbox dedups broker messages between services, not in-process handler re-runs. A second compensating
  action means a second persisted marker or a naturally idempotent operation, decided by the author.

## Related
ADR-003 (the outbox delivery and retry this leans on for compensation redelivery; this record says
what the redelivered handler must do), ADR-006 (which accepts "no cross-database transaction" as a
cost without saying how it is paid; this is the payment), ADR-021 (dedup of broker redeliveries
between services, complementary to the aggregate marker that dedups in-process handler re-runs),
ADR-035 (the `RowVersion` token that serializes concurrent compensations and lets the sweep lose a
race to a webhook), ADR-014 (the command pipeline whose commit compensation runs after), ADR-052
(in-process background work, the hosted-service family this sweep belongs to, with a fixed-interval
poll instead of a queue drain), ADR-013 (the `Result`-returning guarded transitions the sweep reuses
rather than bypassing), [ADR-086](086-process-manager-deferred.md) (the orchestrated alternative to
the choreography decided here: deferred, with the shape it would take and the trigger that would build
it, and with this record's reconciliation sweep remaining underneath it).
