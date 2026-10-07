# ADR-009: Resilience Policies & Recovery Objectives

## Status
Accepted (2026-06-14). **Amended by [ADR-087](087-broker-poison-message-handling.md) (2026-08-18)**:
the resilience objective extends past outbound HTTP and gRPC clients for the first time, to the
outbox's broker publish, which gains a circuit breaker. The database posture is deliberately
unchanged and a per-query database breaker is recorded as rejected. See the Revision (2026-08-18)
below.

Revised 2026-09-11 (two amendments: the standard handler's runtime behaviour is observable for the
first time, through the `Polly` meter the Aspire defaults now subscribe
([ADR-041](041-observability-and-telemetry.md)); and `Smtp:TimeoutSeconds` bounds the framework's
SMTP client, which is not an `HttpClient`. See the Revision (2026-09-11) at the end.)

Revised 2026-09-19 (the consumer-side companion the 2026-09-11 revision described as intended but
absent is now in MMCA.Store's `main`: the Stripe leg has one retry owner. See the Revision
(2026-09-19) at the end.)

Revised 2026-10-01 (current-state sections realigned with the code; no decision change. See the
Revision (2026-10-01) at the end.)

Revised 2026-10-06: the DR-doc acceptance is described as written rather than signed off, the
example consumer and the drill-table mitigation now match MMCA.Store and the `dr-freshness` gates,
and the Stripe retry predicate also treats a client timeout as transient. See the Revision
(2026-10-06) at the end.

Revised 2026-10-07: anchors refreshed after the v1.233.0 release.

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
   `AddTypedServiceClient`) wires the **standard resilience handler**. `AddTypedServiceClient` takes
   the global HTTP defaults' timeouts, retry budget and sampling window from `HttpResilienceDefaults`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Messaging.cs:170-179`), and
   switches the retry off for POST and PATCH (`:177`), the same two verbs the Aspire defaults exclude.
   `AddTypedGrpcClient` reads `GrpcResilienceDefaults`
   (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:127-142`), which re-exposes
   those same timeouts and retry budget
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/GrpcResilienceDefaults.cs:15-24`) but states
   its own breaker shape (`:27-33`) and retries only a failure to reach the peer
   (`DependencyInjection.cs:137`). This is enforced by a fitness function
   (`ResilienceHandlerTests` in `MMCA.Common.Grpc.Tests`) so the policy cannot silently regress.
2. **Consumers must declare recovery objectives.** Each consuming app documents, in its own
   `infra/DISASTER-RECOVERY.md`: RTO/RPO per failure scenario, the backup/restore mechanism, and an
   **explicit, written** acceptance of single-region risk (or a multi-region failover plan).
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
cost/complexity at its scale. MMCA.Store, the other consumer, records the same objectives and the
same accepted single-region risk in its own DR doc (`MMCA.Store/infra/DISASTER-RECOVERY.md:10-15`).
A consumer with stricter availability needs would set tighter objectives and a failover plan in its
own DR doc: the framework does not mandate one set of numbers, only that the numbers exist and the
restore is drilled.

## Rationale
- **Invariant over discipline.** A fitness function turns "remember to add resilience" into a build
  gate: the same approach the framework already uses for the layer rules and the MassTransit-v8 pin.
- **Objectives belong to the deployer.** RTO/RPO depend on the data and the business, which the
  framework can't know; it can only require that consumers decide and record them.
- **Drilled, not assumed.** The single most common DR failure is discovering at 2 a.m. that the
  backups never restored. Forcing a recorded drill closes the §29 gap that documentation alone leaves.

## Trade-offs
- The named gate (`ResilienceHandlerTests`, `MMCA.Common.Grpc.Tests`) asserts every option the gRPC
  client path (`AddTypedGrpcClient`) configures
  (`MMCA.Common/Tests/Presentation/MMCA.Common.Grpc.Tests/ResilienceHandlerTests.cs:53-77`), pins the
  `GrpcResilienceDefaults` values (`:113-123`), ties its timeouts and retry budget to
  `HttpResilienceDefaults` (`:126-133`), and checks the retry predicate at runtime (`:81-96`). Choosing
  the values is still a review concern; a silent change to them is not. A separate fault-injection
  test (`ResilienceCircuitBreakerFaultInjectionTests`, same project) drives sustained failures and
  proves the circuit breaker actually trips and short-circuits. `AddTypedServiceClient` has its own
  registration test
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/TypedServiceClientRegistrationTests.cs:17-31`),
  asserting one retry and the 30-second attempt, 90-second total and 60-second sampling values, plus a
  theory proving the retry refuses a POST or PATCH replay (`:34-55`).
- Per-consumer DR docs can drift from reality. The drill-result table is hand-maintained and lags the
  drills (its last rows are 2026-08-10 in `MMCA.ADC/infra/DISASTER-RECOVERY.md:201` and 2026-07-28 in
  `MMCA.Store/infra/DISASTER-RECOVERY.md:212`), so it is not the operative mitigation: drill recency
  is enforced from `dr-drill.yml` run history by each consumer's `dr-freshness` deploy gate
  (`MMCA.ADC/.github/workflows/deploy.yml:830-839`, `MMCA.Store/.github/workflows/deploy.yml:788-796`).
- A gRPC client that needs bespoke timeouts must override the standard handler explicitly rather than
  opt out of resilience entirely: intentional friction.

## Revision (2026-08-18)
This record's first Decision point scoped resilience to "every outbound `HttpClient` and gRPC client
registered through the framework's extension methods". That scope was accurate and it was also the
whole story: no other dependency in the framework had a resilience policy of any kind. Two changes,
both recorded in full in [ADR-087](087-broker-poison-message-handling.md).

1. **The outbox's broker publish is now a resilience objective.** `OutboxProcessor` holds a Polly
   `ResiliencePipeline`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:101`,
   built at `:757-768`) and wraps exactly one call in it, the broker publish (`:598-602`); the
   in-process dispatch branch (`:604-607`) and every database call sit outside it by construction
   (`:89-92`). Its parameters live beside the HTTP ones as
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
   (`.../Persistence/DbContexts/SQLServerDbContext.cs:63-66`, five retries with a ten-second maximum
   delay, alongside `CommandTimeoutSeconds` at `:55`) already owns retrying at the persistence layer
   and constrains how a user-initiated transaction may be written (`:60-62`, restated at
   `.../Application/Interfaces/Infrastructure/Persistence/IUnitOfWork.cs:60-69`), which is why the strategy is
   materialized explicitly in `DbContextFactory` (`:525`). A Polly breaker wrapped around a call the
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

## Revision (2026-09-11)
Two amendments, both about parts of this posture the record could not previously see or reach.

**(a) The standard handler is now observable.** Decision point 1 makes the resilience handler an
invariant, and the Trade-offs note that the named gate asserts registration rather than runtime
behaviour. Until now the runtime behaviour was also invisible in production: the handler is wired for
every `HttpClient` and every gRPC typed client
(`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:83`, `:93`-`:98`, values from
`HttpResilienceDefaults`), but the meter Polly emits through was never subscribed, so a retry storm or
an open circuit left the process as nothing but latency. `AddServiceDefaults` now subscribes the
`Polly` meter (`Extensions.cs:596`, the literal at `:49`), which makes
`resilience.polly.strategy.events` (`:57`) the operational signal for this record's Decision:
`OnRetry`, `OnCircuitOpened`, `OnCircuitClosed` and `OnTimeout`, tagged by pipeline and strategy.
Polly's two duration histograms stay dropped unless a host sets
`Telemetry:EnablePollyDurationMetrics=true` (`:598`-`:610`), because they re-measure what the
HttpClient request duration already reports.
[ADR-041](041-observability-and-telemetry.md) carries the detail; what belongs here is that
"resilience is a framework invariant" is now checkable at runtime and not only at registration.

**(b) The one outbound client the handler does not cover is now bounded.** `SmtpEmailSender` builds a
`System.Net.Mail.SmtpClient` per send. It is not an `HttpClient`, so it never saw the standard handler
and it sat at the .NET default timeout of 100 seconds, which is longer than any caller in front of it
is willing to wait: a relay that accepts the TCP connection and then stops answering held a request
thread for the full 100 seconds, one per message in a notification burst. `SmtpSettings.TimeoutSeconds`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Mail/SmtpSettings.cs:59`, `[Range(1, 600)]` at
`:58`, default 30) is applied to the per-send client
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Mail/SmtpEmailSender.cs:107`). It is validated
with the rest of the `Smtp` section at startup
([ADR-070](070-fail-fast-configuration-contract.md)), so a zero or a typo is a startup failure rather
than either an instant abort or an unbounded wait. This is a bound, not a retry policy: redelivery
stays with the outbox and the notification pipeline.

**The consumer-side companion: one retry owner per outbound dependency.** The same reasoning reaches an
SDK-owned client in a consuming app, where the SDK ships its own retry loop and the consumer has
already built one. MMCA.Store's Stripe integration is the live example. `StripePaymentService` builds
an explicit Polly pipeline, a retry with exponential backoff over transient `StripeException` and raw
`HttpRequestException`, then a circuit breaker
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripePaymentService.cs:69`-`:95`,
attempts and delay from
`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripeSettings.cs:40`,
`:44`), while the SDK client underneath is constructed with nothing but the secret key
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripeClientFactory.cs:20`),
which leaves Stripe.net's own network retries and its own timeout at their defaults underneath a
pipeline that already retries. The intended shape is one retry owner: zero SDK retries and an explicit
SDK timeout, with Store's pipeline doing the retrying. That configuration is **not** in MMCA.Store's
`main` as this revision is written; the framework half, the meter and the SMTP bound, is what this
record can currently claim.

## Revision (2026-09-19)
That consumer-side companion is now in MMCA.Store's `main`. `StripeClientFactory` builds the SDK
client over an explicitly bounded HTTP stack instead of Stripe.net's defaults, and both halves the
2026-09-11 revision asked for are present: the `StripeClient` is given a `SystemNetHttpClient`
constructed with `maxNetworkRetries: 0`
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripeClientFactory.cs:48`-`:50`),
and the `HttpClient` underneath it carries an explicit
`Timeout` of `StripeSettings.RequestTimeoutSeconds` (`:43`-`:46`; the setting at
`.../Payments/Stripe/StripeSettings.cs:44`, `[Range(1, 120)]` at `:43`, default 30 seconds).
Both are required together: zero SDK retries on their own would still leave each attempt on the
SDK's own per-attempt budget, which the factory's own note records as 80 seconds (`:11`-`:18`).

`StripePaymentService`'s Polly pipeline, the retry with exponential backoff followed by the circuit
breaker (`.../Payments/Stripe/StripePaymentService.cs:69`-`:95`), is therefore the single retry
owner for this dependency, which is what Decision point 1 asks of a framework-registered client and
what an SDK-owned client has to be configured into by hand. The breaker also now counts what its
settings say it counts: one network attempt per recorded failure, rather than a call that had
already spent three attempts inside the SDK.

Unlike the framework-side half, this one has a unit gate rather than review alone:
`StripeClientFactoryTests.Create_BuildsAClientWhoseHttpClientPerformsNoRetriesOfItsOwn`
(`MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.Infrastructure.Tests/Services/StripeClientFactoryTests.cs:17`-`:25`)
asserts `MaxNetworkRetries` is 0 on the client the factory hands out, so a return to the SDK default
fails a test. The timeout value itself is not asserted, only bounded by configuration validation, so
the Trade-offs entry about parameters being a review concern still holds for it. This revision
changes nothing else: the Decision's three points, the reference objectives, and the database
posture recorded on 2026-08-18 all stand as written.

## Revision (2026-10-01)
No decision or rationale changes; the current-state sections are brought back in line with the code.
Decision point 1 no longer says the gRPC client matches the global HTTP defaults outright: it reads
`GrpcResilienceDefaults`
(`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:127-142`), which shares the
HTTP timeouts and retry budget
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/GrpcResilienceDefaults.cs:15-24`) but sets an
explicit breaker (a 0.5 failure ratio, a minimum throughput of 10 and a 10-second break, `:27-33`)
because an east-west call bypasses the Gateway's health checks, and retries only an
`HttpRequestException` (`DependencyInjection.cs:137`) because every gRPC call is a POST. The
Trade-offs entry about test coverage is corrected: `ResilienceHandlerTests` now asserts and pins the
policy values rather than registration alone
(`MMCA.Common/Tests/Presentation/MMCA.Common.Grpc.Tests/ResilienceHandlerTests.cs:53-133`), and
`AddTypedServiceClient` has its registration test
(`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Messaging/TypedServiceClientRegistrationTests.cs:15-28`).
The broker breaker also has a fault-injection test now, which the 2026-08-18 revision records as
absent
(`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Outbox/Processing/OutboxProcessorTests.cs:667`).
The Status line about SMTP no longer calls it the one framework outbound client outside the standard
handler: the optional AI provider adapters build SDK-owned clients, bounded by `Ai` timeout settings
(`MMCA.Common/Source/Core/MMCA.Common.AI.Anthropic/AnthropicAiProviderFactory.cs:37-48`,
`MMCA.Common/Source/Core/MMCA.Common.AI.OpenAI/OpenAiProviderFactory.cs:42-49`), with the SDKs' own
retry counts left at their defaults. Citations inside the earlier Revision sections are left as
recorded.

## Revision (2026-10-06)
No decision changes; the current-state sections are brought back in line with the code and the
consumer DR docs.

- Decision point 2 no longer calls the single-region acceptance "signed-off": both DR docs state it
  in writing (`MMCA.ADC/infra/DISASTER-RECOVERY.md:23`, `MMCA.Store/infra/DISASTER-RECOVERY.md:23`)
  but neither records an approver or a sign-off.
- The "24x7 store" example is replaced: MMCA.Store, the real second consumer, uses the same objectives
  and calls itself non-24x7-critical (`MMCA.Store/infra/DISASTER-RECOVERY.md:10-15`).
- The Trade-offs entry about DR-doc drift no longer names the drill-result table as the mitigation:
  both tables lag the drills, and recency is enforced by the `dr-freshness` deploy gate over
  `dr-drill.yml` run history.
- Decision point 1 records that `AddTypedServiceClient` disables the retry for POST and PATCH
  (`DependencyInjection.Messaging.cs:177`), and the Trade-offs entry records the theory that tests it.
- The Stripe pipeline the 2026-09-11 and 2026-09-19 revisions describe now also treats an
  `OperationCanceledException` as transient when the caller's token is not cancelled (an `HttpClient`
  timeout): retry and breaker share `IsTransientFailure`
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripePaymentService.cs:557-564`,
  the timeout arm at `:562`). The pipeline itself is at `:76-113`, and the attempts and delay come
  from `StripeSettings.cs:64` and `:68` (defaults 3 and 500 ms).
- Current locations of facts recorded in earlier revisions: the outbox broker pipeline field at
  `OutboxProcessor.cs:102`, built at `:698-709`, wrapping the publish at `:548-552` with the
  in-process branch at `:554-558`; the execution-strategy note at `IUnitOfWork.cs:47-52` and
  `ExecuteInTransactionAsync` at `:63-65`; `CreateExecutionStrategy()` at `DbContextFactory.cs:576`;
  the global handler at `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:49-62` inside
  `ConfigureHttpClientDefaults` (`:39-85`), which also reaches gRPC clients, with the gRPC-specific
  handler layered on top (`MMCA.Common/Source/Presentation/MMCA.Common.Grpc/DependencyInjection.cs:102-104`,
  `:127-142`); and the Polly meter wiring in `Extensions.Telemetry.cs` (meter name `:31`,
  `resilience.polly.strategy.events` `:52`, `AddMeter` `:322`, the duration-histogram opt-in
  `:332`, config key `:25`).
- Anchors in the live sections were re-verified against current source.

## Revision (2026-10-07)
Re-verified against current source. No decision, default or rationale changes: the outbox broker
breaker, the Stripe single-retry-owner pipeline, the Polly meter wiring and both consumers'
`dr-freshness` gates all behave as recorded. Only line positions moved, after the v1.233.0 release,
including several the 2026-10-06 revision listed as current.

1. Anchors re-verified against current source: the Trade-offs `dr-freshness` gates now at
   `MMCA.ADC/.github/workflows/deploy.yml:830-839` and `MMCA.Store/.github/workflows/deploy.yml:788-796`
   (both over `dr-drill.yml` with an 8-day window, `:838-839` and `:795-796`); the outbox broker
   pipeline field at
   `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Processing/OutboxProcessor.cs:105`,
   built by `BuildBrokerPublishPipeline` at `:868-879`, wrapping the broker publish at `:685-689` with
   the in-process dispatch branch outside it at `:691-695`, and `BrokenCircuitException` recognized in
   the ordinary failure path at `:554`; the broker breaker's fault-injection test at
   `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Outbox/Processing/OutboxProcessorTests.cs:665`;
   the Stripe pipeline at
   `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripePaymentService.cs:76-113`
   (retry `:77`, breaker `:94`, shared `IsTransientFailure` at `:557`), with `RetryMaxAttempts` and
   `RetryDelayMs` at `.../Payments/Stripe/StripeSettings.cs:64` and `:68` and `RequestTimeoutSeconds`
   at `:44`; and the Polly meter wiring in
   `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.Telemetry.cs` (meter name `:31`,
   `resilience.polly.strategy.events` `:52`, `AddMeter` `:322`, the duration-histogram opt-in `:332`,
   config key `:25`). Citations inside the earlier Revision sections are left as recorded.
