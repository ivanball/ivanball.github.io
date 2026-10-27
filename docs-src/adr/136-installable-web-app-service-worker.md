# ADR-136: Installable Web App Through a Framework Service Worker That Never Caches a Page

## Status
Accepted (2026-10-27).

## Context
The Blazor Web hosts (ADC, Store and Helpdesk) can be added to a phone home screen or installed as a
desktop app only if they ship a web app manifest and, for an offline page, a service worker. A
native Windows head was weighed first and rejected (see Alternatives); the cheaper route to "an app
on the desktop" is the web app every consumer already runs.

Three properties of the hosts constrain how a service worker may behave:

- **Server-rendered pages carry the signed-in user's data.** The hosts render with
  `InteractiveAuto`, so every first page load is prerendered on the server under the HttpOnly session
  cookie ([ADR-022](022-browser-session-cookie-auth.md);
  `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:26`). A worker that
  cached navigations would hand one user's prerendered page to whoever opens the app next on that
  device, and would keep showing a signed-out user their old pages.
- **The CSP forbids inline script in production.** `BlazorCspPolicyProvider` emits
  `default-src 'self'` and `script-src 'self' 'wasm-unsafe-eval'`, adding `'unsafe-inline'` in
  Development only (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:103`).
  A same-origin manifest and worker fall under `default-src 'self'`, but the registration call
  cannot be an inline `<script>`.
- **A worker's scope is capped at its script's folder.** A script shipped as a Razor class library
  static asset is served from `/_content/<package>/`, which could control only that folder, not the
  site.

The host's Home page Web Vitals budgets are deploy-gating, so registration must not compete with
first paint.

## Decision
MMCA.Common.UI.Web ships the mechanism; each host supplies its own identity.

1. **`app.MapCommonServiceWorker()`** maps `GET /service-worker.js` at the site root, anonymous,
   excluded from the OpenAPI description and served with `Cache-Control: no-cache`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Pwa/ServiceWorkerEndpointExtensions.cs:58`).
   The script is an embedded resource, and the endpoint writes the package's informational version
   into it, so every framework release is a byte change the browser installs on its next update
   check.
2. **The worker handles GET navigations only** and never caches a page or a response
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Pwa/service-worker.js:39`). Each navigation
   goes to the network, with navigation preload enabled so routing it through the worker adds no
   latency (`service-worker.js:30`). When the network fails, the worker answers with the offline
   page it precached at install, `/_content/MMCA.Common.UI.Web/offline.html` (`service-worker.js:11`),
   a self-contained page with no script. API calls, the Blazor circuit, `/hubs`, `_framework` files
   and cookies never pass through it. Activation deletes every earlier version's offline cache
   (`service-worker.js:24`).
3. **`_content/MMCA.Common.UI.Web/pwa-register.js`** registers the worker with scope `/` after the
   page `load` event, in a secure context only
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/wwwroot/pwa-register.js:5`). It is a file,
   not inline script, because of the CSP.
4. **Kill switch.** `Pwa:ServiceWorker:Enabled=false` (`ServiceWorkerEndpointExtensions.cs:24`)
   serves a retired worker with no fetch handler that deletes the offline cache. Because the script
   is never cached, every installed client takes it on its next navigation, so a bad worker is
   retired by configuration rather than by a release.
5. **The host owns the identity**: `wwwroot/manifest.webmanifest` (name, short name, colours,
   `display: standalone`, 192, 512 and maskable 512 icons), an Apple touch icon, the `theme-color`
   meta, the manifest link, and the register script tag in `App.razor`. ADC uses its phone app's teal
   `#0D7377` and icon; Store uses a C.A.S.A monogram on its petal app-bar pink `#FCA9B1`; Helpdesk,
   as the template source, ships a placeholder icon and names itself only by its source name, so a
   generated app is renamed with it.

No CSP change and no rate-limiter change is needed: the CSP already allows a same-origin manifest
and worker, and the UI limiter already exempts any path whose last segment carries a file extension
(`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hardening/UiRateLimitingExtensions.cs:104`).

**Gates.** `ServiceWorkerEndpointTests` (MMCA.Common.UI.Web.Tests) pins the content type, the
no-cache header, the version stamp, the retired worker and the anonymous endpoint metadata, and pins
on the script text that the worker handles GET navigations only and never puts a response in a
cache. The Gallery host maps the worker and loads the register script, so the whole UI E2E suite
(chromium, firefox, webkit) runs with it installed; `ServiceWorkerE2ETests` asserts registration at
the site root on every engine and the offline page on Chromium.

## Rationale
Caching nothing but the offline page is the only policy that is safe without per-page reasoning:
whether a page carries user data depends on the page and the user's state, and getting that wrong
leaks data across sign-ins on a shared device. Installability and a branded offline page are the
whole user-visible value of this wave, and both need only a precached static page.

Putting the worker in the framework keeps the one dangerous rule (never cache a navigation) in one
reviewed place for every host, where a per-app copy would drift. Serving it from an endpoint rather
than as a static file solves the scope cap and the update problem together. The kill switch exists
because a service worker is the one deployed artifact that outlives a rollback on the visitor's
device.

## Trade-offs
- **No offline content.** An installed app shows the offline page for every navigation while
  offline, including pages the visitor just saw. ADC's phone app already caches locally
  (`MauiLocalCacheStore`) for the conference floor.
- **One extra request per update check**, and every GET navigation passes through the worker
  (mitigated by navigation preload).
- **The offline page is English-only** and generic: it cannot load the app's localized resources
  while offline.
- **iOS keeps a home-screen web app's storage separate from Safari**, so a visitor signs in once
  more after adding it to the home screen.
- **The Gallery now references MMCA.Common.UI.Web**, which roughly doubles the Gallery and E2E lock
  files and adds build time to the `ui-e2e` jobs.

## Alternatives rejected
- **A native Windows desktop head (MAUI WinUI), weighed 2026-10-26.** The MAUI head already compiles
  for `net10.0-windows10.0.19041.0`, but shipping it means MSIX packaging and signing, a WNS push
  provider, Windows Hello and a Windows OAuth flow for one consumer, all to duplicate the web UI.
  Revisit if a consumer needs offline-first data or OS integration a browser cannot provide.
- **Caching static assets or pages in the worker (cache-first or stale-while-revalidate), weighed
  2026-10-26.** The framework's fingerprinted static assets are already immutable in the HTTP cache,
  so a worker cache adds a second source of truth for no speed gain, and caching navigations leaks
  prerendered user data. Revisit only with a design that keys cached pages on the signed-out state
  and purges on sign-in and sign-out.
- **A static `service-worker.js` in each host's `wwwroot`.** It would put the never-cache rule in
  three copies and need a manual version bump to update installed clients.
- **A generated manifest endpoint bound from configuration.** The manifest is about twenty lines of
  app identity that changes almost never; a static file per host is simpler than an options class,
  a validator and an endpoint.
- **Web push for installed apps.** Out of scope for this wave: it needs VAPID keys and a new sender
  beside ADR-044's native push.

## Consequences
- Consumers adopt with one `Program.cs` line, two `App.razor` link tags plus the theme colour, one
  script tag, a manifest and four icons; MMCA.Common 1.264.0 ships the framework half.
- Changing the worker means editing `Pwa/service-worker.js` and keeping
  `ServiceWorkerEndpointTests`' script assertions true; any change that caches a response must
  revise this ADR first.
- To retire the worker in an emergency, set `Pwa:ServiceWorker:Enabled=false` on the UI host and
  restart it; installed clients pick up the retired worker on their next navigation.
