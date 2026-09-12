# ADR-045: Managed File Storage and User Avatars

## Status
Accepted (2026-07-11). Records the BR-116 amendment (ADC): avatar photos are IN scope, powered
by two new framework extension points. The framework legs are implemented; each consumer provisions its
own storage account and wires the upload endpoints.
Revised 2026-09-07 (a decoded-pixel and dimension ceiling is checked from the image header before
any frame buffer is allocated, beside the existing compressed-size cap).
Revised 2026-09-12 (the extension points here carry DOCUMENT uploads as well as images; the
avatar-only scope statement below is superseded by
[ADR-123](123-speaker-session-assets.md)).
## Context
The MAUI capability program (ADR-042) brought MediaPicker/camera within reach, and ADC amended
BR-116 to include user avatar photos. That needs binary blob storage (the databases store
entities, not images), untrusted-image handling (uploads are attacker-controlled bytes; EXIF
metadata carries GPS coordinates, which are PII), and a client affordance that is native
pick/capture on phones and a plain file input on the web.

The framework had no file-storage abstraction: anything blob-shaped would otherwise be written
directly against the Azure SDK inside a module, unusable by the next consumer and untestable.

## Decision
- **`IFileStorageService`** (Application): upload-by-blob-name returning the public URI, plus
  idempotent delete. Default is an unconfigured Null implementation whose uploads fail with a
  clear error; `AddAzureBlobFileStorage(configuration)` swaps in the Azure Blob implementation
  when the `FileStorage` section is complete (`ContainerName` + either `ServiceUri` for
  DefaultAzureCredential/managed-identity auth, the production path, or `ConnectionString` for
  local Azurite). The container is provisioned by infrastructure, never created by the app.
- **`IImageProcessor`** (Application) with `ImageSharpImageProcessor` (Infrastructure, always
  registered - it has no external dependency): decode, auto-orient, center-crop to an exact
  square, strip ALL metadata, re-encode as JPEG. Full re-encode is the security boundary: only
  pixels survive, killing EXIF GPS and polyglot payloads in one move. Undecodable content is a
  validation failure, not an exception. ImageSharp ships under the Six Labors Split License
  (Apache 2.0 terms for open-source / small-revenue use, which covers this project).
- **`IMediaPickerService`** (UI capability, ADR-042 pattern): native photo pick/capture with the
  permission flow encapsulated; cancelled/denied returns null. Web heads keep the Null default
  (`IsSupported == false`) and render an `InputFile` instead - an affordance switch, not a
  degraded path.
- **Avatar contract (BR-116a, applied per consumer)**: one avatar per user; accept jpeg/png/webp
  up to 2 MB; server re-encodes to 256x256 JPEG via `IImageProcessor` (client-declared content
  types are advisory only); blob name `{userId}-{random8}.jpg` in the infrastructure-provisioned
  public-read `avatars` container (so the URL path reads `avatars/{userId}-{random8}.jpg`);
  upload deletes the previous blob; the URL lives on the user entity as `[Pii]`,
  nulled on anonymize with the blob deleted; exported in the GDPR data export.

## Consequences
- The avatars container is public-read by design: avatar URLs render in `<img>` tags on
  anonymous-visible surfaces without SAS plumbing. The random blob suffix prevents enumeration;
  the trade-off (anyone with the URL can fetch the image) is accepted and documented in the
  consumer's privacy policy.
- A replaced or deleted avatar deletes its blob, but CDN/browser caches may serve the old URL
  briefly; the random suffix means the new upload never reuses the old URL, so staleness is
  bounded by cache TTLs.
- `DefaultAzureCredential` in production means the storage account needs a data-plane role
  (Storage Blob Data Contributor) for the app identity - a bicep-level grant, not a secret.
- ImageSharp joins the Infrastructure dependency set (vuln-audited like everything else); the
  license note above must be revisited if the project's revenue posture changes.

## Revision (2026-09-07)
The 2 MB compressed upload cap bounds the bytes on the wire; it does not bound what those bytes
**decode** to. A highly compressible image declares its dimensions in a header that costs nothing to
read and expands to a frame buffer of width times height times bytes-per-pixel, which is how a small
upload becomes a multi-gigabyte allocation (SEC-Common-28).

`ImageSharpImageProcessor` now reads the header first with `Image.IdentifyAsync`
(`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Storage/ImageSharpImageProcessor.cs:47`) and
refuses anything past `MaxDecodedPixels` (50,000,000, `:26`) or `MaxDecodedDimension` (20,000, `:33`)
as `Image.TooLarge`, using the predicate at `:112-114`. The dimension ceiling exists beside the pixel
one because a long thin image can stay under the area limit and still be pathological for the
resampler (`:30`). The decoded frame is re-checked after decoding, so a header that under-reports
does not get through.

## Revision (2026-09-12)
This record scoped managed uploads to avatars and said so: "no other managed uploads exist". That
statement is superseded by [ADR-123](123-speaker-session-assets.md), which publishes speaker session
materials (decks, handouts, archives, links) through the same `IFileStorageService`. The framework
extension points here grew three pieces to carry it, and every one of them is document-shaped rather
than avatar-shaped:

- **`DocumentContentSniffer`**
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Storage/DocumentContentSniffer.cs:49`),
  the sibling of `ImageContentSniffer`. It accepts pdf, pptx, docx, xlsx, zip, txt and md, and only
  when the real bytes and the file-name extension agree (`Detect`, `:91`); the client-declared
  content type is never consulted. It exists because the avatar boundary does NOT transfer: an image
  is safe because it is re-encoded pixel by pixel, and a document is stored exactly as uploaded, so
  the defence has to be a gate at the door. Office Open XML is decided by opening the package and
  looking for a `[Content_Types].xml` entry BY NAME, never by reading an entry stream, with a
  4096-entry bail-out for zip bombs (`:153-188`).
- **`BlobNames.SanitizeFileName`**
  (`.../Storage/BlobNames.cs:33`), because a user-supplied file name reaches a blob name and
  therefore a URL. Avatars never needed it: their blob name is composed entirely of a user id and a
  random suffix.
- **`FileUploadOptions`** (`.../Storage/FileUploadOptions.cs:13`) with `Attachment` (`:48`) and
  `Inline` (`:59`), carrying the `Content-Disposition` and `Cache-Control` headers stored on the
  blob. The options-carrying `UploadAsync` overload is a **default interface member**
  (`.../Storage/IFileStorageService.cs:42-43`), so adding it broke no existing implementation;
  `AzureBlobFileStorageService` overrides it and writes both headers
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Storage/AzureBlobFileStorageService.cs:27`,
  `:38-43`).

The public-read container trade-off recorded above for avatars is taken again for documents, on the
same terms and for the same reason, with unguessability supplied by a server-minted GUID inside the
blob path instead of a random suffix. See ADR-123 for the aggregate, the authorization rule and the
per-consumer contract (ADC BR-116b).
