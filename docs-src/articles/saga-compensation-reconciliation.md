# Undo Is a Feature: Saga Compensation and the Reconciliation Backstop

> Series: MMCA.Common · Article #49 (deep-dive) · Pillar P2/P3 · Group G04 · Rubric §6,§29 · ADR-054, ADR-084, ADR-086, ADR-143 ·
> Status: grounded in `Website/docs-src/adr/054-saga-compensation-and-reconciliation.md`,
> `Website/docs-src/adr/084-stripe-webhook-ingress.md`,
> `Website/docs-src/adr/086-process-manager-deferred.md`,
> `Website/docs-src/adr/143-process-manager-primitive.md`,
> `MMCA.Store/.../Sales.Application/Orders/Saga/OrderCancelledSagaHandler.cs`,
> `.../Orders/Saga/OrderPaymentFailedSagaHandler.cs`, `.../Orders/UseCases/Cancel/CancelOrderHandler.cs`,
> `.../Orders/InternalCommands/ExpireUnpaidOrderInternalCommandHandler.cs`,
> `.../ShoppingCarts/UseCases/CheckOut/CheckOutHandler.cs`, `.../ShoppingCarts/UseCases/CheckOut/PlacedOrderFinalizer.cs`,
> `.../Sales.Domain/Orders/Order.cs`, `.../Sales.Domain/Inventory/InventoryRestorationDomainService.cs`,
> `.../Sales.API/Controllers/PaymentsController.cs`,
> `.../Sales.Infrastructure/Payments/Stripe/StripeWebhookRegistrationService.cs`,
> `.../Sales.Infrastructure/Payments/Reconciliation/PaymentReconciliationService.cs`,
> `.../Sales.Infrastructure/Payments/Reconciliation/PaymentReconciliationSettings.cs`,
> `MMCA.Common/.../Domain/ProcessManagers/ProcessManagerAggregateRoot.cs`,
> `MMCA.Common/.../Application/ProcessManagers/ProcessDomainEventHandlerBase.cs`,
> `MMCA.Common/.../Application/ProcessManagers/ProcessTimeoutHandlerBase.cs`,
> `MMCA.Common/.../Application/Services/DomainEventDispatcher.cs`,
> `MMCA.Common/.../Application/DomainEvents/SafeDomainEventHandler.cs`,
> `MMCA.Common/.../Infrastructure/Persistence/DbContexts/Factory/DbContextFactory.cs`,
> `MMCA.Common/.../Infrastructure/Hosting/Background/PeriodicBackgroundService.cs`, the test suites that
> cover them, and the §6/§29 rows of `Website/docs-src/governance/ArchitectureEvaluationCriteria.md`. No em dashes.

**Subtitle:** A cancelled order has to give back stock that a transaction closed minutes ago already took,
and a payment confirmation that never arrives strands the order forever. Here is compensation as its own
event handler, idempotency as a persisted marker committed in the same transaction as the writes it
guards, an honest account of which failures get retried and which only get logged, and a periodic sweep
as the saga-timeout backstop.

---

Checkout is the easy part. In MMCA.Store's Sales module it is genuinely atomic: the order insert, the cart
transition, and the conditional stock decrements all commit inside one explicit local transaction
(`ExecuteInTransactionAsync` at `CheckOutHandler.cs:106-108` over the `WriteAsync` delegate `:150-216`,
insert `:195`, decrements `:201-204`, save `:207`), and a failed decrement returns a failed `Result` that
rolls the whole thing back. One database, one transaction, no drama. Just before that save the delegate
starts the order's payment window (`placedOrderFinalizer.StartPaymentWindow`, `:206`;
`PlacedOrderFinalizer.cs:36`), and after it hands the saved order to `PlacedOrderFinalizer.FinalizeAsync`
(`CheckOutHandler.cs:213`, comment `:209-212`), which attaches the shipping label and arms the order's own
unpaid-payment deadline as a scheduled row (`PlacedOrderFinalizer.cs:51-72`, the arming call at `:71`) on
the same enlisted context, so the deadline commits with the order or rolls back with it. Guest checkout
runs the same two calls inside its own transaction (`GuestCheckOutHandler.cs:120,123`).

Then the money moves at Stripe, and the confirmation comes back later, as a webhook, from outside your
database entirely. And two things go wrong that no transaction can fix:

1. **A later step invalidates an earlier one.** The customer cancels. The stock that checkout committed is
   still decremented, and you cannot roll that decrement back, because its transaction closed minutes ago.
2. **The external confirmation never arrives.** An endpoint outage that outlasts Stripe's retry window, a
   misconfigured webhook secret, and the order sits in `PaymentInitiated` forever with its stock held.

The instinct is to reach for a transaction that spans both, and there isn't one. There is no two-phase
commit across a database and a payment provider, and there would not be one worth having even if the
provider could enlist. So the question is not "how do I roll this back." It is "what do I do instead, and
how do I make it disciplined enough to trust." That is the decision recorded in **ADR-054**.

## Why it matters

The rubric has two categories aimed straight at this. §6 (CQRS and Event-Driven Design, heading at
`ArchitectureEvaluationCriteria.md:229`) asks for idempotent consumers (`:238`) and for eventual-consistency
boundaries that are **explicit and documented in an ADR** (`:239`), with "consumers that aren't idempotent
and break on redelivery" listed as a red flag (`:245`). §29 (Resilience, Reliability and Business
Continuity, `:775`) is a weight-3 category (`:795`) that asks for failure isolation (`:780`) and graceful
degradation (`:781`), and names "retries without backoff/idempotency (retry storms, duplicate side
effects)" as its own red flag (`:791`).

Note what those two demand together: not just that you retry, but that retrying is **safe**. That is the
hard half. Delivering an event at least once is a solved problem (the transactional outbox, ADR-003).
Making the handler survive being run twice is where systems quietly rot.

And it is the question the neighbouring records leave open on purpose. ADR-003 gets an event out of the
process at least once. ADR-021 stops a broker redelivery from being applied twice at the consume edge.
ADR-006 decides database-per-service and records "no cross-database transactions, no two-phase commit" only
as a **cost it accepts**, without saying how that cost gets paid (`ADR-054:59-63`). None of them says what a
multi-step workflow does when step two fails or step three never reports back.

## The MMCA answer: compensation is a handler, not a branch in the command

The command handler does one thing, and it does not even own the plumbing for that.
`CancelOrderHandler` derives from `MutateEntityHandlerBase<CancelOrderCommand, Order, OrderIdentifierType>`
(`CancelOrderHandler.cs:27-31`), so the load, the rowversion stamp and the save belong to the base class. The
handler contributes four overrides: the id to load (`:39`), the client's last-seen rowversion so a
stale-view cancellation fails with a conflict (ADR-035, `:46`), the mutation itself (`:60-81`), and the
success log line (`LogMutated`, `:143-144`). It does
not touch inventory, and its own remarks say so (`:49-59`).

The mutation first refuses a stale token itself (`OrderConcurrency.EnsureCurrent`, `:68-72`), so the
customer's live session is never expired on behalf of a stale view (remarks `:54-58`). Then it takes two
steps: retire the payment provider's live checkout session (`:74-78`), then call the guarded transition
`entity.MarkAsCancelled()` (`:80`). That first step is the one compensating action that is
deliberately inline rather than in a saga handler, and the class documentation argues the case (`:17-25`):
an order can only be cancelled out of `PaymentInitiated` while the provider still serves a payable hosted
page, so the cancel has to answer "has this already been paid?" **before** it commits. A saga step runs
after the commit and could only ever discover the money afterwards, with the order already `Cancelled` and a
manual refund the only remedy left. So `RetirePaymentSessionAsync` (`:104-140`) hands the session to the
shared `PaymentSessionRetirement.RetireAsync`, which reads the session status, expires the hosted page, and
reads the status again when the expire fails (`:113-117`). When the session turns out to be paid, the
handler **refuses the cancellation** with `OrderCancellationErrorCodes.PaymentAlreadyCompleted`
(`:124-132`). Every other outcome (already expired, session gone, provider unreachable) is non-fatal: it is
logged and the cancellation proceeds (`:119-122`, `:134-137`).

`Order.MarkAsCancelled(OrderCancellationReason reason = Requested)` (`Order.cs:1049`) asks the current
state object whether the transition is legal and, on success, records a domain event carrying that reason
(`Order.cs:1057`). `OrderCancelled` is a plain `BaseDomainEvent` (`OrderCancelled.cs:13-17`, with
`OrderId`, `CustomerId` and a `Reason` that defaults to `Requested`), not an integration event, so it
dispatches in-process after the save.

Restoring the stock is a separate class: `OrderCancelledSagaHandler`, a step of the order process that
derives `ProcessDomainEventHandlerBase<OrderCancelled, Order, OrderIdentifierType>`
(`OrderCancelledSagaHandler.cs:49-52`). Notifying the customer of a failed payment is another one,
`OrderPaymentFailedSagaHandler` (`OrderPaymentFailedSagaHandler.cs:23-25`). This is the choreographed
shape: each step raises an event, and each follow-up or compensating action lives in its own handler. A new
compensating action that can run after the commit (a refund, another notification) is a new handler, not an
edit to the command.

**Each handler runs in its own DI scope.** Domain-event handlers are registered as singletons by the
framework's convention scan (`ScanModuleApplicationServices` at
`MMCA.Common.Application/DependencyInjection.ModuleScanning.cs:46`, with the comment at `:51` stating that
they are singletons that create their own DI scopes internally, and `WithSingletonLifetime()` closing that
scan at `:56`), so every handler resolves what it needs from a scope it opens through
`IServiceScopeFactory`: for the compensation the process-step base opens it (`ProcessDomainEventHandlerBase.cs:47-50`),
and `OrderPaymentFailedSagaHandler` opens its own (`OrderPaymentFailedSagaHandler.cs:32`). The consequence
is the important part: compensation commits **on its own, after** the originating save, rather than joining
the transaction it is compensating for. That is what makes it compensation rather than a rollback.

## The order is the process: the ADR-143 process-manager primitive

Choreography still leaves a shape to give the flow, and **ADR-143** gives it one without adding a
coordinator. The order's saga state is two members it already has, `Order.Status` and
`Order.InventoryRestored` (ADR-143 Context, `143-process-manager-primitive.md:18-20`), so the framework's
primitive is behaviour only, in three parts.

**The process aggregate.** `ProcessManagerAggregateRoot<TIdentifierType>`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/ProcessManagers/ProcessManagerAggregateRoot.cs:17`) derives
`AuditableAggregateRootEntity<TIdentifierType>` and declares no property and no field, so deriving from it
leaves the EF model and every migration snapshot unchanged (`:10-11`). It adds `GetLastTransitionOn()`,
`LastModifiedOn ?? CreatedOn` (`:29-31`, a method on purpose so it never maps into an adopter's model,
`:25-28`), and a virtual `DecideTimeout(ProcessTimeout timeout, DateTime utcNow)` that answers
`NotApplicable` by default (`:43-44`). An override re-derives the due instant from stored state, so a stale
or re-armed timeout is a no-op by construction (`:33-38`). `Order` derives it (`Order.cs:48`), names its one
timeout `PaymentExpiry` (`:55`), stores the instant its payment window started (`PaymentWindowStartedOn`,
`:70`) and overrides `DecideTimeout` (`:1118`).

**One step per domain event.** `ProcessDomainEventHandlerBase<TDomainEvent, TProcess, TProcessId>`
implements `IDomainEventHandler<TDomainEvent>` (`ProcessDomainEventHandlerBase.cs:31-35`). For each event it
calls `OnStepStarting` (`:45`), opens ONE async scope (`:47-48`), runs ONE `ExecuteInTransactionAsync` whose
delegate loads the process tracked by `CorrelateProcessId` with the overridable `Includes` (`:52-57`), and
hands it to the abstract `HandleStepAsync` (`:65-69`); a missing process calls `OnProcessMissing` and the
event is handled (`:59-63`). The step owns its saves: the base never calls `SaveChangesAsync`, and the
transaction refuses to commit unsaved changes (`:17-18`). A failed `Result` rolls the unit back and then
reaches `OnStepFailed` (`:73-76`), whose default throws `ProcessStepFailedException` so the outbox
redelivers the event (`:120-124`); an override that returns normally keeps the event handled (`:112-116`).

**Timeouts are internal commands the aggregate decides.** A process timeout is a consumer-owned internal
command, armed through `IProcessTimeoutScheduler.ArmAsync`, whose write is enrolled in the active
transaction when there is one (`143-process-manager-primitive.md:107-122`). It is handled by
`ProcessTimeoutHandlerBase<TCommand, TProcess, TProcessId>`, an `ICommandHandler<TCommand, Result>`
(`ProcessTimeoutHandlerBase.cs:36-43`), so the decorator pipeline wraps it like any command. It resolves
the timeout once, before the load (`:53`), loads the process tracked (`:56-58`) and asks it to decide
against the injected clock (`:67`). Every outcome except `Applied` completes the row with success and saves
nothing (`:78-84`); `Applied` saves once (`:88`), a save the concurrency detector classifies as a conflict is
a lost race that also completes the row (`:90-94`), and any other save exception propagates so the row
retries with backoff (`:14-15`). A `NotYetDue` decision schedules nothing, so every step that still wants
the timeout arms it again, and a host keeps a reconciliation sweep for what no step covers (`:21-23`).

Store's unpaid-order deadline is the adopter.
`ExpireUnpaidOrderInternalCommandHandler : ProcessTimeoutHandlerBase<ExpireUnpaidOrderInternalCommand, Order, OrderIdentifierType>`
(`ExpireUnpaidOrderInternalCommandHandler.cs:40-49`) resolves the timeout as `Order.PaymentExpiryTimeout`
over the configured `UnpaidOrderExpiry:Minutes` (`:52-53`), measured from `PaymentWindowStartedOn` rather
than from the schedule time (`:20-24`), so the older row a failed payment leaves behind when it re-arms the
deadline is a no-op (`:27-31`). Checkout arms it (`PlacedOrderFinalizer.cs:71`), and
`OrderPaymentFailedSagaHandler` re-arms it through the timeout scheduler (`OrderPaymentFailedSagaHandler.cs:87`).
The durable queue underneath, its retries and its dead-letter path are the subject of Article 51
(`Website/docs-src/articles/durable-internal-commands.md`), so they are not re-taught here.

## The marker: idempotency as a database invariant

Here is the part worth stealing even if you never touch this framework.

At-least-once delivery means the compensating handler will eventually run twice. If restoring stock is not
idempotent, the second run inflates inventory, and you have turned a reliability mechanism into a data-corruption
mechanism.

MMCA.Store makes it idempotent with a persisted marker on the aggregate. `Order.InventoryRestored`
(`Order.cs:233`, documented `:227-232`) is a boolean with a private setter, and `MarkInventoryRestored()`
(`Order.cs:1069-1092`) is a guarded transition like any other: it refuses on a non-cancelled order
(`:1071-1078`) and refuses a second call (`:1080-1087`), both as `Result.Failure` with named invariant codes.

The restoration runs as one `ExecuteInTransactionAsync` delegate: the process-step base opens it and loads
the order (`ProcessDomainEventHandlerBase.cs:52-71`), and the handler's `HandleStepAsync`
(`OrderCancelledSagaHandler.cs:97-189`) does the work. In order, five things happen:

1. The base loads the order tracked, with its lines, in the step's own scope
   (`ProcessDomainEventHandlerBase.cs:55-57`, the `Includes` override at `OrderCancelledSagaHandler.cs:55`).
2. The step checks the marker first and returns success without writing anything if it is already set
   (`OrderCancelledSagaHandler.cs:113-117`).
3. It reads the matching inventory rows **non-tracking** (`asTracking: false`, `:127`) and **with the
   soft-delete filter deliberately turned off** (`ignoreQueryFilters: true`, `:132`), then runs them through
   a static, pure domain service with no infrastructure dependencies,
   `InventoryRestorationDomainService.RestoreInventory` (`:137`; the static class at
   `InventoryRestorationDomainService.cs:10`, "pure domain service" comment `:8`, method `:24-51`). That
   call validates every increase against the inventory invariants and hands back either a failure carrying
   every rejected error (`:41-50`) or the variant ids it could not match (`:33-38`), which the handler logs
   by name (`OrderCancelledSagaHandler.cs:146-152`). Its in-memory increase lands on the non-tracking
   snapshot and is never saved (comment `:125-126`, class doc `:29-31`).
4. It sets the marker (`:159`) and saves it **first** (`:168`).
5. It moves the stock through `IInventoryAllocationService.IncrementAsync`, a relative atomic `UPDATE` rather
   than a load-edit-save, for the lines that matched a row (`:170-185`).

The transaction is the whole design. The marker and the increases commit together or roll back together,
against the same database: a failed `Result` from the delegate rolls back everything it wrote, marker
included (`DbContextFactory.cs:642-649`), and a throw does the same (`:674-682`). So the marker cannot exist
without the writes it guards, and the writes cannot land unmarked. Idempotency stops being handler
discipline and becomes a database invariant.

Step 5's relative update is there because checkout never stops. Checkouts decrement the same inventory rows
with atomic updates at any moment, so a tracked restore would either overwrite those decrements or fail on
the row's concurrency token (class doc `OrderCancelledSagaHandler.cs:25-32`). Validating on a snapshot and
moving the stock with a relative update keeps the restore out of that race entirely.

Step 3's filter override is a smaller decision with a real consequence. A retired variant is
soft-deleted, not removed, and the stock a cancelled order is returning still belongs to that row: without
`ignoreQueryFilters`, the row is invisible to the handler and the returned quantity is silently dropped
(the comment saying so is at `:128-131`).

This is why ADR-054 says the marker is **strictly stronger than the ADR-021 inbox** (`ADR-054:273-276`).
The inbox records a message id after the handlers have succeeded, which leaves a narrow crash window
between the handler's commit and the inbox write. A marker committed *with* the writes has no such window.
The two are complementary rather than competing: the inbox dedups broker redeliveries between services, the
aggregate marker dedups in-process handler re-runs.

**Concurrent redeliveries are handled by a different mechanism.** The marker check is a read, so two
deliveries can both pass it. Every auditable entity carries a `RowVersion` concurrency token
(`AuditableBaseEntity.cs:55`), configured automatically on every non-owned auditable type by
`ConfigureConcurrencyTokens` (`ApplicationDbContext.cs:737-757`, called from `OnModelCreating` at `:556`,
ADR-035). Both deliveries carry the same original token into the marker save. One commits; the other gets
`DbUpdateConcurrencyException` on the order row before it has touched any stock (that is why the marker is
saved first, comment `OrderCancelledSagaHandler.cs:166-167`), its transaction rolls back and the exception
propagates, and its outbox retry then finds the committed marker and skips. Sequential redelivery is handled
by the marker, concurrent redelivery by the token.

```csharp
// Condensed from ProcessDomainEventHandlerBase.HandleAsync (MMCA.Common) and the
// OrderCancelledSagaHandler overrides (MMCA.Store); logging trimmed.

// Framework: one scope, one transaction, the process loaded tracked, the Result checked.
public async Task HandleAsync(TDomainEvent domainEvent, CancellationToken cancellationToken = default)
{
    OnStepStarting(domainEvent);
    var scope = serviceScopeFactory.CreateAsyncScope();
    await using (scope.ConfigureAwait(false))
    {
        var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();
        var result = await unitOfWork.ExecuteInTransactionAsync(
            async token =>
            {
                var process = await unitOfWork.GetRepository<TProcess, TProcessId>()
                    .GetByIdAsync(CorrelateProcessId(domainEvent), Includes, asTracking: true, token)
                    .ConfigureAwait(false);
                if (process is null)
                {
                    OnProcessMissing(domainEvent);
                    return Result.Success();
                }

                return await HandleStepAsync(process, domainEvent,
                    new ProcessStepContext(scope.ServiceProvider, unitOfWork), token).ConfigureAwait(false);
            },
            cancellationToken).ConfigureAwait(false);

        if (result.IsFailure)
            OnStepFailed(domainEvent, result.Errors);   // default: throw, so the outbox redelivers
    }
}

// Store: load the lines with the order, keep a failed step handled, restore the stock.
protected override IEnumerable<string> Includes => [nameof(Order.OrderLines)];

protected override void OnStepFailed(OrderCancelled domainEvent, IReadOnlyList<Error> errors)
{
    // Intentionally empty: the step logged the failure and the unit rolled back.
}

protected override async Task<Result> HandleStepAsync(Order order, OrderCancelled domainEvent,
    ProcessStepContext context, CancellationToken cancellationToken)
{
    var unitOfWork = context.UnitOfWork;
    var inventoryAllocation = context.Services.GetRequiredService<IInventoryAllocationService>();

    // Idempotency guard: a redelivered OrderCancelled event must not restore stock twice.
    if (order.InventoryRestored)
        return Result.Success();

    var variantIds = order.OrderLines.Select(ol => ol.ProductVariantId).Distinct().ToArray();
    var allItems = await unitOfWork.GetRepository<InventoryItem, ProductVariantIdentifierType>().GetAllAsync(
        includes: [], where: i => variantIds.Contains(i.Id),
        asTracking: false,         // validation only: this in-memory increase is never saved
        ignoreQueryFilters: true,  // a soft-deleted row is still the row this stock belongs to
        cancellationToken: cancellationToken).ConfigureAwait(false);
    var itemsByVariant = allItems.ToDictionary(i => i.Id);

    var restoreResult = InventoryRestorationDomainService.RestoreInventory(order.OrderLines, itemsByVariant);
    if (restoreResult.IsFailure)
        return Result.Failure(restoreResult.Errors);   // Warning; nothing written
    if (restoreResult.Value is { Count: > 0 } unmatchedVariantIds)
        LogInventoryItemsNotFound(logger, domainEvent.OrderId, string.Join(", ", unmatchedVariantIds));

    var markResult = order.MarkInventoryRestored();
    if (markResult.IsFailure)
        return Result.Failure(markResult.Errors);      // Warning; nothing written

    // The marker first: its rowversion-guarded UPDATE takes the order row, so a
    // concurrent delivery fails here, before it touches any stock.
    await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

    InventoryIncrement[] increments =
    [
        .. order.OrderLines
            .Where(line => itemsByVariant.ContainsKey(line.ProductVariantId))
            .Select(line => new InventoryIncrement(line.ProductVariantId, line.Quantity)),
    ];
    if (increments.Length > 0)
    {
        var incrementResult = await inventoryAllocation.IncrementAsync(increments, cancellationToken)
            .ConfigureAwait(false);
        if (incrementResult.IsFailure)
            return incrementResult;                     // Warning; the marker rolls back with it
    }

    return Result.Success();
}
```

## Redelivery is the retry mechanism, but only for a throw

A compensating handler needs no retry loop of its own, because it already sits on one. The catch is that
the loop only ever sees exceptions.

When in-process dispatch throws, the domain-event interceptor logs the failure and signals the outbox rather
than swallowing the work. `FlushStateAsync` (`DomainEventSaveChangesInterceptor.cs:370`) dispatches the
save's local events (`:374-380`) and only then marks their outbox entries processed (`:384`), so a throwing
handler never reaches the mark, and the catch below it logs, releases the lease the local rows were
inserted under, and signals the processor (`:390-402`). That is the path for a save whose events are backed
by outbox rows, the one this article follows; a save with no backing row (outbox off, or a non-relational
engine) goes through `DispatchUnbackedAsync` instead (`:419-434`), which logs each event's failure and moves
on, so nothing redelivers there. The `OutboxProcessor` re-dispatches the pure
domain event on a later cycle (`OutboxProcessor.DispatchMessagesAsync`, `OutboxProcessor.cs:496`, called
from the cycle at `:250`, the dispatcher call at `:830`) with the bounded retries, backoff, and dead-lettering ADR-003 already defines. So
a handler that wants to be re-run has to throw. Inventing local retries would just duplicate a policy that
already exists one layer down.

`OrderCancelledSagaHandler` takes that path for any exception, and the one it is designed around is the
concurrent delivery that loses the rowversion race on the marker save (`OrderCancelledSagaHandler.cs:168`).
That exception rolls the transaction back and is rethrown (`DbContextFactory.cs:674-682`), the event comes
back, and the retry finds the committed marker.

**Every returned failure in that handler is kept handled, by choice.** An inventory invariant that refuses
an increase (`OrderCancelledSagaHandler.cs:138-144`), a refused `MarkInventoryRestored` (`:160-164`) and a
failed `IncrementAsync` after the marker save (`:179-184`) each log a `Warning` that says the compensation
was not persisted (messages `:203-207`) and return a failed `Result`. The transaction rolls back, marker
included (`DbContextFactory.cs:642-649`), so nothing partial reaches the database. The base then hands the
failure to `OnStepFailed` (`ProcessDomainEventHandlerBase.cs:73-76`), and the base's default would throw for
a redelivery (`:120-124`), but this handler overrides it with an empty body (`OrderCancelledSagaHandler.cs:83-87`,
remarks `:79-81`). So the dispatcher sees a handler that completed, and the interceptor goes on to mark the
event's outbox row processed (`DomainEventSaveChangesInterceptor.cs:374-384`). Nothing redelivers it. The
class documentation says a later delivery can still restore (`:43-46`); for these three cases no later
delivery arrives, and ADR-054 records exactly that gap as its own trade-off (`ADR-054:315-329`).

Nothing else picks it up either. The reconciliation sweep below selects `PaymentInitiated` orders with a
session (`PaymentReconciliationService.cs:171-173`) and `PendingPayment` or `PaymentFailed` orders
(`:225-226`); an order left in this state is `Cancelled` with `InventoryRestored` still false, which matches
neither predicate, and no other Store source reads the marker. The `Warning` naming the order and the
rejected error codes is the whole safety net: that order's stock stays unrestored until someone acts on the
log line. It is a real cost, and the honest way to read the override is as a deliberate "give up and record"
for these cases, not as a retry.

The framework takes the throwing position in its own base classes, twice. The process-step base above
throws from `OnStepFailed` unless a step opts out, which makes the Store handler's empty override an
explicit, reviewable decision rather than a discarded value. And
`SafeDomainEventHandler<TDomainEvent>` (`SafeDomainEventHandler.cs:32`) runs your `HandleSafelyAsync`
inside an exception filter, `LogAndRethrow` (`:61-70`), which writes one error line naming the handler and
the event type and then returns `false`, so the exception keeps travelling with its original stack intact
(`:42-46`). A cancellation during host shutdown passes straight through unlogged, because that is not a
delivery failure (`:42`). The class documentation records why rethrowing is required (`:13-20`): a
handler that reports success has its outbox row marked processed, so nothing retries and the side
effect is lost with only a log line to show for it. That sentence describes the opted-out path above
precisely. The base class is not a way to absorb a failure. It is a way to fail with context, and its tests
assert exactly that, including that the log lands before the caller sees the exception
(`SafeDomainEventHandlerTests.cs:33,51,73`).

The documentation also names the consequence to design for (`:21-29`). The interceptor dispatches every
local event of one save in a single call, so one rethrowing handler skips the mark-processed step for the
**whole** local batch: every event that save raised comes back, not only the one whose handler failed. A
subclass has to be idempotent about its own event and about its siblings.

The mirror case is the handler whose work is a pure side effect, where a redelivery would be worse than a
loss. `OrderPaymentFailedSagaHandler` refuses one without catching anything: it makes the side effect
durable instead. In its own scope (`:32-33`) it schedules a `SendOrderPaymentFailedEmailInternalCommand`
through `IInternalCommandScheduler` (`:35-37`), branches on the returned `Result` (an `Error`-level line
naming the order and customer when scheduling fails, an `Information` line when it succeeds, `:39-46`), and
then, while `UnpaidOrderExpiry:Enabled` is on (it returns early otherwise, `:75-78`; on by default in the
Sales service's `appsettings.json:116`), re-arms the order's payment deadline so a failed attempt hands the
customer the whole retry window again (`:48`, `RearmExpiryDeadlineAsync` `:69-99`, arming through `ProcessTimeoutScheduler.ArmAsync`
`:83-90` and logging rather than throwing on failure, `:92-96`). The class documentation states the rule
that makes both branches correct (`:12-22`): the order is already persisted as `PaymentFailed` before this
handler runs, so a scheduling failure is logged rather than thrown, and a transport outage retries the
queued message rather than losing it. It implements `IDomainEventHandler<OrderPaymentFailed>` directly
(`:23-25`), and no production handler in the four repos derives from `SafeDomainEventHandler`, its only
subclass being the test double in that base class's own unit tests (`SafeDomainEventHandlerTests.cs:124`).
The durable queue that carries that scheduled row is Article 51's subject, "Four Ways to Do Work Later:
Channels, Cron, the Outbox and Durable Internal Commands".

The choice is therefore explicit per handler: **throw to get a redelivery, take the work somewhere that
survives on its own, or return a failure and accept that a log line is the record.** The first two are
mechanisms. The third is a decision to stop, and it should be made on purpose and written down, the way
ADR-054 writes it down.

## The inbound edge: a webhook is a delivery contract, not an API call

Everything so far is about a message leaving the process (ADR-003, at-least-once out) or a broker
redelivery arriving at a consumer (ADR-021, dedup on the way in). The Stripe webhook is the third leg of
that family and it matches neither: an inbound call from a third party you do not control, which cannot
authenticate as an application user, does not send an `Idempotency-Key`, and never touches your broker.
**ADR-084** records that contract, and it is worth reading before the backstop, because the backstop
exists for the deliveries this contract loses.

The endpoint is one anonymous POST that reads the body raw, because signature verification needs the
unmodified payload and model binding would destroy it (`PaymentsController.cs:57,66`, raw read `:81-87`),
with the `Stripe-Signature` header read alongside it (`:86`). That signature is the only authentication
there is, which is also why the action carries `[RequestSizeLimit(1_000_000)]` (`:76`): verification happens
*after* the body is read, so without a cap every anonymous caller can make the endpoint allocate up to
Kestrel's default before a single byte is authenticated, on a service that runs at 0.5 GiB. The comment
above it picks 1 MB rather than a few hundred KB on purpose (`:67-75`): Stripe events occasionally exceed
that, and rejecting a genuine event costs a retry storm toward endpoint disablement.

The load-bearing decision is what the status code *means*. **It encodes ACCEPTED, not PROCESSED.**
Five failure codes return 400, held in a `FrozenSet` named `RejectionCodes` (`:39-46`): signature
verification failed, the signed payload could not be parsed, no signing secret is configured, and the two
shape rejections that `ProcessPaymentWebhookCommandValidator` raises in the Validating decorator before the
handler ever runs, a body-less delivery and a signature-less one. The remarks above the set explain why the
last two belong there (`:31-38`): nothing was verified, so a 200 would report as accepted a delivery that
never was, and would suppress the retry a genuinely broken caller still needs. Everything past acceptance
returns 200, **including an event for an order that cannot be found** (`:48-56,100-118`). That reads as
wrong until you read the status code the way the caller does: Stripe treats a non-2xx as "retry me", and
sustained failures make it **disable the endpoint**, which silently stops every payment status update for
the whole store. Mapping an application failure to 400 would be locally honest and globally catastrophic.
So a post-acceptance failure logs at `Warning` and still returns 200 (`:115,118`), while a rejection logs at
`Critical` with the consequence spelled out in the message text (`:111,122-126`). `Critical` is deliberate,
not drama: this ran at `Warning` for weeks while the configured signing secret did not match the live
endpoint, so 100% of deliveries were rejected and nothing surfaced it (`:105-110`).

The provider-side half is that the endpoint registers itself. `StripeWebhookRegistrationService` is a
`BackgroundService` (`:47-54`) registered by the Sales module in the same method that registers the
reconciliation sweep below (`Sales.Infrastructure/DependencyInjection.cs:51`, sweep at `:54`). It skips
entirely when no `WebhookBaseUrl` is set (`:102-106`), which is the local path where the Stripe CLI
forwards instead; a host with an empty Stripe secret key never starts at all, because that key is
`[Required]` and validated on start (`StripeSettings.cs:24-25`, `SalesModule.cs:53-56`), though the committed
`SET-VIA-USER-SECRETS` placeholder satisfies that check and fails only at the Stripe call (`ADR-084:258-264`).
It subscribes six event types
(`StripeWebhookRegistrationService.cs:83-91`): the three that drive payment, plus `charge.refunded`,
`charge.dispute.created` and `charge.dispute.closed`, which record what happened to the money afterwards
(`:78-82`). It stamps every endpoint it creates with the description prefix `Auto-registered by MMCA`
(`:63`). That prefix is the whole reason an automated delete is acceptable: `IsStaleAutoRegistered` returns
`false` for any endpoint lacking it, so an operator-created endpoint is never touched, and `true` only for
one of its own whose URL has moved or whose status is no longer `enabled` (`:284-294`). The
disabled-but-still-present duplicate that predicate collapses is a real incident, not a hypothetical: a
second endpoint got created at the same URL with a brand-new signing secret, invalidating the configured
one (`ADR-084:38-40`).

The secret is the honest awkward part. Stripe reveals a signing secret only at creation time (`:239`), so
the minted value is written to a shared `IStripeWebhookSecretStore` the moment it exists (`:246`), and every
replica reads that store before it decides anything (`AdoptSharedSecretAsync` `:258-267`, the read at
`:260`, first called at `:143`), so a scaled-out or restarted replica adopts the live endpoint's secret
instead of minting its own (class documentation `:28-35`). Reading first is not enough when two replicas
boot together with nothing shared yet, because listing and then creating endpoints is check-then-act on
Stripe's state. So the reconcile runs under an `IDistributedLock` keyed on the expected URL (ADR-108, class
documentation `:37-45`, the lock at `:145-159`) and reads the store again once the lock is held
(`:161-164`), so the second replica adopts the first one's mint; a replica that cannot take the lock reads
the store once more and leaves Stripe alone (`:156`). The secret is also held in a volatile-backed singleton
(`StripeWebhookSecretProvider.cs:16-26`, assigned at `StripeWebhookRegistrationService.cs:247`), and
verification accepts a signature that is valid against **either** candidate secret: the runtime one first,
then the configured `Stripe:WebhookSecret` (`StripePaymentService.cs:299-305`). The remarks above it say
why (`:284-290`): after an operator rolls the secret in Stripe and updates configuration, the shared value
is stale while the configured one is current, and accepting a second secret this deployment already trusts
widens nothing. The secret itself is never written to a log or a console stream (class documentation
`StripeWebhookRegistrationService.cs:22-25`, comment `:244-245`): the `Critical` creation line names only
the endpoint id (`:249`, declared at `:393-394`), and an operator reveals that endpoint's secret in the
Stripe Dashboard to persist it in `Stripe:WebhookSecret`. ADR-084 files the automated minting as a
trade-off, not a feature (`ADR-084:274-283`), along with the fact that a configured secret is trusted and
never validated, because the provider will not re-reveal it (`ADR-084:299-303`).

## The backstop: a periodic sweep against the provider

Compensation answers "step two failed." It does not answer "step three never reported back." A webhook
that is never delivered, or that arrives and is rejected because the signing secret is stale, produces no
event to compensate, so no handler ever runs.

`PaymentReconciliationService` (`PaymentReconciliationService.cs:83-89`) is that backstop, registered as a
hosted service by the Sales module's infrastructure (`DependencyInjection.cs:54`). Backstop is the exact
word the class documentation uses, and it is careful about it (`:53-64`): every order arms its own
`Sales.ExpireUnpaidOrder` deadline at checkout and re-arms it whenever a payment attempt fails, so the
scheduled row is the primary path for an unpaid order and the sweep covers what a scheduled row cannot, a
deadline that was never written, one dead-lettered by the internal-command processor, and every order
created before the deadline existed. Both paths converge on the same transition and the same
`OrderCancelled` compensation, so whichever arrives first wins and the other finds nothing to do.

Its loop shape is deliberate, and it is deliberately not its own. The sweep derives from the framework's
`PeriodicBackgroundService` (`PaymentReconciliationService.cs:89`), whose `ExecuteAsync` owns the
enablement gate, the 15-second startup delay that lets the host finish initializing, the per-cycle
`try`/`catch` that logs and never kills the loop, and every wait through `TimeProvider` so the cycle is
testable without real time (`PeriodicBackgroundService.cs:53-97`: gate `:55-59`, delay `:31` awaited at
`:63`, per-cycle catch `:82-86` through the overridable `LogCycleFailure` `:45-46`, waits `:63,90`).

The sweep overrides exactly three members: `Interval`, read from configuration
(`PaymentReconciliationService.cs:96`); `IsEnabled`, which refuses to run when the toggle is off and logs
that specific reason, because the base logs only a generic "disabled" line (`:104-116`, remarks `:99-103`);
and `ExecuteCycleAsync` (`:119-120`), which delegates to an internally visible `ReconcileOnceAsync` so one
cycle is testable without the timer. It is the base class's only subclass outside MMCA.Common. Inside the
framework the same base carries four of Common's own periodic jobs (outbox cleanup, internal-command
cleanup, refresh-session cleanup and the permission-grant refresh, `ADR-054:240-245`), plus the test double
in the base class's own unit tests (`PeriodicBackgroundServiceTests.cs:104`).

One cycle (`ReconcileOnceAsync`, `PaymentReconciliationService.cs:129`) computes a window cutoff (`:133`) and
a hold-ceiling cutoff (`:136`) and runs two passes against them, expiry first (`:142`) and Stripe
reconciliation second (`:143`). The comment above the calls explains why the order does not shorten anyone's
window (`:138-141`): reconciliation can move an order into `PaymentFailed`, but that transition restarts
`PaymentWindowStartedOn` at the current time, so the expiry cutoff cannot match it in the same cycle
whichever pass runs first, and every order gets its full window from its last payment transition.

**Pass one expires the orders that never reached the provider at all.**
`ExpireStrandedUnpaidOrdersAsync` (`:218-249`) takes `PendingPayment` or `PaymentFailed` orders whose window,
measured from `PaymentWindowStartedOn ?? LastModifiedOn ?? CreatedOn`, began before the cutoff, or that were
created before the hold-ceiling cutoff (`:225-226`), and makes no provider call, because there is nothing to
call about: a `PendingPayment` order has no session id (remarks `:203-213`). Checkout has already committed
that stock, so an order nobody ever pays holds inventory nothing else can release. Each one is driven to
`Cancelled` through the same `MarkAsCancelled` guarded transition, with
`OrderCancellationReason.PaymentExpired` (`ExpireOrderAsync` `:277`, the call at `:299`), which is the
point: `Cancelled` is the one terminal state the `OrderCancelled` compensation already listens on, so the
release runs exactly once per order however many times a sweep, a webhook or an outbox redelivery revisit
it. `PaymentFailed` is deliberately **not** the release state, because it is explicitly retryable
(`:43-52`): releasing stock the moment an order enters it would hand back quantities the very next
checkout-session request expects to still be committed, and a later payment would oversell.

**A hold ceiling bounds every unpaid order.** Every failed payment hands the shopper a fresh window, so a
window alone could hold stock indefinitely. Both passes therefore also take any order older than
`UnpaidOrderExpiry:MaxHoldMinutes` measured from its creation (`MaxHold`, `:147`; class documentation
`:66-75`), 240 minutes at the shipped default (`appsettings.json:118`). A session the provider reports paid,
or one taken and still settling, is never cancelled by the ceiling (`:71-72`).

**Pass two asks Stripe about the orders that are waiting on a confirmation.**
`ReconcileStripeSessionsAsync` (`:158-196`) takes `PaymentInitiated` orders that have a session id and
either last changed before the cutoff or were created before the hold-ceiling cutoff (`:171-173`).

**Both passes bound the work in SQL, not in memory.** One shared helper, `QueryStrandedOrderIdsAsync`
(`:255-271`), takes each pass's predicate, orders oldest-first, takes the batch size and projects to ids,
all server-side (`:265-270`), over a dedicated filtered index `IX_Order_Status_Modified` on `(Status,
LastModifiedOn, CreatedOn)` (`OrderConfiguration.cs:161-163`); the expiry predicate's
`PaymentWindowStartedOn` is not part of that key. The comment above the reconciliation predicate explains
the rule (`PaymentReconciliationService.cs:164-169`): materializing every stuck order and taking the batch in
memory would make the batch size a Stripe-call budget rather than a query bound, and the exact failure this
sweep exists to handle (a prolonged webhook outage) is the one that strands a large backlog.

**It reloads each order in its own scope and re-checks.** `ReconcileOrderAsync` (`:323`) opens a scope per
order (`:325`) so one order's failure never poisons the batch, reloads the order tracked (`:330-334`), and
returns immediately if it is no longer `PaymentInitiated` (`:337-340`), because a webhook may have arrived
between the id query and now.

**It applies the same guarded transitions the webhook would have, and only on proof.** The session status
maps to four outcomes (`TryApplyTransition`, `:377-402`): a paid session to `MarkAsPaid` (`:383`), but only
when `PaymentProof.IsPaymentForOrder` accepts the paid amount and currency as payment of this order
(`IsProvenPayment`, `:419-439`); an order past the hold ceiling whose session is expired or still open to
`MarkAsCancelled(PaymentExpired)` (`:384`, `IsPastHoldAndUnpaid` `:409-412`); expired to
`MarkAsPaymentFailed` (`:385`); anything else to nothing at all, left for a later cycle (`:386`). A paid
session the proof refuses changes nothing and is logged at `Warning` with what an operator needs to
reconcile it by hand (`:431-437`). Those are the identical `Result`-returning methods called by the webhook
handler (`ProcessPaymentWebhookHandler.cs:119,182`) and by the client-initiated check
(`VerifyPaymentHandler.cs:71`). The sweep gets no private path into the aggregate, so it cannot reach a
state the webhook could not.

**And it loses races on purpose.** If a webhook transitions the order between the sweep's load and its save,
the save throws `DbUpdateConcurrencyException`, which is logged and skipped, not retried (`:355-365`, the
concurrency branch `:360-365`). The concurrent writer is authoritative; the next cycle sees the final state.

The whole thing is configuration-gated by `PaymentReconciliationSettings`
(`PaymentReconciliationSettings.cs:25-54`): `Enabled` defaults true (`:31`), a 10-minute poll interval
(`:35`), a 30-minute stuck age (`:49`), and a 50-order batch (`:53`), carried as those exact values in the
Sales service's `appsettings.json:120-125`, directly below the `UnpaidOrderExpiry` section that sets the
per-order deadline and the hold ceiling (`:115-119`). The settings documentation asks for the stuck age to
stay above normal webhook latency (`PaymentReconciliationSettings.cs:38-40`), so the sweep never races a
healthy delivery, and to equal `UnpaidOrderExpiry:Minutes` (`:19-22`), so the two mechanisms agree on one
window. The second is enforced, not just asked for: `PaymentReconciliationSettingsValidator` refuses to
start the host when the two differ (`PaymentReconciliationSettingsValidator.cs:33-37`, registered at
`MMCA.Store.Sales.API/SalesModule.cs:89-90`).

Both mechanisms are covered by tests that assert the behavior, not the wiring. Twenty cases cover the saga
handler in `OrderCancelledSagaHandlerTests.cs`, including a redelivered event that must not restore stock
twice (`:47`), the lookup that has to ignore the soft-delete filter (`:106`), the missing-inventory case that
must warn and still mark the order restored (`:133`), stock returned through the atomic increment
(`:161`), the increment and the marker committing in one transaction (`:218`), a failed increment failing
the transaction so the marker rolls back (`:247`), the non-tracking snapshot (`:267`), one scope per event
(`:442`), the marker saved before the stock moves (`:470`), and a non-cancelled order that rolls back without
throwing (`:493`). Twenty-four cover the sweep in `PaymentReconciliationServiceTests.cs`, including a session
paid for a different amount that leaves the order untouched (`:52`), the lost race (`:127`), one throwing
order that does not stop the rest (`:148`), the bound-the-query-not-the-list case (`:168`), the stale
`PendingPayment` order that is expired into `Cancelled` without Stripe ever being called (`:195`, `:213`),
and the hold-ceiling and window cases (`:303-456`). Eighteen pin the deadline handler in
`ExpireUnpaidOrderInternalCommandHandlerTests.cs`. The ingress contract has its own pair: three methods
pinning the controller's accept-versus-reject mapping in `PaymentsControllerTests.cs`, a `[Theory]` over the
accepted cases (`:38`), a `[Theory]` over the rejections including both shape-rejection codes (`:59`) and one
pinning the request-size bound (`:80`); and two `[Theory]` methods on the deletion predicate, one of them
the operator-created endpoint that must never be judged stale
(`StripeWebhookRegistrationServiceTests.cs:358,368`).

## Trade-offs, honestly

- **Adoption is one module, and the record says so.** This pattern lives in MMCA.Store's Sales module only:
  the two saga handlers, the deadline handler and the one reconciliation sweep above. MMCA.ADC and
  MMCA.Helpdesk have no compensating saga handler and no reconciliation sweep (`ADR-054:247-249`); the
  nearest things in ADC are two compensating steps, the session-asset and avatar upload handlers that each
  schedule the delete of an orphaned blob, which ADR-054 points to ADR-123 and ADR-045 for rather than
  counting as a saga (`ADR-054:249-263`). The record exists
  because the mechanism is the framework's stated answer to cross-boundary consistency, not because it is
  broadly adopted. Read this article as one worked implementation, not a fleet-wide convention.
- **A returned failure is abandoned, not retried.** An invariant rejection, a refused marker or a failed
  increment rolls the restoration back, logs a `Warning` and returns; the handler's empty `OnStepFailed`
  override keeps the event handled, so the outbox row is marked processed and no redelivery or sweep
  revisits the order (`OrderCancelledSagaHandler.cs:83-87,138-144,160-164,179-184`, `ADR-054:315-329`). The
  stock stays held against a cancelled order until someone acts on the log line. If that is not the
  outcome you want for a given failure, drop the override and the base throws for a redelivery
  (`ProcessDomainEventHandlerBase.cs:120-124`).
- **The process manager is the order, and only the cross-aggregate coordinator is deferred.** Choreography
  is correct for this workflow because `Order.Status` plus `Order.InventoryRestored` already *are* the saga
  state, and ADR-143 gives that state its framework shape opt-in, with no table, no migration and no
  configuration key (`143-process-manager-primitive.md:4-6,40-43`). **ADR-086** records that its deferral is resolved
  for a flow whose state fits one aggregate and stands only for workflow state that fits no aggregate
  (`ADR-086:21-26`). Its trigger for that coordinator is specific: a workflow with three or more steps across
  two or more services, state that does not fit one aggregate, and at least one per-instance deadline
  (`:137-142`). The technology for it is an open question rather than a pinned choice: ADR-086's Decision
  still sketches a MassTransit v8 saga state machine (`:89-90`), while MassTransit is banned from the
  framework, with the transports framework-owned (ADR-118, Amendment 2026-11-23, `118-message-transport-library-policy.md:494`).
  Even with a coordinator, the sweep stays underneath it for the external system that never replies
  (`ADR-086:114-119`, `:182-185`), and ADR-143 keeps the sweep beside the primitive for the same reason
  (`ProcessTimeoutHandlerBase.cs:21-23`).
- **Inconsistency is bounded, not eliminated.** Between the cancellation commit and the compensation
  commit, stock is held against a cancelled order. An unpaid order loses its stock at its own scheduled
  deadline; when that row is missing, the bound is the sweep's stuck age plus one poll interval instead, 30
  plus 10 minutes at the shipped defaults, and that is also the window an order waiting on a dropped webhook
  sits in `PaymentInitiated` with its stock held. An order that keeps failing payment, or whose session
  stays open, holds stock no longer than the hold ceiling plus one poll, 240 plus 10 minutes
  (`ADR-054:294-302`, `appsettings.json:118`). That window is the price of not having a distributed
  transaction, and it should be a number you choose, not one you discover.
- **Compensation is best-effort per line, and names what it could not restore.**
  `RestoreInventory` cannot restore an order line whose `InventoryItem` row is missing, so it collects
  those variant ids and returns them instead of skipping quietly
  (`InventoryRestorationDomainService.cs:33-38`), and the handler logs them as a warning naming the order
  and the variants (`OrderCancelledSagaHandler.cs:146-152`). The marker still commits, that quantity is never
  restored, and nothing retries it. The comment above the marker says why (`:154-158`): the increases and the
  marker commit in one transaction, so withholding the marker would re-apply every **matched** increase on
  the next redelivery, and because the lookup already ignores the soft-delete filter, an unmatched variant
  means the row never existed at all. The warning is the record, not a repair, and ADR-054's own trade-off
  bullet states it the same way (`ADR-054:303-314`).
- **Redelivery re-runs every handler of the event, not the failed one.** The dispatcher iterates handlers
  sequentially with no per-handler isolation (`DomainEventDispatcher.cs:76-85`), so one throwing handler also
  skips the handlers after it, and a redelivery re-runs the ones that already succeeded. The mark-processed
  step covers the save's whole local batch (`DomainEventSaveChangesInterceptor.cs:370-402`), so what comes
  back is every event that save raised, not just the failed one. Every handler on a shared event must be
  idempotent or must keep its failure to itself.
- **The sweep is not replica-leased.** The outbox processor claims rows with a lease before working them
  (ADR-003); the sweep takes no such claim, so at the configured `maxReplicas: 2` (`main.bicep:2487`) two
  replicas can pick the same stuck order and each spend a Stripe status call. Correctness holds through the
  concurrency token; the duplicated external call does not deduplicate.
- **The webhook ingress trades visibility for endpoint survival.** A post-acceptance failure returns 200,
  so it is invisible in Stripe's delivery view and has to surface through our own `Warning` log
  (`PaymentsController.cs:115`) or through the sweep above. The endpoint is also anonymous,
  internet-reachable and exempt from both gateway rate limiters, with signature verification as its only
  authentication, so a hostile caller can generate `Critical` log volume one rejected request at a time
  (`ADR-084:311-323`).
- **Every compensating action needs its own marker.** There is no generic mechanism here. A second
  compensating action means a second persisted marker or a naturally idempotent operation, decided by the
  author of that handler.

## Apply this even without MMCA

The mechanism ports to any stack that has events, a database, and an external dependency:

1. **Put the compensating action in its own handler**, triggered by the event the first step raised, not in
   an `else` branch of the command. It commits after the originating transaction, in its own scope, which is
   what makes it compensation instead of an impossible rollback. The exception is worth naming: a check that
   must happen *before* the commit, like asking whether the money already moved, cannot be a post-commit
   handler at all, and belongs in the command where it can still refuse.
2. **Make idempotency a persisted marker that commits with the writes it guards.** One transaction, one
   database. A flag written after the work is a narrower version of the same bug; a flag written with the
   work is an invariant. Guard the marker in the aggregate so a second call is a typed failure, not a silent
   overwrite. If other writers touch the same rows concurrently, move the quantities with a relative update
   inside that transaction rather than a load-edit-save.
3. **Add an optimistic-concurrency token** so two simultaneous deliveries cannot both pass the marker check
   and both commit. The marker handles sequential re-runs, the token handles concurrent ones. You need both.
   Write the marker before the side effects, so the loser fails before it has done anything.
4. **Let your delivery layer own retry, and know which of your failures reach it.** If your event transport
   already retries with backoff and dead-letters, throw and let it re-run you. A failure you log and return
   is a failure nothing retries, so decide explicitly, per failure, whether it should force a redelivery
   (throw), be kept local with its own durable home rather than a `catch` that logs, or be abandoned with a
   log line as the record, and write the third choice down. A shared base class that throws on a failed
   step unless the handler opts out makes the honest option the default one. Then check what your delivery
   layer actually redelivers: if it acknowledges a batch in one step, one thrown exception brings the whole
   batch back, not just your event.
5. **When the workflow's state already lives on one aggregate, make that aggregate the process.** Give it the
   timeout decision, measure each window from a stored instant, and carry each timeout as a durable deferred
   command, so a stale or re-armed timeout is a no-op by construction. Reach for a separate coordinator only
   when the state genuinely fits no aggregate.
6. **Decide what your inbound webhook's status code means, and write it down.** A third-party caller reads
   it as a delivery instruction ("retry me" or "stop"), not as an application result, and providers
   disable endpoints that keep failing. Return the error code only for the failures where nothing was
   verified and a retry could still fix it (bad signature, missing signature, empty body, unparseable body,
   missing secret), accept everything else and surface the failure through your own telemetry, and log a
   rejection at a level your production log floor actually emits. Cap the body you read before you have
   authenticated it.
7. **Back every externally-confirmed step with a periodic reconciliation sweep**, because a confirmation
   that never arrives produces no event to compensate. Bound the query in the database, reload and re-check
   each item in its own scope, drive the **same** guarded transitions the primary path uses, cap how long
   anything may stay unresolved, and let it lose races to the primary path rather than fighting them. Keep
   it even once per-instance deadlines exist: it is what catches the deadline that was never written.

The rule of thumb: **any step you cannot roll back needs an explicit undo, and any step you cannot confirm
needs an explicit timeout. Write both down as code, or your consistency story is hope with extra steps.**

---

**What we covered:** why a cross-boundary workflow has no transaction to roll it back, how MMCA.Store puts
compensation in its own domain-event handler running in its own DI scope (and which single check has to stay
in the command instead), how the ADR-143 process-manager primitive makes the order itself the process, with
one scope and one transaction per step and its payment deadline as a timeout the aggregate decides, how the
`Order.InventoryRestored` marker committed in the same transaction as the atomic inventory increments turns
idempotency into a database invariant (and why that is stronger than a record-after-success inbox), how the
`RowVersion` token serializes concurrent redeliveries, why only a thrown failure gets a redelivery and what an
opted-out failure costs, why the inbound webhook's status code encodes acceptance rather than success and
registers its own endpoint (ADR-084), and how `PaymentReconciliationService` backs the payment flow with a
two-pass sweep, capped by a hold ceiling, that expires stranded unpaid orders and asks Stripe for
authoritative status on the rest.

**Next in the series:** Article 50, "The LLM is a dependency: a bounded, guarded, metered boundary for chat
completions."

*MMCA.Common is open source. Star the repo, read the 2-minute ADR-054 behind this pattern, or
`dotnet add package MMCA.Common.API` and build the monolith you can extract later.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- This pattern's decision records: `Website/docs-src/adr/054-saga-compensation-and-reconciliation.md`,
  `Website/docs-src/adr/084-stripe-webhook-ingress.md` and
  `Website/docs-src/adr/143-process-manager-primitive.md`
- The full 34-category scorecard, §6 and §29 included, lives in
  `Website/docs-src/governance/common-ArchitectureScorecard.md` in the docs site.

*Previous: Article 48, "Observability by Default: OpenTelemetry and Azure Monitor in MMCA." Next: Article 50,
"The LLM is a dependency: a bounded, guarded, metered boundary for chat completions."*

*Tags: .NET, C Sharp, Distributed Systems, Microservices, Software Architecture*

*Notes: 2026-11-25 refresh, re-verified 2026-11-25 against MMCA.Common v1.319.0 (`MMCA.Common/FACTS.md:14`;
30 packages, `FACTS.md:20`; 147 ADRs, range 001-147, `Website/docs-src/adr/README.md:6`), audit verdict
Needs-structural-change. Structural changes this run: a new section on the ADR-143 process-manager primitive
(`ProcessManagerAggregateRoot.cs:17`, `ProcessDomainEventHandlerBase.cs:31-35`, `ProcessTimeoutHandlerBase.cs:36-43`,
Store adopter `ExpireUnpaidOrderInternalCommandHandler.cs:40-53`, `Order.cs:48,55,70,1118`) with ADR-143 added to the
header; the compensation handler is described as a `ProcessDomainEventHandlerBase` step whose failed `Result` reaches an
empty `OnStepFailed` override (`OrderCancelledSagaHandler.cs:49-52,83-87`) against a throwing default
(`ProcessDomainEventHandlerBase.cs:73-76,120-124`), replacing the discarded-`Result` account; the code block is rebuilt;
the ADR-086 trade-off bullet says the deferral is resolved for single-aggregate state (`ADR-086:21-26`) and no longer names
a pinned MassTransit v8 coordinator; the sweep paragraphs add the hold ceiling (`PaymentReconciliationService.cs:66-75,136,147`,
`appsettings.json:118`), the four-outcome transition (`:377-412`), the toggle-only `IsEnabled` (`:99-116`) and the
order-independent pass comment (`:138-141`); the webhook registration subscribes six events (`StripeWebhookRegistrationService.cs:78-91`)
and keeps only the `WebhookBaseUrl` skip (`:102-106`); test counts are 20 / 24 / 3 / 2 plus 18 deadline-handler tests.
Earlier entries (2026-10-29, 2026-10-22, 2026-10-08, 2026-10-02) are in git history.*
- *Read this run (apply pass): `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/Saga/OrderCancelledSagaHandler.cs`
  in full (class doc `:12-48`, declaration `:49-52`, `Includes` `:55`, `OnStepFailed` `:79-87`, `HandleStepAsync` `:97-189`,
  marker check `:113-117`, `asTracking: false` `:127` with comment `:125-126`, `ignoreQueryFilters` `:132` with comment `:128-131`,
  `RestoreInventory` `:137`, returns `:138-144`, `:160-164`, `:179-184`, unmatched log `:146-152`, mark-anyway comment `:154-158`,
  marker `:159`, marker-first comment `:166-167`, save `:168`, increments `:170-185`, `Warning` messages `:200-207`).
  `MMCA.Common/Source/Core/MMCA.Common.Application/ProcessManagers/ProcessDomainEventHandlerBase.cs` in full;
  `ProcessTimeoutHandlerBase.cs` in full; `MMCA.Common/Source/Core/MMCA.Common.Domain/ProcessManagers/ProcessManagerAggregateRoot.cs`
  in full; `.../Orders/InternalCommands/ExpireUnpaidOrderInternalCommandHandler.cs` in full;
  `Website/docs-src/adr/143-process-manager-primitive.md:1-140`; `Website/docs-src/adr/086-process-manager-deferred.md:1-30`
  plus its section headings (`:89-90`, `:117`, `:121`, `:137`).*
- *`PaymentReconciliationService.cs` read `:40-239` and `:250-441`: class doc `:43-52`, `:53-64`, hold ceiling `:66-75`;
  declaration `:83-89`; `Interval` `:96`; `IsEnabled` `:104-116` (remarks `:99-103`); `ExecuteCycleAsync` `:119-120`;
  `ReconcileOnceAsync` `:129` (cutoff `:133`, hold cutoff `:136`, comment `:138-141`, passes `:142-143`); `MaxHold` `:147`;
  `ReconcileStripeSessionsAsync` `:158-196` (rationale `:164-169`, predicate `:171-173`); `ExpireStrandedUnpaidOrdersAsync`
  `:218-249` (remarks `:203-213`, predicate `:225-226`); `QueryStrandedOrderIdsAsync` `:255-271` (`:265-270`);
  `ExpireOrderAsync` `:277` (call `:299`); `ReconcileOrderAsync` `:323` (scope `:325`, reload `:330-334`, re-check `:337-340`,
  save/catch `:355-365`, concurrency `:360-365`); `TryApplyTransition` `:377-402`; `IsPastHoldAndUnpaid` `:409-412`;
  `IsProvenPayment` `:419-439` (`:431-437`).*
- *Grepped this run: `Order.cs` (`:48`, `:55`, `:70`, `InventoryRestored` `:233`, `MarkAsCancelled` `:1049`, event `:1057`,
  `MarkInventoryRestored` `:1069`, `DecideTimeout` `:1118`); `CheckOutHandler.cs:206,207,213`; `PlacedOrderFinalizer.cs:36,51,71`;
  `GuestCheckOutHandler.cs:120,123`; `OrderPaymentFailedSagaHandler.cs:23,32,36,48,69,87`; Sales `DependencyInjection.cs:51,54`;
  `ProcessPaymentWebhookHandler.cs:119,182`; `PaymentReconciliationSettings.cs:31,35,49,53`; `SalesModule.cs:90`;
  `OrderConfiguration.cs:163`; `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/appsettings.json:115-118,120-124`;
  `StripeWebhookRegistrationService.cs:76-107` read; test attributes in `OrderCancelledSagaHandlerTests.cs` (20),
  `PaymentReconciliationServiceTests.cs` (24, `:36-456`), `PaymentsControllerTests.cs:38,59,80`,
  `StripeWebhookRegistrationServiceTests.cs:358,368`, `ExpireUnpaidOrderInternalCommandHandlerTests.cs` (18);
  ADR-054 headings and `:273-276` region, Revisions 2026-11-12 `:575` and 2026-11-23 `:633`; ADR-118 Amendment `:494`.*
- *Unchanged anchors carried from the 2026-11-25 audit, which confirmed them: `CancelOrderHandler.cs` (`:17-25`, `:27-31`,
  `:39`, `:46`, `:49-59`, `:60-81`, `:104-140`, `:143-144`), `OrderCancelled.cs:13-17`, `InventoryRestorationDomainService.cs`
  (`:8`, `:10`, `:24-51`, `:33-38`, `:41-50`), `PaymentsController.cs` (`:31-126`), `DomainEventDispatcher.cs:76-85`,
  `SafeDomainEventHandler.cs` (`:13-46`, `:61-70`) and its tests (`:33,51,73`, double `:124`),
  `DependencyInjection.ModuleScanning.cs:46,51,56`, `PeriodicBackgroundServiceTests.cs:104`, the rubric rows
  (`ArchitectureEvaluationCriteria.md:229-245,775-795`) and Group G04.*
- *Flag (2026-11-25): these anchor moves are taken from the 2026-11-25 audit's read and were not re-read by the apply pass
  (behavior claims unchanged): `DomainEventSaveChangesInterceptor.cs:370,374-380,384,390-402,419-434`;
  `OutboxProcessor.cs:250,496,830`; `DbContextFactory.cs:642-649,674-682`; `AuditableBaseEntity.cs:55`;
  `ApplicationDbContext.cs:556,737-757`; `PeriodicBackgroundService.cs:53-97,82-86,90`; `StripeWebhookRegistrationService.cs`
  `:143,145-159,156,161-164,239,244-247,249,258-267,260,284-294,393-394`; `StripePaymentService.cs:284-290,299-305`;
  `StripeWebhookSecretProvider.cs:16-26`; `Order.cs:227-232,1071-1078,1080-1087`; `CheckOutHandler.cs:150-216,209-212`;
  `OrderPaymentFailedSagaHandler.cs:12-22,35-37,39-46,83-90,92-96`; `PaymentReconciliationSettings.cs:19-22,25-54,38-40`;
  `ADR-054:59-63,240-245,247-263,294-302,303-314,315-329`; `ADR-084:38-40,252-264,299-303,311-323`;
  `ADR-086:114-119,137-142,182-185`; the per-test descriptions behind the cited test lines; and
  `MMCA.Store/infra/main.bicep:2487` (`salesApp` declared `:2319`).*
- *Flag (2026-11-25): ADR-086 still states the MassTransit v8 pin as current (Status `:15-18`, Decision `:121-135`, Revision
  2026-11-23 `:454`), which contradicts ADR-118's Amendment (2026-11-23) at `:494` and MMCA.Common's MassTransit ban; the
  article follows the ban and calls the coordinator's technology open. Also, `ADR-054:343` cites `main.bicep:2311`, which the
  audit found inside `catalogApp`; the article does not re-anchor from the ADR.*
- *Code block: condensed from `ProcessDomainEventHandlerBase.cs:41-78` and `OrderCancelledSagaHandler.cs:55,83-87,97-189`
  (argument guards and logging trimmed except the unmatched-variant warning, the step's `process` parameter renamed `order`
  and the repository locals inlined, comments shortened; control flow and every API call faithful, not byte-for-byte).*
- *Verifier fixes (2026-11-25): the missing-secret claim is narrowed to an empty key (`StripeSettings.cs:24-25`,
  `SalesModule.cs:53-56`) and notes that the committed `SET-VIA-USER-SECRETS` placeholder passes (`ADR-084:258-264`);
  the minted-secret trade-off anchor moves to `ADR-084:274-283`; the ADR-143 wording follows its Status line, "no
  table, no migration and no configuration key" (`143-process-manager-primitive.md:4-6`); the payment-failed re-arm
  names its `UnpaidOrderExpiry:Enabled` gate (`OrderPaymentFailedSagaHandler.cs:75-78`, default `true` at Sales
  `appsettings.json:116`).*

- Full series index: https://ivanball.github.io/writing.html
