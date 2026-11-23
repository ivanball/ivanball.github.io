# ADR-032: Password Hashing (PBKDF2-HMAC-SHA512) with Legacy-Hash Backward Compatibility

## Status
**Superseded by [ADR-102](102-pbkdf2-only-password-hashing.md) (2026-08-31).** Originally Accepted
(2026-06-29, adoption note revised 2026-07-06, registration note revised 2026-08-01, call-site hoist
recorded 2026-08-23). Revised 2026-10-26: ADR-102 is itself superseded by
[ADR-133](133-versioned-password-hash-work-factor.md), which now carries the current decision
(032 -> 102 -> 133), and the live sections below are rewritten to describe current source rather than
the migration-era design (the migration-era text survives only in the dated revisions): the HMAC branch
is gone, the load-bearing legacy branch is now the header-less 64-byte PBKDF2 hash read at 600,000
iterations, new hashes are versioned at 210,000 iterations, and a successful sign-in rehashes a stale
record through `NeedsRehash` for users that opt in. Revised 2026-10-28: the stale opening sentences saying
ADR-102 carries the current decision and the body is retained unchanged are removed, the 2026-10-26
sentence drops its clause about that earlier note, and the rehash anchors are refreshed. Revised
2026-11-23: the timing burn is now the hasher's own `BurnVerificationCost` default interface member,
which `PasswordHasher` runs at the 600,000-iteration legacy work factor and which also covers service
accounts, the rehash applies through the aggregate and skips the save when it is refused, and the
anchors are refreshed against v1.315.0.

## Context
Identity stores a credential as a (salt, hash) pair, never plaintext. The framework needs one
canonical hasher that every consuming Identity flow shares, so the key-derivation algorithm, work
factor, and comparison are decided once and not re-implemented per app. Two forces shape the choice:

- **A modern, deliberately slow KDF.** A fast hash (or a raw HMAC) makes offline brute force cheap if a
  credential table leaks, so the format must use a stretched, salted derivation tuned to current
  guidance, with a timing-safe comparison.
- **An existing corpus of already-stored passwords.** Earlier records were written as a bare 64-byte
  PBKDF2-HMAC-SHA512 digest at a fixed 600,000 iterations, with no header recording the work factor.
  Those rows cannot be force-reset, and they cannot be re-hashed in place: the plaintext needed to
  recompute a hash only exists transiently at the user's next sign-in. Verification therefore has to
  accept the old shape *and* the current one from the same stored bytes, with no schema flag
  distinguishing them. (The still older HMAC-SHA512 format with a 128-byte salt is no longer accepted;
  ADR-102 records its removal.)

## Decision
Provide a single `IPasswordHasher` (`MMCA.Common.Application.Interfaces.Infrastructure.Auth`,
`IPasswordHasher.cs:6`) with one implementation `PasswordHasher`
(`Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:22`), registered as a singleton via
`TryAddSingleton` (`Source/Core/MMCA.Common.Infrastructure/DependencyInjection.cs:359`, in the public
`AddServices` extension member at `DependencyInjection.cs:338` that `AddInfrastructure`
(`DependencyInjection.cs:58`) calls at `DependencyInjection.cs:277`). The call site always runs, but
`TryAdd` semantics mean a host that has already registered its own `IPasswordHasher` keeps it: the
framework supplies the default hasher rather than forcing it. The type is stateless (only `const`
parameters), so the singleton lifetime is safe.

- **New passwords use versioned PBKDF2-HMAC-SHA512.** `HashPassword` (`PasswordHasher.cs:67`) draws a
  fresh 32-byte salt from `RandomNumberGenerator.GetBytes` (`PasswordHasher.cs:71`) and derives a
  64-byte key via `Rfc2898DeriveBytes.Pbkdf2` with `HashAlgorithmName.SHA512` (`ComputePbkdf2Hash`,
  `PasswordHasher.cs:159-165`). It writes a 69-byte hash: the version byte `0x01`, a 4-byte big-endian
  iteration count, then the 64-byte digest (`PasswordHasher.cs:74-77`). The constants are
  `SaltSize = 32` (`PasswordHasher.cs:25`), `HashSize = 64` (`PasswordHasher.cs:28`) and
  `Iterations = 210_000` (`PasswordHasher.cs:34`), the OWASP figure for PBKDF2-HMAC-SHA512. The
  versioned format and the work factor are owned by ADR-133.
- **Verification reads the work factor from the stored bytes, not from a flag.** `VerifyPassword`
  (`PasswordHasher.cs:83`) returns false unless the salt is `SaltSize` bytes and `TryReadIterations`
  accepts the hash (`PasswordHasher.cs:96`). `TryReadIterations` (`PasswordHasher.cs:140-156`) accepts
  exactly two shapes: a header-less 64-byte hash, read at `LegacyIterations = 600_000`
  (`PasswordHasher.cs:37`), or a 69-byte hash whose version byte is `0x01` and whose stored count lies
  between `MinIterations = 100_000` (`PasswordHasher.cs:52`) and `MaxIterations = 2_000_000`
  (`PasswordHasher.cs:58`). Any other material verifies nothing, so the same call site verifies both
  shapes transparently. The bounds cap a tampered row rather than freeze it: such a row can still move
  the work factor anywhere from 100,000 to 2,000,000, or to 600,000 by taking the header-less shape,
  but cannot drop below the floor or force an unbounded verification (`PasswordHasher.cs:48-58`,
  `:144`, `:151`).
- **The legacy branch is load-bearing, not dead code.** The 64-byte branch of `TryReadIterations`
  (`PasswordHasher.cs:142-146`) is the only path by which a record written before versioning still
  verifies. A refactor that "simplifies" it away would compile cleanly, pass the current-format tests,
  deploy without error, and then silently reject every record not yet upgraded. There is no exception
  and no startup failure to catch it; the only symptom is that those users cannot sign in.
- **A successful sign-in upgrades a stale record.** `IPasswordHasher` declares
  `NeedsRehash(byte[] hash)` as a default interface member returning false (`IPasswordHasher.cs:28`),
  so a host-supplied hasher need not implement it. `PasswordHasher.NeedsRehash`
  (`PasswordHasher.cs:127-133`) returns true for a legacy 64-byte hash and for a versioned hash whose
  stored count differs from `Iterations`, and false for the current shape and for unrecognized
  material. After tokens are issued, `AuthenticationServiceBase` calls `RehashPasswordIfNeededAsync`
  (`AuthenticationServiceBase.cs:295`, declared at `:1001`), which runs only when issuance succeeded
  and the user implements `IPasswordRehashableUser` (`:1003`), checks `NeedsRehash` (`:1013`), hashes
  the verified plaintext (`:1018`), applies it through the aggregate's own `RehashPassword` (`:1019`)
  and saves through the unit of work (`:1029`), all inside `BestEffort.ExecuteAsync` (`:1008`). An
  aggregate that refuses the new material is logged as `PasswordRehashRejected` and the save is
  skipped (`:1020-1026`); any other failure is logged and the record is upgraded on a later sign-in,
  never failing a sign-in that already succeeded. Both apps opt in (ADC `User.cs:39`, Store
  `User.cs:30`).
- **A sign-in with no password to check still pays a verification's cost.** `IPasswordHasher` declares
  a third default interface member, `BurnVerificationCost(string password)`, which by default derives
  one `HashPassword` and discards it (`IPasswordHasher.cs:39`). `PasswordHasher` implements it
  explicitly (`PasswordHasher.cs:114`), deriving over a fresh salt at
  `BurnIterations` (`PasswordHasher.cs:64`), the larger of `Iterations` and `LegacyIterations`
  (600,000), so the burn costs what verifying a legacy record costs rather than what a new hash costs.
- **Comparison is constant time.** The single PBKDF2 path compares the recomputed digest to the trailing
  `HashSize` bytes of the stored hash (`PasswordHasher.cs:101`) with
  `CryptographicOperations.FixedTimeEquals` (`PasswordHasher.cs:106`), which always reads the full
  length so the verify time does not leak how many leading bytes matched.
- **Adopted by both apps' Identity flow, through shared bases.** Each app's `AuthenticationService` is a
  sealed subclass of `AuthenticationServiceBase<TUser>`
  (`Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:74`, `IPasswordHasher`
  parameter at `:76`) that passes the hasher into the base constructor rather than calling it. The
  base owns every sign-in call site: the login-time `VerifyPassword` (`AuthenticationServiceBase.cs:212`),
  the registration-time `HashPassword` (`AuthenticationServiceBase.cs:335`), the timing burn for an
  unknown account, one with no stored credential such as an external-OAuth account, or a machine
  client's service account (ADR-140) (`BurnPasswordVerificationCost` at
  `AuthenticationServiceBase.cs:955-963`, calling `BurnVerificationCost` at `:962`, reached from `:203`
  when `CanSignInWithPassword` at `:938` is false, `:201`) and the rehash above. ADC's
  subclass declares the parameter and forwards it
  (`MMCA.ADC/.../Identity.Application/Users/AuthenticationService.cs:53`, forwarded at
  `AuthenticationService.cs:63`); Store's does the same
  (`MMCA.Store/.../Identity.Application/Users/AuthenticationService.cs:28`, forwarded at
  `AuthenticationService.cs:35`). The remaining hasher call sites are hoisted the same way, each into
  its own shared base. Change-password lives in `ChangePasswordHandlerBase<TUser, TCommand>`
  (`ChangePasswordHandlerBase.cs:55`, `IPasswordHasher` at `:57`), which verifies the current password
  (`ChangePasswordHandlerBase.cs:108`) before hashing the new one (`ChangePasswordHandlerBase.cs:117`)
  and applying the aggregate's `ChangePassword` (`ChangePasswordHandlerBase.cs:118`). Reset-password
  lives in `ResetPasswordHandlerBase<TUser, TCommand>` (`MMCA.Common.Application.Users.UseCases.ResetPassword`,
  `ResetPasswordHandlerBase.cs:42`, `IPasswordHasher` at `:44`), which hashes the new password
  (`ResetPasswordHandlerBase.cs:110`). Each app's `ChangePasswordHandler` and `ResetPasswordHandler`
  only declares the `IPasswordHasher` parameter and forwards it (`ChangePasswordHandler.cs:26` in ADC,
  `:31` in Store; `ResetPasswordHandler.cs:26` in ADC, `:30` in Store). Seeding lives in
  `IdentityModuleDbSeederBase<TUser>` (`MMCA.Common.Infrastructure.Persistence.DbContexts.Seeding`,
  `IdentityModuleDbSeederBase.cs:54`, `IPasswordHasher` through the primary constructor at `:56` and the
  secondary constructor at `:68`, held in the `PasswordHasher` property at `:77`), which hashes each
  seeded account's password through that property (`IdentityModuleDbSeederBase.cs:121`); each app's
  `IdentityModuleDbSeeder` supplies only the account list, an `EmailExistsAsync` existence check
  (abstract at `IdentityModuleDbSeederBase.cs:99`; ADC `IdentityModuleDbSeeder.cs:41`, Store `:44`)
  and a `CreateUser` factory (abstract at `IdentityModuleDbSeederBase.cs:108`) and forwards the hasher (`IdentityModuleDbSeeder.cs:30` in ADC,
  `:32` in Store). Every hasher invocation both apps depend on therefore sits in framework code; no
  file under either app's `Source/` calls `HashPassword`, `VerifyPassword` or `NeedsRehash`. The one
  app-side lookup is each app's `IdentityModuleSeeder`, which resolves `IPasswordHasher` through
  `GetRequiredService` (ADC `IdentityModuleSeeder.cs:34`, Store `IdentityModuleSeeder.cs:33`) to
  construct the seeder rather than injecting it.

## Rationale
- **One framework-owned primitive, not per-app crypto.** Putting the algorithm, work factor, salt size,
  and comparison in a single shared type means a future hardening (raising iterations, changing the KDF)
  is one edit that every consumer inherits, rather than a hunt across Identity modules.
- **Migrate on the user's own sign-in, with no flag day.** Because the stored bytes themselves carry the
  work factor, legacy records keep working untouched, and there is no bulk migration job, no reset email
  blast, and no `IsLegacy` column to maintain. A record moves to the current format the next time its
  owner signs in (the opt-in rehash) or sets or changes a password (which always writes the versioned
  shape).
- **Slow-by-design KDF over a fast hash.** PBKDF2-HMAC-SHA512 at a high iteration count makes offline
  cracking of a leaked table expensive, which a single-pass HMAC does not, and storing the count per
  hash lets that count move without breaking a single stored credential.

## Trade-offs
- **The legacy branch is a correctness dependency that looks deletable.** Its load-bearing role is
  invisible from the method body alone, so it is the most refactor-fragile line in the hasher. The
  mitigation is this record plus focused regression tests:
  `Tests/Core/MMCA.Common.Infrastructure.Tests/Auth/PasswordHasherSecurityTests.cs:36` verifies a
  legacy 64-byte digest computed at 600,000 iterations, `PasswordHasherSecurityTests.cs:149` pins
  `LegacyIterations`, and `Auth/PasswordHasherTests.cs:39` asserts `NeedsRehash` is true for a legacy
  hash, alongside the current-format coverage at `PasswordHasherTests.cs:21` (69-byte versioned hash),
  `PasswordHasherSecurityTests.cs:222` (a hash it produced verifies) and `PasswordHasherTests.cs:77`
  (a wrong password does not). The removed HMAC format is pinned the other way:
  `PasswordHasherSecurityTests.cs:166` asserts a 128-byte-salt HMAC-SHA512 digest is rejected. The burn
  is pinned too: `PasswordHasherSecurityTests.cs:235` holds `BurnIterations` to the larger work factor
  and `:244` checks the burn costs as much as verifying a legacy record.
- **Format selection is keyed on hash length and a version byte.** It relies on the legacy (64 bytes)
  and versioned (69 bytes) shapes being distinct. They are, and corrupt or hostile material at worst
  fails to verify rather than misauthenticates (`PasswordHasherSecurityTests.cs:197`), but a future
  format has to claim a new version byte rather than reuse `0x01`.
- **The upgrade is opt-in and best effort.** A user whose app type does not implement
  `IPasswordRehashableUser`, or who never signs in, stays on the old shape indefinitely, and a failed
  rehash save is only retried on a later sign-in. The design accepts that tail rather than run a bulk
  job that would need plaintext it does not have.
- **The work factor is a fixed compile-time constant.** `Iterations = 210_000` is not configurable per
  host, so raising it is a framework change and a release, not an appsetting. Because each hash stores
  its own count (accepted only between `MinIterations` and `MaxIterations`), raising it re-derives
  records on their next sign-in rather than breaking them. That keeps the security floor uniform across
  consumers at the cost of per-deployment tuning.

## Related
ADR-004 (cross-service JWT / JWKS authentication: the hasher gates credential verification that issues the
tokens that ADR-004 then validates across services),
ADR-005 (soft-delete vs erasure: the same Infrastructure layer's `EncryptedStringConverter` protects other
sensitive columns, the at-rest counterpart to hashing credentials),
ADR-029 (authentication brute-force protection: lockout and throttling wrap the same login path whose
final credential check is this hasher),
[ADR-102](102-pbkdf2-only-password-hashing.md) (PBKDF2-only hashing: removed the HMAC-SHA512 branch),
[ADR-133](133-versioned-password-hash-work-factor.md) (versioned password hash work factor: owns the
69-byte format, the 210,000-iteration constant, the stored-count bounds and the rehash on sign-in).
The reader-facing summary is the "Password hashing" entry in MMCA.Common's `SECURITY.md:29-39`, which
describes the same current design.

## Revision (2026-08-23)
**The decision is unchanged: one framework-owned `IPasswordHasher`, PBKDF2-HMAC-SHA512 for new passwords,
salt-length dispatch on verification.** What changed is where the last two call sites live. The two use cases
this record used to list as exceptions to the base-hoisting pattern (`ChangePasswordHandler` and
`IdentityModuleDbSeeder`) have since been hoisted the same way `AuthenticationService` was, into their own
shared Common bases.

1. **Change-password.** The verify-then-hash workflow lives once in `ChangePasswordHandlerBase<TUser, TCommand>`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ChangePassword/ChangePasswordHandlerBase.cs:24`):
   `VerifyPassword` against the stored hash and salt at `:55`, `HashPassword` for the new credential at `:61`,
   and the aggregate's own `ChangePassword` invariant at `:62`. The per-app classes remain as sealed subclasses
   with no body of their own (ADC `ChangePasswordHandler.cs:17-23`, Store `ChangePasswordHandler.cs:16-20`),
   deliberately keeping their names: `HandlerName` defaults to the runtime type name
   (`ChangePasswordHandlerBase.cs:39`), so the `source` reported on every error stays the
   `ChangePasswordHandler` string clients already match on.
2. **Seeding.** The seed hash call lives once in `IdentityModuleDbSeederBase<TUser>`
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeederBase.cs:38`,
   hashing at `:103`). The per-app seeders now supply data rather than behavior: an `Accounts` list plus a
   `CreateUser` factory (abstract at `IdentityModuleDbSeederBase.cs:90`), forwarding `IPasswordHasher` to the base
   constructor (ADC `IdentityModuleDbSeeder.cs:27-30`, Store `IdentityModuleDbSeeder.cs:22-25`).

The effect on this ADR's guarantees: the "one framework-owned primitive" rationale now holds for the whole
Identity credential surface, not just login and registration. No file under either app's `Source/` invokes
`IPasswordHasher` at all; both apps only inject it and pass it to a Common base, so a future hardening (a
higher work factor, a third format) reaches every credential path in both apps through the framework alone.

## Revision (2026-10-26)
Re-verified against current source. The core decision is unchanged: one framework-owned `IPasswordHasher`,
PBKDF2-HMAC-SHA512, constant-time comparison, `TryAdd` registration and every call site hoisted into a
Common base. What moved is the compatibility story and the work factor, so the live sections now describe
current source and point at [ADR-133](133-versioned-password-hash-work-factor.md), which supersedes
ADR-102 and carries the current decision.

1. **The HMAC legacy branch is gone.** There is no `LegacyHmacSaltSize`, `ComputeLegacyHash` or
   `HMACSHA512` in `MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs`, and
   `PasswordHasherSecurityTests.cs:164` asserts a 128-byte-salt HMAC digest is rejected. The legacy
   shape still accepted is a header-less 64-byte PBKDF2 hash read at `LegacyIterations = 600_000`
   (`PasswordHasher.cs:37`, `TryReadIterations` at `:122-138`).
2. **New hashes are versioned at 210,000 iterations.** `Iterations = 210_000` (`PasswordHasher.cs:34`);
   `HashPassword` writes `0x01`, a 4-byte big-endian count and the digest, 69 bytes in all
   (`PasswordHasher.cs:68-71`). A stored count is accepted only between `MinIterations = 100_000`
   (`:52`) and `MaxIterations = 2_000_000` (`:58`).
3. **Rehash on sign-in replaces "no automatic rehash".** `IPasswordHasher.NeedsRehash` is a default
   interface member returning false (`IPasswordHasher.cs:28`); `PasswordHasher.NeedsRehash`
   (`PasswordHasher.cs:109-115`) reports the legacy shape and a stale count.
   `AuthenticationServiceBase.RehashPasswordIfNeededAsync` (`AuthenticationServiceBase.cs:675`) runs
   best effort after tokens are issued, only for users implementing `IPasswordRehashableUser` (`:677`),
   checking `NeedsRehash` (`:687`) and hashing at `:692`. Both apps opt in (ADC `User.cs:36`, Store
   `User.cs:30`).
4. **A fourth hoisted call site.** `ResetPasswordHandlerBase` (`ResetPasswordHandlerBase.cs:42`) hashes
   at `:110`; the app `ResetPasswordHandler`s only forward the hasher (ADC `:26`, Store `:30`). Each
   app's `IdentityModuleSeeder` resolves `IPasswordHasher` through `GetRequiredService` (ADC `:34`,
   Store `:33`) to construct the seeder; no app file calls a hasher method.
5. **MMCA.Common's `SECURITY.md:29` is a multi-line entry (`:29-39`)** describing the same current design, so Related
   now points at it as the reader-facing summary rather than as a note this ADR supersedes.
6. **Anchors re-verified against current source:** namespace
   `MMCA.Common.Application.Interfaces.Infrastructure.Auth` (`IPasswordHasher.cs:1`, interface `:6`);
   `PasswordHasher` moved to `Auth/PasswordHasher.cs:22` (`SaltSize` `:25`, `HashSize` `:28`,
   comparison `:95`/`:100`); `DependencyInjection.cs:335` (`TryAddSingleton`), `:315` (`AddServices`,
   now a public extension member), `:57`/`:254` (`AddInfrastructure` and its call);
   `AuthenticationServiceBase.cs:67`/`:69`/`:178`/`:277`/`:655`; `ChangePasswordHandlerBase.cs:56`/`:58`/
   `:76` (`HandlerName`)/`:109`/`:118`/`:119`; `IdentityModuleDbSeederBase.cs:57`/`:59`/`:71`/`:123`/
   `:136`; app `AuthenticationService.cs` ADC `:52` (forwarded `:61`), Store `:28` (forwarded `:35`);
   `ChangePasswordHandler.cs` ADC `:26`, Store `:31`; `IdentityModuleDbSeeder.cs` ADC `:30`, Store
   `:32`; tests moved to `Tests/Core/MMCA.Common.Infrastructure.Tests/Auth/` (`PasswordHasherTests.cs:21`,
   `:39`, `:77`, `:84`; `PasswordHasherSecurityTests.cs:34`, `:147`, `:164`, `:195`).

## Revision (2026-10-28)
Re-verified against current source. The decision is unchanged, and the live sections still describe
current source; what moved is the Status block and the rehash anchors.

1. **The Status no longer contradicts itself.** Its opening sentences reported the HMAC-SHA512 branch
   deleted, said ADR-102 carries the current decision and said the body is retained unchanged. ADR-102
   is itself superseded (`102-pbkdf2-only-password-hashing.md:4`, `133-versioned-password-hash-work-factor.md:4`)
   and the 2026-10-26 sentence after them rewrote the body, so they are removed. That 2026-10-26 sentence
   also drops its clause "so the earlier note that the body is retained unchanged no longer holds",
   whose referent went with them; the rest of it is unchanged and still names
   [ADR-133](133-versioned-password-hash-work-factor.md) as carrying the current decision.
2. **Anchors re-verified against current source:** `AuthenticationServiceBase.RehashPasswordIfNeededAsync`
   is declared at `AuthenticationServiceBase.cs:676` (call site `:237` unchanged), with the
   `IPasswordRehashableUser` check at `:678`, `BestEffort.ExecuteAsync` at `:683`, `NeedsRehash` at
   `:688` and `HashPassword` at `:693`; `:67`, `:69`, `:178`, `:277` and `:655` are unchanged.

## Revision (2026-11-23)
Re-verified against current source. The decision is unchanged: one framework-owned `IPasswordHasher`,
PBKDF2-HMAC-SHA512 at 210,000 iterations for new hashes, the load-bearing header-less 64-byte branch,
constant-time comparison, opt-in rehash on sign-in and every call site hoisted into a Common base. What
moved is the timing burn, a detail of the rehash, the test anchors and every line anchor after the
v1.315.0 release.

1. **The timing burn belongs to the hasher.** `IPasswordHasher` has a third default interface member,
   `BurnVerificationCost(string password)`, defaulting to a discarded `HashPassword`
   (`IPasswordHasher.cs:39`). `PasswordHasher` implements it explicitly (`PasswordHasher.cs:114`) at
   `BurnIterations` (`PasswordHasher.cs:64`), the larger of `Iterations` and `LegacyIterations`, so the
   burn costs 600,000 iterations, not the 210,000 a `HashPassword` costs. `AuthenticationServiceBase`
   reaches it through `BurnPasswordVerificationCost` (`AuthenticationServiceBase.cs:955-963`, call at
   `:962`) from `:203` when `CanSignInWithPassword` (`:938`) is false (`:201`), which also covers a
   machine client's service account (ADR-140, comment at `:197-200`). The Decision gains a bullet for
   it and the adoption bullet's burn clause is corrected.
2. **The rehash applies through the aggregate.** `RehashPasswordIfNeededAsync` passes the new hash to
   the aggregate's `RehashPassword` (`AuthenticationServiceBase.cs:1019`); a refused invariant is
   logged as `PasswordRehashRejected` and returns (`:1020-1026`) before the unit-of-work save at
   `:1029`.
3. **Test anchors corrected.** `PasswordHasherTests.cs:77` is the wrong-password test and `:84` is the
   `[Theory]` of the null-or-empty-password throw test, so the "verify true and false" pair now cites
   `PasswordHasherSecurityTests.cs:222` (a produced hash verifies) and `PasswordHasherTests.cs:77`. The
   burn tests at `PasswordHasherSecurityTests.cs:235` and `:244` are added to the Trade-offs list.
4. **Anchors re-verified against current source:** `PasswordHasher.cs` `HashPassword` `:67`,
   `GetBytes` `:71`, header and digest writes `:74-77`, `VerifyPassword` `:83`, guard `:96`, comparison
   `:101`/`:106`, `NeedsRehash` `:127-133`, `TryReadIterations` `:140-156` (legacy branch `:142-146`,
   bounds `:144`/`:151`), `ComputePbkdf2Hash` `:159-165` (class `:22`, `SaltSize` `:25`, `HashSize`
   `:28`, `Iterations` `:34`, `LegacyIterations` `:37`, `MinIterations` `:52`, `MaxIterations` `:58`
   unchanged); `DependencyInjection.cs:359` (`TryAddSingleton`), `:338` (`AddServices`), `:58`/`:277`
   (`AddInfrastructure` and its call); `AuthenticationServiceBase.cs:74`/`:76`/`:212`/`:335`, rehash
   call `:295`, declared `:1001`, check `:1003`, `BestEffort.ExecuteAsync` `:1008`, `NeedsRehash`
   `:1013`, `HashPassword` `:1018`; ADC `User.cs:39` (Store `:30` unchanged); app
   `AuthenticationService.cs` ADC `:53` (forwarded `:63`; Store `:28`/`:35` unchanged);
   `ChangePasswordHandlerBase.cs:55`/`:57`/`:75` (`HandlerName`)/`:108`/`:117`/`:118`;
   `IdentityModuleDbSeederBase.cs:54`/`:56`/`:68`/`:77` (`PasswordHasher` property)/`:99`/`:108`/`:121`;
   app `IdentityModuleDbSeeder.cs` `EmailExistsAsync` ADC `:41`, Store `:44` (forwards ADC `:30`,
   Store `:32` unchanged); `PasswordHasherSecurityTests.cs:36`, `:149`, `:166`, `:197`.
