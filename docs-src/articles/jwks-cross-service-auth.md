# Cross-service auth without a shared secret: JWKS discovery

> Series: MMCA.Common · Article #16 · Pillar P3 · Group G08 · Rubric §11 · ADR-004 · ADR-007 · ADR-122 ·
> Status: grounded in `Website/docs-src/adr/004-authentication-dual-fetch.md`,
> `Website/docs-src/adr/007-grpc-extraction.md` (the typed-client and federated-auth bullets),
> `Website/docs-src/adr/122-dev-only-relaxations-fail-closed.md`, `MMCA.Common/AGENTS.md` (the
> microservices extraction section), and `Website/docs-src/onboarding/group-08-auth.md`. No em dashes.

**Subtitle:** When you split a monolith into services, the easy answer is to copy the JWT signing
secret into every validator. That is also the answer that turns one leaked key into a system-wide
breach. Here is the asymmetric boundary that fixes it.

---

You have a monolith that mints its own JWTs. One process signs the token, the same process validates
it, and the signing key is a symmetric secret (HS256). This is fine. The signer and the validator are
the same code, so the shared secret is not really shared with anyone.

Then you extract a module into its own service. Now the Orders service needs to validate a token that
the Identity service minted. The obvious move is to copy the HS256 secret into the Orders service
config so it can validate. Then into the Catalog service. Then into the gateway. Then into the
notification worker.

Stop and look at what just happened. With a symmetric secret, **the key that validates a token is the
same key that mints one.** Every service that can check a token can also forge one. You have taken a
single high-value secret and replicated it across every deployment unit, log scrape, and environment
variable in the fleet. The blast radius of one leak is now "the entire system can be impersonated."

## Why it matters

Symmetric signing couples trust to secret distribution. The more services you have, the more copies of
the forge-anything key exist, and the more places it can leak: a misconfigured config map, a debug log
that dumped the environment, a developer laptop, a third-party APM that captured an env var. You cannot
rotate it without a coordinated flag day across every service at once, because they all share it.

The correct model for distributed token validation is **asymmetric**: the issuer signs with a private
key it never shares, and every other service validates with the matching public key. A public key is
public. It cannot mint tokens. Leaking it is a non-event. That is the property you want for a boundary that
many services depend on.

The problem is that "just switch to RS256" is not the whole story. The validators still need to *get*
the public key, keep getting it as it rotates, and refuse to be tricked into validating the wrong way.
That is what MMCA.Common's JWKS layer is built to handle.

## The MMCA answer: publish the public half as a JWKS document

The framework's token service supports two signing algorithms, selected by the concrete
`JwtSettings.SigningAlgorithm`, which defaults to `RS256`:

- **Monolith mode: HS256** (symmetric HMAC-SHA256). One process signs and validates with a shared
  Base64 secret. A shared secret inside one process is not actually shared, so this is correct here.
- **Microservice mode: RS256** (asymmetric RSA-SHA256). The issuer signs with its RSA private key;
  other services validate with the matching public key and hold no secret at all.

The join point that makes RS256 work across services is **JWKS** (JSON Web Key Set). In MMCA.Common,
`IJwksProvider` (in `MMCA.Common.Infrastructure`, implemented by `RsaJwksProvider`) materializes a
`JsonWebKeySet` from a PEM-encoded RSA **public** key. Critically, it exports only the public
parameters: the private key never leaves the issuer. The set is built lazily on the first request, and
only a successful result is cached: the `Lazy<JsonWebKeySet>` is created with
`LazyThreadSafetyMode.PublicationOnly`, so one transient failure reading the PEM is retried on the next
call rather than cached for the life of the process.

The API layer's `JwksEndpointExtensions` serves that key set at the standard discovery path,
`/.well-known/jwks.json`. A downstream service points its `JwtBearer` handler at that URL and the
ASP.NET Core JWKS machinery fetches the issuer's public keys, validates incoming RS256 tokens against
them, and refreshes the key set on its own schedule. The Identity service holds the one private key;
every validator holds nothing.

```csharp
// Issuer side (Identity API): RsaJwksProvider exposes ONLY the public key.
// Served at GET /.well-known/jwks.json by JwksEndpointExtensions.
JsonWebKeySet GetJsonWebKeySet();   // public parameters only; private key never leaves

// Validator side (any extracted service): JwtBearer fetches the issuer's JWKS URL
// (through the gateway under the local AppHost, Identity's internal ingress when deployed)
// and validates RS256 tokens against the public keys.
// The validator holds NO secret. A leaked public key cannot mint tokens.
```

(Source: `RsaJwksProvider.cs`, `IJwksProvider.cs`, and the JWKS notes in `MMCA.Common/AGENTS.md`'s
microservices extraction section.)

## Discovery, and the graceful empty set

Discovery has two halves, and ADR-004 names both. On the issuer, when JWKS publishing is disabled (the
default for a monolith) or no key is configured, `RsaJwksProvider` returns an **empty key set** rather
than throwing. The well-known endpoints are mapped centrally for every host, so the endpoint stays a
valid, pollable URL instead of erroring. A monolith that never turns JWKS on still answers
`/.well-known/jwks.json` with an empty document, so flipping a service into extracted mode does not
require standing up new endpoints, and only the real issuer advertises a key.

On the validator, the question is which URL to fetch from, and the answer depends on where the host
runs. Under the local Aspire AppHost, `WithJwksDiscovery(identity, gateway)` sets each validator's
authority to the **gateway**'s HTTPS origin: the extracted REST services listen HTTP/2-only on
cleartext for h2c gRPC (ADR-012), so the default HTTP/1.1 `JwtBearer` backchannel cannot reach Identity
directly, while the gateway terminates TLS, speaks both protocols, and forwards `/.well-known/*` on to
Identity. When no gateway is passed, the helper falls back to Identity's own HTTPS endpoint. In the
deployed ADC and Store environments, the bicep templates point the authority straight at Identity's
internal-ingress URL, with no gateway hop. Either way the validator carries one authority value owned
by the host wiring and no key material, and `ValidIssuer` is deliberately left unpinned: the authority
need not be the token's `iss` origin (locally it is the gateway's HTTPS endpoint; when deployed it is
Identity's internal-ingress URL while the token's `iss` is the public gateway origin), so the issuer is
taken from the discovery document.

ADR-004's file name says "dual-fetch", but the framework's own doc comments give that name to a
different flow, so it is worth naming plainly: the shared login flow,
`AuthenticationServiceBase<TUser>.LoginAsync` in `MMCA.Common.Application`, does an **untracked**
read to validate credentials (so the adversarial majority of login traffic, the failed attempts, never
pays EF Core change-tracking cost), then a **tracked** re-fetch only on success. Refresh tokens live in
their own session rows, so the re-fetch is not about persisting them: it loads the instance the app's
`CreateAccessToken` hook mints from (apps reach linked aggregates and navigations through it), and the
second lookup turns a race that deleted the account between the two steps into a clean 404. The base's
own doc comment names it the "untracked-then-tracked dual-fetch"; the ADC and
Store Identity modules are thin sealed subclasses that supply the app-specific hooks (the untracked
lookup, the claim set) and re-label it "dual-fetch pattern" in their class doc comments
(`AuthenticationService.cs:23` in ADC, `:20` in Store). It is shared framework login code, not a
per-app copy, but it is not part of ADR-004's cross-service validation design.

## JWT algorithm pinning: the attack you would otherwise ship

Switching to asymmetric keys opens a specific, classic attack, and the framework closes it explicitly.

Once the RSA **public** key is published (which is the entire point of JWKS), an attacker has it. If a
validator naively trusts the token's own `alg` header, the attacker can craft a token that claims
`alg: HS256` and sign it using the *public RSA key bytes as the HMAC secret*. A validator that reads
`alg` from the attacker-controlled header would happily verify it. This is the well-known algorithm-
confusion / key-substitution attack.

MMCA.Common's `TokenService` pins the algorithm. On the refresh path, `GetPrincipalFromExpiredToken`
deliberately skips lifetime validation (its job is to read claims out of an already-expired token, with
the relevant analyzer warning suppressed inline and justified) but it re-checks the token's `alg`
header against the expected algorithm and restricts `ValidAlgorithms` to the single expected value. An
attacker cannot substitute an HS256-signed token in place of a real RS256 one. The same pin guards
the cross-service path: the JWKS-forwarded bearer handler (`AddForwardedJwtBearer`, used by extracted
services validating against the issuer's published keys) also restricts `ValidAlgorithms` to
`[RsaSha256]` (added in v1.82.0), so a token whose header claims `HS256` is rejected on the discovery
path too, not only in-process. The token service is also `IDisposable` and owns its RSA handles,
releasing the native key handles on disposal.

The rule of thumb: never let the token tell you how to verify it. The validator decides the algorithm;
the token only supplies the signature.

## When there is no user: the opt-in service token

Everything above covers calls that carry a user. A typed gRPC client registered with
`AddTypedGrpcClient<TClient>` forwards the inbound user's bearer token through
`JwtForwardingClientInterceptor`, and the downstream service validates it against the issuer's
published keys like any other request. Some calls have no user to forward: a background processor, a
webhook, an anonymous request that fans out internally. For those, `MMCA.Common.Grpc` ships a service
token, and it is opt-in per client.

The calling host registers `AddServiceTokenClient(configuration)`, which binds and validates the
`Grpc:ServiceToken` section on start and registers `ServiceTokenProvider` as a singleton. That sends
nothing by itself: a client carries the token only after `.WithServiceToken()` is chained onto its
registration, which adds `ServiceTokenClientInterceptor` to that client alone. The interceptor attaches
`Bearer {serviceToken}` only when the ambient request has no user token, and never overwrites an
`Authorization` entry already on the call, so the user's token always wins.

The provider mints an HS256 token whose `sub` and `svc` claims name the calling service, with `iss`
and `aud` from settings, a fresh `jti`, and a five-minute default lifetime (validated to 1 through 60).
One token serves every outgoing call until its last 60 seconds:

```csharp
// Abridged from ServiceTokenProvider.GetToken (MMCA.Common.Grpc).
var cached = Volatile.Read(ref _cached);
if (IsFresh(cached, now)) { return cached.Value; }       // more than 60 s of lifetime left

lock (_gate)
{
    cached = _cached;                                     // another caller may have minted
    if (IsFresh(cached, now)) { return cached.Value; }
    var minted = Mint(now);                               // HS256, sub and svc = ServiceName
    Volatile.Write(ref _cached, minted);
    return minted.Value;
}
```

The receiving service opts in separately with `AddServiceTokenAuthentication`: a second JwtBearer
scheme that pins `ValidAlgorithms` to HS256, refuses a token without the `svc` claim, and is never the
default scheme. It registers two policies, and only an endpoint under one of them accepts the token.
`InternalCaller` takes an authenticated caller from either scheme, so a user token on the same call is
validated by the user scheme against the issuer's JWKS exactly as described above, and an edge that
admits both kinds of caller tells them apart with `IsServiceCaller()`. `ServiceCaller` evaluates the
service scheme alone, so an end-user token is refused there.

Both apps adopt it. In Store, the Sales service sends the token on its Customers client, and Identity
validates it on the Customers edge under `InternalCaller`. ADC runs three such edges: Engagement sends
its token to Identity's VerifiedUserLookup edge (`InternalCaller`, reached by the roster import, which
has no user) and to Notification's LiveChannelPush edge (`ServiceCaller`, reached only by the
live-channel publish drain), and Identity sends its own to Engagement's TicketInvitation edge
(`ServiceCaller`, for the anonymous sign-in link request).

## Trade-offs, honestly

The JWKS layer is the right model, but it is not free, and the rough edges are worth naming.

- **Two round trips on successful login.** The Identity service's login flow (the shared login
  dual-fetch above, not the JWKS layer itself) pays a tracked re-fetch, a second query on the success
  path. Failed logins (the adversarial majority) never reach that second query, though an unknown
  email still pays one real password-verification cost on purpose, so its timing matches a known
  account's.
  It is a deliberate trade, not an oversight.
- **A small race window between the two fetches.** A user could be deleted between the untracked
  validation and the tracked re-fetch. The re-fetch then returns NotFound, which is the correct
  outcome, so the window is acceptable rather than hidden.
- **Plain-HTTP metadata discovery is an explicit, auditable opt-out.** `AddForwardedJwtBearer`
  resolves `RequireHttpsMetadata` in three steps: explicit argument, then the
  `Authentication:JwtBearer:RequireHttpsMetadata` config key, then `true` everywhere except
  Development, and a resolved `false` outside Development logs one startup warning naming the key. The
  honest residual is that an operator can still set that key to `false`, and both production
  deployments do: ADC and Store validate against Identity's cleartext internal-ingress URL, so their
  bicep sets it explicitly with the justification written beside it. That is a reviewable line in a
  deployment template rather than a default nobody chose.
- **Every dev-only relaxation fails closed on an unknown environment.** The three-step resolution
  above is one instance of a framework-wide rule (ADR-122): a relaxation applies only when the host
  positively identifies itself as Development, and an unknown, absent, or unparseable environment
  gets the production posture. The case that rule exists for is easy to miss: design-time tooling, a
  directly-constructed test context, and a service collection assembled outside a host builder
  register no `IHostEnvironment` at all, so every gate has to decide what "unknown" means.

  Three gates take a nullable environment and answer "not Development" for null.
  `SensitiveDataLoggingGate.IsEnabled` lets EF Core render parameter values into logs only when the
  setting asks for it AND the environment reports Development, so a configuration file copied into a
  deployed host cannot put tokens and password hashes into the log sink on its own. SMTP transport
  security reads the `Smtp:EnableSsl` key first and otherwise enables TLS unless the environment is
  positively Development, and a deployed host that turns TLS off logs a startup warning. The AI
  package scans the service collection for a registered `IHostEnvironment` and keeps prompt and
  completion text out of telemetry when it finds none.

  The residuals are named in the ADR itself. `ASPNETCORE_ENVIRONMENT` is the trust root, so a host
  that misreports itself as Development gets every relaxation at once: the rule concentrates the risk
  on one value instead of removing it. The other Development-gated relaxations (the permissive dev
  CORS policy, the cookie `Secure` flag, HSTS and the CSP built from the same flag, the pseudo-locale,
  the design-time database skip) are plain `IsDevelopment()` checks, not fail-closed gates: the
  server-side ones read an environment the host always supplies, and the one UI-side check (the
  culture switcher offering the pseudo-locale) reads a nullable environment and treats null as not
  Development. One endpoint mapping sits outside the rule altogether: the OpenAPI document is gated on
  `!IsProduction()` (`OpenApiEndpointExtensions.cs:61`) rather than on Development, so a Staging host
  gets it (it exposes API description, not data). And the inventory is manual: nothing fails a
  build when a new environment-conditional branch skips the rule.
- **The invariants in this article fail the build.** Executable tests run the real registration code
  and read the produced options back: the forwarded bearer handler's `ValidAlgorithms` must stay
  `[RsaSha256]`, the `RequireHttpsMetadata` resolution above is asserted step by step (including the
  fail-fast on a cleartext authority with no opt-out), the permissive CORS policy must never support
  credentials while the credentialed one must never widen to any origin, and `RsaJwksProvider` must
  export only the public RSA parameters even when handed a private-key PEM. Beside them, a shared
  `AnonymousEndpointTestsBase` scans controllers and routable components by reflection and ships five
  facts: it fails on any `[AllowAnonymous]` outside an explicit allow-list, on a stale allow-list entry,
  on an empty scan, on an endpoint that declares neither `[Authorize]` nor `[AllowAnonymous]` (a
  stricter gate that is on by default, which a repo not yet ready opts out of explicitly; Common, ADC,
  Store and Helpdesk all keep it on), and on a stale entry in that second, undecorated allow-list. The
  framework's own allow-list holds 29 entries: nineteen credential-exchange actions that cannot
  require a token because issuing one is what they do, or because the caller has no session yet
  (login, register, refresh, the OAuth exchange, the four provider challenges for Google, GitHub,
  Apple and OIDC and the provider callback, OIDC home-realm discovery, forgot-password and
  reset-password, sending and confirming an email-confirmation link, sending and redeeming a sign-in
  link, beginning and completing a passkey sign-in, and the machine-client token endpoint), seven
  credential pages (the email-confirmation and sign-in-link landings among them), and three landing
  and outcome pages that render nothing depending on the caller. The scan matches `ControllerBase`, `RouteAttribute`
  and `AllowAnonymousAttribute` by full-name reflection, which keeps the shared test package free of
  ASP.NET references, and the bearer and CORS invariants run the real registration code and read the
  options back. Two residuals stay
  honest. Minimal-API endpoints opt out through an `.AllowAnonymous()` builder call, which is endpoint
  metadata rather than an attribute, so the JWKS and OIDC discovery endpoints themselves sit outside
  the scan's reach. And the anonymous-endpoint scan is only as complete as the suites that subclass it:
  each consuming repo owns its own allow-list. The framework's thesis is that a rule that matters
  should fail the build, and these rules do.
- **The service token is one shared secret, scoped to the edges that opt in.** It is HS256 over a
  single key that the callers and the receivers both hold, so any holder can mint a token naming any
  service, and the receiving scheme checks that the `svc` claim is present, not which service it
  names. What bounds it is the opt-in on both sides: the scheme is never the default, a plain
  `[Authorize]` endpoint still authenticates the user scheme alone, and only endpoints under
  `InternalCaller` or `ServiceCaller` accept it. Per-service keys
  or transport-level service identity are a deliberate non-goal for traffic that stays inside the
  Container Apps environment; the governance backlog names a service reachable from outside it, or a
  second team owning a service, as the condition to revisit that.

None of these are reasons to share a symmetric secret for user tokens across services. They are the
reasons to wire the asymmetric boundary deliberately, and to keep the one shared key opt-in and narrow.

## Apply this even without MMCA

The pattern ports to any stack with a JWT story:

1. **In a single process, symmetric (HS256) is fine.** Do not add asymmetric complexity you do not
   need. The signer and validator are the same code.
2. **The moment a second service validates tokens it did not mint, go asymmetric (RS256/ES256).** The
   issuer keeps the private key; everyone else gets the public key. A validator should never hold a key
   that can also forge.
3. **Publish the public key as a JWKS document at `/.well-known/jwks.json`** and let the standard
   `JwtBearer` discovery fetch and refresh it. Give each validator one authority value owned by the
   deployment wiring (a gateway origin or the issuer's internal address), so a topology change is a
   config edit rather than a key redistribution.
4. **Pin the algorithm on the validator.** Set the allowed algorithms explicitly and re-check the
   token's `alg` against your expectation. Never let the token's own header choose the verification
   method, or you have shipped the algorithm-confusion attack.
5. **Fall back gracefully.** Serve an empty key set rather than erroring when JWKS is off, so the same
   code path works in monolith and extracted modes.

The takeaway: **the key that validates a token should never be the key that mints one.** Asymmetric
signing plus JWKS discovery is how you keep that true across a fleet, and it is the extraction point that makes
pulling a module out into its own service a config change rather than an auth rewrite.

---

**What we covered:** why a shared symmetric secret turns one leak into a system-wide forgery, how
RS256 + a published JWKS document lets extracted services validate against the issuer's public keys
with no secret of their own, how discovery (gateway-routed under the local AppHost, direct to
Identity's internal ingress when deployed) and the empty-key-set fallback keep the boundary stable,
why algorithm pinning closes the key-substitution attack that publishing a public key would otherwise
open, how the opt-in service token covers calls with no user while keeping its one shared key narrow,
and how ADR-122 makes every dev-only relaxation fail closed when the environment is unknown.

**Next in the series:** password hashing done right: PBKDF2-SHA512, 600k iterations, and timing-safe
comparison, the credential-at-rest half of the same security story.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-004 behind this
pattern, or `dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-004 (cross-service token validation via JWKS / OIDC discovery): `Website/docs-src/adr/004-authentication-dual-fetch.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, Microservices, Authentication*

*Notes (evidence audit, re-verified 2026-11-25 against MMCA.Common v1.319.0, `MMCA.Common/FACTS.md:14`):
four body claims changed, header unchanged. (1) Service-token adoption: both apps adopt it, and the
receiving registration adds a second, service-only policy. `ServiceTokenDefaults.cs` `InternalCaller`
`:22`, `ServiceCaller` `:29` (user scheme not evaluated `:24-28`), `svc` `:35`;
`ServiceTokenServiceCollectionExtensions.cs` `AddServiceTokenClient` `:35-43`, two-policy and
never-default doc `:45-62`, `AddServiceTokenAuthentication` `:66`, default-scheme guard `:81-85`,
policies `:87-94` (`ServiceCaller` requires the `svc` claim `:94`), `ValidAlgorithms = [HmacSha256]`
`:151`, `svc` presence check `:162-171`; `ServiceCallerClaimsPrincipalExtensions.cs` `IsServiceCaller`
`:21-29`. ADC: `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs` `AddServiceTokenAuthentication`
`:140`, `AddServiceTokenClient` `:146` (TicketInvitation, anonymous sign-in link `:142-145`),
VerifiedUserLookup under `InternalCaller` `:344`; `MMCA.ADC.Engagement.Service/Program.cs`
`AddServiceTokenClient` `:232` (roster import and live-channel drain `:227-231`),
`AddServiceTokenAuthentication` `:238`, TicketInvitation under `ServiceCaller` `:278`;
`MMCA.ADC.Notification.Service/Program.cs` `AddServiceTokenAuthentication` `:137`, LiveChannel under
`ServiceCaller` `:160`; `.WithServiceToken()` at `MMCA.ADC.Engagement.Contracts/DependencyInjection.cs:110`,
`MMCA.ADC.Identity.Contracts/DependencyInjection.cs:74`, `MMCA.ADC.Notification.Contracts/DependencyInjection.cs:51`.
Store: `MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs` `AddServiceTokenAuthentication`
`:85`, Customers under `InternalCaller` `:149`; `MMCA.Store.Sales.Service/Program.cs:147`
(`AddServiceTokenClient`); `MMCA.Store.Identity.Contracts/DependencyInjection.cs:46` (`.WithServiceToken()`).
(2) The service-token trade-off now names both policies and the opt-in edges (same anchors). (3) The
allow-list is 29 entries
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Api/AnonymousEndpointTests.cs:22-82`):
nineteen actions `:26-64` (sign-in links `:46-47`, passkeys `:49`, `:51`, machine token `:53`, OIDC
challenge `:60`, home-realm discovery `:64`), seven credential pages `:70-77`, three landing pages
`:79-81`; strict gate on `:87`; the scan floor `MinimumScannedTypes => 21` `:91` counts scanned types,
not list entries. (4) Subclass doc comments: ADC
`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:23`,
Store `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs:20`;
base wording `MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:31`, class
`:74`. Re-read and confirmed unchanged: `ServiceTokenProvider.cs` singleton and 60-second remark
`:17-21`, class `:23`, `RefreshWindow` `:26`, HS256 credentials `:46-48`, `GetToken` `:52-74` (the code
block is abridged from `:54-73`), `IsFresh` `:76-77`, `Mint` `:79-102` with `sub`/`svc`/`jti` `:87-89`;
`ServiceTokenSettings.cs` section `:21`, maximum 60 `:27`, `LifetimeMinutes = 5` `:51`, 1-to-60 check
`:87`; `MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs`
config key `:25`, `AddForwardedJwtBearer` `:52`, `[RsaSha256]` pins `:110`, `:249`, `[HmacSha256]` `:265`;
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/TokenService.cs` `IDisposable` `:27`,
`GetPrincipalFromExpiredToken` `:204`, pin `:218`; `JwtSettings.cs:30` (RS256 default);
`RsaJwksProvider.cs:14`, `PublicationOnly` `:22`; `OpenApiEndpointExtensions.cs:61`.
Flag (2026-11-25): `ServiceTokenClientInterceptor` (user-token-first precedence, no overwrite) was not
re-read this run; the file is not at `MMCA.Common.Grpc/Authentication/`, so its location and anchors
are unconfirmed.
Flag (2026-11-25): not re-read this run, text kept as is: the ADR-004, ADR-007 and ADR-122 line
anchors, `JwksEndpointExtensions.cs`, `WithJwksDiscovery` in the AppHost extensions, the ADC and Store
bicep Authority and `RequireHttpsMetadata` anchors, the three ADR-122 gates
(`SensitiveDataLoggingGate`, `SmtpTransportSecurity`, the AI `DependencyInjection`), the
`AnonymousEndpointTestsBase` five facts and reflection rationale, the invariant tests, the
Minimal-API discovery endpoints' `.AllowAnonymous()` residual, and the governance backlog's
service-token re-open condition (`Website/docs-src/governance/common-RemediationBacklog.md`).
History: the 2026-10-22 entry added the service-token section (user-approved); the 2026-10-08 entry
settled the undecorated-endpoint gate, the login re-fetch and the unpinned-`ValidIssuer` reason; the
2026-10-02 entry replaced the "dual-fetch" framing with what ADR-004 says and folded in ADR-122
(user-approved). Not changed by design: the CTA's "2-minute ADR-004" (CTA block out of scope).*

- Full series index: https://ivanball.github.io/writing.html
