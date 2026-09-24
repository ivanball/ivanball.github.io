# Defending the API edge: three controls that cover the whole surface

> Series: MMCA.Common · Article #30 (deep-dive) · Pillar P2/P4 · Group G08 · Rubric §11 · ADR-019/029/124 ·
> Status: grounded in the `MMCA.Common.API` rate-limit source, the `AuthControllerBase` anti-spray
> defaults and the test that pins them, the `MMCA.Common.Infrastructure/Auth` login-protection source,
> both apps' Identity adoption and their UI hosts' circuit ceiling, and
> `Website/docs-src/adr/019-rate-limiting.md` (Accepted, revised 2026-08-01, 2026-08-18, 2026-09-07,
> 2026-09-10 and 2026-09-19), `Website/docs-src/adr/029-authentication-brute-force-protection.md`
> (Accepted 2026-06-27, updated through 2026-09-19) and
> `Website/docs-src/adr/124-blazor-circuit-ceiling-ui-edge.md` (Accepted 2026-09-19). No em dashes.

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

`AddCommonRateLimiting` (in `MMCA.Common.API`,
`Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:386`) installs a
`GlobalLimiter` (`:430-431`) that runs on every request. Its partition function,
`GlobalRateLimitPartition` (`WebApplicationBuilderExtensions.cs:169-194`), makes three decisions in
order, and the order is the whole design.

First, it exempts infrastructure traffic outright. `IsRateLimitBypassed`
(`WebApplicationBuilderExtensions.cs:75-79`) returns `GetNoLimiter("__infra")` (`:173`) for `/health`
(`:76`), `/alive` (`:77`), JWKS and OIDC discovery under `/.well-known` (`:78`), and any request that
routed to a mapped gRPC method (`IsGrpcEndpoint`, `:79`, implemented at `:136-155`). That last arm is
keyed on the routed endpoint's `Grpc.AspNetCore.Server` metadata (`GrpcServerMetadataNamespace`,
`:128`), never on the request's `Content-Type`, and the remark above it says why (`:62-68`,
SEC-Common-44): a content type is caller-supplied and unverifiable, so keying on one hands any
authenticated account the no-limiter partition for the price of stamping
`Content-Type: application/grpc` on an ordinary request. Endpoint metadata is produced by routing from
the server's own `MapGrpcService` registrations, so it cannot be forged, and the predicate runs from
middleware that sits after `UseRouting`, so the endpoint is already resolved (`:66-68`). All of these
are legitimately high-frequency: a probe that gets throttled is an outage, and a JWKS fetch the auth
middleware depends on must never be capped.

Second, it hands anonymous traffic to its own partition, which is a no-limiter for almost all of it. When
`httpContext.User?.Identity?.IsAuthenticated != true` (`:176`) the request goes to `AnonymousPartition`
(`:178`, declared at `:91-101`), which returns `GetNoLimiter("__anonymous")` (`:101`) for every path but
one. That is the deliberate gap: public reads are output-cached and cheap, anonymous Blazor Server
browsing shares one IP, and login brute-force has its own controls. None of those should be counted by a
per-principal limiter.

The exception is a real-time hub. `IsAnonymousHubRequest` (`:111-121`) matches the request path against
`HubPathPrefixes` (default `["/hubs"]`, `RateLimitingSettings.cs:91`), and a match is metered per client
IP at `AnonymousHubPermitLimit` (default 60, `RateLimitingSettings.cs:99`) under Redis scope `"hub"` with
`allowDistributed: true` (`WebApplicationBuilderExtensions.cs:93-100`). The reason sits on the setting
(`RateLimitingSettings.cs:74-90`, SEC-ADC-25): the gateway bypasses `/hubs` at the edge, because ADR-024's
hub authenticates from a query-string token the edge cannot read, which leaves `/hubs/*/negotiate` as the
one anonymous route nothing else counts, where an unauthenticated loop costs full middleware plus
auth-reject CPU per request. Authenticated hub traffic is untouched by this: it already takes the per-user
partition (`RateLimitingSettings.cs:87-89`).

Third, and only for an authenticated caller, it caps. The partition key is the principal's identity name,
falling back to `FindUserIdValue()`, the subject claim (`:182`), then the remote IP, then a literal
`"authenticated"` (`WebApplicationBuilderExtensions.cs:181-184`). That key goes to
`CreateLimitedPartition` (`:186-193`, declared at `:238-289`), which by default builds a fixed one-minute
window with a permit limit of `GlobalPermitLimit`, which defaults to 300 (`RateLimitingSettings.cs:40`),
and a queue limit of zero so overage is rejected rather than buffered
(`WebApplicationBuilderExtensions.cs:282-288`). Rejection is a `429 Too Many Requests` (`:428`).

The code is short enough to read whole. This is condensed from the real partition function
(`WebApplicationBuilderExtensions.cs:169-194`) plus the anonymous partition it delegates to (`:91-101`).
The factory both of them call has two further branches, a sliding window (`:270-280`) and a shared Redis
counter (`:247-268`), which are the configuration layer covered further down; neither is on by default:

```csharp
// Illustrative of the real GlobalRateLimitPartition shape (condensed, default settings).
// Order is load-bearing: infra exempt, then the anonymous partition, then cap the principal.
internal static RateLimitPartition<string> GlobalRateLimitPartition(HttpContext ctx, RateLimitingSettings settings)
{
    if (IsRateLimitBypassed(ctx))                          // /health, /alive, /.well-known, gRPC endpoints
        return RateLimitPartition.GetNoLimiter("__infra");

    if (ctx.User?.Identity?.IsAuthenticated != true)       // the deliberate gap layers two and three fill
        return AnonymousPartition(ctx, settings);

    var partitionKey = ctx.User.Identity.Name              // attributable to a principal
        ?? ctx.User.FindUserIdValue()                      // the subject claim
        ?? ctx.Connection.RemoteIpAddress?.ToString()
        ?? "authenticated";

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

The same method registers three named policies alongside the global limiter. Two of them, `FixedPolicy`
(`WebApplicationBuilderExtensions.cs:436-443`) and `UserPolicy` (`:445`), are purely opt-in: nothing
applies them automatically, and they are there for the endpoint that knows it is special. The third is the
per-IP auth throttle registered at `:455-457`, and unlike the other two the framework attaches it for
you. That is layer three.

### Layer two: a pre-authentication guard keyed on the submitted identity

The second layer exists for one reason: the first layer exempts the anonymous surface, and the login and
registration endpoints live on it. `ILoginProtectionService`
(`Source/Core/MMCA.Common.Application/Auth/ILoginProtectionService.cs:10`) is the contract, and
`LoginProtectionService` (`Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:19`) is
the implementation. It is registered unconditionally by `AddInfrastructure`
(`Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:72`) via
`TryAddScoped<ILoginProtectionService, LoginProtectionService>()` (`DependencyInjection.cs:168`), so every
host that wires infrastructure has it. Its state lives entirely in `ICacheService`, never in a table.

It keys on the *submitted* identity and the client IP, not on a principal, which is exactly what lets it
work before authentication.

**Login lockout, keyed by email.** `IncrementFailedAttemptsAsync(email)`
(`LoginProtectionService.cs:64`) counts consecutive failures under a `login:attempts:{email}` cache key
(`AttemptsKey`, `:47`) inside a window of `FailedAttemptWindowMinutes` (default 30,
`LoginProtectionSettings.cs:31`). Once the count reaches `MaxFailedAttempts` (default 5,
`LoginProtectionSettings.cs:18`), it writes a lockout key with exponential backoff:
`Math.Min(1 << Math.Min(excessAttempts, 30), _settings.MaxLockoutSeconds)`
(`LoginProtectionService.cs:88`), so each extra failure doubles the wait up to the `MaxLockoutSeconds`
cap (default 300, `LoginProtectionSettings.cs:24`). The inner `Math.Min(excessAttempts, 30)` clamps the
shift exponent: a large `excessAttempts` would overflow the `int` shift (C# masks the count to five
bits, so `1 << 32` wraps back to 1), silently shrinking the lockout, and 30 already exceeds any
permitted cap. `CheckLockoutAsync(email)` (`LoginProtectionService.cs:50`) returns
`Result.Failure(Error.Unauthorized("Auth.TooManyAttempts", ...))` while the lockout key is present
(`:55-60`), and `ResetFailedAttemptsAsync(email)` (`:94`) clears both the attempt and lockout keys on a
successful login (`:96-97`).

That `{email}` is the *normalized* address, not the raw request string, and the difference is the whole
control. Both key builders route the submitted value through `NormalizeIdentity`
(`LoginProtectionService.cs:34-43`), which runs it through the same `Email` value object the user lookup
uses (trim and lowercase, falling back to a plain trim-and-lowercase when the address is malformed), so
`LockoutKey` (`:45`) and `AttemptsKey` (`:47`) build one key per account. Key off raw input instead and
`User@x.com`, `user@x.com` and a padded variant hit one account but get three independent counters:
an attacker defeats the backoff by varying capitalization.

**Registration throttle, keyed by IP.** `CheckRegistrationRateLimitAsync(ip)`
(`LoginProtectionService.cs:101`) fails with
`Error.Unauthorized("Auth.RegistrationRateLimitExceeded", ...)` (`:111-116`) once
`MaxRegistrationsPerIpPerHour` (default 10, `LoginProtectionSettings.cs:37`) signups from one IP land
inside `RegistrationRateLimitWindowMinutes` (default 60, `LoginProtectionSettings.cs:43`), tracked under a
`registration:ip:{ip}` key (`RegistrationKey`, `LoginProtectionService.cs:136`, read at `:108`).
`IncrementRegistrationCountAsync(ip)` (`:120`) bumps that counter. A missing or empty IP is a deliberate
no-op that fails open (`:103-106`, `:122-125`): the check returns `Result.Success()` rather than blocking
a request it cannot attribute.

Every check returns `Result` (ADR-013), so the HTTP edge maps a lockout or a throttle to a uniform `401`
without the endpoint special-casing it. And because the counters live in the same swappable
`ICacheService` substrate, they self-expire by TTL: a lockout is inherently ephemeral, so cache expiry
*is* the reset.

Here is the backoff, the one line that does the work. It mirrors the tail of
`IncrementFailedAttemptsAsync` (`LoginProtectionService.cs:80-90`), with the source comment condensed and
the trailing `.ConfigureAwait(false)` elided:

```csharp
if (newCount >= _settings.MaxFailedAttempts)              // default 5
{
    // newCount is a long; clamp before the int shift.
    var excessAttempts = (int)Math.Min(newCount - _settings.MaxFailedAttempts, int.MaxValue);
    // Clamp the shift exponent to 30: a large excessAttempts would overflow the int shift
    // (C# masks the count to 5 bits, so 1 << 32 wraps back to 1, shrinking the lockout).
    var lockoutSeconds = Math.Min(1 << Math.Min(excessAttempts, 30), _settings.MaxLockoutSeconds); // doubles, cap 300s
    // LockoutKey normalizes the email first: one key per account, no principal needed.
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

`RateLimitPolicyAuthIp`, the `"auth-ip"` policy (`WebApplicationBuilderExtensions.cs:48`, rationale in its
XML docs at `:41-47`), is the control shaped for that: a fixed one-minute window keyed on the client IP,
applied to the anonymous credential endpoints only. Its partition selector is `AuthIpRateLimitPartition`
(`:311-325`), which reads `Connection.RemoteIpAddress` (`:313`), the same canonical source the global
partition uses and the value `UseForwardedHeaders` has already resolved from `X-Forwarded-For` earlier in
the shared pipeline (`:447-454`). An IP it cannot read returns `GetNoLimiter("__unknown-ip")` (`:316`)
rather than collapsing every unattributable request into one shared bucket, which would throttle the
in-process test server to a standstill; that is the same fail-open posture the global limiter takes for
traffic it cannot attribute. Everything else goes through the same factory with
`PermitLimit = AuthIpPermitLimit` and `QueueLimit = 0` (`:317-324`), rejected with the same `429`. It is
registered by the same `AddCommonRateLimiting` call (`:455-457`), which takes a fifth parameter for it:

```csharp
// Illustrative of the real AuthIpRateLimitPartition shape (condensed).
// Fail open on an IP it cannot read, rather than pooling every such request into one bucket.
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
`AddCommonRateLimiting(int permitLimit = 100, int queueLimit = 2, int perUserPermitLimit = 30, int globalPermitLimit = 300, int authIpPermitLimit = 30)`
(`WebApplicationBuilderExtensions.cs:386`), and every host calls exactly that overload. The default of 30
rather than a tighter 10 is documented on the parameter itself (`:378-385`): Blazor Server circuits issue
the login call server-side, so every Server-circuit user shares the UI host's IP and a legitimate login
burst has to fit inside the window. At 30 a minute a spray still drops from unlimited to roughly 43,000
attempts per day per IP, with per-account lockout intact on top (`:382-384`). Tightening toward 10 waits
on real client IPs being forwarded end to end.

The part worth copying is not the policy, though. It is that the framework attaches it for you.
`AuthControllerBase.LoginAsync`
(`Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:72`, action at `:76`) and
`RegisterAsync` (`:96`, action at `:101`) both carry
`[EnableRateLimiting(WebApplicationBuilderExtensions.RateLimitPolicyAuthIp)]`, so any consumer
inheriting the base gets per-IP protection without opting in. Its sibling
`PasswordResetAuthControllerBase` carries the same attribute on `forgot-password` (`:78`) and
`reset-password` (`:102`), so the framework's default surface is four anonymous credential actions; ADR-019
records both apps extending the same policy to the two email-confirmation actions on their
`EmailConfirmationController`, which the framework bases do not own
(`Website/docs-src/adr/019-rate-limiting.md:66-69`). The base documents why the default is attached rather
than opt-in (`AuthControllerBase.cs:20-29`): a policy that ships in the framework but leaves each app to
attach it is a policy an app can silently lack, and an app that simply inherited these actions would
have no spray protection at all. A consumer that inherits the base without calling `AddCommonRateLimiting` fails
at startup on an unregistered policy (`:37-41`), which is the loud failure rather than the silent one.

`RefreshAsync` carries no rate-limit attribute at all (attribute block `:117-121`, action `:122`), and
that is deliberate rather than an oversight (`:30-36`): refresh is automatic and periodic rather than
user-initiated, Blazor Server circuits issue it server-side so every Server-circuit user shares one IP,
and refresh tokens are high-entropy, so brute force is not the threat password spraying is. A per-IP
window there would throttle ordinary token renewal for everyone behind that host.

### The settings layer: the same three controls, tunable without a recompile

There are three controls, not four: the settings layer is configuration, not another defence. ADR-019
(`Website/docs-src/adr/019-rate-limiting.md:142-199`) records what it buys, the ability to tune the three
without a recompile, and one way to make several of them mean the same thing behind a load balancer.

The limits live in `RateLimitingSettings`
(`Source/Presentation/MMCA.Common.API/RateLimiting/RateLimitingSettings.cs:21`), bound from a
`"RateLimiting"` configuration section (`:24`) with a `[Range]` on every count.
`AddCommonRateLimiting` has three overloads: the permit-count one quoted above
(`WebApplicationBuilderExtensions.cs:386`), which only builds a settings object and delegates; an
`IConfiguration` one that binds the section and falls back to a default instance when it is absent
(`:404-412`); and the settings one that actually calls `AddRateLimiter` (`:422`). Every default matches
the framework's shipped value, so a host that configures nothing behaves exactly as described above.

The section also holds the two hub controls layer one uses, `HubPathPrefixes`
(`RateLimitingSettings.cs:91`) and `AnonymousHubPermitLimit` (`:99`), so which anonymous paths are
metered, and how hard, is a deployment decision rather than a constant.

Two knobs do more than relocate a constant. `Algorithm` (`RateLimitingSettings.cs:53`) can select
`RateLimitAlgorithm.SlidingWindow` (`RateLimitAlgorithm.cs:22`) instead of the default `FixedWindow`
(`:15`), dividing the same one-minute window into `SegmentsPerWindow` segments (default 4,
`RateLimitingSettings.cs:62`) so a caller can no longer spend a full minute's allowance at the end of one
window and again at the start of the next. That is a smoothing choice, not a new cap. And `Distributed`
(`:72`, default `false`) swaps the in-process counter for `RedisFixedWindowRateLimiter`
(`RateLimiting/RedisFixedWindowRateLimiter.cs:37`), which counts one key per partition per minute in
Redis so N replicas share one allowance instead of holding N of them.

Exactly three partitions may take that shared counter: the global limiter
(`WebApplicationBuilderExtensions.cs:186-193`, Redis scope `"global"` at `:189`), `UserPolicy`
(`UserPolicyRateLimitPartition`, `:204-218`, scope `"user"` at `:213`), and the anonymous hub partition
(`:93-100`, scope `"hub"` at `:96`). The `"auth-ip"` policy passes `allowDistributed: false` (`:324`), and
so does `FixedPolicy` (`:436-443`). That is deliberate, and the reason sits on the factory parameter
itself (`:233-237`): the per-IP window is a coarse backstop in front of a control that is already global
and stateful, the per-email lockout, so buying a tighter limit with a Redis round trip on the login path is
the wrong trade. ADR-019 states the same three-partition scope (`019-rate-limiting.md:171-175`).

The honest framing is that the section reaches almost none of it. ADC's Notification service is the one
host that declares one: `"RateLimiting": { "AnonymousHubPermitLimit": 600 }`
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/appsettings.json:53-55`), with a nine-line
rationale above it (`:44-52`) that the venue's NAT puts roughly 67 attendees behind a single address, so a
60-per-minute budget goes in seconds when the room reconnects. A declared section only reaches the limiter
through the `IConfiguration` overload, and no host calls it: that service calls the permit-count overload
(`MMCA.ADC.Notification.Service/Program.cs:141`), which builds a `RateLimitingSettings` from its five
integer parameters (`WebApplicationBuilderExtensions.cs:386-394`) and never reads
`RateLimitingSettings.SectionName`, so the hub limit in force there is the shipped default of 60
(`RateLimitingSettings.cs:99`). Every other host calls the same permit-count overload, and the one value
either app passes into it is ADC Identity's `authIpPermitLimit`
(`MMCA.ADC.Identity.Service/Program.cs:161-162`). Both apps therefore run the in-memory fixed-window
defaults this article describes.

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
`CheckLockoutAsync` (`:169`), `IncrementFailedAttemptsAsync` (`:189`, `:196`), `ResetFailedAttemptsAsync`
(`:240`), `CheckRegistrationRateLimitAsync` (`:267`), and `IncrementRegistrationCountAsync` (`:326`). The
ADC and Store `AuthenticationService` are sealed subclasses that take `ILoginProtectionService` as a
constructor parameter (ADC `AuthenticationService.cs:50`, Store `:26`) and forward it to the base
constructor (ADC `:60`, Store `:35`); ADC's subclass additionally injects `IExternalLoginEmailVerifier`
(`:51`) for its external OAuth flow. The login and registration workflow, and every protection call in it,
lives once in the base. One framework call site sits outside it: `ResetPasswordHandlerBase` takes
`ILoginProtectionService` as a constructor dependency
(`Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:47`) and
calls `ResetFailedAttemptsAsync(request.Email)` once the new credential is persisted (`:110`), so a user
who resets the password because of a lockout is not left locked out by it, which ADR-029 records at
`Website/docs-src/adr/029-authentication-brute-force-protection.md:95-98`. Settings bind from the
`"LoginProtection"` configuration section (`LoginProtectionSettings.cs:12`).

They adopt the third the same way, and the redundancy in that is deliberate. ADC's Identity service
re-declares the attribute on both actions it overrides
(`MMCA.ADC.Identity.API/Controllers/AuthController.cs:54` on register and `:108` on login, the overrides
at `:58` and `:112`) and tunes the window from configuration
(`MMCA.ADC.Identity.Service/Program.cs:161-162`, after deleting its own local copy of the policy because a
duplicate policy name throws at startup, `:153-160`). Store's Identity service takes the framework default
(`MMCA.Store.Identity.Service/Program.cs:136`) and its `RegisterAsync` override re-declares the attribute
too (`MMCA.Store.Identity.API/Controllers/AuthController.cs:50`, the override at `:54`), with a doc
comment saying exactly what that line is for (`:41-46`): the attribute is inherited by an override, so
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

### The UI origin needs a different ceiling, and it lives in the apps

Every control above bounds an arrival rate at an API host. The server-rendered Blazor UI host is the case
none of them reaches: it is a separate externally reachable origin on its own Container Apps FQDN, so the
gateway's edge limiter guards the gateway's own hostname and never sees a single request to the front door
a browser actually loads (ADR-124, `Website/docs-src/adr/124-blazor-circuit-ceiling-ui-edge.md:9-15`).

A page load there is also not a cheap request. Under the Interactive Auto render strategy the first render
is always a Server circuit, so every page load opens one, and each open circuit holds live render state
for as long as the connection lives, inside a container of 0.25 vCPU and 0.5 GiB
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Hardening/BoundedCircuitHandler.cs:13-19`,
`BlazorCircuitLimitSettings.cs:27-28`). The framework knob that looks like the answer is not one:
`CircuitOptions` exposes `DisconnectedCircuitMaxRetained` and `DisconnectedCircuitRetentionPeriod`, and
both bound only circuits that have already dropped their connection and are being held for reconnect
(`BlazorCircuitLimitSettings.cs:13-15`). A rate limiter does not close it from the other direction either:
it bounds how fast requests arrive, while a caller who opens circuits slowly enough to stay inside the
window still accumulates them (`BlazorCircuitLimitSettings.cs:10-13`).

So the ceiling is on concurrency, and it is held by a `CircuitHandler`. `BoundedCircuitHandler`
(`MMCA.ADC.UI.Web/Hardening/BoundedCircuitHandler.cs:37-39`) counts opens and closes and refuses anything
past `MaxActiveCircuits`, default 200 per replica (`BlazorCircuitLimitSettings.cs:40`, derived from that
container's memory and vCPU at `:27-35`). It is registered as a singleton so one count spans the replica:
circuit handlers are resolved from each circuit's own scope, so a scoped registration would count to one
and cap nothing (`BoundedCircuitHandler.cs:30-33`). It runs last among the registered handlers,
`Order => int.MaxValue` (`:46-50`), so a refusal lands after cheaper handlers have done their work. The
count is race-safe by construction in both directions: the open path increments first and rolls back on
refusal (`:57-62`), because reading and then incrementing would let two simultaneous opens both take the
last free slot, and the close path floors at zero rather than trusting the pairing (`:74-83`), because a
close without a counted open would drive the count negative and hand out permits forever.

```csharp
// The real open path (MMCA.ADC.UI.Web/Hardening/BoundedCircuitHandler.cs:53-71), logging elided.
public override Task OnCircuitOpenedAsync(Circuit circuit, CancellationToken cancellationToken)
{
    var ceiling = settings.Value.MaxActiveCircuits;

    // Increment first and roll back on refusal: reading then incrementing would let two
    // simultaneous opens both observe the last free slot and both take it.
    var active = Interlocked.Increment(ref _activeCircuits);
    if (active > ceiling)
    {
        Interlocked.Decrement(ref _activeCircuits);

        return Task.FromException(new InvalidOperationException(/* ...the ceiling, to the user... */));
    }

    return Task.CompletedTask;
}
```

The refusal is a thrown exception, and the type says in place that this is the one spot where the `Result`
pattern does not apply (`:22-27`): `CircuitHandler.OnCircuitOpenedAsync` returns `Task` and has no
"refuse" return value, so a faulted task is the only way to stop a circuit from starting, and the contract
belongs to the framework. Refusal is observable rather than silent, one Warning per refusal naming the
ceiling (`:88-91`).

Say the ownership plainly: this one is app code, not a framework package. `BoundedCircuitHandler` and
`BlazorCircuitLimitSettings` sit in each UI host's own `Hardening/` folder, identical in MMCA.ADC and
MMCA.Store (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Hardening/BoundedCircuitHandler.cs:37-39`,
`BlazorCircuitLimitSettings.cs:39`), and ADR-124 records it as a decision about those two hosts
(`124-blazor-circuit-ceiling-ui-edge.md:37-51`). A limiter and a ceiling bound different resources, so
having the rate limiter in a shared package does not mean the concurrency bound belongs there too.

## Trade-offs, honestly

None of the three is a complete edge defence on its own, and the §11 review is explicit about the
boundaries.

- **Per-principal keying needs an authenticated identity, full stop.** The global limiter can only key
  what it can attribute, so the anonymous surface *must* be covered separately. That is not a workaround;
  it is precisely why the other two controls exist. An uncached anonymous endpoint added later would have
  no global cap and would need its own control or a named policy.
- **The limiter's placement is load-bearing.** Per-user partitioning depends on the authenticated
  principal already being populated when the limiter runs
  (`WebApplicationBuilderExtensions.cs:176,181`). Move the limiter relative to authentication in the
  pipeline and the partition sees a different or empty principal. The gRPC exemption has the same
  property in the other direction: it reads the routed endpoint, so it depends on running after
  `UseRouting` (`:66-68`). This is a config-order trap, not a code bug.
- **Attribute-shaped protection fails silently when it goes missing.** The per-IP throttle is applied by
  an attribute, so dropping it breaks nothing loudly: the endpoint simply stops being throttled and the
  app keeps serving traffic. A host missing the attribute has no spray protection while every build
  and analyzer stays green, which is why
  `AuthControllerBaseRateLimitTests` asserts the attribute's presence on the anonymous credential
  endpoints and its deliberate absence on refresh, directly
  (`MMCA.Common.API.Tests/Controllers/Auth/AuthControllerBaseRateLimitTests.cs:15-21` for the reasoning,
  `:24-34` and `:40-45` for the assertions). A security control that is invisible when
  it is missing needs a test whose only job is to notice.
- **The per-IP auth throttle is coarse, fail-open, and deliberately loose.** Shared NAT, proxies and
  Blazor Server circuits put many users behind one IP, which is exactly why the default is 30 a minute
  rather than 10 (`WebApplicationBuilderExtensions.cs:378-385`), and an IP it cannot read is not limited
  at all (`:316`). It covers the four anonymous credential actions the framework bases carry and the two
  email-confirmation actions each app adds, and deliberately not refresh. It raises the cost of spray
  from one source by orders of magnitude; it does not stop an attacker rotating across many.
- **Email-keyed lockout is a denial-of-service-on-the-user lever.** An attacker can lock a *known*
  account out by deliberately failing its logins. That is why the control is exponential backoff with a
  short cap (default 300s, `LoginProtectionSettings.cs:24`) plus a generic `401`, not a hard permanent
  block. It bounds the harm to a brief self-healing lockout, an accepted availability-for-security trade.
- **Cache-scoped state weakens under scale-out, and for the limiter the fix is opt-in.** In memory mode
  the login-protection counters are per-replica and evaporate on restart, so a multi-replica deployment
  that did not wire a distributed cache does not aggregate an attacker hitting different replicas; the
  answer there is to wire a distributed cache once scaled out, which both apps do. The global limiter's
  in-process counters have the same shape: across N replicas the effective ceiling is roughly N times the
  configured limit. The framework ships a way out for that one, the shared Redis counter behind
  `Distributed = true` for the global, `UserPolicy` and anonymous-hub partitions
  (`RateLimitingSettings.cs:64-72`, `WebApplicationBuilderExtensions.cs:93-100`), but
  it defaults to `false` and neither app sets it, so the ceiling is N times the limit
  everywhere. ADR-019 calls the trade-off narrowed rather than removed
  (`Website/docs-src/adr/019-rate-limiting.md:195-199`), and it stands exactly as written for `auth-ip`
  and `FixedPolicy`, which never take the shared counter.
- **Turning the shared counter on can silently do nothing.** Setting `Distributed = true` in a host with
  no `IConnectionMultiplexer` registered degrades to the in-memory limiter rather than failing startup
  (`WebApplicationBuilderExtensions.cs:247-268`, documented at `RateLimitingSettings.cs:64-71`), and the
  Redis limiter itself fails open on a Redis fault, granting the lease and warning at most once per
  window (`Website/docs-src/adr/019-rate-limiting.md:184-193`). Both are the right posture for a backstop
  that must never become an outage, and both mean a misconfiguration here looks exactly like success.
- **The counter increment is not atomic, by decision.** `IncrementAsync` is a read-modify-write on the
  cache, and the code says why in place (`LoginProtectionService.cs:66-74`): a Redis `INCR` writes a
  plain string key, while `IDistributedCache` reads entries back as hashes, so an atomic increment issued
  underneath the cache abstraction leaves a counter the cache itself cannot read. A readable counter is
  worth more than an atomic one. The accepted cost is that genuinely parallel attempts can overwrite each
  other's increments and undercount, so a concurrent burst can stay under `MaxFailedAttempts`; sequential
  guessing, which is what a credential-stuffing run against one account looks like, still trips the
  lockout. The same shape means each write refreshes the TTL, so both windows slide rather than staying
  anchored to the first attempt (`:127-129`), which only ever tightens the limit. ADR-029 records the
  whole trade, including the opt-in `HybridCacheService` that overrides the member with the same shape
  (`029-authentication-brute-force-protection.md:69-85`).
- **The per-IP registration throttle is coarse and fail-open.** Shared NAT or proxy IPs throttle innocents
  together, per-attacker IP rotation evades it, and a missing IP is a deliberate no-op
  (`LoginProtectionService.cs:103-106`). It raises the cost of bulk signup; it does not stop a determined
  distributed attacker.
- **The defaults are deployment-agnostic.** 300 requests per minute per user is a coarse backstop, not a
  tuned SLO. A service with heavier legitimate per-user traffic must raise `GlobalPermitLimit`, a host
  with real client IPs can tighten `AuthIpPermitLimit` (ADC binds that one value to configuration), and a
  stricter endpoint must opt into a named policy. Those knobs have a `"RateLimiting"` section to live
  in (`RateLimitingSettings.cs:21-99`), which makes tuning a deployment concern rather than a recompile,
  but reaching the section at all takes the `IConfiguration` overload (`WebApplicationBuilderExtensions.cs:404-412`),
  and no host calls it.

None of these argue against the layering. They are the edges of what each control is for: a per-principal
cap protects attributable throughput, a per-source window protects anonymous credential submission, a
pre-auth service protects the account being guessed, and together they cover what none of them covers
alone.

## Apply this even without MMCA

The shape ports to any ASP.NET Core service, with or without this framework:

1. **Pick the partition key before you pick the limit.** "300 a minute" is meaningless until you answer
   "per what." Per authenticated principal caps attributable load without punishing shared-origin
   anonymous browsing; per IP does the opposite. Choose deliberately, because the key determines who you
   actually protect.
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
per-principal traffic and exempts infrastructure and anonymous traffic outside the real-time hub paths,
why that exemption leaves the most-attacked endpoints uncovered, how `ILoginProtectionService` closes part
of that gap with email-keyed exponential-backoff lockout and a per-IP registration throttle that key on
the submitted identity rather than a principal, how the `"auth-ip"` per-source window closes the rest by
catching password spray that no per-account counter can see and is attached by default on
`AuthControllerBase` and `PasswordResetAuthControllerBase` rather than left to each app to remember, what
the settings layer adds on top (a bound `"RateLimiting"` section, the hub-path controls, a selectable
sliding window, and an opt-in shared Redis counter for three of the partitions, none of which either app
has turned on), why the UI origin gets a concurrency ceiling in app code rather than another limiter, and
the honest boundaries in all three: principal-dependence, config order, silently-droppable attributes,
shared-IP coarseness, the DoS-on-the-user lever, and cache state under scale-out.

**Next in the series:** Aspire, the one command that brings up the whole distributed stack locally.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the ADRs behind this pattern, or
`dotnet add package MMCA.Common.API` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-019 (rate limiting), ADR-029 (brute-force protection) and ADR-124 (the UI-origin circuit
  ceiling): `Website/docs-src/adr/` in the docs site.

*Tags: .NET, C Sharp, Security, Web API, Software Architecture*

*Notes: every type, number and anchor below was read from source on 2026-09-19 against MMCA.Common at
v1.205.0. Corrections this pass: the anonymous branch of the global partition is no longer an
unconditional no-limiter, the gRPC exemption is keyed on endpoint metadata rather than a content type,
three partitions (not two) may take the shared Redis counter, the `auth-ip` surface is four framework
actions rather than two, `ResetPasswordHandlerBase` is a second framework call site for the protection
service, ADC's Notification service declares a `"RateLimiting"` section that no overload in its host
reads, and every `WebApplicationBuilderExtensions.cs`, ADR-019, ADR-029 and test anchor moved. A section
on the UI-origin circuit ceiling (ADR-124) was added. Layer one:
`AddCommonRateLimiting(int permitLimit = 100, int queueLimit = 2, int perUserPermitLimit = 30, int globalPermitLimit = 300, int authIpPermitLimit = 30)`
(`Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.cs:386-394`, `authIpPermitLimit`
XML docs `:378-385` carrying the 30-not-10 rationale and the roughly 43K attempts/day/IP figure at
`:380-384`); `IConfiguration` overload binding `RateLimitingSettings.SectionName` and falling back to a
default instance (`:404-412`); settings overload calling `AddRateLimiter` (`:422-459`) with
`RejectionStatusCode = StatusCodes.Status429TooManyRequests` (`:428`),
`GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(...)` (`:430-431`), `"FixedPolicy"`
(`:436-443`, `allowDistributed: false`), `"UserPolicy"` (`:445`, delegating to
`UserPolicyRateLimitPartition` at `:204-218`) and `options.AddPolicy(RateLimitPolicyAuthIp, ...)`
(`:455-457`) beside the forwarded-headers and fail-open comment (`:447-454`).
`GlobalRateLimitPartition` has a permit-count overload (`:161-162`) delegating to the settings one
(`:169-194`): `IsRateLimitBypassed` (`:75-79`) covering `/health` (`:76`), `/alive` (`:77`),
`/.well-known` (`:78`) and `IsGrpcEndpoint` (`:79`) via `GetNoLimiter("__infra")` (`:173`).
`IsGrpcEndpoint` (`:136-155`) matches the routed endpoint's metadata namespace against
`GrpcServerMetadataNamespace = "Grpc.AspNetCore.Server"` (`:128`); the remark at `:62-68` records
SEC-Common-44, that a `Content-Type: application/grpc` header handed any authenticated account the
no-limiter partition, and that the predicate runs after `UseRouting` (`:66-68`). Anonymous traffic goes to
`AnonymousPartition` (`:178`, declared `:91-101`), which returns `GetNoLimiter("__anonymous")` (`:101`)
unless `IsAnonymousHubRequest` (`:111-121`) matches one of `RateLimitingSettings.HubPathPrefixes`
(default `["/hubs"]`, `RateLimiting/RateLimitingSettings.cs:91`, rationale `:74-90` recording SEC-ADC-25
and the ADR-024 gateway bypass, with the authenticated-traffic note at `:87-89`), in which case it is
metered per `Connection.RemoteIpAddress` at `AnonymousHubPermitLimit` (default 60, `:93-97,99`) under
Redis scope `"hub"` with `allowDistributed: true` (`WebApplicationBuilderExtensions.cs:93-100`). The
authenticated partition key chain is `User.Identity.Name` to `FindUserIdValue()` (the subject claim) to
the remote IP to `"authenticated"` (`:181-184`), then `CreateLimitedPartition(..., redisScope: "global",
permitLimit: settings.GlobalPermitLimit, queueLimit: 0, ..., allowDistributed: true)` (`:186-193`).
`CreateLimitedPartition` (`:238-289`) chooses between the Redis branch (`:247-268`, including the
fall-through to memory when no `IConnectionMultiplexer` is registered, `:265-267`), the sliding-window
branch (`:270-280`) and the default fixed window (`:282-288`, `QueueProcessingOrder.OldestFirst` at `:287`
omitted from the rendered snippet); the `allowDistributed` rationale for keeping `auth-ip` local is on the
parameter (`:233-237`). Layer three: `RateLimitPolicyAuthIp = "auth-ip"` (`:48`, XML docs `:41-47`),
selector `AuthIpRateLimitPartition` with two overloads (`:302-303`, `:311-325`), reading
`Connection.RemoteIpAddress` (`:313`), `GetNoLimiter("__unknown-ip")` on a null IP (`:316`), else
`CreateLimitedPartition(..., permitLimit: settings.AuthIpPermitLimit, queueLimit: 0, ..., allowDistributed: false)`
(`:317-324`). Applied by default, not opt-in: `AuthControllerBase.LoginAsync`
(`Source/Presentation/MMCA.Common.API/Controllers/AuthControllerBase.cs:72`, action `:76`) and
`RegisterAsync` (`:96`, action `:101`) carry
`[EnableRateLimiting(WebApplicationBuilderExtensions.RateLimitPolicyAuthIp)]`, as do
`PasswordResetAuthControllerBase`'s `forgot-password` (`Controllers/PasswordResetAuthControllerBase.cs:78`,
route `:75`) and `reset-password` (`:102`, route `:99`); the base's XML docs record the anti-spray default
(`:20-29`), the deliberate absence on refresh (`:30-36`) and the loud startup failure without
`AddCommonRateLimiting()` (`:37-41`); `RefreshAsync` carries no such attribute (attribute block `:117-121`,
action `:122`). Pinned by
`Tests/Presentation/MMCA.Common.API.Tests/Controllers/Auth/AuthControllerBaseRateLimitTests.cs` (namespace
`MMCA.Common.API.Tests.Controllers.Auth`, `:13`; docstring `:15-21` recording that a dropped attribute
fails silently; `AnonymousCredentialEndpoint_CarriesTheAuthIpPolicy` `:24-34`,
`RefreshEndpoint_IsDeliberatelyNotThrottledPerIp` `:40-45`,
`EnableRateLimitingAttribute_IsDeclaredInherited` `:51-55` with its comment at `:47-50`,
`DerivedOverride_WithoutTheAttribute_StillCarriesTheAuthIpPolicy` `:61-79`, the mechanism-not-a-blessing
comment `:57-60`, test double `:88-97`). Settings layer: `RateLimitingSettings` (`RateLimitingSettings.cs:21`),
`SectionName = "RateLimiting"` (`:24`), `PermitLimit = 100` (`:28`), `QueueLimit = 2` (`:32`),
`PerUserPermitLimit = 30` (`:36`), `GlobalPermitLimit = 300` (`:40`), `AuthIpPermitLimit = 30` (`:47`),
`Algorithm` defaulting to `RateLimitAlgorithm.FixedWindow` (`:53`), `SegmentsPerWindow = 4` (`:62`,
`[Range(1, 60)]`), `Distributed` defaulting to `false` (`:72`, silent-degrade behaviour documented
`:64-71`), `HubPathPrefixes = ["/hubs"]` (`:91`) and `AnonymousHubPermitLimit = 60` (`:99`).
`RateLimitAlgorithm` is a two-member enum, `FixedWindow` (`RateLimitAlgorithm.cs:15`) and `SlidingWindow`
(`:22`). `RedisFixedWindowRateLimiter` (`RateLimiting/RedisFixedWindowRateLimiter.cs:37`) is the
distributed counter. Configuration in the consumers: ADC's Notification service declares
`"RateLimiting": { "AnonymousHubPermitLimit": 600 }`
(`MMCA.ADC/Source/Services/MMCA.ADC.Notification.Service/appsettings.json:53-55`) with a nine-line venue-NAT
rationale (`:44-52`), while its host calls the permit-count overload
(`MMCA.ADC.Notification.Service/Program.cs:141`), which never reads `RateLimitingSettings.SectionName`, so
the hub limit in force there is the default 60; no host calls the `IConfiguration` overload. ADC's Identity
host passes one configured value,
`AddCommonRateLimiting(authIpPermitLimit: builder.Configuration.GetValue("RateLimiting:AuthIp:PermitLimit", 30))`
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:161-162`, duplicate-policy note `:153-160`);
Store's takes the framework default
(`MMCA.Store/Source/Services/MMCA.Store.Identity.Service/Program.cs:136`). ADR-029 service:
`ILoginProtectionService` (`Source/Core/MMCA.Common.Application/Auth/ILoginProtectionService.cs:10`),
`LoginProtectionService` (`Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:19`),
`CheckLockoutAsync` (`:50`, `:55-60`), `IncrementFailedAttemptsAsync` (`:64`) with overflow-safe backoff
`Math.Min(1 << Math.Min(excessAttempts, 30), _settings.MaxLockoutSeconds)` (`:88`, `excessAttempts` clamped
at `:82`), the non-atomic read-modify-write documented in place (`:66-74`) with the TTL refreshed on every
write (`:127-129`), `NormalizeIdentity` (`:34-43`), `LockoutKey` (`:45`), `AttemptsKey` (`:47`),
`ResetFailedAttemptsAsync` (`:94`, `:96-97`), `CheckRegistrationRateLimitAsync` (`:101`, `:111-116`),
fail-open no-op on an empty IP (`:103-106`, `:122-125`), `RegistrationKey` (`:136`, read at `:108`),
`IncrementRegistrationCountAsync` (`:120`). Settings defaults: `MaxFailedAttempts = 5`
(`Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionSettings.cs:18`), `MaxLockoutSeconds = 300`
(`:24`), `FailedAttemptWindowMinutes = 30` (`:31`), `MaxRegistrationsPerIpPerHour = 10` (`:37`),
`RegistrationRateLimitWindowMinutes = 60` (`:43`), `SectionName = "LoginProtection"` (`:12`). Registration:
`AddInfrastructure` (`Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:72`) binds
`LoginProtectionSettings` (`:164-166`) and calls
`TryAddScoped<Application.Auth.ILoginProtectionService, Auth.LoginProtectionService>()` (`:168`; the
article's prose condenses the qualified names). Adoption: the protection calls live in
`Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs`: `CheckLockoutAsync` (`:169`),
`IncrementFailedAttemptsAsync` (`:189`, `:196`), `ResetFailedAttemptsAsync` (`:240`),
`CheckRegistrationRateLimitAsync` (`:267`), `IncrementRegistrationCountAsync` (`:326`);
`ResetPasswordHandlerBase`
(`Source/Core/MMCA.Common.Application/Users/UseCases/ResetPassword/ResetPasswordHandlerBase.cs:47`,
`:110`) is the second framework call site, recorded in ADR-029 at
`Website/docs-src/adr/029-authentication-brute-force-protection.md:95-98`; the ADC and Store
`AuthenticationService` are sealed subclasses taking `ILoginProtectionService` (ADC
`MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:50`, forwarded `:60`, with
`IExternalLoginEmailVerifier` at `:51`; Store
`MMCA.Store.Identity.Application/Users/AuthenticationService.cs:26`, forwarded `:35`). Third-control
adoption: ADC re-declares the attribute on both overridden actions
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Controllers/AuthController.cs:54` register,
`:108` login; overrides `:58`, `:112`); Store's `RegisterAsync` override re-declares it at
`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.API/Controllers/AuthController.cs:50` (override
`:54`), with the doc comment at `:41-46` calling it convention parity with MMCA.ADC plus a regression pin.
UI-origin ceiling (ADR-124, `Website/docs-src/adr/124-blazor-circuit-ceiling-ui-edge.md:1-51`, Accepted
2026-09-19, separate-origin statement `:9-15`, Decision `:37-51`): `BoundedCircuitHandler`
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Hardening/BoundedCircuitHandler.cs:37-39`, a
`CircuitHandler` taking `IOptions<BlazorCircuitLimitSettings>` and `ILogger<BoundedCircuitHandler>`) with
`ActiveCircuits` (`:44`), `Order => int.MaxValue` (`:46-50`), `OnCircuitOpenedAsync` (`:53-71`, increment
first and roll back `:57-62`, `Task.FromException(new InvalidOperationException(...))` `:65-67`),
`OnCircuitClosedAsync` flooring at zero (`:74-83`), `LogCircuitRefused` at Warning (`:88-91`), the
why-not-`CircuitOptions` remark (`:13-19`), the why-it-throws remark (`:22-27`) and the singleton remark
(`:30-33`). `BlazorCircuitLimitSettings` (`MMCA.ADC.UI.Web/Hardening/BlazorCircuitLimitSettings.cs:17`):
`SectionName = "BlazorCircuitLimits"` (`:20`), `MaxActiveCircuits = 200` (`:40`, derivation from the
0.25 vCPU / 0.5 GiB container at `:27-35`), and the rate-limiter-bounds-arrival-not-residency remark
(`:10-15`). The Store twin is the same type in
`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Hardening/BoundedCircuitHandler.cs:37-39` with
`MaxActiveCircuits = 200` at `BlazorCircuitLimitSettings.cs:39`; both live in the app repos, not in an
`MMCA.Common` package. ADRs: ADR-019 (`Website/docs-src/adr/019-rate-limiting.md`) is Accepted with
revisions listed in its Status at `:3-20` (2026-08-01 `:4-7`, 2026-08-18 `:7-11`, 2026-09-07 `:12-15`,
2026-09-19 `:16-20`); Decision item 3 is the "per-IP cap on the anonymous authentication endpoints, on by
default" decision (`:59-87`), naming `AuthControllerBase` and `PasswordResetAuthControllerBase` (`:62-65`)
and the apps' `EmailConfirmationController` actions (`:66-69`), with the "settled empirically
(2026-08-13)" inheritance passage at `:69-75`; item 4 scopes the opt-in language to
`FixedPolicy`/`UserPolicy` (`:88-91`). The "Revision (2026-08-18)" section (`:142-199`) covers the settings
section (`:148-156`), the sliding-window option (`:157-164`), the three Redis-capable partitions
(`:165-175`), `auth-ip` staying in memory on purpose (`:177-182`), the distributed limiter's fail-open and
silent-degrade postures (`:184-193`) and the "narrowed rather than removed" statement (`:195-199`); further
revision sections follow at `:201` (2026-09-07) and `:240` (2026-09-10). ADR-029
(`029-authentication-brute-force-protection.md`) Status spans `:3-18` and now includes Revised 2026-09-07
(`:12-13`) and Updated 2026-09-19 (`:14-18`); its Context describes the metered hub exception and the
`auth-ip` window at `:20-29`, the non-atomic and sliding-TTL trade at `:69-85`, the second framework call
site at `:95-98`, the "what the framework still does not do is intercept the HTTP endpoints" residual at
`:138-141`, and Related names ADR-019's hub exception and the password-reset pair at `:184-186`.*

- Full series index: https://ivanball.github.io/writing.html
