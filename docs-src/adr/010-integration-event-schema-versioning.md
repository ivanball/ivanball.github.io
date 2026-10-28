# ADR-010: Integration-Event Schema Versioning & Upcaster Policy

## Status
Accepted (2026-06-19). Updated 2026-06-27 (Helpdesk enforcement gap closed; all three consumers now gate the convention). Updated 2026-08-14 (ADC now gates seven events, and a fourth tree, the local MMCA.ECommerce sample, subclasses the same base). Revised 2026-08-18 (MMCA.Common now ships its own concrete integration event, `OutputCacheEvictionRequested`, so the framework's convention test is no longer vacuous: enforcement runs at five points, not four). Updated 2026-08-21: the upcaster registration extension point named below as follow-up work now ships; see [ADR-090](090-event-upcaster-registration.md). Amended 2026-09-11: **payload purity** is now part of the contract and is build-gated, so an integration event may neither ship from outside a `*.Shared` assembly nor expose a type declared in a `*.Domain` assembly on its wire shape (see the amendment section at the end). Updated 2026-09-19 (Store now ships four concrete integration events, not one: `ProductVariantChanged`, `ProductInfoChanged`, `OrderFulfilled` and `CustomerErased`). Revised 2026-10-21: `EventConventionTestsBase` now carries the `[EventName]` rule as a third event-shape companion rule, the ECommerce sample is disclosed as pinned to an older rule set, and anchors moved. Updated 2026-10-28: the MMCA.ECommerce sample is retired, so three consumer trees gate the convention and all of them resolve the current rule set.

## Context
Integration events cross service boundaries (Identity → Conference, Conference ↔ Engagement, …) and
are resolved by consumers solely by their type string: the outbox serializes the event to JSON keyed
by `EventType` (`OutboxMessage.FromDomainEvent`), and the MassTransit broker path binds by .NET message
type. Events carried only `MessageId` (idempotency) and `DateOccurred` (when the business action
happened): **no version signal**. With database-per-service (ADR-006) and async integration over the
outbox (ADR-003), a producer that reshapes an event's payload can silently break every consumer: there
is nothing on the wire that says "this is a different shape than you expect," and no agreed rule for how
a shape may evolve. Rubric §6 flags this as the one substantive CQRS/event gap.

## Decision
1. **Every integration event carries an explicit `SchemaVersion`.** `BaseIntegrationEvent` exposes
   `public virtual int SchemaVersion => 1;`. It is serialized with the payload (System.Text.Json on the
   outbox path, MassTransit on the broker path), so a consumer always sees the producer's declared
   version. A fitness function asserts every concrete `IIntegrationEvent` declares an
   `int SchemaVersion`, so a new event cannot ship without one. The rule body
   (`ArchitectureRules.IntegrationEventsDeclareSchemaVersion`) lives once in the shared
   `MMCA.Common.Testing.Architecture` package and is surfaced through `EventConventionTestsBase`,
   alongside three event-shape companion rules: every integration event inherits `BaseIntegrationEvent`,
   declares `[EventName]` (the stable wire identity its outbox and inbox rows store), and resides in a
   Shared-layer `*.IntegrationEvents` namespace. The same base also carries the two upcaster rules of
   [ADR-090](090-event-upcaster-registration.md).
2. **Additive, optional changes keep the same version.** Adding a nullable/optional field, or a field
   with a safe default, is backward-compatible: consumers ignore unknown fields (System.Text.Json
   default) and old payloads deserialize with the default. No version bump required.
3. **Breaking changes require a new type + an upcaster, never a silent reshape.** Renaming, removing,
   or retyping a field is breaking. The producer introduces a NEW event type (e.g. `UserRegisteredV2`,
   `SchemaVersion => 2`) and publishes it; consumers register an **upcaster** that maps the old
   type/version to the new shape before their handler runs. The old type is retired only after all
   consumers have drained it (the broker binds by type, so a rename is a parallel-publish/drain
   migration, not an in-place edit).
4. **Rollout follows the framework's lockstep policy.** Adding `SchemaVersion` is a non-breaking
   `[C→A]` change (virtual default → existing events stay version 1 with no edits); it ships in a Common
   release and is swept into all consumers in one pass.

## Rationale
- **A signal, enforced.** A version field plus a build-gating convention test turns "remember the
  contract" into something the tooling checks: the same invariant-over-discipline approach as the layer
  rules, the MassTransit-v8 pin, and ADR-009's resilience gate.
- **Non-breaking by construction.** A `virtual` get-only default (`=> 1`) means no existing event
  changes and no outbox row migrates: System.Text.Json tolerates the missing field on old payloads and
  the type supplies the default; new rows simply gain `"SchemaVersion":1` (the outbox serializer
  options set no naming policy, so outbox payloads keep PascalCase:
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:17-20`, `:149`).
- **New-type-for-breaking-change** is the only safe option when transport binds by type (MassTransit)
  and consumers are independently deployed: an in-place reshape has no compatibility window.

## Trade-offs
- `SchemaVersion` is a **signal, not a mechanism**: by itself it does not stop a consumer breaking on a
  real reshape. The load-bearing half is the discipline (new type + upcaster). At the time this record
  was accepted the framework shipped no upcaster registration extension point and the policy was
  enforced by convention + review; that follow-up closed on 2026-08-21 with
  [ADR-090](090-event-upcaster-registration.md): `IEventUpcaster<TSource, TTarget>` +
  `AddEventUpcaster<...>()` + `RegisterUpcastedIntegrationEventConsumer<TOld>()`, applied on both
  delivery paths, with two new fitness functions on `EventConventionTestsBase` gating upcaster shape.
- The convention test is **no longer vacuous in MMCA.Common**: the framework now ships one concrete
  integration event, `OutputCacheEvictionRequested`
  (`Source/Core/MMCA.Common.Domain/IntegrationEvents/OutputCacheEvictionRequested.cs:29`), a sealed
  record inheriting `BaseIntegrationEvent`, and `CommonArchitectureMap` registers the Domain assembly it
  lives in (`Tests/Architecture/MMCA.Common.Architecture.Tests/CommonArchitectureMap.cs:22`), so
  `EventVersioningConventionTests` gates a real event in Common's own build. Enforcement therefore runs
  at four points. (Common's map declares no modules, so the namespace rule's Shared-layer half
  is relaxed there: `ArchitectureRules.IntegrationEventsResideInSharedIntegrationEventsNamespace`
  (`Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Contracts/ArchitectureRules.Events.cs:44-54`) applies the
  `sharedAssemblies` check only when `map.ModuleNames.Count > 0`, which is why the framework's own
  event may sit in a Domain-assembly `*.IntegrationEvents` namespace while every module-bearing consumer
  is still held to Shared.) The other three are the consumer trees, which subclass
  `EventConventionTestsBase` and run its rules against their own event assemblies (each at the rule
  set of the MMCA.Common release it resolves; all three track the current release):
  `EventConventionTests` in `MMCA.ADC.Architecture.Tests` (ADC's seven events, spread across the
  Identity, Conference and Engagement Shared assemblies the map registers) and
  `MMCA.Store.Architecture.Tests`
  (`Tests/Architecture/MMCA.Store.Architecture.Tests/Contracts/EventConventionTests.cs:3`, Store's
  four events across three modules: `ProductVariantChanged`
  (`Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Products/IntegrationEvents/ProductVariantChanged.cs:34`)
  and `ProductInfoChanged`
  (`Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Products/IntegrationEvents/ProductInfoChanged.cs:27`)
  in Catalog Shared, `OrderFulfilled`
  (`Source/Modules/Sales/MMCA.Store.Sales.Shared/Orders/IntegrationEvents/OrderFulfilled.cs:24`) in
  Sales Shared, and `CustomerErased`
  (`Source/Modules/Identity/MMCA.Store.Identity.Shared/Customers/IntegrationEvents/CustomerErased.cs:22`)
  in Identity Shared), and a matching `EventConventionTests` in
  `MMCA.Helpdesk.Architecture.Tests` (`ArchitectureTests.cs`) that gates the seed's
  `TicketOpenedIntegrationEvent`. The earlier Helpdesk gap (the rule was once subclassed only in ADC and
  Store) is **closed**: every concrete integration event across the three consumer trees is enforced, and
  so is the framework's own.
- In a module-bearing map the shared event scan covers only module assemblies, so framework-shipped
  events such as `OutputCacheEvictionRequested` are gated in Common's own build and not re-gated in
  consumer runs (`IntegrationEvents(map)` at
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Contracts/ArchitectureRules.Events.cs:155-164`).
- A get-only `SchemaVersion` is informational on the wire (it round-trips out, not back in): intentional
  (version is a property of the type, not per-instance data), but it means you read it off the concrete
  type/JSON, not by mutating it.

## Amendment (2026-09-11): integration-event payload purity

Versioning answers "how may this contract change". It does not answer "what may be in it in the
first place", and that gap is where the more expensive failure lives. An event whose property is
typed as a domain entity or a domain value object exports the producer's internal model to every
consumer: an ordinary internal refactor becomes a cross-service breaking change, and fields the
producer never meant to publish ride along on the wire. A `SchemaVersion` on such an event is a
version number attached to something that was never a contract.

**The rule.** Integration events are the public contract; domain events are not the public API.
Therefore:

1. **Every concrete `IIntegrationEvent` implementor is declared in a `*.Shared` assembly.** A
   consuming module may reference only Shared, so an event declared anywhere else is a contract
   nobody is allowed to reference.
2. **No public property on an integration event reaches a type declared in a `*.Domain` assembly**,
   directly or through a nested payload record this repo declares. Project the value onto a
   primitive or onto a contract record in Shared instead.

**Enforcement.** `IntegrationEventPayloadPurityTestsBase`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Contracts/IntegrationEventPayloadPurityTestsBase.cs:33`)
exposes the two rules as `IntegrationEvents_ShouldShipFrom_SharedAssemblies` (`:38`) and
`IntegrationEventPayloads_ShouldNotExpose_DomainTypes` (`:41`), over the rule bodies in
`Rules/Contracts/ArchitectureRules.IntegrationEventPurity.cs`
(`IntegrationEventsLiveInSharedAssemblies` at `:18`, `IntegrationEventPayloadsAreDomainFree` at
`:56`). The payload walk recurses through payload types the repo itself declares, because burying an
entity one level down hides the leak without removing it; it stops at framework and BCL types, which
are not the repo's to police, and it unwraps arrays, nullables and generic collection arguments, so
`IReadOnlyList<OrderLine>` is judged on `OrderLine`
(`UnwrapTypeArguments` at `.../ArchitectureRules.IntegrationEventPurity.cs:133-148`, called from the
walk at `:101`). Recursion is bounded by a visited set (`:94`), so a
payload record that refers back to itself terminates. Only the residency rule is vacuous for a
module-less map (`:22-25`): MMCA.Common is the framework rather than a module, so its own shipped
event answers to the public API baseline rather than to a module's Shared assembly. The payload rule
has no such guard and walks `OutputCacheEvictionRequested` in Common's own build
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Contracts/IntegrationEventPayloadPurityTests.cs:11-15`, `:72-75`).

**Why the type system alone was not enough.** `BaseIntegrationEvent` still derives from
`BaseDomainEvent` (`MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/BaseIntegrationEvent.cs:11`),
which is what lets one outbox row and one dispatcher carry both kinds of event, and `IEventBus`
already accepts only `IIntegrationEvent` on both of its overloads
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Events/IEventBus.cs:18`, `:25`). Those
two facts together stop a domain event from being *published* outward. What they cannot stop is a
domain type travelling *inside* a properly typed integration event, which is a payload question
rather than an envelope question. The compiler gates the envelope; these rules gate the payload.

**Not in scope: renaming.** Existing event names are unchanged. The `XChanged` naming is a
deliberate decision on its own axis and nothing in this amendment revisits it; a purity fix projects
a property onto a contract type, it does not rename the event carrying it. A rename would be the
new-type-plus-upcaster migration this record already governs
([ADR-090](090-event-upcaster-registration.md)), which is a far larger act than the one this
amendment asks for.

## Revision (2026-10-01)

No decision or rationale changed; two statements and one citation were corrected against source.
The amendment claimed both purity rules are vacuous for a module-less map; only the residency rule
returns early when `map.ModuleNames.Count == 0`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Contracts/ArchitectureRules.IntegrationEventPurity.cs:22-25`),
while `IntegrationEventPayloadsAreDomainFree` (`:56-78`) walks the framework's own event. The
unwrapping citation moved from `:89` (the recursive walk) to `UnwrapTypeArguments` (`:133-148`). The
Rationale's outbox example now shows `"SchemaVersion":1`, because the outbox serializer options set
only `ReferenceHandler.IgnoreCycles` and no naming policy
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:17-20`, `:140`).

## Revision (2026-10-06)

No decision, rationale or content changed; one citation moved.

- The outbox serialization call (`JsonSerializer.Serialize(domainEvent, type, SerializerOptions)`) now sits at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:142`, not `:140`;
  the Rationale citation is updated (the 2026-10-01 Revision keeps `:140` as recorded on that date). The
  serializer options at `:17-20` are unchanged.
- The Context's "type string" is, in current code, the stored name from `EventNameResolver.GetStorageName`
  (`OutboxMessage.cs:141`): the `[EventName]` identity when the event declares one, otherwise the
  assembly-qualified name. That identity is governed by
  [ADR-003](003-outbox-dual-dispatch.md); the Context is left as decision-time framing.
- All other anchors in the live sections were re-verified against current source and still hold.

## Revision (2026-10-21)

Re-verified against current source. The versioning policy, the upcaster rule and the payload-purity
amendment are unchanged; the convention base gained a rule and several anchors moved.

1. `EventConventionTestsBase` now surfaces three event-shape companion rules, not two (beside the
   SchemaVersion rule at `:15` and the two ADR-090 upcaster rules at `:27` and `:30`): beside the inherit rule
   (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Contracts/EventConventionTestsBase.cs:18`)
   and the namespace rule (`:24`) sits `IntegrationEvents_ShouldDeclare_EventName` (`:21`), whose
   body `IntegrationEventsDeclareEventName` is at
   `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Contracts/ArchitectureRules.Events.cs:33`.
   Decision item 1 now names it.
2. The `MMCA.ECommerce` sample pins `MMCA.Common.Testing.Architecture` `1.142.0`
   (`MMCA.ECommerce/Directory.Packages.props:123`), so in package mode it runs that release's rule
   set (no `[EventName]` rule, no upcaster rules) rather than the current one; source mode via
   `local.props` would swap in current source (`MMCA.ECommerce/Directory.Build.targets:71`). The
   Trade-offs entry now says so and no longer claims the consumer trees run identical rules.
3. In a module-bearing map, `IntegrationEvents(map)` scans only module assemblies
   (`ArchitectureRules.Events.cs:155-164`), so framework-shipped events are gated in Common's own
   build and not in consumer runs; recorded as a Trade-offs entry.
4. The 2026-10-06 Revision's closing line ("all other anchors ... still hold") did not hold: the three
   Store event anchors below were already off. That revision is left as recorded.
5. Anchors re-verified against current source:
   - Outbox serialization call: `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:149`
     (was `:142`); serializer options still at `:17-20`; the stored name from
     `EventNameResolver.GetStorageName` is at `:148`.
   - `IntegrationEventsResideInSharedIntegrationEventsNamespace`: `ArchitectureRules.Events.cs:44-54`
     (was `:28-33`), with `enforceSharedLayer = map.ModuleNames.Count > 0` at `:47`.
   - `ProductVariantChanged`: `MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Products/IntegrationEvents/ProductVariantChanged.cs:34`
     (was `:41`); `ProductInfoChanged`: `ProductInfoChanged.cs:27` (was `:31`); `OrderFulfilled`:
     `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Shared/Orders/IntegrationEvents/OrderFulfilled.cs:24`
     (was `:28`). `CustomerErased.cs:22` still holds.
