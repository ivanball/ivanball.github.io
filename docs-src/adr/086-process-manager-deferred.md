# ADR-086: A Process Manager Is Deferred, Not Absent (Relates to ADR-054)

## Status
Accepted (2026-08-18) **as a documented deferral**. Nothing ships with this record: no state machine,
no correlation store, no new package. What ships is the shape the coordinator would take, the
constraint that limits the technology choice, and the single condition that would start the work.
[ADR-054](054-saga-compensation-and-reconciliation.md) remains the accepted mechanism until then.

## Context
[ADR-054](054-saga-compensation-and-reconciliation.md) decided how this workspace achieves
cross-boundary consistency without two-phase commit: **choreography**. Each step of a workflow raises
a domain event, each compensating action is its own handler, idempotency is a marker committed by the
same `SaveChanges` as the compensating writes, and a periodic reconciliation sweep is the
saga-timeout backstop for a step that depends on an external system.

That record also states, precisely and without hedging, why choreography was correct for the one
workflow it covers: `Order.Status` plus `Order.InventoryRestored` **are** the saga state, so an
orchestrator would add a state machine and a persistence store to track what the aggregate already
records. The rationale is conditional on the workflow, and the condition is not stated as permanent.

What ADR-054 does not answer is what happens to that reasoning when a workflow's state stops fitting
on one aggregate in one database. Three properties of a multi-step workflow break the choreography
argument, and none of them is present today:

- **State that belongs to no aggregate.** "Step 2 of 4 completed, step 3 awaiting a reply, deadline at
  14:05" is workflow state, not order state. Choreography needs somewhere to put it, and today the
  answer is a status column on the aggregate that happens to have one.
- **A timeout that is not a poll.** ADR-054's sweep is a fixed-interval scan for rows that have sat
  too long (`PaymentReconciliationService`, a 10-minute interval and a 30-minute stuck age at the
  shipped defaults). That is a perfectly good backstop for one known-shape wait. It is not a
  per-instance scheduled deadline, and a workflow with several different waits would need a sweep per
  wait.
- **Compensation that must unwind in order.** ADR-054's compensating handlers are independent: cancel
  restores stock, payment failure notifies the customer, and neither depends on the other having run.
  A four-step workflow that must undo steps 3, 2 and 1 in that order has an ordering requirement no
  set of independent handlers expresses.

Nothing in the four repositories has these properties. A content sweep of the `Source` trees for
`MassTransitStateMachine`, `SagaStateMachineInstance`, `ISaga` and `InMemorySagaRepository` returns
**no match in any repo**, which is the verifiable form of "no orchestrated workflow exists".
`PaymentReconciliationService` in MMCA.Store's Sales module is still the only reconciliation sweep,
and `PeriodicBackgroundService` still has exactly one production subclass.

Writing an orchestrator now would therefore be building the coordinator before the workflow. This
record exists because the alternative failure mode is worse: the first genuine multi-step
cross-service workflow arriving with no recorded design, and being answered with a fifth ad-hoc status
column.

## Decision
Defer the process manager, and record its shape so the deferral is a design decision rather than an
omission.

### The shape it would take
A durable multi-step workflow coordinator in this workspace is a **MassTransit v8 saga state
machine**, not a hand-rolled orchestrator and not a third-party workflow engine:

- **`MassTransitStateMachine<TInstance>` for the definition.** The transport abstraction
  ([ADR-066](066-broker-transport-selection.md)) is already MassTransit across all three providers
  (`InProcess`, RabbitMQ locally, Azure Service Bus in production), so the state machine rides the
  bus that already exists. Introducing a second coordination technology beside it would mean two
  retry models, two dead-letter destinations and two sets of transport configuration.
- **Durable correlation state per workflow instance.** One row per running workflow, keyed by a
  `CorrelationId`, carrying the current state and whatever the workflow needs to remember between
  steps. It belongs in the owning service's own database
  ([ADR-006](006-database-per-service.md)), the same placement the outbox and the inbox already take,
  which keeps the coordinator inside one transactional boundary with the data it coordinates and adds
  no shared store to race on.
- **Timeouts as scheduled messages, not as a sweep.** A state machine expresses a deadline per
  instance rather than as a periodic scan for stale rows. That is the property ADR-054's sweep cannot
  express and the main functional reason to reach for one.
- **Compensation hooks folding into ADR-054's backstop, not replacing it.** A state machine's
  compensating transitions would call the same guarded, `Result`-returning domain transitions
  ADR-054 already insists on ("the sweep gets no private path into the aggregate"). The
  reconciliation sweep stays underneath as the backstop for the case the coordinator itself cannot
  cover: an external system that never replies at all. Orchestration narrows what the sweep has to
  catch; it does not make an external provider reliable.

### The constraint that shapes the technology choice
MassTransit is **pinned to v8** and the pin is a build gate
([ADR-016](016-lockstep-versioning-masstransit-pin.md)): `MassTransit`, `MassTransit.RabbitMQ` and
`MassTransit.Azure.ServiceBus.Core` are all held at 8.5.10 in
`MMCA.Common/Directory.Packages.props:79-81`, because v9 requires a commercial license. The v8 saga
state machine and its EF Core saga repository are fully capable, so the pin does not block the design;
what it blocks is assuming a future v9 feature, and it means the coordinator inherits the pin's own
risk. If v8 stops receiving security fixes, a process manager built on it is inside the blast radius
of that migration rather than beside it. That is a reason to build the coordinator when a workflow
needs it, not in advance of one.

### The trigger
Build it when **the first real multi-step cross-service workflow appears**: a workflow with at least
three steps spanning at least two services, whose state does not fit on a single aggregate, and which
needs at least one per-instance deadline. Until then ADR-054's compensating handlers plus the outbox's
bounded retries and dead-lettering ([ADR-003](003-outbox-dual-dispatch.md)) are sufficient, and this
record is the design the implementing PR starts from.

## Rationale
- **Choreography is genuinely correct for the workflow that exists.** This is not a case of the
  simpler option being tolerated. Checkout's saga state is two fields on `Order`, and an orchestrator
  would introduce a state row that duplicates them, with the two able to disagree. ADR-054's argument
  is sound and this record does not weaken it.
- **The coordinator is cheap to add and expensive to have prematurely.** A saga state machine is a
  class, a migration and a repository registration on infrastructure that already exists. What is
  expensive is the standing cost: a second persistence model, a second failure mode (a stuck instance
  that is neither running nor complete), and a second place to look during an incident. Nothing today
  earns that.
- **The design is the deliverable, not the code.** The failure this record prevents is a fifth status
  column, not the absence of a state machine. Whoever meets the trigger inherits a technology choice,
  a placement, a licensing constraint and a relationship to ADR-054, which is most of the design work.
- **Naming the trigger keeps the deferral falsifiable.** "We do not need one yet" is a claim that can
  be checked against a workflow inventory. Without the three-part test above it is a preference.
- **One coordination technology, chosen for the transport already in place.** Reaching for a workflow
  engine outside the bus would add an operational dependency to two production deployments to solve a
  problem neither currently has.

## Trade-offs
- **The first workflow to hit the trigger pays the full cost at once**, under whatever deadline made
  it appear. Deferral moves the work onto the critical path of the feature that needs it, which is
  the standing cost of every deferral and is recorded rather than mitigated.
- **The trigger relies on someone recognizing it.** There is no inventory of workflow shapes and no
  gate that fires when a third step is added to a two-step flow. In practice the third status column
  is likelier to be noticed at review than at design time, and by then it exists.
- **Nothing here is validated by running code.** No saga state machine has ever been built in this
  workspace, so the shape above is a design on paper: the EF saga repository has not been exercised
  against `SQLServerDbContext`, and the interaction between a saga's own persistence and the
  outbox interceptor ([ADR-003](003-outbox-dual-dispatch.md)) is unexplored. Expect the implementing
  PR to find something this record did not anticipate.
- **The v8 pin is inherited, not resolved.** A coordinator built on MassTransit v8 makes the pin
  harder to leave, because a licensing or end-of-support forced move would then also be a workflow
  migration rather than only a transport one.
- **ADR-054's sweep does not go away.** Even after a process manager exists, the reconciliation
  backstop is still needed for external systems that never reply, so the eventual state is two
  mechanisms rather than one replacing the other. This record's benefit is a narrower job for the
  sweep, not its retirement.

## Related
[ADR-054](054-saga-compensation-and-reconciliation.md) (the accepted mechanism this record defers an
alternative to: choreographed compensation, the persisted aggregate marker, and the reconciliation
sweep that would remain underneath a process manager),
[ADR-003](003-outbox-dual-dispatch.md) (the at-least-once delivery, bounded retries and dead-lettering
that make choreography sufficient today, and that a saga would sit on top of rather than replace),
[ADR-066](066-broker-transport-selection.md) (the MassTransit transport abstraction the state machine
would ride), [ADR-016](016-lockstep-versioning-masstransit-pin.md) (the v8 pin, its licensing reason
and its build gate), [ADR-006](006-database-per-service.md) (where the correlation state would live:
the owning service's own database, beside its outbox and inbox),
[ADR-021](021-consumer-inbox-idempotency.md) (consume-edge dedup, which a saga needs exactly as much
as a handler does), [ADR-052](052-background-job-execution.md) (the hosted-service family the
reconciliation sweep belongs to, and the in-process alternative a per-instance deadline is not),
[ADR-084](084-stripe-webhook-ingress.md) (the third-party ingress whose unreliability is the specific
thing no coordinator can fix).
