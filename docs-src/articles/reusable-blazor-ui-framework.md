# A list page in a few lines: a reusable Blazor UI framework with the same discipline as the backend

> Series: MMCA.Common · Article #37 (deep-dive) · Pillar P2,P5 · Group G15 · Rubric §18,§19,§20,§23 · ADR-067 ·
> Status: grounded in `Website/docs-src/onboarding/group-15-common-ui-framework.md`,
> `group-25-adc-host-composition.md`. No em dashes.

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

The centerpiece is an abstract Blazor component, `DataGridListPageBase<TDto>`. Every server-paged list screen in every consumer app derives from it. It folds into one reusable place the concerns that were otherwise copy-pasted onto each page: server-side paging against MudBlazor's `MudDataGrid<T>`, the `CancellationTokenSource` lifecycle, the loading flag, extracting filter and sort out of MudBlazor's `GridState<T>`, surfacing errors through `ISnackbar`, viewport-driven mobile-versus-desktop rendering, and a careful `IAsyncDisposable` / `IDisposable` teardown.

Because all of that lives in the base, a concrete page is tiny. It supplies a `Title`, points the grid's `ServerData` at the inherited load method, and declares its columns in markup. That is the whole page. It does not write a query string, does not manage a token source, does not branch on screen size, and does not handle its own disposal.

```razor
@inherits DataGridListPageBase<ProductDto>
@page "/products"

<MudDataGrid T="ProductDto" @ref="GridRef"
             ServerData="@(state => LoadServerDataAsync(state, _service.GetPagedAsync))"
             Filterable="true" SortMode="SortMode.Multiple">
    <Columns>
        <PropertyColumn Property="x => x.Name" Title="Name" />
        <PropertyColumn Property="x => x.Price" Title="Price" />
    </Columns>
</MudDataGrid>
```

The single inherited method doing the work, `LoadServerDataAsync`, is the heart of the desktop path. It resets the cancellation source, extracts filters and sort from the `GridState<TDto>` MudBlazor hands it, runs the fetch, and maps a cancellation or an exception to an empty grid plus an optional snackbar instead of an unhandled error. Paging is genuinely server-side: only the requested page is fetched, never the whole table.

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

A page in this framework never injects a raw `HttpClient`. It injects `IEntityService<TEntityDTO, TIdentifierType>`, a generic CRUD contract: `GetAllAsync`, `GetPagedAsync`, `GetByIdAsync`, `AddAsync`, `UpdateAsync`, `DeleteAsync`, plus a `GetAllForLookupAsync` for dropdowns. The grid's `ServerData` callback above is just calling `GetPagedAsync`, which returns an `(Items, TotalItems)` tuple shaped exactly for a server-side grid.

The behavior behind that interface comes from an abstract base, `EntityServiceBase<TEntityDTO, TIdentifierType>`. A concrete module service is mostly an endpoint string. Every verb routes through one dispatch chokepoint, `SendRequestAsync`, so retry, auth, and error extraction are applied identically to every call. The error extraction is the subtle, valuable part: before letting `EnsureSuccessStatusCode` throw a contextless `HttpRequestException`, the base calls a helper that pulls the server's structured Problem Details payload (a domain failure, a validation failure) out of the response body. A backend `Result.Failure` therefore surfaces to the page as the server's real message, not a generic "server error."

`EntityServiceBase` derives in turn from `AuthenticatedServiceBase`, which owns the two cross-cutting concerns of any outbound API call. One is a Polly retry policy: three attempts with exponential backoff on `HttpRequestException` or any 5xx. The other is stamping the JWT bearer token onto a freshly created `"APIClient"` `HttpClient` from `IHttpClientFactory`. That base exists for a precise Blazor Server reason, documented in source: `IHttpClientFactory` builds its handler chain in a separate DI scope from the Blazor circuit, so the conventional delegating handler cannot reach the circuit-scoped storage that holds the in-memory access token. Reading the token directly and setting the header on a fresh client is the smallest correct fix for that scope mismatch.

The shape is the same one the backend uses for everything: an interface the consumer programs against, a base class that carries the 80 percent, and a composition root that wires the transport. The UI is just another consumer of ports.

## Theming: one set of tokens, guarded by a fitness test

Visual consistency lives in one static `MudTheme`, exposed as `MMCATheme.Instance` and handed to `MudThemeProvider` by a shared component, `MmcaThemeProviders`, that a root layout drops in as a single tag. It defines a light palette, a dark palette, an Inter typography scale, and a 6px border radius.

That default is not a lock-in. `MmcaThemeProviders` takes an optional `Theme` parameter that defaults to `MMCATheme.Instance`, so an app with its own brand passes a derived `MudTheme` in one attribute instead of forking the provider block and re-implementing the day/dark lifecycle wired behind it. Two honest limits. The override reaches MudBlazor's own components and stops there: the raw CSS rules in `app.css` read their colors from `--mmca-*` custom properties whose literal hex mirrors `BrandColors`, so a host that swaps the theme object and nothing else gets rebranded Mud components sitting on framework-colored stylesheet rules. And the extension point is unexercised: every root layout across these repos renders `<MmcaThemeProviders />` bare, so "one theme everywhere" is the observed state rather than an enforced one.

The interesting move is what feeds it. The brand palette is a single C# source of truth, `BrandColors`, six `const` hex values (a primary and a secondary each with a darkened and lightened variant) that `MMCATheme` references. The catch is that raw CSS rules in `app.css` need those same colors as custom properties, so the palette exists twice: once in C# for MudBlazor, once in CSS for stylesheet rules. That is a textbook drift hazard. The codebase neutralizes it with a fitness test, `BrandColorTokenTests`, which parses `app.css` and asserts each CSS token equals its `BrandColors` constant. If the two drift, the build fails before it ships.

This is the same "executable governance" idea the backend uses to enforce its layer rules: an invariant that matters is enforced by a test, not by hope and code review. And the color choices themselves carry accessibility reasoning. The theme's `Secondary` color was deliberately bumped from Teal 600 (around 4.0:1 on light surfaces, below the WCAG AA 4.5:1 floor for normal text) to Teal 700 (around 5.3:1), with the contrast calculation written into the source comment, because that color drives muted helper text.

The typography half of the theme had a quieter version of the same duplication problem, and for a while it was losing. `MMCATheme` names `Inter` first in its font stack and `app.css` names it again on `html, body`, but the package shipped no Inter faces, so the stack silently fell through to Segoe UI on Windows and to a generic sans-serif everywhere else. The "professional typography" was declared in two files and rendered in neither. The fix was to vendor the font rather than link it: five latin-subset `woff2` files (weights 400 through 800, about 24 KB each) now live under the package's `wwwroot/fonts` with their SIL OFL license, declared by five `@font-face` blocks at the top of `app.css` and served same-origin from `_content/MMCA.Common.UI/fonts/`. Two details there are deliberate. Self-hosting fits the host's existing `font-src 'self'` content-security policy with no CDN allowance to add, which is the kind of default worth taking when the alternative is loosening a header. And `font-display: swap` keeps first paint on the fallback face instead of blocking text, which is exactly what the LCP budget in the Web Vitals E2E suite is watching. The cost is honest: roughly 120 KB of font in the package, latin glyphs only, and a family name that now exists in two places with a comment in each asking you to keep them in step.

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

Token refresh is the cleanest example, because the right answer genuinely differs per platform for security reasons. The swap point is a one-method interface, `ITokenRefresher`, with two implementations chosen per host:

```csharp
// Browser (Blazor Server + WASM): the refresh token lives in an HttpOnly cookie.
// A same-origin JS helper POSTs to /auth/session/token; the cookie rides along;
// the host refreshes server-side and returns ONLY the access token. JS never
// sees the refresh token, so there is no XSS exfiltration surface.
public sealed class SameOriginProxyTokenRefresher : ITokenRefresher { /* ... */ }

// MAUI: there is no browser DOM, hence no XSS surface. The refresh token sits in
// OS SecureStorage (iOS Keychain / Android Keystore) and is exchanged directly
// against auth/refresh.
public sealed class DirectApiTokenRefresher : ITokenRefresher { /* ... */ }
```

Both return `Task<string?>`, and the null is load-bearing: `null` means "no valid session exists," and the caller treats that as a logout, not an error to catch. The higher-level `AuthUIService` calls the same code path regardless of host. Above it, a custom `JwtAuthenticationStateProvider` reads claims from the stored JWT client-side and pushes auth-state changes so Blazor's `AuthorizeView` and `CascadingAuthenticationState` react instantly after login or refresh, with the server still validating every request as the real authority. The whole client-side auth surface, login, register, OAuth code-exchange, logout, refresh, change-password, sits behind `IAuthUIService` and depends only on `Shared` auth DTOs, so it too honors the UI-to-Shared-only rule.

The payoff is concrete. Adding a platform is "implement these interfaces," not "fork the UI." The threat model differs per host, so the implementations differ, but the components above them never know.

## Trade-offs, honestly

- **This is opinionated UI infrastructure coupled to MudBlazor.** `DataGridListPageBase` is built around `MudDataGrid<T>`, `GridState<T>`, and MudBlazor's viewport observer. The base is reusable across your screens, but it is not framework-agnostic: swapping out MudBlazor would mean rewriting it. The trade is the usual one for a design system, a smaller surface and consistency in exchange for a hard dependency.
- **The test layer is thorough, and its residuals are narrow.** The shared primitives and the two mobile list components both carry a fast bUnit suite, a render-snapshot tier diffs their markup against committed baselines and fails the build on an unintended structural change, and Playwright axe (WCAG 2.1 AA) plus a render smoke run as a real-browser CI job against a self-hosted gallery, with all three engines (chromium, firefox, and webkit) blocking merge gates. The most logic-heavy component, the desktop `DataGridListPageBase`, carries its own direct bUnit suite (`DataGridListPageBaseTests`, thirty facts that drive the base through a concrete test page, covering initial load, grid filters translated into the fetch call, page and sort state mirrored to the URL, error and cancel snackbar severities, URL-driven restoration, density and scroll persistence, the mobile card path, the virtualized-window fetch path, and a regression guard for the disposed-token-source race). What the layer does not cover is narrow: the visual check is markup-snapshot rather than pixel diffing, and there is no mutation testing on the core tier.
- **Render-mode handling is genuinely complex.** The three-channel persistence (URL, memory, session) plus the prerender cache, plus the `BL0005` suppressions to set the grid page from outside the component, plus catch-and-degrade around every JS interop call, is a lot of machinery. It is the right machinery for the InteractiveAuto lifecycle, but it is not simple, and it earns its keep only because it is written once.
- **There is still design-system residue.** The source still carries Bootstrap chrome (`navbar`, `navbar-brand`, `navbar-toggler`) coexisting with MudBlazor in the shared `NavMenu`. The mobile infinite-scroll list is DOM-bounded by a `MaxRenderedItems` cap, so it is not part of that residue. The design-system scorecard's pair is that leftover Bootstrap chrome plus some `app.css` blocks that use `!important` overrides and raw hex outside the token set. The dark palette clears its own contrast scan: the filled-primary button label and error-alert text take dark on-color text (`rgba(0,0,0,0.87)`), locked by a blocking dark-mode axe gate, so both light and dark modes are AA-gated. Client-side Web Vitals are measured too: a `WebVitalsE2ETests` suite asserts LCP, TTFB, and CLS budgets against the gallery inside the blocking chromium E2E gate, so a catastrophic front-end-performance regression fails the build.

None of these argue for going back to per-page plumbing. They argue for closing the last gaps (retiring the leftover NavMenu chrome, adding pixel-level visual regression) and being clear-eyed that a UI framework is still a framework: a dependency you adopt, not a thing you get for free.

## Apply this even without MMCA

The moves port to any component framework, not just Blazor:

1. Put a **list-page base component** in charge of paging, sort, filter, loading, cancellation, and teardown. A concrete screen should declare its data source and its columns, nothing else.
2. Bind pages to a **typed service interface over a named HTTP client**, never to a raw client. Route every call through one method so retry, auth, and error extraction are applied uniformly, and surface the server's real error instead of a generic one.
3. Make the **design tokens one source of truth** and guard the duplication with a **fitness test** if the tokens have to exist in two languages.
4. Treat the **URL as the source of truth** for list state so deep links and back-forward just work, and persist transient state across render-mode or navigation transitions so the screen does not flash or refetch.
5. Hide every **platform difference behind an interface** declared in the shared layer, with one implementation per host. Adding a platform should be "implement these ports," not "fork the UI."

The takeaway: **a UI framework is "compose, don't repeat" applied to the front end. The same ports, base classes, and fitness tests that keep your backend honest do not stop at the API. Push them into the components, and a list screen becomes a few lines that inherit the hard parts instead of re-deriving them, one diverged copy at a time.**

---

**What we covered:** why every list screen re-implements the same paging and loading plumbing, how `DataGridListPageBase<TDto>` folds it into one reusable Blazor base so a concrete page is tiny, how the `IEntityService` / `EntityServiceBase` / `AuthenticatedServiceBase` pipeline binds the UI to a DTO contract with Polly retry and real server errors, how `MMCATheme` plus a `BrandColors` fitness test keep the design tokens from drifting, how `PersistentComponentState` and URL-as-source-of-truth kill the render-mode flash, how the package ships the application shell so a module plugs into it by implementing `IUIModule` instead of the host wiring it in by hand, and how one `ITokenRefresher` interface with two host implementations lets one component set run on Server, WASM, and MAUI.

**Next in the series:** internationalization and theming, en-US and Spanish localization plus a
day/dark mode toggle, both persisted on one cookie-and-profile mechanism.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the UI-framework chapter of the onboarding guide, or `dotnet add package MMCA.Common.UI` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`

*Tags: .NET, Blazor, C Sharp, Front End, Software Architecture*

*Notes: 2026-07-27 coverage addition: the section "The same page on a phone, without a second page"
was added to close a recorded gap, rubric §22 (responsive/adaptive UI) was unmapped in the series
table and appeared in articles only as scorecard commentary. Both code blocks are verbatim. The
viewport switch is
`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs`:
`[Inject] IBrowserViewportService` (`:26`) and `NotifyBrowserViewportChangeAsync` (`:304-317`) with
the `wasMobile` crossing check and the `MobileCurrentPage = 1` reset (`:307-314`). The threshold constant
is `MMCA.Common.UI/Common/BreakpointConstants.cs`: `IsMobileBreakpoint(Breakpoint) => breakpoint is
Breakpoint.Xs or Breakpoint.Sm` (`:16-17`), documented as the sidebar-collapse threshold, "&lt; 960 px",
used "to switch between desktop data grids and mobile card-based layouts" (`:11-15`). The DOM cap is
`MMCA.Common.UI/Components/Lists/MobileInfiniteScrollList.razor.cs`: `MaxRenderedItems` defaulting to
500 (`:54`, doc `:49-53`) and the `_hasMore` bounding assignment with its comment (`:212-214`). The
three-engine blocking matrix is the `ui-e2e` job described in `MMCA.Common/CLAUDE.md` ("chromium,
firefox, and webkit are all required merge gates"). Also corrected in this run: an earlier audit note
referred to the method as `BreakpointConstants.IsMobile`; the real name is `IsMobileBreakpoint`.
Verified type names from `Website/docs-src/onboarding/group-15-common-ui-framework.md` and `group-25-adc-host-composition.md`: `DataGridListPageBase<TDto>` (with `LoadServerDataAsync`, `PersistedGridState` nested record, MudDataGrid v9 paging workaround, disposed-CTS race fix), `IEntityService<TEntityDTO, TIdentifierType>`, `EntityServiceBase<TEntityDTO, TIdentifierType>` (`SendRequestAsync`, `GetPagedAsync`), `AuthenticatedServiceBase` (Polly 3-retry policy, `CreateAuthenticatedClientAsync`, `"APIClient"` named client), `ServiceExceptionHelper`, `MMCATheme` (`Instance`, light + dark palettes), `BrandColors` (6 const hex: Primary/PrimaryDark/PrimaryLight + Secondary/SecondaryDark/SecondaryLight, `Theme/BrandColors.cs:13-32`, all six referenced by `Theme/MMCATheme.cs:18-24,52-59`), `BrandColorTokenTests` fitness test, `ListPageStateService` / `ListPageQueryStateService` (URL keys p/ps/s/sd/f:), `ITokenRefresher` with `SameOriginProxyTokenRefresher` (browser, HttpOnly cookie via /auth/session/token) and `DirectApiTokenRefresher` (MAUI, SecureStorage via auth/refresh), `JwtAuthenticationStateProvider`, `IAuthUIService` / `AuthUIService`, `ITokenStorageService`, `IFormFactor`, `IUIModule`. The example `.razor` and `ITokenRefresher` blocks are illustrative composition sketches, not verbatim source. Honest gaps re-verified 2026-08-14 against `Website/docs-src/governance/common-ArchitectureScorecard.md` (in that pass, every scorecard row anchor below was re-opened and re-counted line by line, because the previous run's citations were uniformly 2 lines short: `:88` is §16, `:98` is §26, `:90` is §18, `:92` is §20, `:84` is §12, and `:93` is §21, so each anchor below is the corrected one): §18 (`Website/docs-src/governance/common-ArchitectureScorecard.md:90`) and §28 (`:100`) now affirmatively cite bUnit coverage. A bUnit suite ships at `Tests/Presentation/MMCA.Common.UI.Tests/Components/*` (DeleteConfirmation/EmptyState/MobileCardList/MobileInfiniteScrollList/NotificationBell/Primitives + a `PrimitivesSnapshotTests` render-snapshot tier with committed `Snapshots/*.html` baselines), and the axe/render-smoke E2E DOES run in Common's CI (`.github/workflows/ci.yml:270`, the `ui-e2e` job, whose `name:` at `:271` is "UI a11y + render smoke" per browser; chromium, firefox, AND webkit are all blocking merge gates). The prior direct-test gap is now CLOSED: the desktop `DataGridListPageBase` carries its own direct bUnit suite (`Tests/Presentation/MMCA.Common.UI.Tests/Pages/Common/DataGridListPageBaseTests.cs`, 30 `[Fact]`s driving the base through a concrete `TestGridPage` (declared at `:52`; attributes at `:137,161,194,214,245,262,281,300,320,335,351,363,375,395,409,421,435,449,468,535,557,580,594,610,630,651,666,688,698,712`, re-counted line by line this run, so the prior "14" was stale): initial load and one-based page fetch, additional filters applied before the fetch plus the throwing-callback path, grid filters translated into the fetch dictionary, two filters on one column keeping the newest, page/sort state mirrored to the URL, error/cancel snackbar severities and suppression including the several-errors-one-toast case, URL-driven restoration, scroll and density persistence, the mobile card-view path, the virtualized-window path (`LoadVirtualizedServerDataAsync` over aligned, unaligned and end-of-data windows plus additional filters, sort mapping and silent cancel, `:536-667`, with the `VirtualizeGrid` default at `:689`), and a disposed-CTS regression guard at `:376`; one `[Theory]` over `ComputeVirtualWindow` (`:501`) sits alongside the 30 facts). The residual test-layer trade-offs the article now names are narrower and still true: all three engines block merges (chromium and firefox promoted earlier, webkit promoted to a required merge gate 2026-07-16 after 11 consecutive green main runs since its last flake, 2026-07-12 00:45; `.github/workflows/ci.yml:279` matrix `[chromium, firefox, webkit]`, promotion note `:280-282`, and no step in the `ui-e2e` job carries `continue-on-error`, so nothing in that job, `:270-367` (the job's last step ends at `:367`; `:369` opens the following `performance-smoke` job's comment block, whose `performance-smoke:` key is at `:377`), is advisory. The file does use `continue-on-error` once, at `:900` with its rationale comment at `:887-890`, but that is on the unrelated `apphost-testing` job (`:882`), never on `ui-e2e`; the live branch-protection-API confirmation that all three `ui-e2e` contexts sit in `required_status_checks` is recorded in §22 (`:94`) and was not re-queried here), the visual check is markup-snapshot not pixel (§28 `:100`), and no mutation testing on the core tier (§14 `:86`). §20 (`:92`) still names Bootstrap chrome as a residual: its remaining pair is `app.css` `!important`/raw-hex outside the token set AND Bootstrap chrome coexisting with MudBlazor (NOT dark contrast, which is now resolved). The dark-palette AA contrast failures are RESOLVED (2026-07-11): dark `PrimaryContrastText`/`ErrorContrastText` = `rgba(0,0,0,0.87)` (`Theme/MMCATheme.cs:58,71`), locked by the blocking dark-mode axe gate (`DarkModeE2ETests`), and `Website/docs-src/guides/common-ACCESSIBILITY.md:49-53` marks it resolved; both light AND dark modes are now AA-gated. The Bootstrap chrome itself still exists in source (`Layout/NavMenu.razor:17` `navbar navbar-dark`, `:19` `navbar-brand`, `:58` `class="navbar-toggler"`, all three re-verified 2026-09-19; the 2026-08-20 anchors `:16`, `:18` and `:50` are each one to eight lines short of the current file), and §20 now names it as one half of the residual pair. `app.css` `!important`/raw-hex is the other half, per §20's own evidence anchor (`Website/docs-src/governance/common-ArchitectureScorecard.md:92`, whose evidence text still reads "`wwwroot/app.css` raw hex/!important (e.g. :122 minor)"; re-anchored 2026-08-20, `app.css:122` is now `.valid.modified:not([type=checkbox])` and unrelated, because the five `@font-face` blocks added at the top of the file pushed everything down: the mobile-snackbar comment now opens at `:171`, its `@media (max-width: 1023.98px)` at `:175`, and the flagged declaration `z-index: var(--mmca-z-snackbar-mobile, 10000) !important;` at `:177`. The scorecard's stale `:122` citation is a follow-up in the Website repo, not in this article). §23 (`:95`, now Maturity 4) describes a bounded infinite-scroll DOM (the `MaxRenderedItems = 500` cap lives in the code-behind `Components/Lists/MobileInfiniteScrollList.razor.cs:54`, `[Parameter] public int MaxRenderedItems { get; set; } = 500;`, not the `.razor` markup); the prior "no client-side Web Vitals" perf gap is now CLOSED: `Tests/Presentation/MMCA.Common.UI.E2E.Tests/WebVitalsE2ETests.cs:43` asserts LCP/TTFB/CLS budgets via the shipped `WebVitalsCollector` (`Source/Hosting/MMCA.Common.Testing.E2E/Infrastructure/WebVitalsCollector.cs`) inside the blocking chromium `ui-e2e` gate. The dark palette IS defined in `MMCATheme` and is now user-toggleable (ADR-028); theming claims here reflect the source. New in this run: the section "The shell ships in the package too: modules plug in with IUIModule" is grounded in ADR-067 (`Website/docs-src/adr/067-ui-module-shell-composition.md`, Accepted 2026-08-07) and re-verified against source. The contract's four members, the last two defaulted to `[]`, are `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IUIModule.cs:13,16,19,22`, and the code block is that declaration verbatim with the doc comments stripped. `NavItem`'s optional `RequiredRole`/`RequiredClaim` are on the record declaration at `MMCA.Common.UI/Common/NavItem.cs:20`, which also carries a third optional gate, `RequiredPermission`, that this article does not cover; the per-user trimming and the General/User/Admin section split are `Layout/NavMenu.razor:219-228` (the `RequiredRole` and `RequiredClaim` filters at `:221-222`, the matching `RequiredPermission` filter at `:223`, the `_generalItems`/`_userItems`/`_adminItems` split at `:226-228`; re-anchored 2026-09-19, the prior `:196-204` range is short by roughly twenty lines), which injects `IEnumerable<IUIModule>` at `:9`. Runtime route discovery is `Routes.razor:4` (`@inject IEnumerable<IUIModule> UIModules`) feeding `AdditionalAssemblies="UIModules.Select(m => m.Assembly)"` (`:9`), with `AppAssembly` pinned to the shell's own assembly (`:8`) and `NotFoundPage` to the shipped 404 page (`:10`). The two component extension points are read in `Layout/MainLayout.razor:101-102` (`AppBarComponentTypes`, `LayoutComponentTypes`). The shipped routable shell pages (home, login, register, not-found, forbidden, and the notification list/inbox/send surfaces) are enumerated in ADR-067's Decision section. Adoption verified by direct source lookup: `MMCA.ADC.Conference.UI/ConferenceUIModule.cs:14`, `MMCA.ADC.Engagement.UI/EngagementUIModule.cs:14`, `MMCA.ADC.Identity.UI/IdentityUIModule.cs:13`, `MMCA.Store.Catalog.UI/CatalogUIModule.cs:13`, `MMCA.Store.Sales.UI/SalesUIModule.cs:16`, `MMCA.Store.Identity.UI/IdentityUIModule.cs:13`, the framework's own `MMCA.Common.UI/Notifications/NotificationUIModule.cs:14`, and the gallery stub `MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Stubs/GalleryUIModule.cs:13` (plus two host-only adopters, `MMCA.ADC.UI/DeviceUIModule.cs:19` and `MMCA.Store.UI/MauiUIModule.cs:14`). MMCA.Helpdesk has no `IUIModule` implementation at all and keeps its own `Routes.razor` and `MainLayout` (ADR-067 Decision; re-verified in source this run: the local files are `MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Components/Routes.razor` and `Components/Layout/MainLayout.razor`, and `Program.cs:25-28` registers `ICultureApplier` by hand under the comment "this seed does not call AddUIShared". The previous citation's second range, `Program.cs:85-89`, was a mismatch: those lines are the `/culture/set` endpoint's `CookieOptions`, so it is dropped here), which the article states plainly. The `IModule` counterpart framing is ADR-067's own (ADR-059 is the server-side contract). 2026-09-19
audit pass, against framework v1.205.0 (`MMCA.Common/FACTS.md:4,14`). Re-opened and re-pinned in this
pass: the `ui-e2e` job and its browser matrix in `ci.yml`, the `DataGridListPageBaseTests` fact count and
attribute lines, `DataGridListPageBase`, `MobileInfiniteScrollList` (which lives under
`Components/Lists/`), `NavItem`, `NavMenu`, `Routes.razor` and `MainLayout`. A `build-maui` job sitting
ahead of `ui-e2e` in `ci.yml` (`:199`) puts the workflow anchors about forty lines later than the
2026-08-20 pass recorded, and ordinary growth in the UI sources moved the rest. Not re-opened in this
pass, so their anchors remain the 2026-08-20 pass's against v1.155.0: the scorecard row citations, the
`app.css` `!important` block and the two section-level folds from that release's shared UI theme refresh,
both of which were verified in source rather than from the release notes at the time. (1) Theme override: the Theming section no longer claims the theme is not overridable.
`Components/MmcaThemeProviders.razor:11` now renders `<MudThemeProvider Theme="@Theme"
@bind-IsDarkMode="_isDarkMode" />` against `[Parameter] public MudTheme Theme { get; set; } =
MMCATheme.Instance;` (`:22`, its doc comment `:17-21`), so a consumer supplies a derived `MudTheme`
without forking the provider block or re-wiring the day/dark lifecycle behind it (`OnInitialized`
subscribe `:27`, `OnAfterRenderAsync` first-render resolve `:29-38` calling `ThemeService.InitializeAsync()`
at `:34`). Both stated limits were checked, not assumed: the brand tokens at `wwwroot/app.css:61-65` are
literal hex mirroring `Theme/BrandColors.cs` (the mirror comment is `:59-60`), so an overridden `MudTheme`
does not retheme the raw CSS rules; and every root layout found in source still renders
`<MmcaThemeProviders />` with no `Theme` attribute (`MMCA.Common.UI/Layout/MainLayout.razor:14`,
`MMCA.ADC.Engagement.UI/Layouts/PresenterLayout.razor:6`,
`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Components/Layout/MainLayout.razor:6`), so the
extension point is real but unexercised, which the paragraph says plainly. (2) Self-hosted Inter: five
`@font-face` blocks at `wwwroot/app.css:9-47` (weights 400, 500, 600, 700, 800, each with
`font-display: swap` and `src: url('fonts/inter-latin-<weight>-normal.woff2') format('woff2')`), with the
header comment `:1-8` supplying the same-origin `_content/MMCA.Common.UI/fonts/` path, the
`font-src 'self'` CSP fit "with no CDN allowance", the swap-versus-blocking-text rationale tied to
Core Web Vitals, and the silent fall-through to Segoe UI that the faces close. Files verified on disk:
`wwwroot/fonts/inter-latin-{400,500,600,700,800}-normal.woff2`, 23,664 to 24,452 bytes each (about 120 KB
for the five) plus `fonts/LICENSE-Inter.txt` (SIL OFL 1.1, unmodified Fontsource latin subsets). The
duplicated family name is real and is why the article names it: `Theme/MMCATheme.cs:92`
`FontFamily = ["Inter", "Segoe UI", "Helvetica Neue", "Arial", "sans-serif"]` with a keep-in-step comment
at `:89-91`, and `app.css:97-98` `html, body { font-family: 'Inter', ... }`. The CSP side of this change
is Article 47's to carry; this article takes only the UI-asset side.*

- Full series index: https://ivanball.github.io/writing.html
