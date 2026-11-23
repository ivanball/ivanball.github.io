# ADR-143: Process-Manager Primitive (Consumer-Owned Process Aggregate, Timeouts over Internal Commands)

## Status
Accepted (2026-11-12). The primitive ships in MMCA.Common v1.289.0
(`MMCA.Common/CHANGELOG.md:511,548`); it is opt-in, with no table, no
migration and no configuration key (`MMCA.Common/UPGRADING.md:465-466`). MMCA.Store is its first
adopter. Revised 2026-11-23: Store's payment deadline and its unpaid-order expiry sweep now measure
from `Order.PaymentWindowStartedOn` (falling back to the last transition only for older rows), so a
save that is not a payment transition no longer restarts the window; a hold ceiling from creation
now bounds both sweep classes and new payment sessions, and a startup validator keeps the sweep
window equal to the deadline's; anchors refreshed.

## Context
A long-running flow (a process that spans several events and has a deadline) had no framework shape.
Each flow kept its state and its deadlines ad hoc on its own aggregate and its own handlers, and the
rules that make such a flow safe under redelivery had to be rediscovered per flow.

Store's unpaid-order deadline is the concrete case. The order's saga state is two members of the
aggregate, `Order.Status` and `Order.InventoryRestored`
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/Order.cs:192,232`). The deadline is a
durable internal command, `Sales.ExpireUnpaidOrder`, armed inside the checkout transaction
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/ShoppingCarts/UseCases/CheckOut/CheckOutDeadlineScheduler.cs:16-20`)
and armed again when a payment fails, so the retry window starts over
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/Saga/OrderPaymentFailedSagaHandler.cs:68-98`).
Re-arming leaves the older row in the queue, so the handler cannot trust the instant it was woken
at: it must re-derive the due instant from what is stored
(`.../Orders/Saga/OrderPaymentFailedSagaHandler.cs:57-62`). A reconciliation sweep stays as the
backstop for a deadline that was never written
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Reconciliation/PaymentReconciliationService.cs:53-62`).

This record builds on four others. [ADR-054](054-saga-compensation-and-reconciliation.md) is the
choreographed compensation and the reconciliation backstop this primitive gives a shape to, and its
rationale holds that `Order.Status` plus `Order.InventoryRestored` *are* the saga state.
[ADR-086](086-process-manager-deferred.md) deferred a separate coordinator until a workflow whose
state fits no single aggregate appears. [ADR-114](114-internal-commands-durable-job-queue.md)
supplies the durable internal-command queue that carries the timeouts,
[ADR-003](003-outbox-dual-dispatch.md) the outbox that redelivers the events that drive each step,
and [ADR-014](014-cqrs-decorator-pipeline.md) the decorator pipeline that wraps the timeout handler.

## Decision
MMCA.Common ships a behaviour-only process-manager primitive in three parts: a base class for the
aggregate that IS the process, a base handler that runs one process step per domain event, and
process timeouts carried by consumer-owned internal commands and decided by the aggregate itself.

### 1. The process aggregate adds behaviour, never a column
`ProcessManagerAggregateRoot<TIdentifierType>` derives `AuditableAggregateRootEntity<TIdentifierType>`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/ProcessManagers/ProcessManagerAggregateRoot.cs:17`) and
declares no property and no field, so deriving from it leaves the EF model and every migration
snapshot unchanged (`.../ProcessManagerAggregateRoot.cs:10-11`). It adds two members:

- `GetLastTransitionOn()` returns `LastModifiedOn ?? CreatedOn`, the instant of the last persisted
  transition (`.../ProcessManagerAggregateRoot.cs:29-31`). It is a method rather than a property on
  purpose, because a property declared on the base would map into every adopter's model
  (`.../ProcessManagerAggregateRoot.cs:25-28`).
- `DecideTimeout(ProcessTimeout timeout, DateTime utcNow)` is virtual and returns
  `ProcessTimeoutDecision.NotApplicable()` by default (`.../ProcessManagerAggregateRoot.cs:43-44`).

A `ProcessTimeout` is a name and a window: the name may not be blank and the window must be strictly
positive (`MMCA.Common/Source/Core/MMCA.Common.Domain/ProcessManagers/ProcessTimeout.cs:14-17`), and
`DueAfter(lastTransitionOn)` returns `lastTransitionOn + Window` (`.../ProcessTimeout.cs:32`). The
window is therefore measured from the last stored transition, not from the moment the timeout was
scheduled.

`ProcessTimeoutDecision` has four outcomes, the `ProcessTimeoutOutcome` values `NotApplicable = 0`,
`NotYetDue = 1`, `Applied = 2` and `Rejected = 3`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/ProcessManagers/ProcessTimeoutOutcome.cs:7-16`). Only
`NotYetDue` carries `DueAt` and only `Rejected` carries `Errors`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/ProcessManagers/ProcessTimeoutDecision.cs:6-8,30-54`), and
`Rejected` throws when given no error (`.../ProcessTimeoutDecision.cs:48-51`). An override matches the
timeout by name, checks the stored state, answers `NotYetDue(timeout.DueAfter(GetLastTransitionOn()))`
while the due instant lies after `utcNow`, and otherwise applies the transition
(`.../ProcessManagerAggregateRoot.cs:33-38`).

### 2. One step per domain event, in one scope and one transaction
`ProcessDomainEventHandlerBase<TDomainEvent, TProcess, TProcessId>` implements
`IDomainEventHandler<TDomainEvent>`
(`MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessDomainEventHandlerBase.cs:31-35`).
For each event it calls `OnStepStarting`, opens ONE async scope, resolves that scope's `IUnitOfWork`
and runs ONE `ExecuteInTransactionAsync` whose delegate loads the process tracked, by
`CorrelateProcessId(event)` with the overridable `Includes`
(`.../ProcessDomainEventHandlerBase.cs:45-57`), then hands it to the abstract `HandleStepAsync` with a
`ProcessStepContext` (`.../ProcessDomainEventHandlerBase.cs:65-69,94-98`). The context carries the
scope's provider, its unit of work and, when the host called `AddProcessManagers()`, the timeout
scheduler, which is null otherwise
(`MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessStepContext.cs:16-33`).

- **The step owns its saves.** The base never calls `SaveChangesAsync`; the transaction refuses to
  commit unsaved changes, so a step that forgets to save fails loudly
  (`.../ProcessDomainEventHandlerBase.cs:17-18`).
- **A failed result** rolls the unit back, after which the base calls `OnStepFailed`
  (`.../ProcessDomainEventHandlerBase.cs:21-23,73-76`). The default throws
  `ProcessStepFailedException`, carrying the process type name, the id formatted with the invariant
  culture and the errors, so the outbox redelivers the event
  (`.../ProcessDomainEventHandlerBase.cs:120-124`); an override that returns normally keeps the event
  handled (`.../ProcessDomainEventHandlerBase.cs:112-116`).
- **An exception** thrown by the step is not caught by the base, and cancellation is never caught
  (`.../ProcessDomainEventHandlerBase.cs:23-24`). The step runs inside the transaction wrapper, which
  runs under the provider's execution strategy, so a transient database fault re-runs the whole step
  before anything propagates, and a commit whose outcome is unknown surfaces as
  `TransactionCommitAmbiguousException`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs:600-621`).
  A step must therefore be safe to run twice.
- **A missing process** calls `OnProcessMissing` and the delegate returns success, so the event is
  handled (`.../ProcessDomainEventHandlerBase.cs:59-63,106-110`).

### 3. Timeouts are internal commands the aggregate decides
- **The command.** `IProcessTimeoutCommand<TProcessId>` extends `IInternalCommand` with one member,
  `ProcessId`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/IProcessTimeoutCommand.cs:17-22`).
  It is consumer-owned and declares a stable `[InternalCommandName]`
  (`.../IProcessTimeoutCommand.cs:6-8`). `ProcessId` may be an explicit interface implementation over
  the command's own id property; `System.Text.Json` does not serialize an explicit implementation, so
  the stored payload is the command's own public properties only
  (`.../IProcessTimeoutCommand.cs:11-14`).
- **The scheduler.** `IProcessTimeoutScheduler.ArmAsync(timeout, after, ct)` returns the scheduled
  row's id, and its write inherits the internal command scheduler's atomicity: enrolled in the active
  transaction when there is one, saved outright otherwise
  (`MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/IProcessTimeoutScheduler.cs:11-28`).
  The default `ProcessTimeoutScheduler` refuses a zero or negative delay with the validation error
  `ProcessManagers.TimeoutNotInFuture` and otherwise makes one `ScheduleAsync` call at the injected
  clock's now plus the delay, so the due instant comes from the same clock the handler later decides
  with (`MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessTimeoutScheduler.cs:7-9,18,29-38`).
- **The handler.** `ProcessTimeoutHandlerBase<TCommand, TProcess, TProcessId>` is an
  `ICommandHandler<TCommand, Result>`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessTimeoutHandlerBase.cs:36-43`).
  It calls the abstract `ResolveTimeout(command)` once, before the load, loads the process tracked,
  and asks it to decide at `timeProvider.GetUtcNow().UtcDateTime`
  (`.../ProcessTimeoutHandlerBase.cs:53-67`). A missing process, `NotApplicable`, `NotYetDue` and
  `Rejected` all complete the row with success and save nothing
  (`.../ProcessTimeoutHandlerBase.cs:60-64,78-84`). `Applied` saves once; a save failure the
  `IConcurrencyConflictDetector` classifies as a conflict is a lost race and also completes the row,
  and any other save exception propagates so the row retries with backoff
  (`.../ProcessTimeoutHandlerBase.cs:14-18,86-97`). An exception from resolving the timeout, from the
  load or from `DecideTimeout` is not caught either, so it propagates the same way
  (`.../ProcessTimeoutHandlerBase.cs:53-67`). Every outcome that completes the row reaches the `OnHandled` hook as a
  `ProcessTimeoutReport<TProcessId>`, whose `Handling` is one of `ProcessMissing`, `NotApplicable`,
  `NotYetDue`, `Applied`, `Rejected` and `LostRace`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessTimeoutHandling.cs:4-23`,
  `MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessTimeoutReport.cs:16-23`),
  with `DescribeState(process)` captured before the decision
  (`.../ProcessTimeoutHandlerBase.cs:66,105-111`). A consumer derives one sealed class per timeout
  command, which the module scan registers as a closed handler the decorator pipeline wraps
  (`.../ProcessTimeoutHandlerBase.cs:26-27`).
- **Registration.** `services.AddProcessManagers()` registers only the scoped
  `IProcessTimeoutScheduler` and, when the host has no clock, `TimeProvider.System`; it registers no
  handler, a second call adds nothing, and `AddApplication()` registers none of it
  (`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.ProcessManagers.cs:11-28`).

### 4. The gate: a convention test that cannot pass vacuously
`ProcessTimeoutConventionTestsBase` holds three facts
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/ProcessManagers/ProcessTimeoutConventionTestsBase.cs:30-42`).
Every concrete `IProcessTimeoutCommand<T>` in the map's module Application assemblies must declare
`[InternalCommandName]` itself, because a stored row resolves its handler by that name or, without
one, by its CLR type name, so a rename strands every queued row
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Cqrs/ArchitectureRules.ProcessTimeouts.cs:9-33`).
Each must be handled by exactly one concrete `ProcessTimeoutHandlerBase` subclass; none dead-letters
its rows, two make the resolution ambiguous, and a plain `ICommandHandler` does not count
(`.../ArchitectureRules.ProcessTimeouts.cs:35-64`). The third fact is the non-vacuity floor: the scan
must find at least `MinimumTimeoutCommands` timeout commands, default 1, so a map that omits the
declaring module fails instead of letting both rules pass without reading anything
(`.../ProcessTimeoutConventionTestsBase.cs:13-15,28-34`). A repo subclasses the base only when it uses
the primitive (`MMCA.Common/UPGRADING.md:484-487`).

## Rationale
- **The aggregate already is the state.** ADR-054's rationale holds that `Order.Status` plus
  `Order.InventoryRestored` are the saga state and that an orchestrator would track what the aggregate
  already records ([ADR-054](054-saga-compensation-and-reconciliation.md), Rationale). A base class
  that adds behaviour only gives every such flow one shape without a second copy of the state that
  could disagree with the first.
- **Re-deriving the due instant makes stale timeouts harmless by construction.** Because the
  aggregate computes the due instant from its own stored state (Store's order from the stored start
  of its payment window), a timeout superseded by a later transition answers `NotYetDue` and a
  timeout fired twice applies once
  (`.../ProcessManagerAggregateRoot.cs:36-38`; `.../Orders/Order.cs:1101-1105`). No row needs to be
  found and cancelled when the process moves.
- **Every outcome decided by stored state completes the row.** Retrying a missing process, a
  timeout that does not apply, an early row or a refused transition cannot change the answer, so only
  a fault retries: a save failure that is not a conflict, or an exception while loading or deciding
  (`.../ProcessTimeoutHandlerBase.cs:14-18,53-67`). The internal-command
  queue's retry and dead-letter budget ([ADR-114](114-internal-commands-durable-job-queue.md)) is
  spent only where a retry can succeed.
- **One scope and one transaction per step keeps a step atomic under redelivery.** The outbox
  delivers at least once ([ADR-003](003-outbox-dual-dispatch.md)); a step whose marker and writes
  commit together, or roll back together on a failed result, is safe to run again.
- **Nothing new to deploy.** Timeouts ride the existing internal-command queue and steps ride
  existing domain-event dispatch, so the primitive adds no table, no package and no configuration
  (`MMCA.Common/UPGRADING.md:465-466`).

## Trade-offs
- **A `NotYetDue` decision does not re-arm.** The handler completes the row without scheduling
  another (`.../ProcessTimeoutHandlerBase.cs:21-23`). Every step that moves the process and still
  wants its timeout must schedule it again, as Store's payment-failure handler does
  (`.../Orders/Saga/OrderPaymentFailedSagaHandler.cs:48,68-98`); a step that forgets leaves the
  process with no live timeout.
- **A host keeps a reconciliation sweep.** A timeout can go missing without any step noticing: a
  scheduling failure that is logged and swallowed, a dead-lettered row, a step that moves the process
  and forgets to re-arm, and, for an adopter that measures from `GetLastTransitionOn()`, any save that
  moves the last-modified time and so pushes the due instant past every queued row. Store keeps its
  sweep as the backstop: its own list is a deadline that was never written, a dead-lettered row and
  an order older than the deadline mechanism
  (`.../Payments/Reconciliation/PaymentReconciliationService.cs:53-61`). Its unpaid-order expiry
  class measures from the same instant the per-order deadline does, `Order.PaymentWindowStartedOn`,
  falling back to `LastModifiedOn ?? CreatedOn` only for rows written before that column existed
  (`.../Payments/Reconciliation/PaymentReconciliationService.cs:204-208,222`); its `PaymentInitiated`
  class, reconciled against Stripe, still measures from `LastModifiedOn ?? CreatedOn`
  (`.../Payments/Reconciliation/PaymentReconciliationService.cs:168-170`). Both classes also take any
  order older than the `UnpaidOrderExpiry:MaxHoldMinutes` ceiling (default 240) measured from
  creation: an unpaid one is expired, and a `PaymentInitiated` one is checked against Stripe first,
  so it can be marked paid rather than cancelled
  (`.../Payments/Reconciliation/PaymentReconciliationService.cs:64-72,170,222`). The same ceiling
  makes checkout refuse any new payment session for such an order
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/CreateCheckoutSession/CreateCheckoutSessionHandler.cs:18-20`;
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UnpaidOrderExpirySettings.cs:49-50,53`).
  The two windows are separate settings, `PaymentReconciliation:StuckAgeMinutes` and
  `UnpaidOrderExpiry:Minutes`, both 30 by default, and `PaymentReconciliationSettingsValidator`
  refuses to start the host when they differ
  (`.../Payments/Reconciliation/PaymentReconciliationSettings.cs:17-22,49`;
  `.../Orders/UnpaidOrderExpirySettings.cs:43`;
  `.../Payments/Reconciliation/PaymentReconciliationSettingsValidator.cs:14,33-37`;
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/SalesModule.cs:90`).
- **The window is coupled to the audit stamp.** `GetLastTransitionOn()` reads the audit columns
  (`.../ProcessManagerAggregateRoot.cs:29-31`), so any save of the aggregate, not only a status
  change, restarts every timeout window measured from it. An adopter that needs a window immune to
  unrelated saves stores the window's start itself and measures from that: Store's order keeps
  `PaymentWindowStartedOn` and decides from it, so a save that is not a payment transition (a link
  refresh, a label) leaves the deadline where it was (`.../Orders/Order.cs:69,1107-1109,1125`).
- **Scope is one aggregate.** The base assumes the whole process state lives on one aggregate; a
  flow whose state spans aggregates or services gets no help from it.
- **Opt-in wiring is the adopter's.** `AddProcessManagers()` is not part of `AddApplication()`, and
  `ProcessStepContext.Timeouts` is null in a host that never calls it
  (`.../ProcessStepContext.cs:32-33`).

## Alternatives rejected
- **A framework-owned saga state table** (weighed 2026-11-11). Every consumer would take a migration
  and carry a second state row that mirrors, and can disagree with, the aggregate's own columns,
  which is the duplication ADR-054 and ADR-086 already argue against
  (`Website/docs-src/adr/054-saga-compensation-and-reconciliation.md:240-242`;
  `Website/docs-src/adr/086-process-manager-deferred.md:142-145`). Revisit when a flow's state fits
  no single aggregate.
- **Trusting the scheduled time** (weighed 2026-11-11). A handler that acts because its row came due
  would cancel an order whose window a later transition restarted, since the older row is still
  queued; it would need every superseded row found and removed in the same transaction as the
  transition. Re-deriving from stored state removes that obligation. Revisit if the internal-command
  queue ever supersedes a pending row atomically with the write that re-arms it.
- **A separate workflow engine** (weighed 2026-11-11), such as the broker-side saga state machine
  ADR-086 describes. It brings a second persistence model, a package and a stuck-instance failure
  mode for a flow whose state is already two members of one aggregate. Revisit at
  [ADR-086](086-process-manager-deferred.md)'s trigger: a workflow of at least three steps across at
  least two services whose state fits no single aggregate and which needs a per-instance deadline.

## Consequences
**Store adopted it without changing its stored command.** `Order` derives
`ProcessManagerAggregateRoot<OrderIdentifierType>` (`.../Orders/Order.cs:48`) and its `DecideTimeout`
checks the timeout name `PaymentExpiry` and the status first, then the due instant from
`PaymentWindowStartedOn` (the last transition only when that column is null), then cancels with
`OrderCancellationReason.PaymentExpired` (`.../Orders/Order.cs:55,1115-1135`). `ExpireUnpaidOrderInternalCommandHandler` derives the timeout
base, resolves the window from `UnpaidOrderExpirySettings.Minutes` and maps each report to its log
line
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/InternalCommands/ExpireUnpaidOrderInternalCommandHandler.cs:39-93`).
`OrderCancelledSagaHandler` derives the step base, loads the order with its lines, and overrides
`OnStepFailed` to return normally, so a failed restoration rolls back and the event stays handled
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/Saga/OrderCancelledSagaHandler.cs:49-55,83-87`).
The Sales Application DI calls `AddProcessManagers()`
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/DependencyInjection.cs:55`), and Store's
architecture suite subclasses the convention base with a floor of 1
(`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Cqrs/ProcessTimeoutConventionTests.cs:14,18`).

The stored name `Sales.ExpireUnpaidOrder` and the payload `{"OrderId":n}` are a contract with the
rows already queued. The command keeps its type name, namespace, name attribute and positional
`OrderId`, and implements `ProcessId` explicitly, so the serialized payload stays exactly the
`OrderId` property
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/InternalCommands/ExpireUnpaidOrderInternalCommand.cs:24-37`).
Both arming sites build a `ProcessTimeoutScheduler` over the internal-command scheduler and the
clock (the checkout scheduler takes them through its constructor, the payment-failure handler resolves
them from the scope it creates), which writes the same row a direct `ScheduleAsync` wrote
(`.../CheckOut/CheckOutDeadlineScheduler.cs:22-24,37,63-66`;
`.../Orders/Saga/OrderPaymentFailedSagaHandler.cs:79-89`). The payment-failure handler stays a plain
`IDomainEventHandler<OrderPaymentFailed>` (`.../Orders/Saga/OrderPaymentFailedSagaHandler.cs:23-25`).

**A new adopter** derives its aggregate from `ProcessManagerAggregateRoot<TId>` and overrides
`DecideTimeout`; declares each timeout command consumer-owned with a stable `[InternalCommandName]`
and one sealed `ProcessTimeoutHandlerBase` subclass; drives event steps with
`ProcessDomainEventHandlerBase` subclasses that save for themselves; calls `AddProcessManagers()` in
the module's Application DI and re-arms the timeout from every step that moves the process; keeps a
reconciliation sweep; and subclasses `ProcessTimeoutConventionTestsBase`, raising the floor to its
known count (`MMCA.Common/UPGRADING.md:469-487`).

## Revision (2026-11-23)
Re-verified against current source. The primitive itself (the base aggregate, the step and timeout
handler bases, the scheduler, the registration and the convention gate) is unchanged; what moved is
Store's adoption, whose deadline and unpaid-order expiry backstop no longer measure from the audit
stamp, plus the anchors.

1. Store's `Order.DecideTimeout` derives the due instant from `PaymentWindowStartedOn`, falling back
   to `GetLastTransitionOn()` only for a row written before that column existed, so a save that is
   not a payment transition leaves the deadline in place
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/Order.cs:69,1107-1109,1125`).
   Consequences and the audit-stamp trade-off now record this; the base's coupling to the audit stamp
   (`.../ProcessManagerAggregateRoot.cs:29-31`) still holds for any adopter that does not do the same.
2. The sweep's unpaid-order expiry class measures from the same `PaymentWindowStartedOn` instant,
   with the same legacy fallback, while its `PaymentInitiated` Stripe class still measures from
   `LastModifiedOn ?? CreatedOn`. Both classes also take any order past the
   `UnpaidOrderExpiry:MaxHoldMinutes` ceiling (default 240) from creation, a `PaymentInitiated` one
   only after Stripe is checked, and checkout refuses a new payment session past it
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Reconciliation/PaymentReconciliationService.cs:64-72,168-170,204-208,222`;
   `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/CreateCheckoutSession/CreateCheckoutSessionHandler.cs:18-20`;
   `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UnpaidOrderExpirySettings.cs:49-50,53`).
3. The sweep window and the deadline window are kept equal by a check, not by convention:
   `PaymentReconciliationSettingsValidator` refuses to start the host on a mismatch and is registered
   by the Sales module
   (`.../Payments/Reconciliation/PaymentReconciliationSettingsValidator.cs:14,33-37`;
   `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/SalesModule.cs:90`).
4. Anchors re-verified against current source: `MMCA.Common/CHANGELOG.md:511,548` (the 1.289.0
   section and its process-manager entry); `MMCA.Common/UPGRADING.md:465-466` (opt-in, no table, no
   migration, no key), `:469-487` (adopter steps) and `:484-487` (convention base only when used);
   `.../Orders/Order.cs:192,232` (saga state), `:48` (class declaration), `:55`
   (`PaymentExpiryTimeout`), `:1101-1105` (stale or doubled timeout is harmless) and `:1115-1135`
   (`DecideTimeout`); `.../PaymentReconciliationService.cs:53-61` (backstop list);
   `.../PaymentReconciliationSettings.cs:17-22,49` (`StuckAgeMinutes`).

## Related
- [ADR-003](003-outbox-dual-dispatch.md): the outbox that redelivers the events driving each step.
- [ADR-014](014-cqrs-decorator-pipeline.md): the pipeline that wraps every timeout handler.
- [ADR-054](054-saga-compensation-and-reconciliation.md): the compensation and the reconciliation
  backstop; Store's compensation and deadline ride the two bases.
- [ADR-086](086-process-manager-deferred.md): the deferred coordinator for state that fits no single
  aggregate.
- [ADR-114](114-internal-commands-durable-job-queue.md): the internal-command queue that carries the
  timeouts.
