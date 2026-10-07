# ADR-123: Speaker-Published Session Materials

## Status
Accepted (2026-09-12). Extends [ADR-045](045-managed-file-storage-and-avatars.md) from images to
documents: the framework gains a document content sniffer, a blob-name sanitizer and stored response
headers, and ADC gains a `SessionAsset` aggregate that uses them. ADR-045's avatar-only scope
statement ("no other managed uploads exist") is superseded by this record. Revised 2026-10-01 (the upload-options overload is abstract and the template enables on-upload malware scanning by default; see Revision below). Revised 2026-10-06: all three delete paths schedule blob removal inside the delete's transaction, so there is no post-commit tail. Revised 2026-10-07: anchors refreshed after the v1.233.0 release.

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
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/MMCA.ADC.Conference.GlobalUsings.IdentifierType.cs:17`,
minted at `SessionAsset.cs:301`), because the id is a path segment of a public blob name and a
sequential one would let anyone who downloaded a single asset walk the container. The asset URL is
validated as an absolute `http` or `https` URL in the domain (`SessionAssetInvariants.cs:128-147`), so a
`javascript:` or `data:` value is refused once rather than sanitized at each render site.

**2. Authorization is capability OR ownership, decided in the handlers.** A caller may manage a
session's materials if they hold `conference:session-assets:manage`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissions.cs:47`,
granted to Organizer through the full Conference set at `:58-72` (`:70`) and to ContentEditor through
the ContentManagement set at `:79-88` (`:87`); the grants are declared once in
`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Shared/Authorization/ConferencePermissionGrants.cs:47-48`,
applied by the service at `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.API/DependencyInjection.cs:43`
and by the token-minting Identity host, per `ConferencePermissionGrants.cs:12-17`)
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
  `UploadAsync` overload that is **abstract** (`IFileStorageService.cs:37`), so every implementation
  must declare it rather than inherit a default that dropped the options (the null default declares it and
  fails with not-configured, `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Storage/NullFileStorageService.cs:22-23`); `AzureBlobFileStorageService` implements it and writes the headers onto
  `BlobHttpHeaders` (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Storage/AzureBlobFileStorageService.cs:28`,
  `:39-43`), and its three-argument overload forwards to it with `FileUploadOptions.None` (`:23-24`).

ADC's upload handler sniffs first and stores the canonical type
(`.../SessionAssets/UseCases/UploadFile/UploadSessionAssetHandler.cs:66-73`), and picks the
disposition by format: a PDF is `inline`, so it opens in the browser's own viewer, and everything
else is `attachment` (`:153-155`), both with an immutable one-year `Cache-Control` (`:47`) that is
safe precisely because a blob name carries a fresh asset id and therefore never changes content.

**5. Storage reuses ADR-045 with its own container, and downloads go straight to the blob.** The
Conference service registers the same `AddAzureBlobFileStorage`
(`MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:359`) against a new **public-read
`session-assets` container** on the existing storage account (`MMCA.ADC/infra/main.bicep:1328-1334`,
container name injected at `:2029`); the account-scoped data-plane grant already covers it, so no
second role assignment (`:1362-1370`, comment at `:1355-1357`). The blob name is
`{eventId}/{sessionId}/{assetId}/{sanitized-file-name}`
(`UploadSessionAssetHandler.cs:90-94`), which is what makes a public container acceptable: the GUID
segment is unguessable, so holding one asset URL reveals nothing about any other. Attendees download
from blob storage directly, as they already do for avatars, with no API proxy and no CDN in front.
Where storage is not configured, the null default stands and an upload fails with
`SessionAsset.StorageNotConfigured` while links keep working (`:56-62`), which is the local-dev
posture. Optional on-upload malware scanning (Microsoft Defender for Storage) is available behind the
bicep parameter `enableSessionAssetMalwareScanning`, **defaulting to true**
(`MMCA.ADC/infra/main.bicep:136`, resource at `:1382-1398`): the deploy identity's Contributor role covers
the settings write (comment at `:1372-1381`), and the per-GB scanning cost is bounded by a
50 GB monthly cap (`:1390`). Production diverges from the template: an `az rest` read of the
account's `defenderForStorageSettings/current` on 2026-10-01 returned Defender for Storage enabled
but `malwareScanning.onUpload.isEnabled=false` (`capGBPerMonth=-1`). It is defence in depth behind the content gate, not the primary
control.

**6. Blob removal is an internal command scheduled in the delete's transaction.** Deleting the row and deleting the bytes are
two different systems, so the second is scheduled as the durable internal command
`Conference.DeleteSessionAssetBlob.v1`
(`MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Application/SessionAssets/UseCases/DeleteSessionAssetBlob/DeleteSessionAssetBlobInternalCommand.cs:28-29`)
on [ADR-114](114-internal-commands-durable-job-queue.md)'s queue, mirroring what Identity already
does for avatars. Four paths schedule it: an asset delete
(`.../SessionAssets/UseCases/Delete/DeleteSessionAssetHandler.cs:63-74`, before the save at `:76`;
the command is `ITransactional`, `DeleteSessionAssetCommand.cs:16`), a session delete
(`.../Sessions/UseCases/Delete/DeleteSessionHandler.cs:44-47` opens the transaction, and
`OnDeletingAsync` at `:56-92` soft-deletes the assets in the same save, `:71-79`, and schedules their
blobs, `:81-89`), an event delete
(`.../Events/UseCases/Delete/DeleteEventHandler.cs:41-43` opens the transaction, assets loaded at
`:98-103`, blobs scheduled at `:111-113` before the save at `:115`, cascading through
`EventCascadeDeletionDomainService.CascadeDelete` which now takes the event's assets as a fifth
collection, `MMCA.ADC/Source/Modules/Conference/MMCA.ADC.Conference.Domain/Events/EventCascadeDeletionDomainService.cs:31-37`),
and an upload whose row could not be created or failed to commit after the bytes had already landed
(`UploadSessionAssetHandler.cs:114`, `:131`). The three delete paths schedule **inside** the delete's
transaction, before its save, so the internal-command row commits with the soft-delete or not at
all: the processor only sees it once the delete has committed, so a rolled-back delete never removes
a file its row still points at, and a scheduling failure fails the delete, which rolls back, rather
than committing it without the file's removal. There is no post-commit tail. Only the upload-orphan
path schedules outside a transaction, from `ScheduleOrphanCleanupAsync`
(`UploadSessionAssetHandler.cs:178-195`), and only it logs a blob that could not be scheduled as one
that must be removed by hand (`:200-204`).

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
(`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/Program.cs:207-226`), not global: every other route keeps
its default budget. The gateway's forwarding route itself is anonymous, as every gateway route is
(`MMCA.ADC/Source/Hosts/MMCA.ADC.Gateway/appsettings.json:219-223`).

**UI.** Speakers and organizers manage a session's materials through
`Conference.UI/Pages/SessionAssets/SessionAssetsPanel.razor`, hosted on both the speaker dashboard
and the organizer session detail page; attendees see them through
`SessionAssetsDownloadList.razor`, rendered on
`Conference.UI/Pages/Public/Sessions/PublicSessionDetail.razor` beneath the existing resource links.

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
one test suite, one place to fix a format quirk, and the extension cost is bounded: the sniffer and
`BlobNames` are dependency-free static classes, `FileUploadOptions` is a dependency-free sealed record
(`FileUploadOptions.cs:13`), and the `UploadAsync` overload is abstract, so every implementation must
declare it rather than inherit a default that silently dropped the headers (`IFileStorageService.cs:37`).

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
  exactly that residue and the template turns on-upload scanning on by default, capped at 50 GB a
  month; production read scanning off on 2026-10-01, so the deployed posture is format-checked but
  not malware-scanned until the deployed setting matches the template.
- **Blob cleanup is eventually consistent.** Every delete path commits the blob-removal row with the
  delete, but the processor runs it later, so between the commit and the queue's next tick the file
  is still fetchable by anyone holding its URL. A delete whose row cannot be scheduled fails and rolls
  back; only an upload-orphan blob that cannot be scheduled is logged as needing removal by hand,
  and there is no reconciler that walks the container looking for blobs with no row.
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

## Revision (2026-10-01)
Two parts of the decision changed and the rest of the record was re-anchored. The options-carrying
`IFileStorageService.UploadAsync` overload is no longer a default interface member: it is abstract
(`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Storage/IFileStorageService.cs:37`),
recorded as a breaking change in MMCA.Common v1.210.0 (`MMCA.Common/CHANGELOG.md:331-332`) because
the default implementation dropped the options, and `AzureBlobFileStorageService` now forwards its
three-argument overload to the options overload (`AzureBlobFileStorageService.cs:23-24`). The
Rationale sentence on the extension cost now says so, and describes `FileUploadOptions` as a sealed
record (`FileUploadOptions.cs:13`). On-upload malware scanning now defaults to on in the template
(`MMCA.ADC/infra/main.bicep:136`, resource `:1334-1350`, cap `:1342`), because the deploy identity's
Contributor role was verified to cover the settings write (`:1324-1333`); only the cost reason
remains and the cap bounds it. Production does not match the template: an `az rest` GET of the
storage account's `defenderForStorageSettings/current` (api-version 2022-12-01-preview) on 2026-10-01
returned `isEnabled=true` and `overrideSubscriptionLevelSettings=true` but
`malwareScanning.onUpload.isEnabled=false` with `capGBPerMonth=-1`; that read is the evidence for the
deployed state. The grants are now declared in the Shared project (`ConferencePermissionGrants.cs:47-48`)
and applied by both the Conference service and the Identity host. The "UI slice" note is removed
because both components are wired into three pages (`SpeakerDashboard.razor:223`,
`SessionDetail.razor:179`, `PublicSessionDetail.razor:114`). Every other citation was refreshed to
current line numbers.

## Revision (2026-10-06)
- Part 6 and the "Blob cleanup is eventually consistent" trade-off are corrected: all three delete
  paths now schedule `Conference.DeleteSessionAssetBlob.v1` inside the delete's transaction, before
  its save (`DeleteSessionAssetHandler.cs:63-76`, `DeleteSessionHandler.cs:44-47` and `:81-89`,
  `DeleteEventHandler.cs:41-43` and `:111-115`), and a scheduling failure fails and rolls back the
  delete. There is no post-commit tail; only the upload-orphan path schedules outside a transaction
  and logs an unscheduled blob for removal by hand (`UploadSessionAssetHandler.cs:178-204`).
- Anchors recorded in the 2026-10-01 revision that have since moved: the v1.210.0 breaking change is
  now at `MMCA.Common/CHANGELOG.md:672-673` (release heading `:610`), the scanning resource at
  `MMCA.ADC/infra/main.bicep:1361-1377` (cap `:1369`, Contributor comment `:1351-1360`), and the
  public download list at `PublicSessionDetail.razor:116`; that revision's "every other citation was
  refreshed" no longer holds for those anchors.
- Every live-section anchor was re-verified against current source this pass (permissions,
  Conference service registration, bicep container, grant and scanning resource, Gateway body-size
  raise, delete handlers).

## Revision (2026-10-07)
Re-verified against current source. The decision, the six parts, the limits and the trade-offs are
unchanged, and the template still enables on-upload scanning with the 50 GB cap while the recorded
production read (2026-10-01) is not re-checked here; only line numbers moved, and the 2026-10-06
statement that every live-section anchor had been re-verified no longer holds for the anchors below.

1. Anchors re-verified against current source: the Conference service registration
   `MMCA.ADC/Source/Services/MMCA.ADC.Conference.Service/Program.cs:359`; the public-read container
   `MMCA.ADC/infra/main.bicep:1328-1334` (name `:1330`, `publicAccess: 'Blob'` `:1332`), its
   container name injected at `:2029`; the account-scoped grant `:1362-1370` with its coverage
   comment at `:1355-1357`; the scanning resource `:1382-1398` (cap `:1390`, Contributor comment
   `:1372-1381`); the v1.210.0 breaking change at `MMCA.Common/CHANGELOG.md:697-698` (release
   heading `:635`); and the public download list at `PublicSessionDetail.razor:121`, after the
   `ResourceLinks` row at `:111-113`.

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
