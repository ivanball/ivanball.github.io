# ADC (Atlanta Developers Conference) - Business Specifications

---

## 1. System Overview

### Purpose
ADC is a conference management system for the **Atlanta Developers Conference**. It provides backend services to manage multi-day conference events, sessions, speakers, rooms, categories, and attendee feedback (question/answer surveys for events, sessions, and speakers). It supports user registration via email + password authentication (with optional MAUI device metadata) and integrates with the **Sessionize** platform to import conference schedule data (including speaker social links and questions).

### Core Business Domains (organized by bounded context)

**Conference** (master schedule data — organizer-managed, Sessionize-imported):
- **Event Management** - Creating and managing conference events, rooms, sessions, and speakers
- **Speaker & Category Management** - Organizing speakers by categories (e.g., track, level, tags)
- **Feedback Collection** - Gathering attendee ratings and comments on events, individual sessions, and speakers
- **External Data Sync** - Importing conference data from Sessionize

**Engagement** (attendee-generated activity — user-facing):
- **Personal Schedule** - Attendee session bookmarking

**Identity** (identity and authentication):
- **User Management** - Email + password registration, JWT authentication, and role-based authorization

### Key Capabilities
1. Full CRUD lifecycle for events, sessions, speakers, rooms, categories, and questions
2. Attendee survey/feedback submission scoped to the authenticated user (events, sessions, and speakers)
3. One-click data refresh from Sessionize to sync categories, speakers, rooms, sessions, and speaker social links
4. Paginated, filterable, sortable querying across all entities with lookup support
5. JWT-based email + password authentication for web and mobile attendees
6. Personal schedule builder with session bookmarking
7. Multi-day event support with per-event time zone configuration
8. Venue and room wayfinding information (floor, location, capacity, venue address, map URL)
9. Event publish/unpublish control for organizers
10. Room and session accessibility information for attendees with disabilities
11. Live stream and recording URLs for sessions
12. Plenum session designation for plenary/all-hands sessions
13. Top/featured speaker designation

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
| TimeZone | The IANA time zone identifier for the event's location (e.g., "America/New_York") (required). All session times are interpreted in this time zone. Used for server-side time comparisons in session feedback availability. |
| SessionizeCode | Integration code used to fetch data from the Sessionize API (optional) |
| VenueAddress | Physical address of the conference venue (optional) |
| VenueMapUrl | URL to a venue map or floor plan (optional) |
| WiFiInfo | WiFi network name and access instructions for attendees (optional) |
| IsPublished | Whether the event is visible to all users (default: false). When false, the event is visible only to organizers. When true, the event is visible to all users via public endpoints. |
| LastSessionizeRefreshOn | Timestamp of the most recent Sessionize data refresh for this event (nullable). Used to enforce the refresh throttle (BR-63). |
| LastSessionizeRefreshBy | User ID of the organizer who triggered the most recent Sessionize refresh (nullable). |

**Relationships:**
- Owns many **Rooms** (child entities)
- Owns many **EventSpeakers** (child join entities linking Event ↔ Speaker)
- Owns many **EventQuestionAnswers** (child feedback entities)
- Has many **Sessions** (associated by EventId)

**Lifecycle:** Created manually or seeded. May be refreshed from Sessionize when SessionizeCode is set.

---

#### Session (Aggregate Root)

| Attribute | Meaning |
|---|---|
| Title | The name/title of the session (required) |
| Description | Detailed description of the session content (optional) |
| StartsAt | Scheduled start time (optional, set during scheduling) |
| EndsAt | Scheduled end time (optional, set during scheduling) |
| Status | Current status of the session, imported from Sessionize. Default: null (manually created sessions have no status). The system recognizes six Sessionize status values: `Accepted` (confirmed), `Waitlisted` (on waitlist), `Accept Queue` (queued for acceptance review), `Nominated` (nominated for consideration), `Decline Queue` (queued for decline review), and `Declined` (rejected). Only `Accepted` and null statuses are eligible for public display, bookmarking, and feedback (BR-49). All other statuses are excluded from public views and engagement actions. |
| IsInformed | Whether the speaker has been informed about the session status |
| IsConfirmed | Whether the speaker has confirmed their participation |
| IsServiceSession | Whether this is a non-talk session (e.g., lunch break, registration, networking). Service sessions are displayed on the schedule but are not bookmarkable and do not support feedback. Default: false. Note: keynotes are typically not service sessions — they are talks with speakers. |
| IsPlenumSession | Whether this is a plenum (plenary/all-hands) session (default: false). Informational — used for display purposes to distinguish plenary sessions from breakout sessions. Imported from Sessionize when available. |
| LiveUrl | URL to a live stream for the session (optional). Allows attendees to watch the session remotely. Displayed alongside session details when present. |
| RecordingUrl | URL to a recording of the session (optional). Typically populated after the session concludes. Displayed alongside session details when present. |
| AccessibilityInfo | Description of accessibility accommodations for this session (optional, e.g., "Live captioning provided", "Sign language interpreter available"). Informational — displayed to attendees for planning. |
| ResourceLinks | Free-text field for speakers to share supplementary links (slides, code repos, blog posts). Optional. Displayed to attendees alongside session details. |
| Duration | Computed: `EndsAt - StartsAt` when both are non-null, null otherwise. Read-only, no database column. Serialized in DTOs as total minutes (e.g., `60`). Cannot be used for database-level filtering or sorting. |

**Relationships:**
- Belongs to one **Event** (required)
- May be assigned to one **Room** (optional)
- Owns many **SessionSpeakers** (child join entities linking Session ↔ Speaker)
- Owns many **SessionQuestionAnswers** (child feedback entities)
- Owns many **SessionCategoryItems** (child join entities linking Session ↔ CategoryItem)
- Referenced by many **UserSessionBookmarks** (Engagement context — own aggregate root)

---

#### Speaker (Aggregate Root)

| Attribute | Meaning |
|---|---|
| FirstName | Speaker's first name (required) |
| LastName | Speaker's last name (required) |
| Email | Speaker's email address (optional, imported from Sessionize). Not exposed via public API — used only for organizer management. |
| Bio | Speaker biography (optional) |
| TagLine | Short tagline or title (optional) |
| ProfilePicture | URL to the speaker's profile picture (optional) |
| TwitterHandle | Speaker's Twitter/X handle (optional, imported from Sessionize) |
| LinkedInUrl | URL to speaker's LinkedIn profile (optional, imported from Sessionize) |
| GitHubUrl | URL to speaker's GitHub profile (optional, imported from Sessionize) |
| WebsiteUrl | URL to speaker's personal website or blog (optional, imported from Sessionize) |
| IsTopSpeaker | Whether the speaker is a featured/top speaker (default: false). Used for display purposes to highlight keynote or featured speakers. Imported from Sessionize when available. |
| LinkedUserId | FK to User entity (optional, unique when non-null). Set when a user is linked to this speaker. 1:1 relationship with `User.LinkedSpeakerId`. See Section 12.4. |
| FullName | Computed: "{FirstName} {LastName}" |

**Relationships:**
- Has many **EventSpeakers** (events the speaker participates in)
- Has many **SessionSpeakers** (sessions the speaker presents)
- Owns many **SpeakerCategoryItems** (child join entities linking Speaker ↔ CategoryItem)
- Owns many **SpeakerQuestionAnswers** (child feedback entities for speaker-level survey responses)
- May be linked to one **User** (via LinkedUserId — 1:1, see Section 12.4)

**Lifecycle:** `Speaker.Create(id?, firstName, lastName, email?, bio?, tagLine?, profilePicture?, isTopSpeaker)` sets core identity fields. Social links (TwitterHandle, LinkedInUrl, GitHubUrl, WebsiteUrl) and LinkedUserId are set only via `Update()` — they are not accepted at creation time. This reflects the typical flow: speakers are created during Sessionize import with basic profile data, and social links are populated in a subsequent update pass.

---

#### Category (Aggregate Root)

| Attribute | Meaning |
|---|---|
| Title | Name of the category (e.g., "Session format", "Level", "Track") (required) |
| Sort | Display order |
| Type | Category type classifier (optional) |

**Relationships:**
- Owns many **CategoryItems** (child entities — the values within this category)

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
| Name | Room name or number (required) |
| Sort | Display order for room listing |
| Capacity | Maximum seating capacity of the room (optional, integer). Displayed to attendees for planning purposes. |
| Floor | Floor number or level name within the venue (optional, e.g., "2", "Mezzanine"). Used for wayfinding. |
| Location | Descriptive location within the venue (optional, e.g., "East Wing", "Near Registration Desk"). Used for wayfinding. |
| AccessibilityInfo | Description of accessibility features for the room (optional, e.g., "Wheelchair accessible, hearing loop available, reserved seating for mobility aids"). Informational — displayed to attendees for planning. |

**Relationships:**
- Belongs to one **Event** (required)
- Has many **Sessions** (sessions scheduled in this room)

---

#### Question

| Attribute | Meaning |
|---|---|
| QuestionText | The survey question text (required) |
| QuestionEntity | Indicates whether the question targets "Session", "Event", or "Speaker" (required — determines which survey the question appears in; see BR-15) |
| QuestionType | The answer format: "Rating" (numeric score), "Text" (free-text comment), or "Email" (email address). Determines answer validation: Rating answers must be integers 1–5, Text answers are free-text (max 2000 chars), Email answers must be valid email format. Unrecognized values are rejected. (required) |
| Sort | Display order of the question in the survey |
| IsRequired | Whether the attendee should answer this question (default: false). Advisory — clients should enforce in the UI, but the server does not validate completeness (BR-95). |
| QuestionSource | The origin of the question: "Sessionize" (imported from Sessionize during refresh) or "User" (created manually by an organizer). Required, case-insensitive. Determines provenance tracking — Sessionize-sourced questions follow the Sessionize source-of-truth rule (BR-48) during refresh, while User-sourced questions are unaffected by Sessionize refresh. |

**Relationships:**
- Has many **EventQuestionAnswers**
- Has many **SessionQuestionAnswers**
- Has many **SpeakerQuestionAnswers**

---

#### EventQuestionAnswer

| Attribute | Meaning |
|---|---|
| AnswerValue | The attendee's response (required) |

**Relationships:**
- Belongs to one **Event** (required)
- Belongs to one **Question** (required)

**Note:** Exposes a computed `QuestionType` derived from the associated Question.

---

#### SessionQuestionAnswer

| Attribute | Meaning |
|---|---|
| AnswerValue | The attendee's response (required) |

**Relationships:**
- Belongs to one **Session** (required)
- Belongs to one **Question** (required)

**Note:** Exposes a computed `QuestionType` derived from the associated Question.

---

> **Join Entity Convention:** All join entities below are pure association records with no business attributes beyond their foreign keys. They support **add and delete only** — update is not meaningful when there are no mutable attributes. To change an association, delete and re-create it.

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
| AnswerValue | The attendee's response (required) |

**Relationships:**
- Belongs to one **Speaker** (required)
- Belongs to one **Question** (required)

**Note:** Exposes a computed `QuestionType` derived from the associated Question. Speaker-level feedback enables attendees to rate and comment on individual speakers independently of specific sessions.

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
- The session's EventId is **not denormalized** onto the bookmark — it is derived from `Session.EventId` when needed via a join, avoiding inconsistency if a session were reassigned

---

### Bounded Context: Identity

#### User (Aggregate Root)

| Attribute | Meaning |
|---|---|
| Email | User's email address (required, unique, case-insensitive). Canonical identity across all platforms. |
| PasswordHash | Cryptographic hash of the user's password (byte[], stored as varbinary). Never stored or transmitted in plaintext. |
| PasswordSalt | Per-user cryptographic salt for password hashing (byte[], stored as varbinary). |
| FirstName | User's first name (required). Used for display and speaker matching. |
| LastName | User's last name (required). Used for display and speaker matching. |
| Role | The user's authorization role: `Attendee` (default) or `Organizer`. Determines access to administrative endpoints. |
| LinkedSpeakerId | FK to Speaker entity (optional, unique when non-null). Set when user is linked to a speaker (automatic or manual). See Section 12.4. |
| RefreshToken | Current refresh token string (optional). Null when no active token or after revocation. |
| RefreshTokenExpiry | UTC expiry time for the current refresh token (optional). |
| FullName | Computed: "{FirstName} {LastName}". Read-only, no database column. |
| DeviceId | Device identifier from MAUI clients (optional, string). Stored as metadata for analytics; not used for authentication. |
| DeviceFormFactor | Form factor (e.g., phone, tablet) (optional, MAUI only) |
| DevicePlatform | OS platform (e.g., iOS, Android) (optional, MAUI only) |
| DeviceModel | Device model name (optional, MAUI only) |
| DeviceManufacturer | Device manufacturer (optional, MAUI only) |
| DeviceName | User-facing device name (optional, MAUI only) |
| DeviceType | Device type classification (optional, MAUI only) |

**Relationships:**
- Referenced by many **UserSessionBookmarks** (Engagement context)
- May be linked to one **Speaker** (via LinkedSpeakerId — 1:1, see Section 12.4)

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

---

### Value Objects

| Value Object | Description | Invariants |
|---|---|---|
| **DateRange** | A range between two dates (DateOnly). Used by `Event.StartDate`/`Event.EndDate`. | End must be >= Start |
| **DateTimeRange** | A range between two date-times | End must be >= Start |

---

## 3. Business Rules

### Explicit Rules

> **Reading guide:** Some rules reference other rules defined later in the document (e.g., BR-63, BR-80 are defined in Section 10). Forward references use the `BR-*` numbering consistently — search for the number to find the full definition.

> **Numbering convention:** Business rule numbers (BR-\*) are not sequential. Rules are numbered in the order they were identified during iterative specification development. Gaps (e.g., BR-23 through BR-40 do not exist) and out-of-sequence additions (e.g., BR-127 was added after BR-129) are intentional — renumbering would break cross-references throughout the document. Rules numbered BR-200+ are grouped in Section 12 (Authentication & Identity Architecture) and address the email-based identity model.

| # | Rule |
|---|---|
| BR-1 | All entities use **soft delete** — records are never physically removed; the `IsDeleted` flag is set to true |
| BR-2 | A child entity must belong to its specified aggregate root; the parent ID in the child must match the aggregate root ID |
| BR-3 | The aggregate root must exist before a child entity can be added, updated, or deleted |
| BR-4 | When updating a child entity, the child must already exist in the aggregate's collection (matched by ID) |
| BR-5 | When deleting a child entity, the child must exist in the aggregate's collection |
| BR-6 | Sessionize data refresh requires a non-empty `SessionizeCode` on the event |
| BR-7 | Sessionize refresh is **idempotent**: existing entities (matched by ID) are updated, new ones are added, duplicates are skipped |
| BR-8 | Event question answers are **scoped to the authenticated user** for Attendees — attendees can only see their own answers. Organizers can read all answers for moderation purposes (BR-53, Section 11.9). Speakers can view feedback on their own sessions (BR-210). |
| BR-9 | Session question answers are **scoped to the authenticated user** for Attendees — attendees can only see their own answers. Organizers can read all answers (BR-53, Section 11.9). Speakers can view feedback on sessions they present (BR-210). |
| BR-10 | PUT requests require the route ID to match the entity ID in the request body |
| BR-11 | Pagination page size is capped at **500 items** maximum |
| BR-12 | JWT tokens expire after **1 hour** from issuance |
| BR-13 | A `DateRange` end date must be greater than or equal to the start date |
| BR-14 | A `DateTimeRange` end must be greater than or equal to the start |
| BR-15 | `Question.QuestionEntity` is required and must be exactly `"Session"`, `"Event"`, or `"Speaker"` (**case-insensitive** — `"session"`, `"EVENT"`, `"Speaker"` are all accepted and stored as the canonical casing). Questions without a target entity type are rejected. Unrecognized values are rejected with HTTP 422. |
| BR-16 | Features requiring session time windows (session feedback submission) are unavailable when a session's `StartsAt` or `EndsAt` is null. The UI should hide time-gated actions for unscheduled sessions. All server-side time comparisons for time-gated features use the event's configured `TimeZone` (see Event entity). |
| BR-17 | Business rule violations are treated as client errors (HTTP 400) |
| BR-18 | Pagination metadata values (TotalItemCount, PageSize, CurrentPage) must be non-negative |
| BR-19 | CategoryItem `Name` is required and cannot be null |
| BR-20 | API rate limit: **100 requests per minute** per client, with a queue of 2 |
| BR-21 | A user can bookmark a session only once — unique per (UserId, SessionId) |
| BR-22 | Bookmarking a session does not reserve a seat; it is informational only |
| BR-41 | Conference write endpoints (Event, Session, Speaker, Room, Category, Question CRUD and Sessionize refresh) require the **Organizer** role |
| BR-42 | Engagement write endpoints (bookmarks, feedback submission) require **authentication** but not the Organizer role — any authenticated user can perform these actions |
| BR-43 | Read endpoints for Conference entities (events, sessions, speakers, rooms, categories) are **publicly accessible** without authentication |
| BR-45 | New users default to the `Attendee` role. Users can be promoted to `Organizer` by database seeding. |
| BR-48 | Sessionize refresh overwrites all **field values** on matched entities (matched by Sessionize ID). Manual edits made after the last sync are replaced on the next refresh — **Sessionize is the source of truth** for field content on imported entities. Sessionize does not control entity lifecycle — entities absent from a Sessionize response are not deleted (see BR-62). |
| BR-49 | `Session.Status` recognizes six Sessionize status values: **`Accepted`** — session is confirmed and appears on the public schedule; it is bookmarkable and eligible for feedback. **`Waitlisted`** — session is on the waitlist, pending a slot. **`Accept Queue`** — session is queued for acceptance review. **`Nominated`** — session has been nominated for consideration. **`Decline Queue`** — session is queued for decline review. **`Declined`** — session was rejected. Only **`Accepted`** sessions appear on the public schedule and are eligible for bookmarking and feedback. All other statuses (`Waitlisted`, `Accept Queue`, `Nominated`, `Decline Queue`, `Declined`) are excluded from public views (filtered from GET list responses for non-organizers) and cannot be bookmarked or receive feedback. Unknown values from Sessionize are stored as-is and treated as ineligible — they are excluded from public views and engagement actions. **Null status** (the default for manually created sessions) follows `Accepted` rules — the session is visible, bookmarkable, and eligible for feedback. |
| BR-50 | `Question.QuestionType` must be one of: `Rating`, `Text`, `Email` (**case-insensitive** — matching uses `OrdinalIgnoreCase`). These determine answer validation (BR-124) for all question answer types (EventQuestionAnswer, SessionQuestionAnswer, SpeakerQuestionAnswer). Unrecognized values are rejected. |
| BR-51 | The Organizer role grants read access to a paginated user list, filterable by Email, FirstName, LastName, and Role. The response includes UserId, Email, FirstName, LastName, Role, and CreatedOn. Device-specific fields are excluded from the response to protect attendee device privacy. |
| BR-52 | Attendees can only update (`PUT`) or delete (`DELETE`) EventQuestionAnswer and SessionQuestionAnswer records where `CreatedBy` matches their authenticated user ID. Attempting to modify another user's answer returns HTTP 403. The `POST`-as-upsert endpoint (BR-107) always operates on the authenticated user's own answers — `CreatedBy` is set from the JWT, never from the request body. |
| BR-53 | Organizers can update (`PUT`) or delete (`DELETE`) any EventQuestionAnswer or SessionQuestionAnswer regardless of `CreatedBy`, enabling content moderation (e.g., removing inappropriate text responses). Organizer moderation uses `PUT`/`DELETE` by the answer's ID — the `POST`-as-upsert endpoint still keys on the organizer's own `CreatedBy`, so it cannot overwrite another user's answer via POST. |
| BR-55 | Soft-deleting a Session cascade soft-deletes all owned child entities (SessionSpeakers, SessionQuestionAnswers, SessionCategoryItems). |
| BR-56 | Soft-deleting a User soft-deletes the User record and revokes the user's refresh token (preventing further token refresh). Raises `UserDeleted` domain event. Engagement data (bookmarks) is retained but excluded from user-facing queries. |
| BR-58 | Engagement list endpoints support pagination (subject to the 500-item cap in BR-11) and filtering: bookmarks by `EventId` (derived via Session join) |
| BR-60 | Domain events are raised for entity mutations. **Child entity** changes raise a `*Changed` domain event carrying `DomainEntityState` (Added/Updated/Deleted). **Aggregate root** lifecycle changes raise both a `*Created` event on creation and a `*Changed` event (with DomainEntityState Updated/Deleted) on update or deletion. **Exception:** `UserSessionBookmark` uses a single `UserSessionBookmarkChanged` event with `DomainEntityState` (Added/Deleted) instead of separate Created/Changed events — bookmarks have no update operation and no distinct handler requirements for creation vs. deletion, so a single event with state discrimination is sufficient. Current domain events — **Aggregate root lifecycle:** `EventCreated`, `EventChanged`, `SessionCreated`, `SessionChanged`, `SpeakerCreated`, `SpeakerChanged`, `CategoryCreated`, `CategoryChanged`, `QuestionCreated`, `QuestionChanged`, `UserSessionBookmarkChanged`, `UserRegistered`, `UserPasswordChanged`, `UserDeleted`. **Child entity changes:** `RoomChanged`, `CategoryItemChanged`, `EventQuestionAnswerChanged`, `EventSpeakerChanged`, `SessionCategoryItemChanged`, `SessionQuestionAnswerChanged`, `SessionSpeakerChanged`, `SpeakerCategoryItemChanged`, `SpeakerQuestionAnswerChanged`. Not all events have registered handlers — events without handlers serve as extension points for future requirements. See Section 6 for handler details. |
| BR-86 | `Event.StartDate` and `Event.EndDate` form a `DateRange`. An event may span one or more days. For single-day events, `StartDate` equals `EndDate`. Session `StartsAt`/`EndsAt` values should fall within the event's date range, but this is not enforced as a hard constraint — Sessionize-imported sessions may have slightly misaligned dates due to timezone handling. **Date comparison semantics:** The date portion of `Session.StartsAt` and `Session.EndsAt` (which are `DateTime` values in the event's local time zone) is compared against the event's `DateOnly` `StartDate`/`EndDate`. A session is considered outside the range if `StartsAt.Date < StartDate` or `EndsAt.Date > EndDate`. Sessions crossing midnight (ending after the event's `EndDate`) trigger the warning but are not rejected — this accommodates late-evening sessions. **Validation behavior:** When a session is created or updated with times outside the event's date range, the operation succeeds but the API response includes a warning header (`X-Warning: Session time falls outside the event's date range`). Sessionize imports log the same warning without blocking the import. |
| BR-87 | `Event.TimeZone` is a required IANA time zone identifier (e.g., "America/New_York", "Europe/London"). Session `StartsAt` and `EndsAt` values are stored as `DateTime` representing **local time in the event's time zone** (not UTC, not `DateTimeOffset`). The `TimeZone` value is validated against the IANA time zone database. See section 10.20 for full storage semantics. |
| BR-91 | `Session.IsServiceSession` defaults to false. Service sessions (`IsServiceSession = true`) are non-talk schedule entries (e.g., lunch break, registration, networking) that are displayed on the schedule but **cannot** be bookmarked or receive feedback. Attempts to create a `UserSessionBookmark` or `SessionQuestionAnswer` for a service session return HTTP 400 with detail "This action is not available for service sessions." Service sessions may still have rooms and time slots assigned. Sessionize imports set `IsServiceSession` based on the Sessionize `isServiceSession` flag. Note: keynotes are typically **not** service sessions — they are talks with speakers that attendees may want to bookmark and rate. |
| BR-93 | `Room.Capacity` is an optional positive integer. When present, it is displayed to attendees alongside room information. There is no system-enforced capacity limit. |
| BR-94 | `Room.Floor` and `Room.Location` are optional wayfinding fields displayed to attendees alongside session details. They have no behavioral significance — they are informational only. |
| BR-95 | `Question.IsRequired` defaults to false. When true, clients should prompt the user to answer this question before submitting. This is advisory — the server does not enforce required-question validation. |
| BR-98 | `Event.VenueAddress`, `Event.VenueMapUrl`, and `Event.WiFiInfo` are optional informational fields with no behavioral significance. They are included in event read responses. `VenueMapUrl` must be a valid absolute URL when provided. |
| BR-99 | Speaker social link fields (`TwitterHandle`, `LinkedInUrl`, `GitHubUrl`, `WebsiteUrl`) are imported from Sessionize during refresh (UC-6). Sessionize exports these as "links" associated with speaker profiles. `TwitterHandle` stores the handle only (without the "@" prefix or full URL). `LinkedInUrl`, `GitHubUrl`, and `WebsiteUrl` must be valid absolute URLs when provided. Social links are included in public speaker read responses. **Format rationale:** `TwitterHandle` stores the handle rather than a full URL because Sessionize exports Twitter/X identifiers as handles, and the platform URL has changed (twitter.com to x.com). Storing the handle lets clients construct the correct URL. If Sessionize changes its export format to full URLs in the future, this field can be updated to store URLs like the other social link fields. |
| BR-101 | **Data retention:** All data (active and soft-deleted) is retained indefinitely. Soft-deleted records remain in the database but are excluded from all queries. There is no automated purge or archival process. |
| BR-102 | Feedback for multi-speaker sessions is at the **session level**, not per-speaker. All speakers assigned to a session via `SessionSpeaker` share the same feedback data. Per-speaker feedback within a session is a potential future enhancement. |
| BR-107 | **Feedback submission:** Feedback (EventQuestionAnswer, SessionQuestionAnswer, or SpeakerQuestionAnswer) is submitted per-question via the entity's `POST` endpoint. Each answer is a `{ QuestionId, AnswerValue }` pair associated with the target entity and the authenticated user. `POST` performs an **upsert**: if no answer exists for the (CreatedBy, QuestionId, EntityId) combination, a new record is created (HTTP 201); if one already exists, its `AnswerValue` is overwritten and the response is HTTP 200. This is not standard create-only semantics — `POST` is explicitly an upsert to simplify the client (no need to check existence or switch between POST/PUT). `PUT` on an existing answer also updates it (standard update). **Deferred capability:** SpeakerQuestionAnswer exists in the domain model only; no REST controller or attendee UI ships today (see §10.29), so only the Event and Session answer endpoints are live. |
| BR-108 | **Event visibility:** `Event.IsPublished` controls public visibility. Unpublished events (default) are visible **only to organizers** — public read endpoints (BR-43) exclude them. Published events (`IsPublished = true`) are visible to all users. Only organizers can change event visibility via `POST /api/events/{id}/publish` and `POST /api/events/{id}/unpublish`. These are action endpoints (state transitions), not resource replacements, so they use POST rather than PUT. No request body is required. |
| BR-111 | `Room.AccessibilityInfo` is an optional free-text field describing accessibility features (e.g., "Wheelchair accessible, hearing loop available"). Displayed to attendees alongside room information. Informational only — no behavioral significance. |
| BR-112 | `Session.AccessibilityInfo` is an optional free-text field describing accessibility accommodations (e.g., "Live captioning provided, sign language interpreter available"). Displayed to attendees alongside session details. Informational only. |
| BR-114 | `Session.Duration` is a **read-only computed property** — calculated as the difference between `EndsAt` and `StartsAt` in total minutes (e.g., `60`). Returns null when either `StartsAt` or `EndsAt` is null. Serialized in DTOs but has no database column. Cannot be used for database-level filtering or sorting. |
| BR-116 | **Image hosting (amended 2026-07-11, ADR-045):** Speaker profile pictures (`ProfilePicture`) and venue maps (`VenueMapUrl`) remain **externally hosted URLs** (speaker images imported from Sessionize). The former blanket "no managed file upload service" rule is superseded for USER AVATARS by BR-116a; no other managed uploads exist. |
| BR-116a | **User avatar photos (added 2026-07-11, ADR-045):** an authenticated user may set ONE avatar photo on their own account via `POST /Users/me/avatar` (multipart, max 2 MB; jpeg/png/webp accepted by magic-byte sniffing) and remove it via `DELETE /Users/me/avatar` (idempotent). The server re-encodes every upload to a 256x256 JPEG (EXIF and all metadata stripped; the original is never stored) and stores it in the public-read `avatars` blob container under `{userId}-{random8}.jpg`; a replacement deletes the previous blob. `User.AvatarUrl` is PII: exported in the GDPR data export, nulled on anonymize with the blob deleted. |
| BR-120 | **Organizer action traceability:** Sensitive organizer actions (session status changes, event status changes, Sessionize refresh) are traceable via the auditable fields (`CreatedBy`, `CreatedOn`, `LastModifiedBy`, `LastModifiedOn`) on affected entities. Sessionize refresh timing is tracked via `Event.LastSessionizeRefreshOn` and `Event.LastSessionizeRefreshBy`. |
| BR-121 | **Sponsor/expo support** is out of scope for the current system. |
| BR-122 | **Session duration validation:** When a Session's `StartsAt` and `EndsAt` are both non-null, `EndsAt` must be **strictly greater than** `StartsAt` (not equal). A zero-duration session is invalid. **Two-tier enforcement:** (1) **API create/update** — enforced as a hard constraint; requests with `EndsAt <= StartsAt` are rejected with HTTP 422. (2) **Sessionize import** — validation is relaxed; sessions violating this constraint are stored as-is but flagged with a warning in the import response (import is not blocked — the organizer can correct the times manually). This two-tier approach exists because Sessionize is the source of truth and its data cannot be rejected without breaking the sync. |
| BR-123 | **Feedback answer uniqueness:** `EventQuestionAnswer` is unique per `(CreatedBy, QuestionId, EventId)` — an attendee can submit only one answer per question per event. `SessionQuestionAnswer` is unique per `(CreatedBy, QuestionId, SessionId)`. `SpeakerQuestionAnswer` is unique per `(CreatedBy, QuestionId, SpeakerId)`. If an attendee submits an answer when one already exists for that combination, the existing answer's `AnswerValue` is **overwritten**. |
| BR-124 | **Feedback answer validation:** `AnswerValue` validation depends on the associated Question's `QuestionType`: **Rating** — must be a numeric integer between 1 and 5 inclusive (1=Poor, 2=Below Average, 3=Average, 4=Good, 5=Excellent); non-numeric values or values outside this range are rejected (HTTP 422). **Text** — free-text with a maximum length of 2000 characters. **Email** — must contain exactly one `@` with a non-empty local part and a domain containing at least one `.` (standard `MailAddress` parsing); invalid format is rejected (HTTP 422). The Rating scale labels are a client-side display concern — the API validates only the 1–5 integer range. |
| BR-127 | **Cascade soft-delete on Event deletion:** When an Event is soft-deleted, all owned children and all Sessions belonging to the Event are cascade soft-deleted. See BR-72 (Section 10.8) for the complete cascade specification. |
| BR-128 | **Cross-entity foreign key validation:** When creating or updating an `EventQuestionAnswer`, the system validates that the referenced `QuestionId` exists and that the Question's `QuestionEntity` equals `"Event"`. When creating or updating a `SessionQuestionAnswer`, the system validates that `QuestionEntity` equals `"Session"`. When creating or updating a `SpeakerQuestionAnswer`, the system validates that `QuestionEntity` equals `"Speaker"`. Submitting an answer that references a non-existent Question or a Question targeting the wrong entity type returns HTTP 422 with detail "Question not found or does not apply to this entity type." |
| BR-129 | **Concurrency model:** The system uses **last-write-wins** semantics — no optimistic concurrency control (ETags, row versions) is enforced. Concurrent updates to the same entity overwrite each other without conflict detection. This is acceptable because: (1) Conference data is managed by a small number of organizers with low write frequency, (2) Sessionize refresh is the primary write path and is throttled per-event (BR-63), (3) Engagement writes (bookmarks, feedback) target distinct rows per user. If concurrent organizer editing becomes a problem, optimistic concurrency via EF Core row versions can be added without changing the API contract. **Sessionize refresh concurrency:** A Sessionize refresh writes many entities in a single transaction. If an organizer edits an entity while a refresh is in progress, last-write-wins applies — whichever transaction commits last determines the final state. The per-event throttle (BR-63) reduces but does not eliminate this window. Organizers should avoid manual edits immediately after triggering a refresh. |
| BR-130 | **Session.RoomId cross-event validation:** When a Session's `RoomId` is set (non-null), the referenced Room must belong to the same Event as the Session (`Room.EventId == Session.EventId`). Assigning a Room from a different Event is rejected with HTTP 422. This is enforced at the service layer during create and update. Sessionize imports always assign rooms within the correct event scope. |
| BR-131 | **Time zone change impact:** Changing `Event.TimeZone` on an event that already has sessions does **not** adjust stored `Session.StartsAt`/`Session.EndsAt` values — those values represent local time in the *original* time zone and become semantically incorrect under the new time zone. Organizers should only change `TimeZone` before sessions are scheduled, or trigger a Sessionize refresh (UC-6) afterward to re-import session times in the correct time zone. When an event already has sessions, changing `TimeZone` succeeds but the API response includes a warning header (`X-Warning: Event time zone changed — existing session times may be semantically incorrect. Consider triggering a Sessionize refresh.`). This is consistent with the date range warning behavior in BR-86. |
| BR-132 | **Session visibility inherits event visibility:** Sessions belonging to unpublished events are excluded from public list/lookup responses and single-entity GET responses for non-organizers. Organizers can see all sessions regardless of event visibility. This ensures consistency with the Event Lifecycle (Section 5) which states "Unpublished events and their sessions are visible only to organizers." Non-accepted sessions (BR-49 — any status other than `Accepted` or null) are also excluded from public responses. |
| BR-133 | **Soft-deleted user JWT validation:** Middleware must validate that the authenticated user's account has not been soft-deleted on every authenticated request. If `User.IsDeleted = true` for the `user_id` in the JWT, the request is rejected with HTTP 401. This is necessary because JWTs are stateless and remain valid until expiry (BR-12) — a soft-deleted user's token would otherwise grant access for up to 1 hour after deletion. The middleware check adds one database lookup per authenticated request, which can be mitigated with short-lived caching (e.g., 30-second cache of deleted user IDs). |
| BR-134 | **Publish validation:** Publishing an event (`POST /api/events/{id}/publish`) has **no minimum data requirements** — an event can be published with zero sessions, zero speakers, and zero rooms. This is a deliberate decision: organizers may want to publish an event early (for visibility) and populate the schedule later. Validation of schedule completeness is an organizer responsibility, not a system constraint. |

### Inferred Rules

| # | Rule | Reasoning |
|---|---|---|
| ~~IR-1~~ | ~~A user is uniquely identified by their email address~~ — **Promoted to explicit rule BR-200/BR-201.** See Section 12.1. | Now explicitly defined in authentication architecture |
| IR-2 | An EventSpeaker association is unique per (EventId, SpeakerId) pair | Duplicates are prevented during Sessionize import |
| IR-3 | A SpeakerCategoryItem is unique per (SpeakerId, CategoryItemId) pair | Duplicates are prevented during Sessionize import |
| IR-4 | Each question belongs to either Events or Sessions (determined by `QuestionEntity` field) | Questions are categorized by their target entity type |
| IR-5 | Categories are global (not event-scoped) — **multi-event risk:** see Category entity note and BR-74 | Categories have no EventId; they are shared across events. Safe when all events share one Sessionize source; risky with independent Sessionize sources per event. |
| IR-6 | A SessionSpeaker association is unique per (SessionId, SpeakerId) pair — a speaker can only be linked to the same session once | Duplicates would be meaningless; prevented during Sessionize import and manual assignment |
| IR-7 | A SessionCategoryItem association is unique per (SessionId, CategoryItemId) pair — a session can only be tagged with the same category item once | Duplicates would be meaningless; prevented during Sessionize import and manual assignment |

---

## 4. Use Cases / Business Processes

### UC-1: User Registration & Login

See **UC-30** (Registration) and **UC-31** (Login) in Section 12.2 for the current email + password authentication flows.

---

### UC-2: Browse Events

**Actors:** Attendee, API consumer
**Preconditions:** None (read endpoints do not require auth)

**Main Flow:**
1. Consumer requests list of events (with optional pagination, filtering, sorting)
2. System returns only published events for unauthenticated/attendee users (BR-108). Organizers also see unpublished events.
3. Response includes child data if requested (rooms, sessions, speakers, question answers)

**Alternate Flows:**
- Request a single event by ID
- Request events in lookup format (Id + Name pairs) for dropdown population — see section 11.7 for the lookup endpoint contract
- Request with `includeChildren=true` to get nested child entities (one level only, per BR-80)
- Filter by `IsPublished` to find published events

**Business Rules:** BR-43, BR-108

---

### UC-3: Browse Sessions

**Actors:** Attendee
**Preconditions:** Events exist in the system

**Main Flow:**
1. Consumer requests sessions with optional filtering/sorting
2. Sessions can be filtered by `EventName` or `RoomName` (mapped to navigation properties)
3. System returns sessions with optional children (speakers, category items, question answers)

---

### UC-4: Submit Event Feedback

**Actors:** Authenticated attendee
**Preconditions:** User is authenticated; Event exists and is Published (BR-108); Questions exist for `QuestionEntity = "Event"`

**Main Flow:**
1. Attendee submits feedback per-question via standard CRUD on EventQuestionAnswer (BR-107)
2. System validates each `AnswerValue` against the question's `QuestionType` (BR-124)
3. Each answer is associated with the event and question, with `CreatedBy` set to the current user ID
4. If the user has previously submitted an answer for the same (QuestionId, EventId), the existing answer is overwritten (BR-123)

**Business Rule:** Users can only view their own event feedback (BR-8). BR-107 (per-question submission).

---

### UC-5: Submit Session Feedback

**Actors:** Authenticated attendee
**Preconditions:** User is authenticated; Session and Questions exist; Session is not a service session (BR-91); Session status is Accepted or null (BR-49); Session's parent Event is Published (BR-108)

**Main Flow:**
1. Attendee submits feedback per-question via standard CRUD on SessionQuestionAnswer (BR-107)
2. System validates that the session is not a service session (BR-91) and has an eligible status — Accepted or null (BR-49)
3. System validates each `AnswerValue` against the question's `QuestionType` (BR-124)
4. Each answer is associated with the session and question, with `CreatedBy` set to the current user ID
5. If the user has previously submitted an answer for the same (QuestionId, SessionId), the existing answer is overwritten (BR-123)

**Business Rule:** Users can only view their own session feedback (BR-9). BR-107 (per-question submission).

---

### UC-6: Refresh Event Data from Sessionize

**Actors:** Organizer (via API call)
**Preconditions:** Event exists with a valid `SessionizeCode`; user has the Organizer role (BR-41)

**Main Flow:**
1. Organizer triggers refresh for a specific event (`POST /api/events/{id}/refresh`). This is a POST because it mutates server state (upserts entities); GET is not appropriate for write operations.
2. System checks the per-event throttle (BR-63) — if a refresh occurred within the last 5 minutes, returns HTTP 429 with `Retry-After` header
3. System retrieves the event and verifies it has a `SessionizeCode` (BR-6)
4. System calls the Sessionize "View All" API endpoint
5. System synchronizes data in order:
   a. **Categories and CategoryItems** — upsert (add if new, update if existing)
   b. **Questions** — upsert questions from Sessionize with `QuestionSource = "Sessionize"` (question definitions with text, type, and entity target)
   c. **Rooms** — upsert
   d. **Speakers** — upsert speakers (including social links: TwitterHandle, LinkedInUrl, GitHubUrl, WebsiteUrl, and `IsTopSpeaker` flag), create EventSpeaker links if not already linked, assign SpeakerCategoryItems, import SpeakerQuestionAnswers
   e. **Sessions** — upsert sessions (including `IsServiceSession`, `IsPlenumSession`, `LiveUrl`, `RecordingUrl` from Sessionize), create SessionSpeaker and SessionCategoryItem links
6. System updates `Event.LastSessionizeRefreshOn` and `Event.LastSessionizeRefreshBy`
7. All changes are persisted transactionally

**Alternate Flows:**
- If `SessionizeCode` is blank, returns HTTP 400 with detail "Event has no SessionizeCode configured"
- If the Sessionize API is unreachable (timeout, HTTP 5xx, DNS failure), returns HTTP 502 Bad Gateway with detail "Sessionize API is unavailable. Try again later." No partial data is persisted — the transaction is rolled back.
- If the Sessionize API returns an empty or null response, returns HTTP 200 with a response body indicating zero entities synced (not an error — the Sessionize event may have no data yet)

**Important:** Sessionize refresh **only** syncs Conference master data (categories, questions, rooms, speakers, sessions). User-generated data — EventQuestionAnswers, SessionQuestionAnswers, SpeakerQuestionAnswers, and UserSessionBookmarks — is **never modified** by a Sessionize refresh. Locally soft-deleted entities (BR-136) are skipped during refresh.

**Postconditions:** Local data reflects the current state of the Sessionize schedule.

**Response body** (`POST /api/events/{id}/refresh`, HTTP 200):

```json
{
  "categoriesSynced": 5,
  "categoryItemsSynced": 18,
  "questionsSynced": 6,
  "roomsSynced": 8,
  "speakersSynced": 42,
  "sessionsSynced": 35,
  "skippedSoftDeleted": 2,
  "warnings": [
    "Session 'Lightning Talk X' has zero duration (StartsAt equals EndsAt) — stored as-is per BR-122",
    "Skipped 2 soft-deleted entities present in Sessionize response (BR-136)"
  ]
}
```

- `*Synced` counts reflect total entities created or updated (not just new ones)
- `skippedSoftDeleted` counts entities present in Sessionize response but skipped because they are locally soft-deleted (BR-136)
- `warnings` lists non-fatal issues encountered during import (e.g., BR-122 duration violations, BR-136 soft-deleted skips). Empty array when no warnings.

---

### UC-7: Manage Event Rooms

**Actors:** Organizer
**Preconditions:** Event exists; user has the Organizer role (BR-41)

**Main Flow:**
1. Add a room to an event: system validates the room's EventId matches the parent event (BR-2), adds the room, raises `RoomChanged` domain event
2. Update a room: system locates the room by ID within the event's collection, replaces it (BR-4)
3. Delete a room: system soft-deletes the room (BR-1, BR-5)

---

### UC-8: Manage Categories and Category Items

**Actors:** Organizer
**Preconditions:** User has the Organizer role (BR-41); Category must exist for items

**Main Flow:**
1. Create a category with title, sort order, and optional type
2. Add category items (values) to the category
3. Add, update, or delete category items within the category

---

### UC-9: Manage Speaker Category Assignments

**Actors:** Organizer
**Preconditions:** User has the Organizer role (BR-41); Speaker and CategoryItem exist

**Main Flow:**
1. Assign a category item to a speaker via the Speaker aggregate
2. System validates the speaker exists and assigns the category item

---

### UC-10: View User Claims

**Actors:** Authenticated attendee
**Preconditions:** Valid JWT token

**Main Flow:**
1. Attendee calls `GET /api/userclaims`
2. System returns all claims embedded in the JWT (user_id, email, role, first_name, last_name, and optionally speaker_id)

---

### UC-11: Manage Personal Schedule (Session Bookmarks)

**Actors:** Authenticated attendee
**Preconditions:** User is authenticated; Sessions exist

**Main Flow:**
1. Attendee browses sessions (UC-3)
2. Attendee bookmarks a session (`POST /api/bookmarks` with UserId and SessionId)
3. System creates a `UserSessionBookmark` record (standalone aggregate root — not through the User aggregate)
4. Attendee views their personal schedule (`GET /api/bookmarks?userId={userId}`) — returns bookmarked sessions in chronological order

**Alternate Flows:**
- Attendee removes a bookmark (`DELETE /api/bookmarks/{bookmarkId}`)
- Attendee retrieves bookmarked session IDs for quick lookup (`GET /api/bookmarks/session-ids?userId={userId}`) — returns a dictionary of SessionId → BookmarkId for efficient UI rendering (e.g., toggle bookmark buttons)
- Attempting to bookmark the same session twice returns a conflict/duplicate error
- Attempting to bookmark a service session (`IsServiceSession = true`) returns HTTP 400 (BR-91)
- Attempting to bookmark a session with non-eligible status (anything other than Accepted or null) returns HTTP 400 (BR-49)
- Re-bookmarking a previously removed (soft-deleted) bookmark reactivates the existing record rather than creating a new one (BR-135)

**Postconditions:** User's personal schedule is updated.

**Business Rules:** BR-21, BR-22, BR-49, BR-91, BR-135

---

### UC-19: Manage Conference Entities (Standard CRUD)

**Actors:** Organizer
**Preconditions:** User has the Organizer role (BR-41)

**Scope:** This use case covers the standard create, update, and delete operations for Conference aggregate roots — **Event**, **Session**, **Speaker**, and **Question** — and their child entities managed through the parent aggregate. Read operations are public (BR-43).

**Main Flow:**
1. Organizer creates, updates, or deletes a Conference entity via the REST API
2. For aggregate roots: direct CRUD operations with soft delete (BR-1)
3. For child entities: operations routed through the parent aggregate — parent must exist (BR-3), child parent ID must match aggregate root ID (BR-2), child must exist for update (BR-4) or delete (BR-5)
4. Each mutation raises the appropriate domain event (see section 6)

**Note:** Operations with non-standard business logic are documented as individual use cases: room management (UC-7), category/item management (UC-8), speaker category assignments (UC-9), and Sessionize refresh (UC-6). The Actor-Action Matrix provides the complete enumeration of all actions.

**Business Rules:** BR-1 through BR-5, BR-10, BR-41

---

### UC-21: Delete User Account

**Actors:** Authenticated attendee (own account), Organizer (any account)
**Preconditions:** User is authenticated; target User exists

**Main Flow:**
1. Attendee requests account deletion (`DELETE /api/users/{userId}`)
2. System verifies the requesting user is either the account owner or has the Organizer role
3. System soft-deletes the User record (BR-1, BR-56)

**Alternate Flows:**
- Non-owner, non-organizer attempts deletion — system returns HTTP 403
- User does not exist — system returns HTTP 404
- User is already soft-deleted — system returns HTTP 200 (idempotent)

**Postconditions:** User can no longer authenticate.

**Business Rules:** BR-1, BR-56

---

### Actor-Action Matrix

This section maps every action in the system to the actor(s) that can perform it. Actions include formal use cases (UC-*), implicit CRUD from Key Capability #1, and capabilities mentioned in UC postconditions or business rules.

#### Actors

| Actor | Identity | Authorization | Additive? |
|---|---|---|---|
| **API Consumer** | Unauthenticated | None — public endpoints only (BR-43) | Base level |
| **Attendee** | Authenticated via email + password (UC-31) | Authenticated — valid JWT with `role: Attendee` (BR-42) | Includes all API Consumer actions |
| **Speaker** | Attendee with `speaker_id` claim | Same as Attendee + speaker-specific data views (BR-210) | Not a separate role — an Attendee with a speaker identity link |
| **Organizer** | Authenticated, `User.Role = Organizer` | Organizer role required (BR-41) | Includes all Attendee actions + all Speaker view access |
| **System** | Non-human — domain event handlers | N/A | Autonomous |

#### API Consumer (Unauthenticated)

| # | Action | Source | Endpoint Pattern |
|---|--------|--------|-----------------|
| 1 | List/page/filter/sort events | UC-2, BR-43 | `GET /api/events` |
| 2 | Get single event by ID | UC-2, BR-43 | `GET /api/events/{id}` |
| 3 | Get events in lookup format (Id + Name) | UC-2 alternate | `GET /api/events/lookup` |
| 4 | Get event with children (rooms, sessions, speakers, answers) | UC-2 alternate | `GET /api/events/{id}?includeChildren=true` |
| 5 | List/page/filter/sort sessions (filterable by EventName, RoomName) | UC-3, BR-43 | `GET /api/sessions` |
| 6 | Get single session by ID | UC-3 implied | `GET /api/sessions/{id}` |
| 7 | Get session with children (speakers, category items, answers) | UC-3 | `GET /api/sessions/{id}?includeChildren=true` |
| 8 | List/page/filter/sort speakers | Key Cap #1, BR-43 | `GET /api/speakers` |
| 9 | Get single speaker by ID | Key Cap #1, BR-43 | `GET /api/speakers/{id}` |
| 10 | List/page/filter/sort categories | Key Cap #1, BR-43 | `GET /api/conferencecategories` |
| 11 | Get category with items | Key Cap #1, BR-43 | `GET /api/conferencecategories/{id}` |
| 12 | List/page/filter/sort rooms | Key Cap #1, BR-43 | `GET /api/rooms` |
| 13 | List/page/filter/sort questions | Key Cap #1, BR-43 | `GET /api/questions` |
| 13a | View session feedback for a speaker | BR-210 | `GET /api/speakers/{speakerId}/sessions/{sessionId}/feedback` |
| 13b | View session bookmark count for a speaker | BR-210 | `GET /api/speakers/{speakerId}/sessions/{sessionId}/bookmarks/count` |
**Constraints:** Pagination capped at 500 items (BR-11). Rate limited at 100 req/min (BR-20). Only published events visible (BR-108).

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
| 16 | View own JWT claims | UC-10 | `GET /api/userclaims` |

**Feedback (Conference context, attendee-written):**

| # | Action | Source | Constraints |
|---|--------|--------|-------------|
| 18 | Submit event feedback | UC-4, BR-42, BR-107 | Per-question submission; records `CreatedBy`; overwrites existing answers (BR-123) |
| 19 | Read own event feedback answers | UC-4, BR-8 | Scoped to own answers only — cannot see others' |
| 20 | Update own event feedback answer | Key Cap #1, BR-42 | Route ID must match body ID (BR-10) |
| 21 | Delete own event feedback answer (soft) | Key Cap #1, BR-42, BR-1 | Soft delete only |
| 22 | Submit session feedback | UC-5, BR-42, BR-49, BR-107 | Per-question submission; records `CreatedBy`; only for Accepted/null sessions (BR-49); overwrites existing (BR-123) |
| 23 | Read own session feedback answers | UC-5, BR-9 | Scoped to own answers only |
| 24 | Update own session feedback answer | Key Cap #1, BR-42 | Route ID must match body ID (BR-10) |
| 25 | Delete own session feedback answer (soft) | Key Cap #1, BR-42, BR-1 | Soft delete only |

**Personal Schedule (Engagement context):**

| # | Action | Source | Constraints |
|---|--------|--------|-------------|
| 26 | Bookmark a session | UC-11, BR-21, BR-91 | `POST /api/bookmarks`; unique per (UserId, SessionId); informational only, no seat reservation (BR-22); service sessions cannot be bookmarked (BR-91) |
| 27 | View own bookmarks (personal schedule) | UC-11 | `GET /api/bookmarks`; chronological order |
| 27a | Get bookmarked session IDs | UC-11 | `GET /api/bookmarks/session-ids`; returns dictionary of SessionId → BookmarkId for quick lookup |
| 28 | Remove a bookmark | UC-11 alternate | `DELETE /api/bookmarks/{id}`; soft delete |

**Account Management:**

| # | Action | Source | Constraints |
|---|--------|--------|-------------|
| 40 | Delete own account | UC-21, BR-56 | Soft-deletes user |

#### Speaker (Attendee with `speaker_id` claim)

All Attendee actions, plus:

| # | Action | Source | Constraints |
|---|--------|--------|-------------|
| 90 | View session feedback (public) | BR-210 | `AllowAnonymous` — publicly accessible; no auth or `speaker_id` matching required (available to all actors including API Consumers) |
| 91 | View session bookmark counts (public) | BR-210 | `AllowAnonymous` — publicly accessible; no auth or `speaker_id` matching required |
| 92 | Update own speaker profile | BR-214 | `speaker_id` must match URL `{speakerId}`; edits overwritten on Sessionize refresh (BR-215) |

> **Note:** Actions 90 and 91 are technically accessible to all actors (including unauthenticated API Consumers) because the endpoints use `AllowAnonymous`. They are listed here because the feature was designed for speaker self-service and the `{speakerId}` parameter refers to the speaker's own data. Any authenticated user or API consumer can call these endpoints for any speaker.

#### Organizer (`role: Organizer`)

All Attendee actions, plus:

**Event (aggregate root) CRUD:**

| # | Action | Source | Side Effects |
|---|--------|--------|-------------|
| 41 | Create event | Key Cap #1, BR-41 | |
| 42 | Update event | Key Cap #1, BR-41 | |
| 43 | Delete event (soft) | Key Cap #1, BR-41, BR-1 | Cascade soft-deletes all sessions (BR-127) |

**Session (aggregate root) CRUD:**

| # | Action | Source | Side Effects |
|---|--------|--------|-------------|
| 44 | Create session | Key Cap #1, BR-41 | Raises `SessionCreated` → logged |
| 45 | Update session | Key Cap #1, BR-41 | |
| 46 | Delete session (soft) | Key Cap #1, BR-41, BR-1 | Cascade soft-deletes owned children (BR-55) |

**Speaker (aggregate root) CRUD:**

| # | Action | Source | Side Effects |
|---|--------|--------|-------------|
| 47 | Create speaker | Key Cap #1, BR-41 | |
| 48 | Update speaker | Key Cap #1, BR-41 | |
| 49 | Delete speaker (soft) | Key Cap #1, BR-41, BR-1 | |

**Category (aggregate root) CRUD:**

| # | Action | Source | Side Effects |
|---|--------|--------|-------------|
| 50 | Create category | UC-8, BR-41 | |
| 51 | Update category | UC-8, BR-41 | |
| 52 | Delete category (soft) | Key Cap #1, BR-41, BR-1 | |

**Question (aggregate root) CRUD:**

| # | Action | Source | Side Effects |
|---|--------|--------|-------------|
| 53 | Create question | Key Cap #1, BR-41 | |
| 54 | Update question | Key Cap #1, BR-41 | |
| 55 | Delete question (soft) | Key Cap #1, BR-41, BR-1 | |

**Child entity management (through parent aggregate):**

| # | Action | Parent Aggregate | Source | Endpoint Pattern | Side Effects |
|---|--------|-----------------|--------|-----------------|-------------|
| 56 | Add room to event | Event | UC-7 | `POST /api/rooms` | Raises `RoomChanged` (Added) |
| 57 | Update room | Event | UC-7 | `PUT /api/rooms/{id}` | Raises `RoomChanged` (Updated) |
| 58 | Delete room (soft) | Event | UC-7 | `DELETE /api/rooms/{id}` | Raises `RoomChanged` (Deleted) |
| 59 | Add speaker to event | Event | Key Cap #1, BR-41 | `POST /api/eventspeakers` | |
| 61 | Delete event speaker (soft) | Event | Key Cap #1, BR-41 | `DELETE /api/eventspeakers/{id}` | |
| 62 | Add speaker to session | Session | Key Cap #1, BR-41 | `POST /api/sessionspeakers` | |
| 64 | Delete session speaker (soft) | Session | Key Cap #1, BR-41 | `DELETE /api/sessionspeakers/{id}` | |
| 65 | Add category item to session | Session | Key Cap #1, BR-41 | `POST /api/sessioncategoryitems` | |
| 67 | Delete session category item (soft) | Session | Key Cap #1, BR-41 | `DELETE /api/sessioncategoryitems/{id}` | |
| 68 | Add category item to category | Category | UC-8 | `POST /api/categoryitems` | |
| 69 | Update category item | Category | UC-8 | `PUT /api/categoryitems/{id}` | |
| 70 | Delete category item (soft) | Category | UC-8 | `DELETE /api/categoryitems/{id}` | |
| 71 | Add category item to speaker | Speaker | UC-9 | `POST /api/speakercategoryitems` | |
| 73 | Delete speaker category item (soft) | Speaker | Key Cap #1, BR-41 | `DELETE /api/speakercategoryitems/{id}` | |
| 73a | Add question answer to speaker | Speaker | Key Cap #1, BR-41 | *(domain only — no REST controller)* | Raises `SpeakerQuestionAnswerChanged` (Added). **Not yet exposed via REST API** — SpeakerQuestionAnswer CRUD is supported at the domain layer but no `SpeakerQuestionAnswersController` exists. Speaker question answers are currently populated only via Sessionize import (UC-6). |
| 73b | Update speaker question answer | Speaker | Key Cap #1, BR-41 | *(domain only — no REST controller)* | Raises `SpeakerQuestionAnswerChanged` (Updated) |
| 73c | Delete speaker question answer (soft) | Speaker | Key Cap #1, BR-41 | *(domain only — no REST controller)* | Raises `SpeakerQuestionAnswerChanged` (Deleted) |

> **Endpoint convention:** Child entity write endpoints use top-level routes (e.g., `/api/rooms`, not `/api/events/{eventId}/rooms`). The parent aggregate ID is included in the request body and validated via BR-2 (child's parent ID must match the aggregate root ID). Read endpoints for all child entities also use top-level routes (see Section 11.3).

> **Note:** Join entities (EventSpeaker, SessionSpeaker, SessionCategoryItem, SpeakerCategoryItem) have no update action — they have no mutable attributes beyond foreign keys. CategoryItem retains update because it has mutable fields (`Name`, `Sort`).

**Sessionize integration:**

| # | Action | Source | Constraints |
|---|--------|--------|-------------|
| 74 | Refresh event data from Sessionize | UC-6, BR-6 | `POST /api/events/{id}/refresh`; requires non-empty `SessionizeCode`; idempotent upsert (BR-7); overwrites manual edits (BR-48); syncs categories → rooms → speakers → sessions |

**User management:**

| # | Action | Source | Constraints |
|---|--------|--------|-------------|
| 77 | List/search users | BR-51 | Paginated, filterable by Email, FirstName, LastName, Role; device fields excluded for privacy |
| 78 | Delete any user account | UC-21, BR-56 | Organizer can delete any user; same data handling as self-deletion |

**Speaker linking:**

| # | Action | Source | Endpoint |
|---|--------|--------|----------|
| 79 | Link user to speaker | BR-209 | `PUT /api/speakers/{id}/link` |
| 80 | Unlink user from speaker | BR-209 | `DELETE /api/speakers/{id}/link` |

**Event lifecycle:**

| # | Action | Source | Constraints |
|---|--------|--------|-------------|
| 78b | Publish/unpublish event | BR-108 | `POST /api/events/{id}/publish` or `POST /api/events/{id}/unpublish` (action endpoints, no request body) |

#### System (Non-Human)

Actions initiated autonomously by domain event handlers after persistence:

| # | Action | Trigger Event | Side Effect |
|---|--------|--------------|-------------|
| 86 | Log session creation | `SessionCreated` | Logs the session creation |
| 87 | Log room changes | `RoomChanged` | Logs the change |

#### Action Count Summary

| Actor | Explicit UCs | Implicit Actions | Total |
|-------|-------------|-----------------|-------|
| **API Consumer** | UC-2, UC-3 | 13 entity read endpoints + 2 speaker metrics (feedback, bookmark count) | 15 |
| **Attendee** | UC-30, UC-31, UC-32, UC-33, UC-4, UC-5, UC-10, UC-11, UC-21 | + API Consumer actions + feedback update/delete + account deletion + password change | 30 |
| **Speaker** | *(Attendee + speaker-specific views)* | Profile editing (feedback + bookmark count views are public, already in API Consumer) | Attendee + 1 |
| **Organizer** | UC-6–UC-9, UC-19, UC-21 | + Attendee actions + Conference CRUD (29 write actions — speaker question answer endpoints are domain-only, not yet exposed via REST) + user list/delete + publish/unpublish + speaker link/unlink | 62 |
| **System** | — | Logging | 2 |

---

## 5. Workflows & State Transitions

### Session Status

The `Session.Status` field is a free-text string imported from Sessionize. Default: null (for manually created sessions). Known Sessionize values: `Accepted`, `Waitlisted`, `Accept Queue`, `Nominated`, `Decline Queue`, `Declined`. **No state machine is enforced** — the status is stored as-is from the external system. Only `Accepted` and null statuses are eligible for public display, bookmarking, and feedback. All other statuses (including unknown values) are excluded from public views and engagement actions (BR-49).

### Session Confirmation Workflow

| Field | Meaning |
|---|---|
| `IsInformed` | Speaker has been notified of their session status |
| `IsConfirmed` | Speaker has confirmed their participation |

**Note:** These are boolean flags set during Sessionize import. No state-machine transition enforcement exists — they are informational fields.

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

Unpublished events and their sessions are visible **only to organizers**. Publishing an event makes it and its sessions visible to all users via public endpoints.

---

### Soft Delete Lifecycle

All entities follow: **Active** → (Delete action) → **Soft-Deleted** (IsDeleted = true)

Soft-deleted records are automatically excluded from all normal queries.

---

## 6. Events & Side Effects

### Domain Events

Domain events are raised for entity mutations. Not all events have registered handlers — events without handlers serve as extension points for future requirements.

| Domain Event | Trigger | Carried Data | Context |
|---|---|---|---|
| **Aggregate root lifecycle events** | | | |
| `EventCreated` | New event is created | The Event entity | Conference |
| `EventChanged` | Event is updated or soft-deleted | DomainEntityState (Updated/Deleted), Event | Conference |
| `SessionCreated` | New session is created | The Session entity | Conference |
| `SessionChanged` | Session is updated or soft-deleted | DomainEntityState (Updated/Deleted), Session | Conference |
| `SpeakerCreated` | New speaker is created | The Speaker entity | Conference |
| `SpeakerChanged` | Speaker is updated, linked/unlinked, or soft-deleted | DomainEntityState (Updated/Deleted), Speaker, PreviousLinkedUserId? (carries the User ID that was linked before deletion/unlinking, enabling cross-context cleanup without a direct domain reference) | Conference |
| `CategoryCreated` | New category is created | The Category entity | Conference |
| `CategoryChanged` | Category is updated or soft-deleted | DomainEntityState (Updated/Deleted), Category | Conference |
| `QuestionCreated` | New question is created | The Question entity | Conference |
| `QuestionChanged` | Question is updated or soft-deleted | DomainEntityState (Updated/Deleted), Question | Conference |
| `UserSessionBookmarkChanged` | Bookmark is created or soft-deleted | DomainEntityState (Added/Deleted), UserSessionBookmark | Engagement | *(Uses single Changed event with Added/Deleted states instead of separate Created/Changed — see BR-60 exception note)* |
| `UserRegistered` | New user account is created | UserId?, Email, FirstName, LastName, Role | Identity |
| `UserPasswordChanged` | User changes their password | UserId | Identity |
| `UserDeleted` | User account is soft-deleted | UserId | Identity |
| **Child entity change events** | | | |
| `RoomChanged` | Room added/updated/deleted on an Event | DomainEntityState, EventId, Room | Conference |
| `CategoryItemChanged` | CategoryItem added/updated/deleted on a Category | DomainEntityState, CategoryId, CategoryItem | Conference |
| `EventSpeakerChanged` | EventSpeaker added/deleted on an Event | DomainEntityState, EventId, EventSpeaker | Conference |
| `EventQuestionAnswerChanged` | EventQuestionAnswer added/updated/deleted on an Event | DomainEntityState, EventId, EventQuestionAnswer | Conference |
| `SessionSpeakerChanged` | SessionSpeaker added/deleted on a Session | DomainEntityState, SessionId, SessionSpeaker | Conference |
| `SessionCategoryItemChanged` | SessionCategoryItem added/deleted on a Session | DomainEntityState, SessionId, SessionCategoryItem | Conference |
| `SessionQuestionAnswerChanged` | SessionQuestionAnswer added/updated/deleted on a Session | DomainEntityState, SessionId, SessionQuestionAnswer | Conference |
| `SpeakerCategoryItemChanged` | SpeakerCategoryItem added/deleted on a Speaker | DomainEntityState, SpeakerId, SpeakerCategoryItem | Conference |
| `SpeakerQuestionAnswerChanged` | SpeakerQuestionAnswer added/updated/deleted on a Speaker | DomainEntityState, SpeakerId, SpeakerQuestionAnswer | Conference |

### Event Handlers & Side Effects

| Trigger Event | Handler Context | Action |
|---|---|---|
| `RoomChanged` | Conference | Logs the room change |
| `SessionCreated` | Conference | Logs the session creation |
| `SpeakerChanged` (Deleted) | Identity | **Cross-context link cleanup:** Clears `User.LinkedSpeakerId` for the linked user (if any). See BR-70. This is the only handler that crosses a bounded context boundary — it enables the Conference context to notify Identity of a speaker deletion without a direct cross-context write. |

> **Note:** Only `RoomChanged`, `SessionCreated`, and `SpeakerChanged` (Deleted) currently have registered handlers. All three perform logging or link cleanup. The remaining domain events (including `UserRegistered`, `UserPasswordChanged`, `UserDeleted`, `SpeakerQuestionAnswerChanged`, and others) are defined but have no handlers — they exist as extension points and will gain handlers when concrete requirements emerge (e.g., real-time notifications, audit logging, analytics, engagement analytics via `UserSessionBookmarkChanged`).

### Dispatch Mechanism

Domain events are raised during entity mutations and dispatched asynchronously after changes are persisted.

---

## 7. Business Constraints & Invariants

### Data Integrity

| Constraint | Description |
|---|---|
| Soft delete exclusion | All queries automatically exclude soft-deleted records (IsDeleted = true) |
| Required fields | Event.Name, Event.StartDate, Event.EndDate, Event.TimeZone, Session.Title, Speaker.FirstName, Speaker.LastName, Room.Name, Category.Title, CategoryItem.Name, Question.QuestionText, Question.QuestionEntity (BR-15), Question.QuestionSource, EventQuestionAnswer.AnswerValue, SessionQuestionAnswer.AnswerValue, SpeakerQuestionAnswer.AnswerValue, User.Email, User.PasswordHash, User.PasswordSalt, User.FirstName, User.LastName |
| Unique aggregate child | A child entity can only be updated/deleted if it exists in the aggregate's collection (by ID match) |
| Parent-child integrity | Child entity's parent ID must match the aggregate root ID when performing operations through the aggregate |
| Cascade restrictions | Cross-aggregate relationships do not cascade deletes — deleting a parent does not automatically delete records in other aggregates (SessionSpeaker, SessionCategoryItem, SpeakerCategoryItem, EventQuestionAnswer) |
| Cross-context soft-delete (Session) | Soft-deleting a Session cascade soft-deletes all owned children (SessionSpeakers, SessionQuestionAnswers, SessionCategoryItems) per BR-55. Engagement records (bookmarks) referencing the session are not cascade-deleted. |
| Cross-context soft-delete (Event) | Soft-deleting an Event cascade soft-deletes all Sessions belonging to that Event (and their children) per BR-127. |
| Soft-delete (User) | Soft-deletes the User record per BR-56. Engagement records (bookmarks) are retained but excluded from user-facing queries. |

### Cross-Entity Constraints

| Constraint | Description |
|---|---|
| Room → Event | A room must belong to exactly one event |
| Session → Event | A session must belong to exactly one event. `Session.EventId` is immutable after creation (BR-140). |
| Session → Room | A session may optionally be assigned to a room |
| EventSpeaker uniqueness | Inferred: Only one EventSpeaker record per (EventId, SpeakerId) pair |
| SpeakerCategoryItem uniqueness | Inferred: Only one record per (SpeakerId, CategoryItemId) pair |
| SessionSpeaker uniqueness | Inferred: Only one SessionSpeaker record per (SessionId, SpeakerId) pair |
| SessionCategoryItem uniqueness | Inferred: Only one SessionCategoryItem record per (SessionId, CategoryItemId) pair |
| Feedback ownership | Question answers record `CreatedBy` and are filtered by it for read access. Attendees can only update/delete their own answers (BR-52). Organizers can update/delete any answer for moderation (BR-53). |
| Feedback FK validation | EventQuestionAnswer.QuestionId must reference a Question with `QuestionEntity = "Event"`. SessionQuestionAnswer.QuestionId must reference a Question with `QuestionEntity = "Session"`. SpeakerQuestionAnswer.QuestionId must reference a Question with `QuestionEntity = "Speaker"`. Mismatches are rejected (BR-128). |
| Bookmark uniqueness | Only one active UserSessionBookmark per (UserId, SessionId) pair. Re-bookmarking after soft-delete reactivates the existing record (BR-135). |
| Bookmark session status | Bookmarks can only be created for sessions with `Accepted` or null status. All other statuses (`Waitlisted`, `Accept Queue`, `Nominated`, `Decline Queue`, `Declined`, and unknown values) are ineligible for bookmarking (BR-49). Existing bookmarks are retained when a session's status changes to a non-eligible value (BR-139). |
| Bookmark denormalization avoidance | UserSessionBookmark does not store EventId — it is derived from Session.EventId via join when needed |
| Engagement aggregate independence | Engagement entities (bookmarks) are standalone aggregate roots — they reference User and Session but are not managed through those aggregates, preventing write contention |
| Engagement pagination & filtering | Engagement list endpoints support pagination (BR-11 cap) and filtering: bookmarks by `EventId` via Session join (BR-58) |
| Service session restrictions | Service sessions (`IsServiceSession = true`) cannot be bookmarked or receive feedback (BR-91) |
| Event visibility | Unpublished events are visible only to organizers; published events are visible to all (BR-108). Visibility cascades to sessions — sessions belonging to unpublished events are excluded from public query results (consistent with Section 5 Event Lifecycle). Child entities within the Event aggregate (Rooms, EventSpeakers, EventQuestionAnswers) follow the same visibility as their parent event (BR-132). |
| Session visibility | Sessions belonging to unpublished events are excluded from public list endpoints (GET /api/sessions). A session can be retrieved by ID only if its parent event is published or the requester is an Organizer. See BR-132. |
| EventQuestionAnswer uniqueness | Only one answer per (CreatedBy, QuestionId, EventId) — subsequent submissions overwrite the existing answer (BR-123). |
| SessionQuestionAnswer uniqueness | Only one answer per (CreatedBy, QuestionId, SessionId) — subsequent submissions overwrite the existing answer (BR-123). |
| SpeakerQuestionAnswer uniqueness | Only one answer per (CreatedBy, QuestionId, SpeakerId) — subsequent submissions overwrite the existing answer (BR-123). |
| CategoryItem name uniqueness | CategoryItem.Name must be unique within its parent Category (case-insensitive) (BR-138). |
| Question field immutability | Question.QuestionType and Question.QuestionEntity cannot be changed after answers exist (BR-137). |
| Speaker-User linking | 1:1 bidirectional relationship via `User.LinkedSpeakerId` and `Speaker.LinkedUserId`. Cleared on speaker soft-delete (BR-70). |

### Temporal Constraints

| Constraint | Description |
|---|---|
| JWT expiry | Authentication tokens expire 1 hour after issuance |
| DateRange validity | End date must be >= start date |
| DateTimeRange validity | End datetime must be >= start datetime |
| Event date range | Event.StartDate must be <= Event.EndDate (enforced by DateRange value object) (BR-86) |
| Time zone awareness | All server-side time comparisons use the event's configured IANA time zone (BR-87) |
| Session duration validity | When both StartsAt and EndsAt are non-null, EndsAt must be strictly greater than StartsAt — zero-duration sessions are invalid (BR-122) |
| Concurrency model | Last-write-wins — no optimistic concurrency (ETags, row versions). See BR-129 for rationale. |

---

## 8. External Integrations (Business Perspective)

### Sessionize

| Aspect | Detail |
|---|---|
| **Purpose** | Import conference schedule, speakers, rooms, and category data from the Sessionize event management platform |
| **Trigger** | Manual API call: `POST /api/events/{id}/refresh` (Organizer role required) |
| **Data received** | Categories, CategoryItems, Rooms, Speakers (with category assignments, email, social links — TwitterHandle, LinkedInUrl, GitHubUrl, WebsiteUrl — and `IsTopSpeaker` flag), Sessions (with speaker and category assignments, `IsServiceSession` flag, `IsPlenumSession` flag, `LiveUrl`, and `RecordingUrl`), Questions (with `QuestionSource = "Sessionize"`). Social links enable attendees to follow/connect with speakers. |
| **Sync behavior** | Idempotent upsert — new records are created, existing records (by ID) are updated. Sessionize is the source of truth: refresh overwrites all fields on matched entities, replacing any manual edits (BR-48). Soft-deleted entities are skipped (BR-136). User-generated data (feedback, bookmarks) is never modified. |
| **Identifier** | Event's `SessionizeCode` field (e.g., "kqf8l42a") |
| **Scope** | Categories and speakers are synced globally; rooms, event-speakers, sessions, and their associations are scoped to the specific event |

### Image Hosting

| Aspect | Detail |
|---|---|
| **Purpose** | Clarify how profile pictures, venue maps, and other images are handled |
| **Model** | Image fields (`Speaker.ProfilePicture`, `Event.VenueMapUrl`) store **externally hosted URLs**. The system does not provide a managed file upload service. |
| **Speaker images** | Imported from Sessionize during refresh. Sessionize hosts speaker profile pictures and provides URLs. |
| **Venue maps** | Organizers provide a URL to an externally hosted map or floor plan image. |

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
| **UserSessionBookmark** | A record indicating that an attendee plans to attend a specific session — forms their personal schedule |
| **Organizer** | A conference administrator who manages master schedule data (events, sessions, speakers, rooms, categories). Identified by the `Organizer` value in the `User.Role` field. |
| **Attendee Role** | The default user role assigned at registration. Grants access to engagement features (bookmarks, feedback) but not conference data management. |
| **Service Session** | A non-talk entry on the schedule (e.g., lunch break, registration, networking). Displayed on the schedule but excluded from engagement features (bookmarking, feedback). Identified by `IsServiceSession = true`. Keynotes are typically not service sessions. |
| **IANA Time Zone** | A time zone identifier from the IANA Time Zone Database (e.g., "America/New_York"). Used on the Event entity to ensure correct time comparisons for time-gated features. |
| **Event Status** | Whether an event is published (visible to all users, engagement enabled) or unpublished (visible only to organizers, default). Controlled by `Event.IsPublished`. |
| **SpeakerQuestionAnswer** | An attendee's response to a speaker-level survey question. Managed as a child entity of the Speaker aggregate. |
| **Plenum Session** | A plenary or all-hands session where all attendees gather together (e.g., opening keynote, closing ceremony). Identified by `IsPlenumSession = true`. Distinguished from breakout sessions for display purposes. |
| **Top Speaker** | A featured or highlighted speaker (e.g., keynote speaker). Identified by `IsTopSpeaker = true`. Used for display purposes to highlight prominent speakers. |
| **Question Source** | The origin of a survey question: "Sessionize" (imported during refresh) or "User" (created manually by an organizer). Tracks provenance for Sessionize source-of-truth handling. |
| **Accessibility Info** | Optional free-text descriptions of accessibility features for rooms (e.g., wheelchair access, hearing loop) and sessions (e.g., live captioning, sign language interpreter). Informational only. |

---

## DDD Structural Summary

### Bounded Contexts

| Context | Responsibility | Aggregate Roots | Non-Root Entities |
|---|---|---|---|
| **Conference** | Master schedule data. Organizer-managed. Sessionize import target. Low write frequency. | Event, Session, Speaker, Category, Question | Room, CategoryItem, EventSpeaker, SessionSpeaker, EventQuestionAnswer, SessionQuestionAnswer, SessionCategoryItem, SpeakerCategoryItem, SpeakerQuestionAnswer |
| **Engagement** | Attendee-generated activity. High-write during events. Implemented as a standalone module (`Source/Modules/Engagement/`). | UserSessionBookmark | *(none)* |
| **Identity** | Identity, authentication, and authorization (role-based). | User | *(none)* |

### Aggregate Boundaries

| Aggregate Root | Context | Owned Children | Why These Children |
|---|---|---|---|
| **Event** | Conference | Room, EventSpeaker, EventQuestionAnswer | Structural parts of "what makes up an event" — venue rooms, speaker lineup, and event-level feedback. Organizer-managed, low-write. |
| **Session** | Conference | SessionSpeaker, SessionQuestionAnswer, SessionCategoryItem | Structural parts of "what defines a session" — who presents it, how it's tagged, and session-level feedback. Organizer-managed (speakers/tags) or burst-write (feedback). |
| **Speaker** | Conference | SpeakerCategoryItem, SpeakerQuestionAnswer | Category tags and feedback are part of the speaker's profile definition. |
| **Category** | Conference | CategoryItem | Items are the values within a category — they have no independent lifecycle. |
| **Question** | Conference | *(none)* | Template entity. Answers are children of Event/Session, not of Question. |
| **UserSessionBookmark** | Engagement | *(none)* | Standalone preference record. |
| **User** | Identity | *(none)* | Pure identity. Attendee-generated content is in Engagement. |

### Cross-Aggregate References

| Entity | References (not ownership) | Crosses Context Boundary? | Cascade on Delete? |
|---|---|---|---|
| **Speaker** | → User (Identity, optional — LinkedUserId, 1:1 bidirectional with User.LinkedSpeakerId; see Section 12.4) | **Yes: Conference → Identity** | No cascade. Link cleared via `SpeakerChanged` domain event handler (BR-70). |
| **User** | → Speaker (Conference, optional — LinkedSpeakerId, 1:1 bidirectional with Speaker.LinkedUserId; see Section 12.4) | **Yes: Identity → Conference** | No cascade. Link cleared via `SpeakerChanged` domain event handler (BR-70). |
| **Session** | → Event (Conference, required), → Room (Conference, optional — note: Room is a child of Event, not an aggregate root; this is a pragmatic cross-aggregate reference to a child entity, acceptable because Room has a stable identity via Sessionize-assigned ID per BR-61. **Validation:** BR-130 requires `Room.EventId == Session.EventId` — the Session service reads the Room to enforce this cross-aggregate constraint during create/update.) | No: within Conference, but crosses aggregate boundaries | Session cascade soft-deleted when parent Event is deleted (BR-127). Room reference is not cascade-affected. |
| **UserSessionBookmark** | → User (Identity), → Session (Conference) | Yes: Engagement → Identity, Engagement → Conference | No cascade from Session or User deletion. Bookmarks are retained but excluded from queries (BR-55, BR-56). |
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

The original Events + Identity split grouped all conference-related entities together regardless of write profile. Separating Engagement provides:

| Concern | Conference entities | Engagement entities |
|---|---|---|
| **Write frequency** | Low: imported from Sessionize, edited by organizers | Higher: attendees writing during sessions |
| **Write actors** | Organizers, Sessionize sync | Attendees |
| **Time sensitivity** | Updated hours/days before the event | Updated in real-time during the event |
| **Consistency model** | Strong consistency (aggregate invariants matter) | Eventual consistency acceptable |

The primary benefit is **conceptual separation** — organizer-managed master data vs. attendee-generated activity — which keeps each module focused. The contention argument is secondary: Engagement aggregate roots are standalone (no parent to contend on), so the throughput benefit is about clean module boundaries rather than aggregate-level lock contention.

**Why Engagement entities are standalone aggregate roots (not children of User or Session):**

Child entity management through a parent aggregate loads the parent, performs the child action, then saves. This is correct for structural children (Room belongs to Event) where the parent enforces invariants. But for Engagement entities:

1. **No parent invariant to enforce.** "A user can only bookmark a session once" is a uniqueness constraint, not an aggregate invariant requiring the User or Session to validate.
2. **Write contention.** If 200 users bookmark the same session simultaneously, routing through the Session aggregate serializes all 200 writes through a single row.
3. **Nested children unsupported.** The single-level child entity management pattern does not support multi-level nesting.

**Why EventQuestionAnswer and SessionQuestionAnswer remain in Conference as children of their aggregates:**

This is a deliberate trade-off with known contention risk. Feedback writes are routed through the parent aggregate (Event or Session), meaning concurrent submissions load and save the parent.

The contention risk is real but bounded at the expected scale:

- **Session feedback** submissions tend to concentrate in the period after each session ends, producing a **burst** of 20–100 submissions in the first few minutes — not a gradual trickle. For a conference with a few hundred attendees, this burst is manageable: individual requests take milliseconds, and the database handles this concurrency without degradation.
- **Event feedback** is spread across the event's duration — minimal contention.
- The implementation must add child rows without locking or replacing the parent's entire child collection. Child entity additions should be **append-only inserts** keyed to the parent, not load-modify-save-all cycles.
- With last-write-wins semantics (BR-129), there is no risk of optimistic concurrency failures — only of two writes to the same unique key racing, which the upsert logic (BR-123) handles.

**Feedback entities are the primary candidate for extraction to the Engagement context** if attendee volume exceeds ~200 concurrent writers per session. EventQuestionAnswer, SessionQuestionAnswer, and SpeakerQuestionAnswer match the Engagement write profile on every dimension (attendee-generated, high-write during live events, real-time during sessions, eventual consistency acceptable) — the same rationale that justified separating UserSessionBookmark. They remain in Conference for v1 because the contention is bounded at current scale and the aggregate ownership simplifies transactional consistency. Extraction requires moving entities to standalone aggregate roots and adjusting DI — the domain model and API contract do not change.

**Cross-aggregate validation for feedback submission (known hotspot):**

Submitting a `SessionQuestionAnswer` (a child of the Session aggregate) requires validating state from three aggregates: (1) **Session** — exists, is not a service session (BR-91), status is Accepted or null (BR-49); (2) **Event** — is published (BR-108); (3) **Question** — exists, correct `QuestionEntity` (BR-128), `QuestionType` for answer validation (BR-124). `EventQuestionAnswer` similarly validates across Event and Question. `SpeakerQuestionAnswer` validates across Speaker and Question. This cross-aggregate read-on-write is intentional — the business rules genuinely require this validation and it cannot be decomposed further. The feedback services therefore depend on Event and Question read repositories in addition to their owning aggregate's repository. This is not accidental coupling; it is documented here so future developers understand why these service-layer dependencies exist and do not attempt to remove them in the name of aggregate isolation.

**Why UserSessionBookmark does not store EventId:**

A bookmark needs only UserId and SessionId. The Event is derivable from `Session.EventId`. Denormalizing EventId onto the bookmark is unnecessary because `Session.EventId` is immutable (BR-140) — there is no inconsistency risk. Queries that need to filter bookmarks by event join through Session — this is a read-path concern solvable by indexing, not a domain model concern.

**Why bookmarks use soft-delete instead of hard-delete:**

UserSessionBookmark follows the universal soft-delete pattern (BR-1) despite bookmarks having no historical reporting value. The rationale: (1) Consistency — every entity in the system uses soft-delete, eliminating special-case logic in the repository layer and keeping architecture tests simple. (2) Recovery — if a user accidentally removes a bookmark, the soft-deleted record could be restored (though no restore endpoint exists today). (3) Analytics — soft-deleted bookmarks provide engagement data (e.g., "how many users bookmarked then un-bookmarked this session"). The cost is minimal: soft-deleted bookmarks are excluded from queries and consume negligible storage.

**Domain event dispatch:**

Domain events are raised during entity mutations (e.g., adding a room to an event raises `RoomChanged`) and dispatched asynchronously after changes are persisted. Most domain events are produced and consumed within the Conference context. The exception is `SpeakerChanged` (Deleted), which is produced in the Conference context and consumed by a handler in the Identity context to clear the speaker-user link (BR-70). This is the only cross-context domain event handler — it replaces a direct cross-context write with an event-driven approach to maintain bounded context isolation. See Section 6 for the full list of domain events and their handlers.

**Why Session is an aggregate root but cascade-deleted by Event (BR-127):**

Session is an aggregate root because it independently owns children (SessionSpeakers, SessionQuestionAnswers, SessionCategoryItems) and is the target of cross-context references (UserSessionBookmark). It has its own lifecycle for scheduling, feedback, and bookmarking. However, when an Event is soft-deleted, orphaning its Sessions would create inconsistency — sessions with no parent event are meaningless. BR-127 introduces a pragmatic cross-aggregate cascade: Event deletion cascades to Sessions. This violates the strict DDD principle that aggregate roots are only deleted through their own boundary, but the alternative (requiring organizers to manually delete every session before deleting an event) is operationally impractical. The cascade is implemented at the service layer (not database-level), so domain events and child cascades (BR-55) fire correctly.

**Why Organizers can submit feedback:** Organizers inherit all Attendee capabilities, including feedback submission. This is intentional — conference organizers typically attend sessions. The Organizer role grants write access to all Conference entities, making it impossible to define "their" sessions vs. others'. Feedback is scoped to the authenticated user (BR-8, BR-9).

**How role-based authorization works:**

The system has two user roles — `Attendee` (default) and `Organizer` — stored on the User entity. At login (UC-31), the role is included as a `role` claim in the JWT. Authorization is enforced at three levels:

| Level | Who | Endpoints | Enforcement |
|---|---|---|---|
| **Public** | Anyone (no auth) | Read Conference entities (events, sessions, speakers, rooms, categories) | No authentication required |
| **Authenticated** | Any logged-in user (Attendee or Organizer) | Engagement writes (bookmarks, feedback), user claims | Valid JWT required |
| **Organizer** | Users with `Role = Organizer` | Conference writes (CRUD for events, sessions, speakers, rooms, categories, questions), Sessionize refresh, user management | Organizer role required |

The Organizer role is the system's administrator role. Organizers manage all conference master data. Initial organizer accounts are created via database seeding (BR-45).

This design keeps the User entity simple (a single `Role` field rather than a many-to-many role table) because the conference domain has only two authorization tiers. If more granular roles were needed in the future (e.g., separate "Volunteer" or "Sponsor" roles), the field could be migrated to a role collection.

**Why per-question feedback submission with POST-as-upsert:**

Feedback answers are submitted individually via `POST` on EventQuestionAnswer and SessionQuestionAnswer endpoints. Unlike other entities where `POST` is create-only, feedback `POST` performs an **upsert** — it creates a new answer or overwrites an existing one for the same (CreatedBy, QuestionId, EntityId) key (BR-107, BR-123). This is a deliberate deviation from pure CRUD semantics that simplifies the client: attendees don't need to check whether they've already answered a question before submitting. The `Question.IsRequired` flag is advisory — clients should enforce it in the UI but the server does not validate completeness across all questions.

---

## 10. Specification Clarifications & Addenda

This section addresses gaps, ambiguities, and implicit design decisions identified during implementation review. New business rules are numbered BR-61+. API contract specifications are documented separately from business rules.

---

### 10.1 Sessionize Integration Clarifications

#### Entity ID Strategy (clarifies UC-6, BR-7)

The domain model does not explain how entities imported from Sessionize are matched to local records during upsert. The resolution:

Sessionize assigns stable IDs to each entity type — integers for Categories, CategoryItems, Rooms, and Sessions; GUIDs for Speakers. During import, the system uses these Sessionize-assigned IDs as the **local primary key**. `ExistsAsync(sessionizeId)` determines whether to create or update.

| # | Rule |
|---|---|
| BR-61 | Entity IDs for Sessionize-imported entities (Category, CategoryItem, Room, Speaker, Session) are assigned by Sessionize and stored as the local primary key. These entities use `ValueGeneratedNever` for ID generation — the database does not auto-generate IDs for them. **Question** also uses `ValueGeneratedNever` — Sessionize-imported questions use their Sessionize-assigned IDs, while user-created questions (via manual CRUD) receive IDs from a reserved range (999,999,000–999,999,999) auto-allocated by the create handler to avoid collisions with Sessionize-assigned IDs. Entities that are never Sessionize-imported (Event, EventSpeaker, SessionSpeaker, SessionCategoryItem, SpeakerCategoryItem, EventQuestionAnswer, SessionQuestionAnswer, SpeakerQuestionAnswer, User, and all Engagement entities) use database-auto-generated IDs (`ValueGeneratedOnAdd`). |

#### Removal Handling (clarifies BR-7)

BR-7 covers add and update but is silent on what happens when an entity exists locally but is absent from the Sessionize response (e.g., a speaker withdraws or a session is dropped).

| # | Rule |
|---|---|
| BR-62 | Sessionize refresh performs **additive sync only** — it creates new entities and updates existing ones but **never soft-deletes** entities absent from the Sessionize response. Entities removed from Sessionize remain active locally until an organizer manually soft-deletes them. This prevents data loss when Sessionize returns partial data due to API pagination, filtering, or transient errors. |

#### Refresh Throttling

No constraint exists on how frequently an organizer can trigger a Sessionize refresh, risking excessive external API calls.

| # | Rule |
|---|---|
| BR-63 | Sessionize refresh (`POST /api/events/{id}/refresh`) is throttled to **once per 5 minutes per event**. Subsequent requests within the cooldown window return HTTP 429 with a `Retry-After` header indicating seconds remaining. This prevents excessive load on the Sessionize API and redundant processing. |

---

### 10.4 Speaker.Email Clarifications (clarifies Speaker entity)

The Speaker entity includes an `Email` property (imported from Sessionize), but uniqueness and visibility are not specified.

| # | Rule |
|---|---|
| BR-66 | `Speaker.Email` is optional (speakers may not have their email published in Sessionize) and **not unique** — though duplicates would be unusual. Speaker email is **not exposed** via public API read endpoints (GET /api/speakers) because email is PII — it is not information attendees need. Social links (BR-99) are public because speakers intentionally share them for professional networking. Speaker email is visible to Organizers via the write/management endpoints. It follows the Sessionize source-of-truth rule (BR-48). |

---

### 10.6 Rate Limiting Scope (clarifies BR-20)

BR-20 says 100 requests per minute "per client" without defining what "client" means.

| # | Rule |
|---|---|
| BR-68 | The rate limit of 100 requests per minute (BR-20) is enforced **per authenticated user** (by `user_id` JWT claim) for authenticated endpoints, and **per client IP address** for unauthenticated (public) endpoints. The Sessionize refresh endpoint (UC-6) counts against the organizer's authenticated rate limit and is additionally subject to its own per-event throttle (BR-63). |

---

### 10.8 Cascade Soft-Delete Behavior

BR-55 covers Session soft-delete and BR-56 covers User soft-delete, but the spec is silent on cascade behavior for Speaker, Category, Event, and Question soft-deletes.

| # | Rule |
|---|---|
| BR-70 | Soft-deleting a **Speaker** soft-deletes the Speaker record only. Associated `EventSpeaker`, `SessionSpeaker`, and `SpeakerCategoryItem` records are **not cascade-deleted** — they remain active but reference a soft-deleted speaker. **Query filtering for dangling references:** Top-level read endpoints for join entities (`GET /api/eventspeakers`, `GET /api/sessionspeakers`, `GET /api/speakercategoryitems`) must filter results to exclude records where the referenced Speaker is soft-deleted, in addition to the standard `IsDeleted` filter on the join entity itself. Similarly, `includeChildren` responses for Event and Session aggregates exclude join entity records referencing soft-deleted speakers. This prevents consumers from receiving join records that point to unfetchable (soft-deleted) speakers. **Speaker-user link cleanup (via domain event):** If the speaker is linked to a User (via `LinkedUserId`/`LinkedSpeakerId`), `Speaker.LinkedUserId` is cleared within the Conference context during the soft-delete operation. After persistence, the `SpeakerChanged` domain event (with DomainEntityState.Deleted) is dispatched. A handler in the **Identity context** receives this event and clears `User.LinkedSpeakerId` — this is an eventually-consistent cross-context operation rather than a direct cross-context write, maintaining bounded context isolation (see Section 6 Event Handlers). The eventual consistency window is negligible in practice: the user's current JWT retains the stale `speaker_id` claim until expiry (BR-12) regardless of when the User record is updated, and speaker-specific endpoints return HTTP 404 for the soft-deleted speaker immediately. The `speaker_id` claim will be absent from the user's next JWT issued at login or token refresh. |
| BR-71 | Soft-deleting a **Category** soft-deletes the Category record **and cascade soft-deletes all child CategoryItems**. Associated `SessionCategoryItem` and `SpeakerCategoryItem` records referencing deleted items are **not cascade-deleted** — they remain active but reference soft-deleted items. These orphaned references are excluded from display because soft-deleted CategoryItems are filtered from queries. **Sessionize refresh interaction:** CategoryItems that are cascade-deleted via their parent Category are subject to BR-136 — Sessionize refresh will skip these soft-deleted items rather than reactivating them. Organizers who wish to remove a category grouping without suppressing its items from future Sessionize refreshes should un-delete the individual CategoryItems after deleting the Category, then reassign them to a different Category or leave them as standalone items for the next refresh to reconcile. |
| BR-72 | Soft-deleting an **Event** soft-deletes the Event record **and cascade soft-deletes all owned child entities** (Rooms, EventSpeakers, EventQuestionAnswers) **and all Sessions belonging to the event** (which in turn cascade soft-delete their owned children per BR-55). This supersedes the previous non-cascade behavior — see BR-127. **Note:** This cascade includes EventQuestionAnswers (attendee feedback), which will be hidden from queries. Unlike Question soft-delete (BR-73, which preserves answers), Event soft-delete prioritizes data consistency — an event's children are meaningless without the parent. Organizers should export feedback data before soft-deleting an event if historical reporting is needed. |
| BR-73 | Soft-deleting a **Question** soft-deletes the Question record only. Existing `EventQuestionAnswer`, `SessionQuestionAnswer`, and `SpeakerQuestionAnswer` records referencing the question are **not cascade-deleted** — they retain their answer data for historical reporting. The soft-deleted question no longer appears in survey lists for new feedback submission. |

**Cascade rationale summary:**

| Entity Deleted | Cascade Behavior | Rationale |
|---|---|---|
| **Event** | Cascade to Rooms, EventSpeakers, EventQuestionAnswers, Sessions (and Session children) | Event is the top-level container. Its children have no meaning without it. Sessions reference Event by FK and would be orphaned. |
| **Session** | Cascade to SessionSpeakers, SessionQuestionAnswers, SessionCategoryItems | Session owns these children. They have no independent lifecycle. |
| **Category** | Cascade to CategoryItems | Items are values within a category. No independent meaning. |
| **Speaker** | No cascade | Speaker associations (EventSpeaker, SessionSpeaker, SpeakerCategoryItem) are cross-aggregate references. Cascade-deleting them could silently remove data an organizer expects to persist. The soft-deleted speaker is filtered from displays by query filters. |
| **Question** | No cascade | Existing answers (event, session, speaker) retain historical value. The soft-deleted question is hidden from new survey forms. |
| **User** | No cascade to engagement data | Bookmarks are retained (excluded from queries) for potential data analysis. Cascade-deleting engagement data is irreversible and provides no benefit. |

---

### 10.9 Question Scoping (clarifies Question entity)

Questions have no `EventId` — they are global. The spec does not address whether different events can have different survey questions.

| # | Rule |
|---|---|
| BR-74 | Questions are **global survey templates** not scoped to a specific event. All events, sessions, and speakers share the same question pool, filtered by `QuestionEntity` ("Event", "Session", or "Speaker"). This is sufficient for the current single-event-per-year conference model. If event-specific surveys are needed in the future, a `QuestionEvent` join entity can associate specific questions with specific events without changing the Question entity itself. **Note:** The same global-scope consideration applies to Categories (IR-5). Categories and Questions are both event-independent — acceptable when all events share a single Sessionize source or manual configuration, but a **data corruption risk** if multiple concurrent events import from independent Sessionize instances (category IDs could collide and overwrite each other per BR-48/BR-61). If the system evolves to support multiple concurrent events with independent Sessionize sources, both Categories and Questions should be evaluated for event-scoping. |

---

### 10.10 includeChildren Depth (clarifies UC-2, UC-3)

The spec mentions `includeChildren=true` but does not define depth or scope per entity type.

| # | Rule |
|---|---|
| BR-80 | The `includeChildren=true` query parameter loads **one level** of owned child entity collections. Children are not recursively loaded. Cross-aggregate navigation uses `includeFKs=true` or explicit filtering. Engagement entities are never included via this mechanism. |

**Children per entity type:**

| Entity | Children included |
|---|---|
| Event | Rooms, EventSpeakers, EventQuestionAnswers |
| Session | SessionSpeakers, SessionCategoryItems, SessionQuestionAnswers |
| Speaker | SpeakerCategoryItems, SpeakerQuestionAnswers |
| Category | CategoryItems |
| Question | *(none — EventQuestionAnswers and SessionQuestionAnswers are cross-aggregate references, loaded via their own endpoints)* |

**Example:** `GET /api/events/{id}?includeChildren=true` returns the event with its rooms, event-speakers, and event question answers. It does **not** include the event's sessions (which are a separate aggregate, queried via `GET /api/sessions?filters[EventId].eq={id}`).

**Feedback scoping in `includeChildren`:** When `includeChildren=true` returns EventQuestionAnswers (on Event) or SessionQuestionAnswers (on Session), the feedback records are scoped by the requester's role: **Attendees** see only their own answers (`CreatedBy` matches authenticated user). **Organizers** see all answers. **Unauthenticated** requests see no feedback answers — the feedback child collections are returned as empty arrays. This is consistent with BR-8 and BR-9.

---

### 10.14 Email Question Type Clarification (clarifies BR-50)

`QuestionType: Email` "collects contact information" but its purpose is unclear.

| # | Rule |
|---|---|
| BR-81 | `QuestionType: Email` collects attendee contact information for **opt-in follow-up**. Email-type question responses are visible to organizers via the standard EventQuestionAnswer/SessionQuestionAnswer endpoints. The `AnswerValue` for Email-type questions must conform to email format validation: must contain exactly one `@` with a non-empty local part and a domain containing at least one `.` (validated via .NET `MailAddress` parsing). Invalid format is rejected with HTTP 422. |

---

### 10.16 Time-Gated HTTP Status Correction

HTTP 403 ("Forbidden") should not be used for temporal constraint violations — those are client errors (bad request timing), not authorization failures.

| # | Rule |
|---|---|
| BR-83 | Time-gated endpoint rejections (session feedback before session ends) return **HTTP 400 Bad Request** with a descriptive ProblemDetails message, not HTTP 403. HTTP 403 is reserved for authorization failures (insufficient role or ownership). |

---

### 10.17 Sort Tie-Breaking

Entity `Sort` fields (on Room, CategoryItem, Category, Question) have no specified behavior for ties.

| # | Rule |
|---|---|
| BR-85 | When multiple entities share the same `Sort` value, tie-breaking uses the entity's natural name property (`Name` or `Title`) in ascending alphabetical order. If no natural name exists, `Id` ascending is used as the final tiebreaker. |

---

### 10.19 Speaker.FullName Implementation

The Speaker entity includes `FullName` described as "Computed: {FirstName} {LastName}" without specifying the implementation.

`Speaker.FullName` is a **read-only computed property** — a C# property getter (`$"{FirstName} {LastName}"`), not a database column. It is serialized into DTOs and available for display. Because it has no database column, it cannot be used in database-level filtering or sorting. Clients that need to filter or sort by name should use `FirstName` or `LastName`.

---

### 10.20 Session DateTime Storage Format (clarifies Session entity, BR-87)

The spec states session times are "interpreted in the event's time zone" but does not specify the storage format.

`Session.StartsAt` and `Session.EndsAt` are stored as `DateTime` values representing **local time in the event's configured time zone**. They are not stored as UTC or `DateTimeOffset`. For server-side time comparisons (feedback availability), the current UTC time is converted to the event's time zone (via `TimeZoneInfo.ConvertTimeFromUtc`) before comparing against these values. This approach avoids timezone conversion complexity in queries and is appropriate because all sessions within an event share a single time zone (BR-87). The `TimeZone` field on Event is authoritative for interpreting these values.

---

### 10.21 Bookmark Reactivation After Soft-Delete (clarifies BR-21, BR-1)

BR-21 enforces bookmark uniqueness per (UserId, SessionId), and BR-1 requires soft delete. But the spec does not address what happens when a user re-bookmarks a session they previously un-bookmarked (soft-deleted).

| # | Rule |
|---|---|
| BR-135 | **Bookmark reactivation:** The uniqueness check for bookmarks (BR-21) considers only active (non-deleted) records for conflict detection. When a user bookmarks a session for which a soft-deleted bookmark exists, the existing record is **reactivated** (`IsDeleted` set to false, `LastModifiedOn`/`LastModifiedBy` updated) rather than creating a new record. This prevents unbounded growth of soft-deleted bookmark records from repeated bookmark/un-bookmark cycles. The same reactivation pattern applies to all join entities with uniqueness constraints (EventSpeaker, SessionSpeaker, SessionCategoryItem, SpeakerCategoryItem) — re-creating a previously soft-deleted association reactivates the existing record. |

---

### 10.22 Sessionize Refresh and Soft-Deleted Entities (clarifies BR-7, BR-48)

The spec does not define what happens when a Sessionize refresh includes an entity that has been locally soft-deleted.

| # | Rule |
|---|---|
| BR-136 | **Sessionize refresh skips soft-deleted entities.** During a Sessionize refresh (UC-6), if an entity in the Sessionize response matches a locally soft-deleted record (by ID), the soft-deleted record is **not reactivated or updated** — the organizer's delete decision takes precedence over Sessionize data. Skipped entities are counted in a `skippedSoftDeleted` field in the refresh response and logged as a warning (e.g., "Skipped 2 soft-deleted speakers present in Sessionize response"). To restore a soft-deleted imported entity, an organizer must un-delete it manually (future restore endpoint) before triggering a refresh. **Rationale:** Sessionize is the source of truth for *field content* (BR-48), but entity lifecycle (active vs. deleted) is an organizer decision. Automatically reactivating soft-deleted entities would be surprising — an organizer who deliberately removed a declined speaker would see them reappear on the next refresh. |

---

### 10.23 QuestionType and QuestionEntity Immutability (clarifies Question entity, BR-50, BR-15)

The spec does not address what happens when a Question's `QuestionType` or `QuestionEntity` is changed after answers have been submitted.

| # | Rule |
|---|---|
| BR-137 | **Question.QuestionType and Question.QuestionEntity are immutable after answers exist.** Once any EventQuestionAnswer, SessionQuestionAnswer, or SpeakerQuestionAnswer references a Question, the Question's `QuestionType` and `QuestionEntity` fields cannot be changed via `PUT`. Attempts to change either field on a Question with existing answers return HTTP 422 with detail "QuestionType and QuestionEntity cannot be changed after answers have been submitted." To change the question type or target entity, soft-delete the existing Question and create a new one. **Rationale:** Changing a Rating question to Text (or vice versa) would make existing answers semantically invalid — a numeric "4" becomes meaningless as free text, and free text cannot be interpreted as a rating. Changing `QuestionEntity` from `"Event"` to `"Session"` or `"Speaker"` (or vice versa) would make existing answers reference a question targeting the wrong entity type, silently breaking the FK validation invariant (BR-128). Other Question fields (`QuestionText`, `Sort`, `IsRequired`) remain mutable. |

---

### 10.24 CategoryItem Name Uniqueness (clarifies CategoryItem entity, BR-19)

The spec defines CategoryItem.Name as required (BR-19) but does not specify uniqueness within a Category.

| # | Rule |
|---|---|
| BR-138 | **CategoryItem.Name must be unique within its parent Category** (case-insensitive). Two CategoryItems in the same Category cannot have the same Name. This is enforced during both manual creation/update and Sessionize import. During Sessionize import, items are matched by their Sessionize-assigned ID (BR-61), not by name — so name uniqueness violations from Sessionize are unlikely but would be logged as a warning without blocking the import. |

---

### 10.24a Question ID Allocation for User-Created Questions (clarifies BR-61)

BR-61 states that Question IDs use `ValueGeneratedNever` — they are explicitly assigned, not database-auto-generated. Sessionize-imported questions receive their Sessionize-assigned ID. But the spec does not address how IDs are allocated for manually created questions (via `POST /api/questions`).

| # | Rule |
|---|---|
| BR-141 | **User-created questions use a reserved ID range** (999,999,000–999,999,999) to avoid collisions with Sessionize-assigned IDs. The `CreateQuestionHandler` auto-allocates the next available ID within this range — any caller-provided ID is ignored. If the range is exhausted (1,000 manual questions), the create operation fails. This partition ensures that manual CRUD and Sessionize import never produce ID conflicts, regardless of the order in which questions are created. |

---

### 10.25 Engagement Context Implementation (clarifies DDD Structural Summary)

The DDD Structural Summary defines three bounded contexts (Conference, Engagement, Identity). The Engagement context is implemented as a **standalone module** at `Source/Modules/Engagement/`.

> **Implementation note:** The Engagement bounded context (currently containing `UserSessionBookmark`) is implemented as a dedicated module (`MMCA.ADC.Modules.Engagement`) with its own Domain, Application, Infrastructure, API, and Shared layers. This provides clean bounded context separation and positions the module for future expansion (e.g., attendee preferences, session check-ins).

---

### 10.26 Logout/Revoke Endpoint (clarifies BR-216)

BR-216 describes logout behavior but no use case or endpoint is specified.

**Endpoint:** `POST /auth/revoke`

**Authentication:** Required

**Request body:** None.

**Main Flow:**

1. System revokes the authenticated user's refresh token (marks as invalidated).
2. For web clients: the HttpOnly cookie is cleared in the response.
3. For MAUI clients: no server-side action is needed beyond token revocation — the client clears stored credentials from SecureStorage locally.
4. Returns HTTP 204 No Content.

**Response codes:**
- HTTP 204 — token revoked successfully (idempotent — returns 204 even if no active refresh token exists)
- HTTP 401 — not authenticated

**Note:** Access tokens cannot be server-side invalidated before expiry (BR-216). After logout, the access token remains valid until its 1-hour TTL expires. For security-critical scenarios (account compromise), the soft-deleted user JWT check (BR-133) provides a fallback — soft-deleting the account immediately blocks all requests.

---

### 10.27 Existing Bookmarks on Session Status Change (clarifies BR-49, BR-21)

BR-49 prevents creating bookmarks for sessions with non-eligible statuses, but does not address existing bookmarks when a session's status changes after bookmarking.

| # | Rule |
|---|---|
| BR-139 | **Existing bookmarks are retained when a session's status changes to a non-eligible value (e.g., Declined, Waitlisted).** Active bookmarks for the session are not automatically soft-deleted. The personal schedule endpoint (`GET /api/bookmarks`) includes these bookmarks, and the associated session's `Status` field indicates the current status — clients should display these bookmarks with appropriate visual treatment (e.g., strikethrough, status badge). Attendees can manually remove the bookmark. **Rationale:** Automatically deleting bookmarks on status change would silently alter attendees' personal schedules without their knowledge. Retaining them with visible status information lets attendees decide how to adjust their plans. The same principle applies to sessions that become service sessions (`IsServiceSession` changed to true) — existing bookmarks are retained with updated session metadata. |

---

### 10.28 Session.EventId Immutability (clarifies Session entity)

The spec does not address whether a Session's `EventId` can be changed after creation.

| # | Rule |
|---|---|
| BR-140 | **Session.EventId is immutable after creation.** A session's parent event cannot be changed via `PUT`. Attempts to update a session with a different `EventId` than its current value return HTTP 422 with detail "Session cannot be moved between events." To reassign a session to a different event, soft-delete it and create a new session on the target event. **Rationale:** Changing `EventId` has cascading implications — room cross-event validation (BR-130), event visibility for feedback (BR-108), date range alignment (BR-86), and engagement data (bookmarks, feedback) that reference the session would need revalidation. Immutability avoids these complexities. Sessionize imports always create sessions within the correct event scope. |

---

### 10.29 SpeakerQuestionAnswer API Gap (implementation status)

The domain model supports `SpeakerQuestionAnswer` as a child entity of the Speaker aggregate (with `AddSpeakerQuestionAnswer`, `UpdateSpeakerQuestionAnswer`, `RemoveSpeakerQuestionAnswer` methods). BR-107 mentions SpeakerQuestionAnswer alongside EventQuestionAnswer and SessionQuestionAnswer as a feedback submission mechanism.

However, **no `SpeakerQuestionAnswersController` exists** — SpeakerQuestionAnswer CRUD is not exposed via REST API. Speaker question answers are currently populated only through Sessionize import (UC-6, which imports speaker survey responses from Sessionize). Manual speaker feedback submission by attendees is not yet available.

**Impact:** Actor-Action Matrix items 73a–73c (speaker question answer management) describe domain-layer capabilities that are not yet exposed as API endpoints. Attendees cannot submit speaker-level feedback through the API. This is a known gap — the domain is ready, but the API controller has not been implemented.

**To implement:** Create a `SpeakerQuestionAnswersController` following the same pattern as `EventQuestionAnswersController` and `SessionQuestionAnswersController`. The controller should use `RequireAuthenticated` authorization (matching the feedback pattern), apply user-scoping for reads (attendees see own answers only), and enforce BR-128 (`QuestionEntity = "Speaker"`) and BR-124 (answer validation) on submission.

---

## 11. API Contract Specifications

This section documents API design decisions that apply across all endpoints.

---

### 11.1 Error Response Format

All error responses use the **RFC 9457 ProblemDetails** format (the successor to RFC 7807, same structure):

```json
{
  "type": "https://tools.ietf.org/html/rfc9457",
  "title": "Business rule violation",
  "status": 400,
  "detail": "A user can bookmark a session only once."
}
```

| HTTP Status | Condition | Title |
|---|---|---|
| 400 Bad Request | Business rule violation (`DomainException`) | `"Business rule violation"` |
| 400 Bad Request | Time-gated feature unavailable (BR-83) | `"Business rule violation"` |
| 401 Unauthorized | Missing or invalid JWT token | `"Authentication required"` |
| 403 Forbidden | Insufficient role or entity ownership | `"Forbidden"` |
| 404 Not Found | Entity does not exist or is soft-deleted | `"Not found"` |
| 409 Conflict | Duplicate operation (bookmark) | `"Conflict"` |
| 422 Unprocessable Entity | FluentValidation failure | `"Validation failed"` |
| 429 Too Many Requests | Sessionize refresh throttle (BR-63) exceeded, or login brute-force protection (BR-212), or registration abuse prevention (BR-213) | `"Too many requests"` |
| 503 Service Unavailable | API rate limit exceeded (BR-20/BR-68) — ASP.NET Core fixed-window rate limiter rejects excess requests with 503 | *(framework default)* |
| 502 Bad Gateway | External service (Sessionize API) unreachable — timeout, HTTP 5xx, or DNS failure (UC-6) | `"Sessionize API is unavailable. Try again later."` |
| *(Client disconnection)* | Client disconnected before response completed — no HTTP response is sent. The server logs the cancellation at `Information` level for diagnostics. This is not an HTTP status code returned to the client. | *(N/A — logged server-side only)* |
| 500 Internal Server Error | Unhandled exception | `"An unexpected error occurred"` |

**Validation errors** (422) include a field-level `errors` dictionary:

```json
{
  "type": "https://tools.ietf.org/html/rfc9457",
  "title": "Validation failed",
  "status": 422,
  "errors": {
    "Title": ["'Title' must not be empty."],
    "StartsAt": ["'StartsAt' must be before 'EndsAt'."]
  }
}
```

**Environment behavior:** In development, the `detail` field includes the full exception message and stack trace. In production, business rule violations (DomainException) include the rule message; unhandled exceptions return a generic message with no internal details.

---

### 11.2 Pagination Response Contract (clarifies BR-11, BR-18)

Paginated endpoints (`GET` with `pageNumber` and `pageSize` parameters) return:

**Response body** — `PagedResult<T>`:

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

**Response header** — `X-Pagination` contains the same `PaginationMetadata` object serialized as JSON, for clients that prefer reading metadata from headers.

**Defaults and constraints:**
- Default `pageSize`: 10
- Maximum `pageSize`: 500 (BR-11; values above 500 are silently capped)
- Page numbering is 1-based (`pageNumber` minimum: 1)
- `TotalPageCount`, `FirstRowOnPage`, and `LastRowOnPage` are computed server-side
- All `PaginationMetadata` values are non-negative (BR-18)

---

### 11.3 Filtering and Sorting

**Filter syntax:** Query parameters use the pattern `filters[PropertyName].operator=value`.

**Supported filter operators:**

| Operator | Meaning | Applicable Types |
|---|---|---|
| `eq` | Equals | All |
| `neq` | Not equals | All |
| `gt` | Greater than | Numeric, DateTime, DateOnly |
| `gte` | Greater than or equal | Numeric, DateTime, DateOnly |
| `lt` | Less than | Numeric, DateTime, DateOnly |
| `lte` | Less than or equal | Numeric, DateTime, DateOnly |
| `contains` | String contains (case-insensitive) | String |
| `startswith` | String starts with (case-insensitive) | String |

**Sorting:** `sortColumn` specifies the property name; `sortDirection` is `"asc"` (default) or `"desc"`. Only one sort column is supported per request. All filterable fields are also sortable. `CreatedOn` and `LastModifiedOn` are sortable on all entities.

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
| UserSessionBookmark | UserId, EventId (derived via Session join — not a column on UserSessionBookmark; the filter translates to a JOIN on Session.EventId, BR-58) |
| User | Email, FirstName, LastName, Role |

**Note:** `Speaker.FullName` and `Session.Duration` are computed properties with no database column and cannot be used for filtering or sorting. Clients should filter by `FirstName`/`LastName` or `StartsAt`/`EndsAt` instead.

> **Child entity read endpoints:** Child entities (Room, CategoryItem, EventSpeaker, SessionSpeaker, etc.) have **top-level read endpoints** (`GET /api/rooms`, `GET /api/categoryitems`, etc.) even though they are owned children of their aggregate root. This is a deliberate pragmatic choice: read operations bypass aggregate boundaries for query convenience (e.g., listing all rooms across events, filtering category items by category). **Write operations** (create, update, delete) are always routed through the parent aggregate to enforce invariants (BR-2 through BR-5). This hybrid read-through/write-through-aggregate pattern is documented to avoid confusion with strict DDD aggregate boundaries.

---

### 11.4 Default Sort Orders

When no `sortColumn` is specified, entities are returned in the following default order:

| Entity | Default Sort | Rationale |
|---|---|---|
| Event | `StartDate` ascending | Chronological |
| Session | `StartsAt` ascending, then `Title` ascending | Schedule order |
| Speaker | `LastName` ascending, then `FirstName` ascending | Alphabetical |
| Room | `Sort` ascending, then `Name` ascending | Display order |
| Category | `Sort` ascending, then `Title` ascending | Display order |
| CategoryItem | `Sort` ascending, then `Name` ascending | Display order within category |
| Question | `Sort` ascending | Survey order |
| UserSessionBookmark | `CreatedOn` descending | Newest bookmarks first |
| EventQuestionAnswer | `CreatedOn` ascending | Chronological submission order |
| SessionQuestionAnswer | `CreatedOn` ascending | Chronological submission order |
| SpeakerQuestionAnswer | `CreatedOn` ascending | Chronological submission order |

---

### 11.5 Feedback Submission (BR-107)

Feedback answers are submitted via `POST` on the `EventQuestionAnswer` and `SessionQuestionAnswer` endpoints (`SpeakerQuestionAnswer` is a deferred capability: domain model only, no controller or UI; see §10.29 and BR-107). `POST` performs an **upsert** (see BR-107 for semantics).

**Authentication:** Required (BR-42)

**Validation:**
- `QuestionId` must reference an existing Question with the correct `QuestionEntity` — `"Event"` for EventQuestionAnswer, `"Session"` for SessionQuestionAnswer, `"Speaker"` for SpeakerQuestionAnswer (BR-128)
- `AnswerValue` is validated against `QuestionType`: Rating (integer 1–5), Text (max 2000 chars), Email (valid `MailAddress` format) — see BR-124
- Session feedback (both `POST` and `PUT`): session must not be a service session (BR-91)
- Event must be published (BR-108) — this applies to **all users including Organizers**. Feedback on unpublished events is rejected because the feedback flow assumes an event is live/accessible to attendees. Organizers who need to test feedback should publish the event first.
- Event must be published for session feedback too — `SessionQuestionAnswer` submission validates that the session's parent Event has `IsPublished = true` (BR-108). Submitting session feedback for a session belonging to an unpublished event returns HTTP 400 with detail "Feedback cannot be submitted for sessions in unpublished events."
- Session must have `Status` of `Accepted` or null (BR-49) — feedback is only accepted for sessions with eligible status

**Upsert behavior:** `POST` creates (HTTP 201) or overwrites (HTTP 200) based on the (CreatedBy, QuestionId, EntityId) uniqueness key (BR-123). `PUT` updates an existing answer by its ID (standard update). `PUT` on session feedback is subject to the same service session (BR-91), event visibility (BR-108), and session status (BR-49) constraints as `POST`.

**Soft-deleted Question handling:** If a Question referenced by a feedback answer is soft-deleted (BR-73), `PUT` on an existing answer that references that Question is still permitted — the answer retains its historical association. However, `POST` (new submission) referencing a soft-deleted Question is rejected with HTTP 422 ("Question not found or does not apply to this entity type") because soft-deleted questions are excluded from queries (BR-128 validation uses the active question set). This allows attendees to update previously submitted answers but not submit new answers to retired questions.

---

### 11.7 Lookup Endpoints

Lookup endpoints return lightweight Id + display name pairs for populating dropdowns, autocomplete, and reference selectors. Available on all aggregate root entities.

**Endpoint pattern:** `GET /api/{entities}/lookup`

**Response body** — array of `LookupItem`:

```json
[
  { "id": 1, "name": "Atlanta Developers Conference 2025" },
  { "id": 2, "name": "Atlanta Developers Conference 2026" }
]
```

| Entity | Route | `name` field source |
|---|---|---|
| Event | `/api/events/lookup` | `Name` |
| Session | `/api/sessions/lookup` | `Title` |
| Speaker | `/api/speakers/lookup` | `FullName` (computed) |
| Category | `/api/conferencecategories/lookup` | `Title` |
| Question | `/api/questions/lookup` | `QuestionText` |

Lookup responses are **not paginated** — they return all non-deleted records. For entities with large cardinalities, prefer the paginated list endpoint with specific field filtering. Lookup responses respect event visibility (BR-108) — unpublished events are excluded for non-organizers.

---

### 11.8 `includeChildren` on List Endpoints

The `includeChildren=true` parameter is supported on both single-entity (`GET /api/{entities}/{id}`) and list (`GET /api/{entities}`) endpoints.

**Performance consideration:** When `includeChildren=true` is used on list endpoints, the implementation should apply a reduced page size cap (lower than the normal 500-item cap in BR-11) to limit query fan-out. The exact cap is an implementation concern. Clients that need large result sets should omit `includeChildren` and fetch child data separately.

**Depth:** One level only (BR-80). Children of children are never loaded.

---

### 11.9 Feedback Access

Organizers retrieve raw, individual feedback records via the standard paginated `EventQuestionAnswer` and `SessionQuestionAnswer` list endpoints (filtered by EventId/SessionId and QuestionId; the `SpeakerQuestionAnswer` endpoint is deferred with the rest of the speaker-feedback capability, see §10.29). Each record includes `CreatedBy`, `AnswerValue`, and timestamps.

---

## 12. Authentication & Identity Architecture

This section defines the authentication mechanism for both the Web UI (Blazor) and MAUI (mobile) clients, which share a common Razor class library. It replaces the device-based identity model with an email + password model and introduces speaker-user linking.

---

### 12.1 Identity Model

A user is uniquely identified by their **email address**. Each email corresponds to exactly one user account. This is the canonical identity across all platforms (web and mobile).

#### User Entity (detailed typing)

> **Note:** The canonical User entity definition is in Section 2 (Bounded Context: Identity). The table below provides additional typing and constraint detail for implementation.

| Attribute | Type | Required | Unique | Description |
|---|---|---|---|---|
| Id | int | Yes (auto-generated) | Yes | Stable internal identifier (UserIdentifierType = int) |
| Email | string | Yes | Yes | Canonical identity. Used for login on all platforms and for speaker linking. |
| PasswordHash | byte[] | Yes | No | Cryptographic hash of the user's password, stored as `varbinary(max)`. Never stored or transmitted in plaintext. |
| PasswordSalt | byte[] | Yes | No | Per-user cryptographic salt used for password hashing. Stored as `varbinary(max)`. |
| FirstName | string | Yes | No | User's first name. Used for display and speaker matching. |
| LastName | string | Yes | No | User's last name. Used for display and speaker matching. |
| Role | string | Yes (default: Attendee) | No | Authorization tier: `Attendee` or `Organizer`. Stored as plain string. |
| LinkedSpeakerId | GUID? | No | Yes (when non-null) | FK to Speaker entity. Set when user is linked to a speaker (automatic or manual). |
| RefreshToken | string? | No | No | Current refresh token (opaque string) or null if revoked. Stored directly on the User entity. |
| RefreshTokenExpiry | DateTime? | No | No | UTC expiry time for the current refresh token (7 days per BR-205). Null when no active token. |
| FullName | string | N/A (computed) | No | Computed: "{FirstName} {LastName}". Read-only, no database column. |
| DeviceId | string? | No | No | Device identifier from MAUI clients. Null for web-only users. Stored as metadata for analytics; not used for authentication. |
| DeviceFormFactor | string? | No | No | Device metadata (MAUI only) |
| DevicePlatform | string? | No | No | Device metadata (MAUI only) |
| DeviceModel | string? | No | No | Device metadata (MAUI only) |
| DeviceManufacturer | string? | No | No | Device metadata (MAUI only) |
| DeviceName | string? | No | No | Device metadata (MAUI only) |
| DeviceType | string? | No | No | Device metadata (MAUI only) |

**Evolution note:** The original User entity used `DeviceId` as the primary identity (device-based registration). This was replaced with email + password authentication to support the web UI (Blazor). `Email` is now required and unique, `PasswordHash`/`PasswordSalt`/`FirstName`/`LastName` were added, `DeviceId` became optional metadata (changed from GUID to string), `LinkedSpeakerId` was added for speaker-user linking, and `RefreshToken`/`RefreshTokenExpiry` were added for web session management. The `FullName` computed property was added for display convenience. Domain events `UserRegistered` and `UserPasswordChanged` are raised for corresponding lifecycle actions.

#### Speaker Entity Addition

> **Note:** `LinkedUserId` is also documented on the Speaker entity in Section 2.

| Attribute | Type | Required | Description |
|---|---|---|---|
| LinkedUserId | GUID? | No | FK to User entity. Set when a user is linked to this speaker. 1:1 relationship with `User.LinkedSpeakerId`. |

---

### 12.2 Authentication Flows

#### UC-30: User Registration

**Actors:** Unauthenticated user (any platform)
**Preconditions:** None (self-registration is open — BR-211)

**Endpoint:** `POST /auth/register`

**Request body:**

```json
{
  "email": "attendee@example.com",
  "password": "SecureP@ss1",
  "firstName": "Alice",
  "lastName": "Smith",
  "deviceId": "a1b2c3d4-...",
  "deviceFormFactor": "phone",
  "devicePlatform": "iOS",
  "deviceModel": "iPhone 15",
  "deviceManufacturer": "Apple",
  "deviceName": "My iPhone",
  "deviceType": "Physical"
}
```

**Required fields:** `email`, `password`, `firstName`, `lastName`
**Optional fields:** All device fields (provided by MAUI clients only)

**Main Flow:**

1. System validates input (email format, password strength per BR-203, names not empty)
2. System checks that no user exists with the given email
3. System creates a new user record with hashed password (BR-204) and `Role = Attendee` (BR-45)
4. If device fields are provided (MAUI client), they are stored on the user record
5. System checks if a Speaker entity exists with `Email` matching the registered email (case-insensitive) — if match found and speaker is not already linked to a different user, sets `User.LinkedSpeakerId` and `Speaker.LinkedUserId` (BR-207)
6. System generates a JWT containing `user_id`, `email`, `role`, `first_name`, `last_name`, and optionally `speaker_id` claims
7. For web clients: system also generates a refresh token and sets it as an HttpOnly cookie (BR-205)
8. Returns access token response

**Response body:**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 3600,
  "tokenType": "Bearer"
}
```

**Response codes:**
- HTTP 201 — user created, JWT returned
- HTTP 409 — email already registered
- HTTP 422 — validation failure (password too weak, invalid email format, missing required fields)

**Alternate Flows:**
- Email already registered → HTTP 409 Conflict with ProblemDetails: `"An account with this email already exists."`
- Password does not meet strength requirements → HTTP 422 with field-level validation errors

**Postconditions:** User has a valid account and JWT. If email matched a speaker, the speaker link is established.

---

#### UC-31: User Login

**Actors:** Registered user (any platform)
**Preconditions:** User has a registered account

**Endpoint:** `POST /auth/login`

**Request body:**

```json
{
  "email": "attendee@example.com",
  "password": "SecureP@ss1",
  "deviceId": "a1b2c3d4-...",
  "deviceFormFactor": "phone",
  "devicePlatform": "iOS",
  "deviceModel": "iPhone 15",
  "deviceManufacturer": "Apple",
  "deviceName": "My iPhone",
  "deviceType": "Physical"
}
```

**Required fields:** `email`, `password`
**Optional fields:** All device fields (provided by MAUI clients only)

**Main Flow:**

1. System validates email + password against stored credentials
2. If device fields are provided (MAUI client), system updates the device metadata on the user record
3. System checks speaker linking (in case a speaker was imported via Sessionize after the user registered) — same logic as registration step 5
4. System generates JWT with current claims
5. For web clients: generates refresh token, sets HttpOnly cookie
6. Returns access token response

**Response body:** Same shape as registration (`accessToken`, `expiresIn`, `tokenType`).

**Response codes:**
- HTTP 200 — login successful
- HTTP 401 — invalid email or password (generic message — do not reveal whether the email exists)
- HTTP 429 — too many failed attempts (BR-212)

**Alternate Flows:**
- Invalid credentials → HTTP 401 with ProblemDetails: `"Invalid email or password."` Failed attempt counter incremented (BR-212).
- Account soft-deleted → HTTP 401 (same generic message — soft-deleted accounts cannot authenticate)

**Postconditions:** User has a valid JWT. Device metadata updated if provided. Speaker link established if newly matched.

---

#### UC-32: Refresh Access Token (Web Only)

**Actors:** Authenticated web user
**Preconditions:** Valid refresh token in HttpOnly cookie

**Endpoint:** `POST /auth/refresh`

**Request body:** The refresh token. Web clients send the token from the HttpOnly cookie; MAUI clients send stored credentials.

**Main Flow:**

1. System reads refresh token from cookie
2. System validates the token (not expired, not revoked)
3. System issues a new access token and rotates the refresh token (BR-205)
4. New refresh token is set as an HttpOnly cookie; old token is invalidated
5. Returns new access token

**Response body:** Same shape as login (`accessToken`, `expiresIn`, `tokenType`).

**Response codes:**
- HTTP 200 — new tokens issued
- HTTP 401 — refresh token invalid, expired, or revoked

**Alternate Flows:**
- Revoked token presented (reuse detection) → all refresh tokens for the user are revoked (BR-206). Returns HTTP 401. User must re-login.

**MAUI clients** do not use this endpoint. When a MAUI access token expires, the app re-authenticates silently by calling the login endpoint with credentials stored in SecureStorage. This provides equivalent UX (no user interaction) without refresh token complexity.

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

1. System validates the current password against stored credentials
2. System validates the new password meets strength requirements (BR-203)
3. System updates the password hash and salt
4. System raises `UserPasswordChanged` domain event
5. Returns HTTP 204 No Content

**Response codes:**
- HTTP 204 — password changed successfully
- HTTP 400 — current password incorrect
- HTTP 401 — not authenticated
- HTTP 422 — new password does not meet strength requirements (BR-203)

**Postconditions:** User's password is updated. Existing JWT remains valid until expiry. Refresh token is not invalidated — the user stays logged in.

---

### 12.3 Token Architecture

#### Access Token (JWT)

| Property | Value |
|---|---|
| Format | JWT (RS256 in production via JWKS; HS256 only as a legacy / no-RSA-key fallback) |
| Lifetime | 1 hour (BR-12, unchanged) |
| Storage (MAUI) | SecureStorage |
| Storage (Web) | In-memory (JavaScript variable). NOT localStorage — reduces XSS exposure. |

#### JWT Claims

| Claim | Type | Always Present | Description |
|---|---|---|---|
| `user_id` | int | Yes | Stable user identifier (`UserIdentifierType = int`) |
| `email` | string | Yes | User's email address |
| `role` | string | Yes | `Attendee` or `Organizer` |
| `first_name` | string | Yes | User's first name |
| `last_name` | string | Yes | User's last name |
| `speaker_id` | GUID | No | Present only when user is linked to a Speaker entity |

> **Note:** `device_id` is no longer a JWT claim. It is device metadata stored on the User entity, not an identity claim.

#### Refresh Token (Web Only)

| Property | Value |
|---|---|
| Format | Opaque (cryptographically random string), not JWT |
| Lifetime | 7 days |
| Storage | HttpOnly, Secure, SameSite=Strict cookie |
| Rotation | Rotated on each use — old token invalidated, new token issued |
| Reuse detection | If a rotated (invalidated) token is presented, ALL refresh tokens for that user are revoked (indicates potential token theft) |

---

### 12.4 Speaker-User Linking

#### Automatic Linking

Occurs at registration (UC-30 step 5) and login (UC-31 step 3):

1. System queries for a Speaker with `Email` matching `User.Email` (case-insensitive)
2. If a match is found and `Speaker.LinkedUserId` is null → link is established bidirectionally (`User.LinkedSpeakerId = Speaker.Id`, `Speaker.LinkedUserId = User.Id`)
3. If `Speaker.LinkedUserId` is already set to a different user → no automatic override (organizer must manually re-link)
4. JWT is issued with `speaker_id` claim when linked

#### Manual Linking (Organizer)

| Endpoint | Method | Description |
|---|---|---|
| `/api/speakers/{speakerId}/link` | `PUT` | Link a user to a speaker. Body: `{ "userId": "..." }`. Organizer role required. |
| `/api/speakers/{speakerId}/link` | `DELETE` | Unlink a user from a speaker. Organizer role required. |

Manual linking overrides automatic linking (for cases where a speaker's Sessionize email differs from their user account email). Manual unlinking clears both sides of the relationship.

#### Speaker-Specific Features

When a user has a `speaker_id` claim, they gain access to read-only views of their own session data:

| Feature | Endpoint | Auth | Description |
|---|---|---|---|
| View session feedback | `GET /api/speakers/{speakerId}/sessions/{sessionId}/feedback` | Public (`AllowAnonymous`) | Aggregated ratings + individual text responses for sessions the speaker presents |
| View session bookmark counts | `GET /api/speakers/{speakerId}/sessions/{sessionId}/bookmarks/count` | Public (`AllowAnonymous`) | Number of attendees who bookmarked each of the speaker's sessions |
| Update own speaker profile | `PUT /api/speakers/{speakerId}` | Authenticated | Speaker can update bio, tagline, social links on their own linked speaker record |

**Authorization:** The feedback and bookmark count endpoints are **publicly accessible** (`AllowAnonymous`) — any user (including unauthenticated API consumers) can view aggregated session feedback and bookmark counts for any speaker. This enables public speaker/session quality metrics. The profile update endpoint requires authentication: the requesting user's `speaker_id` JWT claim must match the `{speakerId}` in the URL, or the user must have the Organizer role.

**Sessionize Conflict:** When Sessionize data is refreshed (UC-6), speaker profiles are overwritten per BR-48 (Sessionize is the source of truth). Local edits made by a speaker via the app are replaced. This is consistent with existing behavior and keeps the import logic simple. Speakers should be informed that their profile edits may be overwritten during a Sessionize refresh.

**Notification mechanism:** When a speaker edits their profile via the app (BR-214), no real-time notification is sent to organizers. The edit is visible through the standard audit trail (`LastModifiedBy`, `LastModifiedOn` on the Speaker entity). Organizers can identify speaker-edited profiles by checking whether `LastModifiedBy` corresponds to the linked user rather than an organizer or the Sessionize refresh process. A dedicated notification (e.g., domain event, email alert) for speaker profile edits is a potential future enhancement but is out of scope for the initial implementation.

---

### 12.5 Shared Auth Layer (Common Razor Library)

The Web UI (Blazor) and MAUI UI share a common Razor class library for UI components. Authentication is abstracted through a shared interface with platform-specific implementations.

#### Auth Service Abstraction

```
IAuthenticationService
├── RegisterAsync(RegisterRequest, ipAddress?) → Result<AuthenticationResponse>
├── LoginAsync(LoginRequest) → Result<AuthenticationResponse>
├── RefreshTokenAsync(RefreshTokenRequest) → Result<AuthenticationResponse>
├── RevokeTokenAsync(userId) → Result
├── ChangePasswordAsync(userId, ChangePasswordRequest) → Result
```

The UI layer wraps this with platform-specific `IAuthService` implementations that add client-side concerns:

```
IAuthService (UI abstraction)
├── RegisterAsync(RegisterRequest) → AuthResult
├── LoginAsync(LoginRequest) → AuthResult
├── LogoutAsync() → void
├── RefreshTokenAsync() → AuthResult?
├── GetCurrentUserAsync() → UserClaims?
├── IsAuthenticatedAsync() → bool
```

`AuthResult` contains the access token, expiry, and parsed claims. `UserClaims` is a strongly-typed projection of the JWT claims (UserId, Email, Role, FirstName, LastName, SpeakerId?).

#### Platform Implementations

| Concern | MAUI Implementation | Web (Blazor) Implementation |
|---|---|---|
| Token storage | SecureStorage (access token + email/password) | In-memory (access token), HttpOnly cookie (refresh token) |
| Auto re-auth | Stored credentials → login endpoint | Refresh token → refresh endpoint (UC-32) |
| Device metadata | `DeviceInfo` API populates device fields on login/register | Not applicable (web has no device) |
| Logout | Clears SecureStorage, navigates to login | Calls logout endpoint (clears refresh cookie), clears in-memory token |
| AuthStateProvider | Reads token from SecureStorage, notifies on change | Reads from in-memory token, notifies on change |

#### Blazor Integration

- Custom `AuthenticationStateProvider` wraps `IAuthService`
- `CascadingAuthenticationState` propagates claims to all Razor components
- `AuthorizeView` and `[Authorize]` attributes work identically on both platforms
- Role-based gating: `<AuthorizeView Roles="Organizer">` for admin-only UI
- Speaker-specific UI gated on `speaker_id` claim presence

---

### 12.6 Business Rules

| Rule | Description |
|---|---|
| BR-200 | `User.Email` is **required and unique** (case-insensitive). It is the canonical identity across all platforms. |
| BR-201 | User identity is **email-based**. Users register with email + password + first name + last name. `DeviceId` is optional metadata captured from MAUI clients for analytics, not an authentication credential. |
| BR-202 | Device migration is **implicit**. A user logs in from any device with their email + password. MAUI device metadata fields on the User record are updated to the latest device on each login. No explicit account linking or migration flow is needed. |
| BR-203 | Passwords must meet minimum strength requirements: **minimum 8 characters**, containing at least one uppercase letter, one lowercase letter, one digit, and one special character. |
| BR-204 | Passwords are stored as a **one-way hash** with a **per-user salt** — both stored as `byte[]` (`varbinary` in SQL Server) on the User entity (`PasswordHash` and `PasswordSalt` fields). Plaintext passwords are never stored, logged, returned in API responses, or included in error messages. |
| BR-205 | **Refresh tokens** are issued to web clients only (via HttpOnly, Secure, SameSite=Strict cookie). Valid for **7 days**. Rotated on each use — the previous token is invalidated when a new one is issued. |
| BR-206 | **Refresh token reuse detection:** If a previously-rotated (invalidated) refresh token is presented, **all** refresh tokens for that user are revoked immediately. This indicates potential token theft. The user must re-authenticate via login. |
| BR-207 | **Speaker-user linking** is automatic at registration and login when `User.Email` matches `Speaker.Email` (case-insensitive). The link is stored bidirectionally (`User.LinkedSpeakerId`, `Speaker.LinkedUserId`). **Discovery limitation:** Speaker emails are not exposed via public API (BR-66), so attendees cannot verify which email their Speaker profile uses in Sessionize. Organizers should inform speakers of their Sessionize-registered email address before the conference so they register with the matching email. When automatic matching fails (e.g., speaker uses a different personal email), organizers can use manual linking (BR-209). |
| BR-208 | A Speaker can be linked to **at most one User**, and a User can be linked to **at most one Speaker** (1:1 relationship). Enforced by unique constraints on both FK columns. |
| BR-209 | Organizers can **manually link or unlink** a User and Speaker regardless of email match. Manual linking overrides automatic linking. |
| BR-210 | The `speaker_id` JWT claim grants **no additional permissions** beyond what the user's `role` provides. It is an identity claim that enables speaker-specific data views (own session feedback, bookmark counts, profile editing). Authorization is determined solely by `role`. |
| BR-211 | Self-registration is **open**. Any person can create an account without invitation or pre-approval. New accounts default to the `Attendee` role (BR-45). Organizer promotion is done via database seeding or manual update. |
| BR-212 | Login **brute-force protection:** After **5 consecutive failed login attempts** for a given email address, subsequent attempts are delayed with exponential backoff (1s, 2s, 4s, 8s, 16s, capped at **5 minutes**). The counter resets on successful login. |
| BR-213 | Registration **abuse prevention:** Maximum **10 account registrations per IP address per hour**. Excess attempts return HTTP 429. |
| BR-214 | Speakers can update their **own** speaker profile (bio, tagline, social links) when linked. The `speaker_id` in the JWT must match the target Speaker entity's ID. Organizers can update any speaker profile regardless of linking. |
| BR-215 | Sessionize refresh (UC-6) **overwrites all speaker profile fields** including any local edits made by speakers via the app. Sessionize remains the source of truth (BR-48). |
| BR-216 | **Logout** invalidates the user's current refresh token (web) or clears stored credentials (MAUI). Access tokens cannot be server-side invalidated before expiry — they remain valid until their 1-hour TTL expires. For immediate revocation needs (e.g., account deletion, role change), a token blacklist or short-lived tokens would be needed (out of scope). |

---

### 12.7 Password Management

**Password change** (UC-33) is supported via `PUT /auth/password` — authenticated users can change their own password by providing the current password and a new password.

**Password reset via email** is **out of scope for the initial implementation**. If an attendee forgets their password during the conference, they must contact an organizer to have their account deleted (UC-21) so they can re-register.

**Rationale:** The conference engagement window is 1–2 days. Re-registration is low-cost (bookmarks can be recreated in minutes). Adding password reset requires email sending infrastructure (SMTP/SendGrid) and a secure token flow, which is disproportionate to the benefit for v1.

**Planned flow (when implemented):**
1. `POST /auth/forgot-password` with `{ "email": "..." }` → sends a reset code to the email (always returns HTTP 202 to prevent email enumeration)
2. `POST /auth/reset-password` with `{ "email": "...", "code": "...", "newPassword": "..." }` → validates code, updates password

---

### 12.8 Design Rationale

**Why email + password instead of device-based identity:**

The original device-based registration model was designed for a mobile-only app where frictionless registration was paramount. With the addition of a web UI, device identity becomes untenable — browsers have no stable device identifier. Email is the natural cross-platform identity anchor: it works on both web and mobile, enables speaker linking (speakers already have email in Sessionize), and is familiar to all users.

**Why email + password instead of magic link:**

Magic link requires email delivery infrastructure for every login, not just for password resets. At a conference venue with spotty WiFi, waiting for an email to arrive is real friction. Email + password authentication works instantly once registered, requires no external email service for the core auth flow, and uses the same flow on both MAUI and web — simplifying the shared Razor library.

**Why speaker is a claim, not a role:**

Roles (`Attendee`, `Organizer`) are permission tiers — each tier unlocks a set of endpoints. Speaker is an identity link — it means "this user is the same person as this Speaker entity." A speaker is also an attendee (they attend sessions, give feedback, bookmark talks). A speaker could also be an organizer. Making speaker a role would create awkward combinations (Attendee+Speaker? Organizer+Speaker?) and conflate identity with authorization. Keeping it as a JWT claim is orthogonal to the role system.

**Why refresh tokens for web but not MAUI:**

MAUI can silently re-authenticate using credentials stored in SecureStorage — the user never sees a login prompt when their token expires. Web browsers have no equivalent secure credential store. A refresh token (7-day HttpOnly cookie) bridges this gap, keeping web users logged in for the conference duration without requiring email + password entry every hour.

**Why DeviceId is retained as metadata:**

Even though DeviceId is no longer used for authentication, it remains useful for: (a) analytics — understanding which devices attendees use, (b) future push notification targeting, and (c) debugging — correlating support requests with specific device configurations.
