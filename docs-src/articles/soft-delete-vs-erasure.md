# Soft-delete vs the right to erasure: the GDPR conflict and the erasure pathway

> Series: MMCA.Common · Article #36 · Pillar P3/P4 · Groups G07, G24 · Rubric §30 · ADR-005 + ADR-047 + ADR-119 ·
> Status: grounded in `Website/docs-src/adr/005-soft-delete-vs-erasure.md`,
> `Website/docs-src/adr/047-soft-deleted-user-session-revocation.md`,
> `Website/docs-src/adr/119-restrict-delete-by-default.md`, `Website/docs-src/governance/common-ArchitectureScorecard.md:110`
> (§30, Maturity 3 / Implementation 8), `MMCA.Common/CLAUDE.md`, and
> `Website/docs-src/onboarding/group-24-identity-module.md`.
> No em dashes.

**Subtitle:** Soft-delete is the right default for lifecycle and audit. It is also, by itself, illegal
for personal data under GDPR. This is the story of scoring that conflict 1 out of 4 in public, then
fixing it.

---

Here is a deletion model almost every serious .NET app converges on, and it is correct:

```csharp
public void Delete() => IsDeleted = true;   // never actually remove the row
```

Nothing is hard-deleted. A global query filter excludes `IsDeleted = true` rows from normal queries, so
deleted records vanish from the app, but the data stays in the table. This is exactly what you want for
audit (you can prove what existed and when), referential integrity (a deleted parent does not orphan
its children), and undelete (a fat-fingered delete is recoverable). MMCA.Common does the same, with one
refinement: `AuditableBaseEntity.Delete()` flips `IsDeleted` and returns a `Result` (idempotent, so a
double delete fails cleanly instead of silently), EF Core global query filters exclude the row, and the
documented invariant is "entities are never hard-deleted."

Now read that same model through a privacy lawyer's eyes. A user invokes their **right to erasure**
(GDPR Article 17, the right to be forgotten; CCPA deletion). They want their personal data *gone*. You
run your delete. The row, including their name, their email, every personal field, stays in the
database indefinitely, merely hidden from the application. You have not erased anything. You have hidden
it.

**Soft-delete and right-to-erasure are in direct conflict.** The mechanism that makes lifecycle correct
is the same mechanism that makes privacy non-compliant. And if your published privacy policy promises
"we delete your data within 30 days," soft-delete cannot honor it.

## Why it matters, and why I am telling on myself

When I first graded MMCA.Common against an architecture rubric and committed the scorecard to the
repo, **the original single-axis snapshot scored Compliance, Privacy & Data Governance at the bottom:
a 1 out of 4, the lowest category on that early scorecard.** The evidence was blunt: soft-delete
everywhere with no erasure or anonymization mechanism, processed outbox payloads retained forever, no PII
classification or data-subject-request scaffolding. The exact GDPR/CCPA conflict the rubric names,
sitting unaddressed in the framework's defaults.

I could have quietly designed around it before publishing. I did the opposite: I scored it low, wrote
the gap down with its evidence, and shipped the scorecard with the red flag intact. The reason is the
whole thesis of scoring yourself in public. **The gaps are the roadmap.** A category that scores 1 with
honest evidence is worth more than a category that scores 3 because nobody looked hard. This article is
the "then I fixed it" half of that story, and the fix is ADR-005. On today's two-axis rubric, with
ADR-005 shipped, the same category now scores Maturity 3 / Implementation 8.

## The MMCA answer: separate the two concerns, give each a mechanism

The wrong fix is to overload `Delete()` so it hard-deletes personal data. That would break audit,
undelete, and referential integrity all at once, trading one defect for three. ADR-005 instead
separates the two concerns, because they answer different questions:

- **Soft-delete answers "is this record active?"** It stays the default for lifecycle and state
  management: hide, retain, undelete. It is explicitly *not* a privacy mechanism.
- **Erasure answers "has this person's data been removed?"** It is an explicit, additive capability,
  built on a new extension point rather than bolted onto delete.

That erasure pathway is the `IAnonymizable` interface (in `MMCA.Common.Domain.Interfaces`). An aggregate
that holds personal data implements it. An application-layer erasure handler loads the aggregate, calls
`Anonymize()`, and saves. `Anonymize()` overwrites the personal fields **in place**, so the row, its
foreign keys, and its audit trail all survive. The record still exists for integrity and accountability;
the person is no longer in it. The operation is idempotent and returns a `Result`, matching the
framework's domain conventions, so a retried erasure request is a safe no-op success.

```csharp
// The hook: aggregates that store personal data implement this.
public interface IAnonymizable
{
    Result Anonymize();   // idempotent: a second call is a no-op success
}

// ADC's User aggregate (an IAnonymizable AuditableAggregateRootEntity) implements it.
// Anonymize() overwrites every [Pii] field in place, including a crafted
// deleted-{Id}@anonymized.invalid email that KEEPS the unique-email invariant
// holding across many erased accounts. Audit fields and foreign keys survive.
```

This is the entity-level half of the split. In a consumer app (ADC's `User`), `Delete()` flips
`IsDeleted` for lifecycle *and* `Anonymize()` scrubs the data for a right-to-be-forgotten request, and
they are deliberately separate operations. The delete handler calls both in one transaction to honor
the "erase within 30 days" promise, and `Delete()` raises a `UserDeleted` domain event rather than
touching credentials. Outstanding refresh sessions need no separate revocation: the refresh flow
re-fetches the account through the same soft-delete query filter, so the moment the erasure commits
there is no account left to mint a fresh access token for. (The access token the user is already
holding is cut off separately, at runtime, which is its own section below.) For the fields a service chooses to keep retrievable after
anonymization rather than overwrite, ADR-005 offers an AES-256-GCM `EncryptedStringConverter`, so
"keep this usable" and "protect it at rest" need not be in tension. ADC's `User` takes the simpler
route: `Anonymize()` overwrites every `[Pii]` field (`Email`, `FirstName`, `LastName`, and the
`AvatarUrl` added with the avatar feature) in place and keeps none, so it does not wire the converter
at all. The converter is a framework capability for the
service that needs it, not a default.

There is one more piece that turns this from a convention into a guarantee: an **architecture fitness
test** asserts that any entity declaring a `[Pii]` property also implements `IAnonymizable`. You cannot
tag a field as personal data and then forget to give it an erasure path, because the build fails if you
do. The classification (`[Pii]`) and the obligation (an anonymize path) are wired together and enforced
by an executable rule, not left to a code review to remember. That is the §34 "executable governance"
idea applied to privacy: the rule that protects data subjects is a test, not a paragraph in a wiki.

The `[Pii]` marker carries a second duty: log and telemetry redaction. `PiiRedactor` masks every
`[Pii]`-marked member with a `[REDACTED]` token before an entity that holds personal data is written to
a structured log, and a `PiiErasureContractFitnessTests` build gate runs a `[Pii]`-bearing sample
through both the redactor and `Anonymize()` end to end, so neither half of the `[Pii]` contract can be
advertised without being exercised. The framework now wires the redactor into one production path of
its own: the opt-in field-level audit trail, whose save-changes interceptor asks the redactor whether a
type carries personal data and, for the properties that do, writes the redaction token in place of both
the old and the new value of the recorded change. One honest caveat for logging: `PiiRedactor` is still
an opt-in utility you call at the log site, not an auto-wired Serilog/ILogger destructuring policy. It
protects the call sites that adopt it, not every log line by default, so wiring it in is still the
consumer's job.

## The delete that really removes rows: restrict by default

Soft-delete keeps the row. Anonymization keeps the row and destroys the person inside it. Physical
erasure, a real `DELETE` that takes rows out of the table, is a third thing, and the database will do
it on your behalf unless you say otherwise. EF Core picks a delete behavior for any relationship
nobody configured: a required one cascades, so removing a parent removes its children in the
database, below the aggregate's invariants, below the soft-delete filter, and below the domain events
the rest of the system reacts to. That is a destructive default nobody wrote down, and it sits
underneath every privacy story above.

ADR-119 inverts it. `RestrictDeleteByDefaultConvention`
(`Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/RestrictDeleteByDefaultConvention.cs:41`)
is an `IModelFinalizingConvention` that makes `DeleteBehavior.Restrict` the default for every
relationship nobody configured, registered per engine by the shared `ApplicationDbContext` at model
finalization (`Persistence/DbContexts/ApplicationDbContext.cs:394`). A delete that would orphan rows
fails loudly instead of quietly taking the children with it, and a genuine cascade becomes a decision
somebody recorded with `.OnDelete(DeleteBehavior.Cascade)` in an entity configuration. Two things are
deliberately left alone: an ownership foreign key keeps the cascade EF requires, and any behavior a
configuration already chose is kept exactly as chosen.

```csharp
// Registered per engine, applied when the model is finalized.
configurationBuilder.Conventions.Add(_ => new RestrictDeleteByDefaultConvention(DataSourceKey.Engine));

// Every foreign key leaves the finalized model stamped with where its behavior came from:
//   "Explicit"  = an entity configuration chose it
//   "Convention" = this convention restricted it
//   "Ownership"  = an owned type's cascade, which EF owns
```

That stamp is the point as much as the restrict is. Each foreign key carries a
`MMCA:DeleteBehaviorSource` annotation (`:47`) holding `Explicit` (`:50`), `Convention` (`:53`) or
`Ownership` (`:56`), and `DeleteBehaviorConventionTestsBase`
(`Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Domain/DeleteBehaviorConventionTestsBase.cs:21`)
reads exactly that annotation to assert every cascading relationship was opted into on purpose. The
convention is a no-op on Cosmos, which has no foreign key constraints to restrict.

For a privacy story the payoff is direct: with restrict as the default, physically removing personal
data is always an explicit decision with a name attached, never something that happens as a side
effect of a required foreign key. Erasure stays a deliberate operation (`Anonymize()`), lifecycle
stays a deliberate operation (`Delete()`), and row removal is the third deliberate operation rather
than the one the ORM chose for you.

## The second hiding place: the outbox

There was a second source of retained personal data, and it is the kind of thing you only find when you
go looking honestly. The **transactional outbox** (ADR-003) writes an event row in the same transaction
as the state change, and those serialized event payloads can contain personal data. The outbox
processor only set `ProcessedOn`; nothing ever purged processed rows. ADR-003 itself admitted the table
"grows until cleaned up." So even after you anonymized a user's aggregate, their personal data could
still be sitting in old, processed outbox payloads forever.

ADR-005 closes that too: `OutboxCleanupService` purges processed outbox rows older than
`Outbox:RetentionDays` (default 7, set 0 to disable) across every relational data source. Bounded
retention without changing delivery semantics. It is worth flagging as a deliberate **behavior change**:
consumers upgrading the framework start purging processed outbox rows older than seven days unless they
opt out, which is the kind of thing that belongs in a CHANGELOG and an ADR rather than a surprise in
production.

## The live session: cutting off a token mid-flight

Anonymizing the aggregate and committing the soft-delete shuts two doors: no future logins, and no
silent re-mint of a fresh access token, because the refresh flow re-fetches the account through the
same soft-delete query filter
(`Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:103-107`).
There is a third door, though, and stateless auth
holds it open by design. Authentication is stateless JWT (ADR-004): every service validates an access
token by signature and expiry, with no per-request lookup against the account store. That is exactly
what makes it scale, and it is also why soft-deleting a user does not, on its own, stop a token that was
already issued. A bearer credential keeps passing validation until it expires on its own clock, which
can be minutes after the account was deactivated.

ADR-047 bounds that window. `SoftDeletedUserMiddleware`
(`Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:31`, business rule
BR-133 named in its class doc at `:11`) runs in the shared pipeline **after authentication and before authorization**.
That ordering is a declarative step list (ADR-079):
`Startup/Pipeline/MiddlewarePipelineBuilder.cs` registers `UseAuthentication()` at `:117`, the
`SoftDeletedUserFilter` step that adds the middleware at `:137`, and `UseAuthorization()` at `:141`.
So `HttpContext.User` is already populated and the check
gates every downstream endpoint. For an authenticated caller whose account has been soft-deleted, it
returns HTTP 401 mid-flight, before the endpoint runs. The account-status lookup goes through
`ISoftDeletedUserValidator`
(`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ISoftDeletedUserValidator.cs:7`,
one `IsUserSoftDeletedAsync` method at `:15`), which each Identity module implements with a single
filter-bypassing existence query, and the boolean result is cached for roughly 30 seconds
(`SoftDeletedUserCache.MarkerDuration`, `Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:29`,
consumed by the middleware at `SoftDeletedUserMiddleware.cs:132`). So a given user costs at most one status query per cache window per
cache scope, not one per request. The effect is a **bounded revocation window**, not instant
revocation: a deactivated user's still-valid access token stops working within about the cache duration
instead of at the token's own expiry.

Two honest edges. Anonymous requests pass straight through with no lookup
(`SoftDeletedUserMiddleware.cs:65-73`), so unauthenticated traffic pays nothing. And the validator is
resolved lazily (`SoftDeletedUserMiddleware.cs:75`) rather than injected as a parameter, so a host that
does not register one (a non-Identity extracted service, or MMCA.Helpdesk's single Tickets host) simply
no-ops on that check: Identity is the source of truth and already validated the token upstream. Lazy
resolution is what keeps one pipeline correct in both Identity-hosting and non-Identity hosts without a
per-host variant.

## The other right: portability, and why it degrades instead of failing

Erasure has a sibling that lands in the same regulation and is usually built badly. The right to data
portability means a user can ask for everything you hold about them, and once your modules own
separate databases, that request is a fan-out across services rather than one query.

The shape MMCA.ADC uses starts where you would expect, with the fan-out itself living in the
framework. `ExportUserDataHandlerBase` assembles a shared `UserDataExportDTO` envelope; the
app fills in the two genuinely app-specific parts. ADC projects its own account fields into a
`UserDataExportSubjectDTO`, deliberately excluding credentials (password hash and salt, refresh token,
external-provider key), since a data export that ships a password hash has turned a privacy feature
into a breach. The cross-service personal data arrives beside it as sections: ADC registers one
`IUserDataExportSection` per peer, Engagement and Notification, and over a process boundary those
contracts are the same gRPC adapters everything else uses.

The interesting decision is what happens when a peer is down:

```csharp
catch (Exception ex) when (ex is not OperationCanceledException)
{
    // Best-effort: the contributor failed after whatever resilience pipeline it uses.
    // Degrade the section instead of failing the whole export. The reason handed back is
    // deliberately generic; the exception detail goes to the log, never to the subject.
    UserUseCaseLog.ExportSectionUnavailable(logger, ex, sectionName, userId);

    return new UserDataExportSectionDTO
    {
        SectionName = sectionName,
        Available = false,
        UnavailableReason = UserDataExportSectionDefaults.UnavailableReason,
    };
}
```

A section degrades to `Available = false` and the export completes. One peer outage never fails the
whole export. That catch now lives once, in the base, wrapping every registered section, so a section a
consumer adds tomorrow inherits the behavior instead of re-implementing it (and the section
contributors deliberately catch nothing themselves).

That is worth sitting with, because the instinct runs the other way. A partial export feels wrong,
and the tidy engineering answer is to fail the request so the user retries and gets everything. In
practice that is the worse outcome: a user exercising a legal right against a four-service system
would be blocked by any one service having a bad afternoon, and you have converted a routine
availability blip into a compliance failure. Marking the section explicitly unavailable is more
honest than both alternatives, because it neither pretends the data is absent nor blocks the parts
that are ready.

Two details keep it honest rather than sloppy. `OperationCanceledException` is deliberately excluded
from the catch, so a genuine cancellation propagates instead of being silently recorded as a missing
section. And the degradation is logged at warning with the section name and user id, so "this export
was incomplete" is an operational event someone can find later, not a silent gap in a file the user
already downloaded.

The transferable rule: in a distributed system, "all or nothing" is a choice with a cost, and for a
read-only aggregation the cost is usually higher than partial success. Make the partiality explicit
in the payload and loud in the logs, and it stops being a lie.

## Trade-offs, honestly

The framework provides the **mechanisms** (`IAnonymizable`, `OutboxCleanupService`); the consumer owns the
**policy**. That division is the most important caveat, and ADR-005 states it plainly.

- **Erasure is opt-in per entity.** An aggregate that holds personal data but does not implement
  `IAnonymizable` will not be erased. Consumers must audit their own personal-data inventory and
  implement the interface where it applies. The framework cannot find your PII for you.
- **The framework cannot make you compliant on its own.** It ships the mechanism, not the obligation.
  The consumer is the data controller: it still has to wire the erasure handler, the data-subject
  request flow, and the access/export endpoint, because the personal-data model lives in the consumer
  (ADC's `User`, with `[Pii]`-tagged fields, and its own `UserDataExportSubjectDTO` inside the shared
  export envelope, deliberately omitting secrets). This ADR provides the mechanisms, not the policy.
- **Anonymization is irreversible by design, and it is not undelete.** Soft-delete is recoverable;
  erasure is not. Conflating them would be a bug. They are separate operations precisely because they
  must behave differently.
- **The default 7-day outbox retention is a behavior change** on upgrade, as noted above.

None of these are reasons to skip the mechanism. They are the boundary between what a framework can give you
(a correct, audit-preserving mechanism) and what only you can decide (which data is personal, and what
your privacy policy promised).

## Apply this even without MMCA

The pattern is independent of the framework:

1. **Keep soft-delete for lifecycle.** It is the right tool for "is this active?", and audit / undelete
   / referential integrity all depend on it. Do not throw it out.
2. **Do not overload delete to satisfy erasure.** Hard-deleting personal data inside your soft-delete
   path breaks audit and integrity. Add a *separate* erasure operation.
3. **Anonymize in place.** Overwrite personal fields with placeholders, keeping the row and its foreign
   keys. Craft replacement values that preserve invariants (a unique-email constraint needs a unique
   anonymized email per record). Make it idempotent so retried requests are safe.
4. **Hunt the second hiding place.** Personal data leaks into event logs, outbox tables, message
   payloads, and caches. Give every store that can hold PII a bounded retention policy.
5. **Write down where the framework stops and your obligation starts.** A library gives you the
   mechanism; classifying your PII and honoring your privacy policy is your job as the data controller.

The takeaway: **soft-delete and erasure answer different questions, so give them different mechanisms.**
And if you are going to grade your own architecture, grade it honestly. The category I scored a 1 became
the most useful entry on the scorecard, because it turned straight into ADR-005 and a real erasure pathway.

---

**What we covered:** why soft-delete (the right default for lifecycle and audit) directly conflicts
with the GDPR/CCPA right to erasure, why the original single-axis snapshot scored it at the bottom (1
out of 4, now Maturity 3 / Implementation 8 on the two-axis rubric), and how ADR-005 resolves it by
separating the concerns: an `IAnonymizable` anonymize-in-place hook
that preserves the audit trail, plus an `OutboxCleanupService` that bounds retention of PII-bearing
outbox payloads, with the consumer owning the policy. And how ADR-047's `SoftDeletedUserMiddleware`
closes the third door, cutting off an already-issued access token mid-flight within roughly a 30-second
cache window instead of letting it live to its own expiry.

**Next in the series:** the reusable Blazor UI framework that brings the same backend discipline to
the front end, a server-paged list page in a few lines.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-005 behind this
decision, or read the §30 scorecard entry, the most honest one on the board.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-005 (soft-delete vs right-to-erasure): `Website/docs-src/adr/005-soft-delete-vs-erasure.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, GDPR, Data Privacy*

*Notes (verified 2026-07-28, corrected 2026-08-07, re-verified 2026-09-19 at framework v1.205.0):
`AuditableBaseEntity.Delete()` (flips `IsDeleted`, returns a `Result`; `public virtual Result Delete()`
at `Domain/Entities/AuditableBaseEntity.cs:67`, `IsDeleted = true` at `:77`), EF global query filters,
`IAnonymizable` (`MMCA.Common.Domain.Interfaces:22-31`, idempotent `Result`-returning `Anonymize()`
declared at `:30`), ADC `User` (`MMCA.ADC/.../Identity.Domain/Users/User.cs:34-35` declares FIVE
interfaces, `IPasswordChangeableUser, IUserPreferences, IErasableUser, IEmailConfirmableUser,
IAuditedEntity` (`IAuditedEntity` is the non-behavioural marker that opts the aggregate into the
field-level audit trail; `IEmailConfirmableUser` carries the proven-reachable flag, ADR-116), and
`IErasableUser` extends `IAnonymizable`, so the aggregate is `IAnonymizable` transitively rather than
by a direct declaration. `Anonymize()` at `:465-503` overwrites every `[Pii]` field with placeholders
incl. the `deleted-{Id}@anonymized.invalid` email built at `:470` preserving the unique-email
invariant, early-returns idempotently at `:476-480`, clears the credential/device/provider fields at
`:485-495`, nulls `AvatarUrl` at `:496`, clears `IsEmailConfirmed` at `:500` (the placeholder address
was never proven reachable, so the flag cannot keep asserting that it was), and retains none;
`public new Result Delete()` at `:443` calls `base.Delete()` at `:445` and, on success,
`AddDomainEvent(new UserDeleted(Id))` at `:448`. CORRECTION (2026-09-19): the earlier ledger and body
claim that `Delete()` revokes a refresh token is retired as false. The aggregate declares no
`RefreshToken` member at all (zero matches this run); refresh sessions are their own aggregate, and
`DeleteUserHandlerBase` states the model in place at
`Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:103-107`:
outstanding refresh sessions are not revoked at erasure and do not need to be, because the refresh
flow re-fetches the user through the same soft-delete query filter, and an app that also wants the
rows tidied revokes them from its `OnAfterSoftDeleteAsync` tail via `IRefreshSessionStore`), the
Delete + Anonymize workflow (framework-owned since this article was first written:
`DeleteUserHandlerBase.HandleAsync` calls `erasable.Delete()` at `:115` and `erasable.Anonymize()` at
`:129`, both persisted by ONE `SaveChangesAsync` at `:135`, with the app tail `OnAfterSoftDeleteAsync`
running between them at `:122` and the ADR-047 marker write `SoftDeletedUserCache.MarkDeletedAsync`
owned by the base itself at `:142-144`; ADC's 87-line `DeleteUserHandler.cs` subclasses it at `:29-35`
and overrides `OnAfterSoftDeleteAsync` (`:43-74`) to raise the cross-service `UserDeleted` integration
event on the aggregate (`:59`, so the outbox row commits with the erasure) and to schedule the
avatar-blob delete INSIDE the erasure transaction as an ADR-114 durable internal command,
`DeleteAvatarBlobInternalCommand` (`:68-71`, `ScheduleAvatarBlobDeletionAsync` at `:76-86`), whose
scheduling failure fails the erasure at `:85`; the class doc records at `:25-27` that the shared
soft-deleted marker is the base's job, so the handler holds no marker write and no `LoggerMessage`.
Precision the body does not need but the ledger should carry: ADC's `DeleteUserCommand` implements
`ICacheInvalidating, ITransactional, IUserOwnedRequest`
(`.../UseCases/DeleteUser/DeleteUserCommand.cs:22`), and its doc at `:9-10` records why
`ITransactional` is load-bearing (the soft-delete flag, the anonymized personal data, the
`UserDeleted` outbox row and the internal-command row commit as one write), so the body's "calls both
in one transaction" is literal rather than EF's implicit single-`SaveChanges` transaction),
the export envelope `UserDataExportDTO`, hoisted into the framework at
`MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:15` (ADC's subject snapshot
is `UserDataExportSubjectDTO` at
`.../Identity.Shared/Users/DataExport/UserDataExportSubjectDTO.cs:16`, whose doc-comment records the
deliberate credential exclusion, password hash/salt, refresh token and opaque external-provider key,
at `:6-7`), `OutboxCleanupService`
(`Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxCleanupService.cs:47`,
`Outbox:RetentionDays` default 7, 0 disables,
`.../Persistence/Outbox/Administration/OutboxSettings.cs:65`).
The `[Pii]`-implies-`IAnonymizable` architecture fitness rule is real and verified in source
(`Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Governance/PiiConventionTestsBase.cs:12`,
`EntitiesWithPiiProperties_ShouldImplement_IAnonymizable`). CONFIRMED: the
doc-comment's second mechanism, PII log-masking, is implemented, `PiiRedactor`
(`Domain/Privacy/PiiRedactor.cs:24-142`, masks every `[Pii]` member with the `[REDACTED]` token, `:27`),
`PiiRedactorTests` (`Tests/Core/MMCA.Common.Domain.Tests/Privacy/PiiRedactorTests.cs`, 7 `[Fact]`s) plus a
`PiiErasureContractFitnessTests` build gate
(`Tests/Architecture/MMCA.Common.Architecture.Tests/Governance/PiiErasureContractFitnessTests.cs:19`,
a 107-line file) that forces a `[Pii]`-bearing `DataSubjectSample` through both the redactor and
`Anonymize()`. CAVEAT (recorded 2026-08-14, still current): `PiiRedactor` has one production call
site. `AuditTrailSaveChangesInterceptor` calls `PiiRedactor.HasPii(entry.Metadata.ClrType)`
at `Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSaveChangesInterceptor.cs:286`
(one cached reflection pass per entity type) and writes `PiiRedactor.RedactedToken` into both `OldValue`
and `NewValue` for a `[Pii]` property at `:309-310`. That path is opt-in (`AuditTrailSettings.Enabled`
has no initializer, so it defaults to false: `Infrastructure/Settings/AuditTrailSettings.cs:26`, ADR-075).
The NARROWER caveat still holds and is what the body says: for logs and telemetry the redactor
remains an opt-in utility a caller invokes at the log site, NOT an auto-wired Serilog/ILogger
destructuring policy. CONFIRMED: `EncryptedStringConverter` is real AES-256-GCM but is wired to NO
entity field in ADC or Store (usages only in its own tests + the
`IAnonymizable` doc-comment at `Domain/Interfaces/IAnonymizable.cs:17-18`; ADR-037 records zero
production columns encrypted), so it is framed as ADR-005's conditional capability, not as something the
ADC `User` uses. FIX 1 (2026-08-01, anchors refreshed 2026-09-19): the ADC `User` `[Pii]` enumeration
was one field short. `User.cs`
carries FOUR `[Pii]` properties, not three: `Email` (attribute `:51`, property `:52`), `FirstName`
(`:55`/`:56`), `LastName` (`:59`/`:60`) and `AvatarUrl` (`:118`, added with the avatar feature,
ADR-045). Every one of those anchors moved this run (the new `IsEmailConfirmed` member and its doc
block pushed the members down); the COUNT of four is unchanged. `Anonymize()` does null all four
(`AvatarUrl = null` at `:496`), so "overwrites every `[Pii]` field" stayed true, and the parenthetical
names `AvatarUrl` too. FIX 2 (2026-07-28, updated 2026-09-19): the section 30 scorecard anchor has
moved repeatedly since this article's original `:94` citation: `:96`, `:98`, `:100`, `:102` and now
`:110`, its current line. Its VALUES are unchanged across all six anchors:
`| 30 | Compliance, Privacy & Governance | 2 | 3 | 8 | 6/16 |`, weight 2,
Maturity 3, Implementation 8, weighted 6/16. FIX 3 (2026-08-01, anchors rebased 2026-08-15): the
AES-256-GCM anchor for `EncryptedStringConverter` was stale at `:31,34` (those lines are unrelated
doc-comment prose). The AES-256-GCM claim now lives at
`Infrastructure/Persistence/Encryption/EncryptedStringConverter.cs:10-11`, and the 12-byte nonce /
16-byte tag sizing is documented at `:39-40` and enforced by `NonceSize = 12` (`:78`) and
`TagSize = 16` (`:81`). The stored layout is a versioned envelope, Base64 of
`[key version (1)][nonce (12)][ciphertext (N)][tag (16)]` (assembled at
`:203-208`), written under a ring of versioned keys whose current version stamps every write (`:109`)
and whose version byte travels as AES-GCM associated data so the tag authenticates it (`:198`,
`:231`), which puts per-value overhead at 29 bytes. Nothing this section relies on changed:
AES-256-GCM, the 12-byte nonce, the 16-byte tag, and the zero-adopters posture all hold, so the body
sentence (ADR-005 offers an AES-256-GCM `EncryptedStringConverter` for fields a service keeps
retrievable after anonymization, and ADC's `User` does not wire it) stays true, and ADR-037 Decision
item 10 (`:135-140`) still records adoption as zero. Section 30 in the CURRENT two-axis scorecard
scores Maturity 3 / Implementation 8
(`Website/docs-src/governance/common-ArchitectureScorecard.md:110`), NOT the single lowest; the original
1-out-of-4 belongs to the retired single-axis snapshot, and the deliberate framing here is scored against
that original committed snapshot, then fixed, then re-scored. FLAGGED (2026-09-19): that
1-out-of-4 value and its "lowest category" superlative have no live evidence path, because the
current scorecard file carries only the two-axis rubric; the article frames both as history, which is
the honest framing, but neither is checkable against anything on disk. The latest re-score is the
THIRTY-SIXTH wave (2026-09-19, framework v1.205.0), which moved no score: section 30 Maturity 3 to 4
was refused again, its tenth-plus consecutive refusal, and section 30 Implementation 8 to 9 was one of
eight refuted implementation proposals, so both indices hold (Maturity index `:120`, 97.0%, 318/328;
Implementation index `:121`, 86.0%, 705/820; "N/A (excluded from denominators): none this cycle"
bullet `:124`, re-confirmed 2026-09-19, Sigma-weight 82 with section 16 scored M3/I6). The latest
actual move is the thirty-fifth wave's section 16 AI-Native Maturity 2 to 3 and Implementation 5 to 6
(2026-09-15), which was never section 30's own. The 7-day
outbox-retention default is a documented behavior change on upgrade. The ADR-047 section ("The live
session") is re-verified in source this run: `SoftDeletedUserMiddleware` (declared at
`Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:31`, BR-133 named in its
class doc at `:11`) runs after authentication and before authorization, and that ordering is a
declarative step list (ADR-079) rather than inline `app.Use...` calls: the steps are registered in
`Source/Presentation/MMCA.Common.API/Startup/Pipeline/MiddlewarePipelineBuilder.cs`, with
`UseAuthentication()` at `:117`, the `SoftDeletedUserFilter` step that adds the middleware at `:137`
and `UseAuthorization()` at `:141` (`TenantResolution` `:125` and `UseRateLimiter()` `:133` sit
between them). `WebApplicationExtensions.cs` registers no middleware of its own; it calls
`MiddlewarePipelineBuilder.CreateDefault()` at `:142`, so the old
`WebApplicationExtensions.cs:96/:109/:110` anchors are retired. The middleware returns
HTTP 401 for an authenticated caller when the account is soft-deleted (cached-true path `:102-106`,
fresh-query path `:143-147`); anonymous requests pass through
with no lookup (`SoftDeletedUserMiddleware.cs:65-73`); the status check is behind
`ISoftDeletedUserValidator`, which moved one folder deeper this run to
`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ISoftDeletedUserValidator.cs:7`
(single `IsUserSoftDeletedAsync` at `:15`, line anchors unchanged), resolved LAZILY via
`context.RequestServices.GetService<ISoftDeletedUserValidator>()` (`SoftDeletedUserMiddleware.cs:75`,
null-validator pass-through `:76-83`, rationale documented at `:43-51`) so
non-Identity hosts (extracted services, MMCA.Helpdesk) no-op. FIX 4 (2026-08-14): the 30-second constant is
not in the middleware and is not named `CacheDuration`. It is
`public static TimeSpan MarkerDuration => TimeSpan.FromSeconds(30)`
(`Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:29`), consumed by the middleware's
cache write at `SoftDeletedUserMiddleware.cs:132`; the middleware only mentions "30-second cache" in
prose at `:13`. The substance is unchanged: the boolean is cached per user per cache scope, bounding the
stateless-JWT (ADR-004) revocation window to roughly the cache duration instead of the token lifetime.
Nuance the body does not state and does not contradict: the check fails OPEN on a cache or validator
error (rationale `:18-29`, validator catch `:118-125`), a deliberate trade-off bounded by the 15-minute
access-token lifetime and by the soft-delete query filter the refresh flow re-reads.
The entity-split paragraph is re-framed this run to match `User.Delete()` as it stands: the erasure
commits a soft-delete and a `UserDeleted` domain event, outstanding refresh sessions stop working
because the refresh flow re-fetches through the soft-delete filter, and the forward pointer to the
runtime cut-off is kept so the paragraph does not read as instant session death. The
onboarding-chapter reference (`group-24-identity-module.md`, G24) is
unchanged and still current. 2026-07-27 coverage addition: the section "The other right: portability,
and why it degrades instead of failing" was added to close a recorded gap, GDPR data-subject export
was previously mentioned only in passing here while the article taught erasure alone.
STRUCTURAL REWRITE (2026-08-14): the whole export fan-out was hoisted out of ADC into MMCA.Common
(ADR-076), so the section's prose, its quoted code block, and every anchor in it are re-grounded.
ADC's `ExportUserDataHandler.cs` is a 78-line thin subclass of
`ExportUserDataHandlerBase<User, ExportUserDataQuery>` (declared `:30-35`) overriding only
`HasExportPrivilege` (`:38`) and `BuildSubjectSnapshotAsync` (`:41-77`); it contains NO catch block at
all, and its class doc restates the contract at `:23-28`. The degradation is ONE generic
per-section catch in the base:
`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/ExportUserDataHandlerBase.cs:185-198`
inside `RunSectionAsync`, which calls
`UserUseCaseLog.ExportSectionUnavailable(logger, ex, sectionName, userId)` at `:190` and returns a
`UserDataExportSectionDTO` with `Available = false` and
`UnavailableReason = UserDataExportSectionDefaults.UnavailableReason`. The quoted block is verbatim
from those lines, comment lines included. The warning-level log message text
("Data-subject export section {Section} unavailable for user {UserId}; export continues
with Available=false") is the `LoggerMessage`-generated
`UserUseCaseLog.ExportSectionUnavailable` (`MMCA.Common.Application/Users/UserUseCaseLog.cs:25-26`,
moved down three lines by a new `SoftDeletedMarkerFailed` entry at `:22-23`). The
`when (ex is not OperationCanceledException)` filter that lets a genuine cancellation propagate
appears ONCE, in the base at `:185`, with the base class doc stating "Cancellation is not degradation."
at `:35`. ADC contributes peers as `IUserDataExportSection` implementations instead
(`.../ExportUserData/EngagementUserDataExportSection.cs`, `NotificationUserDataExportSection.cs`),
which deliberately catch nothing (doc-comment `:12-16`) and read cross-service through
`IUserEngagementExportService` (in-process inside the Engagement service, a gRPC adapter everywhere
else, `MMCA.ADC.Engagement.Contracts/UserEngagementExportServiceGrpcAdapter.cs:18-19`, the class
declaration; the old `:15` anchor lands mid-doc-comment, and the adapter rationale is at `:10-16`).
The pattern is framework code, which is why it belongs beside the framework
erasure mechanism this article already teaches rather than in its own piece.
NEW SECTION (2026-09-19), "The delete that really removes rows: restrict by default", grounded in
ADR-119 (`Website/docs-src/adr/119-restrict-delete-by-default.md`, Accepted 2026-09-11, revised
2026-09-19 to record adopted state across ADC, Store and Helpdesk):
`RestrictDeleteByDefaultConvention(DataSource engine) : IModelFinalizingConvention` is declared at
`Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/RestrictDeleteByDefaultConvention.cs:41`
and makes `DeleteBehavior.Restrict` the default for every relationship nobody configured (rationale,
including EF's cascading default running below the aggregate, below the soft-delete filter and below
the domain events, at `:9-19`). It is registered per engine by the shared `ApplicationDbContext` at
`Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:394`
(`configurationBuilder.Conventions.Add(_ => new RestrictDeleteByDefaultConvention(DataSourceKey.Engine))`),
which is the code block's first line, quoted verbatim. Ownership foreign keys keep the cascade EF
requires and a configured behavior is never overridden (`:21-27`). Every foreign key is stamped with
the `DeleteBehaviorSourceAnnotation` constant `MMCA:DeleteBehaviorSource` (`:47`), valued
`ExplicitSource` "Explicit" (`:50`), `ConventionSource` "Convention" (`:53`) or `OwnershipSource`
"Ownership" (`:56`); the code block's comment lines paraphrase those three values and are
illustrative of the documented shape rather than a quotation. `DeleteBehaviorConventionTestsBase`
(`Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Domain/DeleteBehaviorConventionTestsBase.cs:21`)
reads exactly that annotation to assert every cascading relationship was opted into on purpose, and
the convention is a documented no-op on Cosmos, which has no foreign key constraints to restrict
(`:34-38`). `ProcessModelFinalizing` is at `:59`.*

- Full series index: https://ivanball.github.io/writing.html
