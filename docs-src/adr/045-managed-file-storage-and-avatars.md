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
Revised 2026-10-01 (avatar blob deletion is a durable internal command rather than an inline
storage call; see Revision below).
Revised 2026-10-21: the image processor registers only the JPEG, PNG, WebP and GIF decoders and
nulls the EXIF, XMP and IPTC profiles rather than all metadata, and five ImageSharp advisories
are accepted under a standing audit suppression (both superseded on 2026-10-25: the framework no
longer holds an image processor or those suppressions).
Revised 2026-10-24: the Azure Blob implementation moved to MMCA.Common.Azure and an S3-compatible implementation ships in MMCA.Common.Aws ([ADR-134](134-cloud-neutral-core-vendor-adapters.md)); see Revision (2026-10-24).
Revised 2026-10-25: a Google Cloud Storage implementation ships in MMCA.Common.Gcp, so three adapters read the shared `FileStorage` section, each keyed on its own field; see Revision (2026-10-25).
Revised 2026-10-25 (image processing): `IImageProcessor` and its SkiaSharp implementation are ADC's Identity module's, not framework types; MMCA.Common keeps `IFileStorageService` and the dependency-free upload guards, `ImageContentSniffer` among them; see Revision (2026-10-25, image processing moves to ADC).
## Context
The MAUI capability program (ADR-042) brought MediaPicker/camera within reach, and ADC amended
BR-116 to include user avatar photos. That needs binary blob storage (the databases store
entities, not images), untrusted-image handling (uploads are attacker-controlled bytes; EXIF
metadata carries GPS coordinates, which are PII), and a client affordance that is native
pick/capture on phones and a plain file input on the web.

The framework had no file-storage abstraction: anything blob-shaped would otherwise be written
directly against the Azure SDK inside a module, unusable by the next consumer and untestable.

## Decision
- **`IFileStorageService`** (Application,
  `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Storage/IFileStorageService.cs:15`):
  upload-by-blob-name returning the public URI, plus idempotent delete (`:47`). Default is an
  unconfigured Null implementation whose uploads fail with a clear error. Three adapters bind the
  same `FileStorage` section, each keyed on a field of its own, so a shared section switches on only
  the adapter whose key it carries:
  - `AddAzureBlobFileStorage(configuration)` (MMCA.Common.Azure) when `ContainerName`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/Storage/AzureBlobFileStorageSettings.cs:22`) is
    present with either `ServiceUri` for DefaultAzureCredential/managed-identity auth, the
    production path, or `ConnectionString` for local Azurite.
  - `AddS3FileStorage(configuration)` (MMCA.Common.Aws) when `Bucket`
    (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Storage/S3FileStorageSettings.cs:19`) is present
    (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsServiceCollectionExtensions.cs:58`), for Amazon
    S3, Cloudflare R2, MinIO and the GCS XML API.
  - `AddGoogleCloudStorage(configuration)` (MMCA.Common.Gcp,
    `MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GcpServiceCollectionExtensions.cs:48`) when `GcsBucket`
    (`.../MMCA.Common.Gcp/Storage/GcsFileStorageSettings.cs:18`) is present (`:56`), over
    Application Default Credentials with no HMAC keys (`:37-38`). A section carrying only the S3
    `Bucket` or the Azure `ContainerName` leaves it a no-op (`:38-40`). Its delete answers success
    for any HTTP 404 (`.../Storage/GcsFileStorageService.cs:83-87`); the filter does not tell a
    missing object from a missing bucket, so a delete against a missing bucket also reads as success.

  The container or bucket is provisioned by infrastructure, never created by the app (the GCS
  identity needs only object create and delete, `GcpServiceCollectionExtensions.cs:42-44`).
- **`IImageProcessor`** is ADC's, not the framework's: the interface is declared in the Identity
  application layer
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/IImageProcessor.cs:11`,
  `NormalizeToSquareJpegAsync` at `:18`) and implemented by `SkiaSharpImageProcessor`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Services/Users/SkiaSharpImageProcessor.cs:16`),
  registered as a singleton by `AddModuleIdentityInfrastructure`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/DependencyInjection.cs:22-24`).
  It reads the header and refuses an oversize image before any frame is allocated
  (`SkiaSharpImageProcessor.cs:81-90`); accepts JPEG, PNG, WebP and GIF only, checked first by magic
  bytes before any decoder parses the upload and then on the codec Skia picked (`:145-172`,
  `:301-302`, `:313-314`); decodes the first frame only (`:185-202`); applies the EXIF orientation
  before a centered cover crop to an exact square (`:224-229`); and encodes a quality-85 JPEG
  (`:46`, `:105`) from the fresh pixel buffer alone, which carries no color space and no metadata
  (`:103-104`), so EXIF GPS, XMP, IPTC, the ICC profile and any polyglot payload in the original
  file are discarded (`:11-14`). Full re-encode is the security boundary. Undecodable content,
  including any format outside the allowlist (Skia also decodes BMP, ICO, HEIF, AVIF and RAW,
  `:146-148`), is the `Image.Undecodable` validation failure (`:338`), not an exception. SkiaSharp
  is MIT-licensed and an ADC dependency (`MMCA.ADC/Directory.Packages.props:41-43`), not a framework
  one.
- **Dependency-free upload guards** (MMCA.Common): `ImageContentSniffer`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Storage/ImageContentSniffer.cs:9`),
  a magic-byte allowlist (`IsAllowedImage`, `:14`, over `IsJpeg`, `IsPng` and `IsWebP` at `:20`,
  `:26`, `:32`), stays in the framework beside `IFileStorageService` and takes no image library.
  ADC's avatar validator and handler call it
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/SetUserAvatar/SetUserAvatarCommandValidator.cs:35`,
  `.../SetUserAvatar/SetUserAvatarHandler.cs:63`), and so does Store's product-image validator
  (`MMCA.Store/Source/Modules/Catalog/MMCA.Store.Catalog.Application/Products/UseCases/UploadImage/UploadProductImageCommandValidator.cs:71`).
- **`IMediaPickerService`** (UI capability, ADR-042 pattern): native photo pick/capture with the
  permission flow encapsulated; cancelled/denied returns null. Web heads keep the Null default
  (`IsSupported == false`) and render an `InputFile` instead - an affordance switch, not a
  degraded path.
- **Avatar contract (BR-116a, applied per consumer)**: one avatar per user; accept jpeg/png/webp
  up to 2 MB; server re-encodes to 256x256 JPEG via `IImageProcessor` (client-declared content
  types are advisory only); blob name `{userId}-{random8}.jpg` in the infrastructure-provisioned
  public-read `avatars` container (so the URL path reads `avatars/{userId}-{random8}.jpg`);
  replacing, removing or erasing an avatar schedules a durable `DeleteAvatarBlobInternalCommand`
  ([ADR-114](114-internal-commands-durable-job-queue.md)) rather than deleting the blob inline; the
  URL lives on the user entity as `[Pii]`, nulled on anonymize with the blob delete scheduled in
  the same transaction; exported in the GDPR data export.

## Consequences
- The avatars container is public-read by design: avatar URLs render in `<img>` tags on
  anonymous-visible surfaces without SAS plumbing. The random blob suffix prevents enumeration;
  the trade-off (anyone with the URL can fetch the image) is accepted and documented in the
  consumer's privacy policy.
- A replaced or deleted avatar has its blob deleted eventually (at-least-once, through the
  internal-command processor, within its retry budget), and CDN/browser caches may serve the old URL briefly; the random suffix means the new upload never reuses the old URL, so staleness is
  bounded by cache TTLs.
- `DefaultAzureCredential` in production means the storage account needs a data-plane role
  (Storage Blob Data Contributor) for the app identity - a bicep-level grant, not a secret.
- Image decoding is an application dependency, not a framework one: `AddInfrastructure` registers
  no image processor and MMCA.Common.Infrastructure takes no image library
  (`MMCA.Common/CHANGELOG.md:17`), and the framework's accepted-advisory list is empty
  (`MMCA.Common/Directory.Build.props:33`). ADC confines SkiaSharp's native libraries to the
  projects that run it: `MMCA.ADC.Identity.Infrastructure` takes the managed assembly only
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/MMCA.ADC.Identity.Infrastructure.csproj:10`),
  and the native packages are referenced by the Identity host
  (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/MMCA.ADC.Identity.Service.csproj:22-29`) and
  the processor's tests
  (`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Infrastructure.Tests/MMCA.ADC.Identity.Infrastructure.Tests.csproj:12-14`).

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
  blob. The options-carrying `UploadAsync` overload shipped as a default interface member so
  adding it broke no existing implementation, and became **abstract** in v1.210.0
  (`.../Storage/IFileStorageService.cs:36`) once no implementation relied on the fallback;
  `AzureBlobFileStorageService` implements it and writes both headers
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Storage/AzureBlobFileStorageService.cs:27`,
  `:38-43`).

The public-read container trade-off recorded above for avatars is taken again for documents, on the
same terms and for the same reason, with unguessability supplied by a server-minted GUID inside the
blob path instead of a random suffix. See ADR-123 for the aggregate, the authorization rule and the
per-consumer contract (ADC BR-116b).

## Revision (2026-10-01)
Avatar blob deletion no longer happens as an inline storage call. Every path that retires an avatar
schedules a `DeleteAvatarBlobInternalCommand`
(`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteAvatarBlob/DeleteAvatarBlobInternalCommand.cs:17`,
named `Identity.DeleteAvatarBlob.v1` at `:16`) through the internal-command queue of
[ADR-114](114-internal-commands-durable-job-queue.md). Replacing an avatar schedules the previous
blob post-commit
(`.../Users/UseCases/SetUserAvatar/SetUserAvatarHandler.cs:156-160`), removing one does the same
(`.../Users/UseCases/RemoveUserAvatar/RemoveUserAvatarHandler.cs:74-76`), and deleting the user
schedules it inside the erasure transaction so the row commits or rolls back with the anonymized
aggregate (`.../Users/UseCases/DeleteUser/DeleteUserHandler.cs:61-71`). The reason is durability: a
best-effort call lost the instruction whenever storage was unreachable, while a queued row is
retried up to `InternalCommands:MaxAttempts` (default 5,
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Administration/InternalCommandsSettings.cs:39`)
and then dead-lettered for operator action
(`.../Persistence/InternalCommands/Processing/InternalCommandProcessor.cs:461-467`), so an outage longer
than the retry budget still needs a manual replay. Only the erasure path is fully transactional:
replace and remove schedule after `SaveChangesAsync` has committed
(`MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Crud/MutateEntityHandlerBase.cs:316-319`),
so a host death between commit and scheduling, or a failed schedule, leaves an orphaned blob that
is only logged for manual removal (`.../Users/UseCases/SetUserAvatar/SetUserAvatarHandler.cs:162-165`,
`.../Users/UseCases/RemoveUserAvatar/RemoveUserAvatarHandler.cs:78-81`). Deletion is therefore eventual
and at-least-once once scheduled, not synchronous; the Decision and Consequences bullets above are corrected to say so. The public-read
container, the random suffix and the cache-TTL bound on staleness are unchanged.

## Revision (2026-10-06)
No behavior changed; the dated sections above keep the anchors recorded on their dates, and the
load-bearing ones have moved to:

- Decoded-size guard: the `Image.IdentifyAsync` header read is now at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Storage/ImageSharpImageProcessor.cs:48`,
  `MaxDecodedPixels` (50,000,000) at `:27`, `MaxDecodedDimension` (20,000) at `:34` (the long-thin
  rationale is still at `:30`), and the `TooLargeToDecode` predicate at `:115`; the post-decode
  re-check is at `:70`.
- The abstract options-carrying `UploadAsync` is at
  `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Storage/IFileStorageService.cs:37`;
  `AzureBlobFileStorageService` implements it at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Storage/AzureBlobFileStorageService.cs:28` and
  writes `ContentDisposition` and `CacheControl` at `:42-43`.
- The `attempts_exhausted` dead-letter is at
  `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/InternalCommands/Processing/InternalCommandProcessor.cs:451-457`.
- The post-commit hook that replace and remove schedule from runs after `SaveChangesAsync` at
  `MMCA.Common/Source/Core/MMCA.Common.Application/UseCases/Crud/MutateEntityHandlerBase.cs:322-325`.

Anchors were re-verified against current source on this date.

## Revision (2026-10-21)
Re-verified against current source. The storage abstraction, the avatar contract, the decoded-size
guard and the durable blob deletion are unchanged; the image processor's decoder set, its metadata
handling and the ImageSharp audit posture are corrected in the Decision and Consequences above.

1. **Decoder allowlist.** `CreateDecoderOptions`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Storage/ImageSharpImageProcessor.cs:127-138`)
   builds a configuration holding only the JPEG, PNG, WebP and GIF modules (`:129-133`), so every
   other format ImageSharp ships, TIFF and BMP among them, fails as `UnknownImageFormatException`
   before any of its decoder code runs, and that exception becomes the `Image.Undecodable`
   validation failure (`:103-108`). The header read takes `maxFrames: uint.MaxValue` (`:52`); the
   decode takes `maxFrames: 1` (`:70`), so only the first frame of an animated file is decoded.
2. **Metadata handling.** After auto-orient and the square crop (`:84-90`) the processor nulls
   `ExifProfile`, `XmpProfile` and `IptcProfile` (`:92-94`) and re-encodes with
   `JpegEncoder { Quality = 85 }` (`:99`). Nothing in MMCA.Common source clears the ICC profile, and
   the ImageSharp 3.1.12 JPEG encoder writes the image's metadata profiles, ICC included
   (`JpegEncoderCore.WriteProfiles` and `WriteIccProfile`), so "strip ALL metadata" and "only pixels
   survive" overstated what the code does; the Decision now names the three profiles and scopes the
   polyglot claim to payloads outside the metadata profiles.
3. **Audit posture.** Five ImageSharp 3.1.12 advisories are accepted as `NuGetAuditSuppress`
   entries in `MMCA.Common/Directory.Build.props:48-52`, each with its reachability argument in the
   comment at `:33-46`: the two TIFF encoder advisories and the HistogramEqualization one are
   unreachable because nothing encodes TIFF or calls that processor, the BigTIFF decoder one
   because the TIFF decoder is not registered, and the ICC CLUT parsing one is recorded as reachable
   in principle through an avatar upload carrying an ICC profile and accepted as a bounded
   denial-of-service risk. The CI audit step re-applies the same list. Each consumer carries its
   own copy of the same five entries (`MMCA.ADC/Directory.Build.props:55-59`,
   `MMCA.Store/Directory.Build.props:55-59`, `MMCA.Helpdesk/Directory.Build.props:30-34`), so the
   audit posture is four lists that must change together.
4. Anchors re-verified against current source:
   - Decoded-size guard: the `Image.IdentifyAsync` header read is at
     `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Storage/ImageSharpImageProcessor.cs:52`,
     `MaxDecodedPixels` (50,000,000) at `:31`, `MaxDecodedDimension` (20,000) at `:38` with the
     long-thin rationale in its doc comment at `:33-37`, the header check at `:54`, the post-decode
     re-check at `:74`, and the `TooLargeToDecode` predicate at `:147-150`.
   - The erasure path schedules the blob delete inside the transaction at
     `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/UseCases/DeleteUser/DeleteUserHandler.cs:64-74`,
     through `ScheduleAvatarBlobDeletionAsync` (`:79-89`), and a failed schedule fails the erasure
     (`:88`).

## Revision (2026-10-24)
[ADR-134](134-cloud-neutral-core-vendor-adapters.md) moves the Azure Blob implementation out of the
core and adds a second, S3-compatible implementation. `IFileStorageService`, its Null default and the
`FileStorage` section are unchanged.

1. **Azure Blob moved to the adapter.** `AddAzureBlobFileStorage(configuration)` keeps its name and now
   lives in `MMCA.Common.Azure`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureServiceCollectionExtensions.cs:41`). It still
   registers only for a `ContainerName` plus an absolute `ServiceUri` or a `ConnectionString`
   (`:49`-`:59`), using `DefaultAzureCredential` with a `ServiceUri` (`:63`-`:65`).
   `AzureBlobFileStorageService` is at
   `MMCA.Common/Source/Hosting/MMCA.Common.Azure/Storage/AzureBlobFileStorageService.cs:15`, and
   `FileStorageSettings` is now `AzureBlobFileStorageSettings` (`Storage/AzureBlobFileStorageSettings.cs:10`).
2. **An S3-compatible implementation.** `AddS3FileStorage(configuration)`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/AwsServiceCollectionExtensions.cs:44`) registers
   `S3FileStorageService` (`MMCA.Common/Source/Hosting/MMCA.Common.Aws/Storage/S3FileStorageService.cs:21`)
   bound from the same `FileStorage` section (`Storage/S3StorageClientFactory.cs:14`) through
   `S3FileStorageSettings` (`Storage/S3FileStorageSettings.cs:13`), for Amazon S3, Cloudflare R2, MinIO
   and the GCS XML API (`MMCA.Common/CHANGELOG.md:12`). Request and response checksums default to
   `WHEN_REQUIRED` (`S3FileStorageSettings.cs:65`, `:72`). The `aws-integration` CI job exercises it
   against LocalStack (`MMCA.Common/.github/workflows/ci.yml:846`).
3. **A lost call fails the upload, not startup.** File storage has no startup tripwire: a
   `FileStorage` section is routinely shared configuration (one user-secrets id across every service
   of a solution), so its presence does not declare that a host stores files
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwire.cs:21-26`).
   A host that stores files and lost its adapter call fails each upload with
   `FileStorage.NotConfigured`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Storage/NullFileStorageService.cs:31-35`).
   v1.255.0 shipped a check on any non-blank `FileStorage` value; v1.256.0 removed it because it
   failed services that never store files (`MMCA.Common/CHANGELOG.md:11`).
4. The anchors into `MMCA.Common.Infrastructure/Storage/AzureBlobFileStorageService.cs` inside the
   2026-09-12 and 2026-10-06 revisions are left as recorded; that file now lives at the adapter path
   above.

## Revision (2026-10-25)
MMCA.Common v1.257.0 adds a third implementation, Google Cloud Storage in the new `MMCA.Common.Gcp`
adapter (`MMCA.Common/CHANGELOG.md:16-17`). `IFileStorageService`, its Null default and the shared
`FileStorage` section are unchanged; the Decision now lists the three adapters and the field each
keys on.

1. **Three keys in one section.** Azure reads `ContainerName`, S3 reads `Bucket` and Google reads
   `GcsBucket`, all from `FileStorage` (`SectionName` at
   `MMCA.Common/Source/Hosting/MMCA.Common.Azure/Storage/AzureBlobFileStorageSettings.cs:13`,
   `MMCA.Common/Source/Hosting/MMCA.Common.Aws/Storage/S3FileStorageSettings.cs:16` and
   `MMCA.Common/Source/Hosting/MMCA.Common.Gcp/Storage/GcsFileStorageSettings.cs:15`). The `Gcs`
   prefix keeps the shared section unambiguous (`MMCA.Common/CHANGELOG.md:17`).
2. **Google Cloud Storage.** `AddGoogleCloudStorage(configuration)`
   (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/GcpServiceCollectionExtensions.cs:48`) registers
   `GcsFileStorageService` (`MMCA.Common/Source/Hosting/MMCA.Common.Gcp/Storage/GcsFileStorageService.cs:22`)
   over Application Default Credentials, with optional `GcsPublicBaseUrl`, `GcsServiceUrl` and
   `GcsProjectId` (`GcpServiceCollectionExtensions.cs:34-37`). A `StorageClient` the host registered
   first is used as is (`:40-42`).
3. **Delete posture.** A 404 from Cloud Storage, including a missing bucket, reads as success
   (`GcsFileStorageService.cs:83-87`), matching the delete-if-exists contract of the Blob store.
4. **CI.** The `gcp-integration` job runs the adapter against fake-gcs-server and is not a required
   check (`MMCA.Common/CHANGELOG.md:23`).

## Revision (2026-10-25, image processing moves to ADC)
Image normalization left the framework in two releases on the same day, and ADC's Identity module,
its only caller, now owns it. `IFileStorageService`, the avatar contract, the decoded-size guard and
the durable blob deletion are unchanged; the Decision and Consequences above are corrected to the
current ownership.

1. **v1.258.0: SkiaSharp replaces ImageSharp.** `ImageSharpImageProcessor` was replaced by
   `SkiaSharpImageProcessor` with the same `IImageProcessor` behavior and the same
   `MaxDecodedPixels` / `MaxDecodedDimension` constants, and MMCA.Common.Infrastructure took
   `SkiaSharp` and `SkiaSharp.NativeAssets.Linux.NoDependencies` 4.153.1 in place of
   `SixLabors.ImageSharp` (`MMCA.Common/CHANGELOG.md:23`). The five ImageSharp 3.1.12 advisories
   accepted in 1.234.0 no longer applied, so their `NuGetAuditSuppress` entries went with it (`:23`),
   as did `DependencyVersionTestsBase.ImageSharp_MustNotExceed_MajorVersion3` and
   `ImageSharpPackageIds` (`MMCA.Common/UPGRADING.md:66-68`). The framework's accepted-advisory list
   now reads none (`MMCA.Common/Directory.Build.props:33`).
2. **v1.259.0: the processor leaves the framework.** `IImageProcessor` (MMCA.Common.Application) and
   `SkiaSharpImageProcessor` (MMCA.Common.Infrastructure) were removed, `AddInfrastructure` stopped
   registering an image processor, and MMCA.Common.Infrastructure dropped SkiaSharp
   (`MMCA.Common/CHANGELOG.md:17`, `MMCA.Common/UPGRADING.md:40-44`). The reason is cost:
   SkiaSharp's native libraries, about 490 MB per project (322 MB for the three Windows builds,
   149 MB for 13 Linux builds, 16 MB for macOS), were copied into every project that referenced
   MMCA.Common.Infrastructure, which ran consumer CI runners out of disk, while only one consumer use
   case ever called the processor (`MMCA.Common/CHANGELOG.md:17`). UPGRADING gives the mechanical
   fix for an application that resolves the interface: declare it in the module's application layer,
   copy the implementation and its tests into that module's infrastructure layer, reference
   `SkiaSharp` there with `ExcludeAssets="native"` and the native packages only from the host that
   processes images and from the processor's tests, and register it in the module
   (`MMCA.Common/UPGRADING.md:46-54`).
3. **ADC owns it.** The interface is at
   `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/IImageProcessor.cs:11`; the
   implementation is at
   `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Services/Users/SkiaSharpImageProcessor.cs:16`,
   keeping `MaxDecodedPixels` (50,000,000, `:27`), `MaxDecodedDimension` (20,000, `:35`) and the
   `TooLargeToDecode` predicate (`:323-327`). It is registered by `AddModuleIdentityInfrastructure`
   (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/DependencyInjection.cs:22-24`)
   and tested by `SkiaSharpImageProcessorTests`
   (`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Infrastructure.Tests/Services/Users/SkiaSharpImageProcessorTests.cs:14`).
   The infrastructure project references `SkiaSharp` with `ExcludeAssets="native"`
   (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/MMCA.ADC.Identity.Infrastructure.csproj:10`),
   and the native packages sit only in the Identity host
   (`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/MMCA.ADC.Identity.Service.csproj:28-29`) and
   the processor's tests
   (`MMCA.ADC/Tests/Modules/Identity/MMCA.ADC.Identity.Infrastructure.Tests/MMCA.ADC.Identity.Infrastructure.Tests.csproj:13-14`).
   The `Image.Undecodable` message, English and Spanish, lives in the Identity error resources
   (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.API/Resources/IdentityErrorResources.resx:22`,
   `IdentityErrorResources.es.resx:22`).
4. **`ImageContentSniffer` stays.** It is dependency-free and validates uploads in more than one
   consumer (`MMCA.Common/CHANGELOG.md:17`, `MMCA.Common/UPGRADING.md:56`), at
   `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Storage/ImageContentSniffer.cs:9`.
5. The anchors into `MMCA.Common.Infrastructure/Storage/ImageSharpImageProcessor.cs` inside the
   2026-09-07, 2026-10-06 and 2026-10-21 revisions, and the ImageSharp audit posture recorded on
   2026-10-21, are left as recorded; that file and those suppressions no longer exist in MMCA.Common.
