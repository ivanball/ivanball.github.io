# ADR-123: Speaker-Published Session Materials

## Status
Accepted (2026-09-12). Extends [ADR-045](045-managed-file-storage-and-avatars.md) from images to
documents: the framework gains a document content sniffer, a blob-name sanitizer and stored response
headers, and ADC gains a `SessionAsset` aggregate that uses them. ADR-045's avatar-only scope
statement ("no other managed uploads exist") is superseded by this record.

## Context
A speaker finishes a talk and forty people want the deck. Until now ADC's only answer was
`Session.ResourceLinks`, a free-text field imported from Sessionize: the speaker types URLs into
Sessionize, a refresh overwrites whatever was there (BR-48), and an attendee gets an unordered,
unvalidated paragraph rendered as plain text. Nothing is hosted, nothing is ordered, nothing
survives a link rotting, and a speaker who has a PDF rather than a public URL has nowhere to put it.

[ADR-045](045-managed-file-storage-and-avatars.md) already built managed blob storage, so the
storage half of the problem looks solved. It is not, and the reason is the part of that record that
does the security work. An avatar is safe because it is **re-encoded pixel by pixel**: decode,
strip all metadata, write a fresh JPEG, so only pixels survive and a polyglot or an EXIF payload
dies in the transcode. A slide deck cannot be treated that way. A `.pptx` that comes out of a
re-encoder is either byte-identical to what went in or it is a broken file, so the bytes are stored
as the user supplied them and the defence has to be a **gate at the door** instead of a transform.
There was no such gate in the framework: `ImageContentSniffer` knows image signatures and nothing
else.

Two smaller gaps came with it. A user-supplied file name is part of a blob name and therefore part
of a URL, and nothing in the framework reduced one to a safe segment. And `IFileStorageService`
stored bytes plus a content type, which is all an avatar needs, but a document also needs the
response headers that decide whether the browser renders it or saves it, and under what name.

On the ADC side the modelling question was where the material hangs. `Session` is the most
re-imported entity in the system and already owns three child collections (`SessionSpeakers`,
`SessionQuestionAnswers`, `SessionCategoryItems`). The authorization question was newer: every
other Conference write is either anonymous-read or capability-gated, and neither shape can express
"the speaker of this session, and only that session".

## Decision
**Session materials are a separate Conference aggregate, written by the session's own speakers or by
an organizer, stored in a public-read container under an unguessable blob name, and admitted only by
a framework-level content gate that reads the real bytes.** Six parts carry that.

**1. `SessionAsset` is its own aggregate, not a child of `Session`.**
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/SessionAssets/SessionAsset.cs:23`,
reasoning at `:9-21`.) It carries `EventId` and `SessionId` as plain foreign keys with **no
navigation properties** (`:31`, `:34`; the relationships are declared without navigations at
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Infrastructure/Persistence/EntityConfiguration/SessionAssets/SessionAssetConfiguration.cs:60-68`),
so a Sessionize refresh walking `Session` cannot see them and cannot overwrite them. One aggregate
covers both kinds, `File` and `Link`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/SessionAssets/SessionAssetKind.cs:13`),
because the public page renders them as one ordered list and they differ only in which optional
columns carry a value; the pairing rule (a file must carry a blob name, a link must not) is a domain
invariant (`.../SessionAssetInvariants.cs:62-83`). The identifier is a **server-minted GUID** rather
than the module's usual database integer
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:16`,
minted at `SessionAsset.cs:301`), because the id is a path segment of a public blob name and a
sequential one would let anyone who downloaded a single asset walk the container. The asset URL is
validated as an absolute `https` URL in the domain (`SessionAssetInvariants.cs:128-147`), so a
`javascript:` or `data:` value is refused once rather than sanitized at each render site.

**2. Authorization is capability OR ownership, decided in the handlers.** A caller may manage a
session's materials if they hold `conference:session-assets:manage`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:44`,
granted to Organizer and Admin through the full Conference set at `:58` and to ContentEditor through
the ContentManagement set at `:73`; the grants are wired at
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:43-44` and `:54`)
**or** if
their token's `speaker_id` claim is among the session's current, non-deleted speakers. The second
leg is data, not a capability, so no attribute can express it: the controller's write actions carry a
plain `[Authorize]`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/Controllers/SessionAssets/SessionAssetsController.cs:50`)
and every handler re-asks `SessionAssetAccessService`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/SessionAssets/SessionAssetAccessService.cs:22`,
the decision at `:47`), which reads the session's own `SessionSpeakers` rows (`:132-134`). Reading
the speaker list rather than the asset's `UploadedBySpeakerId` is deliberate: a co-speaker can fix a
colleague's typo, and a speaker removed from the session loses the right immediately without any row
being rewritten.

**3. The anonymous read applies the public-session rule and answers empty, not 404.** The list
action is `[AllowAnonymous]` and output-cached under the sessions policy
(`SessionAssetsController.cs:76-78`), because it is part of the public session page. A caller who
cannot see the session gets an **empty list**
(`.../SessionAssets/UseCases/GetBySession/GetSessionAssetsHandler.cs:44-47`), so a guessed session id
cannot confirm that an unannounced talk has materials. Visibility reuses the same BR-49 status
allow-list every other public read uses, plus BR-108's published-event rule
(`SessionAssetAccessService.cs:118-130`). A speaker or a privileged reader sees more than the public
projection, so their response is kept out of the shared cache entry by turning cache storage off for
that request (`SessionAssetsController.cs:90-93`).

**4. Document safety is a framework gate, not an ADC one.** Three additions to MMCA.Common, all
under `MMCA.Common.Application/Interfaces/Infrastructure/Storage/`:

- **`DocumentContentSniffer`** (`DocumentContentSniffer.cs:49`) accepts pdf, pptx, docx, xlsx, zip,
  txt and md, and only when the **bytes and the extension agree** (`Detect`, `:91`); the
  client-declared content type is never consulted, so a `.pdf` name over zip bytes and an executable
  renamed to `.docx` are both refused. Office Open XML is the interesting case, because every one of
  those three formats is a zip: the sniffer requires the zip signature **and** a `[Content_Types].xml`
  entry at the package root (`:153-188`), reads **entry names only** (`:176-177`, opening an entry
  stream is what a zip bomb waits for), and bails out of an archive declaring more than 4096 entries
  (`:61`, `:170-173`). Text formats must decode as NUL-free UTF-8 (`:197-211`). The canonical MIME
  type the sniffer returns is what gets stored, so the type a browser is later served is derived from
  the bytes.
- **`BlobNames.SanitizeFileName`** (`BlobNames.cs:33`) reduces a user-supplied name to
  `A-Z a-z 0-9 . _ -`, collapses runs of dots so no `..` can appear, trims leading and trailing
  separators, lower-cases the extension and bounds the length, falling back to `file` when nothing
  survives.
- **`FileUploadOptions`** (`FileUploadOptions.cs:13`) carries the `Content-Disposition` and
  `Cache-Control` headers stored **with the blob**, built by `Attachment` (`:48`) or `Inline` (`:59`)
  with RFC 6266 / RFC 5987 encoding of the user-facing file name. They are delivered through a new
  `UploadAsync` overload that is a **default interface member**
  (`IFileStorageService.cs:42-43`), forwarding to the three-argument contract, so the addition breaks
  no existing implementation; `AzureBlobFileStorageService` overrides it and writes the headers onto
  `BlobHttpHeaders` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Storage/AzureBlobFileStorageService.cs:27`,
  `:38-43`).

ADC's upload handler sniffs first and stores the canonical type
(`.../SessionAssets/UseCases/UploadFile/UploadSessionAssetHandler.cs:64-71`), and picks the
disposition by format: a PDF is `inline`, so it opens in the browser's own viewer, and everything
else is `attachment` (`:151-153`), both with an immutable one-year `Cache-Control` (`:45`) that is
safe precisely because a blob name carries a fresh asset id and therefore never changes content.

**5. Storage reuses ADR-045 with its own container, and downloads go straight to the blob.** The
Conference service registers the same `AddAzureBlobFileStorage`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:330`) against a new **public-read
`session-assets` container** on the existing storage account (`MMCA.ADC/infra/main.bicep:1182-1188`,
container name injected at `:1852`); the account-scoped data-plane grant already covers it, so no
second role assignment (`:1205-1210`). The blob name is
`{eventId}/{sessionId}/{assetId}/{sanitized-file-name}`
(`UploadSessionAssetHandler.cs:88-92`), which is what makes a public container acceptable: the GUID
segment is unguessable, so holding one asset URL reveals nothing about any other. Attendees download
from blob storage directly, as they already do for avatars, with no API proxy and no CDN in front.
Where storage is not configured, the null default stands and an upload fails with
`SessionAsset.StorageNotConfigured` while links keep working (`:54-60`), which is the local-dev
posture. Optional on-upload malware scanning (Microsoft Defender for Storage) is available behind the
bicep parameter `enableSessionAssetMalwareScanning`, **defaulting to false**
(`MMCA.ADC/infra/main.bicep:136`, resource at `:1234-1250`), for the same two reasons
`grantAvatarStorageRole` is guarded: the write may exceed what the deploy identity is permitted to
do, and it is billed per GB scanned. It is defence in depth behind the content gate, not the primary
control.

**6. Blob removal is a post-commit internal command.** Deleting the row and deleting the bytes are
two different systems, so the second is scheduled as the durable internal command
`Conference.DeleteSessionAssetBlob.v1`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/SessionAssets/UseCases/DeleteSessionAssetBlob/DeleteSessionAssetBlobInternalCommand.cs:16-17`)
on [ADR-114](114-internal-commands-durable-job-queue.md)'s queue, mirroring what Identity already
does for avatars. Four paths schedule it: an asset delete
(`.../SessionAssets/UseCases/Delete/DeleteSessionAssetHandler.cs:63-73`), a session delete
(`.../Sessions/UseCases/Delete/DeleteSessionHandler.cs:71-95` soft-deletes the assets in the same
save, `:41-62` schedules the blobs after it commits), an event delete
(`.../Events/UseCases/Delete/DeleteEventHandler.cs:72-87`, cascading through
`EventCascadeDeletionDomainService.CascadeDelete` which now takes the event's assets as a fifth
collection, `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/EventCascadeDeletionDomainService.cs:18-23`),
and an upload whose row failed to commit after the bytes had already landed
(`UploadSessionAssetHandler.cs:112`, `:129`). Every one of them schedules **after** the commit, so a
rolled-back delete never removes a file its row still points at, and a storage outage or a crash in
that tail defers the cleanup instead of losing it.

**Limits.** 50 MB per file and at most 10 live assets per session, both stated once on
`SessionAssetLimits`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/SessionAssets/SessionAssetLimits.cs:11`,
`:27`), alongside the accepted-extension allow-list (`:34-43`) that the browser file picker and the
server share; the per-session cap is enforced by a grouped count at
`SessionAssetAccessService.cs:60-83`. The transport cap is the file size plus 64 KB
of multipart headroom (`SessionAssetLimits.cs:20`), because a file at exactly the limit is otherwise
refused by Kestrel with a bare 413 before the friendly validation error can run; the controller
applies it with `[RequestSizeLimit]` (`SessionAssetsController.cs:151-153`). The YARP gateway
terminates the request before the service sees it and has no endpoint to hang an attribute on, so the
body-size raise there is **path-scoped to `/SessionAssets/file` alone**
(`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:194-213`), not global: every other route keeps
its default budget. The gateway's forwarding route itself is anonymous, as every gateway route is
(`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:211-215`).

**UI (UI slice).** Speakers and organizers manage a session's materials through
`Conference.UI/Pages/SessionAssets/SessionAssetsPanel.razor`, hosted on both the speaker dashboard
and the organizer session detail page; attendees see them through
`SessionAssetsDownloadList.razor`, rendered on
`Conference.UI/Pages/Public/Sessions/PublicSessionDetail.razor` beneath the existing resource links.
Both components are marked as a UI slice here because they land separately from the API and domain
work this record describes.

**Visibility is immediate.** An asset appears as soon as its session is publicly visible; there is no
embargo, no separate publish step and no "materials posted" notification. A speaker who uploads
early is publishing early, which is the behaviour speakers asked for and the one that needs no state
machine.

**`Session.ResourceLinks` stays.** It is Sessionize-sourced, it is rendered exactly as before, and
assets are a separate ordered list beneath it (BR-116b). Migrating free text into structured rows
would mean parsing prose that a refresh can rewrite at any time.

## Rationale
Four alternatives were weighed.

**A child collection on `Session`.** The obvious DDD answer, and wrong for this entity. `Session` is
imported from Sessionize and re-imported on every refresh, which overwrites matched entities (BR-48),
so material authored here would sit inside the one aggregate in the module that a sync is licensed to
rewrite. It already owns three collections, so a fourth would be loaded by every handler that touches
a session for any reason. Making assets their own aggregate costs two denormalized foreign keys and
an explicit cascade in the delete handlers, and buys immunity from the refresh plus a read path that
touches one table.

**Proxying downloads through the API.** A controller action that streams the blob would let the
server re-check authorization per download and hide the storage URL. Rejected on both halves: there
is **no authorization requirement on reads** (a public session's materials are public by definition,
which is the whole point of publishing them), so the check it would perform is one that always
passes, and every megabyte would then be paid for twice, once out of storage and once out of the
container app, with the app's request timeout and memory now sitting in the path of a 50 MB transfer
on conference-venue wifi. The unguessable blob name is what protects a not-yet-public asset, and it
protects it without a hop.

**An ADC-local sniffer, skipping a Common release.** Tempting, because the feature is ADC's and a
framework release is a heavier step than a module file. Rejected because the thing being written is a
**security gate**, and a security gate that lives in one consumer is a security gate the next
consumer writes again, slightly differently. Store has document-shaped uploads ahead of it (invoices,
product manuals) and MMCA.Helpdesk's ticket attachments are the same problem verbatim. One sniffer,
one test suite, one place to fix a format quirk, and the extension cost is bounded: the sniffer,
`BlobNames` and `FileUploadOptions` are dependency-free static types, and the `UploadAsync` overload
is a default interface member so no existing implementation breaks.

**Embargo until the session ends (deferred, not rejected).** Holding materials back until a talk
finishes is a real request from organizers who do not want the deck read instead of the talk
attended. It is deferred rather than decided: it needs a per-event policy, a clock the public read
consults, and an answer for what a speaker sees in the meantime, which is a state machine this
feature does not need to exist. The current rule is the simple one, assets follow the session's own
visibility, and the embargo can be added later as a filter on a read that is already centralized in
one access service.

Two further follow-ups are recorded as deferred, not decided: a per-event embargo window (above) and
an attendee "materials posted" notification on a bookmarked session.

## Trade-offs
- **The container is public-read, so a URL is a credential.** Anyone holding a blob URL can fetch it,
  forever, with no session and no referrer check. That is accepted for the same reason ADR-045
  accepted it for avatars: this content exists to be downloaded by anonymous visitors. The
  unguessability lives entirely in the GUID path segment, so anything that leaks a URL (a speaker
  pasting it into a public chat before the session is announced) leaks the file.
- **Bytes are stored as uploaded, so the gate is the only defence.** Unlike an avatar, nothing about
  a stored deck has been transformed, so a payload the sniffer's format rules admit is a payload the
  container serves. The sniffer bounds the format, not the content; Defender for Storage exists for
  exactly that residue and is off by default, which means the shipped posture is format-checked but
  not malware-scanned.
- **Blob cleanup is eventually consistent.** Every delete path schedules the blob removal after its
  commit, so between the commit and the queue's next tick the file is still fetchable by anyone
  holding its URL. A row that fails to schedule is logged as an orphan that needs a manual sweep;
  there is no reconciler that walks the container looking for blobs with no row.
- **The gateway carries a duplicated literal.** The Gateway references no Conference assembly, so its
  50 MB plus 64 KB body limit is a literal rather than `SessionAssetLimits.MaxRequestBytes`. The
  route is pinned by `RouteMapTests` and the real enforcement is the service-side attribute, but the
  two numbers have to be changed together.
- **Two authorization shapes now live in one module.** Every other Conference controller is readable
  from its attributes; this one is not, because half its rule is data. The handlers are the authority
  and the controller only stamps the claim, which is correct and is also the kind of thing a reviewer
  scanning attributes will miss. The architecture test that pins the anonymous surface names the list
  action explicitly for that reason.
- **A speaker can publish to the public web with no review.** The capability model deliberately gives
  a session's speakers the same authority an organizer has over that session. The counterweights are
  the format gate, the size and count caps, and soft-delete, which lets an organizer take material
  down without losing the record that it existed.

## Related
[ADR-045](045-managed-file-storage-and-avatars.md) (the storage abstraction, the image path this
record is the document sibling of, and the avatar-only scope statement this supersedes),
[ADR-114](114-internal-commands-durable-job-queue.md) (the durable queue the blob deletions ride),
[ADR-119](119-restrict-delete-by-default.md) (why the two foreign keys do not cascade in the
database, leaving the cascade to the delete handlers),
[ADR-020](020-permission-based-authorization.md) (the capability registry the manage permission joins),
[ADR-035](035-optimistic-concurrency.md) (the `If-Match` contract the asset update honors),
[ADR-005](005-soft-delete-vs-erasure.md) (the soft-delete lifecycle the asset rows follow),
[ADR-109](109-feature-by-folder-convention.md) (the aggregate-per-folder layout the new files follow).
