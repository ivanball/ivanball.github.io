# ADR-037: Field-Level Encryption at Rest (AES-256-GCM EF Converter)

## Status
Accepted (2026-07-06; revised 2026-07-24, 2026-07-25, 2026-08-15, 2026-08-18). Revised 2026-08-18: the
versioned-envelope converter is no longer unpublished, it is included in v1.153.0; adoption stays zero.
Revised 2026-10-07: anchors refreshed after the v1.233.0 release.
Revised 2026-10-21: key rotation step 3 now requires `MarkForReEncryption` (a plain load-and-save does not
re-encrypt), the audit trail redacts encrypted properties, and a re-encryption test suite and the
audit-trail test harness also wire the converter (v1.247.0); production adoption stays zero.
Revised 2026-10-26: anchors refreshed after the v1.261.0 release.
Revised 2026-10-28: anchors refreshed after MMCA.Common #615 and the 2026-10-28 ADR-005 revision.

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
(`Website/docs-src/adr/005-soft-delete-vs-erasure.md:29`), and `SECURITY.md:40` lists it in the security model, so the
capability is referenced across the docs but was never recorded as a decision.

The framework ships the plumbing for this, an EF Core value converter that encrypts and decrypts string
columns transparently, and it is covered by unit tests. It is **not yet adopted**: no production entity
configuration in any of the four repositories wires it, so zero production columns are encrypted today.
This ADR records the decision and the extension point while being explicit about that posture, the same
"shipped in the framework, tested, but latent until the first adoption" honesty ADR-018 records for
polyglot persistence.

## Decision
Provide a single framework-owned EF Core value converter that transparently encrypts string columns at
rest with authenticated encryption, applied per property in an entity configuration.

1. **A sealed EF value converter.** `EncryptedStringConverter`
   (`Source/Core/MMCA.Common.Infrastructure/Persistence/Encryption/EncryptedStringConverter.cs:76`) is a
   `ValueConverter<string, string>` in the `MMCA.Common.Infrastructure.Persistence.Encryption` namespace
   (`EncryptedStringConverter.cs:7`). It encrypts on write and decrypts on read, so application and domain
   code keep an ordinary `string` property and never see ciphertext. It is applied per property:
   `builder.Property(e => e.SocialSecurityNumber).HasConversion(new EncryptedStringConverter(encryptionKey))`
   (`EncryptedStringConverter.cs:16`, `:17`). The documented example targets a stored-only field rather
   than a lookup key, for the reason recorded in the 2026-07-24 revision below.

2. **AES-256-GCM authenticated encryption.** Both directions use `AesGcm`
   (`EncryptedStringConverter.cs:230`, `:265`), which provides confidentiality **and** integrity. Every key
   must be exactly 32 bytes (256 bits), enforced on both construction paths: the single-key path
   null-checks the array (`ArgumentNullException.ThrowIfNull`, `EncryptedStringConverter.cs:159`) and throws
   `ArgumentException` on any other length (`EncryptedStringConverter.cs:160`, `:162`), and the key-ring path
   applies the same rule per entry (`EncryptedStringConverter.cs:196`, `:198`). `GenerateKey()` produces a
   cryptographically random 32-byte key via `RandomNumberGenerator.GetBytes(KeySize)`
   (`EncryptedStringConverter.cs:129`, with `KeySize = 32` at `:88`). The envelope sizes are fixed constants: `VersionSize = 1`
   (`EncryptedStringConverter.cs:79`), `NonceSize = 12` (96 bits, NIST recommended,
   `EncryptedStringConverter.cs:82`) and `TagSize = 16` (128 bits, `EncryptedStringConverter.cs:85`).

3. **A versioned, self-describing storage envelope, Base64 in a string column.** Encrypt resolves the
   current key (`EncryptedStringConverter.cs:220`), writes UTF-8 plaintext bytes
   (`EncryptedStringConverter.cs:222`), draws a fresh random nonce (`EncryptedStringConverter.cs:223`),
   runs `AesGcm.Encrypt` (`EncryptedStringConverter.cs:231`), then concatenates
   `[key version (1)] [nonce (12)] [ciphertext (N)] [tag (16)]` (`EncryptedStringConverter.cs:233` through
   `:238`) and Base64-encodes the result (`EncryptedStringConverter.cs:240`). Decrypt reverses it:
   `FromBase64String` (`EncryptedStringConverter.cs:248`), a length guard that throws
   `CryptographicException` when the input is shorter than version plus nonce plus tag
   (`EncryptedStringConverter.cs:250`, `:251`), the version byte read from position 0
   (`EncryptedStringConverter.cs:253`), spans that slice out the nonce, ciphertext, and tag
   (`EncryptedStringConverter.cs:257`, `:259`, `:260`), `AesGcm.Decrypt` which validates the tag while
   decrypting (`EncryptedStringConverter.cs:266`), and a UTF-8 decode (`EncryptedStringConverter.cs:268`).
   The envelope is transparent to application code: a stored value carries everything needed to read it back
   except the key material itself.

4. **A key ring, with one version nominated as current.** The converter can be constructed over an
   `IReadOnlyDictionary<byte, byte[]>` of versioned keys plus the version to write with
   (`EncryptedStringConverter.cs:113`). Writes always use the current version
   (`EncryptedStringConverter.cs:120`); reads resolve their key from the version byte in the stored value
   itself (`EncryptedStringConverter.cs:254`), so a value written under an older version keeps decrypting
   for as long as that version stays registered. A version with no key registered throws
   `CryptographicException` naming only the version number, never key material
   (`EncryptedStringConverter.cs:255`). The ring is validated once at construction
   (`EncryptedStringConverter.cs:176`): not null (`:180`), not empty (`:182`), no null entry (`:189`),
   every key exactly 32 bytes (`:196`), and the nominated current version actually present (`:204`). It is
   then defensively copied into a `FrozenDictionary` (`EncryptedStringConverter.cs:211`), so mutating the
   dictionary the caller passed in cannot change which keys the converter uses. The original single-key
   `byte[]` constructor remains (`EncryptedStringConverter.cs:98`) and is now sugar for a one-entry ring at
   version 1 (`EncryptedStringConverter.cs:91`, `:167`).

5. **The version byte is authenticated, not merely stored.** The version is passed to AES-GCM as associated
   data on encrypt (`EncryptedStringConverter.cs:228`, `:231`) and on decrypt
   (`EncryptedStringConverter.cs:261`, `:266`), so the authentication tag covers it. Rewriting the version
   byte of a stored value fails decryption rather than silently selecting a different key, and it fails even
   when the substituted version happens to map to the same key (test at
   `Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Encryption/EncryptedStringConverterTests.cs:226`, which
   registers one key under two versions and still gets a `CryptographicException`).

6. **Ciphertext is non-deterministic.** A fresh random nonce per encryption
   (`EncryptedStringConverter.cs:223`) means the same plaintext encrypts to different ciphertext on every
   write (proven at `EncryptedStringConverterTests.cs:38`, and distinct plaintexts differ at
   `EncryptedStringConverterTests.cs:24`). The consequence is deliberate: an encrypted column cannot be
   equality-filtered, index-seeked, sorted, or joined on in the database.

7. **Empty and null values pass through unencrypted.** Both directions short-circuit on a null-or-empty
   string (`EncryptedStringConverter.cs:216`, `:245`), so a NULL or empty column stays as-is rather than
   becoming ciphertext (tests at `EncryptedStringConverterTests.cs:82` and `:95`).

8. **Key management is the consumer's responsibility, supplied as a constructor argument.** The converter
   takes raw key material on construction, either a single `byte[]` (`EncryptedStringConverter.cs:98`) or a
   whole ring (`EncryptedStringConverter.cs:113`); there is no DI registration, no options type, and no
   key provider for this converter (the framework's other key types, such as the JWKS signing-key provider
   and the Data Protection key ring, do not supply or manage its keys). The adopting entity configuration passes the
   keys in. The XML documentation directs consumers to store them in Azure Key Vault, user-secrets, or
   environment variables, never hardcoded (`EncryptedStringConverter.cs:35`, `:36`). One other
   Infrastructure type does recognize the converter: the audit-trail interceptor records its redaction
   token, never the value, for any property whose value converter is an `EncryptedStringConverter`
   (`Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:638`
   through `:641`, documented at `:56` through `:58`), because the change tracker hands it the decrypted
   plaintext and recording that would put in clear text exactly what the column encrypts. That needs no
   marker on the property.

9. **Stateless and context-free by design.** The converter holds nothing but the frozen ring captured at
   construction, and key-version resolution is data-driven from the stored envelope
   (`EncryptedStringConverter.cs:253`, `:254`), never from the `DbContext`. That is not an oversight: an EF
   value converter runs inside the provider's materialization path as a pair of compiled expressions
   (`EncryptedStringConverter.cs:120`, `:121`) and has no access to the context, the current user, or any
   ambient request scope. Per-tenant or per-request key selection is therefore deliberately out of scope for
   this converter (`EncryptedStringConverter.cs:67` through `:73`); a design that needs it wants a
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
    (`EncryptedStringConverterTests.cs:281`). Two further suites wire it into a real EF model:
    `EncryptedStringConverterReEncryptionTests`
    (`Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Encryption/EncryptedStringConverterReEncryptionTests.cs:14`,
    test method at `:26`) saves a row under version 1 against an SQLite table, then rewrites it under version 2 through
    `MarkForReEncryption` (`HasConversion` at `:84`, converters at `:90` and `:96`), and the audit-trail
    test harness maps an encrypted property
    (`Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailTestHarness.cs:264`) that
    `AuditTrailSaveChangesInterceptorTests` uses to prove the redaction
    (`Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailSaveChangesInterceptorTests.cs:383`,
    asserting the redaction token at `:394`, `:395`).
    Production adoption, however, is still zero: across all four repositories (`MMCA.Common`, `MMCA.Store`,
    `MMCA.ADC`, `MMCA.Helpdesk`), `new EncryptedStringConverter(` appears only in the converter's own XML-doc
    example (`EncryptedStringConverter.cs:17`) and in those three test files. No `*Configuration.cs` in any
    repo calls `.HasConversion(new EncryptedStringConverter(...))`, and Store, ADC, and Helpdesk contain no
    reference to the type at all. The encrypt/decrypt path is exercised by tests, not by any live column.

## Rationale
- **Authenticated, not merely confidential.** AES-GCM binds a 128-bit tag to the ciphertext
  (`EncryptedStringConverter.cs:85`, `:231`), so a tampered or truncated value fails to decrypt via the tag
  check in `AesGcm.Decrypt` (`EncryptedStringConverter.cs:266`) rather than silently returning corrupted
  plaintext, and a value too short to even hold a version, nonce and tag is rejected up front
  (`EncryptedStringConverter.cs:250`). At-rest integrity comes for free with confidentiality.
- **The envelope should describe itself, and the description should be authenticated.** A stored value that
  carries its own key version needs no side table, no column convention, and no deployment-ordered guess
  about which key wrote it: the reader is told (`EncryptedStringConverter.cs:253`). Passing that byte as
  associated data (`EncryptedStringConverter.cs:228`, `:261`) closes the obvious follow-on question, because
  a self-describing envelope whose description is unauthenticated is an invitation to rewrite the
  description. One byte of overhead buys both properties.
- **Rotation has to be possible without a maintenance window.** Reads resolving their key from the data and
  writes using the current version turn key rotation into four independent steps (add the new key as current
  while keeping the old one registered, deploy, re-encrypt rows in the background at whatever pace the table
  allows, then retire the old version) rather than one bulk re-encryption that has to complete before the
  application can come back up (`EncryptedStringConverter.cs:47` through `:65`). Step 3 is load, call
  `EncryptedStringConverter.MarkForReEncryption(entry)` (`EncryptedStringConverter.cs:143`), then save:
  a plain load-and-save does **not** re-encrypt, because change tracking compares the decrypted plaintext
  against its snapshot, so an untouched property is left out of the UPDATE and keeps its old version byte
  (`EncryptedStringConverter.cs:56` through `:60`). `MarkForReEncryption` marks every property of the
  entry mapped through the converter as modified and returns how many it marked (`:148` through `:154`);
  an owned type is a separate entry and has to be passed on its own (`:138`, `:139`).
- **Breaking the format now is free, and will not be later.** The un-versioned layout had no decode path to
  preserve because it has no readers: this ADR has recorded zero adopted columns since 2026-07-06. A format
  break costs nothing while adoption is zero and costs a migration for every encrypted row afterwards, so
  taking it now avoids shipping a legacy-decode branch that would then live forever.
- **One framework-owned primitive.** As with password hashing (ADR-032), the algorithm, key size, nonce
  size, and storage layout are decided once in a single shared type, so a future hardening is one edit that
  every eventual adopter inherits rather than per-app crypto scattered across modules.
- **Non-determinism is the right confidentiality default.** A random nonce per write
  (`EncryptedStringConverter.cs:223`) defeats equality and frequency analysis over the ciphertext, which a
  deterministic scheme would leak; the cost is queryability, which is the correct trade for a genuinely
  sensitive column that the application reads by primary key rather than by the encrypted value.
- **Transparent at the EF boundary.** Because the conversion lives on the property mapping
  (`EncryptedStringConverter.cs:14`, example at `:16`, `:17`), entities keep `string` properties and no handler, DTO, or domain code
  changes when a column becomes encrypted.

## Trade-offs
- **Latent today, proven by tests rather than production.** The plumbing is complete and unit-tested, but
  no production entity configuration wires it, so the encrypt/decrypt round-trip, the tag-validated integrity path, and
  the key-length guard are exercised only by tests (`EncryptedStringConverterTests`, plus the SQLite-backed
  `EncryptedStringConverterReEncryptionTests.cs:14` and the audit-trail harness at
  `AuditTrailTestHarness.cs:264`) and not by any deployed column.
  ADR-005 names this converter as the mechanism for erasure fields that must remain retrievable
  (`Website/docs-src/adr/005-soft-delete-vs-erasure.md:29`), but that pairing is available, not yet applied. This is the same
  shipped-but-unadopted posture ADR-018 records for polyglot persistence.
- **Encrypted columns are not queryable.** The random nonce (`EncryptedStringConverter.cs:223`) makes
  ciphertext non-deterministic, so there is no equality filter, index seek, sort, or join on an encrypted
  column. A field that must be both encrypted and looked up needs a separate deterministic scheme or a blind
  index, neither of which this converter provides.
- **Key management is still entirely the consumer's; the ring is a mechanism, not a service.** The converter
  takes raw key material (`EncryptedStringConverter.cs:98`, `:113`) and holds whatever ring it was handed,
  frozen at construction (`EncryptedStringConverter.cs:211`). The converter has no key provider, no Key
  Vault integration of its own, and no automatic refresh: adding a version means constructing a new converter, which in
  practice means a deployment. Losing a key still makes every row written under that version permanently
  unrecoverable, and the ring makes that failure mode more granular rather than less likely. Envelope
  encryption over a key-encryption key remains out of scope.
- **Rotation is enabled, not automated.** The format and the ring make a zero-downtime rotation possible
  (`EncryptedStringConverter.cs:47` through `:65`), but the re-encryption pass itself is the adopter's to
  write and to run. The framework supplies only the per-entry primitive, `MarkForReEncryption`
  (`EncryptedStringConverter.cs:143`), whose return value is the number of properties it marked on that
  entry, not a count of rows left; nothing in the framework reports how many rows still carry an old
  version. A pass written as a plain load-and-save silently rewrites nothing and leaves every row on the old
  version (`EncryptedStringConverter.cs:58` through `:60`). Retiring a
  version early throws `CryptographicException` on every unconverted row
  (`EncryptedStringConverter.cs:255`), which is the loud failure rather than the silent one, but it is still
  an outage for that column.
- **One byte caps the ring at 256 live versions.** The version prefix is a single `byte`
  (`EncryptedStringConverter.cs:79`, `:113`). That is ample for annual or quarterly rotation over any
  realistic system lifetime, and it is a deliberate trade of headroom for a one-byte envelope, but versions
  wrap rather than grow: a scheme that rotates far more often would have to reuse retired numbers, and reused
  numbers are exactly the ambiguity the version byte exists to prevent.
- **Per-property wiring, not a global switch.** Encryption is opted into one `HasConversion` call at a time
  in each entity configuration (`EncryptedStringConverter.cs:14`, example at `:16`, `:17`), so a column that should be encrypted but is
  never wired silently stays plaintext, the same audit-the-inventory caveat as ADR-005.
- **Storage and CPU overhead.** Every value grows by 29 bytes (1-byte key version plus 12-byte nonce plus
  16-byte tag, `EncryptedStringConverter.cs:79`, `:82`, `:85`) before Base64 inflation, and every read and
  write performs an AES-GCM operation.
- **Malformed-input coverage stops short of a ciphertext bit-flip.** Integrity rests on AES-GCM's tag (a
  property of the primitive). The suite now covers the short-value guard
  (`EncryptedStringConverterTests.cs:108`), an unregistered version (`:205`), and a rewritten version byte
  under a shared key (`:226`), but there is still no test that flips a bit inside the ciphertext or decrypts
  under a wrong key at the same version, so a refactor that weakened tag validation over the ciphertext body
  would not be caught by the current suite.

## Related
ADR-005 (soft-delete vs erasure: the other sensitive-data control, which names this converter as the
mechanism for erasure fields that must stay retrievable, `Website/docs-src/adr/005-soft-delete-vs-erasure.md:29`), ADR-032
(password hashing: the one-way credential counterpart in the same Infrastructure layer, which already calls
this converter "the at-rest counterpart to hashing credentials"), ADR-018 (polyglot persistence: the
shipped, tested, but unadopted precedent this record mirrors). This ADR backs the one-line "Field encryption"
entry in the security model (`SECURITY.md:40`), which stays as the reader-facing pointer.

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

## Revision (2026-10-01)
Anchor-only refresh; no decision, rationale or trade-off changed. The three citations of ADR-005 in
Context, Trade-offs and Related now point at the record's canonical home and current line,
`Website/docs-src/adr/005-soft-delete-vs-erasure.md:23`, where it still names `EncryptedStringConverter`
as the mechanism for erasure fields that must remain retrievable. The changelog anchor inside the
2026-08-15 revision is left as a historical record: the `[1.153.0]` heading now sits at
`MMCA.Common/CHANGELOG.md:2978`, and that entry still does not name the converter.

## Revision (2026-10-06)
Anchor-only refresh; no decision, rationale or trade-off changed.
- The three live citations of ADR-005 (Context, Trade-offs, Related) now point at
  `Website/docs-src/adr/005-soft-delete-vs-erasure.md:25`, where Decision item 2 still names
  `EncryptedStringConverter` as the mechanism for erasure fields that must remain retrievable.
- Decision item 2 now quotes the key-generation call as written, `RandomNumberGenerator.GetBytes(KeySize)`
  (`EncryptedStringConverter.cs:125`), with `KeySize = 32` at `EncryptedStringConverter.cs:84`; the key
  size is unchanged.
- The `[1.153.0]` changelog heading cited in the two revisions above now sits at
  `MMCA.Common/CHANGELOG.md:3319`; that entry still does not name the converter. Both earlier anchors are
  left as recorded.
- Every other `EncryptedStringConverter.cs` and `EncryptedStringConverterTests.cs` anchor was re-verified
  against current source and still holds; adoption is still zero (no reference to the type in Store, ADC
  or Helpdesk).

## Revision (2026-10-07)
Re-verified against current source. Anchor-only refresh; no decision, rationale, trade-off or adoption
fact changed. The converter is still absent from the changelog and adoption is still zero.
1. Anchors re-verified against current source: the `[1.153.0]` changelog heading cited in the three
   revisions above now sits at `MMCA.Common/CHANGELOG.md:3344` (the section runs to the `[1.152.0]`
   heading at `MMCA.Common/CHANGELOG.md:3426`), and `EncryptedStringConverter` still has no match
   anywhere in the changelog. The earlier anchors are left as recorded.

## Revision (2026-10-21)
Re-verified against current source. The algorithm, envelope, key ring, authenticated version byte,
non-determinism, constructor-supplied key management, statelessness and zero production adoption are
unchanged. What moved is the rotation procedure, a second Infrastructure type that recognizes the
converter, and the test footprint, all shipped in v1.247.0 (`MMCA.Common/CHANGELOG.md:45`).
1. Rotation step 3 is no longer "re-encrypt in the background" alone. A plain load-and-save does not
   re-encrypt, because change tracking compares the decrypted plaintext against its snapshot and leaves an
   untouched property out of the UPDATE (`EncryptedStringConverter.cs:56` through `:60`; also
   `MMCA.Common/UPGRADING.md:258`). The new public static
   `EncryptedStringConverter.MarkForReEncryption(EntityEntry)` (`EncryptedStringConverter.cs:143`,
   `Source/Core/MMCA.Common.Infrastructure/PublicAPI.Shipped.txt:1026`, `MMCA.Common/CHANGELOG.md:57`) marks every converter-mapped property of
   an entry modified and returns how many it marked. The Rationale rotation bullet and the "Rotation is
   enabled, not automated" trade-off now say so; the loop over rows is still the adopter's to write and
   nothing reports the rows left on an old version.
2. Decision item 8: the audit-trail interceptor records its redaction token for any property mapped
   through the converter
   (`Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:639`,
   `MMCA.Common/CHANGELOG.md:101`), so the earlier statement that a grep finds "only the converter itself"
   is replaced. Still no options type, key provider for this converter, or DI registration.
3. Decision item 10 and the "Latent today" trade-off: `new EncryptedStringConverter(` also appears in
   `EncryptedStringConverterReEncryptionTests.cs:90`, `:96` (a SQLite-backed rotation test at `:26`) and
   `AuditTrailTestHarness.cs:264`, not only in `EncryptedStringConverterTests`. Store, ADC and Helpdesk
   still contain no reference, and no production `*Configuration.cs` wires it. The audit-trail redaction
   is proven by `AuditTrailSaveChangesInterceptorTests.cs:383`.
4. The converter is now named in the changelog (`MMCA.Common/CHANGELOG.md:57`, `:101`, both under
   `[1.247.0]`), which supersedes the "no match anywhere in the changelog" statement in the 2026-10-07
   revision; the `[1.153.0]` entry (`MMCA.Common/CHANGELOG.md:3663`, running to `[1.152.0]` at `:3745`)
   still does not name it.
5. Anchors re-verified against current source: class `EncryptedStringConverter.cs:76`, namespace `:7`,
   usage `:14` with the example at `:16`, `:17`; key guidance `:35`, `:36`; rotation remarks `:47` through
   `:65`; statelessness remarks `:67` through `:73`; constants `:79`, `:82`, `:85`, `:88`, `:91`; ctors
   `:98`, `:113`; lambdas `:120`, `:121`; `GenerateKey` `:129`; single-key guards `:159`, `:160`, `:162`,
   ring `:167`; `ValidateAndFreeze` `:176` (`:180`, `:182`, `:189`, `:196`, `:198`, `:204`, `:211`);
   encrypt `:216`, `:220`, `:222`, `:223`, `:228`, `:230`, `:231`, `:233` through `:238`, `:240`; decrypt
   `:245`, `:248`, `:250`, `:251`, `:253` through `:255`, `:257`, `:259` through `:261`, `:265`, `:266`,
   `:268`. The three live ADR-005 citations now point at
   `Website/docs-src/adr/005-soft-delete-vs-erasure.md:27`, where Decision item 2 still names the
   converter. `EncryptedStringConverterTests.cs` anchors (`:24`, `:38`, `:82`, `:95`, `:226`) still hold.

## Revision (2026-10-26)
Re-verified against current source. Anchor-only refresh; no decision, rationale, trade-off or adoption
fact changed. The audit trail still redacts encrypted properties, the re-encryption suite still wires the
converter, and production adoption is still zero. The changelog and `UPGRADING.md` anchors inside the
2026-10-21 revision are left as recorded.
1. Anchors re-verified against current source: the audit-trail redaction check `IsRedacted` now runs
   `Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:637`
   through `:640` (the `EncryptedStringConverter` clause at `:640`), with the class-level remark still at
   `:56` through `:58`; the re-encryption suite is cited by its class declaration,
   `EncryptedStringConverterReEncryptionTests.cs:14`, with the test method at `:26` (`HasConversion` at
   `:84`, converters at `:90`, `:96` unchanged); the "Field encryption" bullet sits at `SECURITY.md:40` in
   Context and Related. `EncryptedStringConverter.cs:76` and `:143` still hold.

## Revision (2026-10-28)
Re-verified against current source. Anchor-only refresh; no decision, rationale, trade-off or adoption
fact changed. The audit trail still redacts encrypted properties and production adoption is still zero.
Every anchor inside a dated revision above (including `PublicAPI.Shipped.txt:1026` and the
`AuditTrailSaveChangesInterceptor.cs:639` in the 2026-10-21 revision, and the `:637` through `:640` in
the 2026-10-26 revision) is a point-in-time record and is left as recorded.
1. Anchors re-verified against current source: the audit-trail redaction check `IsRedacted` now runs
   `Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:638`
   through `:641` (the `EncryptedStringConverter` clause at `:641`, its XML doc at `:631` through `:637`),
   with the class-level remark still at `:56` through `:58`; the three live ADR-005 citations (Context,
   Trade-offs, Related) now point at `Website/docs-src/adr/005-soft-delete-vs-erasure.md:29`, where
   Decision item 2 still names `EncryptedStringConverter` for fields that must remain retrievable;
   `MarkForReEncryption` is now listed at
   `Source/Core/MMCA.Common.Infrastructure/PublicAPI.Shipped.txt:1011`; the "Field encryption" bullet
   still sits at `SECURITY.md:40`.
