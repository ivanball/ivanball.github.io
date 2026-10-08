# Cross-service auth without a shared secret: JWKS discovery

> Series: MMCA.Common · Article #16 · Pillar P3 · Group G08 · Rubric §11 · ADR-004 · ADR-122 ·
> Status: grounded in `Website/docs-src/adr/004-authentication-dual-fetch.md`,
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
(`AuthenticationService.cs:20` in both ADC and Store). It is shared framework login code, not a
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

## Trade-offs, honestly

The JWKS layer is the right model, but it is not free, and the rough edges are worth naming.

- **Two round trips on successful login.** The Identity service's login flow (the shared login
  dual-fetch above, not the JWKS layer itself) pays a tracked re-fetch, a second query on the success
  path. In practice the first query warms the database buffer pool so the second is near-instantaneous,
  and failed logins (the adversarial majority) pay nothing extra. It is a deliberate trade, not an
  oversight.
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
  Development. Two endpoint mappings sit outside the rule altogether: the OpenAPI document and the
  Scalar reference UI are gated on `!IsProduction()` rather than on Development, so a Staging host
  gets them (both expose API description, not data). And the inventory is manual: nothing fails a
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
  framework's own allow-list holds 21 entries: twelve credential-exchange actions that cannot require
  a token because issuing one is what they do, or because the caller has no session yet (login,
  register, refresh, the OAuth exchange, the three provider challenges and the provider callback,
  forgot-password and reset-password, and sending and confirming an email-confirmation link), six
  credential pages (the email-confirmation landing among them), and three landing and outcome pages
  that render nothing depending on the caller. NetArchTest's fluent API cannot express this pair,
  which is why
  the rules live as full-name reflection and options-resolution tests instead. Two residuals stay
  honest. Minimal-API endpoints opt out through an `.AllowAnonymous()` builder call, which is endpoint
  metadata rather than an attribute, so the JWKS and OIDC discovery endpoints themselves sit outside
  the scan's reach. And the anonymous-endpoint scan is only as complete as the suites that subclass it:
  each consuming repo owns its own allow-list. The framework's thesis is that a rule that matters
  should fail the build, and these rules do.

None of these are reasons to share a symmetric secret across services. They are the reasons to wire the
asymmetric boundary deliberately.

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
open, and how ADR-122 makes every dev-only relaxation fail closed when the environment is unknown.

**Next in the series:** password hashing done right: PBKDF2-SHA512, 600k iterations, and timing-safe
comparison, the credential-at-rest half of the same security story.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-004 behind this
pattern, or `dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-004 (cross-service token validation via JWKS / OIDC discovery): `Website/docs-src/adr/004-authentication-dual-fetch.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, Microservices, Authentication*

*Notes (evidence audit, 2026-10-08, MMCA.Common v1.233.0): Read this run; five body claims changed.
(1) Common's anonymous allow-list is 21 entries, not 19:
`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Api/AnonymousEndpointTests.cs:22-66`,
twelve actions `:26-50` (the two added are `SendEmailConfirmationAsync` and `ConfirmEmailAsync` on the
generic `EmailConfirmationControllerBase`, `:42-43`), six credential pages `:56-61`, three landing pages `:63-65`,
stricter gate `:71`, `MinimumScannedTypes => 21` `:75`. (2) The undecorated-endpoint gate is on by
default and opt-out, not opt-in:
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Api/AnonymousEndpointTestsBase.cs:69`
(`RequireExplicitAuthorizationDecision => true`, doc "On by default ... opts out explicitly" `:54-60`);
all four suites keep it on (Common `:71`, ADC `:139`, Store `:86`, Helpdesk `:45`). (3) The login
tracked re-fetch does not persist the refresh token: refresh tokens live in their own session rows,
and the re-fetch loads the instance the `CreateAccessToken` hook mints from and turns the delete race
into a 404 (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:195-198`,
`GetByIdAsync` `:199`, `Error.NotFound` `:200-203`). (4) The unpinned-`ValidIssuer` reason is "the
authority need not be the `iss` origin", not "the authority is an internal address": locally the
authority is the gateway's HTTPS endpoint (ADR-004 `:69-74`;
`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:332-335`). (5) ADR-122's
plain-check inventory (`:47-78`) scopes the non-nullable environment to server-side checks, names the
UI-side pseudo-locale check that treats null as not Development (`:50-51`, `:68-74`;
`MMCA.Common/Source/Presentation/MMCA.Common.UI/Globalization/CultureSwitcher.razor:24-27`), adds CSP
(`:65-66`) and the design-time database skip (`:75-78`), and names `MapCommonOpenApi` and
`MapCommonScalarUi` as `!IsProduction()` mappings outside the rule (`:80-87`); the body now states all
of that. The trade-offs lead-in no longer attributes the login rough edges to the §11 review: the §11
row (`Website/docs-src/governance/common-ArchitectureScorecard.md:75`) covers JWKS, fail-closed
resolution and the anonymous-endpoint gate, and no scorecard, backlog or ADR line names the login
round trips or the race window (the buffer-pool remark is engineering judgement, not a cited
measurement). Earlier entry (2026-10-02, v1.221.0), anchors refreshed 2026-10-08: ADR-004
(`Website/docs-src/adr/004-authentication-dual-fetch.md`) is titled "Cross-Service Token Validation
via JWKS / OIDC Discovery" (`:1`) and never uses the phrase "dual-fetch" in its body: the body's former
framing ("discover the key, fall back to an empty set. That is the dual-fetch") was unsupported and is
replaced by what the ADR does say. Empty-set issuer hygiene: `:34-37` and `:151`; central mapping
of both well-known endpoints `:38-43`; unpinned `ValidIssuer` `:69-74`, confirmed in source at
`MMCA.Common/Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs:96-101`.
Discovery routing and its fallback (ADR-004 `:86-102`) are the local AppHost path only:
`MMCA.Common/Source/Hosting/MMCA.Common.Aspire.Hosting/Extensions.cs:309-311` (`WithJwksDiscovery`,
optional gateway), gateway-vs-fallback comment `:321-331`, endpoint choice `:332-334`, environment
variable set `:335`. Both deployed
environments set the authority to Identity's internal ingress directly, so the body's former "JWKS
discovery is routed through the YARP gateway ... the gateway route updates, not every consumer" was
wrong for production and is rewritten: `MMCA.ADC/infra/main.bicep:2005`, `:2141`, `:2295` and
`MMCA.Store/infra/main.bicep:1684`, `:1819` (`Authentication__JwtBearer__Authority` =
`'http://${identityApp.name}'`). The JWKS bullet the body sources is `MMCA.Common/AGENTS.md:131` under
`### Microservices Extraction Boundaries` (`:125`); `MMCA.Common/CLAUDE.md` is now only an `@AGENTS.md`
import, so the citation moved (that bullet still says "discovery routes through the gateway", which is
true of the AppHost path only). Login dual-fetch anchors:
`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:64` (class),
`LoginAsync` `:123`, untracked `FindUntrackedByEmailAsync` `:148`, tracked `Repository.GetByIdAsync`
`:199`, "untracked-then-tracked dual-fetch" doc comment `:22`; ADC
`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:20`
("dual-fetch pattern", class `:50`) and Store
`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs:20`
(class `:26`) (consumer anchors carried, not re-read 2026-10-08). Forwarded JWT bearer lives in the
partial file `WebApplicationBuilderExtensions.Authentication.cs`: sole public `AddForwardedJwtBearer`
`:52-57`, three-step resolution `:64-66`, `RequireHttpsMetadataConfigKey` const `:25`,
`InsecureJwtMetadataWarningStartupFilter` registration `:68-72`, private `AddForwardedJwtBearerCore`
`:77`, forwarded RS256 pin `ValidAlgorithms = [SecurityAlgorithms.RsaSha256]` `:109`; in-process
`BuildValidationParameters` `:215`, RS256 pin `:238`, HS256 pin `:254`. Public surface is in
`MMCA.Common.API/PublicAPI.Shipped.txt` (extension form `:441`, const `:498`, static form `:594`); the
Unshipped file carries no `*REMOVED*` lines and no bare-bool overload is present. h2c opt-out with
justification comments: ADC `main.bicep:2009`, `:2145`, `:2299` (comments `:2006-2008`,
`:2142-2144`, `:2296-2298`), Store `main.bicep:1689`, `:1824` (comments `:1685-1688`, `:1820-1823`).
Dev CORS in `WebApplicationBuilderExtensions.cs`: credentialed `AllowCredentials()` `:142`,
`#pragma warning disable S5122` `:144`, `AllowAnyOrigin()` `:146`, restore `:149`. ADR-122 fold-in
(body bullet, user-approved): `Website/docs-src/adr/122-dev-only-relaxations-fail-closed.md`
decision `:21-23`, three gates `:27-40`, `RequireHttpsMetadata` as the hybrid `:42-45`, plain checks
`:47-78`, `!IsProduction()` mappings `:80-87`, rationale from `:102`; source verified 2026-10-02:
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/SensitiveDataLoggingGate.cs:35-36`
(AND of setting and `environment?.IsDevelopment() == true`, null rule `:18-22`),
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Mail/SmtpTransportSecurity.cs:48`
(`environment?.IsDevelopment() != true`) and `:72` (the non-Development warning condition),
`MMCA.Common/Source/Core/MMCA.Common.AI/DependencyInjection.cs:262` (`IsDevelopmentHost`), called at
`:177`, "Fails CLOSED" remark `:257`. Anonymous-endpoint fitness: Common's subclass
`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Api/AnonymousEndpointTests.cs:14`
(anchors as in the 2026-10-08 entry above). Consumer floors: ADC 80
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Api/AnonymousEndpointTests.cs:144`, gate
`:139`), Store 37 (was 35;
`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Api/AnonymousEndpointTests.cs:94`, gate
`:86`), Helpdesk 1
(`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/AnonymousEndpointTests.cs:35`, gate
`:45`). Counts per `MMCA.Common/FACTS.md`: 153 test methods across 61 abstract `*TestsBase` classes
(`:51`), of which Common's own build executes 410 (`:54`); 22 published packages (`:19`); v1.233.0 as
of 2026-10-07 (`:4`, `:14`). Governance: the §11 Security row is at
`Website/docs-src/governance/common-ArchitectureScorecard.md:75` and cites
`WebApplicationBuilderExtensions.Authentication.cs:109`; the backlog's open-work table holds #11 at
4 / 8 with a named Implementation lever (authenticate the broker origin headers, give in-cluster gRPC
a service identity, default tenant resolution to claim-only;
`Website/docs-src/governance/common-RemediationBacklog.md:12`, item heading `:37`). The earlier
backlog anchors (`:1066-1104`, the 1.160.0 consumer-sweep pin, the 2026-08-23 re-adjudication, the
checked bullets at `:1557-1559`) no longer exist after the backlog restructure and are dropped.
Carried from the 2026-10-02 audit's CONFIRMED verdicts and not re-opened in either apply pass:
`JwtSettings.cs:30` (RS256 default), `RsaJwksProvider.cs:21` (PublicationOnly lazy,
public-only export, empty set), `JwksEndpointExtensions.cs:20`, `TokenService.cs:197`
(`GetPrincipalFromExpiredToken` pin), `InsecureJwtMetadataWarningStartupFilter.cs:26`,
`GatewayCorsExtensions.cs:38`, `AnonymousEndpointTestsBase.cs:30` (five facts), the invariant tests
starting at `ForwardedJwtBearerSecurityTests.cs:25`, `PasswordHasher.cs:24`, and `LICENSE:2`.*

- Full series index: https://ivanball.github.io/writing.html
