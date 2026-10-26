# ADR-133: Versioned Password Hash Work Factor

## Status
Accepted (2026-10-23). Supersedes [ADR-102](102-pbkdf2-only-password-hashing.md).
The change is the MMCA.Common v1.252.0 entry of the framework changelog
(`MMCA.Common/CHANGELOG.md:171`, `:181-183`, `:187`). ADR-102's single-path decision (one interface, one
implementation, PBKDF2 only, constant-time compare, canonical-material guard) carries forward
unchanged; what this record replaces is its fixed, unstored work factor and its header-less format.
Revised 2026-10-26: anchors refreshed after the v1.252.0 changelog moved below later releases and
ADR-102 gained its Superseded banner.

## Context
ADR-102 recorded PBKDF2-HMAC-SHA512 with a 32-byte salt, a 64-byte digest and a compile-time
`Iterations = 600_000`, described as tracking OWASP guidance for that primitive
(`102-pbkdf2-only-password-hashing.md:56-57`). Its own Trade-offs named the cost of that shape:
verification recomputed with the same constant the write path used and no per-record count was
stored, so changing the constant in either direction would stop every stored credential from
verifying (`102-pbkdf2-only-password-hashing.md:155-163`), and the format carried no version marker
(`:164-166`).

Two facts made the constant worth changing. First, the figure was wrong for the primitive: 600,000
is the OWASP Password Storage Cheat Sheet figure for PBKDF2-HMAC-**SHA256**, while its figure for
PBKDF2-HMAC-SHA512 is 210,000. The comment on the old constant presented 600,000 as the SHA-512
recommendation, so every hash cost roughly 2.9 times what the guidance asks for this primitive.

Second, the cost landed on availability. Password hashing was the measured CPU bottleneck at the
ADC 2026 venue, at about 0.3 to 0.5 core-seconds per hash. Anonymous callers pay that cost too: an
unknown address, or one with no stored credential, still burns one full derivation
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:170-172`,
`:648-656`), and a known address with a wrong password runs the real verification (`:178`). Behind
the venue NAT many attendees share one address, so ADC's per-IP auth limit had to be raised from its
default of 30 per minute to 300 per minute in conference mode
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:162-172`,
`MMCA.ADC/infra/main.bicep:2060`), which raises in step how
much hashing one anonymous source can demand.

Under ADR-102's format the constant could not move at all without breaking every stored password,
so the fix needed the hash to carry its own work factor first.

## Decision
New hashes are written in a **versioned format that records their own iteration count**, at the
SHA-512 figure; every existing hash still verifies and is upgraded on its owner's next successful
sign-in.

- **A 69-byte versioned format.** A hash is `[0x01 version][4-byte big-endian iterations][64-byte
  PBKDF2 output]`
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:14-15`), built from the
  constants `FormatVersion = 0x01` (`:40`), `HeaderSize = 5` (`:43`), `HashSize = 64` (`:28`) and
  `VersionedHashSize = HeaderSize + HashSize` (`:46`). `HashPassword` (`:61`) draws a 32-byte salt
  (`SaltSize = 32`, `:25`; `:65`), derives the digest (`:66`), writes the version byte (`:69`) and the
  big-endian count through `BinaryPrimitives.WriteInt32BigEndian` (`:70`), and copies the digest after
  the header (`:71`).
- **New hashes use 210,000 iterations.** `Iterations = 210_000` (`PasswordHasher.cs:34`), documented
  as the OWASP figure for PBKDF2-HMAC-SHA512 with 600,000 named as its SHA-256 figure (`:9-11`,
  `:31-32`). The primitive is unchanged: `Rfc2898DeriveBytes.Pbkdf2` with `HashAlgorithmName.SHA512`
  and a `HashSize` output (`:141-147`).
- **Legacy hashes still verify at 600,000.** A bare 64-byte hash is the earlier format and is read as
  `LegacyIterations = 600_000` (`PasswordHasher.cs:37`, `:16-17`, read at `:124-128`), so every
  account written under ADR-102 signs in unchanged.
- **The stored count is bounded, and anything else verifies nothing.** `TryReadIterations`
  (`PasswordHasher.cs:122`) accepts exactly the two shapes the hasher writes: the legacy length, or
  the versioned length with a `0x01` version byte (`:130`) and a count between
  `MinIterations = 100_000` (`:52`) and `MaxIterations = 2_000_000` (`:58`) inclusive (`:133`). The
  lower bound stops a tampered row from lowering the cost of guessing its password (`:48-51`); the
  upper bound caps the work one verification can be made to do, so a tampered row cannot turn a
  sign-in into a CPU denial of service (`:54-57`). Any other shape returns `false` (`:136-137`).
- **Verification derives at the stored count, then compares in constant time.** `VerifyPassword`
  (`PasswordHasher.cs:77`) keeps ADR-102's canonical-material guard, now admitting two shapes: the salt
  must be `SaltSize` bytes and the hash must pass `TryReadIterations` (`:90`), on the same stated ground
  that an empty hash-and-salt pair would otherwise verify any password (`:83-89`). It recomputes at
  the stored count (`:96`) and compares against the trailing `HashSize` bytes (`:95`) with
  `CryptographicOperations.FixedTimeEquals` (`:100`).
- **`NeedsRehash` reports an outdated record.** `IPasswordHasher` gains `NeedsRehash(byte[] hash)` as a
  default interface member answering `false`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/IPasswordHasher.cs:28`),
  so a custom hasher compiles unchanged and never triggers a rehash (`:18-22`). `PasswordHasher`
  overrides it (`PasswordHasher.cs:109-115`): true for a legacy 64-byte hash and for a versioned hash
  whose count differs from the current one, false for the current shape and for unrecognized material,
  which never verifies and so never reaches a rehash (`:104-108`).
- **The aggregate opts in through its own surface.** `IPasswordRehashableUser`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IPasswordRehashableUser.cs:16`) adds
  `RehashPassword(byte[], byte[])` (`:25`), kept separate from `ChangePassword` on purpose: a rehash
  keeps the same password, so it must not raise the password-changed event or anything a real change
  triggers, such as revoking sessions or notifying the owner (`:10-14`). A `User` that does not
  implement it keeps its stored hash as it is (`:8-9`).
- **The upgrade runs after a successful sign-in, best effort, on its own save.** `LoginAsync` calls
  `RehashPasswordIfNeededAsync` (`AuthenticationServiceBase.cs:237`) after the tokens are issued
  (`:230`); a wrong password returns at `:178-183` and never reaches it. The method returns unless
  issuance succeeded and the user implements `IPasswordRehashableUser` (`:677-680`), then runs inside
  `BestEffort.ExecuteAsync` under the operation name `password-rehash` (`:78`, `:682-683`) with
  `CancellationToken.None` (`:705`). It checks `NeedsRehash` (`:687`), hashes the verified plaintext
  (`:692`), applies it through `RehashPassword` (`:693`), logs and skips the save when the aggregate
  refuses it (`:694-700`), and otherwise saves through the unit of work on its own (`:703`). A failure
  there cannot fail a sign-in that already succeeded; it is logged and counted, and the record is
  upgraded on a later sign-in (`:665-670`). The logger is a virtual property defaulting to
  `NullLogger.Instance` (`:137`), and a failed rehash is counted on the `MMCA.Common.BestEffort` meter
  whether or not it is overridden (`:134-135`).
- **The unknown-account burn costs the current work factor.** `BurnPasswordVerificationCost`
  (`AuthenticationServiceBase.cs:648`) still discards a `HashPassword` of the submitted password
  (`:655`), so it costs what verifying a current-format record costs; its remarks state that a record
  on an older work factor costs that older amount until it is upgraded (`:643-646`).
- **Both consuming apps opt in, without a domain event.** ADC's `User` implements
  `IPasswordRehashableUser`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:36`); its `RehashPassword`
  (`:442`) validates the new hash and salt with the same `UserInvariants` checks (`:444-446`) and
  raises no event, while `ChangePassword` (`:415`) still raises `UserPasswordChanged` (`:429`).
  Store's `User` does the same
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/User.cs:30`, `RehashPassword`
  at `:205`, invariants at `:207-209`; `ChangePassword` at `:178` raising `UserPasswordChanged` at
  `:192`). MMCA.Helpdesk holds no password material: no `.cs` file under its `Source/` references
  `PasswordHash` or `IPasswordHasher`.
- **No schema migration.** Both consumers map `PasswordHash` without a maximum length, as
  `varbinary(max)`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:36-39`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:29-32`),
  so a 69-byte value lands in the same column as a 64-byte one.
- **The format, the counts and the upgrade are pinned by tests.**
  `PasswordHasherSecurityTests` pins `210_000`, `600_000`, 32, 64, 69 and `0x01`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Auth/PasswordHasherSecurityTests.cs:23-28`);
  accepts a legacy 64-byte digest computed at 600,000 (`:34`) and a versioned one (`:53`); checks
  `HashPassword` against an independent known answer (`:67`); proves a stored count of 300,000 is
  honored and reported by `NeedsRehash` (`:86-96`); rejects counts 99,999, 2,000,001, 0 and -1 and
  version bytes `0x00` and `0x02` (`:98-105`) and a digest at 100,000 (`:122`, `:129`); reads the
  private constants by reflection (`:141`, `:147`, `:153`, `:159`); keeps ADR-102's legacy-HMAC
  rejection (`:164`); walks ten non-canonical length pairs across both shapes (`:184-195`); rejects a
  valid header over an odd salt (`:209`); and round-trips its own output (`:220`).
  `PasswordHasherTests` asserts the 69-byte hash and 32-byte salt
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Auth/PasswordHasherTests.cs:21-25`) and the
  `NeedsRehash` cases (`:31`, `:39`, `:43`, `:50`). `AuthenticationServicePasswordRehashTests` covers
  the sign-in path: a legacy hash on an opted-in user is rehashed and saved
  (`MMCA.Common/Tests/Core/MMCA.Common.Application.Tests/Auth/AuthenticationServicePasswordRehashTests.cs:39`),
  not rehashed a second time (`:58`), left untouched for a user that does not opt in (`:73`), and the
  sign-in still succeeds when the save throws (`:89`), when the hasher throws (`:112`) and when the
  aggregate refuses (`:128`); a wrong password never rehashes (`:156`). The IL-shape rules from
  ADR-102 still hold the type to `Rfc2898DeriveBytes` and `CryptographicOperations`
  (`MMCA.Common/Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/PasswordHashingFitnessTests.cs:30`,
  `:43`, non-vacuity at `:24`).

## Rationale
- **The hash is the right place for its own parameters.** The count travels with the digest it
  produced, so a future change in either direction re-derives records on their next sign-in instead
  of locking every account out, which is the failure ADR-102's Trade-offs called out.
- **The work factor should match the guidance for the primitive in use.** 210,000 is the published
  figure for PBKDF2-HMAC-SHA512; spending about 2.9 times that per sign-in bought no protection the
  guidance asks for and cost CPU at exactly the moment a conference needed it.
- **An explicit version marker, not another data convention.** ADR-102 rejected selecting an algorithm
  from a data property such as salt length and said a future format change was better served by an
  explicit version marker (`102-pbkdf2-only-password-hashing.md:138-141`). The `0x01` byte is that
  marker, and the iteration bounds stop the data from choosing a weaker or abusive cost.
- **Sign-in is the only moment the upgrade is possible.** The plaintext exists only transiently at
  login, so the rehash runs there, after verification has proven it. Making it best effort keeps a
  failed write from turning a successful sign-in into an error.
- **A rehash is not a password change.** `ChangePassword` raises `UserPasswordChanged`, which drives
  consequences a re-derivation of the same password must not trigger; a separate opt-in method keeps
  the two from being confused.

## Trade-offs
- **Legacy accounts are distinguishable by timing until they sign in once.** A wrong password against
  a legacy account verifies at 600,000 iterations (`PasswordHasher.cs:126`, `:96`), while an unknown
  address burns a derivation at the current 210,000 (`AuthenticationServiceBase.cs:655`), so a caller
  timing failed logins can tell a legacy account from a missing one. Accepted because registration
  already reveals whether an address exists: `RegisterAsync` returns
  `AuthErrorCodes.EmailAlreadyExists` for a taken address (`AuthenticationServiceBase.cs:271-274`,
  `:713-715`). The gap closes per account at its first sign-in; an account that never signs in keeps
  the legacy hash, and nothing forces the upgrade.
- **The upgrade is opt-in.** An app whose `User` does not implement `IPasswordRehashableUser` keeps
  its legacy hashes indefinitely (`IPasswordRehashableUser.cs:8-9`), as does any custom hasher that
  does not override `NeedsRehash` (`IPasswordHasher.cs:28`).
- **The first sign-in after the change costs two derivations.** A legacy account verifies at 600,000
  (`AuthenticationServiceBase.cs:178`) and is then hashed at 210,000 (`:692`), plus one extra save
  (`:703`). Every later sign-in costs one derivation at 210,000.
- **New hashes resist offline guessing less than the old ones did.** A leaked table of current-format
  hashes costs an attacker 210,000 iterations per guess instead of 600,000. Accepted because that is
  the published figure for this primitive.
- **The work factor is still a compile-time constant** (`PasswordHasher.cs:34`), so changing it is a
  framework release rather than configuration; what changed is that the release no longer breaks
  stored credentials.
- **The format is now closed to unknown versions.** A version byte other than `0x01` verifies nothing
  (`PasswordHasher.cs:130`, `:136-137`), so a future format needs code that reads its marker before
  any hash carrying it is written.

## Alternatives rejected
Weighed and rejected on 2026-10-23.
- **A separate iterations column.** It would carry the same information as the header at the price of
  a schema migration in every consumer. Revisit if a per-record parameter ever has to be queryable in
  the database rather than read at verification time.
- **Changing the constant without a stored count.** Under ADR-102's format every stored password would
  stop verifying (`102-pbkdf2-only-password-hashing.md:159-163`), leaving a reset for every account as
  the only remedy.
- **Argon2id.** It is not in the .NET base class library, so adopting it would add a native or
  third-party dependency to a framework that ships PBKDF2 only and pins that dependency in an IL-shape
  rule (`PasswordHashingFitnessTests.cs:30`). Revisit if the base class library ships it; the version
  byte is where such a change would be recorded.

## Consequences
- Signing in is cheaper for every account on the current format, and so is every anonymous failed
  attempt that burns a derivation, which lowers the CPU cost of the per-IP limits a conference venue
  needs.
- The legacy population shrinks as accounts sign in; until it is gone, the 600,000 read path and the
  timing difference above both stay.
- A future work-factor change is a constant edit plus a release, with the upgrade riding the same
  sign-in path.

## Revision (2026-10-26)
Re-verified against current source. The decision, the format, the counts and the upgrade path are
unchanged; only anchors moved, as later releases pushed the v1.252.0 changelog entry down and ADR-102
gained its Superseded banner.

1. Anchors re-verified against current source: the v1.252.0 entry is now
   `MMCA.Common/CHANGELOG.md:171` (heading), `:181-183` (`NeedsRehash`, `IPasswordRehashableUser`, the
   sign-in rehash) and `:187` (the versioned 69-byte format, 210,000 iterations, "Supersedes
   ADR-102"); the ADC per-IP auth limit explanation is
   `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:162-171` with the
   `AddCommonRateLimiting` call at `:172`, and the conference-mode value of 300 is set as
   `RateLimiting__AuthIpPermitLimit` at `MMCA.ADC/infra/main.bicep:2060`; ADR-102's constants and
   OWASP note are at `102-pbkdf2-only-password-hashing.md:56-57`, its explicit-version-marker advice
   at `:138-141`, the fixed-constant and invalidation Trade-offs at `:155-163` (invalidation alone at
   `:159-163`), and the no-version-marker Trade-off at `:164-166`.

## Related
[ADR-102](102-pbkdf2-only-password-hashing.md) (the superseded record: the single PBKDF2 path, the
canonical-material guard and the tests this record keeps),
[ADR-032](032-password-hashing.md) (the original hasher and its call sites),
ADR-029 (authentication brute-force protection: lockout and rate limiting wrap the same login path
whose cost this record lowers),
[ADR-036](036-external-oauth-login.md) (external OAuth login: the credential-free account shape the
guard still rejects on the password path).
