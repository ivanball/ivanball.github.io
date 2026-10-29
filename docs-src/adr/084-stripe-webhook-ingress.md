# ADR-084: Stripe Webhook Ingress (Acceptance-Coded Responses and Startup Self-Registration)

## Status
Accepted (2026-08-14). Revised 2026-09-03.
Revised 2026-09-07 (the webhook action carries its own request size limit, the auto-minted signing
secret is shared through the distributed cache, cancelling a payable order expires the provider
session, and reconciliation sweeps stranded unpaid orders).
Revised 2026-10-01 (current-state sections re-anchored and the shared signing secret described).
Revised 2026-10-06: the minted signing secret is never printed (an operator reveals it in the Stripe Dashboard), and the paid-order short-circuit covers every status past `Paid`.
Revised 2026-10-07: anchors refreshed after the v1.233.0 release.
Revised 2026-10-21: webhook verification accepts either the runtime or the configured signing secret, and the startup reconcile runs under an ADR-108 distributed lock so, with Redis present as in production, one replica mints at a time.
Revised 2026-10-26: anchors refreshed after the Store Sales, Gateway and `main.bicep` edits and the Common edge rate-limiting kit changes since 2026-10-21.
Revised 2026-10-28: anchors refreshed after the Store Sales, Gateway and `main.bicep` edits and the Common caching registration changes since 2026-10-26.
## Context
Four ADRs already cover how a message crosses a boundary in this workspace. ADR-003 decides how an
event leaves a service (outbox, at-least-once). ADR-021 decides how a redelivered broker message is
recognized on the way in (consumer inbox). ADR-017 decides how a retried HTTP client request is
deduped at the inbound edge (`Idempotency-Key`). ADR-054 decides what happens when a message that was
supposed to arrive never does (a reconciliation sweep). None of them decides the case Store Sales
actually runs in production: **an inbound call from a third party we do not control**.

Stripe is that caller, and it fits none of the existing shapes. It cannot authenticate as an
application user (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/PaymentsController.cs:16-17`),
so the endpoint has to be anonymous. It does not send an `Idempotency-Key`, so ADR-017 does not apply,
and the endpoint states that exemption in code with `[NonIdempotent(...)]` from
`MMCA.Common.API.Idempotency` (`PaymentsController.cs:58-65`, attribute at
`MMCA.Common/Source/Presentation/MMCA.Common.API/Idempotency/NonIdempotentAttribute.cs:23`): its
justification names both the absent header and why caching a 200 would be wrong here, since the status
code is the retry signal. It does not go through the broker, so ADR-021's inbox never sees it. And it
treats the HTTP status code as a **delivery protocol**, not as an application result: a non-2xx response makes Stripe retry
the event and, if failures persist, disable the endpoint entirely, which silently stops every payment
status update for the whole store.

Two production incidents shaped this, and both are recorded in the source. Rejections were logged at
`Warning` for weeks while the configured signing secret did not match the live endpoint, so 100% of
deliveries returned 400 and nothing surfaced it (`PaymentsController.cs:105-110`). Separately, between
2026-06-12 and 2026-07-30 a disabled-but-still-present endpoint caused a second endpoint to be created
at the same URL with a brand-new signing secret, invalidating the configured one; 507 deliveries failed
in the final week alone (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripeWebhookRegistrationService.cs:205-213`).
Both were failures of the *ingress contract*, not of payment logic.

## Decision
Treat third-party webhook ingress as its own contract with two halves: **an acceptance-coded endpoint**
and **a self-registering, self-provisioning endpoint registration at startup**.

- **One anonymous, raw-body endpoint.** `POST /Payments/webhook` is `[AllowAnonymous]`
  (`PaymentsController.cs:57,66`). The body is read straight off `HttpContext.Request.Body` with S6932
  suppressed, because signature verification needs the unmodified payload and model binding would
  destroy it (`PaymentsController.cs:83-87`); the `Stripe-Signature` header is read alongside it
  (`:86`). The Gateway forwards `/Payments/{**catch-all}` to Sales over plain HTTP/1.1: the route is
  declared in the Gateway's `ReverseProxy` configuration rather than in code
  ([ADR-089](089-gateway-topology-owned-by-configuration.md)), as the `sales-payments` route
  (`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json:139-143`) on a `sales` cluster that
  carries no `HttpRequest` block at all, so `Version` and `VersionPolicy` stay unset
  (`appsettings.json:164-168`), unlike `catalog` (`:146-154`) and `identity` (`:155-163`) which pin
  `Version` 2 with `RequestVersionExact` (`:148-149`, `:157-158`); the reasoning is at
  `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:131-140`, which also notes that the shared
  cluster default deliberately carries no version pair so it can never reach the sales cluster and
  downgrade the webhook path. That is why Sales keeps the ADR-012 mixed-endpoint profile: its
  container app's ingress stays `transport: 'http'` for REST plus this webhook
  (`MMCA.Store/infra/main.bicep:1840`), with a TCP-passthrough `additionalPortMappings` entry carrying
  the h2c gRPC port alongside it (`:1847-1853`).
- **The status code encodes ACCEPTED, not PROCESSED.** Five error codes return 400, held in a
  `FrozenSet` named `RejectionCodes`: `SignatureVerificationFailed`, `ParseFailed`, `SecretMissing`,
  `PayloadMissing` and `SignatureMissing` (`PaymentsController.cs:39-46`, defined at
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/Interfaces/IPaymentService.cs:50,53,56,62,68`).
  The last two are **shape rejections raised one stage ahead of the handler**:
  `ProcessPaymentWebhookCommandValidator` refuses a delivery that arrived with no body or no
  `Stripe-Signature` header and tags each rule with the matching code
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/ProcessPaymentWebhook/ProcessPaymentWebhookCommandValidator.cs:28-36`),
  so the Validating decorator short-circuits before any verification runs. Shape only is the point:
  authenticity is still decided by the provider signature check, and no validation rule stands in for
  it (`ProcessPaymentWebhookCommandValidator.cs:10-16`). They belong in the rejection set for the same
  reason the parse failures do: nothing was verified, so answering 200 would report a delivery as
  accepted that never was and would suppress the retry a genuinely broken caller still needs. Outside
  the set, a body-less or signature-less delivery gets a silent 200 instead of the 400 the caller has
  to see (`PaymentsController.cs:31-38`).
  Everything past acceptance returns 200, **including an order that cannot be found**, because
  retrying those would fail identically forever (`PaymentsController.cs:48-56,100-116,118`).
- **Verification and parsing are separate steps, so the three provider-side reasons stay distinguishable.**
  `ParseWebhookEvent`
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripePaymentService.cs:332`)
  verifies the signature first (`:357`, `EventUtility.ValidateSignature` at `:644`) and returns
  `SignatureVerificationFailed` when it fails (`:357-367`), then runs `EventUtility.ParseEvent` with
  `throwOnApiVersionMismatch: false`, so an account whose API version rolled ahead of the pinned
  library does not reject a correctly signed event (`:371-374`). A missing secret is named as its own
  deployment gap rather than reported as a bad signature (`:344-355`). The method's remarks record
  why one combined `ConstructEvent` call is not used: it reports an API-version mismatch or an
  unparseable body as a signature failure (`:315-321`), and the controller names the missing secret
  as the third cause that read the same way (`PaymentsController.cs:95-98`).
- **A rejection logs at `Critical`, everything else at `Warning`.** `LogWebhookRejected` is a
  source-generated `Critical` message that names the code, the message, and the operational
  consequence (`PaymentsController.cs:111,122-126`). `Critical` is deliberate: it clears the production
  Azure Monitor log floor (`Logging__OpenTelemetry__LogLevel__Default=Warning`) with room to spare
  (`:109-110`). A post-acceptance failure logs `Warning` and still returns 200 (`:115,118`).
- **Processing idempotency lives in the handler, not in the transport.** Exactly two event types move
  an order: `checkout.session.completed` pays it and `checkout.session.expired` fails it, while
  `payment_intent.payment_failed` is recorded and nothing else
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/ProcessPaymentWebhook/ProcessPaymentWebhookHandler.cs:16-18,26-28,39-45,63-70`).
  An order that is `Paid` or later (`Paid`, `Shipped` or `Delivered`) short-circuits to success
  (`:84-88`), logging for a refund when the event carries a different payment intent than the one
  stored (`:80-83,86,120-130`), as does an already-failed or cancelled one (`:156-160`), and
  two contradictory transitions log an anomaly instead of erroring: a success for a cancelled or
  failed order (`:90-95`) and an expiry for a `Paid` order (`:162-167`), messages at `:196-197` and
  `:205-206`. The failure-side guard covers only `Paid`, so an expiry for a `Shipped` or `Delivered`
  order reaches `MarkAsPaymentFailed` and its refusal is returned as a failure with no anomaly log
  (`:169-171`).
  A completed session is not by itself proof of payment:
  unless `PaymentProof.IsPaymentForOrder` confirms a paid session for this order's total and currency,
  the event is acknowledged with success and the order is left unchanged for an operator (`:97-104`).
  Unhandled event types return success (`:44`). The command is deliberately **not** `ITransactional`
  (`ProcessPaymentWebhookCommand.cs:8-17`).
- **The provider-side endpoint registers itself at startup.** `StripeWebhookRegistrationService` is a
  `BackgroundService` (`StripeWebhookRegistrationService.cs:47-54`) registered by
  `AddModuleSalesInfrastructure`
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/DependencyInjection.cs:47`). It
  skips entirely when `WebhookBaseUrl` is empty, which is the local-development path where the Stripe
  CLI forwards instead (`:94-98`), and skips with a `Warning` when `SecretKey` is empty (`:100-104`).
  The expected URL is `WebhookBaseUrl` plus the constant `/Payments/webhook` (`:56,130`); production
  injects `Stripe__WebhookBaseUrl` as the Gateway FQDN (`main.bicep:1948`), so the registered endpoint
  is the Gateway route above. It subscribes exactly three event types (`:78-83`), and warns when an
  existing endpoint is missing any of them (`:325-335`).
- **One replica reconciles at a time.** Listing, deleting and creating endpoints is check-then-act on
  Stripe's state, so two replicas booting together with no shared secret could each mint a different
  secret. The reconcile therefore runs under the `IDistributedLock` primitive of
  [ADR-108](108-distributed-lock-primitive.md) (`:37-45,52`), keyed `stripe:webhook-registration:`
  plus the expected URL (`:143-145,248`), with a 2-minute time to live as a crash guard (`:69`) and a
  30-second wait (`:76`). Once the lock is held the shared store is read again, so a replica that
  waited behind a sibling's mint adopts that secret instead of minting another (`:160`). A replica
  that cannot take the lock within the wait reads the shared store once more, logs
  `LogRegistrationNotClaimed` and leaves Stripe alone (`:147-155`, declared at `:357-358`). The lock
  spans replicas only when Redis is present: Common registers `RedisDistributedLock` when an
  `IConnectionMultiplexer` is registered and a process-local `InProcessDistributedLock` otherwise
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:98-118`).
  Production Sales is given `ConnectionStrings__redis` (`MMCA.Store/infra/main.bicep:1910`); without
  it, two replicas booting together can still each mint.
- **It deletes only endpoints it created itself.** Every auto-created endpoint carries the description
  prefix `Auto-registered by MMCA` (`:63,225-229`). `IsStaleAutoRegistered` returns `false` for any
  endpoint without that prefix, so an operator-created endpoint is never touched (`:282-286`), and
  `true` for an auto-registered one whose URL no longer matches or whose status is not `enabled`
  (`:288-289`), which is what collapses the disabled same-URL duplicate that caused the 2026 incident
  (`:265-279`). Cleanup is best-effort and per-endpoint isolated: a failed delete is logged and never
  aborts the others or the reconcile (`:170-175,298-323`, per-endpoint `try`/`catch` at `:310-321`).
- **The signing secret is minted once, shared across replicas, and never printed.**
  Before anything else the service adopts a secret already minted for the same URL from the shared
  `IStripeWebhookSecretStore` (`:139`, implemented at `:254-263`). Stripe returns a signing secret
  only at creation time (`:235-241`), so the created value is written first to that shared store
  (`:242`) and then to the singleton `StripeWebhookSecretProvider` (`:243`), a volatile-backed holder
  (`StripeWebhookSecretProvider.cs:17-27`). On every incoming event `StripePaymentService` builds its
  candidate secrets from the runtime value and then the configured `Stripe:WebhookSecret`, keeping
  the non-empty, distinct ones (`StripePaymentService.cs:336-342`), and accepts the signature when
  EITHER candidate validates (`:357`, loop at `:633-655`); `SecretMissing` is returned only when both
  are empty (`:344`). The creation is announced at `Critical` with the endpoint id only
  (`StripeWebhookRegistrationService.cs:245,368-369`), and that message tells the operator to reveal
  the endpoint's signing secret in the Stripe Dashboard and save it in `Stripe:WebhookSecret`; the
  secret itself is never written to a log or a console stream (`:21-25,240-241`). When a secret is
  *already* configured and a new endpoint still has to be created, a second `Critical` states that the
  configured value is now provably stale (`:214-217,380-381`).
- **An existing enabled endpoint plus a known secret is trusted without validation.** When either the
  adopted shared secret or a configured secret is present (`:186`), that path only verifies event
  types and returns (`:181-191`), and its log deliberately does not say "verified", because Stripe
  never re-reveals a secret and a stale one is undetectable here: it surfaces only as the `Critical`
  rejection on the first delivery (`:347-352`). When the endpoint exists but no secret is known
  anywhere, the endpoint is deleted and recreated to obtain a fresh one (`:193-200`).

Adoption is **Store Sales only**. It is the workspace's single inbound third-party webhook, and nothing
in this decision has been generalized into MMCA.Common; recording a single-application pattern as an ADR
follows the ADR-072 precedent (a decision that is ADC-only). The two halves are covered by unit tests
that pin the contract rather than the implementation: the controller's accept-versus-reject mapping in
four test methods covering five cases, including a `[Theory]` over both shape rejections
(`MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.API.Tests/Controllers/PaymentsControllerTests.cs:33,42,56-59,67`),
plus a fifth method that pins the action's request size limit (`:82-83`),
and the deletion predicate in five, including the operator-created endpoint that must never be stale
(`MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.Infrastructure.Tests/Services/StripeWebhookRegistrationServiceTests.cs:302,310,324,334,347`).
Three more methods in that class pin the shared-secret and lock contract: the shared secret is adopted
ahead of the configured one (`:183`), a replica that does not acquire the lock makes no Stripe call
(`:221`), and a secret shared by the time the lock is held creates no new endpoint (`:260`).

## Rationale
- **The caller's protocol decides the response vocabulary.** Stripe reads a status code as "keep
  retrying" or "stop", not as "this succeeded" or "this failed". Mapping every application failure to
  400 would be locally honest and globally catastrophic: it costs the endpoint, and with it every
  payment status update. Encoding acceptance is the only mapping that keeps the caller's retry machine
  pointed at the cases a retry can actually fix.
- **Three named rejection reasons beat one.** A tampered payload, an unparseable body and a missing
  signing secret need three different responses from a human, and the collapsed version sent on-call
  after the wrong thing (`StripePaymentService.cs:315-321`, `PaymentsController.cs:95-98`).
- **`Critical` is the level this environment can see.** The production log floor is `Warning`
  (`PaymentsController.cs:109-110`), and a total payment-status outage that logs at `Warning` is
  indistinguishable from noise: that is exactly how it went unnoticed for weeks.
- **Self-registration removes a manual step the platform keeps invalidating.** The public URL is a
  Container Apps default domain, so it changes on a region move; a hand-registered endpoint drifts and
  a dead one keeps firing failing-webhook alerts (`StripeWebhookRegistrationService.cs:170-173`).
- **Marker-scoped deletion is what makes automated deletion acceptable.** The service is allowed to
  delete only endpoints it can prove it created, so the worst case of a buggy predicate is a
  re-registration, never the removal of an operator's endpoint (`:277-278,282-286`).
- **The runtime secret provider keeps the very first boot working.** Without it, an auto-created
  endpoint would reject every delivery until a human copied the secret into configuration and
  redeployed (`:235-243`, `StripePaymentService.cs:336-342`).
- **Accepting either candidate secret keeps an operator's roll from breaking delivery.** The shared
  entry outranks configuration only for a secret this service minted, and it lives 365 days, so after
  an operator rolls the signing secret in Stripe or re-creates the endpoint by hand and updates the
  configuration, the adopted value is stale while the configured one is current. Trying both keeps
  deliveries verifying through that window, and widens nothing, since each candidate is a secret this
  deployment trusts (`StripePaymentService.cs:322-330`).
- **The lock makes the shared secret hold under a simultaneous scale-out.** Sharing the minted secret
  only helps a replica that reads it after the mint; two replicas reconciling at once could both mint.
  Serializing the reconcile and re-reading the store under the lock turns the second replica into an
  adopter (`StripeWebhookRegistrationService.cs:37-45,157-160`), provided the lock is the Redis one
  (`DependencyInjection.Caching.cs:98-118`) and the holder publishes within the 30-second wait
  (`StripeWebhookRegistrationService.cs:76`).

## Trade-offs
- **A startup service that writes to a live third-party account.** Booting a Sales replica creates and
  deletes webhook endpoints in the real Stripe account (`StripeWebhookRegistrationService.cs:199-200,232-233,313-314`).
  The blast radius is bounded by the description marker and by the `WebhookBaseUrl`/`SecretKey` guards
  (`:94-104`), but this is still automated mutation of an external system at boot, and a
  misconfigured `WebhookBaseUrl` registers a wrong endpoint rather than failing.
- **A replica that loses the lock race does not reconcile.** It adopts whatever the shared store holds
  and leaves Stripe alone (`:147-155`), so if the holder fails mid-reconcile, the endpoint is checked
  again only on a later start; the 2-minute time to live bounds how long a dead holder blocks the key
  (`:65-69`). Nor does it look at the shared store again: the store is read only during
  registration (`:139,152,160`), and verification reads only the in-process provider and the
  configured value (`StripePaymentService.cs:336-342`). A replica that gives up before the holder
  publishes (the holder outlasts the 30-second wait at `:76`, or crashes) therefore runs on the
  configured value alone until it restarts, answering `SecretMissing` when that value is empty
  (`StripePaymentService.cs:344`) or rejecting signatures when it is stale.
- **Persisting a minted secret takes an operator trip to the Stripe Dashboard.** The secret is never
  written to a log or a console stream, because container stdout and stderr land in Log Analytics
  (`:21-25`); the `Critical` creation log names only the endpoint id and tells the operator to reveal
  that endpoint's secret in the Dashboard (`:368`). Zero-touch provisioning still holds for the
  running deployment through the shared store and the runtime provider: a replica already running
  keeps its in-memory secret (`StripeWebhookSecretProvider.cs:19`), and a restart with an empty
  configured value and no shared entry deletes the endpoint and mints again
  (`StripeWebhookRegistrationService.cs:193-200,232-243`). The lasting gap is a stale configured
  value: until a human saves the revealed value into `Stripe:WebhookSecret`, a restart whose shared
  entry is gone takes the trusted path on that stale value (`:186`) and rejects every delivery.
- **A stale shared entry is tolerated, not evicted.** After an operator rolls the secret or
  re-creates the endpoint by hand, the shared entry can hold a superseded secret for up to its 365-day
  lifetime; verification still succeeds against the configured value because either candidate is
  accepted (`StripePaymentService.cs:322-330,357`). Nothing removes the stale entry automatically: the
  `Critical` rejection log tells the operator that both candidates were tried and to evict the shared
  entry and restart when the configured value is right
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/PaymentsController.cs:125`). The
  registration service still adopts the stale shared value as its runtime secret at startup
  (`StripeWebhookRegistrationService.cs:254-263`).
- **200 hides processing failures from Stripe by design.** A post-acceptance failure is invisible in
  the Stripe dashboard's delivery view, so it has to surface through our own telemetry: the `Warning`
  log (`PaymentsController.cs:115`) and, for an order left stuck because no webhook ever completed the
  work, the ADR-054 reconciliation sweep (`PaymentReconciliationService`,
  `DependencyInjection.cs:48-50`). The 200 for a post-acceptance failure is itself pinned by test
  (`PaymentsControllerTests.cs:67-74`).
- **A configured secret is trusted, never validated.** A stale `Stripe:WebhookSecret` cannot be
  detected at startup and is discovered only on the first rejected delivery
  (`StripeWebhookRegistrationService.cs:347-352`). This is a
  provider constraint (the secret is never re-revealed), not a choice, but it means startup can log a
  reassuring "endpoint found" line while the deployment is already broken.
- **Losing the shared secret costs one re-mint.** A restart adopts the shared secret and takes the
  trusted path (`StripeWebhookRegistrationService.cs:139,186`), so it does not mint again. The
  no-secret path deletes and recreates the endpoint to mint a fresh one (`:193-200`) only when the
  shared entry is gone: a cache flush or replacement, or the 365-day entry lifetime
  (`SharedCacheStripeWebhookSecretStore.cs:25-30,54`). With no distributed cache configured, the
  in-memory fallback degrades to per-process behavior (`:30-32`), so a restart there mints a new
  secret that supersedes the previous one until a human saves a value into configuration.
- **The endpoint is anonymous, internet-reachable and exempt from the edge rate limiter.** Signature
  verification is the only authentication (`StripePaymentService.cs:332-367`); an unsigned or wrongly
  signed request reaches the handler pipeline before it is rejected, and each rejection emits a
  `Critical` log, so a hostile caller can generate `Critical` volume. Nothing meters that at the
  Gateway: `GatewayRateLimiting.BypassPathPrefixes` lists `/Payments`
  (`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json:16-21`), which exempts the whole
  prefix from both edge limiters, the per-client-IP fixed window and the replica-wide concurrency
  ceiling
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Gateway/GatewayRateLimitingExtensions.cs:87-113,205-208,233-236,246-253,271-278,330-337`).
  The exemption is deliberate and stated where the kit is wired up
  (`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:88-96`): a 429 is a non-2xx, so throttling
  Stripe buys the retry storm and the disabled endpoint this whole ADR exists to avoid. The price is
  that the rejection-log amplification path is bounded only by the caller's own sending rate.
- **Single-module adoption.** None of this lives in MMCA.Common, so a second inbound webhook (in this
  or another repo) starts from a copy of `PaymentsController` and `StripeWebhookRegistrationService`
  rather than from a framework contract.

## Revision (2026-09-07)
Four changes from the 2026-09-07 security review. The ingress contract (raw body, signature verified
before parsing, anonymous endpoint) is unchanged.

1. **The webhook action bounds its own request body** (SEC-Store-15). Signature verification requires
   buffering the whole body before anything is known about the caller, on an anonymous endpoint, in a
   service that runs at 0.5 GiB. `[RequestSizeLimit(1_000_000)]`
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/PaymentsController.cs:76`) is
   enforced by Kestrel at the transport layer (`:72`), so an oversized body is rejected before it is
   read rather than after.
2. **The auto-minted signing secret is shared across replicas** (SEC-Store-35).
   `SharedCacheStripeWebhookSecretStore`
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/SharedCacheStripeWebhookSecretStore.cs:37`)
   keeps the secret under `stripe:webhook-signing-secret:` plus the endpoint URL (`:46`, read at
   `:57`, written at `:75`). Held in one replica's memory, a scaled-out Sales rejected every event
   that landed on a replica which had not minted it. The endpoint URL is part of the key so a public
   URL change does not read a stale secret. The rationale for the cache over the database or Key
   Vault is recorded on the type (`:13-19`): the app identity holds only get and list on Key Vault,
   so it cannot write there.
3. **Cancelling a payable order expires the provider session** (SEC-Store-34). `CancelOrderHandler`
   acts only on an order that is `PaymentInitiated` and carries a session id
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/Cancel/CancelOrderHandler.cs:92`).
   If the provider says the session is already paid, the cancel is refused with
   `OrderCancellationErrorCodes.PaymentAlreadyCompleted` (`:101-105`; constant at
   `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/Cancel/OrderCancellationErrorCodes.cs:18`)
   rather than cancelling an order the customer has paid for. Otherwise it expires the hosted session
   (`:116`), because a cancelled order whose checkout page stays payable takes money for something
   nothing will fulfil. A failure to read or expire is logged with the manual-refund consequence
   spelled out (`:140`, `:145`) and does not block the cancel.
4. **Reconciliation sweeps stranded unpaid orders** (SEC-Store-61). Beside the existing class of
   `PaymentInitiated` orders it asks the provider about, the service now takes `PendingPayment` and
   `PaymentFailed` orders older than `StuckAgeMinutes` (default 30,
   `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Reconciliation/PaymentReconciliationSettings.cs:42`)
   straight to `Cancelled`
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Reconciliation/PaymentReconciliationService.cs:28-36`).
   It asks the provider nothing for this class, because a `PendingPayment` order may have no session
   at all. `Cancelled` rather than `PaymentFailed` is deliberate: `PaymentFailed` is retryable, and
   only `Cancelled` is the terminal state the `OrderCancelled` compensation listens on to return the
   committed stock (`:37-42`). Checkout commits stock, so without this an abandoned checkout held
   inventory forever and repeating it was a denial-of-service on availability.

## Revision (2026-10-01)
The ingress contract (acceptance-coded status codes, anonymous raw-body endpoint, startup
self-registration with marker-scoped deletion) is unchanged. This revision brings the current-state
sections in line with the code:

1. **The Decision now describes the shared signing secret it already uses.** The bullet that said the
   minted secret is "held in memory" now states that the service first adopts the secret shared for
   the same URL (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripeWebhookRegistrationService.cs:101-106`),
   writes a newly minted one to the shared store before the in-process provider (`:187-188`), and
   trusts an existing endpoint when either secret is known (`:132`).
2. **Two trade-offs were restated.** The `Critical` creation log carries only the endpoint id; the raw
   secret goes to stderr alone (`:190-193,293`). The restart loop that re-minted a secret on every
   boot now happens only after the shared entry is lost or expires, or when no distributed cache is
   configured
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/SharedCacheStripeWebhookSecretStore.cs:25-32,54`).
3. **Two handler behaviors are now recorded.** A completed session that `PaymentProof` does not
   confirm as payment of the order is acknowledged and left for an operator, and a second payment
   intent on a `Paid` order is logged for a refund
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/ProcessPaymentWebhook/ProcessPaymentWebhookHandler.cs:84-91,100-107,123-133`).
4. **The stranded-unpaid sweep from the 2026-09-07 revision is now a backstop.** Each order arms its
   own `Sales.ExpireUnpaidOrder` internal command at checkout, and the reconciliation class two covers
   only the cases that command cannot
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Reconciliation/PaymentReconciliationService.cs:52-60`).

All other `path:line` citations in Context, Decision, Rationale and Trade-offs were re-anchored to
the current `PaymentsController`, `IPaymentService`, `StripePaymentService`,
`StripeWebhookRegistrationService`, `DependencyInjection`, the Gateway `appsettings.json`,
`main.bicep`, `GatewayRateLimitingExtensions` and the two test classes.

## Revision (2026-10-06)
The ingress contract is unchanged. Corrections to the current-state sections:

1. **The minted signing secret is never printed.** The Decision and Trade-offs no longer say the raw
   secret goes to stderr (item 2 of the 2026-10-01 revision is superseded on this point). The
   `Critical` creation log names only the endpoint id and tells the operator to reveal the secret in
   the Stripe Dashboard
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripeWebhookRegistrationService.cs:205,308`),
   and the type states that the secret is never written to a log or a console stream (`:21-24`). The
   stderr trade-off was replaced by the Dashboard step it now costs.
2. **The paid-order short-circuit covers every status past `Paid`.** `Shipped` and `Delivered` are
   acknowledged the same way as `Paid`, including the refund log for a different payment intent
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/ProcessPaymentWebhook/ProcessPaymentWebhookHandler.cs:84-92`).
   The failure side is narrower: only a `Paid` order on the expiry path logs an anomaly (`:168-173`);
   a `Shipped` or `Delivered` one returns the `MarkAsPaymentFailed` refusal as a failure (`:175-177`).
3. **The controller test class has a fifth method** that pins the request size limit
   (`PaymentsControllerTests.cs:82-83`); the accept-versus-reject mapping is still four methods.
4. **The 2026-09-07 cancel behavior now lives in one helper.** The guard, the
   `PaymentAlreadyCompleted` refusal and the expiry with its failure logs are in
   `CancelOrderHandler.RetirePaymentSessionAsync`
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/Cancel/CancelOrderHandler.cs:104-140`:
   refusal `:126-132`, expiry through `PaymentSessionRetirement.RetireAsync` at `:116`, failure logs
   `:121,136`).

All `path:line` citations in Status, Context, Decision, Rationale and Trade-offs were re-verified
against current source and re-anchored where they had moved.

## Revision (2026-10-07)
Re-verified against current source. The ingress contract, the Decision, the Rationale and the
Trade-offs are unchanged, and their citations still hold. Only anchors inside the earlier dated
revisions have moved; those revisions stay as written, and the current locations are recorded here.

1. Anchors re-verified against current source:
   - The 2026-09-07 item 3 cancel behavior: the guard is at
     `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/Cancel/CancelOrderHandler.cs:106`
     inside `RetirePaymentSessionAsync` (`:104-140`), the expiry runs through
     `PaymentSessionRetirement.RetireAsync` (`:116`), the `PaymentAlreadyCompleted` refusal is at
     `:126-132`, and the read and expire failure logs are at `:121` and `:136`; the constant is
     still at `OrderCancellationErrorCodes.cs:18`.
   - The 2026-09-07 item 4 default: `StuckAgeMinutes` defaults to 30 at
     `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Reconciliation/PaymentReconciliationSettings.cs:48`
     (range `[Range(5, 10080)]` at `:47`); the class-two description is at
     `PaymentReconciliationService.cs:29-41` and the Cancelled-over-PaymentFailed reasoning at
     `:43-50`.
   - The 2026-10-01 items 1 to 3: in
     `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripeWebhookRegistrationService.cs`
     the shared-secret adoption is at `:115-120`, the shared-store write and then the provider
     assignment at `:202-203`, the creation log call and declaration at `:205,308-309`, and the
     existing-endpoint trust check at `:146`; in `ProcessPaymentWebhookHandler.cs` the paid
     short-circuit is at `:84-92`, the `PaymentProof` check at `:101-108` and the refund log for a
     different payment intent at `:124-134`.

## Revision (2026-10-21)
Re-verified against current source. The ingress contract (acceptance-coded status codes, anonymous
raw-body endpoint, verification before parsing, marker-scoped deletion) is unchanged. Two behaviors
moved since the 2026-10-07 revision, which therefore no longer describes the current state: webhook
verification accepts either candidate secret, and the startup reconcile runs under a distributed lock.

1. **Verification accepts either candidate secret** (M249). The Decision and Rationale no longer say
   `StripePaymentService` prefers the runtime secret over the configured one. It builds the non-empty,
   distinct candidates from the runtime value and then `Stripe:WebhookSecret`
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripePaymentService.cs:324-330`),
   accepts the signature when either validates (`:345`, `:597-619`), and reports `SecretMissing` only
   when both are empty (`:332`); the reasoning (a 365-day shared entry outliving an operator's roll or
   re-create) is at `:311-317`. A Rationale bullet and a stale-shared-entry trade-off were added, the
   latter citing the rejection log that now tells the operator to evict the stale cache entry
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/PaymentsController.cs:125`).
2. **The startup reconcile is serialized across replicas** ([ADR-108](108-distributed-lock-primitive.md)).
   `StripeWebhookRegistrationService` takes an `IDistributedLock`
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripeWebhookRegistrationService.cs:52`)
   keyed on the expected URL (`:143-145,248`), with a 2-minute time to live (`:69`) and a 30-second
   wait (`:76`), re-reads the shared store under the lock (`:160`), and on a lost race adopts the
   shared secret and leaves Stripe alone (`:147-155`). The lock spans replicas only when Redis is
   registered; otherwise it is process-local
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs:88-101`), and
   production Sales is given `ConnectionStrings__redis` (`MMCA.Store/infra/main.bicep:1903`). A
   Decision bullet, a Rationale bullet, a trade-off (including that a replica giving up the wait
   does not read the shared store again) and the ADR-108 entry in Related were added.
3. **The registration tests cover the new contract.** Besides the five deletion-predicate methods,
   three methods pin shared-secret adoption and the lock
   (`MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.Infrastructure.Tests/Services/StripeWebhookRegistrationServiceTests.cs:183,221,260`).
4. Anchors re-verified against current source:
   - `main.bicep`: Sales ingress `transport: 'http'` at `MMCA.Store/infra/main.bicep:1833`,
     `additionalPortMappings` at `:1840-1846`, `Stripe__WebhookBaseUrl` at `:1941`.
   - `StripePaymentService.cs`: `ParseWebhookEvent` at `:320`, the collapsed-call note at
     `:303-309`, the missing-secret branch at `:332-343`, the signature-failure return at `:345-355`,
     `ParseEvent` with `throwOnApiVersionMismatch: false` at `:362`.
   - `StripeWebhookRegistrationService.cs`: class at `:47-54`, `WebhookPath` at `:56`, marker at
     `:63`, event types at `:78-83`, skips at `:94-98` and `:100-104`, expected URL at `:130`, first
     adoption at `:139` (implemented at `:254-263`), existing-endpoint trust check at `:186` (block
     `:181-191`), recreate at `:193-200`, stale-configuration `Critical` at `:214-217` (declared at
     `:380-381`), create call at `:232-233`, shared-store write and provider assignment at
     `:242-243`, creation log at `:245` (declared at `:368-369`), `IsStaleAutoRegistered` at
     `:265-289`, `RemoveStaleEndpointsAsync` at `:298-323` (called at `:170-175`), `VerifyEventTypes`
     at `:325-335`, the not-verified log comment at `:347-352`; the Context incident note is at
     `:205-213`.
   - Deletion-predicate tests at `StripeWebhookRegistrationServiceTests.cs:302,310,324,334,347`.

## Revision (2026-10-26)
Re-verified against current source. The ingress contract, the Decision, the Rationale and the
Trade-offs are unchanged: verification still tries the runtime then the configured secret and
accepts either, the handler's idempotency and anomaly paths behave as described, Sales keeps the
mixed `http` ingress with a TCP-passthrough gRPC port, and `/Payments` is still exempt from both edge
limiters. Only anchors moved. They were re-pointed in Context, Decision, Rationale and Trade-offs;
the anchors inside the earlier dated revisions stay as written, and the current locations are
recorded here.

1. Anchors re-verified against current source:
   - `StripePaymentService.cs`
     (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripePaymentService.cs`):
     `ParseWebhookEvent` at `:318`, candidate secrets at `:322-328`, the missing-secret branch at
     `:330-341`, the `TryValidateSignature` call and signature-failure return at `:343-353`,
     `ParseEvent` with `throwOnApiVersionMismatch: false` at `:357-360` (call `:360`), the
     collapsed-call note at `:302-307`, the either-candidate remarks at `:309-315`,
     `TryValidateSignature` at `:595-617` with `EventUtility.ValidateSignature` at `:606`.
   - `ProcessPaymentWebhookHandler.cs`
     (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/ProcessPaymentWebhook/ProcessPaymentWebhookHandler.cs`):
     event-type switch at `:39-45` (unhandled default `:44`), declined-attempt handler at `:63-70`,
     paid short-circuit at `:84-88` (comment `:80-83`), refund log call at `:86` and
     `LogIfPaidByAnotherIntent` at `:120-130`, terminal-order anomaly at `:90-95`, `PaymentProof`
     gate at `:97-104`, failed/cancelled skip at `:156-160`, `Paid`-expiry anomaly at `:162-167`,
     `MarkAsPaymentFailed` refusal at `:169-171`, anomaly messages at `:196-197` and `:205-206`.
   - `MMCA.Store/infra/main.bicep`: Sales ingress `transport: 'http'` at `:1839`,
     `additionalPortMappings` at `:1846-1852`, Sales `ConnectionStrings__redis` at `:1909`,
     `Stripe__WebhookBaseUrl` at `:1947`.
   - `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs`: edge-kit wiring and the `/Payments`
     exemption rationale at `:85-93` (bypass sentence `:89-91`), the version-pair reasoning at
     `:128-137`.
   - `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Gateway/GatewayRateLimitingExtensions.cs`:
     always-bypassed prefixes at `:87-92`, `IsBypassed` (both limiters) at `:94-113`,
     `IsExemptFromLimiters` at `:205-208`, the per-IP no-limiter branch and fixed window at
     `:233-236` and `:246-253`, the concurrency partition at `:271-278`, the chained global limiter
     at `:330-337`; `BypassPathPrefixes` still lists `/Payments` at
     `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json:20`.

## Revision (2026-10-28)
Re-verified against current source. The ingress contract, the Decision, the Rationale and the
Trade-offs are unchanged: verification still builds the runtime then the configured candidate,
returns `SecretMissing` only when both are empty and checks the signature before `ParseEvent`; the
reconcile lock is still Redis-backed when a multiplexer is registered; Sales keeps the mixed `http`
ingress. Only anchors moved. They were re-pointed in Decision, Rationale and Trade-offs; the anchors
inside the earlier dated revisions stay as written, and the current locations are recorded here.

1. Anchors re-verified against current source:
   - `StripePaymentService.cs`
     (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Payments/Stripe/StripePaymentService.cs`):
     `ParseWebhookEvent` at `:332`, remarks at `:314-331` (collapsed-call note `:315-321`,
     either-candidate paragraph `:322-330`), candidate secrets at `:336-342`, the missing-secret
     branch at `:344-355`, the `TryValidateSignature` call and signature-failure return at
     `:357-367`, `ParseEvent` with `throwOnApiVersionMismatch: false` at `:371-374` (call `:374`),
     `TryValidateSignature` at `:633-655` with `EventUtility.ValidateSignature` at `:644`; the
     authentication range is `:332-367`.
   - `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/DependencyInjection.cs`:
     `StripeWebhookRegistrationService` registered at `:47`, `PaymentReconciliationService` comment
     and registration at `:48-50`.
   - `MMCA.Store/infra/main.bicep` (inside `salesApp`, `:1821`): ingress `transport: 'http'` at
     `:1840`, `additionalPortMappings` at `:1847-1853`, `ConnectionStrings__redis` at `:1910`,
     `Stripe__WebhookBaseUrl` at `:1948`.
   - `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs`: edge-kit comment at `:88-95` (the
     `/Payments` bypass sentence `:92-94`) and the `AddGatewayRateLimiting` call at `:96`; the
     `AddMmcaGateway` version-pair reasoning at `:131-140` (shared default carries no version pair
     `:139-140`).
   - `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.Caching.cs`: the
     `IDistributedLock` registration at `:98-118` (comment `:98-103`, Redis branch `:106-113`,
     in-process fallback `:115-117`).

## Related
ADR-003 (outbound at-least-once delivery, the other end of the same family), ADR-021 (broker-side
inbound dedup, which never sees a webhook), ADR-017 (client-supplied idempotency keys, which a third
party does not send), ADR-054 (the reconciliation backstop for the order a webhook never completed),
ADR-012 (the Sales mixed-endpoint profile that keeps an HTTP/1.1 surface for this webhook), ADR-070
(the fail-fast configuration contract this startup path deliberately does not join: missing Stripe
configuration logs and skips instead of refusing to start), ADR-072 (precedent for recording a
single-application decision), ADR-108 (the distributed lock that serializes the startup reconcile
across replicas).
