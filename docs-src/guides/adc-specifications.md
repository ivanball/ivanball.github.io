# ADC (Atlanta Developers Conference) - Business Specifications

_As of: 2026-10-28._

---

## 1. System Overview

### Purpose
ADC is a conference management system for the **Atlanta Developers Conference**. It provides backend services to manage multi-day conference events, sessions, speakers, rooms, categories, and attendee feedback (question/answer surveys for events, sessions, and speakers). It supports user registration via email + password authentication (with optional MAUI device metadata) or external sign-in with Google, GitHub or Apple, and integrates with the **Sessionize** platform to import conference schedule data (including speaker social links and questions).

### Core Business Domains (organized by bounded context)

**Conference** (master schedule data: organizer-managed, Sessionize-imported):
- **Event Management** - Creating and managing conference events, rooms, sessions, and speakers
- **Speaker & Category Management** - Organizing speakers by categories (e.g., track, level, tags)
- **Feedback Collection** - Gathering attendee ratings and comments on events, individual sessions, and speakers
- **Sponsor Management** - Organizer-managed sponsors and exhibitors grouped by tier, published with their event (BR-240 to BR-243)
- **Partner Management** - Organizer-managed community and special partners (for example the venue host) that support an event without a sponsorship package, published with their event and shown in a partners band on the Home page (BR-256 to BR-260)
- **Social Activity Management** - Organizer-managed social and networking activities (for example a pre-conference party or a coffee connect) attached to an event, each with its own time and venue, published with their event
- **Session Materials** - Files and links published against a session by its speakers or by content managers (BR-116b)
- **Session Selection** - AI-assisted scoring of submitted sessions as organizer decision support (UC-27)
- **External Data Sync** - Importing conference data from Sessionize

**Engagement** (attendee-generated activity: user-facing):
- **Personal Schedule** - Attendee session bookmarking
- **Live Polls** - Conference-day polls scoped to an event or a single session, with live tallies ([ADR-039](../adr/039-live-channel-push.md))
- **Live Session Q and A** - Attendee-submitted questions with moderation and upvoting, displayed anonymously
- **Badge Check-In** - Organizers scan an attendee's QR badge to record session attendance, and attendees self-record sponsor booth visits and room check-ins from printed QR codes; door admission stays with TicketLeap (BR-244 to BR-249, BR-261, BR-262)
- **Points and Leaderboard** - An append-only rewards ledger fed by check-in, sponsor visits, feedback and questions, with an opt-in leaderboard (BR-250 to BR-254)

**Identity** (identity and authentication):
- **User Management** - Email + password registration, external OAuth sign-in (Google, GitHub, Apple), send-only email confirmation, JWT authentication, permission-based authorization, and organizer user administration (account lock and role change, BR-264)

**Notification** (real-time delivery): hosts the SignalR notification hub that pushes live-layer updates to clients (BR-229, ADR-039). It has no domain model of its own.

### Key Capabilities
1. Full CRUD lifecycle for events, sessions, speakers, rooms, categories, and questions
2. Attendee survey/feedback submission scoped to the authenticated user (events, sessions, and speakers)
3. One-click data refresh from Sessionize to sync categories, speakers, rooms, sessions, and speaker social links
4. Paginated, filterable, sortable querying across all entities with lookup support
5. JWT-based authentication (email + password or external OAuth sign-in) for web and mobile attendees
6. Personal schedule builder with session bookmarking
7. Multi-day event support with per-event time zone configuration
8. Venue and room wayfinding information (floor, location, capacity, venue address, map URL)
9. Event publish/unpublish control for organizers
10. Room and session accessibility information for attendees with disabilities
11. Live stream and recording URLs for sessions
12. Plenum session designation for plenary/all-hands sessions
13. Top/featured speaker designation
14. Per-event sponsor, partner and social activity listings
15. Speaker-published session materials (files and links)
16. Conference-day live polls, session Q and A, badge check-in, sponsor visits, room check-in, and an opt-in points leaderboard

---

## 2. Domain Model

### Bounded Context: Conference

#### Event (Aggregate Root)

| Attribute | Meaning |
|---|---|
| Name | The official name of the conference event (required) |
| Description | Longer description of the event (optional) |
| StartDate | The first day of the conference event (DateOnly, required) |
| EndDate | The last day of the conference event (DateOnly, required). Must be >= StartDate. For single-day events, StartDate equals EndDate. |
| TimeZone | The IANA time zone identifier for the event's location (e.g., "America/New_York") (required). All session times are interpreted in this time zone. Used to convert session wall-clock times to UTC for the Now/Next read, the live-layer window and calendar export. |
| SessionizeCode | Integration code used to fetch data from the Sessionize API (optional). When set it must be well-formed (BR-6) and unique across events (BR-263). |
| VenueAddress | Physical address of the conference venue (optional) |
| VenueMapUrl | URL to a venue map or floor plan (optional, absolute URL when provided, BR-98) |
| WiFiInfo | WiFi network name and access instructions for attendees (optional) |
| OrganizerContactEmail | Organizer contact email published to attendees (optional, `Email` value object). When absent, the public event page falls back to the host-configured support address. |
| SponsorshipPacketUrl | URL of the published sponsorship packet for this edition (optional, absolute URL). When absent, the sponsorship call to action is hidden. |
| TicketingUrl | URL where attendees buy tickets for this edition (optional, absolute URL). When absent, the ticketing call to action is hidden. |
| IsPublished | Whether the event is visible to all users (default: false). When false, the event is visible only to privileged readers (`Organizer` or `ContentEditor`). When true, the event is visible to all users via public endpoints. |
| QuestionModerationDefault | The initial status of attendee-submitted live session questions for this event: `Pending` (default) or `Approved` (BR-233). |
| LastSessionizeRefreshOn | Timestamp of the most recent Sessionize data refresh for this event (nullable). Used to enforce the refresh throttle (BR-63). |
| LastSessionizeRefreshBy | User ID of the organizer who triggered the most recent Sessionize refresh (nullable). |

**Relationships:**
- Owns many **Rooms** (child entities)
- Owns many **EventSpeakers** (child join entities linking Event ↔ Speaker)
- Owns many **EventQuestionAnswers** (child feedback entities)
- Has many **Sessions** (associated by EventId)
- Referenced by many **Sponsors**, **Partners**, **Activities** and **SessionAssets** (their own aggregate roots, associated by EventId and reached by the event cascade, BR-127)

**Lifecycle:** Created manually or seeded. May be refreshed from Sessionize when SessionizeCode is set.

---

#### Session (Aggregate Root)

| Attribute | Meaning |
|---|---|
| Title | The name/title of the session (required) |
| Description | Detailed description of the session content (optional) |
| StartsAt | Scheduled start time (optional, set during scheduling) |
| EndsAt | Scheduled end time (optional, set during scheduling) |
| Status | Current status of the session, imported from Sessionize. Default: null (manually created sessions have no status; a blank or whitespace status is stored as null). The system recognizes six Sessionize status values: `Accepted` (confirmed), `Waitlisted` (on waitlist), `Accept_Queue` (queued for acceptance review), `Nominated` (nominated for consideration), `Decline_Queue` (queued for decline review), and `Declined` (rejected). Only `Accepted` and null statuses are eligible for public display, bookmarking, and feedback (BR-49). All other statuses are excluded from public views and engagement actions. |
| IsInformed | Whether the speaker has been informed about the session status |
| IsConfirmed | Whether the speaker has confirmed their participation |
| IsServiceSession | Whether this is a non-talk session (e.g., lunch break, registration, networking). Service sessions are displayed on the schedule but are not bookmarkable and do not support feedback. Default: false. Note: keynotes are typically not service sessions: they are talks with speakers. |
| IsPlenumSession | Whether this is a plenum (plenary/all-hands) session (default: false). Informational: used for display purposes to distinguish plenary sessions from breakout sessions. Imported from Sessionize when available. |
| LiveUrl | URL to a live stream for the session (optional, absolute http or https URL). Allows attendees to watch the session remotely. Displayed alongside session details when present. |
| RecordingUrl | URL to a recording of the session (optional, absolute http or https URL). Typically populated after the session concludes. Displayed alongside session details when present. |
| AccessibilityInfo | Description of accessibility accommodations for this session (optional, e.g., "Live captioning provided", "Sign language interpreter available"). Informational: displayed to attendees for planning. |
| ResourceLinks | Free-text field for speakers to share supplementary links (slides, code repos, blog posts). Optional. Imported from Sessionize and displayed to attendees alongside session details, unchanged. Structured materials are **not** stored here: uploaded files and curated links live in the separate SessionAssets list (BR-116b, ADR-123), rendered beneath this field on the public session page. |
| Duration | Computed: whole minutes between `StartsAt` and `EndsAt` when both are non-null, null otherwise. Read-only to callers: persisted as a stored computed column (`DATEDIFF(minute, StartsAt, EndsAt)`) and kept in step by the domain whenever the times change, so the sessions grid can sort on it. Serialized in DTOs as total minutes (e.g., `60`). |

**Relationships:**
- Belongs to one **Event** (required)
- May be assigned to one **Room** (optional)
- Owns many **SessionSpeakers** (child join entities linking Session ↔ Speaker)
- Owns many **SessionQuestionAnswers** (child feedback entities)
- Owns many **SessionCategoryItems** (child join entities linking Session ↔ CategoryItem)
- Referenced by many **UserSessionBookmarks** (Engagement context: own aggregate root)
- Referenced by many **SessionAssets** (own aggregate root, BR-116b) and by at most one active **SessionAiScore** (own aggregate root)
- Referenced by Engagement live-layer and attendance rows (**LivePolls**, **SessionQuestions**, **CheckIns**) by scalar SessionId

---

#### Speaker (Aggregate Root)

| Attribute | Meaning |
|---|---|
| FirstName | Speaker's first name (required) |
| LastName | Speaker's last name (required) |
| Email | Speaker's email address (optional, imported from Sessionize; `Email` value object, so stored trimmed and lowercased). Not exposed via public API: used only for organizer management. Overwritten with a non-identifying placeholder when the linked account is erased (BR-56). |
| Bio | Speaker biography (optional) |
| TagLine | Short tagline or title (optional) |
| ProfilePicture | URL to the speaker's profile picture (optional) |
| TwitterHandle | Speaker's Twitter/X handle (optional, imported from Sessionize) |
| LinkedInUrl | URL to speaker's LinkedIn profile (optional, imported from Sessionize) |
| GitHubUrl | URL to speaker's GitHub profile (optional, imported from Sessionize) |
| WebsiteUrl | URL to speaker's personal website or blog (optional, imported from Sessionize) |
| IsTopSpeaker | Whether the speaker is a featured/top speaker (default: false). Used for display purposes to highlight keynote or featured speakers. Imported from Sessionize when available. |
| LinkedUserId | FK to User entity (optional, unique when non-null). Set when a user is linked to this speaker and cleared on unlink or speaker deletion; changed only through the link and unlink operations, never by a general update. 1:1 relationship with `User.LinkedSpeakerId`. See Section 12.4. |
| FullName | Computed: "{FirstName} {LastName}" |

**Relationships:**
- Has many **EventSpeakers** (events the speaker participates in)
- Has many **SessionSpeakers** (sessions the speaker presents)
- Owns many **SpeakerCategoryItems** (child join entities linking Speaker ↔ CategoryItem)
- Owns many **SpeakerQuestionAnswers** (child feedback entities for speaker-level survey responses)
- May be linked to one **User** (via LinkedUserId: 1:1, see Section 12.4)

**Visibility:** a speaker is publicly visible only with at least one visible session (BR-49 eligible) in the scoped event set (BR-239): the selected event on event-scoped reads, all Published events otherwise. `EventSpeaker` rows grant no visibility: the Sessionize sync creates one for every imported speaker, so they carry no acceptance signal. Hidden speakers are filtered from list, paged, lookup, and junction reads, and a GET by id returns HTTP 404 for non-privileged callers, with one carve-out: the linked speaker can always read their own profile (the BR-214 self-edit form cannot load without it), and that self-read is never stored into the shared output cache. Privileged readers (`Organizer` or `ContentEditor`) see every speaker. `Email` stays redacted from public reads regardless of visibility (BR-66).

**Lifecycle:** `Speaker.Create(id?, firstName, lastName, email?, bio?, tagLine?, profilePicture?, isTopSpeaker, twitterHandle?, linkedInUrl?, gitHubUrl?, websiteUrl?)` sets the profile, with the four social links optional at creation; a speaker created without an id is given a new GUID. `Update()` replaces the profile and social links but never `LinkedUserId`, which only `LinkUser()` and `UnlinkUser()` change (BR-208, BR-209). Soft-deleting a speaker clears `LinkedUserId` and leaves its category and question-answer children in place (BR-70, BR-71). A Sessionize refresh keeps a stored social link when the feed carries none for that field, the same rule it applies to Email.

---

#### Category (Aggregate Root)

| Attribute | Meaning |
|---|---|
| Title | Name of the category (e.g., "Session format", "Level", "Track") (required) |
| Sort | Display order |
| Type | Category type classifier (optional) |

**Relationships:**
- Owns many **CategoryItems** (child entities: the values within this category)

> **Global scope warning:** Categories are not scoped to a specific event (IR-5). All events share the same category pool. When multiple events use Sessionize import (UC-6), Sessionize-assigned Category and CategoryItem IDs (BR-61) must be consistent across all Sessionize sources. If two events import from different Sessionize instances that assign different meanings to the same category ID, the second refresh will overwrite the first event's category data (BR-48). This is acceptable for the current single-event-per-year model but becomes a data corruption risk if multiple concurrent events use independent Sessionize sources. See BR-74 for mitigation guidance.

---

#### CategoryItem

| Attribute | Meaning |
|---|---|
| Name | The specific value within a category (e.g., "Beginner", "Workshop", ".NET") (required) |
| Sort | Display order within the category |

**Relationships:**
- Belongs to one **Category** (required)
- Has many **SessionCategoryItems** (sessions tagged with this item)
- Has many **SpeakerCategoryItems** (speakers tagged with this item)

---

#### Room

| Attribute | Meaning |
|---|---|
| Name | Room name or number (required, unique within the event among active rooms, case-insensitive, BR-255) |
| Sort | Display order for room listing |
| Capacity | Maximum seating capacity of the room (optional, integer). Displayed to attendees for planning purposes. |
| Floor | Floor number or level name within the venue (optional, e.g., "2", "Mezzanine"). Used for wayfinding. |
| Location | Descriptive location within the venue (optional, e.g., "East Wing", "Near Registration Desk"). Used for wayfinding. |
| AccessibilityInfo | Description of accessibility features for the room (optional, e.g., "Wheelchair accessible, hearing loop available, reserved seating for mobility aids"). Informational: displayed to attendees for planning. |

**Relationships:**
- Belongs to one **Event** (required)
- Has many **Sessions** (sessions scheduled in this room)

---

#### Question

| Attribute | Meaning |
|---|---|
| QuestionText | The survey question text (required) |
| QuestionEntity | Indicates whether the question targets "Session", "Event", or "Speaker" (required, exact canonical casing: determines which survey the question appears in; see BR-15) |
| QuestionType | The answer format: "Rating" (numeric score), "Text" (free-text comment), or "Email" (email address), in exact canonical casing. Determines answer validation: Rating answers must be integers 1-5, Text answers are free-text (max 2000 chars), Email answers must be valid email format. Unrecognized values are rejected. (required) |
| Sort | Display order of the question in the survey |
| IsRequired | Whether the attendee should answer this question (default: false). Advisory: clients should enforce in the UI, but the server does not validate completeness (BR-95). |
| QuestionSource | The origin of the question: "Sessionize" (imported from Sessionize during refresh) or "User" (created manually by an organizer). Required, case-insensitive. Determines provenance tracking: Sessionize-sourced questions follow the Sessionize source-of-truth rule (BR-48) during refresh, while User-sourced questions are unaffected by Sessionize refresh. Attendee session feedback accepts only User-sourced questions (BR-128): a Sessionize question is call-for-papers data the refresh owns. |

**Relationships:**
- Has many **EventQuestionAnswers**
- Has many **SessionQuestionAnswers**
- Has many **SpeakerQuestionAnswers**

---

#### EventQuestionAnswer

| Attribute | Meaning |
|---|---|
| AnswerValue | The attendee's response (required, at most 4000 characters, then validated against the question type, BR-124) |

**Relationships:**
- Belongs to one **Event** (required)
- Belongs to one **Question** (required)

**Note:** Exposes a computed `QuestionType` derived from the associated Question.

---

#### SessionQuestionAnswer

| Attribute | Meaning |
|---|---|
| AnswerValue | The attendee's response (required, at most 4000 characters, then validated against the question type, BR-124) |

**Relationships:**
- Belongs to one **Session** (required)
- Belongs to one **Question** (required)

**Note:** Exposes a computed `QuestionType` derived from the associated Question.

---

> **Join Entity Convention:** All join entities below are pure association records with no business attributes beyond their foreign keys. They support **add and delete only**: update is not meaningful when there are no mutable attributes. To change an association, delete and re-create it. Each is unique per parent and target among active rows (domain duplicate check plus a filtered unique index), and re-adding a soft-deleted association reactivates the same row (BR-135).

#### EventSpeaker (Join Entity)

Links a **Speaker** to an **Event**.

---

#### SessionSpeaker (Join Entity)

Links a **Speaker** to a **Session**.

---

#### SessionCategoryItem (Join Entity)

Links a **Session** to a **CategoryItem** (tag/classification).

---

#### SpeakerCategoryItem (Join Entity)

Links a **Speaker** to a **CategoryItem** (tag/classification).

---

#### SpeakerQuestionAnswer

| Attribute | Meaning |
|---|---|
| AnswerValue | The attendee's response (required, at most 4000 characters, then validated against the question type, BR-124) |

**Relationships:**
- Belongs to one **Speaker** (required)
- Belongs to one **Question** (required)

**Note:** Exposes a computed `QuestionType` derived from the associated Question. Speaker-level feedback enables attendees to rate and comment on individual speakers independently of specific sessions.

---

#### Sponsor (Aggregate Root)

| Attribute | Meaning |
|---|---|
| EventId | The owning event (required, immutable after creation) |
| Name | Sponsor name (required, max 200 characters) |
| Tier | `Platinum`, `Gold`, `Silver` or `Community` (required, BR-241) |
| LogoUrl, Description, WebsiteUrl, LinkedInUrl | Optional display fields (max 2000 characters each) |
| TwitterHandle | Optional handle (max 100 characters) |
| Sort | Display order within the tier |
| IsExhibitor | Whether the sponsor also exhibits (default: false) |
| BoothNumber | Optional booth label (max 50 characters), recorded independently of `IsExhibitor` |

**Business Rules:** BR-240 to BR-243. Database-generated id. Soft-deleted with its event (BR-127). Referenced by sponsor-visit check-ins (BR-261).

---

#### Partner (Aggregate Root)

| Attribute | Meaning |
|---|---|
| EventId | The owning event (required, immutable after creation) |
| Name | Partner name (required, max 200 characters) |
| PartnerType | `Community` (default) or `Special` (BR-257) |
| LogoUrl, WebsiteUrl | Optional absolute http or https URLs (max 2000 characters each) |
| Description | Optional description (max 2000 characters) |
| Sort | Display order within the type |

**Business Rules:** BR-256 to BR-260. Database-generated id. Soft-deleted with its event (BR-127).

---

#### Activity (Aggregate Root)

A social or networking activity attached to an event (for example a pre-conference party, a coffee connect or an after-party). It is deliberately not a session: it has no room and no speakers, and it carries its own venue because it often happens away from the conference venue.

| Attribute | Meaning |
|---|---|
| EventId | The owning event (required) |
| Name | Activity name (required, max 200 characters) |
| Description | Optional description (max 2000 characters) |
| StartTime / EndTime | When the activity runs (required); `EndTime` must not be before `StartTime` |
| VenueName | Optional venue name (max 200 characters) |
| VenueAddress | Optional venue address (max 500 characters) |
| VenueUrl | Optional venue link (absolute http or https URL, max 2000 characters) |
| SortOrder | Display order (must be >= 0) |

Database-generated id (activities are planned in ADC, not imported). Writes require `conference:activities:manage` (`Organizer` and `ContentEditor`); reads are anonymous and limited to published events for non-privileged callers. Soft-deleted with its event (BR-127).

---

#### SessionAsset (Aggregate Root)

One piece of material published against a session: an uploaded file or a link to material hosted elsewhere (BR-116b, ADR-123). It is its own aggregate rather than a child of Session so that it survives every Sessionize refresh untouched.

| Attribute | Meaning |
|---|---|
| EventId | The session's event, denormalized for the blob path, the event cascade and the published-event read filter |
| SessionId | The session the material belongs to (required) |
| Kind | `File` or `Link` |
| Title | Display title (required, max 200 characters) |
| Url | Absolute http or https download address (required, max 2000 characters): the blob URL for a file, the supplied address for a link |
| BlobName, ContentType, SizeBytes | Storage details, set for a file and null for a link (blob name max 500, content type max 100 characters) |
| SortOrder | Display order |
| UploadedBySpeakerId | The speaker who published it, when a speaker did |

The id is a server-minted GUID rather than a database-generated integer, because it is a segment of the public blob name and must be unguessable.

---

#### SessionAiScore (Aggregate Root)

The stored result of AI-assisted session scoring used as organizer decision support (UC-27).

| Attribute | Meaning |
|---|---|
| SessionId | The scored session (one active score per session, enforced by a filtered unique index) |
| OverallScore, TopicRelevanceScore, DescriptionQualityScore, NoveltyScore, ActionableTakeawaysScore, DepthOrInsightQualityScore, CredibilityExperienceScore | Decimal scores, each between 1.0 and 10.0 inclusive |
| Reasoning | The model's explanation |
| ModelUsed / PromptVersion | Which model and prompt version produced the score |

Re-scoring a session replaces its score: the previous row is soft-deleted and the new one inserted in one transaction, so a session whose re-score fails keeps the score it already had.

---

### Bounded Context: Engagement

> **Design rationale:** Engagement entities are separated from Conference because they have fundamentally different write profiles. Conference data is organizer-managed and low-write (imported from Sessionize, edited by organizers). Engagement data is attendee-generated and high-write (hundreds of users bookmarking during a live session). Mixing them in one bounded context would create aggregate contention.

#### UserSessionBookmark (Aggregate Root)

| Attribute | Meaning |
|---|---|
| *(no additional business attributes beyond the foreign keys)* | Links a User to a Session they plan to attend |

**Relationships:**
- References one **User** (required)
- References one **Session** (required)

**Business Rules:** BR-21 (unique per user+session), BR-22 (informational only)
- The session's EventId is **not denormalized** onto the bookmark: it is derived from `Session.EventId` when needed via a join, avoiding inconsistency if a session were reassigned

---

#### The conference-day live layer

Live polls and live Q and A are the conference-day surface of the Engagement context
([ADR-039](../adr/039-live-channel-push.md)). Both sit behind their own feature gates
(`Engagement.LivePolls` and `Engagement.SessionQA`), so a deployment can run the schedule without the
live layer.

Two design choices recur across the five live-layer entities below (LivePoll through SessionQuestionUpvote) and are worth reading once:

- **Live-window snapshotting.** Whether an event is "live" is Conference data, but checking it per
  vote or per upvote would mean a cross-service call on the hottest path in the system. Instead the
  event's live-window end is copied onto the poll when it opens (BR-223/BR-224) and onto the question
  when it is submitted (BR-237), so the accept/reject check is a local comparison.
- **Votes and upvotes are their own aggregate roots, not children.** They are the highest-write rows
  in the system. Loading them into the parent aggregate would bloat the change tracker and contend on
  the parent row, so each is a standalone root with a filtered unique index enforcing one active row
  per (parent, user) (BR-225, BR-235).

#### LivePoll (Aggregate Root)

| Attribute | Meaning |
|---|---|
| EventId | The event the poll belongs to (required) |
| SessionId | The session the poll is scoped to, or null for an event-wide poll (BR-230) |
| Question | The poll question, 1-200 characters (BR-220) |
| Status | Draft, Open, or Closed (BR-221) |
| LiveWindowEndUtc | Exclusive end of the event's live window, snapshotted when the poll is opened (BR-224) |

**Relationships:**
- Owns many **LivePollOptions** (authored with the poll, 2-10, unique texts, each 1-100 characters, BR-220)
- Referenced by many **LivePollVotes** (separate aggregate roots, BR-225)

**Business Rules:** BR-220, BR-221, BR-222, BR-223, BR-224, BR-226, BR-228, BR-230, BR-236

#### LivePollOption

Child of LivePoll: display `Text` and a `Sort` order. Cascade soft-deleted with its parent.

#### LivePollVote (Aggregate Root)

| Attribute | Meaning |
|---|---|
| LivePollId | The poll voted on |
| OptionId | The chosen option (must belong to the poll and not be deleted, BR-226) |
| UserId | The voting user |

**Business Rules:** BR-224, BR-225, BR-226

#### SessionQuestion (Aggregate Root)

| Attribute | Meaning |
|---|---|
| SessionId | The session the question was asked in (required) |
| EventId | The owning event, denormalized from the session at submission. Metadata only, deliberately not validated |
| UserId | The submitting user. **Never exposed on DTOs**: questions display anonymously (BR-238) |
| Text | The question text, 1-500 characters (BR-231) |
| Status | Pending, Approved, or Dismissed; starts at the event's moderation default (BR-233/BR-234) |
| IsAnswered | Set once a moderator marks an approved question answered (BR-234) |
| LiveWindowEndUtc | Exclusive end of the event's live window, snapshotted at submission (BR-237) |

**Relationships:**
- Referenced by many **SessionQuestionUpvotes** (separate aggregate roots, BR-235)

**Business Rules:** BR-231, BR-233, BR-234, BR-235, BR-236, BR-237, BR-238

#### SessionQuestionUpvote (Aggregate Root)

| Attribute | Meaning |
|---|---|
| SessionQuestionId | The question upvoted |
| UserId | The upvoting user |

One active upvote per (question, user), enforced by a filtered unique index. Un-upvoting soft-deletes
the row and re-upvoting reactivates it rather than inserting a second one (BR-235, the BR-135 pattern).

**Business Rules:** BR-235, BR-237, BR-238

#### AttendeeBadge (Aggregate Root)

| Attribute | Meaning |
|---|---|
| UserId | The badge owner (unique: one badge per user) |
| Credential | An opaque random GUID encoded in the badge QR (unique across badges); regenerating replaces it |

**Business Rules:** BR-244

#### CheckIn (Aggregate Root)

| Attribute | Meaning |
|---|---|
| UserId | The attendee checked in |
| Scope | `Event`, `Session` or `Sponsor` |
| EventId | The event (always set) |
| SessionId | Set only for `Session` scope |
| SponsorId | Set only for `Sponsor` scope |
| CheckedInByUserId | Who recorded it: an organizer for a scanned or manual check-in, the attendee themselves for a self-recorded sponsor visit or room check-in |
| CheckedInOn | When it was recorded |

Creating a check-in raises the `AttendeeCheckedIn` integration event through the outbox (BR-249). One active row per (user, event), (user, session) and (user, sponsor) for the matching scope, enforced by filtered unique indexes (BR-246). Change history is recorded (audited entity).

**Business Rules:** BR-245 to BR-249, BR-261, BR-262

#### PointsEntry (Aggregate Root)

| Attribute | Meaning |
|---|---|
| UserId | The attendee awarded |
| ActivityType | `EventCheckIn`, `SessionCheckIn`, `SessionFeedback`, `EventFeedback`, `QuestionAsked` or `SponsorVisit` |
| Points | The awarded value, snapshotted from configuration at award time (BR-251) |
| SubjectKey | `event:{id}`, `session:{id}` or `sponsor:{id}` (max 64 characters) |
| OccurredOnUtc | When the awarded activity happened |

Append-only: no mutators. Unique per (UserId, ActivityType, SubjectKey) among active rows (BR-250).

#### LeaderboardOptIn (Aggregate Root)

| Attribute | Meaning |
|---|---|
| UserId | The participating user (unique) |
| DisplayName | The name published on the leaderboard, snapshotted at opt-in (max 100 characters); overwritten with `Deleted Account` when the account is erased |

Opting out soft-deletes the row and rejoining reactivates it (BR-253).

#### ErasedUser (Aggregate Root)

A tombstone recording that an account was erased (UserId, unique, and ErasedOn, with no personal data), so Engagement can refuse writes that arrive after the erasure from a still-valid access token (BR-56).

---

### Bounded Context: Identity

#### User (Aggregate Root)

| Attribute | Meaning |
|---|---|
| Email | User's email address (required, unique, case-insensitive; `Email` value object, stored trimmed and lowercased). Canonical identity across all platforms. |
| IsEmailConfirmed | Whether the address has been proven reachable, by redeeming a confirmation link or by an external provider asserting it (default: false). Informational: sign-in is not gated on it. |
| PasswordHash | Cryptographic hash of the user's password (byte[], stored as varbinary). Never stored or transmitted in plaintext. Empty for an external-only account. |
| PasswordSalt | Per-user cryptographic salt for password hashing (byte[], stored as varbinary). Empty for an external-only account. |
| FirstName | User's first name (required, max 100 characters). Used for display and speaker matching. |
| LastName | User's last name (required, max 100 characters). Used for display and speaker matching. |
| Role | The user's authorization role: `Attendee` (default), `ContentEditor`, or `Organizer`. Determines access to administrative endpoints. `Organizer` and `ContentEditor` together form the **privileged reader** audience used by the visibility rules (BR-49, BR-108, BR-132, BR-239). ADC has no `Admin` role. |
| LinkedSpeakerId | FK to Speaker entity (optional, unique when non-null). Set when user is linked to a speaker (automatic or manual). See Section 12.4. |
| LoginProvider / ProviderKey | The external OAuth provider (for example "Google") and its user key, or null for a local account |
| AvatarUrl | Public URL of the user's avatar photo (optional, BR-116a); personal data, nulled on erasure |
| PreferredCulture / PreferredTheme | The user's UI culture and light/dark theme preferences (optional; null follows the request default or the OS) |
| LockedOn | When an organizer locked the account out of sign-in, or null while it is usable (BR-264) |
| AcceptedTermsVersion / TermsAcceptedOn | The Terms of Service version last accepted (max 32 characters) and when; kept on erasure as consent evidence |
| FullName | Computed: "{FirstName} {LastName}". Read-only, no database column. |
| IsLocked / IsExternalLogin / HasLocalPassword | Computed flags: `LockedOn` is set; a `LoginProvider` is set; a password hash is present. No database columns. |
| DeviceId | Device identifier from MAUI clients (optional, string). Stored as metadata for analytics; not used for authentication. |
| DeviceFormFactor | Form factor (e.g., phone, tablet) (optional, MAUI only) |
| DevicePlatform | OS platform (e.g., iOS, Android) (optional, MAUI only) |
| DeviceModel | Device model name (optional, MAUI only) |
| DeviceManufacturer | Device manufacturer (optional, MAUI only) |
| DeviceName | User-facing device name (optional, MAUI only) |
| DeviceType | Device type classification (optional, MAUI only) |

Refresh tokens are not part of this aggregate: they are per-device rows in the `RefreshSessions` table, hashed at rest (BR-205, BR-206).

**Relationships:**
- Referenced by many **UserSessionBookmarks** and the other user-keyed Engagement rows (votes, questions, upvotes, check-ins, badge, points, leaderboard opt-in) by scalar UserId
- May be linked to one **Speaker** (via LinkedSpeakerId: 1:1, see Section 12.4)

**Lookup capabilities:** Users can be found by Email (unique lookup).

> **Why User has no owned children:** Attendee-generated content (bookmarks) lives in the Engagement context as standalone aggregate roots. They reference User but are not managed through the User aggregate.

---

### Cross-Cutting: Auditable Entities

Every entity in the system tracks:

| Attribute | Meaning |
|---|---|
| IsDeleted | Soft-delete flag; deleted records are hidden from normal queries |
| CreatedOn | Timestamp when the record was created |
| CreatedBy | User ID of the creator |
| LastModifiedOn | Timestamp of the last modification |
| LastModifiedBy | User ID of the last modifier |

**Event**, **Session**, **Speaker**, **User**, **CheckIn** and **PointsEntry** additionally record a per-change history (audited entities), because who changed a schedule entry, a profile, an account or an attendance or points row is a question that gets asked.

---

### Value Objects

| Value Object | Description | Invariants |
|---|---|---|
| **Email** | A validated email address. Used by `User.Email`, `Speaker.Email` and `Event.OrganizerContactEmail`. | Trimmed, normalized to lowercase, format-validated; a blank optional value is stored as absent |
| **UserRole** | The user's role: `Attendee`, `ContentEditor` or `Organizer`. Stored as a string. | Parsed case-insensitively; stored in canonical spelling; any other value is rejected |

`Event.StartDate`/`Event.EndDate` and `Activity.StartTime`/`Activity.EndTime` are plain value pairs with an end-not-before-start invariant (BR-13, BR-14) rather than a range value object.

---

## 3. Business Rules

### Explicit Rules

> **Reading guide:** Some rules reference other rules defined later in the document (e.g., BR-63, BR-80 are defined in Section 10). Forward references use the `BR-*` numbering consistently: search for the number to find the full definition.

> **Numbering convention:** Business rule numbers (BR-\*) are not sequential. Rules are numbered in the order they were identified during iterative specification development. Gaps (e.g., BR-23 through BR-40 do not exist) and out-of-sequence additions (e.g., BR-127 was added after BR-129) are intentional: renumbering would break cross-references throughout the document. Rules BR-200 to BR-219 are grouped in Section 12 (Authentication & Identity Architecture) and address the email-based identity model; BR-220 and above (live layer, visibility, sponsors, partners, check-in, points) are listed below.

| # | Rule |
|---|---|
| BR-1 | All entities use **soft delete**: records are never physically removed; the `IsDeleted` flag is set to true |
| BR-2 | A child entity must belong to its specified aggregate root; the parent ID in the child must match the aggregate root ID |
| BR-3 | The aggregate root must exist before a child entity can be added, updated, or deleted |
| BR-4 | When updating a child entity, the child must already exist in the aggregate's collection (matched by ID) |
| BR-5 | When deleting a child entity, the child must exist in the aggregate's collection |
| BR-6 | Sessionize data refresh requires a `SessionizeCode` on the event that is non-empty **and well-formed**: 1 to 64 characters drawn from letters, digits, hyphen and underscore (`SessionizeCodeFormat.Pattern`, `MaxLength` 64). The code is composed into the Sessionize request path, so a value outside that alphabet is rejected at validation rather than reaching the HTTP call. |
| BR-7 | Sessionize refresh is **idempotent**: existing entities (matched by ID) are updated, new ones are added, duplicates are skipped |
| BR-8 | Event question answers are **scoped to the authenticated user** for Attendees: attendees can only see their own answers. Organizers can read all answers for moderation purposes (BR-53, Section 11.9). Speakers can view feedback on their own sessions (BR-210). |
| BR-9 | Session question answers are **scoped to the authenticated user** for Attendees: attendees can only see their own answers. Organizers can read all answers (BR-53, Section 11.9). Speakers can view feedback on sessions they present (BR-210). |
| BR-10 | PUT requests require the route ID to match the entity ID in the request body |
| BR-11 | Pagination page size is capped at **500 items** maximum |
| BR-12 | JWT access tokens expire **15 minutes** after issuance (`Jwt:AccessTokenExpirationMinutes`) |
| BR-13 | `Event.EndDate` must be greater than or equal to `Event.StartDate` |
| BR-14 | `Activity.EndTime` must be greater than or equal to `Activity.StartTime` |
| BR-15 | `Question.QuestionEntity` is required and must be exactly `"Session"`, `"Event"`, or `"Speaker"` (**case-sensitive**: only the canonical casing is accepted, because consumers compare the stored value ordinally). Questions without a target entity type are rejected. Unrecognized values are rejected with HTTP 400. |
| BR-16 | Features requiring session time windows (session feedback submission) are unavailable when a session's `StartsAt` or `EndsAt` is null. The UI should hide time-gated actions for unscheduled sessions. All server-side time comparisons for time-gated features use the event's configured `TimeZone` (see Event entity). |
| BR-17 | Business rule violations are treated as client errors (HTTP 400) |
| BR-18 | Pagination metadata values (TotalItemCount, PageSize, CurrentPage) must be non-negative |
| BR-19 | CategoryItem `Name` is required and cannot be null |
| BR-20 | API rate limits run in two layers, and an excess request is answered **429**. At the edge, the Gateway applies a per-client-IP fixed window (`GatewayRateLimiting`, **120 requests per 60 seconds** by default) chained with a replica-wide concurrency ceiling. Behind it, every service applies an always-on limiter of **300 requests per minute**, partitioned by the authenticated user id (falling back to the client IP), with no queue (`RateLimiting:GlobalPermitLimit`). Anonymous authentication endpoints additionally use the `auth-ip` policy (**30 per minute per client IP** by default). These are the standing defaults; conference-day mode raises the edge and `auth-ip` limits for the duration of the event. |
| BR-21 | A user can bookmark a session only once: unique per (UserId, SessionId) |
| BR-22 | Bookmarking a session does not reserve a seat; it is informational only |
| BR-41 | Conference write endpoints require the matching `conference:*:manage` permission (ADR-020). `Organizer` holds every Conference permission; `ContentEditor` holds only the content-management set (sessions, speakers, categories, sponsors, partners, activities, session assets). Event, event lifecycle (publish, unpublish, Sessionize refresh), Room, Question, session-selection and speaker-link writes are therefore **Organizer** only. |
| BR-42 | Engagement write endpoints (bookmarks, feedback submission) require **authentication** but not the Organizer role: any authenticated user can perform these actions |
| BR-43 | Read endpoints for Conference entities (events, sessions, speakers, rooms, categories) are **publicly accessible** without authentication |
| BR-45 | New users default to the `Attendee` role (external sign-in accounts included). A role is changed by database seeding or by an organizer through user administration (`Admin/Users`, gated on `users:manage`, which only `Organizer` holds); a role change revokes the account's live refresh sessions (BR-264). |
| BR-48 | Sessionize refresh overwrites all **field values** on matched entities (matched by Sessionize ID). Manual edits made after the last sync are replaced on the next refresh: **Sessionize is the source of truth** for field content on imported entities. Sessionize does not control entity lifecycle: entities absent from a Sessionize response are not deleted (see BR-62). |
| BR-49 | `Session.Status` recognizes six Sessionize status values: **`Accepted`**: session is confirmed and appears on the public schedule; it is bookmarkable and eligible for feedback. **`Waitlisted`**: session is on the waitlist, pending a slot. **`Accept_Queue`**: session is queued for acceptance review. **`Nominated`**: session has been nominated for consideration. **`Decline_Queue`**: session is queued for decline review. **`Declined`**: session was rejected. Only **`Accepted`** sessions appear on the public schedule and are eligible for bookmarking and feedback. All other statuses (`Waitlisted`, `Accept_Queue`, `Nominated`, `Decline_Queue`, `Declined`) are excluded from public views (filtered from GET list responses for non-privileged readers) and cannot be bookmarked or receive feedback. Unknown values from Sessionize are stored as-is and treated as ineligible: they are excluded from public views and engagement actions. **Null status** (the default for manually created sessions) follows `Accepted` rules: the session is visible, bookmarkable, and eligible for feedback. **Eligibility is an allow-list, not a deny-list:** the test is "status is null or `Accepted`" (case-insensitive), so any value not on the list, including one Sessionize adds later, is ineligible by default. The allow-list gates the public list and by-id reads, the lookup and junction endpoints (BR-132), the calendar/ICS export, and the now-next view alike. |
| BR-50 | `Question.QuestionType` must be one of: `Rating`, `Text`, `Email` (**case-sensitive**: matching is ordinal, so only the canonical casing is accepted). These determine answer validation (BR-124) for all question answer types (EventQuestionAnswer, SessionQuestionAnswer, SpeakerQuestionAnswer). Unrecognized values are rejected. |
| BR-51 | The Organizer role grants read access to a paginated user list, filterable by Email, FirstName, LastName, and Role. The response includes UserId, Email, FirstName, LastName, Role, CreatedOn, LockedOn, and the account's count of active refresh sessions. Device-specific fields are excluded from the response to protect attendee device privacy. |
| BR-52 | Attendees can only update (`PUT`) or delete (`DELETE`) EventQuestionAnswer and SessionQuestionAnswer records where `CreatedBy` matches their authenticated user ID. Attempting to modify another user's answer returns HTTP 403. The `POST`-as-upsert endpoint (BR-107) always operates on the authenticated user's own answers: `CreatedBy` is set from the JWT, never from the request body. |
| BR-53 | Organizers can update (`PUT`) or delete (`DELETE`) any EventQuestionAnswer or SessionQuestionAnswer regardless of `CreatedBy`, enabling content moderation (e.g., removing inappropriate text responses). Organizer moderation uses `PUT`/`DELETE` by the answer's ID: the `POST`-as-upsert endpoint still keys on the organizer's own `CreatedBy`, so it cannot overwrite another user's answer via POST. |
| BR-55 | Soft-deleting a Session cascade soft-deletes all owned child entities (SessionSpeakers, SessionQuestionAnswers, SessionCategoryItems). |
| BR-56 | Soft-deleting a User soft-deletes the User record and raises the `UserDeleted` domain event. The account's refresh sessions are revoked (and the refresh flow re-reads the account through the soft-delete query filter in any case), and its already-issued access tokens are refused through the soft-deleted check (BR-133). Erasure also anonymizes the account in place (placeholder name and email, credentials, device fields, external-login link and avatar cleared; the accepted terms version is kept as consent evidence). The erasure is also published cross-service as the `UserDeleted` integration event, and each service that holds the account's data outside Identity erases it there. Conference anonymizes the email of every speaker profile linked to the account (`Speaker.Anonymize()`, BR-66) and then unlinks it (BR-207), and erases the account's feedback answers; Engagement takes the account off the leaderboard, deletes its bookmarks, live-poll votes, question upvotes and badge, erases its session questions, and records an `ErasedUser` tombstone so later Engagement writes from a still-valid token are refused. The points ledger is kept (it names nobody). See Event Handlers & Side Effects. |
| BR-58 | Engagement list endpoints support pagination (subject to the 500-item cap in BR-11) and filtering: bookmarks by `EventId` (derived via Session join) |
| BR-60 | Domain events are raised for entity mutations. Aggregate roots and child entities alike raise a single `*Changed` domain event carrying `DomainEntityState`: **Added** from the factory (and when a soft-deleted row is reactivated or restored), **Updated** on any mutation including state transitions, and **Deleted** on soft-delete. There are no separate `*Created` events. **Identity exception:** `User` raises `UserPasswordChanged` on a password change and `UserDeleted` on deletion, and nothing on creation: the cross-service `UserRegistered` event is an integration event published by the authentication service after the save, so subscribers receive the generated user id. A `CheckIn` raises the `AttendeeCheckedIn` integration event from its factory (BR-249). `SessionAiScore`, `AttendeeBadge` and `ErasedUser` raise none. Current domain events: **Aggregate root lifecycle:** `EventChanged`, `SessionChanged`, `SpeakerChanged`, `CategoryChanged`, `QuestionChanged`, `SponsorChanged`, `PartnerChanged`, `ActivityChanged`, `SessionAssetChanged`, `UserSessionBookmarkChanged`, `LivePollChanged`, `LivePollVoteChanged`, `SessionQuestionChanged`, `SessionQuestionUpvoteChanged`, `PointsEntryChanged`, `LeaderboardOptInChanged`, `UserPasswordChanged`, `UserDeleted`. **Child entity changes:** `RoomChanged`, `CategoryItemChanged`, `EventQuestionAnswerChanged`, `EventSpeakerChanged`, `SessionCategoryItemChanged`, `SessionQuestionAnswerChanged`, `SessionSpeakerChanged`, `SpeakerCategoryItemChanged`, `SpeakerQuestionAnswerChanged`. Not all events have registered handlers: events without handlers serve as extension points for future requirements. See Section 6 for handler details. |
| BR-86 | `Event.StartDate` and `Event.EndDate` form a date range (BR-13). An event may span one or more days. For single-day events, `StartDate` equals `EndDate`. Session `StartsAt`/`EndsAt` values should fall within the event's date range, but this is not enforced as a hard constraint: Sessionize-imported sessions may have slightly misaligned dates due to timezone handling. **Date comparison semantics:** The date portion of `Session.StartsAt` and `Session.EndsAt` (which are `DateTime` values in the event's local time zone) is compared against the event's `DateOnly` `StartDate`/`EndDate`. A session is considered outside the range if `StartsAt.Date < StartDate` or `EndsAt.Date > EndDate`. Sessions crossing midnight (ending after the event's `EndDate`) trigger the warning but are not rejected: this accommodates late-evening sessions. **Validation behavior:** When a session is created or updated with times outside the event's date range, the operation succeeds but the API response includes a warning header (`X-Warning: Session time falls outside the event's date range`). Sessionize imports log the same warning without blocking the import. |
| BR-87 | `Event.TimeZone` is a required IANA time zone identifier (e.g., "America/New_York", "Europe/London"). Session `StartsAt` and `EndsAt` values are stored as `DateTime` representing **local time in the event's time zone** (not UTC, not `DateTimeOffset`). The `TimeZone` value is validated against the IANA time zone database. See section 10.20 for full storage semantics. |
| BR-91 | `Session.IsServiceSession` defaults to false. Service sessions (`IsServiceSession = true`) are non-talk schedule entries (e.g., lunch break, registration, networking) that are displayed on the schedule but **cannot** be bookmarked or receive feedback. Attempts to create a `UserSessionBookmark` or `SessionQuestionAnswer` for a service session return HTTP 400 with detail "This action is not available for service sessions." Service sessions may still have rooms and time slots assigned. Sessionize imports set `IsServiceSession` based on the Sessionize `isServiceSession` flag. Note: keynotes are typically **not** service sessions: they are talks with speakers that attendees may want to bookmark and rate. |
| BR-93 | `Room.Capacity` is an optional positive integer. When present, it is displayed to attendees alongside room information. There is no system-enforced capacity limit. |
| BR-94 | `Room.Floor` and `Room.Location` are optional wayfinding fields displayed to attendees alongside session details. They have no behavioral significance: they are informational only. |
| BR-95 | `Question.IsRequired` defaults to false. When true, clients should prompt the user to answer this question before submitting. This is advisory: the server does not enforce required-question validation. |
| BR-98 | `Event.VenueAddress`, `Event.VenueMapUrl`, and `Event.WiFiInfo` are optional informational fields with no behavioral significance. They are included in event read responses. `VenueMapUrl` must be a valid absolute URL when provided. |
| BR-99 | Speaker social link fields (`TwitterHandle`, `LinkedInUrl`, `GitHubUrl`, `WebsiteUrl`) are imported from Sessionize during refresh (UC-6). Sessionize exports these as typed "links" (URLs) associated with speaker profiles. `TwitterHandle` stores the handle only: the import strips the `twitter.com` / `x.com` URL prefix, a leading "@" and trailing slashes. `LinkedInUrl`, `GitHubUrl`, and `WebsiteUrl` must be absolute http or https URLs when provided; on import, a link that is malformed or over its length cap is dropped with a refresh warning rather than failing the refresh. Social links are included in public speaker read responses. **Format rationale:** `TwitterHandle` stores the handle rather than a full URL because the platform URL has changed (twitter.com to x.com) and either form arrives from Sessionize. Storing the handle lets clients construct the correct URL. |
| BR-101 | **Data retention:** All data (active and soft-deleted) is retained indefinitely. Soft-deleted records remain in the database but are excluded from all queries. There is no automated purge or archival process. |
| BR-102 | Feedback for multi-speaker sessions is at the **session level**, not per-speaker. All speakers assigned to a session via `SessionSpeaker` share the same feedback data. Per-speaker feedback within a session is a potential future enhancement. |
| BR-107 | **Feedback submission:** Feedback (EventQuestionAnswer, SessionQuestionAnswer, or SpeakerQuestionAnswer) is submitted per-question via the entity's `POST` endpoint. Each answer is a `{ QuestionId, AnswerValue }` pair associated with the target entity and the authenticated user. `POST` performs an **upsert**: if no answer exists for the (CreatedBy, QuestionId, EntityId) combination, a new record is created; if one already exists, its `AnswerValue` is overwritten. Both outcomes answer HTTP 201 with the answer and its location (the controllers return `CreatedAtRoute` on either path). This is not standard create-only semantics: `POST` is explicitly an upsert to simplify the client (no need to check existence or switch between POST/PUT). `PUT` on an existing answer also updates it (standard update). A whole feedback form can also be submitted in one call (`POST .../batch` on the Event and Session answer endpoints): every answer is upserted under one transaction, so a refusal leaves nothing written. **Deferred capability:** SpeakerQuestionAnswer exists in the domain model only; no REST controller or attendee UI ships today (see Section 10.29), so only the Event and Session answer endpoints are live. |
| BR-108 | **Event visibility:** `Event.IsPublished` controls public visibility. Unpublished events (default) are visible **only to privileged readers** (`Organizer` or `ContentEditor`): public read endpoints (BR-43) exclude them. Published events (`IsPublished = true`) are visible to all users. Only organizers can change event visibility via `POST /Events/{id}/publish` and `POST /Events/{id}/unpublish`. These are action endpoints (state transitions), not resource replacements, so they use POST rather than PUT. No request body is required. |
| BR-111 | `Room.AccessibilityInfo` is an optional free-text field describing accessibility features (e.g., "Wheelchair accessible, hearing loop available"). Displayed to attendees alongside room information. Informational only: no behavioral significance. |
| BR-255 | **Room.Name must be unique within its parent Event** (case-insensitive, compared after trimming), among active (non-deleted) rooms. Enforced at the domain layer on add, rename, and Sessionize restore (duplicate attempts return the `Event.Room.Duplicate` error), and backstopped by a unique filtered database index on `(EventId, Name)` scoped to non-deleted rows. A soft-deleted room's name may be reused. The rule mirrors the BR-138 CategoryItem precedent. |
| BR-112 | `Session.AccessibilityInfo` is an optional free-text field describing accessibility accommodations (e.g., "Live captioning provided, sign language interpreter available"). Displayed to attendees alongside session details. Informational only. |
| BR-114 | `Session.Duration` is a **read-only computed value**: the whole minutes between `StartsAt` and `EndsAt` (e.g., `60`), null when either is null. It is persisted as a stored computed column (`DATEDIFF(minute, StartsAt, EndsAt)`), so the database keeps it true and it can be used for database-level sorting; the domain assigns the same value whenever the times change, so an unsaved session reports it too. Serialized in DTOs. |
| BR-116 | **Image hosting (ADR-045):** Speaker profile pictures (`ProfilePicture`) and venue maps (`VenueMapUrl`) are **externally hosted URLs** (speaker images imported from Sessionize). The only managed uploads are user avatars (BR-116a) and session materials (BR-116b). |
| BR-116a | **User avatar photos (added 2026-07-11, ADR-045):** an authenticated user may set ONE avatar photo on their own account via `POST /Users/me/avatar` (multipart, max 2 MB; jpeg/png/webp accepted by magic-byte sniffing) and remove it via `DELETE /Users/me/avatar` (idempotent). The server re-encodes every upload to a 256x256 JPEG (EXIF and all metadata stripped; the original is never stored) and stores it in the public-read `avatars` blob container under `{userId}-{random8}.jpg`; a replacement, a removal or an account erasure schedules the old blob's deletion on the durable internal-command queue (`Identity.DeleteAvatarBlob.v1`, ADR-114). `User.AvatarUrl` is PII: exported in the GDPR data export, nulled on anonymize with the blob deleted. |
| BR-116b | **Session materials (added 2026-09-12, ADR-123):** a session's own speakers (matched by the caller's `speaker_id` claim against the session's current speaker list) OR a caller holding `conference:session-assets:manage` (`Organizer`, `ContentEditor`) may publish materials against that session: `POST /SessionAssets/file` (multipart, **50 MB** maximum per file; `.pdf`, `.pptx`, `.docx`, `.xlsx`, `.zip`, `.txt`, `.md` accepted only when the real bytes and the file-name extension AGREE, the client-declared content type is ignored) and `POST /SessionAssets/link` (an absolute `http` or `https` URL), updated via `PUT /SessionAssets/{id}` (a conditional write: `If-Match` required, ADR-035, as on every other Conference write controller) and removed via `DELETE /SessionAssets/{id}`. At most **10 live assets per session**. `GET /SessionAssets?sessionId={id}` is anonymous and output-cached: it applies the same public-session projection as the agenda (BR-49 plus the BR-108 published-event rule) and returns an **empty list, not 404**, for a session the caller cannot see, so a guessed id cannot confirm that an unannounced talk has materials. Uploaded files are stored in the public-read `session-assets` blob container under `{eventId}/{sessionId}/{assetId}/{sanitized-file-name}` where `assetId` is a server-minted GUID (the URL is therefore unguessable), and are served with a stored `Content-Disposition` (`inline` for PDF, `attachment` for every other format) and an immutable `Cache-Control`; downloads go directly to blob storage, never through the API. Deleting an asset, its session (BR-55) or its event (BR-127) soft-deletes the row and schedules the blob for removal on the durable internal-command queue (`Conference.DeleteSessionAssetBlob.v1`, ADR-114). Materials are visible as soon as the session itself is publicly visible: there is no embargo and no separate publish step. |
| BR-120 | **Organizer action traceability:** Sensitive organizer actions (session status changes, event status changes, Sessionize refresh) are traceable via the auditable fields (`CreatedBy`, `CreatedOn`, `LastModifiedBy`, `LastModifiedOn`) on affected entities. Sessionize refresh timing is tracked via `Event.LastSessionizeRefreshOn` and `Event.LastSessionizeRefreshBy`. |
| BR-121 | **Sponsor, exhibitor and partner support** is in scope: organizers manage sponsors and exhibitors grouped by tier (BR-240 to BR-243) and community and special partners (BR-256 to BR-260), each published with its parent event. Sponsorship sales, invoicing and lead retrieval are not modelled. |
| BR-122 | **Session duration validation:** When a Session's `StartsAt` and `EndsAt` are both non-null, `EndsAt` must be **strictly greater than** `StartsAt` (not equal). A zero-duration session is invalid. **Two-tier enforcement:** (1) **API create/update**: enforced as a hard constraint; requests with `EndsAt <= StartsAt` are rejected with HTTP 400 (`Session.Duration.Invalid`). (2) **Sessionize import**: validation is relaxed; sessions violating this constraint are stored as-is but flagged with a warning in the import response (import is not blocked: the organizer can correct the times manually). This two-tier approach exists because Sessionize is the source of truth and its data cannot be rejected without breaking the sync. |
| BR-123 | **Feedback answer uniqueness:** `EventQuestionAnswer` is unique per `(CreatedBy, QuestionId, EventId)`, an attendee can submit only one answer per question per event. `SessionQuestionAnswer` is unique per `(CreatedBy, QuestionId, SessionId)`. `SpeakerQuestionAnswer` is unique per `(CreatedBy, QuestionId, SpeakerId)`. If an attendee submits an answer when one already exists for that combination, the existing answer's `AnswerValue` is **overwritten**. |
| BR-124 | **Feedback answer validation:** `AnswerValue` validation depends on the associated Question's `QuestionType`: **Rating**: must be a numeric integer between 1 and 5 inclusive (1=Poor, 2=Below Average, 3=Average, 4=Good, 5=Excellent); non-numeric values or values outside this range are rejected (HTTP 400). **Text**: free-text with a maximum length of 2000 characters. **Email**: must parse as a .NET `MailAddress`; invalid format is rejected (HTTP 400). Every answer is also non-empty and at most 4000 characters regardless of type. The Rating scale labels are a client-side display concern: the API validates only the 1-5 integer range. |
| BR-127 | **Cascade soft-delete on Event deletion:** When an Event is soft-deleted, the cascade soft-deletes, in order: every **Session** belonging to the Event (each cascading to its own children per BR-55), every **Sponsor** (BR-240), every **Partner** (BR-256), every **Activity**, and every **SessionAsset** of the event (BR-116b; each asset's blob is then removed by a scheduled delete command), and finally the **Event** itself with its owned children (BR-72). Sponsors, partners, activities and session assets are their own aggregates rooted on the event, so the cascade reaches them explicitly rather than leaving orphan rows the public pages still read. The cascade short-circuits: the first child that refuses to delete aborts the operation, the event is left untouched, and nothing is persisted. See BR-72 (Section 10.8) for the event's owned children. |
| BR-128 | **Cross-entity foreign key validation:** When creating or updating an `EventQuestionAnswer`, the system validates that the referenced `QuestionId` exists and that the Question's `QuestionEntity` equals `"Event"`. When creating or updating a `SessionQuestionAnswer`, the system validates that `QuestionEntity` equals `"Session"` and that the question is attendee feedback (`QuestionSource` `"User"`): a Sessionize-sourced question is call-for-papers data the refresh owns. When creating or updating a `SpeakerQuestionAnswer`, the system validates that `QuestionEntity` equals `"Speaker"`. Submitting an answer that references a non-existent Question or a Question targeting the wrong entity type returns HTTP 400 (`Question.NotFoundOrWrongEntity`) with detail "Question not found or does not apply to this entity type." |
| BR-129 | **Concurrency model:** Guarded Conference writes use **optimistic concurrency at the API edge**: ten write controllers carry `[SupportsIfMatch]` (Events, event lifecycle transitions, Sessions, Speakers, Sponsors, Partners, Activities, Questions, ConferenceCategories, SessionAssets), so those requests must state the entity's current row-version token in the HTTP `If-Match` header (ADR-035). The header is mandatory on a guarded write: a request that states no precondition (an absent, empty or `*` header) is refused with **428 Precondition Required** and the action never runs, a tag the server cannot decode is **400**, and a stale token is answered with **412 Precondition Failed** rather than 409. Everything not covered by those endpoints stays **last-write-wins**: concurrent updates overwrite each other without conflict detection, which is acceptable because (1) Conference data is managed by a small number of organizers with low write frequency, (2) Sessionize refresh is the primary write path and is throttled per-event (BR-63), (3) Engagement writes (bookmarks, feedback) target distinct rows per user. **Sessionize refresh concurrency:** A Sessionize refresh writes many entities in a single transaction. If an organizer edits an entity while a refresh is in progress, last-write-wins applies: whichever transaction commits last determines the final state. The per-event throttle (BR-63) reduces but does not eliminate this window. Organizers should avoid manual edits immediately after triggering a refresh. |
| BR-130 | **Session.RoomId cross-event validation:** When a Session's `RoomId` is set (non-null), the referenced Room must belong to the same Event as the Session (`Room.EventId == Session.EventId`). Assigning a Room from a different Event (or a deleted room) is rejected with HTTP 400 (`Session.RoomId.CrossEvent`). This is enforced at the service layer during create and update. **Double-booking guard:** when the session also has both times set, a room already holding another session whose window overlaps (`StartsAt < other.EndsAt` and `EndsAt > other.StartsAt`) is rejected with HTTP 409 (`Session.Room.DoubleBooked`). It is a soft guard: the probe and the write are not one atomic step, so two concurrent organizer writes can both pass it. Sessionize imports always assign rooms within the correct event scope. |
| BR-131 | **Time zone change impact:** Changing `Event.TimeZone` on an event that already has sessions does **not** adjust stored `Session.StartsAt`/`Session.EndsAt` values: those values represent local time in the *original* time zone and become semantically incorrect under the new time zone. Organizers should only change `TimeZone` before sessions are scheduled, or trigger a Sessionize refresh (UC-6) afterward to re-import session times in the correct time zone. When an event already has sessions, changing `TimeZone` succeeds but the API response includes a warning header (`X-Warning: Event time zone changed; existing session times may be semantically incorrect. Consider triggering a Sessionize refresh.`). This is consistent with the date range warning behavior in BR-86. |
| BR-132 | **Session visibility inherits event visibility:** Sessions belonging to unpublished events are excluded from public list/lookup responses and single-entity GET responses for non-privileged readers. Privileged readers (`Organizer` or `ContentEditor`) can see all sessions regardless of event visibility. This ensures consistency with the Event Lifecycle (Section 5) which states that unpublished events and their sessions are visible only to privileged readers. Non-accepted sessions (BR-49: any status other than `Accepted` or null) are also excluded from public responses. **The junction read endpoints follow their parent entity's visibility**: `SessionSpeakers`, `EventSpeakers`, `SessionCategoryItems`, and `SpeakerCategoryItems` list/paged/by-id reads, and every `/lookup` endpoint, apply the same filter as the parent Session, Event, or Speaker read (`EventSpeakers` additionally requires the speaker to be publicly visible per BR-239, so the junction cannot leak the imported roster). They are not an unfiltered side channel around BR-49, BR-108, or BR-239. |
| BR-133 | **Soft-deleted user JWT validation:** Middleware must validate that the authenticated user's account has not been soft-deleted on every authenticated request. If `User.IsDeleted = true` for the `user_id` in the JWT, the request is rejected with HTTP 401. This is necessary because JWTs are stateless and remain valid until expiry (BR-12): a soft-deleted user's token would otherwise grant access for up to the access-token lifetime (15 minutes, BR-12) after deletion. The middleware check adds one database lookup per authenticated request, which can be mitigated with short-lived caching (e.g., 30-second cache of deleted user IDs). |
| BR-134 | **Publish validation:** Publishing an event (`POST /Events/{id}/publish`) has **no minimum data requirements**: an event can be published with zero sessions, zero speakers, and zero rooms. This is a deliberate decision: organizers may want to publish an event early (for visibility) and populate the schedule later. Validation of schedule completeness is an organizer responsibility, not a system constraint. |
| | |
| **Conference-day live layer (ADR-039)** | |
| BR-220 | **Poll authoring shape:** a poll carries a question of 1-200 characters and between **2 and 10** options, each 1-100 characters, and option texts must be unique within the poll. Options are authored with the poll, not added later. |
| BR-221 | **Poll lifecycle is strictly Draft to Open to Closed.** Only a Draft poll can be opened, only an Open poll can be closed, and **there is no reopen**. |
| BR-222 | **Polls can only be created for a published event.** The target event must exist and have `IsPublished = true`. |
| BR-223 | **Polls can only be opened while the event is live:** the current instant must fall inside the event's live window. Opening snapshots the window's exclusive end onto the poll. |
| BR-224 | **Votes are accepted only while the poll is Open and the event is still live**, checked against the window end snapshotted at open time (BR-223) rather than by re-reading Conference data per vote. |
| BR-225 | **One active vote per (poll, user)**, enforced by a filtered unique index. Re-voting while the poll is open updates the existing row rather than inserting a second one; a soft-deleted vote is reactivated rather than duplicated. |
| BR-226 | **A vote's option must belong to that poll and must not be deleted.** |
| BR-228 | **An Open poll cannot be deleted.** It must be closed first, so a delete cannot silently end a running vote. Deleting a poll cascade soft-deletes its options. |
| BR-229 | **Live-channel broadcasts are best-effort and post-commit.** Handlers enqueue a broadcast on a bounded in-process queue after their transaction commits; a dropped or failed broadcast never fails the originating write. Clients recover the true state on their next read. |
| BR-230 | **A poll is either session-scoped or event-wide.** A null `SessionId` means event-wide; the "open polls" attendee view returns event-wide polls only. |
| BR-231 | **Question text is 1-500 characters.** A user may have at most **10 open (non-dismissed) questions per session** at a time. |
| BR-233 | **A submitted question starts at the event's moderation default** (`Event.QuestionModerationDefault`, Pending or Approved), so an event can run pre-moderated or open. |
| BR-234 | **Moderation transitions:** Approve from Pending or Dismissed; Dismiss from Pending or Approved; re-applying the current status fails. A question can be marked **answered only while Approved, and only once**. |
| BR-235 | **One active upvote per (question, user)**, enforced by a filtered unique index. Un-upvoting soft-deletes the row and re-upvoting reactivates it. |
| BR-236 | **Live-layer authoring rights:** organizers (`engagement:live:manage`, held only by `Organizer`) manage everything; a speaker manages only content scoped to a session they are assigned to. Event-wide scope is organizer only. **Audience read scope (separate from authoring):** a live poll's question and results are readable by an attendee only once the poll has reached **Open or Closed** on a **published** event or session; a `Draft` poll is visible only through the organizer manage surface, since it carries staged, unannounced content. The caller identity is bound from the token at the API edge, **never from the request body**, and the server re-checks on every call, so the client-side gate is convenience rather than security. |
| BR-237 | **Upvotes are accepted only while the question is Approved and the event is still live**, checked against the window end snapshotted at submission time. |
| BR-238 | **Questions display anonymously.** The submitting `UserId` is never exposed on a DTO, and upvote broadcasts carry only the fresh count, never who voted. |
| | |
| **Public visibility (companion to BR-49 / BR-108)** | |
| BR-239 | **Speaker visibility:** a speaker is publicly visible only if the speaker has **at least one visible session** (a session eligible under BR-49) **in the scoped event set**: the selected event on event-scoped reads (paged list with an event filter; an unpublished scoped event yields an empty set), and all Published events on reads without event context (unscoped list, lookup, by-id, junction filters). An `EventSpeaker` row grants **no** visibility: the Sessionize sync creates one for every imported speaker, so the row carries no acceptance signal. Speakers with no qualifying session are excluded from public list, paged, lookup, and junction responses, and a GET by id returns **HTTP 404** for non-privileged callers rather than leaking existence, with one carve-out: a caller whose `speaker_id` claim matches the requested id can always read their own profile (mirror of the BR-214 self-or-organizer rule; the self-edit form cannot load without it), and that self-read response is never stored into the shared output cache. Privileged readers (`Organizer` or `ContentEditor`) see every speaker. The rule is evaluated as an id-list specification, so a hidden speaker cannot be reached through any other read path. |
| | |
| **Sponsors (Conference context)** | |
| BR-240 | **Sponsor authoring shape:** a sponsor carries a required `Name` (max 200 characters) and a required `Tier`, plus optional `LogoUrl`, `Description` and `WebsiteUrl` (max 2000 each), `LinkedInUrl` (max 2000), `TwitterHandle` (max 100), `BoothNumber` (max 50), a `Sort` order (must be >= 0) and the exhibitor flag `IsExhibitor`. A `BoothNumber` is accepted even when `IsExhibitor` is false: the two fields are recorded independently rather than cross-validated. Every sponsor belongs to exactly one **Event** (`EventId` required), and the owning event is **immutable after creation**: `Update` does not accept an `EventId`, so moving a sponsor between events means deleting and re-creating it (the BR-140 pattern for sessions). |
| BR-241 | **Sponsor tiers are Platinum, Gold, Silver and Community**, and the tier's stored order *is* its display order (Platinum first). The public page groups sponsors by tier ascending, then orders within a tier by `Sort` ascending and `Name`, so an organizer controls placement inside a tier without renaming anything. |
| BR-242 | **Sponsor visibility inherits event visibility.** For non-privileged callers, sponsor reads are restricted to sponsors whose parent Event has `IsPublished = true`, evaluated as an id-list specification over the published event set (the BR-239 shape). Scoping a public read to an unpublished event therefore yields an empty page, and a GET by id for a sponsor of an unpublished event returns **HTTP 404** rather than a redacted record. Privileged readers (`Organizer` or `ContentEditor`) see every sponsor. Sponsor reads are otherwise anonymous and output-cached. |
| BR-243 | **Sponsor writes require the `conference:sponsors:manage` permission** (ADR-020), which is part of both the full Conference permission set and the ContentManagement set: `Organizer` holds it through the former and `ContentEditor` through the latter. Reads are `[AllowAnonymous]`. There is **no feature flag** for sponsors: publication of the parent event and this permission are the only gates. |
| **Partners (Conference context)** | |
| BR-256 | **Partner authoring shape:** a partner carries a required `Name` (max 200 characters) and a required `PartnerType`, plus optional `LogoUrl`, `Description` and `WebsiteUrl` (max 2000 each) and a `Sort` order (must be >= 0). `LogoUrl` and `WebsiteUrl`, when supplied, must be **absolute `http` or `https` URLs**, because the Home page renders them directly as an image source and a link target; an empty value passes. Every partner belongs to exactly one **Event** (`EventId` required), and the owning event is **immutable after creation**: `Update` does not accept an `EventId`, so moving a partner between events means deleting and re-creating it (the BR-240 pattern for sponsors). Partners carry no tier, booth or social fields: a partner supports the event without buying a sponsorship package. |
| BR-257 | **Partner types are Community and Special**, and the type's stored order *is* its display order (Community first, then Special, for example the venue host). `Community` is the zero value, so an omitted type lands on the non-commercial common case. Partners are grouped by type ascending, then ordered within a type by `Sort` ascending and `Name`, so an organizer controls placement inside a group without renaming anything. |
| BR-258 | **Partner visibility inherits event visibility.** For non-privileged callers, partner reads are restricted to partners whose parent Event has `IsPublished = true` (BR-108), evaluated as an id-list specification over the published event set (the BR-242 shape for sponsors). Scoping a public read to an unpublished event therefore yields an empty page, and a GET by id for a partner of an unpublished event returns **HTTP 404** rather than a redacted record. Privileged readers (`Organizer` or `ContentEditor`) see every partner. Partner reads are otherwise anonymous and output-cached. |
| BR-259 | **Partner writes require the `conference:partners:manage` permission** (ADR-020), which is part of both the full Conference permission set and the ContentManagement set: `Organizer` holds it through the former and `ContentEditor` through the latter. Reads are `[AllowAnonymous]`. There is **no feature flag** for partners: publication of the parent event and this permission are the only gates. |
| BR-260 | **The Home page partners band shows only announced partners of the featured event.** The band reads the same anonymous, published-event-scoped list (BR-258), keeps the partners of the featured event, and renders one group per type in BR-257 order. A group with no partners is hidden, and the whole band (heading included) is hidden when both groups are empty or the read fails, so the static prerender and an API outage leave no empty heading behind. Each partner shows its logo (or its name when no logo is set), linked to `WebsiteUrl` in a new tab when one is set. |
| | |
| **Badge check-in (Engagement context)** | |
| BR-244 | **An attendee badge is one opaque credential per user.** The badge holds a single random `Guid` (unique per user, unique across badges), minted on the attendee's first visit to `/my-badge` and never derived from the user id. It encodes as `mmca-adc:badge:{credential}` in the QR, and the reader accepts either the prefixed form or a bare GUID (case-insensitive prefix, `Guid.Empty` rejected) so a code can also be typed in by hand. Regenerating a badge issues a new credential and thereby revokes every previously printed or screenshotted copy. |
| BR-245 | **Badge check-in is organizer-scans-attendee, never the reverse.** The attendee's `/my-badge` page only displays; the scanning page is Organizer-gated, with a manual check-in (attendee found by name search) as the fallback for a dead phone or a device with no camera. Every check-in records both parties (`UserId` and `CheckedInByUserId`) plus the instant; the only self-recorded check-ins are sponsor visits and room check-ins (BR-261, BR-262), where `CheckedInByUserId` equals `UserId`. A check-in carries a **scope**, `Event`, `Session` or `Sponsor`: `EventId` is always recorded, `SessionId` only for session scope and `SponsorId` only for sponsor scope. Every check-in path requires the owning event to be published (`CheckIns.EventNotPublished`). |
| BR-246 | **A repeat scan is idempotent, not an error.** A second scan of the same attendee for the same subject returns the existing check-in with an "already checked in" outcome (HTTP 200) and writes nothing, so no second integration event is published. Three filtered unique indexes are the concurrency backstop: (UserId, EventId) for event scope, (UserId, SessionId) for session scope and (UserId, SponsorId) for sponsor scope, each excluding soft-deleted rows. |
| BR-247 | **Organizer check-in writes (scan and manual) and the attendance rollup require the `engagement:checkin:manage` permission** (held by `Organizer`), and the whole check-in surface sits behind the `Engagement.CheckIn` feature flag: with the flag off the controller returns 404 (ADR-031). Reading one's own badge, recording a sponsor visit and checking in from a room QR need authentication only, not the permission; the last two also sit behind their own `Engagement.SponsorVisits` and `Engagement.RoomCheckIn` flags. |
| BR-248 | **Door and arrival check-in are out of scope: TicketLeap owns them.** ADC runs registration and admission through TicketLeap, which already scans attendees in at the door, so ADC's check-in exists for **session attendance**, the thing the ticketing product cannot report. Event scope is modelled and available (it costs nothing beyond the enum), but ADC does not claim to be the system of record for who entered the building. |
| BR-249 | **A check-in publishes `AttendeeCheckedIn` through the outbox.** The event is raised inside the aggregate factory, so it is captured in the same transaction as the row (ADR-003) and delivered at least once. It carries the user, the scope **as a string** (so a new scope stays additive), the event, the optional session, the scanning organizer and the instant. Consumers must be idempotent; the points consumer is, by BR-250. |
| | |
| **Points and leaderboard (Engagement context)** | |
| BR-250 | **The points ledger is append-only and awards once per subject.** A points entry records the user, the activity type, the points awarded, a `SubjectKey` (max 64 characters, `event:{id}`, `session:{id}` or `sponsor:{id}`) and the instant, and has no mutators: a correction is a new entry, never an edit. A unique index on (UserId, ActivityType, SubjectKey) is both the redelivery-idempotency guard for at-least-once events and the anti-farming rule: **the same activity on the same subject can only ever be awarded once**. Asking five questions in one session therefore earns the question award once, and a duplicate award attempt succeeds as a no-op rather than failing. |
| BR-251 | **Award values are configuration, and 0 disables a rule.** The `Points` configuration section carries one value per activity (see Section 10.30 for the shipped rules and values) plus the leaderboard size. An activity configured at 0, or missing from configuration entirely, awards nothing and writes no entry, so a rule can be switched off without a deploy. The awarded value is **snapshotted onto the entry**, so changing a rule never restates earlier awards. |
| BR-252 | **Points are awarded from events that already exist, not from a second write path.** Check-in and sponsor-visit awards come from `AttendeeCheckedIn` (BR-249), by scope. A session check-in earns nothing when the attendee already holds an earlier check-in (by committed `CheckedInOn`, then id) for a different session of the same event whose scheduled window overlaps it: session points are awarded **once per time slot**, while every check-in row is still written. Feedback awards come from the new `SessionFeedbackSubmitted` and `EventFeedbackSubmitted` integration events, which are raised on the **answer-create path only** and never on the BR-107 upsert-update path: one feedback form produces one event per answer row, and the shared subject key collapses them to a single award. The question award rides the in-module session-question domain event, filtered to creation and keyed by **session** rather than by question. That last path is deliberately **at-most-once**: it is dispatched in-process after commit, so a crash in that window loses one award, accepted as cheaper than an outbox row per question. |
| BR-253 | **The leaderboard is opt-in, and opting in publishes a display name.** A user appears on the leaderboard only while an active opt-in row exists; opting out soft-deletes it and rejoining reactivates the same row (the BR-135 pattern). The display name is a **snapshot taken at opt-in** and resolved server-side from the caller's token claims, never accepted from the request body (which carries only the participate flag), so the board never reads back into Identity. The board totals only opted-in users' entries, orders by total then display name, is capped at the configured leaderboard size, and assigns distinct sequential ranks. The whole points surface sits behind the `Engagement.Points` feature flag. |
| BR-254 | **Points data is part of the GDPR export.** A user's engagement export includes every points entry (activity type, points, subject key, timestamp) plus the leaderboard opt-in state and the published display name, alongside the existing bookmark and question data (ADR-005). |
| BR-261 | **Sponsor booth visits are self-recorded and capped at one per sponsor.** An authenticated attendee scans a sponsor's printed deep-link QR and `POST /CheckIns/sponsor-visits` records a `Sponsor`-scope check-in for the caller (taken from the token, never the request; no organizer permission). The sponsor's event must be published. A repeat visit answers 200 with an "already visited" outcome and writes nothing; the (UserId, SponsorId) filtered unique index caps it at one row, and therefore one `SponsorVisit` award (default 20 points, 0 disables it), per attendee per sponsor. The deep link is shareable by design and no live window is enforced: publication, the once-per-sponsor cap, the low award and the `Engagement.SponsorVisits` kill switch are the gates. |
| BR-262 | **Room check-in resolves the session on the server.** An authenticated attendee scans a room's printed QR and `POST /CheckIns/room-visits` sends only the room; the server picks the session that room is hosting at the request instant (within the configured grace window) and records an ordinary `Session`-scope check-in for the caller, or answers 404 `CheckIns.NoCurrentSession` when nothing is running there. The event must be published. A repeat, including one after an organizer scan, answers 200 "already checked in". An attendee already checked in to an overlapping session elsewhere is still checked in, with the response reporting that it earns no points (BR-252); when session points are configured to 0 the check-in is still recorded and the response reports points as paused. Behind the `Engagement.RoomCheckIn` flag. |
| BR-263 | **`Event.SessionizeCode` is unique across events when set**, enforced by a unique index filtered to non-null codes: the code is the event's Sessionize identity, and the index is what lets concurrent replicas seed the same event without creating a duplicate. |
| BR-264 | **An organizer can lock an account and change its role** (ADR-116). User administration (`Admin/Users`, permission `users:manage`, which only `Organizer` holds) locks and unlocks an account through `POST /Admin/Users/{userId}/lock` and `/unlock`, which set or clear `User.LockedOn`; a locked account keeps every row it owns and can be unlocked, unlike erasure (BR-56). A locked account is refused at password login (only after the password is proven) and at token refresh with HTTP 401 `Auth.AccountLocked`; at external sign-in the OAuth completion instead redirects back to the login page carrying `error=Auth.AccountLocked`. A role change (`PUT /Admin/Users/{userId}/roles`) must name exactly one of `Attendee`, `Organizer` or `ContentEditor`, because an ADC account holds exactly one role (otherwise 400 `User.Role.ExactlyOne`). Both locking and a real role change revoke the account's live refresh sessions, so the change takes effect within one access-token lifetime (BR-12). Both operations are idempotent: a repeated lock keeps the original `LockedOn` instant, and re-applying the current role writes nothing. |
| BR-265 | **Activity writes need `conference:activities:manage`** (held by `Organizer` and `ContentEditor`); reads are anonymous and, for non-privileged callers, limited to activities of published events. An activity's name is required and its end time must be on or after its start time (`Activity.TimeRange.Invalid`). |

### Inferred Rules

| # | Rule | Reasoning |
|---|---|---|
| ~~IR-1~~ | ~~A user is uniquely identified by their email address~~: **Promoted to explicit rule BR-200/BR-201.** See Section 12.1. | Now explicitly defined in authentication architecture |
| IR-2 | An EventSpeaker association is unique per (EventId, SpeakerId) pair | Enforced by a domain duplicate check (`Event.Speaker.Duplicate`) and a filtered unique index among active rows |
| IR-3 | A SpeakerCategoryItem is unique per (SpeakerId, CategoryItemId) pair | Enforced by a domain duplicate check (`Speaker.CategoryItem.Duplicate`) and a filtered unique index among active rows |
| IR-4 | Each question belongs to Events, Sessions or Speakers (determined by `QuestionEntity` field) | Questions are categorized by their target entity type (BR-15) |
| IR-5 | Categories are global (not event-scoped): **multi-event risk:** see Category entity note and BR-74 | Categories have no EventId; they are shared across events. Safe when all events share one Sessionize source; risky with independent Sessionize sources per event. |
| IR-6 | A SessionSpeaker association is unique per (SessionId, SpeakerId) pair: a speaker can only be linked to the same session once | Duplicates would be meaningless; prevented by a domain duplicate check on every add path (Sessionize import and manual assignment) and a filtered unique index among active rows |
| IR-7 | A SessionCategoryItem association is unique per (SessionId, CategoryItemId) pair: a session can only be tagged with the same category item once | Duplicates would be meaningless; prevented by a domain duplicate check on every add path (Sessionize import and manual assignment) and a filtered unique index among active rows |

---

## 4. Use Cases / Business Processes

### UC-1: User Registration & Login

See **UC-30** (Registration) and **UC-31** (Login) in Section 12.2 for the current email + password authentication flows. **UC-34** (Request password reset) and **UC-35** (Reset password) in the same section cover the self-service recovery path.

---

### UC-2: Browse Events

**Actors:** Attendee, API consumer
**Preconditions:** None (read endpoints do not require auth)

**Main Flow:**
1. Consumer requests list of events (`GET /Events`, or `GET /Events/paged` with optional pagination, filtering, sorting)
2. System returns only published events for unauthenticated/attendee users (BR-108). Privileged readers (`Organizer` or `ContentEditor`) also see unpublished events.
3. Response includes child data if requested (rooms, event speakers, event question answers)

**Alternate Flows:**
- Request a single event by ID (`GET /Events/{id}`); an unpublished event is a 404 for a non-privileged reader (BR-108)
- Request events in lookup format (Id + Name pairs) for dropdown population (`GET /Events/lookup?nameProperty=Name`): see section 11.7 for the lookup endpoint contract
- Request with `includeChildren=true` to get nested child entities (one level only, per BR-80)
- Filter by `IsPublished` to find published events
- Download a published event's full schedule as an iCalendar file (`GET /Events/{id}/ics`, `text/calendar`, named `event-{id}.ics`)
- Read the "happening now / up next" snapshot for one event (`GET /Events/{id}/now-next`) or for the current event, live now or else next upcoming (`GET /Events/now-next`)
- Privileged readers (`Organizer`, `ContentEditor`) export the event table as CSV (`GET /Events/export`); any other caller gets HTTP 403

**Business Rules:** BR-43, BR-108

---

### UC-3: Browse Sessions

**Actors:** Attendee
**Preconditions:** Events exist in the system

**Main Flow:**
1. Consumer requests sessions (`GET /Sessions`, or `GET /Sessions/paged` with optional filtering/sorting); the default order is `StartsAt` ascending
2. Sessions can be filtered and sorted by their own fields (for example `EventId` or `Status`); `RoomName` maps to the joined room's name, and the paged list also accepts a virtual `SpeakerId` filter key that selects the sessions a speaker presents
3. System returns sessions with optional children (speakers, category items, question answers), restricted for non-privileged readers to sessions with a BR-49-eligible status on a published event (BR-132); the speaker children are further restricted by BR-239

**Alternate Flows:**
- A session outside the public projection is a 404 on `GET /Sessions/{id}` for a non-privileged reader (BR-132)
- Download one session as an iCalendar file (`GET /Sessions/{id}/ics`)
- Read a session's published materials (`GET /SessionAssets?sessionId={id}`, see UC-39)

**Business Rules:** BR-43, BR-49, BR-132, BR-239

---

### UC-4: Submit Event Feedback

**Actors:** Authenticated attendee
**Preconditions:** User is authenticated; Event exists and is Published (BR-108); Questions exist for `QuestionEntity = "Event"`

**Main Flow:**
1. Attendee opens the event feedback page (`/feedback/event/{eventId}`), which loads the caller's own answers for that event (`GET /EventQuestionAnswers/mine?eventId={eventId}`)
2. Attendee submits feedback per-question via `POST /EventQuestionAnswers` (BR-107), or the whole form in one call via `POST /EventQuestionAnswers/batch`, which applies every answer in one transaction so a refusal leaves nothing written
3. System validates that the question exists and targets events (BR-128) and validates each `AnswerValue` against the question's `QuestionType` (BR-124)
4. Each answer is associated with the event and question, with `CreatedBy` set to the current user ID
5. If the user has previously submitted an answer for the same (QuestionId, EventId), the existing answer is overwritten (BR-123)

**Business Rule:** Users can only view their own event feedback (BR-8). BR-107 (per-question submission).

---

### UC-5: Submit Session Feedback

**Actors:** Authenticated attendee
**Preconditions:** User is authenticated; Session and Questions exist; Session is not a service session (BR-91); Session status is Accepted or null (BR-49); Session has both `StartsAt` and `EndsAt` (BR-16); Session's parent Event is Published (BR-108)

**Main Flow:**
1. Attendee opens the session feedback page (`/feedback/session/{sessionId}`), which loads the caller's own answers for that session (`GET /SessionQuestionAnswers/mine?sessionId={sessionId}`)
2. Attendee submits feedback per-question via `POST /SessionQuestionAnswers` (BR-107), or the whole form in one call via `POST /SessionQuestionAnswers/batch`, applied in one transaction
3. System validates that the session is not a service session (BR-91), has an eligible status: Accepted or null (BR-49), is scheduled (BR-16), and belongs to a published event (BR-108)
4. System validates that the question exists, targets sessions and is an attendee-feedback question (BR-128), and validates each `AnswerValue` against the question's `QuestionType` (BR-124)
5. Each answer is associated with the session and question, with `CreatedBy` set to the current user ID
6. If the user has previously submitted an answer for the same (QuestionId, SessionId), the existing answer is overwritten (BR-123)

**Business Rule:** Users can only view their own session feedback (BR-9). BR-107 (per-question submission).

---

### UC-6: Refresh Event Data from Sessionize

**Actors:** Organizer (via API call)
**Preconditions:** Event exists with a valid `SessionizeCode`; user holds the `conference:events:manage` permission (Organizer, BR-41); the `Conference.SessionizeIntegration` feature is enabled

**Main Flow:**
1. Organizer triggers refresh for a specific event (`POST /Events/{id}/refresh`). This is a POST because it mutates server state (upserts entities); GET is not appropriate for write operations.
2. System retrieves the event and verifies it has a `SessionizeCode` (BR-6)
3. System checks the per-event throttle (BR-63): if a refresh occurred within the last 5 minutes, returns HTTP 429 with a `Retry-After: 300` header
4. System stamps `Event.LastSessionizeRefreshOn` and `Event.LastSessionizeRefreshBy` and commits that stamp **before** calling Sessionize, so the event row is the claim: a concurrent refresh of the same event loses on the row version and is answered 429 as well
5. System calls the Sessionize "View All" API endpoint
6. System synchronizes data in order, inside one transaction:
   a. **Categories and CategoryItems**: upsert (add if new, update if existing)
   b. **Rooms**: upsert
   c. **Questions**: upsert questions from Sessionize with `QuestionSource = "Sessionize"` (question definitions with text, type, and entity target)
   d. **Speakers**: upsert speakers (including social links: TwitterHandle, LinkedInUrl, GitHubUrl, WebsiteUrl, and `IsTopSpeaker` flag), create EventSpeaker links if not already linked, assign SpeakerCategoryItems, import SpeakerQuestionAnswers
   e. **Sessions**: upsert sessions (including `IsServiceSession`, `IsPlenumSession`, `LiveUrl`, `RecordingUrl` from Sessionize), create SessionSpeaker and SessionCategoryItem links, import the session's Sessionize question answers
7. The import is persisted as a single transaction: all of it or none of it

**Alternate Flows:**
- If the event does not exist, returns HTTP 404
- If the `Conference.SessionizeIntegration` feature is disabled, returns HTTP 404
- If `SessionizeCode` is blank, returns HTTP 400 with detail "Event has no SessionizeCode configured."
- If the Sessionize API is unreachable (timeout, open circuit, HTTP failure, or an unparseable response), returns HTTP 502 Bad Gateway with detail "Sessionize API is unavailable. Try again later." Nothing is imported, but the refresh stamp from step 4 stays committed, so a retry inside the five-minute window answers 429 (BR-63)
- If the Sessionize API returns an empty or null response, returns HTTP 200 with a response body indicating zero entities synced (not an error: the Sessionize event may have no data yet)

**Important:** Sessionize refresh **only** syncs Conference master data (categories, questions, rooms, speakers, sessions) and Sessionize's own answers to Sessionize-sourced questions. User-generated data: attendee EventQuestionAnswers and SessionQuestionAnswers (which may only target `QuestionSource = "User"` questions, BR-128) and UserSessionBookmarks: is **never modified** by a Sessionize refresh. Locally soft-deleted entities (BR-136) are skipped during refresh. A soft-deleted link row (EventSpeaker, SessionSpeaker, SessionCategoryItem, SpeakerCategoryItem) that Sessionize still lists is reactivated in place rather than duplicated (BR-135 pattern).

**Postconditions:** Local data reflects the current state of the Sessionize schedule.

**Response body** (`POST /Events/{id}/refresh`, HTTP 200):

```json
{
  "categoriesSynced": 5,
  "categoryItemsSynced": 18,
  "roomsSynced": 8,
  "questionsSynced": 6,
  "speakersSynced": 42,
  "sessionsSynced": 35,
  "skippedSoftDeleted": 2,
  "warnings": [
    "Session 'Lightning Talk X' has zero or negative duration (StartsAt equals or exceeds EndsAt) -- stored as-is per BR-122.",
    "Skipped 2 soft-deleted entities present in Sessionize response (BR-136)."
  ]
}
```

- `*Synced` counts reflect total entities created or updated (not just new ones)
- `skippedSoftDeleted` counts entities present in Sessionize response but skipped because they are locally soft-deleted (BR-136)
- `warnings` lists non-fatal issues encountered during import (e.g., BR-122 duration violations, BR-136 soft-deleted skips, social or session links dropped for exceeding a length cap). Empty array when no warnings.

---

### UC-7: Manage Event Rooms

**Actors:** Organizer
**Preconditions:** Event exists; user holds the `conference:rooms:manage` permission (Organizer, BR-41)

**Main Flow:**
1. Add a room to an event (`POST /Rooms`, `EventId` in the body): system loads the parent event, checks the name is unique within the event (BR-255), adds the room, raises `RoomChanged` (Added)
2. Update a room (`PUT /Rooms/{id}`): system locates the room by ID within the event's collection (BR-4), re-checks name uniqueness, updates it in place, raises `RoomChanged` (Updated)
3. Delete a room (`DELETE /Rooms/{id}?eventId={eventId}`): system soft-deletes the room (BR-1, BR-5), raises `RoomChanged` (Deleted), and unassigns the room from every live session of the event that used it, in the same unit of work

---

### UC-8: Manage Categories and Category Items

**Actors:** Organizer, ContentEditor
**Preconditions:** User holds the `conference:categories:manage` permission (Organizer and ContentEditor); Category must exist for items

**Main Flow:**
1. Create a category with title, sort order, and optional type (`POST /conferencecategories`); a category update is conditional on `If-Match`
2. Add category items (values) to the category
3. Add, update, or delete category items within the category

---

### UC-9: Manage Speaker Category Assignments

**Actors:** Organizer, ContentEditor
**Preconditions:** User holds the `conference:speakers:manage` permission (Organizer and ContentEditor); Speaker and CategoryItem exist

**Main Flow:**
1. Assign a category item to a speaker via the Speaker aggregate
2. System validates the speaker exists and assigns the category item

---

### UC-10: View User Claims

**Actors:** Authenticated attendee
**Preconditions:** Valid JWT token

**Main Flow:**
1. Attendee calls `GET /UserClaims`
2. System returns every claim in the JWT as a dictionary keyed by claim type (a multi-valued claim becomes an array): the user identifier (the token's `sub`, surfaced as `nameidentifier`), `jti`, `iat`, name, email, role, one `permission` claim per capability the role holds, and optionally `speaker_id`

---

### UC-11: Manage Personal Schedule (Session Bookmarks)

**Actors:** Authenticated attendee
**Preconditions:** User is authenticated; Sessions exist; the `Engagement.SessionBookmarks` feature is enabled

**Main Flow:**
1. Attendee browses sessions (UC-3)
2. Attendee bookmarks a session (`POST /Bookmarks` with UserId and SessionId); a non-Organizer may only name their own `UserId`
3. System creates a `UserSessionBookmark` record (standalone aggregate root: not through the User aggregate)
4. Attendee views their personal schedule (`GET /Bookmarks?userId={userId}`, optional `eventId` filter, paged): returns the user's bookmarks newest first (by bookmark creation time)

**Alternate Flows:**
- Attendee removes a bookmark (`DELETE /Bookmarks/{bookmarkId}`); a non-Organizer deleting a bookmark that is not theirs gets HTTP 404, not 403, so its existence is not revealed
- Attendee retrieves bookmarked session IDs for quick lookup (`GET /Bookmarks/session-ids?userId={userId}`): returns a dictionary of SessionId -> BookmarkId for efficient UI rendering (e.g., toggle bookmark buttons)
- A `userId` (query) or body `UserId` that is not the caller's returns HTTP 403 unless the caller is an Organizer
- Attempting to bookmark the same session twice returns HTTP 409 Conflict (BR-21)
- Attempting to bookmark a service session (`IsServiceSession = true`) returns HTTP 400 (BR-91)
- Attempting to bookmark a session with non-eligible status (anything other than Accepted or null) returns HTTP 400 (BR-49)
- Attempting to bookmark a session of an unpublished event returns HTTP 404 (BR-108)
- An erased account's still-valid token is refused with HTTP 403
- Re-bookmarking a previously removed (soft-deleted) bookmark reactivates the existing record rather than creating a new one (BR-135)

**Postconditions:** User's personal schedule is updated.

**Business Rules:** BR-21, BR-22, BR-49, BR-91, BR-135

---

### UC-19: Manage Conference Entities (Standard CRUD)

**Actors:** Organizer, ContentEditor (sessions and speakers only)
**Preconditions:** User holds the entity's manage permission: `conference:events:manage` and `conference:questions:manage` (Organizer only, BR-41), `conference:sessions:manage` and `conference:speakers:manage` (Organizer and ContentEditor)

**Scope:** This use case covers the standard create, update, and delete operations for Conference aggregate roots: **Event**, **Session**, **Speaker**, and **Question**: and their child entities managed through the parent aggregate. Read operations are public (BR-43).

**Main Flow:**
1. Organizer creates, updates, or deletes a Conference entity via the REST API
2. For aggregate roots: direct CRUD operations with soft delete (BR-1)
3. For child entities: operations routed through the parent aggregate: parent must exist (BR-3), child parent ID must match aggregate root ID (BR-2), child must exist for update (BR-4) or delete (BR-5)
4. Each mutation raises the appropriate domain event (see section 6)

**Alternate Flows:**
- Event, Session, Speaker and Question updates are conditional: a `PUT` without an `If-Match` header answers HTTP 428 and a stale version answers HTTP 412
- A linked speaker may update their own profile without any manage permission (BR-214); a self-edit cannot change `IsTopSpeaker`

**Note:** Operations with non-standard business logic are documented as individual use cases: room management (UC-7), category/item management (UC-8), speaker category assignments (UC-9), and Sessionize refresh (UC-6). The Actor-Action Matrix provides the complete enumeration of all actions.

**Business Rules:** BR-1 through BR-5, BR-10, BR-41

---

### UC-21: Delete User Account

**Actors:** Authenticated attendee (own account), Organizer (any account)
**Preconditions:** User is authenticated; target User exists

**Main Flow:**
1. Attendee requests account deletion (`DELETE /Users/{userId}`)
2. System verifies the requesting user is either the account owner or has the Organizer role
3. System soft-deletes the User record (BR-1, BR-56), anonymizes the account's personal data in place, revokes and anonymizes its refresh sessions, and revokes its already-issued access tokens
4. In the same transaction the system raises the cross-service `UserDeleted` integration event and, when the account has an avatar, schedules the avatar blob deletion as a durable internal command
5. System returns HTTP 204

**Alternate Flows:**
- Non-owner, non-organizer attempts deletion: system returns HTTP 403
- User does not exist, or is already soft-deleted (the soft-delete filter hides it): system returns HTTP 404

**Postconditions:** User can no longer authenticate, and the account's data held by other services is erased when they consume `UserDeleted`.

**Business Rules:** BR-1, BR-56

---

### UC-22: Run a Live Poll

**Actors:** Organizer (any scope), Speaker (sessions they are assigned to)
**Preconditions:** Caller is authenticated; the target event exists and is published (BR-222); the
`Engagement.LivePolls` feature is enabled

**Main Flow:**
1. Author creates a poll with its options (`POST /LivePolls`); it starts as **Draft** (BR-220, BR-221)
2. During the event's live window, the author opens the poll (`POST /LivePolls/{id}/open`). The
   system snapshots the live-window end onto the poll (BR-223)
3. Attendees see the poll and vote (UC-23)
4. The author closes the poll (`POST /LivePolls/{id}/close`); it cannot be reopened (BR-221)

**Alternate Flows:**
- Caller is neither an organizer nor an assigned speaker for the scope: HTTP 403 (BR-236)
- Open or close without an `If-Match` header: HTTP 428; with a stale version: HTTP 412
- Open attempted outside the live window: invariant failure (BR-223)
- Open attempted on a non-Draft poll, or close on a non-Open poll: invariant failure (BR-221)
- Delete attempted while Open: rejected, the poll must be closed first (BR-228)
- An organizer lists every poll of an event (`GET /LivePolls?eventId=`, `engagement:live:manage`); an organizer or the session's assigned speaker lists every poll of one session (`GET /LivePolls/manage?sessionId=`)

**Postconditions:** The poll's tallies are final and remain readable.

**Business Rules:** BR-220, BR-221, BR-222, BR-223, BR-228, BR-230, BR-236

---

### UC-23: Vote in a Live Poll

**Actors:** Authenticated attendee
**Preconditions:** The poll is Open and the event is still live (BR-224)

**Main Flow:**
1. Attendee opens `/happening-now` (event-wide polls) or the session's live page (`/conference/sessions/{id}/live`, session-scoped polls); both read `GET /LivePolls/open` with `eventId` or `sessionId`
2. Attendee casts a vote for an option (`POST /LivePolls/{id}/votes`)
3. System validates the option belongs to the poll and is not deleted (BR-226)
4. System records the vote and returns the fresh tallies plus the caller's own choice

**Alternate Flows:**
- Attendee votes again while the poll is open: the existing vote is **changed**, not duplicated (BR-225)
- Poll is Closed, or the live window has passed: invariant failure (BR-224)
- Attendee reads one poll's tallies (`GET /LivePolls/{id}/results`): a Draft poll, or a poll of an unpublished event, answers 404 to anyone without BR-236 rights

**Postconditions:** Exactly one active vote exists for this (poll, user).

**Business Rules:** BR-224, BR-225, BR-226, BR-229

---

### UC-24: Ask a Question in a Live Session

**Actors:** Authenticated attendee
**Preconditions:** The `Engagement.SessionQA` feature is enabled; the event is published and live

**Main Flow:**
1. Attendee submits a question on the session's live page (`POST /SessionQuestions`)
2. System validates the text (1-500 characters) and the caller's open-question count for that
   session (BR-231)
3. The question is created at the event's moderation default, Pending or Approved (BR-233)
4. Once Approved, the question appears in the attendee view (`GET /SessionQuestions?sessionId=`) for everyone, **without naming the
   submitter** (BR-238); the attendee view also shows the caller's own Pending and Dismissed questions

**Alternate Flows:**
- Text empty or over 500 characters: validation error
- Caller already has 10 open questions for the session: rejected (BR-231)
- Event not published, or the current time is outside the live window: invariant failure
- An erased account's still-valid token is refused with HTTP 403

**Postconditions:** The question is queued for moderation or immediately visible.

**Business Rules:** BR-231, BR-233, BR-237, BR-238

---

### UC-25: Moderate Session Questions

**Actors:** Organizer, Speaker assigned to the session
**Preconditions:** Caller passes the live-layer rights check (BR-236)

**Main Flow:**
1. Moderator opens the moderation view (`GET /SessionQuestions/moderation?sessionId=`), which lists all
   statuses with Pending first
2. Moderator approves, dismisses, or marks an approved question answered (`POST /SessionQuestions/{id}/approve`, `/dismiss`, `/answered`, each conditional on `If-Match`)

**Alternate Flows:**
- Approving an already-Approved question, or dismissing an already-Dismissed one: invariant failure (BR-234)
- Marking answered on a question that is not Approved, or already answered: invariant failure (BR-234)
- Caller is not an organizer or an assigned speaker: HTTP 403, enforced server-side on every call (BR-236)
- Missing `If-Match` header: HTTP 428; stale version: HTTP 412

**Postconditions:** The attendee view reflects the moderation decision.

**Business Rules:** BR-234, BR-236

---

### UC-26: Upvote a Question

**Actors:** Authenticated attendee
**Preconditions:** The question is Approved and the event is still live (BR-237)

**Main Flow:**
1. Attendee upvotes an approved question (`POST /SessionQuestions/{id}/upvotes`)
2. System returns the fresh count

**Alternate Flows:**
- Attendee removes their upvote (`DELETE /SessionQuestions/{id}/upvotes`): the row is soft-deleted; re-upvoting
  reactivates it rather than inserting a second (BR-235)
- Question not Approved, or the live window has passed: invariant failure (BR-237)

**Postconditions:** At most one active upvote exists for this (question, user). Broadcasts carry only
the count, never who voted (BR-238).

**Business Rules:** BR-235, BR-237, BR-238

---

### UC-27: Score Sessions for Selection

**Actors:** Organizer
**Preconditions:** Caller holds the `conference:session-selection:manage` permission (Organizer); the event has submitted sessions

**Main Flow:**
1. Organizer opens the selection dashboard (`/sessions/selection-dashboard`, backed by `GET /SessionSelection/dashboard/{eventId}`), which
   composes category distribution, speaker overlap, and content similarity (each also readable on its own under `/SessionSelection/categories/{eventId}`, `/speaker-overlap/{eventId}` and `/content-similarity/{eventId}`)
2. Organizer queues AI scoring for all eligible sessions (`POST /SessionSelection/score/{eventId}`)
3. The request returns **202 Accepted** immediately after writing one durable internal-command row; scoring runs off the request path on the internal-command processor
   ([ADR-114](../adr/114-internal-commands-durable-job-queue.md)) because it takes minutes and issues one paid
   API call per session
4. Organizer refreshes the dashboard to see results

**Alternate Flows:**
- A run is already queued or in progress for the same event: the trigger still answers 202 Accepted, and no duplicate run happens. The handler takes a per-event claim before it starts, so a second pass for an event already being scored logs and completes without paying for the same calls twice; a trigger queued behind a running pass skips every session already scored since the trigger was requested
- The event does not exist or is soft-deleted: HTTP 404 and nothing is queued
- The `Conference.SessionScoring` feature is disabled: the trigger answers HTTP 404; the dashboard and stored scores stay readable

**Postconditions:** Sessions carry AI scores that inform the accept/decline decision.

---

### UC-36: Manage Sponsors and Exhibitors

**Actors:** Organizer, ContentEditor
**Preconditions:** Caller holds the `conference:sponsors:manage` permission (BR-243); the owning event exists

**Main Flow:**
1. Organizer opens the sponsor admin pages (`/sponsors`, `/sponsors/create`, `/sponsors/{id}`)
2. Organizer creates a sponsor with its name, tier and optional profile fields (`POST /Sponsors`, BR-240, BR-241)
3. Organizer updates (`PUT /Sponsors/{id}`, conditional on `If-Match`) or soft-deletes (`DELETE /Sponsors/{id}`) a sponsor; the owning event cannot be changed (BR-240)
4. Attendees see the sponsors of published events grouped by tier on `/conference/sponsors` (`GET /Sponsors`, anonymous, BR-242)

**Alternate Flows:**
- Caller without the permission: HTTP 403
- Validation failure on a field shape: HTTP 400 (BR-240)

**Business Rules:** BR-240, BR-241, BR-242, BR-243

---

### UC-37: Manage Partners

**Actors:** Organizer, ContentEditor
**Preconditions:** Caller holds the `conference:partners:manage` permission (BR-259); the owning event exists

**Main Flow:**
1. Organizer opens the partner admin pages (`/partners`, `/partners/create`, `/partners/{id}`)
2. Organizer creates a partner with its name, type and optional profile fields (`POST /Partners`, BR-256, BR-257)
3. Organizer updates (`PUT /Partners/{id}`, conditional on `If-Match`) or soft-deletes (`DELETE /Partners/{id}`) a partner
4. The partners of published events appear in the Home page partners band (`GET /Partners`, anonymous, BR-258, BR-260)

**Alternate Flows:**
- Caller without the permission: HTTP 403
- A `LogoUrl` or `WebsiteUrl` that is not an absolute `http` or `https` URL: HTTP 400 (BR-256)

**Business Rules:** BR-256, BR-257, BR-258, BR-259, BR-260

---

### UC-38: Manage Social Activities

**Actors:** Organizer, ContentEditor
**Preconditions:** Caller holds the `conference:activities:manage` permission (BR-265); the owning event exists

**Main Flow:**
1. Organizer opens the activity admin pages (`/activities`, `/activities/create`, `/activities/{id}`)
2. Organizer creates a social or networking activity with a name, start and end time, optional description, venue name, venue address and venue URL, and a sort order (`POST /Activities`)
3. Organizer updates (`PUT /Activities/{id}`, conditional on `If-Match`) or soft-deletes (`DELETE /Activities/{id}`) an activity
4. Attendees see the activities of published events on `/conference/activities` (`GET /Activities`, anonymous)

**Alternate Flows:**
- Empty name, or a field over its length cap: validation failure
- End time before start time: invariant failure (`Activity.TimeRange.Invalid`)
- Caller without the permission: HTTP 403

**Business Rules:** BR-265

---

### UC-39: Publish Session Materials

**Actors:** Speaker (sessions they present), Organizer, ContentEditor (any session)
**Preconditions:** Caller is a current speaker of the session (matched by the `speaker_id` claim) or holds `conference:session-assets:manage` (BR-116b)

**Main Flow:**
1. Speaker opens the materials panel on the speaker dashboard (`/speaker/dashboard`) or on the session admin page
2. Speaker adds a link to externally hosted material (`POST /SessionAssets/link`, absolute `http` or `https` URL) or uploads a file (`POST /SessionAssets/file`, multipart, at most 50 MB, accepted only when the bytes and the extension agree)
3. Speaker updates an asset's title and sort order, and a link's URL (`PUT /SessionAssets/{id}`, conditional on `If-Match`), or soft-deletes it (`DELETE /SessionAssets/{id}`), which schedules the stored file's blob for removal
4. Attendees see the materials beneath the session on its public page (`GET /SessionAssets?sessionId=`, anonymous)

**Alternate Flows:**
- Caller is neither a speaker of the session nor holds the permission: HTTP 403
- Empty file or a file over 50 MB, an unrecognized format, or a session already holding 10 assets: HTTP 400
- A session the public cannot see (BR-49, BR-108) lists an empty set of materials, not 404

**Business Rules:** BR-116b

---

### UC-40: Check In an Attendee by Badge

**Actors:** Authenticated attendee (badge holder), Organizer (scanner)
**Preconditions:** The `Engagement.CheckIn` feature is enabled; the scanner holds `engagement:checkin:manage` (BR-247)

**Main Flow:**
1. Attendee opens `/my-badge` (`GET /CheckIns/my-badge`); the system mints the attendee's one opaque badge credential on first use and shows it as a QR code (BR-244)
2. Organizer scans the badge on `/check-in` (`POST /CheckIns`) for an event or a session (BR-245)
3. System resolves the credential to the attendee, records the check-in with both parties and the instant, and publishes `AttendeeCheckedIn` through the outbox (BR-249)
4. Organizer reviews attendance on `/organizer/attendance` (`GET /CheckIns/stats?eventId=`)

**Alternate Flows:**
- Attendee already checked in for the same subject: HTTP 200 with an "already checked in" outcome and the original check-in time; nothing is written (BR-246)
- No camera or no phone: organizer finds the attendee and checks them in manually (`POST /CheckIns/manual`)
- Unknown badge credential: HTTP 404
- Feature disabled: HTTP 404

**Business Rules:** BR-244, BR-245, BR-246, BR-247, BR-248, BR-249

---

### UC-41: Self-Service QR Check-In (Sponsor Booth and Room)

**Actors:** Authenticated attendee
**Preconditions:** The `Engagement.SponsorVisits` (booth) or `Engagement.RoomCheckIn` (room) feature is enabled; the owning event is published

**Main Flow:**
1. Attendee scans a sponsor's or a room's printed QR code, which opens `/engage/sponsors/{sponsorId}` or `/engage/rooms/{roomId}`
2. For a booth, the system records the caller's visit to that sponsor (`POST /CheckIns/sponsor-visits`) and returns the sponsor name
3. For a room, the system resolves which session the room is hosting at that instant and checks the caller in to it (`POST /CheckIns/room-visits`) as an ordinary session check-in (BR-262)
4. The attendee is always the authenticated caller; the row records the attendee as both the attendee and the recorder, which keeps a self check-in distinguishable from an organizer scan

**Alternate Flows:**
- Repeat visit or repeat room check-in (including one where an organizer already scanned the attendee): HTTP 200 with `AlreadyVisited` or `AlreadyCheckedIn` true
- No session is running in the room: HTTP 404 `CheckIns.NoCurrentSession`
- Attendee already checked in to another session in the same time slot: still checked in (HTTP 200) with `EarnsPoints` false, because session points are awarded once per time slot
- Session check-in points switched off (`Points:SessionCheckIn` at 0): the check-in is recorded with `PointsPaused` true

**Business Rules:** BR-246, BR-250, BR-251, BR-261, BR-262

---

### UC-42: Earn Points and Join the Leaderboard

**Actors:** Authenticated attendee, Organizer (overview)
**Preconditions:** The `Engagement.Points` feature is enabled

**Main Flow:**
1. Attendee earns points as a side effect of check-ins, sponsor visits, feedback and questions (BR-250, BR-252)
2. Attendee opens `/points` to see their running total, leaderboard status and ledger entries (`GET /Points/me`); the caller is always taken from the token
3. Attendee opts in to (or out of) the public leaderboard (`PUT /Points/me/leaderboard-participation`, body carries only a boolean); the published display name is taken server-side from the token (BR-253)
4. Attendees read the leaderboard (`GET /Points/leaderboard`), whose length is fixed by configuration (`Points:LeaderboardSize`)
5. Organizer reviews participation, payouts per activity and recent activity on `/organizer/points` (`GET /Points/overview`, `engagement:points:view-overview`); the rollup carries no attendee identity

**Business Rules:** BR-250, BR-251, BR-252, BR-253, BR-254

---

### UC-43: Administer User Accounts

**Actors:** Organizer
**Preconditions:** Caller holds `identity:users:read` for the roster and `users:manage` for the account actions (both Organizer only; never ContentEditor)

**Main Flow:**
1. Organizer opens the user roster (`/users`, backed by `GET /Users/paged`, BR-51)
2. Organizer opens one account (`/users/{id}`, `GET /Admin/Users/{userId}`) and its signed-in sessions (`GET /Admin/Users/{userId}/sessions`)
3. Organizer locks (`POST /Admin/Users/{userId}/lock`) or unlocks (`POST /Admin/Users/{userId}/unlock`) the account; a lock refuses sign-in and token refresh and revokes the account's live refresh sessions
4. Organizer changes the account's role (`PUT /Admin/Users/{userId}/roles` with exactly one of `Attendee`, `Organizer`, `ContentEditor`); a real change revokes the account's live refresh sessions so the new capability set applies within one access-token lifetime

**Alternate Flows:**
- Zero or more than one role in the request: HTTP 400 (`User.Role.ExactlyOne`)
- Re-submitting the role the account already holds: no change and no sign-out
- Unknown account: HTTP 404
- The admin pages hide the lock and role actions on the operator's own account

**Business Rules:** BR-51, BR-264

---

### UC-44: Administer Role Permissions

**Actors:** Organizer
**Preconditions:** Caller holds `roles:manage` (Organizer only)

**Main Flow:**
1. Organizer opens the role roster (`/roles`, `GET /Admin/Roles`), showing each role's compiled and stored permissions
2. Organizer opens one role (`/roles/{role}`, `GET /Admin/Roles/{role}`) with the permission catalog (`GET /Admin/Roles/catalog`)
3. Organizer replaces that role's **stored** grants (`PUT /Admin/Roles/{role}/permissions`)

**Alternate Flows:**
- Stored grants are added to the compiled ones (union only), so nothing set here can remove a capability the application compiles in

---

### UC-45: Export My Personal Data

**Actors:** Authenticated attendee (own account), Organizer (any account)
**Preconditions:** The data-export feature is enabled

**Main Flow:**
1. Attendee selects "Download my data" on the Profile page's legal and data card (`/profile`)
2. System calls `GET /Users/{userId}/export` and verifies the caller is the account owner or an Organizer
3. System assembles one JSON document: the account's portable fields (credentials and secrets excluded) plus one section per service: Engagement (bookmarks, submitted questions, points ledger, check-in history, leaderboard participation, BR-254), Notifications (inbox rows) and Conference (the feedback answers the user authored)
4. The browser saves the file

**Alternate Flows:**
- Caller is neither the owner nor an Organizer: HTTP 403
- A peer service stays unreachable: that section is marked unavailable and the export still succeeds

**Business Rules:** BR-254

---

### UC-46: Accept the Terms of Service

**Actors:** Authenticated attendee
**Preconditions:** A current terms version is configured (`Legal:CurrentTermsVersion`)

**Main Flow:**
1. Registration with email and password stamps the new account with the current terms version (the registration form requires the acceptance box)
2. The client reads the caller's standing (`GET /Users/me/legal-acceptance`); an account created through external sign-in carries no acceptance and is asked to accept on first sign-in, and an acceptance of an older version reads as outdated
3. Attendee accepts (`POST /Users/me/legal-acceptance` naming the version)
4. The Profile page's legal and data card shows the current standing

**Alternate Flows:**
- The request names a version other than the configured current one: HTTP 400
- No terms version configured: the standing reads as current and nobody is blocked

---

### UC-47: Manage Profile Photo

**Actors:** Authenticated attendee
**Preconditions:** User is authenticated

**Main Flow:**
1. Attendee opens `/profile`, which shows the current avatar (`GET /Users/me/avatar`)
2. Attendee uploads one image (`POST /Users/me/avatar`, multipart, at most 2 MB); the system checks the real format and stores a re-encoded copy (BR-116a)
3. Attendee removes the photo (`DELETE /Users/me/avatar`, idempotent)

**Alternate Flows:**
- Empty file or a file over 2 MB: HTTP 400 (`Avatar.InvalidUpload`)

**Business Rules:** BR-116a

> **Use-case numbering.** UC-12 to UC-18, UC-20, and UC-28/UC-29 are unused; the numbers were retired
> as the specification was reorganized and are deliberately not recycled. UC-30 to UC-35 are the
> authentication flows and live in Section 12.2. UC-36 onward are the use cases added after them.

---

### Actor-Action Matrix

This section maps every action in the system to the actor(s) that can perform it. Actions include formal use cases (UC-*), implicit CRUD from Key Capability #1, and capabilities mentioned in UC postconditions or business rules.

#### Actors

| Actor | Identity | Authorization | Additive? |
|---|---|---|---|
| **API Consumer** | Unauthenticated | None: public endpoints only (BR-43) | Base level |
| **Attendee** | Authenticated via email + password (UC-31) or external sign-in | Authenticated: valid JWT with `role: Attendee` (BR-42) | Includes all API Consumer actions |
| **Speaker** | Attendee with `speaker_id` claim | Same as Attendee + speaker-specific data views (BR-210), plus session-scoped live-layer rights (BR-236) and materials rights (BR-116b) for the sessions they present | Not a separate role: an Attendee with a speaker identity link |
| **ContentEditor** | Authenticated, `User.Role = ContentEditor` | Holds the Conference content-management permission set only: sessions, speakers, categories, sponsors, partners, activities, session materials | Includes all Attendee actions + privileged Conference reads |
| **Organizer** | Authenticated, `User.Role = Organizer` | Holds every Conference, Engagement and Identity permission (BR-41) | Includes all Attendee and ContentEditor actions + all Speaker view access |
| **System** | Non-human: domain event handlers | N/A | Autonomous |

#### API Consumer (Unauthenticated)

| # | Action | Source | Endpoint Pattern |
|---|--------|--------|-----------------|
| 1 | List/page/filter/sort events | UC-2, BR-43 | `GET /Events`, `GET /Events/paged` |
| 2 | Get single event by ID | UC-2, BR-43 | `GET /Events/{id}` |
| 3 | Get events in lookup format (Id + Name) | UC-2 alternate | `GET /Events/lookup` |
| 4 | Get event with children (rooms, event speakers, answers) | UC-2 alternate | `GET /Events/{id}?includeChildren=true` |
| 5 | List/page/filter/sort sessions (filterable by EventId, RoomName, virtual SpeakerId) | UC-3, BR-43 | `GET /Sessions`, `GET /Sessions/paged` |
| 6 | Get single session by ID | UC-3 implied | `GET /Sessions/{id}` |
| 7 | Get session with children (speakers, category items, answers) | UC-3 | `GET /Sessions/{id}?includeChildren=true` |
| 8 | List/page/filter/sort speakers | Key Cap #1, BR-43 | `GET /Speakers`, `GET /Speakers/paged` |
| 9 | Get single speaker by ID | Key Cap #1, BR-43 | `GET /Speakers/{id}` |
| 10 | List/page/filter/sort categories | Key Cap #1, BR-43 | `GET /conferencecategories` |
| 11 | Get category with items | Key Cap #1, BR-43 | `GET /conferencecategories/{id}` |
| 12 | List/page/filter/sort rooms | Key Cap #1, BR-43 | `GET /Rooms` |
| 13 | List/page/filter/sort questions | Key Cap #1, BR-43 | `GET /Questions` |
| 13b | View session bookmark count for a speaker | BR-210 | `GET /Speakers/{speakerId}/sessions/{sessionId}/bookmarks/count` |
| 13c | View bookmark counts for several of a speaker's sessions | BR-210 | `GET /Speakers/{speakerId}/sessions/bookmarks/counts?sessionIds=` |
| 13d | Download an event or a session as iCalendar | UC-2, UC-3 | `GET /Events/{id}/ics`, `GET /Sessions/{id}/ics` |
| 13e | Read the "happening now / up next" snapshot | UC-2 | `GET /Events/now-next`, `GET /Events/{id}/now-next` |
| 13f | List sponsors, partners and activities | UC-36, UC-37, UC-38 | `GET /Sponsors`, `GET /Partners`, `GET /Activities` |
| 13g | List a session's materials | UC-39 | `GET /SessionAssets?sessionId=` |
**Constraints:** Pagination capped at 500 items (BR-11). Rate limited per client IP at the Gateway edge (BR-20). Only published events visible (BR-108), only BR-49-eligible sessions visible, and only speakers with a visible session in the scoped event set visible (BR-239). The same filters apply to the `/lookup` and junction endpoints (BR-132).

#### Attendee (Authenticated, `role: Attendee`)

All API Consumer actions, plus:

**Authentication & Identity:**

| # | Action | Source | Endpoint Pattern |
|---|--------|--------|-----------------|
| 14 | Register (email + password) | UC-30, BR-211 | `POST /auth/register` |
| 15 | Login (email + password) | UC-31 | `POST /auth/login` |
| 15a | Refresh access token (web only) | UC-32, BR-205 | `POST /auth/refresh` |
| 15b | Revoke refresh token (logout) | BR-216 | `POST /auth/revoke` |
| 15c | Change password | UC-33 | `PUT /auth/password` |
| 15d | Request a password reset link | UC-34, BR-217, BR-219 | `POST /auth/forgot-password` |
| 15e | Reset the password with the emailed token | UC-35, BR-218 | `POST /auth/reset-password` |
| 16 | View own JWT claims | UC-10 | `GET /UserClaims` |

**Feedback (Conference context, attendee-written):**

| # | Action | Source | Constraints |
|---|--------|--------|-------------|
| 18 | Submit event feedback | UC-4, BR-42, BR-107 | `POST /EventQuestionAnswers`; per-question submission; records `CreatedBy`; overwrites existing answers (BR-123) |
| 18a | Submit a whole event feedback form | UC-4 | `POST /EventQuestionAnswers/batch`; one transaction, all or nothing |
| 19 | Read own event feedback answers | UC-4, BR-8 | Scoped to own answers only: cannot see others'; `GET /EventQuestionAnswers/mine?eventId=` returns the caller's own answers whatever the role |
| 20 | Update own event feedback answer | Key Cap #1, BR-42 | `PUT /EventQuestionAnswers/{id}` |
| 21 | Delete own event feedback answer (soft) | Key Cap #1, BR-42, BR-1 | Soft delete only |
| 22 | Submit session feedback | UC-5, BR-42, BR-49, BR-107 | `POST /SessionQuestionAnswers`; per-question submission; records `CreatedBy`; only for Accepted/null, scheduled sessions (BR-49, BR-16); overwrites existing (BR-123) |
| 22a | Submit a whole session feedback form | UC-5 | `POST /SessionQuestionAnswers/batch`; one transaction, all or nothing |
| 23 | Read own session feedback answers | UC-5, BR-9 | Scoped to own answers only; `GET /SessionQuestionAnswers/mine?sessionId=` |
| 24 | Update own session feedback answer | Key Cap #1, BR-42 | `PUT /SessionQuestionAnswers/{id}` |
| 25 | Delete own session feedback answer (soft) | Key Cap #1, BR-42, BR-1 | Soft delete only |

**Personal Schedule (Engagement context):**

| # | Action | Source | Constraints |
|---|--------|--------|-------------|
| 26 | Bookmark a session | UC-11, BR-21, BR-91 | `POST /Bookmarks`; unique per (UserId, SessionId); informational only, no seat reservation (BR-22); service sessions cannot be bookmarked (BR-91) |
| 27 | View own bookmarks (personal schedule) | UC-11 | `GET /Bookmarks`; paged, newest bookmark first, optional `eventId` filter |
| 27a | Get bookmarked session IDs | UC-11 | `GET /Bookmarks/session-ids`; returns dictionary of SessionId -> BookmarkId for quick lookup |
| 28 | Remove a bookmark | UC-11 alternate | `DELETE /Bookmarks/{id}`; soft delete |

**Live layer (Engagement context):**

| # | Action | Source | Constraints |
|---|--------|--------|-------------|
| 93 | View open polls with tallies and own vote | UC-23 | `GET /LivePolls/open?eventId=` or `?sessionId=` |
| 94 | View one poll's results | UC-23 | `GET /LivePolls/{id}/results`; Open or Closed polls of published events only (BR-236) |
| 95 | Vote, or change a vote | UC-23, BR-224, BR-225 | `POST /LivePolls/{id}/votes` |
| 96 | Ask a question in a live session | UC-24, BR-231 | `POST /SessionQuestions` |
| 97 | View a session's questions | UC-24, BR-238 | `GET /SessionQuestions?sessionId=`; approved questions plus own |
| 98 | Upvote or withdraw an upvote | UC-26, BR-235 | `POST` or `DELETE /SessionQuestions/{id}/upvotes` |

**Badge, check-in and points (Engagement context):**

| # | Action | Source | Constraints |
|---|--------|--------|-------------|
| 99 | View own badge | UC-40, BR-244 | `GET /CheckIns/my-badge`; minted on first use |
| 100 | Record a sponsor booth visit | UC-41 | `POST /CheckIns/sponsor-visits`; own visit only |
| 101 | Check in to the session a room is hosting | UC-41, BR-262 | `POST /CheckIns/room-visits`; session resolved server-side |
| 102 | View own points | UC-42 | `GET /Points/me` |
| 103 | View the leaderboard | UC-42 | `GET /Points/leaderboard` |
| 104 | Join or leave the leaderboard | UC-42, BR-253 | `PUT /Points/me/leaderboard-participation` |

**Account Management:**

| # | Action | Source | Constraints |
|---|--------|--------|-------------|
| 40 | Delete own account | UC-21, BR-56 | `DELETE /Users/{userId}`; soft-deletes and anonymizes the user |
| 105 | Export own data | UC-45, BR-254 | `GET /Users/{userId}/export`; owner or Organizer |
| 106 | Read and accept the Terms of Service | UC-46 | `GET` and `POST /Users/me/legal-acceptance` |
| 107 | Set or remove own profile photo | UC-47, BR-116a | `GET`, `POST` and `DELETE /Users/me/avatar` |

#### Speaker (Attendee with `speaker_id` claim)

All Attendee actions, plus:

| # | Action | Source | Constraints |
|---|--------|--------|-------------|
| 90 | View own session feedback | BR-210 | `GET /Speakers/{speakerId}/sessions/{sessionId}/feedback`; authenticated, and the `speaker_id` claim must match `{speakerId}` unless the caller is an Organizer; uncached |
| 91 | View session bookmark counts (public) | BR-210 | `AllowAnonymous`, publicly accessible; no auth or `speaker_id` matching required |
| 92 | Update own speaker profile | BR-214 | `speaker_id` must match URL `{speakerId}`; edits overwritten on Sessionize refresh (BR-215) |
| 108 | Author and run polls for assigned sessions | UC-22, BR-236 | `POST /LivePolls`, `/open`, `/close`, `DELETE`, `GET /LivePolls/manage?sessionId=` |
| 109 | Moderate questions of assigned sessions | UC-25, BR-236 | `GET /SessionQuestions/moderation`, `/approve`, `/dismiss`, `/answered` |
| 110 | Manage materials of own sessions | UC-39, BR-116b | `POST /SessionAssets/link`, `POST /SessionAssets/file`, `PUT` and `DELETE /SessionAssets/{id}` |

> **Note:** Action 91 is technically accessible to all actors (including unauthenticated API Consumers) because the bookmark-count endpoints use `AllowAnonymous`. It is listed here because the feature was designed for speaker self-service and the `{speakerId}` parameter refers to the speaker's own data. Action 90 is not public: session feedback is the speaker's own read.

#### ContentEditor (`role: ContentEditor`)

All Attendee actions, plus the privileged Conference reads (unpublished events, every session and speaker) and the event, session and speaker CSV exports, plus these Organizer actions: 44-52 (session, speaker and category CRUD), 62, 64, 65, 67 (session speaker and category links), 68-71 and 73 (category items and speaker category items), 111-119 (sponsors, partners, activities) and 120 (any session's materials). A ContentEditor holds no event, room, question, Sessionize, publication, speaker-linking, session-selection, Engagement or user and role administration permission.

#### Organizer (`role: Organizer`)

All Attendee actions, plus:

**Event (aggregate root) CRUD:**

| # | Action | Source | Side Effects |
|---|--------|--------|-------------|
| 41 | Create event | Key Cap #1, BR-41 | |
| 42 | Update event | Key Cap #1, BR-41 | Conditional on `If-Match` |
| 43 | Delete event (soft) | Key Cap #1, BR-41, BR-1 | Cascade soft-deletes all sessions (BR-127) |

**Session (aggregate root) CRUD:**

| # | Action | Source | Side Effects |
|---|--------|--------|-------------|
| 44 | Create session | Key Cap #1, BR-41 | Raises `SessionChanged` (Added) |
| 45 | Update session | Key Cap #1, BR-41 | Conditional on `If-Match` |
| 46 | Delete session (soft) | Key Cap #1, BR-41, BR-1 | Cascade soft-deletes owned children (BR-55) |

**Speaker (aggregate root) CRUD:**

| # | Action | Source | Side Effects |
|---|--------|--------|-------------|
| 47 | Create speaker | Key Cap #1, BR-41 | |
| 48 | Update speaker | Key Cap #1, BR-41 | Conditional on `If-Match` |
| 49 | Delete speaker (soft) | Key Cap #1, BR-41, BR-1 | |

**Category (aggregate root) CRUD:**

| # | Action | Source | Side Effects |
|---|--------|--------|-------------|
| 50 | Create category | UC-8, BR-41 | |
| 51 | Update category | UC-8, BR-41 | Conditional on `If-Match` |
| 52 | Delete category (soft) | Key Cap #1, BR-41, BR-1 | |

**Question (aggregate root) CRUD:**

| # | Action | Source | Side Effects |
|---|--------|--------|-------------|
| 53 | Create question | Key Cap #1, BR-41 | |
| 54 | Update question | Key Cap #1, BR-41 | Conditional on `If-Match` |
| 55 | Delete question (soft) | Key Cap #1, BR-41, BR-1 | |

**Child entity management (through parent aggregate):**

| # | Action | Parent Aggregate | Source | Endpoint Pattern | Side Effects |
|---|--------|-----------------|--------|-----------------|-------------|
| 56 | Add room to event | Event | UC-7 | `POST /Rooms` | Raises `RoomChanged` (Added) |
| 57 | Update room | Event | UC-7 | `PUT /Rooms/{id}` | Raises `RoomChanged` (Updated) |
| 58 | Delete room (soft) | Event | UC-7 | `DELETE /Rooms/{id}?eventId=` | Raises `RoomChanged` (Deleted); unassigns the room from its sessions |
| 59 | Add speaker to event | Event | Key Cap #1, BR-41 | `POST /EventSpeakers` | |
| 61 | Delete event speaker (soft) | Event | Key Cap #1, BR-41 | `DELETE /EventSpeakers/{id}` | |
| 62 | Add speaker to session | Session | Key Cap #1, BR-41 | `POST /SessionSpeakers` | |
| 64 | Delete session speaker (soft) | Session | Key Cap #1, BR-41 | `DELETE /SessionSpeakers/{id}` | |
| 65 | Add category item to session | Session | Key Cap #1, BR-41 | `POST /SessionCategoryItems` | |
| 67 | Delete session category item (soft) | Session | Key Cap #1, BR-41 | `DELETE /SessionCategoryItems/{id}` | |
| 68 | Add category item to category | Category | UC-8 | `POST /CategoryItems` | |
| 69 | Update category item | Category | UC-8 | `PUT /CategoryItems/{id}` | |
| 70 | Delete category item (soft) | Category | UC-8 | `DELETE /CategoryItems/{id}` | |
| 71 | Add category item to speaker | Speaker | UC-9 | `POST /SpeakerCategoryItems` | |
| 73 | Delete speaker category item (soft) | Speaker | Key Cap #1, BR-41 | `DELETE /SpeakerCategoryItems/{id}` | |
| 73a | Add question answer to speaker | Speaker | Key Cap #1, BR-41 | *(domain only: no REST controller)* | Raises `SpeakerQuestionAnswerChanged` (Added). **Not exposed via REST API**: SpeakerQuestionAnswer CRUD is supported at the domain layer but no `SpeakerQuestionAnswersController` exists. Speaker question answers are populated only via Sessionize import (UC-6). |
| 73b | Update speaker question answer | Speaker | Key Cap #1, BR-41 | *(domain only: no REST controller)* | Raises `SpeakerQuestionAnswerChanged` (Updated) |
| 73c | Delete speaker question answer (soft) | Speaker | Key Cap #1, BR-41 | *(domain only: no REST controller)* | Raises `SpeakerQuestionAnswerChanged` (Deleted) |

> **Endpoint convention:** Child entity write endpoints use top-level routes (e.g., `/Rooms`, not `/Events/{eventId}/rooms`). The parent aggregate ID is included in the request body and validated via BR-2 (child's parent ID must match the aggregate root ID). Read endpoints for all child entities also use top-level routes (see Section 11.3).

> **Note:** Join entities (EventSpeaker, SessionSpeaker, SessionCategoryItem, SpeakerCategoryItem) have no update action: they have no mutable attributes beyond foreign keys. CategoryItem retains update because it has mutable fields (`Name`, `Sort`).

**Sponsors, partners, activities and session materials:**

| # | Action | Source | Endpoint Pattern |
|---|--------|--------|-----------------|
| 111 | Create sponsor | UC-36, BR-243 | `POST /Sponsors` |
| 112 | Update sponsor | UC-36, BR-243 | `PUT /Sponsors/{id}` |
| 113 | Delete sponsor (soft) | UC-36, BR-243 | `DELETE /Sponsors/{id}` |
| 114 | Create partner | UC-37, BR-259 | `POST /Partners` |
| 115 | Update partner | UC-37, BR-259 | `PUT /Partners/{id}` |
| 116 | Delete partner (soft) | UC-37, BR-259 | `DELETE /Partners/{id}` |
| 117 | Create activity | UC-38, BR-265 | `POST /Activities` |
| 118 | Update activity | UC-38, BR-265 | `PUT /Activities/{id}` |
| 119 | Delete activity (soft) | UC-38, BR-265 | `DELETE /Activities/{id}` |
| 120 | Manage any session's materials | UC-39, BR-116b | `/SessionAssets` writes |

**Sessionize integration:**

| # | Action | Source | Constraints |
|---|--------|--------|-------------|
| 74 | Refresh event data from Sessionize | UC-6, BR-6 | `POST /Events/{id}/refresh`; requires non-empty `SessionizeCode`; idempotent upsert (BR-7); overwrites manual edits (BR-48); syncs categories -> rooms -> questions -> speakers -> sessions |

**User and role management:**

| # | Action | Source | Constraints |
|---|--------|--------|-------------|
| 77 | List/search users | BR-51 | `GET /Users/paged` (`identity:users:read`); paginated, filterable by Email, FirstName, LastName, Role; device fields excluded for privacy |
| 78 | Delete any user account | UC-21, BR-56 | Organizer can delete any user; same data handling as self-deletion |
| 128 | View one account and its signed-in sessions | UC-43 | `GET /Admin/Users/{userId}`, `GET /Admin/Users/{userId}/sessions` |
| 129 | Lock or unlock an account | UC-43 | `POST /Admin/Users/{userId}/lock`, `/unlock`; a lock revokes live refresh sessions |
| 130 | Change an account's role | UC-43, BR-264 | `PUT /Admin/Users/{userId}/roles`; exactly one role |
| 131 | View roles, one role and the permission catalog | UC-44 | `GET /Admin/Roles`, `GET /Admin/Roles/{role}`, `GET /Admin/Roles/catalog` |
| 132 | Replace a role's stored permission grants | UC-44 | `PUT /Admin/Roles/{role}/permissions`; union with compiled grants only |

**Speaker linking:**

| # | Action | Source | Endpoint |
|---|--------|--------|----------|
| 79 | Link user to speaker | BR-209 | `PUT /Speakers/{id}/link` |
| 80 | Unlink user from speaker | BR-209 | `DELETE /Speakers/{id}/link` |

**Event lifecycle:**

| # | Action | Source | Constraints |
|---|--------|--------|-------------|
| 78b | Publish/unpublish event | BR-108 | `POST /Events/{id}/publish` or `POST /Events/{id}/unpublish` (action endpoints, no request body, conditional on `If-Match`, HTTP 204) |

**Live layer, check-in, points and selection:**

| # | Action | Source | Constraints |
|---|--------|--------|-------------|
| 121 | Run event-wide polls and list every poll of an event | UC-22, BR-236 | `POST /LivePolls` with no `SessionId`; `GET /LivePolls?eventId=` (`engagement:live:manage`) |
| 122 | Check in an attendee by badge scan | UC-40, BR-247 | `POST /CheckIns` (`engagement:checkin:manage`) |
| 123 | Check in an attendee manually | UC-40, BR-247 | `POST /CheckIns/manual` |
| 124 | View attendance rollup | UC-40 | `GET /CheckIns/stats?eventId=` |
| 125 | View points overview | UC-42 | `GET /Points/overview` (`engagement:points:view-overview`) |
| 126 | View session selection dashboard | UC-27 | `GET /SessionSelection/dashboard/{eventId}` and the three component reads |
| 127 | Queue AI session scoring | UC-27 | `POST /SessionSelection/score/{eventId}`; HTTP 202 |
| 133 | Export feedback answers as CSV | BR-8, BR-9 | `GET /EventQuestionAnswers/export`, `GET /SessionQuestionAnswers/export`; Organizer only |

#### System (Non-Human)

Actions initiated autonomously by domain event handlers after persistence:

| # | Action | Trigger Event | Side Effect |
|---|--------|--------------|-------------|
| 134 | Clear a deleted speaker's user link | `SpeakerChanged` (Deleted) | Logs the deletion and publishes `SpeakerUnlinkedFromUser` so Identity clears `User.LinkedSpeakerId` |
| 135 | Evict cached bookmark counts | `UserSessionBookmarkChanged` | Publishes `OutputCacheEvictionRequested` so Conference drops its cached bookmark counts |
| 136 | Broadcast poll tallies | `LivePollVoteChanged` | Enqueues a best-effort post-commit `poll.results-changed` broadcast (BR-229) |
| 137 | Broadcast upvote count | `SessionQuestionUpvoteChanged` | Enqueues a best-effort post-commit `question.upvote-changed` broadcast carrying only the count (BR-238) |
| 138 | Award points for a question | `SessionQuestionChanged` (Added) | Awards `QuestionAsked` points once per session (BR-250) |

Check-in and feedback points are awarded by integration-event consumers, not domain event handlers (BR-252).

#### Action Count Summary

| Actor | Explicit UCs | Implicit Actions | Total |
|-------|-------------|-----------------|-------|
| **API Consumer** | UC-2, UC-3 | 13 entity read endpoints + bookmark counts + calendar, now-next, sponsor/partner/activity and materials reads | 19 |
| **Attendee** | UC-30, UC-31, UC-32, UC-33, UC-34, UC-35, UC-4, UC-5, UC-10, UC-11, UC-21, UC-23, UC-24, UC-26, UC-40, UC-41, UC-42, UC-45, UC-46, UC-47 | + API Consumer actions + feedback update/delete + account deletion + password change + password reset | API Consumer + 38 |
| **Speaker** | UC-22, UC-25, UC-39 *(session-scoped)* | Own feedback view, profile editing, polls, moderation, materials (bookmark count views are public, already in API Consumer) | Attendee + 6 |
| **ContentEditor** | UC-8, UC-9, UC-19 (sessions, speakers), UC-36, UC-37, UC-38, UC-39 | Subset of Organizer actions listed above | Attendee + subset |
| **Organizer** | UC-6-UC-9, UC-19, UC-21, UC-22, UC-25, UC-27, UC-36-UC-44 | + Attendee actions + Conference CRUD (speaker question answer endpoints are domain-only, not exposed via REST) + user list/delete/admin + role admin + publish/unpublish + speaker link/unlink + live layer, check-in, points, selection | Attendee + 61 |
| **System** |: | Speaker unlink, cache eviction, broadcasts, question points | 5 |

---

## 5. Workflows & State Transitions

### Session Status

The `Session.Status` field is a free-text string imported from Sessionize. Default: null (for manually created sessions); a blank or whitespace status is stored as null. Known Sessionize values (`SessionStatuses`): `Accepted`, `Waitlisted`, `Accept_Queue`, `Nominated`, `Decline_Queue`, `Declined`. **No state machine is enforced**: the status is stored as-is from the external system. Only `Accepted` (compared case-insensitively) and null statuses are eligible for public display, bookmarking, and feedback. All other statuses (including unknown values) are excluded from public views and engagement actions (BR-49).

### Session Confirmation Workflow

| Field | Meaning |
|---|---|
| `IsInformed` | Speaker has been notified of their session status |
| `IsConfirmed` | Speaker has confirmed their participation |

**Note:** These are boolean flags set during Sessionize import and also carried on the organizer session create and update requests. No state-machine transition enforcement exists: they are informational fields.

### Entity Lifecycle States (DomainEntityState)

Used in domain events to indicate what happened to a child entity:

| State | Value | Meaning |
|---|---|---|
| Unchanged | 0 | No change |
| Added | 1 | Entity was created |
| Updated | 2 | Entity was modified |
| Deleted | 3 | Entity was soft-deleted |

### Event Lifecycle

```
Unpublished (default, IsPublished = false)
  → Published (IsPublished = true, visible to all users, engagement enabled)
  → Unpublished (IsPublished = false, hidden from public endpoints)
```

Unpublished events and their sessions are visible **only to privileged readers** (`Organizer` or `ContentEditor`). Publishing an event makes it and its BR-49-eligible sessions visible to all users via public endpoints.

The transitions are guarded: `Event.Publish()` on an already-published event fails with `Event.AlreadyPublished`, and `Event.Unpublish()` on an unpublished event fails with `Event.AlreadyUnpublished`. Both run through `POST /Events/{id}/publish` and `POST /Events/{id}/unpublish`, which require the `conference:events:manage` permission (Organizer only) and a mandatory `If-Match` header (428 without it, 412 on a stale token). Each successful transition raises `EventChanged` (Updated).

### Live Poll Lifecycle (BR-221)

```
Draft (default on create)
  -> Open (only from Draft, and only inside the event's live window, BR-224)
  -> Closed (only from Open; no reopen)
```

`LivePoll.Status` is the `LivePollStatus` enum (`Draft` = 0, `Open` = 1, `Closed` = 2). An out-of-order transition fails with `LivePoll.InvalidTransition`; opening outside the live window fails with `LivePoll.OutsideLiveWindow`. Votes are accepted only while the poll is `Open` and inside the live window (`LivePoll.NotOpen`, `LivePoll.OutsideLiveWindow`), and an `Open` poll cannot be deleted (`LivePoll.DeleteWhileOpen`). The open and close endpoints require `If-Match`.

### Session Question Moderation Lifecycle (BR-233, BR-234)

```
Pending or Approved (initial status = the event's question moderation default, BR-233)
  Pending   -> Approved | Dismissed
  Approved  -> Dismissed, or MarkAnswered (sets IsAnswered = true, once)
  Dismissed -> Approved (re-approve)
```

`SessionQuestion.Status` is the `QuestionStatus` enum (`Pending` = 0, `Approved` = 1, `Dismissed` = 2); a question can only be created as `Pending` or `Approved` (`SessionQuestion.InvalidInitialStatus`). Approving an approved question or dismissing a dismissed one fails with `SessionQuestion.InvalidTransition`. `MarkAnswered` is allowed only while `Approved` (`SessionQuestion.NotApproved`) and only once (`SessionQuestion.AlreadyAnswered`). Upvotes are accepted only on an `Approved` question inside the live window. The approve, dismiss and answered endpoints require `If-Match`.

---

### Soft Delete Lifecycle

All entities follow: **Active** -> (Delete action) -> **Soft-Deleted** (IsDeleted = true)

Soft-deleted records are automatically excluded from all normal queries. Reactivatable child associations (Room, EventSpeaker, SessionSpeaker, SessionCategoryItem, SpeakerCategoryItem) and bookmarks are restored in place rather than re-inserted when they are added again (BR-135).

---

## 6. Events & Side Effects

### Domain Events

Domain events are raised for entity mutations. Every aggregate uses a single `{Entity}Changed` event whose `DomainEntityState` says what happened (`Added` on create or reactivation, `Updated`, `Deleted` on soft-delete); there are no separate `{Entity}Created` events. Not all events have registered handlers: events without handlers serve as extension points for future requirements.

| Domain Event | Trigger | Carried Data | Context |
|---|---|---|---|
| **Aggregate root lifecycle events** | | | |
| `EventChanged` | Event is created, updated, published/unpublished, or soft-deleted | DomainEntityState (Added/Updated/Deleted), EventId, Name | Conference |
| `SessionChanged` | Session is created, updated, or soft-deleted | DomainEntityState (Added/Updated/Deleted), SessionId, Title, EventId | Conference |
| `SpeakerChanged` | Speaker is created, updated, linked/unlinked, anonymized, or soft-deleted | DomainEntityState (Added/Updated/Deleted), SpeakerId, FullName, PreviousLinkedUserId? (set only on Deleted: the User ID that was linked before deletion, enabling cross-context cleanup without a direct domain reference) | Conference |
| `CategoryChanged` | Category is created, updated, or soft-deleted | DomainEntityState (Added/Updated/Deleted), CategoryId, Title | Conference |
| `QuestionChanged` | Question is created, updated, or soft-deleted | DomainEntityState (Added/Updated/Deleted), QuestionId, QuestionText | Conference |
| `ActivityChanged` | Social activity is created, updated, or soft-deleted | DomainEntityState (Added/Updated/Deleted), ActivityId, Name | Conference |
| `SponsorChanged` | Sponsor is created, updated, or soft-deleted | DomainEntityState (Added/Updated/Deleted), SponsorId, Name | Conference |
| `PartnerChanged` | Partner is created, updated, or soft-deleted | DomainEntityState (Added/Updated/Deleted), PartnerId, Name | Conference |
| `SessionAssetChanged` | Session asset (file or link) is added, updated, or soft-deleted | DomainEntityState (Added/Updated/Deleted), SessionAssetId, SessionId, Title | Conference |
| `UserSessionBookmarkChanged` | Bookmark is created, reactivated, or soft-deleted | DomainEntityState (Added/Deleted), BookmarkId, UserId, SessionId | Engagement |
| `LivePollChanged` | Live poll is created, opened, closed, or soft-deleted | DomainEntityState (Added/Updated/Deleted), PollId, EventId, Status | Engagement |
| `LivePollVoteChanged` | Vote is cast, changed, reactivated, or withdrawn | DomainEntityState (Added/Updated/Deleted), VoteId, PollId, OptionId, UserId | Engagement |
| `SessionQuestionChanged` | Session question is asked, approved, dismissed, marked answered, or soft-deleted | DomainEntityState (Added/Updated/Deleted), QuestionId, SessionId, UserId, Status | Engagement |
| `SessionQuestionUpvoteChanged` | Upvote is cast, reactivated, or withdrawn | DomainEntityState (Added/Deleted), UpvoteId, QuestionId, UserId | Engagement |
| `LeaderboardOptInChanged` | Attendee opts in to (or back in to) or out of the leaderboard | DomainEntityState (Added/Deleted), LeaderboardOptInId, UserId | Engagement |
| `PointsEntryChanged` | Points are awarded (ledger is append-only, so always Added) | DomainEntityState (Added), PointsEntryId, UserId, ActivityType, Points | Engagement |
| `UserPasswordChanged` | User changes their password | UserId | Identity |
| `UserDeleted` | User account is soft-deleted (the in-process domain event; the cross-service erasure rides the separate `UserDeleted` integration event, see below) | UserId | Identity |
| **Child entity change events** | | | |
| `RoomChanged` | Room added/updated/deleted/restored on an Event | DomainEntityState, EventId, RoomId, RoomName | Conference |
| `CategoryItemChanged` | CategoryItem added/updated/deleted on a Category | DomainEntityState, CategoryId, CategoryItemId, Name | Conference |
| `EventSpeakerChanged` | EventSpeaker added/restored/deleted on an Event | DomainEntityState, EventId, EventSpeakerId, SpeakerId | Conference |
| `EventQuestionAnswerChanged` | EventQuestionAnswer added/updated/deleted on an Event | DomainEntityState, EventId, EventQuestionAnswerId, QuestionId | Conference |
| `SessionSpeakerChanged` | SessionSpeaker added/restored/deleted on a Session | DomainEntityState, SessionId, SessionSpeakerId, SpeakerId | Conference |
| `SessionCategoryItemChanged` | SessionCategoryItem added/restored/deleted on a Session | DomainEntityState, SessionId, SessionCategoryItemId, CategoryItemId | Conference |
| `SessionQuestionAnswerChanged` | SessionQuestionAnswer added/updated/deleted on a Session | DomainEntityState, SessionId, SessionQuestionAnswerId, QuestionId | Conference |
| `SpeakerCategoryItemChanged` | SpeakerCategoryItem added/restored/deleted on a Speaker | DomainEntityState, SpeakerId, SpeakerCategoryItemId, CategoryItemId | Conference |
| `SpeakerQuestionAnswerChanged` | SpeakerQuestionAnswer added/updated/deleted on a Speaker | DomainEntityState, SpeakerId, SpeakerQuestionAnswerId, QuestionId | Conference |

### Integration Events

Integration events cross service boundaries. Each is raised on the aggregate inside the same save that commits the change, captured by that service's outbox, and delivered through the message broker (at-least-once, so every consumer is idempotent).

| Integration Event | Published by | Trigger | Carried Data | Consumed by |
|---|---|---|---|---|
| `UserRegistered` (`Identity.UserRegistered.v1`) | Identity | Local registration or a first external (OAuth) login creates a user | UserId, Email, FirstName, LastName, Role, EmailVerified | Conference |
| `UserDeleted` (`Identity.UserDeleted.v1`) | Identity | A user account is deleted (soft-delete plus anonymization) | UserId, DeletedOn | Conference, Engagement |
| `SpeakerLinkedToUser` (`Conference.SpeakerLinkedToUser.v1`) | Conference | Organizer links a user to a speaker (BR-209), or the BR-207 auto-link matches | UserId, SpeakerId | Identity |
| `SpeakerUnlinkedFromUser` (`Conference.SpeakerUnlinkedFromUser.v1`) | Conference | Organizer unlinks a speaker, a linked speaker is soft-deleted (BR-70), or account erasure unlinks a speaker | UserId, SpeakerId | Identity |
| `EventFeedbackSubmitted` (`Conference.EventFeedbackSubmitted.v1`) | Conference | An attendee's event feedback answer is created (single or batch submit) | UserId, EventId, SubmittedOnUtc | Engagement |
| `SessionFeedbackSubmitted` (`Conference.SessionFeedbackSubmitted.v1`) | Conference | An attendee's session feedback answer is created (single or batch submit) | UserId, SessionId, EventId, SubmittedOnUtc | Engagement |
| `AttendeeCheckedIn` (`Engagement.AttendeeCheckedIn.v1`) | Engagement | A check-in is recorded (event, session, or sponsor-booth scope) | UserId, Scope, EventId, SessionId?, CheckedInByUserId, CheckedInOn, SponsorId? | Engagement |

### Event Handlers & Side Effects

| Trigger Event | Handler Context | Action |
|---|---|---|
| `SpeakerChanged` (Deleted) | Conference | `SpeakerDeletedHandler` logs the deletion and, when `PreviousLinkedUserId` is set, publishes `SpeakerUnlinkedFromUser` so Identity can clear the link (BR-70). |
| `SpeakerLinkedToUser` (integration event) | Identity | Sets `User.LinkedSpeakerId` on the linked user (BR-209). |
| `SpeakerUnlinkedFromUser` (integration event) | Identity | **Cross-context link cleanup:** clears `User.LinkedSpeakerId` when it still points at the unlinked speaker (BR-70). A user that no longer exists is a no-op. |
| `UserRegistered` (integration event) | Conference | **Speaker auto-link (BR-207):** links the speaker whose recorded email equals the registered email, only when `EmailVerified` is true (an external provider asserted the address); otherwise, and for name-only matches, it logs a cue for an organizer to link manually (BR-209). A successful link publishes `SpeakerLinkedToUser`. |
| `UserDeleted` (integration event) | Conference | **Cross-service erasure:** `UserDeletedSpeakerErasureHandler` anonymizes the email of every speaker linked to the erased account and unlinks it in one save (BR-56, BR-66), raising `SpeakerUnlinkedFromUser` for each; `UserDeletedFeedbackHandler` soft-deletes the account's attendee-feedback answers (questions with `QuestionSource = "User"`), overwriting any free-text value first (ratings are kept). |
| `UserDeleted` (integration event) | Engagement | **Cross-service erasure:** takes the account off the leaderboard and overwrites the name it published there (the points ledger is kept), deletes its bookmarks, live-poll votes, question upvotes and attendee badge (check-in records are kept), erases the text of its session questions, and records the account as erased so later Engagement writes from a still-valid token are refused. |
| `EventFeedbackSubmitted` / `SessionFeedbackSubmitted` (integration events) | Engagement | Awards `EventFeedback` / `SessionFeedback` points, once per event / session per attendee (the ledger's unique key collapses repeat events). |
| `AttendeeCheckedIn` (integration event) | Engagement | Awards `EventCheckIn`, `SessionCheckIn` (once per time slot) or `SponsorVisit` points; an unknown scope awards nothing. |
| `SessionQuestionChanged` (Added) | Engagement | Awards `QuestionAsked` points, once per session per attendee. |
| `LivePollVoteChanged` | Engagement | Broadcasts fresh poll tallies (`poll.results-changed`) through the Notification service, best-effort, after commit (BR-229). |
| `SessionQuestionUpvoteChanged` | Engagement | Broadcasts the fresh upvote count (`question.upvote-changed`) through the Notification service, best-effort, after commit (BR-238). |
| `UserSessionBookmarkChanged` | Engagement | Signals a paced output-cache eviction request to the Conference service so cached session reads stop serving a stale bookmark count. |

> **Note:** The remaining domain events (including `EventChanged`, `RoomChanged`, `UserPasswordChanged`, `SpeakerQuestionAnswerChanged`, and others) are defined but have no handlers: they exist as extension points and will gain handlers when concrete requirements emerge (e.g., real-time notifications, audit logging, analytics).

### Dispatch Mechanism

Domain events are raised during entity mutations and dispatched in process after changes are persisted; inside a transactional command, dispatch is deferred until the commit succeeds and dropped on rollback. Domain events never leave their service. Anything another service must learn about travels as an integration event through the outbox and the message broker.

---

## 7. Business Constraints & Invariants

### Data Integrity

| Constraint | Description |
|---|---|
| Soft delete exclusion | All queries automatically exclude soft-deleted records (IsDeleted = true) |
| Required fields | Event.Name, Event.StartDate, Event.EndDate, Event.TimeZone, Session.Title, Speaker.FirstName, Speaker.LastName, Room.Name, Category.Title, CategoryItem.Name, Question.QuestionText, Question.QuestionEntity (BR-15), Question.QuestionSource, EventQuestionAnswer.AnswerValue, SessionQuestionAnswer.AnswerValue, SpeakerQuestionAnswer.AnswerValue, User.Email, User.PasswordHash, User.PasswordSalt, User.FirstName, User.LastName |
| Unique aggregate child | A child entity can only be updated/deleted if it exists in the aggregate's collection (by ID match) |
| Parent-child integrity | Child entity's parent ID must match the aggregate root ID when performing operations through the aggregate |
| Cascade restrictions | Cross-aggregate relationships do not cascade deletes: deleting a parent does not automatically delete records in other aggregates (SessionSpeaker, SessionCategoryItem, SpeakerCategoryItem, EventQuestionAnswer) |
| Cross-context soft-delete (Session) | Soft-deleting a Session cascade soft-deletes all owned children (SessionSpeakers, SessionQuestionAnswers, SessionCategoryItems) per BR-55. Engagement records (bookmarks) referencing the session are not cascade-deleted. |
| Cross-context soft-delete (Event) | Soft-deleting an Event cascade soft-deletes all Sessions belonging to that Event (and their children) per BR-127, plus the event's Sponsors, Partners, Activities and Session Assets, then the Event and its owned children (BR-72). The first child aggregate that fails to delete aborts the whole cascade, so the event is never half-deleted. |
| Soft-delete (User) | Soft-deletes the User record per BR-56. The cross-service `UserDeleted` consumers erase the account's data in Conference (linked speaker email and link, attendee-feedback answers) and Engagement (leaderboard entry, bookmarks, poll votes, question upvotes, session question text, badge), and Engagement records the account as erased so later writes from it are refused. |

### Cross-Entity Constraints

| Constraint | Description |
|---|---|
| Room → Event | A room must belong to exactly one event |
| Session → Event | A session must belong to exactly one event. `Session.EventId` is immutable after creation (BR-140). |
| Session → Room | A session may optionally be assigned to a room |
| EventSpeaker uniqueness | Only one active EventSpeaker record per (EventId, SpeakerId) pair: the aggregate rejects a duplicate (`Event.Speaker.Duplicate`) and a unique index backs it; a soft-deleted association is restored rather than re-added (BR-135) |
| SpeakerCategoryItem uniqueness | Only one active record per (SpeakerId, CategoryItemId) pair: rejected as `Speaker.CategoryItem.Duplicate`, backed by a unique index; a soft-deleted association is restored (BR-135) |
| SessionSpeaker uniqueness | Only one active SessionSpeaker record per (SessionId, SpeakerId) pair: rejected as `Session.Speaker.Duplicate`, backed by a unique index; a soft-deleted association is restored (BR-135) |
| SessionCategoryItem uniqueness | Only one active SessionCategoryItem record per (SessionId, CategoryItemId) pair: rejected as `Session.CategoryItem.Duplicate`, backed by a unique index; a soft-deleted association is restored (BR-135) |
| Feedback ownership | Question answers record `CreatedBy` and are filtered by it for read access. Attendees can only update/delete their own answers (BR-52). Organizers can update/delete any answer for moderation (BR-53). |
| Feedback FK validation | EventQuestionAnswer.QuestionId must reference a Question with `QuestionEntity = "Event"`. SessionQuestionAnswer.QuestionId must reference a Question with `QuestionEntity = "Session"`. SpeakerQuestionAnswer.QuestionId must reference a Question with `QuestionEntity = "Speaker"`. Mismatches are rejected (BR-128). |
| Bookmark uniqueness | Only one active UserSessionBookmark per (UserId, SessionId) pair. Re-bookmarking after soft-delete reactivates the existing record (BR-135). |
| Bookmark session status | Bookmarks can only be created for sessions with `Accepted` or null status. All other statuses (`Waitlisted`, `Accept_Queue`, `Nominated`, `Decline_Queue`, `Declined`, and unknown values) are ineligible for bookmarking (BR-49). The Engagement service checks eligibility through the Conference `ValidateSessionForBookmark` gRPC call. Existing bookmarks are retained when a session's status changes to a non-eligible value (BR-139). |
| Bookmark denormalization avoidance | UserSessionBookmark does not store EventId: it stores only UserId and SessionId, and the event is resolved through Conference when needed |
| Engagement aggregate independence | Engagement entities (bookmarks, live polls, poll votes, session questions, upvotes, check-ins, badges, leaderboard opt-ins, points entries) are standalone aggregate roots (a LivePoll owns its LivePollOptions): they reference User, Event and Session by scalar ID only, in a separate database, and are not managed through those aggregates, preventing write contention |
| Engagement pagination & filtering | Engagement list endpoints support pagination (BR-11 cap) and filtering: bookmarks by `EventId` through the Conference `GetSessionIdsByEvent` gRPC lookup, then an `IN` filter on SessionId (BR-58) |
| Service session restrictions | Service sessions (`IsServiceSession = true`) cannot be bookmarked or receive feedback (BR-91) |
| Event visibility | Unpublished events are visible only to privileged readers (`Organizer` or `ContentEditor`); published events are visible to all (BR-108). Visibility cascades to sessions: sessions belonging to unpublished events are excluded from public query results (consistent with Section 5 Event Lifecycle). Child entities within the Event aggregate (Rooms, EventSpeakers, EventQuestionAnswers) follow the same visibility as their parent event (BR-132). |
| Session visibility | Sessions belonging to unpublished events are excluded from public list endpoints (GET /Sessions). A session can be retrieved by ID only if its parent event is published or the requester is a privileged reader (`Organizer` or `ContentEditor`). Status gates the same paths: sessions whose `Status` is neither null nor `Accepted` (BR-49 is an allow-list, so `Waitlisted`, `Accept_Queue`, `Nominated`, `Decline_Queue`, `Declined`, and any unknown value are all excluded) are absent from public list and paged results and 404 on detail-by-id for non-privileged callers. The `/Sessions/lookup` endpoint and the junction read endpoints (SessionSpeakers, SessionCategoryItems) apply the identical filter. See BR-49, BR-132. |
| Speaker visibility | A speaker is publicly visible only with at least one visible session (BR-49 eligible) in the scoped event set: the selected event on event-scoped reads, all published events otherwise (BR-239; `EventSpeaker` rows grant no visibility, since the Sessionize sync creates one per imported speaker). Hidden speakers are excluded from list, paged, `/Speakers/lookup`, and junction responses (SessionSpeakers, EventSpeakers, SpeakerCategoryItems), and detail-by-id returns HTTP 404 for non-privileged callers, except the linked speaker reading their own profile (BR-214 carve-out; the response bypasses output-cache storage). Privileged readers see every speaker. `/Speakers/lookup` additionally restricts `nameProperty` to `FirstName` or `LastName` for non-privileged callers, so the lookup label cannot be used to read around the BR-66 email redaction. |
| EventQuestionAnswer uniqueness | Only one answer per (CreatedBy, QuestionId, EventId): subsequent submissions overwrite the existing answer (BR-123). |
| SessionQuestionAnswer uniqueness | Only one answer per (CreatedBy, QuestionId, SessionId): subsequent submissions overwrite the existing answer (BR-123). |
| SpeakerQuestionAnswer uniqueness | Only one answer per (CreatedBy, QuestionId, SpeakerId): subsequent submissions overwrite the existing answer (BR-123). |
| CategoryItem name uniqueness | CategoryItem.Name must be unique within its parent Category (case-insensitive) (BR-138). |
| Room name uniqueness | Room.Name must be unique within its parent Event (case-insensitive), among active rooms; a soft-deleted room's name may be reused (BR-255). |
| Question field immutability | Question.QuestionType and Question.QuestionEntity cannot be changed after answers exist (BR-137). |
| Speaker-User linking | 1:1 bidirectional relationship via `User.LinkedSpeakerId` and `Speaker.LinkedUserId`, each backed by a unique index; linking an already-linked speaker fails (`Speaker.AlreadyLinked`). Cleared on speaker soft-delete (BR-70) and on erasure of the linked account. The Identity side follows the Conference side through the `SpeakerLinkedToUser` / `SpeakerUnlinkedFromUser` integration events, so it is eventually consistent. |

### Temporal Constraints

| Constraint | Description |
|---|---|
| JWT expiry | Access tokens expire 15 minutes after issuance; refresh tokens expire after 7 days |
| DateRange validity | End date must be >= start date |
| DateTimeRange validity | End datetime must be >= start datetime |
| Event date range | Event.StartDate must be <= Event.EndDate (enforced by DateRange value object) (BR-86) |
| Time zone awareness | All server-side time comparisons use the event's configured IANA time zone (BR-87) |
| Session duration validity | When both StartsAt and EndsAt are non-null, EndsAt must be strictly greater than StartsAt: zero-duration sessions are invalid (BR-122) |
| Concurrency model | Optimistic concurrency on the ten Conference write controllers that carry `[SupportsIfMatch]`: `If-Match` is mandatory there (428 without it, 412 on a stale token). The Engagement state transitions carry the same contract: live poll open/close and session question approve/dismiss/answered. Last-write-wins everywhere else. See BR-129 for rationale. |

---

## 8. External Integrations (Business Perspective)

### Sessionize

| Aspect | Detail |
|---|---|
| **Purpose** | Import conference schedule, speakers, rooms, and category data from the Sessionize event management platform |
| **Trigger** | Manual API call: `POST /Events/{id}/refresh` (requires the `conference:events:manage` permission, which only Organizer holds). Throttled to once per 5 minutes per event (BR-63): a throttled request, or one that loses the race to a concurrent refresh, answers 429 with `Retry-After`; an unreachable Sessionize API answers 502. |
| **Data received** | One call to the public Sessionize `view/All` endpoint returns Categories, CategoryItems, Rooms, Speakers (with category assignments, bio, tagline, profile picture URL, social links mapped to TwitterHandle, LinkedInUrl, GitHubUrl and WebsiteUrl, the `IsTopSpeaker` flag, and CFP question answers), Sessions (with speaker and category assignments, room, start/end times, `Status`, `IsInformed`, `IsConfirmed`, `IsServiceSession` flag, `IsPlenumSession` flag, `LiveUrl`, `RecordingUrl`, and CFP question answers), Questions (with `QuestionSource = "Sessionize"`). The endpoint carries no speaker email, so imported speakers have a null `Email`. Social links enable attendees to follow/connect with speakers. |
| **Sync behavior** | Idempotent upsert: new records are created, existing records (by ID) are updated, and removed associations that reappear are reactivated (BR-135). Sessionize is the source of truth: refresh overwrites the fields it supplies on matched entities, replacing manual edits (BR-48), except that a speaker's `Email` and any social link the feed does not carry keep the value entered in ADC. Soft-deleted entities are skipped (BR-136) and reported as a warning. The import runs in one transaction, so it is all-or-nothing. User-generated data (feedback, bookmarks) is never modified. |
| **Identifier** | Event's `SessionizeCode` field (e.g., "kqf8l42a"); refresh fails when the event has none (BR-6) |
| **Scope** | Categories and speakers are synced globally; rooms, event-speakers, sessions, and their associations are scoped to the specific event |

### Image Hosting

| Aspect | Detail |
|---|---|
| **Purpose** | Clarify how profile pictures, venue maps, and other images are handled |
| **Model** | Image fields (`Speaker.ProfilePicture`, `Event.VenueMapUrl`, `Sponsor.LogoUrl`, `Partner.LogoUrl`) store **externally hosted URLs**. The system DOES provide a managed file upload service (blob storage) for two surfaces only: user avatars (BR-116a, ADR-045) and session materials (BR-116b, ADR-123). Neither of those paths touches the image fields above. Deleting an avatar or a session file schedules the blob delete as an internal command, so the delete is retried until storage answers. |
| **Speaker images** | Imported from Sessionize during refresh. Sessionize hosts speaker profile pictures and provides URLs. |
| **Venue maps** | Organizers provide a URL to an externally hosted map or floor plan image. |
| **Sponsor and partner logos** | Organizers or content editors provide a URL to an externally hosted logo. |

### Other External Services

| Service | Business purpose |
|---|---|
| **Email (SMTP)** | Sends the email-confirmation message (send-only: sign-in does not wait for confirmation) and password-reset messages from the Identity service. |
| **External sign-in providers** | Google, GitHub and Sign in with Apple, each enabled by its configured client id. A provider that asserts the email as verified confirms the account, and that flag gates the BR-207 speaker auto-link. |
| **Real-time and native push** | The Notification service hosts the SignalR hub that carries live poll tallies, question upvote counts and organizer push notifications to connected clients; native mobile push goes through Azure Notification Hubs and is a no-op unless configured (ADR-044). |
| **AI session scoring** | Organizer-triggered scoring of an event's sessions (decision support) calls a hosted large language model through the framework's governed chat client, one paid call per session; contact details are redacted from the prompt, the trigger answers 202 and the scoring runs as an internal command. Disabled when no model is configured. |

---

## 9. Glossary

| Term | Definition |
|---|---|
| **Event** | A conference event (e.g., "Atlanta Developers Conference 2025") spanning one or more days, with a configured time zone |
| **Session** | A talk, workshop, or presentation within an event, delivered by one or more speakers in a specific room and time slot |
| **Speaker** | A person presenting one or more sessions at an event |
| **Room** | A physical or virtual space within an event venue where sessions take place, with optional capacity and wayfinding information (floor, location) |
| **Category** | A classification dimension for organizing sessions and speakers (e.g., "Track", "Level", "Format") |
| **Category Item** | A specific value within a category (e.g., "Beginner" within the "Level" category) |
| **EventSpeaker** | An association indicating that a speaker is participating in a specific event |
| **SessionSpeaker** | An association indicating that a speaker is presenting a specific session |
| **SessionCategoryItem** | A tag/classification applied to a session (e.g., session is tagged as "Intermediate" level) |
| **SpeakerCategoryItem** | A tag/classification applied to a speaker (e.g., speaker specializes in ".NET") |
| **Question** | A survey/feedback prompt shown to attendees, targeting an event, a session, or a speaker |
| **EventQuestionAnswer** | An attendee's response to an event-level survey question |
| **SessionQuestionAnswer** | An attendee's response to a session-level survey question |
| **Sessionize** | A third-party platform for managing conference call-for-papers, speaker submissions, and scheduling |
| **Soft Delete** | A deletion strategy where records are flagged as deleted but not physically removed from the database |
| **Aggregate Root** | A DDD pattern entity that controls access to and consistency of its child entities |
| **Domain Event** | A notification that something meaningful happened in the domain, dispatched after persistence |
| **Specification** | A query-object pattern that encapsulates filtering criteria for entity retrieval |
| **UserSessionBookmark** | A record indicating that an attendee plans to attend a specific session: forms their personal schedule |
| **Organizer** | A conference administrator who manages master schedule data (events, sessions, speakers, rooms, categories). Identified by the `Organizer` value in the `User.Role` field. |
| **Attendee Role** | The default user role assigned at registration. Grants access to engagement features (bookmarks, feedback) but not conference data management. |
| **Content Editor** | A user with `Role = ContentEditor`: holds content-management permissions and counts as a privileged reader, but is not an Organizer for the Organizer-gated write rules. ADC has no `Admin` role. |
| **Privileged Reader** | The read audience exempt from the public visibility filters: a user whose role is `Organizer` or `ContentEditor`. Privileged readers see unpublished events (BR-108), sessions outside the BR-49 allow-list, and speakers that are not publicly visible (BR-239), on list, by-id, lookup, and junction endpoints alike. The same role set bypasses the public output cache. |
| **Service Session** | A non-talk entry on the schedule (e.g., lunch break, registration, networking). Displayed on the schedule but excluded from engagement features (bookmarking, feedback). Identified by `IsServiceSession = true`. Keynotes are typically not service sessions. |
| **IANA Time Zone** | A time zone identifier from the IANA Time Zone Database (e.g., "America/New_York"). Used on the Event entity to ensure correct time comparisons for time-gated features. |
| **Event Status** | Whether an event is published (visible to all users, engagement enabled) or unpublished (visible only to privileged readers, default). Controlled by `Event.IsPublished`. |
| **SpeakerQuestionAnswer** | An attendee's response to a speaker-level survey question. Managed as a child entity of the Speaker aggregate. |
| **Plenum Session** | A plenary or all-hands session where all attendees gather together (e.g., opening keynote, closing ceremony). Identified by `IsPlenumSession = true`. Distinguished from breakout sessions for display purposes. |
| **Top Speaker** | A featured or highlighted speaker (e.g., keynote speaker). Identified by `IsTopSpeaker = true`. Used for display purposes to highlight prominent speakers. |
| **Question Source** | The origin of a survey question: "Sessionize" (imported during refresh) or "User" (created manually by an organizer). Tracks provenance for Sessionize source-of-truth handling. |
| **Accessibility Info** | Optional free-text descriptions of accessibility features for rooms (e.g., wheelchair access, hearing loop) and sessions (e.g., live captioning, sign language interpreter). Informational only. |
| **Activity** | A social activity attached to an event, with a start and end time and optional venue details. |
| **Sponsor** | A conference sponsor or exhibitor attached to an event, with a `SponsorTier` (`Platinum`, `Gold`, `Silver`, `Community`) and, for exhibitors, a booth number. |
| **Partner** | A supporting organization attached to an event, typed as `Community` or `Special` (e.g., the venue host). |
| **Session Asset** | Session material: either a file uploaded to the conference blob store or a link to material hosted elsewhere (`SessionAssetKind` `File` or `Link`). |
| **Live Poll** | A poll with a fixed set of options, attached to an event and optionally a session, that accepts votes only while open and inside the event's live window; moves `Draft` -> `Open` -> `Closed`. |
| **Session Question** | An attendee question asked during a session, moderated through `Pending`, `Approved` and `Dismissed`, upvoted by other attendees, and optionally marked answered. |
| **Check-In** | A record that an attendee arrived at the event, attended a session, or visited a sponsor booth (`CheckInScope` `Event`, `Session`, `Sponsor`). |
| **Points and Leaderboard** | Attendees earn points (check-ins, feedback, questions asked, sponsor visits), each awarded at most once per subject; attendees who opt in appear on the leaderboard under a display name they choose. |

---

## DDD Structural Summary

### Bounded Contexts

| Context | Responsibility | Aggregate Roots | Non-Root Entities |
|---|---|---|---|
| **Conference** | Master schedule data, sponsors, partners, social activities, session materials, feedback answers, and AI session scores. Organizer- and content-editor-managed. Sessionize import target. Low write frequency. | Event, Session, Speaker, Category, Question, Activity, Sponsor, Partner, SessionAsset, SessionAiScore | Room, CategoryItem, EventSpeaker, SessionSpeaker, EventQuestionAnswer, SessionQuestionAnswer, SessionCategoryItem, SpeakerCategoryItem, SpeakerQuestionAnswer |
| **Engagement** | Attendee-generated activity and the conference-day live layer. High-write during events. Implemented as a standalone module (`Source/Modules/Engagement/`). | UserSessionBookmark, LivePoll, LivePollVote, SessionQuestion, SessionQuestionUpvote, CheckIn, AttendeeBadge, LeaderboardOptIn, PointsEntry, ErasedUser | LivePollOption |
| **Identity** | Identity, authentication, and authorization (role- and permission-based), including external sign-in and user administration. | User | *(none)* |
| **Notification** | Real-time and push delivery: the SignalR hub, native push, organizer push broadcasts and their send history. A thin module (API and Application projects only); its persisted entities come from the framework's notification feature. | UserNotification, PushNotification (framework-provided) | *(none)* |

### Modules, Services and Contracts

Each module runs as its own service host (`Source/Services/MMCA.ADC.{Module}.Service`) with its own database (`ADC_Identity`, `ADC_Conference`, `ADC_Engagement`, `ADC_Notification`) and its own outbox. A YARP Gateway (`Source/Hosts/MMCA.ADC.Gateway`) is the single entry point for the Blazor web and MAUI clients. Services call each other synchronously through gRPC contracts (the `.proto` files and adapters in `Source/Services/MMCA.ADC.{Module}.Contracts`) and asynchronously through integration events (Section 6). Cross-module references are scalar ID columns, never cross-database foreign keys.

| Service | gRPC services it serves | Main callers |
|---|---|---|
| **Conference** | `EventLiveValidationService` (event, session, sponsor and room live info; overlapping sessions), `SessionBookmarkValidationService` (bookmark eligibility, session IDs by event), `UserConferenceExportService` (data-subject export) | Engagement, Identity (export) |
| **Engagement** | `BookmarkCountService` (bookmark counts per session), `UserEngagementExportService` (data-subject export) | Conference, Identity (export) |
| **Identity** | `AttendeeQueryService` (attendee user IDs) | Notification |
| **Notification** | `LiveChannelPushService` (push a message to a live channel), `UserNotificationExportService` (data-subject export) | Engagement, Identity (export) |

### Aggregate Boundaries

| Aggregate Root | Context | Owned Children | Why These Children |
|---|---|---|---|
| **Event** | Conference | Room, EventSpeaker, EventQuestionAnswer | Structural parts of "what makes up an event": venue rooms, speaker lineup, and event-level feedback. Organizer-managed, low-write. |
| **Session** | Conference | SessionSpeaker, SessionQuestionAnswer, SessionCategoryItem | Structural parts of "what defines a session": who presents it, how it's tagged, and session-level feedback. Organizer-managed (speakers/tags) or burst-write (feedback). |
| **Speaker** | Conference | SpeakerCategoryItem, SpeakerQuestionAnswer | Category tags and feedback are part of the speaker's profile definition. |
| **Category** | Conference | CategoryItem | Items are the values within a category: they have no independent lifecycle. |
| **Question** | Conference | *(none)* | Template entity. Answers are children of Event/Session, not of Question. |
| **Activity** | Conference | *(none)* | Event-scoped social activity with its own lifecycle. |
| **Sponsor** | Conference | *(none)* | Event-scoped sponsor or exhibitor with its own lifecycle. |
| **Partner** | Conference | *(none)* | Event-scoped supporting organization with its own lifecycle. |
| **SessionAsset** | Conference | *(none)* | Session material (file or link) managed by the session's own speakers or by holders of the `conference:session-assets:manage` permission. |
| **SessionAiScore** | Conference | *(none)* | One AI decision-support score per session, written by the scoring internal command. |
| **UserSessionBookmark** | Engagement | *(none)* | Standalone preference record. |
| **LivePoll** | Engagement | LivePollOption | The options are the values of the poll and have no independent lifecycle. |
| **LivePollVote** | Engagement | *(none)* | One vote per (poll, user), standalone so concurrent votes do not contend on the poll. |
| **SessionQuestion** | Engagement | *(none)* | Attendee question with its own moderation lifecycle. |
| **SessionQuestionUpvote** | Engagement | *(none)* | One upvote per (question, user), standalone for the same contention reason as votes. |
| **CheckIn** | Engagement | *(none)* | Attendance record (event, session, or sponsor booth). |
| **AttendeeBadge** | Engagement | *(none)* | One per-user badge credential. |
| **LeaderboardOptIn** | Engagement | *(none)* | One active opt-in per user, carrying the published display name. |
| **PointsEntry** | Engagement | *(none)* | Append-only ledger row, unique per (user, activity, subject). |
| **ErasedUser** | Engagement | *(none)* | Record of an erased account, checked by Engagement write handlers. |
| **User** | Identity | *(none)* | Pure identity. Attendee-generated content is in Engagement. |

### Cross-Aggregate References

| Entity | References (not ownership) | Crosses Context Boundary? | Cascade on Delete? |
|---|---|---|---|
| **Speaker** | -> User (Identity, optional: LinkedUserId, 1:1 bidirectional with User.LinkedSpeakerId; see Section 12.4) | **Yes: Conference -> Identity** | No cascade. `Speaker.LinkedUserId` is cleared in Conference on speaker soft-delete (BR-70) and on erasure of the linked account. |
| **User** | -> Speaker (Conference, optional: LinkedSpeakerId, 1:1 bidirectional with Speaker.LinkedUserId; see Section 12.4) | **Yes: Identity -> Conference** | No cascade. `User.LinkedSpeakerId` is set and cleared by Identity's handlers for the `SpeakerLinkedToUser` / `SpeakerUnlinkedFromUser` integration events (BR-70, BR-209); the speaker soft-delete path publishes the unlink from the `SpeakerChanged` (Deleted) domain event handler. |
| **Session** | → Event (Conference, required), → Room (Conference, optional: note: Room is a child of Event, not an aggregate root; this is a pragmatic cross-aggregate reference to a child entity, acceptable because Room has a stable identity via Sessionize-assigned ID per BR-61. **Validation:** BR-130 requires `Room.EventId == Session.EventId`, the Session service reads the Room to enforce this cross-aggregate constraint during create/update.) | No: within Conference, but crosses aggregate boundaries | Session cascade soft-deleted when parent Event is deleted (BR-127). Room reference is not cascade-affected. |
| **UserSessionBookmark** | → User (Identity), → Session (Conference) | Yes: Engagement → Identity, Engagement → Conference | No cascade from Session deletion: bookmarks are retained but excluded from queries (BR-55). User deletion soft-deletes the account's bookmarks through the `UserDeleted` integration event (BR-56). |
| **Activity, Sponsor, Partner, SessionAsset** | -> Event (Conference, required); SessionAsset also -> Session | No: within Conference | Cascade soft-deleted when the parent Event is deleted. Session assets are also soft-deleted with their Session, and the blob behind an uploaded file is deleted by a scheduled internal command. |
| **LivePoll, SessionQuestion** | -> Event (Conference); -> Session (Conference, optional for LivePoll); SessionQuestion also -> User (Identity) | Yes: Engagement -> Conference, Engagement -> Identity | No cascade from Conference deletions. A SessionQuestion's text is erased and the row soft-deleted when its author's account is deleted. |
| **LivePollVote, SessionQuestionUpvote, CheckIn, AttendeeBadge, LeaderboardOptIn, PointsEntry** | -> User (Identity); plus poll, question, event, session or sponsor IDs as applicable | Yes: Engagement -> Identity, Engagement -> Conference | No cascade from Conference deletions. On account deletion votes, upvotes, the badge and the leaderboard opt-in are removed; check-ins and the points ledger are kept. |
| **EventQuestionAnswer** | → Event (owner, Conference), → Question (Conference) | No: within Conference | Cascade soft-deleted with parent Event (BR-72). Question deletion does not cascade (BR-73). |
| **SessionQuestionAnswer** | → Session (owner, Conference), → Question (Conference) | No: within Conference | Cascade soft-deleted with parent Session (BR-55). Question deletion does not cascade (BR-73). |
| **EventSpeaker** | → Event (owner, Conference), → Speaker (Conference) | No: within Conference | Cascade soft-deleted with parent Event (BR-72). Speaker deletion does not cascade (BR-70). |
| **SessionSpeaker** | → Session (owner, Conference), → Speaker (Conference) | No: within Conference | Cascade soft-deleted with parent Session (BR-55). Speaker deletion does not cascade (BR-70). |
| **SessionCategoryItem** | → Session (owner, Conference), → CategoryItem (Conference) | No: within Conference | Cascade soft-deleted with parent Session (BR-55). Category/CategoryItem deletion does not cascade (BR-71). |
| **SpeakerCategoryItem** | → Speaker (owner, Conference), → CategoryItem (Conference) | No: within Conference | No cascade from either side (BR-70, BR-71). |
| **SpeakerQuestionAnswer** | → Speaker (owner, Conference), → Question (Conference) | No: within Conference | No cascade from Speaker deletion (BR-70). Question deletion does not cascade (BR-73). |
| **Room** | → Event (owner, Conference) | No: within Conference | Cascade soft-deleted with parent Event (BR-72). |

### Design Decisions & Rationale

**Why three bounded contexts instead of two:**

An Events + Identity split would group all conference-related entities together regardless of write profile. Separating Engagement provides:

| Concern | Conference entities | Engagement entities |
|---|---|---|
| **Write frequency** | Low: imported from Sessionize, edited by organizers | Higher: attendees writing during sessions |
| **Write actors** | Organizers, Sessionize sync | Attendees |
| **Time sensitivity** | Updated hours/days before the event | Updated in real-time during the event |
| **Consistency model** | Strong consistency (aggregate invariants matter) | Eventual consistency acceptable |

The primary benefit is **conceptual separation**: organizer-managed master data vs. attendee-generated activity: which keeps each module focused. The contention argument is secondary: Engagement aggregate roots are standalone (no parent to contend on), so the throughput benefit is about clean module boundaries rather than aggregate-level lock contention.

A fourth module, **Notification**, holds no conference domain of its own: it delivers real-time and push messages for the other three and stores only the framework's notification records. Each of the four runs as its own service with its own database (see Modules, Services and Contracts above).

**Why Engagement entities are standalone aggregate roots (not children of User or Session):**

Child entity management through a parent aggregate loads the parent, performs the child action, then saves. This is correct for structural children (Room belongs to Event) where the parent enforces invariants. But for Engagement entities:

1. **No parent invariant to enforce.** "A user can only bookmark a session once" is a uniqueness constraint, not an aggregate invariant requiring the User or Session to validate.
2. **Write contention.** If 200 users bookmark the same session simultaneously, routing through the Session aggregate serializes all 200 writes through a single row.
3. **Nested children unsupported.** The single-level child entity management pattern does not support multi-level nesting.

**Why EventQuestionAnswer and SessionQuestionAnswer remain in Conference as children of their aggregates:**

This is a deliberate trade-off with known contention risk. Feedback writes are routed through the parent aggregate (Event or Session), meaning concurrent submissions load and save the parent.

The contention risk is real but bounded at the expected scale:

- **Session feedback** submissions tend to concentrate in the period after each session ends, producing a **burst** of 20-100 submissions in the first few minutes: not a gradual trickle. For a conference with a few hundred attendees, this burst is manageable: individual requests take milliseconds, and the database handles this concurrency without degradation.
- **Event feedback** is spread across the event's duration: minimal contention.
- The implementation must add child rows without locking or replacing the parent's entire child collection. Child entity additions should be **append-only inserts** keyed to the parent, not load-modify-save-all cycles.
- With last-write-wins semantics (BR-129), there is no risk of optimistic concurrency failures: only of two writes to the same unique key racing, which the upsert logic (BR-123) handles.

**Feedback entities are the primary candidate for extraction to the Engagement context** if attendee volume exceeds ~200 concurrent writers per session. EventQuestionAnswer, SessionQuestionAnswer, and SpeakerQuestionAnswer match the Engagement write profile on every dimension (attendee-generated, high-write during live events, real-time during sessions, eventual consistency acceptable): the same rationale that justified separating UserSessionBookmark. They remain in Conference for v1 because the contention is bounded at current scale and the aggregate ownership simplifies transactional consistency. Extraction requires moving entities to standalone aggregate roots and adjusting DI: the domain model and API contract do not change.

**Cross-aggregate validation for feedback submission (known hotspot):**

Submitting a `SessionQuestionAnswer` (a child of the Session aggregate) requires validating state from three aggregates: (1) **Session**: exists, is not a service session (BR-91), status is Accepted or null (BR-49); (2) **Event**: is published (BR-108); (3) **Question**: exists, correct `QuestionEntity` (BR-128), `QuestionType` for answer validation (BR-124). `EventQuestionAnswer` similarly validates across Event and Question. `SpeakerQuestionAnswer` validates across Speaker and Question. This cross-aggregate read-on-write is intentional: the business rules genuinely require this validation and it cannot be decomposed further. The feedback services therefore depend on Event and Question read repositories in addition to their owning aggregate's repository. This is not accidental coupling; it is documented here so future developers understand why these service-layer dependencies exist and do not attempt to remove them in the name of aggregate isolation.

**Why UserSessionBookmark does not store EventId:**

A bookmark needs only UserId and SessionId. The Event is derivable from `Session.EventId`. Denormalizing EventId onto the bookmark is unnecessary because `Session.EventId` is immutable (BR-140): there is no inconsistency risk. Bookmarks and sessions live in different databases, so a query that filters bookmarks by event first asks Conference for the event's session IDs (`GetSessionIdsByEvent` over gRPC) and then filters bookmarks by those IDs: this is a read-path concern, not a domain model concern.

**Why bookmarks use soft-delete instead of hard-delete:**

UserSessionBookmark follows the universal soft-delete pattern (BR-1) despite bookmarks having no historical reporting value. The rationale: (1) Consistency: every entity in the system uses soft-delete, eliminating special-case logic in the repository layer and keeping architecture tests simple. (2) Recovery: if a user accidentally removes a bookmark, the soft-deleted record could be restored (though no restore endpoint exists today). (3) Analytics: soft-deleted bookmarks provide engagement data (e.g., "how many users bookmarked then un-bookmarked this session"). The cost is minimal: soft-deleted bookmarks are excluded from queries and consume negligible storage.

**Domain event dispatch:**

Domain events are raised during entity mutations (e.g., adding a room to an event raises `RoomChanged`) and dispatched in process after changes are persisted. Every domain event is produced and consumed inside its own service; no domain event handler crosses a context boundary. Cross-context effects travel as integration events through each service's outbox and the message broker instead: for example, the Conference handler for `SpeakerChanged` (Deleted) publishes `SpeakerUnlinkedFromUser`, and Identity's consumer clears the speaker-user link (BR-70). This replaces a direct cross-context write with an event-driven approach to maintain bounded context isolation, at the cost of eventual consistency. See Section 6 for the full list of domain events, integration events, and their handlers.

**Why Session is an aggregate root but cascade-deleted by Event (BR-127):**

Session is an aggregate root because it independently owns children (SessionSpeakers, SessionQuestionAnswers, SessionCategoryItems) and is the target of cross-context references (UserSessionBookmark). It has its own lifecycle for scheduling, feedback, and bookmarking. However, when an Event is soft-deleted, orphaning its Sessions would create inconsistency: sessions with no parent event are meaningless. BR-127 introduces a pragmatic cross-aggregate cascade: Event deletion cascades to Sessions. This violates the strict DDD principle that aggregate roots are only deleted through their own boundary, but the alternative (requiring organizers to manually delete every session before deleting an event) is operationally impractical. The cascade is implemented at the service layer (not database-level), so domain events and child cascades (BR-55) fire correctly.

**Why Organizers can submit feedback:** Organizers inherit all Attendee capabilities, including feedback submission. This is intentional: conference organizers typically attend sessions. The Organizer role grants write access to all Conference entities, making it impossible to define "their" sessions vs. others'. Feedback is scoped to the authenticated user (BR-8, BR-9).

**How role-based authorization works:**

The system has three user roles: `Attendee` (default), `ContentEditor`, and `Organizer`, stored on the User entity. There is no `Admin` role in ADC. At login (UC-31), the role is included as a `role` claim in the JWT. Write endpoints are gated by permissions (`[HasPermission]`), and each service maps roles to permissions server-side: Organizer holds every Conference permission, ContentEditor holds the content-management subset. Authorization is enforced at five levels:

| Level | Who | Endpoints | Enforcement |
|---|---|---|---|
| **Public** | Anyone (no auth) | Read Conference entities (events, sessions, speakers, rooms, categories), filtered to publicly visible records (BR-49, BR-108, BR-239) | No authentication required |
| **Authenticated** | Any logged-in user (Attendee, ContentEditor, or Organizer) | Engagement writes (bookmarks, live-poll votes, session questions and upvotes, self-recorded room check-ins and sponsor visits, leaderboard opt-in), feedback answers, user claims | Valid JWT required |
| **Privileged reader** | Users with `Role = Organizer` **or** `Role = ContentEditor` | Unfiltered Conference reads: unpublished events, non-accepted sessions, non-visible speakers, and the unfiltered lookup and junction endpoints | Membership in the privileged-reader role set; the same set is the output-cache bypass list, so a privileged reader never gets a public-filtered cached response |
| **Content editor** | Users with `Role = ContentEditor` (and Organizer) | Content-management writes: sessions, speakers, categories, sponsors, partners, activities, session assets | The matching `conference:*:manage` permission |
| **Organizer** | Users with `Role = Organizer` | Everything above plus event CRUD, Sessionize refresh, publish/unpublish, rooms, questions, session selection (AI scoring), speaker-user linking, live-layer management, staff check-in, points overview, push notifications, user management | `conference:events:manage`, `conference:rooms:manage`, `conference:questions:manage`, `conference:session-selection:manage`, `conference:speakers:link`, the `engagement:*` permissions, the notification manage permission and `users:manage`, held by Organizer only |

A user linked to a speaker (BR-209) additionally carries a `speaker_id` claim that unlocks raw session feedback, live-poll management and question moderation; this is a claim on the account, not a fourth role.

The Organizer role is the system's administrator role. Organizers manage all conference master data. Initial organizer accounts are created via database seeding (BR-45). `ContentEditor` carries content-management permissions and reads content as an Organizer does, but it is **not** a write-equivalent: the Organizer-gated write rules (BR-41, BR-51, BR-53, BR-108 publish/unpublish) still say Organizer and mean it.

Read gating and write gating are therefore two different questions in this spec: where a rule concerns **who can see** unpublished or non-accepted content, the answer is the privileged reader set (Organizer or ContentEditor); where it concerns **who can change** it, the answer is the permission that guards that write: Organizer alone for event structure and publication, rooms, questions, session selection and speaker linking, and Organizer or ContentEditor for the content-management set (sessions, speakers, categories, sponsors, partners, activities, session assets).

This design keeps the User entity simple (a single `Role` field rather than a many-to-many role table) because the conference domain has few authorization tiers. If more granular roles were needed in the future (e.g., separate "Volunteer" or "Sponsor" roles), the field could be migrated to a role collection.

**Why per-question feedback submission with POST-as-upsert:**

Feedback answers are submitted individually via `POST` on EventQuestionAnswer and SessionQuestionAnswer endpoints, or as a whole form via `POST .../batch`, which upserts every answer in one transaction so a refusal leaves nothing written. Unlike other entities where `POST` is create-only, feedback `POST` performs an **upsert**: it creates a new answer or overwrites an existing one for the same (CreatedBy, QuestionId, EntityId) key (BR-107, BR-123). This is a deliberate deviation from pure CRUD semantics that simplifies the client: attendees don't need to check whether they've already answered a question before submitting. The `Question.IsRequired` flag is advisory: clients should enforce it in the UI but the server does not validate completeness across all questions.

---

## 10. Specification Clarifications & Addenda

This section addresses gaps, ambiguities, and implicit design decisions identified during implementation review. New business rules are numbered BR-61+. API contract specifications are documented separately from business rules.

---

### 10.1 Sessionize Integration Clarifications

#### Entity ID Strategy (clarifies UC-6, BR-7)

The domain model does not explain how entities imported from Sessionize are matched to local records during upsert. The resolution:

Sessionize assigns stable IDs to each entity type: integers for Categories, CategoryItems, Rooms, Questions, and Sessions; GUIDs for Speakers. During import, the system uses these Sessionize-assigned IDs as the **local primary key**. Each sync step bulk-loads the existing rows for the feed's IDs in one query (`GetByIdsAsync`, with the soft-delete query filter off so a soft-deleted match is found, see BR-136); a match is updated and a miss is created.

| # | Rule |
|---|---|
| BR-61 | Entity IDs for Sessionize-imported entities (Category, CategoryItem, Room, Speaker, Session, Question) are assigned by Sessionize and stored as the local primary key. **Room, Speaker, Session and Question** use `ValueGeneratedNever`: the database never generates their IDs. Organizer-created Rooms, Sessions and Questions (manual CRUD) receive IDs from a reserved range (999,999,000-999,999,999) auto-allocated by the create handler to avoid collisions with Sessionize-assigned IDs, and the Sessionize refresh skips (with a warning) any feed Room or Question whose ID falls in that range; an organizer-created Speaker receives a new GUID. **Category and CategoryItem** are identity columns (`ValueGeneratedOnAdd`, so an organizer-created one gets a database-generated ID), and the Sessionize refresh inserts their Sessionize-assigned IDs explicitly (SQL Server `IDENTITY_INSERT`). Entities that are never Sessionize-imported (Event, EventSpeaker, SessionSpeaker, SessionCategoryItem, SpeakerCategoryItem, EventQuestionAnswer, SessionQuestionAnswer, SpeakerQuestionAnswer, SessionAiScore, Sponsor, Partner, Activity, User, and all Engagement entities) use database-auto-generated IDs (`ValueGeneratedOnAdd`); SessionAsset uses a GUID key. |

#### Removal Handling (clarifies BR-7)

BR-7 covers add and update but is silent on what happens when an entity exists locally but is absent from the Sessionize response (e.g., a speaker withdraws or a session is dropped).

| # | Rule |
|---|---|
| BR-62 | Sessionize refresh performs **additive sync only**: it creates new entities and updates existing ones but **never soft-deletes** entities absent from the Sessionize response. Entities removed from Sessionize remain active locally until an organizer manually soft-deletes them. This prevents data loss when Sessionize returns partial data due to API pagination, filtering, or transient errors. **Detection, not deletion:** the refresh response carries one warning naming every live imported session of the event that the response no longer contains (the first 10 by title and id, then a count of the rest), so the organizer can delete the ones that were removed or unscheduled in Sessionize. Sessions in the reserved organizer-created id band (`SessionInvariants.ManualIdRangeStart`..`ManualIdRangeEnd`) never come from Sessionize and are not reported. |

#### Refresh Throttling

No constraint exists on how frequently an organizer can trigger a Sessionize refresh, risking excessive external API calls.

| # | Rule |
|---|---|
| BR-63 | Sessionize refresh (`POST /Events/{id}/refresh`) is throttled to **once per 5 minutes per event**. Subsequent requests within the cooldown window return HTTP 429 with a fixed `Retry-After: 300` header (the full window, not the seconds remaining). The refresh stamp is committed before the Sessionize call, so a refresh that fails after that point (Sessionize unavailable) still starts the five-minute window. This prevents excessive load on the Sessionize API and redundant processing. **Concurrency:** the cooldown read is a check-then-act, so two requests arriving together could both pass it; the refresh claims the event's concurrency token, and the request that loses that race returns the same throttled answer rather than issuing a second Sessionize call. No distributed lock is involved. |

---

### 10.4 Speaker.Email Clarifications (clarifies Speaker entity)

The Speaker entity includes an `Email` property (entered in ADC by an organizer; the Sessionize import never sets it), but uniqueness and visibility are not specified.

| # | Rule |
|---|---|
| BR-66 | `Speaker.Email` is optional (the Sessionize import creates speakers without one) and **not unique**: though duplicates would be unusual. Speaker email is returned **only to Organizer callers**: for every other caller (anonymous, Attendee, Speaker) the read endpoints (GET /Speakers) return `Email` as null, together with `LinkedUserId`, because email is PII: it is not information attendees need. Social links (BR-99) are public because speakers intentionally share them for professional networking. Email is **not** under the Sessionize source-of-truth rule (BR-48): a refresh keeps the stored value when it updates a speaker. **Redaction covers the lookup label too:** `/Speakers/lookup` restricts `nameProperty` to `FirstName` or `LastName` for non-privileged callers, so `nameProperty=Email` cannot be used to project the address the read DTO withholds (see Section 11.7). **Clarification (2026-10-19):** `Speaker.Email` is marked `[Pii]`, so the audit trail stores it redacted, and `Speaker` is `IAnonymizable`: when the linked user account is erased (BR-56) the email is replaced with the placeholder `deleted-{SpeakerId}@anonymized.invalid`, while the name, biography and the rest of the public profile are kept as event program content. The Sessionize sync never writes an email, so a re-sync cannot restore the address. |

---

### 10.6 Rate Limiting Scope (clarifies BR-20)

BR-20 says 100 requests per minute "per client" without defining what "client" means.

| # | Rule |
|---|---|
| BR-68 | Rate limiting runs at two layers. **At the Gateway (edge)**, every request counts against a fixed window of **120 requests per minute per client IP address**, chained with a replica-wide ceiling of 200 concurrent requests; health, `/alive`, `/.well-known` and the real-time `/hubs` paths are exempt, and `POST /Auth/login` and `POST /Auth/register` additionally take a tighter **30 requests per minute per client IP** policy. **At each service**, the global limiter allows **300 requests per minute per authenticated user** (partitioned by the user-id claim, falling back to the name claim, then the client IP); unauthenticated requests are not limited there except on the real-time hub paths, which are metered per client IP, and login/register again carry the 30-per-minute per-IP policy. Every 429 carries a `Retry-After` header when the limiter supplies one. The Sessionize refresh endpoint (UC-6) counts against the organizer's authenticated limit and is additionally subject to its own per-event throttle (BR-63). |

---

### 10.8 Cascade Soft-Delete Behavior

BR-55 covers Session soft-delete and BR-56 covers User soft-delete, but the spec is silent on cascade behavior for Speaker, Category, Event, and Question soft-deletes.

| # | Rule |
|---|---|
| BR-70 | Soft-deleting a **Speaker** soft-deletes the Speaker record only. Associated `EventSpeaker`, `SessionSpeaker`, and `SpeakerCategoryItem` records are **not cascade-deleted**: they remain active but reference a soft-deleted speaker. **Query filtering for dangling references:** Top-level read endpoints for join entities (`GET /Eventspeakers`, `GET /SessionSpeakers`, `GET /SpeakerCategoryItems`) must filter results to exclude records where the referenced Speaker is soft-deleted, in addition to the standard `IsDeleted` filter on the join entity itself. Similarly, `includeChildren` responses for Event and Session aggregates exclude join entity records referencing soft-deleted speakers. This prevents consumers from receiving join records that point to unfetchable (soft-deleted) speakers. **Speaker-user link cleanup (via domain event):** If the speaker is linked to a User (via `LinkedUserId`/`LinkedSpeakerId`), `Speaker.LinkedUserId` is cleared within the Conference context during the soft-delete operation. After persistence, the `SpeakerChanged` domain event (with DomainEntityState.Deleted, carrying the previous linked user id) is dispatched to a Conference handler, which publishes the `SpeakerUnlinkedFromUser` integration event; a handler in the **Identity context** consumes it and clears `User.LinkedSpeakerId` when it still points at that speaker. This is an eventually-consistent cross-context operation over the outbox and broker rather than a direct cross-context write, maintaining bounded context isolation (see Section 6 Event Handlers). The eventual consistency window is negligible in practice: the user's current JWT retains the stale `speaker_id` claim until expiry (BR-12) regardless of when the User record is updated, and speaker-specific endpoints return HTTP 404 for the soft-deleted speaker immediately. The `speaker_id` claim will be absent from the user's next JWT issued at login or token refresh. |
| BR-71 | Soft-deleting a **Category** soft-deletes the Category record **and cascade soft-deletes all child CategoryItems**. Associated `SessionCategoryItem` and `SpeakerCategoryItem` records referencing deleted items are **not cascade-deleted**: they remain active but reference soft-deleted items. These orphaned references are excluded from display because soft-deleted CategoryItems are filtered from queries. **Sessionize refresh interaction:** a soft-deleted Category is subject to BR-136: Sessionize refresh skips it as a whole (its items are not visited) rather than reactivating it, and an individually soft-deleted CategoryItem is skipped the same way. No restore endpoint exists, so deleting an imported Category suppresses it and all of its items from every later refresh. |
| BR-72 | Soft-deleting an **Event** soft-deletes the Event record **and cascade soft-deletes all owned child entities** (Rooms, EventSpeakers, EventQuestionAnswers), **all Sessions belonging to the event** (which in turn cascade soft-delete their owned children per BR-55, see BR-127), and the event's **Sponsors, Partners, Activities and SessionAssets**, all in one transaction. The blob behind every deleted file asset is scheduled for removal inside that same transaction, so a committed delete always carries the instruction to remove the public file. **Note:** This cascade includes EventQuestionAnswers (attendee feedback), which will be hidden from queries. Unlike Question soft-delete (BR-73, which preserves answers), Event soft-delete prioritizes data consistency: an event's children are meaningless without the parent. Organizers should export feedback data before soft-deleting an event if historical reporting is needed. |
| BR-73 | Soft-deleting a **Question** soft-deletes the Question record only. Existing `EventQuestionAnswer`, `SessionQuestionAnswer`, and `SpeakerQuestionAnswer` records referencing the question are **not cascade-deleted**: they retain their answer data for historical reporting. The soft-deleted question no longer appears in survey lists for new feedback submission. |

**Cascade rationale summary:**

| Entity Deleted | Cascade Behavior | Rationale |
|---|---|---|
| **Event** | Cascade to Rooms, EventSpeakers, EventQuestionAnswers, Sessions (and Session children), Sponsors, Partners, Activities, SessionAssets | Event is the top-level container. Its children have no meaning without it. Sessions and the other event-rooted aggregates reference Event by FK and would be orphaned. |
| **Session** | Cascade to SessionSpeakers, SessionQuestionAnswers, SessionCategoryItems | Session owns these children. They have no independent lifecycle. |
| **Category** | Cascade to CategoryItems | Items are values within a category. No independent meaning. |
| **Speaker** | No cascade | Speaker associations (EventSpeaker, SessionSpeaker, SpeakerCategoryItem) are cross-aggregate references. Cascade-deleting them could silently remove data an organizer expects to persist. The soft-deleted speaker is filtered from displays by query filters. |
| **Question** | No cascade | Existing answers (event, session, speaker) retain historical value. The soft-deleted question is hidden from new survey forms. |
| **User** | Erasure via the `UserDeleted` integration event | Each module erases what it holds for the account, since the Identity-side erasure cannot reach the other databases: bookmarks, live-poll votes, question upvotes and the attendee badge are soft-deleted; session questions and attendee feedback answers are soft-deleted with any free text overwritten first; the leaderboard entry is withdrawn and its published name overwritten; a linked Speaker's email is anonymized (BR-66). Check-in records are kept. |

---

### 10.9 Question Scoping (clarifies Question entity)

Questions have no `EventId`, they are global. The spec does not address whether different events can have different survey questions.

| # | Rule |
|---|---|
| BR-74 | Questions are **global survey templates** not scoped to a specific event. All events, sessions, and speakers share the same question pool, filtered by `QuestionEntity` ("Event", "Session", or "Speaker"). This is sufficient for the current single-event-per-year conference model. If event-specific surveys are needed in the future, a `QuestionEvent` join entity can associate specific questions with specific events without changing the Question entity itself. **Note:** The same global-scope consideration applies to Categories (IR-5). Categories and Questions are both event-independent: acceptable when all events share a single Sessionize source or manual configuration, but a **data corruption risk** if multiple concurrent events import from independent Sessionize instances (category IDs could collide and overwrite each other per BR-48/BR-61). If the system evolves to support multiple concurrent events with independent Sessionize sources, both Categories and Questions should be evaluated for event-scoping. |

---

### 10.10 includeChildren Depth (clarifies UC-2, UC-3)

The spec mentions `includeChildren=true` but does not define depth or scope per entity type.

| # | Rule |
|---|---|
| BR-80 | The `includeChildren=true` query parameter loads **one level** of owned child entity collections. Children are not recursively loaded. Cross-aggregate navigation uses `includeFKs=true` or explicit filtering. Engagement entities are never included via this mechanism. |

**Children per entity type:**

| Entity | Children included |
|---|---|
| Event | Rooms, EventSpeakers |
| Session | SessionSpeakers, SessionCategoryItems |
| Speaker | SpeakerCategoryItems, SpeakerQuestionAnswers |
| Category | CategoryItems |
| Question | *(none: EventQuestionAnswers and SessionQuestionAnswers are cross-aggregate references, loaded via their own endpoints)* |

**Example:** `GET /Events/{id}?includeChildren=true` returns the event with its rooms and event-speakers. It does **not** include the event's sessions (which are a separate aggregate, queried via `GET /Sessions?filters[EventId].eq={id}`).

**Feedback is never carried by `includeChildren`:** EventQuestionAnswers (on Event) and SessionQuestionAnswers (on Session) are deliberately not navigation collections, because they grow with attendance, the public reads never render them, and they are per-attendee data behind otherwise anonymous endpoints. They are read only through their own authenticated endpoints, which scope rows by the requester's role: **Attendees** see only their own answers (`CreatedBy` matches authenticated user) and **Organizers** see all answers. This is consistent with BR-8 and BR-9.

---

### 10.14 Email Question Type Clarification (clarifies BR-50)

`QuestionType: Email` "collects contact information" but its purpose is unclear.

| # | Rule |
|---|---|
| BR-81 | `QuestionType: Email` collects attendee contact information for **opt-in follow-up**. Email-type question responses are visible to organizers via the standard EventQuestionAnswer/SessionQuestionAnswer endpoints. The `AnswerValue` for Email-type questions must be a valid email address as .NET `MailAddress` parses it (no rule beyond that parse is applied, so a domain without a `.` is accepted). Invalid format is rejected with HTTP 400 (error code `Answer.Email.Invalid`). |

---

### 10.16 Time-Gated HTTP Status Correction

HTTP 403 ("Forbidden") should not be used for temporal constraint violations: those are client errors (bad request timing), not authorization failures.

| # | Rule |
|---|---|
| BR-83 | Time-gated endpoint rejections return **HTTP 400 Bad Request** with a descriptive ProblemDetails message, not HTTP 403. The server-side time gate on session feedback is the schedule check of BR-16: a session with no `StartsAt` or no `EndsAt` refuses feedback (error code `Session.NotScheduled`, "This action is not available until the session is scheduled."); the server does not compare the submission time against the session's end. HTTP 403 is reserved for authorization failures (insufficient role or ownership). |

---

### 10.17 Sort Tie-Breaking

Entity `Sort` fields (on Room, CategoryItem, Category, Question) have no specified behavior for ties.

| # | Rule |
|---|---|
| BR-85 | Paged reads sort by the requested column and then by `Id` ascending, a server-supplied final key that makes the order total so paging never repeats or skips a row. There is no name step between them: rows sharing a `Sort` value come back in `Id` order. Public UI lists that present curated content (sponsors, for example) order by `Sort` and then name on the client. |

---

### 10.19 Speaker.FullName Implementation

The Speaker entity includes `FullName` described as "Computed: {FirstName} {LastName}" without specifying the implementation.

`Speaker.FullName` is a **read-only computed property**: a C# property getter (`$"{FirstName} {LastName}"`), not a database column. It is serialized into DTOs and available for display. Because it has no database column, it cannot be used in database-level filtering or sorting. Clients that need to filter or sort by name should use `FirstName` or `LastName`.

---

### 10.20 Session DateTime Storage Format (clarifies Session entity, BR-87)

The spec states session times are "interpreted in the event's time zone" but does not specify the storage format.

`Session.StartsAt` and `Session.EndsAt` are stored as `DateTime` values representing **local time in the event's configured time zone**. They are not stored as UTC or `DateTimeOffset`. For server-side time comparisons (the Now/Next snapshot, the live room-session lookup, the calendar export), each session's wall-clock values are converted to UTC through the event's `TimeZoneInfo` (a wall-clock time inside a spring-forward gap is shifted ahead one hour) and compared against the current UTC instant. This approach avoids timezone conversion complexity in queries and is appropriate because all sessions within an event share a single time zone (BR-87). The `TimeZone` field on Event is authoritative for interpreting these values.

---

### 10.21 Bookmark Reactivation After Soft-Delete (clarifies BR-21, BR-1)

BR-21 enforces bookmark uniqueness per (UserId, SessionId), and BR-1 requires soft delete. But the spec does not address what happens when a user re-bookmarks a session they previously un-bookmarked (soft-deleted).

| # | Rule |
|---|---|
| BR-135 | **Bookmark reactivation:** The uniqueness check for bookmarks (BR-21) considers only active (non-deleted) records for conflict detection. When a user bookmarks a session for which a soft-deleted bookmark exists, the existing record is **reactivated** (`IsDeleted` set to false, `LastModifiedOn`/`LastModifiedBy` updated) rather than creating a new record. This prevents unbounded growth of soft-deleted bookmark records from repeated bookmark/un-bookmark cycles. The join entities with uniqueness constraints (EventSpeaker, SessionSpeaker, SessionCategoryItem, SpeakerCategoryItem) also enforce uniqueness over active rows only (filtered unique indexes). For them, reactivation is applied by the **Sessionize refresh**: an association the feed still lists whose local row is soft-deleted is reactivated in place. A manual add through the API does not reactivate: it creates a new active row beside the soft-deleted one. |

---

### 10.22 Sessionize Refresh and Soft-Deleted Entities (clarifies BR-7, BR-48)

The spec does not define what happens when a Sessionize refresh includes an entity that has been locally soft-deleted.

| # | Rule |
|---|---|
| BR-136 | **Sessionize refresh skips soft-deleted entities.** During a Sessionize refresh (UC-6), if a Category, CategoryItem, Question, Speaker or Session in the Sessionize response matches a locally soft-deleted record (by ID), the soft-deleted record is **not reactivated or updated**: the organizer's delete decision takes precedence over Sessionize data. Skipped entities are counted in a `skippedSoftDeleted` field in the refresh response, and one aggregate entry is added to the response `warnings` list (e.g., "Skipped 2 soft-deleted entities present in Sessionize response (BR-136)."). Two kinds of record are exempt and **are** reactivated: a soft-deleted **Room** the feed still lists is restored with the feed's name and sort (its organizer-entered capacity, floor, location and accessibility info are kept), and a soft-deleted join association (EventSpeaker, SessionSpeaker, SessionCategoryItem, SpeakerCategoryItem) is reactivated in place (BR-135). No restore endpoint exists for the skipped kinds, so a soft-deleted imported Category, Question, Speaker or Session stays out of every later refresh. **Rationale:** Sessionize is the source of truth for *field content* (BR-48), but entity lifecycle (active vs. deleted) is an organizer decision. Automatically reactivating soft-deleted entities would be surprising: an organizer who deliberately removed a declined speaker would see them reappear on the next refresh. |

---

### 10.23 QuestionType and QuestionEntity Immutability (clarifies Question entity, BR-50, BR-15)

The spec does not address what happens when a Question's `QuestionType` or `QuestionEntity` is changed after answers have been submitted.

| # | Rule |
|---|---|
| BR-137 | **Question.QuestionType and Question.QuestionEntity are immutable after answers exist.** Once any EventQuestionAnswer, SessionQuestionAnswer, or SpeakerQuestionAnswer references a Question, the Question's `QuestionType` and `QuestionEntity` fields cannot be changed via `PUT`. Attempts to change either field on a Question with existing answers return HTTP 400 (error code `Question.ImmutableAfterAnswers`) with detail "QuestionType and QuestionEntity cannot be changed after answers have been submitted." To change the question type or target entity, soft-delete the existing Question and create a new one. **Rationale:** Changing a Rating question to Text (or vice versa) would make existing answers semantically invalid: a numeric "4" becomes meaningless as free text, and free text cannot be interpreted as a rating. Changing `QuestionEntity` from `"Event"` to `"Session"` or `"Speaker"` (or vice versa) would make existing answers reference a question targeting the wrong entity type, silently breaking the FK validation invariant (BR-128). Other Question fields (`QuestionText`, `Sort`, `IsRequired`) remain mutable. |

---

### 10.24 CategoryItem Name Uniqueness (clarifies CategoryItem entity, BR-19)

The spec defines CategoryItem.Name as required (BR-19) but does not specify uniqueness within a Category.

| # | Rule |
|---|---|
| BR-138 | **CategoryItem.Name must be unique within its parent Category** (case-insensitive, compared after trimming, among active items only: a soft-deleted item does not block its name). Two active CategoryItems in the same Category cannot have the same Name; a violation returns HTTP 409 (error code `CategoryItem.Name.Duplicate`). This is enforced during both manual creation/update and Sessionize import. During Sessionize import, items are matched by their Sessionize-assigned ID (BR-61), not by name: so name uniqueness violations from Sessionize are unlikely, but a refused item is skipped, reported in the refresh response `warnings` list and not counted as synced, without blocking the rest of the import. |

---

### 10.24a Question ID Allocation for User-Created Questions (clarifies BR-61)

BR-61 states that Question IDs use `ValueGeneratedNever`, they are explicitly assigned, not database-auto-generated. Sessionize-imported questions receive their Sessionize-assigned ID. But the spec does not address how IDs are allocated for manually created questions (via `POST /Questions`).

| # | Rule |
|---|---|
| BR-141 | **User-created questions use a reserved ID range** (999,999,000-999,999,999) to avoid collisions with Sessionize-assigned IDs. The `CreateQuestionHandler` auto-allocates the next ID within this range (one above the highest ID already in the range, soft-deleted questions included): any caller-provided ID is ignored, and a create that loses the computed ID to a concurrent create recomputes and retries. If the range is exhausted (1,000 manual questions), the create operation fails with HTTP 400 (error code `Question.ManualIdRangeExhausted`). A Sessionize question whose ID falls inside the range is skipped by the refresh with a warning. This partition ensures that manual CRUD and Sessionize import never produce ID conflicts, regardless of the order in which questions are created. The same reserved range and allocation apply to organizer-created Sessions and Rooms (BR-61). |

---

### 10.25 Engagement Context Implementation (clarifies DDD Structural Summary)

The DDD Structural Summary defines three bounded contexts (Conference, Engagement, Identity). The Engagement context is implemented as a **standalone module** at `Source/Modules/Engagement/`.

> **Implementation note:** The Engagement bounded context is implemented as a dedicated module (`MMCA.ADC.Engagement.*` projects) with its own Domain, Application, Infrastructure, API, Shared, and UI layers, and it runs as its own service host (`MMCA.ADC.Engagement.Service`) with its own database. Its aggregates are session bookmarks (`UserSessionBookmark`), check-ins (`CheckIn`) and attendee badges (`AttendeeBadge`), live polls (`LivePoll`, with options and votes), session Q and A (`SessionQuestion`, with upvotes), the points ledger (`PointsEntry`, `LeaderboardOptIn`), and the `ErasedUser` record that blocks writes from an erased account.

---

### 10.26 Logout/Revoke Endpoint (clarifies BR-216)

BR-216 describes logout behavior but no use case or endpoint is specified.

**Endpoint:** `POST /auth/revoke`

**Authentication:** Required

**Request body:** None.

**Main Flow:**

1. System revokes **every** live refresh session of the authenticated user (the request carries no body, so it cannot name the calling device: it signs the user out everywhere).
2. For web clients: this endpoint does not touch cookies. The web host clears its HttpOnly auth cookies through its own same-origin `DELETE /auth/session-cookie` endpoint at logout.
3. For MAUI clients: no server-side action is needed beyond token revocation: the client clears stored credentials from SecureStorage locally.
4. Returns HTTP 204 No Content.

**Per-device sign-out:** `GET /auth/my-sessions` lists the caller's live sessions (newest first, with the current device flagged), and `POST /auth/revoke/{sessionId}` revokes one of them, answering 204, or 404 for a session that is not the caller's, does not exist, or is already revoked.

**Response codes:**
- HTTP 204: sessions revoked successfully (returns 204 even if no live refresh session exists). The endpoint is excluded from idempotency replay, so every call reaches the session store.
- HTTP 401: not authenticated

**Note:** Access tokens cannot be server-side invalidated before expiry (BR-216). After logout, the access token remains valid until its 15-minute TTL (`Jwt:AccessTokenExpirationMinutes`) expires. For security-critical scenarios (account compromise), the soft-deleted user JWT check (BR-133) provides a fallback: soft-deleting the account immediately blocks all requests.

---

### 10.27 Existing Bookmarks on Session Status Change (clarifies BR-49, BR-21)

BR-49 prevents creating bookmarks for sessions with non-eligible statuses, but does not address existing bookmarks when a session's status changes after bookmarking.

| # | Rule |
|---|---|
| BR-139 | **Existing bookmarks are retained when a session's status changes to a non-eligible value (e.g., Declined, Waitlisted).** Active bookmarks for the session are not automatically soft-deleted. The personal schedule endpoint (`GET /Bookmarks`) includes these bookmarks. Its DTO carries only the bookmark's `Id`, `UserId`, `SessionId` and `CreatedOn` (no session fields), so the session's current `Status` comes from the session read endpoints: clients should display these bookmarks with appropriate visual treatment (e.g., strikethrough, status badge). Attendees can manually remove the bookmark. **Rationale:** Automatically deleting bookmarks on status change would silently alter attendees' personal schedules without their knowledge. Retaining them with visible status information lets attendees decide how to adjust their plans. The same principle applies to sessions that become service sessions (`IsServiceSession` changed to true): existing bookmarks are retained with updated session metadata. |

---

### 10.28 Session.EventId Immutability (clarifies Session entity)

The spec does not address whether a Session's `EventId` can be changed after creation.

| # | Rule |
|---|---|
| BR-140 | **Session.EventId is immutable after creation.** A session's parent event cannot be changed via `PUT`. Attempts to update a session with a different `EventId` than its current value return HTTP 422 with detail "Session cannot be moved between events." To reassign a session to a different event, soft-delete it and create a new session on the target event. **Rationale:** Changing `EventId` has cascading implications: room cross-event validation (BR-130), event visibility for feedback (BR-108), date range alignment (BR-86), and engagement data (bookmarks, feedback) that reference the session would need revalidation. Immutability avoids these complexities. Sessionize imports always create sessions within the correct event scope. |

---

### 10.29 SpeakerQuestionAnswer API Gap (implementation status)

The domain model supports `SpeakerQuestionAnswer` as a child entity of the Speaker aggregate (with `AddSpeakerQuestionAnswer`, `UpdateSpeakerQuestionAnswer`, `RemoveSpeakerQuestionAnswer` methods). BR-107 mentions SpeakerQuestionAnswer alongside EventQuestionAnswer and SessionQuestionAnswer as a feedback submission mechanism.

However, **no `SpeakerQuestionAnswersController` exists**: SpeakerQuestionAnswer CRUD is not exposed via REST API. Speaker question answers are populated only through Sessionize import (UC-6, which imports speaker survey responses from Sessionize), and they are readable as the `SpeakerQuestionAnswers` child collection of a speaker read with `includeChildren=true` (see 10.10). Manual speaker feedback submission by attendees is not available. An existing speaker answer still counts toward the BR-137 immutability check on its Question.

**Impact:** Actor-Action Matrix items 73a-73c (speaker question answer management) describe domain-layer capabilities that are not yet exposed as API endpoints. Attendees cannot submit speaker-level feedback through the API. This is a known gap: the domain is ready, but the API controller has not been implemented.

**To implement:** Create a `SpeakerQuestionAnswersController` following the same pattern as `EventQuestionAnswersController` and `SessionQuestionAnswersController`. The controller should use `RequireAuthenticated` authorization (matching the feedback pattern), apply user-scoping for reads (attendees see own answers only), and enforce BR-128 (`QuestionEntity = "Speaker"`) and BR-124 (answer validation) on submission.

---

### 10.30 Points Award Rules (clarifies BR-251, BR-252)

BR-251 states that award values are configuration and that 0 disables a rule, without listing the rules
themselves. These are the activities the ledger recognizes, their shipped default values, and the subject
each is keyed by. The subject column is the anti-farming granularity from BR-250: one award per user per
row of this table per subject, forever.

| Activity | Default | Awarded once per | Raised by |
|---|---|---|---|
| Event check-in | 25 | Event | `AttendeeCheckedIn`, event scope (outbox) |
| Session check-in | 10 | Session, and once per time slot | `AttendeeCheckedIn`, session scope (outbox) |
| Sponsor visit | 20 | Sponsor | `AttendeeCheckedIn`, sponsor scope (outbox) |
| Session feedback | 15 | Session | `SessionFeedbackSubmitted`, answer-create only (outbox) |
| Event feedback | 15 | Event | `EventFeedbackSubmitted`, answer-create only (outbox) |
| Question asked | 5 | Session | Session-question domain event, creation only (in-module, at-most-once) |

The leaderboard size (default **10**) lives in the same configuration section. Note the asymmetry in the
"awarded once per" column: feedback and question-asked are keyed by the **session or event**, not by the
answer or the question, so submitting a five-question feedback form earns the feedback award once and
asking a second question in the same room earns nothing further. Session check-in carries one extra
limit: a session check-in that follows an overlapping check-in to another session of the same event
earns nothing, so one time slot earns the session award once (when Conference does not know the
session the slot rule cannot apply and the award stands). The sponsor-visit award is capped once per
sponsor because the booth deep link an attendee scans is shareable.

---

## 11. API Contract Specifications

This section documents API design decisions that apply across all endpoints.

---

### 11.1 Error Response Format

All error responses use the **RFC 9457 ProblemDetails** format (the successor to RFC 7807, same structure).

**Result failures** (the common case: request validation, business rules, not found, conflicts, ownership) are mapped by the shared base controller. Every one carries the title `"Operation failed"`, the detail `"One or more errors occurred."`, and an `errors` array with one entry per domain error (`code`, `message`, `type`, `source`, `target`). The HTTP status is that of the **most severe** error type present, never simply the first one (500 > 401 > 403 > 429 > 409 > 404 > 422 > 400):

```json
{
  "title": "Operation failed",
  "status": 409,
  "detail": "One or more errors occurred.",
  "errors": [
    {
      "code": "UserSessionBookmark.Duplicate",
      "message": "A bookmark for this session already exists.",
      "type": "Conflict",
      "source": "CreateBookmarkHandler",
      "target": "SessionId"
    }
  ]
}
```

A FluentValidation failure arrives the same way: one `errors` entry of type `Validation` per failed rule, with the offending property name in `target`, answered **HTTP 400** (not 422). The `message` is localized at the edge from the stable `code`.

| HTTP Status | Condition | Title |
|---|---|---|
| 400 Bad Request | Request validation failure, business rule violation (`Validation`, `Invariant` or `Failure` error), including a time-gated feature that is unavailable (BR-83) | `"Operation failed"` |
| 400 Bad Request | A `DomainException` thrown rather than returned | `"Domain Exception"` (detail is the exception message) |
| 401 Unauthorized | Missing or invalid JWT: the bearer handler's challenge | *(none: bearer challenge)* |
| 401 Unauthorized | `Unauthorized` domain error, e.g. invalid credentials, or registration abuse prevention (BR-213, code `Auth.RegistrationRateLimitExceeded`) | `"Operation failed"` |
| 403 Forbidden | Missing permission or role, or entity ownership | *(none)* for an attribute or `Forbid()` refusal; `"Operation failed"` for a `Forbidden` domain error |
| 404 Not Found | Entity does not exist or is soft-deleted | `"Operation failed"` |
| 409 Conflict | Duplicate operation (bookmark) or other `Conflict` domain error | `"Operation failed"` |
| 409 Conflict | Unhandled database update failure (concurrency or unique-constraint) | `"Database Update Exception"` |
| 412 / 428 | Conditional update with a stale `If-Match` (412) or without one (428) | ProblemDetails from the `If-Match` filter |
| 422 Unprocessable Entity | `UnprocessableEntity` domain error (a semantically rejected request, e.g. an immutable field change) | `"Operation failed"` |
| 429 Too Many Requests | Sessionize refresh throttle (BR-63, with `Retry-After: 300`), login brute-force protection (BR-212, code `Auth.TooManyAttempts`), or a rate limiter rejecting the request (BR-20/BR-68: the per-user service limiter, the `auth-ip` endpoint limiter, or the Gateway edge limiter), each limiter rejection carrying a `Retry-After` header | `"Operation failed"` for a domain error |
| 502 Bad Gateway | External service (Sessionize API) unreachable: timeout, HTTP 5xx, or DNS failure (UC-6) | Detail: `"Sessionize API is unavailable. Try again later."` |
| 499 Client Closed Request | Client disconnected before the response completed. The cancellation is logged at `Warning` level; the client is gone, so nobody reads the response | `"Operation Canceled Exception"` |
| 500 Internal Server Error | Unhandled exception | `"Internal Server Error"` |

**Environment behavior:** The exception handlers behave identically in every environment. A `DomainException` carries its own message as the detail; an unhandled exception answers the generic detail `"An error occurred while processing your request. Please try again"` with no exception message or stack trace, which go to the server log only. Every ProblemDetails written by an exception handler also carries a `requestId` extension (the request's trace identifier) for correlating a support request with the log.

---

### 11.2 Pagination Response Contract (clarifies BR-11, BR-18)

Each entity controller serves its paginated read at `GET /{Entities}/paged` (with `pageNumber` and `pageSize` parameters); the unpaged `GET /{Entities}` returns a plain `{ "items": [ ... ] }` collection capped at the maximum page size below, and `GET /{Entities}/export` streams the same filtered set as CSV. The paged endpoint returns:

**Response body**: `PagedCollectionResult<T>`:

```json
{
  "items": [ ... ],
  "paginationMetadata": {
    "totalItemCount": 47,
    "pageSize": 10,
    "currentPage": 2,
    "totalPageCount": 5,
    "firstRowOnPage": 11,
    "lastRowOnPage": 20
  }
}
```

**Response header**: `X-Pagination` contains the same `PaginationMetadata` object serialized as JSON, for clients that prefer reading metadata from headers.

**Defaults and constraints:**
- Default `pageSize`: 10
- Maximum `pageSize`: 500 (BR-11; values above 500 are silently capped)
- Page numbering is 1-based (`pageNumber` minimum: 1)
- `TotalPageCount`, `FirstRowOnPage`, and `LastRowOnPage` are computed server-side
- All `PaginationMetadata` values are non-negative (BR-18)

---

### 11.3 Filtering and Sorting

**Filter syntax:** each filter is a pair of query parameters, `filters[PropertyName].operator=<operator>&filters[PropertyName].value=<value>` (the value is omitted for `is empty` / `is not empty`). Property names are matched case-insensitively against the **response DTO's** property names (never the entity's), so a caller can filter and sort only by data the response already carries; an unknown property, an unsupported operator, or an unparseable value answers HTTP 400.

**Supported filter operators** (case-insensitive; the comparison symbols `=`, `!=`, `>`, `>=`, `<`, `<=` are accepted as aliases of the word forms):

| Operator | Meaning | Applicable Types |
|---|---|---|
| `equals` / `not equals` | Equality | String, numeric, Guid and identifier |
| `greater than` / `greater than or equal` | Lower bound | Numeric |
| `less than` / `less than or equal` | Upper bound | Numeric |
| `is` / `is not` | Equality | DateTime, bool (`is` only) |
| `is after` / `is on or after` | Lower bound | DateTime |
| `is before` / `is on or before` | Upper bound | DateTime |
| `contains` / `not contains` | Substring match | String |
| `starts with` / `ends with` | Prefix / suffix match | String |
| `in` | Value is in a comma-separated list | String, numeric, DateTime, Guid and identifier |
| `between` | Value is within a range | Numeric, DateTime |
| `is empty` / `is not empty` | Null (or empty string) check | All |

String matching follows the database collation, which is case-insensitive on the SQL Server default.

**Sorting:** `sortColumn` specifies one DTO property name; `sortDirection` is `"asc"` (default) or `"desc"`. Only one sort column is supported per request (a comma-separated list is rejected with HTTP 400). The paged read always appends the entity `Id` as a final ascending tie-break, so pages never overlap or skip rows. Audit fields (`CreatedOn`, `LastModifiedOn`) are not part of the conference DTOs and are therefore not sortable or filterable through these endpoints.

**Filterable fields per entity:**

| Entity | Filterable Fields |
|---|---|
| Event | Name, StartDate, EndDate, IsPublished |
| Session | Title, Status, EventId, RoomId, StartsAt, EndsAt, IsServiceSession |
| Speaker | FirstName, LastName, Email |
| Room | Name, EventId |
| Category (route: `/conferencecategories`) | Title, Type |
| CategoryItem | Name, CategoryId |
| Question | QuestionText, QuestionEntity, QuestionType, QuestionSource |
| EventQuestionAnswer | EventId, QuestionId |
| SessionQuestionAnswer | SessionId, QuestionId |
| SpeakerQuestionAnswer | SpeakerId, QuestionId |
| User (`GET /Users/paged`, `identity:users:read`) | Email, FirstName, LastName, Role, plus the virtual `SignedIn` filter (`> 0` signed in, `= 0` not signed in) |

Two list endpoints accept a **virtual** filter key that is not a DTO column: `GET /Sessions/paged` accepts `filters[SpeakerId]` (sessions that speaker presents), and `GET /Speakers/paged` accepts `filters[EventId]` (speakers of that event, which also scopes the BR-239 public projection). **UserSessionBookmark** does not use the filter syntax: `GET /Bookmarks` takes a required `userId` and an optional `eventId` query parameter; the event filter is resolved by asking Conference for that event's session ids over gRPC, because Engagement holds no event column (BR-58).

**Note:** `Speaker.FullName` and `Session.Duration` are computed properties with no database column and cannot be used for filtering or sorting. Clients should filter by `FirstName`/`LastName` or `StartsAt`/`EndsAt` instead.

> **Child entity read endpoints:** Child entities (Room, CategoryItem, EventSpeaker, SessionSpeaker, etc.) have **top-level read endpoints** (`GET /Rooms`, `GET /CategoryItems`, etc.) even though they are owned children of their aggregate root. This is a deliberate pragmatic choice: read operations bypass aggregate boundaries for query convenience (e.g., listing all rooms across events, filtering category items by category). **Write operations** (create, update, delete) are always routed through the parent aggregate to enforce invariants (BR-2 through BR-5). This hybrid read-through/write-through-aggregate pattern is documented to avoid confusion with strict DDD aggregate boundaries.

---

### 11.4 Default Sort Orders

When no `sortColumn` is specified, the server applies an explicit default only where one is declared, and two attendee reads have a fixed order that ignores `sortColumn`; every other paged read falls back to the `Id` tie-break alone:

| Entity | Default Sort | Rationale |
|---|---|---|
| Session (`GET /Sessions` and `GET /Sessions/paged`) | `StartsAt` ascending, then `Id` ascending | Schedule order |
| UserSessionBookmark (`GET /Bookmarks`) | Always `CreatedOn` descending, then `Id` descending (the endpoint takes no `sortColumn`) | Newest bookmarks first |
| PointsEntry (`GET /Points/me`) | Always `OccurredOnUtc` descending, then `Id` descending | Newest ledger entries first |
| Every other entity (Event, Speaker, Room, Category, CategoryItem, Question, EventQuestionAnswer, SessionQuestionAnswer, User and the join entities) on its paged read | `Id` ascending | Stable, total order for paging |

Display orders such as `Sort` for rooms, categories and questions are requested by the client (for example `sortColumn=Sort&sortDirection=asc`) or applied in the UI, not defaulted by the server. The unpaged `GET /{Entities}` read applies no order of its own other than the Session default above.

---

### 11.5 Feedback Submission (BR-107)

Feedback answers are submitted via `POST` on the `EventQuestionAnswers` and `SessionQuestionAnswers` endpoints (`SpeakerQuestionAnswer` is a deferred capability: domain model only, no controller or UI; see Section 10.29 and BR-107). `POST` performs an **upsert** (see BR-107 for semantics). A whole feedback form is submitted in one call with `POST /EventQuestionAnswers/batch` or `POST /SessionQuestionAnswers/batch` (an entity id plus a list of `{ questionId, answerValue }`, at most one per question): every answer is upserted under one transaction, so a refusal writes nothing, and the call answers HTTP 200 with the saved answers. Both create endpoints honor an `Idempotency-Key`. A caller reads back their own answers with `GET /EventQuestionAnswers/mine` and `GET /SessionQuestionAnswers/mine`.

**Authentication:** Required (BR-42)

**Validation:**
- `QuestionId` must reference an existing, non-deleted Question with the correct `QuestionEntity` (`"Event"` for EventQuestionAnswer, `"Session"` for SessionQuestionAnswer). Session answers additionally require `QuestionSource = "User"`: a Sessionize (call-for-papers) question is programme data the refresh owns and cannot be answered as attendee feedback (BR-128). A miss answers HTTP 400 with code `Question.NotFoundOrWrongEntity` ("Question not found or does not apply to this entity type.")
- `AnswerValue` is validated against `QuestionType`: Rating (integer 1-5), Text (max 2000 chars), Email (valid `MailAddress` format): see BR-124
- Session feedback (both `POST` and `PUT`): session must not be a service session (BR-91)
- Session feedback: the session must be scheduled (both `StartsAt` and `EndsAt` set), because feedback is time-gated (BR-16)
- Event must be published (BR-108): this applies to **all users including Organizers**. Feedback on unpublished events is rejected because the feedback flow assumes an event is live/accessible to attendees. Organizers who need to test feedback should publish the event first.
- Event must be published for session feedback too: `SessionQuestionAnswer` submission validates that the session's parent Event has `IsPublished = true` (BR-108). Submitting session feedback for a session belonging to an unpublished event returns HTTP 400 with code `Event.NotPublished` ("This action requires the event to be published.")
- Session must have `Status` of `Accepted` or null (BR-49): feedback is only accepted for sessions with eligible status

**Upsert behavior:** `POST` creates a new answer or overwrites the caller's existing one, keyed on (CreatedBy, QuestionId, EntityId) (BR-123), and answers **HTTP 201** with the saved answer in both cases. Only a genuinely new answer raises the feedback-submitted event that awards engagement points; an overwrite does not. `PUT /{id}` updates an existing answer (HTTP 204); an attendee may update only their own answer, an Organizer any (BR-52/BR-53). `PUT` re-applies the same rules as `POST`: service session (BR-91), session status (BR-49), schedule (BR-16), event visibility (BR-108), question validity (BR-128) and answer type (BR-124).

**Soft-deleted Question handling:** soft-deleted Questions (BR-73) are excluded from the question lookup that BR-128 validation runs, on `PUT` exactly as on `POST`. Both a new submission and an update of an existing answer that references a soft-deleted Question are therefore rejected with HTTP 400 (`Question.NotFoundOrWrongEntity`). The existing answer keeps its historical association and stays readable; it simply cannot be changed.

---

### 11.7 Lookup Endpoints

Lookup endpoints return lightweight Id + display name pairs for populating dropdowns, autocomplete, and reference selectors. Every Conference entity controller exposes one (events, sessions, speakers, rooms, categories, category items, questions, sponsors, partners, activities, the speaker/session/category join entities and the two question-answer entities).

**Endpoint pattern:** `GET /{Entities}/lookup?nameProperty={Property}`. `nameProperty` is **required** and names the DTO property projected into each entry's `name`; it is resolved against the response DTO's property names like a sort column.

**Response body**: a `CollectionResult` of `BaseLookup` entries:

```json
{
  "items": [
    { "id": 1, "name": "Atlanta Developers Conference 2025" },
    { "id": 2, "name": "Atlanta Developers Conference 2026" }
  ]
}
```

| Entity | Route | Typical `nameProperty` |
|---|---|---|
| Event | `/Events/lookup` | `Name` |
| Session | `/Sessions/lookup` | `Title` |
| Speaker | `/Speakers/lookup` | `FirstName` or `LastName` (the only values a non-privileged caller may use) |
| Category | `/conferencecategories/lookup` | `Title` |
| Question | `/Questions/lookup` | `QuestionText` |

Lookup responses are **not paginated**: they return all non-deleted records **that the caller may see**. For entities with large cardinalities, prefer the paginated list endpoint with specific field filtering.

**Lookup is not a visibility bypass.** For non-privileged callers (anyone other than an `Organizer` or `ContentEditor`) every lookup endpoint applies the same filter as its entity's list endpoint: unpublished events are excluded (BR-108), sessions outside the BR-49 allow-list or belonging to unpublished events are excluded (BR-132), and speakers that are not publicly visible are excluded (BR-239). `/Speakers/lookup` additionally accepts only `FirstName` or `LastName` as the `nameProperty` for non-privileged callers; any other value (notably `Email`) is rejected with HTTP 400, because projecting an arbitrary property into the lookup label would otherwise read around the BR-66 email redaction. Privileged readers get the unfiltered lookup and the full `nameProperty` range, with one exception: `nameProperty=Email` follows the BR-66 mapper rule rather than the privileged-reader audience, so only an `Organizer` may label speaker entries by email; a `ContentEditor` asking for it gets HTTP 400 with code `Speaker.Lookup.EmailNotAvailable`.

---

### 11.8 `includeChildren` on List Endpoints

The `includeChildren=true` parameter is supported on the single-entity (`GET /{Entities}/{id}`), unpaged list (`GET /{Entities}`) and paged list (`GET /{Entities}/paged`) endpoints. The CSV export (`/export`) takes no `includeChildren`.

**Performance consideration:** `includeChildren=true` applies no separate page-size cap: list reads stay bounded by the same 500-item maximum as any other read (BR-11), and the unpaged list returns at most that many rows. Clients that need large result sets should omit `includeChildren`, page through the paged endpoint, and fetch child data separately.

**Depth:** One level only (BR-80). Children of children are never loaded.

---

### 11.9 Feedback Access

Organizers retrieve raw, individual feedback records via the standard paginated `EventQuestionAnswer` and `SessionQuestionAnswer` list endpoints (filtered by EventId/SessionId and QuestionId; the `SpeakerQuestionAnswer` endpoint is deferred with the rest of the speaker-feedback capability, see §10.29). Each record includes `CreatedBy`, `AnswerValue`, and timestamps.

---

### 11.10 Schedule Convenience Reads

Four anonymous, output-cached reads sit alongside the standard Conference list endpoints. They exist
because a mobile client should not have to assemble them from the raw schedule.

| Endpoint | Auth | Notes |
|----------|------|-------|
| `GET /Events/{id}/ics` | Anonymous | The published event's full schedule as an iCalendar document, served as `text/calendar` named `event-{id}.ics`. Output-cached like every other anonymous Events read |
| `GET /Sessions/{id}/ics` | Anonymous | The same for a single session, named `session-{id}.ics` and output-cached under the sessions policy |
| `GET /Events/{id}/now-next` | Anonymous | The "happening now / up next" snapshot for one published event. Short-TTL cached (60 seconds), because the payload changes with the clock rather than with a write |
| `GET /Events/now-next` | Anonymous | The id-less form, resolving to the current event (live now, else next upcoming). This is what the home-screen widget calls |

The two now-next variants share one query; passing no id simply means "let the server pick the current
event". Their cache policy is deliberately separate from `EventsCache` so a short TTL does not force
the whole Events surface to re-read.

### 11.11 User Avatars

| Endpoint | Auth | Notes |
|----------|------|-------|
| `GET /Users/me/avatar` | Authenticated | The caller's avatar URL, or null when none is set |
| `POST /Users/me/avatar` | Authenticated | Uploads a photo; **2 MB** maximum accepted upload |
| `DELETE /Users/me/avatar` | Authenticated | Removes the photo. Idempotent |

Storage and image processing follow [ADR-045](../adr/045-managed-file-storage-and-avatars.md); the
stored URL is `[Pii]`-marked and nulled on anonymization.

### 11.12 Session Selection (Organizer decision support)

Organizer-only endpoints that support the accept/decline decision on submitted sessions. The controller is gated on the `conference:session-selection:manage` permission, which only `Organizer` holds; the four reads are output-cached, and the scoring trigger additionally sits behind the `SessionScoring` feature flag.

| Endpoint | Notes |
|----------|-------|
| `GET /SessionSelection/dashboard/{eventId}` | The composite dashboard |
| `GET /SessionSelection/categories/{eventId}` | Category distribution across the event's sessions |
| `GET /SessionSelection/speaker-overlap/{eventId}` | Speakers with more than one submitted session |
| `GET /SessionSelection/content-similarity/{eventId}` | Pairs of sessions with similar content |
| `POST /SessionSelection/score/{eventId}` | Queues AI scoring; returns **202 Accepted** (also when a run is already queued or in progress for that event, which the handler de-duplicates), or **404** when the event does not exist (UC-27) |

### 11.13 Session Materials (BR-116b)

The decks, handouts and links a speaker publishes against their own session. The authorization rule
is unlike the rest of Conference: a write is allowed to a caller holding
`conference:session-assets:manage` (`Organizer`, `ContentEditor`) **or** to a speaker of
that session, matched from the `speaker_id` claim. The controller carries a plain `[Authorize]` and
every handler re-decides it, because half the rule is data rather than a capability.

| Endpoint | Auth | Notes |
|----------|------|-------|
| `GET /SessionAssets?sessionId={id}` | Anonymous | One session's materials, ordered by sort order then by creation. Output-cached under the sessions policy. Scoped by the public-session projection (BR-49 + BR-108): a session the caller cannot see answers an **empty list**, not 404. A speaker's or privileged reader's response is kept out of the shared cache entry |
| `POST /SessionAssets/link` | Speaker of the session, or `conference:session-assets:manage` | Adds a link to externally hosted material. Requires an absolute `http` or `https` URL. Idempotency-Key honored |
| `POST /SessionAssets/file` | Same | Multipart upload of one file, **50 MB** maximum; format admitted only when the bytes and the extension agree. Idempotency-Key honored. The gateway raises its body-size cap for this path only |
| `PUT /SessionAssets/{id}` | Same | Updates title and sort order, and the URL of a **link** asset. A file asset's URL is the blob it was stored as and is not editable. Conditional: `If-Match` required |
| `DELETE /SessionAssets/{id}` | Same | Soft-deletes the asset and schedules its blob for removal (ADR-114) |

Storage, content sniffing and the stored response headers follow
[ADR-123](../adr/123-speaker-session-assets.md) on top of
[ADR-045](../adr/045-managed-file-storage-and-avatars.md). There is no by-id read endpoint: an asset
is only ever fetched as part of its session's list, so the filtered list is the `Location` a create
returns.

---

## 12. Authentication & Identity Architecture

This section defines the authentication mechanism for both the Web UI (Blazor) and MAUI (mobile) clients, which share a common Razor class library. Identity is email-based: a user signs in with email + password, or through an external OAuth provider (Google, GitHub or Sign in with Apple, each enabled by its configured client id), and a user account can be linked to a Speaker. The Identity service signs RS256 access tokens and publishes them for validation through JWKS; every other service validates the bearer itself, and the Gateway authenticates no one.

---

### 12.1 Identity Model

A user is uniquely identified by their **email address**. Each email corresponds to exactly one user account. This is the canonical identity across all platforms (web and mobile).

#### User Entity (detailed typing)

> **Note:** The canonical User entity definition is in Section 2 (Bounded Context: Identity). The table below provides additional typing and constraint detail for implementation.

| Attribute | Type | Required | Unique | Description |
|---|---|---|---|---|
| Id | int | Yes (auto-generated) | Yes | Stable internal identifier (UserIdentifierType = int) |
| Email | string (Email value object) | Yes | Yes | Canonical identity, stored lower-cased (so uniqueness is case-insensitive) under a unique index. Used for login on all platforms and for speaker linking. `[Pii]`. |
| PasswordHash | byte[] | Yes | No | Cryptographic hash of the user's password, stored as `varbinary(max)`. Never stored or transmitted in plaintext. Empty for an account created through external sign-in (it has no local password). |
| PasswordSalt | byte[] | Yes | No | Per-user cryptographic salt used for password hashing. Stored as `varbinary(max)`. Empty for an external-only account. |
| FirstName | string | Yes | No | User's first name. Used for display. `[Pii]`. |
| LastName | string | Yes | No | User's last name. Used for display. `[Pii]`. |
| Role | string (max 50) | Yes (default: Attendee) | No | Authorization role: `Attendee`, `ContentEditor` or `Organizer`, stored in its canonical spelling. The role's permissions are resolved from it (Section 12.3). |
| LinkedSpeakerId | GUID? | No | Yes (when non-null, filtered unique index) | Id of the linked Speaker in the Conference service (a scalar column, not a cross-database FK). Set from the `SpeakerLinkedToUser` integration event and cleared by `SpeakerUnlinkedFromUser`. |
| LoginProvider | string? (max 50) | No | Unique together with ProviderKey (when both non-null) | External OAuth provider of an account created or linked through external sign-in; null for a local account. `[Pii]`. |
| ProviderKey | string? (max 256) | No | See LoginProvider | The provider's subject id for that account. `[Pii]`. |
| IsEmailConfirmed | bool | Yes (default: false) | No | Whether the address has been proven reachable (ADR-116). Set by the confirmation link, or at creation when an external provider asserted the address as verified. Sign-in is not gated on it (BR-266). |
| LockedOn | DateTime? | No | No | When an administrator locked the account out of sign-in; null while usable. `IsLocked` is computed from it. |
| AcceptedTermsVersion | string? | No | No | Terms of Service version last accepted; kept on anonymization as consent evidence. |
| TermsAcceptedOn | DateTime? | No | No | UTC instant of that acceptance; kept on anonymization. |
| PreferredCulture | string? (max 10) | No | No | UI culture preference (`PUT /Auth/preferences`). |
| PreferredTheme | string? (max 10) | No | No | UI theme preference. |
| AvatarUrl | string? (max 512) | No | No | Public URL of the user's avatar photo (Section 11.11). `[Pii]`, nulled on anonymization. |
| FullName | string | N/A (computed) | No | Computed: "{FirstName} {LastName}". Read-only, no database column. |
| DeviceId | string? | No | No | Device metadata column. No endpoint writes it: registration and login carry no device fields, so it stays null. `[Pii]`. |
| DeviceFormFactor | string? | No | No | Device metadata column, unwritten (see DeviceId) |
| DevicePlatform | string? | No | No | Device metadata column, unwritten (see DeviceId) |
| DeviceModel | string? | No | No | Device metadata column, unwritten (see DeviceId) |
| DeviceManufacturer | string? | No | No | Device metadata column, unwritten (see DeviceId) |
| DeviceName | string? | No | No | Device metadata column, unwritten (see DeviceId) |
| DeviceType | string? | No | No | Device metadata column, unwritten (see DeviceId) |

**Refresh tokens are not on the User entity.** Each sign-in opens its own row in the framework's `RefreshSessions` table (one per device, holding only a hash of the token, with the user agent and IP it was opened from), so signing in on a second device leaves the first signed in (BR-205). The User aggregate raises the `UserPasswordChanged` and `UserDeleted` domain events; registration publishes the cross-service `UserRegistered` integration event (carrying an `EmailVerified` flag) through the outbox rather than a domain event.

#### Speaker Entity Addition

> **Note:** `LinkedUserId` is also documented on the Speaker entity in Section 2.

| Attribute | Type | Required | Description |
|---|---|---|---|
| LinkedUserId | int? (`UserIdentifierType`) | No | Id of the linked User in the Identity service (a scalar column, not a cross-database FK), under a filtered unique index. Set when a user is linked to this speaker. 1:1 relationship with `User.LinkedSpeakerId`. |

---

### 12.2 Authentication Flows

#### UC-30: User Registration

**Actors:** Unauthenticated user (any platform)
**Preconditions:** None (self-registration is open: BR-211)

**Endpoint:** `POST /auth/register` (anonymous; `auth-ip` rate limited, plus the Gateway's `auth-tight` per-IP policy)

**Request body:**

```json
{
  "email": "attendee@example.com",
  "password": "SecureP@ss1",
  "firstName": "Alice",
  "lastName": "Smith",
  "acceptedTerms": true
}
```

**Required fields:** `email`, `password`, `firstName`, `lastName`, and `acceptedTerms: true` (ADC configures a current Terms of Service version)
**Optional fields:** `address` (validated when supplied; the ADC register page does not collect it). There are no device fields: registration carries no device metadata.

**Main Flow:**

1. System validates input (email format and length, password strength per BR-203, first and last name required and within their maximum lengths)
2. System checks the Terms of Service flag: with a current version configured, `acceptedTerms` must be `true`, and the configured version is stamped on the new account
3. System checks the per-IP registration limit (BR-213)
4. System checks that no user exists with the given email, soft-deleted accounts included
5. System creates a new user record with hashed password (BR-204) and `Role = Attendee` (BR-45)
6. System publishes the `UserRegistered` integration event through the outbox with `EmailVerified = false`; Conference runs the speaker auto-link on it (BR-207), which never links a local password registration
7. System counts the registration against the caller's IP and opens a refresh session for this device (BR-205)
8. System schedules the email-confirmation message (ADR-116, an internal command, so a mail outage defers the send rather than failing the registration; the conference-day synthetic load-test accounts are skipped)
9. Returns the token pair

**Response body** (`AuthenticationResponse`, shared by register, login, refresh and the OAuth code exchange):

```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiIs...",
  "refreshToken": "q8Xb...base64",
  "accessTokenExpiry": "2026-10-28T14:15:00Z"
}
```

**Response codes:**
- HTTP 201: user created, token pair returned
- HTTP 400: validation failure (password too weak, invalid email format, missing required fields, terms not accepted: `Auth.TermsNotAccepted`)
- HTTP 401: registration limit for this IP exceeded (`Auth.RegistrationRateLimitExceeded`, BR-213)
- HTTP 409: email already registered
- HTTP 429: `auth-ip` per-IP rate limit exceeded

**Alternate Flows:**
- Email already registered (including by a concurrent registration that wins the insert race) -> HTTP 409 Conflict with message `"An account with this email already exists."`
- Password does not meet strength requirements -> HTTP 400 with one `Validation` error per failed rule
- Confirmation email cannot be scheduled -> logged at Error; the registration still answers 201 and the user can request a link from the confirmation page

**Postconditions:** User has a valid account, an open refresh session and an access token, and is signed in immediately (sign-in is not gated on email confirmation, BR-266). The first token carries no `speaker_id` claim.

---

#### UC-31: User Login

**Actors:** Registered user (any platform)
**Preconditions:** User has a registered account

**Endpoint:** `POST /auth/login` (anonymous; `auth-ip` rate limited, plus the Gateway's `auth-tight` per-IP policy)

**Request body:**

```json
{
  "email": "attendee@example.com",
  "password": "SecureP@ss1"
}
```

**Required fields:** `email`, `password`. There are no device fields: the device a session was opened from is recorded on the refresh session from the request's user agent and IP instead (BR-202).

**Main Flow:**

1. System validates the request shape (email format, password present)
2. System checks the brute-force lockout for the address (BR-212)
3. System validates email + password against stored credentials. An unknown address, a soft-deleted account, and an external-only account with no local password are all answered exactly like a wrong password, including the hashing cost, so the three are indistinguishable
4. Only after the password is proven, system refuses an administrator-locked account (`Auth.AccountLocked`)
5. System resets the failed-attempt counter, opens a new refresh session for this device (BR-205), and issues an access token carrying the current claims, `speaker_id` included when the account is linked
6. If the stored hash predates the hasher's current format or work factor, the system re-derives it from the submitted password (best effort, no domain event)
7. Returns the token pair

**Response body:** `AuthenticationResponse`, the same shape as registration (`accessToken`, `refreshToken`, `accessTokenExpiry`).

**Response codes:**
- HTTP 200: login successful
- HTTP 400: malformed request
- HTTP 401: invalid email or password (`Auth.InvalidCredentials`, generic message: do not reveal whether the email exists), or an administrator-locked account (`Auth.AccountLocked`)
- HTTP 429: too many failed attempts (`Auth.TooManyAttempts`, BR-212), or the `auth-ip` per-IP rate limit

**Alternate Flows:**
- Invalid credentials -> HTTP 401 with message `"Invalid email or password."` Failed attempt counter incremented (BR-212).
- Account soft-deleted -> HTTP 401 (same generic message: soft-deleted accounts cannot authenticate)
- Account locked by an administrator -> HTTP 401 `Auth.AccountLocked` ("This account has been locked by an administrator. Contact the organizers.")

**Postconditions:** User has a valid access token and a new refresh session; any sessions on other devices stay signed in. Login does not run speaker linking: a link made since the last token appears in the next token issued (login or refresh).

**External sign-in:** `GET /auth/oauth/google`, `GET /auth/oauth/github` and `GET /auth/oauth/apple` start the provider challenge; the callback completes at `GET /auth/oauth/complete`, and the client redeems the one-time code it receives with `POST /auth/oauth/exchange` for the same `AuthenticationResponse`. A first-time provider identity either creates a new account (no local password; `IsEmailConfirmed` set when the provider asserted the address as verified) or attaches to an existing account with the same email, which is allowed only when the provider verified the address **and** the existing account has no local password; otherwise the attach is refused (`Auth.ExternalEmailNotVerified`, `Auth.ExternalLinkRequiresLocalSignIn`, or `Auth.ExternalProviderAlreadyLinked` when the account is already bound to a provider identity). One provider identity per account. An administrator lock binds this path too.

---

#### UC-32: Refresh Access Token

**Actors:** Signed-in user (any platform)
**Preconditions:** A live refresh session for the user

**Endpoint:** `POST /auth/refresh` (anonymous: the access token is allowed to be expired)

**Request body:**

```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiIs...",
  "refreshToken": "q8Xb...base64"
}
```

Both fields are required. On the web the browser never holds either token: the Blazor host keeps both in HttpOnly session cookies and calls this endpoint server-side (cookie session refresh, or the same-origin API proxy for the WebAssembly client). The MAUI app reads both from SecureStorage and calls the endpoint directly.

**Main Flow:**

1. System validates the access token's signature, issuer and audience, skipping only its lifetime check, and reads the user id from its `sub` claim
2. System loads the user (a soft-deleted account does not resolve) and refuses an administrator-locked account (`Auth.AccountLocked`)
3. System resolves the presented refresh token against its stored hash, checks it is live, and atomically rotates it: the presented session is revoked and linked to a new session (BR-205)
4. System issues a new access token from the current account state, so a role change or a speaker link made since the last token takes effect here
5. Returns the new token pair

**Response body:** `AuthenticationResponse`, the same shape as login (`accessToken`, `refreshToken`, `accessTokenExpiry`).

**Response codes:**
- HTTP 200: new tokens issued
- HTTP 400: malformed request (a field missing)
- HTTP 401: access token invalid (`Auth.InvalidToken`), refresh token unknown, expired or revoked (`Auth.InvalidRefreshToken`), or account locked
- HTTP 409: the presented token was rotated by a sibling request less than 10 seconds ago (`Auth.RefreshSuperseded`); nothing is revoked and the client retries with the token it already holds

**Alternate Flows:**
- An already-rotated token presented after the 10-second grace (reuse detection) -> every live refresh session of the user is revoked (BR-206). Returns HTTP 401. User must sign in again.

**Session management:** `GET /auth/my-sessions` lists the caller's live sessions (one per device, marking the current one); `POST /auth/revoke/{sessionId}` signs one device out; `POST /auth/revoke` signs the caller out everywhere (BR-216). An Organizer lists a user's sessions through `GET /Admin/Users/{userId}/sessions`; locking the account or changing its role revokes them.

---

#### UC-33: Change Password

**Actors:** Authenticated user (any platform)
**Preconditions:** User is authenticated with a valid JWT

**Endpoint:** `PUT /auth/password`

**Request body:**

```json
{
  "currentPassword": "OldSecureP@ss1",
  "newPassword": "NewSecureP@ss2"
}
```

**Required fields:** `currentPassword`, `newPassword`

**Main Flow:**

1. System validates the new password meets strength requirements (BR-203)
2. System checks the change-password lockout for this account (a counter keyed per account, separate from the sign-in counter, so it cannot lock the owner out of login)
3. System validates the current password against stored credentials; a wrong one counts against that lockout. An external-only account has no current password and is refused the same way
4. System updates the password hash and salt and raises the `UserPasswordChanged` domain event
5. System revokes every live refresh session of the account, so a stolen refresh chain does not survive the change
6. Returns HTTP 204 No Content

**Response codes:**
- HTTP 204: password changed successfully
- HTTP 400: new password does not meet strength requirements (BR-203)
- HTTP 401: not authenticated, or current password incorrect (`Auth.InvalidCurrentPassword`)
- HTTP 429: too many wrong current passwords (`Auth.TooManyAttempts`)

**Postconditions:** User's password is updated. Existing access tokens remain valid until their 15-minute expiry, but every refresh session (this device's included) is revoked, so each device signs in again once its access token expires.

---

#### UC-34: Request Password Reset

**Actors:** Unauthenticated user who cannot sign in (any platform)
**Preconditions:** None. The caller has lost the credential, so the endpoint is anonymous by necessity.

**Endpoint:** `POST /auth/forgot-password`

**Request body:**

```json
{
  "email": "attendee@example.com"
}
```

**Required fields:** `email`

**Main Flow:**

1. System validates the shape of the address (non-empty, valid email format). Whether the address belongs to an account is deliberately not validated (BR-217)
2. System looks up the account behind the address without tracking it
3. System increments the per-address request counter and checks it against the rolling-hour throttle (BR-219)
4. System mints a 256-bit single-use token, stores only its SHA-256 hash against the address with the configured TTL, and returns the raw token to the handler (BR-218)
5. System sends an email containing the reset link (`{PasswordReset:ResetUrl}?email=...&token=...`) and the raw token, so a client that cannot follow a deep link can have the token entered by hand
6. Returns HTTP 202 Accepted

**Response body:** None.

**Response codes:**
- HTTP 202: request accepted (returned for every well-formed address, registered or not)
- HTTP 400: malformed or missing email address
- HTTP 429: `auth-ip` per-IP rate limit exceeded

**Alternate Flows:**
- No account for the address → steps 3-5 are skipped, the reason is logged server-side, and the response is still HTTP 202 (BR-217)
- Address over the throttle → no token is minted and no email is sent; the response is still HTTP 202 (BR-219)
- Email delivery fails → the failure is logged with the user id; the token stays live so the user can retry, and the response is still HTTP 202
- An earlier token exists for the address → it is overwritten, so only the newest link works (BR-218)

**Postconditions:** At most one active reset token exists for the address. No account state changed: nothing is written to the database, and the response carries no signal about whether the address is registered.

---

#### UC-35: Reset Password

**Actors:** Unauthenticated user holding a reset token (any platform)
**Preconditions:** The user has an unexpired, unused reset token issued by UC-34 for the same address.

**Endpoint:** `POST /auth/reset-password`

**Request body:**

```json
{
  "email": "attendee@example.com",
  "token": "3Yb1t...43-character Base64Url token",
  "newPassword": "NewSecureP@ss2"
}
```

**Required fields:** `email`, `token`, `newPassword`

**Main Flow:**

1. System validates the request (address shape, token present, new password meets BR-203 through the same strength rules registration uses)
2. System validates the presented token against the stored hash in constant time and **consumes** it, before any write, so it cannot be redeemed twice (BR-218)
3. System loads the account the token redeems to
4. System revokes every live refresh session of the account, persisted before the password is applied, so a suspected intruder's refresh chain dies with the old password even if the change itself is then refused
5. System hashes the new password (BR-204) and applies it through the aggregate, which enforces its own invariants
6. System persists the change
7. System clears the account's login brute-force counters so a user who was locked out can sign in immediately (BR-219)
8. Returns HTTP 204 No Content

**Response body:** None.

**Response codes:**
- HTTP 204: password reset successfully
- HTTP 400: malformed request (missing token, invalid address shape, new password fails BR-203)
- HTTP 401: token invalid, expired, already used, issued for a different address, attempt-capped, or the account is no longer resolvable
- HTTP 429: `auth-ip` per-IP rate limit exceeded

**Alternate Flows:**
- Wrong token presented → the failed-attempt count on the record increases and the record is rewritten with its *remaining* lifetime; at 5 failures the record is discarded and the user must request a new link (BR-218). Every one of these returns the same generic `Auth.InvalidResetToken` 401
- Token valid but a later invariant rejects the password change → the token is already consumed, so the user requests a new link. This is the deliberate cost of closing the replay window

**Postconditions:** The account has the new password hash and salt, the reset token and the address's request counter are gone, every refresh session is revoked, and the login lockout counters are cleared. Existing access tokens are not revoked: they remain valid until their 15-minute TTL expires (BR-216).

---

### 12.3 Token Architecture

#### Access Token (JWT)

| Property | Value |
|---|---|
| Format | JWT, RS256 (the `Jwt:SigningAlgorithm` default), validated across services via JWKS (`/.well-known/jwks.json`, key id in the token's `kid` header). RSA keys are required in every deployed environment; HS256 is the framework's single-process monolith option and ADC does not use it. |
| Lifetime | 15 minutes (`Jwt:AccessTokenExpirationMinutes`) |
| Storage (MAUI) | SecureStorage |
| Storage (Web) | HttpOnly session cookie held by the Blazor host; the interactive Blazor Server circuit keeps a copy in server memory only. Never in `localStorage` and never readable by page script. |

#### JWT Claims

| Claim | Type | Always Present | Description |
|---|---|---|---|
| `sub` | int | Yes | Stable user identifier (`UserIdentifierType = int`), the only carrier of the user id |
| `email` | string | Yes | User's email address |
| `role` | string | Yes | `Attendee`, `ContentEditor` or `Organizer` |
| `unique_name` | string | Yes | User's full name ("{FirstName} {LastName}") |
| `permission` | string (repeated) | When the role grants any | One claim per permission the role grants (for example `conference:sessions:manage`), so clients can gate on capabilities instead of role names |
| `sid` | GUID | Yes | The refresh session the token was minted for, which lets the server mark the current device and sign it out |
| `speaker_id` | GUID | No | Present only when user is linked to a Speaker entity |
| `jti`, `iat` | string, number | Yes | Standard token id and issued-at time |

> **Note:** No device identifier is carried in the token. The device a session belongs to is recorded on its refresh session (user agent and IP), not as an identity claim.

#### Refresh Token

| Property | Value |
|---|---|
| Format | Opaque (64 cryptographically random bytes, Base64-encoded), not JWT; stored server-side only as a hash, one `RefreshSessions` row per device |
| Lifetime | 7 days (`Jwt:RefreshTokenExpirationDays`) |
| Issued to | Every client: register, login, refresh and the OAuth code exchange all return it in the response body |
| Storage (Web) | HttpOnly session cookie on the Blazor host (`SameSite=Lax` in ADC, so a signed-in user following a mailed deep link keeps the session; unsafe methods are protected by an `X-CSRF` header) |
| Storage (MAUI) | SecureStorage |
| Rotation | Rotated on each use: old session revoked and linked to its successor, new token issued |
| Sessions per user | At most 10 live sessions (`RefreshSessions:MaxActiveSessionsPerUser`); a new sign-in beyond that evicts the oldest instead of failing |
| Reuse detection | If an already-rotated token is presented more than 10 seconds after its rotation, ALL live refresh sessions for that user are revoked (indicates potential token theft); inside those 10 seconds it is a race between sibling requests, answered 409 with nothing revoked |

---

### 12.4 Speaker-User Linking

#### Automatic Linking

Runs asynchronously in the Conference service when it receives the `UserRegistered` integration event, which Identity publishes for every new account (UC-30, and a first-time external sign-in). Login does not run it.

1. System queries for a Speaker with `Email` matching `User.Email` (case-insensitive)
2. If `Speaker.LinkedUserId` is already set to a different user -> no automatic override (an organizer unlinks and re-links manually)
3. If the event's `EmailVerified` flag is false (every local password registration) -> nothing is linked; the candidate is logged for an organizer (BR-207)
4. Otherwise the speaker is linked (`Speaker.LinkedUserId = User.Id`) and Conference publishes `SpeakerLinkedToUser`, on which Identity sets `User.LinkedSpeakerId = Speaker.Id`
5. When no email matches but unlinked speakers share the registrant's name, an Information-level cue is logged and nothing is linked
6. The link is eventually consistent: the new account's first token carries no `speaker_id` claim; it appears in the next token issued (refresh or login)

#### Manual Linking (Organizer)

| Endpoint | Method | Description |
|---|---|---|
| `/Speakers/{speakerId}/link` | `PUT` | Link a user to a speaker. Body: `{ "userId": 42 }` (an int `UserIdentifierType`). Requires `conference:speakers:link` (Organizer only). Answers 204. |
| `/Speakers/{speakerId}/link` | `DELETE` | Unlink the user from a speaker. Requires `conference:speakers:link`. Answers 204. |

Manual linking works regardless of email match (for cases where a speaker's Sessionize email differs from their user account email, or the speaker has no email at all). It does not override an existing link: a speaker already linked answers HTTP 400 (`Speaker.AlreadyLinked`), and a user already linked to another speaker answers HTTP 400 (`Speaker.UserAlreadyLinked`, BR-208), so re-linking is an unlink followed by a link. Each operation changes the Conference side in the same transaction as the outbox row of its `SpeakerLinkedToUser` / `SpeakerUnlinkedFromUser` event, which updates the Identity side; manual unlinking therefore clears both sides of the relationship.

#### Speaker-Specific Features

When a user has a `speaker_id` claim, they gain access to read-only views of their own session data:

| Feature | Endpoint | Auth | Description |
|---|---|---|---|
| View session feedback | `GET /Speakers/{speakerId}/sessions/{sessionId}/feedback` | Authenticated: the speaker themself or an Organizer | Aggregated ratings + individual text responses for sessions the speaker presents. Not output-cached, because every response depends on who asks |
| View session bookmark count | `GET /Speakers/{speakerId}/sessions/{sessionId}/bookmarks/count` | Public (`AllowAnonymous`) | Number of attendees who bookmarked one of the speaker's sessions. Output-cached for 60 seconds |
| View bookmark counts in bulk | `GET /Speakers/{speakerId}/sessions/bookmarks/counts?sessionIds=...` | Public (`AllowAnonymous`) | Counts for several of the speaker's sessions in one call (only sessions assigned to that speaker are counted). Output-cached for 60 seconds |
| Update own speaker profile | `PUT /Speakers/{speakerId}` | Authenticated | Speaker can update bio, tagline, social links on their own linked speaker record. Conditional: `If-Match` required (412 when stale, 428 when missing) |

**Authorization:** Session feedback, free-text comments included, is the speaker's own read: the caller must carry the route speaker's `speaker_id` claim or be an `Organizer`, and anyone else gets HTTP 403. The bookmark count endpoints are **publicly accessible** (`AllowAnonymous`), which backs the public popularity badge. The profile update endpoint requires authentication: the requesting user's `speaker_id` JWT claim must match the `{speakerId}` in the URL, or the caller must hold `conference:speakers:manage` (`Organizer` and `ContentEditor`). A self-edit cannot change the `IsTopSpeaker` curation flag, an email is written only by a caller allowed to read it (BR-66), and `LinkedUserId` is not part of the update request at all.

**Sessionize Conflict:** When Sessionize data is refreshed (UC-6), speaker profiles are overwritten per BR-48 (Sessionize is the source of truth). Local edits made by a speaker via the app are replaced. This is consistent with existing behavior and keeps the import logic simple. Speakers should be informed that their profile edits may be overwritten during a Sessionize refresh.

**Notification mechanism:** When a speaker edits their profile via the app (BR-214), no real-time notification is sent to organizers. The edit is visible through the standard audit trail (`LastModifiedBy`, `LastModifiedOn` on the Speaker entity). Organizers can identify speaker-edited profiles by checking whether `LastModifiedBy` corresponds to the linked user rather than an organizer or the Sessionize refresh process. A dedicated notification (e.g., domain event, email alert) for speaker profile edits is a potential future enhancement but is out of scope for the initial implementation.

---

### 12.5 Shared Auth Layer (Common Razor Library)

The Web UI (Blazor) and MAUI UI share a common Razor class library for UI components. Authentication is abstracted through a shared interface with platform-specific implementations.

#### Auth Service Abstraction

Server side, the Identity service implements the framework's `IAuthenticationService` (ADC's `AuthenticationService` over the shared `AuthenticationServiceBase<User>`):

```
IAuthenticationService
- LoginAsync(LoginRequest, ipAddress?, userAgent?) -> Result<AuthenticationResponse>
- RegisterAsync(RegisterRequest, ipAddress?, userAgent?) -> Result<AuthenticationResponse>
- RefreshTokenAsync(RefreshTokenRequest, ipAddress?, userAgent?) -> Result<AuthenticationResponse>
- RevokeTokenAsync(userId, refreshToken?) -> Result
- RevokeAllSessionsAsync(userId) -> Result
- GetSessionsAsync(userId, currentSessionId?) -> Result<IReadOnlyList<RefreshSessionSummaryResponse>>
- RevokeSessionByIdAsync(userId, sessionId) -> Result
- ExternalLoginAsync(provider, providerKey, email, firstName, lastName) -> Result<AuthenticationResponse>
```

Password change and reset are command handlers (`ChangePasswordHandler`, `ResetPasswordHandler`), not members of this service.

The shared UI library calls the API through `IAuthUIService`, one implementation for every head; the platform differences live in the token storage and refresher it is composed with:

```
IAuthUIService (UI abstraction)
- LoginAsync(LoginRequest) -> Result<AuthenticationResponse>
- RegisterAsync(RegisterRequest) -> Result<AuthenticationResponse>
- ExchangeOAuthCodeAsync(code) -> Result<AuthenticationResponse>
- LogoutAsync()
- TryRefreshTokenAsync() -> bool
- ChangePasswordAsync(currentPassword, newPassword) -> Result
- RequestPasswordResetAsync(email) -> Result
- ResetPasswordAsync(email, token, newPassword) -> Result
- GetSessionsAsync() -> Result<IReadOnlyList<RefreshSessionSummaryResponse>>
- RevokeSessionAsync(sessionId) -> Result
- RevokeAllSessionsAsync() -> Result
```

The current user's claims are read from the authentication state (`JwtAuthenticationStateProvider` parses the access token), not from a separate claims object.

#### Platform Implementations

| Concern | MAUI Implementation | Web (Blazor) Implementation |
|---|---|---|
| Token storage | SecureStorage (access token + refresh token); never the password | HttpOnly session cookies on the Blazor host hold both tokens; the Server circuit keeps the access token in memory, and the WebAssembly client calls the API through the host's same-origin proxy, so no token is ever readable by page script |
| Auto re-auth | Refreshes proactively shortly before expiry by calling the refresh endpoint directly with the stored pair (UC-32) | The host refreshes the cookie session server-side through the same endpoint (UC-32) |
| Device metadata | The app sends a native user agent (for example `AtlDevCon/1.9.2 (Android 15; MmcaApp)`) so the signed-in devices list names the app | The browser's user agent names the session |
| Logout | Unregisters push, best-effort `POST /auth/revoke` (every session of the account, BR-216), clears SecureStorage | The same revoke call, then the session cookies and in-memory token are cleared |
| AuthStateProvider | Reads the token from SecureStorage through the freshness-checking storage, notifies on change | Reads the cookie-backed token, notifies on change, and signs the circuit out when the session ends |

#### Blazor Integration

- `JwtAuthenticationStateProvider` (a custom `AuthenticationStateProvider`) builds the claims principal from the access token
- `CascadingAuthenticationState` propagates claims to all Razor components
- `AuthorizeView` and `[Authorize]` attributes work identically on both platforms
- Role-based gating: `[Authorize(Roles = RoleNames.Organizer)]` and `<AuthorizeView Roles="Organizer">` for admin-only UI; the token's `permission` claims let a component gate on a capability instead
- Speaker-specific UI gated on `speaker_id` claim presence

---

### 12.6 Business Rules

| Rule | Description |
|---|---|
| BR-200 | `User.Email` is **required and unique** (case-insensitive). It is the canonical identity across all platforms. |
| BR-201 | User identity is **email-based**. Users register with email + password + first name + last name, or sign in through an external OAuth provider (BR-267). The `Device*` columns on the User record are not written by any endpoint and are not an authentication credential. |
| BR-202 | Device migration is **implicit**. A user signs in from any device with their email + password (or provider); each sign-in opens its own refresh session, recording the device's user agent and IP, and leaves the sessions on other devices signed in (up to 10 per user, BR-205). The user sees and revokes them through `GET /auth/my-sessions` and `POST /auth/revoke/{sessionId}`. No explicit account linking or migration flow is needed. |
| BR-203 | Passwords must meet minimum strength requirements: **minimum 8 characters, maximum 128**, containing at least one uppercase letter, one lowercase letter, one digit, and one special character. The same rules guard registration, password change and password reset; a failure answers HTTP 400. |
| BR-204 | Passwords are stored as a **one-way hash** with a **per-user salt**: both stored as `byte[]` (`varbinary` in SQL Server) on the User entity (`PasswordHash` and `PasswordSalt` fields). Plaintext passwords are never stored, logged, returned in API responses, or included in error messages. |
| BR-205 | **Refresh tokens** are issued to every client in the token response: the web host keeps them in an HttpOnly session cookie (never readable by script), the MAUI app in SecureStorage. Each sign-in opens its own refresh session, stored only as a hash; a user holds at most **10** live sessions, and a new sign-in beyond that evicts the oldest. Valid for **7 days**. Rotated on each use: the previous session is revoked when a new one is issued. Changing or resetting the password, an administrator lock and a role change each revoke every live session of the account. |
| BR-206 | **Refresh token reuse detection:** If a previously-rotated refresh token is presented more than **10 seconds** after its rotation, **all** live refresh sessions for that user are revoked immediately. This indicates potential token theft. The user must re-authenticate via login. Within those 10 seconds the presentation is treated as a race between the client's own concurrent requests and answered HTTP 409 (`Auth.RefreshSuperseded`) with nothing revoked. An expired session is not a reuse signal and fails alone. |
| BR-207 | **Speaker-user linking** is automatic at account creation (local registration or a first-time external sign-in, never at login) when `User.Email` matches `Speaker.Email` (case-insensitive) and the address was verified by an identity provider (see the 2026-09-07 clarification below). The link is stored bidirectionally (`User.LinkedSpeakerId`, `Speaker.LinkedUserId`). **Discovery limitation:** Speaker emails are not exposed via public API (BR-66), so attendees cannot verify which email their Speaker profile uses in Sessionize. Organizers should inform speakers of their Sessionize-registered email address before the conference so they register with the matching email. When automatic matching fails (e.g., speaker uses a different personal email), organizers can use manual linking (BR-209). **Clarification (2026-09-07):** matching is by email equality AND requires a **provider-verified** address: the `UserRegistered` integration event carries an `EmailVerified` flag, and the Conference-side handler links only when an external identity provider asserted the address. A local password registration under a speaker's address links nothing (an address typed into a form proves nothing, and a speaker profile carries rights over that speaker's own record and sessions); when the name matches unlinked speakers the handler logs an organizer cue instead, and the organizer manual link (BR-209) is the path. **Clarification (2026-08-04, BugHunt C5):** matching is by email equality ONLY; a name-based fallback that briefly existed in code was removed as a security fix (registration names are unverified free text, so a name match would let anyone claim a speaker profile). Sessionize-imported speakers carry no email, so the organizer manual link (BR-209) is their intended path; when a registration's email match misses but unlinked speakers share the registrant's name, the handler logs an Information-level cue for the organizer rather than linking. **Clarification (2026-10-19):** an erased speaker's placeholder email (BR-66) is on the reserved `.invalid` domain, which no identity provider can verify, so it can never satisfy the provider-verified match and never auto-links. |
| BR-208 | A Speaker can be linked to **at most one User**, and a User can be linked to **at most one Speaker** (1:1 relationship). Enforced by filtered unique indexes on both link columns (`User.LinkedSpeakerId` in the Identity database, `Speaker.LinkedUserId` in the Conference database; scalar columns, not cross-database FKs) and by the link handler's cross-check (`Speaker.UserAlreadyLinked`). |
| BR-209 | Organizers can **manually link or unlink** a User and Speaker regardless of email match (`PUT /Speakers/{id}/link`, `DELETE /Speakers/{id}/link`, permission `conference:speakers:link`). A manual link does not displace an existing one: linking an already-linked speaker is refused (`Speaker.AlreadyLinked`), so changing a link is an unlink followed by a link. It is also the **only** path for a Sessionize-imported speaker (whose email is always null) and for any registration whose address no identity provider verified (BR-207). |
| BR-210 | The `speaker_id` JWT claim grants **no additional permissions** beyond what the user's `role` provides. It is an identity claim that scopes self-service on the speaker's own records (own session feedback, profile editing, own session materials); every capability (`permission` claim) derives solely from `role`. |
| BR-211 | Self-registration is **open**. Any person can create an account without invitation or pre-approval. New accounts default to the `Attendee` role (BR-45). Promotion to `ContentEditor` or `Organizer` is done by an Organizer through `PUT /Admin/Users/{userId}/roles` (permission `users:manage`, which `ContentEditor` never holds), or by database seeding; a role change revokes the account's live refresh sessions, so it takes effect within one access-token lifetime. |
| BR-212 | Login **brute-force protection:** After **5 failed login attempts** for a given email address (counted within a 30-minute window), the address is locked out for an exponentially growing period (1s, 2s, 4s, 8s, 16s, ... capped at **5 minutes**); a sign-in attempt during the lockout answers HTTP 429 `Auth.TooManyAttempts` without checking the password. The address is compared case-insensitively. The counter resets on successful login and on a successful password reset (BR-219). |
| BR-213 | Registration **abuse prevention:** Maximum **10 account registrations per IP address per hour**. Excess attempts return HTTP 401 with code `Auth.RegistrationRateLimitExceeded`, the uniform login-protection failure of ADR-029. The client IP is the browser's on every path: the WebAssembly proxy and the Blazor Server circuit both forward it, so first-visit registrations do not share one bucket keyed on the UI host. |
| BR-214 | Speakers can update their **own** speaker profile (bio, tagline, social links) when linked. The `speaker_id` in the JWT must match the target Speaker entity's ID. Any caller holding `conference:speakers:manage` (`Organizer` and `ContentEditor`) can update any speaker profile regardless of linking. A self-edit keeps the stored `IsTopSpeaker` value. |
| BR-215 | Sessionize refresh (UC-6) **overwrites all speaker profile fields** including any local edits made by speakers via the app. Sessionize remains the source of truth (BR-48). |
| BR-216 | **Logout** calls `POST /auth/revoke`, which revokes **every** live refresh session of the account (the call carries no session id, so it signs the user out everywhere), then clears the client's local state: the session cookies on the web, SecureStorage on MAUI. Signing out a single device is `POST /auth/revoke/{sessionId}`. Access tokens cannot be server-side invalidated before expiry: they remain valid until their 15-minute TTL expires, which bounds how long an account deletion, lock or role change takes to bite. A token blacklist is out of scope. |
| BR-217 | **Password reset anti-enumeration:** `POST /auth/forgot-password` returns **HTTP 202** for every well-formed request. An address with no account, an address over the BR-219 throttle, and a failed email send are all reported as accepted and recorded only in the server log, so neither the status code nor the response body discloses which addresses hold accounts. The rule holds on the other endpoint too: `POST /auth/reset-password` collapses every rejection into one generic 401 (BR-218), and the reset page renders the same confirmation whatever the API answered. Only the request validator can return HTTP 400, and it inspects the shape of the address, never whether it is registered. |
| BR-218 | **Reset tokens** are **256 bits** of cryptographic randomness (Base64Url-encoded), **single-use**, and held **SHA-256 hashed** rather than in clear, compared in constant time. A token expires after the configured TTL (`PasswordReset:TokenLifetimeMinutes`, **default 30 minutes**) and the record is discarded after **5 failed validation attempts** (`PasswordReset:MaxValidationAttempts`); a wrong guess rewrites the record with the token's *remaining* lifetime, never a fresh one, so guessing cannot extend the window. Issuing a new token overwrites the previous one, so only the newest link works. The token is consumed before the password is written, which closes the replay window at the cost of burning a token when a later invariant fails. Every invalid, expired, mismatched, attempt-capped or orphaned token returns the single error `Auth.InvalidResetToken` with **HTTP 401**. |
| BR-219 | **Reset request throttle:** at most **3 reset requests per email address per rolling hour** (`PasswordReset:MaxRequestsPerEmail` / `PasswordReset:RequestWindowMinutes`). An over-limit request still answers 202 and simply sends no email (BR-217). Both reset endpoints additionally carry the same `auth-ip` per-IP endpoint limit as login and register (30 requests per minute per client IP), which is the only path to an HTTP 429 here. A **successful** reset clears the account's login brute-force counters (BR-212) and its own request counter, so a user who reset precisely because they were locked out can sign in immediately and is not throttled out of a later legitimate request. |
| BR-266 | **Email confirmation is send-only** (ADR-116). Every local registration schedules a confirmation email (a single-use link to the anonymous `/confirm-email` page, which reads the token from the URL fragment; the token lives 24 hours by default), and `POST /auth/send-email-confirmation` / `POST /auth/confirm-email` request and redeem a link. Sign-in is **not** gated on confirmation (`RequireConfirmedEmail` is false in every environment), because an attendee registering on the conference floor has to use the app before reaching their inbox. An account created from a provider-verified external sign-in starts confirmed. |
| BR-267 | **External sign-in** (Google, GitHub, Sign in with Apple) creates a new account with no local password, or attaches the provider identity to an existing account with the same email **only** when the provider asserted the address as verified **and** that account has no local password. An account with a local password must be signed into with it (`Auth.ExternalLinkRequiresLocalSignIn`); an unverified address cannot claim an existing account (`Auth.ExternalEmailNotVerified`); an account holds one provider identity (`Auth.ExternalProviderAlreadyLinked`). Tokens never travel in the redirect URL: the callback hands the UI a single-use code that is exchanged through `POST /auth/oauth/exchange`. |

---

### 12.7 Password Management

**Password change** (UC-33) is supported via `PUT /auth/password`, authenticated users can change their own password by providing the current password and a new password.

**Password reset via email** (UC-34, UC-35) is the recovery path: an attendee who forgets their password recovers the account themselves, without deleting the account (UC-21) and re-registering. A reset also revokes every refresh session of the account.

**Flow:**
1. `POST /auth/forgot-password` with `{ "email": "..." }` → **HTTP 202** for every well-formed request, whether or not the address belongs to an account (BR-217). A malformed address returns HTTP 400 from the request validator, which inspects the shape of the address only.
2. The system emails a reset link (`{PasswordReset:ResetUrl}?email=...&token=...`) **and** the raw token in the body, so a client that cannot follow a deep link (the MAUI head) can have the token typed into the reset page by hand. With no `ResetUrl` configured the email degrades to the token alone rather than carrying a broken link.
3. `POST /auth/reset-password` with `{ "email": "...", "token": "...", "newPassword": "..." }` → **HTTP 204** on success. Every rejection collapses to the single generic `Auth.InvalidResetToken` HTTP 401 (BR-218). A new password that fails BR-203 returns HTTP 400 from the same strength rules that guard registration, so a reset is not a way around the complexity policy.

Both endpoints are `AllowAnonymous` (the caller has lost the credential, so requiring one would be circular), carry the same `auth-ip` per-IP rate limit as login and register, and are `[Idempotent]`. They are served by a dedicated `PasswordResetController` routed to the same `Auth` prefix as the other auth actions, so the Gateway forwards them on its `/Auth` catch-all route (only login and register carry the tighter `auth-tight` edge policy).

**Token storage:** reset tokens live in the cache, not the database, so the feature adds **no schema change and no migration**: expired tokens are reaped by cache TTL rather than by a sweeper. The trade-off is that a cache eviction or flush invalidates every outstanding token; requesting a new link is cheap, so the failure mode is a repeated request rather than a locked-out account.

**UI:** the framework UI package ships `/forgot-password` and `/reset-password` as anonymous pages, plus the "Forgot password?" link on `/login`. The reset page prefills `email` and `token` from the URL **fragment** (`location.hash`, which browsers never send to a server) and scrubs the fragment once read, so a live single-use token stays out of ingress access logs, request telemetry and the `Referer` header; `/reset-password` additionally answers `Referrer-Policy: no-referrer` and `Cache-Control: no-store` (ADR-023). The token field stays visible and editable, so the manual-entry path works when the link cannot be followed. Email copy is localized per recipient (English and Spanish resources, ADR-027): the subject and body are composed in the account's stored `PreferredCulture`, falling back to the request culture; the subject, body, and link composition remain overridable hooks on the handler.

**Configuration:** section `PasswordReset` (`ResetUrl`, `TokenLifetimeMinutes`, `MaxValidationAttempts`, `MaxRequestsPerEmail`, `RequestWindowMinutes`), bound with data-annotation validation at startup. `ResetUrl` is deliberately optional so a host without a UI base still boots; production sets it through the `PasswordReset__ResetUrl` container-app environment variable, and the Aspire AppHost sets it for local runs.

See [ADR-091](../adr/091-cache-backed-password-reset.md) for the decision record behind the token substrate, the anti-enumeration contract, and the email-delivery posture.

---

### 12.8 Design Rationale

**Why email + password instead of device-based identity:**

The original device-based registration model was designed for a mobile-only app where frictionless registration was paramount. With the addition of a web UI, device identity becomes untenable: browsers have no stable device identifier. Email is the natural cross-platform identity anchor: it works on both web and mobile, enables speaker linking (speakers already have email in Sessionize), and is familiar to all users.

**Why email + password instead of magic link:**

Magic link requires email delivery infrastructure for every login, not just for password resets. At a conference venue with spotty WiFi, waiting for an email to arrive is real friction. Email + password authentication works instantly once registered, requires no external email service for the core auth flow, and uses the same flow on both MAUI and web: simplifying the shared Razor library.

**Why speaker is a claim, not a role:**

Roles (`Attendee`, `ContentEditor`, `Organizer`) are permission tiers: each role is granted a set of permissions, and each permission unlocks a set of endpoints. Speaker is an identity link: it means "this user is the same person as this Speaker entity." A speaker is also an attendee (they attend sessions, give feedback, bookmark talks). A speaker could also be an organizer. Making speaker a role would create awkward combinations (Attendee+Speaker? Organizer+Speaker?) and conflate identity with authorization. Keeping it as a JWT claim is orthogonal to the role system.

**Why refresh tokens on every platform, and never a stored password:**

Access tokens live 15 minutes, so every client needs a silent way to stay signed in for the conference duration. A rotating 7-day refresh token does that without keeping the user's password anywhere on the device: MAUI holds the token pair in SecureStorage, and the web host holds it in HttpOnly cookies that page script cannot read. Because each sign-in is its own server-side session, a lost phone is signed out from another device (`POST /auth/revoke/{sessionId}`) without touching the others, and a stolen, replayed token is detected and kills the whole family (BR-206).

**Why the device is recorded on the session, not the user:**

A user signs in from several devices at once, so one set of device columns on the User record could describe only one of them. Each refresh session records the user agent and IP it was opened from instead (the MAUI app sends a user agent naming the app and OS), which is what the signed-in devices list shows. The `Device*` columns remain on the User record but no endpoint writes them; push notification targeting uses its own device installation registration (`PUT /Notifications/Devices`).
