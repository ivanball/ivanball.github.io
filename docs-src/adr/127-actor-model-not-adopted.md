# ADR-127: The Actor Model Is Not Adopted

## Status
Accepted (2026-09-22) **as a documented rejection**. Nothing ships with this record: no grain
interface, no silo, no placement configuration, no new package. What ships is the reason the actor
model was weighed and dropped, the alternative weighed with it, and the one condition that would make
it right to revisit. The existing path stays: EF over the owning module's own database, Redis-backed
caching, and the SignalR notification hub.

## Context
The actor model gives every logical entity its own single-threaded unit of execution holding its state
in memory and serializes all messages to that entity through it; a virtual-actor runtime makes the
activation implicit. What that buys is **single-writer semantics over high-cardinality per-entity
in-memory state**: many small entities, each mutated faster than a database round trip allows, each
needing its own serialization point. It gets proposed here because ADC has a conference-day live
layer, which sounds like that workload. It is not, and the difference is this record.

**The live state is small, and it is database state.** A live poll is an aggregate root with a status
and a set of options; a vote is a write through the module's unit of work
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/LivePolls/UseCases/CastVote/CastVoteHandler.cs:19`,
the repository call at `:30`) and the tallies are a read through the same one
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/LivePolls/UseCases/GetPollResults/GetPollResultsHandler.cs:23`).
Bookmark counts are a query behind a cross-module service contract rather than a resident counter
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Shared/UserSessionBookmarks/IBookmarkCountService.cs:11`),
and session state is the caller's own row, read per request. Contention is handled by the database
rather than by a writer thread: every auditable entity carries a database-managed concurrency token
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Interfaces/IRowVersioned.cs:11`) configured for every
context in `OnModelCreating`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:415`).
That is the single-writer guarantee an actor would provide, and it already holds across replicas,
which an in-process actor would not ([ADR-035](035-optimistic-concurrency.md)).

**Fan-out is a push channel, not an actor mailbox.** `ILiveChannelPublisher` is the port
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Notifications/ILiveChannelPublisher.cs:9`),
its shipped adapter broadcasts through the SignalR hub
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/Live/SignalRLiveChannelPublisher.cs:11`),
which is framework code
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Notifications/NotificationHub.cs:25`) mapped by
the host at startup
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/SignalRExtensions.cs:27`). ADC's Engagement
module reaches it off the command hot path through a single-reader drain that preserves per-session
ordering
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Infrastructure/Live/LiveChannelPublishProcessor.cs:30`,
resolving the publisher per item at `:51`), the one actor-shaped guarantee the live layer needs.

**Read pressure is absorbed by caching, and the load is small.** Tier 2 is an HTTP output cache in the
pipeline
(`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/Pipeline/MiddlewarePipelineBuilder.cs:145`)
backed by Redis when a connection string is present
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Caching/RedisCachingExtensions.cs:91`, registered at
`:99`), with the Redis resource composed by each app's AppHost
(`MMCA.ADC/Source/Hosting/MMCA.ADC.AppHost/Program.cs:44`, the builder at `:10`), so a hot read path
never reaches the database. ADC serves a single conference's attendance over a few days, and a runtime
built for millions of addressable entities is not sized for that. Searches of both `Source` trees for
`Orleans`, `IGrain`, `Akka` and `Proto.Actor` return no match, so the absence is real.

## Decision
Do not adopt the actor model, and do not introduce an actor runtime as a hosting layer. Per-entity state
stays in the owning module's database behind optimistic concurrency, read pressure stays on the caching
tiers, and live fan-out stays on the notification hub.

## Rationale
- **No workload has the shape.** Actors earn their cost on high-cardinality per-entity in-memory state
  with single-writer semantics, and nothing here has all three: entity counts are small, state is
  durable rather than resident, and the writer guarantee is held by the concurrency token.
- **It would be a third execution model.** Modules run either in process behind the module contract or
  out of process behind gRPC ([ADR-007](007-grpc-extraction.md),
  [ADR-008](008-service-extraction-topology.md)); an actor runtime adds a third, with its own
  addressing, lifetime, placement and failure semantics for every module author to know.
- **Grain state and database state would have to be reconciled.** An in-memory authority over an entity
  that also has a row is two copies of the truth, while the one actor-shaped guarantee the live layer
  needs is already met by a drain ([ADR-121](121-ephemeral-in-process-work-queue.md)).
- **Operational cost does not scale down.** A silo cluster needs membership, placement and its own
  failure modes in both production deployments, understood during an incident.

## Trade-offs
- **A genuinely actor-shaped workload will arrive without groundwork**, and the first adoption pays the
  learning cost under whatever deadline produced the requirement.
- **Some contention is answered with a retry rather than with a queue.** Optimistic concurrency fails
  the losing writer, which would be the wrong answer for an entity many callers mutate continuously.
- **Every live mutation costs a database round trip.** Comfortable rather than free, and the number to
  watch, because it is the first thing that moves as the trigger below approaches. The rejection is
  scoped to the workloads that exist, and stops being true the moment that trigger is met.

## Alternatives rejected
- **Microsoft Orleans hosted under Aspire, weighed 2026-09-22 and rejected.** Orleans is the .NET
  virtual-actor runtime and the option this record weighed. Aspire already composes the local stack
  ([ADR-098](098-aspire-orchestration-not-testing-or-dashboards.md)), so a silo is cheap to stand up
  locally, and that is the trap: local composability is not the cost. The cost is a clustering provider
  and its membership store in both production deployments, grain lifetimes and placement to reason
  about, a second serialization contract beside the integration-event schema
  ([ADR-010](010-integration-event-schema-versioning.md)), and a second answer to where state lives.
- **A hand-rolled in-memory per-entity lock or actor-like queue.** It is per replica, and both apps run
  more than one, so an in-process writer guarantee is not a guarantee, and it would silently weaken a
  correctness property the concurrency token holds across the fleet.
- **Adopting actors only for live polls.** The live path is the least durable state in the system and
  the most visible during the event, so its first production exercise would fall on the day itself.

## When to revisit
Revisit when **a real-time per-entity state workload appears that optimistic concurrency plus Redis
cannot carry**: an entity mutated by enough concurrent callers that the concurrency-token retry rate
becomes the bottleneck rather than an edge case, holding state that must be authoritative in memory
between mutations. The check is a retry rate and a write latency, not an opinion about the model.

When the trigger is met, **host Orleans per module behind the existing module contract, never as a
system-wide runtime**. A module already runs either in process or as its own service
([ADR-008](008-service-extraction-topology.md)) and its callers reach it through an interface its own
project declares ([ADR-059](059-module-contract-and-composition.md)), so a silo inside one module's
service is contained. An actor runtime beneath every module is the opposite decision, rejected here.

## Related
[ADR-007](007-grpc-extraction.md), [ADR-008](008-service-extraction-topology.md) and
[ADR-059](059-module-contract-and-composition.md) (the boundary a future silo would live behind),
[ADR-026](026-caching-strategy.md) and [ADR-077](077-hybridcache-substrate.md) (the caching tiers that
absorb the read pressure, and the in-process residency the system does buy),
[ADR-098](098-aspire-orchestration-not-testing-or-dashboards.md) (Aspire's scope, and why a silo being
easy to add locally is not an argument for one), [ADR-035](035-optimistic-concurrency.md) (the
row-version token that already provides the single-writer guarantee, across replicas),
[ADR-039](039-live-channel-push.md) and [ADR-121](121-ephemeral-in-process-work-queue.md) (the live
push channel, and the drain that carries its fan-out today).
