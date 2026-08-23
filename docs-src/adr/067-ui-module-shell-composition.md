# ADR-067: Shared Blazor Application Shell and IUIModule Composition

## Status
Accepted (2026-08-07).

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

- **The contract is four members, two of them defaulted.** `NavItems`, `Assembly`,
  `AppBarComponentTypes` and `LayoutComponentTypes`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Common/Interfaces/IUIModule.cs:13,16,19,22`); the
  last two default to `[]`, so a module that only contributes pages and navigation is two properties.
  A `NavItem` is a record of title, href, icon, optional `RequiredRole` / `RequiredClaim`, a
  `NavSection`, an optional collapsible `Group`, and an optional `TitleResource` that turns the title
  and group into resource keys (`MMCA.Common.UI/Common/NavItem.cs:17`, ADR-027).
- **The router discovers module pages at runtime from the registrations.** `Routes.razor` injects
  `IEnumerable<IUIModule>` (`MMCA.Common.UI/Routes.razor:4`) and hands
  `UIModules.Select(m => m.Assembly)` to the `Router`'s `AdditionalAssemblies`, with `AppAssembly`
  pinned to the shell's own assembly and `NotFoundPage` to the shipped 404 page (`:7-9`). Nothing in
  the shell names a module.
- **The shell ships the routable pages every app needs.** Home `/` (`MMCA.Common.UI/Pages/Home.razor:1`),
  Login `/login` and Register `/register` (`Pages/Auth/Login.razor:1`, `Pages/Auth/Register.razor:1`),
  the OAuth return page `/auth/oauth-complete` (`Pages/Auth/OAuthComplete.razor:1`), `/not-found`
  (`Pages/NotFound.razor:1`), `/forbidden` (`Pages/Forbidden.razor:1`), and the notification surfaces
  `/notifications`, `/notifications/inbox`, `/notifications/send`
  (`Pages/Notifications/NotificationList.razor:1`, `NotificationInbox.razor:1`, `NotificationSend.razor:1`).
- **Unauthenticated and unauthorized both resolve inside the shell.** `AuthorizeRouteView` sends an
  anonymous visitor through `RedirectToLogin` and an authenticated-but-unauthorized one to the
  dedicated `Forbidden` page rather than a bare alert (`Routes.razor:11-29`).
- **The nav menu is assembled from the registrations, trimmed per user.** `NavMenu` injects the same
  enumeration (`MMCA.Common.UI/Layout/NavMenu.razor:8`), flattens every module's `NavItems`, drops
  items whose `RequiredRole` or `RequiredClaim` the current principal does not carry, and splits the
  remainder into the General, My Account and Administration sections (`:196-204`).
- **Two component extension points render module-supplied types.** `MainLayout` reads
  `AppBarComponentTypes` and `LayoutComponentTypes` off the registrations
  (`MMCA.Common.UI/Layout/MainLayout.razor:98-99`) and renders them through `DynamicComponent` in the
  top app bar (`:41-44`, mirrored on the mobile top row at `NavMenu.razor:41-43`) and at the root of
  the layout (`:80-83`), so a module can add an icon with a badge or a drawer without touching the
  layout.
- **Registration is one call.** `AddUIModule<TModule>()` runs the Scrutor scan for the module's entity
  services and then registers the descriptor as a singleton `IUIModule`
  (`MMCA.Common.UI/DependencyInjection.cs:152-162`); modules with extra services register the
  descriptor directly with `AddSingleton<IUIModule, TModule>()` after their own registrations
  (`MMCA.Common.UI/Notifications/DependencyInjection.cs:39`,
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/DependencyInjection.cs:69`).
- **Blazor Web heads feed the same enumeration to the endpoint side.** `MapRazorComponents<App>()`
  takes the module assemblies from `GetServices<IUIModule>()` in addition to the shell assemblies
  (`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI.Web/Program.cs:186-200`, which also de-duplicates, and
  `MMCA.Store/Source/Hosts/UI/MMCA.Store.UI.Web/Program.cs:201-212`), so the router's view and the
  endpoint's view of the routable assemblies come from one source.

Adoption today is every module UI in both apps plus the framework's own and its test host: ADC
Conference, Identity and Engagement
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/ConferenceUIModule.cs:14`,
`Identity/MMCA.ADC.Identity.UI/IdentityUIModule.cs:13`,
`Engagement/MMCA.ADC.Engagement.UI/EngagementUIModule.cs:17`); Store Catalog, Sales and Identity
(`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/CatalogUIModule.cs:13`,
`Sales/MMCA.Store.Sales.UI/SalesUIModule.cs:16`, `Identity/MMCA.Store.Identity.UI/IdentityUIModule.cs:13`);
the framework's own notification module
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Notifications/NotificationUIModule.cs:14`); and the
backend-less component gallery, whose stub descriptor is the only reason its `/components` page is
routable (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Gallery/Stubs/GalleryUIModule.cs:13`,
registered at `GalleryHost.cs:85`). Two adopters are **host-only**: ADC's `DeviceUIModule` adds the
MAUI-only device settings page plus the deep-link listener
(`MMCA.ADC/Source/Hosts/UI/MMCA.ADC.UI/DeviceUIModule.cs:19`, registered at `MauiProgram.cs:121`), and
Store's `MauiUIModule` contributes no nav and no pages at all, existing purely to hang the native
theme sync on the layout extension point (`MMCA.Store/Source/Hosts/UI/MMCA.Store.UI/MauiUIModule.cs:14`,
registered at `MauiProgram.cs:72`). MMCA.Helpdesk deliberately does **not** adopt this: the seed's
Blazor head owns its own `Routes.razor` and `MainLayout` and never calls `AddUIShared`, because it has
no `ApiSettings`-backed client pipeline (`MMCA.Helpdesk/Source/Hosts/UI/MMCA.Helpdesk.UI.Web/Program.cs:25-28`).

## Rationale
- **One composition model across both tiers.** A module already declares its server-side surface
  through `IModule` (ADR-059); declaring its UI surface through `IUIModule` means "add a module" is
  one registration on each side, not a host edit per contribution point.
- **The shell is the reusable part.** Router, layout, nav, sign-in, 404 and 403 are the same in every
  app built on this framework; shipping them in the package is what makes a new head a configuration
  exercise rather than a copy of another app's `Components` folder.
- **Defaulted members keep the common case small.** Most modules contribute pages and nav only, so
  `AppBarComponentTypes` and `LayoutComponentTypes` default to empty rather than forcing every
  descriptor to spell out two empty lists.
- **Runtime discovery beats a compile-time list.** Because the router reads the registrations, the
  same shell serves a web head, a WASM client and a MAUI hybrid head with different module sets, and a
  head-specific module (device settings, native theme sync) is just another registration that other
  heads never make.
- **Nav trimming belongs in one place.** Role and claim gating computed once in `NavMenu` gives every
  module the same behavior, instead of each module re-implementing `AuthorizeView` around its links.

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
  to the `RequiredRole` / `RequiredClaim` filtering the shell applies at render time.
- **Hiding a nav item is not authorization.** The trimming in `NavMenu` is presentation only; route
  protection still comes from `AuthorizeRouteView` and the pages' own attributes (`Routes.razor:11-29`).
- **Blazor Web heads wire the assemblies twice.** The router's `AdditionalAssemblies` and the
  endpoint's `AddAdditionalAssemblies` are separate calls, so both hosts repeat the enumeration in
  `Program.cs` (`MMCA.ADC.UI.Web/Program.cs:186-200`, `MMCA.Store.UI.Web/Program.cs:201-212`); they
  derive it from the same `IUIModule` registrations, but the duplication is real.
- **The reference seed does not demonstrate the pattern.** Helpdesk's hand-rolled shell means an
  adopter following it gets the framework's components but not this composition model.

## Related
ADR-059 (the server-side `IModule` contract this mirrors in the presentation layer), ADR-056 (the
render-mode strategy for the web heads, which decides how these components render but not who supplies
them), ADR-027 (nav titles as resource keys via `TitleResource`), ADR-042 (the device-capability work
whose MAUI-only heads register host-only UI modules).
