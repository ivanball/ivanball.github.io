# ADR-136: Installable Web App Through a Framework Service Worker That Never Caches a Page

## Status
Accepted (2026-10-27). Revised 2026-10-28: the session-cookie and CSP constraints are scoped to
ADC and Store (Helpdesk renders `InteractiveServer` with no session cookie and no CSP), navigations
are stated to pass through the worker with their cookie, the cache gate is described as the text
check it is, and the lock-file growth is measured.

## Context
The Blazor Web hosts (ADC, Store and Helpdesk) can be added to a phone home screen or installed as a
desktop app only if they ship a web app manifest and, for an offline page, a service worker. A
native Windows head was weighed first and rejected (see Alternatives); the cheaper route to "an app
on the desktop" is the web app every consumer already runs.

Three properties of the hosts constrain how a service worker may behave:

- **Server-rendered pages carry the signed-in user's data.** Every host prerenders its first page
  load on the server. ADC and Store render with `InteractiveAuto` outside their E2E runs
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Components/App.razor:80`,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Components/App.razor:49`) and prerender under the
  HttpOnly session cookie ([ADR-022](022-browser-session-cookie-auth.md);
  `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/DependencyInjection.cs:27`, registered at
  `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:157` and
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:149`). Helpdesk renders
  `InteractiveServer` (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Components/App.razor:27`)
  and registers no session cookie, but a generated app that adds sign-in inherits the same risk. A
  worker that cached navigations would hand one user's prerendered page to whoever opens the app
  next on that device, and would keep showing a signed-out user their old pages.
- **The CSP forbids inline script in production on ADC and Store.** `BlazorCspPolicyProvider` emits
  `default-src 'self'` and `script-src 'self' 'wasm-unsafe-eval'`, adding `'unsafe-inline'` in
  Development only (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:103`),
  and both hosts register it (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:201`,
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:192`). Helpdesk registers no CSP. A
  same-origin manifest and worker fall under `default-src 'self'`, but the registration call
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
2. **The worker handles GET navigations only** and never caches a page or response other than the
   precached offline page (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Pwa/service-worker.js:39`,
   `service-worker.js:16`). Each navigation goes to the network, with navigation preload enabled so
   routing it through the worker adds no latency (`service-worker.js:30`). When the network fails,
   the worker answers with the offline page it precached at install,
   `/_content/MMCA.Common.UI.Web/offline.html` (`service-worker.js:11`), a self-contained page with
   no script. API calls, Blazor circuit negotiation, `/hubs` and `_framework` files reach the
   worker's fetch handler but are not handled: it returns without responding, so the browser
   fetches them as usual (`service-worker.js:37-41`). A navigation request is handled, cookie
   included, and is answered from the preload or forwarded by `fetch(request)`
   (`service-worker.js:46`); the worker script cannot read the HttpOnly cookie. Activation deletes
   every earlier version's offline cache (`service-worker.js:24`).
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
on the script text that the worker handles GET navigations only and contains no `cache.put(` or
`cache.addAll(` call
(`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Web.Tests/Pwa/ServiceWorkerEndpointTests.cs:45-47`).
That text check is narrower than the never-cache rule: a cache write of another shape (for example
`cache.add(` of a navigation) passes it, so review of `service-worker.js` holds the rest. The
Gallery host maps the worker and loads the register script, so the whole UI E2E suite
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
- **The Gallery references MMCA.Common.UI.Web**
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/MMCA.Common.UI.Gallery.csproj:16`), which
  grows the Gallery and E2E lock files (in the v1.264.0 release commit, which also carried dependency
  bumps, from 194 to 1170 and from 882 to 2063 lines) and adds build time to the `ui-e2e` jobs.

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

## Revision (2026-10-28)
Re-verified against current source. The mechanism is unchanged: the endpoint, the worker, the
register script, the kill switch and the host-owned identity read as written. What moved is the
scope of two Context constraints, two loose statements, and one measured trade-off.

1. **Session cookie and render mode are ADC and Store properties.** ADC and Store render
   `InteractiveAuto` outside their E2E runs (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Components/App.razor:80`,
   `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Components/App.razor:49`) and register the cookie
   token storage (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:157`,
   `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:149`). Helpdesk renders
   `InteractiveServer` (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Components/App.razor:27`,
   `MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Program.cs:85`) and registers no session
   cookie. All three still prerender, so the never-cache rule applies to every host.
2. **The CSP constraint is an ADC and Store property.** Both register `AddCommonBlazorCsp()`
   (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:201`,
   `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:192`); Helpdesk registers no CSP. The
   policy text itself is unchanged
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Security/BlazorCspPolicyProvider.cs:103`).
3. **Navigations pass through the worker with their cookie.** Only non-navigation requests skip it
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Pwa/service-worker.js:39`); a GET
   navigation is answered from the preload or forwarded by `fetch(request)` (`service-worker.js:46`).
   Decision item 2 no longer lists cookies among what never passes through.
4. **The cache gate is a text check.** `ServiceWorkerEndpointTests` asserts the script contains no
   `cache.put(` and no `cache.addAll(`
   (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Web.Tests/Pwa/ServiceWorkerEndpointTests.cs:46-47`),
   which is narrower than "never puts a response in a cache"; the Gates paragraph now says so.
5. **Lock-file growth measured.** Across the v1.264.0 release commit the Gallery lock file went from
   194 to 1170 lines and the E2E lock file from 882 to 2063 lines; that commit also bundled
   dependency bumps, so not all of it comes from the
   `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/MMCA.Common.UI.Gallery.csproj:16`
   reference. The Trade-offs bullet replaces "roughly doubles" with the measured figures.
6. Anchors re-verified against current source: `DependencyInjection.cs:26` -> `:27` (the HttpOnly
   session cookie remark); `service-worker.js:39`, `:30`, `:11`, `:24` and
   `BlazorCspPolicyProvider.cs:103` unchanged.
