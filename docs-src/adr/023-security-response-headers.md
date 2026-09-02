# ADR-023: Centralized Security-Response-Headers Middleware with a Pluggable CSP

## Status
Accepted (2026-07-02). Revised 2026-09-01 (the static default is now a complete hardened baseline: it
ships `script-src 'self' 'wasm-unsafe-eval'` and `style-src 'self' 'unsafe-inline'` instead of omitting
both directives; `BlazorCspPolicyProvider` fails closed on an API/Gateway origin it cannot resolve,
narrowing `connect-src` to `'self'` while staying enforced, rather than degrading to a permissive
Report-Only policy; the middleware also substitutes a per-request nonce for a `{nonce}` token in the
resolved policy).

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
  one shared `BlazorCspPolicyProvider` (a single `internal sealed` class hoisted into
  `MMCA.Common.UI.Web`, byte-identical to the copies the app hosts formerly carried) via
  `AddCommonBlazorCsp` ahead of `AddCommonSecurityHeaders`. It pins `connect-src` to `'self'` plus the
  configured API/Gateway origin (https + wss, from the shared `ApiSettings`), adds `script-src 'self'
  'wasm-unsafe-eval'` and `style-src 'self' 'unsafe-inline'`, and **fails closed when that origin cannot
  be resolved or parsed**: `connect-src` narrows to `'self'` and the policy is still enforced, so a
  misconfiguration shows up immediately as blocked cross-origin calls in the browser console rather than
  as a header that is emitted but inert. It loosens the policy for localhost only in Development (Visual
  Studio Browser Link / Hot Reload).
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

## Related
ADR-019 (rate limiting, the other always-on edge protection living in the same Aspire layer), ADR-022
(browser session-cookie auth, the other browser-edge security control), ADR-008 (the gateway topology
whose Gateway and UI hosts are where these headers are stamped).
