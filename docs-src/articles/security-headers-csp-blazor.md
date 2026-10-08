# Security Headers and CSP for Blazor: One Middleware, Every Host

> Series: MMCA.Common · Article #47 (deep-dive) · Pillar P2 · Group G16 · Rubric §26 · ADR-023 ·
> Status: grounded in `Website/docs-src/adr/023-security-response-headers.md`,
> `Website/docs-src/adr/082-two-tier-cors-posture.md`,
> `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs`,
> `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs`,
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
case-insensitively by `IsCredentialPath` (`:179-182`). Every entry must start with `/`: the property carries
`[LeadingSlashPathPrefixes]` (`:47`) and `AddCommonSecurityHeaders` validates the settings with
`ValidateDataAnnotations().ValidateOnStart()` (`:276-277`), so a malformed prefix fails the boot once instead
of every request. On a hit the response answers `Referrer-Policy: no-referrer` instead of the site-wide value
(`:192-194`) and carries `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` (the constant
`CredentialCacheControl`, `:156`) with `Pragma: no-cache`, written by `ApplyCredentialCacheHeaders`
(`:246-250`). The middleware applies that pair as soon as the path matches and applies it again in a
`Response.OnStarting` callback (`:197-212`, callback `:205-211`), because the Razor Components endpoint writes
its own weaker `Cache-Control` while it renders and the callback is what settles the value last. A reset token
or an OAuth authorization code sitting in the URL therefore never travels onward in a `Referer` header, and the
rendered page never lingers in a browser or proxy cache (ADR-023:129-140, :257-268).

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
which is the supported route off `'unsafe-inline'` (documented on the setting, `:64-65`; ADR-023:50-52). A
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

await _next(context).ConfigureAwait(false);
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
serves are unaffected either way (ADR-023:53-60).

## The Blazor policy, built at runtime

An HTML host opts into the origin-pinned policy by registering its own provider. Both apps register one
shared `BlazorCspPolicyProvider`
(`MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:28`) via `AddCommonBlazorCsp()`
(`MMCA.Common.UI.Web/DependencyInjection.cs:67`), which does three things: binds `BlazorCspSettings` from the
`"BlazorCsp"` configuration section with `ValidateOnStart()` (`:69-71`), registers
`BlazorCspSettingsValidator` through `TryAddEnumerable` so calling it twice validates once (`:74-75`), and
registers `AddSingleton<ICspPolicyProvider, BlazorCspPolicyProvider>` (`:77`). Only the static default uses
`TryAddSingleton` (`SecurityHeaders.cs:288`), so a provider registered first suppresses it, and because a
single-service resolve returns the last registration, a plain `AddSingleton` provider registered afterwards
still wins. Calling `AddCommonBlazorCsp()` before `AddCommonSecurityHeaders(...)` is the documented
convention (`SecurityHeaders.cs:265-266` and the interface summary at `:83-84`, `DependencyInjection.cs:56-58`;
ADR-023:105-114), not the thing that makes the Blazor provider win.

The provider builds the full policy once, at construction (`BlazorCspPolicyProvider.cs:33-42`), and returns
the cached result for every request (`:45`). `BuildPolicy` (`:103-113`) assembles what a Blazor + MudBlazor
page actually needs: `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'` (the WASM runtime),
`style-src 'self' 'unsafe-inline'` (MudBlazor), `img-src 'self' data: https:` (profile pictures and CDN
images are low XSS-risk, so images stay open while the directives that matter for exfiltration stay locked),
`font-src 'self'`, plus `base-uri`, `form-action`, and `frame-ancestors 'none'`. The list carries no
`object-src`, so objects fall back to `default-src 'self'` rather than the static baseline's explicit
`object-src 'none'` (ADR-023:188-192): on that one directive the Blazor policy is looser than the default it
replaces.

One directive in that list is opt-in. `BuildFrameSrc` (`:85-97`) emits `frame-src 'self' <origins>` only when
`BlazorCspSettings.FrameSources` lists at least one origin, canonicalized and de-duplicated before the splice
(`:92-96`, spliced into the policy at `:110`); with the default empty list there is no `frame-src` at all and
frames fall back to `default-src 'self'` (class doc `:21-23`; `:82`). Entries are validated at boot rather
than trusted, so a wildcard or a stray semicolon fails startup with a message naming it instead of landing
verbatim in a security response header (ADR-023:200-212). ADC's Blazor host configures it for the embedded
Google Maps venue maps on its public event page (`MMCA.ADC.UI.Web/appsettings.json:70-76`, comment `:66-69`). `frame-ancestors 'none'` is never relaxed by
that path (`:21-24`).

The hard directive is `connect-src`, because it is per-deployment. `BuildCsp` (`:49`) reads the API origin
from `ApiSettings` (`WasmApiEndpoint ?? ApiEndpoint`, `:51`), and if it resolves to a real http(s) URL it pins
`connect-src` to `'self'` plus that origin and its WebSocket form (`wss://...` for the SignalR notification
hub, `:66-68`), enforced (`:79`). Development loosens two directives, not one: `connect-src` gains
`http://localhost:*` and `ws://localhost:*` (`:74-77`), and `script-src` gains `'unsafe-inline'` (`:105`),
because Visual Studio's Browser Link and Hot Reload inject an inline bootstrap script as well as opening a
WebSocket on a port that changes every run (`:70-73`). Only the first of those is localhost-scoped, and
neither reaches a non-Development host, because the flag is `IWebHostEnvironment.IsDevelopment()` read once at
construction (`:41`; ADR-023:193-199).

The detail worth stealing is the failure path. If the origin cannot be parsed, or on Linux parses as a
`file://` URI instead of http(s), the provider does not guess and it does not stop enforcing. It narrows
`connect-src` to `'self'`, the strictest value it can be sure of, leaves the rest of the policy exactly as it
was, and returns it with `Enforce: true` (`:62`). The policy fails closed. A deployment whose `ApiSettings`
endpoint is wrong still serves its pages, and every cross-origin API call and the SignalR hub are blocked
loudly in the browser console, because the alternative is a permissive Report-Only header that protects
nothing and that nobody notices (`:16-20`, `:60-61`; ADR-023:93-96). A security response header that quietly
stops being enforced is the worse failure mode.

Both apps also opt into the same-origin API proxy (ADR-131): `AddCommonSameOriginApiProxy` (ADC UI
`Program.cs:161`, Store UI `Program.cs:153`) paired with `MapCommonSameOriginApiProxy` (`:284`, `:262`).
With it, `/client-config` switches the WebAssembly client's API client and notification hub to the proxy on
the UI host's own origin (`MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:13-16`,
`:24-25`), so the browser's API and hub traffic is same-origin and admitted by the `'self'` entry that leads
every `connect-src` the provider builds (`BlazorCspPolicyProvider.cs:62`, `:68`). The provider does not read
the proxy settings: it pins the configured gateway origin either way (`:51`, `:66-68`). In a proxied host the
fail-closed narrowing therefore leaves the proxied API and hub calls working, because `'self'` still covers
them.

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
page (ADC Gateway `Program.cs:120,170`; Store Gateway `Program.cs:71,159`). The Blazor UI hosts register
`AddCommonBlazorCsp()` first, then the same plain `AddCommonSecurityHeaders(builder.Configuration)` with no
configure delegate, then `UseCommonSecurityHeaders()` (ADC UI `Program.cs:194,195,216`; Store UI
`Program.cs:185,186,204`). Each UI origin emits its own HSTS on purpose, because an HSTS pin is per-origin and
the Gateway's header says nothing about the sibling hostname a user actually types (ADC UI
`Program.cs:188-193`; Store UI `Program.cs:178-184`). The built-in `app.UseHsts()` stays uncalled on both,
since it would run later in the pipeline and overwrite the shared one-year value with its own weaker default
(ADC UI `Program.cs:212-215`; Store UI `Program.cs:215-219`).

The cross-origin posture at that same edge is a separate decision with its own record: two policies, an
allow-listed one for service hosts and a deliberately broader one for gateways (ADR-082,
`Website/docs-src/adr/082-two-tier-cors-posture.md:28-34`), which names ADR-023 as its edge sibling (`:19-25`).
The middleware carries a unit test, `SecurityHeadersMiddlewareTests` in `MMCA.Common.Aspire.Tests`, and all
four edges carry their own `SecurityHeadersTests`: each app's Gateway, and each app's UI host, where a
Production-pinned host factory is what lets the test see the per-origin HSTS described above (ADR-023:154-171).

## Trade-offs, honestly

- **The baseline is complete, not maximal.** A default that works for a Blazor and MudBlazor host is a default
  that carries `style-src 'unsafe-inline'` (`SecurityHeaders.cs:67-69`), so inline styles are not blocked out
  of the box, and an API or gateway host that serves no HTML inherits a script and style allowance it does not
  need. Tightening past that is an explicit act: configure the `"SecurityHeaders"` section, register your own
  provider, or move to the `{nonce}` placeholder (ADR-023:99-104).
- **Registration order matters only for `TryAdd`.** The static default uses `TryAddSingleton`
  (`SecurityHeaders.cs:288`) and `AddCommonBlazorCsp` uses plain `AddSingleton` (`DependencyInjection.cs:77`),
  so the Blazor provider wins in either order. The trap is narrower: a custom provider added after
  `AddCommonSecurityHeaders` with `TryAdd` silently keeps the static default (ADR-023:105-114). Both apps
  register in the documented order, but nothing forces it.
- **Failing closed moves the pain onto a running app.** A Blazor host whose `ApiSettings` endpoint is wrong
  still serves pages, but the enforced `connect-src 'self'` blocks every cross-origin API call and SignalR
  connection a client makes to the gateway directly (`BlazorCspPolicyProvider.cs:62`). That loud signal is the
  point, and the cost is that the configuration mistake lands on the users of that deployment rather than in
  a passive report (ADR-023:120-124).
- **One shared Blazor provider constrains divergence.** `BlazorCspPolicyProvider` lives once in
  `MMCA.Common.UI.Web` over the shared `ApiSettings`, so a host that needs genuinely different CSP logic
  cannot tweak an app-local copy. It has to supply its own `ICspPolicyProvider` instead, registered before
  `AddCommonSecurityHeaders` by convention.

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
- *`SecurityHeadersMiddleware` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs:147`); `InvokeAsync` (`:185`, spanning `:185-244`): `X-Content-Type-Options: nosniff` (`:190`), `X-Frame-Options` (`:191`), `Referrer-Policy` ternary on `IsCredentialPath` (`:192-194`), `Permissions-Policy` (`:195`), credential-path branch (`:197-212`) calling `ApplyCredentialCacheHeaders` (`:199`, defined `:246-250`: `Cache-Control` from the constant `CredentialCacheControl = "no-store, no-cache, must-revalidate, max-age=0"` at `:156`, plus `Pragma: no-cache` at `:249`) and re-applying it in a `Response.OnStarting` callback (`:205-211`, rationale comment `:201-204`), HSTS `StrictTransportSecurity` (`:214-217`), CSP resolve via provider and null guard (`:219-220`), `{nonce}` substitution (`:226-231`), `ContentSecurityPolicy` (`:235`) or `ContentSecurityPolicyReportOnly` (`:239`); `_enableHsts = EnableHsts && !IsDevelopment()` in ctor (`:175`); `IsCredentialPath` segment-based and case-insensitive (`:179-182`); `NoncePlaceholder = "{nonce}"` (`:150`), `NonceByteCount = 16` (`:153`).*
- *`CspNonce` static class (`SecurityHeaders.cs:124-139`) with `ItemKey = "MMCA.CspNonce"` (`:127`) and `Get(HttpContext)` (`:134`).*
- *`SecurityHeadersSettings` (`SecurityHeaders.cs:19`): `SectionName = "SecurityHeaders"` (`:22`), `FrameOptions = "DENY"` (`:25`), `ReferrerPolicy = "strict-origin-when-cross-origin"` (`:28`), `PermissionsPolicy = "geolocation=(), microphone=(), camera=(), payment=()"` (`:31`), `EnableHsts = true` (`:34`), `CredentialPathPrefixes = ["/reset-password", "/auth/oauth-complete"]` (`:48`, carrying `[LeadingSlashPathPrefixes]` at `:47`, leading-slash rule in its doc `:43-44`), `HstsValue = "max-age=31536000; includeSubDomains"` (`:51`), `ContentSecurityPolicy` default `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` (`:67-69`, documented as a complete hardened baseline, with the `{nonce}` path off `'unsafe-inline'`, at `:53-66`, nonce sentence `:64-65`), `EnforceContentSecurityPolicy = true` (`:72`).*
- *`CspPolicy(string Value, bool Enforce)` record (`SecurityHeaders.cs:78`); `ICspPolicyProvider` (`:86`) with `GetPolicy(HttpContext)` (`:89`), register-first convention in its summary (`:83-84`); `StaticCspPolicyProvider` internal sealed (`:93`), computes policy once in ctor (`:97-104`), returns cached (`:106`).*
- *`SecurityHeadersExtensions` static (`SecurityHeaders.cs:258`): `AddCommonSecurityHeaders(configuration?, configure?)` (`:268`, register-first doc `:265-266`) registers the settings with `ValidateDataAnnotations().ValidateOnStart()` (`:276-277`), binds the `"SecurityHeaders"` section (`:280`), applies `configure` (`:285`), `TryAddSingleton<ICspPolicyProvider, StaticCspPolicyProvider>` (`:288`); `UseCommonSecurityHeaders()` (`:296`) to `UseMiddleware<SecurityHeadersMiddleware>()` (`:299`).*
- *`BlazorCspPolicyProvider` internal sealed (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:28`): builds the policy once in ctor (`:33-42`, `IsDevelopment()` read there at `:41`), `GetPolicy` returns cached (`:45`); `BuildCsp` (`:49`) reads `WasmApiEndpoint ?? ApiEndpoint` (`:51`); an unparseable or non-http(s) endpoint FAILS CLOSED, returning `BuildPolicy("connect-src 'self'", ...)` with `Enforce: true` (`:55-63`, rationale `:60-61` and class doc `:16-20`); otherwise it pins `connect-src 'self' {origin} {wss|ws}://{authority}` (`:66-68`) with the Development localhost loosening (`:74-77`) and `Enforce: true` (`:79`); `BuildFrameSrc` (`:85-97`) emits `frame-src 'self' <origins>` only when `BlazorCspSettings.FrameSources` is non-empty (canonicalized and de-duplicated `:92-96`, absent by default `:82`, fallback to `default-src 'self'` stated in the class doc `:21-23`); `BuildPolicy` (`:103-113`): `default-src 'self'` (`:104`), `script-src 'self' 'wasm-unsafe-eval'` plus `'unsafe-inline'` in Development (`:105`), `style-src 'self' 'unsafe-inline'` (`:106`), `img-src 'self' data: https:` (`:107`), `font-src 'self'` (`:108`), `connect-src` (`:109`), optional `frame-src` (`:110`), `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'` (`:111-113`).*
- *`AddCommonBlazorCsp()` (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:67`): binds `BlazorCspSettings` from `"BlazorCsp"` with `ValidateOnStart()` (`:69-71`), `TryAddEnumerable` for `BlazorCspSettingsValidator` (`:74-75`), then plain `AddSingleton<ICspPolicyProvider, BlazorCspPolicyProvider>` (`:77`), with the register-first convention in its XML doc (`:56-58`, matching `SecurityHeaders.cs:265-266`). ADC's UI configures `BlazorCsp:FrameSources` for the embedded Google Maps (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/appsettings.json:70-76`, three google origins `:72-74`, comment `:66-69`; `:60-65` is the `SameOriginApiProxy` block).*
- *Same-origin API proxy (ADR-131, `Website/docs-src/adr/131-same-origin-api-proxy.md`): `AddCommonSameOriginApiProxy` doc (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:13-16`) and the `/client-config` switch of the WASM `"APIClient"` and notification hub to the proxy (`:24-25`); ADC UI `AddCommonSameOriginApiProxy` (`Program.cs:161`) and `MapCommonSameOriginApiProxy` (`:284`), Store UI (`Program.cs:153`, `:262`). No file under `SameOriginProxy/` references `connect-src` or the CSP (Grep, 2026-10-02 pass), and `BlazorCspPolicyProvider` reads only `ApiSettings` and `BlazorCspSettings` (`:33-41`, `:51`), so the CSP is unchanged by the proxy; the same-origin coverage is the `'self'` that leads `connect-src` (`:62`, `:68`).*
- *Host adoption: ADC UI `AddCommonBlazorCsp` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:194`), plain `AddCommonSecurityHeaders(builder.Configuration)` with no configure delegate (`:195`), `UseCommonSecurityHeaders` (`:216`), CSP and HSTS comment block (`:183-193`) with the HSTS-at-the-UI-origin rationale (`:188-193`) and the "do not call app.UseHsts()" note (`:212-215`); Store UI (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:185,186,204`, rationale `:178-184`, no-`UseHsts` note `:215-219`; carried from the 2026-10-02 pass, not re-read this run); ADC Gateway `AddCommonSecurityHeaders` (`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:120`), `UseCommonSecurityHeaders` (`:170`); Store Gateway (`MMCA.Store/Source/Hosts/MMCA.Store.Gateway/Program.cs:71,159`, carried from the 2026-10-02 pass).*
- *ADR-023 (`Website/docs-src/adr/023-security-response-headers.md`): complete hardened baseline (`:53-60`), nonce substitution (`:50-52`), fail-closed rationale (`:93-96`) and its trade-off (`:120-124`), baseline-not-maximal trade-off (`:99-104`), registration order matters only for `TryAdd` (`:105-114`, corrected in the 2026-10-01 revision `:223-253`), credential-path revision (section `:126`, item `:129-140`), UI-host `SecurityHeadersTests` (`:154-171`, Production-pinned `:160-164`), Blazor policy has no `object-src` (`:188-192`), Development loosening two directives (`:193-199`), opt-in validated `frame-src` (`:200-212`), credential-path `OnStarting` re-apply and startup-validated prefixes (2026-10-06 revision `:255-279`, item `:257-268`), ADC host anchors re-verified (2026-10-07 revision `:281-302`). ADR-082 (`Website/docs-src/adr/082-two-tier-cors-posture.md`): two cross-origin policies (`:28-34`), ADR-023 named as its edge sibling (`:19-25`).*
- *The code block is condensed from `SecurityHeaders.cs:185-244` (comments added, header names, defaults and branch order faithful to source, not byte-for-byte).*
- *`SecurityHeadersMiddlewareTests` in `MMCA.Common.Aspire.Tests` (`MMCA.Common/Tests/Hosting/MMCA.Common.Aspire.Tests/Security/SecurityHeadersMiddlewareTests.cs`, listed in the 2026-09-19 pass, not re-listed this run) and four per-edge `SecurityHeadersTests` confirmed to exist by Glob in the 2026-10-02 pass (`MMCA.ADC/Tests/Hosts/MMCA.ADC.Gateway.Tests/SecurityHeadersTests.cs`, `MMCA.Store/Tests/Hosts/MMCA.Store.Gateway.Tests/SecurityHeadersTests.cs`, `MMCA.ADC/Tests/Hosts/MMCA.ADC.UI.Web.Tests/SecurityHeadersTests.cs`, `MMCA.Store/Tests/Hosts/MMCA.Store.UI.Web.Tests/SecurityHeadersTests.cs`); not opened line-by-line, the Production-pinned factory is per ADR-023:154-171. Anchor facts (132 accepted ADRs, 001-132, per `Website/docs-src/adr/README.md:6`; framework v1.233.0 as of 2026-10-07 per `MMCA.Common/FACTS.md:4,14`; 22 published packages per `MMCA.Common/FACTS.md:19`; the 34-category rubric per `Website/docs-src/governance/README.md:3`) are cited, not recounted here.*
- *2026-10-08 refresh (v1.233.0, re-read this run: `SecurityHeaders.cs:15-303`, `DependencyInjection.cs:50-79`, ADC UI `Program.cs:183-216` plus a line grep of its proxy and security-header calls, ADC Gateway `Program.cs` by line grep, ADC `appsettings.json:52-78`, ADR-023 `:47-302`, `FACTS.md:1-20`; `BlazorCspPolicyProvider.cs`, `SameOriginApiProxyServiceExtensions.cs`, the Store hosts and `app.css` were not re-read and their anchors are carried from the 2026-10-02 pass). Fixed: the credential-path passage and the condensed code block now show `ApplyCredentialCacheHeaders` (`:246-250`, constant `:156`) and its re-apply in a `Response.OnStarting` callback (`:205-211`) that settles the value over the Razor Components endpoint's weaker `Cache-Control` (ADR-023 2026-10-06 revision `:257-268`), and the startup validation of `CredentialPathPrefixes` (`[LeadingSlashPathPrefixes]` `:47`, `ValidateDataAnnotations().ValidateOnStart()` `:276-277`) is now stated. Moved anchors in `SecurityHeaders.cs`: middleware `:145` to `:147`, `InvokeAsync` `:180` to `:185` (block `:180-228` to `:185-244`), nosniff/XFO/Referrer/Permissions `:185-190` to `:190-195`, credential branch `:192-196` to `:197-212`, HSTS `:198-200` to `:214-217`, ctor `:170` to `:175`, `IsCredentialPath` `:174-177` to `:179-182`, `CredentialPathPrefixes` `:46` to `:48`, `HstsValue` `:49` to `:51`, baseline `:65-67` to `:67-69` (doc `:51-64` to `:53-66`, nonce sentence `:62-63` to `:64-65`), `EnforceContentSecurityPolicy` `:70` to `:72`, `CspPolicy` `:76` to `:78`, `ICspPolicyProvider` `:84` to `:86` (`GetPolicy` `:87` to `:89`), `StaticCspPolicyProvider` `:91` to `:93` (ctor `:95-102` to `:97-104`, cached `:104` to `:106`), `CspNonce` `:122-137` to `:124-139` (`ItemKey` `:125` to `:127`, `Get` `:132` to `:134`), nonce constants `:148,:151` to `:150,:153`, null guard `:203-204` to `:219-220`, splice `:210-215` to `:226-231`, CSP writes `:219,:223` to `:235,:239`, extensions class `:236` to `:258`, `AddCommonSecurityHeaders` `:246` to `:268` (doc `:243-244` to `:265-266`, Bind `:255` to `:280`, Configure `:260` to `:285`, `TryAddSingleton` `:263` to `:288`), `UseCommonSecurityHeaders` `:271,:274` to `:296,:299`. `DependencyInjection.cs`: `AddCommonBlazorCsp` `:52` to `:67`, `ValidateOnStart` `:54-56` to `:69-71`, `TryAddEnumerable` `:59-60` to `:74-75`, `AddSingleton` `:62` to `:77`, doc `:41-43` to `:56-58`. ADC UI `Program.cs`: proxy `:156,:268` to `:161,:284`, `:189,190,210` to `:194,195,216`, HSTS rationale `:183-188` to `:188-193`, no-`UseHsts` note `:206-209` to `:212-215`. ADC Gateway `:118,168` to `:120,170`. ADC `appsettings.json` `BlazorCsp` `:53-63` to `:70-76` (comment `:66-69`, `SameOriginApiProxy` `:60-65`). ADR-023: `:42-45` to `:50-52`, `:46-53` to `:53-60`, `:86-89` to `:93-96`, `:92-97` to `:99-104`, `:98-106` to `:105-114`, `:112-116` to `:120-124`, `:118` to `:126`, `:121-132` to `:129-140`, `:146-163` to `:154-171`, `:181-184` to `:188-192`, `:185-191` to `:193-199`, `:192-204` to `:200-212`, `:215-227` to `:223-253`. Anchor facts v1.221.0 (2026-10-02) to v1.233.0 (2026-10-07), ADRs 001-131 to 001-132.*
- *2026-10-02 refresh (v1.221.0, re-read this run: `BlazorCspPolicyProvider.cs` in full, `DependencyInjection.cs:30-69`, `SecurityHeaders.cs:236-277` plus a line grep of every other `SecurityHeaders.cs` anchor above, ADR-023 by line grep and `:86-232`, both UI `Program.cs` and Gateway call lines, ADC `appsettings.json:44-64`, `SameOriginApiProxyServiceExtensions.cs:10-70`; `app.css` `@font-face` at `:9,17,25,33,41` and `BlazorCspSettingsValidator.cs:19` spot-checked). Fixed: the registration-order passage and trade-off bullet (the Blazor provider wins in either order because it uses plain `AddSingleton`; the static default is lost silently only to a late `TryAdd` provider; ADR-023 corrected this 2026-10-01), the `frame-src` fallback anchor (now the class doc `:21-23`), the Gateway-only test sentence (UI hosts also carry `SecurityHeadersTests`), and every moved anchor: ADC UI `:162,163,192` to `:189,190,210`, `:156-161` to `:183-188`, `:188-191` to `:206-209`; Store UI `:191,192,215` to `:185,186,204`, `:184-190` to `:178-184`, plus `:215-219`; ADC `appsettings.json:47-52` to `:53-63`; ADR-023 `:114-125` to `:121-132`, `:85-88` to `:86-89`, `:91-96` to `:92-97`, `:105-109` to `:112-116`, `:178-184` to `:185-191`, `:185-197` to `:192-204`. Added: the Blazor policy's missing `object-src` (ADR-023:181-184) and a paragraph on how the same-origin proxy relates to `connect-src` (ADR-131). Anchor facts v1.205.0 to v1.221.0, packages 19 to 22, ADRs 001-125 to 001-131; the rubric count is now cited to `governance/README.md:3`.*
- *2026-09-19 audit pass (history): the premise of two passages had inverted in source, and both are rewritten rather than re-anchored. (1) The static baseline no longer omits `script-src`/`style-src`: it ships both (`SecurityHeaders.cs:65-67`, doc `:51-64`; ADR-023 revised 2026-09-01, `:4-9`), so the former "deliberately incomplete" passage and its trade-off bullet became the complete-not-maximal default. (2) `BlazorCspPolicyProvider` no longer degrades to a permissive `Enforce: false` Report-Only policy on an unresolvable origin: it narrows `connect-src` to `'self'` and stays enforced (`:62`, class doc `:16-20`; ADR-023:85-88, :105-109), so the failure-path section, the "degraded policy protects nothing" bullet, Apply item 4, the closing takeaway and the abstract were rewritten to fail closed. Newly covered because they are material and were absent: the `{nonce}` substitution and `CspNonce` (`SecurityHeaders.cs:122-137`, `:210-215`), the credential-path `no-referrer` plus `no-store` branch (`:46`, `:174-177`, `:187-196`), the opt-in validated `frame-src` (`BlazorCspPolicyProvider.cs:85-97`), and the Development `script-src 'unsafe-inline'` loosening (`:105`). Host adoption re-pinned after both UI hosts dropped `EnableHsts = false` and emit HSTS at their own origin (ADC UI `:156-163`, `:192`; Store UI `:184-192`, `:215`); Gateway anchors moved to ADC `:118,:168` and Store `:71,:159`. Every `SecurityHeaders.cs` and `BlazorCspPolicyProvider.cs` anchor in this file moved with the source and was re-read at the lines cited above. Framework anchor v1.155.0 to v1.205.0, packages 15 to 19, ADR corpus 001-089 to 001-125.*

- Full series index: https://ivanball.github.io/writing.html
