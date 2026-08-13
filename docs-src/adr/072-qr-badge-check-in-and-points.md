# ADR-072: QR Badge Check-In and Points Gamification in ADC

## Status
Accepted (2026-08-13).

## Context
ADC wanted two conference-day capabilities that turn out to be one mechanism. Organizers want to know
who actually attended which session, which the schedule cannot tell them: a bookmark is an intention and
feedback arrives from a self-selected minority. Attendees want a reason to show up to a session they did
not plan on and to leave feedback afterwards, which is a rewards problem rather than a data problem.

Registration and door admission are **not** part of this. ADC sells tickets through TicketLeap, and
TicketLeap already scans people through the door on the morning of the event. Rebuilding arrival
check-in would produce two systems with two different opinions about who is in the building, and the one
holding the money would be right. What TicketLeap cannot do is tell an organizer that 60 people sat in
the third-track talk at 2pm.

That framing left a set of open questions with no recorded answer:

- **What does the QR actually carry?** A signed token (JWT or an HMAC over the user id) verifies offline
  and needs no lookup. An opaque handle carries nothing and requires the server.
- **Who scans whom?** An attendee scanning a code posted on a room door needs no staff, but a photograph
  of that door code lets anyone check in from the hallway. An organizer scanning an attendee's badge
  needs a person with a device.
- **Is a session check-in the same kind of thing as an event check-in?** They differ only by whether a
  session is named.
- **Where do points live?** A points ledger is generic infrastructure by shape, and
  [ADR-042](042-device-capability-abstraction.md) and this workspace's practice both say reusable
  infrastructure belongs to MMCA.Common. But no second consumer exists: MMCA.Store has no loyalty
  feature today.
- **Is a leaderboard compatible with an attendee's privacy expectations?** Ranking people by name is a
  publication of attendance behavior.

The framework half of the mechanism (the QR component and the camera capability) is
[ADR-071](071-barcode-scanning-and-qr-display.md). This record decides what ADC does with it.

## Decision

### The badge credential is an opaque, server-verified handle
`AttendeeBadge` (`MMCA.ADC/Source/Modules/Engagement/MMCA.ADC.Engagement.Domain/Badges/AttendeeBadge.cs:17-24`)
is one row per user holding a single `Guid Credential`, minted on first read of `/my-badge` by a
get-or-create command rather than a query
(`.../Engagement.Application/CheckIns/UseCases/GetOrCreateMyBadge/GetOrCreateMyBadgeHandler.cs`). Two
filtered unique indexes cover it, on `UserId` and on `Credential`
(`.../Engagement.Infrastructure/Persistence/EntityConfiguration/AttendeeBadgeConfiguration.cs:31-36`).

- The credential is `Guid.NewGuid()` and explicitly **not** `Guid.CreateVersion7()`
  (`AttendeeBadge.cs:65-68`): a v7 value embeds a timestamp and orders monotonically, which is exactly
  wrong for a bearer value that must be unguessable.
- `Regenerate()` (`:59-63`) issues a new credential, which revokes every previously printed or
  screenshotted copy in one write.
- The wire format is `mmca-adc:badge:{credential}`
  (`.../Engagement.Shared/CheckIns/BadgePayload.cs:15-20`). `TryExtractCredential` (`:30-45`) accepts the
  prefixed form **or** a bare GUID, case-insensitively, and rejects `Guid.Empty`, so the manual path can
  take a typed value and the scanner can reject a foreign QR by prefix.

### Organizers scan attendees, never the reverse
`/check-in` (`.../Engagement.UI/Pages/CheckIn/CheckInScan.razor:1-2`) is `[Authorize(Roles = "Organizer")]`
and its writes carry `[HasPermission(EngagementPermissions.CheckInManage)]`
(`"engagement:checkin:manage"`, `.../Engagement.Shared/Authorization/EngagementPermissions.cs:23`,
applied at `.../Engagement.API/Controllers/CheckInsController.cs:66`, `:86`, `:105`). The attendee's page
`/my-badge` is authenticated-only and displays, never writes. Every `CheckIn` row therefore records both
parties: `UserId` and `CheckedInByUserId`
(`.../Engagement.Domain/CheckIns/CheckIn.cs:24-39`).

The scan surface adapts to the head rather than branching on platform, per ADR-071:
`ScannerAvailable => Scanner.IsSupported` (`CheckInScan.razor.cs:36`) gates the camera card
(`CheckInScan.razor:68`), while the manual attendee-search panel is **always** rendered, because on a web
or Windows head that search *is* the check-in surface (`CheckInScan.razor:108-113`). The scan loop
discards a non-badge QR and keeps scanning rather than failing (`CheckInScan.razor.cs:125-129`).

### One `CheckIn` aggregate carrying a scope
`CheckInScope` is `Event = 0` / `Session = 1` (`.../Engagement.Shared/CheckIns/CheckInScope.cs`), and one
aggregate covers both: `EventId` is always set, `SessionId` is set only for session scope
(`CheckIn.cs:24-39`). Session check-in is the case ADC actually runs; event scope exists because the
model costs nothing extra to support and the door remains TicketLeap's job.

### Idempotency and anti-farming are the same index
A repeat scan is answered, not written: `CheckInProcessor.FindExistingAsync` returns the prior row and the
processor reports `AlreadyCheckedIn = true` without a write
(`.../Engagement.Application/CheckIns/Services/CheckInProcessor.cs:59-68`), so no second integration event
is published. Two **filtered unique indexes** are the backstop under a concurrent double scan
(`.../EntityConfiguration/CheckInConfiguration.cs:48-55`): `(UserId, EventId)` filtered to `[Scope] = 0`
and `(UserId, SessionId)` filtered to `[Scope] = 1`, both also excluding soft-deleted rows.

The points ledger uses the same construction for a different purpose. `PointsEntry`
(`.../Engagement.Domain/Points/PointsEntry.cs:23-39`) is append-only with no mutators at all, and carries a
unique index on `(UserId, ActivityType, SubjectKey)`
(`.../EntityConfiguration/PointsEntryConfiguration.cs:46-48`). That one index is simultaneously the
idempotency guard for redelivered integration events and the anti-farming rule: because the subject key is
`session:{id}` or `event:{id}` (`.../Engagement.Shared/Points/PointsSubjectKeys.cs:19-25`, max 64 chars),
asking five questions in one session earns the question award exactly once.

### Points are ADC-local, with the extraction path pre-paid
`IPointsAwarder` is deliberately conference-agnostic:
`AwardAsync(userId, activity, subjectKey, occurredOnUtc, ct)`
(`.../Engagement.Application/Points/Services/IPointsAwarder.cs:35-40`) names no event, session, or
conference concept, and the record for that choice is in the interface itself (`:12-17`): the ledger is
built so it can MOVE to MMCA.Common the day a second consumer (Store loyalty) exists, not before.

- `PointsSettings` (section `"Points"`, `.../Engagement.Shared/Points/PointsSettings.cs:15-33`) carries the
  rule values: `EventCheckIn` 25, `SessionCheckIn` 10, `SessionFeedback` 15, `EventFeedback` 15,
  `QuestionAsked` 5, `LeaderboardSize` 10.
- **Zero disables a rule.** `PointsAwarder` short-circuits on `value <= 0` and writes nothing
  (`.../Points/Services/PointsAwarder.cs:44-49`); an absent config entry binds to 0 and takes the same
  path.
- The awarded `Points` value is snapshotted onto the entry at award time (`PointsEntry.cs:33`), so the
  ledger records what a rule was worth then.
- A duplicate is success, not failure: the pre-check returns `Result.Success()` (`PointsAwarder.cs:55-62`)
  and a lost race is caught and also returns success (`:73-80`).

Award triggers come from three different mechanisms, chosen per event source:

| Activity | Trigger | Subject key | Delivery |
|---|---|---|---|
| `EventCheckIn` (25) | `AttendeeCheckedIn`, event scope | `event:{id}` | Outbox integration event |
| `SessionCheckIn` (10) | `AttendeeCheckedIn`, session scope | `session:{id}` | Outbox integration event |
| `SessionFeedback` (15) | `SessionFeedbackSubmitted` | `session:{id}` | Outbox integration event |
| `EventFeedback` (15) | `EventFeedbackSubmitted` | `event:{id}` | Outbox integration event |
| `QuestionAsked` (5) | `SessionQuestionChanged`, `Added` only | `session:{id}` | In-module domain event |

`AttendeeCheckedIn` (`.../Engagement.Shared/CheckIns/IntegrationEvents/AttendeeCheckedIn.cs:21-28`) is
raised inside `CheckIn.Create` (`CheckIn.cs:95`), so the outbox captures it in the same transaction as the
row (ADR-003), and it carries `Scope` as a **string** so a new scope stays additive. It is ADC's first
broker self-consumption: the Engagement service both publishes and consumes it
(`.../Services/MMCA.ADC.Engagement.Service/Program.cs:259-264`).

The two feedback events are new to the Conference module
(`.../Conference.Shared/Sessions/IntegrationEvents/SessionFeedbackSubmitted.cs:19-24`,
`.../Conference.Shared/Events/IntegrationEvents/EventFeedbackSubmitted.cs:18-22`) and are raised on the
**answer-create path only**, never on the BR-107 upsert-update path
(`AddSessionQuestionAnswerHandler.cs:131-134`, `AddEventQuestionAnswerHandler.cs:109-112`). One feedback
form produces one event per answer row, and the shared subject key collapses them to one award.

`QuestionAsked` rides the existing in-module `SessionQuestionChanged` domain event, filtered to
`DomainEntityState.Added` (`.../Points/DomainEventHandlers/SessionQuestionSubmittedPointsHandler.cs:48-49`),
keyed by session rather than by question (`:74`).

### The leaderboard is opt-in, and opting in is a row
`LeaderboardOptIn` (`.../Engagement.Domain/Points/LeaderboardOptIn.cs:19-28`) holds `UserId` and a
`DisplayName` snapshot, resolved server-side from the caller's token claims rather than accepted from the
request body (`SetLeaderboardParticipationHandler.cs:142-161`; the request carries only `Participate`).
Opting out soft-deletes the row and rejoining reactivates it (`:73-103`, the BR-135 pattern), so nobody's
name is on the board without a live opt-in. `GetLeaderboard`
(`.../Points/UseCases/GetLeaderboard/GetLeaderboardHandler.cs`) reads only opted-in users' entries, folds
totals in memory, orders by total then display name, and assigns distinct sequential ranks.

`Engagement.CheckIn` and `Engagement.Points` are feature flags enforced with `[FeatureGate]` at the
controllers (`CheckInsController.cs:32`, `PointsController.cs:34`, ADR-031). GDPR export is extended in the
same pass: `user_engagement_export.proto` gains `points_entries`, `leaderboard_opt_in` and
`leaderboard_display_name` (`:34-41`) plus an `EngagementPointsEntryExportItem` message (`:59-76`).

## Rationale
- **An opaque credential makes the server the only interpreter.** A JWT or HMAC badge would verify
  offline, but the scanning device is online by necessity (it has to write a check-in row), so offline
  verification buys nothing. What it costs is real: a signed token is self-describing, so a screenshot
  leaks whatever claims it carries; it cannot be revoked without a revocation list, which is a second
  store; and it is long, which makes a denser QR that is harder to read off a dim phone screen. A GUID is
  short, meaningless to anyone holding it, and revoked by one `Regenerate()`.
- **Scanning direction decides who can cheat.** A code posted at a room door is a photograph away from
  remote check-in by anyone in the building or on social media. Making the organizer's device the scanner
  moves the trust to a person holding a permission, and the record of who scanned lands on every row.
- **Session-first respects the product that already owns the door.** TicketLeap is the system of record
  for admission, and a second arrival check-in would create a disagreement rather than a capability. The
  scope enum leaves event check-in modelled and available without ADC asserting ownership of it.
- **One aggregate with a scope beats two aggregates that differ by a nullable column.** Splitting
  `EventCheckIn` and `SessionCheckIn` would duplicate the factory, the integration event, the idempotency
  rule, the query surface and the migration for a distinction that a single enum expresses. The filtered
  unique indexes give each scope its own exact constraint anyway.
- **The anti-farming rule and the idempotency rule are genuinely the same rule.** "Award this user once
  for this subject" is what makes a redelivered broker message safe and what makes a fifth question worth
  nothing. Expressing it once, as a unique index, means the two cannot drift apart, and the database is
  the arbiter rather than handler code.
- **ADC-local is the honest place for the ledger today.** Moving it to MMCA.Common now would add a public
  API surface and a lockstep release obligation (ADR-016) for a single consumer, and the shape of a second
  consumer is guesswork until Store actually needs loyalty. The cost of waiting was paid up front instead:
  the awarding vocabulary carries no conference nouns and the subject key is an opaque string, so the move
  is a project relocation rather than a redesign.
- **Opt-in is the only defensible default for a leaderboard.** A ranked list of names is a publication of
  who attended what. Snapshotting the display name at opt-in additionally keeps the board query out of
  Identity, so the reward surface does not become a second read path onto user records.
- **Points are earned by facts the system already publishes.** Check-in, feedback and question-asked are
  events that exist for their own reasons; the ledger is a consumer of them, so gamification adds no new
  write path to the features it rewards.

## Trade-offs
- **The badge credential is a bearer value.** Anyone who photographs an attendee's screen can be checked
  in as that attendee. The mitigations are that a scan is organizer-side, that every row records who
  scanned, and that `Regenerate()` invalidates a leaked code, but the value itself carries no proof of
  possession.
- **`QuestionAsked` is at-most-once and says so.** It rides an in-process domain event dispatched after
  commit, so a crash in that window silently loses one five-point award
  (`SessionQuestionSubmittedPointsHandler.cs:23-32`, whose body is additionally wrapped in a best-effort
  catch). Promotion to an integration event is a one-file change per side, deliberately deferred: five
  points do not justify an outbox row per question.
- **The feature flags gate the surface, not the ledger.** `[FeatureGate]` sits on the controllers, and no
  handler implements `IFeatureGated`, so turning `Engagement.Points` off hides the pages and the API while
  the event consumers keep accruing entries. That is recoverable (the ledger is append-only and correct)
  but it is not what "off" usually means.
- **Rule values are snapshotted, so history is mixed-rate.** Changing `SessionCheckIn` from 10 to 15 does
  not restate earlier entries, which is right for an audit ledger and confusing on a leaderboard where two
  attendees with identical activity can hold different totals.
- **Duplicate-key detection is message-text matching.** `PointsAwarder.IsDuplicateKey` walks the inner
  exception chain looking for "duplicate key", "UNIQUE KEY constraint" or "unique index"
  (`PointsAwarder.cs:112-125`) because the Application layer references neither EF Core nor SqlClient, and
  it deliberately does not match SQL Server error numbers 2601/2627. Layer purity is bought with a
  provider-dependent string comparison; the pre-check makes it a rare path, not a hot one.
- **The leaderboard folds totals in memory.** `GetLeaderboardHandler` reads the opted-in users' entries and
  sums them client-side, because the Application layer has no EF Core to push a `GROUP BY` down with. It is
  bounded by the opt-in population and fine at conference scale; it is not a design that survives a much
  larger ledger.
- **Broker self-consumption for an in-service concern.** `AttendeeCheckedIn` is published and consumed by
  the same Engagement service, so an in-service award takes a broker round-trip. That is the price of
  keeping the award path identical to the cross-module ones (feedback arrives from Conference) and of
  leaving Engagement extractable, but it is a real hop for a local fact.
- **A once-per-subject rule caps engagement as well as farming.** The second question an attendee asks in
  a session earns nothing, which is the anti-farming rule working as designed and also a small
  disincentive at exactly the moment a room is warming up.
- **The export carries the activity as a number.** `activity_type` is an `int32` rather than a proto enum
  (`user_engagement_export.proto:61-66`), because proto3 forces a zero member and 0 is reserved as "unset"
  on the C# side, so a reader of the raw export sees `3` rather than `SessionFeedback`.

## Related
[ADR-071](071-barcode-scanning-and-qr-display.md) (the framework halves this consumes: the QR component on
`/my-badge` and the scanner capability behind `/check-in`),
[ADR-003](003-outbox-dual-dispatch.md) (the outbox path `AttendeeCheckedIn` and the two feedback events
take, and the at-least-once delivery the unique index makes safe),
[ADR-021](021-consumer-inbox-idempotency.md) (the broker-dedup sibling; the points ledger's unique index is
a stronger, persisted form of the same guarantee),
[ADR-020](020-permission-based-authorization.md) (`engagement:checkin:manage` and
`engagement:points:view-overview` as capability grants rather than roles),
[ADR-031](031-feature-flag-management.md) (the `Engagement.CheckIn` / `Engagement.Points` gates and the
404-not-403 posture), [ADR-005](005-soft-delete-vs-erasure.md) (the GDPR export the points ledger and
leaderboard opt-in now extend).
