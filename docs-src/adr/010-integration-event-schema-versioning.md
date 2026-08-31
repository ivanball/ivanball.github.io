# ADR-010: Integration-Event Schema Versioning & Upcaster Policy

## Status
Accepted (2026-06-19). Updated 2026-06-27 (Helpdesk enforcement gap closed; all three consumers now gate the convention). Updated 2026-08-14 (ADC now gates seven events, and a fourth tree, the local MMCA.ECommerce sample, subclasses the same base). Revised 2026-08-18 (MMCA.Common now ships its own concrete integration event, `OutputCacheEvictionRequested`, so the framework's convention test is no longer vacuous: enforcement runs at five points, not four). Updated 2026-08-21: the upcaster registration extension point named below as follow-up work now ships; see [ADR-090](090-event-upcaster-registration.md).

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
   alongside two companion rules: every integration event inherits `BaseIntegrationEvent` and resides
   in a Shared-layer `*.IntegrationEvents` namespace.
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
  the type supplies the default; new rows simply gain `"schemaVersion":1`.
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
  at five points, not four. (Common's map declares no modules, so the namespace rule's Shared-layer half
  is relaxed there: `ArchitectureRules.IntegrationEventsResideInSharedIntegrationEventsNamespace`
  (`Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Events.cs:28-33`) applies the
  `sharedAssemblies` check only when `map.ModuleNames.Count > 0`, which is why the framework's own
  event may sit in a Domain-assembly `*.IntegrationEvents` namespace while every module-bearing consumer
  is still held to Shared.) The other four are the consumer trees, which subclass
  `EventConventionTestsBase` and run the identical rules against their own event assemblies:
  `EventConventionTests` in `MMCA.ADC.Architecture.Tests` (ADC's seven events, spread across the
  Identity, Conference and Engagement Shared assemblies the map registers) and
  `MMCA.Store.Architecture.Tests` (Store's one), a matching `EventConventionTests` in
  `MMCA.Helpdesk.Architecture.Tests` (`ArchitectureTests.cs`) that gates the seed's
  `TicketOpenedIntegrationEvent`, and one in the two-module `MMCA.ECommerce` sample
  (`Tests/Architecture/MMCA.ECommerce.Architecture.Tests/ArchitectureTests.cs:38`, a local-only sample
  repo that is not published) gating its `ProductCreatedIntegrationEvent` and
  `OrderPlacedIntegrationEvent`. The earlier Helpdesk gap (the rule was once subclassed only in ADC and
  Store) is **closed**: every concrete integration event across the four consumer trees is enforced, and
  so is the framework's own.
- A get-only `SchemaVersion` is informational on the wire (it round-trips out, not back in): intentional
  (version is a property of the type, not per-instance data), but it means you read it off the concrete
  type/JSON, not by mutating it.
