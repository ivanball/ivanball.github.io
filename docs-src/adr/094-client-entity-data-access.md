# ADR-094: Client-Side Entity Data-Access Contract

## Status
Accepted (2026-08-23).

## Context
ADR-034 decided the **server** half of entity data access: a generic controller base with a dynamic
query contract, where filters arrive as `filters[Property].operator` / `filters[Property].value` query
pairs bound by `QueryFilterModelBinder`
(`MMCA.Common/Source/Presentation/MMCA.Common.API/ModelBinders/QueryFilterModelBinder.cs:12,20,92`).
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
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/AuthenticatedServiceBase.cs:15`). It owns
  the named `"APIClient"` (`:35`), the bearer attachment
  (`CreateAuthenticatedClientAsync`, `:59-78`, tolerating the SSR pre-render case where JS interop is
  unavailable, `:72-75`), the explicit-token variant used to replay a 401 with a freshly refreshed
  token (`CreateClientWithToken`, `:88-95`, the client end of ADR-051), the retry policy, and the
  idempotency-key mint. The client itself is registered once, in `AddUIShared`
  (`.../MMCA.Common.UI/DependencyInjection.cs:63-82`): base address from `ApiSettings`, `Accept:
  application/json`, `AuthDelegatingHandler` plus `CultureDelegatingHandler`, and a transport timeout
  pinned to the shared 90-second budget (`:77`, `MMCA.Common/Source/Core/MMCA.Common.Shared/Resilience/HttpResilienceDefaults.cs:19`)
  so the BCL's uncoordinated 100-second default cannot cut a call off mid-policy.
- **Typed CRUD is `EntityServiceBase<TEntityDTO, TIdentifierType>`**
  (`.../MMCA.Common.UI/Services/EntityServiceBase.cs:25`), implementing
  `IEntityService<TEntityDTO, TIdentifierType>` (`.../MMCA.Common.UI/Common/Interfaces/IEntityService.cs:12`).
  It is a **hand-written typed base over the ADR-034 REST surface, not a generated client**: no Refit,
  Kiota or NSwag client generator appears in any of the four repos' `Directory.Packages.props`.
- **The client owns query-string construction for the dynamic query contract.**
  `GetPagedAsync` builds `pageNumber`, `pageSize`, `sortColumn`, `sortDirection`, `includeChildren`
  (`EntityServiceBase.cs:62-69`) and emits exactly the bracketed filter pairs the server binder parses,
  escaping every component (`:71-82`, the pairs at `:77-79`). `GetAllAsync` (`:34-51`),
  `GetAllForLookupAsync` (`:92-102`) and `GetByIdAsync` (`:104-120`, with `treatNotFoundAsDefault`)
  cover the remaining reads.
- **Retry is owned by the client base, not by a resilience handler.** `RetryPolicy`
  (`AuthenticatedServiceBase.cs:26-32`) is a static Polly policy: three retries after the initial
  attempt, on `HttpRequestException` or a retryable response, with 2s / 4s / 8s exponential backoff
  plus up to 1000 ms of jitter so a fleet of clients does not re-converge on one instant.
  `IsRetryableResponse` (`:108-117`) retries 5xx **except** 501 and 505 (permanent verdicts) and adds
  408 and 429 (the server explicitly inviting a later attempt). Every dispatch runs through
  `SendRequestAsync` (`EntityServiceBase.cs:183-224`), which passes the caller's `CancellationToken`
  into the policy (`:204`) so cancellation aborts the wait between attempts instead of sleeping out
  the backoff budget.
- **The `Idempotency-Key` is minted client-side and survives retries.** `NewIdempotencyKey()` returns a
  compact GUID (`AuthenticatedServiceBase.cs:51`); the header name is the shared constant
  `IdempotencyHeaders.IdempotencyKey` (`MMCA.Common/Source/Core/MMCA.Common.Shared/Http/IdempotencyHeaders.cs:19`).
  Only `AddAsync` supplies one (`EntityServiceBase.cs:131-136`): creates are the one CRUD verb that is
  not naturally idempotent, so reads, full `PUT` updates and deletes send no key (`:139-163`). The key
  is set as a **default header on the single `HttpClient` that serves every attempt** (`:193-200`),
  which is what makes the value constant across the retry burst and therefore dedupable by the ADR-017
  filter. Both properties are pinned by tests: the same key on every retry
  (`MMCA.Common/Tests/Presentation/MMCA.Common.UI.Tests/Services/EntityServiceBaseIdempotencyRetryTests.cs:91`),
  no key on reads, updates or deletes (`:112,123,134`), and the 501-not-retried / 429-retried edges
  (`:146,158`).
- **The dispatch returns a `Result`; it does not throw** (2026-08-27, v1.164.0). `SendRequestAsync`
  wraps the whole send-and-read in `HttpResultExecutor.ExecuteAsync` and hands the response to
  `ProblemDetailsResultReader`, in both the value-returning overload
  (`EntityServiceBase.cs:216`, composition at `:223-232`) and the body-less one (`:244`, at
  `:251-258`). The reader turns a non-success response back into the errors the server described,
  with the original `ErrorType` preserved when the payload carries the MMCA error array, and the
  executor turns a call that never got a response (connection, DNS, socket, timeout) into a failure
  of its own. A page therefore branches on a `Result` instead of catching, and sees the business
  reason rather than "500" without any exception being minted to carry it
  ([ADR-013](013-result-pattern.md)). This replaces the earlier arrangement, in which the client
  pulled the domain wording out of the ProblemDetails body and **rethrew** it as a
  `DomainInvariantViolationException` before falling back to `EnsureSuccessStatusCode`: that helper
  is deleted, not deprecated. `ChildEntityServiceBase` was converted in the same pass
  (`.../MMCA.Common.UI/Services/ChildEntityServiceBase.cs:37`, `:53`, `:71`).
- **Join entities use `ChildEntityServiceBase`**
  (`.../MMCA.Common.UI/Services/ChildEntityServiceBase.cs:17`), the many-to-many sibling: `PostAsync`
  (`:24`) and `DeleteByIdAsync` (`:39`, `false` on 404). It shares the bearer helper and the same
  `Result` dispatch but deliberately issues its calls directly, **outside** `RetryPolicy` and
  with no idempotency key.
- **Non-CRUD services take the root directly and reuse the same policy.** Services whose endpoints are
  not entity CRUD derive from `AuthenticatedServiceBase` itself and call the inherited `RetryPolicy`
  by hand, minting a key where the endpoint is `[Idempotent]` (for example
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Services/LivePollUIService.cs:96,143` and
  `.../SessionQuestionUIService.cs:75`).

Adoption inventory as of 2026-08-23. **Sixteen production services derive from `EntityServiceBase`**:
nine in ADC Conference (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.UI/Services/`:
`ActivityService.cs:11`, `CategoryItemService.cs:11`, `ConferenceCategoryService.cs:11`,
`EventService.cs:14`, `QuestionService.cs:11`, `RoomService.cs:14`, `SessionService.cs:11`,
`SpeakerService.cs:13`, `SponsorService.cs:11`), six in Store (`Catalog.UI/Services/ProductService.cs:15`
and `CategoryService.cs:15`; `Sales.UI/Services/OrderService.cs:14`, `ShoppingCartService.cs:15`,
`InventoryItemService.cs:14`; `Identity.UI/Services/CustomerService.cs:15`), and one inside the
framework itself (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Services/Notifications/PushNotificationService.cs:19`).
**Four derive from `ChildEntityServiceBase`**, all in ADC Conference
(`.../Services/ChildEntityServices.cs:15,31,47,63`). **Sixteen more take `AuthenticatedServiceBase`
directly**: ten in ADC Engagement, four in ADC Conference, ADC Identity's `UserService.cs:15`, and the
framework's `NotificationInboxService.cs:33`. Store has none of that third kind; its one hand-rolled
exception is `CartStateService`
(`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.UI/Services/Cart/CartStateService.cs:392`), which
sits outside the hierarchy and re-implements the key mint locally, honoring the same rule (one key per
user action, reused by every attempt, `:83-85`).

### The list-page contract: `DataGridListPageBase<TDto>`

The consumer side of that data-access contract is equally uniform, and is recorded here rather than
separately because the two are used as a pair: a list page inherits the base and hands it a fetch
delegate that is almost always an `EntityServiceBase.GetPagedAsync` call.

`DataGridListPageBase<TDto>`
(`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Common/DataGridListPageBase.cs:20`) owns:

- **Server-side paging through MudDataGrid `ServerData`.** `LoadServerDataAsync` (`:434`) flattens the
  grid's filter definitions into the one-filter-per-column dictionary the fetch delegate takes, with
  the newest row winning when the user stacks two filters on one column (`ExtractGridFilters`,
  `:605-617`), extracts sort from `GridState` (`ExtractSortParameters`, `:619-623`), and converts the
  grid's zero-based page to the API's one-based `pageNumber` (`:490`).
- **Cancellation-token management.** Each fetch swaps in a fresh source before tearing down the
  previous one, tolerating the `ObjectDisposedException` race a debounced reload after disposal would
  otherwise raise (`ResetCancellationTokenAsync`, `:576-598`); during SSR pre-render the token
  additionally times out after `PrerenderFetchTimeoutMs` (5000 ms) so a cold backend cannot block the
  page load (`:82`, `CreateFetchCts`, `:523-532`).
- **A `LoadFailed` flag that distinguishes error-with-retry from genuinely empty** (`:40`, set at
  `:507` and `:565`). A failed fetch renders zero rows, which is visually identical to an empty list
  once the error snackbar expires, so pages branch on this flag in `NoRecordsContent` instead of
  showing the "no records" state.
- **Viewport-driven mobile card state.** `IsMobile` (`:44`) flips from the browser-viewport observer
  (`:263-276`) below the 960 px sidebar-collapse threshold, and the card view has its own paged fetch
  path (`MobileItems` / `MobileTotalItems` / `MobileCurrentPage` / `MobilePageSize`, `:47-50`;
  `LoadMobileDataAsync`, `:538`).
- **List state persisted and restored three ways.** `ListPageState`
  (`.../MMCA.Common.UI/Services/ListPageStateService.cs:9`) carries page, page size, mobile page, sort,
  density, filters and scroll position; `ListPageStateService` (`:58`) holds it in memory and mirrors
  it to `sessionStorage`, and `ListPageQueryStateService`
  (`.../MMCA.Common.UI/Services/ListPageQueryStateService.cs:28`) encodes it into the URL. The URL is
  the source of truth on initialization, with the in-memory entry as the fallback and scroll position
  read only from it (`DataGridListPageBase.cs:168-205`); writes go to all three (`SaveCurrentState`,
  `:625-662`). Deferred writes are dropped once the user has navigated away, because the route is
  pinned at initialization rather than read from the live URI at write time (`_ownRoutePath`, `:166`;
  `IsOwnRouteCurrent`, `:713-714`).

**Nineteen types inherit this base**: thirteen in ADC and six in Store, eighteen of them routable list
pages plus ADC's non-routable `AttendeeSearchPanel`
(`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.UI/Pages/CheckIn/AttendeeSearchPanel.razor.cs:16`).
ADR-056 owns the render-mode aspect of the same type (the `PersistentComponentState` pre-render
handoff and the `InteractiveAuto` registration) and carries the same count.

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
- **The list page is repeated nineteen times, so it is worth a base class.** Paging, cancellation,
  filter and sort extraction, viewport switching, error state and state restoration are identical
  across every list in both apps; nineteen hand-rolled copies is nineteen chances to get the
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
  `ConfigureHttpClientDefaults` (`MMCA.Common/Source/Hosting/MMCA.Common.Aspire/Extensions.cs:48-64`),
  including `"APIClient"`. Because the UI base already makes up to four attempts, the shared
  per-hop retry count is pinned to **one**
  (`HttpResilienceDefaults.cs:21-28`, applied at `Extensions.cs:63`), with the reason stated in both
  places: full budgets at every hop turned a backend brownout into an up-to-16x request storm. The
  cost is that the effective attempt count for a UI action is a product of two layers and cannot be
  read off either one alone.
- **The retry policy is `static` and not configurable.** `RetryPolicy` is a `protected static readonly`
  field (`AuthenticatedServiceBase.cs:26`), so its counts and delays are compile-time constants shared
  by every service in the process. A per-endpoint or per-environment retry profile would need a change
  to the framework, not configuration.
- **Only `AddAsync` gets an idempotency key automatically.** Any non-CRUD write (a hand-written POST on
  a service deriving from `AuthenticatedServiceBase`, or code outside the hierarchy such as
  `CartStateService`) has to mint and attach the key itself, and nothing fails the build if it does
  not. `ChildEntityServiceBase.PostAsync` is one such write and sends no key today.
- **`ChildEntityServiceBase` calls are not retried.** Join add and remove operations get the bearer
  token and domain-error extraction but no transient-fault handling, so a blip surfaces to the user
  where the same blip on the parent entity would be absorbed.
- **The list-page base is deep.** It coordinates render-mode-aware persistence, three state stores, JS
  interop for scroll tracking, and two MudDataGrid v9 parameter-setter workarounds
  (`DataGridListPageBase.cs:358-365`, `:393-419`). That depth is the price of nineteen pages behaving
  identically, but it makes the base itself the hardest type in the UI package to change safely.

## Related
[ADR-034](034-generic-entity-query-layer.md) (the server surface this contract calls, and the filter
grammar the client constructs), [ADR-017](017-request-idempotency.md) (the server-side filter whose
client half is specified here: who mints the key and what keeps it constant),
[ADR-051](051-client-auth-token-lifecycle.md) (how the bearer token this base attaches is obtained,
stored and refreshed across render modes), [ADR-009](009-resilience-and-recovery-objectives.md) (the
server-to-server resilience handler whose budget interacts with, but does not replace, the client
retry), [ADR-056](056-blazor-render-mode-strategy.md) (the render-mode aspect of
`DataGridListPageBase<TDto>`, including the pre-render data handoff and the same nineteen-inheritor
inventory).
