# ADR-057: Expand/Contract Schema Evolution Enforced as a CI Gate

## Status
Accepted (2026-07-28). Revised 2026-08-01: the diff now fails **closed** in both repos (the `|| true`
is gone and MMCA.Store's `build-and-test` checkout sets `fetch-depth: 0`), so the fail-open trade-off
recorded on acceptance is now history rather than current behavior. Revised 2026-09-19: the
combined-archive migration projects the pathspec carve-out described have been deleted (both repos
are per-module migration projects only), the guard steps are additionally gated on
`needs.changes.outputs.code`, MMCA.Helpdesk's CI now has four jobs and one of them applies a
migration in a generated seed app, and MMCA.Common now commits one real EF Core migration as a test
fixture. The decision itself is unchanged.

## Context
ADR-030 decides **who** applies a migration: every service host runs `DatabaseInitStrategy = Migrate`
and self-applies its pending EF Core migrations at startup as the sole migrator, with no deploy-step
`sqlcmd` backstop (`MMCA.Store/.github/workflows/deploy.yml:1421-1429`,
`MMCA.ADC/.github/workflows/deploy.yml:1550-1559`). It says nothing about what **shape** a migration
may take.

That gap is load-bearing because production rollback is **revision-only**. When the post-deploy smoke
gate fails, the deploy rolls every container app back to its previous revision with
`az containerapp revision copy --from-revision` (`MMCA.Store/.github/workflows/deploy.yml:1606`,
`MMCA.ADC/.github/workflows/deploy.yml:1715`). That reverts the **image** and nothing else:
the new revision already migrated the database on boot, and no down-migration runs. The previous
release therefore keeps serving traffic against the **new** schema, which is exactly the statement
both repos' CONTRIBUTING makes (`MMCA.Store/CONTRIBUTING.md:56-59`, `MMCA.ADC/CONTRIBUTING.md:57-60`).
A `DropColumn` shipped alongside the code that stopped reading it makes the rollback path a broken
release rather than a recovery.

The existing build-time gate does not cover this. `dotnet ef migrations has-pending-model-changes`
(`MMCA.Store/.github/workflows/deploy.yml:414-428`, `MMCA.ADC/.github/workflows/deploy.yml:435-449`)
asserts a migration **exists** for every model change; it has no opinion on whether that migration is
survivable one release back. The gate below is the shape rule that ADR-030 left open. It arrived in
MMCA.ADC with the 2026-07-19 security/resilience/ops review batch (commit `adee5058`, PR #38) and was
ported to MMCA.Store on 2026-07-25 (commit `1dfdc991`, PR #52).

## Decision
Schema changes follow **expand/contract**, and a CI step enforces the contract half.

- **Expand now, contract later, as a written rule.** Adding nullable columns, new tables and new
  indexes is safe in any release; `DropColumn` / `DropTable` / `DropIndex` belong to a LATER release,
  once no revision that reads the old shape can still be rolled back to
  (`MMCA.Store/CONTRIBUTING.md:61-64`, `MMCA.ADC/CONTRIBUTING.md:62-65`).
- **A migration ADDED by a PR may not drop without a marker.** The `Expand/contract migration guard
  (schema rollback safety)` step fails the build when a newly added migration's `Up()` matches
  `\.(DropColumn|DropTable|DropIndex)\s*(<[^>]*>)?\s*\(` and the same `Up()` body does not carry the
  override marker (`MMCA.Store/.github/workflows/deploy.yml:430-481`, regex at `:470`;
  `MMCA.ADC/.github/workflows/deploy.yml:234-282`, regex at `:274`). Those three operations are the entire matched set.
- **The marker's documented format is one comment line:**
  `// EXPAND-CONTRACT-OVERRIDE: <why this drop is safe one release back>`
  (`MMCA.Store/CONTRIBUTING.md:72-74`, `MMCA.ADC/CONTRIBUTING.md:73-75`). What the step actually
  enforces is looser: `grep -q 'EXPAND-CONTRACT-OVERRIDE'` over the `Up()` body
  (`MMCA.Store/.github/workflows/deploy.yml:474`, `MMCA.ADC/.github/workflows/deploy.yml:275`), so the
  token must appear inside `Up()`, but the `//` prefix, the colon and the reason text are convention,
  not validation.
- **"Added by this PR" means git-added, base-relative, path-scoped.** The step fetches the PR base and
  runs `git diff --diff-filter=A --name-only "origin/<base_ref>...HEAD"` limited to
  `Source/Hosting/MMCA.Store.Migrations.SqlServer.*/Migrations/*.cs` (respectively
  `MMCA.ADC.Migrations.SqlServer.*`) (`MMCA.Store/.github/workflows/deploy.yml:457-458`,
  `MMCA.ADC/.github/workflows/deploy.yml:258-259`). `*.Designer.cs` files are skipped explicitly
  (`MMCA.Store/.github/workflows/deploy.yml:469-471`, `MMCA.ADC/.github/workflows/deploy.yml:270-272`),
  the model snapshot is a modification rather than an addition so it never enters the list, and the
  dot before the wildcard means only per-module migration projects match. Today that is every
  migration project in both repos: `MMCA.Store.Migrations.SqlServer.{Catalog,Identity,Sales}` and
  `MMCA.ADC.Migrations.SqlServer.{Conference,Engagement,Identity,Notification}`
  (`MMCA.Store/Source/Hosting/`, `MMCA.ADC/Source/Hosting/`), so nothing in either tree sits outside
  the pathspec.
- **Only the `Up()` body is scanned.** The body is extracted with
  `awk '/protected override void Up\(/{flag=1} /protected override void Down\(/{flag=0} flag'`
  (`MMCA.Store/.github/workflows/deploy.yml:472`, `MMCA.ADC/.github/workflows/deploy.yml:273`), because
  every additive migration's `Down()` legitimately drops what `Up()` added and `Down()` never runs at
  startup: down-migration is explicit tooling only.
- **It is a merge gate, not a deploy gate.** The step lives in the `build-and-test` job, which both
  repos run only on `pull_request` (`MMCA.Store/.github/workflows/deploy.yml:260`,
  `MMCA.ADC/.github/workflows/deploy.yml:225`) and document as a required merge check
  (`MMCA.Store/CONTRIBUTING.md:37-38`, `MMCA.ADC/CONTRIBUTING.md:37-38`). Nothing re-checks the shape
  on the push to `main` that deploys. The step also carries the repo-wide change filter
  `if: needs.changes.outputs.code == 'true'`
  (`MMCA.Store/.github/workflows/deploy.yml:431`, `MMCA.ADC/.github/workflows/deploy.yml:235`), so a
  PR the `changes` job classifies as docs-only skips the guard entirely. That is not a hole: `code`
  goes false only when every changed file is Markdown
  (`MMCA.Store/.github/workflows/deploy.yml:192-193`, `MMCA.ADC/.github/workflows/deploy.yml:138-139`), and a PR that adds a migration `.cs` file always
  sets it true.
- **The common legitimate override is an index rebuilt in place.** Adding INCLUDE columns or a filter
  emits a `DropIndex` immediately followed by a `CreateIndex` under the same name, which a
  one-release-back revision reads as a superset of what it expects
  (`MMCA.Store/CONTRIBUTING.md:76-78`). The live markers say exactly that:
  `MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer.Sales/Migrations/20260725133726_AddOutboxInboxRetentionIndexes.cs:13-17`
  (outbox pending index gains INCLUDE columns) and
  `MMCA.ADC/Source/Hosting/MMCA.ADC.Migrations.SqlServer.Identity/Migrations/20260720031638_CommonV1120OutboxLeaseAndSoftDeleteIndexFilters.cs:14-17`
  (unique index gains an `[IsDeleted] = 0` filter). The second legitimate case is an index replaced by
  a wider composite with the same leading column, reasoned out in
  `MMCA.Store/Source/Hosting/MMCA.Store.Migrations.SqlServer.Sales/Migrations/20260725044543_AddOrderStatusAndCreatedOnIndexes.cs:13-17`.

**Adoption is partial, and deliberately so at the deployed repos only.** MMCA.ADC and MMCA.Store both
run the gate, in identical form. **MMCA.Helpdesk does not have it**: none of its four CI jobs carries
an expand/contract step (`changes` at `MMCA.Helpdesk/.github/workflows/ci.yml:17`, `build-and-test`
at `:58`, `template-smoke` at `:120`, `postgresql-canary` at `:146`). One of them does run
migrations: `postgresql-canary` installs `dotnet-ef` (`:180-186`) and then runs
`build/templates/canary-postgresql.ps1` (`:191-193`), which scaffolds an `InitialCreate` and applies
it against a real PostgreSQL service container
(`MMCA.Helpdesk/build/templates/canary-postgresql.ps1:197`, `:222`). That proves a generated seed
app migrates on a second engine; it says nothing about the shape of migrations this repo commits.
Helpdesk's own tree
already carries an unmarked `DropIndex` in an `Up()` body
(`MMCA.Helpdesk/Source/Hosting/MMCA.Helpdesk.Migrations.SqlServer.Tickets/Migrations/20260725121253_AddOutboxInboxRetentionIndexes.cs:13-16`),
which is consistent: Helpdesk has no deploy workflow and therefore no revision-rollback model to
protect. **MMCA.Common does not have it either, and cannot**: the framework ships no consumer-facing
migrations, and there is no `Migrations` directory anywhere in the repo. The one real EF Core
migration it commits is a test fixture, `CreateMigrationProofTable`
(`MMCA.Common/Tests/Core/MMCA.Common.Infrastructure.Tests.MigrationsFixture/CreateMigrationProofTable.cs:23-27`),
a single additive `CreateTable` against the framework's SQLite context, kept in its own tiny library
outside the test assembly so that only tests naming that assembly as their migrations assembly ever
see it. Nothing a consumer deploys applies it. Consumer migrations still create the shared
`OutboxMessages` / `InboxMessages` tables the framework defines, so a framework-driven shape change
lands as an added migration in each consumer, which is where the gate sees it.

## Rationale
- **Rollback is one-way for schema, so the check belongs where the drop is still cheap.** The only
  moment a destructive migration can be reconsidered for free is the PR that adds it; after the deploy
  the options are roll forward or restore (ADR-009).
- **A grep is enough, and cheap enough to always run.** The gate needs no database, no EF invocation
  and no new tool; it is a diff plus two greps inside a job that already runs on every PR, so it costs
  seconds and cannot itself become a flaky gate.
- **An override that carries a reason beats a bypass label.** The marker lives in the migration file
  next to the operation it excuses, so the next reader of that migration gets the argument for why the
  drop was safe, rather than a green check whose reasoning died with the PR thread.
- **Up-only scanning keeps the false-positive rate at zero.** Every additive migration's `Down()`
  drops what it added; scanning both bodies would flag essentially every migration and the gate would
  be disabled within a week.
- **Invariant over discipline.** This is the same posture as the architecture fitness functions
  (ADR-015) and the integration-event schema rule (ADR-010): a compatibility convention that a code
  review is expected to catch is a convention that eventually ships broken.

## Trade-offs
- **Three operations, not a model of compatibility.** `AlterColumn` narrowing a type or flipping a
  column to NOT NULL, `DropForeignKey`, `DropPrimaryKey`, `DropSchema`, `RenameColumn` and a raw
  `migrationBuilder.Sql("DROP ...")` all pass unflagged. The gate catches the common destructive
  shapes, not every one.
- **The marker is per-migration and unvalidated.** One occurrence anywhere in `Up()` exempts every
  destructive operation in that `Up()`, and nothing checks that the text after the token is a real
  reason, so the gate ultimately enforces "state a reason", not "have a good one".
- **Added-only, and pull-request-only.** A destructive statement appended to a migration file that is
  already on `main` is a modification, not an addition, and is never scanned; neither is anything that
  reaches `main` without a PR.
- **The diff fails closed, and the checkout it depends on is elsewhere in the file.** Neither repo
  wraps the diff in `|| true` any more: an unresolvable diff prints an `::error::` and exits 1
  (`MMCA.Store/.github/workflows/deploy.yml:454-461`,
  `MMCA.ADC/.github/workflows/deploy.yml:253-262`), and only a diff that resolves to an empty added
  list prints "No new migration files in this diff: expand/contract guard passes." and exits 0
  (`MMCA.Store/.github/workflows/deploy.yml:462-465`, `MMCA.ADC/.github/workflows/deploy.yml:263-266`).
  Both `build-and-test` checkouts now set `fetch-depth: 0`
  (`MMCA.Store/.github/workflows/deploy.yml:264-270`, `MMCA.ADC/.github/workflows/deploy.yml:229-232`),
  so the two repos run the same step against the same git object graph. The residual cost is that the
  gate's correctness lives in another step's `with:` block, directly above the guard in MMCA.ADC but
  about 160 lines above it in MMCA.Store (the OpenAPI, coverage and EF steps sit between them): drop the `fetch-depth` and every PR reds on a step that
  has nothing to do with the change, which is the deliberate direction for that failure to point. As
  accepted (2026-07-28) this record described the opposite. The diff was `$(git diff ... || true)` and
  the MMCA.Store checkout was shallow, so the step passed vacuously on every run from 2026-07-25 to
  2026-07-28, a three-day window in which a required check reported green without ever evaluating a
  migration (`MMCA.Store/.github/workflows/deploy.yml:266-269`).
- **It gates the migration, not the application.** Nothing verifies that the previous release's code
  tolerates the new schema; an expand migration that adds a required column the old revision never
  writes is invisible to the gate.
- **Partial adoption is a real gap for the reference app.** MMCA.Helpdesk is the seed developers copy,
  and the rule it teaches by example today is the unmarked drop.

## Revision (2026-10-01)
No decision or rationale changed. Both `deploy.yml` files grew, so every workflow citation is
re-anchored to the current lines: the startup-migrate note (`MMCA.Store/.github/workflows/deploy.yml:1366-1373`,
`MMCA.ADC/.github/workflows/deploy.yml:1474-1484`), the rollback call (Store `:1551`, ADC `:1640`), the
model-drift gate (Store `:411-425`, ADC `:430-444`), the guard step (Store `:427-478`, ADC `:234-282`)
with its diff, Designer skip, `Up()` extraction, regex and marker lines, the `pull_request` condition
(Store `:257`, ADC `:225`), the Markdown-only `code` filter (Store `:189-190`, ADC `:138-139`) and the
`fetch-depth: 0` checkouts (Store `:261-267`, ADC `:229-232`). The regex, the three-operation set and
the fail-closed behavior are unchanged. The one wording correction: in MMCA.Store the checkout now sits
about 160 lines above the guard rather than ninety.

## Revision (2026-10-06)
- No decision, rationale or behavior changed: the regex, the three-operation set, the `Up()`-only scan and
  the fail-closed diff are as recorded. Both `deploy.yml` files grew again, so the live-section anchors
  moved. MMCA.Store: guard step `:430-481` (diff `:457-458`, Designer skip `:469-471`, `Up()`
  extraction `:472`, regex `:473`, marker `:474`, fail-closed `:454-461`, empty list `:462-465`),
  `pull_request` condition `:260`, checkout `:264-270` with the vacuous-window comment at `:266-269`,
  step filter `:431`, Markdown-only filter `:192-193`, model-drift gate `:414-428`, startup-migrate
  note `:1421-1429`, rollback `:1606`. MMCA.ADC: model-drift gate `:435-449`, startup-migrate note
  `:1550-1559`, rollback `:1715`.
- The 2026-10-01 revision's statement that every workflow citation was re-anchored no longer holds for
  the lines it lists; those anchors stay as recorded on that date, and the current lines are above.
- Every anchor in the live sections was re-verified against current source on 2026-10-06; the MMCA.ADC
  guard-step anchors (`:225`, `:229-232`, `:234-282`, `:258-259`, `:270-275`, `:253-266`,
  `:138-139`) still hold.

## Related
ADR-030 (decides that each service self-applies its migrations at startup, which is precisely why a
rolled-back revision meets the new schema; this ADR constrains what those migrations may contain),
ADR-006 (database-per-service bounds a bad migration to one service's database), ADR-009 (a drilled
restore is the backstop when a schema change cannot be rolled forward), ADR-010 (the message-contract
sibling: additive changes stay compatible, breaking ones need a parallel path), ADR-015 (the
invariant-over-discipline posture this gate applies to schema).
