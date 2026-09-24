# Undo Is a Feature: Saga Compensation and the Reconciliation Backstop

> Series: MMCA.Common · Article #49 (deep-dive) · Pillar P2/P3 · Group G04 · Rubric §6,§29 · ADR-054, ADR-084, ADR-086 ·
> Status: grounded in `Website/docs-src/adr/054-saga-compensation-and-reconciliation.md`,
> `Website/docs-src/adr/084-stripe-webhook-ingress.md`,
> `Website/docs-src/adr/086-process-manager-deferred.md`,
> `MMCA.Store/.../Sales.Application/Orders/Saga/OrderCancelledSagaHandler.cs`,
> `.../Orders/Saga/OrderPaymentFailedSagaHandler.cs`, `.../Orders/UseCases/Cancel/CancelOrderHandler.cs`,
> `.../Sales.Domain/Orders/Order.cs`, `.../Sales.Domain/Inventory/InventoryRestorationDomainService.cs`,
> `.../Sales.API/Controllers/PaymentsController.cs`,
> `.../Sales.Infrastructure/Payments/Stripe/StripeWebhookRegistrationService.cs`,
> `.../Sales.Infrastructure/Payments/Reconciliation/PaymentReconciliationService.cs`,
> `.../Sales.Infrastructure/Payments/Reconciliation/PaymentReconciliationSettings.cs`,
> `MMCA.Common/.../Application/Services/DomainEventDispatcher.cs`,
> `MMCA.Common/.../Application/DomainEvents/SafeDomainEventHandler.cs`,
> `MMCA.Common/.../Infrastructure/Scheduling/PeriodicBackgroundService.cs`, the four test suites that cover
> them, and the §6/§29 rows of `Website/docs-src/governance/ArchitectureEvaluationCriteria.md`. No em dashes.

**Subtitle:** A cancelled order has to give back stock that a transaction closed minutes ago already took,
and a payment confirmation that never arrives strands the order forever. Here is compensation as its own
event handler, idempotency as a persisted marker committed by the same `SaveChanges` as the writes it
guards, and a periodic sweep as the saga-timeout backstop.

---

Checkout is the easy part. In MMCA.Store's Sales module it is genuinely atomic: the order insert, the cart
transition, and the conditional stock decrements all commit inside one explicit local transaction
(`CheckOutHandler.cs:135-188`, insert `:165`, save `:176`), and a failed decrement returns a failed `Result`
that rolls the whole thing back. One database, one transaction, no drama. Checkout then arms the order's
own unpaid-payment deadline as a scheduled row and saves that separately (`:226`, second save `:240`,
because the transaction helper commits without flushing what comes after it, `:238-239`).

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
as a **cost it accepts**, without saying how that cost gets paid (`ADR-054:41-46`). None of them says what a
multi-step workflow does when step two fails or step three never reports back.

## The MMCA answer: compensation is a handler, not a branch in the command

The command handler does one thing, and it does not even own the plumbing for that.
`CancelOrderHandler` derives from `MutateEntityHandlerBase<CancelOrderCommand, Order, OrderIdentifierType>`
(`CancelOrderHandler.cs:27-31`), so the load, the rowversion stamp and the save belong to the base class. The
handler contributes three overrides: the id to load (`:39`), the client's last-seen rowversion so a
stale-view cancellation fails with a conflict (ADR-035, `:46`), and the mutation itself (`:55-67`). It does
not touch inventory, and its own remarks say so (`:49-54`).

The mutation is two steps: retire the payment provider's live checkout session, then call the guarded
transition `entity.MarkAsCancelled()` (`:60-66`). That first step is the one compensating action that is
deliberately inline rather than in a saga handler, and the class documentation argues the case (`:17-25`):
an order can only be cancelled out of `PaymentInitiated` while the provider still serves a payable hosted
page, so the cancel has to answer "has this already been paid?" **before** it commits. A saga step runs
after the commit and could only ever discover the money afterwards, with the order already `Cancelled` and a
manual refund the only remedy left. So `RetirePaymentSessionAsync` (`:90-124`) asks the provider for the
session status and, when it reports paid, **refuses the cancellation** with
`OrderCancellationErrorCodes.PaymentAlreadyCompleted` (`:101-109`). Every other outcome (already expired,
session gone, provider unreachable) is non-fatal: it is logged and the cancellation proceeds (`:111-121`).

`Order.MarkAsCancelled()` (`Order.cs:548`) asks the current state object whether the transition is legal
and, on success, records a domain event (`Order.cs:556`). `OrderCancelled` is a plain `BaseDomainEvent`
(`OrderCancelled.cs:6-9`), not an integration event, so it dispatches in-process after the save.

Restoring the stock is a separate class: `OrderCancelledSagaHandler : IDomainEventHandler<OrderCancelled>`
(`OrderCancelledSagaHandler.cs:30-33`). Notifying the customer of a failed payment is another one,
`OrderPaymentFailedSagaHandler` (`OrderPaymentFailedSagaHandler.cs:22-24`). This is the choreographed
shape: each step raises an event, and each follow-up or compensating action lives in its own handler. A new
compensating action that can run after the commit (a refund, another notification) is a new handler, not an
edit to the command.

**Each handler runs in its own DI scope.** Domain-event handlers are registered as singletons by the
framework's convention scan (`MMCA.Common.Application/DependencyInjection.cs:187-197`, with the comment
"Domain event handlers are singletons, they create their own DI scopes internally" at `:192` and
`WithSingletonLifetime()` closing the scan at `:197`), so every handler opens a scope through
`IServiceScopeFactory` and resolves what it needs from that scope (`OrderCancelledSagaHandler.cs:40-41`,
`OrderPaymentFailedSagaHandler.cs:31-32`). The consequence is the important part: compensation commits **on
its own, after** the originating save, rather than joining the transaction it is compensating for. That is
what makes it compensation rather than a rollback.

## The marker: idempotency as a database invariant

Here is the part worth stealing even if you never touch this framework.

At-least-once delivery means the compensating handler will eventually run twice. If restoring stock is not
idempotent, the second run inflates inventory, and you have turned a reliability mechanism into a data-corruption
mechanism.

MMCA.Store makes it idempotent with a persisted marker on the aggregate. `Order.InventoryRestored`
(`Order.cs:122`, documented `:116-121`) is a boolean with a private setter, and `MarkInventoryRestored()`
(`Order.cs:568-591`) is a guarded transition like any other: it refuses on a non-cancelled order
(`:570-577`) and refuses a second call (`:579-586`), both as `Result.Failure` with named invariant codes.

The handler then does four things in order (`OrderCancelledSagaHandler.cs:36-103`):

1. Loads the order with its lines, tracked, in its own scope (`:44-48`).
2. Checks the marker first and returns without saving if it is already set (`:57-61`).
3. Loads the matching inventory rows **with the soft-delete filter deliberately turned off**
   (`ignoreQueryFilters: true`, `:74`), then applies the increases through a pure domain service with no
   infrastructure dependencies, `InventoryRestorationDomainService.RestoreInventory` (`:79`, service at
   `InventoryRestorationDomainService.cs:13-33`, "pure domain service" comment `:8`), which hands back the
   variant ids it could not match (`:21-27`, returned at `:32`) so the handler can log them by name
   (`:80-86`).
4. Sets the marker (`:93`) and calls **one** `SaveChangesAsync` (`:101`).

That last step is the whole design. The inventory increases and the marker are written by the same
`SaveChanges` against the same database, in one transaction. So the marker cannot exist without the writes
it guards, and the writes cannot land unmarked. Idempotency stops being handler discipline and becomes a
database invariant.

Step 3's filter override is a smaller decision with a real consequence. A retired variant is
soft-deleted, not removed, and the stock a cancelled order is returning still belongs to that row: without
`ignoreQueryFilters`, the row is invisible to the handler and the returned quantity is silently dropped
(the comment saying so is at `:70-73`).

This is why ADR-054 says the marker is **strictly stronger than the ADR-021 inbox** (`ADR-054:186-189`).
The inbox records a message id after the handlers have succeeded, which leaves a narrow crash window
between the handler's commit and the inbox write. A marker committed *with* the writes has no such window.
The two are complementary rather than competing: the inbox dedups broker redeliveries between services, the
aggregate marker dedups in-process handler re-runs.

**Concurrent redeliveries are handled by a different mechanism.** The marker check is a read, so two
deliveries can both pass it. Every auditable entity carries a `RowVersion` concurrency token
(`AuditableBaseEntity.cs:53`), configured automatically on every non-owned auditable type by
`ConfigureConcurrencyTokens` (`ApplicationDbContext.cs:582-602`, called from `OnModelCreating` at `:415`,
ADR-035). Both deliveries carry the same original token into their update: one commits, the other gets
`DbUpdateConcurrencyException`, and its outbox retry then finds the committed marker and skips. Sequential
redelivery is handled by the marker, concurrent redelivery by the token.

```csharp
// Condensed from OrderCancelledSagaHandler.HandleAsync (most logging trimmed).
public async Task HandleAsync(OrderCancelled domainEvent, CancellationToken cancellationToken = default)
{
    using var scope = serviceScopeFactory.CreateScope();
    var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();

    var orderRepository = unitOfWork.GetRepository<Order, OrderIdentifierType>();
    var order = await orderRepository.GetByIdAsync(
        domainEvent.OrderId, includes: [nameof(Order.OrderLines)], asTracking: true,
        cancellationToken: cancellationToken);
    if (order is null)
        return;

    // Idempotency guard: a redelivered OrderCancelled event (outbox is at-least-once)
    // must not restore the same stock twice.
    if (order.InventoryRestored)
        return;

    var inventoryRepo = unitOfWork.GetRepository<InventoryItem, ProductVariantIdentifierType>();
    var variantIds = order.OrderLines.Select(ol => ol.ProductVariantId).Distinct().ToArray();
    var allItems = await inventoryRepo.GetAllAsync(
        includes: [], where: i => variantIds.Contains(i.Id), asTracking: true,
        // A soft-deleted inventory row is still the row this stock belongs to.
        ignoreQueryFilters: true,
        cancellationToken: cancellationToken).ConfigureAwait(false);

    var restoreResult = inventoryRestorationDomainService.RestoreInventory(
        order.OrderLines, allItems.ToDictionary(i => i.Id));
    if (restoreResult.Value is { Count: > 0 } unmatchedVariantIds)
        LogInventoryItemsNotFound(logger, domainEvent.OrderId, string.Join(", ", unmatchedVariantIds));

    // The marker is set even when some variants had no inventory record: withholding it would
    // re-apply every MATCHED increase on the next redelivery. The warning is the record.
    var markResult = order.MarkInventoryRestored();
    if (markResult.IsFailure)
        return;

    // ONE save: the restoration and the idempotency marker commit atomically (same DB).
    await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
}
```

## Redelivery is the retry mechanism, so throwing is correct

A compensating handler needs no retry loop of its own, because it already sits on one.

When in-process dispatch fails, the domain-event interceptor logs the failure and signals the outbox rather
than swallowing the work. `FlushStateAsync` (`DomainEventSaveChangesInterceptor.cs:332`) dispatches the
save's local events (`:336-337`) and only then marks their outbox entries processed (`:341`), so a throwing
handler never reaches the mark, and the catch below it logs and signals the processor (`:346-354`). The
`OutboxProcessor` re-dispatches the pure domain event on a later cycle
(`OutboxProcessor.DispatchMessagesAsync`, `OutboxProcessor.cs:585`, the dispatcher call at `:639`) with the
bounded retries, backoff, and dead-lettering ADR-003 already defines. So a handler that cannot complete its
work should fail loudly and let redelivery re-run it. Inventing local retries would just duplicate a policy
that already exists one layer down.

The framework takes that same position in its own base class.
`SafeDomainEventHandler<TDomainEvent>` (`SafeDomainEventHandler.cs:32`) runs your `HandleSafelyAsync`
inside an exception filter, `LogAndRethrow` (`:61-70`), which writes one error line naming the handler and
the event type and then returns `false`, so the exception keeps travelling with its original stack intact
(`:42-46`). A cancellation during host shutdown passes straight through unlogged, because that is not a
delivery failure (`:42`). The class documentation records why rethrowing is required (`:13-20`): a
handler that reports success has its outbox row marked processed, so nothing retries and the side
effect is lost with only a log line to show for it. The base class is not a way to absorb a failure. It is
a way to fail with context, and its tests assert exactly that, including that the log lands before the
caller sees the exception (`SafeDomainEventHandlerTests.cs:33,51,73`).

The documentation also names the consequence to design for (`:21-29`). The interceptor dispatches every
local event of one save in a single call, so one rethrowing handler skips the mark-processed step for the
**whole** local batch: every event that save raised comes back, not only the one whose handler failed. A
subclass has to be idempotent about its own event and about its siblings.

The mirror case is the handler whose work is a pure side effect, where a redelivery would be worse than a
loss. `OrderPaymentFailedSagaHandler` refuses one without catching anything: it makes the side effect
durable instead. In its own scope (`:31-32`) it schedules a `SendOrderPaymentFailedEmailInternalCommand`
through `IInternalCommandScheduler` (`:34-36`), branches on the returned `Result` (an `Error`-level line
naming the order and customer when scheduling fails, an `Information` line when it succeeds, `:38-45`), and
then re-arms the order's payment deadline so a failed attempt hands the customer the whole retry window
again (`:47`, `RearmExpiryDeadlineAsync` `:67-93`, itself logging rather than throwing on failure,
`:86-90`). The class documentation states the rule that makes both branches correct (`:11-21`): the order is
already persisted as `PaymentFailed` before this handler runs, so a scheduling failure is logged rather than
thrown, and an SMTP outage retries the message off the queue instead of dragging the whole local batch back
through the pipeline. It implements `IDomainEventHandler<OrderPaymentFailed>` directly (`:22-24`), and no
production handler in the four repos derives from `SafeDomainEventHandler`, its only subclass being the test
double in that base class's own unit tests (`SafeDomainEventHandlerTests.cs:124`). The durable queue that
carries that scheduled row, its retries and its dead-letter path are the subject of Article 51, "Four ways
to do work later: channels, cron and durable internal commands", so they are not re-taught here.

The choice is therefore explicit per handler: **throw to get a redelivery, or take the work somewhere that
survives on its own.** What you cannot do is neither.

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
`BackgroundService` (`:35-40`) registered by the Sales module in the same method that registers the
reconciliation sweep below (`Sales.Infrastructure/DependencyInjection.cs:39`, sweep at `:42`). It skips
entirely when no `WebhookBaseUrl` is set, which is the local path where the Stripe CLI forwards instead, and
warns and skips with no `SecretKey` (`:63-73`); it subscribes exactly three event types (`:51-56`); and it
stamps every endpoint it creates with the description prefix `Auto-registered by MMCA` (`:49`). That prefix
is the whole reason an automated delete is acceptable: `IsStaleAutoRegistered` returns `false` for any
endpoint lacking it, so an operator-created endpoint is never touched, and `true` only for one of its own
whose URL has moved or whose status is no longer `enabled` (`:210-220`). The disabled-but-still-present
duplicate that predicate
collapses is a real incident, not a hypothetical: a second endpoint got created at the same URL with a
brand-new signing secret, invalidating the configured one (`ADR-084:30-33`).

The secret is the honest ugly part. Stripe reveals a signing secret only at creation time (`:180`), so the
minted value goes two places at once. It is written to a shared `IStripeWebhookSecretStore` the moment it
exists (`:186`), and that store is read first, before the Stripe client is even built (`:100-105`), which is
what makes every replica converge on one secret instead of each minting its own. It is also held in a
volatile-backed singleton (`StripeWebhookSecretProvider.cs:17-27`) that the payment service prefers over
configuration on every incoming event (`StripePaymentService.cs:362`), announced at `Critical`
(`StripeWebhookRegistrationService.cs:189,292-293`), and written to stderr for an operator to copy into
`Stripe:WebhookSecret` (`:190-192`). That is live credential material in the log pipeline, on purpose: the
alternative is a first boot where the endpoint exists and every single delivery is rejected. ADR-084 files
it as a trade-off, not a feature, along with the fact that a configured secret is trusted and never
validated, because the provider will not re-reveal it (`ADR-084:174-177`).

## The backstop: a periodic sweep against the provider

Compensation answers "step two failed." It does not answer "step three never reported back." A webhook
that is never delivered, or that arrives and is rejected because the signing secret is stale, produces no
event to compensate, so no handler ever runs.

`PaymentReconciliationService` (`PaymentReconciliationService.cs:68-74`) is that backstop, registered as a
hosted service by the Sales module's infrastructure (`DependencyInjection.cs:42`). Backstop is the exact
word the class documentation uses, and it is careful about it (`:50-60`): every order arms its own
`Sales.ExpireUnpaidOrder` deadline at checkout and re-arms it whenever a payment attempt fails, so the
scheduled row is the primary path for an unpaid order and the sweep covers what a scheduled row cannot, a
deadline that was never written, one dead-lettered by the internal-command processor, and every order
created before the deadline existed. Both paths converge on the same transition and the same
`OrderCancelled` compensation, so whichever arrives first wins and the other finds nothing to do.

Its loop shape is deliberate, and it is deliberately not its own. The sweep derives from the framework's
`PeriodicBackgroundService` (`PaymentReconciliationService.cs:74`), whose `ExecuteAsync` owns the
enablement gate, the 15-second startup delay that lets the host finish initializing, the per-cycle
`try`/`catch` that logs and never kills the loop, and every wait through `TimeProvider` so the cycle is
testable without real time (`PeriodicBackgroundService.cs:45-87`: gate `:47-51`, delay `:31`, per-cycle
catch `:64-76`, waits `:55,80`).

The sweep overrides exactly three members: `Interval`, read from configuration
(`PaymentReconciliationService.cs:81`); `IsEnabled`, which refuses to run when the toggle is off
(`:93-97`) or when no Stripe key is configured (`:99-103`), logging which of the two it was because those
are very different situations to find in a log; and `ExecuteCycleAsync` (`:110-111`), which delegates to an
internally visible `ReconcileOnceAsync` so one cycle is testable without the timer. That is also the base
class's only subclass in any of the four repos, apart from the test double in `PeriodicBackgroundService`'s
own unit tests (`PeriodicBackgroundServiceTests.cs:104`): one adopter, not yet a convention.

One cycle (`ReconcileOnceAsync`, `PaymentReconciliationService.cs:119`) computes a single cutoff (`:122`)
and runs two passes against it, expiry first (`:128`) and Stripe reconciliation second (`:129`). The
ordering is load-bearing, and the comment says why (`:124-127`): reconciliation can move an order into
`PaymentFailed`, and an expiry pass running afterwards would find that brand-new row against the same cutoff
and cancel it in the same cycle, collapsing the retry window to nothing.

**Pass one expires the orders that never reached the provider at all.**
`ExpireStrandedUnpaidOrdersAsync` (`:178-201`) takes `PendingPayment` or `PaymentFailed` orders older than
the cutoff (`:184-185`) and makes no provider call, because there is nothing to call about: a
`PendingPayment` order has no session id (remarks `:173-177`). Checkout has already committed that stock, so
an order nobody ever pays holds inventory nothing else can release. Each one is driven to `Cancelled`
through the same `MarkAsCancelled()` guarded transition (`:251`), which is the point: `Cancelled` is the one
terminal state the `OrderCancelled` compensation already listens on, so the release runs exactly once per
order however many times a sweep, a webhook or an outbox redelivery revisit it. `PaymentFailed` is
deliberately **not** the release state, because it is explicitly retryable (`:41-49`): releasing stock the
moment an order enters it would hand back quantities the very next checkout-session request expects to still
be committed, and a later payment would oversell.

**Pass two asks Stripe about the orders that are waiting on a confirmation.**
`ReconcileStripeSessionsAsync` (`:136-166`) takes `PaymentInitiated` orders that have a session id and last
changed before the cutoff (`:147-152`).

**Both passes bound the work in SQL, not in memory.** One shared helper, `QueryStrandedOrderIdsAsync`
(`:207-223`), takes each pass's predicate, orders oldest-first, takes the batch size and projects to ids,
all server-side (`:217-220`), over a dedicated filtered index `IX_Order_Status_Modified` on `(Status,
LastModifiedOn, CreatedOn)` (`OrderConfiguration.cs:74-76`). The comment above the reconciliation predicate
explains the rule (`:141-146`): materializing every stuck order and taking the batch in memory would make
the batch size a Stripe-call budget rather than a query bound, and the exact failure this sweep exists to
handle (a prolonged webhook outage) is the one that strands a large backlog.

**It reloads each order in its own scope and re-checks.** `ReconcileOrderAsync` (`:275`) opens a scope per
order (`:277`) so one order's failure never poisons the batch, reloads the order tracked (`:282-286`), and
returns immediately if it is no longer `PaymentInitiated` (`:288-292`), because a webhook may have arrived
between the id query and now.

**It applies the same guarded transitions the webhook would have.** The session status maps to exactly
three outcomes (`TryApplyTransition`, `:325-347`): paid to `MarkAsPaid`, expired to `MarkAsPaymentFailed`,
still open to nothing at all, left for a later cycle. Those are the identical `Result`-returning methods
called by the webhook handler (`ProcessPaymentWebhookHandler.cs:97,128`) and by the client-initiated check
(`VerifyPaymentHandler.cs:64`). The sweep gets no private path into the aggregate, so it cannot reach a
state the webhook could not.

**And it loses races on purpose.** If a webhook transitions the order between the sweep's load and its save,
the save throws `DbUpdateConcurrencyException`, which is logged and skipped, not retried (`:307-317`, the
concurrency branch `:312-317`). The concurrent writer is authoritative; the next cycle sees the final state.

The whole thing is configuration-gated by `PaymentReconciliationSettings`
(`PaymentReconciliationSettings.cs:24-53`): `Enabled` defaults true (`:30`), a 10-minute poll interval
(`:34`), a 30-minute stuck age (`:48`), and a 50-order batch (`:52`), carried as those exact values in the
Sales service's `appsettings.json:90-95`, directly below the `UnpaidOrderExpiry` section that sets the
per-order deadline (`:86`). The settings documentation asks for the stuck age to stay above normal webhook
latency and equal to `UnpaidOrderExpiry:Minutes` (`:12-22`), so the two mechanisms agree on one window and
the sweep never races a healthy delivery.

Both mechanisms are covered by tests that assert the behavior, not the wiring: seven cases on the saga
handler including a redelivered event that must not restore stock twice (`:44`), the lookup that has to
ignore the soft-delete filter (`:122`), and the missing-inventory case that must warn and still mark the
order restored (`:149`), all in `OrderCancelledSagaHandlerTests.cs:21,44,65,81,102,122,149`; and thirteen on
the sweep, seven on the Stripe pass including the lost race and the bound-the-query-not-the-list case and
six on the expiry pass including the stale `PendingPayment` order that is expired into `Cancelled` without
Stripe ever being called (`PaymentReconciliationServiceTests.cs:31,47,62,77,93,105,122,149,167,186,202,219,237`).
The ingress contract has its own pair: five methods pinning the controller's accept-versus-reject mapping,
one of them a `[Theory]` over both shape-rejection codes (`:59`) and one pinning the request-size bound
(`:83`), in `PaymentsControllerTests.cs:34,43,59,68,83`; and five on the deletion predicate, including the
operator-created endpoint that must never be judged stale
(`StripeWebhookRegistrationServiceTests.cs:181,189,203,213,226`).

## Trade-offs, honestly

- **Adoption is one module, and the record says so.** This pattern lives in MMCA.Store's Sales module only:
  the two saga handlers and the one reconciliation sweep above. MMCA.ADC and MMCA.Helpdesk have no
  compensating saga handler and no reconciliation sweep today (`ADR-054:172-176`). The record exists because
  the mechanism is the framework's stated answer to cross-boundary consistency, not because it is broadly
  adopted. Read this article as one worked implementation, not a fleet-wide convention.
- **There is no orchestrator, and that is a written deferral rather than a silence.** Choreography is
  correct for this workflow because `Order.Status` plus `Order.InventoryRestored` already *are* the saga
  state, and **ADR-086** records what would replace it when that stops being true: a MassTransit v8 saga
  state machine, durable per-instance correlation state in the owning service's own database, and
  per-instance deadlines instead of a fixed-interval sweep (`ADR-086:59-85`). The technology is already
  pinned, because MassTransit is held at v8 (v9 requires a commercial license, `:87-90`). The trigger is
  specific: a workflow with three or more steps across two or more services, state that does not fit one
  aggregate, and at least one per-instance deadline (`:97-102`). Its own Revision records that the first of
  those three properties is already satisfied without a coordinator: the per-instance unpaid-order deadline
  exists as a scheduled internal-command row rather than as state-machine state (`:8-10`, `:143-180`). The
  deferral stands, it ships no coordinator, and even after one exists the sweep stays underneath it for the
  external system that never replies (`:79-85`, `:138-141`).
- **Inconsistency is bounded, not eliminated.** Between the cancellation commit and the compensation
  commit, stock is held against a cancelled order. An unpaid order loses its stock at its own scheduled
  deadline; when that row is missing, the bound is the sweep's stuck age plus one poll interval instead, 30
  plus 10 minutes at the shipped defaults, and that is also the window an order waiting on a dropped webhook
  sits in `PaymentInitiated` with its stock held. That window is the price of not having a distributed
  transaction, and it should be a number you choose, not one you discover.
- **Compensation is best-effort per line, and names what it could not restore.**
  `RestoreInventory` cannot restore an order line whose `InventoryItem` row is missing, so it collects
  those variant ids and returns them instead of skipping quietly
  (`InventoryRestorationDomainService.cs:21-27`), and the handler logs them as a warning naming the order
  and the variants (`OrderCancelledSagaHandler.cs:80-86`). The marker still commits, that quantity is never
  restored, and nothing retries it. The comment above the marker says why (`:88-92`): the increases and the
  marker land in the same save, so withholding the marker would re-apply every **matched** increase on the
  next redelivery, and because the lookup already ignores the soft-delete filter, an unmatched variant means
  the row never existed at all. The warning is the record, not a repair, and ADR-054's own trade-off bullet
  states it the same way (`ADR-054:214-225`).
- **Redelivery re-runs every handler of the event, not the failed one.** The dispatcher iterates handlers
  sequentially with no per-handler isolation (`DomainEventDispatcher.cs:76-85`), so one throwing handler also
  skips the handlers after it, and a redelivery re-runs the ones that already succeeded. The mark-processed
  step covers the save's whole local batch (`DomainEventSaveChangesInterceptor.cs:332-354`), so what comes
  back is every event that save raised, not just the failed one. Every handler on a shared event must be
  idempotent or must keep its failure to itself.
- **The sweep is not replica-leased.** The outbox processor claims rows with a lease before working them
  (ADR-003); the sweep takes no such claim, so at the configured `maxReplicas: 2` (`main.bicep:1810`) two
  replicas can pick the same stuck order and each spend a Stripe status call. Correctness holds through the
  concurrency token; the duplicated external call does not deduplicate.
- **The webhook ingress trades visibility for endpoint survival.** A post-acceptance failure returns 200,
  so it is invisible in Stripe's delivery view and has to surface through our own `Warning` log
  (`PaymentsController.cs:115`) or through the sweep above. The endpoint is also anonymous,
  internet-reachable and exempt from both gateway rate limiters, with signature verification as its only
  authentication, so a hostile caller can generate `Critical` log volume one rejected request at a time
  (`ADR-084:181-193`).
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
2. **Make idempotency a persisted marker that commits with the writes it guards.** One `SaveChanges`, one
   database, one transaction. A flag written after the work is a narrower version of the same bug; a flag
   written with the work is an invariant. Guard the marker in the aggregate so a second call is a typed
   failure, not a silent overwrite.
3. **Add an optimistic-concurrency token** so two simultaneous deliveries cannot both pass the marker check
   and both commit. The marker handles sequential re-runs, the token handles concurrent ones. You need both.
4. **Let your delivery layer own retry.** If your event transport already retries with backoff and
   dead-letters, throw and let it re-run you. Decide explicitly, per handler, whether failure should force a
   redelivery (throw) or be kept local, and if it is kept local, give that work its own durable home rather
   than a `catch` that logs. A shared base class that logs the handler and event context and then rethrows
   makes the honest option the default one. Then check what your delivery layer actually redelivers: if
   it acknowledges a batch in one step, one thrown exception brings the whole batch back, not just your
   event.
5. **Decide what your inbound webhook's status code means, and write it down.** A third-party caller reads
   it as a delivery instruction ("retry me" or "stop"), not as an application result, and providers
   disable endpoints that keep failing. Return the error code only for the failures where nothing was
   verified and a retry could still fix it (bad signature, missing signature, empty body, unparseable body,
   missing secret), accept everything else and surface the failure through your own telemetry, and log a
   rejection at a level your production log floor actually emits. Cap the body you read before you have
   authenticated it.
6. **Back every externally-confirmed step with a periodic reconciliation sweep**, because a confirmation
   that never arrives produces no event to compensate. Bound the query in the database, reload and re-check
   each item in its own scope, drive the **same** guarded transitions the primary path uses, and let it lose
   races to the primary path rather than fighting them. Keep it even once per-instance deadlines exist: it
   is what catches the deadline that was never written.

The rule of thumb: **any step you cannot roll back needs an explicit undo, and any step you cannot confirm
needs an explicit timeout. Write both down as code, or your consistency story is hope with extra steps.**

---

**What we covered:** why a cross-boundary workflow has no transaction to roll it back, how MMCA.Store puts
compensation in its own domain-event handler running in its own DI scope (and which single check has to stay
in the command instead), how the `Order.InventoryRestored` marker committed by the same `SaveChanges` as the
inventory increases turns idempotency into a database invariant (and why that is stronger than a
record-after-success inbox), how the `RowVersion` token serializes concurrent redeliveries, why throwing is
the correct failure mode when the outbox already owns retry and what the alternative costs, why the inbound
webhook's status code encodes acceptance rather than success and registers its own endpoint (ADR-084), and
how `PaymentReconciliationService` backs both halves with a two-pass sweep that expires stranded unpaid
orders and asks Stripe for authoritative status on the rest.

**Next in the series:** Article 50, "The LLM is a dependency: a bounded, guarded, metered boundary for chat
completions."

*MMCA.Common is open source. Star the repo, read the 2-minute ADR-054 behind this pattern, or
`dotnet add package MMCA.Common.API` and build the monolith you can extract later.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- This pattern's decision records: `Website/docs-src/adr/054-saga-compensation-and-reconciliation.md` and
  `Website/docs-src/adr/084-stripe-webhook-ingress.md`
- The full 34-category scorecard, §6 and §29 included, lives in
  `Website/docs-src/governance/common-ArchitectureScorecard.md` in the docs site.

*Previous: Article 48, "Observability by Default: OpenTelemetry and Azure Monitor in MMCA." Next: Article 50,
"The LLM is a dependency: a bounded, guarded, metered boundary for chat completions."*

*Tags: .NET, C Sharp, Distributed Systems, Microservices, Software Architecture*

*Notes: verified type/behavior names with path:line (all re-read this run, MMCA.Common at v1.205.0). The
code block is condensed from
`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/Saga/OrderCancelledSagaHandler.cs:36-103`
(most logging calls and their diagnostic branches trimmed, control flow and API calls faithful, not
byte-for-byte; the `ToDictionary` call is inlined into the `RestoreInventory` argument where the source
assigns it first at `:77`, and the comments are shortened from `:70-73` and `:88-92`).*
- *ADR-054 (`Website/docs-src/adr/054-saga-compensation-and-reconciliation.md`), Accepted 2026-07-25 (`:4`),
  with the Status block recording amendments on 2026-07-28, 2026-08-01 and 2026-09-01 (`:4-13`), revisions on
  2026-09-11 (`:13-24`) and the 2026-09-19 revision that records `CancelOrderHandler` deriving from
  `MutateEntityHandlerBase` and owning the payment-session retirement (`:24-27`). Cited here: the
  ADR-003/006/021 gap statement (`:41-46`); "what it standardizes is the log line, not a swallow"
  (`:99-106`); the shared-loop paragraph (`:157-170`); marker-beats-inbox rationale (`:186-189`);
  single-module adoption (`:172-176`); the trade-offs restated here, still five bullets (`:206-244`), whose
  best-effort-per-line bullet now names what it could not restore and cites the same code this article does
  (`:214-225`). Its Revision on the per-order unpaid-order deadline and the sweep as its backstop is
  `:246-312`.*
- *ADR-084 (`Website/docs-src/adr/084-stripe-webhook-ingress.md`), Accepted 2026-08-14 with revisions on
  2026-09-03 and 2026-09-07 (`:4-7`): the delivery-family framing that places it beside ADR-003/021/017/054
  (`:9-14`), the two production incidents (`:28-34`, the same-URL duplicate at `:30-33`), the
  acceptance-coded decision stating that five error codes return 400 (`:57-73`), the startup
  self-registration (`:94-103`) and marker-scoped deletion (`:104-110`), the secret minting and shared store
  (`:111-119`), Store-Sales-only adoption plus the test suites, described there as four test methods covering
  five cases (`:126-133`), and the trade-offs cited here: 200 hides processing failures (`:168-173`), the
  never-validated configured secret (`:174-177`), and the anonymous internet-reachable endpoint that is
  exempt from both gateway rate limiters (`:181-193`). The 1 MB request-size cap is its 2026-09-07 revision
  item 1 (`:202-207`) and the shared secret store its item 2 (`:208-216`).*
- *ADR-086 (`Website/docs-src/adr/086-process-manager-deferred.md`), Accepted 2026-08-18 **as a documented
  deferral that ships no code** (`:3-7`), revised 2026-09-11 to record that the first per-instance scheduled
  deadline exists in MMCA.Store on ADR-114's internal-command queue rather than in a state machine (`:8-10`,
  Revision `:143-180`), which retires one of the three properties the deferral waits on. Also cited: the
  shape a durable coordinator would take (`:59-85`); the licensing pin that fixes the technology choice,
  MassTransit held at v8 because v9 requires a commercial license (`:87-90`); the trigger (`:97-102`); and
  ADR-054's sweep remaining underneath any future coordinator (`:79-85`, `:138-141`).*
- *Stripe ingress source (paths rooted at `MMCA.Store/Source/Modules/Sales/`, all re-read this run):
  `MMCA.Store.Sales.API/Controllers/PaymentsController.cs` anonymous raw-body POST (`[HttpPost("webhook")]`
  `:57`, `[NonIdempotent(...)]` `:58-65`, `[AllowAnonymous]` `:66`, `[RequestSizeLimit(1_000_000)]` `:76`
  with its 1 MB rationale comment `:67-75`; raw read `:81-87` with the `StreamReader` `:84` and the
  `Stripe-Signature` header `:86`), the five-code `RejectionCodes` `FrozenSet` `:39-46` (the two
  validator-raised shape rejections explained `:31-38`), the accept-versus-reject doc `:48-56` and branch
  `:100-118` (post-acceptance `Warning` `:115` + `return Ok()` `:118`), the `Critical` rejection log call
  `:111` with its `LoggerMessage` `:122-126` and the log-floor rationale comment `:105-110`.
  `MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripeWebhookRegistrationService.cs`:
  `BackgroundService` declaration `:35-40`, `AutoRegisteredDescriptionPrefix` `:49`, the three subscribed
  event types `:51-56`, the `WebhookBaseUrl`/`SecretKey` skip guards `:63-73`, the shared secret store read
  before the client is built `:100-105`, "the signing secret is only available at creation time" `:180`, the
  store write `:186`, the `Critical` announcement `:189` with its `LoggerMessage` `:292-293` and the stderr
  write `:190-192`, `IsStaleAutoRegistered` `:210-220`. `StripeWebhookSecretProvider` volatile singleton
  `.../Payments/Stripe/StripeWebhookSecretProvider.cs:17-27`, preferred over configuration on every event at
  `.../Payments/Stripe/StripePaymentService.cs:362`. Registered next to the reconciliation sweep at
  `MMCA.Store.Sales.Infrastructure/DependencyInjection.cs:39` (sweep `:42`).*
- *Store paths below are rooted at `MMCA.Store/Source/Modules/Sales/`. Checkout's single local transaction:
  `MMCA.Store.Sales.Application/ShoppingCarts/UseCases/CheckOut/CheckOutHandler.cs:135-188`
  (`ExecuteInTransactionAsync` `:135`, order insert `:165`, in-delegate `SaveChangesAsync` `:176`), followed
  by the `Sales.ExpireUnpaidOrder` deadline `ScheduleAsync` `:226` and the second `SaveChangesAsync` `:240`
  the transaction helper requires (comment `:238-239`).*
- *`CancelOrderHandler` (`MMCA.Store.Sales.Application/Orders/UseCases/Cancel/CancelOrderHandler.cs`):
  `MutateEntityHandlerBase<CancelOrderCommand, Order, OrderIdentifierType>` `:27-31`, `EntityId` `:39`,
  ADR-035 `RowVersion` override `:46` (rationale comment `:41-43`), `MutateAsync` `:55-67` calling
  `RetirePaymentSessionAsync` then `MarkAsCancelled` `:60-66`, "restoration is triggered by the
  OrderCancelled domain event" remarks `:49-54`, the no-OrderLines-include comment `:33-36`;
  `RetirePaymentSessionAsync` `:90-124` (status call `:99-100`, paid refusal with
  `OrderCancellationErrorCodes.PaymentAlreadyCompleted` `:101-109`, non-fatal logging `:111-121`), and the
  class documentation arguing why this one compensating action is inline `:17-25`.*
- *`Order` (`MMCA.Store.Sales.Domain/Orders/Order.cs`): `InventoryRestored` marker property `:122` (doc
  `:116-121`); `MarkInventoryRestored()` `:568-591` (not-cancelled guard `:570-577`, already-restored guard
  `:579-586`, set `:588`); `MarkAsCancelled()` `:548` raising `OrderCancelled` `:556`; `MarkAsPaid` `:349`;
  `MarkAsPaymentFailed` `:396`. `OrderCancelled : BaseDomainEvent`
  (`MMCA.Store.Sales.Domain/Orders/DomainEvents/OrderCancelled.cs:6-9`), so it is a pure domain event, not an
  `IIntegrationEvent`.*
- *`OrderCancelledSagaHandler : IDomainEventHandler<OrderCancelled>`
  (`MMCA.Store.Sales.Application/Orders/Saga/OrderCancelledSagaHandler.cs:30-33`): scope + `IUnitOfWork`
  `:40-41`, tracked load with lines `:44-48`, marker check `:57-61`, inventory lookup with
  `ignoreQueryFilters: true` `:74` (rationale comment `:70-73`), `ToDictionary` `:77`, `RestoreInventory`
  call `:79` with the unmatched-ids warning branch `:80-86` (`LogInventoryItemsNotFound` declared
  `:114-115`), the mark-anyway rationale comment `:88-92`, `MarkInventoryRestored` `:93`, single
  `SaveChangesAsync` `:101`; `HandleAsync` spans `:36-103` (class doc states the one-save and rowversion
  behavior `:16-23`).*
- *`OrderPaymentFailedSagaHandler` (`.../Orders/Saga/OrderPaymentFailedSagaHandler.cs:22-24`): implements
  `IDomainEventHandler<OrderPaymentFailed>` directly, no `try`/`catch` anywhere in the file; own scope
  `:31-32`, `IInternalCommandScheduler.ScheduleAsync(new SendOrderPaymentFailedEmailInternalCommand(...))`
  `:34-36`, the `Result` branch logging `LogScheduleFailed` at `Error` or `LogNotificationScheduled` at
  `Information` `:38-45` (declared `:97-103`), `RearmExpiryDeadlineAsync` call `:47` and method `:67-93`
  (settings gate `:72-76`, `ExpireUnpaidOrderInternalCommand` scheduled from now plus
  `UnpaidOrderExpirySettings.Minutes` `:81-84`, failure logged `:86-90`). The class documentation states the
  ADR-114 rationale, the post-commit position and the log-rather-than-throw rule `:11-21`, and
  `RearmExpiryDeadlineAsync`'s remarks record that the older checkout-armed deadline stays in the queue and
  runs as a no-op `:54-66`.*
- *`InventoryRestorationDomainService.RestoreInventory`
  (`MMCA.Store.Sales.Domain/Inventory/InventoryRestorationDomainService.cs:13-33`) returns
  `Result<IReadOnlyCollection<ProductVariantIdentifierType>>` `:13`: the unmatched-row branch records the
  variant id instead of skipping silently `:21-27`, `IncreaseInventory` `:29`, the collected ids are
  returned as the success value `:32`. Still a pure domain service with no infrastructure dependencies
  (`:8`).*
- *`PaymentReconciliationService : PeriodicBackgroundService(timeProvider, logger)`
  (`MMCA.Store.Sales.Infrastructure/Payments/Reconciliation/PaymentReconciliationService.cs:68-74`, base type
  `:74`): the loop is inherited, and the sweep overrides only `Interval` `:81`, `IsEnabled` `:89-107` (toggle
  gate `:93-97`, Stripe-key gate `:99-103`) and `ExecuteCycleAsync` `:110-111`. `ReconcileOnceAsync` `:119`
  (cutoff `:122`, expiry pass first `:128` then the Stripe pass `:129`, ordering rationale `:124-127`);
  `ExpireStrandedUnpaidOrdersAsync` `:178-201` (predicate `:184-185`, no-provider-call remarks `:173-177`)
  with `ExpireOrderAsync` `:229` and its `MarkAsCancelled` `:251`; `ReconcileStripeSessionsAsync` `:136-166`
  (predicate `:147-152`, rationale comment `:141-146`); the shared SQL-side ordered/bounded/projected query
  `QueryStrandedOrderIdsAsync` `:207-223` (ordering, `Take` and projection `:217-220`);
  `ReconcileOrderAsync` `:275` (per-order scope `:277`, tracked reload `:282-286`, re-check under fresh load
  `:288-292`, Stripe status call `:294-300`, save+catch block `:307-317` with
  `DbUpdateConcurrencyException` logged and skipped `:312-317`); `TryApplyTransition` `:325-347`. The class
  documentation describes the two classes of stranded order `:27-40`, why class two releases into
  `Cancelled` rather than `PaymentFailed` `:41-49`, and the sweep's position as the backstop behind the
  per-order deadline `:50-60`. Registered via
  `services.AddHostedService<PaymentReconciliationService>()`
  (`MMCA.Store.Sales.Infrastructure/DependencyInjection.cs:42`). Supporting filtered index
  `IX_Order_Status_Modified` on `(Status, LastModifiedOn, CreatedOn)`
  (`MMCA.Store.Sales.Infrastructure/Persistence/EntityConfiguration/OrderConfiguration.cs:74-76`, rationale
  comment `:70-73`).*
- *`PaymentReconciliationSettings`
  (`MMCA.Store.Sales.Infrastructure/Payments/Reconciliation/PaymentReconciliationSettings.cs:24-53`):
  `SectionName` `:27`, `Enabled` default `true` `:30`, `PollIntervalMinutes` default 10 `:34`,
  `StuckAgeMinutes` default 30 `:48`, `BatchSize` default 50 `:52`; the class documentation covers both jobs
  and asks for `StuckAgeMinutes` to equal `UnpaidOrderExpiry:Minutes` `:12-22`. Same four values in
  `MMCA.Store/Source/Services/MMCA.Store.Sales.Service/appsettings.json:90-95`, with the `UnpaidOrderExpiry`
  section at `:86`.*
- *Same guarded transitions reused by the primary paths:
  `.../Orders/UseCases/ProcessPaymentWebhook/ProcessPaymentWebhookHandler.cs:97` (`MarkAsPaid`) and `:128`
  (`MarkAsPaymentFailed`); `.../Orders/UseCases/VerifyPayment/VerifyPaymentHandler.cs:64` (`MarkAsPaid`).*
- *Framework pieces (paths rooted at `MMCA.Common/Source/Core/`): domain-event handlers registered singleton
  in `MMCA.Common.Application/DependencyInjection.cs` by `ScanModuleApplicationServices(Assembly)` declared
  `:187` (the "they create their own DI scopes internally" comment `:192`, `WithSingletonLifetime()`
  closing the scan `:197`); sequential handler loop with no per-handler isolation in
  `MMCA.Common.Application/Services/DomainEventDispatcher.cs:76-85`, inside `DispatchToHandlersAsync`
  declared `:69`; `SafeDomainEventHandler<TDomainEvent>`
  `MMCA.Common.Application/DomainEvents/SafeDomainEventHandler.cs:32`
  **logs and rethrows**, it does not swallow: `HandleAsync` `:36-47` runs `HandleSafelyAsync` inside the
  exception filter `LogAndRethrow` `:61-70`, which always
  returns `false` so the exception keeps propagating `:42-46`, with `OperationCanceledException` excluded
  from the filter `:42`; the class documentation states that swallowing made the retried-via-the-outbox
  promise false `:13-20` and spells out the whole-local-batch redelivery consequence `:21-29`. Its tests
  assert propagation, log-before-caller ordering and the unlogged cancellation
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/DomainEvents/SafeDomainEventHandlerTests.cs:33,51,73`),
  and the only subclass anywhere is the test double at `SafeDomainEventHandlerTests.cs:124`. Failed
  in-process dispatch leaves outbox entries unprocessed and signals the processor in
  `MMCA.Common.Infrastructure/Persistence/Interceptors/DomainEventSaveChangesInterceptor.cs`
  (`FlushStateAsync` `:332` dispatches the save's local events `:336-337` and only then calls
  `OutboxFinalizer.MarkProcessedAsync` `:341`; the catch that logs and signals `:346-354`); `OutboxProcessor`
  re-dispatches pure domain events in `DispatchMessagesAsync`
  (`MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:585`, called from the cycle
  at `:322`, with the `dispatcher.DispatchAsync([domainEvent], cancellationToken)` call `:639`);
  `RowVersion` on
  `MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:53`, configured on every non-owned auditable type by
  `ConfigureConcurrencyTokens`
  (`MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:582-602`, the non-owned
  auditable filter `:587-588`, called from `OnModelCreating` `:415`);
  `PeriodicBackgroundService` `MMCA.Common.Infrastructure/Scheduling/PeriodicBackgroundService.cs:20-94`
  (`Interval` `:25`, `StartupDelay` 15s `:31`, `IsEnabled` `:38`, abstract `ExecuteCycleAsync` `:42`,
  `ExecuteAsync` `:45-87` with the enablement gate `:47-51`, per-cycle catch `:64-76` and `TimeProvider`
  waits `:55,80`), whose only subclasses are the production sweep above and the test double at
  `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Scheduling/PeriodicBackgroundServiceTests.cs:104`.*
- *Tests: `MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.Application.Tests/Orders/Saga/OrderCancelledSagaHandlerTests.cs`
  seven cases at `:21,44,65,81,102,122,149` (the redelivery case `:44` asserts stock is not restored twice;
  `:122` asserts the inventory lookup ignores the soft-delete filter; `:149` asserts the handler warns and
  still marks the order restored when a variant has no inventory record);
  `MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.Infrastructure.Tests/Services/PaymentReconciliationServiceTests.cs`
  thirteen cases at `:31,47,62,77,93,105,122,149,167,186,202,219,237`, the last six covering the expiry pass
  (`:149` expires a stale `PendingPayment` order into `Cancelled`, `:167` asserts it never calls Stripe,
  `:186` the stale `PaymentFailed` order, `:202` and `:219` the orders left alone, `:237` the customer
  winning the race). Ingress:
  `MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.API.Tests/Controllers/PaymentsControllerTests.cs` five
  methods at `:34,43,59,68,83` (`:59` is a `[Theory]` over both shape-rejection codes, `:83` pins the
  request-size bound);
  `MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.Infrastructure.Tests/Services/StripeWebhookRegistrationServiceTests.cs`
  five `IsStaleAutoRegistered` cases at `:181,189,203,213,226` (`:213` is the operator-created endpoint
  that is never stale).*
- *`maxReplicas: 2` for the Sales container app: `MMCA.Store/infra/main.bicep:1810` (`salesApp` declared
  `:1683`).*
- *Rubric: §6 CQRS and Event-Driven Design (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md:229`)
  with idempotent consumers (`:238`) and ADR-documented eventual-consistency boundaries (`:239`), red flag on
  non-idempotent consumers (`:245`); §29 Resilience, Reliability and Business Continuity (`:775`), failure
  isolation (`:780`), graceful degradation (`:781`), red flag on "retries without backoff/idempotency"
  (`:791`), default weight 3 (`:795`). Group G04 Domain and Integration Events + Outbox Dual-Dispatch
  (`Website/docs-src/onboarding/00-group-taxonomy.md:59`). Framework v1.205.0 (`MMCA.Common/FACTS.md:14`,
  dated 2026-09-17 at `:4`) / 19 packages (`FACTS.md:19`) / 125 ADRs, range 001-125 (last index row ADR-125
  at `Website/docs-src/adr/README.md:137`; ADR-054's row `:66`, ADR-084's row `:96`, ADR-086's row `:98`)
  this run; not recounted here.*

- Full series index: https://ivanball.github.io/writing.html
