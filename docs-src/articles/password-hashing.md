# Password hashing done right: PBKDF2-SHA512, 600k iterations, timing-safe

> Series: MMCA.Common · Article #17 · Pillar P2/P4 · Group G08 · Rubric §11 · ADR-102 ·
> Status: grounded in `Website/docs-src/onboarding/group-08-auth.md`, `MMCA.Common/AGENTS.md`,
> `Website/docs-src/adr/102-pbkdf2-only-password-hashing.md` (which supersedes ADR-032), and `Website/docs-src/governance/common-ArchitectureScorecard.md` (§11). No em dashes.

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

- **PBKDF2-HMAC-SHA512 at 600,000 iterations** (OWASP 2023 guidance). PBKDF2 is a *key derivation
  function*: a deliberately expensive hash. Six hundred thousand iterations means each guess costs the
  attacker 600,000 SHA-512 operations, not one. That turns "billions of guesses per second" into a rate
  where offline brute force against a strong password stops being worth the electricity.
- **A 32-byte cryptographically random salt per password**, with a 64-byte output. The salt means two
  users with the same password get different hashes, so an attacker cannot crack once and apply
  everywhere, and precomputed rainbow tables are useless.
- **Constant-time comparison.** Verification ends with `CryptographicOperations.FixedTimeEquals`, which
  always compares the full length regardless of where the first mismatch is.

```csharp
// HashPassword: 32-byte random salt, PBKDF2-HMAC-SHA512, 600,000 iterations, 64-byte output.
(byte[] Hash, byte[] Salt) HashPassword(string password);

// VerifyPassword ends with a timing-safe compare, never a == or SequenceEqual:
return CryptographicOperations.FixedTimeEquals(computedHash, hash);
```

(Source: `PasswordHasher.cs` and the password section of `Website/docs-src/onboarding/group-08-auth.md`.)

Those parameters are not a convention held in place by code review. They are build-failing checks.
Known-answer tests recompute the digest independently with PBKDF2-HMAC-SHA512 at 600,000 iterations
and a 64-byte output, so a lowered work factor, a swapped algorithm or a truncated digest stops
matching. A negative known-answer test derives a digest at a fraction of that iteration count and
asserts verification rejects it, which proves the work factor really participates rather than sitting
in a comment. Reflection reads the three private constants straight off the type and pins them (the
iteration count, the 32-byte salt and the 64-byte digest), so lowering one fails the build instead of
silently shipping. And an architecture rule reads the compiled type and fails the build if it stops
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

### One algorithm, one read path, and a guard on the material

The hasher stores `(byte[] Hash, byte[] Salt)` and nothing else: the iteration count and the algorithm
live in the verifier, not in the stored record. PBKDF2-HMAC-SHA512 is the only supported algorithm, so
nothing about a stored row selects a primitive. Verification opens by rejecting any material that is
not exactly a 64-byte hash over a 32-byte salt, then recomputes to that constant length and compares.
That guard is the interesting part: a row holding an empty hash and an empty salt (the shape an
external-OAuth account carries, ADR-036) otherwise derives an empty output and compares two empty
spans, which a fixed-time comparison answers true for, so any password authenticates it. Material this
hasher never produced verifies nothing.

One primitive is a deliberate trade. A verifier that picks its algorithm from a data property (the
stored salt length, say) can carry two credential formats at once, which is what an installed base of
old hashes needs. It also means the credential table decides which primitive runs, with no version
marker and no way to assert from configuration which path a given login took, and the weaker format
stays reachable for as long as the branch exists. MMCA.Common takes the other side: one path, and a
credential in any other shape fails rather than authenticating through a fast hash. Changing the
algorithm itself stays cheap because it sits behind `IPasswordHasher`: swapping PBKDF2 for Argon2id is
an Infrastructure registration change, and the application handlers never name a hashing primitive.

## Defense in depth: PII at rest, not just passwords

Passwords are the famous case, but they are not the only personal data sitting in your database.
MMCA.Common ships field-level PII encryption as a separate control, recorded in its own decision
record (ADR-037): `EncryptedStringConverter` is an EF Core value converter that encrypts a column with
**AES-256-GCM** transparently on the way to the database and decrypts on the way out. GCM is
authenticated encryption, so it protects confidentiality *and* detects tampering. It is the framework
capability the erasure design (ADR-005) provides for fields a service chooses to keep retrievable for
legitimate use after anonymization, encrypted at rest rather than overwritten. (Today it is a shipped,
unit-tested converter that no entity configuration in any of the four repositories wires yet, so zero
production columns are encrypted; the consumer apps still overwrite every PII field on anonymization.
ADR-037 records the extension point and is explicit about that latent posture.)

The whole pipeline is held to the same enforcement bar as the rest of the framework: **all five
analyzers run at error severity** with `TreatWarningsAsErrors` globally, and a couple of them
(SonarAnalyzer and Meziantou) carry security-relevant rules. The security category (§11) scored
**Maturity 4 / Implementation 8** on the framework's two-axis rubric (Maturity 0-4, Implementation
0-10), on the strength of JWT algorithm pinning, this hashing scheme (recorded in ADR-102),
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
- **Iteration counts are a moving target.** 600,000 PBKDF2-SHA512 iterations matches 2023 OWASP
  guidance; that number ratchets up with hardware. Here it is a private constant pinned by a test, not
  a setting, and because the stored record carries no iteration count, raising it is a deliberate code
  change that needs a plan for the hashes already stored. Revisit it anyway, and prefer a memory-hard
  KDF (Argon2id) when you can, which is exactly why the algorithm lives behind an interface here.

The current §11 entry itself names three reasons it holds at Implementation 8, all upstream of the
hash: the rubric's threat-model criterion is unmet, authorization is RBAC with a capability layer plus
opt-in ownership checks rather than a full resource- or attribute-based policy engine, and the
failed-login counter behind the brute-force lockout is documented as non-atomic. None of these
undermine the storage scheme. They are the operational and governance work that surrounds a correct
hash.

## Apply this even without MMCA

The rules port to any stack, and they are short enough to memorize:

1. **Never store plaintext, and never use a fast hash** (MD5, SHA-1, plain SHA-256/512) for passwords.
   Use a purpose-built KDF: Argon2id if available, otherwise PBKDF2-HMAC-SHA512 or bcrypt/scrypt.
2. **Tune the work factor to current guidance** (600k+ PBKDF2-SHA512 iterations at the time of writing)
   and revisit it as hardware improves.
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
600,000 iterations with a per-password salt and a `FixedTimeEquals` compare makes stolen hashes
uneconomical to crack, how known-answer tests and an architecture rule keep those parameters
build-failing invariants, why a single PBKDF2 path plus a canonical-material guard means a credential
row in any other shape authenticates nobody, how AES-256-GCM field encryption via
`EncryptedStringConverter` extends the same care to other PII, and the honest trade-offs (the
HTTPS-metadata opt-out, an iteration count that ratchets with hardware).

**Next in the series:** idempotency in one attribute, so a client that retries a write gets the first
response replayed instead of a duplicate.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the §11 scorecard entry, or
`dotnet add package MMCA.Common.Infrastructure` and try it.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 The §11 security entry lives in `Website/docs-src/governance/common-ArchitectureScorecard.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, Security, Cryptography*

*Notes (re-sourced 2026-10-02 against MMCA.Common v1.221.0): every anchor below was re-read this run.
Port and adapter: `IPasswordHasher` in `MMCA.Common.Application` (namespace
`MMCA.Common.Application.Interfaces.Infrastructure.Auth`,
`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/IPasswordHasher.cs:1`, interface at
`:6`); the single `PasswordHasher` in `MMCA.Common.Infrastructure` (namespace
`MMCA.Common.Infrastructure.Auth`, `Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:5`,
class at `:12`), registered by `TryAddSingleton<IPasswordHasher, PasswordHasher>`
(`Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:314`). Behavior, unchanged:
PBKDF2-HMAC-SHA512 (`HashAlgorithmName.SHA512`, `PasswordHasher.cs:36` on the write path and `:73`
inside `ComputePbkdf2Hash` at `:68-74`), `Iterations = 600_000` (`:24`, a private const), `SaltSize = 32`
(`:15`), `HashSize = 64` (`:18`), the canonical-material guard (`:55-58`, SECURITY rationale `:49-54`),
recompute to `HashSize` (`:60`), `CryptographicOperations.FixedTimeEquals` (`:64`), class doc "PBKDF2 is
the only supported algorithm" (`:8-10`); the type is 75 lines with no legacy HMAC branch. ADR:
`Website/docs-src/adr/102-pbkdf2-only-password-hashing.md` (Accepted 2026-08-31, supersedes ADR-032 at
`:4`, revised 2026-09-11 at `:5-8`). Tests:
`Tests/Core/MMCA.Common.Infrastructure.Tests/Auth/PasswordHasherSecurityTests.cs` (namespace `:7`)
pins `Iterations` (`:88-89`), `SaltSize` (`:94-95`) and `HashSize` (`:100-101`) against `:20-22` via
`ReadPrivateConstant` (`:164`, `NotNull` guard `:168`), rejects a legacy HMAC digest (`:105`), an empty
hash and salt (`:121`) and six non-canonical shapes (`:132`);
`Tests/Core/MMCA.Common.Infrastructure.Tests/Auth/PasswordHasherTests.cs` (namespace `:4`, class `:6`)
holds 7 `[Fact]` + 2 `[Theory]`. NARROWED (2026-10-02): the fitness-rule sentence.
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
`AesGcm` (`:200`, `:235`), nonce 12 (`:78`), tag 16 (`:81`), key guards `:130` (single key) and `:166`
(per ring entry), envelope `[key version (1)][nonce (12)][ciphertext (N)][tag (16)]` assembled at
`:203-208` and documented at `:38-44`, 29 bytes of overhead; re-read line by line this run.
`Website/docs-src/adr/037-field-level-encryption-at-rest.md` Decision item 10 starts at `:122` and records
zero adoption at `:136-141` (re-anchored from `:135-140`); ADR-005 names the converter for retrievable
fields (`Website/docs-src/adr/005-soft-delete-vs-erasure.md:23`). Section 11 Security RE-ANCHORED to
`Website/docs-src/governance/common-ArchitectureScorecard.md:75` (from `:91`, which is now section 27) =
Weight 3, **Maturity 4 / Implementation 8**, weighted 12/24, unchanged. DRIFTED (2026-10-02): the row
credits alg pinning, the PBKDF2 hasher, permission-based authz and rate limiting plus brute-force
protection, and lists the ADR-037 converter only as "ships but is latent/unadopted", so AES-256-GCM was
dropped from the strength list and the body says it is not part of the credit. The row's hold-at-8
reasons are now THREE (threat-model criterion unmet; RBAC with capability indirection plus opt-in
ownership rather than ABAC; failed-login counter documented non-atomic,
`Source/Core/MMCA.Common.Infrastructure/Auth/LoginProtectionService.cs:55`), and vault binding is no
longer a limitation (the row records opt-in `AddCommonKeyVaultConfiguration` via
`DefaultAzureCredential`), so the trade-offs paragraph was rewritten to the three. Scorecard-side drift
(not an article defect): the row still cites ADR-032 and `Infrastructure/Services/PasswordHasher.cs:9,53`
plus `Services/PasswordHasherTests.cs` (11 tests). Brute force: exponential backoff
`LoginProtectionService.cs:77` (clamped shift, `:71-78`), counter and lockout cleared in
`ResetFailedAttemptsAsync` (`:85-86`). Analyzers: `TreatWarningsAsErrors` at
`MMCA.Common/Directory.Build.props:7`; five analyzers, no dedicated security analyzer. Header
re-pointed from `MMCA.Common/CLAUDE.md` (now a stub importing `AGENTS.md`, `:3`) to
`MMCA.Common/AGENTS.md`, whose `:131` states the `AddForwardedJwtBearer` resolution order. ANCHORS
REBASED (2026-10-02): the HTTPS-metadata bullet's behavior is unchanged, but the code moved into the
partial `Source/Presentation/MMCA.Common.API/Startup/WebApplicationBuilderExtensions.Authentication.cs`:
`RequireHttpsMetadataConfigKey` `:24`, the single public `AddForwardedJwtBearer` `:51-56`, the resolve
chain argument then key then `!environment.IsDevelopment()` `:63-65`, the
`InsecureJwtMetadataWarningStartupFilter` registration `:67-71` (type at
`Startup/Auth/InsecureJwtMetadataWarningStartupFilter.cs:15`), private `AddForwardedJwtBearerCore` `:76`.
Permissive dev CORS unchanged: `AllowAnyOrigin` at `WebApplicationBuilderExtensions.cs:140` inside the
S5122 pragma (`:138` disable, `:143` restore). Production opt-outs with justification beside the setting
re-anchored: `MMCA.ADC/infra/main.bicep:1941,2075,2227` (comments `:1938-1940`, `:2072-2074`,
`:2224-2226`) and `MMCA.Store/infra/main.bicep:1686,1818` (comments `:1682-1685`, `:1814-1817`).*

- Full series index: https://ivanball.github.io/writing.html
