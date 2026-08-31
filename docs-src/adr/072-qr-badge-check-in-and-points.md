# ADR-072: QR Badge Check-In and Points Gamification in ADC

## Status
Accepted (2026-08-13). Amended (2026-08-14): ADC shipped two attendee-self-recorded scan surfaces
(sponsor booth visits and room self check-in), a third `CheckInScope`, a sixth earn rule, and a
leaderboard display-name erasure path. Every decision below still holds (the opaque credential, one
aggregate carrying a scope, index-as-anti-farming, the ADC-local ledger, the opt-in leaderboard); the
"organizers scan attendees, never the reverse" posture is the one that acquired a recorded exception,
amended in place in the Decision and Rationale below.
Revised (2026-08-31): four content-level facts changed and are corrected in place. The sponsor-visit
award is 20 rather than 5, duplicate-key classification moved out of the Engagement module into
MMCA.Common's `IUniqueConstraintViolationDetector` (which matches provider error numbers first and
message text only as a fallback), the leaderboard total is summed by the database rather than folded
in memory, and a batch feedback path joined the two single-answer raise sites. Every decision above
still holds; only the passages that describe those four facts, and the citations throughout, move.

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
unique indexes cover it, on `UserId` and on `Credential`
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

### Organizers scan attendees, with two recorded self-service exceptions
`/check-in` (`.../Engagement.UI/Pages/CheckIn/CheckInScan.razor:1-2`) is `[Authorize(Roles = "Organizer")]`
and its writes carry `[HasPermission(EngagementPermissions.CheckInManage)]`
(`"engagement:checkin:manage"`, `.../Engagement.Shared/Authorization/EngagementPermissions.cs:23`,
applied at `.../Engagement.API/Controllers/CheckInsController.cs:75`, `:99`, `:179`). The attendee's page
`/my-badge` is authenticated-only and displays, never writes. Every `CheckIn` row therefore records both
parties: `UserId` (`.../Engagement.Domain/CheckIns/CheckIn.cs:31`) and `CheckedInByUserId` (`:49`).

Two later endpoints on the same controller are the exception, and are deliberately built as one: they
are attendee scans of a **printed** QR and carry no `[HasPermission]` at all.
`POST /checkins/sponsor-visits` (`CheckInsController.cs:128-143`) records a booth visit behind
`[FeatureGate(EngagementFeatures.SponsorVisits)]` (`:130`), and `POST /checkins/room-visits`
(`:159-174`) checks the caller into whatever session a room is hosting behind
`[FeatureGate(EngagementFeatures.RoomCheckIn)]` (`:161`). Neither takes an attendee from the request:
the identity comes from the token, as on `/my-badge`, and the room endpoint resolves the session
server-side from the room plus a configured grace window rather than accepting a session id
(`:145-158`; `CheckInSettings.RoomCheckInGraceMinutes`, 15 by default, read at
`.../CheckIns/UseCases/RecordRoomCheckIn/RecordRoomCheckInHandler.cs:51`). For these rows the two
parties are the same person, which the aggregate says outright (`CheckIn.cs:46-49`).

The scan surface adapts to the head rather than branching on platform, per ADR-071:
`ScannerAvailable => Scanner.IsSupported` (`CheckInScan.razor.cs:38`) gates the camera card
(`CheckInScan.razor:68`), while the manual attendee-search panel is **always** rendered, because on a web
or Windows head that search *is* the check-in surface (`CheckInScan.razor:108-113`). The scan loop
discards a non-badge QR and keeps scanning rather than failing (`CheckInScan.razor.cs:127-133`).

### One `CheckIn` aggregate carrying a scope
`CheckInScope` is `Event = 0` / `Session = 1` / `Sponsor = 2`
(`.../Engagement.Shared/CheckIns/CheckInScope.cs:14`, `:17`, `:23`), and one aggregate covers all
three: `EventId` is always set (`CheckIn.cs:37`), `SessionId` only for session scope (`:40`), and
`SponsorId` only for sponsor scope (`:43`), with
`CheckInInvariants.EnsureTargetMatchesScope(scope, sessionId, sponsorId)` enforcing the pairing in the
factory (`:102`). Session check-in is the case ADC actually runs; event scope exists because the
model costs nothing extra to support and the door remains TicketLeap's job. Sponsor scope was added
later and cost exactly one nullable column plus one index, which is the property this section claimed
in advance.

### Idempotency and anti-farming are the same index
A repeat scan is answered, not written: `CheckInProcessor.FindExistingAsync` returns the prior row and the
processor reports `AlreadyCheckedIn = true` without a write
(`.../Engagement.Application/CheckIns/Services/CheckInProcessor.cs:71-75`, surfaced on the DTO at
`:147`), so no second integration event is published. Three **filtered unique indexes** are the backstop under a concurrent double scan
(`.../EntityConfiguration/CheckInConfiguration.cs:49-62`): `(UserId, EventId)` filtered to `[Scope] = 0`,
`(UserId, SessionId)` filtered to `[Scope] = 1`, and `(UserId, SponsorId)` filtered to `[Scope] = 2`
(`:60-62`), all three also excluding soft-deleted rows. The third one is what makes a shared sponsor
deep link worth nothing past the first scan.

The points ledger uses the same construction for a different purpose. `PointsEntry`
(`.../Engagement.Domain/Points/PointsEntry.cs:31`, properties `:34-46`) is append-only with no mutators
at all, is marked `IAuditedEntity` so that absence of an update is provable in the data rather than
merely asserted (`:31`), raises `PointsEntryChanged` on create (`:96-101`), and carries a
unique index on `(UserId, ActivityType, SubjectKey)`
(`.../EntityConfiguration/PointsEntryConfiguration.cs:46-48`). That one index is simultaneously the
idempotency guard for redelivered integration events and the anti-farming rule: because the subject key is
`session:{id}`, `event:{id}` or `sponsor:{id}`
(`.../Engagement.Shared/Points/PointsSubjectKeys.cs:16-32`, max 64 chars at `:14`),
asking five questions in one session earns the question award exactly once.

### Points are ADC-local, with the extraction path pre-paid
`IPointsAwarder` is deliberately conference-agnostic:
`AwardAsync(userId, activity, subjectKey, occurredOnUtc, ct)`
(`.../Engagement.Application/Points/Services/IPointsAwarder.cs:35-40`) names no event, session, or
conference concept, and the record for that choice is in the interface itself (`:12-17`): the ledger is
built so it can MOVE to MMCA.Common the day a second consumer (Store loyalty) exists, not before.

- `PointsSettings` (section `"Points"`, `.../Engagement.Shared/Points/PointsSettings.cs:15-40`) carries the
  rule values: `EventCheckIn` 25, `SessionCheckIn` 10, `SessionFeedback` 15, `EventFeedback` 15,
  `QuestionAsked` 5, `SponsorVisit` 20 (`:37`), `LeaderboardSize` 10 (`:40`). The deployed
  configuration restates the same seven values rather than relying on the defaults
  (`.../MMCA.ADC.Engagement.Service/appsettings.json:26-34`).
- **Zero disables a rule.** `PointsAwarder` short-circuits on `value <= 0` and writes nothing
  (`.../Points/Services/PointsAwarder.cs:43-51`); an absent config entry binds to 0 and takes the same
  path.
- The awarded `Points` value is snapshotted onto the entry at award time (`PointsEntry.cs:40`), so the
  ledger records what a rule was worth then.
- A duplicate is success, not failure: the pre-check returns `Result.Success()` (`PointsAwarder.cs:55-64`)
  and a lost race is caught and also returns success (`:75-82`).

Award triggers come from three different mechanisms, chosen per event source:

| Activity | Trigger | Subject key | Delivery |
|---|---|---|---|
| `EventCheckIn` (25) | `AttendeeCheckedIn`, event scope | `event:{id}` | Outbox integration event |
| `SessionCheckIn` (10) | `AttendeeCheckedIn`, session scope | `session:{id}` | Outbox integration event |
| `SessionFeedback` (15) | `SessionFeedbackSubmitted` | `session:{id}` | Outbox integration event |
| `EventFeedback` (15) | `EventFeedbackSubmitted` | `event:{id}` | Outbox integration event |
| `QuestionAsked` (5) | `SessionQuestionChanged`, `Added` only | `session:{id}` | In-module domain event |
| `SponsorVisit` (20) | `AttendeeCheckedIn`, sponsor scope | `sponsor:{id}` | Outbox integration event |

The three `AttendeeCheckedIn` rows are one method mapping wire scope onto an earn rule
(`.../Points/IntegrationEventHandlers/AttendeeCheckedInPointsHandler.cs:65-99`, sponsor branch at
`:88-94`; `PointsActivityType.SponsorVisit = 6`). Room self check-in has no rule of its own: it writes
an ordinary session-scoped `CheckIn` through the shared core
(`.../CheckIns/UseCases/RecordRoomCheckIn/RecordRoomCheckInHandler.cs:72-81`, the scope argument at
`:76`), so it earns the `SessionCheckIn` row above and inherits its once-per-session cap.

`AttendeeCheckedIn` (`.../Engagement.Shared/CheckIns/IntegrationEvents/AttendeeCheckedIn.cs:24-32`) is
raised inside `CheckIn.Create` (`CheckIn.cs:112-119`), so the outbox captures it in the same transaction
as the row (ADR-003), and it carries `Scope` as a **string** (`:26`) so a new scope stays additive.
`SponsorId` proved that: it was added as an optional last parameter (`:31`), so consumers keep
deserializing payloads that predate it. It is ADC's first broker self-consumption: the Engagement
service both publishes and consumes it
(`.../Services/MMCA.ADC.Engagement.Service/Program.cs:264-273` for the reasoning, `:281-284` for the
four `RegisterIntegrationEventConsumer<T>` calls inside `AddBrokerMessaging`).

The two feedback events are new to the Conference module
(`.../Conference.Shared/Sessions/IntegrationEvents/SessionFeedbackSubmitted.cs:20-26`,
`.../Conference.Shared/Events/IntegrationEvents/EventFeedbackSubmitted.cs:19-24`) and are raised on the
**answer-create path only**, never on the BR-107 upsert-update path. Three handlers raise them, and
the create-path-only rule holds at all three: `AddSessionQuestionAnswerHandler.cs:112`,
`AddEventQuestionAnswerHandler.cs:109-112`, and the batch path
`BatchAddSessionQuestionAnswersHandler.cs:155-156`, which emits one `SessionFeedbackSubmitted` per
newly created answer so a whole form submitted in one call produces exactly what the single-answer
handler would have produced call by call (`:152-154`). One feedback form therefore produces one event
per answer row on either path, and the shared subject key collapses them to one award.

`QuestionAsked` rides the existing in-module `SessionQuestionChanged` domain event, filtered to
`DomainEntityState.Added` (`.../Points/DomainEventHandlers/SessionQuestionSubmittedPointsHandler.cs:60-64`),
keyed by session rather than by question (`:85`).

### The leaderboard is opt-in, and opting in is a row
`LeaderboardOptIn` (`.../Engagement.Domain/Points/LeaderboardOptIn.cs:32`, `:35`) holds `UserId` and a
`DisplayName` snapshot, resolved server-side from the caller's token claims rather than accepted from the
request body (`SetLeaderboardParticipationHandler.cs:154-185`, the three claim lookups at `:156-158`;
the request carries only `Participate`, `:50-52`).
Opting out soft-deletes the row (`LeaveAsync`, `:118-136`, `active.Delete()` at `:130`) and rejoining
reactivates it (`JoinAsync`, `:84-89`, the BR-135 pattern), so nobody's name is on the board without a
live opt-in. Erasure is a separate, irreversible promise: `EraseDisplayName()` (`LeaderboardOptIn.cs:119-130`)
overwrites the published name in place when the account behind it is erased, and it is driven by a fourth
broker consumer, `UserDeleted` -> `UserDeletedPointsHandler` (`Program.cs:284`, the mapping documented at
`:258`), because the published name is the one piece of personal data the Identity-side erasure cannot
reach across the database boundary (`Program.cs:260-262`). The row itself survives (anonymize-in-place,
ADR-005). `GetLeaderboard`
(`.../Points/UseCases/GetLeaderboard/GetLeaderboardHandler.cs`) reads only opted-in users' entries
(`:39-46`), asks the database for one grouped `SUM` per attendee rather than reading the ledger rows
(`SumByAsync`, `:55-59`, filtered to the opted-in ids at `:58`), then orders by total and display name
(`:68-69`) and assigns distinct sequential ranks (`:73`).

`Engagement.CheckIn` and `Engagement.Points` are feature flags enforced with `[FeatureGate]` at the
controllers (`CheckInsController.cs:33`, `PointsController.cs:34`, ADR-031), and the two self-service
surfaces added two more, gated per action rather than per controller so each printed artifact can be
retired on its own: `Engagement.SponsorVisits` (`.../Engagement.Shared/EngagementFeatures.cs:37`) and
`Engagement.RoomCheckIn` (`:44`). GDPR export is extended in the
same pass: `user_engagement_export.proto` gains `points_entries`, `leaderboard_opt_in` and
`leaderboard_display_name` (`:34-41`) plus an `EngagementPointsEntryExportItem` message (`:63-80`); the
check-in history followed as `check_ins = 6` (`:45`) with an `EngagementCheckInExportItem` message
(`:82-101`) carrying scope, event, session and sponsor.

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
  That is why the organizer scan remains the primary path, and it is unchanged.
  *Amended 2026-08-14:* ADC now also ships the other direction, as a bounded exception rather than a
  reversal. Sponsor booth visits and room self check-in are printed QRs the attendee scans, so the code
  **is** shareable and the argument above applies to them in full. What changed is that the exposure is
  now priced instead of avoided: the once-per-subject filtered unique index caps a leaked sponsor link at
  one award per attendee (`CheckInConfiguration.cs:60-62`), the award is a single per-sponsor grant
  and zero-able mid-conference (`PointsSettings.cs:32-37`), each surface has its own kill switch
  (`EngagementFeatures.cs:37`, `:44`), and the row still records both parties even when they are the
  same person (`CheckIn.cs:46-49`), so a self-recorded row is identifiable as one rather than
  indistinguishable from an organizer scan. Both flags ship on
  (`.../MMCA.ADC.Engagement.Service/appsettings.json:21-22`), so the exception is live, not dormant:
  turning either off is a configuration change that restores the original posture for that surface.
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
  in as that attendee. The mitigations are that a badge scan is organizer-side, that every row records who
  scanned, and that `Regenerate()` invalidates a leaked code, but the value itself carries no proof of
  possession.
- **`QuestionAsked` is at-most-once and says so.** It rides an in-process domain event dispatched after
  commit, so a crash in that window loses one five-point award and nothing else: no question is lost
  and no total is corrupted (`SessionQuestionSubmittedPointsHandler.cs:30-39`). The body is
  additionally wrapped in a best-effort, CA1031-suppressed catch (`:92-97`), so a failing award never
  fails the question that already committed. Only that pre-dispatch crash is silent; every path that
  declines to award logs it, at a level matching how surprising it is (`:41-44`, `:100-110`).
  Promotion to an integration event is a one-file change per side, deliberately deferred: five points
  do not justify an outbox row per question.
- **The feature flags gate the surface, not the ledger.** `[FeatureGate]` sits on the controllers and the
  two self-service actions, and no Engagement handler implements `IFeatureGated`, so turning
  `Engagement.Points` off hides the pages and the API while
  the event consumers keep accruing entries. That is recoverable (the ledger is append-only and correct)
  but it is not what "off" usually means.
- **Rule values are snapshotted, so history is mixed-rate.** Changing `SessionCheckIn` from 10 to 15 does
  not restate earlier entries, which is right for an audit ledger and confusing on a leaderboard where two
  attendees with identical activity can hold different totals.
- **Duplicate-key detection is an injected framework concern, not module code.** The Application layer
  references neither EF Core nor SqlClient, so it cannot read a provider error number itself. It asks
  someone who can: `IUniqueConstraintViolationDetector`
  (`MMCA.Common.Application/Interfaces/Infrastructure/IUniqueConstraintViolationDetector.cs:31`) is
  constructor-injected into all three ADC handlers that can lose an insert race, so `PointsAwarder`
  (`:32`, catch filter at `:75`), `SetLeaderboardParticipationHandler` (`:33`, `:103`) and
  `GetOrCreateMyBadgeHandler` (`:20`, `:53`) classify one way rather than three. The registered
  implementation walks the inner exception chain matching **SQL Server error numbers 2601 and 2627
  first** (`MMCA.Common.Infrastructure/Persistence/SqlServerUniqueConstraintViolationDetector.cs:34`,
  `:37`, `:50-54`), and falls back to the message text "duplicate key" or "UNIQUE constraint failed"
  only for a link in the chain that is not a `SqlException` (`:40`, `:43`, `:63-67`). The trade that
  remains is the fallback: it is provider-dependent string matching, kept because a retry decorator or
  a test double re-throwing its own type carries the number nowhere but the message. The pre-check
  makes the whole path rare, not hot.
- **The leaderboard total is a database `SUM`, so ordering is the part that stays in memory.**
  `GetLeaderboardHandler` pushes the aggregation down (`SumByAsync`, `:55-59`) and one grouped total
  comes back per opted-in attendee rather than every ledger row. What still runs in the handler is the
  ordering, the `Take` and the rank assignment (`:65-77`), bounded by the opt-in population rather
  than by the size of the ledger. The remaining wrinkle is a type one: points are stored as `int` and
  the grouped sum speaks `decimal`, so the selector widens implicitly and the total narrows back on
  the way out (`:50-53`, `:61`).
- **Broker self-consumption for an in-service concern.** `AttendeeCheckedIn` is published and consumed by
  the same Engagement service, so an in-service award takes a broker round-trip. That is the price of
  keeping the award path identical to the cross-module ones (feedback arrives from Conference) and of
  leaving Engagement extractable, but it is a real hop for a local fact.
- **A once-per-subject rule caps engagement as well as farming.** The second question an attendee asks in
  a session earns nothing, which is the anti-farming rule working as designed and also a small
  disincentive at exactly the moment a room is warming up.
- **The export carries the activity as a number.** `activity_type` is an `int32` rather than a proto enum
  (`user_engagement_export.proto:70`, with the reasoning at `:64-69`), because proto3 forces a zero member
  and 0 is reserved as "unset" on the C# side, so a reader of the raw export sees `3` rather than
  `SessionFeedback`. The check-in export item repeats the trade for `scope` (`:82-86`).

## Related
[ADR-071](071-barcode-scanning-and-qr-display.md) (the framework halves this consumes: the QR component on
`/my-badge` and the scanner capability behind `/check-in`),
[ADR-003](003-outbox-dual-dispatch.md) (the outbox path `AttendeeCheckedIn` and the two feedback events
take, and the at-least-once delivery the unique index makes safe),
[ADR-021](021-consumer-inbox-idempotency.md) (the broker-dedup sibling; the points ledger's unique index is
a stronger, persisted form of the same guarantee),
[ADR-020](020-permission-based-authorization.md) (`engagement:checkin:manage` and
`engagement:points:view-overview` as capability grants rather than roles),
[ADR-031](031-feature-flag-management.md) (the four `Engagement.*` gates on this surface, including the
two per-action ones, and the 404-not-403 posture), [ADR-005](005-soft-delete-vs-erasure.md) (the GDPR
export the points ledger, the check-in history and the leaderboard opt-in now extend, and the
anonymize-in-place rule `EraseDisplayName()` follows).
