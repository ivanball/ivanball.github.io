# ADR-090: Event Upcaster Registration Extension Point

## Status
Accepted (2026-08-21). **Completes the follow-up named in [ADR-010](010-integration-event-schema-versioning.md)**:
that record established the versioning policy (a `SchemaVersion` signal plus a new-type-and-upcaster
discipline for breaking changes) and recorded that "the framework does not yet ship an upcaster
registration extension point". It ships one now. ADR-010's policy is unchanged; this record covers the
mechanism that enforces its consumer-side half.

## Context
ADR-010 splits event evolution into a signal and a discipline. The signal (`SchemaVersion`, a
fitness-function-gated property on every integration event) shipped with ADR-010 itself. The
discipline (a breaking change means a NEW event type plus a consumer-side upcaster that maps the old
shape to the new one before any handler runs) had no supporting machinery: nothing to write an
upcaster against, nowhere to register one, and no pipeline that would apply it. The policy was
enforced by convention plus review, and ADR-010's own Trade-offs section named building the extension
point as follow-up work.

The gap matters on both delivery paths the framework supports. On the broker path, MassTransit binds
consumers by .NET message type, so a retired contract keeps arriving as its old type until every
producer has moved and every queue has drained; without an upcaster pipeline, a consumer either keeps
handlers for both shapes or breaks. On the in-process path (`InProcessMessageBus` in monolith mode),
outbox rows written before an upgrade deserialize to the old type and dispatch as-is. In both cases
the load-bearing transform, old shape to new shape, lived in application code with no framework
support and no fitness function watching it.

## Decision
1. **A typed upcaster abstraction, in the Application layer.**
   `IEventUpcaster<TSource, TTarget>` (`Source/Core/MMCA.Common.Application/Interfaces/IEventUpcaster.cs`)
   is a pure payload mapping from a retired integration-event contract to its successor. A
   non-generic `IEventUpcaster` base (`SourceType`, `TargetType`, `Upcast(IIntegrationEvent)`) lets
   the registry store and route upcasters by runtime type; the generic interface supplies those
   members as default interface implementations so an author writes exactly one method. The
   abstraction lives in Application, not Domain (upcasting is a consumer-side concern) and not
   Infrastructure (both delivery paths need it, and Application must stay MassTransit-free per the
   microservice-extraction rules).
2. **A chaining registry with envelope preservation.** `EventUpcasterRegistry`
   (`Source/Core/MMCA.Common.Application/Services/EventUpcasterRegistry.cs`) indexes upcasters by
   source type and follows chains (V1 to V2 to V3) to the terminal contract, walking by each
   upcaster's declared `TargetType` so the constructor's acyclicity validation is what bounds the
   walk. After every hop the registry stamps `MessageId` and `DateOccurred` from the pre-hop
   instance onto the result, so inbox deduplication keys survive upcasting by construction and
   upcaster authors map payload fields only. Misconfiguration (two upcasters sharing a source type, a
   self-map, a cycle) throws at construction with the offending types named, and an internal hosted
   service resolves the registry at host start so a bad configuration fails startup, not the first
   message.
3. **Both delivery paths consult the registry.** `DomainEventDispatcher` upcasts the
   integration-event branch to the terminal type before selecting `IIntegrationEventHandler<>`
   implementations (domain-event dispatch is untouched: intra-module handlers migrate with the
   code). Broker hosts register `RegisterUpcastedIntegrationEventConsumer<TOld>()`
   (`Source/Core/MMCA.Common.Infrastructure/Services/IntegrationEventConsumerExtensions.cs`), which
   binds a dedicated `UpcastingIntegrationEventConsumer<TOld>` to the retired type: it dedups on the
   original `MessageId`, upcasts to the terminal contract, and dispatches that contract's handlers,
   rethrowing failures so the standard retry policy applies. The existing
   `IntegrationEventConsumer<TEvent>` hot path is untouched.
4. **Registration follows the accumulate-across-modules idiom.**
   `services.AddEventUpcaster<TSource, TTarget, TUpcaster>()`
   (`Source/Core/MMCA.Common.Application/DependencyInjection.cs`) registers the upcaster as a
   singleton via `TryAddEnumerable`, the same shape as `AddScheduledJob` and
   `AddUserDataExportSection`: each module contributes its own upcasters independently, duplicates
   are idempotent, and the registry is assembled once from the union. The generic source and target
   parameters exist so the call site is shape-checked at compile time.
5. **Two new fitness functions gate upcaster sanity.** `ArchitectureRules.Upcasters.cs`
   (`Source/Hosting/MMCA.Common.Testing.Architecture/`) adds `EventUpcastersHaveUniqueSourceTypes`
   and `EventUpcastersIncreaseSchemaVersion` (the target must declare a strictly higher
   `SchemaVersion` than its source), surfaced as two new facts on `EventConventionTestsBase` so
   every consumer tree that already subclasses it inherits them with no edit. They pass trivially at
   zero upcasters.

The migration recipe the mechanism supports, end to end:

```csharp
// DI (module registration):
services.AddEventUpcaster<ProductVariantChanged, ProductVariantChangedV2, ProductVariantChangedUpcaster>();
// Broker hosts (Program.cs, inside AddBrokerMessaging's consumer callback):
x.RegisterIntegrationEventConsumer<ProductVariantChangedV2>();       // the new contract
x.RegisterUpcastedIntegrationEventConsumer<ProductVariantChanged>(); // the old contract drains via the upcaster
// Handlers are written once, against V2 only. Monolith hosts need only the DI call.
// After every producer publishes V2 and the old-type queues drain: delete the upcaster,
// the draining registration, and eventually the old type.
```

## Rationale
- **The discipline becomes a mechanism.** ADR-010's own framing (a thing that matters is a check,
  not a comment) now applies to the upcaster half: the transform has a first-class type, a
  registration extension point, a pipeline that applies it on both delivery paths, and fitness
  functions that gate its shape.
- **Envelope preservation belongs to the framework, not the author.** Inbox dedup keys off
  `MessageId`; an upcaster author who forgot to copy it would silently break exactly the
  at-least-once guarantees the outbox and inbox exist to provide. Stamping it centrally makes the
  failure impossible rather than reviewable.
- **A dedicated draining consumer keeps the transition visible.** The old type's broker binding is
  an explicit line in Program.cs, matching the repo's explicit per-event registration idiom: "this
  contract is draining" is readable at the composition root, and deleting the line is the retirement
  step ADR-010 already prescribes.
- **Declared-type keying matches ADR-010.** `SchemaVersion` is informational on the wire (it
  round-trips out, not back in); the upcaster reads the declared .NET type, which is what both
  transport bindings already key on.

## Trade-offs
- **The upcast walk advances by declared target type, not runtime type.** A misbehaving upcaster
  that returns an instance of some other type cannot send the walk into an unvalidated path or an
  infinite loop; the cost is that the registry trusts the declaration, which the compile-time
  constraints on `AddEventUpcaster` make safe.
- **About 25 lines of compiled-invoker plumbing are duplicated** between `DomainEventDispatcher`
  (Application) and `UpcastingIntegrationEventConsumer` (Infrastructure), accepted to avoid growing
  Application's public surface with a shared invoker service.
- **Outbox type-name aliasing is deliberately out of scope.** `OutboxMessage.DeserializeEvent`
  resolves by assembly-qualified name and dead-letters an unresolvable type. That is not a gap this
  mechanism needs to close: the policy keeps the old CLR type alive until every consumer has drained
  it, so resolution always succeeds during the migration window. Remapping stale type names for
  types deleted ahead of policy would paper over a policy violation rather than support the policy.
- **Producer-side upcasting (rewriting old rows at publish time) is also out of scope**: the outbox
  is an immutable record of what happened, and the consumer-side transform is the one place the old
  shape and the new shape are both in scope.
- **The framework still ships no V2 event of its own.** Its one concrete integration event
  (`OutputCacheEvictionRequested`) remains at version 1, so the framework's own build exercises the
  registry and rules through test doubles; the first real consumer migration will be the first
  production use of the pipeline. The fitness functions inherited by every consumer tree gate that
  day's upcasters already.
