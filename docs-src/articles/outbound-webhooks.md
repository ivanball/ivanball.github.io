# Sending Webhooks Without Opening a Door: Signed Delivery, Connect-Time SSRF Defense and a Lane of Its Own

> Series: MMCA.Common · Article #56 (deep-dive) · Pillar P2/P3 · Group G04 · Rubric §10 · ADR-142 ·
> Status: grounded in `Website/docs-src/adr/142-outbound-webhooks-and-delivery-lane.md`,
> `MMCA.Common/.../Infrastructure/Webhooks/WebhookServiceCollectionExtensions.cs`,
> `.../WebhookConnectCallback.cs`, `.../WebhookDeliveryLane.cs`,
> `MMCA.Common/.../Infrastructure/Http/OutboundAddressPolicy.cs`,
> `MMCA.Common/.../Application/Webhooks/WebhookSettings.cs`,
> `.../Webhooks/Delivery/WebhookSignature.cs`, `.../WebhookDeliveryId.cs`, `.../WebhookFanOutHandler.cs`,
> `.../DeliverWebhookInternalCommandHandler.cs`,
> `MMCA.Common/.../Infrastructure/Persistence/InternalCommands/Processing/InternalCommandLaneProcessor.cs`,
> and the MMCA.Helpdesk wiring in `MMCA.Helpdesk.Web/Program.cs`, its appsettings files and the Tickets
> module's `DependencyInjection.cs`. No em dashes.

**Subtitle:** An outbound webhook is the one feature where an operator types a URL and your server
dutifully connects to it, retries it for hours and signs everything it sends. Here is how MMCA.Common
ships it: Standard Webhooks signatures with a rotation window, every delivery a durable internal command,
an address policy enforced at the moment the socket opens, and a delivery lane that keeps a dead receiver
from delaying anything else.

---

A tenant admin pastes a URL into your settings page. "Notify us when a ticket opens." You save it, and
the next event posts JSON to it.

That URL is now operator input your server dials on its own schedule, and every obvious implementation
of "post JSON to it" gets at least one of four things wrong.

It trusts the URL. `http://169.254.169.254/` is a perfectly valid absolute URI, and so is a hostname
whose DNS answer is public when you validate it and private when you connect. Either way your server has
just made a request into its own network on a stranger's behalf: server-side request forgery.

It trusts the receiver. The receiver is down for the weekend, or answers in 29 seconds, and the loop
that posts to it is the same loop that runs your business work, so a partner's outage becomes yours.

It loses deliveries. A post from inside the request, or from a fire-and-forget task, dies with the
process and leaves no record of what was owed.

And it cannot prove anything. Without a signature the receiver cannot tell your post from anyone else's,
and without a stable delivery id it cannot tell your retry from a second event.

**ADR-142** is the record of answering all four: stored subscriptions, HMAC-signed delivery scheduled as
internal commands the framework already had, an outbound address policy enforced at validation time and
again at connect time, and a dedicated delivery lane (`ADR-142:35-37`). It is the outbound twin of
the inbound webhook edge in Article 49 (`Website/docs-src/articles/saga-compensation-reconciliation.md`),
and it builds directly on the durable internal commands of Article 51
(`Website/docs-src/articles/durable-internal-commands.md`), which this article assumes rather than
re-teaches.

## The MMCA answer: three calls, and the rest is policy

The whole feature is opt-in, and registering it turns nothing on by itself.

`AddWebhooks(configuration)` (`WebhookServiceCollectionExtensions.cs:67`) binds the `Webhooks` section
with data-annotation validation at startup (`:71-74`) and registers the subscription store, the
administration service, the target validator, the signed sender, the secret protector, the DNS resolver
and the event catalog (`:76-82`), plus data protection (`:85`), the hardened `MMCA.Webhooks` HTTP client
(`:87-102`), a startup notice for an ignored development switch (`:104`) and the delivery lane (`:106`).
Its own remarks spell out what else turning it on needs: `pipeline.AddWebhookDelivery()` inside
`AddMmcaApplicationPipeline`, one `AddWebhookEvent<TEvent>(name)` per published event, the migration on
the `Webhooks:DataSourceName` database, and a controller deriving from `WebhookSubscriptionsControllerBase`
granted `webhooks:manage` (`:33-39`). With `Webhooks:Enabled` false, which is the default
(`WebhookSettings.cs:16-17`), the fan-out stays inert, every administration endpoint answers 404 and no
context maps the subscription table (`WebhookServiceCollectionExtensions.cs:33-35`).

MMCA.Helpdesk is the one adopter, and its wiring is the shape:

```csharp
// MMCA.Helpdesk.Web/Program.cs (illustrative excerpt; the two calls are verbatim)
services.AddWebhooks(builder.Configuration);

builder.Services.AddMmcaApplicationPipeline(pipeline => pipeline
    // ... module scans ...
    .AddWebhookDelivery());   // the delivery handler, inside the pipeline so every decorator wraps it

// MMCA.Helpdesk.Tickets.Application/DependencyInjection.cs (verbatim)
services.AddWebhookEvent<TicketOpenedIntegrationEvent>("ticket.opened");

// appsettings.json: "Webhooks": { "Enabled": true }
// appsettings.Development.json: "Webhooks": { "AllowInsecureTargetsInDevelopment": true }
```

One integration event, published under one webhook type name, to whatever subscriptions the tenant has
created. That is the entire adopter surface. Said plainly, because it matters for how much weight to put
on the rest of this article: Helpdesk is the only adopter, and the record states that nothing has been
exercised against a real third-party receiver or a Standard Webhooks library on the receiving side; the
evidence is the framework's unit and integration tiers (`ADR-142:338-340`).

## Fan-out: one event, one durable row per subscriber

When the event arrives, `WebhookFanOutHandler<TEvent>` does four things in order
(`WebhookFanOutHandler.cs:60-123`). It returns at once unless webhooks are enabled and the event type is
registered in the catalog (`:62-67`). It lists the enabled subscriptions of the event's tenant and keeps
the ones that subscribe to this event type (`:69-78`). It serializes the event once and skips the whole
event with one warning when the payload is over `MaxPayloadBytes` (`:80-86`), default 65536, range 1024
to 1048576 (`WebhookSettings.cs:51-56`). And it schedules one `DeliverWebhookInternalCommand` per
matching subscription, all inside **one** transaction (`WebhookFanOutHandler.cs:88-115`).

The failure branch is the part worth copying. If any schedule fails, the handler **throws**
(`:117-123`), and the exception message says why: "The event will be redelivered." A thrown handler is
the outbox's (or the broker's) cue to redeliver the event, so a fan-out that could not record its rows
gets another chance instead of silently delivering to half the subscribers.

Each row carries a `webhook-id` computed by `WebhookDeliveryId.For(eventId, subscriptionId)`: the first
16 bytes of SHA-256 over the event's `MessageId` followed by the subscription id, returned as a `Guid`
(`WebhookDeliveryId.cs:11-27`). That determinism is what makes at-least-once delivery survivable on the
other side. The outbox can redeliver an event, so the fan-out can run twice, but the same (event,
subscription) pair always produces the same id (`:5-8`), and a receiver that dedupes on `webhook-id` sees
one delivery. It is the receiver-side equivalent of the consumer inbox (ADR-021).

From here a delivery is an ordinary internal command, so it inherits everything Article 51 describes:
the durable row, the claim lease, the jittered backoff, the attempt ceiling, the dead letter and the
operator console. Retries come from the `InternalCommands:*` settings, not from a webhook-specific policy
(`WebhookSettings.cs:8-9`).

## Signing: Standard Webhooks, with a rotation window

`WebhookSignature` implements the Standard Webhooks scheme (`WebhookSignature.cs:8-13`). A secret is
`whsec_` plus Base64 of 32 random bytes (`:16`, `:28`, `GenerateSecret` `:32-33`). A signature is `v1,`
plus the Base64 HMAC-SHA256 over `{id}.{timestamp}.{body}` (`Compute`, `:61-69`), and the three values
travel in the `webhook-id`, `webhook-timestamp` (Unix seconds) and `webhook-signature` headers
(`:18-25`).

The signature header is a **space-separated list** (`:24-25`), and that is what makes rotation painless.
After a secret rotates, the previous secret keeps signing beside the new one for
`PreviousSecretGraceHours`, default 24, range 0 to 168 (`WebhookSettings.cs:58-60`); the delivery
handler asks the subscription for its signing secrets as of now (`DeliverWebhookInternalCommandHandler.cs:64`).
A receiver that still holds the old secret keeps verifying during the window, and one that already holds
the new secret verifies too.

The framework also ships the receiver's half. `WebhookSignature.Verify` accepts a delivery when the
timestamp lies within a tolerance of the receiver's clock and any `v1,` entry in the header matches,
compared in constant time (`:71-108`, `CryptographicOperations.FixedTimeEquals` at `:107`). The tolerance
check saturates at the `long` range, so a hostile timestamp cannot wrap the comparison or throw
(`:110-124`). A malformed secret is a `Webhooks.SecretUnreadable` `Result` failure from `DecodeSecret`,
never an exception (`:38-53`, `:126-130`).

A receiver written against this contract looks like this:

```csharp
// Illustrative receiver; WebhookSignature.DecodeSecret and Verify are the real signatures.
var key = WebhookSignature.DecodeSecret(storedSecret);          // Result<byte[]>
if (key.IsFailure) return Results.StatusCode(500);

var ok = WebhookSignature.Verify(
    webhookId:       Request.Headers["webhook-id"],
    timestamp:       long.Parse(Request.Headers["webhook-timestamp"]),
    body:            rawBody,                                   // the exact bytes received, as text
    signatureHeader: Request.Headers["webhook-signature"],
    key:             key.Value,
    nowUnixSeconds:  DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
    tolerance:       TimeSpan.FromMinutes(5));

if (!ok) return Results.Unauthorized();
// Dedupe on webhook-id before acting: the sender is at-least-once.
```

The secrets are stored protected by the host's data-protection key ring (`DataProtectionWebhookSecretProtector`
registered at `WebhookServiceCollectionExtensions.cs:80`, data protection at `:85`), which is why the
registration remarks say a multi-replica host needs the shared key ring of ADR-069 to read a secret
another replica wrote (`:44-45`). A replica that cannot read the secret does not throw: the outcome is
`SecretUnreadable`, the row fails and retries (`DeliverWebhookInternalCommandHandler.cs:113-120`).

## SSRF: the check that counts is the one where the socket opens

`OutboundAddressPolicy` is the rule. `IsPublicAddress` (`OutboundAddressPolicy.cs:68`) denies the
private, loopback, link-local, shared, benchmarking, multicast and reserved IPv4 ranges plus the single
cloud host endpoint `168.63.129.16` (`:15`), and judges an IPv4-mapped IPv6 address as its IPv4 form
(`:72`). For IPv6 it is an **allow-list**: only global unicast `2000::/3` can be public (`:35`, `:60`),
so a range nobody listed, including one added to the address architecture later, is refused by default.
`IsAcceptableTargetUri` (`:100`) adds the URI rules: https only, and never `localhost` or `*.localhost`
(`:124-125`).

The obvious place to apply that rule is when the subscription is saved, and MMCA does: the registered
target validator is `DnsWebhookTargetValidator` (`WebhookServiceCollectionExtensions.cs:78`), which the
record describes as resolving the host at create and update and refusing when any answer is not public
(`ADR-142:132-135`). But the record is explicit that this answer is **early feedback only**
(`ADR-142:135`), because a validation-time check is defeated by DNS rebinding: the name resolves to a
public address when you check it and to `10.0.0.5` when you connect.

So the authoritative check lives in the HTTP client's `ConnectCallback`, wired into the primary
`SocketsHttpHandler` (`WebhookServiceCollectionExtensions.cs:95-99`). `WebhookConnectCallback` resolves
the host **itself** (`WebhookConnectCallback.cs:37-40`), refuses with `WebhookTargetRefusedException`
**before opening a socket** when any resolved address is not public (`:48-53`), and then dials only the
addresses it just checked, in order, returning the first that connects (`:55-70`). It never dials an
address it did not check (`:11-12`), which is what makes the policy hold against DNS rebinding and
against any handler earlier in the pipeline that rewrites the request URI (`:12-14`).

One small judgement in that callback is worth noticing. An **empty** DNS answer is not a refusal: it
throws a `SocketException` with `HostNotFound`, because an empty answer may be transient, so the
delivery is retried (`:42-46`). A non-public answer, by contrast, is final. The delivery handler records
a fixed reason ("Target refused: not a public address.") and **completes** the row, because retrying
cannot change the answer, while the detail that can name the resolved address goes only to a server-side
Warning, since a tenant admin API reads the last-failure column
(`DeliverWebhookInternalCommandHandler.cs:33-34`, `:92-98`, `:133-140`). A stored target that is not
https is refused by the sender before anything is sent, under its own fixed reason (`:133-140`).

`AllowInsecureTargetsInDevelopment` lifts the scheme, localhost and private-address rules for local
work, honoured only when the environment is Development and otherwise ignored with one startup warning
(`WebhookSettings.cs:69-73`; the notice service at `WebhookServiceCollectionExtensions.cs:104`).
Helpdesk sets it in its Development file only (`appsettings.Development.json:10-11`).

## A client that does exactly one thing

The `MMCA.Webhooks` client's primary handler sets `AllowAutoRedirect = false`, `UseProxy = false`,
`UseCookies = false` and `ActivityHeadersPropagator = null` (`WebhookServiceCollectionExtensions.cs:89-94`),
then clears every additional handler a host default adds and removes the client's default loggers
(`:101-102`). Each of those is a deliberate refusal, and the remarks give the reasons (`:47-55`):

- **No redirect.** A 3xx is not followed; the handler treats it as a failed status that retries
  (`DeliverWebhookInternalCommandHandler.cs:113-114`), so the only address ever dialled is the stored one.
- **No second retry policy.** A host-wide resilience pipeline would retry beside the internal-command
  queue; clearing the handlers leaves the queue as the only retry and the only failure policy.
- **No URL in the logs.** The target URL often carries the receiver's token in its path, and the client
  loggers would write it.
- **No trace context to a third party.** No `traceparent`, `tracestate` or `baggage` header leaves the
  host.

The request timeout is `TimeoutSeconds` (`:87-88`), default 10, range 1 to 30 (`WebhookSettings.cs:25-34`).

The outcome mapping is short and every branch is a decision (`DeliverWebhookInternalCommandHandler.cs:79-125`).
A 2xx completes the row (`:85-90`). A 410 Gone records the failure, **disables the subscription** and
completes the row (`:101-111`). A refused target completes the row (`:92-98`). Anything else (any other
status, redirects included, a transport failure, timeouts included, or an unreadable secret) fails the
row so the processor retries with backoff and dead-letters after `MaxAttempts` (`:113-124`). A missing,
deleted or disabled subscription completes the row without sending (`:52-57`), and a host where
`Webhooks:Enabled` is false fails the row before reading anything, so a row queued before webhooks were
switched off retries, dead-letters and stays requeue-able (`:41-50`). The handler is deliberately not
`ITransactional`: the outcome is recorded on its own save (`:12-16`, `:69`).

## The lane: a dead receiver cannot delay anything else

Here is the problem the first five sections do not solve. Internal commands are a shared queue. Business
commands run on it too. A receiver that takes 10 seconds to time out, multiplied by a backlog of its
deliveries, is 10 seconds of every cycle your business commands do not run.

So delivery rows get a lane of their own. `WebhookDeliveryLane` routes them to their own
`InternalCommandLaneProcessor`, never the shared loop, so a slow or failing receiver cannot delay the
other internal commands (`WebhookDeliveryLane.cs:14-19`). It registers the lane only when both
`Webhooks:Enabled` and `InternalCommands:Enabled` are true (`:51-67`). The lane is named `webhooks`, the
value of its `lane` metric tag (`:22-23`), and it is built from three settings (`:36-49`): the cooldown
is `ReceiverCooldownSeconds` (`:43`), the concurrency is `DeliveryConcurrency` (`:47`), default 4,
range 1 to 16 (`WebhookSettings.cs:36-41`), and the batch start budget is `TimeoutSeconds` (`:48`). The
receiver key is the subscription id (`:44-46`).

Inside a claimed batch up to that many rows run at once per replica, two rows of one receiver never run
at the same time, and the earliest allowed row starts first (`InternalCommandLaneProcessor.cs:28-30`).
No row starts once the start budget has elapsed since the batch's first start, and the rows that never
started are released **uncharged**, so they are due again at once (`:31-33`, `ReleaseAsync` `:542-558`).

### The cooldown charges an attempt without sending

This is the part of the design that is easiest to get wrong, so it is worth reading slowly.

A receiver whose real attempt failed cools down on this replica (`:36-37`). While it cools down, each of
its rows whose turn comes is **not sent and its handler is not invoked**; it is charged one failed
attempt through the unchanged failure path, with the error code `InternalCommands.ReceiverCoolingDown`
and the message "Receiver cooling down after a failed delivery." (`:37-39`, `:60-64`, `ChargeAsync`
`:519-540`). The first row whose turn comes after the cooldown ends runs for real; a success closes the
cooldown, a failure reopens it (`:39-41`, `ApplyOutcome` `:502-517`). A cooldown opens from the instant
the attempt failed, not from when the scheduler got round to it (`:495-500`, `OpenCooldown` `:564-576`).

Why charge? Because the alternative, deferring a cooling receiver's rows for free, lets a permanently
dead receiver cost one real attempt per cooldown per replica forever, and a subscription receiving
events faster than that accumulates pending rows without bound (`ADR-142:297-304`). Charging keeps each
row on the normal retry timeline, so a dead receiver's backlog dead-letters on the normal attempt budget.

The obvious objection is that charging could dead-letter a row without ever really trying it. The clamp
answers that. `ReceiverCooldownSeconds` (default 60, range 5 to 120, `WebhookSettings.cs:43-49`) is not
applied as configured: the effective cooldown is `min(configured, S - attemptTimeout - 1 s)`, never below
1 second, where `S` is the shortest possible span from a row's first attempt to its last under the
queue's backoff settings, and the cooldown is off when `S` is zero (`InternalCommandLaneProcessor.cs:89-116`).
Leaving room for one attempt in flight is what guarantees, on any number of replicas, that a receiver
answering from the moment a row is scheduled gets at least one real attempt on that row before it can
dead-letter, unless the 1-second floor applied (`:93-96`).

## Trade-offs, honestly

- **It has not met a real receiver.** Helpdesk is the only adopter (`Program.cs:107`, `:160`;
  `DependencyInjection.cs:60`), and nothing has been exercised against a real third-party receiver or a
  Standard Webhooks library on the receiving side (`ADR-142:338-340`). The signature format follows the
  scheme as the source documents it; interoperability is asserted, not observed.
- **The whole event is the payload.** There is no projection step: the fan-out serializes the event as
  it is (`WebhookFanOutHandler.cs:80`), so registering an event publishes every member of its contract to
  a third party. Register only terminal contracts you would be comfortable printing.
- **The cooldown is per replica.** It is held on each replica (`WebhookSettings.cs:44-46`), so R replicas
  each spend a real attempt per window on a failing receiver.
- **Recovery after an outage costs a window.** Because cooling rows are charged, a row whose receiver
  comes back too close to the row's last attempt can dead-letter without another real try. That is the
  stated price of the charged fail-fast (`ADR-142:264-266`), and the dead letter is requeue-able from the
  internal-command console.
- **Only 410 disables a subscription** (`DeliverWebhookInternalCommandHandler.cs:106-111`). A receiver
  that fails forever with a 500 keeps being retried and dead-lettered event by event, bounded by the
  charged cooldown rather than by a circuit that turns the subscription off.
- **A slow but succeeding receiver never cools down.** A success closes the cooldown
  (`InternalCommandLaneProcessor.cs:513-516`), and one receiver never runs two rows at once (`:28-30`), so
  its backlog drains at one row per response time per replica.
- **Many distinct failing receivers still fill the lane.** A hanging receiver holds a slot for up to
  `TimeoutSeconds`, so `DeliveryConcurrency` or more of them can occupy every slot; one tenant can hold up
  to `MaxSubscriptionsPerTenant` subscriptions (default 25, a soft limit, `WebhookSettings.cs:62-67`). One
  tenant can delay other tenants' deliveries. It cannot delay the shared queue.
- **Every replica needs the same `Webhooks:Enabled`.** A replica that drains the queue with webhooks off
  registers no lane (`WebhookDeliveryLane.cs:64-67`), and its handler fails delivery rows without sending
  (`DeliverWebhookInternalCommandHandler.cs:41-50`), spending attempts toward the dead letter.
- **The client trace still records the URL path.** Loggers and trace headers are removed, but the HTTP
  client span is not, so a host exporting traces to a shared backend filters the `MMCA.Webhooks` spans
  itself (`WebhookServiceCollectionExtensions.cs:53-54`).

## Apply this even without MMCA

The design ports to any stack with a relational database and a background worker. Six steps:

1. **Make each delivery a durable row, written in one transaction per event.** One row per (event,
   subscriber), all or nothing, and if the write fails, fail the event handler so your event transport
   redelivers it. A post from inside the request is a delivery you cannot prove you owed.
2. **Derive the delivery id from the event and the subscriber.** A hash of the pair, not a fresh GUID, so
   a redelivered event produces the same id and the receiver can dedupe. At-least-once is only tolerable
   when the duplicate is recognizable.
3. **Sign with a public scheme and let the signature header carry a list.** Standard Webhooks gives your
   receivers a library instead of your documentation. A list header makes secret rotation a grace window
   instead of a coordinated cutover, and ship a constant-time verifier with a timestamp tolerance.
4. **Check the address where the socket opens, and dial only what you checked.** Resolve the name
   yourself in the connect callback, refuse if any answer is non-public, then connect to those addresses
   and no others. Treat IPv6 as an allow-list. Treat an empty answer as transient and a private answer as
   final. Validation at save time is a courtesy to the admin, not a control.
5. **Strip the client to one handler.** No redirects, no proxy, no cookies, no trace propagation, no
   URL-logging handler, no second retry policy. Every default you leave on is a channel you did not
   decide to open.
6. **Give deliveries their own lane, and charge cooling receivers.** Isolate the drain from your
   business work, key concurrency by receiver, and when a receiver is failing, fail its due rows on the
   normal retry timeline without sending, clamped so every row still gets one real attempt before it can
   dead-letter.

The rule of thumb: **an outbound webhook is a URL a stranger chose, dialled by your server on your
schedule. Decide where it may connect at the socket, not at the form, and decide what its outage may cost
you before it has one.**

---

**What we covered:** why outbound webhooks fail in four distinct ways (SSRF, a slow receiver, lost work
and unprovable posts), how `AddWebhooks` registers an inert feature that two further calls
(`AddWebhookDelivery` and one `AddWebhookEvent` per event), a migration, an admin controller and a flag
turn on, how the fan-out schedules one durable internal command per subscriber in one transaction and
throws to get the event redelivered, why the deterministic `webhook-id` makes at-least-once dedupable,
how Standard Webhooks signatures and a space-separated header give secret rotation a grace window, why
the authoritative SSRF check is a connect callback that dials only the addresses it checked, what the
stripped `MMCA.Webhooks` client refuses and why, how each send outcome maps onto the row, and how the
delivery lane, its per-receiver concurrency and its charged, clamped cooldown keep a dead receiver from
delaying anything else.

*MMCA.Common is open source. Star the repo, read the 2-minute ADR-142 behind this pattern, or
`dotnet add package MMCA.Common.API` and build the monolith you can extract later.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- This pattern's decision record: `Website/docs-src/adr/142-outbound-webhooks-and-delivery-lane.md`
- The inbound side of the same contract: `Website/docs-src/articles/saga-compensation-reconciliation.md`
  (its "The inbound edge" section); the queue every delivery runs on:
  `Website/docs-src/articles/durable-internal-commands.md`.

*Previous: Article 55, ["Your App as an MCP Server: Read-Only Tools Over the Queries You Already
Govern"](app-as-mcp-server.md). Next in the series: Article 57, ["The MMCA series: every pattern, one
place"](series-index.md).*

*Tags: .NET, C Sharp, Security, Distributed Systems, Software Architecture*

*Notes: verified type/behavior names with path:line (verified 2026-11-25 against MMCA.Common v1.319.0,
`MMCA.Common/FACTS.md:14`). New article this run (2026-11-25). The two code blocks are illustrative of
the documented shape: the registration block quotes `services.AddWebhooks(builder.Configuration);`
(`MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:107`), `.AddWebhookDelivery()` (`:160`) and
`services.AddWebhookEvent<TicketOpenedIntegrationEvent>("ticket.opened");`
(`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Application/DependencyInjection.cs:60`)
verbatim, while the surrounding `AddMmcaApplicationPipeline` lambda is condensed and the two appsettings
lines are paraphrased as comments (`appsettings.json:29` opens the `Webhooks` section;
`appsettings.Development.json:10-11` sets `AllowInsecureTargetsInDevelopment`); the receiver block is
invented sample code calling the real `WebhookSignature.DecodeSecret` (`WebhookSignature.cs:38`) and
`WebhookSignature.Verify` (`:84-91`, parameter names verbatim).*
- *ADR-142 (`Website/docs-src/adr/142-outbound-webhooks-and-delivery-lane.md`), Accepted 2026-11-12,
  revised 2026-11-23 (`:4-9`), read 2026-11-25: validation-time DNS check described `:132-135` and called
  early feedback only `:135`; free-deferral alternative rejected `:297-304`; recovery-after-outage
  trade-off `:264-266`; "What is not verified" `:338-340`; the Helpdesk adopter list `:313-322`.*
- *Infrastructure (paths rooted at `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/`):
  `Webhooks/WebhookServiceCollectionExtensions.cs:67` (`AddWebhooks`), options bind and validate
  `:71-74`, service registrations `:76-82` (`DnsWebhookTargetValidator` `:78`,
  `DataProtectionWebhookSecretProtector` `:80`), `AddDataProtection` `:85`, client timeout `:87-88`,
  primary handler `:89-100` (`AllowAutoRedirect`/`UseProxy`/`UseCookies`/`ActivityHeadersPropagator`
  `:91-94`, `ConnectCallback` `:95-99`), handlers cleared and loggers removed `:101-102`,
  `InsecureWebhookTargetsNoticeService` `:104`, `WebhookDeliveryLane.Register` `:106`; remarks: inert
  when disabled `:33-35`, what else is needed `:35-39`, key ring `:44-45`, client refusals `:47-55`,
  span still records the path `:53-54`. `Webhooks/WebhookConnectCallback.cs`: summary `:7-15`
  (never dials an unchecked address `:11-12`, rebinding and URI rewrite `:12-14`), own resolution
  `:37-40`, empty answer is a retryable `SocketException` `:42-46`, refusal before connect `:48-53`,
  checked-addresses-only dial loop `:55-70`. `Http/OutboundAddressPolicy.cs`: `168.63.129.16` `:15`,
  IPv6 allow-list `2000::/3` `:35`, `:60`, `IsPublicAddress` `:68`, IPv4-mapped handling `:72`,
  `IsAcceptableTargetUri` `:100`, localhost rule `:124-125`. `Webhooks/WebhookDeliveryLane.cs`: summary
  `:14-19`, `LaneName` `:22-23`, `Create` `:36-49` (receiver key `:44-46`, `MaxConcurrency` `:47`,
  `BatchStartBudget` `:48`), `Register` gate `:51-67`.
  `Persistence/InternalCommands/Processing/InternalCommandLaneProcessor.cs`: per-receiver concurrency
  `:28-30`, start budget and uncharged release `:31-33`, cooldown summary `:35-42`, `CoolingDownErrorCode`
  and message `:60-64`, `EffectiveCooldown` clamp `:89-116` (guarantee `:93-96`), `ApplyOutcome`
  `:495-517` (success close `:513-516`), `ChargeAsync` `:519-540`, `ReleaseAsync` `:542-558`,
  `OpenCooldown` `:560-576`.*
- *Application (paths rooted at `MMCA.Common/Source/Core/MMCA.Common.Application/Webhooks/`):
  `WebhookSettings.cs`: retries from `InternalCommands:*` `:8-9`, `Enabled` default false `:16-17`,
  `TimeoutSeconds` 10 [1,30] `:25-34`, `DeliveryConcurrency` 4 [1,16] `:36-41`, `ReceiverCooldownSeconds`
  60 [5,120] `:43-49` (per-replica `:44-46`), `MaxPayloadBytes` 65536 [1024,1048576] `:51-56`,
  `PreviousSecretGraceHours` 24 [0,168] `:58-60`, `MaxSubscriptionsPerTenant` 25 [1,500] soft `:62-67`,
  `AllowInsecureTargetsInDevelopment` `:69-73`. `Delivery/WebhookSignature.cs`: scheme summary `:8-13`,
  `SecretPrefix` `:16`, header names `:18-25`, 32-byte key `:28`, `GenerateSecret` `:32-33`,
  `DecodeSecret` `:38-53`, `Compute` `:61-69`, `Verify` `:71-108` (`FixedTimeEquals` `:107`), saturating
  tolerance `:110-124`, `SecretUnreadable` failure `:126-130`. `Delivery/WebhookDeliveryId.cs:5-27`.
  `Delivery/WebhookFanOutHandler.cs`: `HandleScopedAsync` `:60-123` (gate `:62-67`, tenant list and
  match `:69-78`, payload cap `:80-86`, commands `:88-96`, one transaction `:98-115`, throw for
  redelivery `:117-123`). `Delivery/DeliverWebhookInternalCommandHandler.cs`: not `ITransactional`
  `:12-16`, refusal reasons `:33-34`, disabled-host failure `:41-50`, nothing-to-deliver `:52-57`,
  signing secrets `:64`, own save `:69`, `ApplyOutcome` `:79-125` (2xx `:85-90`, refused `:92-98`, 410
  disable `:101-111`, retry branch and `SecretUnreadable` `:113-124`), `RefusedReason` `:133-140`.*
- *MMCA.Helpdesk adoption: `MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/Program.cs:107` and `:160`;
  `MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Application/DependencyInjection.cs:60`;
  `MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/appsettings.json:29`;
  `MMCA.Helpdesk/Source/Hosts/MMCA.Helpdesk.Web/appsettings.Development.json:10-11`.*
- *Placement: Pillar P2/P3, Group G04 and Rubric §10 follow the neighboring Article 51 row in
  `Website/docs-src/articles/README.md:61`; the onboarding chapter covering these types is
  `Website/docs-src/onboarding/group-04-events-outbox.md` (`### WebhookDeliveryLane` at `:3371`).
  Article 49's inbound webhook section is "The inbound edge: a webhook is a delivery contract, not an
  API call" (`saga-compensation-reconciliation.md:332`).*
- *Flag (2026-11-25): the validation-time `DnsWebhookTargetValidator` behavior, the free-deferral
  rejection and the recovery-after-outage trade-off are cited from ADR-142 only; the validator source,
  `ReceiverCooldowns.cs`, `InternalCommandProcessor.cs` (the shared-loop exclusion predicate) and
  `HttpWebhookSender.cs` were not re-read within this run's budget, so the article states the scheme
  rule only through the handler's own remark (`DeliverWebhookInternalCommandHandler.cs:133-140`) and
  omits the delivery command's stored name and the secret-protection purpose string.*
- *Verifier fixes (2026-11-25): cold-open ADR summary softened to the four new pieces the record names
  (subscriptions, signed delivery as internal commands, address policy at validation and connect time,
  delivery lane), `ADR-142:35-37`; lane settings corrected to `ReceiverCooldownSeconds`,
  `DeliveryConcurrency` and `TimeoutSeconds`, the receiver key stated separately as a selector, not a
  setting, `WebhookDeliveryLane.cs:43-48`; "What we covered" corrected to two further calls, a migration,
  an admin controller and a flag, `WebhookServiceCollectionExtensions.cs:33-39`; series footer titles
  and links set to Article 55 (`app-as-mcp-server.md`) and Article 57 (`series-index.md`).*

- Full series index: https://ivanball.github.io/writing.html
