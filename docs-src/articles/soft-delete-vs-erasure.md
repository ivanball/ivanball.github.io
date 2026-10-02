# Soft-delete vs the right to erasure: the GDPR conflict and the erasure pathway

> Series: MMCA.Common · Article #36 · Pillar P3/P4 · Groups G07, G23 · Rubric §30 · ADR-005 + ADR-047 + ADR-076 + ADR-095 + ADR-119 ·
> Status: grounded in `Website/docs-src/adr/005-soft-delete-vs-erasure.md`,
> `Website/docs-src/adr/047-soft-deleted-user-session-revocation.md`,
> `Website/docs-src/adr/095-soft-delete-unique-indexes.md`,
> `Website/docs-src/adr/119-restrict-delete-by-default.md`, `Website/docs-src/governance/common-ArchitectureScorecard.md:94`
> (§30, Maturity 3 / Implementation 8), `Website/docs-src/onboarding/00-primer.md:193`, and
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
refinement: `AuditableBaseEntity.Delete()` flips `IsDeleted` and returns a `Result` (guarded, so a
double delete fails cleanly with an `AlreadyDeleted` error instead of silently succeeding), EF Core
global query filters exclude the row, and the documented invariant is "entities are never hard-deleted."

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
advertised without being exercised. The framework wires the redactor into one production path of
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
(`Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/RestrictDeleteByDefaultConvention.cs:42`)
is an `IModelFinalizingConvention` that makes `DeleteBehavior.Restrict` the default for every
relationship nobody configured, registered per engine by the shared `ApplicationDbContext` at model
finalization (`Persistence/DbContexts/ApplicationDbContext.cs:399`). A delete that would orphan rows
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
`MMCA:DeleteBehaviorSource` annotation (`:48`) holding `Explicit` (`:51`), `Convention` (`:54`) or
`Ownership` (`:57`), and `DeleteBehaviorConventionTestsBase`
(`Source/Hosting/MMCA.Common.Testing.Architecture/Bases/Domain/DeleteBehaviorConventionTestsBase.cs:21`)
reads exactly that annotation to assert every cascading relationship was opted into on purpose. The
convention is a no-op on Cosmos, which has no foreign key constraints to restrict.

For a privacy story the payoff is direct: with restrict as the default, physically removing personal
data is always an explicit decision with a name attached, never something that happens as a side
effect of a required foreign key. Erasure stays a deliberate operation (`Anonymize()`), lifecycle
stays a deliberate operation (`Delete()`), and row removal is the third deliberate operation rather
than the one the ORM chose for you.

## The row that still holds its slot: filtered unique indexes

Soft-delete has one more leak, and it is the database disagreeing with the application. The global
query filter says a deleted row does not exist; a unique index still counts it. Delete a speaker and
the email's unique index keeps refusing a new speaker with that email, with an error the user cannot
act on, because the conflicting row is invisible to them.

ADR-095 makes the fix a convention rather than a per-index habit. `SoftDeleteUniqueIndexConvention`
(`Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/SoftDeleteUniqueIndexConvention.cs:34`)
is a model-finalizing convention registered once by the shared `ApplicationDbContext`
(`Persistence/DbContexts/ApplicationDbContext.cs:392`), so it reaches every module, every database and
every consumer with nothing to opt into. At finalization it walks every non-owned `IAuditableEntity`
type (`:46-47`) and filters every unique index on it (`:61-64`) on that engine's soft-delete
predicate (`= false` on PostgreSQL, `= 0` on the other relational engines), built by the same
`SoftDeleteFilterSql.Build` that the opt-in `HasSoftDeleteFilter` uses (`:55-57`), so the automatic
and the manual path cannot disagree about quoting or column name. An index that already declares its
own filter keeps it and gains the soft-delete clause with `AND` (`:80`); a filter that already
constrains the soft-delete column is left exactly as it is (`:73-76`), so a second model build never
appends the clause twice. SQL Server, PostgreSQL and SQLite are covered, and Cosmos is a no-op
(`:29-30`, the relational check at `:43-44`).

Privacy and uniqueness meet here. An erased `User` already frees its real address, because
`Anonymize()` rewrites the email to a per-row `deleted-{Id}@anonymized.invalid` placeholder; for every
other soft-deleted record that keeps its values, it is the filter that frees the slot. ADR-095 states
the cost plainly: any number of deleted rows may share a "unique" value, so an undelete path has to
handle a collision with the live row that took the slot, and the filter is invisible where the index
is declared (it first appears in a generated migration).

## The second hiding place: the outbox

There is a second source of retained personal data, and it is the kind of thing you only find when you
go looking honestly. The **transactional outbox** (ADR-003) writes an event row in the same transaction
as the state change, and those serialized event payloads can contain personal data. Marking a row
processed does not remove it, and ADR-003 records the consequence: the outbox table grows until
processed entries are cleaned up. So without a purge, even after you anonymized a user's aggregate,
their personal data could still be sitting in old, processed outbox payloads forever.

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
(`Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs:107-111`).
There is a third door, though, and stateless auth
holds it open by design. Authentication is stateless JWT (ADR-004): every service validates an access
token by signature and expiry, with no per-request lookup against the account store. That is exactly
what makes it scale, and it is also why soft-deleting a user does not, on its own, stop a token that was
already issued. A bearer credential keeps passing validation until it expires on its own clock, which
can be minutes after the account was deactivated.

ADR-047 closes that door. `SoftDeletedUserMiddleware`
(`Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:33`, business rule
BR-133 named in its class doc at `:11`) runs in the shared pipeline **after authentication and before authorization**.
That ordering is a declarative step list (ADR-079):
`Startup/Pipeline/MiddlewarePipelineBuilder.cs` registers `UseAuthentication()` at `:105`, the
`SoftDeletedUserFilter` step that adds the middleware at `:124-125`, and `UseAuthorization()` at `:129`.
So `HttpContext.User` is already populated and the check
gates every downstream endpoint. For an authenticated caller whose account has been soft-deleted, it
returns HTTP 401 mid-flight, before the endpoint runs.

The check reads a shared deleted-user marker first. The erasure handler writes that marker itself,
right after the erasure is saved (`SoftDeletedUserCache.MarkDeletedAsync`,
`DeleteUserHandlerBase.cs:146-148`), and the marker lasts 15 minutes
(`SoftDeletedUserCache.MarkerDuration`, `Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:32`),
the default access-token lifetime, because it has to outlive every token issued before the delete.
Every host honors it (`SoftDeletedUserMiddleware.cs:102-109`), so on any host that shares that cache
the deleted user's token is refused on its next request, not at its own expiry. On a cache miss, a
host that runs Identity falls back to `ISoftDeletedUserValidator`
(`Source/Core/MMCA.Common.Application/Interfaces/Infrastructure/Auth/ISoftDeletedUserValidator.cs:7`,
one `IsUserSoftDeletedAsync` method at `:15`), which the framework implements once as
`SoftDeletedUserValidator<TUser>` (`Source/Core/MMCA.Common.Application/Users/SoftDeletedUserValidator.cs:20`),
a single filter-bypassing existence query that an Identity module closes over its own `User` at
registration. The middleware caches that answer asymmetrically: "deleted" as the 15-minute marker,
"not deleted" for only 30 seconds (`NotDeletedLookupDuration`, `SoftDeletedUserMiddleware.cs:39`,
chosen at `:147`). So a live user costs at most one status query per 30 seconds per cache scope, not
one per request.

The marker write is best effort: a failure is logged and the erasure still succeeds
(`DeleteUserHandlerBase.cs:150-153`). That failure is the one case with a residual window. An
Identity host still catches the deleted account once any cached "not deleted" answer lapses, within
30 seconds; a host with no validator has nothing to fall back to, so the existing access token stays
usable until it expires, which is exactly what the logged warning says (`DeleteUserHandlerBase.cs:199-200`).

Two honest edges. Anonymous requests pass straight through with no lookup
(`SoftDeletedUserMiddleware.cs:74-82`), so unauthenticated traffic pays nothing. And the validator is
resolved lazily (`SoftDeletedUserMiddleware.cs:111`) rather than injected as a parameter, so a host that
does not register one (a non-Identity extracted service, or MMCA.Helpdesk's single Tickets host) still
honors the marker and passes only a cache miss through (`:112-119`): Identity is the source of truth,
and the marker carries what it decided. Lazy
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
    ExportSectionUnavailable(logger, ex, sectionName, userId);

    return new UserDataExportSectionDTO
    {
        SectionName = sectionName,
        Available = false,
        UnavailableReason = UserDataExportSectionDefaults.UnavailableReason,
    };
}
```

A section degrades to `Available = false` and the export completes. One peer outage never fails the
whole export. That catch lives once, in the base, wrapping every registered section, so a section a
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
closes the third door, cutting off an already-issued access token mid-flight through a shared
deleted-user marker the erasure writes as it saves, instead of letting the token live to its own expiry.

**Next in the series:** the reusable Blazor UI framework that brings the same backend discipline to
the front end, a server-paged list page in a few lines.

*MMCA.Common is Apache-2.0 licensed and open source. Star the repo, read the 2-minute ADR-005 behind this
decision, or read the §30 scorecard entry, the most honest one on the board.*
- ⭐ Repo: `https://github.com/ivanball/MMCA.Common`
- 📄 ADR-005 (soft-delete vs right-to-erasure): `Website/docs-src/adr/005-soft-delete-vs-erasure.md` in the docs site.

*Tags: .NET, C Sharp, Software Architecture, GDPR, Data Privacy*

*Notes (verified 2026-07-28, corrected 2026-08-07, re-verified 2026-09-19, refreshed 2026-10-02 at
framework v1.221.0). Anchors marked (re-read) were opened in source this run; anchors marked (audit)
were re-read by the 2026-10-02 audit (`Reports/update-medium/2026-10-02/36.json`) and not reopened here.
DOMAIN: `public virtual Result Delete()` at `MMCA.Common/Source/Core/MMCA.Common.Domain/Entities/AuditableBaseEntity.cs:67`,
guard `:69-75` returning `Error.AlreadyDeleted` (`:72`), `IsDeleted = true` at `:77` (re-read). FIX
(2026-10-02): the body called `Delete()` "idempotent", which contradicts the failure on a second call;
it now reads "guarded". The "entities are never hard-deleted" invariant is documented at
`Website/docs-src/onboarding/00-primer.md:193` and `group-02-domain-building-blocks.md:644` (re-read);
the header no longer cites `MMCA.Common/CLAUDE.md`, which is only an `@AGENTS.md` import and holds no
such phrase. `IAnonymizable` is `Domain/Interfaces/IAnonymizable.cs:22-31`, `Result Anonymize()` at
`:30`, idempotency contract in its doc at `:26-28` (re-read); the `EncryptedStringConverter` mention
in its doc at `:17-18` (audit). ADC `User` (audit, all unchanged): `MMCA.ADC/.../Identity.Domain/Users/User.cs:34-35`
declares five interfaces incl. `IErasableUser`, which extends `IAnonymizable`
(`MMCA.Common/Source/Core/MMCA.Common.Domain/Auth/IErasableUser.cs:30`); four `[Pii]` properties,
`Email` `:51`/`:52`, `FirstName` `:55`/`:56`, `LastName` `:59`/`:60`, `AvatarUrl` attribute `:118`,
property `:120`; `Anonymize()` `:465-503`, placeholder email `:470`, idempotent early return
`:476-480`, credential/device/provider clears `:485-495`, `AvatarUrl = null` `:496`,
`IsEmailConfirmed` cleared `:500`; `public new Result Delete()` `:443` calling `base.Delete()` `:445`
and raising `UserDeleted` `:448`; no `RefreshToken` member.
ERASURE WORKFLOW (re-read): `Source/Core/MMCA.Common.Application/Users/UseCases/DeleteUser/DeleteUserHandlerBase.cs`,
refresh-session model stated at `:107-111`, `erasable.Delete()` `:119`, `OnAfterSoftDeleteAsync`
`:126`, `erasable.Anonymize()` `:133`, ONE `SaveChangesAsync` `:139`, marker write
`SoftDeletedUserCache.MarkDeletedAsync` `:146-148` with its best-effort catch `:150-153`, the
`SoftDeletedMarkerFailed` warning (`LoggerMessage` on the base) `:199-200`. The `afterCommit` doc at
`:180-182` says the marker is written after the save and, under an `ITransactional` command, before
the commit, so the body says "as it saves" rather than "after commit". All five handler anchors moved
+4 from the 2026-09-19 ledger. ADC (audit): `DeleteUserHandler.cs` (87 lines) subclasses at `:29-35`,
overrides `OnAfterSoftDeleteAsync` `:43-74`, integration event `:59`, avatar-blob internal command
`:68-71`, `ScheduleAvatarBlobDeletionAsync` `:76-86`, failure `:85`, class doc `:25-27`;
`DeleteUserCommand.cs:22` implements `ICacheInvalidating, ITransactional, IUserOwnedRequest`, the
`ITransactional` rationale at `:9-14`.
NEW SECTION (2026-10-02, user-approved fold-in), "The row that still holds its slot", grounded in
ADR-095 (`Website/docs-src/adr/095-soft-delete-unique-indexes.md`, Accepted 2026-08-23, revised
2026-08-26 and 2026-10-01) and in source (re-read):
`Source/Core/MMCA.Common.Infrastructure/Persistence/Conventions/SoftDeleteUniqueIndexConvention.cs:34`
declares `SoftDeleteUniqueIndexConvention(DataSource engine) : IModelFinalizingConvention`; the
speaker-email example is its remarks at `:11-17`; non-owned `IAuditableEntity` scope `:46-47`;
unique-only `:61-64`; shared `SoftDeleteFilterSql.Build` `:55-57`; hand-authored filter extended with
`AND` `:80`; existing soft-delete clause left alone `:73-76`; engine coverage `:29-30`; relational
check `:43-44`. Registered once at
`Source/Core/MMCA.Common.Infrastructure/Persistence/DbContexts/ApplicationDbContext.cs:392` (comment
`:389-391`). The per-engine predicate (`= false` on PostgreSQL, `= 0` elsewhere) is
`Persistence/SoftDeleteFilterSql.cs:31`. The undelete-collision and invisible-filter costs are
ADR-095 Trade-offs (`:145-160`). UPSTREAM FLAG: ADR-095 cites the class at `:33` and the registration
at `ApplicationDbContext.cs:393`; current source is `:34` and `:392`, and its `SoftDeleteFilterSql.cs`
ranges no longer match that file's layout. This article cites source, not the ADR's anchors.
RESTRICT BY DEFAULT (re-read, all moved +1): `RestrictDeleteByDefaultConvention.cs:42`, annotation
`MMCA:DeleteBehaviorSource` `:48`, `Explicit` `:51`, `Convention` `:54`, `Ownership` `:57`,
`ProcessModelFinalizing` `:60`, rationale `:15-20`, left-alone `:22-28`, Cosmos no-op `:35-39`;
registered at `ApplicationDbContext.cs:399` (the code block's first line, verbatim; comment
`:394-398`). `DeleteBehaviorConventionTestsBase.cs:21` (audit). ADR-119 Accepted 2026-09-11, revised
2026-09-19 (audit).
OUTBOX: `OutboxCleanupService` declared at
`Source/Core/MMCA.Common.Infrastructure/Persistence/Outbox/Administration/OutboxCleanupService.cs:42`
(re-read; was `:47`); `Outbox:RetentionDays` default 7, 0 disables, `OutboxSettings.cs:65` (audit).
FIX (2026-10-02): the body quoted ADR-003 as "grows until cleaned up", which is not its text; it now
paraphrases `Website/docs-src/adr/003-outbox-dual-dispatch.md:56` ("The outbox table grows until
processed entries are cleaned up") without quotation marks, and the section is in present tense.
PII (re-read unless marked): `PiiConventionTestsBase.cs:12` `EntitiesWithPiiProperties_ShouldImplement_IAnonymizable`
(audit); `Domain/Privacy/PiiRedactor.cs` is 145 lines, class `:24-145`, token `:27` (audit for `:27`);
`PiiRedactorTests.cs` has 9 `[Fact]`s and no `[Theory]` (was 7); `PiiErasureContractFitnessTests.cs:19`
(audit). The one production call site: `AuditTrailSaveChangesInterceptor.cs:287`
(`PiiRedactor.HasPii`), `RedactedToken` into `OldValue`/`NewValue` at `:310-311`; opt-in via
`AuditTrailSettings.Enabled` (no initializer) at
`Source/Core/MMCA.Common.Infrastructure/Persistence/AuditTrail/AuditTrailSettings.cs:26` (path
corrected from `Infrastructure/Settings/`). For logs the redactor remains an opt-in call-site utility,
not an auto-wired destructuring policy. `EncryptedStringConverter` (audit, all unchanged):
AES-256-GCM `Infrastructure/Persistence/Encryption/EncryptedStringConverter.cs:10-11`, layout doc
`:39-40`, `NonceSize = 12` `:78`, `TagSize = 16` `:81`, versioned envelope `:203-208`, key version
`:109`, associated data `:198`/`:231`; zero references in `MMCA.ADC/Source` or `MMCA.Store/Source`;
ADR-037 Decision item 10 starts `:122`, zero adoption at `:136-141`.
SCORECARD (re-read): section 30 row `Website/docs-src/governance/common-ArchitectureScorecard.md:94`
(was `:110`), `| 30 | Compliance, Privacy & Governance | 2 | 3 | 8 | 6/16 |`, values unchanged.
Indices as stamped at `:5` (evidence 2026-10-01 at v1.218.0): Maturity `:9` 317/328 = 96.6% (was
97.0%, 318/328), Implementation `:10` 705/820 = 86.0%; N/A bullet `:104` reads "none." with
Sigma-weight 82; section 16 row `:80` is M4/I9 (was M3/I6). Section 30 itself did not move. The
original single-axis 1-out-of-4 snapshot: the 2026-09-19 FLAG (no live evidence path) is resolved by
the audit, which located it in MMCA.Common git history at commit f5180991, `ArchitectureScorecard.md:42`
(score 1, "Lowest score") and `:74` ("the single lowest category score").
LIVE SESSION (re-read; REFRAMED 2026-10-02): `SoftDeletedUserMiddleware` declared at
`Source/Presentation/MMCA.Common.API/Middleware/SoftDeletedUserMiddleware.cs:33` (was `:31`), BR-133
at `:11`, class doc `:13-15` says the marker is honored on every host. Pipeline steps in
`Source/Presentation/MMCA.Common.API/Startup/Pipeline/MiddlewarePipelineBuilder.cs`: `UseAuthentication()`
`:105`, `TenantResolution` `:108`, `UseRateLimiter()` `:121`, `SoftDeletedUserFilter` `:124-125`,
`UseAuthorization()` `:129`; `WebApplicationExtensions.cs:170` calls `MiddlewarePipelineBuilder.CreateDefault()`.
Anonymous pass-through `:74-82`; cached-true 401 `:102-109`; lazy
`GetService<ISoftDeletedUserValidator>()` `:111`; no-validator pass-through on a miss `:112-119`
(rationale `:49-60`); validator query `:127-129`; fresh-query 401 `:160-164`; fail-open rationale
`:18-31`, cache-read catch `:92-100`, validator catch `:131-138`. `NotDeletedLookupDuration = TimeSpan.FromSeconds(30)`
at `:39`, chosen against `MarkerDuration` at `:147`. `SoftDeletedUserCache.MarkerDuration =>
TimeSpan.FromMinutes(15)` at `Source/Core/MMCA.Common.Application/Auth/SoftDeletedUserCache.cs:32`,
rationale `:23-30` (must outlive the access token; equals the default 15-minute lifetime,
`JwtSettings.cs:61`, audit). `ISoftDeletedUserValidator.cs:7`, `IsUserSoftDeletedAsync` `:15`;
implemented once by the framework as
`Source/Core/MMCA.Common.Application/Users/SoftDeletedUserValidator.cs:20` (single filter-bypassing
`ExistsAsync` at `:31-34`), closed over ADC's `User` at
`MMCA.ADC/Source/Modules/Identity/MMCA.ADC.Identity.Application/DependencyInjection.cs:37`. FIX
(2026-10-02): the body's "cached roughly 30 seconds, bounded revocation window" and "a host with no
validator no-ops" were both false against current source (changed in Common #473); the section now
teaches the 15-minute marker written by the base, honored everywhere, with 30 seconds only for a
"not deleted" answer and the residual window confined to a failed marker write. UPSTREAM FLAGS:
ADR-047 (`:78-89`, `:162-183`, `:242`) still documents `MarkerDuration = FromSeconds(30)`, so this
section is grounded in source rather than the ADR; and the middleware's own remarks
(`SoftDeletedUserMiddleware.cs:27-28`) say deletion "already revoked the refresh token", which
contradicts `DeleteUserHandlerBase.cs:107-111`. The article follows the handler.
EXPORT (re-read unless marked): `MMCA.Common/Source/Core/MMCA.Common.Shared/Privacy/UserDataExportDTO.cs:15`
(audit); ADC `UserDataExportSubjectDTO.cs:16`, credential exclusion `:6-7` (audit). The quoted block
is verbatim from
`MMCA.Common/Source/Core/MMCA.Common.Application/Users/UseCases/ExportUserData/ExportUserDataHandlerBase.cs:185-198`,
whose `:190` calls the base's private `ExportSectionUnavailable` `LoggerMessage` (Warning, declared
`:201-202`); FIX (2026-10-02): the block's `UserUseCaseLog.` qualifier is removed, since
`UserUseCaseLog.cs` no longer exists. "Cancellation is not degradation." at `:35` (audit). ADC
`ExportUserDataHandler.cs` (78 lines, audit): declared `:30-35`, `HasExportPrivilege` `:38`,
`BuildSubjectSnapshotAsync` `:41-77`, no catch, class doc `:23-28`; `NotificationUserDataExportSection`
doc `:11-15` (audit). `MMCA.ADC.Engagement.Contracts/UserEngagementExportServiceGrpcAdapter.cs`
declares the class at `:19-20`, doc and rationale `:10-18` (was `:18-19`, `:10-16`).
HEADER (2026-10-02): ADR cell gains ADR-095; Status adds ADR-095 and `00-primer.md:193`, scorecard
anchor `:94`. Header reconciled with `README.md:46` in this run: group G23 is the ADC Identity module (published as
`group-24-identity-module.md`; group IDs and file numbers differ, `00-group-taxonomy.md:79`), and ADR-076
is added because the export section relies on it. Other facts (audit): four ADC service hosts, Apache-2.0 license,
next article #37 (`README.md:47`), `group-24-identity-module.md` exists.*

- Full series index: https://ivanball.github.io/writing.html
