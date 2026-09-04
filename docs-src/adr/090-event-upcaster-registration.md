# ADR-090: Event Upcaster Registration Extension Point

## Status
Accepted (2026-08-21). **Completes the follow-up named in [ADR-010](010-integration-event-schema-versioning.md)**:
that record established the versioning policy (a `SchemaVersion` signal plus a new-type-and-upcaster
discipline for breaking changes) and named the missing upcaster registration extension point as
follow-up work. It ships one now. ADR-010's policy is unchanged; this record covers the
mechanism that enforces its consumer-side half. Revised 2026-09-03 (outbox type resolution is no
longer assembly-qualified-name-only, so the aliasing trade-off is narrower than recorded, and three
citations are re-anchored after the flat-namespace split): see the revision at the end.

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
   `IEventUpcaster<TSource, TTarget>`
   (`Source/Core/MMCA.Common.Application/Interfaces/Events/IEventUpcaster.cs`)
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
   (`Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumerExtensions.cs`),
   which binds a dedicated `UpcastingIntegrationEventConsumer<TOld>` to the retired type: it dedups on
   the original `MessageId`, upcasts to the terminal contract, and dispatches that contract's handlers,
   rethrowing failures so the standard retry policy applies. It also registers the retired type's
   `FaultIntegrationEventConsumer<TOld>` unless the call opts out, the same default as the plain
   registration. The existing
   `IntegrationEventConsumer<TEvent>` hot path is untouched.
4. **Registration follows the accumulate-across-modules idiom.**
   `services.AddEventUpcaster<TSource, TTarget, TUpcaster>()`
   (`Source/Core/MMCA.Common.Application/DependencyInjection.cs`) registers the upcaster as a
   singleton via `TryAddEnumerable`, the same shape as `AddScheduledJob` and
   `AddUserDataExportSection`: each module contributes its own upcasters independently, duplicates
   are idempotent, and the registry is assembled once from the union. The generic source and target
   parameters exist so the call site is shape-checked at compile time.
5. **Two new fitness functions gate upcaster sanity.** `ArchitectureRules.Upcasters.cs`
   (`Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Contracts/`) adds
   `EventUpcastersHaveUniqueSourceTypes`
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
  (**Narrowed by the Revision (2026-09-03)**: the outbox stores a declared event identity when the
  event carries one and resolves it by that name, so resolution is no longer assembly-qualified-name
  only. The out-of-scope call stands for this record; the mechanism belongs to
  [ADR-003](003-outbox-dual-dispatch.md).)
- **Producer-side upcasting (rewriting old rows at publish time) is also out of scope**: the outbox
  is an immutable record of what happened, and the consumer-side transform is the one place the old
  shape and the new shape are both in scope.
- **The framework still ships no V2 event of its own.** Its one concrete integration event
  (`OutputCacheEvictionRequested`) remains at version 1, so the framework's own build exercises the
  registry and rules through test doubles; the first real consumer migration will be the first
  production use of the pipeline. The fitness functions inherited by every consumer tree gate that
  day's upcasters already.

## Revision (2026-09-03)
**The decision, the mechanism, and both delivery paths are unchanged.** What changed is one
trade-off's premise and three file locations.

1. **Outbox type resolution is no longer assembly-qualified-name-only.** `OutboxMessage.FromDomainEvent`
   stores `EventNameResolver.GetStorageName(type)`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:107`),
   which is the `[EventName]` declared identity when the event carries one and its assembly-qualified
   name otherwise. `ResolveEventType` (`OutboxMessage.cs:147`) reads that stored name CLR-name-first
   and falls back to an attribute scan
   (`Type.GetType(typeName) ?? EventNameResolver.FindTypeByDeclaredName(typeName)` at `:153`), so a
   rename, a namespace move, or an assembly move leaves rows already written still resolvable. That
   is [ADR-003](003-outbox-dual-dispatch.md)'s mechanism, not this one's, and it does not move the
   policy: a breaking reshape is still a new type plus an upcaster, and the old contract still stays
   alive until every consumer has drained it. What the Trade-offs bullet above no longer states
   correctly is the premise, that resolution keys on the assembly-qualified name alone.
2. **The dead-letter half holds, with one retry in front of it.** A row whose type does not resolve
   goes to `HandleUnresolvableType`
   (`.../Outbox/Processing/OutboxProcessor.cs:585`, on the null return from `DeserializeEvent` at
   `:582`; method at `:703`), which schedules exactly one
   more attempt through the normal backoff (skipped when the host configured `MaxRetries` as 1);
   only the second miss stamps `ProcessedOn` and increments the dead-letter counter tagged
   `reason` `type_unresolvable` (`:719`).
3. **Three citations are re-anchored after the flat-namespace split.** `IEventUpcaster` now lives
   under `MMCA.Common.Application/Interfaces/Events/`, `IntegrationEventConsumerExtensions` under
   `MMCA.Common.Infrastructure/Messaging/Consumers/`, and `ArchitectureRules.Upcasters.cs` under
   `MMCA.Common.Testing.Architecture/Rules/Contracts/`. The Decision section carries the current
   paths; the types and their members are unchanged.
