# ADR-067: Shared Blazor Application Shell and IUIModule Composition

## Status
Accepted (2026-08-07). Revised 2026-08-29: records the component-vendor choice (MudBlazor) that the
Context already scoped to this ADR, and the `IToastService` / `IAppDialogService` facades that keep
the vendor out of call sites. Revised 2026-08-31: records that the two facade registrations live in
their own `AddCommonUiFacades()` call, shared by `AddUIShared` and the shipped bUnit base. Revised
2026-09-19: records the third `NavItem` visibility gate, `RequiredPermission`, which the nav menu
filters on alongside `RequiredRole` and `RequiredClaim`. Revised 2026-09-25 (re-anchored the two
Blazor Web hosts' `MapRazorComponents` citations, which have moved, and named the ADC-only
`.Distinct()` in the double-wiring trade-off). Revised 2026-10-01 (re-anchored moved citations and
recorded the `Layout:HideNotificationPagesWhenUnregistered` opt-in). Revised 2026-10-06: records the
fifth contract member, `ContentHeaderComponentTypes`, as a third component extension point, and the
shell pages the route list omitted. Revised 2026-10-07: records that the delete confirmation bypasses
`IAppDialogService` (the `DeleteConfirmation` component injects MudBlazor's `IDialogService`
directly), scopes the facades to toasts and confirmation, and re-anchors the ADC Web host's assembly
wiring. Revised 2026-10-21: records that `AddCommonUiFacades()` also registers
`IPendingToastService` and is called directly by the Helpdesk Web head, names permission gating in
the nav-trimming rationale, and refreshes anchors that moved. Revised 2026-10-26: anchors refreshed
after both Blazor Web hosts gained an anonymous `MapStaticAssets()` call ahead of their assembly
wiring, and after `ResultUiExtensions.NotifyOnFailure` moved. Revised 2026-10-27: records the
`PublicAppBarComponentTypes` member added in MMCA.Common v1.265.0, an app bar slot rendered for every
visitor while `AppBarComponentTypes` stay signed-in only, lists the two contract members the Decision
had not named (`FooterComponentTypes`, `NotFoundContentType`), and re-anchors the `IUIModule`,
`MainLayout` and `NavMenu` citations. Revised 2026-10-28: anchors refreshed after both Blazor Web
hosts gained a `MapCommonServiceWorker()` call ahead of their assembly wiring. Revised 2026-11-04: records the `NavGroups` contract member and `NavItem.Order`, which let a
module describe a nav group (icon, initially expanded, order) by key and order its items. Revised
2026-11-23: records the ninth contract member (`NavGroups`) in the member count, the framework's
`TwoFactorUIModule` adopter and its page gate, the shared `GetMmcaRazorComponentAssemblies` helper
that replaced the per-host assembly wiring, declared nav ordering in the Trade-offs, the Store MAUI
module's device settings page, and anchors that moved.

Amended 2026-11-17 (MMCA.Common v1.301.0): the notification-page gate is unconditional (a host that
registers no `NotificationUIModule` answers the notification routes with the not-found page, and the
`Layout:HideNotificationPagesWhenUnregistered` and `Layout:ClearToastsOnNavigation` flags are
removed), `IAppDialogService.ConfirmAsync` opens the Cancel-first `ConfirmationDialog` and gains a
`destructive` overload, and `MainLayout` wraps the page body in an `ErrorBoundary` recovered on
navigation. See the Revision (2026-11-17) at the end.

## Context
ADR-059 decided how a module plugs into the **server**: an `IModule` implementation is discovered by
reflection, registered in topological order, and a host composes an application out of those modules
without knowing any of them by name. The presentation layer needed the same property, and for a while
did not have it: every Blazor head owned its own `App`/`Routes`/layout/nav markup, so adding a module
meant editing the host (a new nav link, a new assembly in the router, a new drawer in the layout), and
two apps built on the same framework drifted apart in shell behavior even where they agreed.

The framework already ships the whole shell as a package (`MMCA.Common.UI`): the router, the main
layout, the nav menu, and the pages every app has anyway (sign in, register, home, 404, 403, plus the
notification surfaces). What was missing was a contract letting a module contribute **into** that
shell instead of a host wiring it in by hand.

This is a UI-layer concern that neither existing ADR covers. ADR-059 stops at the server-side module
contract; ADR-056 decides which render mode the web heads run in, not who supplies the components
being rendered.

## Decision
Ship the application shell in the framework package and let each module plug into it by implementing
`IUIModule`, resolved from DI as `IEnumerable<IUIModule>`.

- **The contract is nine members, seven of them defaulted.** `NavItems`, `NavGroups`, `Assembly`,
  `AppBarComponentTypes`, `PublicAppBarComponentTypes`, `LayoutComponentTypes`,
  `ContentHeaderComponentTypes`, `FooterComponentTypes` and `NotFoundContentType`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IUIModule.cs:14,22,25,31,39,42,48,61,70`);
  `NavGroups` and the five component lists default to `[]` and `NotFoundContentType` to `null`, so a
  module that only contributes pages and navigation is two properties.
  A `NavItem` is a record of title, href, icon and a required `TitleResource` that makes the title
  and group resource keys, followed by three optional visibility gates (`RequiredRole`,
  `RequiredClaim`, `RequiredPermission`), a `NavSection` and an optional collapsible `Group`
  (`MMCA.Common.UI/Common/NavItem.cs:20`, ADR-027). The resource type
  is positional rather than optional so a nav entry cannot be declared with a literal title.
  `RequiredPermission` is matched against the principal's permission claims
  (`AuthClaimTypes.Permission`, compared ordinally, `MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:95-98`),
  so an entry states the capability it needs rather than the role a given host grants it through.
- **The router discovers module pages at runtime from the registrations.** `Routes.razor` injects
  `IEnumerable<IUIModule>` (`MMCA.Common.UI/Routes.razor:7`) and hands
  `UIModules.Select(m => m.Assembly)` to the `Router`'s `AdditionalAssemblies`, with `AppAssembly`
  pinned to the shell's own assembly and `NotFoundPage` to the shipped 404 page (`:11-13`). Nothing in
  the shell names a module.
- **The shell ships the routable pages every app needs.** Home `/` (`MMCA.Common.UI/Pages/Home.razor:1`),
  Login `/login` and Register `/register` (`Pages/Auth/Login.razor:1`, `Pages/Auth/Register.razor:1`),
  the OAuth return page `/auth/oauth-complete` (`Pages/Auth/OAuthComplete.razor:1`), the sign-in link
  page `/auth/sign-in-link` (`Pages/Auth/SignInLinks/SignInLink.razor:1`), `/not-found`
  (`Pages/NotFound.razor:1`), `/forbidden` (`Pages/Forbidden.razor:1`), the account-recovery and
  session pages `/confirm-email`, `/forgot-password`, `/reset-password` and `/profile/sessions`
  (`Pages/Auth/ConfirmEmail.razor:1`, `ForgotPassword.razor:1`, `ResetPassword.razor:1`,
  `Sessions.razor:1`), the two-factor account page `/profile/two-factor`
  (`Pages/Auth/TwoFactor/TwoFactorAccount.razor:1`), and the notification surfaces `/notifications`,
  `/notifications/inbox` (plus `/notifications/inbox/{Id:int}`), `/notifications/send`
  (`Pages/Notifications/NotificationList.razor:1`, `NotificationInbox.razor:1-2`, `NotificationSend.razor:1`).
  A host that registers no `NotificationUIModule` (it never called `AddNotificationUI()`) gets the
  not-found page on those routes instead, with no flag to set: the router asks
  `NotificationPageGate.Hides` and `TwoFactorPageGate.Hides` before `AuthorizeRouteView` runs
  (`MMCA.Common.UI/Routes.razor:15-25`), and the notification gate matches the three notification
  page types whenever no registered module is a `NotificationUIModule`
  (`MMCA.Common.UI/Notifications/NotificationPageGate.cs:14`, `:20-21`, `:26-27`). The two-factor gate
  does the same for its one page, `TwoFactorAccount`, whenever no registered module is a
  `TwoFactorUIModule` (a host that never called `AddTwoFactorUI()`,
  `MMCA.Common.UI/TwoFactor/TwoFactorPageGate.cs:18-19`, `:24-25`). On a server render either answer
  carries a 404 status (`Routes.razor:23-24`).
- **Unauthenticated and unauthorized both resolve inside the shell.** `AuthorizeRouteView` sends an
  anonymous visitor through `RedirectToLogin` and an authenticated-but-unauthorized one to the
  dedicated `Forbidden` page rather than a bare alert (`Routes.razor:28-51`, `RedirectToLogin` at `:42`,
  `Forbidden` at `:48`).
- **The nav menu is assembled from the registrations, trimmed per user.** `NavMenu` injects the same
  enumeration (`MMCA.Common.UI/Layout/NavMenu.razor:9`), flattens every module's `NavItems`, drops
  items whose `RequiredRole`, `RequiredClaim` or `RequiredPermission` the current principal does not
  carry (the three filters compose, each skipped when its property is null,
  `MMCA.Common.UI/Layout/NavMenu.razor.cs:125-127`), and splits the remainder into the General, My
  Account and Administration sections (`:130-132`).
- **Five component extension points render module-supplied types.** `MainLayout` reads the five
  component lists off the registrations (`MMCA.Common.UI/Layout/MainLayout.razor:192-196`) and renders
  them through `DynamicComponent`. The top app bar has two slots that differ only in who sees them:
  `PublicAppBarComponentTypes` render for every visitor, signed in or not, ahead of the culture and
  theme controls (`:44-47`), and `AppBarComponentTypes` render inside `AuthorizeView` for a signed-in
  user only (`:51-59`, the loop at `:55-58`); the mobile quick-actions row repeats both in the same
  order and with the same gate (`NavMenu.razor:44-47`, `:50-57`). Content headers render inside the
  main landmark directly above the page body (`MainLayout.razor:90-93`), footer components inside the
  page's one `contentinfo` footer (`:146-149`), and layout components at the root of the layout
  (`:154-157`), so a module can add a search box or an icon with a badge, a banner above the page, its
  own footer links, or a drawer without touching the layout. The not-found page renders the first
  registered `NotFoundContentType` in place of its default content
  (`MMCA.Common.UI/Pages/NotFound.razor:24-27`, `:49`).
- **The layout contains a failing page and clears stale toasts.** `MainLayout` renders the page body
  inside an `ErrorBoundary` (`MMCA.Common.UI/Layout/MainLayout.razor:97-109`), so a page that throws
  while rendering shows a page-error state with a Retry button in its place (`:101-108`) instead of
  ending the whole circuit. The router keeps the layout instance across navigations, so the layout
  subscribes to `LocationChanged` (`:202`) and recovers the boundary on every navigation
  (`:207-212`), giving the next page a fresh attempt. The layout also always renders
  `StaleToastSweeper` (`:152-153`), which removes toasts left over from the page being left; no
  setting turns it on or off.
- **Registration is one call.** `AddUIModule<TModule>()` runs the Scrutor scan for the module's entity
  services and then registers the descriptor as a singleton `IUIModule`
  (`MMCA.Common.UI/DependencyInjection.cs:485-495`, the scan at `:488-492`, the descriptor at `:494`);
  modules with extra services register the descriptor directly with `AddSingleton<IUIModule, TModule>()`
  after their own registrations (`MMCA.Common.UI/Notifications/DependencyInjection.cs:39`,
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/DependencyInjection.cs:90`).
  `AddTwoFactorUI()` registers its descriptor with
  `TryAddEnumerable(ServiceDescriptor.Singleton<IUIModule, TwoFactorUIModule>())`, so a host that
  calls it from two places registers the module once
  (`MMCA.Common.UI/TwoFactor/DependencyInjection.cs:31`).
- **MudBlazor is the single component vendor, and the framework's own contracts sit in front of it.**
  The shell, its pages and every module UI render MudBlazor components; nothing here mixes in a second
  component library. For toasts and yes/no confirmation a framework contract stands in front of the
  vendor (other vendor types, such as the `MudDataGrid<TDto>` a list page exposes through
  `DataGridListPageBase.GridRef`, are referenced directly:
  `MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:177`): `IToastService` and `IAppDialogService`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IToastService.cs`,
  `IAppDialogService.cs`, namespace `MMCA.Common.UI.Common.Interfaces`). `IToastService` carries the
  five severities every component library exposes and is fire-and-forget by design (during SSR
  pre-render there is no toast host, so the call is a silent no-op); `IAppDialogService` is
  `ConfirmAsync` in two overloads, the second adding a `destructive` flag that draws the confirming
  button in the error color for a delete, a lock or a sign-out
  (`MMCA.Common.UI/Common/Interfaces/IAppDialogService.cs:30`, `:45`). Dismissing the prompt counts as
  declining, so a caller only ever branches on `true`. Both overloads open `ConfirmationDialog`
  (`MMCA.Common.UI/Services/MudAppDialogService.cs:16-21`), which renders Cancel first and focused, so
  a stray Enter declines, and answers Escape and a backdrop dismissal as Cancel
  (`MMCA.Common.UI/Components/Forms/ConfirmationDialog.razor:6`, `:14-15`, `:24-27`, `:92`).
  Both facades are registered by one extracted call, `AddCommonUiFacades()`, which
  TryAdd-registers `MudToastService` and `MudAppDialogService` over MudBlazor's `ISnackbar` and
  `IDialogService` (`MMCA.Common.UI/DependencyInjection.cs:276-279`). The same call also
  TryAdd-registers `IPendingToastService` (`:280`), a toast parked in `sessionStorage` that survives
  a `forceLoad` navigation; its implementation names no vendor type (it wraps `IJSRuntime`,
  `MMCA.Common.UI/Services/PendingToastService.cs:13`), and the layout's `PendingToastHost`
  (`MainLayout.razor:20`) shows it through `IToastService`
  (`MMCA.Common.UI/Components/Notifications/PendingToastHost.razor:3`). `AddUIShared` calls it
  (`DependencyInjection.cs:185`), the Helpdesk Web head calls it directly
  (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Program.cs:25`), and so does the shipped bUnit base
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:54`),
  so a component test resolves the contracts without pulling in the rest of the shared-UI surface.
  The framework helpers that raise a toast take the toast facade
  (`MMCA.Common.UI/Common/ResultUiExtensions.cs:255-257`, `:276-278`, and
  `ListPageActions.DeleteWithConfirmationAsync` at `MMCA.Common.UI/Pages/Common/ListPageActions.cs:32`,
  its toast parameter at `:36`).
  The delete confirmation is the component-side exception: `DeleteWithConfirmationAsync` asks its
  question through the `DeleteConfirmation` component it is handed (`ListPageActions.cs:33`, `:47`),
  and that component injects MudBlazor's `IDialogService` directly rather than going through
  `IAppDialogService` (`MMCA.Common.UI/Components/Forms/DeleteConfirmation.razor:2`), though it opens
  the same `ConfirmationDialog`, destructive and with its own `confirm-delete` test id (`:9`,
  `:27-34`), so a delete prompt and a facade prompt have one shape. Richer,
  entity-specific dialogs are inline, visibility-bound `<MudDialog @bind-Visible>` components rather
  than either service (for example
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Pages/Orders/ShipOrderDialog.razor:4-9`).

- **Blazor Web heads feed the same enumeration to the endpoint side.** Both hosts pass
  `app.GetMmcaRazorComponentAssemblies(clientAssembly)` to `MapRazorComponents<App>()`'s
  `AddAdditionalAssemblies` (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:162`, `:165`;
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:121`, `:124`). The framework helper
  concatenates MMCA.Common.UI, MMCA.Common.UI.Web and the head's client assembly with the assembly of
  every registered `IUIModule` and removes duplicates, first occurrence kept
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hosting/BlazorWebHostExtensions.cs:225-243`,
  `.Distinct()` at `:241`), so the router's view and the endpoint's view of the routable assemblies
  come from one source.

Adoption today is every module UI in both apps plus the framework's own and its test host: ADC
Conference, Identity and Engagement
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/ConferenceUIModule.cs:31`,
`Identity/MMCA.ADC.Identity.UI/IdentityUIModule.cs:19`,
`Engagement/MMCA.ADC.Engagement.UI/EngagementUIModule.cs:22`); Store Catalog, Sales and Identity
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/CatalogUIModule.cs:16`,
`Sales/MMCA.Store.Sales.UI/SalesUIModule.cs:17`, `Identity/MMCA.Store.Identity.UI/IdentityUIModule.cs:14`),
where the Catalog shop search and the Sales cart button are the public app bar components, because a
signed-out shopper searches and fills a browser cart too (`CatalogUIModule.cs:31`, `SalesUIModule.cs:33`);
the framework's own two modules, the notification module
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationUIModule.cs:15`) and the
two-factor module, which contributes a My Account nav item and the `MultiFactorRequiredListener`
layout component (`MMCA.Common/Source/Presentation/MMCA.Common.UI/TwoFactor/TwoFactorUIModule.cs:16`,
`:24`, `:28`) and which Store registers through `AddTwoFactorUI()` in all three of its heads
(`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:71`,
`MMCA.Store.UI.Web.Client/Program.cs:43`, `MMCA.Store.UI/MauiProgram.cs:72`) while ADC does not; and
the backend-less component gallery, whose stub descriptor is the only reason its `/components` page is
routable (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Stubs/GalleryUIModule.cs:14`,
registered at `GalleryHost.cs:126`; by default the gallery also registers `NotificationUIModule` at
`:100` and calls `AddTwoFactorUI()` at `:116`, each behind a configuration gate that defaults to true,
`Gallery:NotificationUI` at `:97` and `Gallery:TwoFactorUI` at `:113`, which the not-found routing
tests set to false to leave that module out). Two adopters are **host-only**: ADC's `DeviceUIModule` adds the
MAUI-only device settings page plus the `DeepLinkListener`, `BiometricGate`,
`PushRegistrationListener` and `NativeThemeSync` layout components
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/DeviceUIModule.cs:18`, `:30`, registered at
`MauiProgram.cs:178`), and Store's `MauiUIModule` contributes a device settings nav item and page plus
the `DeepLinkListener`, `BiometricGate` and `NativeThemeSync` layout components
(`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiUIModule.cs:20`, `:27-30`, `:38`, `:40-45`, registered
at `MauiProgram.cs:107`). MMCA.Helpdesk deliberately does **not** adopt this: the seed's Blazor head
owns its own `Routes.razor` and `MainLayout` and never calls `AddUIShared`, because it has no
`ApiSettings`-backed client pipeline (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Program.cs:34-36`);
it registers the facades on their own with `AddCommonUiFacades()` instead (`:25`, reason at `:22-24`).

## Rationale
- **One composition model across both tiers.** A module already declares its server-side surface
  through `IModule` (ADR-059); declaring its UI surface through `IUIModule` means "add a module" is
  one registration on each side, not a host edit per contribution point.
- **The shell is the reusable part.** Router, layout, nav, sign-in, 404 and 403 are the same in every
  app built on this framework; shipping them in the package is what makes a new head a configuration
  exercise rather than a copy of another app's `Components` folder.
- **Defaulted members keep the common case small.** Most modules contribute pages and nav only, so
  `NavGroups` and the five component lists default to empty and `NotFoundContentType` to null, rather
  than forcing every descriptor to spell out seven empty members.
- **The authentication gate belongs to the slot, not to each component.** A signed-in-only control
  (the notification bell) and an every-visitor control (a storefront's search box or cart) need
  different visibility, and a single gated slot left the second kind no place in the app bar. Two
  slots keep `AppBarComponentTypes` exactly as gated as before, so no existing contributor changes
  behavior, and a public component that should still look different per sign-in state decides that
  itself (`IUIModule.cs:33-39`).
- **Runtime discovery beats a compile-time list.** Because the router reads the registrations, the
  same shell serves a web head, a WASM client and a MAUI hybrid head with different module sets, and a
  head-specific module (device settings, native theme sync) is just another registration that other
  heads never make.
- **Nav trimming belongs in one place.** Role, claim and permission gating computed once in `NavMenu` gives every
  module the same behavior, instead of each module re-implementing `AuthorizeView` around its links.
- **Why MudBlazor.** It is MIT-licensed with no per-developer or per-deployment cost, which suits a
  framework meant to be adopted by a new app for the price of a package reference. It is Material
  Design aligned, so it agrees with the touch-target and breakpoint contract the responsive guide
  already states rather than fighting it. And its component set matches what these apps actually are:
  data-dense internal-tool surfaces built out of grids, dialogs, drawers and forms. The commercial
  suites (Telerik, Syncfusion) buy grid-export depth, a large widget catalog and a support contract,
  which earn their licence on export-heavy or reporting-heavy products; no app in this workspace is
  one, so that spend would buy capability nobody uses.
- **The facades narrow what a vendor change touches.** Call sites that raise a toast or confirm
  through `IToastService` / `IAppDialogService` change with the two implementations, not one by one,
  and a bUnit test answers an `IAppDialogService` confirmation with a stub instead of driving a
  rendered dialog. The delete confirmation is outside that boundary (`DeleteConfirmation.razor:2`,
  `:33`), so a vendor change also touches that component, and a test of a delete flow cannot answer
  it through the facade stub.

## Trade-offs
- **`Assembly` is required even when it adds no route.** A module must return an assembly whether or
  not that assembly carries a new page. The framework's own `NotificationUIModule` and
  `TwoFactorUIModule` return MMCA.Common.UI's assembly
  (`MMCA.Common.UI/Notifications/NotificationUIModule.cs:27`, `MMCA.Common.UI/TwoFactor/TwoFactorUIModule.cs:31`),
  which is already the router's `AppAssembly` (`Routes.razor:11`), so their entry in
  `AdditionalAssemblies` adds nothing.
- **The contract carries no route-uniqueness guarantee, and ordering is opt-in.** Nothing checks that
  two modules declare different `@page` routes. Nav ordering is declared through `NavGroup.Order` and
  `NavItem.Order` (`MMCA.Common.UI/Layout/NavMenu.razor.cs:51-66`,
  `MMCA.Common.UI/Common/NavGroup.cs:23`, `MMCA.Common.UI/Common/NavItem.cs:27`; ADC declares its groups at
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/ConferenceUIModule.cs:97`), but both
  sorts are stable, so whatever a host leaves undeclared still renders in DI registration order.
- **Descriptors are singletons with eagerly built `NavItems`.** Every adopter initializes the list in
  a property initializer, so nav content cannot depend on scoped state; per-user variation is limited
  to the `RequiredRole` / `RequiredClaim` / `RequiredPermission` filtering the shell applies at
  render time.
- **Hiding a nav item is not authorization.** The trimming in `NavMenu` is presentation only; route
  protection still comes from `AuthorizeRouteView` and the pages' own attributes (`Routes.razor:28-51`).
- **Blazor Web heads read the assemblies in two places.** The router's `AdditionalAssemblies`
  (`Routes.razor:12`) and the endpoint's `AddAdditionalAssemblies` (fed by
  `GetMmcaRazorComponentAssemblies`, `MMCA.Common.UI.Web/Hosting/BlazorWebHostExtensions.cs:225-243`)
  are separate consumers of the same `IUIModule` registrations. Both live in the framework, so no
  host repeats the enumeration, but a change to how modules contribute assemblies has two places to
  agree.
- **The reference seed does not demonstrate the pattern.** Helpdesk's hand-rolled shell means an
  adopter following it gets the framework's components but not this composition model.
- **One vendor is also one upstream ceiling, and the facades cover two surfaces only.** A MudBlazor
  limitation is the framework's limitation until upstream moves (ADR-063 records the accepted
  `MudTablePager` combobox exception to the WCAG 2.1 AA gate). Components still reference MudBlazor
  types directly, so `IToastService` / `IAppDialogService` shrink a vendor swap to a bounded project
  rather than making it a configuration change. `IPendingToastService` adds no third vendor surface:
  it renders through `IToastService`.

## Revision (2026-10-01)
No decision or rationale changed. Re-anchored the citations that moved: `Routes.razor` (inject `:7`,
router `:12-14`, `AuthorizeRouteView` `:27-50`), `NavMenu.razor` (inject `:9`, filters `:254-256`,
section split `:259-261`, mobile top row `:45-48`), `MainLayout.razor:101-102`, `DependencyInjection.cs`
(`AddUIModule` `:273-282`, `AddCommonUiFacades` `:181-184`, called at `:121`), both `IdentityUIModule.cs:15`
and `DeviceUIModule.cs:18`. Also recorded a previously omitted opt-in: with
`Layout:HideNotificationPagesWhenUnregistered` set and no `NotificationUIModule` registered, the router
answers the notification routes with the not-found page
(`MMCA.Common.UI/Routes.razor:16`, `MMCA.Common.UI/Notifications/NotificationPageGate.cs:22`).

## Revision (2026-10-06)
- `IUIModule` now has five members, three defaulted: `ContentHeaderComponentTypes`
  (`IUIModule.cs:29`) joins the contract, and `MainLayout` renders it as a third extension point inside
  the main landmark above the page body (`MainLayout.razor:79-82`). Decision and Rationale updated.
- The shipped route list was incomplete: added `/confirm-email`, `/forgot-password`,
  `/reset-password`, `/profile/sessions` and the second inbox route `/notifications/inbox/{Id:int}`.
- The 2026-10-01 note that `IdentityUIModule.cs:15` was re-anchored was wrong for ADC: its class sits at
  `MMCA.ADC.Identity.UI/IdentityUIModule.cs:18` (Store's stays at `:15`).
- Anchors re-verified against current source and updated where they moved (`IUIModule.cs`,
  `Routes.razor`, `NavMenu.razor`, `MainLayout.razor`, `DependencyInjection.cs`,
  `BunitComponentTestBase.cs`, both Web hosts' `Program.cs`, `SalesUIModule.cs`, ADC `MauiProgram.cs`).

## Revision (2026-10-07)
Re-verified against current source. The contract, the shell, the router and nav composition and the
vendor choice are unchanged; one statement about the facades was too broad, and the ADC Web host's
assembly wiring moved.

1. `ListPageActions.DeleteWithConfirmationAsync` takes only the toast facade
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/ListPageActions.cs:61`). It asks its
   question through the `DeleteConfirmation` component parameter (`ListPageActions.cs:58`, `:72`), and
   that component injects MudBlazor's `IDialogService` directly
   (`MMCA.Common.UI/Components/Forms/DeleteConfirmation.razor:2`, `:33`), so the delete confirmation
   does not go through `IAppDialogService`. The Decision no longer says the vendor dialog type appears
   in exactly one implementation, names the delete confirmation as the component-side exception, and
   scopes the facades to toasts and confirmation (`ListPageActions` takes `MudDataGrid<TDto>` directly,
   `ListPageActions.cs:29`; entity dialogs are inline `MudDialog` components). The Rationale's
   facade bullet is narrowed to match: a vendor change and a bUnit confirmation stub reach only the
   call sites that use the facades.
2. Anchors re-verified against current source: ADC `MMCA.ADC.UI.Web/Program.cs` assembly wiring
   `:313-330` (`.Concat` `:323`, `.Distinct()` `:324`, the overlap comment `:314-315`), and
   `ResultUiExtensions.NotifyOnFailure` (`MMCA.Common.UI/Common/ResultUiExtensions.cs:289-291`).

## Revision (2026-10-21)
Re-verified against current source. The contract, the shell, router and nav composition, the vendor
choice and the Helpdesk non-adoption are unchanged; the facade registration grew a third contract,
gained a third caller, and several anchors moved.

1. `AddCommonUiFacades()` also TryAdd-registers `IPendingToastService` -> `PendingToastService`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:242`), a toast parked in
   `sessionStorage` that survives a `forceLoad` navigation and is shown by the layout's
   `PendingToastHost` (`MMCA.Common.UI/Layout/MainLayout.razor:19`) through `IToastService`
   (`MMCA.Common.UI/Components/Notifications/PendingToastHost.razor:3`). Its implementation wraps
   `IJSRuntime` and names no vendor type (`MMCA.Common.UI/Services/PendingToastService.cs:13`), so the
   Trade-offs statement that the facades cover two vendor surfaces stands, with a clarifying sentence.
2. The Helpdesk Web head calls `AddCommonUiFacades()` directly
   (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Program.cs:23`, reason at `:20-22`), the third
   caller beside `AddUIShared` and the bUnit base. The Decision now names it, and its no-`AddUIShared`
   citation moves to `Program.cs:32-34`.
3. The Rationale's nav-trimming bullet now names permission gating alongside role and claim, matching
   the three filters the Decision already lists.
4. Anchors re-verified against current source: `MainLayout.razor` (list reads `:156-158`, app bar
   `:50-53`, content header `:80-83`, layout root `:121-124`), `DependencyInjection.cs`
   (`AddUIModule` `:332-341`, `AddCommonUiFacades` `:238-242`, called from `AddUIShared` at `:167`),
   ADC `IdentityUIModule.cs:17` and `EngagementUIModule.cs:18`, Store `IdentityUIModule.cs:14`,
   `GalleryHost.cs:96`, ADC `MauiProgram.cs:167`, Store `MauiProgram.cs:87`. The 2026-10-06 revision's
   `MainLayout.razor:79-82` and its `IdentityUIModule.cs` line numbers are left as written there.

## Revision (2026-10-26)
Re-verified against current source. The contract, the shell, router and nav composition, the vendor
choice, the facades and the double-wiring trade-off (ADC de-duplicates, Store does not) are unchanged;
only anchors moved, because both Blazor Web hosts now map their static assets anonymously ahead of
the assembly wiring.

1. Anchors re-verified against current source: ADC `MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs`
   assembly wiring `:322-336` (`GetServices<IUIModule>()` `:322`, `.Concat` `:329`, `.Distinct()`
   `:330`, `MapRazorComponents<App>()` `:333`, `AddAdditionalAssemblies` `:336`, the overlap comment
   `:319-321`); Store `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs` wiring `:280-290`
   (`GetServices<IUIModule>()` `:280`, `MapRazorComponents<App>()` `:282`, the collection expression
   `:285-290` with the module spread at `:290`, still no de-duplication); and
   `ResultUiExtensions.NotifyOnFailure` (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/ResultUiExtensions.cs:255-257`
   for `Result`, `:276-278` for `Result<T>`). The 2026-10-07 revision's anchors are left as written
   there.

## Revision (2026-10-27)
Re-verified against MMCA.Common v1.265.0. The composition model, the router, the nav trimming, the
vendor choice and the facades are unchanged; the app bar gained a second contribution slot.

1. `IUIModule.PublicAppBarComponentTypes` (default empty,
   `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IUIModule.cs:25-31`) renders for
   every visitor ahead of the culture and theme controls, in `MainLayout`'s app bar
   (`MMCA.Common.UI/Layout/MainLayout.razor:43-46`) and in `NavMenu`'s mobile quick-actions row
   (`NavMenu.razor:44-47`). `AppBarComponentTypes` keep their signed-in-only gate
   (`MainLayout.razor:50-57`, `NavMenu.razor:50-57`). The Decision and Rationale now describe both
   slots; MMCA.Store's `CatalogUIModule` (shop search) and `SalesUIModule` (cart button) are the
   first adopters (`CatalogUIModule.cs:31`, `SalesUIModule.cs:33`).
2. The Decision named five contract members, but `FooterComponentTypes` (`IUIModule.cs:53`) and
   `NotFoundContentType` (`:62`) were already part of it. The contract is now stated as eight
   members, six defaulted, and the extension-points bullet names the footer slot
   (`MainLayout.razor:125-128`) and the not-found content (`Pages/NotFound.razor:23-25`, `:47`).
3. Anchors re-verified against current source: `IUIModule.cs:14,17,23,31,34,40,53,62`;
   `MainLayout.razor` (list reads `:173-177`, content header `:84-87`, layout root `:136-139`);
   `NavMenu.razor` (filters `:263-265`, section split `:268-270`); Store `CatalogUIModule.cs:16`. The
   2026-10-21 revision's `MainLayout.razor` anchors are left as written there.

## Revision (2026-10-28)
Re-verified against current source. The contract, the shell, router and nav composition, the vendor
choice, the facades, the Helpdesk non-adoption and the double-wiring trade-off (ADC de-duplicates,
Store does not) are unchanged; only anchors moved, mostly because both Blazor Web hosts now map
`/service-worker.js` with `MapCommonServiceWorker()` ahead of the assembly wiring
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:321`,
`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:281`).

1. Anchors re-verified against current source: ADC `MMCA.ADC.UI.Web/Program.cs` assembly wiring
   `:326-340` (`GetServices<IUIModule>()` `:326`, `.Concat` `:333`, `.Distinct()` `:334`,
   `MapRazorComponents<App>()` `:337`, `AddAdditionalAssemblies` `:340`, the overlap comment
   `:323-325`); Store `MMCA.Store.UI.Web/Program.cs` wiring `:284-294` (`GetServices<IUIModule>()`
   `:284`, `MapRazorComponents<App>()` `:286`, the collection expression `:290-294` with the module
   spread at `:294`, still no de-duplication); `HasPermissionClaim`
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:95-98`, the
   `AuthClaimTypes.Permission` check at `:98`); the Helpdesk Web head
   (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Program.cs`: `AddCommonUiFacades()` `:24`
   with its reason at `:21-23`, the no-`AddUIShared` note `:33-35`); `GalleryHost.cs:97`; Store
   `MauiProgram.cs:89`. The 2026-10-26 revision's anchors are left as written there.

## Revision (2026-11-04)
A module may describe nav groups by key through `IUIModule.NavGroups` (default empty): a
`NavGroup(Key, Icon, Expanded, Order)` sets the group's icon, whether it starts expanded, and its
position among the units of its section (each group, plus the section's ungrouped items as one unit
at order 0). A description applies to every module's items carrying that key, so a module can place
a group another module contributes (ADC places the framework's Notifications group last), and the
first registered description of a key wins, the same rule as `NotFoundContentType`. `NavItem.Order`
(init-only, outside the positional parameters so no constructor signature changed) orders an item
within its group or within the section's ungrouped items. Both sorts are stable, so an app that
declares neither renders exactly as before (`NavMenuOrderingTests` pins that default). The group
heading still resolves its key against the first registered item's `TitleResource`, so ordering the
items never changes which resource answers it. The nav logic moved to `NavMenu.razor.cs`.

Rejected: a group descriptor on `NavItem` itself, which every item of the group would repeat and two
items could contradict; and per-host configuration, because the group shape belongs to the modules,
which already own their items.

## Revision (2026-11-17)
Three shell behaviors changed in MMCA.Common v1.301.0 (MMCA.Common #758, the UI drift wave; plan in
the workspace `Docs/Planning/Drift/UiProjects-plan.md`). The contract, the router and nav
composition, the vendor choice and the Helpdesk non-adoption are unchanged.

1. **The notification-page gate is unconditional.** `Layout:HideNotificationPagesWhenUnregistered`
   is removed: a host that registers no `NotificationUIModule` answers `/notifications`,
   `/notifications/inbox` (with `/notifications/inbox/{Id:int}`) and `/notifications/send` with the
   not-found page
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Routes.razor:14-23`,
   `MMCA.Common.UI/Notifications/NotificationPageGate.cs:20-21`, `:26-27`). The gate lives in the
   shell's router, so it covers every head that uses that router, a MAUI head included, and a host
   no longer has to remember a flag to stop serving pages whose services it never registered.
   `Layout:ClearToastsOnNavigation` is removed too: `MainLayout` always renders `StaleToastSweeper`
   (`MMCA.Common.UI/Layout/MainLayout.razor:152-153`). The Decision bullet that described the opt-in
   now states the rule; the Revision (2026-10-01) and its anchors record the opt-in as it stood on
   that date.
2. **`IAppDialogService.ConfirmAsync` opens a Cancel-first dialog.** `ConfirmationDialog`
   (`MMCA.Common.UI/Components/Forms/ConfirmationDialog.razor`) replaces `DeleteConfirmationDialog`
   and is the one confirmation shape: Cancel is rendered first and takes initial focus, so a stray
   Enter declines, and Escape and a backdrop dismissal answer `false` (`:6`, `:14-15`, `:24-27`,
   `:92`). `MudAppDialogService` opens it from both overloads (`MMCA.Common.UI/Services/MudAppDialogService.cs:16-21`),
   and `DeleteConfirmation` opens it as a destructive prompt (`DeleteConfirmation.razor:27-34`).
   The new overload `ConfirmAsync(title, message, confirmText, cancelText, destructive)`
   (`MMCA.Common.UI/Common/Interfaces/IAppDialogService.cs:45`) draws the confirming button in the
   error color; the four-argument overload (`:30`) is the non-destructive case
   (`MudAppDialogService.cs:16-17`). `DeleteConfirmation` still injects MudBlazor's `IDialogService`
   directly (`DeleteConfirmation.razor:2`), so the component-side exception and its Rationale
   trade-off stand.
3. **The page body sits inside an `ErrorBoundary`.** A page that throws while rendering shows a
   page-error state with a Retry button instead of ending the circuit
   (`MMCA.Common.UI/Layout/MainLayout.razor:97-109`), and the layout recovers the boundary on every
   navigation (`:202`, `:207-212`), because the router keeps the same layout instance across pages.
   The Decision gains a bullet for it and for the always-on toast sweeper.

## Revision (2026-11-23)
Re-verified against current source. The composition model, the router, the nav trimming, the vendor
choice, the facades, the layout's error containment and the Helpdesk non-adoption are unchanged; the
member count, the adopter list, the endpoint wiring and two trade-offs had drifted, and many anchors
moved.

1. **Nine contract members, seven defaulted.** The Decision still said eight and six after the
   2026-11-04 revision added `NavGroups` (default `[]`,
   `MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IUIModule.cs:22`). The Decision
   and the Rationale's defaulted-members bullet now count it.
2. **A second framework adopter and a second page gate.** `TwoFactorUIModule`
   (`MMCA.Common.UI/TwoFactor/TwoFactorUIModule.cs:16`) contributes a My Account nav item (`:24`) and
   the `MultiFactorRequiredListener` layout component (`:28`); `AddTwoFactorUI()` registers it with
   `TryAddEnumerable`, so a repeated call registers it once
   (`MMCA.Common.UI/TwoFactor/DependencyInjection.cs:31`). Store registers it in its Web, WASM client
   and MAUI heads (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:71`,
   `MMCA.Store.UI.Web.Client/Program.cs:43`, `MMCA.Store.UI/MauiProgram.cs:72`); ADC does not. The
   router also asks `TwoFactorPageGate.Hides` (`MMCA.Common.UI/Routes.razor:15`), which answers the one
   page `TwoFactorAccount` (`/profile/two-factor`) with the not-found page when no
   `TwoFactorUIModule` is registered (`TwoFactor/TwoFactorPageGate.cs:18-19`, `:24-25`). The route
   list also gains `/auth/sign-in-link` (`Pages/Auth/SignInLinks/SignInLink.razor:1`) and
   `/profile/two-factor` (`Pages/Auth/TwoFactor/TwoFactorAccount.razor:1`).
3. **The endpoint wiring is one framework helper.** Both Blazor Web hosts now pass
   `app.GetMmcaRazorComponentAssemblies(clientAssembly)` to `AddAdditionalAssemblies`
   (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:165`,
   `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:124`), and the helper de-duplicates for
   both (`MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hosting/BlazorWebHostExtensions.cs:225-243`,
   `.Distinct()` at `:241`). The per-host divergence (ADC de-duplicates, Store does not) and the
   in-host repetition the double-wiring trade-off described are gone; the trade-off now states the
   remaining split between the router and the endpoint.
4. **Nav ordering is declarable.** The Trade-offs bullet still said top-level ordering was a function
   of registration order only. `NavGroup.Order` and `NavItem.Order` (`MMCA.Common.UI/Layout/NavMenu.razor.cs:51-66`,
   `MMCA.Common.UI/Common/NavGroup.cs:23`, `MMCA.Common.UI/Common/NavItem.cs:27`) order units and items, ADC declares its groups
   (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/ConferenceUIModule.cs:97`), and
   registration order is only the stable-sort default.
5. **Store's host-only module grew, and ADC's was under-described.** Store's `MauiUIModule` now
   contributes a device settings nav item and routable page plus the `DeepLinkListener`,
   `BiometricGate` and `NativeThemeSync` layout components
   (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiUIModule.cs:27-30`, `:38`, `:40-45`). ADC's
   `DeviceUIModule` did not change: the earlier revisions named only its deep-link listener, and the
   Decision now also lists the `BiometricGate`, `PushRegistrationListener` and `NativeThemeSync` layout
   components it already registered (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/DeviceUIModule.cs:30`). The
   Store change removed
   the `Assembly` trade-off's only example of a module with no route, so the trade-off now names the
   framework modules whose assembly is already the router's `AppAssembly`
   (`MMCA.Common.UI/Notifications/NotificationUIModule.cs:27`, `TwoFactor/TwoFactorUIModule.cs:31`,
   `Routes.razor:11`).
6. **The vendor-type example was wrong.** `ListPageActions` has no MudBlazor reference and takes no
   `MudDataGrid` (`MMCA.Common.UI/Pages/Common/ListPageActions.cs:5` is its namespace). The direct
   vendor reference the Decision illustrates is `DataGridListPageBase.GridRef`
   (`MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:177`). The 2026-10-07 revision's
   `ListPageActions` anchors are left as written there.
7. Anchors re-verified against current source: `IUIModule.cs:14,22,25,31,39,42,48,61,70` (the
   public app bar note `:33-39`); `Routes.razor` (router `:11-13`, gates `:15-25`, 404 status
   `:23-24`, `AuthorizeRouteView` `:28-51`, `RedirectToLogin` `:42`, `Forbidden` `:48`);
   `NavMenu.razor.cs` (filters `:125-127`, section split `:130-132`); `MainLayout.razor` (list reads
   `:192-196`, public app bar `:44-47`, signed-in app bar `:51-59`, content headers `:90-93`, footer
   `:146-149`, layout root `:154-157`, `PendingToastHost` `:20`); `DependencyInjection.cs`
   (`AddUIModule` `:485-495`, `AddCommonUiFacades` `:276-280`, called from `AddUIShared` at `:185`);
   ADC Engagement `DependencyInjection.cs:90`; `ListPageActions.cs` (`DeleteWithConfirmationAsync`
   `:32`, `DeleteConfirmation` `:33`, toast `:36`, `ShowAsync` `:47`); `NotFound.razor:24-27`, `:49`;
   ADC `ConferenceUIModule.cs:31`, `IdentityUIModule.cs:19`, `EngagementUIModule.cs:22`; ADC
   `MauiProgram.cs:178`; Store `MauiUIModule.cs:20`, `MauiProgram.cs:107`; `GalleryHost.cs:126`; the
   Helpdesk Web head (`AddCommonUiFacades()` `:25`, reason `:22-24`, no-`AddUIShared` note `:34-36`).
   The earlier revisions' anchors are left as written there.

## Related
ADR-059 (the server-side `IModule` contract this mirrors in the presentation layer), ADR-056 (the
render-mode strategy for the web heads, which decides how these components render but not who supplies
them), ADR-027 (nav titles as resource keys via `TitleResource`), ADR-042 (the device-capability work
whose MAUI-only heads register host-only UI modules).
