# ADR-133: Versioned Password Hash Work Factor

## Status
Accepted (2026-10-23). Supersedes [ADR-102](102-pbkdf2-only-password-hashing.md).
The change is the MMCA.Common v1.252.0 entry of the framework changelog
(`MMCA.Common/CHANGELOG.md:214`, `:224-226`, `:230`). ADR-102's single-path decision (one interface, one
implementation, PBKDF2 only, constant-time compare, canonical-material guard) carries forward
unchanged; what this record replaces is its fixed, unstored work factor and its header-less format.
Revised 2026-10-26: anchors refreshed after the v1.252.0 changelog moved below later releases and
ADR-102 gained its Superseded banner. Revised 2026-10-28: the shared password strength rule is
recorded beside the work factor, the Context's reading of ADR-102 is narrowed to raising the
constant, and anchors refreshed after later releases moved them. Revised 2026-11-23: the
unknown-account burn now costs a legacy-record verification (600,000 iterations) through
`IPasswordHasher.BurnVerificationCost`, so the timing trade-off inverts (a wrong password on a
current-format account is now the cheaper branch), Store's server validators now apply the four
character classes, and anchors refreshed after later releases moved them.

## Context
ADR-102 recorded PBKDF2-HMAC-SHA512 with a 32-byte salt, a 64-byte digest and a compile-time
`Iterations = 600_000`, described as tracking OWASP guidance for that primitive
(`102-pbkdf2-only-password-hashing.md:56-57`). Its own Trade-offs named the cost of that shape:
verification recomputed with the same constant the write path used and no per-record count was
stored, so raising the constant would stop every stored credential from verifying
(`102-pbkdf2-only-password-hashing.md:155-163`; any other change to it breaks verification the same
way), and the format carried no version marker
(`:164-166`).

Two facts made the constant worth changing. First, the figure was wrong for the primitive: 600,000
is the OWASP Password Storage Cheat Sheet figure for PBKDF2-HMAC-**SHA256**, while its figure for
PBKDF2-HMAC-SHA512 is 210,000. The comment on the old constant presented 600,000 as the SHA-512
recommendation, so every hash cost roughly 2.9 times what the guidance asks for this primitive.

Second, the cost landed on availability. Password hashing was the measured CPU bottleneck at the
ADC 2026 venue, at about 0.3 to 0.5 core-seconds per hash. Anonymous callers pay that cost too: an
unknown address, or one with no stored credential, still burns one full derivation
(`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:201-210`,
`:955-963`), and a known address with a wrong password runs the real verification (`:212`). Behind
the venue NAT many attendees share one address, so ADC's per-IP auth limit had to be raised from its
default of 30 per minute to 300 per minute in conference mode
(`MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:116-119`,
`MMCA.ADC/infra/main.bicep:2340-2342`, `:2348`), which raises in step how
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
  `VersionedHashSize = HeaderSize + HashSize` (`:46`). `HashPassword` (`:67`) draws a 32-byte salt
  (`SaltSize = 32`, `:25`; `:71`), derives the digest (`:72`), writes the version byte (`:75`) and the
  big-endian count through `BinaryPrimitives.WriteInt32BigEndian` (`:76`), and copies the digest after
  the header (`:77`).
- **New hashes use 210,000 iterations.** `Iterations = 210_000` (`PasswordHasher.cs:34`), documented
  as the OWASP figure for PBKDF2-HMAC-SHA512 with 600,000 named as its SHA-256 figure (`:9-11`,
  `:31-32`). The primitive is unchanged: `Rfc2898DeriveBytes.Pbkdf2` with `HashAlgorithmName.SHA512`
  and a `HashSize` output (`:159-165`).
- **Legacy hashes still verify at 600,000.** A bare 64-byte hash is the earlier format and is read as
  `LegacyIterations = 600_000` (`PasswordHasher.cs:37`, `:16-17`, read at `:142-146`), so every
  account written under ADR-102 signs in unchanged.
- **The stored count is bounded, and anything else verifies nothing.** `TryReadIterations`
  (`PasswordHasher.cs:140`) accepts exactly the two shapes the hasher writes: the legacy length, or
  the versioned length with a `0x01` version byte (`:148`) and a count between
  `MinIterations = 100_000` (`:52`) and `MaxIterations = 2_000_000` (`:58`) inclusive (`:151`). The
  lower bound stops a tampered row from lowering the cost of guessing its password (`:48-51`); the
  upper bound caps the work one verification can be made to do, so a tampered row cannot turn a
  sign-in into a CPU denial of service (`:54-57`). Any other shape returns `false` (`:154-155`).
- **Verification derives at the stored count, then compares in constant time.** `VerifyPassword`
  (`PasswordHasher.cs:83`) keeps ADR-102's canonical-material guard, now admitting two shapes: the salt
  must be `SaltSize` bytes and the hash must pass `TryReadIterations` (`:96`), on the same stated ground
  that an empty hash-and-salt pair would otherwise verify any password (`:89-95`). It recomputes at
  the stored count (`:102`) and compares against the trailing `HashSize` bytes (`:101`) with
  `CryptographicOperations.FixedTimeEquals` (`:106`).
- **`NeedsRehash` reports an outdated record.** `IPasswordHasher` gains `NeedsRehash(byte[] hash)` as a
  default interface member answering `false`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/IPasswordHasher.cs:28`),
  so a custom hasher compiles unchanged and never triggers a rehash (`:20-25`). `PasswordHasher`
  overrides it (`PasswordHasher.cs:127-133`): true for a legacy 64-byte hash and for a versioned hash
  whose count differs from the current one, false for the current shape and for unrecognized material,
  which never verifies and so never reaches a rehash (`:122-126`).
- **The aggregate opts in through its own surface.** `IPasswordRehashableUser`
  (`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IPasswordRehashableUser.cs:16`) adds
  `RehashPassword(byte[], byte[])` (`:25`), kept separate from `ChangePassword` on purpose: a rehash
  keeps the same password, so it must not raise the password-changed event or anything a real change
  triggers, such as revoking sessions or notifying the owner (`:10-14`). A `User` that does not
  implement it keeps its stored hash as it is (`:8-9`).
- **The upgrade runs after a successful sign-in, best effort, on its own save.** `LoginAsync` calls
  `RehashPasswordIfNeededAsync` (`AuthenticationServiceBase.cs:295`) after the tokens are issued
  (`:281`); a wrong password returns at `:212-220` and never reaches it. The method (`:1001`) returns
  unless issuance succeeded and the user implements `IPasswordRehashableUser` (`:1003-1006`), then runs
  inside `BestEffort.ExecuteAsync` (`:1008`) under the operation name `password-rehash`
  (`PasswordRehashOperation`, `:85`) with `CancellationToken.None` (`:1031`). It checks `NeedsRehash`
  (`:1013`), hashes the verified plaintext (`:1018`), applies it through `RehashPassword` (`:1019`),
  logs and skips the save when the aggregate refuses it (`:1020-1027`), and otherwise saves through
  the unit of work on its own (`:1029`). A failure there cannot fail a sign-in that already
  succeeded; it is logged and counted, and the record is upgraded on a later sign-in (`:990-996`).
  The logger is a virtual property defaulting to `NullLogger.Instance` (`:153`), and a failed rehash
  is counted on the `MMCA.Common.BestEffort` meter whether or not it is overridden (`:150-151`).
- **The unknown-account burn costs a legacy-record verification.** `BurnPasswordVerificationCost`
  (`AuthenticationServiceBase.cs:955`) calls the hasher's `BurnVerificationCost` (`:962`), a second
  default interface member that discards one `HashPassword` (`IPasswordHasher.cs:39`) and is documented
  as costing what verifying the most expensive record the hasher can have stored costs (`:30-37`).
  `PasswordHasher` implements it as one derivation over a fresh salt at `BurnIterations`
  (`PasswordHasher.cs:114-119`), the larger of `Iterations` and `LegacyIterations`, so 600,000 today (`:60-64`). An unknown address,
  an account with no stored credential and a service account all take that branch
  (`AuthenticationServiceBase.cs:201-210`, `CanSignInWithPassword` at `:938-939`), so each costs the same
  as a wrong password against a legacy record (`:947-953`).
- **Both consuming apps opt in, without a domain event.** ADC's `User` implements
  `IPasswordRehashableUser`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Domain/Users/User.cs:39`); its `RehashPassword`
  (`:583`) validates the new hash and salt with the same `UserInvariants` checks (`:586-587`) and
  raises no event, while `ChangePassword` (`:556`) still raises `UserPasswordChanged` (`:570`).
  Store's `User` does the same
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Domain/Users/User.cs:30`, `RehashPassword`
  at `:231`, invariants at `:234-235`; `ChangePassword` at `:204` raising `UserPasswordChanged` at
  `:218`). MMCA.Helpdesk holds no password material: no `.cs` file under its `Source/` references
  `PasswordHash` or `IPasswordHasher`.
- **No schema migration.** Both consumers map `PasswordHash` without a maximum length, as
  `varbinary(max)`
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:36-39`,
  `MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Infrastructure/Persistence/EntityConfiguration/UserConfiguration.cs:29-32`),
  so a 69-byte value lands in the same column as a 64-byte one.
- **One shared password strength definition, applied where a consumer opts in.** `PasswordComplexity`
  (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/PasswordComplexity.cs:18`) defines the bounds as 8
  to 128 UTF-16 code units (`MinimumLength`, `:21`; `MaximumLength`, `:24`) and requires at least one
  uppercase letter, one lowercase letter, one decimal digit and one character that is neither a
  letter nor a digit, all Unicode-aware (`:27-43`). Its `Evaluate` checks the minimum length and the
  four classes only (`:52-57`); the upper bound is a separate rule (`:46-48`). On the server,
  `StrongPasswordRules`
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommonValidationRules.cs:190`, rules
  at `:193-200`) applies it, and it runs on Common's reset path
  (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/Validation/ResetPasswordRequestValidator.cs:23`)
  and on ADC's register and change-password requests
  (`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/Users/Validation/RegisterRequestValidator.cs:17`,
  `ChangePasswordRequestValidator.cs:18`). On the UI, `PasswordComplexityAttribute`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/PasswordComplexityAttribute.cs:15`)
  calls `Evaluate` (`:25`), and the 128 limit is a separate `[StringLength]`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/RegisterModel.cs:29-30`,
  `ResetPasswordModel.cs:27-28`). Store does not include `StrongPasswordRules`; its server validators
  apply the same `PasswordComplexity` bounds and four classes rule by rule
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/Validation/RegisterRequestValidator.cs:30-35`,
  `ChangePasswordRequestValidator.cs:22-27`), so Store's form and API accept the same passwords: Store
  declares no register page of its own and serves Common.UI's
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/Register.razor:1`, model at `:195`), and
  its profile page hosts the shared `ChangePasswordCard`
  (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.UI/Pages/Users/Profile/Profile.razor:107`),
  which checks `Evaluate`
  (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Components/Auth/ChangePasswordCard.razor.cs:120`). The
  rule is still not a gate every hash passes: the sign-in rehash hashes the already-verified
  plaintext with no strength check (`AuthenticationServiceBase.cs:1018`), and the seeder hashes seed
  passwords unvalidated
  (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/Seeding/IdentityModuleDbSeederBase.cs:121`).
- **The format, the counts and the upgrade are pinned by tests.**
  `PasswordHasherSecurityTests` pins `210_000`, `600_000`, 32, 64, 69 and `0x01`
  (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Auth/PasswordHasherSecurityTests.cs:25-30`);
  accepts a legacy 64-byte digest computed at 600,000 (`:36`) and a versioned one (`:55`); checks
  `HashPassword` against an independent known answer (`:69`); proves a stored count of 300,000 is
  honored and reported by `NeedsRehash` (`:88`); rejects out-of-range counts and unknown version
  bytes (`:107`) and a digest at 100,000 (`:124`); reads the private constants by reflection (`:143`,
  `:149`, `:155`, `:161`); keeps ADR-102's legacy-HMAC rejection (`:166`); walks non-canonical length
  pairs across both shapes (`:197`); rejects a valid header over an odd salt (`:211`); round-trips its
  own output (`:222`); and pins the burn at the larger work factor (`:235`) and at the cost of a
  legacy verification (`:244`).
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
- **Upgraded accounts are distinguishable by timing.** An unknown address burns a derivation at
  600,000 iterations (`PasswordHasher.cs:64`, `:118`), the same as a wrong password against a legacy
  account (`:144`, `:102`), while a wrong password against a current-format account verifies at
  210,000 (`AuthenticationServiceBase.cs:212`, `PasswordHasher.cs:34`). A caller timing failed logins
  can therefore tell a current-format account from a missing or legacy one. That fast set holds every
  account upgraded at sign-in and every hash written since the release, because `HashPassword` always
  writes the versioned format at `Iterations` (`PasswordHasher.cs:72-76`) and registration hashes
  through it (`AuthenticationServiceBase.cs:335`), so it grows as legacy hashes are rewritten. Registration
  already reveals whether an address exists: `RegisterAsync` returns
  `AuthErrorCodes.EmailAlreadyExists` for a taken address (`AuthenticationServiceBase.cs:332`, `:374`,
  `:1039-1041`).
- **The upgrade is opt-in.** An app whose `User` does not implement `IPasswordRehashableUser` keeps
  its legacy hashes indefinitely (`IPasswordRehashableUser.cs:8-9`), as does any custom hasher that
  does not override `NeedsRehash` (`IPasswordHasher.cs:28`).
- **The first sign-in after the change costs two derivations.** A legacy account verifies at 600,000
  (`AuthenticationServiceBase.cs:212`) and is then hashed at 210,000 (`:1018`), plus one extra save
  (`:1029`). Every later sign-in costs one derivation at 210,000.
- **New hashes resist offline guessing less than the old ones did.** A leaked table of current-format
  hashes costs an attacker 210,000 iterations per guess instead of 600,000. Accepted because that is
  the published figure for this primitive.
- **The work factor is still a compile-time constant** (`PasswordHasher.cs:34`), so changing it is a
  framework release rather than configuration; what changed is that the release no longer breaks
  stored credentials.
- **The format is now closed to unknown versions.** A version byte other than `0x01` verifies nothing
  (`PasswordHasher.cs:148`, `:154-155`), so a future format needs code that reads its marker before
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
- Signing in is cheaper for every account on the current format, and so is a failed attempt against
  one. An anonymous failed attempt that burns a derivation still costs 600,000 iterations
  (`PasswordHasher.cs:64`), so the per-IP limits a conference venue needs cost no less CPU on that
  branch.
- The legacy population shrinks as accounts sign in; while the hasher still accepts legacy records,
  the 600,000 read path, the 600,000 burn and the timing difference above all stay.
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

## Revision (2026-10-28)
Re-verified against current source. The format, the counts, the bounds and the upgrade path are
unchanged; the record now names the shared password strength definition and where it is applied,
the Context's reading of ADR-102 is narrowed, and anchors moved.

1. Decision gains a bullet for the shared strength definition: `PasswordComplexity`
   (`MMCA.Common/Source/Core/MMCA.Common.Shared/Auth/PasswordComplexity.cs:18`) sets 8 to 128 code
   units (`:21`, `:24`) and the four Unicode-aware character classes (`:27-43`, `:52-57`), and both
   `StrongPasswordRules` (`MMCA.Common/Source/Core/MMCA.Common.Application/Validation/CommonValidationRules.cs:191`,
   `:196-201`) and `PasswordComplexityAttribute`
   (`MMCA.Common/Source/Presentation/MMCA.Common.UI/Pages/Auth/PasswordComplexityAttribute.cs:15`,
   `:24`) use it. The server rule is opt-in: it runs on Common's reset path and on ADC's register
   and change-password requests, not on Store's server validators, the sign-in rehash or the
   seeder, so Store's form and API can disagree on the same input.
2. Context no longer says ADR-102's Trade-offs covered a change "in either direction": ADR-102 names
   only raising the constant (`102-pbkdf2-only-password-hashing.md:159-163`), so the record now says
   that and adds, as its own observation, that any other change breaks verification the same way.
3. Anchors re-verified against current source: the v1.252.0 entry is now
   `MMCA.Common/CHANGELOG.md:214` (heading), `:224-226` (`NeedsRehash`, `IPasswordRehashableUser`, the
   sign-in rehash) and `:230` (the versioned 69-byte format, 210,000 iterations, "Supersedes
   ADR-102"); the ADC per-IP auth limit explanation is
   `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:163-172` with the
   `AddCommonRateLimiting` call at `:173`; the conference-day reason for 30 -> 300/min is
   `MMCA.ADC/infra/main.bicep:2049-2051` and `RateLimiting__AuthIpPermitLimit = 300` is set at
   `:2057`; in `AuthenticationServiceBase.cs` the rehash guard is `:678-681`, `BestEffort.ExecuteAsync`
   `:683-684`, `NeedsRehash` `:688`, `HashPassword` `:693`, `RehashPassword` `:694`, the refusal path
   `:695-702`, the save `:704` and `CancellationToken.None` `:706`, and `EmailAlreadyExistsFailure` is
   `:714-716`.

## Revision (2026-11-23)
Re-verified against current source. The format, the counts, the bounds and the sign-in upgrade are
unchanged; the unknown-account burn now runs at the legacy work factor, which inverts the timing
trade-off, Store's server validators now check the character classes, and anchors moved.

1. Decision's burn bullet is rewritten: `BurnPasswordVerificationCost`
   (`MMCA.Common/Source/Core/MMCA.Common.Application/Auth/AuthenticationServiceBase.cs:955`) no
   longer discards a `HashPassword` but calls the new default interface member
   `IPasswordHasher.BurnVerificationCost` (`:962`;
   `MMCA.Common/Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/IPasswordHasher.cs:39`),
   which `PasswordHasher` implements at `BurnIterations`, the larger of the current and legacy counts
   (`MMCA.Common/Source/Core/MMCA.Common.Infrastructure/Auth/PasswordHasher.cs:64`, `:114-119`). The
   change is recorded in the v1.313.0 changelog entry (`MMCA.Common/CHANGELOG.md:78`). The branch now
   also covers service accounts (`AuthenticationServiceBase.cs:938-939`).
2. Trade-offs: "Legacy accounts are distinguishable by timing" is replaced by its inverse. An unknown
   address and a legacy account both cost 600,000 iterations, while a current-format account's wrong
   password costs 210,000, so upgraded accounts are the distinguishable ones and their number grows.
3. Consequences no longer say every anonymous failed attempt is cheaper: the burn branch costs
   600,000 iterations while legacy records are accepted.
4. Decision's strength bullet: Store's server validators now apply `PasswordComplexity`'s bounds and
   four classes rule by rule
   (`MMCA.Store/Source/Modules/Identity/MMCA.Store.Identity.Application/Users/Validation/RegisterRequestValidator.cs:30-35`,
   `ChangePasswordRequestValidator.cs:22-27`), so the earlier note that Store's form and API disagree
   on `aaaaaaaa` is removed. Store still does not include `StrongPasswordRules`.
5. Decision's tests bullet adds the two burn tests
   (`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests/Auth/PasswordHasherSecurityTests.cs:235`,
   `:244`).
6. Anchors re-verified against current source: in `PasswordHasher.cs`, `HashPassword` `:67` (salt
   `:71`, derive `:72`, header writes `:75-77`), `VerifyPassword` `:83` (guard `:96`, slice `:101`,
   recompute `:102`, `FixedTimeEquals` `:106`), `NeedsRehash` `:127-133`, `TryReadIterations` `:140`
   (legacy read `:142-146`, version check `:148`, range `:151`, fallthrough `:154-155`) and the PBKDF2
   call `:159-165`; in `AuthenticationServiceBase.cs`, the no-credential branch `:201-210`, the real
   verification `:212`, issuance `:281`, the rehash call `:295`, `PasswordRehashOperation` `:85`, the
   logger `:153` (meter note `:150-151`), the rehash method `:1001` (guard `:1003-1006`,
   `BestEffort.ExecuteAsync` `:1008`, `NeedsRehash` `:1013`, `HashPassword` `:1018`, `RehashPassword`
   `:1019`, refusal `:1020-1027`, save `:1029`, `CancellationToken.None` `:1031`) and
   `EmailAlreadyExistsFailure` at `:332`, `:374` and `:1039-1041`; ADC `User.cs:39` (`RehashPassword`
   `:583`, invariants `:586-587`, `ChangePassword` `:556`, event `:570`); Store `User.cs:30`
   (`RehashPassword` `:231`, invariants `:234-235`, `ChangePassword` `:204`, event `:218`); the ADC
   per-IP explanation `MMCA.ADC/Source/Services/MMCA.ADC.Identity.Service/Program.cs:116-119` (the
   host no longer calls `AddCommonRateLimiting` itself; the composed host registers the limiter) and
   `MMCA.ADC/infra/main.bicep:2340-2342` with `RateLimiting__AuthIpPermitLimit = 300` at `:2348`; the
   v1.252.0 entry `MMCA.Common/CHANGELOG.md:1151` (heading), `:1161` (`NeedsRehash`) and `:1167` (the
   versioned 69-byte format, 210,000 iterations, "Supersedes ADR-102"); `StrongPasswordRules`
   `CommonValidationRules.cs:190` (rules `:193-200`); the seeder `IdentityModuleDbSeederBase.cs:121`;
   the `PasswordComplexityAttribute` call to `Evaluate` `:25`; Store's form side, Common.UI's
   `Register.razor:1` (model `:195`) and Store `Profile.razor:107` hosting `ChangePasswordCard`
   (`Evaluate` at `ChangePasswordCard.razor.cs:120`); the timing trade-off's write path
   `PasswordHasher.cs:72-76` and registration hash `AuthenticationServiceBase.cs:335`; and the
   `PasswordHasherSecurityTests` pins `:25-30` with the test methods re-pointed in the Decision.

## Related
[ADR-102](102-pbkdf2-only-password-hashing.md) (the superseded record: the single PBKDF2 path, the
canonical-material guard and the tests this record keeps),
[ADR-032](032-password-hashing.md) (the original hasher and its call sites),
ADR-029 (authentication brute-force protection: lockout and rate limiting wrap the same login path
whose cost this record lowers),
[ADR-036](036-external-oauth-login.md) (external OAuth login: the credential-free account shape the
guard still rejects on the password path).
