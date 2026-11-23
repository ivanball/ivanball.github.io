# ADR-094: Client-Side Entity Data-Access Contract

## Status
Accepted (2026-08-23). Revised 2026-08-31: `GetByIdAsync` is recorded with its real signature (`id`,
`includeChildren`, `CancellationToken`; a missing entity is a `NotFound` failure, there is no
`treatNotFoundAsDefault` switch), `ChildEntityServiceBase` is recorded with both `PostAsync` overloads
and with a missing join row answering `NotFound` rather than `false`, and the line anchors into
`EntityServiceBase`, `IEntityService`, `ChildEntityServiceBase`, `DataGridListPageBase` and the
idempotency-retry tests are re-pinned. Revised 2026-09-19: the optional client read cache and the
`If-Match` conditional-write header are recorded as part of the contract, and the adoption inventory
is recounted. Revised 2026-10-01 (Blazor Server per-circuit UI state is recorded as a fitness-enforced rule, and Store's
`CartStateService` now derives from `AuthenticatedServiceBase`; see Revision below). Revised 2026-10-06: the retry
policy is recorded as never replaying a POST or PATCH that carries no `Idempotency-Key`, write
invalidation as skipping only a pre-write rejection, and the direct-root count as twenty-two (see
Revision below). Revised 2026-10-07: the opt-in same-origin proxy base address and handler, the
shared Aspire handler's refusal to retry POST and PATCH, and the `IdempotentReadRetry` GET path for
read services outside the hierarchy are recorded, and the `IsNotFound` anchor is corrected.
Revised 2026-10-19: Store's two Sales lookup services now run their GETs through `IdempotentReadRetry`, so the helper has eleven call sites across both apps.
Revised 2026-10-21: the retry policy is recorded with its transport-failure arm (a keyless POST or PATCH is resent only when it failed before it was sent), the `EntityServiceBase` count is twenty with the two `UserListService` types, the list-page base's opt-in virtualized fetch path is recorded, and anchors are refreshed.
Revised 2026-10-26: the client retry policy and the shared Aspire handler are recorded as refusing a 429 whose `Retry-After` exceeds `MaxRetryAfterWait` (a shorter one is waited out in place of the backoff), the list-page base's superseded-load handling, `EmptyConfirmed` flag and aliased page-filter keys are recorded, and anchors are refreshed.
Revised 2026-10-28: Store's new `BestSellerService` and `CheckoutApiService` raise the `IdempotentReadRetry` call sites to twelve across nine files and the direct `AuthenticatedServiceBase` count to twenty-three, and Store anchors are refreshed; `CheckoutApiService` mints one key per guest action (three) and `CartStateService` one per add request, merged guest-cart lines included.

Amended 2026-11-17 (MMCA.Common v1.301.0): reads go straight through `SendGetAsync<T>`, because the optional client read cache is removed (ADR-026, Revision 2026-11-17), and `UpdateAsync` sends an `Idempotency-Key` minted once beside `If-Match`, so a retried update whose response was lost replays the stored 204 instead of answering 412. See the Revision (2026-11-17) at the end.

Revised 2026-11-23: the client backoff is recorded as 0.5s / 1s / 2s plus up to 250 ms of jitter, a bare-factory `"APIClient"` call is recorded as anonymous on Blazor Server (so Store's `CustomerLookupService` now derives from the root), the root's 401 renewal hand-off, Store's quote keys and the list page's out-of-range clamp are recorded, the direct-root count is twenty-nine and Common exempts four static members, and anchors are refreshed.

## Context
ADR-034 decided the **server** half of entity data access: a generic controller base with a dynamic
query contract, where filters arrive as `filters[Property].operator` / `filters[Property].value` query
pairs bound by `QueryFilterModelBinder`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/ModelBinders/QueryFilterModelBinder.cs:12,20`, the
key parsing at `:117-151`).
It says nothing about who calls that surface or how.

In practice the calling half is just as decided, and just as load-bearing, but it was never recorded.
Every Blazor and MAUI head in both applications reaches the API through one hand-written class
hierarchy in `MMCA.Common.UI`, and three of its choices are the kind that a new module author copies
without knowing they were choices: the framework ships **hand-written typed bases instead of a
generated client**, the **user-facing retry lives in the client base** rather than in ADR-009's
standard resilience handler, and the `Idempotency-Key` that ADR-017 requires is **minted on the client
and held constant across retry attempts**. ADR-017 specifies only the server filter and says the
client owns the identity of an operation; it never says which client code mints the value or what
keeps it stable. ADR-051 covers only how a bearer token is obtained, stored and refreshed across
render modes, not how an entity request is shaped.

This record fixes the client-side contract, and (because the same layer owns it) the generic list-page
contract that consumes it.

## Decision
Client-side entity data access goes through one hand-written base hierarchy in `MMCA.Common.UI`.

- **One HTTP root: `AuthenticatedServiceBase`**
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/AuthenticatedServiceBase.cs:17`). It owns
  the named `"APIClient"` (`ApiClientName`, `:37`), the bearer attachment
  (`CreateAuthenticatedClientAsync`, `:67-91`, tolerating the SSR pre-render case where JS interop is
  unavailable, `:85-88`), the explicit-token variant used to replay a 401 with a freshly refreshed
  token (`CreateClientWithToken`, `:132-139`, the client end of ADR-051), the retry policy, and the
  idempotency-key mint. The bearer is read from the component's own token store because the
  handlers `IHttpClientFactory` builds resolve in a separate DI scope (`:61-66`). That is also why
  `CreateAuthenticatedClientAsync` registers the store the bearer came from with
  `AuthDelegatingHandler.TrackTokenOwner` (`:82`): the handler reports a 401 to a bearer-carrying
  request to that store for one renewal attempt and passes the 401 through unreplayed
  (`.../MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:20-33`), and a derived service that
  replays the request reads the renewed token (`StorageRenewsRejectedTokens`, `:100`;
  `ReadRenewedAccessTokenAsync`, `:111`) instead of refreshing a second time (the token lifecycle
  itself is ADR-051's). The client itself is registered once, in `AddUIShared`
  (`.../MMCA.Common.UI/DependencyInjection.cs:150-173`): base address from `ApiSettings`
  (`SameOriginApiEndpoint` when set, otherwise `ApiEndpoint`, `:162`), `Accept:
  application/json` (`:170`), `AuthDelegatingHandler` plus `CultureDelegatingHandler`, and a transport timeout
  pinned to the shared 90-second budget (`:168`, `MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:21`)
  so the BCL's uncoordinated 100-second default cannot cut a call off mid-policy. When
  `Api:SameOriginApiEndpoint` is configured (`:146-147`, the opt-in same-origin proxy a WebAssembly
  client receives from its Server host), one more handler, `SameOriginProxyRequestHandler`, is added
  innermost (`:175-181`, the add at `:180`), so it sees and strips every `Authorization` header the outer handlers
  attached and stamps the proxy's CSRF header; without it the chain keeps only the two handlers
  `AddUIShared` adds (`:172-173`). A host that calls `AddServiceDefaults` also wraps the client in the
  standard resilience and service-discovery handlers through `ConfigureHttpClientDefaults`
  (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:57-116`).
- **Typed CRUD is `EntityServiceBase<TEntityDTO, TIdentifierType>`**
  (`.../MMCA.Common.UI/Services/Api/EntityServiceBase.cs:35`), implementing
  `IEntityService<TEntityDTO, TIdentifierType>` (`.../MMCA.Common.UI/Common/Interfaces/IEntityService.cs:20`).
  It is a **hand-written typed base over the ADR-034 REST surface, not a generated client**: no Refit,
  Kiota or NSwag client generator appears in any of the four repos' `Directory.Packages.props`.
- **The client owns query-string construction for the dynamic query contract.**
  `GetPagedAsync` builds `pageNumber`, `pageSize`, `sortColumn`, `sortDirection`, `includeChildren`
  (`EntityServiceBase.cs:79-86`, in `GetPagedAsync` at `:70`), adds `includeFKs=True` only when a subclass overrides
  `PagedIncludeFKs` (`:49`, applied at `:88-91`), and emits exactly the bracketed filter pairs the
  server binder parses, escaping every component (`:93-104`, the pairs at `:99` and `:101`).
  `GetAllAsync` (`:52-67`), `GetAllForLookupAsync` (`:116-124`) and `GetByIdAsync` (`:127-143`, taking
  `id`, `includeChildren` and the caller's `CancellationToken`) cover the remaining reads. A read for a
  missing entity is a `NotFound` failure, not a default value (`:139-142`): the caller tells it apart
  from a transport failure through `ResultUiExtensions.IsNotFound`
  (`.../MMCA.Common.UI/Common/ResultUiExtensions.cs:306`) rather than by asking for a null.
- **Reads go straight to the API; there is no client read cache.** All four reads dispatch through
  `SendGetAsync<T>` (`EntityServiceBase.cs:226-233`, called at `:64`, `:107`, `:121` and `:142`), a
  GET through the same retry policy and `Result` dispatch as the writes, exposed as a protected
  member so a derived service's own read (a storefront page, a filtered lookup) takes the same path
  (`:213-217`). Caching stays on the server's two tiers (ADR-026, Revision 2026-11-17, records the
  removal of the optional client tier), so a write carries no client-side invalidation step.
- **Retry is owned by the client base, not by a resilience handler.** `RetryPolicy`
  (`AuthenticatedServiceBase.cs:35`, built by `BuildRetryPolicy`, `:286-302`) is a static Polly
  policy: three retries after the initial attempt (`:295`), on a retryable `HttpRequestException` or
  a retryable response, with 0.5s / 1s / 2s exponential backoff plus up to 250 ms of jitter
  (`DefaultBackoff`, `:244-246`, documented at `:239`) so a fleet of clients does not re-converge
  on one instant; the three backoff waits come to 3.5 s plus under 750 ms of jitter, so under
  4.25 s in all (`:244-246`, three retries at `:295`), except that a 429 whose `Retry-After` is
  waited out in place of the backoff (below) can wait up to eight seconds per retry. Every retried response is disposed in `onRetry` (`:297-301`, the
  dispose at `:299`) so only the
  final one reaches the caller. `IsRetryableResponse` (`:155-174`) retries 5xx **except** 501 and
  505 (permanent verdicts, `:157`) and adds 408 and 429 (the server explicitly inviting a later
  attempt, `:172-173`), but only for a request that is safe to send again: `IsReplaySafe`
  (`:186-200`, checked at `:167`) answers false for a POST or PATCH carrying no `Idempotency-Key`,
  so a keyless write that got a response is never replayed. A 429 is bounded by its own
  `Retry-After`: one asking for longer than `HttpResilienceDefaults.MaxRetryAfterWait` (eight
  seconds, `HttpResilienceDefaults.cs:40`, well past the longest backoff step) is not retried at all
  (`RetryAfterHeader.ExceedsRetryBudget`, checked at `:162`, defined at
  `MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/RetryAfterHeader.cs:75-78`, which reads only
  a 429), so a rate-limited action surfaces at once instead of holding the user for the rest of the
  window (the test is a strict "longer than", so a `Retry-After` of exactly eight seconds is still
  retried, `RetryAfterHeader.cs:78`); a shorter or equal one is waited out exactly in place of the
  backoff (`RetryDelay`, `:259-267`, used at `:296`), while a 5xx, and a 429 with no `Retry-After`,
  keeps the backoff (`:264-267`). The exception arm
  sees no request, so `AuthDelegatingHandler`, the outermost of the handlers `AddUIShared` registers
  on `"APIClient"` (on a host that calls `AddServiceDefaults` the service-discovery handler wraps
  it, `MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:94`; the default resilience
  handler that call adds to every factory client, `:68`, is taken back off this one client by
  `AddMmcaBlazorWebHost`, `MMCA.Common/Source/Presentation/MMCA.Common.UI.Web/Hosting/BlazorWebHostExtensions.cs:108`,
  through `RemoveApiClientResilienceHandler`, `:260-271`,
  so every render mode runs one 90 s `HttpClient.Timeout` under these retries), stamps each transport failure that passes through it with the request's replay safety
  (`.../MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:139`, through `MarkReplaySafety`,
  `AuthenticatedServiceBase.cs:219-220`, under `ReplaySafeDataKey`, `:208`). `IsRetryableException`
  (`:230-234`, wired at `:292`) then resends a keyless POST or PATCH only when it failed before it
  was sent (name resolution, the TCP connect or the TLS handshake), since any later failure may
  have reached the handler; every other request, and an exception no handler marked, keeps the
  retry. Every dispatch runs through `SendRequestAsync` (`EntityServiceBase.cs:271-289` for the
  value-returning overload, `:301-317` for the body-less one, both taking an optional idempotency key
  and `If-Match` value), which passes the caller's `CancellationToken` into the policy (`:285`,
  `:313`) so cancellation aborts the wait between attempts instead of sleeping out the backoff budget.
- **The `Idempotency-Key` is minted client-side and survives retries.** `NewIdempotencyKey()` returns a
  compact GUID (`AuthenticatedServiceBase.cs:59`); the header name is the shared constant
  `IdempotencyHeaders.IdempotencyKey` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/IdempotencyHeaders.cs:19`).
  `AddAsync` and `UpdateAsync` supply one (`EntityServiceBase.cs:146-160`, the mint at `:158`;
  `:169-185`, the mint at `:182` beside the `If-Match` value at `:183`); reads and deletes send none
  (`SendGetAsync`, `:226-233`; `DeleteAsync`, `:199-208`). A create is not naturally idempotent, and
  an update keyed once means a `PUT` whose first attempt landed and only lost its response is
  replayed by the server's idempotency filter (the stored 204) instead of being re-run against the
  version it just replaced, which would answer 412 (`:175-178`). The key is set as a **default header
  on the single `HttpClient` that serves every attempt** (`CreateRequestClientAsync`, `:323-348`, the
  header added at `:333`), which is what
  makes the value constant across the retry burst and therefore dedupable by the ADR-017 filter.
  These properties are pinned by tests
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Api/EntityServiceBaseIdempotencyRetryTests.cs`):
  a key on creates and updates (`:111`, `:157`), the same key (and, for an update, the same
  `If-Match`) on every retry (`:122`, `:174`), no key on reads or deletes (`:144`, `:197`), and the
  501-not-retried / 429-retried edges (`:210`, `:225`).
- **The `If-Match` precondition is set the same way, from the DTO's own concurrency token.**
  `UpdateAsync` is the only verb that sends one: it passes `ConcurrencyTagOf(entity)`
  (`EntityServiceBase.cs:183`) into the dispatch, and that helper (`:193-196`) renders an
  `IConcurrencyAware` DTO's `RowVersion` as a weak entity tag and answers null when the DTO type
  carries no token. The header rides on the same per-operation `HttpClient` as the idempotency key
  (`CreateRequestClientAsync`, `:336-345`, added at `:344` under the shared name
  `ConcurrencyETag.IfMatchHeaderName`), so every retry attempt states the same precondition rather
  than a later attempt succeeding against a version the caller never saw; when the first attempt
  landed and only its response was lost, the idempotency key sent beside it lets the server replay
  the stored outcome instead of re-checking the precondition against the version that attempt just
  wrote (`:340-343`). This is the client end of
  [ADR-035](035-optimistic-concurrency.md): the `If-Match` header is the only route the token travels,
  and a DTO carrying none sends no header and is refused instead of overwriting another editor's
  change (`:163-168`).
- **The dispatch returns a `Result`; it does not throw** (2026-08-27, v1.164.0). `SendRequestAsync`
  wraps the whole send-and-read in `HttpResultExecutor.ExecuteAsync` and hands the response to
  `ProblemDetailsResultReader`, in both the value-returning overload
  (`EntityServiceBase.cs:271`, composition at `:279-288`) and the body-less one (`:301`, at
  `:309-316`). The reader turns a non-success response back into the errors the server described,
  with the original `ErrorType` preserved when the payload carries the MMCA error array, and the
  executor turns a call that never got a response (connection, DNS, socket, timeout) into a failure
  of its own. A page therefore branches on a `Result` instead of catching, and sees the business
  reason rather than "500" without any exception being minted to carry it
  ([ADR-013](013-result-pattern.md)). This replaces the earlier arrangement, in which the client
  pulled the domain wording out of the ProblemDetails body and **rethrew** it as a
  `DomainInvariantViolationException` before falling back to `EnsureSuccessStatusCode`: that helper
  is deleted, not deprecated. `ChildEntityServiceBase` was converted in the same pass
  (`.../MMCA.Common.UI/Services/Api/ChildEntityServiceBase.cs:36`, `:52`, `:70`).
- **Join entities use `ChildEntityServiceBase`**
  (`.../MMCA.Common.UI/Services/Api/ChildEntityServiceBase.cs:18`), the many-to-many sibling: two
  `PostAsync` overloads, one reading the created DTO back (`:35`) and one for an endpoint answering
  204 (`:51`), plus `DeleteByIdAsync` (`:69`). A join row that is not there answers 404, which arrives
  as an `ErrorType.NotFound` failure, so the caller can still separate "nothing to remove" from "the
  remove failed" (`:61-65`). It shares the bearer helper and the same `Result` dispatch but
  deliberately issues its calls directly, **outside** `RetryPolicy` and with no idempotency key.
- **Non-CRUD services take the root directly and reuse the same policy.** Services whose endpoints are
  not entity CRUD derive from `AuthenticatedServiceBase` itself and call the inherited `RetryPolicy`
  by hand, minting a key where the endpoint is `[Idempotent]` (for example
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/SessionLive/LivePollUIService.cs:92,155,201`
  and `.../SessionQuestionUIService.cs:72,104,141`).
- **Read services that run a GET on their own client reuse the same policy.**
  `IdempotentReadRetry`
  (`.../MMCA.Common.UI/Services/Api/IdempotentReadRetry.cs:18`) is a public static class whose only
  entry point is a GET (`GetAsync`, `:35-44`), run through the very policy object the root exposes
  (`AuthenticatedServiceBase.SharedRetryPolicy`, `AuthenticatedServiceBase.cs:46`, over `RetryPolicy`
  at `:35`; taken at `IdempotentReadRetry.cs:24`), so the two paths cannot drift. It takes whatever
  `HttpClient` the caller hands it. Some callers create the named `"APIClient"` straight from the
  factory without inheriting the root (Store's `ProductVariantLookupService`, whose constructor
  takes only the factory,
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/Lookups/ProductVariantLookupService.cs:21`,
  and `BestSellerService`). Such a bare-factory client leaves the bearer to `AuthDelegatingHandler`
  (`.../MMCA.Common.UI/DependencyInjection.cs:172`), which attaches the token held by its own
  handler-scope storage to a request with no `Authorization` header
  (`.../MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:192-199`). That storage resolves in
  the `IHttpClientFactory` handler scope, which in a browser host is not the instance the component
  holds (`AuthDelegatingHandler.cs:29-31`, `AuthenticatedServiceBase.cs:61-66`), and on Blazor
  Server its token store is empty, so the read goes out anonymous (as recorded at
  `CustomerLookupService.cs:23-25`). A permission-gated read therefore derives from the root and
  takes its client from `CreateAuthenticatedClientAsync` before calling the helper, as Store's
  `CustomerLookupService` does
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/Lookups/CustomerLookupService.cs:21-25`,
  base at `:33`, client at `:42` and `:89`). Without the helper such a GET would get only the shared handler's
  single retry on a host that calls `AddServiceDefaults` (see Trade-offs), and one attempt on a head
  that does not. Twelve call sites across nine files in the two apps use it. In ADC, seven across six
  files: four lookup services
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/Speakers/SpeakerLookupService.cs:96`,
  `.../Services/Events/EventLookupService.cs:102`,
  `.../Services/Categories/CategoryItemLookupService.cs:54`, and
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/Lookups/SessionLookupService.cs:31,54`)
  plus `.../Services/SessionLive/LiveEventService.cs:58` and
  `.../Services/HappeningNow/NowNextService.cs:26`. In Store, five across three files: four in its
  two Sales lookup services
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/Lookups/CustomerLookupService.cs:44,96`
  and `.../Services/Lookups/ProductVariantLookupService.cs:48,102`), which enrich the admin grids
  (the variant lookup also serves the storefront through `BestSellerService`,
  `.../Services/Storefront/BestSellerService.cs:26,53`, and the public guest order page,
  `.../Pages/GuestOrders/GuestOrderDetail.razor.cs:40`), and one in `BestSellerService`
  (`.../Services/Storefront/BestSellerService.cs:39`), which fills the storefront's Best Sellers
  rows: the home page's
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/Pages/Home/StoreHome.razor.cs:38`) and
  the catalog browse page's suggestions when a filtered search comes back empty
  (`.../Pages/Catalog/CatalogBrowse.razor.cs:29,266`, `CatalogBrowse.Filters.razor.cs:124`).
  Helpdesk and the rest of Common do not call it.
  Writes are deliberately not offered: a write that needs retries goes through `EntityServiceBase`,
  whose creates and updates carry an `Idempotency-Key`.
- **UI state is per circuit, never process-wide.** Blazor Server runs every user's circuit in one
  process, so client-side state lives in scoped services: UI assemblies declare no mutable static
  field and no settable static property, and no `*StateService` or `*StateContainer` type is
  registered as a singleton, so one user's state cannot leak into another circuit. The rule is a
  fitness function authored once in
  `MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Ui/StateManagementConventionTestsBase.cs:18`
  (reflection over the `Layer.Ui` assemblies, `:29-64`; a source scan for singleton stateful
  registrations, `:67-79`, pattern at `:125`). A subclass may exempt named members through
  `AllowedStaticMembers` (`:26`, honored at `:57`). Common's subclass exempts four
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Ui/StateManagementConventionTests.cs:29-35`,
  rationale at `:15-28`): `ErrorMessages._localizer`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/ErrorMessages.cs:26`), a write-once
  localizer wiring rather than per-user state, and the three `SecureStoreTokenStorageService`
  statics (`_hydrateInFlight`, `_tokenVersion`, `_processSessionEnded`), process-wide on purpose
  because only a MAUI head (one process, one signed-in user) registers that storage and no Blazor
  Server host does. It also adds a singleton-scan test of its own.
  The rule runs in
  `MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Ui/StateManagementConventionTests.cs:11`,
  `MMCA.ADC/Tests/Architecture/MMCA.ADC.Architecture.Tests/Ui/StateManagementConventionTests.cs:9`
  and `MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/Ui/StateManagementConventionTests.cs:10`.
  MMCA.Helpdesk declares no subclass, so the rule is not enforced there.

Adoption inventory as of 2026-11-23. Most services sit under their aggregate folder; a module with a
single aggregate per service keeps them at the `Services/` root (both `UserListService` types and
Store's `CustomerService`, `ProductService` and `CategoryService`).
**Twenty production services derive from `EntityServiceBase`**: eleven in ADC, ten of them in
Conference
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/`:
`Activities/ActivityService.cs:11`, `Categories/CategoryItemService.cs:11`,
`Categories/ConferenceCategoryService.cs:11`, `Events/EventService.cs:33` (base at `:38`),
`Partners/PartnerService.cs:11`, `Questions/QuestionService.cs:11`, `Rooms/RoomService.cs:13`,
`Sessions/SessionService.cs:11`, `Speakers/SpeakerService.cs:18` (base at `:22`), `Sponsors/SponsorService.cs:11`)
plus Identity's `UserListService`
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Services/UserListService.cs:21`), eight in
Store
(`Catalog.UI/Services/ProductService.cs:28` (base at `:29`), `CategoryService.cs:24` and
`Reviews/ReviewService.cs:24`; `Sales.UI/Services/Orders/OrderService.cs:19`,
`ShoppingCarts/ShoppingCartService.cs:18`, `Inventory/InventoryItemService.cs:20`;
`Identity.UI/Services/CustomerService.cs:25` and `UserListService.cs:22`), and one inside
the framework itself
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/PushNotificationService.cs:15`,
base at `:19`).
**Four derive from `ChildEntityServiceBase`**, all in ADC Conference and all in one file
(`.../Services/Common/ChildEntityServices.cs:23,36,49,62`). **Twenty-nine more take
`AuthenticatedServiceBase` directly** (each cited at its base clause): sixteen in ADC, ten of them
in Engagement, five in Conference (four files:
`Services/Feedback/OrganizerFeedbackService.cs` declares two of them, at `:17` and `:72`, next to
`Services/Speakers/SpeakerDashboardService.cs:16`,
`Services/Sessions/Selection/SessionSelectionService.cs:16` and
`Services/SessionAssets/SessionAssetService.cs:26`) and Identity's
`Services/UserService.cs:23`; nine in the framework
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/`:
`Notifications/NotificationInboxService.cs:34`,
`Legal/LegalAcceptanceUIService.cs:25`,
`Administration/UserAdminService.cs:29`, `Administration/RoleAdminService.cs:27`,
`Administration/FeatureFlagAdminService.cs:25`, `Administration/MachineClientAdminService.cs:25`,
`Administration/ViewAsGrantsService.cs:27`, `Auditing/AuditHistoryService.cs:24` and
`Auth/TwoFactor/TwoFactorUIService.cs:27`); and four in Store: `UserDataService`
(`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.UI/Services/UserDataService.cs:20`),
`CustomerLookupService`
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/Lookups/CustomerLookupService.cs:33`,
see the `IdempotentReadRetry` bullet), `CartStateService`
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/ShoppingCarts/CartStateService.cs:46`,
base at `:55`), which uses the inherited `RetryPolicy` (for example `:156`, `:309`, `:596`) and
`NewIdempotencyKey()` under the same rule: one key per add request, reused by every attempt (`:589`
in `SendAddItemAsync`, `:583`, which runs once per user add at `:113` and once per line, `:659`, when
`MergeGuestCartAsync`, `:621`, merges a guest cart; `:302` per checkout, shared by the checkout
PUT at `:309` and the payment POST at `:346`). It also mints one per quote request in
`FetchQuoteAsync` (`:756`, the key at `:773`, sent through `CheckoutApiService.QuoteRequest`), but
that key is not a dedup key: the quote writes nothing, its endpoint is `[NonIdempotent]` and the
server ignores the key and re-prices on every attempt, so the key only lets the client retry
policy resend the POST (`:771-772`). `CheckoutApiService`
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/Checkout/CheckoutApiService.cs:23`,
base at `:26`) mints one key per keyed guest action, three in all: order placement
(`PlaceGuestOrderAsync`, `:88`, key at `:90`), the guest Stripe payment session
(`CreateGuestPaymentSessionAsync`, `:129`, key at `:136`) and the guest order-link request
(`RequestGuestOrderLinkAsync`, `:193`, key at `:195`). Its two other guest writes,
`ClaimGuestOrderAsync` (`:157`) and `CancelGuestOrderAsync` (`:172`), send no key. Its pricing
read `GetQuoteAsync` (`:49`, on a client from `CreateAuthenticatedClientAsync`, `:56`) mints a key
too (`:51`, built by `QuoteRequest`, `:77`), for the same retry-only reason (`:67-72`).

### The list-page contract: `DataGridListPageBase<TDto>`

The consumer side of that data-access contract is equally uniform, and is recorded here rather than
separately because the two are used as a pair: a list page inherits the base and hands it a fetch
delegate that is almost always an `EntityServiceBase.GetPagedAsync` call.

`DataGridListPageBase<TDto>`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:24`, an
abstract partial class whose column-filter state lives in the sibling
`DataGridListPageBase.ColumnFilters.cs`) owns:

- **Server-side paging through MudDataGrid `ServerData`.** `LoadServerDataAsync` (`:918`) is a thin
  entry point over `LoadPagedAsync` (`:1004`) and `FetchPagedAsync` (`:1071`). A page can run its
  own asynchronous step before every fetch through the `OnBeforeFetchAsync` hook (`:944`, called at
  `:1083`). The fetch flattens the
  grid's filter definitions into a dictionary keyed by column, with the newest row winning when the
  user stacks two filters on one column (`ExtractGridFilters`, `:1566`), then lets the page's
  own filter callback (search box, status dropdown) edit it through `ApplyAdditionalFilters`
  (`:1600`): an injected filter that collides with a grid column filter does not overwrite it
  but moves to the aliased key `QueryFilterKeys.Alias(key, SearchTag)` (`Name~search`, `:1620`),
  which the server resolves to the same property and ANDs, so one column can carry two keys. It
  resolves sort from `GridState` (`ResolveSortParameters`, called in the paged fetch at `:1090`,
  defined at `:1637`: it reads the grid's own `SortDefinition` through `ExtractSortParameters`,
  `:1624`, and falls back to the sort restored from the query string when the grid has not
  picked one up yet, which is the normal case on a first fetch with a URL-driven sort), and converts
  the grid's zero-based page to the API's one-based `pageNumber` (`:1141`).
- **A page past the end falls back to the last page.** `FetchWithinRangeAsync` (`:1118-1162`)
  refetches the last page when the requested one comes back empty while `TotalItems` is above zero
  (a hand-typed or stale `?p=` past the end, or rows deleted since), and `MovePagerToRows`
  (`:1174`, called at `:1105`) moves the pager to the page whose rows the grid receives, so the
  grid never shows no rows under a non-empty total.
- **The newest load owns the grid.** MudDataGrid applies whichever `ServerData` call completes last,
  so a superseded paged call does not hand back its own result: `NewestPagedResultAsync`
  (`:1054`, tracking `_newestPagedLoad`, `:127`) answers it with the newest load's result. A load
  checks it is still current (`IsCurrentLoad`, `:1540`) and `ThrowIfSuperseded` (`:1547`) after
  each fetch, so only the newest load writes rows, flags and the empty state.
- **Cancellation-token management.** Each fetch swaps in a fresh source before tearing down the
  previous one, tolerating the `ObjectDisposedException` race a debounced reload after disposal would
  otherwise raise (`ResetCancellationTokenAsync`, `:1506`); during SSR pre-render the token
  additionally times out after `PrerenderFetchTimeoutMs` (5000 ms) so a cold backend cannot block the
  page load (`:113`, `CreateFetchCts`, `:1427-1438`).
- **An opt-in virtualized fetch path.** A page that overrides `VirtualizeGrid` (`:200`, default
  false) binds MudDataGrid `VirtualizeServerData` to `LoadVirtualizedServerDataAsync` (`:1223`), which
  maps the requested row window onto the same page-based fetch delegate (one or two pages, trimmed to
  the window) through the same `RunFetchAsync` (`:1241`) and `ExtractGridFilters` (`:1249`), so a page
  switches to virtualization without a second API contract. A virtualized grid renders no pager, so
  the pager-restore workarounds are skipped for it (`RestoreGridStateAsync`, `:778`).
- **A `LoadFailed` flag that distinguishes error-with-retry from genuinely empty** (`:55`). The paged
  grid, virtualized grid and mobile paths share one fetch wrapper, `RunFetchAsync` (`:1320`), which
  clears the flag (`:1329`) and sets it on a thrown fetch of the current load (`:1365`); a thrown fetch
  from a superseded load returns its cancelled result and leaves the flag alone (`:1354-1359`), since
  it describes a query nobody is showing. `FailedFetch` (`:1383`) sets it on a failed `Result`
  (`:1386`). A failed fetch renders zero rows, which is visually identical to an empty list once the
  error snackbar expires, so pages branch on this flag in `NoRecordsContent` instead of showing the
  "no records" state.
- **An `EmptyConfirmed` flag for the genuinely empty case** (`:66-70`). It is true only when the
  newest load completed with `TotalItems == 0` (set at `:1034`, `:1109`, `:1277` and `:1479`, cleared by
  `RunFetchAsync` at `:1330`) and only while the renderer is interactive, and a page binds it to
  `ListNoRecordsContent.EmptyConfirmed`, so the "no records" text does not flash before a non-empty
  page arrives.
- **Viewport-driven mobile card state.** `IsMobile` (`:75`) flips from the browser-viewport observer
  (`NotifyBrowserViewportChangeAsync`, `:410`) below the 960 px sidebar-collapse threshold, and
  the card view has its own paged fetch path (`MobileItems` / `MobileTotalItems` /
  `MobileCurrentPage` / `MobilePageSize`, `:78-81`; `LoadMobileDataAsync`, `:1444`).
- **List state persisted and restored three ways.** `ListPageState`
  (`.../MMCA.Common.UI/Services/ListPageStateService.cs:9`) carries page, page size, mobile page, sort,
  density, filters and scroll position; `ListPageStateService` (`:63`) holds it in memory and mirrors
  it to `sessionStorage`, and `ListPageQueryStateService`
  (`.../MMCA.Common.UI/Services/ListPageQueryStateService.cs:28`) encodes it into the URL. The URL is
  the source of truth on initialization, with the in-memory entry as the fallback and scroll position
  read only from it (`DataGridListPageBase.cs:259-304`); writes go to all three (`SaveCurrentState`,
  `:1689`). Column filter state is restored and persisted through the `ColumnFilters` partial
  (`ResolveColumnFilters`, `DataGridListPageBase.ColumnFilters.cs:49`); a save that passes no
  column filters, as the mobile card path does (`:1486`), keeps the saved ones (`:1712`). Deferred writes are dropped once the user has navigated away, because the route is
  pinned at initialization rather than read from the live URI at write time (`_ownRoutePath`, field at
  `:1806`, pinned at `:264`; `IsOwnRouteCurrent`, `:1832-1833`).

**Twenty application types inherit this base**: thirteen in ADC (seven directly, six through the abstract
`Pages/Common/EventFilteredListPageBase.cs:24`) and seven in Store, nineteen of them routable list
pages plus ADC's non-routable `AttendeeSearchPanel`
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/CheckIns/AttendeeSearchPanel.razor.cs:16`).
The framework itself adds one more: the generic `UserAdminList<TUser>`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Administration/UserAdminList.razor:4`), which
binds `EmptyConfirmed` like the application pages (`:182`).
ADR-056 owns the render-mode aspect of the same type (the `PersistentComponentState` pre-render
handoff and the `InteractiveAuto` registration) and inventories the same set of pages.

## Rationale
- **A hand-written typed base beats a generated client here because the surface is already generic.**
  ADR-034 collapsed N entity endpoints into one shape, so there is exactly one client shape to write.
  A generator would emit N near-identical clients from an OpenAPI document, add a build step and a
  regeneration discipline, and still need hand-written policy for retry, idempotency and error
  extraction. The typed base gives compile-time DTO safety for the same cost as the generic call.
- **User-facing retry belongs where the user is.** The client base retries a browser-to-gateway call
  the user is waiting on, with second-scale backoff a person will tolerate; ADR-009's standard handler
  is tuned for server-to-server hops. Keeping them separate lets each move on its own.
- **One key per logical operation is the only version of ADR-017 that works.** The server dedups on the
  key; if the client minted a new one per attempt, a retried create would produce a second record,
  which is precisely the failure the filter exists to prevent. Setting the header on the client that
  serves every attempt makes the invariant structural rather than a rule to remember.
- **Returning the domain error is what makes failures speakable.** The API already returns a
  specific business reason; a client that answered with a generic status-code exception would throw
  that reason away. The original design extracted the reason and rethrew it, which preserved the
  wording but kept the failure in the exception channel; returning a `Result` preserves the wording
  **and** the category, so a page can turn a 404 into an empty state and a 401 into a redirect
  instead of pattern-matching on message text ([ADR-013](013-result-pattern.md)).
- **The list page is repeated twenty times, so it is worth a base class.** Paging, cancellation,
  filter and sort extraction, viewport switching, error state and state restoration are identical
  across every list in both apps; twenty hand-rolled copies is twenty chances to get the
  cancellation race or the empty-versus-failed distinction wrong.

## Trade-offs
- **No generated client means drift is caught at runtime, not at build time.** A server-side rename of
  a query parameter or a DTO property does not fail the UI build; it fails the call. The mitigation is
  that both halves live in one solution and share the DTO types, so the common case (a DTO change) is
  a compile error anyway; the exposed case is the query-string vocabulary, which is asserted on each
  side separately (`MMCA.Common/Tests/Presentation/MMCA.Common.API.Tests/ModelBinders/QueryFilterModelBinderTests.cs`
  for the binder, `EntityServiceBaseTests.cs` for the emitter) rather than end to end.
- **Retry budgets stack across hops, and are deliberately bounded rather than eliminated.** A host that
  calls `AddServiceDefaults` applies the standard resilience handler to every factory client through
  `ConfigureHttpClientDefaults` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:57-116`),
  including `"APIClient"`. Because the UI base already makes up to four attempts, the shared
  per-hop retry count is pinned to **one**
  (`HttpResilienceDefaults.cs:32`, reasoned at `:23-31`, applied at `Extensions.cs:73`), with the reason stated in both
  places: full budgets at every hop turned a backend brownout into an up-to-16x request storm. The
  shared handler also never replays a POST or PATCH
  (`options.Retry.DisableFor(HttpMethod.Post, HttpMethod.Patch)`, `Extensions.cs:82`), because a
  timed-out attempt may still be running server-side and the handler does not look for an
  idempotency key (even on `"APIClient"`, where the UI base's create does carry one), so a client
  create is retried only by the UI base, under its key. It also refuses to retry a 429 whose
  `Retry-After` exceeds `MaxRetryAfterWait` (`Extensions.cs:88-92`, wrapping the handler's own
  `ShouldHandle` with the same `RetryAfterHeader.ExceedsRetryBudget` check the UI base uses), so a
  rate-limited request is retried at neither layer rather than held open for the rest of the
  window. The cost is that the effective attempt count for a UI action is a product of two layers and cannot be
  read off either one alone.
- **The retry policy is `static` and not configurable.** `RetryPolicy` is a `protected static readonly`
  field (`AuthenticatedServiceBase.cs:35`), so its counts and delays are compile-time constants shared
  by every service in the process. A per-endpoint or per-environment retry profile would need a change
  to the framework, not configuration.
- **Only `AddAsync` and `UpdateAsync` get an idempotency key automatically.** Any non-CRUD write (a hand-written POST on
  a service deriving from `AuthenticatedServiceBase`, such as `CartStateService`) has to mint and
  attach the key itself, and nothing fails the build if it does
  not. The omission mostly costs resilience rather than correctness: `RetryPolicy` never replays a
  keyless POST or PATCH that got a response (`IsReplaySafe`, `AuthenticatedServiceBase.cs:186-200`),
  and resends one that failed in transport only when it failed before it was sent, provided
  `AuthDelegatingHandler` saw the failure and marked it (`IsRetryableException`, `:230-234`; the mark
  at `AuthDelegatingHandler.cs:135-141`, the call at `:139`). An exception raised outside that handler carries no mark and
  keeps the retry (`:231`), so the guarantee is "not resent once the handler saw it fail", not an
  absolute no-duplicate rule; any other transient fault on such a write surfaces to the user instead
  of being absorbed. Both `ChildEntityServiceBase.PostAsync` overloads (`ChildEntityServiceBase.cs:35`, `:51`)
  are such writes and send no key today.
- **`ChildEntityServiceBase` calls are not retried.** Join add and remove operations get the bearer
  token and domain-error extraction but no transient-fault handling, so a blip surfaces to the user
  where the same blip on the parent entity would be absorbed.
- **The list-page base is deep.** It coordinates render-mode-aware persistence, three state stores, JS
  interop for scroll tracking, and two MudDataGrid v9 parameter-setter workarounds
  (`RestoreCurrentPageAfterRowsPerPageReset`, `DataGridListPageBase.cs:711`, and the
  `RestoreGridStateAsync` safety net, `:772`). That depth is the price of twenty pages behaving
  identically, but it makes the base itself the hardest type in the UI package to change safely.

## Revision (2026-10-01)
The Blazor Server per-circuit state rule is recorded as a Decision bullet. It was already enforced
but not written down: UI assemblies carry no mutable static members outside a subclass's
`AllowedStaticMembers` list (Common exempts only `ErrorMessages._localizer`) and `*StateService` /
`*StateContainer` types are never registered as singletons, held by
`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Ui/StateManagementConventionTestsBase.cs:18`
and its subclasses in Common (`StateManagementConventionTests.cs:11`), ADC (`:9`) and Store
(`:10`); MMCA.Helpdesk has none. Store's `CartStateService` now derives from
`AuthenticatedServiceBase` (`CartStateService.cs:45`) and uses the inherited `RetryPolicy` and
`NewIdempotencyKey()` instead of local copies, so the direct-root count is twenty and the
Trade-offs bullet no longer calls it code outside the hierarchy. Store's `EmailConfirmationService`
no longer exists, so the `EntityServiceBase` count is eighteen. `LoadFailed` is now set in the
shared fetch wrapper `RunFetchAsync` (`DataGridListPageBase.cs:643`, set at `:673`) and its
`FailedFetch` helper (`:690`) rather than at four per-path sites. Line anchors into `AuthenticatedServiceBase`, `EntityServiceBase`, `ResultUiExtensions`,
the UI `DependencyInjection`, the Aspire `Extensions`, `HttpResilienceDefaults`,
`OrganizerFeedbackService` and `DataGridListPageBase` are refreshed. The client data-access
contract itself and its rationale are unchanged.

## Revision (2026-10-06)
- The retry bullet now records that `IsRetryableResponse` consults `IsReplaySafe`
  (`AuthenticatedServiceBase.cs:134`), so a POST or PATCH with no `Idempotency-Key` is never
  replayed, and that `onRetry` disposes every retried response (`:173`). The idempotency-key
  trade-off is restated accordingly: a missing key now costs transient-fault absorption, not a
  duplicate record.
- The read-cache bullet now records `InvalidateAfterWrite` (`EntityServiceBase.cs:300`): a write
  invalidates the endpoint unless every error is a pre-write refusal (`IsRejectedBeforeWrite`,
  `:309`), so a 412, 404, 409, 5xx or transport failure invalidates like a success. The earlier
  "a rejected write invalidates nothing" held only for that pre-write set.
- `GetPagedAsync` records the `PagedIncludeFKs` override (`EntityServiceBase.cs:65`), and both
  `SendRequestAsync` overloads are recorded as taking the idempotency key and `If-Match` value.
- The direct-root count is twenty-two, not twenty: Common's `LegalAcceptanceUIService`
  (`LegalAcceptanceUIService.cs:26`) and Store's `UserDataService` (`UserDataService.cs:20`) were
  missing. The `EntityServiceBase` (eighteen) and `ChildEntityServiceBase` (four) counts were
  recounted and hold.
- Line anchors into `AuthenticatedServiceBase`, `EntityServiceBase`, `ResultUiExtensions`, the UI
  `DependencyInjection`, `EventService`, `SpeakerService`, `CartStateService` and
  `DataGridListPageBase` were re-verified against current source.

## Revision (2026-10-07)
Re-verified against current source. The client data-access contract, the retry policy, the
idempotency-key mint and the adoption counts are unchanged; three behaviors around them were not
recorded, and one anchor was wrong.
1. The `"APIClient"` registration now records the opt-in same-origin proxy: the base address is
   `SameOriginApiEndpoint` when set, else `ApiEndpoint`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/DependencyInjection.cs:136`), and when
   `Api:SameOriginApiEndpoint` is configured (`:120-121`) an innermost
   `SameOriginProxyRequestHandler` joins the chain (`:149-155`).
2. The stacked-retry trade-off now records that the shared standard resilience handler never retries
   a POST or PATCH (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:61`), so only the
   UI base retries a client create.
3. A new Decision bullet records `IdempotentReadRetry`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/IdempotentReadRetry.cs:18`), the
   GET-only path (`:35-44`) that reuses `AuthenticatedServiceBase.SharedRetryPolicy`
   (`AuthenticatedServiceBase.cs:38`) for read services that create `"APIClient"` themselves without
   inheriting the root (the chain's `AuthDelegatingHandler` still attaches a stored bearer); seven
   call sites across six ADC files use it, four of them lookup services (for example
   `SpeakerLookupService.cs:96`) plus `LiveEventService.cs:29` and `NowNextService.cs:26`.
4. Anchors re-verified against current source: `ResultUiExtensions.IsNotFound` is at
   `ResultUiExtensions.cs:340` (`:328` is `HasErrorType`), the `"APIClient"` registration spans
   `DependencyInjection.cs:124-155` with the timeout pin still at `:142`, and the Aspire retry-count
   pin (`Extensions.cs:54`) and its `ConfigureHttpClientDefaults` block (`:39-85`) hold.

## Revision (2026-10-19)
No decision changed. Store adopts `IdempotentReadRetry`: its two Sales lookup services, which create the
named `"APIClient"` themselves, now run every GET through the helper
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/Lookups/CustomerLookupService.cs:32`, `:84`;
`.../Services/Lookups/ProductVariantLookupService.cs:48`, `:103`), so a transient 5xx, 408 or 429 on
those admin-grid enrichment reads gets the same policy the hierarchy uses rather than only the shared
handlers single retry. The Decision bullet no longer says Store does not call it, and the count moves
from seven call sites across six ADC files to eleven across eight files (ADC seven in six, Store four
in two). ADCs `LiveEventService` call is re-cited at `:57` (was `:29`).

## Revision (2026-10-21)
Re-verified against current source. The client data-access contract, the idempotency-key mint, the
`ChildEntityServiceBase` count (four) and the list-page paging, cancellation and state contract are
unchanged; the retry bullet understated the policy's exception arm, the `EntityServiceBase` count
missed two services, the list-page section omitted the virtualized fetch path, and anchors moved.
1. The retry bullet now records the transport-failure arm. `BuildRetryPolicy`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/AuthenticatedServiceBase.cs:201-204`)
   handles `HttpRequestException` through `IsRetryableException` (`:175-179`), which reads the replay
   safety `AuthDelegatingHandler` stamps on the exception
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:38`,
   `MarkReplaySafety` at `AuthenticatedServiceBase.cs:164-165`): a keyless POST or PATCH is resent
   only after a name-resolution, connect or TLS failure, and an unmarked exception keeps the retry.
   "A keyless write is never replayed" held for the response arm only; the idempotency-key
   trade-off is restated to match.
2. **Twenty** production services derive from `EntityServiceBase`, not eighteen: ADC's
   `UserListService` (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.UI/Services/UserListService.cs:21`)
   and Store's (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.UI/Services/UserListService.cs:22`)
   were missing, so the split is eleven in ADC, eight in Store and one in Common. The inventory no
   longer claims every service sits under an aggregate folder: those two and Store's
   `CustomerService`, `ProductService` and `CategoryService` sit at their module's `Services/` root.
3. `AuthDelegatingHandler` is recorded as the outermost of the handlers `AddUIShared` registers, not
   of the whole `"APIClient"` chain: on a host that calls `AddServiceDefaults`, the default
   resilience and service-discovery handlers wrap it (`Extensions.cs:49`, `:65`). The
   idempotency-key trade-off now states the transport guarantee as "not resent once the handler saw
   it fail", since an exception raised outside that handler carries no mark and keeps the retry
   (`AuthenticatedServiceBase.cs:176`).
4. The list-page section now records the opt-in virtualized path: `VirtualizeGrid`
   (`DataGridListPageBase.cs:155`) and `LoadVirtualizedServerDataAsync` (`:762`), which runs through
   the shared `RunFetchAsync` (`:774`) and `ExtractGridFilters` (`:777`), with the pager-restore
   workarounds skipped for a virtualized grid (`:582-590`). The `LoadFailed` bullet names three
   paths sharing the fetch wrapper, not two.
5. Anchors re-verified against current source: the `"APIClient"` registration spans
   `DependencyInjection.cs:132-162` (same-origin flag `:128-129`, base address `:144`, timeout `:150`,
   handlers `:154-155`, proxy handler `:157-162`); `ConfigureHttpClientDefaults` spans
   `Extensions.cs:39-87` with `DisableFor(Post, Patch)` at `:63` (the retry count at `:54` holds);
   the bearer attach is `AuthDelegatingHandler.cs:52-58`; `onRetry` disposal is
   `AuthenticatedServiceBase.cs:204`; and in `DataGridListPageBase.cs` the class is `:23`,
   `LoadFailed` `:54`, `IsMobile` `:58`, the mobile properties `:61-64`, `PrerenderFetchTimeoutMs`
   `:96`, the restore `:218-255` with `_ownRoutePath` pinned at `:216`, the viewport observer
   `:319-332`, the MudDataGrid workarounds `:542-548` and `:592-608`, `LoadServerDataAsync` `:641`,
   the paged fetch's sort and page conversion `:719` and `:721`, `RunFetchAsync` `:837` (cleared
   `:846`, set `:872`), `FailedFetch` `:890` (set `:893`), `CreateFetchCts` `:933-944`,
   `LoadMobileDataAsync` `:950`, `ResetCancellationTokenAsync` `:997-1019`, `ExtractGridFilters`
   `:1031-1044`, `ExtractSortParameters` `:1081-1086`, `ResolveSortParameters` `:1093-1105`,
   `SaveCurrentState` `:1107-1144`, the `_ownRoutePath` field `:1187` and `IsOwnRouteCurrent`
   `:1195-1196`.

## Revision (2026-10-26)
Re-verified against current source. The client data-access contract, the idempotency-key mint, the
adoption counts and the list-page paging, cancellation and state contract are unchanged; the retry
policy and the shared handler gained a `Retry-After` bound that was not recorded, the list page
gained superseded-load handling, an `EmptyConfirmed` flag and filter aliasing, and anchors moved.
1. The retry bullet now records the 429 bound: `IsRetryableResponse` refuses a 429 whose
   `Retry-After` exceeds `HttpResilienceDefaults.MaxRetryAfterWait` (eight seconds,
   `MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:41`) through
   `RetryAfterHeader.ExceedsRetryBudget`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/AuthenticatedServiceBase.cs:121`;
   `MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/RetryAfterHeader.cs:75-78`), and
   `RetryDelay` (`AuthenticatedServiceBase.cs:212-220`, used at `:249`) waits out a 429
   `Retry-After` at or under the budget in place of the backoff (the budget test is a strict `>`,
   `RetryAfterHeader.cs:78`), while a 429 with no `Retry-After` keeps the backoff (`:217-220`).
2. The stacked-retry trade-off now records that the shared standard resilience handler applies the
   same refusal by wrapping its `ShouldHandle`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:80-84`), so the shared handler's
   behavior is no longer only "one retry, never a POST or PATCH".
3. The list-page section now records that a superseded load does not own the grid:
   `NewestPagedResultAsync`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:715-725`)
   answers a superseded paged call with the newest result, `IsCurrentLoad` (`:1094`) and
   `ThrowIfSuperseded` (`:1101-1107`) keep stale loads from writing state, and a thrown fetch from a
   superseded load no longer sets `LoadFailed` (`:914-918`).
4. A new bullet records `EmptyConfirmed` (`DataGridListPageBase.cs:65-69`, set at `:697`, `:756`, `:838`,
   `:1033`), the flag a page binds to `ListNoRecordsContent.EmptyConfirmed`.
5. The paging bullet no longer calls the emitted filters strictly one per column:
   `ApplyAdditionalFilters` (`DataGridListPageBase.cs:1145-1167`) moves a page-injected filter that
   collides with a grid column filter to `QueryFilterKeys.Alias(key, SearchTag)` (`:1165`), which the
   server ANDs on the same property.
6. Anchors re-verified against current source: in `AuthenticatedServiceBase.cs` the class is `:17`,
   `"APIClient"` `:32`, `CreateAuthenticatedClientAsync` `:62-81` (SSR catch `:75-78`),
   `CreateClientWithToken` `:91-98`, `RetryPolicy` `:30`, `SharedRetryPolicy` `:41`,
   `NewIdempotencyKey` `:54`, `IsRetryableResponse` `:114-133` (`IsReplaySafe` check `:126`),
   `IsReplaySafe` `:145-159`, `ReplaySafeDataKey` `:167`, `MarkReplaySafety` `:177-178`,
   `IsRetryableException` `:188-192` (unmarked keeps the retry `:189`, wired `:245`),
   `BuildRetryPolicy` `:239-255` and `onRetry` `:250-254`; `HttpResilienceDefaults.cs`
   `TotalRequestTimeout` `:22` and the retry-count pin `:24-33`; in `Extensions.cs`
   `ConfigureHttpClientDefaults` `:50-108`, the resilience and service-discovery handlers `:60` and
   `:86`, the retry count `:65` and `DisableFor(Post, Patch)` `:74`; the `"APIClient"` proxy handler
   block in the UI `DependencyInjection.cs` is `:157-163`; `ResultUiExtensions.IsNotFound` `:306`;
   `QueryFilterModelBinder.cs:12,20` with key parsing `:117-151` (`:92` is no longer a code line);
   `EventService.cs:26`, `UserAdminService.cs:30`, `LiveEventService.cs:56`,
   `ProductVariantLookupService.cs:102`, `EventFilteredListPageBase.cs:24`; `CartStateService.cs`
   class `:38`, base `:44`, `RetryPolicy` uses `:97`, `:144`, `:263`, keys `:90` and `:256`; and in
   `DataGridListPageBase.cs` `IsMobile` `:74`, the mobile properties `:77-80`,
   `PrerenderFetchTimeoutMs` `:112`, `VirtualizeGrid` `:171`, the restore `:234-271` (route pinned
   `:232`), the viewport observer `:335-348`, the MudDataGrid workarounds `:558-564` and `:608-624`,
   the virtualized pager skip `:598-606`, `LoadServerDataAsync` `:657`, the paged sort and page
   conversion `:745` and `:747`, `LoadVirtualizedServerDataAsync` `:790` (its `RunFetchAsync` and
   `ExtractGridFilters` calls `:806` and `:810`), `RunFetchAsync` `:881` (cleared `:890`, set `:922`),
   `FailedFetch` `:940` (set `:943`), `CreateFetchCts` `:984-995`, `LoadMobileDataAsync` `:1001`,
   `ResetCancellationTokenAsync` `:1060-1087`, `ExtractGridFilters` `:1119-1132`,
   `ExtractSortParameters` `:1169-1174`, `ResolveSortParameters` `:1181-1193`, `SaveCurrentState`
   `:1202-1240`, the `_ownRoutePath` field `:1291` and `IsOwnRouteCurrent` `:1299-1300`.
7. The list-page inheritor count is now qualified as twenty application types (thirteen ADC, seven
   Store), and the framework's own `UserAdminList<TUser>`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Administration/UserAdminList.razor:4`) is
   recorded as a further inheritor.

## Revision (2026-10-28)
Re-verified against current source. The client data-access contract, the retry policy, the
idempotency-key mint, the `EntityServiceBase` count (twenty) and the `ChildEntityServiceBase` count
(four) are unchanged; Store added two services that use the shared policy, so two adoption counts
moved, and Store anchors moved with them.
1. `IdempotentReadRetry` has twelve call sites across nine files, not eleven across eight: Store's
   `BestSellerService`
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/Storefront/BestSellerService.cs:38`)
   reads the storefront's Best Sellers rows through it: the home page's
   (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.UI/Pages/Home/StoreHome.razor.cs:38`) and
   the catalog browse page's suggestions after an empty filtered search
   (`.../Pages/Catalog/CatalogBrowse.razor.cs:29,266`, `CatalogBrowse.Filters.razor.cs:124`). Store
   therefore has five in three files. The two lookup services enrich the admin grids, and the
   variant lookup also serves `BestSellerService` (`BestSellerService.cs:25,52`) and the public
   guest order page
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Pages/GuestOrders/GuestOrderDetail.razor.cs:40`).
   ADC is unchanged at seven in six.
2. Twenty-three services take `AuthenticatedServiceBase` directly, not twenty-two: Store's
   `CheckoutApiService`
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/Checkout/CheckoutApiService.cs:23`,
   base at `:26`) joins `UserDataService` and `CartStateService`, and mints one idempotency key per
   guest action: order placement (`:61`), the guest Stripe payment session (`:104`) and the guest
   order-link request (`:161`).
3. `CartStateService` mints one key per add request rather than per user action: the mint at `:582`
   sits in `SendAddItemAsync` (`:576`), called once per user add (`:107`) and once per line when
   `MergeGuestCartAsync` (`:612-627`) merges a guest cart on sign-in or checkout (`:273`, `:288`).
4. Anchors re-verified against current source: `CartStateService.cs` class `:46`, base `:55`,
   `RetryPolicy` uses including `:150`, `:303`, `:341` and `:589`, keys `:296` (checkout) and `:582`
   (add request); `ProductService.cs:28` (its `EntityServiceBase` base clause, matching the sibling
   anchors); ADC Identity's `UserService.cs:22` now also names its base clause at `:23`; and the
   inventory date is 2026-10-28.

## Revision (2026-11-17)
Two client behaviors changed in MMCA.Common v1.301.0 (MMCA.Common #758, the UI drift wave; plan in
the workspace `Docs/Planning/Drift/UiProjects-plan.md`). The hierarchy, the retry policy, the
list-page contract and the adoption counts are unchanged.

1. **The client read cache is removed.** `EntityServiceBase` no longer takes an `IUiReadCache` and
   has no `ReadCache`, `GetCachedAsync` or `InvalidateAfterWrite`; all four reads dispatch through
   `SendGetAsync<T>`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/EntityServiceBase.cs:226-233`,
   called at `:64`, `:107`, `:121` and `:142`). Why the tier went, and what was deleted with it, is
   recorded in ADR-026's Revision (2026-11-17). The Decision bullet that described the cache now
   describes the direct read, the `If-Match` bullet no longer ties a lost-response 412 to cache
   invalidation, and the ADR-040 entry under Related no longer names a client cache. Earlier
   revisions that mention the cache record it as it stood on their dates.
2. **`UpdateAsync` sends an `Idempotency-Key`.** The key is minted once, outside the retry, beside
   the `If-Match` value (`EntityServiceBase.cs:175-183`), and rides the same per-operation client as a
   default header (`:327-334`), so a `PUT` whose first attempt landed and only lost its response is
   answered by the server's idempotency filter with the stored 204 rather than a 412 that would tell
   the user someone else changed the item. The idempotency bullet no longer says updates send no
   key; the tests pin a key on an update
   (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/Api/EntityServiceBaseIdempotencyRetryTests.cs:157`)
   and the same key and `If-Match` on every retry (`:174`). The `IdempotentReadRetry` bullet and the
   idempotency-key trade-off now name updates beside creates.

## Revision (2026-11-23)
Re-verified against current source. The hierarchy, the three-retry policy and its replay-safety
rules, the idempotency-key mint, the `EntityServiceBase` (twenty), `ChildEntityServiceBase` (four)
and `IdempotentReadRetry` (twelve in nine files) counts and the list-page contract are unchanged;
the backoff schedule shrank, the direct-root count grew, the bare-factory bearer claim no longer
holds, several behaviors were unrecorded, and anchors moved.

1. **The backoff is 0.5s / 1s / 2s plus up to 250 ms of jitter**, not 2s / 4s / 8s plus 1000 ms
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Api/AuthenticatedServiceBase.cs:244-246`,
   documented at `:239`), so the three backoff waits come to under 4.25 s; a 429 waited out by its
   `Retry-After` can still take up to eight seconds per retry. `MaxRetryAfterWait` is still eight
   seconds (`MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:40`),
   which the retry bullet still calls well past the longest backoff step (now about 2.25 s).
2. **The root's 401 handling is recorded.** `CreateAuthenticatedClientAsync` registers the store its
   bearer came from (`AuthDelegatingHandler.TrackTokenOwner`, `AuthenticatedServiceBase.cs:82`), the
   handler reports a 401 to that store for one renewal and passes the 401 through unreplayed
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Auth/AuthDelegatingHandler.cs:20-33`),
   and a replaying service reads the renewed token through `StorageRenewsRejectedTokens` (`:100`)
   and `ReadRenewedAccessTokenAsync` (`:111`). The lifecycle stays ADR-051's.
3. **A bare-factory client does not carry the signed-in user's bearer on Blazor Server.** The
   `IdempotentReadRetry` bullet said such calls carry it whenever a user is signed in; source says
   the handler's storage resolves in a separate DI scope (`AuthenticatedServiceBase.cs:61-66`,
   `AuthDelegatingHandler.cs:29-31`), and the Store comment records that on Blazor Server that
   store is empty, so the read went out anonymous
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/Lookups/CustomerLookupService.cs:21-25`).
   Store's `CustomerLookupService` now derives from the root (`:33`) and takes its client from
   `CreateAuthenticatedClientAsync` (`:42`, `:89`) before calling the helper (`:44`, `:96`), so the
   bullet no longer describes the helper's callers as all outside the hierarchy;
   `ProductVariantLookupService` keeps the factory-only shape (`ProductVariantLookupService.cs:21`).
4. **Twenty-nine services take `AuthenticatedServiceBase` directly**, not twenty-three: ADC sixteen
   (unchanged), Common nine (adding `FeatureFlagAdminService`, `MachineClientAdminService`,
   `ViewAsGrantsService`, `AuditHistoryService` and `TwoFactorUIService`), Store four (adding
   `CustomerLookupService`).
5. **Store's quote requests carry a retry-only key.** `CheckoutApiService.GetQuoteAsync`
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/Checkout/CheckoutApiService.cs:49`,
   key at `:51`, on a client from `CreateAuthenticatedClientAsync`, `:56`, request built by
   `QuoteRequest`, `:77`) and `CartStateService.FetchQuoteAsync`
   (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/ShoppingCarts/CartStateService.cs:756`,
   key at `:773`) mint one key per quote, but the quote endpoint is `[NonIdempotent]`: the server
   ignores the key and re-prices each attempt, and the key only lets the client retry policy resend
   the POST (`CheckoutApiService.cs:67-72`). The keyed guest actions stay three: placement (`:90`),
   the payment session (`:136`) and the order-link request (`:195`); `ClaimGuestOrderAsync`
   (`:157`) and `CancelGuestOrderAsync` (`:172`) send no key.
6. **Common's per-circuit rule exempts four static members**, not one: `ErrorMessages._localizer`
   plus the three `SecureStoreTokenStorageService` statics
   (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Ui/StateManagementConventionTests.cs:29-35`,
   rationale `:15-28`).
7. **The list page clamps an out-of-range page and exposes a pre-fetch hook.** `FetchWithinRangeAsync`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:1118-1162`)
   refetches the last page when a page past the end comes back empty under a non-zero total, and
   `MovePagerToRows` (`:1174`, called at `:1105`) moves the pager to match; `OnBeforeFetchAsync`
   (`:944`) runs before every fetch; column filter state is restored and persisted through the
   `ColumnFilters` partial (`DataGridListPageBase.ColumnFilters.cs:49`).
8. Anchors re-verified against current source: in `AuthenticatedServiceBase.cs` `RetryPolicy` `:35`,
   `ApiClientName` `:37`, `SharedRetryPolicy` `:46`, `NewIdempotencyKey` `:59`,
   `CreateAuthenticatedClientAsync` `:67-91` (SSR catch `:85-88`), `CreateClientWithToken`
   `:132-139`, `IsRetryableResponse` `:155-174` (501/505 `:157`, `ExceedsRetryBudget` `:162`,
   `IsReplaySafe` check `:167`, 5xx/408/429 `:172-173`), `IsReplaySafe` `:186-200`,
   `ReplaySafeDataKey` `:208`, `MarkReplaySafety` `:219-220`, `IsRetryableException` `:230-234`
   (unmarked `:231`, wired `:292`), `RetryDelay` `:259-267`, `BuildRetryPolicy` `:286-302` (three
   retries `:295`, `onRetry` `:297-301`, dispose `:299`); the replay-safety mark at
   `AuthDelegatingHandler.cs:139` (catch `:135-141`) and the bearer attach at `:192-199`; in
   `EntityServiceBase.cs` the class `:35`, `PagedIncludeFKs` `:49`, `GetAllAsync` `:52-67`,
   `GetPagedAsync` `:70` (query `:79-86`, FKs `:88-91`, filters `:93-104`), `GetAllForLookupAsync`
   `:116-124`, `GetByIdAsync` `:127-143` and both `SendRequestAsync` overloads `:271-289` and
   `:301-317`; the UI `DependencyInjection.cs` registration `:150-173` (flag `:146-147`, base address
   `:162`, timeout `:168`, handlers `:172-173`, proxy `:175-181`); `HttpResilienceDefaults.cs`
   `TotalRequestTimeout` `:21` and `MaxRetryAttempts` `:32`; in `Extensions.cs`
   `ConfigureHttpClientDefaults` `:57-116`, the resilience handler `:68`, retry count `:73`,
   `DisableFor` `:82`, the 429 wrap `:88-92` and service discovery `:94`;
   `BlazorWebHostExtensions.cs:108` (method `:260-271`); `ChildEntityServiceBase.cs` class `:18`,
   `PostAsync` `:35` and `:51`, `DeleteByIdAsync` `:69`; `LivePollUIService.cs:92,155,201` and
   `SessionQuestionUIService.cs:72,104,141`; `SessionLookupService.cs:31,54`,
   `LiveEventService.cs:58`, `BestSellerService.cs:26,53` and `:39`; the inventory anchors
   `EventService.cs:33`, `RoomService.cs:13`, `SpeakerService.cs:18`, `ProductService.cs:28` (base
   `:29`), `PushNotificationService.cs:15`, `SessionAssetService.cs:26`, `UserService.cs:23`,
   `LegalAcceptanceUIService.cs:25`, `UserAdminService.cs:29`, `RoleAdminService.cs:27`, and the
   `CartStateService.cs` uses (`RetryPolicy` `:156`, `:309`, `:346`, `:596`; keys `:302` and `:589`;
   `SendAddItemAsync` `:583`, user add `:113`, merge `:621` per line `:659`); and every
   `DataGridListPageBase.cs` anchor in the list-page section and the depth trade-off. The inventory
   date is 2026-11-23.

## Related
[ADR-034](034-generic-entity-query-layer.md) (the server surface this contract calls, and the filter
grammar the client constructs), [ADR-017](017-request-idempotency.md) (the server-side filter whose
client half is specified here: who mints the key and what keeps it constant),
[ADR-051](051-client-auth-token-lifecycle.md) (how the bearer token this base attaches is obtained,
stored and refreshed across render modes), [ADR-009](009-resilience-and-recovery-objectives.md) (the
server-to-server resilience handler whose budget interacts with, but does not replace, the client
retry), [ADR-056](056-blazor-render-mode-strategy.md) (the render-mode aspect of
`DataGridListPageBase<TDto>`, including the pre-render data handoff and the same inheritor
inventory), [ADR-035](035-optimistic-concurrency.md) (the concurrency token whose `If-Match` carriage
this base owns), [ADR-040](040-authenticated-output-caching-for-public-reads.md) (the server-side
output caching of public reads; this base keeps no client read cache, see
[ADR-026](026-caching-strategy.md), Revision 2026-11-17).
