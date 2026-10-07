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
wiring.

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

- **The contract is five members, three of them defaulted.** `NavItems`, `Assembly`,
  `AppBarComponentTypes`, `LayoutComponentTypes` and `ContentHeaderComponentTypes`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IUIModule.cs:14,17,20,23,29`); the
  last three default to `[]`, so a module that only contributes pages and navigation is two properties.
  A `NavItem` is a record of title, href, icon and a required `TitleResource` that makes the title
  and group resource keys, followed by three optional visibility gates (`RequiredRole`,
  `RequiredClaim`, `RequiredPermission`), a `NavSection` and an optional collapsible `Group`
  (`MMCA.Common.UI/Common/NavItem.cs:20`, ADR-027). The resource type
  is positional rather than optional so a nav entry cannot be declared with a literal title.
  `RequiredPermission` is matched against the principal's permission claims
  (`AuthClaimTypes.Permission`, compared ordinally, `MMCA.Common.Shared/Auth/ClaimsPrincipalExtensions.cs:94`),
  so an entry states the capability it needs rather than the role a given host grants it through.
- **The router discovers module pages at runtime from the registrations.** `Routes.razor` injects
  `IEnumerable<IUIModule>` (`MMCA.Common.UI/Routes.razor:7`) and hands
  `UIModules.Select(m => m.Assembly)` to the `Router`'s `AdditionalAssemblies`, with `AppAssembly`
  pinned to the shell's own assembly and `NotFoundPage` to the shipped 404 page (`:12-14`). Nothing in
  the shell names a module.
- **The shell ships the routable pages every app needs.** Home `/` (`MMCA.Common.UI/Pages/Home.razor:1`),
  Login `/login` and Register `/register` (`Pages/Auth/Login.razor:1`, `Pages/Auth/Register.razor:1`),
  the OAuth return page `/auth/oauth-complete` (`Pages/Auth/OAuthComplete.razor:1`), `/not-found`
  (`Pages/NotFound.razor:1`), `/forbidden` (`Pages/Forbidden.razor:1`), the account-recovery and
  session pages `/confirm-email`, `/forgot-password`, `/reset-password` and `/profile/sessions`
  (`Pages/Auth/ConfirmEmail.razor:1`, `ForgotPassword.razor:1`, `ResetPassword.razor:1`,
  `Sessions.razor:1`), and the notification surfaces `/notifications`, `/notifications/inbox` (plus
  `/notifications/inbox/{Id:int}`), `/notifications/send`
  (`Pages/Notifications/NotificationList.razor:1`, `NotificationInbox.razor:1-2`, `NotificationSend.razor:1`).
  A host that opts in with `Layout:HideNotificationPagesWhenUnregistered`
  (`MMCA.Common.UI/Common/Settings/LayoutSettings.cs:49`) and registers no `NotificationUIModule` gets
  the not-found page on those three routes instead (`Routes.razor:16`,
  `MMCA.Common.UI/Notifications/NotificationPageGate.cs:22`).
- **Unauthenticated and unauthorized both resolve inside the shell.** `AuthorizeRouteView` sends an
  anonymous visitor through `RedirectToLogin` and an authenticated-but-unauthorized one to the
  dedicated `Forbidden` page rather than a bare alert (`Routes.razor:29-52`, `RedirectToLogin` at `:43`,
  `Forbidden` at `:49`).
- **The nav menu is assembled from the registrations, trimmed per user.** `NavMenu` injects the same
  enumeration (`MMCA.Common.UI/Layout/NavMenu.razor:9`), flattens every module's `NavItems`, drops
  items whose `RequiredRole`, `RequiredClaim` or `RequiredPermission` the current principal does not
  carry (the three filters compose, each skipped when its property is null, `:257-259`), and splits the
  remainder into the General, My Account and Administration sections (`:262-264`).
- **Three component extension points render module-supplied types.** `MainLayout` reads
  `AppBarComponentTypes`, `LayoutComponentTypes` and `ContentHeaderComponentTypes` off the
  registrations (`MMCA.Common.UI/Layout/MainLayout.razor:155-157`) and renders them through
  `DynamicComponent` in the top app bar (`:48-51`, mirrored on the mobile top row at
  `NavMenu.razor:48-51`), as content headers inside the main landmark directly above the page body
  (`:79-82`), and at the root of the layout (`:120-123`), so a module can add an icon with a badge, a
  banner above the page, or a drawer without touching the layout.
- **Registration is one call.** `AddUIModule<TModule>()` runs the Scrutor scan for the module's entity
  services and then registers the descriptor as a singleton `IUIModule`
  (`MMCA.Common.UI/DependencyInjection.cs:319-329`); modules with extra services register the
  descriptor directly with `AddSingleton<IUIModule, TModule>()` after their own registrations
  (`MMCA.Common.UI/Notifications/DependencyInjection.cs:39`,
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/DependencyInjection.cs:76`).
- **MudBlazor is the single component vendor, and the framework's own contracts sit in front of it.**
  The shell, its pages and every module UI render MudBlazor components; nothing here mixes in a second
  component library. For toasts and yes/no confirmation a framework contract stands in front of the
  vendor (other vendor types, such as the `MudDataGrid<TDto>` that `ListPageActions` takes, are
  referenced directly: `ListPageActions.cs:5`, `:29`): `IToastService` and `IAppDialogService`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IToastService.cs`,
  `IAppDialogService.cs`, namespace `MMCA.Common.UI.Common.Interfaces`). `IToastService` carries the
  five severities every component library exposes and is fire-and-forget by design (during SSR
  pre-render there is no toast host, so the call is a silent no-op); `IAppDialogService` is one
  `ConfirmAsync`, where dismissing the prompt counts as declining, so a caller only ever branches on
  `true`. Both facades are registered by one extracted call, `AddCommonUiFacades()`, which
  TryAdd-registers `MudToastService` and `MudAppDialogService` over MudBlazor's `ISnackbar` and
  `IDialogService` (`MMCA.Common.UI/DependencyInjection.cs:227-230`). `AddUIShared` calls it (`:159`),
  and so does the shipped bUnit base
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.UI/Infrastructure/BunitComponentTestBase.cs:54`),
  so a component test resolves the two contracts without pulling in the rest of the shared-UI surface.
  The framework helpers that raise a toast take the toast facade
  (`MMCA.Common.UI/Common/ResultUiExtensions.cs:289-291`, and
  `ListPageActions.DeleteWithConfirmationAsync` at `MMCA.Common.UI/Pages/Common/ListPageActions.cs:61`).
  The delete confirmation is the component-side exception: `DeleteWithConfirmationAsync` asks its
  question through the `DeleteConfirmation` component it is handed (`ListPageActions.cs:58`, `:72`),
  and that component injects MudBlazor's `IDialogService` directly rather than going through
  `IAppDialogService` (`MMCA.Common.UI/Components/Forms/DeleteConfirmation.razor:2`, `:33`). Richer,
  entity-specific dialogs are inline, visibility-bound `<MudDialog @bind-Visible>` components rather
  than either service (for example
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Pages/Orders/ShipOrderDialog.razor:4-9`).

- **Blazor Web heads feed the same enumeration to the endpoint side.** `MapRazorComponents<App>()`
  takes the module assemblies from `GetServices<IUIModule>()` in addition to the shell assemblies
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:313-330`, which also de-duplicates at `:324`, and
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:274-284`), so the router's view and the
  endpoint's view of the routable assemblies come from one source.

Adoption today is every module UI in both apps plus the framework's own and its test host: ADC
Conference, Identity and Engagement
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/ConferenceUIModule.cs:14`,
`Identity/MMCA.ADC.Identity.UI/IdentityUIModule.cs:18`,
`Engagement/MMCA.ADC.Engagement.UI/EngagementUIModule.cs:17`); Store Catalog, Sales and Identity
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/CatalogUIModule.cs:13`,
`Sales/MMCA.Store.Sales.UI/SalesUIModule.cs:17`, `Identity/MMCA.Store.Identity.UI/IdentityUIModule.cs:15`);
the framework's own notification module
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationUIModule.cs:15`); and the
backend-less component gallery, whose stub descriptor is the only reason its `/components` page is
routable (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Stubs/GalleryUIModule.cs:14`,
registered at `GalleryHost.cs:91`). Two adopters are **host-only**: ADC's `DeviceUIModule` adds the
MAUI-only device settings page plus the deep-link listener
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/DeviceUIModule.cs:18`, registered at `MauiProgram.cs:161`), and
Store's `MauiUIModule` contributes no nav and no pages at all, existing purely to hang the native
theme sync on the layout extension point (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiUIModule.cs:14`,
registered at `MauiProgram.cs:81`). MMCA.Helpdesk deliberately does **not** adopt this: the seed's
Blazor head owns its own `Routes.razor` and `MainLayout` and never calls `AddUIShared`, because it has
no `ApiSettings`-backed client pipeline (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Program.cs:26-28`).

## Rationale
- **One composition model across both tiers.** A module already declares its server-side surface
  through `IModule` (ADR-059); declaring its UI surface through `IUIModule` means "add a module" is
  one registration on each side, not a host edit per contribution point.
- **The shell is the reusable part.** Router, layout, nav, sign-in, 404 and 403 are the same in every
  app built on this framework; shipping them in the package is what makes a new head a configuration
  exercise rather than a copy of another app's `Components` folder.
- **Defaulted members keep the common case small.** Most modules contribute pages and nav only, so
  `AppBarComponentTypes`, `LayoutComponentTypes` and `ContentHeaderComponentTypes` default to empty
  rather than forcing every descriptor to spell out three empty lists.
- **Runtime discovery beats a compile-time list.** Because the router reads the registrations, the
  same shell serves a web head, a WASM client and a MAUI hybrid head with different module sets, and a
  head-specific module (device settings, native theme sync) is just another registration that other
  heads never make.
- **Nav trimming belongs in one place.** Role and claim gating computed once in `NavMenu` gives every
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
- **`Assembly` is required even when it carries no route.** A host-only module that contributes only a
  layout component still has to return an assembly, which then joins `AdditionalAssemblies` and adds
  nothing; `MauiUIModule` documents exactly that (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiUIModule.cs:23-27`).
- **The contract carries no route-uniqueness or ordering guarantee.** Nothing checks that two modules
  declare different `@page` routes, and nav items render in DI registration order within their
  section, so the menu's top-level ordering is a function of the host's registration sequence rather
  than anything declared.
- **Descriptors are singletons with eagerly built `NavItems`.** Every adopter initializes the list in
  a property initializer, so nav content cannot depend on scoped state; per-user variation is limited
  to the `RequiredRole` / `RequiredClaim` / `RequiredPermission` filtering the shell applies at
  render time.
- **Hiding a nav item is not authorization.** The trimming in `NavMenu` is presentation only; route
  protection still comes from `AuthorizeRouteView` and the pages' own attributes (`Routes.razor:29-52`).
- **Blazor Web heads wire the assemblies twice.** The router's `AdditionalAssemblies` and the
  endpoint's `AddAdditionalAssemblies` are separate calls, so both hosts repeat the enumeration in
  `Program.cs` (`MMCA.ADC.UI.Web/Program.cs:313-330`, `MMCA.Store.UI.Web/Program.cs:274-284`); they
  derive it from the same `IUIModule` registrations, but the duplication is real. The two hosts also
  build the list differently: ADC concatenates and applies `.Distinct()` (`:323-324`), because the shell
  assemblies it lists can overlap a module's, while Store spreads the module assemblies into a
  collection expression with no de-duplication (`MMCA.Store.UI.Web/Program.cs:279-284`).
- **The reference seed does not demonstrate the pattern.** Helpdesk's hand-rolled shell means an
  adopter following it gets the framework's components but not this composition model.
- **One vendor is also one upstream ceiling, and the facades cover two surfaces only.** A MudBlazor
  limitation is the framework's limitation until upstream moves (ADR-063 records the accepted
  `MudTablePager` combobox exception to the WCAG 2.1 AA gate). Components still reference MudBlazor
  types directly, so `IToastService` / `IAppDialogService` shrink a vendor swap to a bounded project
  rather than making it a configuration change.

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

## Related
ADR-059 (the server-side `IModule` contract this mirrors in the presentation layer), ADR-056 (the
render-mode strategy for the web heads, which decides how these components render but not who supplies
them), ADR-027 (nav titles as resource keys via `TitleResource`), ADR-042 (the device-capability work
whose MAUI-only heads register host-only UI modules).
