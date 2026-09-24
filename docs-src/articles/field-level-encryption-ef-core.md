# Field-Level Encryption in EF Core: AES-GCM for PII Columns

> Series: MMCA.Common · Article #46 (deep-dive) · Pillar P3 · Group G07 · Rubric §11,§30 · ADR-037 ·
> Status: grounded in `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Encryption/EncryptedStringConverter.cs`,
> `MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Encryption/EncryptedStringConverterTests.cs`,
> `Website/docs-src/adr/037-field-level-encryption-at-rest.md`, and the rubric
> (`Website/docs-src/governance/ArchitectureEvaluationCriteria.md`, §11 and §30). Revised 2026-08-15 for
> MMCA.Common PR #247 (versioned ciphertext envelope plus key ring). No em dashes.

**Subtitle:** Transparent database encryption protects the file, then decrypts for anyone who can query
it. When a column holds data sensitive enough that a database reader should still see ciphertext, you
need a second layer: an AES-256-GCM EF Core value converter that encrypts a PII column per property,
formalized in ADR-037.

---

You turned on Transparent Data Encryption (TDE) and closed the "data at rest" line item. The database
files are encrypted, the backups are encrypted, the audit checkbox is green. Then a backup gets restored
onto a host it should never have touched, or an over-privileged reporting connection runs a `SELECT`, and
every email address, every phone number, every national ID comes back in plaintext.

That is not a TDE bug. That is TDE working exactly as designed. TDE encrypts the pages on disk and
decrypts them transparently for any principal that can open the database. Its threat model is a stolen
disk, not a stolen query. The moment a reader is inside the database boundary, the whole point of the
control has already been served, and the data is clear.

Some columns are sensitive enough to deserve a second, tighter boundary: the value should be ciphertext
the instant it leaves the application, so that only a holder of the application key, not merely a database
reader, can turn it back into text. In MMCA.Common that boundary is one EF Core value converter.

## Why it matters

The gap between "the database is encrypted" and "this column is protected" is where compliance findings
live. A PII inventory (rubric §30 asks for exactly this: what is collected, where it is stored, who can
access it) will list columns whose readership you cannot actually constrain to your application. A DBA, a
replicated read model, a support tool with a broad connection, a restored backup on a laptop: each is a
legitimate database reader, and under TDE alone each sees plaintext.

Rubric §11 makes the same demand from the attacker's side: data-at-rest protection and PII handling as a
correctness property, not a deployment afterthought. The two categories meet on one column. §11 defends
against whoever should not have the data; §30 answers to the regulator who asks where the data is and who
can read it. Field-level encryption is a single control that speaks to both, because it moves the trust
boundary from "can reach the database" to "holds the application key."

This is a distinct control from the two sensitive-data mechanisms the framework already records.
Password hashing (ADR-032) is deliberately one-way: a credential is stored so it can be verified, never
recovered. Erasure (ADR-005) removes or anonymizes personal data on a data-subject request. Neither
covers the case of a field that must stay retrievable in plaintext to the application yet be unreadable
in the database itself. That is the case ADR-037 answers: an at-rest, reversible, column-level
confidentiality control.

## The MMCA answer: one value converter, applied per property

The mechanism is `EncryptedStringConverter`, a sealed `ValueConverter<string, string>` in the
`MMCA.Common.Infrastructure.Persistence.Encryption` namespace. You attach it to a single property in an
EF entity configuration, and from that point on the property encrypts on write and decrypts on read.
Application code, domain code, DTOs, handlers: all of them keep working with an ordinary `string` and
never see ciphertext.

```csharp
// Wire the converter onto the sensitive column in the entity configuration.
// (Illustrative: the first HasConversion call is the converter's own documented usage,
//  the second paraphrases the key-ring constructor, and the layout comment
//  describes what Encrypt actually writes.)
builder.Property(e => e.SocialSecurityNumber)
    .HasConversion(new EncryptedStringConverter(encryptionKey)); // encryptionKey: 32 bytes

// The same converter over a ring of versioned keys, writing under version 2.
builder.Property(e => e.SocialSecurityNumber)
    .HasConversion(new EncryptedStringConverter(
        new Dictionary<byte, byte[]> { [1] = retiringKey, [2] = currentKey },
        currentKeyVersion: 2));

// On write, the stored value is Base64 of:
//   [key version (1)] [nonce (12)] [ciphertext (N)] [tag (16)]
// On read, the version byte picks the key, and the tag (which covers that byte) is verified.
```

Four properties of that converter are worth naming precisely, because they are the whole design.

**It is authenticated, not merely confidential.** Both directions use `AesGcm`, AES-256 in Galois/Counter
Mode, which binds a 128-bit authentication tag to the ciphertext. Encryption gives you confidentiality;
the tag gives you integrity for free. A value that has been tampered with, truncated, or corrupted fails
the tag check inside `AesGcm.Decrypt` and throws rather than silently returning garbage plaintext. The
converter also rejects, up front, any stored value too short to even hold a key version, a nonce and a
tag, throwing a `CryptographicException` before it ever calls into the primitive.

**Every key is exactly 256 bits, and the converter refuses anything else.** There are two constructors.
The single-key one takes a raw `byte[]`, null-checks it with `ArgumentNullException.ThrowIfNull`, and
throws `ArgumentException` unless the key is exactly 32 bytes (256 bits); it is sugar for a one-entry
key ring registered at version 1. The other takes an `IReadOnlyDictionary<byte, byte[]>` key ring plus
the version to write with, and validates the whole thing once at construction: the ring must be non-null
and non-empty, no entry may be null, every key must be exactly 32 bytes, and the nominated current
version must actually be present. The validated ring is then copied into a `FrozenDictionary`, so
mutating the dictionary you passed in cannot change which keys the converter uses afterwards. There is a
`GenerateKey()` helper that produces a cryptographically random 32-byte key via
`RandomNumberGenerator.GetBytes(32)` for initial setup. The envelope sizes are fixed constants: a 1-byte
key version, a 12-byte nonce (96 bits, the size NIST recommends for GCM) and a 16-byte tag (128 bits).

**The storage envelope is versioned and self-describing, and the ciphertext is non-deterministic.** On
write, `Encrypt` resolves the current key from the ring, takes the UTF-8 bytes of the plaintext, draws a
fresh random 12-byte nonce, runs `AesGcm.Encrypt`, then lays out
`[key version] [nonce] [ciphertext] [tag]` in one buffer and Base64-encodes it into the string column. On
read, `Decrypt` Base64-decodes, reads the version byte at position 0 to select the key, slices the three
remaining regions back out by their fixed offsets using spans, and calls `AesGcm.Decrypt`, which validates
the tag while decrypting. Because the nonce is fresh on every write, the same plaintext encrypts to
different ciphertext every single time. That is the correct confidentiality default: a deterministic
scheme would leak equality and frequency over the column, and this one does not.

**The version byte is authenticated, and that makes rotation a supported operation.** The version is not
merely stored next to the ciphertext, it is passed to AES-GCM as associated data on both encrypt and
decrypt, so the authentication tag covers it. Rewriting the version byte of a stored value therefore fails
the tag check instead of quietly redirecting decryption to a different key, and it fails even when the
substituted version happens to map to the same key: a test registers one key under two versions, flips the
byte, and still gets a `CryptographicException`. Because writes always stamp the current version while
reads take their key from the data, rotation is a four-step operation with no maintenance window: add the
new key to the ring and make it current while keeping the old version registered, deploy (new writes carry
the new version, existing rows keep decrypting under theirs), re-encrypt the old rows in the background at
whatever pace the table allows, then drop the retired version from the ring. A value whose version is no
longer registered throws a `CryptographicException` naming only the version number, never key material,
which is the loud failure rather than the silent one.

There is one deliberate passthrough: both directions short-circuit on a null-or-empty string, so a NULL
or empty column stays as-is rather than becoming a block of ciphertext for the empty string.

Where do the keys come from? Not from the framework. The converter takes raw key material as a
constructor argument, one `byte[]` or a whole ring, and stops there: no DI registration, no options type,
no key-provider abstraction in Infrastructure, and no automatic refresh, since the ring is frozen at
construction and adding a version means constructing a new converter. The adopting entity configuration
supplies the keys, and the converter's own XML documentation is explicit that they belong in Azure Key
Vault, user-secrets, or an environment variable, and never hardcoded. That lines up with rubric §11's
secrets criterion (in a vault or managed identity, never in source or plain config), and it keeps the
crypto primitive free of any opinion about your secret store.

It is also stateless and context-free on purpose. Version resolution is data-driven from the stored
envelope and never consults the `DbContext`, because a value converter is a pair of compiled expressions
running inside the provider's materialization path: it cannot reach the context, the current user, or any
ambient request scope. Per-tenant and per-request key selection are therefore deliberately out of scope
here; that shape wants a `SaveChanges` interceptor or application-layer encryption above EF Core, where
the request context is still reachable.

## The honest part: shipped, tested, latent

Here is what separates this from a "look what we built" post. This converter is not in production. Zero
columns across the four repositories are encrypted with it today. The plumbing is complete and the
encrypt/decrypt round-trip, the tag-validated integrity path, the 32-byte key guard on both construction
paths, the four ring-validation guards, the defensive copy of the caller's dictionary, the version byte
each write stamps, a full rotation round-trip, an unregistered version, a rewritten version byte, the
empty-string passthrough, and the too-short-ciphertext rejection are all exercised by
`EncryptedStringConverterTests` (21 cases), but no `*Configuration.cs` in
any repo calls `.HasConversion(new EncryptedStringConverter(...))`. ADR-037 records that posture in the
open: the capability is proven by tests, not by any deployed column.

That is deliberate. The framework's job is to decide the algorithm, the key size, the nonce size, and the
storage envelope once, in a single shared type, so that the first team to adopt it inherits a reviewed
primitive instead of hand-rolling AES-GCM in a module. ADR-005 already names this converter as the
mechanism for erasure fields "that must remain retrievable," so the pairing is designed and available. It
is not yet wired. Telling you that is the point: a security control you claim but have not adopted is
worse than one you have honestly labeled latent.

The zero-adoption posture is also what paid for the versioned envelope. A layout of nonce, ciphertext and
tag with no key identifier leaves the obvious question unanswered: what happens when the key has to
change. That answer belongs in the storage format rather than in a paragraph explaining the gap, which is
why the envelope leads with a key-version byte and the converter reads its key from the data. There is no
legacy-decode path and there will not be one: a value in an un-versioned form does not read back under
this converter, because its first byte is a nonce byte rather than a version. That break is free
precisely because no column stores one. The window in which a storage format is free to change closes at
the first adopted column, which is exactly why the format is settled now rather than after adoption.

## Column-level crypto vs TDE: the trade you are actually making

TDE and field-level encryption are not competitors; they are different threat models, and the honest
framing is when each earns its cost.

TDE is cheap, global, and transparent to queries. It encrypts everything at rest with no application
changes and no queryability loss, and it protects against exactly one thing: someone walking off with the
storage. If your risk is a stolen disk or an unencrypted backup, TDE is the whole answer.

Field-level encryption is targeted, and you pay for the targeting. It moves the trust boundary inside the
database, so a database reader without the application key sees ciphertext, but that same non-determinism
that makes it strong also makes the column unqueryable. You cannot equality-filter, index-seek, sort, or
join on an encrypted column, because the same plaintext never produces the same bytes twice. A field that
must be both encrypted and looked up needs a separate deterministic scheme or a blind index, and this
converter provides neither. It is the right control for a genuinely sensitive column the application
reads by primary key, not by the encrypted value itself. That is why the converter's own shipped usage
example targets a stored-only field rather than a login lookup: the XML documentation spells out that a
`Where` against an encrypted column compares to a ciphertext that will never match and returns no rows
silently, so encrypting an address the authentication flow queries by value would have broken sign-in
quietly instead of loudly.

## Trade-offs, honestly

- **Encrypted columns are not queryable.** The random nonce makes ciphertext non-deterministic, so there
  is no equality filter, index seek, sort, or join on an encrypted column. Encrypt the columns you read by
  key, not the ones you search by value.
- **Key management is still entirely yours; the ring is a mechanism, not a service.** The converter holds
  whatever key material you hand it, frozen at construction. There is no key-provider abstraction, no Key
  Vault integration, no automatic refresh, and no envelope encryption over a key-encryption key. Losing a
  key still makes every row written under that version permanently unrecoverable; the ring makes that
  failure mode more granular, not less likely.
- **Rotation is enabled, not automated.** The versioned envelope makes a zero-downtime rotation possible,
  but the re-encryption pass is yours to write and to run, and nothing in the framework reports how many
  rows still carry an old version. Retire a version early and every unconverted row throws on read: loud,
  but still an outage for that column. The version prefix is one `byte`, so a ring caps at 256 live
  versions, which is ample for annual or quarterly rotation and a real ceiling for anything faster.
- **Per-property wiring, not a global switch.** Encryption is one `HasConversion` call at a time in each
  entity configuration. A column that should be encrypted but is never wired stays silently plaintext, so
  the control is only as good as the audit of your PII inventory (which is why §30 wants that inventory in
  the first place).
- **Storage and CPU overhead.** Every value grows by 29 bytes (a 1-byte key version, a 12-byte nonce, and a
  16-byte tag) before Base64 inflation, and every read and write performs an AES-GCM operation.
- **Latent until adopted.** Proven by `EncryptedStringConverterTests`, not by production. The round-trip
  works; the decision to encrypt a specific column is still yours to make and to audit.

None of these are reasons to skip encrypting genuinely sensitive columns. They are the reasons to encrypt
deliberately: the columns you read by key, with a key lifecycle you have designed, tracked against a PII
inventory you actually keep.

## Apply this even without MMCA

The pattern ports to any EF Core codebase, and to most ORMs with a value-conversion or type-handler hook:

1. Use an **EF Core `ValueConverter<string, string>`** (or your ORM's equivalent) so encryption lives on
   the property mapping and the rest of the code keeps a plain `string`.
2. Choose an **authenticated cipher (AES-GCM)**, not a bare block mode, so integrity comes with
   confidentiality and tampering fails loudly instead of decrypting to garbage.
3. **Store the nonce with the ciphertext** in a self-describing envelope
   (`[key version][nonce][ciphertext][tag]`, Base64 into a string column) and draw a **fresh random nonce
   per write** so the same plaintext never repeats its ciphertext.
4. **Put a key version in the envelope on day one, and authenticate it.** Pass the version as associated
   data so the tag covers it: a self-describing envelope whose description can be rewritten is an
   invitation to rewrite it. One byte buys you both a rotation path and tamper detection on the version
   itself.
5. **Keep the keys out of the code.** Take them from a vault, managed identity, user-secrets, or an
   environment variable, and design the rotation drill (add the new version as current, deploy, re-encrypt
   in the background, retire the old version) before you encrypt the first column, because the format
   stops being free to change the moment a row uses it.
6. **Encrypt by threat model.** Column-level crypto is a second boundary above TDE for the few columns a
   database reader should never see in the clear, and you trade away queryability to get it.

The takeaway: **TDE protects the file from whoever steals the disk; field-level encryption protects the
column from whoever can run a query. Pick the columns you read by key, encrypt them with an authenticated
cipher, a fresh nonce per write, and an authenticated key version in the envelope, keep the keys in a
vault, and know going in that you are trading queryability for a trust boundary the database itself
cannot cross.**

---

**What we covered:** why TDE leaves a plaintext gap for any principal who can query the database, how
`EncryptedStringConverter` closes it per column with AES-256-GCM authenticated encryption, its
self-describing `[key version][nonce][ciphertext][tag]` envelope and non-deterministic ciphertext, the
key ring that makes a zero-downtime rotation possible and the authenticated version byte that keeps it
honest, the 32-byte key guard and vault-only key handling, the honest "shipped, tested, not yet adopted"
posture from ADR-037, and the trade of queryability for a trust boundary the database cannot cross.

**Previously:** Article 45, "Feature Flags in the CQRS Pipeline: Gate Commands, Not Code."

**Next in the series:** Article 47, "Security Headers and CSP for Blazor: One Middleware, Every Host,"
where the data-protection story moves from the column to the response.

*Full reading order: the MMCA.Common series index (Article 50).*

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the persistence chapter of the
onboarding guide, or `dotnet add package MMCA.Common.Infrastructure` and try it.*
- Repo: `https://github.com/ivanball/MMCA.Common`

*Tags: .NET, C Sharp, Encryption, Data Security, EF Core*

*Notes: all verified against source read on 2026-08-15, after MMCA.Common PR #247 (versioned ciphertext
envelope plus key ring) merged to `main`; the ADR-037 status citation was re-verified on 2026-08-19 against
its 2026-08-18 revision. Re-read in full on 2026-09-19 at MMCA.Common v1.205.0: every
`EncryptedStringConverter.cs` anchor below still resolves to the line it names, as does every `[Fact]`
anchor in the test file, and no body claim changed. Four citations were corrected in this pass: the test
file sits one level deeper than the previous revision recorded, under a `Persistence/Encryption/` folder;
the `SECURITY.md` field-encryption pointer moved from `:26` to `:36`; both rubric sections moved
(Security to `:353-376`, Compliance to `:799-804`); and the onboarding chapter has been regenerated to
7,191 lines, so the corroboration anchors at the end of this ledger were all re-derived against it.
`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/Encryption/EncryptedStringConverter.cs`:
sealed `EncryptedStringConverter : ValueConverter<string, string>` (`:72`); namespace
`MMCA.Common.Infrastructure.Persistence.Encryption` (`:6`); envelope constants `VersionSize = 1` (`:75`),
`NonceSize = 12`, 96-bit NIST-recommended nonce (`:78`), `TagSize = 16`, 128-bit tag (`:81`), `KeySize = 32`
(`:84`), `DefaultKeyVersion = 1` (`:87`). Two public constructors: the single-key `byte[]` one (`:94`),
which now delegates to a one-entry ring at version 1 (`:95`, ring built at `:137`) with
`ArgumentNullException.ThrowIfNull` (`:129`) and the exactly-32-bytes `ArgumentException` (`:130-135`); and
the key-ring one, `EncryptedStringConverter(IReadOnlyDictionary<byte, byte[]> keyRing, byte currentKeyVersion)`
(`:109`), which routes through `ValidateAndFreeze` (`:110`, `:146`): null ring (`:150`), empty ring
(`:152-155`), null entry (`:159-163`), every key exactly 32 bytes (`:166-171`), current version present in
the ring (`:174-179`), then `ToFrozenDictionary()` as the defensive copy (`:181`). The private constructor
captures the frozen ring in the two compiled expressions handed to the base converter (`:114-117`, encrypt
at `:116`, decrypt at `:117`). `GenerateKey() => RandomNumberGenerator.GetBytes(32)` (`:125`).
`Encrypt` short-circuits null-or-empty (`:186-187`), resolves the current key from the ring (`:190`),
`Encoding.UTF8.GetBytes` (`:192`), fresh random nonce (`:193`), passes the version byte as associated data
(`:198`), `new AesGcm(key, TagSize)` + `aes.Encrypt(nonce, plaintextBytes, ciphertext, tag, associatedData)`
(`:200-201`), lays out `[key version (1)][nonce (12)][ciphertext (N)][tag (16)]` (`:203-208`, version written
at `:205`), `Convert.ToBase64String` (`:210`). `Decrypt` short-circuits null-or-empty (`:215-216`),
`Convert.FromBase64String` (`:218`), length guard throws `CryptographicException` when shorter than version
plus nonce plus tag (`:220-221`), reads the version byte at position 0 (`:223`), throws
`CryptographicException` naming only the version when no key is registered for it (`:224-225`), slices
nonce/ciphertext/tag spans (`:227-230`), re-derives the associated data from the stored version byte
(`:231`), `new AesGcm(key, TagSize)` + `aes.Decrypt(..., associatedData)` (`:235-236`),
`Encoding.UTF8.GetString` (`:238`). XML doc: the `HasConversion` usage example on `SocialSecurityNumber`
(`:13-17`, property at `:15`, conversion at `:16`); the non-determinism constraint, no equality or range
predicate, no unique index, no server-side sort or group, "only apply it to properties that are read back
as part of an entity and never queried by value" (`:19-32`); keys in Azure Key Vault, user-secrets, or
environment variables, never hardcoded, every key exactly 32 bytes (`:33-37`); the Base64
version+nonce+ciphertext+tag storage format and the version byte as associated data covered by the tag
(`:38-44`); the key ring and the four-step zero-downtime rotation, with an unregistered version failing as
`CryptographicException` rather than decrypting to garbage (`:45-61`); stateless and context-free by
design, no `DbContext`, per-tenant or per-request key selection deliberately out of scope (`:62-70`). The
code block in the article is illustrative: the first `HasConversion` line is the converter's own documented
usage example, the second paraphrases the key-ring constructor signature at `:109`, and the layout comment
paraphrases `Encrypt`, not a verbatim source block.
`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/Encryption/EncryptedStringConverterTests.cs`: 21
`[Fact]` cases (`:6` class). Pre-existing eleven: round trip (`:10`), distinct plaintexts differ (`:24`),
same plaintext differs on re-encrypt (`:38`), `GenerateKey` returns 32 bytes (`:52`) and differs each call
(`:61`), invalid key length (`:71`), empty-string passthrough on encrypt (`:82`) and decrypt (`:95`),
too-short ciphertext (`:108`, whose comment now reads "28 bytes total is too short for version (1) + nonce
(12) + tag (16)", `:114`), null key (`:123`), Unicode round trip (`:129`). Ten added by PR #247: the
single-key constructor stamps version 1 (`:145`), key-ring round trip (`:157`), rotation round trip where
pre-rotation ciphertext stays readable and new writes carry version 2 (`:175`), unregistered version throws
with "*key version 1*" (`:205`), tampered version byte throws even with the same key registered under both
versions (`:226`), and the ring guards: null ring (`:244`), empty ring (`:250`), current version missing
(`:259`), wrong key length in an entry (`:268`), plus the defensive copy against caller mutation (`:281`).
`Website/docs-src/adr/037-field-level-encryption-at-rest.md`: status "Accepted (2026-07-06; revised
2026-07-24, 2026-07-25, 2026-08-15, 2026-08-18)" (`:4`), the 2026-08-18 revision recording that the
versioned-envelope converter is no longer unpublished, it merged via PR #247 and is included in v1.153.0
(tagged 2026-08-18), while adoption stays at zero (`:288-292`); TDE-vs-column framing (`:6-12`); distinction from ADR-032
password hashing and ADR-005 erasure (`:14-21`); sealed converter applied per property via `HasConversion`
(`:34-41`); AES-256-GCM and the fixed envelope sizes (`:43-52`); the versioned self-describing envelope
(`:54-67`); the key ring with one version current, its validation and its defensive freeze (`:69-82`); the
version byte as authenticated associated data (`:84-90`); non-deterministic ciphertext, not queryable
(`:92-96`, `:181-184`); empty and null passthrough (`:98-100`); key management as the consumer's, no DI,
options type, or key-provider abstraction (`:102-109`); stateless and context-free, per-tenant selection
out of scope (`:111-119`); unit-tested but zero adopted columns (`:23-28`, `:121-140`, `:175-180`); rotation
enabled but not automated, and the 256-version cap of a one-byte prefix (`:192-197`, `:198-202`); 29-byte
overhead = 1-byte version plus 12-byte nonce plus 16-byte tag (`:206-208`); the format break being free
only while adoption is zero (`:159-162`); the 2026-08-15 revision itself, including "there is no legacy
decode path" (`:247-288`, no-legacy-path paragraph `:262-268`, test count 11 to 21 at `:282-285`, PR #247
at `:287-288`); and the 2026-08-18 revision, which records the versioned envelope and key ring as included
in the published v1.153.0 package (tagged 2026-08-18) while reaffirming "Adoption is unchanged at zero: no
entity configuration in any of the four repositories wires the converter" (`:288-292`). Rubric
`Website/docs-src/governance/ArchitectureEvaluationCriteria.md`: section 11, Security, heading at `:353`,
primary, with "Secrets in a vault/managed identity, never in source or plain config" at `:360` and
"Transport security (TLS), data-at-rest protection, PII handling, and least-privilege access" at `:362`,
default weight 3 at `:376`; section 30, Compliance, Privacy & Data Governance, heading at `:799`, whose
intent line draws the same split this article does ("section 11 defends against attackers; this answers to
regulators", `:801`) and whose first criterion is the "PII/sensitive-data inventory: what's collected,
where it's stored, who can access it" at `:804`. `MMCA.Common/SECURITY.md:36` lists "Field encryption:
AES-256-GCM via `EncryptedStringConverter` for sensitive columns" as the reader-facing pointer this ADR
backs.
Corroborating chapter, re-derived 2026-09-19 against the regenerated
`Website/docs-src/onboarding/group-07-persistence-ef-core.md` (7,191 lines), which describes the same
versioned envelope as this article. Its "Encryption, seeding, design time, and the shared helpers" section
(`:867`) carries a one-line prose pointer to the converter on the class anchor `:72`, naming the versioned
Base64 envelope of one-byte key version, random 12-byte nonce, ciphertext and 16-byte tag (`:869-872`); the
full walkthrough lives in the `### EncryptedStringConverter` catalog entry, which starts at `:5493` on that
same class anchor. The entry gives the self-describing envelope, the 29 bytes of overhead before Base64
inflation, the key ring with one version current, the four-step rotation, and the version byte as
authenticated associated data (`:5520-5533`, citing `:38-44`, `:203-208`, `:75`, `:78`, `:81`, `:109`,
`:116`, `:205`, `:223-224`, `:45-61`, `:198`, `:231`); the fixed sizes and `DefaultKeyVersion` (`:5535-5538`,
citing `:75`, `:78`, `:81`, `:84`, `:87`); both public constructors over the one private one, plus
`ValidateAndFreeze` with its four guards and its defensive freeze (`:5539-5552`, citing `:94-97`, `:109-112`,
`:114-119`, `:95`, `:127-138`, `:129`, `:130-135`, `:146-182`, `:150`, `:152-155`, `:159-164`, `:166-171`,
`:174-179`, `:181`); the 21 unit tests together with the zero-adoption statement that no entity
configuration calls `HasConversion(new EncryptedStringConverter(...))` in any of the repos and no DI
registration supplies a key or a ring (`:5580-5595`); and the "no legacy decode path" caveat naming
v1.153.0 (`:5596-5601`). It therefore corroborates the versioned-envelope behavior as well as the parts
that did not change (AES-256-GCM, the 12-byte nonce and 16-byte tag, the non-determinism constraint, the
unadopted posture).
Not determinable from source: any live production adoption (there is none as of ADR-037's 2026-08-18
revision, and no `*Configuration.cs` in any of the four repositories calls
`.HasConversion(new EncryptedStringConverter(...))`),
any envelope encryption over a key-encryption key, any key-provider or Key Vault integration, and any
framework-side re-encryption or version-inventory tooling (all out of scope per ADR-037).*

- Full series index: https://ivanball.github.io/writing.html
