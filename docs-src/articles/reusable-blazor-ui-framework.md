# A list page in a few lines: a reusable Blazor UI framework with the same discipline as the backend

> Series: MMCA.Common · Article #37 (deep-dive) · Pillar P2,P5 · Group G15 · Rubric §18,§19,§20,§22,§23 · ADR-056 · ADR-067 · ADR-136 · ADR-146 ·
> Status: grounded in `MMCA.Common/Source/Presentation/MMCA.Common.UI` and `MMCA.Common.UI.Web/Pwa` (v1.319.0 source),
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
    protected override string Title => "Products";

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

## The list shell and the create base: the markup and the submit you stop rewriting

A base class takes the plumbing out of a page's code, but an admin list page still carries markup every such screen repeats: a header with a cancel-loading button, a search row with the page's filters, the grid or the phone list, empty and failure content with a retry, a pager, and a delete confirmation. `ListPageShell<TItem>` is that markup as one component, and it holds no paging, filter, sort, loading or persistence state of its own. Every such value arrives as a parameter from the page's `DataGridListPageBase`, and the page reaches the rendered grid, phone list and delete dialog through the shell's `Grid`, `MobileList` and `DeleteDialog`. The page supplies what differs, its `Columns` and its phone `CardTemplate`:

```razor
<ListPageShell TItem="CustomerDTO" @ref="_shell" Title="@Title"
               IsLoading="IsLoading" OnCancelLoading="CancelLoading"
               IsMobile="IsMobile" MobileFetch="FetchMobilePage"
               ServerData="LoadServerData" @bind-CurrentPage="CurrentPageState"
               LoadFailed="LoadFailed" EmptyConfirmed="EmptyConfirmed">
    <CardTemplate Context="item">@item.FirstName @item.LastName</CardTemplate>
    <Columns>
        <PropertyColumn T="CustomerDTO" TProperty="string" Property="x => x.FirstName" Title="First name">
            <CellTemplate>
                <RowLinkCell Href="@IdentityRoutePaths.CustomerDetails(context.Item.Id)">@context.Item.FirstName</RowLinkCell>
            </CellTemplate>
        </PropertyColumn>
    </Columns>
</ListPageShell>
```

The code-behind keeps one fetch method for both layouts: the grid's `ServerData` hands it to `LoadServerDataAsync`, and the inherited `MobilePageFetcher` turns the same method into the phone list's page delegate. The page's `GridRef` override reads `_shell?.Grid`, and `Grid` answers `null` while the phone layout is showing, so the base never pushes restored paging or sort into a grid that is not rendered. The defaults are the common case (search on, ten rows per page on both layouts, dense rows, delete confirmation on), and a page opts out per attribute, as Store's customer list does with `ShowSearch="false"`.

Inside a column, `RowLinkCell` wraps the cell text in a `MudLink` to the row's detail page, in the row's own color with no underline, so a keyboard, pointer or screen-reader user reaches the record through a real link instead of a mouse-only row click. It takes exactly two parameters, a required `Href` and the `ChildContent`, so a link that needs its own `aria-label` stays a plain `MudLink`.

The create form gets the same treatment. `CancellablePageBase` owns one page-scoped `CancellationTokenSource`, exposes it as `PageToken` (the lifetime token described below, so a read after dispose answers an already-cancelled token instead of throwing), and cancels and disposes the source exactly once. `DetailPageBase` and `CreatePageBase` both derive from it, so detail and create pages share one cancellation contract. `CreatePageBase` adds the injected toast service, the `Form` a page binds with `@ref="Form"`, `IsSaving`, `IsDirty` for the unsaved-changes guard, `SaveResult` for the error summary, `MarkDirty()` for each field, and one `SubmitAsync(saveAsync, onCreated, options)` call that runs the sequence a form would otherwise hand-write:

1. Ignore the submit when there is no form or a save is already in flight.
2. Validate, and stop on an invalid form with a warning toast.
3. Run the optional `PreCheck`, and stop on the message it returns.
4. Save through the page's delegate with `PageToken`.
5. On success, clear the dirty flag **before** calling the page's success step, so the unsaved-changes guard does not block the navigation that step performs.
6. On failure, keep the result for the error summary and raise the failure toast unless `ToastOnFailure` is off.
7. Answer `false` on a cancellation, and always end the saving state in a `finally`.

The page keeps its model, its fields and its service call; the order of those seven steps lives in one Common type. A fitness rule holds the convention: `FormsConventionTestsBase`'s `AdminCreateForms_InheritCreatePageBase` fails any `*Create.razor` form that does not derive from `CreatePageBase`. It checks the declaration, not the use: a form that declares the base but keeps a hand-written submit still passes, and only review catches it.

## The data-access boundary: bind to an interface, never to HttpClient

A page in this framework never injects a raw `HttpClient`. It injects `IEntityService<TEntityDTO, TIdentifierType>`, a generic CRUD contract: `GetAllAsync`, `GetPagedAsync`, `GetByIdAsync`, `AddAsync`, `UpdateAsync`, `DeleteAsync`, plus a `GetAllForLookupAsync` for dropdowns. Every member returns a `Result`, the same railway type the server produced. `GetPagedAsync` returns a `Result` wrapping an `(Items, TotalItems)` tuple shaped exactly for a server-side grid, and a missing entity from `GetByIdAsync` is a `NotFound` failure, never a success carrying null. A page branches on the outcome instead of catching an exception.

The behavior behind that interface comes from an abstract base, `EntityServiceBase<TEntityDTO, TIdentifierType>`. A concrete module service is mostly an endpoint string. Every verb routes through one dispatch chokepoint, `SendRequestAsync`, so retry, auth, and error handling are applied identically to every call. The error handling is the subtle, valuable part: the call runs through an `HttpResultExecutor` that turns transport faults into failures, and every response is read through a `ProblemDetailsResultReader` that rebuilds the server's structured Problem Details payload (a domain failure, a validation failure) as a `Result` with its original `ErrorType` intact. The base states the rule in source: nothing in it throws for a server answer, and the only exception that escapes is the caller's own cancellation. A backend `Result.Failure` therefore surfaces to the page as the server's real message and error type, not a generic "server error."

`EntityServiceBase` derives in turn from `AuthenticatedServiceBase`, which owns the two cross-cutting concerns of any outbound API call. One is a Polly retry policy: three retries with exponential backoff (0.5, 1, and 2 seconds plus up to 250 milliseconds of jitter, so a fast-failing call waits at most about 4.25 seconds in total before the failure surfaces) on `HttpRequestException` or a retryable status, meaning any 5xx except the permanent 501 and 505, plus 408 and 429, with each retried response disposed so a sustained outage does not leak connections. A 429 that names a `Retry-After` delay is waited out for exactly that delay instead of the backoff, and is not retried at all when the delay exceeds `HttpResilienceDefaults.MaxRetryAfterWait` (8 seconds), because a rate-limit window that will not reset within any wait worth holding the user for should surface at once. A status is retried only when re-sending is safe: GET, PUT, DELETE and the other idempotent verbs always are, while a POST or PATCH is retried only when its request carried an `Idempotency-Key` the server deduplicates on, because without one a retried create is a second request. The same rule gates the `HttpRequestException` arm: a POST or PATCH with no key is retried after a transport fault only when the fault happened before the request left the client (name resolution, the TCP connect, or the TLS handshake), since any later failure may already have reached the server. The other is stamping the JWT bearer token onto a freshly created `"APIClient"` `HttpClient` from `IHttpClientFactory`. That base exists for a precise Blazor Server reason, documented in source: `IHttpClientFactory` builds its handler chain in a separate DI scope from the Blazor circuit, so the conventional delegating handler cannot reach the circuit-scoped storage that holds the in-memory access token. Reading the token directly and setting the header on a fresh client is the smallest correct fix for that scope mismatch.

The shape is the same one the backend uses for everything: an interface the consumer programs against, a base class that carries the 80 percent, and a composition root that wires the transport. The UI is just another consumer of ports.

## Theming: one set of tokens, guarded by a fitness test

Visual consistency lives in one static `MudTheme`, exposed as `MMCATheme.Instance` and handed to `MudThemeProvider` by a shared component, `MmcaThemeProviders`, that a root layout drops in as a single tag. It defines a light palette, a dark palette, an Inter typography scale, and a 6px border radius.

That default is not a lock-in. `MmcaThemeProviders` takes an optional `Theme` parameter that defaults to `MMCATheme.Instance`, so an app with its own brand passes a derived `MudTheme` in one attribute instead of forking the provider block and re-implementing the day/dark lifecycle wired behind it. Two honest limits. The override reaches MudBlazor's own components and stops there: the raw CSS rules in `app.css` read their colors from `--mmca-*` custom properties whose literal hex mirrors `BrandColors`, so a host that swaps the theme object and nothing else gets rebranded Mud components sitting on framework-colored stylesheet rules. And the extension point is unexercised: every root layout across these repos renders `<MmcaThemeProviders />` bare, so "one theme everywhere" is the observed state rather than an enforced one.

The interesting move is what feeds it. The palette is a single C# source of truth, `BrandColors`: 42 `const` hex values, the six brand colors (a primary and a secondary, each with a darkened and lightened variant) plus the shared chrome, light-palette, and dark-palette values, so every hex value in both `MMCATheme` palettes is one of its constants. The catch is that raw CSS rules in `app.css` need the brand colors as custom properties, so those exist twice: once in C# for MudBlazor, once in CSS for stylesheet rules. That is a textbook drift hazard. The codebase neutralizes it with a fitness test, `BrandColorTokenTests`, which parses `app.css` and asserts each brand CSS token equals its `BrandColors` constant. If the two drift, the build fails before it ships.

This is the same "executable governance" idea the backend uses to enforce its layer rules: an invariant that matters is enforced by a test, not by hope and code review. And the color choices themselves carry accessibility reasoning. The theme's `Secondary` color is Teal 700 (around 5.3:1 on light surfaces) rather than Teal 600 (around 4.0:1, below the WCAG AA 4.5:1 floor for normal text), with the contrast calculation written into the source comment, because that color drives muted helper text.

The typography half of the theme has a quieter version of the same duplication problem. `MMCATheme` names `Inter` first in its font stack and `app.css` names it again on `html, body`, and with no faces shipped the stack would silently fall through to Segoe UI on Windows and to a generic sans-serif everywhere else: "professional typography" declared in two files and rendered in neither. So the package vendors the font rather than linking it: five latin-subset `woff2` files (weights 400 through 800, about 24 KB each) live under the package's `wwwroot/fonts` with their SIL OFL license, declared by five `@font-face` blocks at the top of `app.css` and served same-origin from `_content/MMCA.Common.UI/fonts/`. Two details there are deliberate. Self-hosting fits the host's existing `font-src 'self'` content-security policy with no CDN allowance to add, which is the kind of default worth taking when the alternative is loosening a header. And `font-display: swap` keeps first paint on the fallback face instead of blocking text, which is exactly what the LCP and FCP budgets in the Web Vitals E2E suite are watching. The cost is honest: roughly 120 KB of font in the package, latin glyphs only, and a family name that exists in two places with a comment in each asking you to keep them in step.

## Render-mode state persistence: no flash, no double fetch

Modern Blazor's `InteractiveAuto` renders a page up to three times: static SSR, then interactive Server, then WASM. Naively, each transition re-runs the data fetch, and the user sees a grid populate, blank, and re-populate. `DataGridListPageBase` solves this with Blazor's `PersistentComponentState`.

During the SSR pre-render pass, the base serializes the grid's already-fetched rows into a tiny private record, `PersistedGridState`, a `(List<TDto> Items, int TotalItems)` payload embedded in the pre-rendered HTML. On the first interactive `ServerData` call, the base takes that payload back out and returns it directly, skipping the round-trip entirely. The fetch-cancel-refetch flicker of the render-mode handoff disappears.

Navigation state is handled with a complementary principle: the URL is the source of truth. Paging, sort, and filter live in the query string (terse keys like `p`, `ps`, `s`, `sd`, `f:<name>`), so deep links and browser back-and-forward replay a list view exactly. A companion service codes state into and out of the address bar, emitting a key only when it differs from the default so a pristine list page yields a clean query-less URL, and using replace-history rather than push so each filter keystroke does not pollute the back stack. The noisier scroll position lives in a per-circuit `ListPageStateService` backed by an in-memory dictionary that mirrors through `sessionStorage`, so state survives circuit teardown, force-load navigations, and the SSR-to-WASM transition. URL plus memory plus session plus the prerender cache cover the full matrix of how a user can leave a list and come back to it.

## Component lifetime: a token that cannot throw, a load that cannot land late

Two more state failures belong to a component's lifetime rather than to any one fetch, and the package closes both once.

The first is teardown. A component owns a `CancellationTokenSource` that its `Dispose` cancels and disposes, and every awaited call takes its token. Reading `Token` off a disposed source throws `ObjectDisposedException`, so a load or handler that resumes after the user navigated away crashes the circuit instead of stopping. The extension `ComponentLifetimeExtensions.LifetimeToken` returns the live token while the source is live, and an already-cancelled token once the source is cancelled, disposed, or was never created, so late work ends through its ordinary `OperationCanceledException` path. `DataGridListPageBase` links every fetch to it, `CancellablePageBase` exposes it as `PageToken` to the detail and create page bases, and the package's own notification, session and role-admin pages pass `_cts.LifetimeToken()` to each call. A convention like that decays unless something checks it, so it is a fitness rule: `LifetimeTokenConventionTestsBase`, subclassed in Common, ADC and Store, fails on any direct `_cts.Token` read under the component root, and fails too when the scan reaches fewer code-behind files than expected, so a moved folder cannot turn the gate vacuous.

The second is ordering. Blazor reuses a routed component instance across route-parameter changes, so a page that opens entity 100 (slow) and then 101 (fast) receives 100's answer after 101 has rendered, and an unconditional assignment leaves the URL on 101 while the page holds 100. `LatestLoadGuard` gives each load a generation and a token, cancelling the load it supersedes:

```csharp
var (token, generation) = LoadGuard.Begin();
var result = await Service.GetByIdAsync(Id, cancellationToken: token);
if (!LoadGuard.IsCurrent(generation))
{
    return; // a newer load owns the page
}
```

`DetailPageBase` carries one for every detail page (ADC's public event, session and speaker detail pages among them), and the framework's role editor uses it directly, as do six ADC pages that are not detail pages: the speaker dashboard, the live-session and presenter views, the session and event feedback forms, and the room lookup on the session-create form. It is not thread-safe by contract: it is built for the renderer's synchronization context, where lifecycle methods and event callbacks are already serialized. The list base answers the same question its own way, returning the newest call's rows to every superseded call.

## The shell ships in the package too: modules plug in with IUIModule

A base class removes the duplication inside a page. The next duplication up is the application shell
itself: the router, the layout, the nav menu, and the handful of pages every app has anyway. Left to
each host, every Blazor head grows its own `Routes`, its own `MainLayout`, and its own nav markup,
and adding a module means editing all three.

`MMCA.Common.UI` ships that shell instead. The package owns the router, the main layout, the nav
menu, and the routable pages an app should not have to re-author: sign in, register, home,
not-found, forbidden, and the notification surfaces including the inbox. A module edits none of it.
It implements a nine-member interface, `IUIModule`, and registers itself:

```csharp
public interface IUIModule
{
    IReadOnlyList<NavItem> NavItems { get; }
    IReadOnlyList<NavGroup> NavGroups => [];
    Assembly Assembly { get; }
    IReadOnlyList<Type> AppBarComponentTypes => [];
    IReadOnlyList<Type> PublicAppBarComponentTypes => [];
    IReadOnlyList<Type> LayoutComponentTypes => [];
    IReadOnlyList<Type> ContentHeaderComponentTypes => [];
    IReadOnlyList<Type> FooterComponentTypes => [];
    Type? NotFoundContentType => null;
}
```

Seven of the nine have defaults (six empty lists and a null), so a module that contributes only pages
and navigation is two properties. `NavItems` are the module's links, each with an optional required role, claim or permission, so the
shell trims the menu to what the current user may actually reach. `Assembly` is how the module's
`@page` routes get discovered. `NavGroups` describes the menu's groups by key (an icon, whether the
group starts expanded, and its order within its section) for every module's items carrying that
group, and the first registered description of a key wins. The other six are extension points. Two feed the top app bar:
`AppBarComponentTypes` renders for a signed-in user only (a notification bell), while
`PublicAppBarComponentTypes` renders for every visitor, so Store's cart button and its site search
box work for a signed-out shopper too. The rest render at the root of the layout (a drawer, an
overlay), at the top of the main content region above the page body (a banner the user must see
first), inside the layout's footer landmark (an app's own footer links), and, for
`NotFoundContentType`, in place of the framework not-found page's default content, so an app can show
its own 404 (the first module to supply one wins).

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

## The installable web app: a service worker that never caches a page

A web head can sit on a phone home screen or install as a desktop app once it ships a web app manifest and, for an offline page, a service worker. The usual service worker recipe caches pages so the app opens offline, and on these hosts that recipe is a data leak. Every first page load is prerendered on the server, and on ADC and Store it renders under the HttpOnly session cookie, so a cached navigation would hand one user's prerendered page to whoever opens the app next on that device, and would keep showing a signed-out user their old pages.

So the dangerous rule lives in one reviewed place, the host-side package `MMCA.Common.UI.Web`, rather than in a per-app copy that could drift. A host calls `app.MapCommonServiceWorker()`, which maps `GET /service-worker.js` at the site root: anonymous, excluded from the OpenAPI description, and served with `Cache-Control: no-cache`. It is an endpoint rather than a static file for two reasons. A worker's scope is capped at its script's folder, and a Razor class library asset served from `/_content/<package>/` could control only that folder. And the script is an embedded resource into which the endpoint writes the package's informational version, so every framework release is a byte change the browser installs on its next update check. The worker itself is short, and its fetch handler is the whole policy:

```javascript
self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET' || request.mode !== 'navigate') {
        return;
    }

    event.respondWith((async () => {
        try {
            const preloaded = await event.preloadResponse;
            return preloaded || await fetch(request);
        } catch {
            const cache = await caches.open(CACHE);
            return (await cache.match(OFFLINE_URL)) || Response.error();
        }
    })());
});
```

Only GET navigations are handled. API calls, the Blazor circuit, hubs and framework files return from the handler untouched and take the browser's default network path. A navigation always goes to the network, with navigation preload enabled so routing it through the worker adds no latency, and only when the network fails does the worker answer with `/_content/MMCA.Common.UI.Web/offline.html`, the one response it precaches at install. Activation deletes every earlier version's offline cache. The browser half is `_content/MMCA.Common.UI.Web/pwa-register.js`, a separate file because the production content-security policy blocks inline script, which registers the worker with scope `/` only in a secure context and only after the page `load` event, so registration never competes with first paint.

A service worker is the one deployed artifact that outlives a rollback, because a bad one stays on a visitor's device until a newer one replaces it. Hence the kill switch: setting `Pwa:ServiceWorker:Enabled` to `false` makes the same endpoint serve a retired worker with no fetch handler that deletes the offline cache, and since the script is never cached, every installed client takes it on its next navigation. Retiring the worker is a configuration change, not a release. The host owns only its identity: ADC maps the worker next to its static assets in `Program.cs`, and its `App.razor` carries the manifest link, its teal `theme-color` and the register script tag. The honest limits: there is no offline content (an installed app shows the offline page for every navigation while offline, including pages just seen), the offline page is English-only, and the test gate on the never-cache rule is a text check for `cache.put(` and `cache.addAll(` calls, so a cache write of another shape would pass it and code review of the worker holds the rest.

## Trade-offs, honestly

- **This is opinionated UI infrastructure coupled to MudBlazor.** `DataGridListPageBase` is built around `MudDataGrid<T>`, `GridState<T>`, and MudBlazor's viewport observer. The base is reusable across your screens, but it is not framework-agnostic: swapping out MudBlazor would mean rewriting it. The trade is the usual one for a design system, a smaller surface and consistency in exchange for a hard dependency.
- **The test layer is thorough, and its residuals are narrow.** The shared primitives and the two mobile list components both carry a fast bUnit suite, a render-snapshot tier diffs their markup against committed baselines and fails the build on an unintended structural change, and Playwright axe (WCAG 2.1 AA) plus a render smoke run as a real-browser CI job against a self-hosted gallery, with all three engines (chromium, firefox, and webkit) blocking merge gates. The most logic-heavy component, the desktop `DataGridListPageBase`, carries its own direct bUnit suite (`DataGridListPageBaseTests`, 55 facts and two theories that drive the base through a concrete test page, covering initial load, grid filters translated into the fetch call, page and sort state mirrored to the URL, failed-`Result` and exception paths, error and cancel toast severities, superseded loads returning the newest rows, URL-driven restoration, density and scroll persistence, the mobile card path, the virtualized-window fetch path, and a regression guard for the disposed-token-source race), plus six sibling suites with 54 more test methods between them: a lifecycle suite that disposes the component mid-way through its first-render interop calls and restores session state late, a search-filter suite that keeps a free-text search and a column filter on the same column from overwriting each other, and filter-state, mobile-fetch, prerender-state and unknown-sort suites. What the layer does not cover is narrow: the visual check is markup-snapshot rather than pixel diffing, and there is no mutation testing on the core tier.
- **Render-mode handling is genuinely complex.** The three-channel persistence (URL, memory, session) plus the prerender cache, plus the `BL0005` suppressions to set the grid page from outside the component, plus catch-and-degrade around every JS interop call, is a lot of machinery. It is the right machinery for the InteractiveAuto lifecycle, but it is not simple, and it earns its keep only because it is written once.
- **There is still design-system residue, and it sits in the shell's own CSS.** MudBlazor is the only component library: the package ships no Bootstrap, and the shared `NavMenu` brand row is a plain flex row with no CSS framework classes. The residue the design-system scorecard names is narrower: the shared layout's scoped stylesheets (`NavMenu.razor.css`, `MainLayout.razor.css`) fight MudBlazor with dozens of `!important` declarations and some raw nav colors instead of tokens (one nav highlight spells the lightened primary as an `rgba()` value), and the brand family is still defined twice, in C# and in `app.css`, mirrored by the drift gate rather than sourced from one token. A second test in the same suite scans every UI stylesheet, scoped ones included, and fails on a brand hex written anywhere but the `app.css` token definitions. Inline styles are not part of it: an inline-style fitness test (`InlineStyleTests`) keeps styling in `app.css` or a component's scoped stylesheet, and the framework's razor markup carries none. The mobile infinite-scroll list is DOM-bounded by a `MaxRenderedItems` cap, so it is not part of that residue either. The dark palette clears its own contrast scan: the filled-primary button label and error-alert text take dark on-color text (`rgba(0,0,0,0.87)`), locked by a blocking dark-mode axe gate, so both light and dark modes are AA-gated. Client-side Web Vitals are measured too: a `WebVitalsE2ETests` suite asserts LCP, FCP, TTFB, CLS, and INP budgets against the gallery inside the required `ui-e2e` gate on all three engines (INP is skipped only where an engine cannot sample it), so a front-end-performance regression fails the build.

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

**What we covered:** why every list screen re-implements the same paging and loading plumbing, how `DataGridListPageBase<TDto>` folds it into one reusable Blazor base so a concrete page is tiny, how `ListPageShell<TItem>`, `RowLinkCell` and `CreatePageBase` take the list markup and the create-form submit sequence out of the page as well, how the `IEntityService` / `EntityServiceBase` / `AuthenticatedServiceBase` pipeline binds the UI to a DTO contract with Polly retry and server errors returned as `Result` values, how `MMCATheme` plus a `BrandColors` fitness test keep the design tokens from drifting, how `PersistentComponentState` and URL-as-source-of-truth kill the render-mode flash, how a lifetime token and `LatestLoadGuard` keep torn-down and superseded loads from crashing the circuit or landing on the wrong entity, how the package ships the application shell so a module plugs into it by implementing `IUIModule` instead of the host wiring it in by hand, how one `ITokenRefresher` interface with per-host implementations lets one component set run on Server, WASM, and MAUI, and how `MapCommonServiceWorker` makes a web head installable with a service worker that never caches a page and retires by configuration.

**Next in the series:** internationalization and theming, en-US and Spanish localization plus a
day/dark mode toggle, both persisted on one cookie-and-profile mechanism.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the UI-framework chapter of the onboarding guide, or `dotnet add package MMCA.Common.UI` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`

*Tags: .NET, Blazor, C Sharp, Front End, Software Architecture*

*Notes: 2026-11-25 refresh, re-verified 2026-11-25 against MMCA.Common v1.319.0 (`MMCA.Common/FACTS.md:14`). Paths below are
relative to `MMCA.Common/Source/Presentation/MMCA.Common.UI/` unless stated. Anchors marked "re-read 2026-11-25" were opened
this run; anything marked "carried" keeps its 2026-10-29 (or earlier) anchor and was not re-read this run. (1) DataGridListPageBase
(`Pages/Common/DataGridListPageBase.cs`, re-read 2026-11-25): errors go through `[Inject] protected IToastService Toast` (`:26`;
`ISnackbar` appears only inside the internal adapter `Services/MudToastService.cs`, carried); `LoadFailed` `:55`;
`protected abstract string Title` `:72`; `GridRef` is a get-only virtual property returning `null` (`:177`), so a page overrides
it rather than binding `@ref` to it; `LoadServerDataAsync` `:918`, answering through `NewestPagedResultAsync` (`:928`, defined
`:1054`); cancellation and exception toasts `Toast.Info` `:1348`, `Toast.Error` `:1364`; `MobilePageFetcher` `:968`; the fetch
CTS is linked to `LifetimeToken()` at `:1430-1431`; the viewport switch is in `NotifyBrowserViewportChangeAsync` (`:410`,
`IsMobileBreakpoint` call `:414`); `PersistedGridState` record `:1907`; rows-per-page restore
`RestoreCurrentPageAfterRowsPerPageReset` `:711`, called `:802`; `BL0005` suppressions `:400`, `:710`. The superseded-load,
persist-call and failed-`Result` anchors were not re-located this run (behavior carried). (2) Example page: an illustrative sketch
of a page that binds its own `MudDataGrid`. The adopting Store page
`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.UI/Pages/Customers/CustomerList.razor.cs` (re-read 2026-11-25) overrides
`Title` `:18`, reaches its grid through the list shell (`:23-24`), keeps one six-argument fetch method (`:27-29`) passed as a
method group to `LoadServerDataAsync` (`:31-32`, matching the base doc comment `DataGridListPageBase.cs:910`), and builds its phone
delegate with `MobilePageFetcher` (`:37-38`). The sketch's lambda calls the service directly because
`IEntityService.GetPagedAsync` (`Common/Interfaces/IEntityService.cs:31`, carried) takes seven parameters. (3) Data access
(EntityServiceBase anchors carried from 2026-10-22): `IEntityService.cs:20`, members `:25-66`, NotFound rule `:47-48`;
`EntityServiceBase` class `Services/Api/EntityServiceBase.cs:43`, doc `:14-30` (Problem Details and executor `:20-21`,
nothing-throws rule `:26-28`), `SendRequestAsync<T>` `:351`, `HttpResultExecutor` `:359`, `ProblemDetailsResultReader` `:366`,
non-generic overload `:381`. Polly (`Services/Api/AuthenticatedServiceBase.cs`, re-read 2026-11-25): policy doc `:21-36` (3
retries, 0.5 s / 1 s / 2 s plus up to 250 ms of jitter `:22-24`, about 4.25 s total wait `:25-27`, Retry-After cap `:30-33`,
disposal and Idempotency-Key `:34-35`), `RetryPolicy` `:37`, `"APIClient"` const `:39`, DI-scope rationale `:63-68`,
`IsRetryableResponse` `:157` (501/505 doc `:149`, check `:159`; Retry-After budget `:164`; replay check `:169`; 5xx/408/429
`:174-175`; Retry-After rationale `:153-155`), `IsReplaySafe` `:188` (doc `:179-184`, Idempotency-Key check `:200-201`),
`IsRetryableException` `:232-236` (doc `:225-230`), `DefaultBackoff` `:246-248` (doc `:241`), `RetryDelay` `:261-269` (doc
`:251-254`), `Handle<HttpRequestException>(IsRetryableException)` plus `WaitAndRetryAsync(3, ...)` `:294-297`, retried responses
disposed `:301`; `HttpResilienceDefaults.MaxRetryAfterWait` is 8 s
(`MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:40`, re-read 2026-11-25). (4) Token refresh
(carried): `ITokenRefresher` `Services/Auth/Tokens/ITokenRefresher.cs:17`, its one `Task<string?>` method `:24`;
`ISessionAwareTokenRefresher.cs:12` extends it, `TryAcquireAccessTokenAsync` `:17` (null-means-two-things rationale `:3-11`);
implementations `SameOriginProxyTokenRefresher.cs:16`, `DirectApiTokenRefresher.cs:41`, `HandoffTokenRefresher`
(`MMCA.Common.UI.Web/SameOriginProxy/HandoffSessionServices.cs:14`, internal), swapped in by `AddCommonSameOriginApiProxy`,
enabled by ADC (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:168`). `Services/Auth/IAuthUIService.cs`:
`RequestPasswordResetAsync` `:60`, `ResetPasswordAsync` `:67`, `GetSessionsAsync` `:75`, `RevokeSessionAsync` `:84`,
`RevokeAllSessionsAsync` `:94`. (5) Theme (carried): `BrandColors` 42 `public const string` values (`Theme/BrandColors.cs:13-154`),
doc `:4-8`, Teal 700 comment `:22-23`; `MMCATheme` carries no hex literal outside comments; `MMCATheme.Instance`
`Theme/MMCATheme.cs:11`, dark `PrimaryContrastText` `:71`, `ErrorContrastText` `:98`, `FontFamily` `:148`, `DefaultBorderRadius`
`:222`; `Theme/MmcaThemeProviders.razor:14` and `:36`; `BrandColorTokenTests`
(`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Theme/BrandColorTokenTests.cs:34-40`, stylesheet hex scan
`UiStylesheets_NeverHardcodeABrandHex_OutsideTheAppCssTokenDefinitions` `:52-53`); CSS mirror `wwwroot/app.css:63-67`,
`html, body` Inter `:133-134`. Bare `<MmcaThemeProviders />`: `Layout/MainLayout.razor:16`. Fonts: five
`wwwroot/fonts/inter-latin-NNN-normal.woff2` files (400, 500, 600, 700, 800; 23,664 to 24,452 bytes) beside
`fonts/LICENSE-Inter.txt` (SIL Open Font License 1.1, `:4`), declared by five `@font-face` blocks (`wwwroot/app.css:9`, `:17`,
`:25`, `:33`, `:41`). (6) Design-system residue (carried): Bootstrap note `wwwroot/app.css:173`; 42 `!important` (28 in
`Layout/NavMenu.razor.css`, 14 in `Layout/MainLayout.razor.css`, counted 2026-10-29); the prose says "dozens". The `rgba()` nav
highlight is `Layout/NavMenu.razor.css:190` (`rgba(66, 165, 245, 0.16)`, the `PrimaryLight` channels, invisible to the hex scan).
Inline styles: `InlineStyleTests : InlineStyleTestsBase`
(`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Ui/ComponentConventions/InlineStyleTests.cs:12`). Scorecard row 20
(`Website/docs-src/governance/common-ArchitectureScorecard.md:84`, carried). (7) Tests and gates, counted by Grep 2026-11-25 under
`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Pages/Common/`: `DataGridListPageBaseTests.cs` 57 `[Fact]`/`[Theory]`
attributes, 2 of them `[Theory]` (`:940`, `:1150`), so 55 facts; `DataGridListPageBaseLifecycleTests.cs` 4,
`DataGridListPageBaseSearchFilterTests.cs` 4, `DataGridListPageBaseFilterStateTests.cs` 15,
`DataGridListPageBaseMobileFetchTests.cs` 25, `DataGridListPageBasePrerenderStateTests.cs` 4,
`DataGridListPageBaseUnknownSortTests.cs` 2; 111 across seven files, 54 outside the main suite. The coverage list for the main
suite and the lifecycle and search-filter descriptions are carried from 2026-10-29; the four newer suites are named by file only.
Web Vitals `MMCA.Common/Tests/Presentation/MMCA.Common.UI.E2E.Tests/WebVitals/WebVitalsE2ETests.cs:19-23`, `:47-48`, `:104`
(carried). `MMCA.Common/.github/workflows/ci.yml` `ui-e2e` job (carried). (8) Shell: `Common/Interfaces/IUIModule.cs:11` (nine
members, re-read 2026-11-25): `NavItems` `:14`, `NavGroups` `:22` (default `[]`, doc `:16-21`, first registered description of a
key wins `:18-19`), `Assembly` `:25`, `AppBarComponentTypes` `:31` (signed-in only, doc `:27-30`), `PublicAppBarComponentTypes`
`:39` (every visitor, doc `:33-38`), `LayoutComponentTypes` `:42`, `ContentHeaderComponentTypes` `:48`, `FooterComponentTypes`
`:61`, `NotFoundContentType` `:70` (first registered wins, doc `:63-69`). Carried: collected at
`Layout/MainLayout.razor:173-177`, not-found override `Pages/NotFound.razor:23`, `:47`; Store uses
`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/SalesUIModule.cs:33` (`CartButton`), `CatalogUIModule.cs:31`
(`StoreSearchBox`), `:34` (`StoreFooterLinks`), `:37` (`StoreNotFound`); `Routes.razor:7`, `:13`; `Common/NavItem.cs:20`
(`RequiredRole`, `RequiredClaim`, `RequiredPermission`); `Layout/NavMenu.razor:9`, `:257-264`. Mobile (carried):
`Common/BreakpointConstants.cs:13`, `:16`; `Components/Lists/MobileInfiniteScrollList.razor.cs:52` (cap 500), `:183`, `:241-242`
(`HasMoreAfter`); the sketch's two-line comment abridges the doc comment at `:235-240`. Adopter files (carried): ADC
`IdentityUIModule.cs`, `ConferenceUIModule.cs`, `EngagementUIModule.cs`, `DeviceUIModule.cs`; Store `IdentityUIModule.cs`,
`CatalogUIModule.cs`, `SalesUIModule.cs`, `MauiUIModule.cs`; Helpdesk keeps its own `Routes.razor` and `MainLayout`
(`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Components/Routes.razor`, `Components/Layout/MainLayout.razor`). (9) Component
lifetime: `Pages/Common/CancellablePageBase.cs:27` (`PageToken => _cts.LifetimeToken()`, re-read 2026-11-25); carried:
`Common/ComponentLifetimeExtensions.cs:18`, `LifetimeToken` `:26-42`; `Pages/Common/DetailPageBase.cs` `LoadGuard`; framework page
uses `Pages/Notifications/NotificationInbox.razor.cs:227`, `Pages/Auth/Sessions.razor.cs:93`,
`Pages/Administration/RoleAdminList.razor.cs:121`; fitness rule
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Rules/Ui/ArchitectureRules.LifetimeTokens.cs:28` (missing root `:34`,
minimum code-behind `:49-51`), base `Bases/Ui/LifetimeTokenConventionTestsBase.cs:13`; subclasses in Common, ADC and Store
(`.../Ui/LifetimeTokenConventionTests.cs` in each Architecture.Tests project), none in MMCA.Helpdesk. `Common/LatestLoadGuard.cs:38`,
100-versus-101 rationale `:6-9`, not-thread-safe contract `:33`, `Begin` `:50-59`, `IsCurrent` `:67`; direct uses
`Pages/Administration/RoleAdminEdit.razor.cs:42`, `:162`, `:174`; the six ADC direct uses under `MMCA.ADC/Source/Modules/`:
`Conference/MMCA.ADC.Conference.UI/Pages/Speakers/SpeakerDashboard.razor.cs:43`,
`Conference/MMCA.ADC.Conference.UI/Pages/Sessions/SessionCreate.razor.cs:33`,
`Engagement/MMCA.ADC.Engagement.UI/Pages/SessionLive/SessionLive.razor.cs:50`, `.../SessionLive/PresenterView.razor.cs:43`,
`Engagement/MMCA.ADC.Engagement.UI/Pages/Feedback/SessionFeedback.razor.cs:39`, `.../Feedback/EventFeedback.razor.cs:42`; the three
public detail pages inherit `DetailPageBase` (`Conference/MMCA.ADC.Conference.UI/Pages/Public/Events/PublicEventDetail.razor:5`,
`.../Public/Sessions/PublicSessionDetail.razor:8`, `.../Public/Speakers/PublicSpeakerDetail.razor:6`). Onboarding treatment
`Website/docs-src/onboarding/group-15-common-ui-framework.md:178`, `:191` (carried). The lifetime sketch passes the token by name,
as `Common/ResultUiExtensions.cs:47` and `:63` do (carried). (10) Installable web app (ADR-136,
`Website/docs-src/adr/136-installable-web-app-service-worker.md`, carried from 2026-10-29) under
`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/`: `Pwa/ServiceWorkerEndpointExtensions.cs:15`, path const `:18`, `EnabledKey`
`"Pwa:ServiceWorker:Enabled"` `:24`, version stamp `:26`, `:80-83`, never-cache and kill-switch docs `:40-56`,
`MapCommonServiceWorker` `:60` (no-cache `:63`, default `true` `:64`, `AllowAnonymous` `:69`, `ExcludeFromDescription` `:70`);
`Pwa/service-worker.js` (offline URL `:12`, install precache `:14-19`, old-cache delete `:24-26`, navigation preload `:30-31`, fetch
handler quoted verbatim `:38-53`); `Pwa/service-worker-retired.js` (cache delete `:10-13`); `wwwroot/pwa-register.js`
(secure-context check `:5`, scope `/` `:10`, after `load` `:13-17`, CSP rationale `:2-3`); gate
`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Web.Tests/Pwa/ServiceWorkerEndpointTests.cs:45-51`. ADC adoption:
`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:321`, `Components/App.razor:36`, `:38` (`theme-color` `#0D7377`), `:55`.
(11) List shell and create base (ADR-146, `Website/docs-src/adr/146-ui-page-bases-and-list-shell.md`, re-read 2026-11-25; source
re-read 2026-11-25): `Components/Lists/ListPageShell.razor.cs:23`, state-free remarks `:17-22`, `ShowSearch` default `true` `:50`,
`IsMobile` `:72`, `MobileFetch` `:77`, `CardTemplate` `:82`, `MobilePageSize` 10 `:95`, `ServerData` `:100`, `RowsPerPage` 10
`:109`, `Dense` `true` `:112`, `Columns` `:117`, `ShowDeleteConfirmation` `true` `:135`, `Grid` null on a phone `:141`, `MobileList`
`:144`, `DeleteDialog` `:147`; rendered regions and the restored-state guard per ADR-146 (`ListPageShell.razor:7-79`,
`DataGridListPageBase.cs:713-715`, `:792-794`, `:824-832`, cited from the ADR, not re-read). `Components/Lists/RowLinkCell.razor:4`
(`MudLink`, `Color.Inherit`, `Underline.None`), rationale `:1-3`, `Href` required `:8`, `ChildContent` `:11`.
`Pages/Common/CancellablePageBase.cs:16`, `_cts` `:18`, `PageToken` `:27` (no-throw doc `:22-26`), `Dispose(bool)` once `:41-55`,
derivers named `:9-10`. `Pages/Common/CreatePageBase.cs:21`, `Toast` `:24`, `Form` `:27`, `IsSaving` `:30`, `IsDirty` `:33`,
`SaveResult` `:36`, `MarkDirty` `:39`, `SubmitAsync` `:53-56`; steps: no form or in flight `:61-64`, validate `:67-73`, pre-check
`:75-80`, save with `PageToken` `:82-85`, success clears dirty before `onCreated` `:86-91`, failure keeps result and toasts
`:94-100`, cancellation `:102-105`, `finally` `:106-109`. Shell sketch abridged from
`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.UI/Pages/Customers/CustomerList.razor:10-17`, `:22-27`, `:35-40`
(localizer calls replaced by literals, cancel labels, `RowsPerPage`, `EmptyMessage`, `DeleteEntityType`, header actions, card
actions and the other columns dropped); `ShowSearch="false"` `:13`. Gate
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Ui/FormsConventionTestsBase.cs:179`
(`AdminCreateForms_InheritCreatePageBase`), `:199` (`AdminCreateForms_KeepUnsavedChangesGuardAndValidation`); declaration-not-use
limit per ADR-146 Trade-offs. `MobileCardList` and `PageStateScope` are absent from `MMCA.Common/Source` (Glob 2026-11-25), so the
article does not name them. Header: Rubric and ADR cells follow the series index row (`Website/docs-src/articles/README.md:47`);
ADR-146 added to the header this run. History: first written with the 2026-07-27 responsive section, IUIModule section added
2026-08-07 (ADR-067), audit passes 2026-08-14, 2026-08-20, 2026-09-19 (v1.205.0), 2026-10-02 (v1.221.0), 2026-10-08 (v1.233.0),
2026-10-22 and 2026-10-29 (the eight-member `IUIModule`, the Store cart on the public app bar, the 429 `Retry-After` wait and its
8 s cap, six ADC direct `LatestLoadGuard` uses, the installable-web-app section for ADR-136). 2026-11-25 pass: `IUIModule` grows to
nine members with the defaulted `NavGroups` (`IUIModule.cs:22`), so seven of nine are defaulted; the Polly backoff is corrected to
0.5 / 1 / 2 s plus up to 250 ms of jitter (the prior text said 2 / 4 / 8 s plus up to a second, contradicted by
`AuthenticatedServiceBase.cs:22-24`, `:246-248`); `DataGridListPageBaseTests` counts move from 47 facts and a theory to 55 facts
and two theories, and the sibling suites from two to six (111 attributes across seven files); `PageToken` is attributed to
`CancellablePageBase`; the list-shell and create-base section is added (ADR-146); every anchor in `DataGridListPageBase.cs`,
`AuthenticatedServiceBase.cs` and `IUIModule.cs` re-anchored; framework stamp moved to v1.319.0.*

- Full series index: https://ivanball.github.io/writing.html
