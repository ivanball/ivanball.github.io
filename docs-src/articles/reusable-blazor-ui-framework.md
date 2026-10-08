# A list page in a few lines: a reusable Blazor UI framework with the same discipline as the backend

> Series: MMCA.Common · Article #37 (deep-dive) · Pillar P2,P5 · Group G15 · Rubric §18,§19,§20,§22,§23 · ADR-056 · ADR-067 ·
> Status: grounded in `MMCA.Common/Source/Presentation/MMCA.Common.UI` (v1.233.0 source),
> `Website/docs-src/onboarding/group-15-common-ui-framework.md`, `group-25-adc-host-composition.md`. No em dashes.

**Subtitle:** This series has been backend all the way down. But the front end is where DRY usually goes to die: every list screen re-implements paging, sort, filter, loading, and teardown. Here is the same ports-and-base-classes discipline, applied to Blazor, so a list page is a few lines instead of a few hundred.

---

Count the list screens in any line-of-business app. Products. Orders. Users. Sessions. Speakers. Now look at what each one actually does: fetch one page of rows from an API, render them in a grid, let the user sort a column, type a filter, flip to the next page, and show a spinner while it loads. That is the same screen, over and over, wearing different column headers.

So why does each one usually carry its own copy of the plumbing? Because the plumbing is annoying. Server-side paging means turning a grid's sort-and-filter state into a query string. Loading state means a flag and a try/catch. Cancellation means a `CancellationTokenSource` you have to dispose without racing the next request. And in modern Blazor there is a render-mode twist on top: the page renders statically on the server, then again as an interactive Server circuit, then again in WebAssembly, and a naive page re-fetches at every transition and flashes an empty grid in between.

Almost everyone writes that plumbing once, copies it to the second screen, and by the fifth screen the copies have quietly diverged. One page disposes its token source correctly and one does not. One persists filters to the URL and one loses them on a back-button press. The bugs are per-page because the code is per-page.

The backend half of this series kept making one move: a cross-cutting concern does not belong in the use case, it belongs in a base class or a pipeline. `MMCA.Common.UI` makes exactly that move on the front end. The result is a Blazor presentation package where a concrete list page declares its title and its data call, and inherits everything else.

## The package that is allowed to depend on almost nothing

One structural fact sets the tone. `MMCA.Common.UI` is allowed to reference `MMCA.Common.Shared` and nothing else. Not Application, not Domain, not Infrastructure. That is a deliberate Clean Architecture constraint, and it has a hard technical reason: the package has to compile into a Blazor WebAssembly bundle that runs in the browser, where it cannot drag EF Core or your database adapters along.

That constraint is what forces the design to be honest. The UI cannot reach into a repository or call a handler directly, so it has to talk to the backend through a contract over HTTP, binding to DTOs and interfaces it shares with the API, never to server internals. The same dependency rule that protects the domain protects the browser bundle. Ports in, adapters at the edge, all the way out to the screen.

## DataGridListPageBase: the screen you stop rewriting

The centerpiece is an abstract Blazor component, `DataGridListPageBase<TDto>`. Every server-paged list screen in every consumer app derives from it. It folds into one reusable place the concerns that were otherwise copy-pasted onto each page: server-side paging against MudBlazor's `MudDataGrid<T>`, the `CancellationTokenSource` lifecycle, the loading flag, extracting filter and sort out of MudBlazor's `GridState<T>`, surfacing errors through the framework's own `IToastService`, viewport-driven mobile-versus-desktop rendering, and a careful `IAsyncDisposable` / `IDisposable` teardown.

Because all of that lives in the base, a concrete page is tiny. It supplies a `Title`, hands the base its grid reference, points the grid's `ServerData` at a one-expression method that passes the inherited load method its data call, and declares its columns in markup. That is the whole page. It does not write a query string, does not manage a token source, does not branch on screen size, and does not handle its own disposal.

```razor
@inherits DataGridListPageBase<ProductDto>
@page "/products"
@inject IEntityService<ProductDto, int> ProductService

<MudDataGrid T="ProductDto" @ref="_dataGrid"
             ServerData="LoadServerData" Loading="IsLoading"
             Filterable="true" SortMode="SortMode.Multiple">
    <Columns>
        <PropertyColumn Property="x => x.Name" Title="Name" />
        <PropertyColumn Property="x => x.Price" Title="Price" />
    </Columns>
</MudDataGrid>

@code {
    private MudDataGrid<ProductDto>? _dataGrid;
    protected override MudDataGrid<ProductDto>? GridRef => _dataGrid;

    private Task<GridData<ProductDto>> LoadServerData(GridState<ProductDto> state, CancellationToken cancellationToken)
        => LoadServerDataAsync(
            state,
            (filters, page, size, sortCol, sortDir, ct)
                => ProductService.GetPagedAsync(filters, page, size, sortCol, sortDir, cancellationToken: ct));
}
```

The single inherited method doing the work, `LoadServerDataAsync`, is the heart of the desktop path. It resets the cancellation source, extracts filters and sort from the `GridState<TDto>` MudBlazor hands it, runs the fetch, and maps a cancellation, an exception, or a failed `Result` to an empty grid plus a toast (the cancellation toast is optional) instead of an unhandled error, raising a `LoadFailed` flag on a failure. Overlapping calls end on the newest one: a load superseded by a later call answers with that later call's rows, so a slow stale fetch can never overwrite fresher data. Paging is genuinely server-side: only the requested page is fetched, never the whole table.

Two of the gnarliest details in this base are battle scars, and they are the best argument for consolidating. The first is a MudDataGrid v9 quirk: a parameter setter that clobbers the current page, worked around in one place by re-restoring the page after a rows-per-page reset. The second is a disposed-token-source race, where a debounced reload firing after the component disposed threw `ObjectDisposedException` and left the `blazor-error-ui` banner stuck onto the next page. Both were found through end-to-end tests, both were fixed once, and because the fix lives in the base, every list page got it for free. That is the entire thesis in one observation: when the concern is in one place, so is the fix.

## The same page on a phone, without a second page

The desktop path above is only half of what `DataGridListPageBase` does, because a data grid is the
wrong control on a 390px screen and no amount of CSS fixes that. The base handles this by swapping the
control rather than restyling it, and the switch is a real subscription, not a one-time media query.

The base injects MudBlazor's `IBrowserViewportService` and reacts to viewport changes:

```csharp
var wasMobile = IsMobile;
IsMobile = BreakpointConstants.IsMobileBreakpoint(browserViewportEventArgs.Breakpoint);

if (IsMobile && !wasMobile)
{
    MobileCurrentPage = 1;
    await OnMobileDataRequestedAsync();
}
```

`IsMobileBreakpoint` is the single place the threshold is defined, `Xs or Sm`, which is below 960px.
That matters more than it looks: a breakpoint constant duplicated across twenty components is a
guarantee that some of them will disagree after the first redesign.

The `wasMobile` comparison is the part worth stealing. It only refetches on a genuine **crossing** of
the boundary, not on every resize event, and it resets to page 1 when it crosses, because a user who
was on page 7 of a desktop grid has no meaningful page 7 in an infinite-scroll list. Getting this
wrong produces either a refetch storm while someone drags a window, or a mobile list that opens
scrolled into the middle of nowhere.

On the mobile side the grid is replaced by `MobileInfiniteScrollList`, which carries a defense the
desktop grid gets for free from paging:

```csharp
[Parameter] public int MaxRenderedItems { get; set; } = 500;

// Keep fetching only while the last page added something new, more rows exist, and the
// rendered-item cap is not reached, so the DOM (and memory) stay bounded.
private bool HasMoreAfter(int appended) =>
    appended > 0 && _items.Count < _totalCount && _items.Count < MaxRenderedItems;
```

Infinite scroll has an obvious failure mode that is easy to ship without noticing: it is unbounded by
construction, so a 40,000-row result set becomes 40,000 DOM nodes on the least capable device you
support. The cap makes "there is more data" and "we will keep rendering it" two different questions,
and answers the second one no. The `appended > 0` term closes a quieter loop: a page that added
nothing new (an empty page, or a window shifted by a whole page) stops the list instead of having the
re-observed sentinel request the same page forever.

Note what is *not* here: there is no separate mobile app, no duplicated page, and no parallel route
tree. One page class serves both layouts, which is why the responsive behavior is verifiable at all.
The three-engine E2E matrix (chromium, firefox, and webkit, all blocking merge gates) exercises the
same pages rather than a mobile-specific build that could drift.

## The data-access boundary: bind to an interface, never to HttpClient

A page in this framework never injects a raw `HttpClient`. It injects `IEntityService<TEntityDTO, TIdentifierType>`, a generic CRUD contract: `GetAllAsync`, `GetPagedAsync`, `GetByIdAsync`, `AddAsync`, `UpdateAsync`, `DeleteAsync`, plus a `GetAllForLookupAsync` for dropdowns. Every member returns a `Result`, the same railway type the server produced. `GetPagedAsync` returns a `Result` wrapping an `(Items, TotalItems)` tuple shaped exactly for a server-side grid, and a missing entity from `GetByIdAsync` is a `NotFound` failure, never a success carrying null. A page branches on the outcome instead of catching an exception.

The behavior behind that interface comes from an abstract base, `EntityServiceBase<TEntityDTO, TIdentifierType>`. A concrete module service is mostly an endpoint string. Every verb routes through one dispatch chokepoint, `SendRequestAsync`, so retry, auth, and error handling are applied identically to every call. The error handling is the subtle, valuable part: the call runs through an `HttpResultExecutor` that turns transport faults into failures, and every response is read through a `ProblemDetailsResultReader` that rebuilds the server's structured Problem Details payload (a domain failure, a validation failure) as a `Result` with its original `ErrorType` intact. The base states the rule in source: nothing in it throws for a server answer, and the only exception that escapes is the caller's own cancellation. A backend `Result.Failure` therefore surfaces to the page as the server's real message and error type, not a generic "server error."

`EntityServiceBase` derives in turn from `AuthenticatedServiceBase`, which owns the two cross-cutting concerns of any outbound API call. One is a Polly retry policy: three retries with exponential backoff (2, 4, and 8 seconds plus up to a second of jitter) on `HttpRequestException` or a retryable status, meaning any 5xx except the permanent 501 and 505, plus 408 and 429, with each retried response disposed so a sustained outage does not leak connections. A status is retried only when re-sending is safe: GET, PUT, DELETE and the other idempotent verbs always are, while a POST or PATCH is retried only when its request carried an `Idempotency-Key` the server deduplicates on, because without one a retried create is a second request. The other is stamping the JWT bearer token onto a freshly created `"APIClient"` `HttpClient` from `IHttpClientFactory`. That base exists for a precise Blazor Server reason, documented in source: `IHttpClientFactory` builds its handler chain in a separate DI scope from the Blazor circuit, so the conventional delegating handler cannot reach the circuit-scoped storage that holds the in-memory access token. Reading the token directly and setting the header on a fresh client is the smallest correct fix for that scope mismatch.

The shape is the same one the backend uses for everything: an interface the consumer programs against, a base class that carries the 80 percent, and a composition root that wires the transport. The UI is just another consumer of ports.

## Theming: one set of tokens, guarded by a fitness test

Visual consistency lives in one static `MudTheme`, exposed as `MMCATheme.Instance` and handed to `MudThemeProvider` by a shared component, `MmcaThemeProviders`, that a root layout drops in as a single tag. It defines a light palette, a dark palette, an Inter typography scale, and a 6px border radius.

That default is not a lock-in. `MmcaThemeProviders` takes an optional `Theme` parameter that defaults to `MMCATheme.Instance`, so an app with its own brand passes a derived `MudTheme` in one attribute instead of forking the provider block and re-implementing the day/dark lifecycle wired behind it. Two honest limits. The override reaches MudBlazor's own components and stops there: the raw CSS rules in `app.css` read their colors from `--mmca-*` custom properties whose literal hex mirrors `BrandColors`, so a host that swaps the theme object and nothing else gets rebranded Mud components sitting on framework-colored stylesheet rules. And the extension point is unexercised: every root layout across these repos renders `<MmcaThemeProviders />` bare, so "one theme everywhere" is the observed state rather than an enforced one.

The interesting move is what feeds it. The palette is a single C# source of truth, `BrandColors`: 37 `const` hex values, the six brand colors (a primary and a secondary, each with a darkened and lightened variant) plus the shared chrome, light-palette, and dark-palette values, so every hex value in both `MMCATheme` palettes is one of its constants. The catch is that raw CSS rules in `app.css` need the brand colors as custom properties, so those exist twice: once in C# for MudBlazor, once in CSS for stylesheet rules. That is a textbook drift hazard. The codebase neutralizes it with a fitness test, `BrandColorTokenTests`, which parses `app.css` and asserts each brand CSS token equals its `BrandColors` constant. If the two drift, the build fails before it ships.

This is the same "executable governance" idea the backend uses to enforce its layer rules: an invariant that matters is enforced by a test, not by hope and code review. And the color choices themselves carry accessibility reasoning. The theme's `Secondary` color is Teal 700 (around 5.3:1 on light surfaces) rather than Teal 600 (around 4.0:1, below the WCAG AA 4.5:1 floor for normal text), with the contrast calculation written into the source comment, because that color drives muted helper text.

The typography half of the theme has a quieter version of the same duplication problem. `MMCATheme` names `Inter` first in its font stack and `app.css` names it again on `html, body`, and with no faces shipped the stack would silently fall through to Segoe UI on Windows and to a generic sans-serif everywhere else: "professional typography" declared in two files and rendered in neither. So the package vendors the font rather than linking it: five latin-subset `woff2` files (weights 400 through 800, about 24 KB each) live under the package's `wwwroot/fonts` with their SIL OFL license, declared by five `@font-face` blocks at the top of `app.css` and served same-origin from `_content/MMCA.Common.UI/fonts/`. Two details there are deliberate. Self-hosting fits the host's existing `font-src 'self'` content-security policy with no CDN allowance to add, which is the kind of default worth taking when the alternative is loosening a header. And `font-display: swap` keeps first paint on the fallback face instead of blocking text, which is exactly what the LCP and FCP budgets in the Web Vitals E2E suite are watching. The cost is honest: roughly 120 KB of font in the package, latin glyphs only, and a family name that exists in two places with a comment in each asking you to keep them in step.

## Render-mode state persistence: no flash, no double fetch

Modern Blazor's `InteractiveAuto` renders a page up to three times: static SSR, then interactive Server, then WASM. Naively, each transition re-runs the data fetch, and the user sees a grid populate, blank, and re-populate. `DataGridListPageBase` solves this with Blazor's `PersistentComponentState`.

During the SSR pre-render pass, the base serializes the grid's already-fetched rows into a tiny private record, `PersistedGridState`, a `(List<TDto> Items, int TotalItems)` payload embedded in the pre-rendered HTML. On the first interactive `ServerData` call, the base takes that payload back out and returns it directly, skipping the round-trip entirely. The fetch-cancel-refetch flicker of the render-mode handoff disappears.

Navigation state is handled with a complementary principle: the URL is the source of truth. Paging, sort, and filter live in the query string (terse keys like `p`, `ps`, `s`, `sd`, `f:<name>`), so deep links and browser back-and-forward replay a list view exactly. A companion service codes state into and out of the address bar, emitting a key only when it differs from the default so a pristine list page yields a clean query-less URL, and using replace-history rather than push so each filter keystroke does not pollute the back stack. The noisier scroll position lives in a per-circuit `ListPageStateService` backed by an in-memory dictionary that mirrors through `sessionStorage`, so state survives circuit teardown, force-load navigations, and the SSR-to-WASM transition. URL plus memory plus session plus the prerender cache cover the full matrix of how a user can leave a list and come back to it.

## Component lifetime: a token that cannot throw, a load that cannot land late

Two more state failures belong to a component's lifetime rather than to any one fetch, and the package closes both once.

The first is teardown. A component owns a `CancellationTokenSource` that its `Dispose` cancels and disposes, and every awaited call takes its token. Reading `Token` off a disposed source throws `ObjectDisposedException`, so a load or handler that resumes after the user navigated away crashes the circuit instead of stopping. The extension `ComponentLifetimeExtensions.LifetimeToken` returns the live token while the source is live, and an already-cancelled token once the source is cancelled, disposed, or was never created, so late work ends through its ordinary `OperationCanceledException` path. `DataGridListPageBase` links every fetch to it, `DetailPageBase` exposes it as `PageToken`, and the package's own notification, session and role-admin pages pass `_cts.LifetimeToken()` to each call. A convention like that decays unless something checks it, so it is a fitness rule: `LifetimeTokenConventionTestsBase`, subclassed in each repo, fails on any direct `_cts.Token` read under the component root, and fails too when the scan reaches fewer code-behind files than expected, so a moved folder cannot turn the gate vacuous.

The second is ordering. Blazor reuses a routed component instance across route-parameter changes, so a page that opens entity 100 (slow) and then 101 (fast) receives 100's answer after 101 has rendered, and an unconditional assignment leaves the URL on 101 while the page holds 100. `LatestLoadGuard` gives each load a generation and a token, cancelling the load it supersedes:

```csharp
var (token, generation) = LoadGuard.Begin();
var result = await Service.GetByIdAsync(Id, cancellationToken: token);
if (!LoadGuard.IsCurrent(generation))
{
    return; // a newer load owns the page
}
```

`DetailPageBase` carries one for every detail page, and the framework's role editor and ADC's public event, session and speaker detail pages use it directly. It is not thread-safe by contract: it is built for the renderer's synchronization context, where lifecycle methods and event callbacks are already serialized. The list base answers the same question its own way, returning the newest call's rows to every superseded call.

## The shell ships in the package too: modules plug in with IUIModule

A base class removes the duplication inside a page. The next duplication up is the application shell
itself: the router, the layout, the nav menu, and the handful of pages every app has anyway. Left to
each host, every Blazor head grows its own `Routes`, its own `MainLayout`, and its own nav markup,
and adding a module means editing all three.

`MMCA.Common.UI` ships that shell instead. The package owns the router, the main layout, the nav
menu, and the routable pages an app should not have to re-author: sign in, register, home,
not-found, forbidden, and the notification surfaces including the inbox. A module edits none of it.
It implements a five-member interface, `IUIModule`, and registers itself:

```csharp
public interface IUIModule
{
    IReadOnlyList<NavItem> NavItems { get; }
    Assembly Assembly { get; }
    IReadOnlyList<Type> AppBarComponentTypes => [];
    IReadOnlyList<Type> LayoutComponentTypes => [];
    IReadOnlyList<Type> ContentHeaderComponentTypes => [];
}
```

Three of the five default to empty, so a module that contributes only pages and navigation is two
properties. `NavItems` are the module's links, each with an optional required role or claim, so the
shell trims the menu to what the current user may actually reach. `Assembly` is how the module's
`@page` routes get discovered. The last three are extension points: component types the shell renders
into the top app bar (a cart icon with a badge), at the root of the layout (a drawer, an overlay), or
at the top of the main content region above the page body (a banner the user must see first).

The discovery happens at runtime, not compile time. `Routes.razor` injects `IEnumerable<IUIModule>`
and hands `UIModules.Select(m => m.Assembly)` to the `Router`'s `AdditionalAssemblies`, while
`NavMenu` and `MainLayout` inject the same enumeration to assemble the menu and render the
contributed components. Nothing in the shell names a module. That is the UI-layer counterpart of the
server-side `IModule` contract from earlier in this series: "add a module" becomes one registration
on each side instead of a host edit per contribution point, and the same shell serves a web head, a
WASM client, and a MAUI hybrid head with different module sets.

Every module UI in both consumer apps implements it, as do the framework's own notification module
and the backend-less component gallery. One honest caveat: the reference seed does not. MMCA.Helpdesk
deliberately keeps its own `Routes.razor` and `MainLayout`, so an adopter reading that seed gets the
framework's components without this composition model.

## Host-polymorphic token refresh: one component set, three platforms

Here is where the front-end ports pay off the most. The same Razor component set runs on Blazor Server, Blazor WebAssembly, and a .NET MAUI hybrid host (Android, iOS, macOS, Windows) with no per-platform reimplementation. The primer's phrase for this is "write-once UI, render everywhere." A component never asks "am I on MAUI?" It asks an injected abstraction, and each host registers its own implementation.

Token refresh is the cleanest example, because the right answer genuinely differs per host for security reasons. The swap point is a one-method interface, `ITokenRefresher`, with three implementations chosen per host:

```csharp
// Browser default: the refresh token lives in an HttpOnly cookie.
// A same-origin JS helper POSTs to /auth/session/token; the cookie rides along;
// the host refreshes server-side and returns ONLY the access token. JS never
// sees the refresh token, so there is no XSS exfiltration surface for it.
public sealed class SameOriginProxyTokenRefresher : ISessionAwareTokenRefresher { /* ... */ }

// Blazor Server with the same-origin API proxy enabled (AddCommonSameOriginApiProxy
// swaps this in): the circuit asks /auth/session/handoff for a protected handoff and
// opens it on the server, so the access token only ever exists in circuit memory.
internal sealed class HandoffTokenRefresher : ISessionAwareTokenRefresher { /* ... */ }

// MAUI: there is no browser DOM, hence no XSS surface. The refresh token sits in
// OS SecureStorage (iOS Keychain / Android Keystore) and is exchanged directly
// against auth/refresh.
public sealed class DirectApiTokenRefresher : ISessionAwareTokenRefresher { /* ... */ }
```

All three return `Task<string?>` from `ITokenRefresher`, and that `null` answers two different things: "there is no session" and "the attempt failed transiently." So each also implements `ISessionAwareTokenRefresher`, which extends `ITokenRefresher` with a `TryAcquireAccessTokenAsync` that reports which one happened. Token storage starts its signed-out grace period only on the definitive "no session," so one 429 or one dropped connection does not sign a signed-in user out. The higher-level `AuthUIService` calls the same code path regardless of host. Above it, a custom `JwtAuthenticationStateProvider` reads claims from the stored JWT client-side and pushes auth-state changes so Blazor's `AuthorizeView` and `CascadingAuthenticationState` react instantly after login or refresh, with the server still validating every request as the real authority. The whole client-side auth surface, login, register, OAuth code-exchange, logout, refresh, change-password, password reset, and the list of active sessions with single and all-session revoke, sits behind `IAuthUIService` and depends only on `Shared` auth DTOs, so it too honors the UI-to-Shared-only rule.

The payoff is concrete. Adding a platform, or a stricter mode of an existing one, is "implement these interfaces," not "fork the UI." The threat model differs per host, so the implementations differ, but the components above them never know.

## Trade-offs, honestly

- **This is opinionated UI infrastructure coupled to MudBlazor.** `DataGridListPageBase` is built around `MudDataGrid<T>`, `GridState<T>`, and MudBlazor's viewport observer. The base is reusable across your screens, but it is not framework-agnostic: swapping out MudBlazor would mean rewriting it. The trade is the usual one for a design system, a smaller surface and consistency in exchange for a hard dependency.
- **The test layer is thorough, and its residuals are narrow.** The shared primitives and the two mobile list components both carry a fast bUnit suite, a render-snapshot tier diffs their markup against committed baselines and fails the build on an unintended structural change, and Playwright axe (WCAG 2.1 AA) plus a render smoke run as a real-browser CI job against a self-hosted gallery, with all three engines (chromium, firefox, and webkit) blocking merge gates. The most logic-heavy component, the desktop `DataGridListPageBase`, carries its own direct bUnit suite (`DataGridListPageBaseTests`, 40 facts and a theory that drive the base through a concrete test page, covering initial load, grid filters translated into the fetch call, page and sort state mirrored to the URL, failed-`Result` and exception paths, error and cancel toast severities, superseded loads returning the newest rows, URL-driven restoration, density and scroll persistence, the mobile card path, the virtualized-window fetch path, and a regression guard for the disposed-token-source race). What the layer does not cover is narrow: the visual check is markup-snapshot rather than pixel diffing, and there is no mutation testing on the core tier.
- **Render-mode handling is genuinely complex.** The three-channel persistence (URL, memory, session) plus the prerender cache, plus the `BL0005` suppressions to set the grid page from outside the component, plus catch-and-degrade around every JS interop call, is a lot of machinery. It is the right machinery for the InteractiveAuto lifecycle, but it is not simple, and it earns its keep only because it is written once.
- **There is still design-system residue, and it sits in the shell's own CSS.** MudBlazor is the only component library: the package ships no Bootstrap, and the shared `NavMenu` brand row is a plain flex row with no CSS framework classes. The residue the design-system scorecard names is narrower: the shared layout's scoped stylesheets (`NavMenu.razor.css`, `MainLayout.razor.css`) fight MudBlazor with dozens of `!important` declarations and some raw nav colors instead of tokens, and the brand hex is still restated outside the drift guard. Inline styles are not part of it: an inline-style fitness test (`InlineStyleTests`) keeps styling in `app.css` or a component's scoped stylesheet, and the framework's razor markup carries none. The mobile infinite-scroll list is DOM-bounded by a `MaxRenderedItems` cap, so it is not part of that residue either. The dark palette clears its own contrast scan: the filled-primary button label and error-alert text take dark on-color text (`rgba(0,0,0,0.87)`), locked by a blocking dark-mode axe gate, so both light and dark modes are AA-gated. Client-side Web Vitals are measured too: a `WebVitalsE2ETests` suite asserts LCP, FCP, TTFB, CLS, and INP budgets against the gallery inside the required `ui-e2e` gate on all three engines (INP is skipped only where an engine cannot sample it), so a front-end-performance regression fails the build.

None of these argue for going back to per-page plumbing. They argue for closing the last gaps (moving the shell's `!important` overrides and raw nav colors onto tokens, adding pixel-level visual regression) and being clear-eyed that a UI framework is still a framework: a dependency you adopt, not a thing you get for free.

## Apply this even without MMCA

The moves port to any component framework, not just Blazor:

1. Put a **list-page base component** in charge of paging, sort, filter, loading, cancellation, and teardown. A concrete screen should declare its data source and its columns, nothing else.
2. Bind pages to a **typed service interface over a named HTTP client**, never to a raw client. Route every call through one method so retry, auth, and error handling are applied uniformly, and return the server's real error as a value instead of throwing a generic one.
3. Make the **design tokens one source of truth** and guard the duplication with a **fitness test** if the tokens have to exist in two languages.
4. Treat the **URL as the source of truth** for list state so deep links and back-forward just work, and persist transient state across render-mode or navigation transitions so the screen does not flash or refetch.
5. Hide every **platform difference behind an interface** declared in the shared layer, with one implementation per host. Adding a platform should be "implement these ports," not "fork the UI."

The takeaway: **a UI framework is "compose, don't repeat" applied to the front end. The same ports, base classes, and fitness tests that keep your backend honest do not stop at the API. Push them into the components, and a list screen becomes a few lines that inherit the hard parts instead of re-deriving them, one diverged copy at a time.**

---

**What we covered:** why every list screen re-implements the same paging and loading plumbing, how `DataGridListPageBase<TDto>` folds it into one reusable Blazor base so a concrete page is tiny, how the `IEntityService` / `EntityServiceBase` / `AuthenticatedServiceBase` pipeline binds the UI to a DTO contract with Polly retry and server errors returned as `Result` values, how `MMCATheme` plus a `BrandColors` fitness test keep the design tokens from drifting, how `PersistentComponentState` and URL-as-source-of-truth kill the render-mode flash, how a lifetime token and `LatestLoadGuard` keep torn-down and superseded loads from crashing the circuit or landing on the wrong entity, how the package ships the application shell so a module plugs into it by implementing `IUIModule` instead of the host wiring it in by hand, and how one `ITokenRefresher` interface with per-host implementations lets one component set run on Server, WASM, and MAUI.

**Next in the series:** internationalization and theming, en-US and Spanish localization plus a
day/dark mode toggle, both persisted on one cookie-and-profile mechanism.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the UI-framework chapter of the onboarding guide, or `dotnet add package MMCA.Common.UI` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`

*Tags: .NET, Blazor, C Sharp, Front End, Software Architecture*

*Notes: 2026-10-08 refresh against framework v1.233.0 (`MMCA.Common/FACTS.md:4`, `:14`). Paths below are
relative to `MMCA.Common/Source/Presentation/MMCA.Common.UI/` unless stated. Re-opened in source this run:
items (1), (4), (7) counts, (8) and (9); anchors in (3) partly, (5) and (6) and the ci.yml anchors in (7)
are corrected to the 2026-10-08 audit's re-reads and were not re-opened by this apply. (1) DataGridListPageBase:
errors go through `[Inject] protected IToastService Toast` (`Pages/Common/DataGridListPageBase.cs:24`, not
re-opened; `ISnackbar` appears only inside the internal adapter `Services/MudToastService.cs:19-23`);
`LoadFailed` `:53`; `GridRef` is a get-only virtual property (`:141`), so a page overrides it rather than
binding `@ref` to it; `LoadServerDataAsync` `:521-532` takes a six-argument fetch delegate returning
`Task<Result<(IReadOnlyList<TDto> Items, int TotalItems)>>` (`:523`), records itself as the newest load
(`:529-530`) and answers through `NewestPagedResultAsync` (`:571`); cancellation and exception toasts
`Toast.Info` `:744`, `Toast.Error` `:751`; a failed `Result` goes through `FailedFetch` (`NotifyOnFailure`
`:772`). The viewport switch block is verbatim `:321-328` inside `NotifyBrowserViewportChangeAsync`
(`:318-331`); `PersistedGridState` record `:1132`, persisted at `:203`; rows-per-page restore anchors
(`:413`, `:468` at v1.221.0) not re-opened. (2) Example page: an illustrative sketch mirroring
`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.UI/Pages/Customers/CustomerList.razor.cs:24-25`
and `:29-33`, markup `CustomerList.razor:43-46` (carried, not re-opened); `IEntityService.GetPagedAsync`
has seven parameters (`Common/Interfaces/IEntityService.cs:31-38`), so the lambda, not a method group, is
required. Source-comment drift, not fixed here: `DataGridListPageBase.cs:512-513` still says a page
"still passes the method group". (3) Data access: `IEntityService.cs:11-15`, members `:25-68`, NotFound rule
`:45-49` (carried); `EntityServiceBase` doc `Services/Api/EntityServiceBase.cs:14-30`, `SendRequestAsync<T>`
`:351`, `HttpResultExecutor` `:359`, `ProblemDetailsResultReader` `:366`, non-generic overload `:381-397`
(audit anchors). Polly (`Services/Api/AuthenticatedServiceBase.cs`, re-opened): policy doc `:20-26`,
`IsRetryableResponse` `:108-122` (501/505 `:110`, replay check `:115`, 5xx/408/429 `:120-121`),
`IsReplaySafe` `:124-148` (POST/PATCH need a non-blank `Idempotency-Key`, `:141-147`), backoff `:152-155`,
`WaitAndRetryAsync(3, ...)` disposing retried responses `:170-173`, `"APIClient"` const `:29`, DI-scope
rationale `:53-58`. The replay-safety condition is new to the article this run. (4) Token refresh:
`ITokenRefresher` `Services/Auth/Tokens/ITokenRefresher.cs:17-24` (one `Task<string?>` method, per audit);
`ISessionAwareTokenRefresher.cs:12` extends it, null-means-two-things rationale `:3-11`,
`TryAcquireAccessTokenAsync` `:17`; implementations `SameOriginProxyTokenRefresher.cs:16`,
`DirectApiTokenRefresher.cs:35-37`, `HandoffTokenRefresher` (`MMCA.Common.UI.Web/SameOriginProxy/HandoffSessionServices.cs:14`,
internal), swapped in by `AddCommonSameOriginApiProxy` and enabled by ADC
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:161`, audit anchor). `IAuthUIService.cs` also carries
`RequestPasswordResetAsync` `:60`, `ResetPasswordAsync` `:67`, `GetSessionsAsync` `:75`, `RevokeSessionAsync`
`:84`, `RevokeAllSessionsAsync` `:94`; the prose list now names them. (5) Theme (audit anchors): `BrandColors`
37 `public const string` values, doc `Theme/BrandColors.cs:4-8`, Teal 700 comment `:22-24`; `MMCATheme.Instance`
`:11`, dark `PrimaryContrastText`/`ErrorContrastText` `:66`, `:93`, `FontFamily` `:129`, `DefaultBorderRadius`
`:203`; `Theme/MmcaThemeProviders.razor:14` and `:36`; `BrandColorTokenTests`
(`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Theme/BrandColorTokenTests.cs:35-39`); CSS mirror
`wwwroot/app.css:63-67`, `html, body` Inter `:100`. Bare `<MmcaThemeProviders />`: `Layout/MainLayout.razor:16`
(re-opened). Font sizes and license carried from 2026-09-19. (6) Design-system residue: Bootstrap note
`wwwroot/app.css:113` (audit anchor). `!important` re-counted this run: 42 (28 in `Layout/NavMenu.razor.css`,
14 in `Layout/MainLayout.razor.css`); the prose says "dozens". Inline styles: Common bans them through
`InlineStyleTests : InlineStyleTestsBase`
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Ui/ComponentConventions/InlineStyleTests.cs:12`,
Common #513), so the trade-off bullet and closing line no longer name them; the scorecard row
(`Website/docs-src/governance/common-ArchitectureScorecard.md:84`, "19 inline styles ... no inline-style
guard") is stale against code and is not relied on. (7) Tests and gates: `DataGridListPageBaseTests.cs` has
40 `[Fact]` plus 1 `[Theory]` (`:792`), 41 attributes counted by grep this run; superseded-load facts `:384`,
`:413`, disposed-CTS guard `:608` (audit anchors). Web Vitals `MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/WebVitals/WebVitalsE2ETests.cs:19-23`,
`:47-48`, `:104` (carried). `ci.yml` `ui-e2e` job `:223`, matrix `:232`, promotion note `:233-235` (audit
anchors). Scorecard rows: 14 `:78`, 18 `:82`, 20 `:84`, 22 `:86`, 23 `:87`, 28 `:92` (carried). (8) Shell:
`Common/Interfaces/IUIModule.cs:14`, `:17`, `:20`, `:23`, `:29` (`ContentHeaderComponentTypes`, Common #501),
rendered at the top of the main content region (`Layout/MainLayout.razor:77`, collected `:157`); `Routes.razor`
and `NavMenu.razor` anchors carried from 2026-10-02 (`Routes.razor:7`, `:12-14`; `NavItem.cs:20`;
`Layout/NavMenu.razor:9`, `:257-264`). Mobile: `Common/BreakpointConstants.cs:13-16` (carried);
`Components/Lists/MobileInfiniteScrollList.razor.cs:52` (cap 500), `:218` (`_hasMore = HasMoreAfter(appended)`),
`:270-277` (`HasMoreAfter`, with the `appended > 0` stop). Adopter file anchors carried from 2026-09-19;
Helpdesk still has its own `Routes.razor` and `MainLayout`. (9) Component lifetime (new section this run,
rubric section 19): `Common/ComponentLifetimeExtensions.cs:18`, `LifetimeToken` `:26-42` (null or cancelled
`:28-31`, disposed-without-cancel `:37-41`), rationale `:3-17`; `DataGridListPageBase.cs:816-817` (fetch CTS
linked to it); `Pages/Common/DetailPageBase.cs:26`, `PageToken` `:36`, `LoadGuard` `:43`; framework page
uses `Pages/Notifications/NotificationInbox.razor.cs:219`, `Pages/Auth/Sessions.razor.cs:92`,
`Pages/Administration/RoleAdminList.razor.cs:121`; fitness rule
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Ui/ArchitectureRules.LifetimeTokens.cs:28`
(missing root `:34-37`, minimum code-behind `:48-52`, message `:61-64`), base
`Bases/Ui/LifetimeTokenConventionTestsBase.cs:13`, `:28-29`. `Common/LatestLoadGuard.cs:38`, 100-versus-101
rationale `:6-9`, not-thread-safe contract `:33-35`, `Begin` `:50-59`, `IsCurrent` `:67`; direct uses
`Pages/Administration/RoleAdminEdit.razor.cs:42`, `:162`, `:174`; ADC detail pages per
`Website/docs-src/onboarding/00-dependency-manifest.md:3997`, `:4274`, `:4566`; onboarding treatment
`Website/docs-src/onboarding/group-15-common-ui-framework.md:177-206`. The code sketch passes the token by
name, as `Common/ResultUiExtensions.cs:47` does. Header: Rubric and ADR cells aligned this run to the series
index row (`Website/docs-src/articles/README.md:47`: sections 18, 19, 20, 22, 23; ADRs 056/067). History:
first written with the 2026-07-27 responsive section, IUIModule section added 2026-08-07 (ADR-067), audit
passes 2026-08-14, 2026-08-20, 2026-09-19 (v1.205.0) and 2026-10-02 (v1.221.0); this 2026-10-08 pass adds
the fifth `IUIModule` member, the session-aware refresher, Polly replay safety, the inline-style guard, the
`HasMoreAfter` stop, the 40-fact test count and the component-lifetime section.*

- Full series index: https://ivanball.github.io/writing.html
