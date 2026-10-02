# A list page in a few lines: a reusable Blazor UI framework with the same discipline as the backend

> Series: MMCA.Common · Article #37 (deep-dive) · Pillar P2,P5 · Group G15 · Rubric §18,§19,§20,§23 · ADR-067 ·
> Status: grounded in `MMCA.Common/Source/Presentation/MMCA.Common.UI` (v1.221.0 source),
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

// Stop fetching once the rendered-item cap is reached so the DOM (and memory) stay
// bounded even for very large result sets.
_hasMore = _items.Count < _totalCount && _items.Count < MaxRenderedItems;
```

Infinite scroll has an obvious failure mode that is easy to ship without noticing: it is unbounded by
construction, so a 40,000-row result set becomes 40,000 DOM nodes on the least capable device you
support. The cap makes "there is more data" and "we will keep rendering it" two different questions,
and answers the second one no.

Note what is *not* here: there is no separate mobile app, no duplicated page, and no parallel route
tree. One page class serves both layouts, which is why the responsive behavior is verifiable at all.
The three-engine E2E matrix (chromium, firefox, and webkit, all blocking merge gates) exercises the
same pages rather than a mobile-specific build that could drift.

## The data-access boundary: bind to an interface, never to HttpClient

A page in this framework never injects a raw `HttpClient`. It injects `IEntityService<TEntityDTO, TIdentifierType>`, a generic CRUD contract: `GetAllAsync`, `GetPagedAsync`, `GetByIdAsync`, `AddAsync`, `UpdateAsync`, `DeleteAsync`, plus a `GetAllForLookupAsync` for dropdowns. Every member returns a `Result`, the same railway type the server produced. `GetPagedAsync` returns a `Result` wrapping an `(Items, TotalItems)` tuple shaped exactly for a server-side grid, and a missing entity from `GetByIdAsync` is a `NotFound` failure, never a success carrying null. A page branches on the outcome instead of catching an exception.

The behavior behind that interface comes from an abstract base, `EntityServiceBase<TEntityDTO, TIdentifierType>`. A concrete module service is mostly an endpoint string. Every verb routes through one dispatch chokepoint, `SendRequestAsync`, so retry, auth, and error handling are applied identically to every call. The error handling is the subtle, valuable part: the call runs through an `HttpResultExecutor` that turns transport faults into failures, and every response is read through a `ProblemDetailsResultReader` that rebuilds the server's structured Problem Details payload (a domain failure, a validation failure) as a `Result` with its original `ErrorType` intact. The base states the rule in source: nothing in it throws for a server answer, and the only exception that escapes is the caller's own cancellation. A backend `Result.Failure` therefore surfaces to the page as the server's real message and error type, not a generic "server error."

`EntityServiceBase` derives in turn from `AuthenticatedServiceBase`, which owns the two cross-cutting concerns of any outbound API call. One is a Polly retry policy: three retries with exponential backoff (2, 4, and 8 seconds plus up to a second of jitter) on `HttpRequestException` or a retryable status, meaning any 5xx except the permanent 501 and 505, plus 408 and 429, with each retried response disposed so a sustained outage does not leak connections. The other is stamping the JWT bearer token onto a freshly created `"APIClient"` `HttpClient` from `IHttpClientFactory`. That base exists for a precise Blazor Server reason, documented in source: `IHttpClientFactory` builds its handler chain in a separate DI scope from the Blazor circuit, so the conventional delegating handler cannot reach the circuit-scoped storage that holds the in-memory access token. Reading the token directly and setting the header on a fresh client is the smallest correct fix for that scope mismatch.

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

## The shell ships in the package too: modules plug in with IUIModule

A base class removes the duplication inside a page. The next duplication up is the application shell
itself: the router, the layout, the nav menu, and the handful of pages every app has anyway. Left to
each host, every Blazor head grows its own `Routes`, its own `MainLayout`, and its own nav markup,
and adding a module means editing all three.

`MMCA.Common.UI` ships that shell instead. The package owns the router, the main layout, the nav
menu, and the routable pages an app should not have to re-author: sign in, register, home,
not-found, forbidden, and the notification surfaces including the inbox. A module edits none of it.
It implements a four-member interface, `IUIModule`, and registers itself:

```csharp
public interface IUIModule
{
    IReadOnlyList<NavItem> NavItems { get; }
    Assembly Assembly { get; }
    IReadOnlyList<Type> AppBarComponentTypes => [];
    IReadOnlyList<Type> LayoutComponentTypes => [];
}
```

Two of the four default to empty, so a module that contributes only pages and navigation is two
properties. `NavItems` are the module's links, each with an optional required role or claim, so the
shell trims the menu to what the current user may actually reach. `Assembly` is how the module's
`@page` routes get discovered. The last two are extension points: component types the shell renders
into the top app bar (a cart icon with a badge) or at the root of the layout (a drawer, an overlay).

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
public sealed class SameOriginProxyTokenRefresher : ITokenRefresher { /* ... */ }

// Blazor Server with the same-origin API proxy enabled (AddCommonSameOriginApiProxy
// swaps this in): the circuit asks /auth/session/handoff for a protected handoff and
// opens it on the server, so the access token only ever exists in circuit memory.
internal sealed class HandoffTokenRefresher : ITokenRefresher { /* ... */ }

// MAUI: there is no browser DOM, hence no XSS surface. The refresh token sits in
// OS SecureStorage (iOS Keychain / Android Keystore) and is exchanged directly
// against auth/refresh.
public sealed class DirectApiTokenRefresher : ITokenRefresher { /* ... */ }
```

All three return `Task<string?>`, and the null is load-bearing: `null` means "no valid session exists," and the caller treats that as a logout, not an error to catch. The higher-level `AuthUIService` calls the same code path regardless of host. Above it, a custom `JwtAuthenticationStateProvider` reads claims from the stored JWT client-side and pushes auth-state changes so Blazor's `AuthorizeView` and `CascadingAuthenticationState` react instantly after login or refresh, with the server still validating every request as the real authority. The whole client-side auth surface, login, register, OAuth code-exchange, logout, refresh, change-password, sits behind `IAuthUIService` and depends only on `Shared` auth DTOs, so it too honors the UI-to-Shared-only rule.

The payoff is concrete. Adding a platform, or a stricter mode of an existing one, is "implement these interfaces," not "fork the UI." The threat model differs per host, so the implementations differ, but the components above them never know.

## Trade-offs, honestly

- **This is opinionated UI infrastructure coupled to MudBlazor.** `DataGridListPageBase` is built around `MudDataGrid<T>`, `GridState<T>`, and MudBlazor's viewport observer. The base is reusable across your screens, but it is not framework-agnostic: swapping out MudBlazor would mean rewriting it. The trade is the usual one for a design system, a smaller surface and consistency in exchange for a hard dependency.
- **The test layer is thorough, and its residuals are narrow.** The shared primitives and the two mobile list components both carry a fast bUnit suite, a render-snapshot tier diffs their markup against committed baselines and fails the build on an unintended structural change, and Playwright axe (WCAG 2.1 AA) plus a render smoke run as a real-browser CI job against a self-hosted gallery, with all three engines (chromium, firefox, and webkit) blocking merge gates. The most logic-heavy component, the desktop `DataGridListPageBase`, carries its own direct bUnit suite (`DataGridListPageBaseTests`, 35 facts and a theory that drive the base through a concrete test page, covering initial load, grid filters translated into the fetch call, page and sort state mirrored to the URL, failed-`Result` and exception paths, error and cancel toast severities, superseded loads returning the newest rows, URL-driven restoration, density and scroll persistence, the mobile card path, the virtualized-window fetch path, and a regression guard for the disposed-token-source race). What the layer does not cover is narrow: the visual check is markup-snapshot rather than pixel diffing, and there is no mutation testing on the core tier.
- **Render-mode handling is genuinely complex.** The three-channel persistence (URL, memory, session) plus the prerender cache, plus the `BL0005` suppressions to set the grid page from outside the component, plus catch-and-degrade around every JS interop call, is a lot of machinery. It is the right machinery for the InteractiveAuto lifecycle, but it is not simple, and it earns its keep only because it is written once.
- **There is still design-system residue, and it sits in the shell's own CSS.** MudBlazor is the only component library: the package ships no Bootstrap, and the shared `NavMenu` brand row is a plain flex row with no CSS framework classes. The residue the design-system scorecard names is narrower: the shared layout's scoped stylesheets (`NavMenu.razor.css`, `MainLayout.razor.css`) fight MudBlazor with dozens of `!important` declarations and some raw nav colors instead of tokens, inline style declarations sit across a handful of razor files with no inline-style guard in the framework, and the brand hex is still restated outside the drift guard. The mobile infinite-scroll list is DOM-bounded by a `MaxRenderedItems` cap, so it is not part of that residue. The dark palette clears its own contrast scan: the filled-primary button label and error-alert text take dark on-color text (`rgba(0,0,0,0.87)`), locked by a blocking dark-mode axe gate, so both light and dark modes are AA-gated. Client-side Web Vitals are measured too: a `WebVitalsE2ETests` suite asserts LCP, FCP, TTFB, CLS, and INP budgets against the gallery inside the required `ui-e2e` gate on all three engines (INP is skipped only where an engine cannot sample it), so a front-end-performance regression fails the build.

None of these argue for going back to per-page plumbing. They argue for closing the last gaps (moving the shell's `!important` overrides and inline styles onto tokens, adding pixel-level visual regression) and being clear-eyed that a UI framework is still a framework: a dependency you adopt, not a thing you get for free.

## Apply this even without MMCA

The moves port to any component framework, not just Blazor:

1. Put a **list-page base component** in charge of paging, sort, filter, loading, cancellation, and teardown. A concrete screen should declare its data source and its columns, nothing else.
2. Bind pages to a **typed service interface over a named HTTP client**, never to a raw client. Route every call through one method so retry, auth, and error handling are applied uniformly, and return the server's real error as a value instead of throwing a generic one.
3. Make the **design tokens one source of truth** and guard the duplication with a **fitness test** if the tokens have to exist in two languages.
4. Treat the **URL as the source of truth** for list state so deep links and back-forward just work, and persist transient state across render-mode or navigation transitions so the screen does not flash or refetch.
5. Hide every **platform difference behind an interface** declared in the shared layer, with one implementation per host. Adding a platform should be "implement these ports," not "fork the UI."

The takeaway: **a UI framework is "compose, don't repeat" applied to the front end. The same ports, base classes, and fitness tests that keep your backend honest do not stop at the API. Push them into the components, and a list screen becomes a few lines that inherit the hard parts instead of re-deriving them, one diverged copy at a time.**

---

**What we covered:** why every list screen re-implements the same paging and loading plumbing, how `DataGridListPageBase<TDto>` folds it into one reusable Blazor base so a concrete page is tiny, how the `IEntityService` / `EntityServiceBase` / `AuthenticatedServiceBase` pipeline binds the UI to a DTO contract with Polly retry and server errors returned as `Result` values, how `MMCATheme` plus a `BrandColors` fitness test keep the design tokens from drifting, how `PersistentComponentState` and URL-as-source-of-truth kill the render-mode flash, how the package ships the application shell so a module plugs into it by implementing `IUIModule` instead of the host wiring it in by hand, and how one `ITokenRefresher` interface with per-host implementations lets one component set run on Server, WASM, and MAUI.

**Next in the series:** internationalization and theming, en-US and Spanish localization plus a
day/dark mode toggle, both persisted on one cookie-and-profile mechanism.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the UI-framework chapter of the onboarding guide, or `dotnet add package MMCA.Common.UI` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`

*Tags: .NET, Blazor, C Sharp, Front End, Software Architecture*

*Notes: 2026-10-02 refresh against framework v1.221.0 (`MMCA.Common/FACTS.md:4`), every claim
re-opened in source this run. Paths below are relative to `MMCA.Common/Source/Presentation/MMCA.Common.UI/`
unless stated. (1) DataGridListPageBase: errors go through `[Inject] protected IToastService Toast`
(`Pages/Common/DataGridListPageBase.cs:24`; `ISnackbar` appears only inside the internal adapter
`Services/MudToastService.cs:19-23`); `LoadFailed` `:42`; `GridRef` is a get-only virtual property
(`:130`), so a page overrides it rather than binding `@ref` to it; `LoadServerDataAsync` `:510-521` takes a
six-argument fetch delegate returning `Task<Result<(IReadOnlyList<TDto> Items, int TotalItems)>>` (`:512`),
records itself as the newest load and answers through `NewestPagedResultAsync` (`:556-566`); the SSR
shortcut is `:532-543`; cancellation and exception toasts `:710-726` (`Toast.Info` `:716`, `Toast.Error`
`:723`); a failed `Result` goes through `FailedFetch` (`:738-743`, `NotifyOnFailure` `:740`). The
viewport switch block is verbatim `:310-317` inside `NotifyBrowserViewportChangeAsync` (`:307-320`),
`IBrowserViewportService` injected at `:26`; `PersistedGridState` record `:1100`, persisted at `:192`;
rows-per-page restore `:413`, `:468`. (2) Example page: rewritten this run to a compiling shape. The
prior sketch passed `_service.GetPagedAsync` as a method group and used `@ref="GridRef"`; neither binds,
because `IEntityService.GetPagedAsync` has seven parameters (`includeChildren` before the token,
`Common/Interfaces/IEntityService.cs:31-38`) against the six-argument delegate, and `GridRef` is get-only.
The block mirrors a real page, `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.UI/Pages/Customers/CustomerList.razor.cs:24-25`
(`_dataGrid` field plus `GridRef` override) and `:29-33` (the `(state, cancellationToken)` method with the
lambda), with markup `CustomerList.razor:43-46` (`@ref="_dataGrid"`, `ServerData="LoadServerData"`,
`Loading="IsLoading"`). It stays an illustrative sketch (ProductDto is invented). Source-comment drift,
not fixed here: the remark at `DataGridListPageBase.cs:501-502` says a page "still passes the method
group", which the seven-parameter interface does not allow. (3) Data access: every `IEntityService`
member returns a `Result` (`IEntityService.cs:11-15`, members `:25-68`, NotFound rule `:45-49`);
`EntityServiceBase` doc `Services/Api/EntityServiceBase.cs:14-30` ("Nothing here throws for a server
answer" `:26`); `SendRequestAsync<T>` `:328` runs `HttpResultExecutor.ExecuteAsync` (`:336`) and
`ProblemDetailsResultReader.ReadAsync<T>` (`:343`), non-generic overload `:358-371`. `ServiceExceptionHelper`
and `EnsureSuccessStatusCode` no longer exist in this package, so the old "pull Problem Details before
EnsureSuccessStatusCode throws" wording is replaced. Polly: `Services/Api/AuthenticatedServiceBase.cs`
`IsRetryableResponse` `:106-115` (501/505 excluded, 408/429 included), backoff 2/4/8 s plus up to 1 s
jitter `:119-122`, `WaitAndRetryAsync(3, ...)` disposing retried responses `:137-140`; the DI-scope
rationale for the fresh `"APIClient"` is unchanged (`:51`, per the 2026-10-02 audit, not re-opened).
(4) Token refresh: `ITokenRefresher` `Services/Auth/Tokens/ITokenRefresher.cs:13`,
`Task<string?> AcquireAccessTokenAsync` `:20`; `SameOriginProxyTokenRefresher.cs:11`;
`DirectApiTokenRefresher.cs:25`; third implementation `HandoffTokenRefresher`
(`MMCA.Common.UI.Web/SameOriginProxy/HandoffSessionServices.cs:7-14`, internal), swapped in by
`AddCommonSameOriginApiProxy` (`MMCA.Common.UI.Web/SameOriginProxy/SameOriginApiProxyServiceExtensions.cs:83`)
and enabled by ADC (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:156`). (5) Theme:
`BrandColors` holds 37 `public const string` values (counted by grep this run), doc `Theme/BrandColors.cs:4-8`
("Every hex value in MMCATheme (light and dark) is one of these constants"), Primary `:13`, Teal 700
versus Teal 600 contrast comment `:22-24` (`MMCATheme.cs:21` points there); `MMCATheme.Instance` `:11`,
brand references `:18-24`, dark `PrimaryContrastText`/`ErrorContrastText` `rgba(0,0,0,0.87)` `:66`, `:93`,
`FontFamily` Inter-first `:119`, `DefaultBorderRadius = "6px"` `:193`; `Theme/MmcaThemeProviders.razor:12`
(`<MudThemeProvider Theme="@Theme" ...>`) and `:34` (`Theme` defaults to `MMCATheme.Instance`);
`BrandColorTokenTests` (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Theme/BrandColorTokenTests.cs:35-39`,
five `--mmca-*` tokens); CSS mirror `wwwroot/app.css:61-63`; `@font-face` blocks from `:9`;
`html, body` Inter `:99-100`. Bare `<MmcaThemeProviders />`: `Layout/MainLayout.razor:14`,
`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Components/Layout/MainLayout.razor:10` (ADC
`PresenterLayout.razor:6` not re-opened this run). Font file sizes and license carried from the
2026-09-19 pass, not re-measured. (6) Design-system residue: Bootstrap is gone (`wwwroot/app.css:108`,
"the Bootstrap reboot this RCL no longer ships"; `Layout/NavMenu.razor:18` brand row with "no CSS
framework classes"; toggler `.nav-toggler` `:62`), so the trade-off bullet and closing line no longer
name Bootstrap chrome. Scorecard section 20 (`Website/docs-src/governance/common-ArchitectureScorecard.md:84`)
names the residual: 41 `!important` declarations in the scoped layout CSS (re-counted this run: 27 in
`Layout/NavMenu.razor.css`, 14 in `Layout/MainLayout.razor.css`), raw nav colors, 19 inline styles with no
Common inline-style guard, brand hex defined twice. (7) Tests and gates: `DataGridListPageBaseTests.cs`
has 35 `[Fact]` plus 1 `[Theory]` (`:633`), counted by grep this run; superseded-load facts `:384`, `:413`;
disposed-CTS guard `:449`; `RestoreGridState` `:839`, `:853`. Web Vitals:
`MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/WebVitals/WebVitalsE2ETests.cs:19-23` (LCP 2500,
FCP 1800, TTFB 800, CLS 0.1, INP 200), budget record `:47-48`, INP skip `:104`. `ci.yml` `ui-e2e` job
`:248`, name `:249`, matrix `[chromium, firefox, webkit]` `:257`, promotion note `:258-260`; the only
`continue-on-error` is `:976` on `apphost-testing` (`:958`). Scorecard rows: section 14 `:78` (no mutation
testing), 18 `:82`, 20 `:84`, 22 `:86`, 23 `:87` (Web Vitals on all three engines), 28 `:92` (markup not
pixel). (8) Shell: `IUIModule.cs:13,16,19,22`; `Routes.razor:7` inject, `:12` `AppAssembly`, `:13`
`AdditionalAssemblies`, `:14` `NotFoundPage`; `Layout/MainLayout.razor:101-102`; `NavItem.cs:20`
(`RequiredRole`, `RequiredClaim`, plus `RequiredPermission` not covered here); `Layout/NavMenu.razor:9`
inject, filters `:257-259`, section split `:262-264`. Mobile: `Common/BreakpointConstants.cs:13-16`;
`Components/Lists/MobileInfiniteScrollList.razor.cs:52` and `:220`. Adopter file anchors (ADC Conference,
Engagement, Identity; Store Catalog, Sales, Identity; `Notifications/NotificationUIModule.cs`; gallery
`GalleryUIModule.cs`) are carried from the 2026-09-19 pass and were not re-opened this run; Helpdesk
still has its own `Routes.razor` and `MainLayout`. Header cells (Rubric, ADR) left as they were: the series
index (`Website/docs-src/articles/README.md:47`) maps this article to sections 18, 19, 20, 22, 23 and ADRs
056/067, proposed in the run's result rather than changed here. History: first written with the
2026-07-27 responsive section, IUIModule section added 2026-08-07 (ADR-067), audit passes 2026-08-14,
2026-08-20 and 2026-09-19 (v1.205.0); the long per-pass ledger they produced is superseded by this one.*

- Full series index: https://ivanball.github.io/writing.html
