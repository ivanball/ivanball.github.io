# ADR-023: Centralized Security-Response-Headers Middleware with a Pluggable CSP

## Status
Accepted (2026-07-02). Revised 2026-09-01 (the static default is now a complete hardened baseline: it
ships `script-src 'self' 'wasm-unsafe-eval'` and `style-src 'self' 'unsafe-inline'` instead of omitting
both directives; `BlazorCspPolicyProvider` fails closed on an API/Gateway origin it cannot resolve,
narrowing `connect-src` to `'self'` while staying enforced, rather than degrading to a permissive
Report-Only policy; the middleware also substitutes a per-request nonce for a `{nonce}` token in the
resolved policy).
Revised 2026-09-07 (HSTS and forwarded headers are applied on the UI hosts and not only at the
gateway, and credential-carrying paths additionally answer `Referrer-Policy: no-referrer` and
`Cache-Control: no-store`).
Revised 2026-09-19 (the Blazor provider's emitted policy is recorded in full: it also carries
`img-src` and `font-src`, an opt-in startup-validated `frame-src`, and a Development-only
`script-src 'unsafe-inline'`; and the UI host's forwarded-headers options clear `KnownProxies` and
`KnownIPNetworks` on purpose).
## Context
Every client-facing host (the YARP Gateway and the Blazor UI web host in each app) must stamp the same
hardened HTTP response headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`, HSTS, and a Content-Security-Policy. These were previously hand-rolled per host, so
the values drifted between Gateway and UI and between apps, and a new edge host could ship with weaker
headers (or none) by omission. A `Content-Security-Policy` is the hard part: an API or Gateway host that
serves JSON, WebSockets, and a static privacy page wants a strict, fixed policy, but a Blazor/MudBlazor
host needs `script-src 'wasm-unsafe-eval'` and `style-src 'unsafe-inline'` and must pin `connect-src` to
its own API/Gateway origin (which it only knows at runtime from configuration). One static policy cannot
serve both, and a wrong CSP hard-breaks the app, so the policy cannot simply be a constant in the
framework.

## Decision
Ship one security-headers middleware in `MMCA.Common.Aspire` (`MMCA.Common.Aspire.Security`), registered
with `AddCommonSecurityHeaders(configuration?, configure?)` and inserted early with
`UseCommonSecurityHeaders()`.

- **`SecurityHeadersMiddleware` stamps every response** with `X-Content-Type-Options: nosniff`,
  `X-Frame-Options` (default `DENY`), `Referrer-Policy` (default `strict-origin-when-cross-origin`),
  `Permissions-Policy` (default `geolocation=(), microphone=(), camera=(), payment=()`), and HSTS
  (`max-age=31536000; includeSubDomains`, emitted only outside Development and only when `EnableHsts`).
  All values are overridable via the `"SecurityHeaders"` configuration section or the `configure`
  delegate (`SecurityHeadersSettings`).
- **The CSP is resolved through an `ICspPolicyProvider` extension point**, not stamped as a constant. The provider
  returns a `CspPolicy(string Value, bool Enforce)`: when `Enforce` is true the middleware writes
  `Content-Security-Policy`, otherwise `Content-Security-Policy-Report-Only`. Returning `null` emits no
  CSP. A resolved policy that carries the literal token `{nonce}` gets a fresh 128-bit value per request,
  substituted into the header as `'nonce-<value>'` and stashed in `HttpContext.Items` (read with
  `CspNonce.Get`) before the rest of the pipeline runs, so a layout can stamp it onto its own tags.
- **The default provider (`StaticCspPolicyProvider`) returns a complete hardened baseline** from
  `SecurityHeadersSettings.ContentSecurityPolicy`:
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`.
  It ships `script-src` and `style-src` at exactly the strength Blazor (`'wasm-unsafe-eval'`) and
  MudBlazor (`'unsafe-inline'` styles) need, so an HTML host that never registers a fuller provider gets
  a functional policy rather than one silently missing both directives, while the JSON, WebSocket and
  static responses of API and Gateway hosts are unaffected. A host wanting a stricter or looser policy
  configures the `"SecurityHeaders"` section or registers its own provider.
- **HTML hosts register their own `ICspPolicyProvider`** before calling `AddCommonSecurityHeaders`
  (the registration uses `TryAddSingleton`, so the first-registered provider wins). Both apps register
  one shared `BlazorCspPolicyProvider` (a single `internal sealed` class living in
  `MMCA.Common.UI.Web`) via `AddCommonBlazorCsp` ahead of `AddCommonSecurityHeaders`. It pins
  `connect-src` to `'self'` plus the configured API/Gateway origin (https + wss, from the shared
  `ApiSettings`), adds `script-src 'self' 'wasm-unsafe-eval'`, `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: https:` and `font-src 'self'`, emits an opt-in `frame-src` when the host
  configures one, and **fails closed when that origin cannot
  be resolved or parsed**: `connect-src` narrows to `'self'` and the policy is still enforced, so a
  misconfiguration shows up immediately as blocked cross-origin calls in the browser console rather than
  as a header that is emitted but inert. Development loosens two directives, not one: `connect-src`
  gains `http://localhost:* ws://localhost:*` and `script-src` additionally gains `'unsafe-inline'`
  (Visual Studio Browser Link / Hot Reload injects an inline bootstrap script as well as opening a
  localhost WebSocket), and the second of those is not localhost-scoped. The 2026-09-19 revision below
  records the emitted policy directive by directive.
- **Adopted at both edges of both apps:** Store and ADC each wire `AddCommonSecurityHeaders` +
  `UseCommonSecurityHeaders` in their Gateway host and their UI web host, with the UI host also
  registering `BlazorCspPolicyProvider`. The middleware carries a unit test
  (`SecurityHeadersMiddlewareTests` in `MMCA.Common.Aspire.Tests`).

## Rationale
- **One hardened default, defined once.** Centralizing the header set removes per-host drift and makes a
  new edge host secure by default rather than by remembering to copy headers.
- **An extension point, because one CSP cannot fit all hosts.** The `ICspPolicyProvider` indirection is the minimum
  needed to let a Blazor host inject a runtime, origin-pinned policy while API/Gateway hosts keep the
  strict static one, without the framework guessing either app's origins.
- **A default that is complete and still Blazor-compatible.** The baseline carries `script-src` and
  `style-src` at the weakest strength a Blazor/MudBlazor host actually needs, so every directive is
  covered even for a host that never registers a provider, and the shared middleware is still never the
  thing that blanks out such a host. Tightening past that is an explicit act: configure the section or
  register a provider, both visible and testable.
- **Fail closed when a dynamic policy cannot be built.** A `connect-src` origin that cannot be resolved
  is a misconfiguration, so the policy keeps enforcing on the strictest value it can be sure of
  (`'self'`). The mistake surfaces as blocked cross-origin calls, which someone notices, instead of a
  Report-Only header that protects nothing.

## Trade-offs
- **The baseline is complete, not maximal.** Shipping a policy that works for a Blazor/MudBlazor host
  means the default carries `style-src 'unsafe-inline'` (MudBlazor injects styles at runtime), so inline
  styles are not blocked out of the box, and an API or Gateway host that serves no HTML inherits a
  script/style allowance it does not need. Either host tightens the string in the `"SecurityHeaders"`
  section or registers its own provider; the `{nonce}` placeholder is the supported path off
  `'unsafe-inline'`. The default is documented on `SecurityHeadersSettings.ContentSecurityPolicy`.
- **Registration order is a foot-gun.** Because the provider is registered with `TryAddSingleton`, a host
  must register its custom `ICspPolicyProvider` *before* `AddCommonSecurityHeaders`, or the static
  default wins silently.
- **A shared Blazor CSP provider constrains per-host divergence.** `BlazorCspPolicyProvider` now lives
  once in `MMCA.Common.UI.Web`, over the shared `ApiSettings` type, and both apps register it via
  `AddCommonBlazorCsp`, so the connect-src/origin logic is no longer copied per app. The remaining
  trade-off is that a host needing genuinely different CSP logic cannot edit an app-local class: it must
  supply its own `ICspPolicyProvider` (registered before `AddCommonSecurityHeaders`) instead.
- **Failing closed moves the pain onto a running app.** A Blazor host whose `ApiSettings` endpoint is
  wrong still serves pages, but the enforced `connect-src 'self'` blocks every cross-origin API call and
  the SignalR notification hub. That loud signal is the point (a security header that quietly stops
  being enforced is the worse failure mode), and the cost is that the configuration mistake lands on the
  users of that deployment rather than in a passive report.

## Revision (2026-09-07)
Two changes from the 2026-09-07 security review.

1. **Credential-carrying paths get a stricter referrer and cache posture.**
   `SecurityHeadersSettings.CredentialPathPrefixes`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs:46`) defaults to
   `["/reset-password", "/auth/oauth-complete"]`. `SecurityHeadersMiddleware` matches the request
   path against it (`:175`) and, on a hit, replaces the site-wide
   `strict-origin-when-cross-origin` with `no-referrer` (`:188`) and writes
   `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` (`:194`). Both pages carry a
   single-use secret in the URL: the reset token and the OAuth authorization code. `no-referrer`
   keeps that URL out of the `Referer` header of every asset and outbound link the page loads, and
   `no-store` keeps the rendered page out of the browser's back/forward cache and out of any shared
   proxy. The list is a settings property rather than a constant so an app that mounts these flows on
   its own routes can name them.
2. **The UI origin emits its own HSTS.** These headers used to be a gateway responsibility, which
   left a server-rendered HTML origin behind a different ingress with none (SEC-ADC-18 /
   SEC-Store-27). ADC's Blazor host registers the middleware
   (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:111`) and runs `UseForwardedHeaders` with
   `XForwardedFor | XForwardedProto | XForwardedHost` (`:128-134`) ahead of it, which is what makes
   `Request.IsHttps` true behind a container ingress that terminates TLS: without that step the host
   sees plain HTTP on port 8080, `UseHttpsRedirection` (`:153`) is inert and no
   `Strict-Transport-Security` is emitted (`:137`). The forwarded-headers options mirror the gateway
   and the service pipeline exactly, so all three hosts agree on what they trust
   (`:121-122`). Store's storefront host carries the same posture with a conformance test beside it
   (`MMCA.Store/Tests/Hosts/MMCA.Store.UI.Web.Tests/SecurityHeadersTests.cs`), closing the gap where
   only the JSON gateway was pinned by a test.

## Revision (2026-09-10)

**Both UI origins are now pinned by a test, not just Store's.** ADC has
`MMCA.ADC/Tests/Hosts/MMCA.ADC.UI.Web.Tests/SecurityHeadersTests.cs:17-18`, a one-line subclass of
the framework's `SecurityHeadersTestsBase`
(`MMCA.Common/Source/Hosting/MMCA.Common.Testing/Conformance/SecurityHeadersTestsBase.cs:16`) over a
`ConferenceUiHostApplicationFactory` that boots the real Blazor host Production-pinned
(`MMCA.ADC/Tests/Hosts/MMCA.ADC.UI.Web.Tests/ConferenceUiHostApplicationFactory.cs:17`, deriving
`ProductionHostApplicationFactory<Program>`). Production-pinned is what makes the assertion mean
anything here, because `Strict-Transport-Security` is emitted on that environment and not in
Development. The shape matches Store's exactly
(`MMCA.Store/Tests/Hosts/MMCA.Store.UI.Web.Tests/SecurityHeadersTests.cs:17-18`).

The test project is in the no-database CI filter (`MMCA.ADC/MMCA.ADC.CI.slnf:61`, the same place
Store's sits at `MMCA.Store/MMCA.Store.CI.slnf:55`), so the guard runs on every pull request rather
than existing and never being executed. That is the whole difference between a conformance suite that
is adopted and one that is merely present: item 2 above records the UI origin emitting its own HSTS,
and a host-level test in the gating tier is what keeps a later pipeline edit from quietly undoing it.

## Revision (2026-09-19)

**The Blazor policy is wider than the Decision above recorded, and the UI host's forwarded-headers
options clear their allow-lists on purpose.** The provider is no longer the copy that was hoisted out
of the two app hosts: it now takes `IOptions<BlazorCspSettings>` alongside `ApiSettings`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:33-40`), so
"identical to the app-local copies" is history and the emitted string is what follows.

1. **The full policy it emits.** `BuildPolicy` (`.../Security/BlazorCspPolicyProvider.cs:103-113`)
   concatenates, in order: `default-src 'self'` (`:104`), `script-src 'self' 'wasm-unsafe-eval'`
   (`:105`), `style-src 'self' 'unsafe-inline'` (`:106`), `img-src 'self' data: https:` (`:107`),
   `font-src 'self'` (`:108`), the computed `connect-src` (`:109`), an optional `frame-src` (`:110`),
   then `base-uri 'self'`, `form-action 'self'` and `frame-ancestors 'none'` (`:111-113`). `img-src`
   is open to any https source on purpose, because profile pictures and content images come from
   arbitrary external hosts, while the directives that matter for exfiltration (`script-src` and
   `connect-src`) stay pinned (`:99-102`). Two differences from the static baseline in the Decision
   above are worth stating: this policy adds `img-src` and `font-src`, and it carries no `object-src`
   directive at all, so objects fall back to `default-src 'self'` rather than the baseline's explicit
   `object-src 'none'`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Security/SecurityHeaders.cs:65-67`).
2. **Development loosens `script-src`, not just localhost `connect-src`.** On `IsDevelopment` the
   provider appends `http://localhost:* ws://localhost:*` to `connect-src` (`:74-77`) and
   `'unsafe-inline'` to `script-src` (`:105`). Only the first is localhost-scoped; the second is a
   blanket inline-script allowance for that environment. Both exist for Visual Studio's Browser Link
   and Hot Reload, which inject an inline bootstrap script and open a WebSocket on a port that changes
   every run (`:70-73`). Neither reaches a non-Development host, because the flag is
   `IWebHostEnvironment.IsDevelopment()` read once at construction (`:41`).
3. **`frame-src` is opt-in and startup-validated.** The directive is emitted only when
   `BlazorCspSettings.FrameSources`
   (`.../Security/BlazorCspSettings.cs:35`, bound from the `"BlazorCsp"` configuration section,
   `:21`) lists at least one origin, as `frame-src 'self' <origins>` (`:85-97`); with the default
   empty list there is no `frame-src` at all and frames fall back to `default-src 'self'`, leaving the
   policy unchanged. Each entry must be a plain absolute https origin: `BlazorCspSettingsValidator`
   (`.../Security/BlazorCspSettingsValidator.cs:40-56`) refuses a wildcard, quote, semicolon, comma,
   whitespace, user info, query, fragment or non-root path (`:19`), and `AddCommonBlazorCsp` registers
   it with `ValidateOnStart`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:52-60`), so a bad entry
   fails the boot with a message naming it instead of being spliced verbatim into a security response
   header. Validated entries are canonicalized and de-duplicated before the splice (`:91-96`). This
   governs only what the host may frame: `frame-ancestors 'none'` is never relaxed by this path.
4. **The forwarded-headers allow-lists are cleared deliberately.** Item 2 of the 2026-09-07 revision
   records that the UI host's options mirror the gateway and the service pipeline
   (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:173-176`). What it leaves out is
   load-bearing: `KnownProxies` and `KnownIPNetworks` are both cleared before the middleware is added
   (`:184-185`), because a cloud reverse proxy fronts the app from internal addresses that are in
   neither default list, and leaving the defaults in place makes `UseForwardedHeaders` ignore every
   forwarded header it receives (`:177-179`). Populated allow-lists therefore make the whole
   2026-09-07 fix inert: `Request.IsHttps` stays false behind the ingress and no
   `Strict-Transport-Security` is emitted.

## Related
ADR-019 (rate limiting, the other always-on edge protection living in the same Aspire layer), ADR-022
(browser session-cookie auth, the other browser-edge security control), ADR-008 (the gateway topology
whose Gateway and UI hosts are where these headers are stamped).
