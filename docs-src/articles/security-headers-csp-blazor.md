# Security Headers and CSP for Blazor: One Middleware, Every Host

> Series: MMCA.Common · Article #47 (deep-dive) · Pillar P2 · Group G16 · Rubric §26 · ADR-023 ·
> Status: grounded in `Website/docs-src/adr/023-security-response-headers.md`,
> `Website/docs-src/adr/082-two-tier-cors-posture.md`,
> `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs`,
> `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs`,
> `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hosting/BlazorWebHostExtensions.cs`,
> `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs`,
> `Website/docs-src/onboarding/group-16-aspire-orchestration.md`, and the Gateway + UI host
> `Program.cs` files in ADC and Store. No em dashes.

**Subtitle:** Every client-facing host must stamp the same hardened response headers, but a Blazor host
needs a Content-Security-Policy no static string can express. Here is one middleware that centralizes the
headers and resolves the CSP through a pluggable provider, applied at both edges of both apps, formalized
in ADR-023.

---

You add `X-Frame-Options: DENY`, HSTS, and a strict Content-Security-Policy to your Blazor app. You deploy.
The page loads white. The browser console is a wall of red: `Refused to evaluate a string as JavaScript
because 'unsafe-eval' is not an allowed source of script`. Blazor WebAssembly cannot boot, MudBlazor cannot
style a single component, and your "hardening" just took the whole front-end offline.

So you loosen the CSP until the app works again. Then you copy that policy into the second host, and the
gateway, and the next app. Six months later the Gateway sends `frame-ancestors 'none'` and the UI host sends
nothing, because someone edited one copy and forgot the others. A new edge host ships with no headers at all,
because adding them was a manual step nobody remembered. The headers that were supposed to be a baseline
became per-host folklore that drifts.

The two problems are linked. The header set wants to be defined once and inherited everywhere. But the CSP,
the one header that actually breaks the app when it is wrong, cannot be a single constant: an API or gateway
serving JSON and WebSockets wants a strict fixed policy, while a Blazor host needs `script-src
'wasm-unsafe-eval'`, `style-src 'unsafe-inline'`, and a `connect-src` pinned to an API origin it only learns
at runtime. One string cannot serve both, and a wrong string is an outage.

## Why it matters

Security response headers are cheap defence-in-depth: `X-Content-Type-Options: nosniff` stops MIME
sniffing, `X-Frame-Options` and `frame-ancestors` stop clickjacking, HSTS forces HTTPS, and a
Content-Security-Policy shrinks the blast radius of an XSS bug by refusing to load script and connect to
origins you did not allow. None of them cost a request. All of them are worthless if a host forgets to send
them.

The failure mode is silence. A host that stamps no `X-Frame-Options` does not throw, does not log, and passes
every functional test. You find out it was frameable when someone clickjacks it. A CSP that drifted permissive
between two copies protects the strict copy and quietly stops protecting the other. Security headers are
exactly the kind of cross-cutting concern that rots when it lives as copied boilerplate in each host's
`Program.cs`, because the cost of getting one wrong is invisible until it is an incident.

And the CSP raises the stakes further, because it is the one header where the safe direction and the working
direction point opposite ways. Tighten it and you protect the page; tighten it wrong and you blank the page.
That tension is why the framework ships its static baseline at exactly the strength a Blazor page needs and
still resolves the policy through an extension point instead of freezing all of it in one constant.

## The MMCA answer: one middleware, a pluggable CSP

MMCA.Common ships a single `SecurityHeadersMiddleware`
(`MMCA.Common.Aspire/Security/SecurityHeaders.cs:147`) in the `MMCA.Common.Aspire.Security` layer, registered
with `AddCommonSecurityHeaders(configuration?, configure?)` (`SecurityHeaders.cs:268`) and mounted early with
`UseCommonSecurityHeaders()` (`SecurityHeaders.cs:296`). Every response gets the same hardened set, and the
CSP is resolved through an extension point rather than baked in as a constant.

The static part is the easy part. `InvokeAsync` (`SecurityHeaders.cs:185`) stamps
`X-Content-Type-Options: nosniff` (`:190`), `X-Frame-Options` (`:191`, default `DENY`), `Referrer-Policy`
(`:192-194`, default `strict-origin-when-cross-origin`), `Permissions-Policy` (`:195`, default
`geolocation=(), microphone=(), camera=(), payment=()`), and HSTS (`:214-217`, `max-age=31536000;
includeSubDomains`). Every value lives on `SecurityHeadersSettings` (`SecurityHeaders.cs:19`) with those
hardened defaults, overridable via the `"SecurityHeaders"` configuration section (`:22`) or the `configure`
delegate. HSTS is emitted only when `EnableHsts` is set and the environment is not Development: the middleware
computes `_enableHsts = options.Value.EnableHsts && !environment.IsDevelopment()` once in its constructor
(`:175`), so localhost never gets pinned to HTTPS for a year.

Two of those headers are path-sensitive. `CredentialPathPrefixes` (`:48`, default `["/reset-password",
"/auth/oauth-complete"]`) names the paths a single-use secret arrives on, matched segment-based and
case-insensitively by `IsCredentialPath` (`:179-182`). Every non-blank entry must start with `/` (a blank one
is skipped): the property carries
`[LeadingSlashPathPrefixes]` (`:47`) and `AddCommonSecurityHeaders` validates the settings with
`ValidateDataAnnotations().ValidateOnStart()` (`:276-277`), so a malformed prefix fails the boot once instead
of every request. On a hit the response answers `Referrer-Policy: no-referrer` instead of the site-wide value
(`:192-194`) and carries `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` (the constant
`CredentialCacheControl`, `:156`) with `Pragma: no-cache`, written by `ApplyCredentialCacheHeaders`
(`:246-250`). The middleware applies that pair as soon as the path matches and applies it again in a
`Response.OnStarting` callback (`:197-212`, callback `:205-211`), because the Razor Components endpoint writes
its own weaker `Cache-Control` while it renders and the callback is what settles the value last. A reset token
or an OAuth authorization code sitting in the URL therefore never travels onward in a `Referer` header, and the
rendered page never lingers in a browser or proxy cache (ADR-023:138-149, :266-277).

The interesting part is the CSP. Instead of stamping a string, the middleware asks an `ICspPolicyProvider`
(`SecurityHeaders.cs:86`) for a `CspPolicy(string Value, bool Enforce)` (`:78`). When `Enforce` is true it
writes `Content-Security-Policy` (`:235`); when false it writes `Content-Security-Policy-Report-Only`
(`:239`); a `null` return emits no CSP at all (`:219-220`). The enforce-versus-report split is what lets a
host trial a tightened policy against real traffic and collect violations before anything blocks.

One substitution sits between the provider and the header write. A resolved policy carrying the literal token
`{nonce}` (`NoncePlaceholder`, `:150`) gets a fresh 128-bit value per request (`NonceByteCount = 16`, `:153`),
stashed raw in `HttpContext.Items` under `CspNonce.ItemKey` (`:127`) before the rest of the pipeline runs, and
spliced into the header as `'nonce-<value>'` (`:226-231`). A page reads it back with
`CspNonce.Get(HttpContext)` (`:124-139`, `Get` at `:134`) and stamps it onto its own script and style tags,
which is the supported route off `'unsafe-inline'` (documented on the setting, `:64-65`; ADR-023:56-58). A
policy without the token generates nothing and stores nothing.

```csharp
// SecurityHeadersMiddleware.InvokeAsync, condensed from SecurityHeaders.cs:185-244
var headers = context.Response.Headers;
headers.XContentTypeOptions = "nosniff";
headers.XFrameOptions = _settings.FrameOptions;                      // "DENY"
headers["Referrer-Policy"] = IsCredentialPath(context.Request.Path)  // "/reset-password", "/auth/oauth-complete"
    ? "no-referrer"
    : _settings.ReferrerPolicy;                                      // "strict-origin-when-cross-origin"
headers["Permissions-Policy"] = _settings.PermissionsPolicy;

if (IsCredentialPath(context.Request.Path))
{
    ApplyCredentialCacheHeaders(headers);  // "no-store, no-cache, must-revalidate, max-age=0" + Pragma: no-cache

    // Re-applied at response start, so it settles last over the Razor Components endpoint's weaker value.
    context.Response.OnStarting(
        static state =>
        {
            ApplyCredentialCacheHeaders(((HttpContext)state).Response.Headers);
            return Task.CompletedTask;
        },
        context);
}

if (_enableHsts)                                                     // EnableHsts && !IsDevelopment()
{
    headers.StrictTransportSecurity = _settings.HstsValue;           // "max-age=31536000; includeSubDomains"
}

var csp = _cspPolicyProvider.GetPolicy(context);                     // the extension point
if (csp is not null)
{
    var value = csp.Value;
    if (value.Contains(NoncePlaceholder, StringComparison.Ordinal))  // the literal {nonce} token
    {
        var nonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(NonceByteCount));
        context.Items[CspNonce.ItemKey] = nonce;
        value = value.Replace(NoncePlaceholder, $"'nonce-{nonce}'", StringComparison.Ordinal);
    }

    if (csp.Enforce) headers.ContentSecurityPolicy = value;
    else             headers.ContentSecurityPolicyReportOnly = value;
}

return _next(context);
```

The default provider is `StaticCspPolicyProvider` (`SecurityHeaders.cs:93`), registered with
`TryAddSingleton` (`:288`) so a host can override it. It computes its policy once in the constructor
(`:97-104`) and returns the cached value for every request (`:106`). The baseline itself lives on
`SecurityHeadersSettings.ContentSecurityPolicy` (`:67-69`): `default-src 'self'; script-src 'self'
'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'none'`. Nothing is left out, including the two directives that blank a Blazor page when they
are wrong: the XML doc on the setting calls it a complete hardened baseline that ships `script-src` and
`style-src` at exactly the strength Blazor (`'wasm-unsafe-eval'`) and MudBlazor (`'unsafe-inline'` styles)
require (`:53-66`). An HTML host that never registers its own provider gets a functional policy instead of
one silently missing both directives, and the JSON, WebSocket, and static-page responses an API or gateway
serves are unaffected either way (ADR-023:59-66).

## The Blazor policy, built at runtime

An HTML host opts into the origin-pinned policy by registering its own provider. Both apps get one shared
`BlazorCspPolicyProvider` (`MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:28`) from the framework's
composed Blazor host: `AddMmcaBlazorWebHost` calls `AddCommonBlazorCsp()`
(`MMCA.Common.UI.Web/Hosting/BlazorWebHostExtensions.cs:157`) immediately before
`AddCommonSecurityHeaders(configuration)` (`:158`). `AddCommonBlazorCsp()`
(`MMCA.Common.UI.Web/DependencyInjection.cs:67`) does three things: binds `BlazorCspSettings` from the
`"BlazorCsp"` configuration section with `ValidateOnStart()` (`:69-71`), registers
`BlazorCspSettingsValidator` through `TryAddEnumerable` so calling it twice validates once (`:74-75`), and
registers `AddSingleton<ICspPolicyProvider, BlazorCspPolicyProvider>` (`:77`). Only the static default uses
`TryAddSingleton` (`SecurityHeaders.cs:288`), so a provider registered first suppresses it, and because a
single-service resolve returns the last registration, a plain `AddSingleton` provider registered afterwards
still wins. Calling `AddCommonBlazorCsp()` before `AddCommonSecurityHeaders(...)` is the documented
convention (`SecurityHeaders.cs:265-266` and the interface summary at `:83-84`, `DependencyInjection.cs:56-58`;
ADR-023:114-123), and the composed call fixes that order for every head that uses it, but the order is not
the thing that makes the Blazor provider win.

The provider builds the full policy once, at construction (`BlazorCspPolicyProvider.cs:33-42`), and returns
the cached result for every request (`:45`). `BuildPolicy` (`:100-110`) assembles what a Blazor + MudBlazor
page actually needs: `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'` (the WASM runtime),
`style-src 'self' 'unsafe-inline'` (MudBlazor), `img-src 'self' data: https:` (profile pictures and CDN
images are low XSS-risk, so images stay open while the directives that matter for exfiltration stay locked,
`:96-99`), `font-src 'self'`, plus `base-uri`, `form-action`, and `frame-ancestors 'none'`. The list carries
no `object-src`, so objects fall back to `default-src 'self'` rather than the static baseline's explicit
`object-src 'none'` (ADR-023:197-201): on that one directive the Blazor policy is looser than the default it
replaces.

One directive in that list is opt-in. `BuildFrameSrc` (`:82-94`) emits `frame-src 'self' <origins>` only when
`BlazorCspSettings.FrameSources` lists at least one origin, canonicalized and de-duplicated before the splice
(`:89-91`, joined at `:93` and spliced into the policy at `:107`); with the default empty list it returns
`null` (`:84-87`), there is no `frame-src` at all, and frames fall back to `default-src 'self'` (class doc
`:21-23`). Entries are validated at boot rather than trusted, so a wildcard or a stray semicolon fails startup
with a message naming it instead of landing verbatim in a security response header (ADR-023:209-221). ADC's
Blazor host configures it for the embedded Google Maps venue maps on its public event page
(`MMCA.ADC.UI.Web/appsettings.json:96-102`, comment `:92-95`). `frame-ancestors 'none'` is never relaxed by
that path (`:21-24`).

The hard directive is `connect-src`, because it is per-deployment. `BuildCsp` (`:49`) reads the API origin
from `ApiSettings` (`WasmApiEndpoint ?? ApiEndpoint`, `:51`), and if the shared
`ApiEndpointUrl.TryParseAbsoluteHttp` test accepts it as an absolute http(s) URL (`:55`;
`MMCA.Common.UI.Web/Security/ApiEndpointUrl.cs:22-26`) it pins `connect-src` to `'self'` plus that origin and
its WebSocket form (`wss://...` for an https API, `ws://...` otherwise, for the SignalR notification hub,
`:63-65`), enforced (`:76`). Development
loosens two directives, not one: `connect-src` gains `http://localhost:*` and `ws://localhost:*` (`:71-74`),
and `script-src` gains `'unsafe-inline'` (`:102`), because Visual Studio's Browser Link and Hot Reload inject
an inline bootstrap script as well as opening a WebSocket on a port that changes every run (`:67-70`). Only
the first of those is localhost-scoped, and neither reaches a non-Development host, because the flag is
`IWebHostEnvironment.IsDevelopment()` read once at construction (`:41`; ADR-023:202-208).

The detail worth stealing is the failure path. If the origin cannot be parsed, or on Linux parses as a
`file://` URI instead of http(s) (`ApiEndpointUrl.cs:17`), the provider does not guess and it does not stop
enforcing. It narrows `connect-src` to `'self'`, the strictest value it can be sure of, leaves the rest of the
policy exactly as it was, and returns it with `Enforce: true` (`BlazorCspPolicyProvider.cs:59`). The policy
fails closed. The composed host catches the grossest form of the mistake before the provider ever runs:
`AddMmcaBlazorWebHost` refuses to boot when `Api:ApiEndpoint` is blank or is neither an absolute http(s) URL
nor an Aspire service-discovery name (`BlazorWebHostExtensions.cs:114-121`). What reaches the fail-closed
path is the misconfiguration that check cannot see: a `WasmApiEndpoint` that is not absolute http(s), or no
`WasmApiEndpoint` over a service-discovery `ApiEndpoint` such as `https+http://gateway`, whose compound scheme
the http(s) test rejects (`ApiEndpointUrl.cs:63-65`). That deployment still serves its pages, and every API
call and SignalR hub connection the browser makes to the gateway directly is blocked loudly in the browser
console, because the alternative is a permissive Report-Only header that protects nothing and that nobody
notices (`BlazorCspPolicyProvider.cs:16-20`, `:57-58`; ADR-023:102-105). A security response header that
quietly stops being enforced is the worse failure mode.

Both apps also run the same-origin API proxy (ADR-131), and neither has to ask for it: `AddMmcaBlazorWebHost`
registers it with `AddCommonSameOriginApiProxy` (`BlazorWebHostExtensions.cs:142`) and
`UseMmcaBlazorWebPipeline` maps it with `MapCommonSameOriginApiProxy` (`:210`), with no switch between them.
With it, `/client-config` adds `sameOriginApiEndpoint`, which switches the WebAssembly client's API client
and notification hub to the proxy on the UI host's own origin
(`MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:24-25`, served whenever the
proxy is registered, `MMCA.Common.UI.Web/ClientConfig/ClientConfigEndpointExtensions.cs:139-145`), so the
browser's API and hub traffic is same-origin and admitted by the `'self'` entry that leads every
`connect-src` the provider builds (`BlazorCspPolicyProvider.cs:59`, `:65`). The provider does not read the
proxy settings: it pins the configured gateway origin either way (`:51`, `:63-65`). In a proxied host the
fail-closed narrowing therefore leaves the proxied API and hub calls working, because `'self'` still covers
them.

`font-src 'self'` (`:105`) reads like the boring entry in that list, and it is the one that carries a real web
font. The shared MudBlazor theme names Inter first in its font stack, and the reflex way to supply it is a
Google Fonts link tag, with the reflex follow-on of widening `font-src` to that CDN's origin plus a
`style-src` allowance for its stylesheet: a third-party origin welded into the policy of every host,
permanently, because of a typography change. Instead the font ships from the framework. `MMCA.Common.UI`
vendors the Inter woff2 files (weights 400, 500, 600, 700, 800, latin subset, SIL OFL 1.1 notice alongside
them) under its own `wwwroot/fonts/`, and its `app.css` declares the five faces with `font-display: swap`
(`MMCA.Common.UI/wwwroot/app.css:9-47`).
Because a Razor class library's static assets are served from `_content/MMCA.Common.UI/`, the fonts are
same-origin, the existing `font-src 'self'` already permits them, and not one character of the CSP changed to
land the refresh.

That is the part worth generalizing. A CSP directive is only a real constraint if it is allowed to shape
decisions, because the moment a design choice arrives the path of least resistance is to widen the policy to
fit it. Here the policy shaped the implementation instead. The honest costs: the vendored subset is latin
only, so non-latin text still falls back to the platform font; the woff2 bytes ride inside the NuGet package,
so updating the font means a framework release and a lockstep consumer bump rather than swapping a CDN
version; and self-hosting forfeits any shared cross-site CDN cache, so each origin downloads its own copy.
`font-display: swap` trades a visible flash of the fallback face for not blocking first paint. All of that was
cheaper than an extra origin in the policy.

## Adopted at both edges of both apps

This is not a library that exists and waits to be used. Store and ADC each wire it at both client-facing
edges. The Gateway hosts call `AddCommonSecurityHeaders(builder.Configuration)` and `UseCommonSecurityHeaders()`
with the strict static baseline, exactly right for a YARP proxy: ADC's Gateway serves JSON, the SignalR hub's
WebSockets, and three anonymous static pages, the privacy policy, the terms of use, and the account-deletion
page its Google Play listing requires (`Program.cs:135,193`, static files `:208`, `/privacy` `:215`, `/terms`
`:222`, `/delete-account` `:226`), and Store's serves only JSON and forwarded responses, with no static-file
or privacy page by design (`Program.cs:81,179`, `:18-20`).

The Blazor UI hosts wire none of it by hand. Each `Program.cs` makes two framework calls,
`AddMmcaBlazorWebHost` (ADC UI `Program.cs:26`; Store UI `Program.cs:30`) and `UseMmcaBlazorWebPipeline`
(ADC UI `:128` on the net11.0 line and `:130` on the net10.0 line; Store UI `:92`), and the composed host
does the rest: `AddCommonBlazorCsp()`, then the same plain `AddCommonSecurityHeaders(configuration)` with no
configure delegate (`MMCA.Common.UI.Web/Hosting/BlazorWebHostExtensions.cs:157-158`), and
`UseCommonSecurityHeaders()` directly after the forwarded headers, ahead of the rest of the pipeline
(`:185-186`). Each UI origin emits its own HSTS on purpose, because an HSTS pin is per-origin and the
Gateway's header says nothing about the sibling hostname a user actually types (ADC UI `Program.cs:80-82`):
`EnableHsts` defaults to true (`SecurityHeaders.cs:34`) and neither UI host's `appsettings` sets a
`SecurityHeaders` section. The built-in `app.UseHsts()` is not part of the composed pipeline
(`BlazorWebHostExtensions.cs:181-216`), since it would run later and overwrite the shared one-year value with
its own weaker default (ADC UI `Program.cs:108-111`).

One more line in each UI host keeps every response to exactly one policy. The interactive server render mode
adds its own `frame-ancestors 'self'` Content-Security-Policy header to component responses by default; both
hosts set `ContentSecurityFrameAncestorsPolicy = null`, so the provider's policy, which already sends
`frame-ancestors 'none'`, is the only CSP that ships (ADC UI `Program.cs:156-163`; Store UI
`Program.cs:116-122`).

The cross-origin posture at that same edge is a separate decision with its own record: two policies, an
allow-listed one for service hosts and a deliberately broader one for gateways (ADR-082,
`Website/docs-src/adr/082-two-tier-cors-posture.md:31-33`), which names ADR-023 as its edge sibling (`:27-28`).
The middleware carries a unit test, `SecurityHeadersMiddlewareTests` in `MMCA.Common.Aspire.Tests`, and all
four edges carry their own `SecurityHeadersTests`: each app's Gateway, and each app's UI host, where a
Production-pinned host factory is what lets the test see the per-origin HSTS described above (ADR-023:163-180).

## Trade-offs, honestly

- **The baseline is complete, not maximal.** A default that works for a Blazor and MudBlazor host is a default
  that carries `style-src 'unsafe-inline'` (`SecurityHeaders.cs:67-69`), so inline styles are not blocked out
  of the box, and an API or gateway host that serves no HTML inherits a script and style allowance it does not
  need. Tightening past that is an explicit act: configure the `"SecurityHeaders"` section, register your own
  provider, or move to the `{nonce}` placeholder (ADR-023:108-113).
- **Registration order matters only for `TryAdd`.** The static default uses `TryAddSingleton`
  (`SecurityHeaders.cs:288`) and `AddCommonBlazorCsp` uses plain `AddSingleton` (`DependencyInjection.cs:77`),
  so the Blazor provider wins in either order. The trap is narrower: a custom provider added after
  `AddCommonSecurityHeaders` with `TryAdd` silently keeps the static default (ADR-023:114-123). Both UI heads
  get the documented order from the composed call (`BlazorWebHostExtensions.cs:156-158`); a host that wires
  the headers itself, such as either Gateway or a custom host, keeps it by hand.
- **Failing closed moves the pain onto a running app.** A Blazor host whose browser-facing API endpoint
  passes the boot check but is not an absolute http(s) URL still serves pages, but the enforced
  `connect-src 'self'` blocks every cross-origin API call and SignalR connection a client makes to the gateway
  directly (`BlazorCspPolicyProvider.cs:59`). That loud signal is the point, and the cost is that the
  configuration mistake lands on the users of that deployment rather than in a passive report
  (ADR-023:129-133).
- **One shared Blazor provider constrains divergence.** `BlazorCspPolicyProvider` lives once in
  `MMCA.Common.UI.Web` over the shared `ApiSettings`, so a host that needs genuinely different CSP logic
  cannot tweak an app-local copy. It has to supply its own `ICspPolicyProvider` instead, and on the composed
  host that means a plain `AddSingleton` after `AddMmcaBlazorWebHost` returns: the composed call runs
  `AddCommonBlazorCsp`'s own plain `AddSingleton` (`BlazorWebHostExtensions.cs:157`,
  `DependencyInjection.cs:77`), so a provider registered earlier, for example in the `AfterServiceDefaults`
  callback (`BlazorWebHostExtensions.cs:86`), is not the last registration and loses to the Blazor one.

None of these argue against centralizing the headers. They argue for keeping the extension point visible and
for treating the CSP as the one header you test in every host that renders HTML.

## Apply this even without MMCA

The shape ports to any ASP.NET Core stack, and the idea ports to any web framework:

1. Put the hardened header set in **one middleware** with strongly-typed, overridable settings, and mount it
   early so every response gets it. A new edge host inherits the baseline instead of remembering to copy it.
2. Do not stamp the CSP as a constant. Resolve it through a **provider abstraction** that returns the policy
   string plus an enforce-or-report flag. Static hosts get a fixed strict policy; HTML hosts inject a dynamic
   one.
3. For a Blazor or SPA host, build `connect-src` from the **API origin at runtime**, and put the
   `script-src`/`style-src` sources the framework actually requires (`'wasm-unsafe-eval'` for Blazor WASM) in
   the **static default too**, so a host that registers nothing still gets a policy it can run under.
4. Make the failure path **fail closed, not permissive**. If the dynamic part of the policy cannot be built,
   narrow that one directive to the strictest value you can be sure of and keep enforcing, so the mistake
   surfaces as blocked calls somebody chases instead of a header that is emitted and inert.

The takeaway: **security headers want to be defined once and inherited everywhere, but the CSP is the one
header that breaks the app when it is wrong. Centralize the headers in a middleware, resolve the CSP through a
provider, and when the dynamic part cannot be built, narrow that directive and keep enforcing rather than
emitting a policy that protects nothing.**

---

**What we covered:** why per-host security headers drift and why a static CSP cannot serve both an API and a
Blazor host, how MMCA.Common's `SecurityHeadersMiddleware` stamps one hardened header set (with a stricter
referrer and cache posture on credential paths, and a per-request `{nonce}` substitution) while resolving the
CSP through a pluggable `ICspPolicyProvider`, how the default static provider ships a complete hardened
baseline a Blazor page can still run under, how `BlazorCspPolicyProvider` pins `connect-src` to the runtime API
origin and fails closed when it cannot, and how both apps adopt it at their Gateway edges and, through the
composed Blazor host, at their UI edges (ADR-023).

**Next in the series:** Article 48, "Observability by Default: OpenTelemetry and Azure Monitor in MMCA," on the
tracing, metrics, and logging pipeline every host gets for free.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-023 behind this
pattern, or `dotnet add package MMCA.Common.Aspire` and try the middleware.*
- Repo: `https://github.com/ivanball/MMCA.Common`
- This pattern's decision record: `Website/docs-src/adr/023-security-response-headers.md`
- The full 34-category scorecard, §26 included, lives in `Website/docs-src/governance/common-ArchitectureScorecard.md` in the docs site.

*Previous: Article 46, "Field-Level Encryption in EF Core: AES-GCM for PII Columns." Next: Article 48,
"Observability by Default: OpenTelemetry and Azure Monitor in MMCA."*

*Tags: .NET, C Sharp, Blazor, Web Security, Content Security Policy*

*Notes: verified type/behavior names with path:line (re-verified 2026-11-25 against MMCA.Common v1.319.0):*
- *`SecurityHeadersMiddleware` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs:147`); `InvokeAsync` (`:185`, spanning `:185-244`): `X-Content-Type-Options: nosniff` (`:190`), `X-Frame-Options` (`:191`), `Referrer-Policy` ternary on `IsCredentialPath` (`:192-194`), `Permissions-Policy` (`:195`), credential-path branch (`:197-212`) calling `ApplyCredentialCacheHeaders` (`:199`, defined `:246-250`, constant `CredentialCacheControl` at `:156`) and re-applying it in a `Response.OnStarting` callback (`:205-211`), HSTS (`:214-217`), CSP null guard (`:219-220`), `{nonce}` substitution (`:226-231`), `ContentSecurityPolicy` (`:235`) or `ContentSecurityPolicyReportOnly` (`:239`); `_enableHsts` in ctor (`:175`); `IsCredentialPath` (`:179-182`); `NoncePlaceholder` (`:150`), `NonceByteCount = 16` (`:153`). `CspNonce` (`:124-139`, `ItemKey` `:127`, `Get` `:134`). `SecurityHeadersSettings` (`:19`), `EnableHsts = true` (`:34`), baseline `:67-69` (doc `:53-66`). `CspPolicy` (`:78`), `ICspPolicyProvider` (`:86`, register-first summary `:83-84`), `StaticCspPolicyProvider` (`:93`). `AddCommonSecurityHeaders` (`:268`, register-first doc `:265-266`, `ValidateOnStart` `:277`), `TryAddSingleton<ICspPolicyProvider, StaticCspPolicyProvider>` (`:288`), `UseCommonSecurityHeaders` (`:296`). Every line listed was re-confirmed this run by a single Grep of the file; the lines not in that Grep (`:22`, `:47-48`, `:51`, `:64-65`, `:97-106`, `:276`, `:299`) are carried from the prior pass, consistent with every grepped anchor sitting where it was.*
- *`BlazorCspPolicyProvider` (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs`, read in full this run): class `:28`, class doc fail-closed `:16-20`, frame-src fallback `:21-23`, frame-ancestors never relaxed `:23-24`; ctor `:33-42` (`IsDevelopment()` `:41`); cached `GetPolicy` `:45`; `BuildCsp` `:49`, `WasmApiEndpoint ?? ApiEndpoint` `:51`, `ApiEndpointUrl.TryParseAbsoluteHttp` test `:55`, fail-closed rationale `:57-58` and return `connect-src 'self'` with `Enforce: true` `:59`; origin `:63`, ws scheme `:64`, `connect-src 'self' {origin} {ws}://{authority}` `:65`; Browser Link/Hot Reload comment `:67-70`, Development localhost block `:71-74` (append `:73`); enforced return `:76`; `BuildFrameSrc` `:82-94` (empty-list `null` `:84-87`, `Select(ToOrigin).Distinct` `:89-91`, join `:93`); img-src rationale `:96-99`; `BuildPolicy` `:100-110` (`script-src` with Development `'unsafe-inline'` `:102`, `font-src 'self'` `:105`, `connect-src` `:106`, optional `frame-src` `:107`, `base-uri`/`form-action`/`frame-ancestors 'none'` `:108-110`).*
- *`ApiEndpointUrl` (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/ApiEndpointUrl.cs`, Grep this run): `file://` remark `:17`, `TryParseAbsoluteHttp` `:22-26` (absolute URI and http(s) scheme), `IsAbsoluteHttpOrServiceDiscovery` `:50` (compound `+` scheme `:58-60`), `IsHttpScheme` `:63-65`, so a `https+http://gateway` value passes the boot check but not the CSP's http(s) test.*
- *`AddCommonBlazorCsp()` (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:67`, read `:50-81`): `ValidateOnStart` `:69-71`, `TryAddEnumerable` `:74-75`, plain `AddSingleton<ICspPolicyProvider, BlazorCspPolicyProvider>` `:77`, register-first doc `:56-58`.*
- *Composed Blazor host (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hosting/BlazorWebHostExtensions.cs`, read `:60-224`): `AddMmcaBlazorWebHost` `:75`, `AfterServiceDefaults` callback `:86`, `Api:ApiEndpoint` boot check `:114-121`, `AddCommonSameOriginApiProxy` `:142` (unconditional), comment `:156`, `AddCommonBlazorCsp()` `:157`, `AddCommonSecurityHeaders(configuration)` `:158`; `UseMmcaBlazorWebPipeline` `:181-216` with `UseCommonUiForwardedHeaders` `:185`, `UseCommonSecurityHeaders` `:186`, `MapCommonSameOriginApiProxy` `:210`, and no `UseHsts` call. `/client-config` adds `SameOriginApiEndpoint` when the proxy marker is registered (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/ClientConfig/ClientConfigEndpointExtensions.cs:139-145`); the proxy doc's `/client-config` switch sentence is `SameOriginApiProxyServiceExtensions.cs:24-25` (read `:1-40`).*
- *UI hosts (read in full): ADC UI `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs` (179 lines) calls `AddMmcaBlazorWebHost` `:26` and `UseMmcaBlazorWebPipeline` `:128` (`#if NET11_0_OR_GREATER`) / `:130` (`#else`), HSTS-at-the-UI-origin rationale `:80-82`, no-`UseHsts` note `:108-111`, single-CSP `ContentSecurityFrameAncestorsPolicy = null` `:156-163`; Store UI `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs` (127 lines) calls `AddMmcaBlazorWebHost` `:30` and `UseMmcaBlazorWebPipeline` `:92`, single-CSP `:116-122`, and carries no HSTS or `UseHsts` comment. Neither UI host calls `AddCommonBlazorCsp`, `AddCommonSecurityHeaders`, `UseCommonSecurityHeaders` or the proxy methods directly. Neither UI host's `appsettings*.json` has a `"SecurityHeaders"` key (Grep, 0 hits each). ADC UI `appsettings.json` `BlazorCsp` `:96-102` (origins `:98-100`, comment `:92-95`; `SameOriginApiProxy` comment `:77-85`, block `:86-91`).*
- *Gateways (Grep this run): ADC `MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs` `AddCommonSecurityHeaders` `:135`, `UseCommonSecurityHeaders` `:193`, `UseStaticFiles` `:208`, `/privacy` `:215`, Google Play deletion comment `:221`, `/terms` `:222`, `/delete-account` `:226`; Store `MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs` `:81`, `:179`, no static-file or `/privacy` page `:18-20`. The ADC Gateway's `/hubs` route and both Gateways' lack of a `SecurityHeaders` section are carried from the prior pass, not re-read.*
- *ADR-023 (`Website/docs-src/adr/023-security-response-headers.md`, Grep this run): every prose anchor shifted +6 after the 2026-11-23 status lines (`:27`): nonce `:56-58`, complete baseline `:59-66`, fail-closed rationale `:102-105`, not-maximal `:108-113`, registration order matters only for `TryAdd` `:114-123`, fail-closed trade-off `:129-133`, credential-path item `:138-149`, UI-host `SecurityHeadersTests` `:163-180` (Production-pinned `:169-171`), no `object-src` `:197-201`, Development loosening `:202-208`, opt-in `frame-src` `:209-221`, `OnStarting` re-apply `:266-277`, Revision (2026-11-23) `:372`. ADR-082 (`Website/docs-src/adr/082-two-tier-cors-posture.md`): revised through 2026-11-23 (`:4`), ADR-023 named as an edge sibling `:27-28`, Decision `:31`.*
- *Carried from earlier passes, not re-read this run: the five test files (`SecurityHeadersMiddlewareTests` in `MMCA.Common/Tests/Hosting/MMCA.Common.Aspire.Tests/Security/`, and `SecurityHeadersTests` under each app's `Tests/Hosts/` Gateway and UI.Web test projects) and `MMCA.Common.UI/wwwroot/app.css:9-47`. Anchor facts cited, not recounted: v1.319.0 (`MMCA.Common/FACTS.md:14`), 30 published packages (`FACTS.md:20`), 147 ADRs, 001-147 (`Website/docs-src/adr/README.md:6`), the 34-category rubric (`Website/docs-src/governance/README.md:3`).*
- *The code block is condensed from `SecurityHeaders.cs:185-244` (comments added, header names, defaults and branch order faithful to source, not byte-for-byte; the argument guard, in-source comments and the braced CSP `if`/`else` are folded, and the block ends as source does with `return _next(context);`).*
- *2026-11-25 refresh (structural): the UI hosts wire nothing by hand; `AddMmcaBlazorWebHost` / `UseMmcaBlazorWebPipeline` register and mount the Blazor CSP, the security headers and the same-origin proxy (`BlazorWebHostExtensions.cs:142,157-158,185-186,210`; ADR-023 Revision 2026-11-23). Rewritten: the registration paragraph of the Blazor policy section, the same-origin proxy paragraph (it is not a per-app opt-in), the UI half of the adoption section (with the per-origin HSTS evidence moved to `SecurityHeaders.cs:34` plus ADC UI `:80-82` and the `UseHsts` absence to the composed pipeline), the order trade-off (the composed call fixes the order for both UI heads), and the custom-provider trade-off (on the composed host a custom provider must be a plain `AddSingleton` after `AddMmcaBlazorWebHost`, inferred from `:86`, `:157` and last-registration-wins DI; ADR-023:124-128 still advises registering before `AddCommonSecurityHeaders`). Narrowed: the fail-closed narrative, because the boot check `:114-121` stops a blank or placeholder `Api:ApiEndpoint`, so only a bad `WasmApiEndpoint` or a service-discovery `ApiEndpoint` with no `WasmApiEndpoint` reaches the CSP fallback. Added: the one-CSP-per-response `ContentSecurityFrameAncestorsPolicy = null` line in both UI hosts. Re-anchored: `BlazorCspPolicyProvider.cs` -3 from `:55`, ADC UI `appsettings.json` `BlazorCsp` to `:96-102`, ADC Gateway to `:135,193`, Store Gateway to `:81,179`, ADR-023 +6, ADR-082 edge-sibling to `:27-28`. Earlier refreshes (2026-09-19 to 2026-10-29) are in the file's git history.*
- *Flag (2026-11-25): ADR-023's 2026-11-23 revision cites Gateway `UseCommonSecurityHeaders` anchors that disagree with source (ADC `:188` vs actual `:193`, Store `:175` vs actual `:179`), and ADR-023:124-128 keeps the "register before `AddCommonSecurityHeaders`" custom-provider advice that does not hold for a head on `AddMmcaBlazorWebHost`. ADR drift outside this article; this article cites source, not those ADR lines.*
- *Verifier fixes (2026-11-25): the WebSocket origin is `wss` only when the API scheme is https, else `ws` (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:64`); a blank `CredentialPathPrefixes` entry is skipped, not rejected, so only non-blank entries must start with `/` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/LeadingSlashPathPrefixesAttribute.cs:25`).*

- Full series index: https://ivanball.github.io/writing.html
