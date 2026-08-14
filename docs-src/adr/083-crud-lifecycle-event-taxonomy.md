# ADR-083: One CRUD Lifecycle Event per Entity with a State Discriminator

## Status
Accepted (2026-08-14).

## Context
ADR-003 decides how a domain event **moves**: captured into the outbox inside `SaveChangesAsync`,
dispatched in-process after commit, or published to the broker when it is an integration event.
ADR-010 decides how a cross-boundary event contract **evolves**. Neither decides what an event *is*,
and that question lands on every new aggregate on its first day: does creating, editing and
soft-deleting a `Session` raise `SessionCreated`, `SessionChanged` and `SessionDeleted`, or one event
that says which of the three happened?

The `{Entity}Created` / `{Entity}Changed` / `{Entity}Deleted` triple is the default answer in most DDD
samples, and it scales badly in a modular monolith: three record types, three Scrutor-scanned handler
registrations and three serialized outbox payload shapes per entity, so a module with eight aggregates
carries twenty-four event types before a single business rule is expressed. It also splits the
subscriber's view. A handler that wants "something happened to this session" implements three
interfaces and has to keep three implementations in agreement, and adding a fourth transition later
means touching all of them.

## Decision
Every **generic CRUD lifecycle** transition of an entity raises **one event type for that entity**,
carrying a `DomainEntityState` discriminator; handlers filter on `State`.

- **One base record, two members.** `EntityChangedEvent<TIdentifierType>(DomainEntityState State,
  TIdentifierType EntityId) : BaseDomainEvent`, constrained `where TIdentifierType : notnull`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/DomainEvents/EntityChangedEvent.cs:24-27`). Its own XML
  doc states the intent: consolidate the `{Entity}Created` / `{Entity}Changed` / `{Entity}Deleted`
  pattern "into a single event type per entity" (`:6-8`). Deriving from `BaseDomainEvent` means every
  lifecycle event inherits the `MessageId` + `DateOccurred` envelope with no extra members
  (`.../DomainEvents/BaseDomainEvent.cs:28,35`).
- **The discriminator is a four-member enum, three of which are ever raised.** `DomainEntityState` is
  `Unchanged = 0`, `Added = 1`, `Updated = 2`, `Deleted = 3`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Enums/DomainEntityState.cs:7-13`). No production call
  site in any repo raises `Unchanged`: it is the zero default, and it appears only as a negative
  `[InlineData]` case in handler tests
  (`MMCA.ADC/Tests/Modules/Engagement/MMCA.ADC.Engagement.Application.Tests/Points/DomainEventHandlers/SessionQuestionSubmittedPointsHandlerTests.cs:45,60`,
  `MMCA.ADC/Tests/Modules/Conference/MMCA.ADC.Conference.Application.Tests/DomainEvents/SessionCreatedHandlerTests.cs:40`).
- **`Added` from the factory, `Updated` from mutators, `Deleted` from `Delete()`.** The base's usage
  note fixes the mapping (`EntityChangedEvent.cs:10-13`), and `Session` is the canonical shape: one
  event type, three raise sites, in
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Sessions/Session.cs:206` (Added, from
  the static factory), `:267` (Updated), `:304` (Deleted, inside the soft delete), all constructing the
  same `SessionChanged` (`.../Sessions/DomainEvents/SessionChanged.cs:13-18`).
- **Handlers filter on `State`, or deliberately do not.** `SessionCreatedHandler` subscribes to
  `SessionChanged` and returns immediately unless the state is `Added`
  (`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/Sessions/DomainEventHandlers/SessionCreatedHandler.cs:17-18`),
  and the points award for asking a question does the same on `SessionQuestionChanged`
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Application/Points/DomainEventHandlers/SessionQuestionSubmittedPointsHandler.cs:48-49`).
  A handler that genuinely wants every transition writes no filter and logs the discriminator instead:
  `TicketChangedAuditHandler` passes `domainEvent.State` straight into its `LoggerMessage` template
  (`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Application/Tickets/DomainEventHandlers/TicketChangedAuditHandler.cs:23,28-29`).
- **Business state-machine transitions keep their own event types.** The base's doc scopes it to
  generic CRUD and directs events such as `OrderPaid` and `ShoppingCartCheckedOut` to inherit
  `BaseDomainEvent` directly (`EntityChangedEvent.cs:16-19`), which is what they do: `OrderPaid` carries
  a customer, a frozen total and an order-line snapshot
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Domain/Orders/DomainEvents/OrderPaid.cs:13-18`),
  and `ShoppingCartCheckedOut` names the checkout transition rather than an update
  (`.../Sales.Domain/ShoppingCarts/DomainEvents/ShoppingCartCheckedOut.cs:6-8`, raised at
  `.../ShoppingCarts/ShoppingCart.cs:115`). The test is payload plus intent: a transition with a name a
  business person uses and fields no other transition carries gets its own type.
- **The discriminator rides the wire, and it is frozen there.** Store's one cross-module contract puts
  `DomainEntityState State` first on a `BaseIntegrationEvent`
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Shared/Products/IntegrationEvents/ProductVariantChanged.cs:26-32`)
  and explicitly consolidates four former events, `ProductVariantAdded`, `ProductVariantRemoved`,
  `ProductVariantSkuChanged` and `ProductVariantPriceChanged` (`:8-10`). The Sales consumer filters it
  to `Added`
  (`MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Application/Inventory/DomainEventHandlers/ProductVariantAddedHandler.cs:37-38`).
  Because integration-event shapes are snapshot-frozen by an architecture test
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Events.cs:45-58`),
  `State:DomainEntityState` is a committed line of the wire contract
  (`MMCA.Store/Tests/Architecture/MMCA.Store.Architecture.Tests/IntegrationEventContractTests.cs:11`),
  so retyping or removing the discriminator fails the build and, under ADR-010, requires a new event
  type rather than a silent reshape.
- **The shared base is the convenience; the discriminator shape is the convention.** Thirteen concrete
  records derive `EntityChangedEvent<TId>` across the four repos: six in Store (`OrderChanged.cs:19`,
  `ShoppingCartChanged.cs:16`, `InventoryItemChanged.cs:17` under `Sales.Domain`,
  `Catalog.Domain/Products/DomainEvents/ProductChanged.cs:23`,
  `Catalog.Domain/Categories/DomainEvents/CategoryChanged.cs:19`,
  `Identity.Domain/Customers/DomainEvents/CustomerChanged.cs:25`), six in ADC Conference
  (`SponsorChanged.cs:16`, `EventChanged.cs:16`, `QuestionChanged.cs:16`, `CategoryChanged.cs:16`,
  `SpeakerChanged.cs:21`, `SessionChanged.cs:18`), and one in Helpdesk (`TicketChanged.cs:15`).
  Nineteen further event types follow the same one-event-with-`State` shape while inheriting
  `BaseDomainEvent` or `BaseIntegrationEvent` directly, either because they identify a parent/child
  pair rather than a single entity (`RoomChanged` carries `EventId` + `RoomId`,
  `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/DomainEvents/RoomChanged.cs:13-18`;
  `ShoppingCartItemChanged` carries `CustomerId` + `ProductVariantId`,
  `MMCA.Store/Source/Modules/Sales/MMCA.Store.Sales.Domain/ShoppingCarts/DomainEvents/ShoppingCartItemChanged.cs:16-22`)
  or because the module took the shape without the base (all seven ADC Engagement events, for example
  `MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/UserSessionBookmarks/DomainEvents/UserSessionBookmarkChanged.cs:15-20`,
  whose doc cites the same rule as BR-60 at `:8-9`). Counting the shape rather than the base type:
  **22 in ADC, 9 in Store, 1 in Helpdesk**.
- **Nothing enforces the taxonomy.** The shared fitness rules require domain events to be sealed and to
  live in a `*.DomainEvents` namespace
  (`MMCA.Common/Source/Hosting/MMCA.Common.Testing.Architecture/ArchitectureRules.Naming.cs:52-60`), to
  be immutable (`ArchitectureRules.Immutability.cs:34-38`), and require integration events to inherit
  `BaseIntegrationEvent` and declare an `int SchemaVersion` (`ArchitectureRules.Events.cs:6-25`), but no
  rule mentions `EntityChangedEvent` or the discriminator. The framework's own coverage of the base is
  five unit tests over two test doubles, one `int`-keyed and one `Guid`-keyed
  (`MMCA.Common/Tests/Core/MMCA.Common.Domain.Tests/DomainEvents/EntityChangedEventTests.cs:10-59`,
  doubles at `:63-69`).

The seed ships with the pattern, so an adopter starts on it. Helpdesk's `TicketChanged` is the
reference adopter
(`MMCA.Helpdesk/Source/Modules/Tickets/MMCA.Helpdesk.Tickets.Domain/Tickets/DomainEvents/TicketChanged.cs:12-15`),
and because the `MMCA.Templates` pack is staged from that tree rather than from a copy (ADR-065), it is
also what `dotnet new mmca-app` hands over. The seed also shows the one hole in "Added from the
factory": `Ticket`'s identifier is database-generated, so it is still `0` at factory time and the
aggregate deliberately raises **no** `Added` event, with creation signalled after commit by a separate
integration event instead
(`.../Tickets.Domain/Tickets/Ticket.cs:81-84`, published at
`.../Tickets.Application/Tickets/UseCases/Create/CreateTicketHandler.cs:46`); the audit handler's doc
records exactly that gap (`TicketChangedAuditHandler.cs:13-14`). Outside the four repos, the two-module
`MMCA.ECommerce` companion sample carries two more adopters on the same pattern
(`MMCA.ECommerce/Source/Modules/Products/MMCA.ECommerce.Products.Domain/Products/DomainEvents/ProductChanged.cs:15`,
`.../Orders/MMCA.ECommerce.Orders.Domain/Orders/DomainEvents/OrderChanged.cs:15`), which brings the
total number of records deriving the base to **15**.

## Rationale
- **One type per entity is one subscription surface.** A subscriber declares interest in the entity,
  then decides which transitions matter, instead of the container deciding for it across three
  registrations that can drift apart.
- **The triple multiplies types without adding information.** `SessionCreated`, `SessionChanged` and
  `SessionDeleted` would carry the same identifier and the same fields; the only thing that differs is
  the verb, which is precisely what an enum member expresses.
- **The shape survives extraction.** The same record is the in-process domain event in the monolith and
  the serialized outbox payload once the module runs as a service (ADR-003 / ADR-008). Collapsing three
  types into one shrinks the contract surface a consumer must learn and the wire snapshot must freeze.
- **The carve-out keeps the model honest.** A CRUD discriminator is the right answer for "a row
  changed" and the wrong answer for "payment cleared": `OrderPaid` carries an order-line snapshot
  precisely so downstream handlers do not re-query inside an uncommitted transaction
  (`OrderPaid.cs:10-12`). Folding that into a lifecycle base would hang a nullable business payload off
  every entity's event.
- **Adding a transition is cheap.** A new lifecycle state is an enum member plus handler branches, not
  a new record, a new registration and a new payload shape.

## Trade-offs
- **Every selective handler pays a filter.** A handler that cares about one transition has to open with
  a `State` guard and return (`SessionCreatedHandler.cs:17-18` is the shape to copy); omit it and the
  handler fires on all three. The compiler cannot help, because the wrong behavior is an extra silent
  invocation, not a build error.
- **The subscription surface is coarser.** Subscribing means subscribing to the whole entity lifecycle:
  the dispatcher invokes every subscriber on every transition and the handler decides. With separate
  types the container would only ever call a creation handler on creation. Granularity is per entity,
  not per transition.
- **The business-event line is a judgment call, not a rule.** Nothing checks whether a transition
  deserves its own type, and `LivePollChanged` sits right on the line: it folds
  Created/Opened/Closed/Deleted into one event and carries the poll's `LivePollStatus` so handlers can
  tell the transitions apart
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/LivePolls/DomainEvents/LivePollChanged.cs:9-11,17-22`),
  which is a state machine expressed through the CRUD shape rather than as its own events.
- **The base type is optional in practice.** 13 of the 32 lifecycle events across the three apps derive
  `EntityChangedEvent<TId>`; the other 19 re-declare the same two members on `BaseDomainEvent`.
  Consistency is a review convention, not a fitness function (ADR-015), so a new module can drift
  without a failing test.
- **A padded payload where an entity only ever does one thing.** `PointsEntryChanged` carries a `State`
  that is always `Added` because the ledger is append-only, and its doc says so
  (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/Points/DomainEvents/PointsEntryChanged.cs:8-10,17-23`).
  The uniform shape wins over a slimmer event.
- **`Unchanged` is reachable and meaningless.** It is the enum's zero value, so a default-constructed or
  partially deserialized event reads as `Unchanged` rather than failing loudly. Handlers that filter
  positively for the state they want are unaffected; a handler written as a two-branch test over
  `Added` versus everything else would silently treat it as the second branch.
- **A wire discriminator is a versioning obligation.** Once `State` is in the frozen contract
  (`IntegrationEventContractTests.cs:11`), the enum's member values are part of the payload: adding a
  member is additive, but renumbering or removing one is a breaking change under ADR-010.

## Related
ADR-003 (how these events are captured and dispatched; this ADR decides only their shape), ADR-010
(schema versioning for the discriminator once it crosses a service boundary), ADR-008 (the extraction
that turns the same record into a wire payload), ADR-015 (fitness functions: the taxonomy is
deliberately not one of them), ADR-021 (consumer-side dedup on the `MessageId` this base inherits),
ADR-065 (the template pack that ships the pattern to adopters).
