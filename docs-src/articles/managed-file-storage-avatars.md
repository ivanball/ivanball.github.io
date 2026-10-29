# Managed file storage: uploads you don't have to trust

> Series: MMCA.Common · Article #43 · Pillar P2/P4 · Group G07 · Rubric §8,§11,§30 · ADR-045 ·
> Status: grounded in `Website/docs-src/adr/045-managed-file-storage-and-avatars.md`,
> `IFileStorageService.cs`, `FileUploadOptions.cs`, `NullFileStorageService.cs`,
> `AzureBlobFileStorageService.cs`, `AzureBlobFileStorageSettings.cs`,
> `AzureServiceCollectionExtensions.cs`, `ImageContentSniffer.cs`, `IMediaPickerService.cs`,
> `DeleteBlobInternalCommandHandlerBase.cs` and Infrastructure `DependencyInjection.cs` in MMCA.Common;
> the Identity module's `IImageProcessor.cs`, `SkiaSharpImageProcessor.cs`, `DependencyInjection.cs`,
> `SetUserAvatarHandler.cs` and the SkiaSharp package references in MMCA.ADC.
> No em dashes.

**Subtitle:** A user uploads a profile photo. It is attacker-controlled bytes with GPS coordinates
baked into the metadata and, if you are unlucky, a payload hiding behind a valid image header. Here
is how MMCA.Common and the app that consumes it turn that upload into something you never have to trust.

---

An avatar upload looks like the most harmless feature in the app. A user picks a photo, you store it,
you render it back in an `<img>` tag. What could go wrong?

Three things, and all of them are quiet.

The file is attacker-controlled bytes. The client says it is a JPEG; the client says a lot of things.
The EXIF block on a phone photo carries the exact GPS coordinates where it was taken, which is PII you
did not ask for and are now storing and re-serving to anyone who loads the profile. And a "valid" image
can be a polyglot: bytes that a browser renders as a picture and something else on your box treats as a
script or an archive. You did not write a photo-sharing site. You wrote a place for a 256-pixel avatar,
and you inherited an untrusted-file-handling problem you never signed up for.

The reflex is to reach for the Azure SDK, write the blob straight from the controller, and move on. That
solves storage and nothing else: the metadata still ships, the bytes are still trusted, and the next
consumer who needs blob storage copies your controller code and inherits the same holes.

## Why it matters

An avatar is user-generated content on an anonymous-visible surface. That combination is exactly where
file-upload bugs turn into incidents. The two that bite hardest are not exotic:

- **Metadata leakage.** EXIF GPS coordinates are personal data. If you store the original file, you are
  storing where your users live and work, and re-serving it on every profile view. Under GDPR that is
  data you are now the controller of, silently.
- **Content-type confusion.** A `Content-Type: image/jpeg` header is a claim, not a fact. Accepting
  files by their declared type (or worse, their file extension) is how a "JPEG" that is really an HTML
  or SVG payload ends up served from your domain.

The threat model for an uploaded image is the same shape as the threat model for a password hash:
**assume the input is hostile, and make the stored form incapable of hurting you.** You are not trying to
keep the file secret. You are trying to guarantee that what you persist is a fresh encode of decoded
pixels, never the bytes the user sent.

## The MMCA answer: a storage boundary, and a re-encode that keeps only pixels

Without a blob abstraction, anything file-shaped gets written directly against the Azure SDK inside a
module, unusable by the next consumer and untestable. ADR-045 splits the job along the line between what
every app needs and what only an image-handling app needs. The framework ships the storage port and a
dependency-free magic-byte validator; the re-encode is the application's own processor. The port carries
more than avatars: ADR-045's avatar-only scope statement is superseded by ADR-123
(`045-managed-file-storage-and-avatars.md:11`, `:142-144`), which publishes speaker session materials
through the same `IFileStorageService`.

**`IFileStorageService`** (`IFileStorageService.cs:15`) is the storage boundary: `UploadAsync` takes a
blob name, a stream, and a content type and returns the public `Uri` as a `Result<Uri>` (`:26`). A second
overload adds a `FileUploadOptions` carrying the `Content-Disposition` and `Cache-Control` headers to
store with the blob (`:41`), and it is abstract, so every implementation provides it and honors those
headers. `DeleteAsync` (`:47`) is idempotent: unknown blob names succeed rather than throw (`:43`).
Callers pass only a blob name scoped within a container; the implementation owns the container, and the
container itself is provisioned by infrastructure, never created by the app.

The default implementation is deliberately inert. `NullFileStorageService`
(`NullFileStorageService.cs:14`) reports `IsConfigured => false` (`:17`), fails both upload overloads with
a clear `FileStorage.NotConfigured` error (`:34`), and lets deletes succeed (there is nothing to delete).
A host that never wires storage does not crash mysteriously; its upload endpoints degrade with an honest
message. A host that wants real storage calls a vendor adapter: `AddAzureBlobFileStorage(configuration)`
from MMCA.Common.Azure (`AzureServiceCollectionExtensions.cs:41`) swaps in `AzureBlobFileStorageService`
(`AzureBlobFileStorageService.cs:20`) when the `FileStorage` section is complete, and MMCA.Common.Aws and
MMCA.Common.Gcp offer S3 and Google Cloud Storage adapters over the same port
(`NullFileStorageService.cs:10-12`). The core references no cloud SDK; storage is one adapter call, the
same shape every vendor capability takes under ADR-134 ([cloud-neutral vendor
adapters](cloud-neutral-vendor-adapters.md)). Storage deliberately has no startup tripwire: a
`FileStorage` section is routinely shared configuration that a host storing no files sees too, so a host
that lost its adapter call is caught by the Null default instead, which fails every upload with
`FileStorage.NotConfigured` (`CloudAdapterTripwire.cs:22-26`).

That registration is defensive on purpose. An incomplete section is a no-op that leaves the Null default
in place (`AzureServiceCollectionExtensions.cs:49-52`, `:56-59`), so hosts register it
unconditionally. Production sets `ServiceUri` and authenticates with `DefaultAzureCredential` (`:64`);
local development can use a `ConnectionString` against Azurite instead (`:65`,
`AzureBlobFileStorageSettings.cs:16-19`). One detail earns its comment in the source: an empty-string
`ServiceUri` binds to a *relative* `Uri`, so the guard only accepts an absolute one
(`AzureServiceCollectionExtensions.cs:54-55`).

But storage is the boring half. The security boundary is the image processor, and the framework
deliberately does not ship one: its own registration comment says image normalization is the
application's concern, because decoding needs a native image library that every consumer of the
package would otherwise carry (`DependencyInjection.cs:356-360`).

### The re-encode is the boundary

In MMCA.ADC the processor belongs to the Identity module. `IImageProcessor`
(`MMCA.ADC.Identity.Application/Users/IImageProcessor.cs:11`) has one method,
`NormalizeToSquareJpegAsync` (`:18`), and its implementation `SkiaSharpImageProcessor`
(`MMCA.ADC.Identity.Infrastructure/Services/Users/SkiaSharpImageProcessor.cs:16`) does something that
looks like image resizing and is actually a security control. It buffers the upload under a byte
ceiling, admits only four formats, reads the header and refuses anything too big to decode, decodes only
the first frame, applies the EXIF orientation while it center-crops to an exact square, and encodes a
fresh JPEG from that pixel buffer alone:

```csharp
// SkiaSharpImageProcessor.NormalizeToSquareJpegAsync (MMCA.ADC Identity.Infrastructure).
// Excerpt: argument guards, cancellation checks and message arguments elided; trailing
// comments on the call lines added for this article.
using var data = await ReadBoundedAsync(content, cancellationToken).ConfigureAwait(false);
if (data is null)
{
    return TooLarge(...);   // more than MaxEncodedBytes buffered
}

using var codec = OpenAllowedCodec(data);   // magic bytes first, then the codec Skia picked
if (codec is null)
{
    return Undecodable();
}

// Header only: SKCodec.Create parses the format's header and allocates no frame, so a
// declared-oversize image is refused before the allocation it was built to provoke.
var width = codec.Info.Width;
var height = codec.Info.Height;
if (TooLargeToDecode(width, height))
{
    return TooLarge(...);
}

using var decoded = Decode(codec, width, height);   // frame 0 only, into exactly width x height
if (decoded is null)
{
    return Undecodable();
}

using var square = RenderCoverSquare(decoded, codec.EncodedOrigin, size);   // orient, then cover-crop
using var pixmap = square.PeekPixels();

// Encoded from the fresh pixel buffer alone: it carries no color space and no metadata, so
// nothing from the original file can be written back out.
using var jpeg = pixmap.Encode(new SKJpegEncoderOptions(JpegQuality, SKJpegEncoderDownsample.Downsample420, SKJpegEncoderAlphaOption.Ignore));
return jpeg is null ? Undecodable() : Result.Success(jpeg.ToArray());
```

The point is what does *not* survive. A full decode-then-re-encode means the original bytes never reach
the output. The square the encoder reads is a new bitmap allocated with no color space
(`SkiaSharpImageProcessor.cs:237`), drawn from the decoded pixels and encoded at quality 85 (`:46`,
`:105`), so EXIF (GPS included), XMP, IPTC and the ICC profile are all left behind (`:11-14`,
`:103-104`). A polyglot payload is gone because the bytes that carried it were never re-emitted: the
output is a new JPEG the encoder wrote from a bitmap. One operation kills both classes of problem, and it
does so by construction rather than by a blocklist you have to keep updating.

The byte ceiling and the header check in front of the decode are not size niceties. The upload is
buffered before decoding, and the read stops past `MaxEncodedBytes`, 32 MiB (`:43`, `:116-142`), so the
stream length cannot choose the allocation even if a caller forgets its own cap (`:37-42`). The avatar
contract's 2 MB cap bounds the *compressed* bytes, which a decompression bomb satisfies happily: a 2 MB
PNG can declare 40000x40000 and cost roughly 6 GB of frame buffer the moment it is decoded (`:23-24`).
So the processor bounds the decoded frame instead, with `MaxDecodedPixels` at 50,000,000 (`:27`) and
`MaxDecodedDimension` at 20,000 (`:35`); the edge ceiling sits beside the area one because a 1 x 200000
strip is inside the area limit and still pathological for the resampler (`:30-32`). `TooLargeToDecode`
(`:323-328`) applies both, and refuses a non-positive dimension, to the header `SKCodec.Create` parsed
without allocating a frame (`:81-90`). The decode then writes into a buffer of exactly those checked
dimensions (`:199`), so no format can understate its header and decode into more memory than was
checked (`:83-84`). Past either ceiling the upload is `Error.Validation("Image.TooLarge", ...)`
(`:330-334`): a clean 400 rather than the OutOfMemoryException the upload was built to provoke.

The frame count is bounded as well as the frame size. `Decode` asks the codec for frame 0 only
(`new SKCodecOptions(0)`, `:202`): the output is a single JPEG, and decoding every frame of an animated
GIF or WebP is how a small upload becomes hundreds of megabytes of pixel buffers (`:185-187`). Anything
short of a complete decode, a truncated scan included, is refused rather than stored half blank
(`:192-195`, `:201-206`).

The set of formats is bounded too, and checked twice. Skia also decodes BMP, ICO, WBMP, HEIF, AVIF and
RAW, and `SKCodec.Create` dispatches on the leading bytes, so `OpenAllowedCodec` (`:156-182`) runs the
magic-byte check *before* Skia sees the content (`:145-149`, `:158`): the framework's
`ImageContentSniffer` plus a GIF signature (`:301-308`). It then requires the decoder Skia actually
picked to be JPEG, PNG, WebP or GIF (`:169`, `:313-314`). No decoder outside those four ever parses an
upload. That matters because a library's attack surface is every decoder it can reach, not only the
formats you meant to accept.

Undecodable content is a validation failure too, not an exception: a disallowed signature, a header Skia
cannot parse, an incomplete decode or a failed encode all return
`Error.Validation("Image.Undecodable", ...)` (`:336-340`), so a garbage upload is a clean 400, not a 500.
The Identity module registers the processor unconditionally, as a stateless singleton, in
`AddModuleIdentityInfrastructure` (`MMCA.ADC.Identity.Infrastructure/DependencyInjection.cs:22-24`).
Unlike storage there is no Null image processor, because there is no safe way to skip the re-encode.

Ahead of the processor sits the framework's `ImageContentSniffer` (`ImageContentSniffer.cs:9`), a
static, dependency-free magic-byte check. `IsAllowedImage` (`:14`) accepts a payload only when its
leading bytes match a JPEG, PNG, or WebP signature: the JPEG SOI prefix `FF D8 FF` (`:21`), the 8-byte
PNG signature (`:27`), or a RIFF container declaring the `WEBP` form type (`:34-35`). The accepted
formats are decided by the actual bytes, never the client-declared content type or the file extension.
ADC's avatar validator and handler both gate on it (`SetUserAvatarCommandValidator.cs:35`,
`SetUserAvatarHandler.cs:63`), and MMCA.Store's product image validator uses it the same way
(`UploadProductImageCommandValidator.cs:71`) without decoding anything. It narrows the input; the
re-encode neutralizes what gets through. Defense in depth, cheaply.

### The avatar contract

Storage and the sniffer are framework legs; the re-encode is the app's. The avatar itself is a contract
(BR-116a) each consumer applies: one avatar per user; accept jpeg/png/webp up to 2 MB; the server
re-encodes to a 256x256 JPEG (`SetUserAvatarHandler.cs:37`) through its own image processor, treating
client-declared content types as advisory only. The blob name is
`{userId}-{random8}.jpg` in the public-read `avatars` container, so the URL path reads
`avatars/{userId}-{random8}.jpg`. Replacing, removing or erasing an avatar schedules a durable
`DeleteAvatarBlobInternalCommand` (ADR-114) rather than deleting the blob inline. The URL lives on the
user entity as `[Pii]`: nulled on anonymize with the blob delete scheduled in the same transaction, and
included in the GDPR data export (`045-managed-file-storage-and-avatars.md:97-104`). That last part is why
this article carries a §30 (data privacy) tie alongside the §8 (data access) and §11 (security) ones: the
avatar is treated as personal data from the moment it lands to the moment it is erased.

### One capability, two client affordances

On the client, the pick-a-photo gesture differs by host, and ADR-045 reuses the capability pattern from
ADR-042. `IMediaPickerService` (`IMediaPickerService.cs:9`) exposes native photo pick and camera capture
with the permission flow encapsulated; a cancelled or denied picker returns `null` rather than throwing.
Web heads keep the Null default (`NullMediaPickerService.cs:7`, `IsSupported => false`) and render a plain
`InputFile` instead. The comment in the port says it plainly: this is an affordance switch, not a degraded
path (`IMediaPickerService.cs:6-7`). The same upload endpoint serves a phone's native picker and a
browser's file input; only the gesture in front of it changes.

## Trade-offs, honestly

ADR-045 owns most of its rough edges in its Consequences section, the build files record the rest, and
they are real design choices rather than oversights.

- **The avatars container is public-read by design.** Avatar URLs render in `<img>` tags on
  anonymous-visible surfaces without SAS-token plumbing on every request. The cost is that anyone with the
  URL can fetch the image. The random 8-character blob suffix prevents enumeration (you cannot walk from
  one avatar to the next), and the trade-off is accepted and documented in the consumer's privacy policy.
  This is a deliberate acceptance, not a gap.
- **CDN and browser caches can serve a stale avatar briefly.** After a replace or a delete, a cache may
  hold the old URL for a moment. Because the random suffix means a new upload never reuses the old URL,
  staleness is bounded by cache TTLs and self-heals; there is no cache-busting dance to get right.
- **Avatar blob deletion is eventual, not synchronous.** A replaced or deleted avatar has its blob
  deleted at least once, through the internal-command processor and within its retry budget
  (`045-managed-file-storage-and-avatars.md:111-113`). Only erasure schedules inside its own transaction;
  replace and remove schedule after the save commits, so a host death in between, or a failed schedule,
  leaves an orphaned blob that is only logged for manual removal (`:191-196`,
  `SetUserAvatarHandler.cs:162-165`).
- **`DefaultAzureCredential` needs a data-plane role, not a secret.** In production the storage account
  requires a `Storage Blob Data Contributor` grant for the app identity. That is a bicep-level infrastructure
  grant, which is the correct place for it, but it does mean the app will not authenticate until the role
  assignment exists. It is not a connection string you can paste in.
- **An app that normalizes images owns its processor and a native image library.** The framework ships
  no decoder, so a consumer that accepts images writes (or copies) its own processor, and it takes on the
  library behind it. ADC uses SkiaSharp 4.153.1 under MIT, three packages bumped together
  (`MMCA.ADC/Directory.Packages.props:36-43`), whose native libraries come to roughly 490 MB across
  platforms (`:36-40`). Containing them is a build-file discipline rather than a default: the Identity
  Infrastructure project references SkiaSharp with `ExcludeAssets="native"`, so the natives never flow
  to the projects that reference it (`MMCA.ADC.Identity.Infrastructure.csproj:7-10`); only the Identity
  service host (`MMCA.ADC.Identity.Service.csproj:22-29`) and the processor's own tests
  (`MMCA.ADC.Identity.Infrastructure.Tests.csproj:12-14`) reference the native packages. The host keeps
  them without `PrivateAssets`, because that would drop them from its own ReadyToRun publish and the
  image would fail on the first upload (`MMCA.ADC.Identity.Service.csproj:24-27`), so a project that
  references the host, such as the service startup tests, excludes the natives on its own side
  (`MMCA.ADC.Services.Tests.csproj:28-32`). The payoff is on the other side of the line: every app that
  never decodes an image carries no image library at all, and MMCA.Common accepts no NuGet advisories
  today (`MMCA.Common/Directory.Build.props:33`).

Be precise about status: the framework legs are implemented and shipped in MMCA.Common, and two MMCA.ADC
services wire them end to end. The Identity service calls `AddAzureBlobFileStorage(builder.Configuration)`
at startup for avatars (`MMCA.ADC.Identity.Service/Program.cs:261`) and the Conference service calls it for
speaker session assets (`MMCA.ADC.Conference.Service/Program.cs:367`). On the Identity side,
`SetUserAvatarHandler` normalizes through the module's own processor (`SetUserAvatarHandler.cs:29`,
`:103`) and is the only request-path handler that calls `IFileStorageService`, for the upload
itself (`SetUserAvatarHandler.cs:117`). Every avatar blob delete is a durable
`DeleteAvatarBlobInternalCommand` scheduled through `IInternalCommandScheduler`: the replaced blob once
the new URL is saved (`SetUserAvatarHandler.cs:158-160`), the freshly uploaded blob when the save fails
and leaves no row pointing at it (`:78-88`, `:187`), a removed avatar
(`RemoveUserAvatarHandler.cs:20,75`) and an erased user (`DeleteUserHandler.cs:35,84`). The deletion
runs in `DeleteAvatarBlobInternalCommandHandler` (`DeleteAvatarBlobInternalCommandHandler.cs:17-23`),
which only names the blob kind for its log lines and inherits the work from Common's
`DeleteBlobInternalCommandHandlerBase` (`DeleteBlobInternalCommandHandlerBase.cs:28`): the port call
(`:45`), with a `NotFound` answer completing the row as success (`:53-57`) so at-least-once execution
stays idempotent. The `Profile` page uploads through `IMediaPickerService` (`Profile.razor.cs:22`). Each
consumer still provisions its own storage account and wires its own upload endpoints against these ports,
so this is a capability the framework provides rather than one that is live in every downstream app by
default: MMCA.Store has not adopted the storage port.

## Apply this even without MMCA

The pattern ports to any stack and any blob store. The rules are short:

1. **Never trust the declared content type or the file extension.** Sniff the leading magic bytes and accept
   only the formats you actually support. When your image library can decode more than that, sniff
   before it sees the bytes and check which decoder it picked.
2. **Re-encode every uploaded image; do not store the original.** A full decode-then-re-encode is the single
   move that strips EXIF GPS (PII) and defeats polyglot payloads, because the original bytes never reach
   the output. Encode from a fresh pixel buffer, so no metadata profile (ICC included) rides along, and
   check what your encoder writes. Resize to the size you will actually serve while you are at it.
3. **Apply the EXIF orientation before you crop**, or portrait phone photos come out sideways once the
   orientation tag is gone.
4. **Bound the decoded frame, not just the uploaded bytes.** Cap the bytes you buffer, read the header,
   refuse the declared dimensions that would not fit in memory, decode only the one frame you keep, and
   decode into a buffer of exactly the size you checked.
5. **Put storage behind a port with an inert default.** An unconfigured implementation that fails uploads
   with a clear message beats a host that half-works or crashes at first use.
6. **Keep a native image library where it is used.** Reference its natives from the host that decodes and
   the tests that exercise it, and exclude them everywhere else.
7. **Treat the stored URL as PII.** If it points at a user's face, it belongs in your erasure path and your
   data export, not just your database.
8. **Prefer managed identity over secrets** for the store, and let infrastructure provision the container and
   its access level. The app should never create the bucket it writes to.

The takeaway: **an upload is hostile bytes until you have re-encoded it into something that can only be a
picture.** Storage is the easy half; the re-encode is the boundary that matters.

---

**What we covered:** why an avatar upload is an untrusted-file problem in disguise (EXIF GPS as PII,
content-type confusion, polyglot payloads); how `IFileStorageService` gives an upload-by-blob-name boundary
with an inert `NullFileStorageService` default that fails clearly and an `AddAzureBlobFileStorage` swap to the
real Azure implementation; how the real security boundary is the full re-encode in the app's own
processor, ADC's `SkiaSharpImageProcessor` (bounded read, four-format allowlist checked by magic bytes and
by codec, header size check, single-frame decode, EXIF orientation, center-crop, a fresh JPEG from pixels
only) fronted by the framework's `ImageContentSniffer`; the avatar contract (256x256 JPEG, 2 MB,
random-suffixed public-read blob, URL as `[Pii]`, blob deletes as durable internal commands); and the
honest trade-offs (public-read container, cache staleness, eventual blob deletion, a data-plane role
grant, and an app-owned processor whose native image library stays out of every other project).

**Next in the series:** HTTP API versioning, proven not just claimed, one header-based policy adopted by every service and kept honest by a shared fitness contract that runs two live versions.

*MMCA.Common is open source. Star the repo, read the 2-minute ADR behind this pattern, or
`dotnet add package MMCA.Common.Infrastructure` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 The decision record is `Website/docs-src/adr/045-managed-file-storage-and-avatars.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, Security, Cloud*

*Notes (refreshed 2026-10-29 against MMCA.Common v1.265.1, `MMCA.Common/FACTS.md:14`): anchors only, no*
*behavior change in the storage port, the Null default or the avatar flow. Re-anchored this run:*
*`AzureBlobFileStorageService` class `:15` -> `:20` (class doc grew to `:10-19` with the transport-failure*
*paragraph: the adapters answer a transport failure as a `FileStorage.UploadFailed` Result, `:14-17`,*
*`:60`, `:68`); Infrastructure `DependencyInjection.cs` storage comment `:355-360` -> `:356-360` and the*
*Null `TryAddTransient` `:360` -> `:361`; Identity `Program.cs:260` -> `:261` (comment `:259-260`;*
*Conference `:367` holds); `DeleteUserHandler.cs:34,83` -> `:35,84` (class `:33`, `IUnitOfWork` `:34`,*
*scheduler `:35`, `ScheduleAvatarBlobDeletionAsync` `:81`, `ScheduleAsync(new DeleteAvatarBlobInternalCommand`*
*`:84`). ADR-045 anchors against its 2026-10-28 revision (Status `:21-22`): ADR-123 supersede `:11` and*
*`:133-134` -> `:142-144`, BR-116a contract `:87-94` -> `:97-104`, eventual deletion `:100-102` ->*
*`:111-113`, post-commit orphan `:184-186` -> `:191-196`; `SetUserAvatarHandler.cs:162-165` holds. Body*
*addition: one pointer to `cloud-neutral-vendor-adapters.md` (ADR-134) beside the adapter call, and the*
*fact that file storage has no startup tripwire (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Configuration/CloudAdapterTripwire.cs:22-26`,*
*restated at `DependencyInjection.cs:220`), so a missing adapter call shows as `FileStorage.NotConfigured`*
*(`NullFileStorageService.cs:34`). Every other body anchor was re-checked by the 2026-10-29 audit and holds.*

*Notes (refreshed 2026-10-25 against MMCA.Common main v1.260.0 and MMCA.ADC main after #293; HISTORY: the*
*anchors this block shares with the 2026-10-29 entry above are superseded there): image*
*normalization is no longer a framework capability. Common v1.258.0 (#603) moved the processor from*
*SixLabors.ImageSharp to SkiaSharp, and v1.259.0 (#608) removed `IImageProcessor` and the SkiaSharp*
*processor from MMCA.Common (CHANGELOG and facts file, not re-read here); re-confirmed this run: no*
*`ImageSharp`, `SkiaSharp` or `IImageProcessor` in any `.cs`, `.csproj` or `.props` under*
*`MMCA.Common/Source` or the root props, except a stale ImageSharp comment left in*
*`MMCA.Common/Directory.Packages.props:144-150` above the storage packages; Common's*
*`Directory.Build.props:33` says no NuGet advisories are accepted; the core registration comment at*
*`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:355-360` names image*
*normalization the application's concern and registers only the Null storage default at :360. Body*
*changes: the "re-encode is the boundary" section, its code block (now an annotated excerpt of*
*`SkiaSharpImageProcessor.NormalizeToSquareJpegAsync`, :68-106) and the sniffer paragraph describe ADC's*
*processor; the ICC trade-off bullet is gone because the SkiaSharp encode carries no color space or*
*metadata (`SkiaSharpImageProcessor.cs:11-14`, :103-105, bitmap allocated without a color space at :237;*
*stated in source comments, not separately proven by a test read this run); the ImageSharp license, v3*
*pin and five-advisory bullets are replaced by the native-asset bullet; the Apply list gains rule 6 and*
*rewords rules 1 to 4. Storage anchors also moved with the 2026-10-24 adapter split (ADR-045 status*
*:17-18): `AddAzureBlobFileStorage` is now `MMCA.Common/Source/Hosting/MMCA.Common.Azure/AzureServiceCollectionExtensions.cs:41`*
*(ContainerName guard :49-52, absolute-`ServiceUri` comment :54 and check :55, neither-credential guard*
*:56-59, `DefaultAzureCredential` :64, `ConnectionString` :65, `AzureBlobFileStorageService` registered*
*:68), settings renamed `AzureBlobFileStorageSettings` (`.../MMCA.Common.Azure/Storage/AzureBlobFileStorageSettings.cs`,*
*`SectionName` :13, `ServiceUri` :16, `ConnectionString` :19, `ContainerName` :22),*
*`AzureBlobFileStorageService.cs:15` under `MMCA.Common.Azure/Storage/`; `IFileStorageService.cs:15`*
*(`IsConfigured` :18, `UploadAsync` :26, options overload :41, idempotent doc :43, `DeleteAsync` :47);*
*`NullFileStorageService.cs:14` (adapter list in doc :10-12, `IsConfigured` :17, `DeleteAsync` :29,*
*`FileStorage.NotConfigured` :34); `ImageContentSniffer.cs:9` (`IsAllowedImage` :14, JPEG :21, PNG :27,*
*RIFF/WEBP :34-35). ADC processor (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Services/Users/SkiaSharpImageProcessor.cs`):*
*class :16, `MaxDecodedPixels` :27 (rationale :23-24), `MaxDecodedDimension` :35 (strip :30-32),*
*`MaxEncodedBytes` 32 MiB :43 (rationale :37-42), `JpegQuality = 85` :46, header-only codec :81-90,*
*`ReadBoundedAsync` :116-142, `OpenAllowedCodec` :156-182 (sniff-first rationale :145-149, sniff :158,*
*codec format check :169), `Decode` frame 0 :197-211 (`SKCodecOptions(0)` :202, rationale :185-187,*
*incomplete decode refused :192-195), `RenderCoverSquare` :229-256 (orientation before crop :224-227,*
*fresh bitmap :237, white flatten :240-241), `HasAllowedSignature` :301-302, GIF :307-308,*
*`IsAllowedFormat` :313-314, `TooLargeToDecode` :323-328, `Image.TooLarge` :330-334,*
*`Image.Undecodable` :336-340. `IImageProcessor` at*
*`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/IImageProcessor.cs:11` (method*
*:18; its summary still says "strips ALL metadata ... only pixels survive", which the implementation*
*now matches); registration `TryAddSingleton<IImageProcessor, SkiaSharpImageProcessor>()` at*
*`MMCA.ADC.Identity.Infrastructure/DependencyInjection.cs:24` (method :22). Native containment:*
*`MMCA.ADC/Directory.Packages.props:36-43` (comment :36-40, SkiaSharp 4.153.1 :41, Linux and Win32*
*natives :42-43); `ExcludeAssets="native"` at `MMCA.ADC.Identity.Infrastructure.csproj:10` (comment*
*:7-9); natives in `MMCA.ADC.Identity.Service.csproj:28-29` (comment :22-27) and*
*`MMCA.ADC.Identity.Infrastructure.Tests.csproj:13-14` (comment :12); excluded on the referencing side in*
*`Tests/Services/MMCA.ADC.Services.Tests/MMCA.ADC.Services.Tests.csproj:31-32` (comment :28-30, which*
*says ~470 MB where `Directory.Packages.props:37` says ~490 MB; the body uses the latter). Consumers:*
*`SetUserAvatarHandler.cs` injects `IImageProcessor` :29 and `IFileStorageService` :30, `AvatarSize = 256`*
*:37, sniffer gate :63, normalize :103, upload :117, `OnMutatedAsync` scheduling :158-160 with failed-schedule*
*log :162-165, orphan cleanup :78-88 and :187 (all re-read); `SetUserAvatarCommandValidator.cs:35`;*
*Identity `Program.cs:260` and Conference `Program.cs:367` for `AddAzureBlobFileStorage`; MMCA.Store's*
*`UploadProductImageCommandValidator.cs:71` sniffs, and no `IFileStorageService`, `AddAzureBlobFileStorage`,*
*`IMediaPickerService`, ImageSharp or SkiaSharp reference exists in any `.cs`, `.razor` or `.csproj` under*
*`MMCA.Store/Source` (re-searched). ADR-045 anchors re-taken against its 2026-10-25 refresh: ADR-123*
*supersede :11 and :133-134, BR-116a contract :87-94, eventual deletion :100-102, post-commit orphan*
*:184-186. ADR-045's Decision now places the processor in ADC; only its earlier Revision sections still*
*describe `ImageSharpImageProcessor` and the five suppressions, as history. Carried forward without a re-read this run:*
*`RemoveUserAvatarHandler.cs:20,75`, `DeleteUserHandler.cs:34,83`,*
*`DeleteAvatarBlobInternalCommandHandler.cs:17-23`, `DeleteBlobInternalCommandHandlerBase.cs:28`, :45,*
*:53-57, `Profile.razor.cs:22`, `IMediaPickerService.cs`, `NullMediaPickerService.cs` and*
*`FileUploadOptions.cs` anchors.*

*Notes (re-verified 2026-10-22 against MMCA.Common v1.250.0; HISTORY: the ImageSharp, `DependencyInjection.Notifications.cs`,*
*`FileStorageSettings.cs` and suppression anchors below describe the design before the 2026-10-25 entry above): every anchor below was re-read from source*
*this run. 2026-10-22 changes, all now in the body: ADR-045's 2026-10-21 revision (`:167-205`) records*
*that the processor nulls only the EXIF, XMP and IPTC profiles and that the ICC profile is not cleared*
*(`ImageSharpImageProcessor.cs:15-20` class doc; ADR Decision `:34-43`, ICC sentence `:39-41`), so the*
*body no longer says "strips every metadata profile", "only pixels survive" or "what is stored is only*
*pixels": it names the three profiles, scopes the polyglot claim to payloads outside the metadata*
*profiles, adds an ICC trade-off bullet, and adds that each consumer carries its own copy of the five*
*suppressions (`MMCA.ADC/Directory.Build.props:55-59`; ADR-045 `:193-195`). The "before this" framing of*
*the missing blob abstraction is restated in the present tense. Every `ImageSharpImageProcessor` anchor*
*moved +2 (two class-doc lines), `AddAzureBlobFileStorage` anchors +3, the `IImageProcessor` registration*
*to `DependencyInjection.cs:342`, the ImageSharp pin to `Directory.Packages.props:135-147`, ADC Identity to*
*`Program.cs:254`, and `DeleteUserHandler` to `:34`/`:83`; behavior of the guards, credential branches,*
*ceilings, decoder allowlist and re-encode is unchanged. Earlier passes (2026-10-08, 2026-10-02,*
*2026-09-19) recorded the `CreateDecoderOptions` four-format allowlist, the five ImageSharp 3.1.12*
*suppressions, the abstract options-carrying `UploadAsync` overload, the single-frame decode, the*
*`DependencyInjection.Notifications.cs` partial, durable avatar blob deletion (ADR-045 2026-10-01*
*revision), and the move of the blob delete work into Common's `DeleteBlobInternalCommandHandlerBase`.*
*Storage port: `IFileStorageService` in `MMCA.Common.Application` (namespace*
*`MMCA.Common.Application.Interfaces.Infrastructure.Storage`, `IFileStorageService.cs:11`): `IsConfigured` at*
*:14, three-argument `UploadAsync` returning `Result<Uri>` at :22, the `FileUploadOptions` overload abstract at*
*:37 (summary :24-29, `SuppressMessage` RS0026 at :36), `DeleteAsync` at :43 with "unknown names succeed*
*(idempotent)" in its doc at :39. `FileUploadOptions` (`FileUploadOptions.cs:13`): `None` at :21,*
*`ContentDisposition` at :28, `CacheControl` at :34. Inert default `NullFileStorageService`*
*(`NullFileStorageService.cs:11`): `IsConfigured => false` at :14, both upload overloads at :17-18 and :22-23*
*forwarding to the private `NotConfigured()` helper at :29-33 whose code is `"FileStorage.NotConfigured"` at*
*:31, delete succeeds at :26-27. Real adapter `AzureBlobFileStorageService` (`AzureBlobFileStorageService.cs:15`):*
*`IsConfigured => true` at :20, the three-argument overload delegating with `FileUploadOptions.None` at :24,*
*upload via `BlobContainerClient.GetBlobClient` at :34 writing `ContentDisposition`/`CacheControl` at :42-43*
*and returning `blobClient.Uri` at :48, `DeleteBlobIfExistsAsync` at :65, container provisioned by*
*infrastructure per class doc :10-14. Registration `AddAzureBlobFileStorage` at*
*`DependencyInjection.Notifications.cs:117`; the two incomplete-section no-op guards return at :123-126*
*(missing `ContainerName`) and :130-133 (neither `ServiceUri` nor `ConnectionString`); absolute-`ServiceUri`*
*comment at :128 and check at :129; `DefaultAzureCredential` production branch at :138; `ConnectionString`*
*branch at :139; `AzureBlobFileStorageService` registered at :142. In `DependencyInjection.cs`: Null default*
*`TryAddTransient` at :341 and `IImageProcessor` always-real `TryAddSingleton` at :342. Settings*
*`FileStorageSettings` (`FileStorageSettings.cs:10`): `SectionName = "FileStorage"` at :13, `ServiceUri` at*
*:16, `ConnectionString` at :19, `ContainerName` at :22.*
*Image boundary: `IImageProcessor` (`IImageProcessor.cs:11`), single `NormalizeToSquareJpegAsync` at :18;*
*`ImageSharpImageProcessor` (`ImageSharpImageProcessor.cs:22`, class doc :15-21 with "The ICC color profile*
*is not cleared" at :19-20): `MaxDecodedPixels = 50_000_000L` at :33 and `MaxDecodedDimension = 20_000` at*
*:40 (SEC-Common-28, rationale at :24-32 and :35-39, the 40000x40000 ~6 GB example at :29-30, the*
*1 x 200000 strip at :36-38), header-only*
*`Image.IdentifyAsync(CreateDecoderOptions(maxFrames: uint.MaxValue), ...)` at :54 ->*
*`Error.Validation("Image.TooLarge", ...)` at :56-62 (code :59), single-frame*
*`Image.LoadAsync(CreateDecoderOptions(maxFrames: 1), ...)` at :72 (rationale :69-71), decoded-frame re-check*
*at :74-82, `AutoOrient()` + `ResizeMode.Crop` to `Size(size, size)` at :86-92, metadata nulled*
*(Exif/Xmp/Iptc) at :94-96, `JpegEncoder { Quality = 85 }` at :101, undecodable caught*
*(`UnknownImageFormatException`/`InvalidImageContentException`, :105) -> `Error.Validation("Image.Undecodable", ...)`*
*at :105-110 (code :108), `CreateDecoderOptions` at :129-140 (doc :114-128, unregistered-format statement*
*:115-120; four configuration modules :131-135, current default memory allocator :137, `MaxFrames` :139),*
*`TooLargeToDecode` predicate at :149-152. Magic-byte validator `ImageContentSniffer` (static,*
*`ImageContentSniffer.cs:10`): `IsAllowedImage` at :15, JPEG `FF D8 FF` at :21-22, 8-byte PNG signature at*
*:27-28, RIFF/`WEBP` at :33-36.*
*ImageSharp pin and audit: `Directory.Packages.props:135-141` (license comment, v3 pin, dependabot holds*
*3.1.x) and :144-146 (HELD at 3.1.12, excluded from sweeps), `SixLabors.ImageSharp` 3.1.12 at :147, enforced*
*by `DependencyVersionTestsBase.ImageSharp_MustNotExceed_MajorVersion3` (`DependencyVersionTestsBase.cs:49`);*
*five suppressions in `MMCA.Common/Directory.Build.props:33-52` (GHSA-j9gm-c75j-xc9q, GHSA-jjfr-hcj7-qf5w,*
*GHSA-wmxv-xphr-5c9g, GHSA-j3p4-wp97-rph4, GHSA-gwg2-r3hj-4w44; reasoning :35-46, GHSA-gwg2 reachable in*
*principle via an authenticated avatar upload, accepted as bounded DoS at :43-46; `NuGetAuditSuppress`*
*items :48-52); ADC copy at `MMCA.ADC/Directory.Build.props:55-59`.*
*ADR-045 (`Website/docs-src/adr/045-managed-file-storage-and-avatars.md`, Accepted 2026-07-11 at :4): Status*
*:3-16 lists four revisions (2026-09-07, 2026-09-12, 2026-10-01, 2026-10-21; the 2026-10-06 revision is*
*anchor-only and not listed); Decision at :27-55 (`IImageProcessor` bullet with the four decoders, the three*
*nulled profiles, the ICC limit and the Six Labors Split License at :34-43); the BR-116a avatar contract*
*(256x256, 2 MB, `{userId}-{random8}.jpg`, public-read `avatars` container, durable*
*`DeleteAvatarBlobInternalCommand` on replace/remove/erase, `[Pii]` URL nulled on anonymize with the delete*
*scheduled in the same transaction, GDPR export) at :48-55; Consequences at :57-71 (public-read + random*
*suffix :58-61, eventual at-least-once deletion and cache staleness :62-64, `Storage Blob Data Contributor`*
*:65-66, ImageSharp "vuln-audited, but not like everything else" with the five standing suppressions and*
*the license revisit :67-71). Revisions: 2026-09-07 decode ceilings at :73-85, 2026-09-12 at :87-119*
*(avatar-only scope SUPERSEDED by ADR-123 at :88-90, options overload abstract since v1.210.0 at :109-111),*
*2026-10-01 at :121-144 (durable avatar blob deletion; replace/remove schedule post-commit so a failed*
*schedule leaves a logged orphan, :137-142), 2026-10-06 at :146-165 (anchor-only), 2026-10-21 at :167-205*
*(decoder allowlist, metadata handling, audit posture; its `ImageSharpImageProcessor` anchors at :173-201*
*read 2 lines low against current source, for example `CreateDecoderOptions` cited :127-138, now :129-140,*
*and `ScheduleAvatarBlobDeletionAsync` cited :79-89, now starting :80). Client affordance:*
*`IMediaPickerService` (`IMediaPickerService.cs:9`, `IsSupported` at :12, cancelled/denied returns null and*
*affordance-switch note per doc :4-7); `NullMediaPickerService` web default at `NullMediaPickerService.cs:7`,*
*`IsSupported => false` at :10.*
*Consumers: MMCA.ADC Identity `AddAzureBlobFileStorage(builder.Configuration)` at*
*`MMCA.ADC.Identity.Service/Program.cs:254` (BR-116a/ADR-045 comment from :252) and ADC Conference at*
*`MMCA.ADC.Conference.Service/Program.cs:361` (comment at :358-360) for session assets. `SetUserAvatarHandler`*
*(`:27`) injects `IFileStorageService` (`:30`) and `IInternalCommandScheduler` (`:31`); sniffer gate at :63,*
*upload at :117, `entity.SetAvatarUrl` at :127; replaced blob scheduled post-commit in `OnMutatedAsync`*
*(:141) at :158-160 with the failed-schedule log at :162-165; the orphaned new blob scheduled on a failed*
*save at :78-88 via `ScheduleUploadedBlobCleanupAsync` (:180, fresh scope :184, schedule at :187 with*
*`CancellationToken.None`). `RemoveUserAvatarHandler` (`:18`, scheduler `:20`, schedule `:75`, failed-schedule*
*log `:80`) and `DeleteUserHandler` (`:32`, scheduler `:34`, `ScheduleAvatarBlobDeletionAsync` `:80`,*
*schedule `:83`) schedule `DeleteAvatarBlobInternalCommand` through `IInternalCommandScheduler` (ADR-114).*
*`DeleteAvatarBlobInternalCommandHandler.cs:17-23` derives from Common's*
*`DeleteBlobInternalCommandHandlerBase` (`MMCA.Common.Application/InternalCommands/DeleteBlobInternalCommandHandlerBase.cs:28`)*
*and overrides `BlobKind` at :23; the base makes the `fileStorage.DeleteAsync` call at :45 and maps*
*`NotFound` to success at :53-56. `Profile.razor.cs` (Identity.UI) injects `IMediaPickerService` at `:22`.*
*MMCA.Store has not adopted it (no `IFileStorageService`, `AddAzureBlobFileStorage` or `IMediaPickerService`*
*reference in any `.cs` or `.razor` file under `MMCA.Store/Source`, re-searched this run).*
*Anchor facts (not recounted here): 22 NuGet packages (`MMCA.Common/FACTS.md:19`), 132 accepted ADRs*
*(001-132, `Website/docs-src/adr/README.md:6`), framework v1.250.0 (`FACTS.md:14`), MMCA.Common index*
*Maturity 97.3% (319/328) / Implementation 85.4% (700/820), evidence as of 2026-10-22 at v1.250.0*
*(`Website/docs-src/governance/common-ArchitectureScorecard.md:5`, `:9`, `:10`), ImageSharp under the Six*
*Labors Split License. The code block is illustrative of shape (elided using/try/await scaffolding, the*
*`ConfigureAwait` calls, the stream rewind between the header read and the decode, the decoded-frame*
*re-check body and the message arguments), not a verbatim copy; every named call and value in it is*
*verified above.*

- Full series index: https://ivanball.github.io/writing.html
