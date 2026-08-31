# ADR-102: PBKDF2-Only Password Hashing

## Status
Accepted (2026-08-31). Supersedes [ADR-032](032-password-hashing.md).

## Context
ADR-032 recorded a hasher with two verification paths: PBKDF2-HMAC-SHA512 for new credentials, and an
HMAC-SHA512 recompute for rows written under an older scheme, selected at verify time by reading the
stored salt length (128 bytes routed to the legacy path). That dual path existed for one reason only:
an existing corpus of stored credentials that could not be re-hashed in place, because the plaintext
needed to recompute a hash exists only transiently at the owner's next login.

Two things make that design a liability rather than an asset once the corpus is gone. The legacy
branch verifies a single-round, effectively unsalted HMAC digest, so any row still in that shape is
authenticated by a primitive that offers none of the offline-cracking resistance the record itself
argues for. And algorithm selection keyed on a data property (salt length) means the credential table
decides which primitive runs, with no stored version marker and no way to assert from configuration
which path a given login took.

The production credential stores of both consuming applications were checked for legacy-format rows
(a salt of the legacy length) before the branch was removed, and contained none: every stored
credential was already in the current 32-byte-salt PBKDF2 format. With no row left that the branch
could serve, keeping it meant carrying a weaker verification path for a population of zero. The
branch, its `LegacyHmacSaltSize` constant, its `ComputeLegacyHash` helper and the two regression
tests that pinned it were deleted in the collapse-dual-paths wave (MMCA.Common v1.173/v1.174).

## Decision
Hashing and verification are **PBKDF2-only**. There is one framework `IPasswordHasher` and one code
path through it, in both directions.

- **One interface, one implementation, one registration.** `IPasswordHasher`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/IPasswordHasher.cs:6`)
  has the single implementation `PasswordHasher`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Services/PasswordHasher.cs:12`), registered
  with `TryAddSingleton`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:549`) inside the
  `AddServices` helper that `AddInfrastructure` calls unconditionally (`DependencyInjection.cs:205`).
  `TryAdd` semantics keep a host's own prior registration, so the framework supplies the default
  rather than forcing it, and the type is stateless (three private `const` fields and no instance
  state, `PasswordHasher.cs:15`, `:18`, `:24`), which is what makes the singleton lifetime safe.
- **PBKDF2-HMAC-SHA512, 32-byte salt, 64-byte digest, 600,000 iterations.** `HashPassword`
  (`PasswordHasher.cs:27`) draws a fresh salt from `RandomNumberGenerator.GetBytes(SaltSize)`
  (`:31`) and derives the key with `Rfc2898DeriveBytes.Pbkdf2` (`:32-37`), passing
  `HashAlgorithmName.SHA512` (`:36`) and `HashSize` (`:37`). The parameters are the named constants
  `SaltSize = 32` (`:15`), `HashSize = 64` (`:18`) and `Iterations = 600_000` (`:24`), the iteration
  count tracking OWASP 2023 guidance for this primitive.
- **Verification has no branch.** `VerifyPassword` (`PasswordHasher.cs:43`) validates its arguments
  and then unconditionally calls `ComputePbkdf2Hash(password, salt, hash.Length)` (`:49`). There is
  no inspection of the salt length and no second algorithm to route to: the private helper
  (`:57-63`) is the only recompute in the type, and it uses the same `Iterations` (`:61`) and
  `HashAlgorithmName.SHA512` (`:62`) the write path uses.
- **The comparison stays constant time.** The recomputed bytes are compared with
  `CryptographicOperations.FixedTimeEquals` (`PasswordHasher.cs:53`), which always reads the full
  length so verify time does not leak how many leading bytes matched.
- **The legacy path is gone, not merely unreachable.** `LegacyHmacSaltSize`, `ComputeLegacyHash` and
  every `HMACSHA512` usage are absent from all `Source/` code in the four repos: a workspace-wide
  search for those three identifiers across `*.cs` matches only the test that proves the removal
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Services/PasswordHasherSecurityTests.cs:105`
  and `:108`). `PasswordHasher.cs` is 64 lines end to end.
- **A test asserts the rejection rather than the acceptance.**
  `VerifyPassword_RejectsALegacyHmacDigest` (`PasswordHasherSecurityTests.cs:105-115`) builds a
  128-byte HMAC key as the salt and the matching single-round `HMACSHA512` digest (`:108-110`) and
  requires `VerifyPassword` to answer `false` for the **correct** password (`:112`), on the stated
  ground that a credential still in the legacy shape must fail rather than authenticate through an
  unsalted, single-round digest (`:113-114`). Re-introducing the branch fails this test.
- **The parameters are pinned two ways, structurally and by value.**
  `PasswordHasherSecurityTests` recomputes the digest independently with the pinned settings
  (`:28-43`, `:46-66`), proves the work factor participates in verification by rejecting a digest
  derived at 100,000 iterations (`:69-84`), and reads the three private constants by reflection so a
  lowered or renamed one fails the build (`:88-102`, helper at `:128-136`). At the architecture tier,
  `PasswordHashingFitnessTests` asserts against compiled IL that the type depends on
  `Rfc2898DeriveBytes` (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/PasswordHashingFitnessTests.cs:30-40`)
  and on `CryptographicOperations` (`:43-54`), with a non-vacuity check that the scan actually reaches
  the type (`:24-27`).
- **`PasswordHasherTests` covers the current format and argument validation only.** The 88-line file
  holds the PBKDF2 round trips (`PasswordHasherTests.cs:21-27` for the 64-byte digest and 32-byte
  salt, `:50-54` for the correct password, `:57-61` for the wrong one), per-call salt uniqueness
  (`:30-36`) and null/empty argument guards; no legacy-format test remains in it.
- **All four framework call sites are unchanged by this decision.** Login verification
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:156`) and
  registration hashing (`:207`) live in the shared base (`:47`, hasher parameter at `:50`);
  change-password verifies then hashes in `ChangePasswordHandlerBase<TUser, TCommand>`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:24`,
  `:55`, `:61`); reset-password hashes in `ResetPasswordHandlerBase<TUser, TCommand>`
  (`.../UseCases/ResetPassword/ResetPasswordHandlerBase.cs:30`, hashing at `:79`); and seeding hashes
  in `IdentityModuleDbSeederBase<TUser>`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeederBase.cs:38`,
  `:103`). No file under either app's `Source/` invokes the hasher: ADC and Store only declare the
  parameter and forward it to a Common base
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/AuthenticationService.cs:41,44,54`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/AuthenticationService.cs:21,24,33`).
- **The security model summary states the same rule.** `MMCA.Common/SECURITY.md:29-35` documents
  PBKDF2-SHA512 with a high iteration count and constant-time comparison as build-failing invariants
  and says outright that PBKDF2 is the only verification path with no legacy HMAC fallback (`:34-35`).

## Rationale
- **A verification path that serves no rows is pure risk.** With the production stores confirmed free
  of legacy-format credentials, the branch could only ever be reached by a corrupt, hostile or
  restored-from-an-archive row, and reaching it would authenticate through the weakest primitive in
  the system. Removing it converts "an old-format row logs in through a fast hash" into "an old-format
  row does not log in".
- **The strongest form of the invariant is a single path.** ADR-032's own Trade-offs called the legacy
  branch the most refactor-fragile line in the hasher, mitigated by a record and two tests. One path
  needs no mitigation: there is no selection logic to get wrong, and the known-answer, reflection and
  IL-shape tests now pin the one algorithm that exists rather than guarding a second one.
- **Data-driven algorithm selection is the wrong control point.** Keying on salt length puts the
  choice of primitive in the credential table, where it is invisible to configuration, to review and
  to an operator. A future format change is better served by an explicit version marker and a planned
  migration than by a second implicit length convention.
- **Deletion is cheaper than indefinite carriage.** The alternative to removing the branch was keeping
  it forever (nothing was going to retire it on its own, since ADR-032 deliberately declined
  rehash-on-login), or building an opportunistic upgrade path for a population already measured at
  zero.

## Trade-offs
- **A legacy-format row that reaches production now fails verification.** Restoring an old backup,
  importing a credential from an external system in the legacy shape, or missing a row in the
  pre-deletion check produces a login that fails with the correct password. The failure is
  indistinguishable from a wrong password at the call site (`PasswordHasher.cs:49-53` returns a plain
  `false`), so there is no signal that names the cause; the only remedy is a password reset. Nothing
  in the code detects or reports such a row.
- **The work factor is a fixed compile-time constant.** `Iterations = 600_000` (`PasswordHasher.cs:24`)
  is not bound to configuration, so raising it is a framework change and a release rather than an
  appsetting. That keeps the security floor uniform across consumers at the cost of per-deployment
  tuning.
- **Raising the work factor invalidates every stored credential.** Verification recomputes with the
  same constant the write path used (`PasswordHasher.cs:61`), and no per-record iteration count is
  stored, so an increase makes existing hashes stop matching. A future hardening therefore needs a
  stored parameter set or a migration strategy, which is exactly the versioning problem this record
  declines to solve by salt-length convention.
- **The stored format carries no version marker.** The format is implicit in the code, so introducing
  a third scheme later requires adding that marker (or an out-of-band migration) rather than reading
  another data property.
- **Verification derives to the stored hash length, not to `HashSize`.**
  `ComputePbkdf2Hash(password, salt, hash.Length)` (`PasswordHasher.cs:49`) means a truncated stored
  digest is compared against an equally truncated recompute rather than rejected as malformed. The
  64-byte output is enforced on the write path (`:37`) and pinned by test
  (`PasswordHasherSecurityTests.cs:100-102`), not on the read path.

## Related
[ADR-032](032-password-hashing.md) (the superseded record: the same hasher, its parameters and its
call-site hoisting, plus the legacy-compatibility design this reverses),
ADR-004 (cross-service JWT / JWKS authentication: the hasher gates the credential verification that
issues the tokens ADR-004 validates across services),
ADR-005 (soft-delete vs erasure: `EncryptedStringConverter` protects other sensitive columns, the
at-rest counterpart to hashing credentials),
ADR-029 (authentication brute-force protection: lockout and throttling wrap the same login path whose
final credential check is this hasher).
The security model summary in `MMCA.Common/SECURITY.md:29-35` stays the reader-facing pointer to this
record.
