# ADR-037: Field-Level Encryption at Rest (AES-256-GCM EF Converter)

## Status
Accepted (2026-07-06; revised 2026-07-24, 2026-07-25, 2026-08-15, 2026-08-18). Revised 2026-08-18: the
versioned-envelope converter is no longer unpublished, it is included in v1.153.0; adoption stays zero.

## Context
Transparent database encryption (TDE) protects the data files as a whole, but it decrypts
transparently for anyone who can query the database, so a leaked backup restored on a compromised
host, or a row read by an over-privileged connection, still yields plaintext. Some columns hold data
sensitive enough to warrant a second layer: the value should be ciphertext the moment it leaves the
application, so that only a holder of the application key (not merely a database reader) can recover
it.

This is a distinct control from the two sensitive-data mechanisms the framework already records.
Password hashing (ADR-032) is deliberately **one-way**: a credential is stored so it can be verified,
never recovered. Erasure (ADR-005) **removes or anonymizes** personal data on a data-subject request.
Neither covers the case of a field that must stay **retrievable in plaintext to the application** yet
be **unreadable in the database itself**: an at-rest, reversible, column-level confidentiality control.
ADR-005 already names this converter as the mechanism for erasure fields "that must remain retrievable"
(`ADRs/005-soft-delete-vs-erasure.md:22`), and `SECURITY.md:36` lists it in the security model, so the
capability is referenced across the docs but was never recorded as a decision.

The framework ships the plumbing for this, an EF Core value converter that encrypts and decrypts string
columns transparently, and it is covered by unit tests. It is **not yet adopted**: no entity
configuration in any of the four repositories wires it, so zero production columns are encrypted today.
This ADR records the decision and the extension point while being explicit about that posture, the same
"shipped in the framework, tested, but latent until the first adoption" honesty ADR-018 records for
polyglot persistence.

## Decision
Provide a single framework-owned EF Core value converter that transparently encrypts string columns at
rest with authenticated encryption, applied per property in an entity configuration.

1. **A sealed EF value converter.** `EncryptedStringConverter`
   (`Source/Core/MMCA.Common.Infrastructure/Persistence/Encryption/EncryptedStringConverter.cs:72`) is a
   `ValueConverter<string, string>` in the `MMCA.Common.Infrastructure.Persistence.Encryption` namespace
   (`EncryptedStringConverter.cs:6`). It encrypts on write and decrypts on read, so application and domain
   code keep an ordinary `string` property and never see ciphertext. It is applied per property:
   `builder.Property(e => e.SocialSecurityNumber).HasConversion(new EncryptedStringConverter(encryptionKey))`
   (`EncryptedStringConverter.cs:15`, `:16`). The documented example targets a stored-only field rather
   than a lookup key, for the reason recorded in the 2026-07-24 revision below.

2. **AES-256-GCM authenticated encryption.** Both directions use `AesGcm`
   (`EncryptedStringConverter.cs:200`, `:235`), which provides confidentiality **and** integrity. Every key
   must be exactly 32 bytes (256 bits), enforced on both construction paths: the single-key path
   null-checks the array (`ArgumentNullException.ThrowIfNull`, `EncryptedStringConverter.cs:129`) and throws
   `ArgumentException` on any other length (`EncryptedStringConverter.cs:130`, `:132`), and the key-ring path
   applies the same rule per entry (`EncryptedStringConverter.cs:166`, `:168`). `GenerateKey()` produces a
   cryptographically random 32-byte key via `RandomNumberGenerator.GetBytes(32)`
   (`EncryptedStringConverter.cs:125`). The envelope sizes are fixed constants: `VersionSize = 1`
   (`EncryptedStringConverter.cs:75`), `NonceSize = 12` (96 bits, NIST recommended,
   `EncryptedStringConverter.cs:78`) and `TagSize = 16` (128 bits, `EncryptedStringConverter.cs:81`).

3. **A versioned, self-describing storage envelope, Base64 in a string column.** Encrypt resolves the
   current key (`EncryptedStringConverter.cs:190`), writes UTF-8 plaintext bytes
   (`EncryptedStringConverter.cs:192`), draws a fresh random nonce (`EncryptedStringConverter.cs:193`),
   runs `AesGcm.Encrypt` (`EncryptedStringConverter.cs:201`), then concatenates
   `[key version (1)] [nonce (12)] [ciphertext (N)] [tag (16)]` (`EncryptedStringConverter.cs:203` through
   `:208`) and Base64-encodes the result (`EncryptedStringConverter.cs:210`). Decrypt reverses it:
   `FromBase64String` (`EncryptedStringConverter.cs:218`), a length guard that throws
   `CryptographicException` when the input is shorter than version plus nonce plus tag
   (`EncryptedStringConverter.cs:220`, `:221`), the version byte read from position 0
   (`EncryptedStringConverter.cs:223`), spans that slice out the nonce, ciphertext, and tag
   (`EncryptedStringConverter.cs:227`, `:229`, `:230`), `AesGcm.Decrypt` which validates the tag while
   decrypting (`EncryptedStringConverter.cs:236`), and a UTF-8 decode (`EncryptedStringConverter.cs:238`).
   The envelope is transparent to application code: a stored value carries everything needed to read it back
   except the key material itself.

4. **A key ring, with one version nominated as current.** The converter can be constructed over an
   `IReadOnlyDictionary<byte, byte[]>` of versioned keys plus the version to write with
   (`EncryptedStringConverter.cs:109`). Writes always use the current version
   (`EncryptedStringConverter.cs:116`); reads resolve their key from the version byte in the stored value
   itself (`EncryptedStringConverter.cs:224`), so a value written under an older version keeps decrypting
   for as long as that version stays registered. A version with no key registered throws
   `CryptographicException` naming only the version number, never key material
   (`EncryptedStringConverter.cs:225`). The ring is validated once at construction
   (`EncryptedStringConverter.cs:146`): not null (`:150`), not empty (`:152`), no null entry (`:159`),
   every key exactly 32 bytes (`:166`), and the nominated current version actually present (`:174`). It is
   then defensively copied into a `FrozenDictionary` (`EncryptedStringConverter.cs:181`), so mutating the
   dictionary the caller passed in cannot change which keys the converter uses. The original single-key
   `byte[]` constructor remains (`EncryptedStringConverter.cs:94`) and is now sugar for a one-entry ring at
   version 1 (`EncryptedStringConverter.cs:87`, `:137`).

5. **The version byte is authenticated, not merely stored.** The version is passed to AES-GCM as associated
   data on encrypt (`EncryptedStringConverter.cs:198`, `:201`) and on decrypt
   (`EncryptedStringConverter.cs:231`, `:236`), so the authentication tag covers it. Rewriting the version
   byte of a stored value fails decryption rather than silently selecting a different key, and it fails even
   when the substituted version happens to map to the same key (test at
   `Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Encryption/EncryptedStringConverterTests.cs:226`, which
   registers one key under two versions and still gets a `CryptographicException`).

6. **Ciphertext is non-deterministic.** A fresh random nonce per encryption
   (`EncryptedStringConverter.cs:193`) means the same plaintext encrypts to different ciphertext on every
   write (proven at `EncryptedStringConverterTests.cs:38`, and distinct plaintexts differ at
   `EncryptedStringConverterTests.cs:24`). The consequence is deliberate: an encrypted column cannot be
   equality-filtered, index-seeked, sorted, or joined on in the database.

7. **Empty and null values pass through unencrypted.** Both directions short-circuit on a null-or-empty
   string (`EncryptedStringConverter.cs:186`, `:215`), so a NULL or empty column stays as-is rather than
   becoming ciphertext (tests at `EncryptedStringConverterTests.cs:82` and `:95`).

8. **Key management is the consumer's responsibility, supplied as a constructor argument.** The converter
   takes raw key material on construction, either a single `byte[]` (`EncryptedStringConverter.cs:94`) or a
   whole ring (`EncryptedStringConverter.cs:109`); there is no DI registration, no options type, and no
   key-provider abstraction in the Infrastructure layer (a grep of `MMCA.Common.Infrastructure` for
   encryption options or a key-provider interface finds only the converter itself). The adopting entity
   configuration passes the keys in. The XML documentation directs consumers to store them in Azure Key
   Vault, user-secrets, or environment variables, never hardcoded (`EncryptedStringConverter.cs:34`, `:35`,
   `:36`).

9. **Stateless and context-free by design.** The converter holds nothing but the frozen ring captured at
   construction, and key-version resolution is data-driven from the stored envelope
   (`EncryptedStringConverter.cs:223`, `:224`), never from the `DbContext`. That is not an oversight: an EF
   value converter runs inside the provider's materialization path as a pair of compiled expressions
   (`EncryptedStringConverter.cs:116`, `:117`) and has no access to the context, the current user, or any
   ambient request scope. Per-tenant or per-request key selection is therefore deliberately out of scope for
   this converter (`EncryptedStringConverter.cs:62` through `:70`); a design that needs it wants a
   `SaveChanges` interceptor or application-layer encryption above EF Core, where the request context is
   still reachable.

10. **Unit-tested but not yet adopted.** `EncryptedStringConverterTests`
    (`Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Encryption/EncryptedStringConverterTests.cs:6`) covers a
    plaintext round-trip (`EncryptedStringConverterTests.cs:10`), a Unicode round-trip
    (`EncryptedStringConverterTests.cs:129`), non-deterministic output (`EncryptedStringConverterTests.cs:24`,
    `:38`), the 32-byte key generation (`EncryptedStringConverterTests.cs:52`, `:61`), the invalid-length and
    null-key guards (`EncryptedStringConverterTests.cs:71`, `:123`), the empty-string passthrough
    (`EncryptedStringConverterTests.cs:82`, `:95`), the too-short-ciphertext `CryptographicException`
    (`EncryptedStringConverterTests.cs:108`), the version byte the single-key constructor stamps
    (`EncryptedStringConverterTests.cs:145`), a key-ring round trip (`EncryptedStringConverterTests.cs:157`),
    a full rotation round trip in which pre-rotation ciphertext stays readable while new writes carry the new
    version (`EncryptedStringConverterTests.cs:175`), an unregistered version
    (`EncryptedStringConverterTests.cs:205`), the tampered-version-byte failure
    (`EncryptedStringConverterTests.cs:226`), the four ring-validation guards
    (`EncryptedStringConverterTests.cs:244`, `:250`, `:259`, `:268`), and the defensive copy
    (`EncryptedStringConverterTests.cs:281`). Adoption, however, is still zero: a ripgrep across all four
    repositories (`MMCA.Common`, `MMCA.Store`, `MMCA.ADC`, `MMCA.Helpdesk`) finds
    `new EncryptedStringConverter(` only in the converter's own XML-doc example
    (`EncryptedStringConverter.cs:16`) and in that test file. No `*Configuration.cs` in any repo calls
    `.HasConversion(new EncryptedStringConverter(...))`, and Store, ADC, and Helpdesk contain no reference to
    the type at all. The encrypt/decrypt path is exercised by tests, not by any live column.

## Rationale
- **Authenticated, not merely confidential.** AES-GCM binds a 128-bit tag to the ciphertext
  (`EncryptedStringConverter.cs:81`, `:201`), so a tampered or truncated value fails to decrypt via the tag
  check in `AesGcm.Decrypt` (`EncryptedStringConverter.cs:236`) rather than silently returning corrupted
  plaintext, and a value too short to even hold a version, nonce and tag is rejected up front
  (`EncryptedStringConverter.cs:220`). At-rest integrity comes for free with confidentiality.
- **The envelope should describe itself, and the description should be authenticated.** A stored value that
  carries its own key version needs no side table, no column convention, and no deployment-ordered guess
  about which key wrote it: the reader is told (`EncryptedStringConverter.cs:223`). Passing that byte as
  associated data (`EncryptedStringConverter.cs:198`, `:231`) closes the obvious follow-on question, because
  a self-describing envelope whose description is unauthenticated is an invitation to rewrite the
  description. One byte of overhead buys both properties.
- **Rotation has to be possible without a maintenance window.** Reads resolving their key from the data and
  writes using the current version turn key rotation into four independent steps (add the new key as current
  while keeping the old one registered, deploy, re-encrypt rows in the background at whatever pace the table
  allows, then retire the old version) rather than one bulk re-encryption that has to complete before the
  application can come back up (`EncryptedStringConverter.cs:45` through `:61`).
- **Breaking the format now is free, and will not be later.** The un-versioned layout had no decode path to
  preserve because it has no readers: this ADR has recorded zero adopted columns since 2026-07-06. A format
  break costs nothing while adoption is zero and costs a migration for every encrypted row afterwards, so
  taking it now avoids shipping a legacy-decode branch that would then live forever.
- **One framework-owned primitive.** As with password hashing (ADR-032), the algorithm, key size, nonce
  size, and storage layout are decided once in a single shared type, so a future hardening is one edit that
  every eventual adopter inherits rather than per-app crypto scattered across modules.
- **Non-determinism is the right confidentiality default.** A random nonce per write
  (`EncryptedStringConverter.cs:193`) defeats equality and frequency analysis over the ciphertext, which a
  deterministic scheme would leak; the cost is queryability, which is the correct trade for a genuinely
  sensitive column that the application reads by primary key rather than by the encrypted value.
- **Transparent at the EF boundary.** Because the conversion lives on the property mapping
  (`EncryptedStringConverter.cs:13`), entities keep `string` properties and no handler, DTO, or domain code
  changes when a column becomes encrypted.

## Trade-offs
- **Latent today, proven by tests rather than production.** The plumbing is complete and unit-tested, but
  no entity configuration wires it, so the encrypt/decrypt round-trip, the tag-validated integrity path, and
  the key-length guard are exercised only by `EncryptedStringConverterTests` and not by any deployed column.
  ADR-005 names this converter as the mechanism for erasure fields that must remain retrievable
  (`ADRs/005-soft-delete-vs-erasure.md:22`), but that pairing is available, not yet applied. This is the same
  shipped-but-unadopted posture ADR-018 records for polyglot persistence.
- **Encrypted columns are not queryable.** The random nonce (`EncryptedStringConverter.cs:193`) makes
  ciphertext non-deterministic, so there is no equality filter, index seek, sort, or join on an encrypted
  column. A field that must be both encrypted and looked up needs a separate deterministic scheme or a blind
  index, neither of which this converter provides.
- **Key management is still entirely the consumer's; the ring is a mechanism, not a service.** The converter
  takes raw key material (`EncryptedStringConverter.cs:94`, `:109`) and holds whatever ring it was handed,
  frozen at construction (`EncryptedStringConverter.cs:181`). There is no key-provider abstraction, no Key
  Vault integration, and no automatic refresh: adding a version means constructing a new converter, which in
  practice means a deployment. Losing a key still makes every row written under that version permanently
  unrecoverable, and the ring makes that failure mode more granular rather than less likely. Envelope
  encryption over a key-encryption key remains out of scope.
- **Rotation is enabled, not automated.** The format and the ring make a zero-downtime rotation possible
  (`EncryptedStringConverter.cs:45` through `:61`), but the re-encryption pass itself is the adopter's to
  write and to run, and nothing in the framework reports how many rows still carry an old version. Retiring a
  version early throws `CryptographicException` on every unconverted row
  (`EncryptedStringConverter.cs:225`), which is the loud failure rather than the silent one, but it is still
  an outage for that column.
- **One byte caps the ring at 256 live versions.** The version prefix is a single `byte`
  (`EncryptedStringConverter.cs:75`, `:109`). That is ample for annual or quarterly rotation over any
  realistic system lifetime, and it is a deliberate trade of headroom for a one-byte envelope, but versions
  wrap rather than grow: a scheme that rotates far more often would have to reuse retired numbers, and reused
  numbers are exactly the ambiguity the version byte exists to prevent.
- **Per-property wiring, not a global switch.** Encryption is opted into one `HasConversion` call at a time
  in each entity configuration (`EncryptedStringConverter.cs:13`), so a column that should be encrypted but is
  never wired silently stays plaintext, the same audit-the-inventory caveat as ADR-005.
- **Storage and CPU overhead.** Every value grows by 29 bytes (1-byte key version plus 12-byte nonce plus
  16-byte tag, `EncryptedStringConverter.cs:75`, `:78`, `:81`) before Base64 inflation, and every read and
  write performs an AES-GCM operation.
- **Malformed-input coverage stops short of a ciphertext bit-flip.** Integrity rests on AES-GCM's tag (a
  property of the primitive). The suite now covers the short-value guard
  (`EncryptedStringConverterTests.cs:108`), an unregistered version (`:205`), and a rewritten version byte
  under a shared key (`:226`), but there is still no test that flips a bit inside the ciphertext or decrypts
  under a wrong key at the same version, so a refactor that weakened tag validation over the ciphertext body
  would not be caught by the current suite.

## Related
ADR-005 (soft-delete vs erasure: the other sensitive-data control, which names this converter as the
mechanism for erasure fields that must stay retrievable, `ADRs/005-soft-delete-vs-erasure.md:22`), ADR-032
(password hashing: the one-way credential counterpart in the same Infrastructure layer, which already calls
this converter "the at-rest counterpart to hashing credentials"), ADR-018 (polyglot persistence: the
shipped, tested, but unadopted precedent this record mirrors). This ADR backs the one-line "Field encryption"
entry in the security model (`SECURITY.md:36`), which stays as the reader-facing pointer.

## Revision (2026-07-24)
Documented a constraint the converter always had but did not state: **the ciphertext is
non-deterministic**. Every write uses a fresh random nonce, which is the correct property for
confidentiality and means the column cannot support equality or range predicates (a `Where` against
it compares to a ciphertext that will never match, returning no rows silently), unique indexes, or
server-side sorting and grouping.

The usage example was changed off `Email` for exactly that reason: applying the converter to an
address the authentication flow looks up by value would have broken login silently rather than
loudly. A lookup key that must stay searchable needs a separate deterministic surface, such as a
keyed hash stored alongside the encrypted column.

## Revision (2026-07-25)
Documentation-only correction, no behavior change. Item 1 of the Decision still illustrated the
converter with `builder.Property(e => e.Email)`, contradicting the 2026-07-24 revision above: the
shipped XML-doc example targets `SocialSecurityNumber`, a stored-only field, precisely because an
authentication-lookup column would fail silently. The Decision now quotes the shipped example.

Every `EncryptedStringConverter.cs` line citation in this record was also rebased. The 2026-07-24
revision added the non-determinism constraint paragraph to the type's XML documentation, which
pushed the class declaration and the whole implementation body down by fourteen lines; the anchors
here had not moved with it and now point at the current lines.

## Revision (2026-08-15)
Behavior change, not a documentation correction. The stored layout is now a **versioned envelope**:
Base64 of `[key version (1)] [nonce (12)] [ciphertext (N)] [tag (16)]` rather than the previous
`[nonce] [ciphertext] [tag]`, and the converter can be constructed over a whole ring of versioned keys
with one nominated as current (`EncryptedStringConverter.cs:109`). Writes stamp the current version,
reads resolve their key from the version byte in the value itself, and the version byte travels as
AES-GCM associated data (`EncryptedStringConverter.cs:198`, `:231`) so the authentication tag covers
it: rewriting the version of a stored value fails decryption even when the substituted version maps to
the same key. That turns the "no rotation story" trade-off recorded above into a four-step,
zero-downtime rotation (add the new key as current, deploy, re-encrypt in the background, retire the
old version), and it retires the claim that the layout carries no key identifier. Decision items 3, 4,
5, 8 and 9 and the matching Rationale and Trade-off bullets were rewritten to the new reality, the
per-value overhead moved from 28 bytes to 29 before Base64, and the citations were rebased once more
against the current file.

**There is no legacy decode path.** A value in the old un-versioned format does not read back under the
new converter: its first byte is a nonce byte, not a version. That is a deliberate break, and the
reason it is affordable is the posture this ADR has recorded honestly since 2026-07-06, namely that
adoption is zero. No entity configuration in any of the four repositories wires the converter, so there
are no stored values to migrate and no compatibility branch worth carrying forever. The window in which
the format is free to change closes at the first adopted column, which is precisely why the change was
made before that rather than after it.

The redesign was prompted by reader feedback on the published article about this converter, which asked
the obvious question the original design did not answer: what happens when the key has to change. The
right answer was in the storage format, not in the documentation, so the record is being corrected by
changing the code rather than by explaining the gap more carefully.

One thing deliberately did **not** change. The converter stays stateless and context-free: version
resolution is data-driven from the envelope and never consults the `DbContext`, because an EF value
converter is a pair of compiled expressions in the provider's materialization path and cannot reach the
context, the current user, or any ambient scope. Per-tenant and per-request key selection therefore
remain out of scope here (new Decision item 9); they need a `SaveChanges` interceptor or
application-layer encryption above EF Core.

Test coverage grew from 11 cases to 21, adding the rotation round trip
(`EncryptedStringConverterTests.cs:175`), the tampered-version-byte failure (`:226`), the unregistered
version (`:205`), the four ring-validation guards (`:244`, `:250`, `:259`, `:268`), the defensive copy
of the caller's dictionary (`:281`), and the version byte the single-key constructor stamps (`:145`).

The work this revision documents landed via MMCA.Common PR #247 and is included in v1.153.0 (tagged
2026-08-18), so the versioned envelope and key ring are now in published packages. It is included
rather than featured: the `[1.153.0]` changelog entry (`MMCA.Common/CHANGELOG.md:1425`) does not name
the converter, which is in the release because it merged to `main` before the tag. Adoption is
unchanged at zero: no entity configuration in any of the four repositories wires the converter.
