# ADR-009: Resilience Policies & Recovery Objectives

## Status
Accepted (2026-06-14). **Amended by [ADR-087](087-broker-poison-message-handling.md) (2026-08-18)**:
the resilience objective extends past outbound HTTP and gRPC clients for the first time, to the
outbox's broker publish, which gains a circuit breaker. The database posture is deliberately
unchanged and a per-query database breaker is recorded as rejected. See the Revision (2026-08-18)
below.

## Context
The framework already supplies the *mechanisms* for surviving partial failure: a standard Polly
resilience handler (timeout / retry / circuit breaker), the outbox for at-least-once delivery
(ADR-003), and database-per-service isolation (ADR-006). What was missing was a *stated contract*:

1. **No guaranteed coverage.** Resilience is applied per registration site (`AddTypedGrpcClient`,
   `AddTypedServiceClient`) plus a global `ConfigureHttpClientDefaults` default in `MMCA.Common.Aspire`.
   Nothing stopped a new outbound client from silently shipping with no retry/circuit-breaker.
2. **No recovery objectives.** Each consumer deploys its own databases, but RTO/RPO and the
   single-region-vs-failover decision were undocumented: "we'd figure it out" is not a plan, and an
   untested backup is not a backup (rubric §29).

## Decision
1. **Resilience is a framework invariant, not a per-call choice.** Every outbound `HttpClient` and
   gRPC client registered through the framework's extension methods (`AddTypedGrpcClient`,
   `AddTypedServiceClient`) wires the **standard resilience handler**, matching the global HTTP
   defaults in `MMCA.Common.Aspire`. This is enforced by a fitness function
   (`ResilienceHandlerTests` in `MMCA.Common.Grpc.Tests`) so the policy cannot silently regress.
2. **Consumers must declare recovery objectives.** Each consuming app documents, in its own
   `infra/DISASTER-RECOVERY.md`: RTO/RPO per failure scenario, the backup/restore mechanism, and an
   **explicit, signed-off** acceptance of single-region risk (or a multi-region failover plan).
   A restore must be *drilled*: the DR doc carries a drill-result table that cannot stay empty.
3. **Graceful degradation is the default posture.** When a synchronous dependency is unreachable,
   the resilience pipeline retries/breaks; cross-service consistency that can be deferred flows through
   the outbox (ADR-003), which buffers and guarantees eventual delivery after recovery.

### Reference objectives (MMCA.ADC: a regional, non-24×7 conference app)
| Scenario | RPO | RTO |
|---|---|---|
| Accidental data loss / bad migration (within retention) | ≤ ~10 min (continuous PITR) | ≤ 2 h |
| Single service DB corruption | ≤ ~10 min | ≤ 1 h (PITR restore-as-new, swap) |
| Full region loss | ≤ 1 h (geo-redundant backup) | ≤ 4 h (geo-restore + redeploy) |

ADC **deliberately accepts single-region risk**: sub-hour multi-region failover is not worth the
cost/complexity at its scale. A different consumer (e.g. a 24×7 store) is expected to set tighter
objectives and a failover plan in its own DR doc: the framework does not mandate one set of numbers,
only that the numbers exist and the restore is drilled.

## Rationale
- **Invariant over discipline.** A fitness function turns "remember to add resilience" into a build
  gate: the same approach the framework already uses for the layer rules and the MassTransit-v8 pin.
- **Objectives belong to the deployer.** RTO/RPO depend on the data and the business, which the
  framework can't know; it can only require that consumers decide and record them.
- **Drilled, not assumed.** The single most common DR failure is discovering at 2 a.m. that the
  backups never restored. Forcing a recorded drill closes the §29 gap that documentation alone leaves.

## Trade-offs
- The named gate (`ResilienceHandlerTests`, `MMCA.Common.Grpc.Tests`) asserts that the gRPC client path
  (`AddTypedGrpcClient`) *registers* the standard handler, not the runtime behavior of every policy
  parameter; parameter tuning is still a review concern. Runtime breaker behavior is no longer wholly
  untested, though: a separate fault-injection test (`ResilienceCircuitBreakerFaultInjectionTests`, same
  project) now drives sustained failures and proves the circuit breaker actually trips and short-circuits.
  `AddTypedServiceClient` wires the same standard handler but is not yet covered by an equivalent
  registration test.
- Per-consumer DR docs can drift from reality; the drill-result table is the mitigation (a stale table
  is a visible smell).
- A gRPC client that needs bespoke timeouts must override the standard handler explicitly rather than
  opt out of resilience entirely: intentional friction.

## Revision (2026-08-18)
This record's first Decision point scoped resilience to "every outbound `HttpClient` and gRPC client
registered through the framework's extension methods". That scope was accurate and it was also the
whole story: no other dependency in the framework had a resilience policy of any kind. Two changes,
both recorded in full in [ADR-087](087-broker-poison-message-handling.md).

1. **The outbox's broker publish is now a resilience objective.** `OutboxProcessor` holds a Polly
   `ResiliencePipeline`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/OutboxProcessor.cs:99`,
   built at `:755-766`) and wraps exactly one call in it, the broker publish (`:596-600`); the
   in-process dispatch branch (`:602-605`) and every database call sit outside it by construction
   (`:88-91`). Its parameters live beside the HTTP ones as
   `BrokerResilienceDefaults`
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/BrokerResilienceDefaults.cs:24`: a 0.5
   failure ratio over a 30-second sampling window, a minimum throughput of 10, and a 15-second break),
   which is the same shape `HttpResilienceDefaults` already had. It is a **breaker with no retry
   paired with it** (`:17-22`), because the outbox loop already is the retry, and
   `BrokenCircuitException` is fed into the ordinary failure path so a short-circuited publish
   re-leases and eventually dead-letters exactly like any other failed one. What it buys is failing in
   microseconds instead of a connection timeout during a broker outage, and one log line per batch
   instead of one per message.
2. **A per-query database circuit breaker was evaluated and rejected.** It is not a gap and it is not
   scheduled. EF Core's `EnableRetryOnFailure` execution strategy
   (`.../Persistence/DbContexts/SQLServerDbContext.cs:64-67`, five retries with a ten-second maximum
   delay, alongside `CommandTimeoutSeconds` at `:56`) already owns retrying at the persistence layer
   and constrains how a user-initiated transaction may be written (`:61-63`, restated at
   `.../Application/Interfaces/Infrastructure/IUnitOfWork.cs:63`), which is why the strategy is
   materialized explicitly in `DbContextFactory` (`:524`). A Polly breaker wrapped around a call the
   strategy is already retrying would either count one logical failure many times or force the
   strategy to be replaced, and replacing it is an EF execution-strategy rework rather than a
   resilience addition. **The EF retry strategy plus the command timeout remains the database
   resilience posture**, and the asymmetry with the broker leg is therefore a decision rather than an
   oversight.

The Decision's second and third points are untouched: consumers still declare RTO/RPO with a drilled
restore, and graceful degradation is still the default posture. The first point should now be read as
"every outbound client, plus the outbox broker publish". One thing this revision does **not** change
is the Trade-offs entry above about test coverage: the breaker's parameters are asserted nowhere, so
like the HTTP handler it is registration and review that carry them, and the broker breaker has no
equivalent of the gRPC fault-injection test.
