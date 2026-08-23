# ADR-084: Stripe Webhook Ingress (Acceptance-Coded Responses and Startup Self-Registration)

## Status
Accepted (2026-08-14).

## Context
Four ADRs already cover how a message crosses a boundary in this workspace. ADR-003 decides how an
event leaves a service (outbox, at-least-once). ADR-021 decides how a redelivered broker message is
recognized on the way in (consumer inbox). ADR-017 decides how a retried HTTP client request is
deduped at the inbound edge (`Idempotency-Key`). ADR-054 decides what happens when a message that was
supposed to arrive never does (a reconciliation sweep). None of them decides the case Store Sales
actually runs in production: **an inbound call from a third party we do not control**.

Stripe is that caller, and it fits none of the existing shapes. It cannot authenticate as an
application user (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.API/Controllers/PaymentsController.cs:16-17`),
so the endpoint has to be anonymous. It does not send an `Idempotency-Key`, so ADR-017 does not apply.
It does not go through the broker, so ADR-021's inbox never sees it. And it treats the HTTP status
code as a **delivery protocol**, not as an application result: a non-2xx response makes Stripe retry
the event and, if failures persist, disable the endpoint entirely, which silently stops every payment
status update for the whole store.

Two production incidents shaped this, and both are recorded in the source. Rejections were logged at
`Warning` for weeks while the configured signing secret did not match the live endpoint, so 100% of
deliveries returned 400 and nothing surfaced it (`PaymentsController.cs:85-90`). Separately, between
2026-06-12 and 2026-07-30 a disabled-but-still-present endpoint caused a second endpoint to be created
at the same URL with a brand-new signing secret, invalidating the configured one; 507 deliveries failed
in the final week alone (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Services/StripeWebhookRegistrationService.cs:124-131`).
Both were failures of the *ingress contract*, not of payment logic.

## Decision
Treat third-party webhook ingress as its own contract with two halves: **an acceptance-coded endpoint**
and **a self-registering, self-provisioning endpoint registration at startup**.

- **One anonymous, raw-body endpoint.** `POST /Payments/webhook` is `[AllowAnonymous]`
  (`PaymentsController.cs:47,56`). The body is read straight off `HttpContext.Request.Body` with S6932
  suppressed, because signature verification needs the unmodified payload and model binding would
  destroy it (`PaymentsController.cs:61-67`); the `Stripe-Signature` header is read alongside it
  (`:66`). The Gateway forwards `/Payments/{**catch-all}` to Sales over plain HTTP/1.1: the route is
  declared in the Gateway's `ReverseProxy` configuration rather than in code
  ([ADR-089](089-gateway-topology-owned-by-configuration.md)), as the `sales-payments` route
  (`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/appsettings.json:57-60`) on a `sales` cluster that
  deliberately leaves `Version` and `VersionPolicy` unset, unlike `catalog` and `identity` which pin
  `Version` 2 (`appsettings.json:83-90`, reasoning at
  `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:85-89`). That is why Sales keeps the ADR-012
  mixed-endpoint profile: its container app's ingress stays `transport: 'http'` for REST plus this
  webhook, with a TCP-passthrough `additionalPortMappings` entry carrying the h2c gRPC port alongside
  it (`MMCA.Store/infra/main.bicep:1231-1246`).
- **The status code encodes ACCEPTED, not PROCESSED.** Exactly three error codes return 400, held in a
  `FrozenSet` named `RejectionCodes`: `SignatureVerificationFailed`, `ParseFailed` and `SecretMissing`
  (`PaymentsController.cs:31-36`, defined at
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/Interfaces/IPaymentService.cs:37,40,43`).
  Everything past acceptance returns 200, **including an order that cannot be found**, because
  retrying those would fail identically forever (`PaymentsController.cs:38-44,79,95,98`).
- **Verification and parsing are separate steps, so the three reasons stay distinguishable.**
  `EventUtility.ValidateSignature` runs first
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/Services/StripePaymentService.cs:329`),
  then `EventUtility.ParseEvent` with `throwOnApiVersionMismatch: false`, so an account whose API
  version rolled ahead of the pinned library does not reject a correctly signed event (`:345-348`).
  A missing secret is named as its own deployment gap rather than reported as a bad signature
  (`:314-325`). One combined call previously reported all three as a signature failure (`:298-307`).
- **A rejection logs at `Critical`, everything else at `Warning`.** `LogWebhookRejected` is a
  source-generated `Critical` message that names the code, the message, and the operational
  consequence (`PaymentsController.cs:91,102-106`). `Critical` is deliberate: it clears the production
  Azure Monitor log floor (`Logging__OpenTelemetry__LogLevel__Default=Warning`) with room to spare
  (`:89-90`). A post-acceptance failure logs `Warning` and still returns 200 (`:95,98`).
- **Processing idempotency lives in the handler, not in the transport.** Exactly two event types move
  an order: `checkout.session.completed` pays it and `checkout.session.expired` fails it, while
  `payment_intent.payment_failed` is recorded and nothing else
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Orders/UseCases/ProcessPaymentWebhook/ProcessPaymentWebhookHandler.cs:16-18,26-28,41-47,65-72`).
  An already-`Paid` order short-circuits to success (`:84-87`), as does an already-failed or cancelled
  one (`:115-118`), and contradictory transitions log an anomaly instead of erroring (`:90-94,121-125,156-159`).
  Unhandled event types return success (`:46`). The command is deliberately **not** `ITransactional`
  (`ProcessPaymentWebhookCommand.cs:8-17`).
- **The provider-side endpoint registers itself at startup.** `StripeWebhookRegistrationService` is a
  `BackgroundService` (`StripeWebhookRegistrationService.cs:27-31`) registered by
  `AddModuleSalesInfrastructure`
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Infrastructure/DependencyInjection.cs:33`). It
  skips entirely when `WebhookBaseUrl` is empty, which is the local-development path where the Stripe
  CLI forwards instead (`:54-58`), and skips with a `Warning` when `SecretKey` is empty (`:60-64`).
  The expected URL is `WebhookBaseUrl` plus the constant `/Payments/webhook` (`:33,84`); production
  injects `Stripe__WebhookBaseUrl` as the Gateway FQDN (`main.bicep:1326`), so the registered endpoint
  is the Gateway route above. It subscribes exactly three event types (`:42-47`), and warns when an
  existing endpoint is missing any of them (`:224-234`).
- **It deletes only endpoints it created itself.** Every auto-created endpoint carries the description
  prefix `Auto-registered by MMCA` (`:40,143-148`). `IsStaleAutoRegistered` returns `false` for any
  endpoint without that prefix, so an operator-created endpoint is never touched (`:179-185`), and
  `true` for an auto-registered one whose URL no longer matches or whose status is not `enabled`
  (`:187-188`), which is what collapses the disabled same-URL duplicate that caused the 2026 incident
  (`:164-178`). Cleanup is best-effort and per-endpoint isolated: a failed delete is logged and never
  aborts the others or the reconcile (`:91-96,207-221`).
- **The signing secret is minted once, held in memory, and announced for an operator to persist.**
  Stripe returns a signing secret only at creation time (`:153`), so the created value is written to
  the singleton `StripeWebhookSecretProvider` (`:156`), a volatile-backed holder
  (`StripeWebhookSecretProvider.cs:17-27`) that `StripePaymentService` prefers over the configured
  value on every incoming event (`StripePaymentService.cs:310-312`). The event is announced at
  `Critical` (`StripeWebhookRegistrationService.cs:158,256-257`) and the raw secret is written to
  stderr for the operator to copy into `Stripe:WebhookSecret` (`:159-161`). When a secret is *already*
  configured and a new endpoint still has to be created, a second `Critical` states that the
  configured value is now provably stale (`:132-135,268`).
- **An existing enabled endpoint plus a configured secret is trusted without validation.** That path
  only verifies event types and returns (`:102-110`), and its log deliberately does not say "verified",
  because Stripe never re-reveals a secret and a stale one is undetectable here: it surfaces only as
  the `Critical` rejection on the first delivery (`:246-251`). When the endpoint exists but no secret
  is known anywhere, the endpoint is deleted and recreated to obtain a fresh one (`:112-119`).

Adoption is **Store Sales only**. It is the workspace's single inbound third-party webhook, and nothing
in this decision has been generalized into MMCA.Common; recording a single-application pattern as an ADR
follows the ADR-072 precedent (a decision that is ADC-only). The two halves are covered by unit tests
that pin the contract rather than the implementation: the controller's accept-versus-reject mapping in
three cases (`MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.API.Tests/Controllers/PaymentsControllerTests.cs:32,41,50`),
and the deletion predicate in five, including the operator-created endpoint that must never be stale
(`MMCA.Store/Tests/Modules/Sales/MMCA.Store.Sales.Infrastructure.Tests/Services/StripeWebhookRegistrationServiceTests.cs:137,145,159,169,182`).

## Rationale
- **The caller's protocol decides the response vocabulary.** Stripe reads a status code as "keep
  retrying" or "stop", not as "this succeeded" or "this failed". Mapping every application failure to
  400 would be locally honest and globally catastrophic: it costs the endpoint, and with it every
  payment status update. Encoding acceptance is the only mapping that keeps the caller's retry machine
  pointed at the cases a retry can actually fix.
- **Three named rejection reasons beat one.** A tampered payload, an unparseable body and a missing
  signing secret need three different responses from a human, and the collapsed version sent on-call
  after the wrong thing (`StripePaymentService.cs:298-307`).
- **`Critical` is the level this environment can see.** The production log floor is `Warning`
  (`PaymentsController.cs:89-90`), and a total payment-status outage that logs at `Warning` is
  indistinguishable from noise: that is exactly how it went unnoticed for weeks.
- **Self-registration removes a manual step the platform keeps invalidating.** The public URL is a
  Container Apps default domain, so it changes on a region move; a hand-registered endpoint drifts and
  a dead one keeps firing failing-webhook alerts (`StripeWebhookRegistrationService.cs:91-94`).
- **Marker-scoped deletion is what makes automated deletion acceptable.** The service is allowed to
  delete only endpoints it can prove it created, so the worst case of a buggy predicate is a
  re-registration, never the removal of an operator's endpoint (`:176-177,181-185`).
- **The runtime secret provider keeps the very first boot working.** Without it, an auto-created
  endpoint would reject every delivery until a human copied the secret into configuration and
  redeployed (`:153-156`, `StripePaymentService.cs:310-312`).

## Trade-offs
- **A startup service that writes to a live third-party account.** Booting a Sales replica creates and
  deletes webhook endpoints in the real Stripe account (`StripeWebhookRegistrationService.cs:117-118,150-151,212-213`).
  The blast radius is bounded by the description marker and by the `WebhookBaseUrl`/`SecretKey` guards
  (`:54-64`), but this is still automated mutation of an external system at boot, and a
  misconfigured `WebhookBaseUrl` registers a wrong endpoint rather than failing.
- **A signing secret at `Critical` and on stderr is an operational hazard.** It puts live credential
  material into the log pipeline (`:158-161`). That is the deliberate price of zero-touch provisioning:
  the alternative is a first boot where the endpoint exists and every delivery is rejected. It also
  means the secret must be rotated in configuration promptly, and log retention is part of the
  exposure.
- **200 hides processing failures from Stripe by design.** A post-acceptance failure is invisible in
  the Stripe dashboard's delivery view, so it has to surface through our own telemetry: the `Warning`
  log (`PaymentsController.cs:95`) and, for an order left stuck because no webhook ever completed the
  work, the ADR-054 reconciliation sweep (`PaymentReconciliationService`,
  `DependencyInjection.cs:34-36`).
- **A configured secret is trusted, never validated.** A stale `Stripe:WebhookSecret` cannot be
  detected at startup and is discovered only on the first rejected delivery (`:246-251`). This is a
  provider constraint (the secret is never re-revealed), not a choice, but it means startup can log a
  reassuring "endpoint found" line while the deployment is already broken.
- **A restart before the operator persists the secret loops.** The no-secret path deletes and recreates
  the endpoint to mint a fresh one (`:112-119,156`), so every such restart produces a new secret and
  supersedes the previous one; the loop only ends when a human saves a value into configuration.
- **The endpoint is anonymous and internet-reachable.** Signature verification is the only
  authentication (`StripePaymentService.cs:314-341`); an unsigned or wrongly signed request reaches
  the handler pipeline before it is rejected, and each rejection emits a `Critical` log, so a hostile
  caller can generate `Critical` volume.
- **Single-module adoption.** None of this lives in MMCA.Common, so a second inbound webhook (in this
  or another repo) starts from a copy of `PaymentsController` and `StripeWebhookRegistrationService`
  rather than from a framework contract.

## Related
ADR-003 (outbound at-least-once delivery, the other end of the same family), ADR-021 (broker-side
inbound dedup, which never sees a webhook), ADR-017 (client-supplied idempotency keys, which a third
party does not send), ADR-054 (the reconciliation backstop for the order a webhook never completed),
ADR-012 (the Sales mixed-endpoint profile that keeps an HTTP/1.1 surface for this webhook), ADR-070
(the fail-fast configuration contract this startup path deliberately does not join: missing Stripe
configuration logs and skips instead of refusing to start), ADR-072 (precedent for recording a
single-application decision).
