# Defending the API edge: three controls that cover the whole surface

> Series: MMCA.Common · Article #30 (deep-dive) · Pillar P2/P4 · Group G08 · Rubric §11 · ADR-019/029/124 ·
> Status: grounded in the `MMCA.Common.API` rate-limit source (`WebApplicationBuilderExtensions.RateLimiting.cs`
> and `RateLimitingSettings`), the anti-spray defaults on seven `MMCA.Common.API` controller bases and the tests
> that pin them, the `MMCA.Common.Infrastructure/Auth` login-protection source, the six `MMCA.Common.Application`
> call sites, both apps' Identity adoption, the composed `MMCA.Common.ServiceHost` and `MMCA.Common.UI.Web` host
> builders, the `MMCA.Common.UI.Web/Hardening` kit both UI hosts consume, and
> `Website/docs-src/adr/019-rate-limiting.md` (Accepted, revised 2026-08-01, 2026-08-18, 2026-09-07,
> 2026-09-10, 2026-09-19, 2026-09-30, 2026-10-01, 2026-10-06, 2026-10-07, 2026-10-19, 2026-10-21,
> 2026-10-26, 2026-10-28, 2026-11-17 and 2026-11-23), `Website/docs-src/adr/029-authentication-brute-force-protection.md`
> (Accepted 2026-06-27, revised through 2026-11-23) and `Website/docs-src/adr/124-blazor-circuit-ceiling-ui-edge.md`
> (Accepted 2026-09-19, revised 2026-09-25, 2026-10-01, 2026-10-06, 2026-10-07, 2026-10-21, 2026-10-26,
> 2026-10-28 and 2026-11-23). No em dashes.

**Subtitle:** A global "N requests per minute" limiter feels like edge protection until you notice what
it cannot do: it cannot key an anonymous login attempt to a principal, because at login time there is no
principal yet. So the credential-stuffing bot sails straight through the exemption. Lock the account
after five failures and you catch the bot guessing one address; you still miss one password sprayed
across a thousand of them. Here are the three complementary controls that close the gap, and why it
takes three.

---

You turn on rate limiting and you feel safer. The middleware ships in ASP.NET Core, you wire a global
limiter at "300 requests per minute," and the abusive-client problem feels handled. A scraper stuck in a
loop, a buggy SPA retrying forever, one account hammering an expensive endpoint: all capped.

Then you think about how you would actually cap that 300-per-minute. By what key? If you partition by IP,
you have a problem the moment a Blazor Server UI fronts your public browsing: every anonymous visitor
shares the UI host's outbound IP, so the IP bucket throttles all of them as if they were a single abuser.
If you partition by authenticated principal instead, you have the opposite problem: an anonymous request
has no principal to key on. And the single most attractive anonymous target you have, the login and
registration endpoints, is exactly where there is no principal yet. A credential-stuffing bot submitting a
thousand email/password guesses is, to a per-principal limiter, a thousand unauthenticated requests with
nothing to count them by.

So the global limiter has to make a choice, and it makes the honest one: it exempts anonymous traffic
rather than throttle legitimate shared-origin browsing, with one narrow metered exception for the
real-time hub paths. Which means the most-attacked endpoints in the whole application are the ones the
limiter deliberately does not cover. That is not a bug in the limiter. It is the boundary of what a
per-principal request cap can do, and it is the reason one layer is never enough at the edge.

## Why it matters

"Add rate limiting" is not a decision. The load-bearing questions are *who* gets limited, *by what
partition key*, and *what is exempt*. A naive global IP bucket gets all three wrong for this deployment:
it throttles cached public reads that should be cheap, it throttles every Blazor Server visitor as one
shared-IP abuser, and it treats login brute-force as if it were the same threat as general overload when
it is a completely different one with a completely different control.

The threats genuinely differ. General overload is an authenticated principal driving too much database
work, and the right control is a per-principal request cap. Credential stuffing is an anonymous attacker
guessing passwords against a *known* email, and the right control is account lockout keyed on the
submitted identity. Registration spam is an anonymous attacker creating accounts in bulk from an IP, and
the right control is a per-IP signup throttle. And password spray is one password tried once each against
a thousand different emails, which every per-account counter reads as a single failure and the
anonymous-exempt global limiter never sees at all: the right control there is a cap on credential
submission per source. One global bucket conflates all of them and serves none of them well.

So MMCA.Common does not ship one limiter. It ships three controls, drawn precisely along the lines the
first one cannot cross: an authenticated-only global limiter that caps attributable, expensive traffic per
principal, a pre-authentication service that keys on the identity being tried rather than on a principal,
and a per-IP throttle on the anonymous auth endpoints that catches the spray neither of the other two can
count. Together they cover the whole edge.

## The MMCA answer: an authenticated-only global limiter, plus two controls for the surface it exempts

### Layer one: cap the traffic that is both attributable and expensive

`AddCommonRateLimiting` (in `MMCA.Common.API`, the partial
`Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.RateLimiting.cs:425`) installs a
`GlobalLimiter` (`:437-438`) that runs on every request. Its partition function,
`GlobalRateLimitPartition` (`WebApplicationBuilderExtensions.RateLimiting.cs:172-197`), makes three decisions
in order, and the order is the whole design.

First, it exempts infrastructure traffic outright. `IsRateLimitBypassed` (`:76-80`) sends the request to
`GetNoLimiter("__infra")` (`:176`) for `/health` (`:77`), `/alive` (`:78`), JWKS and OIDC discovery under
`/.well-known` (`:79`), and any request that routed to a mapped gRPC method (`IsGrpcEndpoint`, `:80`,
implemented at `:137-156`). That last arm is keyed on the routed endpoint's `Grpc.AspNetCore.Server`
metadata (`GrpcServerMetadataNamespace`, `:129`), never on the request's `Content-Type`, and the remark above
it says why (`:62-70`, SEC-Common-44 at `:64`): a content type is caller-supplied and unverifiable, so keying on one
hands any authenticated account the no-limiter partition for the price of stamping
`Content-Type: application/grpc` on an ordinary request. Endpoint metadata is produced by routing from the
server's own `MapGrpcService` registrations, so it cannot be forged, and the predicate runs from middleware
that sits after `UseRouting`, so the endpoint is already resolved (`:68-69`). All of these are legitimately
high-frequency: a probe that gets throttled is an outage, and a JWKS fetch the auth middleware depends on
must never be capped.

Second, it hands anonymous traffic to its own partition, which is a no-limiter for almost all of it. When
`httpContext.User?.Identity?.IsAuthenticated != true` (`:179`) the request goes to `AnonymousPartition`
(`:181`, declared at `:92-102`), which returns `GetNoLimiter("__anonymous")` (`:102`) for every path but one.
That is the deliberate gap: public reads are output-cached and cheap, anonymous Blazor Server browsing
shares one IP (`:86-91`), and login brute-force has its own controls (`:363-364`). None of those should be
counted by a per-principal limiter.

The exception is a real-time hub. `IsAnonymousHubRequest` (`:112-122`) matches the request path against
`HubPathPrefixes` (default `["/hubs"]`, `RateLimitingSettings.cs:87`), and a match is metered per client
IP at `AnonymousHubPermitLimit` (default 60, `RateLimitingSettings.cs:95`) under Redis scope `"hub"`
(`WebApplicationBuilderExtensions.RateLimiting.cs:97`) with `allowDistributed: true` (`:101`). A hub request
with no readable IP is not waved through: it shares one `"anonymous-hub"` bucket (`:96`). The reason for
metering sits on the setting (`RateLimitingSettings.cs:70-86`, SEC-ADC-25): the gateway bypasses `/hubs` at
the edge, because ADR-024's hub authenticates from a query-string token the edge cannot read, which leaves
`/hubs/*/negotiate` as the one anonymous route nothing else counts, where an unauthenticated loop costs full
middleware plus auth-reject CPU per request. Authenticated hub traffic is untouched by this: it already
takes the per-user partition (`RateLimitingSettings.cs:84`).

Third, and only for an authenticated caller, it caps. The partition key is the subject claim from
`FindUserIdValue()`, falling back to the principal's identity name, then the remote IP, then a literal
`"authenticated"` (`WebApplicationBuilderExtensions.RateLimiting.cs:184-187`). The subject leads because it
is unique per account, while the name claim carries the full name, which two users can share (`:160-161`).
The final fallback is a shared bucket, not a free pass: an authenticated request with no subject, no name
and no IP is still counted, together with every other such request. That key goes to
`CreateLimitedPartition` (`:189-196`, declared at `:259-319`), which by default builds a fixed one-minute
window with a permit limit of `GlobalPermitLimit`, which defaults to 300 (`RateLimitingSettings.cs:28`),
and a queue limit of zero so overage is rejected rather than buffered
(`WebApplicationBuilderExtensions.RateLimiting.cs:310-318`). Rejection is a `429 Too Many Requests`
(`:431`), and the refused caller learns when its window resets: `WithRetryAfterHeader` (`:22-40`, wired
at `:435`) writes a `Retry-After` header, in whole seconds rounded up, whenever the rejecting lease
carries a retry hint, which the fixed-window and Redis limiters do (`:433-434`). The fixed window is a
`RemainingWindowFixedWindowRateLimiter` rather than the stock fixed-window limiter, because the stock
limiter's hint is always the whole window, while the wrapper reports the time actually left in it
(`:310-311`).

The code is short enough to read whole. This is condensed from the real partition function
(`WebApplicationBuilderExtensions.RateLimiting.cs:172-197`) plus the anonymous partition it delegates to
(`:92-102`). The factory both of them call has two further branches, a sliding window (`:298-308`) and a
shared Redis counter (`:268-296`), which are the configuration layer covered further down; neither is on by
default:

```csharp
// Illustrative of the real GlobalRateLimitPartition shape (condensed, default settings).
// Order is load-bearing: infra exempt, then the anonymous partition, then cap the principal.
internal static RateLimitPartition<string> GlobalRateLimitPartition(HttpContext ctx, RateLimitingSettings settings)
{
    if (IsRateLimitBypassed(ctx))                          // /health, /alive, /.well-known, gRPC endpoints
        return RateLimitPartition.GetNoLimiter("__infra");

    if (ctx.User?.Identity?.IsAuthenticated != true)       // the deliberate gap layers two and three fill
        return AnonymousPartition(ctx, settings);

    var partitionKey = ctx.User.FindUserIdValue()          // the subject claim: unique per account
        ?? ctx.User.Identity.Name                          // the name claim: a full name, not unique
        ?? ctx.Connection.RemoteIpAddress?.ToString()
        ?? "authenticated";                                // one shared bucket, still counted

    return CreateLimitedPartition(ctx, partitionKey, redisScope: "global",
        permitLimit: settings.GlobalPermitLimit,           // default 300
        queueLimit: 0,                                     // reject overage, do not buffer
        settings, allowDistributed: true);
}

// ...and the anonymous partition: no limiter anywhere except a configured hub path.
private static RateLimitPartition<string> AnonymousPartition(HttpContext ctx, RateLimitingSettings settings) =>
    IsAnonymousHubRequest(ctx, settings)
        ? CreateLimitedPartition(ctx,
            partitionKey: ctx.Connection.RemoteIpAddress?.ToString() ?? "anonymous-hub",
            redisScope: "hub",
            permitLimit: settings.AnonymousHubPermitLimit, // default 60
            queueLimit: 0,
            settings, allowDistributed: true)
        : RateLimitPartition.GetNoLimiter("__anonymous");
```

The same registration adds two named policies alongside the global limiter, each inert until an endpoint
names it (`WebApplicationBuilderExtensions.RateLimiting.cs:440-454`). `mcp` (`:57`, registered at `:442`) is
the MCP endpoint's policy, which `MapCommonMcp` applies (`:51-56`): `McpRateLimitPartition` (`:209-225`)
keys it subject-first like the global limiter, falls back to the client IP so an anonymous caller of a
public tool is metered too, and allows `McpPermitLimit` requests a minute (default 60,
`RateLimitingSettings.cs:43`). The other is the per-IP auth throttle registered at
`WebApplicationBuilderExtensions.RateLimiting.cs:452-454`, and the framework attaches that one for you. That
is layer three.

### Layer two: a pre-authentication guard keyed on the submitted identity

The second layer exists for one reason: the first layer exempts the anonymous surface, and the login and
registration endpoints live on it. `ILoginProtectionService`
(`Source/Core/MMCA.Common.Application/Auth/ILoginProtectionService.cs:10`) is the contract, and
`LoginProtectionService` (`Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:38`) is
the implementation. It is registered unconditionally by `AddInfrastructure`
(`Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:58`) via
`TryAddScoped<ILoginProtectionService, LoginProtectionService>()` (`DependencyInjection.cs:159`), so every
host that wires infrastructure has it. Its state lives entirely in `ICacheService`, never in a table, and
that sets its outage posture too: when the cache throws, a check answers success and an increment or reset
does nothing, each with a Warning log, so an unreachable cache suspends the limits instead of failing every
sign-in and registration (`LoginProtectionService.cs:22-28`, implemented at `:92-96`, `:177-180`,
`:192-195`, `:215-219` and `:247-250`).

It keys on the *submitted* identity and the client IP, not on a principal, which is exactly what lets it
work before authentication.

**Login lockout, keyed by email.** `IncrementFailedAttemptsAsync(email)`
(`LoginProtectionService.cs:127`) counts consecutive failures under a `login:attempts:{email}` cache key
(`AttemptsKey`, `:62`) inside a window of `FailedAttemptWindowMinutes` (default 30,
`LoginProtectionSettings.cs:31`). Once the count reaches `MaxFailedAttempts` (default 5,
`LoginProtectionSettings.cs:18`), it writes a lockout key with exponential backoff:
`Math.Min(1 << Math.Min(excessAttempts, 30), _settings.MaxLockoutSeconds)`
(`LoginProtectionService.cs:159`), so each extra failure doubles the wait up to the `MaxLockoutSeconds`
cap (default 300, `LoginProtectionSettings.cs:24`). The inner `Math.Min(excessAttempts, 30)` clamps the
shift exponent: a large `excessAttempts` would overflow the `int` shift (C# masks the count to five
bits, so `1 << 31` is negative and `1 << 32` wraps back to 1), silently shrinking the lockout, and 30
already exceeds any permitted cap. Beside the lockout flag it stores the instant the lockout ends, under
`LockoutUntilKey` (`LoginProtectionService.cs:69`, written at `:162-166`) with the same lifetime.
`CheckLockoutAsync(email)` (`:72`) reads the lockout key from the shared store rather than a replica's
in-process copy (`:79-82`) and, while it is present, returns
`Result.Failure(lockedOut with { RetryAfter = retryAfter })`, where `lockedOut` is
`Error.TooManyRequests("Auth.TooManyAttempts", ...)` and `retryAfter` is the time left on the lockout
(`:103-107`, rationale `:29-36`). `ResetFailedAttemptsAsync(email)` (`:184`) clears the attempt, lockout
and lockout-until keys on a successful login (`:188-190`).

That `{email}` segment is neither the raw request string nor the address itself, and the difference is
the whole control. The key builders, `LockoutKey` (`LoginProtectionService.cs:60`), `AttemptsKey`
(`:62`) and `LockoutUntilKey` (`:69`), take the segment from `EmailIdentity.KeySegment`
(`Source/Core/MMCA.Common.Infrastructure/Auth/EmailIdentity.cs:25-26`): a hex SHA-256 of the address after
`EmailIdentity.Normalize` (`EmailIdentity.cs:36-45`), the one address normalization the auth services
share. `Normalize` runs the address through the same `Email` value object the user lookup uses and falls
back to a plain trim-and-lowercase when the address is malformed, so every builder produces one key per
account. Key off raw input instead and `User@x.com`, `user@x.com` and a padded variant hit one account
but get three independent counters: an attacker defeats the backoff by varying capitalization
(`LoginProtectionService.cs:51-59`). The hash keeps the address itself out of the key, because a key
travels further than the entry it names (Redis key names, cache read-fault warnings, Redis client
exception text) and none of those places may carry an email address (`EmailIdentity.cs:16-22`).

**Registration throttle, keyed by IP.** `CheckRegistrationRateLimitAsync(ip)`
(`LoginProtectionService.cs:199`) fails with
`Error.Unauthorized("Auth.RegistrationRateLimitExceeded", ...)` (`:221-226`) once
`MaxRegistrationsPerIpPerHour` (default 10, `LoginProtectionSettings.cs:37`) signups from one IP land
inside `RegistrationRateLimitWindowMinutes` (default 60, `LoginProtectionSettings.cs:43`), tracked under a
`registration:ip:{ip}` key whose segment is a hex SHA-256 of the trimmed IP, for the same reason the
email keys are hashed (`RegistrationKey`, `LoginProtectionService.cs:259`, segment `:261-262`, rationale
`:253-258`; built at `:206` and read at `:213`). `IncrementRegistrationCountAsync(ip)` (`:230`) bumps that
counter. A missing or empty IP is a deliberate no-op that fails open (`:201-204`, `:232-235`): the check returns `Result.Success()` rather than
blocking a request it cannot attribute.

Every check returns `Result` (ADR-013), so the HTTP edge maps each failure through the shared error-type
table without the endpoint special-casing it, and the two failures land on different status codes. The
lockout is a `TooManyRequests` error, which maps to `429` (`Source/Presentation/MMCA.Common.API/Middleware/ErrorHttpMapping.cs:34`), and its
`RetryAfter` becomes a `Retry-After` header on that response, in the same whole rounded-up seconds the rate
limiters send (`Source/Presentation/MMCA.Common.API/Controllers/ApiControllerBase.cs:87-99`); the
registration throttle is an `Unauthorized` error, which maps to `401` (`ErrorHttpMapping.cs:29`). And
because the counters live in the same swappable `ICacheService` substrate, they self-expire by TTL: a
lockout is inherently ephemeral, so cache expiry *is* the reset.

Here is the backoff, the one line that does the work. It mirrors the tail of
`IncrementFailedAttemptsAsync` (`LoginProtectionService.cs:151-175`, backoff at `:159`), with the source
comment condensed, the enclosing cache-outage `try` and the trailing `.ConfigureAwait(false)` elided, and
three statements left out: the Information log each failed attempt writes before it (`:145-149`), the
`LockoutUntilKey` write (`:162-166`) and the one Warning logged when the lockout first trips (`:171-174`):

```csharp
if (newCount >= _settings.MaxFailedAttempts)              // default 5
{
    // newCount is a long; clamp before the int shift.
    var excessAttempts = (int)Math.Min(newCount - _settings.MaxFailedAttempts, int.MaxValue);
    // Clamp the shift exponent to 30: C# masks int shift counts to 5 bits, so 1 << 31 is
    // negative and 1 << 32 wraps back to 1, silently shrinking the lockout.
    var lockoutSeconds = Math.Min(1 << Math.Min(excessAttempts, 30), _settings.MaxLockoutSeconds); // doubles, cap 300s
    // LockoutKey hashes the normalized email: one key per account, no principal needed.
    await cacheService.SetAsync(LockoutKey(email), true, TimeSpan.FromSeconds(lockoutSeconds), cancellationToken);
}
```

### Layer three: throttle anonymous credential submission per source, by default

Two layers still leave one threat standing, and it is the one an attacker reaches for precisely because
lockout works. Per-email lockout counts failures against a *single* account, so it sees five bad guesses
at one address. Password spray inverts the shape: one popular password tried once each against a
thousand different addresses. Every per-account counter reads one failure, nothing trips, and the global
limiter never sees it either, because the attempts are anonymous and the anonymous partition meters only
the hub paths.

`RateLimitPolicyAuthIp`, the `"auth-ip"` policy (`WebApplicationBuilderExtensions.RateLimiting.cs:49`,
rationale in its XML docs at `:42-48`), is the control shaped for that: a fixed one-minute window keyed on
the client IP, applied to the anonymous credential endpoints only. Its partition selector is
`AuthIpRateLimitPartition` (`:341-355`), which reads `Connection.RemoteIpAddress` (`:343`), the same
canonical source the global partition uses and the value `UseForwardedHeaders` has already resolved from
`X-Forwarded-For` earlier in the shared pipeline (`:444-447`). An IP it cannot read returns
`GetNoLimiter("__unknown-ip")` (`:345-346`) rather than collapsing every unattributable request into one
shared bucket, which would throttle the in-process test server and the integration tier to a standstill
(`:325-331`). That is a deliberate difference from the global limiter, which does pool unattributable
traffic into the shared `"authenticated"` and `"anonymous-hub"` buckets (`:184-187`, `:96`), and ADR-019
records the difference rather than a shared posture (`Website/docs-src/adr/019-rate-limiting.md:135-143`,
`:373-386`). Everything else goes through the same factory with `permitLimit: settings.AuthIpPermitLimit` and
`queueLimit: 0` (`WebApplicationBuilderExtensions.RateLimiting.cs:347-354`), rejected with the same `429`.
It is registered by the same `AddCommonRateLimiting` call (`:452-454`), which takes a second parameter for
it:

```csharp
// Illustrative of the real AuthIpRateLimitPartition shape (condensed).
// No limiter on an IP it cannot read, rather than pooling every such request into one bucket.
internal static RateLimitPartition<string> AuthIpRateLimitPartition(HttpContext ctx, RateLimitingSettings settings)
{
    var clientIp = ctx.Connection.RemoteIpAddress?.ToString();

    return clientIp is null
        ? RateLimitPartition.GetNoLimiter("__unknown-ip")
        : CreateLimitedPartition(ctx, clientIp, redisScope: "auth-ip",
            permitLimit: settings.AuthIpPermitLimit,       // default 30
            queueLimit: 0,
            settings, allowDistributed: false);            // never the shared counter: see below
}
```

The signature that registers all of this reads
`AddCommonRateLimiting(int globalPermitLimit = 300, int authIpPermitLimit = 30)`
(`WebApplicationBuilderExtensions.RateLimiting.cs:388`), although every Store and ADC service host reaches the
`IConfiguration` overload, covered under the settings layer below, instead. The
default of 30 rather than a tighter 10 is documented on the parameter itself (`:380-387`): Blazor Server
circuits issue the login call server-side, so every Server-circuit user shares the UI host's IP and a
legitimate login burst has to fit inside the window. At 30 a minute a spray still drops from unlimited to
roughly 43,000 attempts per day per IP, with per-account lockout intact on top (`:384-386`). Tightening
toward 10 waits on real client IPs being forwarded end to end.

The part worth copying is not the policy, though. It is that the framework attaches it for you.
`AuthControllerBase.LoginAsync`
(`Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:78`, action at `:82`) and
`RegisterAsync` (`:103`, action at `:109`) both carry
`[EnableRateLimiting(WebApplicationBuilderExtensions.RateLimitPolicyAuthIp)]`, so any consumer
inheriting the base gets per-IP protection without opting in. Its sibling
`PasswordResetAuthControllerBase` carries the same attribute on `forgot-password` (`:78`) and
`reset-password` (`:102`), and `EmailConfirmationControllerBase` carries it on `send-email-confirmation`
(`EmailConfirmationControllerBase.cs:81`) and `confirm-email` (`:109`). Four more bases carry it the same
way: `MachineTokenControllerBase` on the machine-client token action
(`Controllers/MachineClients/MachineTokenControllerBase.cs:48`), `OAuthControllerBase` on `discover`
(`OAuthControllerBase.cs:176`), `PasskeysControllerBase` on `signin/options` and `signin`
(`Controllers/Passkeys/PasskeysControllerBase.cs:232`, `:257`), and `SignInLinkControllerBase` on
`sign-in-link` and `sign-in-link/redeem` (`Controllers/SignInLinks/SignInLinkControllerBase.cs:83`,
`:111`). So the framework's default surface is twelve anonymous credential actions on seven bases. It is
not every anonymous action on those bases: in `OAuthControllerBase` only `discover` carries the policy.
Both apps' `EmailConfirmationController` derive from that base and add no attribute of their own (ADC
`EmailConfirmationController.cs:32`, Store `:33`), and ADR-019 records the whole list
(`Website/docs-src/adr/019-rate-limiting.md:93-121`). The base documents why the default is attached rather
than opt-in (`AuthControllerBase.cs:26-35`): a policy that ships in the framework but leaves each app to
attach it is a policy an app can silently lack, and an app that simply inherited these actions would
have no spray protection at all. A consumer that inherits the base without calling `AddCommonRateLimiting` fails
at startup on an unregistered policy (`:43-47`), which is the loud failure rather than the silent one.

`RefreshAsync` carries no rate-limit attribute at all (attribute block `:164-169`, action `:170`), and
that is deliberate rather than an oversight (`:36-42`): refresh is automatic and periodic rather than
user-initiated, Blazor Server circuits issue it server-side so every Server-circuit user shares one IP,
and refresh tokens are high-entropy, so brute force is not the threat password spraying is. A per-IP
window there would throttle ordinary token renewal for everyone behind that host.

### The settings layer: the same three controls, tunable without a recompile

There are three controls, not four: the settings layer is configuration, not another defence. ADR-019
(`Website/docs-src/adr/019-rate-limiting.md:239-297`) records what it buys, the ability to tune the three
without a recompile, and one way to make several of them mean the same thing behind a load balancer.

The limits live in `RateLimitingSettings`
(`Source/Presentation/MMCA.Common.API/RateLimiting/RateLimitingSettings.cs:21`), bound from a
`"RateLimiting"` configuration section (`:24`) with a `[Range]` on every count.
`AddCommonRateLimiting` has three overloads: the permit-count one quoted above
(`WebApplicationBuilderExtensions.RateLimiting.cs:388-393`), which only builds a settings object and
delegates; an `IConfiguration` one that binds the section with validation on start and falls back to a
default instance when it is absent (`:403-415`, `ValidateOnStart` at `:410`); and the settings one that
actually calls `AddRateLimiter` (`:425-456`, the call at `:429`). Every default matches the framework's
shipped value, so a host that configures nothing behaves exactly as described above.

The section also holds the two hub controls layer one uses, `HubPathPrefixes`
(`RateLimitingSettings.cs:87`) and `AnonymousHubPermitLimit` (`:95`), so which anonymous paths are
metered, and how hard, is a deployment decision rather than a constant.

Two knobs do more than relocate a constant. `Algorithm` (`RateLimitingSettings.cs:49`) can select
`RateLimitAlgorithm.SlidingWindow` (`RateLimitAlgorithm.cs:22`) instead of the default `FixedWindow`
(`:15`), dividing the same one-minute window into `SegmentsPerWindow` segments (default 4,
`RateLimitingSettings.cs:58`) so a caller cannot spend a full minute's allowance at the end of one
window and again at the start of the next. That is a smoothing choice, not a new cap. And `Distributed`
(`:68`, default `false`) swaps the in-process counter for `RedisFixedWindowRateLimiter`
(`RateLimiting/RedisFixedWindowRateLimiter.cs:41`), which counts one key per partition per minute in
Redis so N replicas share one allowance instead of holding N of them. The increment and the key's expiry
run as one atomic Lua script (`:50-53`, rationale at `:29-30`), so no fault between the two can leave a
counter key without a TTL.

Exactly three partitions may take that shared counter: the global limiter (Redis scope `"global"`,
`WebApplicationBuilderExtensions.RateLimiting.cs:192`, `allowDistributed: true` at `:196`), the anonymous
hub partition (scope `"hub"` at `:97`, `:101`) and the `mcp` policy (scope `"mcp"` at `:220`, `:224`). The
`"auth-ip"` policy alone passes `allowDistributed: false` (`:354`). That is
deliberate, and the reason sits on the factory parameter itself (`:254-258`): per-account login protection
already backs the per-IP window, and a login throttle that fails open on a Redis outage is a worse trade
than one that stays local. ADR-019 adds the cost side, that
making `auth-ip` distributed would put a Redis round trip on the login path to tighten a limit whose
per-replica multiplication its generous default already absorbs (`019-rate-limiting.md:274-279`).

Whether the section reaches the limiter is a host decision, because a declared section only binds through
the `IConfiguration` overload. Every ADC and Store service reaches it the same way: each host calls
`AddMmcaServiceHost` (ADC Identity `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:79`,
Conference `MMCA.ADC.Conference.Service/Program.cs:82`, Engagement `MMCA.ADC.Engagement.Service/Program.cs:58`,
Notification `MMCA.ADC.Notification.Service/Program.cs:58`; Store Catalog
`MMCA.Store/Source/Services/MMCA.Store.Catalog.Service/Program.cs:32`, Identity
`MMCA.Store.Identity.Service/Program.cs:37`, Sales `MMCA.Store.Sales.Service/Program.cs:51`), and that
composed host calls `services.AddCommonRateLimiting(configuration)`
(`Source/Hosting/MMCA.Common.ServiceHost/ServiceHostBuilderExtensions.cs:110`) and registers the Redis
connection the shared counter needs through `AddRedisCaching` (`:91`). Notification also declares a
section in its own settings, `"RateLimiting": { "AnonymousHubPermitLimit": 600 }`
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/appsettings.json:57-59`), with a rationale above it
(`:48-56`) that the venue's NAT puts roughly 67 attendees behind a single address, so a 60-per-minute
budget goes in seconds when the room reconnects, while 600 still bounds an unauthenticated loop to 10 a
second from one address. ADC production sets the rest as container-app environment variables.
`RateLimiting__Distributed=true` is on the Identity, Conference, Engagement and Notification apps
(`MMCA.ADC/infra/main.bicep:2407`, `:2670`, `:2815`, `:2985`; the apps are declared at `:2312`, `:2590`,
`:2749` and `:2901`), so ADC's global and anonymous-hub partitions count in Redis while `auth-ip` stays per
replica. `RateLimiting__AuthIpPermitLimit=300` is set on Identity under `conferenceMode` only
(`main.bicep:2536`, rationale at `:2527-2533`), beside `LoginProtection__MaxRegistrationsPerIpPerHour=500`
(`:2537`) for the registration throttle; without the key the window stays at the default 30, as the
Identity host's comment says (`MMCA.ADC.Identity.Service/Program.cs:113-116`). Store's `main.bicep` sets no
key in the services' `RateLimiting` section (its rate-limit keys are the Gateway's `GatewayRateLimiting__*`,
`MMCA.Store/infra/main.bicep:2580`, `:2586`, `:2711`), so Store runs the in-memory fixed-window defaults
this article describes, with one deliberate addition: Sales declares
`"RateLimiting": { "HubPathPrefixes": [ "/hubs", "/Payments" ] }`
(`MMCA.Store/Source/Services/MMCA.Store.Sales.Service/appsettings.json:100-102`, rationale `:93-99`), which
meters the anonymous Stripe webhook per client IP on the anonymous hub partition, because the Gateway
bypasses `/Payments` and nothing else counts it. Sales also registers a policy of its own beside the
framework's, through `AddQuoteRateLimiting` (`MMCA.Store.Sales.Service/Program.cs:97`): a per-IP window
for the anonymous bag quote, so busy checkouts never spend the shared `auth-ip` bucket (`:95-96`). ADR-019
records it as the one consumer-registered policy (`019-rate-limiting.md:46-52`).

### Where the three controls meet

This is the connective tissue, and it is worth stating plainly. The global limiter protects authenticated
*throughput* per principal and exempts anonymous traffic outside the hub paths. The `"auth-ip"` policy
covers that exempted surface at the HTTP edge, keyed per *source*, and catches the one-guess-per-account
spray that no per-account counter can see. The login-protection service covers the same surface one level
in, keyed per *submitted identity* for lockout and per *IP* for signup, and catches the
many-guesses-at-one-account run the per-source window would not reach on its own. Anonymous read abuse,
meanwhile, is absorbed by output caching rather than any of the three. Four mechanisms, one edge, no
overlap: each one is keyed on something the others structurally cannot key on.

Both real apps adopt the second layer through one shared base rather than wiring it per app. The
check-before, increment-on-failure, reset-on-success sequence around login and the registration check
around sign-up lives in `AuthenticationServiceBase<TUser>`
(`Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs`), which calls
`CheckLockoutAsync` (`:180`), `IncrementFailedAttemptsAsync` (`:204`, `:214`, and a third time later in the
class at `:885`), `ResetFailedAttemptsAsync` (`:274`), `CheckRegistrationRateLimitAsync` (`:322`), and
`IncrementRegistrationCountAsync` (`:385`). The ADC and Store `AuthenticationService` are sealed subclasses
that take `ILoginProtectionService` as a constructor parameter (ADC `AuthenticationService.cs:55`, Store
`:29`) and forward it to the base constructor (ADC `:65`, Store `:36`); ADC's subclass additionally injects
`IExternalLoginEmailVerifier` (`:56`) for its external OAuth flow. The login and registration workflow, and
every protection call in it, lives once in the base.

Five framework call sites sit outside it. `ResetPasswordHandlerBase` takes `ILoginProtectionService` as a
constructor dependency
(`Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:46`) and
calls `ResetFailedAttemptsAsync(request.Email)` once the new credential is persisted (`:120`), so a user
who resets the password because of a lockout is not left locked out by it. `ChangePasswordHandlerBase`
takes it too
(`Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:60`) and
runs the whole sequence on its own key: `CheckLockoutAsync` before the current-password check (`:102`),
`IncrementFailedAttemptsAsync` on a wrong current password (`:110`) and `ResetFailedAttemptsAsync` on a
right one (`:115`). The counter is keyed per principal, `password-change:{userId}` (`:144-145`, rationale
at `:48-53`), so a signed-in session is not an unthrottled password oracle, and a change-password lockout
does not lock the owner out of sign-in. ADR-029 records both
(`Website/docs-src/adr/029-authentication-brute-force-protection.md:17-19`, `:86-90`). The other three
are the post-sign-in second-factor handlers under `Source/Core/MMCA.Common.Application/Users/UseCases/TwoFactor/`:
`ConfirmTwoFactorEnrollmentHandlerBase` (`ConfirmTwoFactorEnrollmentHandlerBase.cs:75-91`),
`DisableTwoFactorHandlerBase` (`DisableTwoFactorHandlerBase.cs:54-82`) and
`RegenerateRecoveryCodesHandlerBase` (`RegenerateRecoveryCodesHandlerBase.cs:57-83`). Each runs the same
check, increment and reset sequence on one shared per-account key, `two-factor:{userId}`
(`TwoFactorAttemptKey.cs:20-21`), so a wrong code on any of them counts against one budget, kept apart
from both the sign-in counter and the change-password counter (`:10-14`). Change-password and the
second-factor handlers are the two principal-keyed uses of the service (ADR-029 Revision 2026-11-23,
`029-authentication-brute-force-protection.md:517`). Settings bind from
the `"LoginProtection"` configuration section (`LoginProtectionSettings.cs:12`).

They adopt the third the same way, and the redundancy in that is deliberate. ADC's Identity service
re-declares the attribute on both actions it overrides
(`MMCA.ADC.Identity.API/Controllers/AuthController.cs:55` on register and `:123` on login, the overrides
at `:60` and `:127`) and tunes the window from configuration through the `RateLimiting` section its
composed host binds (`MMCA.ADC.Identity.Service/Program.cs:113-116`, the comment recording that the host's
limiter carries `auth-ip`, tuned by `RateLimiting:AuthIpPermitLimit`). Store's Identity service binds the
same section through the same composed host, declares none, and so runs the framework default
(`MMCA.Store.Identity.Service/Program.cs:37`), and its `RegisterAsync` override re-declares the attribute
too (`MMCA.Store.Identity.API/Controllers/AuthController.cs:54`, the override at `:59`), with a doc
comment saying exactly what that line is for (`:41-51`): the attribute is inherited by an override, so
re-applying it is convention parity with ADC plus a regression pin, not a live hole being closed.

That an override keeps the policy anyway is asserted rather than taken on faith about framework
internals. `AuthControllerBaseRateLimitTests` pins both halves of it directly.
`EnableRateLimitingAttribute_IsDeclaredInherited`
(`MMCA.Common.API.Tests/Controllers/Auth/AuthControllerBaseRateLimitTests.cs:51-55`) reads
`AttributeUsage.Inherited` off the attribute type by reflection and requires it to be `true`, because
ADR-019 cites attribute inheritance as the reason a derived override keeps the per-IP policy.
`DerivedOverride_WithoutTheAttribute_StillCarriesTheAuthIpPolicy` (`:61-79`) then builds a derived
controller that overrides `RegisterAsync` without the attribute and asserts the policy still resolves
through `GetCustomAttributes(inherit: true)`. The test's own comment is careful about what that buys
(`:57-60`): it pins the mechanism, it does not bless a bare override. Applying the attribute on every
override stays the convention precisely because a dropped security attribute is invisible.

### The UI origin is its own edge, and the framework ships its kit

Every control above bounds traffic at an API host. The server-rendered Blazor UI host is the case none of
them reaches: it is a separate externally reachable origin on its own Container Apps FQDN, so the gateway's
edge limiter guards the gateway's own hostname and never sees a single request to the front door a browser
actually loads (ADR-124, `Website/docs-src/adr/124-blazor-circuit-ceiling-ui-edge.md:26-31`).

So that origin carries its own limiter. `AddUiRateLimiting`
(`Source/Presentation/MMCA.Common.UI.Web/Hardening/UiRateLimitingExtensions.cs:217`) and
`UseUiRateLimiting` (`:271`) put a per-client-IP fixed window, chained with a replica-wide concurrency
ceiling, in front of the host, both rejecting with `429` (`:16-19`), and a fixed-window refusal carries
the same `Retry-After` header as the API hosts (`UiRateLimitingExtensions.cs:47-66`, wired at `:236`); the concurrency half defaults to 200
permits (`GlobalConcurrencyLimit`, `UiRateLimitingSettings.cs:76`). The Blazor circuit transport,
`/_blazor`, stays inside the per-IP window but out of the concurrency ceiling, because a circuit WebSocket
would hold its lease for the circuit's whole lifetime (`UiRateLimitingExtensions.cs:39-45`).

A page load there is also not a cheap request. Under the Interactive Auto render strategy the first render
is always a Server circuit, so every page load opens one, and each open circuit holds live render state
for as long as the connection lives, inside a container of 0.25 vCPU and 0.5 GiB
(`Source/Presentation/MMCA.Common.UI.Web/Hardening/BoundedCircuitHandler.cs:15-21`,
`BlazorCircuitLimitSettings.cs:27-28`). A rate limiter does not bound that: it bounds how fast requests
arrive, while a caller who opens circuits slowly enough to stay inside the window still accumulates them
(`BlazorCircuitLimitSettings.cs:10-13`). Neither do the `CircuitOptions` knobs
`DisconnectedCircuitMaxRetained` and `DisconnectedCircuitRetentionPeriod`, which bound only circuits that
have already dropped their connection and are being held for reconnect (`BlazorCircuitLimitSettings.cs:13-15`).
The settings type still tightens both, as defence in depth: 25 retained circuits (`:46`) for 60 seconds
(`:57`).

So the ceiling is on concurrency, and it is held by a `CircuitHandler`. `BoundedCircuitHandler`
(`BoundedCircuitHandler.cs:43-45`) counts opens and closes and refuses anything past `MaxActiveCircuits`,
default 200 per replica (`BlazorCircuitLimitSettings.cs:38`, derived from that container's memory and vCPU
at `:27-35`). It is registered as a singleton by `AddBoundedBlazorCircuits()` so one count spans the
replica: circuit handlers are resolved from each circuit's own scope, so a scoped registration would count
to one and cap nothing (`BoundedCircuitHandler.cs:32-34`). It runs last among the registered handlers,
`Order => int.MaxValue` (`:57-61`), so a refusal lands after cheaper handlers have done their work. The
count is race-safe by construction in both directions. The open path increments first and rolls back on
refusal (`:70-76`), because reading and then incrementing would let two simultaneous opens both take the
last free slot. The close path releases a permit only for a circuit the open path admitted, tracked in a
set keyed by reference (`:47`, added at `:83`, checked at `:92-98`), because the framework tears a refused
circuit down through the same close callback and that close would otherwise release a permit another
circuit holds (`:37-38`). Flooring the count at zero stays behind that as the last line of defence
(`:100-106`).

```csharp
// The real open path (MMCA.Common.UI.Web/Hardening/BoundedCircuitHandler.cs:64-85), logging elided.
public override Task OnCircuitOpenedAsync(Circuit circuit, CancellationToken cancellationToken)
{
    ArgumentNullException.ThrowIfNull(circuit);

    var ceiling = settings.Value.MaxActiveCircuits;

    // Increment first and roll back on refusal: reading then incrementing would let two
    // simultaneous opens both observe the last free slot and both take it.
    var active = Interlocked.Increment(ref _activeCircuits);
    if (active > ceiling)
    {
        Interlocked.Decrement(ref _activeCircuits);

        return Task.FromException(new InvalidOperationException(/* ...the ceiling, to the user... */));
    }

    _admitted[circuit] = 0;   // only an admitted circuit releases a permit on close
    return Task.CompletedTask;
}
```

The refusal is a thrown exception, and the type says in place that this is the one spot where the `Result`
pattern does not apply (`:24-29`): `CircuitHandler.OnCircuitOpenedAsync` returns `Task` and has no
"refuse" return value, so a faulted task is the only way to stop a circuit from starting (`:78-80`), and
the contract belongs to the framework. Refusal is observable rather than silent, one Warning per refusal
naming the ceiling (`:111-114`).

Both halves are one framework kit in `MMCA.Common.UI.Web`, and both apps consume the same copy through the
composed UI host builder: each UI host calls `AddMmcaBlazorWebHost`
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:26`,
`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:30`) and `UseMmcaBlazorWebPipeline` (ADC `:128`,
`:130`, Store `:92`), which register `AddBoundedBlazorCircuits()` and `AddUiRateLimiting`
(`Source/Presentation/MMCA.Common.UI.Web/Hosting/BlazorWebHostExtensions.cs:95`, `:96`) and place
`UseUiRateLimiting()` in the pipeline (`:187`). ADR-124 records the decision as three layers from one
framework kit (`124-blazor-circuit-ceiling-ui-edge.md:53-55`). A limiter and a ceiling bound different
resources, so the kit keeps them as two settings types bound from two sections rather than folding the
concurrency bound into the limiter (`BlazorCircuitLimitSettings.cs:10-13`).

## Trade-offs, honestly

None of the three is a complete edge defence on its own, and the §11 review is explicit about the
boundaries.

- **Per-principal keying needs an authenticated identity, full stop.** The global limiter can only key
  what it can attribute, so the anonymous surface *must* be covered separately. That is not a workaround;
  it is precisely why the other two controls exist. An uncached anonymous endpoint added later would have
  no global cap and would need its own control or a named policy.
- **The limiter's placement is load-bearing.** Per-user partitioning depends on the authenticated
  principal already being populated when the limiter runs
  (`WebApplicationBuilderExtensions.RateLimiting.cs:179`, `:184-185`). Move the limiter relative to
  authentication in the pipeline and the partition sees a different or empty principal, which drops an
  authenticated caller into the anonymous partition. The gRPC exemption has the same property in the other
  direction: it reads the routed endpoint, so it depends on running after `UseRouting` (`:68-69`). This is
  a config-order trap, not a code bug.
- **Attribute-shaped protection fails silently when it goes missing.** The per-IP throttle is applied by
  an attribute, so dropping it breaks nothing loudly: the endpoint simply stops being throttled and the
  app keeps serving traffic. A host missing the attribute has no spray protection while every build
  and analyzer stays green, which is why
  `AuthControllerBaseRateLimitTests` asserts the attribute's presence on login and register and its
  deliberate absence on refresh, directly
  (`MMCA.Common.API.Tests/Controllers/Auth/AuthControllerBaseRateLimitTests.cs:15-21` for the reasoning,
  `:24-34` and `:40-45` for the assertions), and sibling tests pin it on seven of the other ten
  anonymous credential actions (`PasswordResetAuthControllerBaseTests.cs:132`,
  `EmailConfirmationControllerBaseTests.cs:132`, `OAuthControllerBaseOidcTests.cs:188`,
  `MMCA.Common.Passkeys.Tests/PasskeysControllerBaseTests.cs:341`). The machine-client token and the two
  sign-in-link actions carry the attribute with no test asserting it, so for those three the gap this
  bullet describes is open. A security control that is invisible when
  it is missing needs a test whose only job is to notice.
- **The per-IP auth throttle is coarse, fail-open, and deliberately loose.** Shared NAT, proxies and
  Blazor Server circuits put many users behind one IP, which is exactly why the default is 30 a minute
  rather than 10 (`WebApplicationBuilderExtensions.RateLimiting.cs:380-387`), and an IP it cannot read is
  not limited at all (`:345-346`). It covers the twelve anonymous credential actions the seven framework
  bases carry, and deliberately not refresh. It raises the cost of spray from one source by orders of
  magnitude; it does not stop an attacker rotating across many.
- **Email-keyed lockout is a denial-of-service-on-the-user lever.** An attacker can lock a *known*
  account out by deliberately failing its logins. That is why the control is exponential backoff with a
  short cap (default 300s, `LoginProtectionSettings.cs:24`) plus a `429` whose `Retry-After` header names the
  time left (`LoginProtectionService.cs:103-107`, `ApiControllerBase.cs:87-99`), not a hard permanent block. It bounds the harm to a brief
  self-healing lockout, an accepted availability-for-security trade.
- **Cache-scoped state weakens under scale-out, and for the limiter the fix is opt-in.** In memory mode
  the login-protection counters are per-replica and evaporate on restart, so a multi-replica deployment
  that did not wire a distributed cache does not aggregate an attacker hitting different replicas; the
  answer there is to wire a distributed cache once scaled out, which both apps do. The global limiter's
  in-process counters have the same shape: across N replicas the effective ceiling is roughly N times the
  configured limit. The framework ships a way out for that one, the shared Redis counter behind
  `Distributed = true` for the global, anonymous-hub and `mcp` partitions
  (`WebApplicationBuilderExtensions.RateLimiting.cs:195`, `:101`, `:223`), but it defaults to `false`
  (`RateLimitingSettings.cs:68`). ADC turns it on for its four services in production
  (`MMCA.ADC/infra/main.bicep:2407`); Store does not, so there the ceiling is N times the limit.
  ADR-019 calls the trade-off narrowed rather than removed
  (`Website/docs-src/adr/019-rate-limiting.md:292-296`), and it stands exactly as written for `auth-ip`
  alone, which never takes the shared counter.
- **Login protection fails open on a cache outage.** The counters are a cache, and the cache never turns
  its own outage into an error, so when it throws a lockout or registration check answers success and an
  increment or reset does nothing, with one Warning log per call naming the operation
  (`LoginProtectionService.cs:22-28`, `:279-281`). An unreachable cache therefore suspends lockout and the
  registration throttle rather than failing every sign-in; the `auth-ip` window, which keeps its counters
  in process, still stands during the outage. ADR-029 records the decision (Revised 2026-10-03).
- **Turning the shared counter on can silently do nothing.** Setting `Distributed = true` in a host with
  no `IConnectionMultiplexer` registered degrades to the in-memory limiter rather than failing startup
  (`WebApplicationBuilderExtensions.RateLimiting.cs:293-295`, documented at `RateLimitingSettings.cs:60-67`),
  and the Redis limiter itself fails open on a Redis fault, granting the lease and warning at most once per
  window (`Website/docs-src/adr/019-rate-limiting.md:281-283`). Both are the right posture for a backstop
  that must never become an outage, and both mean a misconfiguration here looks exactly like success.
- **The counter increment is not atomic, by decision.** `IncrementAsync` is a read-modify-write on the
  cache, and the code says why in place (`LoginProtectionService.cs:129-137`): a Redis `INCR` writes a
  plain string key, while `IDistributedCache` reads entries back as hashes, so an atomic increment issued
  underneath the cache abstraction leaves a counter the cache itself cannot read. A readable counter is
  worth more than an atomic one. The accepted cost is that genuinely parallel attempts can overwrite each
  other's increments and undercount, so a concurrent burst can stay under `MaxFailedAttempts`; sequential
  guessing, which is what a credential-stuffing run against one account looks like, still trips the
  lockout. The same shape means each write refreshes the TTL, so both windows slide rather than staying
  anchored to the first attempt (`:237-239`), which only ever tightens the limit. ADR-029 records the
  whole trade, including the opt-in `HybridCacheService` that overrides the member with the same shape
  (`029-authentication-brute-force-protection.md`, from `:101`).
- **The per-IP registration throttle is coarse and fail-open.** Shared NAT or proxy IPs throttle innocents
  together, per-attacker IP rotation evades it, and a missing IP is a deliberate no-op
  (`LoginProtectionService.cs:201-204`). It raises the cost of bulk signup; it does not stop a determined
  distributed attacker.
- **The defaults are deployment-agnostic.** 300 requests per minute per user is a coarse backstop, not a
  tuned SLO. A service with heavier legitimate per-user traffic must raise `GlobalPermitLimit`, a host
  with real client IPs can tighten `AuthIpPermitLimit` (every ADC and Store service binds the whole
  `RateLimiting` section to configuration), and a stricter endpoint must opt into a named policy. Those knobs have a
  `"RateLimiting"` section to live in (`RateLimitingSettings.cs:21-95`), which makes tuning a deployment
  concern rather than a recompile, but reaching the section at all takes the `IConfiguration` overload
  (`WebApplicationBuilderExtensions.RateLimiting.cs:403-415`), which the composed service host calls
  for every ADC and Store service.

None of these argue against the layering. They are the edges of what each control is for: a per-principal
cap protects attributable throughput, a per-source window protects anonymous credential submission, a
pre-auth service protects the account being guessed, and together they cover what none of them covers
alone.

## Apply this even without MMCA

The shape ports to any ASP.NET Core service, with or without this framework:

1. **Pick the partition key before you pick the limit.** "300 a minute" is meaningless until you answer
   "per what." Per authenticated principal caps attributable load without punishing shared-origin
   anonymous browsing; per IP does the opposite. Choose deliberately, because the key determines who you
   actually protect. And key the principal on a claim that is unique per account: a display name is not.
2. **Exempt infrastructure traffic explicitly, on something the caller cannot set.** Health and liveness
   probes, JWKS and OIDC discovery, and inter-service RPC are legitimately high-frequency, and a limiter
   that throttles a probe causes the outage it was meant to prevent. Key the exemption on the routed
   endpoint rather than on a request header: a header is caller-supplied, so an exemption keyed on one is
   an exemption anybody can claim.
3. **Do not pretend one limiter covers the anonymous surface.** A per-principal cap structurally cannot
   key a pre-authentication request. Name that gap and cover it with controls shaped to the threats that
   live there, rather than stretching the limiter to fit. Where an anonymous route is expensive and
   nothing upstream counts it, a real-time hub negotiate being the usual case, meter that one per client
   IP instead of exempting it with the rest.
4. **Key brute-force protection on the submitted identity, not the principal.** At login there is no
   principal. Lockout has to key on the email being tried and the client IP, which is exactly what lets it
   run before authentication.
5. **Count the attempts a per-account counter cannot see.** One password against a thousand addresses
   reads as one failure per account and trips nothing. A per-source window over the credential endpoints
   is the control for that, and it belongs on the shared base class so an endpoint
   has to opt *out* rather than opt in. Then test that the attribute is still there: a dropped
   security attribute breaks no behaviour a human would notice.
6. **Prefer backoff to a hard block, and TTL to a table.** Exponential backoff frustrates automated
   guessing while a legitimate user's brief lockout self-heals, and cache-with-TTL state means a lockout's
   natural lifetime is its expiry, not a row you have to clean up.
7. **Bound concurrency separately from arrival rate.** A rate limiter caps how fast requests come in; it
   says nothing about how much state stays resident. Where a request opens something that lives on (a
   server-rendered circuit, a long-lived connection, a session), cap the number held at once, in the host
   that holds them.

The takeaway: **a request cap, a per-source credential throttle and a brute-force guard are not three
flavors of the same control. The cap protects the authenticated surface it can attribute; the throttle
protects the anonymous surface the cap must exempt; the guard protects the individual account neither of
them counts. Draw the lines where each key runs out, put the right control on each side, and the whole
edge is covered with no single mechanism pretending to do a job it structurally cannot.**

---

**What we covered:** why "turn on rate limiting" is not one decision but three (who, by what key, what is
exempt), how MMCA.Common's authenticated-only global limiter (`AddCommonRateLimiting`) caps attributable
per-principal traffic subject-first and exempts infrastructure and anonymous traffic outside the real-time
hub paths, why that exemption leaves the most-attacked endpoints uncovered, how `ILoginProtectionService`
closes part of that gap with email-keyed exponential-backoff lockout and a per-IP registration throttle
that key on the submitted identity rather than a principal, how the `"auth-ip"` per-source window closes
the rest by catching password spray that no per-account counter can see and is attached by default to
twelve anonymous credential actions on seven framework controller bases rather than
left to each app to remember, what the settings layer adds on top (a bound `"RateLimiting"` section, the
hub-path controls, a selectable sliding window, and an opt-in shared Redis counter for three of the
partitions, which ADC's services turn on in production), why the UI origin is its own edge with a framework
kit of its own (a per-IP window chained with a concurrency ceiling, plus a circuit ceiling), and the honest
boundaries in all three: principal-dependence, config order, silently-droppable attributes, shared-IP
coarseness, the DoS-on-the-user lever, cache state under scale-out, and fail-open login protection during a
cache outage.

**Next in the series:** Aspire, the one command that brings up the whole distributed stack locally.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the ADRs behind this pattern, or
`dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-019 (rate limiting), ADR-029 (brute-force protection) and ADR-124 (the UI-origin circuit
  ceiling): `Website/docs-src/adr/` in the docs site.

*Tags: .NET, C Sharp, Security, Web API, Software Architecture*

*Notes: re-verified 2026-11-25 against MMCA.Common v1.319.0 (`MMCA.Common/FACTS.md:14`; ADC and Store pin
1.319.0). Every anchor below was read from source in this run unless marked "carried". Changes this run:
the `auth-ip` surface is twelve actions on seven bases, not six on three (`MachineTokenControllerBase.cs:48`,
`OAuthControllerBase.cs:176`, `PasskeysControllerBase.cs:232`, `:257`, `SignInLinkControllerBase.cs:83`,
`:111` join `AuthControllerBase.cs:78`, `:103`, `PasswordResetAuthControllerBase.cs:78`, `:102`,
`EmailConfirmationControllerBase.cs:81`, `:109`; ADR-019 Revised 2026-11-23 `:46-52`, Decision item 3
`:93-121`), in layer three, the trade-offs and the recap; the sibling pins are
`PasswordResetAuthControllerBaseTests.cs:132`, `EmailConfirmationControllerBaseTests.cs:132`,
`OAuthControllerBaseOidcTests.cs:188` and `Tests/Core/MMCA.Common.Passkeys.Tests/PasskeysControllerBaseTests.cs:341`
(a Theory over `signin/options` and `signin`), and a Grep of `MMCA.Common` for `RateLimitPolicyAuthIp` and
`"auth-ip"` finds no test pin for `MachineTokenControllerBase` or `SignInLinkControllerBase`; the lockout
carries `RetryAfter` (`LoginProtectionService.cs:103-107`, `LockoutUntilKey` `:69` written `:162-166`, doc
`:29-36`) which `ApiControllerBase.cs:87-99` writes as `Retry-After`, so "a 429 that says only to try again
later" was replaced; a reset clears three keys (`:188-190`); the backoff snippet mirrors `:151-175` and its
lead-in names the three statements it leaves out (`:145-149`, `:162-166`, `:171-174`); the fixed window is a
`RemainingWindowFixedWindowRateLimiter` (`WebApplicationBuilderExtensions.RateLimiting.cs:310-318`, type
in `Source/Build/RateLimiting/`), now named in layer one; ADC and Store service hosts reach
`AddCommonRateLimiting(IConfiguration)` and `AddRedisCaching` through `AddMmcaServiceHost`
(`ServiceHostBuilderExtensions.cs:110`, `:91`; ADC Identity `Program.cs:79`, Conference `:82`, Engagement
`:58`, Notification `:58`; Store Catalog `:32`, Identity `:37`, Sales `:51`), so the per-host
`AddCommonRateLimiting` anchors and the "local copy deleted" call-site comment were replaced (the ADC
Identity comment is `Program.cs:113-116`); both UI hosts reach `AddBoundedBlazorCircuits`,
`AddUiRateLimiting` and `UseUiRateLimiting` through `AddMmcaBlazorWebHost` / `UseMmcaBlazorWebPipeline`
(`BlazorWebHostExtensions.cs:95`, `:96`, `:187`; ADC UI `Program.cs:26`, `:128`, `:130`; Store UI `:30`,
`:92`; ADR-124 Revised 2026-11-23 `:19-22`); Store Sales declares `RateLimiting:HubPathPrefixes`
`["/hubs", "/Payments"]` (`appsettings.json:100-102`, rationale `:93-99`, Distributed off per `:99`) and
registers `AddQuoteRateLimiting` (`Program.cs:97`, comment `:95-96`), so "Store declares no `RateLimiting`
section" was replaced; Notification's section is `appsettings.json:57-59` (rationale `:48-56`) and its
former binding comment no longer exists; ADC `main.bicep` keys moved (Distributed `:2407`, `:2670`, `:2815`,
`:2985` on `identityApp` `:2312`, `conferenceApp` `:2590`, `engagementApp` `:2749`, `notificationApp`
`:2901`; AuthIp 300 `:2536`, rationale `:2527-2533`; registrations 500 `:2537`); Store `main.bicep` Gateway
keys `:2580`, `:2586`, `:2711`; the header gained ADR-019 2026-11-17 and 2026-11-23, ADR-029 through
2026-11-23 and ADR-124 2026-11-23. Source and ADR drift noted, not edited: the comment at
`WebApplicationBuilderExtensions.RateLimiting.cs:447-449` still says the `auth-ip` no-IP rule mirrors the
global limiter's fail-open posture, which ADR-019 Revision 2026-10-01 withdraws; ADR-019 Revision
2026-10-19 (`:469-480`) still says Store declares no `RateLimiting` section, which Sales `appsettings.json:100`
contradicts; the article follows the code in both cases. Layer one
(`WebApplicationBuilderExtensions.RateLimiting.cs`, 458 lines): `WithRetryAfterHeader` `:22-40` (wired
`:435`, comment `:433-434`); `RateLimitPolicyAuthIp` `:49` (docs `:42-48`); `RateLimitPolicyMcp` `:57`;
SEC-Common-44 remark `:62-70` (tag `:64`, after-`UseRouting` `:68-69`); `IsRateLimitBypassed` `:76-80`;
`AnonymousPartition` `:92-102` (`"anonymous-hub"` `:96`, `"hub"` `:97`, `allowDistributed` `:101`,
`__anonymous` `:102`); `IsAnonymousHubRequest` `:112`; `GrpcServerMetadataNamespace` `:129`;
`IsGrpcEndpoint` `:137`; subject-first doc `:160-161`; `GlobalRateLimitPartition` `:172-197` (`__infra`
`:176`, `IsAuthenticated` `:179`, `AnonymousPartition` `:181`, key chain `:184-187`, factory call
`:189-196`, `"global"` `:192`, `allowDistributed` `:196`); `McpRateLimitPartition` `:209-225` (`"mcp"`
`:220`, `:224`); `allowDistributed` doc `:254-258`; `CreateLimitedPartition` `:259-319` (Redis branch
`:268-296`, no-multiplexer comment `:293-295`, sliding `:298-308`, fixed `:310-318`);
`AuthIpRateLimitPartition` remarks `:325-331`, settings overload `:341-355` (`RemoteIpAddress` `:343`,
`__unknown-ip` `:345-346`, factory `:347-354`, `allowDistributed: false` `:354`); registration doc
`:363-364`; `authIpPermitLimit` doc `:380-387` (43K `:384-386`); permit-count overload `:388-393`;
`IConfiguration` overload `:403-415` (`ValidateOnStart` `:410`); settings overload `:425-456`
(`AddRateLimiter` `:429`, 429 `:431`, `GlobalLimiter` `:437-438`, `mcp` `:442`, forwarded-headers comment
`:444-451`, `auth-ip` `:452-454`). `RateLimitingSettings.cs` `:21`, `:24`, `:28`, `:35`, `:43`, `:49`,
`:58`, `:60-67`, `:68`, `:87`, `:95`; `RedisFixedWindowRateLimiter.cs` `:29`, `:41`, `:50-52`. Carried
(confirmed by the 2026-11-25 audit, not re-read in this apply): hub rationale `RateLimitingSettings.cs:70-86`,
`RateLimitAlgorithm.cs:15,22`, the `:122` and `:156` ends of the hub and gRPC predicates. Layer two:
`LoginProtectionService.cs` fail-open doc `:22-28`, retry doc `:29-36`, class `:38`, normalization doc
`:51-59`, `LockoutKey` `:60`, `AttemptsKey` `:62`, `LockoutUntilKey` `:69`, `CheckLockoutAsync` `:72`
(shared-store read `:79-82`, error `:103-107`), `IncrementFailedAttemptsAsync` `:127` (non-atomic comment
`:129-137`, tail `:151-175`, backoff `:159`), `ResetFailedAttemptsAsync` `:184` (`:188-190`),
`CheckRegistrationRateLimitAsync` `:199` (no-IP `:201-204`, key `:206`, read `:213`, `Unauthorized`
`:221-226`), `IncrementRegistrationCountAsync` `:230` (no-IP `:232-235`, TTL comment `:237-239`),
registration-key doc `:253-258`, `RegistrationKey` `:259`, `IpKeySegment` `:261-262`, `LogCacheUnavailable`
`:279-281`, catches `:92-96`, `:177-180`, `:192-195`, `:215-219`, `:247-250`; `EmailIdentity.cs`
`KeySegment` `:25-26`, `Normalize` `:36` (doc `:16-22` carried); `ILoginProtectionService.cs:10`;
`DependencyInjection.cs` `:58`, `:159`; `ErrorHttpMapping.cs` `:29`, `:34`; `ApiControllerBase.cs:87-99`;
`Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs` `:12`, `:18`, `:24`, `:31`, `:37`,
`:43`. Call sites:
`AuthenticationServiceBase.cs` `:180`, `:204`, `:214`, `:885`, `:274`, `:322`, `:385`;
`ResetPasswordHandlerBase.cs` `:46`, `:120`; `ChangePasswordHandlerBase.cs` `:60`, `:102`, `:110`, `:115`,
key `:144-145` (doc `:48-53` carried); `ConfirmTwoFactorEnrollmentHandlerBase.cs:75-91`,
`DisableTwoFactorHandlerBase.cs:54-82`, `RegenerateRecoveryCodesHandlerBase.cs:57-83`;
`TwoFactorAttemptKey.cs:21` (remarks `:10-14` carried); ADC `AuthenticationService.cs` `:55`, `:56`, `:65`;
Store `:29`, `:36`. Layer three: `AuthControllerBase.cs` login `:78`/`:82`, register `:103`/`:109`, docs
`:26-35`, `:36-42`, `:43-47`, refresh `:164-169`/`:170`; ADC `AuthController.cs` `:55`/`:60`, `:123`/`:127`;
Store `AuthController.cs` `:54`/`:59`, doc `:41-51`; `AuthControllerBaseRateLimitTests.cs` `:15-21`,
`:24-34`, `:40-45`, `:51-55`, `:57-60`, `:61-79`; ADC and Store `EmailConfirmationController.cs:32`/`:33`
carried through ADR-019 `:93-121`. UI edge: `UiRateLimitingExtensions.cs` summary `:16-19`, `/_blazor`
`:39-45`, `WithRetryAfterHeader` `:47-66` (wired `:236`), `AddUiRateLimiting` `:217`, `UseUiRateLimiting`
`:271`; `UiRateLimitingSettings.cs:76`; `BoundedCircuitHandler.cs` and `BlazorCircuitLimitSettings.cs`
anchors carried. ADRs: ADR-019 Status through 2026-11-23 (`:42-52`), Decision item 3 `:93-121`,
deliberate difference `:135-143`, Revision 2026-08-18 `:239-297` (`auth-ip` cost `:274-279`, Redis fail-open
`:281-283`, narrowed `:292-296`), Revision 2026-10-01 `:373-386`, Revision 2026-10-19 `:469-480`, Revision
2026-11-23 from `:641`. ADR-029 Status through 2026-11-23 (`:28-38`), reset-password and change-password
call sites in Status `:17-19`, principal-keyed uses `:86-90`, non-atomic trade from `:101`, Revision
2026-11-23 from `:479` (the two-factor bases as principal-keyed call sites `:517`). ADR-124 Status through
2026-11-23 (`:19-22`), separate origin `:26-31`, Decision `:53-55`. Earlier corrections (2026-10-02,
2026-10-08, 2026-10-22, 2026-10-29, 2026-11-17) are superseded by this re-verification.*

- Full series index: https://ivanball.github.io/writing.html
