# Security Headers and CSP for Blazor: One Middleware, Every Host

> Series: MMCA.Common · Article #47 (deep-dive) · Pillar P2 · Group G16 · Rubric §26 · ADR-023 ·
> Status: grounded in `Website/docs-src/adr/023-security-response-headers.md`,
> `Website/docs-src/adr/082-two-tier-cors-posture.md`,
> `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs`,
> `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs`,
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
(`MMCA.Common.Aspire/Security/SecurityHeaders.cs:145`) in the `MMCA.Common.Aspire.Security` layer, registered
with `AddCommonSecurityHeaders(configuration?, configure?)` (`SecurityHeaders.cs:246`) and mounted early with
`UseCommonSecurityHeaders()` (`SecurityHeaders.cs:271`). Every response gets the same hardened set, and the
CSP is resolved through an extension point rather than baked in as a constant.

The static part is the easy part. `InvokeAsync` (`SecurityHeaders.cs:180`) stamps
`X-Content-Type-Options: nosniff` (`:185`), `X-Frame-Options` (`:186`, default `DENY`), `Referrer-Policy`
(`:187-189`, default `strict-origin-when-cross-origin`), `Permissions-Policy` (`:190`, default
`geolocation=(), microphone=(), camera=(), payment=()`), and HSTS (`:198-200`, `max-age=31536000;
includeSubDomains`). Every value lives on `SecurityHeadersSettings` (`SecurityHeaders.cs:19`) with those
hardened defaults, overridable via the `"SecurityHeaders"` configuration section (`:22`) or the `configure`
delegate. HSTS is emitted only when `EnableHsts` is set and the environment is not Development: the middleware
computes `_enableHsts = options.Value.EnableHsts && !environment.IsDevelopment()` once in its constructor
(`:170`), so localhost never gets pinned to HTTPS for a year.

Two of those headers are path-sensitive. `CredentialPathPrefixes` (`:46`, default `["/reset-password",
"/auth/oauth-complete"]`) names the paths a single-use secret arrives on, matched segment-based and
case-insensitively by `IsCredentialPath` (`:174-177`). On a hit the response answers `Referrer-Policy:
no-referrer` instead of the site-wide value (`:187-189`) and adds `Cache-Control: no-store, no-cache,
must-revalidate, max-age=0` with `Pragma: no-cache` (`:192-196`), so a reset token or an OAuth authorization
code sitting in the URL never travels onward in a `Referer` header and the rendered page never lingers in a
browser or proxy cache (ADR-023:114-125).

The interesting part is the CSP. Instead of stamping a string, the middleware asks an `ICspPolicyProvider`
(`SecurityHeaders.cs:84`) for a `CspPolicy(string Value, bool Enforce)` (`:76`). When `Enforce` is true it
writes `Content-Security-Policy` (`:219`); when false it writes `Content-Security-Policy-Report-Only`
(`:223`); a `null` return emits no CSP at all (`:203-204`). The enforce-versus-report split is what lets a
host trial a tightened policy against real traffic and collect violations before anything blocks.

One substitution sits between the provider and the header write. A resolved policy carrying the literal token
`{nonce}` (`NoncePlaceholder`, `:148`) gets a fresh 128-bit value per request (`NonceByteCount = 16`, `:151`),
stashed raw in `HttpContext.Items` under `CspNonce.ItemKey` (`:125`) before the rest of the pipeline runs, and
spliced into the header as `'nonce-<value>'` (`:210-215`). A page reads it back with
`CspNonce.Get(HttpContext)` (`:122-137`) and stamps it onto its own script and style tags, which is the
supported route off `'unsafe-inline'` (documented on the setting, `:62-63`; ADR-023:42-45). A policy without
the token generates nothing and stores nothing.

```csharp
// SecurityHeadersMiddleware.InvokeAsync, condensed from SecurityHeaders.cs:180-228
var headers = context.Response.Headers;
headers.XContentTypeOptions = "nosniff";
headers.XFrameOptions = _settings.FrameOptions;                      // "DENY"
headers["Referrer-Policy"] = IsCredentialPath(context.Request.Path)  // "/reset-password", "/auth/oauth-complete"
    ? "no-referrer"
    : _settings.ReferrerPolicy;                                      // "strict-origin-when-cross-origin"
headers["Permissions-Policy"] = _settings.PermissionsPolicy;

if (IsCredentialPath(context.Request.Path))
{
    headers.CacheControl = "no-store, no-cache, must-revalidate, max-age=0";
    headers.Pragma = "no-cache";
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

await _next(context).ConfigureAwait(false);
```

The default provider is `StaticCspPolicyProvider` (`SecurityHeaders.cs:91`), registered with
`TryAddSingleton` (`:263`) so a host can override it. It computes its policy once in the constructor
(`:95-102`) and returns the cached value for every request (`:104`). The baseline itself lives on
`SecurityHeadersSettings.ContentSecurityPolicy` (`:65-67`): `default-src 'self'; script-src 'self'
'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'none'`. Nothing is left out, including the two directives that blank a Blazor page when they
are wrong: the XML doc on the setting calls it a complete hardened baseline that ships `script-src` and
`style-src` at exactly the strength Blazor (`'wasm-unsafe-eval'`) and MudBlazor (`'unsafe-inline'` styles)
require (`:51-64`). An HTML host that never registers a fuller provider gets a functional policy instead of
one silently missing both directives, and the JSON, WebSocket, and static-page responses an API or gateway
serves are unaffected either way (ADR-023:46-53).

## The Blazor policy, built at runtime

An HTML host opts into the origin-pinned policy by registering its own provider before calling
`AddCommonSecurityHeaders`. Both apps register one shared `BlazorCspPolicyProvider`
(`MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:28`) via `AddCommonBlazorCsp()`
(`MMCA.Common.UI.Web/DependencyInjection.cs:52`), which does three things: binds `BlazorCspSettings` from the
`"BlazorCsp"` configuration section with `ValidateOnStart()` (`:54-56`), registers
`BlazorCspSettingsValidator` through `TryAddEnumerable` so calling it twice validates once (`:59-60`), and
registers `AddSingleton<ICspPolicyProvider, BlazorCspPolicyProvider>` (`:62`). Because the static default is
registered with `TryAdd`, the first-registered provider wins, so the call order is load-bearing:
`AddCommonBlazorCsp()` must run before `AddCommonSecurityHeaders(...)`.

The provider builds the full policy once, at construction (`BlazorCspPolicyProvider.cs:33-42`), and returns
the cached result for every request (`:45`). `BuildPolicy` (`:103-113`) assembles what a Blazor + MudBlazor
page actually needs: `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'` (the WASM runtime),
`style-src 'self' 'unsafe-inline'` (MudBlazor), `img-src 'self' data: https:` (profile pictures and CDN
images are low XSS-risk, so images stay open while the directives that matter for exfiltration stay locked),
`font-src 'self'`, plus `base-uri`, `form-action`, and `frame-ancestors 'none'`.

One directive in that list is opt-in. `BuildFrameSrc` (`:85-97`) emits `frame-src 'self' <origins>` only when
`BlazorCspSettings.FrameSources` lists at least one origin, canonicalized and de-duplicated before the splice
(`:92-96`, spliced into the policy at `:110`); with the default empty list there is no `frame-src` at all and
frames fall back to `default-src 'self'` (`:82`). Entries are validated at boot rather than trusted, so a
wildcard or a stray semicolon fails startup with a message naming it instead of landing verbatim in a security
response header (ADR-023:185-197). ADC's Blazor host configures it for the embedded Google Maps venue maps on
its public event page (`MMCA.ADC.UI.Web/appsettings.json:47-52`). `frame-ancestors 'none'` is never relaxed by
that path (`:21-24`).

The hard directive is `connect-src`, because it is per-deployment. `BuildCsp` (`:49`) reads the API origin
from `ApiSettings` (`WasmApiEndpoint ?? ApiEndpoint`, `:51`), and if it resolves to a real http(s) URL it pins
`connect-src` to `'self'` plus that origin and its WebSocket form (`wss://...` for the SignalR notification
hub, `:66-68`), enforced (`:79`). Development loosens two directives, not one: `connect-src` gains
`http://localhost:*` and `ws://localhost:*` (`:74-77`), and `script-src` gains `'unsafe-inline'` (`:105`),
because Visual Studio's Browser Link and Hot Reload inject an inline bootstrap script as well as opening a
WebSocket on a port that changes every run (`:70-73`). Only the first of those is localhost-scoped, and
neither reaches a non-Development host, because the flag is `IWebHostEnvironment.IsDevelopment()` read once at
construction (`:41`; ADR-023:178-184).

The detail worth stealing is the failure path. If the origin cannot be parsed, or on Linux parses as a
`file://` URI instead of http(s), the provider does not guess and it does not stop enforcing. It narrows
`connect-src` to `'self'`, the strictest value it can be sure of, leaves the rest of the policy exactly as it
was, and returns it with `Enforce: true` (`:62`). The policy fails closed. A deployment whose `ApiSettings`
endpoint is wrong still serves its pages, and every cross-origin API call and the SignalR hub are blocked
loudly in the browser console, because the alternative is a permissive Report-Only header that protects
nothing and that nobody notices (`:16-20`, `:60-61`; ADR-023:85-88). A security response header that quietly
stops being enforced is the worse failure mode.

`font-src 'self'` (`:108`) reads like the boring entry in that list, and it is the one that carries a real web
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
with the strict static baseline, exactly right for a YARP proxy serving JSON, WebSockets, and a static privacy
page (ADC Gateway `Program.cs:118,168`; Store Gateway `Program.cs:71,159`). The Blazor UI hosts register
`AddCommonBlazorCsp()` first, then the same plain `AddCommonSecurityHeaders(builder.Configuration)` with no
configure delegate, then `UseCommonSecurityHeaders()` (ADC UI `Program.cs:162,163,192`; Store UI
`Program.cs:191,192,215`). Each UI origin emits its own HSTS on purpose, because an HSTS pin is per-origin and
the Gateway's header says nothing about the sibling hostname a user actually types (ADC UI
`Program.cs:156-161`; Store UI `Program.cs:184-190`). The built-in `app.UseHsts()` stays uncalled on both,
since it would run later in the pipeline and overwrite the shared one-year value with its own weaker default
(ADC UI `Program.cs:188-191`).

The cross-origin posture at that same edge is a separate decision with its own record: two policies, an
allow-listed one for service hosts and a deliberately broader one for gateways (ADR-082,
`Website/docs-src/adr/082-two-tier-cors-posture.md:28-34`), which names ADR-023 as its edge sibling (`:19-25`).
The middleware carries a unit test, `SecurityHeadersMiddlewareTests` in `MMCA.Common.Aspire.Tests`, and each
app's Gateway has its own `SecurityHeadersTests` asserting the headers are present.

## Trade-offs, honestly

- **The baseline is complete, not maximal.** A default that works for a Blazor and MudBlazor host is a default
  that carries `style-src 'unsafe-inline'` (`SecurityHeaders.cs:65-67`), so inline styles are not blocked out
  of the box, and an API or gateway host that serves no HTML inherits a script and style allowance it does not
  need. Tightening past that is an explicit act: configure the `"SecurityHeaders"` section, register your own
  provider, or move to the `{nonce}` placeholder (ADR-023:91-96).
- **Registration order is a foot-gun.** Because the provider uses `TryAddSingleton` (`SecurityHeaders.cs:263`),
  a host that calls `AddCommonSecurityHeaders` before registering its custom `ICspPolicyProvider` silently
  keeps the static default. The order is correct in both apps, but nothing forces it.
- **Failing closed moves the pain onto a running app.** A Blazor host whose `ApiSettings` endpoint is wrong
  still serves pages, but the enforced `connect-src 'self'` blocks every cross-origin API call and the SignalR
  notification hub (`BlazorCspPolicyProvider.cs:62`). That loud signal is the point, and the cost is that the
  configuration mistake lands on the users of that deployment rather than in a passive report
  (ADR-023:105-109).
- **One shared Blazor provider constrains divergence.** `BlazorCspPolicyProvider` lives once in
  `MMCA.Common.UI.Web` over the shared `ApiSettings`, so a host that needs genuinely different CSP logic
  cannot tweak an app-local copy. It has to supply its own `ICspPolicyProvider` instead, registered before
  `AddCommonSecurityHeaders`.

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
origin and fails closed when it cannot, and how both apps adopt it at their Gateway and UI edges (ADR-023).

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

*Notes: verified type/behavior names with path:line (re-read this run):*
- *`SecurityHeadersMiddleware` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs:145`); `InvokeAsync` (`:180`): `X-Content-Type-Options: nosniff` (`:185`), `X-Frame-Options` (`:186`), `Referrer-Policy` ternary on `IsCredentialPath` (`:187-189`), `Permissions-Policy` (`:190`), credential-path `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` plus `Pragma: no-cache` (`:192-196`), HSTS `StrictTransportSecurity` (`:198-200`), CSP resolve via provider and null guard (`:203-204`), `{nonce}` substitution (`:210-215`), `ContentSecurityPolicy` (`:219`) or `ContentSecurityPolicyReportOnly` (`:223`); `_enableHsts = EnableHsts && !IsDevelopment()` in ctor (`:170`); `IsCredentialPath` segment-based and case-insensitive (`:174-177`); `NoncePlaceholder = "{nonce}"` (`:148`), `NonceByteCount = 16` (`:151`).*
- *`CspNonce` static class (`SecurityHeaders.cs:122-137`) with `ItemKey = "MMCA.CspNonce"` (`:125`) and `Get(HttpContext)` (`:132`).*
- *`SecurityHeadersSettings` (`SecurityHeaders.cs:19`): `SectionName = "SecurityHeaders"` (`:22`), `FrameOptions = "DENY"` (`:25`), `ReferrerPolicy = "strict-origin-when-cross-origin"` (`:28`), `PermissionsPolicy = "geolocation=(), microphone=(), camera=(), payment=()"` (`:31`), `EnableHsts = true` (`:34`), `CredentialPathPrefixes = ["/reset-password", "/auth/oauth-complete"]` (`:46`), `HstsValue = "max-age=31536000; includeSubDomains"` (`:49`), `ContentSecurityPolicy` default `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` (`:65-67`, documented as a complete hardened baseline, with the `{nonce}` path off `'unsafe-inline'`, at `:51-64`), `EnforceContentSecurityPolicy = true` (`:70`).*
- *`CspPolicy(string Value, bool Enforce)` record (`SecurityHeaders.cs:76`); `ICspPolicyProvider` (`:84`) with `GetPolicy(HttpContext)` (`:87`); `StaticCspPolicyProvider` internal sealed (`:91`), computes policy once in ctor (`:95-102`), returns cached (`:104`).*
- *`SecurityHeadersExtensions` static (`SecurityHeaders.cs:236`): `AddCommonSecurityHeaders(configuration?, configure?)` (`:246`) binds the `"SecurityHeaders"` section (`:255`), applies `configure` (`:260`), `TryAddSingleton<ICspPolicyProvider, StaticCspPolicyProvider>` (`:263`); `UseCommonSecurityHeaders()` (`:271`) to `UseMiddleware<SecurityHeadersMiddleware>()` (`:274`).*
- *`BlazorCspPolicyProvider` internal sealed (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:28`): builds the policy once in ctor (`:33-42`, `IsDevelopment()` read there at `:41`), `GetPolicy` returns cached (`:45`); `BuildCsp` (`:49`) reads `WasmApiEndpoint ?? ApiEndpoint` (`:51`); an unparseable or non-http(s) endpoint FAILS CLOSED, returning `BuildPolicy("connect-src 'self'", ...)` with `Enforce: true` (`:55-63`, rationale `:60-61` and class doc `:16-20`); otherwise it pins `connect-src 'self' {origin} {wss|ws}://{authority}` (`:66-68`) with the Development localhost loosening (`:74-77`) and `Enforce: true` (`:79`); `BuildFrameSrc` (`:85-97`) emits `frame-src 'self' <origins>` only when `BlazorCspSettings.FrameSources` is non-empty (canonicalized and de-duplicated `:92-96`, absent by default `:82`); `BuildPolicy` (`:103-113`): `default-src 'self'` (`:104`), `script-src 'self' 'wasm-unsafe-eval'` plus `'unsafe-inline'` in Development (`:105`), `style-src 'self' 'unsafe-inline'` (`:106`), `img-src 'self' data: https:` (`:107`), `font-src 'self'` (`:108`), `connect-src` (`:109`), optional `frame-src` (`:110`), `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'` (`:111-113`).*
- *`AddCommonBlazorCsp()` (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:52`): binds `BlazorCspSettings` from `"BlazorCsp"` with `ValidateOnStart()` (`:54-56`), `TryAddEnumerable` for `BlazorCspSettingsValidator` (`:59-60`), then `AddSingleton<ICspPolicyProvider, BlazorCspPolicyProvider>` (`:62`). ADC's UI configures `BlazorCsp:FrameSources` for the embedded Google Maps (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:47-52`).*
- *Host adoption: ADC UI `AddCommonBlazorCsp` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:162`), plain `AddCommonSecurityHeaders(builder.Configuration)` with no configure delegate (`:163`), `UseCommonSecurityHeaders` (`:192`), HSTS-at-the-UI-origin rationale (`:156-161`) and the "do not call app.UseHsts()" note (`:188-191`); Store UI (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:191,192,215`, rationale `:184-190`); ADC Gateway `AddCommonSecurityHeaders` (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:118`), `UseCommonSecurityHeaders` (`:168`); Store Gateway (`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:71,159`).*
- *ADR-023 (`Website/docs-src/adr/023-security-response-headers.md`): complete hardened baseline (`:46-53`), nonce substitution (`:42-45`), fail-closed rationale (`:85-88`) and its trade-off (`:105-109`), baseline-not-maximal trade-off (`:91-96`), credential-path revision (`:111-125`), Development loosening two directives (`:178-184`), opt-in validated `frame-src` (`:185-197`). ADR-082 (`Website/docs-src/adr/082-two-tier-cors-posture.md`): two cross-origin policies (`:28-34`), ADR-023 named as its edge sibling (`:19-25`).*
- *The code block is condensed from `SecurityHeaders.cs:180-228` (comments added, header names, defaults and branch order faithful to source, not byte-for-byte).*
- *`SecurityHeadersMiddlewareTests` in `MMCA.Common.Aspire.Tests` and per-app Gateway `SecurityHeadersTests` (ADC/Store) confirmed to exist by file listing this run (`MMCA.Common/Tests/Hosting/MMCA.Common.Aspire.Tests/Security/SecurityHeadersMiddlewareTests.cs`, `MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/SecurityHeadersTests.cs`, `MMCA.Store/Tests/Hosts/MMCA.Store.Gateway.Tests/SecurityHeadersTests.cs`); not opened line-by-line. Anchor facts (125 accepted ADRs, 001-125, per `Website/docs-src/adr/README.md:6`; framework v1.205.0 as of 2026-09-17 per `MMCA.Common/FACTS.md:4,14`; 19 published packages per `MMCA.Common/FACTS.md:19`; the 34-category rubric per `Website/docs-src/governance/common-ArchitectureScorecard.md:5`) are cited, not recounted here.*
- *2026-09-19 audit pass (re-read this run): the premise of two passages had inverted in source, and both are rewritten rather than re-anchored. (1) The static baseline no longer omits `script-src`/`style-src`: it ships both (`SecurityHeaders.cs:65-67`, doc `:51-64`; ADR-023 revised 2026-09-01, `:4-9`), so the former "deliberately incomplete" passage and its trade-off bullet became the complete-not-maximal default. (2) `BlazorCspPolicyProvider` no longer degrades to a permissive `Enforce: false` Report-Only policy on an unresolvable origin: it narrows `connect-src` to `'self'` and stays enforced (`:62`, class doc `:16-20`; ADR-023:85-88, :105-109), so the failure-path section, the "degraded policy protects nothing" bullet, Apply item 4, the closing takeaway and the abstract were rewritten to fail closed. Newly covered because they are material and were absent: the `{nonce}` substitution and `CspNonce` (`SecurityHeaders.cs:122-137`, `:210-215`), the credential-path `no-referrer` plus `no-store` branch (`:46`, `:174-177`, `:187-196`), the opt-in validated `frame-src` (`BlazorCspPolicyProvider.cs:85-97`), and the Development `script-src 'unsafe-inline'` loosening (`:105`). Host adoption re-pinned after both UI hosts dropped `EnableHsts = false` and emit HSTS at their own origin (ADC UI `:156-163`, `:192`; Store UI `:184-192`, `:215`); Gateway anchors moved to ADC `:118,:168` and Store `:71,:159`. Every `SecurityHeaders.cs` and `BlazorCspPolicyProvider.cs` anchor in this file moved with the source and was re-read at the lines cited above. Framework anchor v1.155.0 to v1.205.0, packages 15 to 19, ADR corpus 001-089 to 001-125.*

- Full series index: https://ivanball.github.io/writing.html
