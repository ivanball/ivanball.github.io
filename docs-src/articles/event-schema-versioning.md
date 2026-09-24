# Event-schema versioning: never silently reshape an event

> Series: MMCA.Common · Article #15 · Pillar P3 · Group G04 · Rubric §6 · ADR-010 · ADR-090 ·
> Status: grounded in `Website/docs-src/adr/010-integration-event-schema-versioning.md`,
> `Website/docs-src/adr/090-event-upcaster-registration.md` and
> `Website/docs-src/onboarding/group-04-events-outbox.md`. No em dashes.

**Subtitle:** An integration event is a wire contract the moment it crosses a service boundary.
Reshape it in place and you break consumers that are already deployed. Here is the policy that prevents it.

---

You shipped this event a year ago, and three services consume it:

```csharp
public sealed record UserRegistered(int UserId, string FullName) : BaseIntegrationEvent;
```

Today a product requirement says you need first and last name separately. The obvious edit:

```csharp
// Looks harmless. It is not.
public sealed record UserRegistered(int UserId, string FirstName, string LastName)
    : BaseIntegrationEvent;
```

You deploy the producer. The event serializes with the new shape. Every consumer that still expects
`FullName` deserializes it, finds no `FullName`, and either gets a null where it never expected one or
throws on a missing required member. Nothing on the wire told them the shape changed. They were already
deployed and running, and you reshaped the contract under them.

This is not a hypothetical. With database-per-service and async integration over the outbox, consumers
resolve an event *solely by its type string*: the outbox serializes the event to JSON keyed by
`EventType`, and the broker path binds by .NET message type. There is no schema registry in the middle
saying "this is a different shape than you expect." A producer that reshapes a payload silently breaks
every consumer, and it does it in production, asynchronously, where it is hardest to trace.

## Why it matters

In a monolith, an event handler and the code that raises the event compile together. Reshape the event
and the consumer fails to compile; you fix it in the same commit. The type system is your schema
check.

The moment a module is extracted into its own service, that safety net is gone. Producer and consumer
are independently deployed. They are different processes, possibly different repos, definitely
different deploy cadences. There is now a window where the producer speaks the new shape and the
consumer still expects the old one, and no compiler spans that window. The events that were "just an
internal contract" inside the monolith are now a *wire contract*, and wire contracts have exactly one
rule: you do not break them out from under a deployed reader.

An event that carries only `MessageId` (idempotency) and `DateOccurred` (when the business action
happened) has no version signal at all, and a consumer meeting an unfamiliar payload has nothing to
branch on: it cannot tell a producer that has moved ahead of it from a shape it should refuse, and it
certainly cannot upcast. That is the one substantive CQRS and event-driven gap the scorecard names
under §6, and ADR-010 is the answer.

## The MMCA answer: a version on every event, and a rule for changing it

The decision has two halves: a signal that is enforced, and a discipline for breaking changes.

**Half one: every integration event carries an explicit `SchemaVersion`.** The base record exposes it
as a virtual default:

```csharp
// MMCA.Common.Domain - BaseIntegrationEvent
public virtual int SchemaVersion => 1;

// A concrete event overrides only when it bumps:
public sealed record UserRegisteredV2(int UserId, string FirstName, string LastName)
    : BaseIntegrationEvent
{
    public override int SchemaVersion => 2;
}
```

It is serialized with the payload (System.Text.Json on the outbox path, MassTransit on the broker
path), so a consumer always sees the producer's declared version and has an explicit value to branch or
upcast on. And it is not just a convention you have to remember: a fitness function,
`EventVersioningConventionTests`, asserts that every concrete integration event declares an `int
SchemaVersion`, so a new event cannot ship without one. The same invariant-over-discipline approach as
the layer rules and the MassTransit-v8 pin: a thing that matters is a check, not a comment.

**Half two: the rule for changing a shape.**

- **Additive, optional changes keep the same version.** Adding a nullable or optional field, or one
  with a safe default, is backward-compatible. Consumers ignore unknown fields (System.Text.Json's
  default), and old payloads deserialize with the default. No version bump.
- **Breaking changes require a NEW type plus an upcaster, never a silent reshape.** Renaming, removing,
  or retyping a field is breaking. The producer introduces a new event type (`UserRegisteredV2`,
  `SchemaVersion => 2`) and publishes it. Consumers register an *upcaster* that maps the old
  type/version to the new shape before their handler runs. The old type is retired only after every
  consumer has drained it.

That last point is forced by the transport, not chosen for taste. The broker binds by type, so a rename
is a parallel-publish-and-drain migration with a real compatibility window, not an in-place edit. An
in-place reshape has *no* compatibility window: the instant the producer deploys, the old shape is
gone, and any consumer mid-deploy or slow to upgrade is reading a contract that no longer exists.
New-type-for-breaking-change is the only safe option when transport binds by type and consumers deploy
independently.

Since 2026-08-21 the framework ships the wiring for that migration, not only the rule (ADR-090). An
upcaster is one typed class, `IEventUpcaster<TOld, TNew>`, registered by the module that owns the
contract:

```csharp
// Module DI: one line per retired contract.
services.AddEventUpcaster<ProductVariantChanged, ProductVariantChangedV2, ProductVariantChangedUpcaster>();

// Broker hosts also bind the retired queue, inside AddBrokerMessaging's consumer callback:
x.RegisterIntegrationEventConsumer<ProductVariantChangedV2>();       // the current contract
x.RegisterUpcastedIntegrationEventConsumer<ProductVariantChanged>(); // the old one, draining
```

The registry chains registrations to the terminal contract (register V1 to V2 and V2 to V3, and a V1
message reaches the V3 handler), and after every hop it stamps `MessageId` and `DateOccurred` from the
pre-hop instance, so inbox deduplication keys survive the transform and an upcaster author maps payload
fields only. Both delivery paths honor it, the in-process dispatcher and the broker consumer, so
handlers are written once against the newest contract. A duplicate source contract, a type mapped onto
itself, or a cycle fails host startup with the offenders named, rather than the first message. Retiring
the old type is deleting these lines.

`SchemaVersion` is non-breaking by construction. A virtual get-only default (`=> 1`) means no existing
event has to change and no outbox row has to be migrated: System.Text.Json tolerates the missing field
on old payloads and the type supplies the default; new rows simply gain `"schemaVersion":1`. It lives in
the framework, and a framework change reaches every consumer in one pass: the lockstep policy (ADR-016)
bumps every `MMCA.Common.*` pin in every consumer together, with no phased rollout, so no consumer sits
on a base record its producers have moved past.

## How it complements the outbox

This sits directly on top of the transactional outbox (ADR-003). The outbox guarantees an event is
*delivered* at least once: persisted atomically with the state change, then drained to consumers with
retries. Schema versioning guarantees that when the event arrives, the consumer can *understand* it.

The two failure modes are different and both have to be covered. The outbox addresses "the event was
lost." Versioning addresses "the event arrived but means something different than the reader thinks."
At-least-once delivery already requires consumers to be idempotent (a duplicate can arrive); add to that
contract that a consumer should also be tolerant of versions it knows and explicit about versions it
does not. The version field is what lets a consumer make that decision instead of guessing from a
shape that silently changed.

## Trade-offs, honestly

ADR-010 is candid that the field is a signal, not a complete mechanism.

- **`SchemaVersion` by itself does not stop a consumer breaking on a real reshape.** It is a value on
  the wire, and the load-bearing half is still the discipline: new type plus upcaster. That half is no
  longer only a discipline. The framework now ships the registration extension point (2026-08-21,
  ADR-090): a typed `IEventUpcaster<TSource, TTarget>`, `AddEventUpcaster<...>()`, a chaining registry
  that preserves the envelope, a draining broker consumer for the retired queue, and two fitness
  functions that reject two upcasters claiming one source contract or a target that does not raise
  `SchemaVersion`. Two gaps stay open and are worth naming: the framework itself still ships no V2 event
  of its own (its one concrete integration event stays at version 1, so the first real consumer
  migration will be the pipeline's first production use), and outbox type-name aliasing for a type
  deleted ahead of policy is deliberately out of scope, because the policy keeps the old type alive
  until every consumer has drained it.
- **The convention test covers a real event in MMCA.Common, but the framework's own coverage is one
  event wide.** Common ships exactly one concrete integration event, the sealed record
  `OutputCacheEvictionRequested`, and `CommonArchitectureMap` registers the Domain assembly it lives
  in, so `EventVersioningConventionTests` runs against a real event in Common's own build. Enforcement
  runs at five points: the framework itself plus four consumer trees (ADC, Store, Helpdesk, and a
  local-only two-module sample), each subclassing the same base and running the identical rules
  against its own event assemblies. One caveat rides along: Common's map declares no modules, so the
  Shared-layer half of the namespace rule is relaxed for the framework's own event, while every
  module-bearing consumer is still held to it. The framework supplies the rule; the consumers still
  supply the bulk of the events that exercise it.
- **`SchemaVersion` is informational on the wire (it round-trips out, not back in).** A get-only virtual
  property means you read the version off the concrete type or the JSON, you do not mutate it per
  instance. That is intentional (a version is a property of the type, not of an individual message), but
  it means the upcaster reads the declared type, not a settable field. That is literally how the shipped
  registry works: it indexes upcasters and walks chains by the declared .NET type, which is what both
  transport bindings already key on.

None of these are reasons to skip the field. They are the reasons the field is necessary but not
sufficient, and the discipline is the rest of the answer.

## Apply this even without MMCA

The policy ports to any event-driven system with independently deployed consumers:

1. **Put an explicit version on every event,** and make it un-skippable. A test that fails the build
   when a new event omits a version is worth more than a wiki page that says to add one.
2. **Treat additive-and-optional as the only in-place change you are allowed to make.** New nullable
   field with a default: fine. Anything else is breaking.
3. **For breaking changes, publish a new type and upcast, then drain and retire the old one.** Never
   edit a shape that a deployed reader still expects. The broker binds by type; use that to get a
   compatibility window instead of a cliff.
4. **Pair it with at-least-once delivery and idempotent consumers.** Versioning answers "can I
   understand this?"; the outbox and idempotency answer "did I get it, exactly once in effect?" You need
   both.

The rule of thumb: the instant an event crosses a service boundary it is a published contract. You can
add to it, you can supersede it, but you can never quietly change it.

---

**What we covered:** why silently reshaping an integration event breaks already-deployed consumers
(especially after extraction, when the compiler no longer spans producer and consumer), how
MMCA.Common puts an enforced `SchemaVersion` on every event and answers a breaking change with a new
type plus a registered upcaster that the framework chains and applies on both delivery paths, and how
that complements the outbox's at-least-once delivery.

**Next in the series:** cross-service auth without a shared secret, JWKS dual-fetch and RS256 so an
extracted service validates tokens with no shared key.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-010 behind this
policy, or `dotnet add package MMCA.Common.API` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- ADR-010 (event-schema versioning and upcaster policy): `Website/docs-src/adr/010-integration-event-schema-versioning.md` in the docs site.
- ADR-090 (the upcaster registration extension point): `Website/docs-src/adr/090-event-upcaster-registration.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, Event-Driven Architecture, Microservices*

*Notes: this run re-verified the article against MMCA.Common `main` at v1.205.0, after the upcaster and
event-convention files were reorganized into deeper folders; every anchor below was re-read at its current
location. The mechanism half is no longer follow-up work (it shipped 2026-08-21, ADR-090). The non-generic
`IEventUpcaster` (`SourceType`, `TargetType`, `Upcast`) lives at
`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Events/IEventUpcaster.cs:28` and the typed
`IEventUpcaster<in TSource, out TTarget>` at line 67 of the same file, supplying the non-generic members
as default interface implementations (lines 72, 75 and 85). The contract `IEventUpcasterRegistry`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Events/IEventUpcasterRegistry.cs:24`) is
implemented by `EventUpcasterRegistry`
(`MMCA.Common/Source/Core/MMCA.Common.Application/Services/EventUpcasterRegistry.cs:30`), whose
constructor rejects a duplicate source, a self-map and a cycle by naming the offenders (lines 50-82, with
the cycle walk in `BuildTerminalTypes`, lines 133-161), whose chain walk advances by the upcaster's
DECLARED `TargetType` (lines 110-120), and which stamps `MessageId` and `DateOccurred` from the pre-hop
instance after every hop (`PreserveEnvelope`, lines 169-179). Registration is
`AddEventUpcaster<TSource, TTarget, TUpcaster>()`
(`MMCA.Common/Source/Core/MMCA.Common.Application/DependencyInjection.cs:559`), a singleton added through
`TryAddEnumerable` (line 564), with the registry itself registered at line 43. Both delivery paths
consult it: `DomainEventDispatcher` upcasts the integration branch to its terminal contract before
selecting handlers
(`MMCA.Common/Source/Core/MMCA.Common.Application/Services/DomainEventDispatcher.cs:62`) while the
`IDomainEventHandler<T>` branch is deliberately untouched (line 55), and a broker host binds a retired
queue with `RegisterUpcastedIntegrationEventConsumer<TEvent>`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/IntegrationEventConsumerExtensions.cs:78`)
onto `UpcastingIntegrationEventConsumer<TEvent>`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/UpcastingIntegrationEventConsumer.cs:32`),
which dedups on the original `MessageId` before any upcasting (lines 69-83: the id is read at line 71 and
`IInboxStore.TryBeginAsync` runs at line 79). Misconfiguration fails host start:
`EventUpcasterStartupValidator`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Messaging/Consumers/EventUpcasterStartupValidator.cs:20`)
resolves the registry as an `IHostedService`, registered at
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:209`. The two upcaster fitness
functions are `EventUpcastersHaveUniqueSourceTypes` and `EventUpcastersIncreaseSchemaVersion`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Contracts/ArchitectureRules.Upcasters.cs:12`
and `:28`), surfaced as two facts on `EventConventionTestsBase`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Contracts/EventConventionTestsBase.cs:23`
and `:26`), so every consumer tree inherits them with no edit. ADR-090 records the decision: its Status
line ties it to ADR-010's named follow-up
(`Website/docs-src/adr/090-event-upcaster-registration.md:4`), its five decision points sit at lines
30-74 and the migration recipe at lines 76-87, and the two residual gaps quoted in the trade-offs are its
own (no framework V2 event yet, lines 126-130; outbox type-name aliasing out of scope, lines 114-122,
narrowed by that record's 2026-09-03 revision but still called out of scope). ADR-010's Status line
(`Website/docs-src/adr/010-integration-event-schema-versioning.md:4`) carries the Helpdesk gap closed
2026-06-27, ADC's seven events plus the ECommerce tree 2026-08-14, Common's own event 2026-08-18 and the
upcaster extension point 2026-08-21, and has since taken two further entries this article does not cover:
the 2026-09-11 payload-purity amendment (an integration event may neither ship from outside a `*.Shared`
assembly nor expose a `*.Domain` type on its wire shape) and a 2026-09-19 update recording four concrete
Store integration events rather than one. Its trade-off sections moved with those edits: the first
trade-off reads as shipped (lines 50-56); the "no longer vacuous" trade-off sits at lines 57-89, with the
Shared-layer namespace relaxation for Common's module-less map at lines 63-68 and the
closed-Helpdesk-gap sentence at lines 87-89; the informational-on-the-wire trade-off is at lines 90-92.
Still verified this run: `BaseIntegrationEvent` with `public virtual int SchemaVersion => 1;`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/BaseIntegrationEvent.cs:32`), the
`public override int SchemaVersion => 2;` override pattern documented on the same member (line 19) with
the ADR-090 wiring at lines 22-29; Common's one concrete integration event, the sealed record
`OutputCacheEvictionRequested : BaseIntegrationEvent`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/IntegrationEvents/OutputCacheEvictionRequested.cs:29`), still
at version 1 (it declares no override and carries `[EventName("Common.OutputCacheEvictionRequested.v1")]`
at line 28); `CommonArchitectureMap` registering the Domain assembly that holds it
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/CommonArchitectureMap.cs:22`), so
`EventVersioningConventionTests`
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Contracts/EventVersioningConventionTests.cs:12`)
gates a real event in Common's own build; the rule body
`ArchitectureRules.IntegrationEventsDeclareSchemaVersion`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Contracts/ArchitectureRules.Events.cs:6`);
outbox `EventType`-keyed JSON serialization (`OutboxMessage.FromDomainEvent`,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxMessage.cs:131`, with
`EventType` set from `EventNameResolver.GetStorageName` at line 139); and enforcement at five points,
Common itself plus ADC
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Contracts/EventConventionTests.cs:3`), Store
(`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Contracts/EventConventionTests.cs:3`),
Helpdesk (`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/ArchitectureTests.cs:38`,
gating `TicketOpenedIntegrationEvent`) and the local-only, unpublished `MMCA.ECommerce` sample
(`MMCA.ECommerce/Tests/Architecture/MMCA.ECommerce.Architecture.Tests/ArchitectureTests.cs:38`), each
inheriting the two upcaster facts as well.*

- Full series index: https://ivanball.github.io/writing.html
