# Cross-service auth without a shared secret: JWKS dual-fetch

> Series: MMCA.Common · Article #16 · Pillar P3 · Group G08 · Rubric §11 · ADR-004 ·
> Status: grounded in `Website/docs-src/adr/004-authentication-dual-fetch.md`, `MMCA.Common/CLAUDE.md`
> (the microservices extraction section), and `Website/docs-src/onboarding/group-08-auth.md`. No em dashes.

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
// (routed through the YARP gateway) and validates RS256 tokens against the public keys.
// The validator holds NO secret. A leaked public key cannot mint tokens.
```

(Source: `RsaJwksProvider.cs`, `IJwksProvider.cs`, and the JWKS notes in `MMCA.Common/CLAUDE.md`'s
microservices extraction section.)

## The dual-fetch, and the graceful empty set

The dual-fetch ADR-004 describes is in the key discovery itself: a validator **discovers** the issuer's
public key from the JWKS endpoint, and the framework **falls back gracefully** when the key is not
there. When JWKS publishing is disabled (the default for a monolith) or no key is configured,
`RsaJwksProvider` returns an **empty key set** rather than throwing. The endpoint stays a valid, pollable
URL instead of erroring. A monolith that never turns JWKS on still answers `/.well-known/jwks.json` with
an empty document, so flipping a service into extracted mode does not require standing up new endpoints.
Discover the key; fall back when it is not there. That is the dual-fetch.

A different two-fetch is easy to conflate with this one, so it is worth naming plainly: the shared login
flow, `AuthenticationServiceBase<TUser>.LoginAsync` in `MMCA.Common.Application`, does an **untracked**
read to validate credentials (so the adversarial majority of login traffic, the failed attempts, never
pays EF Core change-tracking cost), then a **tracked** re-fetch only on success to persist the rotated
refresh token. The base's own doc comment names it the "untracked-then-tracked dual-fetch"; the ADC and
Store Identity modules are thin sealed subclasses that supply the app-specific hooks (the untracked
lookup, the claim set) and re-label it "dual-fetch pattern" in their class doc comments
(`AuthenticationService.cs:17` in ADC, `:16` in Store). It is shared framework login code, not a
per-app copy, but it is still not part of ADR-004's cross-service validation design.

JWKS discovery is routed through the **YARP gateway**, not pointed at each service's internal address.
The validator asks the gateway for the issuer's JWKS document, and the gateway forwards it to whichever
host currently owns Identity. This keeps the validator's config stable across topology changes: when
Identity moves, redeploys, or scales, the gateway route updates, not every consumer.

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

The JWKS layer is the right model, but it is not free, and the §11 review of the framework names the
rough edges.

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
  deployments do: ADC and Store validate against an internal-ingress cleartext `http://identity`, so
  their bicep sets it explicitly with the justification written beside it. That is a reviewable line in
  a deployment template rather than a default nobody chose. Permissive dev CORS is a development-only
  affordance, selected by environment.
- **The invariants in this article fail the build.** Executable tests run the real registration code
  and read the produced options back: the forwarded bearer handler's `ValidAlgorithms` must stay
  `[RsaSha256]`, the `RequireHttpsMetadata` resolution above is asserted step by step (including the
  fail-fast on a cleartext authority with no opt-out), the permissive CORS policy must never support
  credentials while the credentialed one must never widen to any origin, and `RsaJwksProvider` must
  export only the public RSA parameters even when handed a private-key PEM. Beside them, a shared
  `AnonymousEndpointTestsBase` scans controllers and routable components by reflection and ships five
  facts: it fails on any `[AllowAnonymous]` outside an explicit allow-list, on a stale allow-list entry,
  on an empty scan, on an endpoint that declares neither `[Authorize]` nor `[AllowAnonymous]` (a
  stricter gate each suite opts into, which the framework turns on for itself), and on a stale entry in
  that second, undecorated allow-list. The framework's own allow-list holds 18 entries: ten
  credential-exchange actions that cannot require a token because issuing one is what they do (login,
  register, refresh, the OAuth exchange, the three provider challenges and the provider callback,
  forgot-password and reset-password), the five credential pages, and three landing and outcome pages
  that render nothing depending on the caller. NetArchTest's fluent API cannot express this pair, which is why
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
   `JwtBearer` discovery fetch and refresh it. Route discovery through your gateway so topology changes
   do not ripple into every consumer's config.
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
with no secret of their own, how ADR-004's dual-fetch (discover the key, fall back to an empty set)
and gateway-routed discovery keep the boundary stable, and why algorithm pinning closes the key-
substitution attack that publishing a public key would otherwise open.

**Next in the series:** password hashing done right: PBKDF2-SHA512, 600k iterations, and timing-safe
comparison, the credential-at-rest half of the same security story.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-004 behind this
pattern, or `dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-004 (authentication dual-fetch): `Website/docs-src/adr/004-authentication-dual-fetch.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, Microservices, Authentication*

*Notes (evidence audit, 2026-09-19, MMCA.Common v1.205.0): ADR-004
(`Website/docs-src/adr/004-authentication-dual-fetch.md`) is still the mapped ADR; its contents were
not re-read this run, and the description carried here (cross-service token validation only: RS256
issuer + public-key publish, `AddForwardedJwtBearer` on validators, a deliberately unpinned
`ValidIssuer` taken from the discovery document, gateway-routed discovery, `RsaJwksProvider`
empty-set fallback and `ValidAlgorithms` pinning, with NO login untracked/tracked two-query) comes
from the 2026-08-22 audit. Everything below was re-read this run. Algorithm selection is the concrete
`JwtSettings.SigningAlgorithm`, defaulting to `JwtSigningAlgorithm.RS256`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/JwtSettings.cs:30`); the `IJwtSettings`
interface the published article named has no `.cs` definition anywhere under `MMCA.Common/Source` and
survives only in the Infrastructure PublicAPI baseline files, so the body names the concrete settings
type instead. `RsaJwksProvider` builds its key set through a `Lazy<JsonWebKeySet>` created with
`LazyThreadSafetyMode.PublicationOnly` (`Auth/RsaJwksProvider.cs:16-22`, whose comment states that the
default mode would cache a factory exception forever and brick `/.well-known/jwks.json`), and the
PEM-reading comment at `:66-68` says the provider runs on the first request with only a successful
result cached: the body's "cached for the process lifetime, because key material is loaded once at
startup" was wrong on both halves and is corrected. Empty-key-set fallback confirmed in the same
file's class doc (`:10-11`). JWKS discovery is routed through the YARP gateway. Login dual-fetch:
`MMCA.Common.Application` ships the abstract `AuthenticationServiceBase<TUser>`
(`Auth/AuthenticationServiceBase.cs:74`) whose `LoginAsync` (`:156`) runs the untracked-then-tracked
flow (untracked `FindUntrackedByEmailAsync` at `:181`, tracked `Repository.GetByIdAsync` re-fetch at
`:232`; the base doc comment names the "untracked-then-tracked dual-fetch" at `:22`). ADC's and
Store's sealed subclasses re-label it "dual-fetch pattern" in their class doc comments
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:17`,
class at `:46`;
`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs:16`,
class at `:22`). The v1.82.0 forwarded-path pin `ValidAlgorithms = [SecurityAlgorithms.RsaSha256]` is
`Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:601`, inside the
private `AddForwardedJwtBearerCore` (`:570`); the in-process pins in `BuildValidationParameters`
(`:728`) are `:751` (RS256, `[RsaSha256]`) and `:767` (HS256, `[HmacSha256]`). Every one of those
anchors drifted again from the 2026-08-22 audit's `:521`/`:490`/`:647`/`:670`/`:686` (itself past
`:464`/`:613`/`:629` and `:274`/`:308`/`:434`), the fourth successive move of this block; the behavior
is unchanged, and the §11 scorecard row cites the same current `:601` and `:751,767`.
Secure-by-default HTTPS metadata: the only public `AddForwardedJwtBearer` is the
`(authority, audience, IConfiguration, IHostEnvironment, bool? requireHttpsMetadata = null)` overload
(`:545-550`), resolving `requireHttpsMetadata` then `configuration.GetValue<bool?>(RequireHttpsMetadataConfigKey)`
then `!environment.IsDevelopment()` at `:557-559`, with the public const
`RequireHttpsMetadataConfigKey = "Authentication:JwtBearer:RequireHttpsMetadata"` at `:56`. The
transitional bare-bool overloads are gone: both forms are `*REMOVED*` in
`MMCA.Common.API/PublicAPI.Unshipped.txt:2-3`, and the shipping surface is `:42` (extension form),
`:65` (the config const) and `:76` (static form). A resolved `false` outside Development registers
`InsecureJwtMetadataWarningStartupFilter` (`:561-565`), which moved to
`Startup/Auth/InsecureJwtMetadataWarningStartupFilter.cs` (an `IStartupFilter` because logging
providers are not configured during registration, `:10-16`; `LoggerMessage` at `:26`). The h2c opt-out
is real and auditable in both prod deployments, each preceded by a justification comment naming the
ACA internal-ingress h2c authority: `MMCA.ADC/infra/main.bicep:1830`, `:1962`, `:2112` (comment at
`:1827-1829`) and `MMCA.Store/infra/main.bicep:1652`, `:1779` (comment at `:1648-1651`). Those bicep
edits and the consumer test suites are landed, not held: the backlog records that the consumer sweep
landed and that ADC and Store both pin MMCA.Common 1.160.0
(`Website/docs-src/governance/common-RemediationBacklog.md:1070-1072`). Permissive dev CORS is
unchanged: `AllowAnyOrigin` at `WebApplicationBuilderExtensions.cs:695` inside the
`#pragma warning disable S5122` at `:693` / restore at `:698` justifying it as Development-only, with
the credentialed policy's `AllowCredentials()` at `:691`; the gateway variant is
`Source/Hosting/MMCA.Common.Aspire/GatewayCorsExtensions.cs:38` (pragma `:36`/`:41`,
`AllowCredentials` at `:52`). Security fitness tests: `AnonymousEndpointTestsBase` moved to
`Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Api/AnonymousEndpointTestsBase.cs` (class
`:30`), matches `AllowAnonymousAttribute`, `AuthorizeAttribute` and `ControllerBase` by full name
(`:32-34`, so the package keeps zero ASP.NET references) and ships FIVE facts, not the three the
published article named: `AnonymousEndpoints_AreAllowListed` (`:79`), `ScannedEndpointSet_IsNotEmpty`
(`:91`, the non-vacuity floor), `AllowList_HasNoStaleEntries` (`:104`),
`Endpoints_DeclareAnAuthorizationDecision` (`:118`, gated by `RequireExplicitAuthorizationDecision`,
default `false` at `:68`) and `UndecoratedAllowList_HasNoStaleEntries` (`:141`). Attributes are read
`DeclaredOnly` + `inherit: false` (`:243`, `:266-268`) so a framework base action is reported once,
and the XML doc names the residual limitation, minimal-API `.AllowAnonymous()` metadata being
invisible to static reflection (`:18-24`). Common's own subclass moved to
`Tests/Architecture/MMCA.Common.Architecture.Tests/Api/AnonymousEndpointTests.cs:14`, scans the API
and UI assemblies (`:16-20`), opts into the stricter gate with
`RequireExplicitAuthorizationDecision => true` (`:63`) and sets `MinimumScannedTypes => 21` (`:67`,
"12 API controller types plus the routable UI pages"). Its allow-list holds 18 entries (`:22-58`), not
four: `AuthControllerBase.LoginAsync` / `.RegisterAsync` / `.RefreshAsync`,
`OAuthControllerBase.ExchangeAsync` / `.GoogleLogin` / `.GitHubLogin` / `.AppleLogin` /
`.CompleteAsync`, the two `PasswordResetAuthControllerBase` recovery actions (`ForgotPasswordAsync` /
`ResetPasswordAsync`, allow-listed under the reflected arity-suffixed full name), the five
`MMCA.Common.UI.Pages.Auth` credential pages (`Login`, `Register`, `ForgotPassword`, `ResetPassword`,
`OAuthComplete`) and three landing/outcome pages (`Home`, `Forbidden`, `NotFound`); the body was
corrected accordingly. Consumer subclasses set their own floors and all opt into the stricter gate:
ADC `MinimumScannedTypes => 80`
(`MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Api/AnonymousEndpointTests.cs:157`, gate at
`:152`), Store 35
(`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Api/AnonymousEndpointTests.cs:96`, gate
at `:92`), Helpdesk 1
(`MMCA.Helpdesk/Tests/Architecture/MMCA.Helpdesk.Architecture.Tests/AnonymousEndpointTests.cs:35`,
gate at `:45`); their allow-list entry counts were not re-tallied this run. The executable invariant
tests run the real registration and read the produced options back:
`Tests/Presentation/MMCA.Common.API.Tests/Startup/Auth/ForwardedJwtBearerSecurityTests.cs` (moved
under `Startup/Auth/`) asserts the RS256 pin (`:25`), the resolution matrix (`:35` production-true,
`:40` development-false, `:45` config-key honored, `:59` explicit argument beats config), the
fail-fast on a cleartext authority with no opt-out (`:74`) and the startup-warning registration
(`:86`, absent in Development `:101`);
`Tests/Presentation/MMCA.Common.API.Tests/Startup/WebApplicationBuilderExtensionsTests.cs:248`
(permissive policy never supports credentials), `:265` (credentialed policy never allows any origin)
and `:282` (fails closed on no configured origins), with the gateway equivalents at
`Tests/Hosting/MMCA.Common.Aspire.Tests/Gateway/GatewayCorsExtensionsTests.cs:22,36,46`; and
`Tests/Core/MMCA.Common.Infrastructure.Tests/Auth/RsaJwksProviderTests.cs:73`
(`GetJsonWebKeySet_WhenGivenAPrivateKeyPem_ExportsOnlyThePublicParameters`). Counts per `FACTS.md:48`:
136 test methods across 53 abstract `*TestsBase` classes, of which Common's own build executes 267
(`:51`); the framework publishes 19 packages (`:19`) at v1.205.0, snapshot 2026-09-17 (`:4`, `:14`).
Governance: the §11 Security row is at
`Website/docs-src/governance/common-ArchitectureScorecard.md:91` (Weight 3 / Maturity 4 /
Implementation 8 / Weighted 12/24, all four values unchanged, only the anchor moved; its stated
Implementation-8 caps remain deployer-delegated secret binding and RBAC with capability indirection).
The backlog's security-invariants wave sits at `common-RemediationBacklog.md:1066-1104` and records
the opposite of the earlier note: `:1099-1103` is a 2026-08-23 re-adjudication in which §11 WAS
re-scored with this evidence and HELD at Maturity 4 / Implementation 8, because the wave is
predominantly automatic enforcement of already-scored capability. The historical single-axis #11
Security fix bullet for the NetArchTest security invariants is checked off at `:1558`, with the CI
vuln-audit gate at `:1557` and `SECURITY.md` at `:1559`.*

- Full series index: https://ivanball.github.io/writing.html
