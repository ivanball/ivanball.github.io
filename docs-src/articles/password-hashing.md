# Password hashing done right: PBKDF2-SHA512, a versioned work factor, timing-safe

> Series: MMCA.Common · Article #17 · Pillar P2/P4 · Group G08 · Rubric §11 · ADR-133 ·
> Status: grounded in `Website/docs-src/onboarding/group-08-auth.md`, `MMCA.Common/AGENTS.md`,
> `Website/docs-src/adr/133-versioned-password-hash-work-factor.md` (which supersedes ADR-102), and `Website/docs-src/governance/common-ArchitectureScorecard.md` (§11). No em dashes.

**Subtitle:** Storing a password is a solved problem, and almost every breach headline is someone who
solved it the wrong way. Here are the four decisions that separate a hash you can defend from one that
leaks every account the day your database does.

---

The single most damaging line of code in a lot of .NET apps is shorter than this sentence:

```csharp
user.PasswordHash = Sha256(password);   // looks responsible. is not.
```

It looks responsible. It is not a plaintext password, after all. But SHA-256 is a *fast* hash, designed
to digest gigabytes per second, and that speed is exactly the problem. The day your `Users` table
leaks, an attacker with a commodity GPU runs billions of those hashes per second against a wordlist and
recovers most of your users' passwords before lunch. No salt means identical passwords share a hash, so
they only have to crack each distinct password once. You did not store plaintext, but you stored
something an attacker turns into plaintext at scale.

Password storage is a solved problem. The breach headlines are almost always someone who solved it the
wrong way: a fast hash, no salt, a hand-rolled comparison, or a homegrown scheme that "looked secure."

## Why it matters

A leaked password table is not just a breach of your app. People reuse passwords. The credentials you
fail to protect become the keys an attacker tries against their bank, their email, their employer. The
threat model for a password hash is not "keep it secret" (you cannot, your database will eventually be
read by someone it should not be). The threat model is: **assume the hashes are stolen, and make
recovering the original passwords economically infeasible anyway.**

That reframes the whole job. You are not hiding the password. You are making each guess expensive
enough that brute force does not pay, and making the storage shape leak nothing extra (not which
passwords are identical, not how many bytes of a guess were right).

## The MMCA answer: a deliberately slow KDF, salted, compared in constant time

MMCA.Common ships one production password hasher, split the Clean-Architecture way: the
`IPasswordHasher` port sits in `MMCA.Common.Application` and its single `PasswordHasher`
implementation in `MMCA.Common.Infrastructure`. It makes the right call on every axis:

- **PBKDF2-HMAC-SHA512 at 210,000 iterations for every new hash.** The hasher's own documentation
  gives 210,000 as the OWASP Password Storage Cheat Sheet figure for PBKDF2-HMAC-SHA512 (600,000 is the
  cheat sheet's figure for PBKDF2-HMAC-SHA256). PBKDF2 is a *key derivation function*: a deliberately
  expensive hash. Two hundred ten thousand iterations means each guess against a new hash costs the
  attacker 210,000 HMAC-SHA512 operations, not one. That turns "billions of guesses per second" into a
  rate where offline brute force against a strong password stops being worth the electricity.
- **A 32-byte cryptographically random salt per password, and a hash that records its own work
  factor.** The PBKDF2 digest is 64 bytes, and the stored hash is 69: a `0x01` version byte, the
  iteration count as a 4-byte big-endian integer, then the digest. The salt means two users with the
  same password get different hashes, so an attacker cannot crack once and apply everywhere, and
  precomputed rainbow tables are useless.
- **Constant-time comparison.** Verification ends with `CryptographicOperations.FixedTimeEquals`, which
  always compares the full length regardless of where the first mismatch is.

```csharp
// HashPassword: 32-byte random salt, PBKDF2-HMAC-SHA512 at 210,000 iterations, and a 69-byte hash
// laid out as [0x01 version][4-byte big-endian iterations][64-byte digest].
(byte[] Hash, byte[] Salt) HashPassword(string password);

// VerifyPassword derives at the count the stored hash carries, then compares the trailing
// 64 bytes with a timing-safe compare, never a == or SequenceEqual:
var expected = hash.AsSpan(hash.Length - HashSize);
return CryptographicOperations.FixedTimeEquals(computedHash, expected);

// NeedsRehash: true when a hash that just verified is in an older format or carries another count.
bool NeedsRehash(byte[] hash);
```

(Source: `PasswordHasher.cs` and the password section of `Website/docs-src/onboarding/group-08-auth.md`.)

Those parameters are not a convention held in place by code review. They are build-failing checks.
Known-answer tests recompute the digest independently with PBKDF2-HMAC-SHA512 and a 64-byte output:
at 210,000 iterations for a new hash, whose version byte and stored count they check byte by byte, and
at 600,000 for a header-less legacy hash, so a lowered work factor, a swapped algorithm or a truncated
digest stops matching. One test stores a count of 300,000 and asserts it verifies and is reported for
rehash, and a bounds theory rejects stored counts of 99,999, 2,000,001, 0 and -1 and version bytes
`0x00` and `0x02`. A negative known-answer test derives a header-less digest at 100,000 iterations and
asserts verification rejects it, which proves the work factor really participates rather than sitting
in a comment. Reflection reads four private constants straight off the type and pins them (the
210,000 current count, the 600,000 legacy count, the 32-byte salt and the 64-byte digest), so lowering
one fails the build instead of silently shipping. And an architecture rule reads the compiled type and fails the build if it stops
depending on `Rfc2898DeriveBytes` (the slow key derivation function) or on `CryptographicOperations`
(the class that holds the fixed-time comparison), so a rewrite that swapped PBKDF2 for a raw SHA-512
cannot merge even if it kept the same output length. That second rule pins the class, not the method:
`FixedTimeEquals` is the hasher's only use of `CryptographicOperations`, so swapping it for
`SequenceEqual` fails the build, but a rewrite that kept some other call on that class would not.

### Why constant-time matters more than it looks

The naive comparison `computed == stored` returns as soon as it finds the first differing byte. That
is a **timing side channel**: an attacker who can measure response time learns *how many leading bytes
matched*, and can recover a secret byte by byte, turning an astronomically large search into a linear
one. `FixedTimeEquals` always touches the full length, so the time it takes reveals nothing about how
close a guess was. You never write your own equality check on secret material. The BCL has the
timing-safe primitive precisely so you do not have to.

### One algorithm, two stored shapes, and a guard on the material

The hasher stores `(byte[] Hash, byte[] Salt)`, and the hash carries its own work factor. A 69-byte
hash opens with the version byte and the iteration count it was derived with. A bare 64-byte hash is
the legacy header-less format, which the verifier reads as 600,000 iterations. Only the algorithm lives
in code: PBKDF2-HMAC-SHA512 is the only supported algorithm, so nothing about a stored row selects a
primitive. Verification opens by accepting exactly the two shapes this hasher writes, a 32-byte salt
with either a 64-byte legacy hash or a 69-byte hash whose version byte is `0x01` and whose count lies
between 100,000 and 2,000,000 inclusive, and rejects everything else. It then derives at that count and
compares against the trailing 64 bytes. The bounds are part of the guard: the floor stops a tampered row
from lowering the cost of guessing its password, and the ceiling caps the work one verification can be
made to do, so a tampered row cannot turn a sign-in into a CPU denial of service. The shape check is the
interesting part. A hasher that takes its output length from the stored hash turns a row holding an
empty hash and an empty salt (the shape an external-OAuth account carries, ADR-036) into an empty
derivation compared against an empty span, which a fixed-time comparison answers true for, so any
password authenticates it. This one always derives a 64-byte digest and checks the material's shape
before it slices the stored hash, and the login path screens out an account with no stored credential
before it ever calls the verifier. Material this hasher never produced verifies nothing.

Two stored shapes is a deliberate trade, and the explicit version marker is what keeps it safe. A
verifier that picks its behavior from an implicit data property (the stored salt length, say) lets the
credential table decide what runs, with no way to tell which path a given login took. Here each shape
says what it is: a header-less 64-byte hash is the legacy format at 600,000 iterations, and a versioned
hash states its version and its count, bounded at both ends. Both run the same PBKDF2-HMAC-SHA512
primitive, so the format changes the cost, never the algorithm, and a credential in any third shape
fails rather than authenticating. In apps that opt in, old records leave the legacy shape on their
owner's next sign-in.
After the tokens are issued, `AuthenticationServiceBase` asks `IPasswordHasher.NeedsRehash` whether the
hash that just verified is the legacy shape or carries a count other than the current one; if so, it
re-derives the hash from the plaintext in hand and saves it on its own, best effort, so a failed save
never fails a sign-in that already succeeded. That upgrade is opt-in per application: it runs only when
the app's `User` implements `IPasswordRehashableUser`, whose `RehashPassword` stays apart from
`ChangePassword` so a rehash raises no password-changed event. ADC and Store opt in; Helpdesk holds no
password material. In an app that does not opt in, legacy records keep verifying at 600,000 and are
never upgraded. `NeedsRehash` is a default interface member answering false, so a custom hasher
compiles unchanged and never triggers a rehash. Changing the algorithm itself stays cheap because it
sits behind `IPasswordHasher`: the registration is a single Infrastructure line, and the application
handlers never name a password-hashing primitive.

The login path's timing defense goes through the same interface. To keep an unknown address from
answering faster than a wrong password, it hashes the submitted password once and discards the result,
so that throwaway call costs whatever the registered hasher costs and follows any replacement without a
matching change. That burn costs the current work factor, though. A wrong password against a record
still on an older factor (a legacy 600,000-iteration hash) costs that older amount, so until the record
is rehashed, an unknown address answers faster than a wrong password against it. Rehash-on-login closes
that gap one sign-in at a time, and only in an app that opts in.

## Defense in depth: PII at rest, not just passwords

Passwords are the famous case, but they are not the only personal data sitting in your database.
MMCA.Common ships field-level PII encryption as a separate control, recorded in its own decision
record (ADR-037): `EncryptedStringConverter` is an EF Core value converter that encrypts a column with
**AES-256-GCM** transparently on the way to the database and decrypts on the way out. GCM is
authenticated encryption, so it protects confidentiality *and* detects tampering. It is the framework
capability the erasure design (ADR-005) provides for fields a service chooses to keep retrievable for
legitimate use after anonymization, encrypted at rest rather than overwritten. (It is a shipped,
unit-tested converter that only test harnesses map and no production entity configuration in any of
the four repositories wires, so zero production columns are encrypted; the consumer apps overwrite every PII field on anonymization.
ADR-037 records the extension point and is explicit about that latent posture.)

The whole pipeline is held to the same enforcement bar as the rest of the framework: **all five
analyzers run at error severity** with `TreatWarningsAsErrors` globally, and a couple of them
(SonarAnalyzer and Meziantou) carry security-relevant rules. The security category (§11) scored
**Maturity 4 / Implementation 8** on the framework's two-axis rubric (Maturity 0-4, Implementation
0-10), on the strength of JWT algorithm pinning, the PBKDF2 password hasher,
permission-based server-side authorization, and rate limiting (brute-force protection applies
exponential-backoff lockouts and clears the counter on success). The field-encryption converter is not
part of that credit: the scorecard entry lists it as shipped but latent.

## Trade-offs, honestly

A credible security post owns its rough edges, and a few sit around this hash rather than in it.

- **Plain-HTTP metadata discovery is an opt-out, not a default.** `AddForwardedJwtBearer` resolves
  `RequireHttpsMetadata` from an explicit argument, then an
  `Authentication:JwtBearer:RequireHttpsMetadata` config key, then `true` everywhere except
  Development, and logs one startup warning when a deployment opts back out (both production apps do,
  because their authority is an internal-ingress cleartext URL, and their deployment templates say so
  beside the setting). Permissive dev CORS is a development affordance in the code, not a
  recommendation for what you run in production.
- **Iteration counts are a moving target.** New hashes use 210,000 PBKDF2-SHA512 iterations, the
  figure the hasher documents as OWASP's for that primitive, and that guidance ratchets up with
  hardware. Here it is a private constant pinned by a test, not a setting. Because each hash stores its
  own count, raising the constant re-derives records on their next sign-in rather than locking them
  out, but only where the `User` opts in through `IPasswordRehashableUser`; elsewhere a record keeps
  verifying at the count it was written with. A new count outside the accepted 100,000 to 2,000,000
  window also needs the bounds moved, or the hashes it writes would verify nothing. Revisit it anyway,
  and prefer a memory-hard KDF (Argon2id) when you can, which is exactly why the algorithm lives behind
  an interface here.

The current §11 entry itself names three reasons it holds at Implementation 8: the rubric's
threat-model criterion is unmet, authorization is RBAC with a capability layer plus opt-in ownership
checks rather than a full resource- or attribute-based policy engine, and the failed-login counter
behind the brute-force lockout is documented as non-atomic. It also records that service-to-service
trust is met only in part: a broker consumer restores user identity and tenant from unsigned message
headers, in-cluster gRPC forwards the user token over cleartext HTTP/2, and the opt-in service token
beside it is HS256 over one key every service shares (only Store adopts it). Tenant resolution defaults
to the signed claim, with a request header as an explicit opt-in. All of it sits
upstream of the hash, and none of it undermines the storage scheme. They are the operational and governance work that surrounds a correct
hash.

## Apply this even without MMCA

The rules port to any stack, and they are short enough to memorize:

1. **Never store plaintext, and never use a fast hash** (MD5, SHA-1, plain SHA-256/512) for passwords.
   Use a purpose-built KDF: Argon2id if available, otherwise PBKDF2-HMAC-SHA512 or bcrypt/scrypt.
2. **Tune the work factor to current guidance** (the OWASP Password Storage Cheat Sheet publishes a
   figure per hash function; this hasher derives new hashes at 210,000 PBKDF2-SHA512 iterations),
   store the count with each hash so you can raise it without locking anyone out, and revisit it as
   hardware improves.
3. **Salt every password** with a per-user cryptographically random value. The salt does not need to be
   secret; it needs to be unique.
4. **Compare in constant time.** Use your platform's timing-safe primitive
   (`CryptographicOperations.FixedTimeEquals` in .NET), never `==` or a default sequence equality on
   secret bytes.
5. **Never roll your own crypto.** Lean on the BCL/library primitives, and put the algorithm behind an
   interface so you can migrate without a flag day.
6. **Encrypt other PII at rest** with authenticated encryption (AES-256-GCM), and keep your analyzers
   at error severity so a careless `== ` on a secret never merges.

The takeaway: **assume the hashes will be stolen, and make every guess expensive and every comparison
constant-time anyway.** Everything else is detail.

---

**What we covered:** why a fast unsalted hash is the breach you ship on purpose, how PBKDF2-SHA512 at
210,000 iterations with a per-password salt and a `FixedTimeEquals` compare makes stolen hashes
uneconomical to crack, how known-answer tests and an architecture rule keep those parameters
build-failing invariants, why one PBKDF2 primitive over two explicitly marked shapes plus a
canonical-material guard means a credential row in any other shape authenticates nobody, how
rehash-on-login moves legacy records to the current work factor in the apps that opt in, how
AES-256-GCM field encryption via `EncryptedStringConverter` extends the same care to other PII, and the
honest trade-offs (the HTTPS-metadata opt-out, an iteration count that ratchets with hardware, and an
unknown-address burn that costs the current factor).

**Next in the series:** idempotency in one attribute, so a client that retries a write gets the first
response replayed instead of a duplicate.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the §11 scorecard entry, or
`dotnet add package MMCA.Common.Infrastructure` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 The §11 security entry lives in `Website/docs-src/governance/common-ArchitectureScorecard.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, Security, Cryptography*

*Notes (re-verified 2026-10-29 against MMCA.Common v1.265.1 for every password-hashing anchor; the
field-encryption, scorecard, JWT-metadata and CORS anchors were last re-read
2026-10-22 at v1.250.0; previous passes 2026-10-08 at v1.233.0 and 2026-10-02 at v1.221.0).
2026-10-29 entry (v1.265.1): STRUCTURAL REGROUND onto ADR-133
(`Website/docs-src/adr/133-versioned-password-hash-work-factor.md:4`, Accepted 2026-10-23, supersedes
ADR-102, which now carries a Superseded banner at `102-pbkdf2-only-password-hashing.md:4`; the change
shipped in v1.252.0 per ADR-133 `:5-6`). `PasswordHasher.cs` is now 148 lines. DRIFTED, REWRITTEN: the
H1 dropped "600k" for "a versioned work factor"; new hashes use `Iterations = 210_000` (`:34`, OWASP
SHA-512 figure with 600,000 named as the SHA-256 one at `:9-11`, `:31-32`); 600,000 survives only as
`LegacyIterations` (`:37`) for header-less 64-byte hashes (`:16-17`, read at `:124-128`); the stored hash
is 69 bytes `[0x01][4-byte BE iterations][64-byte digest]` (`:14-15`, `FormatVersion` `:40`,
`HeaderSize = 5` `:43`, `VersionedHashSize` `:46`, written at `:68-71`); the stored count is bounded by
`MinIterations = 100_000` (`:52`, rationale `:48-51`) and `MaxIterations = 2_000_000` (`:58`, rationale
`:54-57`) in `TryReadIterations` (`:122`, version check `:130`, bounds `:133`, reject `:136-137`); the
guard is `:90` (rationale `:83-89`), the compare runs on the trailing `HashSize` bytes (`:95`) after a
derive at the stored count (`:96`) via `FixedTimeEquals(computedHash, expected)` (`:100`); `NeedsRehash`
`:109-115` (remarks `:104-108`). The "one path" trade-off paragraph was rewritten around the versioned
format and rehash-on-login: `IPasswordHasher.NeedsRehash` default `=> false`
(`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/IPasswordHasher.cs:28`, doc
`:20-25`); `IPasswordRehashableUser` (`Source/Core/MMCA.Common.Domain/Auth/IPasswordRehashableUser.cs:16`);
`AuthenticationServiceBase.RehashPasswordIfNeededAsync`
(`Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:676`, summary `:658-662`,
best-effort remarks `:664-672`, opt-in check `:678`, `NeedsRehash` `:688`, `HashPassword` `:693`,
`RehashPassword` `:694`), called at `:237` after issuance at `:230`; a wrong password returns from the
verify at `:178`. Opt-ins: `MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:36`
(`RehashPassword` `:442`) and `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/User.cs:30`
(`RehashPassword` `:205`); Grep for `IPasswordRehashableUser|IPasswordHasher|PasswordHash` over
`MMCA.Helpdesk/Source/**/*.cs` returned 0. DRIFTED, EXTENDED: the burn caveat.
`BurnPasswordVerificationCost` (`AuthenticationServiceBase.cs:648-656`, discard `:655`, call site
`:172`) costs the current work factor, and its remarks (`:642-646`) state a record on an older factor
costs that older amount until rehashed. DRIFTED, REWRITTEN: the tests paragraph (four reflected
constants, not three; KATs at both counts; bounds theory) and the trade-offs bullet (raising the
constant upgrades opted-in records on sign-in; the window bounds a new count). The OWASP "at or above"
hedge was replaced by attributing the figure to the hasher's own documentation (`PasswordHasher.cs:9-11`).
Header ADR re-pointed from ADR-102 to ADR-133. Verifier follow-ups (same day): the empty-material
hazard is restated as that of a hasher taking its output length from the stored hash (this one
derives `HashSize` always, `PasswordHasher.cs:141-147`, and checks shape before slicing at `:90`,
`:95`; login screens empty material first, `AuthenticationServiceBase.cs:170`, `:627-628`); the
section 11 credit no longer names an ADR, because `common-ArchitectureScorecard.md:75` still describes
the ADR-032 form at 600k; "hashing primitive" narrowed to "password-hashing primitive" (other SHA256
uses exist, e.g. `IdempotencyFilter.cs:550`); "Today ... yet ... still" dropped from the converter
sentence; rehash upgrade scoped to opted-in apps (`AuthenticationServiceBase.cs:678`). RE-ANCHORED:
ADR-005 `:27` to `:29`; `LoginProtectionService.cs` non-atomic `:78-86` to `:79-87`, backoff `:102` to
`:104` (`:98-104`), reset `:117-118` to `:119-120`, success call `AuthenticationServiceBase.cs:207` to
`:224`; bicep as at the end. 2026-10-22 entry (v1.250.0):
`PasswordHasher.cs` body unchanged (75 lines; every `PasswordHasher.cs` and test anchor below still
holds). DRIFTED, REWRITTEN: the "one coupling survives the interface" sentences.
`AuthenticationServiceBase.BurnPasswordVerificationCost`
(`Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:623-631`, remarks `:615-622`,
call site `:155`) now discards `passwordHasher.HashPassword(password)` at `:630`, with no fixed decoy
material, so the cost tracks whichever hasher is registered and the size coupling is gone (ADR-102
revision 2026-10-21 at `102-pbkdf2-only-password-hashing.md:11`); the body says the burn goes through
the same interface. DRIFTED, REWORDED: "no entity configuration in any of the four repositories wires"
the converter now reads "only test harnesses map and no production entity configuration ... wires",
because `Tests/Core/MMCA.Common.Infrastructure.Tests/Persistence/AuditTrail/AuditTrailTestHarness.cs:264`
and the re-encryption suite map it (ADR-037 revision 2026-10-21 at `037-field-level-encryption-at-rest.md:7-9`,
production adoption zero at `:155-159`). DRIFTED, REWRITTEN: the section 11 trust sentence. The row
(`Website/docs-src/governance/common-ArchitectureScorecard.md:75`, still 3 / 4 / 8 / 12/24) now reads
"Service-to-service trust is met only in part", adds the opt-in HS256 service token on one shared key
adopted only by Store, and records claim-only tenant resolution (`TenancySettings.cs:61-62`,
`DefaultResolutionOrder = [TenantResolutionStrategy.Claim]`, header opt-in), so the tenant-header clause
was dropped. UNVERIFIED and left as written: "the consumer apps still overwrite every PII field on
anonymization" (only zero converter usage under ADC, Store and Helpdesk was confirmed) and the OWASP
"at or above" hedge (external fact). RE-ANCHORED below: `DependencyInjection.cs` `:315` to `:320`;
ADR-005 `:25` to `:27`; ADR-037 item 10 `:123` to `:131`, zero adoption `:137-142` to `:155-159`;
ADR-102 revisions `:5-8` to `:5-11`; `AesGcm` `:200`, `:235` to `:230`, `:265`; nonce `:78` to `:82`;
tag `:81` to `:85`; key guards `:130`, `:166` to `:160-163`, `:196-199`; envelope `:203-208` to
`:233-238`, documented `:38-44` to `:40-44`; `AGENTS.md` `:131` to `:132`; gRPC h2c `:95` to `:97-101`;
`ConsumerOriginRestore.cs` `:50` to `:44` (user id) and `:55` (tenant); `TenancySettings.cs` `:56` to
`:61-62`; bicep anchors as listed at the end. 2026-10-08 entry (v1.233.0): `PasswordHasher.cs` body
unchanged (75 lines, anchors below still hold). REWORDED: "each guess costs 600,000 SHA-512 operations"
now reads "600,000 HMAC-SHA512 operations" (one PBKDF2 iteration is one HMAC-SHA512 over
`HashAlgorithmName.SHA512`, `PasswordHasher.cs:36`, `:73`). HEDGED (external fact, not settleable
in-repo): "matches / is OWASP 2023 guidance" and the checklist's "600k+ PBKDF2-SHA512 at the time of
writing" now say "at or above" and point readers at the OWASP cheat sheet's per-hash figure; the only
in-repo support is the code comment `PasswordHasher.cs:21`, and the audit reports the cheat sheet's
600,000 figure as its PBKDF2-HMAC-SHA256 value with a lower SHA-512 value, which would make 600,000
above guidance rather than equal to it. NARROWED: the Argon2id swap is no longer called a pure
registration change; `AuthenticationServiceBase.BurnPasswordVerificationCost`
(`Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:615-625`, call site `:155`)
then ran `VerifyPassword(password, new byte[64], new byte[32])` (superseded, see the 2026-10-22 entry), which only paid the full
derivation cost because `PasswordHasher.cs:55` accepts exactly that shape (it still does). EXTENDED: the section 11 row
(`Website/docs-src/governance/common-ArchitectureScorecard.md:75`, still 3 / 4 / 8 / 12/24, re-scored
by Website #244 on 2026-10-07) keeps the same three hold-at-8 reasons and adds "Service-to-service and
tenant trust is met only in part" (unsigned `MMCA-*` headers restored at
`Infrastructure/Messaging/Consumers/ConsumerOriginRestore.cs:44`, `:55`, cleartext h2c JWT forwarding
`Grpc/DependencyInjection.cs:97-101`, then a default `[Claim, Header]` tenant order, since replaced by `[Claim]`
`Infrastructure/Persistence/Tenancy/TenancySettings.cs:61-62`), so the trade-offs paragraph names it.
RE-ANCHORED in place below: `DependencyInjection.cs` `:314` to `:315`; ADR-005 `:23` to `:25`; ADR-037
item 10 `:122` to `:123` and zero adoption `:136-141` to `:137-142`; `LoginProtectionService.cs`
non-atomic `:55` to `:78-86`, backoff `:77` (`:71-78`) to `:102` (`:98-103`), reset `:85-86` to
`:117-118` (called on success at `AuthenticationServiceBase.cs:207`); the Authentication partial and
CORS and bicep anchors as listed at the end.
Port and adapter: `IPasswordHasher` in `MMCA.Common.Application` (namespace
`MMCA.Common.Application.Interfaces.Infrastructure.Auth`,
`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/IPasswordHasher.cs:1`, interface at
`:6`); the single `PasswordHasher` in `MMCA.Common.Infrastructure` (namespace
`MMCA.Common.Infrastructure.Auth`, `Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:5`,
class at `:22`), registered by `TryAddSingleton<IPasswordHasher, PasswordHasher>`
(`Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:335`). Behavior as of v1.265.1:
PBKDF2-HMAC-SHA512 (`HashAlgorithmName.SHA512` inside `ComputePbkdf2Hash` at `:141-147`, the only
derive path, called from `HashPassword` `:66` and `VerifyPassword` `:96`), `Iterations = 210_000` (`:34`,
a private const), `LegacyIterations = 600_000` (`:37`), `SaltSize = 32` (`:25`, drawn at `:65`),
`HashSize = 64` (`:28`), the versioned layout and bounds as in the 2026-10-29 entry, class doc "PBKDF2 is
the only supported algorithm" (`:11-12`); the type is 148 lines with no legacy HMAC branch. ADR:
`Website/docs-src/adr/133-versioned-password-hash-work-factor.md` (Accepted 2026-10-23, supersedes
ADR-102 at `:4`, revised 2026-10-26 and 2026-10-28 at `:9-12`; Decision bullets `:48-75`, rehash
`:76-100`, burn `:101-104`, opt-ins `:105-114`). Tests:
`Tests/Core/MMCA.Common.Infrastructure.Tests/Auth/PasswordHasherSecurityTests.cs` pins
`210_000`, `600_000`, 32, 64, 69 and `0x01` (`:23-28`); accepts a legacy digest at 600,000 (`:34`) and a
versioned one (`:53`); checks `HashPassword` byte by byte against an independent known answer (`:67`);
honors a stored 300,000 and reports it for rehash (`:86-96`); rejects counts 99,999, 2,000,001, 0 and -1
and versions `0x00` and `0x02` (`:98-105`) and a header-less digest at 100,000 (`:121-136`); reflects
`Iterations` (`:141`), `LegacyIterations` (`:147`), `SaltSize` (`:153`) and `HashSize` (`:159`) via
`ReadPrivateConstant` (`:256`); rejects a legacy HMAC digest (`:164`), an empty hash and salt (`:180`),
ten non-canonical length pairs (`:184-195`) and a valid header over an odd salt (`:209`);
`Tests/Core/MMCA.Common.Infrastructure.Tests/Auth/PasswordHasherTests.cs` holds 11 `[Fact]` + 2
`[Theory]`. NARROWED (2026-10-02): the fitness-rule sentence.
`Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/PasswordHashingFitnessTests.cs` asserts
`HaveDependencyOnAll` on the TYPES `System.Security.Cryptography.Rfc2898DeriveBytes` (`:19`, rule
`:34`) and `System.Security.Cryptography.CryptographicOperations` (`:17`, rule `:47`), not on the
`FixedTimeEquals` method, so the body now says the `SequenceEqual` swap fails only because
`FixedTimeEquals` is the type's sole `CryptographicOperations` use (`PasswordHasher.cs:64`) and that a
rewrite keeping another call on that class would pass. REWORDED (2026-10-02): "Treat the iteration count
as a config decision" read as configurable; the count is a private const (`PasswordHasher.cs:24`) and the
stored record is only `(Hash, Salt)` (`:27`, `:43`), so the bullet now says raising it is a code change
needing a plan for stored hashes. "now recorded in its own decision record" lost its "now"
(current-state rule). Field encryption: `EncryptedStringConverter`
(`Source/Core/MMCA.Common.Infrastructure/Persistence/Encryption/EncryptedStringConverter.cs`) uses
`AesGcm` (`:230`, `:265`), nonce 12 (`:82`), tag 16 (`:85`), key guards `:160-163` (single key) and `:196-199`
(per ring entry), envelope `[key version (1)][nonce (12)][ciphertext (N)][tag (16)]` assembled at
`:233-238` and documented at `:40-44`, 29 bytes of overhead; re-read line by line this run.
`Website/docs-src/adr/037-field-level-encryption-at-rest.md` Decision item 10 starts at `:131` and records
zero production adoption at `:155-159`; ADR-005 names the converter for retrievable
fields (`Website/docs-src/adr/005-soft-delete-vs-erasure.md:29`). Section 11 Security RE-ANCHORED to
`Website/docs-src/governance/common-ArchitectureScorecard.md:75` (from `:91`, which is now section 27) =
Weight 3, **Maturity 4 / Implementation 8**, weighted 12/24, unchanged. DRIFTED (2026-10-02): the row
credits alg pinning, the PBKDF2 hasher, permission-based authz and rate limiting plus brute-force
protection, and lists the ADR-037 converter only as "ships but is latent/unadopted", so AES-256-GCM was
dropped from the strength list and the body says it is not part of the credit. The row's hold-at-8
reasons are now THREE (threat-model criterion unmet; RBAC with capability indirection plus opt-in
ownership rather than ABAC; failed-login counter documented non-atomic,
`Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:79-87`; the row itself still
cites `:55`), and vault binding is no
longer a limitation (the row records opt-in `AddCommonKeyVaultConfiguration` via
`DefaultAzureCredential`), so the trade-offs paragraph was rewritten to the three. Scorecard-side drift
(not an article defect): the row still cites ADR-032 and `Infrastructure/Services/PasswordHasher.cs:9,53`
plus `Services/PasswordHasherTests.cs` (11 tests). Brute force: exponential backoff
`LoginProtectionService.cs:104` (clamped shift, `:98-104`), counter and lockout cleared in
`ResetFailedAttemptsAsync` (`:119-120`), which a successful login calls
(`AuthenticationServiceBase.cs:224`). Analyzers: `TreatWarningsAsErrors` at
`MMCA.Common/Directory.Build.props:7`; five analyzers, no dedicated security analyzer. Header
re-pointed from `MMCA.Common/CLAUDE.md` (now a stub importing `AGENTS.md`, `:3`) to
`MMCA.Common/AGENTS.md`, whose `:132` states the `AddForwardedJwtBearer` resolution order. ANCHORS
REBASED (2026-10-02): the HTTPS-metadata bullet's behavior is unchanged, but the code moved into the
partial `Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs`:
`RequireHttpsMetadataConfigKey` `:25`, the single public `AddForwardedJwtBearer` `:52-57`, the resolve
chain argument then key then `!environment.IsDevelopment()` `:64-66`, the
`InsecureJwtMetadataWarningStartupFilter` registration `:68-72` (type at
`Startup/Auth/InsecureJwtMetadataWarningStartupFilter.cs:15`), private `AddForwardedJwtBearerCore` `:77`
(re-anchored 2026-10-08 from `:24`, `:51-56`, `:63-65`, `:67-71`, `:76`).
Permissive dev CORS unchanged: `AllowAnyOrigin` at `WebApplicationBuilderExtensions.cs:146` inside the
S5122 pragma (`:144` disable, `:149` restore). Production opt-outs with justification beside the setting
re-anchored 2026-10-29: `MMCA.ADC/infra/main.bicep:2196,2332,2486` and
`MMCA.Store/infra/main.bicep:1787,1923` (each `Authentication__JwtBearer__RequireHttpsMetadata` entry set to `'false'`; Store justification comment at `:1785` and `:1921`).*

- Full series index: https://ivanball.github.io/writing.html
